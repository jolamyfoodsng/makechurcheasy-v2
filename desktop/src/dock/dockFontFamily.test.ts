import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_DOCK_FONT_FAMILY,
  DEFAULT_DOCK_FONT_SCALE,
  DOCK_FONT_FAMILY_OPTIONS,
  DOCK_UNICODE_FALLBACK_FAMILY,
  buildDockFontFamilyStack,
  buildDockFontFamilyCss,
  normalizeDockFontFamily,
  normalizeDockFontScale,
} from "./dockFontFamily";

const bundledGoogleFontsCss = readFileSync(new URL("../../public/fonts/google/google-fonts.css", import.meta.url), "utf8");

describe("dock typography settings", () => {
  it("keeps selected families valid while appending Unicode-safe fallbacks", () => {
    const selected = DOCK_FONT_FAMILY_OPTIONS.find((option) => option.id === "inter");
    const stack = buildDockFontFamilyStack(selected?.family);

    expect(stack).toContain('"Inter"');
    expect(stack).toContain('"Charis SIL"');
    expect(stack).toContain('"Noto Sans Symbols 2"');
    expect(stack).toContain('"Apple Color Emoji"');
    expect(stack.endsWith("sans-serif")).toBe(true);

    const css = buildDockFontFamilyCss(selected?.family);
    expect(css).toContain('"Noto Sans Symbols 2"');
    expect(css).toContain('--mce-output-font-family');
  });

  it("defaults to the system UI font and still offers CMG Sans as a bundled family", () => {
    expect(DEFAULT_DOCK_FONT_FAMILY).toContain("system-ui");
    expect(buildDockFontFamilyStack(undefined)).toContain("system-ui");
    const selected = DOCK_FONT_FAMILY_OPTIONS.find((option) => option.id === "cmg-sans");
    expect(selected?.family).toContain('"CMG Sans"');
  });

  it("does not accept arbitrary CSS as a selectable font family", () => {
    expect(normalizeDockFontFamily("font-family: malicious")).toBe("");
    expect(DOCK_UNICODE_FALLBACK_FAMILY).toContain('"Segoe UI Symbol"');
  });

  it("normalizes the persisted size to a supported option", () => {
    expect(normalizeDockFontScale(undefined)).toBe(DEFAULT_DOCK_FONT_SCALE);
    expect(normalizeDockFontScale(null)).toBe(DEFAULT_DOCK_FONT_SCALE);
    expect(normalizeDockFontScale("1.25")).toBe(1.25);
    expect(normalizeDockFontScale(2)).toBe(1.25);
    expect(normalizeDockFontScale(0.2)).toBe(0.9);
  });

  it("offers a broad curated set of locally bundled font families", () => {
    expect(DOCK_FONT_FAMILY_OPTIONS.length).toBeGreaterThan(24);

    for (const family of [
      "Karla",
      "Source Sans 3",
      "Barlow Condensed",
      "Bebas Neue",
      "Libre Baskerville",
      "Playfair Display",
      "Caveat",
    ]) {
      expect(bundledGoogleFontsCss).toContain(`font-family: '${family}'`);
      expect(DOCK_FONT_FAMILY_OPTIONS.some((option) => option.label.startsWith(family))).toBe(true);
    }
  });
});
