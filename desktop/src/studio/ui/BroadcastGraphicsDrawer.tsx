/**
 * BroadcastGraphicsDrawer.tsx — the "Broadcast graphics" tab of the bottom drawer.
 *
 *  List      every graphic the Broadcast Graphics page has (Speaker, Giving, Welcome, ... the app's own,
 *            the ones published from Admin, and My graphics), in category tabs with a search box.
 *            Each card has Preview, Edit and Project.
 *  Edit      splits the tab in two: the list stays on the left, the editor opens on the right
 *            (words, colours, pictures, speed, size, how long it stays). Project there goes live. Close shuts it.
 *  Preview   a window with Play In / Play Out / Replay / Loop.
 *  On screen the bar on top shows the live graphic with a "Close" button that plays its Out animation.
 *
 * The graphic is drawn by the same runtime that OBS and the Dock use (public/kinetic/*), inside an iframe on
 * the output page, so In / Out animations are the real ones.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Eye, Loader2, MoreHorizontal, Pause, Pencil, Play, Repeat, RotateCcw, Search, Send, Square, Trash2, X } from "../../components/icons/NativeIcons";
import type { LowerThirdTheme, LTVariable } from "../../lowerthirds/types";
import { buildThemePreviewHtml, obsPreviewSandbox, type BroadcastTheme } from "../../lowerthirds/broadcastPreviewHtml";
import { KINETIC_LOWER_THIRD_THEMES } from "../../lowerthirds/kineticThemes";
import { GRAPHIC_CATEGORY_TABS, graphicCategoryOf } from "../../lowerthirds/graphicCategory";
import {
  BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT,
  getGraphicAvailability,
  getPackageThemes,
} from "../../services/broadcastGraphicsCatalog";
import {
  BROADCAST_GRAPHICS_UPDATED_EVENT,
  deleteBroadcastGraphic,
  ensureSavedBroadcastGraphicsLoaded,
  loadSavedBroadcastGraphics,
  saveBroadcastGraphic,
  updateBroadcastGraphic,
  type SavedBroadcastGraphic,
} from "../../services/broadcastGraphicsStorage";
import { FREE_LIMITS, consumeFreeUse, freeLeftNote, freeLimitMessage, isFreeStudio } from "../studioAccess";
import {
  REMOTE_PRODUCTION_THEMES_UPDATED_EVENT,
  getCachedRemoteProductionThemes,
  remoteThemeToLowerThird,
} from "../../services/remoteProductionThemes";
import StudioModal from "./StudioModal";
import StudioTip, { GRAPHICS_TIPS } from "./StudioTip";

export interface ProjectedGraphic {
  id: string;
  name: string;
  /** The whole page the output draws in an iframe (transparent background). */
  html: string;
  sandbox: string;
  /** Leaves by itself after this many seconds (0 = stays until Closed). */
  seconds: number;
  /** "center", "bottom-left", ... */
  position: string;
  /** Percent of its normal size. */
  scale: number;
}

interface Props {
  /** "all" = every graphic; "mine" = only the ones saved from here (My graphics). */
  mode?: "all" | "mine";
  /** The graphic on the screen now, if any. */
  live: { id: string; name: string } | null;
  onProject: (graphic: ProjectedGraphic) => void;
  /** Play the out animation and take it off the screen. */
  onClose: () => void;
}

interface Entry {
  key: string;
  name: string;
  theme: LowerThirdTheme;
  category: string;
  /** Values saved with a "My graphics" item. */
  preset: Record<string, string>;
}

/** Variables people edit: the content and style fields. Loop, Size and Hold are left out because "On screen" (Size, Stays for) covers them. */
const HIDDEN_FIELDS = new Set(["kxLoop", "kxScale", "kxAutoOut"]);
function editable(theme: LowerThirdTheme): LTVariable[] {
  return (theme.variables ?? []).filter((v) => !HIDDEN_FIELDS.has(v.key));
}

function defaultsOf(theme: LowerThirdTheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of theme.variables ?? []) out[v.key] = v.defaultValue ?? "";
  return out;
}

const hexOr = (value: string | undefined, fallback = "#ffffff") => (value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);

const HIDDEN_THEME_IDS = new Set(["lt-sub-05-sub-7", "lt-sub-02-sub-2", "lt-ch-text-give"]);

function loadEntries(): Entry[] {
  const map = new Map<string, LowerThirdTheme>();
  try {
    for (const t of KINETIC_LOWER_THIRD_THEMES as unknown as LowerThirdTheme[]) map.set(t.id, t);
  } catch {
    // Kinetic themes are optional here.
  }
  try {
    for (const remote of getCachedRemoteProductionThemes()) {
      const t = remoteThemeToLowerThird(remote);
      if (t) map.set(t.id, t);
    }
  } catch {
    // No cached themes yet.
  }
  try {
    for (const t of getPackageThemes()) map.set(t.id, t);
  } catch {
    // The catalog has not loaded.
  }
  const themes = [...map.values()].filter((t) => !HIDDEN_THEME_IDS.has(t.id) && getGraphicAvailability(t.id).visible);
  const entries: Entry[] = themes.map((theme) => ({ key: theme.id, name: theme.name, theme, category: graphicCategoryOf(theme), preset: {} }));
  try {
    for (const saved of loadSavedBroadcastGraphics()) {
      const theme = map.get(saved.templateId);
      if (!theme || !getGraphicAvailability(theme.id).visible) continue;
      entries.push({ key: `saved-${saved.id}`, name: saved.name, theme, category: "mine", preset: saved.variables ?? {} });
    }
  } catch {
    // No saved graphics.
  }
  return entries;
}

const POSITIONS: Array<[string, string]> = [
  ["bottom-left", "Bottom left"], ["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"],
  ["middle-left", "Middle left"], ["center", "Centre"], ["middle-right", "Middle right"],
  ["top-left", "Top left"], ["top-center", "Top centre"], ["top-right", "Top right"],
];
const DURATIONS: Array<[string, string]> = [
  ["auto", "As designed"], ["0", "Until I close it"], ["3", "3 seconds"], ["5", "5 seconds"], ["8", "8 seconds"],
  ["10", "10 seconds"], ["15", "15 seconds"], ["20", "20 seconds"], ["30", "30 seconds"], ["60", "1 minute"],
];
const SHOW_KEY = "mce-studio-graphic-show";
interface ShowOpts { position: string; size: number; duration: string }
const SHOW_DEFAULT: ShowOpts = { position: "bottom-left", size: 100, duration: "auto" };
function loadShow(): ShowOpts {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOW_KEY) ?? "null");
    if (raw && typeof raw === "object") return { ...SHOW_DEFAULT, ...raw };
  } catch {
    // Use the defaults.
  }
  return SHOW_DEFAULT;
}

const asBroadcast = (theme: LowerThirdTheme) => theme as unknown as BroadcastTheme;

export default function BroadcastGraphicsDrawer({ mode: initialMode = "all", live, onProject, onClose }: Props) {
  const [mode, setMode] = useState<"all" | "mine">(initialMode);
  const [version, setVersion] = useState(0);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [loop, setLoop] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [show, setShow] = useState<ShowOpts>(loadShow);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** The "save before you close?" question in the editor. */
  const [confirmClose, setConfirmClose] = useState(false);
  const [note, setNote] = useState("");
  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((cur) => (cur === text ? "" : cur)), 5000);
  };
  const setShowOpt = (patch: Partial<ShowOpts>) => setShow((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(next)); } catch { /* not saved */ }
    return next;
  });

  useEffect(() => {
    if (!menuKey) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".st-bg__menu, .st-bg__more")) setMenuKey(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuKey]);

  // The saved list is read from the app folder; the drawer refreshes itself when that finishes.
  useEffect(() => { void ensureSavedBroadcastGraphicsLoaded(); }, []);

  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    const events = [BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, BROADCAST_GRAPHICS_UPDATED_EVENT, REMOTE_PRODUCTION_THEMES_UPDATED_EVENT];
    events.forEach((e) => window.addEventListener(e, refresh));
    return () => events.forEach((e) => window.removeEventListener(e, refresh));
  }, []);

  const entries = useMemo<Entry[]>(() => loadEntries(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);

  const tabs = useMemo(() => {
    const used = new Set(entries.map((e) => e.category));
    return GRAPHIC_CATEGORY_TABS.filter((c) => c.key === "all" || used.has(c.key));
  }, [entries]);

  useEffect(() => {
    if (!tabs.some((t) => t.key === category)) setCategory("all");
  }, [tabs, category]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (mode === "mine" ? e.category === "mine" : category === "all" || e.category === category)
      && (!q || e.name.toLowerCase().includes(q) || (e.theme.description ?? "").toLowerCase().includes(q) || (e.theme.tags ?? []).some((t) => t.toLowerCase().includes(q))));
  }, [entries, category, query, mode]);

  const editing = editKey ? entries.find((e) => e.key === editKey) ?? null : null;
  const previewing = previewKey ? entries.find((e) => e.key === previewKey) ?? null : null;

  const valuesFor = (entry: Entry): Record<string, string> => ({ ...defaultsOf(entry.theme), ...entry.preset, ...(edits[entry.key] ?? {}) });

  const setValue = (entry: Entry, key: string, value: string) => {
    setEdits((all) => ({ ...all, [entry.key]: { ...(all[entry.key] ?? {}), [key]: value } }));
  };

  const previewHtml = useMemo(() => {
    if (!previewing) return "";
    try {
      return buildThemePreviewHtml(asBroadcast(previewing.theme), { customVariables: { ...defaultsOf(previewing.theme), ...previewing.preset, ...(edits[previewing.key] ?? {}) }, loop });
    } catch {
      return "";
    }
    // Rebuilt when the window opens, on Replay and when Loop changes (edits made in the editor are picked up next time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing, playKey, loop]);

  const post = (type: "mce-kx-in" | "mce-kx-out") => {
    try {
      frameRef.current?.contentWindow?.postMessage({ type }, "*");
    } catch {
      // The preview is not ready yet.
    }
  };

  const isSaved = (entry: Entry) => entry.key.startsWith("saved-");
  const nameFor = (entry: Entry) => names[entry.key] ?? (isSaved(entry) ? entry.name : `${entry.name} (mine)`);

  /** Keeps the edited graphic in My graphics: updates it if it already is one, otherwise adds a new one. */
  const save = (entry: Entry): boolean => {
    const values = valuesFor(entry);
    const name = nameFor(entry).trim() || entry.name;
    try {
      if (isSaved(entry)) {
        updateBroadcastGraphic(entry.key.slice("saved-".length), { name, variables: values });
        setEdits((all) => ({ ...all, [entry.key]: {} }));
        say("Saved.");
        return true;
      }
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not save the graphic.");
      return false;
    }
    if (isFreeStudio() && loadSavedBroadcastGraphics().length >= FREE_LIMITS.saved) {
      say(freeLimitMessage("saved"));
      return false;
    }
    try {
      saveBroadcastGraphic({
        name,
        templateId: entry.theme.id,
        category: (entry.category === "mine" ? "others" : entry.category) as SavedBroadcastGraphic["category"],
        displayType: "lower-third",
        variables: values,
        isAddedToObs: false,
      });
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not save the graphic.");
      return false;
    }
    say("Saved to My graphics.");
    return true;
  };

  /** True when the open editor has words, colours or a name that were changed and not saved. */
  const isDirty = (entry: Entry) => Object.keys(edits[entry.key] ?? {}).length > 0
    || (names[entry.key] !== undefined && names[entry.key] !== (isSaved(entry) ? entry.name : ""));

  const forget = (entry: Entry) => {
    setEdits((all) => ({ ...all, [entry.key]: {} }));
    setNames((all) => {
      const next = { ...all };
      delete next[entry.key];
      return next;
    });
  };

  /** The editor's X: closes at once, or asks first when there is something unsaved. */
  const requestClose = (entry: Entry) => {
    setMenuKey(null);
    if (isDirty(entry)) setConfirmClose(true);
    else setEditKey(null);
  };
  const closeNow = () => { setConfirmClose(false); setMenuKey(null); setEditKey(null); };
  const saveAndClose = (entry: Entry) => {
    if (!save(entry)) { setConfirmClose(false); return; }
    forget(entry);
    closeNow();
  };
  const discardAndClose = (entry: Entry) => { forget(entry); closeNow(); };

  const remove = (entry: Entry) => {
    if (confirmDelete !== entry.key) {
      setConfirmDelete(entry.key);
      return;
    }
    deleteBroadcastGraphic(entry.key.slice("saved-".length));
    setConfirmDelete(null);
    setMenuKey(null);
    if (editKey === entry.key) { setEditKey(null); setConfirmClose(false); }
  };

  const project = (entry: Entry) => {
    if (!consumeFreeUse("project")) {
      say(freeLimitMessage("project"));
      return;
    }
    const left = freeLeftNote("project");
    if (left) say(left);
    const all = valuesFor(entry);
    const designed = Number(all.kxAutoOut);
    const hold = show.duration === "auto" ? designed : Number(show.duration);
    onProject({
      id: entry.key,
      name: entry.name,
      html: buildThemePreviewHtml(asBroadcast(entry.theme), { customVariables: all, backdrop: "transparent" }),
      sandbox: obsPreviewSandbox(asBroadcast(entry.theme)),
      seconds: Number.isFinite(hold) && hold > 0 ? hold : 0,
      position: show.position,
      scale: show.size,
    });
  };

  const pickImage = (entry: Entry, key: string, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setValue(entry, key, String(reader.result ?? ""));
    reader.readAsDataURL(file);
  };

  const field = (entry: Entry, values: Record<string, string>, v: LTVariable) => {
    const value = values[v.key] ?? "";
    const id = `bg-${v.key}`;
    if (v.type === "color") {
      return (
        <div className="st-bg__color">
          <input id={id} type="color" value={hexOr(value)} onChange={(e) => setValue(entry, v.key, e.target.value)} />
          <input type="text" value={value} onChange={(e) => setValue(entry, v.key, e.target.value)} aria-label={`${v.label} (colour code)`} />
        </div>
      );
    }
    if (v.type === "select" && v.options) {
      return (
        <select id={id} className="st-sel" value={value} onChange={(e) => setValue(entry, v.key, e.target.value)}>
          {v.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (v.type === "toggle") {
      const on = value === "1" || value === "true";
      return (
        <label className="st-bg__toggle">
          <input id={id} type="checkbox" checked={on} onChange={(e) => setValue(entry, v.key, e.target.checked ? "1" : "0")} />
          <span>{on ? "On" : "Off"}</span>
        </label>
      );
    }
    if (v.type === "number") {
      return <input id={id} type="number" step="0.1" min="0" value={value} onChange={(e) => setValue(entry, v.key, e.target.value)} />;
    }
    if (v.type === "image") {
      return (
        <div className="st-bg__image">
          {value && <img src={value} alt="" />}
          <label className="studio-btn">
            Choose picture
            <input type="file" accept="image/*" hidden onChange={(e) => { pickImage(entry, v.key, e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {value && <button type="button" className="studio-btn" onClick={() => setValue(entry, v.key, "")}>Remove</button>}
        </div>
      );
    }
    if (v.multiline) {
      return <textarea id={id} rows={3} value={value} placeholder={v.placeholder} maxLength={v.maxLength} onChange={(e) => setValue(entry, v.key, e.target.value)} />;
    }
    return <input id={id} type="text" value={value} placeholder={v.placeholder} maxLength={v.maxLength} onChange={(e) => setValue(entry, v.key, e.target.value)} />;
  };

  const groups = useMemo(() => {
    if (!editing) return [] as Array<[string, LTVariable[]]>;
    const map = new Map<string, LTVariable[]>();
    for (const v of editable(editing.theme)) {
      const g = v.group || "Content";
      map.set(g, [...(map.get(g) ?? []), v]);
    }
    return [...map.entries()];
  }, [editing]);

  const editValues = editing ? valuesFor(editing) : {};
  const openPreview = (key: string) => { setPreviewKey(key); setPlayKey((k) => k + 1); };

  return (
    <div className="st-bg">
      <div className="st-bg__bar">
        <div className="st-searchbox st-bg__search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search graphics" aria-label="Search graphics" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={12} /></button>}
        </div>
        <div className="st-bg__scope" role="tablist" aria-label="Which graphics">
          <button type="button" role="tab" aria-selected={mode === "all"} className={mode === "all" ? "is-on" : ""} onClick={() => setMode("all")}>All</button>
          <button type="button" role="tab" aria-selected={mode === "mine"} className={mode === "mine" ? "is-on" : ""} onClick={() => setMode("mine")}>
            My graphics <span className="st-count">{entries.filter((e) => e.category === "mine").length}</span>
          </button>
        </div>
        {mode === "all" && <select className="st-sel st-bg__cat" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kind of graphic">
          {tabs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>}
        {note && <span className="st-bg__note" role="status">{note}</span>}
        {live && (
          <div className="st-bg__live" role="status">
            <span className="st-bg__dot" />
            <span className="st-bg__livename">On screen: <strong>{live.name}</strong></span>
            <button type="button" className="st-bg__closebtn" onClick={onClose} title="Play the out animation and take it off the screen">
              <Square size={12} /> Close
            </button>
          </div>
        )}
      </div>

      <div className={`st-bg__body${editing ? " is-split" : ""}`}>
        <div className="st-bg__grid">
          {visible.length === 0 && <div className="st-empty">{mode === "mine" ? "Nothing saved yet. Open any graphic, edit it, then press Save to My graphics." : entries.length === 0 ? "No graphics loaded yet." : "No graphic matches."}</div>}
          {visible.map((entry) => {
            const a = getGraphicAvailability(entry.theme.id);
            const isLive = live?.id === entry.key;
            return (
              <div key={entry.key} className={`st-bg__card${isLive ? " is-live" : ""}${editKey === entry.key ? " is-editing" : ""}${a.usable ? "" : " is-locked"}`}>
                <button type="button" className="st-bg__thumb" onClick={() => openPreview(entry.key)} disabled={!a.usable} aria-label={`Preview ${entry.name}`}>
                  <iframe
                    title={entry.name}
                    loading="lazy"
                    tabIndex={-1}
                    sandbox={obsPreviewSandbox(asBroadcast(entry.theme))}
                    srcDoc={buildThemePreviewHtml(asBroadcast(entry.theme), { hover: true, customVariables: entry.preset })}
                  />
                </button>
                <div className="st-bg__meta">
                  <strong title={entry.name}>{entry.name}</strong>
                  <span>{a.usable ? (GRAPHIC_CATEGORY_TABS.find((c) => c.key === entry.category)?.label ?? "Others") : a.reason === "paused" ? "Paused" : "Locked"}</span>
                </div>
                <div className="st-bg__acts">
                  <button type="button" className="st-project" disabled={!a.usable} onClick={() => project(entry)} title="Project: show it on the screen now" aria-label={`Project ${entry.name}`}><Send size={13} /> <span className="st-qrow__lbl">Project</span></button>
                  <button type="button" className={`st-chip${editKey === entry.key ? " is-on" : ""}`} disabled={!a.usable} onClick={() => setEditKey(editKey === entry.key ? null : entry.key)} title="Edit the words, colours, position and time" aria-label={`Edit ${entry.name}`}><Pencil size={13} /> <span className="st-qrow__lbl">Edit</span></button>
                  <button type="button" className="st-chip st-bg__more" aria-label="More" title="More" aria-expanded={menuKey === entry.key} onClick={() => setMenuKey(menuKey === entry.key ? null : entry.key)}><MoreHorizontal size={15} /></button>
                  {menuKey === entry.key && (
                    <div className="st-bg__menu" role="menu">
                      <button type="button" role="menuitem" disabled={!a.usable} onClick={() => { setMenuKey(null); openPreview(entry.key); }}><Eye size={13} /> Preview</button>
                      <button type="button" role="menuitem" disabled={!a.usable} onClick={() => { setMenuKey(null); setEditKey(entry.key); }}><Pencil size={13} /> Position and time…</button>
                      {isSaved(entry) && (
                        <button type="button" role="menuitem" className="is-danger" onClick={() => remove(entry)}>
                          <Trash2 size={13} /> {confirmDelete === entry.key ? "Click again to delete" : "Delete"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {editing && (
          <aside className="st-bg__edit" aria-label={`Edit ${editing.name}`}>
            <header className="st-bg__edithead">
              <input
                className="st-bg__name"
                value={nameFor(editing)}
                onChange={(e) => setNames((all) => ({ ...all, [editing.key]: e.target.value }))}
                aria-label="Name of this graphic"
                title="The name it is saved under in My graphics"
              />
              <button type="button" className="st-iconbtn" onClick={() => requestClose(editing)} aria-label="Close the editor" title="Close the editor"><X size={16} /></button>
            </header>
            <div className="st-bg__form">
              {groups.map(([name, vars]) => (
                <fieldset key={name} className="st-bg__group">
                  <legend>{name}</legend>
                  {vars.map((v) => (
                    <label key={v.key} className="st-bg__field" htmlFor={`bg-${v.key}`}>
                      <span>{v.label}</span>
                      {field(editing, editValues, v)}
                    </label>
                  ))}
                </fieldset>
              ))}
              <fieldset className="st-bg__group">
                <legend>On screen</legend>
                <label className="st-bg__field">
                  <span>Position</span>
                  <select className="st-sel" value={show.position} onChange={(e) => setShowOpt({ position: e.target.value })} aria-label="Position on the screen">
                    {POSITIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <label className="st-bg__field">
                  <span>Size · {show.size}%</span>
                  <input type="range" min={40} max={160} step={5} value={show.size} onChange={(e) => setShowOpt({ size: Number(e.target.value) })} />
                </label>
                <label className="st-bg__field">
                  <span>Stays for</span>
                  <select className="st-sel" value={show.duration} onChange={(e) => setShowOpt({ duration: e.target.value })}>
                    {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </fieldset>
            </div>
            <footer className="st-bg__editfoot">
              <div className="st-bg__editmore">
                <button
                  type="button"
                  className="studio-btn st-bg__more"
                  aria-label="More: save to My graphics, reset"
                  title="More"
                  aria-expanded={menuKey === `edit:${editing.key}`}
                  onClick={() => setMenuKey(menuKey === `edit:${editing.key}` ? null : `edit:${editing.key}`)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuKey === `edit:${editing.key}` && (
                  <div className="st-bg__menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenuKey(null); openPreview(editing.key); }}>
                      <Eye size={13} /> Preview
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenuKey(null); save(editing); }}>
                      <Bookmark size={13} /> {isSaved(editing) ? "Save changes" : "Save to My graphics"}
                    </button>
                    <button type="button" role="menuitem" disabled={!isDirty(editing)} onClick={() => { setMenuKey(null); forget(editing); }}>
                      <RotateCcw size={13} /> Reset to original
                    </button>
                    {isSaved(editing) && (
                      <button type="button" role="menuitem" className="is-danger" onClick={() => remove(editing)}>
                        <Trash2 size={13} /> {confirmDelete === editing.key ? "Click again to delete" : "Delete"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {live?.id === editing.key && (
                <button type="button" className="studio-btn st-bg__out" onClick={onClose} title="Play the out animation and take it off the screen" aria-label="Close the graphic on the screen">
                  <Square size={12} /> <span className="st-bg__lbl">Close</span>
                </button>
              )}
              <button
                type="button"
                className="studio-btn studio-btn--primary st-bg__go"
                onClick={() => project(editing)}
                title={live?.id === editing.key ? "Project again" : "Project: show it on the screen now"}
                aria-label={live?.id === editing.key ? "Project again" : "Project"}
              >
                <Send size={14} /> <span className="st-bg__lbl">{live?.id === editing.key ? "Project again" : "Project"}</span>
              </button>
            </footer>
            {confirmClose && (
              <div className="st-bg__confirm" role="alertdialog" aria-label="Close the editor?">
                <div className="st-bg__confirmbox">
                  <strong>Close the editor?</strong>
                  <p>You changed this graphic and have not saved it.</p>
                  <div className="st-bg__confirmbtns">
                    <button type="button" className="studio-btn studio-btn--primary" onClick={() => saveAndClose(editing)}>
                      <Bookmark size={14} /> {isSaved(editing) ? "Save changes and close" : "Save to My graphics and close"}
                    </button>
                    <button type="button" className="studio-btn" onClick={() => discardAndClose(editing)}>Close without saving</button>
                    <button type="button" className="studio-btn" onClick={() => setConfirmClose(false)}>Keep editing</button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {!editing && <StudioTip tips={GRAPHICS_TIPS()} />}

      {previewing && createPortal(
        <StudioModal title={previewing.name} wide onClose={() => setPreviewKey(null)}>
          <div className="st-bg__modal">
            <div className="st-bg__stage">
              {previewHtml ? (
                <iframe
                  key={`${previewing.key}-${playKey}-${loop ? 1 : 0}`}
                  ref={frameRef}
                  title={`${previewing.name} preview`}
                  sandbox={obsPreviewSandbox(asBroadcast(previewing.theme))}
                  srcDoc={previewHtml}
                />
              ) : (
                <div className="st-empty"><Loader2 size={16} className="st-spin" /> Preparing the preview…</div>
              )}
            </div>
            <div className="st-bg__ctrl">
              <button type="button" className="studio-btn" onClick={() => post("mce-kx-in")}><Play size={14} /> Play In</button>
              <button type="button" className="studio-btn" onClick={() => post("mce-kx-out")}><Pause size={14} /> Play Out</button>
              <button type="button" className="studio-btn" onClick={() => setPlayKey((k) => k + 1)}><RotateCcw size={14} /> Replay</button>
              <label className="st-bg__loop"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> <Repeat size={13} /> Loop</label>
            </div>
            <div className="st-bg__foot">
              <button type="button" className="studio-btn" onClick={() => { setEditKey(previewing.key); setPreviewKey(null); }}><Pencil size={14} /> Edit</button>
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => { project(previewing); setPreviewKey(null); }}>
                <Send size={14} /> Project to the screen
              </button>
            </div>
          </div>
        </StudioModal>,
        // The drawer clips fixed-position children, so the window is drawn at the Studio's root (which carries its colours).
        document.querySelector<HTMLElement>(".st") ?? document.body,
      )}
    </div>
  );
}
