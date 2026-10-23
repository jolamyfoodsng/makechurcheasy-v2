/**
 * desktopConfig.ts — Fetches desktop bootstrap configuration from the API.
 *
 * Follows the same caching pattern as planConfig.ts:
 * - Serves from cache if fresh (5 min TTL)
 * - Stale-while-revalidate: serves cache, refreshes in background
 * - Uses the authenticated license heartbeat when a device is paired so one
 *   response also carries license, health, and announcements
 * - Falls back to the public config endpoint and DEFAULT_DESKTOP_CONFIG when offline
 * - Deduplicates concurrent fetches via module-level promise
 */

import {
  DEFAULT_DESKTOP_ADMIN_CONTROLS,
  DEFAULT_DESKTOP_CONFIG,
  type DesktopAdminControls,
  type DesktopConfig,
  type DesktopFeatureSwitch,
} from "./desktopConfigTypes";
import { noteServerTime } from "./trustedClock";
import { APP_VERSION, getDeviceApiBaseCandidates, getDeviceId, getDeviceSecret } from "./authService";
import type { DesktopAnnouncement, ActiveDiscountInfo } from "./announcementService";
import { normalizeSupportContent } from "./supportContent";

// Re-export for backward compatibility
export type { DesktopConfig, ActiveDiscountInfo };
export { DEFAULT_DESKTOP_CONFIG };

const API_BASE = import.meta.env.VITE_AUTH_API_URL || "https://api.makechurcheazy.com";
const CACHE_KEY = "mce_desktop_config";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface DesktopBootstrapResponse {
  health?: { status?: string };
  license?: unknown;
  config?: DesktopConfig | null;
  /** First of `announcements`; kept for app code that shows a single one. */
  announcement?: DesktopAnnouncement | null;
  /** Everything the user should be paged through right now (newer API). */
  announcements?: DesktopAnnouncement[];
  nextAvailableAt?: string | null;
}

interface BootstrapCacheEntry {
  response: DesktopBootstrapResponse;
  deviceId: string;
  fetchedAt: number;
}

const BOOTSTRAP_CACHE_TTL_MS = 30 * 1000;
let bootstrapCache: BootstrapCacheEntry | null = null;
let bootstrapListeners: Array<(announcement: DesktopAnnouncement | null) => void> = [];
let announcementListListeners: Array<(announcements: DesktopAnnouncement[]) => void> = [];

function announcementsOf(response: DesktopBootstrapResponse): DesktopAnnouncement[] {
  if (Array.isArray(response.announcements)) return response.announcements;
  return response.announcement ? [response.announcement] : [];
}

function notifyAnnouncementListeners(announcements: DesktopAnnouncement[]): void {
  const first = announcements[0] ?? null;
  for (const listener of bootstrapListeners) {
    try {
      listener(first);
    } catch {
      // A listener must not interrupt the caller.
    }
  }
  for (const listener of announcementListListeners) {
    try {
      listener(announcements);
    } catch {
      // A listener must not interrupt the caller.
    }
  }
}

// ── Cache helpers ────────────────────────────────────────────────────────────

interface CacheEntry {
  config: DesktopConfig;
  fetchedAt: number;
}

function readCacheEntry(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS * 10) return null; // expired after 50 min
    return entry;
  } catch {
    return null;
  }
}

function readCache(): DesktopConfig | null {
  return readCacheEntry()?.config ?? null;
}

/**
 * Synchronous cache reader. Returns cached config or null.
 * Used by modules that need config synchronously (e.g., entitlement checks).
 */
export function readDesktopConfigCache(): DesktopConfig | null {
  return readCache();
}

function writeCache(config: DesktopConfig): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ config, fetchedAt: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export function cacheDesktopBootstrap(
  response: DesktopBootstrapResponse,
  deviceId = getDeviceId() || "",
): void {
  bootstrapCache = { response, deviceId, fetchedAt: Date.now() };
  if (response.config?.obs && response.config.storage) {
    writeCache(response.config);
  }
  notifyAnnouncementListeners(announcementsOf(response));
}

export function readDesktopBootstrap(
  maxAgeMs = BOOTSTRAP_CACHE_TTL_MS,
  expectedDeviceId = getDeviceId() || "",
): DesktopBootstrapResponse | null {
  if (!bootstrapCache) return null;
  if (bootstrapCache.deviceId !== expectedDeviceId) return null;
  if (Date.now() - bootstrapCache.fetchedAt > maxAgeMs) return null;
  return bootstrapCache.response;
}

export function getCachedDesktopAnnouncement(): DesktopAnnouncement | null {
  if (!bootstrapCache || bootstrapCache.deviceId !== (getDeviceId() || "")) return null;
  return bootstrapCache.response.announcement || null;
}

export function getCachedDesktopAnnouncements(): DesktopAnnouncement[] {
  if (!bootstrapCache || bootstrapCache.deviceId !== (getDeviceId() || "")) return [];
  return announcementsOf(bootstrapCache.response);
}

export function getActiveDiscount(): ActiveDiscountInfo | null {
  const announcement = getCachedDesktopAnnouncement();
  if (!announcement) return null;
  const isDiscount = Boolean(
    announcement.offerDiscountPercent ||
    announcement.offerCode ||
    announcement.tags?.some((t) => t.toLowerCase().includes("discount") || t.toLowerCase().includes("offer")) ||
    ["offer", "upgrade"].includes(announcement.tone)
  );
  if (!isDiscount) return null;

  return {
    id: announcement.id,
    title: announcement.title,
    code: announcement.offerCode ?? null,
    discountPercent: announcement.offerDiscountPercent ?? null,
    durationMonths: announcement.offerDurationMonths ?? null,
    applicableBillingCycles: announcement.offerApplicableBillingCycles ?? [],
    claimUrl: announcement.ctaUrl ?? null,
    expiresAt: announcement.expiresAt ?? null,
  };
}

export function subscribeToDesktopAnnouncement(
  listener: (announcement: DesktopAnnouncement | null) => void,
): () => void {
  bootstrapListeners.push(listener);
  return () => {
    bootstrapListeners = bootstrapListeners.filter((candidate) => candidate !== listener);
  };
}

/**
 * Like `subscribeToDesktopAnnouncement`, but receives every announcement the
 * user should be paged through (an empty list when there is none).
 */
export function subscribeToDesktopAnnouncements(
  listener: (announcements: DesktopAnnouncement[]) => void,
): () => void {
  announcementListListeners.push(listener);
  return () => {
    announcementListListeners = announcementListListeners.filter((candidate) => candidate !== listener);
  };
}

/**
 * Replace the current announcements (from the 3-minute announcement watcher)
 * and notify the modal host. A missing bootstrap cache is created as stale
 * (fetchedAt 0) so the license check still fetches its own fresh data.
 */
export function setCachedDesktopAnnouncements(
  announcements: DesktopAnnouncement[],
  deviceId = getDeviceId() || "",
): void {
  const announcement = announcements[0] ?? null;
  if (bootstrapCache && bootstrapCache.deviceId === deviceId) {
    bootstrapCache = {
      ...bootstrapCache,
      response: { ...bootstrapCache.response, announcement, announcements },
    };
  } else {
    bootstrapCache = { response: { announcement, announcements }, deviceId, fetchedAt: 0 };
  }
  notifyAnnouncementListeners(announcements);
}

/** Single-announcement form of `setCachedDesktopAnnouncements`. */
export function setCachedDesktopAnnouncement(
  announcement: DesktopAnnouncement | null,
  deviceId = getDeviceId() || "",
): void {
  setCachedDesktopAnnouncements(announcement ? [announcement] : [], deviceId);
}

export function clearCachedDesktopAnnouncement(): void {
  if (!bootstrapCache) return;
  bootstrapCache = {
    ...bootstrapCache,
    response: { ...bootstrapCache.response, announcement: null, announcements: [], nextAvailableAt: null },
  };
  notifyAnnouncementListeners([]);
}

export function clearDesktopBootstrapCache(): void {
  bootstrapCache = null;
  notifyAnnouncementListeners([]);
}

// ── Fetch with cache ─────────────────────────────────────────────────────────

let inflight: Promise<DesktopConfig> | null = null;

/**
 * Returns the desktop config. Serves from cache if fresh, otherwise fetches.
 * Concurrent calls are deduplicated via a shared promise.
 */
export async function getDesktopConfig(): Promise<DesktopConfig> {
  const cachedEntry = readCacheEntry();
  if (cachedEntry) {
    if (Date.now() - cachedEntry.fetchedAt >= CACHE_TTL_MS) {
      refreshInBackground();
    }
    return cachedEntry.config;
  }
  return fetchConfig();
}

async function fetchConfig(): Promise<DesktopConfig> {
  if (inflight) return inflight;
  inflight = doFetch().finally(() => { inflight = null; });
  return inflight;
}

async function doFetch(): Promise<DesktopConfig> {
  const deviceId = getDeviceId();

  if (deviceId) {
    const candidates = getDeviceApiBaseCandidates();
    for (const apiBase of candidates) {
      try {
        const res = await fetch(
          `${apiBase}/api/device/license?deviceId=${encodeURIComponent(deviceId)}&bootstrap=1`,
          {
            cache: "no-store",
            headers: {
              "X-App-Version": APP_VERSION,
              "X-Device-Secret": getDeviceSecret() || "",
            },
          },
        );
        if (!res.ok) continue;

        const data = (await res.json()) as DesktopBootstrapResponse | null;
        if (!data || typeof data !== "object") continue;
        cacheDesktopBootstrap(data, deviceId);
        if (data.config && data.config.obs && data.config.storage) {
          noteServerTime(data.config.appUpdates?.serverTime);
          writeCache(data.config);
          return data.config;
        }
        break;
      } catch {
        // Try the next configured API candidate, then use the public fallback.
      }
    }
  }

  try {
    // Update policy changes must reach running clients promptly. The admin
    // screen can publish a forced update at any time, so browser/WebView HTTP
    // caching must not hide the new minimum version or installer URL.
    const res = await fetch(`${API_BASE}/api/config/desktop`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.obs && data.storage) {
        noteServerTime(data.appUpdates?.serverTime);
        writeCache(data);
        return data;
      }
    }
  } catch { /* fall through to default */ }
  return DEFAULT_DESKTOP_CONFIG;
}

function refreshInBackground(): void {
  if (inflight) return;
  inflight = doFetch().finally(() => { inflight = null; });
}

/**
 * Force-refresh: clears cache and fetches fresh data.
 */
export async function refreshDesktopConfig(): Promise<DesktopConfig> {
  localStorage.removeItem(CACHE_KEY);
  return fetchConfig();
}

// ── Sync helpers (read from cache only) ─────────────────────────────────────

/**
 * Synchronous helper to get the default OBS WebSocket URL.
 * Reads from cache; falls back to hardcoded port 4455 if config not yet loaded.
 */
export function getDefaultOBSUrl(): string {
  const cached = readCache();
  const port = cached?.obs.websocketPort ?? DEFAULT_DESKTOP_CONFIG.obs.websocketPort;
  return `ws://localhost:${port}`;
}

/**
 * Synchronous helper to get the default OBS canvas dimensions.
 * Falls back to 1920×1080 if config not yet loaded.
 */
export function getDefaultCanvasSize(): { width: number; height: number } {
  return { width: 1920, height: 1080 };
}

/**
 * Synchronous helper to get the default OBS FPS.
 */
export function getDefaultFPS(): number {
  return 30;
}

/**
 * Synchronous helper to get the default OBS port as a string.
 * Used by OnboardingPage where port is stored as string state.
 */
export function getDefaultOBSPort(): string {
  const cached = readCache();
  return String(cached?.obs.websocketPort ?? DEFAULT_DESKTOP_CONFIG.obs.websocketPort);
}

/**
 * Synchronous helper to get allowed image extensions.
 */
export function getDefaultImageExtensions(): string[] {
  const cached = readCache();
  return cached?.storage.allowedImageExtensions ?? DEFAULT_DESKTOP_CONFIG.storage.allowedImageExtensions;
}

/**
 * Synchronous helper to get allowed video extensions.
 */
export function getDefaultVideoExtensions(): string[] {
  const cached = readCache();
  return cached?.storage.allowedVideoExtensions ?? DEFAULT_DESKTOP_CONFIG.storage.allowedVideoExtensions;
}

// ── Theme sync helpers ──────────────────────────────────────────────────────

/**
 * Synchronous helper to get Bible theme defaults from config.
 */
export function getDefaultBibleTheme() {
  const cached = readCache();
  return cached?.themes.bibleDefaults ?? DEFAULT_DESKTOP_CONFIG.themes.bibleDefaults;
}

/**
 * Synchronous helper to get Worship theme defaults from config.
 */
export function getDefaultWorshipTheme() {
  const cached = readCache();
  return cached?.themes.worshipDefaults ?? DEFAULT_DESKTOP_CONFIG.themes.worshipDefaults;
}

/**
 * Synchronous helper to get Lower Third theme defaults from config.
 */
export function getDefaultLowerThirdTheme() {
  const cached = readCache();
  return cached?.themes.lowerThirdDefaults ?? DEFAULT_DESKTOP_CONFIG.themes.lowerThirdDefaults;
}

// ── Admin controls (Admin → Settings → Controls) ────────────────────────────

/** Admin controls from the cached config, filled with safe defaults. */
export function getAdminControls(): DesktopAdminControls {
  const controls = readCache()?.controls;
  const d = DEFAULT_DESKTOP_ADMIN_CONTROLS;
  return {
    features: { ...d.features, ...(controls?.features ?? {}) },
    speech: { ...d.speech, ...(controls?.speech ?? {}) },
    support: normalizeSupportContent(controls?.support),
  };
}

/** false when an admin has switched the feature off for everyone. */
export function isAdminFeatureEnabled(feature: DesktopFeatureSwitch): boolean {
  return getAdminControls().features[feature] !== false;
}

export const ADMIN_FEATURE_OFF_MESSAGES: Record<DesktopFeatureSwitch, string> = {
  speechToScripture: "Speech to Scripture is paused for maintenance. Please try again later.",
  liveTranslation: "Live translation is paused for maintenance. Please try again later.",
  mobileRemote: "The mobile remote is paused for maintenance. Please try again later.",
  multistream: "Multistream is paused for maintenance. Please try again later.",
  presentationLink: "The presentation link is paused for maintenance. Please try again later.",
};

/** Throws a friendly error when the feature is switched off by an admin. */
export function assertAdminFeatureEnabled(feature: DesktopFeatureSwitch): void {
  if (!isAdminFeatureEnabled(feature)) {
    throw new Error(ADMIN_FEATURE_OFF_MESSAGES[feature]);
  }
}
