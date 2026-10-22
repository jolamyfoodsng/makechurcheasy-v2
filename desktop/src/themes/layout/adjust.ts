/**
 * adjust.ts — the few changes an operator can make to a ready-made layer theme
 * from the Dock without opening the Theme Editor: text size, reference size and
 * (lower thirds) how high it sits. Stored as plain theme-settings fields so they
 * travel with the theme packet; applied by the overlay just before drawing.
 */
import { hasTokens, isVerseTextPattern } from "./content";
import { DESIGN_HEIGHT, DESIGN_WIDTH, type LayerAnimation, type ThemeLayer, type ThemeLayout } from "./types";

export interface LayoutAdjustSettings {
  /** Verse / lyric / note text size, percent of the theme's own (100 = as designed). */
  layoutTextScale?: number;
  /** Reference / label size, percent. */
  layoutRefScale?: number;
  /** Verse / lyric / note line spacing, percent of the theme's own (100 = as designed). */
  layoutLineHeight?: number;
  /** Show or hide the theme's title (reference / label line). Missing = as the theme is set. */
  layoutShowTitle?: boolean;
  /** Verse / lyric / note text: bold on or off. Missing = as the theme is designed. */
  layoutBold?: boolean;
  /** Verse / lyric / note text: italic on or off. Missing = as the theme is designed. */
  layoutItalic?: boolean;
  /** Lower thirds: move the whole graphic up (negative) or down, in 1080p pixels. */
  layoutOffsetY?: number;
  /** Full screen: darken the background, percent (0 = as designed). */
  layoutBackdropDarkness?: number;
}

/** Weight used when the operator turns Bold on / off for a theme's verse text. */
export const LAYOUT_BOLD_WEIGHT = 700;
export const LAYOUT_REGULAR_WEIGHT = 400;

export const LAYOUT_SCALE_MIN = 50;
export const LAYOUT_SCALE_MAX = 200;
export const LAYOUT_LINE_MIN = 70;
export const LAYOUT_LINE_MAX = 160;
export const LAYOUT_OFFSET_MIN = -400;
export const LAYOUT_OFFSET_MAX = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Reads the adjust fields from theme settings / quick settings (missing = as designed). */
export function readLayoutAdjust(source: unknown): Required<Omit<LayoutAdjustSettings, "layoutBackdropDarkness" | "layoutShowTitle" | "layoutBold" | "layoutItalic">> {
  const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  return {
    layoutTextScale: clamp(num(s.layoutTextScale) ?? 100, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
    layoutRefScale: clamp(num(s.layoutRefScale) ?? 100, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
    layoutLineHeight: clamp(num(s.layoutLineHeight) ?? 100, LAYOUT_LINE_MIN, LAYOUT_LINE_MAX),
    layoutOffsetY: clamp(num(s.layoutOffsetY) ?? 0, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX),
  };
}

/** The Dock's Show title switch: true / false when the operator set it, undefined = leave the theme's own setting. */
export function readLayoutShowTitle(source: unknown): boolean | undefined {
  const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  return typeof s.layoutShowTitle === "boolean" ? s.layoutShowTitle : undefined;
}

/** The Dock's Bold / Italic buttons: true / false when the operator chose, undefined = as the theme is designed. */
export function readLayoutTextStyle(source: unknown): { bold?: boolean; italic?: boolean } {
  const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  return {
    ...(typeof s.layoutBold === "boolean" ? { bold: s.layoutBold } : {}),
    ...(typeof s.layoutItalic === "boolean" ? { italic: s.layoutItalic } : {}),
  };
}

/** How the theme's own verse text is styled (what the Bold / Italic buttons show before anything is chosen). */
export function layoutVerseStyle(layout: ThemeLayout | undefined | null): { bold: boolean; italic: boolean } {
  const verse = layout?.layers.find((layer) => layer.type === "text" && hasTokens(layer.content) && isVerseTextPattern(layer.content));
  return {
    bold: (verse?.style.fontWeight ?? LAYOUT_REGULAR_WEIGHT) >= 600,
    italic: verse?.style.italic === true,
  };
}

/** Only the adjust fields that are set, for merging quick settings into a live theme. */
export function pickLayoutAdjust(source: unknown): LayoutAdjustSettings {
  const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  const out: LayoutAdjustSettings = {};
  if (num(s.layoutTextScale) !== undefined) out.layoutTextScale = num(s.layoutTextScale);
  if (num(s.layoutRefScale) !== undefined) out.layoutRefScale = num(s.layoutRefScale);
  if (num(s.layoutLineHeight) !== undefined) out.layoutLineHeight = num(s.layoutLineHeight);
  if (typeof s.layoutShowTitle === "boolean") out.layoutShowTitle = s.layoutShowTitle;
  if (typeof s.layoutBold === "boolean") out.layoutBold = s.layoutBold;
  if (typeof s.layoutItalic === "boolean") out.layoutItalic = s.layoutItalic;
  if (num(s.layoutOffsetY) !== undefined) out.layoutOffsetY = num(s.layoutOffsetY);
  if (num(s.layoutBackdropDarkness) !== undefined) out.layoutBackdropDarkness = num(s.layoutBackdropDarkness);
  return out;
}

export function isLayoutAdjustDefault(adjust: LayoutAdjustSettings): boolean {
  const a = readLayoutAdjust(adjust);
  return a.layoutTextScale === 100
    && a.layoutRefScale === 100
    && a.layoutLineHeight === 100
    && a.layoutOffsetY === 0
    && readLayoutShowTitle(adjust) === undefined
    && readLayoutTextStyle(adjust).bold === undefined
    && readLayoutTextStyle(adjust).italic === undefined;
}

// ───────────────────────────── background ─────────────────────────────

export type LayoutBackdropKind = "theme" | "off" | "color" | "image" | "video";

export interface LayoutBackdrop {
  kind: LayoutBackdropKind;
  color: string;
  colorEnd: string;
  angle: number;
  image: string;
  video: string;
  /** 0–1 */
  darkness: number;
}

const FADE: LayerAnimation = { preset: "fade", duration: 350, delay: 0, easing: "linear" };

/**
 * A media URL the OBS browser source can load. The Dock stores Media Library files
 * as /uploads/<file>; file paths are reduced to that, anything else is left as is.
 * Values the overlay replaces with a CSS marker (large data URIs) are not usable here.
 */
export function resolveBackdropMediaUrl(value: unknown): string {
  let v = typeof value === "string" ? value.trim() : "";
  if (!v || v.startsWith("__FROM_")) return "";
  if (/^(?:blob:|https?:\/\/)/i.test(v)) return v;
  if (/^data:(?:image|video)\//i.test(v)) return v;
  if (v.startsWith("/uploads/")) return v;
  if (v.startsWith("uploads/")) return `/${v}`;
  if (/^file:\/\//i.test(v)) {
    try { v = decodeURIComponent(v.replace(/^file:\/\//i, "")); } catch { v = v.replace(/^file:\/\//i, ""); }
  }
  if (v.startsWith("/") && !/^\/(?:Users|home|Volumes|var|private|tmp)\//.test(v)) return v;
  const name = v.split(/[\\/]/).pop()?.trim() || "";
  return name ? `/uploads/${encodeURIComponent(name)}` : "";
}

/**
 * The background the operator picked in the Dock (Background tab), read from the same
 * quick-setting fields the classic themes use, plus the darkness slider.
 * "theme" means: keep the theme's own background.
 */
export function readLayoutBackdrop(source: unknown): LayoutBackdrop {
  const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string).trim() : "");
  const type = str("backgroundType").toLowerCase();
  // The first usable one: a large picture is sent as a "__FROM_CSS__" marker, and then its file path is the one to use.
  const image = resolveBackdropMediaUrl(str("backgroundImage")) || resolveBackdropMediaUrl(str("backgroundImageFilePath"));
  const video = resolveBackdropMediaUrl(str("backgroundVideo")) || resolveBackdropMediaUrl(str("backgroundVideoFilePath"));
  const color = str("backgroundColor");
  let kind: LayoutBackdropKind = "theme";
  if (type === "off") kind = "off";
  else if (type === "color" && color) kind = "color";
  else if (type === "image" && image) kind = "image";
  else if (type === "video" && video) kind = "video";
  return {
    kind,
    color,
    colorEnd: str("backgroundColorEnd"),
    angle: num(s.bgGradientAngle) ?? 135,
    image,
    video,
    darkness: clamp(num(s.layoutBackdropDarkness) ?? 0, 0, 100) / 100,
  };
}

export function isLayoutBackdropDefault(b: LayoutBackdrop): boolean {
  return b.kind === "theme" && b.darkness === 0;
}

/** A layer that fills (nearly) the whole canvas and holds no text: the theme's own background. */
function isBackgroundLayer(layer: ThemeLayer): boolean {
  return !layer.hidden
    && !layer.parentId
    && (layer.type === "box" || layer.type === "image")
    && layer.w >= DESIGN_WIDTH * 0.9
    && typeof layer.h === "number"
    && layer.h >= DESIGN_HEIGHT * 0.9;
}

function fullCanvasLayer(id: string, name: string, style: ThemeLayer["style"], type: ThemeLayer["type"] = "box", opacity?: number): ThemeLayer {
  return {
    id,
    name,
    type,
    anchor: "top-left",
    x: 0,
    y: 0,
    w: DESIGN_WIDTH,
    h: DESIGN_HEIGHT,
    ...(opacity !== undefined ? { opacity } : {}),
    style,
    in: FADE,
    out: FADE,
  };
}

/** Full-screen layouts only: swap the theme's background for the Dock's pick and/or darken it. */
function applyBackdrop(layers: ThemeLayer[], b: LayoutBackdrop): ThemeLayer[] {
  if (isLayoutBackdropDefault(b)) return layers;
  const replace = b.kind !== "theme";
  const next = replace ? layers.map((l) => (isBackgroundLayer(l) ? { ...l, hidden: true } : l)) : layers.slice();

  const added: ThemeLayer[] = [];
  if (b.kind === "color") {
    const gradient = b.colorEnd
      ? { type: "linear" as const, angle: b.angle, stops: [{ color: b.color, at: 0 }, { color: b.colorEnd, at: 100 }] }
      : undefined;
    added.push(fullCanvasLayer("mce-backdrop", "Dock background", gradient ? { gradient } : { fill: b.color }));
  } else if (b.kind === "image") {
    added.push(fullCanvasLayer("mce-backdrop", "Dock background", { src: b.image, fit: "cover" }, "image"));
  } else if (b.kind === "video") {
    added.push(fullCanvasLayer("mce-backdrop", "Dock background", { videoSrc: b.video, fit: "cover" }, "image"));
  }
  if (b.darkness > 0 && b.kind !== "off") {
    added.push(fullCanvasLayer("mce-backdrop-dim", "Dock background darkness", { fill: "#000000" }, "box", b.darkness));
  }
  if (added.length === 0) return next;

  // Replaced backgrounds go at the very bottom. With the theme's own background kept,
  // the dimmer sits right above it so the text stays bright.
  let at = 0;
  if (!replace) {
    for (let i = 0; i < layers.length; i++) if (isBackgroundLayer(layers[i])) at = i + 1;
  }
  next.splice(at, 0, ...added);
  return next;
}

/**
 * Lower thirds, a picked colour / picture / video: the theme's card or bar is the background, so the
 * pick fills that card (the top-level box that holds the words, else the biggest one). The words,
 * lines and labels stay as the theme drew them.
 */
function applyLowerThirdBackdrop(layers: ThemeLayer[], b: LayoutBackdrop): ThemeLayer[] {
  if (b.kind !== "color" && b.kind !== "image" && b.kind !== "video") return layers;
  const parents = new Set(layers.map((l) => l.parentId).filter(Boolean) as string[]);
  const cards = layers.filter((l) => !l.hidden && !l.parentId && l.type === "box");
  const holders = cards.filter((l) => parents.has(l.id));
  const area = (l: ThemeLayer) => l.w * (typeof l.h === "number" ? l.h : 0);
  const targets = holders.length ? holders : cards.length ? [cards.reduce((a, c) => (area(c) > area(a) ? c : a))] : [];
  if (targets.length === 0) return layers;
  const ids = new Set(targets.map((l) => l.id));
  return layers.map((l) => {
    if (!ids.has(l.id)) return l;
    const style: ThemeLayer["style"] = { ...l.style, gradient: undefined, src: undefined, videoSrc: undefined };
    if (b.kind === "color") {
      if (b.colorEnd) style.gradient = { type: "linear" as const, angle: b.angle, stops: [{ color: b.color, at: 0 }, { color: b.colorEnd, at: 100 }] };
      else style.fill = b.color;
    } else if (b.kind === "image") {
      style.src = b.image;
      style.fit = "cover";
      if (b.darkness > 0) style.dim = Math.round(b.darkness * 100);
    } else {
      style.videoSrc = b.video;
      style.fit = "cover";
      if (b.darkness > 0) style.dim = Math.round(b.darkness * 100);
    }
    return { ...l, style };
  });
}

/** Lower thirds, Background: Off. Hide card / bar boxes and images; boxes that hold other layers just lose their fill. */
function stripLowerThirdBackground(layers: ThemeLayer[]): ThemeLayer[] {
  const parents = new Set(layers.map((l) => l.parentId).filter(Boolean) as string[]);
  return layers.map((l) => {
    if (l.hidden || l.parentId || (l.type !== "box" && l.type !== "image")) return l;
    if (!parents.has(l.id)) return { ...l, hidden: true };
    return { ...l, style: { ...l.style, fill: "transparent", gradient: undefined, src: undefined, videoSrc: undefined } };
  });
}

interface Rect { top: number; bottom: number; left: number; right: number }

// Percent shift the renderer applies per anchor (mirrors ANCHOR_SHIFT in renderer.ts).
const ANCHOR_SHIFT_Y: Record<string, number> = {
  "top-left": 0, "top-center": 0, "top-right": 0,
  "middle-left": -0.5, center: -0.5, "middle-right": -0.5,
  "bottom-left": -1, "bottom-center": -1, "bottom-right": -1,
};
const ANCHOR_SHIFT_X: Record<string, number> = {
  "top-left": 0, "middle-left": 0, "bottom-left": 0,
  "top-center": -0.5, center: -0.5, "bottom-center": -0.5,
  "top-right": -1, "middle-right": -1, "bottom-right": -1,
};
const SCREEN_MARGIN = 40;
const GROW_GAP = 24;

/** A layer's box on the 1920×1080 canvas. "auto" heights are estimated from the font size. */
function absoluteRect(layer: ThemeLayer, byId: Map<string, ThemeLayer>, depth = 0): Rect {
  const s = layer.style || {};
  const [pt, , pb] = s.padding || [0, 0, 0, 0];
  const h = typeof layer.h === "number"
    ? layer.h
    : (s.fontSize || 40) * (s.lineHeight || 1.3) * (s.maxLines || 1) + pt + pb;
  const left = layer.x + (ANCHOR_SHIFT_X[layer.anchor] ?? 0) * layer.w;
  const top = layer.y + (ANCHOR_SHIFT_Y[layer.anchor] ?? 0) * h;
  const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
  const origin = parent && depth < 8 ? absoluteRect(parent, byId, depth + 1) : { top: 0, left: 0 };
  return { top: origin.top + top, bottom: origin.top + top + h, left: origin.left + left, right: origin.left + left + layer.w };
}

function isInside(inner: Rect, outer: Rect): boolean {
  return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
}

function isAncestor(layer: ThemeLayer, of: ThemeLayer, byId: Map<string, ThemeLayer>): boolean {
  let p = of.parentId ? byId.get(of.parentId) : undefined;
  for (let i = 0; p && i < 8; i++) {
    if (p.id === layer.id) return true;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return false;
}

/**
 * Bigger text (or line spacing) in a fixed-height verse box only auto-fits back
 * down to the same size. Give the box the extra height instead, taken from the
 * free space above and below it: never past the card it sits in, the screen
 * edge, or another layer (reference, translation, heading boxes, logos).
 */
function growVerseBoxes(layers: ThemeLayer[], factor: number): ThemeLayer[] {
  if (factor <= 1.001) return layers;
  const visible = layers.filter((l) => !l.hidden);
  const byId = new Map(visible.map((l) => [l.id, l]));
  return layers.map((verse) => {
    if (verse.hidden || verse.type !== "text" || typeof verse.h !== "number" || !isVerseTextPattern(verse.content)) return verse;
    if (verse.rotation) return verse;
    const v = absoluteRect(verse, byId);
    const parent = verse.parentId ? byId.get(verse.parentId) : undefined;

    // The space it may grow in: its parent, else the smallest card drawn around it, else the screen.
    let bound: Rect = { top: SCREEN_MARGIN, bottom: DESIGN_HEIGHT - SCREEN_MARGIN, left: 0, right: DESIGN_WIDTH };
    let container: Rect | null = parent ? absoluteRect(parent, byId) : null;
    const containers = new Set<string>(parent ? [parent.id] : []);
    if (!container) {
      for (const l of visible) {
        if (l.id === verse.id || (l.type !== "box" && l.type !== "image") || isBackgroundLayer(l)) continue;
        const r = absoluteRect(l, byId);
        if (!isInside(v, r)) continue;
        containers.add(l.id);
        if (!container || (r.bottom - r.top) < (container.bottom - container.top)) container = r;
      }
    }
    if (container) {
      const inset = clamp(Math.min(v.top - container.top, container.bottom - v.bottom), 0, GROW_GAP);
      bound = { ...container, top: container.top + inset, bottom: container.bottom - inset };
    }
    let top = Math.min(v.top, bound.top);
    let bottom = Math.max(v.bottom, bound.bottom);

    // Other layers beside it (horizontally overlapping) stop the growth.
    const vMid = (v.top + v.bottom) / 2;
    for (const l of visible) {
      if (l.id === verse.id || containers.has(l.id) || isBackgroundLayer(l) || isAncestor(l, verse, byId) || isAncestor(verse, l, byId)) continue;
      const r = absoluteRect(l, byId);
      if (r.right <= v.left + 1 || r.left >= v.right - 1) continue;
      if (isInside(v, r)) continue;
      const mid = (r.top + r.bottom) / 2;
      if (mid < vMid) {
        const gap = clamp(v.top - r.bottom, 0, GROW_GAP);
        top = Math.max(top, Math.min(v.top, r.bottom + gap));
      } else {
        const gap = clamp(r.top - v.bottom, 0, GROW_GAP);
        bottom = Math.min(bottom, Math.max(v.bottom, r.top - gap));
      }
    }

    const height = v.bottom - v.top;
    let extra = Math.round(height * (factor - 1));
    const roomUp = Math.max(0, v.top - top);
    const roomDown = Math.max(0, bottom - v.bottom);
    extra = Math.min(extra, roomUp + roomDown);
    if (extra < 2) return verse;
    // Grow evenly, then let whichever side still has room take the rest.
    let up = Math.min(roomUp, extra / 2);
    let down = Math.min(roomDown, extra - up);
    up = Math.min(roomUp, extra - down);
    up = Math.round(up);
    down = Math.round(down);
    const newH = height + up + down;
    const localTop = verse.y + (ANCHOR_SHIFT_Y[verse.anchor] ?? 0) * height - up;
    const y = Math.round(localTop - (ANCHOR_SHIFT_Y[verse.anchor] ?? 0) * newH);
    // A layer without a finite place loses its top/height on screen (the words end up 8px at the top).
    if (!Number.isFinite(y) || !Number.isFinite(newH)) return verse;
    return { ...verse, y, h: newH };
  });
}

/** The layout with the operator's size / position / background changes applied (same object when none). */
export function applyLayoutAdjust(layout: ThemeLayout, source: unknown): ThemeLayout {
  const a = readLayoutAdjust(source);
  const offset = layout.format === "lower-third" ? a.layoutOffsetY : 0;
  const backdrop = layout.format === "fullscreen" ? readLayoutBackdrop(source) : null;
  const backdropChanged = backdrop !== null && !isLayoutBackdropDefault(backdrop);
  // Lower thirds: the card / bar is the background. "Off" removes it; a colour, picture or video fills it.
  const ltBackdrop = layout.format === "lower-third" ? readLayoutBackdrop(source) : null;
  const ltOff = ltBackdrop?.kind === "off";
  const ltFill = ltBackdrop !== null && (ltBackdrop.kind === "color" || ltBackdrop.kind === "image" || ltBackdrop.kind === "video");
  const showTitle = readLayoutShowTitle(source);
  // Switch on = the theme's default (heading shown); switch off = hidden.
  const nextShowHeading = showTitle === undefined ? layout.showHeading : showTitle ? undefined : false;
  const titleChanged = nextShowHeading !== layout.showHeading;
  const textStyle = readLayoutTextStyle(source);
  const styleChanged = textStyle.bold !== undefined || textStyle.italic !== undefined;
  if (a.layoutTextScale === 100 && a.layoutRefScale === 100 && a.layoutLineHeight === 100 && offset === 0 && !backdropChanged && !ltOff && !ltFill && !titleChanged && !styleChanged) return layout;
  const textK = a.layoutTextScale / 100;
  const refK = a.layoutRefScale / 100;
  const lineK = a.layoutLineHeight / 100;
  const layers = layout.layers.map((layer) => {
    let next = layer;
    if (layer.type === "text" && hasTokens(layer.content)) {
      const isVerse = isVerseTextPattern(layer.content);
      const k = isVerse ? textK : refK;
      // Line spacing only matters for the verse / lyric / note body (the renderer's default is 1.3).
      const lk = isVerse ? lineK : 1;
      const styled = isVerse && styleChanged;
      if (k !== 1 || lk !== 1 || styled) {
        const style = { ...layer.style };
        if (styled) {
          if (textStyle.bold !== undefined) style.fontWeight = textStyle.bold ? Math.max(LAYOUT_BOLD_WEIGHT, style.fontWeight ?? 0) : LAYOUT_REGULAR_WEIGHT;
          if (textStyle.italic !== undefined) style.italic = textStyle.italic;
        }
        if (k !== 1) {
          if (typeof style.fontSize === "number") style.fontSize = Math.round(style.fontSize * k);
          if (typeof style.minFontSize === "number") style.minFontSize = Math.round(style.minFontSize * k);
        }
        if (lk !== 1) style.lineHeight = Math.round((style.lineHeight || 1.3) * lk * 100) / 100;
        next = { ...next, style };
      }
    }
    if (offset && !layer.parentId) next = { ...next, y: layer.y + offset };
    return next;
  });
  const stripped = ltOff ? stripLowerThirdBackground(layers) : ltFill && ltBackdrop ? applyLowerThirdBackdrop(layers, ltBackdrop) : layers;
  const grown = growVerseBoxes(stripped, textK * lineK);
  const finalLayers = backdropChanged && backdrop ? applyBackdrop(grown, backdrop) : grown;
  const out: ThemeLayout = { ...layout, layers: finalLayers };
  if (titleChanged) {
    if (nextShowHeading === undefined) delete out.showHeading;
    else out.showHeading = nextShowHeading;
  }
  return out;
}
