/**
 * textStyle.ts — per-text "soft" styling for lower thirds and broadcast graphics.
 *
 * Each text field `key` can have a companion value `${key}__style`, e.g.
 * "case=upper;size=120;weight=bold;italic=1;spacing=wide". It travels with the other
 * values (saved graphics, Dock slots, OBS payloads) and is applied when the template
 * is filled in:
 *  - Letter case works for every graphic (the text itself is changed).
 *  - Size, weight, italic and spacing wrap the text in a styled span. That works for
 *    HTML templates and graphic packages; Motion straps (kinetic) only take the case.
 *
 * Keep the copies in public/lower-third-overlay.html and
 * public/kinetic/mce-graphic-packages.js in step with this file.
 */

export type TextCase = "none" | "upper" | "title" | "sentence" | "lower";
export type TextWeight = "default" | "light" | "normal" | "semibold" | "bold" | "black";
export type TextSpacing = "default" | "tight" | "wide" | "wider";

export interface TextStyle {
  case: TextCase;
  /** Percent of the design size, 60–180. */
  size: number;
  weight: TextWeight;
  italic: boolean;
  spacing: TextSpacing;
}

export const TEXT_STYLE_SUFFIX = "__style";

export const DEFAULT_TEXT_STYLE: TextStyle = { case: "none", size: 100, weight: "default", italic: false, spacing: "default" };

export const TEXT_CASE_OPTIONS: { value: TextCase; label: string; hint: string }[] = [
  { value: "none", label: "Aa", hint: "As typed" },
  { value: "upper", label: "AA", hint: "ALL CAPS" },
  { value: "title", label: "Ab", hint: "Title Case (Each Word)" },
  { value: "sentence", label: "A.", hint: "Sentence case" },
  { value: "lower", label: "aa", hint: "lowercase" },
];

/** Case buttons that rewrite typed text in place (ticker message box). */
export const TEXT_CASE_CONVERSIONS = (["upper", "lower", "title", "sentence"] as const).map(
  (value) => TEXT_CASE_OPTIONS.find((o) => o.value === value)!,
);

export const TEXT_WEIGHT_OPTIONS: { value: TextWeight; label: string; css: string }[] = [
  { value: "default", label: "Weight: design", css: "" },
  { value: "light", label: "Light", css: "300" },
  { value: "normal", label: "Regular", css: "400" },
  { value: "semibold", label: "Semibold", css: "600" },
  { value: "bold", label: "Bold", css: "700" },
  { value: "black", label: "Extra bold", css: "900" },
];

export const TEXT_SPACING_OPTIONS: { value: TextSpacing; label: string; css: string }[] = [
  { value: "default", label: "Spacing: design", css: "" },
  { value: "tight", label: "Tight", css: "-0.02em" },
  { value: "wide", label: "Wide", css: "0.06em" },
  { value: "wider", label: "Extra wide", css: "0.16em" },
];

export const TEXT_SIZE_MIN = 60;
export const TEXT_SIZE_MAX = 180;
export const TEXT_SIZE_STEP = 10;

export function textStyleKey(key: string): string {
  return `${key}${TEXT_STYLE_SUFFIX}`;
}

export function isTextStyleKey(key: string): boolean {
  return key.endsWith(TEXT_STYLE_SUFFIX);
}

export function parseTextStyle(raw: unknown): TextStyle {
  const style: TextStyle = { ...DEFAULT_TEXT_STYLE };
  const text = typeof raw === "string" ? raw : "";
  if (!text || text.startsWith("{{")) return style;
  for (const part of text.split(";")) {
    const [k, v = ""] = part.split("=").map((s) => s.trim());
    if (k === "case" && TEXT_CASE_OPTIONS.some((o) => o.value === v)) style.case = v as TextCase;
    else if (k === "size") {
      const n = Number(v);
      if (Number.isFinite(n)) style.size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)));
    } else if (k === "weight" && TEXT_WEIGHT_OPTIONS.some((o) => o.value === v)) style.weight = v as TextWeight;
    else if (k === "italic") style.italic = v === "1" || v === "true";
    else if (k === "spacing" && TEXT_SPACING_OPTIONS.some((o) => o.value === v)) style.spacing = v as TextSpacing;
  }
  return style;
}

/** Compact string form; "" when everything is at its default. */
export function serializeTextStyle(style: TextStyle): string {
  const parts: string[] = [];
  if (style.case !== "none") parts.push(`case=${style.case}`);
  if (style.size !== 100) parts.push(`size=${style.size}`);
  if (style.weight !== "default") parts.push(`weight=${style.weight}`);
  if (style.italic) parts.push("italic=1");
  if (style.spacing !== "default") parts.push(`spacing=${style.spacing}`);
  return parts.join(";");
}

export function isDefaultTextStyle(style: TextStyle): boolean {
  return serializeTextStyle(style) === "";
}

export function applyTextCase(text: string, textCase: TextCase): string {
  const value = String(text ?? "");
  switch (textCase) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      // A quote only opens a word after a space or bracket, so "don't" stays "Don't".
      return value.toLowerCase().replace(/(?<=^|[\s\-/(|]|(?:^|[\s(])["'“‘])\p{L}/gu, (ch) => ch.toUpperCase());
    case "sentence":
      return value.toLowerCase().replace(/(^\s*|[.!?|]\s+)(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    default:
      return value;
  }
}

/** Inline CSS for the size / weight / italic / spacing parts ("" when none apply). */
export function textStyleCss(style: TextStyle): string {
  const css: string[] = [];
  // A chosen case wins over a design that forces capitals with text-transform.
  if (style.case !== "none") css.push("text-transform:none!important");
  if (style.size !== 100) css.push(`font-size:${style.size}%!important`);
  const weight = TEXT_WEIGHT_OPTIONS.find((o) => o.value === style.weight)?.css;
  if (weight) css.push(`font-weight:${weight}!important`);
  if (style.italic) css.push("font-style:italic!important");
  const spacing = TEXT_SPACING_OPTIONS.find((o) => o.value === style.spacing)?.css;
  if (spacing) css.push(`letter-spacing:${spacing}!important`);
  return css.join(";");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The same `*word*` / `*[#hex]word*` highlight markup the Scripture overlays use (see
 * mce-multiview-scripture-circle.html's `safeEmText`): bold, or bold in a chosen hex colour.
 * Must run on text that is already HTML-escaped, so a quote can never inject markup.
 * Keep in step with the copy in public/lower-third-overlay.html's `substituteVariables`.
 */
export function applyHighlightMarkup(escapedText: string): string {
  return escapedText.replace(
    /\*(?=\S)(?:\[(#[0-9a-fA-F]{3,8})\])?([^*\n]*?\S)\*/g,
    (_m, color: string | undefined, words: string) =>
      color
        ? `<strong class="lt-em" style="color:${color}">${words}</strong>`
        : `<strong class="lt-em">${words}</strong>`,
  );
}

/** Field keys whose value may carry the `*word*` highlight markup above. */
const HIGHLIGHT_MARKUP_KEYS = new Set(["quote"]);

/** True when the placeholder at `index` sits inside a tag (an attribute value), not in text. */
function isInsideTag(html: string, index: number): boolean {
  return html.lastIndexOf("<", index) > html.lastIndexOf(">", index);
}

/**
 * Fill {{key}} placeholders, applying each field's text style. Placeholders without a
 * value are left as they are.
 */
export function substituteStyledVariables(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match: string, key: string, offset: number) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    const raw = String(values[key] ?? "");
    if (isTextStyleKey(key)) return escapeHtml(raw);
    const style = parseTextStyle(values[textStyleKey(key)]);
    const insideTag = isInsideTag(html, offset);
    let escaped = escapeHtml(applyTextCase(raw, style.case));
    // Only ever inserts real <strong> markup into text content, never into an attribute value
    // (e.g. a kx-root's data-v-quote="{{quote}}") — that would break the attribute's quoting.
    if (!insideTag && HIGHLIGHT_MARKUP_KEYS.has(key)) escaped = applyHighlightMarkup(escaped);
    const css = textStyleCss(style);
    if (!css || insideTag) return escaped;
    return `<span class="lt-ts" style="${css}">${escaped}</span>`;
  });
}

/**
 * What a graphic can do with text styles: packages and HTML templates take everything;
 * Motion straps (kinetic, without a package) only take the letter case.
 */
export function textStyleCapabilityFor(theme: { html?: string } | null | undefined): "full" | "case" {
  const html = String(theme?.html || "");
  if (html.includes("data-kx-pkg")) return "full";
  if (html.includes("kx-root")) return "case";
  return "full";
}
