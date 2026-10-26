import { describe, expect, it } from "vitest";
import { isVerseTextPattern } from "./content";
import { headingLayers } from "./heading";
import { SET2_PRESETS, VIOLET_SPLIT } from "./presetsSet2";
import { LAYOUT_PRESET_THEMES, STARTER_DEFAULT_THEME_ID, STARTER_THEMES } from "./presetThemes";
import type { ThemeLayout } from "./types";

function check(name: string, l: ThemeLayout, format: ThemeLayout["format"]) {
  expect(l.format).toBe(format);
  const ids = l.layers.map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const x of l.layers) {
    if (x.parentId) expect(ids.indexOf(x.parentId) > -1 && ids.indexOf(x.parentId) < ids.indexOf(x.id)).toBe(true);
  }
  expect(l.layers.filter((x) => x.type === "text" && isVerseTextPattern(x.content)).length).toBe(1);
  const h = headingLayers(l);
  expect(h.text.size > 0).toBe(true);
  if (format === "fullscreen") {
    const bg = l.layers[0];
    expect(bg.w >= 1920 && bg.h === 1080 && Boolean(bg.style.fill || bg.style.gradient)).toBe(true);
  }
  void name;
}

describe("second reference set", () => {
  it("has 5 lower thirds, each with a hand-made full screen", () => {
    expect(SET2_PRESETS.length).toBe(5);
    for (const p of SET2_PRESETS) {
      check(p.name, p.layout, "lower-third");
      check(`${p.name} FS`, p.companion, "fullscreen");
    }
  });

  it("box headings are flagged so they hide with the label", () => {
    expect([...headingLayers(VIOLET_SPLIT).decor]).toEqual(["label-box"]);
    const navy = SET2_PRESETS.find((p) => p.id === "preset-navy-scripture")!;
    expect([...headingLayers(navy.layout).decor]).toEqual(["heading-box"]);
  });
});

describe("theme list", () => {
  it("has six starters, all with both looks, and Royal Blue Glow is the default", () => {
    expect(STARTER_THEMES.length).toBe(6);
    expect(STARTER_DEFAULT_THEME_ID).toBe("preset-royal-blue-glow");
    expect(STARTER_THEMES.slice(0, 3).map((t) => t.name)).toEqual(["Caption Rule", "Broadcast Caption", "Chapter Number"]);
    expect(LAYOUT_PRESET_THEMES.slice(0, 3).map((t) => t.name)).toEqual(["Royal Blue Glow", "Serif Tab Band", "Royal Frame"]);
    expect(LAYOUT_PRESET_THEMES[0].id).toBe(STARTER_DEFAULT_THEME_ID);
    for (const t of STARTER_THEMES) {
      expect(Boolean(t.variants?.fullscreen?.settings.layout && t.variants?.lowerThird?.settings.layout)).toBe(true);
      expect(t.variants!.fullscreen!.settings.layout!.format).toBe("fullscreen");
      expect(t.variants!.lowerThird!.settings.layout!.format).toBe("lower-third");
    }
  });

  it("has unique ids", () => {
    const ids = LAYOUT_PRESET_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(6 + 1 + 1 + 5 + 15);
  });
});
