/**
 * LayerContextMenu — the right-click menu for layers on the Theme Creator canvas (and the layer list).
 *
 * Order (bring to front / forward, send backward / to back), Auto-centre what is inside a box,
 * duplicate, hide, lock, heading on/off and delete. Works on every selected layer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ThemeLayout } from "../types";
import { headingLayers, hasHeading, isHeadingShown } from "../heading";
import { duplicateLayer, getLayer, isBackdropLayer, moveLayer, moveLayerTo, removeLayer, updateLayer } from "./layoutOps";

interface Props {
  layout: ThemeLayout;
  /** Selected layers (the menu acts on all of them). */
  ids: string[];
  x: number;
  y: number;
  onChange: (layout: ThemeLayout) => void;
  onSelect: (ids: string[]) => void;
  /** Centre what is inside the selected box (or the selection on screen). Omitted when there is nothing to centre. */
  onAutoCentre?: () => void;
  onClose: () => void;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";

export default function LayerContextMenu({ layout, ids, x, y, onChange, onSelect, onAutoCentre, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const layers = ids.map((id) => getLayer(layout, id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  const editable = layers.filter((l) => !isBackdropLayer(l));
  const allHidden = editable.length > 0 && editable.every((l) => l.hidden);
  const allLocked = editable.length > 0 && editable.every((l) => l.locked);
  const heading = headingLayers(layout);
  const touchesHeading = hasHeading(layout) && layers.some((l) => heading.text.has(l.id) || heading.decor.has(l.id));

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, []);

  const run = (fn: () => void) => () => { fn(); onClose(); };

  /** Apply an order change to every selected layer, keeping their order among themselves. */
  const reorder = (how: "front" | "forward" | "backward" | "back") => {
    const order = layout.layers.map((l) => l.id);
    const bottomUp = [...editable].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    // Front / backward: lowest first. Back / forward: highest first.
    const seq = how === "front" || how === "backward" ? bottomUp : [...bottomUp].reverse();
    let next = layout;
    for (const l of seq) {
      if (how === "front" || how === "back") next = moveLayerTo(next, l.id, how);
      else next = moveLayer(next, l.id, how === "forward" ? "up" : "down");
    }
    onChange(next);
  };

  const setAll = (patch: { hidden?: boolean; locked?: boolean }) => {
    let next = layout;
    for (const l of editable) next = updateLayer(next, l.id, patch);
    onChange(next);
  };

  const duplicate = () => {
    let next = layout;
    const copies: string[] = [];
    for (const l of editable) {
      const r = duplicateLayer(next, l.id);
      next = r.layout;
      copies.push(r.id);
    }
    onChange(next);
    if (copies.length) onSelect(copies);
  };

  const remove = () => {
    let next = layout;
    for (const l of editable) next = removeLayer(next, l.id);
    onChange(next);
    onSelect([]);
  };

  const none = editable.length === 0;
  const item = (label: string, onClick: () => void, opts: { disabled?: boolean; hint?: string; danger?: boolean } = {}) => (
    <button type="button" role="menuitem" className={`le-ctx__item${opts.danger ? " le-ctx__item--danger" : ""}`} disabled={opts.disabled} onClick={run(onClick)}>
      <span>{label}</span>
      {opts.hint && <kbd className="le-ctx__hint">{opts.hint}</kbd>}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      className="le-ctx"
      role="menu"
      aria-label={layers.length > 1 ? `${layers.length} layers` : layers[0]?.name ?? "Layer"}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="le-ctx__title">{layers.length > 1 ? `${layers.length} layers selected` : layers[0]?.name ?? "Layer"}</div>
      {item("Bring to front", () => reorder("front"), { disabled: none, hint: `${MOD}]` })}
      {item("Bring forward", () => reorder("forward"), { disabled: none, hint: "]" })}
      {item("Send backward", () => reorder("backward"), { disabled: none, hint: "[" })}
      {item("Send to back", () => reorder("back"), { disabled: none, hint: `${MOD}[` })}
      <div className="le-ctx__sep" role="separator" />
      {onAutoCentre && item(layers.length > 1 ? "Auto-centre inside" : "Auto-centre what's inside", onAutoCentre)}
      {item("Duplicate", duplicate, { disabled: none, hint: `${MOD}D` })}
      {item(allHidden ? "Show" : "Hide", () => setAll({ hidden: !allHidden }), { disabled: none, hint: isMac ? "⇧⌘H" : "Ctrl+Shift+H" })}
      {item(allLocked ? "Unlock" : "Lock", () => setAll({ locked: !allLocked }), { disabled: none, hint: isMac ? "⇧⌘L" : "Ctrl+Shift+L" })}
      {touchesHeading && item(isHeadingShown(layout) ? "Hide the heading" : "Show the heading", () => onChange({ ...layout, showHeading: isHeadingShown(layout) ? false : undefined }))}
      <div className="le-ctx__sep" role="separator" />
      {item("Delete", remove, { disabled: none, danger: true, hint: isMac ? "⌫" : "Del" })}
    </div>,
    document.body,
  );
}
