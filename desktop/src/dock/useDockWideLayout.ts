/**
 * useDockWideLayout.ts — two-pane layouts when the Dock panel is wide.
 *
 * Churches often stretch the OBS dock across a big monitor. Above DOCK_WIDE_LAYOUT_MIN_WIDTH the
 * tabs switch to a persistent left list (Bible books, songs, notes) next to the content instead of
 * a drill-down. The width is measured on `.dock-content-main`, so the Schedule drawer and vertical
 * nav are already taken out, and in the element's own CSS px, so it is in the same units as the
 * zoomed (`--dock-font-scale`) layout: a smaller Dock font size leaves more room and switches
 * sooner, exactly like the content it lays out.
 */
import { createContext, useContext, useEffect, useState, type RefObject } from "react";

export const DOCK_WIDE_LAYOUT_MIN_WIDTH = 760;
/** Stay wide until the panel shrinks a little below the threshold so a drag does not flicker. */
const DOCK_WIDE_LAYOUT_HYSTERESIS = 24;

export function isDockWideLayout(width: number, wasWide: boolean): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  return wasWide
    ? width >= DOCK_WIDE_LAYOUT_MIN_WIDTH - DOCK_WIDE_LAYOUT_HYSTERESIS
    : width >= DOCK_WIDE_LAYOUT_MIN_WIDTH;
}

export function useMeasureDockWideLayout(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // clientWidth is in the element's own (zoomed) CSS px, like the layout inside it.
    const update = () => setWide((current) => isDockWideLayout(el.clientWidth, current));
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [ref]);

  return wide;
}

export const DockWideLayoutContext = createContext(false);

/** True when the Dock is wide enough for the two-pane tab layouts. */
export function useDockWideLayout(): boolean {
  return useContext(DockWideLayoutContext);
}
