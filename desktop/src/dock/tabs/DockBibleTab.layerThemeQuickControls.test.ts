import { describe, expect, it } from "vitest";
import dockBibleTabSource from "./DockBibleTab.tsx?raw";

describe("Bible output controls with a ready-made layer theme", () => {
  it("passes the layer theme's own layout to the size, step and style handlers", () => {
    expect(dockBibleTabSource).toContain("const browserLayerLayout = (browserFontMode === \"fullscreen\" ? baseFullscreenTheme : baseLowerThirdTheme)?.settings?.layout ?? null;");
  });

  it("LG / XL / 2XL set the layer theme's text and reference size", () => {
    expect(dockBibleTabSource).toContain("layoutTextScale: clampNumber(Math.round((option.fontSize / baseOption.fontSize) * 100)");
    expect(dockBibleTabSource).toContain("layoutRefScale: clampNumber(Math.round((option.refFontSize / baseOption.refFontSize) * 100)");
  });

  it("the + and - buttons step the layer theme's text size", () => {
    expect(dockBibleTabSource).toContain("layoutTextScale: clampNumber(Math.round(now.layoutTextScale * stepRatio)");
  });

  it("Bold and Italic reach the layer theme, and the buttons show how it is designed", () => {
    expect(dockBibleTabSource).toContain('layoutBold: ["bold", "extrabold", "black"].includes(String(patch.fontWeight))');
    expect(dockBibleTabSource).toContain('layoutItalic: patch.fontStyle === "italic"');
    expect(dockBibleTabSource).toContain("const designed = layoutVerseStyle(browserLayerLayout);");
    expect(dockBibleTabSource).toContain("settings={quickControlSettings}");
  });
});
