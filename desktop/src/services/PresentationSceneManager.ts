/**
 * PresentationSceneManager.ts — Centralized scene manager for the new single-scene architecture.
 *
 * Architecture:
 * - ONE main scene: "MCE Presentation"
 * - Program scene reference at the bottom of MCE Presentation (z-index 0)
 * - Multiple sources inside MCE Presentation:
 *   - MCE Bible (browser source)
 *   - MCE Worship (browser source)
 *   - MCE Media (browser source)
 *   - MCE Notes (browser source)
 *   - MCE Lower Third (browser source)
 *   - Background sources for each module
 *
 * Only the active source should be visible at any time.
 * When Bible is presented: Bible = visible, others = hidden
 * When Worship is presented: Worship = visible, others = hidden
 * When Media is presented: Media = visible, others = hidden
 *
 * Preview/Program workflow:
 * - MCE Presentation is set as the Preview scene in OBS
 * - User switches Preview → Program when ready to go live
 */

import { obsService } from "./obsService";
import { getOverlayBaseUrlSync } from "./overlayUrl";
import { buildVersionedOverlayUrl } from "./overlayVersion";

/** Same native setting key the Dock uses for the Program scenes it put under MCE Presentation. */
const PROGRAM_BACKGROUND_MANAGED_SCENES_KEY = "ocs-dock-program-background-scenes-v1";

/** Reads the Dock's Program background choice fresh; unreadable counts as off. */
async function programBackgroundIsOn(): Promise<boolean> {
  try {
    const [{ reloadNativeDockSettings }, { loadProjectionSettings }] = await Promise.all([
      import("./localDockSettings"),
      import("../dock/dockProjectionSettings"),
    ]);
    await reloadNativeDockSettings(["ocs-dock-projection-settings"]);
    return loadProjectionSettings().sceneMode === "auto-duplicate";
  } catch {
    return false;
  }
}

async function rememberProgramBackgroundScene(name: string): Promise<void> {
  try {
    const { readNativeDockSetting, writeNativeDockSetting } = await import("./localDockSettings");
    const stored = readNativeDockSetting<unknown>(PROGRAM_BACKGROUND_MANAGED_SCENES_KEY);
    const names = new Set(Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : []);
    if (names.has(name)) return;
    names.add(name);
    await writeNativeDockSetting(PROGRAM_BACKGROUND_MANAGED_SCENES_KEY, [...names].sort());
  } catch {
    // Best effort: without the record the Dock just leaves this one in place.
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PRESENTATION_SCENE_NAME = "MCE Presentation";
/** Source name for the user's program scene reference at the bottom of MCE Presentation */
export const PROGRAM_SCENE_SOURCE_NAME = "MCE Program Scene Reference";

/**
 * Worship and Notes share ONE browser source (and one background source) in
 * MCE Presentation. Projecting either one updates that source: it loads the
 * Worship page for songs and the Notes page for notes.
 */
export const SHARED_WORSHIP_NOTES_SOURCE_NAME = "Worship - MCE Presentation";
export const SHARED_WORSHIP_NOTES_BG_SOURCE_NAME = "Worship BG - MCE Presentation";

/**
 * The separate Notes sources older versions created. They are no longer used
 * and are removed from OBS when found.
 */
export const LEGACY_NOTES_SOURCE_NAMES: readonly string[] = [
  "Notes - MCE Presentation",
  "Notes BG - MCE Presentation",
  "MCE Browser - Notes",
  "MCE Notes",
  "MCE BG - Notes",
  "MCE Notes BG",
];

/** Source names for each module (descriptor first for visibility when OBS docks are narrowed) */
export const SOURCE_NAMES = {
  BIBLE: "Bible - MCE Presentation",
  WORSHIP: SHARED_WORSHIP_NOTES_SOURCE_NAME,
  MEDIA: "Media - MCE Presentation",
  NOTES: SHARED_WORSHIP_NOTES_SOURCE_NAME,
  LOWER_THIRD: "Lower Third - MCE Presentation",
} as const;

/** Background source names */
export const BG_SOURCE_NAMES = {
  BIBLE: "Bible BG - MCE Presentation",
  WORSHIP: SHARED_WORSHIP_NOTES_BG_SOURCE_NAME,
  MEDIA: "Media BG - MCE Presentation",
  NOTES: SHARED_WORSHIP_NOTES_BG_SOURCE_NAME,
  LOWER_THIRD: "Lower Third BG - MCE Presentation",
} as const;

/** Fullscreen source names */
export const FULLSCREEN_SOURCE_NAMES = {
  BIBLE: "Bible - MCE Presentation",
  WORSHIP: SHARED_WORSHIP_NOTES_SOURCE_NAME,
  COUNTDOWN: "Countdown - MCE Presentation",
  NOTES: SHARED_WORSHIP_NOTES_SOURCE_NAME,
} as const;

/** Fullscreen background source names */
export const FULLSCREEN_BG_SOURCE_NAMES = {
  BIBLE: "Bible BG - MCE Presentation",
  WORSHIP: SHARED_WORSHIP_NOTES_BG_SOURCE_NAME,
  COUNTDOWN: "Countdown BG - MCE Presentation",
  NOTES: SHARED_WORSHIP_NOTES_BG_SOURCE_NAME,
} as const;

/** Map of current source names to their legacy aliases for backward compatibility */
export function getLegacySourceAliases(name: string): string[] {
  const map: Record<string, string[]> = {
    "Bible - MCE Presentation": [],
    "Worship - MCE Presentation": ["MCE Browser - Worship", "MCE Worship"],
    "Media - MCE Presentation": ["MCE Media"],
    "Notes - MCE Presentation": ["MCE Browser - Notes", "MCE Notes"],
    "Lower Third - MCE Presentation": ["Lower Third - MCE Lower Third", "MCE Lower Third", "MCE Lower Thirds"],
    "Countdown - MCE Presentation": ["MCE Browser - Countdown", "MCE Countdown"],
    "Bible BG - MCE Presentation": ["MCE BG - Bible", "MCE Bible BG"],
    "Worship BG - MCE Presentation": ["MCE BG - Worship", "MCE Worship BG"],
    "Media BG - MCE Presentation": ["MCE Media BG"],
    "Notes BG - MCE Presentation": ["MCE BG - Notes", "MCE Notes BG"],
    "Countdown BG - MCE Presentation": ["MCE BG - Countdown", "MCE Countdown BG"],
    "Video - MCE Presentation": ["Video - MCE Media", "MCE Media - Video", "MCE Media", "MCE Video"],
    "Image - MCE Presentation": ["Image - MCE Media", "MCE Media - Image", "MCE Image"],
    "Audio - MCE Presentation": ["Audio - MCE Media", "MCE Media - Audio", "Audio - MCE Media Image", "MCE Media - Image Audio"],
    "Pattern - MCE Presentation": ["Pattern - MCE Media", "MCE Media - Pattern"],
    "Template - MCE Presentation": ["Template - MCE Media"],
    "Remote - MCE Presentation": ["Remote - MCE Media", "MCE Media - Remote"],
    "Ticker - MCE Presentation": ["Ticker - MCE Ticker", "MCE Ticker"],
    "Animated Lower Thirds - MCE Presentation": ["Animated Lower Thirds - MCE", "MCE Animated Lower Thirds"],
    "Fullscreen BG - MCE Presentation": ["Fullscreen BG - MCE"],
  };
  return map[name] || [];
}

/** Source types */
export type SourceType = keyof typeof SOURCE_NAMES;

/** Module type for identifying which module to show/hide */
export type ModuleType = "bible" | "worship" | "media" | "notes" | "lower-third" | "fullscreen-bible" | "fullscreen-worship" | "fullscreen-countdown" | "fullscreen-notes";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SourceInfo {
  sceneItemId: number;
  sceneUuid: string;
}

interface SceneState {
  sceneUuid: string | null;
  sources: Map<string, SourceInfo>;
  bgSources: Map<string, SourceInfo>;
}

const _state: SceneState = {
  sceneUuid: null,
  sources: new Map(),
  bgSources: new Map(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCanvasSize(): Promise<{ width: number; height: number }> {
  try {
    const video = await obsService.getVideoSettings();
    return {
      width: Number(video.baseWidth) || 1920,
      height: Number(video.baseHeight) || 1080,
    };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

function normalizeBrowserSourceDocumentUrl(url: string | undefined): string {
  const trimmed = String(url || "").trim();
  if (!trimmed || trimmed === "about:blank") return "";
  const hashIndex = trimmed.indexOf("#");
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
}

function getOverlayUrlForModule(module: string): string {
  const base = getOverlayBaseUrlSync();
  switch (module) {
    case "bible":
    case "fullscreen-bible":
      return buildVersionedOverlayUrl(base, "mce-bible-overlay.html", { tab: "bible" });
    case "worship":
    case "fullscreen-worship":
      return buildVersionedOverlayUrl(base, "mce-worship-overlay.html");
    case "notes":
    case "fullscreen-notes":
      return buildVersionedOverlayUrl(base, "mce-note.html");
    case "media":
      return buildVersionedOverlayUrl(base, "mce-media-overlay.html");
    case "lower-third":
      return buildVersionedOverlayUrl(base, "lower-third-overlay.html");
    case "fullscreen-countdown":
      return buildVersionedOverlayUrl(base, "pre-service-countdown.html");
    default:
      return buildVersionedOverlayUrl(base, "mce-bible-overlay.html", { tab: "bible" });
  }
}

// ---------------------------------------------------------------------------
// PresentationSceneManager
// ---------------------------------------------------------------------------

class PresentationSceneManager {
  /**
   * Ensure the MCE Presentation scene exists.
   * Creates the scene if it doesn't exist and adds the program scene reference.
   * Sources are created lazily — only when ensureModuleSource() is called.
   */
  async ensurePresentationScene(): Promise<{ sceneName: string; sceneUuid: string }> {
    this._assertConnected();

    // ── 1. Ensure the presentation scene exists ──
    let sceneUuid = _state.sceneUuid;

    if (!sceneUuid) {
      const scenes = await obsService.getSceneList();
      const existing = scenes.find((s) => s.sceneName === PRESENTATION_SCENE_NAME);
      if (existing) {
        sceneUuid = existing.sceneUuid;
        _state.sceneUuid = sceneUuid;
      } else {
        await obsService.createScene(PRESENTATION_SCENE_NAME);
        const updated = await obsService.getSceneList();
        const created = updated.find((s) => s.sceneName === PRESENTATION_SCENE_NAME);
        if (created) {
          sceneUuid = created.sceneUuid;
          _state.sceneUuid = sceneUuid;
        }
      }
    }

    if (!sceneUuid) {
      throw new Error(`Failed to ensure scene: ${PRESENTATION_SCENE_NAME}`);
    }

    // ── 2. Ensure program scene reference at bottom ──
    await this.ensureProgramSceneReference();

    return { sceneName: PRESENTATION_SCENE_NAME, sceneUuid };
  }

  /**
   * Ensure the user's program scene is referenced as a scene source at the bottom of MCE Presentation.
   * This acts as a background layer so when all overlays are hidden, the user sees their program scene.
   */
  async ensureProgramSceneReference(): Promise<void> {
    this._assertConnected();
    const sceneName = PRESENTATION_SCENE_NAME;

    // Dock → Advanced OBS Output → Program background. Off (the default) keeps MCE Presentation
    // overlay-only, so nothing is put under it from here either.
    if (!(await programBackgroundIsOn())) return;

    // Get the current program scene name from OBS
    let programSceneName: string;
    try {
      const resp = await obsService.call("GetCurrentProgramScene") as { currentProgramSceneName: string };
      programSceneName = resp.currentProgramSceneName;
    } catch {
      console.warn("[PresentationScene] Could not get current program scene");
      return;
    }

    // Don't add MCE Presentation as a reference to itself
    if (programSceneName === sceneName) {
      return;
    }

    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];

      // Check if the program scene reference already exists
      const existing = items.find((item) => item.sourceName === programSceneName);
      if (existing) {
        return;
      }

      // Add the program scene as a scene source
      const sceneItemId = await obsService.createSceneItem(sceneName, programSceneName);
      // Recorded like the Dock's own, so turning Program background off removes it again.
      void rememberProgramBackgroundScene(programSceneName);

      // Move it to the bottom of the source stack (z-index 0)
      // By setting it to position 0 in the scene item order
      const canvas = await getCanvasSize();
      await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: 0,
        positionY: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth: canvas.width,
        boundsHeight: canvas.height,
        boundsAlignment: 0,
        rotation: 0,
      });

      // Move to bottom by setting the item order to 0
      try {
        await obsService.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId,
          sceneItemIndex: 0,
        });
      } catch {
        // Best effort — scene might not support reordering
      }

    } catch (err) {
      console.warn("[PresentationScene] Failed to add program scene reference:", err);
    }
  }

  /**
   * Ensure a browser source exists in the presentation scene.
   */
  private async ensureSource(
    sceneName: string,
    sourceName: string,
    inputKind: string,
    canvas: { width: number; height: number },
    moduleKey: string
  ): Promise<void> {
    const overlayUrl = getOverlayUrlForModule(moduleKey);

    // Check if source already exists in scene
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];

      // Clean off legacy MCE Browser - Bible and BG so they do not remain triggered
      if (sourceName === SOURCE_NAMES.BIBLE) {
        const legacyItems = items.filter((item) =>
          item.sourceName === "MCE Browser - Bible" ||
          item.sourceName === "MCE Bible" ||
          item.sourceName === "MCE BG - Bible" ||
          item.sourceName === "MCE Bible BG"
        );
        for (const leg of legacyItems) {
          try {
            await obsService.call("RemoveSceneItem", { sceneName, sceneItemId: leg.sceneItemId });
          } catch { /* ok */ }
        }
      }

      const existing = items.find((item) => item.sourceName === sourceName);
      if (existing) {
        _state.sources.set(sourceName, {
          sceneItemId: existing.sceneItemId,
          sceneUuid: _state.sceneUuid ?? "",
        });
        await obsService.setSceneItemTransform(sceneName, existing.sceneItemId, {
          positionX: 0,
          positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width,
          boundsHeight: canvas.height,
          boundsAlignment: 0,
          rotation: 0,
        }).catch(() => { });
        await this.ensureBrowserSourceUrl(existing.sourceName, overlayUrl, canvas);
        return;
      }
    } catch { /* scene might be empty */ }

    // Create the source
    try {
      const sceneItemId = await obsService.createInput(
        sceneName,
        sourceName,
        inputKind,
        {
          url: overlayUrl,
          width: canvas.width,
          height: canvas.height,
          css: "",
          shutdown: false,
          restart_when_active: false,
        }
      );

      _state.sources.set(sourceName, {
        sceneItemId,
        sceneUuid: _state.sceneUuid ?? "",
      });

      // Stretch to fill canvas
      await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: 0,
        positionY: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth: canvas.width,
        boundsHeight: canvas.height,
        boundsAlignment: 0,
        rotation: 0,
      });

      // Start hidden
      await this.setSourceEnabled(sceneName, sceneItemId, false);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        // Source exists globally — add to scene
        try {
          const sceneItemId = await obsService.createSceneItem(sceneName, sourceName);
          _state.sources.set(sourceName, {
            sceneItemId,
            sceneUuid: _state.sceneUuid ?? "",
          });
          await obsService.setSceneItemTransform(sceneName, sceneItemId, {
            positionX: 0,
            positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: canvas.width,
            boundsHeight: canvas.height,
            boundsAlignment: 0,
            rotation: 0,
          }).catch(() => { });
          await this.ensureBrowserSourceUrl(sourceName, overlayUrl, canvas);
          await this.setSourceEnabled(sceneName, sceneItemId, false);
        } catch { /* ok */ }
      } else {
        console.warn(`[PresentationScene] Failed to create source: ${sourceName}`, err);
      }
    }
  }

  /**
   * Ensure a background source exists in the presentation scene.
   */
  private async ensureBgSource(
    sceneName: string,
    bgSourceName: string,
    canvas: { width: number; height: number },
    _moduleKey: string
  ): Promise<void> {
    // Check if BG source already exists in scene
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
      // If the module's browser overlay is already present in this scene,
      // it will render its own background via CSS. Skip creating a separate
      // BG input to avoid duplicate layers.
      try {
        const moduleSource = this.getModuleName(_moduleKey as ModuleType);
        if (moduleSource && items.some((item) => item.sourceName === moduleSource)) return;
      } catch { /* ignore */ }
      const bgAliases = getLegacySourceAliases(bgSourceName);
      const existing = items.find((item) => item.sourceName === bgSourceName || bgAliases.includes(item.sourceName));
      if (existing) {
        _state.bgSources.set(bgSourceName, {
          sceneItemId: existing.sceneItemId,
          sceneUuid: _state.sceneUuid ?? "",
        });
        return;
      }
    } catch { /* scene might be empty */ }

    // Create a color source as background
    try {
      const defaultColor = 0xFF000000; // ABGR: fully opaque black
      const sceneItemId = await obsService.createInput(
        sceneName,
        bgSourceName,
        "color_source_v3",
        {
          color: defaultColor,
          width: canvas.width,
          height: canvas.height,
        }
      );

      _state.bgSources.set(bgSourceName, {
        sceneItemId,
        sceneUuid: _state.sceneUuid ?? "",
      });

      // Stretch to fill canvas
      await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: 0,
        positionY: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth: canvas.width,
        boundsHeight: canvas.height,
        boundsAlignment: 0,
        rotation: 0,
      });

      // Start hidden
      await this.setSourceEnabled(sceneName, sceneItemId, false);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        // Source exists globally — add to scene
        try {
          const sceneItemId = await obsService.createSceneItem(sceneName, bgSourceName);
          _state.bgSources.set(bgSourceName, {
            sceneItemId,
            sceneUuid: _state.sceneUuid ?? "",
          });
          await this.setSourceEnabled(sceneName, sceneItemId, false);
        } catch { /* ok */ }
      } else {
        console.warn(`[PresentationScene] Failed to create BG source: ${bgSourceName}`, err);
      }
    }
  }

  private async ensureBrowserSourceUrl(
    inputName: string,
    expectedUrl: string,
    canvas: { width: number; height: number },
  ): Promise<void> {
    try {
      const resp = await obsService.call("GetInputSettings", { inputName }) as {
        inputSettings?: { url?: unknown; width?: unknown; height?: unknown };
      };
      const currentUrl = typeof resp.inputSettings?.url === "string" ? resp.inputSettings.url : "";
      const currentWidth = Number(resp.inputSettings?.width);
      const currentHeight = Number(resp.inputSettings?.height);
      if (
        normalizeBrowserSourceDocumentUrl(currentUrl) === expectedUrl &&
        currentWidth === canvas.width &&
        currentHeight === canvas.height
      ) return;

      await obsService.call("SetInputSettings", {
        inputName,
        inputSettings: {
          url: expectedUrl,
          width: canvas.width,
          height: canvas.height,
        },
      });
    } catch {
      // Best effort. Some existing source types may not expose URL settings.
    }
  }

  /**
   * Enable or disable a scene item.
   */
  private async setSourceEnabled(sceneName: string, sceneItemId: number, enabled: boolean): Promise<void> {
    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId,
        sceneItemEnabled: enabled,
      });
    } catch {
      // Best effort
    }
  }

  /** True once the old separate Notes sources were looked for in this app session. */
  private _legacyNotesSourcesChecked = false;

  /**
   * Worship and Notes now share one source, so the separate Notes source and
   * Notes background that older versions created are removed from OBS. Done
   * once per app session; only the exact MakeChurchEazy names are touched.
   */
  private async removeLegacyNotesSources(): Promise<void> {
    if (this._legacyNotesSourcesChecked) return;
    this._legacyNotesSourcesChecked = true;
    try {
      const resp = await obsService.call("GetInputList") as { inputs?: Array<{ inputName: string }> };
      const present = new Set((resp.inputs ?? []).map((input) => input.inputName));
      for (const name of LEGACY_NOTES_SOURCE_NAMES) {
        if (!present.has(name)) continue;
        try {
          await obsService.call("RemoveInput", { inputName: name });
        } catch { /* best effort */ }
        _state.sources.delete(name);
        _state.bgSources.delete(name);
      }
    } catch {
      // Allow another attempt on the next call if OBS could not be queried.
      this._legacyNotesSourcesChecked = false;
    }
  }

  /**
   * Ensure a specific module's source (+ BG) exists in the presentation scene.
   * Creates the source lazily — only when first requested.
   */
  async ensureModuleSource(module: ModuleType): Promise<void> {
    await this.ensurePresentationScene();
    await this.removeLegacyNotesSources();
    const canvas = await getCanvasSize();
    const sceneName = PRESENTATION_SCENE_NAME;

    const sourceName = this.getModuleName(module);
    if (sourceName) {
      await this.ensureSource(sceneName, sourceName, "browser_source", canvas, module);
    }

    const bgSourceName = this.getBgModuleName(module);
    if (bgSourceName) {
      await this.ensureBgSource(sceneName, bgSourceName, canvas, module);
    }
  }

  /**
   * Show a specific module's source and hide all others.
   * Lazily creates only the requested module's sources (not all 16).
   */
  async showModule(module: ModuleType): Promise<void> {
    await this.ensurePresentationScene();
    await this.removeLegacyNotesSources();
    const sceneName = PRESENTATION_SCENE_NAME;

    // Map module to source name
    const sourceName = this.getModuleName(module);
    if (!sourceName) {
      console.warn(`[PresentationScene] Unknown module: ${module}`);
      return;
    }

    // Lazily create only this module's sources
    const canvas = await getCanvasSize();
    await this.ensureSource(sceneName, sourceName, "browser_source", canvas, module);

    const bgSourceName = this.getBgModuleName(module);
    if (bgSourceName) {
      await this.ensureBgSource(sceneName, bgSourceName, canvas, module);
    }

    // Sync known sources from OBS (in case other code paths added sources)
    await this._syncSourcesFromObs(sceneName);

    // Hide all known sources first
    await this.hideAllSources(sceneName);

    // Show the requested module's source
    const sourceInfo = _state.sources.get(sourceName);
    if (sourceInfo) {
      await this.setSourceEnabled(sceneName, sourceInfo.sceneItemId, true);
    }

    // Show the corresponding background source
    if (bgSourceName) {
      const bgInfo = _state.bgSources.get(bgSourceName);
      if (bgInfo) {
        await this.setSourceEnabled(sceneName, bgInfo.sceneItemId, true);
      }
    }
  }

  /**
   * Hide all sources in the presentation scene.
   */
  async hideAllSources(sceneName?: string): Promise<void> {
    const targetScene = sceneName || PRESENTATION_SCENE_NAME;

    // Hide all main sources
    for (const [, sourceInfo] of _state.sources) {
      await this.setSourceEnabled(targetScene, sourceInfo.sceneItemId, false);
    }

    // Hide all background sources
    for (const [, bgInfo] of _state.bgSources) {
      await this.setSourceEnabled(targetScene, bgInfo.sceneItemId, false);
    }
  }

  /**
   * Sync the internal source maps from OBS.
   * Discovers sources that were created by other code paths (e.g. dockObsClient)
   * and registers them so hideAllSources() can manage their visibility.
   */
  private async _syncSourcesFromObs(sceneName: string): Promise<void> {
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];

      // Build lookup of all known source names (regular + BG + fullscreen + fullscreen BG)
      const allKnownNames = new Set<string>();
      for (const name of Object.values(SOURCE_NAMES)) allKnownNames.add(name);
      for (const name of Object.values(BG_SOURCE_NAMES)) allKnownNames.add(name);
      for (const name of Object.values(FULLSCREEN_SOURCE_NAMES)) allKnownNames.add(name);
      for (const name of Object.values(FULLSCREEN_BG_SOURCE_NAMES)) allKnownNames.add(name);

      for (const item of items) {
        if (!allKnownNames.has(item.sourceName)) continue;

        if (Object.values(SOURCE_NAMES).includes(item.sourceName as any) ||
          Object.values(FULLSCREEN_SOURCE_NAMES).includes(item.sourceName as any)) {
          if (!_state.sources.has(item.sourceName)) {
            _state.sources.set(item.sourceName, {
              sceneItemId: item.sceneItemId,
              sceneUuid: _state.sceneUuid ?? "",
            });
          }
        } else {
          if (!_state.bgSources.has(item.sourceName)) {
            _state.bgSources.set(item.sourceName, {
              sceneItemId: item.sceneItemId,
              sceneUuid: _state.sceneUuid ?? "",
            });
          }
        }
      }
    } catch { /* best effort */ }
  }

  /**
   * Get the source name for a module.
   */
  private getModuleName(module: ModuleType): string | null {
    switch (module) {
      case "bible": return SOURCE_NAMES.BIBLE;
      case "worship": return SOURCE_NAMES.WORSHIP;
      case "media": return SOURCE_NAMES.MEDIA;
      case "notes": return SOURCE_NAMES.NOTES;
      case "lower-third": return SOURCE_NAMES.LOWER_THIRD;
      case "fullscreen-bible": return FULLSCREEN_SOURCE_NAMES.BIBLE;
      case "fullscreen-worship": return FULLSCREEN_SOURCE_NAMES.WORSHIP;
      case "fullscreen-countdown": return FULLSCREEN_SOURCE_NAMES.COUNTDOWN;
      case "fullscreen-notes": return FULLSCREEN_SOURCE_NAMES.NOTES;
      default: return null;
    }
  }

  /**
   * Get the background source name for a module.
   */
  private getBgModuleName(module: ModuleType): string | null {
    switch (module) {
      case "bible": return BG_SOURCE_NAMES.BIBLE;
      case "worship": return BG_SOURCE_NAMES.WORSHIP;
      case "media": return BG_SOURCE_NAMES.MEDIA;
      case "notes": return BG_SOURCE_NAMES.NOTES;
      case "lower-third": return BG_SOURCE_NAMES.LOWER_THIRD;
      case "fullscreen-bible": return FULLSCREEN_BG_SOURCE_NAMES.BIBLE;
      case "fullscreen-worship": return FULLSCREEN_BG_SOURCE_NAMES.WORSHIP;
      case "fullscreen-countdown": return FULLSCREEN_BG_SOURCE_NAMES.COUNTDOWN;
      default: return null;
    }
  }

  /**
   * Update a browser source's CSS data for a specific module.
   */
  async updateModuleCss(module: ModuleType, css: string): Promise<void> {
    const sourceName = this.getModuleName(module);
    if (!sourceName) return;

    try {
      await obsService.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: { css },
      });
    } catch (err) {
      console.warn(`[PresentationScene] Failed to update CSS for ${module}:`, err);
    }
  }

  /**
   * Update a browser source's URL for a specific module.
   */
  async updateModuleUrl(module: ModuleType, url: string): Promise<void> {
    const sourceName = this.getModuleName(module);
    if (!sourceName) return;

    try {
      await obsService.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: { url },
      });
    } catch (err) {
      console.warn(`[PresentationScene] Failed to update URL for ${module}:`, err);
    }
  }

  /**
   * Update a background source's color for a specific module.
   */
  async updateModuleBgColor(module: ModuleType, color: number): Promise<void> {
    const bgSourceName = this.getBgModuleName(module);
    if (!bgSourceName) return;

    try {
      await obsService.call("SetInputSettings", {
        inputName: bgSourceName,
        inputSettings: { color },
      });
    } catch (err) {
      console.warn(`[PresentationScene] Failed to update BG color for ${module}:`, err);
    }
  }

  /**
   * Show the presentation scene in OBS (go live).
   */
  async showLive(): Promise<void> {
    await this.ensurePresentationScene();

    const studioMode = await obsService.getStudioModeEnabled();
    if (studioMode) {
      await obsService.setCurrentProgramScene(PRESENTATION_SCENE_NAME);
    } else {
      await obsService.setCurrentProgramScene(PRESENTATION_SCENE_NAME);
    }
  }

  private _assertConnected(): void {
    if (!obsService.isConnected) {
      throw new Error("OBS is not connected");
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const presentationSceneManager = new PresentationSceneManager();
