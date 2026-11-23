import { describe, expect, it } from "vitest";
import { getDockBrowserZoomShortcut, isLikelyDockBrowserZoomedIn, nextDockZoomBaseline } from "./dockBrowserZoom";

describe("Dock browser zoom detection", () => {
  const baseSignals = {
    devicePixelRatio: 1,
    baselineDevicePixelRatio: 1,
    visualViewportScale: 1,
  };

  it("warns when Chromium reports a page zoom increase from the display baseline", () => {
    expect(isLikelyDockBrowserZoomedIn({
      ...baseSignals,
      devicePixelRatio: 1.25,
    })).toBe(true);
  });

  it("does not confuse normal Windows display scaling with browser zoom", () => {
    expect(isLikelyDockBrowserZoomedIn({
      ...baseSignals,
      devicePixelRatio: 1.25,
      baselineDevicePixelRatio: 1.25,
    })).toBe(false);
  });

  it("stays hidden at 100% on a narrow Windows Dock (the window frame is not zoom)", () => {
    expect(isLikelyDockBrowserZoomedIn({ ...baseSignals, baselineDevicePixelRatio: null })).toBe(false);
  });

  it("lowers a baseline that was saved while the page was zoomed in", () => {
    const saved = { screenKey: "1920x1080", devicePixelRatio: 1.25 };
    const fixed = nextDockZoomBaseline(saved, 1);
    expect(fixed.devicePixelRatio).toBe(1);
    expect(isLikelyDockBrowserZoomedIn({ ...baseSignals, baselineDevicePixelRatio: fixed.devicePixelRatio })).toBe(false);
    expect(nextDockZoomBaseline(saved, 1.5)).toBe(saved);
  });

  it("keeps the warning hidden at the normal zoom baseline", () => {
    expect(isLikelyDockBrowserZoomedIn(baseSignals)).toBe(false);
  });

  it("uses the platform reset shortcut", () => {
    expect(getDockBrowserZoomShortcut("Win32")).toBe("Ctrl+0");
    expect(getDockBrowserZoomShortcut("MacIntel")).toBe("⌘0");
  });
});
