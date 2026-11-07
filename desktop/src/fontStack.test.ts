import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const nativeThemeCss = readFileSync(new URL("./native-theme.css", import.meta.url), "utf8");
const fontsCss = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
const dockCss = readFileSync(new URL("./dock/dock.css", import.meta.url), "utf8");
const dockMain = readFileSync(new URL("./dock/dock-main.tsx", import.meta.url), "utf8");
const lmDockMain = readFileSync(new URL("./dock/lm-dock-main.tsx", import.meta.url), "utf8");

describe("African-language font stack", () => {
  it("bundles Questrial locally", () => {
    expect(fontsCss).toContain("font-family: 'Questrial'");
    expect(fontsCss).toContain("/fonts/questrial/Questrial-Regular.ttf");
    expect(existsSync(new URL("../public/fonts/questrial/Questrial-Regular.ttf", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/fonts/questrial/OFL.txt", import.meta.url))).toBe(true);
  });

  it("keeps the normal app font separate from the Dock font", () => {
    expect(nativeThemeCss).toContain('--font-african-latin: "Questrial", "Charis SIL", "Noto Sans"');
    expect(appCss).toContain(':where(input, textarea, select, button, [contenteditable="true"])');
    expect(dockCss).toContain('--dock-font-african-latin: "Questrial", "Charis SIL", "Noto Sans"');
    expect(dockCss).toContain('.dock-root :where(input, textarea, select, button, [contenteditable="true"])');
  });

  it("loads shared fonts in standalone dock entries", () => {
    expect(dockMain).toContain('import "../fonts.css"');
    expect(lmDockMain).toContain('import "../fonts.css"');
    expect(fontsCss).toContain('@import url("/fonts/google/google-fonts.css")');
    expect(fontsCss).toContain('@import url("/fonts/cmg-sans-fonts.css")');
  });
});
