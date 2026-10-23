/**
 * dockUploadService.ts — Shared upload utilities for the MakeChurchEazy Dock.
 *
 * The dock runs as a standalone browser page in OBS and cannot use Tauri's
 * invoke directly. This service handles the Tauri-first-with-HTTP-fallback
 * pattern, thumbnail generation, and local library persistence.
 */

import type { MediaItem } from "../library/libraryTypes";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import { dockClient } from "../services/dockBridge";
import { getMediaKind, isSupportedMediaFile } from "../services/mediaValidation";
import { getUserScopedKey } from "../services/userScopedStorage";
import { isInternalDockMediaItem } from "./internalMediaAssets";
import { compareMediaItemsNewest, getMediaStableKey } from "../library/mediaOrdering";
import { saveUploadBytes } from "../services/uploadFileBytes";

const LOCAL_LIBRARY_KEY = "ocs-dock-media-library-v1";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSafeFileName(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  const base = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const ext = dotIndex > 0 ? trimmed.slice(dotIndex + 1).toLowerCase() : "";
  const safeBase = base
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "media";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

/* ── Thumbnail generation ────────────────────────────────────────────────── */

export function getVideoDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.src = "";
    };
    video.onerror = () => {
      resolve(0);
      video.src = "";
    };
    video.src = src;
  });
}

export function getAudioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.src = "";
    };
    audio.onerror = () => {
      resolve(0);
      audio.src = "";
    };
    audio.src = src;
  });
}

export function generateVideoThumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    let resolved = false;
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      resolve("");
      try {
        video.src = "";
      } catch { /* ignore */ }
    };

    const timeout = setTimeout(finalize, 3000);

    const captureFrame = () => {
      if (resolved) return;
      try {
        const width = video.videoWidth || 480;
        const height = video.videoHeight || 270;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          clearTimeout(timeout);
          finalize();
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        clearTimeout(timeout);
        resolved = true;
        resolve(dataUrl);
      } catch {
        clearTimeout(timeout);
        finalize();
      } finally {
        try {
          video.src = "";
        } catch { /* ignore */ }
      }
    };

    video.onloadedmetadata = () => {
      try {
        const targetTime = video.duration && video.duration > 1 ? Math.min(1.0, video.duration * 0.1) : 0.2;
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };

    video.onseeked = () => {
      captureFrame();
    };

    video.onloadeddata = () => {
      setTimeout(() => {
        if (!resolved) captureFrame();
      }, 400);
    };

    video.onerror = finalize;
    video.src = src;
  });
}

export function generateImageThumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const width = image.naturalWidth || 480;
        const height = image.naturalHeight || 270;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(""); return; }
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve("");
      }
    };
    image.onerror = () => resolve("");
    image.src = src;
  });
}

/* ── Disk save (Tauri-first, HTTP fallback) ──────────────────────────────── */

export async function saveToDisk(file: File, safeName: string): Promise<string> {
  // Try Tauri first
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    console.log("[UPLOAD] saveToDisk: Tauri save (raw bytes)…");
    const result = await saveUploadBytes(safeName, bytes);
    console.log("[UPLOAD] saveToDisk: Tauri save OK →", result);
    return result;
  } catch (tauriErr) {
    console.log("[UPLOAD] saveToDisk: Tauri failed, using HTTP fallback →", tauriErr);
    // HTTP fallback
    console.log("[UPLOAD] saveToDisk: Reading file as data URL…");
    const dataUrl = await readDataUrl(file);
    console.log("[UPLOAD] saveToDisk: POST /api/save-media …", { safeName, dataUrlLen: dataUrl.length });
    const response = await fetch("/api/save-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: safeName, dataUrl }),
    });
    console.log("[UPLOAD] saveToDisk: HTTP response", { status: response.status, ok: response.ok });
    if (!response.ok) {
      throw new Error(`Upload failed with ${response.status}`);
    }
    const data = await response.json();
    if (!data.path) {
      throw new Error("Upload path was not returned.");
    }
    console.log("[UPLOAD] saveToDisk: HTTP save OK →", data.path);
    return String(data.path);
  }
}

/* ── Local library persistence ───────────────────────────────────────────── */

export function loadLocalLibrary(): MediaItem[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(LOCAL_LIBRARY_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as MediaItem[]).filter((item) => !isInternalDockMediaItem(item))
      : [];
  } catch {
    return [];
  }
}

export function saveLocalLibrary(items: MediaItem[]): void {
  try {
    // Strip large base64 data-URLs before persisting — the file is already on
    // disk and accessible via the overlay URL, so thumbnails are not needed in
    // localStorage.  This keeps the payload well under the ~5 MB quota.
    const lightweight = items.map((item) => {
      if (!item.thumbnailUrl || item.thumbnailUrl.startsWith("http")) return item;
      const { thumbnailUrl, ...rest } = item;
      return rest;
    });
    localStorage.setItem(getUserScopedKey(LOCAL_LIBRARY_KEY), JSON.stringify(lightweight));
  } catch (err) {
    console.warn("[UPLOAD] saveLocalLibrary: localStorage write failed — trying without thumbnails", err);
    try {
      const stripped = items.map(({ thumbnailUrl: _t, ...rest }) => rest);
      localStorage.setItem(getUserScopedKey(LOCAL_LIBRARY_KEY), JSON.stringify(stripped));
    } catch (innerErr) {
      console.error("[UPLOAD] saveLocalLibrary: giving up — library will not persist", innerErr);
    }
  }
}

export function dedupeMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = getMediaStableKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareMediaItemsNewest);
}

/* ── Sync to main app ────────────────────────────────────────────────────── */

export function syncMediaToApp(item: MediaItem): void {
  dockClient.sendCommand({
    type: "media:save",
    payload: item,
    timestamp: Date.now(),
    commandId: `dock-media-save-${item.id}`,
  });
  dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
}

export async function registerDockMediaItem(item: MediaItem): Promise<void> {
  try {
    const { saveMedia } = await import("../library/libraryDb");
    await saveMedia(item);
  } catch (err) {
    console.warn("[UPLOAD] registerDockMediaItem: IndexedDB save failed, falling back to local sync", err);
    syncMediaToApp(item);
  }

  const current = loadLocalLibrary();
  saveLocalLibrary(dedupeMediaItems([item, ...current]));
  try {
    dockClient.sendState({ type: "state:library-updated", payload: null, timestamp: Date.now() });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mce-media-library-updated"));
    }
  } catch { /* ignore */ }
}

export async function deleteDockMediaItem(id?: string, fileName?: string | null): Promise<void> {
  if (id) {
    try {
      const { deleteMedia } = await import("../library/libraryDb");
      await deleteMedia(id);
    } catch { /* ignore */ }
  }
  const current = loadLocalLibrary();
  const next = current.filter((item) => {
    if (id && item.id === id) return false;
    if (fileName && (item.diskFileName === fileName || item.filePath?.endsWith(fileName))) return false;
    return true;
  });
  saveLocalLibrary(next);
  try {
    dockClient.sendState({ type: "state:library-updated", payload: null, timestamp: Date.now() });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mce-media-library-updated"));
    }
  } catch { /* ignore */ }
}

/* ── Full upload pipeline ────────────────────────────────────────────────── */

export interface UploadResult {
  item: MediaItem;
  error?: string;
}

export async function uploadFileToDock(
  file: File,
  _onProgress?: (status: string) => void,
): Promise<UploadResult> {
  console.log("[UPLOAD] uploadFileToDock: start", { name: file.name, size: file.size, type: file.type });
  if (!isSupportedMediaFile(file)) {
    console.warn("[UPLOAD] uploadFileToDock: unsupported file type", file.type);
    return { item: null as unknown as MediaItem, error: `Unsupported file type. Only image, video, and audio files are allowed.` };
  }
  // File.type is empty or incorrect for some native/Tauri picker results.
  // Resolve the kind from MIME first, then fall back to the file extension so
  // a video cannot be saved as an image and disappear from the Videos filter.
  const category = getMediaKind(file);
  if (!category) {
    return { item: null as unknown as MediaItem, error: `Unsupported file type. Only image, video, and audio files are allowed.` };
  }

  const uploadStartedAt = Date.now();
  const uploadedAt = new Date(uploadStartedAt).toISOString();
  const safeName = `media_${uploadStartedAt}_${getSafeFileName(file.name)}`;
  const overlayBaseUrl = getOverlayBaseUrlSync();
  const previewUrl = `${overlayBaseUrl}/uploads/${encodeURIComponent(safeName)}`;
  const objectUrl = URL.createObjectURL(file);

  let thumbnailUrl = "";
  let durationSec: number | undefined;

  try {
    if (category === "video") {
      console.log("[UPLOAD] Generating video thumbnail…");
      durationSec = await getVideoDuration(objectUrl);
      thumbnailUrl = await generateVideoThumbnail(objectUrl);
    } else if (category === "image") {
      console.log("[UPLOAD] Generating image thumbnail…");
      thumbnailUrl = await generateImageThumbnail(objectUrl);
    } else {
      console.log("[UPLOAD] Reading audio duration…");
      durationSec = await getAudioDuration(objectUrl);
    }
    console.log("[UPLOAD] Thumbnail done:", { hasThumb: !!thumbnailUrl, durationSec });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  console.log("[UPLOAD] Saving to disk:", { safeName });
  const diskPath = await saveToDisk(file, safeName);
  console.log("[UPLOAD] Disk save returned:", diskPath);

  const item: MediaItem = {
    id: uid(),
    name: file.name,
    type: category,
    url: previewUrl,
    filePath: diskPath,
    diskFileName: safeName,
    thumbnailUrl: thumbnailUrl || undefined,
    durationSec: durationSec ? Math.round(durationSec) : undefined,
    fileSize: file.size,
    mimeType: file.type,
    createdAt: uploadedAt,
    uploadedAt,
    source: "local",
  };

  console.log("[UPLOAD] uploadFileToDisk: returning item", { id: item.id, name: item.name, filePath: item.filePath });
  return { item };
}
