/**
 * VerseListPanel.tsx — Left sidebar: Simplified verse list
 *
 * "Now Displaying" header with translation quick-switch buttons + dropdown.
 * Scrollable verse cards with click-to-select, double-click-to-send.
 * Verse highlighting synced with center panel selection.
 * Chapter navigation at bottom.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getChapter } from "../bibleData";
import type { BibleTranslation, BibleVerse } from "../types";
import Icon from "../../components/Icon";

interface TranslationInfo {
  abbr: string;
  name: string;
}

interface Props {
  translation: BibleTranslation;
  book: string | null;
  chapter: number | null;
  selectedVerse: number | null;
  sentVerse?: number | null;
  liveVerseRange: { start: number; end: number } | null;
  favoriteRefs?: Set<string>;
  /** List of installed translations (from IndexedDB) */
  installedTranslations: TranslationInfo[];
  onTranslationChange: (t: BibleTranslation) => void;
  onSelectVerse: (verse: number) => void;
  onDoubleClickVerse?: (verse: number) => void;
  onToggleFavorite?: (verse: number) => void;
  onOpenLibrary?: () => void;
}

/**
 * A single translation button with a dropdown chevron.
 * Clicking the label selects this translation.
 * Clicking the chevron opens a popover listing all installed translations to swap this slot.
 */
function TranslationSlotButton({
  abbr,
  isCurrent,
  allInstalled,
  onSwitch,
  onOpenLibrary,
}: {
  abbr: string;
  isCurrent: boolean;
  allInstalled: TranslationInfo[];
  onSwitch: (newAbbr: string) => void;
  onOpenLibrary?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Find display name
  const info = allInstalled.find((t) => t.abbr === abbr);

  return (
    <div className="translation-slot" ref={ref}>
      <button
        className={`translation-slot-btn${isCurrent ? " active" : ""}`}
        onClick={() => onSwitch(abbr)}
        title={info?.name ?? abbr}
      >
        <span className="translation-slot-label">{abbr}</span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          size={16}
          className={`translation-slot-chevron${open ? " open" : ""}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
        />
      </button>

      {open && (
        <div className="translation-slot-popover">
          <div className="translation-slot-popover-header">Switch version</div>
          {allInstalled.map((t) => (
            <button
              key={t.abbr}
              className={`translation-slot-popover-item${t.abbr === abbr ? " current" : ""}`}
              onClick={() => { onSwitch(t.abbr); setOpen(false); }}
             title="Confirm">
              <span className="translation-slot-popover-abbr">{t.abbr}</span>
              <span className="translation-slot-popover-name">{t.name}</span>
              {t.abbr === abbr && <Icon name="check" size={14} style={{ color: "var(--b-green)" }} />}
            </button>
          ))}
          {onOpenLibrary && (
            <>
              <div className="translation-slot-popover-divider" />
              <button
                className="translation-slot-popover-item translation-slot-popover-library"
                onClick={() => { onOpenLibrary(); setOpen(false); }}
               title="Download">
                <Icon name="add" size={15} />
                <span>Download More…</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Translation switcher: shows quick buttons for each installed translation, each with a dropdown */
function TranslationSwitcher({
  current,
  installed,
  onChange,
  onOpenLibrary,
}: {
  current: BibleTranslation;
  installed: TranslationInfo[];
  onChange: (t: BibleTranslation) => void;
  onOpenLibrary?: () => void;
}) {
  // Show up to 4 buttons (3 on Windows for space); if nothing installed, show KJV fallback
  const maxSlots = navigator.platform.startsWith("Win") ? 3 : 4;
  const slots = installed.length > 0 ? installed.slice(0, maxSlots) : [{ abbr: "KJV", name: "King James Version" }];

  return (
    <div className="translation-switcher">
      {slots.map((t) => (
        <TranslationSlotButton
          key={t.abbr}
          abbr={t.abbr}
          isCurrent={current === t.abbr}
          allInstalled={installed.length > 0 ? installed : [{ abbr: "KJV", name: "King James Version" }]}
          onSwitch={onChange}
          onOpenLibrary={onOpenLibrary}
        />
      ))}

      {/* Add button if fewer than 4 installed */}
      {installed.length > 0 && installed.length <= 3 && onOpenLibrary && (
        <button
          className="translation-slot-btn translation-slot-add"
          onClick={onOpenLibrary}
          title="Download more translations"
        >
          <Icon name="add" size={15} />
        </button>
      )}
    </div>
  );
}

export default function VerseListPanel({
  translation, book, chapter, selectedVerse, sentVerse, liveVerseRange,
  favoriteRefs, installedTranslations,
  onTranslationChange,
  onSelectVerse, onDoubleClickVerse, onToggleFavorite, onOpenLibrary,
}: Props) {
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load verses — re-fetches when book, chapter, or translation changes
  useEffect(() => {
    if (!book || !chapter) {
      setVerses([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    getChapter(book, chapter, translation).then((passage) => {
      if (!cancelled) {
        setVerses(passage.verses);
        setIsLoading(false);
      }
    }).catch((err) => {
      console.error(`Failed to load ${book} ${chapter} (${translation}):`, err);
      if (!cancelled) {
        setVerses([]);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [book, chapter, translation]);

  const isLive = useCallback((v: number) => liveVerseRange ? v >= liveVerseRange.start && v <= liveVerseRange.end : false, [liveVerseRange]);

  const titleText = book && chapter ? `${book} ${chapter}` : book || "Bible";

  // Empty state
  if (!book || !chapter) {
    return (
      <div className="verse-panel">
        <div className="verse-panel-header">
          <div className="verse-panel-header-top">
            <span className="verse-panel-header-label">Now Displaying</span>
          </div>

          <div className="verse-panel-title">Select a Book</div>
          <div className="verse-panel-controls">
            <TranslationSwitcher current={translation} installed={installedTranslations} onChange={onTranslationChange} onOpenLibrary={onOpenLibrary} />
          </div>
        </div>
        <div className="verse-panel-empty">
          <Icon name="menu_book" size={20} />
          <span className="verse-panel-empty-text">Select a book and chapter to view verses</span>
        </div>
      </div>
    );
  }

  return (
    <div className="verse-panel" tabIndex={0}>
      {/* Header */}
       {/* <button className="bible-nav-btn" onClick={() => navigate("/")} title="Go back">
            <Icon name="arrow_back" size={20} />
            <span>Go to Dashboard</span>
          </button> */}
      <div className="verse-panel-header">
        <div className="verse-panel-header-top">
          <span className="verse-panel-header-label">Now Displaying</span>
          <span className="verse-panel-header-badge">{isLoading ? "Loading..." : `${verses.length} verses`}</span>
        </div>
        <div className="verse-panel-title">{titleText}</div>
        <div className="verse-panel-controls">
          <TranslationSwitcher current={translation} installed={installedTranslations} onChange={onTranslationChange} onOpenLibrary={onOpenLibrary} />
        </div>
      </div>

      {/* Verse cards */}
      <div className={`verse-list b-scroll${isLoading ? " is-loading" : ""}`}>
        {isLoading && verses.length === 0 ? (
          <div className="verse-list-loading">
            <span>Loading scriptures</span>
          </div>
        ) : verses.map((v) => {
          const isSel = selectedVerse === v.verse;
          const isSent = sentVerse === v.verse;
          const isLv = isLive(v.verse);
          const isFav = favoriteRefs ? favoriteRefs.has(`${book} ${chapter}:${v.verse}`) : false;
          let cls = "verse-card";
          if (isSel) cls += " selected";
          if (isSent) cls += " sent";
          if (isLv) cls += " live";
          return (
            <div
              key={v.verse}
              className={cls}
              data-verse={v.verse}
              onClick={() => onSelectVerse(v.verse)}
              onDoubleClick={() => onDoubleClickVerse?.(v.verse)}
              title="Click to send to OBS"
            >
              <div className="verse-card-top">
                <span className="verse-card-num">{v.verse}</span>
                {isLv && <Icon name="cast_connected" size={20} className="verse-card-live-icon" />}
                <span className="verse-card-text">{v.text}</span>
              </div>
              {onToggleFavorite && (
                <button
                  className={`verse-card-fav${isFav ? " is-fav" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(v.verse); }}
                  title={isFav ? "Remove from favorites" : "Add to favorites"}
                >
                  <Icon name={isFav ? "star" : "star_border"} size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Chapter navigation */}
      {/* <div className="verse-panel-nav">
        <button className="verse-panel-nav-btn" disabled={!canPrev} onClick={() => book && chapter && onChangeChapter(book, chapter - 1)} title="Previous">
          <Icon name="chevron_left" size={20} /> Prev Ch.
        </button>
        <span className="verse-panel-nav-label">Chapter {chapter}</span>
        <button className="verse-panel-nav-btn" disabled={!canNext} onClick={() => book && chapter && onChangeChapter(book, chapter + 1)} title="Next">
          Next Ch. <Icon name="chevron_right" size={20} />
        </button>
      </div> */}
    </div>
  );
}
