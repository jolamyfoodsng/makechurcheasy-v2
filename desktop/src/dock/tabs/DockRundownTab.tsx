/**
 * DockRundownTab.tsx — run a StageTimer-style rundown from the OBS Dock.
 *
 * Rundowns are built in the app (Countdowns → Rundowns) and read from the
 * shared Dock data file. Live state is a time snapshot, so the OBS overlay and
 * the presenter screen compute the running time themselves; we only push when
 * the operator changes something (start, pause, next, ±time, message).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../DockIcon";
import { dockObsClient } from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import { isPresentationLinkTarget, type DockPresentationOutputTarget } from "../dockPresentationTarget";
import { useDockSceneRoute } from "../dockSceneRouting";
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import {
  MESSAGE_COLORS,
  WARN_COLORS,
  adjustLive,
  createMessage,
  currentValue,
  displayText,
  goToTimer,
  makeLive,
  pauseLive,
  progressFraction,
  resetLive,
  shouldAutoAdvance,
  startLive,
  warnLevel,
  setMessage,
  formatDuration,
} from "../../countdowns/rundownEngine";
import { buildRundownPayload, resolveDesign, rundownBackgroundUrl, rundownOverlayUrl } from "../../countdowns/rundownOverlay";
import { loadRundowns } from "../../countdowns/rundownStore";
import type { Rundown, RundownLiveState, RundownMessage } from "../../countdowns/rundownTypes";
import type { CountdownConfig } from "../../countdowns/types";
import {
  applyPresentationVisibility,
  ensureRundownSource,
  hideRundownSource,
  resolveRundownTargets,
  targetsIncludePresentationContent,
} from "./rundownObs";

const LIVE_KEY = "mce-dock-rundown-live-v1";
const SELECTED_KEY = "mce-dock-rundown-selected-v1";

interface PersistedLive {
  live: RundownLiveState;
  onStream: boolean;
}

function readPersisted(): PersistedLive | null {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLive;
    return parsed && parsed.live && parsed.live.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writePersisted(value: PersistedLive | null): void {
  try {
    if (value) localStorage.setItem(LIVE_KEY, JSON.stringify(value));
    else localStorage.removeItem(LIVE_KEY);
  } catch { /* ignore */ }
}

function postRelay(state: RundownLiveState | null): void {
  fetch("/api/rundown-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state ?? {}),
  }).catch(() => { /* relay unavailable (dev) */ });
}

async function loadDesigns(): Promise<CountdownConfig[]> {
  try {
    const res = await fetch(`/uploads/dock-countdowns.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { countdowns?: CountdownConfig[] };
    return Array.isArray(data.countdowns) ? data.countdowns : [];
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  minHeight: 28,
  padding: "4px 10px",
  borderRadius: 7,
  border: "1px solid var(--dock-border, var(--border))",
  background: "var(--dock-surface, var(--surface))",
  color: "var(--dock-text, var(--text-primary))",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};

export default function DockRundownTab({
  presentationOutputTarget = "obs",
}: {
  presentationOutputTarget?: DockPresentationOutputTarget;
} = {}) {
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const [sceneRoute] = useDockSceneRoute("countdown");
  const [rundowns, setRundowns] = useState<Rundown[]>([]);
  const [designs, setDesigns] = useState<CountdownConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const persisted = useMemo(readPersisted, []);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
  });
  const [live, setLive] = useState<RundownLiveState | null>(persisted?.live ?? null);
  const [onStream, setOnStream] = useState<boolean>(persisted?.onStream ?? false);
  const [now, setNow] = useState(() => Date.now());
  const [customText, setCustomText] = useState("");
  const [notice, setNotice] = useState("");

  const liveRef = useRef(live);
  const onStreamRef = useRef(onStream);
  const designsRef = useRef(designs);
  const rundownsRef = useRef(rundowns);
  const sceneRouteRef = useRef(sceneRoute);
  const pushChainRef = useRef<Promise<void>>(Promise.resolve());
  liveRef.current = live;
  onStreamRef.current = onStream;
  designsRef.current = designs;
  rundownsRef.current = rundowns;
  sceneRouteRef.current = sceneRoute;

  // ── Data loading ─────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    const [snap, cds] = await Promise.all([loadRundowns(), loadDesigns()]);
    setRundowns(snap.rundowns);
    setDesigns(cds);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 10_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Display tick (the overlay/presenter compute time themselves).
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  // ── OBS push (serialized so the latest state always wins) ────────────────

  const pushToObs = useCallback((state: RundownLiveState, mode: "show" | "update") => {
    pushChainRef.current = pushChainRef.current.then(async () => {
      if (presentationLinkMode || !state.timer) return;
      try {
        await ensureObsConnected();
        if (!dockObsClient.isConnected) { setNotice("OBS is not connected."); return; }
        setNotice("");
        const design = resolveDesign(state.timer.designId, designsRef.current);
        const baseUrl = getOverlayBaseUrlSync();
        const targets = resolveRundownTargets(sceneRouteRef.current, design.obs.sceneName);
        if (mode === "show") {
          for (const t of targets) await hideRundownSource(t.contentSourceName, t.sceneName).catch(() => { });
          const bgUrl = rundownBackgroundUrl(design, baseUrl, Date.now());
          for (const t of targets) await ensureRundownSource(t.backgroundSourceName, bgUrl, t.sceneName, { setTransform: true });
          await sleep(280);
        }
        const payload = buildRundownPayload(state, design, baseUrl, { reveal: mode === "show", now: Date.now() });
        const url = rundownOverlayUrl(payload, baseUrl);
        for (const t of targets) await ensureRundownSource(t.contentSourceName, url, t.sceneName, { setTransform: mode === "show" });
        if (targetsIncludePresentationContent(targets)) await applyPresentationVisibility();
      } catch (err) {
        console.warn("[DockRundown] Failed to push to OBS:", err);
        setNotice("Could not update OBS.");
      }
    });
  }, [presentationLinkMode]);

  const hideFromObs = useCallback((state: RundownLiveState | null) => {
    pushChainRef.current = pushChainRef.current.then(async () => {
      if (presentationLinkMode) return;
      try {
        await ensureObsConnected();
        if (!dockObsClient.isConnected) return;
        const design = resolveDesign(state?.timer?.designId, designsRef.current);
        const targets = resolveRundownTargets(sceneRouteRef.current, design.obs.sceneName);
        for (const t of targets) {
          await hideRundownSource(t.backgroundSourceName, t.sceneName).catch(() => { });
          await hideRundownSource(t.contentSourceName, t.sceneName).catch(() => { });
        }
      } catch (err) {
        console.warn("[DockRundown] Failed to hide from OBS:", err);
      }
    });
  }, [presentationLinkMode]);

  // ── State transitions ────────────────────────────────────────────────────

  const apply = useCallback((next: RundownLiveState | null, opts: { forceShow?: boolean } = {}) => {
    const prev = liveRef.current;
    liveRef.current = next;
    setLive(next);
    writePersisted(next ? { live: next, onStream: onStreamRef.current } : null);
    postRelay(next);
    if (next && onStreamRef.current) {
      const designChanged = (prev?.timer?.designId ?? null) !== (next.timer?.designId ?? null);
      const kindChanged = prev?.timer?.kind !== next.timer?.kind;
      pushToObs(next, opts.forceShow || designChanged || kindChanged || !prev ? "show" : "update");
    }
  }, [pushToObs]);

  const selected = rundowns.find((r) => r.id === selectedId) ?? rundowns[0] ?? null;
  const liveRundown = live ? rundowns.find((r) => r.id === live.rundownId) ?? null : null;
  const rundown = liveRundown ?? selected;
  const running = live?.status === "running";

  // Drop a restored live state whose rundown no longer exists.
  useEffect(() => {
    if (loading || !liveRef.current) return;
    if (!rundownsRef.current.some((r) => r.id === liveRef.current!.rundownId)) apply(null);
  }, [loading, rundowns, apply]);

  // Auto-advance (countdown reached zero and the timer asks to roll on).
  useEffect(() => {
    const st = liveRef.current;
    const rd = rundownsRef.current.find((r) => r.id === st?.rundownId);
    if (!st || !rd || !shouldAutoAdvance(st, now)) return;
    const zeroAt = st.at + st.value * 1000;
    const startAt = now - zeroAt < 2000 ? zeroAt : now;
    apply(goToTimer(rd, st, st.index + 1, startAt, true));
  }, [now, apply]);

  const chooseRundown = (id: string) => {
    if (running) return;
    setSelectedId(id);
    try { localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
    const rd = rundownsRef.current.find((r) => r.id === id);
    if (rd) apply(makeLive(rd, 0, Date.now()), { forceShow: true });
  };

  // First open: put the selected rundown on the presenter as "ready".
  useEffect(() => {
    if (loading || liveRef.current || !selected) return;
    apply(makeLive(selected, 0, Date.now()));
  }, [loading, selected, apply]);

  const t0 = Date.now;
  const ensureLive = (): RundownLiveState | null => {
    if (liveRef.current) return liveRef.current;
    return selected ? makeLive(selected, 0, t0()) : null;
  };

  const togglePlay = () => {
    const st = ensureLive();
    if (!st) return;
    apply(st.status === "running" ? pauseLive(st, t0()) : startLive(st, t0()));
  };

  const jump = (index: number, autoStart: boolean) => {
    const st = liveRef.current;
    if (!rundown) return;
    const target = Math.min(Math.max(0, index), rundown.timers.length - 1);
    apply(goToTimer(rundown, st, target, t0(), autoStart));
  };

  const step = (delta: -1 | 1) => {
    const st = liveRef.current;
    if (!st || !rundown) return;
    const target = st.index + delta;
    if (target < 0 || target >= rundown.timers.length) return;
    jump(target, st.status === "running");
  };

  const adjust = (delta: number) => {
    const st = liveRef.current;
    if (st) apply(adjustLive(st, delta, t0()));
  };

  const reset = () => {
    const st = liveRef.current;
    if (st) apply(resetLive(st, t0()));
  };

  const showMessage = (m: RundownMessage | null) => {
    const st = ensureLive();
    if (st) apply(setMessage(st, m));
  };

  const toggleStream = async () => {
    const st = liveRef.current;
    if (presentationLinkMode) return;
    if (onStreamRef.current) {
      onStreamRef.current = false;
      setOnStream(false);
      writePersisted(st ? { live: st, onStream: false } : null);
      hideFromObs(st);
      return;
    }
    onStreamRef.current = true;
    setOnStream(true);
    if (st) {
      writePersisted({ live: st, onStream: true });
      pushToObs(st, "show");
    }
  };

  const presenterUrl = `${window.location.origin}/rundown-presenter.html`;
  const openPresenter = () => {
    fetch("/api/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: presenterUrl }),
    }).catch(() => setNotice("Could not open the presenter screen."));
  };
  const copyPresenter = async () => {
    try {
      await navigator.clipboard.writeText(presenterUrl);
      setNotice("Presenter link copied.");
    } catch {
      setNotice(presenterUrl);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: 12, fontSize: 12, color: "var(--dock-text-dim)" }}>Loading rundowns…</div>;
  }

  if (rundowns.length === 0 || !rundown) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--dock-text-dim)", lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, color: "var(--dock-text)", marginBottom: 4 }}>No rundowns yet</div>
        Open the MakeChurchEazy app → Countdowns → Rundowns to build timers and messages. They show up here automatically.
      </div>
    );
  }

  const st = live && live.rundownId === rundown.id ? live : null;
  const timer = st?.timer ?? null;
  const level = timer ? warnLevel(timer.kind, currentValue(st!, now), timer.durationSeconds, timer.warnYellowSeconds, timer.warnRedSeconds) : "green";
  const color = !timer || timer.kind === "timeofday" ? "var(--dock-text, var(--text-primary))" : WARN_COLORS[level];
  const fraction = timer && st ? progressFraction(timer.kind, currentValue(st, now), timer.durationSeconds) : 0;
  const canAdjust = !!timer && timer.kind !== "timeofday";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px 12px" }}>
      {/* Rundown picker */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select
          aria-label="Rundown"
          value={rundown.id}
          disabled={running}
          onChange={(e) => chooseRundown(e.target.value)}
          style={{ flex: 1, minWidth: 0, minHeight: 28, borderRadius: 7, border: "1px solid var(--dock-border, var(--border))", background: "var(--dock-input-bg, var(--input-bg))", color: "var(--dock-text)", fontSize: 12, padding: "0 8px" }}
        >
          {rundowns.map((r) => <option key={r.id} value={r.id}>{r.name || "Untitled"}</option>)}
        </select>
        <button type="button" style={btn} title="Reload rundowns" aria-label="Reload rundowns" onClick={() => void refresh()}><Icon name="refresh" size={14} /></button>
      </div>

      {/* Big timer */}
      <div style={{ borderRadius: 10, border: "1px solid var(--dock-border, var(--border))", background: "var(--dock-surface, var(--surface))", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--dock-text-dim)", minHeight: 14 }}>
          {timer ? `${timer.name || "Timer"}${timer.speaker ? ` — ${timer.speaker}` : ""}` : "Ready"}
          {st && st.status === "paused" ? " · Paused" : ""}
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", color, lineHeight: 1.05, opacity: st?.status === "paused" ? 0.6 : 1 }}>
          {st ? displayText(st, now) : "--:--"}
        </div>
        {rundown.showProgressBar && timer && timer.kind !== "timeofday" && timer.durationSeconds > 0 && (
          <div style={{ width: "100%", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div style={{ width: `${(fraction * 100).toFixed(1)}%`, height: "100%", background: WARN_COLORS[level], transition: "width 0.25s linear" }} />
          </div>
        )}
        {st?.message && (
          <div style={{ fontSize: 12, fontWeight: st.message.bold ? 800 : 500, color: MESSAGE_COLORS[st.message.color] }}>{st.message.text}</div>
        )}
      </div>

      {/* Transport */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={btn} aria-label="Previous timer" title="Previous timer" onClick={() => step(-1)} disabled={!st || st.index === 0}><Icon name="skip_previous" size={14} /></button>
        <button type="button" style={{ ...btn, flex: 1, minWidth: 80, background: running ? "rgba(234,179,8,0.18)" : "var(--dock-accent, var(--primary))", borderColor: "transparent", color: "#fff" }} onClick={togglePlay}>
          <Icon name={running ? "pause" : "play_arrow"} size={15} /> {running ? "Pause" : st?.status === "paused" ? "Resume" : "Start"}
        </button>
        <button type="button" style={btn} aria-label="Next timer" title="Next timer" onClick={() => step(1)} disabled={!st || st.index >= st.total - 1}><Icon name="skip_next" size={14} /></button>
        <button type="button" style={btn} aria-label="Reset timer" title="Reset timer" onClick={reset} disabled={!st}><Icon name="restart_alt" size={14} /></button>
      </div>

      {canAdjust && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[-60, -10, 10, 60].map((d) => (
            <button key={d} type="button" style={{ ...btn, flex: 1, minWidth: 48 }} onClick={() => adjust(d)}>
              {d > 0 ? "+" : "−"}{Math.abs(d) >= 60 ? `${Math.abs(d) / 60}m` : `${Math.abs(d)}s`}
            </button>
          ))}
        </div>
      )}

      {/* Output */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...btn, flex: 1, minWidth: 110, background: onStream ? "rgba(34,197,94,0.18)" : btn.background, borderColor: onStream ? "rgba(34,197,94,0.5)" : undefined, opacity: presentationLinkMode ? 0.5 : 1 }}
          onClick={() => void toggleStream()}
          disabled={presentationLinkMode}
          title={presentationLinkMode ? "Stream output is available in OBS mode" : undefined}
        >
          <Icon name="cast" size={14} /> {onStream ? "On stream · Hide" : "Show on stream"}
        </button>
        <button type="button" style={btn} title="Open presenter screen" onClick={openPresenter}><Icon name="open_in_new" size={14} /> Presenter</button>
        <button type="button" style={btn} title="Copy presenter link" aria-label="Copy presenter link" onClick={() => void copyPresenter()}><Icon name="content_copy" size={14} /></button>
      </div>
      {notice && <div style={{ fontSize: 11, color: "var(--dock-text-dim)" }}>{notice}</div>}

      {/* Timer list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rundown.timers.map((t, i) => {
          const isCurrent = st?.index === i;
          return (
            <div
              key={t.id}
              onClick={() => jump(i, false)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, cursor: "pointer", border: `1px solid ${isCurrent ? (running ? "rgba(239,68,68,0.6)" : "var(--dock-accent, var(--primary))") : "var(--dock-border, var(--border))"}`, background: isCurrent && running ? "rgba(239,68,68,0.1)" : "var(--dock-surface, var(--surface))" }}
            >
              <span style={{ width: 18, fontSize: 10.5, color: "var(--dock-text-dim)", textAlign: "center" }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dock-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name || "Timer"}</div>
                {t.speaker && <div style={{ fontSize: 10.5, color: "var(--dock-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.speaker}</div>}
              </div>
              <span style={{ fontSize: 11, color: "var(--dock-text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {t.kind === "timeofday" ? "Clock" : t.kind === "countup" ? "Count up" : formatDuration(t.durationSeconds)}
              </span>
              <button type="button" style={{ ...btn, minHeight: 24, padding: "2px 6px" }} aria-label={`Start ${t.name || "timer"}`} title="Start this timer" onClick={(e) => { e.stopPropagation(); jump(i, true); }}><Icon name="play_arrow" size={13} /></button>
            </div>
          );
        })}
      </div>

      {/* Messages */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dock-text-dim)" }}>Messages</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rundown.messages.map((m) => {
            const shown = st?.message?.id === m.id;
            return (
              <button key={m.id} type="button" onClick={() => showMessage(shown ? null : m)} style={{ ...btn, color: MESSAGE_COLORS[m.color], fontWeight: m.bold ? 800 : 600, borderColor: shown ? MESSAGE_COLORS[m.color] : undefined, background: shown ? "rgba(255,255,255,0.1)" : btn.background }}>
                {m.flash && <Icon name="bolt" size={12} />} {m.text}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && customText.trim()) { showMessage(createMessage({ text: customText.trim() })); setCustomText(""); } }}
            placeholder="Type a message…"
            aria-label="Custom message"
            style={{ flex: 1, minWidth: 0, minHeight: 28, borderRadius: 7, border: "1px solid var(--dock-border, var(--border))", background: "var(--dock-input-bg, var(--input-bg))", color: "var(--dock-text)", fontSize: 12, padding: "0 8px" }}
          />
          <button type="button" style={btn} disabled={!customText.trim()} onClick={() => { showMessage(createMessage({ text: customText.trim() })); setCustomText(""); }}>Show</button>
          <button type="button" style={btn} disabled={!st?.message} onClick={() => showMessage(null)}>Hide</button>
        </div>
      </div>
    </div>
  );
}
