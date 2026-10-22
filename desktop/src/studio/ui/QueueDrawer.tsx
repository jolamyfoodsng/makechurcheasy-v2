/**
 * QueueDrawer.tsx — the bottom drawer under the Bible and Preview, with two tabs:
 *
 *  Verse AI            the Queue and the Suggestions side by side (below).
 *  Broadcast graphics  every graphic template: Preview, edit, Project (BroadcastGraphicsDrawer).
 *
 *  Queue        references the pastor said (and verses added by hand), in order. Click the text to
 *               open it in the Bible reader (the screen does not change); Project shows it now.
 *               Drag (or ↑ ↓) to reorder; ✕ removes. The same verse is never listed twice.
 *  Suggestions  verses that match what is being preached. Preview, Project, or move to the Queue.
 *
 * Queue (left) and Suggestions (right) are both always visible. Drag the top edge to make it
 * taller; the chevron collapses it to one row with the two counts.
 */
import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarPlus, ChevronDown, ChevronUp, Eye, GripVertical, ListPlus, Play, Trash2, X } from "../../components/icons/NativeIcons";
import type { VoiceBibleCandidate } from "../../services/voiceBibleTypes";
import { candidateKey, suggestionReason } from "../studioQueue";
import StudioMenu, { menuAt, type StudioMenuState } from "./StudioMenu";

interface QueueDrawerProps {
  open: boolean;
  onToggle: () => void;
  view: "verseai" | "graphics" | "mine";
  onView: (view: "verseai" | "graphics" | "mine") => void;
  /** How many graphics are saved in My graphics. */
  savedCount?: number;
  /** The Broadcast graphics tab. */
  graphics: ReactNode;
  /** A graphic is on the screen now (shows a dot on the tab). */
  graphicLive: boolean;
  /** Graphics are in the left column (Verse AI | Graphics), so the drawer leaves out its graphics tab. */
  hideGraphics?: boolean;
  /** Verse AI is in the side panel, so the drawer leaves out its Verse AI tab and only holds graphics. */
  hideVerseAi?: boolean;
  /** Inside the Verse AI panel: only the Queue (top half) and Suggestions (bottom half), no header. */
  embedded?: boolean;
  queue: VoiceBibleCandidate[];
  suggestions: VoiceBibleCandidate[];
  recentSpeech: string;
  liveKey: string;
  previewKey: string;
  onOpen: (c: VoiceBibleCandidate) => void;
  onProject: (c: VoiceBibleCandidate) => void;
  onSchedule: (c: VoiceBibleCandidate) => void;
  onAddToQueue: (c: VoiceBibleCandidate) => void;
  onRemove: (c: VoiceBibleCandidate) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  /** Keys of references the pastor said in the last minute or so (marked NEW). */
  newKeys?: ReadonlySet<string>;
}

const SPLIT_KEY = "mce-studio-queue-split";
const SPLIT_MIN = 18;
const SPLIT_MAX = 82;
function readSplit(): number {
  try {
    const n = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX ? n : 50;
  } catch {
    return 50;
  }
}

export default function QueueDrawer(props: QueueDrawerProps) {
  const { open, onToggle, view, onView, queue, suggestions, recentSpeech, liveKey, previewKey } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<StudioMenuState | null>(null);
  // Inside the Verse AI panel the Queue (top) and Suggestions (bottom) share the height; drag the bar between them.
  const [split, setSplit] = useState(readSplit);
  const colsRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moveSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !colsRef.current) return;
    const box = colsRef.current.getBoundingClientRect();
    if (box.height <= 0) return;
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((event.clientY - box.top) / box.height) * 100)));
  };
  const endSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    document.documentElement.classList.remove("st-resizing");
    setSplit((now) => { try { localStorage.setItem(SPLIT_KEY, String(Math.round(now))); } catch { /* not saved */ } return now; });
  };

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragFrom !== null && dragFrom !== index) props.onMove(dragFrom, index);
    setDragFrom(null);
    setDropAt(null);
  };

  const row = (c: VoiceBibleCandidate, index: number, kind: "queue" | "suggestion") => {
    const key = candidateKey(c);
    const isLive = key === liveKey;
    const isPreview = key === previewKey && !isLive;
    return (
      <div
        key={`${kind}-${key}`}
        className={`st-qrow${isLive ? " is-live" : ""}${isPreview ? " is-preview" : ""}${dropAt === index && kind === "queue" ? " is-drop" : ""}`}
        draggable={kind === "queue"}
        onDragStart={(e) => { setDragFrom(index); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.label); }}
        onDragOver={(e) => { if (kind === "queue" && dragFrom !== null) { e.preventDefault(); setDropAt(index); } }}
        onDragLeave={() => setDropAt((v) => (v === index ? null : v))}
        onDrop={(e) => onDrop(e, index)}
        onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(menuAt(e, kind === "queue" ? [
            { label: "Preview", icon: <Eye size={14} />, onSelect: () => props.onOpen(c) },
            { label: "Project", icon: <Play size={14} />, onSelect: () => props.onProject(c) },
            { label: "Add to Schedule", icon: <CalendarPlus size={14} />, onSelect: () => props.onSchedule(c) },
            { label: "Move up", icon: <ArrowUp size={14} />, disabled: index === 0, divider: true, onSelect: () => props.onMove(index, index - 1) },
            { label: "Move down", icon: <ArrowDown size={14} />, disabled: index >= queue.length - 1, onSelect: () => props.onMove(index, index + 1) },
            { label: "Remove", icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => props.onRemove(c) },
          ] : [
            { label: "Preview", icon: <Eye size={14} />, onSelect: () => props.onOpen(c) },
            { label: "Project", icon: <Play size={14} />, onSelect: () => props.onProject(c) },
            { label: "Add to Queue", icon: <ListPlus size={14} />, onSelect: () => props.onAddToQueue(c) },
            { label: "Add to Schedule", icon: <CalendarPlus size={14} />, onSelect: () => props.onSchedule(c) },
          ]));
        }}
      >
        {kind === "queue" ? (
          <span className="st-qrow__grip" title="Drag to reorder"><GripVertical size={14} /><span>{index + 1}</span></span>
        ) : (
          <span className="st-qrow__grip st-qrow__grip--plain"><span>{Math.round(c.confidence * 100)}%</span></span>
        )}
        <button type="button" className="st-qrow__main" onClick={() => props.onOpen(c)} onDoubleClick={() => props.onProject(c)} title="Click to open in the Bible reader · double-click to project">
          <strong>{c.label}{kind === "queue" && props.newKeys?.has(key) && !isLive && <span className="st-tag st-tag--new">NEW</span>}{c.source === "fuzzy" && <span className="st-tag">Possible match</span>}{isLive && <span className="st-tag st-tag--live">LIVE</span>}</strong>
          <span className="st-qrow__text">{c.snippet}</span>
          {kind === "suggestion" && <span className="st-qrow__why">{suggestionReason(c, recentSpeech)}</span>}
        </button>
        <div className="st-qrow__actions">
          {kind === "suggestion" && (
            <>
              <button type="button" className="st-chip" onClick={() => props.onAddToQueue(c)} title="Add to the Queue" aria-label={`Add ${c.label} to the Queue`}><ListPlus size={13} /> <span className="st-qrow__lbl">Queue</span></button>
            </>
          )}
          <button type="button" className="st-project" onClick={() => props.onProject(c)} title="Show on the screen now" aria-label={`Project ${c.label}`}><Play size={13} /> <span className="st-qrow__lbl">Project</span></button>
          {kind === "queue" && (
            <button type="button" className="st-chip st-chip--icon" onClick={() => props.onRemove(c)} aria-label={`Remove ${c.label}`} title="Remove from the Queue"><X size={13} /></button>
          )}
        </div>
      </div>
    );
  };

  const cols = (
        <div
          className="st-drawer__cols"
          ref={colsRef}
          style={props.embedded ? { gridTemplateRows: `minmax(0, ${split}fr) 10px minmax(0, ${100 - split}fr)` } : undefined}
        >
          <div className="st-dcol" aria-label="Queue">
            <div className="st-dcol__head">
              <strong>Queue</strong>
              <span className="st-count">{queue.length}</span>
              <span className="st-dcol__sub">what the pastor said</span>
              {queue.length > 0 && <button type="button" className="st-linkbtn" onClick={props.onClear}>Clear queue</button>}
            </div>
            <div className="st-dcol__list">
              {queue.length === 0 && (
                <div className="st-empty">References the pastor mentions land here. You can also right-click a verse → Add to Queue.</div>
              )}
              {queue.map((c, i) => row(c, i, "queue"))}
            </div>
          </div>
          {props.embedded && (
            <div
              className="st-qsplit"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Make Queue or Suggestions taller"
              title="Drag up or down to resize (double-click to reset)"
              onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); document.documentElement.classList.add("st-resizing"); }}
              onPointerMove={moveSplit}
              onPointerUp={endSplit}
              onPointerCancel={endSplit}
              onDoubleClick={() => { setSplit(50); try { localStorage.setItem(SPLIT_KEY, "50"); } catch { /* not saved */ } }}
            />
          )}
          <div className="st-dcol" aria-label="Suggestions">
            <div className="st-dcol__head">
              <strong>Suggestions</strong>
              <span className="st-count">{suggestions.length}</span>
              <span className="st-dcol__sub">never shown on the screen by themselves</span>
            </div>
            <div className="st-dcol__list">
              {suggestions.length === 0 && (
                <div className="st-empty">While Verse AI listens, verses that fit the sermon show up here.</div>
              )}
              {suggestions.map((c, i) => row(c, i, "suggestion"))}
            </div>
          </div>
        </div>
  );

  if (props.embedded) {
    return (
      <div className="st-qpanel">
        {cols}
        <StudioMenu menu={menu} onClose={() => setMenu(null)} />
      </div>
    );
  }

  return (
    <section className={`st-drawer${open ? " is-open" : ""}`} aria-label="Verse AI and broadcast graphics">
      <div className="st-drawer__head">
        <div className="st-drawer__counts" role="tablist">
          {!props.hideVerseAi && (
            <button type="button" role="tab" aria-selected={view === "verseai"} className={`st-drawer__count${view === "verseai" ? " is-on" : ""}`} onClick={() => onView("verseai")}>
              Verse AI <span className="st-count">{queue.length + suggestions.length}</span>
            </button>
          )}
          {!props.hideGraphics && (
            <button type="button" role="tab" aria-selected={view === "graphics"} className={`st-drawer__count${view === "graphics" ? " is-on" : ""}`} onClick={() => onView("graphics")}>
              Broadcast graphics {props.graphicLive && <span className="st-drawer__live" title="A graphic is on the screen" />}
            </button>
          )}
        </div>
        <span className="st-drawer__hint">
          {view === "verseai" ? "Click to open in the reader · Project shows it now · drag to reorder" : view === "mine" ? "Graphics you edited and saved: view, edit or project them" : "Preview a template, edit it, then Project it on top of the screen"}
        </span>
        <button type="button" className="st-iconbtn" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"} title={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (view === "graphics" || view === "mine") && <div className="st-drawer__graphics">{props.graphics}</div>}
      {open && view === "verseai" && cols}
      <StudioMenu menu={menu} onClose={() => setMenu(null)} />
    </section>
  );
}
