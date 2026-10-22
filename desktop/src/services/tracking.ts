/**
 * tracking.ts — Backend event tracking for the desktop app.
 *
 * Sends usage events to the web backend (MongoDB) for admin analytics.
 * This is separate from the Cloudflare analytics (anonymous telemetry).
 * This tracks per-user actions for the admin dashboard.
 *
 * Privacy: Only sends event name, userId, and non-sensitive metadata.
 * Never sends Bible content, lyrics, transcript text, or personal info.
 */

import {
  getDeviceId,
  getDeviceSecret,
  getSession,
  getSessionApiBase,
} from "./authService";

const FIRST_PRESENTATION_KEY = "mce_first_presentation_done";
const FIRST_APP_OPEN_KEY = "mce_first_app_open_done";

let trialActivationAttempted = false;

function isFirstPresentationDone(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(FIRST_PRESENTATION_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function markFirstPresentationDone(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FIRST_PRESENTATION_KEY, "true");
    }
  } catch {}
}

/**
 * Background async capture and upload of OBS screenshot on first presentation.
 * Silently catches errors — never interrupts presentation or blocks UI.
 */
async function captureAndUploadFirstPresentationScreenshot(
  type: "bible" | "worship" | "media",
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    // Settle delay for OBS to render overlay frame
    await new Promise((r) => setTimeout(r, 650));
    const { dockObsClient } = await import("../dock/dockObsClient");
    const screenshot = await dockObsClient.captureScreenshot();
    if (!screenshot) return;

    const session = getSession();
    const userId =
      session?.user?.id ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("mce-dock-auth-user-id") ||
          localStorage.getItem("mce_auth_user_id")
        : null) ||
      null;
    const deviceId =
      getDeviceId() ||
      session?.deviceId ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("mce-device-id")
        : null) ||
      null;
    const deviceSecret = getDeviceSecret() || session?.deviceSecret || null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (deviceId) headers["X-Device-Id"] = deviceId;
    if (deviceSecret) headers["X-Device-Secret"] = deviceSecret;

    const apiBase = getSessionApiBase();
    if (!apiBase) return;

    await fetch(`${apiBase}/api/tracking/first-presentation-screenshot`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        screenshot,
        type,
        details,
        userId,
      }),
    });
  } catch (err) {
    console.warn("[tracking] First presentation screenshot capture error:", err);
  }
}

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Send a tracking event to the backend. Fire-and-forget.
 * Silently fails — never blocks or errors in the UI.
 */
type TrackingRequest = { url: string; headers: Record<string, string>; body: string };

/** Who is using the app: the signed-in user, the paired device and where to send events. Shared by all trackers. */
export function getTrackingIdentity(): { userId: string | null; headers: Record<string, string>; apiBase: string | null } {
  const session = getSession();
  const userId =
    session?.user?.id ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("mce-dock-auth-user-id") ||
        localStorage.getItem("mce_auth_user_id")
      : null) ||
    null;
  const deviceId =
    getDeviceId() ||
    session?.deviceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("mce-device-id")
      : null) ||
    null;
  const deviceSecret = getDeviceSecret() || session?.deviceSecret || null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (deviceSecret) headers["X-Device-Secret"] = deviceSecret;
  return { userId, headers, apiBase: getSessionApiBase() || null };
}

function buildTrackingRequest(
  event: string,
  properties?: Record<string, unknown>,
  timestamp: string = new Date().toISOString(),
): TrackingRequest | null {
  const { userId, headers, apiBase } = getTrackingIdentity();
  if (!apiBase) return null;

  return {
    url: `${apiBase}/api/tracking/event`,
    headers,
    body: JSON.stringify({
      event,
      userId,
      properties: properties || {},
      timestamp,
    }),
  };
}

/**
 * Send a tracking event to the backend. Fire-and-forget.
 * Silently fails — never blocks or errors in the UI.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    const request = buildTrackingRequest(event, properties);
    if (!request) return;

    void fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      keepalive: true,
    }).catch(() => {
      // Tracking should never break the app
    });
  } catch {
    // Storage or analytics failures must never interrupt the user's action.
  }
}

// ── Use events (presenting, graphics, voice) ────────────────────────────────
//
// These drive the admin activity score, so they are queued when the app is
// offline (common during a service) and sent later. Other events are
// fire-and-forget. The storage key predates the wider use and is kept so
// events queued by older builds are still sent.

const USE_QUEUE_KEY = "mce_graphic_usage_queue_v1";
const USE_QUEUE_MAX = 500;

type QueuedUseEvent = {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
};

function readUseQueue(): QueuedUseEvent[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(USE_QUEUE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.event === "string") : [];
  } catch {
    return [];
  }
}

function writeUseQueue(queue: QueuedUseEvent[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (queue.length) localStorage.setItem(USE_QUEUE_KEY, JSON.stringify(queue.slice(-USE_QUEUE_MAX)));
    else localStorage.removeItem(USE_QUEUE_KEY);
  } catch {
    // Storage full or unavailable — the event is dropped.
  }
}

async function sendTrackingEvent(item: QueuedUseEvent): Promise<boolean> {
  const request = buildTrackingRequest(item.event, item.properties, item.timestamp);
  if (!request) return false;
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      keepalive: true,
    });
    // 4xx other than rate limiting will never succeed; do not keep retrying them.
    return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
  } catch {
    return false;
  }
}

let useFlushRunning = false;

/** Send queued use events. Safe to call any time. */
export async function flushUseEventQueue(): Promise<void> {
  if (useFlushRunning) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  useFlushRunning = true;
  try {
    const queue = readUseQueue();
    if (!queue.length) return;
    const remaining: QueuedUseEvent[] = [];
    for (let i = 0; i < queue.length; i += 1) {
      const sent = await sendTrackingEvent(queue[i]);
      if (!sent) {
        // Offline again: keep this and everything after it, in order.
        remaining.push(...queue.slice(i));
        break;
      }
    }
    // Events added while flushing were appended to storage; keep them too.
    const addedMeanwhile = readUseQueue().slice(queue.length);
    writeUseQueue([...remaining, ...addedMeanwhile]);
  } finally {
    useFlushRunning = false;
  }
}

/** Send a use event now, or keep it for later when the app is offline. */
function trackUseEvent(event: string, properties: Record<string, unknown> = {}): void {
  try {
    const item: QueuedUseEvent = { event, properties, timestamp: new Date().toISOString() };
    void sendTrackingEvent(item).then((sent) => {
      if (sent) {
        void flushUseEventQueue();
        return;
      }
      writeUseQueue([...readUseQueue(), item]);
    });
  } catch {
    // Tracking should never break the app
  }
}

/**
 * Record that a Broadcast Graphic was added to the OBS Dock or shown on air.
 * `themeId` is the template id (bundled theme id, or "lt-pkg-<id>" for uploaded graphics).
 */
export function trackGraphicUsage(
  kind: "added_to_obs" | "shown",
  themeId: string | null | undefined,
  name?: string | null,
): void {
  if (!themeId) return;
  trackUseEvent(
    kind === "added_to_obs" ? "broadcast_graphic_added_to_obs" : "broadcast_graphic_shown",
    { themeId, ...(name ? { name } : {}) },
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushUseEventQueue(); });
  window.setTimeout(() => { void flushUseEventQueue(); }, 8000);
}

function activateTrial(
  event: "obs_connected" | "first_use_started" | "first_presentation" | "first_use",
): void {
  if (event === "first_presentation" && isFirstPresentationDone()) {
    return;
  }
  if (trialActivationAttempted) return;
  const session = getSession();
  const deviceId =
    getDeviceId() ||
    session?.deviceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("mce-device-id")
      : null) ||
    null;
  const userId =
    session?.user?.id ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("mce-dock-auth-user-id") ||
        localStorage.getItem("mce_auth_user_id")
      : null);
  if (!userId || !deviceId) return;
  trialActivationAttempted = true;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Device-Id": deviceId,
  };
  const deviceSecret = getDeviceSecret() || session?.deviceSecret;
  if (deviceSecret) headers["X-Device-Secret"] = deviceSecret;

  const apiBase = getSessionApiBase();
  if (!apiBase) return;

  void fetch(`${apiBase}/api/trial/activate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {
    // Trial activation is retried by the next app session if the request fails.
    trialActivationAttempted = false;
  });
}

// ── Auth Events ────────────────────────────────────────────────────────────

export function trackSignup(method: string = "unknown"): void {
  trackEvent("user_signup", { method });
}

export function trackLogin(method: string = "unknown"): void {
  trackEvent("user_login", { method });
}

export function trackDevicePaired(): void {
  trackEvent("device_paired");
}

// ── Bible Events ───────────────────────────────────────────────────────────

/** Where an action came from, so the admin can see phone-remote and voice use. */
export type TrackingSource = "dock" | "mobile_remote" | "voice" | "app";

export function trackBibleSearch(version?: string, source: TrackingSource = "dock"): void {
  trackUseEvent("bible_search", { version, source });
}

export function trackBiblePresent(
  params?:
    | string
    | {
        ref?: string;
        translation?: string;
        overlayMode?: "fullscreen" | "lower-third";
        book?: string;
        chapter?: number;
        verse?: number;
        verseRange?: string;
        source?: TrackingSource;
      },
): void {
  const isObject = typeof params === "object" && params !== null;
  const rawRef = (isObject ? params.ref : params) || "";
  // Some callers pass the verse text instead of a reference. Never send Bible
  // content (see the privacy note above): keep only short "Book 3:16"-style refs.
  const ref = rawRef.length <= 48 && /\d+\s*[:.]\s*\d+/.test(rawRef) ? rawRef : "";
  const translation = isObject ? params.translation : undefined;
  const overlayMode = isObject ? params.overlayMode : undefined;
  const book = isObject ? params.book : undefined;
  const chapter = isObject ? params.chapter : undefined;
  const verse = isObject ? params.verse : undefined;
  const verseRange = isObject ? params.verseRange : undefined;
  const source = (isObject && params.source) || "dock";

  trackUseEvent("bible_present", {
    source,
    hasRef: Boolean(rawRef),
    ref: ref || "",
    translation: translation || "",
    overlayMode: overlayMode || "fullscreen",
    book: book || "",
    chapter: chapter || undefined,
    verse: verse || undefined,
    verseRange: verseRange || "",
  });

  if (!isFirstPresentationDone()) {
    activateTrial("first_presentation");
    markFirstPresentationDone();
    void captureAndUploadFirstPresentationScreenshot("bible", {
      ref: ref || "",
      translation: translation || "",
      overlayMode: overlayMode || "fullscreen",
    });
  }
}

// ── Worship Events ─────────────────────────────────────────────────────────

export function trackWorshipSongCreated(): void {
  trackUseEvent("worship_song_created");
}

export function trackWorshipSongImported(count = 1, format?: string): void {
  trackUseEvent("worship_song_imported", { count, ...(format ? { format } : {}) });
}

export function trackWorshipSongPresented(
  params?:
    | string
    | {
        songTitle?: string;
        overlayMode?: "fullscreen" | "lower-third";
        hasLyrics?: boolean;
        source?: TrackingSource;
      },
): void {
  const isObject = typeof params === "object" && params !== null;
  const songTitle = isObject
    ? params.songTitle
    : typeof params === "string"
      ? params
      : undefined;
  const overlayMode = isObject ? params.overlayMode : undefined;
  const hasLyrics = isObject ? params.hasLyrics : true;
  const source = (isObject && params.source) || "dock";

  trackUseEvent("worship_song_presented", {
    source,
    songTitle: songTitle || "",
    overlayMode: overlayMode || "fullscreen",
    hasLyrics: Boolean(hasLyrics),
  });

  if (!isFirstPresentationDone()) {
    activateTrial("first_presentation");
    markFirstPresentationDone();
    void captureAndUploadFirstPresentationScreenshot("worship", {
      songTitle: songTitle || "",
      overlayMode: overlayMode || "fullscreen",
    });
  }
}

// ── Media Events ───────────────────────────────────────────────────────────

export function trackMediaUploaded(type: string = "unknown"): void {
  trackUseEvent("media_uploaded", { type });
}

/** Notes, countdowns, tickers and lower thirds put on screen. */
export type OutputShownEvent = "note_shown" | "countdown_shown" | "ticker_shown" | "lower_third_shown";

export function trackOutputShown(event: OutputShownEvent, source: TrackingSource = "dock"): void {
  trackUseEvent(event, { source });
}

export function trackMediaPresented(
  params?:
    | string
    | {
        type?: string;
        mediaName?: string;
        source?: TrackingSource;
      },
): void {
  const isObject = typeof params === "object" && params !== null;
  const type = isObject
    ? params.type
    : typeof params === "string"
      ? params
      : "unknown";
  const mediaName = isObject ? params.mediaName : undefined;
  const source = (isObject && params.source) || "dock";

  trackUseEvent("media_presented", {
    source,
    type: type || "unknown",
    mediaName: mediaName || "",
  });

  if (!isFirstPresentationDone()) {
    activateTrial("first_presentation");
    markFirstPresentationDone();
    void captureAndUploadFirstPresentationScreenshot("media", {
      type: type || "unknown",
      mediaName: mediaName || "",
    });
  }
}

// ── Mode Switch Events ─────────────────────────────────────────────────────

export function trackOverlayModeSwitched(
  module: "bible" | "worship" | "notes" | "sermon" | string,
  mode: "fullscreen" | "lower-third",
): void {
  trackEvent("overlay_mode_switched", { module, mode });
}

// ── Voice / Transcription Events ───────────────────────────────────────────

export function trackVoiceSessionStarted(): void {
  trackEvent("voice_session_started");
}

export function trackVoiceSessionCompleted(durationSeconds: number): void {
  trackUseEvent("voice_session_completed", { durationSeconds });
}

export function trackTranscriptCreated(wordCount: number): void {
  trackUseEvent("transcript_created", { wordCount });
}

export function trackTranscriptExported(format: string): void {
  trackEvent("transcript_exported", { format });
}

export function trackTranslationGenerated(
  wordCount: number,
  targetLang?: string,
): void {
  trackUseEvent("translation_generated", { wordCount, targetLang });
  activateTrial("first_use");
}

// ── Theme Events ───────────────────────────────────────────────────────────

export function trackThemeCreated(type: string): void {
  trackEvent("theme_created", { type });
}

export function trackThemeApplied(type: string): void {
  trackEvent("theme_applied", { type });
}

// ── App Lifecycle ──────────────────────────────────────────────────────────

export function trackFirstAppOpen(properties?: Record<string, unknown>): void {
  try {
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem(FIRST_APP_OPEN_KEY) === "true") return;
      localStorage.setItem(FIRST_APP_OPEN_KEY, "true");
    }
  } catch {}
  trackEvent("first_app_open", properties);
}

export function trackAppStarted(extraProps?: Record<string, unknown>): void {
  trackFirstAppOpen(extraProps);
  trackEvent("app_started", extraProps);
}

export function trackAppClosed(sessionDurationSeconds: number): void {
  trackEvent("app_closed", { sessionDurationSeconds });
}

export function trackObsConnected(): void {
  trackEvent("obs_connected");
  activateTrial("obs_connected");
}

export function trackFirstUseStarted(): void {
  trackEvent("first_use_started");
  activateTrial("first_use_started");
}

export function trackStsPushToLive(): void {
  trackUseEvent("sts_push_to_live");
  activateTrial("first_use");
}
