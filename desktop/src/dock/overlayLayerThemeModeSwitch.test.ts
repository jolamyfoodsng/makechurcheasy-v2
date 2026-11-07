import { describe, expect, it } from "vitest";
import bibleOverlaySource from "../../public/mce-bible-overlay.html?raw";
import worshipOverlaySource from "../../public/mce-worship-overlay.html?raw";
import notesOverlaySource from "../../public/mce-note.html?raw";
import rendererSource from "../themes/layout/renderer.ts?raw";
import overlayEntrySource from "../themes/layout/overlay-entry.ts?raw";

/**
 * Regression: Full -> Lower third showed the Full-mode background behind a
 * layer-theme lower third. The theme renderer draws into its own host and
 * returns early from processOverlayUpdate, which used to skip setActiveLayer().
 */
const pages: Array<[string, string]> = [
  ["bible", bibleOverlaySource],
  ["worship", worshipOverlaySource],
  ["notes", notesOverlaySource],
];

function themeHandleBlock(source: string): string {
  const start = source.indexOf("window.MCEThemeOverlay.handle(packet, {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("// Apply theme even from theme-only packets", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("layer-theme packets switch the Full / Lower third layer", () => {
  it.each(pages)("%s overlay calls setActiveLayer when the theme renderer handles a packet", (_name, source) => {
    const block = themeHandleBlock(source);
    expect(block).toContain("setActiveLayer(packet.mode)");
    expect(block).toContain("packet.mode === 'fullscreen' || packet.mode === 'lower-third'");
    // Fade-outs must not flip layers mid-animation.
    expect(block).toContain("packet.action !== 'animate-out'");
    // The layer switch happens inside the handled branch, before returning.
    expect(block.indexOf("setActiveLayer(packet.mode)")).toBeLessThan(block.indexOf("return;"));
  });
});

/**
 * Full -> Lower third plays as "out, then in": the leaving layer fades out
 * first, then the new layer (drawn while hidden) fades in and its text plays
 * the theme's entrance animation. Layer themes play the old layout out, swap,
 * and play the new layout in.
 */
describe("Full <-> Lower third plays out, then in", () => {
  it.each(pages)("%s overlay sequences the layer fade instead of cross-fading", (_name, source) => {
    expect(source).toContain("function sequenceModeSwitch(from, to)");
    expect(source).toContain("function shouldSequenceModeSwitch()");
    expect(source).toContain("var MODE_OUT_MS = 240;");
    expect(source).toContain("sequenceModeSwitch(previousMode, mode);");
    // Snaps when nothing is on screen, motion is reduced or animation is "none".
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("getOverlayAnimationName(currentOverlayData) === 'none'");
    // The new layer's text plays the theme entrance animation once revealed.
    expect(source).toContain("playVerseEnterAnimation(to, getOverlayAnimationName(currentOverlayData))");
  });

  it.each(pages)("%s overlay tells the theme renderer when a visible mode switch happens", (_name, source) => {
    expect(source).toContain("modeSwitch: themeModeSwitch,");
    // Only a visible switch (something on air, a different layer, motion allowed) transitions.
    expect(source).toContain("&& packet.mode !== activeMode");
    expect(source).toContain("&& shouldSequenceModeSwitch();");
  });

  it.each(pages)("%s overlay gives the renderer the same out time as the page fade", (_name, source) => {
    expect(source).toContain("modeSwitchOutMs: MODE_OUT_MS");
  });

  it("layer theme -> legacy theme keeps the legacy bar hidden until the layout has played out", () => {
    // Regression: Lower third (layer theme) -> Full (legacy theme) flashed the dark legacy
    // lower-third bar because deactivate() un-hid it while the old layer was still fading.
    expect(overlayEntrySource).toContain("function retireLayoutAfterOut(outMs: number)");
    expect(overlayEntrySource).toContain("if (retirePending) return false;");
    expect(overlayEntrySource).toContain("if (!layout && retirePending) return false;");
    expect(overlayEntrySource).toContain("void r.hide(outMs).then(settle, settle);");
    expect(rendererSource).toContain("hide(maxOutMs?: number): Promise<void>");
    expect(rendererSource).toContain("private async playOutWithin(maxMs: number)");
  });

  it("theme renderer swaps layouts out -> swap -> in on a mode switch", () => {
    expect(rendererSource).toContain("switchLayout(layout: ThemeLayout");
    expect(rendererSource).toContain('kind: "switch"');
    expect(rendererSource).toContain("MODE_SWITCH_MAX_OUT_MS");
    // A newer explicit layout must win over a switch that was still fading out.
    expect(rendererSource).toContain("this.layoutEpoch !== epoch");
  });

  it("overlay adapter only transitions when asked and acks immediately", () => {
    expect(overlayEntrySource).toContain("modeSwitch?: boolean;");
    expect(overlayEntrySource).toContain("hooks.modeSwitch");
    const start = overlayEntrySource.indexOf("void r.switchLayout(layout, contentOf(packet.slide));");
    expect(start).toBeGreaterThan(-1);
    const end = overlayEntrySource.indexOf("return true;", start);
    expect(end).toBeGreaterThan(start);
    const block = overlayEntrySource.slice(start, end);
    expect(block).toContain("safe(hooks.ack, packet, true)");
    // The ack must not wait for the transition to finish.
    expect(block).not.toContain(".then(");
  });
});
