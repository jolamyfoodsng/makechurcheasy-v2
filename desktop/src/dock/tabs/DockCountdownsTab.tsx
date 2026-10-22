/**
 * DockCountdownsTab.tsx — Dock panel: the countdown designs saved in the app (layer designs and
 * classic ones) plus 3 ready-made defaults. Each card has a live preview and Push & Start controls.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "../../components/icons/NativeIcons";
import { dockObsClient } from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import Icon from "../DockIcon";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import { useDockSceneRoute } from "../dockSceneRouting";
import type { CountdownConfig, BackgroundSettings, BackgroundType, ImageFit, MessageSettings, OBSSettings, OverlaySyncState, CountdownOverlayPayload } from "../../countdowns/types";
// countdownDefaults removed — editBg initialized inline
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import ThemeLayoutPreview from "../../themes/layout/ThemeLayoutPreview";
import { createLayoutCountdown } from "../../countdowns/countdownDefaults";
import { attachLayoutMode, isLayoutDesign } from "../../countdowns/layoutMode";
import { buildCountdownContent } from "../../countdowns/countdownTime";
import { getTextTheme, loadTextThemeFont } from "../../countdowns/textThemes";
import { validateMediaFile, backgroundFileAccept } from "../../countdowns/mediaValidation";
import { saveCountdownAsset, deleteCountdownAsset } from "../../countdowns/countdownStore";
import type { MediaItem } from "../../library/libraryTypes";
import { trackOutputShown } from "../../services/tracking";
import {
  DOCK_COUNTDOWN_BG_SOURCE_NAME,
  DOCK_PRESENTATION_SCENE_NAME,
  DOCK_COUNTDOWN_SOURCE_NAME,
  resolveCountdownTargetScene,
} from "./dockCountdownScene";
import {
  clearPresentationScreen,
  publishCountdownToPresentation,
} from "../../services/presentationPublish";

// ── Hardcoded countdowns ───────────────────────────────────────────────────

/** A ready-made layer design with a fixed id (so a live countdown survives a reload). */
function makeDesignCountdown(title: string, subtitle: string, minutes: number, presetId: string, yellow: number, red: number): CountdownConfig {
  const base = createLayoutCountdown(presetId, `hardcoded-${title.toLowerCase().replace(/\s+/g, "-")}`);
  const seconds = minutes * 60;
  return {
    ...base,
    title,
    timer: { ...base.timer, durationSeconds: seconds, showHours: seconds >= 3600 },
    text: { ...base.text, title, subtitle },
    warnYellowSeconds: yellow,
    warnRedSeconds: red,
  };
}

export const HARDCODED_COUNTDOWNS: CountdownConfig[] = [
  makeDesignCountdown("Pre-Service", "", 15, "minimal-black", 120, 30),
  makeDesignCountdown("Worship Set", "Starting in", 5, "brush-circle", 60, 15),
  makeDesignCountdown("Sermon Start", "Until the message", 10, "segment-coral", 60, 15),
];

/** Saved designs from the app, written to /uploads/dock-countdowns.json by countdownStore. */
async function loadSavedDesigns(): Promise<CountdownConfig[] | null> {
  try {
    const res = await fetch(`/uploads/dock-countdowns.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { countdowns?: CountdownConfig[] };
    return Array.isArray(data.countdowns) ? data.countdowns : null;
  } catch {
    return null;
  }
}

// ── Live persist helpers ───────────────────────────────────────────────────

interface LivePersistState {
  id: string;
  remaining: number;
  running: boolean;
  savedAt: number;
}

const LIVE_STATE_KEY = "mce-dock-countdown-live";

function readLivePersistState(): LivePersistState | null {
  try {
    const raw = localStorage.getItem(LIVE_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeLivePersistState(state: LivePersistState | null): void {
  try {
    if (state) localStorage.setItem(LIVE_STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(LIVE_STATE_KEY);
  } catch { /* ignore */ }
}

// ── Countdown timer hook ───────────────────────────────────────────────────

function useCountdownTimer(cd: CountdownConfig | null) {
  const [remaining, setRemaining] = useState(cd?.timer.durationSeconds ?? 0);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cdRef = useRef(cd);

  useEffect(() => {
    cdRef.current = cd;
    if (cd) {
      setRemaining(cd.timer.durationSeconds);
      setIsComplete(false);
    }
  }, [cd?.id]);

  const start = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(true);
    setIsComplete(false);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsRunning(false);
          setIsComplete(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    return remaining;
  }, [remaining]);

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setIsComplete(false);
    setRemaining(cdRef.current?.timer.durationSeconds ?? 0);
  }, []);

  const adjustTime = useCallback((delta: number) => {
    setRemaining((prev) => Math.max(0, prev + delta));
  }, []);

  const setRemainingDirect = useCallback((secs: number) => {
    setRemaining(Math.max(0, secs));
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const formatted = (() => {
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = Math.floor(remaining % 60);
    if (cd?.timer.showHours) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  })();

  return { remaining, isRunning, isComplete, formatted, start, pause, reset, adjustTime, setRemainingDirect };
}

// ── Live preview thumbnail for layer designs ───────────────────────────────

function DesignThumb({ cd, seconds }: { cd: CountdownConfig & { layout: NonNullable<CountdownConfig["layout"]> }; seconds: number }) {
  const content = useMemo(
    () =>
      buildCountdownContent({
        kind: "countdown",
        value: seconds,
        durationSeconds: cd.timer.durationSeconds,
        warnYellowSeconds: cd.warnYellowSeconds ?? 0,
        warnRedSeconds: cd.warnRedSeconds ?? 0,
        title: cd.text.title,
        subtitle: cd.text.subtitle,
        name: cd.text.title,
      }),
    [seconds, cd.timer.durationSeconds, cd.warnYellowSeconds, cd.warnRedSeconds, cd.text.title, cd.text.subtitle],
  );
  return (
    <div style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 6, overflow: "hidden", background: "#000", position: "relative", marginBottom: 2 }}>
      <ThemeLayoutPreview layout={cd.layout} content={content} />
    </div>
  );
}

// ── Simplified Countdown Card ──────────────────────────────────────────────

function CountdownCard({
  cd,
  isLive,
  isPaused,
  formattedTime,
  previewSeconds,
  obsScenes,
  onSelect,
  onAdjustTime,
  onSetTime,
  onSetTitle,
  onShowObs,
  onPause,
  onResume,
  onStop,
  onEdit,
  onReset,
  onUpdateObs,
  isCompact = false,
}: {
  cd: CountdownConfig;
  isLive: boolean;
  isPaused: boolean;
  formattedTime: string;
  previewSeconds: number;
  obsScenes: string[];
  onSelect: () => void;
  onAdjustTime: (deltaSeconds: number) => void;
  onSetTime: (seconds: number) => void;
  onSetTitle: (title: string) => void;
  onShowObs: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onEdit: () => void;
  onReset: () => void;
  onUpdateObs: (patch: Partial<OBSSettings>) => void;
  isCompact?: boolean;
}) {
  const { t } = useTranslation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(cd.title);
  const [editingTime, setEditingTime] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAutoSwitch, setShowAutoSwitch] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Editing a live countdown could change what is already on screen.
  // Keep the card controls read-only until the countdown is stopped.
  useEffect(() => {
    if (!isLive) return;
    setEditingTitle(false);
    setEditingTime(false);
    setMenuOpen(false);
  }, [isLive]);

  // Theme-aware timer display
  const theme = cd.textThemeId ? getTextTheme(cd.textThemeId) : null;
  if (theme) loadTextThemeFont(theme);
  const timerFont = theme ? theme.fontFamily : "monospace";
  const timerWeight = theme ? theme.fontWeight : 700;
  const timerColor = "var(--dock-text, #F8FAFC)";
  const timerShadow = theme ? theme.timerShadow : "none";

  const startTitleEdit = () => {
    if (isLive) return;
    setEditTitleValue(cd.title);
    setEditingTitle(true);
  };

  const commitTitleEdit = () => {
    const nextTitle = editTitleValue.trim();
    if (nextTitle) onSetTitle(nextTitle);
    setEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setEditTitleValue(cd.title);
    setEditingTitle(false);
  };

  const parseTimeInput = (value: string): number => {
    const parts = value.split(":").map((part) => Number.parseInt(part.trim(), 10));
    if (parts.some((part) => Number.isNaN(part))) return 0;
    if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
    return Math.max(0, parts[0] || 0);
  };

  const commitTimeEdit = () => {
    onSetTime(parseTimeInput(editValue));
    setEditingTime(false);
  };

  const cancelTimeEdit = () => {
    setEditValue(formattedTime);
    setEditingTime(false);
  };

  return (
    <div
      onClick={onSelect}
      style={{
        borderRadius: isCompact ? 7 : 10,
        border: `1px solid ${isLive ? "rgba(34,197,94,0.5)" : "var(--dock-border, rgba(255,255,255,0.08))"}`,
        background: isLive ? "rgba(34,197,94,0.06)" : "var(--dock-surface, rgba(255,255,255,0.04))",
        cursor: "pointer",
        transition: "all 0.15s",
        padding: isCompact ? "6px 8px" : 12,
        display: "flex",
        flexDirection: "column",
        gap: isCompact ? 3 : 4,
      }}
    >
      {isLayoutDesign(cd) && !isCompact && <DesignThumb cd={cd} seconds={previewSeconds} />}

      {/* Title + edit cue + Live badge + three-dot menu */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, overflow: "visible" }}>
          {editingTitle ? (
            <>
              <input
                autoFocus
                type="text"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commitTitleEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelTitleEdit();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={t("countdowns.editTitle", "Countdown title")}
                style={{ flex: "1 1 120px", minWidth: 0, maxWidth: 170, height: 24, boxSizing: "border-box", background: "var(--dock-input-bg, rgba(0,0,0,0.3))", border: "1px solid var(--dock-accent, #3b82f6)", borderRadius: 5, padding: "3px 7px", color: "var(--dock-text)", fontSize: 11, outline: "none", textOverflow: "ellipsis" }}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); commitTitleEdit(); }}
                title={t("common.save", "Save")}
                aria-label={t("common.save", "Save")}
                style={{ width: 24, height: 24, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.45)", borderRadius: 5, padding: 0, cursor: "pointer", color: "#86efac", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <Icon name="check" size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); cancelTitleEdit(); }}
                title={t("common.cancel", "Cancel")}
                aria-label={t("common.cancel", "Cancel")}
                style={{ width: 24, height: 24, background: "rgba(255,255,255,0.06)", border: "1px solid var(--dock-border, rgba(255,255,255,0.12))", borderRadius: 5, padding: 0, cursor: "pointer", color: "var(--dock-text-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <Icon name="close" size={14} />
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "var(--dock-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cd.title}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startTitleEdit(); }}
                disabled={isLive}
                title={isLive ? t("countdowns.stopBeforeEditing", "Stop the countdown before editing") : t("countdowns.editTitle", "Edit countdown title")}
                aria-label={isLive ? t("countdowns.stopBeforeEditing", "Stop the countdown before editing") : t("countdowns.editTitle", "Edit countdown title")}
                style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: "4px 6px", cursor: isLive ? "not-allowed" : "pointer", color: "var(--dock-text-dim)", opacity: isLive ? 0.4 : 1, display: "flex", alignItems: "center", flexShrink: 0 }}
              >
                <Icon name="edit" size={13} />
              </button>
            </>
          )}
          {cd.obs.autoSwitchEnabled && cd.obs.autoSwitchScene && (
            <span style={{ fontSize: 8, fontWeight: 600, background: "rgba(99,102,241,0.8)", color: "#fff", borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap", flexShrink: 0 }}>
              {(() => {
                const sec = cd.obs.autoSwitchAtSeconds ?? 0;
                const m = Math.floor(sec / 60);
                const s = Math.floor(sec % 60);
                return `Switch @ ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
              })()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {isLive ? (
            <span style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(34,197,94,0.9)", borderRadius: 4, padding: "1px 6px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: "#fff" }}>{t("common.live")}</span>
            </span>
          ) : (
            <span style={{ fontSize: 9, color: "var(--dock-text-dim)" }}>
              {cd.timer.durationSeconds / 60}min
            </span>
          )}
          {/* Three-dot menu */}
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--dock-text-dim)", display: "flex", alignItems: "center", borderRadius: 4 }}
              title={t("common.actions", "Actions")}
            >
              <Icon name="more_vert" size={14} />
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 20, background: "var(--dock-surface, #1e1e2e)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 8, padding: 4, minWidth: 130, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                  disabled={isLive}
                  title={isLive ? t("countdowns.stopBeforeEditing", "Stop the countdown before editing") : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", background: "none", border: "none", borderRadius: 4, cursor: isLive ? "not-allowed" : "pointer", color: "var(--dock-text)", opacity: isLive ? 0.4 : 1, fontSize: 12, textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <Icon name="tune" size={13} />
                  <span>{t("countdowns.editCountdownSettings", "Edit countdown settings")}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onReset(); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", background: "none", border: "none", borderRadius: 4, cursor: "pointer", color: "var(--dock-text)", fontSize: 12, textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <Icon name="restart_alt" size={13} />
                  <span>{t("countdowns.reset", "Reset")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timer (click to edit inline) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: isCompact ? 28 : 42, minWidth: 0 }}>
        {editingTime ? (
          <>
            <input
              autoFocus
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  commitTimeEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelTimeEdit();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={t("countdowns.editTime", "Edit countdown time")}
              style={{ flex: "0 1 auto", width: cd.timer.showHours ? 142 : 112, maxWidth: "100%", height: isCompact ? 24 : 30, boxSizing: "border-box", fontSize: isCompact ? 16 : 20, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, background: "var(--dock-input-bg, rgba(0,0,0,0.3))", border: "1px solid var(--dock-accent, #3b82f6)", borderRadius: 5, padding: "2px 6px", letterSpacing: 1, lineHeight: 1, outline: "none" }}
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); commitTimeEdit(); }}
              title={t("common.save", "Save")}
              aria-label={t("common.save", "Save")}
              style={{ width: isCompact ? 22 : 26, height: isCompact ? 22 : 26, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.45)", borderRadius: 5, padding: 0, cursor: "pointer", color: "#86efac", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <Icon name="check" size={isCompact ? 12 : 15} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); cancelTimeEdit(); }}
              title={t("common.cancel", "Cancel")}
              aria-label={t("common.cancel", "Cancel")}
              style={{ width: isCompact ? 22 : 26, height: isCompact ? 22 : 26, background: "rgba(255,255,255,0.06)", border: "1px solid var(--dock-border, rgba(255,255,255,0.12))", borderRadius: 5, padding: 0, cursor: "pointer", color: "var(--dock-text-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <Icon name="close" size={isCompact ? 12 : 15} />
            </button>
          </>
        ) : (
          <>
            <div
              style={{ fontSize: isCompact ? 18 : 28, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow, letterSpacing: 1, lineHeight: 1, padding: isCompact ? "2px 0" : "8px 0", cursor: "pointer", flex: "0 1 auto", minWidth: 0, maxWidth: "100%" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isLive) return;
                  setEditValue(formattedTime);
                  setEditingTime(true);
                }}
            >
              {formattedTime}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!isLive) { setEditValue(formattedTime); setEditingTime(true); } }}
              disabled={isLive}
              title={isLive ? t("countdowns.stopBeforeEditing", "Stop the countdown before editing") : t("countdowns.editTime", "Edit countdown time")}
              aria-label={isLive ? t("countdowns.stopBeforeEditing", "Stop the countdown before editing") : t("countdowns.editTime", "Edit countdown time")}
              style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: isCompact ? "3px 4px" : "5px 6px", cursor: isLive ? "not-allowed" : "pointer", color: "var(--dock-text-dim)", opacity: isLive ? 0.4 : 1, display: "flex", alignItems: "center", flexShrink: 0 }}
            >
              <Icon name="edit" size={isCompact ? 12 : 14} />
            </button>
          </>
        )}
      </div>

      {/* Timer adjust controls */}
      <div style={{ display: "flex", gap: 3, alignItems: "center", marginTop: isCompact ? 1 : 4 }}>
        <button type="button" className="dock-btn dock-btn--small" onClick={(e) => { e.stopPropagation(); onAdjustTime(-60); }} title={t("countdowns.minusOneMinute", "-1 minute")} style={{ fontSize: isCompact ? 9 : 10, fontWeight: 700, padding: isCompact ? "2px 4px" : "4px 5px", minWidth: 0 }}>-1m</button>
        <button type="button" className="dock-btn dock-btn--small" onClick={(e) => { e.stopPropagation(); onAdjustTime(-10); }} title={t("countdowns.minusTenSeconds", "-10 seconds")} style={{ fontSize: isCompact ? 9 : 10, fontWeight: 700, padding: isCompact ? "2px 4px" : "4px 5px", minWidth: 0 }}><Icon name="fast_rewind" size={isCompact ? 9 : 10} /></button>
        <button type="button" className="dock-btn dock-btn--small" onClick={(e) => { e.stopPropagation(); onAdjustTime(10); }} title={t("countdowns.plusTenSeconds", "+10 seconds")} style={{ fontSize: isCompact ? 9 : 10, fontWeight: 700, padding: isCompact ? "2px 4px" : "4px 5px", minWidth: 0 }}><Icon name="fast_forward" size={isCompact ? 9 : 10} /></button>
        <button type="button" className="dock-btn dock-btn--small" onClick={(e) => { e.stopPropagation(); onAdjustTime(60); }} title={t("countdowns.plusOneMinute", "+1 minute")} style={{ fontSize: isCompact ? 9 : 10, fontWeight: 700, padding: isCompact ? "2px 4px" : "4px 5px", minWidth: 0 }}>+1m</button>
      </div>

      {/* Push & Start / Pause / Stop */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: isCompact ? 1 : 2 }}>
        {isLive ? (
          <>
            <button type="button" className="dock-btn dock-btn--small dock-btn--danger" onClick={(e) => { e.stopPropagation(); onStop(); }} style={{ fontSize: isCompact ? 9 : 10, padding: isCompact ? "3px 5px" : "4px 6px", display: "flex", alignItems: "center", gap: 3 }}>
              <Icon name="stop" size={10} /> {t("countdowns.stopAndRemove", "Stop & Remove")}
            </button>
            <button type="button" className="dock-btn dock-btn--small" onClick={(e) => { e.stopPropagation(); isPaused ? onResume() : onPause(); }} title={isPaused ? t("countdowns.resume", "Resume") : t("countdowns.pause", "Pause")} style={{ fontSize: isCompact ? 9 : 10, padding: isCompact ? "3px 5px" : "4px 6px" }}>
              <Icon name={isPaused ? "play_arrow" : "pause"} size={10} />
            </button>
          </>
        ) : (
          <button type="button" className="dock-btn dock-btn--small dock-btn--success" onClick={(e) => { e.stopPropagation(); onShowObs(); }} style={{ fontSize: isCompact ? 9 : 10, padding: isCompact ? "3px 5px" : "4px 6px" }}>
            {t("countdowns.pushAndStart", "Push & Start")}
          </button>
        )}
      </div>

      {/* Auto Scene Switch */}
      <div style={{ borderTop: "1px solid var(--dock-border, rgba(255,255,255,0.06))", marginTop: 6, paddingTop: 6 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowAutoSwitch(!showAutoSwitch); }}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dock-text-dim)", fontSize: 9 }}
        >
          <Icon name={showAutoSwitch ? "expand_less" : "expand_more"} size={12} />
          <span>{t("countdowns.autoSceneSwitch", "Auto Scene Switch")}</span>
          {cd.obs.autoSwitchEnabled && (
            <span style={{ fontSize: 8, background: "rgba(99,102,241,0.8)", color: "#fff", borderRadius: 3, padding: "0 3px", marginLeft: 2 }}>
              ON
            </span>
          )}
        </button>

        {showAutoSwitch && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingLeft: 2 }}>
            <span style={{ fontSize: 8, color: "var(--dock-text-dim)", lineHeight: 1.3 }}>{t("countdowns.autoSceneSwitchDesc", "Automatically switch OBS to a different scene when the countdown reaches a specific time.")}</span>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={cd.obs.autoSwitchEnabled ?? false}
                onChange={(e) => onUpdateObs({ autoSwitchEnabled: e.target.checked })}
                style={{ accentColor: "var(--dock-accent, #3b82f6)", width: 12, height: 12 }}
              />
              <span style={{ fontSize: 10, color: "var(--dock-text)" }}>{t("countdowns.enableAutoSceneSwitch", "Enable")}</span>
            </label>
            <span style={{ fontSize: 7, color: "var(--dock-text-dim)", lineHeight: 1.2, marginTop: -4 }}>{t("countdowns.enableAutoSceneSwitchDesc", "Turn on to auto-switch scenes at the trigger time.")}</span>

            {(cd.obs.autoSwitchEnabled ?? false) && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 9, color: "var(--dock-text-dim)" }}>{t("countdowns.switchAt", "Trigger at (seconds)")}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cd.obs.autoSwitchAtSeconds ?? 0}
                    onChange={(e) => onUpdateObs({ autoSwitchAtSeconds: parseInt(e.target.value, 10) || 0 })}
                    style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 4, padding: "3px 6px", color: "var(--dock-text)", fontSize: 10, outline: "none", width: "100%" }}
                  />
                </label>
                <span style={{ fontSize: 7, color: "var(--dock-text-dim)", lineHeight: 1.2, marginTop: -4 }}>{t("countdowns.switchAtDesc", "Seconds remaining when the scene switch fires. 0 = at the very end.")}</span>

                <label style={{ display: "flex", flexDirection: "column", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 9, color: "var(--dock-text-dim)" }}>{t("countdowns.targetScene", "Switch to scene")}</span>
                  <select
                    value={cd.obs.autoSwitchScene ?? ""}
                    onChange={(e) => onUpdateObs({ autoSwitchScene: e.target.value })}
                    style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 4, padding: "3px 6px", color: "var(--dock-text)", fontSize: 10, outline: "none", width: "100%" }}
                  >
                    <option value="">{t("countdowns.selectScene", "Select scene...")}</option>
                    {obsScenes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <span style={{ fontSize: 7, color: "var(--dock-text-dim)", lineHeight: 1.2, marginTop: -4 }}>{t("countdowns.targetSceneDesc", "OBS scene to switch to when the countdown hits the trigger.")}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Tab ───────────────────────────────────────────────────────────────

export default function DockCountdownsTab({
  presentationOutputTarget = "obs",
}: {
  presentationOutputTarget?: DockPresentationOutputTarget;
} = {}) {
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const [sceneRoute, updateSceneRoute] = useDockSceneRoute("countdown");
  const hasSceneRoute = sceneRoute.enabled && sceneRoute.targets.length > 0;
  const [countdowns, setCountdowns] = useState<CountdownConfig[]>(HARDCODED_COUNTDOWNS);
  const [liveCountdownId, setLiveCountdownId] = useState<string | null>(() => readLivePersistState()?.id ?? null);
  const livePersistRef = useRef<LivePersistState | null>(readLivePersistState());
  const restoredRef = useRef(false);
  const autoSwitchTriggeredRef = useRef(false);
  const autoSwitchInFlightRef = useRef(false);
  const obsControlArmedRef = useRef(false);

  // Edit modal state
  const [editingCd, setEditingCd] = useState<CountdownConfig | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const [obsScenes, setObsScenes] = useState<string[]>([]);
  const [editBg, setEditBg] = useState<BackgroundSettings>({
    type: "solid", color: "#1a1a2e", gradientStart: "#1a1a2e", gradientEnd: "#16213e", gradientAngle: 135,
    imageUrl: "", videoUrl: "", blur: 0, brightness: 100, overlayOpacity: 0, zoom: 1, positionX: 50, positionY: 50,
    source: "upload", imageFit: "cover", loop: true, muted: true, flyerMode: false,
  });
  const [editMessage, setEditMessage] = useState<MessageSettings>({ text: "", color: "#ffffff", position: "below" });
  const [editBgMediaModal, setEditBgMediaModal] = useState(false);
  const [editMediaSearch, setEditMediaSearch] = useState("");
  const [editMediaItems, setEditMediaItems] = useState<MediaItem[]>([]);
  const [editMediaLoading, setEditMediaLoading] = useState(false);
  const editBgFileRef = useRef<HTMLInputElement | null>(null);
  const [editBgUploading, setEditBgUploading] = useState(false);
  const [editBgUploadError, setEditBgUploadError] = useState("");

  // Per-card timer state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<"running" | "paused">("running");
  const activeCd = countdowns.find((c) => c.id === activeId) ?? null;
  const timer = useCountdownTimer(activeCd);
  const [isUltraCompactHeight, setIsUltraCompactHeight] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsUltraCompactHeight(window.innerHeight <= 400);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Designs saved in the app show up here too. Re-checked every few seconds so edits in the app appear
  // without reopening the Dock; the live / selected countdown is never swapped out from under the operator.
  const syncedStampsRef = useRef<Record<string, string>>({});
  const protectedIdsRef = useRef<Array<string | null>>([]);
  protectedIdsRef.current = [liveCountdownId, activeId];
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const saved = await loadSavedDesigns();
      if (cancelled || !saved) return;
      const stamps = syncedStampsRef.current;
      const savedSorted = [...saved].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const savedIds = new Set(savedSorted.map((c) => c.id));
      const protectedIds = protectedIdsRef.current;
      setCountdowns((prev) => {
        const merged: CountdownConfig[] = savedSorted.map((cd) => {
          const existing = prev.find((c) => c.id === cd.id);
          if (existing && (stamps[cd.id] === cd.updatedAt || protectedIds.includes(cd.id))) return existing;
          return cd;
        });
        const rest = prev.filter((c) => {
          if (savedIds.has(c.id)) return false;
          if (c.id.startsWith("hardcoded-")) return true;
          // Deleted in the app: drop it, unless it is on air right now.
          return !(c.id in stamps) || protectedIds.includes(c.id);
        });
        const next = [...merged, ...rest];
        for (const cd of savedSorted) {
          if (!protectedIds.includes(cd.id) || !(cd.id in stamps)) stamps[cd.id] = cd.updatedAt;
        }
        const same = next.length === prev.length && next.every((c, i) => c === prev[i]);
        return same ? prev : next;
      });
    };
    void refresh();
    const timerId = window.setInterval(refresh, 6000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Restore activeId when liveCountdownId is set but activeId is not
  useEffect(() => {
    if (liveCountdownId && !activeId) {
      setActiveId(liveCountdownId);
    }
  }, [liveCountdownId, activeId]);

  // Restore timer remaining when activeCd becomes available after mount
  useEffect(() => {
    if (restoredRef.current) return;
    const persist = livePersistRef.current;
    if (!persist || !activeCd || activeCd.id !== persist.id) return;

    restoredRef.current = true;
    livePersistRef.current = null;

    let remaining = persist.remaining;
    if (persist.running && persist.savedAt) {
      const elapsed = (Date.now() - persist.savedAt) / 1000;
      remaining = Math.max(0, remaining - elapsed);
    }

    timer.setRemainingDirect(remaining);

    setPlaybackState(persist.running && remaining > 0 ? "running" : "paused");

    if (persist.running && remaining > 0) {
      timer.start();
    }
  }, [activeCd]);

  // Persist live state
  useEffect(() => {
    function save() {
      if (liveCountdownId) {
        writeLivePersistState({
          id: liveCountdownId,
          remaining: timer.remaining,
          running: timer.isRunning,
          savedAt: Date.now(),
        });
      }
    }
    const handleBeforeUnload = () => save();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = setInterval(save, 2000);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [liveCountdownId, timer.remaining, timer.isRunning]);

  // Clear live countdown when timer completes
  useEffect(() => {
    if (timer.isComplete && liveCountdownId) {
      writeLivePersistState(null);
      setLiveCountdownId(null);
    }
  }, [timer.isComplete, liveCountdownId]);

  // Auto scene switch: fire once when remaining drops to or below the trigger.
  // Keep the request in flight until OBS confirms the call, so enabling the
  // switch and choosing a scene cannot silently leave it unarmed.
  useEffect(() => {
    if (!activeCd) return;
    const autoEnabled = activeCd.obs.autoSwitchEnabled;
    const triggerTime = activeCd.obs.autoSwitchAtSeconds ?? 0;
    const targetScene = activeCd.obs.autoSwitchScene;
    if (
      obsControlArmedRef.current &&
      autoEnabled &&
      targetScene &&
      !autoSwitchTriggeredRef.current &&
      timer.remaining <= triggerTime
    ) {
      if (presentationLinkMode) return;
      if (autoSwitchInFlightRef.current) return;
      autoSwitchInFlightRef.current = true;
      void (async () => {
        try {
          await ensureObsConnected();
          if (!dockObsClient.isConnected) {
            throw new Error("OBS is not connected");
          }
          await dockObsClient.call("SetCurrentProgramScene", { sceneName: targetScene });
          autoSwitchTriggeredRef.current = true;
        } catch (err) {
          autoSwitchTriggeredRef.current = false;
          console.warn("[DockCountdowns] Auto scene switch failed:", err);
        } finally {
          autoSwitchInFlightRef.current = false;
        }
      })();
    }
  }, [timer.remaining, activeCd, presentationLinkMode]);

  // Load OBS scenes on mount so card dropdowns have data
  useEffect(() => {
    if (presentationLinkMode) {
      setObsScenes([]);
      return;
    }
    loadObsScenes().then(setObsScenes);
  }, [presentationLinkMode]);

  // ── OBS ─────────────────────────────────────────────────────────────────

  const COUNTDOWN_SOURCE = DOCK_COUNTDOWN_SOURCE_NAME;
  const BG_SOURCE = DOCK_COUNTDOWN_BG_SOURCE_NAME;

  const getObsTargets = useCallback((cd: CountdownConfig) => {
    if (!hasSceneRoute) {
      return [{
        sceneName: resolveCountdownTargetScene(cd.obs.sceneName),
        contentSourceName: COUNTDOWN_SOURCE,
        backgroundSourceName: BG_SOURCE,
      }];
    }

    const selectedTargets = sceneRoute.targets.map((target) => ({
      sceneName: target.sceneName,
      contentSourceName: dockObsClient.getSceneRouteSourceName("countdown", target.sceneName),
      backgroundSourceName: dockObsClient.getSceneRouteSourceName("countdown", target.sceneName, "Background"),
    }));
    if (!sceneRoute.syncPresentation) return selectedTargets;

    return [
      ...selectedTargets,
      {
        sceneName: resolveCountdownTargetScene(),
        contentSourceName: COUNTDOWN_SOURCE,
        backgroundSourceName: BG_SOURCE,
      },
    ];
  }, [hasSceneRoute, sceneRoute.targets, sceneRoute.syncPresentation]);

  async function loadObsScenes(): Promise<string[]> {
    if (presentationLinkMode) return [];
    try {
      await ensureObsConnected();
      if (!dockObsClient.isConnected) return [];
      const result = await dockObsClient.call("GetSceneList", {}) as { scenes: Array<{ sceneName: string }> };
      return result.scenes.map((s) => s.sceneName);
    } catch {
      return [];
    }
  }

  async function ensureObsScene(sceneName: string): Promise<void> {
    const scenes = await dockObsClient.call("GetSceneList", {}) as { scenes: Array<{ sceneName: string }> };
    const exists = scenes.scenes.some((s) => s.sceneName === sceneName);
    if (!exists) {
      await dockObsClient.call("CreateScene", { sceneName });
    }
  }

  async function ensureObsSource(
    sourceName: string,
    url: string,
    sceneName: string,
    opts?: { setTransform?: boolean },
  ): Promise<void> {
    await ensureObsScene(sceneName);

    const inputs = await dockObsClient.call("GetInputList", { inputKind: "browser_source" }) as { inputs: Array<{ inputName: string }> };
    const existing = inputs.inputs.find((i) => i.inputName === sourceName);

    if (existing) {
      await dockObsClient.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: { url, width: 1920, height: 1080, shutdown: false, restart_when_active: false },
      });
    } else {
      await dockObsClient.call("CreateInput", {
        sceneName,
        inputName: sourceName,
        inputKind: "browser_source",
        inputSettings: { url, width: 1920, height: 1080, shutdown: false, restart_when_active: false },
      });
    }

    const sceneItems = await dockObsClient.call("GetSceneItemList", { sceneName }) as { sceneItems: Array<{ sceneItemId: number; sourceName: string }> };
    let item = sceneItems.sceneItems.find((i) => i.sourceName === sourceName);

    if (!item && existing) {
      const addResult = await dockObsClient.call("CreateSceneItem", {
        sceneName,
        sourceName,
        sceneItemEnabled: true,
      }) as { sceneItemId: number };
      item = { sceneItemId: addResult.sceneItemId, sourceName };
    }

    if (item) {
      await dockObsClient.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: true,
      });

      if (opts?.setTransform) {
        const vs = await dockObsClient.call("GetVideoSettings", {}) as any;
        await dockObsClient.call("SetSceneItemTransform", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemTransform: {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: vs.baseWidth, boundsHeight: vs.baseHeight,
            boundsAlignment: 0,
          },
        });
      }

      await dockObsClient.ensureTickerAboveSource(sceneName, sourceName).catch(() => { });
    }
  }

  async function hideObsSource(sourceName: string, sceneName: string): Promise<void> {
    const sceneItems = await dockObsClient.call("GetSceneItemList", { sceneName }) as { sceneItems: Array<{ sceneItemId: number; sourceName: string }> };
    const item = sceneItems.sceneItems.find((i) => i.sourceName === sourceName);
    if (item) {
      await dockObsClient.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: false,
      });
    }
  }

  const pushToObs = useCallback(async (cd: CountdownConfig, sync?: OverlaySyncState) => {
    if (presentationLinkMode) {
      await publishCountdownToPresentation(cd);
      return;
    }

    await ensureObsConnected();
    if (!dockObsClient.isConnected) return;

    try {
      const baseUrl = getOverlayBaseUrlSync();
      const payload: CountdownOverlayPayload = attachLayoutMode({ config: cd, baseUrl, timestamp: Date.now(), sync, reveal: false });
      const url = `${baseUrl}/countdown-overlay.html#data=${encodeURIComponent(JSON.stringify(payload))}`;
      const targets = getObsTargets(cd);
      for (const target of targets) {
        await ensureObsSource(target.contentSourceName, url, target.sceneName);
      }
      if (targets.some((target) => (
        target.sceneName === DOCK_PRESENTATION_SCENE_NAME
        && target.contentSourceName === COUNTDOWN_SOURCE
      ))) {
        await dockObsClient.applyMcePresentationSourceVisibility(COUNTDOWN_SOURCE);
      }
    } catch (err) {
      console.warn("[DockCountdowns] Failed to push to OBS:", err);
    }
  }, [getObsTargets, presentationLinkMode]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleShowInObs = useCallback(async (cd: CountdownConfig) => {
    if (presentationLinkMode) {
      setActiveId(cd.id);
      setPlaybackState("running");
      obsControlArmedRef.current = true;
      autoSwitchTriggeredRef.current = false;
      autoSwitchInFlightRef.current = false;
      const remaining = Math.floor(cd.timer.durationSeconds);
      writeLivePersistState({ id: cd.id, remaining, running: true, savedAt: Date.now() });
      setLiveCountdownId(cd.id);
      await publishCountdownToPresentation(cd);
      trackOutputShown("countdown_shown");
      timer.start();
      return;
    }

    await ensureObsConnected();
    if (!dockObsClient.isConnected) return;

    try {
      // 1. Push BG first, then countdown overlay ONCE with running state
      const baseUrl = getOverlayBaseUrlSync();
      const targets = getObsTargets(cd);

      // Hide any old countdown text before preparing the new background.
      // This prevents the previous text from appearing over a still-loading background.
      for (const target of targets) {
        await hideObsSource(target.contentSourceName, target.sceneName);
      }

      if (isLayoutDesign(cd)) {
        // Layer designs draw their own background: make sure no old picture/video source shows behind them.
        for (const target of targets) {
          await hideObsSource(target.backgroundSourceName, target.sceneName);
        }
      } else {
        const bgPayload = { config: cd, baseUrl, timestamp: Date.now() };
        const bgUrl = `${baseUrl}/countdown-bg-overlay.html#data=${encodeURIComponent(JSON.stringify(bgPayload))}`;
        for (const target of targets) {
          await ensureObsSource(target.backgroundSourceName, bgUrl, target.sceneName, { setTransform: true });
        }

        // Give OBS a frame to paint the background before enabling the text source.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      }

      setActiveId(cd.id);
      setPlaybackState("running");
      obsControlArmedRef.current = true;
      autoSwitchTriggeredRef.current = false;
      autoSwitchInFlightRef.current = false;

      // Use config's durationSeconds (reflects any inline edits via handleSetTime)
      const remaining = Math.floor(cd.timer.durationSeconds);
      writeLivePersistState({ id: cd.id, remaining, running: true, savedAt: Date.now() });
      setLiveCountdownId(cd.id);

      const sync: OverlaySyncState = { paused: false, remaining };
      const payload: CountdownOverlayPayload = attachLayoutMode({ config: cd, baseUrl, timestamp: Date.now(), sync, reveal: true });
      const contentUrl = `${baseUrl}/countdown-overlay.html#data=${encodeURIComponent(JSON.stringify(payload))}`;
      for (const target of targets) {
        await ensureObsSource(target.contentSourceName, contentUrl, target.sceneName, { setTransform: true });
      }
      if (targets.some((target) => (
        target.sceneName === DOCK_PRESENTATION_SCENE_NAME
        && target.contentSourceName === COUNTDOWN_SOURCE
      ))) {
        await dockObsClient.applyMcePresentationSourceVisibility(COUNTDOWN_SOURCE);
      }

      trackOutputShown("countdown_shown");
      timer.start();
    } catch (err) {
      console.warn("[DockCountdowns] Failed to show in OBS:", err);
    }
  }, [getObsTargets, presentationLinkMode, timer]);

  const handlePause = useCallback(async (cd: CountdownConfig) => {
    const currentRemaining = timer.pause();
    const remaining = Math.floor(currentRemaining);
    setPlaybackState("paused");
    obsControlArmedRef.current = true;
    writeLivePersistState({ id: cd.id, remaining: currentRemaining, running: false, savedAt: Date.now() });
    const sync: OverlaySyncState = { paused: true, remaining };
    await pushToObs(cd, sync);
  }, [timer, pushToObs]);

  const handleResume = useCallback(async (cd: CountdownConfig) => {
    const persist = readLivePersistState();
    if (persist && persist.id === cd.id) {
      timer.setRemainingDirect(persist.remaining);
    }
    obsControlArmedRef.current = true;
    autoSwitchTriggeredRef.current = false;
    autoSwitchInFlightRef.current = false;
    timer.start();
    setPlaybackState("running");
    const remaining = timer.remaining;
    writeLivePersistState({ id: cd.id, remaining, running: true, savedAt: Date.now() });
    const sync: OverlaySyncState = { paused: false, remaining: Math.floor(remaining) };
    await pushToObs(cd, sync);
  }, [timer, pushToObs]);

  const handleStopAndRemove = useCallback(async (cd: CountdownConfig) => {
    timer.reset();
    autoSwitchTriggeredRef.current = false;
    autoSwitchInFlightRef.current = false;
    obsControlArmedRef.current = true;
    setActiveId(null);
    setPlaybackState("running");
    const targets = getObsTargets(cd);
    try {
      if (presentationLinkMode) {
        await clearPresentationScreen();
      } else {
        await ensureObsConnected();
      }
      if (!presentationLinkMode && dockObsClient.isConnected) {
        for (const target of targets) {
          await hideObsSource(target.backgroundSourceName, target.sceneName);
          await hideObsSource(target.contentSourceName, target.sceneName);
        }
      }
    } catch (err) {
      console.warn("[DockCountdowns] Failed to hide OBS sources:", err);
    }
    writeLivePersistState(null);
    setLiveCountdownId(null);
  }, [getObsTargets, presentationLinkMode, timer]);

  const handleAdjustTime = useCallback(async (cd: CountdownConfig, deltaSeconds: number) => {
    const oldRemaining = timer.remaining;
    const newRemaining = Math.max(0, oldRemaining + deltaSeconds);
    const updatedCd = { ...cd, timer: { ...cd.timer, durationSeconds: newRemaining } };
    setCountdowns((prev) => prev.map((c) =>
      c.id === cd.id ? updatedCd : c,
    ));
    if (activeId === cd.id) {
      timer.adjustTime(deltaSeconds);
      if (liveCountdownId === cd.id) {
        writeLivePersistState({ id: cd.id, remaining: newRemaining, running: timer.isRunning, savedAt: Date.now() });
      }
      const sync: OverlaySyncState = { paused: !timer.isRunning, remaining: Math.floor(newRemaining) };
      await pushToObs(updatedCd, sync);
    }
  }, [timer, pushToObs, liveCountdownId, activeId]);

  const handleSetTime = useCallback((cd: CountdownConfig, seconds: number) => {
    const updatedCd = { ...cd, timer: { ...cd.timer, durationSeconds: seconds } };
    setCountdowns((prev) => prev.map((c) =>
      c.id === cd.id ? updatedCd : c,
    ));
    if (activeId === cd.id) {
      timer.setRemainingDirect(seconds);
      if (liveCountdownId === cd.id) {
        writeLivePersistState({ id: cd.id, remaining: seconds, running: timer.isRunning, savedAt: Date.now() });
      }
    }
  }, [timer, liveCountdownId, activeId]);

  const handleSetTitle = useCallback((cd: CountdownConfig, title: string) => {
    const updatedCd: CountdownConfig = {
      ...cd,
      title,
      text: { ...cd.text, title },
      message: cd.message?.text === cd.title ? { ...cd.message, text: title } : cd.message,
      updatedAt: new Date().toISOString(),
    };
    setCountdowns((prev) => prev.map((c) =>
      c.id === cd.id ? updatedCd : c,
    ));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="dock-tab-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isUltraCompactHeight ? "4px 8px" : "8px 12px", borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.08))", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="hourglass" size={14} style={{ color: "var(--dock-accent, #3b82f6)" }} />
          <span style={{ fontSize: isUltraCompactHeight ? 11 : 12, fontWeight: 600, color: "var(--dock-text)" }}>{t("countdowns.myCountdowns")}</span>
          <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>({countdowns.length})</span>
        </div>
        <DockSceneRoutingControl
          module="countdown"
          route={sceneRoute}
          onRouteChange={updateSceneRoute}
          disabled={presentationLinkMode}
          title={t("sceneRouting.countdownOutput", "Countdown output")}
        />
      </div>

      {/* Countdown list */}
      <div style={{ flex: 1, overflowY: "auto", padding: isUltraCompactHeight ? "6px 8px" : 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: isUltraCompactHeight ? 4 : 6 }}>
          {countdowns.map((cd) => {
            const isThisLive = liveCountdownId === cd.id;
            const isThisActive = activeId === cd.id;
            const timeDisplay = isThisActive ? timer.formatted : formatTimeStatic(cd);

            return (
              <CountdownCard
                key={cd.id}
                cd={cd}
                isLive={isThisLive}
                isPaused={isThisLive && playbackState === "paused"}
                formattedTime={timeDisplay}
                previewSeconds={isThisActive ? timer.remaining : cd.timer.durationSeconds}
                obsScenes={obsScenes}
                onSelect={() => setActiveId(cd.id)}
                onAdjustTime={(delta) => handleAdjustTime(cd, delta)}
                onSetTime={(secs) => handleSetTime(cd, secs)}
                onSetTitle={(title) => handleSetTitle(cd, title)}
                onShowObs={() => handleShowInObs(cd)}
                onPause={() => handlePause(cd)}
                onResume={() => handleResume(cd)}
                onStop={() => handleStopAndRemove(cd)}
                isCompact={isUltraCompactHeight}
                onEdit={async () => {
                  if (isThisLive) return;
                  setEditingCd(cd);
                  setEditTitle(cd.title);
                  setEditSubtitle(cd.text?.subtitle ?? "");
                  setEditMinutes(String(cd.timer.durationSeconds / 60));
                  setEditBg({ ...cd.background });
                  setEditMessage(cd.message ? { ...cd.message } : { text: "", color: "#ffffff", position: "below" });
                  setEditBgUploadError("");
                  setEditBgUploading(false);
                  const scenes = await loadObsScenes();
                  setObsScenes(scenes);
                }}
                onReset={() => {
                  if (liveCountdownId === cd.id) {
                    timer.reset();
                    autoSwitchTriggeredRef.current = false;
                    autoSwitchInFlightRef.current = false;
                    obsControlArmedRef.current = true;
                    const sync: OverlaySyncState = { paused: true, remaining: cd.timer.durationSeconds };
                    pushToObs(cd, sync);
                    writeLivePersistState(null);
                    setLiveCountdownId(null);
                    setPlaybackState("running");
                  }
                }}
                onUpdateObs={(patch) => {
                  if (
                    patch.autoSwitchEnabled !== undefined
                    || patch.autoSwitchScene !== undefined
                    || patch.autoSwitchAtSeconds !== undefined
                  ) {
                    // A changed switch setting is a new instruction, even if
                    // this countdown has already crossed the old trigger.
                    autoSwitchTriggeredRef.current = false;
                    autoSwitchInFlightRef.current = false;
                  }
                  setCountdowns((prev) => prev.map((c) =>
                    c.id === cd.id ? { ...c, obs: { ...c.obs, ...patch } } : c,
                  ));
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Edit Modal */}
      {editingCd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(3,7,18,0.72)", backdropFilter: "blur(4px)" }}
          onClick={() => setEditingCd(null)}>
          <div style={{ background: "var(--dock-surface, #1e1e2e)", border: "1px solid var(--dock-border, rgba(255,255,255,0.14))", borderRadius: 14, width: "min(430px, 100%)", maxHeight: "min(720px, 92vh)", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 18px 60px rgba(0,0,0,0.45)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.08))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--dock-accent, #3b82f6)", background: "rgba(59,130,246,0.12)" }}>
                  <Icon name="edit" size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dock-text)" }}>{t("countdowns.editCountdown", "Edit Countdown")}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--dock-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t("countdowns.editCountdownHint", "Update what appears before your service starts.")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCd(null)}
                aria-label={t("common.close", "Close")}
                title={t("common.close", "Close")}
                style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, background: "transparent", color: "var(--dock-text-dim)", cursor: "pointer" }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Essentials */}
              <div style={{ padding: 12, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 10, background: "rgba(255,255,255,0.025)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <Icon name="tune" size={15} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--dock-text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("countdowns.basics", "Basics")}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 124px", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("common.title", "Title")}</span>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t("countdowns.titlePlaceholder", "Countdown title")}
                      style={{ background: "rgba(0,0,0,0.22)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, padding: "8px 9px", color: "var(--dock-text)", fontSize: 12, outline: "none", minWidth: 0 }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.durationMinutes", "Minutes")}</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={editMinutes}
                      onChange={(e) => setEditMinutes(e.target.value)}
                      style={{ background: "rgba(0,0,0,0.22)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, padding: "8px 9px", color: "var(--dock-text)", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" }}
                    />
                  </label>
                </div>
                {isLayoutDesign(editingCd) && JSON.stringify(editingCd.layout).includes("{subtitle}") && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, marginTop: 10 }}>
                    <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.textBelow", "Text below")}</span>
                    <input
                      type="text"
                      value={editSubtitle}
                      onChange={(e) => setEditSubtitle(e.target.value)}
                      placeholder={t("countdowns.textBelowPlaceholder", "e.g. Until we begin")}
                      style={{ background: "rgba(0,0,0,0.22)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, padding: "8px 9px", color: "var(--dock-text)", fontSize: 12, outline: "none", minWidth: 0 }}
                    />
                  </label>
                )}
              </div>

            {!isLayoutDesign(editingCd) && (<>
            {/* ── Background Section ─────────────────────────────── */}
            <div style={{ padding: 12, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 10, background: "rgba(255,255,255,0.025)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <Icon name="image" size={15} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--dock-text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("countdowns.background", "Background")}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.backgroundHint", "Choose the visual behind the countdown.")}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Type selector */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["solid", "gradient", "image", "video", "transparent"] as BackgroundType[]).map((bgType) => (
                      <button key={bgType} type="button" onClick={() => { setEditBgUploadError(""); setEditBg((prev) => ({ ...prev, type: bgType })); }}
                        style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 500, border: `1px solid ${editBg.type === bgType ? "#6366f1" : "var(--dock-border, rgba(255,255,255,0.1))"}`, background: editBg.type === bgType ? "rgba(99,102,241,0.2)" : "transparent", color: editBg.type === bgType ? "var(--accent-blue)" : "var(--dock-text-dim)", cursor: "pointer", textTransform: "capitalize" }}>
                        {t(`countdowns.backgroundType.${bgType}`, bgType)}
                      </button>
                    ))}
                  </div>

                  {/* Solid */}
                  {editBg.type === "solid" && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="color" value={editBg.color} onChange={(e) => setEditBg((p) => ({ ...p, color: e.target.value }))}
                        style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", cursor: "pointer", padding: 2, background: "transparent" }} />
                      <input type="text" value={editBg.color} onChange={(e) => setEditBg((p) => ({ ...p, color: e.target.value }))}
                        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 6, padding: "6px 10px", color: "var(--dock-text)", fontSize: 12, outline: "none", fontFamily: "monospace", flex: 1 }} />
                    </div>
                  )}

                  {/* Gradient */}
                  {editBg.type === "gradient" && (
                    <>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("common.start", "Start")}</span>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input type="color" value={editBg.gradientStart} onChange={(e) => setEditBg((p) => ({ ...p, gradientStart: e.target.value }))}
                              style={{ width: 28, height: 28, borderRadius: 4, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", cursor: "pointer", padding: 1, background: "transparent" }} />
                            <input type="text" value={editBg.gradientStart} onChange={(e) => setEditBg((p) => ({ ...p, gradientStart: e.target.value }))}
                              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 4, padding: "4px 6px", color: "var(--dock-text)", fontSize: 10, outline: "none", fontFamily: "monospace", flex: 1 }} />
                          </div>
                        </div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("bgPicker.end", "End")}</span>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input type="color" value={editBg.gradientEnd} onChange={(e) => setEditBg((p) => ({ ...p, gradientEnd: e.target.value }))}
                              style={{ width: 28, height: 28, borderRadius: 4, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", cursor: "pointer", padding: 1, background: "transparent" }} />
                            <input type="text" value={editBg.gradientEnd} onChange={(e) => setEditBg((p) => ({ ...p, gradientEnd: e.target.value }))}
                              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 4, padding: "4px 6px", color: "var(--dock-text)", fontSize: 10, outline: "none", fontFamily: "monospace", flex: 1 }} />
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("bgPicker.angle", "Angle")}: {editBg.gradientAngle}°</span>
                        <input type="range" min={0} max={360} value={editBg.gradientAngle}
                          onChange={(e) => setEditBg((p) => ({ ...p, gradientAngle: Number(e.target.value) }))}
                          style={{ width: "100%", accentColor: "#6366f1" }} />
                      </div>
                    </>
                  )}

                  {/* Image */}
                  {editBg.type === "image" && (
                    <>
                      {(editBg.type === "image" && editBg.imageUrl) ? (
                        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
                          <img src={editBg.imageUrl} alt="" style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }} />
                          <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", gap: 4 }}>
                            <button type="button" onClick={() => editBgFileRef.current?.click()}
                              style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>{t("common.replace", "Replace")}</button>
                            <button type="button" onClick={async () => {
                              if (editBg.assetId) await deleteCountdownAsset(editBg.assetId).catch(() => { });
                              setEditBg((p) => ({ ...p, type: "solid", imageUrl: "", assetId: "", builtinId: "", source: "upload" }));
                            }}
                              style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(220,38,38,0.8)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>{t("common.remove", "Remove")}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: 6 }}>
                            {editBgUploading ? (
                              <div style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                {t("common.uploading", "Uploading…")}
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setEditBgUploadError(""); editBgFileRef.current?.click(); }}
                                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                <Upload size={14} /> {t("common.upload", "Upload")}
                              </button>
                            )}
                            <button type="button" onClick={async () => {
                              setEditBgMediaModal(true);
                              setEditMediaLoading(true);
                              try {
                                const { getAllMedia } = await import("../../library/libraryDb");
                                const all = await getAllMedia();
                                setEditMediaItems(all.filter((m) => m.type === "image"));
                              } catch { setEditMediaItems([]); }
                              setEditMediaLoading(false);
                            }}
                              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              <Icon name="folder" size={14} /> {t("common.library", "Library")}
                            </button>
                          </div>
                          {editBgUploadError && (
                            <div style={{ fontSize: 10, color: "#ef4444", lineHeight: 1.3 }}>{editBgUploadError}</div>
                          )}
                        </>
                      )}
                      {/* Image fit */}
                      <div style={{ display: "flex", gap: 4 }}>
                        {(["cover", "contain", "stretch"] as ImageFit[]).map((fit) => (
                          <button key={fit} type="button" onClick={() => setEditBg((p) => ({ ...p, imageFit: fit }))}
                            style={{ flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10, fontWeight: 500, border: `1px solid ${editBg.imageFit === fit ? "#6366f1" : "var(--dock-border, rgba(255,255,255,0.1))"}`, background: editBg.imageFit === fit ? "rgba(99,102,241,0.2)" : "transparent", color: editBg.imageFit === fit ? "var(--accent-blue)" : "var(--dock-text-dim)", cursor: "pointer", textTransform: "capitalize" }}>
                            {t(`countdowns.imageFit.${fit}`, fit)}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.brightness", "Brightness")}: {editBg.brightness}%</span>
                        <input type="range" min={10} max={200} value={editBg.brightness}
                          onChange={(e) => setEditBg((p) => ({ ...p, brightness: Number(e.target.value) }))}
                          style={{ width: "100%", accentColor: "#6366f1" }} />
                      </div>
                    </>
                  )}

                  {/* Video */}
                  {editBg.type === "video" && (
                    <>
                      {(editBg.type === "video" && editBg.videoUrl) ? (
                        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "#000" }}>
                          <video src={editBg.videoUrl} muted loop style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }} />
                          <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", gap: 4 }}>
                            <button type="button" onClick={() => editBgFileRef.current?.click()}
                              style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>{t("common.replace", "Replace")}</button>
                            <button type="button" onClick={async () => {
                              if (editBg.assetId) await deleteCountdownAsset(editBg.assetId).catch(() => { });
                              setEditBg((p) => ({ ...p, type: "solid", videoUrl: "", assetId: "", builtinId: "", source: "upload" }));
                            }}
                              style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(220,38,38,0.8)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>{t("common.remove", "Remove")}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: 6 }}>
                            {editBgUploading ? (
                              <div style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                {t("common.uploading", "Uploading…")}
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setEditBgUploadError(""); editBgFileRef.current?.click(); }}
                                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                <Upload size={14} /> {t("common.upload", "Upload")}
                              </button>
                            )}
                            <button type="button" onClick={async () => {
                              setEditBgMediaModal(true);
                              setEditMediaLoading(true);
                              try {
                                const { getAllMedia } = await import("../../library/libraryDb");
                                const all = await getAllMedia();
                                setEditMediaItems(all.filter((m) => m.type === "video"));
                              } catch { setEditMediaItems([]); }
                              setEditMediaLoading(false);
                            }}
                              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--dock-border, rgba(255,255,255,0.15))", background: "rgba(0,0,0,0.2)", color: "var(--dock-text-dim)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              <Icon name="folder" size={14} /> {t("common.library", "Library")}
                            </button>
                          </div>
                          {editBgUploadError && (
                            <div style={{ fontSize: 10, color: "#ef4444", lineHeight: 1.3 }}>{editBgUploadError}</div>
                          )}
                        </>
                      )}
                      <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--dock-text-dim)", cursor: "pointer" }}>
                          <input type="checkbox" checked={editBg.loop} onChange={(e) => setEditBg((p) => ({ ...p, loop: e.target.checked }))} style={{ accentColor: "#6366f1" }} /> {t("ministry.loop", "Loop")}
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--dock-text-dim)", cursor: "pointer" }}>
                          <input type="checkbox" checked={editBg.muted} onChange={(e) => setEditBg((p) => ({ ...p, muted: e.target.checked }))} style={{ accentColor: "#6366f1" }} /> {t("countdowns.muted", "Muted")}
                        </label>
                      </div>
                    </>
                  )}




                  {/* Hidden file input */}
                  <input ref={editBgFileRef} type="file" accept={backgroundFileAccept()} style={{ display: "none" }}
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files?.length) return;
                      const file = files[0];
                      const result = validateMediaFile(file);
                      if (!result.valid) {
                        setEditBgUploadError(result.error || t("media.unsupportedFileType", "Unsupported file type"));
                        if (editBgFileRef.current) editBgFileRef.current.value = "";
                        return;
                      }
                      setEditBgUploadError("");
                      setEditBgUploading(true);
                      try {
                        if (editBg.assetId) await deleteCountdownAsset(editBg.assetId).catch(() => { });
                        const { assetId, overlayUrl } = await saveCountdownAsset(file);
                        const isImage = result.mediaType === "image";
                        setEditBg((p) => ({
                          ...p,
                          type: isImage ? "image" : "video",
                          source: "upload",
                          assetId,
                          builtinId: "",
                          imageUrl: isImage ? overlayUrl : p.imageUrl,
                          videoUrl: !isImage ? overlayUrl : p.videoUrl,
                        }));
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.warn("[DockCountdowns] Upload failed:", msg);
                        setEditBgUploadError(msg);
                      } finally {
                        setEditBgUploading(false);
                        if (editBgFileRef.current) editBgFileRef.current.value = "";
                      }
                    }} />

                  {/* Media library modal */}
                  {editBgMediaModal && (
                    <div style={{ border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 8, padding: 10, background: "rgba(0,0,0,0.3)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dock-text)" }}>{t("common.chooseFromLibrary", "Choose from Library")}</span>
                        <button type="button" onClick={() => { setEditBgMediaModal(false); setEditMediaSearch(""); }}
                          style={{ background: "none", border: "none", color: "var(--dock-text-dim)", cursor: "pointer", fontSize: 16 }}>×</button>
                      </div>
                      <input type="text" placeholder={t("common.searchEllipsis", "Search...")} value={editMediaSearch} onChange={(e) => setEditMediaSearch(e.target.value)}
                        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 6, padding: "6px 10px", color: "var(--dock-text)", fontSize: 12, outline: "none", width: "100%", marginBottom: 8 }} />
                      <div style={{ maxHeight: 180, overflowY: "auto" }}>
                        {editMediaLoading ? (
                          <div style={{ padding: 16, textAlign: "center", color: "var(--dock-text-dim)", fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
                        ) : editMediaItems.length === 0 ? (
                          <div style={{ padding: 16, textAlign: "center", color: "var(--dock-text-dim)", fontSize: 12 }}>{t("media.noMediaFilesFound", "No media files found")}</div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                            {editMediaItems
                              .filter((m) => !editMediaSearch || m.name.toLowerCase().includes(editMediaSearch.toLowerCase()))
                              .map((item) => (
                                <button key={item.id} type="button"
                                  onClick={() => {
                                    const isImage = item.type === "image";
                                    setEditBg((p) => ({
                                      ...p,
                                      type: isImage ? "image" : "video",
                                      source: "media-library",
                                      assetId: "",
                                      builtinId: "",
                                      imageUrl: isImage ? (item.url || "") : p.imageUrl,
                                      videoUrl: !isImage ? (item.url || "") : p.videoUrl,
                                    }));
                                    setEditBgMediaModal(false);
                                    setEditMediaSearch("");
                                  }}
                                  style={{ borderRadius: 6, overflow: "hidden", border: "2px solid transparent", cursor: "pointer", background: "none", padding: 0, textAlign: "left" }}
                                  title={item.name}>
                                  <div style={{ width: "100%", height: 50, backgroundImage: `url(${item.thumbnailUrl || item.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                                  <div style={{ fontSize: 9, padding: "3px 4px", color: "var(--dock-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
            </div>

            </>)}
            {/* ── Message Section ────────────────────────────────── */}
            <div style={{ padding: 12, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 10, background: "rgba(255,255,255,0.025)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <Icon name="text_fields" size={15} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--dock-text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("countdowns.message", "Message")}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.messageHint", "Add a short line below or above the timer.")}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("countdowns.messageText", "Message text")}</span>
                  <input
                    type="text"
                    value={editMessage.text}
                    onChange={(e) => setEditMessage((p) => ({ ...p, text: e.target.value }))}
                    placeholder={t("countdowns.messagePlaceholder", "e.g. Welcome to our service")}
                    style={{ background: "rgba(0,0,0,0.22)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, padding: "8px 9px", color: "var(--dock-text)", fontSize: 12, outline: "none" }}
                  />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--dock-text-dim)" }}>{t("common.color", "Color")}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="color" value={editMessage.color} onChange={(e) => setEditMessage((p) => ({ ...p, color: e.target.value }))}
                        style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", cursor: "pointer", padding: 1, background: "transparent" }} />
                      <input type="text" value={editMessage.color} onChange={(e) => setEditMessage((p) => ({ ...p, color: e.target.value }))}
                        style={{ background: "rgba(0,0,0,0.22)", border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", borderRadius: 7, padding: "8px 7px", color: "var(--dock-text)", fontSize: 11, outline: "none", fontFamily: "monospace", flex: 1, minWidth: 0 }} />
                    </div>
                  </label>
                  <div>
                    <span style={{ display: "block", marginBottom: 4, fontSize: 10, color: "var(--dock-text-dim)" }}>{t("ministry.position", "Position")}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["above", "below"] as const).map((pos) => (
                        <button key={pos} type="button" onClick={() => setEditMessage((p) => ({ ...p, position: pos }))}
                          style={{ flex: 1, padding: "8px 4px", borderRadius: 7, border: "1px solid var(--dock-border, rgba(255,255,255,0.1))", background: editMessage.position === pos ? "rgba(59,130,246,0.18)" : "rgba(0,0,0,0.18)", color: editMessage.position === pos ? "var(--dock-accent, #60a5fa)" : "var(--dock-text-dim)", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}>
                          {t(`countdowns.messagePosition.${pos}`, pos)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            </div>

            {/* Actions stay visible while the editor content scrolls. */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 18px", borderTop: "1px solid var(--dock-border, rgba(255,255,255,0.08))", background: "var(--dock-surface, #1e1e2e)", flexShrink: 0 }}>
              <button type="button" className="dock-btn dock-btn--small" onClick={() => setEditingCd(null)} style={{ fontSize: 11 }}>
                {t("common.cancel", "Cancel")}
              </button>
              <button type="button" className="dock-btn dock-btn--small dock-btn--success" onClick={async () => {
                const mins = parseFloat(editMinutes) || 0;
                const secs = Math.round(mins * 60);
                const updatedCd: CountdownConfig = {
                  ...editingCd,
                  title: editTitle.trim() || editingCd.title,
                  text: isLayoutDesign(editingCd) ? { ...editingCd.text, title: editTitle.trim() || editingCd.text.title, subtitle: editSubtitle.trim() } : editingCd.text,
                  timer: { ...editingCd.timer, durationSeconds: secs },
                  background: { ...editBg },
                  message: editMessage.text.trim() ? { ...editMessage } : undefined,
                };
                setCountdowns((prev) => prev.map((c) => c.id === editingCd.id ? updatedCd : c));
                setEditingCd(null);
              }} style={{ fontSize: 11 }}>
                {t("common.save", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimeStatic(cd: CountdownConfig): string {
  const sec = cd.timer.durationSeconds;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (cd.timer.showHours) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
