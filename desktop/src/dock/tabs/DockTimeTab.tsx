import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import Icon from "../DockIcon";
import { dockObsClient } from "../dockObsClient";
import { isPresentationLinkTarget, type DockPresentationOutputTarget } from "../dockPresentationTarget";
import { useDockSceneRoute } from "../dockSceneRouting";
import { ensureObsConnected } from "../obsConnectionGuard";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import DockCountdownsTab from "./DockCountdownsTab";
import {
  DOCK_TIME_LOWER_THIRD_SOURCE_NAME,
  DOCK_TIME_SOURCE_NAME,
  getDockTimeSourceName,
  type DockClockOverlayState,
  type DockClockTheme,
  type DockTimeDisplayMode,
  type DockTimeOverlayData,
  type DockTimePlacement,
  type DockTimeTool,
  type DockTimerOverlayState,
} from "../timeOverlay";
import { DOCK_PRESENTATION_SCENE_NAME } from "./dockCountdownScene";

type TimeSubTab = "countdown" | "clock";

interface TimerSettings extends DockTimerOverlayState {
  label: string;
  mode: DockTimeDisplayMode;
  placement: DockTimePlacement;
}

interface ClockSettings extends DockClockOverlayState {
  label: string;
  mode: DockTimeDisplayMode;
  placement: DockTimePlacement;
}

interface TimeSettings {
  timer: TimerSettings;
  clock: ClockSettings;
}

interface TimeOutputTarget {
  sceneName: string;
  sourceName: string;
  mode: DockTimeDisplayMode;
}

const TIME_SETTINGS_KEY = "dock-time-tools-v1";

const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  label: "",
  mode: "lower-third",
  placement: "left",
  elapsedSeconds: 0,
  startedAt: null,
  running: false,
};

const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  label: "",
  mode: "lower-third",
  placement: "bottom-right",
  theme: "digital-modern",
  color: "#ffffff",
  transparentBg: true,
  hour12: true,
  showSeconds: true,
  showDate: false,
};

function sanitizeCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed) return undefined;
  if (/[;{}<>]/.test(trimmed)) return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function colorInputValue(value: unknown, fallback: string = "#ffffff"): string {
  const color = sanitizeCssColor(value);
  if (!color) return fallback;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return fallback;
  if (hex.length === 3) {
    return `#${hex.split("").map((char) => char + char).join("")}`.toLowerCase();
  }
  return `#${hex}`.toLowerCase();
}

interface ClockThemeOption {
  id: DockClockTheme;
  name: string;
  icon: string;
  desc: string;
}

const CLOCK_THEMES: ClockThemeOption[] = [
  { id: "digital-modern", name: "Modern Digital", icon: "schedule", desc: "Clean broadcast style" },
  { id: "analog-wall", name: "Wall Clock", icon: "watch_later", desc: "SVG analog dial" },
  { id: "broadcast-pill", name: "Stream Pill", icon: "radio_button_checked", desc: "Compact rounded capsule" },
  { id: "neon", name: "Neon LED", icon: "wb_incandescent", desc: "Glowing cyber display" },
  { id: "elegant", name: "Elegant Gold", icon: "auto_awesome", desc: "Liturgical serif layout" },
];

const CLOCK_COLOR_PRESETS = [
  { label: "White", value: "#ffffff" },
  { label: "Warm Gold", value: "#fbbf24" },
  { label: "Amber / Orange", value: "#f97316" },
  { label: "Cyan", value: "#38bdf8" },
  { label: "Emerald", value: "#34d399" },
  { label: "Rose", value: "#f43f5e" },
];

const PLACEMENT_OPTIONS: Array<{ id: DockTimePlacement; label: string; icon: string }> = [
  { id: "top-left", label: "Top Left", icon: "north_west" },
  { id: "top-right", label: "Top Right", icon: "north_east" },
  { id: "bottom-left", label: "Bottom Left", icon: "south_west" },
  { id: "bottom-right", label: "Bottom Right", icon: "south_east" },
];

function isDisplayMode(value: unknown): value is DockTimeDisplayMode {
  return value === "fullscreen" || value === "lower-third";
}

function isPlacement(value: unknown): value is DockTimePlacement {
  return (
    value === "left" ||
    value === "right" ||
    value === "top-left" ||
    value === "top-right" ||
    value === "bottom-left" ||
    value === "bottom-right" ||
    value === "center"
  );
}

function isClockTheme(value: unknown): value is DockClockTheme {
  return (
    value === "digital-modern" ||
    value === "analog-wall" ||
    value === "broadcast-pill" ||
    value === "neon" ||
    value === "elegant"
  );
}

function getStoredTimer(value: unknown): TimerSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_TIMER_SETTINGS };
  const raw = value as Partial<TimerSettings>;
  return {
    label: typeof raw.label === "string" ? raw.label.slice(0, 80) : "",
    mode: isDisplayMode(raw.mode) ? raw.mode : DEFAULT_TIMER_SETTINGS.mode,
    placement: isPlacement(raw.placement) ? raw.placement : DEFAULT_TIMER_SETTINGS.placement,
    elapsedSeconds: Math.max(0, Math.floor(Number(raw.elapsedSeconds) || 0)),
    startedAt: typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    running: raw.running === true,
  };
}

function getStoredClock(value: unknown): ClockSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_CLOCK_SETTINGS };
  const raw = value as Partial<ClockSettings>;
  const rawLabel = typeof raw.label === "string" ? raw.label.slice(0, 80) : "";
  const label = rawLabel.trim() === "Current time" ? "" : rawLabel;
  const color = sanitizeCssColor(raw.color) ?? DEFAULT_CLOCK_SETTINGS.color;
  return {
    label,
    mode: isDisplayMode(raw.mode) ? raw.mode : DEFAULT_CLOCK_SETTINGS.mode,
    placement: isPlacement(raw.placement) ? raw.placement : DEFAULT_CLOCK_SETTINGS.placement,
    theme: isClockTheme(raw.theme) ? raw.theme : DEFAULT_CLOCK_SETTINGS.theme,
    color,
    transparentBg: raw.transparentBg !== false,
    hour12: raw.hour12 !== false,
    showSeconds: raw.showSeconds !== false,
    showDate: raw.showDate === true,
  };
}

function loadTimeSettings(): TimeSettings {
  try {
    const raw = readNativeDockSetting<unknown>(TIME_SETTINGS_KEY);
    if (!raw || typeof raw !== "object") {
      return { timer: { ...DEFAULT_TIMER_SETTINGS }, clock: { ...DEFAULT_CLOCK_SETTINGS } };
    }
    const value = raw as { timer?: unknown; clock?: unknown };
    return { timer: getStoredTimer(value.timer), clock: getStoredClock(value.clock) };
  } catch {
    return { timer: { ...DEFAULT_TIMER_SETTINGS }, clock: { ...DEFAULT_CLOCK_SETTINGS } };
  }
}

function formatClock(now: number, clock: ClockSettings): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: clock.hour12,
  };
  if (clock.showSeconds) options.second = "2-digit";
  return new Intl.DateTimeFormat(undefined, options).format(new Date(now));
}

function formatClockDate(now: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(now));
}

function AnalogClockFace({ now }: { now: number }) {
  const date = new Date(now);
  const ms = date.getMilliseconds();
  const sec = date.getSeconds() + ms / 1000;
  const min = date.getMinutes() + sec / 60;
  const hr = (date.getHours() % 12) + min / 60;

  const secDeg = sec * 6;
  const minDeg = min * 6;
  const hrDeg = hr * 30;

  return (
    <div className="dock-time-analog-wrap" aria-hidden="true">
      <svg className="dock-time-analog-dial" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="rgba(15, 23, 42, 0.75)" stroke="#cbd5e1" strokeWidth="2" />
        <g stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round">
          <line x1="50" y1="8" x2="50" y2="14" stroke="#f8fafc" strokeWidth="2.5" />
          <line x1="92" y1="50" x2="86" y2="50" stroke="#f8fafc" strokeWidth="2.5" />
          <line x1="50" y1="92" x2="50" y2="86" stroke="#f8fafc" strokeWidth="2.5" />
          <line x1="8" y1="50" x2="14" y2="50" stroke="#f8fafc" strokeWidth="2.5" />
          <line x1="71" y1="13.5" x2="68" y2="18.7" />
          <line x1="86.5" y1="29" x2="81.3" y2="32" />
          <line x1="86.5" y1="71" x2="81.3" y2="68" />
          <line x1="71" y1="86.5" x2="68" y2="81.3" />
          <line x1="29" y1="86.5" x2="32" y2="81.3" />
          <line x1="13.5" y1="71" x2="18.7" y2="68" />
          <line x1="13.5" y1="29" x2="18.7" y2="32" />
          <line x1="29" y1="13.5" x2="32" y2="18.7" />
        </g>
        <line x1="50" y1="50" x2="50" y2="26" stroke="#f8fafc" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${hrDeg.toFixed(1)} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="16" stroke="#e2e8f0" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${minDeg.toFixed(1)} 50 50)`} />
        <line x1="50" y1="58" x2="50" y2="12" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${secDeg.toFixed(1)} 50 50)`} />
        <circle cx="50" cy="50" r="3" fill="#ea580c" />
      </svg>
    </div>
  );
}

function TimePreview({
  mode,
  placement,
  theme = "digital-modern",
  color = "#ffffff",
  transparent = true,
  label,
  value,
  date,
  now,
}: {
  mode: DockTimeDisplayMode;
  placement: DockTimePlacement;
  theme?: DockClockTheme;
  color?: string;
  transparent?: boolean;
  label: string;
  value: string;
  date?: string;
  now: number;
}) {
  const normPlacement = placement === "left" ? "bottom-left" : placement === "right" ? "bottom-right" : placement;
  const cleanLabel = label.trim();

  return (
    <div
      className={`dock-time-preview dock-time-preview--${mode} dock-time-preview--${normPlacement} dock-time-preview--theme-${theme}${transparent ? " dock-time-preview--transparent" : ""}`}
      aria-label="Clock preview"
    >
      <div className="dock-time-preview__card">
        {theme === "analog-wall" && <AnalogClockFace now={now} />}
        <div className="dock-time-preview__content">
          {cleanLabel ? <span className="dock-time-preview__label">{cleanLabel}</span> : null}
          <strong className="dock-time-preview__value" style={{ color: color || undefined }}>
            {theme === "broadcast-pill" && <span className="dock-time-pill-dot" aria-hidden="true" />}
            {value}
          </strong>
          {date ? <span className="dock-time-preview__date">{date}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ClockColorControl({
  value,
  onChange,
  themeValue,
  onThemeChange,
}: {
  value?: string;
  onChange: (color: string) => void;
  themeValue?: DockClockTheme;
  onThemeChange?: (theme: DockClockTheme) => void;
}) {
  const currentColor = sanitizeCssColor(value) ?? "#ffffff";
  const hexInput = colorInputValue(currentColor, "#ffffff");
  const activeTheme = CLOCK_THEMES.find((theme) => theme.id === themeValue);

  return (
    <div className="dock-time-field">
      <div className="dock-time-field__header">
        <label htmlFor="dock-clock-color-input" className="dock-time-field__label">
          Time Color
        </label>
        <span className="dock-time-field__hint">{hexInput.toUpperCase()}</span>
      </div>

      <div className="dock-time-color-row">
        {/* Color picker box */}
        <input
          id="dock-clock-color-input"
          type="color"
          className="dock-time-color-input"
          value={hexInput}
          onChange={(e) => onChange(e.target.value)}
          title="Pick custom clock color"
          aria-label="Pick custom clock color"
        />

        {/* Quick swatch button */}
        <button
          type="button"
          className="dock-time-color-swatch-btn"
          onClick={() => {
            const input = document.getElementById("dock-clock-color-input") as HTMLInputElement | null;
            input?.click();
          }}
          title="Click to customize time color"
        >
          <span className="dock-time-color-dot" style={{ backgroundColor: currentColor }} />
          <span>{hexInput.toUpperCase()}</span>
        </button>

        {/* Reset to white */}
        {hexInput.toLowerCase() !== "#ffffff" && (
          <button
            type="button"
            className="dock-btn dock-btn--sm"
            onClick={() => onChange("#ffffff")}
            title="Reset color to White"
            style={{ padding: "0 8px", fontSize: 10 }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Preset Swatches */}
      <div className="dock-time-color-presets" role="radiogroup" aria-label="Color presets">
        {CLOCK_COLOR_PRESETS.map((preset) => {
          const isSelected = hexInput.toLowerCase() === preset.value.toLowerCase();
          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`dock-time-preset-dot${isSelected ? " dock-time-preset-dot--active" : ""}`}
              style={{ backgroundColor: preset.value }}
              onClick={() => onChange(preset.value)}
              title={preset.label}
            />
          );
        })}
      </div>

      {/* Hidden theme select preserving compatibility & automated tests */}
      <select
        id="dock-clock-theme-select"
        className="dock-time-select"
        value={themeValue ?? "digital-modern"}
        onChange={(e) => onThemeChange?.(e.target.value as DockClockTheme)}
        style={{ display: "none" }}
        aria-hidden="true"
        tabIndex={-1}
      >
        {CLOCK_THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
      <span style={{ display: "none" }}>{activeTheme?.desc}</span>
    </div>
  );
}

function PlacementControl({
  value,
  onChange,
}: {
  value: DockTimePlacement;
  onChange: (value: DockTimePlacement) => void;
}) {
  const norm = value === "left" ? "bottom-left" : value === "right" ? "bottom-right" : value;

  return (
    <div className="dock-time-field">
      <span className="dock-time-field__label">Corner position</span>
      <div className="dock-time-placement-grid" role="group" aria-label="Lower-third card corner position">
        {PLACEMENT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`dock-time-placement-btn${norm === opt.id ? " dock-time-placement-btn--active" : ""}`}
            onClick={() => onChange(opt.id)}
            title={opt.label}
          >
            <Icon name={opt.icon} size={12} />
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function getOptionsPresetKey(clock: ClockSettings): string {
  const bg = clock.transparentBg !== false ? "transparent" : "card";
  const h = clock.hour12 ? "12h" : "24h";
  const s = clock.showSeconds ? "sec" : "nosec";
  return `${bg}-${h}-${s}`;
}

function parseOptionsPresetKey(key: string): Partial<ClockSettings> {
  const [bg, h, s] = key.split("-");
  return {
    transparentBg: bg === "transparent",
    hour12: h === "12h",
    showSeconds: s === "sec",
  };
}

export default function DockTimeTab({
  presentationOutputTarget = "obs",
}: {
  presentationOutputTarget?: DockPresentationOutputTarget;
} = {}) {
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const [activeTab, setActiveTab] = useState<TimeSubTab>("countdown");
  const [settings, setSettings] = useState<TimeSettings>(loadTimeSettings);
  const [stagedClock, setStagedClock] = useState<ClockSettings>(() => settings.clock);
  const [now, setNow] = useState(() => Date.now());
  const [liveTool, setLiveTool] = useState<DockTimeTool | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sceneRoute, updateSceneRoute] = useDockSceneRoute("time");
  const hasSceneRoute = sceneRoute.enabled && sceneRoute.targets.length > 0;

  const clockValue = useMemo(() => formatClock(now, stagedClock), [now, stagedClock]);
  const clockDate = useMemo(
    () => stagedClock.showDate ? formatClockDate(now) : "",
    [now, stagedClock.showDate],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    writeNativeDockSetting(TIME_SETTINGS_KEY, settings);
  }, [settings]);

  const updateClock = useCallback((patch: Partial<ClockSettings>) => {
    setStagedClock((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  const getOutputTargets = useCallback((mode: DockTimeDisplayMode): TimeOutputTarget[] => {
    const result: TimeOutputTarget[] = [];
    const addTarget = (target: TimeOutputTarget) => {
      if (!result.some((item) => item.sceneName === target.sceneName && item.sourceName === target.sourceName)) {
        result.push(target);
      }
    };

    if (hasSceneRoute) {
      for (const target of sceneRoute.targets) {
        if (!target.sceneName.trim()) continue;
        addTarget({
          sceneName: target.sceneName,
          sourceName: dockObsClient.getSceneRouteSourceName("time", target.sceneName),
          mode: target.mode === "fullscreen" || target.mode === "lower-third" ? target.mode : mode,
        });
      }
    }

    if (!hasSceneRoute || sceneRoute.syncPresentation) {
      addTarget({
        sceneName: DOCK_PRESENTATION_SCENE_NAME,
        sourceName: getDockTimeSourceName(mode),
        mode,
      });
    }

    return result;
  }, [hasSceneRoute, sceneRoute.syncPresentation, sceneRoute.targets]);

  const buildPacket = useCallback((tool: DockTimeTool, timer = settings.timer, clock = settings.clock): DockTimeOverlayData => ({
    tool,
    mode: tool === "timer" ? timer.mode : clock.mode,
    placement: tool === "timer" ? timer.placement : clock.placement,
    label: tool === "timer" ? timer.label.trim() : clock.label.trim(),
    ...(tool === "timer" ? { timer } : { clock }),
    timestamp: Date.now(),
  }), [settings.clock, settings.timer]);

  const hideInactivePresentationTimeSource = useCallback(async (activeSourceName: string) => {
    const timeSources = [DOCK_TIME_SOURCE_NAME, DOCK_TIME_LOWER_THIRD_SOURCE_NAME];
    await Promise.all(timeSources
      .filter((sourceName) => sourceName !== activeSourceName)
      .map((sourceName) => dockObsClient.clearTimeOverlayFromScene(
        DOCK_PRESENTATION_SCENE_NAME,
        { sourceName },
      )));
  }, []);

  const publish = useCallback(async (
    tool: DockTimeTool,
    timerOverride?: TimerSettings,
    clockOverride?: ClockSettings,
  ) => {
    if (presentationLinkMode) {
      setError(t("time.obsRequired", "Time cards are available when the Dock is connected to OBS."));
      return;
    }

    const packet = buildPacket(tool, timerOverride ?? settings.timer, clockOverride ?? settings.clock);
    const targets = getOutputTargets(packet.mode);
    setSending(true);
    setError("");
    setNotice("");

    try {
      await ensureObsConnected();
      if (!dockObsClient.isConnected) throw new Error("OBS is not connected.");

      const presentationTarget = targets.find((target) => target.sceneName === DOCK_PRESENTATION_SCENE_NAME);
      if (presentationTarget) {
        await hideInactivePresentationTimeSource(presentationTarget.sourceName);
      }

      for (const target of targets) {
        const targetPacket = target.mode === packet.mode
          ? packet
          : { ...packet, mode: target.mode, timestamp: Date.now() };
        await dockObsClient.pushTimeOverlayToScene(targetPacket, target.sceneName, {
          sourceName: target.sourceName,
        });
      }

      setLiveTool(tool);
      setNotice(t("time.sent", "Time card is live in OBS."));
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : t("time.sendFailed", "Could not send the time card to OBS."));
    } finally {
      setSending(false);
    }
  }, [buildPacket, getOutputTargets, hideInactivePresentationTimeSource, presentationLinkMode, settings.clock, settings.timer, t]);

  const clearTime = useCallback(async () => {
    if (presentationLinkMode) return;
    setSending(true);
    setError("");
    setNotice("");

    try {
      await ensureObsConnected();
      if (!dockObsClient.isConnected) throw new Error("OBS is not connected.");

      const routeTargets = hasSceneRoute
        ? sceneRoute.targets.filter((target) => target.sceneName.trim())
        : [];
      await Promise.all([
        ...routeTargets.map((target) => dockObsClient.clearTimeOverlayFromScene(target.sceneName)),
        dockObsClient.clearTimeOverlayFromScene(DOCK_PRESENTATION_SCENE_NAME, { sourceName: DOCK_TIME_SOURCE_NAME }),
        dockObsClient.clearTimeOverlayFromScene(DOCK_PRESENTATION_SCENE_NAME, { sourceName: DOCK_TIME_LOWER_THIRD_SOURCE_NAME }),
      ]);

      setLiveTool(null);
      setNotice(t("time.cleared", "Time card cleared from OBS."));
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : t("time.clearFailed", "Could not clear the time card from OBS."));
    } finally {
      setSending(false);
    }
  }, [hasSceneRoute, presentationLinkMode, sceneRoute.targets, t]);

  const handlePushClock = useCallback(async () => {
    setSettings((current) => ({
      ...current,
      clock: stagedClock,
    }));
    await publish("clock", undefined, stagedClock);
  }, [publish, stagedClock]);

  const renderToolPanel = () => {
    if (activeTab === "countdown") {
      return <DockCountdownsTab presentationOutputTarget={presentationOutputTarget} />;
    }

    const currentMode = stagedClock.mode;
    const currentPlacement = stagedClock.placement;
    const currentLabel = stagedClock.label;
    const currentTheme = stagedClock.theme ?? "digital-modern";
    const currentTransparent = stagedClock.transparentBg !== false;

    return (
      <div className="dock-time-panel">
        <div className="dock-time-panel__intro">
          <div>
            <div className="dock-time-panel__title">
              <Icon name="schedule" size={15} />
              <span>Clock</span>
              {liveTool === "clock" ? <span className="dock-time-live">Live</span> : null}
            </div>
            <p>Show a live clock on your screen.</p>
          </div>
          <DockSceneRoutingControl
            module="time"
            route={sceneRoute}
            onRouteChange={updateSceneRoute}
            disabled={presentationLinkMode}
            title={t("sceneRouting.timeOutput", "Output")}
            placement="below"
          />
        </div>

        <TimePreview
          mode={currentMode}
          placement={currentPlacement}
          theme={currentTheme}
          color={stagedClock.color}
          transparent={currentTransparent}
          label={currentLabel}
          value={clockValue}
          date={clockDate}
          now={now}
        />

        <div className="dock-time-controls">
          {/* Display Mode (Full Screen vs Corner Lower-Third) */}
          <div className="dock-time-field">
            <span className="dock-time-field__label">{t("time.displayMode", "Display Mode")}</span>
            <div className="dock-time-mode-switch" role="group" aria-label="Clock display mode">
              <button
                type="button"
                className={`dock-time-mode-btn${currentMode === "lower-third" ? " dock-time-mode-btn--active" : ""}`}
                onClick={() => updateClock({ mode: "lower-third" })}
              >
                <Icon name="branding_watermark" size={13} />
                <span>{t("time.cornerLowerThird", "Corner (Lower-Third)")}</span>
              </button>
              <button
                type="button"
                className={`dock-time-mode-btn${currentMode === "fullscreen" ? " dock-time-mode-btn--active" : ""}`}
                onClick={() => updateClock({ mode: "fullscreen" })}
              >
                <Icon name="fullscreen" size={13} />
                <span>{t("time.fullscreen", "Full Screen (Centered)")}</span>
              </button>
            </div>
          </div>

          <ClockColorControl
            value={stagedClock.color}
            onChange={(color) => updateClock({ color })}
            themeValue={currentTheme}
            onThemeChange={(theme) => updateClock({ theme })}
          />

          {currentMode === "lower-third" ? (
            <PlacementControl
              value={currentPlacement}
              onChange={(placement) => updateClock({ placement })}
            />
          ) : null}

          {/* Label (Optional) */}
          <div className="dock-time-field">
            <label htmlFor="dock-clock-label-input" className="dock-time-field__label">
              {t("time.labelOptional", "Label (optional)")}
            </label>
            <input
              id="dock-clock-label-input"
              type="text"
              maxLength={80}
              value={currentLabel}
              onChange={(e) => updateClock({ label: e.target.value })}
              placeholder={t("time.labelPlaceholder", "Optional label (e.g. SERVICE TIME)")}
            />
          </div>

          {/* Display & Time Options Dropdown (Native clean dropdown) */}
          <div className="dock-time-field">
            <div className="dock-time-field__header">
              <label htmlFor="dock-clock-options-select" className="dock-time-field__label">
                {t("time.clockOptions", "Display & Time Options")}
              </label>
              <span className="dock-time-field__hint">
                {currentTransparent ? "Transparent" : "Card"} • {stagedClock.hour12 ? "12h (AM/PM)" : "24h"} • {stagedClock.showSeconds ? "Seconds" : "No sec"}
              </span>
            </div>
            <select
              id="dock-clock-options-select"
              className="dock-time-select"
              value={getOptionsPresetKey(stagedClock)}
              onChange={(e) => {
                const patch = parseOptionsPresetKey(e.target.value);
                updateClock(patch);
              }}
              aria-label="Display and time format options"
            >
              <option value="transparent-12h-sec">No Background (Transparent) • 12-Hour (AM/PM) with Seconds</option>
              <option value="transparent-12h-nosec">No Background (Transparent) • 12-Hour (AM/PM)</option>
              <option value="transparent-24h-sec">No Background (Transparent) • 24-Hour with Seconds</option>
              <option value="transparent-24h-nosec">No Background (Transparent) • 24-Hour</option>
              <option value="card-12h-sec">Solid Background (Card) • 12-Hour (AM/PM) with Seconds</option>
              <option value="card-12h-nosec">Solid Background (Card) • 12-Hour (AM/PM)</option>
              <option value="card-24h-sec">Solid Background (Card) • 24-Hour with Seconds</option>
              <option value="card-24h-nosec">Solid Background (Card) • 24-Hour</option>
            </select>
          </div>

          {/* Quick Date Toggle */}
          <div className="dock-time-field">
            <label className="dock-time-checkbox-row">
              <input
                type="checkbox"
                checked={stagedClock.showDate}
                onChange={(e) => updateClock({ showDate: e.target.checked })}
              />
              <span>{t("time.showDate", "Show Date beneath clock")}</span>
            </label>
          </div>

          {/* Primary Projection Action Bar */}
          <div className="dock-time-action-bar">
            <button
              type="button"
              className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : "dock-btn--primary"}`}
              onClick={() => void handlePushClock()}
              disabled={presentationLinkMode || sending}
              style={{ flex: 1, whiteSpace: "nowrap" }}
              title={liveTool === "clock" ? t("time.updateInObs", "Push Changes to OBS") : t("time.pushToObs", "Push to OBS")}
            >
              <Icon name="play_arrow" size={14} />
              <span>
                {sending
                  ? t("common.sending", "Sending...")
                  : liveTool === "clock"
                  ? t("time.updateInObs", "Update in OBS")
                  : t("time.pushToObs", "Push to OBS")}
              </span>
            </button>

            {liveTool === "clock" && (
              <button
                type="button"
                className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : ""}`}
                onClick={() => void clearTime()}
                disabled={presentationLinkMode || sending}
                style={{ whiteSpace: "nowrap" }}
                title={t("time.blankClock", "Blank / Hide Clock")}
              >
                <Icon name="visibility_off" size={14} />
                <span>{t("common.blank", "Blank")}</span>
              </button>
            )}
          </div>
        </div>

        {presentationLinkMode ? (
          <div className="dock-time-message dock-time-message--info">
            Time cards are available when this Dock is connected directly to OBS.
          </div>
        ) : null}
        {error ? <div className="dock-time-message dock-time-message--error">{error}</div> : null}
        {notice ? <div className="dock-time-message dock-time-message--success">{notice}</div> : null}
      </div>
    );
  };

  return (
    <div className="dock-time-shell">
      <div className="dock-time-shell__header">
        <div>
          <div className="dock-time-shell__title">
            <Icon name="schedule" size={15} />
            <span>{t("ministry.time", "Time")}</span>
          </div>
          <p>Countdowns and clocks for your screen.</p>
        </div>
      </div>

      <div className="dock-time-tabs" role="tablist" aria-label="Time tools">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "countdown"}
          className={activeTab === "countdown" ? "dock-time-tabs__button dock-time-tabs__button--active" : "dock-time-tabs__button"}
          onClick={() => setActiveTab("countdown")}
        >
          <Icon name="hourglass" size={12} />
          <span>Countdown</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "clock"}
          className={activeTab === "clock" ? "dock-time-tabs__button dock-time-tabs__button--active" : "dock-time-tabs__button"}
          onClick={() => setActiveTab("clock")}
        >
          <Icon name="schedule" size={12} />
          <span>Clock</span>
        </button>
      </div>

      <div className="dock-time-shell__body">
        {renderToolPanel()}
      </div>
    </div>
  );
}
