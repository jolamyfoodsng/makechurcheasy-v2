/**
 * broadcastGraphicsStorage.ts — User-customized Broadcast Graphics persistence.
 *
 * Stores personalized lower thirds, speaker introductions, giving details,
 * welcome banners, announcements and overlays.
 *
 * Separates built-in templates from user-customized saved graphics, and manages
 * their availability in the OBS Dock.
 */

import { getUserScopedKey } from "./userScopedStorage";
import { getCurrentUserId } from "./db";
import type { LowerThirdTheme, LTPosition } from "../lowerthirds/types";

export interface SavedBroadcastGraphic {
  id: string;
  name: string;
  templateId: string;
  category: "speaker" | "service" | "welcome" | "giving" | "subscribe" | "announcements" | "countdown" | "social" | "branding" | "scripture" | "quotes" | "others";
  displayType: "lower-third" | "fullscreen" | "overlay";
  variables: Record<string, string>;
  design?: {
    textColor?: string;
    accentColor?: string;
    bgColor?: string;
    fontSizeScale?: number;
    fontFamily?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right";
  };
  animation?: {
    speed?: string;
    duration?: number;
    position?: string;
    animationIn?: string;
  };
  isAddedToObs: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "mce-saved-broadcast-graphics";
export const BROADCAST_GRAPHICS_UPDATED_EVENT = "broadcast-graphics-updated";

function notifyChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BROADCAST_GRAPHICS_UPDATED_EVENT));
  }
}

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** In the desktop app the list lives in a file in the app folder; browser storage is only the web/legacy fallback. */
function diskName(): string {
  const uid = getCurrentUserId();
  const safe = uid ? String(uid).replace(/[^a-zA-Z0-9_-]/g, "") : "";
  return safe ? `saved-broadcast-graphics-${safe}` : "saved-broadcast-graphics";
}

let cache: SavedBroadcastGraphic[] | null = null;
let cacheName = "";

function readLocalStorageList(): SavedBroadcastGraphic[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(getUserScopedKey(STORAGE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[broadcastGraphicsStorage] Failed to load saved graphics:", err);
    return [];
  }
}

/**
 * Load all saved customized graphics for the current user.
 */
export function loadSavedBroadcastGraphics(): SavedBroadcastGraphic[] {
  if (cache && cacheName === diskName()) return cache;
  return readLocalStorageList();
}

/**
 * Read the saved graphics from the app folder (moving any left in browser storage there once).
 * Call when a screen that lists them opens; the list is then served from memory.
 */
export async function hydrateSavedBroadcastGraphics(): Promise<boolean> {
  if (!isTauri()) return false;
  const name = diskName();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("load_dock_data", { name });
    let list: SavedBroadcastGraphic[] | null = null;
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
    if (list === null) {
      list = readLocalStorageList();
      await invoke("save_dock_data", { name, data: JSON.stringify(list) });
    }
    cache = list;
    cacheName = name;
    // Everything is on disk now; free the browser storage.
    try { localStorage.removeItem(getUserScopedKey(STORAGE_KEY)); } catch { /* ignore */ }
    notifyChange();
    return true;
  } catch (err) {
    console.warn("[broadcastGraphicsStorage] Could not read the app folder, using browser storage:", err);
    return false;
  }
}

const hydrations = new Map<string, Promise<boolean>>();

/** True once this account's list has been read from the app folder (always true outside the desktop app). */
export function areSavedBroadcastGraphicsLoaded(): boolean {
  return !isTauri() || Boolean(cache && cacheName === diskName());
}

/**
 * Make sure the saved graphics are read from the app folder. Screens that list or change them
 * (the Studio drawer, the app shell) call this first: the list only lives in memory after it, and
 * saving before it would write a list with just the new graphic over the file.
 */
export function ensureSavedBroadcastGraphicsLoaded(): Promise<boolean> {
  if (areSavedBroadcastGraphicsLoaded()) return Promise.resolve(true);
  const name = diskName();
  let pending = hydrations.get(name);
  if (!pending) {
    pending = hydrateSavedBroadcastGraphics().finally(() => hydrations.delete(name));
    hydrations.set(name, pending);
  }
  return pending;
}

function writeLocalStorageList(items: SavedBroadcastGraphic[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const key = getUserScopedKey(STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(items));
    const back = localStorage.getItem(key);
    if (!back || (JSON.parse(back) as unknown[]).length !== items.length) {
      lastSaveError = "The browser storage did not keep the change.";
      return false;
    }
    return true;
  } catch (err) {
    console.error("[broadcastGraphicsStorage] Failed to save graphics:", err);
    const msg = `${(err as { name?: string })?.name || ""} ${(err as Error)?.message || ""}`;
    lastSaveError = /quota/i.test(msg)
      ? "Storage is full. Remove a graphic or use smaller pictures, then try again."
      : "Could not write to storage.";
    return false;
  }
}

/**
 * Persist the full array of saved graphics: to a file in the app folder in the desktop app
 * (memory first, file written right behind it), otherwise to browser storage.
 */
function persistAll(items: SavedBroadcastGraphic[]): boolean {
  if (isTauri() && !areSavedBroadcastGraphicsLoaded()) {
    // The list was never read from the app folder: this array only has what this call knows about.
    // Writing it would replace every saved graphic with it.
    lastSaveError = "Your saved graphics are still loading. Try again in a moment.";
    void ensureSavedBroadcastGraphicsLoaded();
    return false;
  }
  if (isTauri()) {
    const name = diskName();
    cache = items;
    cacheName = name;
    lastSaveError = "";
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_dock_data", { name, data: JSON.stringify(items) });
      } catch (err) {
        console.error("[broadcastGraphicsStorage] Failed to write the app folder file:", err);
        writeLocalStorageList(items);
      }
    })();
    notifyChange();
    void syncSavedGraphicsToDock(items);
    return true;
  }
  if (!writeLocalStorageList(items)) return false;
  lastSaveError = "";
  notifyChange();
  void syncSavedGraphicsToDock(items);
  return true;
}

let lastSaveError = "";
/** Why the last save failed (empty when it worked). */
export function getLastGraphicSaveError(): string {
  return lastSaveError;
}

/**
 * Save a newly created broadcast graphic.
 */
export function saveBroadcastGraphic(
  graphic: Omit<SavedBroadcastGraphic, "id" | "createdAt" | "updatedAt"> & { id?: string },
): SavedBroadcastGraphic {
  const all = loadSavedBroadcastGraphics();
  const now = new Date().toISOString();
  const id = graphic.id || `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const newGraphic: SavedBroadcastGraphic = {
    ...graphic,
    id,
    createdAt: now,
    updatedAt: now,
  };

  const next = [newGraphic, ...all.filter((g) => g.id !== id)];
  if (!persistAll(next)) throw new Error(lastSaveError || "Could not save the graphic.");

  // If added to OBS, sync favorite state and dock memory slot
  if (newGraphic.isAddedToObs) {
    syncGraphicToObs(newGraphic);
  }

  return newGraphic;
}

/**
 * Update an existing saved broadcast graphic.
 */
export function updateBroadcastGraphic(
  id: string,
  patch: Partial<Omit<SavedBroadcastGraphic, "id" | "createdAt">>,
): SavedBroadcastGraphic | null {
  const all = loadSavedBroadcastGraphics();
  const index = all.findIndex((g) => g.id === id);
  if (index === -1) return null;

  const existing = all[index];
  const updated: SavedBroadcastGraphic = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  all[index] = updated;
  if (!persistAll(all)) throw new Error(lastSaveError || "Could not save the graphic.");

  if (updated.isAddedToObs) {
    syncGraphicToObs(updated);
  }

  return updated;
}

/**
 * Duplicate an existing saved graphic.
 */
export function duplicateBroadcastGraphic(id: string): SavedBroadcastGraphic | null {
  const all = loadSavedBroadcastGraphics();
  const original = all.find((g) => g.id === id);
  if (!original) return null;

  return saveBroadcastGraphic({
    ...original,
    id: undefined,
    name: `${original.name} (Copy)`,
    isAddedToObs: false,
  });
}

/**
 * Delete a saved graphic by id.
 */
export function deleteBroadcastGraphic(id: string): boolean {
  const all = loadSavedBroadcastGraphics();
  const filtered = all.filter((g) => g.id !== id);
  if (filtered.length === all.length) return false;
  return persistAll(filtered);
}

/**
 * Toggle whether a graphic is available in the OBS Dock.
 */
export function toggleGraphicObsAvailability(id: string): boolean {
  const all = loadSavedBroadcastGraphics();
  const graphic = all.find((g) => g.id === id);
  if (!graphic) return false;

  const nextState = !graphic.isAddedToObs;
  updateBroadcastGraphic(id, { isAddedToObs: nextState });

  if (nextState) {
    syncGraphicToObs(graphic);
  }

  return nextState;
}

/**
 * Kept for callers: a graphic marked "added to OBS" reaches the Dock through
 * syncSavedGraphicsToDock() (run on every save), where it is listed as its own
 * custom lower third.
 */
export function syncGraphicToObs(_graphic: SavedBroadcastGraphic): void {
  void syncSavedGraphicsToDock();
}

/** Dock data file (served at /uploads/dock-saved-graphics.json) read by the OBS Dock. */
export const DOCK_SAVED_GRAPHICS_FILE = "dock-saved-graphics";

/**
 * Write the graphics marked "added to OBS" to a Dock-readable JSON file, then tell
 * the Dock to refresh. The Dock runs inside OBS with its own storage, so it cannot
 * read this app's localStorage directly.
 */
export async function syncSavedGraphicsToDock(items?: SavedBroadcastGraphic[]): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    // Called without a list (catalog refresh at start-up), the list may not be read from
    // the app folder yet; reading it here keeps an empty list from wiping the Dock file.
    if (!items && !(cache && cacheName === diskName()) && !(await hydrateSavedBroadcastGraphics())) return;
    const list = items ?? loadSavedBroadcastGraphics();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: DOCK_SAVED_GRAPHICS_FILE,
      data: JSON.stringify(await savedGraphicsForDock(list)),
    });
    const { dockBridge } = await import("./dockBridge");
    dockBridge.sendFavoriteThemesUpdated({ source: "saved-graphics" });
  } catch (err) {
    console.warn("[broadcastGraphicsStorage] Failed to sync saved graphics to the Dock:", err);
  }
}

/**
 * The saved graphics the Dock may show: added to OBS and built on a template the admin
 * has not paused, hidden or limited to another plan. Graphics made from an admin-published
 * package carry their full lower third (`theme`), because the Dock has no copy of it.
 */
export async function savedGraphicsForDock(
  items: SavedBroadcastGraphic[] = loadSavedBroadcastGraphics(),
): Promise<Array<SavedBroadcastGraphic & { theme?: LowerThirdTheme }>> {
  const added = items.filter((g) => g.isAddedToObs);
  try {
    const { getGraphicAvailability, getPackageThemes } = await import("./broadcastGraphicsCatalog");
    const packageThemes = getPackageThemes();
    return added
      .filter((g) => getGraphicAvailability(g.templateId).usable)
      .map((g) => {
        const template = packageThemes.find((t) => t.id === g.templateId);
        return template ? { ...g, theme: buildSavedGraphicTheme(g, template) } : g;
      });
  } catch {
    return added;
  }
}

/** Dock-side id of a saved graphic's lower third. */
export function savedGraphicThemeId(graphic: Pick<SavedBroadcastGraphic, "id">): string {
  return `saved-${graphic.id}`;
}

/**
 * Build the Dock lower third for a saved graphic: the template it was made from, under
 * the graphic's own name and id, with the saved text/colours as the field defaults and
 * the saved screen position as its starting position.
 */
export function buildSavedGraphicTheme(
  graphic: SavedBroadcastGraphic,
  template: LowerThirdTheme,
): LowerThirdTheme & { defaultPosition?: LTPosition } {
  const values = graphic.variables || {};
  return {
    ...template,
    id: savedGraphicThemeId(graphic),
    name: graphic.name || template.name,
    tags: [...(template.tags || []), "Custom"],
    variables: template.variables.map((v) => {
      const saved = values[v.key];
      return saved !== undefined && saved !== "" ? { ...v, defaultValue: String(saved) } : v;
    }),
    defaultPosition: (graphic.animation?.position as LTPosition | undefined) || undefined,
  };
}


// ---------------------------------------------------------------------------
// Picture offloading — keeps browser storage (about 5 MB) from filling up.
// ---------------------------------------------------------------------------

const OFFLOAD_MIN_CHARS = 4000;

/** Save one data: image to the app's uploads folder and return its local URL (or the input if that is not possible). */
export async function offloadImageToDisk(dataUrl: string): Promise<string> {
  if (!/^data:image\//i.test(dataUrl) || dataUrl.length < OFFLOAD_MIN_CHARS) return dataUrl;
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return dataUrl;
  try {
    const match = /^data:image\/([a-z0-9.+-]+)(;[^,]*)?;base64,(.*)$/is.exec(dataUrl);
    if (!match) return dataUrl;
    const ext = match[1].toLowerCase().startsWith("svg") ? "svg" : match[1].toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const binary = atob(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const fileName = `graphic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("save_upload_file", { fileName, fileData: Array.from(bytes) });
    const { getOverlayBaseUrl } = await import("./overlayUrl");
    const base = await getOverlayBaseUrl();
    return `${base}/uploads/${encodeURIComponent(fileName)}`;
  } catch (err) {
    console.warn("[broadcastGraphicsStorage] Could not move a picture out of storage:", err);
    return dataUrl;
  }
}

/**
 * Move pictures embedded in saved graphics to files, so graphics made earlier stop using up
 * browser storage. Returns true when something was shrunk.
 */
export async function offloadSavedGraphicImages(): Promise<boolean> {
  const all = loadSavedBroadcastGraphics();
  let changed = false;
  for (const graphic of all) {
    const vars = graphic.variables || {};
    for (const key of Object.keys(vars)) {
      const value = vars[key];
      if (typeof value === "string" && /^data:image\//i.test(value) && value.length >= OFFLOAD_MIN_CHARS) {
        const url = await offloadImageToDisk(value);
        if (url !== value) {
          vars[key] = url;
          changed = true;
        }
      }
    }
  }
  if (changed) persistAll(all);
  return changed;
}


/**
 * Put graphics from a cloud backup into this computer's list.
 * "merge" adds the ones that are not here yet; "replace" swaps the whole list.
 */
export function restoreSavedBroadcastGraphics(
  incoming: SavedBroadcastGraphic[],
  mode: "merge" | "replace" = "merge",
): number {
  if (!Array.isArray(incoming)) return 0;
  const local = loadSavedBroadcastGraphics();
  const next = mode === "replace"
    ? incoming
    : [...incoming.filter((g) => !local.some((l) => l.id === g.id)), ...local];
  persistAll(next);
  return incoming.length;
}
