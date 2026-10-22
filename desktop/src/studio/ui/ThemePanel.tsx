/**
 * ThemePanel.tsx — the theme in use, right under the Layers card.
 *
 *  Shows just the current theme. The button opens the theme window to pick another one, edit one
 *  or make a new one. Preview changes at once; the screen follows when you press Send to Screen
 *  (or at once in Straight to screen mode).
 */
import { useMemo } from "react";
import { ChevronDown, Palette, Pencil } from "../../components/icons/NativeIcons";
import type { BibleTheme } from "../../bible/types";
import type { StudioMode } from "../studioEngine";
import ThemeLayoutPreview, { SAMPLE_THEME_CONTENT } from "../../themes/layout/ThemeLayoutPreview";
import type { ThemeContent } from "../../themes/layout/types";
import { layoutOf, themeSwatch } from "./ThemeModal";

interface ThemePanelProps {
  themes: BibleTheme[];
  /** The theme in use now. */
  currentId: string;
  mode: StudioMode;
  /** "Bible", "Worship" or "Notes": what the theme is for. */
  forLabel: string;
  /** What the preview shows (the verse or slide that is open); a sample verse when empty. */
  sample?: { text: string; reference: string } | null;
  /** Open the theme window: pick another theme, edit or make one. */
  onMore: () => void;
  /** Edit a theme in a window inside the Studio (null = make a new one). */
  onEdit: (theme: BibleTheme | null) => void;
}

function ThemePic({ theme, mode, content, plain }: { theme: BibleTheme; mode: StudioMode; content: ThemeContent; plain: string }) {
  const look = themeSwatch(theme, mode);
  const layout = layoutOf(theme, mode);
  return (
    <span className="st-tp__pic" style={layout ? undefined : look.box}>
      {layout ? (
        <span className="st-themecard__live"><ThemeLayoutPreview layout={layout} content={content} /></span>
      ) : (
        <span className="st-theme__sample" style={look.text}>{plain}</span>
      )}
    </span>
  );
}

export default function ThemePanel({ themes, currentId, mode, forLabel, sample, onMore, onEdit }: ThemePanelProps) {
  const sampleText = sample?.text ?? "";
  const sampleRef = sample?.reference ?? "";
  const content = useMemo<ThemeContent>(
    () => (sampleText.trim() ? { text: sampleText, reference: sampleRef } : SAMPLE_THEME_CONTENT),
    [sampleText, sampleRef],
  );
  const plain = content.text.replace(/\[\d+\]\s*/g, "").replace(/\s+/g, " ").trim();
  const lookName = mode === "lower-third" ? "Lower Third" : "Full Screen";
  const current = themes.find((t) => t.id === currentId) ?? null;

  return (
    <section className="st-lo__mini st-tp st-tp--card" aria-label="Theme">
      <div className="st-lo__minihead">
        <strong><Palette size={15} /> Theme</strong>
      </div>
      <div className="st-tp__big">
        <button type="button" className="st-tp__bigpic" onClick={onMore} aria-haspopup="dialog" title="Choose another theme, or make a new one">
          {current ? (
            <ThemePic theme={current} mode={mode} content={content} plain={plain} />
          ) : (
            <span className="st-tp__pic"><Palette size={22} /></span>
          )}
        </button>
        <button type="button" className="st-tp__pen" onClick={() => onEdit(current)} disabled={!current} title="Edit this theme" aria-label="Edit this theme">
          <Pencil size={14} />
        </button>
      </div>
      <button type="button" className="st-tp__pick" onClick={onMore} aria-haspopup="dialog" title="Choose another theme, edit one or make a new one">
        <span className="st-tp__pickname">{current ? current.name : "Choose a theme"}</span>
        <span className="st-tp__pickfor">{forLabel} · {lookName}</span>
        <ChevronDown size={14} />
      </button>
    </section>
  );
}
