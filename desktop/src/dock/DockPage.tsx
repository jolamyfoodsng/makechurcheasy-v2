/**
 * DockPage.tsx — MakeChurchEazy Dock Control Panel
 *
 * The dock keeps Bible, Worship + Notes, and Media production controls inside OBS.
 */

import { setUsagePage } from "../services/usageTracker";
import { Suspense, useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { dockClient, dockBridge, type DockStateMessage } from "../services/dockBridge";
import { dockObsClient, type DockObsStatus } from "./dockObsClient";
import {
  DOCK_TABS,
  FREE_PLAN_HIDDEN_DOCK_TABS,
  isDockTabAvailableForPlan,
  type DockTab,
  type DockStagedItem,
} from "./dockTypes";
import {
  isPresentationLinkTarget,
  isVmixTarget,
  resolveDockPresentationOutputTarget,
  type DockPresentationOutputTarget,
} from "./dockPresentationTarget";
import {
  readDockOutputSoftware,
  writeDockOutputSoftware,
  type DockOutputSoftware,
} from "./dockOutputSoftware";
import { useAppTheme } from "../hooks/useAppTheme";
import {
  APP_APPEARANCE_PALETTES,
  DEFAULT_DOCK_VISUALS,
  getDockAppearanceCssVariables,
  type DockVisualPreferences,
} from "../services/appAppearance";
import {
  type DockProductionSettingsPayload,
  getDefaultDockProductionSettings,
  loadDockProductionSettings,
  readFastDockProductionSettings,
} from "../services/productionSettings";
import type { ServicePlannerSnapshot } from "../service-planner/types";
import { installDockTextShortcuts } from "./dockTextShortcuts";
import { useDockAutoFit } from "./dockAutoFit";
import { loadDockFavoriteBibleThemes } from "./dockThemeData";
import { announceDockThemesRefreshed } from "./dockThemeRefresh";
import { useKeyboardShortcuts, type ShortcutDefinition, type ShortcutCategory, formatShortcut } from "./useKeyboardShortcuts";
import { triggerTabSearchInput } from "../utils/searchShortcut";
import { useDockDragDrop } from "./useDockDragDrop";
import { useDockUpload } from "./useDockUpload";
import { ensureObsConnected } from "./obsConnectionGuard";
import {
  getDeviceProfile,
  getRecommendedPollingInterval,
  onPerformanceTierChange,
} from "../services/performanceManager";
import { getDefaultOBSUrl, readDesktopConfigCache, DEFAULT_DESKTOP_CONFIG } from "../services/desktopConfig";
import { fetchLatestPublishedRelease } from "../services/updateService";
import { normalizeOBSWebSocketUrl } from "../services/obsWebSocketUrl";
import DockDropOverlay from "./DockDropOverlay";
import DockUploadToasts from "./DockUploadToasts";
import { DockUpgradeModal } from "./components/DockUpgradeModal";
import LoadingScreen from "../components/LoadingScreen";
import DockBrowserZoomWarning from "./components/DockBrowserZoomWarning";
import DockPresentationLinkCard from "./components/DockPresentationLinkCard";
import DockVmixCard from "./components/DockVmixCard";
import DockPresentationLinkModal from "./components/DockPresentationLinkModal";
import DockScheduleIntroModal from "./components/DockScheduleIntroModal";
import { getDockPlan, isDockFreePlan, registerUpgradeModal, showUpgradeModal, startPlanRefresh } from "./dockEntitlement";
import { LOCAL_DEV_PLAN_OVERRIDE_EVENT } from "../services/localDevPlanOverride";
import { getUserScopedKey } from "../services/userScopedStorage";
import { publishDockStagedItemToPresentation } from "../services/presentationDockBridge";
import {
  DEFAULT_DOCK_FONT_SCALE,
  DEFAULT_DOCK_FONT_FAMILY,
  DOCK_FONT_FAMILY_GROUPS,
  DOCK_FONT_FAMILY_OPTIONS,
  DOCK_FONT_SCALE_OPTIONS,
  buildDockFontFamilyStack,
  hydrateDockTypographyPreferences,
  loadDockFontFamily,
  loadDockFontScale,
  normalizeDockFontFamily,
  normalizeDockFontScale,
  saveDockFontFamily,
  saveDockFontScale,
} from "./dockFontFamily";
import {
  DEFAULT_DOCK_OUTPUT_FONT_FAMILY,
  DEFAULT_DOCK_OUTPUT_FONT_SCALE,
  hydrateDockOutputTypographyPreferences,
  saveDockOutputFontFamily,
  saveDockOutputFontScale,
} from "./dockOutputTypography";
import { importDockSessionFromFile } from "./dockSessionTransfer";
import { downloadDockSessionBundle } from "./dockSessionBundle";
import {
  hydrateNativeDockSettings,
  isNativeDockSettingsHydrated,
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../services/localDockSettings";
import "./dock.css";
import "./dock-theme.css";
import "../accessibility.css";
import DockScheduleDrawer from "./components/DockScheduleDrawer";
import { Globe } from "../components/icons/NativeIcons";
import Icon from "./DockIcon";
import {
  normalizeDockSearchPlacement,
  type DockSearchPlacement,
} from "./dockSearchPlacement";
import {
  markDockLayerElement,
  markDockLayerSubtree,
  raiseDockLayerAtTarget,
} from "./dockLayerManager";
import {
  readDockBibleKeywordMatchPreference,
  updateDockBibleKeywordMatchPreference,
} from "./dockBibleKeywordPreference";
import { coerce, gt } from "semver";

import { safeLazy } from "../utils/safeLazy";
import { emitStudioDockEvent } from "../studio/studioDockSink";
import { DockOutputTargetContext } from "./dockOutputTargetContext";

const loadDockBibleTab = () => import("./tabs/DockBibleTab");
const loadDockMediaTab = () => import("./tabs/DockMediaTab");
const loadDockWorshipTab = () => import("./tabs/DockWorshipTab");
const loadDockPlannerTab = () => import("./tabs/DockPlannerTab");
const loadDockMultiviewTab = () => import("./tabs/DockMultiviewTab");
const loadDockMinistryTab = () => import("./tabs/DockMinistryTab");
const loadDockBroadcastTab = () => import("./tabs/DockBroadcastTab");
const loadDockLmTab = () => import("./tabs/DockLmTab");
const loadDockBibleCommandPaletteHost = () => import("./DockBibleCommandPaletteHost");

const DockBibleTab = safeLazy(loadDockBibleTab);
const DockMediaTab = safeLazy(loadDockMediaTab);
const DockWorshipTab = safeLazy(loadDockWorshipTab);
const DockPlannerTab = safeLazy(loadDockPlannerTab);
const DockMultiviewTab = safeLazy(loadDockMultiviewTab);
const DockMinistryTab = safeLazy(loadDockMinistryTab);
const DockBroadcastTab = safeLazy(loadDockBroadcastTab);
const DockLmTab = safeLazy(loadDockLmTab);
const DockBibleCommandPaletteHost = safeLazy(loadDockBibleCommandPaletteHost);

const DOCK_TAB_PRELOADERS: Partial<Record<DockTab, () => Promise<unknown>>> = {
  bible: loadDockBibleTab,
  worship: loadDockWorshipTab,
  media: loadDockMediaTab,
  planner: loadDockPlannerTab,
  multiview: loadDockMultiviewTab,
  ministry: loadDockMinistryTab,
  broadcast: loadDockBroadcastTab,
};

const DOCK_TAB_SHORTCUTS = [
  { key: "1", tab: "bible" as DockTab, labelKey: "page.shortcutTabBible" },
  { key: "2", tab: "worship" as DockTab, labelKey: "page.shortcutTabWorship" },
  { key: "3", tab: "media" as DockTab, labelKey: "page.shortcutTabMedia" },
  { key: "4", tab: "ministry" as DockTab, labelKey: "page.shortcutTabMinistry" },
  { key: "5", tab: "multiview" as DockTab, labelKey: "page.shortcutTabMultiview" },
  { key: "6", tab: "broadcast" as DockTab, labelKey: "page.shortcutTabBroadcast" },
] as const;

function preloadDockTab(tab: DockTab): void {
  void DOCK_TAB_PRELOADERS[tab]?.();
}

function isSubEightGbDevice(totalRAMMB?: number): boolean {
  // 1. Check navigator.deviceMemory if available in browser / CEF (reported in GB)
  if (typeof navigator !== "undefined" && typeof (navigator as any).deviceMemory === "number") {
    if ((navigator as any).deviceMemory <= 8) return true;
  }
  // 2. Check cached hardware profile from main app in localStorage
  try {
    const cached = localStorage.getItem("ocs-perf-profile-v1");
    if (cached) {
      const parsed = JSON.parse(cached);
      const ram = parsed?.hardware?.totalRAMMB;
      if (typeof ram === "number" && ram > 0) {
        return ram <= 8 * 1024;
      }
    }
  } catch { /* ignore */ }

  // 3. If totalRAMMB is provided, devices <= 8GB (8192 MB) run in low-memory mode
  if (typeof totalRAMMB === "number" && totalRAMMB > 0) {
    return totalRAMMB <= 8 * 1024;
  }

  // 4. Default to true in embedded/OBS dock environment where RAM is unknown,
  // preventing runaway memory growth on budget laptops (e.g. 6GB RAM).
  return true;
}

function normalizeDockVersion(version?: string): string | null {
  const normalizedInput = String(version || "").trim();
  return normalizedInput ? coerce(normalizedInput)?.version ?? null : null;
}

const DOCK_SHELL_PREFS_KEY = "ocs-dock-shell-preferences";
const DOCK_STAGED_ITEM_KEY = "ocs-dock-staged-item";

interface DockShellPreferences {
  activeTab?: DockTab | "live";
  disabledTabs?: DockTab[];
  searchPlacement?: DockSearchPlacement;
}

import { loadProjectionSettings, saveProjectionSettings, type ProjectionSettings } from "./dockProjectionSettings";

function resolveDockTab(tab?: DockTab | "live" | null, isFreePlan = false): DockTab {
  if (tab === "notes") return "worship";
  if (tab === "planner") return "bible";
  if (tab === "bible" || tab === "worship" || tab === "media" || tab === "multiview" || tab === "ministry") {
    return isDockTabAvailableForPlan(tab, isFreePlan) ? tab : "bible";
  }
  return "bible";
}

function loadDockStagedItem(): DockStagedItem | null {
  const parsed = readNativeDockSetting<DockStagedItem | null>(DOCK_STAGED_ITEM_KEY);
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.type !== "string" || typeof parsed.label !== "string") return null;
  return parsed;
}

function saveDockStagedItem(item: DockStagedItem | null): void {
  writeNativeDockSetting(DOCK_STAGED_ITEM_KEY, item);
}

function isDockProductionSettingsPayload(value: unknown): value is DockProductionSettingsPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DockProductionSettingsPayload>;
  return Boolean(
    candidate.bible &&
    candidate.worship &&
    candidate.bible.fullscreenTheme &&
    candidate.bible.lowerThirdTheme &&
    candidate.worship.fullscreenTheme &&
    candidate.worship.lowerThirdTheme,
  );
}

function loadDockShellPreferences(): DockShellPreferences {
  const parsed = readNativeDockSetting<DockShellPreferences>(DOCK_SHELL_PREFS_KEY);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function saveDockShellPreferences(next: DockShellPreferences): void {
  writeNativeDockSetting(DOCK_SHELL_PREFS_KEY, next);
}

function getCompactDockTabLabel(tab: DockTab, t: (key: string) => string): string {
  switch (tab) {
    case "bible":
      return t('page.shortcutTabBible');
    case "worship":
      return t('page.shortcutTabWorship');
    case "notes":
      return t('notes.title');
    case "media":
      return t('page.shortcutTabMedia');
    case "ministry":
      return t('page.shortcutTabMinistry');
    case "planner":
      return t('page.shortcutTabPlanner');
    case "multiview":
      return t('page.shortcutTabMultiview');
    case "broadcast":
      return t('page.shortcutTabBroadcast');
    default:
      return t('dock.defaultTab');
  }
}

function formatDockObsError(message: string): string {
  if (!message) {
    return "Failed to connect to OBS. Please check your OBS WebSocket settings (Tools → WebSocket Server Settings) and confirm port 4455 and password align with MakeChurchEazy.";
  }
  if (/No source was found.*MCE Presentation.*within the canvas/i.test(message)) {
    return "MCE Presentation scene was not found. Please refresh the dock, or check that MakeChurchEazy is running.";
  }
  if (/connection failed|failed to connect|websocket.*fail|timeout|timed out|refused/i.test(message)) {
    return "Failed to connect to OBS. Please confirm OBS Studio is running, check OBS → Tools → WebSocket Server Settings is enabled on port 4455, and confirm your password aligns with MakeChurchEazy.";
  }
  if (/auth|authentication|password/i.test(message)) {
    return "OBS WebSocket authentication failed. Please check your OBS WebSocket password in Tools → WebSocket Server Settings and re-enter it here.";
  }
  return `OBS Error: ${message}. Check OBS → Tools → WebSocket Server Settings and confirm port and password align with MakeChurchEazy.`;
}

interface DockPageProps {
  externalObsSession?: boolean;
  presentationBibleLmSplit?: boolean;
  presentationOutputTarget?: DockPresentationOutputTarget;
  enablePresentationAssistantMicControls?: boolean;
  hideLowerThirdControls?: boolean;
  hideTickerControls?: boolean;
  hiddenTabs?: DockTab[];
  hideShellHeader?: boolean;
  initialProductionSettings?: DockProductionSettingsPayload;
  onActiveTabChange?: (tab: DockTab) => void;
  /** Inside the Presentation Studio: hide the "Presentation link" help card. */
  hidePresentationLinkCard?: boolean;
}

function DockPageContent({
  externalObsSession = false,
  presentationBibleLmSplit = false,
  presentationOutputTarget: requestedPresentationOutputTarget,
  enablePresentationAssistantMicControls = false,
  hideLowerThirdControls = false,
  hideTickerControls = false,
  hiddenTabs = [],
  hideShellHeader = false,
  initialProductionSettings,
  onActiveTabChange,
  hidePresentationLinkCard = false,
}: DockPageProps = {}) {
  const { t } = useTranslation();
  const [dockPlan, setDockPlan] = useState(() => getDockPlan());
  // Output software (OBS / vMix). A parent view that asks for a specific
  // target (e.g. the Studio) always wins over this Dock-level choice.
  const [outputSoftware, setOutputSoftware] = useState<DockOutputSoftware>(() => readDockOutputSoftware());
  const presentationOutputTarget = resolveDockPresentationOutputTarget(
    requestedPresentationOutputTarget ?? (outputSoftware === "vmix" ? "vmix" : undefined),
    dockPlan,
  );
  const isFreePlan = isDockFreePlan();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  // Synchronous config reader (reads from cache, falls back to defaults)
  const cfg = readDesktopConfigCache() || DEFAULT_DESKTOP_CONFIG;

  const dockRootRef = useRef<HTMLDivElement>(null);
  const dockLayerOrderRef = useRef(10_000);
  const shellPreferences = loadDockShellPreferences();
  const {
    effective,
    preference: themePreference,
    setTheme,
    appearance,
    setAppearance,
  } = useAppTheme();
  const initialActiveTab = resolveDockTab(shellPreferences.activeTab, isFreePlan);
  const initialSearchPlacement = normalizeDockSearchPlacement(shellPreferences.searchPlacement);
  const [activeTab, setActiveTab] = useState<DockTab>(() => initialActiveTab);
  // The tab the operator last chose. When a tab is temporarily unavailable at
  // startup (plan not bridged yet), the Dock shows a fallback tab but keeps this
  // preference, then returns to it once it becomes available.
  const preferredTabRef = useRef<DockTab>(resolveDockTab(shellPreferences.activeTab, false));
  // The tab shown only because the preferred one is unavailable right now (null = none).
  const fallbackTabRef = useRef<DockTab | null>(
    initialActiveTab !== preferredTabRef.current ? initialActiveTab : null,
  );
  const [searchPlacement, setSearchPlacement] = useState<DockSearchPlacement>(() => initialSearchPlacement);
  const [renderedTab, setRenderedTab] = useState<DockTab>(() => initialActiveTab);
  // Usage analytics: the dock tab on screen is the "page".
  useEffect(() => { setUsagePage(`dock/${renderedTab}`); }, [renderedTab]);
  const [lowMemoryMode, setLowMemoryMode] = useState(() =>
    isSubEightGbDevice(getDeviceProfile()?.hardware.totalRAMMB ?? 0),
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<DockTab>>(() => new Set([initialActiveTab]));
  const [disabledTabs] = useState<DockTab[]>(() =>
    (shellPreferences.disabledTabs ?? []).filter((tab) => tab !== "notes"),
  );
  const [dockHeight, setDockHeight] = useState(() => (
    typeof window !== "undefined" ? window.innerHeight : 0
  ));
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const responsiveDockHeight = dockHeight > 0
    ? dockHeight
    : viewportHeight;
  const verticalTabs = (
    (viewportHeight > 0 && viewportHeight <= 600)
    || (responsiveDockHeight > 0 && responsiveDockHeight <= 600)
  );
  const [obsConnected, setObsConnected] = useState(false);
  const [obsError, setObsError] = useState("");
  const [staged, setStaged] = useState<DockStagedItem | null>(() => loadDockStagedItem());
  const [appConnected, setAppConnected] = useState(false);
  const [obsUrlInput, setObsUrlInput] = useState(getDefaultOBSUrl());
  const [obsPwInput, setObsPwInput] = useState("");
  const [productionSettings, setProductionSettings] = useState<DockProductionSettingsPayload>(
    () => initialProductionSettings ?? getDefaultDockProductionSettings(),
  );
  const [servicePlanner, setServicePlanner] = useState<ServicePlannerSnapshot | null>(null);
  const [projectionSettings, setProjectionSettings] = useState<ProjectionSettings>(() => loadProjectionSettings());
  const [keywordMatchPushDirectlyToObs, setKeywordMatchPushDirectlyToObs] = useState(
    () => readDockBibleKeywordMatchPreference(),
  );
  const [dockFontFamily, setDockFontFamily] = useState<string>(() => loadDockFontFamily());
  const [dockFontScale, setDockFontScale] = useState<number>(() => loadDockFontScale());
  // Automatic fit for small screens / narrow panels; multiplied with the chosen font size below.
  const dockAutoFit = useDockAutoFit();
  const typographyHydrationGenerationRef = useRef(0);
  const [upgradeModalMsg, setUpgradeModalMsg] = useState("");
  const [showPresentationLinkModal, setShowPresentationLinkModal] = useState(false);
  const presentationPublishRequestRef = useRef(0);
  const presentationPublishTailRef = useRef(Promise.resolve());
  const hiddenTabsKey = hiddenTabs.join("|");
  const hiddenTabIds = useMemo(() => {
    const ids = new Set<DockTab>(hiddenTabs);
    if (isFreePlan) {
      for (const tab of FREE_PLAN_HIDDEN_DOCK_TABS) ids.add(tab);
    }
    return ids;
  }, [hiddenTabsKey, isFreePlan]);
  const visibleDockTabs = useMemo(() => DOCK_TABS.filter((tab) => !hiddenTabIds.has(tab.id)), [hiddenTabIds]);
  const navigableDockTabs = useMemo(
    () => visibleDockTabs.filter((tab) => !disabledTabs.includes(tab.id)),
    [disabledTabs, visibleDockTabs],
  );
  const bottomDockTabs = useMemo(
    () => navigableDockTabs.filter((tab) => tab.id !== "broadcast"),
    [navigableDockTabs],
  );

  useEffect(() => {
    setRenderedTab(activeTab);
  }, [activeTab]);

  // Pre-warm the Bible and Worship tab chunks during idle time only on higher-spec machines
  useEffect(() => {
    if (lowMemoryMode) return;
    const run = () => {
      preloadDockTab("bible");
      preloadDockTab("worship");
    };
    const win = typeof window !== "undefined" ? (window as any) : null;
    if (win && typeof win.requestIdleCallback === "function") {
      const handle = win.requestIdleCallback(run, { timeout: 2000 });
      return () => {
        if (typeof win.cancelIdleCallback === "function") {
          win.cancelIdleCallback(handle);
        }
      };
    } else {
      const handle = setTimeout(run, 1500);
      return () => clearTimeout(handle);
    }
  }, [lowMemoryMode]);

  useEffect(() => {
    let cancelled = false;
    const generation = typographyHydrationGenerationRef.current;

    void Promise.all([
      hydrateDockTypographyPreferences(),
      hydrateDockOutputTypographyPreferences(),
    ]).then(([preferences]) => {
      if (cancelled || typographyHydrationGenerationRef.current !== generation) return;
      setDockFontFamily(preferences.fontFamily);
      setDockFontScale(preferences.fontScale);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateProjectionSettings = useCallback((patch: Partial<ProjectionSettings>) => {
    setProjectionSettings((current) => {
      const next = { ...current, ...patch };
      // Persist immediately so a clear/send action in the same interaction
      // sees the checkbox value even before React effects flush.
      saveProjectionSettings(next);
      return next;
    });
  }, []);

  const updateProjectionSceneMode = useCallback((sceneMode: ProjectionSettings["sceneMode"]) => {
    updateProjectionSettings({ sceneMode });
    void dockObsClient.applyProjectionSettings({ allowSceneMutation: true }).catch((error) => {
      console.warn("[Dock] Failed to apply OBS output routing:", error);
    });
  }, [updateProjectionSettings]);

  const updateKeywordMatchDirectPush = useCallback((enabled: boolean) => {
    setKeywordMatchPushDirectlyToObs(enabled);
    updateDockBibleKeywordMatchPreference(enabled);
  }, []);

  const updateDockFontFamily = useCallback((value: string) => {
    typographyHydrationGenerationRef.current += 1;
    const next = normalizeDockFontFamily(value);
    setDockFontFamily(next);
    saveDockFontFamily(next);
  }, []);

  const updateDockFontScale = useCallback((value: string) => {
    typographyHydrationGenerationRef.current += 1;
    const next = normalizeDockFontScale(value);
    setDockFontScale(next);
    saveDockFontScale(next);
  }, []);

  const resetDockTypography = useCallback(() => {
    typographyHydrationGenerationRef.current += 1;
    setDockFontFamily(DEFAULT_DOCK_FONT_FAMILY);
    saveDockFontFamily(DEFAULT_DOCK_FONT_FAMILY);
    setDockFontScale(DEFAULT_DOCK_FONT_SCALE);
    saveDockFontScale(DEFAULT_DOCK_FONT_SCALE);
    saveDockOutputFontFamily(DEFAULT_DOCK_OUTPUT_FONT_FAMILY);
    saveDockOutputFontScale(DEFAULT_DOCK_OUTPUT_FONT_SCALE);
  }, []);

  useEffect(() => {
    if (!isFreePlan || !presentationLinkMode) return;

    const modalKey = getUserScopedKey("ocs-dock-free-presentation-modal-shown-v1");
    try {
      if (localStorage.getItem(modalKey)) return;
      localStorage.setItem(modalKey, "1");
    } catch {
      // Storage unavailable
    }
    setShowPresentationLinkModal(true);
  }, [isFreePlan, presentationLinkMode]);

  useEffect(() => {
    registerUpgradeModal((msg) => setUpgradeModalMsg(msg));
    startPlanRefresh();

    const syncPlan = () => {
      setDockPlan(getDockPlan());
      if (isDockFreePlan() && dockObsClient.isConnected) {
        void dockObsClient.clearMCESourcesForFreePlan();
      }
    };
    const unsubscribePlan = dockClient.onState((msg) => {
      if (msg.type === "state:plan-update") syncPlan();
    });
    const handlePlanStorage = () => syncPlan();
    window.addEventListener("storage", handlePlanStorage);
    const planRefreshTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      syncPlan();
    }, 60_000);

    // Initialize device performance detection for dock (non-blocking). On
    // sub-8 GB systems the tab cache is bounded below so hidden production
    // panels do not accumulate across a service.
    let cancelled = false;
    let unsubscribePerformance: (() => void) | null = null;
    void import("../services/performanceManager").then(async (m) => {
      if (cancelled) return;
      unsubscribePerformance = onPerformanceTierChange((profile) => {
        setLowMemoryMode(isSubEightGbDevice(profile.hardware.totalRAMMB));
      });
      try {
        const profile = await m.init();
        if (!cancelled) setLowMemoryMode(isSubEightGbDevice(profile.hardware.totalRAMMB));
      } catch (err) {
        console.warn("[Dock] Performance manager init failed (non-critical):", err);
      }
    });

    // Also listen for custom dock-upgrade events (from GrowthBadge, etc.)
    const handleUpgradeEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) showUpgradeModal(detail.message);
    };
    window.addEventListener("dock-upgrade", handleUpgradeEvent);
    return () => {
      cancelled = true;
      unsubscribePerformance?.();
      window.removeEventListener("dock-upgrade", handleUpgradeEvent);
      unsubscribePlan();
      window.removeEventListener("storage", handlePlanStorage);
      window.removeEventListener(LOCAL_DEV_PLAN_OVERRIDE_EVENT, handlePlanStorage);
      window.clearInterval(planRefreshTimer);
    };
  }, []);

  // ── Force update check (dock runs in OBS CEF, no Tauri updater) ──
  const [versionAge, setVersionAge] = useState<{ daysOld: number; forceUpdate: boolean; currentVersion?: string; latestVersion?: string }>({ daysOld: 0, forceUpdate: false });
  const [dockSaveFeedback, setDockSaveFeedback] = useState<{ id: number; message: string } | null>(null);
  const dockSaveFeedbackTimerRef = useRef<number | null>(null);
  const [dockSessionTransferBusy, setDockSessionTransferBusy] = useState(false);
  const [dockSessionFeedback, setDockSessionFeedback] = useState<{ id: number; message: string; tone: "success" | "error" } | null>(null);
  const dockSessionImportInputRef = useRef<HTMLInputElement | null>(null);
  const [dockSessionMerge, setDockSessionMerge] = useState(false);
  const dockSessionFeedbackTimerRef = useRef<number | null>(null);

  const showDockSaveFeedback = useCallback((message: string) => {
    setDockSaveFeedback({ id: Date.now(), message });
    if (dockSaveFeedbackTimerRef.current !== null) {
      window.clearTimeout(dockSaveFeedbackTimerRef.current);
    }
    dockSaveFeedbackTimerRef.current = window.setTimeout(() => {
      setDockSaveFeedback(null);
      dockSaveFeedbackTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (dockSaveFeedbackTimerRef.current !== null) {
      window.clearTimeout(dockSaveFeedbackTimerRef.current);
    }
    if (dockSessionFeedbackTimerRef.current !== null) {
      window.clearTimeout(dockSessionFeedbackTimerRef.current);
    }
  }, []);

  const showDockSessionFeedback = useCallback((message: string, tone: "success" | "error" = "success") => {
    setDockSessionFeedback({ id: Date.now(), message, tone });
    if (dockSessionFeedbackTimerRef.current !== null) {
      window.clearTimeout(dockSessionFeedbackTimerRef.current);
    }
    dockSessionFeedbackTimerRef.current = window.setTimeout(() => {
      setDockSessionFeedback(null);
      dockSessionFeedbackTimerRef.current = null;
    }, 3200);
  }, []);

  const handleDockSessionExport = useCallback(async () => {
    if (dockSessionTransferBusy) return;
    setDockSessionTransferBusy(true);
    try {
      const result = await downloadDockSessionBundle();
      if (result.cancelled) {
        showDockSessionFeedback("Export cancelled.", "error");
        return;
      }
      const sectionCount = result.session.sections.filter((section) => Object.keys(section.storage).length > 0).length;
      setShowSettingsMenu(false);
      const destination = result.savedPath
        ? `Saved to ${result.savedPath}.`
        : result.usedBrowserDownload
          ? "Downloaded to your browser's Downloads folder."
          : "Saved as a JSON file.";
      const mediaNote = result.mediaCount > 0
        ? ` ${result.mediaCount} picture${result.mediaCount === 1 ? "" : "s"}/video${result.mediaCount === 1 ? "" : "s"} included.`
        : "";
      const missingNote = result.missingMedia.length > 0 ? ` ${result.missingMedia.length} missing file${result.missingMedia.length === 1 ? "" : "s"} skipped.` : "";
      showDockSessionFeedback(`Exported ${sectionCount || result.session.sections.length} Dock sections.${mediaNote}${missingNote} ${destination}`);
    } catch (error) {
      console.error("[Dock] Failed to export Dock session:", error);
      showDockSessionFeedback("Could not export the Dock session.", "error");
    } finally {
      setDockSessionTransferBusy(false);
    }
  }, [dockSessionTransferBusy, showDockSessionFeedback]);

  const handleDockSessionImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || dockSessionTransferBusy) return;

    setDockSessionTransferBusy(true);
    try {
      const result = await importDockSessionFromFile(file, { merge: dockSessionMerge });
      setShowSettingsMenu(false);
      const copied = result.warnings.length > 0 ? ` (${result.warnings.length} note${result.warnings.length === 1 ? "" : "s"}, see console)` : "";
      if (result.warnings.length > 0) console.warn("[Dock] Session import notes:", result.warnings);
      showDockSessionFeedback(`Imported ${result.sectionCount} Dock sections${copied}. Refreshing the Dock…`);
      window.setTimeout(() => window.location.reload(), 850);
    } catch (error) {
      console.error("[Dock] Failed to import Dock session:", error);
      showDockSessionFeedback(error instanceof Error ? error.message : "Could not import the Dock session.", "error");
    } finally {
      setDockSessionTransferBusy(false);
    }
  }, [dockSessionMerge, dockSessionTransferBusy, showDockSessionFeedback]);

  // ── Global drag-and-drop ──
  const { isDragging, onDrop: registerDropHandler } = useDockDragDrop();
  const { uploading, uploadProgress, toasts: uploadToasts, handleFiles, dismissToast } = useDockUpload();

  useEffect(() => {
    return registerDropHandler(handleFiles);
  }, [registerDropHandler, handleFiles]);

  useEffect(() => {
    // Never write before the saved preferences were loaded, or the default tab
    // would replace the operator's last tab.
    if (!isNativeDockSettingsHydrated()) return;
    // A forced fallback (preferred tab hidden for now) must not overwrite the
    // operator's choice; any other tab change is the operator's choice.
    if (activeTab !== fallbackTabRef.current) {
      preferredTabRef.current = activeTab;
      fallbackTabRef.current = null;
    }
    saveDockShellPreferences({
      ...loadDockShellPreferences(),
      activeTab: preferredTabRef.current,
      disabledTabs,
      searchPlacement,
    });
  }, [activeTab, disabledTabs, searchPlacement]);

  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);

  // Keep visited tabs mounted when the operator moves around the dock so
  // in-progress work is preserved and tab switching between Bible, Worship,
  // and Media is instant without re-initialization lag.
  useEffect(() => {
    setVisitedTabs((current) => {
      const maxTabs = lowMemoryMode ? 1 : 2;
      if (current.has(activeTab) && current.size <= maxTabs) return current;
      const next = new Set(current);
      next.delete(activeTab);
      next.add(activeTab);
      while (next.size > maxTabs) {
        const oldest = next.values().next().value;
        if (!oldest || oldest === activeTab) break;
        next.delete(oldest);
      }
      return next;
    });
  }, [activeTab, lowMemoryMode]);

  useEffect(() => {
    const preferred = preferredTabRef.current;
    if (
      fallbackTabRef.current === activeTab
      && preferred !== activeTab
      && visibleDockTabs.some((tab) => tab.id === preferred)
    ) {
      // The saved tab became available (e.g. the plan arrived after startup).
      fallbackTabRef.current = null;
      setActiveTab(preferred);
      return;
    }
    if (visibleDockTabs.some((tab) => tab.id === activeTab)) return;
    const fallback = visibleDockTabs[0]?.id ?? "bible";
    fallbackTabRef.current = fallback;
    setActiveTab(fallback);
  }, [activeTab, visibleDockTabs]);

  const mountedDockTabs = useMemo(() => {
    const mounted = new Set([...visitedTabs, renderedTab]);
    if (isFreePlan) {
      for (const tab of FREE_PLAN_HIDDEN_DOCK_TABS) mounted.delete(tab);
    }
    return mounted;
  }, [isFreePlan, renderedTab, visitedTabs]);

  useEffect(() => {
    saveDockStagedItem(staged);
  }, [staged]);

  useEffect(() => installDockTextShortcuts(), []);

  // ── Track dock height for responsive tab layout ──
  useEffect(() => {
    const el = dockRootRef.current;
    if (!el) return;
    const updateHeight = () => setDockHeight(el.getBoundingClientRect().height);
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextH = Math.round(entry.contentRect.height);
        setDockHeight((prev) => (Math.abs(prev - nextH) >= 8 ? nextH : prev));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Dock popovers use both normal descendants and document-level portals. Keep
  // one shared registry for transient menus/modals/popovers, while leaving the
  // main cards structural. Bring the active transient layer above its siblings
  // when it receives a pointer or keyboard focus.
  useEffect(() => {
    const root = dockRootRef.current;
    if (!root || typeof document === "undefined") return;

    markDockLayerSubtree(root);
    markDockLayerSubtree(document.body);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          markDockLayerElement(record.target as Element);
          const nextZIndex = dockLayerOrderRef.current + 1;
          if (raiseDockLayerAtTarget(record.target, nextZIndex)) {
            dockLayerOrderRef.current = nextZIndex;
          }
        }
        for (const node of record.addedNodes) {
          markDockLayerSubtree(node);
          const nextZIndex = dockLayerOrderRef.current + 1;
          if (raiseDockLayerAtTarget(node, nextZIndex)) {
            dockLayerOrderRef.current = nextZIndex;
          }

          // A portal can add a neutral wrapper around its actual dialog/menu.
          // Raise the first registered descendant so the new surface starts in
          // front even when it is not an ancestor of the clicked trigger.
          if (node instanceof Element) {
            const nestedLayer = node.querySelector('[data-dock-layer-surface="true"]');
            if (nestedLayer && raiseDockLayerAtTarget(nestedLayer, nextZIndex)) {
              dockLayerOrderRef.current = nextZIndex;
            }
          }
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-expanded", "class", "hidden", "role"],
      childList: true,
      subtree: true,
    });

    const raiseActiveLayer = (event: Event) => {
      const nextZIndex = dockLayerOrderRef.current + 1;
      if (raiseDockLayerAtTarget(event.target, nextZIndex)) {
        dockLayerOrderRef.current = nextZIndex;
      }
    };

    document.addEventListener("pointerdown", raiseActiveLayer, true);
    document.addEventListener("focusin", raiseActiveLayer, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", raiseActiveLayer, true);
      document.removeEventListener("focusin", raiseActiveLayer, true);
    };
  }, []);

  useEffect(() => {
    void loadDockProductionSettings().then(setProductionSettings).catch(() => { });
  }, []);

  // ── Force update: only warn when a genuinely newer release is available ──
  useEffect(() => {
    // In non-Tauri environments (OBS browser dock, web client), update enforcement
    // is handled by DockAuthGate and desktop binary updates cannot be installed here.
    const isNativeTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isNativeTauri) return;

    const CACHE_KEY = "ocs-dock-update-cache-v1";

    // Use config for force-update settings (fallback: 21 days).
    // Keep this in hours so a configured value such as 1 does not round to 0 days.
    const configuredGracePeriodHours = Number(cfg.appUpdates.gracePeriodHours);
    const gracePeriodHours = Number.isFinite(configuredGracePeriodHours)
      ? Math.max(0, configuredGracePeriodHours)
      : 24 * 21;
    const forceEnabled = cfg.appUpdates.forceUpdatesEnabled;

    const currentVersion = normalizeDockVersion(
      typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
    );

    if (!forceEnabled || !currentVersion) return;

    const evaluateRelease = (publishedAt: string, tagName?: string) => {
      const latestVersion = normalizeDockVersion(tagName);
      if (!latestVersion || !gt(latestVersion, currentVersion)) return;

      const releaseDate = new Date(publishedAt);
      if (Number.isNaN(releaseDate.getTime())) return;
      const ageHours = Math.max(0, (Date.now() - releaseDate.getTime()) / (1000 * 60 * 60));
      const daysOld = Math.floor(ageHours / 24);

      if (ageHours >= gracePeriodHours) {
        setVersionAge({ daysOld, forceUpdate: true, currentVersion, latestVersion });
      }
    };

    fetchLatestPublishedRelease()
      .then((release) => {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ date: new Date().toISOString(), version: release.version }));
        } catch { /* non-critical */ }
        evaluateRelease(new Date().toISOString(), release.version);
      })
      .catch(() => {
        // Offline fallback: use the last release, but keep the same version guard.
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as { date?: string; version?: string };
            if (cached.date) evaluateRelease(cached.date, cached.version);
          }
        } catch { /* non-critical */ }
      });
  }, [cfg.appUpdates.forceUpdatesEnabled, cfg.appUpdates.gracePeriodHours]);

  useEffect(() => {
    dockClient.init();

    // ── Aggressive auto-reconnect on every dock reload ──
    // Immediately attempt connection using persisted params (URL query → saved → default).
    // If the first attempt fails, retry every 2 seconds until OBS is reachable.
    let autoReconnectTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const tryConnect = () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (dockObsClient.isConnected) {
        if (autoReconnectTimer) { clearInterval(autoReconnectTimer); autoReconnectTimer = null; }
        return;
      }
      void dockObsClient.connect();
    };

    if (!externalObsSession && !presentationLinkMode) {
      // First attempt — immediate
      tryConnect();

      // Retry every 2 seconds until connected
      autoReconnectTimer = setInterval(tryConnect, getRecommendedPollingInterval(2000));
    }

    const unsubObs = dockObsClient.onStatusChange((status: DockObsStatus, err?: string) => {
      setObsConnected(status === "connected");
      setObsError(status === "error" ? formatDockObsError(err || t('dock.connectionFailed')) : "");

      if (status === "connected") {
        // Stop auto-reconnect — we're connected
        if (autoReconnectTimer) { clearInterval(autoReconnectTimer); autoReconnectTimer = null; }

        if (isDockFreePlan()) {
          void dockObsClient.clearMCESourcesForFreePlan();
        }

        dockObsClient.recoverLiveState().then((recovered) => {
          setStaged((current) => {
            if (current) return current;
            if (recovered.bible) {
              // Show what is live without moving the operator off the tab they chose.
              const compare = recovered.bible.compare;
              const leftColumn = compare?.columns?.[0] ?? null;
              const compareLabel =
                compare?.columns?.map((column) => column.referenceLabel).filter(Boolean).join(" | ") || "";
              const compareSubtitle =
                compare?.columns?.map((column) => column.translation).filter(Boolean).join(" · ") || "";
              return {
                type: "bible",
                label: compareLabel || recovered.bible.reference || t('dock.bibleVerseFallback'),
                subtitle: compareSubtitle || recovered.bible.text || "",
                data: {
                  book: leftColumn?.book ?? "",
                  chapter: leftColumn?.chapter ?? 0,
                  verse: leftColumn?.verse ?? 0,
                  verseEnd: leftColumn?.verseEnd ?? leftColumn?.verse ?? 0,
                  verseRange: leftColumn?.verseRange ?? "",
                  translation: leftColumn?.translation ?? "",
                  referenceLabel: compareLabel || recovered.bible.reference,
                  verseText: recovered.bible.text,
                  overlayMode: recovered.bible.overlayMode,
                  compare,
                  _recovered: true,
                  _dockLive: true,
                },
              };
            }
            if (recovered.worship) {
              // Show what is live without moving the operator off the tab they chose.
              return {
                type: "worship",
                label: recovered.worship.sectionLabel || t('dock.worshipFallback'),
                subtitle: recovered.worship.songTitle || "",
                data: {
                  sectionText: recovered.worship.sectionText,
                  translationText: recovered.worship.translationText ?? "",
                  sectionLabel: recovered.worship.sectionLabel,
                  song: { title: recovered.worship.songTitle, artist: recovered.worship.artist },
                  overlayMode: recovered.worship.overlayMode,
                  _recovered: true,
                  _dockLive: true,
                },
              };
            }
            return null;
          });
        }).catch((error) => {
          console.warn("[Dock] Failed to recover live state:", error);
        });
      }
    });

    // The app saved, deleted or hid a theme: re-read the themes and the selected-theme
    // copy, then let the tabs swap in the edited versions (see dockThemeRefresh.ts).
    let themeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshThemesFromApp = () => {
      if (themeRefreshTimer) clearTimeout(themeRefreshTimer);
      themeRefreshTimer = setTimeout(() => {
        themeRefreshTimer = null;
        void (async () => {
          const [themes] = await Promise.all([
            loadDockFavoriteBibleThemes({ fresh: true }).catch(() => []),
            loadDockProductionSettings().then((next) => { if (!disposed) setProductionSettings(next); }).catch(() => undefined),
          ]);
          if (!disposed && themes.length > 0) announceDockThemesRefreshed(themes);
        })();
      }, 200);
    };

    const unsubState = dockClient.onState((msg: DockStateMessage) => {
      switch (msg.type) {
        case "state:favorite-themes-updated":
          refreshThemesFromApp();
          break;
        case "state:pong":
          setAppConnected(true);
          break;
        case "state:obs-status":
          if (!dockObsClient.isConnected) {
            setObsConnected((msg.payload as { connected: boolean }).connected);
          }
          break;
        case "state:branding-updated": {
          void dockObsClient.refreshBrandingCache().catch(() => { });
          break;
        }
        case "state:update": {
          setAppConnected(true);
          const payload = msg.payload as Record<string, unknown>;
          if (!dockObsClient.isConnected && typeof payload.obsConnected === "boolean") {
            setObsConnected(payload.obsConnected);
          }
          if (isDockProductionSettingsPayload(payload.productionSettings)) {
            setProductionSettings(payload.productionSettings);
          }
          if (payload.servicePlanner) {
            setServicePlanner(payload.servicePlanner as ServicePlannerSnapshot);
          }
          break;
        }
        case "state:service-plans": {
          setServicePlanner(msg.payload as ServicePlannerSnapshot);
          break;
        }
        default:
          break;
      }
    });

    const pingInterval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      dockClient.sendCommand({ type: "ping", timestamp: Date.now() });
    }, 5000);

    dockClient.sendCommand({ type: "request-state", timestamp: Date.now() });

    return () => {
      disposed = true;
      if (autoReconnectTimer) clearInterval(autoReconnectTimer);
      unsubObs();
      unsubState();
      if (themeRefreshTimer) clearTimeout(themeRefreshTimer);
      window.clearInterval(pingInterval);
      if (!externalObsSession && !presentationLinkMode) {
        dockObsClient.disconnect();
      }
    };
  }, [externalObsSession, presentationLinkMode]);

  const handleStage = useCallback((item: DockStagedItem | null) => {
    setStaged(item);
    // The Presentation Studio (when open) puts the same item on its Program.
    emitStudioDockEvent({ kind: "stage", item });
    const requestId = ++presentationPublishRequestRef.current;
    presentationPublishTailRef.current = presentationPublishTailRef.current
      .catch(() => undefined)
      .then(async () => {
        // Keep rapid next/previous clicks ordered and ensure the latest click
        // is the final state written to the shared presentation session. The
        // link mirrors the current Dock selection even when a paid plan also
        // sends that selection directly to OBS.
        if (requestId !== presentationPublishRequestRef.current) return;
        await publishDockStagedItemToPresentation(item);
      })
      .catch((error) => {
        console.warn("[Dock] Failed to publish staged item to presentation link:", error);
      });
  }, []);

  const handleManualConnect = useCallback(async () => {
    setObsError("");
    try {
      const obsUrl = normalizeOBSWebSocketUrl(obsUrlInput);
      setObsUrlInput(obsUrl);
      await ensureObsConnected(obsUrl, obsPwInput || undefined);
    } catch (err) {
      setObsError(formatDockObsError(err instanceof Error ? err.message : t('dock.connectionFailed')));
    }
  }, [obsPwInput, obsUrlInput]);

  const nextTheme = effective === "dark" ? "light" : "dark";
  const themeToggleLabel = nextTheme === "dark" ? t('dock.switchToDarkMode') : t('dock.switchToLightMode');
  const themeToggleIcon = nextTheme === "dark" ? "moon" : "sun";

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // ── Command Palette ──
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState("");

  const openCommandPalette = useCallback((initialQuery = "") => {
    setCommandPaletteInitialQuery(initialQuery);
    setShowCommandPalette(true);
  }, []);

  const handleCommandPaletteSelectBibleVerse = useCallback((_book: string, _chapter: number, _verse: number) => {
    setActiveTab("bible");
    setShowCommandPalette(false);
  }, []);

  const handleNavigateToBible = useCallback(() => {
    setActiveTab("bible");
  }, []);

  const handleCommandPaletteSelectTemplate = useCallback((_templateKind: "bible" | "lower-third", _themeId: string) => {
    setShowCommandPalette(false);
  }, []);

  const shortcuts: ShortcutDefinition[] = [
    ...DOCK_TAB_SHORTCUTS
      .filter(({ tab }) => navigableDockTabs.some((candidate) => candidate.id === tab))
      .map(({ key, tab, labelKey }) => ({
        key,
        modifier: "primary" as const,
        handler: () => setActiveTab(tab),
        label: t(labelKey),
        category: t('page.shortcutCategoryNavigation') as ShortcutCategory,
      })),
    { key: "k", handler: () => openCommandPalette(""), label: t('page.shortcutCommandPalette'), category: t('page.shortcutCategoryUtility') as ShortcutCategory },
    {
      key: "f",
      modifier: "primary" as const,
      allowInInputs: true,
      handler: () => {
        const found = triggerTabSearchInput();
        if (!found) {
          openCommandPalette("");
        }
      },
      label: t('page.shortcutSearch', 'Search in Tab'),
      category: t('page.shortcutCategoryUtility') as ShortcutCategory,
    },
    { key: "t", handler: () => setTheme(nextTheme), label: themeToggleLabel, category: t('page.shortcutCategoryUtility') as ShortcutCategory },
    { key: "/", handler: () => setShowShortcutsHelp((v) => !v), label: t('page.shortcutsHelp'), category: t('page.shortcutCategoryUtility') as ShortcutCategory },
  ];

  const { toasts } = useKeyboardShortcuts(shortcuts, true);

  // ── Settings Menu State ──
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showBibleSearch, setShowBibleSearch] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // Listen for dock-open-menu custom event (fired by tab headers)
  useEffect(() => {
    const handler = () => setShowSettingsMenu((prev) => !prev);
    window.addEventListener("dock-open-menu", handler);
    return () => window.removeEventListener("dock-open-menu", handler);
  }, []);
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [showProjectionSettings, setShowProjectionSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const handleHistoryClose = useCallback(() => setShowHistory(false), []);
  const [showClearScenesConfirm, setShowClearScenesConfirm] = useState(false);
  const [clearScenesLoading, setClearScenesLoading] = useState(false);

  // ── Language Selector ──
  const ALL_LANGUAGES: string[] = ["English", "French", "Spanish", "Portuguese", "Yoruba", "Igbo", "Hausa", "Ghanaian"];
  const [interfaceLanguage, setInterfaceLanguage] = useState<string>(() => readNativeDockSetting<string>("mce_interface_language") || "English");
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);

  const dockStyle = useMemo<CSSProperties>(() => {
    const dockVariables = getDockAppearanceCssVariables(appearance, effective);

    // Keep the effect opt-in, but make the glass preference flow through every
    // Dock component that consumes the shared surface tokens. This means cards,
    // panels, menus, and dialogs receive the same translucent treatment without
    // overriding their active, warning, or destructive state colors.
    if (appearance.dockVisuals.glassSurface) {
      const makeTranslucent = (key: string, opacity: number) => {
        const base = dockVariables[key];
        if (base) dockVariables[key] = `color-mix(in srgb, ${base} ${opacity}%, transparent)`;
      };

      makeTranslucent("--dock-bg-secondary", 94);
      makeTranslucent("--dock-surface", 86);
      makeTranslucent("--dock-surface-alt", 82);
      makeTranslucent("--dock-surface-hover", 78);
      makeTranslucent("--dock-surface-overlay", 80);
      makeTranslucent("--dock-input-bg", 90);
      dockVariables["--dock-card"] = dockVariables["--dock-surface-alt"];
      dockVariables["--dock-card-hover"] = dockVariables["--dock-surface-hover"];
    }

    return {
      ...dockVariables,
      "--dock-font-body": buildDockFontFamilyStack(dockFontFamily),
      "--dock-font-heading": buildDockFontFamilyStack(dockFontFamily),
      "--dock-font-scale": String(Math.round(dockFontScale * dockAutoFit * 1000) / 1000),
    } as CSSProperties;
  }, [appearance, effective, dockFontFamily, dockFontScale, dockAutoFit]);

  // Menus and popovers portalled to <body> sit outside `.dock-root`, so they miss its
  // CSS zoom (auto-fit + font size). Publish the same scale on <html> so they can use it.
  const effectiveDockScale = Math.round(dockFontScale * dockAutoFit * 1000) / 1000;
  useEffect(() => {
    document.documentElement.style.setProperty("--dock-font-scale", String(effectiveDockScale));
  }, [effectiveDockScale]);

  const updateDockVisual = useCallback((key: keyof DockVisualPreferences, enabled: boolean) => {
    setAppearance({
      dockVisuals: {
        ...appearance.dockVisuals,
        [key]: enabled,
      },
    });
  }, [appearance.dockVisuals, setAppearance]);

  const resetDockVisuals = useCallback(() => {
    setAppearance({ dockVisuals: { ...DEFAULT_DOCK_VISUALS } });
  }, [setAppearance]);

  const dockRootClassName = [
    "dock-root",
    verticalTabs ? "dock-root--vertical-tabs" : "",
    appearance.dockVisuals.glassSurface ? "dock-root--glass" : "",
    appearance.dockVisuals.radialGlow ? "dock-root--radial-glow" : "",
    appearance.dockVisuals.softShadow ? "dock-root--soft-shadow" : "",
    appearance.dockVisuals.motion ? "dock-root--motion" : "dock-root--motion-off",
    headerCollapsed ? "dock-root--header-collapsed" : "",
  ].filter(Boolean).join(" ");

  return (
    <DockOutputTargetContext.Provider value={presentationOutputTarget}>
    <div className={dockRootClassName} ref={dockRootRef} style={dockStyle}>
      <input
        ref={dockSessionImportInputRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        onChange={handleDockSessionImport}
        hidden
        aria-hidden="true"
      />
      <a className="mce-skip-link" href="#dock-main-content">
        {t('mvShell.skipToContent', 'Skip to main content')}
      </a>

      <div className="dock-main-column">
        <DockBrowserZoomWarning />
        {/* ── Force Update Banner ── */}
        {versionAge.forceUpdate && (
          <div className="dock-force-update-banner">
            <Icon name="warning" size={14} />
            <span>
              This has been blocked because you need to update the app.
              {versionAge.currentVersion && versionAge.latestVersion && (
                <> (v{versionAge.currentVersion} → v{versionAge.latestVersion})</>
              )}
            </span>
          </div>
        )}

        {/* ── Maintenance Mode Banner ── */}
        {cfg.security.maintenanceMode && (
          <div className="dock-force-update-banner" style={{ background: "var(--accent, #f59e0b)", color: "#000" }}>
            <Icon name="build" size={14} />
            <span>{t('page.maintenance')}</span>
          </div>
        )}

        {/* ── Page Header (hamburger L, refresh and theme R) ── */}
        {!hideShellHeader && activeTab !== "bible" && (
          <div
            className="dock-inline-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: headerCollapsed ? "0 4px" : "6px 8px",
              borderBottom: "1px solid var(--dock-border)",
              flexShrink: 0,
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                type="button"
                className="dock-inline-header__icon-btn"
                aria-expanded={!headerCollapsed}
                aria-controls="dock-shell-header-actions"
                aria-label={headerCollapsed ? t("page.expandHeader", "Expand header") : t("page.collapseHeader", "Collapse header")}
                title={headerCollapsed ? t("page.expandHeader", "Expand header") : t("page.collapseHeader", "Collapse header")}
                onClick={() => setHeaderCollapsed((prev) => !prev)}
                style={{
                  width: headerCollapsed ? 24 : 28,
                  height: headerCollapsed ? 24 : 28,
                  color: "var(--dock-text)",
                }}
              >
                <Icon name={headerCollapsed ? "chevron_right" : "expand_more"} size={headerCollapsed ? 12 : 14} />
              </button>
              {!headerCollapsed && (
                <button
                  type="button"
                  className="dock-inline-header__icon-btn"
                  onClick={(e) => { e.stopPropagation(); setShowSettingsMenu((prev) => !prev); }}
                  style={{
                    width: 28,
                    height: 28,
                    color: "var(--dock-text)",
                  }}
                  aria-label={t("page.menu", "Menu")}
                  title={t("page.menu", "Menu")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" /></svg>
                </button>
              )}
            </div>

            <div
              id="dock-shell-header-actions"
              hidden={headerCollapsed}
              style={{ display: "flex", alignItems: "center", gap: 2 }}
            >
              {!headerCollapsed && (
                <>
                  <button
                    type="button"
                    className="dock-inline-header__icon-btn"
                    onClick={() => setTheme(nextTheme)}
                    aria-label={themeToggleLabel}
                    title={themeToggleLabel}
                  >
                    <Icon name={themeToggleIcon} size={14} />
                  </button>
                  <button
                    type="button"
                    className="dock-inline-header__icon-btn"
                    onClick={() => window.location.reload()}
                    aria-label={t("common.refresh", "Refresh")}
                    title={t("common.refresh", "Refresh")}
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Sidebar ── */}
        {showSettingsMenu && (
          <div className="dock-sidebar-backdrop" onClick={() => setShowSettingsMenu(false)}>
            <div className="dock-sidebar" role="dialog" aria-modal="true" aria-labelledby="dock-menu-title" onClick={(e) => e.stopPropagation()}>
              <div className="dock-sidebar__header">
                <span id="dock-menu-title" className="dock-sidebar__title">{t('dock.menu')}</span>
                <button
                  type="button"
                  className="dock-shell-icon-btn"
                  onClick={() => setShowSettingsMenu(false)}
                  aria-label={t('common.close')}
                  title={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              </div>

              <div className="dock-sidebar__content">
                {/* Dock interface */}
                <div className="dock-sidebar__standalone-section">
                  <div className="dock-sidebar__section-label">{t('page.dockTypography', 'Dock interface')}</div>
                  <div id="dock-interface-panel" className="dock-sidebar__dock-interface-panel">
                    <div className="dock-sidebar__select-field">
                      <span className="dock-sidebar__select-label">
                        <Icon name="search" size={14} />
                        <span>{t('page.searchPlacement', 'Search placement')}</span>
                      </span>
                      <div className="dock-appearance-mode" role="group" aria-label={t('page.searchPlacement', 'Search placement')}>
                        {([
                          ["top", t('page.searchPlacementTop', 'Top only')],
                          ["bottom", t('page.searchPlacementBottom', 'Bottom only')],
                        ] as const).map(([placement, label]) => (
                          <button
                            key={placement}
                            type="button"
                            className={`dock-appearance-mode__button${searchPlacement === placement ? " dock-appearance-mode__button--active" : ""}`}
                            onClick={() => setSearchPlacement(placement)}
                            aria-pressed={searchPlacement === placement}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="dock-sidebar__hint">
                        {t('page.searchPlacementDesc', 'Choose where the Bible, Worship, and Notes search card appears in the Dock.')}
                      </div>
                    </div>
                    <label className="dock-sidebar__select-field">
                      <span className="dock-sidebar__select-label">
                        <Icon name="font_download" size={14} />
                        <span>{t('page.dockFontFamily', 'Dock font family')}</span>
                      </span>
                      <select
                        className="dock-sidebar__select"
                        value={dockFontFamily}
                        onChange={(event) => updateDockFontFamily(event.target.value)}
                        aria-label={t('page.dockFontFamily', 'Dock font family')}
                      >
                        <option value="">{t('page.dockFontFamilySourceDefault', 'Use app default')}</option>
                        {DOCK_FONT_FAMILY_GROUPS.map((group) => (
                          <optgroup key={group} label={group}>
                            {DOCK_FONT_FAMILY_OPTIONS.filter((option) => option.group === group).map((option) => (
                              <option key={option.id} value={option.family} style={{ fontFamily: option.family }}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label className="dock-sidebar__select-field">
                      <span className="dock-sidebar__select-label">
                        <Icon name="text_fields" size={14} />
                        <span>{t('page.dockFontSize', 'Dock font size')}</span>
                        <output className="dock-sidebar__value" htmlFor="dock-font-scale">
                          {Math.round(dockFontScale * dockAutoFit * 100)}%
                        </output>
                      </span>
                      <select
                        id="dock-font-scale"
                        className="dock-sidebar__select"
                        value={String(dockFontScale)}
                        onChange={(event) => updateDockFontScale(event.target.value)}
                        aria-label={t('page.dockFontSize', 'Dock font size')}
                      >
                        {DOCK_FONT_SCALE_OPTIONS.map((option) => (
                          <option key={option.id} value={String(option.value)}>
                            {t(`page.fontSize.${option.id}`, option.label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="dock-sidebar__hint">
                      {t('page.dockTypographyDesc', 'Changes the Dock interface only. OBS text uses CMG Sans by default.')}
                    </div>
                    <button
                      type="button"
                      className="dock-sidebar__reset"
                      onClick={resetDockTypography}
                      disabled={dockFontFamily === DEFAULT_DOCK_FONT_FAMILY && dockFontScale === DEFAULT_DOCK_FONT_SCALE}
                    >
                      <Icon name="restart_alt" size={13} />
                      <span>{t('page.resetTypography', 'Reset typography')}</span>
                    </button>
                  </div>
                </div>

                {/* Output software (OBS / vMix) */}
                {/* Hidden from users: the switch only appears once vMix was opened with ?output=vmix. */}
                {!requestedPresentationOutputTarget && outputSoftware === "vmix" && String(dockPlan || "").toLowerCase() !== "free" && (
                  <div className="dock-sidebar__subpanel" data-testid="dock-output-software">
                    <div className="dock-sidebar__section-label">{t('page.outputSoftware', 'Output software')}</div>
                    <div className="dock-appearance-mode" role="group" aria-label={t('page.outputSoftware', 'Output software')}>
                      {([
                        ["obs", "OBS"],
                        ["vmix", "vMix"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`dock-appearance-mode__button${outputSoftware === value ? " dock-appearance-mode__button--active" : ""}`}
                          onClick={() => {
                            writeDockOutputSoftware(value);
                            setOutputSoftware(value);
                          }}
                          aria-pressed={outputSoftware === value}
                          data-testid={`dock-output-software-${value}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Appearance */}
                <button
                  type="button"
                  className={`dock-sidebar__item${showAppearance ? " dock-sidebar__item--open" : ""}`}
                  onClick={() => setShowAppearance((current) => !current)}
                  title={t('page.appearance', 'Appearance')}
                  aria-expanded={showAppearance}
                  aria-controls="appearance-panel"
                >
                  <Icon name="palette" size={16} />
                  <span>{t('page.appearance', 'Appearance')}</span>
                  <Icon name={showAppearance ? "expand_less" : "expand_more"} size={14} />
                </button>
                {showAppearance && (
                  <div id="appearance-panel" className="dock-sidebar__subpanel dock-sidebar__appearance-panel">
                    <div className="dock-sidebar__section-label">{t('page.colorMode', 'Color mode')}</div>
                    <div className="dock-appearance-mode" role="group" aria-label={t('page.colorMode', 'Color mode')}>
                      {([
                        ["system", t('page.system', 'System')],
                        ["dark", t('page.dark', 'Dark')],
                        ["light", t('page.light', 'Light')],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`dock-appearance-mode__button${themePreference === mode ? " dock-appearance-mode__button--active" : ""}`}
                          onClick={() => setTheme(mode)}
                          aria-pressed={themePreference === mode}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="dock-sidebar__section-label dock-sidebar__section-label--spaced">
                      {t('page.colorTheme', 'Color theme')}
                    </div>
                    <div className="dock-appearance-palette-grid">
                      {APP_APPEARANCE_PALETTES.map((palette) => {
                        const selected = appearance.palette === palette.id;
                        return (
                          <button
                            key={palette.id}
                            type="button"
                            className={`dock-appearance-palette${selected ? " dock-appearance-palette--active" : ""}`}
                            onClick={() => setAppearance({ palette: palette.id })}
                            aria-pressed={selected}
                            title={palette.description}
                          >
                            <span className="dock-appearance-palette__swatches" aria-hidden="true">
                              {palette.swatches.map((swatch) => (
                                <span key={swatch} style={{ background: swatch }} />
                              ))}
                            </span>
                            <span className="dock-appearance-palette__copy">
                              <span className="dock-appearance-palette__title">{palette.label}</span>
                              <span className="dock-appearance-palette__desc">{palette.description}</span>
                            </span>
                            {selected && <Icon name="check" size={13} />}
                          </button>
                        );
                      })}
                    </div>

                    <label className={`dock-appearance-custom${appearance.palette === "custom" ? " dock-appearance-custom--active" : ""}`}>
                      <span className="dock-appearance-custom__copy">
                        <span className="dock-appearance-palette__title">{t('page.customAccent', 'Custom accent')}</span>
                        <span className="dock-appearance-palette__desc">{t('page.customAccentDesc', 'Use a personal accent color')}</span>
                      </span>
                      <input
                        type="color"
                        value={appearance.customAccent}
                        onChange={(event) => setAppearance({ palette: "custom", customAccent: event.target.value })}
                        aria-label={t('page.customAccent', 'Custom accent')}
                      />
                    </label>
                    <div className="dock-sidebar__hint">
                      {t('page.appearanceScope', 'Applies to the app and Dock controls. OBS Bible, Worship, and graphics styles stay independent.')}
                    </div>

                    <div className="dock-sidebar__section-label dock-sidebar__section-label--spaced">
                      {t('page.dockStyle', 'Dock style')}
                    </div>
                    <div className="dock-appearance-effects">
                      <div className="dock-appearance-effects__intro">
                        {t('page.dockStyleDesc', 'Personalize the entire Dock without changing your live graphics.')}
                      </div>
                      {([
                        ["glassSurface", "layers", t('page.dockGlass', 'Glass surface'), t('page.dockGlassDesc', 'Adds soft translucent depth across Dock surfaces, cards, and dialogs.')],
                        ["radialGlow", "gradient", t('page.dockGlow', 'Accent glow'), t('page.dockGlowDesc', 'Adds a gentle glow from your selected accent color across the Dock.')],
                        ["softShadow", "shadow", t('page.dockShadow', 'Soft shadows'), t('page.dockShadowDesc', 'Adds light elevation to Dock surfaces and controls.')],
                        ["motion", "animation", t('page.dockMotion', 'Smooth motion'), t('page.dockMotionDesc', 'Keeps hover, panel, and tab transitions feeling alive across the Dock.')],
                      ] as const).map(([key, icon, label, description]) => (
                        <label key={key} className="dock-appearance-toggle">
                          <span className="dock-appearance-toggle__copy">
                            <span className="dock-appearance-toggle__title">
                              <Icon name={icon} size={13} />
                              <span>{label}</span>
                            </span>
                            <span className="dock-appearance-toggle__desc">{description}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={appearance.dockVisuals[key]}
                            onChange={(event) => updateDockVisual(key, event.target.checked)}
                            aria-label={label}
                          />
                          <span className="dock-appearance-toggle__track" aria-hidden="true">
                            <span className="dock-appearance-toggle__thumb" />
                          </span>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="dock-sidebar__reset"
                      onClick={resetDockVisuals}
                      disabled={Object.entries(DEFAULT_DOCK_VISUALS).every(([key, value]) => appearance.dockVisuals[key as keyof DockVisualPreferences] === value)}
                    >
                      <Icon name="restart_alt" size={13} />
                      <span>{t('page.resetDockStyle', 'Reset Dock style')}</span>
                    </button>

                  </div>
                )}

                {/* Language */}
                <div className="dock-sidebar__item" style={{ cursor: "default" }}>
                  <Icon name="translate" size={16} />
                  <select
                    className="dock-sidebar__select"
                    value={interfaceLanguage}
                    onChange={(e) => {
                      setPendingLanguage(e.target.value);
                      setShowLanguageModal(true);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      fontSize: "inherit",
                      fontFamily: "inherit",
                      cursor: "pointer",
                      outline: "none",
                      flex: 1,
                      padding: 0,
                    }}
                  >
                    {ALL_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>

                <div className="dock-sidebar__divider" />

                <button
                  type="button"
                  className={`dock-sidebar__item${showBibleSearch ? " dock-sidebar__item--open" : ""}`}
                  onClick={() => setShowBibleSearch((current) => !current)}
                  title={t('page.bibleSearch', 'Bible search')}
                  aria-expanded={showBibleSearch}
                  aria-controls="bible-search-panel"
                >
                  <Icon name="search" size={16} />
                  <span>{t('page.bibleSearch', 'Bible search')}</span>
                  <Icon name={showBibleSearch ? "expand_less" : "expand_more"} size={14} />
                </button>
                {showBibleSearch && (
                  <div id="bible-search-panel" className="dock-sidebar__subpanel">
                    <label className="dock-sidebar__check dock-sidebar__check--stacked">
                      <input
                        type="checkbox"
                        checked={keywordMatchPushDirectlyToObs}
                        onChange={(event) => updateKeywordMatchDirectPush(event.target.checked)}
                      />
                      <span className="dock-sidebar__check-copy">
                        <span>{t('page.keywordMatchDirectPush', 'Auto-send keyword matches')}</span>
                        <small>{t('page.keywordMatchDirectPushDesc', 'Send a matched verse to OBS right away.')}</small>
                      </span>
                    </label>
                  </div>
                )}

                {!presentationLinkMode && (
                  <>
                    <div className="dock-sidebar__divider" />

                    {/* Advanced OBS Output */}
                    <button
                      type="button"
                      className="dock-sidebar__item"
                      onClick={() => setShowProjectionSettings(!showProjectionSettings)}
                      title={t('page.advancedObsOutput', 'Advanced OBS Output')}>
                      <Icon name="videocam" size={16} />
                      <span>{t('page.advancedObsOutput', 'Advanced OBS Output')}</span>
                      <Icon name={showProjectionSettings ? "expand_less" : "expand_more"} size={14} />
                    </button>
                    {showProjectionSettings && (
                      <div className="dock-sidebar__subpanel">
                        {/* Scene Routing */}
                        <div className="dock-sidebar__section-label">{t('page.sceneRouting', 'Scene Routing')}</div>
                        <label className="dock-sidebar__select-field">
                          <span className="dock-sidebar__select-label">
                            <Icon name={projectionSettings.sceneMode === "auto-duplicate" ? "visibility" : "visibility_off"} size={14} />
                            <span>{t('page.programBackground', 'Program background')}</span>
                          </span>
                          <select
                            className="dock-sidebar__select dock-sidebar__select--routing"
                            value={projectionSettings.sceneMode}
                            onChange={(event) => updateProjectionSceneMode(event.target.value as ProjectionSettings["sceneMode"])}
                            aria-label={t('page.programBackground', 'Program background')}
                          >
                            <option value="no-clone">{t('page.off', 'Off')}</option>
                            <option value="auto-duplicate">{t('page.on', 'On')}</option>
                          </select>
                        </label>
                        <div className="dock-sidebar__hint">
                          {projectionSettings.sceneMode === "auto-duplicate"
                            ? t('page.programBackgroundOnDesc', 'Put the current Program scene under MCE Presentation immediately.')
                            : t('page.programBackgroundOffDesc', 'Do not place the Program scene inside MCE Presentation.')}
                        </div>

                        <div className="dock-sidebar__section-label dock-sidebar__section-label--spaced">{t('page.sendBehavior', 'Send Behavior')}</div>

                        <label className="dock-sidebar__check dock-sidebar__check--stacked">
                          <input
                            type="checkbox"
                            checked={projectionSettings.restoreOriginalScene}
                            onChange={(e) => updateProjectionSettings({ restoreOriginalScene: e.target.checked })}
                          />
                          <span className="dock-sidebar__check-copy">
                            <span>{t('page.returnToPreviousScene', 'Return to previous Program scene after clear')}</span>
                            <small>{t('page.returnToPreviousSceneDesc', 'When MCE clears its overlay, OBS goes back to the scene that was live before.')}</small>
                          </span>
                        </label>

                        <div className="dock-sidebar__section-label dock-sidebar__section-label--spaced">
                          {t('page.sourceVisibility', 'MCE Presentation source visibility')}
                        </div>
                        <label className="dock-sidebar__select-field">
                          <span className="dock-sidebar__select-label">
                            <Icon name={projectionSettings.presentationSourceVisibility === "active-only" ? "visibility_off" : "visibility"} size={14} />
                            <span>{t('page.presentationSourceVisibility', 'MCE Presentation content')}</span>
                          </span>
                          <select
                            className="dock-sidebar__select"
                            value={projectionSettings.presentationSourceVisibility}
                            onChange={(event) => {
                              updateProjectionSettings({
                                presentationSourceVisibility: event.target.value as ProjectionSettings["presentationSourceVisibility"],
                              });
                              void dockObsClient.reconcileMcePresentationVisibility().catch(() => {});
                            }}
                            aria-label={t('page.presentationSourceVisibility', 'MCE Presentation content')}
                          >
                            <option value="active-only">{t('page.showActiveOnly', 'Show only active MCE content')}</option>
                            <option value="keep-visible">{t('page.keepOtherSourcesVisible', 'Keep all MCE content visible')}</option>
                          </select>
                        </label>
                        <div className="dock-sidebar__hint">
                          {t('page.sourceVisibilityDesc', 'When Bible, Worship, Notes, Media, Ticker, or Countdown is pushed, hide every other MCE-created content source in MCE Presentation. Your own OBS sources are untouched.')}
                        </div>

                        <label className="dock-sidebar__select-field">
                          <span className="dock-sidebar__select-label">
                            <Icon name={projectionSettings.preserveAudioOnSourceSwitch ? "volume_up" : "volume_off"} size={14} />
                            <span>{t('page.presentationAudioVisibility', 'Presentation audio playback')}</span>
                          </span>
                          <select
                            className="dock-sidebar__select"
                            value={projectionSettings.preserveAudioOnSourceSwitch ? "keep-playing" : "mute"}
                            onChange={(event) => {
                              updateProjectionSettings({
                                preserveAudioOnSourceSwitch: event.target.value === "keep-playing",
                              });
                              void dockObsClient.reconcileMcePresentationVisibility().catch(() => {});
                            }}
                            aria-label={t('page.presentationAudioVisibility', 'Presentation audio playback')}
                          >
                            <option value="keep-playing">{t('page.keepAudioPlaying', 'Keep audio playing (Recommended)')}</option>
                            <option value="mute">{t('page.muteAudioWithSources', 'Mute/hide audio with other sources')}</option>
                          </select>
                        </label>
                        <div className="dock-sidebar__hint">
                          {t('page.presentationAudioVisibilityDesc', 'When Bible, Worship, or Notes is pushed, keep background music and audio tracks playing in OBS.')}
                        </div>

                        <label className="dock-sidebar__check dock-sidebar__check--stacked">
                          <input
                            type="checkbox"
                            checked={projectionSettings.lowerThirdSourceVisibility === "active-only"}
                            onChange={(event) => {
                              updateProjectionSettings({
                                lowerThirdSourceVisibility: event.target.checked ? "active-only" : "overlay",
                              });
                              void dockObsClient.reconcileMcePresentationVisibility().catch(() => {});
                            }}
                          />
                          <span className="dock-sidebar__check-copy">
                            <span>{t('page.lowerThirdHideOthers', 'Hide slides and verses while a lower third is showing')}</span>
                            <small>{t('page.lowerThirdHideOthersDesc', 'Off (recommended): a lower third appears on top of whatever is already on screen. On: only the lower third shows. OBS sources you created yourself are never changed.')}</small>
                          </span>
                        </label>
                      </div>
                    )}
                  </>
                )}

                <div className="dock-sidebar__divider" />

                {/* History */}
                <button
                  type="button"
                  className="dock-sidebar__item"
                  onClick={() => {
                    setShowHistory(true);
                    setShowSettingsMenu(false);
                  }}
                  title={t('dock.history')}>
                  <Icon name="history" size={16} />
                  <span>{t('dock.history')}</span>
                </button>

                {!presentationLinkMode && (
                  <>
                    <div className="dock-sidebar__divider" />

                    {/* Broadcast & Stream Destinations */}
                    <button
                      type="button"
                      className="dock-sidebar__item"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        setActiveTab("broadcast");
                        setRenderedTab("broadcast");
                      }}
                      title={t('page.shortcutTabBroadcast', 'Broadcast & Stream Destinations')}
                    >
                      <Icon name="cell_tower" size={16} />
                      <span>{t('page.shortcutTabBroadcast', 'Broadcast & Stream Destinations')}</span>
                    </button>

                    <div className="dock-sidebar__divider" />

                    {/* OBS Connection */}
                    <button
                      type="button"
                      className="dock-sidebar__item"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        setShowReconnectModal(true);
                      }}
                      title={t('page.connection')}>
                      <Icon name="link" size={16} />
                      <span>{obsConnected ? t('dock.reconnectToObs') : t('dock.connectToObs')}</span>
                    </button>

                    <div className="dock-sidebar__divider" />

                    {/* Clear All MCE Scenes */}
                    <button
                      type="button"
                      className="dock-sidebar__item"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        setShowClearScenesConfirm(true);
                      }}
                      style={{ color: "var(--dock-red, #EF4444)" }}
                      title={t('page.clearAllScenes')}>
                      <Icon name="delete_sweep" size={16} />
                      <span>{t('page.clearAllScenes')}</span>
                    </button>
                  </>
                )}

                {/* Session sections — keep this at the end of the menu after the destructive OBS action. */}
                <div className="dock-sidebar__section-label dock-sidebar__section-label--spaced">
                  {t('page.sessionSections', 'Session sections')}
                </div>
                <div className="dock-session-transfer">
                  <div className="dock-session-transfer__copy">
                    <span className="dock-session-transfer__title">
                      <Icon name="folder_zip" size={13} />
                      <span>{t('page.dockSession', 'Dock Session')}</span>
                    </span>
                    <span className="dock-session-transfer__desc">
                      {t('page.dockSessionDesc', 'Move Bible, lyrics, notes, Studio, Ministry, Multi-View, appearance and your pictures and videos in one file.')}
                    </span>
                  </div>
                  <div className="dock-session-transfer__actions">
                    <button
                      type="button"
                      className="dock-btn dock-btn--preview dock-btn--sm"
                      onClick={() => { void handleDockSessionExport(); }}
                      disabled={dockSessionTransferBusy}
                      title={t('page.exportDockSession', 'Export Dock session')}
                    >
                      <Icon name={dockSessionTransferBusy ? "sync" : "download"} size={13} className={dockSessionTransferBusy ? "dock-spin" : undefined} />
                      {t('common.export', 'Export')}
                    </button>
                    <button
                      type="button"
                      className="dock-btn dock-btn--primary dock-btn--sm"
                      onClick={() => dockSessionImportInputRef.current?.click()}
                      disabled={dockSessionTransferBusy}
                      title={t('page.importDockSession', 'Import Dock session')}
                    >
                      <Icon name={dockSessionTransferBusy ? "sync" : "upload_file"} size={13} className={dockSessionTransferBusy ? "dock-spin" : undefined} />
                      {t('common.import', 'Import')}
                    </button>
                  </div>
                  <label className="dock-session-transfer__hint" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={dockSessionMerge} onChange={(e) => setDockSessionMerge(e.target.checked)} />
                    {t('page.dockSessionMerge', 'Keep what I already have (only add what is missing)')}
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Clear All MCE Scenes Confirmation ── */}
        {!presentationLinkMode && showClearScenesConfirm && (
          <div className="dock-dialog-backdrop" onClick={() => { if (!clearScenesLoading) setShowClearScenesConfirm(false); }}>
            <div className="dock-dialog dock-dialog--compact" onClick={(e) => e.stopPropagation()}>
              <div className="dock-dialog__header">
                <div>
                  <div className="dock-dialog__eyebrow" style={{ color: "var(--dock-red, #EF4444)" }}>{t('page.dangerZone')}</div>
                  <h2 className="dock-dialog__title">{t('page.clearAllScenesConfirm')}</h2>
                </div>
                <button
                  type="button"
                  className="dock-dialog__close"
                  onClick={() => { if (!clearScenesLoading) setShowClearScenesConfirm(false); }}
                  aria-label={t('common.close')}
                  title={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="dock-dialog__body">
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  {t('dock.clearAllScenesWarning')}
                </p>
                <ul style={{ margin: "8px 0", paddingLeft: 20, fontSize: 12, lineHeight: 1.6, color: "var(--dock-text-secondary, #94A3B8)" }}>
                  <li>{t('page.mceScenes')}</li>
                  <li>{t('page.mcePreService')}</li>
                  <li>{t('page.mvLayouts')}</li>
                  <li>{t('page.mceSources')}</li>
                </ul>
                <p style={{ margin: 0, fontSize: 11, color: "var(--dock-text-dim, #64748B)", lineHeight: 1.4 }}>
                  {t('dock.clearAllScenesOwnScenes')}
                </p>
              </div>
              <div className="dock-dialog__actions">
                <button
                  type="button"
                  className="dock-btn dock-btn--sm"
                  disabled={clearScenesLoading}
                  onClick={() => setShowClearScenesConfirm(false)}
                  title={t('page.clearAllScenesCancel')}>
                  {t('page.clearAllScenesCancel')}
                </button>
                <button
                  type="button"
                  className="dock-btn dock-btn--sm dock-btn--danger"
                  disabled={clearScenesLoading}
                  onClick={async () => {
                    if (!obsConnected) return;
                    setClearScenesLoading(true);
                    try {
                      const result = await dockObsClient.clearAllMCEScenes();
                      console.log(`[DockOBS] Cleared ${result.deletedScenes} scenes, cleaned ${result.cleanedSources} sources`);
                    } catch (err) {
                      console.error("[DockOBS] Failed to clear MCE scenes:", err);
                    } finally {
                      setClearScenesLoading(false);
                      setShowClearScenesConfirm(false);
                    }
                  }}
                  title={t('common.loading')}>
                  {clearScenesLoading ? t('common.loading') : t('page.clearAllScenesContinue')}
                </button>
              </div>
            </div>
          </div>
        )}

        {!presentationLinkMode && showReconnectModal && (
          <div className="dock-dialog-backdrop" onClick={() => setShowReconnectModal(false)}>
            <div className="dock-dialog dock-dialog--compact" onClick={(e) => e.stopPropagation()}>
              <div className="dock-dialog__header">
                <div>
                  <div className="dock-dialog__eyebrow">{t('page.connection')}</div>
                  <h2 className="dock-dialog__title">{t('page.obsWebSocket')}</h2>
                </div>
                <button
                  type="button"
                  className="dock-dialog__close"
                  onClick={() => setShowReconnectModal(false)}
                  aria-label={t('common.close')}
                  title={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="dock-dialog__body">
                {obsError && (
                  <div className="dock-error-msg">
                    <Icon name="error" size={14} />
                    {obsError}
                  </div>
                )}
                <div className="dock-settings-form">
                  <input
                    className="dock-input"
                    placeholder="ws://localhost:4455"
                    value={obsUrlInput}
                    onChange={(event) => setObsUrlInput(event.target.value)}
                  />
                  <input
                    className="dock-input"
                    type="password"
                    placeholder={t('dock.passwordOptional')}
                    value={obsPwInput}
                    onChange={(event) => setObsPwInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="dock-btn dock-btn--preview dock-btn--block"
                    onClick={() => {
                      void handleManualConnect();
                      setShowReconnectModal(false);
                    }}
                    title={t('dock.reconnectToObs')}>
                    <Icon name="link" size={16} />
                    {obsConnected ? t('page.reconnect') : t('page.connection')}
                  </button>
                </div>
                <div className="dock-settings-panel__hint">
                  {t('page.makeSureEnabled')}
                </div>
              </div>
            </div>
          </div>
        )}



        <main id="dock-main-content" tabIndex={-1} className="dock-content">
          {isFreePlan && presentationLinkMode && !hidePresentationLinkCard && (
            <DockPresentationLinkCard onOpenHelp={() => setShowPresentationLinkModal(true)} />
          )}
          {isVmixTarget(presentationOutputTarget) && !hidePresentationLinkCard && <DockVmixCard />}
          <div className="dock-content-layout" style={{ display: "flex", flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>
            <DockScheduleDrawer
              initialSnapshot={servicePlanner}
              onStage={handleStage}
              onSelectTab={(tab) => {
                setActiveTab(tab);
                setRenderedTab(tab);
              }}
            />
            {/* ═══ VERTICAL NAV (between schedule & content when dock is short) ═══ */}
            {verticalTabs && (
              <nav className="dock-vertical-nav" aria-label={t('page.dockSections')}>
                {navigableDockTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`dock-vertical-nav__item${activeTab === tab.id ? " dock-vertical-nav__item--active" : ""}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setRenderedTab(tab.id);
                    }}
                    onPointerEnter={() => preloadDockTab(tab.id)}
                    onPointerDown={() => preloadDockTab(tab.id)}
                    onFocus={() => preloadDockTab(tab.id)}
                    aria-label={tab.label}
                    title={tab.label}
                    data-label={tab.label}
                  >
                    <Icon name={tab.icon} size={16} />
                  </button>
                ))}
              </nav>
            )}
            <div className="dock-content-main">
              <div className="dock-content-panels">
                <Suspense fallback={<LoadingScreen variant="dock" label={t('common.loading', 'Loading…')} className="dock-tab-loading" />}>
              {mountedDockTabs.has("planner") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "planner"}>
                  <DockPlannerTab
                    staged={staged}
                    onStage={handleStage}
                    initialSnapshot={servicePlanner}
                  />
                </div>
              )}
              {mountedDockTabs.has("bible") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "bible"}>
                  {presentationBibleLmSplit ? (
                    <div className="dock-presentation-bible-lm-split">
                      <section className="dock-presentation-bible-lm-pane" aria-label="Bible dock">
                        <div className="dock-presentation-bible-lm-pane__title">Bible</div>
                        <DockBibleTab
                          staged={staged}
                          onStage={handleStage}
                          productionDefaults={productionSettings.bible}
                          appConnected={appConnected}
                          presentationOutputTarget={presentationOutputTarget}
                          searchPlacement={searchPlacement}
                          onSaveFeedback={showDockSaveFeedback}
                          showHistory={showHistory}
                          onHistoryClose={handleHistoryClose}
                          onToggleMenu={() => setShowSettingsMenu((prev) => !prev)}
                        />
                      </section>
                      <section className="dock-presentation-bible-lm-pane" aria-label="Scripture assistant dock">
                        <div className="dock-presentation-bible-lm-pane__title">Scripture Assistant</div>
                        <DockLmTab
                          presentationOutputTarget={presentationOutputTarget}
                          enablePresentationMicControls={enablePresentationAssistantMicControls}
                          onNavigateToBible={handleNavigateToBible}
                        />
                      </section>
                    </div>
                  ) : (
                    <DockBibleTab
                      staged={staged}
                      onStage={handleStage}
                      productionDefaults={productionSettings.bible}
                      appConnected={appConnected}
                      presentationOutputTarget={presentationOutputTarget}
                      searchPlacement={searchPlacement}
                      onSaveFeedback={showDockSaveFeedback}
                      fullscreenOnly={hideLowerThirdControls}
                      showHistory={showHistory}
                      onHistoryClose={handleHistoryClose}
                      onToggleMenu={() => setShowSettingsMenu((prev) => !prev)}
                    />
                  )}
                </div>
              )}
              {mountedDockTabs.has("worship") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "worship"}>
                  <DockWorshipTab
                    staged={staged}
                    onStage={handleStage}
                    productionDefaults={productionSettings.worship}
                    notesProductionDefaults={productionSettings.notes}
                    presentationOutputTarget={presentationOutputTarget}
                    searchPlacement={searchPlacement}
                    fullscreenOnly={hideLowerThirdControls}
                    showSubtabs
                    compactVerticalNav={verticalTabs}
                    initialSubTab={shellPreferences.activeTab === "notes" ? "notes" : undefined}
                    isActive={renderedTab === "worship"}
                  />
                </div>
              )}
              {mountedDockTabs.has("media") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "media"}>
                  <DockMediaTab
                    staged={staged}
                    onStage={handleStage}
                    presentationOutputTarget={presentationOutputTarget}
                  />
                </div>
              )}
              {mountedDockTabs.has("multiview") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "multiview"}>
                  <DockMultiviewTab isActive={renderedTab === "multiview"} />
                </div>
              )}
              {mountedDockTabs.has("ministry") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "ministry"}>
                  <DockMinistryTab
                    staged={staged}
                    onStage={handleStage}
                    presentationOutputTarget={presentationOutputTarget}
                    hideTickerControls={hideTickerControls}
                    hideLowerThirdControls={hideLowerThirdControls}
                  />
                </div>
              )}
              {mountedDockTabs.has("broadcast") && (
                <div className="dock-tab-panel" hidden={renderedTab !== "broadcast"}>
                  <DockBroadcastTab />
                </div>
              )}
              </Suspense>
              </div>

              {/* ═══ HORIZONTAL TAB NAVIGATION (bottom of main dock, hidden when vertical) ═══ */}
              {!verticalTabs && (
                <nav className="dock-bottom-nav" aria-label={t('page.dockSections')}>
                  {bottomDockTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`dock-bottom-nav__item${activeTab === tab.id ? " dock-bottom-nav__item--active" : ""}`}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setRenderedTab(tab.id);
                      }}
                      onPointerEnter={() => preloadDockTab(tab.id)}
                      onPointerDown={() => preloadDockTab(tab.id)}
                      onFocus={() => preloadDockTab(tab.id)}
                      aria-label={tab.label}
                      title={tab.label}
                      data-label={tab.label}
                      data-summary={tab.summary}
                    >
                      <Icon name={tab.icon} size={14} className="dock-bottom-nav__icon" />
                      <span className="dock-bottom-nav__label-short">{getCompactDockTabLabel(tab.id, t)}</span>
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Keyboard shortcut toast feedback */}
      {toasts.length > 0 && (
        <div className="dock-shortcut-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className="dock-shortcut-toast">
              {toast.label}
            </div>
          ))}
        </div>
      )}

      {/* Keyboard shortcuts help overlay */}
      {showShortcutsHelp && (
        <div
          className="dock-shortcuts-overlay"
          onClick={() => setShowShortcutsHelp(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dock-shortcuts-title"
        >
          <div className="dock-shortcuts-overlay__content" onClick={(e) => e.stopPropagation()}>
            <div className="dock-shortcuts-overlay__header">
              <div>
                <div className="dock-shortcuts-overlay__eyebrow">{t('dock.dockLabel')}</div>
                <div id="dock-shortcuts-title" className="dock-shortcuts-overlay__title">{t('page.keyboardShortcuts')}</div>
              </div>
              <button
                type="button"
                className="dock-shortcuts-overlay__close"
                onClick={() => setShowShortcutsHelp(false)}
                aria-label={t('common.close')}
                title={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="dock-shortcuts-overlay__body">
              <div className="dock-shortcuts-section">
                <div className="dock-shortcuts-section__label">{t('dock.navigation')}</div>
                <div className="dock-shortcuts-list">
                  {DOCK_TAB_SHORTCUTS
                    .filter(({ tab }) => navigableDockTabs.some((candidate) => candidate.id === tab))
                    .map((s) => (
                    <div key={s.key} className="dock-shortcuts-item">
                      <span className="dock-shortcuts-item__key">{formatShortcut(s.key, "primary")}</span>
                      <span className="dock-shortcuts-item__label">{t(s.labelKey)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dock-shortcuts-section">
                <div className="dock-shortcuts-section__label">{t('dock.utility')}</div>
                <div className="dock-shortcuts-list">
                  {[
                    { key: "k", label: t('page.shortcutCommandPalette') },
                    { key: "t", label: t('dock.toggleTheme') },
                    { key: "s", label: t('dock.toggleSettings') },
                    { key: "/", label: t('page.shortcutsHelp') },
                  ].map((s) => (
                    <div key={s.key} className="dock-shortcuts-item">
                      <span className="dock-shortcuts-item__key">{formatShortcut(s.key)}</span>
                      <span className="dock-shortcuts-item__label">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dock-shortcuts-overlay__footer">
              {t('dock.shortcutsFooterPrefix')} <kbd>{t('page.shortcutAlt')}</kbd> + <kbd>{t('page.shortcutShift')}</kbd> + <kbd>/</kbd> {t('dock.shortcutsFooterSuffix')}
            </div>
          </div>
        </div>
      )}

      {/* ── Command Palette ── */}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <DockBibleCommandPaletteHost
            open={showCommandPalette}
            initialQuery={commandPaletteInitialQuery}
            onClose={() => setShowCommandPalette(false)}
            onSelectBibleVerse={handleCommandPaletteSelectBibleVerse}
            onSelectTemplate={handleCommandPaletteSelectTemplate}
          />
        </Suspense>
      )}

      {/* ── Global drag-and-drop overlay ── */}
      <DockDropOverlay visible={isDragging} />

      {/* ── Upload toasts ── */}
      <DockUploadToasts
        toasts={uploadToasts}
        uploading={uploading}
        progress={uploadProgress}
        onDismiss={dismissToast}
      />

      {dockSaveFeedback && (
        <div className="dock-feedback-toast-stack" aria-live="polite" aria-atomic="true">
          <div key={dockSaveFeedback.id} className="dock-feedback-toast" role="status">
            <Icon name="check_circle" size={13} />
            <span>{dockSaveFeedback.message}</span>
          </div>
        </div>
      )}

      {dockSessionFeedback && (
        <div className="dock-feedback-toast-stack" aria-live="polite" aria-atomic="true">
          <div
            key={dockSessionFeedback.id}
            className={`dock-feedback-toast${dockSessionFeedback.tone === "error" ? " dock-feedback-toast--error" : ""}`}
            role={dockSessionFeedback.tone === "error" ? "alert" : "status"}
          >
            <Icon name={dockSessionFeedback.tone === "error" ? "error" : "check_circle"} size={13} />
            <span>{dockSessionFeedback.message}</span>
          </div>
        </div>
      )}

      {/* ── Entitlement upgrade modal ── */}
      <DockUpgradeModal
        open={Boolean(upgradeModalMsg)}
        onClose={() => {
          setUpgradeModalMsg("");
        }}
        message={upgradeModalMsg}
      />

      {/* ── Free Plan OBS Setup modal ── */}
      <DockPresentationLinkModal
        open={showPresentationLinkModal}
        onClose={() => setShowPresentationLinkModal(false)}
      />

      {/* ── Schedule & History Intro / Guide modal (Root Level) ── */}
      <DockScheduleIntroModal />

      {/* ── Language change confirmation modal ── */}
      {showLanguageModal && pendingLanguage && (
        <div className="dock-modal-overlay" onClick={() => { setShowLanguageModal(false); setPendingLanguage(null); }}>
          <div className="dock-language-modal" role="dialog" aria-modal="true" aria-labelledby="dock-language-title" onClick={(e) => e.stopPropagation()}>
            <div className="dock-language-modal__icon-badge">
              <Globe size={24} />
            </div>
            <h3 id="dock-language-title" className="dock-language-modal__title">
              {t('dock.changeLanguage') || 'Change Language'}
            </h3>
            <p className="dock-language-modal__desc">
              {t('dock.changeLanguageConfirm', { language: pendingLanguage }) || `Change interface language to ${pendingLanguage}?`}
            </p>
            <div className="dock-language-modal__actions">
              <button
                type="button"
                className="dock-language-modal__btn dock-language-modal__btn--cancel"
                onClick={() => { setShowLanguageModal(false); setPendingLanguage(null); }}
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                className="dock-language-modal__btn dock-language-modal__btn--confirm"
                onClick={() => {
                  const lang = pendingLanguage!;
                  const langToCode: Record<string, string> = {
                    English: "en", French: "fr", Spanish: "es", Portuguese: "pt",
                    Yoruba: "yo", Igbo: "ig", Hausa: "ha", Ghanaian: "gh",
                  };
                  const code = langToCode[lang] || "en";
                  writeNativeDockSetting("mce_interface_language", lang);
                  i18n.changeLanguage(code);
                  dockBridge.sendLanguageChanged(code);
                  setInterfaceLanguage(lang);
                  setShowLanguageModal(false);
                  setPendingLanguage(null);
                }}
              >
                {t('dock.changeLanguage') || 'Change Language'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DockOutputTargetContext.Provider>
  );
}

/**
 * The Dock must hydrate the native settings database before mounting the
 * content component. Otherwise every useState initializer can briefly see a
 * default value and another component can act on that value during startup.
 */
export default function DockPage(props: DockPageProps = {}) {
  const [initialProductionSettings, setInitialProductionSettings] = useState<DockProductionSettingsPayload | null>(
    () => readFastDockProductionSettings(),
  );
  // Mount the Dock only after the saved settings database is loaded. Mounting
  // early (from the fast localStorage cache) let every saved preference — like
  // the last open tab — start from its default and then overwrite the saved value.
  const [settingsReady, setSettingsReady] = useState(() => isNativeDockSettingsHydrated());
  // Set when the Dock was opened with defaults because the saved settings were slow. When they
  // finally arrive the Dock is built again, so what was saved shows instead of the defaults.
  const openedBeforeSettingsRef = useRef(false);
  const [settingsEpoch, setSettingsEpoch] = useState(0);

  useEffect(() => {
    if (settingsReady || !initialProductionSettings) return;
    // Safety valve: never leave the operator on a loading screen if the local
    // settings service is slow; the Dock then opens without saved shell prefs.
    const timer = window.setTimeout(() => {
      if (!isNativeDockSettingsHydrated()) openedBeforeSettingsRef.current = true;
      setSettingsReady(true);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [settingsReady, initialProductionSettings]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    const hydrate = async () => {
      try {
        await hydrateNativeDockSettings();
        if (!cancelled && openedBeforeSettingsRef.current) {
          openedBeforeSettingsRef.current = false;
          setSettingsEpoch((value) => value + 1);
        }
        // The saved preferences are loaded; with a cached production snapshot the
        // Dock can open now instead of waiting for the full settings load.
        if (!cancelled && initialProductionSettings) setSettingsReady(true);
        const productionSettings = await loadDockProductionSettings();
        if (!cancelled) {
          setInitialProductionSettings(productionSettings);
          setSettingsReady(true);
        }
      } catch (error) {
        console.warn("[Dock] Waiting for the local settings database:", error);
        if (!cancelled && !initialProductionSettings) {
          retryTimer = window.setTimeout(() => {
            void hydrate();
          }, 500);
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  const effectiveSettings = settingsReady ? (initialProductionSettings ?? getDefaultDockProductionSettings()) : null;

  if (!effectiveSettings) {
    return (
      <LoadingScreen
        variant="dock"
        label="Loading saved Dock settings…"
        className="dock-tab-loading"
      />
    );
  }

  // The equivalent `return <DockPageContent {...props} />` is intentionally
  // held until the persisted startup snapshot is ready.
  return <DockPageContent key={settingsEpoch} {...props} initialProductionSettings={effectiveSettings} />;
}
