import { describe, expect, it } from "vitest";
import { layerThemeQuickDisplay, withLayerThemeQuickPatch } from "./layerThemeQuickPatch";
import { DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN, DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD } from "./dockQuickSizePresets";
import type { LayerAnimation, ThemeLayout } from "../themes/layout/types";

const NO_ANIM = { preset: "none", duration: 0, delay: 0, easing: "out-cubic" } as const satisfies LayerAnimation;
const anim = { in: NO_ANIM, out: NO_ANIM };

function layout(verseStyle: Record<string, unknown> = {}): ThemeLayout {
  return {
    version: 1,
    format: "fullscreen",
    swap: "content",
    layers: [
      { id: "verse", name: "Verse", type: "text", content: "{text}", anchor: "top-left", x: 0, y: 0, w: 1800, h: 600, style: { fontSize: 80, ...verseStyle }, ...anim },
    ],
  } as ThemeLayout;
}

const lg = DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN[0];
const xl = DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN[1];
const lt2xl = DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD[2];

describe("quick controls for a layer theme", () => {
  it("leaves plain themes exactly as they are", () => {
    const patch = { fontSize: 90, fontWeight: "bold", fontStyle: "italic" };
    expect(withLayerThemeQuickPatch(patch, { layout: null, mode: "fullscreen", adjustSource: {} })).toBe(patch);
  });

  it("LG is the designed size; XL and 2XL grow by the same steps as plain themes", () => {
    const ctx = { layout: layout(), mode: "fullscreen" as const, adjustSource: {} };
    const at = (o: typeof lg) => withLayerThemeQuickPatch({ fontSize: o.fontSize, refFontSize: o.refFontSize, lowerThirdSize: o.preset }, ctx);
    expect(at(lg)).toMatchObject({ layoutTextScale: 100, layoutRefScale: 100 });
    expect(at(xl).layoutTextScale).toBe(Math.round((xl.fontSize / lg.fontSize) * 100));
    expect(at(xl).layoutRefScale).toBe(Math.round((xl.refFontSize / lg.refFontSize) * 100));
    const lower = withLayerThemeQuickPatch(
      { fontSize: lt2xl.fontSize, refFontSize: lt2xl.refFontSize, lowerThirdSize: lt2xl.preset },
      { layout: layout(), mode: "lower-third", adjustSource: {} },
    );
    expect(lower.layoutTextScale).toBe(Math.round((lt2xl.fontSize / DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD[0].fontSize) * 100));
  });

  it("a + / − step changes the current percent by the same ratio", () => {
    const ctx = { layout: layout(), mode: "fullscreen" as const, adjustSource: { layoutTextScale: 120, layoutRefScale: 120 }, previousFontSize: 80 };
    const up = withLayerThemeQuickPatch({ fontSize: 84 }, ctx);
    expect(up.layoutTextScale).toBe(126);
    expect(up.layoutRefScale).toBe(126);
    expect(withLayerThemeQuickPatch({ fontSize: 76 }, ctx).layoutTextScale).toBe(114);
  });

  it("keeps a step inside the allowed range", () => {
    const ctx = { layout: layout(), mode: "fullscreen" as const, adjustSource: { layoutTextScale: 199 }, previousFontSize: 10 };
    expect(withLayerThemeQuickPatch({ fontSize: 40 }, ctx).layoutTextScale).toBe(200);
  });

  it("Bold and Italic are written for the theme's verse text", () => {
    const ctx = { layout: layout(), mode: "fullscreen" as const, adjustSource: {} };
    expect(withLayerThemeQuickPatch({ fontWeight: "bold" }, ctx).layoutBold).toBe(true);
    expect(withLayerThemeQuickPatch({ fontWeight: "normal" }, ctx).layoutBold).toBe(false);
    expect(withLayerThemeQuickPatch({ fontStyle: "italic" }, ctx).layoutItalic).toBe(true);
    expect(withLayerThemeQuickPatch({ fontStyle: "normal" }, ctx).layoutItalic).toBe(false);
  });

  it("the buttons show the design until the operator chooses", () => {
    const heavy = layout({ fontWeight: 800, italic: true });
    expect(layerThemeQuickDisplay({ fontWeight: "normal", fontStyle: "normal" }, heavy, {})).toMatchObject({ fontWeight: "bold", fontStyle: "italic" });
    expect(layerThemeQuickDisplay({ fontWeight: "bold" }, heavy, { layoutBold: false, layoutItalic: false })).toMatchObject({ fontWeight: "normal", fontStyle: "normal" });
    const plain = { fontWeight: "black", fontStyle: "normal" };
    expect(layerThemeQuickDisplay(plain, null, {})).toBe(plain);
  });
});
