/**
 * ThemeModal.tsx — pick the theme for what is open (Bible / Worship / Notes), in one dialog
 * instead of a strip that scrolls sideways. Each theme is a small picture of itself; click
 * to use it, or open the Themes page to edit it.
 */
import { useMemo } from "react";
import { Check, Pencil, Palette } from "../../components/icons/NativeIcons";
import type { BibleTheme } from "../../bible/types";
import { resolveOverlayAssetUrl } from "../../services/overlayUrl";
import { themeSettingsForMode, type StudioMode } from "../studioEngine";
import StudioModal from "./StudioModal";
import ThemeLayoutPreview, { SAMPLE_THEME_CONTENT } from "../../themes/layout/ThemeLayoutPreview";
import { isThemeLayout, type ThemeContent, type ThemeLayout } from "../../themes/layout/types";

/** The theme's layer layout for this look, when it is a layer theme (those have no plain background to show). */
export function layoutOf(theme: BibleTheme, mode: StudioMode): ThemeLayout | null {
  const settings = (themeSettingsForMode(theme, mode) ?? theme.settings) as unknown as { layout?: unknown } | null;
  return settings && isThemeLayout(settings.layout) ? settings.layout : null;
}

/** A small picture of a theme: its background and "Aa" in its font and colour. */
export function themeSwatch(theme: BibleTheme, mode: StudioMode): { box: React.CSSProperties; text: React.CSSProperties } {
  const s = (themeSettingsForMode(theme, mode) ?? theme.settings) as unknown as Record<string, unknown>;
  const str = (key: string) => (typeof s[key] === "string" ? (s[key] as string) : "");
  const image = theme.preview || resolveOverlayAssetUrl(str("boxBackgroundImage") || str("backgroundImage"));
  const color = str("boxBackground") || str("backgroundColor") || "#0f172a";
  const end = str("backgroundColorEnd");
  return {
    box: {
      backgroundColor: color,
      backgroundImage: image ? `url("${image}")` : end ? `linear-gradient(135deg, ${color}, ${end})` : undefined,
    },
    text: {
      color: str("fontColor") || "#fff",
      fontFamily: str("fontFamily") || undefined,
      textShadow: str("textShadow") || "0 1px 2px rgba(0,0,0,0.6)",
    },
  };
}

interface ThemeModalProps {
  themes: BibleTheme[];
  currentId: string;
  mode: StudioMode;
  /** "Bible", "Worship" or "Notes": what the theme is for. */
  forLabel: string;
  /** What the theme previews show (the verse or slide that is open); a sample verse when empty. */
  sample?: { text: string; reference: string } | null;
  onPick: (id: string) => void;
  onEdit: () => void;
  /** Make a new theme (falls back to editing the current one). */
  onCreate?: () => void;
  onClose: () => void;
}

export default function ThemeModal({ themes, currentId, mode, forLabel, sample, onPick, onEdit, onCreate, onClose }: ThemeModalProps) {
  const sampleText = sample?.text ?? "";
  const sampleRef = sample?.reference ?? "";
  const content = useMemo<ThemeContent>(
    () => (sampleText.trim() ? { text: sampleText, reference: sampleRef } : SAMPLE_THEME_CONTENT),
    [sampleText, sampleRef],
  );
  const plainSample = content.text.replace(/\[\d+\]\s*/g, "").replace(/\s+/g, " ").trim();
  return (
    <StudioModal
      title={`${forLabel} theme · ${mode === "lower-third" ? "Lower Third" : "Full Screen"}`}
      onClose={onClose}
      wide
      actions={<button type="button" className="st-chip" onClick={onEdit}><Pencil size={12} /> Edit themes</button>}
    >
      {themes.length === 0 ? (
        <div className="st-empty">No themes for this look yet. Open the Themes page to make one.</div>
      ) : (
        <div className="st-themegrid" role="listbox" aria-label="Theme">
          {themes.map((t) => {
            const look = themeSwatch(t, mode);
            const layout = layoutOf(t, mode);
            const on = t.id === currentId;
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={on}
                className={`st-themecard${on ? " is-on" : ""}`}
                onClick={() => { onPick(t.id); onClose(); }}
              >
                <span className="st-themecard__pic" style={layout ? undefined : look.box}>
                  {layout ? (
                    <span className="st-themecard__live"><ThemeLayoutPreview layout={layout} content={content} /></span>
                  ) : (
                    <span className="st-theme__sample" style={look.text}>{plainSample}</span>
                  )}
                  {on && <span className="st-themecard__check"><Check size={12} /></span>}
                </span>
                <span className="st-themecard__name">{t.name}</span>
              </button>
            );
          })}
          <button type="button" className="st-themecard st-themecard--add" onClick={onCreate ?? onEdit}>
            <span className="st-themecard__pic"><Palette size={20} /></span>
            <span className="st-themecard__name">Make a theme…</span>
          </button>
        </div>
      )}
    </StudioModal>
  );
}
