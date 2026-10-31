/**
 * customLookLook.ts — builds an OBS scene for an admin-uploaded custom Multi-View "complete look"
 * (see customLookCatalog.ts). Unlike Scripture Circle/Arch/Gold Circle, this is generic and
 * data-driven: there is one function here for every uploaded look, parameterized by the fetched
 * package's own html + cameraSlot, rather than one hardcoded module per design.
 *
 * A look's `html` is a full standalone page, so — unlike Broadcast Graphics, which injects a
 * fragment into an existing overlay page — OBS's browser source needs a real URL to point at. The
 * page is written to ~/Documents/MakeChurchEazy/uploads/<name>.html via the `save_dock_html`
 * Tauri command (a small variant of save_dock_data that keeps the .html extension so the app's
 * overlay server serves it as text/html — see src-tauri/src/lib.rs), and served back at
 * /uploads/<name>.html, the same static route Scripture Circle's dock-data JSON files use.
 *
 * Scene building mirrors applyScriptureCircleLook's 3-step recipe exactly (background, camera
 * cropped into the slot, panel on top) — calculateFillTransform is imported, not reimplemented.
 */
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import { calculateFillTransform, type ScriptureCircleObsClient } from "./scriptureCircleLook";
import type { MultiviewLookCameraSlot } from "./customLookCatalog";

const CANVAS_W = 1920;
const CANVAS_H = 1080;

export const CUSTOM_LOOK_LAYOUT_PREFIX = "multiview-look:";

/** Builds the synthetic Dock layout id for an admin-uploaded look (one look = one usable entry —
 *  no separate "saved theme" step, since a custom look generally has nothing to configure beyond
 *  which camera scene to use). */
export function customLookLayoutId(lookId: string): string {
  return `${CUSTOM_LOOK_LAYOUT_PREFIX}${lookId}`;
}

export function isCustomLookLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === "string" && layoutId.startsWith(CUSTOM_LOOK_LAYOUT_PREFIX);
}

export function parseCustomLookLayoutId(layoutId: string | null | undefined): string | null {
  if (!isCustomLookLayoutId(layoutId)) return null;
  return (layoutId as string).slice(CUSTOM_LOOK_LAYOUT_PREFIX.length);
}

/** The scene name used for a given look — one scene per look design, shared by every card that
 *  uses it (same convention as SCRIPTURE_CIRCLE_SCENE_NAME etc.). */
export function customLookSceneName(lookId: string): string {
  return `MV: Custom · ${lookId}`;
}

function canUseTauriInvoke(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The uploads/ dock-data file name this look's html is written to. */
function customLookFileName(lookId: string): string {
  return `multiview-look-${String(lookId).replace(/[^\w-]/g, "")}`;
}

/** Writes the look's html to a local file OBS's browser source can load, and returns its URL.
 *  Safe to call again whenever the catalog refreshes — it just overwrites the same file, so a
 *  newer published version reaches an already-built scene the next time it's applied. */
export async function ensureCustomLookHtmlSaved(lookId: string, html: string): Promise<string> {
  const name = customLookFileName(lookId);
  const base = getOverlayBaseUrlSync();
  const url = `${base}/uploads/${name}.html`;
  if (!canUseTauriInvoke()) {
    // No native file write available (e.g. running in a plain browser dock) — the file may
    // already exist from the Tauri app instance; return the URL either way, as OBS only reads it.
    return url;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_html", { name, html });
  } catch (err) {
    console.warn(`[customLookLook] Failed to save "${lookId}" to a local file:`, err);
  }
  return url;
}

export interface CustomLookSettings {
  lookId: string;
  html: string;
  cameraSlot: MultiviewLookCameraSlot;
  cameraSceneName: string;
}

async function findSceneItem(obs: ScriptureCircleObsClient, sceneName: string, sourceName: string): Promise<number | null> {
  try {
    const resp = await obs.call("GetSceneItemList", { sceneName }) as { sceneItems?: Array<{ sourceName: string; sceneItemId: number }> };
    return resp.sceneItems?.find((i) => i.sourceName === sourceName)?.sceneItemId ?? null;
  } catch {
    return null;
  }
}

function toSceneItemId(resp: unknown): number {
  const id = (resp as { sceneItemId?: unknown } | null)?.sceneItemId;
  if (typeof id !== "number") throw new Error("OBS did not return the new item. Try again.");
  return id;
}

async function ensureScene(obs: ScriptureCircleObsClient, sceneName: string): Promise<void> {
  try {
    const resp = await obs.call("GetSceneList") as { scenes?: Array<{ sceneName: string }> };
    if (resp.scenes?.some((s) => s.sceneName === sceneName)) return;
  } catch { /* fall through and try to create it */ }
  await obs.call("CreateScene", { sceneName }).catch(() => { /* another caller may have just created it */ });
}

async function getCanvasScale(obs: ScriptureCircleObsClient): Promise<{ scale: number; width: number; height: number }> {
  try {
    const v = await obs.call("GetVideoSettings") as { baseWidth?: number; baseHeight?: number };
    const width = Number(v?.baseWidth);
    const height = Number(v?.baseHeight);
    if (width > 0 && height > 0) return { scale: Math.min(width / CANVAS_W, height / CANVAS_H), width, height };
  } catch { /* fall through */ }
  return { scale: 1, width: CANVAS_W, height: CANVAS_H };
}

/**
 * Builds (or updates) the OBS scene for one admin-uploaded custom look: a plain background, the
 * chosen camera scene cropped into its cameraSlot, and the look's page as a browser source on top
 * — the exact same 3-layer recipe as applyScriptureCircleLook, just parameterized by the fetched
 * package instead of fixed Scripture Circle constants.
 */
export async function applyCustomMultiViewLook(
  obs: ScriptureCircleObsClient,
  settings: CustomLookSettings,
): Promise<{ sceneName: string }> {
  if (!settings.cameraSceneName) {
    throw new Error("Choose which OBS scene has your camera first.");
  }
  const sceneName = customLookSceneName(settings.lookId);
  const bgSourceName = `${sceneName} · Background`;
  const panelSourceName = `${sceneName} · Panel`;
  await ensureScene(obs, sceneName);
  const canvas = await getCanvasScale(obs);
  const panelUrl = await ensureCustomLookHtmlSaved(settings.lookId, settings.html);

  // 1. Background — bottom.
  let bgId = await findSceneItem(obs, sceneName, bgSourceName);
  if (bgId === null) {
    bgId = await obs.call("CreateInput", {
      sceneName,
      inputName: bgSourceName,
      inputKind: "color_source_v3",
      inputSettings: { color: 0xFF000000 },
      sceneItemEnabled: true,
    }).then(toSceneItemId);
  }
  await obs.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: bgId,
    sceneItemTransform: {
      positionX: 0, positionY: 0, boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: canvas.width, boundsHeight: canvas.height, boundsAlignment: 0, rotation: 0,
    },
  });
  await obs.call("SetSceneItemIndex", { sceneName, sceneItemId: bgId, sceneItemIndex: 0 }).catch(() => { });

  // 2. Camera — the user's camera scene, added once as a Scene source and cropped to the slot.
  let camId = await findSceneItem(obs, sceneName, settings.cameraSceneName);
  if (camId === null) {
    camId = await obs.call("CreateSceneItem", { sceneName, sourceName: settings.cameraSceneName, sceneItemEnabled: true }).then(toSceneItemId);
  }
  const camSize = await obs.call("GetSceneItemTransform", { sceneName, sceneItemId: camId })
    .then((r) => r as { sceneItemTransform?: { sourceWidth?: number; sourceHeight?: number } })
    .catch(() => null);
  const sourceWidth = camSize?.sceneItemTransform?.sourceWidth || CANVAS_W;
  const sourceHeight = camSize?.sceneItemTransform?.sourceHeight || CANVAS_H;
  const slot = settings.cameraSlot;
  const target = {
    x: slot.x * canvas.scale,
    y: slot.y * canvas.scale,
    width: slot.width * canvas.scale,
    height: slot.height * canvas.scale,
  };
  const fit = calculateFillTransform(sourceWidth, sourceHeight, target);
  await obs.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: camId,
    sceneItemTransform: {
      positionX: fit.positionX, positionY: fit.positionY,
      scaleX: fit.scaleX, scaleY: fit.scaleY,
      cropLeft: Math.round(fit.cropLeft), cropRight: Math.round(fit.cropRight),
      cropTop: Math.round(fit.cropTop), cropBottom: Math.round(fit.cropBottom),
      boundsType: "OBS_BOUNDS_NONE", rotation: 0,
    },
  });
  await obs.call("SetSceneItemIndex", { sceneName, sceneItemId: camId, sceneItemIndex: 1 }).catch(() => { });

  // 3. The look's page — top. Re-created whenever the html changes (a newer published version);
  // the camera and background items above are only ever moved, not recreated.
  let panelId = await findSceneItem(obs, sceneName, panelSourceName);
  if (panelId === null) {
    panelId = await obs.call("CreateInput", {
      sceneName,
      inputName: panelSourceName,
      inputKind: "browser_source",
      inputSettings: { url: panelUrl, width: CANVAS_W, height: CANVAS_H, css: "", shutdown: false, restart_when_active: false },
      sceneItemEnabled: true,
    }).then(toSceneItemId);
  } else {
    await obs.call("SetInputSettings", {
      inputName: panelSourceName,
      inputSettings: { url: panelUrl },
    }).catch(() => { });
    // Force the browser source to pick up a newer file at the same URL.
    await obs.call("PressInputPropertiesButton", { inputName: panelSourceName, propertyName: "refreshnocache" }).catch(() => { });
  }
  await obs.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: panelId,
    sceneItemTransform: {
      positionX: 0, positionY: 0, boundsType: "OBS_BOUNDS_SCALE_INNER",
      boundsWidth: canvas.width, boundsHeight: canvas.height, boundsAlignment: 5, rotation: 0,
    },
  });
  await obs.call("SetSceneItemIndex", { sceneName, sceneItemId: panelId, sceneItemIndex: 2 }).catch(() => { });

  return { sceneName };
}

// ---------------------------------------------------------------------------
// Per-look camera scene — the only thing a custom look needs configured, besides the look itself.
// Stored keyed by lookId (not a list of named "themes" like Scripture Circle — see the judgment
// call in the report: a custom look generally has no other settings, so one look = one directly
// usable Dock entry). Persisted the same cross-process way as Scripture Circle's themes list, via
// the durable dock-data file, since the Dock can run as a separate OBS browser-dock process.
// ---------------------------------------------------------------------------

const CAMERA_SETTINGS_KEY = "mce-dock-custom-multiview-look-cameras";
const CAMERA_SETTINGS_DOCK_DATA_NAME = "custom-multiview-look-cameras";

function readCameraMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CAMERA_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function pushCameraMapToDockData(map: Record<string, string>): void {
  const data = JSON.stringify(map);
  void (async () => {
    if (canUseTauriInvoke()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_dock_data", { name: CAMERA_SETTINGS_DOCK_DATA_NAME, data });
        return;
      } catch (err) {
        console.warn("[customLookLook] Tauri invoke save_dock_data failed:", err);
      }
    }
  })();
}

export function getCustomLookCameraScene(lookId: string): string {
  return readCameraMap()[lookId] || "";
}

export function saveCustomLookCameraScene(lookId: string, sceneName: string): void {
  const map = readCameraMap();
  if (sceneName) map[lookId] = sceneName;
  else delete map[lookId];
  try {
    localStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify(map));
  } catch {
    // Storage might be full or unavailable; the in-memory push below still reaches the Dock file.
  }
  pushCameraMapToDockData(map);
}

/** Reads the durable copy — what a Dock running as a separate process sees. */
export async function loadCustomLookCameraScenesFromDockData(): Promise<Record<string, string>> {
  if (canUseTauriInvoke()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("load_dock_data", { name: CAMERA_SETTINGS_DOCK_DATA_NAME });
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch {
      // Fall through to the local copy.
    }
  }
  return readCameraMap();
}
