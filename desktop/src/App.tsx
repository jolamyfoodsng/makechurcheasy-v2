/**
 * App.tsx — MakeChurchEazy
 *
 * Root component with React Router.
 *
 * Startup sequence:
 *   1. Splash screen shown (environment-specific onboarding splash)
 *   2. Resources pre-loaded + GitHub update check runs in parallel
 *   3. If update available → centered optional-update dialog
 *   4. App continues polling for updates while running
 *   5. Main app is always accessible — updates never block workflow
 */

import { Suspense, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAdminControls } from "./hooks/useAdminControls";
import { DOCK_ADMIN_CONTROLS_FILE } from "./dock/dockAdminControls";
import { ADMIN_FEATURE_OFF_MESSAGES } from "./services/desktopConfig";
import { SettingsOverlayContext } from "./components/SettingsModalSlot";
import { Routes, Route, Navigate, useParams, useNavigate, useLocation, type Location } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { OBSConnectGate } from "./components/OBSConnectGate";
import { isOnboardingCompleted } from "./services/workspacePreference";
import AuthGate from "./components/AuthGate";
import LicenseGuard from "./components/LicenseGuard";
import FeatureGuard from "./components/FeatureGuard";
import { useAuth } from "./contexts/AuthContext";
import { initLicenseGuard, reverifyOnAuth, useLicenseGuardState } from "./services/licenseGuard";
import { AppShell } from "./AppShell";
import { LowerThirdProvider } from "./lowerthirds/lowerThirdStore";
import SplashScreen from "./components/SplashScreen";
import LoadingScreen from "./components/LoadingScreen";
import UpdateNotification from "./components/UpdateNotification";
import UpdateDownloadingBanner from "./components/UpdateDownloadingBanner";
import UpdateBackgroundNoticeModal from "./components/UpdateBackgroundNoticeModal";
import UpdateCloseAppWarningModal from "./components/UpdateCloseAppWarningModal";
import { updateDownloadManager } from "./services/updateDownloadManager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ForceUpdateModal from "./components/ForceUpdateModal";
import ForcedUpdateGate from "./components/ForcedUpdateGate";
import TrialModal, { hasTrialWelcomeBeenShown, markTrialWelcomeAsShown } from "./components/TrialModal";
import VerificationGate from "./components/VerificationGate";
import { getDeviceId } from "./services/authService";
import Icon from "./components/Icon";
import { checkForUpdate, getVersionAge, type UpdateCheckResult } from "./services/updateService";
import {
  fetchAppSettings,
  getForcedUpdateState,
  publishForcedUpdateState,
  refreshAppSettings,
  type ForcedUpdateState,
} from "./services/forcedUpdateService";
import { getOverlayBaseUrl, initOverlayUrl } from "./services/overlayUrl";
import { migrateFromLegacyDatabases } from "./services/db";
import { getSettings, MV_SETTINGS_UPDATED_EVENT, seedTemplates, syncLayoutsToDock, type MVSettings as MVSettingsType } from "./multiview/mvStore";
import { STARTER_TEMPLATES } from "./multiview/templates";
import { applyBrandingSettingsToDom } from "./services/branding";
import { useAppTheme } from "./hooks/useAppTheme";
import { getAppTitle, getSplashImageSrc } from "./services/envConfig";
import { getPresentationRemoteAccessInfo } from "./services/presentationRemote";

import { dockBridge } from "./services/dockBridge";
import { initDockCommandHandler } from "./services/dockCommandHandler";
import { initMobileRemoteCommandBridge } from "./services/mobileRemoteCommandBridge";
import { automationRunner } from "./services/automationRunner";
import { hasTauriInvoke, safeTauriInvoke } from "./services/tauriSafe";
import { getUserScopedKey } from "./services/userScopedStorage";
import { obsService } from "./services/obsService";
import { appStatusManager } from "./services/appStatusManager";
import { serviceStore as svcStore } from "./services/serviceStore";
import { getAllSongs, getSong, saveSong, syncSongsToDock } from "./worship/worshipDb";
import { generateSlides } from "./worship/slideEngine";
import { DEFAULT_WORSHIP_LINES_PER_SLIDE } from "./worship/slideLayout";
import { checkEntitlementSync } from "./services/entitlementClient";
import { getEffectivePlan } from "./services/licenseService";
import type { Song } from "./worship/types";
import type { MediaItem } from "./library/libraryTypes";
import { deleteMedia, deleteUploadedMediaFile, getAllMedia, saveMedia } from "./library/libraryDb";
import { syncCustomThemesToDock, syncInstalledTranslationsToDock } from "./bible/bibleDb";
import CreditsGuard from "./components/CreditsGuard";
import { AnnouncementModalHost } from "./components/AnnouncementModalHost";
import { VoiceAiInactivityModal } from "./components/VoiceAiInactivityModal";
import {
  getServicePlannerSnapshot,
  importDockServicePlansFromUploads,
  saveServicePlan,
  syncServicePlansToDock,
} from "./service-planner/servicePlannerStore";
import type { ServicePlan } from "./service-planner/types";
import { buildDockProductionSettingsPayload, syncProductionSettingsToDock } from "./services/productionSettings";
import {
  loadWorshipDockSongSaveCommand,
  saveWorshipDockSongSaveResult,
  type WorshipDockSongSavePayload,
} from "./services/worshipDockInterop";
import { appendTextToDockNotes, loadDockNotes, syncDockNotesToDock } from "./dock/dockNotesStorage";
import type { DockNotesAppendCommand } from "./services/dockNotesInterop";
import { getLiveToolsSnapshot, syncLiveToolsToDock } from "./live-tools/liveToolStore";
import { getCountdownSnapshot } from "./countdowns/countdownStore";
import { STORES, putRecord } from "./services/db";
import { getPendingReceiverFiles, type ReceiverFile } from "./services/receiverService";
import {
  trackAppStarted,
  trackAppClosed,
  trackObsConnected,
  trackObsDisconnected,
} from "./services/analytics";
import {
  trackAppStarted as trackAppStartedBackend,
  trackAppClosed as trackAppClosedBackend,
  trackObsConnected as trackObsConnectedBackend,
} from "./services/tracking";
import "./multiview/mv.css";
import "./bible/bible.css";
import "./lowerthirds/lowerthirds.css";
import "./App.css";
import "./NewDashboard.css";
import "./accessibility.css";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { safeLazy } from "./utils/safeLazy";
import { getRecommendedPollingInterval } from "./services/performanceManager";

// The startup check covers launch; afterwards a light background check is
// enough (each check hits GitHub twice).
const UPDATE_POLL_INTERVAL_MS = 20 * 60_000;
const WORSHIP_DOCK_SAVE_POLL_INTERVAL_MS = 500;
const DOCK_WORSHIP_PREFS_APP_KEY = "dock-worship-preferences";

// Keep large route trees and their optional dependencies out of the startup
// graph. The first screen stays small; a page pays its loading cost only when
// the operator opens that page.
const MVSettings = safeLazy(() => import("./multiview/pages/MVSettings").then(({ MVSettings: Component }) => ({ default: Component })));
const MVShell = safeLazy(() => import("./multiview/MVShell").then(({ MVShell: Component }) => ({ default: Component })));
const DevDashboard = safeLazy(() => import("./pages/DevDashboard"));
const DevModalsGalleryPage = import.meta.env.DEV
  ? safeLazy(() => import("./pages/DevModalsGalleryPage"))
  : null;
const ResourcesPage = safeLazy(() => import("./pages/ResourcesPage"));
const ProductionHomePage = safeLazy(() => import("./pages/ProductionHomePage"));
const MultiViewGalleryPage = safeLazy(() => import("./pages/MultiViewGalleryPage"));
const CountdownsPage = safeLazy(() => import("./pages/CountdownsPage"));
const ProductionThemeSettingsPage = safeLazy(() => import("./pages/ProductionThemeSettingsPage"));
const BroadcastGraphicsPage = safeLazy(() => import("./pages/BroadcastGraphicsPage"));
const OnboardingPage = safeLazy(() => import("./pages/OnboardingPage"));
const ServicePlannerPage = safeLazy(() => import("./pages/ServicePlannerPage"));
const SpeechToScripturePage = safeLazy(() => import("./pages/SpeechToScripturePage"));
const TranscriptLibraryPage = safeLazy(() => import("./pages/TranscriptLibraryPage"));
const TranscriptDetailPage = safeLazy(() => import("./pages/TranscriptDetailPage"));
const CreditsPage = safeLazy(() => import("./pages/CreditsPage"));
const TutorialsPage = safeLazy(() => import("./pages/TutorialsPage"));
const TemplatesPage = safeLazy(() => import("./pages/TemplatesPage"));
const DesignStudioPage = safeLazy(() => import("./pages/DesignStudioPage"));
const BroadcastPage = safeLazy(() => import("./pages/BroadcastPage"));
const StudioPage = safeLazy(() => import("./pages/StudioPage"));
const StudioWelcomeModal = safeLazy(() => import("./pages/StudioWelcomeModal"));

type LmDockService = typeof import("./services/lmDockService").lmDockService;
let lmDockServicePromise: Promise<LmDockService> | null = null;

function loadLmDockService(): Promise<LmDockService> {
  lmDockServicePromise ??= import("./services/lmDockService").then(({ lmDockService }) => lmDockService);
  return lmDockServicePromise;
}

/**
 * The app's routes, with Settings drawn as a dialog over the page you were on.
 * On /settings the routes keep showing the last other page behind the dialog;
 * the app shell draws the dialog itself (SettingsModalSlot) inside its providers.
 */
function SettingsOverlayRoutes({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSettings = location.pathname === "/settings";
  const behindRef = useRef<Location>({ pathname: "/", search: "", hash: "", state: null, key: "default" });
  if (!isSettings) behindRef.current = location;
  const closeSettings = useCallback(() => {
    const behind = behindRef.current;
    navigate(`${behind.pathname}${behind.search}${behind.hash}`);
  }, [navigate]);
  return (
    <SettingsOverlayContext.Provider value={{ open: isSettings, close: closeSettings }}>
      <Routes location={isSettings ? behindRef.current : location}>{children}</Routes>
    </SettingsOverlayContext.Provider>
  );
}

function AppRouteFallback() {
  return (
    <LoadingScreen
      variant="page"
      label="Loading MakeChurchEazy…"
      className="app-route-loading"
    />
  );
}



async function saveWorshipSongFromDockPayload(payload: WorshipDockSongSavePayload): Promise<{
  song: Song;
  songs: Song[];
}> {
  if (payload.batch) {
    const { saveWorshipDocumentBatch } = await import("./worship/saveWorshipDocumentBatch");
    return saveWorshipDocumentBatch(payload.batch);
  }
  const id = payload.id?.trim();
  const title = payload.title?.trim();
  const lyrics = payload.lyrics?.trim();
  if (!id || !title || !lyrics) {
    throw new Error("Song title and lyrics are required.");
  }

  const existing = await getSong(id);
  const now = new Date().toISOString();
  const autoSplit = payload.autoSplit ?? existing?.autoSplit ?? true;
  const linesPerSlide = payload.linesPerSlide
    ?? existing?.linesPerSlide
    ?? DEFAULT_WORSHIP_LINES_PER_SLIDE;
  const themeId = payload.themeId ?? existing?.themeId;
  const song: Song = {
    id,
    metadata: {
      ...existing?.metadata,
      title,
      artist: payload.artist?.trim() ?? "",
    },
    lyrics,
    slides: generateSlides(lyrics, linesPerSlide, autoSplit, { continuousLineCount: autoSplit }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    importSourceName: payload.importSourceName ?? existing?.importSourceName,
    importSourceType: payload.importSourceType ?? existing?.importSourceType ?? "manual",
    importSourceUrl: payload.importSourceUrl ?? existing?.importSourceUrl,
    archived: existing?.archived,
    archivedAt: existing?.archivedAt,
    autoSplit,
    linesPerSlide,
    themeId,
  };

  await saveSong(song);
  const songs = await getAllSongs();
  return { song, songs };
}

// ── Transcript page wrappers (use router params/navigate) ────────────────────

function TranscriptLibraryPageWrapper() {
  const navigate = useNavigate();
  return (
    <TranscriptLibraryPage
      onOpenTranscript={(id) => navigate(`/transcripts/${id}`)}
      onNewSession={() => navigate("/speech-to-scripture")}
    />
  );
}

function TranscriptDetailPageWrapper() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return <Navigate to="/transcripts" replace />;
  return (
    <TranscriptDetailPage
      transcriptId={id}
      onBack={() => navigate("/transcripts")}
    />
  );
}

function PublicPresentationRoute() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function openPresentationViewer() {
      const cleanSessionId = sessionId.trim();
      if (!cleanSessionId) {
        setError("Presentation link is missing a session id.");
        return;
      }

      try {
        const info = await getPresentationRemoteAccessInfo(cleanSessionId);
        const candidates = [info.localLink, info.link].filter(Boolean);
        const currentUrl = new URL(window.location.href);
        const target = candidates.find((candidate) => {
          try {
            const parsed = new URL(candidate);
            return parsed.origin !== currentUrl.origin || parsed.pathname !== currentUrl.pathname;
          } catch {
            return false;
          }
        });

        if (cancelled) return;
        if (target) {
          window.location.replace(target);
          return;
        }

        const params = new URLSearchParams({ sessionId: cleanSessionId });
        if (info.wsPort > 0) params.set("wsPort", String(info.wsPort));
        window.location.replace(`/presentation.html?${params.toString()}`);
      } catch (routeError) {
        if (!cancelled) {
          setError(routeError instanceof Error ? routeError.message : "Could not open the presentation screen.");
        }
      }
    }

    void openPresentationViewer();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#000", color: "var(--text-primary)" }}>
      <div style={{ display: "grid", gap: 10, justifyItems: "center", fontFamily: "var(--font-body)" }}>
        <Icon name={error ? "warning" : "present_to_all"} size={28} />
        <span>{error || "Opening presentation screen..."}</span>
      </div>
    </div>
  );
}

function DesktopReceiverNotification() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [incomingFile, setIncomingFile] = useState<ReceiverFile | null>(null);
  const knownIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const files = await getPendingReceiverFiles();
        if (cancelled) return;
        const knownIds = knownIdsRef.current;
        if (knownIds) {
          const incoming = files.find((file) => !knownIds.has(file.pendingId));
          if (incoming) setIncomingFile(incoming);
        }
        knownIdsRef.current = new Set(files.map((file) => file.pendingId));
        setIncomingFile((current) => current && files.some((file) => file.pendingId === current.pendingId) ? current : null);
      } catch {
        // The receiver is optional while the desktop overlay server starts.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const receiverIsOpen = location.pathname === "/resources"
    && new URLSearchParams(location.search).get("tab") === "media"
    && new URLSearchParams(location.search).get("receiver") === "1";
  if (!incomingFile || receiverIsOpen) return null;

  return (
    <button
      type="button"
      className="app-receiver-notification"
      onClick={() => {
        setIncomingFile(null);
        navigate("/resources?tab=media&receiver=1");
      }}
      aria-label={t("library.receiver.openNotification")}
    >
      <span className="app-receiver-notification__icon"><Icon name="move_to_inbox" size={19} /></span>
      <span className="app-receiver-notification__copy">
        <strong>{t("library.receiver.notificationTitle")}</strong>
        <small>{incomingFile.fileName}</small>
      </span>
      <Icon name="chevron_right" size={17} />
    </button>
  );
}

function App() {
  // Re-read the workspace and onboarding flags after route changes. Onboarding
  // writes these values immediately before navigating into the selected app.
  useLocation();
  const { t } = useTranslation();
  // ── Global theme (dark/light) ──
  useAppTheme();
  const { user, setUser } = useAuth();
  const { lockReason: licenseLockReason } = useLicenseGuardState();
  const mceOnboardingDone = isOnboardingCompleted();
  const [globalMediaDragging, setGlobalMediaDragging] = useState(false);
  const [globalMediaUploading, setGlobalMediaUploading] = useState(false);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const dragCounterRef = useRef(0);
  const globalMediaInputRef = useRef<HTMLInputElement | null>(null);

  // Send the user's plan song limit to the dock so it can filter accordingly.
  // Use a ref so the callback always reads the latest user, avoiding stale
  // closures inside useEffect([], []) handlers.
  const userRef = useRef(user);
  userRef.current = user;

  // The desktop is the authority for local mobile access. Pairing tokens are
  // never enough on their own: the authenticated plan is pushed into the
  // companion server and checked again at the WebSocket handshake.
  const adminControls = useAdminControls();
  const mobileRemoteSwitchOn = adminControls.features.mobileRemote !== false;
  // The OBS Dock can't read the config cache, so give it the off switches as a file.
  useEffect(() => {
    void safeTauriInvoke("save_dock_data", {
      name: DOCK_ADMIN_CONTROLS_FILE,
      data: JSON.stringify({ features: adminControls.features }),
    }).catch(() => {
      // Dock keeps every feature on if the file can't be written.
    });
  }, [adminControls.features]);
  useEffect(() => {
    const effectivePlan = getEffectivePlan(user);
    const entitlement = checkEntitlementSync("mobileControl", effectivePlan);
    const allowed = entitlement.allowed && mobileRemoteSwitchOn;
    void safeTauriInvoke("set_mobile_access_policy", {
      allowed,
      plan: effectivePlan,
      reason: allowed
        ? undefined
        : !mobileRemoteSwitchOn
          ? ADMIN_FEATURE_OFF_MESSAGES.mobileRemote
          : `${entitlement.reason ?? "Mobile control is not available on this plan."} Open MakeChurchEazy on your desktop to upgrade.`,
    }).catch((error) => {
      console.warn("[MobileRemote] Could not sync access policy:", error);
    });
  }, [user, mobileRemoteSwitchOn]);

  useEffect(() => {
    automationRunner.start();
    return () => automationRunner.stop();
  }, []);

  // Intercept window close while update download is in progress or Verse AI is active
  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    let unlistenVerseAiClose: (() => void) | undefined;
    let unlistenUpdateClose: (() => void) | undefined;
    let isPrompting = false;

    const promptVerseAiCloseConfirmation = async () => {
      if (isPrompting) return;
      isPrompting = true;
      try {
        let confirmed = false;
        try {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          confirmed = await ask(
            "Verse AI is currently listening and transcribing. Are you sure you want to close MakeChurchEazy?",
            {
              title: "Verse AI is Active",
              kind: "warning",
              okLabel: "Close App",
              cancelLabel: "Cancel",
            }
          );
        } catch {
          confirmed = window.confirm(
            "Verse AI is currently listening and transcribing. Are you sure you want to close MakeChurchEazy?"
          );
        }

        if (confirmed) {
          // A downloaded update installs on the way out.
          await updateDownloadManager.installOnQuit().catch(() => false);
          // Clean up Verse AI audio capture and WebSocket stream
          try {
            const { lmDockService } = await import("./services/lmDockService");
            lmDockService.stopListening();
          } catch (err) {
            console.warn("[App] Error stopping Verse AI on exit:", err);
          }

          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("close_app_confirmed");
          } catch {
            try {
              const { exit } = await import("@tauri-apps/plugin-process");
              await exit(0);
            } catch {
              window.close();
            }
          }
        }
      } finally {
        isPrompting = false;
      }
    };

    const isVerseAiBusy = async (): Promise<boolean> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const streaming = await invoke<boolean>("is_assemblyai_streaming");
        if (streaming) return true;
      } catch {
        // Fallback to service status check
      }

      try {
        const { lmDockService } = await import("./services/lmDockService");
        const status = lmDockService.getSnapshot().status;
        return status === "requesting-mic" || status === "connecting" || status === "listening";
      } catch {
        return false;
      }
    };

    const quitApp = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("close_app_confirmed");
      } catch {
        try {
          const { exit } = await import("@tauri-apps/plugin-process");
          await exit(0);
        } catch {
          window.close();
        }
      }
    };

    // Rust holds the window open while an update is downloading or waiting
    // to be installed, and asks us what to do.
    const handleUpdateCloseRequested = async () => {
      if (updateDownloadManager.isBusy()) {
        updateDownloadManager.showAppCloseWarning();
        return;
      }
      if (await isVerseAiBusy()) {
        void promptVerseAiCloseConfirmation();
        return;
      }
      if (updateDownloadManager.isReady()) {
        await updateDownloadManager.installOnQuit().catch(() => false);
      }
      await quitApp();
    };

    try {
      const currentWindow = getCurrentWindow();

      currentWindow
        .listen("update-close-requested", () => {
          void handleUpdateCloseRequested();
        })
        .then((fn) => {
          unlistenUpdateClose = fn;
        })
        .catch(() => undefined);

      // Listen for Rust backend close prevention event when Verse AI is streaming
      currentWindow
        .listen("verse-ai-close-requested", () => {
          void promptVerseAiCloseConfirmation();
        })
        .then((fn) => {
          unlistenVerseAiClose = fn;
        })
        .catch(() => undefined);

      currentWindow
        .onCloseRequested(async (event) => {
          if (updateDownloadManager.isBusy()) {
            event.preventDefault();
            updateDownloadManager.showAppCloseWarning();
            return;
          }

          const busy = await isVerseAiBusy();
          if (busy) {
            event.preventDefault();
            void promptVerseAiCloseConfirmation();
          }
        })
        .then((fn) => {
          unlistenClose = fn;
        })
        .catch(() => undefined);
    } catch {
      // Non-Tauri environment
    }

    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (updateDownloadManager.isBusy()) {
        e.preventDefault();
        e.returnValue = "";
        updateDownloadManager.showAppCloseWarning();
      }
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);

    return () => {
      unlistenClose?.();
      unlistenVerseAiClose?.();
      unlistenUpdateClose?.();
      window.removeEventListener("beforeunload", beforeUnloadHandler);
    };
  }, []);

  const sendSongLimitToDock = useCallback(() => {
    const effectivePlan = getEffectivePlan(userRef.current);
    const { limit: songLimit } = checkEntitlementSync("songs", effectivePlan);
    dockBridge.sendState({
      type: "state:song-limit",
      payload: songLimit,
      timestamp: Date.now(),
    });
    dockBridge.sendState({
      type: "state:plan-update",
      payload: { plan: effectivePlan },
      timestamp: Date.now(),
    });
    // Persist to localStorage so the dock JSON fallback can read it
    // even when BroadcastChannel is slow or unavailable.
    try {
      localStorage.setItem(getUserScopedKey("ocs-dock-song-limit"), String(songLimit));
      localStorage.setItem(getUserScopedKey("ocs-dock-plan"), effectivePlan);
    } catch { /* ignore */ }
  }, []);

  const sendNotesToDock = useCallback((notes = loadDockNotes()) => {
    dockBridge.sendState({
      type: "state:notes-updated",
      payload: { notes, snapshot: true },
      timestamp: Date.now(),
    });
    void syncDockNotesToDock(notes);
  }, []);

  // Write song limit to localStorage immediately when user changes,
  // so the dock always has the correct limit even before any
  // BroadcastChannel message is received.
  useEffect(() => {
    if (user) {
      const effectivePlan = getEffectivePlan(user);
      const { limit } = checkEntitlementSync("songs", effectivePlan);
      try {
        localStorage.setItem(getUserScopedKey("ocs-dock-song-limit"), String(limit));
        localStorage.setItem(getUserScopedKey("ocs-dock-plan"), effectivePlan);
      } catch { /* ignore */ }
      dockBridge.sendState({
        type: "state:plan-update",
        payload: { plan: effectivePlan },
        timestamp: Date.now(),
      });
      void getAllSongs()
        .then((allSongs) => {
          const { limit } = checkEntitlementSync("songs", effectivePlan);
          const songs = (limit > 0 && limit < 9999) ? allSongs.slice(0, limit) : allSongs;
          dockBridge.sendState({
            type: "state:songs-data",
            payload: songs,
            timestamp: Date.now(),
          });
        })
        .catch((err) => {
          console.warn("[App] Failed to send songs after auth update:", err);
        });
      sendNotesToDock();
      void syncSongsToDock().catch(() => { });
    }
  }, [sendNotesToDock, user]);

  useEffect(() => {
    const s = getSettings();
    applyBrandingSettingsToDom({ brandColor: s.brandColor, churchName: s.churchName });

    // Set document title based on environment
    document.title = getAppTitle();

    // Initialize dock bridge so the OBS Browser Dock can communicate
    dockBridge.init();

    // Wire up dock commands → OBS actions (bible:go-live, speaker:go-live, etc.)
    const unsubDockCmd = initDockCommandHandler();

    let unsubMobileRemote: (() => void) | null = null;
    void initMobileRemoteCommandBridge()
      .then((unsub) => {
        unsubMobileRemote = unsub;
      })
      .catch((error) => {
        console.warn("[MobileRemote] Command bridge unavailable:", error);
      });

    // Dynamic app icon — updates macOS dock icon based on OBS + speech state
    const unsubAppStatus = appStatusManager.init();

    // The LM service owns the speech engine and its large optional Bible
    // retrieval path. Keep it out of startup; initialize it only when the
    // speech page or an LM Dock command actually needs it.
    let lmService: LmDockService | null = null;
    let unsubLmDock: (() => void) | null = null;
    const ensureLmService = async (): Promise<LmDockService> => {
      if (!lmService) {
        lmService = await loadLmDockService();
        unsubLmDock = lmService.init();
      }
      return lmService;
    };

    // The Verse AI dock in OBS runs in its own browser process, so its Start /
    // Stop buttons reach the app only through the HTTP relay (/api/lm-command),
    // not BroadcastChannel. The LM service polls that relay once loaded, but it
    // loads lazily (Verse AI page). Until then, watch the relay here (cheap), and
    // load the service the moment the dock asks for it. Also tell the dock the
    // app is here (idle), so it shows "Connected" instead of "Offline".
    let lmRelayTimer: ReturnType<typeof setInterval> | null = null;
    let lmRelayBusy = false;
    const stopLmRelayWatch = () => {
      if (lmRelayTimer) clearInterval(lmRelayTimer);
      lmRelayTimer = null;
    };
    void (async () => {
      try {
        const base = await getOverlayBaseUrl();
        const current = await fetch(`${base}/api/lm-state`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (!current || typeof current !== "object" || !("status" in current)) {
          await fetch(`${base}/api/lm-state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "idle", entries: [], candidates: [], queue: [], suggestions: [], matching: false, error: null }),
          }).catch(() => undefined);
        }
        lmRelayTimer = setInterval(async () => {
          if (lmRelayBusy || lmService) {
            if (lmService) stopLmRelayWatch();
            return;
          }
          lmRelayBusy = true;
          try {
            const raw = await fetch(`${base}/api/lm-command`, { cache: "no-store" }).then((r) => r.json()).catch(() => []);
            const commands = (Array.isArray(raw) ? raw : [])
              .map((item: unknown) => {
                try {
                  return (typeof item === "string" ? JSON.parse(item) : item) as { type: string; commandId?: string; payload?: unknown };
                } catch {
                  return null;
                }
              })
              .filter((cmd): cmd is { type: string; commandId?: string; payload?: unknown } => Boolean(cmd?.type));
            if (!commands.length) return;
            const needsService = commands.some((cmd) => cmd.type === "lm:start" || cmd.type === "lm:stop" || cmd.type === "lm:keep-listening");
            if (needsService) {
              const service = await ensureLmService();
              stopLmRelayWatch();
              for (const cmd of commands) service.handleRelayCommand(cmd);
            } else {
              for (const cmd of commands) {
                if (cmd.type === "lm:navigate") {
                  dockBridge.sendCommand({ type: "lm:navigate", commandId: cmd.commandId, payload: cmd.payload, timestamp: Date.now() });
                }
              }
            }
          } finally {
            lmRelayBusy = false;
          }
        }, 1000);
      } catch (err) {
        console.warn("[App] Verse AI relay watch unavailable:", err);
      }
    })();

    // Relay OBS connection status to the dock
    const unsubObs = obsService.onStatusChange((status) => {
      dockBridge.sendObsStatus(status === "connected");
    });

    // Relay service status to the dock
    const unsubSvc = svcStore.subscribe((state) => {
      dockBridge.sendServiceStatus(state.status, state.serviceName);
    });

    // Handle state requests from the dock
    const unsubCmd = dockBridge.onCommand(async (cmd) => {
      if (cmd.type === "request-state") {
        const productionSettings = await buildDockProductionSettingsPayload().catch(() => undefined);
        const servicePlanner = await getServicePlannerSnapshot().catch(() => undefined);
        const liveTools = await getLiveToolsSnapshot().catch(() => undefined);
        const countdowns = await getCountdownSnapshot().catch(() => undefined);
        dockBridge.sendFullState({
          obsConnected: obsService.status === "connected",
          serviceStatus: svcStore.status,
          productionSettings,
          servicePlanner,
          liveTools,
          countdowns,
        });
      }

      // Proactively send library data when dock pings (handles refresh race condition)
      if (cmd.type === "ping") {
        try {
          const allSongs = await getAllSongs();
          sendSongLimitToDock();
          const { limit: songLimit } = checkEntitlementSync("songs", getEffectivePlan(userRef.current));
          const songs = (songLimit > 0 && songLimit < 9999) ? allSongs.slice(0, songLimit) : allSongs;
          dockBridge.sendState({
            type: "state:songs-data",
            payload: songs,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to send songs on ping:", err);
        }

        // Also send countdowns on ping so dock has current state after reload
        try {
          const countdownSnapshot = await getCountdownSnapshot();
          dockBridge.sendState({
            type: "state:countdowns",
            payload: countdownSnapshot,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to send countdowns on ping:", err);
        }

        sendNotesToDock();
      }

      if (cmd.type === "request-service-plans") {
        try {
          const snapshot = await getServicePlannerSnapshot();
          dockBridge.sendState({
            type: "state:service-plans",
            payload: snapshot,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to send service plans to dock:", err);
        }
      }

      if (cmd.type === "service-plan:save") {
        try {
          const plan = await saveServicePlan(cmd.payload as ServicePlan);
          const snapshot = await getServicePlannerSnapshot();
          dockBridge.sendState({
            type: "state:service-plan-save-result",
            payload: { commandId: cmd.commandId, ok: true, plan },
            timestamp: Date.now(),
          });
          dockBridge.sendState({
            type: "state:service-plans",
            payload: snapshot,
            timestamp: Date.now(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          dockBridge.sendState({
            type: "state:service-plan-save-result",
            payload: { commandId: cmd.commandId, ok: false, error: message },
            timestamp: Date.now(),
          });
          console.warn("[App] Failed to save service plan from dock:", err);
        }
      }

      // Dock "reload themes": pull the account's latest themes, rewrite the Dock files,
      // then tell every open Dock so its pickers re-read them.
      if (cmd.type === "themes:sync") {
        try {
          await syncCustomThemesToDock();
          const { syncFavoriteBibleThemesToDock, notifyDockThemesChanged } = await import("./services/favoriteThemes");
          await syncFavoriteBibleThemesToDock();
          notifyDockThemesChanged();
        } catch (err) {
          console.warn("[App] Failed to resync themes for the dock:", err);
        }
      }

      // Dock is requesting library data (songs) via BroadcastChannel
      if (cmd.type === "request-library-data") {
        try {
          const allSongs = await getAllSongs();
          const media = await getAllMedia();
          sendSongLimitToDock();
          const { limit: songLimit } = checkEntitlementSync("songs", getEffectivePlan(userRef.current));
          const songs = (songLimit > 0 && songLimit < 9999) ? allSongs.slice(0, songLimit) : allSongs;
          dockBridge.sendState({
            type: "state:songs-data",
            payload: songs,
            timestamp: Date.now(),
          });
          dockBridge.sendState({
            type: "state:media-data",
            payload: media,
            timestamp: Date.now(),
          });
          sendNotesToDock();
        } catch (err) {
          console.warn("[App] Failed to send library data to dock:", err);
        }
      }

      if (cmd.type === "media:save") {
        try {
          const item = cmd.payload as MediaItem;
          if (!item?.id || !item?.name || !item?.type || !item?.url || !item?.createdAt) {
            throw new Error("Invalid media payload.");
          }
          await saveMedia(item);
          dockBridge.sendState({
            type: "state:media-data",
            payload: await getAllMedia(),
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to save dock media:", err);
        }
      }

      if (cmd.type === "media:delete") {
        try {
          const payload = cmd.payload as { id?: string; fileName?: string } | null;
          const id = payload?.id?.trim();
          const fileName = payload?.fileName?.trim();
          if (!id && !fileName) {
            throw new Error("Invalid media delete payload.");
          }
          if (id) await deleteMedia(id);
          if (fileName) await deleteUploadedMediaFile(fileName);
          const updated = await getAllMedia();
          dockBridge.sendState({
            type: "state:media-data",
            payload: updated,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to delete dock media:", err);
        }
      }

      if (cmd.type === "worship:song-save") {
        try {
          const { song, songs } = await saveWorshipSongFromDockPayload(cmd.payload as WorshipDockSongSavePayload);
          dockBridge.sendState({
            type: "state:worship-song-save-result",
            payload: { commandId: cmd.commandId, ok: true, song },
            timestamp: Date.now(),
          });
          sendSongLimitToDock();
          const { limit: songLimit } = checkEntitlementSync("songs", getEffectivePlan(userRef.current));
          const limitedSongs = (songLimit > 0 && songLimit < 9999) ? songs.slice(0, songLimit) : songs;
          dockBridge.sendState({
            type: "state:songs-data",
            payload: limitedSongs,
            timestamp: Date.now(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          dockBridge.sendState({
            type: "state:worship-song-save-result",
            payload: { commandId: cmd.commandId, ok: false, error: message },
            timestamp: Date.now(),
          });
          console.warn("[App] Failed to save dock Worship song:", err);
        }
      }

      if (cmd.type === "worship:save-preferences") {
        try {
          const payload = cmd.payload;
          if (!payload || typeof payload !== "object") {
            throw new Error("Invalid worship preference payload.");
          }
          // Keep the app bridge on the same user-scoped IndexedDB key as the
          // standalone dock. The old unscoped key is still read as a legacy
          // migration by dockPreferenceStorage.
          await putRecord(
            STORES.APP_SETTINGS,
            payload,
            getUserScopedKey(DOCK_WORSHIP_PREFS_APP_KEY),
          );
        } catch (err) {
          console.warn("[App] Failed to save dock Worship preferences:", err);
        }
      }

      if (cmd.type === "notes:append") {
        try {
          const payload = cmd.payload as DockNotesAppendCommand | null;
          if (!payload?.commandId || !payload.text?.trim()) {
            throw new Error("Invalid notes payload.");
          }
          const result = appendTextToDockNotes(payload.text, payload.title, {
            sourceId: payload.commandId,
            sessionId: payload.sessionId,
          });
          if (result) {
            void syncDockNotesToDock(result.notes);
            dockBridge.sendState({
              type: "state:notes-updated",
              payload: { notes: result.notes, commandId: payload.commandId },
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.warn("[App] Failed to append dock note:", err);
        }
      }

      // LM Dock: Start listening
      if (cmd.type === "lm:start") {
        const payload = cmd.payload as { micId?: string } | null;
        const micId = payload?.micId;
        void ensureLmService()
          .then((service) => service.startListening(micId || undefined))
          .catch((err) => console.warn("[App] Failed to start LM listening:", err));
      }

      // LM Dock: Stop listening
      if (cmd.type === "lm:stop") {
        lmService?.stopListening();
      }
    });

    let lastProcessedWorshipSaveCommandId = "";
    const worshipSaveFallbackStartedAt = Date.now();
    let worshipSaveFallbackInFlight = false;
    const pollWorshipSaveFallback = async () => {
      if (worshipSaveFallbackInFlight) return;
      worshipSaveFallbackInFlight = true;
      try {
        const command = await loadWorshipDockSongSaveCommand().catch(() => null);
        if (!command || command.commandId === lastProcessedWorshipSaveCommandId) return;
        if (command.timestamp < worshipSaveFallbackStartedAt - 1_000) {
          lastProcessedWorshipSaveCommandId = command.commandId;
          return;
        }

        lastProcessedWorshipSaveCommandId = command.commandId;
        try {
          const { song, songs } = await saveWorshipSongFromDockPayload(command.payload);
          await saveWorshipDockSongSaveResult({
            commandId: command.commandId,
            timestamp: Date.now(),
            ok: true,
            song,
          });
          dockBridge.sendState({
            type: "state:worship-song-save-result",
            payload: { commandId: command.commandId, ok: true, song },
            timestamp: Date.now(),
          });
          sendSongLimitToDock();
          const { limit: songLimit } = checkEntitlementSync("songs", getEffectivePlan(userRef.current));
          const limitedSongs = (songLimit > 0 && songLimit < 9999) ? songs.slice(0, songLimit) : songs;
          dockBridge.sendState({
            type: "state:songs-data",
            payload: limitedSongs,
            timestamp: Date.now(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await saveWorshipDockSongSaveResult({
            commandId: command.commandId,
            timestamp: Date.now(),
            ok: false,
            error: message,
          });
          dockBridge.sendState({
            type: "state:worship-song-save-result",
            payload: { commandId: command.commandId, ok: false, error: message },
            timestamp: Date.now(),
          });
          console.warn("[App] Failed to save fallback dock Worship song:", err);
        }
      } finally {
        worshipSaveFallbackInFlight = false;
      }
    };
    void pollWorshipSaveFallback();
    const worshipSaveFallbackTimer = window.setInterval(
      () => void pollWorshipSaveFallback(),
      getRecommendedPollingInterval(WORSHIP_DOCK_SAVE_POLL_INTERVAL_MS),
    );

    return () => {
      window.clearInterval(worshipSaveFallbackTimer);
      unsubObs();
      unsubSvc();
      unsubCmd();
      unsubDockCmd();
      unsubMobileRemote?.();
      unsubLmDock?.();
      stopLmRelayWatch();
      unsubAppStatus();
    };
  }, []);

  useEffect(() => {
    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<MVSettingsType>).detail;
      syncProductionSettingsToDock().catch(() => { });
      dockBridge.sendBrandingUpdated({
        brandLogoPath: detail?.brandLogoPath ?? "",
        brandColor: detail?.brandColor ?? "",
        brandSecondaryColor: detail?.brandSecondaryColor ?? "",
        churchName: detail?.churchName ?? "",
        mainPastorName: detail?.mainPastorName ?? "",
      });
    };
    window.addEventListener(MV_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    return () => window.removeEventListener(MV_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
  }, []);
  // ── Splash state ──
  const [splashVisible, setSplashVisible] = useState(true);
  const [resourcesReady, setResourcesReady] = useState(false);

  // ── Update state ──
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [versionAge, setVersionAge] = useState<{ daysOld: number; forceUpdate: boolean; persistent: boolean }>({ daysOld: 0, forceUpdate: false, persistent: false });

  // ── Server-driven forced update (admin-controlled) ──
  const [forcedUpdateState, setForcedUpdateState] = useState<ForcedUpdateState>(() =>
    getForcedUpdateState(null)
  );

  // Share the evaluated state with the top status strip.
  useEffect(() => {
    publishForcedUpdateState(forcedUpdateState);
  }, [forcedUpdateState]);

  const startupDone = useRef(false);
  const updatePollBusyRef = useRef(false);

  // ── Startup: load resources + check for updates in parallel ──
  useEffect(() => {
    if (startupDone.current) return;
    startupDone.current = true;

    // Track app started (also tracks app_installed on first launch)
    trackAppStarted();
    trackAppStartedBackend({
      platform: typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "desktop",
      appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown",
    });

    // Initialize the license guard (central subscription enforcement)
    initLicenseGuard().catch(() => {
      // Non-critical — will retry on next verification cycle
    });

    // Non-blocking background update check (never blocks UI)
    checkForUpdate()
      .then((result) => {
        // Always process the result — even when no update is available,
        // we need the date for version age computation (forced update after 21 days)
        if (result.available || result.date) {
          setUpdateResult(result);
          setVersionAge(getVersionAge(result, typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined));
        }
      })
      .catch(() => {
        // If update check fails (no internet, etc.), let the app proceed
      });

    // Non-blocking background forced update check (never blocks UI)
    fetchAppSettings()
      .then((settings) => {
        setForcedUpdateState(getForcedUpdateState(settings));
      })
      .catch(() => {
        // If fetch fails, proceed without server-driven forced update
      });

    // Check whether this is a reload or active session
    const isReload = typeof sessionStorage !== "undefined" && Boolean(sessionStorage.getItem("mce_session_active"));
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("mce_session_active", "1");
    }

    // On reload, don't hold the user back with an artificial delay.
    // On fresh cold launch, keep a short 200ms transition to avoid jarring flicker.
    const minSplashTime = isReload ? Promise.resolve() : new Promise((r) => setTimeout(r, 200));


    // Initialize the overlay URL (queries Tauri for the local server port)
    const overlayInit = initOverlayUrl().catch(() => {
      // Fallback to window.location.origin if Tauri command fails
    });

    // Ensure any previously opened floating pet window is closed
    if (hasTauriInvoke()) {
      void import("./services/makeChatGptWindow").then((m) => m.hideMakeChatGptWindow()).catch(() => {});
    }

    // Initialize device performance detection (non-blocking)
    import("./services/performanceManager").then((m) =>
      m.init().catch((err) => {
        console.warn("[App] Performance manager init failed (non-critical):", err);
      }),
    );

    // Run one-time migration from legacy databases (non-blocking)
    migrateFromLegacyDatabases().catch((err) => {
      console.warn("[App] Legacy DB migration failed (non-critical):", err);
    });

    // Run one-time upload of local content to MongoDB (non-blocking)
    import("./services/migrationService").then((m) =>
      m.runContentMigrationIfNeeded().catch((err) => {
        console.warn("[App] MongoDB content migration failed (non-critical):", err);
      }),
    );

    // Seed starter multiview templates into IndexedDB (non-blocking, skips existing)
    seedTemplates(STARTER_TEMPLATES).then(() => {
      // Sync layouts to dock after seeding completes
      syncLayoutsToDock().catch(() => { });
    }).catch((err) => {
      console.warn("[App] Template seeding failed (non-critical):", err);
    });

    // First launch with the Theme Library: new accounts get the short list, existing ones keep everything.
    import("./services/themeLibrary").then(({ ensureThemeLibrary }) => ensureThemeLibrary()).catch(() => { });

    // Sync dock-first production data to dock JSON files on startup.
    syncSongsToDock().catch(() => { });
    syncDockNotesToDock().catch(() => { });
    syncCustomThemesToDock().catch(() => { });
    syncInstalledTranslationsToDock().catch(() => { });
    syncProductionSettingsToDock().catch(() => { });
    syncLiveToolsToDock().catch(() => { });
    importDockServicePlansFromUploads()
      .then(() => syncServicePlansToDock())
      .catch(() => { });

    // Rehydrate theme favorites from durable storage, then sync them to dock JSON.
    import("./services/favoriteThemes").then(({
      hydrateFavoriteThemes,
      syncLTFavoritesToDock,
      syncBibleFavoritesToDock,
      syncFavoriteBibleThemesToDock,
    }) => {
      hydrateFavoriteThemes()
        .then(() => Promise.all([
          syncLTFavoritesToDock(),
          syncBibleFavoritesToDock(),
          syncFavoriteBibleThemesToDock(),
        ]))
        .catch(() => { });
    }).catch(() => { });

    // Admin-controlled Broadcast Graphics: download the catalog when online, keep it for offline use.
    import("./services/broadcastGraphicsCatalog")
      .then(({ startBroadcastGraphicsCatalog }) => startBroadcastGraphicsCatalog())
      .catch(() => { });

    // Preload the splash image itself + any critical resources
    const preload = new Promise<void>((resolve) => {
      const img = new Image();
      img.src = getSplashImageSrc();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // proceed even if image fails
    });

    // Wait only for: minimum splash time + preload + local overlay init (network checks run asynchronously in background)
    Promise.all([minSplashTime, preload, overlayInit]).then(() => {
      setResourcesReady(true);
    });
  }, []);

  // ── Re-verify license when user logs in (BUG 2) ──
  const prevUserRef = useRef(user);
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = user;
    // User just logged in (was null, now has a value)
    if (!prev && user) {
      reverifyOnAuth().catch(() => { });
    }
  }, [user]);

  // ── Splash done callback ──
  const handleSplashDone = useCallback(() => {
    setSplashVisible(false);
  }, []);

  // ── Track app closed ──
  useEffect(() => {
    const startTime = Date.now();
    const handleBeforeUnload = () => {
      trackAppClosed(Date.now() - startTime);
      trackAppClosedBackend(Math.round((Date.now() - startTime) / 1000));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ── Track OBS connection status ──
  useEffect(() => {
    let prevConnected = false;
    const unsub = obsService.onStatusChange((status) => {
      const connected = status === "connected";
      if (connected && !prevConnected) {
        trackObsConnected();
        trackObsConnectedBackend();
        // Remove OBS sources older versions left behind and the app no longer uses.
        // Never touches a source that is on air.
        void import("./services/retiredMceSources")
          .then((m) => m.scheduleRetiredMceSourceCleanup((type, data) => obsService.call(type, data), "main-app"))
          .catch(() => { /* best effort */ });
        // Wake any MCE browser source that loaded before the overlay server was ready.
        // Skipped automatically while OBS is streaming or recording.
        void import("./services/obsBrowserSourceRefresh")
          .then((m) => m.scheduleMceBrowserSourceRefresh((type, data) => obsService.call(type, data), "main-app"))
          .catch(() => { /* best effort */ });
      } else if (!connected && prevConnected) {
        trackObsDisconnected();
      }
      prevConnected = connected;
    });
    return unsub;
  }, []);

  // ── Continuous update polling while app is running ──
  useEffect(() => {
    if (splashVisible) return;
    if (updateResult?.available && updateResult.update) return;
    // Stop polling when force update is already shown (e.g. from cached offline data)
    if (versionAge.forceUpdate && updateResult) return;

    let cancelled = false;

    const pollForUpdates = async () => {
      if (updatePollBusyRef.current) return;
      updatePollBusyRef.current = true;
      try {
        const result = await checkForUpdate();
        if (cancelled) return;
        const curVer = result.currentVersion ?? (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined);
        if (result.available && result.update) {
          setUpdateResult((prev) => {
            if (prev?.available && prev.version === result.version) {
              return prev;
            }
            return result;
          });
          setVersionAge(getVersionAge(result, curVer));
        } else if (result.date) {
          // Offline fallback: cached date returned, check if version is stale
          setUpdateResult((prev) => {
            if (prev?.date === result.date && !prev?.available) {
              return prev;
            }
            return result;
          });
          setVersionAge(getVersionAge(result, curVer));
        }
      } catch {
        // Keep polling.
      } finally {
        updatePollBusyRef.current = false;
      }
    };

    void pollForUpdates();
    const intervalId = window.setInterval(() => {
      void pollForUpdates();
    }, UPDATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [splashVisible, updateResult?.available, updateResult?.update, updateResult?.version, versionAge.forceUpdate, updateResult]);

  // ── Update: remind later (hide temporarily, app continues) ──
  const handleRemindLaterUpdate = useCallback(() => {
    setUpdateResult(null);
  }, []);

  // ── Server-driven forced update / emergency lock check ──
  const refetchForcedUpdate = useCallback(() => {
    // refresh (not the 5-minute cached read) so a policy the admin just
    // published reaches running apps within a minute.
    refreshAppSettings()
      .then((settings) => {
        setForcedUpdateState(getForcedUpdateState(settings));
      })
      .catch(() => { /* non-critical */ });
  }, []);

  // Poll every 60 seconds (emergency lock needs to take effect quickly)
  useEffect(() => {
    if (splashVisible) return;

    const intervalId = window.setInterval(refetchForcedUpdate, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [splashVisible, refetchForcedUpdate]);

  // Re-check on window focus / visibility change (near-instant lock activation)
  useEffect(() => {
    if (splashVisible) return;

    const handleFocus = () => refetchForcedUpdate();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [splashVisible, refetchForcedUpdate]);

  // ── Trial welcome modal ──
  useEffect(() => {
    if (user && user.trial && !user.trial.welcomeShown) {
      // Also check localStorage to ensure we don't show again
      if (!hasTrialWelcomeBeenShown()) {
        const trialEnds = user.trial?.endsAt;
        if (trialEnds && new Date(trialEnds) > new Date()) {
          setShowTrialModal(true);
          trackAppStarted(); // reuse existing analytics
        }
      }
    }
  }, [user]);

  const handleTrialModalDismiss = useCallback(async () => {
    markTrialWelcomeAsShown();
    setShowTrialModal(false);
    if (user) {
      try {
        const API_BASE = import.meta.env.VITE_AUTH_API_URL || "https://api.makechurcheazy.com";
        const deviceId = getDeviceId();
        await fetch(`${API_BASE}/api/auth/trial-welcome`, {
          method: "POST",
          headers: {
            ...(deviceId ? { "X-Device-Id": deviceId } : {}),
          },
        });
      } catch (e) {
        console.error("[App] Failed to mark trial welcome shown:", e);
      }
      setUser({ ...user, trial: { ...user.trial, welcomeShown: true } });
    }
  }, [user, setUser]);

  const handleGlobalMediaUpload = useCallback(async (files: FileList | File[]) => {
    // The media importer includes document conversion and preview helpers.
    // Load it only when the user actually drops/imports a file.
    const { isSupportedLibraryImportFile, saveLibraryMediaFile } = await import("./library/MediaTab");
    const queue = Array.from(files).filter(isSupportedLibraryImportFile);
    if (queue.length === 0) return;
    setGlobalMediaUploading(true);
    try {
      for (const file of queue) {
        await saveLibraryMediaFile(file);
      }
      dockBridge.sendState({
        type: "state:media-data",
        payload: await getAllMedia(),
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn("[App] Global media upload failed:", error);
    } finally {
      setGlobalMediaUploading(false);
      if (globalMediaInputRef.current) {
        globalMediaInputRef.current.value = "";
      }
    }
  }, []);

  useEffect(() => {
    if (splashVisible) {
      setGlobalMediaDragging(false);
      dragCounterRef.current = 0;
      return;
    }

    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setGlobalMediaDragging(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setGlobalMediaDragging(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setGlobalMediaDragging(false);
      }
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current = 0;
      setGlobalMediaDragging(false);
      if (event.dataTransfer?.files?.length) {
        void handleGlobalMediaUpload(event.dataTransfer.files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleGlobalMediaUpload, splashVisible, updateResult]);

  return (
    <div className="app">
      <input
        ref={globalMediaInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) {
            void handleGlobalMediaUpload(files);
          }
        }}
      />
      {/* 1. Splash screen — shown until resources ready */}
      {splashVisible && (
        <SplashScreen ready={resourcesReady} onDone={handleSplashDone} />
      )}

      {/* 2. Server-driven forced update modal (admin-controlled). Closable reminder
          until the final 24 hours, then it cannot be closed. */}
      {!splashVisible && licenseLockReason !== "forced_upgrade" && (
        <ForcedUpdateGate state={forcedUpdateState} />
      )}

      {/* 2b. Force update modal — blocks app when version is too old (age-based) */}
      {!splashVisible && !forcedUpdateState.active && updateResult?.available && versionAge.forceUpdate && (
        <ForceUpdateModal
          result={updateResult}
          daysOld={versionAge.daysOld}
          locked={true}
        />
      )}

      {/* 3. Optional update dialog (only when the update is not forced) */}
      {!splashVisible && !forcedUpdateState.active && updateResult?.available && !versionAge.forceUpdate && (
        <UpdateNotification
          result={updateResult}
          onRemindLater={handleRemindLaterUpdate}
        />
      )}

      {/* 4. Main app — always rendered after splash, but blocked by force update modal */}
      {!splashVisible && (
        <AppErrorBoundary>
          <Suspense fallback={<AppRouteFallback />}>
            <Routes>
              <Route path="p/:sessionId" element={<PublicPresentationRoute />} />
              <Route
                path="*"
                element={
                  <AuthGate>
                    <Routes>
                      <Route
                        path="*"
                        element={
                          <OBSConnectGate>
                            <VerificationGate>
                              <LicenseGuard>
                                <LowerThirdProvider>
                                  <SettingsOverlayRoutes>
                                    {/* Onboarding — standalone layout, no sidebar */}
                                    {!mceOnboardingDone && (
                                      <Route path="onboarding" element={<OnboardingPage />} />
                                    )}
                                    <Route element={mceOnboardingDone ? <AppShell /> : <Navigate to="/onboarding" replace />}>
                                      {/* The dashboard, always (also for churches that chose Studio during setup). */}
                                      <Route index element={<ProductionHomePage />} />
                                      <Route path="live-tools" element={<Navigate to="/" replace />} />
                                      <Route path="live" element={<Navigate to="/" replace />} />
                                      <Route path="service" element={<Navigate to="/" replace />} />
                                      <Route path="resources" element={<ResourcesPage />} />
                                      <Route path="service-planner" element={<ServicePlannerPage />} />

                                      <Route path="songs" element={<Navigate to="/resources?tab=worship" replace />} />
                                      <Route path="bible-library" element={<Navigate to="/resources?tab=bible" replace />} />
                                      <Route path="bible/translations" element={<Navigate to="/resources?tab=bible" replace />} />
                                      <Route path="production/themes" element={<ProductionThemeSettingsPage />} />
                                      <Route path="broadcast-graphics" element={<BroadcastGraphicsPage />} />
                                      <Route path="graphics" element={<Navigate to="/broadcast-graphics" replace />} />
                                      <Route path="settings" element={<MVSettings />} />
                                      <Route path="speech-to-scripture" element={<CreditsGuard><SpeechToScripturePage /></CreditsGuard>} />
                                      <Route path="transcribe" element={<Navigate to="/speech-to-scripture" replace />} />
                                      <Route path="gallery" element={<FeatureGuard feature="multiview"><MultiViewGalleryPage /></FeatureGuard>} />
                                      <Route path="countdowns" element={<FeatureGuard feature="countdowns"><CountdownsPage /></FeatureGuard>} />
                                      <Route path="tutorials" element={<TutorialsPage />} />
                                      <Route path="credits" element={<CreditsPage />} />
                                      <Route path="transcripts" element={<CreditsGuard><TranscriptLibraryPageWrapper /></CreditsGuard>} />
                                      <Route path="transcripts/:id" element={<CreditsGuard><TranscriptDetailPageWrapper /></CreditsGuard>} />
                                      <Route path="library" element={<Navigate to="/resources?tab=media" replace />} />
                                      <Route path="design-studio" element={<DesignStudioPage />} />
                                      <Route path="templates" element={<TemplatesPage />} />
                                      <Route path="templates/*" element={<TemplatesPage />} />
                                      <Route path="hub" element={<Navigate to="/" replace />} />
                                      <Route path="hub/*" element={<Navigate to="/" replace />} />
                                      <Route path="service-hub" element={<Navigate to="/" replace />} />
                                      <Route path="service-control-hub" element={<Navigate to="/" replace />} />
                                      <Route path="quick-merge" element={<Navigate to="/" replace />} />
                                      <Route path="broadcast" element={<BroadcastPage />} />
                                      <Route path="studio" element={<><StudioPage /><StudioWelcomeModal /></>} />
                                      <Route path="bible" element={<Navigate to="/settings" replace />} />
                                      <Route path="bible/*" element={<Navigate to="/settings" replace />} />
                                      <Route path="worship" element={<Navigate to="/resources?tab=worship" replace />} />
                                      <Route path="lower-thirds" element={<Navigate to="/broadcast-graphics" replace />} />
                                      <Route path="scenes" element={<Navigate to="/settings" replace />} />
                                      <Route path="multiview" element={<FeatureGuard feature="multiview"><MVShell /></FeatureGuard>} />
                                      <Route path="multiview/*" element={<FeatureGuard feature="multiview"><MVShell /></FeatureGuard>} />
                                      <Route path="new" element={<Navigate to="/" replace />} />

                                      {/* Developer Tools */}
                                      <Route path="dev/db" element={<DevDashboard />} />
                                      {import.meta.env.DEV && DevModalsGalleryPage && (
                                        <Route path="dev/modals" element={<DevModalsGalleryPage />} />
                                      )}
                                    </Route>

                                    <Route path="*" element={<Navigate to="/" replace />} />
                                  </SettingsOverlayRoutes>
                                </LowerThirdProvider>
                              </LicenseGuard>
                            </VerificationGate>
                          </OBSConnectGate>
                        }
                      />
                    </Routes>
                  </AuthGate>
                }
              />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      )}

      {!splashVisible && user && <DesktopReceiverNotification />}

      {/* 5. Trial welcome modal — overlays app after auth */}
      {showTrialModal && user?.trial?.endsAt && (
        <TrialModal
          trialDays={user.trial?.durationDays || 30}
          trialEndsAt={user.trial.endsAt}
          isExistingUser={(user.trial?.durationDays || 0) >= 10}
          onDismiss={handleTrialModalDismiss}
        />
      )}


      {globalMediaDragging && !splashVisible && (
        <div className="app-global-media-drop-overlay" aria-hidden="true">
          <div className="app-global-media-drop-overlay__card">
            <Icon name="cloud_upload" size={24} />
            <div className="app-global-media-drop-overlay__title">{t("library.mediaTab.dropOverlay.appTitle")}</div>
            <div className="app-global-media-drop-overlay__text">
              {t("library.mediaTab.dropOverlay.appText")}
            </div>
          </div>
        </div>
      )}

      {globalMediaUploading && !splashVisible && (
        <div className="app-global-media-uploading">{t("library.mediaTab.addModal.saving")}...</div>
      )}

      <AnnouncementModalHost />
      <VoiceAiInactivityModal />
      {!splashVisible && <UpdateDownloadingBanner />}
      <UpdateBackgroundNoticeModal />
      <UpdateCloseAppWarningModal />
    </div>
  );
}

export default App;
