/**
 * BibleLibrary.tsx — Modal for browsing, downloading, and managing Bible translations
 *
 * Features:
 * - Search the remote API catalog (~1000 Bibles) — auto-search on 3+ characters
 * - Filter by language (all languages fetched from API)
 * - Download with progress bar
 * - View installed translations with delete option
 * - Import custom Bible XML files via drag-and-drop or file picker
 * - Auto-downloads top 4 on first run
 * - Horizontal list layout (no cards)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  searchCatalog,
  fetchAllLanguages,
  parseXmlToBibleData,
  getCachedCatalogResult,
  AUTO_DOWNLOAD_BIBLES,
  type CatalogResponse,
} from "../bibleApi";
import type { InstalledBible } from "../types";
import {
  getInstalledTranslations,
  saveInstalledTranslation,
  deleteInstalledTranslation,
  isFirstRun,
} from "../bibleDb";
import {
  deriveBibleAbbr,
  formatBibleFileSize,
  installBibleFromCatalog,
  isCatalogBibleInstalled,
} from "../bibleInstallService";
import { evictTranslationCache } from "../bibleData";
import { assertCompleteBibleData } from "../bibleValidation";
import Icon from "../../components/Icon";
import { useAuth } from "../../contexts/AuthContext";
import { getEffectivePlan } from "../../services/licenseService";
import { checkEntitlementSync } from "../../services/entitlementClient";
import { getDashboardSubscriptionPlansUrl, openDashboardSubscriptionPlans } from "../../services/subscriptionNavigation";

/** Auto-download bible abbreviations that cannot be deleted */
const PROTECTED_ABBRS = new Set(AUTO_DOWNLOAD_BIBLES.map(b => b.abbr));

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BibleLibraryProps {
  open: boolean;
  onClose: () => void;
  /** Called after a new translation is installed or removed so the parent can refresh */
  onTranslationsChanged?: () => void;
  mode?: "modal" | "page" | "embedded";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "browse" | "installed" | "import";

interface DownloadState {
  /** Bible catalog ID currently downloading */
  id: string;
  abbr: string;
  progress: number; // 0–1
  status: "downloading" | "parsing" | "done" | "error";
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BibleLibrary({
  open,
  onClose,
  onTranslationsChanged,
  mode = "modal",
}: BibleLibraryProps) {
  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [catalogResult, setCatalogResult] = useState<CatalogResponse | null>(
    () => getCachedCatalogResult({ page: 1, limit: 20 }),
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [installed, setInstalled] = useState<Omit<InstalledBible, "data">[]>([]);
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(new Map());
  const [autoDownloadDone, setAutoDownloadDone] = useState(false);
  const [autoDownloadRunning, setAutoDownloadRunning] = useState(false);

  // All languages from API
  const [allLanguages, setAllLanguages] = useState<string[]>([]);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");

  // Confirm-delete modal
  const [confirmDelete, setConfirmDelete] = useState<{ abbr: string; name: string } | null>(null);

  // Import state
  const [importDragging, setImportDragging] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: "idle" | "parsing" | "success" | "error"; message?: string }>({ type: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);

  // ── Plan enforcement ──
  const { user: authUser } = useAuth();
  const effectivePlan = getEffectivePlan(authUser);
  const { limit: bibleVersionLimit } = checkEntitlementSync("bibleVersions", effectivePlan);
  const isBibleUnlimited = bibleVersionLimit === -1;
  const hasReachedBibleLimit = !isBibleUnlimited && installed.length >= bibleVersionLimit;
  const showBibleUsage = !isBibleUnlimited;

  const searchRef = useRef<HTMLInputElement>(null);
  const autoSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPageMode = mode === "page";
  const isEmbeddedMode = mode === "embedded";

  // ── Load installed translations ──
  const refreshInstalled = useCallback(async () => {
    try {
      const list = await getInstalledTranslations();
      setInstalled(list);
    } catch (err) {
      console.error("Failed to load installed translations:", err);
    }
  }, []);

  useEffect(() => {
    if (open) refreshInstalled();
  }, [open, refreshInstalled]);

  // ── Fetch all languages on mount ──
  useEffect(() => {
    if (open && allLanguages.length === 0) {
      fetchAllLanguages().then(setAllLanguages).catch(console.error);
    }
  }, [open, allLanguages.length]);

  const filteredLanguages = useMemo(() => {
    const needle = languageQuery.trim().toLowerCase();
    if (!needle) return allLanguages;
    return allLanguages.filter((lang) => lang.toLowerCase().includes(needle));
  }, [allLanguages, languageQuery]);

  const languageLabel = language || "All languages";

  const selectLanguage = useCallback((nextLanguage: string) => {
    setLanguage(nextLanguage);
    setLanguageQuery("");
    setLanguageMenuOpen(false);
  }, []);

  // ── Auto-download on first run ──
  useEffect(() => {
    if (!open || autoDownloadDone || autoDownloadRunning) return;

    let cancelled = false;
    (async () => {
      try {
        const first = await isFirstRun();
        if (!first || cancelled) {
          setAutoDownloadDone(true);
          return;
        }

        setAutoDownloadRunning(true);

        for (const bible of AUTO_DOWNLOAD_BIBLES) {
          if (cancelled) break;
          try {
            await downloadBible(bible.id, bible.abbr, bible.name, "English", 0);
          } catch (err) {
            console.error(`Auto-download failed for ${bible.abbr}:`, err);
          }
        }
      } catch (err) {
        console.error("[BibleLibrary] Auto-download check failed:", err);
      } finally {
        if (!cancelled) {
          setAutoDownloadRunning(false);
          setAutoDownloadDone(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, autoDownloadDone, autoDownloadRunning]);

  // ── Search catalog ──
  const doSearch = useCallback(
    async (p = 1) => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const result = await searchCatalog({
          query: query.trim() || undefined,
          language: language.trim() || undefined,
          page: p,
          limit: 20,
        });
        setCatalogResult(result);
        setPage(p);
      } catch (err: any) {
        setCatalogError(err.message || "Search failed");
      } finally {
        setCatalogLoading(false);
      }
    },
    [query, language]
  );

  // Initial search when opening browse tab
  useEffect(() => {
    if (open && tab === "browse" && !catalogResult) {
      doSearch(1);
    }
  }, [open, tab, catalogResult, doSearch]);

  // ── Auto-search when query has 3+ characters ──
  useEffect(() => {
    if (!open || tab !== "browse") return;

    if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current);

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0 || trimmedQuery.length >= 3) {
      autoSearchTimer.current = setTimeout(() => {
        doSearch(1);
      }, trimmedQuery.length === 0 ? 150 : 350);
    }

    return () => {
      if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current);
    };
  }, [query, open, tab, doSearch]);

  // Re-search when language changes
  useEffect(() => {
    if (open && tab === "browse") {
      doSearch(1);
    }
  }, [language, open, tab, doSearch]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [languageMenuOpen]);

  // ── Download a Bible ──
  const downloadBible = useCallback(
    async (
      catalogId: string,
      abbr: string,
      name: string,
      lang: string,
      filesize: number
    ) => {
      const isInstalled = isCatalogBibleInstalled(installed, catalogId, abbr);
      if (isInstalled) return;

      const existing = downloads.get(catalogId);
      if (existing && (existing.status === "downloading" || existing.status === "parsing")) return;

      const state: DownloadState = {
        id: catalogId,
        abbr,
        progress: 0,
        status: "downloading",
      };

      setDownloads((prev) => new Map(prev).set(catalogId, state));

      try {
        const record = await installBibleFromCatalog(
          {
            id: catalogId,
            name,
            language: lang,
            filesize,
            version: abbr,
            country: "",
            filename: "",
            sha256: "",
          },
          (progressState) => {
            const frac = progressState.progress;
            const status = progressState.status === "parsing" ? "parsing" : "downloading";
            setDownloads((prev) => {
              const next = new Map(prev);
              next.set(catalogId, { ...state, progress: frac, status });
              return next;
            });
          },
        );

        setDownloads((prev) => {
          const next = new Map(prev);
          next.set(catalogId, { ...state, progress: 1, status: "done" });
          return next;
        });

        await refreshInstalled();
        onTranslationsChanged?.();

        void record;

        setTimeout(() => {
          setDownloads((prev) => {
            const next = new Map(prev);
            next.delete(catalogId);
            return next;
          });
        }, 3000);
      } catch (err: any) {
        const message = err?.message || "Download failed";
        if (/already installed/i.test(message)) {
          setDownloads((prev) => {
            const next = new Map(prev);
            next.delete(catalogId);
            return next;
          });
          await refreshInstalled();
          onTranslationsChanged?.();
          return;
        }

        setDownloads((prev) => {
          const next = new Map(prev);
          next.set(catalogId, {
            ...state,
            progress: 0,
            status: "error",
            error: message,
          });
          return next;
        });
      }
    },
    [installed, downloads, refreshInstalled, onTranslationsChanged]
  );

  useEffect(() => {
    if (downloads.size === 0 || installed.length === 0) return;
    setDownloads((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [catalogId, state] of next) {
        if (isCatalogBibleInstalled(installed, catalogId, state.abbr)) {
          next.delete(catalogId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [downloads.size, installed]);

  // ── Import Bible from XML file ──
  const handleImportFile = useCallback(
    async (file: File) => {
      if (hasReachedBibleLimit) {
        return;
      }
      setImportStatus({ type: "parsing", message: `Parsing ${file.name}…` });

      try {
        const text = await file.text();
        const data = parseXmlToBibleData(text);

        assertCompleteBibleData(data, file.name);
        const bookCount = Object.keys(data).length;

        // Try to extract translation name from XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/xml");
        const bibleEl = doc.querySelector("bible");
        const translationAttr = bibleEl?.getAttribute("translation") ?? "";

        // Derive abbreviation from filename or translation attribute
        const rawName = translationAttr || file.name.replace(/\.xml$/i, "");
        const abbr = rawName
          .split(/\s+/)
          .map((w) => w[0] ?? "")
          .join("")
          .toUpperCase()
          .slice(0, 6) || "CUSTOM";

        // Check if abbreviation already exists
        const existingAbbrs = new Set(installed.map((i) => i.abbr));
        let finalAbbr = abbr;
        let counter = 2;
        while (existingAbbrs.has(finalAbbr)) {
          finalAbbr = `${abbr}${counter}`;
          counter++;
        }

        const record: InstalledBible = {
          id: `custom-${Date.now()}`,
          abbr: finalAbbr,
          name: rawName || file.name,
          language: "Custom",
          data,
          downloadedAt: new Date().toISOString(),
          filesize: file.size,
        };
        await saveInstalledTranslation(record);

        await refreshInstalled();
        onTranslationsChanged?.();

        setImportStatus({
          type: "success",
          message: `"${rawName}" imported as ${finalAbbr} — ${bookCount} books found`,
        });

        setTimeout(() => setImportStatus({ type: "idle" }), 5000);
      } catch (err: any) {
        setImportStatus({
          type: "error",
          message: err.message || "Failed to parse Bible XML",
        });
      }
    },
    [installed, refreshInstalled, onTranslationsChanged, hasReachedBibleLimit]
  );

  // ── Drag & drop handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setImportDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setImportDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setImportDragging(false);

      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".xml") || file.type === "text/xml")) {
        handleImportFile(file);
      } else {
        setImportStatus({ type: "error", message: "Only .xml files are supported" });
      }
    },
    [handleImportFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
      // Reset so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleImportFile]
  );

  // ── Confirm-delete flow ──
  const handleDeleteRequest = useCallback((abbr: string, name: string) => {
    if (PROTECTED_ABBRS.has(abbr)) return; // should never happen — button is hidden
    setConfirmDelete({ abbr, name });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await deleteInstalledTranslation(confirmDelete.abbr);
      evictTranslationCache(confirmDelete.abbr);
      await refreshInstalled();
      onTranslationsChanged?.();
    } catch (err) {
      console.error("Failed to delete translation:", err);
    } finally {
      setConfirmDelete(null);
    }
  }, [confirmDelete, refreshInstalled, onTranslationsChanged]);

  // ── Keyboard ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus search on open
  useEffect(() => {
    if (open && tab === "browse") {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open, tab]);

  if (!open) return null;

  const content = (
    <div
      className={`bible-library-modal${isPageMode ? " bible-library-modal--page" : ""}${isEmbeddedMode ? " bible-library-modal--embedded" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="bible-library-header">
        <h2>
          <Icon name="library_books" size={20} />
          Bible Library
          {showBibleUsage && (
            <span className="lib-song-usage-badge" style={{ marginLeft: 8, fontSize: 11, verticalAlign: "middle" }}>
              {installed.length} / {bibleVersionLimit} versions
            </span>
          )}
        </h2>
        {isPageMode ? (
          <button className="bible-library-page-back" onClick={onClose} title="Go back">
            <Icon name="arrow_back" size={18} />
            Back to Settings
          </button>
        ) : isEmbeddedMode ? null : (
          <button className="bible-library-close" onClick={onClose} title="Close">
            <Icon name="close" size={20} />
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="bible-library-tabs">
        <button
          className={`bible-library-tab${tab === "browse" ? " active" : ""}`}
          onClick={() => setTab("browse")}
          title="Download">
          <Icon name="explore" size={20} />
          Browse &amp; Download
        </button>
        <button
          type="button"
          className={`bible-library-tab${tab === "installed" ? " active" : ""}`}
          onClick={() => setTab("installed")}
          title="Installed Bibles">
          <Icon name="download_done" size={20} />
          Installed ({installed.length})
        </button>
        {/* <button
          className={`bible-library-tab${tab === "import" ? " active" : ""}`}
          onClick={() => setTab("import")}
         title="Import">
          <Icon name="upload_file" size={20} />
          Import
        </button> */}
      </div>

      {/* ── Free Plan Banner ── */}
      {effectivePlan === "free" && (
        <div className={`bible-free-mode-banner${hasReachedBibleLimit ? " bible-free-mode-banner--limit" : ""}`}>
          <div className="bible-free-mode-banner__left">
            <div className="bible-free-mode-banner__icon">
              <Icon name={hasReachedBibleLimit ? "warning" : "library_books"} size={18} />
            </div>
            <div className="bible-free-mode-banner__body">
              <div className="bible-free-mode-banner__header">
                <span className="bible-free-mode-banner__tag">Free Plan</span>
                <span className="bible-free-mode-banner__limit-count">
                  {installed.length} / {bibleVersionLimit} versions
                </span>
              </div>
              <p className="bible-free-mode-banner__text">
                {hasReachedBibleLimit ? (
                  <>
                    You have reached your Free plan limit ({installed.length}/{bibleVersionLimit} versions).
                    To add new translations, delete versions you don't need in the <strong>Installed</strong> tab, or upgrade to unlock unlimited translations.
                  </>
                ) : (
                  <>
                    Your Free plan gives you access to up to {bibleVersionLimit} offline Bible versions.
                    You can delete any installed translation at any time to try others, or upgrade for unlimited versions.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="bible-free-mode-banner__actions">
            {tab !== "installed" && installed.length > 0 && (
              <button
                type="button"
                className="bible-free-mode-banner__btn bible-free-mode-banner__btn--secondary"
                onClick={() => setTab("installed")}
              >
                Manage Installed ({installed.length})
              </button>
            )}
            <a
              href={getDashboardSubscriptionPlansUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="bible-free-mode-banner__btn bible-free-mode-banner__btn--primary"
            >
              Upgrade Plan
            </a>
          </div>
        </div>
      )}

      {/* ── Auto-download banner ── */}
      {autoDownloadRunning && (
        <div className="bible-library-auto-banner">
          <Icon name="sync" size={20} className="spin" />
          Downloading essential translations for first-time setup…
        </div>
      )}

      {/* ── Browse Tab ── */}
      {tab === "browse" && (
        <div className="bible-library-body">
          <div className="bible-library-search-row">
            <div className="bible-library-search-input-wrap">
              <Icon name="search" size={20} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search bibles… (3+ letters to auto-search)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search Bible catalog"
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSearch(1);
                }}
              />
              {query && (
                <button
                  type="button"
                  className="bible-library-search-clear"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear Bible catalog search"
                  title="Clear Bible catalog search"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>

            <div className="bible-library-lang-menu" ref={languageMenuRef}>
              <button
                type="button"
                className="bible-library-lang-trigger"
                onClick={() => setLanguageMenuOpen((current) => !current)}
                aria-label="Filter by language"
                aria-expanded={languageMenuOpen}
                title="Filter by language"
              >
                <Icon name="language" size={16} />
                <span>{languageLabel}</span>
                <Icon name={languageMenuOpen ? "expand_less" : "expand_more"} size={16} />
              </button>

              {languageMenuOpen && (
                <div className="bible-library-lang-panel">
                  <div className="bible-library-lang-search">
                    <Icon name="search" size={14} />
                    <input
                      type="text"
                      value={languageQuery}
                      onChange={(event) => setLanguageQuery(event.target.value)}
                      placeholder="Search languages..."
                      aria-label="Search languages"
                      autoFocus
                    />
                  </div>
                  <div className="bible-library-lang-list">
                    <button
                      type="button"
                      className={`bible-library-lang-option${language === "" ? " active" : ""}`}
                      onClick={() => selectLanguage("")}
                    >
                      <span>All languages</span>
                      {language === "" && <Icon name="check" size={16} />}
                    </button>

                    {filteredLanguages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`bible-library-lang-option${language === lang ? " active" : ""}`}
                        onClick={() => selectLanguage(lang)}
                      >
                        <span>{lang}</span>
                        {language === lang && <Icon name="check" size={16} />}
                      </button>
                    ))}

                    {filteredLanguages.length === 0 && (
                      <div className="bible-library-lang-empty">No languages found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Language pills */}


          {catalogError && (
            <div className="bible-library-error">
              <Icon name="error_outline" size={20} />
              <span>{catalogError}</span>
              <button
                className="bible-library-retry-btn"
                onClick={() => doSearch(page)}
                title="Retry">
                <Icon name="refresh" size={14} />
                Retry
              </button>
            </div>
          )}

          {catalogLoading && (
            <div className="bible-library-loading">
              <Icon name="sync" size={20} className="spin" />
              Searching…
            </div>
          )}

          {catalogResult && !catalogLoading && (
            <>
              <div className="bible-library-result-count">
                {catalogResult.total} Bible{catalogResult.total !== 1 ? "s" : ""} found
                {catalogResult.pages > 1 &&
                  ` — Page ${catalogResult.page} of ${catalogResult.pages}`}
              </div>

              <div className="bible-library-list">
                {catalogResult.items.map((bible) => {
                  const abbr = deriveBibleAbbr(bible);
                  const isInst = isCatalogBibleInstalled(installed, bible.id, abbr);
                  const dl = downloads.get(bible.id);

                  return (
                    <div
                      key={bible.id}
                      className={`bible-library-row${isInst ? " installed" : ""}`}
                    >
                      <div className="bible-library-row-left">
                        <span className="bible-library-row-abbr">{abbr}</span>
                        <span className="bible-library-row-name">{bible.name}</span>
                      </div>
                      <div className="bible-library-row-right">
                        <span className="bible-library-row-lang">{bible.language}</span>
                        <span className="bible-library-row-size">{formatBibleFileSize(bible.filesize)}</span>

                        {/* Status / Action */}
                        {isInst ? (
                          <span className="bible-library-row-installed">
                            <Icon name="check_circle" size={20} />
                            Installed
                          </span>
                        ) : dl?.status === "downloading" ? (
                          <div className="bible-library-row-progress">
                            <div className="bible-library-progress-bar">
                              <div
                                className="bible-library-progress-fill"
                                style={{ width: `${Math.round(dl.progress * 100)}%` }}
                              />
                            </div>
                            <span className="bible-library-row-pct">{Math.round(dl.progress * 100)}%</span>
                          </div>
                        ) : dl?.status === "parsing" ? (
                          <span className="bible-library-row-parsing">
                            <Icon name="sync" size={20} className="spin" />
                          </span>
                        ) : dl?.status === "done" ? (
                          <span className="bible-library-row-installed">
                            <Icon name="check_circle" size={20} />
                            Installed
                          </span>
                        ) : dl?.status === "error" ? (
                          <button
                            className="bible-library-row-retry"
                            onClick={() =>
                              downloadBible(bible.id, abbr, bible.name, bible.language, bible.filesize)
                            }
                            title={dl.error || "Failed"}
                          >
                            <Icon name="refresh" size={20} />
                          </button>
                        ) : (
                          <button
                            className={`bible-library-row-dl${hasReachedBibleLimit ? " bible-library-row-dl--locked" : ""}`}
                            onClick={() => {
                              if (hasReachedBibleLimit) { void openDashboardSubscriptionPlans(); return; }
                              downloadBible(bible.id, abbr, bible.name, bible.language, bible.filesize);
                            }}
                            title={hasReachedBibleLimit ? "Bible version limit reached — upgrade to add more" : "Download"}
                          >
                            <Icon name={hasReachedBibleLimit ? "lock" : "download"} size={20} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {catalogResult.pages > 1 && (
                <div className="bible-library-pagination">
                  <button
                    disabled={page <= 1}
                    onClick={() => doSearch(page - 1)}
                    title="Previous">
                    <Icon name="chevron_left" size={20} />
                    Previous
                  </button>
                  <span>
                    Page {page} / {catalogResult.pages}
                  </span>
                  <button
                    disabled={page >= catalogResult.pages}
                    onClick={() => doSearch(page + 1)}
                    title="Next">
                    Next
                    <Icon name="chevron_right" size={20} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Installed Tab ── */}
      {tab === "installed" && (
        <div className="bible-library-body">
          {effectivePlan === "free" && (
            <div className="bible-library-installed-note" style={{ marginBottom: 12, borderColor: "rgba(37, 99, 235, 0.3)", background: "rgba(37, 99, 235, 0.08)" }}>
              <Icon name="info" size={18} />
              <span>
                Free Plan ({installed.length}/{bibleVersionLimit} versions): You can delete any custom or non-default translation to make room for new downloads, or upgrade for unlimited versions.
              </span>
            </div>
          )}
          <div className="bible-library-installed-note">
            <Icon name="info" size={18} />
            <span>Installed Bible versions will appear in the Bible selector when using the Dock UI in OBS.</span>
          </div>
          {installed.length === 0 ? (
            <div className="bible-library-empty">
              <Icon name="library_books" size={20} />
              <p>No translations installed yet.</p>
              <p>Switch to the Browse tab to download Bibles.</p>
            </div>
          ) : (
            <div className="bible-library-installed-list">
              {installed.map((b) => {
                const isProtected = PROTECTED_ABBRS.has(b.abbr);
                return (
                  <div key={b.abbr} className="bible-library-installed-row">
                    <div className="bible-library-installed-info">
                      <span className="bible-library-installed-abbr">{b.abbr}</span>
                      <span className="bible-library-installed-name">
                        {b.name}
                        {isProtected && (
                          <span className="bible-library-installed-default-badge">Default</span>
                        )}
                      </span>
                      <span className="bible-library-installed-meta">
                        {b.language} · {formatBibleFileSize(b.filesize)} · Downloaded{" "}
                        {new Date(b.downloadedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="bible-library-installed-actions">
                      {!isProtected && (
                        <button
                          type="button"
                          className="bible-library-delete-btn"
                          onClick={() => handleDeleteRequest(b.abbr, b.name)}
                          title={`Delete ${b.name} (${b.abbr})`}
                          aria-label={`Delete ${b.name} (${b.abbr})`}
                        >
                          <Icon name="delete" size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Import Tab ── */}
      {tab === "import" && (
        <div className="bible-library-body">
          <div className="bible-library-import-info">
            <h3>Import Custom Bible</h3>
            <p>
              Upload a Bible in XML format. The file must follow the standard structure:
            </p>
            <pre className="bible-library-import-format">{`<bible translation="My Translation">
  <testament name="Old">
    <book number="1">
      <chapter number="1">
        <verse number="1">In the beginning...</verse>
      </chapter>
    </book>
  </testament>
</bible>`}</pre>
            <p className="bible-library-import-note">
              Book numbers 1–66 follow standard Protestant order (Genesis to Revelation).
            </p>
          </div>

          {/* Drop zone */}
          <div
            className={`bible-library-import-dropzone${importDragging ? " dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name={importStatus.type === "parsing" ? "sync" : "upload_file"} size={20} />
            {importStatus.type === "idle" && (
              <>
                <span className="bible-library-import-dropzone-text">
                  Drag &amp; drop an XML file here
                </span>
                <span className="bible-library-import-dropzone-sub">
                  or click to browse
                </span>
              </>
            )}
            {importStatus.type === "parsing" && (
              <span className="bible-library-import-dropzone-text">
                {importStatus.message}
              </span>
            )}
            {importStatus.type === "success" && (
              <span className="bible-library-import-dropzone-text bible-library-import-success">
                <Icon name="check_circle" size={20} />
                {importStatus.message}
              </span>
            )}
            {importStatus.type === "error" && (
              <span className="bible-library-import-dropzone-text bible-library-import-error">
                <Icon name="error" size={20} />
                {importStatus.message}
              </span>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xml"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </div>
      )}

      {/* ── Confirm Delete Modal ── */}
      {confirmDelete && (
        <div className="bible-library-confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="bible-library-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bible-library-confirm-header">
              <Icon name="warning" size={20} style={{ color: "var(--error)" }} />
              <h3>Delete Translation</h3>
            </div>
            <p className="bible-library-confirm-text">
              Are you sure you want to delete <strong>{confirmDelete.name}</strong> ({confirmDelete.abbr})?
              This cannot be undone.
            </p>
            <div className="bible-library-confirm-actions">
              <button
                type="button"
                className="bible-library-confirm-cancel"
                onClick={() => setConfirmDelete(null)}
                title="Cancel">
                Cancel
              </button>
              <button
                type="button"
                className="bible-library-confirm-delete"
                onClick={handleDeleteConfirm}
                title="Delete">
                <Icon name="delete" size={16} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );

  if (isPageMode) {
    return <div className="bible-library-page-shell">{content}</div>;
  }

  if (isEmbeddedMode) {
    return <div className="bible-library-page-shell">{content}</div>;
  }

  return (
    <div className="bible-library-backdrop" onClick={onClose}>
      {content}
    </div>
  );
}
