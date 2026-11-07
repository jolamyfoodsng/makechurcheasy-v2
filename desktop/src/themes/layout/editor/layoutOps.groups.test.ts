import { describe, expect, it } from "vitest";
import type { ThemeLayer, ThemeLayout } from "../types";
import { autoCentrePatches, contentsOf, moveLayerTo, moveLayersPatches } from "./layoutOps";

const layer = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ThemeLayer> = {}): ThemeLayer => ({
  id, name: id, type: "box", anchor: "top-left", x, y, w, h, style: {}, in: { preset: "fade", duration: 200 }, out: { preset: "fade", duration: 200 }, ...extra,
} as ThemeLayer);

// A bar with the verse on it (not nested) and the translation below, on a full-screen background.
const layout: ThemeLayout = {
  version: 1, format: "lower-third", swap: "content",
  layers: [
    layer("bg", 0, 0, 1920, 1080),
    layer("bar", 100, 700, 1600, 200),
    layer("verse", 200, 740, 800, 80, { type: "text", h: "auto" as unknown as number }),
    layer("tr", 1500, 950, 200, 40, { type: "text" }),
  ],
} as ThemeLayout;
const rects = { bg: { x: 0, y: 0, w: 1920, h: 1080 }, bar: { x: 100, y: 700, w: 1600, h: 200 }, verse: { x: 200, y: 740, w: 800, h: 80 }, tr: { x: 1500, y: 950, w: 200, h: 40 } };

describe("layer order", () => {
  it("brings to front and sends to back above the background", () => {
    expect(moveLayerTo(layout, "bar", "front").layers.map((l) => l.id)).toEqual(["bg", "verse", "tr", "bar"]);
    expect(moveLayerTo(layout, "tr", "back").layers.map((l) => l.id)).toEqual(["bg", "tr", "bar", "verse"]);
  });
});

describe("Auto-centre", () => {
  it("finds what sits on a bar", () => {
    expect(contentsOf(layout, "bar", rects)).toEqual(["verse"]);
  });

  it("centres the bar's contents inside it", () => {
    const r = autoCentrePatches(layout, ["bar"], rects)!;
    expect(r.containerId).toBe("bar");
    // bar centre (900, 800) - verse centre (600, 780) = (300, 20)
    expect(r.patches.verse).toEqual({ x: 500, y: 760 });
  });

  it("centres several selected layers inside the biggest one", () => {
    const r = autoCentrePatches(layout, ["verse", "bar"], rects)!;
    expect(r.containerId).toBe("bar");
    expect(Object.keys(r.patches)).toEqual(["verse"]);
  });

  it("centres a selection on the screen when nothing holds it", () => {
    const r = autoCentrePatches(layout, ["verse", "tr"], rects)!;
    expect(r.containerId).toBeNull();
    expect(Object.keys(r.patches).sort()).toEqual(["tr", "verse"]);
  });
});

describe("moving several layers", () => {
  it("moves them together but never the background or a locked layer", () => {
    const locked: ThemeLayout = { ...layout, layers: layout.layers.map((l) => (l.id === "tr" ? { ...l, locked: true } : l)) };
    const p = moveLayersPatches(locked, ["bg", "bar", "verse", "tr"], 10, -5);
    expect(Object.keys(p).sort()).toEqual(["bar", "verse"]);
    expect(p.bar).toEqual({ x: 110, y: 695 });
  });
});
