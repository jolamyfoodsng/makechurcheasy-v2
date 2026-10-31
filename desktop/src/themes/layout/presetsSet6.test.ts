import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isVerseTextPattern } from "./content";
import { headingLayers } from "./heading";
import {
  RED_EMBER_ASSETS,
  RED_EMBER_BAND_TEXTURE,
  RED_EMBER_FRAME_FS,
  RED_EMBER_FRAME_LT,
  RED_EMBER_FULLSCREEN_TEXTURE,
} from "./presetsSet6";
import { LAYOUT_PRESET_THEMES } from "./presetThemes";

const inPublic = (url: string) => existsSync(resolve(__dirname, "../../../public", url.replace(/^\//, "")));

describe("sixth reference set (Red Ember Frame)", () => {
  it("is a full screen with one verse layer and the plaque as its heading", () => {
    expect(RED_EMBER_FRAME_FS.format).toBe("fullscreen");
    expect(RED_EMBER_FRAME_FS.layers.filter((l) => l.type === "text" && isVerseTextPattern(l.content)).length).toBe(1);
    expect([...headingLayers(RED_EMBER_FRAME_FS).text]).toEqual(["label"]);
    const label = RED_EMBER_FRAME_FS.layers.find((l) => l.id === "label")!;
    expect(label.style).toMatchObject({ hug: true, textTransform: "uppercase", fontFamily: "Libre Baskerville" });
  });

  it("paints the background with the bundled ember still (no video), so no generic pattern is added", () => {
    const theme = LAYOUT_PRESET_THEMES.find((t) => t.id === "preset-red-ember-frame")!;
    const fs = theme.variants!.fullscreen!.settings.layout!;
    expect(fs.layers[0].style).toMatchObject({ src: RED_EMBER_FULLSCREEN_TEXTURE, fit: "cover" });
    expect(fs.layers[0].style.videoSrc).toBeUndefined();
    expect(fs.layers[0].style.fill).toBeTruthy();
    expect(fs.layers.some((l) => l.id === "mce-pattern")).toBe(false);
  });

  it("ships every picture it uses", () => {
    for (const url of [RED_EMBER_FULLSCREEN_TEXTURE, RED_EMBER_BAND_TEXTURE, ...Object.values(RED_EMBER_ASSETS)]) {
      expect(inPublic(url), url).toBe(true);
    }
  });

  it("keeps the logos, dates, event name and handle as editable plain layers", () => {
    const ids = RED_EMBER_FRAME_FS.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["logo-left", "logo-right", "dates", "event", "socials", "handle"]));
    for (const id of ["dates", "event", "handle"]) {
      const layer = RED_EMBER_FRAME_FS.layers.find((l) => l.id === id)!;
      expect(layer.content).not.toMatch(/\{/);
    }
  });

  it("is registered as a built-in Bible full screen with a matching lower third", () => {
    const theme = LAYOUT_PRESET_THEMES.find((t) => t.id === "preset-red-ember-frame");
    expect(theme).toBeTruthy();
    expect(theme!.name).toBe("Red Ember Frame");
    expect(theme!.templateType).toBe("fullscreen");
    expect(theme!.categories).toContain("bible");
    expect(theme!.variants?.lowerThird?.settings.layout).toBe(RED_EMBER_FRAME_LT);
    expect(RED_EMBER_FRAME_LT.layers.filter((l) => l.type === "text" && isVerseTextPattern(l.content)).length).toBe(1);
    expect([...headingLayers(RED_EMBER_FRAME_LT).text]).toEqual(["label"]);
  });
});
