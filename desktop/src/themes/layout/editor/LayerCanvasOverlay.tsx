/**
 * LayerCanvasOverlay — selection, move and resize on top of the live theme preview.
 *
 * It sits inside the scaled 1920×1080 preview canvas, next to the ThemeRenderer
 * host, and measures each layer from the renderer's own DOM ([data-layer-id]), so
 * boxes match what OBS draws (anchors, nested layers and auto-height text included).
 * Drags report a draft while the pointer moves and commit once on release.
 *
 * Like a design tool: Shift / Ctrl / Cmd-click adds or removes a layer from the selection, dragging
 * moves every selected layer together (snapping as one group), and right-click opens the layer menu.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ThemeLayer, ThemeLayout } from "../types";
import { isBackdropLayer, moveLayersPatches, nudgeLayer, unionRect, type LayerRect } from "./layoutOps";
import { snapRect, type SnapGap } from "./snapGuides";
import { PATTERN_GLOW_LAYER_ID, PATTERN_LAYER_ID } from "../backgroundPatterns";

type Rect = LayerRect;
export type LayerPatches = Record<string, Partial<ThemeLayer>>;

interface Props {
  /** Element that holds the renderer output (the scaled 1920×1080 canvas). */
  canvasRef: React.RefObject<HTMLElement | null>;
  layout: ThemeLayout;
  scale: number;
  /** Every selected layer; the last one is the one shown in the settings panel. */
  selectedIds: string[];
  /** Changes when the previewed content changes, to re-measure text boxes. */
  contentKey: string;
  /** `toggle`: add the layer to the selection, or take it out (Shift / Ctrl / Cmd-click). */
  onSelect: (id: string | null, mode?: "toggle") => void;
  /** Live update while dragging (not stored in history). */
  onDraft: (patches: LayerPatches) => void;
  /** Final values when the pointer is released. */
  onCommit: (patches: LayerPatches) => void;
  /** Right-click on a layer (screen coordinates). */
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Latest measured layer boxes (design pixels), for Auto-centre and alignment. */
  onRects?: (rects: Record<string, Rect>) => void;
}

type DragMode = "move" | "resize";

export default function LayerCanvasOverlay({ canvasRef, layout, scale, selectedIds, contentKey, onSelect, onDraft, onCommit, onContextMenu, onRects }: Props) {
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [guides, setGuides] = useState<{ x: number[]; y: number[]; gaps: SnapGap[] }>({ x: [], y: [], gaps: [] });
  const dragRef = useRef<{ ids: string[]; id: string; mode: DragMode; startX: number; startY: number; layout: ThemeLayout; layer: ThemeLayer; start: Rect | null; last: LayerPatches | null } | null>(null);
  const selectedSet = new Set(selectedIds);
  const single = selectedIds.length === 1 ? selectedIds[0] : null;
  useEffect(() => { onRects?.(rects); }, [rects, onRects]);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const s = scale || 1;
    const next: Record<string, Rect> = {};
    canvas.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((el) => {
      const id = el.dataset.layerId;
      if (!id || el.classList.contains("mtl-hidden")) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      next[id] = { x: (r.left - base.left) / s, y: (r.top - base.top) / s, w: r.width / s, h: r.height / s };
    });
    setRects(next);
  }, [canvasRef, scale]);

  // The renderer draws asynchronously (fonts, auto-fit), so measure a few times.
  useLayoutEffect(() => {
    measure();
    const timers = [60, 250, 700].map((ms) => window.setTimeout(measure, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [measure, layout, contentKey]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const startDrag = (e: ReactPointerEvent, layer: ThemeLayer, mode: DragMode) => {
    if (e.button !== 0) return; // right-click opens the menu instead
    e.stopPropagation();
    e.preventDefault();
    const additive = mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey);
    let ids: string[];
    if (additive) {
      // Add to (or take out of) the selection; drag the selection if the layer is now in it.
      const wasIn = selectedSet.has(layer.id);
      onSelect(layer.id, "toggle");
      if (wasIn) return;
      ids = [...selectedIds, layer.id];
    } else if (mode === "move" && selectedSet.has(layer.id) && selectedIds.length > 1) {
      ids = selectedIds; // keep the group and move it together
    } else {
      onSelect(layer.id);
      ids = [layer.id];
    }
    // The background is only selected (to open its settings); it never moves or resizes here.
    if (layer.locked || isBackdropLayer(layer)) return;
    const start = mode === "move" ? unionRect(ids.map((id) => rects[id]).filter(Boolean)) : rects[layer.id] ?? null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { ids, id: layer.id, mode, startX: e.clientX, startY: e.clientY, layout, layer, start, last: null };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const s = scale || 1;
    let dx = (e.clientX - d.startX) / s;
    let dy = (e.clientY - d.startY) / s;
    // Shift keeps the move straight (only when it is not being used to pick several layers).
    if (e.shiftKey && d.mode === "move" && d.ids.length === 1) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    // Snap to an 8 px grid unless Alt/Option is held.
    if (!e.altKey) {
      dx = Math.round(dx / 8) * 8;
      dy = Math.round(dy / 8) * 8;
    }
    // Smart guides: snap to the canvas centre / edges and to other layers (Alt/Option turns it off).
    if (!e.altKey && d.start) {
      const moving = d.mode === "move";
      const box = moving
        ? { x: d.start.x + dx, y: d.start.y + dy, w: d.start.w, h: d.start.h }
        : { x: d.start.x, y: d.start.y, w: d.start.w + dx, h: d.start.h + dy };
      const skip = new Set<string>(d.mode === "move" ? d.ids : [d.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const l of layout.layers) if (l.parentId && skip.has(l.parentId) && !skip.has(l.id)) { skip.add(l.id); grew = true; }
      }
      const others = layout.layers.filter((l) => !l.hidden && !skip.has(l.id) && rects[l.id]).map((l) => rects[l.id]);
      const snap = snapRect(box, others, {
        canvas: { w: 1920, h: 1080 },
        threshold: Math.min(20, Math.max(6, 6 / (scale || 1))),
        edgesX: moving ? undefined : ["end"],
        edgesY: moving ? undefined : ["end"],
        spacing: moving,
      });
      dx += snap.dx;
      dy += snap.dy;
      setGuides({ x: snap.guidesX, y: snap.guidesY, gaps: snap.gaps });
    }
    const patches: LayerPatches = d.mode === "move"
      ? moveLayersPatches(d.layout, d.ids, dx, dy)
      : { [d.id]: nudgeLayer(d.layer, 0, 0, dx, dy) };
    d.last = patches;
    onDraft(patches);
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setGuides({ x: [], y: [], gaps: [] });
    if (d?.last && Object.keys(d.last).length) onCommit(d.last);
  };

  const handle = 14 / (scale || 1);
  const stroke = Math.max(1.5, 2 / (scale || 1));

  return (
    <div
      className="le-overlay"
      style={{ position: "absolute", inset: 0, zIndex: 5 }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {layout.layers.map((layer) => {
        const r = rects[layer.id];
        if (!r || layer.hidden) return null;
        // The moving pattern and glow sit on top of the background; they are not parts to pick, so a click on them reaches the background.
        if (layer.id === PATTERN_LAYER_ID || layer.id === PATTERN_GLOW_LAYER_ID) return null;
        const selected = selectedSet.has(layer.id);
        const backdrop = isBackdropLayer(layer);
        return (
          <div
            key={layer.id}
            className={`le-box${selected ? " le-box--selected" : ""}${layer.locked ? " le-box--locked" : ""}${backdrop ? " le-box--backdrop" : ""}`}
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: Math.max(r.w, 6),
              height: Math.max(r.h, 6),
              outlineWidth: stroke,
              zIndex: backdrop ? 0 : selected ? 3 : 1,
            }}
            title={backdrop ? "Background (change it in Theme background)" : layer.name}
            onPointerDown={(e) => startDrag(e, layer, "move")}
            onContextMenu={(e) => {
              if (!onContextMenu) return;
              e.preventDefault();
              e.stopPropagation();
              if (!selected) onSelect(layer.id);
              onContextMenu(layer.id, e.clientX, e.clientY);
            }}
          >
            {single === layer.id && !layer.locked && !backdrop && (
              <span
                className="le-handle"
                style={{ width: handle, height: handle, right: -handle / 2, bottom: -handle / 2 }}
                onPointerDown={(e) => startDrag(e, layer, "resize")}
              />
            )}
          </div>
        );
      })}
      {selectedIds.length > 1 && (() => {
        // A dashed frame around the whole selection, so it reads as one group.
        const group = unionRect(selectedIds.map((id) => rects[id]).filter(Boolean));
        if (!group) return null;
        return <div className="le-group-frame" style={{ position: "absolute", left: group.x, top: group.y, width: group.w, height: group.h, outlineWidth: stroke, pointerEvents: "none", zIndex: 4 }} />;
      })()}
      {guides.x.map((x) => (
        <div key={`gx${x}`} className="le-guide" style={{ position: "absolute", left: x - stroke / 2, top: 0, width: stroke, height: 1080 }} />
      ))}
      {guides.gaps.map((g, i) => {
        const len = g.to - g.from;
        if (len < 1) return null;
        const tick = 14 / (scale || 1);
        const font = 13 / (scale || 1);
        const horizontal = g.axis === "x";
        return (
          <div key={`gap${i}`} className="le-gap" style={{ position: "absolute", pointerEvents: "none", zIndex: 6 }}>
            <div
              className="le-guide"
              style={horizontal
                ? { position: "absolute", left: g.from, top: g.cross - stroke / 2, width: len, height: stroke }
                : { position: "absolute", top: g.from, left: g.cross - stroke / 2, height: len, width: stroke }}
            />
            {[g.from, g.to].map((p) => (
              <div
                key={p}
                className="le-guide"
                style={horizontal
                  ? { position: "absolute", left: p - stroke / 2, top: g.cross - tick / 2, width: stroke, height: tick }
                  : { position: "absolute", top: p - stroke / 2, left: g.cross - tick / 2, height: stroke, width: tick }}
              />
            ))}
            <span
              className="le-gap-label"
              style={{
                position: "absolute",
                left: horizontal ? g.from + len / 2 : g.cross + tick,
                top: horizontal ? g.cross - tick - font : g.from + len / 2,
                transform: horizontal ? "translateX(-50%)" : "translateY(-50%)",
                fontSize: font,
                padding: `${font * 0.12}px ${font * 0.4}px`,
                borderRadius: font * 0.25,
              }}
            >
              {Math.round(len)}
            </span>
          </div>
        );
      })}
      {guides.y.map((y) => (
        <div key={`gy${y}`} className="le-guide" style={{ position: "absolute", top: y - stroke / 2, left: 0, height: stroke, width: 1920 }} />
      ))}
    </div>
  );
}
