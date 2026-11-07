/**
 * licenseService.ts — Centralized licensing and plan enforcement
 *
 * ALL plan checks flow through this service. Never scatter
 * `user.plan === "free"` checks in components.
 *
 * TWO SEPARATE SYSTEMS:
 *   1. License system → controls features and resource limits
 *   2. Credits system → controls AI usage only (speech-to-scripture, translation)
 *
 * SINGLE SOURCE OF TRUTH:
 *   The backend plan_config MongoDB document owns ALL plan definitions.
 *   This service reads from the cached plan config (fetched from /api/plan-config).
 *   When offline, it uses the localStorage cache maintained by planConfig.ts.
 *
 *   Changing a plan should only require updating one MongoDB document.
 *   No desktop release. No frontend code changes. No licenseService edits.
 */

import type { AuthUser } from "./authService";
import type { PlanTier } from "./planConfigTypes";
import {
  getCachedPlan,
  isOfflineValid,
  getOfflineDaysRemaining,
} from "./subscriptionCache";
import {
  getPlanConfig,
  readPlanConfigCache,
} from "./planConfig";
import {
  ALL_TIERS,
  DEFAULT_PLAN_CONFIG,
  FEATURE_LABELS,
  deriveFeatureRequiredPlan,
  type PlanConfig,
  type PlanEntitlements,
} from "./planConfigTypes";
import {
  getEffectivePlan as resolveCanonicalPlan,
  isActiveTrial as isCanonicalTrialActive,
  normalizePlanId,
} from "../lib/subscriptionSourceOfTruth";
import { getLocalDevPlanOverride } from "./localDevPlanOverride";
import { capPlanForOffline, getOfflineEntitlementState } from "./offlineEntitlement";
import { getVerifiedPlanCap } from "./verifiedLicense";

export type { PlanTier } from "./planConfigTypes";

// ── Plan Limits ──────────────────────────────────────────────────────────────

export interface PlanLimits {
  songs: number;
  images: number;
  videos: number;
  bibleVersions: number;
  themes: number;
  lowerThirdThemes: number;
  devices: number;
  credits: number;
  easyWorshipImport: boolean;
  proPresenterImport: boolean;
  massImport: boolean;
  translation: boolean;
  multiview: boolean;
  mobileControl: boolean;
  tickers: boolean;
  speechToScripture: boolean;
  sermonExport: boolean;
  aiFeatures: boolean;
  cloudSync: boolean;
  advancedAnalytics: boolean;
  customReports: boolean;
  apiAccess: boolean;
  presentationMode: boolean;
  teamManagement: boolean;
  campusManagement: boolean;
  unlimitedDevices: boolean;
  unlimitedMultiview: boolean;
  multistream?: boolean;
  multistreamHours?: number;
}

const UNLIMITED = Infinity;

// ── Entitlements → PlanLimits Conversion ─────────────────────────────────────

/**
 * Convert a PlanEntitlements object (from plan_config) into a full PlanLimits.
 * Entitlements use -1 for unlimited; PlanLimits uses Infinity.
 */
function entitlementsToPlanLimits(
  _tier: PlanTier,
  credits: number,
  ent: PlanEntitlements,
): PlanLimits {
  const ul = (v: number) => (v === -1 ? UNLIMITED : v);

  return {
    songs: ul(ent.songs),
    images: ul(ent.images),
    videos: ul(ent.videos),
    themes: ul(ent.themes),
    lowerThirdThemes: ul(ent.lowerThirds),
    devices: ul(ent.devices),
    bibleVersions: ul(ent.bibleVersions),
    credits: credits === -1 ? UNLIMITED : credits,
    easyWorshipImport: ent.easyWorshipImport,
    proPresenterImport: ent.proPresenterImport,
    massImport: ent.massImport,
    translation: ent.translation,
    multiview: ent.multiview,
    mobileControl: ent.mobileControl,
    tickers: ent.tickers,
    speechToScripture: ent.speechToScripture,
    sermonExport: ent.sermonExport,
    aiFeatures: ent.aiFeatures,
    cloudSync: ent.cloudSync,
    advancedAnalytics: ent.advancedAnalytics,
    customReports: ent.customReports,
    presentationMode: ent.presentationMode,
    apiAccess: ent.apiAccess,
    teamManagement: ent.teamManagement,
    campusManagement: ent.campusManagement,
    unlimitedDevices: ent.devices === -1,
    unlimitedMultiview: ent.multiviewTemplates === -1,
    multistream: ent.multistream,
    multistreamHours: ent.multistreamHours,
  };
}

/**
 * Build a full Record<PlanTier, PlanLimits> from a PlanConfig.
 * Uses entitlements from each plan tier. Falls back to free limits
 * if a plan is missing entitlements.
 */
function buildAllLimits(config: PlanConfig): Record<PlanTier, PlanLimits> {
  const result = {} as Record<PlanTier, PlanLimits>;
  for (const tier of ALL_TIERS) {
    const planCfg = config.plans[tier];
    if (planCfg?.entitlements) {
      result[tier] = entitlementsToPlanLimits(tier, planCfg.credits, planCfg.entitlements);
    } else {
      // Plan exists but has no entitlements — give it free-tier limits
      result[tier] = entitlementsToPlanLimits(tier, planCfg?.credits ?? 0, {
        songs: 5, images: 2, videos: 1, themes: 1, lowerThirds: 1, devices: 1, bibleVersions: 4,
        multiviewTemplates: 0, tickerThemes: 0, themePresets: 0, cloudStorageGB: 0,
        multiview: false, tickers: false, massImport: false, easyWorshipImport: false,
        proPresenterImport: false, translation: false, speechToScripture: true,
        sermonExport: false, aiFeatures: false, cloudSync: false, advancedAnalytics: false,
        customReports: false, mobileControl: false, presentationMode: false, apiAccess: false,
        teamManagement: false, campusManagement: false, slideshow: false,
        countdowns: false,
        multistream: false,
        multistreamHours: 0,
      });
    }
  }
  return result;
}

// ── Plan Limits Cache ────────────────────────────────────────────────────────

/**
 * Module-level cache of plan limits built from the plan_config document.
 * Populated from two sources:
 *   1. localStorage cache (synchronous, instant on cold start)
 *   2. Server fetch (async, non-blocking background refresh)
 *
 * The server values always override localStorage when available.
 * This means changing a plan in MongoDB automatically updates all clients
 * on their next app load — no desktop release needed.
 */
let cachedLimits: Record<PlanTier, PlanLimits> | null = null;

/** Dedup concurrent refresh calls. */
let refreshInflight: Promise<void> | null = null;

/**
 * Initialize limits from the localStorage cache (synchronous).
 * Called once on module load. Gives instant access before the async fetch completes.
 */
function initFromCache(): void {
  try {
    const cached = readPlanConfigCache();
    if (cached) {
      cachedLimits = buildAllLimits(cached);
    }
  } catch { /* localStorage unavailable or corrupt — will use server fetch */ }
}

/**
 * Refresh limits from the server (async).
 * Overwrites the localStorage-derived values with fresh server data.
 */
async function refreshFromServer(): Promise<void> {
  try {
    const config = await getPlanConfig();
    cachedLimits = buildAllLimits(config);
  } catch {
    // Offline or fetch failed — localStorage cache remains in effect
  }
}

// Initialize immediately: sync from cache, then refresh from server
initFromCache();
refreshFromServer();

/**
 * Force a re-sync of entitlements from the server.
 * Call after plan upgrades or when stale data is suspected.
 */
export async function refreshEntitlements(): Promise<void> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = refreshFromServer().finally(() => { refreshInflight = null; });
  return refreshInflight;
}

// ── Upgrade info for each feature ────────────────────────────────────────────

export interface RestrictionInfo {
  locked: boolean;
  feature: string;
  currentPlan: PlanTier;
  requiredPlan: PlanTier;
  currentLimit: number;
  message: string;
}

// Cache for the derived feature→tier mapping, rebuilt when config changes.
let _featureRequiredPlan: Record<string, PlanTier> | null = null;
let _featureRequiredPlanConfig: PlanConfig | null = null;

function getFeatureRequiredPlan(config: PlanConfig): Record<string, PlanTier> {
  if (_featureRequiredPlanConfig === config && _featureRequiredPlan) return _featureRequiredPlan;
  _featureRequiredPlanConfig = config;
  _featureRequiredPlan = deriveFeatureRequiredPlan(config);
  return _featureRequiredPlan;
}

/**
 * Get the current feature→tier mapping from the active plan config.
 * Uses the cached limits config if available, otherwise builds from defaults.
 */
function getCurrentFeatureRequiredPlan(): Record<string, PlanTier> {
  const config = readPlanConfigCache() || DEFAULT_PLAN_CONFIG;
  return getFeatureRequiredPlan(config);
}

// ── User State Helpers ───────────────────────────────────────────────────────

/**
 * Returns the effective plan for a user.
 * Priority: full-access key → Subscription cache (offline-aware) → User's plan → "free"
 *
 * If the offline verification window has expired, reverts to "free"
 * regardless of what the cached plan says.
 */
export function getUserPlan(user: AuthUser | null): PlanTier {
  if (!user) return "free";
  const localDevOverride = getLocalDevPlanOverride(user);
  if (localDevOverride) return localDevOverride;

  const normalizedUserPlan = normalizePlanId(user.plan);
  const resolvedUserPlan = resolveCanonicalPlan(user as any);

  if (resolvedUserPlan === "free" && normalizedUserPlan !== "free") {
    return "free";
  }
  if (normalizedUserPlan === "free") {
    return "free";
  }

  const cached = getCachedPlan();
  if (cached && cached !== "free") {
    if (isOfflineValid()) {
      const normalizedCachedPlan = normalizePlanId(cached);
      return normalizedCachedPlan as PlanTier;
    }
  }

  return normalizedUserPlan as PlanTier;
}

const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, growth: 2 };

/** The lower of two plans (unknown names count as Free). */
function lowerPlan(a: PlanTier, b: string): PlanTier {
  const bPlan = normalizePlanId(b) as PlanTier;
  return (PLAN_RANK[a] ?? 0) <= (PLAN_RANK[bPlan] ?? 0) ? a : bPlan;
}

/** Whether the user's trial is currently active. */
export function isInTrial(user: AuthUser | null): boolean {
  const trialActive = isCanonicalTrialActive(user as any);
  if (!trialActive) {
    console.debug("[licenseService] isInTrial=false (endsAt=%s, now=%s)", user?.trial?.endsAt, new Date().toISOString());
  }
  return trialActive;
}

/** Whether the user's trial has expired (had a trial, but it's past end date). */
export function isTrialExpired(user: AuthUser | null): boolean {
  if (!user?.trial?.endsAt) return false;
  return Date.now() >= new Date(user.trial.endsAt).getTime();
}

/** Days remaining in trial, or 0 if expired/not in trial. */
export function getTrialDaysRemaining(user: AuthUser | null): number {
  if (!isInTrial(user)) return 0;
  const end = new Date(user!.trial!.endsAt!).getTime();
  const remaining = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, remaining);
}

/**
 * Returns the effective plan considering trial status and subscription cache.
 * During trial, user behaves like Growth.
 * If offline window expired, reverts to free regardless of cached plan.
 */
export function getEffectivePlan(user: AuthUser | null): PlanTier {
  if (!user) return "free";
  const localDevOverride = getLocalDevPlanOverride(user);
  if (localDevOverride) {
    console.debug("[licenseService] local development plan override=%s", localDevOverride);
    return localDevOverride;
  }

  const userPlan = getUserPlan(user);
  const resolved = userPlan !== "free" ? normalizePlanId(userPlan) : resolveCanonicalPlan({ ...user, plan: userPlan });
  // On production builds the plan and the admin flag come from the server-signed
  // licence. The user object is kept in localStorage and can be edited, so it can
  // only lower the plan, never raise it. Before the first licence check finishes,
  // and on dev builds, the user object is used as before.
  const cap = getVerifiedPlanCap();
  const isAdminUser = cap.active
    ? cap.isAdmin
    : String(user.role || "").toLowerCase() === "admin";
  const cappedResolved: PlanTier = cap.active && !isAdminUser
    ? (cap.known ? lowerPlan(resolved, cap.plan) : "free")
    : resolved;
  // Offline rules: Free once the paid period ends (even offline) or after 21 days without a sync.
  const plan = isAdminUser
    ? cappedResolved
    : (capPlanForOffline(cappedResolved, getOfflineEntitlementState()) as PlanTier);
  console.debug(
    "[licenseService] getEffectivePlan=%s (user.plan=%s, trial.active=%s, trial.status=%s, trial.endsAt=%s)",
    plan, user.plan, user.trial?.active, user.trial?.status, user.trial?.endsAt,
  );
  return plan;
}

/**
 * Get limits for a plan tier. Reads from the plan_config-sourced cache.
 * Falls back to DEFAULT_PLAN_CONFIG-derived limits if the cache hasn't loaded yet.
 */
let fallbackLimits: Record<PlanTier, PlanLimits> | null = null;

export function getPlanLimits(plan: PlanTier): PlanLimits {
  const normalizedPlan = normalizePlanId(plan) as PlanTier;
  if (cachedLimits) return cachedLimits[normalizedPlan] || cachedLimits.free;
  // Should only happen in the brief window before initFromCache runs.
  // Build fallback from DEFAULT_PLAN_CONFIG so every tier gets correct limits.
  if (!fallbackLimits) fallbackLimits = buildAllLimits(DEFAULT_PLAN_CONFIG);
  return fallbackLimits[normalizedPlan] || fallbackLimits.free;
}

/** Get limits for a user (considering trial and full-access key). */
export function getUserPlanLimits(user: AuthUser | null): PlanLimits {
  return getPlanLimits(getEffectivePlan(user));
}

// ── Feature Checks (sync) ────────────────────────────────────────────────────

export function canUseImport(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).massImport;
}

export function canUseEasyWorshipImport(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).easyWorshipImport;
}

export function canUseProPresenterImport(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).proPresenterImport;
}

export function canUseMassImport(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).massImport;
}

export function canUseTranslation(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).translation;
}

export function canUseMultiview(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).multiview;
}

export function canUseMobileControl(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).mobileControl;
}

export function canUsePresentationMode(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).presentationMode;
}

export function canUseTickers(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).tickers;
}

export function canUseSpeechToScripture(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).speechToScripture;
}

export function canUseSermonExport(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).sermonExport;
}

export function canUseAI(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).aiFeatures;
}

export function canUseCloudFeatures(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).cloudSync;
}

export const canUseCloudSync = canUseCloudFeatures;

export function canUseAdvancedAnalytics(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).advancedAnalytics;
}

export function canUseCustomReports(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).customReports;
}

export function canUseApiAccess(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).apiAccess;
}

export function canUseTeamManagement(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).teamManagement;
}

export function canUseCampusManagement(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).campusManagement;
}

export function canUseUnlimitedDevices(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).unlimitedDevices;
}

export function canUseUnlimitedMultiview(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).unlimitedMultiview;
}

export function canUseMultistream(user: AuthUser | null): boolean {
  return getUserPlanLimits(user).multistream ?? false;
}

export function getMultistreamHoursLimit(user: AuthUser | null): number {
  return getUserPlanLimits(user).multistreamHours ?? 0;
}

// ── Resource Checks (async — count from IndexedDB) ───────────────────────────

async function countSongs(): Promise<number> {
  try {
    const { countSongs: count } = await import("../worship/worshipDb");
    return count();
  } catch { return 0; }
}

async function countMedia(type: "image" | "video"): Promise<number> {
  try {
    const { getAllMedia } = await import("../library/libraryDb");
    const all = await getAllMedia();
    return all.filter((m) => m.type === type).length;
  } catch { return 0; }
}

async function countBibleVersions(): Promise<number> {
  try {
    const { getInstalledTranslations } = await import("../bible/bibleDb");
    const installed = await getInstalledTranslations();
    return installed.length;
  } catch { return 0; }
}

async function countThemes(): Promise<number> {
  try {
    const { getCustomThemes } = await import("../bible/bibleDb");
    const themes = await getCustomThemes();
    return themes.filter((t) => t.templateType === "fullscreen").length;
  } catch { return 0; }
}

async function countLowerThirdThemes(): Promise<number> {
  try {
    const { getCustomThemes } = await import("../bible/bibleDb");
    const themes = await getCustomThemes();
    return themes.filter((t) => t.templateType === "lower-third" || t.templateType === "side-by-side").length;
  } catch { return 0; }
}

function isUnlimited(limit: number): boolean {
  return limit === Infinity || limit === -1;
}

// ── Resource Permission Checks ───────────────────────────────────────────────

export async function canCreateSong(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.songs)) return true;
  const current = await countSongs();
  return current < limits.songs;
}

export async function canUploadImage(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.images)) return true;
  const current = await countMedia("image");
  return current < limits.images;
}

export async function canUploadVideo(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.videos)) return true;
  const current = await countMedia("video");
  return current < limits.videos;
}

export async function canAddBibleVersion(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.bibleVersions)) return true;
  const current = await countBibleVersions();
  return current < limits.bibleVersions;
}

export async function canCreateTheme(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.themes)) return true;
  const current = await countThemes();
  return current < limits.themes;
}

export async function canCreateLowerThirdTheme(user: AuthUser | null): Promise<boolean> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.lowerThirdThemes)) return true;
  const current = await countLowerThirdThemes();
  return current < limits.lowerThirdThemes;
}

export function canAddDevice(user: AuthUser | null, currentDeviceCount: number): boolean {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.devices)) return true;
  return currentDeviceCount < limits.devices;
}

export function getRemainingDeviceSlots(user: AuthUser | null, currentDeviceCount: number): number {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.devices)) return Infinity;
  return Math.max(0, limits.devices - currentDeviceCount);
}

/**
 * Downgrade protection: returns warnings when the user's current usage
 * exceeds their plan limits. Used when a user downgrades from a higher plan
 * (e.g. Growth → Basic) and has more resources than the lower plan allows.
 *
 * Does NOT delete data. Only blocks adding new resources.
 */
export function getDowngradeWarnings(
  user: AuthUser | null,
  usage: {
    devices?: number;
    songs?: number;
    images?: number;
    videos?: number;
    themes?: number;
    bibleVersions?: number;
    lowerThirdThemes?: number;
  },
): { message: string; feature: string; requiredPlan: PlanTier }[] {
  const plan = getEffectivePlan(user);
  const limits = getPlanLimits(plan);
  const warnings: { message: string; feature: string; requiredPlan: PlanTier }[] = [];

  const resourceChecks: [keyof typeof usage, keyof PlanLimits, string, PlanTier][] = [
    ["songs", "songs", "Songs", "basic"],
    ["images", "images", "Images", "basic"],
    ["videos", "videos", "Videos", "basic"],
    ["bibleVersions", "bibleVersions", "Bible Versions", "basic"],
    ["themes", "themes", "Themes", "basic"],
    ["lowerThirdThemes", "lowerThirdThemes", "Lower Third Themes", "basic"],
    ["devices", "devices", "Devices", "growth"],
  ];

  for (const [usageKey, limitKey, label, requiredPlan] of resourceChecks) {
    const count = usage[usageKey];
    const limit = limits[limitKey];
    if (count !== undefined && typeof limit === "number" && !isUnlimited(limit) && count > limit) {
      warnings.push({
        message: `${label} limit exceeded (${count}/${limit}). Upgrade to ${capitalize(requiredPlan)} to continue.`,
        feature: usageKey as string,
        requiredPlan,
      });
    }
  }

  return warnings;
}

// ── Remaining Slots ──────────────────────────────────────────────────────────

export async function getRemainingSongSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.songs)) return Infinity;
  const current = await countSongs();
  return Math.max(0, limits.songs - current);
}

export async function getRemainingImageSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.images)) return Infinity;
  const current = await countMedia("image");
  return Math.max(0, limits.images - current);
}

export async function getRemainingVideoSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.videos)) return Infinity;
  const current = await countMedia("video");
  return Math.max(0, limits.videos - current);
}

export async function getRemainingBibleSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.bibleVersions)) return Infinity;
  const current = await countBibleVersions();
  return Math.max(0, limits.bibleVersions - current);
}

export async function getRemainingThemeSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.themes)) return Infinity;
  const current = await countThemes();
  return Math.max(0, limits.themes - current);
}

export async function getRemainingLTThemeSlots(user: AuthUser | null): Promise<number> {
  const limits = getUserPlanLimits(user);
  if (isUnlimited(limits.lowerThirdThemes)) return Infinity;
  const current = await countLowerThirdThemes();
  return Math.max(0, limits.lowerThirdThemes - current);
}

// ── Restriction Info (for upgrade modal) ─────────────────────────────────────

const PLAN_ORDER: Record<string, number> = {
  free: 0,
  basic: 1,
  growth: 2,
  pro: 2,
};

function planAtLeast(plan: PlanTier, minimum: PlanTier): boolean {
  return (PLAN_ORDER[plan] ?? 0) >= (PLAN_ORDER[minimum] ?? 0);
}

export function getRestrictionInfo(
  user: AuthUser | null,
  feature: string,
): RestrictionInfo {
  const effectivePlan = getEffectivePlan(user);
  const limits = getPlanLimits(effectivePlan);

  const featureRequiredPlan = getCurrentFeatureRequiredPlan();
  const required = (featureRequiredPlan[feature] || "basic") as PlanTier;
  const label = FEATURE_LABELS[feature] || feature;

  const limitsAny = limits as unknown as Record<string, number | boolean>;
  const limitValue = limitsAny[feature];

  let locked = false;
  let currentLimit = 0;

  if (typeof limitValue === "boolean") {
    locked = !limitValue;
    currentLimit = limitValue ? -1 : 0;
  } else if (typeof limitValue === "number") {
    currentLimit = limitValue;
    locked = isUnlimited(limitValue) ? false : limitValue === 0;
    if (!locked && effectivePlan === "free") {
      locked = true;
    }
  }

  // Safety net: if the user's effective plan already meets or exceeds
  // the required plan, never lock — regardless of what the config says.
  // This prevents misconfigured plan_config documents from locking out
  // entitled users after plan refresh or trial resolution.
  if (locked && planAtLeast(effectivePlan, required)) {
    console.info(
      `[access] ${label}: plan "${effectivePlan}" >= required "${required}" — overriding lock`,
    );
    locked = false;
  }

  const inTrial = isInTrial(user);
  console.info(
    `[access] ${label}: plan=${effectivePlan}${inTrial ? " (trial active)" : ""} required=${required} locked=${locked} limit=${typeof limitValue === "boolean" ? limitValue : limitValue}`,
  );

  return {
    locked,
    feature: label,
    currentPlan: effectivePlan,
    requiredPlan: required,
    currentLimit,
    message: locked
      ? `${label} requires ${capitalize(required)} plan or higher.`
      : "",
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Offline Status ───────────────────────────────────────────────────────────

export interface OfflineStatus {
  valid: boolean;
  daysRemaining: number;
  requiresVerification: boolean;
}

export function getOfflineStatus(): OfflineStatus {
  const valid = isOfflineValid();
  const daysRemaining = getOfflineDaysRemaining();
  return {
    valid,
    daysRemaining,
    requiresVerification: !valid && daysRemaining === 0,
  };
}

export function isSubscriptionValid(): boolean {
  return isOfflineValid();
}
