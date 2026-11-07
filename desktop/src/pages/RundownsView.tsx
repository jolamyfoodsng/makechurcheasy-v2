/**
 * RundownsView.tsx — StageTimer-style rundown editor (inside the Countdowns page).
 *
 * Operators build rundowns here (timers + messages, each timer using a saved
 * countdown design) and run them from the OBS Dock (Time → Rundown tab).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2, Zap, Bold } from "../components/icons/NativeIcons";
import { getCountdowns, syncCountdownsToDock } from "../countdowns/countdownStore";
import {
  createMessage,
  createRundown,
  createTimer,
  formatDuration,
  makeLive,
  newId,
  parseDuration,
  startLive,
} from "../countdowns/rundownEngine";
import {
  buildRundownPayload,
  resolveDesign,
  rundownBackgroundUrl,
  rundownOverlayUrl,
} from "../countdowns/rundownOverlay";
import { loadRundowns, saveRundowns } from "../countdowns/rundownStore";
import type {
  Rundown,
  RundownMessage,
  RundownMessageColor,
  RundownTimer,
  RundownTimerKind,
} from "../countdowns/rundownTypes";
import type { CountdownConfig } from "../countdowns/types";
import { getInAppPreviewBaseUrlSync, getOverlayBaseUrlSync, useLanDockBaseUrl } from "../services/overlayUrl";

// ── Small UI helpers ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 3,
  padding: "6px 8px",
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 4,
};

const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 3,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  padding: 0,
};

const MESSAGE_SWATCH: Record<RundownMessageColor, string> = {
  white: "#ffffff",
  green: "#4ade80",
  yellow: "#facc15",
  red: "#f87171",
};

function DurationInput({
  value,
  onCommit,
  disabled,
  placeholder = "mm:ss",
  ariaLabel,
}: {
  value: number;
  onCommit: (seconds: number) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(formatDuration(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatDuration(value));
  }, [value]);

  const commit = () => {
    const parsed = parseDuration(draft);
    if (parsed === null) {
      setDraft(formatDuration(value));
      return;
    }
    onCommit(parsed);
    setDraft(formatDuration(parsed));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { focusedRef.current = false; commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={{ ...inputStyle, opacity: disabled ? 0.4 : 1, fontVariantNumeric: "tabular-nums" }}
    />
  );
}

// ── Preview (real overlay in iframes, scaled down) ─────────────────────────

const PREVIEW_W = 440;

function RundownPreview({
  timer,
  design,
  rundown,
  level,
  message,
}: {
  timer: RundownTimer | null;
  design: CountdownConfig;
  rundown: Rundown;
  level: "green" | "yellow" | "red";
  message: RundownMessage | null;
}) {
  // In-app preview: this computer's address (the Wi-Fi one shows a white box in the app).
  const baseUrl = getInAppPreviewBaseUrlSync();
  const urls = useMemo(() => {
    if (!timer) return null;
    const single: Rundown = { ...rundown, timers: [timer] };
    let live = startLive(makeLive(single, 0, 0), 0);
    live = { ...live, status: "paused", message };
    if (timer.kind === "countdown") {
      live.value = level === "green" ? timer.durationSeconds : level === "yellow" ? Math.max(1, timer.warnYellowSeconds) : Math.max(1, timer.warnRedSeconds);
    } else if (timer.kind === "countup") {
      const cap = timer.durationSeconds;
      live.value = cap > 0 ? (level === "green" ? 0 : level === "yellow" ? cap - Math.max(1, timer.warnYellowSeconds) : cap - Math.max(1, timer.warnRedSeconds)) : 0;
    }
    const payload = buildRundownPayload(live, design, baseUrl, { reveal: false, now: 0 });
    return {
      overlay: rundownOverlayUrl(payload, baseUrl),
      bg: rundownBackgroundUrl(design, baseUrl, 0),
    };
  }, [timer, design, rundown, level, message, baseUrl]);

  const scale = PREVIEW_W / 1920;
  return (
    <div style={{ width: PREVIEW_W, height: 1080 * scale, position: "relative", overflow: "hidden", borderRadius: 10, border: "1px solid var(--border)", background: "#000" }}>
      {urls && (
        <>
          <iframe
            key={urls.bg}
            title="Rundown background preview"
            src={urls.bg}
            style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, border: "none", transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }}
          />
          <iframe
            title="Rundown timer preview"
            src={urls.overlay}
            style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, border: "none", transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", background: "transparent" }}
          />
        </>
      )}
    </div>
  );
}

// ── Timer row ──────────────────────────────────────────────────────────────

/** Shared column layout for the timer table header and rows. */
const TIMER_COLUMNS = "22px minmax(110px, 1.6fr) 104px 72px 64px 64px minmax(100px, 1.2fr) 82px";

function TimerHeader() {
  const head: React.CSSProperties = { ...labelStyle, marginBottom: 0 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: TIMER_COLUMNS, gap: 6, padding: "0 8px 4px" }}>
      <span style={head}>#</span>
      <span style={head}>Name</span>
      <span style={head}>Type</span>
      <span style={head}>Length</span>
      <span style={head}>Yellow</span>
      <span style={head}>Red</span>
      <span style={head}>Design</span>
      <span />
    </div>
  );
}

function TimerCard({
  timer,
  index,
  count,
  designs,
  selected,
  onSelect,
  onChange,
  onMove,
  onDelete,
}: {
  timer: RundownTimer;
  index: number;
  count: number;
  designs: CountdownConfig[];
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<RundownTimer>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const isClock = timer.kind === "timeofday";
  const hasDesign = !timer.designId || designs.some((d) => d.id === timer.designId);
  return (
    <div
      onClick={onSelect}
      style={{
        border: `1px solid ${selected ? "var(--primary)" : "var(--border)"}`,
        background: selected ? "var(--primary-soft)" : "var(--surface)",
        borderRadius: 3,
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: TIMER_COLUMNS, gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "center" }}>{index + 1}</span>
        <input aria-label="Timer name" value={timer.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Timer name" style={{ ...inputStyle, fontWeight: 600 }} />
        <select aria-label="Type" value={timer.kind} onChange={(e) => onChange({ kind: e.target.value as RundownTimerKind })} style={inputStyle}>
          <option value="countdown">Countdown</option>
          <option value="countup">Count up</option>
          <option value="timeofday">Time of day</option>
        </select>
        <DurationInput ariaLabel={timer.kind === "countup" ? "Limit (optional)" : "Duration"} value={timer.durationSeconds} disabled={isClock} onCommit={(sec) => onChange({ durationSeconds: sec })} />
        <DurationInput ariaLabel="Yellow warning" value={timer.warnYellowSeconds} disabled={isClock} onCommit={(sec) => onChange({ warnYellowSeconds: sec })} />
        <DurationInput ariaLabel="Red warning" value={timer.warnRedSeconds} disabled={isClock} onCommit={(sec) => onChange({ warnRedSeconds: sec })} />
        <select aria-label="Design" value={hasDesign ? timer.designId ?? "" : ""} onChange={(e) => onChange({ designId: e.target.value || null })} style={inputStyle}>
          <option value="">Default look</option>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>{d.title || "Untitled design"}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <button type="button" title="Move up" aria-label="Move timer up" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMove(-1); }} style={{ ...iconBtn, border: "none", opacity: index === 0 ? 0.3 : 1 }}><ChevronUp size={14} /></button>
          <button type="button" title="Move down" aria-label="Move timer down" disabled={index === count - 1} onClick={(e) => { e.stopPropagation(); onMove(1); }} style={{ ...iconBtn, border: "none", opacity: index === count - 1 ? 0.3 : 1 }}><ChevronDown size={14} /></button>
          <button type="button" title="Delete timer" aria-label="Delete timer" onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...iconBtn, border: "none", color: "var(--error)" }}><Trash2 size={13} /></button>
        </div>
      </div>

      {selected && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 28 }}>
          <input aria-label="Speaker" value={timer.speaker} onChange={(e) => onChange({ speaker: e.target.value })} placeholder="Speaker (optional)" style={{ ...inputStyle, maxWidth: 240 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: timer.kind === "countdown" ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={timer.autoNext} disabled={timer.kind !== "countdown"} onChange={(e) => onChange({ autoNext: e.target.checked })} />
            Start the next timer at zero
          </label>
        </div>
      )}
    </div>
  );
}

// ── Presenter link ─────────────────────────────────────────────────────────

function PresenterLink() {
  const lanBase = useLanDockBaseUrl();
  const [copied, setCopied] = useState(false);
  const base = lanBase || getOverlayBaseUrlSync();
  const url = `${base}/rundown-presenter.html`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const open = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div style={{ maxWidth: PREVIEW_W, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Presenter screen</div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.45 }}>
        Open this link on a monitor, tablet or phone on the same Wi-Fi. The speaker sees the running timer, the next timer and your messages.
      </p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Presenter link" style={{ ...inputStyle, fontSize: 12 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => void copy()} style={{ ...iconBtn, width: "auto", padding: "0 12px", gap: 6, fontSize: 12.5, color: "var(--text-primary)" }}><Copy size={13} /> {copied ? "Copied" : "Copy link"}</button>
        <button type="button" onClick={() => void open()} style={{ ...iconBtn, width: "auto", padding: "0 12px", fontSize: 12.5, color: "var(--text-primary)" }}>Open</button>
      </div>
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────

export default function RundownsView() {
  const [rundowns, setRundowns] = useState<Rundown[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [designs, setDesigns] = useState<CountdownConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(null);
  const [previewLevel, setPreviewLevel] = useState<"green" | "yellow" | "red">("green");
  const [previewMessageId, setPreviewMessageId] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  // Load rundowns + saved designs, and make sure the Dock has the designs file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [snap, cds] = await Promise.all([loadRundowns(), getCountdowns().catch(() => [] as CountdownConfig[])]);
      if (cancelled) return;
      let list = snap.rundowns;
      if (list.length === 0) {
        list = [createRundown()];
        dirtyRef.current = true;
      }
      setRundowns(list);
      setActiveId(list[0].id);
      setDesigns(cds);
      setLoaded(true);
      void syncCountdownsToDock();
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save after edits.
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const handle = window.setTimeout(() => {
      dirtyRef.current = false;
      void saveRundowns(rundowns);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [rundowns, loaded]);

  // Flush pending edits when leaving the page.
  const latestRef = useRef<Rundown[]>(rundowns);
  latestRef.current = rundowns;
  useEffect(() => () => {
    if (dirtyRef.current) {
      dirtyRef.current = false;
      void saveRundowns(latestRef.current);
    }
  }, []);

  const mutate = useCallback((fn: (list: Rundown[]) => Rundown[]) => {
    dirtyRef.current = true;
    setRundowns((prev) => fn(prev));
  }, []);

  const active = rundowns.find((r) => r.id === activeId) ?? null;

  const patchActive = useCallback((patch: Partial<Rundown>) => {
    mutate((list) => list.map((r) => (r.id === activeId ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r)));
  }, [activeId, mutate]);

  const patchTimer = useCallback((id: string, patch: Partial<RundownTimer>) => {
    if (!active) return;
    patchActive({ timers: active.timers.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }, [active, patchActive]);

  const patchMessage = useCallback((id: string, patch: Partial<RundownMessage>) => {
    if (!active) return;
    patchActive({ messages: active.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }, [active, patchActive]);

  const handleNewRundown = useCallback(() => {
    const rd = createRundown("New rundown");
    rd.timers = [createTimer({ name: "Timer 1" })];
    mutate((list) => [rd, ...list]);
    setActiveId(rd.id);
    setSelectedTimerId(null);
  }, [mutate]);

  const handleDuplicate = useCallback((rd: Rundown) => {
    const now = new Date().toISOString();
    const copy: Rundown = {
      ...rd,
      id: newId("rd"),
      name: `${rd.name} (Copy)`,
      timers: rd.timers.map((t) => ({ ...t, id: newId("tm") })),
      messages: rd.messages.map((m) => ({ ...m, id: newId("msg") })),
      createdAt: now,
      updatedAt: now,
    };
    mutate((list) => [copy, ...list]);
    setActiveId(copy.id);
  }, [mutate]);

  const handleDelete = useCallback((rd: Rundown) => {
    if (!window.confirm(`Delete rundown "${rd.name}"?`)) return;
    mutate((list) => {
      const next = list.filter((r) => r.id !== rd.id);
      if (activeId === rd.id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId, mutate]);

  const moveTimer = (index: number, delta: -1 | 1) => {
    if (!active) return;
    const timers = [...active.timers];
    const target = index + delta;
    if (target < 0 || target >= timers.length) return;
    [timers[index], timers[target]] = [timers[target], timers[index]];
    patchActive({ timers });
  };

  const selectedTimer = active?.timers.find((t) => t.id === selectedTimerId) ?? active?.timers[0] ?? null;
  const previewDesign = resolveDesign(selectedTimer?.designId, designs);
  const previewMessage = active?.messages.find((m) => m.id === previewMessageId) ?? null;

  if (!loaded) {
    return <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading rundowns...</div>;
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Sidebar ── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 750, color: "var(--text-primary)", marginBottom: 12 }}>My Rundowns</h3>
          <button onClick={handleNewRundown} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0", background: "var(--primary)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>
            <Plus size={16} /> New Rundown
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {rundowns.map((rd) => (
            <div
              key={rd.id}
              onClick={() => { setActiveId(rd.id); setSelectedTimerId(null); }}
              style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${rd.id === activeId ? "var(--primary)" : "transparent"}`, background: rd.id === activeId ? "var(--primary-soft)" : "transparent" }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rd.name || "Untitled"}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                {rd.timers.length} timer{rd.timers.length === 1 ? "" : "s"} · {formatDuration(rd.timers.reduce((sum, t) => sum + (t.kind === "countdown" ? t.durationSeconds : 0), 0))} total
              </div>
              {rd.id === activeId && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDuplicate(rd); }} style={{ ...iconBtn, width: "auto", padding: "0 8px", gap: 5, fontSize: 11.5 }}><Copy size={12} /> Duplicate</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(rd); }} style={{ ...iconBtn, width: "auto", padding: "0 8px", gap: 5, fontSize: 11.5, color: "var(--error)" }}><Trash2 size={12} /> Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Editor ── */}
      {!active ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>Create a rundown to get started.</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 240px" }}>
                  <label style={labelStyle}>Rundown name</label>
                  <input value={active.name} onChange={(e) => patchActive({ name: e.target.value })} style={{ ...inputStyle, fontSize: 15, fontWeight: 700 }} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-primary)", paddingBottom: 8 }}>
                  <input type="checkbox" checked={active.showProgressBar} onChange={(e) => patchActive({ showProgressBar: e.target.checked })} />
                  Show progress bar
                </label>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                Build your timers here, then run them from the OBS Dock: <b>Time → Rundown</b>. Colours go green, yellow, then red as time runs out. Designs come from the <b>Designs</b> tab.
              </p>

              <section>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 750, color: "var(--text-primary)" }}>Timers</h4>
                  <button type="button" onClick={() => { const t = createTimer({ name: `Timer ${active.timers.length + 1}` }); patchActive({ timers: [...active.timers, t] }); setSelectedTimerId(t.id); }} style={{ ...iconBtn, width: "auto", padding: "0 12px", gap: 6, fontSize: 12.5, color: "var(--text-primary)" }}><Plus size={14} /> Add timer</button>
                </div>
                {active.timers.length > 0 && <TimerHeader />}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {active.timers.length === 0 && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>No timers yet. Add your first one.</div>}
                  {active.timers.map((t, i) => (
                    <TimerCard
                      key={t.id}
                      timer={t}
                      index={i}
                      count={active.timers.length}
                      designs={designs}
                      selected={selectedTimer?.id === t.id}
                      onSelect={() => setSelectedTimerId(t.id)}
                      onChange={(patch) => patchTimer(t.id, patch)}
                      onMove={(d) => moveTimer(i, d)}
                      onDelete={() => patchActive({ timers: active.timers.filter((x) => x.id !== t.id) })}
                    />
                  ))}
                </div>
              </section>

              <section>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 750, color: "var(--text-primary)" }}>Messages</h4>
                  <button type="button" onClick={() => patchActive({ messages: [...active.messages, createMessage()] })} style={{ ...iconBtn, width: "auto", padding: "0 12px", gap: 6, fontSize: 12.5, color: "var(--text-primary)" }}><Plus size={14} /> Add message</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {active.messages.map((m) => (
                    <div key={m.id} onClick={() => setPreviewMessageId(previewMessageId === m.id ? null : m.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 9, border: `1px solid ${previewMessageId === m.id ? "var(--primary)" : "var(--border)"}`, background: "var(--surface)" }}>
                      <input aria-label="Message text" value={m.text} onClick={(e) => e.stopPropagation()} onChange={(e) => patchMessage(m.id, { text: e.target.value })} style={{ ...inputStyle, flex: 1, color: MESSAGE_SWATCH[m.color], fontWeight: m.bold ? 800 : 500 }} />
                      {(Object.keys(MESSAGE_SWATCH) as RundownMessageColor[]).map((c) => (
                        <button key={c} type="button" title={c} aria-label={`${c} text`} onClick={(e) => { e.stopPropagation(); patchMessage(m.id, { color: c }); }} style={{ width: 22, height: 22, borderRadius: 11, background: MESSAGE_SWATCH[c], border: m.color === c ? "2px solid var(--primary)" : "2px solid transparent", outline: "1px solid var(--border-strong)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
                      ))}
                      <button type="button" title="Bold" aria-label="Bold" onClick={(e) => { e.stopPropagation(); patchMessage(m.id, { bold: !m.bold }); }} style={{ ...iconBtn, background: m.bold ? "var(--primary)" : "transparent", color: m.bold ? "#fff" : "var(--text-primary)" }}><Bold size={14} /></button>
                      <button type="button" title="Flash" aria-label="Flash" onClick={(e) => { e.stopPropagation(); patchMessage(m.id, { flash: !m.flash }); }} style={{ ...iconBtn, background: m.flash ? "var(--primary)" : "transparent", color: m.flash ? "#fff" : "var(--text-primary)" }}><Zap size={14} /></button>
                      <button type="button" title="Delete message" aria-label="Delete message" onClick={(e) => { e.stopPropagation(); patchActive({ messages: active.messages.filter((x) => x.id !== m.id) }); }} style={{ ...iconBtn, color: "var(--error)" }}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {active.messages.length === 0 && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>No messages yet. Messages are quick notes you can show to the speaker from the Dock.</div>}
                </div>
              </section>
            </div>

            {/* ── Preview ── */}
            <div style={{ flex: "0 0 auto", position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={labelStyle}>Preview{selectedTimer ? ` — ${selectedTimer.name || "Timer"}` : ""}</label>
              <RundownPreview timer={selectedTimer} design={previewDesign} rundown={active} level={previewLevel} message={previewMessage} />
              <div style={{ display: "flex", gap: 6 }}>
                {(["green", "yellow", "red"] as const).map((lv) => (
                  <button key={lv} type="button" onClick={() => setPreviewLevel(lv)} style={{ ...iconBtn, width: "auto", padding: "0 12px", fontSize: 12, textTransform: "capitalize", color: previewLevel === lv ? "#fff" : "var(--text-primary)", background: previewLevel === lv ? { green: "#15803d", yellow: "#a16207", red: "#b91c1c" }[lv] : "transparent" }}>{lv}</button>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--text-secondary)", margin: 0, maxWidth: PREVIEW_W }}>Click a timer to preview it. Click a message to preview it on screen.</p>
              <PresenterLink />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
