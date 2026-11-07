/**
 * CountdownLayerEditor — edits a countdown that is a layer design.
 *
 * Same canvas, layer list and inspector as the Themes editor, plus a Timer tab
 * (length, warning times, texts). One design works for countdowns, count-ups,
 * clocks and rundown timers; the preview bar lets you try each.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Pause, Play, Redo2, Save, Send, Undo2 } from "../components/icons/NativeIcons";
import ThemeLayoutPreview from "../themes/layout/ThemeLayoutPreview";
import LayerPanel from "../themes/layout/editor/LayerPanel";
import LayerCanvasOverlay from "../themes/layout/editor/LayerCanvasOverlay";
import { applyLayerPatches, getLayer, nudgeLayer, removeLayer, updateLayer } from "../themes/layout/editor/layoutOps";
import type { ThemeLayout } from "../themes/layout/types";
import { getAllMedia } from "../library/libraryDb";
import type { MediaItem } from "../library/libraryTypes";
import { getOverlayBaseUrl, resolveOverlayAssetUrl } from "../services/overlayUrl";
import { obsService } from "../services/obsService";
import { sendCountdownToObs } from "./countdownObsService";
import { attachLayoutMode } from "./layoutMode";
import { buildCountdownContent } from "./countdownTime";
import { formatDuration, parseDuration } from "./rundownEngine";
import type { RundownTimerKind } from "./rundownTypes";
import type { CountdownConfig } from "./types";

interface Props {
  design: CountdownConfig & { layout: ThemeLayout };
  onChange: (updates: Partial<CountdownConfig>) => void;
}

type Tab = "design" | "timer";

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 12, color: "var(--text-muted)" };
const input: React.CSSProperties = { height: 34, padding: "0 10px", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 8, fontSize: 13, color: "var(--text-primary)", outline: "none", width: "100%" };
const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer" };

function mediaSrc(item: MediaItem): string {
  if (item.url) return item.url;
  if (item.filePath) return resolveOverlayAssetUrl(item.filePath);
  return "";
}

/** Time field that accepts "5", "5:30" or "1:02:00" and commits on blur. */
function DurationInput({ value, onCommit, allowZero }: { value: number; onCommit: (seconds: number) => void; allowZero?: boolean }) {
  const [text, setText] = useState(formatDuration(value));
  useEffect(() => setText(formatDuration(value)), [value]);
  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed === null || (!allowZero && parsed <= 0)) {
      setText(formatDuration(value));
      return;
    }
    onCommit(parsed);
  };
  return (
    <input
      style={input}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export default function CountdownLayerEditor({ design, onChange }: Props) {
  const layout = design.layout;
  const [tab, setTab] = useState<Tab>("design");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ThemeLayout | null>(null);
  const [undoStack, setUndoStack] = useState<ThemeLayout[]>([]);
  const [redoStack, setRedoStack] = useState<ThemeLayout[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Preview state (not saved with the design)
  const duration = design.timer.durationSeconds > 0 ? design.timer.durationSeconds : 300;
  const [kind, setKind] = useState<RundownTimerKind>("countdown");
  const [value, setValue] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setScale(Math.max(0.05, Math.min((r.width - 32) / 1920, (r.height - 32) / 1080)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    getAllMedia().then(setMedia).catch(() => undefined);
  }, []);

  // Changing the design (another list item) resets the editor's own state.
  useEffect(() => {
    setSelectedId(null);
    setDraft(null);
    setUndoStack([]);
    setRedoStack([]);
    setValue(kind === "countdown" ? duration : 0);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.id]);

  useEffect(() => {
    setValue(kind === "countdown" ? duration : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, duration]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setClock(new Date());
      setValue((v) => {
        if (kind === "countdown") return v <= 0 ? duration : v - 1;
        if (kind === "countup") return v >= duration ? 0 : v + 1;
        return v;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, kind, duration]);

  const yellow = design.warnYellowSeconds ?? 0;
  const red = design.warnRedSeconds ?? 0;

  const content = useMemo(
    () =>
      buildCountdownContent({
        kind,
        value,
        durationSeconds: duration,
        warnYellowSeconds: yellow,
        warnRedSeconds: red,
        title: design.text.title,
        subtitle: design.text.subtitle,
        name: design.text.title,
        speaker: "Speaker name",
        message: design.message?.text ?? "",
        now: clock,
      }),
    [kind, value, duration, yellow, red, design.text.title, design.text.subtitle, design.message?.text, clock],
  );

  const previewLayout = draft ?? layout;

  const commit = useCallback(
    (next: ThemeLayout) => {
      setDraft(null);
      setUndoStack((s) => [...s.slice(-49), layout]);
      setRedoStack([]);
      onChange({ layout: next });
    },
    [layout, onChange],
  );

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => [...r, layout]);
      onChange({ layout: prev });
      return s.slice(0, -1);
    });
  }, [layout, onChange]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setUndoStack((s) => [...s, layout]);
      onChange({ layout: next });
      return r.slice(0, -1);
    });
  }, [layout, onChange]);

  // Drop the selection when its layer is gone.
  useEffect(() => {
    if (selectedId && !getLayer(layout, selectedId)) setSelectedId(null);
  }, [layout, selectedId]);

  // Arrow keys nudge (Shift = 10 px), Delete removes, Cmd/Ctrl+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!selectedId) return;
      const layer = getLayer(layout, selectedId);
      if (!layer) return;
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        if (layer.locked) return;
        e.preventDefault();
        const [dx, dy] = moves[e.key];
        commit(updateLayer(layout, layer.id, nudgeLayer(layer, dx, dy)));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        commit(removeLayer(layout, layer.id));
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, selectedId, commit, undo, redo]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 4000);
  };

  const handleSave = () => {
    onChange({});
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const handleObs = async (live: boolean) => {
    try {
      if (!obsService.isConnected) throw new Error("OBS is not connected. Connect OBS first (top bar), then try again.");
      await sendCountdownToObs(design, live, { paused: false, remaining: duration });
      flash(live ? "Added to OBS Program. It is counting down now." : "Added to OBS Preview. It is counting down now.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not reach OBS.");
    }
  };

  const handleCopyLink = async () => {
    try {
      const baseUrl = await getOverlayBaseUrl();
      const payload = attachLayoutMode({ config: design, baseUrl, timestamp: Date.now(), sync: { paused: false, remaining: duration }, reveal: true });
      const url = `${baseUrl}/countdown-overlay.html#data=${encodeURIComponent(JSON.stringify(payload))}`;
      await navigator.clipboard.writeText(url);
      flash("Link copied. In OBS add a Browser source and paste it as the URL (1920×1080).");
    } catch {
      flash("Could not copy the link.");
    }
  };

  const levelButtons: Array<{ label: string; seconds: number | null }> = [
    { label: "Normal", seconds: duration },
    { label: "Warning", seconds: yellow > 0 ? yellow : null },
    { label: "Almost up", seconds: red > 0 ? red : null },
    { label: "Time's up", seconds: 0 },
  ];

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0, height: "100%", overflow: "hidden" }}>
      {/* ── Canvas ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
          <input
            value={design.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Countdown name…"
            style={{ background: "transparent", border: "none", fontSize: 15, fontWeight: 700, color: "var(--text-primary)", outline: "none", minWidth: 160, flex: "1 1 160px" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...btn, opacity: undoStack.length ? 1 : 0.4 }} disabled={!undoStack.length} onClick={undo} title="Undo"><Undo2 size={14} /></button>
            <button type="button" style={{ ...btn, opacity: redoStack.length ? 1 : 0.4 }} disabled={!redoStack.length} onClick={redo} title="Redo"><Redo2 size={14} /></button>
            <button type="button" style={btn} onClick={handleSave}><Save size={14} /> {saved ? "Saved" : "Save"}</button>
            <button type="button" style={btn} onClick={handleCopyLink} title="Copy a link to paste into an OBS Browser source"><Link2 size={14} /> Copy OBS link</button>
            <button type="button" style={btn} onClick={() => handleObs(false)} title="Add to the OBS Preview scene"><Send size={14} /> To OBS Preview</button>
            <button type="button" style={{ ...btn, background: "var(--primary)", border: "none", color: "#fff" }} onClick={() => handleObs(true)} title="Add to the live OBS Program scene"><Send size={14} /> To OBS Program</button>
          </div>
        </div>

        <div ref={stageRef} style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", overflow: "hidden" }}>
          <div
            style={{
              width: Math.round(1920 * scale),
              height: Math.round(1080 * scale),
              position: "relative",
              borderRadius: 6,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
              background: "repeating-conic-gradient(#2a2d38 0% 25%, #20232d 0% 50%) 0 0 / 24px 24px",
              flexShrink: 0,
            }}
            onClick={() => setSelectedId(null)}
          >
            <div
              ref={canvasRef}
              style={{ width: 1920, height: 1080, position: "absolute", top: 0, left: 0, transformOrigin: "top left", transform: `scale(${scale})` }}
            >
              <ThemeLayoutPreview layout={previewLayout} content={content} style={{ width: 1920, height: 1080 }} />
              <LayerCanvasOverlay
                canvasRef={canvasRef}
                layout={previewLayout}
                scale={scale}
                selectedIds={selectedId ? [selectedId] : []}
                contentKey={`${design.id}-${kind}`}
                onSelect={(id) => setSelectedId(id)}
                onDraft={(patches) => setDraft(applyLayerPatches(layout, patches))}
                onCommit={(patches) => commit(applyLayerPatches(layout, patches))}
              />
            </div>
          </div>
        </div>

        {/* Preview bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
          <button type="button" style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Preview</>}</button>
          <div style={{ display: "flex", gap: 4 }}>
            {([["countdown", "Countdown"], ["countup", "Count up"], ["timeofday", "Clock"]] as Array<[RundownTimerKind, string]>).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)} style={{ ...btn, padding: "6px 10px", background: kind === k ? "var(--primary-soft)" : "transparent", borderColor: kind === k ? "var(--primary)" : "var(--border)" }}>{label}</button>
            ))}
          </div>
          {kind !== "timeofday" && (
            <>
              <input
                type="range"
                min={0}
                max={duration}
                value={Math.min(value, duration)}
                onChange={(e) => { setPlaying(false); setValue(Number(e.target.value)); }}
                style={{ flex: "1 1 160px", minWidth: 120 }}
                aria-label="Preview time"
              />
              <div style={{ display: "flex", gap: 4 }}>
                {levelButtons.map((l) => (
                  <button key={l.label} type="button" disabled={l.seconds === null} onClick={() => { setPlaying(false); setValue(kind === "countdown" ? (l.seconds ?? 0) : duration - (l.seconds ?? 0)); }}
                    style={{ ...btn, padding: "6px 10px", opacity: l.seconds === null ? 0.35 : 1 }}>{l.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
        {notice && <div style={{ padding: "8px 16px", fontSize: 13, color: "var(--text-primary)", background: "var(--surface-raised)", borderTop: "1px solid var(--border)" }}>{notice}</div>}
      </div>

      {/* ── Right panel ── */}
      <div style={{ width: 340, flexShrink: 0, borderLeft: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 3, padding: 8, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {([["design", "Design"], ["timer", "Timer & text"]] as Array<[Tab, string]>).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              style={{ flex: 1, padding: "8px 0", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: tab === k ? "var(--surface-raised)" : "transparent", color: tab === k ? "var(--text-primary)" : "var(--text-muted)" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {tab === "design" ? (
            <LayerPanel
              layout={layout}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={commit}
              mediaItems={media}
              mediaPreviewSrc={(item) => mediaSrc(item as MediaItem)}
            />
          ) : (
            <>
              <label style={field}>
                <span>Title</span>
                <input style={input} value={design.text.title} onChange={(e) => onChange({ text: { ...design.text, title: e.target.value } })} />
              </label>
              <label style={field}>
                <span>Subtitle</span>
                <input style={input} value={design.text.subtitle} onChange={(e) => onChange({ text: { ...design.text, subtitle: e.target.value } })} />
              </label>
              <label style={field}>
                <span>Message (optional)</span>
                <input style={input} value={design.message?.text ?? ""} placeholder="Shown where a layer displays “Message”"
                  onChange={(e) => onChange({ message: { text: e.target.value, color: design.message?.color ?? "#ffffff", position: design.message?.position } })} />
              </label>
              <div style={{ ...field, marginBottom: 6 }}><span>Length (min:sec, or h:mm:ss)</span></div>
              <div style={{ marginBottom: 12 }}>
                <DurationInput value={design.timer.durationSeconds} onCommit={(s) => onChange({ timer: { ...design.timer, mode: "fixed-duration", durationSeconds: s, showHours: s >= 3600 } })} />
              </div>
              <div style={{ ...field, marginBottom: 6 }}><span>Turn yellow when this much time is left (0 = off)</span></div>
              <div style={{ marginBottom: 12 }}>
                <DurationInput allowZero value={yellow} onCommit={(s) => onChange({ warnYellowSeconds: s })} />
              </div>
              <div style={{ ...field, marginBottom: 6 }}><span>Turn red when this much time is left (0 = off)</span></div>
              <div style={{ marginBottom: 12 }}>
                <DurationInput allowZero value={red} onCommit={(s) => onChange({ warnRedSeconds: s })} />
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
                Parts of the design change colour at these times when “Follows timer level” is on for that layer (Design tab).
              </p>
              <label style={field}>
                <span>When it reaches zero</span>
                <select
                  style={{ ...input, appearance: "none" }}
                  value={design.obs.autoAction}
                  onChange={(e) => onChange({ obs: { ...design.obs, autoAction: e.target.value as CountdownConfig["obs"]["autoAction"] } })}
                >
                  <option value="none">Do nothing</option>
                  <option value="switch-scene">Switch OBS scene</option>
                  <option value="hide-countdown">Hide countdown</option>
                </select>
              </label>
              {design.obs.autoAction === "switch-scene" && (
                <label style={field}>
                  <span>Scene name</span>
                  <input style={input} value={design.obs.autoActionScene} placeholder="Main Scene"
                    onChange={(e) => onChange({ obs: { ...design.obs, autoActionScene: e.target.value } })} />
                </label>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
