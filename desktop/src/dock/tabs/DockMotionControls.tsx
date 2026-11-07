/**
 * DockMotionControls.tsx — extra settings for Motion lower thirds (public/kinetic).
 *
 * Shown inside the Dock lower-third editor (Ministry → Lower Thirds) in place of the
 * colour "Appearance" panel, because Motion straps are bare text with no background.
 * Text fields, memory slots and the Send / Animate out buttons stay as they are.
 *
 *   Speaker  — pick from the church's speaker list to fill the name fields
 *   Size     — scales the strap, 20%–160% (kxScale)
 *   Duration — seconds on screen before it animates out by itself; 0 keeps it on (kxAutoOut)
 *   Cycles   — for graphics that run through a set (Social Handles): how many times the whole set
 *              plays before it animates out; 0 keeps looping (kxCycles). Replaces Duration.
 *   Speed    — animation speed (kxSpeed)
 *   Position — where the strap sits on the 1920×1080 canvas
 *   Text     — text colour (kxColor)
 *   Colours  — any other colour fields the theme declares (Church graphics: bar, panel, accent…)
 *
 * Every control is driven by the theme's own variables, so a strap only shows what it uses:
 * the Speaker picker appears on speaker straps, the Text colour only when the strap has kxColor.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LowerThirdTheme, LTPosition } from "../../lowerthirds/types";
import { LT_POSITION_LABELS, LT_POSITIONS } from "../../lowerthirds/types";
import { isSpeakerTheme } from "../../lowerthirds/speakerThemeUtils";
import { CYCLES_KEY, CYCLE_PRESETS, DEFAULT_CYCLES, PER_KEY, formatSeconds, getCycleInfo, parseCycles } from "../../lowerthirds/cycleSet";

export interface DockMotionSpeaker {
  name: string;
  role: string;
  isMain?: boolean;
}

interface DockMotionControlsProps {
  theme: LowerThirdTheme;
  speakers: DockMotionSpeaker[];
  selectedSpeakerIdx: number | null;
  onSelectSpeaker: (index: number | null) => void;
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  position: LTPosition;
  onPositionChange: (position: LTPosition) => void;
}

const SPEED_OPTIONS = ["0.5", "0.75", "1", "1.25", "1.5", "2"];

function hexOr(value: string | undefined, fallback: string): string {
  const v = (value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split("").map((c) => c + c).join("")}`.toLowerCase();
  return fallback;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--dock-text)",
  marginBottom: 3,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--dock-input-bg, var(--dock-surface))",
  border: "1px solid var(--dock-border)",
  borderRadius: 3,
  padding: "3px 6px",
  fontSize: 11,
  color: "var(--dock-text)",
  fontFamily: "inherit",
};

export default function DockMotionControls({
  theme,
  speakers,
  selectedSpeakerIdx,
  onSelectSpeaker,
  values,
  onValueChange,
  position,
  onPositionChange,
}: DockMotionControlsProps) {
  const { t } = useTranslation();
  const [customCycles, setCustomCycles] = useState(false);
  const defaultOf = (key: string, fallback: string) => theme.variables.find((v) => v.key === key)?.defaultValue ?? fallback;
  const value = (key: string, fallback: string) => {
    const v = values[key];
    return v !== undefined && v !== "" ? v : defaultOf(key, fallback);
  };
  const scale = Number(value("kxScale", "0.5")) || 0.5;
  // Subscribe straps colour the accent (buttons/icons) rather than the text.
  const colorVarLabel = theme.variables.find((v) => v.key === "kxColor")?.label || "";
  const colorLabel = /accent/i.test(colorVarLabel)
    ? t("lowerThird.accentColor", "Accent colour")
    : t("lowerThird.textColor", "Text colour");
  const hasKxColor = theme.variables.some((v) => v.key === "kxColor");
  const colourVars = theme.variables.filter((v) => v.type === "color" && v.key !== "kxColor");
  const showSpeaker = isSpeakerTheme(theme);
  const cycleInfo = getCycleInfo(theme, values);
  const cycles = parseCycles(values[CYCLES_KEY] ?? DEFAULT_CYCLES);
  const cyclesSelectValue = customCycles || (cycles !== 0 && !CYCLE_PRESETS.includes(String(cycles))) ? "custom" : String(cycles);
  const speed = value("kxSpeed", "1");
  const speedOptions = SPEED_OPTIONS.includes(speed) ? SPEED_OPTIONS : [...SPEED_OPTIONS, speed].sort((a, b) => Number(a) - Number(b));

  return (
    <div
      role="region"
      aria-label={t("lowerThird.motionSettings", "Motion settings")}
      style={{
        marginTop: 6,
        padding: 8,
        border: "1px solid var(--dock-border)",
        borderRadius: 4,
        background: "var(--dock-surface)",
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
        alignItems: "end",
      }}
    >
      {showSpeaker && speakers.length > 0 && (
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle} htmlFor="dock-motion-speaker">{t("lowerThird.speaker", "Speaker")}</label>
        {speakers.length > 0 ? (
          <select
            id="dock-motion-speaker"
            value={selectedSpeakerIdx ?? ""}
            onChange={(e) => {
              const idx = Number(e.target.value);
              onSelectSpeaker(e.target.value === "" || Number.isNaN(idx) ? null : idx);
            }}
            style={inputStyle}
          >
            <option value="">—</option>
            {speakers.map((sp, i) => (
              <option key={`${sp.name}-${i}`} value={i}>
                {sp.name}{sp.isMain ? " ★" : ""}{sp.role ? ` — ${sp.role}` : ""}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      )}
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle} htmlFor="dock-motion-size">
          {t("lowerThird.motionSize", "Size")} <span style={{ color: "var(--dock-text)" }}>{Math.round(scale * 100)}%</span>
        </label>
        <input
          id="dock-motion-size"
          type="range"
          min={0.2}
          max={1.6}
          step={0.05}
          value={scale}
          onChange={(e) => onValueChange("kxScale", e.target.value)}
          style={{ width: "100%", accentColor: "var(--dock-accent, var(--primary))" }}
        />
      </div>
      {cycleInfo ? (
        <>
          <div>
            <label style={labelStyle} htmlFor="dock-motion-cycles" title={t("lowerThird.cyclesHint", "How many times the whole set plays before it animates out by itself. Keep looping stays on until you press Animate out.")}>
              {t("lowerThird.cycles", "Cycles")}
            </label>
            <select
              id="dock-motion-cycles"
              value={cyclesSelectValue}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "custom") {
                  // Keep the number input open while typing, even when the value matches a preset.
                  setCustomCycles(true);
                  if (cycles === 0) onValueChange(CYCLES_KEY, DEFAULT_CYCLES);
                  return;
                }
                setCustomCycles(false);
                onValueChange(CYCLES_KEY, next);
              }}
              style={{ ...inputStyle, height: 24 }}
            >
              <option value="0">{t("lowerThird.cyclesLoop", "Keep looping")}</option>
              {CYCLE_PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="custom">{t("lowerThird.cyclesCustom", "Custom…")}</option>
            </select>
            {cyclesSelectValue === "custom" && (
              <input
                aria-label={t("lowerThird.cyclesCustomValue", "Number of cycles")}
                type="number"
                min={1}
                max={99}
                step={1}
                value={String(cycles)}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  onValueChange(CYCLES_KEY, Number.isFinite(n) && n >= 1 ? String(Math.min(n, 99)) : "1");
                }}
                style={{ ...inputStyle, height: 24, marginTop: 4 }}
              />
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="dock-motion-per">
              {t("lowerThird.secondsPer", { defaultValue: "Seconds per {{noun}}", noun: cycleInfo.noun })}
            </label>
            <input
              id="dock-motion-per"
              type="number"
              min={2.5}
              max={60}
              step={0.5}
              value={value(PER_KEY, "4")}
              onChange={(e) => onValueChange(PER_KEY, e.target.value)}
              style={{ ...inputStyle, height: 24 }}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="dock-motion-speed">{t("lowerThird.motionSpeed", "Speed")}</label>
            <select id="dock-motion-speed" value={speed} onChange={(e) => onValueChange("kxSpeed", e.target.value)} style={{ ...inputStyle, height: 24 }}>
              {speedOptions.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 9, color: "var(--dock-text)", opacity: 0.85, marginTop: -4 }}>
            {cycles === 0
              ? t("lowerThird.cyclesLoopHint", "Keeps looping until Animate out")
              : t("lowerThird.cyclesSummary", {
                  defaultValue: "{{items}} {{noun}} × {{per}}s = {{cycle}} a cycle · about {{total}} in total",
                  items: cycleInfo.items,
                  noun: cycleInfo.items === 1 ? cycleInfo.noun : `${cycleInfo.noun}s`,
                  per: cycleInfo.secondsPerItem,
                  cycle: formatSeconds(cycleInfo.cycleSeconds),
                  total: formatSeconds(cycleInfo.cycleSeconds * cycles),
                })}
          </div>
        </>
      ) : (
        <>
          <div>
            <label style={labelStyle} htmlFor="dock-motion-hold" title={t("lowerThird.durationHint", "How many seconds the lower third stays on screen before it animates out by itself. 0 keeps it on until you press Animate out.")}>
              {t("lowerThird.durationSeconds", "Duration on screen (sec)")}
            </label>
            <input
              id="dock-motion-hold"
              type="number"
              min={0}
              max={600}
              step={1}
              value={value("kxAutoOut", "5")}
              onChange={(e) => onValueChange("kxAutoOut", e.target.value)}
              style={{ ...inputStyle, height: 24 }}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="dock-motion-speed">{t("lowerThird.motionSpeed", "Speed")}</label>
            <select id="dock-motion-speed" value={speed} onChange={(e) => onValueChange("kxSpeed", e.target.value)} style={{ ...inputStyle, height: 24 }}>
              {speedOptions.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 9, color: "var(--dock-text)", opacity: 0.85, marginTop: -4 }}>
            {t("lowerThird.durationZero", "Duration 0 = stays on until Animate out")}
          </div>
        </>
      )}
      <div>
        <label style={labelStyle} htmlFor="dock-motion-position">{t("lowerThird.position", "Position")}</label>
        <select
          id="dock-motion-position"
          value={position}
          onChange={(e) => onPositionChange(e.target.value as LTPosition)}
          style={inputStyle}
        >
          {LT_POSITIONS.map((p) => (
            <option key={p} value={p}>{t(`lowerThird.positions.${p}`, LT_POSITION_LABELS[p])}</option>
          ))}
        </select>
      </div>
      {hasKxColor && (
      <div>
        <label style={labelStyle} htmlFor="dock-motion-color">{colorLabel}</label>
        <input
          id="dock-motion-color"
          type="color"
          value={hexOr(value("kxColor", "#ffffff"), "#ffffff")}
          onChange={(e) => onValueChange("kxColor", e.target.value)}
          style={{ ...inputStyle, height: 24, padding: 1, cursor: "pointer" }}
        />
      </div>
      )}
      {colourVars.map((v) => {
        const fallback = hexOr(v.defaultValue, "#ffffff");
        return (
          <div key={v.key}>
            <label style={labelStyle} htmlFor={`dock-motion-colour-${v.key}`}>{v.label || v.key}</label>
            <input
              id={`dock-motion-colour-${v.key}`}
              type="color"
              value={hexOr(value(v.key, fallback), fallback)}
              onChange={(e) => onValueChange(v.key, e.target.value)}
              style={{ ...inputStyle, height: 24, padding: 1, cursor: "pointer" }}
            />
          </div>
        );
      })}
    </div>
  );
}
