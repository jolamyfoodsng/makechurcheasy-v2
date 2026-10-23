/**
 * DashboardSidebar.tsx — Shared sidebar used across all pages.
 *
 * Extracted from ProductionHomePage so every route gets the same
 * navigation chrome: nav links, OBS/Dock status, user profile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminControls } from "../hooks/useAdminControls";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AppLogo } from "./AppLogo";
import SupportDialog from "./SupportDialog";
import {
  LayoutDashboard,
  Mic,
  Palette,
  Settings,
  BookOpen,
  Music,
  Images,
  FolderClosed,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LayoutGrid,
  Timer,
  Zap,
  HelpCircle,
  FileText,
  Radio,
  MonitorPlay,
  Layers, Lock, Star } from "./icons/NativeIcons";
import type { ConnectionStatus } from "../services/obsService";

import { useAuth } from "../contexts/AuthContext";
import { getEnvConfig } from "../services/envConfig";
import { getEffectivePlan } from "../services/licenseService";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import { OPEN_SUPPORT_DIALOG_EVENT } from "../services/supportDialog";

// ── Types ──────────────────────────────────────────────────────────────────

interface DashboardSidebarProps {
  currentPath: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (path: string) => void;
  /** @deprecated unused but kept for API compat */
  obsStatus?: ConnectionStatus;
  /** @deprecated unused but kept for API compat */
  dockAvailable?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DashboardSidebar({
  currentPath,
  collapsed,
  onToggleCollapse,
  onNavigate,
}: DashboardSidebarProps) {
  const { user, logout } = useAuth();
  // Free plan: a FREE badge by the logo, a lock on paid areas, and an upgrade card above the account.
  const isFreePlan = Boolean(user) && getEffectivePlan(user) === "free";
  const { t } = useTranslation();
  const { appName, isTest } = getEnvConfig();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const supportContent = useAdminControls().support;
  const [isResourcesOpen, setIsResourcesOpen] = useState(false);
  const [isTranscriptsOpen, setIsTranscriptsOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountRouteActive = currentPath.startsWith("/credits") || currentPath.startsWith("/settings");

  // The account menu closes on a click outside it, on Esc and when the page changes.
  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setIsAccountMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [currentPath]);

  // Other parts of the app (the top strip) open the Support window through this event.
  useEffect(() => {
    const open = () => setShowSupportModal(true);
    window.addEventListener(OPEN_SUPPORT_DIALOG_EVENT, open);
    return () => window.removeEventListener(OPEN_SUPPORT_DIALOG_EVENT, open);
  }, []);

  const accountMenuItem = (to: string, Icon: typeof Mic, label: string) => (
    <button
      type="button"
      role="menuitem"
      className={`sidebar-account-menu__item${currentPath.startsWith(to) ? " is-active" : ""}`}
      onClick={() => {
        setIsAccountMenuOpen(false);
        onNavigate(to);
      }}
    >
      <Icon className="sidebar-account-menu__icon" />
      <span>{label}</span>
    </button>
  );



  const navItem = useCallback(
    (to: string, Icon: typeof Mic, label: string, pulseDot = false, locked = false) => {
      const full = to.split("?")[0];
      const query = to.includes("?") ? to.split("?")[1] : "";
      const pathMatches =
        currentPath === full ||
        currentPath.startsWith(`${full}/`) ||
        currentPath.startsWith(`${full}?`);
      const isActive =
        to === "/"
          ? currentPath === "/"
          : pathMatches &&
          (query ? currentPath.includes(query) : !currentPath.includes("?"));
      return (
        <a
          key={to}
          className={isActive ? "sidebar-nav-item-active" : "sidebar-nav-item"}
          href="#"
          title={collapsed ? label : undefined}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(to);
          }}
          style={{ position: "relative" }}
        >
          <Icon className="sidebar-nav-icon" />
          <span className="sidebar-nav-text">{label}</span>
          {locked ? (
            <span
              className={`sidebar-nav-lock${collapsed ? " sidebar-nav-lock--collapsed" : ""}`}
              title="Paid feature: upgrade to unlock"
            >
              <Lock size={collapsed ? 9 : 11} aria-hidden="true" />
              {!collapsed && <span>Paid</span>}
            </span>
          ) : pulseDot && (
            collapsed ? (
              <span className="sidebar-live-dot sidebar-live-dot--collapsed" aria-hidden="true" />
            ) : (
              <span className="sidebar-nav-live-status">
                <span className="sidebar-live-dot" aria-hidden="true" />
                <span>Live</span>
              </span>
            )
          )}
        </a>
      );
    },
    [currentPath, onNavigate, collapsed],
  );

  useEffect(() => {
    if (currentPath.startsWith("/resources")) setIsResourcesOpen(true);
    if (currentPath.startsWith("/transcripts") || currentPath.startsWith("/speech-to-scripture")) {
      setIsTranscriptsOpen(true);
    }
    if (
      currentPath.startsWith("/broadcast-graphics") ||
      currentPath.startsWith("/production/themes") ||
      currentPath.startsWith("/countdowns") ||
      currentPath.startsWith("/gallery") ||
      currentPath.startsWith("/multiview")
    ) {
      setIsTemplatesOpen(true);
    }
  }, [currentPath]);

  const templatesLabel = t("sidebar.templatesGraphics", { defaultValue: "Templates & Graphics" });
  const templatesActive =
    currentPath.startsWith("/broadcast-graphics") ||
    currentPath.startsWith("/production/themes") ||
    currentPath.startsWith("/countdowns") ||
    currentPath.startsWith("/gallery") ||
    currentPath.startsWith("/multiview");

  return (
    <nav
      className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}
      aria-label={t("sidebar.navigation")}>
      <div className="sidebar-header">
        <AppLogo alt={appName} className="sidebar-logo" />
        <div className="sidebar-header-text">
          <p className="sidebar-subtitle">
            {appName}
            {isFreePlan && <span className="sidebar-plan-badge" title="You are on the Free plan">FREE</span>}
          </p>
          {isTest ? (
            <p className="sidebar-subtitle" style={{ color: "var(--warning)", marginTop: 2 }}>
              Testing environment
            </p>
          ) : null}
        </div>
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
          aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
        >
          {collapsed ? <PanelLeftOpen className="sidebar-toggle-icon" /> : <PanelLeftClose className="sidebar-toggle-icon" />}
        </button>
      </div>

      <div className="sidebar-section">
        <p className="sidebar-label">{t("sidebar.navigation")}</p>
        <div className="sidebar-nav-list">
          {navItem("/", LayoutDashboard, t("sidebar.dashboard"))}

          {/* Transcripts & Verse AI collapsible parent item */}
          <div
            className={`sidebar-nav-item sidebar-nav-parent${currentPath.startsWith("/transcripts") || currentPath.startsWith("/speech-to-scripture") ? " sidebar-nav-item-active" : ""}`}
            title={collapsed ? t("sidebar.transcripts", { defaultValue: "Transcripts" }) : undefined}
            onClick={collapsed ? (e) => {
              e.preventDefault();
              onNavigate("/speech-to-scripture");
            } : undefined}
          >
            <a
              className="sidebar-nav-parent-link"
              href="#"
              title={collapsed ? t("sidebar.transcripts", { defaultValue: "Transcripts" }) : undefined}
              onClick={(e) => {
                e.preventDefault();
                onNavigate("/speech-to-scripture");
              }}
            >
              <FileText className="sidebar-nav-icon" />
              <span className="sidebar-nav-text">{t("sidebar.transcripts", { defaultValue: "Transcripts" })}</span>
            </a>
            {!collapsed && (
              <button
                type="button"
                className={`sidebar-nav-chevron-btn${isTranscriptsOpen ? " sidebar-nav-chevron-btn--open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsTranscriptsOpen((prev) => !prev);
                }}
                title={isTranscriptsOpen ? "Collapse Transcripts" : "Expand Transcripts"}
                aria-label={isTranscriptsOpen ? "Collapse Transcripts" : "Expand Transcripts"}
              >
                <ChevronDown className="sidebar-nav-chevron" />
              </button>
            )}
          </div>

          {/* Subchildren under Transcripts (only visible when sidebar is expanded) */}
          {!collapsed && isTranscriptsOpen && (
            <div className="sidebar-subnav-list">
              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/speech-to-scripture") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title="Verse AI (Live Detection)"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/speech-to-scripture");
                }}
              >
                <Mic className="sidebar-subnav-icon" />
                <span>Verse AI</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/transcripts") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title="All Transcripts Library"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/transcripts");
                }}
              >
                <FileText className="sidebar-subnav-icon" />
                <span>All Transcripts</span>
              </a>
            </div>
          )}

          {/* Resources collapsible parent item */}
          <div
            className={`sidebar-nav-item sidebar-nav-parent${currentPath.startsWith("/resources") ? " sidebar-nav-item-active" : ""}`}
            title={collapsed ? t("sidebar.resources", { defaultValue: "Resources" }) : undefined}
            onClick={collapsed ? (e) => {
              e.preventDefault();
              onNavigate("/resources?tab=bible");
            } : undefined}
          >
            <a
              className="sidebar-nav-parent-link"
              href="#"
              title={collapsed ? t("sidebar.resources", { defaultValue: "Resources" }) : undefined}
              onClick={(e) => {
                e.preventDefault();
                onNavigate("/resources?tab=bible");
              }}
            >
              {isResourcesOpen && !collapsed ? (
                <FolderOpen className="sidebar-nav-icon" />
              ) : (
                <FolderClosed className="sidebar-nav-icon" />
              )}
              <span className="sidebar-nav-text">{t("sidebar.resources", { defaultValue: "Resources" })}</span>
            </a>
            {!collapsed && (
              <button
                type="button"
                className={`sidebar-nav-chevron-btn${isResourcesOpen ? " sidebar-nav-chevron-btn--open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsResourcesOpen((prev) => !prev);
                }}
                title={isResourcesOpen ? "Collapse Resources" : "Expand Resources"}
                aria-label={isResourcesOpen ? "Collapse Resources" : "Expand Resources"}
              >
                <ChevronDown className="sidebar-nav-chevron" />
              </button>
            )}
          </div>

          {/* Subchildren under Resources (only visible when sidebar is expanded) */}
          {!collapsed && isResourcesOpen && (
            <div className="sidebar-subnav-list">
              <a
                className={`sidebar-subnav-item${currentPath.includes("tab=bible") || currentPath === "/resources" ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.bible", { defaultValue: "Bible" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/resources?tab=bible");
                }}
              >
                <BookOpen className="sidebar-subnav-icon" />
                <span>{t("sidebar.bible", { defaultValue: "Bible" })}</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.includes("tab=worship") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.worship", { defaultValue: "Worship Songs" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/resources?tab=worship");
                }}
              >
                <Music className="sidebar-subnav-icon" />
                <span>{t("sidebar.worship", { defaultValue: "Worship Songs" })}</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.includes("tab=media") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.media", { defaultValue: "Media" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/resources?tab=media");
                }}
              >
                <Images className="sidebar-subnav-icon" />
                <span>{t("sidebar.media", { defaultValue: "Media" })}</span>
              </a>
            </div>
          )}

          {/* OBS and screen visuals grouped in one compact section */}
          <div
            className={`sidebar-nav-item sidebar-nav-parent${templatesActive ? " sidebar-nav-item-active" : ""}`}
          >
            <a
              className="sidebar-nav-parent-link"
              href="#"
              title={collapsed ? templatesLabel : undefined}
              onClick={(e) => {
                e.preventDefault();
                onNavigate("/broadcast-graphics");
              }}
            >
              <Layers className="sidebar-nav-icon" />
              <span className="sidebar-nav-text">{templatesLabel}</span>
            </a>
            {!collapsed && (
              <button
                type="button"
                className={`sidebar-nav-chevron-btn${isTemplatesOpen ? " sidebar-nav-chevron-btn--open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsTemplatesOpen((prev) => !prev);
                }}
                title={isTemplatesOpen ? `Collapse ${templatesLabel}` : `Expand ${templatesLabel}`}
                aria-label={isTemplatesOpen ? `Collapse ${templatesLabel}` : `Expand ${templatesLabel}`}
                aria-expanded={isTemplatesOpen}
                aria-controls={isTemplatesOpen ? "sidebar-templates-subnav" : undefined}
              >
                <ChevronDown className="sidebar-nav-chevron" />
              </button>
            )}
          </div>

          {!collapsed && isTemplatesOpen && (
            <div className="sidebar-subnav-list" id="sidebar-templates-subnav">
              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/broadcast-graphics") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.broadcastGraphics", { defaultValue: "Broadcast Graphics" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/broadcast-graphics");
                }}
              >
                <MonitorPlay className="sidebar-subnav-icon" />
                <span>{t("sidebar.broadcastGraphics", { defaultValue: "Broadcast Graphics" })}</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/gallery") || currentPath.startsWith("/multiview") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.multiView", { defaultValue: "Multi View" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/gallery");
                }}
              >
                <LayoutGrid className="sidebar-subnav-icon" />
                <span>{t("sidebar.multiView", { defaultValue: "Multi View" })}</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/production/themes") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.themes", { defaultValue: "Themes" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/production/themes");
                }}
              >
                <Palette className="sidebar-subnav-icon" />
                <span>{t("sidebar.themes", { defaultValue: "Themes" })}</span>
              </a>

              <a
                className={`sidebar-subnav-item${currentPath.startsWith("/countdowns") ? " sidebar-subnav-item-active" : ""}`}
                href="#"
                title={t("sidebar.countdowns", { defaultValue: "Countdowns & Timers" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("/countdowns");
                }}
              >
                <Timer className="sidebar-subnav-icon" />
                <span>{t("sidebar.countdowns", { defaultValue: "Countdowns & Timers" })}</span>
              </a>
            </div>
          )}

          {navItem("/broadcast", Radio, t("sidebar.multiStream", { defaultValue: "Multi-Stream" }), !isFreePlan, isFreePlan)}
          {navItem("/studio", MonitorPlay, t("sidebar.studio", { defaultValue: "Studio" }))}
        </div>
      </div>

      <div className="sidebar-section-bottom">
        {isFreePlan && !collapsed && (
          <div className="sidebar-free-card">
            <div className="sidebar-free-card__head">
              <Star size={14} aria-hidden="true" />
              <span>You&apos;re on the Free plan</span>
            </div>
            <p className="sidebar-free-card__text">One stream channel, limited themes, graphics and Verse AI minutes.</p>
            <button
              type="button"
              className="sidebar-free-card__cta"
              onClick={() => void openDashboardSubscriptionPlans({ source: "sidebar-free-card" })}
            >
              Upgrade
            </button>
          </div>
        )}

        {/* Account: the profile opens a menu with Credits, Settings, Support and Sign out */}
        {user && (
          <div className="sidebar-user-section" ref={accountMenuRef}>
            {isAccountMenuOpen && (
              <div className="sidebar-account-menu" role="menu" aria-label={user.name || "Account"}>
                {accountMenuItem("/credits", Zap, t("sidebar.credits", { defaultValue: "Credits" }))}
                {accountMenuItem("/settings", Settings, t("sidebar.settings"))}
                <button
                  type="button"
                  role="menuitem"
                  className="sidebar-account-menu__item"
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    setShowSupportModal(true);
                  }}
                >
                  <HelpCircle className="sidebar-account-menu__icon" />
                  <span>{t("sidebar.support", { defaultValue: "Support" })}</span>
                  {supportContent.status.online && (
                    <span className="sidebar-account-menu__live" title={supportContent.status.text || "Live support available"} aria-hidden="true" />
                  )}
                </button>
                <div className="sidebar-account-menu__divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="sidebar-account-menu__item"
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    setShowLogoutConfirm(true);
                  }}
                >
                  <LogOut className="sidebar-account-menu__icon" />
                  <span>{t("sidebar.signOut")}</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className={`sidebar-user-button${isAccountMenuOpen || accountRouteActive ? " sidebar-user-button--active" : ""}`}
              onClick={() => setIsAccountMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen}
              title={collapsed ? user.name || user.email : undefined}
            >
              <span className="sidebar-user-avatar">
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="sidebar-user-avatar-img" />
                ) : (
                  <span>{user.name?.[0]?.toUpperCase() || "U"}</span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="sidebar-user-details">
                    <span className="sidebar-user-name">{user.name}</span>
                    <span className="sidebar-user-email">{user.email}</span>
                  </span>
                  <ChevronUp className="sidebar-user-chevron" />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {showLogoutConfirm && typeof document !== "undefined" && createPortal(
        <div
          className="end-confirm-backdrop"
          onClick={() => setShowLogoutConfirm(false)}
          onKeyDown={(event) => { if (event.key === "Escape") setShowLogoutConfirm(false); }}>
          <div
            className="end-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sidebar-signout-confirm-title"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="sidebar-signout-confirm-title">{t("sidebar.signOutConfirm")}</h2>
            <p>{t("sidebar.signOutDesc")}</p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                autoFocus
                onClick={() => setShowLogoutConfirm(false)}
                title={t("sidebar.cancel")}>
                {t("sidebar.cancel")}
              </button>
              <button
                className="end-confirm-btn-end"
                onClick={() => { setShowLogoutConfirm(false); logout(); }}
                title={t("sidebar.signOut")}>
                {t("sidebar.signOut")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showSupportModal && <SupportDialog content={supportContent} onClose={() => setShowSupportModal(false)} />}
    </nav>
  );
}
