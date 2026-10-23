/**
 * MVSettings.tsx — Unified Settings (Redesigned)
 *
 * Tabbed layout with header and tab navigation.
 * Tabs: General, OBS Connection, Appearance, Branding, Bible, Free Usage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { getBibleSettings, getInstalledTranslations, saveBibleSettings } from "../../bible/bibleDb";
import { useBible } from "../../bible/bibleStore";
import { openDashboardSubscriptionPlans } from "../../services/subscriptionNavigation";
import type { BibleTranslation } from "../../bible/types";
import { AppLogo } from "../../components/AppLogo";
import { AccountSummaryCards } from "../../components/AccountSummaryCards";
import { LocalDevPlanSwitcher } from "../../components/LocalDevPlanSwitcher";
import { UpgradeModal } from "../../components/UpgradeModal";
import { CloudSyncSettingsCard } from "../../components/CloudSyncSettingsCard";
import { useAuth } from "../../contexts/AuthContext";
import {
  INTERFACE_LOCALES,
} from "../../i18n/localeCatalog";
import { ltDurationStore } from "../../lowerthirds/ltDurationStore";
import { useAppTheme } from "../../hooks/useAppTheme";
import { APP_APPEARANCE_PALETTES } from "../../services/appAppearance";
import { DOCK_FONT_FAMILY_GROUPS, DOCK_FONT_FAMILY_OPTIONS } from "../../dock/dockFontFamily";
import { applyBrandingSettingsToDom } from "../../services/branding";
import { fetchCreditDetails, fetchCreditTransactions, onCreditChange, type CreditDetails, type CreditTransaction } from "../../services/credits";
import {
  applyInterfaceLanguagePreference,
  getInterfaceLanguageLabel,
  getResolvedInterfaceLanguage,
} from "../../services/interfaceLanguage";
import { canUseMobileControl, getEffectivePlan, getTrialDaysRemaining, getUserPlan, isInTrial } from "../../services/licenseService";
import { obsService } from "../../services/obsService";
import { resetWorkspaceOnboarding } from "../../services/workspacePreference";
import { persistOBSWebSocketConfig } from "../../services/obsConnectionSettings";
import { normalizeOBSWebSocketUrl } from "../../services/obsWebSocketUrl";
import { resolveOverlayAssetUrl } from "../../services/overlayUrl";
import { formatCredits, getPlanConfig, getPlanCredits, getPlanLabel, type PlanConfig } from "../../services/planConfig";
import { isProUnlocked } from "../../services/proLicense";
import { clearAllSongs } from "../../worship/worshipDb";
import { refreshTheme } from "../components/MVThemeProvider";
import { AutomationSettingsPanel } from "../components/AutomationSettingsPanel";
import * as db from "../mvStore";
import { copyTextToClipboard } from "../../dock/bibleClipboard";
import {
  buildMobilePairingPayload,
  buildMobileWebUrl,
  resolveMobilePairingPorts,
  type MobilePairingInfo,
} from "../../services/mobilePairing";
import {
  DEFAULT_SETTINGS,
  type MVSettings as MVSettingsType,
  type SpeakerProfileSetting
} from "../mvStore";
import {
  checkForUpdate,
  type DownloadProgress,
  type Update,
} from "../../services/updateService";
import {
  updateDownloadManager,
  useUpdateDownload,
} from "../../services/updateDownloadManager";

import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  Lock,
  BookOpen,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  History,
  Mic,
  Monitor,
  Moon,
  Music,
  Paintbrush,
  Palette,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  Smartphone,
  Sun,
  Trash2,
  Zap,
  FolderUp,
} from "../../components/icons/NativeIcons";
import EasyWorshipOneClickImportModal from "../../worship/EasyWorshipOneClickImportModal";
import { refreshAccountBootstrapFromServer } from "../../services/authService";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import { safeTauriInvoke, safeTauriListen } from "../../services/tauriSafe";
import { lmDockService } from "../../services/lmDockService";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import { BroadcastSettingsPanel } from "../../components/BroadcastSettingsPanel";

import "./MVSettings.css";

/* ── Constants ── */
const FALLBACK_TRANSLATIONS: { value: string; label: string }[] = [
  { value: "KJV", label: "King James Version (KJV)" },
];

export type SettingsTab = "general" | "appearance" | "bible" | "branding" | "obs" | "broadcast" | "mobile" | "automation" | "usage" | "storage" | "audio";

export interface SettingsNavCategory {
  group: string;
  items: {
    id: SettingsTab;
    label: string;
    icon: typeof Settings;
    description: string;
    /** Shown greyed out with a "Soon" badge and cannot be opened (not even with ?tab=). */
    comingSoon?: boolean;
  }[];
}

export const SETTINGS_CATEGORIES: SettingsNavCategory[] = [
  {
    group: "Application",
    items: [
      { id: "general", label: "General", icon: Settings, description: "Studio preferences, language, and desktop updates." },
      { id: "appearance", label: "Appearance", icon: Palette, description: "Theme modes, Antigravity accent colors, and UI density." },
      { id: "bible", label: "Scripture & Bible", icon: BookOpen, description: "Default translation, slide layout, and verse presentation." },
    ],
  },
  {
    group: "Production & Stream",
    items: [
      { id: "broadcast", label: "Live Broadcast", icon: Radio, description: "Manage speaker profiles, stream keys, and social broadcast destinations." },
      { id: "branding", label: "Church & Branding", icon: Paintbrush, description: "Church identity, logo assets, lower-thirds, and speakers." },
      { id: "obs", label: "OBS Studio", icon: Radio, description: "WebSocket connection, credentials, and live status." },
      { id: "audio", label: "Audio & Voice AI", icon: Mic, description: "Microphone input, gain boost, and speech-to-scripture settings." },
      { id: "automation", label: "Automations", icon: Zap, description: "Create and manage desktop automations for OBS." },
    ],
  },
  {
    group: "Account & System",
    items: [
      { id: "usage", label: "Plan & AI Credits", icon: History, description: "Plan tier, remaining credits, and transaction history." },
      { id: "storage", label: "Data & Storage", icon: Trash2, description: "Import from EasyWorship, database reset, worship cleanup, and cache management." },
    ],
  },
  {
    group: "Coming soon",
    items: [
      // The tab itself is kept (see activeTab === "mobile" below); remove `comingSoon` to switch it back on.
      { id: "mobile", label: "Mobile Companion", icon: Smartphone, description: "Wireless phone pairing, QR code, and remote permissions.", comingSoon: true },
    ],
  },
];

const COMING_SOON_TABS = new Set<SettingsTab>(
  SETTINGS_CATEGORIES.flatMap((category) => category.items.filter((item) => item.comingSoon).map((item) => item.id)),
);

const PREFERRED_MIC_STORAGE_KEY = "ocs-speech-to-scripture-mic-id";

function loadPreferredMicId(): string {
  const nativeMic = readNativeDockSetting<string>(PREFERRED_MIC_STORAGE_KEY);
  if (nativeMic?.trim()) return nativeMic.trim();
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(getUserScopedKey(PREFERRED_MIC_STORAGE_KEY))?.trim() ?? "";
  } catch {
    return "";
  }
}

function savePreferredMicId(micId: string): void {
  writeNativeDockSetting(PREFERRED_MIC_STORAGE_KEY, micId.trim());
  if (typeof localStorage === "undefined") return;
  try {
    const key = getUserScopedKey(PREFERRED_MIC_STORAGE_KEY);
    const trimmed = micId.trim();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in restricted browser contexts
  }
}

const EMPTY_SPEAKER_PROFILE: SpeakerProfileSetting = { name: "", role: "", imageUrl: "" };
const CHURCH_PROFILE_URL = "https://makechurcheazy.com/church-profile";

type ManualUpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "relaunching" | "up-to-date" | "error";

/* ── Helpers ── */
function resolveLogoPreviewSrc(path: string): string {
  return resolveOverlayAssetUrl(path);
}


function sanitizeSpeakerProfiles(value: unknown): SpeakerProfileSetting[] {
  if (!Array.isArray(value)) return [];
  const result: SpeakerProfileSetting[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<Record<string, unknown>>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const role = typeof raw.role === "string" ? raw.role.trim() : "";
    const imageUrl = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
    if (!name) continue;
    const profile: SpeakerProfileSetting = { name, role, imageUrl };
    if (typeof raw.isMain === "boolean") profile.isMain = raw.isMain;
    result.push(profile);
  }
  return result;
}

function parseLegacyPastorNames(pastorNames: string): SpeakerProfileSetting[] {
  return pastorNames.split(/\r?\n|,/).map((n) => n.trim()).filter(Boolean).map((n) => ({ name: n, role: "" }));
}

function resolveSpeakerProfiles(settings: MVSettingsType): SpeakerProfileSetting[] {
  const structured = sanitizeSpeakerProfiles((settings as Partial<MVSettingsType>).pastorSpeakers);
  if (structured.length > 0) return structured;
  return parseLegacyPastorNames(settings.pastorNames);
}

function formatUpdateBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Main Component ── */
export function MVSettings() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const validTabs: SettingsTab[] = ["general", "appearance", "bible", "branding", "obs", "broadcast", "mobile", "automation", "usage", "storage", "audio"];
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab && validTabs.includes(initialTab as SettingsTab) && !COMING_SOON_TABS.has(initialTab as SettingsTab)
      ? (initialTab as SettingsTab)
      : "general"
  );

  useEffect(() => {
    const tabParam = searchParams.get("tab") as SettingsTab | null;
    if (tabParam && validTabs.includes(tabParam) && !COMING_SOON_TABS.has(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);
  const hasSettingsSidebar = activeTab === "obs";
  const [settings, setSettings] = useState<MVSettingsType>(db.getSettings);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [confirmClearWorship, setConfirmClearWorship] = useState(false);
  const [worshipCleared, setWorshipCleared] = useState(false);
  const [obsStatus, setObsStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [obsTestResult, setObsTestResult] = useState<string | null>(null);
  const [obsPasswordDraft, setObsPasswordDraft] = useState(() => db.getSettings().obsPassword ?? "");
  const obsPasswordScrubbedRef = useRef(false);
  const [_brandLogoStatus, _setBrandLogoStatus] = useState<string | null>(null);
  const [_brandLogoStatusType, _setBrandLogoStatusType] = useState<"ok" | "err">("ok");
  const [_brandLogoUploading, _setBrandLogoUploading] = useState(false);
  const [speakerProfiles, setSpeakerProfiles] = useState<SpeakerProfileSetting[]>(() => {
    const profiles = resolveSpeakerProfiles(db.getSettings());
    return profiles.length > 0 ? profiles : [{ ...EMPTY_SPEAKER_PROFILE }];
  });
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [brandingProfileFound, setBrandingProfileFound] = useState<boolean | null>(null);
  const [manualUpdateStatus, setManualUpdateStatus] = useState<ManualUpdateStatus>("idle");
  const [manualUpdateMessage, setManualUpdateMessage] = useState("");
  const [manualUpdate, setManualUpdate] = useState<Update | null>(null);
  const [manualUpdateProgress, setManualUpdateProgress] = useState<DownloadProgress>({ contentLength: 0, downloaded: 0 });

  // ── Bible settings state ──
  const { state: bibleState, dispatch: bibleDispatch, setTheme: bibleSetTheme } = useBible();
  const [bDefaultTranslation, setBDefaultTranslation] = useState<BibleTranslation>("KJV");
  const [bDefaultThemeId, setBDefaultThemeId] = useState("preset-royal-blue-glow");
  const [bShowVerseNumbers, setBShowVerseNumbers] = useState(true);
  const [bMaxLines, setBMaxLines] = useState(4);
  const [bAutoSend, setBAutoSend] = useState(true);
  const [bColorMode, setBColorMode] = useState<"dark" | "light" | "system">("dark");
  const [bReduceMotion, setBReduceMotion] = useState(false);
  const [bHighContrast, setBHighContrast] = useState(false);
  const [_bSaved, setBSaved] = useState(false);
  const [bTranslations, setBTranslations] = useState(FALLBACK_TRANSLATIONS);
  const [bibleSettingsDirty, setBibleSettingsDirty] = useState(false);

  // ── Full access key state ──
  const [proUnlocked] = useState(() => isProUnlocked());

  // ── Credits state (fetched from backend) ──
  const { user: authUser, refreshUser } = useAuth();
  const effectivePlan = getEffectivePlan(authUser);
  const hasMobileAccess = canUseMobileControl(authUser);
  const [showMobileUpgrade, setShowMobileUpgrade] = useState(false);
  const [showCloudSyncUpgrade, setShowCloudSyncUpgrade] = useState(false);
  const [easyWorshipImportOpen, setEasyWorshipImportOpen] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [creditDetails, setCreditDetails] = useState<CreditDetails | null>(null);
  const [creditsUsedThisMonth, setCreditsUsedThisMonth] = useState<number>(0);
  const [planConfig, setPlanConfig] = useState<PlanConfig | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<CreditTransaction[]>([]);
  const userPlan = proUnlocked ? "growth" as const : getUserPlan(authUser);
  const storedPlan = String(authUser?.plan || "free").trim().toLowerCase();
  const trialActive = !proUnlocked && storedPlan === "free" && isInTrial(authUser);
  // During trial, user gets Growth-level credits — use the trial config tier for lookup
  const effectivePlanForCredits = trialActive ? "trial" as const : userPlan;
  const serverPlan = creditDetails?.effectivePlan;
  const serverTrialActive = serverPlan === "trial";
  const displayPlan = serverPlan && serverPlan !== "trial"
    ? serverPlan
    : effectivePlanForCredits;
  const planCredits = proUnlocked
    ? -1
    : (creditDetails?.planAllocation ?? (planConfig ? getPlanCredits(planConfig, displayPlan) : 0));
  const creditsRemaining = proUnlocked ? -1 : (creditDetails?.credits ?? creditBalance);
  const displayTrialActive = serverPlan ? serverTrialActive : trialActive;
  const trialDaysLeft = trialActive ? getTrialDaysRemaining(authUser) : 0;
  const trialEndDate = trialActive && authUser?.trial?.endsAt
    ? new Date(authUser.trial.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const planLabel = displayTrialActive
    ? "Growth Trial"
    : (proUnlocked ? "Full Access" : (planConfig ? getPlanLabel(planConfig, displayPlan) : "Free"));
  const isUnlimited = planCredits === -1;
  const totalAvailableCredits = isUnlimited
    ? -1
    : (creditDetails?.totalAvailable ?? Math.max(0, planCredits + (creditDetails?.adminGranted ?? 0)));
  const usagePct = (!isUnlimited && totalAvailableCredits > 0)
    ? Math.min(100, Math.max(0, Math.round((creditsUsedThisMonth / totalAvailableCredits) * 100)))
    : 0;

  useEffect(() => {
    getPlanConfig().then(setPlanConfig);
  }, []);

  // Settings is often the first place an upgraded user checks their account.
  // Refresh the device bootstrap here so the displayed plan is not limited to
  // the background heartbeat or the Usage tab.
  useEffect(() => {
    if (!authUser?.id) return;
    let cancelled = false;

    void refreshAccountBootstrapFromServer()
      .then((result) => {
        if (!cancelled && result.status === "ok") refreshUser();
      })
      .catch(() => {
        // Keep the settings screen usable when the account service is offline.
      });

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, refreshUser]);

  // Fetch transactions after auth is ready
  useEffect(() => {
    if (!authUser?.id) return;
    fetchCreditTransactions(10).then(setRecentTransactions);
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    fetchCreditDetails().then((details) => {
      if (details) {
        setCreditBalance(details.credits);
        setCreditDetails(details);
        setCreditsUsedThisMonth(details.totalConsumed);
      }
    }).catch(() => {
      setCreditBalance(0);
      setCreditDetails(null);
      setCreditsUsedThisMonth(0);
    });
  }, [authUser?.id, planConfig]);

  // Live-update credits when deductions happen anywhere in the app
  useEffect(() => {
    const unsub = onCreditChange((newBalance) => {
      setCreditBalance(newBalance);
      // Re-fetch full details to get accurate totalConsumed
      fetchCreditDetails().then((details) => {
        if (details) {
          setCreditDetails(details);
          setCreditsUsedThisMonth(details.totalConsumed);
        }
      });
      fetchCreditTransactions(10).then(setRecentTransactions);
    });
    return unsub;
  }, []);

  // Re-fetch credits and transactions every time the Usage tab is opened
  useEffect(() => {
    if (activeTab !== "usage" || !authUser?.id) return;
    let cancelled = false;

    const loadUsageState = async () => {
      try {
        const details = await fetchCreditDetails();
        if (!cancelled && details) {
          setCreditBalance(details.credits);
          setCreditDetails(details);
          setCreditsUsedThisMonth(details.totalConsumed);
        }
      } catch {
        // noop
      }

      try {
        const transactions = await fetchCreditTransactions(10);
        if (!cancelled) {
          setRecentTransactions(transactions);
        }
      } catch {
        // noop
      }
    };

    void loadUsageState();

    return () => {
      cancelled = true;
    };
  }, [activeTab, authUser?.id, refreshUser]);

  // ── Appearance customization state ──
  const {
    preference: theme,
    effective: effectiveTheme,
    setTheme,
    appearance,
    setAppearance,
  } = useAppTheme();
  const [density, setDensity] = useState<"comfortable" | "balanced" | "compact">("balanced");
  const [fontSizeRange, setFontSizeRange] = useState<number>(2);
  const [highContrastUI, setHighContrastUI] = useState<boolean>(settings.highContrast ?? false);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [roundedCorners, setRoundedCorners] = useState<boolean>(true);
  const [interfaceLanguage, setInterfaceLanguage] = useState<string>(() => getResolvedInterfaceLanguage());
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);
  const downloadState = useUpdateDownload();

  const isGlobalDownloading =
    downloadState.status === "downloading" ||
    downloadState.status === "installing" ||
    downloadState.status === "relaunching";

  // The app-wide manager knows about updates found by the startup check and
  // about background downloads, so prefer its state over this page's own.
  const effectiveUpdateStatus: ManualUpdateStatus = isGlobalDownloading || downloadState.status === "ready"
    ? downloadState.status as ManualUpdateStatus
    : manualUpdateStatus === "idle" && downloadState.status === "available"
      ? "available"
      : manualUpdateStatus;

  const effectiveUpdateProgress = isGlobalDownloading
    ? downloadState.progress
    : manualUpdateProgress;

  const manualUpdateBusy =
    effectiveUpdateStatus === "checking" ||
    effectiveUpdateStatus === "downloading" ||
    effectiveUpdateStatus === "installing" ||
    effectiveUpdateStatus === "relaunching";

  const manualUpdatePercent =
    effectiveUpdateProgress.contentLength > 0
      ? Math.round((effectiveUpdateProgress.downloaded / effectiveUpdateProgress.contentLength) * 100)
      : (isGlobalDownloading ? downloadState.progress.percent : 0);

  // ── Toast system ──
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "success" | "accent" }>>([]);

  // ── OBS advanced state ──
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [obsLogs, setObsLogs] = useState<Array<{ id: number; timestamp: string; message: string; source: string }>>([
    { id: 1, timestamp: "10:24:02", message: "Initializing OBS WebSocket connection module...", source: "System" },
    { id: 2, timestamp: "10:24:03", message: "Handshaking with server ws://localhost:4455", source: "Network" },
    { id: 3, timestamp: "10:24:04", message: "OBS server accepted connection. Version 30.1.2", source: "OBS" },
  ]);

  // ── Audio & Voice AI state ──
  const [audioMics, setAudioMics] = useState<Array<{ id: string; label: string }>>([]);
  const [audioMicsLoading, setAudioMicsLoading] = useState(false);
  const [selectedMicId, setSelectedMicId] = useState(() => loadPreferredMicId());
  const [inputGainDraft, setInputGainDraft] = useState<number>(settings.inputGain ?? 100);
  const [liveAudioLevel, setLiveAudioLevel] = useState<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);

  /* ── Toast helper ── */
  const triggerToast = useCallback((message: string, type: "success" | "accent" = "accent") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const refreshAudioMics = useCallback(async () => {
    setAudioMicsLoading(true);
    try {
      let devices = await lmDockService.getMics();
      // If backend returned nothing or only default fallback, query browser audio devices
      if (devices.length === 0 || (devices.length === 1 && !devices[0].id)) {
        if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
          try {
            const navDevices = await navigator.mediaDevices.enumerateDevices();
            const inputs = navDevices
              .filter((d) => d.kind === "audioinput")
              .map((d, idx) => ({
                id: d.deviceId,
                label: d.label || `Microphone ${idx + 1}`,
              }));
            if (inputs.length > 0) {
              devices = inputs;
            }
          } catch {
            // ignore device enumeration failure
          }
        }
      }
      setAudioMics(devices);
      const savedMic = loadPreferredMicId();
      if (devices.length > 0) {
        const stillValid = devices.some((d) => d.id === savedMic || d.label === savedMic);
        if (!stillValid && !savedMic) {
          const defaultMic = devices[0].id;
          setSelectedMicId(defaultMic);
          savePreferredMicId(defaultMic);
        }
      }
    } catch (err) {
      console.warn("[MVSettings] Failed to enumerate mics:", err);
    } finally {
      setAudioMicsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "audio") {
      void refreshAudioMics();
    }
  }, [activeTab, refreshAudioMics]);

  useEffect(() => {
    if (activeTab !== "audio") {
      setLiveAudioLevel(0);
      return;
    }

    let isCancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let animId: number | null = null;
    let unlistenChunk: (() => void) | undefined;
    let unlistenAssembly: (() => void) | undefined;

    // 1. Listen for audio events from native Tauri backend
    safeTauriListen<{ level: number }>("assemblyai-audio-level", (event) => {
      if (isCancelled) return;
      const gainFactor = Number.isFinite(inputGainDraft) ? Math.max(0, inputGainDraft / 100) : 1;
      setLiveAudioLevel(Math.min(1, (event.payload.level || 0) * gainFactor));
    }).then((fn) => { unlistenAssembly = fn; }).catch(() => {});

    safeTauriListen<{ level: number }>("audio-chunk", (event) => {
      if (isCancelled) return;
      const gainFactor = Number.isFinite(inputGainDraft) ? Math.max(0, inputGainDraft / 100) : 1;
      setLiveAudioLevel(Math.min(1, (event.payload.level || 0) * gainFactor));
    }).then((fn) => { unlistenChunk = fn; }).catch(() => {});

    // Trigger native audio capture in Tauri backend if available
    safeTauriInvoke("start_audio_capture", { deviceId: selectedMicId || null }).catch(() => {});

    // 2. Start Web Audio capture for responsive 60fps real-time level monitoring
    const initWebAudio = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      try {
        let targetWebDeviceId: string | undefined;
        if (selectedMicId && navigator.mediaDevices.enumerateDevices) {
          try {
            const allDevs = await navigator.mediaDevices.enumerateDevices();
            const matched = allDevs.find(
              (d) =>
                d.kind === "audioinput" &&
                (d.deviceId === selectedMicId ||
                 d.label === selectedMicId ||
                 (d.label && selectedMicId && d.label.toLowerCase().includes(selectedMicId.toLowerCase())) ||
                 (d.label && selectedMicId && selectedMicId.toLowerCase().includes(d.label.toLowerCase())))
            );
            if (matched?.deviceId) {
              targetWebDeviceId = matched.deviceId;
            }
          } catch {
            // ignore matching error
          }
        }

        if (isCancelled) return;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: targetWebDeviceId ? { deviceId: { exact: targetWebDeviceId } } : true,
          });
        } catch {
          if (isCancelled) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (err) {
            console.warn("[MVSettings] Web Audio getUserMedia failed:", err);
            return;
          }
        }

        if (isCancelled) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }

        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;

        audioCtx = new AudioContextClass();
        if (audioCtx.state === "suspended") {
          await audioCtx.resume().catch(() => {});
        }

        if (isCancelled) {
          stream?.getTracks().forEach((t) => t.stop());
          audioCtx?.close().catch(() => {});
          return;
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const gainNode = audioCtx.createGain();
        gainNodeRef.current = gainNode;
        const initialGain = Number.isFinite(inputGainDraft) ? Math.max(0, inputGainDraft / 100) : 1;
        gainNode.gain.value = initialGain;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.2;

        source.connect(gainNode);
        gainNode.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (isCancelled) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalize average to 0..1 scale
          const norm = Math.min(1, avg / 90);
          setLiveAudioLevel(norm);
          animId = requestAnimationFrame(updateLevel);
        };
        animId = requestAnimationFrame(updateLevel);
      } catch (err) {
        console.warn("[MVSettings] Web Audio monitor error:", err);
      }
    };

    void initWebAudio();

    return () => {
      isCancelled = true;
      if (animId) cancelAnimationFrame(animId);
      gainNodeRef.current = null;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      safeTauriInvoke("stop_audio_capture").catch(() => {});
      unlistenChunk?.();
      unlistenAssembly?.();
      setLiveAudioLevel(0);
    };
  }, [activeTab, selectedMicId]);

  const handleGainChange = (gain: number) => {
    setInputGainDraft(gain);
    update({ inputGain: gain });
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = Math.max(0, gain / 100);
    }
    const gainMultiplier = Number.isFinite(gain) ? Math.max(0, Math.min(3, gain / 100)) : 1;
    safeTauriInvoke("set_microphone_gain", { gain: gainMultiplier }).catch(() => {});
  };

  const handleMicChange = (micId: string) => {
    setSelectedMicId(micId);
    savePreferredMicId(micId);
    triggerToast("Preferred microphone saved", "success");
  };

  /* ── Effects ── */
  useEffect(() => {
    getBibleSettings().then((s) => {
      setBDefaultTranslation((s.defaultTranslation as BibleTranslation) ?? "KJV");
      setBDefaultThemeId(s.activeThemeId ?? "preset-royal-blue-glow");
      setBColorMode(s.colorMode ?? "dark");
      setBAutoSend(s.autoSendOnDoubleClick ?? true);
      setBReduceMotion(s.reduceMotion ?? false);
      setBHighContrast(s.highContrast ?? false);
      if (s.slideConfig) {
        setBShowVerseNumbers(s.slideConfig.showVerseNumbers ?? true);
        setBMaxLines(s.slideConfig.maxLines ?? 4);
      }
      setBibleSettingsDirty(false);
    }).catch(console.error);

    getInstalledTranslations().then((list) => {
      if (list.length > 0) {
        setBTranslations(list.map((t) => ({ value: t.abbr, label: `${t.name} (${t.abbr})` })));
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (bibleSettingsDirty) return;
    if (bDefaultTranslation !== bibleState.translation) {
      setBDefaultTranslation(bibleState.translation);
    }
  }, [bDefaultTranslation, bibleSettingsDirty, bibleState.translation]);

  useEffect(() => {
    const check = () => setObsStatus(obsService.isConnected ? "connected" : "disconnected");
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const profiles = resolveSpeakerProfiles(settings);
    setSpeakerProfiles(profiles.length > 0 ? profiles : [{ ...EMPTY_SPEAKER_PROFILE }]);
  }, [settings.pastorSpeakers, settings.pastorNames]);

  const applyLowerThirdDefaultDuration = useCallback((seconds: number) => {
    const safe = Math.max(1, Math.min(300, Math.floor(seconds || 10)));
    ltDurationStore.setGlobalDefaults({ durations: { speaker: safe, scripture: safe, announcement: safe, generic: safe } });
  }, []);

  useEffect(() => {
    applyBrandingSettingsToDom({ brandColor: settings.brandColor, churchName: settings.churchName });
    applyLowerThirdDefaultDuration(settings.lowerThirdDefaultDurationSec);
  }, []);

  /* ── Dynamic CSS theming ── */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.documentElement.setAttribute("data-contrast", highContrastUI ? "high" : "standard");
    document.documentElement.setAttribute("data-reduced-motion", reduceMotion ? "true" : "false");
    document.documentElement.setAttribute("data-roundness", roundedCorners ? "standard" : "none");

    // Sync .light / .dark classes so App.css :root.light overrides activate
    const root = document.documentElement;
    if (effectiveTheme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }

    // Apply density and font-scale without wiping other classes
    root.classList.remove("density-comfortable", "density-balanced", "density-compact");
    root.classList.add(`density-${density}`);
    root.classList.remove("font-scale-small", "font-scale-medium", "font-scale-large");
    root.classList.add(`font-scale-${fontSizeRange === 1 ? "small" : fontSizeRange === 2 ? "medium" : "large"}`);
  }, [effectiveTheme, density, fontSizeRange, highContrastUI, reduceMotion, roundedCorners]);

  /* ── Settings update helper ── */
  const update = useCallback(
    (patch: Partial<MVSettingsType>) => {
      const next = db.updateSettings(patch);
      setSettings(next);
      if (patch.obsAutoReconnect !== undefined) obsService.setAutoReconnect(patch.obsAutoReconnect);
      if (patch.theme !== undefined || patch.highContrast !== undefined) refreshTheme();
      if (patch.brandColor !== undefined || patch.churchName !== undefined) {
        applyBrandingSettingsToDom({ brandColor: next.brandColor, churchName: next.churchName });
      }
      if (patch.lowerThirdDefaultDurationSec !== undefined) applyLowerThirdDefaultDuration(next.lowerThirdDefaultDurationSec);
    },
    [applyLowerThirdDefaultDuration]
  );

  useEffect(() => {
    if (obsPasswordScrubbedRef.current) return;
    obsPasswordScrubbedRef.current = true;
    if (!settings.obsPassword) return;
    setObsPasswordDraft(settings.obsPassword);
    update({ obsPassword: "" });
  }, [settings.obsPassword, update]);

  /* ── Church profile sync (Web → Desktop) ── */
  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const { syncChurchProfile } = await import("../../services/churchProfileSync");
      const result = await syncChurchProfile();
      setBrandingProfileFound(result.profileFound);
      // Re-read settings after sync to reflect updated values
      const fresh = db.getSettings();
      setSettings(fresh);
      const profiles = resolveSpeakerProfiles(fresh);
      setSpeakerProfiles(profiles.length > 0 ? profiles : [{ ...EMPTY_SPEAKER_PROFILE }]);
      setSyncStatus(result.message);
    } catch {
      setBrandingProfileFound(false);
      setSyncStatus("Sync failed unexpectedly.");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "branding") return;
    runSync();
  }, [activeTab, runSync]);

  /* ── Speaker profiles ── */


  /* ── Actions ── */
  const handleClear = async () => {
    try {
      await db.clearAll();
      setCleared(true);
      setConfirmClear(false);
      triggerToast(t("mvSettings.toast.databaseCleared"), "success");
      setTimeout(() => setCleared(false), 3000);
    } catch (err) {
      console.error("Clear failed:", err);
      triggerToast(t("mvSettings.toast.failedClearData"), "accent");
    }
  };

  const handleClearWorship = async () => {
    try {
      await clearAllSongs();
      setWorshipCleared(true);
      setConfirmClearWorship(false);
      triggerToast(t("mvSettings.toast.worshipSongsCleared"), "success");
      setTimeout(() => setWorshipCleared(false), 3000);
    } catch (err) {
      console.error("Clear worship failed:", err);
      triggerToast(t("mvSettings.toast.failedClearWorship"), "accent");
    }
  };

  const handleTestObs = async () => {
    setObsTestResult(null);
    setObsStatus("connecting");
    try {
      const obsUrl = normalizeOBSWebSocketUrl(settings.obsUrl);
      if (obsUrl !== settings.obsUrl) {
        update({ obsUrl });
      }

      // Always reconnect for an explicit test. If OBS is already connected to
      // the old target, skipping connect would silently ignore a new host,
      // port, or password and keep reporting the old connection as valid.
      await obsService.connect(obsUrl, obsPasswordDraft || undefined);
      const version = await obsService.call("GetVersion");
      await persistOBSWebSocketConfig(obsUrl, obsPasswordDraft || undefined, settings.obsAutoReconnect);
      setObsTestResult(t("mvSettings.obs.testResultConnected", { obsVersion: version.obsVersion, wsVersion: version.obsWebSocketVersion }));
      setObsStatus("connected");
      triggerToast(t("mvSettings.toast.obsConnected"), "success");
    } catch (err: any) {
      setObsTestResult(t("mvSettings.obs.testResultFailed", { message: err.message || "Connection failed" }));
      setObsStatus("disconnected");
      triggerToast(t("mvSettings.toast.obsConnectionFailed"), "accent");
    }
  };

  const handleResetSettings = () => {
    const next = db.updateSettings(DEFAULT_SETTINGS);
    setSettings({ ...next });
    setObsPasswordDraft("");
    _setBrandLogoStatus(null);
    applyBrandingSettingsToDom({ brandColor: next.brandColor, churchName: next.churchName });
    applyLowerThirdDefaultDuration(next.lowerThirdDefaultDurationSec);
    triggerToast(t("mvSettings.toast.settingsResetToDefaults"), "success");
  };

  const handleResetBrandingSettings = () => {
    update({
      churchName: DEFAULT_SETTINGS.churchName,
      mainPastorName: DEFAULT_SETTINGS.mainPastorName,
      pastorNames: DEFAULT_SETTINGS.pastorNames,
      pastorSpeakers: DEFAULT_SETTINGS.pastorSpeakers,
      lowerThirdDefaultDurationSec: DEFAULT_SETTINGS.lowerThirdDefaultDurationSec,
      brandColor: DEFAULT_SETTINGS.brandColor,
      brandSecondaryColor: DEFAULT_SETTINGS.brandSecondaryColor,
      brandLogoPath: DEFAULT_SETTINGS.brandLogoPath,
      brandLogoAssets: DEFAULT_SETTINGS.brandLogoAssets,
    });
    setSpeakerProfiles([{ ...EMPTY_SPEAKER_PROFILE }]);
    _setBrandLogoStatus(null);
    triggerToast(t("mvSettings.toast.brandingSettingsReset"), "success");
  };

  const handleOpenChurchProfile = useCallback(() => {
    window.open(CHURCH_PROFILE_URL, "_blank", "noopener,noreferrer");
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setManualUpdateStatus("checking");
    setManualUpdateMessage("");
    setManualUpdate(null);
    setManualUpdateProgress({ contentLength: 0, downloaded: 0 });
    triggerToast(t("mvSettings.toast.checkingForUpdates"), "accent");

    const result = await checkForUpdate();
    if (result.available) {
      setManualUpdate(result.update ?? null);
      setManualUpdateStatus("available");
      setManualUpdateMessage(
        t("mvSettings.general.updateAvailableMessage", {
          version: result.version ?? "latest",
        }),
      );
      updateDownloadManager.registerAvailableUpdate(
        result.update ?? null,
        result.version ?? "",
        result.currentVersion ?? "",
        undefined,
        false,
      );
      triggerToast(t("mvSettings.toast.updateAvailable"), "success");
      return;
    }

    if (result.error) {
      setManualUpdateStatus("error");
      setManualUpdateMessage(result.error);
      triggerToast(t("mvSettings.toast.updateCheckFailed"), "accent");
      return;
    }

    setManualUpdateStatus("up-to-date");
    setManualUpdateMessage(t("mvSettings.general.upToDateMessage"));
    triggerToast(t("mvSettings.toast.upToDate"), "success");
  }, [t, triggerToast]);

  const handleInstallUpdate = useCallback(async (background = false) => {
    if (manualUpdateBusy) return;
    try {
      await updateDownloadManager.startDownload(manualUpdate || downloadState.update, undefined, { background });
    } catch (err) {
      console.error("[MVSettings] Manual update failed:", err);
      setManualUpdateStatus("error");
      setManualUpdateMessage(err instanceof Error ? err.message : t("mvSettings.general.updateFailedMessage"));
      triggerToast(t("mvSettings.toast.updateInstallFailed"), "accent");
    }
  }, [manualUpdate, downloadState.update, manualUpdateBusy, t, triggerToast]);

  const handleResetChurchOnboarding = useCallback(() => {
    update({ churchProfileOnboardingCompleted: false });
    // Also reset the desktop onboarding wizard so it re-runs on next launch
    try {
      localStorage.removeItem("mce-onboarding-complete");
      resetWorkspaceOnboarding();
      localStorage.removeItem("mce-onboarding-step");
    } catch { /* ignore */ }
    // Hard-reload so App.tsx re-reads the cleared localStorage flag.
    // On reload the index route will <Navigate> to /onboarding automatically.
    window.location.href = "/";
  }, [update]);

  /* ── Bible settings save ── */
  const handleSaveBible = useCallback(async () => {
    bibleDispatch({ type: "SET_TRANSLATION", translation: bDefaultTranslation });
    bibleDispatch({ type: "SET_SLIDE_CONFIG", config: { ...bibleState.slideConfig, showVerseNumbers: bShowVerseNumbers, maxLines: bMaxLines } });
    bibleDispatch({ type: "SET_COLOR_MODE", mode: bColorMode });
    bibleDispatch({ type: "SET_AUTO_SEND", enabled: bAutoSend });
    bibleDispatch({ type: "SET_REDUCE_MOTION", enabled: bReduceMotion });
    bibleDispatch({ type: "SET_HIGH_CONTRAST", enabled: bHighContrast });
    bibleSetTheme(bDefaultThemeId);
    await saveBibleSettings({
      defaultTranslation: bDefaultTranslation,
      activeThemeId: bDefaultThemeId,
      slideConfig: { ...bibleState.slideConfig, showVerseNumbers: bShowVerseNumbers, maxLines: bMaxLines },
      colorMode: bColorMode,
      autoSendOnDoubleClick: bAutoSend,
      reduceMotion: bReduceMotion,
      highContrast: bHighContrast,
    });
    setBibleSettingsDirty(false);
    setBSaved(true);
    triggerToast(t("mvSettings.toast.bibleSettingsSaved"), "success");
    setTimeout(() => setBSaved(false), 2000);
  }, [bDefaultTranslation, bDefaultThemeId, bShowVerseNumbers, bMaxLines, bColorMode, bAutoSend, bReduceMotion, bHighContrast, bibleDispatch, bibleSetTheme, bibleState.slideConfig, triggerToast]);

  /* ── Appearance helpers ── */
  const handleResetAppearance = useCallback(() => {
    setTheme("dark");
    setAppearance({ palette: "classic-blue", customAccent: "#1D4ED8", fontFamily: "" });
    setDensity("balanced");
    setFontSizeRange(2);
    setHighContrastUI(false);
    setReduceMotion(false);
    setRoundedCorners(true);
    setInterfaceLanguage("en-US");
    void applyInterfaceLanguagePreference("en-US", { broadcast: true });
    update({ theme: "dark", highContrast: false });
    triggerToast(t("mvSettings.toast.appearanceResetToDefaults"), "success");
  }, [update, triggerToast, t]);

  const handleReconnectNow = useCallback(() => {
    triggerToast(t("mvSettings.toast.reconnectingToObs"), "accent");
    const ts = new Date().toLocaleTimeString();
    setObsLogs((prev) => [...prev, { id: Date.now() + 10, timestamp: ts, message: "Manual reconnection triggered.", source: "System" }]);
    setTimeout(() => {
      triggerToast(t("mvSettings.toast.obsReconnected"), "success");
      setObsLogs((prev) => [...prev, { id: Date.now() + 20, timestamp: new Date().toLocaleTimeString(), message: "Handshake restored.", source: "Network" }]);
    }, 1500);
  }, [triggerToast]);

  /* ── Tab descriptions ── */
  const tabDescription = useMemo(() => {
    switch (activeTab) {
      case "general": return t("mvSettings.tabDesc.general");
      case "obs": return t("mvSettings.tabDesc.obs");
      case "broadcast": return "Configure speaker profiles, tied social destinations (YouTube, Facebook, etc.), and OBS stream settings.";
      case "mobile": return t("mvSettings.tabDesc.mobile");
      case "automation": return "Create, run, and store desktop automations for OBS.";
      case "appearance": return t("mvSettings.tabDesc.appearance");
      case "branding": return t("mvSettings.tabDesc.branding");
      case "bible": return "Configure default scripture translation, verse display, and slide presentation.";
      case "usage": return t("mvSettings.tabDesc.usage");
      case "storage": return "Manage local databases, clear cached worship songs, or reset onboarding.";
      case "audio": return t("mvSettings.tabDesc.audio");
    }
  }, [activeTab, t]);

  const currentTabLabel = useMemo(() => {
    for (const group of SETTINGS_CATEGORIES) {
      const match = group.items.find((item) => item.id === activeTab);
      if (match) return match.label;
    }
    return t("mvSettings.page.title");
  }, [activeTab, t]);

  /* ── Mobile Remote state & handlers ── */
  const [mobileServerStatus, setMobileServerStatus] = useState<{ running: boolean; port: number } | null>(null);
  const [mobilePairingInfo, setMobilePairingInfo] = useState<MobilePairingInfo | null>(null);
  const [mobilePairingQrDataUrl, setMobilePairingQrDataUrl] = useState("");
  const [mobileStatusBusy, setMobileStatusBusy] = useState(false);
  const [mobilePairingBusy, setMobilePairingBusy] = useState(false);
  const [isPrintingMobileQr, setIsPrintingMobileQr] = useState(false);
  const [mobileConnectedDevices, _setMobileConnectedDevices] = useState(0);
  const [mobileApprovedDevices, setMobileApprovedDevices] = useState<{ id: string; name: string; lastConnected: string }[]>([]);
  const [mobileDeviceRequests, setMobileDeviceRequests] = useState<{ id: string; name: string; model: string }[]>([]);
  const [mobilePermissions, setMobilePermissions] = useState([
    { key: "slides", icon: Monitor, nameKey: "mvSettings.mobile.permSlides", descKey: "mvSettings.mobile.permSlidesDesc", enabled: true, locked: false, requiredPlan: "" },
    { key: "bible", icon: Globe, nameKey: "mvSettings.mobile.permBible", descKey: "mvSettings.mobile.permBibleDesc", enabled: true, locked: false, requiredPlan: "" },
    { key: "songLyrics", icon: Music, nameKey: "mvSettings.mobile.permSongLyrics", descKey: "mvSettings.mobile.permSongLyricsDesc", enabled: true, locked: false, requiredPlan: "" },
    { key: "automation", icon: Zap, nameKey: "mvSettings.mobile.permAutomation", descKey: "mvSettings.mobile.permAutomationDesc", enabled: false, locked: true, requiredPlan: "Growth" },
  ]);

  const mobilePairingPayload = useMemo(() => {
    if (!mobilePairingInfo) return "";
    return buildMobilePairingPayload(
      mobilePairingInfo,
      settings.mobileDesktopName || "My Church",
    );
  }, [mobilePairingInfo, settings.mobileDesktopName]);

  const mobilePairingPorts = useMemo(
    () => (mobilePairingInfo ? resolveMobilePairingPorts(mobilePairingInfo) : null),
    [mobilePairingInfo],
  );

  const mobileWebUrl = useMemo(() => {
    return mobilePairingInfo ? buildMobileWebUrl(mobilePairingInfo) : "";
  }, [mobilePairingInfo]);

  const handleMobileRefreshStatus = useCallback(async () => {
    setMobileStatusBusy(true);
    try {
      const [status, info] = await Promise.all([
        invoke<{ running: boolean; port: number }>("get_mobile_server_status"),
        invoke<MobilePairingInfo>("get_mobile_pairing_info"),
      ]);
      setMobileServerStatus(status);
      setMobilePairingInfo(info);
      triggerToast(
        status.running
          ? "Mobile connection is ready on this Wi-Fi."
          : "Mobile connection is not running yet.",
        status.running ? "success" : "accent",
      );
    } catch (error) {
      console.error("[MVSettings] Could not refresh mobile status", error);
      triggerToast("Could not refresh mobile connection status.", "accent");
    } finally {
      setMobileStatusBusy(false);
    }
  }, [triggerToast]);

  const handleMobileRefreshPairing = useCallback(async () => {
    setMobilePairingBusy(true);
    try {
      const info = await invoke<MobilePairingInfo>("get_mobile_pairing_info");
      setMobilePairingInfo(info);
      triggerToast("Pairing code refreshed.", "success");
    } catch (error) {
      console.error("[MVSettings] Could not refresh pairing code", error);
      triggerToast("Could not refresh the pairing code.", "accent");
    } finally {
      setMobilePairingBusy(false);
    }
  }, [triggerToast]);

  const handleMobileCopyPayload = useCallback(async () => {
    if (!mobilePairingPayload) {
      triggerToast("Pairing payload is not ready yet.", "accent");
      return;
    }
    const copied = await copyTextToClipboard(mobilePairingPayload);
    if (copied) {
      triggerToast(t("mvSettings.toast.mobileCopied"), "success");
    } else {
      triggerToast("Could not copy the pairing payload.", "accent");
    }
  }, [mobilePairingPayload, triggerToast, t]);

  const handleMobileCopyWebUrl = useCallback(async () => {
    if (!mobileWebUrl) {
      triggerToast("Start Mobile Remote to generate a link.", "accent");
      return;
    }
    const copied = await copyTextToClipboard(mobileWebUrl);
    if (copied) {
      triggerToast("iPhone link copied.", "success");
    } else {
      triggerToast("Could not copy the iPhone link.", "accent");
    }
  }, [mobileWebUrl, triggerToast]);

  const handleMobilePrintQR = useCallback(() => {
    if (!mobilePairingQrDataUrl) {
      triggerToast("The QR code is still loading.", "accent");
      return;
    }
    setIsPrintingMobileQr(true);
  }, [mobilePairingQrDataUrl, triggerToast]);

  const handleMobileOpenWebUrl = useCallback(async () => {
    if (!mobileWebUrl) {
      triggerToast("Start Mobile Remote to generate a link.", "accent");
      return;
    }
    try {
      await openUrl(mobileWebUrl);
    } catch {
      const opened = window.open(mobileWebUrl, "_blank", "noopener,noreferrer");
      if (!opened) triggerToast("Could not open the iPhone link.", "accent");
    }
  }, [mobileWebUrl, triggerToast]);

  const handleMobileRenameDevice = useCallback(async (device: { id: string; name: string }) => {
    const newName = prompt(t("mvSettings.mobile.renamePrompt"), device.name);
    if (newName && newName.trim()) {
      setMobileApprovedDevices((prev) => prev.map((d) => d.id === device.id ? { ...d, name: newName.trim() } : d));
      triggerToast(t("mvSettings.toast.mobileDeviceRenamed"), "success");
    }
  }, [triggerToast, t]);

  const handleMobileDisconnectDevice = useCallback((device: { id: string }) => {
    setMobileApprovedDevices((prev) => prev.filter((d) => d.id !== device.id));
    triggerToast(t("mvSettings.toast.mobileDeviceRejected"), "success");
  }, [triggerToast, t]);

  const handleMobileRemoveDevice = useCallback((device: { id: string }) => {
    setMobileApprovedDevices((prev) => prev.filter((d) => d.id !== device.id));
    triggerToast(t("mvSettings.toast.mobileDeviceRemoved"), "success");
  }, [triggerToast, t]);

  const handleMobileApproveRequest = useCallback((request: { id: string; name: string }) => {
    setMobileApprovedDevices((prev) => [...prev, { id: request.id, name: request.name, lastConnected: t("mvSettings.mobile.justNow") }]);
    setMobileDeviceRequests((prev) => prev.filter((r) => r.id !== request.id));
    triggerToast(t("mvSettings.toast.mobileDeviceApproved"), "success");
  }, [triggerToast, t]);

  const handleMobileRejectRequest = useCallback((request: { id: string }) => {
    setMobileDeviceRequests((prev) => prev.filter((r) => r.id !== request.id));
    triggerToast(t("mvSettings.toast.mobileDeviceRejected"), "success");
  }, [triggerToast, t]);

  const handleMobilePermToggle = useCallback((key: string, enabled: boolean) => {
    setMobilePermissions((prev) => prev.map((p) => p.key === key ? { ...p, enabled } : p));
  }, []);

  /* Fetch pairing info whenever the Mobile settings tab is opened. */
  useEffect(() => {
    if (activeTab !== "mobile") return;
    let mounted = true;
    invoke<MobilePairingInfo>("get_mobile_pairing_info")
      .then((info) => { if (mounted) setMobilePairingInfo(info); })
      .catch(() => { });
    return () => { mounted = false; };
  }, [activeTab]);

  /* Poll server status every 3s while Mobile settings is open. */
  useEffect(() => {
    if (activeTab !== "mobile") return;
    let mounted = true;
    const poll = async () => {
      try {
        const [status, info] = await Promise.all([
          invoke<{ running: boolean; port: number }>("get_mobile_server_status"),
          invoke<MobilePairingInfo>("get_mobile_pairing_info"),
        ]);
        if (mounted) {
          setMobileServerStatus(status);
          setMobilePairingInfo(info);
        }
      } catch { /* backend not available */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, [activeTab]);

  useEffect(() => {
    if (!mobilePairingPayload) {
      setMobilePairingQrDataUrl("");
      return;
    }
    let mounted = true;
    void QRCode.toDataURL(mobilePairingPayload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0B1426", light: "#FFFFFF" },
    }).then((dataUrl) => {
      if (mounted) setMobilePairingQrDataUrl(dataUrl);
    }).catch(() => {
      if (mounted) setMobilePairingQrDataUrl("");
    });
    return () => { mounted = false; };
  }, [mobilePairingPayload]);

  useEffect(() => {
    if (!isPrintingMobileQr) return;

    const handleAfterPrint = () => setIsPrintingMobileQr(false);
    window.addEventListener("afterprint", handleAfterPrint);
    const printTimer = window.setTimeout(() => {
      try {
        window.print();
      } catch (error) {
        console.error("[MVSettings] Could not open QR print dialog", error);
        setIsPrintingMobileQr(false);
        triggerToast("Could not open the print dialog.", "accent");
      }
    }, 100);

    return () => {
      window.clearTimeout(printTimer);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [isPrintingMobileQr, triggerToast]);

  return (
    <div
      className={`settings-page density-${density} font-scale-${fontSizeRange === 1 ? "small" : fontSizeRange === 2 ? "medium" : "large"}`}
      data-theme={effectiveTheme}
      data-contrast={highContrastUI ? "high" : "standard"}
      data-reduced-motion={reduceMotion ? "true" : "false"}
      data-roundness={roundedCorners ? "standard" : "none"}
    >
      {isPrintingMobileQr && mobilePairingQrDataUrl && (
        <div className="mr-qr-print-view" aria-hidden="true">
          <h1>MakeChurchEazy</h1>
          <img src={mobilePairingQrDataUrl} alt="QR Pairing Code" />
          <p>{t("mvSettings.mobile.qrCode")} {mobilePairingInfo?.pairingToken ?? ""}</p>
        </div>
      )}
      {/* Toast stack */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item ${toast.type === "success" ? "success-toast" : ""}`}>
            <span className={`toast-icon-box ${toast.type === "success" ? "success-toast" : "accent-toast"}`}>
              <CheckCircle size={16} />
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Main Settings Shell */}
      <div className="settings-shell">
        {/* Left Settings Navigation Sidebar */}
        <aside className="settings-nav-sidebar">
          <div className="settings-nav-sidebar-header">
            <h2 className="settings-nav-title">{t("mvSettings.page.title", "Settings")}</h2>
          </div>
          <div className="settings-nav-groups">
            {SETTINGS_CATEGORIES.map((category) => (
              <div key={category.group} className="settings-nav-group">
                <span className="settings-nav-group-label">{category.group}</span>
                <div className="settings-nav-group-items">
                  {category.items.map((item) => {
                    const Icon = item.icon;
                    const soon = Boolean(item.comingSoon);
                    const isActive = !soon && activeTab === item.id;
                    const isBroadcast = item.id === "broadcast";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`settings-nav-item ${isActive ? "active" : ""}${soon ? " is-coming-soon" : ""}`}
                        disabled={soon}
                        aria-disabled={soon}
                        title={soon ? "Coming soon" : undefined}
                        onClick={() => { if (!soon) setActiveTab(item.id); }}
                      >
                        {isBroadcast && (
                          <span
                            className="broadcast-pulse-dot broadcast-pulse-dot--ready"
                            style={{ width: "6px", height: "6px", marginRight: "6px" }}
                          />
                        )}
                        <Icon size={16} className="settings-nav-item-icon" />
                        <span className="settings-nav-item-text">{item.label}</span>
                        {soon && <span className="settings-nav-soon">Soon</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right Main Viewport */}
        <div className="settings-main-viewport">
          <header className="main-header">
            <div className="title-group">
              <h2 className="main-title">{currentTabLabel}</h2>
              <p className="main-description">{tabDescription}</p>
            </div>
            <div className="settings-viewport-actions">
              {activeTab === "bible" && (
                <button className="action-btn btn-primary" onClick={handleSaveBible} title="Save Bible Settings">
                  <Save size={14} /> <span>Save Bible Settings</span>
                </button>
              )}
              {activeTab === "general" && (
                <>
                  <button className="action-btn" onClick={handleResetSettings} title="Reset General Defaults">
                    <RotateCcw size={14} /> <span>{t("mvSettings.page.resetDefaults")}</span>
                  </button>
                  <button className="action-btn" onClick={handleCheckForUpdates} disabled={manualUpdateBusy} title={t("mvSettings.general.checkForUpdates")}>
                    <RefreshCw size={14} className={effectiveUpdateStatus === "checking" ? "animate-spin" : ""} />
                    <span>{effectiveUpdateStatus === "checking" ? t("mvSettings.general.checkingForUpdates") : t("mvSettings.general.checkForUpdates")}</span>
                  </button>
                </>
              )}
              {activeTab === "obs" && (
                <button className="action-btn btn-primary" onClick={handleTestObs} disabled={obsStatus === "connecting"} title="Test OBS Connection">
                  {obsStatus === "connecting" ? (<><RefreshCw size={14} className="animate-spin" /><span>{t("mvSettings.obs.connecting")}</span></>) : (<><CheckCircle size={14} /><span>{t("mvSettings.obs.testConnection")}</span></>)}
                </button>
              )}
              {activeTab === "appearance" && (
                <button className="action-btn" onClick={handleResetAppearance} title="Reset Appearance">
                  <RotateCcw size={14} /> <span>{t("mvSettings.page.resetDefaults")}</span>
                </button>
              )}
              {activeTab === "branding" && (
                <button className="action-btn" onClick={handleResetBrandingSettings} title="Reset Branding">
                  <RotateCcw size={14} /> <span>{t("mvSettings.page.resetDefaults")}</span>
                </button>
              )}
              {activeTab === "audio" && (
                <button className="action-btn" onClick={refreshAudioMics} disabled={audioMicsLoading} title="Rescan Audio Devices">
                  <RefreshCw size={14} className={audioMicsLoading ? "animate-spin" : ""} />
                  <span>Rescan Devices</span>
                </button>
              )}
            </div>
          </header>

          {/* Scrollable content pane */}
          <div className="main-scroll-pane">
            <div className={`settings-grid ${hasSettingsSidebar ? "" : "settings-grid--no-sidebar"} ${activeTab === "usage" ? "settings-grid--usage" : ""}`}>
              {/* Main form column */}
              <div className="settings-form-column">

              {/* ══════════════ GENERAL TAB ══════════════ */}
              {activeTab === "general" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">{t("mvSettings.general.studioPreferences")}</h3>
                    <p className="section-desc">{t("mvSettings.general.studioPreferencesDesc")}</p>
                  </div>

                  <div className="settings-card fields-rows-stack">
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <span className="switch-title">{t("mvSettings.general.globalInterfaceLanguage")}</span>
                        <span className="switch-subtitle">{t("mvSettings.general.globalInterfaceLanguageDesc")}</span>
                      </div>
                      <div className="form-select-container" style={{ width: "180px" }}>
                        <select className="custom-select" value={interfaceLanguage} onChange={(e) => { setPendingLanguage(e.target.value); setShowLanguageModal(true); }}>
                          {INTERFACE_LOCALES.map((lang) => (
                            <option key={lang.code} value={lang.code}>{lang.nativeName}</option>
                          ))}
                        </select>
                        <span className="select-arrow"><ChevronDown size={14} /></span>
                      </div>
                    </div>
                  </div>

                  {/* ── Global Module Defaults ── */}
                  {/* About */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">{t("mvSettings.general.aboutTitle")}</h3>
                    </div>
                    <div className="settings-card">
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <AppLogo alt="MakeChurchEazy" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain" }} />
                        <div>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>MakeChurchEazy</p>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Version {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0"}</p>
                        </div>
                      </div>
                      <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>
                        {t("mvSettings.general.aboutDescription")}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                        <button
                          className="action-btn"
                          onClick={handleCheckForUpdates}
                          disabled={manualUpdateBusy}
                          title={t("mvSettings.general.checkForUpdates")}
                        >
                          <RefreshCw size={14} className={effectiveUpdateStatus === "checking" ? "animate-spin" : ""} />
                          <span>
                            {effectiveUpdateStatus === "checking"
                              ? t("mvSettings.general.checkingForUpdates")
                              : t("mvSettings.general.checkForUpdates")}
                          </span>
                        </button>
                        {effectiveUpdateStatus === "available" && (
                          <>
                            <button
                              className="action-btn btn-primary"
                              onClick={() => void handleInstallUpdate(false)}
                              title={t("mvSettings.general.installUpdate")}
                            >
                              <ExternalLink size={14} />
                              <span>{t("mvSettings.general.installUpdate")}</span>
                            </button>
                            <button
                              className="action-btn"
                              onClick={() => void handleInstallUpdate(true)}
                              title="Download quietly; restart when you are ready"
                            >
                              <span>Update in Background</span>
                            </button>
                          </>
                        )}
                        {effectiveUpdateStatus === "ready" && (
                          <button
                            className="action-btn btn-primary"
                            onClick={() => void updateDownloadManager.installNow()}
                            title="Install the downloaded update and restart"
                          >
                            <RefreshCw size={14} />
                            <span>Restart to Update{downloadState.version ? ` (v${downloadState.version})` : ""}</span>
                          </button>
                        )}
                      </div>
                      {(downloadState.errorMsg || manualUpdateMessage) && (
                        <p style={{
                          color: effectiveUpdateStatus === "error" ? "var(--danger-color)" : "var(--text-muted)",
                          fontSize: 12,
                          margin: "10px 0 0",
                        }}>
                          {downloadState.errorMsg || manualUpdateMessage}
                        </p>
                      )}
                      {(effectiveUpdateStatus === "downloading" || effectiveUpdateStatus === "installing" || effectiveUpdateStatus === "relaunching") && (
                        <div className="progress-container">
                          <div className="progress-info">
                            <span>
                              {effectiveUpdateStatus === "downloading"
                                ? t("mvSettings.general.downloadingUpdate")
                                : effectiveUpdateStatus === "installing"
                                  ? t("mvSettings.general.installingUpdate")
                                  : t("mvSettings.general.relaunchingUpdate")}
                            </span>
                            <span>
                              {effectiveUpdateStatus === "downloading"
                                ? `${manualUpdatePercent}% · ${formatUpdateBytes(effectiveUpdateProgress.downloaded)} / ${formatUpdateBytes(effectiveUpdateProgress.contentLength)}`
                                : ""}
                            </span>
                          </div>
                          <div className="progress-track-bg">
                            <div
                              className="progress-track-fill"
                              style={{ width: effectiveUpdateStatus === "downloading" ? `${manualUpdatePercent}%` : "100%" }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>




                </div>
              )}

              {/* ══════════════ LIVE BROADCAST TAB ══════════════ */}
              {activeTab === "broadcast" && (
                <BroadcastSettingsPanel onToast={(msg, tone) => triggerToast(msg, tone === "error" ? "accent" : "success")} />
              )}

              {/* ══════════════ OBS CONNECTION TAB ══════════════ */}
              {activeTab === "obs" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">OBS Studio WebSocket</h3>
                    <p className="section-desc">{t("mvSettings.obs.webSocketDesc")}</p>
                  </div>

                  <div className="settings-card fields-rows-stack">
                    {/* Live Status Card */}
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      borderRadius: "var(--radius)",
                      background: obsStatus === "connected" ? "rgba(34, 197, 94, 0.08)" : obsStatus === "connecting" ? "rgba(245, 158, 11, 0.08)" : "rgba(239, 68, 68, 0.08)",
                      border: `1px solid ${obsStatus === "connected" ? "rgba(34, 197, 94, 0.25)" : obsStatus === "connecting" ? "rgba(245, 158, 11, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor: obsStatus === "connected" ? "var(--success-color)" : obsStatus === "connecting" ? "var(--warning)" : "var(--danger-color)",
                          boxShadow: obsStatus === "connected" ? "0 0 8px var(--success-color)" : "none",
                        }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                            {obsStatus === "connected" ? "Connected to OBS Studio" : obsStatus === "connecting" ? "Connecting to OBS..." : "Disconnected from OBS Studio"}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                            {obsStatus === "connected" ? "WebSocket v5 server responding at " + (settings.obsUrl || "ws://localhost:4455") : "Ensure OBS is running with WebSocket server enabled"}
                          </div>
                        </div>
                      </div>
                      <span className="feature-tag-pill" style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        background: obsStatus === "connected" ? "rgba(34,197,94,0.15)" : obsStatus === "connecting" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                        color: obsStatus === "connected" ? "var(--success-color)" : obsStatus === "connecting" ? "var(--warning)" : "var(--danger-color)",
                      }}>
                        {obsStatus}
                      </span>
                    </div>

                    <hr className="settings-divider" />

                    {/* Server address */}
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.obs.webSocketHostAddress")}</label>
                      <div className="custom-input-container">
                        <input
                          type="text"
                          className="custom-textbox"
                          value={settings.obsUrl}
                          onChange={(e) => update({ obsUrl: e.target.value })}
                          placeholder="ws://localhost:4455"
                        />
                        <button
                          className="action-btn btn-primary"
                          onClick={handleTestObs}
                          disabled={obsStatus === "connecting"}
                          title="Test OBS Connection"
                        >
                          {obsStatus === "connecting" ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" />
                              <span>{t("mvSettings.obs.connecting")}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle size={14} />
                              <span>{t("mvSettings.obs.testConnection")}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <span className="mv-settings-hint" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px", display: "block" }}>
                        Default OBS WebSocket v5 port is 4455. In OBS: Tools &rarr; WebSocket Server Settings.
                      </span>
                    </div>

                    {/* Password */}
                    <div className="form-group" style={{ marginTop: "12px" }}>
                      <label className="form-label">{t("mvSettings.obs.passwordOptional")}</label>
                      <div className="custom-input-container">
                        <input
                          type="password"
                          className="custom-textbox"
                          value={obsPasswordDraft}
                          onChange={(e) => setObsPasswordDraft(e.target.value)}
                          placeholder={t("mvSettings.obs.obsAuthKey")}
                        />
                      </div>
                      <span className="mv-settings-hint" style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                        {t("mvSettings.obs.storedInSession")}
                      </span>
                    </div>

                    {obsTestResult && (
                      <p style={{
                        fontSize: 12,
                        padding: "8px 12px",
                        borderRadius: "var(--radius)",
                        background: obsStatus === "connected" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: obsStatus === "connected" ? "var(--success-color)" : "var(--danger-color)",
                      }}>
                        {obsStatus === "connected" ? "✓ " : "✗ "} {obsTestResult}
                      </p>
                    )}

                    <hr className="settings-divider" />

                    {/* Connection rules */}
                    <div>
                      <h4 className="form-label" style={{ marginBottom: "16px" }}>{t("mvSettings.obs.connectionRules")}</h4>
                      <div className="switch-row" style={{ padding: "10px 0" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.obs.autoReconnectFallback")}</span>
                          <span className="switch-subtitle">{t("mvSettings.obs.autoReconnectDesc")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={settings.obsAutoReconnect}
                            onChange={() => update({ obsAutoReconnect: !settings.obsAutoReconnect })}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════ AUDIO & VOICE AI TAB ══════════════ */}
              {activeTab === "audio" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">Microphone & Speech-to-Scripture</h3>
                    <p className="section-desc">
                      Configure your primary audio input, adjust software pre-amp gain, and monitor real-time speech detection levels.
                    </p>
                  </div>

                  <div className="settings-card fields-rows-stack">
                    {/* Microphone Device Selection */}
                    <div className="form-group">
                      <div className="flex-between-center" style={{ marginBottom: "8px" }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>
                          Preferred Microphone Input
                        </label>
                        <button
                          type="button"
                          className="action-btn"
                          style={{ padding: "4px 8px", fontSize: "12px", height: "auto" }}
                          onClick={refreshAudioMics}
                          disabled={audioMicsLoading}
                        >
                          <RefreshCw size={12} className={audioMicsLoading ? "animate-spin" : ""} />
                          <span>{audioMicsLoading ? "Scanning..." : "Rescan"}</span>
                        </button>
                      </div>
                      <div className="form-select-container">
                        <select
                          className="custom-select"
                          value={selectedMicId}
                          onChange={(e) => handleMicChange(e.target.value)}
                        >
                          <option value="">Default System Microphone</option>
                          {audioMics.map((mic) => (
                            <option key={mic.id} value={mic.id}>
                              {mic.label || `Microphone (${mic.id.slice(0, 8)}...)`}
                            </option>
                          ))}
                        </select>
                        <span className="select-arrow"><ChevronDown size={14} /></span>
                      </div>
                      <p className="form-help-text" style={{ marginTop: "6px" }}>
                        MakeChurchEazy listens to this microphone feed to detect spoken verses during live preaching.
                      </p>
                    </div>

                    <hr className="settings-divider" />

                    {/* Microphone Gain / Pre-amp */}
                    <div className="form-group">
                      <div className="flex-between-center" style={{ marginBottom: "8px" }}>
                        <div className="switch-left">
                          <label className="form-label" style={{ marginBottom: "2px", display: "block" }}>Input Gain & Digital Pre-amp</label>
                          <span className="switch-subtitle" style={{ display: "block" }}>Boost microphone pickup sensitivity before speech recognition processing.</span>
                        </div>
                        <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "13px", color: "var(--accent-color)" }}>
                          {inputGainDraft}%
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <input
                          type="range"
                          min={0}
                          max={300}
                          step={5}
                          value={inputGainDraft}
                          onChange={(e) => handleGainChange(Number(e.target.value))}
                          style={{ flex: 1, accentColor: "var(--accent-color)" }}
                        />
                        <button
                          type="button"
                          className="action-btn"
                          style={{ padding: "4px 10px", fontSize: "12px", height: "28px" }}
                          onClick={() => handleGainChange(100)}
                          title="Reset to 100%"
                        >
                          100%
                        </button>
                      </div>
                    </div>

                    <hr className="settings-divider" />

                    {/* Live VU Meter */}
                    <div className="form-group">
                      <div className="flex-between-center" style={{ marginBottom: "6px" }}>
                        <span className="form-label" style={{ marginBottom: 0, display: "block" }}>Input Level Meter</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {liveAudioLevel > 0.02 ? (
                            <>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981", display: "inline-block" }} />
                              <span style={{ fontSize: "12px", color: "#10b981", fontWeight: 600 }}>Signal Active ({Math.round(liveAudioLevel * 100)}%)</span>
                            </>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No Signal</span>
                          )}
                        </div>
                      </div>
                      <div style={{
                        width: "100%",
                        height: "10px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "5px",
                        overflow: "hidden",
                        border: "1px solid var(--border-color)",
                        position: "relative"
                      }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(100, Math.round(liveAudioLevel * 100))}%`,
                          backgroundColor: liveAudioLevel > 0.85 ? "#ef4444" : liveAudioLevel > 0.6 ? "#f59e0b" : "#10b981",
                          transition: "width 60ms linear"
                        }} />
                      </div>
                      <p className="form-help-text" style={{ marginTop: "6px" }}>
                        Speak into your pulpit or headset mic. The meter should fluctuate in the green/amber zone.
                      </p>
                    </div>
                  </div>

                  {/* Speech Detection & Offline Engine Card */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">Voice AI Engine & Offline Capabilities</h3>
                      <p className="section-desc">Local and cloud processing options for real-time live captioning and verse detection.</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      <div className="flex-between-center">
                        <div className="switch-left">
                          <span className="switch-title">Default Bible Version for Spoken Scriptures</span>
                          <span className="switch-subtitle">When a preacher references a chapter and verse, project verses from this version by default.</span>
                        </div>
                        <div className="form-select-container" style={{ width: "220px" }}>
                          <select
                            className="custom-select"
                            value={bDefaultTranslation}
                            onChange={(e) => {
                              setBDefaultTranslation(e.target.value as BibleTranslation);
                              setBibleSettingsDirty(true);
                            }}
                          >
                            {bTranslations.map((tr) => (
                              <option key={tr.value} value={tr.value}>{tr.label}</option>
                            ))}
                          </select>
                          <span className="select-arrow"><ChevronDown size={14} /></span>
                        </div>
                      </div>

                      <div className="flex-between-center" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">Local Whisper Offline Engine</span>
                          <span className="switch-subtitle">High-speed on-device speech processing fallback when internet connectivity drops.</span>
                        </div>
                        <span className="badge" style={{ padding: "4px 10px", fontSize: "12px", background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", borderRadius: "999px", fontWeight: 600 }}>
                          Coming Soon
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════ MOBILE REMOTE TAB ══════════════ */}
              {activeTab === "mobile" && (
                hasMobileAccess ? (
                  <div className="settings-section mr-mobile-settings-section">
                    <div className="mr-mobile-primary-grid">
                      <div className="mr-mobile-primary-stack">
                        {/* ── Section 1: Enable Mobile Remote ── */}
                        <div className="mr-mobile-primary-section">
                          <div className="section-header">
                            <h3 className="section-title">{t("mvSettings.mobile.enable")}</h3>
                          </div>
                          <div className="settings-card">
                            <div className="switch-row">
                              <div className="switch-left">
                                <span className="switch-title">{t("mvSettings.mobile.enableDesc")}</span>
                                <span className="switch-subtitle">{t("mvSettings.mobile.enableHint")}</span>
                              </div>
                              <label className="switch-toggle-label">
                                <input
                                  type="checkbox"
                                  checked={settings.mobileRemoteEnabled}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    db.updateSettings({ mobileRemoteEnabled: next });
                                    setSettings(db.getSettings());
                                  }}
                                />
                                <span className="switch-slider"></span>
                              </label>
                            </div>
                          </div>
                        </div>

                        {/* ── Section 2: Connection Status ── */}
                        <div className="mr-mobile-primary-section">
                          <div className="section-header">
                            <h3 className="section-title">{t("mvSettings.mobile.status")}</h3>
                          </div>
                          <div className="settings-card">
                            <div className="mr-status-grid">
                              <div className="mr-status-item">
                                <span className="mr-status-label">{t("mvSettings.mobile.statusServer")}</span>
                                <span className={`mr-status-badge ${mobileServerStatus?.running ? "mr-status-on" : "mr-status-off"}`}>
                                  {mobileServerStatus?.running ? t("mvSettings.mobile.statusRunning") : t("mvSettings.mobile.statusStopped")}
                                </span>
                              </div>
                              <div className="mr-status-item">
                                <span className="mr-status-label">{t("mvSettings.mobile.statusWsPort")}</span>
                                <span className="mr-status-value">
                                  {mobilePairingPorts?.wsPort ?? mobileServerStatus?.port ?? "—"}
                                </span>
                              </div>
                              <div className="mr-status-item">
                                <span className="mr-status-label">{t("mvSettings.mobile.statusApiPort")}</span>
                                <span className="mr-status-value">{mobilePairingPorts?.apiPort ?? "—"}</span>
                              </div>
                              <div className="mr-status-item">
                                <span className="mr-status-label">{t("mvSettings.mobile.statusDevices")}</span>
                                <span className="mr-status-value">{mobileConnectedDevices}</span>
                              </div>
                            </div>
                            <div className="mr-status-actions">
                              <button
                                type="button"
                                className="action-btn secondary"
                                onClick={handleMobileRefreshStatus}
                                disabled={mobileStatusBusy}
                              >
                                <RefreshCw size={14} className={mobileStatusBusy ? "animate-spin" : ""} />
                                {mobileStatusBusy ? "Refreshing..." : "Refresh status"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── Section 3: QR Pairing ── */}
                      <div className="mr-mobile-primary-section mr-mobile-primary-section--qr">
                        <div className="section-header">
                          <h3 className="section-title">{t("mvSettings.mobile.qrTitle")}</h3>
                        </div>
                        <div className="settings-card mr-mobile-qr-card">
                          <p className="section-desc">{t("mvSettings.mobile.qrDesc")}</p>
                          <div className="mr-qr-container">
                            <div className="mr-qr-box">
                              {mobilePairingQrDataUrl ? (
                                <img
                                  src={mobilePairingQrDataUrl}
                                  alt="QR Code"
                                  className="mr-qr-image"
                                />
                              ) : null}
                              <div className="mr-qr-fallback" style={{ display: mobilePairingQrDataUrl ? "none" : "flex" }}>
                                <Smartphone size={48} />
                              </div>
                            </div>
                            <div className="mr-qr-info">
                              <div className="mr-qr-code-display">
                                <span className="mr-qr-code-label">{t("mvSettings.mobile.qrCode")}</span>
                                <span className="mr-qr-code-value">{mobilePairingInfo?.pairingToken ?? "------"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="mr-qr-actions">
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={handleMobileRefreshPairing}
                              disabled={mobilePairingBusy}
                            >
                              <RefreshCw size={14} className={mobilePairingBusy ? "animate-spin" : ""} />
                              {mobilePairingBusy ? "Refreshing..." : t("mvSettings.mobile.qrRefresh")}
                            </button>
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={handleMobileCopyPayload}
                              disabled={!mobilePairingPayload}
                            >
                              <Copy size={14} /> {t("mvSettings.mobile.qrCopy")}
                            </button>
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={handleMobilePrintQR}
                              disabled={!mobilePairingQrDataUrl || isPrintingMobileQr}
                            >
                              <Printer size={14} /> {t("mvSettings.mobile.qrPrint")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Section 4: iPhone / iPad PWA ── */}
                    <div className="section-header" style={{ marginTop: 24 }}>
                      <h3 className="section-title">iPhone / iPad Web App</h3>
                    </div>
                    <div className="settings-card mr-pwa-card">
                      <div className="mr-pwa-heading">
                        <div className="mr-pwa-icon">
                          <Smartphone size={18} />
                        </div>
                        <div>
                          <h4 className="mr-pwa-title">Use MakeChurchEazy in Safari</h4>
                          <p className="section-desc">
                            On the same Wi-Fi, paste this local link into Safari. Then use Share → Add to Home Screen.
                          </p>
                        </div>
                      </div>
                      <div className="mr-pwa-url-row">
                        <input
                          className="mr-pwa-url"
                          value={mobileWebUrl || "Start Mobile Remote to generate a link"}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                          aria-label="Local iPhone web app link"
                        />
                        <button
                          type="button"
                          className="action-btn secondary"
                          onClick={handleMobileCopyWebUrl}
                          disabled={!mobileWebUrl}
                        >
                          <Copy size={14} /> Copy link
                        </button>
                        <button
                          type="button"
                          className="action-btn secondary"
                          onClick={handleMobileOpenWebUrl}
                          disabled={!mobileWebUrl}
                        >
                          <ExternalLink size={14} /> Open
                        </button>
                      </div>
                      <p className="mr-pwa-hint">
                        This link is local to this desktop and includes the current pairing code. Keep both devices on the same Wi-Fi.
                      </p>
                    </div>

                    <div className="mr-device-panels">
                      {/* ── Section 5: Approved Devices ── */}
                      <div className="mr-device-panel">
                        <div className="section-header">
                          <h3 className="section-title">{t("mvSettings.mobile.approvedDevices")}</h3>
                        </div>
                        <div className="settings-card">
                          <p className="section-desc">{t("mvSettings.mobile.approvedDevicesDesc")}</p>
                          {mobileApprovedDevices.length === 0 ? (
                            <p className="mr-empty-state">{t("mvSettings.mobile.noDevices")}</p>
                          ) : (
                            <div className="mr-device-list">
                              {mobileApprovedDevices.map((device) => (
                                <div key={device.id} className="mr-device-item">
                                  <div className="mr-device-info">
                                    <Smartphone size={16} className="mr-device-icon" />
                                    <span className="mr-device-name">{device.name}</span>
                                    <span className="mr-device-last">{device.lastConnected}</span>
                                  </div>
                                  <div className="mr-device-actions">
                                    <button type="button" className="action-btn small secondary" onClick={() => handleMobileRenameDevice(device)}>
                                      {t("mvSettings.mobile.rename")}
                                    </button>
                                    <button type="button" className="action-btn small secondary" onClick={() => handleMobileDisconnectDevice(device)}>
                                      {t("mvSettings.mobile.disconnect")}
                                    </button>
                                    <button type="button" className="action-btn small danger" onClick={() => handleMobileRemoveDevice(device)}>
                                      {t("mvSettings.mobile.remove")}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Section 6: Device Requests ── */}
                      <div className="mr-device-panel">
                        <div className="section-header">
                          <h3 className="section-title">{t("mvSettings.mobile.deviceRequests")}</h3>
                        </div>
                        <div className="settings-card">
                          <p className="section-desc">{t("mvSettings.mobile.deviceRequestsDesc")}</p>
                          {mobileDeviceRequests.length === 0 ? (
                            <p className="mr-empty-state">{t("mvSettings.mobile.noRequests")}</p>
                          ) : (
                            <div className="mr-device-list">
                              {mobileDeviceRequests.map((request) => (
                                <div key={request.id} className="mr-device-item mr-device-pending">
                                  <div className="mr-device-info">
                                    <Bell size={16} className="mr-device-icon" />
                                    <span className="mr-device-name">{request.name}</span>
                                    <span className="mr-device-model">{request.model}</span>
                                  </div>
                                  <div className="mr-device-actions">
                                    <button type="button" className="action-btn small primary" onClick={() => handleMobileApproveRequest(request)}>
                                      {t("mvSettings.mobile.approve")}
                                    </button>
                                    <button type="button" className="action-btn small danger" onClick={() => handleMobileRejectRequest(request)}>
                                      {t("mvSettings.mobile.reject")}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Section 7: Mobile Permissions ── */}
                    <div className="section-header" style={{ marginTop: 24 }}>
                      <h3 className="section-title">{t("mvSettings.mobile.permissions")}</h3>
                    </div>
                    <div className="settings-card">
                      <p className="section-desc">{t("mvSettings.mobile.permissionsDesc")}</p>
                      <div className="mr-permissions-list">
                        {mobilePermissions.map((perm) => (
                          <div key={perm.key} className={`mr-perm-item ${perm.locked ? "mr-perm-locked" : ""}`}>
                            <div className="mr-perm-icon">
                              <perm.icon size={18} />
                            </div>
                            <div className="mr-perm-info">
                              <span className="mr-perm-name">{t(perm.nameKey)}</span>
                              <span className="mr-perm-desc">{t(perm.descKey)}</span>
                            </div>
                            {perm.locked ? (
                              <span className="mr-perm-badge">{t("mvSettings.mobile.permLocked", { plan: perm.requiredPlan })}</span>
                            ) : (
                              <label className="switch-toggle-label">
                                <input
                                  type="checkbox"
                                  checked={perm.enabled}
                                  onChange={(e) => handleMobilePermToggle(perm.key, e.target.checked)}
                                />
                                <span className="switch-slider"></span>
                              </label>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Section 8: Security ── */}
                    <div className="section-header" style={{ marginTop: 24 }}>
                      <h3 className="section-title">{t("mvSettings.mobile.security")}</h3>
                    </div>
                    <div className="settings-card">
                      <p className="section-desc">{t("mvSettings.mobile.securityDesc")}</p>

                      <div className="switch-row">
                        <div>
                          <p className="switch-label">{t("mvSettings.mobile.secRequireApproval")}</p>
                          <p className="switch-hint">{t("mvSettings.mobile.secRequireApprovalDesc")}</p>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={settings.mobileRequireApproval}
                            onChange={(e) => {
                              db.updateSettings({ mobileRequireApproval: e.target.checked });
                              setSettings(db.getSettings());
                            }}
                          />
                          <span className="switch-slider"></span>
                        </label>
                      </div>

                      <div className="switch-row">
                        <div>
                          <p className="switch-label">{t("mvSettings.mobile.secAllowMultiple")}</p>
                          <p className="switch-hint">{t("mvSettings.mobile.secAllowMultipleDesc")}</p>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={settings.mobileAllowMultipleDevices}
                            onChange={(e) => {
                              db.updateSettings({ mobileAllowMultipleDevices: e.target.checked });
                              setSettings(db.getSettings());
                            }}
                          />
                          <span className="switch-slider"></span>
                        </label>
                      </div>

                      <div className="form-group">
                        <label className="form-label">{t("mvSettings.mobile.secMaxDevices")}</label>
                        <p className="switch-hint">{t("mvSettings.mobile.secMaxDevicesDesc")}</p>
                        <input
                          type="number"
                          className="form-input"
                          min={1}
                          max={20}
                          value={settings.mobileMaxDevices}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(20, parseInt(e.target.value) || 3));
                            db.updateSettings({ mobileMaxDevices: val });
                            setSettings(db.getSettings());
                          }}
                        />
                      </div>

                      <div className="switch-row">
                        <div>
                          <p className="switch-label">{t("mvSettings.mobile.secAutoRemove")}</p>
                          <p className="switch-hint">{t("mvSettings.mobile.secAutoRemoveDesc")}</p>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={settings.mobileAutoRemoveInactive}
                            onChange={(e) => {
                              db.updateSettings({ mobileAutoRemoveInactive: e.target.checked });
                              setSettings(db.getSettings());
                            }}
                          />
                          <span className="switch-slider"></span>
                        </label>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="settings-section">
                    <div className="settings-card" style={{ textAlign: "center", padding: "48px 32px" }}>
                      <div style={{ marginBottom: 16 }}><Lock size={48} /></div>
                      <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>
                        {t("mvSettings.mobile.upgradeTitle")}
                      </h3>
                      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
                        {t("mvSettings.mobile.upgradeDesc")}
                      </p>
                      <button
                        className="mv-btn mv-btn--primary"
                        onClick={() => setShowMobileUpgrade(true)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px" }}
                      >
                        <Zap size={18} />
                        {t("mvSettings.mobile.upgradeBtn")}
                      </button>
                    </div>
                  </div>
                )
              )}

              {/* ══════════════ AUTOMATION TAB ══════════════ */}
              {activeTab === "automation" && <AutomationSettingsPanel />}

              {/* ══════════════ APPEARANCE TAB ══════════════ */}
              {activeTab === "appearance" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">{t("mvSettings.appearance.designAndLayout")}</h3>
                    <p className="section-desc">{t("mvSettings.tabDesc.appearance")}</p>
                  </div>

                  <div className="settings-card fields-rows-stack">
                    {/* Theme mode */}
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.appearance.interfaceTheme")}</label>
                      <div className="grid-3-col" style={{ marginTop: "4px" }}>
                        {([
                          ["dark", Moon, t("mvSettings.appearance.dark")],
                          ["light", Sun, t("mvSettings.appearance.light")],
                          ["system", Monitor, t("mvSettings.appearance.system")],
                        ] as const).map(([id, IconComp, label]) => (
                          <label key={id} className="option-select-card">
                            <input type="radio" name="theme_mode" checked={theme === id} onChange={() => { setTheme(id); update({ theme: id } as any); }} />
                            <div className="option-select-inner" style={{ padding: "12px", textAlign: "center" }}>
                              <div className="checked-indicator"><Check size={10} /></div>
                              <div className="density-icon-box" style={{ margin: "0 auto", background: theme === id ? "rgba(var(--accent-rgb), 0.15)" : "var(--bg-card-hover)", color: theme === id ? "var(--accent-color)" : "var(--text-secondary)" }}>
                                <IconComp size={16} />
                              </div>
                              <span className="option-title" style={{ marginTop: "8px", display: "block" }}>{label}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Shared app + Dock color theme */}
                    <hr className="settings-divider" />
                    <div className="form-group">
                      <label className="form-label">Color theme</label>
                      <p className="form-hint" style={{ marginTop: 4, marginBottom: 10 }}>
                        Choose the same visual language for MakeChurchEazy and the OBS Dock.
                      </p>
                      {(() => {
                        const current = APP_APPEARANCE_PALETTES.find((palette) => palette.id === appearance.palette);
                        const custom = appearance.palette === "custom";
                        return (
                          <div className="app-theme-picker">
                            <div className="app-theme-picker__row">
                              <div className="form-select-container">
                                <select
                                  className="custom-select"
                                  value={custom ? "custom" : appearance.palette}
                                  onChange={(e) => setAppearance(e.target.value === "custom"
                                    ? { palette: "custom", customAccent: appearance.customAccent }
                                    : { palette: e.target.value as typeof appearance.palette })}
                                  aria-label="Color theme"
                                >
                                  {APP_APPEARANCE_PALETTES.map((palette) => (
                                    <option key={palette.id} value={palette.id}>{palette.label}</option>
                                  ))}
                                  <option value="custom">Custom accent</option>
                                </select>
                                <span className="select-arrow"><ChevronDown size={14} /></span>
                              </div>
                              {custom ? (
                                <input
                                  type="color"
                                  className="app-theme-picker__color"
                                  value={appearance.customAccent}
                                  onChange={(event) => setAppearance({ palette: "custom", customAccent: event.target.value })}
                                  aria-label="Custom accent"
                                />
                              ) : current ? (
                                <span className="app-theme-picker__swatches" aria-hidden="true">
                                  {current.swatches.map((swatch) => <span key={swatch} style={{ background: swatch }} />)}
                                </span>
                              ) : null}
                            </div>
                            <p className="form-hint" style={{ margin: 0 }}>
                              {custom ? "Your own color for buttons and active states." : current?.description}
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    <hr className="settings-divider" />

                    {/* Interface font */}
                    <div className="form-group">
                      <label className="form-label">Interface font</label>
                      <p className="form-hint" style={{ marginTop: 4, marginBottom: 10 }}>
                        Pick the default font for the whole app. Every option is bundled, so it works offline.
                      </p>
                      <div className="app-font-picker">
                        <div className="form-select-container">
                          <select
                            className="custom-select"
                            value={appearance.fontFamily}
                            onChange={(e) => setAppearance({ fontFamily: e.target.value })}
                            aria-label="Interface font"
                          >
                            <option value="">App default (Inter)</option>
                            {DOCK_FONT_FAMILY_GROUPS.map((group) => (
                              <optgroup key={group} label={group}>
                                {DOCK_FONT_FAMILY_OPTIONS.filter((option) => option.group === group).map((option) => (
                                  <option key={option.id} value={option.family}>{option.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <span className="select-arrow"><ChevronDown size={14} /></span>
                        </div>
                        {/* The list cannot show each font in its own style, so the choice is shown here. */}
                        <div className="app-font-picker__sample" style={{ fontFamily: appearance.fontFamily || undefined }} aria-hidden="true">
                          Grace and peace to you 0123456789
                        </div>
                      </div>
                    </div>

                    <hr className="settings-divider" />

                    {/* Interface Density */}
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.appearance.density", "Interface Density")}</label>
                      <p className="form-hint" style={{ marginTop: 4, marginBottom: 10 }}>
                        {t("mvSettings.appearance.densityDesc", "Adjust layout spacing and button padding across the desktop app.")}
                      </p>
                      <div className="grid-3-col" style={{ marginTop: "4px" }}>
                        {([
                          ["comfortable", t("mvSettings.appearance.densityComfortable", "Comfortable"), "Spacious with generous padding"],
                          ["balanced", t("mvSettings.appearance.densityBalanced", "Balanced"), "Standard layout for live production"],
                          ["compact", t("mvSettings.appearance.densityCompact", "Compact"), "Maximum screen real-estate"],
                        ] as const).map(([id, label, desc]) => (
                          <label key={id} className="option-select-card">
                            <input
                              type="radio"
                              name="ui_density"
                              checked={density === id}
                              onChange={() => {
                                setDensity(id);
                                triggerToast(`Density set to ${label}`, "accent");
                              }}
                            />
                            <div className="option-select-inner density-card-inner" style={{ padding: "14px 12px", textAlign: "left" }}>
                              <div className="checked-indicator"><Check size={10} /></div>
                              <span className="option-title" style={{ fontWeight: 600 }}>{label}</span>
                              <p className="option-desc" style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-muted)" }}>{desc}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <hr className="settings-divider" />

                    {/* Accessibility & Visual Enhancements */}
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.appearance.accessibility", "Accessibility & Display")}</label>
                      <div className="switch-row" style={{ padding: "12px 0" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.appearance.highContrast", "High Contrast Readability")}</span>
                          <span className="switch-subtitle">{t("mvSettings.appearance.highContrastDesc", "Boost borders and text contrast for low-glare visibility in control booths.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={highContrastUI}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setHighContrastUI(checked);
                              update({ highContrast: checked } as any);
                            }}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>

                      <div className="switch-row" style={{ padding: "12px 0", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.appearance.reduceMotion", "Reduce Motion & Animations")}</span>
                          <span className="switch-subtitle">{t("mvSettings.appearance.reduceMotionDesc", "Disable non-essential slide and UI animations to save GPU/CPU during broadcasts.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={reduceMotion}
                            onChange={(e) => setReduceMotion(e.target.checked)}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>

                      <div className="switch-row" style={{ padding: "12px 0", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.appearance.roundedCorners", "Rounded Corners")}</span>
                          <span className="switch-subtitle">{t("mvSettings.appearance.roundedCornersDesc", "Use smooth modern rounded corners on interface cards and dialogs.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={roundedCorners}
                            onChange={(e) => setRoundedCorners(e.target.checked)}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>
                    </div>


                  </div>
                </div>
              )}

              {/* ══════════════ BRANDING TAB ══════════════ */}
              {activeTab === "branding" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">{t("mvSettings.branding.churchProfile")}</h3>
                    <p className="section-desc">{t("mvSettings.branding.churchProfileDesc")}</p>
                  </div>

                  {/* Sync status bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "8px 12px", borderRadius: 8, backgroundColor: syncStatus ? "var(--surface-secondary, rgba(255,255,255,0.04))" : "transparent", border: syncStatus ? "1px solid var(--border-color)" : "none" }}>
                    {syncing && (
                      <>
                        <RefreshCw size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("mvSettings.branding.syncingFromDashboard")}</span>
                      </>
                    )}
                    {!syncing && syncStatus && (
                      <>
                        {brandingProfileFound === false ? (
                          <ExternalLink size={14} style={{ color: "var(--warning-color, #F59E0B)", flexShrink: 0 }} />
                        ) : (
                          <CheckCircle size={14} style={{ color: "var(--accent, #10B981)", flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>{syncStatus}</span>
                        {brandingProfileFound === false && (
                          <button
                            className="action-btn"
                            onClick={handleOpenChurchProfile}
                            style={{ fontSize: 11, padding: "4px 10px", gap: 4, flexShrink: 0 }}
                            title={t("mvSettings.branding.fillChurchProfile")}
                          >
                            <ExternalLink size={12} />
                            {t("mvSettings.branding.fillChurchProfile")}
                          </button>
                        )}
                        <button
                          className="btn btn-ghost"
                          onClick={runSync}
                          disabled={syncing}
                          style={{ fontSize: 11, padding: "2px 8px", gap: 4, flexShrink: 0 }}
                          title={t("mvSettings.branding.retry")}>
                          <RefreshCw size={12} />
                          {t("mvSettings.branding.retry")}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="settings-card fields-rows-stack">
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.branding.churchName")}</label>
                      <input className="custom-textbox" type="text" value={settings.churchName} readOnly tabIndex={-1} style={{ opacity: 0.7, cursor: "default" }} />
                    </div>
                    {/* <div className="form-group">
                      <label className="form-label">Main Pastor Name</label>
                      <input className="custom-textbox" type="text" value={settings.mainPastorName} readOnly tabIndex={-1} style={{ opacity: 0.7, cursor: "default" }} />
                    </div> */}
                    <div className="form-group">
                      <label className="form-label">{t("mvSettings.branding.pastorsSpeakers")}</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "44px 1.1fr 1fr auto", gap: 8, alignItems: "center", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" as const }}>
                          <span>{t("mvSettings.branding.photo")}</span><span>{t("mvSettings.branding.name")}</span><span>{t("mvSettings.branding.position")}</span><span />
                        </div>
                        {speakerProfiles.filter((p) => p.name.trim()).map((profile, index) => (
                          <div key={`sp-${index}`} style={{ display: "grid", gridTemplateColumns: "44px 1.1fr 1fr auto", gap: 8, alignItems: "center" }}>
                            {profile.imageUrl ? (
                              <img
                                src={resolveLogoPreviewSrc(profile.imageUrl)}
                                alt={profile.name}
                                style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border-color)" }}
                              />
                            ) : (
                              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }} />
                            )}
                            <input className="custom-textbox" type="text" value={profile.name} readOnly tabIndex={-1} style={{ opacity: 0.7, cursor: "default" }} />
                            <input className="custom-textbox" type="text" value={profile.role} readOnly tabIndex={-1} style={{ opacity: 0.7, cursor: "default" }} />
                            {profile.isMain && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent, #F59E0B)", background: "rgba(245, 158, 11, 0.15)", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap" }}>{t("mvSettings.branding.main")}</span>
                            )}
                          </div>
                        ))}
                        {speakerProfiles.filter((p) => p.name.trim()).length === 0 && (
                          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("mvSettings.branding.noSpeakersConfigured")}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Brand defaults */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">{t("mvSettings.branding.brandDefaults")}</h3>
                      <p className="section-desc">{t("mvSettings.branding.brandDefaultsDesc")}</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      <div className="grid-2-col">
                        <div className="form-group">
                          <label className="form-label">{t("mvSettings.branding.primaryColor")}</label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: settings.brandColor, border: "1px solid var(--border-color)", flexShrink: 0 }} />
                            <input className="custom-textbox" type="text" value={settings.brandColor} readOnly tabIndex={-1} style={{ flex: 1, fontFamily: "monospace", opacity: 0.7, cursor: "default" }} />
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">{t("mvSettings.branding.secondaryColor")}</label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: settings.brandSecondaryColor || DEFAULT_SETTINGS.brandColor, border: "1px solid var(--border-color)", flexShrink: 0 }} />
                            <input className="custom-textbox" type="text" value={settings.brandSecondaryColor} readOnly tabIndex={-1} style={{ flex: 1, fontFamily: "monospace", opacity: 0.7, cursor: "default" }} />
                          </div>
                        </div>
                      </div>

                      <div className="grid-2-col">
                        <div className="form-group">
                          <label className="form-label">{t("mvSettings.branding.accentColor")}</label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: settings.brandAccentColor, border: "1px solid var(--border-color)", flexShrink: 0 }} />
                            <input className="custom-textbox" type="text" value={settings.brandAccentColor} readOnly tabIndex={-1} style={{ flex: 1, fontFamily: "monospace", opacity: 0.7, cursor: "default" }} />
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">{t("mvSettings.branding.fontFamily")}</label>
                          <input className="custom-textbox" type="text" value={settings.brandFontFamily} readOnly tabIndex={-1} style={{ opacity: 0.7, cursor: "default" }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Brand logo */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">{t("mvSettings.branding.brandLogo")}</h3>
                      <p className="section-desc">{t("mvSettings.branding.brandLogoDesc")}</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      {settings.brandLogoPath ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8 }}>
                          <img
                            src={resolveLogoPreviewSrc(settings.brandLogoPath)}
                            alt="Church logo"
                            style={{ width: 48, height: 48, borderRadius: 8, objectFit: "contain", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
                          />
                          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("mvSettings.branding.logoSynced")}</span>
                        </div>
                      ) : (
                        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("mvSettings.branding.noLogoSet")}</p>
                      )}
                    </div>
                  </div>

                  {/* Presentation & Overlay Defaults */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">Lower-Third & Presentation Defaults</h3>
                      <p className="section-desc">Default behavior for live lower-third overlays, scripture projection mode, and ticker crawls.</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      {/* Lower Third Auto-Dismiss Duration */}
                      <div className="flex-between-center">
                        <div className="switch-left">
                          <span className="switch-title">Lower-Third Display Duration</span>
                          <span className="switch-subtitle">How long lower-third speaker and sermon titles remain on screen before auto-dismissing.</span>
                        </div>
                        <div className="form-select-container" style={{ width: "220px" }}>
                          <select
                            className="custom-select"
                            value={settings.lowerThirdDefaultDurationSec ?? 10}
                            onChange={(e) => update({ lowerThirdDefaultDurationSec: Number(e.target.value) })}
                          >
                            <option value={0}>Manual (Stay until closed)</option>
                            <option value={5}>5 seconds</option>
                            <option value={8}>8 seconds</option>
                            <option value={10}>10 seconds (Default)</option>
                            <option value={15}>15 seconds</option>
                            <option value={20}>20 seconds</option>
                            <option value={30}>30 seconds</option>
                          </select>
                          <span className="select-arrow"><ChevronDown size={14} /></span>
                        </div>
                      </div>

                      {/* Default Bible Projection Mode */}
                      <div className="flex-between-center" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">Default Scripture Projection Style</span>
                          <span className="switch-subtitle">Choose whether projected scriptures appear full screen or as lower-third broadcast overlays.</span>
                        </div>
                        <div className="form-select-container" style={{ width: "220px" }}>
                          <select
                            className="custom-select"
                            value={settings.defaultBibleOverlayMode ?? "fullscreen"}
                            onChange={(e) => update({ defaultBibleOverlayMode: e.target.value as "fullscreen" | "lower-third" })}
                          >
                            <option value="fullscreen">Full Screen Projector</option>
                            <option value="lower-third">Lower-Third Overlay</option>
                          </select>
                          <span className="select-arrow"><ChevronDown size={14} /></span>
                        </div>
                      </div>

                      {/* Live Ticker Crawl Speed */}
                      <div className="flex-between-center" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">Stream Ticker Crawl Speed</span>
                          <span className="switch-subtitle">Speed of scrolling announcement tickers displayed along the bottom of the stream.</span>
                        </div>
                        <div className="form-select-container" style={{ width: "220px" }}>
                          <select
                            className="custom-select"
                            value={settings.defaultTickerScrollSpeed ?? 2}
                            onChange={(e) => update({ defaultTickerScrollSpeed: Number(e.target.value) })}
                          >
                            <option value={1}>1 — Gentle / Slow</option>
                            <option value={2}>2 — Standard (Default)</option>
                            <option value={3}>3 — Moderate</option>
                            <option value={4}>4 — Brisk</option>
                            <option value={5}>5 — Fast</option>
                          </select>
                          <span className="select-arrow"><ChevronDown size={14} /></span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* ══════════════ BIBLE TAB ══════════════ */}
              {activeTab === "bible" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">{t("mvSettings.bible.sectionTitle", "Scripture & Bible Presentation")}</h3>
                    <p className="section-desc">{t("mvSettings.bible.sectionDesc", "Configure default translation, display themes, slide formatting, and presentation controls.")}</p>
                  </div>

                  {/* Defaults Card */}
                  <div className="settings-card fields-rows-stack">
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <span className="switch-title">{t("mvSettings.bible.defaultTranslation", "Default Bible Translation")}</span>
                        <span className="switch-subtitle">{t("mvSettings.bible.defaultTranslationDesc", "Select the scripture version loaded upon opening the Bible studio.")}</span>
                      </div>
                      <div className="form-select-container" style={{ width: "260px" }}>
                        <select
                          className="custom-select"
                          value={bDefaultTranslation}
                          onChange={(e) => {
                            setBDefaultTranslation(e.target.value as BibleTranslation);
                            setBibleSettingsDirty(true);
                          }}
                        >
                          {bTranslations.map((tr) => (
                            <option key={tr.value} value={tr.value}>{tr.label}</option>
                          ))}
                        </select>
                        <span className="select-arrow"><ChevronDown size={14} /></span>
                      </div>
                    </div>

                    <div className="flex-between-center" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                      <div className="switch-left">
                        <span className="switch-title">{t("mvSettings.bible.defaultTheme", "Active Scripture Theme")}</span>
                        <span className="switch-subtitle">{t("mvSettings.bible.defaultThemeDesc", "Visual layout, color palette, and font styling used for Bible projection.")}</span>
                      </div>
                      <div className="form-select-container" style={{ width: "260px" }}>
                        <select
                          className="custom-select"
                          value={bDefaultThemeId}
                          onChange={(e) => {
                            setBDefaultThemeId(e.target.value);
                            setBibleSettingsDirty(true);
                          }}
                        >
                          {bibleState.themes.map((th) => (
                            <option key={th.id} value={th.id}>{th.name}{th.hidden ? " (hidden)" : ""}</option>
                          ))}
                        </select>
                        <span className="select-arrow"><ChevronDown size={14} /></span>
                      </div>
                    </div>
                  </div>

                  {/* Slide Configuration Card */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">{t("mvSettings.bible.slideFormatting", "Slide Formatting & Typography")}</h3>
                      <p className="section-desc">{t("mvSettings.bible.slideFormattingDesc", "Control how verses are split and rendered onto projector slides.")}</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      <div className="flex-between-center">
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.bible.maxLines", "Maximum Lines Per Slide")}</span>
                          <span className="switch-subtitle">{t("mvSettings.bible.maxLinesDesc", "Limit how many lines fit on a single slide before paginating.")}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <input
                            type="range"
                            min={1}
                            max={8}
                            value={bMaxLines}
                            onChange={(e) => {
                              setBMaxLines(Number(e.target.value));
                              setBibleSettingsDirty(true);
                            }}
                            style={{ width: "120px" }}
                          />
                          <span style={{ fontWeight: 700, minWidth: "28px", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                            {bMaxLines}
                          </span>
                        </div>
                      </div>

                      <div className="switch-row" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.bible.showVerseNumbers", "Inline Verse Numbers")}</span>
                          <span className="switch-subtitle">{t("mvSettings.bible.showVerseNumbersDesc", "Show superscripts and verse number headers on projected slides.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={bShowVerseNumbers}
                            onChange={(e) => {
                              setBShowVerseNumbers(e.target.checked);
                              setBibleSettingsDirty(true);
                            }}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Behavior & Display Options Card */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <div className="section-header">
                      <h3 className="section-title">{t("mvSettings.bible.behaviorAndControls", "Projection & Controls")}</h3>
                      <p className="section-desc">{t("mvSettings.bible.behaviorAndControlsDesc", "Quick actions and interface behavior during live services.")}</p>
                    </div>

                    <div className="settings-card fields-rows-stack">
                      <div className="switch-row">
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.bible.autoSend", "Auto-send on Double Click")}</span>
                          <span className="switch-subtitle">{t("mvSettings.bible.autoSendDesc", "Double-clicking any verse immediately pushes it live to OBS & projector.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={bAutoSend}
                            onChange={(e) => {
                              setBAutoSend(e.target.checked);
                              setBibleSettingsDirty(true);
                            }}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>

                      <div className="switch-row" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.bible.reduceMotion", "Reduce Motion")}</span>
                          <span className="switch-subtitle">{t("mvSettings.bible.reduceMotionDesc", "Disable transitions and animated slide changes for lower GPU usage.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={bReduceMotion}
                            onChange={(e) => {
                              setBReduceMotion(e.target.checked);
                              setBibleSettingsDirty(true);
                            }}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>

                      <div className="switch-row" style={{ paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <div className="switch-left">
                          <span className="switch-title">{t("mvSettings.bible.highContrast", "High Contrast Readability")}</span>
                          <span className="switch-subtitle">{t("mvSettings.bible.highContrastDesc", "Boost outline and contrast for washed-out auditoriums or high-ambient light.")}</span>
                        </div>
                        <label className="switch-toggle-label">
                          <input
                            type="checkbox"
                            checked={bHighContrast}
                            onChange={(e) => {
                              setBHighContrast(e.target.checked);
                              setBibleSettingsDirty(true);
                            }}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      className="action-btn btn-primary"
                      onClick={handleSaveBible}
                      title="Save Bible Settings"
                      style={{ padding: "8px 20px" }}
                    >
                      <Save size={14} /> <span>{bibleSettingsDirty ? "Save Bible Settings *" : "Save Bible Settings"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ══════════════ CREDITS TAB ══════════════ */}
              {activeTab === "usage" && (
                <div className="settings-section">
                  {/* Account Summary Cards at top of Plan & Credits */}
                  <AccountSummaryCards className="settings-summary-cards" />

                  <div className="section-header" style={{ marginTop: "24px" }}>
                    <h3 className="section-title">{t("mvSettings.credits.creditsOverview")}</h3>
                    <p className="section-desc">{t("mvSettings.credits.creditsOverviewDesc")}</p>
                  </div>

                  {/* ── Trial Banner ── */}
                  {displayTrialActive && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 18px", borderRadius: "3px", marginBottom: "24px",
                      background: "rgba(29, 78, 216, 0.08)",
                      border: "1px solid rgba(29, 78, 216, 0.2)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Calendar size={18} style={{ color: "var(--accent-blue)" }} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                            {t("mvSettings.credits.trial.growthTrialDaysRemaining", { trialDaysLeft })}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                            {t("mvSettings.credits.trial.trialEndsDate", { trialEndDate })} · {t("common.upgradePlansStartToday", { amount: "3,500" })}
                          </div>
                        </div>
                      </div>
                      <button className="action-btn btn-primary" style={{ fontSize: "0.78rem", padding: "6px 14px" }} onClick={() => void openDashboardSubscriptionPlans()} title={t("mvSettings.credits.upgrade")}>
                        <ExternalLink size={12} /> {t("mvSettings.credits.upgrade")}
                      </button>
                    </div>
                  )}

                  {/* ── Credits Dashboard ── */}
                  <div className="settings-card credits-dashboard" style={{ marginBottom: "24px" }}>
                    <div className="credits-dashboard-grid">
                      <div className="credits-stat">
                        <span className="credits-stat-label">{t("mvSettings.credits.currentPlan")}</span>
                        <div className="credits-stat-value-row">
                          <span className="credits-stat-value">{planLabel} {t("mvSettings.credits.plan")}</span>
                          <span className="feature-tag-pill" style={{
                            textTransform: "uppercase",
                            fontSize: "12px",
                            background: displayTrialActive ? "rgba(29,78,216,0.15)" : "rgba(16,185,129,0.15)",
                            color: displayTrialActive ? "var(--accent-blue)" : "var(--success-color)",
                          }}>{displayTrialActive ? t("mvSettings.credits.activeTrial") : t("mvSettings.credits.active")}</span>
                        </div>
                      </div>
                      <div className="credits-stat">
                        <span className="credits-stat-label">{t("mvSettings.credits.creditsRemaining")}</span>
                        <span className="credits-stat-value credits-accent">{isUnlimited ? t("mvSettings.credits.unlimited") : formatCredits(creditsRemaining)}</span>
                      </div>
                      <div className="credits-stat">
                        <span className="credits-stat-label">{t("mvSettings.credits.thisMonth")}</span>
                        <span className="credits-stat-value">{isUnlimited ? "—" : t("mvSettings.credits.creditsUsed", { creditsUsedThisMonth })}</span>
                      </div>
                      <div className="credits-stat">
                        <span className="credits-stat-label">{t("mvSettings.credits.nextReset")}</span>
                        <span className="credits-stat-value">{isUnlimited ? t("mvSettings.credits.notApplicable") : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return d.toLocaleDateString(undefined, { month: "long", day: "numeric" }); })()}</span>
                      </div>
                    </div>

                    {!isUnlimited && (
                      <div className="credits-progress-section">
                        <div className="credits-progress-header">
                          <span className="credits-progress-text">
                            {t("mvSettings.credits.creditsUsedOf", {
                              creditsUsedThisMonth,
                              planCredits: formatCredits(totalAvailableCredits > 0 ? totalAvailableCredits : planCredits),
                            })}
                          </span>
                          <span className="credits-progress-pct">{usagePct}%</span>
                        </div>
                        <div className="credits-progress-track">
                          <div className="credits-progress-fill" style={{ width: `${usagePct}%` }}></div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Recent Transactions ── */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <h4 className="section-title">{t("mvSettings.credits.recentTransactions")}</h4>
                    {recentTransactions.length === 0 ? (
                      <p className="section-desc" style={{ marginTop: "8px" }}>{t("mvSettings.credits.noTransactionsYet")}</p>
                    ) : (
                      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {recentTransactions.map((tx) => (
                          <div key={tx._id || tx.createdAt} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 12px", borderRadius: "3px",
                            background: "var(--bg-secondary, rgba(255,255,255,0.04))",
                            fontSize: "0.8rem",
                          }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontWeight: 600 }}>{tx.description}</span>
                              <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                                {new Date(tx.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <span style={{ fontWeight: 700, color: tx.amount < 0 ? "#EF4444" : "#22C55E" }}>
                              {tx.amount > 0 ? "+" : ""}{tx.amount}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── About Credits ── */}
                  <div className="settings-section" style={{ marginTop: "24px" }}>
                    <h4 className="section-title">{t("mvSettings.credits.aboutCredits")}</h4>
                    <p className="section-desc about-credits-lead">
                      {t("mvSettings.credits.creditsPowerAi")}
                    </p>

                    <div className="about-credits-stack">
                      <div className="about-credits-block">
                        <div className="about-credits-block-title">{t("mvSettings.credits.doNotConsumeCredits")}</div>
                        <div className="about-credits-grid">
                          {[
                            t("mvSettings.credits.biblePresentation"),
                            t("mvSettings.credits.worshipPresentation"),
                            t("mvSettings.credits.mediaManagement"),
                            t("mvSettings.credits.obsIntegration"),
                            t("mvSettings.credits.themes"),
                            t("mvSettings.credits.lowerThirds"),
                          ].map((item, i) => (
                            <div key={i} className="about-credit-item">
                              <Check size={13} />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                        <p className="about-credits-note">
                          {t("mvSettings.credits.normalWorkflowNote")}
                        </p>
                      </div>

                      <div className="about-credits-block">
                        <div className="about-credits-block-title">{t("mvSettings.credits.creditConsumption")}</div>
                        <div className="credit-rates-grid">
                          {[
                            {
                              icon: Radio,
                              title: t("mvSettings.credits.rate.speechToScripture.title"),
                              cost: t("mvSettings.credits.rate.speechToScripture.cost"),
                              description: t("mvSettings.credits.rate.speechToScripture.description"),
                            },
                            {
                              icon: Globe,
                              title: t("mvSettings.credits.rate.transcriptTranslation.title"),
                              cost: t("mvSettings.credits.rate.transcriptTranslation.cost"),
                              description: t("mvSettings.credits.rate.transcriptTranslation.description"),
                            },
                            {
                              icon: FileText,
                              title: t("mvSettings.credits.rate.aiSermonSummary.title"),
                              cost: t("mvSettings.credits.rate.aiSermonSummary.cost"),
                              description: t("mvSettings.credits.rate.aiSermonSummary.description"),
                            },
                            {
                              icon: FileText,
                              title: t("mvSettings.credits.rate.aiSermonNotes.title"),
                              cost: t("mvSettings.credits.rate.aiSermonNotes.cost"),
                              description: t("mvSettings.credits.rate.aiSermonNotes.description"),
                            },
                            {
                              icon: Zap,
                              title: t("mvSettings.credits.rate.aiSermonPoints.title"),
                              cost: t("mvSettings.credits.rate.aiSermonPoints.cost"),
                              description: t("mvSettings.credits.rate.aiSermonPoints.description"),
                            },
                          ].map((item) => {
                            const Icon = item.icon;
                            return (
                              <div key={item.title} className="credit-rate-row">
                                <div className="credit-rate-icon">
                                  <Icon size={16} />
                                </div>
                                <div className="credit-rate-content">
                                  <div className="credit-rate-header">
                                    <span className="credit-rate-title">{item.title}</span>
                                    <span className="credit-rate-cost">{item.cost}</span>
                                  </div>
                                  <p className="credit-rate-desc">{item.description}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="about-credits-note">
                          {t("mvSettings.credits.aiImportNote")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ── Credit Consumption Rates ── */}



                  {/* Local Dev Switcher */}
                  <div className="settings-section" style={{ marginTop: "32px", borderTop: "1px solid var(--border-color)", paddingTop: "20px" }}>
                    <LocalDevPlanSwitcher />
                  </div>
                </div>
              )}

              {/* ══════════════ DATA & STORAGE TAB ══════════════ */}
              {activeTab === "storage" && (
                <div className="settings-section">
                  <div className="section-header">
                    <h3 className="section-title">{t("mvSettings.storage.sectionTitle", "Data & Storage Management")}</h3>
                    <p className="section-desc">{t("mvSettings.storage.sectionDesc", "Manage local databases, purge cached media and worship catalogs, or reset initial setup.")}</p>
                  </div>

                  {/* Import from EasyWorship: always here, even after the Songs page banner is closed */}
                  <div className="settings-card fields-rows-stack" style={{ marginBottom: "20px" }}>
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <span className="switch-title">Import from EasyWorship</span>
                        <span className="switch-subtitle">Bring in your songs, media and themes from EasyWorship. Your plan&apos;s limits still apply.</span>
                      </div>
                      <button className="action-btn" onClick={() => setEasyWorshipImportOpen(true)} title="Import from EasyWorship">
                        <FolderUp size={14} /> Import
                      </button>
                    </div>
                  </div>

                  {/* Cloud Backup & Multi-Laptop Sync Card */}
                  <div style={{ marginBottom: "20px" }}>
                    <CloudSyncSettingsCard onOpenUpgrade={() => setShowCloudSyncUpgrade(true)} />
                  </div>

                  {/* Church Onboarding Reset Card */}
                  <div className="settings-card fields-rows-stack" style={{ marginBottom: "20px" }}>
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <span className="switch-title">{t("mvSettings.branding.firstLaunchSetup", "Initial Setup & Onboarding")}</span>
                        <span className="switch-subtitle">{t("mvSettings.branding.firstLaunchSetupDesc", "Rerun the church name, logo, and theme setup wizard without losing songs or data.")}</span>
                      </div>
                      <button className="action-btn" onClick={handleResetChurchOnboarding} title={t("mvSettings.branding.resetOnboarding")}>
                        <RefreshCw size={14} /> {t("mvSettings.branding.resetOnboarding", "Rerun Onboarding")}
                      </button>
                    </div>
                  </div>

                  {/* Worship Song Library Cleanup Card */}
                  <div className="settings-card fields-rows-stack" style={{ marginBottom: "20px" }}>
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <span className="switch-title">{t("mvSettings.general.clearWorshipSongs", "Clear Worship Songs")}</span>
                        <span className="switch-subtitle">{t("mvSettings.general.clearWorshipSongsDesc", "Delete all imported songs and custom lyric sets from local storage.")}</span>
                      </div>
                      <div>
                        {worshipCleared ? (
                          <span style={{ color: "var(--success-color)", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <CheckCircle size={15} /> {t("mvSettings.general.worshipSongsCleared")}
                          </span>
                        ) : confirmClearWorship ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ color: "var(--danger-color)", fontSize: "0.82rem", fontWeight: 600 }}>{t("mvSettings.general.areYouSure")}</span>
                            <button className="action-btn btn-primary" style={{ backgroundColor: "var(--danger-color)" }} onClick={handleClearWorship} title="Yes">
                              {t("mvSettings.general.yesClearWorship")}
                            </button>
                            <button className="action-btn" onClick={() => setConfirmClearWorship(false)} title="Cancel">
                              {t("mvSettings.general.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button className="action-btn" style={{ color: "var(--danger-color)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={() => setConfirmClearWorship(true)} title="Clear">
                            <Trash2 size={14} /><span>{t("mvSettings.general.clearWorshipSongs")}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Danger Zone: Full Application Reset */}
                  <div className="settings-card fields-rows-stack" style={{ border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.03)" }}>
                    <div className="flex-between-center">
                      <div className="switch-left">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <ShieldAlert size={16} style={{ color: "var(--danger-color)" }} />
                          <span className="switch-title" style={{ color: "var(--danger-color)", fontWeight: 700 }}>
                            {t("mvSettings.general.dangerZone", "Danger Zone: Clear All Application Data")}
                          </span>
                        </div>
                        <span className="switch-subtitle">
                          {t("mvSettings.general.clearAllDataDesc", "Wipes all local database records, OBS settings, saved overlays, and restores default factory state.")}
                        </span>
                      </div>
                      <div>
                        {cleared ? (
                          <span style={{ color: "var(--success-color)", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <CheckCircle size={15} /> {t("mvSettings.general.databaseCleared")}
                          </span>
                        ) : confirmClear ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ color: "var(--danger-color)", fontSize: "0.82rem", fontWeight: 600 }}>{t("mvSettings.general.areYouSure")}</span>
                            <button className="action-btn btn-primary" style={{ backgroundColor: "var(--danger-color)" }} onClick={handleClear} title="Yes">
                              {t("mvSettings.general.yesClearEverything")}
                            </button>
                            <button className="action-btn" onClick={() => setConfirmClear(false)} title="Cancel">
                              {t("mvSettings.general.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button className="action-btn" style={{ color: "var(--danger-color)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={() => setConfirmClear(true)} title="Clear">
                            <Trash2 size={14} /><span>{t("mvSettings.general.clearAllData")}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right: widgets column */}
            {hasSettingsSidebar && (
              <div className="widgets-column">
                {/* Appearance preview widget */}


                {/* Settings summary widget */}


                {/* OBS connection widget */}
                {activeTab === "obs" && (
                  <div className="widget-card">
                    <div className="widget-header">
                      <h4 className="widget-title">Connection Status</h4>
                    </div>
                    <div className="widget-body">
                      <div className="radar-pulse-ambient">
                        <div className="radar-circle-outer">
                          <div className="radar-circle-inner" style={{ borderColor: obsStatus === "connected" ? "var(--success-color)" : "var(--text-muted)", color: obsStatus === "connected" ? "var(--success-color)" : "var(--text-muted)" }}>
                            <Radio size={28} />
                          </div>
                        </div>
                        {obsStatus === "connected" && <div className="radar-ripple"></div>}
                      </div>
                      <div className="details-rows-list" style={{ marginTop: "16px" }}>
                        <div className="details-row">
                          <span className="details-label">Ping</span>
                          <span className="details-value">
                            {obsStatus === "connected" ? (<><span className="dot-indicator dot-success"></span><span>Connected</span></>) : <span>Disconnected</span>}
                          </span>
                        </div>
                        <div className="details-row">
                          <span className="details-label">Endpoint</span>
                          <span className="details-value mono-display" style={{ fontSize: "12px" }}>{settings.obsUrl || "N/A"}</span>
                        </div>
                      </div>

                      {/* Connection actions */}
                      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                        <button className="reset-button" style={{ justifyContent: "center", fontWeight: "600" }} onClick={handleReconnectNow} title="Refresh">
                          <RefreshCw size={14} /><span>Force Reconnect</span>
                        </button>
                        <button className="reset-button" style={{ justifyContent: "center", fontWeight: "600" }} onClick={() => setShowLogsPanel(!showLogsPanel)} title="Hide">
                          <FileText size={14} /><span>{showLogsPanel ? "Hide Logs" : "View Logs"}</span>
                        </button>
                        <button className="reset-button" style={{ justifyContent: "center", fontWeight: "600", color: "var(--danger-color)" }} onClick={() => { obsService.disconnect(); setObsStatus("disconnected"); setObsPasswordDraft(""); triggerToast("Disconnected.", "accent"); }} title="Disconnect">
                          <Trash2 size={14} /><span>Disconnect</span>
                        </button>
                      </div>
                      {showLogsPanel && (
                        <div className="expandable-logs-panel" style={{ marginTop: "12px" }}>
                          {obsLogs.map((log) => (
                            <div key={log.id} className="log-entry">
                              <span className="log-time">[{log.timestamp}]</span>
                              <span className="log-source">[{log.source}]</span>
                              <span>{log.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ══════════════ AUDIO TAB ══════════════ */}


                {/* Tips card */}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>

      {/* Language Change Confirmation Modal */}
      {showLanguageModal && pendingLanguage && (
        <div
          className="mv-modal-backdrop"
          onClick={() => {
            setShowLanguageModal(false);
            setPendingLanguage(null);
          }}
        >
          <div className="mv-modal mv-modal--language" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon-badge mv-modal-icon-badge--indigo">
              <Globe size={28} />
            </div>
            <h3 className="mv-modal-title">{t("mvSettings.modal.language.changeLanguage", "Change Language")}</h3>
            <p className="mv-modal-prompt">
              {t("mvSettings.modal.language.switchLanguagePrompt", {
                language: getInterfaceLanguageLabel(pendingLanguage),
                defaultValue: `Switch interface language to ${getInterfaceLanguageLabel(pendingLanguage)}?`,
              })}
            </p>
            <p className="mv-modal-hint">
              {t("mvSettings.modal.language.interfaceUpdateImmediately", "The interface will update immediately.")}
            </p>
            <div className="mv-modal-actions mv-modal-actions--modern">
              <button
                type="button"
                className="mv-modal-btn mv-modal-btn--ghost"
                onClick={() => {
                  setShowLanguageModal(false);
                  setPendingLanguage(null);
                }}
              >
                {t("mvSettings.modal.language.cancel", "Cancel")}
              </button>
              <button
                type="button"
                className="mv-modal-btn mv-modal-btn--primary"
                onClick={() => {
                  const code = pendingLanguage!;
                  void applyInterfaceLanguagePreference(code, { broadcast: true }).then(setInterfaceLanguage);
                  setShowLanguageModal(false);
                  setPendingLanguage(null);
                }}
              >
                {t("mvSettings.modal.language.change", "Change Language")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Remote upgrade modal */}
      <UpgradeModal
        open={showMobileUpgrade}
        onClose={() => setShowMobileUpgrade(false)}
        feature="Mobile Remote"
        requiredPlan="growth"
        currentPlan={effectivePlan}
        message="Mobile Remote access is available on Growth."
      />

      {easyWorshipImportOpen && (
        <EasyWorshipOneClickImportModal onClose={() => setEasyWorshipImportOpen(false)} />
      )}

      {/* Cloud Sync upgrade modal */}
      <UpgradeModal
        open={showCloudSyncUpgrade}
        onClose={() => setShowCloudSyncUpgrade(false)}
        feature="Cloud Sync & Multi-Laptop Backup"
        requiredPlan="basic"
        currentPlan={effectivePlan}
        message="Cloud Sync and multi-laptop backup are available on Basic and higher plans."
      />
    </div >
  );
}
