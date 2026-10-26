import { describe, expect, it } from "vitest";
import { applyLayoutAdjust } from "./adjust";
import { isVerseTextPattern } from "./content";
import { headingLayers } from "./heading";
import { PRAYER_POINT } from "./presetsSet4";
import { LAYOUT_PRESET_THEMES } from "./presetThemes";

describe("fourth reference set (Prayer Point)", () => {
  it("is a lower third with one verse layer and a label tab heading", () => {
    expect(PRAYER_POINT.format).toBe("lower-third");
    expect(PRAYER_POINT.layers.filter((l) => l.type === "text" && isVerseTextPattern(l.content)).length).toBe(1);
    expect([...headingLayers(PRAYER_POINT).text]).toEqual(["label"]);
    const label = PRAYER_POINT.layers.find((l) => l.id === "label")!;
    expect(label.style).toMatchObject({ hug: true, textTransform: "uppercase" });
  });

  it("is registered as a built-in Bible lower third with a full screen too", () => {
    const theme = LAYOUT_PRESET_THEMES.find((t) => t.id === "preset-prayer-point");
    expect(theme).toBeTruthy();
    expect(theme!.templateType).toBe("lower-third");
    expect(theme!.categories).toContain("bible");
    expect(theme!.variants?.lowerThird?.settings.layout).toBe(PRAYER_POINT);
    expect(theme!.variants?.fullscreen?.settings.layout?.format).toBe("fullscreen");
  });

  it("works with the Dock's heading alignment", () => {
    const label = applyLayoutAdjust(PRAYER_POINT, { layoutHeadingAlign: "center" }).layers.find((l) => l.id === "label")!;
    // Centred over the lyric text, which sits inside the bar.
    expect(label.anchor).toBe("bottom-center");
    expect(label.x).toBe(70 + 60 + 1660 / 2);
  });
});
