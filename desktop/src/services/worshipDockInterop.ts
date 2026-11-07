import type { Song } from "../worship/types";

export interface WorshipDockSongSavePayload {
  /** Reviewed document songs, saved together in the main application. */
  batch?: Song[];
  id: string;
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

export interface WorshipDockSongSaveCommand {
  commandId: string;
  timestamp: number;
  payload: WorshipDockSongSavePayload;
}

export interface WorshipDockSongSaveResult {
  commandId: string;
  timestamp: number;
  ok: boolean;
  song?: Song;
  error?: string;
}

export const WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME = "dock-worship-song-save";
export const WORSHIP_DOCK_SONG_SAVE_RESULT_NAME = "dock-worship-song-save-result";

// The dock can start before the Tauri overlay server has finished booting.
// Keep the fallback handoff alive through that short startup window instead
// of making the first proxy 500 look like a failed save.
const SAVE_RETRY_DELAYS_MS = [250, 500, 750, 1_000, 1_500, 2_000, 2_500] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetrySaveStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createWorshipDockSongSaveCommand(
  payload: WorshipDockSongSavePayload,
): WorshipDockSongSaveCommand {
  return {
    commandId: `worship-song-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    payload,
  };
}

export async function postWorshipDockSongSaveCommand(
  command: WorshipDockSongSaveCommand,
  baseUrl = window.location.origin,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/save-dock-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME,
          data: JSON.stringify(command),
        }),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt === SAVE_RETRY_DELAYS_MS.length) throw error;
      lastError = error;
      await wait(SAVE_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (response.ok) return;

    const detail = (await response.text().catch(() => "")).trim();
    const detailSuffix = detail ? `: ${detail.slice(0, 180)}` : "";
    const error = new Error(
      `Worship song save command failed with ${response.status}${detailSuffix}`,
    );
    if (!shouldRetrySaveStatus(response.status) || attempt === SAVE_RETRY_DELAYS_MS.length) {
      throw error;
    }
    lastError = error;
    await wait(SAVE_RETRY_DELAYS_MS[attempt]);
  }

  throw lastError ?? new Error("Worship song save command failed.");
}

export async function loadWorshipDockSongSaveCommand(): Promise<WorshipDockSongSaveCommand | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("load_dock_data", {
    name: WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME,
  });
  if (!raw.trim()) return null;
  return parseJson<WorshipDockSongSaveCommand>(raw);
}

export async function saveWorshipDockSongSaveResult(
  result: WorshipDockSongSaveResult,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_dock_data", {
    name: WORSHIP_DOCK_SONG_SAVE_RESULT_NAME,
    data: JSON.stringify(result),
  });
}

export async function loadWorshipDockSongSaveResult(
  commandId: string,
  baseUrl = window.location.origin,
): Promise<WorshipDockSongSaveResult | null> {
  try {
    const response = await fetch(
      `${baseUrl}/uploads/${WORSHIP_DOCK_SONG_SAVE_RESULT_NAME}.json?_=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const result = parseJson<WorshipDockSongSaveResult>(await response.text());
    if (!result || result.commandId !== commandId) return null;
    return result;
  } catch {
    return null;
  }
}

// ── Song removal from the Dock ─────────────────────────────────────────────
// A Dock in OBS has its own storage and its live messages may not reach the app, so a removal
// is also written to a file the app checks. The file holds every removal the app has not
// confirmed yet; archiving is idempotent, so reading the same list twice is harmless.

export const WORSHIP_DOCK_SONG_ARCHIVE_NAME = "dock-worship-song-archive";

export interface WorshipDockSongArchiveRequest {
  timestamp: number;
  ids: string[];
}

export async function postWorshipDockSongArchiveRequest(
  ids: string[],
  baseUrl = window.location.origin,
): Promise<void> {
  const request: WorshipDockSongArchiveRequest = { timestamp: Date.now(), ids };
  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/save-dock-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: WORSHIP_DOCK_SONG_ARCHIVE_NAME, data: JSON.stringify(request) }),
      });
      if (response.ok || !shouldRetrySaveStatus(response.status)) return;
    } catch {
      // Overlay server still starting: retry below.
    }
    if (attempt < SAVE_RETRY_DELAYS_MS.length) await wait(SAVE_RETRY_DELAYS_MS[attempt]);
  }
}

export async function loadWorshipDockSongArchiveRequest(): Promise<WorshipDockSongArchiveRequest | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("load_dock_data", { name: WORSHIP_DOCK_SONG_ARCHIVE_NAME });
  if (!raw.trim()) return null;
  const parsed = parseJson<WorshipDockSongArchiveRequest>(raw);
  return parsed && Array.isArray(parsed.ids) ? parsed : null;
}
