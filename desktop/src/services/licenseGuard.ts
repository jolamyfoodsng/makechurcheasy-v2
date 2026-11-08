/**
 * licenseGuard.ts — Central License & Subscription Enforcement
 *
 * SINGLE SOURCE OF TRUTH for whether the application is allowed to run.
 *
 * Every protected feature must check licenseGuard.isUnlocked() instead of
 * implementing its own subscription/trial/account logic. If any validation
 * fails, the application enters a full-screen lock state.
 *
 * Validation checks:
 *   - Account status (active vs suspended)
 *   - Security/admin flags (device_removed, chargeback, etc.)
 *   - Offline sync (see offlineEntitlement.ts): after 14 days offline the app asks
 *     to come online; after 21 days paid features pause (the plan runs as Free)
 *     until it syncs. Being offline never locks the app.
 *
 * Billing expiry (subscription_expired, trial_expired, payment_expired) does
 * NOT lock the application. Instead the user is downgraded to the Free plan
 * and premium features are gated via hasRequiredPlan() / canUseFeature().
 *
 * Architecture:
 *   - Backend returns a signed license payload during verification
 *   - Payload is normalized (expired paid → free) before caching
 *   - On startup: fetch the authenticated bootstrap → normalize → cache → continue
 *   - Every 6 hours: re-verify while running
 *   - Connectivity failures preserve local auth during the configured grace window
 *   - After the grace window, the user is asked to reconnect and verify
 *
 * Feature gating:
 *   Use hasRequiredPlan("growth") or canUseFeature("multiview") — never isUnlocked()
 *   for premium feature checks.
 */

import { getUserScopedKey } from "./userScopedStorage";
import {
  getDeviceApiBaseCandidates,
  getDeviceId,
  getDeviceSecret,
  getSession,
  rememberSessionApiBase,
} from "./authService";
import { checkEntitlementSync, type FeatureKey } from "./entitlementClient";
import { normalizePlanId } from "../lib/subscriptionSourceOfTruth";
import { refreshSubscriptionState, restoreSubscriptionCache } from "./subscriptionCache";
import {
  capPlanForOffline,
  evaluateOfflineEntitlement,
  noteServerTime,
  PAID_PAUSE_DAYS,
  SYNC_PROMPT_DAYS,
  trustedNowMs,
  type OfflineEntitlementState,
} from "./offlineEntitlement";
import {
  noteNativeClock,
  readNativeClock,
  readSealed,
  reportLicenseTamper,
  verifySealed,
  type SealedLicense,
} from "./licenseSeal";
import {
  clearVerifiedLicense,
  isSealEnforced,
  markVerificationInitDone,
  raiseClockFloor,
  setVerifiedLicense,
} from "./verifiedLicense";
import {
  cacheDesktopBootstrap,
  clearDesktopBootstrapCache,
  readDesktopBootstrap,
} from "./desktopConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export type LockReason =
  | "internet_required"
  | "account_suspended"
  | "license_revoked"
  | "maintenance"
  | "forced_upgrade"
  | "organization_disabled"
  | "device_removed"
  | "device_disconnected_by_other"
  | "chargeback"
  | "too_many_devices"
  | "subscription_expired"
  | "trial_expired"
  | "payment_expired"
  | null;

// Billing states — these downgrade to Free, never lock the app
export type BillingState =
  | "subscription_expired"
  | "trial_expired"
  | "payment_expired"
  | null;

export type AccountStatus = "active" | "suspended" | "banned";
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "none";
export type PaymentStatus = "paid" | "expired" | "failed" | "refunded";

export interface LicensePayload {
  accountStatus: AccountStatus;
  subscriptionStatus: SubscriptionStatus;
  plan: string;
  trialActive: boolean;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  renewalDate: string | null;
  /**
   * Last moment paid features are paid for (period end + renewal grace, trial end,
   * admin / ambassador expiry). null = no end date. Older servers don't send it.
   */
  entitledUntil?: string | null;
  /** Signed with the licence: true only for admin accounts. */
  isAdmin?: boolean;
  paymentStatus: PaymentStatus;
  internetVerificationDays: number;
  verificationIntervalHours: number;
  lastVerifiedAt: string;
  serverTime: string;
  lockReason: LockReason;
  // Future extensibility
  maintenanceMode?: boolean;
  /** Admin-written maintenance / emergency message. */
  maintenanceMessage?: string;
  forceUpgradeRequired?: boolean;
  forceUpgradeVersion?: string;
  organizationDisabled?: boolean;
  deviceRemoved?: boolean;
  chargeback?: boolean;
  tooManyDevices?: boolean;
  maxDevices?: number;
  deviceCount?: number;
  otherDevices?: Array<{
    deviceId: string;
    deviceName: string;
    lastSeen?: string;
  }>;
}

export interface LicenseCache {
  payload: LicensePayload;
  cachedAt: number;
  /**
   * The server's signed copy of `payload`. On production builds the cache is
   * only trusted after this has been verified again at startup, so editing the
   * stored payload in localStorage achieves nothing.
   */
  sealed?: SealedLicense;
}

type LicenseFetchResult =
  | { ok: true; payload: LicensePayload; sealed?: SealedLicense | null }
  | { ok: false; lockReason: LockReason; transient: boolean; deviceRejected?: boolean };

export interface LicenseGuardState {
  unlocked: boolean;
  lockReason: LockReason;
  payload: LicensePayload | null;
  verifying: boolean;
  lastVerifiedAt: number | null;
  daysOffline: number;
  /** Days left before paid features pause for being offline. */
  offlineDaysRemaining: number;
  /** 14+ days since the last sync: ask the user to come online. */
  offlineWarning: boolean;
  /** 21+ days since the last sync: paid features paused until it syncs. */
  paidPausedOffline: boolean;
  /** The paid period ended (checked offline against trusted time). */
  entitlementEnded: boolean;
  /** When paid access ends (ms), null = no end date. */
  entitledUntilMs: number | null;
  /**
   * The server keeps refusing this computer's device sign-in (it answers
   * "temporarily unavailable", which used to look like being offline).
   * Signing out and back in pairs the computer again.
   */
  signInRequired: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const OFFLINE_WARNING_DAYS = SYNC_PROMPT_DAYS; // 2 weeks: ask the user to come online
/** 3 weeks: paid features pause (plan runs as Free) until the app syncs. The app is not locked. */
export const OFFLINE_LOCK_DAYS = PAID_PAUSE_DAYS;
const LAST_ONLINE_KEY = "mce-last-online-at";
const STORAGE_KEY = "ocs-license-cache";
const DOWNGRADE_NOTIFIED_KEY = "ocs-downgrade-notified";
const DEVICE_REJECTED_COUNT_KEY = "mce-license-device-rejected-count";
/** Rejections in a row (across restarts) before asking the user to sign in again. */
export const DEVICE_REJECTED_SIGN_IN_THRESHOLD = 3;
const VISIBILITY_REVERIFY_MIN_INTERVAL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKGROUND_REVERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SUBSCRIPTION_CACHE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const FEATURE_ALIAS_MAP: Record<string, FeatureKey> = {
  multiview: "multiview",
  ai_translation: "translation",
  remote_presentation: "mobileControl",
  advanced_themes: "themes",
  ticker: "tickers",
  countdown: "countdowns",
  bible_overlay: "lowerThirds",
};

const PLAN_HIERARCHY: Record<string, number> = {
  free: 0,
  basic: 1,
  growth: 2,
  pro: 2,
};
const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

// ── Internal State ───────────────────────────────────────────────────────────

let _cache: LicenseCache | null = null;
let _lockReason: LockReason = null;
let _verifying = false;
let _initialized = false;
let _revalidationTimer: ReturnType<typeof setInterval> | null = null;
let _offlineTickTimer: ReturnType<typeof setInterval> | null = null;
let _listeners: Array<(state: LicenseGuardState) => void> = [];
let _lastVisibilityVerificationAt = 0;
let _lastSubscriptionCacheRefreshAt = 0;

// ── Cache Read/Write ─────────────────────────────────────────────────────────

function readCache(): LicenseCache | null {
  try {
    const raw = localStorage.getItem(getUserScopedKey(STORAGE_KEY));
    if (!raw) return null;
    const cache = JSON.parse(raw) as LicenseCache;
    // Always normalize on read — safety net against stale billing lock states
    cache.payload = normalizeLicensePayload(cache.payload);
    return cache;
  } catch {
    return null;
  }
}

function writeCache(cache: LicenseCache): void {
  try {
    localStorage.setItem(getUserScopedKey(STORAGE_KEY), JSON.stringify(cache));
  } catch {
    // Storage full or unavailable
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(getUserScopedKey(STORAGE_KEY));
  } catch {
    // ignore
  }
}

// ── Subscription ─────────────────────────────────────────────────────────────

type Unsubscribe = () => void;

function emit(): void {
  const state = getState();
  for (const listener of _listeners) {
    try {
      listener(state);
    } catch {
      // Listener error — don't break the chain
    }
  }
}

// ── Backend Verification ─────────────────────────────────────────────────────

async function fetchLicenseFromBackend(): Promise<LicenseFetchResult> {
  const session = getSession();
  const deviceId = getDeviceId();
  if (!session?.user?.id || !deviceId) {
    return { ok: false, lockReason: "device_removed", transient: false };
  }

  const cachedBootstrap = readDesktopBootstrap(30_000, deviceId);
  if (cachedBootstrap?.license) {
    return { ok: true, payload: cachedBootstrap.license as LicensePayload, sealed: readSealed(cachedBootstrap) };
  }

  const candidates = getDeviceApiBaseCandidates();
  let sawDeviceMissing = false;

  for (const apiBase of candidates) {
    try {
      const res = await fetch(
        `${apiBase}/api/device/license?deviceId=${encodeURIComponent(deviceId)}&bootstrap=1&announcements=3`,
        {
          headers: {
            "X-App-Version": APP_VERSION,
            "X-Device-Secret": getDeviceSecret() || "",
          },
        },
      );

      if (!res.ok) {
        let error = "";
        try {
          const data = await res.clone().json();
          error = typeof data?.error === "string" ? data.error : "";
        } catch {
          // keep status-only handling
        }

        console.warn(`[licenseGuard] Backend returned ${res.status}${error ? `: ${error}` : ""}`);

        if (
          (res.status === 401 || res.status === 404) &&
          apiBase !== candidates[candidates.length - 1]
        ) {
          sawDeviceMissing = true;
          console.warn(
            "[licenseGuard] Device not found on %s; retrying license check on production API.",
            apiBase,
          );
          continue;
        }

        if (res.status === 401 || res.status === 404) {
          if (error === "device_disconnected_by_another_computer") {
            return { ok: false, lockReason: "device_disconnected_by_other", transient: false };
          }
          return { ok: false, lockReason: "device_removed", transient: false };
        }
        if (res.status === 403 && /version/i.test(error)) {
          return { ok: false, lockReason: "forced_upgrade", transient: false };
        }
        // The server answers 503 "Device verification is temporarily unavailable"
        // when it doesn't recognise this computer's device id / secret. It is
        // retryable on purpose (stale ids during updates), but if it keeps
        // happening the computer is online and needs to be paired again.
        if (res.status === 503 && /device verification/i.test(error)) {
          return { ok: false, lockReason: "internet_required", transient: true, deviceRejected: true };
        }

        return { ok: false, lockReason: "internet_required", transient: true };
      }

      const data = await res.json();
      if (!data?.license) {
        return { ok: false, lockReason: "internet_required", transient: true };
      }
      cacheDesktopBootstrap(data, deviceId);
      if (sawDeviceMissing || candidates[0] !== apiBase) {
        await rememberSessionApiBase(apiBase);
      }
      return { ok: true, payload: data.license, sealed: readSealed(data) };
    } catch (err) {
      console.warn("[licenseGuard] Backend fetch failed:", err);
      if (apiBase !== candidates[candidates.length - 1]) {
        continue;
      }
      return { ok: false, lockReason: "internet_required", transient: true };
    }
  }

  return { ok: false, lockReason: "device_removed", transient: false };
}

// ── License Normalization ────────────────────────────────────────────────────

/**
 * Convert expired paid subscriptions into Free plan payloads.
 * This is the safety net — the backend should already return plan=free
 * for expired users, but this ensures the frontend never locks for billing.
 *
 * Only modifies the payload when a billing expiry is detected.
 * Security/admin states (suspended, device_removed, etc.) are untouched.
 */
export function normalizeLicensePayload(payload: LicensePayload): LicensePayload {
  const now = payload.serverTime ? new Date(payload.serverTime).getTime() : Date.now();
  const plan = payload.plan || "free";

  // Already free — nothing to normalize
  if (plan === "free") return payload;

  // Active trial users must NOT be downgraded to free
  const hasActiveTrial = Boolean(
    payload.trialActive &&
    payload.trialEndsAt &&
    new Date(payload.trialEndsAt).getTime() > now
  );
  if (hasActiveTrial) {
    try {
      localStorage.removeItem(getUserScopedKey(DOWNGRADE_NOTIFIED_KEY));
    } catch { /* ignore */ }
    return {
      ...payload,
      lockReason: null,
    };
  }

  const isBillingExpiry =
    payload.lockReason === "subscription_expired" ||
    payload.lockReason === "trial_expired" ||
    payload.lockReason === "payment_expired" ||
    payload.paymentStatus === "expired" ||
    payload.paymentStatus === "failed" ||
    payload.paymentStatus === "refunded" ||
    payload.subscriptionStatus === "cancelled" ||
    payload.subscriptionStatus === "expired" ||
    (payload.subscriptionStatus === "active" &&
      !!payload.subscriptionEndsAt &&
      new Date(payload.subscriptionEndsAt).getTime() < now) ||
    (payload.trialActive &&
      !!payload.trialEndsAt &&
      new Date(payload.trialEndsAt).getTime() < now);

  if (!isBillingExpiry) return payload;

  // Mark that a downgrade notification should be shown (once per downgrade event)
  try {
    const key = getUserScopedKey(DOWNGRADE_NOTIFIED_KEY);
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "pending");
    }
  } catch { /* ignore */ }

  return {
    ...payload,
    plan: "free",
    subscriptionStatus: "none",
    lockReason: null,
    trialActive: false,
    trialEndsAt: null,
    subscriptionEndsAt: null,
    renewalDate: null,
  };
}

// ── License Evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate a normalized license payload and determine the lock reason.
 * Returns null if the license is valid (unlocked).
 *
 * Only security/admin states lock the app.
 * Billing expiry is handled by normalizeLicensePayload() before this runs.
 */
function evaluateLicense(payload: LicensePayload): LockReason {
  // 1. Security/admin flags — always lock regardless of plan
  if (payload.maintenanceMode) return "maintenance";
  if (payload.forceUpgradeRequired) return "forced_upgrade";
  if (payload.organizationDisabled) return "organization_disabled";
  if (payload.deviceRemoved) return "device_removed";
  if (payload.chargeback) return "chargeback";
  if (payload.tooManyDevices) return "too_many_devices";

  // 2. Account status — security/compliance
  if (payload.accountStatus === "suspended" || payload.accountStatus === "banned") {
    return "account_suspended";
  }

  // 3. Backend-forced lock — only honour non-billing lock reasons
  if (payload.lockReason) {
    return payload.lockReason as LockReason;
  }

  // 4. All billing states have been normalized to free by this point — always unlocked
  return null;
}

export function getStoredLastOnlineMs(): number {
  try {
    const raw = localStorage.getItem(getUserScopedKey(LAST_ONLINE_KEY)) || localStorage.getItem(LAST_ONLINE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch { /* ignore */ }
  return 0;
}

function deviceRejectedKey(): string {
  try {
    return getUserScopedKey(DEVICE_REJECTED_COUNT_KEY);
  } catch {
    return DEVICE_REJECTED_COUNT_KEY;
  }
}

function readDeviceRejectedCount(): number {
  try {
    const n = Number(localStorage.getItem(deviceRejectedKey()));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeDeviceRejectedCount(count: number): void {
  try {
    const key = deviceRejectedKey();
    if (count > 0) localStorage.setItem(key, String(count));
    else localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

/** Pure rule: has the server refused this computer often enough to ask for a new sign-in? */
export function isSignInRequired(rejectedInARow: number): boolean {
  return rejectedInARow >= DEVICE_REJECTED_SIGN_IN_THRESHOLD;
}

export function recordOnlineSuccess(): void {
  try {
    const now = Date.now();
    localStorage.setItem(getUserScopedKey(LAST_ONLINE_KEY), String(now));
    localStorage.setItem(LAST_ONLINE_KEY, String(now));
  } catch { /* ignore */ }
}

function getLastVerifiedMs(cached: LicenseCache | null): number {
  if (cached) {
    const fromPayload = new Date(cached.payload.lastVerifiedAt).getTime();
    if (Number.isFinite(fromPayload) && fromPayload > 0) return fromPayload;
    if (Number.isFinite(cached.cachedAt) && cached.cachedAt > 0) return cached.cachedAt;
  }
  return getStoredLastOnlineMs();
}

function getOfflineWindowDays(_cached: LicenseCache | null): number {
  return OFFLINE_LOCK_DAYS;
}

function evaluateOfflineValidity(cached: LicenseCache | null): LockReason {
  const lastVerifiedMs = getLastVerifiedMs(cached);
  if (!lastVerifiedMs) {
    recordOnlineSuccess();
    return null;
  }

  // Being offline no longer locks the app: paid features pause instead
  // (see offlineEntitlementFor / capPlanForOffline). Nothing to lock here.
  return null;
}

/** Offline entitlement from the in-memory license cache. */
function offlineEntitlementFor(cached: LicenseCache | null): OfflineEntitlementState {
  return evaluateOfflineEntitlement(cached?.payload ?? null, getLastVerifiedMs(cached), trustedNowMs());
}

/**
 * The plan features should use: the cached plan, turned into Free when the paid
 * period ended or the computer has gone 21+ days without syncing.
 */
export function getEffectiveLicensePlan(): string {
  const plan = _cache?.payload?.plan || "free";
  return capPlanForOffline(plan, offlineEntitlementFor(_cache));
}

function refreshSubscriptionCacheInBackground(): void {
  const session = getSession();
  const deviceId = getDeviceId();
  if (!session?.user?.id || !deviceId) return;

  const now = Date.now();
  if (now - _lastSubscriptionCacheRefreshAt < SUBSCRIPTION_CACHE_REFRESH_INTERVAL_MS) return;
  _lastSubscriptionCacheRefreshAt = now;

  void refreshSubscriptionState({
    apiBases: getDeviceApiBaseCandidates(),
    deviceId,
    deviceSecret: getDeviceSecret(),
    appVersion: APP_VERSION,
  }).catch((error) => {
    console.debug("[licenseGuard] Subscription cache refresh skipped:", error);
  });
}

// ── Core State Management ────────────────────────────────────────────────────

function computeState(): void {
  const cached = _cache;
  // First check offline validity
  const offlineReason = evaluateOfflineValidity(cached);
  if (offlineReason) {
    _lockReason = offlineReason;
    return;
  }

  if (!cached) {
    // No cache — allow during initialization
    _lockReason = null;
    return;
  }

  // Then check the payload itself
  _lockReason = evaluateLicense(cached.payload);
}

export function getState(): LicenseGuardState {
  const cached = _cache;
  const lastVerified = getLastVerifiedMs(cached) || null;
  const offline = offlineEntitlementFor(cached);

  return {
    unlocked: _lockReason === null,
    lockReason: _lockReason,
    payload: cached?.payload ?? null,
    verifying: _verifying,
    lastVerifiedAt: lastVerified,
    daysOffline: offline.daysSinceSync,
    offlineDaysRemaining: offline.daysUntilPause,
    offlineWarning: offline.syncDue,
    paidPausedOffline: offline.paidPaused,
    entitlementEnded: offline.entitlementEnded,
    entitledUntilMs: offline.entitledUntilMs,
    signInRequired: isSignInRequired(readDeviceRejectedCount()),
  };
}

// ── Feature Gating ───────────────────────────────────────────────────────────

/**
 * Returns true if the current plan meets or exceeds the required plan.
 * Use this for premium feature checks — never isUnlocked().
 *
 * Example: hasRequiredPlan("growth")
 */
export function hasRequiredPlan(requiredPlan: string): boolean {
  const currentPlan = getEffectiveLicensePlan();
  const current = PLAN_HIERARCHY[currentPlan] ?? 0;
  const required = PLAN_HIERARCHY[requiredPlan] ?? 0;
  return current >= required;
}

/**
 * Returns true if the current plan can use the given feature.
 * Use this for all premium feature gates.
 *
 * Example: canUseFeature("multiview")
 */
export function canUseFeature(feature: string): boolean {
  const mappedFeature = FEATURE_ALIAS_MAP[feature];
  if (!mappedFeature) return true;
  const currentPlan = normalizePlanId(getEffectiveLicensePlan());
  return checkEntitlementSync(mappedFeature, currentPlan).allowed;
}

/**
 * Returns true if a downgrade notification is pending (shown once per downgrade).
 * Call markDowngradeNotified() after showing the notification.
 */
export function hasPendingDowngradeNotification(): boolean {
  try {
    const key = getUserScopedKey(DOWNGRADE_NOTIFIED_KEY);
    const isPending = localStorage.getItem(key) === "pending";
    if (!isPending) return false;

    // Guard: If current cached license has an active trial or paid plan, clear the notice
    const payload = _cache?.payload;
    if (payload) {
      const now = payload.serverTime ? new Date(payload.serverTime).getTime() : Date.now();
      const hasActiveTrial = Boolean(
        payload.trialActive &&
        payload.trialEndsAt &&
        new Date(payload.trialEndsAt).getTime() > now
      );
      if (hasActiveTrial || (payload.plan && payload.plan !== "free")) {
        localStorage.removeItem(key);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark the downgrade notification as shown so it doesn't appear again.
 */
export function markDowngradeNotified(): void {
  try {
    localStorage.setItem(getUserScopedKey(DOWNGRADE_NOTIFIED_KEY), "shown");
  } catch { /* ignore */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Whether the application is currently allowed to run.
 * Only returns false for security/admin lock states.
 * Billing expiry does NOT lock the app — use canUseFeature() for premium gates.
 */
export function isUnlocked(): boolean {
  return _lockReason === null;
}

/**
 * Get the current lock reason, or null if unlocked.
 */
export function getLockReason(): LockReason {
  return _lockReason;
}

/**
 * Get the cached license payload.
 */
export function getLicensePayload(): LicensePayload | null {
  return _cache?.payload ?? null;
}

/**
 * Get days the device has been offline.
 */
export function getDaysOffline(): number {
  const cached = _cache;
  if (!cached) return 0;
  const lastVerified = getLastVerifiedMs(cached);
  if (!lastVerified) return 0;
  return Math.floor((Date.now() - lastVerified) / DAY_MS);
}

/**
 * Get days remaining before offline license verification is required.
 */
export function getOfflineDaysRemaining(): number {
  const cached = _cache;
  if (!cached) return 0;
  const lastVerified = getLastVerifiedMs(cached);
  if (!lastVerified) return 0;
  return Math.max(0, Math.ceil((lastVerified + getOfflineWindowDays(cached) * DAY_MS - Date.now()) / DAY_MS));
}

/**
 * Subscribe to license state changes.
 */
export function subscribe(listener: (state: LicenseGuardState) => void): Unsubscribe {
  _listeners.push(listener);
  // Emit current state immediately
  try {
    listener(getState());
  } catch {
    // ignore
  }
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

// ── Signed licence ───────────────────────────────────────────────────────────

/**
 * Checks the server's signature on a freshly fetched licence. On production
 * builds a licence that is unsigned, badly signed or issued for another device
 * is refused (the app keeps what it already verified, or runs as Free).
 */
async function sealCheckFetched(
  result: Extract<LicenseFetchResult, { ok: true }>,
): Promise<Extract<LicenseFetchResult, { ok: true }> | Extract<LicenseFetchResult, { ok: false }>> {
  const refused = { ok: false as const, lockReason: "internet_required" as LockReason, transient: true };
  const deviceId = getDeviceId() || "";

  if (!result.sealed) {
    if (!isSealEnforced()) return result;
    console.warn("[licenseGuard] License response is not signed; ignoring it.");
    return refused;
  }

  const verdict = await verifySealed(result.sealed, deviceId);
  if (verdict.valid) {
    setVerifiedLicense(verdict.license, verdict.signedAtMs);
    if (verdict.signedAtMs) void noteNativeClock(verdict.signedAtMs);
    return { ok: true, payload: verdict.license as unknown as LicensePayload, sealed: result.sealed };
  }

  console.warn("[licenseGuard] License signature rejected:", verdict.reason);
  const apiBase = getDeviceApiBaseCandidates()[0];
  if (apiBase && deviceId) {
    void reportLicenseTamper(apiBase, deviceId, getDeviceSecret(), verdict.reason, APP_VERSION);
  }
  return isSealEnforced() ? refused : result;
}

/**
 * Startup: the cached licence is only trusted if its saved signature still
 * verifies. Anything else is discarded so a hand-edited cache can't unlock
 * paid features.
 */
async function restoreSealedCache(cache: LicenseCache | null): Promise<LicenseCache | null> {
  // Raise the clock floor from the native file first (survives clearing localStorage).
  const nativeClock = await readNativeClock();
  if (nativeClock) raiseClockFloor(nativeClock);

  if (!cache) return null;
  const deviceId = getDeviceId() || "";

  if (cache.sealed && deviceId) {
    const verdict = await verifySealed(cache.sealed, deviceId);
    if (verdict.valid) {
      setVerifiedLicense(verdict.license, verdict.signedAtMs);
      return {
        ...cache,
        payload: normalizeLicensePayload(verdict.license as unknown as LicensePayload),
      };
    }
    console.warn("[licenseGuard] Stored license failed verification:", verdict.reason);
  }

  if (isSealEnforced()) {
    clearCache();
    clearVerifiedLicense();
    return null;
  }
  return cache;
}

// ── Verification Flow ────────────────────────────────────────────────────────

/**
 * Run the full verification flow:
 * 1. Fetch the authenticated desktop bootstrap from the backend
 * 3. Cache the result
 * 4. Evaluate and update lock state
 *
 * Returns true if verification succeeded, false otherwise.
 */
export async function verify(): Promise<boolean> {
  // The license guard starts during app boot, before a user has paired this
  // installation.  A missing session is not a removed device; treating it as
  // one leaves a stale lock state that can immediately log a newly paired
  // Windows session back out of the app.
  if (!getSession()?.user?.id || !getDeviceId()) {
    if (typeof navigator !== "undefined" && navigator.onLine) {
      recordOnlineSuccess();
    }
    _lockReason = null;
    emit();
    return true;
  }

  if (_verifying) return false;
  _verifying = true;
  emit();

  try {
    let licenseResult = await fetchLicenseFromBackend();
    if (licenseResult.ok) licenseResult = await sealCheckFetched(licenseResult);
    if (!licenseResult.ok) {
      if (licenseResult.deviceRejected) {
        writeDeviceRejectedCount(readDeviceRejectedCount() + 1);
      }
      if (!licenseResult.transient) {
        _lockReason = licenseResult.lockReason;
        emit();
        return false;
      }

      // Backend unreachable or invalid response — keep existing cache if valid
      if (_cache) {
        const offlineReason = evaluateOfflineValidity(_cache);
        _lockReason = offlineReason;
        emit();
        return _lockReason === null;
      }
      // No cached license means this is an unverified first run or a
      // transient API outage, not proof that the account is invalid.
      _lockReason = null;
      emit();
      return true;
    }

    // Normalize before caching — convert billing expiry to free plan
    const normalizedPayload = normalizeLicensePayload(licenseResult.payload);
    _cache = {
      payload: normalizedPayload,
      cachedAt: Date.now(),
      ...(licenseResult.sealed ? { sealed: licenseResult.sealed } : {}),
    };
    writeCache(_cache);
    recordOnlineSuccess();
    writeDeviceRejectedCount(0);
    noteServerTime(normalizedPayload.serverTime);
    refreshSubscriptionCacheInBackground();

    _lockReason = evaluateLicense(normalizedPayload);
    emit();
    return _lockReason === null;
  } catch (err) {
    console.error("[licenseGuard] Verification error:", err);
    if (!_cache) {
      _lockReason = null;
      emit();
    }
    return _lockReason === null;
  } finally {
    _verifying = false;
    emit();
  }
}

/**
 * Retry verification (called from lock screen "Retry" button).
 */
export async function retryVerification(): Promise<boolean> {
  return verify();
}

/**
 * Force an immediate re-verification against the backend.
 * Called after login/registration to ensure the license state reflects
 * the newly authenticated user's subscription.
 */
export async function reverifyOnAuth(): Promise<boolean> {
  // Reset initialized flag so initLicenseGuard can run again if needed
  // but the main purpose here is to force a fresh backend check.
  clearDesktopBootstrapCache();
  return verify();
}

/**
 * Disconnect other active devices on the account and re-verify this device.
 * Used when a Free plan user (or user who exceeded device limit) wants to
 * switch active device to the current computer with one click.
 */
export async function disconnectOtherDevicesAndUnlock(
  targetDeviceId?: string,
): Promise<{ success: boolean; error?: string }> {
  const deviceId = getDeviceId();
  const deviceSecret = getDeviceSecret();
  if (!deviceId) {
    return { success: false, error: "No device ID found" };
  }

  const candidates = getDeviceApiBaseCandidates();
  let succeeded = false;

  for (const apiBase of candidates) {
    try {
      const res = await fetch(`${apiBase}/api/device/disconnect-others`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Version": APP_VERSION,
          "X-Device-Id": deviceId,
          "X-MCE-Device-Id": deviceId,
          "X-Device-Secret": deviceSecret || "",
        },
        body: JSON.stringify(targetDeviceId ? { targetDeviceId } : {}),
      });

      if (res.ok) {
        succeeded = true;
        break;
      }
    } catch (err) {
      console.warn("[licenseGuard] Failed to call disconnect-others on", apiBase, err);
    }
  }

  if (!succeeded) {
    return {
      success: false,
      error: "Failed to disconnect other device. Please check your internet connection.",
    };
  }

  clearDesktopBootstrapCache();
  const unlocked = await verify();
  return { success: unlocked };
}

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the license guard. Called once on app startup.
 *
 * Startup sequence:
 * 1. Load cached license from localStorage
 * 2. Evaluate offline validity
 * 3. Fetch the authenticated bootstrap when available
 * 4. If the request fails: use cache if within the configured offline window
 * 5. Start periodic revalidation (every 6 hours)
 */
export async function initLicenseGuard(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  // Load cached license, keeping it only if its signature still verifies
  _cache = await restoreSealedCache(readCache());
  // The subscription snapshot (plan / credits for offline use) is re-verified too.
  try {
    await restoreSubscriptionCache(getSession()?.user?.id);
  } catch {
    /* the snapshot is optional; the licence above is what gates features */
  }
  markVerificationInitDone();

  // Evaluate initial state
  computeState();
  emit();

  // Start verification flow (non-blocking). The authenticated license request
  // is also the desktop heartbeat and carries health/config/announcements.
  await verify();

  // Start periodic revalidation
  startPeriodicVerification();
}

/**
 * Start the 6-hour periodic verification timer.
 * Also registers a visibilitychange listener (BUG 5) so the license is
 * re-verified when the user returns to the app after it was hidden.
 */
function startPeriodicVerification(): void {
  if (_revalidationTimer) return;

  const intervalHours = _cache?.payload?.verificationIntervalHours || 6;
  const intervalMs = Math.max(
    30_000,
    Math.min(intervalHours * 60 * 60 * 1000, MAX_BACKGROUND_REVERIFY_INTERVAL_MS),
  );

  _revalidationTimer = setInterval(async () => {
    await verify();
  }, intervalMs);

  // Offline rules change with time (a plan ends, 14 / 21 days pass): re-check every 5 minutes.
  if (!_offlineTickTimer) {
    _offlineTickTimer = setInterval(() => {
      computeState();
      emit();
    }, 5 * 60 * 1000);
  }

  // Re-verify when the user returns to the app (e.g. after sleep/switch)
  document.addEventListener("visibilitychange", _onVisibilityChange);
}

/**
 * Visibility change handler — re-verifies when tab becomes visible.
 */
function _onVisibilityChange(): void {
  if (document.visibilityState !== "visible" || !_initialized || _verifying) return;

  const now = Date.now();
  if (now - _lastVisibilityVerificationAt < VISIBILITY_REVERIFY_MIN_INTERVAL_MS) {
    return;
  }

  _lastVisibilityVerificationAt = now;
  void verify();
}

/**
 * Stop periodic verification (e.g. on logout).
 */
export function stopPeriodicVerification(): void {
  if (_revalidationTimer) {
    clearInterval(_revalidationTimer);
    _revalidationTimer = null;
  }
  if (_offlineTickTimer) {
    clearInterval(_offlineTickTimer);
    _offlineTickTimer = null;
  }
  document.removeEventListener("visibilitychange", _onVisibilityChange);
}

/**
 * Full reset — clear cache, stop timers, reset state.
 * Called on logout.
 */
export function resetLicenseGuard(): void {
  stopPeriodicVerification();
  _cache = null;
  clearVerifiedLicense();
  _lockReason = null;
  _verifying = false;
  _initialized = false;
  _lastVisibilityVerificationAt = 0;
  _lastSubscriptionCacheRefreshAt = 0;
  clearDesktopBootstrapCache();
  clearCache();
  emit();
}

// ── React Hook ───────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";

/**
 * React hook for subscribing to license guard state.
 * Returns the current state and re-renders when it changes.
 */
export function useLicenseGuardState(): LicenseGuardState {
  const [state, setState] = useState<LicenseGuardState>(getState);

  useEffect(() => {
    return subscribe(setState);
  }, []);

  return state;
}

// ── Lock Screen Descriptions ─────────────────────────────────────────────────

export interface LockScreenConfig {
  icon: string;
  title: string;
  description: string;
  primaryAction: "retry" | "subscribe" | "manage_devices" | "contact_support" | "disconnect_others" | "reconnect";
  primaryLabel: string;
  otherDeviceName?: string;
  isDeviceLimit?: boolean;
}

export function getLockScreenConfig(reason: LockReason, _payload: LicensePayload | null): LockScreenConfig {
  switch (reason) {
    case "internet_required":
      return {
        icon: "wifi_off",
        title: "Internet Connection Required",
        description:
          "You have not connected to the internet for 3 weeks. Please connect to the internet for a few minutes so MakeChurchEazy can verify your license and synchronize.",
        primaryAction: "retry",
        primaryLabel: "Check Connection",
      };

    case "account_suspended":
      return {
        icon: "block",
        title: "Account Restricted",
        description:
          "Your account has been temporarily restricted. Please contact support for assistance.",
        primaryAction: "contact_support",
        primaryLabel: "Contact Support",
      };

    case "license_revoked":
      return {
        icon: "gpp_bad",
        title: "License Revoked",
        description:
          "Your license has been revoked. Please contact support for assistance.",
        primaryAction: "contact_support",
        primaryLabel: "Contact Support",
      };

    case "maintenance":
      return {
        icon: "schedule",
        title: "Temporarily Unavailable",
        description:
          getLicensePayload()?.maintenanceMessage?.trim() ||
          "MakeChurchEazy is down for maintenance. It will reopen automatically as soon as it is back.",
        primaryAction: "retry",
        primaryLabel: "Retry",
      };

    case "forced_upgrade":
      return {
        icon: "system_update",
        title: "Update Required",
        description:
          "A mandatory update is required to continue using MakeChurchEazy. Please update to the latest version.",
        primaryAction: "retry",
        primaryLabel: "Check for Updates",
      };

    case "organization_disabled":
      return {
        icon: "business",
        title: "Organization Disabled",
        description:
          "Your organization's account has been disabled. Please contact your administrator.",
        primaryAction: "contact_support",
        primaryLabel: "Contact Support",
      };

    case "device_removed":
      return {
        icon: "devices_other",
        title: "Device Verification Needed",
        description:
          "We could not verify this device registration. Retry verification first; reconnect the device only if it was intentionally removed from your account.",
        primaryAction: "retry",
        primaryLabel: "Retry Verification",
      };

    case "device_disconnected_by_other":
      return {
        icon: "devices_other",
        title: "Logged Out on Another Computer",
        description:
          "This computer was disconnected because your MakeChurchEazy account was opened on another computer. The Free plan allows 1 computer at a time. Sign in again to use MakeChurchEazy here, or upgrade your plan to use multiple computers together.",
        primaryAction: "reconnect",
        primaryLabel: "Sign In & Use Here",
      };

    case "chargeback":
      return {
        icon: "report",
        title: "Payment Dispute",
        description:
          "A payment dispute has been filed for your account. Please resolve the dispute to continue using MakeChurchEazy.",
        primaryAction: "contact_support",
        primaryLabel: "Contact Support",
      };

    case "too_many_devices": {
      const isFree =
        !_payload?.plan ||
        _payload.plan.toLowerCase() === "free" ||
        _payload.maxDevices === 1;
      const otherDeviceName = _payload?.otherDevices?.[0]?.deviceName;

      if (isFree) {
        return {
          icon: "devices",
          title: otherDeviceName ? `Active on ${otherDeviceName}` : "Active on Another Computer",
          description: otherDeviceName
            ? `Your Free plan allows 1 computer at a time, and your account is currently active on "${otherDeviceName}". Log out the other computer to use MakeChurchEazy here, or upgrade your plan to use multiple computers together.`
            : "Your Free plan allows 1 computer at a time. Another computer is currently active on your account. Log out the other computer to use MakeChurchEazy here, or upgrade your plan to use multiple computers together.",
          primaryAction: "disconnect_others",
          primaryLabel: "Log Out & Continue",
          otherDeviceName,
          isDeviceLimit: true,
        };
      }

      return {
        icon: "devices",
        title: "Device Limit Reached",
        description:
          `Your ${_payload?.plan || "current"} plan allows ${_payload?.maxDevices || 1} active computer(s), and all slots are currently in use. Log out other devices to use MakeChurchEazy here, or upgrade your plan for more device slots.`,
        primaryAction: "disconnect_others",
        primaryLabel: "Log Out & Continue",
        otherDeviceName,
        isDeviceLimit: true,
      };
    }

    default:
      return {
        icon: "lock",
        title: "Access Restricted",
        description:
          "Your account requires attention. Please contact support for assistance.",
        primaryAction: "contact_support",
        primaryLabel: "Contact Support",
      };
  }
}

/**
 * Test helper for simulating offline durations
 */
export function __testSetLastVerifiedMs(ms: number): void {
  if (!_cache) {
    _cache = {
      payload: {
        accountStatus: "active",
        subscriptionStatus: "active",
        plan: "basic",
        trialActive: false,
        trialEndsAt: null,
        subscriptionEndsAt: null,
        renewalDate: null,
        paymentStatus: "paid",
        internetVerificationDays: 21,
        verificationIntervalHours: 6,
        lastVerifiedAt: new Date(ms).toISOString(),
        serverTime: new Date(ms).toISOString(),
        lockReason: null,
      },
      cachedAt: ms,
    };
  } else {
    _cache.cachedAt = ms;
    _cache.payload.lastVerifiedAt = new Date(ms).toISOString();
  }
  try {
    localStorage.setItem(getUserScopedKey(LAST_ONLINE_KEY), String(ms));
    localStorage.setItem(LAST_ONLINE_KEY, String(ms));
  } catch { /* ignore */ }
  computeState();
  emit();
}

