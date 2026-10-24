/**
 * trial.ts — Centralized trial helpers for the web backend.
 *
 * Every API route MUST use getEffectivePlan() instead of manually checking
 * trialEndsAt and mapping free → basic. This single source of truth
 * resolves the user's effective plan considering trial status.
 *
 * Trial users behave like their own tier — NOT free, NOT basic.
 * The trial tier has generous limits so churches can fully experience
 * the product before committing.
 *
 * Trial data is read from the `trials` collection (via trialRecords.ts).
 * The embedded `trial` field on user documents is kept in sync as a
 * legacy compatibility layer but is NEVER the source of truth.
 */

import type { TrialStatus } from "@/types/schemas";
import { getLocalDevPlanOverride } from "@/lib/localDevPlanOverride";
import { DEFAULT_TRIAL_DAYS } from "@/lib/trialDuration";

// ── Types ───────────────────────────────────────────────────────────────────

/** Minimal user shape needed by trial helpers. */
export interface TrialUser {
  plan?: string | null;
  trialId?: string | null;
  trial?: {
    active?: boolean;
    status?: TrialStatus;
    startedAt?: string | null;
    endsAt?: string | null;
    durationDays?: number | null;
    extendedDays?: number;
    extensionCount?: number;
    stoppedAt?: string | null;
    stoppedReason?: string | null;
    restartedAt?: string | null;
    grantedBy?: string | null;
    lastModifiedBy?: string | null;
    welcomeShown?: boolean;
  } | null;
  adminTemporaryPlan?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  adminManagedSubscription?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  subscriptionExpiresAt?: string | null;
  ambassador?: {
    active?: boolean;
  } | null;
}

/** Plan tier returned by getEffectivePlan. */
export type EffectivePlan = "free" | "trial" | "basic" | "growth";

// ── Core Helpers ────────────────────────────────────────────────────────────

/**
 * Whether the user's trial is currently active.
 * Uses `status` field if available, falls back to legacy `active` boolean.
 */
export function isInTrial(user: TrialUser | null | undefined): boolean {
  if (!user?.trial) return false;
  const now = Date.now();
  // New: status-based check
  if (user.trial.status) {
    return user.trial.status === "active" && !!user.trial.endsAt && now < new Date(user.trial.endsAt).getTime();
  }
  // Legacy: active boolean check
  if (typeof user.trial.active === "boolean") {
    return user.trial.active && !!user.trial.endsAt && now < new Date(user.trial.endsAt).getTime();
  }
  return false;
}

/**
 * Whether the user's trial has stopped (admin-stopped).
 */
export function isTrialStopped(user: TrialUser | null | undefined): boolean {
  if (!user?.trial) return false;
  if (user.trial.status === "stopped") return true;
  // Legacy: active === false with a stoppedAt timestamp
  if (user.trial.active === false && user.trial.stoppedAt) return true;
  return false;
}

/**
 * Whether the user had a trial that has expired.
 */
export function isTrialExpired(user: TrialUser | null | undefined): boolean {
  if (!user?.trial) return false;
  if (user.trial.status === "expired") return true;
  if (user.trial.endsAt) {
    return Date.now() >= new Date(user.trial.endsAt).getTime();
  }
  return false;
}

/**
 * Days remaining in trial, or 0 if expired/not in trial.
 */
export function getTrialDaysRemaining(user: TrialUser | null | undefined): number {
  if (!isInTrial(user)) return 0;
  const end = new Date(user!.trial!.endsAt!).getTime();
  const remaining = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, remaining);
}

function hasExpiredAdminTemporaryPlan(user: TrialUser | null | undefined): boolean {
  const temp = user?.adminTemporaryPlan;
  if (!temp?.active || !temp.expiresAt) return false;
  const expiresAtMs = new Date(temp.expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function hasExpiredAdminManagedSubscription(
  user: TrialUser | RawMongoUser | null | undefined,
): boolean {
  const managed = user?.adminManagedSubscription;
  const expiresAt = managed?.expiresAt || user?.subscriptionExpiresAt;
  if (!managed?.active || !expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function hasExpiredStoredPaidSubscription(
  user: TrialUser | RawMongoUser | null | undefined,
): boolean {
  const plan = normalizeStoredPlan(user?.plan);
  if (plan === "free") return false;
  if (!user?.subscriptionExpiresAt) return false;
  const expiresAtMs = new Date(user.subscriptionExpiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function normalizeStoredPlan(plan?: string | null): Exclude<EffectivePlan, "trial"> {
  const normalized = String(plan || "free").trim().toLowerCase();
  if (normalized === "basic") return "basic";
  if (normalized === "growth" || normalized === "pro") return "growth";
  return "free";
}

/**
 * Returns the effective plan for a user.
 *
 * Priority:
 *   1. Active paid/admin plan → "basic" | "growth"
 *   2. Active trial → "trial"
 *   3. Default → "free"
 *
 * Trial users get "trial" tier — NOT "free" or "basic".
 * This ensures trial users get generous limits regardless of their
 * underlying plan field.
 */
export function getEffectivePlan(user: TrialUser | null | undefined): EffectivePlan {
  if (!user) return "free";
  const localDevPlan = getLocalDevPlanOverride((user as any)._id);
  if (localDevPlan) return localDevPlan;
  if (user.ambassador?.active) return "growth";
  if (isInTrial(user)) return "trial";

  if (hasExpiredAdminTemporaryPlan(user)) return "free";
  if (hasExpiredAdminManagedSubscription(user)) return "free";
  if (hasExpiredStoredPaidSubscription(user)) return "free";
  const storedPlan = normalizeStoredPlan(user.plan);
  if (storedPlan !== "free") return storedPlan;
  return "free";
}

// ── Raw MongoDB User Helpers ────────────────────────────────────────────────

/** Shape of a raw MongoDB user document (before any transformation). */
export interface RawMongoUser {
  plan?: string | null;
  trialId?: string | null;
  trial?: {
    active?: boolean;
    status?: TrialStatus;
    startedAt?: string | null;
    endsAt?: string | null;
    durationDays?: number | null;
    extendedDays?: number;
    extensionCount?: number;
    stoppedAt?: string | null;
    stoppedReason?: string | null;
    restartedAt?: string | null;
    grantedBy?: string | null;
    lastModifiedBy?: string | null;
    welcomeShown?: boolean;
  } | null;
  adminTemporaryPlan?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  adminManagedSubscription?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  subscriptionExpiresAt?: string | null;
  ambassador?: {
    active?: boolean;
  } | null;
  // Legacy flat fields (pre-migration)
  trialEndsAt?: string | null;
}

/**
 * Check if a raw MongoDB user is currently in trial.
 * Handles both new `status` field, legacy `active` boolean, and flat `trialEndsAt`.
 */
export function isInTrialRaw(user: RawMongoUser | null | undefined): boolean {
  if (!user) return false;
  // New format: status-based
  if (user.trial?.status) {
    return user.trial.status === "active" && !!user.trial.endsAt && Date.now() < new Date(user.trial.endsAt).getTime();
  }
  // Legacy format: nested trial object with active boolean
  if (user.trial?.active && user.trial?.endsAt) {
    return Date.now() < new Date(user.trial.endsAt).getTime();
  }
  // Legacy format: flat trialEndsAt field
  if (user.trialEndsAt) {
    return Date.now() < new Date(user.trialEndsAt).getTime();
  }
  return false;
}

/**
 * Resolve effective plan from a raw MongoDB user document.
 * Handles both new `status` field, legacy `active` boolean, and flat `trialEndsAt`.
 *
 * Use this in API routes instead of manually checking trial status.
 * Returns the same plan string the old inline code would have produced,
 * BUT uses "trial" instead of "basic" for active trial users.
 */
export function resolveEffectivePlan(user: RawMongoUser | null | undefined): EffectivePlan {
  if (!user) return "free";
  const localDevPlan = getLocalDevPlanOverride((user as any)._id);
  if (localDevPlan) return localDevPlan;
  if (hasExpiredAdminTemporaryPlan(user)) return "free";
  if (hasExpiredAdminManagedSubscription(user)) return "free";
  if (user.ambassador?.active) return "growth";
  if (hasExpiredStoredPaidSubscription(user)) return "free";
  const storedPlan = normalizeStoredPlan(user.plan);
  if (storedPlan !== "free") return storedPlan;
  return isInTrialRaw(user) ? "trial" : "free";
}

// ── New User Factory ────────────────────────────────────────────────────────

// DEFAULT_TRIAL_DAYS lives in ./trialDuration so the trial record code can use it too.

/**
 * Get the default trial duration from platform settings.
 * Reads from platform_settings.trial (single source of truth).
 * Falls back to DEFAULT_TRIAL_DAYS if the DB read fails.
 */
export async function getDefaultTrialDays(): Promise<number> {
  try {
    const { getPlatformSettings } = await import("./platformSettings");
    const settings = await getPlatformSettings();
    return settings.trial.defaultDurationDays ?? DEFAULT_TRIAL_DAYS;
  } catch {
    return DEFAULT_TRIAL_DAYS;
  }
}

/**
 * Check whether trial is globally enabled for new users.
 * Reads from platform_settings.trial (single source of truth).
 * Defaults to true if DB read fails.
 */
export async function isTrialEnabled(): Promise<boolean> {
  try {
    const { getPlatformSettings } = await import("./platformSettings");
    const settings = await getPlatformSettings();
    return settings.trial.enabled;
  } catch {
    return true;
  }
}

/**
 * Create a trial record for a new user.
 *
 * Reads duration from platform_settings.trial (single source of truth).
 * Creates the trial in the `trials` collection (NOT embedded in user doc).
 * Falls back to DEFAULT_TRIAL_DAYS if the DB read fails.
 *
 * @param userId - The MongoDB user ID to create the trial for.
 * @param grantedBy - Optional admin userId who granted this trial.
 * @param durationDaysOverride - Optional override for duration.
 */
export async function createTrialForUser(
  userId: string,
  grantedBy?: string,
  durationDaysOverride?: number
) {
  const { createTrialRecord } = await import("./trialRecords");

  let trialDays = DEFAULT_TRIAL_DAYS;
  if (durationDaysOverride != null) {
    trialDays = durationDaysOverride;
  } else {
    trialDays = await getDefaultTrialDays();
  }

  return createTrialRecord(userId, {
    durationDays: trialDays,
    grantedBy,
  });
}
