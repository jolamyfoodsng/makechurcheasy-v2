/**
 * scriptureCircleLook.ts — the "Scripture Circle" Multi-View look.
 *
 * Unlike the generic Multi-View gallery (galleryLayouts.ts), this is a single, complete look: a
 * terracotta/parchment design with a round camera window and a verse panel that updates on its own.
 * Picking it builds one OBS scene and is otherwise unrelated to MCE Presentation — the two scenes
 * never touch, and Multi-View never nests one inside the other.
 *
 * The scene holds three items, bottom to top:
 *   1. Background   — a plain color source, a safety net behind the circle.
 *   2. Main Camera  — the user's own camera scene, added as a Scene source and cropped with
 *      calculateFillTransform() so it fully covers the circle's bounding box.
 *   3. Verse panel  — a Browser source loading mce-multiview-scripture-circle.html. It is fully
 *      opaque everywhere except the circle, which is why the camera needs no mask filter: the
 *      panel simply paints over the camera rectangle's corners.
 *
 * The verse panel listens on the same local relay channel ("bible") that every Bible overlay
 * listens on (see bible/overlayServer.ts), filtered by its own `?tab=bible` query param exactly
 * the way mce-bible-overlay.html does. Clicking a verse in the Bible tab updates it like any other
 * Bible destination — the camera is never touched again after the scene is built.
 */

import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import { buildVersionedOverlayUrl } from "../services/overlayVersion";
import { LT_ANIMATIONS_IN, type LTAnimationIn } from "../lowerthirds/types";

export const SCRIPTURE_CIRCLE_SCENE_NAME = "MV: Scripture Circle";
export const SCRIPTURE_CIRCLE_PANEL_SOURCE = "Scripture Circle Panel";
export const SCRIPTURE_CIRCLE_BG_SOURCE = "Scripture Circle Background";
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export interface ScriptureCircleSettings {
  /** The OBS scene that has the user's camera — added as a Scene source, never edited itself. */
  cameraSceneName: string;
  /** Diagonal wedge (left side) color; also the SCRIPTURE label, accent rule and LIVE tag. */
  wedgeColor: string;
  /** The paper (right side) background color. */
  paperColor: string;
  /** Verse and reference text color. */
  textColor: string;
  /** Show the LIVE tag on the camera window. */
  showLive: boolean;
  /** The camera window's shape: round, or a square with slightly rounded corners. */
  shape: ScriptureCircleShape;
  /** Camera window left, top and size, in 1920 × 1080 design pixels (scaled to the OBS canvas). */
  circle: { x: number; y: number; diameter: number };
  /** Framing of the camera inside the window: zoom (1 = just fills it) and the point it centers
   *  on, 0–100 % across and down the camera picture. */
  camera: { zoom: number; focusX: number; focusY: number };
  /** How the verse/reference animate in when they change (same styles as the Lower Third's
   *  "Animate in" picker — see LTAnimationIn in lowerthirds/types.ts). */
  animationIn: LTAnimationIn;
}

export type ScriptureCircleShape = "circle" | "box";

export const DEFAULT_SCRIPTURE_CIRCLE_SETTINGS: ScriptureCircleSettings = {
  cameraSceneName: "",
  wedgeColor: "#C4552E",
  paperColor: "#F4EDE1",
  textColor: "#121212",
  showLive: true,
  shape: "circle",
  circle: { x: 78, y: 104, diameter: 790 },
  camera: { zoom: 1, focusX: 50, focusY: 50 },
  // "none" keeps this look's original plain cross-fade swap unchanged by default.
  animationIn: "none",
};

export const CAMERA_ZOOM_MAX = 3;

const SETTINGS_KEY = "mce-dock-scripture-circle-settings";

function clampDiameter(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 120 && n <= CANVAS_H ? Math.round(n) : fallback;
}

function clampCoord(value: unknown, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : fallback;
}

function clampRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** Fills in anything missing or invalid from a saved settings object with the defaults. */
export type ScriptureCircleSettingsInput = Partial<Omit<ScriptureCircleSettings, "circle" | "camera">> & {
  circle?: Partial<ScriptureCircleSettings["circle"]>;
  camera?: Partial<ScriptureCircleSettings["camera"]>;
};

export function normalizeScriptureCircleSettings(raw: ScriptureCircleSettingsInput | null | undefined): ScriptureCircleSettings {
  const d = DEFAULT_SCRIPTURE_CIRCLE_SETTINGS;
  const circle: Partial<ScriptureCircleSettings["circle"]> = raw?.circle ?? {};
  const camera: Partial<ScriptureCircleSettings["camera"]> = raw?.camera ?? {};
  const diameter = clampDiameter(circle.diameter, d.circle.diameter);
  return {
    cameraSceneName: typeof raw?.cameraSceneName === "string" ? raw.cameraSceneName.trim() : d.cameraSceneName,
    wedgeColor: isHexColor(raw?.wedgeColor) ? raw!.wedgeColor! : d.wedgeColor,
    paperColor: isHexColor(raw?.paperColor) ? raw!.paperColor! : d.paperColor,
    textColor: isHexColor(raw?.textColor) ? raw!.textColor! : d.textColor,
    showLive: typeof raw?.showLive === "boolean" ? raw.showLive : d.showLive,
    shape: raw?.shape === "box" || raw?.shape === "circle" ? raw.shape : d.shape,
    animationIn: LT_ANIMATIONS_IN.includes(raw?.animationIn as LTAnimationIn) ? (raw!.animationIn as LTAnimationIn) : d.animationIn,
    camera: {
      zoom: Math.round(clampRange(camera.zoom, 1, CAMERA_ZOOM_MAX, d.camera.zoom) * 100) / 100,
      focusX: Math.round(clampRange(camera.focusX, 0, 100, d.camera.focusX)),
      focusY: Math.round(clampRange(camera.focusY, 0, 100, d.camera.focusY)),
    },
    circle: {
      diameter,
      x: clampCoord(circle.x, CANVAS_W - diameter, d.circle.x),
      y: clampCoord(circle.y, CANVAS_H - diameter, d.circle.y),
    },
  };
}

export function loadScriptureCircleSettings(): ScriptureCircleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    // Settings saved with the first version of this look still carry its untouched defaults;
    // move those to the current design so the look matches the reference out of the box.
    if (saved?.circle?.x === 102 && saved.circle.y === 94 && saved.circle.diameter === 720) {
      saved.circle = { ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.circle };
    }
    if (saved?.wedgeColor === "#C14E29") saved.wedgeColor = DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.wedgeColor;
    if (saved?.textColor === "#17171B") saved.textColor = DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.textColor;
    return normalizeScriptureCircleSettings(saved);
  } catch {
    return { ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS };
  }
}

export function saveScriptureCircleSettings(settings: ScriptureCircleSettings): ScriptureCircleSettings {
  const normalized = normalizeScriptureCircleSettings(settings);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Storage might be full or unavailable; the caller still gets the normalized value back.
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Named themes — a church can save several Scripture Circle variants (e.g.
// different colors for different services). Each gets its own id and is
// picked in the Dock's Multi-View template picker via a synthetic layout id
// ("scripture-circle:<themeId>"), never as a real GalleryLayout.
// ---------------------------------------------------------------------------

export interface ScriptureCircleTheme {
  id: string;
  name: string;
  settings: ScriptureCircleSettings;
  updatedAt: string;
}

export const SCRIPTURE_CIRCLE_LAYOUT_PREFIX = "scripture-circle:";

/** Builds the synthetic Dock layout id for a saved theme. */
export function scriptureCircleLayoutId(themeId: string): string {
  return `${SCRIPTURE_CIRCLE_LAYOUT_PREFIX}${themeId}`;
}

/** True when `layoutId` is a Scripture Circle synthetic id (as opposed to a real GalleryLayout id). */
export function isScriptureCircleLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === "string" && layoutId.startsWith(SCRIPTURE_CIRCLE_LAYOUT_PREFIX);
}

/** Extracts the theme id back out of a synthetic layout id, or null if it isn't one. */
export function parseScriptureCircleThemeId(layoutId: string | null | undefined): string | null {
  if (!isScriptureCircleLayoutId(layoutId)) return null;
  return (layoutId as string).slice(SCRIPTURE_CIRCLE_LAYOUT_PREFIX.length);
}

const THEMES_KEY = "mce-dock-scripture-circle-themes";
/** Durable, cross-process copy of the themes list (see save_dock_data/load_dock_data in lib.rs).
 *  localStorage alone only reaches other windows/tabs of the SAME browser engine — it never
 *  reaches the Dock when it's open as an OBS browser dock (a separate CEF process) rather than a
 *  Tauri window. This is the same mechanism addedLayoutStorage.ts uses for the same reason. */
const THEMES_DOCK_DATA_NAME = "scripture-circle-themes";
const THEMES_DOCK_DATA_URL = "/uploads/scripture-circle-themes.json";

function canUseTauriInvoke(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseThemesListRaw(raw: string | null | undefined): ScriptureCircleTheme[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const result: ScriptureCircleTheme[] = [];
    for (const item of parsed) {
      const normalized = normalizeTheme(item);
      if (normalized) result.push(normalized);
    }
    return result;
  } catch {
    return [];
  }
}

function pushThemesToDockData(themes: ScriptureCircleTheme[]): void {
  const data = JSON.stringify(themes);
  void (async () => {
    if (canUseTauriInvoke()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_dock_data", { name: THEMES_DOCK_DATA_NAME, data });
        console.log(`[ScriptureCircle] Pushed ${themes.length} theme(s) to dock data via Tauri invoke.`);
        return;
      } catch (err) {
        console.error("[ScriptureCircle] Tauri invoke save_dock_data failed, falling back to HTTP:", err);
      }
    }
    try {
      const res = await fetch("/api/save-dock-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: THEMES_DOCK_DATA_NAME, data }),
      });
      if (!res.ok) {
        console.error(`[ScriptureCircle] POST /api/save-dock-data returned ${res.status}`, await res.text().catch(() => ""));
      } else {
        console.log(`[ScriptureCircle] Pushed ${themes.length} theme(s) to dock data via HTTP.`);
      }
    } catch (err) {
      console.error("[ScriptureCircle] POST /api/save-dock-data failed:", err);
    }
  })();
}

/** Reads the durable copy of the themes list — what a Dock running as a separate process sees. */
export async function loadScriptureCircleThemesFromDockData(): Promise<ScriptureCircleTheme[]> {
  if (canUseTauriInvoke()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("load_dock_data", { name: THEMES_DOCK_DATA_NAME });
      if (raw) return parseThemesListRaw(raw);
      return [];
    } catch {
      // Fall through to HTTP.
    }
  }
  try {
    const response = await fetch(`${THEMES_DOCK_DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return [];
    return parseThemesListRaw(await response.text());
  } catch {
    return [];
  }
}

function isValidTheme(value: unknown): value is ScriptureCircleTheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.name === "string";
}

function normalizeTheme(raw: unknown): ScriptureCircleTheme | null {
  if (!isValidTheme(raw)) return null;
  return {
    id: raw.id,
    name: raw.name.trim() || "Scripture Circle",
    settings: normalizeScriptureCircleSettings(raw.settings as ScriptureCircleSettingsInput | null | undefined),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function readThemesList(): ScriptureCircleTheme[] {
  try {
    return parseThemesListRaw(localStorage.getItem(THEMES_KEY));
  } catch {
    return [];
  }
}

function writeThemesList(themes: ScriptureCircleTheme[]): void {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
  } catch {
    // Storage might be full or unavailable; callers still get the values back in memory.
  }
  pushThemesToDockData(themes);
}

/** All saved Scripture Circle themes, most recently updated first.
 *  Also re-publishes to dock data (self-heal for themes saved before that existed, or if the
 *  earlier push failed) so the Dock picks them up without the operator having to resave. */
export function listScriptureCircleThemes(): ScriptureCircleTheme[] {
  const themes = readThemesList().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (themes.length > 0) pushThemesToDockData(themes);
  return themes;
}

export function getScriptureCircleTheme(id: string): ScriptureCircleTheme | null {
  return readThemesList().find((theme) => theme.id === id) ?? null;
}

function generateThemeId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the timestamp-based id below
  }
  return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Picks a unique default name: "Scripture Circle", or "Scripture Circle 2"/"3"/… if taken. */
function uniqueDefaultName(existing: ScriptureCircleTheme[], excludeId?: string): string {
  const taken = new Set(
    existing.filter((t) => t.id !== excludeId).map((t) => t.name.trim().toLowerCase()),
  );
  const base = "Scripture Circle";
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** Creates (no `id`) or updates (existing `id`) a named theme and persists the whole list. */
export function saveScriptureCircleTheme(theme: { id?: string; name: string; settings: ScriptureCircleSettings }): ScriptureCircleTheme {
  const themes = readThemesList();
  const normalizedSettings = normalizeScriptureCircleSettings(theme.settings);
  const trimmedName = theme.name.trim();

  if (theme.id) {
    const idx = themes.findIndex((t) => t.id === theme.id);
    const saved: ScriptureCircleTheme = {
      id: theme.id,
      name: trimmedName || uniqueDefaultName(themes, theme.id),
      settings: normalizedSettings,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) {
      themes[idx] = saved;
    } else {
      // Id was supplied (e.g. a stale reference) but no longer exists — add it back.
      themes.push(saved);
    }
    writeThemesList(themes);
    return saved;
  }

  const saved: ScriptureCircleTheme = {
    id: generateThemeId(),
    name: trimmedName || uniqueDefaultName(themes),
    settings: normalizedSettings,
    updatedAt: new Date().toISOString(),
  };
  themes.push(saved);
  writeThemesList(themes);
  return saved;
}

/** Renames an existing theme (a thin wrapper over `saveScriptureCircleTheme`). */
export function renameScriptureCircleTheme(id: string, name: string): ScriptureCircleTheme | null {
  const theme = getScriptureCircleTheme(id);
  if (!theme) return null;
  return saveScriptureCircleTheme({ id, name, settings: theme.settings });
}

export function deleteScriptureCircleTheme(id: string): void {
  const themes = readThemesList().filter((t) => t.id !== id);
  writeThemesList(themes);
}

/** The Browser source URL: colors and circle geometry travel in the query string so the same
 *  HTML file draws every church's version of this look, and the camera crop below always
 *  matches the hole the page actually draws. `tab=bible` is what makes the page listen on the
 *  Bible module's relay channel, exactly like mce-bible-overlay.html does. */
export function buildScriptureCirclePanelUrl(settings: ScriptureCircleSettings): string {
  const base = getOverlayBaseUrlSync();
  return buildVersionedOverlayUrl(base, "mce-multiview-scripture-circle.html", {
    tab: "bible",
    mceRelay: 1,
    ...scriptureCirclePanelParams(settings),
  });
}

/** The look's settings as the panel page reads them from its query string — shared by OBS and
 *  the in-app preview so both always draw the same thing. */
export function scriptureCirclePanelParams(settings: ScriptureCircleSettings): Record<string, string | number> {
  return {
    wedge: settings.wedgeColor.replace(/^#/, ""),
    paper: settings.paperColor.replace(/^#/, ""),
    text: settings.textColor.replace(/^#/, ""),
    cx: settings.circle.x,
    cy: settings.circle.y,
    cd: settings.circle.diameter,
    shape: settings.shape,
    live: settings.showLive ? 1 : 0,
    anim: settings.animationIn,
  };
}

export interface FillTransform {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
}

/**
 * Crops a source of sourceWidth × sourceHeight so it fully covers a target rectangle (the OBS
 * "fill" behavior used across Multi-View — see calculateSlotTransform in DockMultiviewTab.tsx).
 * `framing` zooms in past "just fills it" and picks which part of the picture stays in view
 * (focusX/focusY in %, 50/50 = centered). The in-app preview reproduces the same framing with
 * CSS object-position + scale, so what the operator sets there is what OBS shows.
 */
export function calculateFillTransform(
  sourceWidth: number,
  sourceHeight: number,
  target: { x: number; y: number; width: number; height: number },
  framing: ScriptureCircleSettings["camera"] = DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.camera,
): FillTransform {
  const srcW = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : target.width;
  const srcH = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : target.height;
  const zoom = clampRange(framing.zoom, 1, CAMERA_ZOOM_MAX, 1);
  const fx = clampRange(framing.focusX, 0, 100, 50) / 100;
  const fy = clampRange(framing.focusY, 0, 100, 50) / 100;
  const scale = Math.max(target.width / srcW, target.height / srcH) * zoom;
  const extraX = Math.max(0, srcW - target.width / scale);
  const extraY = Math.max(0, srcH - target.height / scale);
  return {
    positionX: target.x,
    positionY: target.y,
    scaleX: scale,
    scaleY: scale,
    cropLeft: extraX * fx,
    cropRight: extraX * (1 - fx),
    cropTop: extraY * fy,
    cropBottom: extraY * (1 - fy),
  };
}

/** The square the camera item is cropped to: the window's own bounding box, in canvas pixels.
 *  Filled this way it fully covers a circle or a box window — so the panel's paint only ever has
 *  to hide what lies outside the window, never a sliver of the window itself. `canvasScale` maps
 *  the 1920 × 1080 design onto a smaller or larger OBS canvas (1 for 1920 × 1080). */
export function cameraTargetRect(
  circle: ScriptureCircleSettings["circle"],
  canvasScale = 1,
): { x: number; y: number; width: number; height: number } {
  return {
    x: circle.x * canvasScale,
    y: circle.y * canvasScale,
    width: circle.diameter * canvasScale,
    height: circle.diameter * canvasScale,
  };
}

/** How much the 1920 × 1080 design is scaled to fit the OBS canvas (e.g. 2/3 on 1280 × 720).
 *  Falls back to 1 when OBS can't say. */
async function getCanvasScale(obs: ScriptureCircleObsClient): Promise<{ scale: number; width: number; height: number }> {
  try {
    const v = await obs.call("GetVideoSettings") as { baseWidth?: number; baseHeight?: number };
    const width = Number(v?.baseWidth);
    const height = Number(v?.baseHeight);
    if (width > 0 && height > 0) return { scale: Math.min(width / CANVAS_W, height / CANVAS_H), width, height };
  } catch { /* fall through */ }
  return { scale: 1, width: CANVAS_W, height: CANVAS_H };
}

// ---------------------------------------------------------------------------
// OBS orchestration — not unit tested (needs a live OBS connection); the pure
// math and settings helpers above are what scriptureCircleLook.test.ts covers.
// ---------------------------------------------------------------------------

/** The slice of dockObsClient this module calls. Typed narrowly so a test could fake it. */
export interface ScriptureCircleObsClient {
  call(type: string, params?: Record<string, unknown>): Promise<unknown>;
}

async function findSceneItem(obs: ScriptureCircleObsClient, sceneName: string, sourceName: string): Promise<number | null> {
  try {
    const resp = await obs.call("GetSceneItemList", { sceneName }) as { sceneItems?: Array<{ sourceName: string; sceneItemId: number }> };
    return resp.sceneItems?.find((i) => i.sourceName === sourceName)?.sceneItemId ?? null;
  } catch {
    return null;
  }
}

/** OBS answers CreateInput / CreateSceneItem with `{ sceneItemId }`, not a bare number. */
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

/**
 * Builds (or updates) the "MV: Scripture Circle" scene for the given settings: a plain background,
 * the chosen camera scene cropped into the circle, and the verse panel on top. Safe to call again
 * after the operator changes a color or picks a different camera scene — existing items are moved
 * and relabeled rather than duplicated.
 */
export async function applyScriptureCircleLook(
  obs: ScriptureCircleObsClient,
  settings: ScriptureCircleSettings,
): Promise<{ sceneName: string }> {
  if (!settings.cameraSceneName) {
    throw new Error("Choose which OBS scene has your camera first.");
  }
  const sceneName = SCRIPTURE_CIRCLE_SCENE_NAME;
  await ensureScene(obs, sceneName);
  const canvas = await getCanvasScale(obs);

  // 1. Background — bottom.
  let bgId = await findSceneItem(obs, sceneName, SCRIPTURE_CIRCLE_BG_SOURCE);
  if (bgId === null) {
    bgId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_CIRCLE_BG_SOURCE,
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

  // 2. Main Camera — the user's camera scene, added once as a Scene source and cropped to the circle.
  let camId = await findSceneItem(obs, sceneName, settings.cameraSceneName);
  if (camId === null) {
    camId = await obs.call("CreateSceneItem", { sceneName, sourceName: settings.cameraSceneName, sceneItemEnabled: true }).then(toSceneItemId);
  }
  const camSize = await obs.call("GetSceneItemTransform", { sceneName, sceneItemId: camId })
    .then((r) => r as { sceneItemTransform?: { sourceWidth?: number; sourceHeight?: number } })
    .catch(() => null);
  const sourceWidth = camSize?.sceneItemTransform?.sourceWidth || CANVAS_W;
  const sourceHeight = camSize?.sceneItemTransform?.sourceHeight || CANVAS_H;
  const fit = calculateFillTransform(sourceWidth, sourceHeight, cameraTargetRect(settings.circle, canvas.scale), settings.camera);
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

  // 3. Verse panel — top. Re-created whenever the colors or circle geometry change, since those
  // travel in the URL; the camera and background items above are only ever moved, not recreated.
  const panelUrl = buildScriptureCirclePanelUrl(settings);
  let panelId = await findSceneItem(obs, sceneName, SCRIPTURE_CIRCLE_PANEL_SOURCE);
  if (panelId === null) {
    panelId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_CIRCLE_PANEL_SOURCE,
      inputKind: "browser_source",
      inputSettings: { url: panelUrl, width: CANVAS_W, height: CANVAS_H, css: "", shutdown: false, restart_when_active: false },
      sceneItemEnabled: true,
    }).then(toSceneItemId);
  } else {
    await obs.call("SetInputSettings", {
      inputName: SCRIPTURE_CIRCLE_PANEL_SOURCE,
      inputSettings: { url: panelUrl },
    }).catch(() => { });
  }
  await obs.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: panelId,
    sceneItemTransform: {
      positionX: 0, positionY: 0, boundsType: "OBS_BOUNDS_SCALE_INNER",
      // Top-left aligned (OBS_ALIGN_TOP | OBS_ALIGN_LEFT) so it lines up with the camera, which is
      // placed from the top-left using the same scale.
      boundsWidth: canvas.width, boundsHeight: canvas.height, boundsAlignment: 5, rotation: 0,
    },
  });
  await obs.call("SetSceneItemIndex", { sceneName, sceneItemId: panelId, sceneItemIndex: 2 }).catch(() => { });

  return { sceneName };
}
