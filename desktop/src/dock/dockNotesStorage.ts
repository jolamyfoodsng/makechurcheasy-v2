import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import { DEFAULT_THEME_SETTINGS, type BibleTheme } from "../bible/types";
import { themeSupportsBibleOverlayMode } from "../bible/themeVariantSupport";
import type { DockFullscreenQuickThemeSettings } from "./components/DockFullscreenThemeQuickSettings";
import { normalizeCompareThemeSettings } from "./compareThemeConfig";
import { loadDockFavoriteBibleThemes } from "./dockThemeData";
import { getUserScopedKey } from "../services/userScopedStorage";
import {
  isNativeDockSettingsHydrated,
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../services/localDockSettings";
import { pickLayoutAdjust } from "../themes/layout/adjust";

export type DockNotesOverlayMode = "fullscreen" | "lower-third";

export interface DockNote {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  sourceId?: string;
  /** Stable voice-listening session; transcript captures from one session share one note. */
  sessionId?: string;
  /** Bounded append-command history makes relay retries idempotent across reloads. */
  appendSourceIds?: string[];
  /** Legacy compatibility flag; blank lines now determine slide boundaries. */
  splitOnLineBreaks?: boolean;
  autoSplit?: boolean;
  linesPerSlide?: number;
}

export interface DockNotesPreferences {
  overlayMode?: DockNotesOverlayMode;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  fullscreenQuickSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickSettings?: DockFullscreenQuickThemeSettings | null;
  linesPerSlide?: number;
  fullscreenLinesPerSlide?: number;
  lowerThirdLinesPerSlide?: number;
  autoSplit?: boolean;
  quickActionsTop?: number;
  quickActionsLeft?: number | null;
  quickUpdateImmediately?: boolean;
  updatedAt?: string;
}

export interface DockNotesPresentationSettings {
  overlayMode: DockNotesOverlayMode;
  theme: BibleTheme;
  themeId: string;
  themeSettings: Record<string, unknown> | null;
}

export const DOCK_NOTES_KEY = "ocs-dock-notes-v1";
export const DOCK_NOTES_SAVED_AT_KEY = "ocs-dock-notes-v1-saved-at";
export const DOCK_NOTES_PREFS_KEY = "ocs-dock-notes-preferences";
export const DOCK_NOTES_UPDATED_EVENT = "mce-dock-notes-updated";
export const DOCK_NOTES_BROADCAST_CHANNEL = "mce-dock-notes-storage";
export const DOCK_NOTES_DOCK_DATA_NAME = "dock-notes";

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeDockNotes(value: unknown): DockNote[] {
  return Array.isArray(value)
    ? value.filter((note): note is DockNote =>
      Boolean(
        note
        && typeof note === "object"
        && typeof (note as DockNote).id === "string"
        && typeof (note as DockNote).title === "string"
        && typeof (note as DockNote).content === "string",
      ),
    )
    : [];
}

function readScopedStorage(baseKey: string): string | null {
  if (typeof localStorage === "undefined") return null;
  const scopedKey = getUserScopedKey(baseKey);
  const scopedRaw = localStorage.getItem(scopedKey);
  if (scopedRaw !== null || scopedKey === baseKey) return scopedRaw;

  const legacyRaw = localStorage.getItem(baseKey);
  if (legacyRaw !== null) {
    try {
      localStorage.setItem(scopedKey, legacyRaw);
    } catch {
      // Ignore migration failures in embedded browser contexts.
    }
  }
  return legacyRaw;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDockNotesOverlayMode(value: unknown): value is DockNotesOverlayMode {
  return value === "fullscreen" || value === "lower-third";
}

function notifyDockNotesUpdated(notes: DockNote[], savedAt: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOCK_NOTES_UPDATED_EVENT, { detail: { notes, savedAt } }));
  try {
    const bc = new BroadcastChannel(DOCK_NOTES_BROADCAST_CHANNEL);
    bc.postMessage({ type: "notes-updated", notes, savedAt });
    bc.close();
  } catch {
    // BroadcastChannel is not available in every embedded browser context.
  }
}

function formatSavedNoteTitle(now: number, text: string): string {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  const preview = firstLine
    ? firstLine.replace(/\s+/g, " ").slice(0, 44)
    : "Saved note";
  const time = new Date(now).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${preview} · ${time}`;
}

function backgroundTypeFromQuickSettings(
  quickSettings: DockFullscreenQuickThemeSettings,
): NonNullable<DockFullscreenQuickThemeSettings["backgroundType"]> {
  if (quickSettings.backgroundType) return quickSettings.backgroundType;
  if (quickSettings.backgroundVideo) return "video";
  if (quickSettings.backgroundImage) return "image";
  if (quickSettings.backgroundPattern) return "pattern";
  if (quickSettings.backgroundColor && quickSettings.backgroundColor !== "transparent") return "color";
  return "theme";
}

export function applyQuickSettingsToNotesTheme(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null | undefined,
): BibleTheme {
  if (!quickSettings) return theme;

  const bgType = backgroundTypeFromQuickSettings(quickSettings);
  const useThemeBg = bgType === "theme";
  const useNoBg = bgType === "off";
  const useColorBg = bgType === "color";
  const compareSettings = normalizeCompareThemeSettings(quickSettings as Record<string, unknown>);

  return {
    ...theme,
    settings: {
      ...theme.settings,
      // Size / position tweaks for layer themes (ignored by legacy themes).
      ...pickLayoutAdjust(quickSettings),
      fontSize: quickSettings.fontSize ?? theme.settings.fontSize,
      autoFontScale: true,
      fontFamily: quickSettings.fontFamily ?? theme.settings.fontFamily,
      refFontSize: quickSettings.refFontSize ?? theme.settings.refFontSize,
      refFontWeight: quickSettings.refFontWeight ?? theme.settings.refFontWeight,
      fontColor: quickSettings.fontColor ?? theme.settings.fontColor,
      refFontColor: quickSettings.refFontColor ?? theme.settings.refFontColor,
      fullscreenShadeColor: quickSettings.fullscreenShadeColor ?? theme.settings.fullscreenShadeColor,
      fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity ?? theme.settings.fullscreenShadeOpacity,
      fullscreenShadeEnabled: (quickSettings.fullscreenShadeOpacity ?? theme.settings.fullscreenShadeOpacity) > 0,
      textAlign: quickSettings.textAlign ?? theme.settings.textAlign,
      lineHeight: quickSettings.lineHeight ?? theme.settings.lineHeight,
      letterSpacing: quickSettings.letterSpacing ?? theme.settings.letterSpacing,
      wordSpacing: quickSettings.wordSpacing ?? theme.settings.wordSpacing,
      fontWeight: quickSettings.fontWeight ?? theme.settings.fontWeight,
      fontStyle: quickSettings.fontStyle ?? theme.settings.fontStyle,
      textTransform: quickSettings.textTransform ?? theme.settings.textTransform,
      textShadow: quickSettings.textShadow ?? theme.settings.textShadow ?? DEFAULT_THEME_SETTINGS.textShadow,
      textOutline: quickSettings.textOutline ?? theme.settings.textOutline ?? DEFAULT_THEME_SETTINGS.textOutline,
      textOutlineColor: quickSettings.textOutlineColor ?? theme.settings.textOutlineColor ?? DEFAULT_THEME_SETTINGS.textOutlineColor,
      textOutlineWidth: quickSettings.textOutlineWidth ?? theme.settings.textOutlineWidth ?? DEFAULT_THEME_SETTINGS.textOutlineWidth,
      animation: quickSettings.animation ?? theme.settings.animation,
      animationDuration: quickSettings.animationDuration ?? theme.settings.animationDuration,
      backgroundPattern: useNoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundPattern ?? "")
          : bgType === "pattern"
            ? (quickSettings.backgroundPattern ?? "")
            : "",
      backgroundImage: useNoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImage ?? "")
          : (quickSettings.backgroundImage ?? ""),
      backgroundImageFilePath: useNoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImageFilePath ?? "")
          : (quickSettings.backgroundImageFilePath ?? ""),
      backgroundVideo: useNoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideo ?? "")
          : (quickSettings.backgroundVideo ?? ""),
      backgroundVideoFilePath: useNoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideoFilePath ?? "")
          : (quickSettings.backgroundVideoFilePath ?? ""),
      backgroundOpacity: useNoBg
        ? 0
        : useThemeBg
          ? (theme.settings.backgroundOpacity ?? 1)
          : (quickSettings.backgroundOpacity ?? 1),
      backgroundColor: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColor || DEFAULT_THEME_SETTINGS.backgroundColor)
          : useColorBg
            ? (quickSettings.backgroundColor || DEFAULT_THEME_SETTINGS.backgroundColor)
            : (quickSettings.backgroundColor || "transparent"),
      backgroundColorEnd: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColorEnd || "")
          : useColorBg
            ? (quickSettings.backgroundColorEnd || "")
            : (quickSettings.backgroundColorEnd || ""),
      bgGradientAngle: useThemeBg
        ? (theme.settings.bgGradientAngle ?? DEFAULT_THEME_SETTINGS.bgGradientAngle)
        : (quickSettings.bgGradientAngle ?? DEFAULT_THEME_SETTINGS.bgGradientAngle),
      boxBackground: useNoBg ? "transparent" : (theme.settings.boxBackground || DEFAULT_THEME_SETTINGS.boxBackground),
      referenceBackgroundEnabled: quickSettings.referenceBackgroundEnabled ?? theme.settings.referenceBackgroundEnabled,
      referenceBackgroundColor: quickSettings.referenceBackgroundColor ?? theme.settings.referenceBackgroundColor,
      referenceBackgroundStyle: quickSettings.referenceBackgroundStyle ?? theme.settings.referenceBackgroundStyle,
      referenceBackgroundRadius: quickSettings.referenceBackgroundRadius ?? theme.settings.referenceBackgroundRadius,
      refPosition: quickSettings.refPosition ?? theme.settings.refPosition,
      refTextTransform: quickSettings.refTextTransform ?? theme.settings.refTextTransform,
      refLetterSpacing: quickSettings.refLetterSpacing ?? theme.settings.refLetterSpacing,
      refOpacity: quickSettings.refOpacity ?? theme.settings.refOpacity,
      refTextAlign: quickSettings.refTextAlign ?? theme.settings.refTextAlign,
      refSpacing: quickSettings.refSpacing ?? theme.settings.refSpacing,
      backgroundType: bgType,
      lowerThirdPosition: quickSettings.lowerThirdPosition ?? theme.settings.lowerThirdPosition,
      lowerThirdSize: quickSettings.lowerThirdSize ?? theme.settings.lowerThirdSize,
      lowerThirdWidthPreset: quickSettings.lowerThirdWidthPreset ?? theme.settings.lowerThirdWidthPreset,
      lowerThirdOffsetX: quickSettings.lowerThirdOffsetX ?? theme.settings.lowerThirdOffsetX,
      lowerThirdCaptionPosition: quickSettings.lowerThirdCaptionPosition ?? theme.settings.lowerThirdCaptionPosition,
      lowerThirdEdge: quickSettings.lowerThirdEdge ?? theme.settings.lowerThirdEdge,
      lowerThirdCardPadding: quickSettings.lowerThirdCardPadding ?? theme.settings.lowerThirdCardPadding,
      lowerThirdPaddingLinked: quickSettings.lowerThirdPaddingLinked ?? theme.settings.lowerThirdPaddingLinked,
      lowerThirdCardRadius: quickSettings.lowerThirdCardRadius ?? theme.settings.lowerThirdCardRadius,
      lowerThirdTextDirection: quickSettings.lowerThirdTextDirection ?? theme.settings.lowerThirdTextDirection,
      ...compareSettings,
    },
  };
}

/** One copy of the notes list (browser storage, the on-disk copy, a message). */
export interface DockNotesCopy {
  notes: DockNote[];
  /** When the whole list was last saved. Missing for older copies and files. */
  savedAt?: number;
}

function copySavedAt(copy: DockNotesCopy): number {
  if (typeof copy.savedAt === "number" && Number.isFinite(copy.savedAt)) return copy.savedAt;
  // Older copies have no list timestamp: they are as new as their newest note.
  return copy.notes.reduce((newest, note) => Math.max(newest, Number(note.updatedAt) || 0), 0);
}

/**
 * Combine copies of the notes list so the newest edit always wins.
 *
 * The OBS Dock and the main window each keep their own browser copy, and the
 * app keeps one on disk. An old copy used to replace a newer one whole, so
 * yesterday's notes came back after a restart. Now the most recently saved
 * list decides which notes exist (so deletions stick), a note edited later in
 * another copy keeps that edit, and a note created in another copy after this
 * list was saved is kept.
 */
export function mergeDockNotesCopies(copies: DockNotesCopy[]): DockNotesCopy {
  const ranked = copies
    .map((copy) => ({ notes: normalizeDockNotes(copy.notes), savedAt: copySavedAt(copy) }))
    .sort((a, b) => b.savedAt - a.savedAt);
  const [newest, ...older] = ranked;
  if (!newest) return { notes: [], savedAt: 0 };

  const byId = new Map(newest.notes.map((note) => [note.id, note]));
  const added: DockNote[] = [];
  for (const copy of older) {
    for (const note of copy.notes) {
      const current = byId.get(note.id);
      if (current) {
        if ((Number(note.updatedAt) || 0) > (Number(current.updatedAt) || 0)) byId.set(note.id, note);
      } else if ((Number(note.updatedAt) || 0) > newest.savedAt) {
        byId.set(note.id, note);
        added.push(note);
      }
    }
  }

  return {
    notes: [...added, ...newest.notes.map((note) => byId.get(note.id) ?? note)],
    savedAt: newest.savedAt,
  };
}

function readSavedAt(raw: unknown): number | undefined {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readLocalNotesCopy(): DockNotesCopy {
  return {
    notes: normalizeDockNotes(safeJsonParse<unknown>(readScopedStorage(DOCK_NOTES_KEY), [])),
    savedAt: readSavedAt(readScopedStorage(DOCK_NOTES_SAVED_AT_KEY)),
  };
}

function readDurableNotesCopy(): DockNotesCopy | null {
  const raw = readNativeDockSetting<unknown>(DOCK_NOTES_KEY);
  if (raw === undefined) return null;
  return {
    notes: normalizeDockNotes(raw),
    savedAt: readSavedAt(readNativeDockSetting<unknown>(DOCK_NOTES_SAVED_AT_KEY)),
  };
}

function writeLocalNotesCopy(copy: DockNotesCopy): void {
  localStorage.setItem(getUserScopedKey(DOCK_NOTES_KEY), JSON.stringify(copy.notes));
  if (copy.savedAt) localStorage.setItem(getUserScopedKey(DOCK_NOTES_SAVED_AT_KEY), String(copy.savedAt));
}

function writeDurableNotesCopy(copy: DockNotesCopy): void {
  // Durable copy on disk (SQLite via the desktop app) so notes survive updates.
  void writeNativeDockSetting(DOCK_NOTES_KEY, copy.notes);
  if (copy.savedAt) void writeNativeDockSetting(DOCK_NOTES_SAVED_AT_KEY, copy.savedAt);
}

function sameNotes(a: DockNote[], b: DockNote[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge `extra` copies with this window's own copy and the on-disk copy, and
 * store the result in whichever of those was out of date.
 */
function loadMergedDockNotes(extra: DockNotesCopy[] = []): DockNotesCopy {
  const local = readLocalNotesCopy();
  const durable = readDurableNotesCopy();
  const merged = mergeDockNotesCopies([local, ...(durable ? [durable] : []), ...extra]);

  try {
    if (!sameNotes(merged.notes, local.notes) || (merged.savedAt ?? 0) > (local.savedAt ?? 0)) {
      writeLocalNotesCopy(merged);
    }
  } catch {
    // Ignore storage failures inside OBS/browser dock contexts.
  }
  // Only correct the disk copy once it has been read; writing before then
  // could replace newer notes this window has not seen yet.
  const durableOutOfDate = durable ? !sameNotes(merged.notes, durable.notes) : merged.notes.length > 0;
  if (durableOutOfDate && isNativeDockSettingsHydrated()) writeDurableNotesCopy(merged);
  return merged;
}

export function loadDockNotes(): DockNote[] {
  if (typeof localStorage === "undefined") return [];
  return loadMergedDockNotes().notes;
}

/** When the notes list was last saved, for messages sent to other windows. */
export function loadDockNotesSavedAt(): number | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return readSavedAt(readScopedStorage(DOCK_NOTES_SAVED_AT_KEY));
}

/**
 * Take notes sent from another window (the app, the Dock, a shared file) and
 * keep whichever version of each note is newest. Returns the merged list.
 */
export function acceptIncomingDockNotes(notes: DockNote[], savedAt?: number): DockNote[] {
  if (typeof localStorage === "undefined") return normalizeDockNotes(notes);
  return loadMergedDockNotes([{ notes, savedAt }]).notes;
}

export function saveDockNotes(items: DockNote[], notify = true): void {
  if (typeof localStorage === "undefined") return;
  // Never stamp a save older than the copy it replaces (clock changes).
  const savedAt = Math.max(Date.now(), (readSavedAt(readScopedStorage(DOCK_NOTES_SAVED_AT_KEY)) ?? 0) + 1);
  writeDurableNotesCopy({ notes: items, savedAt });
  try {
    writeLocalNotesCopy({ notes: items, savedAt });
    if (notify) {
      notifyDockNotesUpdated(items, savedAt);
      import("../services/cloudSyncService").then((m) => m.triggerDebouncedAutoSync()).catch(() => { });
    }
  } catch {
    // Ignore storage failures inside OBS/browser dock contexts.
  }
}

export async function loadDockNotesFromDockData(): Promise<DockNote[]> {
  try {
    const response = await fetch(`/uploads/${DOCK_NOTES_DOCK_DATA_NAME}.json?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    return normalizeDockNotes(safeJsonParse<unknown>(await response.text(), []));
  } catch {
    return [];
  }
}

export async function syncDockNotesToDock(notes: DockNote[] = loadDockNotes()): Promise<void> {
  // The desktop window usually has no notes of its own (they are written in the
  // OBS Dock). Never replace the shared file with an empty list on startup —
  // that wiped the Dock's recovery copy every time the app restarted.
  if (notes.length === 0) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: DOCK_NOTES_DOCK_DATA_NAME,
      data: JSON.stringify(notes),
    });
  } catch {
    // The standalone OBS dock cannot call Tauri; the main app sync path handles this.
  }
}

export function appendTextToDockNotes(
  text: string,
  title?: string,
  options: { sourceId?: string; sessionId?: string } = {},
): { note: DockNote; notes: DockNote[] } | null {
  const cleanText = text.trim();
  if (!cleanText) return null;

  const notes = loadDockNotes();
  const now = Date.now();
  const sourceId = options.sourceId?.trim();
  const sessionId = options.sessionId?.trim();
  if (sourceId) {
    const existingSourceNote = notes.find((note) => (
      note.sourceId === sourceId || note.appendSourceIds?.includes(sourceId)
    ));
    if (existingSourceNote) return { note: existingSourceNote, notes };
  }

  const noteTitle = title ?? formatSavedNoteTitle(now, cleanText);
  const existingIndex = sessionId
    ? notes.findIndex((note) => note.sessionId === sessionId)
    : notes.findIndex((note) => note.title === noteTitle);

  if (existingIndex >= 0) {
    const existing = notes[existingIndex];
    const note: DockNote = {
      ...existing,
      sourceId: existing.sourceId ?? sourceId,
      ...(sessionId ? { sessionId } : {}),
      ...(sourceId ? {
        appendSourceIds: [...new Set([...(existing.appendSourceIds ?? []), sourceId])].slice(-100),
      } : {}),
      content: existing.content ? `${existing.content}\n\n${cleanText}` : cleanText,
      updatedAt: now,
    };
    const next = [note, ...notes.filter((_, index) => index !== existingIndex)];
    saveDockNotes(next);
    return { note, notes: next };
  }

  const note: DockNote = {
    id: createId("note"),
    title: noteTitle,
    content: cleanText,
    updatedAt: now,
    ...(sessionId ? { sessionId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(sourceId ? { appendSourceIds: [sourceId] } : {}),
  };
  const next = [note, ...notes];
  saveDockNotes(next);
  return { note, notes: next };
}

export function loadDockNotesPreferences(): DockNotesPreferences {
  const raw = readNativeDockSetting<unknown>(DOCK_NOTES_PREFS_KEY);
  const parsed = typeof raw === "string" ? safeJsonParse<unknown>(raw, {}) : raw ?? {};
  return parsed && typeof parsed === "object" ? parsed as DockNotesPreferences : {};
}

export function saveDockNotesPreferences(prefs: DockNotesPreferences): void {
  writeNativeDockSetting(DOCK_NOTES_PREFS_KEY, {
    ...prefs,
    updatedAt: new Date().toISOString(),
  });
}

export function readDockNotesOverlayMode(fallback: DockNotesOverlayMode = "fullscreen"): DockNotesOverlayMode {
  const mode = loadDockNotesPreferences().overlayMode;
  return isDockNotesOverlayMode(mode) ? mode : fallback;
}

export function getDockNotesThemeForMode(theme: BibleTheme, overlayMode: DockNotesOverlayMode): BibleTheme {
  const variant = overlayMode === "lower-third"
    ? theme.variants?.lowerThird
    : theme.variants?.fullscreen;
  return variant
    ? { ...theme, settings: variant.settings, rawTemplate: variant.rawTemplate }
    : theme;
}

export function getFallbackDockNotesTheme(
  overlayMode: DockNotesOverlayMode,
  preferredThemeId?: string,
): BibleTheme {
  const preferred = BUILTIN_THEMES.find(
    (theme) => theme.id === preferredThemeId && themeSupportsBibleOverlayMode(theme, overlayMode),
  );
  if (preferred) return preferred;

  return BUILTIN_THEMES.find((theme) => themeSupportsBibleOverlayMode(theme, overlayMode))
    ?? BUILTIN_THEMES[0];
}

export async function resolveDockNotesTheme(
  overlayMode: DockNotesOverlayMode,
  prefs: DockNotesPreferences = loadDockNotesPreferences(),
): Promise<BibleTheme> {
  const preferredThemeId = overlayMode === "fullscreen"
    ? prefs.fullscreenThemeId
    : prefs.lowerThirdThemeId;

  try {
    const allFavorites = await loadDockFavoriteBibleThemes();
    const stored = allFavorites.find(
      (theme) => theme.id === preferredThemeId && themeSupportsBibleOverlayMode(theme, overlayMode),
    );
    if (stored) return stored;
  } catch {
    // Fall through to built-in fallback.
  }

  return getFallbackDockNotesTheme(overlayMode, preferredThemeId);
}

export async function resolveDockNotesPresentationSettings(
  fallbackOverlayMode: DockNotesOverlayMode = "fullscreen",
  options: { forceOverlayMode?: boolean } = {},
): Promise<DockNotesPresentationSettings> {
  const prefs = loadDockNotesPreferences();
  const overlayMode = options.forceOverlayMode || !isDockNotesOverlayMode(prefs.overlayMode)
    ? fallbackOverlayMode
    : prefs.overlayMode;
  const preferredThemeId = overlayMode === "fullscreen"
    ? prefs.fullscreenThemeId
    : prefs.lowerThirdThemeId;
  const quickSettings = overlayMode === "fullscreen"
    ? prefs.fullscreenQuickSettings
    : prefs.lowerThirdQuickSettings;

  if (quickSettings) {
    const resolvedTheme = await resolveDockNotesTheme(overlayMode, prefs);
    const baseTheme = getDockNotesThemeForMode(resolvedTheme, overlayMode);
    const theme = applyQuickSettingsToNotesTheme(baseTheme, quickSettings);
    return {
      overlayMode,
      theme,
      themeId: preferredThemeId ?? theme.id,
      themeSettings: theme.settings as unknown as Record<string, unknown>,
    };
  }

  const theme = await resolveDockNotesTheme(overlayMode, prefs);
  const effectiveTheme = getDockNotesThemeForMode(theme, overlayMode);
  const themeSettings = effectiveTheme.settings ?? null;

  return {
    overlayMode,
    theme: effectiveTheme,
    themeId: effectiveTheme.id,
    themeSettings: themeSettings as unknown as Record<string, unknown> | null,
  };
}
