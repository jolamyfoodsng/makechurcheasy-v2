/**
 * AppShell.tsx — Top-level navigation shell
 *
 * Wraps all non-editor routes with the shared DashboardSidebar and content area.
 * Full-screen routes (editor, multiview, standalone bible) bypass the shell.
 *
 * When a service is active (preservice), the normal
 * nav tabs are hidden and replaced with a service-mode bar:
 *   Logo circle + Cancel + End Service
 */

import { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { obsService } from "./services/obsService";
import { serviceStore } from "./services/serviceStore";
import {
  SHORTCUTS,
  SHORTCUT_MAP,
  matchesShortcut,
  shortcutLabel,
  type ShortcutCategory,
} from "./multiview/shortcuts";
import { useServiceStore } from "./hooks/useServiceStore";
import { ServiceCompletedModal } from "./components/ServiceCompletedModal";
import BibleCommandPalette from "./components/BibleCommandPalette";
import { BibleProvider } from "./bible/bibleStore";
import SettingsModalSlot from "./components/SettingsModalSlot";
import { ensureSavedBroadcastGraphicsLoaded } from "./services/broadcastGraphicsStorage";
import Icon from "./components/Icon";
import DashboardSidebar from "./components/DashboardSidebar";
import AppStatusStrip from "./components/AppStatusStrip";
import LiveStatusBar from "./components/LiveStatusBar";
import VoiceBibleResumeBanner from "./components/VoiceBibleResumeBanner";
import EasyWorshipAnnouncementBanner from "./components/EasyWorshipAnnouncementBanner";
import TrialUnavailableBanner from "./components/TrialUnavailableBanner";
import CloudBackupPrompts from "./components/CloudBackupPrompts";
import { getOverlayBaseUrlSync } from "./services/overlayUrl";
import { confirmStopVoiceBibleForPresentation } from "./services/voiceBiblePresentationGuard";
import { safeTauriListen } from "./services/tauriSafe";
import { isSearchKeyboardShortcut, triggerTabSearchInput } from "./utils/searchShortcut";
import type { ConnectionStatus } from "./services/obsService";


export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const svc = useServiceStore();

  const isServiceEnded = svc.status === "ended";
  const isTranscriptDetailRoute = /^\/transcripts\/[^/]+\/?$/.test(location.pathname);
  const isSettingsRoute = /^\/settings(?:\/.*)?$/.test(location.pathname);
  const isFixedViewportRoute = isTranscriptDetailRoute || location.pathname === "/speech-to-scripture" || location.pathname === "/countdowns" || location.pathname === "/studio" || isSettingsRoute;

  // ── Sidebar ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const [obsStatus, setObsStatus] = useState<ConnectionStatus>(obsService.status);
  const [dockAvailable, setDockAvailable] = useState(false);

  // ── End-service confirmation modal ──
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // ── Shortcuts modal ──
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Command Palette ──
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  type ShortcutsTab = "dashboard" | "bible" | "graphics";
  const SHORTCUTS_TABS: { key: ShortcutsTab; label: string; icon: string; categories: ShortcutCategory[] }[] = [
    { key: "dashboard", label: t("appShell.shortcutsTab.dashboard"), icon: "dashboard", categories: ["navigation", "file", "edit", "selection", "view", "canvas", "slots", "alignment"] },
    { key: "bible", label: t("appShell.shortcutsTab.bible"), icon: "menu_book", categories: ["bible"] },
    { key: "graphics", label: t("appShell.shortcutsTab.graphics"), icon: "palette", categories: ["quickmerge", "worship"] },
  ];
  const [shortcutsTab, setShortcutsTab] = useState<ShortcutsTab>("dashboard");

  // Open Settings from the conventional app shortcut on both platforms:
  // Cmd+, on macOS and Ctrl+, on Windows/Linux. This lives in the shared
  // shell so it works from every normal app page, not only the editor.
  useEffect(() => {
    const shortcut = SHORTCUT_MAP.get("open-settings")?.keys;
    if (!shortcut) return;

    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      navigate("/settings");
    };

    window.addEventListener("keydown", handleSettingsShortcut);
    return () => window.removeEventListener("keydown", handleSettingsShortcut);
  }, [navigate]);

  // Focus Search in the current tab/page from the conventional app shortcut:
  // Cmd+F on macOS and Ctrl+F on Windows/Linux.
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!isSearchKeyboardShortcut(event)) return;

      event.preventDefault();
      event.stopPropagation();

      const found = triggerTabSearchInput();
      if (!found) {
        setShowCommandPalette(true);
      }
    };

    window.addEventListener("keydown", handleSearchShortcut, true);
    return () => window.removeEventListener("keydown", handleSearchShortcut, true);
  }, []);

  // The native tray menu uses the same navigation path as the keyboard
  // shortcut. This listener is a no-op in browser/dock contexts.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void safeTauriListen("open-settings", () => {
      if (!cancelled) navigate("/settings");
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    }).catch(() => {
      // Tauri events are unavailable when running the web app directly.
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);

  // ── Command Palette handlers ──
  const handleCommandPaletteSelectBibleVerse = useCallback((book: string, chapter: number, verse: number) => {
    navigate(`/resources?tab=bible&book=${encodeURIComponent(book)}&chapter=${chapter}&verse=${verse}`);
    setShowCommandPalette(false);
  }, [navigate]);

  const handleCommandPaletteSelectTemplate = useCallback((templateKind: "bible" | "lower-third", themeId: string) => {
    navigate(`/production/themes?templateKind=${templateKind}&themeId=${encodeURIComponent(themeId)}`);
    setShowCommandPalette(false);
  }, [navigate]);

  // ── Load settings + subscribe to services ──
  useEffect(() => {
    setObsStatus(obsService.status);

    const unsubObs = obsService.onStatusChange((status) => {
      setObsStatus(status);
    });

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

    return () => {
      unsubObs();
      clearInterval(dockInterval);
    };
  }, []);

  const handleNav = useCallback(
    (path: string) => {
      if (!confirmStopVoiceBibleForPresentation(path)) return;
      navigate(path);
    },
    [navigate],
  );

  // Full-screen routes (no sidebar): editor, new layout, standalone bible, multiview shell, Studio (it has its own Back button)
  const isEditorRoute =
    location.pathname.startsWith("/edit/") ||
    location.pathname.startsWith("/multiview") ||
    location.pathname.startsWith("/bible") ||
    location.pathname.startsWith("/hub") ||
    location.pathname.startsWith("/service-hub") ||
    location.pathname === "/studio" ||
    location.pathname === "/new";

  // ── Cancel confirmation modal ──
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleConfirmCancel = useCallback(() => {
    setShowCancelConfirm(false);
    serviceStore.reset();
    navigate("/");
  }, [navigate]);

  // Saved Broadcast Graphics live in a file in the app folder; read them once at start so every screen (Studio included) sees them.
  useEffect(() => {
    void ensureSavedBroadcastGraphicsLoaded();
  }, []);

  const handleEndServiceConfirm = useCallback(() => {
    serviceStore.endService();
    setShowEndConfirm(false);
  }, []);

  const handleStartNew = useCallback(() => {
    serviceStore.reset();
    navigate("/");
  }, [navigate]);

  const handleReturnDashboard = useCallback(() => {
    serviceStore.reset();
    navigate("/");
  }, [navigate]);

  if (isEditorRoute) {
    return (
      <>
        <Outlet />
        <BibleProvider>
          <SettingsModalSlot />
        </BibleProvider>
      </>
    );
  }

  return (
    <BibleProvider>
      <div className="app-container">
      <a className="mce-skip-link" href="#app-main-content">
        {t("mvShell.skipToContent")}
      </a>
      <DashboardSidebar
        currentPath={location.pathname + location.search}
        obsStatus={obsStatus}
        dockAvailable={dockAvailable}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onNavigate={handleNav}
      />

      <main
        id="app-main-content"
        tabIndex={-1}
        className={`app-main${sidebarCollapsed ? " app-main--collapsed" : ""}${isTranscriptDetailRoute ? " app-main--transcript-detail" : ""}${isFixedViewportRoute ? " app-main--fixed-viewport" : ""}`}>
        <AppStatusStrip />
        <LiveStatusBar />
        <EasyWorshipAnnouncementBanner />
        <TrialUnavailableBanner />
        <CloudBackupPrompts />
        <div className="app-glow" />
        <div className={`app-content${isTranscriptDetailRoute ? " app-content--transcript-detail" : ""}${isFixedViewportRoute ? " app-content--fixed-viewport" : ""}`}>
          <VoiceBibleResumeBanner />
          <Outlet />
        </div>
      </main>

      {/* ── End Service Confirmation ── */}
      {showEndConfirm && (
        <div className="end-confirm-backdrop" onClick={() => setShowEndConfirm(false)}>
          <div
            className="end-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-service-confirm-title"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="end-service-confirm-title">{t("appShell.endService.title")}</h2>
            <p>{t("appShell.endService.description")}</p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                onClick={() => setShowEndConfirm(false)}
                title={t("appShell.endService.keepGoing")}>
                {t("appShell.endService.keepGoing")}
              </button>
              <button className="end-confirm-btn-end" onClick={handleEndServiceConfirm} title={t("appShell.endService.confirm")}>
                {t("appShell.endService.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Service Confirmation ── */}
      {showCancelConfirm && (
        <div className="end-confirm-backdrop" onClick={() => setShowCancelConfirm(false)}>
          <div
            className="end-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-service-confirm-title"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="cancel-service-confirm-title">{t("appShell.cancelService.title")}</h2>
            <p>{t("appShell.cancelService.description")}</p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                onClick={() => setShowCancelConfirm(false)}
                title={t("appShell.cancelService.keepGoing")}>
                {t("appShell.cancelService.keepGoing")}
              </button>
              <button className="end-confirm-btn-end" onClick={handleConfirmCancel} title={t("appShell.cancelService.confirm")}>
                {t("appShell.cancelService.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Service Completed Modal ── */}
      <ServiceCompletedModal
        open={isServiceEnded}
        duration=""
        bibleVerses={svc.stats.bibleVersesDisplayed}
        songsPlayed={svc.stats.songsPlayed}
        lowerThirds={svc.stats.lowerThirdsShown}
        onStartNew={handleStartNew}
        onDashboard={handleReturnDashboard}
      />

      {/* ── Keyboard Shortcuts Modal (Tabbed) ── */}
      {showShortcuts && (
        <div className="end-confirm-backdrop" onClick={() => setShowShortcuts(false)}>
          <div
            className="shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-shortcuts-title"
            onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-head">
              <h2 id="app-shortcuts-title">{t("appShell.keyboardShortcuts.title")}</h2>
              <button type="button" className="shortcuts-modal-close" onClick={() => setShowShortcuts(false)} title={t("appShell.keyboardShortcuts.close")} aria-label={t("appShell.keyboardShortcuts.close")}>
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="shortcuts-modal-tabs" role="tablist" aria-label={t("appShell.keyboardShortcuts.title")}>
              {SHORTCUTS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={shortcutsTab === tab.key}
                  className={`shortcuts-modal-tab${shortcutsTab === tab.key ? " is-active" : ""}`}
                  onClick={() => setShortcutsTab(tab.key)}
                >
                  <Icon name={tab.icon} size={14} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            <div className="shortcuts-modal-body">
              {(() => {
                const activeTab = SHORTCUTS_TABS.find((t) => t.key === shortcutsTab)!;
                return activeTab.categories.map((cat) => {
                  const items = SHORTCUTS.filter((s) => s.category === cat && !s.editorOnly);
                  if (items.length === 0) return null;
                  return (
                    <div className="shortcuts-modal-section" key={cat}>
                      <h4>{
                        cat === "navigation" ? t("appShell.shortcutsCategory.navigation") :
                          cat === "file" ? t("appShell.shortcutsCategory.file") :
                            cat === "edit" ? t("appShell.shortcutsCategory.edit") :
                              cat === "selection" ? t("appShell.shortcutsCategory.selection") :
                                cat === "view" ? t("appShell.shortcutsCategory.viewZoom") :
                                  cat === "canvas" ? t("appShell.shortcutsCategory.canvasGrid") :
                                    cat === "slots" ? t("appShell.shortcutsCategory.slots") :
                                      cat === "alignment" ? t("appShell.shortcutsCategory.alignment") :
                                        cat === "bible" ? t("appShell.shortcutsCategory.bible") :
                                          cat === "quickmerge" ? t("appShell.shortcutsCategory.quickMerge") :
                                            cat === "worship" ? t("appShell.shortcutsCategory.speaker") : cat
                      }</h4>
                      {items.map((s) => (
                        <div className="shortcuts-modal-row" key={s.id}>
                          <span>{s.label}</span>
                          <kbd>{shortcutLabel(s.keys)}</kbd>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

        <SettingsModalSlot />

        {/* ── Global Command Palette ── */}
        <BibleCommandPalette
          open={showCommandPalette}
          initialQuery=""
          onClose={() => setShowCommandPalette(false)}
          onSelectBibleVerse={handleCommandPaletteSelectBibleVerse}
          onSelectTemplate={handleCommandPaletteSelectTemplate}
          onNavigate={navigate}
        />
      </div>
    </BibleProvider>
  );
}
