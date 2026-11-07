import Icon from "../components/Icon";
/**
 * CountdownsPage.tsx — Countdown timer management for OBS
 *
 * Three-panel layout: sidebar (templates/list) | preview | settings
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  Play,
  Pause,
  RotateCcw,
  Send,
  Save,
  Upload,
  Plus,
  Clock,
  Timer,
} from "../components/icons/NativeIcons";
import {
  getCountdowns,
  saveCountdown,
} from "../countdowns/countdownStore";
import {
  createDefaultCountdown,
  createLayoutCountdown,
} from "../countdowns/countdownDefaults";
import CountdownStylePicker from "../countdowns/CountdownStylePicker";
import CountdownLayerEditor from "../countdowns/CountdownLayerEditor";
import { isLayoutDesign } from "../countdowns/layoutMode";
import TextThemePicker from "../countdowns/TextThemePicker";
import {
  COUNTDOWN_TEXT_THEMES,
  loadTextThemeFont,
  applyTextTheme,
  type CountdownTextTheme,
} from "../countdowns/textThemes";
import type {
  CountdownConfig,
  CountdownTemplateId,
  BackgroundType,
  ImageFit,
  AnimationType,
  AutoAction,
} from "../countdowns/types";
import {
  BUILTIN_CATEGORIES,
  getBuiltinsByCategory,
  type BuiltinBackground,
} from "../countdowns/builtinBackgrounds";
import { validateMediaFile, backgroundFileAccept } from "../countdowns/mediaValidation";
import { saveCountdownAsset, deleteCountdownAsset } from "../countdowns/countdownStore";
import type { MediaItem } from "../library/libraryTypes";
import RundownsView from "./RundownsView";

// ── Timer hook ─────────────────────────────────────────────────────────────

function useCountdownTimer(cd: CountdownConfig) {
  const [remaining, setRemaining] = useState(cd.timer.durationSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const totalRef = useRef(cd.timer.durationSeconds);
  const frameRef = useRef<number>(0);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    totalRef.current = remaining;
    setIsRunning(true);
  }, [remaining]);

  const pause = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(frameRef.current);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    startedAtRef.current = null;
    setRemaining(cd.timer.durationSeconds);
    totalRef.current = cd.timer.durationSeconds;
    cancelAnimationFrame(frameRef.current);
  }, [cd.timer.durationSeconds]);

  useEffect(() => {
    if (!isRunning) return;
    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current!) / 1000;
      const r = Math.max(0, totalRef.current - elapsed);
      setRemaining(r);
      if (r > 0) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isRunning]);

  const totalSeconds = Math.floor(remaining);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const total = totalRef.current || 1;
  const progress = ((total - remaining) / total) * 100;

  let formatted: string;
  if (cd.timer.showHours) {
    formatted = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  } else {
    formatted = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return { remaining, isRunning, progress, formatted, start, pause, reset, isComplete: remaining <= 0 };
}

// ── Preview Component ──────────────────────────────────────────────────────

function CountdownPreview({ cd, timer }: { cd: CountdownConfig; timer: ReturnType<typeof useCountdownTimer> }) {
  const bg = cd.background;
  let bgStyle: React.CSSProperties = {};
  let videoUrl = "";

  switch (bg.type) {
    case "solid":
      bgStyle = { backgroundColor: bg.color };
      break;
    case "gradient":
      bgStyle = { background: `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientStart}, ${bg.gradientEnd})` };
      break;
    case "image":
      bgStyle = {
        backgroundImage: `url(${bg.imageUrl})`,
        backgroundSize: bg.imageFit || "cover",
        backgroundPosition: `${bg.positionX}% ${bg.positionY}%`,
        filter: `blur(${bg.blur}px) brightness(${bg.brightness}%)`,
      };
      break;
    case "video":
      videoUrl = bg.videoUrl;
      bgStyle = { backgroundColor: "#000" };
      break;
    default:
      bgStyle = { backgroundColor: bg.color };
  }

  // Resolve text theme for preview
  const theme = cd.textThemeId ? COUNTDOWN_TEXT_THEMES.find((t) => t.id === cd.textThemeId) : null;
  const timerFont = theme ? theme.fontFamily : cd.text.fontFamily;
  const timerWeight = theme ? theme.fontWeight : cd.text.fontWeight;
  const timerSize = theme ? theme.timerSize : cd.text.fontSize;
  const timerSpacing = theme ? theme.timerLetterSpacing : cd.text.letterSpacing;
  const timerColor = theme ? theme.timerColor : cd.text.color;
  const timerShadow = theme ? theme.timerShadow : (cd.text.shadowEnabled
    ? `${cd.text.shadowOffsetX}px ${cd.text.shadowOffsetY}px ${cd.text.shadowBlur}px ${cd.text.shadowColor}`
    : "none");
  const titleFont = theme?.titleFontFamily || timerFont;
  const titleWeight = theme?.titleFontWeight || timerWeight;
  const titleColor = theme ? theme.titleColor : "#fff";
  const titleShadow = theme ? theme.titleShadow : "none";
  const subtitleColor = theme ? theme.subtitleColor : "rgba(255,255,255,0.6)";
  const subtitleFont = theme?.subtitleFontFamily || titleFont;

  const textStyle: React.CSSProperties = {
    fontFamily: timerFont,
    fontWeight: timerWeight,
    fontSize: timerSize,
    letterSpacing: timerSpacing,
    lineHeight: 1.2,
    color: timerColor,
    textShadow: timerShadow,
  };

  const hasOverlay = bg.type === "image" || bg.type === "video";
  const tid = cd.templateId;

  return (
    <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", position: "relative", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      <div style={{ position: "absolute", inset: 0, ...bgStyle }}>
        {videoUrl && (
          <video
            src={videoUrl}
            autoPlay={bg.loop}
            loop={bg.loop}
            muted={bg.muted}
            playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: bg.imageFit === "stretch" ? "fill" : bg.imageFit || "cover" }}
          />
        )}
        {hasOverlay && (
          <div style={{ position: "absolute", inset: 0, backgroundColor: `rgba(0,0,0,${bg.overlayOpacity})` }} />
        )}
      </div>
      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", ...textStyle }}>
        {tid === "circular" && (() => {
          // The ring grows with the time text (00:09:58 needs more room than 09:58).
          const ringSize = Math.max(220, Math.round(timer.formatted.length * 44 * 0.62 + 64));
          const ringR = ringSize / 2 - 10;
          return (
          <>
            <div style={{ position: "relative", width: ringSize, height: ringSize, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={ringSize} height={ringSize} style={{ position: "absolute", top: 0, left: 0 }}>
                <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={5} />
                <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke="#3b82f6" strokeWidth={5} strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * ringR}
                  strokeDashoffset={2 * Math.PI * ringR * (1 - timer.progress / 100)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.5s ease" }} />
              </svg>
              <span style={{ fontSize: 44, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow, position: "relative", zIndex: 1 }}>{timer.formatted}</span>
            </div>
            {cd.text.title && <div style={{ marginTop: 16, fontSize: 18, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 13, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
          </>
          );
        })()}

        {tid === "minimal" && (
          <>
            <span style={{ fontSize: 64, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow }}>{timer.formatted}</span>
            {cd.text.title && <div style={{ marginTop: 12, fontSize: 18, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 13, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
          </>
        )}

        {tid === "modern" && (
          <>
            <div style={{ display: "flex", gap: 4 }}>
              {timer.formatted.split("").map((ch, i) => (
                <span key={i} style={ch === ":"
                  ? { color: "rgba(255,255,255,0.4)", fontSize: 36, fontWeight: 300, alignSelf: "flex-start", marginTop: 8, margin: "0 4px" }
                  : { background: "rgba(255,255,255,0.1)", backdropFilter: "blur(4px)", borderRadius: 8, width: 52, height: 60, display: "flex", alignItems: "center", justifyContent: "center", color: timerColor, fontFamily: timerFont, fontSize: 36, fontWeight: timerWeight, border: "1px solid var(--border)" }
                }>{ch}</span>
              ))}
            </div>
            {cd.text.title && <div style={{ marginTop: 16, fontSize: 18, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 13, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
          </>
        )}

        {tid === "conference" && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⛪</div>
            {cd.text.title && <div style={{ marginTop: 12, fontSize: 22, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 14, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
            <span style={{ fontSize: 48, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow, marginTop: 12 }}>{timer.formatted}</span>
          </>
        )}

        {tid === "lower-third" && (
          <div style={{ position: "absolute", bottom: 24, left: 24, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", padding: "12px 24px", borderRadius: 10, borderLeft: "3px solid #3b82f6" }}>
            <div style={{ fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, fontSize: 20, textShadow: timerShadow }}>{timer.formatted}</div>
            {cd.text.title && <div style={{ fontFamily: subtitleFont, color: subtitleColor, fontSize: 11, marginTop: 2 }}>{cd.text.title}</div>}
          </div>
        )}

        {tid === "full-screen" && (
          <>
            <span style={{ fontSize: 80, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow }}>{timer.formatted}</span>
            {cd.text.title && <div style={{ marginTop: 12, fontSize: 22, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 14, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
          </>
        )}

        {tid === "custom" && (
          <>
            <span style={{ fontSize: 56, fontFamily: timerFont, fontWeight: timerWeight, color: timerColor, textShadow: timerShadow }}>{timer.formatted}</span>
            {cd.text.title && <div style={{ marginTop: 12, fontSize: 18, fontFamily: titleFont, fontWeight: titleWeight, color: titleColor, textShadow: titleShadow }}>{cd.text.title}</div>}
            {cd.text.subtitle && <div style={{ marginTop: 4, fontSize: 13, fontFamily: subtitleFont, color: subtitleColor }}>{cd.text.subtitle}</div>}
          </>
        )}
      </div>

      {!timer.isRunning && timer.remaining === cd.timer.durationSeconds && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
          <div style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: 20, padding: "8px 16px", color: "#fff", fontSize: 13, fontWeight: 500 }}>
            Press Play to start preview
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings Panel ─────────────────────────────────────────────────────────

type SettingsTab = "timer" | "background" | "text" | "animation" | "obs";
const TAB_LIST: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "timer", label: "Timer", icon: "timer" },
  { key: "background", label: "Background", icon: "palette" },
  { key: "text", label: "Text", icon: "text_fields" },
  { key: "animation", label: "Animation", icon: "animation" },
  { key: "obs", label: "OBS", icon: "cast" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", height: 38, padding: "0 12px", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 4, fontSize: 14, color: "var(--input-text)" };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" as const };

function TimerSettings({ cd, onUpdate }: { cd: CountdownConfig; onUpdate: (u: Partial<CountdownConfig>) => void }) {
  const timer = cd.timer;
  const updateTimer = (u: Partial<typeof timer>) => onUpdate({ timer: { ...timer, ...u } });

  return (
    <>
      <Field label="Mode">
        <div style={{ display: "flex", gap: 6 }}>
          {([
            { value: "fixed-duration", label: "Fixed Duration" },
            { value: "end-at-time", label: "End At Time" },
          ] as const).map((opt) => (
            <button key={opt.value} onClick={() => updateTimer({ mode: opt.value })}
              style={{ flex: 1, padding: "8px 0", borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${timer.mode === opt.value ? "var(--primary)" : "var(--border)"}`, background: timer.mode === opt.value ? "var(--primary-soft)" : "transparent", color: timer.mode === opt.value ? "var(--accent-blue)" : "var(--text-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {timer.mode === "fixed-duration" ? (
        <>
          <Field label="Quick Presets">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {[
                { sec: 60, label: "1m" },
                { sec: 300, label: "5m" },
                { sec: 600, label: "10m" },
                { sec: 900, label: "15m" },
                { sec: 1800, label: "30m" },
                { sec: 3600, label: "1h" },
              ].map((p) => (
                <button key={p.sec} onClick={() => updateTimer({ durationSeconds: p.sec })}
                  style={{ padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 500, border: `1px solid ${timer.durationSeconds === p.sec ? "var(--primary)" : "var(--border)"}`, background: timer.durationSeconds === p.sec ? "var(--primary-soft)" : "transparent", color: timer.durationSeconds === p.sec ? "var(--accent-blue)" : "var(--text-secondary)", cursor: "pointer" }}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Duration (seconds)">
            <input type="number" min={1} value={timer.durationSeconds} onChange={(e) => { const n = Number(e.target.value); if (n > 0) updateTimer({ durationSeconds: n }); }} style={inputStyle} />
          </Field>
        </>
      ) : (
        <Field label="End At Time">
          <input type="time" value={timer.endAt ? new Date(timer.endAt).toTimeString().slice(0, 5) : "19:00"}
            onChange={(e) => updateTimer({ endAt: e.target.value })} style={inputStyle} />
        </Field>
      )}

      <Field label="Display">
        <div style={{ display: "flex", gap: 12 }}>
          {(["showHours", "showMinutes", "showSeconds"] as const).map((key) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={timer[key]} onChange={(e) => updateTimer({ [key]: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              {key.replace("show", "")}
            </label>
          ))}
        </div>
      </Field>
    </>
  );
}

// ── Gradient parsing helpers for built-in backgrounds ──────────────────────

function extractGradientStart(gradient: string): string {
  const match = gradient.match(/linear-gradient\([^,]+,\s*([^,]+)/);
  return match?.[1]?.trim() || "#0f172a";
}

function extractGradientEnd(gradient: string): string {
  const match = gradient.match(/linear-gradient\([^,]+,[^,]+,\s*([^)]+)\)/);
  return match?.[1]?.trim() || "#1e293b";
}

function extractGradientAngle(gradient: string): number {
  const match = gradient.match(/linear-gradient\((\d+)deg/);
  return match ? parseInt(match[1], 10) : 135;
}

function BackgroundSettings({ cd, onUpdate }: { cd: CountdownConfig; onUpdate: (u: Partial<CountdownConfig>) => void }) {
  const bg = cd.background;
  const updateBg = (u: Partial<typeof bg>) => onUpdate({ background: { ...bg, ...u } });
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [showMediaPicker, setShowMediaPicker] = useState<"image" | "video" | null>(null);
  const [mediaSearch, setMediaSearch] = useState("");
  const [builtinCategory, setBuiltinCategory] = useState(BUILTIN_CATEGORIES[0]?.id ?? "nature");
  const [showBuiltins, setShowBuiltins] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bgTypes: { value: BackgroundType; label: string }[] = [
    { value: "solid", label: "Solid" },
    { value: "gradient", label: "Gradient" },
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "transparent", label: "Transparent" },
  ];

  // Load media library on demand
  const loadMediaLibrary = useCallback(async (filter: "image" | "video") => {
    try {
      const { getAllMedia } = await import("../library/libraryDb");
      const all = await getAllMedia();
      setMediaLibrary(all.filter((m) => m.type === filter));
    } catch {
      setMediaLibrary([]);
    }
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError(null);
    const file = files[0];
    const result = validateMediaFile(file);
    if (!result.valid) {
      setUploadError(result.error!);
      return;
    }

    try {
      // Delete old asset if replacing
      if (bg.assetId) {
        await deleteCountdownAsset(bg.assetId).catch(() => { });
      }

      const { assetId, overlayUrl } = await saveCountdownAsset(file);
      const update: Partial<typeof bg> = {
        assetId,
        source: "upload",
        builtinId: "",
      };
      if (result.mediaType === "image") {
        update.type = "image";
        update.imageUrl = overlayUrl;
      } else {
        update.type = "video";
        update.videoUrl = overlayUrl;
      }
      updateBg(update);
    } catch (err) {
      setUploadError(`Upload failed: ${err}`);
    }
  }, [bg.assetId, updateBg]);

  const handleMediaLibrarySelect = useCallback((item: MediaItem) => {
    const isImage = item.type === "image";
    updateBg({
      type: isImage ? "image" : "video",
      source: "media-library",
      assetId: "",
      builtinId: "",
      imageUrl: isImage ? (item.url || "") : bg.imageUrl,
      videoUrl: !isImage ? (item.url || "") : bg.videoUrl,
    });
    setShowMediaPicker(null);
  }, [updateBg, bg.imageUrl, bg.videoUrl]);

  const handleBuiltinSelect = useCallback((builtin: BuiltinBackground) => {
    updateBg({
      type: builtin.type,
      source: "builtin",
      assetId: "",
      builtinId: builtin.id,
      imageUrl: builtin.type === "image" ? builtin.source : bg.imageUrl,
      videoUrl: builtin.type === "video" ? builtin.source : bg.videoUrl,
      color: builtin.type === "gradient" ? bg.color : bg.color,
      gradientStart: builtin.type === "gradient" ? extractGradientStart(builtin.source) : bg.gradientStart,
      gradientEnd: builtin.type === "gradient" ? extractGradientEnd(builtin.source) : bg.gradientEnd,
      gradientAngle: builtin.type === "gradient" ? extractGradientAngle(builtin.source) : bg.gradientAngle,
    });
    setShowBuiltins(false);
  }, [updateBg, bg.color, bg.gradientStart, bg.gradientEnd, bg.gradientAngle]);

  const handleRemoveBackground = useCallback(async () => {
    if (bg.assetId) {
      await deleteCountdownAsset(bg.assetId).catch(() => { });
    }
    updateBg({
      type: "solid",
      imageUrl: "",
      videoUrl: "",
      assetId: "",
      builtinId: "",
      source: "upload",
      flyerMode: false,
    });
  }, [bg.assetId, updateBg]);

  const handleFlyerModeToggle = useCallback(() => {
    if (!bg.flyerMode) {
      // Turning ON: darken image for timer readability
      updateBg({ flyerMode: true, brightness: 60, overlayOpacity: 0.5, blur: 0 });
    } else {
      // Turning OFF: restore defaults
      updateBg({ flyerMode: false, brightness: 100, overlayOpacity: 0.4 });
    }
  }, [bg.flyerMode, updateBg]);

  // Resolve display URL for preview thumbnail
  const displayUrl = bg.type === "image" ? bg.imageUrl : bg.type === "video" ? bg.videoUrl : "";
  const hasMedia = (bg.type === "image" || bg.type === "video") && displayUrl;

  return (
    <>
      {/* ── Type selector ────────────────────────────────────────────── */}
      <Field label="Type">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {bgTypes.map((t) => (
            <button key={t.value} onClick={() => updateBg({ type: t.value })}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: `1px solid ${bg.type === t.value ? "var(--primary)" : "var(--border)"}`, background: bg.type === t.value ? "var(--primary-soft)" : "transparent", color: bg.type === t.value ? "var(--accent-blue)" : "var(--text-secondary)", cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      {/* ── Solid ────────────────────────────────────────────────────── */}
      {bg.type === "solid" && (
        <Field label="Color">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={bg.color} onChange={(e) => updateBg({ color: e.target.value })} style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", padding: 2 }} />
            <input type="text" value={bg.color} onChange={(e) => updateBg({ color: e.target.value })} style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }} />
          </div>
        </Field>
      )}

      {/* ── Gradient ─────────────────────────────────────────────────── */}
      {bg.type === "gradient" && (
        <>
          <Field label="Start Color">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={bg.gradientStart} onChange={(e) => updateBg({ gradientStart: e.target.value })} style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", padding: 2 }} />
              <input type="text" value={bg.gradientStart} onChange={(e) => updateBg({ gradientStart: e.target.value })} style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }} />
            </div>
          </Field>
          <Field label="End Color">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={bg.gradientEnd} onChange={(e) => updateBg({ gradientEnd: e.target.value })} style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", padding: 2 }} />
              <input type="text" value={bg.gradientEnd} onChange={(e) => updateBg({ gradientEnd: e.target.value })} style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }} />
            </div>
          </Field>
          <Field label={`Angle: ${bg.gradientAngle}°`}>
            <input type="range" min={0} max={360} value={bg.gradientAngle} onChange={(e) => updateBg({ gradientAngle: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
          </Field>
        </>
      )}

      {/* ── Image ────────────────────────────────────────────────────── */}
      {bg.type === "image" && (
        <>
          {/* Upload + Media Library buttons */}
          {!hasMedia && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--input-bg)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Upload size={14} /> Upload Image
              </button>
              <button onClick={() => { setShowMediaPicker("image"); loadMediaLibrary("image"); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--input-bg)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Icon name="folder" size={16} /> Media Library
              </button>
            </div>
          )}

          {/* Placeholder when no image */}
          {!hasMedia && !showMediaPicker && (
            <div style={{ padding: "24px 16px", borderRadius: 8, border: "1px dashed var(--border)", textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginBottom: 10 }}>
              Drop an image or choose from Media Library
            </div>
          )}

          {/* Preview + Replace/Remove when image is set */}
          {hasMedia && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
                <img src={displayUrl} alt="" style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", bottom: 6, right: 6, display: "flex", gap: 4 }}>
                  <button onClick={() => fileInputRef.current?.click()}
                    style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>
                    Replace
                  </button>
                  <button onClick={handleRemoveBackground}
                    style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(220,38,38,0.8)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Image fit */}
          <Field label="Fit">
            <div style={{ display: "flex", gap: 4 }}>
              {(["cover", "contain", "stretch"] as ImageFit[]).map((fit) => (
                <button key={fit} onClick={() => updateBg({ imageFit: fit })}
                  style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 500, border: `1px solid ${bg.imageFit === fit ? "var(--primary)" : "var(--border)"}`, background: bg.imageFit === fit ? "var(--primary-soft)" : "transparent", color: bg.imageFit === fit ? "var(--accent-blue)" : "var(--text-secondary)", cursor: "pointer", textTransform: "capitalize" }}>
                  {fit}
                </button>
              ))}
            </div>
          </Field>

          {/* Flyer Mode */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 10px", borderRadius: 8, background: bg.flyerMode ? "var(--primary-soft)" : "var(--input-bg)", border: `1px solid ${bg.flyerMode ? "var(--primary)" : "var(--border)"}` }}>
              <input type="checkbox" checked={bg.flyerMode} onChange={handleFlyerModeToggle} style={{ accentColor: "var(--primary)" }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: bg.flyerMode ? "var(--accent-blue)" : "var(--text-primary)" }}>Flyer Mode</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Auto-darkens image for timer readability</div>
              </div>
            </label>
          </div>

          {/* Manual controls (hidden when Flyer Mode is ON) */}
          {!bg.flyerMode && (
            <>
              <Field label={`Blur: ${bg.blur}px`}>
                <input type="range" min={0} max={20} value={bg.blur} onChange={(e) => updateBg({ blur: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
              </Field>
              <Field label={`Brightness: ${bg.brightness}%`}>
                <input type="range" min={10} max={200} value={bg.brightness} onChange={(e) => updateBg({ brightness: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
              </Field>
            </>
          )}
          <Field label={`Overlay: ${Math.round(bg.overlayOpacity * 100)}%`}>
            <input type="range" min={0} max={1} step={0.05} value={bg.overlayOpacity} onChange={(e) => updateBg({ overlayOpacity: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
          </Field>
        </>
      )}

      {/* ── Video ────────────────────────────────────────────────────── */}
      {bg.type === "video" && (
        <>
          {/* Upload + Media Library buttons */}
          {!hasMedia && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--input-bg)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Upload size={14} /> Upload Video
              </button>
              <button onClick={() => { setShowMediaPicker("video"); loadMediaLibrary("video"); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--input-bg)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Icon name="folder" size={16} /> Media Library
              </button>
            </div>
          )}

          {/* Placeholder when no video */}
          {!hasMedia && !showMediaPicker && (
            <div style={{ padding: "24px 16px", borderRadius: 8, border: "1px dashed var(--border)", textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginBottom: 10 }}>
              Drop a video or choose from Media Library
            </div>
          )}

          {/* Preview + Replace/Remove when video is set */}
          {hasMedia && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 6, background: "#000" }}>
                <video src={displayUrl} muted loop style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", bottom: 6, right: 6, display: "flex", gap: 4 }}>
                  <button onClick={() => fileInputRef.current?.click()}
                    style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>
                    Replace
                  </button>
                  <button onClick={handleRemoveBackground}
                    style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(220,38,38,0.8)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Video controls */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={bg.loop} onChange={(e) => updateBg({ loop: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              Loop
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={bg.muted} onChange={(e) => updateBg({ muted: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              Muted
            </label>
          </div>

          <Field label={`Overlay: ${Math.round(bg.overlayOpacity * 100)}%`}>
            <input type="range" min={0} max={1} step={0.05} value={bg.overlayOpacity} onChange={(e) => updateBg({ overlayOpacity: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
          </Field>
          <Field label={`Blur: ${bg.blur}px`}>
            <input type="range" min={0} max={20} value={bg.blur} onChange={(e) => updateBg({ blur: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
          </Field>
          <Field label={`Brightness: ${bg.brightness}%`}>
            <input type="range" min={10} max={200} value={bg.brightness} onChange={(e) => updateBg({ brightness: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
          </Field>
        </>
      )}

      {/* ── Upload error toast ───────────────────────────────────────── */}
      {uploadError && (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--error-bg)", border: "1px solid var(--error-border)", color: "var(--error)", fontSize: 11, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* ── Hidden file input ────────────────────────────────────────── */}
      <input ref={fileInputRef} type="file" accept={backgroundFileAccept()} style={{ display: "none" }}
        onChange={(e) => { handleFileUpload(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ""; }} />

      {/* ── Media Library picker modal ───────────────────────────────── */}
      {showMediaPicker && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 12, background: "var(--input-bg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Choose from Media Library</span>
            <button onClick={() => { setShowMediaPicker(null); setMediaSearch(""); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
          <input type="text" placeholder="Search..." value={mediaSearch} onChange={(e) => setMediaSearch(e.target.value)}
            style={{ ...inputStyle, marginBottom: 8, height: 30, fontSize: 12 }} />
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {mediaLibrary.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>No {showMediaPicker} files in library</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {mediaLibrary
                  .filter((m) => !mediaSearch || m.name.toLowerCase().includes(mediaSearch.toLowerCase()))
                  .map((item) => (
                    <button key={item.id} onClick={() => handleMediaLibrarySelect(item)}
                      style={{ borderRadius: 6, overflow: "hidden", border: "2px solid transparent", cursor: "pointer", background: "none", padding: 0, textAlign: "left" }}
                      title={item.name}>
                      <div style={{ width: "100%", height: 60, backgroundImage: `url(${item.thumbnailUrl || item.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                      <div style={{ fontSize: 9, padding: "3px 4px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Built-in backgrounds ─────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
        <button onClick={() => setShowBuiltins(!showBuiltins)}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span><Icon name="palette" size={16} /> Built-in Backgrounds</span>
          <span style={{ fontSize: 10 }}>{showBuiltins ? "▲" : "▼"}</span>
        </button>

        {showBuiltins && (
          <div style={{ marginTop: 8 }}>
            {/* Category chips */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {BUILTIN_CATEGORIES.map((cat) => (
                <button key={cat.id} onClick={() => setBuiltinCategory(cat.id)}
                  style={{ padding: "3px 8px", borderRadius: 12, fontSize: 10, fontWeight: 500, border: `1px solid ${builtinCategory === cat.id ? "var(--primary)" : "var(--border)"}`, background: builtinCategory === cat.id ? "var(--primary-soft)" : "transparent", color: builtinCategory === cat.id ? "var(--accent-blue)" : "var(--text-muted)", cursor: "pointer" }}>
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
            {/* Background grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {getBuiltinsByCategory(builtinCategory).map((b) => (
                <button key={b.id} onClick={() => handleBuiltinSelect(b)}
                  style={{ borderRadius: 6, overflow: "hidden", border: `2px solid ${bg.builtinId === b.id ? "var(--primary)" : "transparent"}`, cursor: "pointer", background: "none", padding: 0, textAlign: "left" }}
                  title={b.label}>
                  <div style={{ width: "100%", height: 50, background: b.thumbnail }} />
                  <div style={{ fontSize: 9, padding: "3px 4px", color: "var(--text-secondary)" }}>{b.label}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TextSettings({ cd, onUpdate }: { cd: CountdownConfig; onUpdate: (u: Partial<CountdownConfig>) => void }) {
  const text = cd.text;
  const updateText = (u: Partial<typeof text>) => onUpdate({ text: { ...text, ...u } });

  const handleSelectTheme = (theme: CountdownTextTheme) => {
    loadTextThemeFont(theme);
    const newText = applyTextTheme(theme, text);
    onUpdate({ text: newText, textThemeId: theme.id });
  };

  const currentTheme = cd.textThemeId ? COUNTDOWN_TEXT_THEMES.find((t) => t.id === cd.textThemeId) : null;

  return (
    <>
      {/* ── Theme Picker (Canva-style gallery) ──────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Text Theme</span>
          {currentTheme && (
            <span style={{ fontSize: 10, color: "var(--primary)", fontWeight: 500 }}>{currentTheme.name}</span>
          )}
        </div>
        <TextThemePicker selectedThemeId={cd.textThemeId} onSelectTheme={handleSelectTheme} />
      </div>

      {/* ── Manual Controls ─────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Customize
        </div>
        <Field label="Title">
          <input type="text" value={text.title} onChange={(e) => updateText({ title: e.target.value })} placeholder="Service Starts Soon" style={inputStyle} />
        </Field>
        <Field label="Subtitle">
          <input type="text" value={text.subtitle} onChange={(e) => updateText({ subtitle: e.target.value })} placeholder="Welcome to Worship" style={inputStyle} />
        </Field>
        <Field label="Font Weight">
          <select value={text.fontWeight} onChange={(e) => updateText({ fontWeight: Number(e.target.value) })} style={selectStyle}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>{w} — {["", "", "", "Light", "Regular", "Medium", "Semi", "Bold", "Extra Bold", "Black"][w / 100]}</option>
            ))}
          </select>
        </Field>
        <Field label={`Font Size: ${text.fontSize}px`}>
          <input type="range" min={12} max={120} value={text.fontSize} onChange={(e) => updateText({ fontSize: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
        </Field>
        <Field label={`Letter Spacing: ${text.letterSpacing}px`}>
          <input type="range" min={-5} max={20} value={text.letterSpacing} onChange={(e) => updateText({ letterSpacing: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
        </Field>
        <Field label="Color">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={text.color} onChange={(e) => updateText({ color: e.target.value })} style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", padding: 2 }} />
            <input type="text" value={text.color} onChange={(e) => updateText({ color: e.target.value })} style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }} />
          </div>
        </Field>
        <Field label="Shadow">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={text.shadowEnabled} onChange={(e) => updateText({ shadowEnabled: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
            Enable text shadow
          </label>
        </Field>
        {text.shadowEnabled && (
          <>
            <Field label="Shadow Color">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={text.shadowColor.startsWith("rgba") ? "#000000" : text.shadowColor} onChange={(e) => updateText({ shadowColor: e.target.value })} style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", padding: 2 }} />
                <input type="text" value={text.shadowColor} onChange={(e) => updateText({ shadowColor: e.target.value })} style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }} />
              </div>
            </Field>
            <Field label={`Shadow Blur: ${text.shadowBlur}px`}>
              <input type="range" min={0} max={30} value={text.shadowBlur} onChange={(e) => updateText({ shadowBlur: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
            </Field>
          </>
        )}
      </div>
    </>
  );
}

function AnimationSettings({ cd, onUpdate }: { cd: CountdownConfig; onUpdate: (u: Partial<CountdownConfig>) => void }) {
  const anim = cd.animation;
  const updateAnim = (u: Partial<typeof anim>) => onUpdate({ animation: { ...anim, ...u } });
  const animOpts: { value: AnimationType; label: string }[] = [
    { value: "none", label: "None" },
    { value: "fade-in", label: "Fade In" },
    { value: "slide-up", label: "Slide Up" },
    { value: "scale", label: "Scale" },
    { value: "pulse", label: "Pulse" },
    { value: "breathing", label: "Breathing" },
  ];

  return (
    <>
      <Field label="Entrance Animation">
        <select value={anim.entrance} onChange={(e) => updateAnim({ entrance: e.target.value as AnimationType })} style={selectStyle}>
          {animOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Background Motion">
        <select value={anim.backgroundMotion} onChange={(e) => updateAnim({ backgroundMotion: e.target.value as "none" | "pan" | "zoom-pulse" })} style={selectStyle}>
          <option value="none">None</option>
          <option value="pan">Pan</option>
          <option value="zoom-pulse">Zoom Pulse</option>
        </select>
      </Field>
      <Field label={`Speed: ${anim.speed}x`}>
        <input type="range" min={0.5} max={2} step={0.25} value={anim.speed} onChange={(e) => updateAnim({ speed: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--primary)" }} />
      </Field>
    </>
  );
}

function OBSSettings({ cd, onUpdate }: { cd: CountdownConfig; onUpdate: (u: Partial<CountdownConfig>) => void }) {
  const obs = cd.obs;
  const updateObs = (u: Partial<typeof obs>) => onUpdate({ obs: { ...obs, ...u } });

  return (
    <>
      <Field label="OBS Scene">
        <input type="text" value={obs.sceneName} onChange={(e) => updateObs({ sceneName: e.target.value })} placeholder="Scene name" style={inputStyle} />
      </Field>
      <Field label="When Countdown Reaches Zero">
        <select value={obs.autoAction} onChange={(e) => updateObs({ autoAction: e.target.value as AutoAction })} style={selectStyle}>
          <option value="none">Do Nothing</option>
          <option value="switch-scene">Switch OBS Scene</option>
          <option value="hide-countdown">Hide Countdown</option>
          <option value="show-welcome">Show Welcome Graphic</option>
          <option value="play-video">Play Video</option>
        </select>
      </Field>
      {obs.autoAction === "switch-scene" && (
        <Field label="Target Scene">
          <input type="text" value={obs.autoActionScene} onChange={(e) => updateObs({ autoActionScene: e.target.value })} placeholder="Main Scene" style={inputStyle} />
        </Field>
      )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function CountdownDesignsView({ showPicker, setShowPicker }: { showPicker: boolean; setShowPicker: (open: boolean) => void }) {
  const [countdowns, setCountdowns] = useState<CountdownConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("timer");
  const [loaded, setLoaded] = useState(false);

  const active = countdowns.find((c) => c.id === activeId) ?? null;
  const timer = useCountdownTimer(active ?? createDefaultCountdown("circular", "placeholder"));

  // Load from IndexedDB
  useEffect(() => {
    getCountdowns().then((cds) => {
      setCountdowns(cds);
      if (cds.length > 0) setActiveId(cds[0].id);
      setLoaded(true);
    });
  }, []);

  const handleCreate = useCallback((templateId: CountdownTemplateId) => {
    const id = nanoid();
    const cd = createDefaultCountdown(templateId, id);
    setCountdowns((prev) => [cd, ...prev]);
    saveCountdown(cd);
    setActiveId(id);
  }, []);

  const handlePickStyle = useCallback((presetId: string) => {
    setShowPicker(false);
    if (presetId === "classic") {
      handleCreate("circular");
      return;
    }
    const id = nanoid();
    const cd = createLayoutCountdown(presetId, id);
    setCountdowns((prev) => [cd, ...prev]);
    saveCountdown(cd);
    setActiveId(id);
  }, [handleCreate]);

  const handleUpdate = useCallback((updates: Partial<CountdownConfig>) => {
    if (!activeId) return;
    setCountdowns((prev) => {
      const next = prev.map((cd) => cd.id === activeId ? { ...cd, ...updates, updatedAt: new Date().toISOString() } : cd);
      const updated = next.find((cd) => cd.id === activeId);
      if (updated) saveCountdown(updated);
      return next;
    });
  }, [activeId]);

  const handleSendToOBS = useCallback(() => {
    if (!active) return;
    // Generate overlay HTML and copy to clipboard
    const html = generateOverlayHTML(active);
    navigator.clipboard.writeText(html).catch(() => {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `countdown-overlay.html`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [active]);

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
        <Timer className="w-6 h-6 animate-spin" style={{ marginRight: 8 }} />
        Loading countdowns...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {isLayoutDesign(active) && <CountdownLayerEditor design={active} onChange={handleUpdate} />}

      {/* ── Center: Preview ── */}
      {!isLayoutDesign(active) && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Timer size={18} style={{ color: "var(--accent-blue)" }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Countdowns</span>
          </div>
          {active && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={timer.isRunning ? timer.pause : timer.start}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: timer.isRunning ? "var(--warning-bg)" : "var(--success-bg)", color: timer.isRunning ? "var(--warning)" : "var(--success)" }}>
                {timer.isRunning ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
              </button>
              <button onClick={timer.reset} style={{ padding: 7, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer" }} title="Reset">
                <RotateCcw size={14} />
              </button>
              <div style={{ width: 1, height: 22, background: "var(--border)" }} />
              <button onClick={() => handleUpdate({})}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border)", cursor: "pointer" }}>
                <Save size={14} /> Save
              </button>
              <button onClick={handleSendToOBS}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
                <Send size={14} /> Send to OBS
              </button>
            </div>
          )}
        </div>

        {/* Preview area */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflow: "auto", background: "var(--bg)" }}>
          {active ? (
            <div style={{ width: "100%", maxWidth: 760 }}>
              <CountdownPreview cd={active} timer={timer} />
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <input value={active.title} onChange={(e) => handleUpdate({ title: e.target.value })}
                  style={{ background: "transparent", border: "none", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", textAlign: "center", width: "100%", outline: "none" }}
                  placeholder="Countdown title..." />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <Clock size={48} style={{ color: "var(--text-disabled)", margin: "0 auto 12px" }} />
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>No countdown selected</h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 16 }}>Create a countdown to get started</p>
              <button onClick={() => setShowPicker(true)}
                style={{ padding: "10px 24px", background: "var(--primary)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>
                + Create Countdown
              </button>
            </div>
          )}
        </div>
      </div>

      )}

      {/* ── Right Panel: Settings ── */}
      {active && !isLayoutDesign(active) && (
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 3, padding: 8, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {TAB_LIST.map((tab) => (
              <button key={tab.key} onClick={() => setSettingsTab(tab.key)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: settingsTab === tab.key ? "var(--surface-raised)" : "transparent", color: settingsTab === tab.key ? "var(--text-primary)" : "var(--text-muted)", transition: "all 0.12s" }}>
                <Icon name={tab.icon} size={16} style={{ marginRight: 4 }} />{tab.label}
              </button>
            ))}
          </div>

          {/* Settings content */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {settingsTab === "timer" && <TimerSettings cd={active} onUpdate={handleUpdate} />}
            {settingsTab === "background" && <BackgroundSettings cd={active} onUpdate={handleUpdate} />}
            {settingsTab === "text" && <TextSettings cd={active} onUpdate={handleUpdate} />}
            {settingsTab === "animation" && <AnimationSettings cd={active} onUpdate={handleUpdate} />}
            {settingsTab === "obs" && <OBSSettings cd={active} onUpdate={handleUpdate} />}
          </div>
        </div>
      )}
      {showPicker && <CountdownStylePicker onPick={handlePickStyle} onClose={() => setShowPicker(false)} />}
    </div>
  );
}

// ── OBS Overlay HTML Generator ─────────────────────────────────────────────

function generateOverlayHTML(cd: CountdownConfig): string {
  const bg = cd.background;
  const objectFit = bg.imageFit || "cover";

  // Build background CSS for solid/gradient types
  let bgCSS = "";
  let bgMediaElement = "";
  switch (bg.type) {
    case "solid":
      bgCSS = `background-color:${bg.color}`;
      break;
    case "gradient":
      bgCSS = `background:linear-gradient(${bg.gradientAngle}deg,${bg.gradientStart},${bg.gradientEnd})`;
      break;
    case "image":
      bgCSS = `background-color:#000`;
      bgMediaElement = `<img src="${bg.imageUrl}" style="position:absolute;inset:0;width:1920px;height:1080px;object-fit:${objectFit};filter:blur(${bg.blur}px) brightness(${bg.brightness}%)">`;
      break;
    case "video":
      bgCSS = `background-color:#000`;
      bgMediaElement = `<video src="${bg.videoUrl}" ${bg.loop ? "autoplay loop" : ""} ${bg.muted ? "muted" : ""} playsinline style="position:absolute;inset:0;width:1920px;height:1080px;object-fit:${objectFit}">`;
      break;
    default:
      bgCSS = `background-color:${bg.color}`;
  }

  const hasOverlay = bg.type === "image" || bg.type === "video" || bg.flyerMode;
  const overlayOpacity = bg.flyerMode ? Math.max(bg.overlayOpacity, 0.5) : bg.overlayOpacity;

  const shadow = cd.text.shadowEnabled ? `${cd.text.shadowOffsetX}px ${cd.text.shadowOffsetY}px ${cd.text.shadowBlur}px ${cd.text.shadowColor}` : "none";

  // Resolve text theme (if any)
  const theme = cd.textThemeId ? COUNTDOWN_TEXT_THEMES.find((t) => t.id === cd.textThemeId) : null;
  const timerFont = theme ? theme.fontFamily : cd.text.fontFamily;
  const timerWeight = theme ? theme.fontWeight : cd.text.fontWeight;
  const timerSize = theme ? theme.timerSize : cd.text.fontSize;
  const timerSpacing = theme ? theme.timerLetterSpacing : cd.text.letterSpacing;
  const timerColor = theme ? theme.timerColor : cd.text.color;
  const timerShadow = theme ? theme.timerShadow : shadow;
  const titleFont = theme?.titleFontFamily || timerFont;
  const titleSize = theme ? theme.titleSize : Math.round(cd.text.fontSize * 0.4);
  const titleWeight = theme?.titleFontWeight || timerWeight;
  const titleSpacing = theme ? theme.titleLetterSpacing : cd.text.letterSpacing;
  const titleTransform = theme ? theme.titleTransform : "none";
  const titleColor = theme ? theme.titleColor : cd.text.color;
  const titleShadow = theme ? theme.titleShadow : shadow;
  const subtitleFont = theme?.subtitleFontFamily || timerFont;
  const subtitleSize = theme ? theme.subtitleSize : Math.round(cd.text.fontSize * 0.3);
  const subtitleWeight = theme?.subtitleFontWeight || 400;
  const subtitleSpacing = theme ? theme.subtitleLetterSpacing : 0;
  const subtitleTransform = theme ? theme.subtitleTransform : "none";
  const subtitleColor = theme ? theme.subtitleColor : "rgba(255,255,255,0.65)";
  const fontUrl = theme?.fontUrl || "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${fontUrl ? `<link rel="stylesheet" href="${fontUrl}">` : ""}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;overflow:hidden}
.c{width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;${bgCSS}}
${hasOverlay ? `.ov{position:absolute;inset:0;background-color:rgba(0,0,0,${overlayOpacity})}` : ""}
.ct{position:relative;z-index:1;text-align:center}
.t{font-family:${timerFont};font-weight:${timerWeight};font-size:${timerSize}px;letter-spacing:${timerSpacing}px;line-height:1.2;color:${timerColor};text-shadow:${timerShadow}${theme?.timerGlow ? ';text-shadow:' + timerShadow + ',' + theme.timerGlow : ''}}
.tt{font-family:${titleFont};font-size:${titleSize}px;font-weight:${titleWeight};color:${titleColor};margin-top:14px;text-shadow:${titleShadow};letter-spacing:${titleSpacing}px;text-transform:${titleTransform}}
.ts{font-family:${subtitleFont};font-size:${subtitleSize}px;font-weight:${subtitleWeight};color:${subtitleColor};margin-top:6px;letter-spacing:${subtitleSpacing}px;text-transform:${subtitleTransform}}
.r{position:relative;width:${timerSize * 3.5}px;height:${timerSize * 3.5}px;display:flex;align-items:center;justify-content:center}
.rt{position:relative;z-index:1;font-family:monospace;font-weight:700;font-size:${Math.round(timerSize * 0.9)}px;color:#fff}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes scale{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}
</style></head><body><div class="c">${bgMediaElement}${hasOverlay ? '<div class="ov"></div>' : ""}<div class="ct" id="ct"></div></div>
<script>
const D=${JSON.stringify(cd)};const ct=document.getElementById('ct');
function fmt(r){const ts=Math.floor(r),h=Math.floor(ts/3600),m=Math.floor((ts%3600)/60),s=ts%60;
return D.timer.showHours?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function ringSz(t){const f=D.text.fontSize;return Math.max(f*3.5,Math.round(t.length*f*0.9*0.62+f*1.5))}
function ring(p,t){const sz=ringSz(t),r=(sz-8)/2,c=2*Math.PI*r,o=c-(p/100)*c;
return '<svg width="'+sz+'" height="'+sz+'" style="position:absolute;top:0;left:0"><circle cx="'+sz/2+'" cy="'+sz/2+'" r="'+r+'" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5"/><circle cx="'+sz/2+'" cy="'+sz/2+'" r="'+r+'" fill="none" stroke="#3b82f6" stroke-width="5" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+o+'" style="transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset .5s ease"/></svg>'}
let rem=D.timer.durationSeconds,tot=rem,prog=0;
function render(){const t=fmt(rem);
if(D.templateId==='circular')ct.innerHTML='<div class="r" style="width:'+ringSz(t)+'px;height:'+ringSz(t)+'px">'+ring(prog,t)+'<div class="rt">'+t+'</div></div>'+(D.text.title?'<div class="tt">'+D.text.title+'</div>':'')+(D.text.subtitle?'<div class="ts">'+D.text.subtitle+'</div>':'');
else if(D.templateId==='lower-third')ct.innerHTML='<div style="position:fixed;bottom:30px;left:30px;background:rgba(0,0,0,.7);padding:12px 24px;border-radius:10px;border-left:3px solid #3b82f6"><div style="font-family:monospace;font-weight:700;color:#fff;font-size:22px">'+t+'</div>'+(D.text.title?'<div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:3px">'+D.text.title+'</div>':'')+'</div>';
else ct.innerHTML='<div class="t">'+t+'</div>'+(D.text.title?'<div class="tt">'+D.text.title+'</div>':'')+(D.text.subtitle?'<div class="ts">'+D.text.subtitle+'</div>':'')}
function tick(){if(rem>0){rem--;prog=((tot-rem)/tot)*100}render();if(rem>0)requestAnimationFrame(tick)}
render();tick();
</script></body></html>`;
}

// ── Page shell: Designs | Rundowns ─────────────────────────────────────────

type CountdownsMode = "designs" | "rundowns";
const MODE_STORAGE_KEY = "mce-countdowns-mode";

function readStoredMode(): CountdownsMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "rundowns" ? "rundowns" : "designs";
  } catch {
    return "designs";
  }
}

export default function CountdownsPage() {
  const [mode, setMode] = useState<CountdownsMode>(readStoredMode);
  const [showPicker, setShowPicker] = useState(false);

  const choose = (next: CountdownsMode) => {
    setMode(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* ignore */ }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "7px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 650,
    color: active ? "#fff" : "var(--text-muted)",
    background: active ? "var(--primary)" : "transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
        <button type="button" style={tabStyle(mode === "designs")} onClick={() => choose("designs")}>Designs</button>
        <button type="button" style={tabStyle(mode === "rundowns")} onClick={() => choose("rundowns")}>Rundowns</button>
        <span style={{ marginLeft: 10, fontSize: 12, color: "var(--text-secondary)" }}>
          {mode === "designs" ? "Design how your countdown looks." : "Build timers and messages for a service, then run them from the OBS Dock."}
        </span>
        {mode === "designs" && (
          <button type="button" onClick={() => setShowPicker(true)}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--primary)", color: "#fff", borderRadius: 3, fontSize: 13, fontWeight: 650, border: "none", cursor: "pointer" }}>
            <Plus size={15} /> Create Countdown
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {mode === "designs" ? <CountdownDesignsView showPicker={showPicker} setShowPicker={setShowPicker} /> : <RundownsView />}
      </div>
    </div>
  );
}
