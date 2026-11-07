/**
 * ScriptureCirclePreview — draws the real Scripture Circle page (the same HTML OBS loads) scaled to
 * fit, with an optional camera picture behind the window. One source of truth for how the look reads.
 * When `onMove` is given, the window can be dragged around the preview to place it. While dragging,
 * only the camera and an outline follow the pointer; the page itself is redrawn once on release.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { scriptureCirclePanelParams, type ScriptureCircleSettings } from "../multiview/scriptureCircleLook";

export const SAMPLE_VERSE = {
  text: "What advantage then hath the Jew? or what profit is there of circumcision?",
  reference: "Romans 3:1 (KJV)",
};

function previewSrc(settings: ScriptureCircleSettings): string {
  const query = new URLSearchParams({ tab: "bible", preview: "1" });
  for (const [key, value] of Object.entries(scriptureCirclePanelParams(settings))) query.set(key, String(value));
  const packet = { live: true, slide: SAMPLE_VERSE };
  return `/mce-multiview-scripture-circle.html?${query}#data=${encodeURIComponent(JSON.stringify(packet))}`;
}

interface Props {
  settings: ScriptureCircleSettings;
  /** A data: URL of the camera scene, shown inside the window. */
  cameraImage?: string | null;
  /** Shown inside the window when there is no camera picture yet. */
  placeholder?: string;
  /** Called with the window's new top-left (1920 × 1080 pixels) when a drag ends. */
  onMove?: (position: { x: number; y: number }) => void;
}

export default function ScriptureCirclePreview({ settings, cameraImage, placeholder, onMove }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [scale, setScale] = useState(0.4);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / 1920);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { diameter } = settings.circle;
  const { x, y } = dragPos ?? settings.circle;
  const { zoom, focusX, focusY } = settings.camera;
  const src = previewSrc(settings);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onMove) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, x, y };
  };
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || !onMove) return;
    const nextX = Math.round(start.x + (e.clientX - start.pointerX) / scale);
    const nextY = Math.round(start.y + (e.clientY - start.pointerY) / scale);
    setDragPos({
      x: Math.min(1920 - diameter, Math.max(0, nextX)),
      y: Math.min(1080 - diameter, Math.max(0, nextY)),
    });
  };
  const endDrag = () => {
    if (dragRef.current && dragPos && onMove) onMove(dragPos);
    dragRef.current = null;
    setDragPos(null);
  };

  return (
    <div ref={frameRef} className="scp">
      <div className="scp__stage" style={{ transform: `scale(${scale})` }}>
        <div
          className={`scp__camera${settings.shape === "box" ? " scp__camera--box" : ""}${dragPos ? " scp__camera--dragging" : ""}`}
          style={{ left: x, top: y, width: diameter, height: diameter }}
        >
          {cameraImage ? (
            <img
              src={cameraImage}
              alt=""
              style={{
                objectPosition: `${focusX}% ${focusY}%`,
                transform: `scale(${zoom})`,
                transformOrigin: `${focusX}% ${focusY}%`,
              }}
            />
          ) : placeholder && <span>{placeholder}</span>}
        </div>
        <iframe key={src} className="scp__page" src={src} title="Scripture Circle preview" tabIndex={-1} />
        {onMove && (
          <div
            className={`scp__handle${dragPos ? " scp__handle--dragging" : ""}${settings.shape === "box" ? " scp__handle--box" : ""}`}
            style={{ left: x, top: y, width: diameter, height: diameter }}
            title="Drag to move the camera window"
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
      </div>
    </div>
  );
}
