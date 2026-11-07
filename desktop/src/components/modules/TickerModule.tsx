/**
 * TickerModule.tsx — Ticker Control Panel
 *
 * Manage live broadcast ticker announcements.
 * Left panel: compose new messages + drag-reorderable queue.
 * Right panel: theme selection, heading, OBS scene targeting,
 *              scroll speed, position, loop toggle, live control, preview.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obsService } from "../../services/obsService";
import { obsSyncService } from "../../services/obsSyncService";
import { getDisplaySceneName } from "../../services/obsSceneTargets";
import { serviceStore } from "../../services/serviceStore";
import { getSettings as getMVSettings } from "../../multiview/mvStore";
import { resolveOverlayAssetUrl } from "../../services/overlayUrl";
import { lowerThirdObsService } from "../../lowerthirds/lowerThirdObsService";
import {
  TICKER_THEMES,
  type TickerThemeColors,
} from "./tickerThemes";
import {
  REMOTE_PRODUCTION_THEMES_UPDATED_EVENT,
  fetchRemoteProductionThemes,
  getCachedRemoteProductionThemes,
  type RemoteProductionTheme,
} from "../../services/remoteProductionThemes";
import {
  canonicalDockTickerThemeId,
  DEFAULT_DOCK_TICKER_THEME_OPTION,
  getAllDockTickerThemeOptions,
  renderDockTickerThemeHtml,
  type DockTickerThemeOption,
} from "../../dock/tickerThemeCatalog";
import { ObsScenesPanel } from "../shared/ObsScenesPanel";
import { checkEntitlementSync } from "../../services/entitlementClient";
import { useAuth } from "../../contexts/AuthContext";
import { getEffectivePlan } from "../../services/licenseService";
import "./ticker.css";
import Icon from "../Icon";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { getRecommendedPollingInterval } from "../../services/performanceManager";
import { applyTextCase, TEXT_CASE_CONVERSIONS } from "../../lowerthirds/textStyle";

const TICKER_SOURCE_NAME = "⚡ MCE Ticker Overlay";
const TICKER_HEIGHT = 80;
const TICKER_MIN_DURATION_SECONDS = 30;
const TICKER_MAX_DURATION_SECONDS = 30 * 60;
const TICKER_DURATION_OPTIONS = [30, 60, 90, 120, 180, 300] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TickerMessage {
  id: string;
  text: string;
  active: boolean;
}

interface TickerModuleProps {
  isActive?: boolean;
}

const TICKER_STORAGE_KEY = "ocs.ticker-messages";
const TICKER_SETTINGS_KEY = "ocs.ticker-settings";
const TICKER_TEMPLATES_KEY = "ocs-ticker-templates";
const MAX_CHARS = 140;

// ── Ticker Templates ──
interface TickerTemplate {
  id: string;
  label: string;
  text: string;
}

function loadTickerTemplates(): TickerTemplate[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(TICKER_TEMPLATES_KEY));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTickerTemplates(templates: TickerTemplate[]) {
  try {
    localStorage.setItem(getUserScopedKey(TICKER_TEMPLATES_KEY), JSON.stringify(templates));
  } catch { /* ignore */ }
}

function clampTickerDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60;
  return Math.max(TICKER_MIN_DURATION_SECONDS, Math.min(TICKER_MAX_DURATION_SECONDS, Math.round(seconds)));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `${mins}m`;
  return `${mins}m ${rem}s`;
}

interface TickerDurationConfig {
  durationSeconds: number;
  isInfinite: boolean;
}

function getTickerSystemDurationDefaults(): TickerDurationConfig {
  const settings = getMVSettings();
  return {
    durationSeconds: clampTickerDuration(settings.lowerThirdDefaultDurationSec || 60),
    isInfinite: false,
  };
}

function getTickerBranding(): { logoUrl: string; brandName: string } {
  const settings = getMVSettings();
  return {
    logoUrl: resolveOverlayAssetUrl(settings.brandLogoPath),
    brandName: settings.churchName || "MakeChurchEazy",
  };
}

function getTickerOptionColors(option: DockTickerThemeOption): TickerThemeColors {
  if (option.source === "dock" || option.source === "remote") {
    return option.theme.defaultColors;
  }
  return {
    accent: option.accentColor,
    accentText: "#FFFFFF",
    barBg: "#0F172A",
    barText: "#F8FAFC",
    separator: option.accentColor,
  };
}

function getTickerOptionFontFamily(option: DockTickerThemeOption): string {
  if (option.source === "dock" || option.source === "remote") {
    return option.theme.fontFamily;
  }
  return "'Inter', 'Segoe UI', sans-serif";
}

function resolveDurationConfig(settings: Pick<TickerSettings, "durationSeconds" | "useSystemDefaults" | "isInfinite">): TickerDurationConfig {
  if (settings.useSystemDefaults) {
    return getTickerSystemDurationDefaults();
  }
  return {
    durationSeconds: clampTickerDuration(settings.durationSeconds),
    isInfinite: settings.isInfinite,
  };
}

function formatDurationMode(config: TickerDurationConfig): string {
  return config.isInfinite ? "Infinity" : formatDuration(config.durationSeconds);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadMessages(): TickerMessage[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(TICKER_STORAGE_KEY));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveMessages(msgs: TickerMessage[]) {
  try { localStorage.setItem(getUserScopedKey(TICKER_STORAGE_KEY), JSON.stringify(msgs)); } catch { /* ignore */ }
}

interface TickerSettings {
  scene: string;
  speed: number;
  position: "top" | "bottom";
  loop: boolean;
  themeId: string;
  heading: string;
  durationSeconds: number;
  useSystemDefaults: boolean;
  isInfinite: boolean;
}

function loadSettings(): TickerSettings {
  const defaultTheme = TICKER_THEMES[0];
  const systemDefaults = getTickerSystemDurationDefaults();
  try {
    const raw = localStorage.getItem(getUserScopedKey(TICKER_SETTINGS_KEY));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TickerSettings> & Record<string, unknown>;
      const parsedTheme = TICKER_THEMES.find((theme) => theme.id === parsed.themeId) ?? defaultTheme;
      const parsedUseSystemDefaults = typeof parsed.useSystemDefaults === "boolean" ? parsed.useSystemDefaults : false;
      return {
        scene: typeof parsed.scene === "string" ? parsed.scene : "",
        speed: typeof parsed.speed === "number" ? Math.max(1, Math.min(100, parsed.speed)) : 50,
        position: parsed.position === "top" ? "top" : "bottom",
        loop: typeof parsed.loop === "boolean" ? parsed.loop : true,
        themeId: parsedTheme.id,
        heading: typeof parsed.heading === "string" && parsed.heading.trim()
          ? parsed.heading.slice(0, 20)
          : parsedTheme.defaultHeading,
        durationSeconds: clampTickerDuration(typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : systemDefaults.durationSeconds),
        useSystemDefaults: parsedUseSystemDefaults,
        isInfinite: parsedUseSystemDefaults ? false : (typeof parsed.isInfinite === "boolean" ? parsed.isInfinite : false),
      };
    }
  } catch { /* ignore */ }
  return {
    scene: "",
    speed: 50,
    position: "bottom",
    loop: true,
    themeId: defaultTheme.id,
    heading: defaultTheme.defaultHeading,
    durationSeconds: systemDefaults.durationSeconds,
    useSystemDefaults: true,
    isInfinite: false,
  };
}

function saveSettings(s: TickerSettings) {
  try { localStorage.setItem(getUserScopedKey(TICKER_SETTINGS_KEY), JSON.stringify(s)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TickerModule({ isActive = true }: TickerModuleProps) {
  const { user: authUser } = useAuth();
  const effectivePlan = getEffectivePlan(authUser);
  const [messages, setMessages] = useState<TickerMessage[]>(loadMessages);
  const [newText, setNewText] = useState("");
  const [templates, setTemplates] = useState<TickerTemplate[]>(() => loadTickerTemplates());
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateLabel, setTemplateLabel] = useState("");
  const [settings, setSettings] = useState<TickerSettings>(loadSettings);
  const [remoteProductionThemes, setRemoteProductionThemes] = useState<RemoteProductionTheme[]>(() => getCachedRemoteProductionThemes());
  const [themeOpen, setThemeOpen] = useState(false);
  const [scenes, setScenes] = useState<string[]>([]);
  const [programScene, setProgramScene] = useState("");
  const [activeTickerScene, setActiveTickerScene] = useState("");
  const [scenesRefreshing, setScenesRefreshing] = useState(false);
  const [liveToggleBusy, setLiveToggleBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: "success" | "error" }>>([]);

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // OBS ticker source tracking
  const sceneItemIdRef = useRef<number | null>(null);
  const tickerSceneRef = useRef<string>("");    // scene it was added to
  const lastFullProbeTimeRef = useRef(0);
  const sceneSyncBusyRef = useRef(false);
  const toastSeqRef = useRef(0);
  const toastTimersRef = useRef<number[]>([]);
  const autoStopTimeoutRef = useRef<number | null>(null);
  const autoStopIntervalRef = useRef<number | null>(null);
  const autoStopDeadlineRef = useRef<number | null>(null);
  const [autoStopRemainingSeconds, setAutoStopRemainingSeconds] = useState<number | null>(null);
  const [activeDurationTotalSeconds, setActiveDurationTotalSeconds] = useState(0);
  const [activeDurationInfinite, setActiveDurationInfinite] = useState(false);
  const availableTickerThemes = useMemo(() => {
    return getAllDockTickerThemeOptions(remoteProductionThemes);
  }, [remoteProductionThemes]);

  // Persist messages
  useEffect(() => { saveMessages(messages); }, [messages]);
  // Persist settings
  useEffect(() => { saveSettings(settings); }, [settings]);

  useEffect(() => {
    const syncCachedRemoteThemes = () => setRemoteProductionThemes(getCachedRemoteProductionThemes());
    syncCachedRemoteThemes();
    void fetchRemoteProductionThemes().then(setRemoteProductionThemes);
    window.addEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
    return () => window.removeEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
  }, []);

  useEffect(() => {
    setSettings((current) => {
      if (availableTickerThemes.some((theme) => theme.id === current.themeId)) return current;
      const fallback = availableTickerThemes[0] ?? DEFAULT_DOCK_TICKER_THEME_OPTION;
      return {
        ...current,
        themeId: fallback.id,
        heading: current.heading || fallback.defaultHeading,
      };
    });
  }, [availableTickerThemes]);

  // OBS connection status
  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  const pushToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    const id = Date.now() + (toastSeqRef.current++);
    setToasts((prev) => [...prev.slice(-3), { id, msg, type }]);
    const timerId = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimersRef.current = toastTimersRef.current.filter((entry) => entry !== timerId);
    }, 2800);
    toastTimersRef.current.push(timerId);
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of toastTimersRef.current) {
        window.clearTimeout(timerId);
      }
      toastTimersRef.current = [];
    };
  }, []);

  const clearAutoStopTimers = useCallback(() => {
    if (autoStopTimeoutRef.current !== null) {
      window.clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (autoStopIntervalRef.current !== null) {
      window.clearInterval(autoStopIntervalRef.current);
      autoStopIntervalRef.current = null;
    }
    autoStopDeadlineRef.current = null;
    setAutoStopRemainingSeconds(null);
  }, []);

  const effectiveDurationConfig = useMemo(
    () => resolveDurationConfig(settings),
    [settings.durationSeconds, settings.isInfinite, settings.useSystemDefaults],
  );

  const refreshScenes = useCallback(async () => {
    if (!obsService.isConnected) {
      clearAutoStopTimers();
      setActiveDurationTotalSeconds(0);
      setActiveDurationInfinite(false);
      setScenes([]);
      setProgramScene("");
      tickerSceneRef.current = "";
      sceneItemIdRef.current = null;
      setActiveTickerScene("");
      setRunning(false);
      return;
    }
    const list = await obsService.getSceneList();
    const names = list.map((s) => s.sceneName);
    setScenes(names);

    setSettings((prev) => {
      if (prev.scene && names.includes(prev.scene)) return prev;
      const mainScene = serviceStore.sceneMapping.mainScene;
      const defaultScene = mainScene && names.includes(mainScene) ? mainScene : names[0] ?? "";
      return { ...prev, scene: defaultScene };
    });

    setProgramScene(getDisplaySceneName(await obsService.getCurrentProgramScene()));

    const probeScenes = tickerSceneRef.current && names.includes(tickerSceneRef.current)
      ? [tickerSceneRef.current, ...names.filter((sceneName) => sceneName !== tickerSceneRef.current)]
      : names;

    let detectedTicker: { sceneName: string; sceneItemId: number } | null = null;
    const FULL_PROBE_INTERVAL_MS = 30_000;
    const now = Date.now();
    const shouldFullProbe = !tickerSceneRef.current
      || sceneItemIdRef.current === null
      || !names.includes(tickerSceneRef.current)
      || (now - lastFullProbeTimeRef.current) >= FULL_PROBE_INTERVAL_MS;

    if (shouldFullProbe) {
      // Full O(N) scan: check input list + probe every scene
      try {
        const inputs = await obsService.getInputList();
        const tickerInputExists = inputs.some((input) => input.inputName === TICKER_SOURCE_NAME);
        if (tickerInputExists) {
          for (const sceneName of probeScenes) {
            try {
              const items = await obsService.getSceneItemList(sceneName);
              const tickerItem = items.find((item) => item.sourceName === TICKER_SOURCE_NAME);
              if (tickerItem) {
                detectedTicker = { sceneName, sceneItemId: tickerItem.sceneItemId };
                break;
              }
            } catch {
              // Scene may be unavailable while OBS updates.
            }
          }
        }
      } catch (err) {
        console.warn("[TickerModule] Failed to inspect ticker source state:", err);
      }
      lastFullProbeTimeRef.current = now;
    } else if (tickerSceneRef.current) {
      // Quick verify: just check the known scene (1 call instead of N)
      try {
        const items = await obsService.getSceneItemList(tickerSceneRef.current);
        const tickerItem = items.find((item) => item.sourceName === TICKER_SOURCE_NAME);
        if (tickerItem) {
          detectedTicker = { sceneName: tickerSceneRef.current, sceneItemId: tickerItem.sceneItemId };
        }
      } catch {
        // Known scene unavailable — next tick will do a full probe
      }
    }

    if (detectedTicker) {
      const previousTickerScene = tickerSceneRef.current;
      if (previousTickerScene && previousTickerScene !== detectedTicker.sceneName) {
        try {
          await lowerThirdObsService.syncTickerClearanceForScene(previousTickerScene);
        } catch {
          // Best-effort.
        }
      }
      try {
        await lowerThirdObsService.syncTickerClearanceForScene(detectedTicker.sceneName);
      } catch {
        // Best-effort.
      }
      tickerSceneRef.current = detectedTicker.sceneName;
      sceneItemIdRef.current = detectedTicker.sceneItemId;
      setActiveTickerScene(detectedTicker.sceneName);
      setRunning(true);
      setSettings((prev) => (
        prev.scene === detectedTicker.sceneName
          ? prev
          : { ...prev, scene: detectedTicker.sceneName }
      ));
      return;
    }

    if (tickerSceneRef.current || sceneItemIdRef.current !== null || running) {
      const previousTickerScene = tickerSceneRef.current;
      if (previousTickerScene) {
        try {
          await lowerThirdObsService.syncTickerClearanceForScene(previousTickerScene);
        } catch {
          // Best-effort.
        }
      }
      clearAutoStopTimers();
      setActiveDurationTotalSeconds(0);
      setActiveDurationInfinite(false);
      tickerSceneRef.current = "";
      sceneItemIdRef.current = null;
      setActiveTickerScene("");
      setRunning(false);
    }
  }, [clearAutoStopTimers, running]);

  const handleRefreshScenes = useCallback(async () => {
    setScenesRefreshing(true);
    try {
      await refreshScenes();
      pushToast("OBS scenes refreshed");
    } catch (err) {
      console.warn("[TickerModule] Failed to refresh scenes:", err);
      pushToast("Failed to refresh OBS scenes", "error");
    } finally {
      setScenesRefreshing(false);
    }
  }, [refreshScenes, pushToast]);

  useEffect(() => {
    if (!isActive) return;

    if (!obsConnected) {
      clearAutoStopTimers();
      setActiveDurationTotalSeconds(0);
      setActiveDurationInfinite(false);
      setScenes([]);
      setProgramScene("");
      tickerSceneRef.current = "";
      sceneItemIdRef.current = null;
      setActiveTickerScene("");
      setRunning(false);
      return;
    }
    const poll = async () => {
      if (sceneSyncBusyRef.current) return;
      sceneSyncBusyRef.current = true;
      try {
        await refreshScenes();
      } catch (err) {
        console.warn("[TickerModule] Scene polling failed:", err);
      } finally {
        sceneSyncBusyRef.current = false;
      }
    };
    poll();
    const iv = window.setInterval(poll, getRecommendedPollingInterval(3000));
    return () => window.clearInterval(iv);
  }, [isActive, obsConnected, refreshScenes, clearAutoStopTimers]);

  // Add message — splits multiline input into separate messages
  const handleAdd = useCallback(() => {
    const raw = newText.trim();
    if (!raw) return;
    const { allowed } = checkEntitlementSync("tickers", effectivePlan);
    if (!allowed) {
      pushToast("Upgrade your plan to use tickers", "error");
      return;
    }
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const newMessages: TickerMessage[] = lines.map((text) => ({
      id: generateId(),
      text,
      active: true,
    }));
    // New announcements should appear first in Active Messages.
    setMessages((prev) => [...newMessages, ...prev]);
    pushToast(
      newMessages.length === 1
        ? "Ticker message added"
        : `${newMessages.length} ticker messages added`,
      "success",
    );
    setNewText("");
    textareaRef.current?.focus();
  }, [newText, pushToast]);

  // Delete message
  const handleDelete = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    pushToast("Ticker message removed", "success");
  }, [pushToast]);

  // Clear all
  const handleClearAll = useCallback(() => {
    setMessages([]);
    pushToast("All ticker messages cleared", "success");
  }, [pushToast]);

  // Start editing
  const handleStartEdit = useCallback((msg: TickerMessage) => {
    setEditingId(msg.id);
    setEditText(msg.text);
  }, []);

  // Save edit
  const handleSaveEdit = useCallback((id: string) => {
    const trimmed = editText.trim();
    if (trimmed) {
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, text: trimmed } : m));
      pushToast("Ticker message updated", "success");
    }
    setEditingId(null);
    setEditText("");
  }, [editText, pushToast]);

  // Cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const fallbackIdx = Number(e.dataTransfer.getData("text/plain"));
    const sourceIdx = dragIdx ?? (Number.isFinite(fallbackIdx) ? fallbackIdx : null);
    if (sourceIdx === null || sourceIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    setMessages((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(sourceIdx, 1);
      if (!moved) return prev;
      copy.splice(idx, 0, moved);
      return copy;
    });
    pushToast("Ticker message order updated", "success");
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, pushToast]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const stopTicker = useCallback(async (): Promise<boolean> => {
    let ok = true;
    clearAutoStopTimers();
    const candidates = Array.from(new Set([settings.scene, tickerSceneRef.current].filter(Boolean)));
    try {
      for (const sceneName of candidates) {
        try {
          const items = await obsService.getSceneItemList(sceneName);
          const tickerItem = items.find((i) => i.sourceName === TICKER_SOURCE_NAME);
          if (tickerItem) {
            await obsService.call("RemoveSceneItem", {
              sceneName,
              sceneItemId: tickerItem.sceneItemId,
            } as never);
          }
        } catch {
          // Scene may no longer exist.
        }
      }
      try {
        await obsService.call("RemoveInput", { inputName: TICKER_SOURCE_NAME } as never);
      } catch {
        // Source may already be gone.
      }
    } catch (err) {
      console.error("[TickerModule] Failed to stop ticker:", err);
      ok = false;
    }
    for (const sceneName of candidates) {
      try {
        await lowerThirdObsService.syncTickerClearanceForScene(sceneName);
      } catch {
        // Best-effort.
      }
    }
    sceneItemIdRef.current = null;
    tickerSceneRef.current = "";
    setActiveTickerScene("");
    setActiveDurationTotalSeconds(0);
    setActiveDurationInfinite(false);
    setRunning(false);
    // Trigger centralized sync after stopping ticker
    obsSyncService.sync("ticker:stop").catch(() => { });
    return ok;
  }, [clearAutoStopTimers, settings.scene]);

  const scheduleAutoStop = useCallback((durationSeconds: number) => {
    clearAutoStopTimers();
    const safeSeconds = clampTickerDuration(durationSeconds);
    const deadline = Date.now() + safeSeconds * 1000;
    autoStopDeadlineRef.current = deadline;
    setAutoStopRemainingSeconds(safeSeconds);

    autoStopIntervalRef.current = window.setInterval(() => {
      const end = autoStopDeadlineRef.current;
      if (end === null) return;
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setAutoStopRemainingSeconds(remaining);
      if (remaining <= 0 && autoStopIntervalRef.current !== null) {
        window.clearInterval(autoStopIntervalRef.current);
        autoStopIntervalRef.current = null;
      }
    }, 1000);

    autoStopTimeoutRef.current = window.setTimeout(() => {
      clearAutoStopTimers();
      (async () => {
        const ok = await stopTicker();
        pushToast(
          ok
            ? `Ticker auto-stopped after ${formatDuration(safeSeconds)}`
            : "Ticker auto-stop failed",
          ok ? "success" : "error",
        );
      })();
    }, safeSeconds * 1000);
  }, [clearAutoStopTimers, pushToast, stopTicker]);

  const applyActiveDurationMode = useCallback((config: TickerDurationConfig) => {
    if (config.isInfinite) {
      clearAutoStopTimers();
      setActiveDurationTotalSeconds(0);
      setActiveDurationInfinite(true);
      return;
    }
    setActiveDurationInfinite(false);
    setActiveDurationTotalSeconds(config.durationSeconds);
    scheduleAutoStop(config.durationSeconds);
  }, [clearAutoStopTimers, scheduleAutoStop]);

  const startTickerInScene = useCallback(async (sceneName: string): Promise<boolean> => {
    if (!obsConnected || !sceneName) return false;
    const activeMessages = messages.filter((m) => m.active).map((m) => m.text);
    if (activeMessages.length === 0) return false;

    const theme = availableTickerThemes.find((t) => t.id === canonicalDockTickerThemeId(settings.themeId)) ?? availableTickerThemes[0] ?? DEFAULT_DOCK_TICKER_THEME_OPTION;
    const branding = getTickerBranding();
    const html = renderDockTickerThemeHtml({
      option: theme,
      heading: settings.heading,
      messages: activeMessages,
      speed: settings.speed,
      position: settings.position,
      loop: settings.loop,
      paused: false,
      brandLogoUrl: branding.logoUrl,
      brandName: branding.brandName,
    });
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);

    try {
      const video = await obsService.getVideoSettings();
      const canvasW = video.baseWidth;
      const canvasH = video.baseHeight;
      const inputs = await obsService.getInputList();
      const existing = inputs.find((i) => i.inputName === TICKER_SOURCE_NAME);

      if (tickerSceneRef.current && tickerSceneRef.current !== sceneName) {
        try {
          const prevItems = await obsService.getSceneItemList(tickerSceneRef.current);
          const prev = prevItems.find((i) => i.sourceName === TICKER_SOURCE_NAME);
          if (prev) {
            await obsService.call("RemoveSceneItem", {
              sceneName: tickerSceneRef.current,
              sceneItemId: prev.sceneItemId,
            } as never);
          }
        } catch {
          // Previous scene may have been deleted.
        }
      }

      let sceneItemId: number;
      if (existing) {
        await obsService.call("SetInputSettings", {
          inputName: TICKER_SOURCE_NAME,
          inputSettings: { url: dataUrl, width: canvasW, height: TICKER_HEIGHT },
        } as never);
        const sceneItems = await obsService.getSceneItemList(sceneName);
        const inScene = sceneItems.find((si) => si.sourceName === TICKER_SOURCE_NAME);
        sceneItemId = inScene ? inScene.sceneItemId : await obsService.createSceneItem(sceneName, TICKER_SOURCE_NAME);
      } else {
        sceneItemId = await obsService.createInput(sceneName, TICKER_SOURCE_NAME, "browser_source", {
          url: dataUrl,
          width: canvasW,
          height: TICKER_HEIGHT,
          css: "",
        });
      }

      const posY = settings.position === "top" ? 0 : canvasH - TICKER_HEIGHT;
      await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: 0,
        positionY: posY,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth: canvasW,
        boundsHeight: TICKER_HEIGHT,
        boundsAlignment: 0,
      });

      const allItems = await obsService.getSceneItemList(sceneName);
      await obsService.setSceneItemIndex(sceneName, sceneItemId, allItems.length - 1);
      await lowerThirdObsService.syncTickerClearanceForScene(sceneName);

      sceneItemIdRef.current = sceneItemId;
      tickerSceneRef.current = sceneName;
      setActiveTickerScene(sceneName);
      setRunning(true);
      setSettings((prev) => ({ ...prev, scene: sceneName }));
      applyActiveDurationMode(resolveDurationConfig(settings));
      // Trigger centralized sync after starting ticker
      obsSyncService.sync("ticker:start").catch(() => { });
      return true;
    } catch (err) {
      console.error(`[TickerModule] Failed to start ticker in "${sceneName}":`, err);
      return false;
    }
  }, [obsConnected, messages, applyActiveDurationMode, settings, availableTickerThemes]);

  const sendTickerToScene = useCallback(async (
    sceneName: string,
    _mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!sceneName) return;
    const ok = await startTickerInScene(sceneName);
    pushToast(
      ok ? `Ticker sent to "${sceneName}"` : `Failed to send ticker to "${sceneName}"`,
      ok ? "success" : "error",
    );
  }, [startTickerInScene, pushToast]);

  const handleToggleTicker = useCallback(async () => {
    if (running) {
      setLiveToggleBusy(true);
      try {
        const ok = await stopTicker();
        pushToast(ok ? "Ticker stopped" : "Ticker stop failed", ok ? "success" : "error");
      } finally {
        setLiveToggleBusy(false);
      }
      return;
    }
    if (!obsConnected) {
      pushToast("Connect to OBS before starting ticker", "error");
      return;
    }

    let targetScene = activeTickerScene || settings.scene;
    if (!targetScene) {
      try {
        targetScene = await obsService.getCurrentPreviewScene();
      } catch {
        targetScene = "";
      }
    }
    if (!targetScene) {
      try {
        targetScene = await obsService.getCurrentProgramScene();
      } catch {
        targetScene = "";
      }
    }
    if (!targetScene && scenes.length > 0) {
      targetScene = scenes[0];
    }
    if (!targetScene) {
      pushToast("No target scene found in OBS", "error");
      return;
    }

    setLiveToggleBusy(true);
    try {
      const ok = await startTickerInScene(targetScene);
      pushToast(
        ok ? `Ticker started on "${targetScene}"` : `Failed to start ticker on "${targetScene}"`,
        ok ? "success" : "error",
      );
    } finally {
      setLiveToggleBusy(false);
    }
  }, [running, obsConnected, stopTicker, pushToast, activeTickerScene, settings.scene, scenes, startTickerInScene]);

  // Keyboard handler for textarea — Enter to add
  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }, [handleAdd]);

  // Global shortcuts
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        handleToggleTicker();
      }
      if (meta && e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        setMessages([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, handleToggleTicker]);

  // ── Live-update OBS source when settings change while running ──
  useEffect(() => {
    if (!running || !obsConnected || !tickerSceneRef.current) return;

    const activeMessages = messages.filter((m) => m.active).map((m) => m.text);
    if (activeMessages.length === 0) return;

    const theme = availableTickerThemes.find((t) => t.id === canonicalDockTickerThemeId(settings.themeId)) ?? availableTickerThemes[0] ?? DEFAULT_DOCK_TICKER_THEME_OPTION;
    const branding = getTickerBranding();
    const html = renderDockTickerThemeHtml({
      option: theme,
      heading: settings.heading,
      messages: activeMessages,
      speed: settings.speed,
      position: settings.position,
      loop: settings.loop,
      paused: false,
      brandLogoUrl: branding.logoUrl,
      brandName: branding.brandName,
    });
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);

    // Debounce updates slightly to avoid hammering OBS on rapid slider changes
    const timer = setTimeout(async () => {
      try {
        const video = await obsService.getVideoSettings();
        const canvasW = video.baseWidth;
        const canvasH = video.baseHeight;

        await obsService.call("SetInputSettings", {
          inputName: TICKER_SOURCE_NAME,
          inputSettings: { url: dataUrl, width: canvasW, height: TICKER_HEIGHT },
        } as never);

        // Re-position if position changed
        if (sceneItemIdRef.current !== null) {
          const posY = settings.position === "top" ? 0 : canvasH - TICKER_HEIGHT;
          await obsService.setSceneItemTransform(tickerSceneRef.current, sceneItemIdRef.current, {
            positionX: 0,
            positionY: posY,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: canvasW,
            boundsHeight: TICKER_HEIGHT,
            boundsAlignment: 0,
          });
          await lowerThirdObsService.syncTickerClearanceForScene(tickerSceneRef.current);
        }
      } catch (err) {
        console.error("[TickerModule] Failed to live-update ticker:", err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [running, obsConnected, settings.themeId, settings.heading, settings.speed, settings.position, settings.loop, messages, availableTickerThemes]);

  // ── Cleanup: stop ticker when component unmounts ──
  useEffect(() => {
    return () => {
      clearAutoStopTimers();
      if (sceneItemIdRef.current !== null && tickerSceneRef.current) {
        // Best-effort cleanup
        obsService.call("RemoveInput", { inputName: TICKER_SOURCE_NAME } as never).catch(() => { });
      }
    };
  }, [clearAutoStopTimers]);

  // ── Theme helpers ──
  const activeTheme: DockTickerThemeOption =
    availableTickerThemes.find((t) => t.id === canonicalDockTickerThemeId(settings.themeId)) ?? availableTickerThemes[0] ?? DEFAULT_DOCK_TICKER_THEME_OPTION;
  const activeThemeColors = getTickerOptionColors(activeTheme);
  const activeThemeFontFamily = getTickerOptionFontFamily(activeTheme);

  const handleSelectTheme = useCallback((theme: DockTickerThemeOption) => {
    setSettings((prev) => ({
      ...prev,
      themeId: theme.id,
      heading: theme.defaultHeading,
    }));
    setThemeOpen(false);
    pushToast(`Ticker theme changed to ${theme.name}`);
  }, [pushToast]);

  const handleHeadingChange = useCallback((value: string) => {
    setSettings((prev) => ({ ...prev, heading: value }));
  }, []);

  const handleSetPosition = useCallback((position: "top" | "bottom") => {
    if (settings.position === position) return;
    setSettings((prev) => ({ ...prev, position }));
    pushToast(`Ticker position set to ${position}`);
  }, [settings.position, pushToast]);

  const handleSetLoop = useCallback((loop: boolean) => {
    if (settings.loop === loop) return;
    setSettings((prev) => ({ ...prev, loop }));
    pushToast(loop ? "Ticker looping enabled" : "Ticker looping disabled");
  }, [settings.loop, pushToast]);

  const handleSetDuration = useCallback((durationSeconds: number) => {
    const next = clampTickerDuration(durationSeconds);
    if (!settings.useSystemDefaults && !settings.isInfinite && settings.durationSeconds === next) return;
    setSettings((prev) => ({
      ...prev,
      durationSeconds: next,
      useSystemDefaults: false,
      isInfinite: false,
    }));
    if (running) {
      applyActiveDurationMode({ durationSeconds: next, isInfinite: false });
    }
    pushToast(`Ticker duration set to ${formatDuration(next)}`);
  }, [applyActiveDurationMode, pushToast, running, settings.durationSeconds, settings.isInfinite, settings.useSystemDefaults]);

  const handleToggleInfiniteDuration = useCallback(() => {
    const nextInfinite = !effectiveDurationConfig.isInfinite;
    setSettings((prev) => ({
      ...prev,
      useSystemDefaults: false,
      isInfinite: nextInfinite,
    }));
    if (running) {
      applyActiveDurationMode({
        durationSeconds: clampTickerDuration(settings.durationSeconds),
        isInfinite: nextInfinite,
      });
    }
    pushToast(nextInfinite ? "Ticker duration set to Infinity" : `Ticker duration set to ${formatDuration(clampTickerDuration(settings.durationSeconds))}`);
  }, [applyActiveDurationMode, effectiveDurationConfig.isInfinite, pushToast, running, settings.durationSeconds]);

  const handleToggleUseSystemDefaults = useCallback(() => {
    const nextUseSystemDefaults = !settings.useSystemDefaults;
    const nextConfig = resolveDurationConfig({
      durationSeconds: settings.durationSeconds,
      isInfinite: nextUseSystemDefaults ? false : settings.isInfinite,
      useSystemDefaults: nextUseSystemDefaults,
    });
    setSettings((prev) => ({
      ...prev,
      useSystemDefaults: nextUseSystemDefaults,
      isInfinite: nextUseSystemDefaults ? false : prev.isInfinite,
    }));
    if (running) {
      applyActiveDurationMode(nextConfig);
    }
    pushToast(
      nextUseSystemDefaults
        ? `Using system defaults (${formatDurationMode(nextConfig)})`
        : "Using custom ticker duration",
    );
  }, [applyActiveDurationMode, pushToast, running, settings.durationSeconds, settings.isInfinite, settings.useSystemDefaults]);

  // ── Live preview HTML ──
  const previewMessages = messages.length > 0
    ? messages.map((m) => m.text)
    : ["Welcome to the service", "Join us for worship today", "Visit our website for more info"];

  const previewHTML = useMemo(
    () => {
      const branding = getTickerBranding();
      return renderDockTickerThemeHtml({
        option: activeTheme,
        heading: settings.heading,
        messages: previewMessages,
        speed: settings.speed,
        position: settings.position,
        loop: settings.loop,
        paused: false,
        brandLogoUrl: branding.logoUrl,
        brandName: branding.brandName,
      });
    },
    [activeTheme, settings.heading, previewMessages, settings.speed, settings.position, settings.loop],
  );

  const previewDataUrl = useMemo(
    () => "data:text/html;charset=utf-8," + encodeURIComponent(previewHTML),
    [previewHTML],
  );

  const countdownProgressPct = useMemo(() => {
    if (!running || activeDurationInfinite || activeDurationTotalSeconds <= 0 || autoStopRemainingSeconds === null) {
      return 0;
    }
    const elapsed = Math.max(0, activeDurationTotalSeconds - autoStopRemainingSeconds);
    return Math.max(0, Math.min(100, (elapsed / activeDurationTotalSeconds) * 100));
  }, [running, activeDurationInfinite, activeDurationTotalSeconds, autoStopRemainingSeconds]);

  const tickerNowShowingSubtitle = useMemo(() => {
    if (activeTickerScene) return `Live on ${activeTickerScene}`;
    return "Ticker is active on OBS";
  }, [activeTickerScene]);

  return (
    <div className="ticker-root">
      <div className="ticker-grid">
        {/* ── Left Panel ── */}
        <div className="ticker-left">
          <div className="ticker-left-header">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <h2>Ticker Control</h2>
              <span style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 400 }}>/</span>
              <p style={{ margin: 0 }}>Manage live broadcast ticker announcements</p>
            </div>
          </div>

          <div className="ticker-left-scroll">


            <div className="ticker-live-preview-top">
              <label className="ticker-field-label">Live Preview</label>
              <div className="ticker-live-preview-wrap">
                <span className="ticker-live-preview-label">Preview</span>
                <iframe
                  className="ticker-live-preview-frame"
                  src={previewDataUrl}
                  title="Ticker preview"
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
            </div>

            {running && (
              <div className="ticker-now-showing">
                <div className="ticker-now-showing-left">
                  <div className="ticker-now-showing-badge ticker-now-showing-badge--live">
                    LIVE
                  </div>
                  <div className="ticker-now-showing-info">
                    <span className="ticker-now-showing-label">{settings.heading || activeTheme.defaultHeading}</span>
                    <span className="ticker-now-showing-sub">{tickerNowShowingSubtitle}</span>
                  </div>
                </div>
                <div className="ticker-now-showing-center">
                  {!activeDurationInfinite && autoStopRemainingSeconds !== null && activeDurationTotalSeconds > 0 ? (
                    <>
                      <span className="ticker-now-showing-timer">{Math.max(0, autoStopRemainingSeconds)}s</span>
                      <div className="ticker-now-showing-progress">
                        <div
                          className="ticker-now-showing-progress-bar"
                          style={{ width: `${countdownProgressPct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="ticker-now-showing-pinned">
                      <Icon name="all_inclusive" size={13} />
                      Infinite
                    </span>
                  )}
                </div>
                <div className="ticker-now-showing-actions">
                  <button
                    type="button"
                    className="ticker-now-showing-btn"
                    onClick={handleToggleInfiniteDuration}
                    title={activeDurationInfinite ? "Set timed duration" : "Set infinity duration"}
                  >
                    <Icon name={activeDurationInfinite ? "timer" : "all_inclusive"} size={14} />
                  </button>
                  <button
                    type="button"
                    className="ticker-now-showing-btn ticker-now-showing-btn--clear"
                    onClick={() => { void handleToggleTicker(); }}
                    disabled={liveToggleBusy}
                    title="Remove ticker from OBS"
                  >
                    <Icon name="clear" size={14} />
                    Remove From OBS
                  </button>
                </div>
              </div>
            )}

            <div className="ticker-main-grid">
              <div className="ticker-main-primary">
                <div>
                  <label className="ticker-field-label">Heading</label>
                  <input
                    type="text"
                    className="ticker-heading-input"
                    value={settings.heading}
                    onChange={(e) => handleHeadingChange(e.target.value.slice(0, 20))}
                    placeholder="LIVE"
                    maxLength={20}
                  />
                </div>

                <div>
                  <p className="ticker-input-section-label">New Announcement</p>
                  <div className="ticker-input-card">
                    <textarea
                      ref={textareaRef}
                      className="ticker-textarea"
                      placeholder="Type your announcement message here..."
                      value={newText}
                      onChange={(e) => setNewText(e.target.value.slice(0, MAX_CHARS))}
                      onKeyDown={handleTextareaKeyDown}
                    />
                    <div className="ticker-case-row" role="group" aria-label="Text case">
                      {TEXT_CASE_CONVERSIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className="ticker-case-btn"
                          onClick={() => setNewText((text) => applyTextCase(text, opt.value).slice(0, MAX_CHARS))}
                          disabled={!newText.trim()}
                          title={opt.hint}
                          aria-label={opt.hint}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="ticker-input-footer">
                      <span className={`ticker-char-count${newText.length >= MAX_CHARS ? " ticker-char-count--full" : ""}`}>{newText.length}/{MAX_CHARS}</span>
                      <button
                        type="button"
                        className="ticker-add-btn"
                        onClick={handleAdd}
                        disabled={!newText.trim()}
                        title="Add">
                        <Icon name="add_circle" size={20} />
                        Add to Queue
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Saved Templates ── */}
                <div className="ticker-templates">
                  <button
                    type="button"
                    className="ticker-templates__toggle"
                    onClick={() => setShowTemplates(!showTemplates)}
                    title="Bookmark">
                    <Icon name="bookmark" size={14} />
                    Templates {templates.length > 0 && `(${templates.length})`}
                    <Icon name={showTemplates ? "expand_less" : "expand_more"} size={14} />
                  </button>
                  {showTemplates && (
                    <div className="ticker-templates__body">
                      {newText.length > 0 && (
                        <div className="ticker-templates__save">
                          <input
                            type="text"
                            placeholder="Template name..."
                            value={templateLabel}
                            onChange={(e) => setTemplateLabel(e.target.value)}
                            className="ticker-templates__label-input"
                          />
                          <button
                            className="ticker-templates__save-btn"
                            onClick={() => {
                              if (!templateLabel.trim() || !newText.trim()) return;
                              const newTemplate: TickerTemplate = {
                                id: `tmpl-${Date.now()}`,
                                label: templateLabel.trim(),
                                text: newText.trim(),
                              };
                              const updated = [...templates, newTemplate];
                              setTemplates(updated);
                              saveTickerTemplates(updated);
                              setTemplateLabel("");
                            }}
                            disabled={!templateLabel.trim() || !newText.trim()}
                            title="Save">
                            <Icon name="save" size={12} /> Save
                          </button>
                        </div>
                      )}
                      {templates.length === 0 ? (
                        <p className="ticker-templates__empty">No saved templates yet. Type a message above and save it as a template.</p>
                      ) : (
                        <div className="ticker-templates__list">
                          {templates.map((tmpl) => (
                            <div key={tmpl.id} className="ticker-templates__item">
                              <span className="ticker-templates__item-label">{tmpl.label}</span>
                              <span className="ticker-templates__item-text">{tmpl.text.slice(0, 50)}{tmpl.text.length > 50 ? "..." : ""}</span>
                              <div className="ticker-templates__item-actions">
                                <button
                                  className="ticker-templates__use-btn"
                                  onClick={() => setNewText(tmpl.text)}
                                  title="Use this template"
                                >
                                  <Icon name="content_copy" size={12} />
                                </button>
                                <button
                                  className="ticker-templates__delete-btn"
                                  onClick={() => {
                                    const updated = templates.filter((t) => t.id !== tmpl.id);
                                    setTemplates(updated);
                                    saveTickerTemplates(updated);
                                  }}
                                  title="Delete template"
                                >
                                  <Icon name="delete" size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="ticker-list-header">
                    <span className="ticker-list-header-label">
                      Active Messages ({messages.length})
                    </span>
                    <span className="ticker-list-drag-hint">Drag to reorder</span>
                    {messages.length > 0 && (
                      <button type="button" className="ticker-clear-all-btn" onClick={handleClearAll} title="Clear">
                        Clear All
                      </button>
                    )}
                  </div>

                  {messages.length === 0 ? (
                    <div className="ticker-empty">
                      <Icon name="chat_bubble_outline" size={20} />
                      <p>No messages in queue. Add an announcement above.</p>
                    </div>
                  ) : (
                    <div className="ticker-messages">
                      {messages.map((msg, idx) => (
                        <div
                          key={msg.id}
                          className={`ticker-msg-card${dragIdx === idx ? " is-dragging" : ""}${dragOverIdx === idx && dragIdx !== idx ? " is-drag-over" : ""}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={(e) => handleDrop(e, idx)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="ticker-msg-drag">
                            <Icon name="drag_indicator" size={20} />
                          </div>
                          <div className="ticker-msg-body">
                            {editingId === msg.id ? (
                              <>
                                <textarea
                                  className="ticker-msg-edit-textarea"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value.slice(0, MAX_CHARS))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(msg.id); }
                                    if (e.key === "Escape") handleCancelEdit();
                                  }}
                                  autoFocus
                                />
                                <div className="ticker-msg-meta">
                                  <button
                                    type="button"
                                    className="ticker-add-btn"
                                    onClick={() => handleSaveEdit(msg.id)}
                                    style={{ fontSize: 10, padding: "3px 8px" }}
                                    title="Save">
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="ticker-clear-all-btn"
                                    onClick={handleCancelEdit}
                                    style={{ fontSize: 10 }}
                                    title="Cancel">
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="ticker-msg-text">{msg.text}</p>
                                {idx === 0 && running && (
                                  <div className="ticker-msg-meta">
                                    <span className="ticker-msg-badge">ACTIVE</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          <div className="ticker-msg-actions">
                            <button
                              type="button"
                              className="ticker-msg-action-btn"
                              onClick={() => handleStartEdit(msg)}
                              title="Edit message"
                            >
                              <Icon name="edit" size={20} />
                            </button>
                            <button
                              type="button"
                              className="ticker-msg-action-btn is-delete"
                              onClick={() => handleDelete(msg.id)}
                              title="Delete message"
                            >
                              <Icon name="delete" size={20} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="ticker-main-secondary">
                <div>
                  <label className="ticker-field-label">Ticker Theme</label>
                  <div className="ticker-theme-selector" onClick={() => setThemeOpen((open) => !open)}>
                    <div className="ticker-theme-preview" style={{ background: activeThemeColors.barBg }}>
                      <div
                        className="ticker-theme-preview-heading"
                        style={{
                          background: activeThemeColors.accent,
                          color: activeThemeColors.accentText,
                          fontFamily: activeThemeFontFamily,
                        }}
                      >
                        {settings.heading || activeTheme.defaultHeading}
                      </div>
                      <div
                        className="ticker-theme-preview-scroll"
                        style={{
                          color: activeThemeColors.barText,
                          fontFamily: activeThemeFontFamily,
                        }}
                      >
                        Sample announcement text...
                      </div>
                    </div>
                    <span className="ticker-theme-selector-name">{activeTheme.name}</span>
                    <Icon name={themeOpen ? "arrow_drop_up" : "arrow_drop_down"} size={20} />
                  </div>
                  {themeOpen && (
                    <div className="ticker-theme-dropdown">
                      {availableTickerThemes.map((theme) => {
                        const colors = getTickerOptionColors(theme);
                        const fontFamily = getTickerOptionFontFamily(theme);
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            className={`ticker-theme-option${settings.themeId === theme.id ? " is-active" : ""}`}
                            onClick={() => handleSelectTheme(theme)}
                          >
                            <div className="ticker-theme-preview" style={{ background: colors.barBg }}>
                              <div
                                className="ticker-theme-preview-heading"
                                style={{
                                  background: colors.accent,
                                  color: colors.accentText,
                                  fontFamily,
                                }}
                              >
                                {theme.defaultHeading}
                              </div>
                              <div
                                className="ticker-theme-preview-scroll"
                                style={{
                                  color: colors.barText,
                                  fontFamily,
                                }}
                              >
                                {theme.name} sample text...
                              </div>
                            </div>
                            <div className="ticker-theme-info">
                              <div className="ticker-theme-name">{theme.name}</div>
                              <div className="ticker-theme-desc">{theme.description}</div>
                            </div>
                            {settings.themeId === theme.id && (
                              <Icon name="check_circle" size={20} className="ticker-theme-card-check" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="ticker-speed-header">
                    <label className="ticker-field-label" style={{ marginBottom: 0 }}>Scroll Speed</label>
                    <span className="ticker-speed-value">{settings.speed}%</span>
                  </div>
                  <div className="ticker-speed-row">
                    <span className="ticker-speed-label">Slow</span>
                    <input
                      type="range"
                      className="ticker-speed-slider"
                      min={1}
                      max={100}
                      value={settings.speed}
                      onChange={(e) => setSettings((prev) => ({ ...prev, speed: Number(e.target.value) }))}
                    />
                    <span className="ticker-speed-label">Fast</span>
                  </div>
                </div>

                <div>
                  <div className="ticker-speed-header">
                    <label className="ticker-field-label" style={{ marginBottom: 0 }}>Duration</label>
                    <span className="ticker-speed-value">{formatDurationMode(effectiveDurationConfig)}</span>
                  </div>
                  <label className="ticker-duration-defaults-toggle">
                    <input
                      type="checkbox"
                      checked={settings.useSystemDefaults}
                      onChange={handleToggleUseSystemDefaults}
                    />
                    <span>Use System Defaults</span>
                  </label>
                  <div className="ticker-duration-chips">
                    {TICKER_DURATION_OPTIONS.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        className={`ticker-duration-chip${!effectiveDurationConfig.isInfinite && effectiveDurationConfig.durationSeconds === seconds ? " is-active" : ""
                          }`}
                        onClick={() => handleSetDuration(seconds)}
                        disabled={settings.useSystemDefaults}
                        title={`${formatDuration(seconds)}`}
                      >
                        {formatDuration(seconds)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`ticker-duration-chip ticker-duration-chip--infinite${effectiveDurationConfig.isInfinite ? " is-active" : ""}`}
                      onClick={handleToggleInfiniteDuration}
                      disabled={settings.useSystemDefaults}
                      title="Infinite duration"
                    >
                      <Icon name="all_inclusive" size={12} />
                    </button>
                    <input
                      type="number"
                      className="ticker-duration-input"
                      value={settings.isInfinite ? "" : settings.durationSeconds}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10);
                        if (Number.isFinite(parsed)) {
                          handleSetDuration(parsed);
                        }
                      }}
                      min={TICKER_MIN_DURATION_SECONDS}
                      max={TICKER_MAX_DURATION_SECONDS}
                      disabled={settings.useSystemDefaults || settings.isInfinite}
                      placeholder="sec"
                      title="Custom duration in seconds"
                    />
                  </div>
                  {settings.useSystemDefaults && (
                    <p className="ticker-duration-hint">
                      Using system default: {formatDuration(effectiveDurationConfig.durationSeconds)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="ticker-field-label">Position</label>
                  <div className="ticker-position-toggle">
                    <button
                      type="button"
                      className={`ticker-position-btn${settings.position === "top" ? " is-active" : ""}`}
                      onClick={() => handleSetPosition("top")}
                      title="Top">
                      Top
                    </button>
                    <button
                      type="button"
                      className={`ticker-position-btn${settings.position === "bottom" ? " is-active" : ""}`}
                      onClick={() => handleSetPosition("bottom")}
                      title="Bottom">
                      Bottom
                    </button>
                  </div>
                </div>

                <div className="ticker-loop-row">
                  <div className="ticker-loop-info">
                    <span className="ticker-loop-title">Loop messages continuously</span>
                    <span className="ticker-loop-desc">Restart after last message</span>
                  </div>
                  <label className="ticker-toggle">
                    <input
                      type="checkbox"
                      checked={settings.loop}
                      onChange={(e) => handleSetLoop(e.target.checked)}
                    />
                    <span className="ticker-toggle-track" />
                  </label>
                </div>

              </div>
            </div>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <aside className="ticker-right">
          <div className="ticker-right-scroll ticker-right-scroll--obs">
            <div className="ticker-live-control ticker-live-control--inline ticker-live-control--sidebar">
              <div className="ticker-live-header">
                <span className="ticker-live-label">Live Control</span>
                <div className={`ticker-status-chip${running ? " is-running" : ""}`}>
                  <span className="ticker-status-dot" />
                  <span>{running ? "Ticker Running" : "Ticker Stopped"}</span>
                </div>
              </div>
              <button
                type="button"
                className={`ticker-start-btn${running ? " is-running" : ""}`}
                onClick={handleToggleTicker}
                disabled={(!running && messages.length === 0) || (!running && !obsConnected) || liveToggleBusy}
                title="Remove">
                <Icon name={running ? "stop_circle" : "play_circle"} size={20} />
                {liveToggleBusy ? (running ? "STOPPING..." : "STARTING...") : running ? "Remove From OBS" : "Push To OBS"}
              </button>
            </div>
            <ObsScenesPanel
              title="OBS Scenes"
              contentLabel="ticker"
              description="These are your list of scenes currently in OBS. Click Send on any scene for direct targeting."
              connected={obsConnected}
              scenes={scenes.map((sceneName, index) => ({ sceneName, sceneIndex: index }))}
              mainScene={serviceStore.sceneMapping.mainScene}
              activeScene={programScene}
              activeScenes={running && activeTickerScene ? [activeTickerScene] : []}
              refreshing={scenesRefreshing}
              disabled={messages.length === 0}
              sendLabel="Push To OBS"
              onRefresh={handleRefreshScenes}
              onSendToScene={async (sceneName, mode) => {
                await sendTickerToScene(sceneName, mode);
              }}
            />
          </div>
        </aside>
      </div >
      {
        toasts.length > 0 && (
          <div className="toast-container">
            {toasts.map((toast) => (
              <div key={toast.id} className={`toast toast-${toast.type}`}>
                <Icon name={toast.type === "success" ? "check_circle" : "error_outline"} size={20} className="toast-icon" />
                <span className="toast-msg">{toast.msg}</span>
              </div>
            ))}
          </div>
        )
      }
    </div >
  );
}
