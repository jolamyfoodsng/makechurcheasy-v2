/**
 * cloudSyncService.ts — Cloud Backup & Synchronization Service
 *
 * Provides atomic snapshot export, cloud upload, remote fetching,
 * and seamless multi-device restoration for:
 *  - Worship Songs & Lyric Catalogs
 *  - Broadcast Profiles, Channels & Stream Credentials
 *  - Preacher Notes & Scripture Captures
 *  - Church Branding & Layout Settings
 *  - Custom Bible Themes & Preferences
 *  - Optional Media Library Asset Metadata
 *
 * Entitlement: Basic, Growth, and higher tiers.
 */

import { openDB } from "idb";
import { clearAllSongs, getAllSongs, restoreSongsFromCloud } from "../worship/worshipDb";
import type { Song } from "../worship/types";
import {
  loadBroadcastStore,
  saveBroadcastStore,
  type BroadcastStoreState,
} from "./broadcastSettingsService";
import {
  loadDockNotes,
  saveDockNotes,
  loadDockNotesPreferences,
  saveDockNotesPreferences,
  type DockNote,
  type DockNotesPreferences,
} from "../dock/dockNotesStorage";
import * as db from "../multiview/mvStore";
import type { MVSettings as MVSettingsType } from "../multiview/mvStore";
import { getCurrentUser, getDeviceId } from "./authService";
import { canUseCloudSync, getUserPlan } from "./licenseService";
import { getUserScopedKey, readUserScopedStorage } from "./userScopedStorage";
import { getAllMedia, saveMedia } from "../library/libraryDb";
import {
  loadSavedBroadcastGraphics,
  restoreSavedBroadcastGraphics,
  type SavedBroadcastGraphic,
} from "./broadcastGraphicsStorage";
import {
  cloudFetch,
  collectBackupFiles,
  downloadBackupFiles,
  fetchCloudStorageUsage,
  rebaseUploadUrl,
  uploadBackupFiles,
  type FileBackupResult,
  type CloudStorageUsage,
} from "./cloudBackupFiles";
import { getOverlayBaseUrl } from "./overlayUrl";
import type { MediaItem } from "../library/libraryTypes";

// ── Events & Keys ───────────────────────────────────────────────────────────

export const CLOUD_SYNC_STATUS_CHANGED_EVENT = "mce-cloud-sync-status-changed";
export const CLOUD_SYNC_AUTO_KEY = "mce_cloud_sync_auto";
export const CLOUD_SYNC_INCLUDE_MEDIA_KEY = "mce_cloud_sync_include_media";
export const CLOUD_SYNC_DEVICE_NAME_KEY = "mce_cloud_sync_device_name";
export const CLOUD_SYNC_LAST_INFO_KEY = "mce_cloud_sync_last_info";
export const CLOUD_SYNC_FREQUENCY_KEY = "mce_cloud_sync_frequency";
export const CLOUD_SYNC_INCLUDE_IMAGES_KEY = "mce_cloud_sync_include_images";
export const CLOUD_SYNC_INCLUDE_VIDEOS_KEY = "mce_cloud_sync_include_videos";
export const CLOUD_SYNC_DEVICE_HANDLED_KEY = "mce_cloud_sync_device_handled";
const LOCAL_MOCK_CLOUD_STORAGE_KEY = "mce_cloud_sync_snapshot_cache";

// Proactively clear any oversized legacy keys from localStorage to prevent "Quota exceeded" DOMExceptions
if (typeof localStorage !== "undefined") {
  try {
    localStorage.removeItem(LOCAL_MOCK_CLOUD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const CLOUD_CACHE_DB_NAME = "mce-cloud-sync-cache";
const CLOUD_CACHE_STORE = "snapshots";

// Memory cache fallback for tests or environments without IndexedDB
const memorySnapshotCache = new Map<string, CloudSyncSnapshot>();

async function getCloudCacheDb() {
  if (typeof indexedDB === "undefined") return null;
  try {
    return await openDB(CLOUD_CACHE_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CLOUD_CACHE_STORE)) {
          db.createObjectStore(CLOUD_CACHE_STORE);
        }
      },
    });
  } catch {
    return null;
  }
}

/**
 * Cache snapshot in IndexedDB (virtually unlimited quota),
 * never in localStorage which has a strict ~5MB limit that causes
 * "The quota has been exceeded" DOMExceptions.
 */
async function cacheSnapshotLocally(snapshot: CloudSyncSnapshot): Promise<void> {
  const cacheKey = getUserScopedKey(LOCAL_MOCK_CLOUD_STORAGE_KEY);
  memorySnapshotCache.set(cacheKey, snapshot);

  // Proactively purge any oversized legacy keys from localStorage to reclaim quota immediately
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(LOCAL_MOCK_CLOUD_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  try {
    const db = await getCloudCacheDb();
    if (db) {
      await db.put(CLOUD_CACHE_STORE, snapshot, cacheKey);
    }
  } catch (err) {
    console.warn("[CloudSync] Failed to cache snapshot in IndexedDB:", err);
  }
}

/**
 * Retrieve cached snapshot from IndexedDB, memory, or legacy storage.
 */
async function getCachedLocalSnapshot(): Promise<CloudSyncSnapshot | null> {
  const cacheKey = getUserScopedKey(LOCAL_MOCK_CLOUD_STORAGE_KEY);

  // 1. Try IndexedDB
  try {
    const db = await getCloudCacheDb();
    if (db) {
      const snap = await db.get(CLOUD_CACHE_STORE, cacheKey);
      if (snap) return snap as CloudSyncSnapshot;
    }
  } catch {
    // fallback
  }

  // 2. Try memory
  if (memorySnapshotCache.has(cacheKey)) {
    return memorySnapshotCache.get(cacheKey) || null;
  }

  // 3. Fallback: check legacy localStorage key, parse and immediately purge from localStorage
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        localStorage.removeItem(cacheKey); // Clean up immediately to restore quota
        return parsed as CloudSyncSnapshot;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface CloudSyncManifest {
  version: 1;
  snapshotId: string;
  createdAt: string;
  userId: string;
  userEmail?: string;
  churchName?: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  counts: {
    worshipSongs: number;
    broadcastProfiles: number;
    broadcastChannels: number;
    notesCount: number;
    mediaCount: number;
    graphicsCount?: number;
    hasBranding: boolean;
    hasSettings: boolean;
  };
}

export interface CloudSyncSnapshot {
  manifest: CloudSyncManifest;
  data: {
    worship: {
      songs: Song[];
    };
    broadcast: {
      storeState: BroadcastStoreState;
    };
    notes: {
      items: DockNote[];
      preferences?: DockNotesPreferences | null;
    };
    settings: {
      mvSettings: Partial<MVSettingsType>;
      customThemes?: string | null;
      /** The logo picked in Studio settings (a picture, as a data URL). */
      studioLogoData?: string;
    };
    media?: {
      items: MediaItem[];
    };
    graphics?: {
      items: SavedBroadcastGraphic[];
    };
  };
}

export type BackupFrequency = "off" | "daily" | "weekly" | "monthly";

export type SyncState = "idle" | "syncing" | "success" | "error";

export interface CloudSyncStatusInfo {
  state: SyncState;
  lastSyncedAt: string | null;
  lastSyncedDevice: string | null;
  lastSnapshotId: string | null;
  counts?: CloudSyncManifest["counts"] | null;
  storageUsedBytes: number;
  storageLimitGB: number;
  autoSyncEnabled: boolean;
  includeMediaEnabled: boolean;
  backupFrequency: BackupFrequency;
  includeImages: boolean;
  includeVideos: boolean;
  /** Real usage from the server (null when offline or not on a paid plan). */
  usage: CloudStorageUsage | null;
  nextBackupAt: string | null;
  /** Nothing has changed since the last complete backup. */
  upToDate: boolean;
  deviceName: string;
  error?: string | null;
}

export interface RestoreOptions {
  mode: "merge" | "replace";
  includeWorship?: boolean;
  includeBroadcast?: boolean;
  includeNotes?: boolean;
  includeSettings?: boolean;
  includeMedia?: boolean;
  includeGraphics?: boolean;
  /** Also download the backed-up pictures/videos into the app folder. */
  includeFiles?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface RestoreResult {
  success: boolean;
  restoredCounts: {
    worshipSongs: number;
    broadcastProfiles: number;
    notesCount: number;
    mediaCount: number;
    graphicsCount?: number;
    filesCount?: number;
  };
  restoredAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function notifyStatusChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_STATUS_CHANGED_EVENT));
}

// ── User Preference Accessors ───────────────────────────────────────────────

export function isAutoSyncEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(getUserScopedKey(CLOUD_SYNC_AUTO_KEY));
  if (raw === null) return true; // Default ON
  return raw === "true";
}

export function setAutoSyncEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_AUTO_KEY), String(enabled));
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

export function isIncludeMediaEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_MEDIA_KEY));
  return raw === "true"; // Default OFF to prioritize instant text sync
}

export function setIncludeMediaEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_MEDIA_KEY), String(enabled));
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

const FREQUENCIES: BackupFrequency[] = ["off", "daily", "weekly", "monthly"];

/** How often the app backs up by itself (like WhatsApp). Default: weekly. */
export function getBackupFrequency(): BackupFrequency {
  if (typeof localStorage === "undefined") return "weekly";
  const raw = localStorage.getItem(getUserScopedKey(CLOUD_SYNC_FREQUENCY_KEY));
  if (raw && (FREQUENCIES as string[]).includes(raw)) return raw as BackupFrequency;
  // People who had turned automatic sync off keep it off.
  if (localStorage.getItem(getUserScopedKey(CLOUD_SYNC_AUTO_KEY)) === "false") return "off";
  return "weekly";
}

export function setBackupFrequency(frequency: BackupFrequency): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_FREQUENCY_KEY), frequency);
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_AUTO_KEY), String(frequency !== "off"));
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

/** Pictures are part of the backup unless the user turns them off. */
export function isIncludeImagesEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_IMAGES_KEY)) !== "false";
}

export function setIncludeImagesEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_IMAGES_KEY), String(enabled));
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

/** Videos are big, so they are only backed up when the user asks. */
export function isIncludeVideosEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_VIDEOS_KEY)) === "true";
}

export function setIncludeVideosEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_INCLUDE_VIDEOS_KEY), String(enabled));
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

export function getSyncDeviceName(): string {
  if (typeof localStorage === "undefined") return "Primary Media PC";
  const stored = localStorage.getItem(getUserScopedKey(CLOUD_SYNC_DEVICE_NAME_KEY));
  if (stored?.trim()) return stored.trim();

  // Generate a friendly initial name based on OS/platform
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    if (/mac/i.test(navigator.userAgent)) return "Main Mac Media Laptop";
    if (/win/i.test(navigator.userAgent)) return "Church Broadcast PC";
  }
  return "Media Workstation";
}

export function setSyncDeviceName(name: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_DEVICE_NAME_KEY), name.trim());
  } catch {
    // ignore quota error
  }
  notifyStatusChanged();
}

type StoredSyncInfo = Partial<CloudSyncStatusInfo> & { lastFingerprint?: string };

function getLastSavedSyncInfo(): StoredSyncInfo {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(getUserScopedKey(CLOUD_SYNC_LAST_INFO_KEY));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistLastSyncInfo(info: StoredSyncInfo): void {
  if (typeof localStorage === "undefined") return;
  try {
    const prev = getLastSavedSyncInfo();
    const updated = { ...prev, ...info };
    localStorage.setItem(getUserScopedKey(CLOUD_SYNC_LAST_INFO_KEY), JSON.stringify(updated));
  } catch {
    // ignore
  }
}

// ── In-Memory State ─────────────────────────────────────────────────────────

let currentSyncState: SyncState = "idle";
let lastSyncError: string | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastFileResult: FileBackupResult | null = null;

/** What happened to the pictures/videos in the last backup (for the settings screen). */
export function getLastFileBackupResult(): FileBackupResult | null {
  return lastFileResult;
}

// ── "Is everything already backed up?" ──────────────────────────────────────

function hashString(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}-${text.length.toString(36)}`;
}

/** A short code for "what a backup would contain right now" (content and the list of files). */
function fingerprintOf(data: CloudSyncSnapshot["data"], files: Array<{ fileKey: string; sizeBytes: number }>): string {
  const fileList = files.map((f) => `${f.fileKey}:${f.sizeBytes}`).sort().join("|");
  return hashString(JSON.stringify(data) + "#" + fileList);
}

async function currentFingerprint(): Promise<string> {
  const snapshot = await createLocalSnapshot();
  const files = await collectBackupFiles({
    includeImages: isIncludeImagesEnabled(),
    includeVideos: isIncludeVideosEnabled(),
  }).catch(() => []);
  return fingerprintOf(snapshot.data, files);
}

/** True when nothing changed since the last backup that finished completely. */
export async function isBackedUpToDate(): Promise<boolean> {
  const saved = getLastSavedSyncInfo().lastFingerprint;
  if (!saved) return false;
  try {
    return (await currentFingerprint()) === saved;
  } catch {
    return false;
  }
}

// ── Snapshot Creation ───────────────────────────────────────────────────────

/**
 * Creates an atomic local snapshot containing all user assets.
 */
export async function createLocalSnapshot(options: {
  deviceName?: string;
  includeMedia?: boolean;
  includeImages?: boolean;
  includeVideos?: boolean;
} = {}): Promise<CloudSyncSnapshot> {
  const user = getCurrentUser();
  const deviceId = getDeviceId() || "device-local";
  const deviceName = options.deviceName || getSyncDeviceName();
  const includeImages = options.includeImages ?? isIncludeImagesEnabled();
  const includeVideos = options.includeVideos ?? isIncludeVideosEnabled();
  const includeMedia = options.includeMedia ?? (includeImages || includeVideos || isIncludeMediaEnabled());

  // 1. Worship songs
  const songs = await getAllSongs().catch(() => []);

  // 2. Broadcast profiles and credentials
  const broadcastState = loadBroadcastStore();

  // 3. Preacher notes & preferences
  const notes = loadDockNotes();
  const notesPrefs = loadDockNotesPreferences();

  // 4. Branding & General settings
  const mvSettings = db.getSettings();
  const sanitizedMvSettings: Partial<MVSettingsType> = {
    churchName: mvSettings.churchName,
    mainPastorName: mvSettings.mainPastorName,
    brandColor: mvSettings.brandColor,
    brandSecondaryColor: mvSettings.brandSecondaryColor,
    brandAccentColor: mvSettings.brandAccentColor,
    brandFontFamily: mvSettings.brandFontFamily,
    brandLogoPath: mvSettings.brandLogoPath,
    pastorSpeakers: mvSettings.pastorSpeakers,
    sermonSeries: mvSettings.sermonSeries,
    sermonTitle: mvSettings.sermonTitle,
    sermonSpeaker: mvSettings.sermonSpeaker,
    obsUrl: mvSettings.obsUrl,
  };

  const customThemes = readUserScopedStorage("ocs-bible-custom-themes");
  let studioLogoData = "";
  try {
    const { getOverlayBaseUrl } = await import("./overlayUrl");
    const { readStudioLogoForBackup } = await import("../studio/studioPrefs");
    studioLogoData = await readStudioLogoForBackup(await getOverlayBaseUrl());
  } catch {
    // No Studio logo to back up.
  }

  // 5. Optional Media items metadata
  let mediaItems: MediaItem[] = [];
  if (includeMedia) {
    const all = await getAllMedia().catch(() => [] as MediaItem[]);
    // Only the kinds the user chose, without big inline previews (the files travel separately).
    mediaItems = all
      .filter((m) => (m.type === "image" ? includeImages : m.type === "video" ? includeVideos : false))
      .map((m) => ({
        ...m,
        url: /^data:/i.test(m.url || "") ? "" : m.url,
        thumbnailUrl: /^data:/i.test(m.thumbnailUrl || "") ? undefined : m.thumbnailUrl,
      }));
  }

  // 6. Saved broadcast graphics
  const graphics = loadSavedBroadcastGraphics();

  const broadcastChannelCount = broadcastState.profiles.reduce(
    (acc, p) => acc + (p.channels ? p.channels.length : 0),
    0
  );

  const manifest: CloudSyncManifest = {
    version: 1,
    snapshotId: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    userId: user?.id || "anonymous",
    userEmail: user?.email,
    churchName: user?.churchName || mvSettings.churchName,
    deviceId,
    deviceName,
    appVersion: "1.0.0",
    counts: {
      worshipSongs: songs.length,
      broadcastProfiles: broadcastState.profiles.length,
      broadcastChannels: broadcastChannelCount,
      notesCount: notes.length,
      mediaCount: mediaItems.length,
      graphicsCount: graphics.length,
      hasBranding: Boolean(mvSettings.churchName || mvSettings.brandColor),
      hasSettings: true,
    },
  };

  return {
    manifest,
    data: {
      worship: {
        songs,
      },
      broadcast: {
        storeState: broadcastState,
      },
      notes: {
        items: notes,
        preferences: notesPrefs,
      },
      settings: {
        mvSettings: sanitizedMvSettings,
        customThemes,
        ...(studioLogoData ? { studioLogoData } : {}),
      },
      ...(includeMedia ? { media: { items: mediaItems } } : {}),
      graphics: { items: graphics },
    },
  };
}

// ── Snapshot Restoration ────────────────────────────────────────────────────

/**
 * Restores a snapshot into local IndexedDB and localStorage stores.
 */
export async function restoreSnapshot(
  snapshot: CloudSyncSnapshot,
  options: RestoreOptions = { mode: "merge" }
): Promise<RestoreResult> {
  const { data, manifest } = snapshot;
  const restoredCounts = {
    worshipSongs: 0,
    broadcastProfiles: 0,
    notesCount: 0,
    mediaCount: 0,
    graphicsCount: 0,
    filesCount: 0,
  };

  // 0. Pictures/videos first, so the items below can point at them.
  let restoredFiles: Awaited<ReturnType<typeof downloadBackupFiles>> = [];
  if (options.includeFiles) {
    restoredFiles = await downloadBackupFiles(options.onProgress).catch((err) => {
      console.warn("[CloudSync] Could not download backed-up files:", err);
      return [];
    });
    restoredCounts.filesCount = restoredFiles.length;
  }
  const overlayBase = await getOverlayBaseUrl().catch(() => "");
  const fileByName = new Map(restoredFiles.map((f) => [f.name, f]));

  // 1. Restore Worship Songs
  if (options.includeWorship !== false && data.worship?.songs) {
    if (options.mode === "replace") {
      // Clear before adding
      await clearAllSongs().catch(() => {});
    }
    await restoreSongsFromCloud(data.worship.songs);
    restoredCounts.worshipSongs = data.worship.songs.length;
  }

  // 2. Restore Broadcast Profiles & Channels
  if (options.includeBroadcast !== false && data.broadcast?.storeState) {
    saveBroadcastStore(data.broadcast.storeState);
    restoredCounts.broadcastProfiles = data.broadcast.storeState.profiles.length;
  }

  // 3. Restore Notes & Sermon Sessions
  if (options.includeNotes !== false && data.notes?.items) {
    if (options.mode === "merge") {
      const existing = loadDockNotes();
      const existingById = new Map(existing.map((n) => [n.id, n]));
      const newItems = data.notes.items.filter((n) => !existingById.has(n.id));
      // A note in both copies keeps whichever version was edited last.
      const backupById = new Map(data.notes.items.map((n) => [n.id, n]));
      const kept = existing.map((n) => {
        const backup = backupById.get(n.id);
        return backup && (backup.updatedAt ?? 0) > (n.updatedAt ?? 0) ? backup : n;
      });
      saveDockNotes([...newItems, ...kept]);
      restoredCounts.notesCount = newItems.length + kept.length;
    } else {
      saveDockNotes(data.notes.items);
      restoredCounts.notesCount = data.notes.items.length;
    }

    if (data.notes.preferences) {
      saveDockNotesPreferences(data.notes.preferences);
    }
  }

  // 4. Restore Settings & Branding
  if (options.includeSettings !== false && data.settings?.mvSettings) {
    db.updateSettings(data.settings.mvSettings);
    if (data.settings.studioLogoData) {
      try {
        const { saveStudioLogo } = await import("../studio/studioPrefs");
        const url = await saveStudioLogo(data.settings.studioLogoData);
        if (url) {
          try { localStorage.setItem("mce.studio.logoOverride.v1", url); } catch { /* the file is the source of truth */ }
        }
      } catch {
        // The logo could not be restored.
      }
    }
    if (data.settings.customThemes && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(
          getUserScopedKey("ocs-bible-custom-themes"),
          data.settings.customThemes
        );
      } catch {
        // ignore quota failure
      }
    }
  }

  // 5. Restore Media Items
  if ((options.includeMedia || options.includeFiles) && data.media?.items) {
    for (const item of data.media.items) {
      const arrived = item.diskFileName ? fileByName.get(item.diskFileName) : undefined;
      const fixed: MediaItem = arrived && overlayBase
        ? { ...item, url: `${overlayBase}/uploads/${encodeURIComponent(arrived.name)}`, filePath: arrived.filePath }
        : item;
      await saveMedia(fixed).catch(() => {});
    }
    restoredCounts.mediaCount = data.media.items.length;
  }

  // 6. Restore saved broadcast graphics (pictures re-pointed at this computer)
  if (options.includeGraphics !== false && data.graphics?.items) {
    const items = overlayBase
      ? data.graphics.items.map((g) => ({
          ...g,
          variables: Object.fromEntries(
            Object.entries(g.variables || {}).map(([k, v]) => [k, typeof v === "string" ? rebaseUploadUrl(v, overlayBase) : v]),
          ),
        }))
      : data.graphics.items;
    restoredCounts.graphicsCount = restoreSavedBroadcastGraphics(items, options.mode);
  }

  const restoredAt = new Date().toISOString();
  markDeviceHandled();
  persistLastSyncInfo({
    lastSyncedAt: restoredAt,
    lastSyncedDevice: manifest.deviceName,
    lastSnapshotId: manifest.snapshotId,
    counts: manifest.counts,
    state: "success",
  });

  notifyStatusChanged();

  return {
    success: true,
    restoredCounts,
    restoredAt,
  };
}

// ── Cloud API Operations ────────────────────────────────────────────────────

/**
 * Uploads current local snapshot to the cloud storage engine.
 */
export async function uploadSnapshotToCloud(
  onProgress?: (done: number, total: number) => void,
): Promise<{
  success: boolean;
  snapshotId: string;
  error?: string;
  files?: FileBackupResult;
}> {
  const user = getCurrentUser();
  if (!canUseCloudSync(user)) {
    throw new Error(
      "Cloud Sync requires a Basic or Growth plan. Please upgrade to enable multi-device sync."
    );
  }

  currentSyncState = "syncing";
  lastSyncError = null;
  notifyStatusChanged();

  try {
    const snapshot = await createLocalSnapshot();
    // Send the text backup. Any failure is reported, never hidden.
    const res = await cloudFetch("/api/cloud-sync/backup", {
      method: "POST",
      body: JSON.stringify({
        data: snapshot,
        categories: Object.keys(snapshot.data),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 413 || body?.code === "storage_full") {
        throw new Error("Your cloud storage is full. Remove something or upgrade your plan, then try again.");
      }
      if (res.status === 403) {
        throw new Error("Cloud backup needs a Basic or Growth plan.");
      }
      if (res.status === 401) {
        throw new Error("Please sign in again to back up to the cloud.");
      }
      throw new Error(body?.error || `Backup failed (${res.status}).`);
    }

    // Pictures (and videos, if turned on) go as separate files.
    let files: FileBackupResult = { uploaded: 0, alreadyThere: 0, failed: 0, storageFull: false };
    let candidates: Awaited<ReturnType<typeof collectBackupFiles>> = [];
    let filesOk = true;
    try {
      candidates = await collectBackupFiles({
        includeImages: isIncludeImagesEnabled(),
        includeVideos: isIncludeVideosEnabled(),
      });
      files = await uploadBackupFiles(candidates, onProgress);
      filesOk = files.failed === 0 && !files.storageFull;
    } catch (err) {
      console.warn("[CloudSync] File backup skipped:", err);
      filesOk = false;
    }
    lastFileResult = files;

    // Cache snapshot locally in IndexedDB (quota-safe, never in localStorage)
    await cacheSnapshotLocally(snapshot);

    currentSyncState = "success";
    lastSyncError = null;

    persistLastSyncInfo({
      state: "success",
      lastSyncedAt: snapshot.manifest.createdAt,
      lastSyncedDevice: snapshot.manifest.deviceName,
      lastSnapshotId: snapshot.manifest.snapshotId,
      counts: snapshot.manifest.counts,
      // Remember what was backed up only when everything went through, so a retry sends the rest.
      lastFingerprint: filesOk ? fingerprintOf(snapshot.data, candidates) : "",
    });

    notifyStatusChanged();

    markDeviceHandled();
    return {
      success: true,
      snapshotId: snapshot.manifest.snapshotId,
      files,
    };
  } catch (err: unknown) {
    currentSyncState = "error";
    lastSyncError = err instanceof Error ? err.message : "Sync upload failed";
    persistLastSyncInfo({ state: "error" });
    notifyStatusChanged();
    throw err;
  }
}

/**
 * Fetches the latest available snapshot from the cloud.
 */
export async function fetchLatestCloudSnapshot(): Promise<CloudSyncSnapshot | null> {
  const user = getCurrentUser();
  if (!canUseCloudSync(user)) {
    return null;
  }

  try {
    const backupRes = await cloudFetch("/api/cloud-sync/backup", { method: "GET" });
    if (backupRes.ok) {
      const json = await backupRes.json();
      if (json?.backup?.data?.manifest) {
        return json.backup.data as CloudSyncSnapshot;
      }
      if (json?.data?.manifest) {
        return json.data as CloudSyncSnapshot;
      }
      // The cloud answered and holds nothing: do not invent a backup from the local cache.
      if (json?.backup === null) return null;
    }
  } catch {
    // Cloud unreachable, fall back to the local cache below
  }

  // Fallback to quota-safe local snapshot cache (IndexedDB/memory)
  return await getCachedLocalSnapshot();
}

/** Storage per plan (Free 500 MB, Basic 5 GB, Growth 20 GB); the server enforces the same numbers. */
export function getCloudStorageLimitBytes(plan: string): number {
  const GB = 1024 * 1024 * 1024;
  if (plan === "growth" || plan === "pro" || plan === "ambassador" || plan === "unlimited") return 20 * GB;
  if (plan === "basic" || plan === "trial") return 5 * GB;
  return 500 * 1024 * 1024;
}

const FREQUENCY_MS: Record<Exclude<BackupFrequency, "off">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** When the next automatic backup is due (null when automatic backup is off). */
export function getNextBackupAt(): string | null {
  const frequency = getBackupFrequency();
  if (frequency === "off") return null;
  const last = getLastSavedSyncInfo().lastSyncedAt;
  const lastMs = last ? Date.parse(last) : 0;
  return new Date((Number.isFinite(lastMs) ? lastMs : 0) + FREQUENCY_MS[frequency]).toISOString();
}

export function isBackupDue(now = Date.now()): boolean {
  const next = getNextBackupAt();
  return next !== null && Date.parse(next) <= now;
}

/**
 * Gets aggregated status of Cloud Sync for UI indicators and settings.
 */
export async function fetchCloudSyncStatus(): Promise<CloudSyncStatusInfo> {
  const user = getCurrentUser();
  const plan = getUserPlan(user);
  const lastInfo = getLastSavedSyncInfo();

  const { usage } = canUseCloudSync(user) ? await fetchCloudStorageUsage() : { usage: null };
  const storageLimitBytes = usage?.limitBytes ?? getCloudStorageLimitBytes(plan);

  return {
    state: currentSyncState,
    lastSyncedAt: lastInfo.lastSyncedAt || null,
    lastSyncedDevice: lastInfo.lastSyncedDevice || null,
    lastSnapshotId: lastInfo.lastSnapshotId || null,
    counts: lastInfo.counts || null,
    storageUsedBytes: usage?.usedBytes ?? 0,
    storageLimitGB: storageLimitBytes / (1024 * 1024 * 1024),
    autoSyncEnabled: isAutoSyncEnabled(),
    includeMediaEnabled: isIncludeMediaEnabled(),
    backupFrequency: getBackupFrequency(),
    includeImages: isIncludeImagesEnabled(),
    includeVideos: isIncludeVideosEnabled(),
    usage,
    nextBackupAt: getNextBackupAt(),
    upToDate: await isBackedUpToDate(),
    deviceName: getSyncDeviceName(),
    error: lastSyncError,
  };
}

// ── Scheduled backup (Daily / Weekly / Monthly) ─────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let backupRunning = false;

async function runBackupIfDue(): Promise<void> {
  const user = getCurrentUser();
  if (backupRunning || !canUseCloudSync(user) || !isBackupDue()) return;
  backupRunning = true;
  try {
    if (await isBackedUpToDate()) {
      // Nothing changed: no upload needed, just count this as checked.
      persistLastSyncInfo({ lastSyncedAt: new Date().toISOString() });
      notifyStatusChanged();
      return;
    }
    await uploadSnapshotToCloud();
  } catch (err) {
    console.warn("[CloudSync] Scheduled backup failed:", err);
  } finally {
    backupRunning = false;
  }
}

/** Start the scheduler: checks shortly after start and then every 30 minutes. Safe to call twice. */
export function startCloudBackupScheduler(): void {
  if (schedulerTimer || typeof window === "undefined") return;
  setTimeout(() => void runBackupIfDue(), 60_000);
  schedulerTimer = setInterval(() => void runBackupIfDue(), 30 * 60_000);
}

export function stopCloudBackupScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

/**
 * Kept for existing callers. Backups now follow the schedule chosen in Settings
 * (and "Back up now"), so a data change no longer starts one by itself.
 */
export function triggerDebouncedAutoSync(): void {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
}

// ── New device ──────────────────────────────────────────────────────────────

function handledKey(): string {
  return getUserScopedKey(CLOUD_SYNC_DEVICE_HANDLED_KEY);
}

/** This computer has been backed up from, restored to, or told to skip the offer. */
export function markDeviceHandled(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(handledKey(), new Date().toISOString());
  } catch {
    // ignore
  }
}

export interface NewDeviceOffer {
  updatedAt: string | null;
  fromDeviceName: string | null;
  sizeBytes: number;
}

/**
 * After sign-in on a computer that has never backed up or restored for this account:
 * is there a cloud backup from another device to offer? Returns null when there is nothing to offer.
 */
export async function checkNewDeviceOffer(): Promise<NewDeviceOffer | null> {
  if (typeof localStorage === "undefined") return null;
  const user = getCurrentUser();
  if (!user || !canUseCloudSync(user)) return null;
  if (localStorage.getItem(handledKey())) return null;

  const { backup } = await fetchCloudStorageUsage();
  if (!backup?.exists) return null;
  if (backup.deviceId && backup.deviceId === getDeviceId()) {
    markDeviceHandled();
    return null;
  }
  return {
    updatedAt: backup.updatedAt || null,
    fromDeviceName: backup.deviceName || null,
    sizeBytes: backup.sizeBytes || 0,
  };
}
