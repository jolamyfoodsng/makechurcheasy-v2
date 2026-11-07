import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, ChevronDown, ChevronLeft, ChevronRight, Check, Search, X, Plus, Download, Palette } from "../icons/NativeIcons";
import CreditsDisplay from "../CreditsDisplay";
import BackgroundPickerCard from "../../dock/components/BackgroundPickerCard";
import type { DockFullscreenQuickThemeSettings } from "../../dock/components/DockFullscreenThemeQuickSettings";
import { DEFAULT_THEME_SETTINGS } from "../../bible/types";

import { useBible } from "../../bible/bibleStore";
import { getChapter, getChapterCount, searchBible } from "../../bible/bibleData";
import type { SearchResult } from "../../bible/bibleData";
import { getBibleSettings, saveBibleSettings, getInstalledTranslations } from "../../bible/bibleDb";
import type { BibleTheme } from "../../bible/types";
import { BIBLE_BOOKS } from "../../bible/types";
import { lmDockService } from "../../services/lmDockService";
import { fetchPresentationState, subscribeLocalPresentationState } from "../../services/presentationState";
import { getPresentationSettings } from "../../services/presentationSettings";
import { parseBibleSearch } from "../../dock/bibleSearchParser";
import { normalizeScriptureReference, getConceptVerses } from "../../bible/scriptureReranker";

import "./BibleModule.css";
import "../../dock/dock.css";

const MIN_KEYWORD_SEARCH_LENGTH = 2;
const KEYWORD_SEARCH_LIMIT = 24;

export interface BiblePresentationSelectionPayload {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text: string;
  themeId?: string;
  verseCount?: number;
  styleOverrides?: {
    fontSize?: number;
    fontFamily?: string;
    fontColor?: string;
    refFontColor?: string;
    textAlign?: string;
    lineHeight?: number;
    letterSpacing?: number;
    wordSpacing?: number;
    fontWeight?: string;
    textTransform?: string;
    textShadow?: string;
    textOutline?: boolean;
    textOutlineWidth?: number;
    textOutlineColor?: string;
    backgroundColor?: string;
    backgroundColorEnd?: string;
    bgGradientAngle?: number;
    backgroundImage?: string;
    backgroundPattern?: string;
    backgroundVideo?: string;
    backgroundOpacity?: number;
    fullscreenShadeOpacity?: number;
    fullscreenShadeColor?: string;
  };
}

export interface BibleModuleProps {
  isActive?: boolean;
  homePath?: string;
  presentationMode?: boolean;
  templatesPath?: string;
  initialSelectBible?: { book: string; chapter: number; verse: number } | null;
  onConsumeInitialSelect?: () => void;
  onPresentToScreen?: (payload: BiblePresentationSelectionPayload) => void;
  onClearScreen?: () => void;
}

function Monitors({
  programItem,
  liveItem,
  theme,
  liveModeEnabled,
  onLiveModeToggle,
  quickSettings,
}: {
  programItem: { ref: string; text: string } | null;
  liveItem: { ref: string; text: string } | null;
  theme: BibleTheme | null;
  liveModeEnabled: boolean;
  onLiveModeToggle: () => void;
  quickSettings?: DockFullscreenQuickThemeSettings | null;
}) {
  const renderPreview = (item: { ref: string; text: string } | null) => {
    if (!item) {
      return <div className="bm-monitor-empty">No verse selected</div>;
    }
    const verseMatch = item.ref.match(/:(\d+)/);
    const verseNum = verseMatch ? verseMatch[1] : null;
    const settings = theme?.settings;
    const effectiveColor = quickSettings?.fontColor || settings?.fontColor || "#ffffff";
    const rawRefColor = (quickSettings?.refFontColor || settings?.refFontColor || "").trim().toLowerCase();
    const isFaint = !rawRefColor || ["#cbd5e1", "#aaaaaa", "#aeb9d1", "#c9d2e5", "#cccccc", "#e0e0e0", "#888888", "#94a3b8", "#64748b"].includes(rawRefColor);
    const effectiveRefColor = isFaint ? effectiveColor : (quickSettings?.refFontColor || settings?.refFontColor || effectiveColor);
    const effectiveFontFamily = quickSettings?.fontFamily || settings?.fontFamily || "inherit";
    const effectiveTextAlign = (quickSettings?.textAlign || settings?.textAlign || "center") as "left" | "center" | "right";
    const effectiveTextShadow = quickSettings?.textShadow || settings?.textShadow || "none";
    const effectiveOutline = quickSettings?.textOutline ?? settings?.textOutline ?? false;
    const effectiveOutlineWidth = quickSettings?.textOutlineWidth ?? settings?.textOutlineWidth ?? 2;
    const effectiveOutlineColor = quickSettings?.textOutlineColor || settings?.textOutlineColor || "#000000";
    const effectiveFontWeight = quickSettings?.fontWeight || settings?.fontWeight || "normal";
    const effectiveTextTransform = quickSettings?.textTransform || settings?.textTransform || "none";
    const effectiveLineHeight = quickSettings?.lineHeight || settings?.lineHeight || 1.4;
    const effectiveLetterSpacing = quickSettings?.letterSpacing ?? settings?.letterSpacing ?? 0;
    const effectiveWordSpacing = quickSettings?.wordSpacing ?? settings?.wordSpacing ?? 0;

    const bgImage = quickSettings?.backgroundImage || settings?.backgroundImage;
    const bgPattern = quickSettings?.backgroundPattern || settings?.backgroundPattern;
    const bgColor = quickSettings?.backgroundColor || settings?.backgroundColor || "#0B1426";
    const bgColorEnd = quickSettings?.backgroundColorEnd || settings?.backgroundColorEnd;
    const shadeOpacity = quickSettings?.fullscreenShadeOpacity ?? settings?.fullscreenShadeOpacity ?? 0;
    const shadeColor = quickSettings?.fullscreenShadeColor || settings?.fullscreenShadeColor || "#000000";

    const containerBg = bgImage
      ? `url("${bgImage}") center / cover no-repeat`
      : bgPattern
        ? `url("${bgPattern}") repeat`
        : bgColorEnd
          ? `linear-gradient(135deg, ${bgColor}, ${bgColorEnd})`
          : bgColor;

    return (
      <div
        className="bm-monitor-preview"
        style={{
          background: containerBg,
          color: effectiveColor,
          fontFamily: effectiveFontFamily,
          textAlign: effectiveTextAlign,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {shadeOpacity > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: shadeColor,
              opacity: shadeOpacity,
              pointerEvents: "none",
            }}
          />
        )}
        <span
          className="bm-monitor-ref"
          style={{
            position: "relative",
            zIndex: 1,
            color: effectiveRefColor,
            fontWeight: 700,
            textShadow: effectiveTextShadow !== "none" ? effectiveTextShadow : undefined,
          }}
        >
          {item.ref}
        </span>
        <p
          className="bm-monitor-text"
          style={{
            position: "relative",
            zIndex: 1,
            fontWeight: effectiveFontWeight === "black" ? 900 : effectiveFontWeight === "extrabold" ? 800 : effectiveFontWeight === "bold" ? 700 : effectiveFontWeight === "light" ? 300 : 400,
            lineHeight: effectiveLineHeight,
            textTransform: effectiveTextTransform as any,
            textShadow: effectiveTextShadow !== "none" ? effectiveTextShadow : undefined,
            letterSpacing: `${effectiveLetterSpacing * 0.5}px`,
            wordSpacing: `${effectiveWordSpacing * 0.5}px`,
            paintOrder: "stroke fill",
            WebkitTextStroke: effectiveOutline && effectiveOutlineWidth > 0 ? `${Math.max(1, effectiveOutlineWidth * 0.6)}px ${effectiveOutlineColor}` : undefined,
          }}
        >
          {verseNum && <sup>{verseNum}</sup>}
          {item.text}
        </p>
      </div>
    );
  };

  return (
    <div className="bm-monitors">
      <div className="bm-monitor">
        <div className="bm-monitor-header">
          <span>Program preview</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>click to select</span>
        </div>
        <div className="bm-monitor-display">
          {renderPreview(programItem)}
        </div>
      </div>
      <div className="bm-monitor">
        <div className="bm-monitor-header live">
          <span><span className="bm-live-dot" /> Live display</span>
          <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={liveModeEnabled}
              onChange={onLiveModeToggle}
              style={{ margin: 0 }}
            />
            Live mode
          </label>
        </div>
        <div className="bm-monitor-display">
          {renderPreview(liveItem)}
        </div>
      </div>
    </div>
  );
}

function ContentLibrary({
  translation,
  translations,
  onTranslationChange,
  selectedBook,
  selectedChapter,
  selectedVerse,
  verses,
  onSelectVerse,
  onDoubleClickVerse,
  onPrevChapter,
  onNextChapter,
  searchQuery,
  searchResults,
  refMatches,
  conceptRefs,
  isSearching,
  onSearchChange,
  onSearchResultClick,
  onConceptRefClick,
}: {
  translation: string;
  translations: Array<{ abbr: string; name: string }>;
  onTranslationChange: (t: string) => void;
  selectedBook: string;
  selectedChapter: number;
  selectedVerse: number;
  verses: Array<{ verse: number; text: string }>;
  onSelectVerse: (verse: number) => void;
  onDoubleClickVerse: (verse: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  searchQuery: string;
  searchResults: SearchResult[];
  refMatches: Array<{ book: string; chapter: number | null; verse: number | null; label: string }>;
  conceptRefs: string[];
  isSearching: boolean;
  onSearchChange: (q: string) => void;
  onSearchResultClick: (result: SearchResult) => void;
  onConceptRefClick: (ref: string) => void;
}) {
  const showDropdown = searchQuery.trim().length >= 2;
  const hasResults = searchResults.length > 0 || refMatches.length > 0 || conceptRefs.length > 0;

  return (
    <div className="bm-library">
      <div className="bm-library-toolbar">
        <div className="bm-library-version">
          <select value={translation} onChange={(e) => onTranslationChange(e.target.value)}>
            {translations.map((t) => (
              <option key={t.abbr} value={t.abbr}>{t.abbr}</option>
            ))}
          </select>
          <ChevronDown size={12} className="bm-library-version-icon" />
        </div>
        <div style={{ position: "relative", flex: 1 }}>
          <div className="bm-library-search">
            <Search size={12} className="bm-library-search-icon" />
            <input
              type="text"
              placeholder={'e.g. j316, joh316, john316, j 316, or "for God so loved the world"'}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          {showDropdown && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              maxHeight: 320,
              overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              {isSearching && !hasResults && (
                <div style={{ padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>Searching...</div>
              )}
              {!isSearching && !hasResults && (
                <div style={{ padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>No results found for &ldquo;{searchQuery}&rdquo;</div>
              )}
              {refMatches.length > 0 && (
                <div style={{ padding: "6px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Go to reference</div>
                  {refMatches.map((ref) => (
                    <button
                      key={ref.label}
                      className="bm-btn bm-btn-sm"
                      style={{ marginRight: 4, marginBottom: 4 }}
                      onClick={() => {
                        const v = ref.verse ?? 1;
                        onTranslationChange(translation);
                        onSearchChange("");
                        onSelectVerse(v);
                      }}
                    >
                      {ref.label}
                    </button>
                  ))}
                </div>
              )}
              {searchResults.map((r: SearchResult, _i: number) => (
                <div
                  key={_i}
                  style={{
                    padding: "6px 10px",
                    cursor: "pointer",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    borderBottom: _i < searchResults.length - 1 ? "1px solid rgba(148,163,184,0.08)" : "none",
                  }}
                  onClick={() => onSearchResultClick(r)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap", minWidth: 80 }}>{r.book} {r.chapter}:{r.verse}</span>
                  <p style={{ fontSize: 11, margin: 0, color: "var(--text-primary)", lineHeight: 1.4 }}>{r.snippet}</p>
                </div>
              ))}
              {conceptRefs.length > 0 && searchResults.length === 0 && (
                <div style={{ padding: "6px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Related verses</div>
                  {conceptRefs.map((ref) => {
                    const match = ref.match(/^(.+)\s+(\d+):(\d+)$/);
                    if (!match) return null;
                    return (
                      <button
                        key={ref}
                        className="bm-btn bm-btn-sm"
                        style={{ marginRight: 4, marginBottom: 4 }}
                        onClick={() => onConceptRefClick(ref)}
                      >
                        {ref}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bm-library-nav">
        <span className="bm-library-chapter">{selectedBook} {selectedChapter}</span>
        <div className="bm-library-nav-buttons">
          <button className="bm-btn-icon" onClick={onPrevChapter}><ChevronLeft size={14} /></button>
          <button className="bm-btn-icon" onClick={onNextChapter}><ChevronRight size={14} /></button>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span>Click to preview · Double-click to present live</span>
      </div>

      <div className="bm-verses-list">
        {verses.map((v) => (
          <div
            key={v.verse}
            className={`bm-verse-item${v.verse === selectedVerse ? " active" : ""}`}
            onClick={() => onSelectVerse(v.verse)}
            onDoubleClick={() => onDoubleClickVerse(v.verse)}
          >
            <span className="bm-verse-num">{v.verse}</span>
            <p className="bm-verse-text">{v.text}</p>
            {v.verse === selectedVerse && <Check size={14} className="bm-verse-num" style={{ minWidth: 16 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function RightSidebar({
  announcements,
  onAddAnnouncement,
  onPresentAnnouncement,
  onRemoveAnnouncement,
}: {
  announcements: Array<{ id: string; text: string }>;
  onAddAnnouncement: () => void;
  onPresentAnnouncement: (id: string) => void;
  onRemoveAnnouncement: (id: string) => void;
}) {
  return (
    <aside className="bm-sidebar-right">
      <div className="bm-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="bm-panel-header">
          <span className="bm-panel-title">
            Announcements <span className="bm-panel-badge">{announcements.length}</span>
          </span>
          <button className="bm-btn bm-btn-sm" onClick={onAddAnnouncement}>
            <Plus size={11} /> Add
          </button>
        </div>
        <div className="bm-panel-list">
          {announcements.length === 0 ? (
            <div className="bm-panel-empty">No announcements yet</div>
          ) : (
            announcements.map((item) => (
              <div key={item.id} className="bm-queue-item">
                <div className="bm-queue-info">
                  <span className="bm-queue-ref" style={{ fontSize: 11, fontWeight: 400, whiteSpace: "pre-wrap" }}>{item.text}</span>
                  <span className="bm-queue-type">Announcement</span>
                </div>
                <div className="bm-queue-actions">
                  <button className="bm-btn bm-btn-sm bm-btn-primary" onClick={() => onPresentAnnouncement(item.id)}>
                    <Play size={11} />
                  </button>
                  <button className="bm-btn bm-btn-sm" onClick={() => onRemoveAnnouncement(item.id)}>
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function AnnouncementModal({
  isOpen,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="bm-modal-overlay" onClick={onCancel}>
      <div className="bm-modal bm-modal-small" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="bm-modal-header">
          <h2 className="bm-modal-title">New Announcement</h2>
          <button className="bm-modal-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="bm-modal-body">
          <textarea
            className="dock-input dock-dialog-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your announcement text here..."
            rows={6}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
        <div className="bm-modal-footer flex-end">
          <button className="bm-btn" onClick={onCancel}>Cancel</button>
          <button className="bm-btn bm-btn-primary" onClick={onConfirm} disabled={!value.trim()}>Add</button>
        </div>
      </div>
    </div>
  );
}

function VersionModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [installed, setInstalled] = useState<Array<{ abbr: string; name: string; size: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    getInstalledTranslations().then((list) => {
      setInstalled(list.map((t) => ({ abbr: t.abbr, name: t.name, size: "—" })));
    }).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = installed.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) || t.abbr.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bm-modal-overlay" onClick={onClose}>
      <div className="bm-modal bm-modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="bm-modal-header">
          <div>
            <h2 className="bm-modal-title">Bible Versions</h2>
            <p className="bm-modal-subtitle">Installed translations</p>
          </div>
          <button className="bm-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="bm-modal-search">
          <div className="bm-library-search" style={{ width: "100%" }}>
            <Search size={12} className="bm-library-search-icon" />
            <input
              type="text"
              placeholder="Search versions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 26, width: "100%" }}
            />
          </div>
        </div>
        <div className="bm-modal-body">
          <div className="bm-version-section">
            <div className="bm-version-section-title">
              Installed <span className="bm-panel-badge">{installed.length}</span>
            </div>
            <div className="bm-version-list">
              {filtered.length === 0 && (
                <div className="bm-panel-empty">No versions found</div>
              )}
              {filtered.map((v) => (
                <div key={v.abbr} className="bm-version-item">
                  <div className="bm-version-info">
                    <div className="bm-version-abbr">{v.abbr}</div>
                    <div>
                      <div className="bm-version-name">{v.name} <span className="bm-installed-dot" /></div>
                      <div className="bm-version-meta">{v.size}</div>
                    </div>
                  </div>
                  <button className="bm-btn bm-btn-ghost" disabled><Check size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="bm-modal-footer flex-end">
          <button className="bm-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function BibleModule({
  homePath = "/",
  presentationMode = false,
  initialSelectBible,
  onConsumeInitialSelect,
  onPresentToScreen,
  onClearScreen,
}: BibleModuleProps) {
  const navigate = useNavigate();
  const { state, setTheme, activeTheme } = useBible();

  // ── Presentation state (live display) ──
  const [liveContent, setLiveContent] = useState<{ ref: string; text: string } | null>(null);

  // ── Bible navigation ──
  const [selectedBook, setSelectedBook] = useState("Genesis");
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [selectedVerse, setSelectedVerse] = useState(1);
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [verses, setVerses] = useState<Array<{ verse: number; text: string }>>([]);
  const [verseCount, setVerseCount] = useState(0);
  const [translations, setTranslations] = useState<Array<{ abbr: string; name: string }>>([]);
  const [translation, setTranslation] = useState("KJV");

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refMatches, setRefMatches] = useState<Array<{ book: string; chapter: number | null; verse: number | null; label: string }>>([]);
  const [conceptRefs, setConceptRefs] = useState<string[]>([]);

  // ── Theme/style picker ──
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [quickSettings, setQuickSettings] = useState<DockFullscreenQuickThemeSettings>(() => ({
    ...DEFAULT_THEME_SETTINGS,
    fontColor: "#ffffff",
    refFontColor: "#ffffff",
    backgroundColor: "#000000",
    fullscreenShadeColor: "#000000",
    fullscreenShadeOpacity: 0.42,
    backgroundType: "theme",
  }));

  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);

  // ── Live mode ──
  const [liveModeEnabled, setLiveModeEnabled] = useState(false);

  // ── Announcements ──
  const [announcements, setAnnouncements] = useState<Array<{ id: string; text: string }>>([]);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState("");

  // ── Stop lmDock on mount (not needed in this module) ──
  useEffect(() => {
    const snap = lmDockService.getSnapshot();
    if (snap.status === "listening") {
      lmDockService.stopListening();
    }
  }, []);

  // ── Restore last selection from settings ──
  useEffect(() => {
    getBibleSettings().then((settings) => {
      if (settings.lastBook) setSelectedBook(settings.lastBook);
      if (settings.lastChapter) setSelectedChapter(settings.lastChapter);
      if (settings.lastVerse) setSelectedVerse(settings.lastVerse);
      setSelectionLoaded(true);
    }).catch(() => setSelectionLoaded(true));
  }, []);

  // ── Persist selection ──
  useEffect(() => {
    if (!selectionLoaded) return;
    const timer = setTimeout(() => {
      saveBibleSettings({ lastBook: selectedBook, lastChapter: selectedChapter, lastVerse: selectedVerse }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedBook, selectedChapter, selectedVerse, selectionLoaded]);

  // ── Translations ──
  useEffect(() => {
    getInstalledTranslations().then((list) => {
      const mapped = list.map((t) => ({ abbr: t.abbr, name: t.name }));
      setTranslations(mapped);
      if (!mapped.some((t) => t.abbr === translation) && mapped.length > 0) {
        setTranslation(mapped[0].abbr);
      }
    }).catch(() => {});
  }, []);

  // ── Deep link selection ──
  useEffect(() => {
    if (initialSelectBible) {
      setSelectedBook(initialSelectBible.book);
      setSelectedChapter(initialSelectBible.chapter);
      setSelectedVerse(initialSelectBible.verse);
      onConsumeInitialSelect?.();
    }
  }, [initialSelectBible, onConsumeInitialSelect]);

  // ── Load verses for current book/chapter ──
  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setVerses([]); return; }
    let cancelled = false;
    getChapter(selectedBook, selectedChapter, translation).then((passage) => {
      if (cancelled) return;
      setVerses(passage.verses);
      setVerseCount(passage.verses.length);
      setSelectedVerse((prev) => prev > passage.verses.length ? 1 : prev);
    }).catch(() => { if (!cancelled) { setVerses([]); setVerseCount(0); } });
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, translation]);

  // ── Subscribe to presentation state for Live Display ──
  useEffect(() => {
    try {
      const settings = getPresentationSettings();
      if (!settings.sessionId) return;
      fetchPresentationState(settings.sessionId).then((state) => {
        if (state?.fullscreen) {
          setLiveContent({
            ref: state.fullscreen.reference || "",
            text: state.fullscreen.title || "",
          });
        }
      }).catch(() => {});
      const unsub = subscribeLocalPresentationState(settings.sessionId, (pState) => {
        if (pState?.fullscreen) {
          setLiveContent({
            ref: pState.fullscreen.reference || "",
            text: pState.fullscreen.title || "",
          });
        } else {
          setLiveContent(null);
        }
      });
      return unsub;
    } catch { return; }
  }, []);

  function isReferenceLikeBibleQuery(query: string): boolean {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return false;
    return /\d/.test(trimmed) || /[:.-]/.test(trimmed) || /\b(vs|verse|verses|chapter|chap)\b/.test(trimmed);
  }

  // ── Search handler (matches DockBibleTab algorithm) ──
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < MIN_KEYWORD_SEARCH_LENGTH) {
      setSearchResults([]);
      setRefMatches([]);
      setConceptRefs([]);
      setIsSearching(false);
      return;
    }

    // Parse reference matches
    let referenceResults: Array<{ book: string; chapter: number | null; verse: number | null; label: string }> = [];
    try {
      const normalized = normalizeScriptureReference(trimmed);
      const refs = normalized ? parseBibleSearch(normalized) : parseBibleSearch(trimmed);
      referenceResults = refs.map((r: any) => ({ book: r.book, chapter: r.chapter, verse: r.verse, label: r.label }));
    } catch {
      referenceResults = [];
    }
    setRefMatches(referenceResults);

    // Concept-based search (only for non-reference queries)
    let conceptVerses: string[] = [];
    if (!isReferenceLikeBibleQuery(trimmed)) {
      try {
        conceptVerses = getConceptVerses(trimmed);
      } catch {
        conceptVerses = [];
      }
    }
    setConceptRefs(conceptVerses);

    // Keyword search (debounced, skipped when reference matches exist)
    const hasReferenceMatch = referenceResults.length > 0;
    if (hasReferenceMatch) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchBible(trimmed, translation, KEYWORD_SEARCH_LIMIT);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, [translation]);

  // ── Present verse (to parent) ──
  const presentVerse = useCallback(async (
    book: string,
    chapter: number,
    verse: number,
    text: string,
  ) => {
    const payload: BiblePresentationSelectionPayload = {
      book,
      chapter,
      verse,
      translation,
      text,
      themeId: state.activeThemeId,
      verseCount: Math.max(1, verseCount),
      styleOverrides: {
        fontSize: quickSettings.fontSize,
        fontFamily: quickSettings.fontFamily,
        fontColor: quickSettings.fontColor,
        refFontColor: quickSettings.refFontColor,
        textAlign: quickSettings.textAlign,
        lineHeight: quickSettings.lineHeight,
        letterSpacing: quickSettings.letterSpacing,
        wordSpacing: quickSettings.wordSpacing,
        fontWeight: quickSettings.fontWeight,
        textTransform: quickSettings.textTransform,
        textShadow: quickSettings.textShadow,
        textOutline: quickSettings.textOutline,
        textOutlineWidth: quickSettings.textOutlineWidth,
        textOutlineColor: quickSettings.textOutlineColor,
        backgroundColor: quickSettings.backgroundColor,
        backgroundColorEnd: quickSettings.backgroundColorEnd,
        bgGradientAngle: quickSettings.bgGradientAngle,
        backgroundImage: quickSettings.backgroundImage,
        backgroundPattern: quickSettings.backgroundType && quickSettings.backgroundType !== "pattern"
          ? ""
          : quickSettings.backgroundPattern,
        backgroundVideo: quickSettings.backgroundVideo,
        backgroundOpacity: quickSettings.backgroundOpacity,
        fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity,
        fullscreenShadeColor: quickSettings.fullscreenShadeColor,
      },
    };

    if (presentationMode) {
      onPresentToScreen?.(payload);
    }

    setLiveContent({ ref: `${book} ${chapter}:${verse} (${translation})`, text });
  }, [translation, state.activeThemeId, verseCount, presentationMode, onPresentToScreen, quickSettings]);

  const handleSearchResultClick = useCallback((result: SearchResult) => {
    setSelectedBook(result.book);
    setSelectedChapter(result.chapter);
    setSelectedVerse(result.verse);
    setSearchQuery("");
    setSearchResults([]);
    setRefMatches([]);
    setConceptRefs([]);
    presentVerse(result.book, result.chapter, result.verse, result.snippet || "");
  }, [translation, state.activeThemeId, verseCount, presentVerse]);

  const handleConceptRefClick = useCallback((ref: string) => {
    const match = ref.match(/^(.+)\s+(\d+):(\d+)$/);
    if (!match) return;
    const [, book, chStr, vsStr] = match;
    const chapter = parseInt(chStr, 10);
    const verse = parseInt(vsStr, 10);
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setSelectedVerse(verse);
    setSearchQuery("");
    setSearchResults([]);
    setRefMatches([]);
    setConceptRefs([]);
    const v = verses.find((v) => v.verse === verse);
    presentVerse(book, chapter, verse, v?.text || "");
  }, [verses, presentVerse]);

  // ── Select verse (single-click → preview, double-click → live) ──
  const handleSelectVerse = useCallback((verse: number) => {
    setSelectedVerse(verse);
    if (liveModeEnabled) {
      const v = verses.find((v) => v.verse === verse);
      if (v) {
        presentVerse(selectedBook, selectedChapter, verse, v.text);
      }
    }
  }, [selectedBook, selectedChapter, verses, presentVerse, liveModeEnabled]);

  const handleDoubleClickVerse = useCallback((verse: number) => {
    const v = verses.find((v) => v.verse === verse);
    if (v) {
      presentVerse(selectedBook, selectedChapter, verse, v.text);
    }
  }, [selectedBook, selectedChapter, verses, presentVerse]);

  // ── Chapter navigation ──
  const handlePrevChapter = useCallback(async () => {
    if (selectedChapter > 1) {
      setSelectedChapter((c) => c - 1);
      setSelectedVerse(1);
      return;
    }
    const bookIdx = BIBLE_BOOKS.indexOf(selectedBook as any);
    if (bookIdx <= 0) return;
    const prevBook = BIBLE_BOOKS[bookIdx - 1];
    const count = await getChapterCount(prevBook, translation);
    if (count > 0) {
      setSelectedBook(prevBook);
      setSelectedChapter(count);
      setSelectedVerse(1);
    }
  }, [selectedBook, selectedChapter, translation]);

  const handleNextChapter = useCallback(async () => {
    const maxCh = await getChapterCount(selectedBook, translation);
    if (selectedChapter < maxCh) {
      setSelectedChapter((c) => c + 1);
      setSelectedVerse(1);
      return;
    }
    const bookIdx = BIBLE_BOOKS.indexOf(selectedBook as any);
    if (bookIdx < 0 || bookIdx >= BIBLE_BOOKS.length - 1) return;
    const nextBook = BIBLE_BOOKS[bookIdx + 1];
    setSelectedBook(nextBook);
    setSelectedChapter(1);
    setSelectedVerse(1);
  }, [selectedBook, selectedChapter, translation]);

  // ── Announcement handlers ──
  const handleAddAnnouncement = useCallback(() => {
    setShowAnnouncementModal(true);
    setAnnouncementDraft("");
  }, []);

  const handleConfirmAnnouncement = useCallback(() => {
    const text = announcementDraft.trim();
    if (!text) return;
    setAnnouncements((prev) => [...prev, { id: `ann-${Date.now()}`, text }]);
    setShowAnnouncementModal(false);
    setAnnouncementDraft("");
  }, [announcementDraft]);

  const handlePresentAnnouncement = useCallback((id: string) => {
    const item = announcements.find((a) => a.id === id);
    if (!item) return;
    const payload: BiblePresentationSelectionPayload = {
      book: "",
      chapter: 0,
      verse: 0,
      translation: "",
      text: item.text,
      themeId: state.activeThemeId,
      verseCount: 1,
    };
    if (presentationMode) {
      onPresentToScreen?.(payload);
    }
    setLiveContent({ ref: "Announcement", text: item.text });
  }, [announcements, state.activeThemeId, presentationMode, onPresentToScreen]);

  const handleRemoveAnnouncement = useCallback((id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Program preview item ──
  const programItem = useMemo(() => {
    const activeVerse = verses.find((v) => v.verse === selectedVerse);
    if (!activeVerse) return null;
    return {
      ref: `${selectedBook} ${selectedChapter}:${selectedVerse} (${translation})`,
      text: activeVerse.text,
    };
  }, [verses, selectedVerse, selectedBook, selectedChapter, translation]);

  // ── Theme picker handlers ──
  const handleThemeSelect = useCallback((theme: import("../../bible/types").BibleTheme) => {
    if (theme.id) setTheme(theme.id);
  }, [setTheme]);

  // ── Clear screen ──
  const handleClear = useCallback(() => {
    onClearScreen?.();
    setLiveContent(null);
  }, [onClearScreen]);

  return (
    <div className="bm-root">
      {/* ═══ HEADER ═══ */}
      <header className="bm-header">
        <div className="bm-header-left">
          <button className="bm-btn bm-btn-ghost" onClick={() => navigate(homePath)}>
            <ChevronLeft size={16} /> {presentationMode ? "Presentation" : "Layouts"}
          </button>
          <span className="bm-header-title">Bible</span>
        </div>
        <CreditsDisplay />
        <div className="bm-header-right">
          <button className={`bm-btn${showThemePicker ? " bm-btn-primary" : " bm-btn-ghost"}`} onClick={() => setShowThemePicker((v) => !v)} title="Theme and style settings">
            <Palette size={14} /> Style
          </button>
          <button className="bm-btn bm-btn-ghost" onClick={() => setIsVersionModalOpen(true)} title="Bible versions">
            <Download size={14} /> Versions
          </button>
          <button className="bm-btn" onClick={handleClear}>
            <X size={14} /> Clear Screen
          </button>
        </div>
      </header>
      {showThemePicker && (
        <div className="bm-theme-panel">
          <BackgroundPickerCard
            quickSettings={quickSettings}
            onQuickSettingsChange={(updater) => setQuickSettings((prev) => updater(prev))}
            selectedThemeId={state.activeThemeId}
            onThemeSelect={handleThemeSelect}
            overlayMode="fullscreen"
            displayMode="single"
            sampleText="Faith"
            sampleReference="John 3:16"
            storageScope="bible"
          />
        </div>
      )}

      {/* ═══ MAIN LAYOUT ═══ */}
      <div className="bm-main">
        {/* Center: Monitors + Library */}
        <div className="bm-center">
          <Monitors
            programItem={programItem}
            liveItem={liveContent}
            theme={activeTheme}
            liveModeEnabled={liveModeEnabled}
            onLiveModeToggle={() => setLiveModeEnabled((v) => !v)}
            quickSettings={quickSettings}
          />
          <ContentLibrary
            translation={translation}
            translations={translations}
            onTranslationChange={setTranslation}
            selectedBook={selectedBook}
            selectedChapter={selectedChapter}
            selectedVerse={selectedVerse}
            verses={verses}
            onSelectVerse={handleSelectVerse}
            onDoubleClickVerse={handleDoubleClickVerse}
            onPrevChapter={handlePrevChapter}
            onNextChapter={handleNextChapter}
            searchQuery={searchQuery}
            searchResults={searchResults}
            refMatches={refMatches}
            conceptRefs={conceptRefs}
            isSearching={isSearching}
            onSearchChange={handleSearchChange}
            onSearchResultClick={handleSearchResultClick}
            onConceptRefClick={handleConceptRefClick}
          />
        </div>

        {/* Right: Announcements */}
        <RightSidebar
          announcements={announcements}
          onAddAnnouncement={handleAddAnnouncement}
          onPresentAnnouncement={handlePresentAnnouncement}
          onRemoveAnnouncement={handleRemoveAnnouncement}
        />
      </div>

      {/* ═══ MODALS ═══ */}
      <AnnouncementModal
        isOpen={showAnnouncementModal}
        value={announcementDraft}
        onChange={setAnnouncementDraft}
        onConfirm={handleConfirmAnnouncement}
        onCancel={() => setShowAnnouncementModal(false)}
      />
      <VersionModal isOpen={isVersionModalOpen} onClose={() => setIsVersionModalOpen(false)} />


    </div>
  );
}

export default BibleModule;
