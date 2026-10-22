import { describe, expect, it } from "vitest";
import { LAYOUT_PRESET_THEMES, getThemeLayout } from "./presetThemes";
import { emphasisColorFor, emphasisWeightFor, parseEmphasis, stripEmphasis } from "./emphasis";
import type { ThemeLayer, ThemeLayout } from "./types";

describe("important words (*asterisks*)", () => {
  it("splits plain and emphasised parts", () => {
    expect(parseEmphasis("Your *tomorrow* is *not cancelled*.")).toEqual([
      { text: "Your ", em: false },
      { text: "tomorrow", em: true },
      { text: " is ", em: false },
      { text: "not cancelled", em: true },
      { text: ".", em: false },
    ]);
  });

  it("takes a colour picked for some words", () => {
    expect(parseEmphasis("The *[#facc15]Lord* is my *shepherd*")).toEqual([
      { text: "The ", em: false },
      { text: "Lord", em: true, color: "#facc15" },
      { text: " is my ", em: false },
      { text: "shepherd", em: true },
    ]);
    expect(stripEmphasis("The *[#facc15]Lord* is my shepherd")).toBe("The Lord is my shepherd");
    // Only a hex colour counts; anything else is just text.
    expect(parseEmphasis("*[red]Lord*").map((p) => p.color)).toEqual([undefined]);
  });

  it("leaves text with no pair, a lone asterisk or spaced asterisks alone", () => {
    expect(parseEmphasis("Amazing grace")).toEqual([{ text: "Amazing grace", em: false }]);
    expect(parseEmphasis("a * b")).toEqual([{ text: "a * b", em: false }]);
    expect(parseEmphasis("2 * 3 * 4")).toEqual([{ text: "2 * 3 * 4", em: false }]);
    expect(parseEmphasis("")).toEqual([]);
  });

  it("does not run across lines", () => {
    expect(parseEmphasis("*one\ntwo*").every((p) => !p.em)).toBe(true);
  });

  it("strips the asterisks", () => {
    expect(stripEmphasis("The *Lord* is my *shepherd*")).toBe("The Lord is my shepherd");
  });

  it("uses the layer's own colour, then the theme's, then works one out", () => {
    const layer = (style: ThemeLayer["style"]) => ({ style }) as Pick<ThemeLayer, "style">;
    expect(emphasisColorFor(null, layer({ emphasisColor: "#ff0000" }))).toBe("#ff0000");
    const withSet = { version: 1, format: "lower-third", swap: "content", layers: [{ type: "text", style: { emphasisColor: "#00ff00" } }] } as unknown as ThemeLayout;
    expect(emphasisColorFor(withSet, layer({ color: "#fff" }))).toBe("#00ff00");
    expect(emphasisColorFor(null, layer({ color: "#ffffff" }))).toBe("#f7c82d");
    expect(emphasisColorFor(null, layer({ color: "#111111" }))).toBe("#c2410c");
    // A real verse-number colour is reused; a faint white one is not.
    expect(emphasisColorFor(null, layer({ color: "#ffffff", verseNumberColor: "#e0453a" }))).toBe("#e0453a");
    expect(emphasisColorFor(null, layer({ color: "#ffffff", verseNumberColor: "rgba(255,255,255,0.7)" }))).toBe("#f7c82d");
  });

  it("makes important words bolder, never lighter than Bold", () => {
    expect(emphasisWeightFor({ fontWeight: 400 })).toBe(700);
    expect(emphasisWeightFor({ fontWeight: 600 })).toBe(800);
    expect(emphasisWeightFor({ fontWeight: 900 })).toBe(900);
    expect(emphasisWeightFor({ fontWeight: 400, emphasisWeight: 500 })).toBe(500);
  });

  it("every ready-made theme gets a colour that differs from its verse colour", () => {
    for (const theme of LAYOUT_PRESET_THEMES) {
      for (const variant of [theme.variants?.fullscreen, theme.variants?.lowerThird]) {
        const layout = variant?.settings.layout ?? getThemeLayout(theme);
        if (!layout) continue;
        const verse = layout.layers.find((l) => l.type === "text" && l.content?.trim() === "{text}")!;
        const color = emphasisColorFor(layout, verse).toLowerCase();
        expect(color).toBeTruthy();
        expect(color).not.toBe((verse.style.color || "#ffffff").toLowerCase());
      }
    }
  });
});
