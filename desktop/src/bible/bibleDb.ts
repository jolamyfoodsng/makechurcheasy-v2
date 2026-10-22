/**
 * bibleDb.ts — IndexedDB persistence for the Bible module
 *
 * Stores: favorites, history, custom themes, user settings, downloaded translations.
 * User-owned stores (favorites, history, themes, settings) are scoped by userId.
 * Translations are shared reference data — NOT user-scoped.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { BiblePassage, BibleTheme, SlideConfig } from "./types";
import type { InstalledBible, RawBibleData } from "./types";
import { DEFAULT_SLIDE_CONFIG, DEFAULT_THEME_SETTINGS } from "./types";
import { notifyDockThemesChanged, syncFavoriteBibleThemesToDock } from "../services/favoriteThemes";
import { trackThemeCreated } from "../services/tracking";
import { serializeBibleThemesForDock } from "../services/dockBibleThemeAssets";
import { resolveOverlayAssetUrl, toStoredOverlayAssetUrl } from "../services/overlayUrl";
import { deleteRecord, getAll, getByKey, getCurrentUserId, putRecord, STORES } from "../services/db";
import { getDeviceId } from "../services/authService";
import { assertCompleteBibleData, formatBibleDataStats, getBibleDataStats, isCompleteBibleData } from "./bibleValidation";

const DB_NAME = "sunday-switcher-bible"; // legacy name — do not change (breaks existing user data)
const DB_VERSION = 4;
const CUSTOM_THEMES_STORAGE_KEY = "ocs-bible-custom-themes";

const API_BASE =
  import.meta.env.VITE_AUTH_API_URL ||
  "https://api.makechurcheazy.com";

function getCustomThemesStorageKey(): string {
  const uid = getCurrentUserId();
  return uid ? `${CUSTOM_THEMES_STORAGE_KEY}:${uid}` : CUSTOM_THEMES_STORAGE_KEY;
}

// ── MongoDB API sync helpers ─────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const deviceId = getDeviceId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(deviceId ? { "X-Device-Id": deviceId } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API ${res.status}`);
  }

  return res.json();
}

async function pushThemeToAPI(theme: BibleTheme): Promise<void> {
  await apiFetch("/api/themes", {
    method: "POST",
    body: JSON.stringify({
      theme: {
        themeId: theme.id,
        name: theme.name,
        description: theme.description,
        source: theme.source || "custom",
        templateType: theme.templateType,
        category: theme.category,
        categories: theme.categories,
        settings: theme.settings,
        preview: theme.preview,
        hidden: theme.hidden,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      },
    }),
  });
}

async function deleteThemeFromAPI(themeId: string): Promise<void> {
  await apiFetch(`/api/themes?themeId=${encodeURIComponent(themeId)}`, {
    method: "DELETE",
  });
}

async function fetchThemesFromAPI(): Promise<BibleTheme[]> {
  const data = await apiFetch<{ themes: Array<Record<string, unknown>> }>("/api/themes");
  return (data.themes || []).map((doc) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = {
      id: doc.themeId,
      name: doc.name,
      description: doc.description,
      source: "custom",
      templateType: doc.templateType,
      category: doc.category,
      categories: doc.categories,
      settings: doc.settings,
      preview: doc.preview,
      hidden: doc.hidden,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    return normalizeTheme(raw as BibleTheme);
  });
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function normalizeTheme(theme: BibleTheme): BibleTheme {
  return {
    ...theme,
    settings: {
      ...DEFAULT_THEME_SETTINGS,
      ...theme.settings,
      backgroundImage: resolveOverlayAssetUrl(theme.settings?.backgroundImage),
      backgroundVideo: resolveOverlayAssetUrl(theme.settings?.backgroundVideo),
      boxBackgroundImage: resolveOverlayAssetUrl(theme.settings?.boxBackgroundImage),
      logoUrl: resolveOverlayAssetUrl(theme.settings?.logoUrl),
    },
  };
}

function prepareThemeForStorage(theme: BibleTheme): BibleTheme {
  return {
    ...theme,
    settings: {
      ...DEFAULT_THEME_SETTINGS,
      ...theme.settings,
      backgroundImage: toStoredOverlayAssetUrl(theme.settings?.backgroundImage),
      backgroundVideo: toStoredOverlayAssetUrl(theme.settings?.backgroundVideo),
      boxBackgroundImage: toStoredOverlayAssetUrl(theme.settings?.boxBackgroundImage),
      logoUrl: toStoredOverlayAssetUrl(theme.settings?.logoUrl),
    },
  };
}

function sortCustomThemesNewestFirst(themes: BibleTheme[]): BibleTheme[] {
  return [...themes].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function mergeCustomThemes(apiThemes: BibleTheme[], localThemes: BibleTheme[]): BibleTheme[] {
  const merged = new Map<string, BibleTheme>();
  for (const theme of localThemes) {
    merged.set(theme.id, normalizeTheme(theme));
  }
  for (const theme of apiThemes) {
    merged.set(theme.id, normalizeTheme(theme));
  }
  return sortCustomThemesNewestFirst(Array.from(merged.values()));
}

function getTranslationKey(abbr: string): string {
  return abbr.trim().toUpperCase();
}

type InstalledBibleMetadata = Omit<InstalledBible, "data">;

function installedBibleTime(bible: Pick<InstalledBible, "downloadedAt">): number {
  return new Date(bible.downloadedAt || 0).getTime();
}

function toInstalledBibleMetadata(bible: InstalledBible): InstalledBibleMetadata {
  return {
    id: bible.id,
    abbr: getTranslationKey(bible.abbr),
    name: bible.name,
    language: bible.language,
    downloadedAt: bible.downloadedAt,
    filesize: bible.filesize,
  };
}

function mergeInstalledBibles(...groups: InstalledBible[][]): InstalledBible[] {
  const merged = new Map<string, InstalledBible>();
  for (const group of groups) {
    for (const bible of group) {
      if (!bible?.abbr) continue;
      const key = getTranslationKey(bible.abbr);
      const current = merged.get(key);
      if (!current || installedBibleTime(bible) >= installedBibleTime(current)) {
        merged.set(key, { ...bible, abbr: key });
      }
    }
  }
  return Array.from(merged.values()).sort((left, right) => left.abbr.localeCompare(right.abbr));
}

function mergeInstalledBibleMetadata(...groups: InstalledBibleMetadata[][]): InstalledBibleMetadata[] {
  const merged = new Map<string, InstalledBibleMetadata>();
  for (const group of groups) {
    for (const bible of group) {
      if (!bible?.abbr) continue;
      const normalized = { ...bible, abbr: getTranslationKey(bible.abbr) };
      const current = merged.get(normalized.abbr);
      if (!current || installedBibleTime(normalized) >= installedBibleTime(current)) {
        merged.set(normalized.abbr, normalized);
      }
    }
  }
  return Array.from(merged.values()).sort((left, right) => left.abbr.localeCompare(right.abbr));
}

async function readCustomThemesFromCentralDb(): Promise<BibleTheme[]> {
  try {
    const raw = await getAll<BibleTheme>(STORES.BIBLE_THEMES);
    return sortCustomThemesNewestFirst(raw.map((theme) => normalizeTheme(theme)));
  } catch {
    return [];
  }
}

async function writeCustomThemeToCentralDb(theme: BibleTheme): Promise<void> {
  try {
    await putRecord(STORES.BIBLE_THEMES, prepareThemeForStorage(theme));
  } catch (err) {
    console.warn("[bibleDb] Failed to mirror custom theme to central IndexedDB:", err);
  }
}

async function deleteCustomThemeFromCentralDb(id: string): Promise<void> {
  try {
    await deleteRecord(STORES.BIBLE_THEMES, id);
  } catch (err) {
    console.warn("[bibleDb] Failed to delete custom theme from central IndexedDB:", err);
  }
}

function canLoadDockData(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function loadDockDataJson<T>(name: string): Promise<T | null> {
  if (!canLoadDockData()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("load_dock_data", { name });
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * The OBS Dock is a different browser origin from the app, so it cannot see the app's
 * IndexedDB or call Tauri. The app mirrors installed Bibles into the uploads folder
 * (dock-bible-translations + one file per translation); the Dock reads and writes
 * those same files over the local server.
 */
async function fetchDockDataOverHttp<T>(name: string): Promise<T | null> {
  try {
    const response = await fetch(`/uploads/${name}.json?cacheBust=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    if (!text.startsWith("[") && !text.startsWith("{")) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Dock data for a translation: through Tauri in the app, over HTTP in the OBS Dock. */
async function loadTranslationDockData<T>(name: string): Promise<T | null> {
  if (canLoadDockData()) return loadDockDataJson<T>(name);
  return fetchDockDataOverHttp<T>(name);
}

async function postDockData(name: string, payload: unknown): Promise<boolean> {
  try {
    const response = await fetch("/api/save-dock-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: JSON.stringify(payload) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readCustomThemesFromDockData(): Promise<BibleTheme[]> {
  const raw = await loadDockDataJson<unknown>("dock-bible-themes");
  if (!Array.isArray(raw)) return [];
  return sortCustomThemesNewestFirst(raw
    .filter((theme): theme is BibleTheme => !!theme && typeof theme === "object" && "id" in theme)
    .map((theme) => normalizeTheme(theme)));
}

async function readInstalledTranslationMetadataFromDockData(): Promise<InstalledBibleMetadata[]> {
  const metadata = await loadTranslationDockData<InstalledBibleMetadata[]>("dock-bible-translations");
  if (!Array.isArray(metadata)) return [];
  return metadata
    .filter((entry): entry is InstalledBibleMetadata =>
      Boolean(entry && typeof entry.abbr === "string" && entry.abbr.trim())
    )
    .map((entry) => ({ ...entry, abbr: getTranslationKey(entry.abbr) }));
}

async function readInstalledTranslationFromDockData(
  abbrOrEntry: string | InstalledBibleMetadata,
  metadata?: InstalledBibleMetadata[],
): Promise<InstalledBible | undefined> {
  const entries = metadata ?? await readInstalledTranslationMetadataFromDockData();
  const key = getTranslationKey(typeof abbrOrEntry === "string" ? abbrOrEntry : abbrOrEntry.abbr);
  const entry = entries.find((candidate) => getTranslationKey(candidate.abbr) === key);

  const data = await loadTranslationDockData<RawBibleData>(`dock-bible-translation-${key.toLowerCase()}`);
  if (!data || !isCompleteBibleData(data)) return undefined;

  return {
    id: entry?.id || key,
    abbr: key,
    name: entry?.name || key,
    language: entry?.language || "English",
    downloadedAt: entry?.downloadedAt || new Date().toISOString(),
    filesize: entry?.filesize || 0,
    data,
  };
}

async function readInstalledTranslationsFromCentralDb(): Promise<InstalledBible[]> {
  try {
    return await getAll<InstalledBible>(STORES.BIBLE_TRANSLATIONS);
  } catch {
    return [];
  }
}

async function writeInstalledTranslationToCentralDb(bible: InstalledBible): Promise<void> {
  try {
    await putRecord(STORES.BIBLE_TRANSLATIONS, { ...bible, abbr: getTranslationKey(bible.abbr) });
  } catch (err) {
    console.warn("[bibleDb] Failed to mirror Bible translation to central IndexedDB:", err);
  }
}

/**
 * Copies a Bible into the central database once per download. Doing it on every read re-saved the
 * whole multi-megabyte Bible each time a translation was opened, which stalled the page.
 */
function mirrorToCentralDbOnce(bible: InstalledBible): void {
  const flag = `mce-bible-central-mirror:${getTranslationKey(bible.abbr)}:${installedBibleTime(bible)}`;
  try {
    if (localStorage.getItem(flag)) return;
  } catch {
    // No local storage: fall through and copy.
  }
  void writeInstalledTranslationToCentralDb(bible).then(() => {
    try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
  });
}

async function deleteInstalledTranslationFromCentralDb(abbr: string): Promise<void> {
  try {
    await deleteRecord(STORES.BIBLE_TRANSLATIONS, getTranslationKey(abbr));
    if (abbr !== getTranslationKey(abbr)) {
      await deleteRecord(STORES.BIBLE_TRANSLATIONS, abbr);
    }
  } catch (err) {
    console.warn("[bibleDb] Failed to delete Bible translation from central IndexedDB:", err);
  }
}

async function backfillCustomThemes(themes: BibleTheme[]): Promise<void> {
  if (themes.length === 0) return;
  try {
    const db = await getDb();
    const uid = getCurrentUserId();
    await Promise.all(themes.map(async (theme) => {
      const stored = prepareThemeForStorage(theme);
      await db.put("themes", uid ? { ...stored, userId: uid } : stored);
      await writeCustomThemeToCentralDb(stored);
    }));
    writeCustomThemesToLocalStorage(themes);
  } catch (err) {
    console.warn("[bibleDb] Failed to backfill custom themes:", err);
  }
}

async function backfillInstalledTranslations(
  legacyTranslations: InstalledBible[],
  centralTranslations: InstalledBible[],
  translations: InstalledBible[],
): Promise<void> {
  if (translations.length === 0) return;
  try {
    const db = await getDb();
    const legacyKeys = new Set(
      legacyTranslations
        .filter((bible) => isCompleteBibleData(bible.data))
        .map((bible) => getTranslationKey(bible.abbr)),
    );
    const centralKeys = new Set(
      centralTranslations
        .filter((bible) => isCompleteBibleData(bible.data))
        .map((bible) => getTranslationKey(bible.abbr)),
    );

    await Promise.all(translations.map(async (bible) => {
      const normalized = { ...bible, abbr: getTranslationKey(bible.abbr) };
      if (!legacyKeys.has(normalized.abbr)) {
        await db.put("translations", normalized);
      }
      if (!centralKeys.has(normalized.abbr)) {
        await writeInstalledTranslationToCentralDb(normalized);
      }
    }));
  } catch (err) {
    console.warn("[bibleDb] Failed to backfill Bible translations:", err);
  }
}

function readCustomThemesFromLocalStorage(): BibleTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const scopedKey = getCustomThemesStorageKey();
    const raw = localStorage.getItem(scopedKey);
    if (!raw) {
      // Migrate from old unscoped key if it exists
      if (scopedKey !== CUSTOM_THEMES_STORAGE_KEY) {
        const legacy = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
        if (legacy) {
          localStorage.removeItem(CUSTOM_THEMES_STORAGE_KEY);
          localStorage.setItem(scopedKey, legacy);
          const parsed: unknown = JSON.parse(legacy);
          if (!Array.isArray(parsed)) return [];
          return sortCustomThemesNewestFirst(parsed
            .filter((theme): theme is BibleTheme => !!theme && typeof theme === "object" && "id" in theme)
            .map((theme) => normalizeTheme(theme)));
        }
      }
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortCustomThemesNewestFirst(parsed
      .filter((theme): theme is BibleTheme => !!theme && typeof theme === "object" && "id" in theme)
      .map((theme) => normalizeTheme(theme)));
  } catch {
    return [];
  }
}

function writeCustomThemesToLocalStorage(themes: BibleTheme[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      getCustomThemesStorageKey(),
      JSON.stringify(sortCustomThemesNewestFirst(themes.map((theme) => prepareThemeForStorage(theme))))
    );
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      console.warn("[bibleDb] localStorage quota exceeded for custom themes. IndexedDB is primary storage.");
    } else {
      console.warn("[bibleDb] Failed to mirror custom themes to localStorage:", err);
    }
    return false;
  }
}

function upsertCustomThemeInLocalStorage(theme: BibleTheme): boolean {
  const themes = readCustomThemesFromLocalStorage();
  const index = themes.findIndex((item) => item.id === theme.id);
  const nextTheme = normalizeTheme(theme);
  if (index >= 0) {
    themes[index] = nextTheme;
  } else {
    themes.push(nextTheme);
  }
  return writeCustomThemesToLocalStorage(themes);
}

function removeCustomThemeFromLocalStorage(id: string): boolean {
  const themes = readCustomThemesFromLocalStorage().filter((theme) => theme.id !== id);
  return writeCustomThemesToLocalStorage(themes);
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        // ── Ensure ALL stores exist on every upgrade ──
        // This handles partial upgrades where earlier version blocks
        // may have failed partway through.

        // Favorites store
        if (!db.objectStoreNames.contains("favorites")) {
          db.createObjectStore("favorites", { keyPath: "reference" });
        }
        // History store (keyed by timestamp)
        if (!db.objectStoreNames.contains("history")) {
          const store = db.createObjectStore("history", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("timestamp", "timestamp");
        }
        // Custom themes
        if (!db.objectStoreNames.contains("themes")) {
          db.createObjectStore("themes", { keyPath: "id" });
        }
        // Settings (single row, key = "settings")
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
        // Downloaded translations
        if (!db.objectStoreNames.contains("translations")) {
          db.createObjectStore("translations", { keyPath: "abbr" });
        }

        // ── Ensure userId indexes exist on user-owned stores ──
        const userStores = ["favorites", "history", "themes"];
        for (const storeName of userStores) {
          if (db.objectStoreNames.contains(storeName)) {
            const store = transaction.objectStore(storeName) as unknown as IDBObjectStore;
            if (!store.indexNames.contains("userId")) {
              store.createIndex("userId", "userId", { unique: false });
            }
          }
        }
      },
    }).catch((err) => {
      // Reset so the next call can retry instead of being permanently stuck
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function getFavorites(): Promise<BiblePassage[]> {
  const db = await getDb();
  const uid = getCurrentUserId();
  if (uid) {
    return db.getAllFromIndex("favorites", "userId", uid) as Promise<BiblePassage[]>;
  }
  return db.getAll("favorites");
}

export async function addFavorite(passage: BiblePassage): Promise<void> {
  const db = await getDb();
  const uid = getCurrentUserId();
  const tagged = uid ? { ...passage, userId: uid } : passage;
  await db.put("favorites", tagged);
}

export async function removeFavorite(reference: string): Promise<void> {
  const db = await getDb();
  await db.delete("favorites", reference);
}

export async function isFavorite(reference: string): Promise<boolean> {
  const db = await getDb();
  const item = await db.get("favorites", reference);
  return !!item;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id?: number;
  passage: BiblePassage;
  timestamp: number;
}

export async function getHistory(limit = 100): Promise<HistoryEntry[]> {
  const db = await getDb();
  const uid = getCurrentUserId();
  const entries: HistoryEntry[] = [];
  const tx = db.transaction("history", "readonly");

  if (uid) {
    const idx = tx.store.index("userId");
    let cursor = await idx.openCursor(IDBKeyRange.only(uid), "prev");
    while (cursor && entries.length < limit) {
      entries.push(cursor.value);
      cursor = await cursor.continue();
    }
  } else {
    const index = tx.store.index("timestamp");
    let cursor = await index.openCursor(null, "prev");
    while (cursor && entries.length < limit) {
      entries.push(cursor.value);
      cursor = await cursor.continue();
    }
  }

  return entries;
}

export async function addToHistory(passage: BiblePassage): Promise<void> {
  const db = await getDb();
  const uid = getCurrentUserId();
  await db.add("history", {
    passage,
    timestamp: Date.now(),
    ...(uid ? { userId: uid } : {}),
  });
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  const uid = getCurrentUserId();
  if (uid) {
    const tx = db.transaction("history", "readwrite");
    const idx = tx.store.index("userId");
    let cursor = await idx.openCursor(IDBKeyRange.only(uid));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } else {
    await db.clear("history");
  }
}

// ---------------------------------------------------------------------------
// Custom Themes
// ---------------------------------------------------------------------------

export async function getCustomThemes(): Promise<BibleTheme[]> {
  // Try MongoDB API first (source of truth) — requires device auth
  if (!getDeviceId()) {
    // No deviceId available yet; skip API and use local storage
    return getCustomThemesFromIndexedDB();
  }
  try {
    const apiThemes = await fetchThemesFromAPI();
    const localThemes = await getCustomThemesFromIndexedDB();
    const mergedThemes = mergeCustomThemes(apiThemes, localThemes);
    // Update local cache in background
    (async () => {
      try {
        const db = await getDb();
        const uid = getCurrentUserId();
        for (const theme of mergedThemes) {
          const tagged = uid ? { ...prepareThemeForStorage(theme), userId: uid } : prepareThemeForStorage(theme);
          await db.put("themes", tagged);
          await writeCustomThemeToCentralDb(tagged);
        }
        writeCustomThemesToLocalStorage(mergedThemes);
      } catch { /* cache update is best-effort */ }
    })();
    return mergedThemes;
  } catch (err) {
    console.warn("[bibleDb] API fetch failed, falling back to IndexedDB:", err);
  }

  return getCustomThemesFromIndexedDB();
}

async function getCustomThemesFromIndexedDB(): Promise<BibleTheme[]> {
  try {
    const db = await getDb();
    const uid = getCurrentUserId();
    let raw: BibleTheme[];
    if (uid) {
      raw = await db.getAllFromIndex("themes", "userId", uid) as BibleTheme[];
    } else {
      raw = await db.getAll("themes") as BibleTheme[];
    }
    const themes = sortCustomThemesNewestFirst(raw.map((theme) => normalizeTheme(theme)));
    const [centralThemes, dockThemes] = await Promise.all([
      readCustomThemesFromCentralDb(),
      readCustomThemesFromDockData(),
    ]);
    try {
      const localStorageThemes = readCustomThemesFromLocalStorage();
      const mergedThemes = mergeCustomThemes(
        mergeCustomThemes(mergeCustomThemes(themes, centralThemes), dockThemes),
        localStorageThemes,
      );
      if (mergedThemes.length > 0) {
        backfillCustomThemes(mergedThemes).catch(() => { });
        writeCustomThemesToLocalStorage(mergedThemes);
      }
      return mergedThemes;
    } catch {
      // Ignore mirror errors - IndexedDB is primary storage
    }
    const mergedThemes = mergeCustomThemes(mergeCustomThemes(themes, centralThemes), dockThemes);
    if (mergedThemes.length > 0) {
      backfillCustomThemes(mergedThemes).catch(() => { });
    }
    return mergedThemes;
  } catch (err) {
    console.warn("[bibleDb] Failed to load custom themes from IndexedDB, falling back to localStorage:", err);
    const [centralThemes, dockThemes, localStorageThemes] = await Promise.all([
      readCustomThemesFromCentralDb(),
      readCustomThemesFromDockData(),
      Promise.resolve(readCustomThemesFromLocalStorage()),
    ]);
    const mergedThemes = mergeCustomThemes(mergeCustomThemes(centralThemes, dockThemes), localStorageThemes);
    if (mergedThemes.length > 0) {
      backfillCustomThemes(mergedThemes).catch(() => { });
    }
    return mergedThemes;
  }
}

export async function saveCustomTheme(theme: BibleTheme): Promise<void> {
  const normalizedTheme = prepareThemeForStorage(theme);
  const uid = getCurrentUserId();
  const tagged = uid ? { ...normalizedTheme, userId: uid } : normalizedTheme;

  // Push to MongoDB API (source of truth) — skip if not authenticated
  if (getDeviceId()) {
    try {
      await pushThemeToAPI(tagged);
    } catch (err) {
      console.warn("[bibleDb] API push failed, saving locally only:", err);
    }
  }

  // Always update local cache
  let savedToDb = false;
  try {
    const db = await getDb();
    await db.put("themes", tagged);
    savedToDb = true;
  } catch (err) {
    console.warn("[bibleDb] Failed to save custom theme to IndexedDB, falling back to localStorage:", err);
  }
  await writeCustomThemeToCentralDb(tagged);

  const savedToLocalStorage = upsertCustomThemeInLocalStorage(tagged);
  if (!savedToDb && !savedToLocalStorage) {
    throw new Error("Failed to save custom theme");
  }

  trackThemeCreated(theme.source || "custom");

  // Write the Dock files first, then tell open Docks, so they read the new list.
  syncCustomThemesToDock()
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
    })
    .then(() => syncFavoriteBibleThemesToDock())
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync favorite Bible themes to dock:", err);
    })
    // The Dock opens with a saved copy of the theme chosen for Bible / Worship / Notes;
    // rewrite it so an edited theme is not shown with its old look.
    .then(() => import("../services/productionSettings").then((m) => m.syncProductionSettingsToDock()))
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync production settings to dock:", err);
    })
    .then(() => notifyDockThemesChanged());

  // Push updated usage counts to the server immediately
  import("../services/usageSync").then((m) => m.triggerUsageSync()).catch(() => { });
}

export async function deleteCustomTheme(id: string): Promise<void> {
  // Delete from MongoDB API (source of truth) — skip if not authenticated
  if (getDeviceId()) {
    try {
      await deleteThemeFromAPI(id);
    } catch (err) {
      console.warn("[bibleDb] API delete failed, removing locally only:", err);
    }
  }

  // Always remove from local cache
  let deletedFromDb = false;
  try {
    const db = await getDb();
    await db.delete("themes", id);
    deletedFromDb = true;
  } catch (err) {
    console.warn("[bibleDb] Failed to delete custom theme from IndexedDB, falling back to localStorage:", err);
  }
  await deleteCustomThemeFromCentralDb(id);

  const deletedFromLocalStorage = removeCustomThemeFromLocalStorage(id);
  if (!deletedFromDb && !deletedFromLocalStorage) {
    throw new Error("Failed to delete custom theme");
  }

  // Write the Dock files first, then tell open Docks, so they read the new list.
  syncCustomThemesToDock()
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
    })
    .then(() => syncFavoriteBibleThemesToDock())
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync favorite Bible themes to dock:", err);
    })
    // The Dock opens with a saved copy of the theme chosen for Bible / Worship / Notes;
    // rewrite it so an edited theme is not shown with its old look.
    .then(() => import("../services/productionSettings").then((m) => m.syncProductionSettingsToDock()))
    .catch((err) => {
      console.warn("[bibleDb] Failed to sync production settings to dock:", err);
    })
    .then(() => notifyDockThemesChanged());

  // Push updated usage counts to the server immediately
  import("../services/usageSync").then((m) => m.triggerUsageSync()).catch(() => { });
}

export async function syncCustomThemesToDock(themes?: BibleTheme[]): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const payload = await serializeBibleThemesForDock(themes ?? await getCustomThemes());
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-bible-themes",
      data: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
  }
}

let installedTranslationsSyncPromise: Promise<void> | null = null;

export async function syncInstalledTranslationsToDock(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  if (installedTranslationsSyncPromise) return installedTranslationsSyncPromise;

  const syncPromise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const installed = await getInstalledTranslationsWithData();

      await invoke("save_dock_data", {
        name: "dock-bible-translations",
        data: JSON.stringify(installed.map(toInstalledBibleMetadata)),
      });

      for (const entry of installed) {
        await invoke("save_dock_data", {
          name: `dock-bible-translation-${entry.abbr.toLowerCase()}`,
          data: JSON.stringify(entry.data),
        });
      }
    } catch (err) {
      console.warn("[bibleDb] Failed to sync installed translations to dock:", err);
    }
  })();

  const wrappedPromise = syncPromise.finally(() => {
    if (installedTranslationsSyncPromise === wrappedPromise) {
      installedTranslationsSyncPromise = null;
    }
  });
  installedTranslationsSyncPromise = wrappedPromise;
  return wrappedPromise;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface BibleSettings {
  defaultTranslation: string;
  slideConfig: SlideConfig;
  activeThemeId: string;
  lastBook: string;
  lastChapter: number;
  lastVerse: number;
  /** UI colour mode: 'dark' | 'light' | 'system' */
  colorMode: "dark" | "light" | "system";
  /** Auto-send verse on double-click */
  autoSendOnDoubleClick: boolean;
  /** Font scale factor for UI (1 = default) */
  uiFontScale: number;
  /** Reduce motion / animations in the app UI */
  reduceMotion: boolean;
  /** High-contrast borders and text */
  highContrast: boolean;
}

const DEFAULT_SETTINGS: BibleSettings = {
  defaultTranslation: "KJV",
  slideConfig: DEFAULT_SLIDE_CONFIG,
  activeThemeId: "preset-royal-blue-glow", // DEFAULT_BUILTIN_THEME_ID
  lastBook: "John",
  lastChapter: 3,
  lastVerse: 1,
  colorMode: "dark",
  autoSendOnDoubleClick: true,
  uiFontScale: 1,
  reduceMotion: false,
  highContrast: false,
};

export async function getBibleSettings(): Promise<BibleSettings> {
  const db = await getDb();
  const uid = getCurrentUserId();
  const key = uid ? `${uid}_settings` : "settings";
  const settings = await db.get("settings", key);
  if (settings) return settings;
  // Fallback: try unscoped key for migration
  if (uid) {
    const legacy = await db.get("settings", "settings");
    if (legacy) {
      await db.put("settings", { ...legacy, userId: uid }, key);
      return legacy;
    }
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveBibleSettings(
  settings: Partial<BibleSettings>
): Promise<void> {
  const db = await getDb();
  const uid = getCurrentUserId();
  const key = uid ? `${uid}_settings` : "settings";
  const current = await getBibleSettings();
  await db.put("settings", { ...current, ...settings }, key);
}

// ---------------------------------------------------------------------------
// Downloaded Translations
// ---------------------------------------------------------------------------

/**
 * Get all installed / downloaded translations (metadata only — no data field).
 */
let installedTranslationsReadPromise: Promise<InstalledBible[]> | null = null;

async function getInstalledTranslationsWithData(): Promise<InstalledBible[]> {
  if (installedTranslationsReadPromise) return installedTranslationsReadPromise;

  const readPromise = (async () => {
    let legacyTranslations: InstalledBible[] = [];
    try {
      const db = await getDb();
      legacyTranslations = await db.getAll("translations") as InstalledBible[];
    } catch (err) {
      console.warn("[bibleDb] Failed to read Bible translations from legacy IndexedDB:", err);
    }

    const [centralTranslations, dockMetadata] = await Promise.all([
      readInstalledTranslationsFromCentralDb(),
      readInstalledTranslationMetadataFromDockData(),
    ]);

    // The dock metadata is tiny. Only load a translation's multi-megabyte JSON
    // when it is the newest copy or when the local databases do not have it.
    // This keeps opening the Bible library from materializing every translation
    // repeatedly, which can otherwise make WebKit retain gigabytes of RAM.
    const localTranslations = mergeInstalledBibles(legacyTranslations, centralTranslations);
    const localByAbbr = new Map(localTranslations.map((bible) => [bible.abbr, bible]));
    const dockByAbbr = new Map(dockMetadata.map((bible) => [bible.abbr, bible]));
    const allMetadata = mergeInstalledBibleMetadata(
      legacyTranslations.map(toInstalledBibleMetadata),
      centralTranslations.map(toInstalledBibleMetadata),
      dockMetadata,
    );

    const valid: InstalledBible[] = [];
    for (const metadata of allMetadata) {
      const local = localByAbbr.get(metadata.abbr);
      const dock = dockByAbbr.get(metadata.abbr);
      const localIsNewest = Boolean(
        local && (!dock || installedBibleTime(local) > installedBibleTime(dock)),
      );
      const bible = localIsNewest
        ? local
        : dock
          ? await readInstalledTranslationFromDockData(dock, dockMetadata)
          : local;

      if (!bible) continue;
      if (isCompleteBibleData(bible.data)) {
        valid.push({ ...bible, abbr: metadata.abbr });
        continue;
      }

      const stats = getBibleDataStats(bible.data);
      console.warn(
        `[bibleDb] Ignoring incomplete Bible translation ${bible.abbr} (${formatBibleDataStats(stats)}).`
      );
    }
    backfillInstalledTranslations(legacyTranslations, centralTranslations, valid).catch(() => { });
    return valid;
  })();

  installedTranslationsReadPromise = readPromise;
  try {
    return await readPromise;
  } finally {
    if (installedTranslationsReadPromise === readPromise) {
      installedTranslationsReadPromise = null;
    }
  }
}

/**
 * The OBS Dock's list: its own copies plus everything the app has installed (the shared
 * manifest). It never downloads a Bible's text just to list names. Anything only the Dock
 * has (downloaded here before the Dock shared them) is published so the app sees it too.
 */
async function getInstalledTranslationsForDock(): Promise<InstalledBibleMetadata[]> {
  let legacy: InstalledBible[] = [];
  try {
    const db = await getDb();
    legacy = await db.getAll("translations") as InstalledBible[];
  } catch {
    // IndexedDB can be unavailable in the OBS browser dock.
  }
  const central = await readInstalledTranslationsFromCentralDb();
  const ownCopies = mergeInstalledBibles(legacy, central).filter((bible) => isCompleteBibleData(bible.data));
  const shared = await readInstalledTranslationMetadataFromDockData();
  const sharedKeys = new Set(shared.map((entry) => entry.abbr));
  for (const bible of ownCopies) {
    if (!sharedKeys.has(bible.abbr)) void publishInstalledTranslationFromDock(bible);
  }
  return mergeInstalledBibleMetadata(ownCopies.map(toInstalledBibleMetadata), shared);
}

/** OBS Dock: share a Bible downloaded here with the app (data file first, then the manifest). */
export async function publishInstalledTranslationFromDock(bible: InstalledBible): Promise<void> {
  if (canLoadDockData() || !bible?.abbr) return;
  const key = getTranslationKey(bible.abbr);
  if (!(await postDockData(`dock-bible-translation-${key.toLowerCase()}`, bible.data))) return;
  const existing = (await fetchDockDataOverHttp<InstalledBibleMetadata[]>("dock-bible-translations")) ?? [];
  const next = mergeInstalledBibleMetadata(existing, [toInstalledBibleMetadata({ ...bible, abbr: key })]);
  await postDockData("dock-bible-translations", next);
}

/** OBS Dock: take a removed Bible out of the shared manifest. */
async function unpublishInstalledTranslationFromDock(abbr: string): Promise<void> {
  if (canLoadDockData()) return;
  const key = getTranslationKey(abbr);
  const existing = await fetchDockDataOverHttp<InstalledBibleMetadata[]>("dock-bible-translations");
  if (!existing) return;
  await postDockData("dock-bible-translations", existing.filter((entry) => getTranslationKey(entry.abbr) !== key));
}

let installedReconcileScheduled = false;

/**
 * The Dock's quick list on open: just the small shared list of installed Bibles. The full list reads
 * every installed Bible's text and checks every verse of each, which freezes the Dock for a long time
 * on a slower PC. That full check still runs, later and in the background, so nothing is lost.
 * Falls back to the full list when the shared list is empty.
 */
export async function getInstalledTranslationsFast(): Promise<InstalledBibleMetadata[]> {
  const shared = await readInstalledTranslationMetadataFromDockData();
  if (shared.length === 0) return getInstalledTranslations();
  if (!installedReconcileScheduled) {
    installedReconcileScheduled = true;
    setTimeout(() => {
      void getInstalledTranslations().catch(() => { });
    }, 10000);
  }
  return shared;
}

export async function getInstalledTranslations(): Promise<InstalledBibleMetadata[]> {
  if (!canLoadDockData()) return getInstalledTranslationsForDock();
  const installed = await getInstalledTranslationsWithData();
  return installed.map(toInstalledBibleMetadata);
}

/**
 * Get a specific installed translation including its full data.
 */
export async function getInstalledTranslation(
  abbr: string
): Promise<InstalledBible | undefined> {
  const key = getTranslationKey(abbr);
  let db: IDBPDatabase | null = null;
  let legacy: InstalledBible | undefined;
  try {
    db = await getDb();
    legacy = (await db.get("translations", key)) as InstalledBible | undefined;
    if (legacy && isCompleteBibleData(legacy.data)) {
      mirrorToCentralDbOnce(legacy);
      return { ...legacy, abbr: key };
    }
  } catch (err) {
    console.warn("[bibleDb] Failed to read Bible translation from legacy IndexedDB:", err);
  }

  const central = await getByKey<InstalledBible>(STORES.BIBLE_TRANSLATIONS, key).catch(() => undefined);
  if (central && isCompleteBibleData(central.data)) {
    db?.put("translations", { ...central, abbr: key }).catch(() => { });
    return { ...central, abbr: key };
  }

  const dock = await readInstalledTranslationFromDockData(key);
  if (dock) {
    // In the OBS Dock the shared file stays the single copy, so a Bible removed in the app does not linger here.
    if (canLoadDockData()) {
      db?.put("translations", { ...dock, abbr: key }).catch(() => { });
      writeInstalledTranslationToCentralDb(dock).catch(() => { });
    }
    return { ...dock, abbr: key };
  }

  const fallbackLegacy = key === abbr || !db ? undefined : (await db.get("translations", abbr)) as InstalledBible | undefined;
  if (fallbackLegacy && isCompleteBibleData(fallbackLegacy.data)) {
    const normalized = { ...fallbackLegacy, abbr: key };
    db?.put("translations", normalized).catch(() => { });
    writeInstalledTranslationToCentralDb(normalized).catch(() => { });
    return normalized;
  }

  return undefined;
}

/**
 * Get only the Bible data for an installed translation (for loading into memory).
 */
export async function getTranslationData(
  abbr: string
): Promise<RawBibleData | undefined> {
  const bible = await getInstalledTranslation(abbr);
  return bible?.data;
}

/**
 * Save a fully downloaded + parsed Bible into IndexedDB.
 */
export async function saveInstalledTranslation(
  bible: InstalledBible
): Promise<void> {
  assertCompleteBibleData(bible.data, bible.abbr);
  const normalized = { ...bible, abbr: getTranslationKey(bible.abbr) };
  try {
    const db = await getDb();
    await db.put("translations", normalized);
  } catch (err) {
    console.warn("[bibleDb] Failed to save Bible translation to legacy IndexedDB:", err);
  }
  await writeInstalledTranslationToCentralDb(normalized);
  syncInstalledTranslationsToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync installed translations after save:", err);
  });
  // In the OBS Dock there is no Tauri: share it over the local server instead.
  await publishInstalledTranslationFromDock(normalized);
}

/**
 * Delete a downloaded translation.
 */
export async function deleteInstalledTranslation(
  abbr: string
): Promise<void> {
  const key = getTranslationKey(abbr);
  try {
    const db = await getDb();
    await db.delete("translations", key);
    if (key !== abbr) {
      await db.delete("translations", abbr);
    }
  } catch (err) {
    console.warn("[bibleDb] Failed to delete Bible translation from legacy IndexedDB:", err);
  }
  await deleteInstalledTranslationFromCentralDb(abbr);
  syncInstalledTranslationsToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync installed translations after delete:", err);
  });
  await unpublishInstalledTranslationFromDock(key);
}

/**
 * Check if a translation is already installed.
 */
export async function isTranslationInstalled(
  abbr: string
): Promise<boolean> {
  return !!(await getInstalledTranslation(abbr));
}

// ---------------------------------------------------------------------------
// First-Run Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if this is the very first time the app is running
 * (no translations have ever been downloaded).
 */
export async function isFirstRun(): Promise<boolean> {
  const installed = await getInstalledTranslations();
  return installed.length === 0;
}
