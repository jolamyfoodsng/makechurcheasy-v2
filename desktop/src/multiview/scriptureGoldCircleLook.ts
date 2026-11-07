/**
 * scriptureGoldCircleLook.ts — the "Scripture Gold Circle" Multi-View look.
 *
 * A single, complete OBS look (not a slot-grid layout): a dark/gold design with the camera framed
 * in a circular window with a thin double-ring gold border, and a verse panel beside it in a serif
 * typeface. This mirrors scriptureCircleLook.ts's structure closely — see that file's header
 * comment for the full rationale. Since the camera window here is a plain circle, this module
 * reuses calculateFillTransform() and cameraTargetRect() from scriptureCircleLook.ts directly
 * rather than re-deriving the same math.
 *
 * The scene holds three items, bottom to top:
 *   1. Background   — a plain color source, a safety net behind the circle.
 *   2. Main Camera  — the user's own camera scene, cropped to fully cover the circle's bounding box.
 *   3. Verse panel  — a Browser source loading mce-multiview-scripture-gold-circle.html, opaque
 *      everywhere except the circle.
 *
 * The verse panel listens on the same local relay channel ("bible") as every Bible overlay.
 */

import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import { buildVersionedOverlayUrl } from "../services/overlayVersion";
import { calculateFillTransform, cameraTargetRect, type FillTransform } from "./scriptureCircleLook";
import { LT_ANIMATIONS_IN, type LTAnimationIn } from "../lowerthirds/types";

export const SCRIPTURE_GOLD_CIRCLE_SCENE_NAME = "MV: Scripture Gold Circle";
export const SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE = "Scripture Gold Circle Panel";
export const SCRIPTURE_GOLD_CIRCLE_BG_SOURCE = "Scripture Gold Circle Background";
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export interface ScriptureGoldCircleSettings {
  /** The OBS scene that has the user's camera — added as a Scene source, never edited itself. */
  cameraSceneName: string;
  /** Gold accent: ring, LIVE dot, eyebrow label, reference and divider. */
  accentColor: string;
  /** Page background color. */
  backgroundColor: string;
  /** Verse text color. */
  textColor: string;
  /** Show the gold dot + "LIVE" under the circle. */
  showLive: boolean;
  /** Camera window left, top and size, in 1920 x 1080 design pixels. */
  circle: { x: number; y: number; diameter: number };
  /** Framing of the camera inside the window: zoom (1 = just fills it) and the point it centers
   *  on, 0-100 % across and down the camera picture. */
  camera: { zoom: number; focusX: number; focusY: number };
  /** How the verse/reference animate in when they change (same styles as the Lower Third's
   *  "Animate in" picker — see LTAnimationIn in lowerthirds/types.ts). */
  animationIn: LTAnimationIn;
}

export const CAMERA_ZOOM_MAX = 3;

export const DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS: ScriptureGoldCircleSettings = {
  cameraSceneName: "",
  accentColor: "#D4AF6A",
  backgroundColor: "#0A0A0A",
  textColor: "#F5F1E8",
  showLive: true,
  circle: { x: 150, y: 140, diameter: 700 },
  camera: { zoom: 1, focusX: 50, focusY: 50 },
  // "none" keeps this look's original plain cross-fade swap unchanged by default.
  animationIn: "none",
};

const SETTINGS_KEY = "mce-dock-scripture-gold-circle-settings";

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

export type ScriptureGoldCircleSettingsInput = Partial<Omit<ScriptureGoldCircleSettings, "circle" | "camera">> & {
  circle?: Partial<ScriptureGoldCircleSettings["circle"]>;
  camera?: Partial<ScriptureGoldCircleSettings["camera"]>;
};

export function normalizeScriptureGoldCircleSettings(raw: ScriptureGoldCircleSettingsInput | null | undefined): ScriptureGoldCircleSettings {
  const d = DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS;
  const circle: Partial<ScriptureGoldCircleSettings["circle"]> = raw?.circle ?? {};
  const camera: Partial<ScriptureGoldCircleSettings["camera"]> = raw?.camera ?? {};
  const diameter = clampDiameter(circle.diameter, d.circle.diameter);
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
    circle: {
      diameter,
      x: clampCoord(circle.x, CANVAS_W - diameter, d.circle.x),
      y: clampCoord(circle.y, CANVAS_H - diameter, d.circle.y),
    },
  };
}

export function loadScriptureGoldCircleSettings(): ScriptureGoldCircleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return normalizeScriptureGoldCircleSettings(saved);
  } catch {
    return { ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS };
  }
}

export function saveScriptureGoldCircleSettings(settings: ScriptureGoldCircleSettings): ScriptureGoldCircleSettings {
  const normalized = normalizeScriptureGoldCircleSettings(settings);
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

export interface ScriptureGoldCircleTheme {
  id: string;
  name: string;
  settings: ScriptureGoldCircleSettings;
  updatedAt: string;
}

export const SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX = "scripture-gold-circle:";

export function scriptureGoldCircleLayoutId(themeId: string): string {
  return `${SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX}${themeId}`;
}

export function isScriptureGoldCircleLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === "string" && layoutId.startsWith(SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX);
}

export function parseScriptureGoldCircleThemeId(layoutId: string | null | undefined): string | null {
  if (!isScriptureGoldCircleLayoutId(layoutId)) return null;
  return (layoutId as string).slice(SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX.length);
}

const THEMES_KEY = "mce-dock-scripture-gold-circle-themes";
/** Durable, cross-process copy of the themes list — see the identical mechanism (and the reason
 *  for it) documented in scriptureCircleLook.ts next to THEMES_DOCK_DATA_NAME. */
const THEMES_DOCK_DATA_NAME = "scripture-gold-circle-themes";
const THEMES_DOCK_DATA_URL = "/uploads/scripture-gold-circle-themes.json";

function canUseTauriInvoke(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseThemesListRaw(raw: string | null | undefined): ScriptureGoldCircleTheme[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const result: ScriptureGoldCircleTheme[] = [];
    for (const item of parsed) {
      const normalized = normalizeTheme(item);
      if (normalized) result.push(normalized);
    }
    return result;
  } catch {
    return [];
  }
}

function pushThemesToDockData(themes: ScriptureGoldCircleTheme[]): void {
  const data = JSON.stringify(themes);
  void (async () => {
    if (canUseTauriInvoke()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_dock_data", { name: THEMES_DOCK_DATA_NAME, data });
        console.log(`[ScriptureGoldCircle] Pushed ${themes.length} theme(s) to dock data via Tauri invoke.`);
        return;
      } catch (err) {
        console.error("[ScriptureGoldCircle] Tauri invoke save_dock_data failed, falling back to HTTP:", err);
      }
    }
    try {
      const res = await fetch("/api/save-dock-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: THEMES_DOCK_DATA_NAME, data }),
      });
      if (!res.ok) {
        console.error(`[ScriptureGoldCircle] POST /api/save-dock-data returned ${res.status}`, await res.text().catch(() => ""));
      } else {
        console.log(`[ScriptureGoldCircle] Pushed ${themes.length} theme(s) to dock data via HTTP.`);
      }
    } catch (err) {
      console.error("[ScriptureGoldCircle] POST /api/save-dock-data failed:", err);
    }
  })();
}

export async function loadScriptureGoldCircleThemesFromDockData(): Promise<ScriptureGoldCircleTheme[]> {
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

function isValidTheme(value: unknown): value is ScriptureGoldCircleTheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.name === "string";
}

function normalizeTheme(raw: unknown): ScriptureGoldCircleTheme | null {
  if (!isValidTheme(raw)) return null;
  return {
    id: raw.id,
    name: raw.name.trim() || "Scripture Gold Circle",
    settings: normalizeScriptureGoldCircleSettings(raw.settings as ScriptureGoldCircleSettingsInput | null | undefined),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function readThemesList(): ScriptureGoldCircleTheme[] {
  try {
    return parseThemesListRaw(localStorage.getItem(THEMES_KEY));
  } catch {
    return [];
  }
}

function writeThemesList(themes: ScriptureGoldCircleTheme[]): void {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
  } catch {
    // Storage might be full or unavailable; callers still get the values back in memory.
  }
  pushThemesToDockData(themes);
}

export function listScriptureGoldCircleThemes(): ScriptureGoldCircleTheme[] {
  const themes = readThemesList().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (themes.length > 0) pushThemesToDockData(themes);
  return themes;
}

export function getScriptureGoldCircleTheme(id: string): ScriptureGoldCircleTheme | null {
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
  return `sg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueDefaultName(existing: ScriptureGoldCircleTheme[], excludeId?: string): string {
  const taken = new Set(
    existing.filter((t) => t.id !== excludeId).map((t) => t.name.trim().toLowerCase()),
  );
  const base = "Scripture Gold Circle";
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

export function saveScriptureGoldCircleTheme(theme: { id?: string; name: string; settings: ScriptureGoldCircleSettings }): ScriptureGoldCircleTheme {
  const themes = readThemesList();
  const normalizedSettings = normalizeScriptureGoldCircleSettings(theme.settings);
  const trimmedName = theme.name.trim();

  if (theme.id) {
    const idx = themes.findIndex((t) => t.id === theme.id);
    const saved: ScriptureGoldCircleTheme = {
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

  const saved: ScriptureGoldCircleTheme = {
    id: generateThemeId(),
    name: trimmedName || uniqueDefaultName(themes),
    settings: normalizedSettings,
    updatedAt: new Date().toISOString(),
  };
  themes.push(saved);
  writeThemesList(themes);
  return saved;
}

export function renameScriptureGoldCircleTheme(id: string, name: string): ScriptureGoldCircleTheme | null {
  const theme = getScriptureGoldCircleTheme(id);
  if (!theme) return null;
  return saveScriptureGoldCircleTheme({ id, name, settings: theme.settings });
}

export function deleteScriptureGoldCircleTheme(id: string): void {
  const themes = readThemesList().filter((t) => t.id !== id);
  writeThemesList(themes);
}

/** The Browser source URL: colors and circle geometry travel in the query string. */
export function buildScriptureGoldCirclePanelUrl(settings: ScriptureGoldCircleSettings): string {
  const base = getOverlayBaseUrlSync();
  return buildVersionedOverlayUrl(base, "mce-multiview-scripture-gold-circle.html", {
    tab: "bible",
    mceRelay: 1,
    ...scriptureGoldCirclePanelParams(settings),
  });
}

export function scriptureGoldCirclePanelParams(settings: ScriptureGoldCircleSettings): Record<string, string | number> {
  return {
    accent: settings.accentColor.replace(/^#/, ""),
    bg: settings.backgroundColor.replace(/^#/, ""),
    text: settings.textColor.replace(/^#/, ""),
    cx: settings.circle.x,
    cy: settings.circle.y,
    cd: settings.circle.diameter,
    live: settings.showLive ? 1 : 0,
    anim: settings.animationIn,
  };
}

async function getCanvasScale(obs: ScriptureGoldCircleObsClient): Promise<{ scale: number; width: number; height: number }> {
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
// math and settings helpers above are what scriptureGoldCircleLook.test.ts covers.
// ---------------------------------------------------------------------------

export interface ScriptureGoldCircleObsClient {
  call(type: string, params?: Record<string, unknown>): Promise<unknown>;
}

async function findSceneItem(obs: ScriptureGoldCircleObsClient, sceneName: string, sourceName: string): Promise<number | null> {
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

async function ensureScene(obs: ScriptureGoldCircleObsClient, sceneName: string): Promise<void> {
  try {
    const resp = await obs.call("GetSceneList") as { scenes?: Array<{ sceneName: string }> };
    if (resp.scenes?.some((s) => s.sceneName === sceneName)) return;
  } catch { /* fall through and try to create it */ }
  await obs.call("CreateScene", { sceneName }).catch(() => { /* another caller may have just created it */ });
}

export async function applyScriptureGoldCircleLook(
  obs: ScriptureGoldCircleObsClient,
  settings: ScriptureGoldCircleSettings,
): Promise<{ sceneName: string }> {
  if (!settings.cameraSceneName) {
    throw new Error("Choose which OBS scene has your camera first.");
  }
  const sceneName = SCRIPTURE_GOLD_CIRCLE_SCENE_NAME;
  await ensureScene(obs, sceneName);
  const canvas = await getCanvasScale(obs);

  // 1. Background — bottom.
  let bgId = await findSceneItem(obs, sceneName, SCRIPTURE_GOLD_CIRCLE_BG_SOURCE);
  if (bgId === null) {
    bgId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_GOLD_CIRCLE_BG_SOURCE,
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
  const fit: FillTransform = calculateFillTransform(sourceWidth, sourceHeight, cameraTargetRect(settings.circle, canvas.scale), settings.camera);
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
  const panelUrl = buildScriptureGoldCirclePanelUrl(settings);
  let panelId = await findSceneItem(obs, sceneName, SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE);
  if (panelId === null) {
    panelId = await obs.call("CreateInput", {
      sceneName,
      inputName: SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE,
      inputKind: "browser_source",
      inputSettings: { url: panelUrl, width: CANVAS_W, height: CANVAS_H, css: "", shutdown: false, restart_when_active: false },
      sceneItemEnabled: true,
    }).then(toSceneItemId);
  } else {
    await obs.call("SetInputSettings", {
      inputName: SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE,
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
