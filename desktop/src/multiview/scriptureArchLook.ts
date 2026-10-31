/**
 * scriptureArchLook.ts — the "Scripture Arch" Multi-View look.
 *
 * A single, complete OBS look (not a slot-grid layout): a light/blue design with the camera framed
 * in an arch-shaped window (a rectangle with a fully rounded top) and a verse panel beside it that
 * updates on its own. This mirrors scriptureCircleLook.ts's structure closely (same settings/theme/
 * dock-data/OBS-builder shape) — see that file's header comment for the full rationale; this one
 * only documents what is different.
 *
 * The scene holds three items, bottom to top:
 *   1. Background   — a plain color source, a safety net behind the arch.
 *   2. Main Camera  — the user's own camera scene, cropped with calculateFillTransform() (imported
 *      from scriptureCircleLook.ts, fully reusable as-is) so it fully covers the arch's bounding box.
 *   3. Verse panel  — a Browser source loading mce-multiview-scripture-arch.html, opaque everywhere
 *      except the arch shape.
 *
 * The verse panel listens on the same local relay channel ("bible") as every Bible overlay.
 */

import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import { buildVersionedOverlayUrl } from "../services/overlayVersion";
import { calculateFillTransform, type FillTransform } from "./scriptureCircleLook";
import { LT_ANIMATIONS_IN, type LTAnimationIn } from "../lowerthirds/types";

export const SCRIPTURE_ARCH_SCENE_NAME = "MV: Scripture Arch";
export const SCRIPTURE_ARCH_PANEL_SOURCE = "Scripture Arch Panel";
export const SCRIPTURE_ARCH_BG_SOURCE = "Scripture Arch Background";
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export interface ScriptureArchSettings {
  /** The OBS scene that has the user's camera — added as a Scene source, never edited itself. */
  cameraSceneName: string;
  /** Accent color: LIVE badge, accent rule, eyebrow label, reference text. */
  accentColor: string;
  /** Page background color. */
  backgroundColor: string;
  /** Verse and reference text color. */
  textColor: string;
  /** Show the LIVE badge above the arch. */
  showLive: boolean;
  /** Camera window left, top, width and height, in 1920 x 1080 design pixels. */
  window: { x: number; y: number; width: number; height: number };
  /** Framing of the camera inside the window: zoom (1 = just fills it) and the point it centers
   *  on, 0-100 % across and down the camera picture. */
  camera: { zoom: number; focusX: number; focusY: number };
  /** How the verse/reference animate in when they change (same styles as the Lower Third's
   *  "Animate in" picker — see LTAnimationIn in lowerthirds/types.ts). */
  animationIn: LTAnimationIn;
}

export const CAMERA_ZOOM_MAX = 3;

export const DEFAULT_SCRIPTURE_ARCH_SETTINGS: ScriptureArchSettings = {
  cameraSceneName: "",
  accentColor: "#2254F4",
  backgroundColor: "#FFFFFF",
  textColor: "#0B1437",
  showLive: true,
  window: { x: 160, y: 140, width: 540, height: 760 },
  camera: { zoom: 1, focusX: 50, focusY: 50 },
  // "none" keeps this look's original plain cross-fade swap unchanged by default.
  animationIn: "none",
};

const SETTINGS_KEY = "mce-dock-scripture-arch-settings";

function clampDim(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
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

export type ScriptureArchSettingsInput = Partial<Omit<ScriptureArchSettings, "window" | "camera">> & {
  window?: Partial<ScriptureArchSettings["window"]>;
  camera?: Partial<ScriptureArchSettings["camera"]>;
};

export function normalizeScriptureArchSettings(raw: ScriptureArchSettingsInput | null | undefined): ScriptureArchSettings {
  const d = DEFAULT_SCRIPTURE_ARCH_SETTINGS;
  const win: Partial<ScriptureArchSettings["window"]> = raw?.window ?? {};
  const camera: Partial<ScriptureArchSettings["camera"]> = raw?.camera ?? {};
  const width = clampDim(win.width, 240, CANVAS_W, d.window.width);
  const height = clampDim(win.height, 240, CANVAS_H, d.window.height);
  return {
    cameraSceneName: typeof raw?.cameraSceneName === "string" ? raw.cameraSceneName.trim() : d.cameraSceneName,
    accentColor: isHexColor(raw?.accentColor) ? raw!.accentColor! : d.accentColor,
    backgroundColor: isHexColor(raw?.backgroundColor) ? raw!.backgroundColor! : d.backgroundColor,
    textColor: isHexColor(raw?.textColor) ? raw!.textColor! : d.textColor,
    showLive: typeof raw?.showLive === "boolean" ? raw.showLive : d.showLive,
    animationIn: LT_ANIMATIONS_IN.includes(raw?.animationIn as LTAnimationIn) ? (raw!.animationIn as LTAnimationIn) : d.animationIn,
    camera: {
      zoom: Math.round(clampRange(camera.zoom, 1, CAMERA_ZOOM_MAX, d.camera.zoom) * 100) / 100,
      focusX: Math.round(clampRange(camera.focusX, 0, 100, d.camera.focusX)),
      focusY: Math.round(clampRange(camera.focusY, 0, 100, d.camera.focusY)),
    },
    window: {
      width,
      height,
      x: clampCoord(win.x, CANVAS_W - width, d.window.x),
      y: clampCoord(win.y, CANVAS_H - height, d.window.y),
    },
  };
}

export function loadScriptureArchSettings(): ScriptureArchSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return normalizeScriptureArchSettings(saved);
  } catch {
    return { ...DEFAULT_SCRIPTURE_ARCH_SETTINGS };
  }
}

export function saveScriptureArchSettings(settings: ScriptureArchSettings): ScriptureArchSettings {
  const normalized = normalizeScriptureArchSettings(settings);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Storage might be full or unavailable; the caller still gets the normalized value back.
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Named themes — same model as Scripture Circle, its own dock-data channel.
// ---------------------------------------------------------------------------

export interface ScriptureArchTheme {
  id: string;
  name: string;
  settings: ScriptureArchSettings;
  updatedAt: string;
}

export const SCRIPTURE_ARCH_LAYOUT_PREFIX = "scripture-arch:";

export function scriptureArchLayoutId(themeId: string): string {
  return `${SCRIPTURE_ARCH_LAYOUT_PREFIX}${themeId}`;
}

export function isScriptureArchLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === "string" && layoutId.startsWith(SCRIPTURE_ARCH_LAYOUT_PREFIX);
}

export function parseScriptureArchThemeId(layoutId: string | null | undefined): string | null {
  if (!isScriptureArchLayoutId(layoutId)) return null;
  return (layoutId as string).slice(SCRIPTURE_ARCH_LAYOUT_PREFIX.length);
}

const THEMES_KEY = "mce-dock-scripture-arch-themes";
/** Durable, cross-process copy of the themes list — see the identical mechanism (and the reason
 *  for it) documented in scriptureCircleLook.ts next to THEMES_DOCK_DATA_NAME. */
const THEMES_DOCK_DATA_NAME = "scripture-arch-themes";
const THEMES_DOCK_DATA_URL = "/uploads/scripture-arch-themes.json";

function canUseTauriInvoke(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseThemesListRaw(raw: string | null | undefined): ScriptureArchTheme[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const result: ScriptureArchTheme[] = [];
    for (const item of parsed) {
      const normalized = normalizeTheme(item);
      if (normalized) result.push(normalized);
    }
    return result;
  } catch {
    return [];
  }
}

function pushThemesToDockData(themes: ScriptureArchTheme[]): void {
  const data = JSON.stringify(themes);
  void (async () => {
    if (canUseTauriInvoke()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_dock_data", { name: THEMES_DOCK_DATA_NAME, data });
        console.log(`[ScriptureArch] Pushed ${themes.length} theme(s) to dock data via Tauri invoke.`);
        return;
      } catch (err) {
        console.error("[ScriptureArch] Tauri invoke save_dock_data failed, falling back to HTTP:", err);
      }
    }
    try {
      const res = await fetch("/api/save-dock-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: THEMES_DOCK_DATA_NAME, data }),
      });
      if (!res.ok) {
        console.error(`[ScriptureArch] POST /api/save-dock-data returned ${res.status}`, await res.text().catch(() => ""));
      } else {
        console.log(`[ScriptureArch] Pushed ${themes.length} theme(s) to dock data via HTTP.`);
      }
    } catch (err) {
      console.error("[ScriptureArch] POST /api/save-dock-data failed:", err);
    }
  })();
}

export async function loadScriptureArchThemesFromDockData(): Promise<ScriptureArchTheme[]> {
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

function isValidTheme(value: unknown): value is ScriptureArchTheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.name === "string";
}

function normalizeTheme(raw: unknown): ScriptureArchTheme | null {
  if (!isValidTheme(raw)) return null;
  return {
    id: raw.id,
    name: raw.name.trim() || "Scripture Arch",
    settings: normalizeScriptureArchSettings(raw.settings as ScriptureArchSettingsInput | null | undefined),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function readThemesList(): ScriptureArchTheme[] {
  try {
    return parseThemesListRaw(localStorage.getItem(THEMES_KEY));
  } catch {
    return [];
  }
}

function writeThemesList(themes: ScriptureArchTheme[]): void {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
  } catch {
    // Storage might be full or unavailable; callers still get the values back in memory.
  }
  pushThemesToDockData(themes);
}

export function listScriptureArchThemes(): ScriptureArchTheme[] {
  const themes = readThemesList().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (themes.length > 0) pushThemesToDockData(themes);
  return themes;
}

export function getScriptureArchTheme(id: string): ScriptureArchTheme | null {
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
  return `sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueDefaultName(existing: ScriptureArchTheme[], excludeId?: string): string {
  const taken = new Set(
    existing.filter((t) => t.id !== excludeId).map((t) => t.name.trim().toLowerCase()),
  );
  const base = "Scripture Arch";
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

export function saveScriptureArchTheme(theme: { id?: string; name: string; settings: ScriptureArchSettings }): ScriptureArchTheme {
  const themes = readThemesList();
  const normalizedSettings = normalizeScriptureArchSettings(theme.settings);
  const trimmedName = theme.name.trim();

  if (theme.id) {
    const idx = themes.findIndex((t) => t.id === theme.id);
    const saved: ScriptureArchTheme = {
      id: theme.id,
      name: trimmedName || uniqueDefaultName(themes, theme.id),
      settings: normalizedSettings,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) {
      themes[idx] = saved;
    } else {
      themes.push(saved);
    }
    writeThemesList(themes);
    return saved;
  }

  const saved: ScriptureArchTheme = {
    id: generateThemeId(),
    name: trimmedName || uniqueDefaultName(themes),
    settings: normalizedSettings,
    updatedAt: new Date().toISOString(),
  };
  themes.push(saved);
  writeThemesList(themes);
  return saved;
}

export function renameScriptureArchTheme(id: string, name: string): ScriptureArchTheme | null {
  const theme = getScriptureArchTheme(id);
  if (!theme) return null;
  return saveScriptureArchTheme({ id, name, settings: theme.settings });
}

export function deleteScriptureArchTheme(id: string): void {
  const themes = readThemesList().filter((t) => t.id !== id);
  writeThemesList(themes);
}

/** The Browser source URL: colors and window geometry travel in the query string. */
export function buildScriptureArchPanelUrl(settings: ScriptureArchSettings): string {
  const base = getOverlayBaseUrlSync();
  return buildVersionedOverlayUrl(base, "mce-multiview-scripture-arch.html", {
    tab: "bible",
    mceRelay: 1,
    ...scriptureArchPanelParams(settings),
  });
}

export function scriptureArchPanelParams(settings: ScriptureArchSettings): Record<string, string | number> {
  return {
    accent: settings.accentColor.replace(/^#/, ""),
    bg: settings.backgroundColor.replace(/^#/, ""),
    text: settings.textColor.replace(/^#/, ""),
    wx: settings.window.x,
    wy: settings.window.y,
    ww: settings.window.width,
    wh: settings.window.height,
    live: settings.showLive ? 1 : 0,
    anim: settings.animationIn,
  };
}

/** The window's own bounding box, in canvas pixels — same technique as scriptureCircleLook's
 *  cameraTargetRect, adapted to a rectangular (non-square) window. */
export function cameraTargetRect(
  win: ScriptureArchSettings["window"],
  canvasScale = 1,
): { x: number; y: number; width: number; height: number } {
  return {
    x: win.x * canvasScale,
    y: win.y * canvasScale,
    width: win.width * canvasScale,
    height: win.height * canvasScale,
  };
}

async function getCanvasScale(obs: ScriptureArchObsClient): Promise<{ scale: number; width: number; height: number }> {
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
// math and settings helpers above are what scriptureArchLook.test.ts covers.
// ---------------------------------------------------------------------------

export interface ScriptureArchObsClient {
  call(type: string, params?: Record<string, unknown>): Promise<unknown>;
}

async function findSceneItem(obs: ScriptureArchObsClient, sceneName: string, sourceName: string): Promise<number | null> {
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

async function ensureScene(obs: ScriptureArchObsClient, sceneName: string): Promise<void> {
  try {
    const resp = await obs.call("GetSceneList") as { scenes?: Array<{ sceneName: string }> };
    if (resp.scenes?.some((s) => s.sceneName === sceneName)) return;
  } catch { /* fall through and try to create it */ }
  await obs.call("CreateScene", { sceneName }).catch(() => { /* another caller may have just created it */ });
}

export async function applyScriptureArchLook(
  obs: ScriptureArchObsClient,
  settings: ScriptureArchSettings,
): Promise<{ sceneName: string }> {
  if (!settings.cameraSceneName) {
    throw new Error("Choose which OBS scene has your camera first.");
  }
  const sceneName = SCRIPTURE_ARCH_SCENE_NAME;
  await ensureScene(obs, sceneName);
  const canvas = await getCanvasScale(obs);

  // 1. Background — bottom.
  let bgId = await findSceneItem(obs, sceneName, SCRIPTURE_ARCH_BG_SOURCE);
  if (bgId === null) {
    bgId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_ARCH_BG_SOURCE,
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

  // 2. Main Camera.
  let camId = await findSceneItem(obs, sceneName, settings.cameraSceneName);
  if (camId === null) {
    camId = await obs.call("CreateSceneItem", { sceneName, sourceName: settings.cameraSceneName, sceneItemEnabled: true }).then(toSceneItemId);
  }
  const camSize = await obs.call("GetSceneItemTransform", { sceneName, sceneItemId: camId })
    .then((r) => r as { sceneItemTransform?: { sourceWidth?: number; sourceHeight?: number } })
    .catch(() => null);
  const sourceWidth = camSize?.sceneItemTransform?.sourceWidth || CANVAS_W;
  const sourceHeight = camSize?.sceneItemTransform?.sourceHeight || CANVAS_H;
  const fit: FillTransform = calculateFillTransform(sourceWidth, sourceHeight, cameraTargetRect(settings.window, canvas.scale), settings.camera);
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

  // 3. Verse panel — top.
  const panelUrl = buildScriptureArchPanelUrl(settings);
  let panelId = await findSceneItem(obs, sceneName, SCRIPTURE_ARCH_PANEL_SOURCE);
  if (panelId === null) {
    panelId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_ARCH_PANEL_SOURCE,
      inputKind: "browser_source",
      inputSettings: { url: panelUrl, width: CANVAS_W, height: CANVAS_H, css: "", shutdown: false, restart_when_active: false },
      sceneItemEnabled: true,
    }).then(toSceneItemId);
  } else {
    await obs.call("SetInputSettings", {
      inputName: SCRIPTURE_ARCH_PANEL_SOURCE,
      inputSettings: { url: panelUrl },
    }).catch(() => { });
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
