/**
 * SongsTab.tsx — Songs list tab for the Library page
 *
 * Features:
 *   • Search by title / artist
 *   • Song list with lyrics preview, slide count, key badge
 *   • Add Song modal (title, artist, lyrics, and slide layout)
 *   • Edit Song modal (same fields, pre-filled)
 *   • Archive in one click (a dot on "More tools" points to it); delete for good from the Archive with confirmation
 *   • ESC closes modals
 *
 * Songs are persisted in IndexedDB via worshipDb.ts.
 *
 * Plan enforcement:
 *   • Free: max 3 songs, no bulk import
 *   • Basic: max 50 songs, tickers, lower thirds, and multiview
 *   • Growth+: unlimited songs, unlimited multiview
 *   • Existing songs are NEVER hidden or deleted on downgrade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderUp,
  ListMusic,
  MoreHorizontal,
  Globe,
  Archive,
  Upload,
  X,
  Edit,
  Lock,
} from "../components/icons/NativeIcons";
import { useAuth } from "../contexts/AuthContext";
import {
  getEffectivePlan,
  getRemainingSongSlots,
} from "../services/licenseService";
import { checkEntitlementSync } from "../services/entitlementClient";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import { PremiumContentGate } from "../components/PremiumContentGate";
import { UpgradeModal } from "../components/UpgradeModal";
import { BulkImportModal } from "../worship/BulkImportModal";
import EasyWorshipOneClickImportModal from "../worship/EasyWorshipOneClickImportModal";
import {
  formatOnlineLyricsSearchError,
  isSpotifyTrackLyricsQuery,
  searchOnlineSongLyrics,
  type OnlineLyricsSearchResult,
} from "../worship/onlineLyricsService";
import { generateSlides } from "../worship/slideEngine";
import {
  OnlineLyricsImportModal,
  type OnlineLyricsImportDraft,
} from "../worship/OnlineLyricsImportModal";
import { unicodeSearchNormalize, unicodeStripDiacritics } from "../worship/unicodeUtils";
import type { Song } from "../worship/types";
import {
  archiveSong,
  getAllSongs,
  getArchivedSongs,
  permanentlyDeleteSong,
  restoreSong,
  saveSong,
  WORSHIP_SONGS_UPDATED_EVENT,
} from "../worship/worshipDb";
import WorshipSongModal from "../worship/WorshipSongModal";
import ModalDialog from "../components/ModalDialog";
import { fuzzyMatch } from "../services/fuzzySearch";

/* ---------- helpers ---------- */

function firstNLines(text: string, n: number): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n);
}

const MIN_ONLINE_LYRICS_QUERY_LENGTH = 3;
const ONLINE_LYRICS_SEARCH_DELAY_MS = 80;

function normalizeSongLookupPart(value: string): string {
  return unicodeSearchNormalize(value);
}

function normalizeCompactSearch(value: string): string {
  return unicodeStripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildSongLookupKeys(title: string, artist: string): string[] {
  const normalizedTitle = normalizeSongLookupPart(title);
  const normalizedArtist = normalizeSongLookupPart(artist);

  if (!normalizedTitle) {
    return [];
  }

  return normalizedArtist
    ? [`${normalizedTitle}::${normalizedArtist}`, normalizedTitle]
    : [normalizedTitle];
}

function createSongId(prefix = "song"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ========================================================================= */
/* SongsTab                                                                  */
/* ========================================================================= */

const EASYWORSHIP_BANNER_KEY = "mce-songs-easyworship-banner";
const EASYWORSHIP_REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000;

/** Hidden when closed for good, or until the "Remind me later" time has passed. */
function readEasyWorshipBannerVisible(): boolean {
  try {
    const saved = localStorage.getItem(EASYWORSHIP_BANNER_KEY);
    if (!saved) return true;
    if (saved === "closed") return false;
    return Date.now() >= Number(saved);
  } catch {
    return true;
  }
}

export function SongsTab() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [archivedSongs, setArchivedSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [onlineSearchResults, setOnlineSearchResults] = useState<OnlineLyricsSearchResult[]>([]);
  const [onlineSearchState, setOnlineSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [onlineSearchMessage, setOnlineSearchMessage] = useState("");
  const [pendingOnlineImport, setPendingOnlineImport] = useState<OnlineLyricsSearchResult | null>(null);
  const [showOnlineSearchModal, setShowOnlineSearchModal] = useState(false);
  const [onlineSearchQuery, setOnlineSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  // Set when a song is archived; shows a dot on "More tools" until the menu is opened.
  const [hasUnseenArchive, setHasUnseenArchive] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [easyWorshipModalOpen, setEasyWorshipModalOpen] = useState(false);
  const [showEasyWorshipBanner, setShowEasyWorshipBanner] = useState(readEasyWorshipBannerVisible);
  const hideEasyWorshipBanner = (forever: boolean) => {
    try {
      localStorage.setItem(
        EASYWORSHIP_BANNER_KEY,
        forever ? "closed" : String(Date.now() + EASYWORSHIP_REMIND_LATER_MS),
      );
    } catch { /* storage unavailable: it hides for this visit only */ }
    setShowEasyWorshipBanner(false);
  };
  const [showMoreTools, setShowMoreTools] = useState(false);
  const [activeCardMenuId, setActiveCardMenuId] = useState<string | null>(null);
  const moreToolsRef = useRef<HTMLDivElement>(null);
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [savingOnlineImport, setSavingOnlineImport] = useState(false);
  const onlineSearchRequestRef = useRef(0);
  const spotifyAutoImportRef = useRef<string | null>(null);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (moreToolsRef.current && !moreToolsRef.current.contains(target)) {
        setShowMoreTools(false);
      }
      if (!target.closest(".worship-card-menu-container")) {
        setActiveCardMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  // ── Plan enforcement ──
  const { user: authUser } = useAuth();
  const effectivePlan = getEffectivePlan(authUser);
  const { limit: songLimit } = checkEntitlementSync("songs", effectivePlan);
  const { allowed: canImport } = checkEntitlementSync("massImport", effectivePlan);
  const [songCount, setSongCount] = useState<number>(0);
  const isSongUnlimited = songLimit === -1;
  const hasReachedSongLimit = !isSongUnlimited && songCount >= songLimit;

  const computeSongLimits = useCallback(async () => {
    try {
      const slots = await getRemainingSongSlots(authUser);
      if (isSongUnlimited) {
        setSongCount(0);
      } else {
        setSongCount(songLimit - slots);
      }
    } catch {
      // Fallback: keep current count
    }
  }, [authUser, songLimit, isSongUnlimited]);

  const reload = useCallback(async () => {
    const [all, archived] = await Promise.all([getAllSongs(), getArchivedSongs()]);
    setSongs(all);
    setArchivedSongs(archived);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the Library list current when the Dock creates or edits a song.
  useEffect(() => {
    const handleSongsUpdated = () => {
      void reload();
    };
    window.addEventListener(WORSHIP_SONGS_UPDATED_EVENT, handleSongsUpdated);
    return () => window.removeEventListener(WORSHIP_SONGS_UPDATED_EVENT, handleSongsUpdated);
  }, [reload]);

  // Recompute song limits whenever the song list or plan changes
  useEffect(() => {
    computeSongLimits();
  }, [songs.length, computeSongLimits]);

  // ESC handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) { setShowAddModal(false); return; }
        if (editSong) { setEditSong(null); return; }
        if (deleteConfirmId) { setDeleteConfirmId(null); return; }
        if (showOnlineSearchModal) { setShowOnlineSearchModal(false); return; }
        if (showArchiveModal) { setShowArchiveModal(false); return; }
        if (bulkImportOpen) { setBulkImportOpen(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, editSong, deleteConfirmId, showOnlineSearchModal, showArchiveModal, bulkImportOpen]);

  // ── Accessible songs: only the songs the current plan allows ──
  const accessibleSongs = useMemo(() => {
    if (isSongUnlimited) return songs;
    return songs.slice(0, songLimit);
  }, [songs, isSongUnlimited, songLimit]);

  const visible = useMemo(() => {
    const languageFiltered = languageFilter !== "all"
      ? accessibleSongs.filter((s) => s.metadata.language === languageFilter)
      : accessibleSongs;

    if (!search.trim()) return languageFiltered;

    const q = search.trim();
    const qLower = q.toLowerCase();
    const qCompact = normalizeCompactSearch(q);
    const numMatch = qLower.match(/(\d+)/);
    const searchNumber = numMatch ? numMatch[1] : null;

    const scored = languageFiltered
      .map((song) => {
        const title = song.metadata.title.toLowerCase();
        const hymnNumber = song.metadata.hymnNumber?.trim() ?? "";
        const hymnNumberCompact = normalizeCompactSearch(hymnNumber);
        const hymnLabelCompact = hymnNumberCompact ? `hymn${hymnNumberCompact}` : "";
        const searchText = `${song.metadata.title}\n${song.metadata.artist}\n${song.lyrics}\n${hymnNumber}\nHymn ${hymnNumber}`.toLowerCase();
        let score = 0;

        if (searchNumber) {
          const exactTitleRe = new RegExp(`^hymn\\s+${searchNumber}$`);
          const numDotRe = new RegExp(`^${searchNumber}[.\\s]`);
          const bareNumRe = new RegExp(`^${searchNumber}$`);
          if (hymnNumberCompact === searchNumber) score += 12000;
          else if (hymnNumberCompact.includes(searchNumber)) score += 7000;
          else if (exactTitleRe.test(title)) score += 10000;
          else if (bareNumRe.test(title)) score += 10000;
          else if (numDotRe.test(title)) score += 10000;
          else if (title.includes(`hymn ${searchNumber}`)) score += 5000;
          else if (title.includes(searchNumber)) score += 2000;
        }

        if (score === 0 && hymnLabelCompact && hymnLabelCompact.includes(qCompact)) score += 9000;

        if (score === 0 && title.startsWith(qLower)) score += 3000;
        if (score === 0 && title.includes(qLower)) score += 1000;
        if (score === 0 && searchText.includes(qLower)) score += 500;
        if (score === 0 && fuzzyMatch(q, searchText)) score += 100;

        return { song, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const bestScore = scored.length > 0 ? scored[0].score : 0;
    if (bestScore >= 500) {
      return scored.filter((item) => item.score >= 500).map((item) => item.song);
    }
    return scored.map((item) => item.song);
  }, [search, accessibleSongs, languageFilter]);

  const SONGS_PER_PAGE = 24;
  const [displayLimit, setDisplayLimit] = useState(SONGS_PER_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDisplayLimit(SONGS_PER_PAGE);
  }, [search, languageFilter]);

  const displayedSongs = useMemo(() => {
    return visible.slice(0, displayLimit);
  }, [visible, displayLimit]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayLimit < visible.length) {
          setDisplayLimit((prev) => Math.min(visible.length, prev + SONGS_PER_PAGE));
        }
      },
      { rootMargin: "300px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayLimit, visible.length]);

  const hasActiveFilters = search.trim().length > 0 || languageFilter !== "all";
  const languageFilterLabel = languageFilter === "all"
    ? "All languages"
    : languageFilter.charAt(0).toUpperCase() + languageFilter.slice(1);

  const importedSongsLookup = useMemo(() => {
    const lookup = new Map<string, Song>();

    for (const song of songs) {
      for (const key of buildSongLookupKeys(song.metadata.title, song.metadata.artist)) {
        if (!lookup.has(key)) {
          lookup.set(key, song);
        }
      }
    }

    return lookup;
  }, [songs]);

  const findImportedSong = useCallback((result: OnlineLyricsSearchResult): Song | undefined => {
    for (const key of buildSongLookupKeys(result.title, result.artist)) {
      const existing = importedSongsLookup.get(key);
      if (existing) {
        return existing;
      }
    }
    return undefined;
  }, [importedSongsLookup]);

  useEffect(() => {
    const trimmedSearch = onlineSearchQuery.trim();

    if (!showOnlineSearchModal || !trimmedSearch) {
      onlineSearchRequestRef.current += 1;
      setOnlineSearchResults([]);
      setOnlineSearchState("idle");
      setOnlineSearchMessage("");
      return;
    }

    if (trimmedSearch.length < MIN_ONLINE_LYRICS_QUERY_LENGTH) {
      onlineSearchRequestRef.current += 1;
      setOnlineSearchResults([]);
      setOnlineSearchState("idle");
      setOnlineSearchMessage(`Type at least ${MIN_ONLINE_LYRICS_QUERY_LENGTH} letters to search online lyrics.`);
      return;
    }

    const requestId = onlineSearchRequestRef.current + 1;
    onlineSearchRequestRef.current = requestId;
    setOnlineSearchState("loading");
    setOnlineSearchMessage("");

    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchOnlineSongLyrics(trimmedSearch);
        if (onlineSearchRequestRef.current !== requestId) {
          return;
        }
        setOnlineSearchResults(results);
        setOnlineSearchState("ready");
        setOnlineSearchMessage(results.length === 0 ? "No online lyrics found for this search yet." : "");
      } catch (error) {
        if (onlineSearchRequestRef.current !== requestId) {
          return;
        }
        console.warn("[SongsTab] Online lyrics search failed:", error);
        setOnlineSearchResults([]);
        setOnlineSearchState("error");
        setOnlineSearchMessage(formatOnlineLyricsSearchError(error));
      }
    }, ONLINE_LYRICS_SEARCH_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [onlineSearchQuery, showOnlineSearchModal]);

  const handleArchive = useCallback(
    async (id: string) => {
      await archiveSong(id);
      setHasUnseenArchive(true);
      reload();
    },
    [reload]
  );

  const handlePermanentDelete = useCallback(
    async (id: string) => {
      setDeleteConfirmId(null);
      await permanentlyDeleteSong(id);
      reload();
    },
    [reload]
  );

  const handleSaveComplete = useCallback(() => {
    reload();
    setShowAddModal(false);
    setEditSong(null);
  }, [reload]);

  const handleRestore = useCallback(async (id: string) => {
    await restoreSong(id);
    reload();
  }, [reload]);

  const handleAddSong = useCallback(() => {
    if (hasReachedSongLimit) {
      void openDashboardSubscriptionPlans();
      return;
    }
    setShowAddModal(true);
  }, [hasReachedSongLimit]);

  const handleBulkImport = useCallback(() => {
    if (!canImport) {
      void openDashboardSubscriptionPlans();
      return;
    }
    setBulkImportOpen(true);
  }, [canImport]);

  const handleOpenOnlineImport = useCallback((result: OnlineLyricsSearchResult) => {
    const existingSong = findImportedSong(result);
    if (existingSong) {
      setShowOnlineSearchModal(false);
      setEditSong(existingSong);
      return;
    }
    setPendingOnlineImport(result);
  }, [findImportedSong]);

  const handleOpenOnlineSearch = useCallback(() => {
    setOnlineSearchQuery((current) => current || search.trim());
    setShowOnlineSearchModal(true);
  }, [search]);

  const handleImportOnlineSong = useCallback(async (draft: OnlineLyricsImportDraft) => {
    if (!pendingOnlineImport) {
      return;
    }

    setSavingOnlineImport(true);

    try {
      const now = new Date().toISOString();
      const lyrics = draft.lyrics.trim();
      const newSong: Song = {
        id: createSongId("song-online"),
        metadata: {
          title: draft.title.trim(),
          artist: draft.artist.trim(),
        },
        lyrics,
        slides: generateSlides(lyrics, 2, true),
        createdAt: now,
        updatedAt: now,
        importSourceType: "online",
        importSourceName: pendingOnlineImport.sourceName,
        importSourceUrl: pendingOnlineImport.url,
        autoSplit: true,
        linesPerSlide: 2,
      };

      await saveSong(newSong);
      await reload();
      setShowOnlineSearchModal(false);
      setSearch(newSong.metadata.title);
      setPendingOnlineImport(null);
    } catch (error) {
      console.error("[SongsTab] Failed to import online lyrics:", error);
      setOnlineSearchMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingOnlineImport(false);
    }
  }, [pendingOnlineImport, reload]);

  useEffect(() => {
    const trimmedSearch = onlineSearchQuery.trim();
    const firstResult = onlineSearchResults[0];

    if (
      !showOnlineSearchModal ||
      !isSpotifyTrackLyricsQuery(trimmedSearch)
      || onlineSearchState !== "ready"
      || !firstResult
      || findImportedSong(firstResult)
    ) {
      return;
    }

    const importKey = `${trimmedSearch}::${firstResult.id}`;
    if (spotifyAutoImportRef.current === importKey) {
      return;
    }

    spotifyAutoImportRef.current = importKey;
    setPendingOnlineImport(firstResult);
  }, [findImportedSong, onlineSearchQuery, onlineSearchResults, onlineSearchState, showOnlineSearchModal]);

  return (
    <>
      <div className="worship-resources-container">
      {/* Search and Action Toolbar */}
      <div className="worship-toolbar-row">
        <div className="worship-search-wrap">
          <Search size={18} className="worship-search-icon" />
          <input
            className="worship-search-input"
            type="text"
            placeholder="Search by title, artist, or hymn number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search songs by title, artist, or hymn number"
          />
          {search && (
            <button
              type="button"
              className="worship-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear song search"
              title="Clear song search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="worship-toolbar-actions">
          <button
            type="button"
            className="worship-search-online-btn"
            onClick={handleOpenOnlineSearch}
            title="Search for song lyrics online"
          >
            <Globe size={16} />
            <span>Search Online</span>
          </button>

          <button
            type="button"
            className={`worship-add-song-btn ${hasReachedSongLimit ? "lib-add-btn--at-limit" : ""}`}
            onClick={handleAddSong}
            title="Add a song"
          >
            <Plus size={18} />
            <span>Add Song</span>
          </button>

          <div className="worship-more-tools-container" ref={moreToolsRef}>
            <button
              type="button"
              className="worship-more-tools-btn"
              onClick={() => {
                setShowMoreTools((prev) => !prev);
                setHasUnseenArchive(false);
              }}
              aria-label={hasUnseenArchive ? "More tools (a song was archived)" : "More tools"}
              title={hasUnseenArchive ? "Archived songs are in More tools → Archive" : "More tools"}
            >
              <span>More tools</span>
              {hasUnseenArchive && <span className="worship-more-tools-dot" aria-hidden="true" />}
              <ChevronDown size={14} />
            </button>

            {showMoreTools && (
              <div className="worship-more-tools-dropdown">
                <button
                  type="button"
                  className="worship-dropdown-item"
                  onClick={() => {
                    setShowMoreTools(false);
                    setShowArchiveModal(true);
                  }}
                >
                  <Archive size={16} />
                  <span>Archive</span>
                  {archivedSongs.length > 0 && (
                    <span className="worship-dropdown-badge">{archivedSongs.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="worship-dropdown-item"
                  onClick={() => {
                    setShowMoreTools(false);
                    handleBulkImport();
                  }}
                >
                  <Upload size={16} />
                  <span>Import File</span>
                </button>
                <button
                  type="button"
                  className="worship-dropdown-item"
                  onClick={() => {
                    setShowMoreTools(false);
                    setEasyWorshipModalOpen(true);
                  }}
                >
                  <FolderUp size={16} />
                  <span>Import EasyWorship</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* EasyWorship Import Banner: "Remind me later" hides it for a week, the X for good
          (Settings → Data & Storage and "More tools" still offer the import). */}
      {showEasyWorshipBanner && (
      <div className="worship-ew-banner">
        <div className="worship-ew-banner-left">
          <div className="worship-ew-icon-box">
            <FolderUp size={22} />
          </div>
          <div className="worship-ew-text">
            <h3 className="worship-ew-title">Bring in your EasyWorship library</h3>
            <p className="worship-ew-subtitle">Import songs, media, and themes in one step.</p>
          </div>
        </div>
        <div className="worship-ew-actions">
          <button
            type="button"
            className="worship-ew-later-btn"
            onClick={() => hideEasyWorshipBanner(false)}
            title="Hide this for a week"
          >
            Remind me later
          </button>
          <button
            type="button"
            className="worship-ew-import-btn"
            onClick={() => setEasyWorshipModalOpen(true)}
            title="Import EasyWorship library"
          >
            Import EasyWorship
          </button>
          <button
            type="button"
            className="worship-ew-close-btn"
            onClick={() => hideEasyWorshipBanner(true)}
            title="Close. You can still import from Settings → Data & Storage"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      )}

      {/* Filter indicator chips if searching */}
      {hasActiveFilters && (
        <div className="lib-song-section-head lib-song-section-head--active" style={{ padding: "0 4px" }}>
          <div className="lib-song-section-summary">
            <span className="lib-song-section-label">Library</span>
            <span className="lib-song-section-note">
              {visible.length} result{visible.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="lib-song-section-chips">
            {search.trim() && (
              <span className="lib-song-section-chip">
                <Search size={12} />
                {search.trim()}
              </span>
            )}
            {languageFilter !== "all" && (
              <span className="lib-song-section-chip">
                {languageFilterLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty States */}
      {visible.length === 0 &&
        (hasActiveFilters ? (
          <div className="lib-empty lib-empty--search">
            <div className="lib-empty-icon">
              <Globe size={30} />
            </div>
            <h3 className="lib-empty-title">No songs match this view</h3>
            <p className="lib-empty-copy">
              Try a different title, hymn number, or language filter. You can also search online lyrics and import directly.
            </p>
            <div className="lib-empty-actions">
              <button
                type="button"
                className="lib-toolbar-btn lib-toolbar-btn--secondary"
                onClick={() => {
                  setSearch("");
                  setLanguageFilter("all");
                }}
              >
                Clear Filters
              </button>
              <button type="button" className="worship-add-song-btn" onClick={handleOpenOnlineSearch}>
                <Globe size={16} />
                Search Online
              </button>
            </div>
          </div>
        ) : (
          <div className="lib-empty lib-empty--rich">
            <div className="lib-empty-icon">
              <ListMusic size={34} />
            </div>
            <h3 className="lib-empty-title">Build your worship library</h3>
            <p className="lib-empty-copy">
              Add a single song, import a document, or pull lyrics from online sources. Songs added here become available across the app and dock.
            </p>
            <div className="lib-empty-actions">
              <button type="button" className="worship-add-song-btn" onClick={handleAddSong} title="Add">
                <Plus size={18} />
                Add Song
              </button>
              <button type="button" className="lib-toolbar-btn lib-toolbar-btn--secondary" onClick={handleBulkImport} title="Import songs from a document">
                <Upload size={16} />
                Import File
              </button>
              <button type="button" className="lib-toolbar-btn lib-toolbar-btn--secondary" onClick={handleOpenOnlineSearch} title="Search lyrics online">
                <Globe size={16} />
                Search Online
              </button>
            </div>
          </div>
        ))}

      {/* Songs Grid */}
      {visible.length > 0 && (
        <>
          <PremiumContentGate
            items={displayedSongs}
            limit={songLimit}
            plan={effectivePlan}
            upgradeTarget="songs"
            entityName="songs"
            className="worship-song-grid"
          >
            {({ all, gatedIds }) =>
              all.map((s) => {
                const isGated = gatedIds.has(s.id);
                const firstSlide = s.slides?.[0];
                const sectionLabel = firstSlide?.label
                  ? (firstSlide.label.endsWith(":") ? firstSlide.label : `${firstSlide.label}:`)
                  : "Verse 1:";
                const lines = firstNLines(firstSlide?.content || s.lyrics || "", 2);

                return (
                  <div
                    key={s.id}
                    className={`worship-song-card ${isGated ? "worship-song-card--gated" : ""}`}
                    onClick={isGated ? () => setShowUpgradeModal(true) : undefined}
                    role={isGated ? "button" : undefined}
                    tabIndex={isGated ? 0 : undefined}
                  >
                    <div className="worship-song-card-body">
                      <div className="worship-song-card-top">
                        <div className="worship-song-card-icon">
                          <ListMusic size={22} />
                        </div>
                        <div className="worship-song-card-header">
                          <h4 className="worship-song-card-title" title={s.metadata.title}>
                            {s.metadata.title}
                          </h4>
                          <span className="worship-song-card-section">{sectionLabel}</span>
                          {lines[0] && (
                            <p className="worship-song-card-line worship-song-card-line--primary" title={lines[0]}>
                              {lines[0]}
                            </p>
                          )}
                        </div>
                      </div>

                      {lines[1] && (
                        <p className="worship-song-card-line worship-song-card-line--secondary" title={lines[1]}>
                          {lines[1]}
                        </p>
                      )}
                    </div>

                    {isGated ? (
                      <div className="lib-song-gated-badge" style={{ marginTop: "14px" }}>
                        <Lock size={14} />
                        <span>Upgrade</span>
                      </div>
                    ) : (
                      <div className="worship-song-card-bottom">
                        <button
                          type="button"
                          className="worship-song-view-btn"
                          onClick={() => setEditSong(s)}
                          title={`View ${s.metadata.title}`}
                        >
                          <span>View</span>
                          <ChevronRight size={14} />
                        </button>

                        <div className="worship-card-menu-container">
                          <button
                            type="button"
                            className="worship-song-menu-btn"
                            aria-label={`Options for ${s.metadata.title}`}
                            title="More options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveCardMenuId((prev) => (prev === s.id ? null : s.id));
                            }}
                          >
                            <MoreHorizontal size={16} />
                          </button>

                          {activeCardMenuId === s.id && (
                            <div className="worship-card-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="worship-card-dropdown-item"
                                onClick={() => {
                                  setActiveCardMenuId(null);
                                  setEditSong(s);
                                }}
                              >
                                <Edit size={14} />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                className="worship-card-dropdown-item worship-card-dropdown-item--danger"
                                onClick={() => {
                                  setActiveCardMenuId(null);
                                  void handleArchive(s.id);
                                }}
                              >
                                <Archive size={14} />
                                <span>Archive</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            }
          </PremiumContentGate>

          {displayLimit < visible.length && (
            <div className="lib-songs-load-more-container">
              <button
                type="button"
                className="lib-toolbar-btn lib-toolbar-btn--secondary lib-load-more-btn"
                onClick={() => setDisplayLimit((prev) => Math.min(visible.length, prev + SONGS_PER_PAGE))}
              >
                <ChevronDown size={18} />
                Load More Songs ({visible.length - displayLimit} remaining)
              </button>
            </div>
          )}
          <div ref={sentinelRef} className="lib-songs-sentinel" aria-hidden="true" />

          {!isSongUnlimited && visible.length >= songLimit && (
            <div
              className="lib-upgrade-banner"
              onClick={() => setShowUpgradeModal(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setShowUpgradeModal(true);
              }}
            >
              <div className="lib-upgrade-banner-icon">
                <Lock size={18} />
              </div>
              <div className="lib-upgrade-banner-body">
                <span className="lib-upgrade-banner-title">
                  Song limit reached — {songLimit} of {songLimit}
                </span>
                <span className="lib-upgrade-banner-hint">
                  Upgrade to upload more songs and unlock additional features
                </span>
              </div>
              <span className="lib-upgrade-banner-cta">Upgrade</span>
            </div>
          )}
        </>
      )}
    </div>

      {showOnlineSearchModal && (
        <div className="lib-modal-backdrop" onClick={() => setShowOnlineSearchModal(false)}>
          <div
            className="lib-song-modal lib-online-search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-lyrics-search-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lib-add-modal-header">
              <div>
                <h3 id="online-lyrics-search-title">Search Online Lyrics</h3>
                <p className="lib-online-search-subtitle">Find a song, then review the lyrics before saving it.</p>
              </div>
              <button
                type="button"
                className="lib-modal-close-btn"
                aria-label="Close online lyrics search"
                onClick={() => setShowOnlineSearchModal(false)}
                title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="lib-song-modal-body lib-online-search-modal-body">
              <div className="lib-search-wrap lib-online-search-wrap">
                <input
                  className="lib-search-input"
                  type="text"
                  aria-label="Search online lyrics"
                  placeholder="Search title, artist, lyrics, or paste a Spotify track link..."
                  value={onlineSearchQuery}
                  autoFocus
                  onChange={(e) => setOnlineSearchQuery(e.target.value)}
                />
                {onlineSearchQuery && (
                  <button
                    type="button"
                    className="lib-search-clear"
                    onClick={() => setOnlineSearchQuery("")}
                    aria-label="Clear online lyrics search"
                    title="Clear online lyrics search"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>

              <div className="lib-online-results">
                {onlineSearchState === "loading" && (
                  <div className="lib-online-status">Searching online lyrics…</div>
                )}

                {onlineSearchState !== "loading" && onlineSearchMessage && (
                  <div className={`lib-online-status${onlineSearchState === "error" ? " error" : ""}`}>
                    {onlineSearchMessage}
                  </div>
                )}

                {onlineSearchState === "idle" && !onlineSearchQuery.trim() && (
                  <div className="lib-online-status">Search by song title, artist, lyrics, or Spotify track link.</div>
                )}

                {onlineSearchResults.map((result) => {
                  const importedSong = findImportedSong(result);
                  const actionLabel = importedSong ? "Open" : "Import";

                  return (
                    <div key={result.id} className="lib-online-result-row">
                      <div className="lib-song-icon">
                        <Icon name="lyrics" size={20} />
                      </div>

                      <div className="lib-song-content">
                        <div className="lib-song-title-row">
                          <h3 className="lib-song-title">{result.title}</h3>
                          {result.artist && (
                            <span className="lib-song-artist-badge">{result.artist}</span>
                          )}
                          <span className="lib-song-source-badge">{result.sourceName}</span>
                          {importedSong && <span className="lib-song-imported-badge">Imported</span>}
                        </div>
                        <p className="lib-song-lyric-line">{result.preview || "No preview available yet."}</p>
                      </div>

                      <button
                        type="button"
                        className="lib-online-action"
                        onClick={() => handleOpenOnlineImport(result)}
                        title={actionLabel}>
                        {actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}


      {showArchiveModal && (
        <div className="lib-modal-backdrop" onClick={() => setShowArchiveModal(false)}>
          <div className="lib-song-modal lib-archive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lib-add-modal-header">
              <h3>Archived Songs</h3>
              <button className="lib-modal-close-btn" onClick={() => setShowArchiveModal(false)} title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="lib-song-modal-body lib-archive-modal-body">
              {archivedSongs.length === 0 ? (
                <div className="lib-empty lib-empty--compact">
                  <Icon name="archive" size={44} style={{ opacity: 0.28 }} />
                  <p>No archived songs yet</p>
                </div>
              ) : (
                <div className="lib-archive-list">
                  {archivedSongs.map((song) => {
                    const lines = firstNLines(song.lyrics, 2);
                    return (
                      <div className="lib-archive-row" key={song.id}>
                        <div className="lib-song-icon">
                          <Icon name="lyrics" size={20} />
                        </div>

                        <div className="lib-song-content">
                          <div className="lib-song-title-row">
                            <h3 className="lib-song-title">{song.metadata.title}</h3>
                            {song.metadata.artist && (
                              <span className="lib-song-artist-badge">{song.metadata.artist}</span>
                            )}
                          </div>
                          {song.archivedAt && (
                            <p className="lib-archive-meta">
                              Archived {new Date(song.archivedAt).toLocaleString()}
                            </p>
                          )}
                          {lines[0] && <p className="lib-song-lyric-line">{lines[0]}</p>}
                          {lines[1] && <p className="lib-song-lyric-line lib-song-lyric-line--faded">{lines[1]}</p>}
                        </div>

                        <div className="lib-song-meta">
                          <span className="lib-song-slides-badge">
                            {song.slides.length} slide{song.slides.length !== 1 ? "s" : ""}
                          </span>
                        </div>

                        <div className="lib-archive-row-actions">
                          <button
                            type="button"
                            className="lib-archive-btn"
                            title="Put this song back in your library"
                            onClick={() => handleRestore(song.id)}
                          >
                            <Icon name="replay" size={15} />
                            <span>Restore</span>
                          </button>
                          <button
                            type="button"
                            className="lib-archive-btn lib-archive-btn--danger"
                            title="Delete this song for good"
                            onClick={() => setDeleteConfirmId(song.id)}
                          >
                            <Icon name="delete" size={15} />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lib-add-modal-footer">
              <button className="lib-modal-cancel-btn" onClick={() => setShowArchiveModal(false)} title="Close">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete an archived song for good */}
      {deleteConfirmId && (
        <ModalDialog
          tone="danger"
          icon={<Icon name="delete" size={26} />}
          title="Delete this song for good?"
          onClose={() => setDeleteConfirmId(null)}
          actions={[
            { label: "Cancel", onClick: () => setDeleteConfirmId(null), variant: "ghost", autoFocus: true },
            { label: "Delete song", onClick: () => void handlePermanentDelete(deleteConfirmId), variant: "danger" },
          ]}
        >
          &ldquo;{archivedSongs.find((song) => song.id === deleteConfirmId)?.metadata.title ?? "This song"}&rdquo; and its
          lyrics will be removed from this computer. This can&apos;t be undone.
        </ModalDialog>
      )}

      {/* Add Song Modal */}
      {showAddModal && (
        <WorshipSongModal onClose={() => setShowAddModal(false)} onSave={handleSaveComplete} />
      )}

      {pendingOnlineImport && (
        <OnlineLyricsImportModal
          result={pendingOnlineImport}
          saving={savingOnlineImport}
          onClose={() => setPendingOnlineImport(null)}
          onImport={(draft) => void handleImportOnlineSong(draft)}
        />
      )}

      {/* Edit Song Modal */}
      {editSong && (
        <WorshipSongModal song={editSong} onClose={() => setEditSong(null)} onSave={handleSaveComplete} />
      )}

      {/* Bulk Import Modal */}
      {bulkImportOpen && (
        <BulkImportModal
          onClose={() => setBulkImportOpen(false)}
          onImported={() => {
            void reload();
          }}
        />
      )}

      {/* EasyWorship 1-Click Import Modal */}
      {easyWorshipModalOpen && (
        <EasyWorshipOneClickImportModal
          onClose={() => setEasyWorshipModalOpen(false)}
          onImported={() => {
            void reload();
          }}
        />
      )}

      {showUpgradeModal && (
        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          feature="songs"
          requiredPlan={effectivePlan === "free" ? "basic" : "growth"}
          currentPlan={effectivePlan}
          message={`Your ${effectivePlan.charAt(0).toUpperCase() + effectivePlan.slice(1)} plan allows up to ${songLimit} songs. Upgrade for more.`}
        />
      )}
    </>
  );
}
