import { safeTauriInvoke, safeTauriListen, type TauriUnlisten } from "./tauriSafe";
import { obsService } from "./obsService";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import type { BibleTheme, BibleTranslation } from "../bible/types";
import { dockObsClient } from "../dock/dockObsClient";
import { lowerThirdObsService } from "../lowerthirds/lowerThirdObsService";
import { LT_THEMES } from "../lowerthirds/themes";
import { getChapter, searchBible } from "../bible/bibleData";
import { getInstalledTranslations } from "../bible/bibleDb";
import { getAllSongs, getSong } from "../worship/worshipDb";
import type { Song } from "../worship/types";
import { getAllMedia, saveMedia } from "../library/libraryDb";
import type { MediaItem } from "../library/libraryTypes";
import { getUserScopedKey, readUserScopedStorage } from "./userScopedStorage";
import {
  readDockPreference,
  readDockPreferenceList,
  saveDockPreference,
  writeDockPreference,
} from "./dockPreferenceStorage";
import { buildDockBackgroundPresetOverrides, type DockBackgroundPreset } from "../dock/dockConsoleTheme";
import { loadDockFavoriteBibleThemes, loadDockLTFavorites, loadDockTickerFavorites } from "../dock/dockThemeData";
import { getCountdowns } from "../countdowns/countdownStore";
import { hideAllCountdowns, sendCountdownToObs } from "../countdowns/countdownObsService";
import type { CountdownConfig } from "../countdowns/types";
import { HARDCODED_COUNTDOWNS } from "../dock/tabs/DockCountdownsTab";
import { loadDockNotes, saveDockNotes, type DockNote } from "../dock/dockNotesStorage";
import { parseBibleSearch } from "../dock/bibleSearchParser";
import { loadBibleHistory } from "../dock/tabs/bibleHistoryTypes";
import { readNativeDockSetting, writeNativeDockSetting } from "./localDockSettings";
import {
  DEFAULT_DOCK_TICKER_THEME_OPTION,
  getDockTickerThemeOptionsForFavorites,
  renderDockTickerThemeHtml,
  resolveDockTickerDividerChar,
  type DockTickerDivider,
} from "../dock/tickerThemeCatalog";
import { getCachedRemoteProductionThemes } from "./remoteProductionThemes";
import { getSettings } from "../multiview/mvStore";
import { normalizeBrandColor } from "../lowerthirds/runtimeBranding";
import { resolveOverlayAssetUrl } from "./overlayUrl";
import { loadDockOutputFontFamily } from "../dock/dockOutputTypography";
import type { TickerThemeColors } from "../components/modules/tickerThemes";
import { applyDockLinePresentationControls } from "./textPresentationPreferences";
import {
  clearAutomationLogs,
  deleteMacro,
  deleteAutomationRule,
  getAutomationLogs,
  getAutomationRules,
  getMacros,
  saveAutomationRule,
  saveMacro,
  setAutomationRuleEnabled,
  type AutomationStep,
  type StoredAutomationRule,
} from "./automationStore";
import { automationRunner } from "./automationRunner";
import {
  trackBiblePresent,
  trackBibleSearch,
  trackMediaPresented,
  trackOutputShown,
  trackWorshipSongPresented,
} from "./tracking";
import {
  getDockSceneRouteTargets,
  loadDockSceneRoute,
  normalizeDockSceneRoute,
  saveDockSceneRoute,
  type DockSceneRouteModule,
} from "../dock/dockSceneRouting";

type MobileCommand =
  | {
      type: "show_scripture";
      reference: string;
      translation?: string;
      verse_text?: string;
      display_reference_label?: string;
      overlay_mode?: string;
      compare_enabled?: boolean;
      compare_layout?: string;
      compare_mode?: "translations" | "passages" | string;
      translation_a?: string;
      translation_b?: string;
      compare_verse_text_a?: string;
      compare_verse_text_b?: string;
      compare_passages?: Array<{
        reference?: string;
        book?: string;
        chapter?: number;
        verse?: number;
        verse_end?: number;
        verse_range?: string;
        reference_label?: string;
        translation?: string;
        verse_text?: string;
      }>;
    }
  | { type: "get_bible_presentation_style" }
  | { type: "get_text_presentation_style"; surface: "bible" | "worship" | "notes" }
  | {
      type: "save_presentation_background";
      surface: "bible" | "worship" | "notes";
      overlay_mode?: "fullscreen" | "lower-third";
      background_type: "off" | "theme" | "color" | "image" | "video" | "pattern";
      background_color?: string;
      background_color_end?: string;
      background_pattern?: string;
      background_image?: string;
      background_image_file_path?: string;
      background_video?: string;
      background_video_file_path?: string;
    }
  | { type: "save_text_presentation_controls"; surface: "bible" | "worship" | "notes"; patch?: Record<string, unknown>; line_count?: number; line_mode?: "count" | "original"; quick_alignment?: "left" | "right" }
  | { type: "get_bible_search_suggestions"; query?: string; translation?: string }
  | { type: "record_bible_search"; label: string }
  | { type: "clear_scripture" }
  | {
      type: "show_slide";
      song_id: string;
      slide_index: number;
      song_title?: string;
      artist?: string;
      slide_text?: string;
      section_label?: string;
      overlay_mode?: string;
    }
  | { type: "next_slide"; song_id?: string; slide_index?: number }
  | { type: "prev_slide"; song_id?: string; slide_index?: number }
  | { type: "clear_worship" }
  | {
      type: "show_lower_third";
      name: string;
      title: string;
      theme_id?: string;
      values?: Record<string, string>;
      size?: "xs" | "sm" | "md" | "lg";
    }
  | { type: "get_lower_third_themes" }
  | { type: "get_scene_route"; module: DockSceneRouteModule }
  | { type: "save_scene_route"; module: DockSceneRouteModule; route: Record<string, unknown> }
  | { type: "clear_lower_third" }
  | { type: "blank_lower_third" }
  | { type: "get_bible_translations" }
  | { type: "get_bible_chapter"; book: string; chapter: number; translation: string }
  | { type: "get_worship_library" }
  | { type: "get_notes" }
  | { type: "save_notes"; notes: DockNote[] }
  | { type: "show_note"; note: DockNote }
  | { type: "clear_notes" }
  | { type: "get_media_library" }
  | { type: "get_media_thumbnail"; media_id: string }
  | {
      type: "register_uploaded_media";
      media_id: string;
      name: string;
      media_type: "image" | "video" | "document";
      disk_file_name: string;
      file_size?: number;
      mime_type?: string;
    }
  | {
      type: "show_media";
      media_id: string;
      muted?: boolean;
      looping?: boolean;
      fit_mode?: "cover" | "contain" | "stretch";
      transition?: "cut" | "fade";
    }
  | {
      type: "send_media_to_scene";
      media_id: string;
      scene_name: string;
      muted?: boolean;
      looping?: boolean;
      fit_mode?: "cover" | "contain" | "stretch";
    }
  | { type: "clear_media" }
  | {
      type: "show_ticker";
      badge?: string;
      ticker_text: string;
      messages?: string[];
      speed?: number;
      position?: "top" | "bottom";
      looping?: boolean;
      divider?: DockTickerDivider;
      message_spacing?: number;
      text_color?: string;
      background_color?: string;
      paused?: boolean;
    }
  | { type: "clear_ticker" }
  | { type: "get_ticker_presentation_style" }
  | {
      type: "save_ticker_settings";
      speed?: number;
      position?: "top" | "bottom";
      looping?: boolean;
      theme_id?: string;
      heading?: string;
      message_spacing?: number;
      divider?: DockTickerDivider;
      colors?: Partial<TickerThemeColors>;
    }
  | { type: "get_ticker_messages" }
  | { type: "save_ticker_messages"; messages: Array<{ id: string; text: string; active: boolean }> }
  | { type: "get_countdowns" }
  | {
      type: "show_countdown";
      config: CountdownConfig;
      sync?: { paused: boolean; remaining: number };
    }
  | { type: "clear_countdown" }
  | { type: "get_multiview_cards" }
  | { type: "clear_multiview"; scene_name: string; multiview_id?: string }
  | { type: "get_current_state" }
  | { type: "get_scenes" }
  | { type: "switch_scene"; scene_name: string }
  | { type: "set_preview_scene"; scene_name: string }
  | { type: "set_studio_mode"; enabled: boolean }
  | { type: "get_scene_screenshot"; scene_name: string; image_width?: number }
  | { type: "toggle_streaming" }
  | { type: "toggle_recording" }
  | { type: "toggle_mic" }
  | { type: "get_macros" }
  | { type: "save_macro"; macro_data: Record<string, unknown> }
  | { type: "delete_macro"; macro_id: string }
  | { type: "execute_macro"; macro_id: string }
  | { type: "execute_automation"; macro_id: string }
  | { type: "get_automation_rules" }
  | { type: "save_automation_rule"; rule_data: Record<string, unknown> }
  | { type: "delete_automation_rule"; rule_id: string }
  | { type: "toggle_automation_rule"; rule_id: string; enabled: boolean }
  | { type: "get_automation_logs" }
  | { type: "clear_automation_logs" };

interface MobileCommandEvent {
  commandId: string;
  command: MobileCommand;
}

function parseReference(reference: string): { book: string; chapter: number; verse: number; endVerse?: number } | null {
  const match = reference.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?/);
  if (!match) return null;
  return {
    book: match[1].trim(),
    chapter: Number(match[2]),
    verse: Number(match[3]),
    ...(match[4] ? { endVerse: Number(match[4]) } : {}),
  };
}

const DOCK_BIBLE_PREFS_KEY = "ocs-dock-bible-preferences";
const DOCK_BIBLE_UI_PREFS_KEY = "ocs-dock-bible-ui-preferences";

type DockBiblePreferencesSnapshot = {
  [key: string]: unknown;
  overlayMode?: "fullscreen" | "lower-third";
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  fullscreenQuickThemeSettings?: Record<string, unknown> | null;
  lowerThirdQuickThemeSettings?: Record<string, unknown> | null;
  lowerThirdQuickThemeSettingsLinkedToFullscreen?: boolean;
  referenceFormat?: string;
  referenceVersionVisible?: boolean;
  verseLineCount?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveThemeVariant(theme: BibleTheme, mode: "fullscreen" | "lower-third"): BibleTheme {
  const variant = mode === "fullscreen" ? theme.variants?.fullscreen : theme.variants?.lowerThird;
  return variant ? { ...theme, settings: variant.settings, rawTemplate: variant.rawTemplate } : theme;
}

/**
 * Read the same durable Dock preferences used by DockBibleTab. The phone does
 * not own a second theme system: every mobile presentation uses this snapshot
 * at send time so a color/theme change in the desktop Dock is immediately
 * respected by the next mobile click.
 */
async function getDockBiblePresentationStyle(requestedMode?: string) {
  const prefs = readDockPreference<DockBiblePreferencesSnapshot>(DOCK_BIBLE_PREFS_KEY) ?? {};
  const mode: "fullscreen" | "lower-third" = requestedMode === "lower-third"
    ? "lower-third"
    : requestedMode === "fullscreen"
      ? "fullscreen"
      : prefs.overlayMode === "lower-third"
        ? "lower-third"
        : "fullscreen";

  const favoriteThemes = await loadDockFavoriteBibleThemes().catch(() => []);
  const themes = new Map<string, BibleTheme>();
  for (const theme of [...BUILTIN_THEMES, ...favoriteThemes]) {
    if (theme?.id && !themes.has(theme.id)) themes.set(theme.id, theme);
  }

  const themeId = mode === "fullscreen" ? prefs.fullscreenThemeId : prefs.lowerThirdThemeId;
  const fallbackTheme = BUILTIN_THEMES[0];
  const selectedTheme = (themeId ? themes.get(themeId) : null) ?? fallbackTheme;
  const themed = resolveThemeVariant(selectedTheme, mode);
  const quickSettings = mode === "fullscreen"
    ? prefs.fullscreenQuickThemeSettings
    : prefs.lowerThirdQuickThemeSettings;
  const settings = {
    ...themed.settings,
    ...(isRecord(quickSettings) ? quickSettings : {}),
  } as Record<string, unknown>;
  const backgroundPreset = prefs.backgroundPreset ?? "theme";
  const liveOverrides = mode === "fullscreen"
    ? buildDockBackgroundPresetOverrides(
      settings as unknown as Parameters<typeof buildDockBackgroundPresetOverrides>[0],
      backgroundPreset,
    )
    : null;
  const uiPrefs = readDockPreference<Record<string, unknown>>(DOCK_BIBLE_UI_PREFS_KEY) ?? {};

  return {
    overlayMode: mode,
    themeId: themed.id,
    themeName: themed.name,
    backgroundPreset,
    referenceFormat: prefs.referenceFormat ?? "full",
    referenceVersionVisible: prefs.referenceVersionVisible !== false,
    verseLineCount: Number(prefs.verseLineCount) || 1,
    quickAlignment: typeof uiPrefs.quickActionsLeft === "number" ? "left" : "right",
    themeSettings: settings,
    liveOverrides,
    preview: {
      backgroundColor: String(settings.backgroundColor || "#0B1426"),
      fontColor: String(settings.fontColor || "#FFFFFF"),
      referenceColor: String(settings.refFontColor || settings.fontColor || "#FFFFFF"),
    },
  };
}

const BIBLE_RECENT_SEARCHES_KEY = "ocs-dock-bible-recent-searches-v1";
const BIBLE_RECENT_SEARCH_LIMIT = 4;

function readRecentBibleSearchesForMobile(): string[] {
  try {
    const raw = readNativeDockSetting<unknown>(BIBLE_RECENT_SEARCHES_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw ?? [];
    return Array.isArray(parsed)
      ? parsed
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, BIBLE_RECENT_SEARCH_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function recordRecentBibleSearchForMobile(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return readRecentBibleSearchesForMobile();
  const next = [
    normalized,
    ...readRecentBibleSearchesForMobile().filter(
      (item) => item.toLowerCase() !== normalized.toLowerCase(),
    ),
  ].slice(0, BIBLE_RECENT_SEARCH_LIMIT);
  writeNativeDockSetting(BIBLE_RECENT_SEARCHES_KEY, next);
  return next;
}

function isReferenceLikeBibleQueryForMobile(query: string): boolean {
  return /\d|[:.-]|\b(vs|verse|verses|chapter|chap)\b/i.test(query.trim());
}

async function getBibleSearchSuggestionsPayload(
  command: Extract<MobileCommand, { type: "get_bible_search_suggestions" }>,
) {
  const query = String(command.query || "").trim();
  const translation = (command.translation || "KJV").trim().toUpperCase() as BibleTranslation;
  const recentSearches = query ? [] : readRecentBibleSearchesForMobile();
  const favorites = query
    ? []
    : loadBibleHistory()
      .filter((item) => item.isFavorite)
      .slice(0, 8)
      .map((item) => item.reference?.trim() || `${item.book} ${item.chapter}:${item.verse}`)
      .filter(Boolean);

  if (!query) {
    return { query, recentSearches, favorites, suggestions: [] };
  }

  const suggestions: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const addSuggestion = (suggestion: Record<string, unknown>) => {
    const key = String(suggestion.label || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  for (const result of parseBibleSearch(query).slice(0, 8)) {
    addSuggestion({
      kind: "reference",
      book: result.book,
      chapter: result.chapter,
      verse: result.verse,
      endVerse: result.endVerse ?? null,
      label: result.label,
      snippet: "",
      text: "",
      query,
    });
  }

  if (!isReferenceLikeBibleQueryForMobile(query) && query.length >= 2) {
    const matches = await searchBible(query, translation, 16);
    for (const match of matches) {
      addSuggestion({
        kind: "keyword",
        book: match.book,
        chapter: match.chapter,
        verse: match.verse,
        endVerse: match.endVerse ?? null,
        label: `${match.book} ${match.chapter}:${match.endVerse && match.endVerse > match.verse
          ? `${match.verse}-${match.endVerse}`
          : match.verse} — ${translation}`,
        snippet: match.snippet,
        text: match.text,
        query,
      });
    }
  }

  return {
    query,
    recentSearches,
    favorites,
    suggestions: suggestions.slice(0, 24),
  };
}

type TextPresentationSurface = "bible" | "worship" | "notes";

function getTextSurfaceStorage(surface: TextPresentationSurface) {
  if (surface === "notes") {
    return {
      prefsKey: "ocs-dock-notes-preferences",
      fullscreenQuickKey: "fullscreenQuickSettings",
      lowerThirdQuickKey: "lowerThirdQuickSettings",
      lineCountKey: "linesPerSlide",
      lineModeKey: "autoSplit",
      defaultLineCount: 4,
    } as const;
  }
  if (surface === "worship") {
    return {
      prefsKey: "ocs-dock-worship-preferences",
      fullscreenQuickKey: "fullscreenQuickThemeSettings",
      lowerThirdQuickKey: "lowerThirdQuickThemeSettings",
      lineCountKey: "linesPerSlide",
      lineModeKey: "linesPerSlideOverride",
      defaultLineCount: 1,
    } as const;
  }
  return {
    prefsKey: DOCK_BIBLE_PREFS_KEY,
    fullscreenQuickKey: "fullscreenQuickThemeSettings",
    lowerThirdQuickKey: "lowerThirdQuickThemeSettings",
    lineCountKey: "verseLineCount",
    lineModeKey: null,
    defaultLineCount: 1,
  } as const;
}

async function getDockTextPresentationStyle(
  surface: TextPresentationSurface,
  requestedMode?: string,
) {
  if (surface === "bible") {
    return { ...(await getDockBiblePresentationStyle(requestedMode)), surface };
  }

  const storage = getTextSurfaceStorage(surface);
  const prefs = readDockPreference<Record<string, unknown>>(storage.prefsKey) ?? {};
  const mode: "fullscreen" | "lower-third" = requestedMode === "lower-third"
    ? "lower-third"
    : requestedMode === "fullscreen"
      ? "fullscreen"
      : prefs.overlayMode === "lower-third"
        ? "lower-third"
        : "fullscreen";
  const favoriteThemes = await loadDockFavoriteBibleThemes().catch(() => []);
  const themes = new Map<string, BibleTheme>();
  for (const theme of [...BUILTIN_THEMES, ...favoriteThemes]) {
    if (theme?.id && !themes.has(theme.id)) themes.set(theme.id, theme);
  }
  const themeIdKey = mode === "fullscreen" ? "fullscreenThemeId" : "lowerThirdThemeId";
  const themeId = typeof prefs[themeIdKey] === "string" ? prefs[themeIdKey] as string : undefined;
  const selectedTheme = (themeId ? themes.get(themeId) : null) ?? BUILTIN_THEMES[0];
  const themed = resolveThemeVariant(selectedTheme, mode);
  const quickKey = mode === "fullscreen" ? storage.fullscreenQuickKey : storage.lowerThirdQuickKey;
  const quickSettings = isRecord(prefs[quickKey]) ? prefs[quickKey] as Record<string, unknown> : {};
  const settings = { ...themed.settings, ...quickSettings, autoFontScale: true } as Record<string, unknown>;
  const lineMode = storage.lineModeKey && prefs[storage.lineModeKey] === false ? "original" : "count";

  return {
    surface,
    overlayMode: mode,
    themeId: themed.id,
    themeName: themed.name,
    backgroundPreset: "theme",
    referenceFormat: "full",
    referenceVersionVisible: true,
    lineCount: Number(prefs[storage.lineCountKey]) || storage.defaultLineCount,
    lineMode,
    themeSettings: settings,
    liveOverrides: null,
    preview: {
      backgroundColor: String(settings.backgroundColor || "#0B1426"),
      fontColor: String(settings.fontColor || "#FFFFFF"),
      referenceColor: String(settings.refFontColor || settings.fontColor || "#FFFFFF"),
    },
  };
}

async function saveTextPresentationControls(
  command: Extract<MobileCommand, { type: "save_text_presentation_controls" }>,
) {
  const storage = getTextSurfaceStorage(command.surface);
  const prefs = readDockPreference<Record<string, unknown>>(storage.prefsKey) ?? {};
  const patch = isRecord(command.patch) ? command.patch : {};
  const allowedPatch: Record<string, unknown> = { autoFontScale: true };
  for (const key of ["autoFontScale", "fontSize", "refFontSize"]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      allowedPatch[key] = key === "autoFontScale" ? true : Number(patch[key]);
    }
  }

  const quickKeys = [storage.fullscreenQuickKey, storage.lowerThirdQuickKey];
  for (const key of quickKeys) {
    const current = isRecord(prefs[key]) ? prefs[key] as Record<string, unknown> : {};
    prefs[key] = { ...current, ...allowedPatch };
  }

  Object.assign(
    prefs,
    applyDockLinePresentationControls({
      lineCountKey: storage.lineCountKey,
      lineModeKey: storage.lineModeKey,
    }, command.line_count, command.line_mode),
  );
  prefs.updatedAt = new Date().toISOString();
  writeDockPreference(storage.prefsKey, prefs);
  void saveDockPreference(storage.prefsKey, prefs);
  if (command.quick_alignment && command.surface === "bible") {
    const uiPrefs = readDockPreference<Record<string, unknown>>(DOCK_BIBLE_UI_PREFS_KEY) ?? {};
    writeDockPreference(DOCK_BIBLE_UI_PREFS_KEY, {
      ...uiPrefs,
      // The desktop Dock stores null for its right-edge default and a pixel
      // offset for the left edge. Mobile only needs to choose the edge.
      quickActionsLeft: command.quick_alignment === "left" ? 0 : null,
    });
    void saveDockPreference(DOCK_BIBLE_UI_PREFS_KEY, {
      ...uiPrefs,
      quickActionsLeft: command.quick_alignment === "left" ? 0 : null,
    });
  }
  return getDockTextPresentationStyle(command.surface);
}

async function savePresentationBackground(
  command: Extract<MobileCommand, { type: "save_presentation_background" }>,
) {
  const storage = getTextSurfaceStorage(command.surface);
  const prefs = readDockPreference<Record<string, unknown>>(storage.prefsKey) ?? {};
  const mode: "fullscreen" | "lower-third" = command.overlay_mode === "lower-third"
    ? "lower-third"
    : command.overlay_mode === "fullscreen"
      ? "fullscreen"
      : prefs.overlayMode === "lower-third"
        ? "lower-third"
        : "fullscreen";
  const quickKey = mode === "fullscreen" ? storage.fullscreenQuickKey : storage.lowerThirdQuickKey;
  const current: Record<string, unknown> = isRecord(prefs[quickKey])
    ? prefs[quickKey] as Record<string, unknown>
    : {};
  const next: Record<string, unknown> = {
    ...current,
    backgroundType: command.background_type,
  };

  switch (command.background_type) {
    case "off":
      Object.assign(next, {
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundColor: "",
        backgroundColorEnd: "",
        fullscreenShadeOpacity: 0,
        backgroundOpacity: 0,
      });
      break;
    case "theme":
      Object.assign(next, {
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundOpacity: Number(next.backgroundOpacity) === 0 ? 1 : next.backgroundOpacity,
        fullscreenShadeOpacity: Number(next.fullscreenShadeOpacity) === 0 ? 0.42 : next.fullscreenShadeOpacity,
      });
      break;
    case "color":
      Object.assign(next, {
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundColor: command.background_color || next.backgroundColor || "#0F172A",
        backgroundColorEnd: command.background_color_end ?? next.backgroundColorEnd ?? "",
        backgroundOpacity: Number(next.backgroundOpacity) === 0 ? 1 : next.backgroundOpacity,
        fullscreenShadeOpacity: Number(next.fullscreenShadeOpacity) === 0 ? 0.42 : next.fullscreenShadeOpacity,
      });
      break;
    case "image":
      Object.assign(next, {
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundImage: command.background_image ?? next.backgroundImage ?? "",
        backgroundImageFilePath: command.background_image_file_path ?? next.backgroundImageFilePath ?? "",
        backgroundOpacity: Number(next.backgroundOpacity) === 0 ? 1 : next.backgroundOpacity,
        fullscreenShadeOpacity: Number(next.fullscreenShadeOpacity) === 0 ? 0.42 : next.fullscreenShadeOpacity,
      });
      break;
    case "video":
      Object.assign(next, {
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: command.background_video ?? next.backgroundVideo ?? "",
        backgroundVideoFilePath: command.background_video_file_path ?? next.backgroundVideoFilePath ?? "",
        backgroundOpacity: Number(next.backgroundOpacity) === 0 ? 1 : next.backgroundOpacity,
        fullscreenShadeOpacity: Number(next.fullscreenShadeOpacity) === 0 ? 0.42 : next.fullscreenShadeOpacity,
      });
      break;
    case "pattern":
      Object.assign(next, {
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundPattern: command.background_pattern ?? next.backgroundPattern ?? "",
        backgroundOpacity: Number(next.backgroundOpacity) === 0 ? 1 : next.backgroundOpacity,
        fullscreenShadeOpacity: Number(next.fullscreenShadeOpacity) === 0 ? 0.42 : next.fullscreenShadeOpacity,
      });
      break;
  }

  prefs[quickKey] = next;
  prefs.overlayMode = mode;
  prefs.updatedAt = new Date().toISOString();
  if (command.surface === "bible") {
    prefs.backgroundPreset = command.background_type === "off" ? "none" : "theme";
  }
  writeDockPreference(storage.prefsKey, prefs);
  void saveDockPreference(storage.prefsKey, prefs);
  return command.surface === "bible"
    ? getDockBiblePresentationStyle(mode)
    : getDockTextPresentationStyle(command.surface, mode);
}

async function complete(commandId: string, ok: boolean, payload?: unknown, error?: string) {
  await safeTauriInvoke("complete_mobile_command", {
    commandId,
    ok,
    payload: payload ?? null,
    error: error ?? null,
  }).catch((err) => {
    console.warn("[MobileRemote] Failed to complete command:", err);
  });
}

function isAudioInputCaptureKind(inputKind: string): boolean {
  const kind = inputKind.toLowerCase();
  if (kind.includes("output_capture") || kind.includes("ffmpeg") || kind.includes("browser")) {
    return false;
  }
  return (
    kind.includes("input_capture") ||
    kind.includes("audio_input") ||
    kind.includes("audioinput") ||
    kind === "coreaudio_input_capture" ||
    kind === "wasapi_input_capture" ||
    kind === "pulse_input_capture" ||
    kind === "alsa_input_capture"
  );
}

async function getPrimaryMicState(): Promise<{
  inputName: string | null;
  muted: boolean;
}> {
  if (obsService.status !== "connected") {
    return { inputName: null, muted: false };
  }

  const inputs = await obsService.getInputList().catch(() => []);
  const audioInputs = inputs
    .filter((input) => isAudioInputCaptureKind(input.inputKind))
    .filter((input) => !input.inputName.includes("Media Image Audio"));
  const input = audioInputs.find((candidate) => {
    const normalized = candidate.inputName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return ["mic", "microphone", "xlr", "voice"].some((keyword) => normalized.includes(keyword));
  }) ?? audioInputs[0];

  if (!input) return { inputName: null, muted: false };

  const muteState = await obsService.call("GetInputMute", {
    inputName: input.inputName,
  }).catch(() => null) as { inputMuted?: boolean } | null;
  return {
    inputName: input.inputName,
    muted: muteState?.inputMuted === true,
  };
}

async function getCurrentStatePayload() {
  const connected = obsService.status === "connected";
  const [scenes, currentProgramScene, currentPreviewScene, studioModeEnabled, streamStatus, recordingStatus] =
    connected
      ? await Promise.all([
          obsService.getSceneList().catch(() => []),
          obsService.getCurrentProgramScene().catch(() => ""),
          obsService.getCurrentPreviewScene().catch(() => ""),
          obsService.getStudioModeEnabled().catch(() => false),
          obsService.call("GetStreamStatus").catch(() => null),
          obsService.call("GetRecordStatus").catch(() => null),
        ])
      : [[], "", "", false, null, null];
  const [stats, micState] = connected
    ? await Promise.all([
        obsService.getStats().catch(() => null),
        getPrimaryMicState(),
      ])
    : [null, { inputName: null, muted: false }];

  return {
    obsConnected: connected,
    currentProgramScene,
    currentPreviewScene,
    studioModeEnabled,
    streamActive: Boolean(streamStatus?.outputActive),
    recordingActive: Boolean(recordingStatus?.outputActive),
    activeFps: typeof stats?.activeFps === "number" ? stats.activeFps : 0,
    micInputName: micState.inputName,
    micMuted: micState.muted,
    scenes: scenes.map((scene) => ({
      name: scene.sceneName,
      id: scene.sceneUuid || scene.sceneName,
    })),
  };
}

async function getBibleTranslationsPayload() {
  const installed = await getInstalledTranslations().catch(() => []);
  const mapped = installed
    .map((item) => ({
      value: String(item.abbr || "").trim().toUpperCase(),
      label: String(item.name || item.abbr || "").trim() || String(item.abbr || "").trim().toUpperCase(),
      language: item.language,
    }))
    .filter((item) => item.value);

  if (!mapped.some((item) => item.value === "KJV")) {
    mapped.unshift({ value: "KJV", label: "King James Version", language: "English" });
  }

  return mapped;
}

async function getBibleChapterPayload(command: Extract<MobileCommand, { type: "get_bible_chapter" }>) {
  const translation = (command.translation || "KJV").trim().toUpperCase() as BibleTranslation;
  const passage = await getChapter(command.book, command.chapter, translation);
  return {
    reference: passage.reference,
    book: passage.book,
    chapter: passage.chapter,
    translation: passage.translation,
    verses: passage.verses.map((verse) => ({
      verse: verse.verse,
      text: verse.text,
      reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
    })),
  };
}

async function resolveMobileVerseSelection(
  book: string,
  chapter: number,
  verse: number,
  translation: string,
  lineCount: number,
  explicitVerseEnd?: number,
  fallbackText?: string,
) {
  const safeLineCount = Math.max(1, Math.min(12, Math.trunc(lineCount || 1)));
  try {
    const passage = await getChapter(book, chapter, translation.toUpperCase() as BibleTranslation);
    const startIndex = passage.verses.findIndex((entry) => entry.verse === verse);
    if (startIndex >= 0) {
      const explicitEndIndex = typeof explicitVerseEnd === "number"
        ? passage.verses.findIndex((entry) => entry.verse === explicitVerseEnd)
        : -1;
      const selected = explicitEndIndex >= startIndex
        ? passage.verses.slice(startIndex, explicitEndIndex + 1)
        : passage.verses.slice(startIndex, startIndex + safeLineCount);
      const verseEnd = selected[selected.length - 1]?.verse ?? verse;
      const text = selected.length <= 1
        ? (selected[0]?.text ?? fallbackText ?? `${book} ${chapter}:${verse}`)
        : selected.map((entry) => `${entry.verse}. ${entry.text}`).join("\n");
      return {
        text,
        verseRange: verseEnd === verse ? String(verse) : `${verse}-${verseEnd}`,
        verseEnd,
      };
    }
  } catch {
    // Keep the phone-provided text as a safe fallback if a local translation
    // is unavailable on the desktop.
  }
  return {
    text: fallbackText || `${book} ${chapter}:${verse}`,
    verseRange: explicitVerseEnd && explicitVerseEnd > verse ? `${verse}-${explicitVerseEnd}` : String(verse),
    verseEnd: explicitVerseEnd && explicitVerseEnd >= verse ? explicitVerseEnd : verse,
  };
}

function serializeSong(song: Song) {
  return {
    id: song.id,
    title: song.metadata.title,
    artist: song.metadata.artist || "",
    lyrics: song.lyrics,
    autoSplit: song.autoSplit,
    linesPerSlide: song.linesPerSlide,
    slides: song.slides.map((slide, index) => ({
      index,
      label: slide.label || `Slide ${index + 1}`,
      text: slide.content,
      type: slide.type,
    })),
  };
}

async function getWorshipLibraryPayload() {
  const songs = await getAllSongs();
  return songs.map(serializeSong);
}

async function getMediaLibraryPayload() {
  const media = await getAllMedia();
  return media.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    diskFileName: item.diskFileName,
    durationSec: item.durationSec,
    width: item.width,
    height: item.height,
    // Images can use their lightweight shared upload URL. Videos need only
    // their small poster frame on the phone; sending the full video to a
    // mobile gallery just to paint a card caused needless playback and memory
    // pressure.
    thumbnailUrl: item.type === "video" || !item.thumbnailUrl?.startsWith("data:")
      ? item.thumbnailUrl
      : undefined,
  }));
}

// Video cards on the phone only need one small poster frame. Keep this work in
// the desktop renderer so the phone never has to download, decode, or play the
// full video just to paint the shared media grid.
const mobileMediaThumbnailCache = new Map<string, string>();
const mobileMediaThumbnailInFlight = new Map<string, Promise<string>>();

async function generateMobileMediaThumbnail(item: MediaItem): Promise<string> {
  const cached = mobileMediaThumbnailCache.get(item.id);
  if (cached) return cached;

  const inFlight = mobileMediaThumbnailInFlight.get(item.id);
  if (inFlight) return inFlight;

  const promise = new Promise<string>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let timeoutId: number | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      mobileMediaThumbnailInFlight.delete(item.id);
      if (value) mobileMediaThumbnailCache.set(item.id, value);
      resolve(value);
    };

    const draw = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d");
        if (!context) {
          finish("");
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.68));
      } catch {
        // A codec or CORS failure should leave a lightweight placeholder on
        // the phone rather than blocking the rest of the media inventory.
        finish("");
      }
    };

    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = duration > 0 ? Math.min(1, duration / 4) : 0;
      if (target > 0.05) {
        video.currentTime = target;
      } else {
        draw();
      }
    };
    video.onseeked = draw;
    video.onerror = () => finish("");
    video.src = item.url;
    video.load();
    timeoutId = window.setTimeout(() => finish(""), 10000);
  });

  mobileMediaThumbnailInFlight.set(item.id, promise);
  return promise;
}

async function getMediaThumbnailPayload(
  command: Extract<MobileCommand, { type: "get_media_thumbnail" }>,
) {
  const item = (await getAllMedia()).find((candidate) => candidate.id === command.media_id);
  if (!item || item.type !== "video") return { thumbnailUrl: "" };
  return { thumbnailUrl: await generateMobileMediaThumbnail(item) };
}

const TICKER_MESSAGES_KEY = "dock-ticker-messages";
const TICKER_SETTINGS_KEY = "dock-ticker-settings";
const TICKER_MESSAGE_SPACING_MAX = 100;

type MobileTickerSettings = {
  speed: number;
  position: "top" | "bottom";
  loop: boolean;
  themeId: string;
  heading: string;
  messageSpacing: number;
  divider: DockTickerDivider;
  colors: Partial<TickerThemeColors>;
};

function sanitizeTickerColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed || /[;{}<>]/.test(trimmed)) return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function loadMobileTickerSettings(): MobileTickerSettings {
  const defaultTheme = DEFAULT_DOCK_TICKER_THEME_OPTION;
  try {
    const raw = readNativeDockSetting<unknown>(TICKER_SETTINGS_KEY);
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<MobileTickerSettings> | null;
    const colors: Partial<TickerThemeColors> = {};
    if (isRecord(parsed?.colors)) {
      for (const key of ["accent", "accentText", "barBg", "barText", "separator"] as const) {
        const color = sanitizeTickerColor(parsed.colors[key]);
        if (color) colors[key] = color;
      }
    }
    const divider = parsed?.divider === "none" || parsed?.divider === "dot" || parsed?.divider === "line" || parsed?.divider === "diamond" || parsed?.divider === "spark"
      ? parsed.divider
      : "theme";
    return {
      speed: typeof parsed?.speed === "number" ? parsed.speed : 50,
      position: parsed?.position === "top" ? "top" : "bottom",
      loop: typeof parsed?.loop === "boolean" ? parsed.loop : true,
      themeId: typeof parsed?.themeId === "string" ? parsed.themeId : defaultTheme?.id ?? "",
      heading: typeof parsed?.heading === "string" && parsed.heading.trim()
        ? parsed.heading.trim().slice(0, 20)
        : defaultTheme?.defaultHeading ?? "LIVE",
      messageSpacing: typeof parsed?.messageSpacing === "number"
        ? Math.max(0, Math.min(TICKER_MESSAGE_SPACING_MAX, Math.round(parsed.messageSpacing)))
        : 0,
      divider,
      colors,
    };
  } catch {
    return {
      speed: 50,
      position: "bottom",
      loop: true,
      themeId: defaultTheme?.id ?? "",
      heading: defaultTheme?.defaultHeading ?? "LIVE",
      messageSpacing: 0,
      divider: "theme",
      colors: {},
    };
  }
}

async function resolveMobileTickerPresentation() {
  const settings = loadMobileTickerSettings();
  const favorites = await loadDockTickerFavorites().catch(() => new Set<string>());
  const available = getDockTickerThemeOptionsForFavorites(
    favorites,
    getCachedRemoteProductionThemes(),
  );
  const option = available.find((item) => item.id === settings.themeId)
    ?? available[0]
    ?? DEFAULT_DOCK_TICKER_THEME_OPTION;
  const brandingSettings = getSettings();
  const brandColor = normalizeBrandColor(brandingSettings.brandColor);
  const baseColors: TickerThemeColors = option.source === "dock" || option.source === "remote"
    ? {
      ...option.theme.defaultColors,
      accent: brandColor,
      separator: brandColor,
    }
    // HTML/package tickers keep their own CSS colours; only the user's picked colours override them.
    : ({} as TickerThemeColors);
  const colors: TickerThemeColors = { ...baseColors, ...settings.colors };

  let brandLogoUrl = resolveOverlayAssetUrl(brandingSettings.brandLogoPath);
  let brandName = brandingSettings.churchName || "MakeChurchEazy";
  let brandColorOverride = brandingSettings.brandColor || "";
  try {
    const response = await fetch(`/uploads/dock-branding.json?_=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const raw = await response.json() as Record<string, unknown>;
      const logoFileName = typeof raw.brandLogoFileName === "string" ? raw.brandLogoFileName.trim() : "";
      const logoPath = typeof raw.brandLogoPath === "string" ? raw.brandLogoPath.trim() : "";
      if (logoFileName) brandLogoUrl = resolveOverlayAssetUrl(`/uploads/${encodeURIComponent(logoFileName)}`);
      else if (logoPath) brandLogoUrl = resolveOverlayAssetUrl(logoPath);
      if (typeof raw.churchName === "string" && raw.churchName.trim()) brandName = raw.churchName.trim();
      if (typeof raw.brandColor === "string" && raw.brandColor.trim()) brandColorOverride = raw.brandColor.trim();
    }
  } catch {
    // Native branding remains a valid fallback while the branding file loads.
  }

  if (brandColorOverride) {
    const normalized = normalizeBrandColor(brandColorOverride);
    colors.accent = normalized;
    colors.separator = normalized;
  }

  return {
    settings,
    option,
    colors,
    brandLogoUrl,
    brandName: brandName || "MakeChurchEazy",
    fontFamily: loadDockOutputFontFamily(),
  };
}

async function getTickerPresentationStylePayload() {
  const presentation = await resolveMobileTickerPresentation();
  const favorites = await loadDockTickerFavorites().catch(() => new Set<string>());
  const available = getDockTickerThemeOptionsForFavorites(
    favorites,
    getCachedRemoteProductionThemes(),
  );
  return {
    ...presentation.settings,
    theme: {
      id: presentation.option.id,
      name: presentation.option.name,
      description: presentation.option.description,
      defaultHeading: presentation.option.defaultHeading,
      source: presentation.option.source,
    },
    themes: available.map((option) => ({
      id: option.id,
      name: option.name,
      description: option.description,
      defaultHeading: option.defaultHeading,
      source: option.source,
    })),
    colors: presentation.colors,
    dividerChar: resolveDockTickerDividerChar(
      presentation.settings.divider,
      presentation.option.source === "dock" || presentation.option.source === "remote"
        ? presentation.option.theme.separatorChar
        : "•",
    ),
    brandName: presentation.brandName,
    fontFamily: presentation.fontFamily,
  };
}

function saveTickerSettingsPayload(
  command: Extract<MobileCommand, { type: "save_ticker_settings" }>,
) {
  const current = loadMobileTickerSettings();
  const next: MobileTickerSettings = {
    ...current,
    speed: typeof command.speed === "number"
      ? Math.max(1, Math.min(100, Math.round(command.speed)))
      : current.speed,
    position: command.position === "top" || command.position === "bottom"
      ? command.position
      : current.position,
    loop: typeof command.looping === "boolean" ? command.looping : current.loop,
    themeId: typeof command.theme_id === "string" && command.theme_id.trim()
      ? command.theme_id.trim().slice(0, 120)
      : current.themeId,
    heading: typeof command.heading === "string" && command.heading.trim()
      ? command.heading.trim().slice(0, 20)
      : current.heading,
    messageSpacing: typeof command.message_spacing === "number"
      ? Math.max(0, Math.min(TICKER_MESSAGE_SPACING_MAX, Math.round(command.message_spacing)))
      : current.messageSpacing,
    divider: command.divider === "theme"
      || command.divider === "none"
      || command.divider === "dot"
      || command.divider === "line"
      || command.divider === "diamond"
      || command.divider === "spark"
      ? command.divider
      : current.divider,
    colors: current.colors,
  };

  if (command.colors) {
    const colors: Partial<TickerThemeColors> = {};
    for (const key of ["accent", "accentText", "barBg", "barText", "separator"] as const) {
      const color = sanitizeTickerColor(command.colors[key]);
      if (color) colors[key] = color;
    }
    next.colors = colors;
  }

  writeNativeDockSetting(TICKER_SETTINGS_KEY, next);
  return getTickerPresentationStylePayload();
}

async function showMobileTicker(command: Extract<MobileCommand, { type: "show_ticker" }>) {
  const messages = (Array.isArray(command.messages) ? command.messages : [command.ticker_text])
    .map((message) => String(message || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  if (messages.length === 0) throw new Error("Add at least one ticker message.");

  const presentation = await resolveMobileTickerPresentation();
  const html = renderDockTickerThemeHtml({
    option: presentation.option,
    heading: presentation.settings.heading,
    messages,
    speed: presentation.settings.speed,
    position: presentation.settings.position,
    loop: presentation.settings.loop,
    paused: command.paused === true,
    colors: presentation.colors,
    fontFamily: presentation.fontFamily,
    brandLogoUrl: presentation.brandLogoUrl,
    brandName: presentation.brandName,
    divider: presentation.settings.divider,
    messageSpacing: presentation.settings.messageSpacing,
  });

  await dockObsClient.pushDockTickerHtml({
    html,
    position: presentation.settings.position,
  });
}

function getTickerMessagesPayload() {
  const raw = readUserScopedStorage(TICKER_MESSAGES_KEY)
    ?? localStorage.getItem(getUserScopedKey(TICKER_MESSAGES_KEY));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id || `ticker-${index}`),
        text: String(item.text || "").trim(),
        active: item.active !== false,
      }))
      .filter((item) => item.text);
  } catch {
    return [];
  }
}

function saveTickerMessagesPayload(messages: Array<{ id: string; text: string; active: boolean }>) {
  const normalized = messages
    .map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      text: String(item.text || "").trim().slice(0, 140),
      active: item.active !== false,
    }))
    .filter((item) => item.text);
  localStorage.setItem(getUserScopedKey(TICKER_MESSAGES_KEY), JSON.stringify(normalized));
  return normalized;
}

function serializeLowerThirdTheme(theme: (typeof LT_THEMES)[number]) {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    category: theme.category,
    icon: theme.icon,
    accentColor: theme.accentColor,
    variables: theme.variables.map((variable) => ({
      key: variable.key,
      label: variable.label,
      type: variable.type,
      defaultValue: variable.defaultValue,
      placeholder: variable.placeholder,
      required: variable.required,
      maxLength: variable.maxLength,
      options: variable.options,
    })),
  };
}

async function getLowerThirdThemesPayload() {
  const favoriteIds = await loadDockLTFavorites().catch(() => new Set<string>());
  const themes = LT_THEMES.filter((theme) => favoriteIds.has(theme.id));
  const fallback = LT_THEMES.find((theme) => theme.category === "general") ?? LT_THEMES[0];
  return (themes.length > 0 ? themes : fallback ? [fallback] : []).map(serializeLowerThirdTheme);
}

function getSceneRoutePayload(module: DockSceneRouteModule) {
  return loadDockSceneRoute(module);
}

function saveSceneRoutePayload(
  module: DockSceneRouteModule,
  route: Record<string, unknown>,
) {
  const normalized = normalizeDockSceneRoute(route);
  saveDockSceneRoute(module, normalized);
  return normalized;
}

async function getCountdownsPayload() {
  const stored = await getCountdowns().catch(() => []);
  const source = stored.length > 0 ? stored : HARDCODED_COUNTDOWNS;
  return source;
}

function getMultiviewCardsPayload() {
  return readDockPreferenceList<Record<string, unknown>>("dock-mv-saved") ?? [];
}

function getNotesPayload() {
  return loadDockNotes();
}

function saveNotesPayload(notes: DockNote[]) {
  const normalized = notes
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      id: String(note.id || crypto.randomUUID()),
      title: String(note.title || "").trim(),
      content: String(note.content || "").trim(),
      updatedAt: Number(note.updatedAt) || Date.now(),
      splitOnLineBreaks: false,
    }))
    .filter((note) => note.title && note.content);
  saveDockNotes(normalized);
  return normalized;
}

async function showNote(note: DockNote) {
  const title = note.title.trim();
  const content = note.content.trim();
  if (!title || !content) throw new Error("The note needs a title and content.");
  const dockStyle = await getDockTextPresentationStyle("notes");
  await dockObsClient.pushNotesLyrics({
    sectionText: content,
    sectionLabel: title,
    songTitle: title,
    overlayMode: dockStyle.overlayMode,
    bibleThemeSettings: dockStyle.themeSettings,
    liveOverrides: dockStyle.liveOverrides,
    backgroundOnly: false,
  });
}

async function clearMultiview(
  command: Extract<MobileCommand, { type: "clear_multiview" }>,
) {
  if (obsService.status !== "connected") throw new Error("OBS is not connected.");
  const sceneName = command.scene_name.trim();
  if (!sceneName) throw new Error("The Multi-View scene is missing.");

  await dockObsClient.fadeOutAllSceneItems(sceneName).catch(() => {});
  const program = await obsService.getCurrentProgramScene().catch(() => "");
  if (program && program !== sceneName) {
    await obsService.setCurrentPreviewScene(program).catch(() => {});
  }

  const prefix = command.multiview_id ? `${command.multiview_id}::` : null;
  const items = await obsService.getSceneItemList(sceneName).catch(() => []);
  for (const item of items) {
    if (prefix && !item.sourceName.startsWith(prefix)) continue;
    if (!prefix && !item.sourceName.includes("BACKGROUND")) continue;
    await obsService.call("RemoveSceneItem", {
      sceneName,
      sceneItemId: item.sceneItemId,
    }).catch(() => {});
  }
  return getCurrentStatePayload();
}

async function registerUploadedMedia(
  command: Extract<MobileCommand, { type: "register_uploaded_media" }>,
) {
  const port = await safeTauriInvoke<number>("get_overlay_port");
  const uploadsResponse = await fetch(`http://127.0.0.1:${port}/api/uploads-dir`);
  if (!uploadsResponse.ok) throw new Error("Could not resolve the desktop uploads folder.");
  const uploadsPayload = (await uploadsResponse.json()) as { path?: string };
  const uploadsDirectory = uploadsPayload.path?.trim();
  if (!uploadsDirectory) throw new Error("The desktop uploads folder is unavailable.");

  const separator = uploadsDirectory.includes("\\") ? "\\" : "/";
  const filePath = `${uploadsDirectory}${separator}${command.disk_file_name}`;
  const fileUrl = `http://127.0.0.1:${port}/uploads/${encodeURIComponent(command.disk_file_name)}`;
  const isDocument = /\.(pdf|docx|pptx)$/i.test(command.name);

  if (isDocument) {
    // Reuse the existing desktop document importer so PDFs, Word files, and
    // PowerPoint files become the same page cards as a desktop upload.
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("The uploaded document is not available on the desktop.");
    const blob = await response.blob();
    const file = new File([blob], command.name, {
      type: command.mime_type || blob.type || "application/octet-stream",
    });
    const { saveLibraryMediaFile } = await import("../library/MediaTab");
    await saveLibraryMediaFile(file, command.name);
    return {
      mediaId: command.media_id,
      name: command.name,
      registered: true,
      convertedToPages: true,
    };
  }

  const mediaType = command.media_type === "video" ? "video" : "image";
  const item: MediaItem = {
    id: command.media_id,
    name: command.name,
    type: mediaType,
    url: fileUrl,
    filePath,
    diskFileName: command.disk_file_name,
    fileSize: command.file_size,
    mimeType: command.mime_type,
    createdAt: new Date().toISOString(),
    source: "local",
  };
  await saveMedia(item);
  return {
    mediaId: item.id,
    name: item.name,
    registered: true,
    convertedToPages: false,
  };
}

async function resolveMediaFilePath(item: MediaItem): Promise<string> {
  if (item.filePath?.trim()) return item.filePath.trim();

  // Older library records may only contain the managed upload filename. Resolve
  // that filename against the same uploads directory used by the desktop Dock.
  const fileName = item.diskFileName || item.url.split("/").pop() || item.name;
  if (!fileName || item.url.startsWith("data:")) {
    throw new Error("This media item has no local file available on the desktop.");
  }

  const port = await safeTauriInvoke<number>("get_overlay_port");
  const response = await fetch(`http://127.0.0.1:${port}/api/uploads-dir`);
  if (!response.ok) throw new Error("Could not resolve the desktop uploads directory.");
  const payload = (await response.json()) as { path?: string };
  const directory = payload.path?.trim();
  if (!directory) throw new Error("The desktop uploads directory is unavailable.");
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory}${separator}${decodeURIComponent(fileName)}`;
}

async function handleMediaCommand(command: Extract<MobileCommand, { type: "show_media" }>) {
  const item = (await getAllMedia()).find((candidate) => candidate.id === command.media_id);
  if (!item) throw new Error("The selected media item is no longer in the desktop library.");

  const filePath = await resolveMediaFilePath(item);
  await dockObsClient.focusMcePresentationModule("media").catch(() => {});
  await dockObsClient.pushMedia(filePath, item.name, {
    muted: command.muted ?? true,
    looping: command.looping ?? true,
    fitMode: command.fit_mode ?? "cover",
    transition: command.transition ?? "cut",
  });
}

async function handleMediaToSceneCommand(
  command: Extract<MobileCommand, { type: "send_media_to_scene" }>,
) {
  const sceneName = command.scene_name.trim();
  if (!sceneName) throw new Error("Choose an OBS scene first.");

  const item = (await getAllMedia()).find((candidate) => candidate.id === command.media_id);
  if (!item) throw new Error("The selected media item is no longer in the desktop library.");

  const scenes = await obsService.getSceneList();
  if (!scenes.some((scene) => scene.sceneName === sceneName)) {
    throw new Error("The selected OBS scene is no longer available.");
  }

  const filePath = await resolveMediaFilePath(item);
  const safeName = item.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, " ").trim().slice(0, 48);
  const suffix = item.id.replace(/[^a-z0-9]+/gi, "").slice(-10) || "media";
  const sourceName = `MCE Mobile ${item.type === "video" ? "Video" : "Image"} - ${safeName || "Media"} - ${suffix}`;

  if (item.type === "video") {
    await dockObsClient.addVideoSourceToScene({
      sceneName,
      sourceName,
      filePath,
      fitMode: command.fit_mode ?? "cover",
      muted: command.muted ?? true,
      looping: command.looping ?? true,
    });
  } else {
    await dockObsClient.addImageSourceToScene({
      sceneName,
      sourceName,
      filePath,
      fitMode: command.fit_mode ?? "cover",
    });
  }
}

async function handleWorshipNavigation(
  command: Extract<MobileCommand, { type: "next_slide" | "prev_slide" }>,
) {
  if (!command.song_id || command.slide_index === undefined) {
    throw new Error("Select a song before using slide navigation.");
  }

  const song = await getSong(command.song_id);
  if (!song || song.slides.length === 0) throw new Error("The selected song is no longer available.");

  const delta = command.type === "next_slide" ? 1 : -1;
  const slideIndex = Math.max(0, Math.min(song.slides.length - 1, command.slide_index + delta));
  const slide = song.slides[slideIndex];
  await handleWorshipSlideCommand({
    type: "show_slide",
    song_id: song.id,
    slide_index: slideIndex,
    song_title: song.metadata.title,
    artist: song.metadata.artist,
    slide_text: slide.content,
    section_label: slide.label || `Slide ${slideIndex + 1}`,
  });
  return { songId: song.id, slideIndex };
}

async function handleBibleCommand(command: Extract<MobileCommand, { type: "show_scripture" }>) {
  const parsed = parseReference(command.reference);
  const dockStyle = await getDockBiblePresentationStyle(command.overlay_mode);
  const overlayMode: "fullscreen" | "lower-third" = dockStyle.overlayMode;
  const lineCount = dockStyle.verseLineCount;
  const referenceText = command.display_reference_label || `${command.reference}${command.translation ? ` (${command.translation})` : ""}`;

  if (command.compare_enabled && parsed) {
    const translationA = (command.translation_a || command.translation || "KJV").toUpperCase();
    const translationB = (command.translation_b || "KJV").toUpperCase();
    const selectionA = await resolveMobileVerseSelection(
      parsed.book,
      parsed.chapter,
      parsed.verse,
      translationA,
      lineCount,
      parsed.endVerse,
      command.compare_verse_text_a || command.verse_text,
    );
    const selectionB = await resolveMobileVerseSelection(
      parsed.book,
      parsed.chapter,
      parsed.verse,
      translationB,
      lineCount,
      parsed.endVerse,
      command.compare_verse_text_b || selectionA.text,
    );
    const compareMode = command.compare_mode === "passages" ? "passages" : "translations";
    const comparePassages = compareMode === "passages" && Array.isArray(command.compare_passages)
      ? await Promise.all(command.compare_passages.slice(0, 3).map(async (draft) => {
        const draftParsed = (draft.book && draft.chapter && draft.verse)
          ? {
              book: draft.book,
              chapter: Number(draft.chapter),
              verse: Number(draft.verse),
              endVerse: draft.verse_end,
            }
          : parseReference(draft.reference || "");
        if (!draftParsed) return null;
        const translation = (draft.translation || translationA).toUpperCase();
        const selection = await resolveMobileVerseSelection(
          draftParsed.book,
          draftParsed.chapter,
          draftParsed.verse,
          translation,
          lineCount,
          draft.verse_end ?? draftParsed.endVerse,
          draft.verse_text,
        );
        return {
          book: draftParsed.book,
          chapter: draftParsed.chapter,
          verse: draftParsed.verse,
          verseEnd: selection.verseEnd,
          verseRange: selection.verseRange,
          referenceLabel: draft.reference_label || `${draftParsed.book} ${draftParsed.chapter}:${selection.verseRange}`,
          translation,
          verseText: selection.text,
        };
      })).then((columns) => columns.filter((column): column is NonNullable<typeof column> => Boolean(column)))
      : [];
    const columns = compareMode === "passages" && comparePassages.length >= 2
      ? comparePassages
      : [
          {
            book: parsed.book,
            chapter: parsed.chapter,
            verse: parsed.verse,
            verseEnd: selectionA.verseEnd,
            verseRange: selectionA.verseRange,
            referenceLabel: command.reference,
            translation: translationA,
            verseText: selectionA.text,
          },
          {
            book: parsed.book,
            chapter: parsed.chapter,
            verse: parsed.verse,
            verseEnd: selectionB.verseEnd,
            verseRange: selectionB.verseRange,
            referenceLabel: command.reference,
            translation: translationB,
            verseText: selectionB.text,
          },
        ];
    const first = columns[0];
    const resolvedReferenceText = command.display_reference_label
      || (compareMode === "passages"
        ? columns.map((column) => column.referenceLabel).join(" • ")
        : `${command.reference}${command.translation ? ` (${command.translation})` : ""}`);
    const compare = {
      enabled: true,
      mode: compareMode,
      layout: command.compare_layout === "side-by-side" ? "side-by-side" : "line-by-line",
      columns,
    };

    const payload = {
      book: first.book,
      chapter: first.chapter,
      verse: first.verse,
      verseEnd: first.verseEnd,
      verseRange: first.verseRange,
      referenceLabel: first.referenceLabel,
      displayReferenceLabel: resolvedReferenceText,
      translation: first.translation,
      verseText: first.verseText,
      overlayMode,
      compareEnabled: true,
      compareMode,
      compareLayout: compare.layout,
      compare,
      translationA: columns[0]?.translation || translationA,
      translationB: columns[1]?.translation || translationB,
      theme: dockStyle.themeId,
      bibleThemeSettings: dockStyle.themeSettings,
      liveOverrides: dockStyle.liveOverrides,
    } as Parameters<typeof dockObsClient.pushBible>[0];

    await dockObsClient.bringBibleOverlayForward(overlayMode).catch(() => {});
    if (overlayMode === "lower-third") {
      await dockObsClient.pushBibleOverlayFast({
        verseText: first.verseText,
        referenceText: resolvedReferenceText,
        verseRange: first.verseRange,
        compareEnabled: true,
        compareMode,
        compareLayout: compare.layout,
        compare,
        translationA: columns[0]?.translation || translationA,
        translationB: columns[1]?.translation || translationB,
        themeId: dockStyle.themeId,
        bibleThemeSettings: dockStyle.themeSettings,
        liveOverrides: dockStyle.liveOverrides,
      });
    } else {
      await dockObsClient.pushBible(payload);
    }
    return;
  }

  const payload = {
    book: parsed?.book || command.reference,
    chapter: parsed?.chapter || 1,
    verse: parsed?.verse || 1,
    verseEnd: parsed?.endVerse ?? parsed?.verse,
    verseRange: parsed ? (parsed.endVerse && parsed.endVerse > parsed.verse ? `${parsed.verse}-${parsed.endVerse}` : String(parsed.verse)) : "",
    rawReferenceLabel: command.reference,
    referenceLabel: referenceText.replace(/\s\(.*\)$/, ""),
    displayReferenceLabel: referenceText,
    translation: command.translation || "KJV",
    theme: dockStyle.themeId,
    verseText: parsed
      ? (await resolveMobileVerseSelection(
          parsed.book,
          parsed.chapter,
          parsed.verse,
          command.translation || "KJV",
          lineCount,
          parsed.endVerse,
          command.verse_text,
        )).text
      : (command.verse_text || command.reference),
    overlayMode,
    bibleThemeSettings: dockStyle.themeSettings,
    liveOverrides: dockStyle.liveOverrides,
    compareEnabled: false,
  } as Parameters<typeof dockObsClient.pushBible>[0];

  await dockObsClient.bringBibleOverlayForward(overlayMode).catch(() => {});
  if (overlayMode === "lower-third") {
    await dockObsClient.pushBibleOverlayFast({
      verseText: payload.verseText,
      referenceText: payload.displayReferenceLabel,
      verseRange: payload.verseRange,
      themeId: payload.theme,
      bibleThemeSettings: payload.bibleThemeSettings,
      liveOverrides: payload.liveOverrides,
    });
  } else {
    await dockObsClient.pushBible(payload);
  }
}

async function handleLowerThirdCommand(command: Extract<MobileCommand, { type: "show_lower_third" }>) {
  const favoriteIds = await loadDockLTFavorites().catch(() => new Set<string>());
  const favoriteThemes = LT_THEMES.filter((item) => favoriteIds.has(item.id));
  const theme = favoriteThemes.find((item) => item.id === command.theme_id)
    ?? favoriteThemes.find((item) => item.category === "general")
    ?? favoriteThemes[0]
    ?? LT_THEMES.find((item) => item.category === "general")
    ?? LT_THEMES[0];
  if (!theme) throw new Error("No lower-third theme is available.");

  const values: Record<string, string> = {};
  for (const variable of theme.variables) {
    const key = variable.key.toLowerCase();
    const submitted = command.values?.[variable.key];
    const fallback = key.includes("name") || key.includes("title")
      ? command.name
      : key.includes("role") || key.includes("subtitle") || key.includes("description")
        ? command.title
        : variable.defaultValue;
    values[variable.key] = String(submitted ?? fallback).slice(0, variable.maxLength ?? 500);
  }

  const size = command.size === "xs" || command.size === "sm" || command.size === "md" || command.size === "lg"
    ? command.size
    : "sm";
  const route = loadDockSceneRoute("lower-third");
  const configuredTargets = route.enabled ? getDockSceneRouteTargets(route) : [];
  const scenes = await lowerThirdObsService.discoverScenes();
  const validTargets = configuredTargets.filter((target) => (
    scenes.some((scene) => scene.sceneName === target.sceneName)
  ));

  if (validTargets.length > 0) {
    await Promise.all(validTargets.map((target) => (
      lowerThirdObsService.pushToScene(target.sceneName, theme, values, true, false, size)
    )));
    if (route.syncPresentation && !validTargets.some((target) => target.sceneName === "MCE Presentation")) {
      await lowerThirdObsService.pushToScene("MCE Presentation", theme, values, true, false, size);
    }
    return;
  }

  // Match the Dock's default output: when no alternate route is enabled,
  // render into the presentation scene instead of leaving the phone with an
  // empty "no scene selected" state.
  if (scenes.some((scene) => scene.sceneName === "MCE Presentation")) {
    await lowerThirdObsService.pushToScene("MCE Presentation", theme, values, true, false, size);
  } else {
    await lowerThirdObsService.pushToAll(theme, values, true, false, size);
  }
}

async function handleWorshipSlideCommand(command: Extract<MobileCommand, { type: "show_slide" }>) {
  const sectionText = command.slide_text?.trim();
  if (!sectionText) {
    throw new Error("The mobile worship command did not include slide text.");
  }

  const dockStyle = await getDockTextPresentationStyle("worship", command.overlay_mode);
  const overlayMode: "fullscreen" | "lower-third" = dockStyle.overlayMode;
  const obsData = {
    sectionText,
    sectionLabel: command.section_label || `Slide ${command.slide_index + 1}`,
    songTitle: command.song_title || command.song_id,
    artist: command.artist || "",
    overlayMode,
    bibleThemeSettings: dockStyle.themeSettings,
    liveOverrides: dockStyle.liveOverrides,
    backgroundOnly: false,
  };

  await dockObsClient.bringWorshipOverlayForward(overlayMode).catch(() => {});
  if (overlayMode === "fullscreen") {
    await dockObsClient.pushWorshipLyrics(obsData);
  } else {
    await dockObsClient.pushWorshipOverlayFast(obsData);
  }
}

async function runMobileCommand(command: MobileCommand): Promise<unknown> {
  switch (command.type) {
    case "get_bible_translations":
      return getBibleTranslationsPayload();
    case "get_bible_chapter":
      return getBibleChapterPayload(command);
    case "get_bible_presentation_style":
      return getDockBiblePresentationStyle();
    case "get_text_presentation_style":
      return getDockTextPresentationStyle(command.surface);
    case "save_presentation_background":
      return savePresentationBackground(command);
    case "save_text_presentation_controls":
      return saveTextPresentationControls(command);
    case "get_bible_search_suggestions":
      return getBibleSearchSuggestionsPayload(command);
    case "record_bible_search":
      trackBibleSearch(undefined, "mobile_remote");
      return { recentSearches: recordRecentBibleSearchForMobile(command.label) };
    case "get_worship_library":
      return getWorshipLibraryPayload();
    case "get_notes":
      return getNotesPayload();
    case "save_notes":
      return saveNotesPayload(command.notes);
    case "show_note":
      await showNote(command.note);
      trackOutputShown("note_shown", "mobile_remote");
      return getCurrentStatePayload();
    case "clear_notes":
      await dockObsClient.clearNotesLyrics();
      return getCurrentStatePayload();
    case "get_media_library":
      return getMediaLibraryPayload();
    case "get_media_thumbnail":
      return getMediaThumbnailPayload(command);
    case "get_ticker_messages":
      return getTickerMessagesPayload();
    case "get_ticker_presentation_style":
      return getTickerPresentationStylePayload();
    case "save_ticker_settings":
      return saveTickerSettingsPayload(command);
    case "save_ticker_messages":
      return saveTickerMessagesPayload(command.messages);
    case "get_countdowns":
      return getCountdownsPayload();
    case "show_countdown":
      await sendCountdownToObs(command.config, true, command.sync);
      trackOutputShown("countdown_shown", "mobile_remote");
      return getCurrentStatePayload();
    case "clear_countdown":
      await hideAllCountdowns();
      return getCurrentStatePayload();
    case "get_multiview_cards":
      return getMultiviewCardsPayload();
    case "clear_multiview":
      return clearMultiview(command);
    case "register_uploaded_media":
      return registerUploadedMedia(command);
    case "get_current_state":
      return getCurrentStatePayload();
    case "get_scenes": {
      if (obsService.status !== "connected") return [];
      const scenes = await obsService.getSceneList();
      return scenes.map((scene) => ({ name: scene.sceneName, id: scene.sceneUuid || scene.sceneName }));
    }
    case "switch_scene":
      await obsService.setCurrentProgramScene(command.scene_name);
      return getCurrentStatePayload();
    case "set_preview_scene":
      await obsService.setCurrentPreviewScene(command.scene_name);
      return getCurrentStatePayload();
    case "set_studio_mode":
      await obsService.setStudioModeEnabled(command.enabled);
      return getCurrentStatePayload();
    case "get_scene_screenshot":
      return {
        sceneName: command.scene_name,
        imageData:
          obsService.status === "connected"
            ? await obsService.getSourceScreenshot(command.scene_name, command.image_width ?? 360)
            : null,
      };
    case "toggle_streaming":
      await obsService.call("ToggleStream");
      return getCurrentStatePayload();
    case "toggle_recording":
      await obsService.call("ToggleRecord");
      return getCurrentStatePayload();
    case "toggle_mic":
      {
        const micState = await getPrimaryMicState();
        if (!micState.inputName) {
          throw new Error("No OBS microphone input was found.");
        }
        await obsService.call("SetInputMute", {
          inputName: micState.inputName,
          inputMuted: !micState.muted,
        });
        return getCurrentStatePayload();
      }
    case "show_scripture":
      await handleBibleCommand(command);
      trackBiblePresent({ ref: command.reference, translation: command.translation, source: "mobile_remote" });
      // Keep verse taps responsive. The Rust companion already publishes the
      // lightweight current-scripture state update; querying every OBS scene
      // after each tap made a rapid sequence of taps wait on scene I/O.
      return { sent: true };
    case "clear_scripture":
      await dockObsClient.clearBible();
      return getCurrentStatePayload();
    case "show_slide":
      await handleWorshipSlideCommand(command);
      trackWorshipSongPresented({ source: "mobile_remote" });
      return getCurrentStatePayload();
    case "clear_worship":
      await dockObsClient.clearWorshipLyrics();
      return getCurrentStatePayload();
    case "next_slide":
    case "prev_slide": {
      const result = await handleWorshipNavigation(command);
      trackWorshipSongPresented({ source: "mobile_remote" });
      return result;
    }
    case "show_media":
      await handleMediaCommand(command);
      trackMediaPresented({ type: "library", source: "mobile_remote" });
      return getCurrentStatePayload();
    case "send_media_to_scene":
      await handleMediaToSceneCommand(command);
      trackMediaPresented({ type: "scene", source: "mobile_remote" });
      return getCurrentStatePayload();
    case "clear_media":
      await dockObsClient.clearMedia();
      return getCurrentStatePayload();
    case "show_ticker":
      await showMobileTicker(command);
      trackOutputShown("ticker_shown", "mobile_remote");
      return getCurrentStatePayload();
    case "clear_ticker":
      await dockObsClient.clearTicker();
      return getCurrentStatePayload();
    case "show_lower_third":
      await handleLowerThirdCommand(command);
      trackOutputShown("lower_third_shown", "mobile_remote");
      return getCurrentStatePayload();
    case "get_lower_third_themes":
      return getLowerThirdThemesPayload();
    case "get_scene_route":
      return getSceneRoutePayload(command.module);
    case "save_scene_route":
      return saveSceneRoutePayload(command.module, command.route);
    case "clear_lower_third":
      await lowerThirdObsService.clearAll();
      return getCurrentStatePayload();
    case "blank_lower_third":
      await lowerThirdObsService.blankAll();
      return getCurrentStatePayload();
    case "get_macros":
      return getMacros();
    case "save_macro": {
      const data = command.macro_data;
      if (typeof data.name !== "string" || !Array.isArray(data.steps)) {
        throw new Error("A macro needs a name and at least one ordered step.");
      }
      return saveMacro({
        ...data,
        name: data.name,
        steps: data.steps as AutomationStep[],
      });
    }
    case "delete_macro": {
      deleteMacro(command.macro_id);
      return getMacros();
    }
    case "execute_macro":
    case "execute_automation":
      await automationRunner.runMacro(command.macro_id);
      return { executed: true, macroId: command.macro_id };
    case "get_automation_rules":
      return getAutomationRules();
    case "save_automation_rule": {
      const data = command.rule_data as Partial<StoredAutomationRule>;
      if (typeof data.name !== "string" || !data.trigger || !Array.isArray(data.actions)) {
        throw new Error("An automation needs a name, trigger, and ordered actions.");
      }
      return saveAutomationRule({
        ...data,
        name: data.name,
        trigger: data.trigger,
        actions: data.actions as AutomationStep[],
      });
    }
    case "delete_automation_rule":
      deleteAutomationRule(command.rule_id);
      return getAutomationRules();
    case "toggle_automation_rule":
      return setAutomationRuleEnabled(command.rule_id, command.enabled) ?? getAutomationRules();
    case "get_automation_logs":
      return getAutomationLogs();
    case "clear_automation_logs":
      clearAutomationLogs();
      return [];
  }
}

export async function initMobileRemoteCommandBridge(): Promise<TauriUnlisten> {
  return safeTauriListen<MobileCommandEvent>("mobile-companion-command", async ({ payload }) => {
    if (!payload?.commandId || !payload.command) return;

    try {
      const result = await runMobileCommand(payload.command);
      await complete(payload.commandId, true, result);
    } catch (error) {
      await complete(
        payload.commandId,
        false,
        null,
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
