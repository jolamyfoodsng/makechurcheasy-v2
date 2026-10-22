/**
 * verseHighlight.ts — colour words in a Bible verse (Dock: select words in a verse, right-click, pick a colour).
 *
 * A highlight is the exact words and a colour. When the verse goes to the screen the words are wrapped
 * in the "important words" markup the screen already understands, with the colour:
 *     The *[#facc15]Lord* is my shepherd        (colour picked)
 *     The *Lord* is my shepherd                 ("Theme colour": the theme's own highlight colour)
 * The Dock list shows the same colours, using segmentHighlights().
 */

export interface HighlightColor {
  id: string;
  label: string;
  /** null = the theme's own highlight colour (plain `*words*`). */
  hex: string | null;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { id: "theme", label: "Theme colour", hex: null },
  { id: "yellow", label: "Yellow", hex: "#facc15" },
  { id: "green", label: "Green", hex: "#4ade80" },
  { id: "blue", label: "Sky blue", hex: "#38bdf8" },
  { id: "pink", label: "Pink", hex: "#f472b6" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
  { id: "red", label: "Red", hex: "#f87171" },
];

export interface VerseHighlight {
  /** The exact words, as they are written in the verse. */
  t: string;
  /** A colour id from HIGHLIGHT_COLORS. */
  c: string;
}

export const MAX_HIGHLIGHT_LENGTH = 120;

export function highlightColorHex(colorId: string): string | null {
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId)?.hex ?? null;
}

/** What can be highlighted: words on one line, no asterisks, not too long. */
export function cleanHighlightText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, MAX_HIGHLIGHT_LENGTH);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcher(highlights: VerseHighlight[]): RegExp | null {
  const phrases = [...new Set(highlights.map((h) => cleanHighlightText(h.t)).filter(Boolean))]
    // Longest first, so "the Lord God" wins over "the Lord".
    .sort((a, b) => b.length - a.length);
  return phrases.length ? new RegExp(phrases.map(escapeRegex).join("|"), "g") : null;
}

function colorOf(highlights: VerseHighlight[], phrase: string): string {
  // A later highlight of the same words replaces an earlier one.
  for (let i = highlights.length - 1; i >= 0; i -= 1) {
    if (cleanHighlightText(highlights[i].t) === phrase) return highlights[i].c;
  }
  return "theme";
}

export interface HighlightSegment {
  text: string;
  /** Set for highlighted words: the colour id. */
  color?: string;
}

/** The text cut into plain and highlighted pieces (the Dock list uses this). */
export function segmentHighlights(text: string, highlights: VerseHighlight[]): HighlightSegment[] {
  const re = matcher(highlights);
  if (!re || !text) return [{ text }];
  const segments: HighlightSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ text: match[0], color: colorOf(highlights, match[0]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** The text with its highlighted words wrapped in markup for the screen. */
export function applyHighlights(text: string, highlights: VerseHighlight[]): string {
  if (!text || highlights.length === 0) return text;
  return segmentHighlights(text, highlights)
    .map((segment) => {
      if (!segment.color) return segment.text;
      const hex = highlightColorHex(segment.color);
      return hex ? `*[${hex}]${segment.text}*` : `*${segment.text}*`;
    })
    .join("");
}

/** Adds (or recolours) a highlight. */
export function addHighlight(list: VerseHighlight[], text: string, colorId: string): VerseHighlight[] {
  const t = cleanHighlightText(text);
  if (!t) return list;
  return [...list.filter((h) => cleanHighlightText(h.t) !== t), { t, c: colorId }];
}
