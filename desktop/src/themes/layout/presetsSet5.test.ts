import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLayoutAdjust } from "./adjust";
import { isVerseTextPattern } from "./content";
import { headingLayers } from "./heading";
import { BLUE_PAINT_BANNER, BLUE_PAINT_BANNER_FS, BLUE_PAINT_FULLSCREEN_TEXTURE, BLUE_PAINT_TEXTURE } from "./presetsSet5";
import { LAYOUT_PRESET_THEMES } from "./presetThemes";

describe("fifth reference set (Blue Paint Banner)", () => {
  it("is a lower third with one verse layer and a reference tab heading", () => {
    expect(BLUE_PAINT_BANNER.format).toBe("lower-third");
    expect(BLUE_PAINT_BANNER.layers.filter((l) => l.type === "text" && isVerseTextPattern(l.content)).length).toBe(1);
    expect([...headingLayers(BLUE_PAINT_BANNER).text]).toEqual(["label"]);
    const label = BLUE_PAINT_BANNER.layers.find((l) => l.id === "label")!;
    expect(label.style).toMatchObject({ hug: true, textTransform: "uppercase" });
  });

  it("paints the band with the bundled texture, over a blue fill", () => {
    const band = BLUE_PAINT_BANNER.layers.find((l) => l.id === "band")!;
    expect(band.style).toMatchObject({ src: BLUE_PAINT_TEXTURE, fit: "cover" });
    expect(band.style.fill).toBeTruthy();
    expect(existsSync(resolve(__dirname, "../../../public", BLUE_PAINT_TEXTURE.replace(/^\//, "")))).toBe(true);
  });

  it("is registered as a built-in Bible lower third with a full screen too", () => {
    const theme = LAYOUT_PRESET_THEMES.find((t) => t.id === "preset-blue-paint-banner");
    expect(theme).toBeTruthy();
    expect(theme!.name).toBe("Blue Paint Banner");
    expect(theme!.templateType).toBe("lower-third");
    expect(theme!.categories).toContain("bible");
    expect(theme!.variants?.lowerThird?.settings.layout).toBe(BLUE_PAINT_BANNER);
    expect(theme!.variants?.fullscreen?.settings.layout?.format).toBe("fullscreen");
  });

  it("keeps the paint on the full screen, without the generic animated pattern on top", () => {
    const theme = LAYOUT_PRESET_THEMES.find((t) => t.id === "preset-blue-paint-banner")!;
    const fs = theme.variants!.fullscreen!.settings.layout!;
    expect(fs.layers[0].style).toMatchObject({ src: BLUE_PAINT_FULLSCREEN_TEXTURE, fit: "cover" });
    expect(fs.layers.some((l) => l.id === "mce-pattern")).toBe(false);
    expect(fs.layers.filter((l) => l.type === "text" && isVerseTextPattern(l.content)).length).toBe(1);
    expect([...headingLayers(BLUE_PAINT_BANNER_FS).text]).toEqual(["label"]);
    expect(existsSync(resolve(__dirname, "../../../public", BLUE_PAINT_FULLSCREEN_TEXTURE.replace(/^\//, "")))).toBe(true);
  });

  it("keeps the tab centred over the verse with the Dock's centre alignment", () => {
    const label = applyLayoutAdjust(BLUE_PAINT_BANNER, { layoutHeadingAlign: "center" }).layers.find((l) => l.id === "label")!;
    expect(label.anchor).toBe("bottom-center");
    expect(label.x).toBe(40 + 90 + (1840 - 180) / 2);
  });
});
