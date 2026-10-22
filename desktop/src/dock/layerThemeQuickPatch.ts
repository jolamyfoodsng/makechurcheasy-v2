/**
 * layerThemeQuickPatch.ts — the Dock's quick text controls (LG / XL / 2XL, + / −, Bold, Italic)
 * for a ready-made layer theme.
 *
 * A layer theme draws its own text, so the plain font settings those buttons change
 * (fontSize, fontWeight, fontStyle) do nothing to it. For such a theme the same click is also
 * written as the theme adjustments the overlay does read: text size as a percent of the design,
 * and Bold / Italic for the verse, lyric or note text. Plain themes pass through unchanged.
 */
import { layoutVerseStyle, LAYOUT_SCALE_MAX, LAYOUT_SCALE_MIN, readLayoutAdjust } from "../themes/layout/adjust";
import type { ThemeLayout } from "../themes/layout/types";
import { DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN, DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD } from "./dockQuickSizePresets";

type Mode = "fullscreen" | "lower-third";

const BOLD_WEIGHTS = new Set(["bold", "extrabold", "black"]);

const clampScale = (value: number) => Math.min(LAYOUT_SCALE_MAX, Math.max(LAYOUT_SCALE_MIN, Math.round(value)));

interface QuickPatchFields {
  fontSize?: number;
  refFontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  lowerThirdSize?: string;
  layoutTextScale?: number;
  layoutRefScale?: number;
  layoutBold?: boolean;
  layoutItalic?: boolean;
}

export interface LayerQuickContext {
  /** The layer theme's layout; none = a plain theme (the patch is returned as it is). */
  layout: ThemeLayout | null | undefined;
  mode: Mode;
  /** Where the current text size percent is read from (the theme / quick settings). */
  adjustSource: unknown;
  /** The font size the quick panel is showing now, so a + / − step can be turned into a percent. */
  previousFontSize?: number;
}

/** The patch with the layer theme's own fields added next to the plain font ones. */
export function withLayerThemeQuickPatch<T extends QuickPatchFields>(patch: T, ctx: LayerQuickContext): T & QuickPatchFields {
  if (!ctx.layout) return patch;
  const out: T & QuickPatchFields = { ...patch };

  if (typeof patch.fontWeight === "string") out.layoutBold = BOLD_WEIGHTS.has(patch.fontWeight);
  if (typeof patch.fontStyle === "string") out.layoutItalic = patch.fontStyle === "italic";

  if (typeof patch.fontSize === "number") {
    const presets = ctx.mode === "fullscreen" ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;
    const design = presets[0];
    const isPreset = typeof patch.lowerThirdSize === "string" && typeof patch.refFontSize === "number";
    if (isPreset && design) {
      // LG is the size the theme was designed at; XL and 2XL grow by the same steps as plain themes.
      out.layoutTextScale = clampScale((patch.fontSize / design.fontSize) * 100);
      out.layoutRefScale = clampScale(((patch.refFontSize as number) / design.refFontSize) * 100);
    } else if (ctx.previousFontSize && ctx.previousFontSize > 0) {
      const now = readLayoutAdjust(ctx.adjustSource);
      const ratio = patch.fontSize / ctx.previousFontSize;
      out.layoutTextScale = clampScale(now.layoutTextScale * ratio);
      out.layoutRefScale = clampScale(now.layoutRefScale * ratio);
    }
  }
  return out;
}

/** What the Bold / Italic buttons show for a layer theme: the operator's choice, else how the theme is designed. */
export function layerThemeQuickDisplay<T extends { fontWeight?: string; fontStyle?: string }>(
  settings: T,
  layout: ThemeLayout | null | undefined,
  adjustSource: unknown,
): T {
  if (!layout) return settings;
  const designed = layoutVerseStyle(layout);
  const chosen = (adjustSource && typeof adjustSource === "object" ? adjustSource : {}) as { layoutBold?: unknown; layoutItalic?: unknown };
  const bold = typeof chosen.layoutBold === "boolean" ? chosen.layoutBold : designed.bold;
  const italic = typeof chosen.layoutItalic === "boolean" ? chosen.layoutItalic : designed.italic;
  return { ...settings, fontWeight: bold ? "bold" : "normal", fontStyle: italic ? "italic" : "normal" };
}
