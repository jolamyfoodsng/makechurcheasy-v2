/**
 * planLimits.ts — Fallback plan limits configuration.
 *
 * DEPRECATED: Prefer reading limits from getPlanConfig() in db.ts.
 * These are kept as fallback defaults only. The DB is the source of truth.
 *
 * Every API route MUST use getPlanConfig() instead of hardcoding limits.
 * These values are retained for backward compatibility with callers that
 * have not yet been migrated.
 */

import type { EffectivePlan } from "./trial";

export interface PlanLimits {
  /** Max devices (-1 = unlimited) */
  devices: number;
  /** Max songs */
  songs: number;
  /** Max images */
  images: number;
  /** Max videos */
  videos: number;
  /** Max themes */
  themes: number;
  /** Max lower-third themes */
  lowerThirds: number;
  /** Max Bible versions */
  bibleVersions: number;
  /** Max multiview templates */
  multiviewTemplates: number;
  /** Max ticker themes */
  tickerThemes: number;
  /** Max theme presets */
  themePresets: number;
  /** Max cloud storage in GB */
  cloudStorageGB: number;
  /** Monthly credits (-1 = unlimited) */
  credits: number;

  // Boolean feature gates
  multiview: boolean;
  tickers: boolean;
  massImport: boolean;
  easyWorshipImport: boolean;
  proPresenterImport: boolean;
  translation: boolean;
  speechToScripture: boolean;
  sermonExport: boolean;
  aiFeatures: boolean;
  cloudSync: boolean;
  advancedAnalytics: boolean;
  customReports: boolean;
  mobileControl: boolean;
  apiAccess: boolean;
  teamManagement: boolean;
  campusManagement: boolean;
  slideshow: boolean;
  countdowns: boolean;
  multistream: boolean;
  multistreamHours: number;
}

const UNLIMITED = -1;

/**
 * DEPRECATED: Fallback plan limits — DB is the source of truth.
 * Retained for backward compatibility. New code should use getPlanConfig().
 */
export const DEFAULT_PLAN_LIMITS: Record<EffectivePlan, PlanLimits> = {
  trial: {
    devices: 10,
    songs: UNLIMITED,
    images: UNLIMITED,
    videos: UNLIMITED,
    themes: UNLIMITED,
    lowerThirds: UNLIMITED,
    bibleVersions: UNLIMITED,
    multiviewTemplates: UNLIMITED,
    tickerThemes: UNLIMITED,
    themePresets: UNLIMITED,
    cloudStorageGB: 5,
    credits: 500,
    multiview: true,
    tickers: false,
    massImport: true,
    easyWorshipImport: false,
    proPresenterImport: true,
    translation: true,
    speechToScripture: true,
    sermonExport: true,
    aiFeatures: true,
    cloudSync: true,
    advancedAnalytics: true,
    customReports: true,
    mobileControl: false,
    apiAccess: false,
    teamManagement: false,
    campusManagement: false,
    slideshow: true,
    countdowns: true,
    multistream: true,
    multistreamHours: 20,
  },

  free: {
    devices: 1,
    songs: 5,
    images: 2,
    videos: 2,
    themes: 2,
    lowerThirds: 3,
    bibleVersions: 3,
    multiviewTemplates: 0,
    tickerThemes: 3,
    themePresets: 0,
    cloudStorageGB: 0.5,
    credits: 25,
    multiview: false,
    tickers: false,
    massImport: false,
    easyWorshipImport: false,
    proPresenterImport: false,
    translation: false,
    speechToScripture: true,
    sermonExport: false,
    aiFeatures: false,
    cloudSync: false,
    advancedAnalytics: false,
    customReports: false,
    mobileControl: false,
    apiAccess: false,
    teamManagement: false,
    campusManagement: false,
    slideshow: false,
    countdowns: false,
    multistream: false,
    multistreamHours: 0,
  },

  basic: {
    devices: 3,
    songs: UNLIMITED,
    images: UNLIMITED,
    videos: UNLIMITED,
    themes: 10,
    lowerThirds: 15,
    bibleVersions: UNLIMITED,
    multiviewTemplates: 5,
    tickerThemes: UNLIMITED,
    themePresets: 2,
    cloudStorageGB: 5,
    credits: 100,
    multiview: true,
    tickers: true,
    massImport: true,
    easyWorshipImport: true,
    proPresenterImport: true,
    translation: false,
    speechToScripture: true,
    sermonExport: false,
    aiFeatures: false,
    cloudSync: true,
    advancedAnalytics: false,
    customReports: false,
    mobileControl: false,
    apiAccess: false,
    teamManagement: false,
    campusManagement: false,
    slideshow: true,
    countdowns: false,
    multistream: true,
    multistreamHours: 10,
  },

  growth: {
    devices: 10,
    songs: UNLIMITED,
    images: UNLIMITED,
    videos: UNLIMITED,
    themes: UNLIMITED,
    lowerThirds: UNLIMITED,
    bibleVersions: UNLIMITED,
    multiviewTemplates: UNLIMITED,
    tickerThemes: UNLIMITED,
    themePresets: UNLIMITED,
    cloudStorageGB: 20,
    credits: UNLIMITED,
    multiview: true,
    tickers: true,
    massImport: true,
    easyWorshipImport: true,
    proPresenterImport: true,
    translation: true,
    speechToScripture: true,
    sermonExport: true,
    aiFeatures: true,
    cloudSync: true,
    advancedAnalytics: true,
    customReports: true,
    mobileControl: true,
    apiAccess: true,
    teamManagement: true,
    campusManagement: false,
    slideshow: true,
    countdowns: true,
    multistream: true,
    multistreamHours: 20,
  },

};

/**
 * Get limits for a plan tier. Falls back to free limits for unknown tiers.
 * DEPRECATED: Prefer getPlanConfig() which reads from DB.
 */
export function getLimitsForPlan(plan: EffectivePlan): PlanLimits {
  if ((plan as string) === "pro") return { ...DEFAULT_PLAN_LIMITS.growth, multistreamHours: 40 };
  return DEFAULT_PLAN_LIMITS[plan] || DEFAULT_PLAN_LIMITS.free;
}

/** Check if a numeric limit is unlimited (-1). */
export function isUnlimited(limit: number): boolean {
  return limit === -1 || limit === Infinity;
}

/**
 * Backward-compatible export — existing callers import PLAN_LIMITS.
 * New code should use getPlanConfig() instead.
 */
export const PLAN_LIMITS = DEFAULT_PLAN_LIMITS;
