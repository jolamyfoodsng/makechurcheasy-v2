/**
 * DockWorshipTab.tsx — Worship tab for the MakeChurchEazy Dock
 *
 * Dense operator console for song browsing, lyric cueing, and live transport.
 */

import { lazy, Suspense, memo, useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, startTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { DockStagedItem, DockWorshipSection } from "../dockTypes";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import type { DockSearchPlacement } from "../dockSearchPlacement";
import {
  dockObsClient,
  type DockOverlayFitOptions,
  type DockTabContentPushData,
} from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import {
  DOCK_THEME_SYNC_EVENT,
  type DockThemeSyncPayload,
} from "../dockThemeSync";
import {
  DEFAULT_THEME_SETTINGS,
  LOWER_THIRD_SIZE_PRESETS,
  type BibleTheme,
  type BibleThemeSettings,
} from "../../bible/types";
import { withScriptureFontFallback } from "../../bible/scriptureFont";
import { dockClient } from "../../services/dockBridge";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import { track } from "../../services/analytics";
import { trackWorshipSongPresented, trackWorshipSongCreated, trackOverlayModeSwitched } from "../../services/tracking";
import {
  createWorshipDockSongSaveCommand,
  loadWorshipDockSongSaveResult,
  postWorshipDockSongSaveCommand,
  type WorshipDockSongSavePayload,
} from "../../services/worshipDockInterop";
import {
  calculateReorderTargetIndex,
  extractStructuredTextTitle,
  generateSlides,
  normalizeWorshipDisplayText,
  reorderWorshipSections,
  stripLeadingVerseMarker,
} from "../../worship/slideEngine";
import { extractFirstLineAsTitle } from "../../worship/songTitleFromLyrics";
import { DEFAULT_WORSHIP_LINES_PER_SLIDE } from "../../worship/slideLayout";
import type { Song } from "../../worship/types";
import { nextAutoSongTitle, isDummyTitle } from "../../worship/songTitleAutoGen";
import { archiveSong } from "../../worship/worshipDb";
import {
  formatOnlineLyricsSearchError,
  searchOnlineSongLyrics,
  type OnlineLyricsSearchResult,
} from "../../worship/onlineLyricsService";
import { fuzzyMatch, fuzzyScore } from "../../services/fuzzySearch";
import type { DockFullscreenQuickThemeSettings } from "../components/DockFullscreenThemeQuickSettings";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";
import {
  addWorshipToActiveSchedule,
  addWholeWorshipSongToActiveSchedule,
  DOCK_SELECT_WORSHIP_SONG_EVENT,
  DOCK_SELECT_NOTE_EVENT,
  getPendingWorshipSongSelection,
  setPendingWorshipSongSelection,
} from "../dockScheduleService";
import Icon from "../DockIcon";
import LoadingScreen from "../../components/LoadingScreen";
import DockBottomToolbar from "../components/DockBottomToolbar";
import DockBottomSearchPanel from "../components/DockBottomSearchPanel";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import DockSceneRouteConfirmDialog from "../components/DockSceneRouteConfirmDialog";
import DockThemeSettingsModal from "../components/DockThemeSettingsModal";
import DockTranslationControls, {
  type DockTranslationValue,
} from "../components/DockTranslationControls";
import DockAutoAdvanceControl from "../components/DockAutoAdvanceControl";
import DockOutputQuickActions, {
  DEFAULT_DOCK_OUTPUT_QUICK_ACTIONS_TOP,
  type DockOutputLineMode,
  type DockOutputQuickSettingsPatch,
} from "../components/DockOutputQuickActions";
import DockSpellcheckTextarea from "../components/DockSpellcheckTextarea";
import { useDockTabLabelMode } from "../useDockTabLabelMode";
import { requireEntitlement } from "../dockEntitlement";
import {
  LOWER_THIRD_FIT_MIN_FONT_SIZE,
  LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
  LOWER_THIRD_FONT_SIZE_MAX,
  LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
  normalizeLowerThirdFitSettings,
} from "../lowerThirdQuickSettings";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import {
  loadDockPreference,
  readDockPreference,
  saveDockPreference,
} from "../../services/dockPreferenceStorage";
import { themeSupportsBibleOverlayMode } from "../../bible/themeVariantSupport";
import {
  DOCK_THEMES_REFRESHED_EVENT,
  findRefreshedTheme,
  themeUsesLayout,
  type DockThemesRefreshedDetail,
} from "../dockThemeRefresh";
import { normalizeCompareThemeSettings } from "../compareThemeConfig";
import { useDockSceneRoute } from "../dockSceneRouting";
import { isDockTabVisible } from "../dockTabVisibility";
import DockNotesTab from "./DockNotesTab";
import {
  getDockTranslationSourceSignature,
  getOrderedTranslationParts,
  normalizeDockTranslationOrder,
} from "../dockTranslation";
import { normalizeDockMultilineText } from "../textLineBreaks";
import {
  DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN,
  DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD,
} from "../dockQuickSizePresets";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useTextUndoRedo } from "../useTextUndoRedo";
import { pickLayoutAdjust } from "../../themes/layout/adjust";
import { layerThemeQuickDisplay, withLayerThemeQuickPatch } from "../layerThemeQuickPatch";

const DocumentSongImport = lazy(() => import("../../../others/SongImportFullprocess"));

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
  /** Themes picked for Notes on the Themes page. */
  notesProductionDefaults?: DockProductionModuleSettings;
  presentationOutputTarget?: DockPresentationOutputTarget;
  searchPlacement?: DockSearchPlacement;
  fullscreenOnly?: boolean;
  showSubtabs?: boolean;
  initialSubTab?: WorshipSubTab;
  compactVerticalNav?: boolean;
  isActive?: boolean;
}

type OverlayMode = "fullscreen" | "lower-third";

type WorshipSubTab = "worship" | "notes";

interface DockSong {
  id: string;
  hymnNumber?: string;
  title: string;
  artist: string;
  lyrics: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online" | "document";
  importSourceUrl?: string;
  autoSplit?: boolean;
  linesPerSlide?: number;
  themeId?: string;
}

interface DockWorshipPreferences {
  [key: string]: unknown;
  overlayMode?: OverlayMode;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  linesPerSlide?: number;
  fullscreenLinesPerSlide?: number;
  lowerThirdLinesPerSlide?: number;
  linesPerSlideOverride?: boolean;
  fullscreenQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettingsLinkedToFullscreen?: boolean;
  showPresentationMeta?: boolean;
  worshipFontFitMigrationVersion?: number;
  updatedAt?: string;
}

interface DockWorshipUiPreferences {
  toolbarCollapsed?: boolean;
  activeSubTab?: WorshipSubTab;
  quickActionsTop?: number;
  quickActionsLeft?: number | null;
  quickUpdateImmediately?: boolean;
  /** The song that was open when the dock was last used, so a reload can open it again. */
  lastSongId?: string;
  /** The slide that was selected in that song (selected only, never sent to the output). */
  lastSlideIndex?: number;
}

const DOCK_WORSHIP_PREFS_KEY = "ocs-dock-worship-preferences";
const DOCK_WORSHIP_PREFS_APP_KEY = "dock-worship-preferences";
const DOCK_WORSHIP_UI_PREFS_KEY = "ocs-dock-worship-ui-preferences";
const DOCK_WORSHIP_SONG_DEFAULTS_KEY = "ocs-dock-worship-song-defaults-v1";
const DOCK_WORSHIP_CACHED_SONGS_KEY = "ocs-dock-worship-cached-songs-v1";
const DOCK_WORSHIP_RECENT_SEARCHES_KEY = "ocs-dock-worship-recent-searches-v1";
const WORSHIP_FONT_FIT_MIGRATION_VERSION = 1;
const MIN_LINES_PER_SLIDE = 1;
const MAX_LINES_PER_SLIDE = 12;
// A new line entered in the song editor is a new verse/slide by default.
const DEFAULT_LINES_PER_SLIDE = DEFAULT_WORSHIP_LINES_PER_SLIDE;
const DOCK_WORSHIP_SAVE_TIMEOUT_MS = 15000;
const DOCK_WORSHIP_SAVE_FALLBACK_DELAY_MS = 750;
const DOCK_WORSHIP_SAVE_RESULT_POLL_MS = 500;
const DOCK_WORSHIP_RECENT_SEARCH_LIMIT = 6;

interface DockSongDraft {
  title: string;
  artist: string;
  lyrics: string;
  autoSplit?: boolean;
  linesPerSlide?: number;
}

interface DockSongDefault extends DockSongDraft {
  importSourceName?: string;
  importSourceType?: "manual" | "online" | "document";
  importSourceUrl?: string;
  themeId?: string;
}

type DockSongDefaults = Record<string, DockSongDefault>;
type DockToastTone = "info" | "success" | "error";
type LyricsFormatAction =
  | "clean"
  | "remove-empty"
  | "remove-verse-numbers"
  | "uppercase"
  | "lowercase"
  | "capitalize";

interface DockToast {
  id: string;
  message: string;
  tone: DockToastTone;
}

interface DeletedWorshipSection {
  id: string;
  label: string;
  text: string;
  index: number;
  deletedAt: number;
}

function clampLinesPerSlide(value?: number): number {
  if (!value || Number.isNaN(value)) return DEFAULT_LINES_PER_SLIDE;
  return Math.min(MAX_LINES_PER_SLIDE, Math.max(MIN_LINES_PER_SLIDE, Math.trunc(value)));
}

function readRecentWorshipSearches(): string[] {
  try {
    const raw = readNativeDockSetting<unknown>(DOCK_WORSHIP_RECENT_SEARCHES_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? []);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeRecentWorshipSearches(items: string[]): void {
  writeNativeDockSetting(DOCK_WORSHIP_RECENT_SEARCHES_KEY, items.slice(0, DOCK_WORSHIP_RECENT_SEARCH_LIMIT));
}

function pushRecentWorshipSearch(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return readRecentWorshipSearches();
  const next = [
    normalized,
    ...readRecentWorshipSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, DOCK_WORSHIP_RECENT_SEARCH_LIMIT);
  writeRecentWorshipSearches(next);
  return next;
}

function createDockSongId(): string {
  return crypto.randomUUID?.() ?? `dock-song-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readDockSongDefaults(): DockSongDefaults {
  try {
    const raw = readNativeDockSetting<unknown>(DOCK_WORSHIP_SONG_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as DockSongDefaults;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDockSongDefaults(next: DockSongDefaults): void {
  writeNativeDockSetting(DOCK_WORSHIP_SONG_DEFAULTS_KEY, next);
}

function readScopedWorshipStorage(baseKey: string): string | null {
  try {
    const scopedKey = getUserScopedKey(baseKey);
    const scopedRaw = localStorage.getItem(scopedKey);
    if (scopedRaw !== null || scopedKey === baseKey) return scopedRaw;
    const legacyRaw = localStorage.getItem(baseKey);
    if (legacyRaw !== null) {
      try {
        localStorage.setItem(scopedKey, legacyRaw);
      } catch {
        // Ignore migration failures in OBS browser contexts.
      }
    }
    return legacyRaw;
  } catch {
    return null;
  }
}

function cacheSongsLocally(songs: DockSong[]): void {
  try {
    localStorage.setItem(getUserScopedKey(DOCK_WORSHIP_CACHED_SONGS_KEY), JSON.stringify(songs));
  } catch {
    /* ignore */
  }
}

function loadCachedSongs(): DockSong[] {
  try {
    const raw = readScopedWorshipStorage(DOCK_WORSHIP_CACHED_SONGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDockSongDefault(song: DockSong): void {
  const defaults = readDockSongDefaults();
  if (defaults[song.id]) return;
  defaults[song.id] = {
    title: song.title,
    artist: song.artist,
    lyrics: song.lyrics,
    importSourceName: song.importSourceName,
    importSourceType: song.importSourceType,
    importSourceUrl: song.importSourceUrl,
    autoSplit: song.autoSplit,
    linesPerSlide: song.linesPerSlide,
    themeId: song.themeId,
  };
  writeDockSongDefaults(defaults);
}

function rememberDockSongDefaults(songs: DockSong[]): void {
  const defaults = readDockSongDefaults();
  let changed = false;
  for (const song of songs) {
    if (defaults[song.id]) continue;
    defaults[song.id] = {
      title: song.title,
      artist: song.artist,
      lyrics: song.lyrics,
      importSourceName: song.importSourceName,
      importSourceType: song.importSourceType,
      importSourceUrl: song.importSourceUrl,
      autoSplit: song.autoSplit,
      linesPerSlide: song.linesPerSlide,
      themeId: song.themeId,
    };
    changed = true;
  }
  if (changed) writeDockSongDefaults(defaults);
}

function deferRememberDockSongDefaults(songs: DockSong[]): void {
  const run = () => rememberDockSongDefaults(songs);
  const win = typeof window !== "undefined" ? (window as any) : null;
  if (win && typeof win.requestIdleCallback === "function") {
    win.requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 500);
  }
}

const songSearchTextCache = new WeakMap<DockSong, string>();
function getSongSearchText(song: DockSong): string {
  let text = songSearchTextCache.get(song);
  if (!text) {
    text = `${song.title}\n${song.artist}\n${song.lyrics}`.toLowerCase();
    songSearchTextCache.set(song, text);
  }
  return text;
}

function mapAppSongToDockSong(song: {
  id: string;
  metadata: { title: string; artist?: string; hymnNumber?: string };
  lyrics?: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online" | "document";
  importSourceUrl?: string;
  autoSplit?: boolean;
  linesPerSlide?: number;
  themeId?: string;
}): DockSong {
  return {
    id: song.id,
    title: song.metadata.title,
    hymnNumber: song.metadata.hymnNumber,
    artist: song.metadata.artist || "",
    lyrics: song.lyrics || "",
    importSourceName: song.importSourceName,
    importSourceType: song.importSourceType,
    importSourceUrl: song.importSourceUrl,
    autoSplit: song.autoSplit,
    linesPerSlide: song.linesPerSlide,
    themeId: song.themeId,
  };
}

const DOCK_SONG_CARD_PREVIEW_LINES = 2;

function getSongCardLyricsPreview(lyrics: string): { lines: string[]; hasMore: boolean } {
  const body = extractStructuredTextTitle(normalizeDockMultilineText(lyrics)).body;
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    lines: lines.slice(0, DOCK_SONG_CARD_PREVIEW_LINES),
    hasMore: lines.length > DOCK_SONG_CARD_PREVIEW_LINES,
  };
}

function loadDockWorshipPreferences(): DockWorshipPreferences {
  return readDockPreference<DockWorshipPreferences>(DOCK_WORSHIP_PREFS_KEY) ?? {};
}

function readDockWorshipOverlayMode(): OverlayMode | null {
  const mode = loadDockWorshipPreferences().overlayMode;
  return mode === "fullscreen" || mode === "lower-third" ? mode : null;
}

function saveDockWorshipPreferences(next: DockWorshipPreferences): void {
  void saveDockPreference(DOCK_WORSHIP_PREFS_KEY, next);
}

function saveDockWorshipOverlayMode(mode: OverlayMode): void {
  saveDockWorshipPreferences({
    ...loadDockWorshipPreferences(),
    overlayMode: mode,
    updatedAt: new Date().toISOString(),
  });
}

function isWorshipSubTab(value: unknown): value is WorshipSubTab {
  return value === "worship" || value === "notes";
}

function loadDockWorshipUiPreferences(): DockWorshipUiPreferences {
  try {
    const raw = readNativeDockSetting<unknown>(DOCK_WORSHIP_UI_PREFS_KEY);
    if (!raw) return {};
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as DockWorshipUiPreferences;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      toolbarCollapsed: parsed.toolbarCollapsed === true,
      activeSubTab: isWorshipSubTab(parsed.activeSubTab) ? parsed.activeSubTab : undefined,
      quickActionsTop: typeof parsed.quickActionsTop === "number" && Number.isFinite(parsed.quickActionsTop)
        ? parsed.quickActionsTop
        : undefined,
      quickActionsLeft: typeof parsed.quickActionsLeft === "number" && Number.isFinite(parsed.quickActionsLeft)
        ? parsed.quickActionsLeft
        : null,
      quickUpdateImmediately: parsed.quickUpdateImmediately !== false,
      lastSongId: typeof parsed.lastSongId === "string" && parsed.lastSongId ? parsed.lastSongId : undefined,
      lastSlideIndex: typeof parsed.lastSlideIndex === "number" && Number.isInteger(parsed.lastSlideIndex) && parsed.lastSlideIndex >= 0
        ? parsed.lastSlideIndex
        : undefined,
    };
  } catch {
    return {};
  }
}

function saveDockWorshipUiPreferences(next: DockWorshipUiPreferences): void {
  writeNativeDockSetting(DOCK_WORSHIP_UI_PREFS_KEY, next);
}

async function loadDockWorshipPreferencesFromApp(): Promise<DockWorshipPreferences | null> {
  return loadDockPreference<DockWorshipPreferences>(
    DOCK_WORSHIP_PREFS_KEY,
    [DOCK_WORSHIP_PREFS_APP_KEY],
  ).catch(() => null);
}

function parseLyricSections(
  lyrics: string,
  linesPerSlide: number,
  splitByLineCount = false,
  continuousLineCount = false,
): DockWorshipSection[] {
  if (!lyrics.trim()) return [];

  const effectiveLPS = Math.max(1, linesPerSlide || 2);

  return generateSlides(
    normalizeDockMultilineText(lyrics),
    effectiveLPS,
    splitByLineCount,
    { continuousLineCount: splitByLineCount || continuousLineCount },
  ).map((slide) => ({
    id: slide.id,
    label: slide.isContinuation ? "" : slide.label,
    text: stripLeadingVerseMarker(slide.content),
  }));
}

function serializeLyricSections(
  sections: Array<Pick<DockWorshipSection, "label" | "text">>,
  title?: string | null,
): string {
  const content = sections
    .map((section) => {
      const label = section.label.trim();
      const isGenericVerse = !label || /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(label);
      const sectionTag = label && !isGenericVerse ? `[${label}]` : "";
      const cleanText = stripLeadingVerseMarker(normalizeDockMultilineText(section.text).trim());
      return [sectionTag, cleanText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return [title ? `[${title}]` : "", content].filter(Boolean).join("\n\n");
}

function capitalizeLyricsText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.replace(/\b([A-Za-z])([A-Za-z'’-]*)/g, (_, first: string, rest: string) =>
        `${first.toUpperCase()}${rest.toLowerCase()}`,
      ),
    )
    .join("\n");
}

function applyLyricsFormat(text: string, action: LyricsFormatAction): string {
  let result = text;

  switch (action) {
    case "clean": {
      result = result
        .split("\n")
        .map((line) => {
          let l = line;
          l = l.replace(/\t/g, " ");
          l = l.replace(/\s{2,}/g, " ");
          l = l.replace(/ ,/g, ",");
          l = l.replace(/ \./g, ".");
          l = l.replace(/ :/g, ":");
          l = l.replace(/([,:;.])([A-Za-z])/g, "$1 $2");
          l = l.replace(/\s+$/g, "");
          l = l.trimStart();
          return l;
        })
        .join("\n");
      break;
    }
    case "remove-empty": {
      const lines = result.split("\n");
      const collapsed: string[] = [];
      let blankCount = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        const isBlank = trimmed === "" || /^[^\w]+$/.test(trimmed);
        if (isBlank) {
          blankCount++;
          if (blankCount <= 1) collapsed.push("");
        } else {
          blankCount = 0;
          collapsed.push(line);
        }
      }
      result = collapsed.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
      break;
    }
    case "remove-verse-numbers": {
      result = result
        .replace(/^\d+[.)]\s*/gm, "")
        .replace(/^\[[\d]+\]\s*/gm, "")
        .replace(/^\([\d]+\)\s*/gm, "")
        .replace(/^Verse\s+\d+\s*:?\s*/gim, "");
      break;
    }
    case "uppercase":
      result = result.toLocaleUpperCase();
      break;
    case "lowercase":
      result = result.toLocaleLowerCase();
      break;
    case "capitalize":
      result = capitalizeLyricsText(result);
      break;
  }

  return result;
}

interface DockLyricsEditorDialogProps {
  dialogId: string;
  eyebrow: string;
  title: string;
  initialDraft: DockSongDraft;
  saveLabel: string;
  cancelLabel: string;
  resetLabel?: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: DockSongDraft) => Promise<void>;
  onReset?: () => DockSongDraft | null;
  onDraftChange?: (draft: DockSongDraft) => void;
}

interface WorshipLinesPerSlideControlProps {
  value?: number;
  onChange: (value: number) => void;
}

function DockModalPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".dock-root");
    if (!root) return;

    const nextHost = document.createElement("div");
    nextHost.className = "dock-modal-layer";
    root.appendChild(nextHost);
    setHost(nextHost);

    return () => {
      nextHost.remove();
      setHost(null);
    };
  }, []);

  return host ? createPortal(children, host) : null;
}

function DockSongDeleteDialog({
  songTitle,
  busy,
  onConfirm,
  onCancel,
}: {
  songTitle: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <DockModalPortal>
      <div className="dock-dialog-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
        <div className="dock-dialog dock-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="dock-song-delete-title" onClick={(event) => event.stopPropagation()}>
          <div className="dock-dialog__header">
            <div>
              <div className="dock-dialog__eyebrow">{t("worship.title")}</div>
              <h2 id="dock-song-delete-title" className="dock-dialog__title">
                {t("worship.archiveSongTitle", "Remove song?")}
              </h2>
            </div>
            <button
              type="button"
              className="dock-dialog__close"
              onClick={onCancel}
              disabled={busy}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="dock-dialog__body">
            <p style={{ margin: 0, color: "var(--dock-text-secondary)", lineHeight: 1.5 }}>
              {t(
                "worship.archiveSongDescription",
                {
                  song: songTitle,
                  defaultValue: `“${songTitle}” will be removed from the active worship library. You can restore it later from the archive.`,
                },
              )}
            </p>
          </div>
          <div className="dock-dialog__footer">
            <button type="button" className="dock-btn dock-btn--ghost" onClick={onCancel} disabled={busy} title={t("common.cancel")}>
              {t("common.cancel")}
            </button>
            <button type="button" className="dock-btn dock-btn--danger" onClick={onConfirm} disabled={busy} title={t("common.delete")}>
              <Icon name={busy ? "hourglass_top" : "delete_outline"} size={13} />
              {busy ? t("worship.saving") : t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </DockModalPortal>
  );
}

function WorshipLinesPerSlideControl({
  value,
  onChange,
}: WorshipLinesPerSlideControlProps) {
  const { t } = useTranslation();
  const lineLabel = t("worship.linesPerSlide");
  const lineCount = clampLinesPerSlide(value);

  return (
    <label className="dock-worship-lines-control">
      <Icon name="format_align_left" size={12} />
      <span className="dock-worship-lines-control__label">{lineLabel}</span>
      <select
        className="dock-worship-lines-control__select"
        value={lineCount}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={lineLabel}
      >
        {Array.from({ length: MAX_LINES_PER_SLIDE }, (_, index) => index + 1).map((count) => (
          <option key={count} value={count}>
            {t("worship.linesCount", { count })}
          </option>
        ))}
      </select>
    </label>
  );
}

function DockLyricsEditorDialog({
  dialogId,
  eyebrow,
  title,
  initialDraft,
  saveLabel,
  cancelLabel,
  resetLabel,
  saving,
  onCancel,
  onSave,
  onReset,
  onDraftChange,
}: DockLyricsEditorDialogProps) {
  const { t } = useTranslation();
  const [songTitle, setSongTitle] = useState(initialDraft.title);
  const [songArtist, setSongArtist] = useState(initialDraft.artist);
  const [linesPerSlide, setLinesPerSlide] = useState(initialDraft.linesPerSlide ?? DEFAULT_WORSHIP_LINES_PER_SLIDE);
  const {
    value: lyrics,
    setValue: setLyrics,
    undo,
    redo,
    canUndo,
    canRedo,
    handleKeyDown: handleUndoRedoKeyDown,
  } = useTextUndoRedo(initialDraft.lyrics);
  const titleWasAutoGeneratedRef = useRef(isDummyTitle(initialDraft.title) || !initialDraft.title.trim());

  // Keep the live preview useful without sending the whole DockWorshipTab
  // through a render for every character typed in the editor.
  useEffect(() => {
    if (!onDraftChange) return;
    const timer = window.setTimeout(() => {
      startTransition(() => onDraftChange({
        ...initialDraft,
        title: songTitle,
        artist: songArtist,
        lyrics,
        linesPerSlide,
      }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [lyrics, songTitle, songArtist, linesPerSlide, onDraftChange, initialDraft]);

  const formatDraft = useCallback((action: LyricsFormatAction) => {
    const nextLyrics = applyLyricsFormat(lyrics, action);
    setLyrics(nextLyrics, true);
    if (titleWasAutoGeneratedRef.current || isDummyTitle(songTitle) || !songTitle.trim()) {
      const derived = extractFirstLineAsTitle(nextLyrics);
      if (derived) setSongTitle(derived);
    }
  }, [lyrics, setLyrics, songTitle]);

  const handleLinesPerSlideChange = useCallback((value: number) => {
    setLinesPerSlide(clampLinesPerSlide(value));
  }, []);

  const handleReset = useCallback(() => {
    const nextDraft = onReset?.();
    if (!nextDraft) return;
    titleWasAutoGeneratedRef.current = isDummyTitle(nextDraft.title);
    setSongTitle(nextDraft.title);
    setSongArtist(nextDraft.artist);
    setLyrics(nextDraft.lyrics, true);
    setLinesPerSlide(nextDraft.linesPerSlide ?? DEFAULT_WORSHIP_LINES_PER_SLIDE);
  }, [onReset, setLyrics]);

  const handleSave = useCallback(() => {
    let finalTitle = songTitle.trim();
    if (titleWasAutoGeneratedRef.current || isDummyTitle(finalTitle) || !finalTitle) {
      const derived = extractFirstLineAsTitle(lyrics);
      if (derived) {
        finalTitle = derived;
      }
    }
    if (saving || !finalTitle || !lyrics.trim()) return;
    void onSave({
      ...initialDraft,
      title: finalTitle,
      artist: songArtist,
      lyrics,
      linesPerSlide,
      autoSplit: initialDraft.autoSplit ?? false,
    });
  }, [initialDraft, lyrics, linesPerSlide, onSave, saving, songArtist, songTitle]);

  return (
    <DockModalPortal>
      <div className="dock-dialog-backdrop dock-dialog-backdrop--fullscreen" role="presentation">
        <div className="dock-dialog dock-dialog--song-editor" role="dialog" aria-modal="true" aria-labelledby={dialogId}>
        <div className="dock-dialog__header">
          <div>
            <div className="dock-dialog__eyebrow">{eyebrow}</div>
            <h2 id={dialogId} className="dock-dialog__title">{title}</h2>
          </div>
          <button
            type="button"
            className="dock-dialog__close"
            onClick={onCancel}
            aria-label={t('common.close')}
            title={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-dialog__body">
          <div className="dock-dialog__row dock-dialog__row--two">
            <label className="dock-dialog-field">
              <span className="dock-dialog-field__label">
                <span>{t('worship.songTitle')}</span>
                <span className="dock-dialog-field__tag dock-dialog-field__tag--required">{t('worship.required')}</span>
              </span>
              <input
                className="dock-input"
                value={songTitle}
                onChange={(event) => {
                  titleWasAutoGeneratedRef.current = isDummyTitle(event.target.value);
                  setSongTitle(event.target.value);
                }}
              />
            </label>
            <label className="dock-dialog-field">
              <span className="dock-dialog-field__label">
                <span>{t('worship.artist')}</span>
                <span className="dock-dialog-field__tag">{t('worship.optional')}</span>
              </span>
              <input
                className="dock-input"
                value={songArtist}
                onChange={(event) => setSongArtist(event.target.value)}
              />
            </label>
          </div>
          <div className="dock-dialog-field dock-dialog-field--lyrics">
            <label className="dock-dialog-field__label" htmlFor="dock-song-lyrics">
              <span>{t('worship.songLyrics')}</span>
            </label>
            <div className="dock-lyrics-toolbar" role="toolbar" aria-label={t("worship.lyricsFormattingTools")}>
              <div className="dock-lyrics-toolbar__row dock-lyrics-toolbar__row--actions">
                <button
                  type="button"
                  className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon"
                  onClick={undo}
                  disabled={!canUndo}
                  title={t("common.undo")}
                  aria-label={t("common.undo")}>
                  <Icon name="undo" size={12} />
                </button>
                <button
                  type="button"
                  className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon"
                  onClick={redo}
                  disabled={!canRedo}
                  title={t("common.redo")}
                  aria-label={t("common.redo")}>
                  <Icon name="redo" size={12} />
                </button>
                <button
                  type="button"
                  className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon"
                  onClick={() => formatDraft("clean")}
                  title={t("worship.cleanText")}
                  aria-label={t("worship.cleanText")}>
                  <Icon name="auto_fix_high" size={12} />
                </button>
                <button
                  type="button"
                  className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon dock-lyrics-toolbar__btn--toggle"
                  onClick={() => formatDraft("remove-verse-numbers")}
                  title={t("worship.verseNumbers")}
                  aria-label={t("worship.verseNumbers")}>
                  <Icon name="tag" size={12} />
                </button>
              </div>
              <div className="dock-lyrics-toolbar__row dock-lyrics-toolbar__row--layout">
                <WorshipLinesPerSlideControl
                  value={linesPerSlide}
                  onChange={handleLinesPerSlideChange}
                />
                <div className="dock-lyrics-toolbar__group" role="group" aria-label={t("worship.textCaseControls")}>
                  <button
                    type="button"
                    className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                    onClick={() => formatDraft("uppercase")}
                    title={t("bible.uppercase")}
                    aria-label={t("bible.uppercase")}>
                    <span>AA</span>
                  </button>
                  <button
                    type="button"
                    className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                    onClick={() => formatDraft("lowercase")}
                    title={t("worship.lowercase")}
                    aria-label={t("worship.lowercase")}>
                    <span>aa</span>
                  </button>
                  <button
                    type="button"
                    className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                    onClick={() => formatDraft("capitalize")}
                    title={t("common.capitalize")}
                    aria-label={t("common.capitalize")}>
                    <span>Aa</span>
                  </button>
                </div>
              </div>
            </div>
            <DockSpellcheckTextarea
              id="dock-song-lyrics"
              className="dock-input dock-dialog-textarea"
              value={lyrics}
              placeholder={t("worship.songLyricsPlaceholderTips", "Paste or type lyrics here...\n\nExample:\n[Verse 1]\nFirst line of verse 1\nSecond line\n\n<Chorus>\nFirst line of chorus\nSecond line\n\n[Verse 2]\nVerse 2 line...")}
              onKeyDown={(event) => {
                handleUndoRedoKeyDown(event);
                if (event.key === "Enter" || event.key === " ") event.stopPropagation();
              }}
              onChange={(value) => {
                setLyrics(value);
                if (titleWasAutoGeneratedRef.current || isDummyTitle(songTitle) || !songTitle.trim()) {
                  const derived = extractFirstLineAsTitle(value);
                  if (derived) {
                    setSongTitle(derived);
                  } else if (!value.trim()) {
                    setSongTitle(initialDraft.title || nextAutoSongTitle());
                  }
                }
              }}
            />
          </div>
        </div>
        <div className="dock-dialog__footer">
          {resetLabel && onReset && (
            <button type="button" className="dock-btn dock-btn--ghost" onClick={handleReset} title={resetLabel}>
              {resetLabel}
            </button>
          )}
          <button type="button" className="dock-btn dock-btn--ghost" onClick={onCancel} title={cancelLabel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--primary"
            onClick={handleSave}
            disabled={saving || !songTitle.trim() || !lyrics.trim()}
            title={saveLabel}>
            {saveLabel}
          </button>
        </div>
        </div>
      </div>
    </DockModalPortal>
  );
}

interface DockWorshipSlideEditorDialogProps {
  label: string;
  initialText: string;
  initialLinesPerSlide: number;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: { text: string; linesPerSlide: number }) => void | Promise<void>;
}

function DockWorshipSlideEditorDialog({
  label,
  initialText,
  initialLinesPerSlide,
  saving,
  onCancel,
  onSave,
}: DockWorshipSlideEditorDialogProps) {
  const { t } = useTranslation();
  const [linesPerSlide, setLinesPerSlide] = useState(initialLinesPerSlide);
  const {
    value: text,
    setValue: setText,
    undo,
    redo,
    canUndo,
    canRedo,
    handleKeyDown: handleUndoRedoKeyDown,
  } = useTextUndoRedo(initialText);

  const handleFormat = useCallback((action: LyricsFormatAction) => {
    setText(applyLyricsFormat(text, action), true);
  }, [text, setText]);

  return (
    <DockModalPortal>
      <div className="dock-dialog-backdrop dock-dialog-backdrop--fullscreen" role="presentation">
        <div className="dock-dialog dock-dialog--song-editor dock-dialog--slide-editor" role="dialog" aria-modal="true" aria-labelledby="dock-slide-editor-title">
        <div className="dock-dialog__header">
          <div>
            <div className="dock-dialog__eyebrow">{t('worship.quickEdit')}</div>
            <h2 id="dock-slide-editor-title" className="dock-dialog__title">{label}</h2>
          </div>
          <button
            type="button"
            className="dock-dialog__close"
            onClick={onCancel}
            aria-label={t('common.close')}
            title={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-dialog__body">
          <div className="dock-lyrics-toolbar" role="toolbar" aria-label={t("worship.slideTextFormatting")}>
            <div className="dock-lyrics-toolbar__row dock-lyrics-toolbar__row--actions">
              <button
                type="button"
                className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon"
                onClick={undo}
                disabled={!canUndo}
                title={t("common.undo")}
                aria-label={t("common.undo")}>
                <Icon name="undo" size={12} />
              </button>
              <button
                type="button"
                className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon"
                onClick={redo}
                disabled={!canRedo}
                title={t("common.redo")}
                aria-label={t("common.redo")}>
                <Icon name="redo" size={12} />
              </button>
              <button type="button" className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon" onClick={() => handleFormat("clean")} title={t("worship.cleanText")} aria-label={t("worship.cleanText")}>
                <Icon name="auto_fix_high" size={12} />
              </button>
              <button type="button" className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--icon dock-lyrics-toolbar__btn--toggle" onClick={() => handleFormat("remove-verse-numbers")} title={t("worship.verseNumbers")} aria-label={t("worship.verseNumbers")}>
                <Icon name="tag" size={12} />
              </button>
            </div>
            <div className="dock-lyrics-toolbar__row dock-lyrics-toolbar__row--layout">
              <WorshipLinesPerSlideControl
                value={linesPerSlide}
                onChange={(val) => setLinesPerSlide(clampLinesPerSlide(val))}
              />
              <div className="dock-lyrics-toolbar__group" role="group" aria-label={t("worship.textCaseControls")}>
                <button type="button" className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                  onClick={() => handleFormat("uppercase")} title={t("bible.uppercase")} aria-label={t("bible.uppercase")}>
                  <span>AA</span>
                </button>
                <button type="button" className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                  onClick={() => handleFormat("lowercase")} title={t("worship.lowercase")} aria-label={t("worship.lowercase")}>
                  <span>aa</span>
                </button>
                <button type="button" className="dock-lyrics-toolbar__btn dock-lyrics-toolbar__btn--case"
                  onClick={() => handleFormat("capitalize")} title={t("common.capitalize")} aria-label={t("common.capitalize")}>
                  <span>Aa</span>
                </button>
              </div>
            </div>
          </div>
          <div className="dock-dialog-field dock-dialog-field--lyrics">
            <label className="dock-dialog-field__label" htmlFor="dock-worship-slide-text">
              <span>{t('worship.slideText')}</span>
            </label>
            <DockSpellcheckTextarea
              id="dock-worship-slide-text"
              className="dock-input dock-dialog-textarea dock-dialog-textarea--short"
              value={text}
              placeholder={t("worship.slideTextPlaceholderTips", "Type slide text here…\n\n• Add section tags like [Verse 1], <Chorus>, [Bridge], Verse 1: or Chorus: at the top of a slide to display a header badge.")}
              onKeyDown={(event) => {
                handleUndoRedoKeyDown(event);
                if (event.key === "Enter" || event.key === " ") event.stopPropagation();
              }}
              onChange={setText}
            />
          </div>
        </div>
        <div className="dock-dialog__footer">
          <button type="button" className="dock-btn dock-btn--ghost" onClick={onCancel} title={t('common.cancel')}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--primary"
            onClick={() => void onSave({ text, linesPerSlide })}
            disabled={saving || !text.trim()}
            title={saving ? t('worship.saving') : t('common.save')}>
            {saving ? t('worship.saving') : t('common.save')}
          </button>
        </div>
        </div>
      </div>
    </DockModalPortal>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function sanitizeCssPadding(value: unknown, fallback = DEFAULT_THEME_SETTINGS.lowerThirdCardPadding ?? "18px 28px"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^-?\d+(?:\.\d+)?px(?:\s+-?\d+(?:\.\d+)?px){0,3}$/.test(trimmed)
    ? trimmed
    : fallback;
}

function sanitizeLowerThirdEdge(value: unknown): BibleThemeSettings["lowerThirdEdge"] {
  return value === "top" || value === "bottom" || value === "left" || value === "right"
    ? value
    : DEFAULT_THEME_SETTINGS.lowerThirdEdge;
}

function sanitizeLowerThirdPaddingLinked(value: unknown): boolean {
  return typeof value === "boolean" ? value : Boolean(DEFAULT_THEME_SETTINGS.lowerThirdPaddingLinked);
}

function sanitizeLowerThirdCardRadius(value: unknown): number {
  return clampNumber(Number(value ?? DEFAULT_THEME_SETTINGS.lowerThirdCardRadius ?? 18), 0, 64);
}

function sanitizeLowerThirdTextDirection(value: unknown): BibleThemeSettings["lowerThirdTextDirection"] {
  return value === "inverted" ? "inverted" : "normal";
}

function extractQuickThemeSettings(settings: BibleThemeSettings): DockFullscreenQuickThemeSettings {
  const compareSettings = normalizeCompareThemeSettings(settings as unknown as Record<string, unknown>);
  return {
    fontSize: clampNumber(settings.fontSize, 28, 200),
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(settings.fontFamily || DEFAULT_THEME_SETTINGS.fontFamily),
    refFontSize: clampNumber(settings.refFontSize, 14, 150),
    refFontWeight: settings.refFontWeight || DEFAULT_THEME_SETTINGS.refFontWeight,
    fontColor: settings.fontColor || DEFAULT_THEME_SETTINGS.fontColor,
    refFontColor: settings.refFontColor || settings.fontColor || DEFAULT_THEME_SETTINGS.refFontColor,
    refPosition: settings.refPosition || DEFAULT_THEME_SETTINGS.refPosition,
    refAnchor: settings.refAnchor || DEFAULT_THEME_SETTINGS.refAnchor || "normal",
    refTextTransform: settings.refTextTransform || DEFAULT_THEME_SETTINGS.refTextTransform,
    refLetterSpacing: clampNumber(settings.refLetterSpacing, 0, 10),
    refOpacity: clampNumber(settings.refOpacity, 0, 1),
    refTextAlign: settings.refTextAlign || DEFAULT_THEME_SETTINGS.refTextAlign,
    refSpacing: clampNumber(settings.refSpacing, 0, 80),
    fullscreenShadeColor:
      settings.fullscreenShadeColor || DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
    fullscreenShadeOpacity: clampNumber(settings.fullscreenShadeOpacity, 0, 1),
    textAlign: settings.textAlign || DEFAULT_THEME_SETTINGS.textAlign,
    lineHeight: clampNumber(settings.lineHeight, 1.05, 1.8),
    letterSpacing: clampNumber(settings.letterSpacing ?? 0, -2, 20),
    wordSpacing: clampNumber(settings.wordSpacing ?? 0, -5, 40),
    fontWeight: settings.fontWeight || DEFAULT_THEME_SETTINGS.fontWeight,
    fontStyle: settings.fontStyle || DEFAULT_THEME_SETTINGS.fontStyle,
    textTransform: settings.textTransform || DEFAULT_THEME_SETTINGS.textTransform,
    textShadow: settings.textShadow ?? DEFAULT_THEME_SETTINGS.textShadow,
    textOutline: settings.textOutline ?? DEFAULT_THEME_SETTINGS.textOutline,
    textOutlineColor: settings.textOutlineColor || DEFAULT_THEME_SETTINGS.textOutlineColor,
    textOutlineWidth: clampNumber(settings.textOutlineWidth ?? DEFAULT_THEME_SETTINGS.textOutlineWidth ?? 4, 0, 10),
    animation: settings.animation ?? DEFAULT_THEME_SETTINGS.animation,
    animationDuration: settings.animationDuration ?? DEFAULT_THEME_SETTINGS.animationDuration,
    backgroundImage: settings.backgroundImage ?? "",
    backgroundImageFilePath: settings.backgroundImageFilePath ?? "",
    backgroundVideo: settings.backgroundVideo ?? "",
    backgroundVideoFilePath: settings.backgroundVideoFilePath ?? "",
    backgroundOpacity: clampNumber(settings.backgroundOpacity ?? 1, 0, 1),
    backgroundColor: settings.backgroundColor || DEFAULT_THEME_SETTINGS.backgroundColor || "#0B1426",
    backgroundColorEnd: settings.backgroundColorEnd || DEFAULT_THEME_SETTINGS.backgroundColorEnd || "#162040",
    bgGradientAngle: clampNumber(settings.bgGradientAngle ?? DEFAULT_THEME_SETTINGS.bgGradientAngle ?? 180, 0, 360),
    referenceBackgroundEnabled: settings.referenceBackgroundEnabled ?? false,
    referenceBackgroundColor: settings.referenceBackgroundColor || DEFAULT_THEME_SETTINGS.referenceBackgroundColor,
    referenceBackgroundStyle: settings.referenceBackgroundStyle || DEFAULT_THEME_SETTINGS.referenceBackgroundStyle,
    referenceBackgroundRadius: clampNumber(settings.referenceBackgroundRadius ?? 12, 0, 40),
    lowerThirdPosition: settings.lowerThirdPosition || "center",
    lowerThirdSize: settings.lowerThirdSize || "medium",
    lowerThirdWidthPreset: settings.lowerThirdWidthPreset || "full",
    lowerThirdOffsetX: clampNumber(settings.lowerThirdOffsetX ?? 0, -50, 50),
    backgroundPattern: settings.backgroundPattern ?? "",
    lowerThirdCaptionPosition: settings.lowerThirdCaptionPosition || "bottom",
    lowerThirdEdge: sanitizeLowerThirdEdge(settings.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(settings.lowerThirdCardPadding),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(settings.lowerThirdPaddingLinked),
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(settings.lowerThirdCardRadius ?? settings.borderRadius),
    boxBackground: settings.boxBackground || (settings.backgroundColor ? settings.backgroundColor : ""),
    boxBackgroundImage: settings.boxBackgroundImage || "",
    boxOpacity: clampNumber(settings.boxOpacity ?? 1, 0, 1),
    borderRadius: clampNumber(settings.borderRadius ?? settings.lowerThirdCardRadius ?? 16, 0, 64),
    padding: typeof settings.padding === "number" ? settings.padding : 28,
    safeArea: typeof settings.safeArea === "number" ? settings.safeArea : 40,
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(settings.lowerThirdTextDirection),
    compareTranslationWidth: compareSettings.compareLeftWidth,
    ...compareSettings,
    // Layer-theme sizes set in the Dock must survive being re-read from the live theme.
    ...pickLayoutAdjust(settings),
  };
}

function buildDefaultLowerThirdQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  return normalizeLowerThirdFitSettings({
    ...extractQuickThemeSettings(settings),
    backgroundType: backgroundType ?? "theme",
  });
}

function sanitizeQuickThemeSettings(
  value: unknown,
  mode: OverlayMode = "fullscreen",
): DockFullscreenQuickThemeSettings | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<DockFullscreenQuickThemeSettings>;
  const fontWeight =
    source.fontWeight === "light" || source.fontWeight === "normal" || source.fontWeight === "bold" || source.fontWeight === "extrabold" || source.fontWeight === "black"
      ? source.fontWeight
      : DEFAULT_THEME_SETTINGS.fontWeight;
  const fontStyle =
    source.fontStyle === "normal" || source.fontStyle === "italic"
      ? source.fontStyle
      : DEFAULT_THEME_SETTINGS.fontStyle;
  const textAlign =
    source.textAlign === "left" || source.textAlign === "center" || source.textAlign === "right"
      ? source.textAlign
      : DEFAULT_THEME_SETTINGS.textAlign;
  const textTransform =
    source.textTransform === "none" ||
      source.textTransform === "uppercase" ||
      source.textTransform === "lowercase" ||
      source.textTransform === "capitalize"
      ? source.textTransform
      : DEFAULT_THEME_SETTINGS.textTransform;

  const validAnimations = ["none", "fade", "slide-up", "slide-left", "scale-in", "reveal-bg-then-text"] as const;
  const animation = validAnimations.includes(source.animation as typeof validAnimations[number])
    ? source.animation as typeof validAnimations[number]
    : DEFAULT_THEME_SETTINGS.animation;
  const compareSettings = normalizeCompareThemeSettings(source as Record<string, unknown>);

  return {
    // Preserve style fields introduced by newer builds instead of silently
    // dropping them the next time the dock hydrates and saves preferences.
    ...source,
    fontSize: clampNumber(
      Number(source.fontSize ?? DEFAULT_THEME_SETTINGS.fontSize),
      mode === "lower-third" ? LOWER_THIRD_FIT_MIN_FONT_SIZE : 16,
      mode === "lower-third" ? LOWER_THIRD_FONT_SIZE_MAX : 200,
    ),
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(
      typeof source.fontFamily === "string" ? source.fontFamily : DEFAULT_THEME_SETTINGS.fontFamily,
    ),
    refFontSize: clampNumber(
      Number(source.refFontSize ?? DEFAULT_THEME_SETTINGS.refFontSize),
      mode === "lower-third" ? LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE : 10,
      mode === "lower-third" ? LOWER_THIRD_REFERENCE_FONT_SIZE_MAX : 150,
    ),
    refFontWeight: (source.refFontWeight as BibleThemeSettings["refFontWeight"]) || DEFAULT_THEME_SETTINGS.refFontWeight,
    fontColor: sanitizeColor(source.fontColor, DEFAULT_THEME_SETTINGS.fontColor),
    refFontColor: sanitizeColor(source.refFontColor, DEFAULT_THEME_SETTINGS.refFontColor),
    refPosition: (source.refPosition as BibleThemeSettings["refPosition"]) || DEFAULT_THEME_SETTINGS.refPosition,
    refAnchor:
      source.refAnchor === "top" || source.refAnchor === "bottom" || source.refAnchor === "normal"
        ? source.refAnchor
        : (DEFAULT_THEME_SETTINGS.refAnchor ?? "normal"),
    refTextTransform: (source.refTextTransform as BibleThemeSettings["refTextTransform"]) || DEFAULT_THEME_SETTINGS.refTextTransform,
    refLetterSpacing: clampNumber(Number(source.refLetterSpacing ?? DEFAULT_THEME_SETTINGS.refLetterSpacing), 0, 10),
    refOpacity: clampNumber(Number(source.refOpacity ?? DEFAULT_THEME_SETTINGS.refOpacity), 0, 1),
    refTextAlign: (source.refTextAlign as BibleThemeSettings["refTextAlign"]) || DEFAULT_THEME_SETTINGS.textAlign,
    refSpacing: clampNumber(Number(source.refSpacing ?? DEFAULT_THEME_SETTINGS.refSpacing), 0, 80),
    fullscreenShadeColor: sanitizeColor(
      source.fullscreenShadeColor,
      DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
    ),
    fullscreenShadeOpacity: clampNumber(
      Number(source.fullscreenShadeOpacity ?? DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity),
      0,
      1,
    ),
    textAlign,
    lineHeight: clampNumber(
      Number(source.lineHeight ?? DEFAULT_THEME_SETTINGS.lineHeight),
      1.05,
      1.8,
    ),
    fontWeight,
    fontStyle,
    textTransform,
    textShadow: typeof source.textShadow === "string" ? source.textShadow : DEFAULT_THEME_SETTINGS.textShadow,
    animation,
    animationDuration: clampNumber(
      Number(source.animationDuration ?? DEFAULT_THEME_SETTINGS.animationDuration),
      100,
      2000,
    ),
    backgroundImage: typeof source.backgroundImage === "string" ? source.backgroundImage : "",
    backgroundImageFilePath: typeof source.backgroundImageFilePath === "string" ? source.backgroundImageFilePath : "",
    backgroundVideo: typeof source.backgroundVideo === "string" ? source.backgroundVideo : "",
    backgroundVideoFilePath: typeof source.backgroundVideoFilePath === "string" ? source.backgroundVideoFilePath : "",
    backgroundOpacity: clampNumber(
      Number(source.backgroundOpacity ?? 1),
      0,
      1,
    ),
    backgroundColor: sanitizeColor(source.backgroundColor, DEFAULT_THEME_SETTINGS.backgroundColor || "#0B1426"),
    backgroundColorEnd: sanitizeColor(source.backgroundColorEnd, DEFAULT_THEME_SETTINGS.backgroundColorEnd || "#162040"),
    bgGradientAngle: clampNumber(Number(source.bgGradientAngle ?? DEFAULT_THEME_SETTINGS.bgGradientAngle ?? 180), 0, 360),
    referenceBackgroundEnabled: source.referenceBackgroundEnabled === true,
    referenceBackgroundColor: sanitizeColor(
      source.referenceBackgroundColor,
      DEFAULT_THEME_SETTINGS.referenceBackgroundColor,
    ),
    referenceBackgroundStyle:
      source.referenceBackgroundStyle === "solid" ||
        source.referenceBackgroundStyle === "pill" ||
        source.referenceBackgroundStyle === "outline"
        ? source.referenceBackgroundStyle
        : DEFAULT_THEME_SETTINGS.referenceBackgroundStyle,
    referenceBackgroundRadius: clampNumber(
      Number(source.referenceBackgroundRadius ?? 12),
      0,
      40,
    ),
    lowerThirdPosition:
      source.lowerThirdPosition === "left" || source.lowerThirdPosition === "center" || source.lowerThirdPosition === "right"
        ? source.lowerThirdPosition
        : "center",
    lowerThirdSize:
      source.lowerThirdSize === "smallest" || source.lowerThirdSize === "smaller" || source.lowerThirdSize === "small" || source.lowerThirdSize === "medium" || source.lowerThirdSize === "big" || source.lowerThirdSize === "bigger" || source.lowerThirdSize === "biggest"
        ? source.lowerThirdSize
        : "medium",
    lowerThirdWidthPreset:
      source.lowerThirdWidthPreset === "full" || source.lowerThirdWidthPreset === "xl" || source.lowerThirdWidthPreset === "lg" || source.lowerThirdWidthPreset === "md" || source.lowerThirdWidthPreset === "sm"
        ? source.lowerThirdWidthPreset
        : "full",
    lowerThirdOffsetX: clampNumber(
      Number(source.lowerThirdOffsetX ?? 0),
      -50,
      50,
    ),
    backgroundPattern: typeof source.backgroundPattern === "string" ? source.backgroundPattern : "",
    lowerThirdCaptionPosition:
      source.lowerThirdCaptionPosition === "top" || source.lowerThirdCaptionPosition === "bottom"
        ? source.lowerThirdCaptionPosition
        : "bottom",
    lowerThirdEdge: sanitizeLowerThirdEdge(source.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(source.lowerThirdCardPadding),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(source.lowerThirdPaddingLinked),
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(source.lowerThirdCardRadius ?? source.borderRadius),
    boxBackground: typeof source.boxBackground === "string" ? source.boxBackground : "",
    boxBackgroundImage: typeof source.boxBackgroundImage === "string" ? source.boxBackgroundImage : "",
    boxOpacity: clampNumber(Number(source.boxOpacity ?? 1), 0, 1),
    borderRadius: clampNumber(Number(source.borderRadius ?? source.lowerThirdCardRadius ?? 16), 0, 64),
    padding: clampNumber(Number(source.padding ?? 28), 0, 200),
    safeArea: clampNumber(Number(source.safeArea ?? 40), 0, 200),
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(source.lowerThirdTextDirection),
    compareTranslationWidth: compareSettings.compareLeftWidth,
    backgroundType: source.backgroundType,
    ...compareSettings,
  };
}

function getWorshipThemeVariantForMode(
  theme: BibleTheme,
  mode: OverlayMode,
): BibleTheme {
  const variant = mode === "lower-third"
    ? theme.variants?.lowerThird
    : theme.variants?.fullscreen;
  return variant
    ? { ...theme, settings: variant.settings, rawTemplate: variant.rawTemplate }
    : theme;
}

function applyQuickThemeSettings(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null,
): BibleTheme {
  if (!quickSettings) return theme;
  const bgType = quickSettings.backgroundType
    ?? (quickSettings.backgroundVideo
      ? "video"
      : quickSettings.backgroundImage
        ? "image"
        : quickSettings.backgroundPattern
          ? "pattern"
          : quickSettings.backgroundColor && quickSettings.backgroundColor !== "transparent"
            ? "color"
            : "theme");
  const useThemeBg = bgType === "theme";
  const useNoBg = bgType === "off";
  const useColorBg = bgType === "color";
  const usePatternBg = bgType === "pattern";
  const useImageBg = bgType === "image";
  const useVideoBg = bgType === "video";
  const compareSettings = normalizeCompareThemeSettings(quickSettings as Record<string, unknown>);
  return {
    ...theme,
    settings: {
      ...theme.settings,
      // Size / position tweaks for layer themes (ignored by legacy themes).
      ...pickLayoutAdjust(quickSettings),
      fontSize: quickSettings.fontSize,
      autoFontScale: true,
      fontFamily: quickSettings.fontFamily,
      refFontSize: quickSettings.refFontSize,
      fontColor: quickSettings.fontColor,
      refFontColor: quickSettings.refFontColor,
      refPosition: quickSettings.refPosition,
      refAnchor: quickSettings.refAnchor ?? "normal",
      refTextTransform: quickSettings.refTextTransform,
      refLetterSpacing: quickSettings.refLetterSpacing,
      refOpacity: quickSettings.refOpacity,
      refTextAlign: quickSettings.refTextAlign,
      refSpacing: quickSettings.refSpacing,
      fullscreenShadeColor: quickSettings.fullscreenShadeColor,
      fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity,
      fullscreenShadeEnabled: quickSettings.fullscreenShadeOpacity > 0,
      textAlign: quickSettings.textAlign,
      lineHeight: quickSettings.lineHeight,
      letterSpacing: quickSettings.letterSpacing,
      wordSpacing: quickSettings.wordSpacing,
      fontWeight: quickSettings.fontWeight,
      refFontWeight: quickSettings.refFontWeight,
      textTransform: quickSettings.textTransform,
      textShadow: quickSettings.textShadow,
      textOutline: quickSettings.textOutline,
      textOutlineColor: quickSettings.textOutlineColor,
      textOutlineWidth: quickSettings.textOutlineWidth,
      fontStyle: quickSettings.fontStyle,
      animation: quickSettings.animation,
      animationDuration: quickSettings.animationDuration,
      // Keep the selected mode in the live theme payload as well as in the
      // quick-settings snapshot so the next lyric cannot fall back to the
      // theme's previous background.
      backgroundType: bgType,
      // Keep the last pattern in quick settings so the picker can restore it
      // after a temporary color/video switch, but only send it to the overlay
      // while Pattern is the active background mode.
      backgroundPattern: useNoBg || useColorBg || useImageBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundPattern ?? "")
          : quickSettings.backgroundPattern,
      boxBackground: useNoBg
        ? "transparent"
        : (quickSettings.boxBackground || theme.settings.boxBackground || (useColorBg ? quickSettings.backgroundColor : "rgba(15, 23, 42, 0.85)")),
      boxBackgroundImage: quickSettings.boxBackgroundImage ?? theme.settings.boxBackgroundImage ?? "",
      boxOpacity: quickSettings.boxOpacity ?? theme.settings.boxOpacity ?? 1,
      borderRadius: quickSettings.borderRadius ?? theme.settings.borderRadius ?? 16,
      padding: typeof quickSettings.padding === "number" ? quickSettings.padding : (theme.settings.padding ?? 28),
      safeArea: typeof quickSettings.safeArea === "number" ? quickSettings.safeArea : (theme.settings.safeArea ?? 40),
      backgroundImage: useNoBg || useColorBg || usePatternBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImage ?? "")
          : quickSettings.backgroundImage,
      backgroundImageFilePath: useNoBg || useColorBg || usePatternBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImageFilePath ?? "")
          : quickSettings.backgroundImageFilePath,
      backgroundVideo: useNoBg || useColorBg || usePatternBg || useImageBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideo ?? "")
          : quickSettings.backgroundVideo,
      backgroundVideoFilePath: useNoBg || useColorBg || usePatternBg || useImageBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideoFilePath ?? "")
          : quickSettings.backgroundVideoFilePath,
      backgroundOpacity: useNoBg ? 0 : quickSettings.backgroundOpacity,
      backgroundColor: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColor || "#0B1426")
          : useColorBg
            ? (quickSettings.backgroundColor || "#0B1426")
            : (quickSettings.backgroundColor || "transparent"),
      backgroundColorEnd: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColorEnd || "#162040")
          : useColorBg
            ? (quickSettings.backgroundColorEnd || "#162040")
            // Image/pattern/video: no gradient end, so a leftover gradient can't cover the media.
            : (usePatternBg || useImageBg || useVideoBg) ? "" : (quickSettings.backgroundColorEnd || ""),
      bgGradientAngle: useThemeBg ? (theme.settings.bgGradientAngle ?? 180) : quickSettings.bgGradientAngle,
      referenceBackgroundEnabled: quickSettings.referenceBackgroundEnabled,
      referenceBackgroundColor: quickSettings.referenceBackgroundColor,
      referenceBackgroundStyle: quickSettings.referenceBackgroundStyle,
      referenceBackgroundRadius: quickSettings.referenceBackgroundRadius,
      lowerThirdPosition: quickSettings.lowerThirdPosition,
      lowerThirdSize: quickSettings.lowerThirdSize,
      lowerThirdWidthPreset: quickSettings.lowerThirdWidthPreset,
      lowerThirdOffsetX: quickSettings.lowerThirdOffsetX,
      lowerThirdCaptionPosition: quickSettings.lowerThirdCaptionPosition,
      lowerThirdEdge: quickSettings.lowerThirdEdge,
      lowerThirdCardPadding: quickSettings.lowerThirdCardPadding,
      lowerThirdPaddingLinked: quickSettings.lowerThirdPaddingLinked,
      lowerThirdCardRadius: quickSettings.lowerThirdCardRadius,
      lowerThirdTextDirection: quickSettings.lowerThirdTextDirection,
      ...compareSettings,
    },
  };
}

function cleanWorshipSectionLabel(label: string): string {
  const normalized = label.trim();
  if (!normalized) return "";
  return /^verse\s+\d+$/i.test(normalized) ? "" : normalized;
}

function stageItemLabel(song: DockSong, section: DockWorshipSection, titleOverride?: string): string {
  const displayLabel = cleanWorshipSectionLabel(section.label);
  return displayLabel || titleOverride || song.title;
}

function getWorshipSectionTranslation(
  sectionId: string,
  translation: DockTranslationValue | null,
): string {
  return normalizeDockMultilineText(translation?.translatedSections[sectionId] ?? "").trim();
}

function DockWorshipTab({
  staged,
  onStage,
  productionDefaults,
  notesProductionDefaults,
  presentationOutputTarget = "obs",
          searchPlacement = "top",
  fullscreenOnly = false,
  showSubtabs = true,
  initialSubTab,
  compactVerticalNav = false,
  isActive = true,
}: Props) {
  const worshipLabel = useDockTabLabelMode("worship");
  const { t } = useTranslation();
  const tabRootRef = useRef<HTMLDivElement>(null);
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const fullscreenOnlyMode = Boolean(fullscreenOnly);
  const [sceneRoute, updateSceneRoute] = useDockSceneRoute("worship");
  const hasSceneRoute = sceneRoute.enabled && sceneRoute.targets.length > 0;
  const worshipSceneRouteConfirmedRef = useRef(false);
  const [pendingWorshipRouteConfirm, setPendingWorshipRouteConfirm] = useState<{
    idx: number;
    options?: {
      overlayMode?: OverlayMode;
      showPresentationMeta?: boolean;
      quickSettingsOverride?: DockFullscreenQuickThemeSettings;
      awaitFontFit?: boolean;
      bypassSceneRoute?: boolean;
    };
  } | null>(null);

  const sceneRouteTargetsKey = useMemo(() => {
    return `${sceneRoute.enabled ? "1" : "0"}:${sceneRoute.targets.map((t) => `${t.sceneName}:${t.mode}`).join(",")}`;
  }, [sceneRoute.enabled, sceneRoute.targets]);

  useEffect(() => {
    worshipSceneRouteConfirmedRef.current = false;
  }, [sceneRouteTargetsKey]);

  const pushWorshipToConfiguredOutput = useCallback(async (
    data: DockTabContentPushData,
    options?: DockOverlayFitOptions,
    pushOptions?: { bypassSceneRoute?: boolean },
  ) => {
    if (!hasSceneRoute || pushOptions?.bypassSceneRoute) {
      return dockObsClient.pushWorshipLyrics(data, options);
    }
    await Promise.all(sceneRoute.targets.map((target) => {
      if (target.mode === "inherit") {
        return dockObsClient.pushWorshipToScene(data, target.sceneName);
      }

      const targetThemeSettings = target.mode === "fullscreen"
        ? (liveFullscreenThemeSettingsRef.current ?? data.bibleThemeSettings)
        : (liveLowerThirdThemeSettingsRef.current ?? data.bibleThemeSettings);
      return dockObsClient.pushWorshipToScene({
        ...data,
        overlayMode: target.mode,
        bibleThemeSettings: targetThemeSettings,
      }, target.sceneName);
    }));
    if (sceneRoute.syncPresentation) return dockObsClient.pushWorshipLyrics(data, options);
    return null;
  }, [hasSceneRoute, sceneRoute.targets, sceneRoute.syncPresentation]);

  const clearWorshipFromConfiguredOutput = useCallback(async () => {
    if (!hasSceneRoute) {
      await dockObsClient.clearWorshipLyrics();
      return;
    }
    await Promise.all(sceneRoute.targets.map((target) => (
      dockObsClient.clearSceneRouteSource("worship", target.sceneName)
    )));
    if (sceneRoute.syncPresentation) await dockObsClient.clearWorshipLyrics();
  }, [hasSceneRoute, sceneRoute.targets, sceneRoute.syncPresentation]);
  // The Dock settings database has already been hydrated by DockAuthGate.
  // Show the last local song snapshot immediately while the main app bridge
  // refreshes it in the background.
  const [documentImportOpen, setDocumentImportOpen] = useState(false);
  const [songs, setSongs] = useState<DockSong[]>(() => loadCachedSongs());
  const rawSongsRef = useRef<DockSong[]>([]);
  // Initialize from localStorage so the limit is known immediately
  const [songLimit, setSongLimit] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(getUserScopedKey("ocs-dock-song-limit"));
      if (stored !== null) {
        const parsed = Number(stored);
        if (!isNaN(parsed) && parsed > 0 && parsed < 9999) return parsed;
      }
    } catch { /* ignore */ }
    return 0;
  });
  const songLimitRef = useRef(songLimit);
  // Keep the ref in sync so callbacks (openNewSongModal, handleSaveNewSong)
  // always read the latest limit even though they can't depend on state directly.
  useEffect(() => { songLimitRef.current = songLimit; }, [songLimit]);

  // ── Plan-filtered songs: only songs within the user's plan limit ──
  const accessibleSongs = useMemo(() => {
    return songs;
  }, [songs, songLimit]);

  // Skip auto-selecting a song from the persisted staged item on first mount.
  // The staged item is restored from localStorage on reload; we only want to
  // navigate into a song when the user explicitly stages a new one.
  const isInitialMount = useRef(true);
  useEffect(() => { isInitialMount.current = false; }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 160);
  const [lyricsSearchQuery, setLyricsSearchQuery] = useState("");
  const debouncedLyricsSearchQuery = useDebouncedValue(lyricsSearchQuery, 160);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(
    () => loadDockWorshipUiPreferences().toolbarCollapsed === true,
  );
  const [bottomSearchExpanded, setBottomSearchExpanded] = useState(true);
  const [quickActionsTop, setQuickActionsTop] = useState(
    () => loadDockWorshipUiPreferences().quickActionsTop ?? DEFAULT_DOCK_OUTPUT_QUICK_ACTIONS_TOP,
  );
  const [quickActionsLeft, setQuickActionsLeft] = useState<number | null>(
    () => loadDockWorshipUiPreferences().quickActionsLeft ?? null,
  );
  const [quickUpdateImmediately, setQuickUpdateImmediately] = useState(
    () => loadDockWorshipUiPreferences().quickUpdateImmediately !== false,
  );
  const [quickSettingsRefreshNonce, setQuickSettingsRefreshNonce] = useState(0);
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  const [worshipSubTab, setWorshipSubTab] = useState<WorshipSubTab>(
    () => initialSubTab ?? loadDockWorshipUiPreferences().activeSubTab ?? "worship",
  );
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<WorshipSubTab>>(
    () => new Set<WorshipSubTab>([initialSubTab ?? loadDockWorshipUiPreferences().activeSubTab ?? "worship"]),
  );

  useEffect(() => {
    setVisitedSubTabs((prev) => {
      if (prev.has(worshipSubTab)) return prev;
      const next = new Set(prev);
      next.add(worshipSubTab);
      return next;
    });
  }, [worshipSubTab]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentWorshipSearches());
  const [selectedSong, setSelectedSong] = useState<DockSong | null>(null);
  const [worshipTranslation, setWorshipTranslation] = useState<DockTranslationValue | null>(null);
  const [visibleIdx, setVisibleIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [slideContextMenu, setSlideContextMenu] = useState<{ x: number; y: number; sectionIdx: number } | null>(null);
  const [songContextMenu, setSongContextMenu] = useState<{ x: number; y: number; song: DockSong } | null>(null);

  useEffect(() => {
    if (!slideContextMenu) return;
    const handleCloseMenu = () => setSlideContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, [slideContextMenu]);

  useEffect(() => {
    if (!songContextMenu) return;
    const handleCloseMenu = () => setSongContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, [songContextMenu]);

  const [worshipOverlayVisible, setWorshipOverlayVisible] = useState(true);
  const [visibilityActionPending, setVisibilityActionPending] = useState(false);
  const [autoAdvanceActive, setAutoAdvanceActive] = useState(false);
  const [selectedFSTheme, setSelectedFSTheme] = useState<BibleTheme>(
    productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0],
  );
  const [selectedLTTheme, setSelectedLTTheme] = useState<BibleTheme>(
    productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0],
  );
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(
    () => readDockWorshipOverlayMode() ?? productionDefaults.defaultMode,
  );
  const [fullscreenLinesPerSlide, setFullscreenLinesPerSlide] = useState<number>(2);
  const [lowerThirdLinesPerSlide, setLowerThirdLinesPerSlide] = useState<number>(2);
  const [linesPerSlide, setLinesPerSlide] = useState<number>(2);
  const [linesPerSlideOverride, setLinesPerSlideOverride] = useState(false);
  const [lineLayoutOverrideSongId, setLineLayoutOverrideSongId] = useState<string | null>(null);
  const [lineLayoutOverrideAutoSplit, setLineLayoutOverrideAutoSplit] = useState<boolean | null>(null);
  const [savedFullscreenQuickThemeSettings, setSavedFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [fullscreenQuickThemeSettings, setFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [savedLowerThirdQuickThemeSettings, setSavedLowerThirdQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [lowerThirdQuickThemeSettings, setLowerThirdQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [lowerThirdQuickThemeSettingsLinkedToFullscreen, setLowerThirdQuickThemeSettingsLinkedToFullscreen] =
    useState(false);
  const [actionError, setActionError] = useState("");
  const [songEditor, setSongEditor] = useState<DockSong | null>(null);
  const [songDraft, setSongDraft] = useState<DockSongDraft>({ title: "", artist: "", lyrics: "" });
  const [newSongDraft, setNewSongDraft] = useState<DockSongDraft>({ title: "", artist: "", lyrics: "" });
  const [newSongSource, setNewSongSource] = useState<Pick<DockSong, "importSourceName" | "importSourceType" | "importSourceUrl"> | null>(null);
  const [isNewSongModalOpen, setIsNewSongModalOpen] = useState(false);
  const [slideEditor, setSlideEditor] = useState<{
    index: number;
    label: string;
    text: string;
    linesPerSlide: number;
  } | null>(null);

  const closeSongEditor = useCallback(() => {
    setSongEditor(null);
  }, []);

  const closeSlideEditor = useCallback(() => {
    setSlideEditor(null);
  }, []);

  const closeNewSongModal = useCallback(() => {
    setIsNewSongModalOpen(false);
    setNewSongSource(null);
  }, []);
  const [deletedSections, setDeletedSections] = useState<DeletedWorshipSection[]>([]);
  const [showDeletedSectionsPopover, setShowDeletedSectionsPopover] = useState(false);
  const [showCompactSummaryActions, setShowCompactSummaryActions] = useState(false);
  const [showBrowserMenu, setShowBrowserMenu] = useState(false);
  const browserMenuRef = useRef<HTMLDivElement | null>(null);
  const [isConstrained, setIsConstrained] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 400 || window.innerHeight < 450 : false));

  useEffect(() => {
    const handleResize = () => {
      setIsConstrained(window.innerWidth <= 400 || window.innerHeight < 450);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [showAutoAdvanceModal, setShowAutoAdvanceModal] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [onlineSearchOpen, setOnlineSearchOpen] = useState(false);
  const [onlineSearchQuery, setOnlineSearchQuery] = useState("");
  const [onlineSearchSubmittedQuery, setOnlineSearchSubmittedQuery] = useState("");
  const [onlineResults, setOnlineResults] = useState<OnlineLyricsSearchResult[]>([]);
  const [onlineSearchLoading, setOnlineSearchLoading] = useState(false);
  const [onlineSearchError, setOnlineSearchError] = useState("");
  const [hiddenSectionIndexes, setHiddenSectionIndexes] = useState<Set<number>>(() => new Set());
  const [showPresentationMeta, setShowPresentationMeta] = useState(false);
  const [savingSong, setSavingSong] = useState(false);
  const [songDeleteTarget, setSongDeleteTarget] = useState<DockSong | null>(null);
  const [deletingSong, setDeletingSong] = useState(false);

  const worshipModalOpen = Boolean(songEditor || slideEditor || isNewSongModalOpen || onlineSearchOpen || songDeleteTarget);

  useEffect(() => {
    if (!worshipModalOpen) return;

    const root = document.querySelector<HTMLElement>(".dock-root");
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    root?.classList.add("dock-root--modal-open");
    html.classList.add("dock-modal-open");
    body.classList.add("dock-modal-open");
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";

    return () => {
      root?.classList.remove("dock-root--modal-open");
      html.classList.remove("dock-modal-open");
      body.classList.remove("dock-modal-open");
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, [worshipModalOpen]);

  const [toasts, setToasts] = useState<DockToast[]>([]);
  const liveFullscreenThemeSettingsRef = useRef<Record<string, unknown> | null>(null);
  const liveLowerThirdThemeSettingsRef = useRef<Record<string, unknown> | null>(null);
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const selectedFSThemeRef = useRef<BibleTheme>(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
  const selectedLTThemeRef = useRef<BibleTheme>(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
  const searchRef = useRef<HTMLDivElement>(null);
  const deletedSectionsPopoverRef = useRef<HTMLDivElement>(null);
  const deletedSectionsTriggerRef = useRef<HTMLButtonElement>(null);
  const compactSummaryActionsRef = useRef<HTMLDivElement>(null);
  const handleCompactSummaryChildClose = useCallback(() => {
    setShowCompactSummaryActions(false);
  }, []);
  const [deletedSectionsPopoverPos, setDeletedSectionsPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [draggingSectionIdx, setDraggingSectionIdx] = useState<number | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | null>(null);
  const prefsReadyRef = useRef(false);
  const [preferencesHydrated, setPreferencesHydrated] = useState(true);
  const prefsLoadIdRef = useRef(0);
  const songsPollBusyRef = useRef(false);
  const liveSectionRequestIdRef = useRef(0);
  /** Invalidates in-flight lyric pushes when Hide Lyrics is pressed. */
  const visibilityEpochRef = useRef(0);
  const visibilityActionInFlightRef = useRef(false);
  const liveSectionPushTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingQuickSettingsRefreshRef = useRef(false);
  const pendingQuickSettingsOverrideRef = useRef<DockFullscreenQuickThemeSettings | null>(null);
  const manualThemeSettingsSelectionRef = useRef(false);
  const worshipTranslationChangeRef = useRef(false);

  // Keep the editor controlled by the immediate draft so the caret never waits
  // for slide parsing. The preview can safely follow at a lower priority.
  const deferredSongDraft = useDeferredValue(songDraft);

  // Preview sections from the draft lyrics when the song editor is open,
  // so the user sees the effect of their edits (auto-split, spacing, etc.)
  // in real time without having to save first.
  const effectiveLyrics = songEditor && deferredSongDraft.lyrics !== selectedSong?.lyrics
    ? deferredSongDraft.lyrics
    : (selectedSong?.lyrics ?? "");
  const effectiveLinesPerSlide = clampLinesPerSlide(
    songEditor && typeof deferredSongDraft.linesPerSlide === "number"
      ? deferredSongDraft.linesPerSlide
      : linesPerSlide,
  );
  const hasActiveLineLayoutOverride = Boolean(
    selectedSong && lineLayoutOverrideSongId === selectedSong.id,
  );
  const effectiveAutoSplit = songEditor && typeof deferredSongDraft.autoSplit === "boolean"
    ? deferredSongDraft.autoSplit
    : hasActiveLineLayoutOverride && lineLayoutOverrideAutoSplit !== null
      ? lineLayoutOverrideAutoSplit
      : selectedSong?.autoSplit ?? false;
  const hasActiveLineCountOverride = !songEditor
    && hasActiveLineLayoutOverride
    && lineLayoutOverrideAutoSplit === true;
  const shouldSplitByLineCount = effectiveAutoSplit || hasActiveLineCountOverride;

  useEffect(() => {
    if (!selectedSong || hasActiveLineLayoutOverride) return;
    const songLineCount = typeof selectedSong.linesPerSlide === "number"
      ? clampLinesPerSlide(selectedSong.linesPerSlide)
      : DEFAULT_LINES_PER_SLIDE;
    setLinesPerSlide((current) => current === songLineCount ? current : songLineCount);
  }, [hasActiveLineLayoutOverride, selectedSong?.id, selectedSong?.linesPerSlide]);

  const structuredSongText = useMemo(
    () => extractStructuredTextTitle(normalizeDockMultilineText(effectiveLyrics)),
    [effectiveLyrics],
  );
  const selectedSongTitleMarker = structuredSongText.title;
  const selectedSongDisplayTitle = structuredSongText.title || selectedSong?.title || "";
  const selectedSongSections = useMemo(
    () => (selectedSong
      ? parseLyricSections(
        effectiveLyrics,
        effectiveLinesPerSlide,
        shouldSplitByLineCount,
        hasActiveLineCountOverride,
      )
      : []),
    [effectiveLyrics, effectiveLinesPerSlide, hasActiveLineCountOverride, selectedSong, shouldSplitByLineCount],
  );
  const worshipTranslationSourceSignature = useMemo(
    () => getDockTranslationSourceSignature(selectedSongSections),
    [selectedSongSections],
  );
  const effectiveWorshipTranslation = useMemo(
    () => worshipTranslation?.sourceSignature === worshipTranslationSourceSignature ? worshipTranslation : null,
    [worshipTranslation, worshipTranslationSourceSignature],
  );

  const totalLyricLines = useMemo(
    () => selectedSongSections.reduce((total, section) => {
      const nonEmpty = section.text.split("\n").filter((l) => l.trim().length > 0).length;
      return total + nonEmpty;
    }, 0),
    [selectedSongSections],
  );

  const persistedPrefs = useMemo<DockWorshipPreferences>(() => ({
    overlayMode,
    fullscreenThemeId: selectedFSTheme.id,
    lowerThirdThemeId: selectedLTTheme.id,
    linesPerSlide,
    fullscreenLinesPerSlide,
    lowerThirdLinesPerSlide,
    linesPerSlideOverride,
    fullscreenQuickThemeSettings: savedFullscreenQuickThemeSettings,
    lowerThirdQuickThemeSettings: savedLowerThirdQuickThemeSettings,
    lowerThirdQuickThemeSettingsLinkedToFullscreen,
    worshipFontFitMigrationVersion: WORSHIP_FONT_FIT_MIGRATION_VERSION,
    showPresentationMeta,
    updatedAt: new Date().toISOString(),
  }), [
    fullscreenLinesPerSlide,
    linesPerSlide,
    linesPerSlideOverride,
    lowerThirdLinesPerSlide,
    overlayMode,
    lowerThirdQuickThemeSettingsLinkedToFullscreen,
    savedFullscreenQuickThemeSettings,
    savedLowerThirdQuickThemeSettings,
    selectedFSTheme.id,
    selectedLTTheme.id,
    showPresentationMeta,
  ]);
  const visibleSectionIndexes = useMemo(
    () => selectedSongSections.map((_, index) => index).filter((index) => !hiddenSectionIndexes.has(index)),
    [hiddenSectionIndexes, selectedSongSections],
  );

  const lyricsFilteredSectionIndexes = useMemo(() => {
    if (!debouncedLyricsSearchQuery.trim()) return visibleSectionIndexes;
    const query = debouncedLyricsSearchQuery.trim();
    return visibleSectionIndexes.filter((idx) => {
      const section = selectedSongSections[idx];
      if (!section) return false;
      const label = section.label.trim();
      return fuzzyMatch(query, section.text) || (label && fuzzyMatch(query, label));
    });
  }, [debouncedLyricsSearchQuery, visibleSectionIndexes, selectedSongSections]);

  const showToast = useCallback((message: string, tone: DockToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 1500);
    toastTimersRef.current.push(timer);
  }, []);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current = [];
  }, []);

  // Use primitive IDs as effect dependencies to avoid re-running when the backend
  // sends new object references for themes that haven't actually changed.
  const _fsThemeDepId = productionDefaults.fullscreenTheme?.id;
  const _ltThemeDepId = productionDefaults.lowerThirdTheme?.id;

  useEffect(() => {
    const loadId = ++prefsLoadIdRef.current;
    prefsReadyRef.current = false;
    setPreferencesHydrated(false);
    let cancelled = false;
    const applyPreferences = (
      prefs: DockWorshipPreferences,
      allFavorites: BibleTheme[],
    ) => {
      setSelectedFSTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
      setSelectedLTTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
      const initialMode = readDockWorshipOverlayMode() ?? prefs.overlayMode ?? productionDefaults.defaultMode;
      setOverlayMode(initialMode);
      const fsLines = typeof prefs.fullscreenLinesPerSlide === "number"
        ? clampLinesPerSlide(prefs.fullscreenLinesPerSlide)
        : (typeof prefs.linesPerSlide === "number" ? clampLinesPerSlide(prefs.linesPerSlide) : DEFAULT_LINES_PER_SLIDE);
      const ltLines = typeof prefs.lowerThirdLinesPerSlide === "number"
        ? clampLinesPerSlide(prefs.lowerThirdLinesPerSlide)
        : (typeof prefs.linesPerSlide === "number" ? clampLinesPerSlide(prefs.linesPerSlide) : DEFAULT_LINES_PER_SLIDE);
      setFullscreenLinesPerSlide(fsLines);
      setLowerThirdLinesPerSlide(ltLines);
      setLinesPerSlide(initialMode === "fullscreen" ? fsLines : ltLines);
      setLinesPerSlideOverride(
        prefs.linesPerSlideOverride === true
          || (typeof prefs.linesPerSlide === "number"
            && clampLinesPerSlide(prefs.linesPerSlide) !== DEFAULT_LINES_PER_SLIDE),
      );
      setLineLayoutOverrideSongId(null);
      setLineLayoutOverrideAutoSplit(null);
      const preserveManualThemeSettings = manualThemeSettingsSelectionRef.current;
      const candidateFullscreenQuickSettings = sanitizeQuickThemeSettings(
        prefs.fullscreenQuickThemeSettings,
        "fullscreen",
      );
      // Older Worship builds persisted the browser source's measured fit back
      // into the user's requested typography. That left many installations
      // permanently at the 28px floor. Restore the selected theme's requested
      // size once, then keep Worship fit measurements ephemeral.
      // Only applies before the migration has run; afterwards a small font
      // (or settings synced from another tab) must never wipe the saved
      // background and styling.
      const fontFitMigrationDone =
        (prefs.worshipFontFitMigrationVersion ?? 0) >= WORSHIP_FONT_FIT_MIGRATION_VERSION;
      const storedFullscreenQuickSettings =
        candidateFullscreenQuickSettings === null
          || !candidateFullscreenQuickSettings
          || fontFitMigrationDone
          || candidateFullscreenQuickSettings.fontSize > 28
          ? candidateFullscreenQuickSettings
          : null;
      const storedLowerThirdQuickSettings = sanitizeQuickThemeSettings(
        prefs.lowerThirdQuickThemeSettings,
        "lower-third",
      );
      if (!preserveManualThemeSettings) {
        setSavedFullscreenQuickThemeSettings(storedFullscreenQuickSettings);
        setFullscreenQuickThemeSettings(storedFullscreenQuickSettings);
        setSavedLowerThirdQuickThemeSettings(storedLowerThirdQuickSettings);
        setLowerThirdQuickThemeSettings(storedLowerThirdQuickSettings);
        setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
      }
      setShowPresentationMeta(prefs.showPresentationMeta === true);

      const storedFullscreen = allFavorites.find(
        (theme) => theme.id === prefs.fullscreenThemeId
          && themeSupportsBibleOverlayMode(theme, "fullscreen"),
      );
      const storedLowerThird = allFavorites.find(
        (theme) => theme.id === prefs.lowerThirdThemeId
          && themeSupportsBibleOverlayMode(theme, "lower-third"),
      );

      if (storedFullscreen) setSelectedFSTheme(storedFullscreen);
      if (storedLowerThird) setSelectedLTTheme(storedLowerThird);
    };

    const hydratePreferences = async () => {
      try {
        const [allFavorites, appPrefs] = await Promise.all([
          loadDockFavoriteBibleThemes().catch(() => [] as BibleTheme[]),
          loadDockWorshipPreferencesFromApp().catch(() => null),
        ]);

        if (cancelled || loadId !== prefsLoadIdRef.current) return;

        // Local storage and the app bridge can both contain the same preference
        // record. Resolve them before applying anything so an older async result
        // cannot overwrite a newly selected background.
        const latestLocalPrefs = loadDockWorshipPreferences();
        const localUpdatedAt = Date.parse(latestLocalPrefs.updatedAt ?? "");
        const appUpdatedAt = Date.parse(appPrefs?.updatedAt ?? "");
        const prefs = appPrefs
          && Number.isFinite(appUpdatedAt)
          && (!Number.isFinite(localUpdatedAt) || appUpdatedAt > localUpdatedAt)
          ? appPrefs
          : latestLocalPrefs;

        applyPreferences(prefs, allFavorites);
      } catch (error) {
        console.warn("[DockWorshipTab] Failed to hydrate Worship preferences:", error);
        if (!cancelled && loadId === prefsLoadIdRef.current) {
          applyPreferences(loadDockWorshipPreferences(), BUILTIN_THEMES);
        }
      } finally {
        // Do not allow the persistence effect to write the first-paint fallback
        // before the app/native preference sources have finished resolving.
        if (!cancelled && loadId === prefsLoadIdRef.current) {
          prefsReadyRef.current = true;
          setPreferencesHydrated(true);
        }
      }
    };

    // Apply the native snapshot before waiting for favorite themes or any
    // remote fallback. Built-in themes are enough for the first paint; the
    // async pass below replaces them with a saved custom theme when available.
    applyPreferences(loadDockWorshipPreferences(), BUILTIN_THEMES);

    void hydratePreferences().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    productionDefaults.defaultMode,
    _fsThemeDepId,
    _ltThemeDepId,
  ]);

  useEffect(() => {
    if (!preferencesHydrated || !prefsReadyRef.current) return;
    const persist = () => {
      saveDockWorshipPreferences(persistedPrefs);
      dockClient.sendCommand({
        type: "worship:save-preferences",
        payload: persistedPrefs,
        timestamp: Date.now(),
      });
    };
    const timer = window.setTimeout(persist, 0);
    return () => window.clearTimeout(timer);
  }, [persistedPrefs, preferencesHydrated]);

  useEffect(() => {
    saveDockWorshipUiPreferences({
      ...loadDockWorshipUiPreferences(),
      toolbarCollapsed,
      activeSubTab: worshipSubTab,
      quickActionsTop,
      quickActionsLeft,
      quickUpdateImmediately,
    });
  }, [quickActionsLeft, quickActionsTop, quickUpdateImmediately, toolbarCollapsed, worshipSubTab]);

  const mapSongs = useCallback(
    (all: Array<{
      id: string;
      metadata: { title: string; artist?: string; hymnNumber?: string };
      lyrics?: string;
      importSourceName?: string;
      importSourceType?: "manual" | "online" | "document";
      importSourceUrl?: string;
      autoSplit?: boolean;
      linesPerSlide?: number;
      themeId?: string;
    }>): DockSong[] => all.map(mapAppSongToDockSong),
    [],
  );

  const applySongLimit = useCallback((nextSongs: DockSong[]) => {
    rawSongsRef.current = nextSongs;
    let limit = songLimitRef.current;
    // Fallback: read from localStorage if ref is still unset
    if (!limit || limit <= 0 || limit >= 9999) {
      try {
        const stored = localStorage.getItem(getUserScopedKey("ocs-dock-song-limit"));
        if (stored !== null) {
          const parsed = Number(stored);
          if (!isNaN(parsed) && parsed > 0 && parsed < 9999) {
            limit = parsed;
            songLimitRef.current = parsed;
            setSongLimit(parsed);
          }
        }
      } catch { /* ignore */ }
    }
    // Show all songs — locked ones will be visually gated by lockedSongIds
    setSongs(nextSongs);
  }, []);

  const loadSongs = useCallback(async (allowJsonFallback = true) => {
    dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });

    if (!allowJsonFallback) return;

    // If BroadcastChannel already delivered songs, skip the JSON fallback
    // to avoid overwriting the plan-limited list with the full unfiltered set
    if (rawSongsRef.current.length > 0) {
      return;
    }

    try {
      const res = await fetch("/uploads/dock-worship-songs.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = await res.json();
      if (Array.isArray(all) && all.length > 0) {
        // Read the plan limit from localStorage (set by main app) so we
        // can enforce it even when BroadcastChannel hasn't delivered yet.
        try {
          const stored = localStorage.getItem(getUserScopedKey("ocs-dock-song-limit"));
          if (stored !== null) {
            const parsed = Number(stored);
            if (!isNaN(parsed)) {
              songLimitRef.current = parsed;
              setSongLimit(parsed);
            }
          }
        } catch { /* ignore */ }
        const nextSongs = mapSongs(all);
        deferRememberDockSongDefaults(nextSongs);
        applySongLimit(nextSongs);
        return;
      }
    } catch { /* JSON fetch failed */ }

    // Last resort: load from localStorage cache
    const cached = loadCachedSongs();
    if (cached.length > 0) {
      applySongLimit(cached);
    }
  }, [mapSongs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSongs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSongs]);

  // Persist songs to localStorage whenever they change (reliable fallback)
  useEffect(() => {
    if (songs.length > 0) cacheSongsLocally(songs);
  }, [songs]);

  // Re-filter when songLimit changes
  useEffect(() => {
    if (rawSongsRef.current.length > 0) {
      applySongLimit(rawSongsRef.current);
    }
  }, [songLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type === "state:song-limit" && typeof msg.payload === "number") {
        songLimitRef.current = msg.payload;
        setSongLimit(msg.payload);
        return;
      }
      if (msg.type === "state:songs-data" && Array.isArray(msg.payload)) {
        // While the desktop app is still starting (e.g. right after an update)
        // it can briefly report an empty library. Don't blank a populated list
        // on that alone: keep it if the saved library file still has songs.
        if (msg.payload.length === 0 && rawSongsRef.current.length > 0) {
          void fetch(`/uploads/dock-worship-songs.json?_=${Date.now()}`, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : []))
            .then((saved) => {
              if (!Array.isArray(saved) || saved.length === 0) applySongLimit([]);
            })
            .catch(() => undefined);
          return;
        }
        const nextSongs = mapSongs(msg.payload as Parameters<typeof mapSongs>[0]);
        deferRememberDockSongDefaults(nextSongs);
        applySongLimit(nextSongs);
        return;
      }
      if (msg.type === "state:library-updated") {
        void loadSongs();
      }
    });
    return unsub;
  }, [loadSongs]);

  // Fallback polling: refresh songs every 30s in case event-based sync fails
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDockTabVisible(tabRootRef.current)) return;
      if (songsPollBusyRef.current) return;
      songsPollBusyRef.current = true;
      void loadSongs(false).finally(() => { songsPollBusyRef.current = false; });
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadSongs]);

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      const keepSummaryOpen = targetElement?.closest("[data-dock-keep-overflow-open='true']");
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowRecentSearches(false);
      }
      if (
        showDeletedSectionsPopover &&
        !deletedSectionsPopoverRef.current?.contains(event.target as Node) &&
        !deletedSectionsTriggerRef.current?.contains(event.target as Node)
      ) {
        setShowDeletedSectionsPopover(false);
      }
      if (
        !keepSummaryOpen &&
        showCompactSummaryActions &&
        compactSummaryActionsRef.current &&
        target instanceof Node &&
        !compactSummaryActionsRef.current.contains(target)
      ) {
        setShowCompactSummaryActions(false);
      }
      if (
        showBrowserMenu &&
        browserMenuRef.current &&
        target instanceof Node &&
        !browserMenuRef.current.contains(target)
      ) {
        setShowBrowserMenu(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showBrowserMenu, showCompactSummaryActions, showDeletedSectionsPopover]);

  const handleToggleDeletedSectionsPopover = useCallback(() => {
    setShowDeletedSectionsPopover((current) => {
      if (!current && deletedSectionsTriggerRef.current) {
        const rect = deletedSectionsTriggerRef.current.getBoundingClientRect();
        const popoverWidth = 320;
        const popoverHeight = 280;
        const top = rect.bottom + 6 + popoverHeight > window.innerHeight
          ? Math.max(8, rect.top - popoverHeight - 6)
          : rect.bottom + 6;
        const left = Math.max(8, Math.min(rect.right - popoverWidth, window.innerWidth - popoverWidth - 8));
        setDeletedSectionsPopoverPos({ top, left });
      }
      return !current;
    });
  }, []);

  const filteredSongs = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return accessibleSongs;
    }
    const q = debouncedSearchQuery.trim();
    const qLower = q.toLowerCase();
    const numMatch = qLower.match(/(\d+)/);
    const searchNumber = numMatch ? numMatch[1] : null;

    let scored = accessibleSongs
      .map((song) => {
        const title = song.title.toLowerCase();
        let score = 0;

        if (searchNumber && song.hymnNumber === searchNumber) score += 10000;
        if (searchNumber && score === 0) {
          const exactTitleRe = new RegExp(`^hymn\\s+${searchNumber}$`);
          const numDotRe = new RegExp(`^${searchNumber}[.\\s]`);
          const bareNumRe = new RegExp(`^${searchNumber}$`);
          if (exactTitleRe.test(title)) score += 10000;
          else if (bareNumRe.test(title)) score += 10000;
          else if (numDotRe.test(title)) score += 10000;
          else if (title.includes(`hymn ${searchNumber}`)) score += 5000;
          else if (title.includes(searchNumber)) score += 2000;
        }

        if (score === 0 && title.startsWith(qLower)) score += 3000;
        if (score === 0 && title.includes(qLower)) score += 1000;
        const searchText = getSongSearchText(song);
        if (score === 0 && searchText.includes(qLower)) score += 500;
        if (score === 0) {
          const tScore = fuzzyScore(q, title);
          if (tScore >= 200) {
            score += 300 + Math.round(tScore / 10);
          } else {
            const lScore = fuzzyScore(q, searchText);
            if (lScore >= 200) {
              score += 100 + Math.round(lScore / 20);
            }
          }
        }

        return { song, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    // When real matches exist, suppress low-confidence fuzzy-only results
    const bestScore = scored.length > 0 ? scored[0].score : 0;
    if (bestScore >= 500) {
      scored = scored.filter((item) => item.score >= 500);
    }

    return scored.map((item) => item.song);
  }, [debouncedSearchQuery, accessibleSongs]);

  const INITIAL_SONGS_RENDER_LIMIT = 40;
  const [visibleSongCount, setVisibleSongCount] = useState<number>(INITIAL_SONGS_RENDER_LIMIT);

  useEffect(() => {
    setVisibleSongCount(INITIAL_SONGS_RENDER_LIMIT);
  }, [debouncedSearchQuery]);

  const handleSongListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 250) {
      setVisibleSongCount((prev) => (prev < filteredSongs.length ? prev + 40 : prev));
    }
  }, [filteredSongs.length]);

  const renderedSongs = useMemo(() => {
    return filteredSongs.slice(0, visibleSongCount);
  }, [filteredSongs, visibleSongCount]);

  // ── Plan-locked songs: songs beyond the plan limit get a blur + padlock ──
  const lockedSongIds = useMemo(() => {
    const locked = new Set<string>();
    const isUnlimited = !songLimit || songLimit <= 0 || songLimit >= 9999;
    if (isUnlimited) return locked;

    // Also check server-provided entitlements for consistency
    let effectiveLimit = songLimit;
    try {
      const raw = localStorage.getItem(getUserScopedKey("ocs-dock-entitlements"));
      if (raw) {
        const ent = JSON.parse(raw);
        if (typeof ent.songs === "number" && (ent.songs === -1 || ent.songs >= 0)) {
          effectiveLimit = ent.songs === -1 ? 0 : ent.songs;
        }
      }
    } catch { /* ignore */ }

    if (effectiveLimit <= 0) return locked;

    let count = 0;
    for (const song of songs) {
      if (count >= effectiveLimit) locked.add(song.id);
      count++;
    }
    return locked;
  }, [songs, songLimit]);

  // ── Remember the open song and slide across reloads ──
  // Reopening only selects them. Nothing is sent to the output until the operator does it.
  const [songRestoreTarget] = useState<{ songId: string; slideIdx: number } | null>(() => {
    const prefs = loadDockWorshipUiPreferences();
    return prefs.lastSongId ? { songId: prefs.lastSongId, slideIdx: prefs.lastSlideIndex ?? 0 } : null;
  });
  const songRestoreSettledRef = useRef(songRestoreTarget === null);

  useEffect(() => {
    if (songRestoreSettledRef.current || !songRestoreTarget) return;
    // Something else (the operator, a staged item, another tab) already opened a song.
    if (selectedSong) {
      songRestoreSettledRef.current = true;
      return;
    }
    // The song list may still be loading; try again when it changes.
    const match = songs.find((song) => song.id === songRestoreTarget.songId);
    if (!match) return;
    songRestoreSettledRef.current = true;
    if (lockedSongIds.has(match.id)) return;
    setSelectedSong(match);
    setSelectedIdx(songRestoreTarget.slideIdx);
    setVisibleIdx(null);
    setHiddenSectionIndexes(new Set());
  }, [songs, selectedSong, songRestoreTarget, lockedSongIds]);

  useEffect(() => {
    if (!songRestoreSettledRef.current) return;
    saveDockWorshipUiPreferences({
      ...loadDockWorshipUiPreferences(),
      lastSongId: selectedSong?.id,
      lastSlideIndex: selectedSong ? (selectedIdx ?? 0) : undefined,
    });
  }, [selectedSong?.id, selectedIdx]);

  const baseFullscreenTheme = useMemo(() => {
    const variant = selectedFSTheme.variants?.fullscreen;
    return variant
      ? { ...selectedFSTheme, settings: variant.settings, rawTemplate: variant.rawTemplate }
      : selectedFSTheme;
  }, [selectedFSTheme]);
  const baseLowerThirdTheme = useMemo(() => {
    const variant = selectedLTTheme.variants?.lowerThird;
    return variant
      ? { ...selectedLTTheme, settings: variant.settings, rawTemplate: variant.rawTemplate }
      : selectedLTTheme;
  }, [selectedLTTheme]);

  const effectiveSelectedFSTheme = useMemo(
    () => applyQuickThemeSettings(baseFullscreenTheme, fullscreenQuickThemeSettings),
    [baseFullscreenTheme, fullscreenQuickThemeSettings],
  );
  const defaultFullscreenQuickThemeSettings = useMemo(
    () => ({
      ...extractQuickThemeSettings(baseFullscreenTheme.settings),
      backgroundType: "theme" as const,
    }),
    [baseFullscreenTheme.settings],
  );
  const defaultLowerThirdQuickThemeSettings = useMemo(
    () => buildDefaultLowerThirdQuickThemeSettings(baseLowerThirdTheme.settings, "theme"),
    [baseLowerThirdTheme.settings],
  );
  const effectiveLowerThirdQuickThemeSettings = useMemo(() => {
    return normalizeLowerThirdFitSettings(
      lowerThirdQuickThemeSettings ?? defaultLowerThirdQuickThemeSettings,
    );
  }, [
    defaultLowerThirdQuickThemeSettings,
    lowerThirdQuickThemeSettings,
  ]);
  const effectiveSelectedLTTheme = useMemo(() => {
    return applyQuickThemeSettings(baseLowerThirdTheme, effectiveLowerThirdQuickThemeSettings);
  }, [baseLowerThirdTheme, effectiveLowerThirdQuickThemeSettings]);

  useEffect(() => {
    liveFullscreenThemeSettingsRef.current = effectiveSelectedFSTheme.settings as unknown as Record<string, unknown>;
    liveLowerThirdThemeSettingsRef.current = effectiveSelectedLTTheme.settings as unknown as Record<string, unknown>;
  }, [effectiveSelectedFSTheme, effectiveSelectedLTTheme]);

  const activeFullscreenQuickThemeSettings = useMemo(
    () => ({
      ...extractQuickThemeSettings(effectiveSelectedFSTheme.settings),
      backgroundType: fullscreenQuickThemeSettings?.backgroundType ?? "theme",
    }),
    [effectiveSelectedFSTheme.settings, fullscreenQuickThemeSettings],
  );
  const activeLowerThirdQuickThemeSettings = useMemo(
    () => ({
      ...extractQuickThemeSettings(effectiveSelectedLTTheme.settings),
      backgroundType: effectiveLowerThirdQuickThemeSettings.backgroundType ?? "theme",
    }),
    [
      effectiveLowerThirdQuickThemeSettings,
      effectiveSelectedLTTheme.settings,
    ],
  );
  const isFullscreen = fullscreenOnlyMode || overlayMode === "fullscreen";
  const activeWorshipQuickSettings = isFullscreen
    ? activeFullscreenQuickThemeSettings
    : activeLowerThirdQuickThemeSettings;
  const activeWorshipSizePresets = isFullscreen
    ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN
    : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;
  const activeWorshipSizePreset = useMemo(() => {
    return activeWorshipSizePresets.find(
      (option) => option.preset === activeWorshipQuickSettings.lowerThirdSize,
    )?.id;
  }, [activeWorshipQuickSettings.lowerThirdSize, activeWorshipSizePresets]);
  const getWorshipQuickSizePatch = useCallback((id: string): DockOutputQuickSettingsPatch | null => {
    const isFullscreen = fullscreenOnlyMode || overlayMode === "fullscreen";
    const sizeOptions = isFullscreen
      ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN
      : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;
    const option = sizeOptions.find((item) => item.id === id);
    if (!option) return null;
    const preset = LOWER_THIRD_SIZE_PRESETS[option.preset];
    const minFontSize = isFullscreen ? 16 : LOWER_THIRD_FIT_MIN_FONT_SIZE;
    const maxFontSize = isFullscreen ? 200 : LOWER_THIRD_FONT_SIZE_MAX;
    const minRefFontSize = isFullscreen ? 10 : LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE;
    const maxRefFontSize = isFullscreen ? 150 : LOWER_THIRD_REFERENCE_FONT_SIZE_MAX;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const cardPadding = option.cardPadding ?? preset.padding;
    const horizontalPadding = Math.round(cardPadding * 1.55);
    return {
      fontSize: clamp(option.fontSize, minFontSize, maxFontSize),
      refFontSize: clamp(option.refFontSize, minRefFontSize, maxRefFontSize),
      ...(option.refFontWeight ? { refFontWeight: option.refFontWeight } : {}),
      lineHeight: preset.lineHeight,
      refSpacing: option.refSpacing ?? preset.refSpacing,
      lowerThirdSize: option.preset,
      lowerThirdWidthPreset: lowerThirdQuickThemeSettings?.lowerThirdWidthPreset === "full" ? "full" : option.width,
      lowerThirdCardPadding: `${cardPadding}px ${horizontalPadding}px`,
      lowerThirdBarMaxHeight: option.cardMaxHeight ?? preset.maxHeight,
    };
  }, [fullscreenOnlyMode, lowerThirdQuickThemeSettings?.lowerThirdWidthPreset, overlayMode]);
  const handleWorshipQuickCommit = useCallback((
    patch: DockOutputQuickSettingsPatch,
    nextLineCount?: number,
    nextLineMode?: DockOutputLineMode,
    targetSongId?: string,
  ) => {
    manualThemeSettingsSelectionRef.current = true;
    const isFullscreen = fullscreenOnlyMode || overlayMode === "fullscreen";
    let nextFullscreenSettings = fullscreenQuickThemeSettings ?? defaultFullscreenQuickThemeSettings;
    let nextLowerThirdSettings = lowerThirdQuickThemeSettings ?? defaultLowerThirdQuickThemeSettings;
    // A ready-made layer theme reads its own size / bold / italic fields, not the plain font settings.
    patch = withLayerThemeQuickPatch(patch, {
      layout: (isFullscreen ? baseFullscreenTheme : baseLowerThirdTheme)?.settings?.layout,
      mode: isFullscreen ? "fullscreen" : "lower-third",
      adjustSource: isFullscreen ? nextFullscreenSettings : nextLowerThirdSettings,
      previousFontSize: (isFullscreen ? activeFullscreenQuickThemeSettings : activeLowerThirdQuickThemeSettings).fontSize,
    });

    if (isFullscreen) {
      nextFullscreenSettings = {
        ...nextFullscreenSettings,
        ...patch,
        autoFontScale: true,
      };
      setSavedFullscreenQuickThemeSettings(nextFullscreenSettings);
      setFullscreenQuickThemeSettings(nextFullscreenSettings);
    } else {
      nextLowerThirdSettings = normalizeLowerThirdFitSettings({
        ...nextLowerThirdSettings,
        ...patch,
      });
      setSavedLowerThirdQuickThemeSettings(nextLowerThirdSettings);
      setLowerThirdQuickThemeSettings(nextLowerThirdSettings);
      setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
    }

    if (nextLineMode !== undefined || nextLineCount !== undefined) {
      const nextAutoSplit = nextLineMode !== "original";
      setLineLayoutOverrideSongId(targetSongId ?? selectedSong?.id ?? null);
      setLineLayoutOverrideAutoSplit(nextAutoSplit);
      setLinesPerSlideOverride(nextAutoSplit);
      if (nextLineCount !== undefined) {
        const clamped = clampLinesPerSlide(nextLineCount);
        setLinesPerSlide(clamped);
        if (isFullscreen) {
          setFullscreenLinesPerSlide(clamped);
        } else {
          setLowerThirdLinesPerSlide(clamped);
        }
      }
      setHiddenSectionIndexes(new Set());
      setSelectedIdx(0);
      setVisibleIdx(null);
    }
    if (worshipOverlayVisible) {
      // Keep the exact click result with the refresh request. Waiting for the
      // derived theme state to settle can otherwise republish the old font
      // size when the live browser source is already visible.
      pendingQuickSettingsOverrideRef.current = isFullscreen
        ? nextFullscreenSettings
        : nextLowerThirdSettings;
      pendingQuickSettingsRefreshRef.current = true;
      setQuickSettingsRefreshNonce((current) => current + 1);
    }
  }, [
    activeFullscreenQuickThemeSettings,
    activeLowerThirdQuickThemeSettings,
    baseFullscreenTheme,
    baseLowerThirdTheme,
    defaultFullscreenQuickThemeSettings,
    defaultLowerThirdQuickThemeSettings,
    fullscreenOnlyMode,
    fullscreenQuickThemeSettings,
    lowerThirdQuickThemeSettings,
    overlayMode,
    selectedSong?.id,
    worshipOverlayVisible,
  ]);
  const handleWorshipQuickActionsPositionChange = useCallback((top: number, left: number | null) => {
    setQuickActionsTop(top);
    setQuickActionsLeft(left);
  }, []);
  const handleSelectFSTheme = useCallback((theme: BibleTheme) => {
    setSelectedFSTheme(theme);
    selectedFSThemeRef.current = theme;
  }, []);
  const handleSelectLTTheme = useCallback((theme: BibleTheme) => {
    setSelectedLTTheme(theme);
    selectedLTThemeRef.current = theme;
  }, []);
  const handleOverlayModeChange = useCallback((nextMode: OverlayMode) => {
    if (nextMode === overlayMode) return;

    const targetLineCount = nextMode === "fullscreen" ? fullscreenLinesPerSlide : lowerThirdLinesPerSlide;
    setLinesPerSlide(targetLineCount);
    setOverlayMode(nextMode);
    saveDockWorshipOverlayMode(nextMode);
    trackOverlayModeSwitched("worship", nextMode);
    pendingQuickSettingsRefreshRef.current = true;

    if (nextMode === "lower-third") {
      liveLowerThirdThemeSettingsRef.current = effectiveSelectedLTTheme.settings as unknown as Record<string, unknown>;
      pendingQuickSettingsOverrideRef.current = effectiveLowerThirdQuickThemeSettings;
    } else {
      liveFullscreenThemeSettingsRef.current = effectiveSelectedFSTheme.settings as unknown as Record<string, unknown>;
      pendingQuickSettingsOverrideRef.current = fullscreenQuickThemeSettings ?? defaultFullscreenQuickThemeSettings;
    }

    setQuickSettingsRefreshNonce((current) => current + 1);
  }, [
    defaultFullscreenQuickThemeSettings,
    effectiveLowerThirdQuickThemeSettings,
    effectiveSelectedFSTheme.settings,
    effectiveSelectedLTTheme.settings,
    fullscreenLinesPerSlide,
    fullscreenQuickThemeSettings,
    lowerThirdLinesPerSlide,
    overlayMode,
  ]);
  const activeThemePickerProps = fullscreenOnlyMode || overlayMode === "fullscreen"
    ? { selectedThemeId: selectedFSTheme.id, onSelect: handleSelectFSTheme }
    : { selectedThemeId: selectedLTTheme.id, onSelect: handleSelectLTTheme };
  const resolveThemeQuickSettings = useCallback((theme: BibleTheme): DockFullscreenQuickThemeSettings => {
    const effectiveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
    const variant = effectiveOverlayMode === "lower-third"
      ? theme.variants?.lowerThird
      : theme.variants?.fullscreen;
    const themeSettings = variant?.settings ?? theme.settings;
    return effectiveOverlayMode === "lower-third"
      ? buildDefaultLowerThirdQuickThemeSettings(themeSettings, "theme")
      : {
        ...extractQuickThemeSettings(themeSettings),
        backgroundType: "theme",
      };
  }, [fullscreenOnlyMode, overlayMode]);

  useEffect(() => {
    selectedFSThemeRef.current = selectedFSTheme;
  }, [selectedFSTheme]);

  useEffect(() => {
    selectedLTThemeRef.current = selectedLTTheme;
  }, [selectedLTTheme]);

  const buildSectionPayload = useCallback(
    (idx: number, options?: {
      showPresentationMeta?: boolean;
      quickSettingsOverride?: DockFullscreenQuickThemeSettings;
    }) => {
      if (!selectedSong) return null;
      const section = selectedSongSections[idx];
      if (!section) return null;

      // Use the current rendered mode immediately. The persisted preference is
      // written asynchronously, so rereading it here can send the previous
      // mode during a Fullscreen -> Lower Third click.
      const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
      const displayLabel = cleanWorshipSectionLabel(section.label);
      const renderedTheme = liveOverlayMode === "fullscreen" ? effectiveSelectedFSTheme : effectiveSelectedLTTheme;
      const selectedThemeForMode = liveOverlayMode === "fullscreen"
        ? selectedFSThemeRef.current
        : selectedLTThemeRef.current;
      const baseThemeForMode = getWorshipThemeVariantForMode(selectedThemeForMode, liveOverlayMode);
      const liveThemeSettings = liveOverlayMode === "fullscreen"
        ? liveFullscreenThemeSettingsRef.current
        : liveLowerThirdThemeSettingsRef.current;
      const theme = options?.quickSettingsOverride
        ? applyQuickThemeSettings(
          baseThemeForMode,
          liveOverlayMode === "lower-third"
            ? normalizeLowerThirdFitSettings(options.quickSettingsOverride)
            : options.quickSettingsOverride,
        )
        : liveThemeSettings
          ? { ...renderedTheme, settings: liveThemeSettings as unknown as BibleTheme["settings"] }
          : renderedTheme;
      const presentationMeta = options?.showPresentationMeta ?? showPresentationMeta;
      const sectionTextSource = stripLeadingVerseMarker(normalizeWorshipDisplayText(section.text));
      const translatedSectionText = getWorshipSectionTranslation(section.id, effectiveWorshipTranslation);
      const showBoth = Boolean(effectiveWorshipTranslation?.showBoth && translatedSectionText);
      const sectionText = showBoth ? sectionTextSource : (translatedSectionText || sectionTextSource);
      const translationText = showBoth ? translatedSectionText : "";
      const translationOrder = normalizeDockTranslationOrder(effectiveWorshipTranslation?.translationOrder);

      const resolvedThemeSettings = (() => {
        const base = (theme.settings as unknown as Record<string, unknown>) || {};
        if (liveOverlayMode === "lower-third") {
          const baseFont = Number(base.fontSize || 64);
          const baseRefFont = Number(base.refFontSize || 42);
          return {
            ...base,
            fontSize: baseFont > 0 ? baseFont : 64,
            refFontSize: baseRefFont > 0 ? baseRefFont : 42,
          };
        }
        return base;
      })();

      const stageData = {
        song: selectedSong,
        sectionIdx: idx,
        artist: selectedSong.artist,
        sectionLabel: displayLabel,
        sectionText,
        translationText,
        translationOrder,
        overlayMode: liveOverlayMode,
        linesPerSlide: effectiveLinesPerSlide,
        autoSplit: effectiveAutoSplit,
        theme: theme.id,
        bibleThemeSettings: resolvedThemeSettings,
        liveOverrides: null,
        presentationShowMeta: presentationMeta,
      };

      return {
        section,
        stageItem: {
          type: "worship" as const,
          label: stageItemLabel(selectedSong, section, selectedSongDisplayTitle),
          subtitle: selectedSongDisplayTitle,
          data: stageData,
        },
        obsData: {
          sectionText,
          translationText,
          translationOrder,
          sectionLabel: displayLabel,
          songTitle: selectedSongDisplayTitle,
          artist: selectedSong.artist,
          overlayMode: liveOverlayMode,
          bibleThemeSettings: resolvedThemeSettings,
          liveOverrides: null,
        },
      };
    },
    [
      effectiveLinesPerSlide,
      overlayMode,
      fullscreenOnlyMode,
      baseFullscreenTheme,
      baseLowerThirdTheme,
      effectiveSelectedFSTheme,
      effectiveSelectedLTTheme,
      selectedSong,
      selectedSongDisplayTitle,
      selectedSongSections,
      showPresentationMeta,
      effectiveWorshipTranslation,
    ],
  );

  const handleAddSlideToSchedule = useCallback((sectionIdx: number) => {
    const section = selectedSongSections[sectionIdx];
    if (!section || !selectedSong) return;

    const payload = buildSectionPayload(sectionIdx);
    if (!payload) return;

    const obs = payload.obsData;
    const stage = payload.stageItem.data;

    addWorshipToActiveSchedule({
      songTitle: selectedSongDisplayTitle || selectedSong.title,
      sectionLabel: section.label.trim() || `Slide ${sectionIdx + 1}`,
      sectionText: section.text,
      artist: selectedSong.artist,
      songId: selectedSong.id,
      sectionIdx,
      overlayMode: obs.overlayMode,
      theme: stage.theme,
      bibleThemeSettings: (obs.bibleThemeSettings || stage.bibleThemeSettings) as Record<string, unknown> | null,
      linesPerSlide: stage.linesPerSlide,
      autoSplit: stage.autoSplit,
    });
  }, [buildSectionPayload, selectedSong, selectedSongDisplayTitle, selectedSongSections]);

  const handleAddSongToSchedule = useCallback((song: DockSong) => {
    const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
    const currentTheme = liveOverlayMode === "fullscreen" ? effectiveSelectedFSTheme : effectiveSelectedLTTheme;
    const currentSettings = liveOverlayMode === "fullscreen"
      ? liveFullscreenThemeSettingsRef.current ?? currentTheme.settings
      : liveLowerThirdThemeSettingsRef.current ?? currentTheme.settings;

    addWholeWorshipSongToActiveSchedule({
      songTitle: song.title,
      artist: song.artist,
      lyrics: song.lyrics,
      songId: song.id,
      overlayMode: liveOverlayMode,
      theme: currentTheme.id,
      bibleThemeSettings: currentSettings as unknown as Record<string, unknown> | null,
      linesPerSlide: song.linesPerSlide,
      autoSplit: song.autoSplit,
    });
    showToast(t("schedule.addedSongToSchedule", { defaultValue: `Added "${song.title}" to Schedule` }), "success");
  }, [effectiveSelectedFSTheme, effectiveSelectedLTTheme, fullscreenOnlyMode, overlayMode, showToast, t]);

  const pushSection = useCallback(
    async (idx: number, options?: { showPresentationMeta?: boolean }) => {
      void dockObsClient.ensureModuleSourceOpenAndOnTop("worship", fullscreenOnlyMode ? "fullscreen" : overlayMode);
      const payload = buildSectionPayload(idx, options);
      if (!payload) return;

      setActionError("");
      setSelectedIdx(idx);
      setVisibleIdx(idx);

      onStage(payload.stageItem);
    },
    [buildSectionPayload, fullscreenOnlyMode, onStage, overlayMode],
  );

  const goLiveSection = useCallback(
    (idx: number, options?: {
      overlayMode?: OverlayMode;
      showPresentationMeta?: boolean;
      quickSettingsOverride?: DockFullscreenQuickThemeSettings;
      awaitFontFit?: boolean;
      bypassSceneRoute?: boolean;
    }) => {
      if (hasSceneRoute && !worshipSceneRouteConfirmedRef.current && !options?.bypassSceneRoute) {
        setPendingWorshipRouteConfirm({ idx, options });
        return;
      }
      void dockObsClient.ensureModuleSourceOpenAndOnTop("worship", fullscreenOnlyMode ? "fullscreen" : overlayMode);
      const payload = buildSectionPayload(idx, options);
      if (!payload) return;
      const requestId = ++liveSectionRequestIdRef.current;
      const visibilityEpoch = visibilityEpochRef.current;

      setActionError("");
      setSelectedIdx(idx);
      setVisibleIdx(idx);

      onStage(payload.stageItem);

      if (presentationLinkMode) {
        setWorshipOverlayVisible(true);
        track("song_presented");
        trackWorshipSongPresented();
        return;
      }

      const fitOptions = options?.awaitFontFit ? { waitForFit: true } : undefined;
      const effectiveUseSceneRoute = hasSceneRoute && !options?.bypassSceneRoute;
      const pushLive = () => effectiveUseSceneRoute
        ? pushWorshipToConfiguredOutput(payload.obsData, fitOptions)
        : payload.obsData.overlayMode === "lower-third"
          ? dockObsClient.pushWorshipOverlayFast(payload.obsData, fitOptions)
          : pushWorshipToConfiguredOutput(payload.obsData, fitOptions, { bypassSceneRoute: true });
      // Fullscreen and lower-third use different OBS paths. Queue them at the
      // dock boundary so a slower fullscreen mutation cannot finish after the
      // lower-third mutation and overwrite the active mode in OBS.
      const previousPush = liveSectionPushTailRef.current;
      const queuedPush = (async () => {
        try {
          await previousPush;
        } catch {
          // ignore previous push failure
        }
        if (requestId !== liveSectionRequestIdRef.current) return null;
        return pushLive();
      })();
      liveSectionPushTailRef.current = queuedPush;
      if (options?.awaitFontFit) {
        return queuedPush
          .then((measurement) => {
            if (requestId !== liveSectionRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return measurement;
            setWorshipOverlayVisible(true);
            return measurement;
          })
          .catch((err) => {
            if (requestId === liveSectionRequestIdRef.current) {
              console.warn("[DockWorshipTab] Save-time overlay measurement failed:", err);
            }
            return null;
          });
      }
      queuedPush
        .then(() => {
          if (requestId !== liveSectionRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return;
          setWorshipOverlayVisible(true);
          track("song_presented");
          trackWorshipSongPresented();
        })
        .catch((err) => {
          if (requestId !== liveSectionRequestIdRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
          if (!isTransient) {
            console.warn("[DockWorshipTab] Push worship failed:", err);
            setActionError(message);
          } else {
            console.warn("[DockWorshipTab] Push worship failed (transient):", message);
          }
        });
    },
    [buildSectionPayload, fullscreenOnlyMode, hasSceneRoute, onStage, overlayMode, presentationLinkMode, pushWorshipToConfiguredOutput, sceneRoute.syncPresentation],
  );

  const saveSongInMainApp = useCallback(
    (payload: WorshipDockSongSavePayload): Promise<DockSong> =>
      new Promise((resolve, reject) => {
        const command = createWorshipDockSongSaveCommand(payload);
        let fallbackPosted = false;
        let fallbackError: Error | null = null;
        let fallbackTimer: number | null = null;
        let resultPollTimer: number | null = null;
        let timeoutTimer: number | null = null;
        let unsubscribe = () => { };
        let settled = false;

        const cleanup = () => {
          if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
          if (resultPollTimer !== null) window.clearInterval(resultPollTimer);
          if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
          unsubscribe();
        };

        const complete = (result: {
          ok?: boolean;
          song?: Song;
          error?: string;
        }) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (!result.ok || !result.song) {
            reject(new Error(result.error || "Song save failed."));
            return;
          }
          resolve(mapAppSongToDockSong(result.song));
        };

        unsubscribe = dockClient.onState((msg) => {
          if (msg.type !== "state:worship-song-save-result") return;
          const result = msg.payload as {
            commandId?: string;
            ok?: boolean;
            song?: Song;
            error?: string;
          };
          if (result.commandId !== command.commandId) return;
          complete(result);
        });

        const postFallback = async () => {
          try {
            await postWorshipDockSongSaveCommand(command);
            if (settled) return;
            fallbackPosted = true;
            void loadWorshipDockSongSaveResult(command.commandId).then((result) => {
              if (result) complete(result);
            }).catch(() => { });
          } catch (err) {
            fallbackError = err instanceof Error ? err : new Error(String(err));
            console.warn("[DockWorshipTab] Fallback song save command failed:", fallbackError);
          }
        };

        fallbackTimer = window.setTimeout(() => { void postFallback(); }, DOCK_WORSHIP_SAVE_FALLBACK_DELAY_MS);
        resultPollTimer = window.setInterval(() => {
          if (!fallbackPosted || settled) return;
          void loadWorshipDockSongSaveResult(command.commandId).then((result) => {
            if (!result) return;
            complete(result);
          }).catch(() => { });
        }, DOCK_WORSHIP_SAVE_RESULT_POLL_MS);

        timeoutTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(fallbackError ?? new Error("Main app did not confirm the song save."));
        }, payload.batch ? 120_000 : DOCK_WORSHIP_SAVE_TIMEOUT_MS);

        dockClient.sendCommand({
          type: "worship:song-save",
          payload,
          commandId: command.commandId,
          timestamp: command.timestamp,
        });
      }),
    [],
  );

  const persistSong = useCallback(
    async (
      songId: string,
      draft: DockSongDraft,
      source?: Pick<DockSong, "importSourceName" | "importSourceType" | "importSourceUrl" | "autoSplit" | "linesPerSlide" | "themeId">,
    ) => {
      const title = draft.title.trim();
      const lyrics = draft.lyrics.trim();
      if (!title || !lyrics) return null;

      const dockSong = await saveSongInMainApp({
        id: songId,
        title,
        artist: draft.artist.trim(),
        lyrics,
        importSourceName: source?.importSourceName,
        importSourceType: source?.importSourceType ?? "manual",
        importSourceUrl: source?.importSourceUrl,
        autoSplit: draft.autoSplit ?? source?.autoSplit,
        linesPerSlide: draft.linesPerSlide ?? source?.linesPerSlide,
        themeId: source?.themeId,
      });

      setSongs((current) => {
        const withoutSong = current.filter((song) => song.id !== dockSong.id);
        const updated = [dockSong, ...withoutSong];
        rawSongsRef.current = updated;
        return updated;
      });
      setSelectedSong((current) => (current?.id === dockSong.id ? dockSong : current));
      return dockSong;
    },
    [saveSongInMainApp],
  );

  const openSongEditor = useCallback((song: DockSong) => {
    rememberDockSongDefault(song);
    setSongEditor(song);
    setSongDraft({
      title: song.title,
      artist: song.artist,
      lyrics: song.lyrics,
      autoSplit: song.autoSplit ?? false,
      linesPerSlide: clampLinesPerSlide(song.linesPerSlide),
    });
    setActionError("");
  }, []);

  const handleSaveSongEditor = useCallback(async (draft: DockSongDraft) => {
    if (!songEditor) return;
    let finalTitle = draft.title.trim();
    if (isDummyTitle(finalTitle) || !finalTitle) {
      const derived = extractFirstLineAsTitle(draft.lyrics);
      if (derived) finalTitle = derived;
    }
    const maintainedAutoSplit = draft.autoSplit ?? songEditor.autoSplit ?? false;
    const finalDraft = { ...draft, title: finalTitle, autoSplit: maintainedAutoSplit };
    setSavingSong(true);
    setActionError("");
    try {
      const updatedSong = await persistSong(songEditor.id, finalDraft, songEditor);
      if (updatedSong) {
        setLineLayoutOverrideSongId(null);
        setLineLayoutOverrideAutoSplit(null);
      }
      showToast(t('worship.songSaved'), "success");
      closeSongEditor();
      track("song_created", { autoSplit: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] save song edit failed:", err);
        setActionError(message);
      }
    } finally {
      setSavingSong(false);
    }
  }, [closeSongEditor, persistSong, showToast, songEditor]);

  const handleResetSongEditor = useCallback((): DockSongDraft | null => {
    if (!songEditor) return null;
    const defaults = readDockSongDefaults();
    const fallback = defaults[songEditor.id] ?? songEditor;
    const nextDraft = {
      title: fallback.title,
      artist: fallback.artist,
      lyrics: fallback.lyrics,
      autoSplit: fallback.autoSplit ?? false,
      linesPerSlide: clampLinesPerSlide(fallback.linesPerSlide),
    };
    setSongDraft(nextDraft);
    showToast(t('worship.defaultRestored'));
    return nextDraft;
  }, [showToast, songEditor]);

  const openNewSongModal = useCallback(async (draft?: Partial<DockSongDraft>) => {
    if (!(await requireEntitlement("songs", rawSongsRef.current.length))) return;
    setNewSongDraft({
      title: draft?.title ?? nextAutoSongTitle(),
      artist: draft?.artist ?? "",
      lyrics: draft?.lyrics ?? "",
      autoSplit: false,
      linesPerSlide: draft?.linesPerSlide ?? DEFAULT_LINES_PER_SLIDE,
    });
    setNewSongSource({ importSourceType: "manual" });
    setIsNewSongModalOpen(true);
    setActionError("");
  }, [showToast]);

  const handleSaveNewSong = useCallback(async (draft: DockSongDraft) => {
    if (!(await requireEntitlement("songs", rawSongsRef.current.length))) {
      closeNewSongModal();
      return;
    }
    let finalTitle = draft.title.trim();
    if (isDummyTitle(finalTitle) || !finalTitle) {
      const derived = extractFirstLineAsTitle(draft.lyrics);
      if (derived) finalTitle = derived;
    }
    const finalDraft = { ...draft, title: finalTitle, autoSplit: false };
    setSavingSong(true);
    setActionError("");
    try {
      const newSong = await persistSong(createDockSongId(), finalDraft, newSongSource ?? { importSourceType: "manual" });
      if (newSong) {
        rememberDockSongDefault(newSong);
        closeNewSongModal();
        setLineLayoutOverrideSongId(null);
        setLineLayoutOverrideAutoSplit(null);
        setSelectedSong(newSong);
        setSelectedIdx(0);
        setVisibleIdx(null);
        setHiddenSectionIndexes(new Set());
        showToast(newSong.importSourceType === "online" ? t('worship.importSaved') : t('worship.songAdded'), "success");
        track("song_created", { autoSplit: false });
        trackWorshipSongCreated();
        track("song_imported", { source: newSong.importSourceType ?? "manual" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] add song failed:", err);
        setActionError(message);
      }
    } finally {
      setSavingSong(false);
    }
  }, [closeNewSongModal, newSongSource, persistSong, showToast]);

  useEffect(() => {
    if (!selectedSong) return;
    const maxIndex = visibleSectionIndexes.length - 1;
    const fallbackIndex = visibleSectionIndexes[0] ?? null;
    const clampToVisible = (current: number | null) => {
      if (current === null) return fallbackIndex;
      if (visibleSectionIndexes.includes(current)) return current;
      if (maxIndex < 0) return null;
      return visibleSectionIndexes.find((index) => index > current) ?? visibleSectionIndexes[maxIndex] ?? null;
    };

    setSelectedIdx((current) => clampToVisible(current));
    setVisibleIdx((current) => (current === null ? null : clampToVisible(current)));
  }, [selectedSong, visibleSectionIndexes]);

  useEffect(() => {
    if (!staged || staged.type !== "worship") return;
    // Skip auto-select on initial mount — only react to new staging actions
    if (isInitialMount.current) return;

    const data = staged.data as Record<string, unknown>;
    const stageSong = data.song as DockSong | undefined;
    const stageIdx = typeof data.sectionIdx === "number" ? data.sectionIdx : null;
    if (stageSong) {
      setSelectedSong((current) => {
        if (current?.id === stageSong.id) return current;
        const existing = songs.find((song) => song.id === stageSong.id);
        return existing ?? stageSong;
      });
    }

    if (stageIdx !== null) {
      setSelectedIdx(stageIdx);
      setVisibleIdx(stageIdx);
    }

  }, [songs, staged]);

  const activeSectionIndex = useMemo(() => {
    if (!selectedSong || visibleSectionIndexes.length === 0) return null;
    if (selectedIdx !== null && visibleSectionIndexes.includes(selectedIdx)) return selectedIdx;
    if (visibleIdx !== null && visibleSectionIndexes.includes(visibleIdx)) return visibleIdx;
    return visibleSectionIndexes[0] ?? null;
  }, [visibleIdx, selectedIdx, selectedSong, visibleSectionIndexes]);

  useEffect(() => {
    if (!pendingQuickSettingsRefreshRef.current) return;
    if (!worshipOverlayVisible || activeSectionIndex === null) {
      pendingQuickSettingsRefreshRef.current = false;
      pendingQuickSettingsOverrideRef.current = null;
      return;
    }
    pendingQuickSettingsRefreshRef.current = false;
    const quickSettingsOverride = pendingQuickSettingsOverrideRef.current;
    pendingQuickSettingsOverrideRef.current = null;
    // Only refresh an output that is already visible. Quick settings must not
    // publish a hidden or not-yet-presented song.
    goLiveSection(
      activeSectionIndex,
      quickSettingsOverride ? { quickSettingsOverride } : undefined,
    );
  }, [activeSectionIndex, goLiveSection, quickSettingsRefreshNonce, worshipOverlayVisible]);

  useEffect(() => {
    if (!worshipTranslationChangeRef.current) return;
    worshipTranslationChangeRef.current = false;
    if (
      activeSectionIndex === null
      || !worshipOverlayVisible
      || visibleIdx === null
    ) return;
    void goLiveSection(activeSectionIndex);
  }, [activeSectionIndex, effectiveWorshipTranslation, goLiveSection, visibleIdx, worshipOverlayVisible]);

  const handleSaveFullscreenQuickThemeSettings = useCallback(async (nextSettings: DockFullscreenQuickThemeSettings) => {
    manualThemeSettingsSelectionRef.current = true;
    // Make the selected pattern authoritative before waiting for the current
    // lyric's optional font-fit measurement. The next lyric can be clicked
    // while that measurement is pending.
    liveFullscreenThemeSettingsRef.current = applyQuickThemeSettings(
      getWorshipThemeVariantForMode(selectedFSThemeRef.current, "fullscreen"),
      nextSettings,
    ).settings as unknown as Record<string, unknown>;
    setSavedFullscreenQuickThemeSettings(nextSettings);
    if (worshipOverlayVisible && activeSectionIndex !== null) {
      await goLiveSection(activeSectionIndex, {
        quickSettingsOverride: nextSettings,
        awaitFontFit: true,
      });
    } else {
      void dockObsClient.primeWorshipOverlay({
        overlayMode: "fullscreen",
        bibleThemeSettings: (liveFullscreenThemeSettingsRef.current || nextSettings) as Record<string, unknown>,
        backgroundOnly: true,
      });
    }
    // Keep the operator's requested size. The browser source may temporarily
    // fit a long lyric smaller, but that measured value must not become the
    // next slide's fixed font size.
    const nextSavedSettings = nextSettings;
    setSavedFullscreenQuickThemeSettings(nextSavedSettings);
    setFullscreenQuickThemeSettings(nextSavedSettings);
  }, [activeSectionIndex, baseFullscreenTheme, goLiveSection, worshipOverlayVisible]);

  const handleSaveLowerThirdQuickThemeSettings = useCallback(async (nextSettings: DockFullscreenQuickThemeSettings) => {
    manualThemeSettingsSelectionRef.current = true;
    const nextLowerThirdSettings = normalizeLowerThirdFitSettings(nextSettings);
    liveLowerThirdThemeSettingsRef.current = applyQuickThemeSettings(
      getWorshipThemeVariantForMode(selectedLTThemeRef.current, "lower-third"),
      nextLowerThirdSettings,
    ).settings as unknown as Record<string, unknown>;
    setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
    setSavedLowerThirdQuickThemeSettings(nextLowerThirdSettings);
    setLowerThirdQuickThemeSettings(nextLowerThirdSettings);
    if (worshipOverlayVisible && activeSectionIndex !== null) {
      await goLiveSection(activeSectionIndex, {
        quickSettingsOverride: nextSettings,
        awaitFontFit: true,
      });
    } else {
      void dockObsClient.primeWorshipOverlay({
        overlayMode: "lower-third",
        bibleThemeSettings: (liveLowerThirdThemeSettingsRef.current || nextSettings) as Record<string, unknown>,
        backgroundOnly: true,
      });
    }
    const nextSavedSettings = nextLowerThirdSettings;
    setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
    setSavedLowerThirdQuickThemeSettings(nextSavedSettings);
    setLowerThirdQuickThemeSettings(nextSavedSettings);
  }, [activeSectionIndex, baseLowerThirdTheme, goLiveSection, worshipOverlayVisible]);

  useEffect(() => {
    const handleThemeSync = (event: Event) => {
      const customEvent = event as CustomEvent<DockThemeSyncPayload>;
      const payload = customEvent.detail;
      if (!payload || !payload.targetTabs.includes("worship")) return;

      const { targetModes, quickSettings, theme, themeId, sourceTab, sourceMode } = payload;
      const findTheme = (id: string | null | undefined): BibleTheme | null => {
        if (!id) return null;
        if (theme && theme.id === id) return theme;
        return BUILTIN_THEMES.find((t) => t.id === id) ?? null;
      };
      const resolvedTheme = theme ?? findTheme(themeId);

      if (targetModes.includes("fullscreen")) {
        if (resolvedTheme) {
          setSelectedFSTheme(resolvedTheme);
          selectedFSThemeRef.current = resolvedTheme;
        }
        setSavedFullscreenQuickThemeSettings(quickSettings);
        setFullscreenQuickThemeSettings(quickSettings);
        const fsTheme = getWorshipThemeVariantForMode(
          resolvedTheme ?? selectedFSThemeRef.current,
          "fullscreen",
        );
        liveFullscreenThemeSettingsRef.current = applyQuickThemeSettings(
          fsTheme,
          quickSettings,
        ).settings as unknown as Record<string, unknown>;
      }

      if (targetModes.includes("lower-third")) {
        const nextLowerThirdSettings = normalizeLowerThirdFitSettings(quickSettings);
        if (resolvedTheme) {
          setSelectedLTTheme(resolvedTheme);
          selectedLTThemeRef.current = resolvedTheme;
        }
        setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
        setSavedLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        setLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        const ltTheme = getWorshipThemeVariantForMode(
          resolvedTheme ?? selectedLTThemeRef.current,
          "lower-third",
        );
        liveLowerThirdThemeSettingsRef.current = applyQuickThemeSettings(
          ltTheme,
          nextLowerThirdSettings,
        ).settings as unknown as Record<string, unknown>;
      }

      const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
      if (targetModes.includes(liveOverlayMode) && (sourceTab !== "worship" || sourceMode !== liveOverlayMode)) {
        // Only re-send a section that was really projected from this tab and
        // is still on air. `worshipOverlayVisible` starts as true and the
        // restored song/slide is only selected, so without these checks a
        // quick edit saved in Notes (or Bible) re-published an old song in
        // Lower third over the Notes slide on the shared Worship/Notes source.
        const worshipIsOnAir = worshipOverlayVisible
          && visibleIdx !== null
          && activeSectionIndex !== null
          && !dockObsClient.isSharedWorshipNotesSourceHeldByOther("worship");
        if (worshipIsOnAir) {
          void goLiveSection(activeSectionIndex, {
            quickSettingsOverride: quickSettings,
            awaitFontFit: true,
          });
        } else {
          const currentLiveSettings = liveOverlayMode === "fullscreen"
            ? liveFullscreenThemeSettingsRef.current
            : liveLowerThirdThemeSettingsRef.current;
          void dockObsClient.primeWorshipOverlay({
            overlayMode: liveOverlayMode,
            bibleThemeSettings: (currentLiveSettings || quickSettings) as Record<string, unknown>,
            backgroundOnly: true,
          });
        }
      }
    };

    window.addEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
    return () => window.removeEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
  }, [
    activeSectionIndex,
    fullscreenOnlyMode,
    goLiveSection,
    overlayMode,
    visibleIdx,
    worshipOverlayVisible,
  ]);

  // A theme was edited in the app: swap in the new copy of the selected one so bold,
  // colours, backgrounds and layers show up without reselecting it.
  useEffect(() => {
    const handleThemesRefreshed = (event: Event) => {
      const themes = (event as CustomEvent<DockThemesRefreshedDetail>).detail?.themes ?? [];
      const freshFS = findRefreshedTheme(selectedFSThemeRef.current, themes, "fullscreen");
      const freshLT = findRefreshedTheme(selectedLTThemeRef.current, themes, "lower-third");
      if (!freshFS && !freshLT) return;
      manualThemeSettingsSelectionRef.current = true;

      if (freshFS) {
        setSelectedFSTheme(freshFS);
        selectedFSThemeRef.current = freshFS;
        // Layer themes keep the operator's size / background tweaks; classic themes
        // restart from the edited look because their saved quick settings are a copy of the old one.
        const keep = themeUsesLayout(freshFS, "fullscreen") ? fullscreenQuickThemeSettings : null;
        if (!keep) {
          setSavedFullscreenQuickThemeSettings(null);
          setFullscreenQuickThemeSettings(null);
        }
        liveFullscreenThemeSettingsRef.current = keep
          ? applyQuickThemeSettings(
            getWorshipThemeVariantForMode(freshFS, "fullscreen"),
            keep,
          ).settings as unknown as Record<string, unknown>
          : null;
      }
      if (freshLT) {
        setSelectedLTTheme(freshLT);
        selectedLTThemeRef.current = freshLT;
        const keep = themeUsesLayout(freshLT, "lower-third") ? lowerThirdQuickThemeSettings : null;
        if (!keep) {
          setSavedLowerThirdQuickThemeSettings(null);
          setLowerThirdQuickThemeSettings(null);
        }
        liveLowerThirdThemeSettingsRef.current = keep
          ? applyQuickThemeSettings(
            getWorshipThemeVariantForMode(freshLT, "lower-third"),
            normalizeLowerThirdFitSettings(keep),
          ).settings as unknown as Record<string, unknown>
          : null;
      }

      // Re-send what is on air with the edited theme, once the new theme state has rendered.
      const liveMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
      const affectsLiveMode = liveMode === "fullscreen" ? Boolean(freshFS) : Boolean(freshLT);
      if (
        affectsLiveMode
        && worshipOverlayVisible
        && visibleIdx !== null
        && activeSectionIndex !== null
        && !dockObsClient.isSharedWorshipNotesSourceHeldByOther("worship")
      ) {
        pendingQuickSettingsRefreshRef.current = true;
        pendingQuickSettingsOverrideRef.current = null;
        setQuickSettingsRefreshNonce((current) => current + 1);
      }
    };

    window.addEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
    return () => window.removeEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
  }, [
    activeSectionIndex,
    fullscreenOnlyMode,
    fullscreenQuickThemeSettings,
    lowerThirdQuickThemeSettings,
    overlayMode,
    visibleIdx,
    worshipOverlayVisible,
  ]);

  const handleSelectSong = useCallback((song: DockSong) => {
    setRecentSearches(pushRecentWorshipSearch(`song: ${song.title}`));
    setShowRecentSearches(false);
    setShowCompactSummaryActions(false);
    setLineLayoutOverrideSongId(null);
    setLineLayoutOverrideAutoSplit(null);
    setSelectedSong(song);
    setSelectedIdx(0);
    setVisibleIdx(null);
    setHiddenSectionIndexes(new Set());
    setActionError("");
  }, []);

  useEffect(() => {
    const checkAndApplyPendingSong = () => {
      const pending = getPendingWorshipSongSelection();
      if (!pending) return;
      const { songId, songTitle } = pending;
      const target =
        songs.find(
          (s) =>
            (songId && s.id === songId) ||
            (songTitle && s.title.trim().toLowerCase() === songTitle.trim().toLowerCase()),
        ) ??
        accessibleSongs.find(
          (s) =>
            (songId && s.id === songId) ||
            (songTitle && s.title.trim().toLowerCase() === songTitle.trim().toLowerCase()),
        );

      if (target) {
        setWorshipSubTab("worship");
        handleSelectSong(target);
        setPendingWorshipSongSelection(null);
      }
    };

    checkAndApplyPendingSong();

    const handleSelectWorshipSongEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ songId?: string; songTitle?: string }>;
      const { songId, songTitle } = customEvent.detail || {};
      setWorshipSubTab("worship");

      const target =
        songs.find(
          (s) =>
            (songId && s.id === songId) ||
            (songTitle && s.title.trim().toLowerCase() === songTitle.trim().toLowerCase()),
        ) ??
        accessibleSongs.find(
          (s) =>
            (songId && s.id === songId) ||
            (songTitle && s.title.trim().toLowerCase() === songTitle.trim().toLowerCase()),
        );

      if (target) {
        handleSelectSong(target);
        setPendingWorshipSongSelection(null);
      }
    };

    const handleSelectNoteEvent = () => {
      setVisitedSubTabs((prev) => {
        const next = new Set(prev);
        next.add("notes");
        return next;
      });
      setWorshipSubTab("notes");
    };

    window.addEventListener(DOCK_SELECT_WORSHIP_SONG_EVENT, handleSelectWorshipSongEvent);
    window.addEventListener(DOCK_SELECT_NOTE_EVENT, handleSelectNoteEvent);
    return () => {
      window.removeEventListener(DOCK_SELECT_WORSHIP_SONG_EVENT, handleSelectWorshipSongEvent);
      window.removeEventListener(DOCK_SELECT_NOTE_EVENT, handleSelectNoteEvent);
    };
  }, [accessibleSongs, handleSelectSong, songs]);

  const selectedSongAutoAdvanceIndex = useMemo(
    () => (selectedSong ? 0 : -1),
    [selectedSong],
  );

  const handleAutoAdvanceSongSelection = useCallback((_index: number) => {
    // Auto-advance is scoped to the opened song. It must never select from
    // the worship song list.
  }, []);

  const handleAutoAdvanceStart = useCallback((startIndex: number) => {
    if (startIndex !== selectedSongAutoAdvanceIndex) return;
    const startSectionIndex = activeSectionIndex ?? visibleSectionIndexes[0] ?? null;
    if (startSectionIndex !== null) goLiveSection(startSectionIndex);
  }, [activeSectionIndex, goLiveSection, selectedSongAutoAdvanceIndex, visibleSectionIndexes]);

  const handleAutoAdvanceSongStep = useCallback(
    (currentSongIndex: number, nextItemIndex: number | null) => {
      if (!selectedSong || currentSongIndex !== selectedSongAutoAdvanceIndex) return;

      const currentSectionIndex = activeSectionIndex ?? visibleSectionIndexes[0] ?? null;
      const currentVisiblePosition = currentSectionIndex === null
        ? -1
        : visibleSectionIndexes.indexOf(currentSectionIndex);
      const nextSectionIndex = currentVisiblePosition >= 0
        ? visibleSectionIndexes[currentVisiblePosition + 1]
        : undefined;

      if (nextSectionIndex !== undefined) {
        goLiveSection(nextSectionIndex);
        return { handled: true, nextIndex: currentSongIndex };
      }

      // A loop stays inside this song and returns to its first visible slide.
      // A null candidate means stop-at-end, so the control finishes the run.
      if (nextItemIndex === currentSongIndex) {
        const firstSectionIndex = visibleSectionIndexes[0];
        if (firstSectionIndex !== undefined) goLiveSection(firstSectionIndex);
        return { handled: true, nextIndex: currentSongIndex };
      }

      return;
    },
    [
      activeSectionIndex,
      goLiveSection,
      selectedSong,
      selectedSongAutoAdvanceIndex,
      visibleSectionIndexes,
    ],
  );

  const applyRecentWorshipSearch = useCallback(
    (recentLabel: string) => {
      const title = recentLabel.replace(/^song:\s*/i, "").trim();
      setShowRecentSearches(false);
      if (!title) return;

      const exactSong = accessibleSongs.find((song) => song.title.toLowerCase() === title.toLowerCase());
      if (exactSong) {
        setSearchQuery("");
        handleSelectSong(exactSong);
        return;
      }

      setSearchQuery(title);
    },
    [handleSelectSong, accessibleSongs],
  );

  const handleBackToSongList = useCallback(() => {
    setShowCompactSummaryActions(false);
    setLineLayoutOverrideSongId(null);
    setLineLayoutOverrideAutoSplit(null);
    setSelectedSong(null);
    setSelectedIdx(null);
    setVisibleIdx(null);
    setDeletedSections([]);
    setShowDeletedSectionsPopover(false);
    setLyricsSearchQuery("");
    setActionError("");
  }, []);

  const handleDeleteSong = useCallback(async () => {
    if (!songDeleteTarget || deletingSong) return;

    const songId = songDeleteTarget.id;
    const songTitle = songDeleteTarget.title;
    setDeletingSong(true);
    try {
      await archiveSong(songId);
      setSongs((current) => {
        const next = current.filter((song) => song.id !== songId);
        rawSongsRef.current = next;
        cacheSongsLocally(next);
        return next;
      });
      if (selectedSong?.id === songId) handleBackToSongList();
      setSongDeleteTarget(null);
      showToast(t("worship.songArchived", "Song removed from the active worship library."), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[DockWorshipTab] archive song failed:", err);
      showToast(message || `Could not remove “${songTitle}”.`, "error");
    } finally {
      setDeletingSong(false);
    }
  }, [deletingSong, handleBackToSongList, selectedSong?.id, showToast, songDeleteTarget, t]);

  useEffect(() => {
    setDeletedSections([]);
    setShowDeletedSectionsPopover(false);
    worshipTranslationChangeRef.current = false;
    setWorshipTranslation((current) => (
      current?.sourceSignature === worshipTranslationSourceSignature ? current : null
    ));
  }, [selectedSong?.id, worshipTranslationSourceSignature]);

  const handleSectionClick = useCallback(
    (idx: number) => {
      void goLiveSection(idx);
    },
    [goLiveSection],
  );

  const openSlideEditor = useCallback(
    (idx: number) => {
      const section = selectedSongSections[idx];
      if (!section) return;
      setSlideEditor({
        index: idx,
        label: section.label.trim() || t('worship.slideNumber', { number: idx + 1 }),
        text: stripLeadingVerseMarker(section.text),
        linesPerSlide: effectiveLinesPerSlide,
      });
    },
    [effectiveLinesPerSlide, selectedSongSections, t],
  );

  const handleSaveSlideEditor = useCallback(async (payload: { text: string; linesPerSlide: number }) => {
    if (!selectedSong || !slideEditor) return;
    const nextLinesPerSlide = clampLinesPerSlide(payload.linesPerSlide);
    const cleanText = stripLeadingVerseMarker(payload.text.trim());
    const nextSections = selectedSongSections.map((section, index) =>
      index === slideEditor.index ? { ...section, text: cleanText } : section,
    );
    const nextLyrics = serializeLyricSections(nextSections, selectedSongTitleMarker);

    if (!nextLyrics.trim()) return;

    setSavingSong(true);
    setActionError("");
    try {
      const maintainedAutoSplit = selectedSong.autoSplit ?? false;
      const updatedSong = await persistSong(selectedSong.id, {
        title: selectedSong.title,
        artist: selectedSong.artist,
        lyrics: nextLyrics,
        autoSplit: maintainedAutoSplit,
        linesPerSlide: nextLinesPerSlide,
      }, selectedSong);
      if (updatedSong) {
        setLineLayoutOverrideSongId(updatedSong.id);
        setLineLayoutOverrideAutoSplit(maintainedAutoSplit);
        setLinesPerSlideOverride(true);
        setLinesPerSlide(nextLinesPerSlide);
        setHiddenSectionIndexes(new Set());
        setVisibleIdx(null);
        setSelectedSong(updatedSong);
        setSelectedIdx(slideEditor.index);
      }
      showToast(t('worship.slideUpdated'), "success");
      closeSlideEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] save slide edit failed:", err);
        setActionError(message);
      }
    } finally {
      setSavingSong(false);
    }
  }, [closeSlideEditor, persistSong, selectedSong, selectedSongSections, selectedSongTitleMarker, showToast, slideEditor, t]);

  const handleDeleteSection = useCallback(async (idx: number) => {
    if (!selectedSong || savingSong || selectedSongSections.length <= 1) return;
    const deletedSection = selectedSongSections[idx];
    if (!deletedSection) return;

    const nextSections = selectedSongSections.filter((_, index) => index !== idx);
    const nextLyrics = serializeLyricSections(nextSections, selectedSongTitleMarker);
    if (!nextLyrics.trim()) return;

    setSavingSong(true);
    setActionError("");
    try {
      const updatedSong = await persistSong(
        selectedSong.id,
        {
          title: selectedSong.title,
          artist: selectedSong.artist,
          lyrics: nextLyrics,
        },
        selectedSong,
      );

      if (updatedSong) {
        const nextIndex = nextSections.length > 0 ? Math.min(idx, nextSections.length - 1) : null;
        setSelectedSong(updatedSong);
        setSelectedIdx((current) => {
          if (nextIndex === null) return null;
          if (current === null) return nextIndex;
          if (current === idx) return nextIndex;
          return current > idx ? current - 1 : current;
        });
        setVisibleIdx((current) => {
          if (current === null) return null;
          if (current === idx) return null;
          return current > idx ? current - 1 : current;
        });
      }

      const deletedLabel =
        deletedSection.label.trim()
        || t("worship.slideNumber", { number: idx + 1 });
      setDeletedSections((current) => [
        {
          id: `${deletedSection.id}-${Date.now()}`,
          label: deletedLabel,
          text: deletedSection.text,
          index: idx,
          deletedAt: Date.now(),
        },
        ...current,
      ].slice(0, 12));
      setShowDeletedSectionsPopover(true);
      showToast(t("worship.slideDeleted"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] delete slide failed:", err);
        setActionError(message);
      }
    } finally {
      setSavingSong(false);
    }
  }, [
    persistSong,
    savingSong,
    selectedSong,
    selectedSongSections,
    selectedSongTitleMarker,
    showToast,
    t,
  ]);

  const handleRestoreDeletedSection = useCallback(async (item: DeletedWorshipSection) => {
    if (!selectedSong || savingSong) return;
    const insertIndex = Math.max(0, Math.min(item.index, selectedSongSections.length));
    const nextSections = [...selectedSongSections];
    nextSections.splice(insertIndex, 0, {
      id: item.id,
      label: item.label,
      text: item.text,
    });
    const nextLyrics = serializeLyricSections(nextSections, selectedSongTitleMarker);
    if (!nextLyrics.trim()) return;

    setSavingSong(true);
    setActionError("");
    try {
      const updatedSong = await persistSong(
        selectedSong.id,
        {
          title: selectedSong.title,
          artist: selectedSong.artist,
          lyrics: nextLyrics,
        },
        selectedSong,
      );

      if (updatedSong) {
        setSelectedSong(updatedSong);
        setSelectedIdx(insertIndex);
        setVisibleIdx((current) => (current === null ? null : current >= insertIndex ? current + 1 : current));
      }

      setDeletedSections((current) => current.filter((entry) => entry.id !== item.id));
      setShowDeletedSectionsPopover((current) => current && deletedSections.length > 1);
      showToast(t("worship.slideRestored"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] restore slide failed:", err);
        setActionError(message);
      }
    } finally {
      setSavingSong(false);
    }
  }, [
    deletedSections.length,
    persistSong,
    savingSong,
    selectedSong,
    selectedSongSections,
    selectedSongTitleMarker,
    showToast,
    t,
  ]);

  const handleReorderWorshipSection = useCallback(
    async (sourceIdx: number, targetIdx: number) => {
      if (!selectedSong || savingSong || sourceIdx === targetIdx || sourceIdx < 0 || targetIdx < 0) return;
      if (sourceIdx >= selectedSongSections.length || targetIdx >= selectedSongSections.length) return;

      const nextSections = reorderWorshipSections(selectedSongSections, sourceIdx, targetIdx);
      const nextLyrics = serializeLyricSections(nextSections, selectedSongTitleMarker);
      if (!nextLyrics.trim()) return;

      setSavingSong(true);
      setActionError("");
      try {
        const maintainedAutoSplit = selectedSong.autoSplit ?? false;
        const updatedSong = await persistSong(
          selectedSong.id,
          {
            title: selectedSong.title,
            artist: selectedSong.artist,
            lyrics: nextLyrics,
            autoSplit: maintainedAutoSplit,
            linesPerSlide: effectiveLinesPerSlide,
          },
          selectedSong,
        );

        if (updatedSong) {
          setSelectedSong(updatedSong);
          setSelectedIdx((current) => {
            if (current === null) return targetIdx;
            if (current === sourceIdx) return targetIdx;
            if (sourceIdx < targetIdx) {
              if (current > sourceIdx && current <= targetIdx) return current - 1;
            } else {
              if (current >= targetIdx && current < sourceIdx) return current + 1;
            }
            return current;
          });
          setVisibleIdx((current) => {
            if (current === null) return null;
            if (current === sourceIdx) return targetIdx;
            if (sourceIdx < targetIdx) {
              if (current > sourceIdx && current <= targetIdx) return current - 1;
            } else {
              if (current >= targetIdx && current < sourceIdx) return current + 1;
            }
            return current;
          });
          showToast(t("worship.slideReordered", "Slide reordered"), "info");
        }
      } catch (err) {
        console.warn("[DockWorshipTab] reorder slide failed:", err);
      } finally {
        setSavingSong(false);
      }
    },
    [
      effectiveLinesPerSlide,
      persistSong,
      savingSong,
      selectedSong,
      selectedSongSections,
      selectedSongTitleMarker,
      showToast,
      t,
    ],
  );

  // Auto-clamp linesPerSlide when selected song has fewer lines than the current setting
  useEffect(() => {
    if (!selectedSong || totalLyricLines === 0) return;
    if (linesPerSlide > totalLyricLines) {
      setLinesPerSlide(clampLinesPerSlide(totalLyricLines));
    }
  }, [selectedSong, totalLyricLines, linesPerSlide]);

  const handleImportOnlineResult = useCallback(
    (result: OnlineLyricsSearchResult) => {
      setOnlineSearchOpen(false);
      setOnlineSearchError("");
      setOnlineResults([]);
      setOnlineSearchQuery("");
      setOnlineSearchSubmittedQuery("");
      setNewSongDraft((current) => ({
        ...current,
        title: result.title,
        artist: result.artist,
        lyrics: result.lyrics,
      }));
      setNewSongSource({
        importSourceName: result.sourceName,
        importSourceType: "online",
        importSourceUrl: result.url,
      });
      setIsNewSongModalOpen(true);
    },
    [],
  );

  const handleOnlineSearch = useCallback(() => {
    setOnlineResults([]);
    setOnlineSearchError("");
    setOnlineSearchSubmittedQuery(onlineSearchQuery.trim());
  }, [onlineSearchQuery]);

  useEffect(() => {
    if (!onlineSearchOpen) return;

    const query = onlineSearchSubmittedQuery.trim();
    if (query.length < 3) {
      setOnlineResults([]);
      setOnlineSearchError("");
      setOnlineSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setOnlineSearchLoading(true);
      setOnlineSearchError("");
      searchOnlineSongLyrics(query)
        .then((results) => {
          if (cancelled) return;
          setOnlineResults(results);
          if (results.length === 0) setOnlineSearchError(t('worship.noLyrics'));
        })
        .catch((err) => {
          if (cancelled) return;
          setOnlineSearchError(formatOnlineLyricsSearchError(err));
          setOnlineResults([]);
        })
        .finally(() => {
          if (!cancelled) setOnlineSearchLoading(false);
        });
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onlineSearchOpen, onlineSearchSubmittedQuery]);

  const navigateSection = useCallback(
    async (delta: 1 | -1) => {
      if (!selectedSong || visibleSectionIndexes.length === 0) return;
      const currentIdx = activeSectionIndex ?? 0;
      const currentVisibleIndex = visibleSectionIndexes.indexOf(currentIdx);
      const currentPosition = currentVisibleIndex >= 0 ? currentVisibleIndex : 0;
      const nextPosition = Math.max(0, Math.min(visibleSectionIndexes.length - 1, currentPosition + delta));
      const nextIdx = visibleSectionIndexes[nextPosition] ?? currentIdx;
      if (nextIdx === currentIdx) return;
      if (dockObsClient.isConnected) {
        await goLiveSection(nextIdx);
        return;
      }
      await pushSection(nextIdx);
    },
    [activeSectionIndex, goLiveSection, pushSection, selectedSong, visibleSectionIndexes],
  );

  const handleShowCurrent = useCallback(async () => {
    if (activeSectionIndex === null) return;
    await pushSection(activeSectionIndex);
  }, [activeSectionIndex, pushSection]);

  const handleClearLyrics = useCallback(async () => {
    visibilityEpochRef.current += 1;
    setActionError("");
    setVisibleIdx(null);
    setSelectedIdx(null);
    onStage(null);
    setWorshipOverlayVisible(false);
    showToast(t('worship.clearOverlay'));

    if (presentationLinkMode) return;

    try {
      await ensureObsConnected();
      await clearWorshipFromConfiguredOutput();
    } catch (err) {
      console.warn("[DockWorshipTab] clear worship failed:", err);
    }
  }, [clearWorshipFromConfiguredOutput, onStage, presentationLinkMode, showToast, t]);

  const handleToggleWorshipVisibility = useCallback(async () => {
    if (visibilityActionInFlightRef.current) return;
    visibilityActionInFlightRef.current = true;
    setVisibilityActionPending(true);
    const visibilityEpoch = ++visibilityEpochRef.current;
    setActionError("");
    try {
      if (presentationLinkMode) {
        if (worshipOverlayVisible) {
          onStage(null);
          setWorshipOverlayVisible(false);
        } else if (activeSectionIndex !== null) {
          await goLiveSection(activeSectionIndex);
        }
        return;
      }

      await ensureObsConnected();

      if (worshipOverlayVisible) {
        // Invalidate an older lyric push before the hide batch starts.
        setWorshipOverlayVisible(false);
        // Play the overlay's exit animation before the source is hidden.
        await dockObsClient.animateOutPresentationOverlay("worship", {
          mode: fullscreenOnlyMode ? "fullscreen" : overlayMode,
          includePresentation: !hasSceneRoute || sceneRoute.syncPresentation,
          targets: hasSceneRoute ? sceneRoute.targets : [],
        }).catch(() => { });
        await clearWorshipFromConfiguredOutput();
        return;
      }

      if (activeSectionIndex !== null) {
        await goLiveSection(activeSectionIndex);
      } else {
        if (!hasSceneRoute) {
          await dockObsClient.bringWorshipOverlayForward(fullscreenOnlyMode ? "fullscreen" : overlayMode);
        }
        if (visibilityEpoch === visibilityEpochRef.current) setWorshipOverlayVisible(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockWorshipTab] toggle worship visibility failed:", err);
        setActionError(message);
      }
    } finally {
      visibilityActionInFlightRef.current = false;
      setVisibilityActionPending(false);
    }
  }, [activeSectionIndex, clearWorshipFromConfiguredOutput, fullscreenOnlyMode, goLiveSection, hasSceneRoute, onStage, overlayMode, presentationLinkMode, sceneRoute.syncPresentation, sceneRoute.targets, worshipOverlayVisible]);

  const handleConfirmWorshipRoute = useCallback(() => {
    if (!pendingWorshipRouteConfirm) return;
    worshipSceneRouteConfirmedRef.current = true;
    const { idx, options } = pendingWorshipRouteConfirm;
    setPendingWorshipRouteConfirm(null);
    void goLiveSection(idx, { ...options, bypassSceneRoute: false });
  }, [goLiveSection, pendingWorshipRouteConfirm]);

  const handleSendWorshipToMceAlone = useCallback(async () => {
    if (!pendingWorshipRouteConfirm) return;
    const { idx, options } = pendingWorshipRouteConfirm;
    setPendingWorshipRouteConfirm(null);
    updateSceneRoute({ enabled: false });
    if (sceneRoute.targets.length > 0) {
      await Promise.allSettled(sceneRoute.targets.map((t) => (
        dockObsClient.clearSceneRouteSource("worship", t.sceneName)
      )));
    }
    void goLiveSection(idx, { ...options, bypassSceneRoute: true });
  }, [goLiveSection, pendingWorshipRouteConfirm, sceneRoute.targets, updateSceneRoute]);

  const handleCancelWorshipRouteConfirm = useCallback(() => {
    setPendingWorshipRouteConfirm(null);
  }, []);

  const handleTogglePresentationMeta = useCallback(async () => {
    const nextShowMeta = !showPresentationMeta;
    setShowPresentationMeta(nextShowMeta);
    if (!presentationLinkMode || activeSectionIndex === null) return;
    await goLiveSection(activeSectionIndex, { showPresentationMeta: nextShowMeta });
  }, [activeSectionIndex, goLiveSection, presentationLinkMode, showPresentationMeta]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive || !isDockTabVisible(tabRootRef.current)) return;
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (documentImportOpen) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Escape") {
        if (showBrowserMenu) {
          event.preventDefault();
          setShowBrowserMenu(false);
          return;
        }
        if (songEditor || slideEditor || isNewSongModalOpen || onlineSearchOpen || showCompactSummaryActions) {
          event.preventDefault();
          closeSongEditor();
          closeSlideEditor();
          closeNewSongModal();
          setOnlineSearchOpen(false);
          setShowCompactSummaryActions(false);
          return;
        }
        if (targetElement?.closest(".dtb-modal, .dock-dialog")) return;
        event.preventDefault();
        handleClearLyrics();
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedSong || visibleSectionIndexes.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        void navigateSection(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateSection(-1);
      } else if (event.key === "Enter" && activeSectionIndex !== null) {
        event.preventDefault();
        void handleShowCurrent();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isActive,
    documentImportOpen,
    activeSectionIndex,
    closeNewSongModal,
    closeSlideEditor,
    closeSongEditor,
    handleClearLyrics,
    handleShowCurrent,
    isNewSongModalOpen,
    navigateSection,
    onlineSearchOpen,
    selectedSong,
    showCompactSummaryActions,
    slideEditor,
    songEditor,
    visibleSectionIndexes.length,
  ]);

  const renderSongSearchPanel = () => (
    <section className="dock-console-panel dock-console-panel--toolbar dock-worship-song-browser">
      {documentImportOpen && createPortal(
        <Suspense fallback={<LoadingScreen variant="dock" size="small" label="Opening document import…" />}>
          <DocumentSongImport onClose={() => setDocumentImportOpen(false)} onImported={() => { void loadSongs(); }}
            saveBatch={async (batch, options) => {
              const first = batch[0];
              if (!first) return;
              await saveSongInMainApp({ id: first.id, title: first.metadata.title, artist: first.metadata.artist, lyrics: first.lyrics, batch });
              options?.onProgress?.(batch.length, batch.length);
            }} />
        </Suspense>, document.body)}
      <div className="dock-console-header dock-worship-song-browser__header">
        <div className="dock-console-actions dock-console-actions--song-browser">
          {isConstrained ? (
            <div className="dock-worship-browser-overflow-wrap" ref={browserMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="dock-console-toggle dock-console-toggle--icon-only"
                onClick={() => setShowBrowserMenu((prev) => !prev)}
                title={t("common.moreActions", "More actions")}
                aria-label={t("common.moreActions", "More actions")}
                aria-expanded={showBrowserMenu}
                aria-haspopup="menu"
              >
                <Icon name="more_vert" size={14} />
              </button>
              {showBrowserMenu && (
                <div
                  className="dock-bible-actions__menu dock-worship-actions__menu"
                  role="menu"
                  style={{ top: "calc(100% + 4px)", right: 0, width: "190px", minWidth: "170px", zIndex: 250 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBrowserMenu(false);
                      openNewSongModal();
                    }}
                  >
                    <Icon name="add" size={16} />
                    <span>{t("worship.addSong", "Add new song")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBrowserMenu(false);
                      setOnlineSearchQuery(searchQuery.trim());
                      setOnlineSearchSubmittedQuery("");
                      setOnlineResults([]);
                      setOnlineSearchOpen(true);
                      setOnlineSearchError("");
                    }}
                  >
                    <Icon name="travel_explore" size={16} />
                    <span>{t("worship.searchOnline", "Search online")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBrowserMenu(false);
                      setDocumentImportOpen(true);
                    }}
                  >
                    <Icon name="upload_file" size={16} />
                    <span>{t("worship.importDocument", "Import document")}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button type="button" className="dock-console-toggle dock-console-toggle--icon-only"
                onClick={() => setDocumentImportOpen(true)} title="Import document" aria-label="Import document">
                <Icon name="upload_file" size={14} />
              </button>
              <button
                type="button"
                className="dock-console-toggle dock-console-toggle--icon-only"
                onClick={() => {
                  setOnlineSearchQuery(searchQuery.trim());
                  setOnlineSearchSubmittedQuery("");
                  setOnlineResults([]);
                  setOnlineSearchOpen(true);
                  setOnlineSearchError("");
                }}
                title={t('worship.searchOnline')}
                aria-label={t('worship.searchOnline')}
              >
                <Icon name="travel_explore" size={14} />
              </button>
              <button
                type="button"
                className="dock-console-toggle dock-console-toggle--primary dock-console-toggle--add"
                onClick={() => openNewSongModal()}
                title={t('worship.addSong')}
                aria-label={t('worship.addSong')}
              >
                <Icon name="add" size={14} />
                <span className="dock-console-toggle__label">{t('common.add')}</span>
              </button>
            </>
          )}
        </div>
      </div>
      <div className="dock-search dock-search--console dock-search--plain" style={{ marginBottom: 0 }} ref={searchRef}>
        <input
          className="dock-input"
          placeholder={t('worship.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => {
            const next = event.target.value;
            setSearchQuery(next);
            setShowRecentSearches(next.trim().length === 0 && recentSearches.length > 0);
          }}
          onFocus={() => {
            if (!searchQuery.trim() && recentSearches.length > 0) {
              setShowRecentSearches(true);
            }
          }}
          aria-label={t('worship.searchSongs')}
        />
        {searchQuery && (
          <button
            type="button"
            className="dock-search__clear"
            onClick={() => {
              setSearchQuery("");
              setShowRecentSearches(recentSearches.length > 0);
            }}
            aria-label={t('common.clear')}
            title={t('common.clear')}
          >
            <Icon name="close" size={13} />
          </button>
        )}
        {showRecentSearches && !searchQuery.trim() && recentSearches.length > 0 && (
          <div className="dock-search-dropdown dock-search-dropdown--recent">
            <div className="dock-search-dropdown__heading">{t('worship.recentSearches')}</div>
            {recentSearches.map((item) => (
              <button
                type="button"
                key={item}
                className="dock-search-dropdown__item dock-search-dropdown__item--recent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyRecentWorshipSearch(item)}
                title={t('common.search')}
              >
                <span className="dock-search-dropdown__content">
                  <span className="dock-search-dropdown__label">{item}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const renderLyricsSearchPanel = () => (
    <section className="dock-console-panel dock-console-panel--toolbar dock-worship-lyrics-search">
      <div className="dock-media-search dock-media-search--plain">
        <input
          className="dock-media-search__input"
          placeholder={t('worship.lyricsSearchPlaceholder')}
          value={lyricsSearchQuery}
          onChange={(event) => setLyricsSearchQuery(event.target.value)}
          aria-label={t('worship.lyricsSearchPlaceholder')}
        />
        {lyricsSearchQuery && (
          <button
            type="button"
            className="dock-media-search__clear"
            onClick={() => setLyricsSearchQuery("")}
            aria-label={t('common.clear')}
            title={t('common.close')}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
    </section>
  );

  return (
    <div ref={tabRootRef} className="dock-module dock-module--worship">
      <div className="dock-worship-content-layout">
      {showSubtabs && <nav className={`dock-worship-subtab-bar${compactVerticalNav ? " dock-vertical-nav" : ""}`} aria-label={t("worship.andNotesTitle", "Worship and Notes")}>
        <button
          type="button"
          role="tab"
          aria-selected={worshipSubTab === "worship"}
          className={`dock-worship-subtab${compactVerticalNav ? " dock-vertical-nav__item" : ""}${worshipSubTab === "worship" ? " dock-worship-subtab--active" : ""}${compactVerticalNav && worshipSubTab === "worship" ? " dock-vertical-nav__item--active" : ""}`}
          onClick={() => setWorshipSubTab("worship")}
          aria-label={t("worship.title")}
          title={t("worship.title")}
          data-label={t("worship.title")}
        >
          <Icon name="music_note" size={13} />
          {t("worship.title")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={worshipSubTab === "notes"}
          className={`dock-worship-subtab${compactVerticalNav ? " dock-vertical-nav__item" : ""}${worshipSubTab === "notes" ? " dock-worship-subtab--active" : ""}${compactVerticalNav && worshipSubTab === "notes" ? " dock-vertical-nav__item--active" : ""}`}
          onClick={() => setWorshipSubTab("notes")}
          aria-label={t("notes.userTitle", "User's Notes")}
          title={t("notes.userTitle", "User's Notes")}
          data-label={t("notes.userTitle", "User's Notes")}
        >
          <Icon name="edit_note" size={13} />
          {t("notes.userTitle", "User's Notes")}
        </button>
      </nav>}

      <div className="dock-worship-content-layout__body">
        <div
          className="dock-worship-subtab-pane dock-worship-subtab-pane--worship"
          hidden={worshipSubTab !== "worship"}
          style={{
            display: worshipSubTab === "worship" ? "flex" : "none",
            flex: "1 1 auto",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Song Browser (when no song selected) */}
      {!selectedSong ? (
            <>
              {searchPlacement !== "bottom" && renderSongSearchPanel()}

              <section className="dock-console-panel dock-console-panel--workspace dock-worship-workspace" data-toolbar-collapsed={toolbarCollapsed || undefined}>
                {filteredSongs.length === 0 ? (
                  <div className="dock-empty dock-worship-workspace__empty">
                    <Icon name={songs.length === 0 ? "music_off" : "search_off"} size={20} />
                    <div className="dock-empty__title">
                      {songs.length === 0 ? t('worship.noSongs') : t('worship.noSongsMatch')}
                    </div>
                    <div className="dock-empty__text">
                      {songs.length === 0
                        ? t('worship.loadSongsHint')
                        : t('worship.noSongsMatchQuery', { query: searchQuery })}
                    </div>
                  </div>
                ) : (
                  <div
                    className="dock-console-list dock-worship-workspace__list"
                    onScroll={handleSongListScroll}
                  >
                    {renderedSongs.map((song) => {
                      const isLocked = lockedSongIds.has(song.id);
                      const lyricsPreview = getSongCardLyricsPreview(song.lyrics);
                      return (
                        <div
                          key={song.id}
                          className={`dock-card dock-card--console dock-song-card${isLocked ? " dock-song-card--locked" : ""}`}
                          onContextMenu={(event) => {
                            if (isLocked) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setSongContextMenu({
                              x: Math.min(event.clientX, window.innerWidth - 220),
                              y: Math.min(event.clientY, window.innerHeight - 340),
                              song,
                            });
                          }}
                        >
                          <button
                            type="button"
                            className="dock-song-card__main"
                            onClick={() => {
                              if (isLocked) {
                                void requireEntitlement("songs", songs.length);
                                return;
                              }
                              handleSelectSong(song);
                            }}
                            title={isLocked ? t('common.locked') : song.title}>
                            <span className="dock-card__title">{song.hymnNumber && !song.title.split(/\s+/).includes(song.hymnNumber) ? `${song.hymnNumber}. ` : ""}{song.title}</span>
                            {song.artist.trim() ? (
                              <span className="dock-card__subtitle">
                                {song.artist.trim()}
                              </span>
                            ) : null}
                            <span className="dock-song-card__lyrics-preview" aria-label={t('worship.songLyrics')}>
                              {lyricsPreview.lines.length > 0 ? (
                                <>
                                  {lyricsPreview.lines.map((line, index) => (
                                    <span className="dock-song-card__lyrics-line" key={`${song.id}-preview-${index}`}>
                                      {line}
                                    </span>
                                  ))}
                                  {lyricsPreview.hasMore && (
                                    <span className="dock-song-card__lyrics-more" aria-hidden="true">…</span>
                                  )}
                                </>
                              ) : (
                                <span className="dock-song-card__lyrics-empty">{t('worship.noLyrics')}</span>
                              )}
                            </span>
                            {isLocked && (
                              <span className="dock-song-card__lock-badge">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                                {t('worship.upgrade')}
                              </span>
                            )}
                          </button>
                          {!isLocked && (
                            <>
                              <button
                                type="button"
                                className="dock-song-card__schedule"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAddSongToSchedule(song);
                                }}
                                aria-label={`${t('schedule.addToSchedule', 'Add to Schedule')} ${song.title}`}
                                title={t('schedule.addToSchedule', 'Add to Schedule')}
                              >
                                <Icon name="playlist_add" size={16} />
                              </button>
                              <button
                                type="button"
                                className="dock-song-card__edit"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSongEditor(song);
                                }}
                                aria-label={`${t('common.edit')} ${song.title}`}
                                title={t('worship.editSong')}
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              <button
                                type="button"
                                className="dock-song-card__delete"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSongDeleteTarget(song);
                                }}
                                aria-label={`${t('common.delete')} ${song.title}`}
                                title={t('common.delete')}
                                disabled={deletingSong}
                              >
                                <Icon name="delete_outline" size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {visibleSongCount < filteredSongs.length && (
                      <div className="dock-worship-load-more" style={{ padding: "8px", textAlign: "center" }}>
                        <button
                          type="button"
                          className="dock-btn dock-btn--ghost dock-btn--compact"
                          onClick={() => setVisibleSongCount((prev) => Math.min(prev + 40, filteredSongs.length))}
                        >
                          {t("common.loadMore", { defaultValue: "Load more..." })} ({filteredSongs.length - visibleSongCount} remaining)
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {songContextMenu && (
                  <div
                    className="dock-bible-context-menu"
                    style={{
                      position: "fixed",
                      top: `${songContextMenu.y}px`,
                      left: `${songContextMenu.x}px`,
                      zIndex: 10000,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        handleAddSongToSchedule(songContextMenu.song);
                        setSongContextMenu(null);
                      }}
                    >
                      <Icon name="playlist_add" size={16} />
                      <span>{t("schedule.addToSchedule", "Add to Schedule")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        handleSelectSong(songContextMenu.song);
                        setSongContextMenu(null);
                      }}
                    >
                      <Icon name="queue_music" size={16} />
                      <span>{t("worship.openSong", "Open Song")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        openSongEditor(songContextMenu.song);
                        setSongContextMenu(null);
                      }}
                    >
                      <Icon name="edit" size={16} />
                      <span>{t("common.edit", "Edit Song")}</span>
                    </button>
                    <div className="dock-bible-context-menu__divider" />
                    <div className="dock-bible-context-menu__section">
                      <div className="dock-bible-context-menu__section-header">
                        <Icon name="format_align_left" size={13} />
                        <span>{t("worship.linesPerStage", "Lines per stage")}</span>
                      </div>
                      <div className="dock-bible-context-menu__lines-grid">
                        {[1, 2, 3, 4].map((count) => {
                          const songAutoSplit = songContextMenu.song.autoSplit ?? false;
                          const songLineCount = songContextMenu.song.linesPerSlide ?? DEFAULT_LINES_PER_SLIDE;
                          const isActive = songAutoSplit && songLineCount === count;
                          return (
                            <button
                              key={count}
                              type="button"
                              className={`dock-bible-context-menu__line-btn${isActive ? " dock-bible-context-menu__line-btn--active" : ""}`}
                              onClick={() => {
                                handleSelectSong(songContextMenu.song);
                                handleWorshipQuickCommit({}, count, "count", songContextMenu.song.id);
                                setSongContextMenu(null);
                              }}
                            >
                              {isActive && <span className="dock-bible-context-menu__line-check">✓</span>}
                              <span>{count === 1 ? t("bible.oneLine", "1 Line") : t("bible.xLines", `${count} Lines`, { count })}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className={`dock-bible-context-menu__line-btn${!(songContextMenu.song.autoSplit ?? false) ? " dock-bible-context-menu__line-btn--active" : ""}`}
                        style={{ marginTop: "2px" }}
                        onClick={() => {
                          handleSelectSong(songContextMenu.song);
                          const currentLines = songContextMenu.song.linesPerSlide ?? DEFAULT_LINES_PER_SLIDE;
                          handleWorshipQuickCommit({}, currentLines, "original", songContextMenu.song.id);
                          setSongContextMenu(null);
                        }}
                      >
                        {!(songContextMenu.song.autoSplit ?? false) && (
                          <span className="dock-bible-context-menu__line-check">✓</span>
                        )}
                        <span>{t("worship.originalStanzas", "Original Stanzas")}</span>
                      </button>
                    </div>
                    <div className="dock-bible-context-menu__divider" />
                    <button
                      type="button"
                      className="dock-bible-context-menu__item dock-bible-context-menu__item--danger"
                      style={{ color: "#FCA5A5" }}
                      onClick={() => {
                        setSongDeleteTarget(songContextMenu.song);
                        setSongContextMenu(null);
                      }}
                    >
                      <Icon name="delete_outline" size={16} />
                      <span>{t("common.delete", "Delete Song")}</span>
                    </button>
                  </div>
                )}
              </section>
              {searchPlacement !== "top" && (
                <DockBottomSearchPanel
                  expanded={bottomSearchExpanded}
                  onToggle={() => setBottomSearchExpanded((current) => !current)}
                >
                  {renderSongSearchPanel()}
                </DockBottomSearchPanel>
              )}
            </>
          ) : (
            <>
              {/* Song Summary Header */}
              <section className="dock-console-panel dock-console-panel--toolbar dock-worship-summary">
                <div className="dock-worship-summary__header">
                  <button
                    type="button"
                    className="dock-worship-back-btn"
                    onClick={handleBackToSongList}
                    title={t('common.back')}
                  >
                    <Icon name="arrow_back" size={14} />
                  </button>
                  <div className="dock-worship-summary__copy">
                    <div className="dock-worship-summary__title">{selectedSongDisplayTitle}</div>
                    {selectedSong.artist && (
                      <div className="dock-worship-summary__artist">{selectedSong.artist}</div>
                    )}
                    <div className="dock-worship-summary__meta">
                      <span>{t('worship.slideCount', { count: selectedSongSections.length })}</span>
                      <span className="dock-worship-summary__meta-dot">·</span>
                      <span>{effectiveAutoSplit
                        ? `${effectiveLinesPerSlide} ${effectiveLinesPerSlide === 1 ? t('worship.linePerSlide') : t('worship.linesPerSlide')}`
                        : t('worship.original', 'Original')}</span>
                    </div>
                  </div>
                  {searchPlacement !== "bottom" && <div className="dock-worship-summary__compact-search">
                    <div className="dock-media-search dock-media-search--plain">
                      <input
                        className="dock-media-search__input"
                        placeholder={t('worship.lyricsSearchPlaceholder')}
                        value={lyricsSearchQuery}
                        onChange={(e) => setLyricsSearchQuery(e.target.value)}
                        aria-label={t('worship.lyricsSearchPlaceholder')}
                      />
                      {lyricsSearchQuery && (
                        <button
                          type="button"
                          className="dock-media-search__clear"
                          onClick={() => setLyricsSearchQuery("")}
                          aria-label={t('common.clear')}
                          title={t('common.close')}
                        >
                          <Icon name="close" size={13} />
                        </button>
                      )}
                    </div>
                  </div>}
                  <div className="dock-worship-summary__actions">
                    <button
                      type="button"
                      className="dock-shell-icon-btn"
                      onClick={() => openSongEditor(selectedSong)}
                      title={t('worship.editSong')}
                      aria-label={t('worship.editSong')}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <div className="dock-worship-summary__overflow-wrap" ref={compactSummaryActionsRef}>
                      <button
                        type="button"
                        className="dock-worship-summary__overflow-trigger"
                        onClick={() => setShowCompactSummaryActions((open) => !open)}
                        aria-label={t('common.moreActions', 'More actions')}
                        title={t('common.moreActions', 'More actions')}
                        aria-haspopup="menu"
                        aria-expanded={showCompactSummaryActions}
                      >
                        <Icon name="more_vert" size={14} />
                      </button>
                      {showCompactSummaryActions && (
                        <div
                          className="dock-worship-summary__overflow-menu"
                          role="menu"
                          aria-label={t('common.moreActions', 'More actions')}
                        >
                          <button
                            type="button"
                            className="dock-worship-summary__menu-btn"
                            role="menuitem"
                            onClick={() => {
                              setShowTranslationModal(true);
                              setShowCompactSummaryActions(false);
                            }}
                          >
                            <div className="dock-worship-summary__menu-btn-content">
                              <Icon name="translate" size={16} />
                              <span>{t('common.translate', 'Translate')}</span>
                            </div>
                            {effectiveWorshipTranslation && (
                              <span className="dock-worship-summary__menu-btn-badge">
                                {effectiveWorshipTranslation.targetLanguageLabel}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="dock-worship-summary__menu-btn"
                            role="menuitem"
                            onClick={() => {
                              setShowAutoAdvanceModal(true);
                              setShowCompactSummaryActions(false);
                            }}
                          >
                            <div className="dock-worship-summary__menu-btn-content">
                              <Icon name="fast_forward" size={16} />
                              <span>{t('autoAdvance.title', 'Set Auto Advance')}</span>
                            </div>
                            {autoAdvanceActive && (
                              <span className="dock-worship-summary__menu-btn-dot" title={t('autoAdvance.running', 'Running')} />
                            )}
                          </button>
                        </div>
                      )}
                      <DockTranslationControls
                        compact
                        compactLabel
                        showTrigger={false}
                        isOpen={showTranslationModal}
                        onOpenChange={setShowTranslationModal}
                        sections={selectedSongSections.map((section) => ({ id: section.id, text: section.text }))}
                        value={effectiveWorshipTranslation}
                        onChange={(next) => {
                          worshipTranslationChangeRef.current = true;
                          setWorshipTranslation(next);
                        }}
                        onClose={handleCompactSummaryChildClose}
                      />
                      <DockAutoAdvanceControl
                        items={[{ id: selectedSong.id, label: selectedSongDisplayTitle }]}
                        selectedIndex={selectedSongAutoAdvanceIndex}
                        onSelectIndex={handleAutoAdvanceSongSelection}
                        onClose={handleCompactSummaryChildClose}
                        onAdvance={handleAutoAdvanceSongStep}
                        onStart={handleAutoAdvanceStart}
                        onActiveChange={setAutoAdvanceActive}
                        itemKind="song"
                        storageScope="worship"
                        compactLabel
                        showTrigger={false}
                        isOpen={showAutoAdvanceModal}
                        onOpenChange={setShowAutoAdvanceModal}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Lyrics Search */}
              {searchPlacement !== "bottom" && renderLyricsSearchPanel()}

              {/* Cue List */}
              <section className="dock-console-panel dock-console-panel--workspace dock-worship-workspace" data-toolbar-collapsed={toolbarCollapsed || undefined}>


                {selectedSongSections.length === 0 || visibleSectionIndexes.length === 0 ? (
                  <div className="dock-empty dock-worship-workspace__empty">
                    <Icon name="lyrics" size={18} />
                    <div className="dock-empty__text">
                      {selectedSongSections.length === 0
                        ? t('worship.noLyrics')
                        : t('worship.allSlidesHidden')}
                    </div>
                  </div>
                ) : lyricsFilteredSectionIndexes.length === 0 ? (
                  <div className="dock-empty dock-worship-workspace__empty">
                    <Icon name="search_off" size={18} />
                    <div className="dock-empty__text">
                      {t('worship.noSlidesMatch', { query: lyricsSearchQuery })}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`dock-console-list dock-worship-workspace__list dock-worship-slide-queue${draggingSectionIdx !== null ? " is-reordering" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const container = event.currentTarget;
                      const rect = container.getBoundingClientRect();
                      const offsetY = event.clientY - rect.top;
                      if (offsetY < 50) {
                        container.scrollTop -= 14;
                      } else if (rect.bottom - event.clientY < 50) {
                        container.scrollTop += 14;
                      }
                    }}
                    onDrop={(event) => {
                      const sourceIdx = draggingSectionIdx ?? Number(event.dataTransfer.getData("text/plain"));
                      if (Number.isFinite(sourceIdx) && sourceIdx >= 0) {
                        const container = event.currentTarget;
                        const rect = container.getBoundingClientRect();
                        const offsetY = event.clientY - rect.top;
                        const targetIdx = offsetY < rect.height / 2 ? 0 : selectedSongSections.length - 1;
                        void handleReorderWorshipSection(sourceIdx, targetIdx);
                      }
                      setDraggingSectionIdx(null);
                      setDragOverSectionIdx(null);
                      setDropPosition(null);
                    }}
                  >
                    {lyricsFilteredSectionIndexes.map((idx) => {
                      const section = selectedSongSections[idx];
                      if (!section) return null;
                      const displayLabel = section.label.trim();
                      const isVisible = visibleIdx === idx;
                      const isSelected = selectedIdx === idx;
                      const isDragging = draggingSectionIdx === idx;
                      const isDragOver = dragOverSectionIdx === idx && draggingSectionIdx !== idx;
                      return (
                        <div
                          key={section.id}
                          draggable={!savingSong}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSlideContextMenu({
                              x: Math.min(event.clientX, window.innerWidth - 220),
                              y: Math.min(event.clientY, window.innerHeight - 380),
                              sectionIdx: idx,
                            });
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", String(idx));
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingSectionIdx(idx);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const rect = event.currentTarget.getBoundingClientRect();
                            const midY = rect.top + rect.height / 2;
                            const position = event.clientY < midY ? "above" : "below";
                            if (dragOverSectionIdx !== idx || dropPosition !== position) {
                              setDragOverSectionIdx(idx);
                              setDropPosition(position);
                            }
                          }}
                          onDragLeave={(event) => {
                            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                            if (dragOverSectionIdx === idx) {
                              setDragOverSectionIdx(null);
                              setDropPosition(null);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const sourceIdx = draggingSectionIdx ?? Number(event.dataTransfer.getData("text/plain"));
                            if (Number.isFinite(sourceIdx) && sourceIdx >= 0) {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const pos = dropPosition || (event.clientY < rect.top + rect.height / 2 ? "above" : "below");
                              const targetIdx = calculateReorderTargetIndex(sourceIdx, idx, pos, selectedSongSections.length);
                              void handleReorderWorshipSection(sourceIdx, targetIdx);
                            }
                            setDraggingSectionIdx(null);
                            setDragOverSectionIdx(null);
                            setDropPosition(null);
                          }}
                          onDragEnd={() => {
                            setDraggingSectionIdx(null);
                            setDragOverSectionIdx(null);
                            setDropPosition(null);
                          }}
                          className={`dock-worship-slide-card${
                            isVisible ? " dock-worship-slide-card--visible" : ""
                          }${isSelected && !isVisible ? " dock-worship-slide-card--selected" : ""}${
                            isDragging ? " dock-worship-slide-card--dragging" : ""
                          }${
                            isDragOver
                              ? dropPosition === "above"
                                ? " dock-worship-slide-card--drop-above"
                                : " dock-worship-slide-card--drop-below"
                              : ""
                          }`}
                          title={presentationLinkMode ? t("worship.clickToShowPresentation") : t("worship.clickToViewObs")}
                        >
                          <button
                            type="button"
                            className="dock-worship-slide-card__main"
                            onClick={() => handleSectionClick(idx)}
                          >
                            <div className="dock-worship-slide-card__header">
                              <div className="dock-worship-slide-card__label">
                                <div
                                  className="dock-worship-slide-card__drag-handle"
                                  title={t("common.dragToReorder", "Drag to reorder slide")}
                                  aria-label={t("common.dragToReorder", "Drag to reorder slide")}
                                >
                                  <Icon name="drag_indicator" size={14} />
                                </div>
                                {displayLabel ? (
                                  <span className="dock-worship-slide-card__name">{displayLabel}</span>
                                ) : (
                                  <span className="dock-worship-slide-card__name dock-worship-slide-card__name--muted">
                                    {t('worship.slideNumber', { number: idx + 1 })}
                                  </span>
                                )}
                                <span className="dock-worship-slide-card__index">{idx + 1}</span>
                              </div>
                              <div className="dock-worship-slide-card__badges">

                              </div>
                            </div>
                            {getOrderedTranslationParts(
                              stripLeadingVerseMarker(normalizeWorshipDisplayText(section.text)),
                              getWorshipSectionTranslation(section.id, effectiveWorshipTranslation),
                              effectiveWorshipTranslation?.showBoth ?? false,
                              effectiveWorshipTranslation?.translationOrder,
                            ).map((part, partIndex) => (
                              <div
                                key={`${section.id}-${part.kind}-${partIndex}`}
                                className={part.kind === "translation"
                                  ? `dock-worship-slide-card__translation${partIndex === 0 ? " dock-worship-slide-card__translation--first" : ""}`
                                  : "dock-worship-slide-card__text"}
                              >
                                {stripLeadingVerseMarker(normalizeWorshipDisplayText(part.text))}
                              </div>
                            ))}
                          </button>
                          <div className="dock-worship-slide-card__actions">
                            <button
                              type="button"
                              className="dock-worship-slide-card__action"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleAddSlideToSchedule(idx);
                              }}
                              title={t("schedule.addToSchedule", "Add slide to Schedule")}
                              aria-label={t("schedule.addToSchedule", "Add slide to Schedule")}
                            >
                              <Icon name="playlist_add" size={14} />
                            </button>
                            <button
                              type="button"
                              className="dock-worship-slide-card__action"
                              onClick={(event) => {
                                event.stopPropagation();
                                openSlideEditor(idx);
                              }}
                              title={t('worship.quickEdit')}
                              aria-label={t('worship.quickEdit')}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              type="button"
                              className="dock-worship-slide-card__action dock-worship-slide-card__action--danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDeleteSection(idx);
                              }}
                              title={t("common.delete")}
                              disabled={savingSong || selectedSongSections.length <= 1}
                            >
                              <Icon name="delete_outline" size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {slideContextMenu && (
                  <div
                    className="dock-bible-context-menu"
                    style={{
                      position: "fixed",
                      top: `${slideContextMenu.y}px`,
                      left: `${slideContextMenu.x}px`,
                      zIndex: 1000,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        handleAddSlideToSchedule(slideContextMenu.sectionIdx);
                        setSlideContextMenu(null);
                      }}
                    >
                      <Icon name="playlist_add" size={16} />
                      <span>{t("schedule.addToSchedule", "Add slide to Schedule")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        void goLiveSection(slideContextMenu.sectionIdx);
                        setSlideContextMenu(null);
                      }}
                    >
                      <Icon name="play_arrow" size={16} />
                      <span>{t("common.present", "Present Live")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        openSlideEditor(slideContextMenu.sectionIdx);
                        setSlideContextMenu(null);
                      }}
                    >
                      <Icon name="edit" size={16} />
                      <span>{t("worship.quickEdit", "Edit Slide")}</span>
                    </button>
                    <div className="dock-bible-context-menu__divider" />
                    <div className="dock-bible-context-menu__section">
                      <div className="dock-bible-context-menu__section-header">
                        <Icon name="format_align_left" size={13} />
                        <span>{t("worship.linesPerStage", "Lines per stage")}</span>
                      </div>
                      <div className="dock-bible-context-menu__lines-grid">
                        {[1, 2, 3, 4].map((count) => {
                          const isActive = effectiveAutoSplit && effectiveLinesPerSlide === count;
                          return (
                            <button
                              key={count}
                              type="button"
                              className={`dock-bible-context-menu__line-btn${isActive ? " dock-bible-context-menu__line-btn--active" : ""}`}
                              onClick={() => {
                                handleWorshipQuickCommit({}, count, "count");
                                setSlideContextMenu(null);
                              }}
                            >
                              {isActive && <span className="dock-bible-context-menu__line-check">✓</span>}
                              <span>{count === 1 ? t("bible.oneLine", "1 Line") : t("bible.xLines", `${count} Lines`, { count })}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className={`dock-bible-context-menu__line-btn${!effectiveAutoSplit ? " dock-bible-context-menu__line-btn--active" : ""}`}
                        style={{ marginTop: "2px" }}
                        onClick={() => {
                          handleWorshipQuickCommit({}, effectiveLinesPerSlide, "original");
                          setSlideContextMenu(null);
                        }}
                      >
                        {!effectiveAutoSplit && <span className="dock-bible-context-menu__line-check">✓</span>}
                        <span>{t("worship.originalStanzas", "Original Stanzas")}</span>
                      </button>
                    </div>
                    <div className="dock-bible-context-menu__divider" />
                    {slideContextMenu.sectionIdx > 0 && (
                      <button
                        type="button"
                        className="dock-bible-context-menu__item"
                        onClick={() => {
                          void handleReorderWorshipSection(slideContextMenu.sectionIdx, 0);
                          setSlideContextMenu(null);
                        }}
                      >
                        <Icon name="vertical_align_top" size={16} />
                        <span>{t("common.moveToTop", "Move to Top")}</span>
                      </button>
                    )}
                    {slideContextMenu.sectionIdx > 0 && (
                      <button
                        type="button"
                        className="dock-bible-context-menu__item"
                        onClick={() => {
                          void handleReorderWorshipSection(slideContextMenu.sectionIdx, slideContextMenu.sectionIdx - 1);
                          setSlideContextMenu(null);
                        }}
                      >
                        <Icon name="arrow_upward" size={16} />
                        <span>{t("common.moveUp", "Move Up")}</span>
                      </button>
                    )}
                    {slideContextMenu.sectionIdx < selectedSongSections.length - 1 && (
                      <button
                        type="button"
                        className="dock-bible-context-menu__item"
                        onClick={() => {
                          void handleReorderWorshipSection(slideContextMenu.sectionIdx, slideContextMenu.sectionIdx + 1);
                          setSlideContextMenu(null);
                        }}
                      >
                        <Icon name="arrow_downward" size={16} />
                        <span>{t("common.moveDown", "Move Down")}</span>
                      </button>
                    )}
                    {slideContextMenu.sectionIdx < selectedSongSections.length - 1 && (
                      <button
                        type="button"
                        className="dock-bible-context-menu__item"
                        onClick={() => {
                          void handleReorderWorshipSection(slideContextMenu.sectionIdx, selectedSongSections.length - 1);
                          setSlideContextMenu(null);
                        }}
                      >
                        <Icon name="vertical_align_bottom" size={16} />
                        <span>{t("common.moveToBottom", "Move to Bottom")}</span>
                      </button>
                    )}
                  </div>
                )}
                <DockOutputQuickActions
                  textLabel={t("worship.songText")}
                  lineLabel={t("worship.linesPerSlide")}
                  settings={layerThemeQuickDisplay(
                    activeWorshipQuickSettings,
                    (isFullscreen ? baseFullscreenTheme : baseLowerThirdTheme)?.settings?.layout,
                    activeWorshipQuickSettings,
                  )}
                  lineCount={effectiveLinesPerSlide}
                  lineMode={effectiveAutoSplit ? "count" : "original"}
                  maxLineCount={MAX_LINES_PER_SLIDE}
                  minFontSize={fullscreenOnlyMode || overlayMode === "fullscreen" ? 16 : LOWER_THIRD_FIT_MIN_FONT_SIZE}
                  maxFontSize={fullscreenOnlyMode || overlayMode === "fullscreen" ? 200 : LOWER_THIRD_FONT_SIZE_MAX}
                  updateImmediately={quickUpdateImmediately}
                  isLive={worshipOverlayVisible}
                  top={quickActionsTop}
                  left={quickActionsLeft}
                  onPositionChange={handleWorshipQuickActionsPositionChange}
                  onCommit={handleWorshipQuickCommit}
                  originalLineLabel={t('worship.original', 'Original')}
                  sizePresets={activeWorshipSizePresets}
                  activeSizePreset={activeWorshipSizePreset}
                  getSizePresetPatch={getWorshipQuickSizePatch}
                  onOpenSettings={() => setShowThemeSettings(true)}
                  onUpdateImmediatelyChange={setQuickUpdateImmediately}
                  overlayMode={fullscreenOnlyMode ? undefined : overlayMode}
                  onOverlayModeChange={fullscreenOnlyMode ? undefined : handleOverlayModeChange}
                  onToggleOutputVisible={() => { void handleToggleWorshipVisibility(); }}
                  outputVisibilityPending={visibilityActionPending}
                  labelMode={worshipLabel.labelMode}
                  labelOptions={worshipLabel.labelOptions}
                  onLabelModeChange={worshipLabel.setLabelMode}
                />
              </section>

              {/* Output Controls */}
              {selectedSong && (
                <section className="dock-console-panel dock-console-panel--deck dock-console-panel--deck-static dock-console-panel--deck-worship">
                  {actionError && (
                    <div className="dock-action-error dock-action-error--console">
                      <Icon name="warning" size={14} />
                      <span style={{ flex: 1 }}>{actionError}</span>
                      <button
                        type="button"
                        onClick={() => setActionError("")}
                        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                        title={t('common.close')}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}

                  <div className="dock-worship-toolbar">
                    <DockBottomToolbar
                      overlayMode={fullscreenOnlyMode ? "fullscreen" : overlayMode}
                      onModeChange={handleOverlayModeChange}
                      hideOverlayModeToggle={fullscreenOnlyMode}
                      overlayModeToggleDisabled={autoAdvanceActive}
                      centerAction={
                        <button
                          type="button"
                          className="dock-bible-reader__quick-edit-toolbar-btn"
                          onClick={() => setShowThemeSettings(true)}
                          title={t('worship.quickEdits', 'Quick Edits')}
                          aria-label={t('worship.quickEdits', 'Quick Edits')}
                        >
                          <Icon name="edit" size={14} />
                          <span className="dock-bible-reader__quick-edit-label">{t('worship.quickEdits', 'Quick Edits')}</span>
                        </button>
                      }
                      onQuickEdit={() => setShowThemeSettings(true)}
                      quickEditLabel={t('worship.quickEdits', 'Quick Edits')}
                      clearLabel={worshipOverlayVisible ? t("worship.hideLyrics") : t("worship.showLyrics")}
                      onClear={handleToggleWorshipVisibility}
                      clearDisabled={visibilityActionPending}
                      sourceVisible={worshipOverlayVisible}
                      collapsed={toolbarCollapsed}
                      onCollapseChange={setToolbarCollapsed}
                      bottomPanel={searchPlacement !== "top" ? (
                        <DockBottomSearchPanel
                          expanded={bottomSearchExpanded}
                          onToggle={() => setBottomSearchExpanded((current) => !current)}
                          toggleInToolbar
                        >
                          {renderLyricsSearchPanel()}
                        </DockBottomSearchPanel>
                      ) : undefined}
                      bottomPanelToggle={searchPlacement !== "top" ? {
                        expanded: bottomSearchExpanded,
                        onToggle: () => setBottomSearchExpanded((current) => !current),
                      } : undefined}
                    >
                      <button
                        type="button"
                        ref={deletedSectionsTriggerRef}
                        className={`dock-btm-overflow__menu-item${showDeletedSectionsPopover ? " dock-btm-overflow__menu-item--active" : ""}`}
                        data-dock-close-overflow="true"
                        onClick={handleToggleDeletedSectionsPopover}
                        title={t("worship.viewDeletedSlides")}
                        aria-label={t("worship.viewDeletedSlides")}
                        aria-expanded={showDeletedSectionsPopover}
                      >
                        <Icon name="delete_sweep" size={14} />
                        <span>{t("worship.viewDeletedSlides")}</span>
                        {deletedSections.length > 0 && (
                          <span className="dock-worship-history__count">{Math.min(deletedSections.length, 9)}</span>
                        )}
                      </button>
                      <DockSceneRoutingControl
                        module="worship"
                        route={sceneRoute}
                        onRouteChange={updateSceneRoute}
                        title={t("sceneRouting.bible", "Output")}
                        placement="above"
                        showLabel
                        iconName="cast"
                        itemLabel={t("worship.song", "worship slide")}
                        onSend={(opts) => {
                          if (selectedSong && activeSectionIndex !== null && activeSectionIndex >= 0) {
                            if (opts?.bypassSceneRoute) {
                              worshipSceneRouteConfirmedRef.current = false;
                            } else {
                              worshipSceneRouteConfirmedRef.current = true;
                            }
                            void goLiveSection(activeSectionIndex, {
                              bypassSceneRoute: opts?.bypassSceneRoute,
                            });
                          }
                        }}
                      />

                      {presentationLinkMode && (
                        <button
                          type="button"
                          className={`dock-btm-overflow__menu-item${showPresentationMeta ? " dock-btm-overflow__menu-item--active" : ""}`}
                          data-dock-close-overflow="true"
                          onClick={() => void handleTogglePresentationMeta()}
                          title={showPresentationMeta ? t("worship.hidePresentationMeta") : t("worship.showPresentationMeta")}
                          aria-label={showPresentationMeta ? t("worship.hidePresentationMeta") : t("worship.showPresentationMeta")}
                        >
                          <Icon name="title" size={14} />
                          <span>{t("worship.presentationMeta", "Presentation Title & Subtitle")}</span>
                        </button>
                      )}

                    </DockBottomToolbar>
                  </div>
                </section>
              )}
            </>
          )}

          {songEditor && (
            <DockLyricsEditorDialog
              key={songEditor.id}
              dialogId="dock-song-editor-title"
              eyebrow={t('worship.editSong')}
              title={t('worship.songDetails')}
              initialDraft={songDraft}
              saveLabel={savingSong ? t('worship.saving') : t('common.save')}
              cancelLabel={t('common.cancel')}
              resetLabel={t('worship.resetDefault')}
              saving={savingSong}
              onCancel={closeSongEditor}
              onSave={handleSaveSongEditor}
              onReset={handleResetSongEditor}
              onDraftChange={setSongDraft}
            />
          )}

          {slideEditor && (
            <DockWorshipSlideEditorDialog
              key={`${selectedSong?.id ?? "worship"}-${slideEditor.index}`}
              label={slideEditor.label}
              initialText={slideEditor.text}
              initialLinesPerSlide={slideEditor.linesPerSlide}
              saving={savingSong}
              onCancel={closeSlideEditor}
              onSave={handleSaveSlideEditor}
            />
          )}

          {isNewSongModalOpen && (
            <DockLyricsEditorDialog
              dialogId="dock-new-song-title"
              eyebrow={newSongSource?.importSourceType === "online" ? t('worship.reviewImport') : t('worship.addSong')}
              title={newSongSource?.importSourceType === "online" ? t('worship.reviewLyricsBeforeSaving') : t('worship.newWorshipSong')}
              initialDraft={newSongDraft}
              saveLabel={savingSong ? t('worship.saving') : t('worship.saveSong')}
              cancelLabel={t('common.cancel')}
              saving={savingSong}
              onCancel={closeNewSongModal}
              onSave={handleSaveNewSong}
              onDraftChange={setNewSongDraft}
            />
          )}

          {onlineSearchOpen && (
            <DockModalPortal>
              <div className="dock-dialog-backdrop" role="presentation">
                <div className="dock-dialog dock-dialog--online-lyrics" role="dialog" aria-modal="true" aria-labelledby="dock-online-song-title">
                <div className="dock-dialog__header">
                  <div>
                    <div className="dock-dialog__eyebrow">{t('worship.searchOnline')}</div>
                    <h2 id="dock-online-song-title" className="dock-dialog__title">{t('worship.importLyrics')}</h2>
                  </div>
                  <button
                    type="button"
                    className="dock-dialog__close"
                    onClick={() => setOnlineSearchOpen(false)}
                    aria-label={t('common.close')}
                    title={t('common.close')}>
                    <Icon name="close" size={14} />
                  </button>
	                </div>
	                <div className="dock-dialog__body">
                  <form
                    className="dock-search dock-search--console dock-search--plain dock-search--online"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleOnlineSearch();
                    }}
                  >
                    <div className="dock-search--online__field">
                      <input
                        className="dock-input"
                        placeholder={t('worship.typeToSearch')}
                        value={onlineSearchQuery}
                        onChange={(event) => {
                          setOnlineSearchQuery(event.target.value);
                          setOnlineSearchSubmittedQuery("");
                        }}
                        aria-label={t('worship.searchOnline')}
                        autoFocus
                      />
                      {onlineSearchQuery && (
                        <button
                          type="button"
                          className="dock-search__clear"
                          onClick={() => {
                            setOnlineSearchQuery("");
                            setOnlineSearchSubmittedQuery("");
                          }}
                          aria-label={t('common.clear')}
                          title={t('common.clear')}
                        >
                          <Icon name="close" size={13} />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      className="dock-search__submit"
                      disabled={onlineSearchLoading || onlineSearchQuery.trim().length < 3}
                      aria-label={t('worship.searchOnline')}
                      title={t('worship.searchOnline')}
                    >
                      {t("common.search")}
                    </button>
                  </form>
                  {onlineSearchLoading && (
                    <div className="dock-dialog__status">
                      <Icon name="sync" size={13} />
                      {t('worship.searchingOnline')}
                    </div>
                  )}
                  {onlineSearchError && <div className="dock-dialog__error">{onlineSearchError}</div>}
                  <div className="dock-dialog-results">
                    {onlineResults.map((result) => (
                      <div className="dock-dialog-result" key={result.id}>
                        <div className="dock-dialog-result__body">
                          <span className="dock-dialog-result__title">{result.title}</span>
                          <span className="dock-dialog-result__meta">
                            {[result.artist, result.sourceName].filter(Boolean).join(" · ") || t('worship.onlineLyrics')}
                          </span>
                          {result.preview && <span className="dock-dialog-result__preview">{result.preview}</span>}
                        </div>
                        <button
                          type="button"
                          className="dock-btn dock-btn--ghost dock-dialog-result__action"
                          onClick={() => handleImportOnlineResult(result)}
                          title={t('worship.importSong')}>
                          {t('worship.importSong')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
              </div>
            </DockModalPortal>
          )}
        </div>

        {visitedSubTabs.has("notes") && (
          <div
            className="dock-worship-subtab-pane dock-worship-subtab-pane--notes"
            hidden={worshipSubTab !== "notes"}
            style={{
              display: worshipSubTab === "notes" ? "flex" : "none",
              flex: "1 1 auto",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <DockNotesTab
              staged={staged}
              onStage={onStage}
              isActive={worshipSubTab === "notes"}
              presentationOutputTarget={presentationOutputTarget}
              searchPlacement={searchPlacement}
              productionDefaults={notesProductionDefaults}
            />
          </div>
        )}
      </div>
      </div>

      {/* Theme Settings Modal */}
      <DockThemeSettingsModal
        selectedThemeId={activeThemePickerProps.selectedThemeId}
        onSelect={activeThemePickerProps.onSelect}
        allowedCategories={["worship", "general"]}
        quickSettings={
          fullscreenOnlyMode || overlayMode === "fullscreen"
            ? activeFullscreenQuickThemeSettings
            : activeLowerThirdQuickThemeSettings
        }
        defaultQuickSettings={
          fullscreenOnlyMode || overlayMode === "fullscreen"
            ? defaultFullscreenQuickThemeSettings
            : defaultLowerThirdQuickThemeSettings
        }
        onQuickSettingsSave={async (next) => {
          if (fullscreenOnlyMode || overlayMode === "fullscreen") {
            await handleSaveFullscreenQuickThemeSettings(next);
          } else {
            await handleSaveLowerThirdQuickThemeSettings(next);
          }
        }}
        resolveThemeQuickSettings={resolveThemeQuickSettings}
        title={t('worship.quickEdits')}
        subtitle={t('worship.adjustDescription')}
        isOpen={showThemeSettings}
        onClose={() => setShowThemeSettings(false)}
        overlayMode={fullscreenOnlyMode ? "fullscreen" : overlayMode}
        showReferences={false}
        storageScope="worship"
      />

      {songDeleteTarget && (
        <DockSongDeleteDialog
          songTitle={songDeleteTarget.title}
          busy={deletingSong}
          onConfirm={() => void handleDeleteSong()}
          onCancel={() => {
            if (!deletingSong) setSongDeleteTarget(null);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="dock-toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`dock-toast dock-toast--${toast.tone}`}>
              {toast.tone === "success" && <Icon name="check" size={13} />}
              {toast.tone === "error" && <Icon name="warning" size={13} />}
              {toast.tone === "info" && <Icon name="check_circle" size={13} />}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      <DockSceneRouteConfirmDialog
        open={Boolean(pendingWorshipRouteConfirm)}
        route={sceneRoute}
        itemLabel={t("worship.song", "worship slide")}
        onConfirmRouted={handleConfirmWorshipRoute}
        onSendToMceAlone={handleSendWorshipToMceAlone}
        onCancel={handleCancelWorshipRouteConfirm}
      />

      {showDeletedSectionsPopover && createPortal(
        <div
          ref={deletedSectionsPopoverRef}
          className="dock-worship-history__popover"
          role="dialog"
          aria-label={t("worship.deletedSlides")}
          style={{
            position: "fixed",
            top: deletedSectionsPopoverPos.top,
            left: deletedSectionsPopoverPos.left,
            zIndex: 10000,
          }}
        >
          <div className="dock-worship-history__popover-header">
            <span className="dock-worship-history__popover-title">
              {t("worship.deletedSlides")}
            </span>
            <button
              type="button"
              className="dock-worship-history__popover-close"
              onClick={() => setShowDeletedSectionsPopover(false)}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
              {deletedSections.length === 0 ? (
                <div className="dock-worship-history__empty">
                  {t("worship.deletedSlidesEmpty")}
            </div>
          ) : (
            <div className="dock-worship-history__list">
              {deletedSections.map((item) => (
                <div key={item.id} className="dock-worship-history__item">
                  <div className="dock-worship-history__copy">
                    <div className="dock-worship-history__item-title">{item.label || `Slide ${item.index + 1}`}</div>
                    <div className="dock-worship-history__item-text">{item.text}</div>
                  </div>
                  <button
                    type="button"
                    className="dock-worship-history__restore"
                    onClick={() => void handleRestoreDeletedSection(item)}
                    title={t("sermon.restoreBtn")}
                    disabled={savingSong}
                  >
                    <Icon name="undo" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default memo(DockWorshipTab);
