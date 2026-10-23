/**
 * desktopConfigTypes.ts — Types and default values for desktop-specific
 * platform configuration.
 *
 * The DEFAULT_DESKTOP_CONFIG serves as the offline fallback when the
 * /api/config/desktop endpoint is unreachable. It mirrors the API-side
 * defaults in api/src/lib/platformSettings.ts.
 */
import { DEFAULT_SUPPORT_CONTENT, type SupportContent } from "./supportContent";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DesktopConfig {
  appUpdates: {
    latestVersion: string;
    minimumSupportedVersion: string;
    forceUpdatesEnabled: boolean;
    emergencyLock: boolean;
    emergencyLockDelay: number;
    gracePeriodHours: number;
    updateMessage: string;
    emergencyLockMessage: string;
    windowsDownloadUrl: string;
    macDownloadUrl: string;
    linuxDownloadUrl: string;
    releaseNotesUrl: string;
    policyPublishedAt: string;
    /** Server-managed start of the forced-update countdown (older APIs omit it). */
    enforcementStartedAt?: string | null;
    /** When old versions get blocked, computed by the server. */
    enforcementDeadlineAt?: string | null;
    /** Server clock at response time, used to correct a wrong local clock. */
    serverTime?: string | null;
    emergencyLockEnabledAt: string | null;
    emergencyLockEffectiveAt: string | null;
  };
  trial: {
    enabled: boolean;
    defaultDurationDays: number;
  };
  credits: {
    translationCost: number;
    speechToScriptureCost: number;
    aiSummaryCost: number;
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
    scriptureTranslation: boolean;
    speechToScripture: boolean;
    aiSummaries: boolean;
    sermonNotes: boolean;
    aiAssistant: boolean;
    dailyRequestLimit: number;
    maximumTranslationMinutes: number;
    supportedLanguages: string[];
  };
  storage: {
    enableCloudSync: boolean;
    maxUploadSizeMB: number;
    allowedFileTypes: string;
    allowedImageExtensions: string[];
    allowedVideoExtensions: string[];
    maximumBackgroundVideoSizeMB: number;
    churchLogoSizeLimitMB: number;
    mediaLibraryQuotaGB: number;
  };
  security: {
    maintenanceMode: boolean;
    /** Admin-written message shown while maintenance mode is on. */
    maintenanceMessage?: string;
    internetVerificationEnabled: boolean;
    maxOfflineDays: number;
    verificationIntervalHours: number;
  };
  /** Admin → Settings → Controls. Optional: older cached configs don't have it. */
  controls?: DesktopAdminControls;
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
}

// ── Defaults (offline fallback) ─────────────────────────────────────────────

export type DesktopFeatureSwitch =
  | "speechToScripture"
  | "liveTranslation"
  | "mobileRemote"
  | "multistream"
  | "presentationLink";

export interface DesktopAdminControls {
  features: Record<DesktopFeatureSwitch, boolean>;
  speech: { model: "universal-streaming-english" | "universal-streaming-multilingual" };
  /** The Support window (see supportContent.ts). */
  support: SupportContent;
}

export const DEFAULT_DESKTOP_ADMIN_CONTROLS: DesktopAdminControls = {
  features: {
    speechToScripture: true,
    liveTranslation: true,
    mobileRemote: true,
    multistream: true,
    presentationLink: true,
  },
  speech: { model: "universal-streaming-english" },
  support: DEFAULT_SUPPORT_CONTENT,
};

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  appUpdates: {
    latestVersion: "2.6.0",
    minimumSupportedVersion: "2.0.0",
    forceUpdatesEnabled: false,
    emergencyLock: false,
    emergencyLockDelay: 0,
    gracePeriodHours: 48,
    updateMessage: "A new version is available. Please update to continue.",
    emergencyLockMessage: "MakeChurchEazy is temporarily unavailable due to emergency maintenance.",
    windowsDownloadUrl: "",
    macDownloadUrl: "",
    linuxDownloadUrl: "",
    releaseNotesUrl: "",
    policyPublishedAt: new Date(0).toISOString(),
    emergencyLockEnabledAt: null,
    emergencyLockEffectiveAt: null,
  },
  trial: {
    enabled: true,
    defaultDurationDays: 30,
  },
  credits: {
    translationCost: 1,
    speechToScriptureCost: 2,
    aiSummaryCost: 3,
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
    tutorialVideoUrl: "https://youtu.be/i-WnFFnuCMA?t=83",
  },
  ai: {
    scriptureTranslation: true,
    speechToScripture: true,
    aiSummaries: true,
    sermonNotes: false,
    aiAssistant: true,
    dailyRequestLimit: 100,
    maximumTranslationMinutes: 60,
    supportedLanguages: ["en", "es", "fr", "de", "pt", "zh", "ja", "ko", "ar", "hi"],
  },
  storage: {
    enableCloudSync: true,
    maxUploadSizeMB: 50,
  allowedFileTypes: "jpg,png,gif,mp4,pdf,docx,pptx",
    allowedImageExtensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
    allowedVideoExtensions: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv"],
    maximumBackgroundVideoSizeMB: 500,
    churchLogoSizeLimitMB: 5,
    mediaLibraryQuotaGB: 10,
  },
  security: {
    maintenanceMode: false,
    maintenanceMessage: "",
    internetVerificationEnabled: false,
    maxOfflineDays: 28,
    verificationIntervalHours: 6,
  },
  controls: DEFAULT_DESKTOP_ADMIN_CONTROLS,
  themes: {
    defaultBibleTheme: "",
    defaultWorshipTheme: "",
    defaultLowerThirdTheme: "",
    defaultAnnouncementTheme: "",
    defaultFont: "Inter",
    defaultBrandColours: {
      primary: "#3b82f6",
      secondary: "#6366f1",
      accent: "#8b5cf6",
    },
    bibleDefaults: {
      font: "Inter",
      textSize: 48,
      textColor: "#ffffff",
      backgroundColor: "#000000",
      accentColor: "#3b82f6",
    },
    worshipDefaults: {
      font: "Inter",
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
