// ────────────────────────────────────────────────────────────────────────────
// Transcript Library Page
//
// A completely separate module from Live Speech-to-Scripture.
// Manages completed transcripts: import, search, filter, export, translate.
// ────────────────────────────────────────────────────────────────────────────

import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Globe,
  LayoutGrid,
  List,
  Lock,
  Mic,
  MoreVertical,
  Tag,
  Timer,
  Trash2,
  Wand2,
  X,
} from "../components/icons/NativeIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./TranscriptLibraryPage.css";
import ModalDialog from "../components/ModalDialog";

import {
  deleteTranscript,
  formatDuration,
  getTranscriptStats,
  loadTranscripts,
} from "../transcripts/transcriptService";
import type {
  Transcript,
  TranscriptFilters,
  TranscriptLibraryStats,
} from "../transcripts/transcriptTypes";

import { useAuth } from "../contexts/AuthContext";
import { checkEntitlementSync, getEffectivePlan } from "../services/entitlementClient";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import { onCreditChange, syncCreditsWithBackend } from "../services/credits";
import CreditsDisplay from "../components/CreditsDisplay";

// ── Source type labels ───────────────────────────────────────────────────────

function useSourceLabels(t: (key: string) => string): Record<string, string> {
  return useMemo(() => ({
    "imported-audio": t("transcript.source.importedAudio"),
    "imported-video": t("transcript.source.importedVideo"),
    uploaded: t("transcript.source.uploaded"),
    transcription: t("transcript.source.liveSession"),
  }), [t]);
}

// ── Component ────────────────────────────────────────────────────────────────

interface TranscriptLibraryPageProps {
  onOpenTranscript?: (id: string) => void;
  onNewSession?: () => void;
}

export default function TranscriptLibraryPage({
  onOpenTranscript,
  onNewSession,
}: TranscriptLibraryPageProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const effectivePlan = getEffectivePlan(user);
  const sourceLabels = useSourceLabels(t);

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [stats, setStats] = useState<TranscriptLibraryStats>({
    totalSessions: 0,
    totalDurationFormatted: "0m",
    totalScriptures: 0,
    usedThisMonth: "0m",
  });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<TranscriptFilters>({
    search: "",
    language: "",
    sourceType: "",
    sortBy: "createdAt",
    sortDir: "desc",
  });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "list">("list");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const perPage = 8;

  // ── Plan enforcement ──────────────────────────────────────────────────
  const isFreePlan = effectivePlan === "free" || !effectivePlan;
  const entitlementResult = useMemo(
    () => checkEntitlementSync("speechToScripture", effectivePlan),
    [effectivePlan],
  );
  const canStartSession = entitlementResult.allowed;

  // ── Credits tracking ──────────────────────────────────────────────────
  const hasUnlimitedPlan = effectivePlan === "ambassador" || effectivePlan === "unlimited";
  const [creditRefreshKey, setCreditRefreshKey] = useState(0);

  useEffect(() => {
    if (hasUnlimitedPlan) return;
    void syncCreditsWithBackend().then(() => {
      setCreditRefreshKey((k) => k + 1);
    });
    const unsub = onCreditChange(() => {
      setCreditRefreshKey((k) => k + 1);
    });
    return unsub;
  }, [hasUnlimitedPlan]);

  // ── Stat card config ──────────────────────────────────────────────────
  const statDefs = useMemo(() => [
    { key: "total", label: t("transcript.stats.totalSessions"), icon: <FileText size={22} />, color: "indigo", getValue: (s: TranscriptLibraryStats) => String(s.totalSessions) },
    { key: "used", label: t("transcript.stats.usedThisMonth"), icon: <Clock size={22} />, color: "blue", getValue: (s: TranscriptLibraryStats) => s.usedThisMonth },
    { key: "scriptures", label: t("transcript.stats.scripturesDetected"), icon: <BookOpen size={22} />, color: "green", getValue: (s: TranscriptLibraryStats) => String(s.totalScriptures) },
    { key: "duration", label: t("transcript.stats.totalDuration"), icon: <Timer size={22} />, color: "purple", getValue: (s: TranscriptLibraryStats) => s.totalDurationFormatted },
  ], [t]);

  // ── Load data ────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    const [data, statsData] = await Promise.all([loadTranscripts(), getTranscriptStats()]);
    setTranscripts(data);
    setStats(statsData);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Filtering & sorting ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = [...transcripts];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (tr) =>
          tr.title.toLowerCase().includes(q) ||
          tr.church.toLowerCase().includes(q) ||
          tr.transcriptText.toLowerCase().includes(q),
      );
    }
    if (filters.language) {
      list = list.filter((tr) => tr.language === filters.language);
    }
    if (filters.sourceType) {
      list = list.filter((tr) => tr.sourceType === filters.sourceType);
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (filters.sortBy === "title") cmp = a.title.localeCompare(b.title);
      else if (filters.sortBy === "church") cmp = a.church.localeCompare(b.church);
      else if (filters.sortBy === "durationSeconds") cmp = a.durationSeconds - b.durationSeconds;
      else cmp = a.createdAt.localeCompare(b.createdAt);
      return filters.sortDir === "desc" ? -cmp : cmp;
    });

    return list;
  }, [transcripts, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [filters.search, filters.language, filters.sourceType]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async (e: React.MouseEvent, tr: Transcript) => {
    e.stopPropagation();

    if (isFreePlan) {
      void openDashboardSubscriptionPlans();
      return;
    }

    setDownloadingId(tr.id);

    try {
      const blob = new Blob([tr.transcriptText || ""], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tr.title.replace(/[^a-zA-Z0-9 ]/g, "_").replace(/\s+/g, "_")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* noop */ }

    setTimeout(() => {
      setDownloadingId(null);
      setDoneId(tr.id);
      setTimeout(() => setDoneId(null), 2000);
    }, 800);
  }, [isFreePlan]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setDeletingId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingId) return;
    await deleteTranscript(deletingId);
    setDeletingId(null);
    refresh();
  }, [deletingId, refresh]);

  const cancelDelete = useCallback(() => {
    setDeletingId(null);
  }, []);

  const toggleSort = useCallback((field: TranscriptFilters["sortBy"]) => {
    setFilters((f) => ({
      ...f,
      sortBy: field,
      sortDir: f.sortBy === field && f.sortDir === "desc" ? "asc" : "desc",
    }));
  }, []);

  const handleNewSessionClick = useCallback(() => {
    if (!canStartSession) {
      void openDashboardSubscriptionPlans();
      return;
    }
    onNewSession?.();
  }, [canStartSession, onNewSession]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="tl-scroll-content">
      <div className="tl-container">

        {/* ── Header ── */}
        <header className="tl-header" data-transcript-tutorial="welcome">
          <div>
            <h1 className="tl-title">{t("transcript.title")}</h1>
            <p className="tl-subtitle">{t("transcript.subtitle")}</p>
          </div>
          <div className="tl-header-actions">
            {!hasUnlimitedPlan && <CreditsDisplay userId={user?.id} refreshKey={creditRefreshKey} />}
            <div className="tl-search-wrapper" data-transcript-tutorial="search">
              <input
                type="text"
                className="tl-search-input"
                placeholder={t("transcript.searchPlaceholder")}
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              />
              {filters.search && (
                <button type="button" className="tl-search-clear" onClick={() => setFilters((f) => ({ ...f, search: "" }))} title={t("transcript.tooltip.clearSearch")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`tl-btn tl-btn-primary${!canStartSession ? " tl-btn--locked" : ""}`}
              onClick={handleNewSessionClick}
              title={canStartSession ? t("transcript.tooltip.newSession") : t("transcript.tooltip.upgradeRequired")}
            >
              {!canStartSession && <Lock size={14} />}
              <Mic size={16} /> Start Recording
            </button>
          </div>
        </header>

        {/* ── Stats Grid ── */}
        <section className="tl-stats-grid" data-transcript-tutorial="stats">
          {statDefs.map((def) => (
            <div key={def.key} className={`tl-stat-card tl-stat--${def.color}`}>
              <div className="tl-accent-bar" />
              <div className="tl-stat-icon">
                {def.icon}
              </div>
              <div>
                <div className="tl-stat-value">{def.getValue(stats)}</div>
                <div className="tl-stat-label">{def.label}</div>
              </div>
            </div>
          ))}
        </section>

        {/* ── Data Table ── */}
        <section className="tl-table-section">

          {/* Filters */}
          <div className="tl-table-filters" data-transcript-tutorial="filters">
            <button type="button" className="tl-filter-btn" title={t("transcript.tooltip.filterLanguage")}>
              <Globe size={14} /> {t("transcript.filter.allLanguages")} <ChevronDown size={12} />
            </button>
            <button type="button" className="tl-filter-btn" title={t("transcript.tooltip.filterTime")}>
              <Calendar size={14} /> {t("transcript.filter.allTime")} <ChevronDown size={12} />
            </button>
            <button type="button" className="tl-filter-btn" title={t("transcript.tooltip.filterService")}>
              <Tag size={14} /> {t("transcript.filter.allServices")} <ChevronDown size={12} />
            </button>
            <div className="tl-view-toggles" data-transcript-tutorial="view-toggle">
              <button
                type="button"
                className={`tl-view-btn${view === "list" ? " active" : ""}`}
                onClick={() => setView("list")}
                title={t("transcript.tooltip.listView")}
              >
                <List size={16} />
              </button>
              <button
                type="button"
                className={`tl-view-btn${view === "grid" ? " active" : ""}`}
                onClick={() => setView("grid")}
                title={t("transcript.tooltip.gridView")}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>

          {/* Table Header */}
          <div className="tl-table-header">
            <div className="tl-th-name">{t("transcript.table.sessionName")}</div>
            <div className="tl-th-date" onClick={() => toggleSort("createdAt")}>
              {t("transcript.table.date")} <ChevronDown size={10} />
            </div>
            <div className="tl-th-duration">{t("transcript.table.duration")}</div>
            <div className="tl-th-scriptures">{t("transcript.table.scriptures")}</div>
            <div className="tl-th-language">{t("transcript.table.language")}</div>
            <div className="tl-th-actions">{t("transcript.table.actions")}</div>
          </div>

          {/* Table Body */}
          <div className="tl-table-body" data-transcript-tutorial="table">
            {loading ? (
              <div className="tl-empty-state">
                <Timer size={32} className="tl-empty-icon" />
                <span>{t("transcript.loading")}</span>
              </div>
            ) : paged.length === 0 ? (
              <div className="tl-empty-state">
                <FileText size={32} className="tl-empty-icon" />
                <span>{filters.search ? t("transcript.empty.noMatch") : t("transcript.empty.noTranscripts")}</span>
                {!filters.search && (
                  <button className="tl-btn tl-btn-primary tl-empty-action" onClick={handleNewSessionClick}>
                    <Mic size={16} /> {t("transcript.newSession")}
                  </button>
                )}
              </div>
            ) : (
              paged.map((tr) => (
                <div
                  key={tr.id}
                  className="tl-table-row"
                  onClick={() => onOpenTranscript?.(tr.id)}
                >
                  {/* Name */}
                  <div className="tl-cell-name">
                    <div className="tl-icon-circle">
                      <Mic size={16} />
                    </div>
                    <div className="tl-name-block">
                      <div className="tl-name-text">{tr.title}</div>
                      <div className="tl-sub-text">{tr.church || sourceLabels[tr.sourceType] || tr.sourceType}</div>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="tl-cell-date">
                    <div>{new Date(tr.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    <div className="tl-sub-text">{new Date(tr.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                  </div>

                  {/* Duration */}
                  <div className="tl-cell-duration">
                    {formatDuration(tr.durationSeconds)}
                  </div>

                  {/* Scriptures */}
                  <div className="tl-cell-scriptures">
                    <div className="tl-matches-count">{tr.scriptures.length}</div>
                    <div className="tl-matches-label">{t("transcript.matches")}</div>
                  </div>

                  {/* Language */}
                  <div className="tl-cell-language">
                    <div className="tl-dot" />
                    {tr.language || t("transcript.defaultLanguage")}
                  </div>

                  {/* Actions */}
                  <div className="tl-cell-actions" onClick={(e) => e.stopPropagation()}>

                    <button
                      type="button"
                      className={`tl-action-icon${isFreePlan ? " tl-action-icon--locked" : ""}`}
                      title={isFreePlan ? t("transcript.tooltip.downloadLocked", "Downloading transcripts requires a paid plan. Click to upgrade.") : t("transcript.tooltip.download")}
                      aria-label={isFreePlan ? "Upgrade to download transcript" : "Download transcript"}
                      data-transcript-tutorial="download"
                      onClick={(e) => handleDownload(e, tr)}
                      style={{ color: doneId === tr.id ? "var(--success)" : undefined }}
                      disabled={downloadingId !== null || doneId === tr.id}
                    >
                      {downloadingId === tr.id ? (
                        <div className="tl-spinner" />
                      ) : doneId === tr.id ? (
                        <CheckCircle2 size={16} />
                      ) : isFreePlan ? (
                        <div className="tl-action-locked-badge-wrap">
                          <Download size={15} />
                          <Lock size={9} className="tl-action-lock-badge" />
                        </div>
                      ) : (
                        <Download size={16} />
                      )}
                    </button>

                    <div className="tl-menu-wrapper" data-transcript-tutorial="more-actions">
                      <button
                        type="button"
                        className="tl-action-icon"
                        title={t("transcript.tooltip.moreActions")}
                        aria-label="More actions"
                        onClick={() => setMenuOpenId(menuOpenId === tr.id ? null : tr.id)}
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpenId === tr.id && (
                        <div className="tl-dropdown">
                          <button type="button" className="tl-dropdown-item" onClick={(e) => handleDelete(e, tr.id)} title={t("transcript.tooltip.delete")}>
                            <Trash2 size={14} /> {t("transcript.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Table Footer */}
          {filtered.length > 0 && (
            <div className="tl-table-footer">
              <div className="tl-pagination-info">
                {t("transcript.pagination.showing", {
                  from: Math.min((page - 1) * perPage + 1, filtered.length),
                  to: Math.min(page * perPage, filtered.length),
                  total: filtered.length,
                })}
              </div>
              <div className="tl-pagination-controls">
                <button
                  className="tl-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  title={t("transcript.tooltip.prevPage")}
                >
                  <ChevronDown size={16} style={{ transform: "rotate(90deg)" }} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    className={`tl-page-btn${n === page ? " active" : ""}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                ))}
                <button
                  className="tl-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  title={t("transcript.tooltip.nextPage")}
                >
                  <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Promo Card ── */}
        <div className="tl-promo-card">
          <div className="tl-promo-glow" />
          <div className="tl-promo-content">
            <div className="tl-promo-icon-box">
              <Wand2 size={22} />
            </div>
            <div>
              <h3 className="tl-promo-title">{t("transcript.promo.title")}</h3>
              <p className="tl-promo-desc">{t("transcript.promo.desc")}</p>
            </div>
          </div>
          <button
            className={`tl-btn tl-btn-primary${!canStartSession ? " tl-btn--locked" : ""}`}
            onClick={handleNewSessionClick}
            title={canStartSession ? t("transcript.tooltip.newSession") : t("transcript.tooltip.upgradeRequired")}
          >
            {!canStartSession && <Lock size={14} />}
            <Mic size={16} /> {t("transcript.newSession")}
          </button>
        </div>

        {/* ── Delete Confirmation ── */}
        {deletingId && (
          <ModalDialog
            tone="danger"
            icon={<Trash2 size={26} />}
            title={t("transcript.deleteConfirm.title")}
            onClose={cancelDelete}
            actions={[
              { label: t("common.cancel"), onClick: cancelDelete, variant: "ghost", autoFocus: true, title: t("transcript.tooltip.cancelDelete") },
              { label: t("transcript.delete"), onClick: () => void confirmDelete(), variant: "danger", title: t("transcript.tooltip.confirmDelete") },
            ]}
          >
            {t("transcript.deleteConfirm.message")}
          </ModalDialog>
        )}

      </div>
    </div>
  );
}
