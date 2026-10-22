/**
 * DockSearchableSelect.tsx — a better dropdown for long theme lists in the OBS Dock.
 *
 *   - a search box with a search icon (matches are highlighted)
 *   - two tabs on top: "Last used" (what you picked recently) and "New" (themes that appeared lately)
 *   - the full list below, in groups (your own themes, Motion, more)
 *   - keyboard: type to search, Up / Down, Enter to pick, Esc to close
 *
 * "Last used" and "New" are remembered on this computer under `storageKey`. A theme counts as new for
 * 14 days after the Dock first saw it; the first time a list is seen nothing is marked new.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DockIcon from "../DockIcon";
import "./DockSearchableSelect.css";

export interface DockSelectOption {
  id: string;
  label: string;
  /** Section in the full list, e.g. "Your themes", "Motion". */
  group?: string;
  /** Small tag after the name, e.g. "Custom". */
  badge?: string;
}

interface Props {
  options: DockSelectOption[];
  value: string;
  onChange: (id: string) => void;
  /** Where "Last used" and "New" are remembered, e.g. "mce-dock-lt-theme-select". */
  storageKey: string;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
  /** Which themes can be previewed. A row gets a Preview button only for those. */
  canPreview?: (id: string) => boolean;
  /** The picture shown in the preview panel. The list stays open while it plays. */
  renderPreview?: (id: string, replayKey: number) => React.ReactNode;
}

type Tab = "recent" | "new";

const RECENT_MAX = 6;
const NEW_MAX = 6;
const NEW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const POPOVER_MAX_WIDTH = 340;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not saved */ }
}

function highlight(label: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return label;
  const at = label.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark>{label.slice(at, at + q.length)}</mark>
      {label.slice(at + q.length)}
    </>
  );
}

export default function DockSearchableSelect({ options, value, onChange, storageKey, ariaLabel, placeholder, compact, canPreview, renderPreview }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const [active, setActive] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readJson<string[]>(`${storageKey}-recent`, []));
  const [seen, setSeen] = useState<Record<string, number>>(() => readJson<Record<string, number>>(`${storageKey}-seen`, {}));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  const selected = options.find((o) => o.id === value);

  // Remember when each theme first appeared. The very first time, everything counts as already known.
  useEffect(() => {
    if (options.length === 0) return;
    const stored = readJson<Record<string, number> | null>(`${storageKey}-seen`, null);
    const next: Record<string, number> = { ...(stored ?? {}) };
    let changed = stored === null;
    for (const o of options) {
      if (next[o.id] === undefined) {
        next[o.id] = stored === null ? 0 : Date.now();
        changed = true;
      }
    }
    if (changed) {
      writeJson(`${storageKey}-seen`, next);
      setSeen(next);
    }
  }, [options, storageKey]);

  const recentOptions = useMemo(
    () => recent.map((id) => options.find((o) => o.id === id)).filter((o): o is DockSelectOption => Boolean(o)).slice(0, RECENT_MAX),
    [recent, options],
  );
  const newOptions = useMemo(
    () => options
      .filter((o) => (seen[o.id] ?? 0) > Date.now() - NEW_DAYS * DAY_MS)
      .sort((a, b) => (seen[b.id] ?? 0) - (seen[a.id] ?? 0))
      .slice(0, NEW_MAX),
    [options, seen],
  );

  const searching = query.trim().length > 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.badge ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, DockSelectOption[]>();
    for (const o of filtered) {
      const g = o.group ?? "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(o);
    }
    return order.map((g) => ({ name: g, items: byGroup.get(g)! }));
  }, [filtered]);

  // The rows in the order they appear, for the keyboard.
  const tabItems = tab === "recent" ? recentOptions : newOptions;
  const visible = useMemo(() => (searching ? filtered : [...tabItems, ...filtered]), [searching, filtered, tabItems]);

  const pick = useCallback((id: string) => {
    onChange(id);
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 12);
    setRecent(next);
    writeJson(`${storageKey}-recent`, next);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }, [onChange, recent, storageKey]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    // Open downwards unless there is clearly more room above.
    const down = below >= 260 || below >= above;
    const maxHeight = Math.max(180, Math.min(420, down ? below : above));
    // As wide as the box, but never wider than a comfortable list, and always on screen.
    const width = Math.min(Math.max(r.width, 280), POPOVER_MAX_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setRect({ left, width, top: down ? r.bottom + 4 : Math.max(8, r.top - 4 - maxHeight), maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    setActive(0);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => { setActive(0); }, [query, tab]);
  useEffect(() => { if (!open) setPreviewId(null); }, [open]);

  // The box exists only once the popover has been placed, so focus it then (typing starts a search at once).
  const ready = open && rect !== null;
  useEffect(() => {
    if (ready) searchRef.current?.focus();
  }, [ready]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(visible.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = visible[active];
      if (target) pick(target.id);
    }
  };

  // Keep the highlighted row in view while using the arrow keys.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const row = (o: DockSelectOption, index: number) => {
    const previewable = Boolean(renderPreview) && (canPreview ? canPreview(o.id) : true);
    return (
      <div
        key={`${index}-${o.id}`}
        data-row={index}
        className={`dss__item${index === active ? " is-active" : ""}`}
        onMouseEnter={() => setActive(index)}
      >
        <button
          type="button"
          role="option"
          aria-selected={o.id === value}
          className={`dss__row${o.id === value ? " is-selected" : ""}`}
          onClick={() => pick(o.id)}
        >
          <span className="dss__check">{o.id === value ? <DockIcon name="check" size={12} /> : null}</span>
          <span className="dss__label">{highlight(o.label, query)}</span>
          {o.badge && <span className="dss__badge">{o.badge}</span>}
        </button>
        {previewable && (
          <button
            type="button"
            className={`dss__eye${previewId === o.id ? " is-on" : ""}`}
            aria-label={`Preview ${o.label}`}
            aria-pressed={previewId === o.id}
            title="Preview (keeps this list open)"
            onClick={() => {
              setPreviewId((current) => (current === o.id ? null : o.id));
              setReplay((n) => n + 1);
            }}
          >
            <DockIcon name="visibility" size={13} />
          </button>
        )}
      </div>
    );
  };

  // Row numbers continue from the tab list into the full list so the keyboard walks through both.
  const tabCount = searching ? 0 : tabItems.length;
  let running = tabCount;

  const popover = open && rect ? createPortal(
    <div
      ref={popRef}
      className="dss__pop"
      style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight }}
      onKeyDown={onKeyDown}
    >
      <label className="dss__search">
        {/* In a span: a global Dock style hides an icon placed directly before an input. */}
        <span className="dss__searchicon"><DockIcon name="search" size={13} /></span>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search themes"
          aria-label="Search themes"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="dss__clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
            <DockIcon name="close" size={12} />
          </button>
        )}
      </label>

      <div className="dss__scroll" role="listbox" aria-label={ariaLabel}>
        {!searching && (
          <>
            <div className="dss__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "recent"} className={tab === "recent" ? "is-on" : ""} onClick={() => setTab("recent")}>
                <DockIcon name="history" size={12} /> Last used <span>{recentOptions.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "is-on" : ""} onClick={() => setTab("new")}>
                <DockIcon name="star_border" size={12} /> New <span>{newOptions.length}</span>
              </button>
            </div>
            {tabItems.length === 0 ? (
              <div className="dss__empty">{tab === "recent" ? "Themes you use will show here." : "No new themes lately."}</div>
            ) : (
              tabItems.map((o, i) => row(o, i))
            )}
            <div className="dss__group">All themes ({options.length})</div>
          </>
        )}

        {filtered.length === 0 ? (
          <div className="dss__empty">No theme matches “{query.trim()}”.</div>
        ) : (
          groups.map((g) => (
            <div key={g.name || "all"}>
              {g.name && (searching || groups.length > 1) && <div className="dss__group dss__group--sub">{g.name}</div>}
              {g.items.map((o) => row(o, running++))}
            </div>
          ))
        )}
      </div>

      {previewId && renderPreview && (
        <div className="dss__preview">
          <div className="dss__preview-pic">{renderPreview(previewId, replay)}</div>
          <div className="dss__preview-side">
            <strong title={options.find((o) => o.id === previewId)?.label}>{options.find((o) => o.id === previewId)?.label}</strong>
            <button type="button" className="dss__btn" onClick={() => setReplay((n) => n + 1)}>
              <DockIcon name="replay" size={12} /> Replay
            </button>
            <button type="button" className="dss__btn dss__btn--use" onClick={() => pick(previewId)}>
              <DockIcon name="check" size={12} /> Use this theme
            </button>
            <button type="button" className="dss__btn dss__btn--quiet" onClick={() => setPreviewId(null)}>Close preview</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dss__trigger${compact ? " dss__trigger--compact" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
        }}
      >
        <span className="dss__value">{selected?.label ?? placeholder ?? "Choose"}</span>
        {selected?.badge && <span className="dss__badge">{selected.badge}</span>}
        <DockIcon name="expand_more" size={14} />
      </button>
      {popover}
    </>
  );
}
