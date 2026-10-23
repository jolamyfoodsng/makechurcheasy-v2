import { DEFAULT_SUPPORT_CONTENT, type SupportContent } from "./supportContent";

export type PaymentProviderKey = "flutterwave" | "mtnMomo" | "nowpayments";
export type FeatureSwitchKey =
  | "speechToScripture"
  | "liveTranslation"
  | "mobileRemote"
  | "multistream"
  | "presentationLink";

export interface AdminControls {
  paymentProviders: Record<PaymentProviderKey, boolean>;
  features: Record<FeatureSwitchKey, boolean>;
  speech: {
    model: "universal-streaming-english" | "universal-streaming-multilingual";
    dailyMinutesCap: number;
  };
  signup: {
    maxSignupsPerIpPerDay: number;
    maxSignupsPerDevicePerDay: number;
    blockDisposableEmails: boolean;
    blockedDomains: string[];
  };
  /** The desktop app's Support window (see supportContent.ts). */
  support: SupportContent;
}

export interface PlatformSettings {
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
    /** Set by the server when the forced-update countdown starts. */
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
  ambassador: {
    enabled: boolean;
    creditsPerAmbassador: number;
    defaultAmbassadorDurationDays: number;
    autoExpiry: boolean;
    sendWelcomeEmail: boolean;
    badgeText: string;
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
  emailBranding: {
    appName: string;
    logoUrl: string;
    logoAlt: string;
    markUrl: string;
    markLightUrl: string;
    primaryColor: string;
    accentColor: string;
    supportEmail: string;
    websiteUrl: string;
    preferencesUrl: string;
    footerText: string;
    social: {
      twitterUrl: string;
      facebookUrl: string;
      instagramUrl: string;
      linkedinUrl: string;
      youtubeUrl: string;
      whatsappUrl: string;
      tiktokUrl: string;
    };
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
    maintenanceMessage: string;
    internetVerificationEnabled: boolean;
    maxOfflineDays: number;
    verificationIntervalHours: number;
  };
  system: {
    allowRegistrations: boolean;
    allowPayments: boolean;
  };
  controls: AdminControls;
  featureFlags: {
    remotePresentationBeta: boolean;
    cloudSyncBeta: boolean;
    newTranslationEngine: boolean;
    newMobileApp: boolean;
  };
}

export const DEFAULT_SETTINGS: PlatformSettings = {
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
  ambassador: {
    enabled: false,
    creditsPerAmbassador: 1000,
    defaultAmbassadorDurationDays: 180,
    autoExpiry: true,
    sendWelcomeEmail: true,
    badgeText: "Ambassador",
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
  emailBranding: {
    appName: "MakeChurchEazy",
    logoUrl: "https://makechurcheazy.com/logos/make_church_easy_logo.png",
    logoAlt: "MakeChurchEazy",
    markUrl: "https://makechurcheazy.com/email/mark-blue.png",
    markLightUrl: "https://makechurcheazy.com/email/mark-white.png",
    primaryColor: "#1D4ED8",
    accentColor: "#F97316",
    supportEmail: "support@makechurcheazy.com",
    websiteUrl: "https://makechurcheazy.com",
    preferencesUrl: "https://makechurcheazy.com/settings",
    footerText:
      "MakeChurchEazy helps churches run presentations, lyrics, Bible, and livestream workflows from one platform.",
    social: {
      twitterUrl: "",
      facebookUrl: "",
      instagramUrl: "",
      linkedinUrl: "",
      youtubeUrl: "https://www.youtube.com/playlist?list=PLRua6gJfgC0o",
      whatsappUrl: "https://chat.whatsapp.com/EQIuXfpCTBOG7YOSf2nKqU?mode=gi_t",
      tiktokUrl: "",
    },
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
  controls: {
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
  },
  featureFlags: {
    remotePresentationBeta: false,
    cloudSyncBeta: false,
    newTranslationEngine: false,
    newMobileApp: false,
  },
};
