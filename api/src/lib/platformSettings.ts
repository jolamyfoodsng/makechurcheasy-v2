/**
 * platformSettings.ts — Unified platform settings service.
 *
 * Stores all admin configuration in a single `platform_settings` document.
 * Each section is saved independently via $set on its key.
 */

import clientPromise from "./mongodb";
import {
  DEFAULT_EMAIL_BRANDING,
  type EmailBrandingSettings,
} from "./emailBrandingDefaults";
import { DEFAULT_SUPPORT_CONTENT, normalizeSupportContent, type SupportContent } from "./supportContent";

const COLLECTION = "platform_settings";
const DOC_ID = "platform_settings";

// In-memory cache with 60s TTL — avoids DB hit on every request
let _cache: { doc: PlatformSettings; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidatePlatformSettingsCache() {
  _cache = null;
}

export type PaymentProviderKey = "flutterwave" | "mtnMomo" | "nowpayments";
export type FeatureSwitchKey =
  | "speechToScripture"
  | "liveTranslation"
  | "mobileRemote"
  | "multistream"
  | "presentationLink";

export interface AdminControls {
  /** Turn each checkout provider on/off (on top of system.allowPayments). */
  paymentProviders: Record<PaymentProviderKey, boolean>;
  /** Emergency off switches. false = feature turned off for everyone. */
  features: Record<FeatureSwitchKey, boolean>;
  speech: {
    /** AssemblyAI realtime model used for Speech-to-Scripture. */
    model: "universal-streaming-english" | "universal-streaming-multilingual";
    /**
     * Fair-use cap: max Speech-to-Scripture minutes per day for trial and paid users.
     * 0 = no cap. Free users use transcriptionPricing.freeDailyMinutes (Admin → Credits).
     */
    dailyMinutesCap: number;
  };
  signup: {
    /** Max new accounts from one IP address in 24 hours. 0 = no limit. */
    maxSignupsPerIpPerDay: number;
    /** Max new accounts from one device in 24 hours (needs device id). 0 = no limit. */
    maxSignupsPerDevicePerDay: number;
    blockDisposableEmails: boolean;
    /** Extra blocked email domains, e.g. "tempmail.dev". */
    blockedDomains: string[];
  };
  /** The desktop app's Support window (see supportContent.ts). */
  support: SupportContent;
}

export const DEFAULT_ADMIN_CONTROLS: AdminControls = {
  paymentProviders: { flutterwave: true, mtnMomo: true, nowpayments: true },
  features: {
    speechToScripture: true,
    liveTranslation: true,
    mobileRemote: true,
    multistream: true,
    presentationLink: true,
  },
  speech: { model: "universal-streaming-english", dailyMinutesCap: 0 },
  signup: { maxSignupsPerIpPerDay: 5, maxSignupsPerDevicePerDay: 2, blockDisposableEmails: true, blockedDomains: [] },
  support: DEFAULT_SUPPORT_CONTENT,
};

export interface PlatformSettings {
  _id?: string;
  appUpdates: {
    forceUpdatesEnabled: boolean;
    emergencyLock: boolean;
    emergencyLockDelay: number;
    latestVersion: string;
    minimumSupportedVersion: string;
    gracePeriodHours: number;
    updateMessage: string;
    emergencyLockMessage: string;
    windowsDownloadUrl: string;
    macDownloadUrl: string;
    linuxDownloadUrl: string;
    releaseNotesUrl: string;
    policyPublishedAt: string;
    /**
     * When the current forced-update policy started. Server-managed: reset only
     * when forceUpdatesEnabled, minimumSupportedVersion or gracePeriodHours
     * change, never by editing messages or links. The grace countdown and the
     * server-side gate both anchor to this so every client agrees on the
     * deadline.
     */
    enforcementStartedAt: string | null;
    emergencyLockEnabledAt: string | null;
    emergencyLockEffectiveAt: string | null;
  };
  trial: {
    enabled: boolean;
    defaultDurationDays: number;
    sendExtensionEmails: boolean;
    sendRestartEmails: boolean;
    sendStopEmails: boolean;
  };
  credits: {
    freePlanCredits: number;
    trialCredits: number;
    basicCredits: number;
    growthCredits: number;
    proCredits: number;
    translationCost: number;
    speechToScriptureCost: number;
    aiSummaryCost: number;
  };
  transcriptionPricing: {
    providerCostPerHourUSD: number;
    profitPerHourNGN: number;
    freeDailyMinutes: number;
    freeWeeklyMinutes: number;
    sellingPricePerHourNGN?: number;
    sellingPricePerHourUSD?: number;
    tierPackages: Array<{
      id: string;
      hours: number;
      badge?: string;
      description: string;
      customPriceNGN?: number;
      customPriceUSD?: number;
    }>;
    planIncludedHours: {
      free: number;
      trial: number;
      basic: number;
      growth: number;
      pro: number;
      ambassador: number;
    };
  };
  ambassador: {
    enabled: boolean;
    creditsPerAmbassador: number;
    defaultAmbassadorDurationDays: number;
    autoExpiry: boolean;
    sendWelcomeEmail: boolean;
    badgeText: string;
  };
  earlyAccess: {
    enabled: boolean;
    offerName: string;
    description: string;
    plan: "growth";
    priceNGN: number;
    priceUSD: number;
    allowRegistrationDateEligibility: boolean;
    registeredAfter: string;
    registeredBefore: string;
    eligibleUserIds: string[];
    eligibleEmails: string[];
  };
  authentication: {
    maxDevicesPerUser: number;
  };
  obs: {
    enableOBSIntegration: boolean;
    requireOBSAuthentication: boolean;
    allowAutoDiscovery: boolean;
    enableOBSDock: boolean;
    enableMultiview: boolean;
    minSupportedOBSVersion: string;
    minSupportedWebSocketVersion: string;
    websocketPort: number;
    autoDetect: boolean;
    reconnectIntervalMs: number;
    tutorialVideoUrl?: string;
  };
  ai: {
    featureToggles: {
      scriptureTranslation: boolean;
      speechToScripture: boolean;
      aiSummaries: boolean;
      sermonNotes: boolean;
      aiAssistant: boolean;
    };
    provider: string;
    dailyRequestLimit: number;
    maximumTranslationMinutes: number;
    supportedLanguages: string[];
  };
  notifications: {
    welcomeEmail: boolean;
    trialExpiryReminder: boolean;
    paymentReminder: boolean;
    securityAlerts: boolean;
    featureAnnouncements: boolean;
    creditLowBalance: boolean;
    weeklyDigest: boolean;
  };
  emailBranding: EmailBrandingSettings;
  storage: {
    enableCloudSync: boolean;
    maxUploadSizeMB: number;
    allowedFileTypes: string;
    compressionEnabled: boolean;
    defaultQuotaGB: number;
    retentionDays: number;
    maximumBackgroundVideoSizeMB: number;
    churchLogoSizeLimitMB: number;
    mediaLibraryQuotaGB: number;
    imageTargetSizeBytes: number;
    videoTargetSizeBytes: number;
    imageMaxDimension: number;
    videoMaxWidth: number;
    allowedImageExtensions: string[];
    allowedVideoExtensions: string[];
  };
  security: {
    maintenanceMode: boolean;
    /** Shown to users while maintenance mode is on (login screen + lock screen). */
    maintenanceMessage: string;
    internetVerificationEnabled: boolean;
    maxOfflineDays: number;
    verificationIntervalHours: number;
  };
  system: {
    allowRegistrations: boolean;
    allowPayments: boolean;
  };
  featureFlags: {
    remotePresentationBeta: boolean;
    cloudSyncBeta: boolean;
    newTranslationEngine: boolean;
    newMobileApp: boolean;
  };
  /** Admin → Settings → Controls (added 2026-10-10). */
  controls: AdminControls;
  themes: {
    defaultBibleTheme: string;
    defaultWorshipTheme: string;
    defaultLowerThirdTheme: string;
    defaultAnnouncementTheme: string;
    defaultFont: string;
    defaultBrandColours: {
      primary: string;
      secondary: string;
      accent: string;
    };
    bibleDefaults: {
      font: string;
      textSize: number;
      textColor: string;
      backgroundColor: string;
      accentColor: string;
    };
    worshipDefaults: {
      font: string;
      textSize: number;
      textColor: string;
      backgroundColor: string;
      animationEnabled: boolean;
    };
    lowerThirdDefaults: {
      nameColor: string;
      titleColor: string;
      backgroundColor: string;
      nameSize: number;
    };
  };
  analytics: {
    usageAnalytics: boolean;
    crashReporting: boolean;
    errorTracking: boolean;
    performanceMonitoring: boolean;
  };
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULTS: Omit<PlatformSettings, "_id" | "updatedAt" | "updatedBy"> = {
  appUpdates: {
    forceUpdatesEnabled: false,
    emergencyLock: false,
    emergencyLockDelay: 0,
    latestVersion: "2.6.0",
    minimumSupportedVersion: "2.0.0",
    gracePeriodHours: 48,
    updateMessage: "A new version is available. Please update to continue.",
    emergencyLockMessage: "MakeChurchEazy is temporarily unavailable due to emergency maintenance.",
    windowsDownloadUrl: "",
    macDownloadUrl: "",
    linuxDownloadUrl: "",
    releaseNotesUrl: "",
    policyPublishedAt: new Date(0).toISOString(),
    enforcementStartedAt: null,
    emergencyLockEnabledAt: null,
    emergencyLockEffectiveAt: null,
  },
  trial: {
    enabled: true,
    defaultDurationDays: 30,
    sendExtensionEmails: true,
    sendRestartEmails: true,
    sendStopEmails: true,
  },
  credits: {
    freePlanCredits: 50,
    trialCredits: 500,
    basicCredits: 50,
    growthCredits: 2000,
    proCredits: -1,
    translationCost: 1,
    speechToScriptureCost: 2,
    aiSummaryCost: 3,
  },
  transcriptionPricing: {
    providerCostPerHourUSD: 0.027,
    profitPerHourNGN: 40,
    freeDailyMinutes: 15,
    freeWeeklyMinutes: 60,
    tierPackages: [
      { id: "topup-1h", hours: 1, badge: "", description: "Quick top-up for a single service or practice run." },
      { id: "topup-5h", hours: 5, badge: "", description: "Ideal for a full weekend of Sunday services." },
      { id: "topup-10h", hours: 10, badge: "Popular", description: "Best for active ministries running multiple weekly meetings." },
      { id: "topup-20h", hours: 20, badge: "", description: "Extended coverage for monthly conferences and youth camps." },
      { id: "topup-50h", hours: 50, badge: "Best Value", description: "Maximum savings for large productions and multi-campus events." },
    ],
    planIncludedHours: {
      free: 0,
      trial: 5,
      basic: 12,
      growth: 30,
      pro: 30,
      ambassador: 30,
    },
  },
  ambassador: {
    enabled: true,
    creditsPerAmbassador: 1000,
    defaultAmbassadorDurationDays: 30,
    autoExpiry: true,
    sendWelcomeEmail: true,
    badgeText: "Ambassador",
  },
  earlyAccess: {
    enabled: false,
    offerName: "Early Access Lifetime",
    description: "One-time lifetime Growth access for selected early users.",
    plan: "growth",
    priceNGN: 50000,
    priceUSD: 99,
    allowRegistrationDateEligibility: true,
    registeredAfter: "",
    registeredBefore: "",
    eligibleUserIds: [],
    eligibleEmails: [],
  },
  authentication: {
    maxDevicesPerUser: 3,
  },
  obs: {
    enableOBSIntegration: true,
    requireOBSAuthentication: false,
    allowAutoDiscovery: true,
    enableOBSDock: true,
    enableMultiview: true,
    minSupportedOBSVersion: "28.0.0",
    minSupportedWebSocketVersion: "5.0.0",
    websocketPort: 4455,
    autoDetect: true,
    reconnectIntervalMs: 3000,
    tutorialVideoUrl: "https://www.youtube.com/watch?v=makechurcheasy-obs-dock",
  },
  ai: {
    featureToggles: {
      scriptureTranslation: true,
      speechToScripture: true,
      aiSummaries: true,
      sermonNotes: false,
      aiAssistant: true,
    },
    provider: "openai",
    dailyRequestLimit: 100,
    maximumTranslationMinutes: 60,
    supportedLanguages: ["en", "es", "fr", "de", "pt", "zh", "ja", "ko", "ar", "hi"],
  },
  notifications: {
    welcomeEmail: true,
    trialExpiryReminder: true,
    paymentReminder: true,
    securityAlerts: true,
    featureAnnouncements: true,
    creditLowBalance: true,
    weeklyDigest: false,
  },
  emailBranding: DEFAULT_EMAIL_BRANDING,
  storage: {
    enableCloudSync: true,
    maxUploadSizeMB: 50,
    allowedFileTypes: "jpg,png,gif,mp4,pdf,docx",
    compressionEnabled: true,
    defaultQuotaGB: 5,
    retentionDays: 365,
    maximumBackgroundVideoSizeMB: 500,
    churchLogoSizeLimitMB: 5,
    mediaLibraryQuotaGB: 10,
    imageTargetSizeBytes: 1024 * 1024,
    videoTargetSizeBytes: 1024 * 1024,
    imageMaxDimension: 1920,
    videoMaxWidth: 854,
    allowedImageExtensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
    allowedVideoExtensions: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv"],
  },
  security: {
    maintenanceMode: false,
    maintenanceMessage: "MakeChurchEazy is under scheduled maintenance. We'll be back shortly.",
    internetVerificationEnabled: false,
    maxOfflineDays: 28,
    verificationIntervalHours: 6,
  },
  system: {
    allowRegistrations: true,
    allowPayments: true,
  },
  featureFlags: {
    remotePresentationBeta: false,
    cloudSyncBeta: false,
    newTranslationEngine: false,
    newMobileApp: false,
  },
  controls: DEFAULT_ADMIN_CONTROLS,
  themes: {
    defaultBibleTheme: "",
    defaultWorshipTheme: "",
    defaultLowerThirdTheme: "",
    defaultAnnouncementTheme: "",
    defaultFont: "CMG Sans Black",
    defaultBrandColours: {
      primary: "#3b82f6",
      secondary: "#6366f1",
      accent: "#8b5cf6",
    },
    bibleDefaults: {
      font: "CMG Sans Black",
      textSize: 48,
      textColor: "#ffffff",
      backgroundColor: "#000000",
      accentColor: "#3b82f6",
    },
    worshipDefaults: {
      font: "CMG Sans Black",
      textSize: 64,
      textColor: "#ffffff",
      backgroundColor: "#000000",
      animationEnabled: true,
    },
    lowerThirdDefaults: {
      nameColor: "#ffffff",
      titleColor: "#a3a3a3",
      backgroundColor: "#000000",
      nameSize: 36,
    },
  },
  analytics: {
    usageAnalytics: true,
    crashReporting: true,
    errorTracking: true,
    performanceMonitoring: false,
  },
};

type SectionKey = keyof Omit<PlatformSettings, "_id" | "updatedAt" | "updatedBy">;

/**
 * Deep-merge a stored section with its defaults.
 * Ensures any missing nested fields (e.g. ai.featureToggles) are filled in
 * from defaults, handling schema migrations gracefully.
 */
function mergeSectionDefaults<T extends Record<string, unknown>>(
  stored: Partial<T> | undefined | null,
  defaults: T,
): T {
  if (!stored) return defaults;
  const result: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const defaultVal = (defaults as Record<string, unknown>)[key];
    const storedVal = (stored as Record<string, unknown>)[key];
    if (
      storedVal !== undefined &&
      storedVal !== null &&
      typeof defaultVal === "object" &&
      !Array.isArray(defaultVal) &&
      typeof storedVal === "object" &&
      !Array.isArray(storedVal)
    ) {
      // Both are plain objects — recurse
      result[key] = mergeSectionDefaults(
        storedVal as Record<string, unknown>,
        defaultVal as Record<string, unknown>,
      );
    } else if (storedVal !== undefined) {
      result[key] = storedVal;
    }
    // If storedVal is undefined, keep the default
  }
  return result as T;
}

/**
 * Get all platform settings. Seeds defaults if document doesn't exist.
 * Deep-merges each section with defaults to handle schema migrations.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  if (_cache && (Date.now() - _cache.ts) < CACHE_TTL_MS) {
    return _cache.doc;
  }

  const client = await clientPromise;
  const db = client.db();

  let doc = await db
    .collection<PlatformSettings>(COLLECTION)
    .findOne({ _id: DOC_ID as any }) as PlatformSettings | null;

  if (!doc) {
    const seed: PlatformSettings = {
      ...DEFAULTS,
      _id: DOC_ID as any,
      updatedAt: new Date().toISOString(),
    };
    await db
      .collection<PlatformSettings>(COLLECTION)
      .updateOne({ _id: DOC_ID as any }, { $set: seed }, { upsert: true });
    doc = seed;
  }

  // Migrate existing installations from the previous 14-day default once.
  // A version marker lets admins change the duration again after this rollout.
  if (Number((doc as any).trialDurationMigrationVersion || 0) < 1) {
    const migratedAt = new Date().toISOString();
    await db.collection<PlatformSettings>(COLLECTION).updateOne(
      { _id: DOC_ID as any },
      {
        $set: {
          "trial.defaultDurationDays": 30,
          trialDurationMigrationVersion: 1,
          updatedAt: migratedAt,
        },
      },
    );
    await db.collection("trial_settings").updateOne(
      { _id: "default" as any },
      { $set: { defaultDurationDays: 30, updatedAt: migratedAt } },
      { upsert: true },
    );
    doc = {
      ...doc,
      trial: { ...doc.trial, defaultDurationDays: 30 },
      updatedAt: migratedAt,
    } as PlatformSettings;
    (doc as any).trialDurationMigrationVersion = 1;
  }

  // Deep-merge each section with defaults to fill in any missing fields
  // from schema changes (e.g. old flat ai → new ai.featureToggles)
  const sections = Object.keys(DEFAULTS) as SectionKey[];
  const merged = { ...doc };
  const docRecord = doc as unknown as Record<string, unknown>;
  const defaultsRecord = DEFAULTS as unknown as Record<string, unknown>;
  for (const section of sections) {
    (merged as Record<string, unknown>)[section] = mergeSectionDefaults(
      docRecord[section] as Record<string, unknown>,
      defaultsRecord[section] as Record<string, unknown>,
    );
  }

  // The Support window is cleaned as a whole (not merged field by field): settings saved before
  // the Support editor existed only have three links, and those are kept in the default channels.
  const storedControls = docRecord.controls as Record<string, unknown> | undefined;
  merged.controls = {
    ...(merged.controls ?? DEFAULT_ADMIN_CONTROLS),
    support: normalizeSupportContent(storedControls?.support),
  };

  _cache = { doc: merged, ts: Date.now() };
  return merged;
}

/**
 * Update a single section of platform settings.
 * Only $sets the specified section key without touching others.
 *
 * When the "trial" section is updated, overlapping fields are also synced
 * to the `trial_settings` collection so that trial creation/management
 * logic reads the same values the admin configured.
 */
export async function updatePlatformSection(
  section: SectionKey,
  data: Record<string, unknown>,
  updatedBy?: string
): Promise<PlatformSettings> {
  const client = await clientPromise;
  const db = client.db();
  const nowIso = new Date().toISOString();
  const currentSettings = section === "appUpdates"
    ? await db
      .collection<PlatformSettings>(COLLECTION)
      .findOne({ _id: DOC_ID as any }, { projection: { appUpdates: 1 } })
    : null;

  const setFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    setFields[`${section}.${key}`] = value;
  }
  if (section === "appUpdates") {
    const currentAppUpdates = currentSettings?.appUpdates;
    const currentEmergencyLock = Boolean(currentAppUpdates?.emergencyLock);
    const nextEmergencyLock = "emergencyLock" in data
      ? Boolean(data.emergencyLock)
      : currentEmergencyLock;
    const nextDelay = Number(
      data.emergencyLockDelay ?? currentAppUpdates?.emergencyLockDelay ?? 0,
    );
    const delayChanged = "emergencyLockDelay" in data &&
      nextDelay !== Number(currentAppUpdates?.emergencyLockDelay ?? 0);

    setFields["appUpdates.policyPublishedAt"] = nowIso;

    // Server-managed: never trust a value echoed back by the admin form.
    delete setFields["appUpdates.enforcementStartedAt"];
    // Versions: trim stray spaces ("  3.17.0") and write "3.4" as "3.4.0".
    for (const key of ["latestVersion", "minimumSupportedVersion"] as const) {
      if (key in data) {
        const raw = String(data[key] ?? "").trim().replace(/^v/i, "");
        const parts = /^\d+(\.\d+){0,2}$/.test(raw) ? raw.split(".") : null;
        if (parts) while (parts.length < 3) parts.push("0");
        setFields[`appUpdates.${key}`] = parts ? parts.join(".") : raw;
      }
    }
    if ("gracePeriodHours" in data) {
      const grace = Number(data.gracePeriodHours);
      setFields["appUpdates.gracePeriodHours"] = Number.isFinite(grace)
        ? Math.min(2160, Math.max(0, Math.round(grace)))
        : 0;
    }

    // Forced-update countdown anchor. Only the fields that change what users
    // must do restart the clock; editing a message or download link must not
    // hand everyone a fresh grace period.
    const nextForceUpdates = "forceUpdatesEnabled" in data
      ? Boolean(data.forceUpdatesEnabled)
      : Boolean(currentAppUpdates?.forceUpdatesEnabled);
    const enforcementChanged = (
      ["forceUpdatesEnabled", "minimumSupportedVersion", "gracePeriodHours"] as const
    ).some(
      (key) =>
        key in data &&
        String(setFields[`appUpdates.${key}`] ?? "") !== String(currentAppUpdates?.[key] ?? ""),
    );
    if (!nextForceUpdates) {
      setFields["appUpdates.enforcementStartedAt"] = null;
    } else if (enforcementChanged || !currentAppUpdates?.enforcementStartedAt) {
      setFields["appUpdates.enforcementStartedAt"] = nowIso;
    }

    if (!nextEmergencyLock) {
      setFields["appUpdates.emergencyLockEnabledAt"] = null;
      setFields["appUpdates.emergencyLockEffectiveAt"] = null;
    } else if (
      !currentEmergencyLock ||
      delayChanged ||
      !currentAppUpdates?.emergencyLockEnabledAt
    ) {
      const effectiveAt = nextDelay > 0
        ? new Date(Date.now() + Math.max(0, nextDelay) * 60 * 60 * 1000).toISOString()
        : nowIso;
      setFields["appUpdates.emergencyLockEnabledAt"] = nowIso;
      setFields["appUpdates.emergencyLockEffectiveAt"] = effectiveAt;
    }
  }
  setFields.updatedAt = nowIso;
  if (updatedBy) setFields.updatedBy = updatedBy;

  await db
    .collection<PlatformSettings>(COLLECTION)
    .updateOne(
      { _id: DOC_ID as any },
      { $set: setFields },
      { upsert: true }
    );

  // Sync trial settings to the dedicated trial_settings collection
  // so trial creation logic reads the same values admins configure.
  if (section === "trial") {
    const trialPatch: Record<string, unknown> = {};
    const mapping: Record<string, string> = {
      defaultDurationDays: "defaultDurationDays",
      sendExtensionEmails: "sendExtensionEmails",
      sendRestartEmails: "sendRestartEmails",
      sendStopEmails: "sendStopEmails",
      enabled: "enableForNewUsers",
    };
    for (const [platformKey, trialKey] of Object.entries(mapping)) {
      if (platformKey in data) {
        trialPatch[trialKey] = data[platformKey];
      }
    }
    if (Object.keys(trialPatch).length > 0) {
      trialPatch.updatedAt = new Date().toISOString();
      await db
        .collection("trial_settings")
        .updateOne(
          { _id: "default" as any },
          { $set: trialPatch },
          { upsert: true }
        );
    }
  }

  _cache = null;
  return getPlatformSettings();
}

/**
 * Delete the settings document and re-seed with fresh defaults.
 * Used for schema migrations when old field shapes are incompatible.
 */
export async function reseedPlatformSettings(): Promise<PlatformSettings> {
  const client = await clientPromise;
  const db = client.db();

  await db
    .collection(COLLECTION)
    .deleteOne({ _id: DOC_ID as any });

  _cache = null;
  return getPlatformSettings();
}
