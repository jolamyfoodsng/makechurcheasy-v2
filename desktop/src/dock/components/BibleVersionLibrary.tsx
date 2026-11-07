/**
 * BibleVersionLibrary.tsx — App-store style Bible version selector & in-dock downloader
 *
 * Combines installed version selection, catalog search, and in-dock Bible downloading
 * into a single fast workflow for basic, growth, and premium operators.
 * Enforces plan-based bible version limits for free users while unlocking downloads
 * directly inside the dock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { getDockPlan, showUpgradeModal } from "../dockEntitlement";
import { checkEntitlementSync } from "../../services/entitlementClient";
import {
  searchDockBibleCatalog,
  downloadBibleInDock,
  type CatalogBibleItem,
} from "../dockBibleCatalog";
import { fitPopover } from "../useKeepInViewport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BibleVersionLibraryProps {
  /** Currently selected translation abbreviation */
  activeTranslation: string;
  /** Available installed translations from parent */
  availableTranslations: Array<{ value: string; label: string; language?: string }>;
  /** Called when user selects a different installed translation */
  onVersionChange: (version: string) => void;
  /** Callback to refresh translations after download */
  onTranslationsReload?: () => Promise<void> | void;
  /** Disable the selector when compare mode is active */
  disabled?: boolean;
}

const LANGUAGE_TAGS: Record<string, string> = {
  akan: "AKA",
  arabic: "ARA",
  english: "",
  french: "FRA",
  francais: "FRA",
  hausa: "HAU",
  igbo: "IBO",
  portuguese: "POR",
  portugues: "POR",
  spanish: "SPA",
  twi: "TWI",
  yoruba: "YOR",
};

const VERSION_PANEL_WIDTH = 260;

function normalizeLanguageText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getLanguageTag(translation: { value?: string; label?: string; abbr?: string; name?: string; language?: string }): string {
  const language = normalizeLanguageText(translation.language || "");
  if (language && Object.prototype.hasOwnProperty.call(LANGUAGE_TAGS, language)) {
    return LANGUAGE_TAGS[language];
  }

  const code = translation.value || translation.abbr || "";
  const name = translation.label || translation.name || "";
  const label = normalizeLanguageText(`${code} ${name}`);

  if (label.includes("yoruba") || code === "1B" || code === "2B") return "YOR";
  if (label.includes("french") || label.includes("francais")) return "FRA";
  if (label.includes("portuguese") || label.includes("portugues")) return "POR";
  if (label.includes("spanish") || label.includes("espanol")) return "SPA";
  if (label.includes("igbo")) return "IBO";
  if (label.includes("hausa")) return "HAU";
  if (label.includes("akan")) return "AKA";
  if (label.includes("twi")) return "TWI";
  return "";
}

interface DownloadStatus {
  progress: number;
  status: "downloading" | "parsing" | "done" | "error";
  error?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BibleVersionLibrary({
  activeTranslation,
  availableTranslations,
  onVersionChange,
  onTranslationsReload,
  disabled = false,
}: BibleVersionLibraryProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [panelAlign, setPanelAlign] = useState<"left" | "right">("left");
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadableBibles, setDownloadableBibles] = useState<CatalogBibleItem[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadStatus>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Plan-based bible version limit ──
  const plan = getDockPlan();
  const { limit: bibleVersionLimit } = checkEntitlementSync("bibleVersions", plan);
  const isUnlimited = bibleVersionLimit === -1;
  const installedCount = availableTranslations.length;
  const hasExceededLimit = !isUnlimited && installedCount > bibleVersionLimit;

  const updatePanelAlignment = useCallback(() => {
    const root = panelRef.current;
    if (!root || typeof window === "undefined") return;
    const rect = root.getBoundingClientRect();
    const viewportPadding = 8;
    const wouldOverflowRight = rect.left + VERSION_PANEL_WIDTH > window.innerWidth - viewportPadding;
    const canOpenLeft = rect.right - VERSION_PANEL_WIDTH >= viewportPadding;
    setPanelAlign(wouldOverflowRight && canOpenLeft ? "right" : "left");
  }, []);

  // ── Close on click outside ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // ── Focus search on open ──
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
      updatePanelAlignment();
    }
  }, [isOpen, updatePanelAlignment]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", updatePanelAlignment);
    return () => window.removeEventListener("resize", updatePanelAlignment);
  }, [isOpen, updatePanelAlignment]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
      setSearchQuery("");
    }
  }, [disabled]);

  // ── Load downloadable catalog Bibles when panel opens or query changes ──
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setIsCatalogLoading(true);
      try {
        const { downloadable } = await searchDockBibleCatalog(
          searchQuery,
          availableTranslations,
          plan,
        );
        if (!cancelled) {
          setDownloadableBibles(downloadable);
        }
      } catch {
        if (!cancelled) {
          setDownloadableBibles([]);
        }
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    }, searchQuery.trim() ? 200 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, searchQuery, availableTranslations, plan]);

  // ── Filter translations by search and sort (allowed first, locked after) ──
  const filteredTranslations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = availableTranslations;
    if (query) {
      list = list.filter(
        (tr) =>
          tr.value.toLowerCase().includes(query) ||
          tr.label.toLowerCase().includes(query) ||
          (tr.language ?? "").toLowerCase().includes(query) ||
          getLanguageTag({ value: tr.value, label: tr.label, language: tr.language }).toLowerCase().includes(query)
      );
    }
    if (!hasExceededLimit || isUnlimited) return list;
    // Sort: allowed versions first, then locked versions
    return [...list].sort((a, b) => {
      const ai = availableTranslations.findIndex((tr) => tr.value === a.value);
      const bi = availableTranslations.findIndex((tr) => tr.value === b.value);
      const aLocked = ai >= bibleVersionLimit;
      const bLocked = bi >= bibleVersionLimit;
      if (aLocked === bLocked) return ai - bi;
      return aLocked ? 1 : -1;
    });
  }, [availableTranslations, searchQuery, hasExceededLimit, isUnlimited, bibleVersionLimit]);

  // ── Find full name for active translation ──
  const activeTranslationInfo = useMemo(() => {
    const inst = availableTranslations.find((t) => t.value === activeTranslation);
    if (inst) return { abbr: inst.value, name: inst.label };
    return { abbr: activeTranslation, name: activeTranslation };
  }, [availableTranslations, activeTranslation]);

  // ── Handle version select ──
  const handleSelectVersion = useCallback(
    (abbr: string, locked: boolean) => {
      if (locked) {
        showUpgradeModal(
          `You've reached your Bible version limit (${bibleVersionLimit}). Upgrade your plan to unlock more versions.`
        );
        return;
      }
      onVersionChange(abbr);
      setIsOpen(false);
    },
    [onVersionChange, bibleVersionLimit]
  );

  // ── Handle In-Dock Download ──
  const handleDownloadVersion = useCallback(
    async (item: CatalogBibleItem) => {
      const { limit: limitCount } = checkEntitlementSync("bibleVersions", plan);
      const unlimited = limitCount === -1;
      const count = availableTranslations.length;

      if (!unlimited && count >= limitCount) {
        showUpgradeModal(
          `You've reached your Bible version limit (${limitCount}). Upgrade to Basic or Growth to download more versions.`
        );
        return;
      }

      setDownloadStates((prev) => ({
        ...prev,
        [item.id]: { progress: 0.05, status: "downloading" },
      }));

      try {
        await downloadBibleInDock(
          item,
          availableTranslations.length,
          (progress, status) => {
            setDownloadStates((prev) => ({
              ...prev,
              [item.id]: { progress, status },
            }));
          },
        );

        setDownloadStates((prev) => ({
          ...prev,
          [item.id]: { progress: 1, status: "done" },
        }));

        await onTranslationsReload?.();
        onVersionChange(item.abbr);

        setTimeout(() => {
          setIsOpen(false);
          setDownloadStates((prev) => {
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
        }, 800);
      } catch (err: any) {
        setDownloadStates((prev) => ({
          ...prev,
          [item.id]: {
            progress: 0,
            status: "error",
            error: err?.message || "Download failed",
          },
        }));
      }
    },
    [plan, availableTranslations.length, onTranslationsReload, onVersionChange],
  );

  return (
    <div
      className={`bible-version-library bible-version-library--align-${panelAlign}${isOpen ? " bible-version-library--open" : ""}`}
      ref={panelRef}
    >
      {/* Trigger Button */}
      <button
        className="bible-version-library__trigger"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={disabled ? t("bible.compareModeActive", "Disabled while compare mode is active") : t("bible.selectBibleVersion")}
        aria-disabled={disabled || undefined}
        aria-expanded={isOpen}
        title={disabled ? t("bible.compareModeActive", "Disabled while compare mode is active") : t("bible.selectBibleVersion")}>
        <span className="bible-version-library__trigger-abbr">
          {activeTranslationInfo.abbr}
        </span>
        <Icon name={isOpen ? "arrow_drop_up" : "arrow_drop_down"} size={16} />
      </button>

      {/* Panel */}
      {isOpen && (
        <div ref={(el) => fitPopover(el)} className="bible-version-library__panel">
          {/* Search */}
          <div className="bible-version-library__search">
            <Icon name="search" size={14} className="bible-version-library__search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="bible-version-library__search-input"
              placeholder={t("bible.searchVersions")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("bible.searchVersions")}
            />
            {searchQuery && (
              <button
                className="bible-version-library__search-clear"
                onClick={() => setSearchQuery("")}
                aria-label={t("common.clear")}
                title="Close">
                <Icon name="close" size={12} />
              </button>
            )}
          </div>

          {/* Content */}
          <div className="bible-version-library__content">
            {/* Installed Section */}
            {filteredTranslations.length > 0 && (
              <div className="bible-version-library__section">
                <div className="bible-version-library__section-header">
                  <span>{t("bible.installed", "Installed")}</span>
                  {!isUnlimited && (
                    <span className="bible-version-library__usage">
                      <span className="bible-version-library__usage-count">
                        {Math.min(installedCount, bibleVersionLimit)}
                      </span>
                      <span className="bible-version-library__usage-sep">/</span>
                      <span className="bible-version-library__usage-limit">
                        {bibleVersionLimit}
                      </span>
                    </span>
                  )}
                </div>
                <div className="bible-version-library__list">
                  {filteredTranslations.map((translation) => {
                    const origIndex = availableTranslations.findIndex(
                      (tr) => tr.value === translation.value
                    );
                    const locked =
                      hasExceededLimit && !isUnlimited && origIndex >= bibleVersionLimit;
                    const isActive = translation.value === activeTranslation;
                    const displayName =
                      translation.label.trim() && translation.label !== translation.value
                        ? translation.label
                        : t("bible.installedVersion", "Installed version");
                    const languageTag = getLanguageTag({
                      value: translation.value,
                      label: translation.label,
                      language: translation.language,
                    });

                    return (
                      <button
                        key={translation.value}
                        type="button"
                        className={[
                          "bible-version-library__row",
                          "bible-version-library__row--installed",
                          isActive && "bible-version-library__row--active",
                          locked && "bible-version-library__row--locked",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() =>
                          handleSelectVersion(translation.value, locked)
                        }
                        aria-label={`${translation.value}${languageTag ? ` ${languageTag}` : ""}${displayName ? `, ${displayName}` : ""}`}
                        title={locked ? "Upgrade to unlock" : displayName}>
                        <div className="bible-version-library__row-info" style={{ overflow: "hidden", display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="bible-version-library__row-code">
                            {translation.value}
                          </span>
                          {languageTag && (
                            <span className="bible-version-library__row-lang">
                              {languageTag}
                            </span>
                          )}
                          <span
                            className="bible-version-library__row-name"
                            style={{
                              fontSize: "11px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 120,
                            }}
                          >
                            {displayName}
                          </span>
                        </div>
                        {locked ? (
                          <span className="bible-version-library__row-premium">
                            <Icon name="lock" size={14} />
                          </span>
                        ) : isActive ? (
                          <Icon
                            name="check"
                            size={16}
                            className="bible-version-library__row-check"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Downloadable / Cloud Section */}
            {downloadableBibles.length > 0 && (
              <div className="bible-version-library__section">
                <div className="bible-version-library__section-header">
                  <span>{t("bible.availableToDownload", "Available to Download")}</span>
                  <span style={{ fontSize: "10px", color: "var(--dock-accent)", fontWeight: 700 }}>
                    {isUnlimited ? "UNLIMITED" : `${Math.max(0, bibleVersionLimit - installedCount)} AVAILABLE`}
                  </span>
                </div>
                <div className="bible-version-library__list">
                  {downloadableBibles.map((item) => {
                    const downloadState = downloadStates[item.id];
                    const isDownloading =
                      downloadState &&
                      (downloadState.status === "downloading" ||
                        downloadState.status === "parsing");
                    const isDone = downloadState?.status === "done";
                    const languageTag = getLanguageTag({
                      abbr: item.abbr,
                      name: item.name,
                      language: item.language,
                    });

                    return (
                      <div
                        key={item.id}
                        className="bible-version-library__row"
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px" }}
                      >
                        <div
                          className="bible-version-library__row-info"
                          style={{ overflow: "hidden", display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                        >
                          <span className="bible-version-library__row-code">
                            {item.abbr}
                          </span>
                          {languageTag && (
                            <span className="bible-version-library__row-lang">
                              {languageTag}
                            </span>
                          )}
                          <span
                            className="bible-version-library__row-name"
                            style={{
                              fontSize: "11px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 110,
                            }}
                            title={item.name}
                          >
                            {item.name}
                          </span>
                        </div>

                        <div className="bible-version-library__row-action" style={{ flexShrink: 0, marginLeft: 6 }}>
                          {isDownloading ? (
                            <div className="bible-version-library__progress">
                              <div className="bible-version-library__progress-bar">
                                <div
                                  className="bible-version-library__progress-fill"
                                  style={{
                                    width: `${Math.max(10, Math.round((downloadState?.progress || 0) * 100))}%`,
                                  }}
                                />
                              </div>
                              <span className="bible-version-library__progress-text">
                                {Math.round((downloadState?.progress || 0) * 100)}%
                              </span>
                            </div>
                          ) : isDone ? (
                            <span className="bible-version-library__status bible-version-library__status--done">
                              <Icon name="check_circle" size={16} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="bible-version-library__download-btn"
                              title={t("bible.downloadVersion", "Download {{version}}", { version: item.abbr })}
                              aria-label={t("bible.downloadVersion", "Download {{version}}", { version: item.abbr })}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDownloadVersion(item);
                              }}
                            >
                              <Icon name="download" size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isCatalogLoading && (
              <div className="bible-version-library__loading">
                <Icon name="sync" size={14} className="dock-spin" />
                <span>{t("bible.searchingCatalog", "Searching Bible catalog...")}</span>
              </div>
            )}

            {/* Empty State */}
            {filteredTranslations.length === 0 && downloadableBibles.length === 0 && !isCatalogLoading && (
              <div className="bible-version-library__empty">
                <Icon name="search_off" size={20} />
                <span>{t("bible.noVersionsFound", "No versions found")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
