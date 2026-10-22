/**
 * emphasis.ts — "important words" in theme text.
 *
 * Wrapping words in asterisks (`The *Lord* is my shepherd`) makes them stand out. How they stand
 * out belongs to the theme, like the verse-number colour does: each text layer can set
 * `emphasisColor` (and `emphasisWeight`). A theme that sets nothing gets a colour worked out from
 * its own look (`emphasisColorFor`), so every theme has its own highlight, never one fixed yellow.
 */
import type { LayerStyle, ThemeLayer, ThemeLayout } from "./types";

export interface EmphasisPart {
  text: string;
  /** True for the words that were inside asterisks. */
  em: boolean;
  /** A colour picked for these words, from `*[#facc15]words*`. Without one the theme's highlight colour is used. */
  color?: string;
}

// A pair of asterisks around words; the asterisk must touch a word, so "2 * 3 * 4" is left alone.
// An optional colour right after the first asterisk, `*[#facc15]words*`, gives those words their own colour
// (the Dock's "Highlight words" writes this).
const EMPHASIS_RE = /\*(?=\S)(?:\[(#[0-9a-fA-F]{3,8})\])?([^*\n]*?\S)\*/g;

/** Splits text into plain and emphasised parts. Text with no asterisk pairs is one plain part. */
export function parseEmphasis(text: string): EmphasisPart[] {
  const parts: EmphasisPart[] = [];
  if (!text) return parts;
  let last = 0;
  EMPHASIS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMPHASIS_RE.exec(text))) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), em: false });
    parts.push(match[1] ? { text: match[2], em: true, color: match[1] } : { text: match[2], em: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), em: false });
  return parts;
}

/** The text without the asterisks that mark emphasis. */
export function stripEmphasis(text: string): string {
  return parseEmphasis(text).map((part) => part.text).join("");
}

// ───────────────────────────── colour helpers ─────────────────────────────

type Rgba = [number, number, number, number];

function parseColor(value: string | undefined): Rgba | null {
  const v = (value || "").trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  }
  return null;
}

function luminance([r, g, b]: Rgba): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function saturation([r, g, b]: Rgba): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

function contrast(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

const GOLD = "#f7c82d";
const BURNT_ORANGE = "#c2410c";

/** Is this colour a usable highlight on a background of this luminance? */
function usable(color: string | undefined, bgLum: number, minSaturation: number): string | null {
  const c = parseColor(color);
  if (!c || c[3] < 0.85 || saturation(c) < minSaturation) return null;
  return contrast(luminance(c), bgLum) >= 2.5 ? (color as string) : null;
}

/**
 * The colour for *important words* in a text layer.
 * 1. the layer's own `emphasisColor`, or one another text layer of the theme sets
 * 2. the verse-number colour, the reference colour or an accent bar of the theme, when it is a
 *    real colour that reads on the theme's background
 * 3. gold on dark themes, burnt orange on light ones
 */
export function emphasisColorFor(layout: ThemeLayout | null | undefined, layer: Pick<ThemeLayer, "style">): string {
  const own = layer.style.emphasisColor?.trim();
  if (own) return own;
  const layers = layout?.layers ?? [];
  for (const l of layers) {
    const set = l.type === "text" ? l.style.emphasisColor?.trim() : "";
    if (set) return set;
  }
  // The text colour tells us whether the background is light or dark.
  const textRgb = parseColor(layer.style.color) ?? ([255, 255, 255, 1] as Rgba);
  const darkText = luminance(textRgb) < 0.4;
  const bgLum = darkText ? 0.9 : 0.04;

  const verse = usable(layer.style.verseNumberColor, bgLum, 0.25);
  if (verse) return verse;
  for (const l of layers) {
    if (l.type !== "text" || l.style === layer.style) continue;
    const found = usable(l.style.color, bgLum, 0.3);
    if (found) return found;
  }
  for (const l of layers) {
    if (l.type === "text" || l.hidden) continue;
    const small = l.w * (typeof l.h === "number" ? l.h : 0) < 1920 * 1080 * 0.25;
    if (!small) continue;
    const found = usable(l.style.fill, bgLum, 0.45);
    if (found) return found;
  }
  return darkText ? BURNT_ORANGE : GOLD;
}

/** Font weight for important words: a step bolder than the text, never lighter than Bold. */
export function emphasisWeightFor(style: Pick<LayerStyle, "fontWeight" | "emphasisWeight">): number {
  if (style.emphasisWeight) return style.emphasisWeight;
  return Math.min(900, Math.max(700, (style.fontWeight ?? 400) + 200));
}
