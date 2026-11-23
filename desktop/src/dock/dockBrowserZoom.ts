import { useEffect, useState } from "react";
import { readNativeDockSetting, writeNativeDockSetting } from "../services/localDockSettings";

const BASELINE_STORAGE_KEY = "mce-dock-browser-zoom-baseline-v1";
const ZOOM_TOLERANCE = 1.05;

export interface DockBrowserZoomSignals {
  devicePixelRatio: number;
  baselineDevicePixelRatio: number | null;
  visualViewportScale: number | null;
}

export interface DockBrowserZoomBaseline {
  screenKey: string;
  devicePixelRatio: number;
}

/**
 * Detect a zoom change without treating Windows display scaling as browser
 * zoom. The baseline is captured for the current display and compared with
 * later page-zoom changes reported by Chromium/CEF.
 */
export function isLikelyDockBrowserZoomedIn(signals: DockBrowserZoomSignals): boolean {
  const deviceZoomedIn = Boolean(
    signals.baselineDevicePixelRatio &&
      signals.devicePixelRatio / signals.baselineDevicePixelRatio >= ZOOM_TOLERANCE,
  );
  const pinchZoomedIn = Boolean(
    signals.visualViewportScale && signals.visualViewportScale >= ZOOM_TOLERANCE,
  );
  // outerWidth / innerWidth is not used: on Windows the window frame alone makes it pass the
  // tolerance on a narrow Dock, so the warning showed at 100%.
  return deviceZoomedIn || pinchZoomedIn;
}

/** The display's normal pixel ratio is the lowest one seen on it: zooming only ever raises it. */
export function nextDockZoomBaseline(baseline: DockBrowserZoomBaseline, devicePixelRatio: number): DockBrowserZoomBaseline {
  return devicePixelRatio < baseline.devicePixelRatio ? { ...baseline, devicePixelRatio } : baseline;
}

export function getDockBrowserZoomShortcut(platform = ""): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘0" : "Ctrl+0";
}

function getScreenKey(): string {
  if (typeof window === "undefined" || typeof window.screen === "undefined") return "unknown";
  const screen = window.screen;
  return [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth].join("x");
}

function readBaseline(): DockBrowserZoomBaseline | null {
  try {
    const stored = readNativeDockSetting<unknown>(BASELINE_STORAGE_KEY);
    const raw = typeof stored === "string" ? stored : stored ? JSON.stringify(stored) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DockBrowserZoomBaseline>;
    if (
      typeof parsed.screenKey !== "string" ||
      typeof parsed.devicePixelRatio !== "number" ||
      !Number.isFinite(parsed.devicePixelRatio) ||
      parsed.devicePixelRatio <= 0
    ) {
      return null;
    }
    return { screenKey: parsed.screenKey, devicePixelRatio: parsed.devicePixelRatio };
  } catch {
    return null;
  }
}

function saveBaseline(baseline: DockBrowserZoomBaseline): void {
  writeNativeDockSetting(BASELINE_STORAGE_KEY, baseline);
}

function getSignals(baseline: DockBrowserZoomBaseline | null): DockBrowserZoomSignals {
  const devicePixelRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const currentScreenKey = getScreenKey();
  const matchingBaseline = baseline?.screenKey === currentScreenKey ? baseline : null;

  return {
    devicePixelRatio,
    baselineDevicePixelRatio: matchingBaseline?.devicePixelRatio ?? null,
    visualViewportScale: window.visualViewport?.scale ?? null,
  };
}

export function useDockBrowserZoomWarning(): { isZoomedIn: boolean; resetShortcut: string } {
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [resetShortcut, setResetShortcut] = useState("Ctrl+0");

  useEffect(() => {
    const screenKey = getScreenKey();
    const currentDpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    const storedBaseline = readBaseline();
    let baseline = storedBaseline?.screenKey === screenKey
      ? nextDockZoomBaseline(storedBaseline, currentDpr)
      : { screenKey, devicePixelRatio: currentDpr };

    if (baseline !== storedBaseline) saveBaseline(baseline);
    setResetShortcut(getDockBrowserZoomShortcut(navigator.platform));

    const evaluate = () => {
      const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      if (getScreenKey() === baseline.screenKey) {
        const lowered = nextDockZoomBaseline(baseline, dpr);
        if (lowered !== baseline) {
          baseline = lowered;
          saveBaseline(baseline);
        }
      }
      setIsZoomedIn(isLikelyDockBrowserZoomedIn(getSignals(baseline)));
    };

    evaluate();
    window.addEventListener("resize", evaluate);
    window.visualViewport?.addEventListener("resize", evaluate);
    window.visualViewport?.addEventListener("scroll", evaluate);

    return () => {
      window.removeEventListener("resize", evaluate);
      window.visualViewport?.removeEventListener("resize", evaluate);
      window.visualViewport?.removeEventListener("scroll", evaluate);
    };
  }, []);

  return { isZoomedIn, resetShortcut };
}
