/**
 * ScriptureArchPreview — draws the real Scripture Arch page (the same HTML OBS loads) scaled to
 * fit, with an optional camera picture behind the window. Mirrors ScriptureCirclePreview.tsx.
 * When `onMove` is given, the window can be dragged around the preview to place it.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { scriptureArchPanelParams, type ScriptureArchSettings } from "../multiview/scriptureArchLook";

export const SAMPLE_VERSE = {
  text: "What advantage then hath the Jew? or what profit is there of circumcision?",
  reference: "Romans 3:1 (KJV)",
};

function previewSrc(settings: ScriptureArchSettings): string {
  const query = new URLSearchParams({ tab: "bible", preview: "1" });
  for (const [key, value] of Object.entries(scriptureArchPanelParams(settings))) query.set(key, String(value));
  const packet = { live: true, slide: SAMPLE_VERSE };
  return `/mce-multiview-scripture-arch.html?${query}#data=${encodeURIComponent(JSON.stringify(packet))}`;
}

interface Props {
  settings: ScriptureArchSettings;
  cameraImage?: string | null;
  placeholder?: string;
  onMove?: (position: { x: number; y: number }) => void;
}

export default function ScriptureArchPreview({ settings, cameraImage, placeholder, onMove }: Props) {
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

  const { width, height } = settings.window;
  const { x, y } = dragPos ?? settings.window;
  const { zoom, focusX, focusY } = settings.camera;
  const src = previewSrc(settings);
  // An arch's corner radius equals half its width — the same shape the HTML page masks the hole to.
  const archRadius = width / 2;

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
      x: Math.min(1920 - width, Math.max(0, nextX)),
      y: Math.min(1080 - height, Math.max(0, nextY)),
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
          className={`scp__camera${dragPos ? " scp__camera--dragging" : ""}`}
          style={{ left: x, top: y, width, height, borderRadius: `${archRadius}px ${archRadius}px 18px 18px` }}
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
        <iframe key={src} className="scp__page" src={src} title="Scripture Arch preview" tabIndex={-1} />
        {onMove && (
          <div
            className={`scp__handle${dragPos ? " scp__handle--dragging" : ""}`}
            style={{ left: x, top: y, width, height, borderRadius: `${archRadius}px ${archRadius}px 18px 18px` }}
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
