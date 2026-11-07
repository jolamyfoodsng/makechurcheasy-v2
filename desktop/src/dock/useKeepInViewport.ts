/**
 * useKeepInViewport — keeps an open Dock popover / context menu fully inside the window.
 *
 * Menus are placed from the mouse or a button with a guessed width, but their real size depends on
 * the Dock zoom (auto-fit × font size; often not 1 on Windows) and their content. After the popover
 * renders this measures it and nudges it back in with the CSS `translate` property, so its own
 * `left` / `top` / `transform` (and open animations) are left alone. It also stops a fixed box near
 * the right edge from squeezing into the room left there (it keeps its own width, capped at the window).
 */
import { useLayoutEffect, type RefObject } from "react";

const MARGIN = 8;

export function keepInViewport(el: HTMLElement, margin = MARGIN): void {
  el.style.translate = "";
  const fixed = getComputedStyle(el).position === "fixed";
  const viewportW = window.innerWidth || document.documentElement.clientWidth;
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  // Start from the box's own layout each time (a width set by an earlier pass is undone first).
  if (el.dataset.fitWidth === "1") {
    el.style.width = "";
    delete el.dataset.fitWidth;
  }
  let rect = el.getBoundingClientRect();
  // A fixed box whose left is near the right edge shrinks to the little room left there and wraps
  // its words. If it is wider at its own width, keep that width, then move it.
  if (fixed && !el.style.width) {
    el.style.width = "max-content";
    const natural = el.getBoundingClientRect();
    // Only when it was squeezed: wider on its own, and that width would not fit where it sits.
    if (natural.width > rect.width + 0.5 && rect.left + natural.width > viewportW - margin) {
      el.dataset.fitWidth = "1";
      rect = natural;
    } else {
      el.style.width = "";
    }
  }
  // Screen pixels per CSS pixel of this element (the Dock zoom it sits in).
  const ratio = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
  if (fixed && rect.width > viewportW - margin * 2) {
    el.style.maxWidth = `${(viewportW - margin * 2) / (ratio || 1)}px`;
    rect = el.getBoundingClientRect();
  }

  let dx = 0;
  if (rect.right > viewportW - margin) dx = viewportW - margin - rect.right;
  if (rect.left + dx < margin) dx = margin - rect.left;
  let dy = 0;
  if (rect.bottom > viewportH - margin) dy = viewportH - margin - rect.bottom;
  if (rect.top + dy < margin) dy = margin - rect.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  el.style.translate = `${dx / (ratio || 1)}px ${dy / (ratio || 1)}px`;
}

/** Re-checks whenever `open` or the deps change, and when the window resizes while it is open. */
export function useKeepInViewport(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  deps: readonly unknown[] = [],
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fit = () => keepInViewport(el);
    fit();
    // Content can grow after the first paint (fonts, lazy lists); check again a frame later.
    const frame = window.requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
}

/**
 * Ref form for popovers whose position comes from state: `ref={(el) => fitPopover(el)}`.
 * An inline arrow is a new ref each render, so React calls it again after every render and a menu
 * re-opened somewhere else is fitted again too.
 */
export function fitPopover(el: HTMLElement | null): void {
  if (!el) return;
  keepInViewport(el);
  window.requestAnimationFrame(() => {
    if (el.isConnected) keepInViewport(el);
  });
}
