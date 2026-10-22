/**
 * VerseAiOutputCard.tsx — "Output" card on the Verse AI page (under the transcript).
 *
 * Verse AI's own NDI® source and its own Bible theme, kept apart from the Dock and the Studio:
 * pick a theme (saved only for Verse AI), connect with NDI, then project the verse you are previewing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BibleTheme } from "../bible/types";
import { Plus, Radio, Square } from "./icons/NativeIcons";
import { isMacPlatform } from "../studio/shortcuts";
import type { StudioMode } from "../studio/studioEngine";
import type { VoiceBibleCandidate } from "../services/voiceBibleTypes";
import { trackStsPushToLive } from "../services/tracking";
import {
  clearVerseAiVerse,
  getVerseAiNdiStatus,
  loadVerseAiThemes,
  onVerseAiNdiChange,
  projectVerseAiVerse,
  readVerseAiMode,
  readVerseAiThemeId,
  refreshVerseAiNdi,
  saveVerseAiMode,
  saveVerseAiThemeId,
  startVerseAiNdi,
  stopVerseAiNdi,
} from "../services/verseAiOutput";
import "./VerseAiOutputCard.css";

interface VerseAiOutputCardProps {
  /** The verse being previewed on the page. */
  verse: VoiceBibleCandidate | null;
}

export default function VerseAiOutputCard({ verse }: VerseAiOutputCardProps) {
  const navigate = useNavigate();
  const mac = isMacPlatform();
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<StudioMode>(readVerseAiMode);
  const [themes, setThemes] = useState<BibleTheme[]>([]);
  const [themeId, setThemeId] = useState(readVerseAiThemeId);
  const [status, setStatus] = useState(getVerseAiNdiStatus);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [onScreen, setOnScreen] = useState("");
  const [error, setError] = useState("");
  const theme = themes.find((t) => t.id === themeId) ?? themes[0] ?? null;
  const verseKey = verse ? `${verse.book}|${verse.chapter}|${verse.verse}|${verse.endVerse ?? ""}|${verse.translation}` : "";
  const latest = useRef({ theme, mode });
  latest.current = { theme, mode };

  const reloadThemes = useCallback(() => {
    void loadVerseAiThemes(mode).then(setThemes).catch(() => undefined);
  }, [mode]);

  useEffect(() => {
    reloadThemes();
    // Coming back from the Themes page: a theme made there shows up straight away.
    window.addEventListener("focus", reloadThemes);
    return () => window.removeEventListener("focus", reloadThemes);
  }, [reloadThemes]);

  useEffect(() => {
    const off = onVerseAiNdiChange(setStatus);
    void refreshVerseAiNdi();
    return off;
  }, []);

  // A theme change redraws the same verse; only a new verse counts as use.
  const lastTrackedLabel = useRef("");
  const project = useCallback(async (target: VoiceBibleCandidate | null) => {
    if (!target) return;
    setError("");
    try {
      await projectVerseAiVerse(target, latest.current.theme, latest.current.mode);
      setOnScreen(target.label);
      if (lastTrackedLabel.current !== target.label) {
        lastTrackedLabel.current = target.label;
        trackStsPushToLive();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not project this verse.");
    }
  }, []);

  // Auto: every verse you preview goes straight to the output.
  useEffect(() => {
    if (auto && verse) void project(verse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, verseKey]);

  // A different theme or look redraws what is on the output.
  useEffect(() => {
    if (onScreen && verse && verse.label === onScreen) void project(verse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, mode]);

  const pickTheme = (id: string) => {
    setThemeId(id);
    saveVerseAiThemeId(id);
  };
  const pickMode = (next: StudioMode) => {
    setMode(next);
    saveVerseAiMode(next);
  };
  const connect = async () => {
    setBusy(true);
    try { await startVerseAiNdi(); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await stopVerseAiNdi(); } finally { setBusy(false); }
  };
  const clear = async () => {
    setError("");
    try {
      await clearVerseAiVerse(mode);
      setOnScreen("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the output.");
    }
  };

  const watching = status.connections === 1 ? "1 receiver is watching" : `${status.connections} receivers are watching`;

  return (
    <section className="vao" aria-label="Verse AI output">
      <button type="button" className="vao__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Radio size={14} />
        <span>Output · NDI</span>
        <span className={`vao__dot${status.running ? " is-on" : ""}`} aria-hidden="true" />
        <span className="vao__chev">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div className="vao__body">
          <label className="vao__label" htmlFor="vao-theme">Bible theme</label>
          <div className="vao__row">
            <select id="vao-theme" value={theme?.id ?? ""} onChange={(e) => pickTheme(e.target.value)} disabled={themes.length === 0}>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="vao__btn" onClick={() => navigate("/production/themes")} title="Create your own theme on the Themes page">
              <Plus size={13} /> New
            </button>
          </div>
          <div className="vao__seg" role="group" aria-label="Look">
            <button type="button" className={mode === "fullscreen" ? "is-on" : ""} onClick={() => pickMode("fullscreen")}>Full screen</button>
            <button type="button" className={mode === "lower-third" ? "is-on" : ""} onClick={() => pickMode("lower-third")}>Lower third</button>
          </div>
          <p className="vao__hint">This theme is used only here. Your Dock and Studio themes stay as they are.</p>

          <div className="vao__row">
            <button type="button" className="vao__btn vao__btn--primary" disabled={!mac || busy} onClick={() => void connect()}>
              <Radio size={13} /> {status.running ? "Reconnect NDI" : "Connect with NDI"}
            </button>
            {status.running && (
              <button type="button" className="vao__btn" disabled={busy} onClick={() => void disconnect()}><Square size={13} /> Stop</button>
            )}
          </div>
          {!mac ? (
            <p className="vao__hint">Sending over NDI works on Mac for now. Windows support is coming.</p>
          ) : status.error ? (
            <p className="vao__hint vao__hint--error" role="alert">{status.error}</p>
          ) : status.running ? (
            <p className="vao__hint">Sending as <strong>{status.sourceName || "MakeChurchEazy – Verse AI"}</strong>. {status.connections > 0 ? `${watching}.` : "No receiver is watching yet."}</p>
          ) : (
            <p className="vao__hint">Not sending. Install the free NDI Tools from ndi.video, then connect. In vMix or OBS (DistroAV) add an NDI source named “MakeChurchEazy – Verse AI”.</p>
          )}

          <div className="vao__row">
            <button type="button" className="vao__btn vao__btn--primary" disabled={!verse} onClick={() => void project(verse)}>
              Project {verse ? verse.label : "verse"}
            </button>
            <button type="button" className="vao__btn" disabled={!onScreen} onClick={() => void clear()}>Clear</button>
          </div>
          <label className="vao__check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Project each verse I preview</span>
          </label>
          {onScreen && <p className="vao__hint">On the output now: <strong>{onScreen}</strong></p>}
          {error && <p className="vao__hint vao__hint--error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
