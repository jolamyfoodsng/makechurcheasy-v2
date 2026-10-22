import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Images,
  Info,
  Mic,
  Monitor,
  MonitorSmartphone,
  Music,
  Play
} from "../components/icons/NativeIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getBibleSettings, getInstalledTranslations } from "../bible/bibleDb";
import { useAuth } from "../contexts/AuthContext";
import { getAllMedia } from "../library/libraryDb";
import { track } from "../services/analytics";
import { lmDockService, type LmDockSnapshot } from "../services/lmDockService";
import { obsService, type ConnectionStatus } from "../services/obsService";
import { getOverlayBaseUrlSync, useDockBaseUrl, useLanDockBaseUrl } from "../services/overlayUrl";
import { confirmStopVoiceBibleForPresentation } from "../services/voiceBiblePresentationGuard";
import { getAllSongs } from "../worship/worshipDb";
import { OnboardingResumeBanner } from "./OnboardingPage";
import MovePluginInstallModal from "../components/MovePluginInstallModal";
import {
  ensureMoveTransition,
  getObsMovePluginStatus,
  isMceBridgeLoaded,
  isMovePluginLoaded,
} from "../services/obsMovePlugin";
import MultiPlatformStreamingBanner from "../components/MultiPlatformStreamingBanner";
import BroadcastGraphicsPromoBanner from "../components/BroadcastGraphicsPromoBanner";
import StudioModePromoBanner from "../components/StudioModePromoBanner";
import VerseAiPromoBanner from "../components/VerseAiPromoBanner";
import BroadcastHowItWorksModal from "../components/BroadcastHowItWorksModal";

// ── Helpers ────────────────────────────────────────────────────────────────

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "dashboard.greeting.morning";
  if (hour < 17) return "dashboard.greeting.afternoon";
  return "dashboard.greeting.evening";
}

const GREETING_TITLES = /^(pastor|pst\.?|dr\.?|rev\.?|reverend|bishop|apostle|prophet|prophetess|evangelist|elder|minister|mr\.?|mrs\.?|ms\.?)$/i;

/**
 * The name used in the greeting: the signed-in person's own name from their account
 * (the one they signed up with). The church profile (church name, main pastor) is a
 * different thing and is never used here, because the person using the app is not
 * always the pastor.
 */
function getGreetingName(accountName: string | undefined | null): string {
  const parts = String(accountName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length > 1 && GREETING_TITLES.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

// ── 1. Greeting Section ────────────────────────────────────────────────────

interface DashboardGreetingProps {
  userName: string;
  obsConnected: boolean;
  onWatchTutorials: () => void;
}

function DashboardGreeting({
  userName,
  obsConnected,
  onWatchTutorials,
}: DashboardGreetingProps) {
  const { t } = useTranslation();
  const greetingKey = useMemo(() => getGreetingKey(), []);

  return (
    <header className="header-container">
      <div className="header-left">
        <div>
          <h2 className="header-title">
            {t(greetingKey)}, {userName || "User"}{" "}
            <span className="header-emoji">&#x1F44B;</span>
          </h2>
          <p className="header-subtitle">
            {obsConnected
              ? t("dashboard.header.readyMessage", "Everything looks ready for your next service.")
              : t("dashboard.header.connectMessage", "Connect OBS for broadcast tools, or open Studio Mode to project directly.")}
          </p>
        </div>
      </div>
      <div className="header-right">
        <button
          type="button"
          className="header-tutorial-btn"
          onClick={onWatchTutorials}
          title={t("dashboard.header.watchTutorials", "Watch Tutorials")}
        >
          <span className="header-tutorial-btn__icon-box">
            <Play className="header-tutorial-btn__icon" />
          </span>
          <span className="header-tutorial-btn__label">
            {t("dashboard.header.watchTutorials", "Watch Tutorials")}
          </span>
        </button>
      </div>
    </header>
  );
}

// ── 2. OBS + Dock Status Panel ─────────────────────────────────────────────

interface DashboardObsDockStatusProps {
  obsStatus: ConnectionStatus;
  dockAvailable: boolean;
  onConnectObs: () => void;
}

function DashboardObsDockStatus({
  obsStatus,
  dockAvailable,
  onConnectObs,
}: DashboardObsDockStatusProps) {
  const { t } = useTranslation();
  const obsConnected = obsStatus === "connected";
  const [showHowToConnect, setShowHowToConnect] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const base = useDockBaseUrl();
  const lanBase = useLanDockBaseUrl();
  const overlayUrl = `${base}/dock`;
  const lmDockUrl = `${base}/lm-dock`;

  const handleCopy = useCallback((id: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  return (
    <div className="status-panel">
      <div className="status-panel__top">
        <div className="status-panel__items">
          <div className="status-item">
            <Monitor className="status-icon" />
            <div>
              <p className="status-title">
                {t("dashboard.status.obs", "OBS")} {obsConnected ? t("dashboard.obs.connected", "Connected") : t("dashboard.obs.disconnected", "Disconnected")}{" "}
                <span
                  className={`status-dot ${obsConnected ? "status-dot--live" : ""}`}
                  style={{
                    backgroundColor: obsConnected
                      ? "var(--success, #22c55e)"
                      : "var(--error, #ef4444)",
                  }}
                />
              </p>
              <p className="status-desc">
                {obsConnected
                  ? t("dashboard.obs.studioOnline", "Studio is online and ready")
                  : t("dashboard.obs.notConnected", "Not connected to OBS")}
              </p>
            </div>
          </div>

          <div className="status-item">
            <MonitorSmartphone className="status-icon" />
            <div>
              <p className="status-title">
                {t("dashboard.status.dock", "Dock")} {dockAvailable ? t("dashboard.dock.detected", "Working") : t("dashboard.dock.notDetected", "Dock not detected")}{" "}
                <span
                  className="status-dot"
                  style={{
                    backgroundColor: dockAvailable
                      ? "var(--success, #22c55e)"
                      : "var(--text-muted, #64748b)",
                  }}
                />
              </p>
              <p className="status-desc">
                {dockAvailable
                  ? t("dashboard.dock.detected", "Working")
                  : t("dashboard.dock.notDetected", "Dock not detected")}
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`status-panel__obs-btn ${
            obsConnected
              ? "status-panel__obs-btn--connected"
              : "status-panel__obs-btn--disconnected"
          }`}
          onClick={() => {
            track("connect_obs_clicked");
            onConnectObs();
          }}
          title={t("dashboard.btn.connect", "Connect")}
        >
          {obsConnected ? (
            <>
              <Check className="btn-icon" /> {t("dashboard.btn.obsConnected", "OBS Connected")}
            </>
          ) : (
            <>
              <Monitor className="btn-icon" /> {t("dashboard.btn.connectToObs", "Connect to OBS")}
            </>
          )}
        </button>
      </div>

      <div className="status-panel__accordion-divider" />

      <button
        type="button"
        className="status-panel__accordion-toggle"
        onClick={() => setShowHowToConnect((prev) => !prev)}
        aria-expanded={showHowToConnect}
        title={t("dashboard.urls.howToAdd", "How to Add a Dock in OBS")}
      >
        <div className="status-panel__accordion-toggle-left">
          {showHowToConnect ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{t("dashboard.urls.howToAdd", "How to Add a Dock in OBS")}</span>
        </div>
        <span className="status-panel__accordion-hint">
          {showHowToConnect ? t("common.hide", "Hide") : t("dashboard.urls.viewDockUrlAndSteps", "View Dock URL & Setup")}
        </span>
      </button>

      {showHowToConnect && (
        <div className="status-panel__accordion-body">
          {/* Connection URLs: Bible Overlay Dock & Scripture Assistant */}
          <div className="urls-row">
            <div className="urls-group status-panel__url-block">
              <div className="url-label-block">
                <span className="url-label-text text-indigo">
                  {t("dashboard.urls.bibleOverlay", "Bible Overlay Dock")}
                </span>
                <p className="url-label-desc">
                  {t("dashboard.urls.bibleOverlayDesc", "Scripture presentation and Bible controls inside OBS")}
                </p>
              </div>
              <div className="url-input-group">
                <input
                  className="url-input input-indigo"
                  readOnly
                  value={overlayUrl}
                />
                <button
                  className="url-btn btn-indigo"
                  onClick={() => handleCopy("overlay", overlayUrl)}
                  title={t("dashboard.urls.copy", "Copy URL")}
                >
                  {copiedId === "overlay" ? (
                    <Check className="url-btn-icon" />
                  ) : (
                    <Copy className="url-btn-icon" />
                  )}
                  {copiedId === "overlay" ? t("dashboard.urls.copied", "Copied") : t("dashboard.urls.copy", "Copy URL")}
                </button>
              </div>
            </div>

            <div className="urls-group status-panel__url-block">
              <div className="url-label-block">
                <span className="url-label-text text-green">
                  {t("dashboard.urls.scriptureAssistant", "Scripture Assistant")}
                </span>
                <p className="url-label-desc">
                  {t("dashboard.urls.scriptureAssistantDesc", "Automatically detects and displays Bible references as the preacher speaks")}
                </p>
              </div>
              <div className="url-input-group">
                <input
                  className="url-input input-green"
                  readOnly
                  value={lmDockUrl}
                />
                <button
                  className="url-btn btn-green"
                  onClick={() => handleCopy("dock", lmDockUrl)}
                  title={t("dashboard.urls.copy", "Copy URL")}
                >
                  {copiedId === "dock" ? (
                    <Check className="url-btn-icon" />
                  ) : (
                    <Copy className="url-btn-icon" />
                  )}
                  {copiedId === "dock" ? t("dashboard.urls.copied", "Copied") : t("dashboard.urls.copy", "Copy URL")}
                </button>
              </div>
            </div>
          </div>

          {/* Step-by-step instructions */}
          <div className="urls-info-box">
            <div className="urls-info-header">
              <Info className="urls-info-icon" />
              <span className="urls-info-title">
                {obsConnected
                  ? t("dashboard.urls.obsConnectedInfo", "OBS is connected — this URL is ready to use")
                  : t("dashboard.urls.obsNotConnectedInfo", "Connect to OBS first, then add as Custom Browser Dock")}
              </span>
            </div>
            <ol className="urls-info-list">
              <li>{t("dashboard.urls.step1", "Open OBS Studio.")}</li>
              <li>{t("dashboard.urls.step2", "Go to Docks → Custom Browser Docks.")}</li>
              <li>{t("dashboard.urls.step3", "Enter a name for the dock (e.g. \"MakeChurchEazy\").")}</li>
              <li>{t("dashboard.urls.step4", "Paste the URL.")}</li>
              <li>{t("dashboard.urls.step5", "Click Apply.")}</li>
              <li>{t("dashboard.urls.step6", "The dock will appear inside OBS and can be moved, resized, or docked anywhere in the interface.")}</li>
            </ol>
            <div className="urls-info-footer">
              <AlertCircle className="urls-info-footer-icon" />
              <span>{t("dashboard.urls.warning", "These are OBS Dock URLs, not Browser Sources. Do not add them under Sources.")}</span>
            </div>
            {lanBase && (
              <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(255, 255, 255, 0.05)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 14, color: "var(--text-secondary, #d4d4d8)" }}>
                <span>
                  OBS on a <em>different laptop</em> on this Wi-Fi? Use: <strong style={{ color: "#ffffff" }}>{lanBase}/dock</strong>
                </span>
                <button
                  type="button"
                  style={{ background: "rgba(255, 255, 255, 0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", color: "#ffffff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  onClick={() => handleCopy("lan-overlay", `${lanBase}/dock`)}
                  title={t("dashboard.urls.copy", "Copy URL")}
                >
                  {copiedId === "lan-overlay" ? t("dashboard.urls.copied", "Copied") : t("dashboard.urls.copy", "Copy URL")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



// ── Monthly Usage Widget ────────────────────────────────────────────────────



// ── Remote Presentation Status ─────────────────────────────────────────────



// ── Feature Grid ───────────────────────────────────────────────────────────

interface FeatureGridProps {
  voiceBibleStatus: LmDockSnapshot["status"];
  voiceBibleConnected: boolean;
  translationCount: number;
  activeTranslation: string;
  songCount: number;
  recentSongCount: number;
  mediaCount: number;
  recentMediaCount: number;
  onNavigate: (path: string) => void;
}

function FeatureGrid({
  voiceBibleStatus,
  voiceBibleConnected,
  translationCount,
  activeTranslation,
  songCount,
  recentSongCount,
  mediaCount,
  recentMediaCount,
  onNavigate,
}: FeatureGridProps) {
  const { t } = useTranslation();

  return (
    <div className="dashboard-action-deck">
      {/* 1. Speech to Scripture */}
      <div
        className="dash-card dash-card--purple"
        onClick={() => {
          track("dashboard_card_clicked", { card: "voice-bible-transcribe" });
          onNavigate("/speech-to-scripture");
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onNavigate("/speech-to-scripture");
          }
        }}
      >
        <div className="dash-card__header">
          <div className="dash-card__icon-box dash-card__icon-box--purple">
            <Mic className="dash-card__icon" />
          </div>
          {voiceBibleStatus === "listening" ? (
            <span className="dash-card__badge dash-card__badge--live">
              <span className="dash-card__badge-pulse" />
              {t("dashboard.vb.listening", "LISTENING")}
            </span>
          ) : voiceBibleStatus === "connecting" ? (
            <span className="dash-card__badge dash-card__badge--purple">
              {t("dashboard.vb.connecting", "CONNECTING")}
            </span>
          ) : voiceBibleConnected ? (
            <span className="dash-card__badge dash-card__badge--purple">
              {t("dashboard.vb.ready", "Ready")}
            </span>
          ) : (
            <span className="dash-card__badge dash-card__badge--muted">
              {t("dashboard.vb.disconnected", "OFFLINE")}
            </span>
          )}
        </div>

        <div className="dash-card__body">
          <h3 className="dash-card__title">{t("dashboard.vb.title")}</h3>
          <p className="dash-card__subtitle">
            {voiceBibleStatus === "listening"
              ? "Transcribing service speech..."
              : voiceBibleConnected
              ? t("dashboard.vb.voiceReady")
              : t("dashboard.vb.notConnected")}
          </p>
        </div>

        <div className="dash-card__footer">
          <button
            type="button"
            className="dash-card__action-btn dash-card__action-btn--purple"
            onClick={(e) => {
              e.stopPropagation();
              track("dashboard_card_clicked", { card: "voice-bible-transcribe" });
              onNavigate("/speech-to-scripture");
            }}
            title="Go to Transcribe"
          >
            <Mic className="card-btn-icon" />
            <span>Go to Transcribe</span>
            <ChevronRight className="dash-card__arrow-icon" />
          </button>
        </div>
      </div>

      {/* 2. Scriptures / Bible */}
      <div
        className="dash-card dash-card--blue"
        onClick={() => {
          track("dashboard_card_clicked", { card: "bible" });
          onNavigate("/resources?tab=bible");
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            track("dashboard_card_clicked", { card: "bible" });
            onNavigate("/resources?tab=bible");
          }
        }}
      >
        <div className="dash-card__header">
          <div className="dash-card__icon-box dash-card__icon-box--blue">
            <BookOpen className="dash-card__icon" />
          </div>
          <span className="dash-card__badge dash-card__badge--blue">
            {activeTranslation || "KJV"} • {translationCount} Ver.
          </span>
        </div>

        <div className="dash-card__body">
          <h3 className="dash-card__title">{t("dashboard.bible.title")}</h3>
          <p className="dash-card__subtitle">
            {t("dashboard.bible.translationsInstalled", { count: translationCount })}
          </p>
        </div>

        <div className="dash-card__footer">
          <div className="dash-card__action-link dash-card__action-link--blue">
            <span>{t("dashboard.bible.open")}</span>
            <ChevronRight className="dash-card__arrow-icon" />
          </div>
        </div>
      </div>

      {/* 3. Worship */}
      <div
        className="dash-card dash-card--green"
        onClick={() => {
          track("dashboard_card_clicked", { card: "worship" });
          onNavigate("/resources?tab=worship");
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            track("dashboard_card_clicked", { card: "worship" });
            onNavigate("/resources?tab=worship");
          }
        }}
      >
        <div className="dash-card__header">
          <div className="dash-card__icon-box dash-card__icon-box--green">
            <Music className="dash-card__icon" />
          </div>
          <span className="dash-card__badge dash-card__badge--green">
            {t("dashboard.worship.songs", { count: songCount })}
          </span>
        </div>

        <div className="dash-card__body">
          <h3 className="dash-card__title">{t("dashboard.worship.title")}</h3>
          <p className="dash-card__subtitle">
            {recentSongCount > 0
              ? t("dashboard.worship.recentlyUsed", { count: recentSongCount })
              : "Hymns, modern songs & slides"}
          </p>
        </div>

        <div className="dash-card__footer">
          <div className="dash-card__action-link dash-card__action-link--green">
            <span>{t("dashboard.worship.open")}</span>
            <ChevronRight className="dash-card__arrow-icon" />
          </div>
        </div>
      </div>

      {/* 4. Media */}
      <div
        className="dash-card dash-card--orange"
        onClick={() => {
          track("dashboard_card_clicked", { card: "media" });
          onNavigate("/resources?tab=media");
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            track("dashboard_card_clicked", { card: "media" });
            onNavigate("/resources?tab=media");
          }
        }}
      >
        <div className="dash-card__header">
          <div className="dash-card__icon-box dash-card__icon-box--orange">
            <Images className="dash-card__icon" />
          </div>
          <span className="dash-card__badge dash-card__badge--orange">
            {t("dashboard.media.assets", { count: mediaCount })}
          </span>
        </div>

        <div className="dash-card__body">
          <h3 className="dash-card__title">{t("dashboard.media.title")}</h3>
          <p className="dash-card__subtitle">
            {recentMediaCount > 0
              ? t("dashboard.media.recentUploads", { count: recentMediaCount })
              : "Motion loops, stills & video"}
          </p>
        </div>

        <div className="dash-card__footer">
          <div className="dash-card__action-link dash-card__action-link--orange">
            <span>{t("dashboard.media.open")}</span>
            <ChevronRight className="dash-card__arrow-icon" />
          </div>
        </div>
      </div>
    </div>
  );
}



// ── Main Dashboard Component ───────────────────────────────────────────────

export default function ProductionHomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showMovePluginPrompt, setShowMovePluginPrompt] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const moveTransitionEnsureAttempt = useRef(false);

  // ── Who is signed in (greeting) ──
  const greetingName = useMemo(() => getGreetingName(user?.name), [user?.name]);

  // ── OBS ──
  const [obsStatus, setObsStatus] = useState<ConnectionStatus>(
    obsService.status,
  );

  // ── Dock ──
  const [dockAvailable, setDockAvailable] = useState(false);

  // ── Speech to Scripture ──
  const [voiceBible, setVoiceBible] = useState<LmDockSnapshot>({
    status: "idle",
    entries: [],
    candidates: [],
    queue: [],
    suggestions: [],
    matching: false,
    inputLevel: 0,
    detectionSpeed: "sharp",
  });

  // ── Bible ──
  const [translationCount, setTranslationCount] = useState(0);
  const [activeTranslation, setActiveTranslation] = useState("KJV");

  // ── Worship ──
  const [songCount, setSongCount] = useState(0);
  const [recentSongCount, setRecentSongCount] = useState(0);

  // ── Media ──
  const [mediaCount, setMediaCount] = useState(0);
  const [recentMediaCount, setRecentMediaCount] = useState(0);

  // ── Load initial data ──
  useEffect(() => {
    // OBS
    setObsStatus(obsService.status);

    // Dock availability (overlay server running)
    const checkDock = () => {
      try {
        const url = getOverlayBaseUrlSync();
        setDockAvailable(Boolean(url));
      } catch {
        setDockAvailable(false);
      }
    };
    checkDock();
    const dockInterval = setInterval(checkDock, 10_000);

    // Bible
    getInstalledTranslations()
      .then((list) => {
        setTranslationCount(list.length);
        if (list.length > 0) {
          getBibleSettings().then((settings) => {
            const active = list.find(
              (t) =>
                t.abbr.toUpperCase() ===
                settings.defaultTranslation.toUpperCase(),
            );
            setActiveTranslation(active?.abbr || list[0].abbr);
          });
        }
      })
      .catch(() => { });

    // Worship
    getAllSongs()
      .then((songs) => {
        setSongCount(songs.length);
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = songs.filter(
          (s) => new Date(s.updatedAt).getTime() > oneWeekAgo,
        );
        setRecentSongCount(recent.length);
      })
      .catch(() => { });

    // Media
    getAllMedia()
      .then((items) => {
        setMediaCount(items.length);
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = items.filter(
          (m) => new Date(m.createdAt).getTime() > oneWeekAgo,
        );
        setRecentMediaCount(recent.length);
      })
      .catch(() => { });

    return () => clearInterval(dockInterval);
  }, [user]);

  // Older installations and users who skipped onboarding still get the
  // bundled Move plugin offer from the dashboard.
  useEffect(() => {
    let active = true;
    getObsMovePluginStatus()
      .then(async (status) => {
        if (active && status.bundled && status.bridgeBundled && (!status.installed || !status.bridgeInstalled)) {
          setShowMovePluginPrompt(true);
        }
        if (active && status.installed && status.bridgeInstalled && obsService.isConnected) {
          const [moveLoaded, bridgeLoaded] = await Promise.all([
            isMovePluginLoaded(),
            isMceBridgeLoaded(),
          ]);
          if (moveLoaded && bridgeLoaded) {
            void ensureMoveTransition();
          }
        }
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  // Apply the bridge once after OBS becomes available. This keeps the setup
  // automatic without repeatedly replacing a transition during normal use.
  useEffect(() => {
    if (obsStatus !== "connected" || moveTransitionEnsureAttempt.current) return;
    moveTransitionEnsureAttempt.current = true;
    getObsMovePluginStatus()
      .then(async (status) => {
        if (status.installed && status.bridgeInstalled) {
          await ensureMoveTransition();
        }
      })
      .catch(() => { });
  }, [obsStatus]);

  // ── Subscribe to OBS status ──
  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsStatus(status);
    });
    return unsub;
  }, []);

  // ── Subscribe to Speech to Scripture state ──
  useEffect(() => {
    const unsub = lmDockService.subscribe((snapshot) => {
      setVoiceBible(snapshot);
    });
    return unsub;
  }, []);

  // ── Actions ──
  const handleNavigate = useCallback(
    (path: string) => {
      if (!confirmStopVoiceBibleForPresentation(path)) return;
      navigate(path);
    },
    [navigate],
  );

  const handleConnectObs = useCallback(async () => {
    try {
      await obsService.connect();
      setTimeout(() => {
        if (obsService.status !== "connected") {
          navigate("/settings?tab=obs");
        }
      }, 1500);
    } catch {
      navigate("/settings?tab=obs");
    }
  }, [navigate]);

  return (
    <div className="app-page__inner">
      <OnboardingResumeBanner />

      <DashboardGreeting
        userName={greetingName}
        obsConnected={obsStatus === "connected"}
        onWatchTutorials={() => navigate("/tutorials")}
      />

      <div className="studio-promo-row">
        <VerseAiPromoBanner onOpenVerseAi={() => handleNavigate("/speech-to-scripture")} />
        <StudioModePromoBanner half onOpenStudio={() => handleNavigate("/studio")} />
      </div>

      <DashboardObsDockStatus
        obsStatus={obsStatus}
        dockAvailable={dockAvailable}
        onConnectObs={handleConnectObs}
      />

      <div className="broadcast-promo-row">
        <MultiPlatformStreamingBanner
          onOpenBroadcast={() => navigate("/broadcast")}
          onHowItWorks={() => setShowHowItWorksModal(true)}
        />
        <BroadcastGraphicsPromoBanner
          onOpenGraphics={() => navigate("/broadcast-graphics")}
          onWatchTutorials={() => navigate("/tutorials")}
        />
      </div>

      <FeatureGrid
        voiceBibleStatus={voiceBible.status}
        voiceBibleConnected={voiceBible.status !== "error"}
        translationCount={translationCount}
        activeTranslation={activeTranslation}
        songCount={songCount}
        recentSongCount={recentSongCount}
        mediaCount={mediaCount}
        recentMediaCount={recentMediaCount}
        onNavigate={handleNavigate}
      />

      <BroadcastHowItWorksModal
        open={showHowItWorksModal}
        onClose={() => setShowHowItWorksModal(false)}
        onOpenUpgrade={() => navigate("/credits")}
      />

      {showMovePluginPrompt && (
        <MovePluginInstallModal onClose={() => setShowMovePluginPrompt(false)} />
      )}
    </div>
  );
}
