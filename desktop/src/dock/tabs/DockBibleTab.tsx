/**
 * DockBibleTab.tsx — Bible tab for the OBS Browser Dock
 *
 * Smart search: type "gen1vs1", "g11", "jn3:16", "ps23" etc.
 * Resolves straight into a fast chapter reader with stage / live actions per verse.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DOCK_THEMES_REFRESHED_EVENT,
  findRefreshedTheme,
  themeUsesLayout,
  type DockThemesRefreshedDetail,
} from "../dockThemeRefresh";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { preloadBibleSearch, searchBible, type SearchResult as BibleKeywordResult } from "../../bible/bibleData";
import { addFavorite, getFavorites, removeFavorite } from "../../bible/bibleDb";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import {
  DEFAULT_THEME_SETTINGS,
  BOOK_ABBREVS,
  LOWER_THIRD_SIZE_PRESETS,
  type BiblePassage,
  type BibleTheme,
  type BibleThemeSettings,
} from "../../bible/types";
import { withScriptureFontFallback } from "../../bible/scriptureFont";
import { dockClient, type DockStateMessage } from "../../services/dockBridge";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import {
  createVoiceBibleDockCommand,
  getVoiceBibleResultKey,
  loadVoiceBibleDockState,
  postVoiceBibleDockCommand,
} from "../../services/voiceBibleDockInterop";
import type {
  VoiceBibleCandidate,
  VoiceBibleResult,
  VoiceBibleSnapshot,
} from "../../services/voiceBibleTypes";
import {
  parseBibleSearch,
  type BibleSearchResult,
} from "../bibleSearchParser";
import {
  normalizeScriptureReference,
  getConceptVerses,
} from "../../bible/scriptureReranker";
import { BibleDockContainer } from "../components/BibleDockUI";
import DockThemeSettingsModal, {
  type DockThemeSceneProfile,
  type DockThemeSettingsSaveContext,
} from "../components/DockThemeSettingsModal";
import BibleHistoryScreen from "./BibleHistoryScreen";
import DockBibleFavoritesModal from "../components/DockBibleFavoritesModal";
import DockBibleMacrosModal from "../components/DockBibleMacrosModal";
import {
  detectActiveTranslationPrompt,
  getTranslationDirectiveSuggestions,
  downloadBibleInDock,
  POPULAR_CATALOG_BIBLES,
  type TranslationDirectiveSuggestion,
} from "../dockBibleCatalog";
import { addToBibleHistory, loadBibleHistory } from "./bibleHistoryTypes";
import type { BibleHistoryItem } from "./bibleHistoryTypes";
import type { DockFullscreenQuickThemeSettings } from "../components/DockFullscreenThemeQuickSettings";
import { addBibleToActiveSchedule, recordPresentationHistory } from "../dockScheduleService";
import {
  DOCK_SELECT_BIBLE_VERSE_EVENT,
  getPendingBibleVerseSelection,
  setPendingBibleVerseSelection,
  type DockSelectBibleVerseDetail,
} from "../dockBibleNavigation";
import {
  buildDockBackgroundPresetOverrides,
  type DockBackgroundPreset
} from "../dockConsoleTheme";
import Icon from "../DockIcon";
import DockBottomToolbar from "../components/DockBottomToolbar";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import DockSceneRouteConfirmDialog from "../components/DockSceneRouteConfirmDialog";
import DockSceneRouteSendControl from "../components/DockSceneRouteSendControl";
import { DockOnboardingTour } from "../components/DockOnboardingTour";
import {
  applyMeasuredFontFitSettings,
  normalizeLowerThirdFitSettings,
  LOWER_THIRD_FIT_MIN_FONT_SIZE,
  LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
  LOWER_THIRD_FONT_SIZE_MAX,
  LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
  type DockOverlayFontFitMeasurement,
} from "../lowerThirdQuickSettings";
import { normalizeCompareThemeSettings } from "../compareThemeConfig";
import { resolveInitialDockBibleCompareEnabled } from "../dockBibleComparePreferences";
import {
  DOCK_BIBLE_KEYWORD_MATCH_CHANGED_EVENT,
  DOCK_BIBLE_PREFS_KEY,
  updateDockBibleKeywordMatchPreference,
} from "../dockBibleKeywordPreference";
import {
  DOCK_THEME_SYNC_EVENT,
  type DockThemeSyncPayload,
} from "../dockThemeSync";
import {
  resolveEffectiveRefColor,
  resolveEffectiveRefFontWeight,
} from "../dockBibleThemeResolution";
import {
  DOCK_QUICK_SIZE_OPTIONS as LOWER_THIRD_QUICK_SIZE_OPTIONS,
  DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN,
  DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD,
  findActiveQuickSizeOption,
  type DockQuickSizeOption,
} from "../dockQuickSizePresets";

import { ensureObsConnected } from "../obsConnectionGuard";
import { trackBiblePresent, trackBibleSearch, trackOverlayModeSwitched } from "../../services/tracking";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";
import {
  BOOK_CHAPTERS,
  NT_BOOKS,
  OT_BOOKS,
  bookAbbrev,
  getCanonicalVerseCount,
  type DockStagedItem,
} from "../dockTypes";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import type { DockSearchPlacement } from "../dockSearchPlacement";
import { requireEntitlement } from "../dockEntitlement";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  loadDockPreference,
  readDockPreference,
  saveDockPreference,
} from "../../services/dockPreferenceStorage";
import { invoke } from "@tauri-apps/api/core";
import { dockObsClient, type DockBiblePushData, type DockOverlayFitOptions } from "../dockObsClient";
import { useDockSceneRoute } from "../dockSceneRouting";
import { isDockTabVisible } from "../dockTabVisibility";
import { themeSupportsBibleOverlayMode } from "../../bible/themeVariantSupport";
import {
  buildBibleVerseClipboardText,
  copyTextToClipboard,
} from "../bibleClipboard";
import {
  getDockBibleKeywordMatchOutputOptions,
  splitTextByKeywordTerms,
} from "../dockKeywordMatch";
import { formatBibleOutputText } from "../bibleVerseText";
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { getRecommendedPollingInterval } from "../../services/performanceManager";
import {
  formatDockFavoriteBibleSearch,
  mergeFavoriteBibleSearches,
  type DockFavoriteBibleSearch,
} from "../bibleSearchSuggestions";
import DockBibleComparePassageControls from "../components/DockBibleComparePassageControls";
import DockBibleCompareVersesModal from "../components/DockBibleCompareVersesModal";
import DockCompactTranslationSelect from "../components/DockCompactTranslationSelect";
import {
  buildInstalledTranslationOptions,
  DEFAULT_INSTALLED_TRANSLATION_OPTION,
  resolveInstalledTranslation,
  type BibleTranslationOption,
} from "../bibleTranslationAvailability";
import {
  formatBiblePassageReference,
  navigateBiblePassageReference,
  parseBiblePassageReference,
  type ComparePassageDraft,
  type ComparePassageNavigation,
  type ComparePassagePreview,
  type ParsedBiblePassageReference,
} from "../bibleMultiPassage";
import { layoutVerseStyle, LAYOUT_SCALE_MAX, LAYOUT_SCALE_MIN, pickLayoutAdjust, readLayoutAdjust } from "../../themes/layout/adjust";
import { parseVerseSplitMode, splitVerseText, verseSplitModeId, type VerseSplitMode } from "../verseSplit";
import { HIGHLIGHT_COLORS, addHighlight, applyHighlights, cleanHighlightText, type VerseHighlight } from "../verseHighlight";
import HighlightedVerseText from "../HighlightedVerseText";
import "./DockBibleVerseSplit.css";

const DOCK_CACHED_TRANSLATIONS_KEY = "__mce_dock_cached_translations_v1";

function readCachedTranslations(): BibleTranslationOption[] {
  if (typeof localStorage === "undefined") return [DEFAULT_INSTALLED_TRANSLATION_OPTION];
  try {
    const raw = localStorage.getItem(DOCK_CACHED_TRANSLATIONS_KEY);
    if (!raw) return [DEFAULT_INSTALLED_TRANSLATION_OPTION];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as BibleTranslationOption[];
    }
  } catch {
    // Ignore cache parse errors.
  }
  return [DEFAULT_INSTALLED_TRANSLATION_OPTION];
}

function writeCachedTranslations(options: BibleTranslationOption[]): void {
  if (typeof localStorage === "undefined" || options.length === 0) return;
  try {
    localStorage.setItem(DOCK_CACHED_TRANSLATIONS_KEY, JSON.stringify(options));
  } catch {
    // Ignore storage quota or restricted environment errors.
  }
}

const BIBLE_BOOK_ORDER = [...OT_BOOKS, ...NT_BOOKS];

const BIBLE_BOOK_INITIALS: Record<string, string> = {
  Genesis: "Gen", Exodus: "Exo", Leviticus: "Lev", Numbers: "Num", Deuteronomy: "Deu",
  Joshua: "Jos", Judges: "Jdg", Ruth: "Rut", "1 Samuel": "1Sa", "2 Samuel": "2Sa",
  "1 Kings": "1Ki", "2 Kings": "2Ki", "1 Chronicles": "1Ch", "2 Chronicles": "2Ch",
  Ezra: "Ezr", Nehemiah: "Neh", Esther: "Est", Job: "Job", Psalms: "Psa",
  Proverbs: "Pro", Ecclesiastes: "Ecc", "Song of Solomon": "Sng", Isaiah: "Isa",
  Jeremiah: "Jer", Lamentations: "Lam", Ezekiel: "Ezk", Daniel: "Dan", Hosea: "Hos",
  Joel: "Jol", Amos: "Amo", Obadiah: "Oba", Jonah: "Jon", Micah: "Mic",
  Nahum: "Nah", Habakkuk: "Hab", Zephaniah: "Zep", Haggai: "Hag", Zechariah: "Zec",
  Malachi: "Mal", Matthew: "Mat", Mark: "Mrk", Luke: "Luk", John: "Jhn",
  Acts: "Act", Romans: "Rom", "1 Corinthians": "1Co", "2 Corinthians": "2Co",
  Galatians: "Gal", Ephesians: "Eph", Philippians: "Php", Colossians: "Col",
  "1 Thessalonians": "1Th", "2 Thessalonians": "2Th", "1 Timothy": "1Ti", "2 Timothy": "2Ti",
  Titus: "Tit", Philemon: "Phm", Hebrews: "Heb", James: "Jas", "1 Peter": "1Pe",
  "2 Peter": "2Pe", "1 John": "1Jn", "2 John": "2Jn", "3 John": "3Jn", Jude: "Jud",
  Revelation: "Rev",
};

function getBookInitials(name: string): string {
  return BIBLE_BOOK_INITIALS[name] || bookAbbrev(name) || name.slice(0, 3);
}

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
  initialVoiceBible?: VoiceBibleSnapshot | null;
  appConnected: boolean;
  presentationOutputTarget?: DockPresentationOutputTarget;
  searchPlacement?: DockSearchPlacement;
  fullscreenOnly?: boolean;
  showHistory?: boolean;
  onHistoryClose?: () => void;
  onSaveFeedback?: (message: string) => void;
  onToggleMenu?: () => void;
}

type OverlayMode = "fullscreen" | "lower-third";
type DisplayMode = "single" | "compare";
type CompareMode = "translations" | "passages";
type CompareLayout = "line-by-line" | "side-by-side";
type ThemeSettingsTab = "text" | "layout" | "background" | "compare";
type BibleReferenceFormat = "full" | "short" | "hidden";
type ComparePassageOutputColumn = {
  book: string;
  chapter: number;
  verse: number;
  verseEnd: number | null;
  verseRange: string;
  referenceLabel: string;
  translation: string;
  verseText: string;
};
type BibleBrowserQuickSettingsPatch = Partial<Pick<
  DockFullscreenQuickThemeSettings,
  | "fontSize"
  | "refFontSize"
  | "fontWeight"
  | "fontStyle"
  | "refFontWeight"
  | "lineHeight"
  | "refSpacing"
  | "layoutTextScale"
  | "layoutRefScale"
  | "layoutBold"
  | "layoutItalic"
  | "compareVerseFontSizeLeft"
  | "compareVerseFontSizeRight"
  | "compareReferenceFontSizeLeft"
  | "compareReferenceFontSizeRight"
  | "compareAutoFitMaxFontSize"
  | "autoFontScale"
  | "animation"
  | "animationDuration"
  | "referenceBackgroundEnabled"
  | "referenceBackgroundColor"
  | "referenceBackgroundStyle"
  | "referenceBackgroundRadius"
  | "lowerThirdSize"
  | "lowerThirdWidthPreset"
  | "lowerThirdCardPadding"
  | "lowerThirdBarMaxHeight"
  | "backgroundType"
  | "backgroundImage"
  | "backgroundImageFilePath"
  | "backgroundVideo"
  | "backgroundVideoFilePath"
  | "backgroundColor"
  | "backgroundColorEnd"
  | "backgroundPattern"
  | "backgroundOpacity"
  | "fullscreenShadeOpacity"
>>;
type BibleQuickSettingsSaveContext = DockThemeSettingsSaveContext & {
  lineCount?: number;
};

const GENERAL_SCENE_PROFILE_ID = "__general__";

interface DockSceneQuickThemeProfile {
  fullscreen?: DockFullscreenQuickThemeSettings | null;
  lowerThird?: DockFullscreenQuickThemeSettings | null;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  fullscreenThemeSettings?: Record<string, unknown> | null;
  lowerThirdThemeSettings?: Record<string, unknown> | null;
}

type DockSceneQuickThemeSettings = Record<string, DockSceneQuickThemeProfile>;

interface BibleThemeOutputOverride {
  themeId: string;
  settings: BibleThemeSettings;
  liveOverrides?: Record<string, unknown> | null;
}
const DOCK_BIBLE_UI_PREFS_KEY = "ocs-dock-bible-ui-preferences";
const MAX_VERSE_LINES = 4;
/** Which verses are split into parts, and how (set from the verse right-click menu). */
const VERSE_SPLIT_STORAGE_KEY = "mce-dock-verse-split-v1";
/** Words coloured in a verse (right-click a verse after selecting words). */
const VERSE_HIGHLIGHT_STORAGE_KEY = "mce-dock-verse-highlights-v1";
function loadVerseHighlights(): Record<string, VerseHighlight[]> {
  try {
    const raw = localStorage.getItem(VERSE_HIGHLIGHT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, VerseHighlight[]>) : {};
  } catch {
    return {};
  }
}
const DEFAULT_VERSE_LINES = 1;
const DEFAULT_QUICK_ACTIONS_TOP = 42;
const QUICK_ACTIONS_MIN_TOP = 8;
const QUICK_ACTIONS_HANDLE_WIDTH = 26;
const QUICK_ACTIONS_HANDLE_HEIGHT = 60;
const QUICK_ACTIONS_BOTTOM_GAP = 12;
const DEFAULT_BIBLE_REFERENCE_FORMAT: BibleReferenceFormat = "full";
const QUICK_SELECT_VERSION_COUNT = 2;
const MIN_COMPARE_PASSAGES = 2;
const MAX_COMPARE_PASSAGES = 3;
const MIN_DOCK_KEYWORD_SEARCH_LENGTH = 3;
const DOCK_KEYWORD_SEARCH_LIMIT = 24;
const DOCK_SEARCH_DEBOUNCE_MS = 600;
const BIBLE_RECENT_SEARCHES_KEY = "ocs-dock-bible-recent-searches-v1";
const BIBLE_RECENT_SEARCH_LIMIT = 4;
const HISTORY_PREVIEW_MAX_CHARS = 28;

function getHistoryVersePreview(verseText: string): string {
  const lines = verseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const firstLine = lines[0];
  if (firstLine.length <= HISTORY_PREVIEW_MAX_CHARS && lines.length === 1) {
    return firstLine;
  }

  const words = firstLine.split(/\s+/);
  let preview = "";
  for (const word of words) {
    const next = preview ? `${preview} ${word}` : word;
    if (next.length > HISTORY_PREVIEW_MAX_CHARS) break;
    preview = next;
  }

  return `${preview || firstLine.slice(0, HISTORY_PREVIEW_MAX_CHARS).trimEnd()}…`;
}

function getRecentBibleHistoryItems(items: BibleHistoryItem[]): BibleHistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
}

function getFavoriteBibleHistoryItems(): BibleHistoryItem[] {
  return loadBibleHistory().filter((item) => item.isFavorite);
}

interface DockBiblePreferences {
  [key: string]: unknown;
  overlayMode?: OverlayMode;
  displayMode?: DisplayMode;
  translation?: string;
  translations?: string[];
  translationA?: string;
  translationB?: string;
  compareEnabled?: boolean;
  compareMode?: CompareMode;
  compareLayout?: CompareLayout;
  comparePassages?: Array<{ reference?: string; translation?: string }>;
  comparePassageNavigation?: ComparePassageNavigation;
  verseLineCount?: number;
  fullscreenVerseLineCount?: number;
  lowerThirdVerseLineCount?: number;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  fullscreenQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettingsLinkedToFullscreen?: boolean;
  sceneQuickThemeSettings?: DockSceneQuickThemeSettings;
  referenceFormat?: BibleReferenceFormat;
  referenceVersionVisible?: boolean;
  keywordMatchPushDirectlyToObs?: boolean;
  selectedBook?: string;
  selectedChapter?: number;
  /** The verse that was selected when the dock was last used (selected only, never sent to the output). */
  selectedVerse?: number;
  updatedAt?: string;
}

/** The saved verse, if it still belongs to the saved book and chapter. */
function resolveSavedVerse(book: string | null, chapter: number | null, saved: unknown): number | null {
  if (!book || chapter === null) return null;
  if (typeof saved !== "number" || !Number.isInteger(saved) || saved < 1) return null;
  const max = getCanonicalVerseCount(book, chapter);
  return max !== null && saved > max ? null : saved;
}

interface DockBibleUiPreferences {
  [key: string]: unknown;
  controlsCollapsed?: boolean;
  quickActionsTop?: number;
  quickActionsLeft?: number | null;
  browserQuickUpdateImmediately?: boolean;
  updatedAt?: string;
}

type QuickActionsDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  currentLeft: number;
  currentTop: number;
  containerWidth: number;
  containerHeight: number;
  didDrag: boolean;
};

type ColumnTranslations = string[];
type LiveTranscriptWordChip = {
  id: string;
  text: string;
  lane: "start" | "end";
};

function normalizeColumnTranslations(
  values?: string[] | null,
  fallback = "KJV",
): ColumnTranslations {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  return Array.from({ length: MAX_VERSE_LINES }, (_, index) => {
    const next = source[index] ?? source[0] ?? fallback;
    return next.toUpperCase();
  });
}

function createEmptyPassages(): Array<BiblePassage | null> {
  return Array.from({ length: MAX_VERSE_LINES }, () => null);
}

function createEmptyErrors(): string[] {
  return Array.from({ length: MAX_VERSE_LINES }, () => "");
}

function normalizeComparePassageDrafts(
  values: DockBiblePreferences["comparePassages"],
  translationA: string,
  translationB: string,
): ComparePassageDraft[] {
  const stored = Array.isArray(values) ? values.slice(0, MAX_COMPARE_PASSAGES) : [];
  const drafts = stored.map((value, index) => ({
    id: `compare-passage-${index + 1}`,
    reference: typeof value?.reference === "string" ? value.reference : "",
    translation: typeof value?.translation === "string" && value.translation.trim()
      ? value.translation.toUpperCase()
      : index === 0 ? translationA.toUpperCase() : translationB.toUpperCase(),
  }));

  while (drafts.length < MIN_COMPARE_PASSAGES) {
    const index = drafts.length;
    drafts.push({
      id: `compare-passage-${index + 1}`,
      reference: "",
      translation: (index === 0 ? translationA : translationB).toUpperCase(),
    });
  }
  return drafts;
}

function clampVerseLineCount(value?: number): number {
  if (!value || Number.isNaN(value)) return DEFAULT_VERSE_LINES;
  return Math.min(MAX_VERSE_LINES, Math.max(1, value));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface BibleOutputControlsMenuProps {
  open: boolean;
  settings: DockFullscreenQuickThemeSettings;
  lineCount: number;
  isFitTextMode: boolean;
  /** @deprecated Changes always apply immediately. */
  browserQuickUpdateImmediately?: boolean;
  /** @deprecated Changes always apply immediately. */
  hasPendingBrowserQuickChanges?: boolean;
  mode?: "fullscreen" | "lower-third";
  compareEnabled?: boolean;
  onToggleCompare?: () => void;
  translationB?: string;
  availableTranslations?: BibleTranslationOption[];
  onTranslationBChange?: (trans: string) => void;
  onClose: () => void;
  onLowerThirdSizePresetChange: (option: DockQuickSizeOption) => void;
  onLineCountChange: (lineCount: number) => void;
  /** @deprecated Changes always apply immediately. */
  onUpdateImmediatelyChange?: (checked: boolean) => void;
  /** @deprecated Changes always apply immediately. */
  onSave?: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onFontSizeStep?: (delta: number) => void;
  /** Bold / italic for the verse text (hidden when not provided). */
  onTextStyleChange?: (patch: { fontWeight?: "normal" | "bold"; fontStyle?: "normal" | "italic" }) => void;
  currentFontSize?: number;
  minFontSize?: number;
  maxFontSize?: number;
  /** Full screen / Lower third switch (hidden when not provided, e.g. full-screen-only). */
  onOverlayModeChange?: (mode: "fullscreen" | "lower-third") => void;
  /** Show / Hide the verse on the output without clearing the selection. */
  outputVisible?: boolean;
  outputVisibilityPending?: boolean;
  onToggleOutputVisible?: () => void;
  /** Reference line and "(KJV)" on the output. */
  referenceShown?: boolean;
  onReferenceShownChange?: (shown: boolean) => void;
  versionShown?: boolean;
  onVersionShownChange?: (shown: boolean) => void;
}

// Compatibility anchors: dock-bible-reference-popover dock-bible-reference-trigger bible.referenceDisplay
function BibleOutputControlsMenu({
  open,
  settings,
  lineCount,
  isFitTextMode,
  mode = "lower-third",
  compareEnabled,
  onToggleCompare,
  translationB,
  availableTranslations,
  onTranslationBChange,
  onClose,
  onLowerThirdSizePresetChange,
  onLineCountChange,
  onOpenSettings,
  onFontSizeStep,
  onTextStyleChange,
  currentFontSize,
  minFontSize = 14,
  maxFontSize = 200,
  onOverlayModeChange,
  outputVisible = true,
  outputVisibilityPending = false,
  onToggleOutputVisible,
  referenceShown = true,
  onReferenceShownChange,
  versionShown = true,
  onVersionShownChange,
}: BibleOutputControlsMenuProps) {
  const { t } = useTranslation();
  // "Bold" is on for every heavy weight (bold / extra bold / black).
  const verseIsBold = ["bold", "extrabold", "black"].includes(String(settings.fontWeight ?? ""));
  const verseIsItalic = settings.fontStyle === "italic";

  const sizeOptions = mode === "fullscreen"
    ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN
    : mode === "lower-third"
    ? DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD
    : LOWER_THIRD_QUICK_SIZE_OPTIONS;
  // Always show one size as selected: the exact preset if the theme uses one,
  // otherwise the closest one.
  const activeSizeOption = findActiveQuickSizeOption(
    sizeOptions,
    mode === "fullscreen" ? "fullscreen" : "lower-third",
    settings,
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="dock-bible-reader__font-size-menu" role="dialog" aria-label={t("bible.bibleOutputControls", "Bible output controls")}>
      <div className="dock-bible-reader__font-size-menu-header">
        <span>{t("bible.bibleOutputControls", "Bible output controls")}</span>
        {onOpenSettings && (
          <button
            type="button"
            className="dock-output-quick-actions__settings"
            onClick={onOpenSettings}
            title={t("bible.themeSettings", "Background & Theme Settings")}
            aria-label={t("bible.themeSettings", "Background & Theme Settings")}
          >
            <Icon name="tune" size={12} />
          </button>
        )}
      </div>

      {(onOverlayModeChange || onToggleOutputVisible) && (
        <div className="dock-output-quick-actions__row">
          {onOverlayModeChange && (
            <div className="dock-output-quick-actions__segmented" role="group" aria-label={t("bible.outputLayout", "Output layout")}>
              {(["fullscreen", "lower-third"] as const).map((layout) => (
                <button
                  key={layout}
                  type="button"
                  className={`dock-output-quick-actions__segment${mode === layout ? " dock-output-quick-actions__segment--active" : ""}`}
                  aria-pressed={mode === layout}
                  onClick={() => onOverlayModeChange(layout)}
                >
                  {layout === "fullscreen" ? t("bible.fullscreen", "Full screen") : t("bible.lowerThird", "Lower third")}
                </button>
              ))}
            </div>
          )}
          {onToggleOutputVisible && (
            <button
              type="button"
              className={`dock-output-quick-actions__visibility${outputVisible ? "" : " dock-output-quick-actions__visibility--hidden"}`}
              onClick={onToggleOutputVisible}
              disabled={outputVisibilityPending}
              aria-pressed={!outputVisible}
              title={outputVisible
                ? t("bible.hideOutputHint", "Hide the verse on the output (keeps your place)")
                : t("bible.showOutputHint", "Show the verse on the output again")}
            >
              <Icon name={outputVisible ? "visibility_off" : "visibility"} size={12} />
              <span>{outputVisible ? t("common.hide", "Hide") : t("common.show", "Show")}</span>
            </button>
          )}
        </div>
      )}

      {isFitTextMode && (
        <div className="dock-bible-reader__font-size-field">
          <span className="dock-bible-reader__font-size-field-label">{t("bible.frameSize", "Text size")}</span>
          <small>{t("bible.frameSizeDescription", "Larger text and reference; narrower text area.")}</small>
          <div className="dock-output-quick-actions__size-row">
          <div className="dock-bible-reader__size-presets" role="group" aria-label={t("bible.frameSize", "Text size")}>
            {sizeOptions.map((option) => {
              const isOptionActive = activeSizeOption?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`dock-bible-reader__size-preset${isOptionActive ? " dock-bible-reader__size-preset--active" : ""}`}
                  onClick={() => onLowerThirdSizePresetChange(option)}
                  aria-pressed={isOptionActive}
                >
                  {t(option.labelKey, option.label)}
                </button>
              );
            })}
          </div>
          {onFontSizeStep && typeof currentFontSize === "number" && (
            <div className="dock-bible-reader__font-size-controls">
              <button
                type="button"
                className="dock-bible-reader__font-size-btn"
                onClick={() => onFontSizeStep(-2)}
                disabled={currentFontSize <= minFontSize}
                aria-label={t("bible.decreaseFontSize", "Decrease text size")}
                title={t("bible.decreaseFontSize", "Decrease text size")}
              >
                <Icon name="remove" size={12} />
              </button>
              <span className="dock-bible-reader__font-size-value">{currentFontSize}px</span>
              <button
                type="button"
                className="dock-bible-reader__font-size-btn"
                onClick={() => onFontSizeStep(2)}
                disabled={currentFontSize >= maxFontSize}
                aria-label={t("bible.increaseFontSize", "Increase text size")}
                title={t("bible.increaseFontSize", "Increase text size")}
              >
                <Icon name="add" size={12} />
              </button>
            </div>
          )}
          </div>
        </div>
      )}
      {onTextStyleChange && (
        <div className="dock-bible-reader__font-size-field">
          <span className="dock-bible-reader__font-size-field-label">{t("bible.textStyle", "Style")}</span>
          <div className="dock-bible-reader__size-presets" role="group" aria-label={t("bible.textStyle", "Style")}>
            <button
              type="button"
              className={`dock-bible-reader__size-preset${verseIsBold ? " dock-bible-reader__size-preset--active" : ""}`}
              onClick={() => onTextStyleChange({ fontWeight: verseIsBold ? "normal" : "bold" })}
              aria-pressed={verseIsBold}
              title={verseIsBold ? t("bible.boldOff", "Turn bold off") : t("bible.boldOn", "Make the verse bold")}
              style={{ fontWeight: 800 }}
            >
              {t("bible.bold", "Bold")}
            </button>
            <button
              type="button"
              className={`dock-bible-reader__size-preset${verseIsItalic ? " dock-bible-reader__size-preset--active" : ""}`}
              onClick={() => onTextStyleChange({ fontStyle: verseIsItalic ? "normal" : "italic" })}
              aria-pressed={verseIsItalic}
              title={verseIsItalic ? t("bible.italicOff", "Turn italic off") : t("bible.italicOn", "Make the verse italic")}
              style={{ fontStyle: "italic" }}
            >
              {t("bible.italic", "Italic")}
            </button>
          </div>
        </div>
      )}
      <div className="dock-bible-reader__font-size-field-row">
        <label className="dock-bible-reader__font-size-field dock-bible-reader__font-size-field--compact">
          <span className="dock-bible-reader__font-size-field-label">{t("bible.linesPerVerse", "Lines per verse")}</span>
          <select
            className="dock-bible-reader__font-size-select"
            value={lineCount}
            onChange={(event) => onLineCountChange(Number(event.target.value))}
            aria-label={t("bible.linesPerVerse", "Lines per verse")}
          >
            {Array.from({ length: MAX_VERSE_LINES }, (_, index) => index + 1).map((count) => (
              <option key={`quick-lines-${count}`} value={count}>
                {count} {count === 1 ? t("bible.line", "line") : t("bible.lines", "lines")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(onReferenceShownChange || onVersionShownChange) && (
        <div className="dock-output-quick-actions__checks">
          {onReferenceShownChange && (
            <label className="dock-bible-reader__font-size-checkbox">
              <input
                type="checkbox"
                checked={referenceShown}
                onChange={(event) => onReferenceShownChange(event.target.checked)}
              />
              <span>{t("bible.showReference", "Show reference")}</span>
            </label>
          )}
          {onVersionShownChange && (
            <label className="dock-bible-reader__font-size-checkbox">
              <input
                type="checkbox"
                checked={versionShown}
                disabled={!referenceShown}
                onChange={(event) => onVersionShownChange(event.target.checked)}
              />
              <span>{t("bible.showVersion", "Show version (KJV)")}</span>
            </label>
          )}
        </div>
      )}
      {compareEnabled && onToggleCompare && (
        <div className="dock-bible-reader__font-size-field" style={{ width: "100%" }}>
          {compareEnabled && availableTranslations && availableTranslations.length > 0 && onTranslationBChange && (
            <label className="dock-bible-reader__font-size-field" style={{ width: "100%", marginTop: "3px" }}>
              <span className="dock-bible-reader__font-size-field-label">
                {t("dock.compare.compareWith", "Compare with")}
              </span>
              <select
                className="dock-bible-reader__font-size-select"
                value={translationB}
                onChange={(event) => onTranslationBChange(event.target.value)}
                aria-label={t("dock.compare.translationB", "Translation B")}
              >
                {availableTranslations.map((trans) => (
                  <option key={`quick-compare-trans-${trans.value}`} value={trans.value}>
                    {trans.value.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
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

function sanitizeBibleReferenceFormat(value: unknown): BibleReferenceFormat {
  return value === "short" || value === "hidden" || value === "full"
    ? value
    : DEFAULT_BIBLE_REFERENCE_FORMAT;
}

function sanitizeReferenceVersionVisible(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function abbreviateBibleBookCompact(book: string): string {
  const aliases = BOOK_ABBREVS[book]
    ?.map((alias) => alias.replace(/\s+/g, "").trim())
    .filter(Boolean);
  if (aliases?.length) {
    const preferred = aliases
      .map((alias, index) => ({ alias, index }))
      .sort((a, b) => a.alias.length - b.alias.length || b.index - a.index)[0]?.alias;
    if (preferred) return preferred.toUpperCase();
  }

  return book
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : part.slice(0, 3)))
    .join("")
    .toUpperCase();
}

function buildBibleReferenceBaseLabel(
  book: string,
  chapter: number,
  verseRange: string,
  format: BibleReferenceFormat,
): string {
  if (format === "hidden") return "";
  const bookLabel = format === "short" ? abbreviateBibleBookCompact(book) : book;
  return `${bookLabel} ${chapter}:${verseRange}`;
}

function appendBibleVersionToReference(reference: string, translation: string, showVersion: boolean): string {
  const ref = reference.trim();
  const version = showVersion ? translation.trim().toUpperCase() : "";
  if (ref && version) return `${ref} (${version})`;
  return ref || version;
}

function buildBibleReferenceDisplayLabel(
  book: string,
  chapter: number,
  verseRange: string,
  translation: string,
  format: BibleReferenceFormat,
  showVersion: boolean,
): string {
  return appendBibleVersionToReference(
    buildBibleReferenceBaseLabel(book, chapter, verseRange, format),
    translation,
    showVersion,
  );
}

function extractFullscreenQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  const compareSettings = normalizeCompareThemeSettings(settings as unknown as Record<string, unknown>);
  const fontColor = settings.fontColor || DEFAULT_THEME_SETTINGS.fontColor;
  const fontSize = clampNumber(settings.fontSize, 28, 200);
  const fontWeight = settings.fontWeight || "bold";
  return {
    backgroundType: backgroundType ?? settings.backgroundType,
    fontSize,
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(settings.fontFamily || DEFAULT_THEME_SETTINGS.fontFamily),
    refFontSize: clampNumber(settings.refFontSize || (fontSize + 5), 10, 150),
    refFontWeight: resolveEffectiveRefFontWeight(settings.refFontWeight, fontWeight),
    fontColor,
    refFontColor: resolveEffectiveRefColor(settings.refFontColor, fontColor),
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
    textOutlineWidth: clampNumber(settings.textOutlineWidth ?? DEFAULT_THEME_SETTINGS.textOutlineWidth ?? 2, 0, 10),
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
    lowerThirdPosition: settings.lowerThirdPosition || DEFAULT_THEME_SETTINGS.lowerThirdPosition,
    lowerThirdSize: settings.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize,
    lowerThirdWidthPreset: settings.lowerThirdWidthPreset || DEFAULT_THEME_SETTINGS.lowerThirdWidthPreset,
    lowerThirdOffsetX: clampNumber(settings.lowerThirdOffsetX ?? 0, -500, 500),
    backgroundPattern: settings.backgroundPattern ?? "",
    lowerThirdCaptionPosition: settings.lowerThirdCaptionPosition || "bottom",
    lowerThirdEdge: sanitizeLowerThirdEdge(settings.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(settings.lowerThirdCardPadding),
    lowerThirdBarMaxHeight: clampNumber(Number(settings.lowerThirdBarMaxHeight ?? 600), 120, 900),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(settings.lowerThirdPaddingLinked),
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(settings.lowerThirdCardRadius ?? settings.borderRadius),
    boxBackground: settings.boxBackground || (settings.backgroundColor ? settings.backgroundColor : ""),
    boxBackgroundImage: settings.boxBackgroundImage || "",
    boxOpacity: clampNumber(settings.boxOpacity ?? 1, 0, 1),
    borderRadius: clampNumber(settings.borderRadius ?? settings.lowerThirdCardRadius ?? 16, 0, 64),
    padding: typeof settings.padding === "number" ? settings.padding : 28,
    safeArea: typeof settings.safeArea === "number" ? settings.safeArea : 40,
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(settings.lowerThirdTextDirection),
    compareTranslationWidth: settings.compareTranslationWidth ?? DEFAULT_THEME_SETTINGS.compareTranslationWidth,
    ...compareSettings,
    // Layer-theme sizes set in the Dock (text / reference size, line height, title, position)
    // must survive being re-read from the live theme, or the panel resets to 100%.
    ...pickLayoutAdjust(settings),
  };
}

function buildDefaultLowerThirdQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  const base = extractFullscreenQuickThemeSettings(settings, backgroundType);
  const sizePreset =
    LOWER_THIRD_SIZE_PRESETS[settings.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize] ||
    LOWER_THIRD_SIZE_PRESETS.medium;

  return normalizeLowerThirdFitSettings({
    ...base,
    fontSize: typeof settings.fontSize === "number" && settings.fontSize > 0
      ? clampNumber(settings.fontSize, LOWER_THIRD_FIT_MIN_FONT_SIZE, LOWER_THIRD_FONT_SIZE_MAX)
      : sizePreset.fontSize,
    refFontSize: typeof settings.refFontSize === "number" && settings.refFontSize > 0
      ? clampNumber(settings.refFontSize, LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE, LOWER_THIRD_REFERENCE_FONT_SIZE_MAX)
      : sizePreset.refFontSize,
    lineHeight: settings.lineHeight || sizePreset.lineHeight,
    refSpacing: typeof settings.refSpacing === "number" ? settings.refSpacing : sizePreset.refSpacing,
    lowerThirdBarMaxHeight: typeof settings.lowerThirdBarMaxHeight === "number" ? settings.lowerThirdBarMaxHeight : sizePreset.maxHeight,
    referenceBackgroundEnabled: settings.referenceBackgroundEnabled ?? false,
    lowerThirdWidthPreset: base.lowerThirdWidthPreset,
  });
}

function extractLowerThirdQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  const sizePreset =
    LOWER_THIRD_SIZE_PRESETS[settings.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize] ||
    LOWER_THIRD_SIZE_PRESETS.medium;
  const base = extractFullscreenQuickThemeSettings(settings, backgroundType);
  const fontSize = typeof settings.fontSize === "number" && settings.fontSize > 0
    ? clampNumber(settings.fontSize, LOWER_THIRD_FIT_MIN_FONT_SIZE, LOWER_THIRD_FONT_SIZE_MAX)
    : sizePreset.fontSize;
  return {
    ...base,
    fontSize,
    refFontSize: typeof settings.refFontSize === "number" && settings.refFontSize > 0
      ? clampNumber(settings.refFontSize, LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE, LOWER_THIRD_REFERENCE_FONT_SIZE_MAX)
      : clampNumber(
        fontSize + 5,
        LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
        LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
      ),
    lowerThirdBarMaxHeight: clampNumber(Number(settings.lowerThirdBarMaxHeight ?? sizePreset.maxHeight), 120, 900),
  };
}

function resolveThemeForOverlayMode(theme: BibleTheme, mode: OverlayMode): BibleTheme {
  const variant = mode === "lower-third"
    ? theme.variants?.lowerThird
    : theme.variants?.fullscreen;
  return variant
    ? { ...theme, settings: variant.settings, rawTemplate: variant.rawTemplate }
    : theme;
}

function extractThemeQuickSettingsForOverlayMode(
  theme: BibleTheme,
  mode: OverlayMode,
): DockFullscreenQuickThemeSettings {
  const baseTheme = resolveThemeForOverlayMode(theme, mode);
  const extracted = mode === "fullscreen"
    ? extractFullscreenQuickThemeSettings(baseTheme.settings, "theme")
    : extractLowerThirdQuickThemeSettings(baseTheme.settings, "theme");
  // Keep the selected theme's motion in the live dock payload. Missing motion
  // falls back to the shared fade default instead of silently disabling it.
  return extracted;
}

function applyLowerThirdQuickThemeSettings(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null,
): BibleTheme {
  const themed = applyFullscreenQuickThemeSettings(theme, quickSettings);
  const sizePreset =
    LOWER_THIRD_SIZE_PRESETS[quickSettings?.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize] ||
    LOWER_THIRD_SIZE_PRESETS.medium;
  return {
    ...themed,
    settings: {
      ...themed.settings,
      padding: sizePreset.padding,
      safeArea: sizePreset.safeArea,
      lowerThirdBarMaxHeight: sizePreset.maxHeight,
    },
  };
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function sanitizeFullscreenQuickThemeSettings(
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

  const fontSize = clampNumber(
    Number(source.fontSize ?? DEFAULT_THEME_SETTINGS.fontSize),
    mode === "lower-third" ? LOWER_THIRD_FIT_MIN_FONT_SIZE : 16,
    mode === "lower-third" ? LOWER_THIRD_FONT_SIZE_MAX : 200,
  );
  const fontColor = sanitizeColor(source.fontColor, DEFAULT_THEME_SETTINGS.fontColor);
  const rawRefFontColor = sanitizeColor(source.refFontColor, DEFAULT_THEME_SETTINGS.refFontColor);
  const refFontColor = resolveEffectiveRefColor(rawRefFontColor, fontColor);
  const rawRefFontWeight = (source.refFontWeight as BibleThemeSettings["refFontWeight"]) || DEFAULT_THEME_SETTINGS.refFontWeight;
  const refFontWeight = resolveEffectiveRefFontWeight(rawRefFontWeight, fontWeight);
  const rawRefFontSize = Number(source.refFontSize ?? DEFAULT_THEME_SETTINGS.refFontSize);
  const refFontSize = clampNumber(
    rawRefFontSize > 0 ? rawRefFontSize : (fontSize + 5),
    mode === "lower-third" ? LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE : 10,
    mode === "lower-third" ? LOWER_THIRD_REFERENCE_FONT_SIZE_MAX : 150,
  );

  return {
    // Keep newly added style fields intact across an app update. Known fields
    // below are still normalized and validated before they reach OBS.
    ...source,
    fontSize,
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(
      typeof source.fontFamily === "string" ? source.fontFamily : DEFAULT_THEME_SETTINGS.fontFamily,
    ),
    refFontSize,
    refFontWeight,
    fontColor,
    refFontColor,
    refPosition: (source.refPosition as BibleThemeSettings["refPosition"]) || DEFAULT_THEME_SETTINGS.refPosition,
    refAnchor:
      source.refAnchor === "top" || source.refAnchor === "bottom" || source.refAnchor === "normal"
        ? source.refAnchor
        : (DEFAULT_THEME_SETTINGS.refAnchor ?? "normal"),
    refTextTransform: (source.refTextTransform as BibleThemeSettings["refTextTransform"]) || DEFAULT_THEME_SETTINGS.refTextTransform,
    refLetterSpacing: clampNumber(Number(source.refLetterSpacing ?? DEFAULT_THEME_SETTINGS.refLetterSpacing), 0, 10),
    refOpacity: clampNumber(Number(source.refOpacity ?? DEFAULT_THEME_SETTINGS.refOpacity), 0, 1),
    refTextAlign: (source.refTextAlign as BibleThemeSettings["refTextAlign"]) || DEFAULT_THEME_SETTINGS.refTextAlign,
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
      source.lowerThirdPosition === "left" ||
        source.lowerThirdPosition === "center" ||
        source.lowerThirdPosition === "right"
        ? source.lowerThirdPosition
        : DEFAULT_THEME_SETTINGS.lowerThirdPosition,
    lowerThirdSize:
      source.lowerThirdSize === "smallest" ||
        source.lowerThirdSize === "smaller" ||
        source.lowerThirdSize === "small" ||
        source.lowerThirdSize === "medium" ||
        source.lowerThirdSize === "big" ||
        source.lowerThirdSize === "bigger" ||
        source.lowerThirdSize === "biggest"
        ? source.lowerThirdSize
        : DEFAULT_THEME_SETTINGS.lowerThirdSize,
    lowerThirdWidthPreset:
      source.lowerThirdWidthPreset === "full" ||
        source.lowerThirdWidthPreset === "sm" ||
        source.lowerThirdWidthPreset === "md" ||
        source.lowerThirdWidthPreset === "lg" ||
        source.lowerThirdWidthPreset === "xl" ||
        source.lowerThirdWidthPreset === "xxl"
        ? source.lowerThirdWidthPreset
        : DEFAULT_THEME_SETTINGS.lowerThirdWidthPreset,
    lowerThirdOffsetX: clampNumber(
      Number(source.lowerThirdOffsetX ?? 0),
      -500,
      500,
    ),
    backgroundPattern: typeof source.backgroundPattern === "string" ? source.backgroundPattern : "",
    lowerThirdCaptionPosition:
      source.lowerThirdCaptionPosition === "top" || source.lowerThirdCaptionPosition === "bottom"
        ? source.lowerThirdCaptionPosition
        : "bottom",
    lowerThirdEdge: sanitizeLowerThirdEdge(source.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(source.lowerThirdCardPadding),
    lowerThirdBarMaxHeight: clampNumber(
      Number(source.lowerThirdBarMaxHeight ?? 600),
      120,
      900,
    ),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(source.lowerThirdPaddingLinked),
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(source.lowerThirdCardRadius ?? source.borderRadius),
    boxBackground: typeof source.boxBackground === "string" ? source.boxBackground : "",
    boxBackgroundImage: typeof source.boxBackgroundImage === "string" ? source.boxBackgroundImage : "",
    boxOpacity: clampNumber(Number(source.boxOpacity ?? 1), 0, 1),
    borderRadius: clampNumber(Number(source.borderRadius ?? source.lowerThirdCardRadius ?? 16), 0, 64),
    padding: clampNumber(Number(source.padding ?? 28), 0, 200),
    safeArea: clampNumber(Number(source.safeArea ?? 40), 0, 200),
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(source.lowerThirdTextDirection),
    compareTranslationWidth: clampNumber(Number(source.compareTranslationWidth ?? DEFAULT_THEME_SETTINGS.compareTranslationWidth), 30, 50),
    backgroundType: source.backgroundType,
    ...compareSettings,
  };
}

function sanitizeSceneQuickThemeSettings(value: unknown): DockSceneQuickThemeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const profiles: DockSceneQuickThemeSettings = {};
  for (const [sceneName, rawProfile] of Object.entries(value)) {
    if (!sceneName.trim() || !rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) continue;
    const source = rawProfile as Record<string, unknown>;
    const fullscreen = sanitizeFullscreenQuickThemeSettings(source.fullscreen);
    const lowerThird = sanitizeFullscreenQuickThemeSettings(source.lowerThird, "lower-third");
    const profile: DockSceneQuickThemeProfile = {};
    if (fullscreen) profile.fullscreen = fullscreen;
    if (lowerThird) profile.lowerThird = lowerThird;
    if (typeof source.fullscreenThemeId === "string" && source.fullscreenThemeId.trim()) {
      profile.fullscreenThemeId = source.fullscreenThemeId.trim();
    }
    if (typeof source.lowerThirdThemeId === "string" && source.lowerThirdThemeId.trim()) {
      profile.lowerThirdThemeId = source.lowerThirdThemeId.trim();
    }
    if (source.fullscreenThemeSettings && typeof source.fullscreenThemeSettings === "object" && !Array.isArray(source.fullscreenThemeSettings)) {
      profile.fullscreenThemeSettings = { ...(source.fullscreenThemeSettings as Record<string, unknown>) };
    }
    if (source.lowerThirdThemeSettings && typeof source.lowerThirdThemeSettings === "object" && !Array.isArray(source.lowerThirdThemeSettings)) {
      profile.lowerThirdThemeSettings = { ...(source.lowerThirdThemeSettings as Record<string, unknown>) };
    }
    if (Object.keys(profile).length > 0) profiles[sceneName] = profile;
  }
  return profiles;
}

function applyFullscreenQuickThemeSettings(
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
      // Keep the selected background mode in the live theme payload. The
      // overlay also receives the asset fields, but this explicit mode prevents
      // a stale theme/background fallback from winning on the next verse.
      backgroundType: bgType,
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
      animation: quickSettings.animation,
      animationDuration: quickSettings.animationDuration,
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
      referenceBackgroundEnabled: quickSettings.referenceBackgroundEnabled,
      referenceBackgroundColor: quickSettings.referenceBackgroundColor,
      referenceBackgroundStyle: quickSettings.referenceBackgroundStyle,
      referenceBackgroundRadius: quickSettings.referenceBackgroundRadius,
      fontStyle: quickSettings.fontStyle,
      lowerThirdPosition: quickSettings.lowerThirdPosition,
      lowerThirdSize: quickSettings.lowerThirdSize,
      lowerThirdWidthPreset: quickSettings.lowerThirdWidthPreset,
      lowerThirdOffsetX: quickSettings.lowerThirdOffsetX,
      lowerThirdCaptionPosition: quickSettings.lowerThirdCaptionPosition,
      lowerThirdEdge: quickSettings.lowerThirdEdge,
      lowerThirdCardPadding: quickSettings.lowerThirdCardPadding,
      lowerThirdBarMaxHeight: quickSettings.lowerThirdBarMaxHeight,
      lowerThirdPaddingLinked: quickSettings.lowerThirdPaddingLinked,
      lowerThirdCardRadius: quickSettings.lowerThirdCardRadius,
      lowerThirdTextDirection: quickSettings.lowerThirdTextDirection,
      ...compareSettings,
    },
  };
}

function buildFullscreenLiveOverridesForQuickSettings(
  themeSettings: BibleThemeSettings,
  preset: DockBackgroundPreset,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): Record<string, unknown> | null {
  if (backgroundType && backgroundType !== "theme") {
    return null;
  }
  return buildDockBackgroundPresetOverrides(themeSettings, preset) as Record<string, unknown> | null;
}

function loadDockBiblePreferences(): DockBiblePreferences {
  return readDockPreference<DockBiblePreferences>(DOCK_BIBLE_PREFS_KEY) ?? {};
}

function readDockBibleOverlayMode(): OverlayMode | null {
  const mode = loadDockBiblePreferences().overlayMode;
  return mode === "fullscreen" || mode === "lower-third" ? mode : null;
}

function saveDockBiblePreferences(next: DockBiblePreferences): void {
  void saveDockPreference(DOCK_BIBLE_PREFS_KEY, next);
}

function saveDockBibleOverlayMode(mode: OverlayMode): void {
  saveDockBiblePreferences({
    ...loadDockBiblePreferences(),
    overlayMode: mode,
  });
}

function loadDockBibleUiPreferences(): DockBibleUiPreferences {
  return readDockPreference<DockBibleUiPreferences>(DOCK_BIBLE_UI_PREFS_KEY) ?? {};
}

function saveDockBibleUiPreferences(next: DockBibleUiPreferences): void {
  void saveDockPreference(DOCK_BIBLE_UI_PREFS_KEY, next);
}

function saveDockBibleUiPreferencePatch(patch: DockBibleUiPreferences): void {
  saveDockBibleUiPreferences({
    ...loadDockBibleUiPreferences(),
    ...patch,
  });
}

function clampQuickActionsTop(value: unknown, containerHeight?: number): number {
  const numeric = Number(value);
  const raw = Number.isFinite(numeric) ? numeric : DEFAULT_QUICK_ACTIONS_TOP;
  if (!containerHeight || !Number.isFinite(containerHeight)) {
    return Math.max(QUICK_ACTIONS_MIN_TOP, raw);
  }
  const maxTop = Math.max(
    QUICK_ACTIONS_MIN_TOP,
    containerHeight - QUICK_ACTIONS_HANDLE_HEIGHT - QUICK_ACTIONS_BOTTOM_GAP,
  );
  return Math.min(Math.max(QUICK_ACTIONS_MIN_TOP, raw), maxTop);
}

function getDefaultQuickActionsTop(containerHeight?: number): number {
  if (!containerHeight || !Number.isFinite(containerHeight)) {
    return DEFAULT_QUICK_ACTIONS_TOP;
  }
  return clampQuickActionsTop(
    Math.round((containerHeight - QUICK_ACTIONS_HANDLE_HEIGHT) / 2),
    containerHeight,
  );
}

function clampQuickActionsLeft(value: unknown, containerWidth?: number): number {
  const numeric = Number(value);
  const raw = Number.isFinite(numeric) ? numeric : 0;
  if (!containerWidth || !Number.isFinite(containerWidth)) {
    return Math.max(0, raw);
  }
  const maxLeft = Math.max(0, containerWidth - QUICK_ACTIONS_HANDLE_WIDTH);
  return Math.min(Math.max(0, raw), maxLeft);
}

function getMeasuredQuickActionsLeft(
  handleElement: HTMLElement | null,
  positioningContainer: HTMLElement | null,
  fallback: number,
): number {
  const containerRect = positioningContainer?.getBoundingClientRect();
  const handleRect = handleElement?.getBoundingClientRect();
  if (!containerRect || !handleRect) return fallback;
  return handleRect.left - containerRect.left;
}

/** Quick actions may move vertically, but they always snap to the left or right edge. */
function snapQuickActionsLeft(value: unknown, containerWidth?: number): number | null {
  const maxLeft = Math.max(0, (containerWidth ?? QUICK_ACTIONS_HANDLE_WIDTH) - QUICK_ACTIONS_HANDLE_WIDTH);
  if (maxLeft === 0) return 0;
  const clamped = clampQuickActionsLeft(value, containerWidth);
  return clamped <= maxLeft / 2 ? 0 : null;
}

function normalizeTranscriptStackWord(word: string): string {
  return word.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, "");
}

function splitTranscriptStackWords(transcript: string): string[] {
  return transcript
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function extractTranscriptWordTail(previousWords: string[], nextWords: string[]): string[] {
  if (nextWords.length === 0) return [];
  if (previousWords.length === 0) return nextWords;

  const normalizedPrevious = previousWords.map(normalizeTranscriptStackWord).filter(Boolean);
  const normalizedNext = nextWords.map(normalizeTranscriptStackWord).filter(Boolean);
  const maxOverlap = Math.min(normalizedPrevious.length, normalizedNext.length, 18);

  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (
        normalizedPrevious[normalizedPrevious.length - overlap + index] !==
        normalizedNext[index]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return nextWords.slice(overlap);
    }
  }

  return nextWords;
}

function isReferenceLikeBibleQuery(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return false;

  // A number by itself is a keyword search (for example, "30%"), not a
  // Scripture reference. Let the Bible search service find it in verse text
  // or in chapter/verse numbers.
  if (/^\d+(?:\s*%)?$/.test(trimmed)) return false;

  return (
    (/\d/.test(trimmed) && /[a-z]/i.test(trimmed)) ||
    (/\d/.test(trimmed) && /[:.-]/.test(trimmed)) ||
    /\b(vs|verse|verses|chapter|chap)\b/.test(trimmed)
  );
}

function isNumericOnlyBibleQuery(query: string): boolean {
  return /^\d+(?:\s*%)?$/.test(query.trim());
}

type DockBibleSearchOption =
  | ({ kind: "reference" } & BibleSearchResult)
  | ({ kind: "translation-directive" } & TranslationDirectiveSuggestion & Partial<BibleSearchResult>)
  | {
    kind: "keyword";
    book: string;
    chapter: number;
    verse: number;
    endVerse?: number;
    label: string;
    snippet: string;
    text: string;
    query: string;
    action?: string;
    isMacro?: boolean;
    compareTranslations?: { translationA?: string; translationB: string };
    modeOverride?: "lower-third" | "fullscreen";
    translationOverride?: string;
  }
  | {
    kind: "concept";
    book: string;
    chapter: number;
    verse: number;
    endVerse?: number;
    label: string;
    snippet: string;
    text: string;
    query: string;
    action?: string;
    isMacro?: boolean;
    compareTranslations?: { translationA?: string; translationB: string };
    modeOverride?: "lower-third" | "fullscreen";
    translationOverride?: string;
  };

function emptyVoiceBibleSnapshot(): VoiceBibleSnapshot {
  return {
    status: "idle",
    inputLevel: 0,
    modelReady: false,
    semanticReady: false,
    candidates: [],
    lastResult: null,
  };
}

function readRecentBibleSearches(): string[] {
  try {
    const raw = readNativeDockSetting<unknown>(BIBLE_RECENT_SEARCHES_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? []);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeRecentBibleSearches(items: string[]): void {
  writeNativeDockSetting(BIBLE_RECENT_SEARCHES_KEY, items.slice(0, BIBLE_RECENT_SEARCH_LIMIT));
}

function pushRecentBibleSearch(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return readRecentBibleSearches();
  const next = [
    normalized,
    ...readRecentBibleSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, BIBLE_RECENT_SEARCH_LIMIT);
  writeRecentBibleSearches(next);
  return next;
}

function renderHighlightedKeywordText(text: string, query: string): React.ReactNode {
  const parts = splitTextByKeywordTerms(text, query);
  if (parts.length === 1 && !parts[0].isMatch) return text;

  return parts.map((part, index) =>
    part.isMatch ? (
      <mark key={`${part.text}-${index}`} className="dock-search-dropdown__highlight">
        {part.text}
      </mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

function formatCompactBibleReference(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const clean = trimmed
    .replace(/\s*[—–-]\s*[A-Za-z0-9]{2,}\s*$/, "")
    .replace(/\s*\([A-Za-z0-9]{2,}\)\s*$/, "")
    .trim();
  const parsed = parseBibleSearch(clean)[0] || parseBibleSearch(trimmed)[0];
  if (parsed && parsed.book) {
    const abbrev = bookAbbrev(parsed.book) || parsed.book.slice(0, 4);
    if (parsed.chapter !== null && parsed.verse !== null) {
      const versePart = parsed.endVerse && parsed.endVerse > parsed.verse
        ? `${parsed.verse}-${parsed.endVerse}`
        : `${parsed.verse}`;
      return `${abbrev} ${parsed.chapter}:${versePart}`;
    }
    if (parsed.chapter !== null) {
      return `${abbrev} ${parsed.chapter}`;
    }
    return abbrev;
  }
  return trimmed;
}

function DockBibleTab({
  staged,
  onStage,
  productionDefaults,
  initialVoiceBible,
  appConnected,
  presentationOutputTarget = "obs",
  searchPlacement = "top",
  fullscreenOnly = false,
  showHistory,
  onHistoryClose,
  onSaveFeedback,
  onToggleMenu,
}: Props) {
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const fullscreenOnlyMode = Boolean(fullscreenOnly);
  const [sceneRoute, updateSceneRoute] = useDockSceneRoute("bible");
  const hasSceneRoute = sceneRoute.enabled && sceneRoute.targets.length > 0;
  const bibleSceneRouteConfirmedRef = useRef(false);
  const [pendingVerseRouteConfirm, setPendingVerseRouteConfirm] = useState<{
    book: string;
    chapter: number;
    verse: number;
    options?: Parameters<typeof goLiveVerse>[3];
  } | null>(null);

  const sceneRouteTargetsKey = useMemo(() => {
    return `${sceneRoute.enabled ? "1" : "0"}:${sceneRoute.targets.map((t) => `${t.sceneName}:${t.mode}`).join(",")}`;
  }, [sceneRoute.enabled, sceneRoute.targets]);

  useEffect(() => {
    bibleSceneRouteConfirmedRef.current = false;
  }, [sceneRouteTargetsKey]);

  const pushBibleToConfiguredOutput = useCallback(async (
    data: DockBiblePushData,
    options?: DockOverlayFitOptions,
    pushOptions?: { bypassSceneRoute?: boolean },
  ) => {
    // Free users are presentation-link only. Keep this guard at the output
    // boundary so a future action cannot accidentally touch the MCE Bible
    // source even if it forgets an earlier presentation-mode branch.
    if (presentationLinkMode) return null;
    if (!hasSceneRoute || pushOptions?.bypassSceneRoute) {
      return dockObsClient.pushBible(data, options);
    }
    await dockObsClient.pushBibleToScenes(sceneRoute.targets.map((target) => {
      const outputMode = target.mode === "inherit"
        ? (data.overlayMode === "lower-third" ? "lower-third" : "fullscreen")
        : target.mode;
      const isFullscreen = outputMode === "fullscreen";
      const profile = sceneQuickThemeSettingsRef.current[target.sceneName];
      const profileSettings = isFullscreen
        ? profile?.fullscreenThemeSettings
        : profile?.lowerThirdThemeSettings;
      const targetThemeSettings = profileSettings
        ?? (isFullscreen
          ? (liveFullscreenThemeSettingsRef.current ?? data.bibleThemeSettings)
          : (liveLowerThirdThemeSettingsRef.current ?? data.bibleThemeSettings));
      const targetThemeId = isFullscreen
        ? (profile?.fullscreenThemeId ?? selectedBibleThemeRef.current.id)
        : (profile?.lowerThirdThemeId ?? selectedLowerThirdThemeRef.current.id);
      return {
        data: {
          ...data,
          ...(target.mode === "inherit" ? {} : { overlayMode: target.mode }),
          theme: targetThemeId,
          bibleThemeSettings: targetThemeSettings as Record<string, unknown> | null | undefined,
          liveOverrides: profileSettings ? null : (isFullscreen ? fullscreenLiveOverridesRef.current : null),
        },
        sceneName: target.sceneName,
      };
    }));
    if (sceneRoute.syncPresentation) return dockObsClient.pushBible(data, options);
    return null;
  }, [hasSceneRoute, presentationLinkMode, sceneRoute.targets, sceneRoute.syncPresentation]);

  const clearBibleFromConfiguredOutput = useCallback(async () => {
    if (presentationLinkMode) return;
    if (!hasSceneRoute) {
      await dockObsClient.clearBible();
      return;
    }
    await Promise.all(sceneRoute.targets.map((target) => (
      dockObsClient.clearSceneRouteSource("bible", target.sceneName)
    )));
    if (sceneRoute.syncPresentation) await dockObsClient.clearBible();
  }, [hasSceneRoute, presentationLinkMode, sceneRoute.targets, sceneRoute.syncPresentation]);
  const initialPrefsRef = useRef<DockBiblePreferences | null>(null);
  if (initialPrefsRef.current === null) {
    initialPrefsRef.current = loadDockBiblePreferences();
  }
  const initialUiPrefsRef = useRef<DockBibleUiPreferences | null>(null);
  if (initialUiPrefsRef.current === null) {
    initialUiPrefsRef.current = loadDockBibleUiPreferences();
  }
  const initialPrefs = initialPrefsRef.current;
  const initialUiPrefs = initialUiPrefsRef.current;
  const initialBook =
    initialPrefs.selectedBook && BOOK_CHAPTERS[initialPrefs.selectedBook]
      ? initialPrefs.selectedBook
      : (OT_BOOKS[0] ?? null);
  const maxInitialChapter = initialBook ? (BOOK_CHAPTERS[initialBook] ?? 1) : 1;
  const initialChapter = initialBook
    ? Math.min(Math.max(initialPrefs.selectedChapter ?? 1, 1), maxInitialChapter)
    : null;
  const initialCompareEnabled = resolveInitialDockBibleCompareEnabled(initialPrefs);
  const initialCompareMode: CompareMode = initialPrefs.compareMode === "passages" ? "passages" : "translations";
  const initialFullscreenQuickThemeSettings = sanitizeFullscreenQuickThemeSettings(
    initialPrefs.fullscreenQuickThemeSettings,
  );
  const initialRawLowerThirdQuickThemeSettings = sanitizeFullscreenQuickThemeSettings(
    initialPrefs.lowerThirdQuickThemeSettings,
    "lower-third",
  );
  const initialLowerThirdQuickThemeSettings = initialRawLowerThirdQuickThemeSettings;
  const initialSceneQuickThemeSettings = sanitizeSceneQuickThemeSettings(
    initialPrefs.sceneQuickThemeSettings,
  );

  const [selectedBook, setSelectedBook] = useState<string | null>(initialBook);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(initialChapter);
  const selectedChapterRef = useRef<number | null>(initialChapter);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(
    () => resolveSavedVerse(initialBook, initialChapter, initialPrefs.selectedVerse),
  );
  const [selectedColumn, setSelectedColumn] = useState(0);

  // Floating Book & Chapter Dropdown state
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const [chapterPickerSearch, setChapterPickerSearch] = useState("");
  const [previewPickerBook, setPreviewPickerBook] = useState<string>(initialBook || "Genesis");
  const chapterPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showChapterPicker) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (chapterPickerRef.current && !chapterPickerRef.current.contains(e.target as Node)) {
        setShowChapterPicker(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showChapterPicker]);

  const allBibleBooks = useMemo(() => [...OT_BOOKS, ...NT_BOOKS], []);
  const filteredPickerBooks = useMemo(() => {
    const q = chapterPickerSearch.trim().toLowerCase();
    if (!q) return allBibleBooks;
    return allBibleBooks.filter((b) => b.toLowerCase().includes(q));
  }, [allBibleBooks, chapterPickerSearch]);
  const previewBookChapterCount = BOOK_CHAPTERS[previewPickerBook] || 1;

  const [columnTranslations, setColumnTranslations] = useState<ColumnTranslations>(() =>
    normalizeColumnTranslations(
      initialPrefs.translations ?? (initialPrefs.translation ? [initialPrefs.translation] : undefined),
    ),
  );
  const initialOverlayMode: OverlayMode = (() => {
    const stored = initialPrefs.overlayMode;
    return stored === "fullscreen" || stored === "lower-third" ? stored : productionDefaults.defaultMode;
  })();
  const [fullscreenVerseLineCount, setFullscreenVerseLineCount] = useState(() =>
    clampVerseLineCount(initialPrefs.fullscreenVerseLineCount ?? (initialPrefs.overlayMode === "fullscreen" ? initialPrefs.verseLineCount : undefined) ?? 2)
  );
  const [lowerThirdVerseLineCount, setLowerThirdVerseLineCount] = useState(() =>
    clampVerseLineCount(initialPrefs.lowerThirdVerseLineCount ?? (initialPrefs.overlayMode === "lower-third" ? initialPrefs.verseLineCount : undefined) ?? 1)
  );
  const [verseLineCount, setVerseLineCount] = useState(() =>
    clampVerseLineCount(
      initialOverlayMode === "fullscreen"
        ? (initialPrefs.fullscreenVerseLineCount ?? (initialPrefs.overlayMode === "fullscreen" ? initialPrefs.verseLineCount : undefined) ?? 2)
        : (initialPrefs.lowerThirdVerseLineCount ?? (initialPrefs.overlayMode === "lower-third" ? initialPrefs.verseLineCount : undefined) ?? 1)
    )
  );
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, DOCK_SEARCH_DEBOUNCE_MS);
  const [selectedBibleTheme, setSelectedBibleTheme] = useState<BibleTheme>(
    productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0],
  );
  const [selectedLowerThirdTheme, setSelectedLowerThirdTheme] = useState<BibleTheme>(
    productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0],
  );
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(() => initialOverlayMode);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialCompareEnabled ? "compare" : "single");
  const [compareEnabled, setCompareEnabled] = useState(initialCompareEnabled);
  const [compareMode, setCompareMode] = useState<CompareMode>(initialCompareMode);
  const [compareLayout, setCompareLayout] = useState<CompareLayout>(initialPrefs.compareLayout ?? "line-by-line");
  const [referenceFormat, setReferenceFormat] = useState<BibleReferenceFormat>(
    () => sanitizeBibleReferenceFormat(initialPrefs.referenceFormat),
  );
  const [referenceVersionVisible, setReferenceVersionVisible] = useState(
    () => sanitizeReferenceVersionVisible(initialPrefs.referenceVersionVisible),
  );
  // Remembers Full / Short so "Show reference" in the output controls turns the
  // reference back on in the format the operator had chosen.
  const lastVisibleReferenceFormatRef = useRef<BibleReferenceFormat>(
    referenceFormat === "hidden" ? DEFAULT_BIBLE_REFERENCE_FORMAT : referenceFormat,
  );
  if (referenceFormat !== "hidden") lastVisibleReferenceFormatRef.current = referenceFormat;
  const [translationA, setTranslationA] = useState(initialPrefs.translationA ?? "KJV");
  const [translationB, setTranslationB] = useState(initialPrefs.translationB ?? "NIV");
  const [comparePassageDrafts, setComparePassageDrafts] = useState<ComparePassageDraft[]>(() =>
    normalizeComparePassageDrafts(initialPrefs.comparePassages, initialPrefs.translationA ?? "KJV", initialPrefs.translationB ?? "NIV"),
  );
  const [comparePassageNavigation, setComparePassageNavigation] = useState<ComparePassageNavigation>(
    initialPrefs.comparePassageNavigation === "independent" ? "independent" : "linked",
  );
  const [activeComparePassageIndex, setActiveComparePassageIndex] = useState(0);
  // Start with cached translations or bundled fallback for instant first paint.
  const [availableTranslations, setAvailableTranslations] = useState<BibleTranslationOption[]>(() =>
    readCachedTranslations(),
  );
  const [translationsLoaded, setTranslationsLoaded] = useState(true);
  const [preferencesHydrated, setPreferencesHydrated] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [keywordActionResult, setKeywordActionResult] = useState<Extract<DockBibleSearchOption, { kind: "keyword" | "concept" }> | null>(null);
  const [keywordMatchPushDirectlyToObs, setKeywordMatchPushDirectlyToObs] = useState(
    () => initialPrefs.keywordMatchPushDirectlyToObs === true,
  );

  useEffect(() => {
    const handleKeywordMatchPreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: unknown }>).detail;
      if (typeof detail?.enabled === "boolean") {
        setKeywordMatchPushDirectlyToObs(detail.enabled);
      }
    };

    window.addEventListener(DOCK_BIBLE_KEYWORD_MATCH_CHANGED_EVENT, handleKeywordMatchPreferenceChange);
    return () => window.removeEventListener(DOCK_BIBLE_KEYWORD_MATCH_CHANGED_EVENT, handleKeywordMatchPreferenceChange);
  }, []);

  const handleKeywordMatchDirectPushChange = useCallback((enabled: boolean) => {
    setKeywordMatchPushDirectlyToObs(enabled);
    updateDockBibleKeywordMatchPreference(enabled);
  }, []);

  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentBibleSearches());
  const [activeIdx, setActiveIdx] = useState(-1);
  const [keywordResults, setKeywordResults] = useState<BibleKeywordResult[]>([]);
  const [keywordResultsQuery, setKeywordResultsQuery] = useState("");
  const [isKeywordSearching, setIsKeywordSearching] = useState(false);
  const [, setVerseText] = useState<string | null>(null);
  const [verseCount, setVerseCount] = useState(30);
  const [voiceBible, setVoiceBible] = useState<VoiceBibleSnapshot>(
    () => initialVoiceBible ?? emptyVoiceBibleSnapshot(),
  );
  const [, setLiveTranscriptWords] = useState<LiveTranscriptWordChip[]>([]);
  const [modeMorphing] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsedState] = useState(
    () => readNativeDockSetting<boolean>("ocs-dock-bible-toolbar-collapsed") === true,
  );
  const setToolbarCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setToolbarCollapsedState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeNativeDockSetting("ocs-dock-bible-toolbar-collapsed", resolved);
      return resolved;
    });
  }, []);
  const [actionError, setActionError] = useState("");
  const [backgroundPreset, setBackgroundPreset] = useState<DockBackgroundPreset>(
    initialPrefs.backgroundPreset ?? "theme",
  );
  const [savedFullscreenQuickThemeSettings, setSavedFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(initialFullscreenQuickThemeSettings);
  const [fullscreenQuickThemeSettings, setFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(initialFullscreenQuickThemeSettings);
  const [savedLowerThirdQuickThemeSettings, setSavedLowerThirdQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(initialLowerThirdQuickThemeSettings);
  const [lowerThirdQuickThemeSettings, setLowerThirdQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(initialLowerThirdQuickThemeSettings);
  const [lowerThirdQuickThemeSettingsLinkedToFullscreen, setLowerThirdQuickThemeSettingsLinkedToFullscreen] =
    useState(false);
  const [sceneQuickThemeSettings, setSceneQuickThemeSettings] =
    useState<DockSceneQuickThemeSettings>(initialSceneQuickThemeSettings);
  const [chapterPassages, setChapterPassages] = useState<Array<BiblePassage | null>>(() => createEmptyPassages());
  const [comparePassages, setComparePassages] = useState<{ translationA: BiblePassage | null; translationB: BiblePassage | null }>(() => ({
    translationA: null,
    translationB: null,
  }));
  const [compareChapterLoading, setCompareChapterLoading] = useState(false);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterErrors, setChapterErrors] = useState<string[]>(() => createEmptyErrors());
  const [compareChapterErrors, setCompareChapterErrors] = useState<[string, string]>(["", ""]);
  const [comparePassagePreviews, setComparePassagePreviews] = useState<ComparePassagePreview[]>([]);
  const [highlightVerse, setHighlightVerse] = useState<number | null>(null);
  const [favoriteRefs, setFavoriteRefs] = useState<Set<string>>(new Set());
  const [favoritePassages, setFavoritePassages] = useState<BiblePassage[]>([]);
  const [favoriteHistorySearches, setFavoriteHistorySearches] = useState<BibleHistoryItem[]>(
    () => getFavoriteBibleHistoryItems(),
  );
  const favoriteSearches = useMemo(
    () => mergeFavoriteBibleSearches(favoritePassages, favoriteHistorySearches),
    [favoriteHistorySearches, favoritePassages],
  );
  const hasSavedSearches = recentSearches.length > 0 || favoriteSearches.length > 0;
  const refreshFavoriteHistorySearches = useCallback(() => {
    setFavoriteHistorySearches(getFavoriteBibleHistoryItems());
  }, []);
  const [isUtilityCollapsed, _setIsUtilityCollapsed] = useState(
    () => initialUiPrefs.controlsCollapsed ?? false,
  );
  const [bibleOverlayVisible, setBibleOverlayVisible] = useState(true);
  const [visibilityActionPending, setVisibilityActionPending] = useState(false);
  const [modeRefreshNonce, setModeRefreshNonce] = useState(0);
  const lastModeRefreshNonceRef = useRef(0);
  const liveVerseRequestIdRef = useRef(0);
  /** Invalidates in-flight pushes when Hide Bible is pressed. */
  const visibilityEpochRef = useRef(0);
  const visibilityActionInFlightRef = useRef(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const verseGridRef = useRef<HTMLDivElement>(null);
  const comparePopoverRef = useRef<HTMLDivElement>(null);
  const comparePopoverPanelRef = useRef<HTMLDivElement>(null);
  const browserFontSizePopoverRef = useRef<HTMLDivElement>(null);
  const [showComparePopover, setShowComparePopover] = useState(false);
  const [comparePopoverPosition, setComparePopoverPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [showBrowserFontSizePopover, setShowBrowserFontSizePopover] = useState(false);
  const [quickActionsTop, setQuickActionsTop] = useState(() =>
    clampQuickActionsTop(initialUiPrefs.quickActionsTop),
  );
  const [quickActionsLeft, setQuickActionsLeft] = useState<number | null>(() =>
    typeof initialUiPrefs.quickActionsLeft === "number"
      ? clampQuickActionsLeft(initialUiPrefs.quickActionsLeft)
      : null,
  );
  const [isQuickActionsDragging, setIsQuickActionsDragging] = useState(false);
  // Output changes always go live immediately (the "Update Immediately" + Save
  // step was removed from the output controls). An older saved "off" preference
  // is ignored so nobody is left with changes that never reach OBS.
  const [browserQuickUpdateImmediately, setBrowserQuickUpdateImmediately] = useState(true);
  const [draftBrowserQuickThemeSettings, setDraftBrowserQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [draftBrowserVerseLineCount, setDraftBrowserVerseLineCount] = useState<number | null>(null);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [historyItems, setHistoryItems] = useState<BibleHistoryItem[]>([]);
  const historyPopoverRef = useRef<HTMLDivElement>(null);
  const recordBibleHistory = useCallback((
    book: string,
    chapter: number,
    verse: number,
    verseText: string,
  ) => {
    window.setTimeout(() => {
      const updated = addToBibleHistory(book, chapter, verse, verseText);
      setHistoryItems(getRecentBibleHistoryItems(updated));
    }, 0);
  }, []);
  const voiceHeldRef = useRef(false);
  const voiceBridgeTimeoutRef = useRef<number | null>(null);
  const voiceFallbackReadyRef = useRef(false);
  const lastVoiceResultKeyRef = useRef(getVoiceBibleResultKey(initialVoiceBible?.lastResult));
  const lastVoiceEventTimestampRef = useRef(0);
  const pendingScrollVerseRef = useRef<number | null>(null);
  const prefsReadyRef = useRef(false);
  const previousStagedRef = useRef(staged);
  const latestStagedRef = useRef(staged);
  const manualReferenceSelectionRef = useRef(false);
  const overlayModeRef = useRef(overlayMode);
  const selectedBibleThemeRef = useRef(selectedBibleTheme);
  const selectedLowerThirdThemeRef = useRef(selectedLowerThirdTheme);
  const backgroundPresetRef = useRef(backgroundPreset);
  const liveFullscreenThemeSettingsRef = useRef<BibleThemeSettings | null>(null);
  const liveLowerThirdThemeSettingsRef = useRef<BibleThemeSettings | null>(null);
  const fullscreenLiveOverridesRef = useRef<Record<string, unknown> | null>(null);
  const sceneQuickThemeSettingsRef = useRef<DockSceneQuickThemeSettings>(initialSceneQuickThemeSettings);
  const manualThemeSettingsSelectionRef = useRef(false);
  const prefsSaveDebounceRef = useRef<number | null>(null);
  const liveTranscriptWordCounterRef = useRef(0);
  const lastTranscriptWordsRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickActionsContainerRef = useRef<HTMLElement>(null);
  const quickActionsTopRef = useRef(quickActionsTop);
  const quickActionsLeftRef = useRef<number | null>(quickActionsLeft);
  const quickActionsDragRef = useRef<QuickActionsDragState | null>(null);
  const quickActionsSuppressClickRef = useRef(false);
  const quickActionsLastSavedPositionRef = useRef("");
  const quickActionsNeedsInitialCenterRef = useRef(
    typeof initialUiPrefs.quickActionsTop !== "number" || !Number.isFinite(initialUiPrefs.quickActionsTop),
  );
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  const [themeSettingsInitialTab, setThemeSettingsInitialTab] = useState<ThemeSettingsTab>("text");
  const [activeSceneProfileId, setActiveSceneProfileId] = useState(GENERAL_SCENE_PROFILE_ID);
  const [showBibleHistory, setShowBibleHistory] = useState(false);
  const [showBibleActionsMenu, setShowBibleActionsMenu] = useState(false);
  const [showBibleMacrosModal, setShowBibleMacrosModal] = useState(false);

  useEffect(() => {
    if (showBibleHistory) {
      setShowBibleActionsMenu(false);
      setShowComparePopover(false);
      setVerseContextMenu(null);
    }
  }, [showBibleHistory]);
  const [pickerTab, setPickerTab] = useState<"book" | "chapter">("book");
  const [verseContextMenu, setVerseContextMenu] = useState<{ x: number; y: number; verse: number; text: string; selection: string } | null>(null);
  // Words coloured in verses, kept on this computer. The ref lets the "go live" code read the newest list.
  const [verseHighlights, setVerseHighlights] = useState<Record<string, VerseHighlight[]>>(loadVerseHighlights);
  // Where the mouse button went down: a click that ends far from there was a drag (selecting words), not a click.
  const verseMouseDownAtRef = useRef<{ x: number; y: number } | null>(null);
  // Highlight word picker in the verse menu: the first and last word chosen (indexes into the verse's words).
  const [wordPick, setWordPick] = useState<{ open: boolean; from: number | null; to: number | null }>({ open: false, from: null, to: null });
  const verseHighlightsRef = useRef(verseHighlights);
  verseHighlightsRef.current = verseHighlights;
  const [compareVersesModal, setCompareVersesModal] = useState<{ book: string; chapter: number; verse: number } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"success" | "error" | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  // ── Height-responsive compact mode ──
  const [containerHeight, setContainerHeight] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 600));
  const [containerWidth, setContainerWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 800));
  const [isShortHeight, setIsShortHeight] = useState(() => {
    const el = containerRef.current;
    return el ? el.clientHeight <= 520 : false;
  });
  const [isNarrowWidth, setIsNarrowWidth] = useState(false);
  const [isUltraNarrowWidth, setIsUltraNarrowWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 340 : false));
  const [isSub300Width, setIsSub300Width] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 300 : false));
  const [showAllFavoritesModal, setShowAllFavoritesModal] = useState(false);
  const [showChapterBarMenu, setShowChapterBarMenu] = useState(false);
  const chapterBarActionsRef = useRef<HTMLDivElement | null>(null);

  const isConstrained = containerWidth <= 400 || containerHeight < 450 || (typeof window !== "undefined" && (window.innerWidth <= 400 || window.innerHeight < 450));

  const _fsThemeDepId = productionDefaults.fullscreenTheme?.id;
  const _ltThemeDepId = productionDefaults.lowerThirdTheme?.id;

  useEffect(() => {
    quickActionsTopRef.current = quickActionsTop;
  }, [quickActionsTop]);

  useEffect(() => {
    quickActionsLeftRef.current = quickActionsLeft;
  }, [quickActionsLeft]);

  useEffect(() => {
    const element = containerRef.current;
    const quickActionsContainer = quickActionsContainerRef.current;
    if (!element || !quickActionsContainer) return;

    const syncLayout = (target: Element, height: number, width: number) => {
      if (target === element) {
        setContainerHeight(height);
        setContainerWidth(width);
        setIsShortHeight(height <= 520);
        setIsNarrowWidth(width < 400);
        setIsUltraNarrowWidth(width <= 340);
        setIsSub300Width(width <= 300);
        return;
      }

      if (quickActionsDragRef.current) return;

      if (quickActionsNeedsInitialCenterRef.current && height > QUICK_ACTIONS_HANDLE_HEIGHT) {
        const centeredTop = getDefaultQuickActionsTop(height);
        quickActionsNeedsInitialCenterRef.current = false;
        quickActionsTopRef.current = centeredTop;
        setQuickActionsTop(centeredTop);
      } else {
        setQuickActionsTop((current) => clampQuickActionsTop(current, height));
      }
      setQuickActionsLeft((current) => current === null ? null : snapQuickActionsLeft(current, width));
    };

    syncLayout(element, element.clientHeight, element.clientWidth);
    syncLayout(quickActionsContainer, quickActionsContainer.clientHeight, quickActionsContainer.clientWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        syncLayout(entry.target, entry.contentRect.height, entry.contentRect.width);
      }
    });

    observer.observe(element);
    observer.observe(quickActionsContainer);
    return () => observer.disconnect();
  }, [preferencesHydrated, translationsLoaded]);

  // The bottom-search layout nests Compare inside the toolbar overflow menu.
  // Position the open card against the full toolbar instead of the tiny menu
  // row so it stays visible above the Bible reader and below the viewport edge.
  useLayoutEffect(() => {
    if (!showComparePopover) {
      setComparePopoverPosition(null);
      return;
    }

    const owner = comparePopoverRef.current;
    const toolbar = owner?.closest<HTMLElement>(".dock-btm-toolbar")
      ?? (typeof document !== "undefined" ? document.querySelector<HTMLElement>(".dock-btm-toolbar") : null);
    const panel = comparePopoverPanelRef.current;
    const trigger = owner?.querySelector<HTMLButtonElement>("button");
    if (!panel) return;

    let frame = 0;
    const updatePosition = () => {

      const anchorRect = (trigger ?? toolbar)?.getBoundingClientRect();
      if (!anchorRect) return;
      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
      const viewportPadding = 8;
      const gap = 8;
      const width = Math.min(320, Math.max(240, viewportWidth - viewportPadding * 2));
      const panelHeight = Math.max(panel.scrollHeight || 0, panelRect.height || 0, 420);
      const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - viewportPadding);
      const spaceAbove = Math.max(0, anchorRect.top - gap - viewportPadding);
      const isBottomAnchor = Boolean(toolbar && !trigger);
      const openAbove = isBottomAnchor
        || (spaceBelow < Math.min(panelHeight, 380) && spaceAbove > spaceBelow);
      const availableHeight = openAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(
        220,
        Math.min(640, viewportHeight - viewportPadding * 2, availableHeight),
      );
      const height = Math.min(panelHeight, maxHeight);
      const preferredTop = openAbove
        ? anchorRect.top - gap - height
        : anchorRect.bottom + gap;
      const top = Math.max(
        56,
        Math.min(preferredTop, viewportHeight - viewportPadding - height),
      );
      const left = Math.max(
        viewportPadding,
        Math.min(anchorRect.right - width, viewportWidth - width - viewportPadding),
      );

      setComparePopoverPosition((current) => (
        current?.top === top
          && current.left === left
          && current.width === width
          && current.maxHeight === maxHeight
          ? current
          : { top, left, width, maxHeight }
      ));
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver !== "undefined" && comparePopoverRef.current
      ? new ResizeObserver(scheduleUpdate)
      : null;
    if (resizeObserver) {
      if (toolbar) resizeObserver.observe(toolbar);
      if (trigger) resizeObserver.observe(trigger);
      if (panel) resizeObserver.observe(panel);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [compareEnabled, compareMode, searchPlacement, showComparePopover]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  // Signal compact mode to parent shell via body class
  useEffect(() => {
    document.body.classList.toggle("dock-bible-compact", isShortHeight);
    return () => document.body.classList.remove("dock-bible-compact");
  }, [isShortHeight]);

  // Sync external showHistory prop with local state
  useEffect(() => {
    if (showHistory !== undefined) setShowBibleHistory(showHistory);
  }, [showHistory]);

  // Keep overlayModeRef in sync for callbacks that must not depend on overlayMode
  useEffect(() => {
    overlayModeRef.current = overlayMode;
  }, [overlayMode]);

  const [showSearchBar, _setShowSearchBar] = useState(true);
  const activeColumnIndex = Math.min(Math.max(selectedColumn, 0), QUICK_SELECT_VERSION_COUNT - 1);
  const activeTranslation = columnTranslations[activeColumnIndex] ?? columnTranslations[0];
  const activeBibleSearchTranslation = compareEnabled && compareMode === "passages"
    ? (comparePassageDrafts[activeComparePassageIndex]?.translation ?? activeTranslation)
    : activeTranslation;
  const quickTranslations = useMemo(
    () => columnTranslations.slice(0, QUICK_SELECT_VERSION_COUNT),
    [columnTranslations],
  );
  const activeChapterPassage = chapterPassages[activeColumnIndex] ?? null;
  const getLoadedPassageForTranslation = useCallback((translation: string): BiblePassage | null => {
    const normalized = translation.toUpperCase();
    const quickIndex = columnTranslations.findIndex((value) => value.toUpperCase() === normalized);
    if (quickIndex >= 0) {
      return chapterPassages[quickIndex] ?? null;
    }
    if (translationA.toUpperCase() === normalized) {
      return comparePassages.translationA ?? null;
    }
    if (translationB.toUpperCase() === normalized) {
      return comparePassages.translationB ?? null;
    }
    return null;
  }, [chapterPassages, columnTranslations, comparePassages.translationA, comparePassages.translationB, translationA, translationB]);
  const selectedPassageForFavorite = useMemo(() => {
    if (!selectedBook || !selectedChapter || !selectedVerse || !activeChapterPassage) {
      return null;
    }

    const startIndex = activeChapterPassage.verses.findIndex((entry) => entry.verse === selectedVerse);
    if (startIndex === -1) {
      return null;
    }

    const selection = activeChapterPassage.verses.slice(
      startIndex,
      startIndex + clampVerseLineCount(verseLineCount),
    );
    if (selection.length === 0) {
      return null;
    }

    const endVerse = selection[selection.length - 1]?.verse ?? selectedVerse;
    const verseRange = endVerse === selectedVerse ? `${selectedVerse}` : `${selectedVerse}-${endVerse}`;

    return {
      ...activeChapterPassage,
      reference: `${selectedBook} ${selectedChapter}:${verseRange}`,
      startVerse: selectedVerse,
      endVerse,
      verses: selection,
      translation: activeTranslation,
    } satisfies BiblePassage;
  }, [
    activeChapterPassage,
    activeTranslation,
    selectedBook,
    selectedChapter,
    selectedVerse,
    verseLineCount,
  ]);
  const isCurrentPassageFavorite = selectedPassageForFavorite
    ? favoriteRefs.has(selectedPassageForFavorite.reference)
    : false;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const insideComparePopover = comparePopoverRef.current?.contains(event.target as Node)
        || comparePopoverPanelRef.current?.contains(event.target as Node)
        || Boolean((event.target as HTMLElement)?.closest?.('[data-dock-compare-trigger="true"]'));
      if (!insideComparePopover) {
        setShowComparePopover(false);
        setShowBibleActionsMenu(false);
      }
      if (chapterBarActionsRef.current && !chapterBarActionsRef.current.contains(event.target as Node)) {
        setShowChapterBarMenu(false);
      }
      if (browserFontSizePopoverRef.current && !browserFontSizePopoverRef.current.contains(event.target as Node)) {
        setShowBrowserFontSizePopover(false);
      }
      if (historyPopoverRef.current && !historyPopoverRef.current.contains(event.target as Node)) {
        setShowHistoryDropdown(false);
      }
      setVerseContextMenu(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const transcript = voiceBible.transcript?.trim() ?? "";
    if (!transcript) {
      return;
    }

    const nextWords = splitTranscriptStackWords(transcript);
    if (nextWords.length === 0) {
      return;
    }

    const appendedWords = extractTranscriptWordTail(
      lastTranscriptWordsRef.current,
      nextWords,
    );
    lastTranscriptWordsRef.current = nextWords;

    if (appendedWords.length === 0) {
      return;
    }

    setLiveTranscriptWords((current) => {
      const next = [...current];
      for (const word of appendedWords) {
        const absoluteIndex = liveTranscriptWordCounterRef.current;
        next.push({
          id: `voice-word-${absoluteIndex}-${word}`,
          text: word,
          lane: absoluteIndex % 2 === 0 ? "start" : "end",
        });
        liveTranscriptWordCounterRef.current += 1;
      }
      return next.slice(-28);
    });
  }, [voiceBible.transcript]);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void getFavorites()
        .then((favorites) => {
          if (cancelled) return;
          setFavoriteRefs(new Set(favorites.map((passage) => passage.reference)));
          setFavoritePassages(favorites);
          setFavoriteHistorySearches(getFavoriteBibleHistoryItems());
        })
        .catch(() => {
          if (!cancelled) {
            setFavoriteRefs(new Set());
            setFavoritePassages([]);
            setFavoriteHistorySearches(getFavoriteBibleHistoryItems());
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    prefsReadyRef.current = false;
    let cancelled = false;
    const hydratePreferences = async () => {
      // Read IndexedDB before marking the component ready. This prevents the
      // first render's production defaults from being written over a saved
      // style while the durable store is still opening.
      const prefs = (await loadDockPreference<DockBiblePreferences>(DOCK_BIBLE_PREFS_KEY).catch(() => null))
        ?? loadDockBiblePreferences();
      if (cancelled) return;

      const initialBook =
        prefs.selectedBook && BOOK_CHAPTERS[prefs.selectedBook]
          ? prefs.selectedBook
          : (OT_BOOKS[0] ?? null);
      const maxInitialChapter = initialBook ? (BOOK_CHAPTERS[initialBook] ?? 1) : 1;
      const initialChapter = Math.min(
        Math.max(prefs.selectedChapter ?? 1, 1),
        maxInitialChapter,
      );
      const preserveManualThemeSelection = manualThemeSettingsSelectionRef.current;
      if (!preserveManualThemeSelection) {
        setSelectedBibleTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
        setSelectedLowerThirdTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
      }
      setOverlayMode(prefs.overlayMode ?? productionDefaults.defaultMode);
      const restoredCompareEnabled = resolveInitialDockBibleCompareEnabled(prefs);
      setCompareEnabled(restoredCompareEnabled);
      setDisplayMode(restoredCompareEnabled ? "compare" : "single");
      setCompareMode(prefs.compareMode === "passages" ? "passages" : "translations");
      setCompareLayout(prefs.compareLayout ?? "line-by-line");
      setReferenceFormat(sanitizeBibleReferenceFormat(prefs.referenceFormat));
      setReferenceVersionVisible(sanitizeReferenceVersionVisible(prefs.referenceVersionVisible));
      setKeywordMatchPushDirectlyToObs(prefs.keywordMatchPushDirectlyToObs === true);
      setTranslationA(prefs.translationA ?? "KJV");
      setTranslationB(prefs.translationB ?? "NIV");
      setComparePassageDrafts(
        normalizeComparePassageDrafts(prefs.comparePassages, prefs.translationA ?? "KJV", prefs.translationB ?? "NIV"),
      );
      setComparePassageNavigation(prefs.comparePassageNavigation === "independent" ? "independent" : "linked");
      setActiveComparePassageIndex(0);
      setComparePassagePreviews([]);
      setColumnTranslations(
        normalizeColumnTranslations(
          prefs.translations ?? (prefs.translation ? [prefs.translation] : undefined),
        ),
      );
      const reloadedOverlayMode = prefs.overlayMode ?? productionDefaults.defaultMode;
      const reloadedFsLines = clampVerseLineCount(prefs.fullscreenVerseLineCount ?? (prefs.overlayMode === "fullscreen" ? prefs.verseLineCount : undefined) ?? 2);
      const reloadedLtLines = clampVerseLineCount(prefs.lowerThirdVerseLineCount ?? (prefs.overlayMode === "lower-third" ? prefs.verseLineCount : undefined) ?? 1);
      setFullscreenVerseLineCount(reloadedFsLines);
      setLowerThirdVerseLineCount(reloadedLtLines);
      setVerseLineCount(reloadedOverlayMode === "fullscreen" ? reloadedFsLines : reloadedLtLines);
      setBackgroundPreset(prefs.backgroundPreset ?? "theme");
      const storedQuickSettings = sanitizeFullscreenQuickThemeSettings(
        prefs.fullscreenQuickThemeSettings,
      );
      const rawStoredLowerThirdQuickSettings = sanitizeFullscreenQuickThemeSettings(
        prefs.lowerThirdQuickThemeSettings,
        "lower-third",
      );
      const storedLowerThirdQuickSettings = rawStoredLowerThirdQuickSettings;
      const storedSceneQuickThemeSettings = sanitizeSceneQuickThemeSettings(
        prefs.sceneQuickThemeSettings,
      );
      sceneQuickThemeSettingsRef.current = storedSceneQuickThemeSettings;
      setSceneQuickThemeSettings(storedSceneQuickThemeSettings);
      if (!preserveManualThemeSelection) {
        setSavedFullscreenQuickThemeSettings(storedQuickSettings);
        setFullscreenQuickThemeSettings(storedQuickSettings);
        setSavedLowerThirdQuickThemeSettings(storedLowerThirdQuickSettings);
        setLowerThirdQuickThemeSettings(storedLowerThirdQuickSettings);
        setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
      }
      // Preserve a reference selected while IndexedDB preferences are
      // hydrating; otherwise the chapter arrows can snap back to the old
      // saved chapter immediately after the operator clicks them.
      if (!manualReferenceSelectionRef.current) {
        setSelectedBook(initialBook);
        selectedChapterRef.current = initialBook ? initialChapter : null;
        setSelectedChapter(initialBook ? initialChapter : null);
        setSelectedVerse(resolveSavedVerse(initialBook, initialBook ? initialChapter : null, prefs.selectedVerse));
        setSelectedColumn(0);
      }

      const allFavorites = await loadDockFavoriteBibleThemes();

      if (cancelled) return;

      const storedFullscreen = allFavorites.find(
        (theme) => theme.id === prefs.fullscreenThemeId
          && themeSupportsBibleOverlayMode(theme, "fullscreen"),
      );
      const storedLowerThird = allFavorites.find(
        (theme) => theme.id === prefs.lowerThirdThemeId
          && themeSupportsBibleOverlayMode(theme, "lower-third"),
      );

      if (storedFullscreen && !preserveManualThemeSelection) {
        setSelectedBibleTheme(storedFullscreen);
      }

      if (storedLowerThird && !preserveManualThemeSelection) {
        setSelectedLowerThirdTheme(storedLowerThird);
      }

      prefsReadyRef.current = true;
      setPreferencesHydrated(true);
    };

    const timer = window.setTimeout(() => {
      void hydratePreferences().catch(() => {
        if (!cancelled) prefsReadyRef.current = true;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    productionDefaults.defaultMode,
    _fsThemeDepId,
    _ltThemeDepId,
  ]);

  useEffect(() => () => {
    if (prefsSaveDebounceRef.current !== null) {
      window.clearTimeout(prefsSaveDebounceRef.current);
    }
  }, []);

  useEffect(() => {
    if (!prefsReadyRef.current || !translationsLoaded) return;
    if (prefsSaveDebounceRef.current !== null) {
      window.clearTimeout(prefsSaveDebounceRef.current);
    }
    prefsSaveDebounceRef.current = window.setTimeout(() => {
      prefsSaveDebounceRef.current = null;
      saveDockBiblePreferences({
        overlayMode,
        displayMode,
        translation: activeTranslation,
        translations: [...columnTranslations],
        translationA,
        translationB,
        compareEnabled,
        compareMode,
        compareLayout,
        comparePassages: comparePassageDrafts.map(({ reference, translation }) => ({ reference, translation })),
        comparePassageNavigation,
        referenceFormat,
        referenceVersionVisible,
        keywordMatchPushDirectlyToObs,
        verseLineCount,
        fullscreenVerseLineCount,
        lowerThirdVerseLineCount,
        fullscreenThemeId: selectedBibleTheme.id,
        lowerThirdThemeId: selectedLowerThirdTheme.id,
        backgroundPreset,
        fullscreenQuickThemeSettings: savedFullscreenQuickThemeSettings,
        lowerThirdQuickThemeSettings: savedLowerThirdQuickThemeSettings,
        lowerThirdQuickThemeSettingsLinkedToFullscreen,
        sceneQuickThemeSettings,
        selectedBook: selectedBook ?? undefined,
        selectedChapter: selectedChapter ?? undefined,
        selectedVerse: selectedVerse ?? undefined,
      });
    }, 300);
  }, [
    activeTranslation,
    backgroundPreset,
    displayMode,
    translationA,
    translationB,
    compareEnabled,
    compareMode,
    compareLayout,
    comparePassageDrafts,
    comparePassageNavigation,
    keywordMatchPushDirectlyToObs,
    referenceFormat,
    referenceVersionVisible,
    savedLowerThirdQuickThemeSettings,
    lowerThirdQuickThemeSettingsLinkedToFullscreen,
    sceneQuickThemeSettings,
    columnTranslations,
    overlayMode,
    savedFullscreenQuickThemeSettings,
    verseLineCount,
    fullscreenVerseLineCount,
    lowerThirdVerseLineCount,
    selectedBibleTheme.id,
    selectedBook,
    selectedChapter,
    selectedLowerThirdTheme.id,
    selectedVerse,
    translationsLoaded,
  ]);

  useEffect(() => {
    saveDockBibleUiPreferencePatch({
      controlsCollapsed: isUtilityCollapsed,
    });
  }, [isUtilityCollapsed]);

  // `quick` (first open only): use the small shared list instead of reading every installed Bible.
  // Later reloads, e.g. after a download, read the full list so a new Bible always shows up.
  const loadTranslations = useCallback(async (quick = false) => {
    const loadLocalTranslations = async (): Promise<boolean> => {
      try {
        const { getInstalledTranslations, getInstalledTranslationsFast } = await import("../../bible/bibleDb");
        const installed = quick ? await getInstalledTranslationsFast() : await getInstalledTranslations();
        if (installed.length === 0) return false;
        const options = buildInstalledTranslationOptions(installed);
        setAvailableTranslations(options);
        writeCachedTranslations(options);
        return true;
      } catch {
        return false;
      }
    };

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      if (await loadLocalTranslations()) return;
    }

    // The installed translation database is authoritative on the localhost
    // Dock too. The published manifest is only a fallback for a browser that
    // has no local translation database yet; using it first can restore an
    // old/default version during startup.
    if (await loadLocalTranslations()) return;

    try {
      // The local overlay server exposes this user-specific manifest after the
      // main app syncs installed translations to the Dock. Do not let a cached
      // manifest reintroduce a version the user has already removed.
      const remote = await fetch(`/uploads/dock-bible-translations.json?cacheBust=${Date.now()}`, {
        cache: "no-store",
      });
      if (remote.ok) {
        const payload = await remote.json() as Array<{ abbr?: string; name?: string; language?: string }>;
        if (Array.isArray(payload)) {
          const options = buildInstalledTranslationOptions(payload);
          setAvailableTranslations(options);
          writeCachedTranslations(options);
          return;
        }
      }
    } catch {
      // Fall through to local IndexedDB fallback.
    }

    if (!(await loadLocalTranslations())) {
      setAvailableTranslations((current) => (current.length > 0 ? current : [DEFAULT_INSTALLED_TRANSLATION_OPTION]));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadTranslations(true)
        .catch(() => {
          if (!cancelled) {
            setAvailableTranslations((current) => (current.length > 0 ? current : [DEFAULT_INSTALLED_TRANSLATION_OPTION]));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setTranslationsLoaded(true);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadTranslations]);

  useEffect(() => {
    if (!translationsLoaded) return;

    const firstTranslation = resolveInstalledTranslation(undefined, availableTranslations);
    const nextTranslationA = resolveInstalledTranslation(translationA, availableTranslations);
    const alternateTranslation = availableTranslations.find(
      (entry) => entry.value.toUpperCase() !== nextTranslationA,
    )?.value ?? nextTranslationA;
    const nextTranslationB = resolveInstalledTranslation(
      translationB,
      availableTranslations,
      alternateTranslation,
    );

    setTranslationA((current) => current.toUpperCase() === nextTranslationA ? current : nextTranslationA);
    setTranslationB((current) => current.toUpperCase() === nextTranslationB ? current : nextTranslationB);

    setColumnTranslations((current) => {
      const next = current.map((value) =>
        resolveInstalledTranslation(value, availableTranslations, firstTranslation),
      );
      return current.every((value, index) => value === next[index]) ? current : next;
    });

    setComparePassageDrafts((current) => {
      let changed = false;
      const next = current.map((draft, index) => {
        const fallback = index === 0 ? nextTranslationA : nextTranslationB;
        const translation = resolveInstalledTranslation(draft.translation, availableTranslations, fallback);
        if (translation === draft.translation) return draft;
        changed = true;
        return { ...draft, translation };
      });
      return changed ? next : current;
    });
  }, [availableTranslations, comparePassageDrafts, columnTranslations, translationA, translationB, translationsLoaded]);

  // Resolve the base theme for each mode from the unified theme's variants
  const baseFullscreenTheme = useMemo(() => {
    return resolveThemeForOverlayMode(selectedBibleTheme, "fullscreen");
  }, [selectedBibleTheme]);

  const baseLowerThirdTheme = useMemo(() => {
    return resolveThemeForOverlayMode(selectedLowerThirdTheme, "lower-third");
  }, [selectedLowerThirdTheme]);

  const effectiveSelectedBibleTheme = useMemo(
    () =>
      applyFullscreenQuickThemeSettings(
        baseFullscreenTheme,
        fullscreenQuickThemeSettings,
      ),
    [fullscreenQuickThemeSettings, baseFullscreenTheme],
  );

  const activeFullscreenQuickThemeSettings = useMemo(
    () => {
      const extracted = extractFullscreenQuickThemeSettings(effectiveSelectedBibleTheme.settings, fullscreenQuickThemeSettings?.backgroundType ?? "theme");
      return extracted;
    },
    [effectiveSelectedBibleTheme.settings, fullscreenQuickThemeSettings],
  );

  const defaultFullscreenQuickThemeSettings = useMemo(
    () => extractFullscreenQuickThemeSettings(baseFullscreenTheme.settings, "theme"),
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

  const effectiveSelectedLowerThirdTheme = useMemo(() => {
    return applyLowerThirdQuickThemeSettings(
      baseLowerThirdTheme,
      effectiveLowerThirdQuickThemeSettings,
    );
  }, [baseLowerThirdTheme, effectiveLowerThirdQuickThemeSettings]);

  const activeLowerThirdQuickThemeSettings = useMemo(
    () => extractFullscreenQuickThemeSettings(
      effectiveSelectedLowerThirdTheme.settings,
      effectiveLowerThirdQuickThemeSettings.backgroundType ?? defaultLowerThirdQuickThemeSettings.backgroundType,
    ),
    [
      defaultLowerThirdQuickThemeSettings.backgroundType,
      effectiveLowerThirdQuickThemeSettings.backgroundType,
      effectiveSelectedLowerThirdTheme.settings,
    ],
  );

  const quickEditOverlayMode: OverlayMode = fullscreenOnlyMode || overlayMode === "fullscreen"
    ? "fullscreen"
    : "lower-third";
  const sceneProfileOptions = useMemo<DockThemeSceneProfile[] | undefined>(() => {
    if (!hasSceneRoute) return undefined;
    return [
      ...sceneRoute.targets.map((target) => ({ id: target.sceneName, label: target.sceneName })),
      { id: GENERAL_SCENE_PROFILE_ID, label: "General" },
    ];
  }, [hasSceneRoute, sceneRoute.targets]);
  const availableSceneProfileIds = useMemo(
    () => new Set((sceneProfileOptions ?? []).map((profile) => profile.id)),
    [sceneProfileOptions],
  );

  useEffect(() => {
    if (activeSceneProfileId !== GENERAL_SCENE_PROFILE_ID && !availableSceneProfileIds.has(activeSceneProfileId)) {
      setActiveSceneProfileId(GENERAL_SCENE_PROFILE_ID);
    }
  }, [activeSceneProfileId, availableSceneProfileIds]);

  const isSceneProfileActive = activeSceneProfileId !== GENERAL_SCENE_PROFILE_ID
    && availableSceneProfileIds.has(activeSceneProfileId);
  const activeSceneProfile = isSceneProfileActive
    ? sceneQuickThemeSettings[activeSceneProfileId] ?? null
    : null;
  const activeQuickEditSettings = isSceneProfileActive
    ? (quickEditOverlayMode === "fullscreen"
      ? (activeSceneProfile?.fullscreen ?? activeFullscreenQuickThemeSettings)
      : (activeSceneProfile?.lowerThird ?? activeLowerThirdQuickThemeSettings))
    : (quickEditOverlayMode === "fullscreen"
      ? activeFullscreenQuickThemeSettings
      : activeLowerThirdQuickThemeSettings);
  const activeQuickEditThemeId = isSceneProfileActive
    ? (quickEditOverlayMode === "fullscreen"
      ? (activeSceneProfile?.fullscreenThemeId ?? selectedBibleTheme.id)
      : (activeSceneProfile?.lowerThirdThemeId ?? selectedLowerThirdTheme.id))
    : (quickEditOverlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id);

  // Keep a synchronous copy for a verse navigation event that happens in the
  // same turn as a quick-setting click. The rendered state will catch up on
  // the next render, but the live sender must never fall back to the theme's
  // original defaults in that small window.
  useEffect(() => {
    liveFullscreenThemeSettingsRef.current = effectiveSelectedBibleTheme.settings;
  }, [effectiveSelectedBibleTheme]);
  useEffect(() => {
    liveLowerThirdThemeSettingsRef.current = effectiveSelectedLowerThirdTheme.settings;
  }, [effectiveSelectedLowerThirdTheme]);

  const fullscreenLiveOverrides = useMemo(
    () => buildFullscreenLiveOverridesForQuickSettings(
      effectiveSelectedBibleTheme.settings,
      backgroundPreset,
      fullscreenQuickThemeSettings?.backgroundType,
    ),
    [backgroundPreset, effectiveSelectedBibleTheme.settings, fullscreenQuickThemeSettings?.backgroundType],
  );

  useEffect(() => {
    fullscreenLiveOverridesRef.current = fullscreenLiveOverrides as Record<string, unknown> | null;
  }, [fullscreenLiveOverrides]);

  // Keep other dock tabs (especially LM) aligned with the Bible tab's live
  // background. Saved preferences can lag briefly while a quick setting is
  // being edited, so publish the effective theme snapshot as well.
  useEffect(() => {
    dockClient.sendState({
      type: "state:bible-theme-updated",
      payload: {
        fullscreen: {
          themeId: effectiveSelectedBibleTheme.id,
          themeSettings: effectiveSelectedBibleTheme.settings,
          liveOverrides: fullscreenLiveOverrides,
        },
        lowerThird: {
          themeId: effectiveSelectedLowerThirdTheme.id,
          themeSettings: effectiveSelectedLowerThirdTheme.settings,
          liveOverrides: null,
        },
        // Everything else LM needs to project a verse the same way this tab
        // does: the mode in use right now, the verse line count per mode and
        // how the reference is written. `updatedAt` lets LM pick the newest
        // copy when it also has one stored locally.
        overlayMode: fullscreenOnlyMode ? "fullscreen" : overlayMode,
        fullscreenLineCount: fullscreenVerseLineCount,
        lowerThirdLineCount: lowerThirdVerseLineCount,
        referenceFormat,
        referenceVersionVisible,
        updatedAt: Date.now(),
      },
      timestamp: Date.now(),
    });
  }, [
    effectiveSelectedBibleTheme,
    effectiveSelectedLowerThirdTheme,
    fullscreenLiveOverrides,
    fullscreenOnlyMode,
    overlayMode,
    fullscreenVerseLineCount,
    lowerThirdVerseLineCount,
    referenceFormat,
    referenceVersionVisible,
  ]);

  const persistDockBiblePreferencesNow = useCallback((overrides: Partial<DockBiblePreferences> = {}) => {
    if (prefsSaveDebounceRef.current !== null) {
      window.clearTimeout(prefsSaveDebounceRef.current);
      prefsSaveDebounceRef.current = null;
    }
    saveDockBiblePreferences({
      overlayMode: overlayModeRef.current,
      displayMode,
      translation: activeTranslation,
      translations: [...columnTranslations],
      translationA,
      translationB,
      compareEnabled,
      compareMode,
      compareLayout,
      comparePassages: comparePassageDrafts.map(({ reference, translation }) => ({ reference, translation })),
      comparePassageNavigation,
      referenceFormat,
      referenceVersionVisible,
      keywordMatchPushDirectlyToObs,
      verseLineCount,
      fullscreenVerseLineCount,
      lowerThirdVerseLineCount,
      fullscreenThemeId: selectedBibleThemeRef.current.id,
      lowerThirdThemeId: selectedLowerThirdThemeRef.current.id,
      backgroundPreset: backgroundPresetRef.current,
      fullscreenQuickThemeSettings: savedFullscreenQuickThemeSettings,
      lowerThirdQuickThemeSettings: savedLowerThirdQuickThemeSettings,
      lowerThirdQuickThemeSettingsLinkedToFullscreen,
      sceneQuickThemeSettings,
      selectedBook: selectedBook ?? undefined,
      selectedChapter: selectedChapter ?? undefined,
      // When the book or chapter is being changed, the verse in this closure belongs to the old
      // chapter, so it is left out. The debounced save above stores the right one right after.
      selectedVerse: ("selectedBook" in overrides || "selectedChapter" in overrides)
        ? undefined
        : (selectedVerse ?? undefined),
      ...overrides,
    });
  }, [
    activeTranslation,
    columnTranslations,
    compareEnabled,
    compareMode,
    compareLayout,
    comparePassageDrafts,
    comparePassageNavigation,
    keywordMatchPushDirectlyToObs,
    displayMode,
    referenceFormat,
    referenceVersionVisible,
    lowerThirdQuickThemeSettingsLinkedToFullscreen,
    savedFullscreenQuickThemeSettings,
    savedLowerThirdQuickThemeSettings,
    sceneQuickThemeSettings,
    selectedBook,
    selectedChapter,
    selectedVerse,
    translationA,
    translationB,
    verseLineCount,
    fullscreenVerseLineCount,
    lowerThirdVerseLineCount,
  ]);

  const handleBackgroundPresetChange = useCallback((preset: DockBackgroundPreset) => {
    backgroundPresetRef.current = preset;
    setBackgroundPreset(preset);
  }, []);

  // ── Fetch verse count when chapter changes ──
  useEffect(() => {
    if (!translationsLoaded || !selectedBook || !selectedChapter) { setVerseCount(30); return; }
    let cancelled = false;
    (async () => {
      try {
        const { getVerseCount } = await import("../../bible/bibleData");
        const count = await getVerseCount(selectedBook, selectedChapter, activeTranslation);
        if (!cancelled) setVerseCount(count || 30);
      } catch { if (!cancelled) setVerseCount(30); }
    })();
    return () => { cancelled = true; };
  }, [activeTranslation, selectedBook, selectedChapter, translationsLoaded]);

  // ── Fetch actual verse text helper ──
  const fetchVerseText = useCallback(async (book: string, chapter: number, verse: number, trans: string): Promise<string> => {
    try {
      const { getVerse } = await import("../../bible/bibleData");
      const result = await getVerse(book, chapter, verse, trans);
      if (result?.text && result.text.trim()) {
        return result.text.trim();
      }
      console.warn(`[DockBibleTab] getVerse returned no text for ${book} ${chapter}:${verse} (${trans})`);
    } catch (err) {
      console.error(`[DockBibleTab] fetchVerseText failed for ${book} ${chapter}:${verse} (${trans}):`, err);
    }
    // Fallback: If requested translation failed to provide text, try fallback to KJV
    try {
      const { getVerse } = await import("../../bible/bibleData");
      const fallbackResult = await getVerse(book, chapter, verse, "KJV");
      if (fallbackResult?.text && fallbackResult.text.trim()) {
        return fallbackResult.text.trim();
      }
    } catch {
      // Ignore fallback failure
    }
    return "";
  }, []);

  const focusReference = useCallback((
    book: string,
    chapter: number,
    verse?: number | null,
    options?: { reveal?: boolean },
  ) => {
    manualReferenceSelectionRef.current = true;
    setSelectedBook(book);
    selectedChapterRef.current = chapter;
    setSelectedChapter(chapter);
    const maxV = getCanonicalVerseCount(book, chapter);
    const safeVerse =
      typeof verse === "number" && maxV !== null && verse > maxV
        ? maxV
        : (verse ?? null);
    setSelectedVerse(safeVerse);
    pendingScrollVerseRef.current = options?.reveal === false ? null : safeVerse;
  }, []);

  const focusReferenceWithoutReload = useCallback((
    _book: string,
    _chapter: number,
    verse: number | null,
    options?: { reveal?: boolean },
  ) => {
    setSelectedVerse(verse);
    pendingScrollVerseRef.current = options?.reveal === false ? null : verse;
  }, []);

  useEffect(() => {
    if (!translationsLoaded || !selectedBook || !selectedChapter) {
      setChapterPassages(createEmptyPassages());
      setChapterLoading(false);
      setChapterErrors(createEmptyErrors());
      return;
    }

    let cancelled = false;
    setChapterLoading(true);
    setChapterErrors(createEmptyErrors());
    (async () => {
      try {
        const { getChapter } = await import("../../bible/bibleData");
        const activeVer = (activeTranslation || columnTranslations[activeColumnIndex] || quickTranslations[0] || "KJV").toUpperCase();
        const primaryIndex = activeColumnIndex >= 0 && activeColumnIndex < columnTranslations.length ? activeColumnIndex : 0;
        const primaryVersion = (columnTranslations[primaryIndex] || activeVer).toUpperCase();

        const passageMap = new Map<string, BiblePassage>();
        const errorMap = new Map<string, string>();

        // 1. Immediately load and render the primary visible translation for instant UI display
        try {
          const primaryPassage = await getChapter(selectedBook, selectedChapter, primaryVersion);
          passageMap.set(primaryVersion, primaryPassage);
          if (!cancelled) {
            const initialPassages = createEmptyPassages();
            initialPassages[primaryIndex] = primaryPassage;
            setChapterPassages(initialPassages);
            setChapterLoading(false);

            const verses = (primaryPassage.verses ?? []).map((v) => ({
              verse: v.verse,
              text: v.text,
            }));
            invoke("set_bible_reading_state", {
              translation: primaryPassage.translation ?? primaryVersion,
              book: selectedBook,
              chapter: selectedChapter,
              verses,
              selectedVerse: selectedVerse ?? null,
            }).catch(() => { });
          }
        } catch (error) {
          errorMap.set(
            primaryVersion,
            error instanceof Error ? error.message : t("bible.unableToLoadVersion"),
          );
        }

        if (cancelled) return;

        // 2. Load remaining column translations in the background without blocking the UI
        const otherTranslations = Array.from(
          new Set(
            columnTranslations
              .map((value) => value.toUpperCase())
              .filter((version) => version !== primaryVersion),
          ),
        );

        if (otherTranslations.length > 0) {
          await Promise.all(
            otherTranslations.map(async (version) => {
              try {
                const passage = await getChapter(selectedBook, selectedChapter, version);
                passageMap.set(version, passage);
              } catch (error) {
                errorMap.set(
                  version,
                  error instanceof Error ? error.message : t("bible.unableToLoadVersion"),
                );
              }
            }),
          );
        }

        if (cancelled) return;
        const nextPassages = createEmptyPassages();
        const nextErrors = createEmptyErrors();
        columnTranslations.forEach((version, index) => {
          nextPassages[index] = passageMap.get(version.toUpperCase()) ?? null;
          nextErrors[index] = errorMap.get(version.toUpperCase()) ?? "";
        });
        setChapterPassages(nextPassages);
        setChapterErrors(nextErrors);
      } catch (error) {
        if (cancelled) return;
        const nextErrors = createEmptyErrors();
        nextErrors[0] = error instanceof Error ? error.message : t("bible.unableToLoad");
        setChapterPassages(createEmptyPassages());
        setChapterErrors(nextErrors);
      } finally {
        if (!cancelled) {
          setChapterLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columnTranslations, quickTranslations, selectedBook, selectedChapter, translationsLoaded]);

  useEffect(() => {
    if (!translationsLoaded || !compareEnabled || !selectedBook || !selectedChapter) {
      setComparePassages({ translationA: null, translationB: null });
      setCompareChapterErrors(["", ""]);
      setCompareChapterLoading(false);
      return;
    }

    let cancelled = false;
    setCompareChapterLoading(true);
    setCompareChapterErrors(["", ""]);

    (async () => {
      try {
        const { getChapter } = await import("../../bible/bibleData");
        const [resA, resB] = await Promise.allSettled([
          getChapter(selectedBook, selectedChapter, translationA),
          getChapter(selectedBook, selectedChapter, translationB),
        ]);
        if (cancelled) return;
        const passageA = resA.status === "fulfilled" ? resA.value : null;
        let passageB = resB.status === "fulfilled" ? resB.value : null;
        if (!passageB && passageA) {
          passageB = passageA;
        }
        setComparePassages({ translationA: passageA, translationB: passageB });
        setCompareChapterErrors([
          resA.status === "rejected" ? (resA.reason instanceof Error ? resA.reason.message : t("bible.unableToLoad")) : "",
          resB.status === "rejected" ? (resB.reason instanceof Error ? resB.reason.message : t("bible.unableToLoad")) : "",
        ]);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : t("bible.unableToLoad");
        setComparePassages({ translationA: null, translationB: null });
        setCompareChapterErrors([message, message]);
      } finally {
        if (!cancelled) {
          setCompareChapterLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [compareEnabled, selectedBook, selectedChapter, t, translationA, translationB, translationsLoaded]);

  const resolveVerseSelection = useCallback(
    async (
      book: string,
      chapter: number,
      verse: number,
      translation: string,
      lineCount: number,
      explicitVerseEnd?: number | null,
      existingPassage?: BiblePassage | null,
    ): Promise<{ text: string; verseRange: string; verseEnd: number }> => {
      const safeLineCount = clampVerseLineCount(lineCount);

      let passage = existingPassage ?? null;
      if (!passage) {
        try {
          const { getChapter } = await import("../../bible/bibleData");
          passage = await getChapter(book, chapter, translation);
        } catch {
          passage = null;
        }
      }

      if (!passage || !passage.verses || passage.verses.length === 0) {
        try {
          const { getChapter } = await import("../../bible/bibleData");
          passage = await getChapter(book, chapter, "KJV");
        } catch {
          passage = null;
        }
      }

      const verses = passage?.verses ?? [];
      let targetVerse = verse;
      let startIndex = verses.findIndex((entry) => entry.verse === targetVerse);
      if (startIndex === -1 && verses.length > 0) {
        const minV = verses[0]?.verse ?? 1;
        const maxV = verses[verses.length - 1]?.verse ?? minV;
        targetVerse = Math.min(Math.max(verse, minV), maxV);
        startIndex = verses.findIndex((entry) => entry.verse === targetVerse);
      }
      if (startIndex === -1) {
        const text = await fetchVerseText(book, chapter, targetVerse, translation);
        return {
          text: text ? formatBibleOutputText([{ verse: targetVerse, text }], text, targetVerse) : "",
          verseRange: String(targetVerse),
          verseEnd: targetVerse,
        };
      }

      const explicitEndIndex =
        explicitVerseEnd && explicitVerseEnd >= targetVerse
          ? verses.findIndex((entry) => entry.verse === explicitVerseEnd)
          : -1;
      const selection =
        explicitEndIndex >= startIndex
          ? verses.slice(startIndex, explicitEndIndex + 1)
          : verses.slice(startIndex, startIndex + safeLineCount);
      const verseEnd = selection[selection.length - 1]?.verse ?? targetVerse;
      const text = formatBibleOutputText(selection, "", targetVerse);
      const verseRange = verseEnd === targetVerse ? String(targetVerse) : `${targetVerse}-${verseEnd}`;
      return { text, verseRange, verseEnd };
    },
    [fetchVerseText],
  );

  useEffect(() => {
    if (!translationsLoaded || !compareEnabled || compareMode !== "passages") {
      setComparePassagePreviews([]);
      return;
    }

    let cancelled = false;
    const drafts = comparePassageDrafts.slice(0, MAX_COMPARE_PASSAGES);
    const initialPreviews: ComparePassagePreview[] = drafts.map((draft) => {
      const parsed = parseBiblePassageReference(draft.reference);
      const hasInput = draft.reference.trim().length > 0;
      return {
        draft,
        parsed,
        passage: null,
        text: "",
        verseRange: parsed ? String(parsed.verse) : "",
        verseEnd: parsed?.endVerse ?? null,
        referenceLabel: parsed ? formatBiblePassageReference(parsed) : "",
        loading: Boolean(parsed),
        error: hasInput && !parsed ? t("dock.compare.invalidReference", "Enter a reference like John 3:16.") : "",
      };
    });
    setComparePassagePreviews(initialPreviews);

    void (async () => {
      const { getChapter } = await import("../../bible/bibleData");
      const loaded = await Promise.all(initialPreviews.map(async (preview) => {
        if (!preview.parsed) return preview;
        try {
          const passage = await getChapter(
            preview.parsed.book,
            preview.parsed.chapter,
            preview.draft.translation,
          );
          const selection = await resolveVerseSelection(
            preview.parsed.book,
            preview.parsed.chapter,
            preview.parsed.verse,
            preview.draft.translation,
            clampVerseLineCount(verseLineCount),
            preview.parsed.endVerse,
            passage,
          );
          return {
            ...preview,
            passage,
            text: selection.text,
            verseRange: selection.verseRange,
            verseEnd: selection.verseEnd,
            referenceLabel: formatBiblePassageReference({
              ...preview.parsed,
              endVerse: selection.verseEnd,
            }),
            loading: false,
            error: "",
          };
        } catch (error) {
          return {
            ...preview,
            loading: false,
            error: error instanceof Error ? error.message : t("bible.unableToLoad", "Unable to load this passage."),
          };
        }
      }));
      if (!cancelled) setComparePassagePreviews(loaded);
    })().catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : t("bible.unableToLoad", "Unable to load this passage.");
      setComparePassagePreviews(initialPreviews.map((preview) => ({
        ...preview,
        loading: false,
        error: preview.parsed ? message : preview.error,
      })));
    });

    return () => {
      cancelled = true;
    };
  }, [compareEnabled, compareMode, comparePassageDrafts, resolveVerseSelection, t, translationsLoaded, verseLineCount]);

  const handleComparePassageReferenceChange = useCallback((id: string, reference: string) => {
    setComparePassageDrafts((current) => current.map((draft) => (
      draft.id === id ? { ...draft, reference } : draft
    )));
  }, []);

  const handleComparePassageTranslationChange = useCallback((id: string, translation: string) => {
    setComparePassageDrafts((current) => current.map((draft) => (
      draft.id === id ? { ...draft, translation: translation.toUpperCase() } : draft
    )));
  }, []);

  const activateComparePassage = useCallback((index: number, referenceOverride?: ParsedBiblePassageReference | null) => {
    const nextIndex = Math.min(Math.max(index, 0), Math.max(0, comparePassageDrafts.length - 1));
    setActiveComparePassageIndex(nextIndex);
    const parsed = referenceOverride ?? parseBiblePassageReference(comparePassageDrafts[nextIndex]?.reference ?? "");
    if (!parsed) return;
    setSelectedBook(parsed.book);
    selectedChapterRef.current = parsed.chapter;
    setSelectedChapter(parsed.chapter);
    setSelectedVerse(parsed.verse);
    selectedVerseRef.current = parsed.verse;
  }, [comparePassageDrafts]);

  const resolveComparePassageOutputColumns = useCallback(async (
    lineCount: number,
    referenceFormatValue: BibleReferenceFormat,
    referenceVersionVisibleValue: boolean,
    draftsOverride?: ComparePassageDraft[],
  ): Promise<ComparePassageOutputColumn[]> => {
    const { getChapter } = await import("../../bible/bibleData");
    const drafts = (draftsOverride ?? comparePassageDrafts).slice(0, MAX_COMPARE_PASSAGES);
    return Promise.all(drafts.map(async (draft) => {
      const parsed = parseBiblePassageReference(draft.reference);
      if (!parsed) {
        throw new Error(t("dock.compare.invalidReference", "Enter a reference like John 3:16."));
      }

      const passage = await getChapter(parsed.book, parsed.chapter, draft.translation);
      const selection = await resolveVerseSelection(
        parsed.book,
        parsed.chapter,
        parsed.verse,
        draft.translation,
        lineCount,
        parsed.endVerse,
        passage,
      );
      return {
        book: parsed.book,
        chapter: parsed.chapter,
        verse: parsed.verse,
        verseEnd: selection.verseEnd,
        verseRange: selection.verseRange,
        referenceLabel: buildBibleReferenceBaseLabel(
          parsed.book,
          parsed.chapter,
          selection.verseRange,
          referenceFormatValue,
        ),
        translation: referenceVersionVisibleValue ? draft.translation : "",
        verseText: selection.text,
      };
    }));
  }, [comparePassageDrafts, resolveVerseSelection, t]);

  const publishComparePassageOutput = useCallback(async ({
    lineCount,
    referenceFormatValue,
    referenceVersionVisibleValue,
    themeOverride,
    reveal = false,
    draftsOverride,
    awaitFontFit = false,
    overlayMode: overlayModeOverride,
  }: {
    lineCount: number;
    referenceFormatValue: BibleReferenceFormat;
    referenceVersionVisibleValue: boolean;
    themeOverride?: BibleThemeOutputOverride;
    reveal?: boolean;
    draftsOverride?: ComparePassageDraft[];
    awaitFontFit?: boolean;
    overlayMode?: OverlayMode;
  }): Promise<DockOverlayFontFitMeasurement | null | undefined> => {
    if (!translationsLoaded) return null;
    const requestId = ++liveVerseRequestIdRef.current;
    const visibilityEpoch = visibilityEpochRef.current;
    const drafts = (draftsOverride ?? comparePassageDrafts).slice(0, MAX_COMPARE_PASSAGES);
    if (drafts.length < MIN_COMPARE_PASSAGES) return null;

    try {
      const columns = await resolveComparePassageOutputColumns(
        lineCount,
        referenceFormatValue,
        referenceVersionVisibleValue,
        drafts,
      );
      if (requestId !== liveVerseRequestIdRef.current || columns.length < MIN_COMPARE_PASSAGES) return null;

      const liveOverlayMode = fullscreenOnlyMode
        ? "fullscreen"
        : (overlayModeOverride ?? overlayModeRef.current);
      const liveFullscreenThemeSettings = liveFullscreenThemeSettingsRef.current
        ?? effectiveSelectedBibleTheme.settings;
      const liveLowerThirdThemeSettings = liveLowerThirdThemeSettingsRef.current
        ?? effectiveSelectedLowerThirdTheme.settings;
      const first = columns[0];
      const compareReferenceLabel = columns
        .map((column) => column.referenceLabel)
        .filter(Boolean)
        .join(" • ") || t("dock.compare.passagesLabel", "Compare Passages");
      const stageData = {
        book: first.book,
        chapter: first.chapter,
        verse: first.verse,
        verseEnd: first.verseEnd,
        verseRange: first.verseRange,
        referenceLabel: first.referenceLabel,
        displayReferenceLabel: compareReferenceLabel,
        referenceBaseLabel: first.referenceLabel,
        lineCount,
        translation: drafts[0]?.translation ?? "",
        translationA: drafts[0]?.translation ?? "",
        translationB: drafts[1]?.translation ?? "",
        compareEnabled: true,
        compareMode: "passages" as const,
        compareLayout: "side-by-side" as const,
        verseText: first.verseText,
        overlayMode: liveOverlayMode,
        theme: themeOverride?.themeId
          ?? (liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id),
        bibleThemeSettings: (() => {
          const basePassageSettings = (
            themeOverride?.settings
            ?? (liveOverlayMode === "fullscreen" ? liveFullscreenThemeSettings : liveLowerThirdThemeSettings)
          ) as unknown as Record<string, unknown>;
          const rawCompPassageVerseSize = Number(basePassageSettings.compareVerseFontSizeLeft || 0);
          const rawCompPassageRefSize = Number(basePassageSettings.compareReferenceFontSizeLeft || 0);
          const activePassageBaseFontSize = Number(
            basePassageSettings.fontSize || (liveOverlayMode === "lower-third" ? 64 : 145),
          );
          const activePassageBaseRefFontSize = Number(
            basePassageSettings.refFontSize || (liveOverlayMode === "lower-third" ? 42 : 42),
          );
          const effectiveCompPassageVerseSize = liveOverlayMode === "lower-third"
            ? (rawCompPassageVerseSize > 0 ? rawCompPassageVerseSize : activePassageBaseFontSize)
            : ((rawCompPassageVerseSize > 40) ? rawCompPassageVerseSize : activePassageBaseFontSize);
          const effectiveCompPassageRefSize = liveOverlayMode === "lower-third"
            ? (rawCompPassageRefSize > 0 ? rawCompPassageRefSize : activePassageBaseRefFontSize)
            : ((rawCompPassageRefSize > 25) ? rawCompPassageRefSize : activePassageBaseRefFontSize);
          return {
            ...basePassageSettings,
            fontSize: activePassageBaseFontSize,
            refFontSize: activePassageBaseRefFontSize,
            compareVerseFontSizeLeft: effectiveCompPassageVerseSize,
            compareVerseFontSizeRight: effectiveCompPassageVerseSize,
            compareReferenceFontSizeLeft: effectiveCompPassageRefSize,
            compareReferenceFontSizeRight: effectiveCompPassageRefSize,
          };
        })(),
        liveOverrides: themeOverride
          ? (themeOverride.liveOverrides ?? null)
          : (liveOverlayMode === "fullscreen" ? (fullscreenLiveOverrides as Record<string, unknown> | null) : null),
        reveal,
        _dockLive: true,
        compare: {
          enabled: true,
          mode: "passages" as const,
          layout: "side-by-side" as const,
          columns,
        },
      };

      latestStagedRef.current = {
        type: "bible",
        label: compareReferenceLabel,
        subtitle: first.verseText,
        data: stageData,
      } as DockStagedItem;
      onStage(latestStagedRef.current);
      try {
        recordPresentationHistory({
          type: "bible",
          sourceKind: "bible-reference",
          label: compareReferenceLabel,
          subtitle: (first.verseText || "").slice(0, 200),
          notes: "Compare Passages",
          payloadSnapshot: {
            ...stageData,
            overlayMode: liveOverlayMode,
          },
          overlayMode: liveOverlayMode,
        });
      } catch {
        // Ignore
      }

      if (presentationLinkMode) {
        if (visibilityEpoch === visibilityEpochRef.current) setBibleOverlayVisible(true);
        trackBiblePresent(first.verseText);
        return null;
      }

      const lowerThirdPayload = {
        lineCount: stageData.lineCount as number | undefined,
        verseText: stageData.verseText,
        referenceText: stageData.displayReferenceLabel,
        verseRange: stageData.verseRange,
        bibleThemeSettings: stageData.bibleThemeSettings,
        liveOverrides: null,
        themeId: stageData.theme,
        compareEnabled: true,
        compareMode: "passages" as const,
        compareLayout: "side-by-side" as const,
        compare: stageData.compare,
        translationA: stageData.translationA,
        translationB: stageData.translationB,
      };
      const fitOptions = awaitFontFit ? { waitForFit: true } : undefined;
      const pushLive = () => hasSceneRoute
        ? pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData, fitOptions)
        : liveOverlayMode === "lower-third"
          ? dockObsClient.pushBibleOverlayFast(lowerThirdPayload, fitOptions)
          : pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData, fitOptions);

      const measurement = await pushLive();
      if (requestId !== liveVerseRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return;
      setBibleOverlayVisible(true);
      trackBiblePresent(first.verseText);
      return measurement;
    } catch (error) {
      if (requestId !== liveVerseRequestIdRef.current) return;
      setActionError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [
    comparePassageDrafts,
    effectiveSelectedBibleTheme.id,
    effectiveSelectedBibleTheme.settings,
    effectiveSelectedLowerThirdTheme.settings,
    fullscreenLiveOverrides,
    fullscreenOnlyMode,
    hasSceneRoute,
    onStage,
    overlayModeRef,
    presentationLinkMode,
    pushBibleToConfiguredOutput,
    resolveComparePassageOutputColumns,
    selectedLowerThirdTheme.id,
    t,
    translationsLoaded,
  ]);

  const handleComparePassageNavigation = useCallback((direction: -1 | 1, requestedIndex?: number) => {
    const navigationIndex = requestedIndex ?? activeComparePassageIndex;
    const indexes = comparePassageNavigation === "linked"
      ? comparePassagePreviews.map((_, index) => index)
      : [navigationIndex];
    const nextReferences = new Map<number, ParsedBiblePassageReference>();
    let blocked = false;

    for (const index of indexes) {
      const preview = comparePassagePreviews[index];
      if (!preview?.parsed) {
        blocked = true;
        continue;
      }
      const maxVerse = preview.passage?.verses[preview.passage.verses.length - 1]?.verse ?? verseCount;
      const next = navigateBiblePassageReference(preview.parsed, direction, maxVerse);
      if (!next) {
        blocked = true;
        continue;
      }
      nextReferences.set(index, next);
    }

    if (nextReferences.size === 0) {
      setActionError(t("dock.compare.chapterBoundary", "You are at the edge of the loaded chapter."));
      return;
    }

    const nextDrafts = comparePassageDrafts.map((draft, index) => {
      const next = nextReferences.get(index);
      return next ? { ...draft, reference: formatBiblePassageReference(next) } : draft;
    });
    setComparePassageDrafts(() => nextDrafts);
    const activeNext = nextReferences.get(navigationIndex);
    if (activeNext) activateComparePassage(navigationIndex, activeNext);
    setActionError(blocked
      ? t("dock.compare.partialChapterBoundary", "Some passages are at the edge of their chapter.")
      : "");

    // Navigation must update the already-routed OBS source as well as the
    // reader cards. Use the next drafts directly because React state updates
    // are asynchronous and the source cannot wait for the next render.
    void publishComparePassageOutput({
      lineCount: verseLineCount,
      referenceFormatValue: referenceFormat,
      referenceVersionVisibleValue: referenceVersionVisible,
      reveal: true,
      draftsOverride: nextDrafts,
    });
  }, [
    activeComparePassageIndex,
    activateComparePassage,
    comparePassageDrafts,
    comparePassageNavigation,
    comparePassagePreviews,
    publishComparePassageOutput,
    referenceFormat,
    referenceVersionVisible,
    t,
    verseCount,
    verseLineCount,
  ]);

  const handleRemoveComparePassage = useCallback((id: string) => {
    setComparePassageDrafts((current) => {
      if (current.length <= MIN_COMPARE_PASSAGES) return current;
      const next = current.filter((draft) => draft.id !== id);
      return next.length >= MIN_COMPARE_PASSAGES ? next : current;
    });
    setActiveComparePassageIndex((current) => Math.min(current, MIN_COMPARE_PASSAGES - 1));
  }, []);

  const stageVerse = useCallback(
    async (
      book: string,
      chapter: number,
      verse: number,
      options?: {
        translation?: string;
        columnIndex?: number;
        reveal?: boolean;
        rangeEndVerse?: number | null;
        lineCount?: number;
        referenceFormat?: BibleReferenceFormat;
        referenceVersionVisible?: boolean;
      },
    ) => {
      const effectiveTranslation = options?.translation ?? activeTranslation;
      if (compareEnabled && compareMode === "passages") {
        const nextReference: ParsedBiblePassageReference = { book, chapter, verse, endVerse: null };
        setComparePassageDrafts((current) => current.map((draft, index) => (
          index === activeComparePassageIndex
            ? { ...draft, reference: formatBiblePassageReference(nextReference) }
            : draft
        )));
        activateComparePassage(activeComparePassageIndex, nextReference);
        return;
      }
      const effectiveLineCount = clampVerseLineCount(options?.lineCount ?? verseLineCount);
      const effectiveReferenceFormat = options?.referenceFormat ?? referenceFormat;
      const effectiveReferenceVersionVisible = options?.referenceVersionVisible ?? referenceVersionVisible;
      const liveFullscreenThemeSettings = liveFullscreenThemeSettingsRef.current
        ?? effectiveSelectedBibleTheme.settings;
      const liveLowerThirdThemeSettings = liveLowerThirdThemeSettingsRef.current
        ?? effectiveSelectedLowerThirdTheme.settings;
      if (book !== selectedBook || chapter !== selectedChapter) {
        focusReference(book, chapter, verse, { reveal: options?.reveal });
      } else {
        focusReferenceWithoutReload(book, chapter, verse, { reveal: options?.reveal });
      }
      if (typeof options?.columnIndex === "number") {
        setSelectedColumn(Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1));
      }
      setActionError("");
      const existingPrimaryPassage =
        book === selectedBook && chapter === selectedChapter
          ? getLoadedPassageForTranslation(effectiveTranslation)
          : null;
      const selection = await resolveVerseSelection(
        book,
        chapter,
        verse,
        effectiveTranslation,
        effectiveLineCount,
        options?.rangeEndVerse ?? null,
        existingPrimaryPassage,
      );
      setVerseText(selection.text);
      const rawReferenceLabel = `${book} ${chapter}:${selection.verseRange}`;
      const referenceBaseLabel = buildBibleReferenceBaseLabel(book, chapter, selection.verseRange, effectiveReferenceFormat);
      const referenceLabel = buildBibleReferenceDisplayLabel(
        book,
        chapter,
        selection.verseRange,
        effectiveTranslation,
        effectiveReferenceFormat,
        effectiveReferenceVersionVisible,
      );
      const columnIndex = typeof options?.columnIndex === "number"
        ? Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
        : activeColumnIndex;
      const shouldCompareTranslations = compareEnabled && compareMode === "translations";
      const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;

      let stageData: Record<string, unknown>;
      let stageLabel = referenceLabel;
      let stageSubtitle = selection.text;

      if (shouldCompareTranslations) {
        const [selectionA, selectionB] = await Promise.all([
          resolveVerseSelection(
            book,
            chapter,
            verse,
            translationA,
            effectiveLineCount,
            options?.rangeEndVerse ?? null,
          ),
          resolveVerseSelection(
            book,
            chapter,
            verse,
            translationB,
            effectiveLineCount,
            options?.rangeEndVerse ?? null,
          ),
        ]);
        const compareReferenceBaseLabel = buildBibleReferenceBaseLabel(book, chapter, selectionA.verseRange, effectiveReferenceFormat);
        const compareReferenceLabel = appendBibleVersionToReference(
          compareReferenceBaseLabel,
          `${translationA}/${translationB}`,
          effectiveReferenceVersionVisible,
        );
        stageLabel = compareReferenceLabel;
        stageSubtitle = selectionA.text;
        stageData = {
          book,
          chapter,
          verse,
          columnIndex,
          verseEnd: selectionA.verseEnd,
          verseRange: selectionA.verseRange,
          referenceLabel: compareReferenceLabel,
          displayReferenceLabel: compareReferenceLabel,
          referenceBaseLabel: compareReferenceBaseLabel,
          lineCount: effectiveLineCount,
          translation: translationA,
          translationA,
          translationB,
          compareEnabled: true,
          compareLayout,
          verseText: selectionA.text,
          overlayMode: liveOverlayMode,
          theme: liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id,
          bibleThemeSettings: (
            liveOverlayMode === "fullscreen"
              ? liveFullscreenThemeSettings
              : liveLowerThirdThemeSettings
          ) as unknown as Record<string, unknown>,
          liveOverrides:
            liveOverlayMode === "fullscreen"
              ? (fullscreenLiveOverrides as Record<string, unknown> | null)
              : null,
          reveal: options?.reveal !== false,
          compare: {
            enabled: true,
            layout: compareLayout,
            columns: [
              {
                book,
                chapter,
                verse,
                verseEnd: selectionA.verseEnd,
                verseRange: selectionA.verseRange,
                referenceLabel: compareReferenceBaseLabel,
                translation: effectiveReferenceVersionVisible ? translationA : "",
                verseText: selectionA.text,
              },
              {
                book,
                chapter,
                verse,
                verseEnd: selectionB.verseEnd,
                verseRange: selectionB.verseRange,
                referenceLabel: compareReferenceBaseLabel,
                translation: effectiveReferenceVersionVisible ? translationB : "",
                verseText: selectionB.text,
              },
            ],
          },
        };
      } else {
        stageData = {
          book,
          chapter,
          verse,
          columnIndex,
          verseEnd: selection.verseEnd,
          verseRange: selection.verseRange,
          rawReferenceLabel,
          referenceLabel,
          displayReferenceLabel: referenceLabel,
          referenceBaseLabel,
          lineCount: effectiveLineCount,
          translation: effectiveTranslation,
          verseText: selection.text,
          overlayMode: liveOverlayMode,
          theme: liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id,
          bibleThemeSettings: (
            liveOverlayMode === "fullscreen"
              ? liveFullscreenThemeSettings
              : liveLowerThirdThemeSettings
          ) as unknown as Record<string, unknown>,
          liveOverrides:
            liveOverlayMode === "fullscreen"
              ? (fullscreenLiveOverrides as Record<string, unknown> | null)
              : null,
          reveal: options?.reveal !== false,
        };
      }

      const nextStageItem = {
        type: "bible",
        label: stageLabel,
        subtitle: stageSubtitle,
        data: stageData,
      } as DockStagedItem;

      latestStagedRef.current = nextStageItem;
      onStage(nextStageItem);

      recordBibleHistory(book, chapter, verse, selection.text);
    },
    [
      focusReference,
      focusReferenceWithoutReload,
      compareEnabled,
      compareMode,
      compareLayout,
      activeComparePassageIndex,
      comparePassageDrafts,
      activateComparePassage,
      fullscreenLiveOverrides,
      onStage,
      overlayMode,
      resolveVerseSelection,
      translationA,
      translationB,
      effectiveSelectedBibleTheme.id,
      effectiveSelectedBibleTheme.settings,
      effectiveSelectedLowerThirdTheme.settings,
      selectedLowerThirdTheme.id,
      activeTranslation,
      activeColumnIndex,
      chapterPassages,
      fullscreenOnlyMode,
      referenceFormat,
      referenceVersionVisible,
      recordBibleHistory,
      verseLineCount,
    ],
  );

  const goLiveVerse = useCallback(
    async (
      book: string,
      chapter: number,
      verse: number,
      options?: {
        translation?: string;
        columnIndex?: number;
        reveal?: boolean;
        rangeEndVerse?: number | null;
        lineCount?: number;
        overlayMode?: OverlayMode;
        referenceFormat?: BibleReferenceFormat;
        referenceVersionVisible?: boolean;
        themeOverride?: BibleThemeOutputOverride;
        recordHistory?: boolean;
        preserveComparePassages?: boolean;
        pushComparePassages?: boolean;
        awaitFontFit?: boolean;
        compareTranslationsOverride?: { translationA: string; translationB: string };
        bypassSceneRoute?: boolean;
        /** Show this text instead of the verse (one part of a verse that was split). */
        textOverride?: string;
      },
    ) => {
      if (hasSceneRoute && !bibleSceneRouteConfirmedRef.current && !options?.bypassSceneRoute) {
        setPendingVerseRouteConfirm({ book, chapter, verse, options });
        return null;
      }
      void dockObsClient.ensureModuleSourceOpenAndOnTop(
        "bible",
        fullscreenOnlyMode ? "fullscreen" : (options?.overlayMode ?? overlayModeRef.current),
      );
      const requestId = ++liveVerseRequestIdRef.current;
      const visibilityEpoch = visibilityEpochRef.current;
      const effectiveTranslation = options?.translation ?? activeTranslation;
      const liveOverlayMode = fullscreenOnlyMode
        ? "fullscreen"
        : (options?.overlayMode ?? overlayModeRef.current);
      if (compareEnabled && compareMode === "passages") {
        if (options?.preserveComparePassages) {
          return publishComparePassageOutput({
            lineCount: clampVerseLineCount(options?.lineCount ?? verseLineCount),
            referenceFormatValue: options?.referenceFormat ?? referenceFormat,
            referenceVersionVisibleValue: options?.referenceVersionVisible ?? referenceVersionVisible,
            themeOverride: options?.themeOverride,
            reveal: options?.reveal !== false,
            awaitFontFit: options?.awaitFontFit,
            overlayMode: liveOverlayMode,
          });
        }
        const nextReference: ParsedBiblePassageReference = { book, chapter, verse, endVerse: null };
        const nextDrafts = comparePassageDrafts.map((draft, index) => (
          index === activeComparePassageIndex
            ? { ...draft, reference: formatBiblePassageReference(nextReference) }
            : draft
        ));
        setComparePassageDrafts(() => nextDrafts);
        activateComparePassage(activeComparePassageIndex, nextReference);
        if (options?.pushComparePassages) {
          return publishComparePassageOutput({
            lineCount: clampVerseLineCount(options?.lineCount ?? verseLineCount),
            referenceFormatValue: options?.referenceFormat ?? referenceFormat,
            referenceVersionVisibleValue: options?.referenceVersionVisible ?? referenceVersionVisible,
            themeOverride: options?.themeOverride,
            reveal: options?.reveal !== false,
            draftsOverride: nextDrafts,
            awaitFontFit: options?.awaitFontFit,
            overlayMode: liveOverlayMode,
          });
        }
        return;
      }
      const effectiveLineCount = clampVerseLineCount(options?.lineCount ?? verseLineCount);
      const effectiveReferenceFormat = options?.referenceFormat ?? referenceFormat;
      const effectiveReferenceVersionVisible = options?.referenceVersionVisible ?? referenceVersionVisible;
      const liveFullscreenThemeSettings = liveFullscreenThemeSettingsRef.current
        ?? effectiveSelectedBibleTheme.settings;
      const liveLowerThirdThemeSettings = liveLowerThirdThemeSettingsRef.current
        ?? effectiveSelectedLowerThirdTheme.settings;
      const themeOverride = options?.themeOverride;
      const liveThemeId = themeOverride?.themeId
        ?? (liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id);
      const liveThemeSettings = themeOverride?.settings
        ?? (
          liveOverlayMode === "fullscreen"
            ? liveFullscreenThemeSettings
            : liveLowerThirdThemeSettings
        );
      // bibleThemeSettings: liveThemeSettings as unknown as Record<string, unknown>
      const liveOverrides = themeOverride
        ? (themeOverride.liveOverrides ?? null)
        : (
          liveOverlayMode === "fullscreen"
            ? (fullscreenLiveOverrides as Record<string, unknown> | null)
            : null
        );
      const shouldRecordHistory = options?.recordHistory !== false;
      const sameChapter = book === selectedBook && chapter === selectedChapter;
      const existingPrimaryPassage = sameChapter
        ? getLoadedPassageForTranslation(effectiveTranslation)
        : null;

      if (typeof options?.columnIndex === "number") {
        setSelectedColumn(Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1));
      }
      setActionError("");

      const resolvedSelection = await resolveVerseSelection(
        book,
        chapter,
        verse,
        effectiveTranslation,
        effectiveLineCount,
        options?.rangeEndVerse ?? null,
        existingPrimaryPassage,
      );
      if (requestId !== liveVerseRequestIdRef.current) return;
      // Words the operator coloured go out as colour markup. A part of a split verse arrives already done.
      const rangeHighlights: VerseHighlight[] = [];
      if (!options?.textOverride) {
        for (let v = verse; v <= Math.max(verse, resolvedSelection.verseEnd || verse); v += 1) {
          rangeHighlights.push(...(verseHighlightsRef.current[`${effectiveTranslation}|${book}|${chapter}|${v}`] ?? []));
        }
      }
      const selection = options?.textOverride
        ? { ...resolvedSelection, text: options.textOverride }
        : rangeHighlights.length > 0
          ? { ...resolvedSelection, text: applyHighlights(resolvedSelection.text, rangeHighlights) }
          : resolvedSelection;

      setVerseText(selection.text);
      const rawReferenceLabel = `${book} ${chapter}:${selection.verseRange}`;
      const referenceBaseLabel = buildBibleReferenceBaseLabel(book, chapter, selection.verseRange, effectiveReferenceFormat);
      const referenceLabel = buildBibleReferenceDisplayLabel(
        book,
        chapter,
        selection.verseRange,
        effectiveTranslation,
        effectiveReferenceFormat,
        effectiveReferenceVersionVisible,
      );
      const columnIndex = typeof options?.columnIndex === "number"
        ? Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
        : activeColumnIndex;
      const compareOverride = options?.compareTranslationsOverride;
      const effectiveTranslationA = compareOverride ? compareOverride.translationA : translationA;
      const effectiveTranslationB = compareOverride ? compareOverride.translationB : translationB;
      const shouldCompareTranslations = compareOverride != null
        ? true
        : (compareEnabled && compareMode === "translations");

      let stageData: Record<string, unknown>;
      let stageLabel = referenceLabel;
      let stageSubtitle = selection.text;

      if (shouldCompareTranslations) {
        const [selectionA, selectionB] = await Promise.all([
          resolveVerseSelection(
            book,
            chapter,
            verse,
            effectiveTranslationA,
            effectiveLineCount,
            options?.rangeEndVerse ?? null,
            sameChapter ? getLoadedPassageForTranslation(effectiveTranslationA) : null,
          ),
          resolveVerseSelection(
            book,
            chapter,
            verse,
            effectiveTranslationB,
            effectiveLineCount,
            options?.rangeEndVerse ?? null,
            sameChapter ? getLoadedPassageForTranslation(effectiveTranslationB) : null,
          ),
        ]);
        if (requestId !== liveVerseRequestIdRef.current) return;

        const compareReferenceBaseLabel = buildBibleReferenceBaseLabel(book, chapter, selectionA.verseRange, effectiveReferenceFormat);
        const compareReferenceLabel = appendBibleVersionToReference(
          compareReferenceBaseLabel,
          `${effectiveTranslationA}/${effectiveTranslationB}`,
          effectiveReferenceVersionVisible,
        );
        stageLabel = compareReferenceLabel;
        stageSubtitle = selectionA.text;
        stageData = {
          book,
          chapter,
          verse,
          columnIndex,
          verseEnd: selectionA.verseEnd,
          verseRange: selectionA.verseRange,
          referenceLabel: compareReferenceLabel,
          displayReferenceLabel: compareReferenceLabel,
          referenceBaseLabel: compareReferenceBaseLabel,
          lineCount: effectiveLineCount,
          translation: effectiveTranslationA,
          translationA: effectiveTranslationA,
          translationB: effectiveTranslationB,
          compareEnabled: true,
          compareMode: "translations",
          compareLayout,
          verseText: selectionA.text,
          overlayMode: liveOverlayMode,
          theme: liveThemeId,
          bibleThemeSettings: (() => {
            const liveSettingsRecord = (liveThemeSettings as unknown as Record<string, unknown>) || {};
            const rawLiveCompVerseSize = Number(liveSettingsRecord.compareVerseFontSizeLeft || 0);
            const rawLiveCompRefSize = Number(liveSettingsRecord.compareReferenceFontSizeLeft || 0);
            const activeLiveBaseFontSize = Number(
              liveSettingsRecord.fontSize || (liveOverlayMode === "lower-third" ? 64 : 145),
            );
            const activeLiveBaseRefFontSize = Number(
              liveSettingsRecord.refFontSize || (liveOverlayMode === "lower-third" ? 42 : 42),
            );
            const effectiveLiveCompVerseSize = liveOverlayMode === "lower-third"
              ? (rawLiveCompVerseSize > 0 ? rawLiveCompVerseSize : activeLiveBaseFontSize)
              : ((rawLiveCompVerseSize > 40) ? rawLiveCompVerseSize : activeLiveBaseFontSize);
            const effectiveLiveCompRefSize = liveOverlayMode === "lower-third"
              ? (rawLiveCompRefSize > 0 ? rawLiveCompRefSize : activeLiveBaseRefFontSize)
              : ((rawLiveCompRefSize > 25) ? rawLiveCompRefSize : activeLiveBaseRefFontSize);
            return {
              ...liveSettingsRecord,
              fontSize: activeLiveBaseFontSize,
              refFontSize: activeLiveBaseRefFontSize,
              compareVerseFontSizeLeft: effectiveLiveCompVerseSize,
              compareVerseFontSizeRight: effectiveLiveCompVerseSize,
              compareReferenceFontSizeLeft: effectiveLiveCompRefSize,
              compareReferenceFontSizeRight: effectiveLiveCompRefSize,
            };
          })(),
          liveOverrides,
          reveal: options?.reveal !== false,
          _dockLive: true,
          compare: {
            enabled: true,
            layout: compareLayout,
            columns: [
              {
                book,
                chapter,
                verse,
                verseEnd: selectionA.verseEnd,
                verseRange: selectionA.verseRange,
                referenceLabel: compareReferenceBaseLabel,
                translation: effectiveReferenceVersionVisible ? effectiveTranslationA : "",
                verseText: selectionA.text,
              },
              {
                book,
                chapter,
                verse,
                verseEnd: selectionB.verseEnd,
                verseRange: selectionB.verseRange,
                referenceLabel: compareReferenceBaseLabel,
                translation: effectiveReferenceVersionVisible ? effectiveTranslationB : "",
                verseText: selectionB.text,
              },
            ],
          },
        };
      } else {
        stageData = {
          book,
          chapter,
          verse,
          columnIndex,
          verseEnd: selection.verseEnd,
          verseRange: selection.verseRange,
          rawReferenceLabel,
          referenceLabel,
          displayReferenceLabel: referenceLabel,
          referenceBaseLabel,
          lineCount: effectiveLineCount,
          translation: effectiveTranslation,
          verseText: selection.text,
          overlayMode: liveOverlayMode,
          theme: liveThemeId,
          bibleThemeSettings: (() => {
            const baseRecord = (liveThemeSettings as unknown as Record<string, unknown>) || {};
            if (liveOverlayMode === "lower-third") {
              const baseFont = Number(baseRecord.fontSize || 64);
              const baseRefFont = Number(baseRecord.refFontSize || 42);
              return {
                ...baseRecord,
                fontSize: baseFont > 0 ? baseFont : 64,
                refFontSize: baseRefFont > 0 ? baseRefFont : 42,
              };
            }
            return baseRecord;
          })(),
          liveOverrides,
          reveal: options?.reveal !== false,
          _dockLive: true,
        };
      }

      if (requestId !== liveVerseRequestIdRef.current) return;

      const nextStageItem = {
        type: "bible",
        label: stageLabel,
        subtitle: stageSubtitle,
        data: stageData,
      } as DockStagedItem;

      latestStagedRef.current = nextStageItem;
      onStage(nextStageItem);

      if (shouldRecordHistory && book && chapter && verse) {
        try {
          recordPresentationHistory({
            type: "bible",
            sourceKind: "bible-reference",
            label: stageLabel,
            subtitle: (stageSubtitle || selection.text || "").slice(0, 200),
            notes: effectiveTranslation,
            payloadSnapshot: {
              ...stageData,
              overlayMode: liveOverlayMode,
            },
            overlayMode: liveOverlayMode,
          });
        } catch {
          // Ignore
        }
      }

      if (presentationLinkMode) {
        if (visibilityEpoch === visibilityEpochRef.current) setBibleOverlayVisible(true);
        trackBiblePresent(selection.text);
        if (shouldRecordHistory && book && chapter && verse) {
          recordBibleHistory(book, chapter, verse, selection.text);
        }
        return;
      }

      const lowerThirdPayload = {
        lineCount: stageData.lineCount as number | undefined,
        verseText: stageData.verseText as string | undefined,
        referenceText: stageData.displayReferenceLabel as string | undefined,
        verseRange: stageData.verseRange as string | undefined,
        bibleThemeSettings: stageData.bibleThemeSettings as Record<string, unknown> | null | undefined,
        liveOverrides: null,
        themeId: stageData.theme as string | undefined,
        compareEnabled: Boolean(stageData.compareEnabled),
        compareMode: (stageData.compareMode as CompareMode | undefined) ?? (shouldCompareTranslations ? "translations" : undefined),
        compareLayout: stageData.compareLayout as CompareLayout | undefined,
        compare: stageData.compare as Record<string, unknown> | null | undefined,
        translationA: (stageData.translationA as string | undefined) ?? (shouldCompareTranslations ? effectiveTranslationA : undefined),
        translationB: (stageData.translationB as string | undefined) ?? (shouldCompareTranslations ? effectiveTranslationB : undefined),
      };
      const fitOptions = options?.awaitFontFit ? { waitForFit: true } : undefined;
      const effectiveUseSceneRoute = hasSceneRoute && !options?.bypassSceneRoute;
      const pushLive = () => effectiveUseSceneRoute
        ? pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData, fitOptions)
        : liveOverlayMode === "lower-third"
          ? dockObsClient.pushBibleOverlayFast(lowerThirdPayload, fitOptions)
          : pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData, fitOptions, { bypassSceneRoute: true });

      // In fullscreen mode, publish the selected verse to the already-loaded Bible
      // browser source without queuing duplicate presentation focus mutations.
      if (!effectiveUseSceneRoute && liveOverlayMode !== "lower-third") {
        void dockObsClient
          .primeBibleOverlay(stageData as unknown as Parameters<typeof dockObsClient.primeBibleOverlay>[0])
          .catch(() => { });
      }

      if (options?.awaitFontFit) {
        try {
          const measurement = await pushLive();
          if (requestId !== liveVerseRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return measurement;
          setBibleOverlayVisible(true);
          trackBiblePresent(selection.text);
          return measurement;
        } catch (err) {
          if (requestId === liveVerseRequestIdRef.current) {
            console.warn("[DockBibleTab] Save-time overlay measurement failed:", err);
          }
          return null;
        }
      }

      pushLive()
        .then(() => {
          if (requestId !== liveVerseRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return;
          setBibleOverlayVisible(true);
          trackBiblePresent(selection.text);
        })
        .catch(async (err) => {
          if (requestId !== liveVerseRequestIdRef.current) return;
          let message = err instanceof Error ? err.message : String(err);
          const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
          if (isTransient) {
            try {
              if (requestId !== liveVerseRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return;
              await pushLive();
              if (requestId !== liveVerseRequestIdRef.current || visibilityEpoch !== visibilityEpochRef.current) return;
              setBibleOverlayVisible(true);
              trackBiblePresent(selection.text);
              return;
            } catch (retryErr) {
              message = retryErr instanceof Error ? retryErr.message : String(retryErr);
              console.warn("[DockBibleTab] Send to OBS verse retry failed:", retryErr);
            }
          }
          console.warn("[DockBibleTab] Send to OBS verse failed:", err);
          setActionError(message);
        });

      if (shouldRecordHistory && book && chapter && verse) {
        recordBibleHistory(book, chapter, verse, selection.text);
      }
    },
    [
      compareEnabled,
      compareMode,
      compareLayout,
      activeComparePassageIndex,
      activateComparePassage,
      fullscreenLiveOverrides,
      onStage,
      overlayMode,
      resolveVerseSelection,
      getLoadedPassageForTranslation,
      selectedBook,
      selectedChapter,
      publishComparePassageOutput,
      translationA,
      translationB,
      effectiveSelectedBibleTheme.id,
      effectiveSelectedBibleTheme.settings,
      effectiveSelectedLowerThirdTheme.settings,
      selectedLowerThirdTheme.id,
      activeColumnIndex,
      activeTranslation,
      fullscreenOnlyMode,
      verseLineCount,
      presentationLinkMode,
      referenceFormat,
      referenceVersionVisible,
      hasSceneRoute,
      sceneRoute.syncPresentation,
      pushBibleToConfiguredOutput,
      recordBibleHistory,
    ],
  );

  const refreshCurrentBibleOutputAfterThemeSave = useCallback((
    saveMode: OverlayMode,
    nextSettings: DockFullscreenQuickThemeSettings,
    context?: BibleQuickSettingsSaveContext,
  ) => {
    const isCompareActive = compareEnabled;
    const isVisibleOrCompare = bibleOverlayVisible || isCompareActive;
    if (!isVisibleOrCompare || !selectedBook || !selectedChapter || !selectedVerse) {
      const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
      const selectedTheme = context?.selectedTheme ?? null;
      const baseTheme = resolveThemeForOverlayMode(
        selectedTheme ?? (saveMode === "fullscreen" ? selectedBibleThemeRef.current : selectedLowerThirdThemeRef.current),
        saveMode,
      );
      const nextTheme = saveMode === "fullscreen"
        ? applyFullscreenQuickThemeSettings(baseTheme, nextSettings)
        : applyLowerThirdQuickThemeSettings(baseTheme, nextSettings);

      if (context?.sceneProfileId && context.sceneProfileId !== GENERAL_SCENE_PROFILE_ID) {
        void dockObsClient.pushBibleToScene({
          book: "",
          chapter: 1,
          verse: 1,
          translation: activeTranslation || "KJV",
          overlayMode: saveMode,
          theme: nextTheme.id,
          bibleThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
          backgroundOnly: true,
        }, context.sceneProfileId);
      } else if (liveOverlayMode === saveMode) {
        void dockObsClient.primeBibleOverlay({
          overlayMode: saveMode,
          bibleThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
          backgroundOnly: true,
        });
      }
      return Promise.resolve(null);
    }
    const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
    if (liveOverlayMode !== saveMode) return Promise.resolve(null);
    const effectiveLineCount = clampVerseLineCount(context?.lineCount ?? verseLineCount);
    const effectiveReferenceFormat = context?.referenceFormat ?? referenceFormat;
    const effectiveReferenceVersionVisible = context?.referenceVersionVisible ?? referenceVersionVisible;
    const isSceneProfileSave = Boolean(
      context?.sceneProfileId && context.sceneProfileId !== GENERAL_SCENE_PROFILE_ID,
    );

    const selectedTheme = context?.selectedTheme ?? null;
    const baseTheme = resolveThemeForOverlayMode(
      selectedTheme ?? (saveMode === "fullscreen" ? selectedBibleThemeRef.current : selectedLowerThirdThemeRef.current),
      saveMode,
    );
    const nextTheme = saveMode === "fullscreen"
      ? applyFullscreenQuickThemeSettings(baseTheme, nextSettings)
      : applyLowerThirdQuickThemeSettings(baseTheme, nextSettings);
    const preset = context?.backgroundPreset ?? backgroundPresetRef.current;

    return goLiveVerse(selectedBook, selectedChapter, selectedVerse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
      reveal: false,
      lineCount: effectiveLineCount,
      referenceFormat: effectiveReferenceFormat,
      referenceVersionVisible: effectiveReferenceVersionVisible,
      recordHistory: false,
      preserveComparePassages: true,
      awaitFontFit: true,
      ...(isSceneProfileSave ? {} : {
        themeOverride: {
          themeId: nextTheme.id,
          settings: nextTheme.settings,
          liveOverrides: saveMode === "fullscreen"
            ? buildFullscreenLiveOverridesForQuickSettings(
              nextTheme.settings,
              preset,
              nextSettings.backgroundType,
            )
            : null,
        },
      }),
    });
  }, [
    activeColumnIndex,
    activeTranslation,
    bibleOverlayVisible,
    fullscreenOnlyMode,
    goLiveVerse,
    referenceFormat,
    referenceVersionVisible,
    selectedBook,
    selectedChapter,
    selectedVerse,
    verseLineCount,
  ]);

  useEffect(() => {
    if (
      modeRefreshNonce === 0
      || !bibleOverlayVisible
      || !selectedBook
      || selectedChapter === null
      || selectedVerse === null
    ) {
      return;
    }
    if (lastModeRefreshNonceRef.current === modeRefreshNonce) return;
    lastModeRefreshNonceRef.current = modeRefreshNonce;

    void goLiveVerse(selectedBook, selectedChapter, selectedVerse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
      reveal: false,
      lineCount: verseLineCount,
      referenceFormat,
      referenceVersionVisible,
      recordHistory: false,
      preserveComparePassages: true,
    });
  }, [
    activeColumnIndex,
    activeTranslation,
    bibleOverlayVisible,
    goLiveVerse,
    modeRefreshNonce,
    referenceFormat,
    referenceVersionVisible,
    selectedBook,
    selectedChapter,
    selectedVerse,
    verseLineCount,
  ]);

  const saveSceneProfileQuickThemeSettings = useCallback((
    saveMode: OverlayMode,
    nextSettings: DockFullscreenQuickThemeSettings,
    context?: DockThemeSettingsSaveContext,
  ): boolean => {
    const profileId = context?.sceneProfileId;
    if (!profileId || profileId === GENERAL_SCENE_PROFILE_ID) return false;

    const existingProfile = sceneQuickThemeSettingsRef.current[profileId] ?? {};
    const isFullscreen = saveMode === "fullscreen";
    const fallbackTheme = context?.selectedTheme
      ?? (isFullscreen ? selectedBibleThemeRef.current : selectedLowerThirdThemeRef.current);
    const storedThemeSettings = isFullscreen
      ? existingProfile.fullscreenThemeSettings
      : existingProfile.lowerThirdThemeSettings;
    const baseTheme = context?.selectedTheme || !storedThemeSettings
      ? resolveThemeForOverlayMode(fallbackTheme, saveMode)
      : {
        ...resolveThemeForOverlayMode(fallbackTheme, saveMode),
        settings: storedThemeSettings as unknown as BibleThemeSettings,
      };
    const nextTheme = isFullscreen
      ? applyFullscreenQuickThemeSettings(baseTheme, nextSettings)
      : applyLowerThirdQuickThemeSettings(baseTheme, nextSettings);
    const nextProfile: DockSceneQuickThemeProfile = {
      ...existingProfile,
      ...(isFullscreen
        ? {
          fullscreen: { ...nextSettings },
          fullscreenThemeId: context?.selectedTheme?.id
            ?? existingProfile.fullscreenThemeId
            ?? fallbackTheme.id,
          fullscreenThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
        }
        : {
          lowerThird: { ...nextSettings },
          lowerThirdThemeId: context?.selectedTheme?.id
            ?? existingProfile.lowerThirdThemeId
            ?? fallbackTheme.id,
          lowerThirdThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
        }),
    };
    const nextProfiles = {
      ...sceneQuickThemeSettingsRef.current,
      [profileId]: nextProfile,
    };
    sceneQuickThemeSettingsRef.current = nextProfiles;
    setSceneQuickThemeSettings(nextProfiles);
    persistDockBiblePreferencesNow({ sceneQuickThemeSettings: nextProfiles });
    refreshCurrentBibleOutputAfterThemeSave(saveMode, nextSettings, context);

    if (profileId && profileId !== GENERAL_SCENE_PROFILE_ID) {
      const isCompareActive = compareEnabled;
      const isVisibleOrCompare = bibleOverlayVisible || isCompareActive;
      if (!isVisibleOrCompare || !selectedBook || !selectedChapter || !selectedVerse) {
        void dockObsClient.pushBibleToScene({
          book: "",
          chapter: 1,
          verse: 1,
          translation: activeTranslation || "KJV",
          overlayMode: saveMode,
          theme: isFullscreen ? nextProfile.fullscreenThemeId : nextProfile.lowerThirdThemeId,
          bibleThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
          backgroundOnly: true,
        }, profileId);
      }
    }

    return true;
  }, [
    bibleOverlayVisible,
    compareEnabled,
    persistDockBiblePreferencesNow,
    refreshCurrentBibleOutputAfterThemeSave,
    selectedBibleThemeRef,
    selectedBook,
    selectedChapter,
    selectedLowerThirdThemeRef,
    selectedVerse,
  ]);

  const handleSaveFullscreenQuickThemeSettings = useCallback(async (
    nextSettings: DockFullscreenQuickThemeSettings,
    context?: DockThemeSettingsSaveContext,
  ) => {
    if (saveSceneProfileQuickThemeSettings("fullscreen", nextSettings, context)) return;
    manualThemeSettingsSelectionRef.current = true;

    // Commit the requested settings synchronously before waiting for OBS to
    // report its optional font-fit measurement.  The save-time repaint uses
    // an explicit theme override, but a verse navigation can happen while
    // that measurement is pending; it must read the newly selected pattern,
    // not the previous theme snapshot.
    const nextFullscreenTheme = resolveThemeForOverlayMode(
      context?.selectedTheme ?? selectedBibleThemeRef.current,
      "fullscreen",
    );
    liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
      nextFullscreenTheme,
      nextSettings,
    ).settings;
    setFullscreenQuickThemeSettings(nextSettings);
    setSavedFullscreenQuickThemeSettings(nextSettings);
    persistDockBiblePreferencesNow({
      fullscreenQuickThemeSettings: nextSettings,
      lowerThirdQuickThemeSettings: savedLowerThirdQuickThemeSettings,
      lowerThirdQuickThemeSettingsLinkedToFullscreen: false,
    });

    const measurement = await refreshCurrentBibleOutputAfterThemeSave("fullscreen", nextSettings, context);
    const nextSavedSettings = applyMeasuredFontFitSettings(nextSettings, measurement);
    liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
      nextFullscreenTheme,
      nextSavedSettings,
    ).settings;
    setFullscreenQuickThemeSettings(nextSavedSettings);
    setSavedFullscreenQuickThemeSettings(nextSavedSettings);
    persistDockBiblePreferencesNow({
      fullscreenQuickThemeSettings: nextSavedSettings,
      lowerThirdQuickThemeSettings: savedLowerThirdQuickThemeSettings,
      lowerThirdQuickThemeSettingsLinkedToFullscreen: false,
    });
  }, [
    persistDockBiblePreferencesNow,
    refreshCurrentBibleOutputAfterThemeSave,
    saveSceneProfileQuickThemeSettings,
    selectedBibleThemeRef,
    savedLowerThirdQuickThemeSettings,
  ]);

  const handleSaveLowerThirdQuickThemeSettings = useCallback(async (
    nextSettings: DockFullscreenQuickThemeSettings,
    context?: DockThemeSettingsSaveContext,
  ) => {
    if (saveSceneProfileQuickThemeSettings("lower-third", nextSettings, context)) return;
    manualThemeSettingsSelectionRef.current = true;

    // Make the selected background the live lower-third source immediately;
    // the save-time render may still be waiting for measurement when the
    // operator advances to another verse.
    const nextLowerThirdTheme = resolveThemeForOverlayMode(
      context?.selectedTheme ?? selectedLowerThirdThemeRef.current,
      "lower-third",
    );
    liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
      nextLowerThirdTheme,
      nextSettings,
    ).settings;
    setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
    setLowerThirdQuickThemeSettings(nextSettings);
    setSavedLowerThirdQuickThemeSettings(nextSettings);
    persistDockBiblePreferencesNow({
      lowerThirdQuickThemeSettings: nextSettings,
      lowerThirdQuickThemeSettingsLinkedToFullscreen: false,
    });

    const measurement = await refreshCurrentBibleOutputAfterThemeSave("lower-third", nextSettings, context);
    const nextSavedSettings = applyMeasuredFontFitSettings(nextSettings, measurement);
    liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
      nextLowerThirdTheme,
      nextSavedSettings,
    ).settings;
    setLowerThirdQuickThemeSettings(nextSavedSettings);
    setSavedLowerThirdQuickThemeSettings(nextSavedSettings);
    persistDockBiblePreferencesNow({
      lowerThirdQuickThemeSettings: nextSavedSettings,
      lowerThirdQuickThemeSettingsLinkedToFullscreen: false,
    });
  }, [
    persistDockBiblePreferencesNow,
    refreshCurrentBibleOutputAfterThemeSave,
    saveSceneProfileQuickThemeSettings,
    selectedLowerThirdThemeRef,
  ]);

  useEffect(() => {
    const handleThemeSync = (event: Event) => {
      const customEvent = event as CustomEvent<DockThemeSyncPayload>;
      const payload = customEvent.detail;
      if (!payload || !payload.targetTabs.includes("bible")) return;

      const { targetModes, quickSettings, theme, themeId, backgroundPreset, sourceTab, sourceMode } = payload;
      const findTheme = (id: string | null | undefined): BibleTheme | null => {
        if (!id) return null;
        if (theme && theme.id === id) return theme;
        return BUILTIN_THEMES.find((t) => t.id === id) ?? null;
      };
      const resolvedTheme = theme ?? findTheme(themeId);

      if (targetModes.includes("fullscreen")) {
        setFullscreenQuickThemeSettings(quickSettings);
        setSavedFullscreenQuickThemeSettings(quickSettings);
        if (resolvedTheme) {
          setSelectedBibleTheme(resolvedTheme);
          selectedBibleThemeRef.current = resolvedTheme;
        }
        const baseFs = resolveThemeForOverlayMode(
          resolvedTheme ?? selectedBibleThemeRef.current,
          "fullscreen",
        );
        liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
          baseFs,
          quickSettings,
        ).settings;
      }

      if (targetModes.includes("lower-third")) {
        setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
        setLowerThirdQuickThemeSettings(quickSettings);
        setSavedLowerThirdQuickThemeSettings(quickSettings);
        if (resolvedTheme) {
          setSelectedLowerThirdTheme(resolvedTheme);
          selectedLowerThirdThemeRef.current = resolvedTheme;
        }
        const baseLt = resolveThemeForOverlayMode(
          resolvedTheme ?? selectedLowerThirdThemeRef.current,
          "lower-third",
        );
        liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
          baseLt,
          quickSettings,
        ).settings;
      }

      if (backgroundPreset) {
        setBackgroundPreset(backgroundPreset);
        backgroundPresetRef.current = backgroundPreset;
      }

      const liveMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
      if (targetModes.includes(liveMode) && (sourceTab !== "bible" || sourceMode !== liveMode)) {
        void refreshCurrentBibleOutputAfterThemeSave(liveMode, quickSettings, {
          selectedTheme: resolvedTheme ?? undefined,
          backgroundPreset: backgroundPreset ?? undefined,
        });
      }
    };

    window.addEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
    return () => window.removeEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
  }, [
    fullscreenOnlyMode,
    refreshCurrentBibleOutputAfterThemeSave,
  ]);

  // A theme was edited in the app: swap in the new copy of the selected one so bold,
  // colours, backgrounds and layers show up without reselecting it.
  useEffect(() => {
    const handleThemesRefreshed = (event: Event) => {
      const themes = (event as CustomEvent<DockThemesRefreshedDetail>).detail?.themes ?? [];
      const freshFS = findRefreshedTheme(selectedBibleThemeRef.current, themes, "fullscreen");
      const freshLT = findRefreshedTheme(selectedLowerThirdThemeRef.current, themes, "lower-third");
      if (!freshFS && !freshLT) return;
      manualThemeSettingsSelectionRef.current = true;
      let fsSettings: DockFullscreenQuickThemeSettings | null = null;
      let ltSettings: DockFullscreenQuickThemeSettings | null = null;

      if (freshFS) {
        setSelectedBibleTheme(freshFS);
        selectedBibleThemeRef.current = freshFS;
        // Layer themes keep the operator's size / background tweaks; classic themes restart
        // from the edited look because their quick settings are a copy of the old one.
        fsSettings = themeUsesLayout(freshFS, "fullscreen") && fullscreenQuickThemeSettings
          ? fullscreenQuickThemeSettings
          : extractThemeQuickSettingsForOverlayMode(freshFS, "fullscreen");
        setFullscreenQuickThemeSettings(fsSettings);
        setSavedFullscreenQuickThemeSettings(fsSettings);
        liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
          resolveThemeForOverlayMode(freshFS, "fullscreen"),
          fsSettings,
        ).settings;
      }
      if (freshLT) {
        setSelectedLowerThirdTheme(freshLT);
        selectedLowerThirdThemeRef.current = freshLT;
        ltSettings = themeUsesLayout(freshLT, "lower-third") && lowerThirdQuickThemeSettings
          ? lowerThirdQuickThemeSettings
          : extractThemeQuickSettingsForOverlayMode(freshLT, "lower-third");
        setLowerThirdQuickThemeSettings(ltSettings);
        setSavedLowerThirdQuickThemeSettings(ltSettings);
        liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
          resolveThemeForOverlayMode(freshLT, "lower-third"),
          ltSettings,
        ).settings;
      }

      // Re-send the verse on air with the edited theme (only when one is really showing).
      const liveMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
      const liveSettings = liveMode === "fullscreen" ? fsSettings : ltSettings;
      const liveTheme = liveMode === "fullscreen" ? freshFS : freshLT;
      if (liveSettings && liveTheme && bibleOverlayVisible && liveVerseRequestIdRef.current > 0) {
        void refreshCurrentBibleOutputAfterThemeSave(liveMode, liveSettings, { selectedTheme: liveTheme });
      }
    };

    window.addEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
    return () => window.removeEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
  }, [
    bibleOverlayVisible,
    fullscreenOnlyMode,
    fullscreenQuickThemeSettings,
    lowerThirdQuickThemeSettings,
    refreshCurrentBibleOutputAfterThemeSave,
  ]);


  const refreshCurrentBibleOutputForLineCount = useCallback((lineCount: number) => {
    if (!bibleOverlayVisible || !selectedBook || !selectedChapter || !selectedVerse) {
      return Promise.resolve<DockOverlayFontFitMeasurement | null>(null);
    }
    const liveMode: OverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
    const activeSettings = liveMode === "fullscreen"
      ? activeFullscreenQuickThemeSettings
      : activeLowerThirdQuickThemeSettings;
    return refreshCurrentBibleOutputAfterThemeSave(liveMode, activeSettings, { lineCount });
  }, [
    activeFullscreenQuickThemeSettings,
    activeLowerThirdQuickThemeSettings,
    bibleOverlayVisible,
    fullscreenOnlyMode,
    overlayModeRef,
    refreshCurrentBibleOutputAfterThemeSave,
    selectedBook,
    selectedChapter,
    selectedVerse,
  ]);

  const handleSyncBibleBrowserSettings = useCallback(async (
    patch: BibleBrowserQuickSettingsPatch,
    lineCountOverride?: number,
  ) => {
    manualThemeSettingsSelectionRef.current = true;
    const hasSettingsPatch = Object.keys(patch).length > 0;
    const nextLineCount = typeof lineCountOverride === "number"
      ? clampVerseLineCount(lineCountOverride)
      : null;
    const liveMode: OverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
    const isFullscreen = liveMode === "fullscreen";
    let nextFullscreenSettings = activeFullscreenQuickThemeSettings;
    let nextLowerThirdSettings = activeLowerThirdQuickThemeSettings;

    if (nextLineCount !== null) {
      setVerseLineCount(nextLineCount);
      if (isFullscreen) {
        setFullscreenVerseLineCount(nextLineCount);
      } else {
        setLowerThirdVerseLineCount(nextLineCount);
      }
    }

    if (hasSettingsPatch) {
      if (isFullscreen) {
        nextFullscreenSettings = {
          ...activeFullscreenQuickThemeSettings,
          ...patch,
        };
        if (typeof patch.fontSize === "number" && typeof patch.compareVerseFontSizeLeft !== "number") {
          nextFullscreenSettings.compareVerseFontSizeLeft = patch.fontSize;
          nextFullscreenSettings.compareVerseFontSizeRight = patch.fontSize;
          nextFullscreenSettings.compareAutoFitMaxFontSize = patch.fontSize;
        }
        if (typeof patch.refFontSize === "number" && typeof patch.compareReferenceFontSizeLeft !== "number") {
          nextFullscreenSettings.compareReferenceFontSizeLeft = patch.refFontSize;
          nextFullscreenSettings.compareReferenceFontSizeRight = patch.refFontSize;
        }
      } else {
        nextLowerThirdSettings = {
          ...activeLowerThirdQuickThemeSettings,
          ...patch,
        };
        if (typeof patch.fontSize === "number" && typeof patch.compareVerseFontSizeLeft !== "number") {
          nextLowerThirdSettings.compareVerseFontSizeLeft = patch.fontSize;
          nextLowerThirdSettings.compareVerseFontSizeRight = patch.fontSize;
          nextLowerThirdSettings.compareAutoFitMaxFontSize = patch.fontSize;
        }
        if (typeof patch.refFontSize === "number" && typeof patch.compareReferenceFontSizeLeft !== "number") {
          nextLowerThirdSettings.compareReferenceFontSizeLeft = patch.refFontSize;
          nextLowerThirdSettings.compareReferenceFontSizeRight = patch.refFontSize;
        }
      }
    }

    // Keep navigation on the just-clicked settings while OBS performs an
    // optional fit measurement. React state can commit after the next verse
    // click, so update live snapshot before awaiting the renderer.
    if (hasSettingsPatch) {
      if (isFullscreen) {
        liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
          baseFullscreenTheme,
          nextFullscreenSettings,
        ).settings;
        setFullscreenQuickThemeSettings(nextFullscreenSettings);
        setSavedFullscreenQuickThemeSettings(nextFullscreenSettings);
      } else {
        liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
          baseLowerThirdTheme,
          nextLowerThirdSettings,
        ).settings;
        setLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        setSavedLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
      }
    }

    const requestedSettings = isFullscreen
      ? nextFullscreenSettings
      : nextLowerThirdSettings;
    const measurement = hasSettingsPatch
      ? await refreshCurrentBibleOutputAfterThemeSave(
        liveMode,
        requestedSettings,
        nextLineCount !== null ? { lineCount: nextLineCount } : undefined,
      )
      : nextLineCount !== null
        ? await refreshCurrentBibleOutputForLineCount(nextLineCount)
        : null;

    if (measurement && !compareEnabled) {
      if (isFullscreen) {
        nextFullscreenSettings = applyMeasuredFontFitSettings(nextFullscreenSettings, measurement);
      } else {
        nextLowerThirdSettings = applyMeasuredFontFitSettings(nextLowerThirdSettings, measurement);
      }
    }

    if (hasSettingsPatch || (measurement && !compareEnabled)) {
      if (isFullscreen) {
        liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings(
          baseFullscreenTheme,
          nextFullscreenSettings,
        ).settings;
        setFullscreenQuickThemeSettings(nextFullscreenSettings);
        setSavedFullscreenQuickThemeSettings(nextFullscreenSettings);
      } else {
        liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings(
          baseLowerThirdTheme,
          nextLowerThirdSettings,
        ).settings;
        setLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        setSavedLowerThirdQuickThemeSettings(nextLowerThirdSettings);
        if (hasSettingsPatch) {
          setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
        }
      }
    }

    let nextProfiles: DockSceneQuickThemeSettings | undefined;
    if (isSceneProfileActive && (hasSettingsPatch || (measurement && !compareEnabled))) {
      const existingProfile = sceneQuickThemeSettingsRef.current[activeSceneProfileId] ?? {};
      const fallbackTheme = isFullscreen ? selectedBibleThemeRef.current : selectedLowerThirdThemeRef.current;
      const storedThemeSettings = isFullscreen
        ? existingProfile.fullscreenThemeSettings
        : existingProfile.lowerThirdThemeSettings;
      const baseTheme = !storedThemeSettings
        ? resolveThemeForOverlayMode(fallbackTheme, liveMode)
        : {
          ...resolveThemeForOverlayMode(fallbackTheme, liveMode),
          settings: storedThemeSettings as unknown as BibleThemeSettings,
        };
      const nextTheme = isFullscreen
        ? applyFullscreenQuickThemeSettings(baseTheme, nextFullscreenSettings)
        : applyLowerThirdQuickThemeSettings(baseTheme, nextLowerThirdSettings);

      const nextProfile: DockSceneQuickThemeProfile = {
        ...existingProfile,
        ...(isFullscreen
          ? {
            fullscreen: { ...nextFullscreenSettings },
            fullscreenThemeId: existingProfile.fullscreenThemeId ?? fallbackTheme.id,
            fullscreenThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
          }
          : {
            lowerThird: { ...nextLowerThirdSettings },
            lowerThirdThemeId: existingProfile.lowerThirdThemeId ?? fallbackTheme.id,
            lowerThirdThemeSettings: nextTheme.settings as unknown as Record<string, unknown>,
          }),
      };
      nextProfiles = {
        ...sceneQuickThemeSettingsRef.current,
        [activeSceneProfileId]: nextProfile,
      };
      sceneQuickThemeSettingsRef.current = nextProfiles;
      setSceneQuickThemeSettings(nextProfiles);
    }

    persistDockBiblePreferencesNow({
      ...((hasSettingsPatch || (measurement && !compareEnabled))
        ? {
          ...(isFullscreen
            ? { fullscreenQuickThemeSettings: nextFullscreenSettings }
            : {
              lowerThirdQuickThemeSettings: nextLowerThirdSettings,
              lowerThirdQuickThemeSettingsLinkedToFullscreen: false,
            }),
        }
        : {}),
      ...(nextProfiles ? { sceneQuickThemeSettings: nextProfiles } : {}),
      verseLineCount: nextLineCount !== null ? nextLineCount : verseLineCount,
      ...(isFullscreen
        ? (nextLineCount !== null ? { fullscreenVerseLineCount: nextLineCount } : {})
        : (nextLineCount !== null ? { lowerThirdVerseLineCount: nextLineCount } : {})),
    });
  }, [
    activeFullscreenQuickThemeSettings,
    activeLowerThirdQuickThemeSettings,
    activeSceneProfileId,
    baseFullscreenTheme,
    baseLowerThirdTheme,
    compareEnabled,
    fullscreenOnlyMode,
    isSceneProfileActive,
    persistDockBiblePreferencesNow,
    refreshCurrentBibleOutputAfterThemeSave,
    refreshCurrentBibleOutputForLineCount,
    verseLineCount,
  ]);

  const activeBrowserFontSettings = fullscreenOnlyMode || overlayMode === "fullscreen"
    ? activeFullscreenQuickThemeSettings
    : activeLowerThirdQuickThemeSettings;
  const browserFontMode = fullscreenOnlyMode || overlayMode === "fullscreen" ? "fullscreen" : "lower-third";
  const browserFontSizeMin = browserFontMode === "fullscreen"
    ? 16
    : LOWER_THIRD_FIT_MIN_FONT_SIZE;
  const browserFontSizeMax = browserFontMode === "fullscreen" ? 200 : LOWER_THIRD_FONT_SIZE_MAX;
  const browserReferenceFontSizeMin = browserFontMode === "fullscreen"
    ? 10
    : LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE;
  const browserReferenceFontSizeMax = browserFontMode === "fullscreen"
    ? 150
    : LOWER_THIRD_REFERENCE_FONT_SIZE_MAX;
  const displayedBrowserFontSettings = {
    ...(draftBrowserQuickThemeSettings ?? activeBrowserFontSettings),
    autoFontScale: true as const,
  };
  // A ready-made layer theme draws its own text, so the quick buttons change its text
  // size (a percent of the design), bold and italic instead of the plain font settings.
  const browserLayerLayout = (browserFontMode === "fullscreen" ? baseFullscreenTheme : baseLowerThirdTheme)?.settings?.layout ?? null;
  const quickControlSettings = browserLayerLayout
    ? (() => {
      const designed = layoutVerseStyle(browserLayerLayout);
      const bold = displayedBrowserFontSettings.layoutBold ?? designed.bold;
      const italic = displayedBrowserFontSettings.layoutItalic ?? designed.italic;
      return {
        ...displayedBrowserFontSettings,
        fontWeight: bold ? "bold" as const : "normal" as const,
        fontStyle: italic ? "italic" as const : "normal" as const,
      };
    })()
    : displayedBrowserFontSettings;
  const displayedBrowserVerseLineCount = draftBrowserVerseLineCount ?? verseLineCount;
  const isFitTextMode = true;
  const hasPendingBrowserQuickChanges =
    draftBrowserQuickThemeSettings !== null || draftBrowserVerseLineCount !== null;

  const applyBrowserQuickSettingsPatch = useCallback((patch: BibleBrowserQuickSettingsPatch) => {
    const nextPatch: BibleBrowserQuickSettingsPatch = {
      ...patch,
      autoFontScale: true,
      ...(browserFontMode === "lower-third"
        ? {
          fontSize: Math.max(
            LOWER_THIRD_FIT_MIN_FONT_SIZE,
            Number(patch.fontSize ?? activeBrowserFontSettings.fontSize),
          ),
          refFontSize: Math.max(
            LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
            Number(patch.refFontSize ?? activeBrowserFontSettings.refFontSize),
          ),
        }
        : {}),
    };

    if (typeof patch.fontSize === "number" && typeof patch.compareVerseFontSizeLeft !== "number") {
      nextPatch.compareVerseFontSizeLeft = patch.fontSize;
      nextPatch.compareVerseFontSizeRight = patch.fontSize;
      nextPatch.compareAutoFitMaxFontSize = patch.fontSize;
    }
    if (typeof patch.refFontSize === "number" && typeof patch.compareReferenceFontSizeLeft !== "number") {
      nextPatch.compareReferenceFontSizeLeft = patch.refFontSize;
      nextPatch.compareReferenceFontSizeRight = patch.refFontSize;
    }

    void handleSyncBibleBrowserSettings(nextPatch);
  }, [
    activeBrowserFontSettings,
    browserFontMode,
    handleSyncBibleBrowserSettings,
  ]);

  const handleLowerThirdSizePresetChange = useCallback((
    option: DockQuickSizeOption,
  ) => {
    const preset = LOWER_THIRD_SIZE_PRESETS[option.preset];
    const cardPadding = option.cardPadding ?? preset.padding;
    const horizontalPadding = Math.round(cardPadding * 1.55);
    const nextVerseSize = clampNumber(
      option.fontSize,
      browserFontSizeMin,
      browserFontSizeMax,
    );
    const nextReferenceSize = clampNumber(
      option.refFontSize,
      browserReferenceFontSizeMin,
      browserReferenceFontSizeMax,
    );
    // Layer themes: LG is the size the theme was designed at; XL and 2XL grow by the same
    // steps the plain themes use.
    const presetList = browserFontMode === "fullscreen" ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;
    const baseOption = presetList[0];
    const layerScale = browserLayerLayout && baseOption
      ? {
        layoutTextScale: clampNumber(Math.round((option.fontSize / baseOption.fontSize) * 100), LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
        layoutRefScale: clampNumber(Math.round((option.refFontSize / baseOption.refFontSize) * 100), LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
      }
      : {};
    const patch: BibleBrowserQuickSettingsPatch = {
      ...layerScale,
      fontSize: nextVerseSize,
      refFontSize: nextReferenceSize,
      fontWeight: option.fontWeight ?? "bold",
      refFontWeight: option.refFontWeight ?? "bold",
      lineHeight: preset.lineHeight,
      refSpacing: option.refSpacing ?? preset.refSpacing,
      lowerThirdSize: option.preset,
      lowerThirdWidthPreset: activeBrowserFontSettings.lowerThirdWidthPreset === "full" ? "full" : option.width,
      lowerThirdCardPadding: `${cardPadding}px ${horizontalPadding}px`,
      lowerThirdBarMaxHeight: option.cardMaxHeight ?? preset.maxHeight,
      compareVerseFontSizeLeft: nextVerseSize,
      compareVerseFontSizeRight: nextVerseSize,
      compareReferenceFontSizeLeft: nextReferenceSize,
      compareReferenceFontSizeRight: nextReferenceSize,
      compareAutoFitMaxFontSize: nextVerseSize,
    };
    applyBrowserQuickSettingsPatch(patch);
    // Presets (LG, XL, 2XL) should immediately apply and update output:
    void handleSyncBibleBrowserSettings(patch);
    setDraftBrowserQuickThemeSettings(null);
  }, [
    activeBrowserFontSettings.lowerThirdWidthPreset,
    browserFontMode,
    browserLayerLayout,
    applyBrowserQuickSettingsPatch,
    browserFontSizeMax,
    browserFontSizeMin,
    browserReferenceFontSizeMax,
    browserReferenceFontSizeMin,
    handleSyncBibleBrowserSettings,
  ]);

  const handleBrowserFontSizeStep = useCallback((delta: number) => {
    const currentSize = displayedBrowserFontSettings.fontSize || (browserFontMode === "fullscreen" ? 56 : 36);
    const nextSize = clampNumber(currentSize + delta, browserFontSizeMin, browserFontSizeMax);
    const nextRefSize = clampNumber(
      Math.round(nextSize * (browserFontMode === "fullscreen" ? 0.7 : 0.8)),
      browserReferenceFontSizeMin,
      browserReferenceFontSizeMax,
    );
    // Layer themes: the same step, as a change of the text size percent.
    const stepRatio = currentSize > 0 ? nextSize / currentSize : 1;
    const layerScale = browserLayerLayout
      ? (() => {
        const now = readLayoutAdjust(displayedBrowserFontSettings);
        return {
          layoutTextScale: clampNumber(Math.round(now.layoutTextScale * stepRatio), LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
          layoutRefScale: clampNumber(Math.round(now.layoutRefScale * stepRatio), LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX),
        };
      })()
      : {};
    const patch: BibleBrowserQuickSettingsPatch = {
      ...layerScale,
      fontSize: nextSize,
      refFontSize: nextRefSize,
      compareVerseFontSizeLeft: nextSize,
      compareVerseFontSizeRight: nextSize,
      compareAutoFitMaxFontSize: nextSize,
      compareReferenceFontSizeLeft: nextRefSize,
      compareReferenceFontSizeRight: nextRefSize,
    };
    applyBrowserQuickSettingsPatch(patch);
    void handleSyncBibleBrowserSettings(patch);
    setDraftBrowserQuickThemeSettings(null);
  }, [
    applyBrowserQuickSettingsPatch,
    browserFontMode,
    browserFontSizeMax,
    browserFontSizeMin,
    browserReferenceFontSizeMax,
    browserReferenceFontSizeMin,
    browserLayerLayout,
    displayedBrowserFontSettings,
    handleSyncBibleBrowserSettings,
  ]);

  // Bold / italic from the quick menu: applies to whichever layout (full screen or
  // lower third) is active, the same way the size buttons do.
  const handleBrowserTextStyleChange = useCallback((patch: BibleBrowserQuickSettingsPatch) => {
    // Layer themes read Bold / Italic from their own fields, not the plain font settings.
    const layerStyle: BibleBrowserQuickSettingsPatch = browserLayerLayout
      ? {
        ...(patch.fontWeight !== undefined ? { layoutBold: ["bold", "extrabold", "black"].includes(String(patch.fontWeight)) } : {}),
        ...(patch.fontStyle !== undefined ? { layoutItalic: patch.fontStyle === "italic" } : {}),
      }
      : {};
    applyBrowserQuickSettingsPatch({ ...patch, ...layerStyle });
    setDraftBrowserQuickThemeSettings(null);
  }, [applyBrowserQuickSettingsPatch, browserLayerLayout]);

  const handleBrowserVerseLineCountChange = useCallback((lineCount: number) => {
    const safeLineCount = clampVerseLineCount(lineCount);
    // Line count changes the actual passage layout, so apply and re-fit it
    // immediately. Font/style edits can still use the explicit Save flow.
    void handleSyncBibleBrowserSettings({}, safeLineCount);
  }, [handleSyncBibleBrowserSettings]);

  const saveBrowserQuickSettings = useCallback(async () => {
    if (!hasPendingBrowserQuickChanges) return;
    const patch = draftBrowserQuickThemeSettings
      ? {
        fontSize: draftBrowserQuickThemeSettings.fontSize,
        refFontSize: draftBrowserQuickThemeSettings.refFontSize,
        fontWeight: draftBrowserQuickThemeSettings.fontWeight,
        refFontWeight: draftBrowserQuickThemeSettings.refFontWeight,
        lineHeight: draftBrowserQuickThemeSettings.lineHeight,
        refSpacing: draftBrowserQuickThemeSettings.refSpacing,
        compareVerseFontSizeLeft: draftBrowserQuickThemeSettings.compareVerseFontSizeLeft,
        compareVerseFontSizeRight: draftBrowserQuickThemeSettings.compareVerseFontSizeRight,
        compareReferenceFontSizeLeft: draftBrowserQuickThemeSettings.compareReferenceFontSizeLeft,
        compareReferenceFontSizeRight: draftBrowserQuickThemeSettings.compareReferenceFontSizeRight,
        compareAutoFitMaxFontSize: draftBrowserQuickThemeSettings.compareAutoFitMaxFontSize,
        autoFontScale: true,
        referenceBackgroundEnabled: draftBrowserQuickThemeSettings.referenceBackgroundEnabled,
        referenceBackgroundColor: draftBrowserQuickThemeSettings.referenceBackgroundColor,
        referenceBackgroundStyle: draftBrowserQuickThemeSettings.referenceBackgroundStyle,
        referenceBackgroundRadius: draftBrowserQuickThemeSettings.referenceBackgroundRadius,
        lowerThirdSize: draftBrowserQuickThemeSettings.lowerThirdSize,
        lowerThirdWidthPreset: draftBrowserQuickThemeSettings.lowerThirdWidthPreset,
        lowerThirdCardPadding: draftBrowserQuickThemeSettings.lowerThirdCardPadding,
        lowerThirdBarMaxHeight: draftBrowserQuickThemeSettings.lowerThirdBarMaxHeight,
      } satisfies BibleBrowserQuickSettingsPatch
      : {};

    await handleSyncBibleBrowserSettings(patch, draftBrowserVerseLineCount ?? undefined);
    setDraftBrowserQuickThemeSettings(null);
    setDraftBrowserVerseLineCount(null);
    onSaveFeedback?.(t("dock.feedback.bibleDisplaySaved", "Bible display settings saved."));
  }, [
    draftBrowserQuickThemeSettings,
    draftBrowserVerseLineCount,
    handleSyncBibleBrowserSettings,
    hasPendingBrowserQuickChanges,
    onSaveFeedback,
    t,
  ]);

  const handleBrowserQuickUpdateImmediatelyChange = useCallback((checked: boolean) => {
    setBrowserQuickUpdateImmediately(checked);
    saveDockBibleUiPreferencePatch({ browserQuickUpdateImmediately: checked });
    if (checked && hasPendingBrowserQuickChanges) {
      void saveBrowserQuickSettings();
    }
  }, [hasPendingBrowserQuickChanges, saveBrowserQuickSettings]);

  const persistQuickActionsPosition = useCallback((top: number, left: number | null) => {
    const nextKey = `${Math.round(top)}:${left === null ? "right" : Math.round(left)}`;
    if (quickActionsLastSavedPositionRef.current === nextKey) return;
    quickActionsLastSavedPositionRef.current = nextKey;
    quickActionsNeedsInitialCenterRef.current = false;
    saveDockBibleUiPreferencePatch({
      quickActionsTop: top,
      quickActionsLeft: left,
    });
  }, []);

  const handleQuickActionsClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (quickActionsSuppressClickRef.current) {
      quickActionsSuppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setShowBrowserFontSizePopover((current) => !current);
  }, []);

  const handleQuickActionsPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const handleElement = event.currentTarget.parentElement;
    const positioningContainer = quickActionsContainerRef.current;
    const containerWidth = positioningContainer?.clientWidth ?? 0;
    const containerHeight = positioningContainer?.clientHeight ?? 0;
    const measuredLeft = getMeasuredQuickActionsLeft(
      handleElement,
      positioningContainer,
      clampQuickActionsLeft(containerWidth - QUICK_ACTIONS_HANDLE_WIDTH, containerWidth),
    );
    const startLeft = clampQuickActionsLeft(
      quickActionsLeftRef.current ?? measuredLeft,
      containerWidth,
    );
    quickActionsDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft,
      startTop: quickActionsTopRef.current,
      currentLeft: startLeft,
      currentTop: quickActionsTopRef.current,
      containerWidth,
      containerHeight,
      didDrag: false,
    };
    setIsQuickActionsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded browsers may not support pointer capture.
    }
  }, []);

  const handleQuickActionsPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = quickActionsDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaY = event.clientY - drag.startY;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaY) > 3 || Math.abs(deltaX) > 3) {
      drag.didDrag = true;
    }
    if (!drag.didDrag) return;

    event.preventDefault();
    const nextTop = clampQuickActionsTop(drag.startTop + deltaY, drag.containerHeight);
    const nextLeft = clampQuickActionsLeft(drag.startLeft + deltaX, drag.containerWidth);
    drag.currentTop = nextTop;
    drag.currentLeft = nextLeft;
    quickActionsTopRef.current = nextTop;
    quickActionsLeftRef.current = nextLeft;
    setQuickActionsTop(nextTop);
    setQuickActionsLeft(nextLeft);
  }, []);

  const finishQuickActionsDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = quickActionsDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Some embedded browsers may not support pointer capture.
    }

    quickActionsDragRef.current = null;
    setIsQuickActionsDragging(false);

    if (!drag.didDrag) return;

    event.preventDefault();
    event.stopPropagation();

    const nextTop = clampQuickActionsTop(drag.currentTop, drag.containerHeight);
    const nextLeft = snapQuickActionsLeft(drag.currentLeft, drag.containerWidth);
    quickActionsTopRef.current = nextTop;
    quickActionsLeftRef.current = nextLeft;
    setQuickActionsTop(nextTop);
    setQuickActionsLeft(nextLeft);
    persistQuickActionsPosition(nextTop, nextLeft);

    quickActionsSuppressClickRef.current = true;
    window.setTimeout(() => {
      quickActionsSuppressClickRef.current = false;
    }, 150);
  }, [persistQuickActionsPosition]);

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
    setCompareEnabled(mode === "compare");
    persistDockBiblePreferencesNow({
      displayMode: mode,
      compareEnabled: mode === "compare",
    });
  }, [persistDockBiblePreferencesNow]);

  const handleCompareEnabledChange = useCallback((enabled: boolean) => {
    setCompareEnabled(enabled);
    setDisplayMode(enabled ? "compare" : "single");
    persistDockBiblePreferencesNow({
      compareEnabled: enabled,
      displayMode: enabled ? "compare" : "single",
    });
  }, [persistDockBiblePreferencesNow]);

  const handleCompareModeChange = useCallback((mode: CompareMode) => {
    setCompareMode(mode);
    persistDockBiblePreferencesNow({
      compareMode: mode,
    });
  }, [persistDockBiblePreferencesNow]);

  // Preserve contract for narrow layout tests:
  // setShowComparePopover(true);
  // t("dock.compare.short", "Compare")

  const selectedVerseRef = useRef(selectedVerse);
  useEffect(() => {
    selectedChapterRef.current = selectedChapter;
  }, [selectedChapter]);
  useEffect(() => {
    selectedVerseRef.current = selectedVerse;
  }, [selectedVerse]);
  useEffect(() => {
    selectedBibleThemeRef.current = selectedBibleTheme;
  }, [selectedBibleTheme]);
  useEffect(() => {
    selectedLowerThirdThemeRef.current = selectedLowerThirdTheme;
  }, [selectedLowerThirdTheme]);
  useEffect(() => {
    backgroundPresetRef.current = backgroundPreset;
  }, [backgroundPreset]);

  // Mode, theme, and line-count changes are saved locally. If Bible is already
  // live, the active OBS output is republished immediately; hidden output is
  // picked up by the next explicit send.

  useEffect(() => {
    if (!initialVoiceBible) return;
    setVoiceBible(initialVoiceBible);
  }, [initialVoiceBible]);

  // Keep latestStagedRef in sync so background-push effects can read staged
  // data without adding `staged` to their dependency arrays (which would
  // cause extra re-renders or loops).
  useEffect(() => {
    latestStagedRef.current = staged;
  }, [compareLayout, staged]);

  useEffect(() => {
    if (staged === previousStagedRef.current) return;
    previousStagedRef.current = staged;
    if (!staged || staged.type !== "bible") return;
    const data = (staged.data ?? null) as Record<string, unknown> | null;
    if (!data) return;

    const book = typeof data.book === "string" ? data.book : null;
    const chapter = typeof data.chapter === "number" ? data.chapter : null;
    const verse = typeof data.verse === "number" ? data.verse : null;
    const translation = typeof data.translation === "string" ? data.translation.toUpperCase() : null;
    const stagedColumnIndex =
      typeof data.columnIndex === "number"
        ? Math.min(Math.max(data.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
        : null;
    const lineCount = typeof data.lineCount === "number" ? clampVerseLineCount(data.lineCount) : null;
    const shouldReveal = data.reveal !== false;
    const nextOverlayMode =
      data.overlayMode === "fullscreen" || data.overlayMode === "lower-third"
        ? (data.overlayMode as OverlayMode)
        : null;

    const currentVerse = selectedVerseRef.current;
    const isSameFocusedReference =
      book === selectedBook &&
      chapter === selectedChapter &&
      verse === currentVerse;

    if (book && BOOK_CHAPTERS[book] && book !== selectedBook) {
      setSelectedBook(book);
    }
    if (chapter && chapter !== selectedChapter) {
      setSelectedChapter(chapter);
    }
    if (verse && verse !== currentVerse) {
      setSelectedVerse(verse);
      selectedVerseRef.current = verse;
    }
    if (verse && !isSameFocusedReference) {
      pendingScrollVerseRef.current = shouldReveal ? verse : null;
    }
    if (translation) {
      setColumnTranslations((current) => {
        const targetIndex = stagedColumnIndex ?? activeColumnIndex;
        if ((current[targetIndex] ?? "").toUpperCase() === translation) {
          return current;
        }
        const next = [...current];
        next[targetIndex] = translation;
        return next;
      });
    }
    if (lineCount) {
      setVerseLineCount(lineCount);
    }
    if (nextOverlayMode && !readDockBibleOverlayMode()) {
      setOverlayMode(nextOverlayMode);
    }
  }, [staged]);

  const applyVoiceResult = useCallback(
    (result: VoiceBibleResult | null) => {
      if (!result) return;

      if (result.action === "set-translation" && result.translation) {
        setColumnTranslations((current) => {
          const next = [...current];
          next[activeColumnIndex] = result.translation!.toUpperCase();
          return next;
        });
        return;
      }

      if (result.action === "set-chapter" && result.book && result.chapter) {
        setSelectedBook(result.book);
        setSelectedChapter(result.chapter);
        setSelectedVerse(null);
        setSearchQuery("");
        setShowDropdown(false);
        pendingScrollVerseRef.current = null;
        return;
      }

      if (
        result.action === "stage-verse" &&
        result.book &&
        result.chapter &&
        result.verse
      ) {
        if (result.translation && result.translation !== activeTranslation) {
          setColumnTranslations((current) => {
            const next = [...current];
            next[activeColumnIndex] = result.translation!.toUpperCase();
            return next;
          });
        }
        // Fire-and-forget — UI updates via onStage inside stageVerse (Rule 1)
        void stageVerse(result.book, result.chapter, result.verse, {
          translation: result.translation ?? activeTranslation,
          columnIndex: activeColumnIndex,
        });
      }
    },
    [activeColumnIndex, activeTranslation, stageVerse],
  );

  useEffect(() => {
    const unsub = dockClient.onState((msg: DockStateMessage) => {
      if (msg.type === "state:update") {
        const payload = msg.payload as Record<string, unknown>;
        if (payload.voiceBible) {
          if (voiceBridgeTimeoutRef.current) {
            clearTimeout(voiceBridgeTimeoutRef.current);
            voiceBridgeTimeoutRef.current = null;
          }
          voiceFallbackReadyRef.current = true;
          lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
          lastVoiceResultKeyRef.current = getVoiceBibleResultKey(
            (payload.voiceBible as VoiceBibleSnapshot).lastResult,
          );
          setVoiceBible(payload.voiceBible as VoiceBibleSnapshot);
        }
        return;
      }

      if (msg.type === "state:voice-bible-status") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        lastVoiceResultKeyRef.current = getVoiceBibleResultKey(
          (msg.payload as VoiceBibleSnapshot).lastResult,
        );
        setVoiceBible(msg.payload as VoiceBibleSnapshot);
        return;
      }

      if (msg.type === "state:voice-bible-candidates") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        const payload = msg.payload as {
          transcript?: string;
          detail?: string;
          candidates?: VoiceBibleCandidate[];
        };
        setVoiceBible((current) => ({
          ...current,
          transcript: payload.transcript ?? current.transcript,
          detail: payload.detail ?? current.detail,
          candidates: payload.candidates ?? [],
        }));
        return;
      }

      if (msg.type === "state:voice-bible-result") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        const payload = (msg.payload ?? null) as VoiceBibleResult | null;
        lastVoiceResultKeyRef.current = getVoiceBibleResultKey(payload);
        void applyVoiceResult(payload);
      }
    });

    return unsub;
  }, [applyVoiceResult]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let consecutiveMisses = 0;

    const pollVoiceState = async () => {
      if (cancelled) return;
      if (!isDockTabVisible(containerRef.current)) {
        timeoutId = window.setTimeout(() => { void pollVoiceState(); }, 1000);
        return;
      }
      const fallback = await loadVoiceBibleDockState();
      if (!fallback || cancelled) {
        consecutiveMisses++;
        // Back off: after 3 misses, slow to 30s. Reset on next success.
        const nextDelay = consecutiveMisses >= 3
          ? 30_000
          : appConnected ? 5000 : 3000;
        timeoutId = window.setTimeout(() => { void pollVoiceState(); }, nextDelay);
        return;
      }

      consecutiveMisses = 0;
      if (fallback.updatedAt <= lastVoiceEventTimestampRef.current) {
        timeoutId = window.setTimeout(() => { void pollVoiceState(); }, appConnected ? 5000 : 3000);
        return;
      }

      lastVoiceEventTimestampRef.current = fallback.updatedAt;
      if (voiceBridgeTimeoutRef.current) {
        clearTimeout(voiceBridgeTimeoutRef.current);
        voiceBridgeTimeoutRef.current = null;
      }

      const resultKey = getVoiceBibleResultKey(fallback.snapshot.lastResult);
      const shouldSkipInitialReplay =
        !voiceFallbackReadyRef.current &&
        !voiceHeldRef.current &&
        voiceBible.status === "idle";

      voiceFallbackReadyRef.current = true;
      setVoiceBible(fallback.snapshot);

      if (shouldSkipInitialReplay) {
        lastVoiceResultKeyRef.current = resultKey;
      } else if (resultKey && resultKey !== lastVoiceResultKeyRef.current) {
        lastVoiceResultKeyRef.current = resultKey;
        await applyVoiceResult(fallback.snapshot.lastResult ?? null);
      } else if (!resultKey) {
        lastVoiceResultKeyRef.current = "";
      }

      timeoutId = window.setTimeout(() => { void pollVoiceState(); }, appConnected ? 5000 : 3000);
    };

    void pollVoiceState();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [appConnected, applyVoiceResult, voiceBible.status]);

  // ── Listen for LM Dock navigate commands ──
  // BroadcastChannel handles localhost tabs in the same origin. The HTTP
  // relay below handles an LM dock and Bible dock in separate OBS CEF
  // processes, where BroadcastChannel cannot cross the process boundary.
  const handledLmCommandIdsRef = useRef<Set<string>>(new Set());
  const handleLmNavigateCommand = useCallback((cmd: {
    type?: string;
    commandId?: string;
    payload?: unknown;
  } | null) => {
    if (cmd?.type !== "lm:navigate") return;
    const commandId = String(cmd.commandId || "").trim();
    if (commandId) {
      if (handledLmCommandIdsRef.current.has(commandId)) return;
      handledLmCommandIdsRef.current.add(commandId);
      if (handledLmCommandIdsRef.current.size > 100) {
        const oldest = handledLmCommandIdsRef.current.values().next().value;
        if (oldest) handledLmCommandIdsRef.current.delete(oldest);
      }
    }

    const payload = cmd.payload as {
      book?: string;
      chapter?: number;
      verse?: number;
      translation?: string;
      pushToPreview?: boolean;
      markLive?: boolean;
    };
    if (!payload.book || !payload.chapter) return;

    focusReference(payload.book, payload.chapter, payload.verse ?? null);
    if (payload.markLive) {
      // LM already put this verse on the output using this tab's style. Only
      // bring this tab in line with it: the list is on the verse (above), the
      // output counts as visible, and any older push still in flight from
      // this tab is dropped so it cannot overwrite what LM just sent.
      liveVerseRequestIdRef.current += 1;
      setBibleOverlayVisible(true);
      return;
    }
    void (async () => {
      if (!payload.pushToPreview) {
        await stageVerse(payload.book!, payload.chapter!, payload.verse ?? 1, {
          translation: payload.translation,
        });
        return;
      }

      try {
        if (!presentationLinkMode) {
          await dockObsClient.preparePlannerOutput("bible", false);
        }
        await goLiveVerse(payload.book!, payload.chapter!, payload.verse ?? 1, {
          translation: payload.translation,
          recordHistory: false,
        });
      } catch (error) {
        console.warn("[DockBibleTab] LM history preview push failed; staging verse instead:", error);
        await stageVerse(payload.book!, payload.chapter!, payload.verse ?? 1, {
          translation: payload.translation,
        });
      }
    })();
  }, [focusReference, goLiveVerse, presentationLinkMode, stageVerse]);

  // ── Schedule / History go-live: move the verse list to that verse ──
  // Works whether this tab is already mounted (event) or is mounted a moment
  // after the Schedule drawer switched to it (pending selection).
  useEffect(() => {
    const applySelection = (detail: DockSelectBibleVerseDetail | null | undefined) => {
      if (!detail?.book || !detail.chapter) return;
      focusReference(detail.book, detail.chapter, detail.verse ?? null);
      liveVerseRequestIdRef.current += 1;
      setBibleOverlayVisible(true);
    };
    const pending = getPendingBibleVerseSelection();
    if (pending) {
      setPendingBibleVerseSelection(null);
      applySelection(pending);
    }
    const handleSelectEvent = (event: Event) => {
      setPendingBibleVerseSelection(null);
      applySelection((event as CustomEvent<DockSelectBibleVerseDetail>).detail);
    };
    window.addEventListener(DOCK_SELECT_BIBLE_VERSE_EVENT, handleSelectEvent);
    return () => window.removeEventListener(DOCK_SELECT_BIBLE_VERSE_EVENT, handleSelectEvent);
  }, [focusReference]);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("ocs-dock-commands");
      channel.onmessage = (ev) => {
        handleLmNavigateCommand(ev.data as {
          type?: string;
          commandId?: string;
          payload?: unknown;
        } | null);
      };
    } catch { /* BroadcastChannel not available */ }
    return () => { channel?.close(); };
  }, [handleLmNavigateCommand]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const pollNavigationRelay = async () => {
      if (disposed || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch(
          `${getOverlayBaseUrlSync()}/api/lm-bible-navigation?_=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const raw = await response.json() as unknown;
        if (!Array.isArray(raw)) return;
        raw.forEach((item) => {
          const command = typeof item === "string"
            ? (() => {
              try { return JSON.parse(item) as { type?: string; commandId?: string; payload?: unknown }; } catch { return null; }
            })()
            : item as { type?: string; commandId?: string; payload?: unknown };
          handleLmNavigateCommand(command);
        });
      } catch {
        // The relay is a cross-process fallback; local BroadcastChannel still works.
      } finally {
        inFlight = false;
      }
    };

    void pollNavigationRelay();
    const timer = window.setInterval(
      () => void pollNavigationRelay(),
      getRecommendedPollingInterval(500),
    );
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [handleLmNavigateCommand]);

  useEffect(() => () => {
    voiceHeldRef.current = false;
    if (voiceBridgeTimeoutRef.current) {
      clearTimeout(voiceBridgeTimeoutRef.current);
      voiceBridgeTimeoutRef.current = null;
    }
    const command = createVoiceBibleDockCommand("voice-bible:cancel");
    dockClient.sendCommand(command);
    void postVoiceBibleDockCommand(command).catch(() => { });
  }, []);

  const ensureSearchIndexPreloaded = useCallback(() => {
    void preloadBibleSearch(activeBibleSearchTranslation).catch(() => { });
  }, [activeBibleSearchTranslation]);

  // Build the search index soon after the tab opens or the translation changes. It is built in short
  // slices, so the tab stays responsive, and the first search is ready instead of waiting for it.
  useEffect(() => {
    let cancelled = false;
    let handle: number | ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (!cancelled) {
        void preloadBibleSearch(activeBibleSearchTranslation).catch(() => { });
      }
    };

    const win = typeof window !== "undefined" ? (window as any) : null;
    if (win && typeof win.requestIdleCallback === "function") {
      handle = win.requestIdleCallback(run, { timeout: 3000 });
    } else {
      handle = setTimeout(run, 3000);
    }

    return () => {
      cancelled = true;
      if (handle !== null) {
        if (win && typeof win.cancelIdleCallback === "function" && typeof handle === "number") {
          win.cancelIdleCallback(handle);
        } else {
          clearTimeout(handle);
        }
      }
    };
  }, [activeBibleSearchTranslation]);

  // ── Smart search results (Instant: evaluates in < 0.0001s on every keystroke) ──
  const referenceResults = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return [];

    const searchContext = {
      currentBook: selectedBook,
      currentChapter: selectedChapter,
      currentVerse: selectedVerse,
    };

    // 1. Prefer the typed-reference parser. It understands compact input such
    // as "john55" → "John 5:5", contextual jumps like ".18" or "+1", translation
    // tags like "~msg", mode directives like "!lt", and shortcodes/macros.
    const typedResults = parseBibleSearch(raw, { context: searchContext });
    if (typedResults.length > 0) {
      return typedResults.map((result) => ({
        ...result,
        kind: "reference" as const,
      }));
    }

    // 2. Fall back to spoken/STT normalization for inputs such as
    // "first samuel 17 45" → "1 Samuel 17:45".
    const normalized = normalizeScriptureReference(raw);
    if (!normalized) return [];

    return parseBibleSearch(normalized, { context: searchContext }).map((result) => ({
      ...result,
      kind: "reference" as const,
    }));
  }, [searchQuery, selectedBook, selectedChapter, selectedVerse]);

  // ── Active Translation Directive Prompt (Instant detection on @, ~, /, //) ──
  const activeTranslationPrompt = useMemo(() => {
    return detectActiveTranslationPrompt(searchQuery, {
      context: {
        currentBook: selectedBook,
        currentChapter: selectedChapter,
        currentVerse: selectedVerse,
      },
    });
  }, [searchQuery, selectedBook, selectedChapter, selectedVerse]);

  const translationDirectiveSuggestions = useMemo<DockBibleSearchOption[]>(() => {
    if (!activeTranslationPrompt) return [];
    const suggestions = getTranslationDirectiveSuggestions(
      activeTranslationPrompt,
      availableTranslations,
      8,
    );
    return suggestions.map((s) => ({
      ...s,
      kind: "translation-directive" as const,
      confidence: 100,
    }));
  }, [activeTranslationPrompt, availableTranslations]);

  // ── Concept-based search (e.g., "love", "faith", "hope") ──
  const conceptResults = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return [];
    if (isReferenceLikeBibleQuery(raw)) return [];

    const conceptRefs = getConceptVerses(raw);
    if (conceptRefs.length === 0) return [];

    const results: Array<{ kind: "concept"; book: string; chapter: number; verse: number; label: string; snippet: string; text: string; query: string }> = [];
    const seen = new Set<string>();

    for (const ref of conceptRefs.slice(0, 8)) {
      const match = ref.match(/^(.+)\s+(\d+):(\d+)$/);
      if (!match) continue;
      const [, book, chStr, vsStr] = match;
      const key = `${book} ${chStr}:${vsStr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        kind: "concept",
        book,
        chapter: parseInt(chStr, 10),
        verse: parseInt(vsStr, 10),
        label: `${book} ${chStr}:${vsStr}`,
        snippet: "",
        text: "",
        query: raw,
      });
    }

    return results;
  }, [searchQuery]);

  const keywordSearchSeqRef = useRef(0);

  const runInstantKeywordSearch = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (
        !trimmed ||
        (trimmed.length < MIN_DOCK_KEYWORD_SEARCH_LENGTH && !isNumericOnlyBibleQuery(trimmed))
      ) {
        setKeywordResults([]);
        setKeywordResultsQuery("");
        setIsKeywordSearching(false);
        return;
      }

      if (
        isReferenceLikeBibleQuery(trimmed) &&
        !isNumericOnlyBibleQuery(trimmed)
      ) {
        const typed = parseBibleSearch(trimmed);
        if (typed.length > 0) {
          setKeywordResults([]);
          setKeywordResultsQuery("");
          setIsKeywordSearching(false);
          return;
        }
      }

      const searchId = ++keywordSearchSeqRef.current;
      setIsKeywordSearching(true);
      void (async () => {
        try {
          const matches = await searchBible(trimmed, activeBibleSearchTranslation, DOCK_KEYWORD_SEARCH_LIMIT);
          if (searchId === keywordSearchSeqRef.current) {
            setKeywordResults(matches);
            setKeywordResultsQuery(trimmed);
          }
        } catch (err) {
          if (searchId === keywordSearchSeqRef.current) {
            console.warn("[DockBibleTab] Keyword search failed:", err);
            setKeywordResults([]);
          }
        } finally {
          if (searchId === keywordSearchSeqRef.current) {
            setIsKeywordSearching(false);
          }
        }
      })();
    },
    [activeBibleSearchTranslation],
  );

  useEffect(() => {
    const trimmed = debouncedSearchQuery.trim();
    setKeywordResults([]);
    setKeywordResultsQuery("");

    if (
      !trimmed ||
      (trimmed.length < MIN_DOCK_KEYWORD_SEARCH_LENGTH && !isNumericOnlyBibleQuery(trimmed))
    ) {
      setKeywordResults([]);
      setIsKeywordSearching(false);
      return;
    }

    if (
      isReferenceLikeBibleQuery(trimmed) &&
      referenceResults.length > 0 &&
      !isNumericOnlyBibleQuery(trimmed)
    ) {
      setKeywordResults([]);
      setIsKeywordSearching(false);
      return;
    }

    let cancelled = false;
    setIsKeywordSearching(true);
    void (async () => {
      try {
        const matches = await searchBible(trimmed, activeBibleSearchTranslation, DOCK_KEYWORD_SEARCH_LIMIT);
        if (!cancelled) {
          setKeywordResults(matches);
          setKeywordResultsQuery(trimmed);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[DockBibleTab] Keyword search failed:", err);
          setKeywordResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsKeywordSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBibleSearchTranslation, debouncedSearchQuery, referenceResults.length]);

  const searchResults = useMemo<DockBibleSearchOption[]>(() => {
    // ── Translation Directive Prompt Suggestions (@, ~, /, //) ──
    if (translationDirectiveSuggestions.length > 0) {
      return translationDirectiveSuggestions;
    }
    if (activeTranslationPrompt) {
      return [];
    }

    const currentQuery = searchQuery.trim();
    const keywordMatches = keywordResultsQuery === currentQuery
      ? keywordResults.map((result) => ({
        kind: "keyword" as const,
        book: result.book,
        chapter: result.chapter,
        verse: result.verse,
        endVerse: result.endVerse,
        label: `${result.book} ${result.chapter}:${result.endVerse && result.endVerse > result.verse
          ? `${result.verse}-${result.endVerse}`
          : result.verse} — ${activeBibleSearchTranslation}`,
        snippet: result.snippet,
        text: result.text,
        query: currentQuery,
      }))
      : [];

    // Priority: reference > keyword > concept
    let combinedResults: DockBibleSearchOption[] = [];
    if (referenceResults.length > 0) {
      combinedResults = keywordMatches.length > 0
        ? [...referenceResults, ...keywordMatches]
        : referenceResults;
    } else if (keywordMatches.length > 0) {
      combinedResults = conceptResults.length > 0
        ? [...keywordMatches, ...conceptResults]
        : keywordMatches;
    } else {
      combinedResults = conceptResults;
    }

    if (favoriteRefs.size === 0 || combinedResults.length <= 1) {
      return combinedResults;
    }

    // Starred / favorite verses show first
    const isStarred = (r: DockBibleSearchOption) => {
      if (r.verse !== null) {
        return favoriteRefs.has(`${r.book} ${r.chapter}:${r.verse}`);
      }
      return favoriteRefs.has(`${r.book} ${r.chapter}`);
    };

    const starred = combinedResults.filter(isStarred);
    const nonStarred = combinedResults.filter((r) => !isStarred(r));
    return [...starred, ...nonStarred];
  }, [
    translationDirectiveSuggestions,
    activeTranslationPrompt,
    activeBibleSearchTranslation,
    searchQuery,
    keywordResults,
    keywordResultsQuery,
    referenceResults,
    conceptResults,
    favoriteRefs,
  ]);

  // Reference and concept results are instant (<0.001s).
  // Keyword results appear as soon as the indexed match resolves.
  const searchIsSettled = searchQuery === debouncedSearchQuery;
  const displayedSearchResults = searchResults;

  // ── Close dropdown when clicking outside ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowRecentSearches(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Search change handler ──
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    ensureSearchIndexPreloaded();
    const val = e.target.value;
    setSearchQuery(val);
    setShowDropdown(val.trim().length > 0);
    setShowRecentSearches(val.trim().length === 0 && hasSavedSearches);
    setActiveIdx(-1);
  }, [ensureSearchIndexPreloaded, hasSavedSearches]);

  // ── Keyboard navigation ──
  const handleClearVerse = useCallback(() => {
    visibilityEpochRef.current += 1;
    setSelectedVerse(null);
    setVerseText(null);
    setActionError("");
    pendingScrollVerseRef.current = null;
    onStage(null);
    setBibleOverlayVisible(false);
    if (presentationLinkMode) return;
    ensureObsConnected().then(() => clearBibleFromConfiguredOutput()).catch((err) =>
      console.warn("[DockBibleTab] clearBible failed:", err)
    );
  }, [clearBibleFromConfiguredOutput, onStage, presentationLinkMode]);

  // ── Pick a search result ──
  const handlePickResult = useCallback(
    async (result: DockBibleSearchOption) => {
      setRecentSearches(pushRecentBibleSearch(result.label));
      trackBibleSearch(activeBibleSearchTranslation);
      setSearchQuery("");
      setShowDropdown(false);
      setShowRecentSearches(false);
      setActiveIdx(-1);

      // Handle Quick Clear Overlay Directive (!clear, !blank, .)
      if (result.kind === "reference" && result.action === "clear") {
        handleClearVerse();
        return;
      }

      // Handle Inline Output Mode Override (!lt, !full, !f)
      if (result.kind === "reference" && result.modeOverride) {
        setOverlayMode(result.modeOverride);
        overlayModeRef.current = result.modeOverride;
      }

      // Handle Quick Compare Triggers (// or ||)
      if (result.kind === "reference" && result.compareTranslations) {
        const transA = result.compareTranslations.translationA || activeTranslation;
        const transB = result.compareTranslations.translationB;
        setTranslationA(transA);
        setTranslationB(transB);
        setCompareEnabled(true);
        setCompareMode("translations");
        if (result.book && result.chapter !== null && result.verse !== null) {
          focusReference(result.book, result.chapter, result.verse);
          await goLiveVerse(result.book, result.chapter, result.verse, {
            lineCount: 1,
            compareTranslationsOverride: { translationA: transA, translationB: transB },
            overlayMode: result.modeOverride,
          });
          return;
        }
      }

      // Helper to hot-swap the active translation for the current column
      const applyActiveTranslation = (trans: string) => {
        const nextVal = trans.toUpperCase();
        setColumnTranslations((current) => {
          const next = [...current];
          next[activeColumnIndex] = nextVal;
          return next;
        });
      };

      // Handle Translation Directive Suggestions (@, ~, /, //)
      if (result.kind === "translation-directive") {
        const targetAbbr = result.abbr.toUpperCase();
        if (!result.isInstalled && result.isDownloadable) {
          const catalogItem = POPULAR_CATALOG_BIBLES.find((b) => b.abbr.toUpperCase() === targetAbbr);
          if (catalogItem) {
            try {
              await downloadBibleInDock(catalogItem, availableTranslations.length);
              await loadTranslations();
            } catch (err) {
              console.warn("[DockBibleTab] In-dock download error:", err);
            }
          }
        }

        if (result.trigger === "//" || result.trigger === "||") {
          const transA = activeTranslation;
          const transB = targetAbbr;
          setTranslationA(transA);
          setTranslationB(transB);
          setCompareEnabled(true);
          setCompareMode("translations");
          if (result.baseReference && result.baseReference.book && result.baseReference.chapter !== null && result.baseReference.verse !== null) {
            focusReference(result.baseReference.book, result.baseReference.chapter, result.baseReference.verse);
            await goLiveVerse(result.baseReference.book, result.baseReference.chapter, result.baseReference.verse, {
              lineCount: 1,
              compareTranslationsOverride: { translationA: transA, translationB: transB },
            });
            return;
          }
          return;
        }

        // Hot-swap active translation
        applyActiveTranslation(targetAbbr);

        if (result.baseReference && result.baseReference.book && result.baseReference.chapter !== null && result.baseReference.verse !== null) {
          const impliedLineCount = clampVerseLineCount(
            result.baseReference.endVerse && result.baseReference.endVerse > result.baseReference.verse
              ? result.baseReference.endVerse - result.baseReference.verse + 1
              : 1,
          );
          setVerseLineCount(impliedLineCount);
          focusReference(result.baseReference.book, result.baseReference.chapter, result.baseReference.verse);
          await goLiveVerse(result.baseReference.book, result.baseReference.chapter, result.baseReference.verse, {
            lineCount: impliedLineCount,
            rangeEndVerse: result.baseReference.endVerse ?? null,
            translation: targetAbbr,
            columnIndex: activeColumnIndex,
          });
          return;
        } else if (result.baseReference && result.baseReference.book && result.baseReference.chapter !== null) {
          focusReference(result.baseReference.book, result.baseReference.chapter, 1);
          return;
        } else if (result.baseReference && result.baseReference.book) {
          setSelectedBook(result.baseReference.book);
          setSelectedChapter(1);
          setSelectedVerse(null);
          pendingScrollVerseRef.current = null;
          return;
        }
        return;
      }

      if (result.kind === "keyword" || result.kind === "concept") {
        const keywordOutputOptions = getDockBibleKeywordMatchOutputOptions(result, MAX_VERSE_LINES);
        const impliedLineCount = keywordOutputOptions.lineCount;
        setVerseLineCount(impliedLineCount);
        focusReference(result.book, result.chapter, result.verse);
        if (keywordMatchPushDirectlyToObs) {
          setKeywordActionResult(null);
          await goLiveVerse(result.book, result.chapter, result.verse, {
            translation: activeBibleSearchTranslation,
            lineCount: keywordOutputOptions.lineCount,
            rangeEndVerse: keywordOutputOptions.rangeEndVerse,
            pushComparePassages: true,
          });
          return;
        }
        setKeywordActionResult(result);
        return;
      } else if (result.chapter !== null && result.verse !== null) {
        const impliedLineCount = clampVerseLineCount(
          result.endVerse && result.endVerse > result.verse
            ? result.endVerse - result.verse + 1
            : 1,
        );
        setVerseLineCount(impliedLineCount);
        focusReference(result.book, result.chapter, result.verse);
        const effectiveTranslation = (result.kind === "reference" && result.translationOverride)
          ? result.translationOverride
          : activeBibleSearchTranslation;
        if (result.kind === "reference" && result.translationOverride) {
          const targetOverride = result.translationOverride.toUpperCase();
          const isInstalled = availableTranslations.some(
            (t) => t.value.toUpperCase() === targetOverride,
          );
          if (!isInstalled) {
            const catalogItem = POPULAR_CATALOG_BIBLES.find(
              (b) => b.abbr.toUpperCase() === targetOverride,
            );
            if (catalogItem) {
              try {
                await downloadBibleInDock(catalogItem, availableTranslations.length);
                await loadTranslations();
              } catch (err) {
                console.warn("[DockBibleTab] Auto-download error for reference:", err);
              }
            }
          }
          applyActiveTranslation(result.translationOverride);
        }
        // A concrete Bible search result is an output action, not only a
        // navigation action. Open the matching chapter/verse and send the
        // selected passage through the same OBS path as a verse-row click.
        await goLiveVerse(result.book, result.chapter, result.verse, {
          lineCount: impliedLineCount,
          rangeEndVerse: result.endVerse ?? null,
          translation: effectiveTranslation,
          columnIndex: activeColumnIndex,
          overlayMode: result.kind === "reference" ? result.modeOverride : undefined,
        });
      } else if (result.chapter !== null) {
        if (result.kind === "reference" && result.translationOverride) {
          applyActiveTranslation(result.translationOverride);
        }
        focusReference(result.book, result.chapter, 1);
      } else {
        if (result.kind === "reference" && result.translationOverride) {
          applyActiveTranslation(result.translationOverride);
        }
        setSelectedBook(result.book);
        setSelectedChapter(1);
        setSelectedVerse(null);
        pendingScrollVerseRef.current = null;
      }
    },
    [
      activeColumnIndex,
      activeBibleSearchTranslation,
      activeTranslation,
      availableTranslations,
      focusReference,
      goLiveVerse,
      handleClearVerse,
      keywordMatchPushDirectlyToObs,
      loadTranslations,
      setColumnTranslations,
      stageVerse,
    ]
  );

  const handleGoToChapter = useCallback(
    (result: DockBibleSearchOption) => {
      setRecentSearches(pushRecentBibleSearch(result.label));
      setSearchQuery("");
      setShowDropdown(false);
      setShowRecentSearches(false);
      setActiveIdx(-1);

      if (result.book && result.chapter !== null && result.chapter !== undefined) {
        focusReference(result.book, result.chapter, result.verse ?? 1);
        if (result.verse !== null) {
          window.setTimeout(() => {
            const verseRow = verseGridRef.current?.querySelector<HTMLElement>(
              `[data-verse-row="${result.verse}"]`,
            );
            if (verseRow && verseGridRef.current) {
              const container = verseGridRef.current;
              const verseRect = verseRow.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const targetScrollTop = container.scrollTop + (verseRect.top - containerRect.top) - containerRect.height * 0.1;
              container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
            }
          }, 150);
        }
      } else if (result.book) {
        setSelectedBook(result.book);
        setSelectedChapter(1);
        setSelectedVerse(null);
        pendingScrollVerseRef.current = null;
      }
    },
    [focusReference]
  );

  const applyRecentBibleSearch = useCallback(
    (query: string) => {
      const recentResult = parseBibleSearch(query)[0];
      setSearchQuery("");
      setShowRecentSearches(false);
      setShowDropdown(false);
      setActiveIdx(-1);

      if (recentResult) {
        void handlePickResult({ ...recentResult, kind: "reference" });
      }
    },
    [handlePickResult],
  );

  const handleFavoriteClick = useCallback((favorite: DockFavoriteBibleSearch) => {
    const result = parseBibleSearch(favorite.reference)[0];
    setSearchQuery("");
    setShowRecentSearches(false);
    setShowDropdown(false);
    setActiveIdx(-1);
    if (result) {
      void handlePickResult({ ...result, kind: "reference" });
    }
  }, [handlePickResult]);

  const handleHistoryClick = useCallback((item: BibleHistoryItem) => {
    setShowHistoryDropdown(false);
    focusReference(item.book, item.chapter, item.verse);
  }, [focusReference]);

  const handleHistoryPreview = useCallback((item: BibleHistoryItem) => {
    setShowHistoryDropdown(false);
    void stageVerse(item.book, item.chapter, item.verse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
    });
  }, [activeColumnIndex, activeTranslation, stageVerse]);

  const handleHistorySendToObs = useCallback((item: BibleHistoryItem) => {
    setShowHistoryDropdown(false);
    void goLiveVerse(item.book, item.chapter, item.verse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
    });
  }, [activeColumnIndex, activeTranslation, goLiveVerse]);

  const openHistoryDropdown = useCallback(() => {
    setHistoryItems(getRecentBibleHistoryItems(loadBibleHistory()));
    setShowHistoryDropdown(true);
  }, []);

  // ── Keyboard navigation ──

  const handleToggleBibleVisibility = useCallback(async () => {
    if (visibilityActionInFlightRef.current) return;
    visibilityActionInFlightRef.current = true;
    setVisibilityActionPending(true);
    const visibilityEpoch = ++visibilityEpochRef.current;
    setActionError("");
    try {
      if (presentationLinkMode) {
        if (bibleOverlayVisible) {
          onStage(null);
          setBibleOverlayVisible(false);
        } else {
          const current = latestStagedRef.current;
          if (current) {
            onStage(current);
            setBibleOverlayVisible(true);
          } else if (selectedBook && selectedChapter && selectedVerse) {
            await goLiveVerse(selectedBook, selectedChapter, selectedVerse);
          }
        }
        return;
      }

      await ensureObsConnected();
      if (bibleOverlayVisible) {
        // Hide immediately so effects and stale push callbacks cannot repaint
        // the source while OBS finishes the hide batch.
        setBibleOverlayVisible(false);
        // Play the overlay's exit animation before the source is hidden.
        await dockObsClient.animateOutPresentationOverlay("bible", {
          mode: fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current,
          includePresentation: !hasSceneRoute || sceneRoute.syncPresentation,
          targets: hasSceneRoute ? sceneRoute.targets : [],
        }).catch(() => { });
        await clearBibleFromConfiguredOutput();
        return;
      }

      const current = latestStagedRef.current;
      const data = current?.type === "bible"
        ? current.data as Parameters<typeof dockObsClient.pushBible>[0]
        : null;
      const mode = fullscreenOnlyMode
        ? "fullscreen"
        : data?.overlayMode === "lower-third" || data?.overlayMode === "fullscreen"
          ? data.overlayMode
          : overlayModeRef.current;

      // With a verse to show, push first. The push delivers it while the source is
      // still hidden and only then switches the source on, so it animates in.
      // Switching the source on first showed the page's previous state for a
      // moment (show, hide, then animate in).
      if (!hasSceneRoute && !data) {
        await dockObsClient.bringBibleOverlayForward(mode).catch(() => { });
      }
      if (data) {
        await pushBibleToConfiguredOutput({ ...data, overlayMode: mode });
      }
      if (visibilityEpoch === visibilityEpochRef.current) setBibleOverlayVisible(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
      if (!isTransient) {
        console.warn("[DockBibleTab] toggle Bible visibility failed:", err);
        setActionError(message);
      }
    } finally {
      visibilityActionInFlightRef.current = false;
      setVisibilityActionPending(false);
    }
  }, [bibleOverlayVisible, clearBibleFromConfiguredOutput, fullscreenOnlyMode, goLiveVerse, hasSceneRoute, onStage, overlayMode, presentationLinkMode, pushBibleToConfiguredOutput, sceneRoute.syncPresentation, sceneRoute.targets, selectedBook, selectedChapter, selectedVerse]);

  const handleConfirmBibleRoute = useCallback(() => {
    if (!pendingVerseRouteConfirm) return;
    bibleSceneRouteConfirmedRef.current = true;
    const { book, chapter, verse, options } = pendingVerseRouteConfirm;
    setPendingVerseRouteConfirm(null);
    void goLiveVerse(book, chapter, verse, { ...options, bypassSceneRoute: false });
  }, [goLiveVerse, pendingVerseRouteConfirm]);

  const handleSendBibleToMceAlone = useCallback(async () => {
    if (!pendingVerseRouteConfirm) return;
    const { book, chapter, verse, options } = pendingVerseRouteConfirm;
    setPendingVerseRouteConfirm(null);
    updateSceneRoute({ enabled: false });
    if (sceneRoute.targets.length > 0) {
      await Promise.allSettled(sceneRoute.targets.map((t) => (
        dockObsClient.clearSceneRouteSource("bible", t.sceneName)
      )));
    }
    void goLiveVerse(book, chapter, verse, { ...options, bypassSceneRoute: true });
  }, [goLiveVerse, pendingVerseRouteConfirm, sceneRoute.targets, updateSceneRoute]);

  const handleCancelBibleRouteConfirm = useCallback(() => {
    setPendingVerseRouteConfirm(null);
  }, []);

  const handleTranslationAChange = useCallback((newTranslation: string) => {
    if (newTranslation === translationB) {
      setTranslationB(translationA);
    }
    setTranslationA(newTranslation);
  }, [translationA, translationB]);

  const handleTranslationBChange = useCallback((newTranslation: string) => {
    if (newTranslation === translationA) {
      setTranslationA(translationB);
    }
    setTranslationB(newTranslation);
  }, [translationA, translationB]);

  const handleQuickTranslationBChange = useCallback((newTranslation: string) => {
    handleTranslationBChange(newTranslation);
    if (selectedBook && selectedChapter !== null && selectedVerse !== null && compareEnabled) {
      void goLiveVerse(selectedBook, selectedChapter, selectedVerse, {
        translation: activeTranslation,
        compareTranslationsOverride: {
          translationA: activeTranslation,
          translationB: newTranslation,
        },
        reveal: true,
      });
    }
  }, [
    activeTranslation,
    compareEnabled,
    goLiveVerse,
    handleTranslationBChange,
    selectedBook,
    selectedChapter,
    selectedVerse,
  ]);

  const openThemeSettings = useCallback((tab: ThemeSettingsTab = "text") => {
    setThemeSettingsInitialTab(tab);
    setShowComparePopover(false);
    setShowThemeSettings(true);
  }, []);

  const handleSendCompareToObs = useCallback(async () => {
    const visibilityEpoch = visibilityEpochRef.current;
    setShowComparePopover(false);
    if (!translationsLoaded || compareMode !== "translations") return;
    if (!compareEnabled) return;

    const currentPassage = chapterPassages[activeColumnIndex] ?? null;
    const book = selectedBook ?? currentPassage?.book;
    const chapter = selectedChapter ?? currentPassage?.chapter;
    const verseNum = selectedVerse ?? currentPassage?.verses[0]?.verse ?? 1;

    if (!book || !chapter) return;
    setActionError("");
    try {
      const lineCount = clampVerseLineCount(verseLineCount);
      const [selA, selB] = await Promise.all([
        resolveVerseSelection(book, chapter, verseNum, translationA, lineCount),
        resolveVerseSelection(book, chapter, verseNum, translationB, lineCount),
      ]);
      const refA = `${book} ${chapter}:${selA.verseRange}`;
      const refB = `${book} ${chapter}:${selB.verseRange}`;
      const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
      const theme = liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id;
      const baseLiveThemeSettings = (
        liveOverlayMode === "fullscreen"
          ? (liveFullscreenThemeSettingsRef.current ?? effectiveSelectedBibleTheme.settings)
          : (liveLowerThirdThemeSettingsRef.current ?? effectiveSelectedLowerThirdTheme.settings)
      );
      const baseLiveSettingsRecord = (baseLiveThemeSettings as unknown as Record<string, unknown>) || {};
      const activeFontSize = Number(baseLiveThemeSettings.fontSize || 145);
      const activeRefFontSize = Number(baseLiveThemeSettings.refFontSize || 42);
      const rawCompSize = Number(baseLiveSettingsRecord.compareVerseFontSizeLeft || 0);
      const effectiveCompSize = (rawCompSize > 40) ? rawCompSize : activeFontSize;
      const rawCompRefSize = Number(baseLiveSettingsRecord.compareReferenceFontSizeLeft || 0);
      const effectiveCompRefSize = (rawCompRefSize > 25) ? rawCompRefSize : activeRefFontSize;

      const liveCompareThemeSettings = {
        ...baseLiveThemeSettings,
        compareVerseFontSizeLeft: effectiveCompSize,
        compareVerseFontSizeRight: effectiveCompSize,
        compareReferenceFontSizeLeft: effectiveCompRefSize,
        compareReferenceFontSizeRight: effectiveCompRefSize,
      };

      const stageData = {
        book,
        chapter,
        verse: verseNum,
        verseEnd: selA.verseEnd,
        verseRange: selA.verseRange,
        referenceLabel: refA,
        lineCount,
        translation: translationA,
        translationA,
        translationB,
        compareEnabled: true,
        compareLayout,
        verseText: selA.text,
        overlayMode: liveOverlayMode,
        theme,
        bibleThemeSettings: liveCompareThemeSettings as unknown as Record<string, unknown>,
        liveOverrides:
          liveOverlayMode === "fullscreen"
            ? (fullscreenLiveOverrides as Record<string, unknown> | null)
            : null,
        reveal: true,
        _dockLive: true,
        compare: {
          enabled: true,
          layout: compareLayout,
          columns: [
            {
              book,
              chapter,
              verse: verseNum,
              verseEnd: selA.verseEnd,
              verseRange: selA.verseRange,
              referenceLabel: refA,
              translation: translationA,
              verseText: selA.text,
            },
            {
              book,
              chapter,
              verse: verseNum,
              verseEnd: selB.verseEnd,
              verseRange: selB.verseRange,
              referenceLabel: refB,
              translation: translationB,
              verseText: selB.text,
            },
          ],
        },
      };
      onStage({
        type: "bible",
        label: `${translationA} vs ${translationB}`,
        subtitle: selA.text,
        data: stageData,
      });
      if (presentationLinkMode) {
        if (visibilityEpoch === visibilityEpochRef.current) setBibleOverlayVisible(true);
        trackBiblePresent(selA.text);
        return;
      }
      ensureObsConnected()
        .then(() => pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData))
        .then(() => {
          if (visibilityEpoch !== visibilityEpochRef.current) return;
          setBibleOverlayVisible(true);
          trackBiblePresent(selA.text);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
          if (!isTransient) {
            console.warn("[DockBibleTab] Compare push to OBS failed:", err);
            setActionError(message);
          } else {
            console.warn("[DockBibleTab] Compare push to OBS failed (transient):", message);
          }
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[DockBibleTab] Compare resolve failed:", err);
      setActionError(message);
    }
  }, [
    activeColumnIndex,
    chapterPassages,
    selectedBook,
    selectedChapter,
    selectedVerse,
    translationA,
    translationB,
    verseLineCount,
    resolveVerseSelection,
    overlayMode,
    effectiveSelectedBibleTheme.id,
    effectiveSelectedBibleTheme.settings,
    effectiveSelectedLowerThirdTheme.settings,
    selectedLowerThirdTheme.id,
    fullscreenLiveOverrides,
    onStage,
    fullscreenOnlyMode,
    presentationLinkMode,
    compareLayout,
    compareMode,
    compareEnabled,
    pushBibleToConfiguredOutput,
    translationsLoaded,
  ]);

  const handleSendComparePassagesToObs = useCallback(async () => {
    const visibilityEpoch = visibilityEpochRef.current;
    if (!translationsLoaded || compareMode !== "passages" || !compareEnabled) return;
    const readyPreviews = comparePassagePreviews.filter((preview) => (
      preview.parsed && preview.text && !preview.loading && !preview.error
    ));
    if (readyPreviews.length !== comparePassageDrafts.length || readyPreviews.length < MIN_COMPARE_PASSAGES) {
      setActionError(t("dock.compare.completePassages", "Enter at least two valid passages before sending to OBS."));
      return;
    }

    setActionError("");
    const lineCount = clampVerseLineCount(verseLineCount);
    const liveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayModeRef.current;
    const theme = liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id;
    const first = readyPreviews[0];
    if (!first.parsed) return;
    const columns = readyPreviews.map((preview) => {
      if (!preview.parsed) throw new Error(t("dock.compare.completePassages", "Enter at least two valid passages before sending to OBS."));
      return {
        book: preview.parsed.book,
        chapter: preview.parsed.chapter,
        verse: preview.parsed.verse,
        verseEnd: preview.verseEnd,
        verseRange: preview.verseRange,
        referenceLabel: preview.referenceLabel,
        translation: preview.draft.translation,
        verseText: preview.text,
      };
    });
    const baseLiveThemeSettings = (
      liveOverlayMode === "fullscreen"
        ? (liveFullscreenThemeSettingsRef.current ?? effectiveSelectedBibleTheme.settings)
        : (liveLowerThirdThemeSettingsRef.current ?? effectiveSelectedLowerThirdTheme.settings)
    );
    const baseLiveSettingsRecord = (baseLiveThemeSettings as unknown as Record<string, unknown>) || {};
    const activeFontSize = Number(baseLiveThemeSettings.fontSize || 145);
    const activeRefFontSize = Number(baseLiveThemeSettings.refFontSize || 42);
    const rawCompSize = Number(baseLiveSettingsRecord.compareVerseFontSizeLeft || 0);
    const effectiveCompSize = (rawCompSize > 40) ? rawCompSize : activeFontSize;
    const rawCompRefSize = Number(baseLiveSettingsRecord.compareReferenceFontSizeLeft || 0);
    const effectiveCompRefSize = (rawCompRefSize > 25) ? rawCompRefSize : activeRefFontSize;

    const liveCompareThemeSettings = {
      ...baseLiveThemeSettings,
      compareVerseFontSizeLeft: effectiveCompSize,
      compareVerseFontSizeRight: effectiveCompSize,
      compareReferenceFontSizeLeft: effectiveCompRefSize,
      compareReferenceFontSizeRight: effectiveCompRefSize,
    };

    const stageData = {
      book: first.parsed.book,
      chapter: first.parsed.chapter,
      verse: first.parsed.verse,
      verseEnd: first.verseEnd,
      verseRange: first.verseRange,
      referenceLabel: first.referenceLabel,
      displayReferenceLabel: columns.map((column) => column.referenceLabel).join(" • "),
      referenceBaseLabel: first.referenceLabel,
      lineCount,
      translation: first.draft.translation,
      translationA: columns[0]?.translation,
      translationB: columns[1]?.translation,
      compareEnabled: true,
      compareMode: "passages" as const,
      compareLayout: "side-by-side" as const,
      verseText: first.text,
      overlayMode: liveOverlayMode,
      theme,
      bibleThemeSettings: liveCompareThemeSettings as unknown as Record<string, unknown>,
      liveOverrides:
        liveOverlayMode === "fullscreen"
          ? (fullscreenLiveOverrides as Record<string, unknown> | null)
          : null,
      reveal: true,
      _dockLive: true,
      compare: {
        enabled: true,
        mode: "passages" as const,
        layout: "side-by-side" as const,
        columns,
      },
    };
    onStage({
      type: "bible",
      label: columns.map((column) => column.referenceLabel).join(" • "),
      subtitle: first.text,
      data: stageData,
    });
    if (presentationLinkMode) {
      if (visibilityEpoch === visibilityEpochRef.current) setBibleOverlayVisible(true);
      trackBiblePresent(first.text);
      setShowComparePopover(false);
      return;
    }
    ensureObsConnected()
      .then(() => pushBibleToConfiguredOutput(stageData as unknown as DockBiblePushData))
      .then(() => {
        if (visibilityEpoch !== visibilityEpochRef.current) return;
        setBibleOverlayVisible(true);
        trackBiblePresent(first.text);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        const isTransient = /scene item|create.*input|create.*scene|failed to create/i.test(message);
        if (!isTransient) {
          console.warn("[DockBibleTab] Compare passages push to OBS failed:", err);
          setActionError(message);
        } else {
          console.warn("[DockBibleTab] Compare passages push to OBS failed (transient):", message);
        }
      });
    setShowComparePopover(false);
  }, [
    compareEnabled,
    compareMode,
    comparePassageDrafts.length,
    comparePassagePreviews,
    effectiveSelectedBibleTheme.id,
    effectiveSelectedBibleTheme.settings,
    effectiveSelectedLowerThirdTheme.settings,
    fullscreenLiveOverrides,
    fullscreenOnlyMode,
    onStage,
    presentationLinkMode,
    pushBibleToConfiguredOutput,
    selectedLowerThirdTheme.id,
    t,
    verseLineCount,
    translationsLoaded,
  ]);

  const handleOverlayModeChange = useCallback((nextMode: OverlayMode) => {
    if (nextMode === overlayMode) return;

    setDraftBrowserQuickThemeSettings(null);
    setDraftBrowserVerseLineCount(null);

    const targetLineCount = nextMode === "fullscreen" ? fullscreenVerseLineCount : lowerThirdVerseLineCount;
    setVerseLineCount(targetLineCount);
    setOverlayMode(nextMode);
    overlayModeRef.current = nextMode;
    saveDockBibleOverlayMode(nextMode);
    trackOverlayModeSwitched("bible", nextMode);

    let targetThemeOverride: BibleThemeOutputOverride | undefined = undefined;
    if (nextMode === "lower-third") {
      const targetSettings = applyLowerThirdQuickThemeSettings(
        baseLowerThirdTheme,
        effectiveLowerThirdQuickThemeSettings,
      ).settings;
      liveLowerThirdThemeSettingsRef.current = targetSettings;
      targetThemeOverride = {
        themeId: selectedLowerThirdTheme.id,
        settings: targetSettings,
      };
    } else {
      const targetSettings = effectiveSelectedBibleTheme.settings;
      liveFullscreenThemeSettingsRef.current = targetSettings;
      targetThemeOverride = {
        themeId: effectiveSelectedBibleTheme.id,
        settings: targetSettings,
        liveOverrides: fullscreenLiveOverrides as Record<string, unknown> | null,
      };
    }

    if (
      bibleOverlayVisible
      && selectedBook
      && selectedChapter !== null
      && selectedVerse !== null
    ) {
      lastModeRefreshNonceRef.current = modeRefreshNonce + 1;
      setModeRefreshNonce((current) => current + 1);

      void goLiveVerse(selectedBook, selectedChapter, selectedVerse, {
        translation: activeTranslation,
        columnIndex: activeColumnIndex,
        reveal: false,
        lineCount: targetLineCount,
        overlayMode: nextMode,
        themeOverride: targetThemeOverride,
        referenceFormat,
        referenceVersionVisible,
        recordHistory: false,
        preserveComparePassages: true,
      });
    } else {
      setModeRefreshNonce((current) => current + 1);
    }
  }, [
    activeColumnIndex,
    activeTranslation,
    baseLowerThirdTheme,
    bibleOverlayVisible,
    effectiveLowerThirdQuickThemeSettings,
    effectiveSelectedBibleTheme.id,
    effectiveSelectedBibleTheme.settings,
    fullscreenLiveOverrides,
    fullscreenVerseLineCount,
    goLiveVerse,
    lowerThirdVerseLineCount,
    modeRefreshNonce,
    overlayMode,
    referenceFormat,
    referenceVersionVisible,
    selectedBook,
    selectedChapter,
    selectedLowerThirdTheme.id,
    selectedVerse,
  ]);

  const handleToggleFavoritePassage = useCallback(async () => {
    if (!selectedPassageForFavorite) {
      return;
    }

    const passage = selectedPassageForFavorite;
    const reference = passage.reference;
    const nextIsFavorite = !favoriteRefs.has(reference);
    setFavoriteRefs((current) => {
      const next = new Set(current);
      if (nextIsFavorite) {
        next.add(reference);
      } else {
        next.delete(reference);
      }
      return next;
    });
    setFavoritePassages((current) => {
      if (nextIsFavorite) {
        return [passage, ...current.filter((item) => item.reference !== reference)];
      }
      return current.filter((item) => item.reference !== reference);
    });

    try {
      if (nextIsFavorite) {
        await addFavorite(passage);
      } else {
        await removeFavorite(reference);
      }
    } catch (error) {
      setFavoriteRefs((current) => {
        const next = new Set(current);
        if (nextIsFavorite) {
          next.delete(reference);
        } else {
          next.add(reference);
        }
        return next;
      });
      setFavoritePassages((current) => {
        if (nextIsFavorite) {
          return current.filter((item) => item.reference !== reference);
        }
        return current.some((item) => item.reference === reference)
          ? current
          : [passage, ...current];
      });
      setActionError(error instanceof Error ? error.message : t("bible.unableToUpdateFavorites"));
    }
  }, [favoriteRefs, selectedPassageForFavorite]);

  const handleRemoveFavorite = useCallback(async (reference: string) => {
    setFavoriteRefs((current) => {
      const next = new Set(current);
      next.delete(reference);
      return next;
    });
    setFavoritePassages((current) => current.filter((item) => item.reference !== reference));
    setFavoriteHistorySearches((current) => current.filter((item) => item.reference !== reference));
    try {
      await removeFavorite(reference);
    } catch {
      // Ignore removal errors
    }
  }, []);

  const handleToggleStarVerse = useCallback(async (verseNumber: number, verseText: string) => {
    if (!selectedBook || selectedChapter === null) return;
    const reference = `${selectedBook} ${selectedChapter}:${verseNumber}`;
    const nextIsFavorite = !favoriteRefs.has(reference);
    const passage: BiblePassage = {
      reference,
      book: selectedBook,
      chapter: selectedChapter,
      startVerse: verseNumber,
      endVerse: verseNumber,
      verses: [
        {
          book: selectedBook,
          chapter: selectedChapter,
          verse: verseNumber,
          text: verseText,
          abbrev: selectedBook,
        },
      ],
      translation: activeTranslation,
    };

    setFavoriteRefs((current) => {
      const next = new Set(current);
      if (nextIsFavorite) next.add(reference);
      else next.delete(reference);
      return next;
    });
    setFavoritePassages((current) => {
      if (nextIsFavorite) return [passage, ...current.filter((item) => item.reference !== reference)];
      return current.filter((item) => item.reference !== reference);
    });

    try {
      if (nextIsFavorite) {
        await addFavorite(passage);
      } else {
        await removeFavorite(reference);
      }
    } catch (error) {
      setFavoriteRefs((current) => {
        const next = new Set(current);
        if (nextIsFavorite) next.delete(reference);
        else next.add(reference);
        return next;
      });
      setFavoritePassages((current) => {
        if (nextIsFavorite) return current.filter((item) => item.reference !== reference);
        return current.some((item) => item.reference === reference) ? current : [passage, ...current];
      });
      setActionError(error instanceof Error ? error.message : t("bible.unableToUpdateFavorites"));
    }
  }, [activeTranslation, favoriteRefs, selectedBook, selectedChapter, t]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget instanceof HTMLInputElement) {
          e.currentTarget.select();
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const picked = (showDropdown && displayedSearchResults.length > 0)
          ? displayedSearchResults[activeIdx >= 0 ? activeIdx : 0]
          : null;
        if (picked) {
          void handlePickResult(picked);
          return;
        }

        const raw = searchQuery.trim();
        if (raw) {
          const searchContext = {
            currentBook: selectedBook,
            currentChapter: selectedChapter,
            currentVerse: selectedVerse,
          };
          const immediateResults = parseBibleSearch(raw, { context: searchContext });
          if (immediateResults.length > 0) {
            void handlePickResult({ ...immediateResults[0], kind: "reference" });
          }
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (showDropdown) {
          setShowDropdown(false);
          return;
        }
        handleClearVerse();
        return;
      }

      if (!showDropdown || displayedSearchResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((prev) => (prev < displayedSearchResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((prev) => (prev > 0 ? prev - 1 : displayedSearchResults.length - 1));
      }
    },
    [
      showDropdown,
      displayedSearchResults,
      activeIdx,
      handleClearVerse,
      handlePickResult,
      searchQuery,
      selectedBook,
      selectedChapter,
      selectedVerse,
    ]
  );

  const handleSearchKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === "Escape" ||
        e.key === "Tab"
      ) {
        return;
      }
      runInstantKeywordSearch(e.currentTarget.value);
    },
    [runInstantKeywordSearch],
  );

  // ── Split a long verse into parts (right-click a verse) ──
  const [verseSplits, setVerseSplits] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(VERSE_SPLIT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [activeVersePart, setActiveVersePart] = useState<{ verse: number; index: number } | null>(null);
  const verseSplitKey = useCallback(
    (verse: number) => `${activeTranslation}|${selectedBook}|${selectedChapter}|${verse}`,
    [activeTranslation, selectedBook, selectedChapter],
  );
  const verseSplitMode = useCallback(
    (verse: number): VerseSplitMode | null => parseVerseSplitMode(verseSplits[verseSplitKey(verse)]),
    [verseSplitKey, verseSplits],
  );
  const setVerseSplit = useCallback((verse: number, mode: VerseSplitMode | null) => {
    const key = verseSplitKey(verse);
    setVerseSplits((current) => {
      const next = { ...current };
      if (mode) next[key] = verseSplitModeId(mode);
      else delete next[key];
      try { localStorage.setItem(VERSE_SPLIT_STORAGE_KEY, JSON.stringify(next)); } catch { /* not saved */ }
      return next;
    });
    setActiveVersePart(null);
  }, [verseSplitKey]);

  const highlightKey = useCallback(
    (verse: number) => `${activeTranslation}|${selectedBook}|${selectedChapter}|${verse}`,
    [activeTranslation, selectedBook, selectedChapter],
  );
  const highlightsForVerse = useCallback(
    (verse: number): VerseHighlight[] => verseHighlights[highlightKey(verse)] ?? [],
    [highlightKey, verseHighlights],
  );
  const saveVerseHighlights = useCallback((key: string, list: VerseHighlight[]) => {
    setVerseHighlights((current) => {
      const next = { ...current };
      if (list.length > 0) next[key] = list;
      else delete next[key];
      try { localStorage.setItem(VERSE_HIGHLIGHT_STORAGE_KEY, JSON.stringify(next)); } catch { /* not saved */ }
      return next;
    });
  }, []);
  const addVerseHighlight = useCallback((verse: number, text: string, colorId: string) => {
    saveVerseHighlights(highlightKey(verse), addHighlight(verseHighlightsRef.current[highlightKey(verse)] ?? [], text, colorId));
  }, [highlightKey, saveVerseHighlights]);
  const clearVerseHighlights = useCallback((verse: number) => {
    saveVerseHighlights(highlightKey(verse), []);
  }, [highlightKey, saveVerseHighlights]);

  /** The parts of a split verse as shown in the Dock list (empty when the verse is not split). */
  const versePartsInList = useCallback((verse: number): string[] => (
    Array.from(verseGridRef.current?.querySelectorAll<HTMLElement>(`[data-verse-row="${verse}"] [data-verse-part]`) ?? [])
      .map((element) => element.dataset.partText ?? "")
  ), []);

  /** Put one part of a split verse on the screen (the arrow keys use this). */
  const goToVersePart = useCallback(async (verse: number, index: number, rawText: string) => {
    if (!selectedBook || !selectedChapter) return;
    setSelectedVerse(verse);
    selectedVerseRef.current = verse;
    setActiveVersePart({ verse, index });
    await goLiveVerse(selectedBook, selectedChapter, verse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
      textOverride: applyHighlights(rawText, highlightsForVerse(verse)),
    });
  }, [activeColumnIndex, activeTranslation, goLiveVerse, highlightsForVerse, selectedBook, selectedChapter]);

  const handleVerseClick = useCallback(
    (v: number, columnIndex: number, version: string, textOverride?: string) => {
      if (!selectedBook || !selectedChapter) return;
      if (textOverride === undefined) setActiveVersePart(null);
      setSelectedVerse(v);
      selectedVerseRef.current = v;
      pendingScrollVerseRef.current = null;

      if (compareEnabled && compareMode === "passages") {
        const nextReference: ParsedBiblePassageReference = {
          book: selectedBook,
          chapter: selectedChapter,
          verse: v,
          endVerse: null,
        };
        const activeDraft = comparePassageDrafts[activeComparePassageIndex];
        if (activeDraft) {
          setComparePassageDrafts((current) => current.map((draft, index) => (
            index === activeComparePassageIndex
              ? { ...draft, reference: formatBiblePassageReference(nextReference) }
              : draft
          )));
        }
        activateComparePassage(activeComparePassageIndex, nextReference);
        return;
      }

      void goLiveVerse(selectedBook, selectedChapter, v, {
        translation: version,
        columnIndex,
        reveal: false,
        ...(textOverride !== undefined ? { textOverride } : {}),
      });
    },
    [activateComparePassage, activeComparePassageIndex, compareEnabled, compareMode, comparePassageDrafts, goLiveVerse, selectedBook, selectedChapter],
  );

  const showCopyFeedback = useCallback((status: "success" | "error") => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(status);
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1600);
  }, []);

  const handleVerseRowDelegated = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent) => {
      const targetElement =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-verse-row]")
          : null;
      if (!targetElement) return;
      // Dragging across words to select them (to colour them) must not also put the verse on the screen.
      if (event.type === "click") {
        const down = verseMouseDownAtRef.current;
        const click = event as React.MouseEvent;
        if (down && Math.hypot(click.clientX - down.x, click.clientY - down.y) > 4) return;
        const picked = window.getSelection();
        if (picked && !picked.isCollapsed && picked.anchorNode && targetElement.contains(picked.anchorNode) && picked.toString().trim()) return;
      }
      // One part of a split verse: stage just that part.
      const partElement = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-verse-part]") : null;
      if (partElement) {
        if (event.type === "keydown") {
          const ke = event as React.KeyboardEvent;
          if (ke.key !== "Enter" && ke.key !== " ") return;
          ke.preventDefault();
        }
        if (event.type === "click" && (event as React.MouseEvent).detail > 1) return;
        const partVerse = Number(targetElement.dataset.verseRow);
        const partIndex = Number(partElement.dataset.versePart);
        if (partVerse && Number.isFinite(partIndex)) {
          const parent = targetElement.parentElement;
          parent?.querySelectorAll(".dock-bible-verse-row--selected").forEach((el) => {
            if (el !== targetElement) el.classList.remove("dock-bible-verse-row--selected");
          });
          targetElement.classList.add("dock-bible-verse-row--selected");
          handleVerseClick(partVerse, activeColumnIndex, activeTranslation, applyHighlights(partElement.dataset.partText ?? "", highlightsForVerse(partVerse)));
          setActiveVersePart({ verse: partVerse, index: partIndex });
        }
        return;
      }
      if (event.type === "keydown") {
        const ke = event as React.KeyboardEvent;
        if (ke.key !== "Enter" && ke.key !== " ") return;
        ke.preventDefault();
      }
      if (event.type === "click") {
        const ce = event as React.MouseEvent;
        if (ce.detail > 1) return;
      }
      const verseNum = Number(targetElement.dataset.verseRow);
      if (!verseNum) return;
      // Instant visual feedback: mark the row active before React re-render cycle
      const parent = targetElement.parentElement;
      if (parent) {
        parent.querySelectorAll(".dock-bible-verse-row--selected").forEach((el) => {
          if (el !== targetElement) el.classList.remove("dock-bible-verse-row--selected");
        });
        targetElement.classList.add("dock-bible-verse-row--selected");
      }
      void handleVerseClick(verseNum, activeColumnIndex, activeTranslation);
    },
    [activeColumnIndex, activeTranslation, handleVerseClick, highlightsForVerse],
  );

  // Switching version only changes what the Dock shows. The verse on air in
  // OBS stays as it is until the operator clicks a verse (which then goes out
  // in the new version) — changing versions mid-reading must not cut the live
  // output. Callers that do want to project (e.g. the compare modal) call
  // goLiveVerse themselves.
  const handleQuickVersionChange = useCallback((columnIndex: number, version: string) => {
    const nextValue = version.toUpperCase();
    setColumnTranslations((current) => {
      const next = [...current];
      next[columnIndex] = nextValue;
      return next;
    });
  }, []);

  const handleCompareModalProjectSingle = useCallback((
    book: string,
    chapter: number,
    verse: number,
    translation: string,
  ) => {
    handleDisplayModeChange("single");
    handleQuickVersionChange(activeColumnIndex, translation);
    focusReference(book, chapter, verse);
    void goLiveVerse(book, chapter, verse, {
      translation,
      reveal: true,
    });
    setCompareVersesModal(null);
  }, [activeColumnIndex, focusReference, goLiveVerse, handleDisplayModeChange, handleQuickVersionChange]);

  const handleCompareModalProjectCompare = useCallback((
    book: string,
    chapter: number,
    verse: number,
    transA: string,
    transB: string,
  ) => {
    handleDisplayModeChange("compare");
    handleCompareModeChange("translations");
    setTranslationA(transA);
    setTranslationB(transB);
    focusReference(book, chapter, verse);
    void goLiveVerse(book, chapter, verse, {
      translation: transA,
      compareTranslationsOverride: { translationA: transA, translationB: transB },
      reveal: true,
    });
    setCompareVersesModal(null);
  }, [focusReference, goLiveVerse, handleCompareModeChange, handleDisplayModeChange, setTranslationA, setTranslationB]);

  const handleBookSelect = useCallback((book: string) => {
    if (!BOOK_CHAPTERS[book]) return;
    manualReferenceSelectionRef.current = true;
    const nextChapter = Math.min(selectedChapter ?? 1, BOOK_CHAPTERS[book] ?? 1);
    setSelectedBook(book);
    selectedChapterRef.current = nextChapter;
    setSelectedChapter(nextChapter);
    setSelectedVerse(null);
    setHighlightVerse(null);
    setActionError("");
    pendingScrollVerseRef.current = null;
  }, [selectedChapter]);

  const handlePickerSelectChapter = useCallback((book: string, chapter: number) => {
    manualReferenceSelectionRef.current = true;
    selectedChapterRef.current = chapter;
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setSelectedVerse(null);
    selectedVerseRef.current = null;
    setHighlightVerse(null);
    setActionError("");
    pendingScrollVerseRef.current = null;
    setShowChapterPicker(false);
    verseGridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    persistDockBiblePreferencesNow({ selectedBook: book, selectedChapter: chapter });
  }, [persistDockBiblePreferencesNow]);

  const handleBookJump = useCallback((delta: -1 | 1) => {
    if (!selectedBook) return;
    const currentBookIndex = BIBLE_BOOK_ORDER.indexOf(selectedBook);
    if (currentBookIndex < 0) return;
    const nextBook = BIBLE_BOOK_ORDER[currentBookIndex + delta];
    if (!nextBook) return;
    handleBookSelect(nextBook);
  }, [handleBookSelect, selectedBook]);

  const handleSelectFullscreenTheme = useCallback((theme: BibleTheme) => {
    manualThemeSettingsSelectionRef.current = true;
    setSelectedBibleTheme(theme);
    selectedBibleThemeRef.current = theme;
    const nextFullscreenQuickSettings = extractThemeQuickSettingsForOverlayMode(theme, "fullscreen");
    setFullscreenQuickThemeSettings(nextFullscreenQuickSettings);
    setSavedFullscreenQuickThemeSettings(nextFullscreenQuickSettings);

    if (!fullscreenOnlyMode && themeSupportsBibleOverlayMode(theme, "lower-third")) {
      const nextLowerThirdQuickSettings = extractThemeQuickSettingsForOverlayMode(theme, "lower-third");
      setSelectedLowerThirdTheme(theme);
      selectedLowerThirdThemeRef.current = theme;
      setLowerThirdQuickThemeSettings(nextLowerThirdQuickSettings);
      setSavedLowerThirdQuickThemeSettings(nextLowerThirdQuickSettings);
      setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);
    }

    handleOverlayModeChange("fullscreen");
  }, [fullscreenOnlyMode, handleOverlayModeChange]);

  const handleSelectLowerThirdTheme = useCallback((theme: BibleTheme) => {
    manualThemeSettingsSelectionRef.current = true;
    setSelectedLowerThirdTheme(theme);
    selectedLowerThirdThemeRef.current = theme;
    const nextLowerThirdQuickSettings = extractThemeQuickSettingsForOverlayMode(theme, "lower-third");
    setLowerThirdQuickThemeSettings(nextLowerThirdQuickSettings);
    setSavedLowerThirdQuickThemeSettings(nextLowerThirdQuickSettings);
    setLowerThirdQuickThemeSettingsLinkedToFullscreen(false);

    if (themeSupportsBibleOverlayMode(theme, "fullscreen")) {
      const nextFullscreenQuickSettings = extractThemeQuickSettingsForOverlayMode(theme, "fullscreen");
      setSelectedBibleTheme(theme);
      selectedBibleThemeRef.current = theme;
      setFullscreenQuickThemeSettings(nextFullscreenQuickSettings);
      setSavedFullscreenQuickThemeSettings(nextFullscreenQuickSettings);
    }

    handleOverlayModeChange("lower-third");
  }, [handleOverlayModeChange]);

  // Each mode keeps its own selected theme so switching to lower-third does
  // not accidentally keep reusing a fullscreen-only theme.
  const activeThemePickerProps =
    isSceneProfileActive
      ? {
        selectedThemeId: activeQuickEditThemeId,
        // Scene profiles commit the chosen theme through the save context so
        // selecting a routed scene never changes General.
        onSelect: (_theme: BibleTheme) => undefined,
        label: quickEditOverlayMode === "fullscreen" ? t("bible.fullscreenTheme") : t("bible.lowerThirdTheme"),
        templateType: quickEditOverlayMode,
      }
      : fullscreenOnlyMode || overlayMode === "fullscreen"
        ? {
          selectedThemeId: selectedBibleTheme.id,
          onSelect: handleSelectFullscreenTheme,
          label: t("bible.fullscreenTheme"),
          templateType: "fullscreen" as const,
        }
        : {
          selectedThemeId: selectedLowerThirdTheme.id,
          onSelect: handleSelectLowerThirdTheme,
          label: t("bible.lowerThirdTheme"),
          templateType: "lower-third" as const,
        };
  const resolveThemeQuickSettings = useCallback((theme: BibleTheme): DockFullscreenQuickThemeSettings => {
    const effectiveOverlayMode = fullscreenOnlyMode ? "fullscreen" : overlayMode;
    return extractThemeQuickSettingsForOverlayMode(theme, effectiveOverlayMode);
  }, [fullscreenOnlyMode, overlayMode]);
  const navigateVerse = useCallback(
    async (delta: 1 | -1) => {
      if (compareEnabled && compareMode === "passages") {
        handleComparePassageNavigation(delta);
        return;
      }
      if (!selectedBook || !selectedChapter) return;

      // A split verse: the arrow keys go through its parts first, then on to the next verse.
      if (!compareEnabled) {
        const currentVerse = selectedVerse ?? 1;
        const currentParts = versePartsInList(currentVerse);
        if (currentParts.length > 1) {
          const at = activeVersePart?.verse === currentVerse ? activeVersePart.index : (delta > 0 ? -1 : currentParts.length);
          const nextPart = at + delta;
          if (nextPart >= 0 && nextPart < currentParts.length) {
            await goToVersePart(currentVerse, nextPart, currentParts[nextPart]);
            return;
          }
        }
      }

      let nextChapter = selectedChapter;
      let nextVerse = selectedVerse ?? 1;
      let nextVerseCount = verseCount;

      if (delta > 0) {
        if (nextVerse < verseCount) {
          nextVerse += 1;
        } else {
          const maxChapter = BOOK_CHAPTERS[selectedBook] ?? selectedChapter;
          if (selectedChapter >= maxChapter) return;
          nextChapter = selectedChapter + 1;
          try {
            const { getVerseCount } = await import("../../bible/bibleData");
            nextVerseCount = await getVerseCount(selectedBook, nextChapter, activeTranslation) || 30;
          } catch {
            nextVerseCount = 30;
          }
          nextVerse = 1;
        }
      } else if (nextVerse > 1) {
        nextVerse -= 1;
      } else {
        if (selectedChapter <= 1) return;
        nextChapter = selectedChapter - 1;
        try {
          const { getVerseCount } = await import("../../bible/bibleData");
          nextVerseCount = await getVerseCount(selectedBook, nextChapter, activeTranslation) || 30;
        } catch {
          nextVerseCount = 30;
        }
        nextVerse = nextVerseCount;
      }

      if (nextChapter !== selectedChapter) {
        setSelectedChapter(nextChapter);
        setVerseCount(nextVerseCount);
      }

      setSelectedVerse(nextVerse);
      selectedVerseRef.current = nextVerse;

      // Landing on a split verse: start at its first part (going down) or its last part (going up).
      if (!compareEnabled && nextChapter === selectedChapter) {
        const landingParts = versePartsInList(nextVerse);
        if (landingParts.length > 1) {
          const landingIndex = delta > 0 ? 0 : landingParts.length - 1;
          await goToVersePart(nextVerse, landingIndex, landingParts[landingIndex]);
          return;
        }
      }
      setActiveVersePart(null);

      await goLiveVerse(selectedBook, nextChapter, nextVerse, {
        translation: activeTranslation,
        columnIndex: activeColumnIndex,
      });
    },
    [
      activeVersePart,
      goToVersePart,
      versePartsInList,
      activeColumnIndex,
      activeTranslation,
      compareEnabled,
      compareMode,
      goLiveVerse,
      handleComparePassageNavigation,
      selectedBook,
      selectedChapter,
      selectedVerse,
      verseCount,
    ],
  );

  const sendSelectedVerseToShow = useCallback(async () => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    if (!(await requireEntitlement("bibleVersions", 0))) return;
    await stageVerse(selectedBook, selectedChapter, selectedVerse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
      reveal: false,
    });
  }, [activeColumnIndex, activeTranslation, selectedBook, selectedChapter, selectedVerse, stageVerse]);

  const handleChapterJump = useCallback((delta: -1 | 1) => {
    if (!selectedBook) return;
    const currentChapter = selectedChapterRef.current ?? selectedChapter;
    if (!currentChapter) return;
    const maxChapter = BOOK_CHAPTERS[selectedBook] ?? currentChapter;
    const nextChapter = currentChapter + delta;
    if (nextChapter < 1 || nextChapter > maxChapter) return;

    manualReferenceSelectionRef.current = true;
    selectedChapterRef.current = nextChapter;
    setSelectedChapter(nextChapter);
    setSelectedVerse(null);
    selectedVerseRef.current = null;
    setHighlightVerse(null);
    setActionError("");
    pendingScrollVerseRef.current = null;
    verseGridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    persistDockBiblePreferencesNow({ selectedChapter: nextChapter });
  }, [persistDockBiblePreferencesNow, selectedBook, selectedChapter]);

  useEffect(() => {
    const pendingVerseToReveal = pendingScrollVerseRef.current;
    const verseToReveal = pendingVerseToReveal ?? selectedVerse;
    if (verseToReveal === null) return;

    const timer = window.setTimeout(() => {
      const verseRow = verseGridRef.current?.querySelector<HTMLElement>(
        `[data-verse-row="${verseToReveal}"]`,
      );
      if (verseRow) {
        const container = verseGridRef.current;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const verseRect = verseRow.getBoundingClientRect();
          const containerTop = containerRect.top + container.scrollTop;
          const verseTop = verseRect.top + container.scrollTop;
          const verseHeight = verseRect.height;
          const verseCenter = verseTop + verseHeight / 2;
          const containerCenter = containerTop + containerRect.height * 0.4;

          const tolerance = containerRect.height * 0.15;
          const isNearTarget = Math.abs(verseCenter - containerCenter) < tolerance;

          if (!isNearTarget) {
            const targetScrollTop = container.scrollTop + (verseCenter - containerCenter);
            container.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: "smooth",
            });
          }
        }
      }
      setHighlightVerse(verseToReveal);
      pendingScrollVerseRef.current = null;
    }, 150);

    const highlightClear = window.setTimeout(() => {
      setHighlightVerse((current) => (current === verseToReveal ? null : current));
    }, 1800);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(highlightClear);
    };
  }, [chapterPassages, selectedVerse]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isDockTabVisible(containerRef.current)) return;
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Escape") {
        if (targetElement?.closest(".dtb-modal")) return;
        event.preventDefault();
        setShowDropdown(false);
        handleClearVerse();
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedBook || !selectedChapter) return;

      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        handleBookJump(1);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        handleBookJump(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleChapterJump(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleChapterJump(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        void navigateVerse(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        void navigateVerse(-1);
      } else if (event.key === "Enter" && selectedVerse !== null) {
        event.preventDefault();
        void sendSelectedVerseToShow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleBookJump, handleChapterJump, handleClearVerse, navigateVerse, selectedBook, selectedChapter, selectedVerse, sendSelectedVerseToShow]);

  const currentChapterLabel =
    selectedBook && selectedChapter ? `${selectedBook} ${selectedChapter}` : t("bible.defaultTitle");
  const chapterCount = selectedBook ? BOOK_CHAPTERS[selectedBook] ?? 0 : 0;
  const canGoPreviousChapter = Boolean(selectedBook && selectedChapter && selectedChapter > 1);
  const canGoNextChapter = Boolean(selectedBook && selectedChapter && chapterCount > 0 && selectedChapter < chapterCount);
  const activePassage = chapterPassages[activeColumnIndex] ?? null;
  const activeChapterError = chapterErrors[activeColumnIndex] ?? "";
  const comparePassageA = comparePassages.translationA;
  const comparePassageB = comparePassages.translationB;
  const isComparePassageMode = compareEnabled && compareMode === "passages";
  const activeComparePassagePreview = comparePassagePreviews[activeComparePassageIndex] ?? null;
  const compareVerseRows = compareEnabled && !isComparePassageMode
    ? (comparePassageA?.verses ?? activePassage?.verses ?? [])
    : (activePassage?.verses ?? []);
  const readerLoading = isComparePassageMode
    ? comparePassagePreviews.some((preview) => preview.loading)
    : compareEnabled ? compareChapterLoading : chapterLoading;
  const readerError = isComparePassageMode
    ? (comparePassagePreviews.find((preview) => Boolean(preview.error))?.error ?? "")
    : compareEnabled
      ? (compareChapterErrors.find((message) => Boolean(message)) ?? "")
      : activeChapterError;
  const hasReaderVerses = isComparePassageMode
    ? comparePassagePreviews.some((preview) => Boolean(preview.text))
    : compareVerseRows.length > 0;
  const compareDisplayLabel = compareEnabled
    ? isComparePassageMode
      ? t("dock.compare.passagesLabel", "Compare Passages")
      : `${translationA} vs ${translationB}`
    : activeTranslation;
  const currentVerseNumber = isComparePassageMode
    ? activeComparePassagePreview?.parsed?.verse ?? selectedVerse ?? null
    : selectedVerse ?? activePassage?.verses[0]?.verse ?? null;
  const currentReferenceLabel = isComparePassageMode
    ? activeComparePassagePreview?.referenceLabel
    ?? comparePassageDrafts[activeComparePassageIndex]?.reference
    ?? t("dock.compare.passagesLabel", "Compare Passages")
    : selectedBook && selectedChapter
      ? `${selectedBook} ${selectedChapter}${currentVerseNumber ? `:${currentVerseNumber}` : ""}${verseLineCount > 1 && currentVerseNumber
        ? `–${Math.min(currentVerseNumber + verseLineCount - 1, verseCount)}`
        : ""
      }`
      : t("bible.defaultTitle");
  const refreshCurrentReferenceDisplay = useCallback((format: BibleReferenceFormat, versionVisible: boolean) => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    void goLiveVerse(selectedBook, selectedChapter, selectedVerse, {
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
      reveal: false,
      lineCount: verseLineCount,
      referenceFormat: format,
      referenceVersionVisible: versionVisible,
      preserveComparePassages: true,
    });
  }, [
    activeColumnIndex,
    activeTranslation,
    goLiveVerse,
    selectedBook,
    selectedChapter,
    selectedVerse,
    verseLineCount,
  ]);

  const handleReferenceFormatChange = useCallback((format: BibleReferenceFormat) => {
    setReferenceFormat(format);
    persistDockBiblePreferencesNow({ referenceFormat: format });
    refreshCurrentReferenceDisplay(format, referenceVersionVisible);
  }, [persistDockBiblePreferencesNow, referenceVersionVisible, refreshCurrentReferenceDisplay]);

  const handleReferenceVersionVisibleChange = useCallback((visible: boolean) => {
    setReferenceVersionVisible(visible);
    persistDockBiblePreferencesNow({ referenceVersionVisible: visible });
    refreshCurrentReferenceDisplay(referenceFormat, visible);
  }, [persistDockBiblePreferencesNow, referenceFormat, refreshCurrentReferenceDisplay]);

  const handleReferenceSettingsSave = useCallback((format: BibleReferenceFormat, versionVisible: boolean) => {
    setReferenceFormat(format);
    setReferenceVersionVisible(versionVisible);
    persistDockBiblePreferencesNow({
      referenceFormat: format,
      referenceVersionVisible: versionVisible,
    });
    refreshCurrentReferenceDisplay(format, versionVisible);
  }, [persistDockBiblePreferencesNow, refreshCurrentReferenceDisplay]);

  const comparePopoverStyle = {
    position: "fixed" as const,
    top: comparePopoverPosition?.top ?? (typeof window !== "undefined" ? Math.max(56, Math.round(window.innerHeight / 2 - 200)) : 56),
    left: comparePopoverPosition?.left ?? (typeof window !== "undefined" ? Math.max(16, window.innerWidth - 336) : 16),
    right: "auto",
    bottom: "auto",
    width: comparePopoverPosition?.width ?? 320,
    boxSizing: "border-box" as const,
    maxHeight: comparePopoverPosition?.maxHeight ?? 520,
    zIndex: 20000,
    visibility: "visible" as const,
  };

  const renderComparePopover = () => {
    if (!showComparePopover || typeof document === "undefined") return null;
    return createPortal(
      <div
        ref={comparePopoverPanelRef}
        className="dock-bible-compare-popover"
        data-dock-keep-overflow-open="true"
        style={comparePopoverStyle}
      >
        <div className="dock-bible-compare-popover__header">{t("dock.compare.title", "Compare Translations")}</div>
        <div className="dock-bible-compare-tabs" role="tablist" aria-label={t("dock.compare.modes", "Compare modes")}>
          <button
            type="button"
            role="tab"
            aria-selected={compareMode === "translations"}
            className={`dock-bible-compare-tabs__tab${compareMode === "translations" ? " dock-bible-compare-tabs__tab--active" : ""}`}
            onClick={() => handleCompareModeChange("translations")}
          >
            {t("dock.compare.translationsTab", "Translations")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={compareMode === "passages"}
            className={`dock-bible-compare-tabs__tab${compareMode === "passages" ? " dock-bible-compare-tabs__tab--active" : ""}`}
            onClick={() => handleCompareModeChange("passages")}
          >
            {t("dock.compare.passagesTab", "Passages")}
          </button>
        </div>
        {compareMode === "translations" ? (
          <>
            <div className={`dock-bible-compare-popover__status-banner ${compareEnabled ? "dock-bible-compare-popover__status-banner--on" : "dock-bible-compare-popover__status-banner--off"}`}>
              <div className="dock-bible-compare-popover__status-icon">
                <Icon name={compareEnabled ? "check_circle" : "info"} size={15} />
              </div>
              <div className="dock-bible-compare-popover__status-text">
                <div className="dock-bible-compare-popover__status-title">
                  {compareEnabled ? t("dock.compare.statusActive", "Compare is ACTIVE") : t("dock.compare.statusOff", "Compare is OFF")}
                </div>
                <div className="dock-bible-compare-popover__status-desc">
                  {compareEnabled
                    ? t("dock.compare.activeHint", "Both versions will be sent to OBS & screen")
                    : t("dock.compare.offHint", "Enable below to present translations side-by-side or line-by-line")}
                </div>
              </div>
            </div>
            <div className="dock-bible-compare-popover__section">
              <div className="dock-bible-compare-popover__toggle-row">
                <div className="dock-bible-compare-popover__toggle-copy">
                  <div className="dock-bible-compare-popover__label">{t("dock.compare.enable", "Enable Compare Translations")}</div>
                </div>
                <button
                  type="button"
                  className={`dtb-toggle${compareEnabled ? " dtb-toggle--on" : ""}`}
                  onClick={() => handleCompareEnabledChange(!compareEnabled)}
                  role="switch"
                  aria-checked={compareEnabled}
                  aria-label={t("dock.compare.enable", "Enable Compare Translations")}
                  title={compareEnabled ? t("dock.compare.disableCompare", "Disable compare mode") : t("dock.compare.enableCompare", "Enable compare mode")}
                >
                  <span className="dtb-toggle__knob" />
                </button>
              </div>
            </div>
            <div className="dock-bible-compare-popover__section">
              <div className="dock-bible-compare-popover__label-row">
                <div className="dock-bible-compare-popover__label">{t("dock.compare.layout", "Layout")}</div>
                <button
                  type="button"
                  className="dock-bible-compare-popover__settings"
                  onClick={() => openThemeSettings("compare")}
                  disabled={!compareEnabled}
                  aria-label={t("dock.compare.openCompareSettings", "Open compare design settings")}
                  title={
                    compareEnabled
                      ? t("dock.compare.openCompareSettings", "Open compare design settings")
                      : t("dock.compare.enableCompareFirst", "Enable compare mode first")
                  }
                >
                  <Icon name="settings" size={12} />
                </button>
              </div>
              <select
                className="dock-select dock-bible-compare-popover__select"
                value={compareLayout}
                onChange={(e) => setCompareLayout(e.target.value as CompareLayout)}
                disabled={!compareEnabled}
              >
                <option value="line-by-line">{t("dock.compare.lineByLine", "Line By Line")}</option>
                <option value="side-by-side">{t("dock.compare.sideBySide", "Side By Side")}</option>
              </select>
            </div>
            <div className="dock-bible-compare-popover__translation-pair">
              <div className="dock-bible-compare-popover__row">
                <label className="dock-bible-compare-popover__label">{t("dock.compare.translationA", "Translation A")}</label>
                <DockCompactTranslationSelect
                  value={translationA}
                  options={availableTranslations}
                  onChange={handleTranslationAChange}
                  disabled={!translationsLoaded}
                  ariaLabel={t("dock.compare.translationA", "Translation A")}
                />
              </div>
              <div className="dock-bible-compare-popover__row">
                <label className="dock-bible-compare-popover__label">{t("dock.compare.translationB", "Translation B")}</label>
                <DockCompactTranslationSelect
                  value={translationB}
                  options={availableTranslations}
                  onChange={handleTranslationBChange}
                  disabled={!translationsLoaded}
                  ariaLabel={t("dock.compare.translationB", "Translation B")}
                />
              </div>
            </div>
            <button
              type="button"
              className="dock-bible-compare-popover__send"
              onClick={() => void handleSendCompareToObs()}
              disabled={!translationsLoaded}
              title={t("common.save", "Save")}
            >
              <Icon name="check" size={15} />
              {t("common.save", "Save")}
            </button>
          </>
        ) : (
          <DockBibleComparePassageControls
            compareEnabled={compareEnabled}
            drafts={comparePassageDrafts}
            previews={comparePassagePreviews}
            activeIndex={activeComparePassageIndex}
            navigationMode={comparePassageNavigation}
            availableTranslations={availableTranslations}
            onToggleCompare={handleCompareEnabledChange}
            onDraftReferenceChange={handleComparePassageReferenceChange}
            onDraftTranslationChange={handleComparePassageTranslationChange}
            onActiveIndexChange={activateComparePassage}
            onNavigationModeChange={setComparePassageNavigation}
            onRemovePassage={handleRemoveComparePassage}
            onSendToObs={() => void handleSendComparePassagesToObs()}
          />
        )}
      </div>,
      document.body,
    );
  };

  const renderChapterBar = () => (
    <div
      className={`dock-bible-chapter-bar${showChapterPicker ? " dock-bible-chapter-bar--picker-open" : ""}${searchPlacement === "bottom" ? " dock-bible-chapter-bar--bottom" : ""}${isSub300Width ? " dock-bible-chapter-bar--sub300" : ""}`}
      ref={chapterPickerRef}
    >
      <div className="dock-bible-chapter-bar__nav">
        <button
          type="button"
          className="dock-bible-reader__chapter-nav-btn dock-bible-chapter-bar__btn"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleChapterJump(-1);
          }}
          disabled={!canGoPreviousChapter}
          title={t("bible.previousChapter", "Previous chapter")}
          aria-label={t("bible.previousChapter", "Previous chapter")}
        >
          <Icon name="chevron_left" size={13} />
        </button>

        <button
          type="button"
          className="dock-bible-chapter-trigger"
          onClick={() => {
            setShowChapterPicker((prev) => {
              const next = !prev;
              if (next) {
                setChapterPickerSearch("");
                setPreviewPickerBook(selectedBook || "Genesis");
                setPickerTab("book");
              }
              return next;
            });
          }}
          aria-expanded={showChapterPicker}
          aria-haspopup="dialog"
          title={`${selectedBook || "Genesis"} ${selectedChapter || 1}`}
        >
          <span className="dock-bible-chapter-trigger__text">
            <span className="dock-bible-chapter-trigger__book-full">{selectedBook || "Genesis"}</span>
            <span className="dock-bible-chapter-trigger__book-short">{getBookInitials(selectedBook || "Genesis")}</span>
            {" "}{selectedChapter || 1}
          </span>
          <Icon name={showChapterPicker ? "arrow_drop_up" : "arrow_drop_down"} size={13} />
        </button>

        <button
          type="button"
          className="dock-bible-reader__chapter-nav-btn dock-bible-chapter-bar__btn"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleChapterJump(1);
          }}
          disabled={!canGoNextChapter}
          title={t("bible.nextChapter", "Next chapter")}
          aria-label={t("bible.nextChapter", "Next chapter")}
        >
          <Icon name="chevron_right" size={13} />
        </button>
      </div>

      <div className="dock-bible-chapter-bar__actions" ref={chapterBarActionsRef}>
        {isConstrained ? (
          <>
            <button
              type="button"
              className="dock-bible-chapter-bar__btn dock-bible-chapter-bar__more-btn"
              onClick={() => setShowChapterBarMenu((prev) => !prev)}
              title={t("common.moreActions", "More actions")}
              aria-label={t("common.moreActions", "More actions")}
              aria-expanded={showChapterBarMenu}
              aria-haspopup="menu"
            >
              <Icon name="more_vert" size={15} />
            </button>
            {showChapterBarMenu && (
              <div
                className="dock-bible-actions__menu dock-bible-chapter-bar__menu"
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="dock-bible-actions__menu-item-entry"
                  role="menuitem"
                  onClick={() => {
                    setShowChapterBarMenu(false);
                    setShowAllFavoritesModal(true);
                  }}
                >
                  <Icon name="star" size={15} style={{ color: "#eab308" }} />
                  <span>{t("bible.favorites", "Favorite Passages")}</span>
                </button>
                <button
                  type="button"
                  className="dock-bible-actions__menu-item-entry"
                  role="menuitem"
                  onClick={() => {
                    setShowChapterBarMenu(false);
                    setShowBibleHistory(true);
                  }}
                >
                  <Icon name="history" size={15} />
                  <span>{t("bibleHistory.title", "Bible History")}</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="dock-bible-chapter-bar__btn dock-bible-chapter-bar__fav-btn"
              onClick={() => setShowAllFavoritesModal(true)}
              title={t("bible.favorites", "Favorite Passages")}
              aria-label={t("bible.favorites", "Favorite Passages")}
            >
              <Icon name="star" size={15} />
            </button>
            <button
              type="button"
              className="dock-bible-chapter-bar__btn dock-bible-chapter-bar__history-btn"
              onClick={() => setShowBibleHistory(true)}
              title={t("bibleHistory.title", "Bible History")}
              aria-label={t("bibleHistory.title", "Bible History")}
            >
              <Icon name="history" size={15} />
            </button>
          </>
        )}
      </div>

      {/* Floating Dropdown Panel */}
      {showChapterPicker && (
        <div className="dock-bible-picker-popover" role="dialog" aria-label={t("bible.selectBookAndChapter", "Select book and chapter")}>
          <div className="dock-bible-picker-tabs">
            <button
              type="button"
              className={`dock-bible-picker-tab-btn${pickerTab === "book" ? " dock-bible-picker-tab-btn--active" : ""}`}
              onClick={() => setPickerTab("book")}
            >
              {t("bible.booksTab", "Books")} ({previewPickerBook})
            </button>
            <button
              type="button"
              className={`dock-bible-picker-tab-btn${pickerTab === "chapter" ? " dock-bible-picker-tab-btn--active" : ""}`}
              onClick={() => setPickerTab("chapter")}
            >
              {t("bible.chaptersTab", "Chapters")}
            </button>
          </div>

          {pickerTab === "book" ? (
            <>
              <div className="dock-bible-picker-search">
                <Icon name="search" size={13} style={{ opacity: 0.6 }} />
                <input
                  type="text"
                  placeholder={t("bible.searchBook", "Search book...")}
                  value={chapterPickerSearch}
                  onChange={(e) => setChapterPickerSearch(e.target.value)}
                  autoFocus
                />
                {chapterPickerSearch && (
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0 }}
                    onClick={() => setChapterPickerSearch("")}
                    aria-label={t("common.clear")}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>

              <div className="dock-bible-picker-books-grid">
                {filteredPickerBooks.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`dock-bible-picker-book-btn${previewPickerBook === b ? " dock-bible-picker-book-btn--active" : ""}`}
                    onClick={() => {
                      setPreviewPickerBook(b);
                      setPickerTab("chapter");
                    }}
                    title={b}
                  >
                    {getBookInitials(b)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="dock-bible-picker-chapters-grid">
              {Array.from({ length: previewBookChapterCount }, (_, i) => i + 1).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`dock-bible-picker-chapter-btn${previewPickerBook === selectedBook && ch === selectedChapter ? " dock-bible-picker-chapter-btn--active" : ""}`}
                  onClick={() => {
                    handlePickerSelectChapter(previewPickerBook, ch);
                    setPickerTab("book");
                  }}
                  title={`${previewPickerBook} ${ch}`}
                >
                  {ch}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <BibleDockContainer
      ref={containerRef}
      isCompact={isShortHeight}
      isNarrowWidth={isNarrowWidth}
      searchPlacement={searchPlacement}
      activeTranslation={activeTranslation}
      compareEnabled={compareEnabled}
      onToggleCompare={handleCompareEnabledChange}
      availableTranslations={availableTranslations}
      onVersionChange={(version) => handleQuickVersionChange(activeColumnIndex, version)}
      onTranslationsReload={loadTranslations}
      toolbarCollapsed={toolbarCollapsed}
      onToolbarCollapseToggle={() => setToolbarCollapsed((prev) => !prev)}
      compactActions={
        isShortHeight || isNarrowWidth ? (() => (
          <div className="dock-bible-actions__compare-group" ref={comparePopoverRef}>
            <button
              type="button"
              className="dock-bible-actions__overflow"
              onClick={() => setShowBibleActionsMenu((prev) => !prev)}
              aria-label={t("common.moreActions", "More actions")}
              aria-expanded={showBibleActionsMenu}
              aria-haspopup="menu"
              title={t("common.moreActions", "More actions")}
            >
              <Icon name="more_vert" size={15} />
            </button>
              {showBibleActionsMenu && (
                <div
                  className="dock-bible-actions__menu"
                  role="menu"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item"
                    role="menuitem"
                    data-dock-compare-trigger="true"
                    onClick={() => {
                      setShowBibleActionsMenu(false);
                      setShowComparePopover(true);
                    }}
                  >
                    <Icon name="swap_horiz" size={16} />
                    <span>{t("dock.compare.title", "Compare Translations & Passages")}</span>
                  </button>
                  {toolbarCollapsed && (
                    <button
                      type="button"
                      className="dock-bible-actions__menu-item-entry"
                      role="menuitem"
                      onClick={() => {
                        setShowBibleActionsMenu(false);
                        setToolbarCollapsed(false);
                      }}
                    >
                      <Icon name="expand_less" size={16} />
                      <span>{t("dock.bottomToolbar.expandTooltip", "Expand toolbar")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBibleActionsMenu(false);
                      setShowBibleMacrosModal(true);
                    }}
                  >
                    <Icon name="bolt" size={16} />
                    <span>{t("bible.smartShortcodes", "Scripture Shortcodes (Macros)")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBibleActionsMenu(false);
                      setShowBibleHistory(true);
                    }}
                  >
                    <Icon name="history" size={16} />
                    <span>{t("bible.viewHistory", "View Bible History")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBibleActionsMenu(false);
                      window.location.reload();
                    }}
                  >
                    <Icon name="refresh" size={16} />
                    <span>{t("dock.reloadDock", "Reload / Refresh Dock")}</span>
                  </button>
                </div>
              )}
          </div>
        )) : undefined
      }
      headerActions={
        () => (
          <div className="dock-bible-header-actions dock-bible-compact-actions" ref={comparePopoverRef}>
            <button
              type="button"
              className="dock-bible-actions__overflow"
              onClick={() => window.location.reload()}
              aria-label={t("common.refresh", "Refresh")}
              title={t("common.refresh", "Refresh")}
            >
              <Icon name="refresh" size={15} />
            </button>
            <button
              type="button"
              className="dock-bible-actions__overflow"
              onClick={() => {
                setShowBibleActionsMenu((prev) => !prev);
              }}
              aria-label={t("common.moreActions", "More actions")}
              aria-expanded={showBibleActionsMenu}
              aria-haspopup="menu"
              title={t("common.moreActions", "More actions")}
            >
              <Icon name="more_vert" size={15} />
            </button>
            {showBibleActionsMenu && (
              <div
                className="dock-bible-actions__menu"
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="dock-bible-actions__menu-item"
                  role="menuitem"
                  data-dock-compare-trigger="true"
                  onClick={() => {
                    setShowBibleActionsMenu(false);
                    setShowComparePopover(true);
                  }}
                >
                  <Icon name="swap_horiz" size={16} />
                  <span>{t("dock.compare.title", "Compare Translations & Passages")}</span>
                </button>
                {toolbarCollapsed && (
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowBibleActionsMenu(false);
                      setToolbarCollapsed(false);
                    }}
                  >
                    <Icon name="expand_less" size={16} />
                    <span>{t("dock.bottomToolbar.expandTooltip", "Expand toolbar")}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="dock-bible-actions__menu-item-entry"
                  role="menuitem"
                  onClick={() => {
                    setShowBibleActionsMenu(false);
                    setShowBibleMacrosModal(true);
                  }}
                >
                  <Icon name="bolt" size={16} />
                  <span>{t("bible.smartShortcodes", "Scripture Shortcodes (Macros)")}</span>
                </button>
                <button
                  type="button"
                  className="dock-bible-actions__menu-item-entry"
                  role="menuitem"
                  onClick={() => {
                    setShowBibleActionsMenu(false);
                    setShowBibleHistory(true);
                  }}
                >
                  <Icon name="history" size={16} />
                  <span>{t("bible.viewHistory", "View Bible History")}</span>
                </button>
                <button
                  type="button"
                  className="dock-bible-actions__menu-item-entry"
                  role="menuitem"
                  onClick={() => {
                    setShowBibleActionsMenu(false);
                    window.location.reload();
                  }}
                >
                  <Icon name="refresh" size={16} />
                  <span>{t("dock.reloadDock", "Reload / Refresh Dock")}</span>
                </button>
              </div>
            )}
          </div>
        )
      }
      searchSection={
        showSearchBar ? (
          <section className="dock-bible-search-bar">
            {onToggleMenu && (
              <button
                type="button"
                className="dock-bible-search-bar__menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMenu();
                }}
                aria-label={t("page.menu", "Menu")}
                title={t("page.menu", "Menu")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" /></svg>
              </button>
            )}
            <div
              className="dock-search dock-search--smart dock-search--console"
              style={{ flex: 1, marginBottom: 0 }}
              ref={searchRef}
            >
              <div className="dock-search__input-wrapper">
                <input
                  className="dock-input dock_search__input"
                  placeholder={t("bible.searchPlaceholder")}
                  aria-label={t("bible.searchPlaceholder")}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  onKeyUp={handleSearchKeyUp}
                  onFocus={() => {
                    ensureSearchIndexPreloaded();
                    if (searchQuery.trim()) setShowDropdown(true);
                    else {
                      const nextFavoriteHistorySearches = getFavoriteBibleHistoryItems();
                      setFavoriteHistorySearches(nextFavoriteHistorySearches);
                      setShowRecentSearches(
                        recentSearches.length > 0
                        || favoritePassages.length > 0
                        || nextFavoriteHistorySearches.length > 0,
                      );
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="dock-search__clear"
                    onClick={() => {
                      setSearchQuery("");
                      setShowDropdown(false);
                      setShowRecentSearches(hasSavedSearches);
                    }}
                    aria-label={t("bible.clearSearchShort")}
                    title={t("bible.clearSearchShort")}
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>

              {showDropdown && displayedSearchResults.length > 0 && (
                <div className="dock-search-dropdown" role="listbox">
                  {displayedSearchResults.map((result, i) => (
                    <div
                      key={result.label + i}
                      className={`dock-search-dropdown__item${i === activeIdx ? " dock-search-dropdown__item--active" : ""}`}
                      onClick={() => void handlePickResult(result)}
                      onMouseEnter={() => setActiveIdx(i)}
                      role="option"
                      aria-selected={i === activeIdx}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handlePickResult(result);
                        }
                      }}
                      title={t("common.search")}>
                      <Icon
                        name={
                          result.action === "clear"
                            ? "close"
                            : result.isMacro
                              ? "bolt"
                              : result.kind === "translation-directive"
                                ? (result.isInstalled ? "translate" : "cloud_download")
                                : result.compareTranslations
                                  ? "swap_horiz"
                                  : result.kind === "keyword"
                                    ? "search"
                                    : result.verse !== null
                                      ? "format_quote"
                                      : result.chapter !== null
                                        ? "menu_book"
                                        : "auto_stories"
                        }
                        size={14}
                        className="dock-search-dropdown__item-icon"
                      />
                      <span className="dock-search-dropdown__content">
                        <span className="dock-search-dropdown__label" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span>{result.label}</span>
                          {result.kind === "translation-directive" && (
                            <>
                              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: result.isInstalled ? "rgba(34, 197, 94, 0.2)" : "rgba(168, 85, 247, 0.2)", color: result.isInstalled ? "#4ade80" : "#c084fc", fontWeight: 700 }}>
                                {result.isInstalled ? "INSTALLED" : "DOWNLOAD"}
                              </span>
                              {result.trigger === "//" || result.trigger === "||" ? (
                                <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(59, 130, 246, 0.2)", color: "var(--accent-blue)", fontWeight: 700 }}>
                                  COMPARE
                                </span>
                              ) : null}
                            </>
                          )}
                          {result.isMacro && (
                            <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(234, 179, 8, 0.2)", color: "#eab308", fontWeight: 700, letterSpacing: "0.5px" }}>
                              MACRO
                            </span>
                          )}
                          {result.modeOverride && (
                            <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(59, 130, 246, 0.2)", color: "var(--accent-blue)", fontWeight: 700 }}>
                              {result.modeOverride === "lower-third" ? "LOWER-3RD" : "FULLSCREEN"}
                            </span>
                          )}
                          {result.compareTranslations && (
                            <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", fontWeight: 700 }}>
                              COMPARE
                            </span>
                          )}
                        </span>
                        {result.kind === "translation-directive" && (
                          <span className="dock-search-dropdown__snippet" style={{ color: "var(--dock-text-muted, #94a3b8)" }}>
                            {result.fullTitle || result.name}{result.language ? ` (${result.language})` : ""}
                          </span>
                        )}
                        {result.kind === "keyword" && result.snippet ? (
                          <span className="dock-search-dropdown__snippet">
                            {renderHighlightedKeywordText(result.text, result.query)}
                          </span>
                        ) : null}
                      </span>
                      {result.kind !== "translation-directive" && result.book && result.chapter !== null && (
                        <button
                          type="button"
                          className="dock-search-dropdown__goto-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleGoToChapter(result);
                          }}
                          title={t("dock.tooltip.goToChapter", t("bible.goToChapter", "Go to chapter"))}
                          aria-label={t("dock.tooltip.goToChapter", t("bible.goToChapter", "Go to chapter"))}>
                          <Icon name="menu_book" size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {showRecentSearches && !searchQuery.trim() && (
                <div className={`dock-search-dropdown dock-search-dropdown--recent${isUltraNarrowWidth ? " dock-search-dropdown--compact" : ""}`}>
                  {recentSearches.length > 0 && (
                    <>
                      <div className="dock-search-dropdown__heading" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <Icon name="history" size={12} style={{ color: "var(--dock-accent-color, #60a5fa)" }} />
                        <span>{t("bible.recentSearches", "Recent Searches")}</span>
                      </div>
                      <div className="dock-search-dropdown__grid">
                        {recentSearches.map((item) => {
                          const shortLabel = formatCompactBibleReference(item);
                          return (
                            <button
                              type="button"
                              key={item}
                              className="dock-search-dropdown__chip dock-search-dropdown__item--recent"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => applyRecentBibleSearch(item)}
                              title={item}
                            >
                              <Icon name="history" size={12} />
                              <span className="dock-search-dropdown__content">
                                <span className="dock-search-dropdown__label">
                                  <span className="dock-search-dropdown__label--full">{item}</span>
                                  <span className="dock-search-dropdown__label--short">{shortLabel}</span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {favoriteSearches.length > 0 && (
                    <>
                      <div className="dock-search-dropdown__header-row">
                        <div className="dock-search-dropdown__heading" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <Icon name="star" size={12} style={{ color: "var(--dock-accent-color, #eab308)" }} />
                          <span>{t("bible.favorites", "Favorites")}</span>
                        </div>
                        <button
                          type="button"
                          className="dock-search-dropdown__view-all-link"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setShowRecentSearches(false);
                            setShowAllFavoritesModal(true);
                          }}
                          title={t("bible.viewAllFavorites", "View all favorites")}
                        >
                          <Icon name="open_in_new" size={11} />
                          <span>{t("bible.viewAll", "View all")} ({favoriteSearches.length})</span>
                        </button>
                      </div>
                      <div className="dock-search-dropdown__grid">
                        {favoriteSearches.slice(0, 3).map((favorite) => {
                          const fullLabel = formatDockFavoriteBibleSearch(favorite);
                          const shortLabel = formatCompactBibleReference(favorite.reference);
                          return (
                            <button
                              type="button"
                              key={favorite.reference}
                              className="dock-search-dropdown__chip dock-search-dropdown__item--favorite"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleFavoriteClick(favorite)}
                              title={fullLabel}
                            >
                              <Icon name="star" size={12} style={{ opacity: 0.9, color: "var(--dock-accent-color, #eab308)" }} />
                              <span className="dock-search-dropdown__content">
                                <span className="dock-search-dropdown__label">
                                  <span className="dock-search-dropdown__label--full">{fullLabel}</span>
                                  <span className="dock-search-dropdown__label--short">{shortLabel}</span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {showDropdown && searchQuery.trim() && displayedSearchResults.length === 0 && (
                <div className="dock-search-dropdown">
                  <div className="dock-search-dropdown__empty">
                    {!searchIsSettled || isKeywordSearching
                      ? t("bible.searching")
                      : t("bible.noMatches", { query: searchQuery })}
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null
      }
      children={(bottomSearchPanel, _bottomToolbarActions, _bottomPanelToggle) => (
        <>
          <section
            ref={quickActionsContainerRef}
            className="dock-console-panel dock-console-panel--workspace"
            data-toolbar-collapsed={toolbarCollapsed || undefined}
          >
            {/* ── Compact Chapter Navigation Row (Row 2) ── */}
            {searchPlacement !== "bottom" && renderChapterBar()}

            <div
              className="dock-bible-reader"
              ref={verseGridRef}
              onMouseDownCapture={(event) => { verseMouseDownAtRef.current = { x: event.clientX, y: event.clientY }; }}
              onClick={handleVerseRowDelegated}
              onKeyDown={handleVerseRowDelegated}
            >
              {hasReaderVerses && (
                <div className="dock-bible-reader__ref-header">
                  <div className="dock-bible-reader__ref-header-start">
                    <span className="dock-bible-reader__ref-header-label">{t("bible.reading")}</span>
                  </div>
                  <span className="dock-bible-reader__ref-header-reference">{currentReferenceLabel}</span>
                  {compareEnabled ? (
                    <span className="dock-bible-reader__ref-header-translation dock-bible-reader__ref-header-translation--compare">
                      {compareDisplayLabel}
                    </span>
                  ) : (
                    <span className="dock-bible-reader__ref-header-translation">{activeTranslation}</span>
                  )}
                  <div className="dock-bible-reader__ref-header-actions">
                    <button
                      type="button"
                      className="dock-bible-reader__ref-header-fav"
                      onClick={() => {
                        if (selectedBook && selectedChapter) {
                          const currentScheduleBibleTheme = overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id;
                          const currentScheduleThemeSettings = overlayMode === "fullscreen"
                            ? fullscreenQuickThemeSettings
                            : lowerThirdQuickThemeSettings;

                          const targetVerseNum = selectedVerse ?? 1;
                          const verseObj = activeChapterPassage?.verses.find((v) => v.verse === targetVerseNum) ?? activeChapterPassage?.verses[0];
                          const targetVerse = verseObj?.verse ?? targetVerseNum;

                          addBibleToActiveSchedule({
                            reference: `${selectedBook} ${selectedChapter}:${targetVerse}`,
                            text: verseObj?.text || "",
                            translation: activeTranslation,
                            book: selectedBook,
                            chapter: selectedChapter,
                            verse: targetVerse,
                            overlayMode,
                            theme: currentScheduleBibleTheme,
                            bibleThemeSettings: currentScheduleThemeSettings as unknown as Record<string, unknown> | null,
                          });
                        }
                      }}
                      title={t("schedule.addToSchedule", "Add to Schedule")}
                      aria-label={t("schedule.addToSchedule", "Add to Schedule")}
                    >
                      <Icon name="playlist_add" size={13} />
                    </button>
                    <button
                      type="button"
                      className={`dock-favorites dock-bible-reader__ref-header-fav${isCurrentPassageFavorite ? " dock-bible-reader__ref-header-fav--active" : ""}`}
                      onClick={handleToggleFavoritePassage}
                      disabled={!selectedPassageForFavorite}
                      title={isCurrentPassageFavorite ? t("bible.favRemove") : t("bible.favAdd")}
                    >
                      <Icon name={isCurrentPassageFavorite ? "star" : "star_border"} size={12} />
                    </button>
                    <div className="dock-bible-reader__ref-header-history" ref={historyPopoverRef}>
                      <button
                        type="button"
                        className="dock-bible-reader__ref-header-history-btn"
                        onClick={openHistoryDropdown}
                        title={t("bible.history", "History")}
                      >
                        <Icon name="history" size={12} />
                      </button>
                      {showHistoryDropdown && historyItems.length > 0 && (
                        <div className="dock-bible-reader__history-dropdown">
                          {historyItems.map((item) => (
                            <div
                              key={item.id}
                              className="dock-bible-reader__history-item"
                            >
                              <button
                                type="button"
                                className="dock-bible-reader__history-view"
                                onClick={() => handleHistoryClick(item)}
                                aria-label={`${item.reference}: ${t("bible.view", "View")}`}
                                title={`${item.reference} — ${t("bible.view", "View")}`}
                              >
                                <span className="dock-bible-reader__history-copy">
                                  <span className="dock-bible-reader__history-ref">{item.reference}</span>
                                  <span className="dock-bible-reader__history-text">{getHistoryVersePreview(item.verseText)}</span>
                                </span>
                              </button>
                              <div className="dock-bible-reader__history-actions">
                                <button
                                  type="button"
                                  className="dock-btn dock-btn--ghost dock-btn--compact dock-bible-reader__history-action"
                                  onClick={() => handleHistoryPreview(item)}
                                  aria-label={`${t("common.preview", "Preview")} ${item.reference}`}
                                  title={t("common.preview", "Preview")}
                                >
                                  {t("common.preview", "Preview")}
                                </button>
                                <button
                                  type="button"
                                  className="dock-btn dock-btn--primary dock-btn--compact dock-bible-reader__history-action"
                                  onClick={() => handleHistorySendToObs(item)}
                                  aria-label={`${t("common.sendToObs", "Send to OBS")} ${item.reference}`}
                                  title={t("common.sendToObs", "Send to OBS")}
                                >
                                  {t("common.sendToObs", "Send to OBS")}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {readerLoading && !hasReaderVerses && (
                <div className="dock-console-placeholder">
                  {t("common.loading")} {isComparePassageMode ? t("dock.compare.passagesLabel", "Compare Passages") : `${currentChapterLabel}...`}
                </div>
              )}

              {readerLoading && readerError && !hasReaderVerses && (
                <div className="dock-action-error dock-action-error--console">
                  <Icon name="warning" size={14} />
                  <span style={{ flex: 1 }}>{readerError}</span>
                </div>
              )}

              {!readerLoading && !hasReaderVerses && !readerError && (
                <div className="dock-console-placeholder">
                  {isComparePassageMode
                    ? t("dock.compare.addTwoPassages", "Add two valid passages in Compare Passages to preview them here.")
                    : t("bible.noVersesAvailable")}
                </div>
              )}

              {isComparePassageMode ? (
                <div className="dock-bible-passage-reader">
                  <div className="dock-bible-passage-reader__toolbar">
                    <button
                      type="button"
                      className="dock-bible-reader__chapter-nav-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleComparePassageNavigation(-1);
                      }}
                      disabled={!comparePassagePreviews.some((preview) => Boolean(preview.parsed))}
                      title={t("bible.previousVerse", "Previous verse")}
                      aria-label={t("bible.previousVerse", "Previous verse")}
                    >
                      <Icon name="chevron_left" size={14} />
                    </button>
                    <span className="dock-bible-passage-reader__toolbar-label">
                      {comparePassageNavigation === "linked"
                        ? t("dock.compare.linkedNavigationShort", "Linked navigation")
                        : t("dock.compare.independentNavigationShort", "Active passage only")}
                    </span>
                    <button
                      type="button"
                      className="dock-bible-reader__chapter-nav-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleComparePassageNavigation(1);
                      }}
                      disabled={!comparePassagePreviews.some((preview) => Boolean(preview.parsed))}
                      title={t("bible.nextVerse", "Next verse")}
                      aria-label={t("bible.nextVerse", "Next verse")}
                    >
                      <Icon name="chevron_right" size={14} />
                    </button>
                  </div>
                  <div className="dock-bible-passage-reader__grid">
                    {comparePassagePreviews.map((preview, index) => (
                      <article
                        key={preview.draft.id}
                        className={`dock-bible-passage-reader__card${activeComparePassageIndex === index ? " dock-bible-passage-reader__card--active" : ""}`}
                        onClick={() => activateComparePassage(index)}
                      >
                        <div className="dock-bible-passage-reader__card-header">
                          <span className="dock-bible-passage-reader__card-number">
                            {t("dock.compare.passageNumber", "Passage {{number}}", { number: index + 1 })}
                          </span>
                          <span className="translation-badge">{preview.draft.translation}</span>
                        </div>
                        <div className="dock-bible-passage-reader__card-reference-row">
                          <span className="dock-bible-passage-reader__card-reference">
                            {preview.referenceLabel || preview.draft.reference || t("dock.compare.referencePlaceholder", "Enter a reference")}
                          </span>
                          <div className="dock-bible-passage-reader__card-actions">
                            <button
                              type="button"
                              className="dock-bible-reader__chapter-nav-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                activateComparePassage(index);
                                handleComparePassageNavigation(-1, index);
                              }}
                              disabled={!preview.parsed}
                              aria-label={t("bible.previousVerse", "Previous verse")}
                              title={t("bible.previousVerse", "Previous verse")}
                            >
                              <Icon name="chevron_left" size={12} />
                            </button>
                            <button
                              type="button"
                              className="dock-bible-reader__chapter-nav-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                activateComparePassage(index);
                                handleComparePassageNavigation(1, index);
                              }}
                              disabled={!preview.parsed}
                              aria-label={t("bible.nextVerse", "Next verse")}
                              title={t("bible.nextVerse", "Next verse")}
                            >
                              <Icon name="chevron_right" size={12} />
                            </button>
                          </div>
                        </div>
                        {preview.loading && (
                          <div className="dock-bible-passage-reader__status">{t("common.loading")}</div>
                        )}
                        {preview.error && (
                          <div className="dock-action-error dock-action-error--console">
                            <Icon name="warning" size={13} />
                            <span>{preview.error}</span>
                          </div>
                        )}
                        {!preview.loading && !preview.error && preview.text && (
                          <div className="dock-bible-passage-reader__text">{preview.text}</div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                compareVerseRows.map((verse) => {
                  const verseA = comparePassageA?.verses.find((entry) => entry.verse === verse.verse) ?? verse;
                  const verseB = comparePassageB?.verses.find((entry) => entry.verse === verse.verse) ?? verseA;
                  const isSelected = selectedVerse === verse.verse;
                  const isHighlighted = highlightVerse === verse.verse;
                  const verseRefString = `${selectedBook} ${selectedChapter}:${verse.verse}`;
                  const isVerseStarred = favoriteRefs.has(verseRefString);
                  const splitMode = compareEnabled ? null : verseSplitMode(verse.verse);
                  const rowHighlights = compareEnabled ? [] : highlightsForVerse(verse.verse);
                  const verseParts = splitMode ? splitVerseText(verse.text, splitMode) : [verse.text];
                  const rowClassName = [
                    "dock-bible-verse-row",
                    compareEnabled ? "dock-bible-verse-row--compare" : "",
                    isSelected ? "dock-bible-verse-row--selected" : "",
                    isHighlighted ? "dock-bible-verse-row--highlighted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div
                      key={verse.verse}
                      data-verse-row={verse.verse}
                      className={rowClassName}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const menuWidth = 190;
                        const menuHeight = 430;
                        const viewportW = window.innerWidth || 800;
                        const viewportH = window.innerHeight || 600;
                        const clampedX = Math.max(8, Math.min(e.clientX, viewportW - menuWidth - 8));
                        const clampedY = Math.max(8, Math.min(e.clientY, viewportH - menuHeight - 8));
                        // Words selected inside this verse can be coloured from the menu.
                        const rowElement = e.currentTarget as HTMLElement;
                        const pageSelection = window.getSelection();
                        let selectedWords = "";
                        if (pageSelection && !pageSelection.isCollapsed && pageSelection.anchorNode && rowElement.contains(pageSelection.anchorNode)) {
                          const candidate = cleanHighlightText(pageSelection.toString());
                          if (candidate && verse.text.replace(/\s+/g, " ").includes(candidate)) selectedWords = candidate;
                        }
                        setWordPick({ open: false, from: null, to: null });
                        setVerseContextMenu({
                          x: clampedX,
                          y: clampedY,
                          verse: verse.verse,
                          text: verse.text,
                          selection: selectedWords,
                        });
                      }}
                      tabIndex={0}
                      role="button"
                      aria-current={isSelected ? "true" : undefined}
                      aria-label={
                        compareEnabled
                          ? `${selectedBook} ${selectedChapter}:${verse.verse} ${translationA} ${verseA.text} ${translationB} ${verseB.text}`
                          : t("bible.verseAriaLabel", { verse: verse.verse, translation: activeTranslation, text: verse.text })
                      }
                    >
                      <div className="dock-bible-verse-row__num">
                        {verse.verse}
                        {isVerseStarred && (
                          <span className="dock-bible-verse-star-badge" title={t("bible.starred", "Starred")}>★</span>
                        )}
                      </div>
                      {compareEnabled ? (
                        compareLayout === "side-by-side" ? (
                          <div className="dock-bible-compare-grid">
                            <div className="dock-bible-compare-card">
                              <span className="translation-badge">{translationA}</span>
                              <div className="dock-bible-compare-card__text">{verseA.text}</div>
                            </div>
                            <div className="dock-bible-compare-card">
                              <span className="translation-badge">{translationB}</span>
                              <div className="dock-bible-compare-card__text">{verseB.text}</div>
                            </div>
                          </div>
                        ) : (
                          <div className="dock-bible-compare-stack">
                            <div className="dock-bible-compare-block">
                              <span className="translation-badge">{translationA}</span>
                              <div className="dock-bible-compare-block__text">{verseA.text}</div>
                            </div>
                            <div className="dock-bible-compare-block">
                              <span className="translation-badge">{translationB}</span>
                              <div className="dock-bible-compare-block__text">{verseB.text}</div>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="dock-bible-verse-row__main">
                          {verseParts.length > 1 ? (
                            <div className="dock-bible-verse-parts">
                              {verseParts.map((part, partIndex) => (
                                <div
                                  key={partIndex}
                                  data-verse-part={partIndex}
                                  data-part-text={part}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${selectedBook} ${selectedChapter}:${verse.verse}, part ${partIndex + 1} of ${verseParts.length}`}
                                  className={`dock-bible-verse-part${activeVersePart?.verse === verse.verse && activeVersePart.index === partIndex ? " dock-bible-verse-part--active" : ""}`}
                                >
                                  <span className="dock-bible-verse-part__badge">{partIndex + 1}/{verseParts.length}</span>
                                  <span className="dock-bible-verse-part__text"><HighlightedVerseText text={part} highlights={rowHighlights} /></span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="dock-bible-verse-row__text"><HighlightedVerseText text={verse.text} highlights={rowHighlights} /></span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {verseContextMenu && typeof document !== "undefined" && createPortal(
              <>
                <div
                  className="dock-schedule-backdrop"
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 99999,
                    background: "transparent",
                  }}
                  onClick={() => setVerseContextMenu(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setVerseContextMenu(null);
                  }}
                />
                <div
                  className="dock-bible-context-menu"
                  style={{
                    position: "fixed",
                    top: `${verseContextMenu.y}px`,
                    left: `${verseContextMenu.x}px`,
                    zIndex: 100000,
                    // Opening the word picker makes the menu taller: scroll inside the window instead of running off it.
                    maxHeight: `${Math.max(240, (typeof window !== "undefined" ? window.innerHeight : 800) - verseContextMenu.y - 8)}px`,
                    overflowY: "auto",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="dock-bible-context-menu__actions">
                  <button
                    type="button"
                    className="dock-bible-context-menu__action"
                    title={t("schedule.addToSchedule", "Add to Schedule")}
                    aria-label={t("schedule.addToSchedule", "Add to Schedule")}
                    onClick={() => {
                      if (selectedBook && selectedChapter) {
                        const currentScheduleBibleTheme = overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id;
                        const currentScheduleThemeSettings = overlayMode === "fullscreen"
                          ? fullscreenQuickThemeSettings
                          : lowerThirdQuickThemeSettings;

                        addBibleToActiveSchedule({
                          reference: `${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`,
                          text: verseContextMenu.text,
                          translation: activeTranslation,
                          book: selectedBook,
                          chapter: selectedChapter,
                          verse: verseContextMenu.verse,
                          overlayMode,
                          theme: currentScheduleBibleTheme,
                          bibleThemeSettings: currentScheduleThemeSettings as unknown as Record<string, unknown> | null,
                        });
                      }
                      setVerseContextMenu(null);
                    }}
                  >
                    <Icon name="playlist_add" size={20} />
                    <span>{t("bible.menuSchedule", "Schedule")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-context-menu__action"
                    title={t("bible.compareVerses", "Compare Verses")}
                    aria-label={t("bible.compareVerses", "Compare Verses")}
                    onClick={() => {
                      if (selectedBook && selectedChapter) {
                        setCompareVersesModal({
                          book: selectedBook,
                          chapter: selectedChapter,
                          verse: verseContextMenu.verse,
                        });
                      }
                      setVerseContextMenu(null);
                    }}
                  >
                    <Icon name="compare_arrows" size={20} />
                    <span>{t("bible.menuCompare", "Compare")}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-context-menu__action"
                    title={favoriteRefs.has(`${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`) ? t("bible.unstarVerse", "Unstar Verse") : t("bible.starVerse", "Star Verse")}
                    aria-label={favoriteRefs.has(`${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`) ? t("bible.unstarVerse", "Unstar Verse") : t("bible.starVerse", "Star Verse")}
                    onClick={() => {
                      void handleToggleStarVerse(verseContextMenu.verse, verseContextMenu.text);
                      setVerseContextMenu(null);
                    }}
                  >
                    <Icon
                      name={favoriteRefs.has(`${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`) ? "star" : "star_border"}
                      size={20}
                    />
                    <span>
                      {favoriteRefs.has(`${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`)
                        ? t("bible.menuUnstar", "Unstar")
                        : t("bible.menuStar", "Star")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-context-menu__action"
                    title={t("bible.copyVerse", "Copy Verse")}
                    aria-label={t("bible.copyVerse", "Copy Verse")}
                    onClick={() => {
                      const reference = `${selectedBook} ${selectedChapter}:${verseContextMenu.verse}`;
                      void copyTextToClipboard(
                        buildBibleVerseClipboardText([{ reference, translation: activeTranslation, text: verseContextMenu.text }]),
                      ).then((copied) => showCopyFeedback(copied ? "success" : "error"));
                      setVerseContextMenu(null);
                    }}
                  >
                    <Icon name="content_copy" size={20} />
                    <span>{t("bible.menuCopy", "Copy")}</span>
                  </button>
                  </div>
                  <div className="dock-bible-context-menu__divider" />
                  <div className="dock-bible-context-menu__section">
                    <label className="dock-bible-context-menu__field">
                      <span className="dock-bible-context-menu__section-header">
                        <Icon name="format_align_left" size={13} />
                        <span>{t("bible.linesPerStage", "Lines per stage")}</span>
                      </span>
                      <select
                        className="dock-bible-context-menu__select"
                        value={displayedBrowserVerseLineCount}
                        onChange={(e) => {
                          handleBrowserVerseLineCountChange(Number(e.target.value));
                          setVerseContextMenu(null);
                        }}
                      >
                        {Array.from({ length: MAX_VERSE_LINES }, (_, index) => index + 1).map((count) => (
                          <option key={count} value={count}>
                            {count === 1 ? t("bible.oneLine", "1 Line") : t("bible.xLines", `${count} Lines`, { count })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="dock-bible-context-menu__field">
                      <span className="dock-bible-context-menu__section-header">
                        <Icon name="vertical_split" size={13} />
                        <span>{t("bible.splitLongVerse", "Split long verse")}</span>
                      </span>
                      <select
                        className="dock-bible-context-menu__select"
                        value={verseSplitModeId(verseSplitMode(verseContextMenu.verse))}
                        disabled={compareEnabled}
                        title={compareEnabled ? t("bible.splitNotWhileComparing", "Not available while comparing versions") : undefined}
                        onChange={(e) => {
                          setVerseSplit(verseContextMenu.verse, parseVerseSplitMode(e.target.value));
                          setVerseContextMenu(null);
                        }}
                      >
                        <option value="off">{t("bible.splitOff", "Off")}</option>
                        <option value="parts-2">{t("bible.splitParts2", "2 parts")}</option>
                        <option value="parts-3">{t("bible.splitParts3", "3 parts")}</option>
                        <option value="lines-3">{t("bible.splitLines3", "3 lines at a time")}</option>
                        <option value="lines-4">{t("bible.splitLines4", "4 lines at a time")}</option>
                      </select>
                    </label>
                  </div>
                  <div className="dock-bible-context-menu__divider" />
                  <div className="dock-bible-context-menu__section">
                    <div className="dock-bible-context-menu__section-header">
                      <Icon name="palette" size={13} />
                      <span>{t("bible.highlightWords", "Highlight words")}</span>
                    </div>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item dock-bible-context-menu__item--small"
                      aria-expanded={wordPick.open}
                      onClick={() => setWordPick((current) => ({ open: !current.open, from: null, to: null }))}
                    >
                      <Icon name="touch_app" size={16} />
                      <span>{t("bible.pickWords", "Pick words to colour")}</span>
                    </button>
                    {wordPick.open && (() => {
                      const words = verseContextMenu.text.split(/\s+/).filter(Boolean);
                      const lo = wordPick.from === null ? -1 : Math.min(wordPick.from, wordPick.to ?? wordPick.from);
                      const hi = wordPick.from === null ? -1 : Math.max(wordPick.from, wordPick.to ?? wordPick.from);
                      const picked = lo >= 0 ? cleanHighlightText(words.slice(lo, hi + 1).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")) : "";
                      return (
                        <>
                          <div className="dock-bible-context-menu__hint">
                            {t("bible.pickWordsHint", "Tap the first word, then the last word.")}
                          </div>
                          <div className="dock-bible-context-menu__words" role="group" aria-label={t("bible.pickWords", "Pick words to colour")}>
                            {words.map((word, index) => (
                              <button
                                key={`${index}-${word}`}
                                type="button"
                                className={`dock-bible-context-menu__word${index >= lo && index <= hi ? " dock-bible-context-menu__word--picked" : ""}`}
                                onClick={() => setWordPick((current) => (
                                  current.from === null || current.to !== null
                                    ? { open: true, from: index, to: null }
                                    : { open: true, from: current.from, to: index }
                                ))}
                              >
                                {word}
                              </button>
                            ))}
                          </div>
                          {picked && (
                            <div className="dock-bible-context-menu__swatches" role="group" aria-label={t("bible.highlightColor", "Highlight colour")}>
                              {HIGHLIGHT_COLORS.map((color) => (
                                <button
                                  key={color.id}
                                  type="button"
                                  className={`dock-bible-context-menu__swatch${color.hex ? "" : " dock-bible-context-menu__swatch--theme"}`}
                                  style={color.hex ? { background: color.hex } : undefined}
                                  title={`${color.label}: “${picked.length > 30 ? `${picked.slice(0, 30)}…` : picked}”`}
                                  aria-label={`${t("bible.highlightWith", "Highlight with")} ${color.label}`}
                                  onClick={() => {
                                    addVerseHighlight(verseContextMenu.verse, picked, color.id);
                                    setVerseContextMenu(null);
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {verseContextMenu.selection ? (
                      <>
                        <div className="dock-bible-context-menu__hint" title={verseContextMenu.selection}>
                          “{verseContextMenu.selection.length > 34 ? `${verseContextMenu.selection.slice(0, 34)}…` : verseContextMenu.selection}”
                        </div>
                        <div className="dock-bible-context-menu__swatches" role="group" aria-label={t("bible.highlightColor", "Highlight colour")}>
                          {HIGHLIGHT_COLORS.map((color) => (
                            <button
                              key={color.id}
                              type="button"
                              className={`dock-bible-context-menu__swatch${color.hex ? "" : " dock-bible-context-menu__swatch--theme"}`}
                              style={color.hex ? { background: color.hex } : undefined}
                              title={color.label}
                              aria-label={`${t("bible.highlightWith", "Highlight with")} ${color.label}`}
                              onClick={() => {
                                addVerseHighlight(verseContextMenu.verse, verseContextMenu.selection, color.id);
                                window.getSelection()?.removeAllRanges();
                                setVerseContextMenu(null);
                              }}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="dock-bible-context-menu__hint">
                        {t("bible.highlightHint", "Select words in the verse, then right-click to colour them.")}
                      </div>
                    )}
                    {highlightsForVerse(verseContextMenu.verse).length > 0 && (
                      <button
                        type="button"
                        className="dock-bible-context-menu__item"
                        onClick={() => {
                          clearVerseHighlights(verseContextMenu.verse);
                          setVerseContextMenu(null);
                        }}
                      >
                        <Icon name="close" size={16} />
                        <span>{t("bible.clearHighlights", "Clear highlights")}</span>
                      </button>
                    )}
                  </div>
                </div>
              </>,
              document.body,
            )}

            <div
              className={`dock-bible-reader__quick-actions${quickActionsLeft !== null && quickActionsLeft < 210 ? " dock-bible-reader__quick-actions--menu-right" : ""}`}
              ref={browserFontSizePopoverRef}
              style={{
                top: `${quickActionsTop}px`,
                ...(quickActionsLeft !== null ? { left: `${quickActionsLeft}px`, right: "auto" } : {}),
              }}
            >
              <button
                type="button"
                className={`dock-bible-reader__quick-actions-trigger${showBrowserFontSizePopover ? " dock-bible-reader__quick-actions-trigger--active" : ""}${isQuickActionsDragging ? " dock-bible-reader__quick-actions-trigger--dragging" : ""}`}
                onClick={handleQuickActionsClick}
                onPointerDown={handleQuickActionsPointerDown}
                onPointerMove={handleQuickActionsPointerMove}
                onPointerUp={finishQuickActionsDrag}
                onPointerCancel={finishQuickActionsDrag}
                aria-haspopup="dialog"
                aria-expanded={showBrowserFontSizePopover}
                aria-label={t("bible.obsQuickActions", "Bible OBS quick actions. Drag up or down.")}
                title={t("bible.obsQuickActions", "Bible OBS quick actions. Drag up or down.")}
              >
                <span className="dock-bible-reader__quick-actions-label">{t("bible.quickActions", "Quick")}</span>
              </button>
              <BibleOutputControlsMenu
                open={showBrowserFontSizePopover}
                settings={quickControlSettings}
                lineCount={displayedBrowserVerseLineCount}
                isFitTextMode={isFitTextMode}
                browserQuickUpdateImmediately={browserQuickUpdateImmediately}
                hasPendingBrowserQuickChanges={hasPendingBrowserQuickChanges}
                mode={browserFontMode}
                compareEnabled={compareEnabled}
                onToggleCompare={() => handleCompareEnabledChange(!compareEnabled)}
                translationB={translationB}
                availableTranslations={availableTranslations}
                onTranslationBChange={handleQuickTranslationBChange}
                onClose={() => setShowBrowserFontSizePopover(false)}
                onLowerThirdSizePresetChange={handleLowerThirdSizePresetChange}
                onLineCountChange={handleBrowserVerseLineCountChange}
                onUpdateImmediatelyChange={handleBrowserQuickUpdateImmediatelyChange}
                onSave={saveBrowserQuickSettings}
                onOpenSettings={() => {
                  setShowBrowserFontSizePopover(false);
                  openThemeSettings("background");
                }}
                onFontSizeStep={handleBrowserFontSizeStep}
                onTextStyleChange={handleBrowserTextStyleChange}
                currentFontSize={displayedBrowserFontSettings.fontSize || (browserFontMode === "fullscreen" ? 56 : 36)}
                minFontSize={browserFontSizeMin}
                maxFontSize={browserFontSizeMax}
                onOverlayModeChange={fullscreenOnlyMode ? undefined : handleOverlayModeChange}
                outputVisible={bibleOverlayVisible}
                outputVisibilityPending={visibilityActionPending}
                onToggleOutputVisible={() => { void handleToggleBibleVisibility(); }}
                referenceShown={referenceFormat !== "hidden"}
                onReferenceShownChange={(shown) => handleReferenceFormatChange(shown ? lastVisibleReferenceFormatRef.current : "hidden")}
                versionShown={referenceVersionVisible}
                onVersionShownChange={handleReferenceVersionVisibleChange}
              />
            </div>

            {searchPlacement === "bottom" && renderChapterBar()}

            {actionError && (
              <div className="dock-action-error dock-action-error--console">
                <Icon name="warning" size={14} />
                <span style={{ flex: 1 }}>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError("")}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                  title={t("common.close")}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}

            {/* ── Toolbar ── */}
            <DockBottomToolbar
              overlayMode={fullscreenOnlyMode ? "fullscreen" : overlayMode}
              onModeChange={handleOverlayModeChange}
              displayMode={displayMode}
              onDisplayModeChange={handleDisplayModeChange}
              centerAction={
                <button
                  type="button"
                  className="dock-bible-reader__quick-edit-toolbar-btn"
                  onClick={() => openThemeSettings("text")}
                  title={t("bible.quickEdits", "Quick Edits")}
                  aria-label={t("bible.quickEdits", "Quick Edits")}
                >
                  <Icon name="edit" size={14} />
                  <span className="dock-bible-reader__quick-edit-label">{t("bible.quickEdits", "Quick Edits")}</span>
                </button>
              }
              onQuickEdit={() => openThemeSettings("text")}
              quickEditLabel={t("bible.quickEdits", "Quick Edits")}
              morphing={modeMorphing}
              hideOverlayModeToggle={fullscreenOnlyMode}
              clearLabel={bibleOverlayVisible
                ? t("dock.bottomToolbar.hideBible")
                : t("dock.bottomToolbar.showBible", { defaultValue: "Show Bible" })}
              onClear={handleToggleBibleVisibility}
              clearDisabled={visibilityActionPending}
              sourceVisible={bibleOverlayVisible}
              collapsed={toolbarCollapsed}
              onCollapseChange={setToolbarCollapsed}
              hideCollapse={searchPlacement !== "bottom"}
              bottomPanel={bottomSearchPanel}
              bottomPanelToggle={undefined}
              children={
                <DockSceneRoutingControl
                  module="bible"
                  route={sceneRoute}
                  onRouteChange={updateSceneRoute}
                  title={t("sceneRouting.bible", "Output")}
                  placement="above"
                  showLabel
                  iconName="cast"
                  itemLabel={t("bible.scripture", "scripture")}
                  onSend={(opts) => {
                    if (selectedBook && selectedChapter) {
                      if (opts?.bypassSceneRoute) {
                        bibleSceneRouteConfirmedRef.current = false;
                      } else {
                        bibleSceneRouteConfirmedRef.current = true;
                      }
                      void goLiveVerse(selectedBook, selectedChapter, selectedVerse ?? 1, {
                        bypassSceneRoute: opts?.bypassSceneRoute,
                      });
                    }
                  }}
                />
              }
            />

            {/* ── Footer actions ── */}

          </section>

          {
            keywordActionResult && (
              <div
                className="dock-dialog-backdrop"
                role="presentation"
                onClick={() => setKeywordActionResult(null)}
              >
                <div
                  className="dock-dialog dock-dialog--compact"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="dock-bible-keyword-action-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="dock-dialog__header">
                    <div>
                      <div className="dock-dialog__eyebrow">{t("bible.keywordMatch")}</div>
                      <h2 id="dock-bible-keyword-action-title" className="dock-dialog__title">
                        {keywordActionResult.label}
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="dock-dialog__close"
                      onClick={() => setKeywordActionResult(null)}
                      aria-label={t("bible.closeKeywordActionDialog")}
                      title={t("common.close")}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  <div className="dock-dialog__body">
                    <div className="dock-bible-keyword-modal__text">
                      {renderHighlightedKeywordText(keywordActionResult.text, keywordActionResult.query)}
                    </div>
                    <label className="dock-bible-keyword-modal__direct-push">
                      <input
                        type="checkbox"
                        checked={keywordMatchPushDirectlyToObs}
                        onChange={(event) => handleKeywordMatchDirectPushChange(event.target.checked)}
                      />
                      <span className="dock-bible-keyword-modal__direct-push-copy">
                        <span>{t("bible.keywordMatchShowImmediately", "Show matching verses immediately next time")}</span>
                        <small>{t("bible.keywordMatchShowImmediatelyDesc", "Leave unchecked to show this confirmation each time.")}</small>
                      </span>
                    </label>
                  </div>
                  <div className="dock-dialog__footer dock-bible-keyword-modal__footer">
                    <button
                      type="button"
                      className="dock-btn dock-btn--ghost dock-btn--compact"
                      onClick={() => {
                        const keywordOutputOptions = getDockBibleKeywordMatchOutputOptions(keywordActionResult, MAX_VERSE_LINES);
                        setVerseLineCount(keywordOutputOptions.lineCount);
                        focusReference(keywordActionResult.book, keywordActionResult.chapter, keywordActionResult.verse);
                        setKeywordActionResult(null);
                        window.setTimeout(() => {
                          const verseRow = verseGridRef.current?.querySelector<HTMLElement>(
                            `[data-verse-row="${keywordActionResult.verse}"]`,
                          );
                          if (verseRow) {
                            const container = verseGridRef.current;
                            if (container) {
                              const verseRect = verseRow.getBoundingClientRect();
                              const containerRect = container.getBoundingClientRect();
                              const targetScrollTop = container.scrollTop + (verseRect.top - containerRect.top) - containerRect.height * 0.1;
                              container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
                            }
                          }
                        }, 150);
                      }}
                      title={t("bible.goToChapter")}>
                      <Icon name="menu_book" size={14} />
                      {t("bible.goToChapter")}
                    </button>
                    <DockSceneRouteSendControl
                      route={sceneRoute}
                      onRouteChange={updateSceneRoute}
                      className="dock-btn dock-btn--primary dock-btn--compact"
                      iconName="cast"
                      label={t("common.sendToObs", "Send to OBS")}
                      itemLabel={t("bible.scripture", "scripture")}
                      onSend={async (opts) => {
                        const keywordOutputOptions = getDockBibleKeywordMatchOutputOptions(keywordActionResult, MAX_VERSE_LINES);
                        if (opts?.bypassSceneRoute && sceneRoute.targets.length > 0) {
                          await Promise.allSettled(sceneRoute.targets.map((t) => (
                            dockObsClient.clearSceneRouteSource("bible", t.sceneName)
                          )));
                        }
                        void goLiveVerse(
                          keywordActionResult.book,
                          keywordActionResult.chapter,
                          keywordActionResult.verse,
                          {
                            translation: activeBibleSearchTranslation,
                            lineCount: keywordOutputOptions.lineCount,
                            rangeEndVerse: keywordOutputOptions.rangeEndVerse,
                            pushComparePassages: true,
                            bypassSceneRoute: opts?.bypassSceneRoute,
                          },
                        );
                        setKeywordActionResult(null);
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          }

          {/* ── Standalone Theme Settings Modal ── */}
          <DockThemeSettingsModal
            selectedThemeId={activeThemePickerProps.selectedThemeId}
            onSelect={activeThemePickerProps.onSelect}
            allowedCategories={["bible", "general"]}
            quickSettings={activeQuickEditSettings}
            defaultQuickSettings={
              quickEditOverlayMode === "fullscreen"
                ? defaultFullscreenQuickThemeSettings
                : defaultLowerThirdQuickThemeSettings
            }
            onQuickSettingsSave={
              quickEditOverlayMode === "fullscreen"
                ? handleSaveFullscreenQuickThemeSettings
                : handleSaveLowerThirdQuickThemeSettings
            }
            resolveThemeQuickSettings={resolveThemeQuickSettings}
            displayMode={displayMode}
            title={t("bible.quickSettings")}
            subtitle={t("bible.quickSettingsSubtitle")}
            isOpen={showThemeSettings}
            onClose={() => setShowThemeSettings(false)}
            onBackgroundPresetChange={handleBackgroundPresetChange}
            onSaveFeedback={onSaveFeedback}
            referenceFormat={referenceFormat}
            referenceVersionVisible={referenceVersionVisible}
            referenceTranslation={activeTranslation}
            onReferenceFormatChange={handleReferenceFormatChange}
            onReferenceVersionVisibleChange={handleReferenceVersionVisibleChange}
            onReferenceSettingsSave={handleReferenceSettingsSave}
            overlayMode={fullscreenOnlyMode ? "fullscreen" : overlayMode}
            initialTab={themeSettingsInitialTab}
            storageScope="bible"
            hideBackgroundOnCompare={displayMode === "compare"}
            sceneProfiles={sceneProfileOptions}
            activeSceneProfileId={activeSceneProfileId}
            onSceneProfileChange={setActiveSceneProfileId}
          />

          {/* ── Compare Verses Modal ── */}
          <DockBibleCompareVersesModal
            isOpen={compareVersesModal !== null}
            onClose={() => setCompareVersesModal(null)}
            book={compareVersesModal?.book ?? selectedBook ?? "Genesis"}
            chapter={compareVersesModal?.chapter ?? selectedChapter ?? 1}
            initialVerse={compareVersesModal?.verse ?? selectedVerse ?? 1}
            totalVerses={activePassage?.verses?.length || 50}
            availableTranslations={availableTranslations}
            activeTranslation={activeTranslation}
            secondaryTranslation={translationB}
            onProjectSingle={handleCompareModalProjectSingle}
            onProjectCompare={handleCompareModalProjectCompare}
          />

          {copyFeedback && (
            <div
              className={`dock-bible-copy-feedback dock-bible-copy-feedback--${copyFeedback}`}
              role="status"
              aria-live="polite"
            >
              <Icon name={copyFeedback === "success" ? "check_circle" : "warning"} size={14} />
              <span>
                {copyFeedback === "success"
                  ? t("common.copiedToClipboard")
                  : t("common.copyFailed", { defaultValue: "Could not copy to clipboard" })}
              </span>
            </div>
          )}

          {renderComparePopover()}

          {showBibleHistory && (
            <BibleHistoryScreen
              onBack={() => {
                refreshFavoriteHistorySearches();
                setShowBibleHistory(false);
                onHistoryClose?.();
              }}
              onGoToChapter={(book, chapter, verse) => {
                refreshFavoriteHistorySearches();
                setSelectedBook(book);
                setSelectedChapter(chapter);
                setSelectedVerse(verse);
                selectedVerseRef.current = verse;
                setHighlightVerse(verse);
                setShowBibleHistory(false);
                onHistoryClose?.();
              }}
              onSendToObs={(book, chapter, verse) => {
                refreshFavoriteHistorySearches();
                setSelectedBook(book);
                setSelectedChapter(chapter);
                setSelectedVerse(verse);
                selectedVerseRef.current = verse;
                setHighlightVerse(verse);
                setShowBibleHistory(false);
                onHistoryClose?.();
                void goLiveVerse(book, chapter, verse, {
                  translation: activeTranslation,
                  columnIndex: activeColumnIndex,
                  reveal: true,
                });
              }}
              onNavigateToVerse={(book, chapter, verse) => {
                refreshFavoriteHistorySearches();
                setSelectedBook(book);
                setSelectedChapter(chapter);
                setSelectedVerse(verse);
                selectedVerseRef.current = verse;
                setHighlightVerse(verse);
                setShowBibleHistory(false);
                onHistoryClose?.();
                void goLiveVerse(book, chapter, verse, {
                  translation: activeTranslation,
                  columnIndex: activeColumnIndex,
                  reveal: true,
                });
              }}
            />
          )}

          {showAllFavoritesModal && (
            <DockBibleFavoritesModal
              isOpen={showAllFavoritesModal}
              onClose={() => setShowAllFavoritesModal(false)}
              favorites={favoriteSearches}
              favoritePassages={favoritePassages}
              onSelectFavorite={(fav) => {
                handleFavoriteClick(fav);
                setShowAllFavoritesModal(false);
              }}
              onGoToChapter={(fav) => {
                const result = parseBibleSearch(fav.reference)[0];
                if (result && result.book && result.chapter !== null) {
                  handleGoToChapter({ ...result, kind: "reference" });
                } else {
                  handleFavoriteClick(fav);
                }
                setShowAllFavoritesModal(false);
              }}
              onSendToObs={(fav) => {
                handleFavoriteClick(fav);
                setShowAllFavoritesModal(false);
              }}
              onRemoveFavorite={(reference) => {
                void handleRemoveFavorite(reference);
              }}
            />
          )}

          {showBibleMacrosModal && (
            <DockBibleMacrosModal
              isOpen={showBibleMacrosModal}
              onClose={() => setShowBibleMacrosModal(false)}
              onSelectMacro={(macro) => {
                const searchContext = {
                  currentBook: selectedBook,
                  currentChapter: selectedChapter,
                  currentVerse: selectedVerse,
                };
                const res = parseBibleSearch(macro.keyword, { context: searchContext })[0];
                if (res) {
                  void handlePickResult({ ...res, kind: "reference" });
                }
              }}
            />
          )}

          <DockSceneRouteConfirmDialog
            open={Boolean(pendingVerseRouteConfirm)}
            route={sceneRoute}
            itemLabel={t("bible.scripture", "scripture")}
            onConfirmRouted={handleConfirmBibleRoute}
            onSendToMceAlone={handleSendBibleToMceAlone}
            onCancel={handleCancelBibleRouteConfirm}
          />

          <DockOnboardingTour />
        </>
      )}
    />
  );
}

export default memo(DockBibleTab);
