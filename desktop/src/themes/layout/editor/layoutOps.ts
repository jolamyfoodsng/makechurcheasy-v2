/**
 * layoutOps.ts — pure helpers the Theme Editor uses to change a ThemeLayout.
 * Every helper returns a NEW layout (the editor stores layouts in undo history).
 */
import type { LayerAnimation, LayerType, ThemeLayer, ThemeLayout } from "../types";

export const ANCHOR_FRACTION: Record<ThemeLayer["anchor"], [number, number]> = {
  "top-left": [0, 0], "top-center": [0.5, 0], "top-right": [1, 0],
  "middle-left": [0, 0.5], center: [0.5, 0.5], "middle-right": [1, 0.5],
  "bottom-left": [0, 1], "bottom-center": [0.5, 1], "bottom-right": [1, 1],
};

/** Text-layer contents people pick from (the "role" of a text box). */
export const TEXT_ROLES: Array<{ id: string; label: string; content: string }> = [
  { id: "verse", label: "Verse / lyrics / note text", content: "{text}" },
  { id: "reference", label: "Reference / song or note label", content: "{reference}" },
  { id: "book-cv", label: "Book + chapter:verse", content: "{book} {chapterVerse}" },
  { id: "book", label: "Book only", content: "{book}" },
  { id: "chapter-verse", label: "Chapter:verse only", content: "{chapterVerse}" },
  { id: "translation", label: "Translation (e.g. NKJV)", content: "{translation}" },
];

/** What a text layer can show in a countdown / timer design. */
export const COUNTDOWN_TEXT_ROLES: Array<{ id: string; label: string; content: string }> = [
  { id: "time", label: "Time (04:58)", content: "{sign}{tm}" },
  { id: "time-short", label: "Time, no leading zero (4:58)", content: "{sign}{time}" },
  { id: "time-full", label: "Time with hours (00:04:58)", content: "{sign}{tmm}" },
  { id: "days", label: "Days (02)", content: "{dd}" },
  { id: "hours", label: "Hours (03)", content: "{hh}" },
  { id: "minutes", label: "Minutes (04)", content: "{mm}" },
  { id: "seconds", label: "Seconds (05)", content: "{ss}" },
  { id: "ampm", label: "AM / PM (clock)", content: "{ampm}" },
  { id: "title", label: "Title", content: "{title}" },
  { id: "subtitle", label: "Subtitle", content: "{subtitle}" },
  { id: "name", label: "Timer name (rundowns)", content: "{name}" },
  { id: "speaker", label: "Speaker (rundowns)", content: "{speaker}" },
  { id: "message", label: "Message", content: "{message}" },
];

export function roleForContent(content: string | undefined, roles: Array<{ id: string; content: string }> = TEXT_ROLES): string {
  const c = (content || "").trim();
  return roles.find((r) => r.content === c)?.id ?? "custom";
}

const anim = (preset: LayerAnimation["preset"], duration: number, delay = 0): LayerAnimation => ({
  preset, duration, delay, easing: "out-expo",
});

function uniqueId(layout: ThemeLayout, base: string): string {
  const ids = new Set(layout.layers.map((l) => l.id));
  let i = 1;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function getLayer(layout: ThemeLayout, id: string | null): ThemeLayer | null {
  return id ? layout.layers.find((l) => l.id === id) ?? null : null;
}

export function updateLayer(layout: ThemeLayout, id: string, patch: Partial<ThemeLayer>): ThemeLayout {
  return { ...layout, layers: layout.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

export function updateLayerStyle(layout: ThemeLayout, id: string, patch: Partial<ThemeLayer["style"]>): ThemeLayout {
  return {
    ...layout,
    layers: layout.layers.map((l) => (l.id === id ? { ...l, style: { ...l.style, ...patch } } : l)),
  };
}

/** Ids of a layer and everything nested inside it. */
function withDescendants(layout: ThemeLayout, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layout.layers) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

export function removeLayer(layout: ThemeLayout, id: string): ThemeLayout {
  const gone = withDescendants(layout, id);
  return { ...layout, layers: layout.layers.filter((l) => !gone.has(l.id)) };
}

/** Moves a layer one step up (drawn later = on top) or down in the draw order. */
export function moveLayer(layout: ThemeLayout, id: string, direction: "up" | "down"): ThemeLayout {
  const layers = [...layout.layers];
  const i = layers.findIndex((l) => l.id === id);
  const j = direction === "up" ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= layers.length) return layout;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...layout, layers };
}

export function duplicateLayer(layout: ThemeLayout, id: string): { layout: ThemeLayout; id: string } {
  const src = getLayer(layout, id);
  if (!src) return { layout, id };
  const copyId = uniqueId(layout, src.type);
  const copy: ThemeLayer = { ...src, id: copyId, name: `${src.name} copy`, x: src.x + 24, y: src.y - 24, style: { ...src.style } };
  const at = layout.layers.findIndex((l) => l.id === id);
  const layers = [...layout.layers];
  layers.splice(at + 1, 0, copy);
  return { layout: { ...layout, layers }, id: copyId };
}

/** Adds a new top-level layer near the lower-third area, on top of everything. */
export function addLayer(layout: ThemeLayout, type: LayerType): { layout: ThemeLayout; id: string } {
  const id = uniqueId(layout, type);
  const base = { id, anchor: "top-left" as const, hidden: false };
  let layer: ThemeLayer;
  if (type === "text") {
    layer = {
      ...base, name: "Text", type, content: "{reference}", x: 120, y: 760, w: 900, h: "auto",
      style: { fontFamily: "Montserrat", fontSize: 40, minFontSize: 22, fontWeight: 600, color: "#ffffff", maxLines: 1 },
      in: anim("fade", 400, 200), out: anim("fade", 220),
    };
  } else if (type === "image") {
    layer = {
      ...base, name: "Image", type, x: 120, y: 760, w: 160, h: 160,
      style: { src: "", fit: "contain" },
      in: anim("pop", 420, 200), out: anim("fade", 200),
    };
  } else if (type === "divider") {
    layer = {
      ...base, name: "Line", type, x: 120, y: 820, w: 600, h: 4,
      style: { fill: "#ffffff" },
      in: anim("grow-x", 500, 100), out: anim("fade", 200),
    };
  } else {
    layer = {
      ...base, name: "Box", type: "box", x: 120, y: 800, w: 1680, h: 200,
      style: { fill: "rgba(15,18,28,0.88)", radius: 8 },
      in: anim("wipe-left", 600), out: anim("fade", 380, 120),
    };
  }
  return { layout: { ...layout, layers: [...layout.layers, layer] }, id };
}

/**
 * Applies a move/resize done on the canvas, in design pixels. `dw`/`dh` grow the
 * box from its top-left corner whatever its anchor (x/y shift to compensate).
 */
export function nudgeLayer(layer: ThemeLayer, dx: number, dy: number, dw = 0, dh = 0): Partial<ThemeLayer> {
  const [fx, fy] = ANCHOR_FRACTION[layer.anchor] ?? [0, 0];
  const out: Partial<ThemeLayer> = { x: Math.round(layer.x + dx + dw * fx), y: Math.round(layer.y + dy) };
  if (dw) out.w = Math.max(4, Math.round(layer.w + dw));
  if (dh && layer.h !== "auto") {
    out.h = Math.max(2, Math.round((layer.h as number) + dh));
    out.y = Math.round(layer.y + dy + dh * fy);
  }
  return out;
}

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Moves a layer to the left / centre / right or top / middle / bottom of its
 * container (the canvas, or the box it is nested in). `rect` and `container` are
 * the layer's and its container's boxes on the canvas, in design pixels.
 */
export function alignLayerPatch(
  layer: ThemeLayer,
  rect: { x: number; y: number; w: number; h: number },
  container: { x: number; y: number; w: number; h: number },
  how: AlignHow,
): Partial<ThemeLayer> {
  let dx = 0;
  let dy = 0;
  if (how === "left") dx = container.x - rect.x;
  else if (how === "center") dx = container.x + (container.w - rect.w) / 2 - rect.x;
  else if (how === "right") dx = container.x + container.w - rect.w - rect.x;
  else if (how === "top") dy = container.y - rect.y;
  else if (how === "middle") dy = container.y + (container.h - rect.h) / 2 - rect.y;
  else dy = container.y + container.h - rect.h - rect.y;
  return nudgeLayer(layer, dx, dy);
}

/**
 * The theme background: a top-level box or picture that covers (nearly) the whole
 * screen. It is chosen in the Background settings, never dragged or resized on
 * the canvas, so it can't cover the text or leave the screen half empty.
 */
export function isBackdropLayer(layer: ThemeLayer): boolean {
  return !layer.parentId
    && (layer.type === "box" || layer.type === "image")
    && layer.w >= 1728
    && typeof layer.h === "number"
    && layer.h >= 972;
}

export interface LayerRect { x: number; y: number; w: number; h: number }

/** Bring to front (drawn last, on top) or send to back (just above the theme background). */
export function moveLayerTo(layout: ThemeLayout, id: string, where: "front" | "back"): ThemeLayout {
  const i = layout.layers.findIndex((l) => l.id === id);
  if (i < 0) return layout;
  const layers = [...layout.layers];
  const [layer] = layers.splice(i, 1);
  if (where === "front") {
    layers.push(layer);
  } else {
    // Stay above the backdrop layers at the bottom, so nothing hides behind the background.
    let at = 0;
    while (at < layers.length && isBackdropLayer(layers[at])) at += 1;
    layers.splice(at, 0, layer);
  }
  return { ...layout, layers };
}

const area = (r: LayerRect) => Math.max(0, r.w) * Math.max(0, r.h);
const centreInside = (r: LayerRect, box: LayerRect) => {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
};

/**
 * What sits inside a box or bar: the layers nested in it, or else the layers drawn on top of it
 * whose middle is inside it (e.g. the verse text on its bar).
 */
export function contentsOf(layout: ThemeLayout, containerId: string, rects: Record<string, LayerRect>): string[] {
  const box = rects[containerId];
  if (!box) return [];
  const children = layout.layers.filter((l) => l.parentId === containerId && !l.hidden && rects[l.id]).map((l) => l.id);
  if (children.length) return children;
  const at = layout.layers.findIndex((l) => l.id === containerId);
  return layout.layers
    .filter((l, i) => i > at && !l.parentId && !l.hidden && l.id !== containerId && !isBackdropLayer(l) && rects[l.id]
      && area(rects[l.id]) < area(box) && centreInside(rects[l.id], box))
    .map((l) => l.id);
}

/** Layers in `ids` that would move on their own (not locked, not the background, not inside another moving layer). */
function movable(layout: ThemeLayout, ids: Iterable<string>): ThemeLayer[] {
  const set = new Set(ids);
  const hasMovingAncestor = (l: ThemeLayer): boolean => {
    let p = l.parentId;
    while (p) {
      if (set.has(p)) return true;
      p = getLayer(layout, p)?.parentId;
    }
    return false;
  };
  return layout.layers.filter((l) => set.has(l.id) && !l.locked && !isBackdropLayer(l) && !hasMovingAncestor(l));
}

/** Moves several layers together by the same amount (design pixels). */
export function moveLayersPatches(layout: ThemeLayout, ids: Iterable<string>, dx: number, dy: number): Record<string, Partial<ThemeLayer>> {
  const out: Record<string, Partial<ThemeLayer>> = {};
  for (const l of movable(layout, ids)) out[l.id] = nudgeLayer(l, dx, dy);
  return out;
}

export function applyLayerPatches(layout: ThemeLayout, patches: Record<string, Partial<ThemeLayer>>): ThemeLayout {
  return { ...layout, layers: layout.layers.map((l) => (patches[l.id] ? { ...l, ...patches[l.id] } : l)) };
}

export function unionRect(rects: LayerRect[]): LayerRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * "Auto": centre what is inside a box (as one group, keeping their spacing).
 * - One layer selected: it is the box; its contents move to its middle.
 * - Several selected: the biggest one that holds the others is the box; the others move to its middle.
 *   If none holds the others, the selection is centred on the screen.
 * Returns null when there is nothing to move.
 */
export function autoCentrePatches(
  layout: ThemeLayout,
  ids: string[],
  rects: Record<string, LayerRect>,
  canvas: LayerRect = { x: 0, y: 0, w: 1920, h: 1080 },
): { patches: Record<string, Partial<ThemeLayer>>; containerId: string | null } | null {
  const known = ids.filter((id) => rects[id]);
  if (!known.length) return null;
  let containerId: string | null = null;
  let contents: string[];
  if (known.length === 1) {
    containerId = known[0];
    contents = contentsOf(layout, containerId, rects);
  } else {
    const bySize = [...known].sort((a, b) => area(rects[b]) - area(rects[a]));
    const big = bySize[0];
    const holdsOthers = bySize.slice(1).every((id) => centreInside(rects[id], rects[big]));
    containerId = holdsOthers ? big : null;
    contents = holdsOthers ? bySize.slice(1) : known;
  }
  const moving = movable(layout, contents);
  const group = unionRect(moving.map((l) => rects[l.id]).filter(Boolean));
  if (!group) return null;
  const box = containerId ? rects[containerId] : canvas;
  const dx = Math.round(box.x + box.w / 2 - (group.x + group.w / 2));
  const dy = Math.round(box.y + box.h / 2 - (group.y + group.h / 2));
  if (!dx && !dy) return { patches: {}, containerId };
  return { patches: moveLayersPatches(layout, moving.map((l) => l.id), dx, dy), containerId };
}
