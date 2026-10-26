/**
 * dockObsClient.ts — Lightweight OBS WebSocket client for the dock page.
 *
 * The dock runs in OBS's embedded CEF browser (or a separate browser tab),
 * which is a different process from the main Tauri app. BroadcastChannel
 * does NOT work cross-process, so the dock must talk to OBS directly.
 *
 * Strategy (dedicated overlay scenes):
 *   1. Connect to OBS WebSocket.
 *   2. Bible / Worship fullscreen: create a dedicated scene
 *      (e.g. "MCE Bible") containing the background + browser overlay
 *      sources. Then add that scene as a nested "scene source" into the
 *      user's current Preview or Program scene.
 *   3. Lower-thirds / Ticker: create a browser source directly in the
 *      user's scene (overlays are lightweight, no BG needed).
 *   4. "Send to Preview" → Auto-enable Studio Mode if off, then push
 *      overlay to Preview scene. Hide overlay in Program to prevent
 *      the global URL update from leaking across.
 *   5. "Send to OBS"     → send overlay to the configured OBS destination.
 *      Hide overlay in Preview to prevent cross-contamination.
 *   6. "Clear"           → blank / hide the overlay source.
 *
 * Connection params are resolved in this order:
 *   1. URL query params: ?obsUrl=ws://...&obsPassword=...
 *   2. Native Dock settings key "ocs-dock-obs-params" (with "mv-settings"
 *      retained as a migrated legacy value)
 *   3. Default: ws://localhost:4455 with no password
 */

import OBSWebSocket from "obs-websocket-js";
import { getDefaultOBSUrl, getDefaultCanvasSize, getDefaultLowerThirdTheme } from "../services/desktopConfig";
import { normalizeOBSWebSocketUrl } from "../services/obsWebSocketUrl";
import { stripCompatModeCSS } from "../services/performanceManager";
import * as connTracker from "../services/obsConnectionTracker";
import * as obsQueue from "../services/obsRequestQueue";
import * as browserQueue from "../services/browserUpdateQueue";
import type { ThemeLike } from "../lowerthirds/themes";
import { getWorshipLTFavorites } from "../services/favoriteThemes";
import { getOverlayBaseUrlSync, resolveOverlayAssetUrl } from "../services/overlayUrl";
import { OVERLAY_HTML_VERSION, buildVersionedOverlayUrl } from "../services/overlayVersion";
import { getMinistryData, buildSpeakerRoleMap } from "../services/ministryStore";
import { PRESENTATION_SCENE_NAME, PROGRAM_SCENE_SOURCE_NAME, SOURCE_NAMES, BG_SOURCE_NAMES, FULLSCREEN_SOURCE_NAMES, FULLSCREEN_BG_SOURCE_NAMES, LEGACY_NOTES_SOURCE_NAMES, getLegacySourceAliases } from "../services/PresentationSceneManager";
import type { DockLiveThemeOverrides } from "./dockConsoleTheme";
import {
  DOCK_PREVIEW_STAGE_SUFFIX,
  normalizeDockStageBaseScene,
} from "../services/dockSceneNames";
import type { LiveToolOverlayPayload, LiveToolTemplate } from "../live-tools/types";
import { loadProjectionSettings } from "./dockProjectionSettings";
import {
  isNativeDockSettingsHydrated,
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../services/localDockSettings";
import { overlayBridge, type BridgePacket } from "./dockOverlayBridge";
import { buildDockFontFamilyCss } from "./dockFontFamily";
import {
  applyDockOutputFontScale,
  loadDockOutputFontFamily,
  loadDockOutputFontScale,
} from "./dockOutputTypography";
import type { DockOverlayFontFitMeasurement } from "./lowerThirdQuickSettings";
import type { DockTranslationOrder } from "./dockTranslation";
import { buildVlcPlaylistItems } from "./vlcPlaylist";
import type { EditableTemplate } from "../templates/editableTemplateCatalog";
import type { DockTimeOverlayData } from "./timeOverlay";
import {
  assertDockObsMutationAllowed,
  isFreeDockPlan,
  isPresentationLinkUrl,
} from "./dockMutationPolicy";
import { scheduleMceBrowserSourceRefresh } from "../services/obsBrowserSourceRefresh";
import { scheduleRetiredMceSourceCleanup } from "../services/retiredMceSources";
import { recordPresentationHistory } from "./dockScheduleService";
import { hasHeading } from "../themes/layout/heading";
import { isThemeLayout } from "../themes/layout/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DockObsStatus = "disconnected" | "connecting" | "connected" | "error";

type StatusCallback = (status: DockObsStatus, error?: string) => void;

/** A minimal theme shape used by the dock for lower-third overlays */
export interface DockLTThemeRef {
  id: string;
  html: string;
  css: string;
}

export type DockSceneRouteModule = "bible" | "worship" | "notes" | "ticker" | "lower-third" | "countdown" | "time";

/** Shared MCE Presentation content families that can be focused by a dock card. */
export type DockPresentationModule = "bible" | "worship" | "notes" | "media";

export interface DockBiblePushData {
  book: string;
  chapter: number;
  verse: number;
  lineCount?: number;
  verseEnd?: number;
  verseRange?: string;
  rawReferenceLabel?: string;
  referenceLabel?: string;
  displayReferenceLabel?: string;
  referenceBaseLabel?: string;
  translation: string;
  theme?: string;
  verseText?: string;
  overlayMode?: "fullscreen" | "lower-third";
  ltTheme?: DockLTThemeRef;
  bibleThemeSettings?: Record<string, unknown> | null;
  liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
  backgroundOnly?: boolean;
  compareEnabled?: boolean;
  compareMode?: "translations" | "passages";
  compareLayout?: "line-by-line" | "side-by-side";
  translationA?: string;
  translationB?: string;
  compare?: {
    enabled?: boolean;
    mode?: "translations" | "passages";
    layout?: "line-by-line" | "side-by-side";
    columns?: Array<{
      book: string;
      chapter: number;
      verse: number;
      verseEnd?: number;
      verseRange?: string;
      referenceLabel: string;
      translation: string;
      verseText: string;
    }>;
  } | null;
  /** Override target scene instead of using getTargetScene() */
  targetScene?: string;
}

export interface DockTabContentPushData {
  sectionText: string;
  translationText?: string;
  translationOrder?: DockTranslationOrder;
  sectionLabel: string;
  songTitle: string;
  artist?: string;
  overlayMode?: "fullscreen" | "lower-third";
  ltTheme?: DockLTThemeRef;
  values?: Record<string, string>;
  bibleThemeSettings?: Record<string, unknown> | null;
  liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
  backgroundOnly?: boolean;
}

export interface DockAudioInputSource {
  inputName: string;
  inputKind: string;
}

export interface DockMediaSendOptions {
  muted?: boolean;
  imageAudioInputName?: string | null;
  looping?: boolean;
  restartOnActivate?: boolean;
  closeWhenInactive?: boolean;
  clearOnMediaEnd?: boolean;
  playbackSpeed?: number;
  fitMode?: "cover" | "contain" | "stretch";
  transition?: "cut" | "fade";
  document?: DockDocumentMediaOptions;
}

export interface DockDocumentMediaOptions {
  pageNumber: number;
  pageCount: number;
  showBackground: boolean;
  showPageLabel: boolean;
  alignment: "left" | "center" | "right";
  zoom: number;
  offsetX: number;
  offsetY: number;
  legacyCanvas?: boolean;
}

interface DockPreviewSceneState {
  previewSceneName: string;
  originalSceneName: string;
  overlayType: string;
  createdAt: number;
  updatedAt: number;
}

/** Tab-specific preview scene identifiers */
export type DockPreviewTab = "bible" | "worship" | "announcements" | "notes" | "media" | "multiview" | "ai" | "ministry" | "lower-third";

/** All tabs now use the single MCE Presentation scene for preview */
const TAB_PREVIEW_SCENE_NAMES: Record<DockPreviewTab, string> = {
  bible: "MCE Presentation",
  worship: "MCE Presentation",
  announcements: "MCE Presentation",
  notes: "MCE Presentation",
  media: "MCE Presentation",
  multiview: "MCE Presentation",
  ai: "MCE Presentation",
  ministry: "MCE Presentation",
  "lower-third": "MCE Presentation",
};

/** Source names the dock creates as overlays in the user's scenes (descriptor first for narrowed docks) */
const DOCK_LT_SOURCE = SOURCE_NAMES.LOWER_THIRD;
const DOCK_ANIMATED_LT_SOURCE = "Animated Lower Thirds - MCE Presentation";
const DOCK_WORSHIP_SOURCE = FULLSCREEN_SOURCE_NAMES.WORSHIP;
const DOCK_NOTES_SOURCE = FULLSCREEN_SOURCE_NAMES.NOTES;
const DOCK_TICKER_SOURCE = "Ticker - MCE Presentation";
/** Media player source for playing uploaded/library media */
export const DOCK_MEDIA_VIDEO_SOURCE = "Video - MCE Presentation";
export const DOCK_MEDIA_IMAGE_SOURCE = "Image - MCE Presentation";
export const DOCK_MEDIA_AUDIO_SOURCE = "Audio - MCE Presentation";
export const DOCK_MEDIA_IMAGE_AUDIO_SOURCE = "Audio - MCE Presentation";
export const DOCK_MEDIA_PATTERN_SOURCE = "Pattern - MCE Presentation";
export const DOCK_MEDIA_TEMPLATE_SOURCE = "Template - MCE Presentation";
export const DOCK_MEDIA_REMOTE_SOURCE = "Remote - MCE Presentation";
const DOCK_LIVE_TOOL_SOURCE = "Live Tools - MCE Presentation";
const DOCK_LIVE_TOOL_MEDIA_VIDEO_SOURCE = "Video - MCE Presentation";
const DOCK_LIVE_TOOL_MEDIA_IMAGE_SOURCE = "Image - MCE Presentation";

export function isMediaNativeManagedSource(sourceName: string): boolean {
  const norm = sourceName.trim();
  return (
    norm === DOCK_MEDIA_VIDEO_SOURCE ||
    norm === DOCK_MEDIA_IMAGE_SOURCE ||
    norm === DOCK_MEDIA_AUDIO_SOURCE ||
    norm === "Video - MCE Media" ||
    norm === "Image - MCE Media" ||
    norm === "Audio - MCE Media" ||
    norm.startsWith("MCE Audio - ") ||
    norm.startsWith("MCE Video - ") ||
    norm.startsWith("MCE Image - ") ||
    norm.startsWith("MCE Scene ") ||
    norm.startsWith("MCE Mobile ")
  );
}

/**
 * Returns a stable, isolated native media source name for an OBS scene.
 * If the target scene is the canonical MCE Presentation scene, returns standard presentation sources.
 * For any other scene, returns an isolated scene-specific source name to prevent overwriting presentation audio/video.
 */
export function getSceneMediaSourceName(
  kind: "audio" | "video" | "image",
  name: string,
  targetScene?: string,
  key?: string,
): string {
  if (targetScene && (targetScene === DOCK_PRESENTATION_SCENE || targetScene === "MCE Presentation")) {
    return kind === "audio"
      ? DOCK_MEDIA_AUDIO_SOURCE
      : kind === "video"
        ? DOCK_MEDIA_VIDEO_SOURCE
        : DOCK_MEDIA_IMAGE_SOURCE;
  }
  const baseName = name.replace(/\.[^.]+$/, "");
  const defaultLabel = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image";
  const sanitizedBase = baseName.replace(/[^a-z0-9 _-]+/gi, " ").trim().replace(/\s+/g, " ").slice(0, 36) || defaultLabel;
  const suffix = (key || name).replace(/[^a-z0-9]+/gi, "").slice(-8) || "media";
  const sourceType = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image";
  return `MCE Scene ${sourceType} - ${sanitizedBase} - ${suffix}`;
}

/** Background source placed BEHIND fullscreen overlays to prevent flash/twitch between slides */
const DOCK_FS_BG_SOURCE = "Fullscreen BG - MCE Presentation";
/** Scene-local fullscreen background source prefix used in target scenes */
const DOCK_FS_TARGET_BG_PREFIX = "Scene BG - MCE Fullscreen";
/** Single presentation scene holding all module sources */
export const DOCK_PRESENTATION_SCENE = "MCE Presentation";
const DOCK_BIBLE_SCENE = DOCK_PRESENTATION_SCENE;
const DOCK_WORSHIP_SCENE = DOCK_PRESENTATION_SCENE;
const DOCK_MEDIA_SCENE = DOCK_PRESENTATION_SCENE;
const MCE_PRESENTATION_FOCUS_SOURCES: Record<DockPresentationModule, string> = {
  bible: FULLSCREEN_SOURCE_NAMES.BIBLE,
  worship: FULLSCREEN_SOURCE_NAMES.WORSHIP,
  notes: FULLSCREEN_SOURCE_NAMES.NOTES,
  media: DOCK_MEDIA_VIDEO_SOURCE,
};
const MCE_PRESENTATION_ACTIVE_MODULE_KEY = "ocs-dock-presentation-active-module-v1";
const FULLSCREEN_CLEAR_WAIT_MS = 240;
/** Lower thirds with staggered parts can take longer to exit than their theme says. */
const LT_EXIT_SETTLE_MS = 1400;
/** Long enough for OBS to draw a couple of frames at 30–60 fps. */
const LT_EMPTY_FRAME_MS = 120;
/** Time to let a Bible / Worship / Notes overlay play its exit before OBS hides the source. */
const OVERLAY_EXIT_WAIT_MS = 500;
const DOCK_PREVIEW_SCENE_STATE_KEY = "ocs-dock-preview-scene-state-v1";
const PROGRAM_BACKGROUND_MANAGED_SCENES_KEY = "ocs-dock-program-background-scenes-v1";
const PROGRAM_BACKGROUND_LAST_SCENE_KEY = "ocs-dock-program-background-last-scene-v1";
const DOCK_OBS_RECONNECT_DELAY_MS = 300;
const DOCK_OBS_RECONNECT_MAX_DELAY_MS = 8000;
const DOCK_OBS_PARAMS_KEY = "ocs-dock-obs-params";
const PROGRAM_BACKGROUND_WATCH_INTERVAL_MS = 1500;
const SCENE_ROUTE_SOURCE_RECONCILE_MS = 30_000;
const DOCK_TICKER_CLEARANCE_FALLBACK_PX = 80;
const DOCK_TICKER_CLEARANCE_GAP_PX = 10;
const DOCK_TICKER_CLEARANCE_MAX_PX = 220;

/**
 * Sources that MakeChurchEazy may place inside MCE Presentation. We use the
 * known MCE naming families instead of touching every source whose name merely
 * happens to contain "MCE". User-owned OBS sources are never included here.
 */
const MCE_PRESENTATION_MANAGED_SOURCE_PREFIXES = [
  "Bible - MCE",
  "Worship - MCE",
  "Notes - MCE",
  "Media - MCE",
  "Lower Third - MCE",
  "Ticker - MCE",
  "Countdown - MCE",
  "Time - MCE",
  "Video - MCE",
  "Image - MCE",
  "Audio - MCE",
  "Pattern - MCE",
  "Template - MCE",
  "Remote - MCE",
  "Live Tools - MCE",
  "Live Video - MCE",
  "Live Image - MCE",
  "Animated Lower Thirds - MCE",
  "Bible BG - MCE",
  "Worship BG - MCE",
  "Notes BG - MCE",
  "Media BG - MCE",
  "Countdown BG - MCE",
  "Fullscreen BG - MCE",
  "Scene BG - MCE",
  "MCE Browser -",
  "MCE BG -",
  "MCE Bible",
  "MCE Worship",
  "MCE Notes",
  "MCE Media",
  "MCE Lower Third",
  "MCE Ticker",
  "MCE Countdown",
  "MCE Time",
  "MCE Pre-Service",
  "MCE_PreService",
  "MCE Live",
  "MCE Animated Lower Thirds",
  "MCE Lower Thirds",
  "MCE LT:",
  "MCE MV:",
  "MCE Fullscreen",
  "MCE -",
] as const;

function isMcePresentationManagedSource(sourceName: string): boolean {
  const normalized = sourceName.trim();
  if (!normalized || normalized === PRESENTATION_SCENE_NAME || normalized === PROGRAM_SCENE_SOURCE_NAME) {
    return false;
  }
  return MCE_PRESENTATION_MANAGED_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || DockObsClient.isMCESource(normalized);
}

function isMceBackgroundOrAuxiliaryForPrimary(primary: string, candidate: string): boolean {
  const pNorm = primary.trim().toLowerCase();
  const cNorm = candidate.trim().toLowerCase();
  if (!pNorm || !cNorm || pNorm === cNorm) return false;

  // Bible paired backgrounds
  if (pNorm.includes("bible")) {
    return cNorm.includes("bg") && (cNorm.includes("bible") || cNorm.includes("fullscreen"));
  }
  // Worship paired backgrounds
  if (pNorm.includes("worship")) {
    return cNorm.includes("bg") && cNorm.includes("worship");
  }
  // Notes paired backgrounds
  if (pNorm.includes("notes")) {
    return cNorm.includes("bg") && cNorm.includes("notes");
  }
  // Countdown paired backgrounds
  if (pNorm.includes("countdown") || pNorm.includes("pre-service") || pNorm.includes("preservice")) {
    return cNorm.includes("bg") && (cNorm.includes("countdown") || cNorm.includes("pre-service") || cNorm.includes("preservice"));
  }
  // Lower third paired backgrounds
  if (pNorm.includes("lower third") || pNorm.includes("lower-third") || pNorm.startsWith("mce lt:")) {
    return cNorm.includes("bg") && (cNorm.includes("lower third") || cNorm.includes("lower-third") || cNorm.includes("lt"));
  }
  // Media companion sources (Text overlay or Image audio)
  if (pNorm.includes("media")) {
    if (cNorm.includes("text")) return true;
    if (pNorm.includes("image") && cNorm.includes("audio")) return true;
    return false; // Competing media (e.g. video vs image) is NOT kept
  }
  return false;
}

/** True when a browser source URL is the Notes overlay page (Worship and Notes share one source). */
function isNotesOverlayDocumentUrl(url: string | undefined): boolean {
  const text = String(url || "");
  try {
    return new URL(text).pathname.endsWith("/mce-note.html");
  } catch {
    return /mce-note\.html(?:$|[?#])/.test(text);
  }
}

function getMcePresentationSourceFamily(sourceName: string): string | null {
  const normalized = sourceName.trim().toLocaleLowerCase();
  if (normalized.includes("bible")) return "bible";
  if (normalized.includes("worship")) return "worship";
  if (normalized.includes("notes")) return "notes";
  if (normalized.includes("media")) return "media";
  if (normalized.includes("lower third") || normalized.includes("lower-third") || normalized.startsWith("mce lt:")) return "lower-third";
  if (normalized.includes("ticker")) return "ticker";
  if (normalized.includes("countdown") || normalized.includes("pre-service") || normalized.includes("preservice")) return "countdown";
  if (normalized.includes("time")) return "time";
  if (normalized.includes("live")) return "live-tools";
  return null;
}

/**
 * The ticker under any of its names: the Ministry tab's "MCE Ticker", the older
 * "Ticker - MCE Presentation" and per-scene route copies. Only MCE-managed names
 * count, so a user's own source that mentions "ticker" is never touched.
 */
export function isMceTickerSourceName(sourceName: string): boolean {
  return isMcePresentationManagedSource(sourceName) && getMcePresentationSourceFamily(sourceName) === "ticker";
}

export function isMceAudioSource(sourceName: string): boolean {
  const norm = sourceName.trim().toLowerCase();
  if (!norm) return false;
  return (
    norm === DOCK_MEDIA_AUDIO_SOURCE.toLowerCase() ||
    norm === DOCK_MEDIA_IMAGE_AUDIO_SOURCE.toLowerCase() ||
    norm === "audio - mce presentation" ||
    norm === "audio - mce media" ||
    norm === "image audio - mce presentation" ||
    norm === "audio - mce media image" ||
    norm.startsWith("mce audio -") ||
    norm.startsWith("mce scene audio -") ||
    norm.startsWith("mce media - audio") ||
    norm.startsWith("mce media - image audio") ||
    (norm.startsWith("mce ") && norm.includes("audio")) ||
    norm.includes("image audio")
  );
}

/** True for the sources that carry a lower third (the main one, animated ones and "MCE LT:" designs). */
/** The shared Ministry lower-third source or one tab's own ("MCE LT: Tab …"). */
export function isMinistryLtTabSource(sourceName: string): boolean {
  const name = sourceName.trim();
  return name === DOCK_LT_SOURCE || name.startsWith("MCE LT: Tab ");
}

export function isMceLowerThirdSourceName(sourceName: string): boolean {
  const name = sourceName.trim();
  return name === DOCK_LT_SOURCE
    || name === DOCK_ANIMATED_LT_SOURCE
    || name.startsWith("MCE Lower Third")
    || name.startsWith("MCE Animated Lower Third")
    || name.startsWith("MCE LT:");
}

/**
 * Build the MCE-owned sources that should remain visible for an active push.
 * The program-scene reference is structural, so it is intentionally preserved
 * but is not treated as a content source.
 * When preserveAudio is true (default), background music and audio tracks stay
 * on when switching between Bible, Worship, or Notes.
 * With "overlay" (lower thirds only) everything stays except other lower thirds:
 * a lower third sits on top of whatever is already on screen, and two lower
 * thirds never share the same spot.
 */
export function getMcePresentationVisibilityKeepSet(
  primarySourceName: string,
  items: ReadonlyArray<{ sourceName: string; sceneItemIndex?: number }>,
  lowerThirdSourceVisibility: "overlay" | "active-only" = "active-only",
  preserveAudio: boolean = true,
): Set<string> {
  const primary = primarySourceName.trim();
  const keepSet = new Set<string>([primary, PROGRAM_SCENE_SOURCE_NAME]);

  for (const item of items) {
    if (isMceBackgroundOrAuxiliaryForPrimary(primary, item.sourceName)) {
      keepSet.add(item.sourceName);
    }
    // The ticker is an overlay the operator starts and stops in the Ministry tab;
    // showing a verse, song or media must not switch it off (it popped back in later).
    if (isMceTickerSourceName(item.sourceName)) {
      keepSet.add(item.sourceName);
    }
    if (preserveAudio && isMceAudioSource(item.sourceName)) {
      keepSet.add(item.sourceName);
    }
  }

  if (lowerThirdSourceVisibility === "overlay") {
    for (const item of items) {
      if (isMcePresentationManagedSource(item.sourceName) && !isMceLowerThirdSourceName(item.sourceName)) {
        keepSet.add(item.sourceName);
      }
    }
  }

  return keepSet;
}

type DockOverlayMode = "fullscreen" | "lower-third";

type PrimeBibleOverlayData = {
  book?: string;
  chapter?: number;
  verse?: number;
  lineCount?: number;
  verseEnd?: number;
  verseRange?: string;
  rawReferenceLabel?: string;
  referenceLabel?: string;
  displayReferenceLabel?: string;
  referenceBaseLabel?: string;
  translation?: string;
  verseText?: string;
  overlayMode?: DockOverlayMode;
  bibleThemeSettings?: Record<string, unknown> | null;
  liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
  backgroundOnly?: boolean;
  compareEnabled?: boolean;
  compareMode?: "translations" | "passages";
  compareLayout?: "line-by-line" | "side-by-side";
  translationA?: string;
  translationB?: string;
  compare?: {
    enabled?: boolean;
    mode?: "translations" | "passages";
    layout?: "line-by-line" | "side-by-side";
    columns?: Array<{
      book: string;
      chapter: number;
      verse: number;
      verseEnd?: number;
      verseRange?: string;
      referenceLabel: string;
      translation: string;
      verseText: string;
    }>;
  } | null;
};

type PrimeWorshipOverlayData = {
  sectionText?: string;
  translationText?: string;
  translationOrder?: DockTranslationOrder;
  sectionLabel?: string;
  songTitle?: string;
  artist?: string;
  overlayMode?: DockOverlayMode;
  bibleThemeSettings?: Record<string, unknown> | null;
  liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
  backgroundOnly?: boolean;
};

type CssOverlayPacketTab = "bible" | "worship" | "announcements" | "sermon" | "notes" | "lower-third" | "time";

export interface DockOverlayFitOptions {
  /** Wait for the browser source to finish measuring the rendered text. */
  waitForFit?: boolean;
  timeoutMs?: number;
}

function readPersistedDockOverlayMode(
  tabType: "bible" | "worship" | "announcements" | "sermon" | "notes",
): DockOverlayMode | null {
  const preferencesKey = tabType === "bible"
    ? "ocs-dock-bible-preferences"
    : "ocs-dock-worship-preferences";
  try {
    const raw = readNativeDockSetting<unknown>(preferencesKey);
    if (!raw) return null;
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { overlayMode?: unknown };
    return parsed.overlayMode === "fullscreen" || parsed.overlayMode === "lower-third"
      ? parsed.overlayMode
      : null;
  } catch {
    return null;
  }
}

interface DockResourceNames {
  ltSource: string;
  animatedLtSource: string;
  worshipSource: string;
  notesSource: string;
  tickerSource: string;
  mediaVideoSource: string;
  mediaImageSource: string;
  mediaAudioSource: string;
  mediaImageAudioSource: string;
  mediaPatternSource: string;
  mediaTemplateSource: string;
  remoteMediaSource: string;
  fsBgSource: string;
  fsTargetBgPrefix: string;
  bibleScene: string;
  worshipScene: string;
  mediaScene: string;
}

const DOCK_RESOURCES: DockResourceNames = {
  ltSource: DOCK_LT_SOURCE,
  animatedLtSource: DOCK_ANIMATED_LT_SOURCE,
  worshipSource: DOCK_WORSHIP_SOURCE,
  notesSource: DOCK_NOTES_SOURCE,
  tickerSource: DOCK_TICKER_SOURCE,
  mediaVideoSource: DOCK_MEDIA_VIDEO_SOURCE,
  mediaImageSource: DOCK_MEDIA_IMAGE_SOURCE,
  mediaAudioSource: DOCK_MEDIA_AUDIO_SOURCE,
  mediaImageAudioSource: DOCK_MEDIA_IMAGE_AUDIO_SOURCE,
  mediaPatternSource: DOCK_MEDIA_PATTERN_SOURCE,
  mediaTemplateSource: DOCK_MEDIA_TEMPLATE_SOURCE,
  remoteMediaSource: DOCK_MEDIA_REMOTE_SOURCE,
  fsBgSource: DOCK_FS_BG_SOURCE,
  fsTargetBgPrefix: DOCK_FS_TARGET_BG_PREFIX,
  bibleScene: DOCK_BIBLE_SCENE,
  worshipScene: DOCK_WORSHIP_SCENE,
  mediaScene: DOCK_MEDIA_SCENE,
};

function getDockResources(): DockResourceNames {
  return DOCK_RESOURCES;
}

function getAllDockResources(): DockResourceNames[] {
  return [DOCK_RESOURCES];
}

// ---------------------------------------------------------------------------
// Built-in lower-third theme (embedded so dock works without the main app)
// ---------------------------------------------------------------------------

const DEFAULT_LT_THEME = {
  id: "dock-default-lt",
  html: `<div class="lt pos-bl in-up">
  <div class="panel speaker-panel" style="--bg:rgba(18,18,24,.92);--fg:#fff;--accent:#1D4ED8;--bd:rgba(255,255,255,.12);">
    <div class="v-divider"></div>
    <div class="col">
      <p class="name-line">{{name}}</p>
      <p class="role-line">{{role}}</p>
    </div>
  </div>
</div>`,
  css: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.lt { position: fixed; z-index: 40; pointer-events: none; }
.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }

.pos-bl { left: 40px; bottom: 32px; }

.panel {
  background: var(--bg, rgba(18,18,24,.92));
  color: var(--fg, #fff);
  border: 1px solid var(--bd, rgba(255,255,255,.12));
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
  backdrop-filter: blur(12px);
}

.col { display: flex; flex-direction: column; min-width: 0; }

.speaker-panel {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 420px;
  max-width: min(900px, calc(100vw - 80px));
  padding: 22px 42px;
}

.v-divider {
  width: 5px;
  min-width: 5px;
  height: 72px;
  border-radius: 2px;
  background: var(--accent, #1D4ED8);
}

.name-line {
  font-size: clamp(28px, 2.2vw, 52px);
  font-weight: 700;
  line-height: 1.1;
  padding-inline: 6px;
}

.role-line {
  margin-top: 6px;
  font-size: clamp(18px, 1.4vw, 32px);
  font-weight: 400;
  line-height: 1.2;
  opacity: .8;
  padding-inline: 6px;
}`,
};

/**
 * Returns the default lower-third theme with config-driven colors.
 * Falls back to DEFAULT_LT_THEME if config is not yet loaded.
 */
function getDefaultLTTheme(): typeof DEFAULT_LT_THEME {
  const lt = getDefaultLowerThirdTheme();
  return {
    ...DEFAULT_LT_THEME,
    html: `<div class="lt pos-bl in-up">
  <div class="panel speaker-panel" style="--bg:${lt.backgroundColor};--fg:${lt.nameColor};--accent:${lt.titleColor};--bd:rgba(255,255,255,.12);">
    <div class="v-divider"></div>
    <div class="col">
      <p class="name-line" style="font-size:clamp(${lt.nameSize}px, 2.2vw, ${Math.round(lt.nameSize * 1.86)}px);">{{name}}</p>
      <p class="role-line">{{role}}</p>
    </div>
  </div>
</div>`,
  };
}

function normalizeThemeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * What the label line of a Worship / Notes theme shows (the slot Bible uses for the
 * reference). "auto" keeps the original behaviour: no label for songs, the cleaned
 * section label for notes in lower-third mode.
 */
export type DockTabLabelMode = "auto" | "none" | "title" | "section" | "title-section";

export const DOCK_TAB_LABEL_MODES: readonly DockTabLabelMode[] = ["auto", "none", "title", "section", "title-section"];

export function normalizeDockTabLabelMode(value: unknown): DockTabLabelMode {
  return DOCK_TAB_LABEL_MODES.includes(value as DockTabLabelMode) ? (value as DockTabLabelMode) : "auto";
}

/** True when the theme settings carry a layer theme that has a heading (label line). */
export function themeHasLayerHeading(settings: unknown): boolean {
  const layout = settings && typeof settings === "object" ? (settings as { layout?: unknown }).layout : undefined;
  return isThemeLayout(layout) && hasHeading(layout);
}

/**
 * Builds the label for a song or note; returns `legacy` in "auto" mode.
 * Layer themes with a heading get "Song · Section" in "auto" mode, so the heading
 * the theme was designed with shows (its own Show / Hide still decides).
 */
export function resolveDockTabLabel(
  mode: DockTabLabelMode,
  data: { songTitle?: string; sectionLabel?: string; noteTitle?: string },
  legacy: string,
  options: { layerHeading?: boolean } = {},
): string {
  if (mode === "auto") {
    if (!options.layerHeading) return legacy;
    mode = "title-section";
  }
  if (mode === "none") return "";
  const title = String(data.noteTitle || data.songTitle || "").trim();
  const section = String(data.sectionLabel || "").trim();
  if (mode === "title") return title;
  if (mode === "section") return section;
  return title && section ? `${title} · ${section}` : title || section;
}

function cleanWorshipObsLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed && !/^verse\s+\d+$/i.test(trimmed) ? trimmed : "";
}

function isLikelyCustomTheme(theme: ThemeLike): boolean {
  const signature = `${theme.id} ${theme.name || ""} ${(theme.tags || []).join(" ")} ${theme.category || ""}`.toLowerCase();
  return signature.includes("custom") || signature.includes("user");
}

function matchesThemeHints(theme: ThemeLike, hints: string[]): boolean {
  if (hints.length === 0) return true;

  const tagList = (theme.tags || []).map(normalizeThemeToken);
  const signature = `${theme.id} ${theme.name || ""} ${theme.category || ""} ${tagList.join(" ")}`.toLowerCase();

  return hints.some((hint) => {
    if (!hint) return false;
    if (signature.includes(hint)) return true;
    return tagList.some((tag) => tag === hint || tag.includes(hint) || hint.includes(tag));
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DockObsClient {
  private static readonly NO_CLONE_UNDERLAY_CACHE_KEY = "__no-clone__";
  private obs = new OBSWebSocket();
  private _status: DockObsStatus = "disconnected";
  private _error = "";
  private listeners = new Set<StatusCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectPromise: Promise<void> | null = null;
  private _reconnectAttempts = 0;
  private _url = getDefaultOBSUrl();
  private _password: string | undefined;
  private _persistConnectionParams = true;
  private _hasTransientExplicitConnection = false;
  /**
   * OBS can keep a stale browser document even after its source is restarted.
   * A token scoped to this Dock process makes the first source load fetch the
   * current overlay HTML without changing the stable URL used for live packets.
   */
  /** primary|scene pairs whose legacy alias items were already removed on this OBS connection. */
  private readonly _legacyAliasCleanupDone = new Set<string>();
  private readonly _overlayDocumentSessionToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  /** Track last overlay mode per source so we can force-reload when switching HTML files */
  private _lastOverlayMode: Record<string, string> = {};
  /** Label line for Worship / Notes themes (set by the Worship and Notes tabs). */
  private _tabLabelMode: Record<"worship" | "notes", DockTabLabelMode> = { worship: "auto", notes: "auto" };

  setTabLabelMode(tab: "worship" | "notes", mode: DockTabLabelMode): void {
    this._tabLabelMode[tab] = normalizeDockTabLabelMode(mode);
  }

  getTabLabelMode(tab: "worship" | "notes"): DockTabLabelMode {
    return this._tabLabelMode[tab];
  }

  private tabLabel(
    tab: string,
    data: { songTitle?: string; sectionLabel?: string; noteTitle?: string; backgroundOnly?: boolean; bibleThemeSettings?: unknown },
    legacy: string,
  ): string {
    if (data.backgroundOnly) return "";
    if (tab !== "worship" && tab !== "notes") return legacy;
    return resolveDockTabLabel(this._tabLabelMode[tab], data, legacy, {
      layerHeading: tab === "worship" && themeHasLayerHeading(data.bibleThemeSettings),
    });
  }
  /** Last overlay mode for the unified Bible source ("fullscreen" | "lower-third") */
  private _lastBibleMode: string = "";
  /** Guard: only the current OBS instance can change status */
  private _obsGeneration = 0;
  private _cloneMap: Map<string, string> = new Map();
  private _previewSceneState: DockPreviewSceneState | null = null;
  /** Per-tab preview scene states — keyed by DockPreviewTab */
  private _previewSceneStates: Map<string, DockPreviewSceneState> = new Map();
  /** Per-tab Program scene snapshot taken before a push — used to restore on clear */
  private _programSceneBeforePush: Map<string, string> = new Map();

  /** Cached branding data loaded from the dock JSON file */
  private _brandingCache: { logoFileName: string; brandColor: string; churchName: string } | null = null;
  /** Cache scene-local fullscreen background payloads so repeated slide pushes do not reload them */
  private _lastTargetBgSignature: Record<string, string> = {};
  /** Cache fullscreen browser-source config so verse changes do not force source reloads */
  private _lastFullscreenSourceSignature: Record<string, string> = {};
  /** Cache browser-rendered fullscreen backgrounds for gradient / fallback cases. */
  private _lastFullscreenBgSignature: Record<string, string> = {};
  /** Keep the latest CSS-driven overlay packet per browser source for smooth verse/song updates and clears */
  private _lastCssOverlayPacketBySource: Record<string, Record<string, unknown>> = {};
  private _lastCssOverlayBaseUrlBySource: Record<string, string> = {};
  private _lastCssOverlayThemeCssBySource: Record<string, string> = {};
  private _lastCssOverlayTabBySource: Record<string, CssOverlayPacketTab> = {};
  /** Pending re-sends of the newest packet after a browser document (re)load, per source. */
  private _redeliveryTimersBySource: Record<string, ReturnType<typeof setTimeout>[]> = {};
  /** Track the last browser source URL per input so identical verse pushes can skip reloads. */
  private _lastBrowserSourceUrlBySource: Record<string, string> = {};
  /** Avoid repeating expensive source order/fit checks on every fast overlay packet. */
  private _lastFastOverlayPrepAtBySource: Record<string, number> = {};
  /** Reuse the served URL for a local Bible asset across verse pushes. */
  private _preparedBrowserThemeAssetUrls: Record<string, string> = {};
  /** The program scene has already been wired behind the Bible overlay. */
  private _lastBibleProgramScenePrepared = "";
  /** Serialize Bible overlay mutations so rapid verse clicks do not overlap OBS scene rebuilds. */
  private _bibleMutationTail: Promise<void> = Promise.resolve();
  private _lastBiblePushSignature = "";
  /** Counter for latest-only skip: incremented each time a new mutation is queued. */
  private _bibleMutationCounter = 0;
  /** Serialize Worship overlay mutations so rapid slide clicks do not overlap OBS scene rebuilds. */
  private _worshipMutationTail: Promise<void> = Promise.resolve();
  private _lastWorshipPushSignature = "";
  /** Counter for latest-only skip on worship: incremented each time a new mutation is queued. */
  private _worshipMutationCounter = 0;
  /** Announcement mutation counter for latest-only skip */
  private _announcementMutationCounter = 0;
  /** Serialize announcement overlay mutations so rapid slide clicks do not overlap */
  private _announcementMutationTail: Promise<void> = Promise.resolve();
  /** Serialize presentation-scene structural mutations to avoid duplicate scene-source inserts. */
  private _presentationMutationTail: Promise<void> = Promise.resolve();
  private _presentationMutationCounter = 0;
  /** Serialize media projection mutations so rapid media clicks collapse and do not conflict. */
  private _mediaMutationTail: Promise<void> = Promise.resolve();
  private _mediaMutationCounter = 0;
  /** Short cache for the Program scene already placed under MCE Presentation. */
  private _presentationProgramUnderlayCache: { programScene: string; expiresAt: number } | null = null;
  /** Manual deletion of MCE Presentation can leave obs-websocket unsettled briefly. */
  private _presentationSceneDeletedAt = 0;
  private _presentationSceneRepairPromise: Promise<void> | null = null;
  private _lastAnnouncementPushSignature = "";
  private _announcementInitialized = false;
  private _notesMutationTail: Promise<void> = Promise.resolve();
  private _lastNotesPushSignature = "";
  private _notesMutationCounter = 0;
  private _notesInitialized = false;
  /**
   * Worship and Notes share ONE OBS browser source. This is the module that
   * last projected on it, so the other one can leave it alone (prime, clear)
   * while it is on air.
   */
  private _sharedWorshipNotesOwner: "worship" | "notes" | null = null;
  /** Skip clearAllOverlays on verse-to-verse transitions within the same mode */
  private _bibleLtInitialized = false;
  /** Skip clearAllOverlays on slide-to-slide transitions within the same mode (worship) */
  private _worshipInitialized = false;
  /** Deduped startup warm-up so first Bible/Worship push does not pay the full bootstrap cost. */
  private _startupPrewarmPromise: Promise<void> | null = null;
  /** Startup bootstrap promise for post-connect OBS readiness (prewarm + projection wiring). */
  private _startupReadyPromise: Promise<void> | null = null;
  /** Short-lived cache for GetSceneItemList results to avoid redundant round-trips within a single operation */
  private _sceneItemListCache: { sceneName: string; items: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex?: number }>; expiresAt: number } | null = null;
  /** Cache the program scene name; OBS scene-change events keep it fresh. */
  private _programSceneCache: { name: string; expiresAt: number } | null = null;
  /** Short-lived cache for canvas size to avoid redundant GetVideoSettings calls within a single push */
  private _canvasCache: { size: { width: number; height: number }; expiresAt: number } | null = null;
  /** Known scene names from OBS, updated on scene list/create/delete to avoid repeated GetSceneList calls */
  private _knownScenes: Set<string> = new Set();
  /** Active image-slideshow rotation timers keyed by source name */
  private _slideshowTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  /** Performance telemetry: recent call latencies (ms) */
  private _callLatencies: number[] = [];
  private _callLatencyWindowStart = 0;
  /** Cache active LT background theme signature per scene to skip redundant OBS calls */
  private _activeLtBgSignature: Record<string, string> = {};
  /** Cache active LT background input kind per scene to skip GetInputList when type unchanged */
  private _activeLtBgInputKind: Record<string, string> = {};
  /** Cache studio mode result for the session (rarely changes) */
  private _studioModeCache: { value: boolean; expiresAt: number } | null = null;
  /** Track confirmed-clone scene names so ensureClone skips getObsSceneNames */
  private _cloneExistsCache: Set<string> = new Set();
  /** Track last-applied BG item state per scene to skip redundant SetSceneItemTransform/Index/Enabled */
  private _lastBgItemState: Record<string, { sourceName: string; itemId: number; width: number; height: number }> = {};
  /** Track fullscreen browser scene item setup so repeated pushes skip transform/index churn */
  private _lastFullscreenSceneItemSignature: Record<string, string> = {};
  /** Fast-path signature for repeated fullscreen Bible pushes where only verse data changes */
  private _lastBibleFullscreenSetupSignature = "";
  /** A Dock refresh found and adopted the still-live Bible browser source. */
  private _restoredLiveBibleSource = false;
  /** When OBS last accepted a content packet for each browser source (reveal gate). */
  private _lastPacketDeliveredAtBySource: Record<string, number> = {};
  /** Reveals waiting for a fresh packet for their source (see waitForFreshSourcePacket). */
  private _freshPacketWaiters: Array<{ source: string; since: number; resolve: () => void }> = [];
  /** Track active fullscreen native BG config so verse changes do not reapply it */
  private _activeFullscreenBgSignature: Record<string, string> = {};
  /** One-time cleanup for legacy fullscreen BG inputs now rendered by the browser overlay. */
  private _legacyFullscreenBgCleanupDone: Record<string, boolean> = {};
  /** Track which MCE overlay source is live per scene so module switches do one cleanup pass */
  private _activeMceOverlayStateByScene: Record<string, string> = {};
  /** Memoize verified stacked and visible state per scene and source for 15s to minimize CPU and OBS calls */
  private _lastVerifiedStackedBySceneSource: Record<string, number> = {};
  /** Track the active presentation primary source for instant visibility reconciliation */
  private _lastActivePresentationSource: string | null = null;
  /** Ministry lower thirds: every tab has its own OBS source (they can be on screen together). */
  private _ltPerTabSources = false;
  /** Whether the last reconciled presentation source was showing as a lower third. */
  private _lastActivePresentationLowerThirdMode = false;
  /**
   * Layout (lower third or not) the next Bible / Worship / Notes projection will use,
   * announced before any visibility work. The operator's click calls
   * ensureModuleSourceOpenAndOnTop before the push itself, so the mode records
   * (_lastBibleMode / _lastOverlayMode) can still hold the previous layout then.
   */
  private _intendedLowerThirdModeBySource: Record<string, boolean> = {};
  /** MCE-owned presentation sources hidden by the active-only preference. */
  private _mcePresentationSourcesDisabledByVisibility = new Set<string>();
  /** Remember the LT base Y so ticker clearance can be added/removed safely. */
  private _ltBasePosYBySceneItem: Map<string, number> = new Map();
  /** Reconcile the current OBS Program scene whenever Program background is on. */
  private _programBackgroundWatchTimer: ReturnType<typeof setInterval> | null = null;
  private _programBackgroundReconcilePromise: Promise<void> | null = null;
  private _programBackgroundPendingScene: string | null = null;
  private _programBackgroundPendingForce = false;
  /** Only these scene sources were created by MCE as Program underlays. */
  private _programBackgroundManagedScenes: Set<string> | null = null;
  private _programBackgroundManagedScenesHydrated = false;

  get status() { return this._status; }
  get isConnected() { return this._status === "connected"; }
  get error() { return this._error; }
  get url() { return this._url; }

  constructor() {
    // Load branding settings from dock JSON file (fire-and-forget)
    this._loadBranding();
    this._previewSceneState = this.loadPreviewSceneState();
    this.loadTabPreviewSceneStatesFromStorage();
    void this._ensureFullscreenBgSource;
    void this._ensureLowerThirdBgSource;
  }

  private resetObsStateCaches(): void {
    this._legacyAliasCleanupDone.clear();
    this.stopProgramBackgroundWatcher();
    this._sceneItemListCache = null;
    this._programSceneCache = null;
    this._canvasCache = null;
    this._knownScenes.clear();
    this._startupPrewarmPromise = null;
    this._startupReadyPromise = null;
    this.resetPresentationSceneState();
    this._announcementMutationTail = Promise.resolve();
    this._announcementMutationCounter = 0;
  }

  private resetPresentationSceneState(): void {
    this._lastOverlayMode = {};
    this._intendedLowerThirdModeBySource = {};
    this._lastBibleMode = "";
    this._lastTargetBgSignature = {};
    this._lastFullscreenSourceSignature = {};
    this._lastFullscreenBgSignature = {};
    this._lastFullscreenSceneItemSignature = {};
    this._lastBgItemState = {};
    this._lastBrowserSourceUrlBySource = {};
    this._lastCssOverlayPacketBySource = {};
    this._lastCssOverlayBaseUrlBySource = {};
    this._lastCssOverlayThemeCssBySource = {};
    this._lastFastOverlayPrepAtBySource = {};
    this._lastBibleProgramScenePrepared = "";
    this._lastBiblePushSignature = "";
    this._lastWorshipPushSignature = "";
    this._lastAnnouncementPushSignature = "";
    this._lastNotesPushSignature = "";
    this._lastBibleFullscreenSetupSignature = "";
    this._restoredLiveBibleSource = false;
    this._activeFullscreenBgSignature = {};
    this._legacyFullscreenBgCleanupDone = {};
    this._activeMceOverlayStateByScene = {};
    this._lastVerifiedStackedBySceneSource = {};
    this._presentationProgramUnderlayCache = null;
    this._activeLtBgSignature = {};
    this._activeLtBgInputKind = {};
    this._bgActiveSlot = {};
    this._ltBasePosYBySceneItem.clear();
    this._bibleLtInitialized = false;
    this._worshipInitialized = false;
    this._announcementInitialized = false;
    this._notesInitialized = false;
    this._sharedWorshipNotesOwner = null;
  }

  private getProgramBackgroundManagedScenes(): Set<string> {
    if (!this._programBackgroundManagedScenes) {
      this._programBackgroundManagedScenes = new Set<string>();
    }

    // The Dock can be constructed before the native settings hydration has
    // finished. Keep any in-memory writes made during that window, then merge
    // the durable database value once it becomes available.
    if (!this._programBackgroundManagedScenesHydrated && isNativeDockSettingsHydrated()) {
      const stored = readNativeDockSetting<unknown>(PROGRAM_BACKGROUND_MANAGED_SCENES_KEY);
      const names = Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === "string")
        : [];
      for (const name of names) {
        const trimmed = name.trim();
        if (trimmed && trimmed !== DOCK_PRESENTATION_SCENE) {
          this._programBackgroundManagedScenes.add(trimmed);
        }
      }
      this._programBackgroundManagedScenesHydrated = true;
    }

    return this._programBackgroundManagedScenes;
  }

  private persistProgramBackgroundManagedScenes(): void {
    const names = [...this.getProgramBackgroundManagedScenes()]
      .filter((name) => name && name !== DOCK_PRESENTATION_SCENE)
      .sort();
    writeNativeDockSetting(PROGRAM_BACKGROUND_MANAGED_SCENES_KEY, names);
  }

  private rememberProgramBackgroundManagedScene(sceneName: string): void {
    const trimmed = sceneName.trim();
    if (!trimmed || trimmed === DOCK_PRESENTATION_SCENE) return;
    const scenes = this.getProgramBackgroundManagedScenes();
    if (scenes.has(trimmed)) return;
    scenes.add(trimmed);
    this.persistProgramBackgroundManagedScenes();
  }

  private forgetProgramBackgroundManagedScene(sceneName: string): void {
    const scenes = this.getProgramBackgroundManagedScenes();
    if (!scenes.delete(sceneName.trim())) return;
    this.persistProgramBackgroundManagedScenes();
  }

  private rememberLastProgramBackgroundScene(sceneName: string): void {
    const trimmed = sceneName.trim();
    if (
      !trimmed ||
      trimmed === DOCK_PRESENTATION_SCENE ||
      DockObsClient.isManagedMultiviewSceneName(trimmed)
    ) return;
    writeNativeDockSetting(PROGRAM_BACKGROUND_LAST_SCENE_KEY, trimmed);
  }

  private readLastProgramBackgroundScene(): string {
    return String(readNativeDockSetting<unknown>(PROGRAM_BACKGROUND_LAST_SCENE_KEY) || "").trim();
  }

  private startProgramBackgroundWatcher(): void {
    if (!this.isConnected || this._programBackgroundWatchTimer || isFreeDockPlan()) return;

    // Reconcile once immediately, then use the interval as a safety net for
    // OBS builds or remote sessions that fail to emit a scene-change event.
    this.scheduleProgramBackgroundReconcile(undefined, true);
    this._programBackgroundWatchTimer = setInterval(() => {
      if (!this.isConnected) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (loadProjectionSettings().sceneMode !== "auto-duplicate") return;
      this.scheduleProgramBackgroundReconcile();
    }, PROGRAM_BACKGROUND_WATCH_INTERVAL_MS);
  }

  private stopProgramBackgroundWatcher(): void {
    if (this._programBackgroundWatchTimer) {
      clearInterval(this._programBackgroundWatchTimer);
      this._programBackgroundWatchTimer = null;
    }
    this._programBackgroundPendingScene = null;
    this._programBackgroundPendingForce = false;
  }

  private scheduleProgramBackgroundReconcile(sceneName?: string, force = false): void {
    if (!this.isConnected || isFreeDockPlan()) {
      if (isFreeDockPlan()) this.stopProgramBackgroundWatcher();
      return;
    }
    if (loadProjectionSettings().sceneMode !== "auto-duplicate") return;

    this._programBackgroundPendingScene = sceneName?.trim() || "";
    this._programBackgroundPendingForce ||= force;
    if (this._programBackgroundReconcilePromise) return;

    const run = (async () => {
      while (this.isConnected && this._programBackgroundPendingScene !== null) {
        const requestedScene = this._programBackgroundPendingScene || undefined;
        const requestedForce = this._programBackgroundPendingForce;
        this._programBackgroundPendingScene = null;
        this._programBackgroundPendingForce = false;
        await this.reconcileProgramBackground(requestedScene, requestedForce).catch((error) => {
          console.warn("[DockOBS] Program background watcher failed:", error);
        });
      }
    })();

    this._programBackgroundReconcilePromise = run.finally(() => {
      this._programBackgroundReconcilePromise = null;
      if (this.isConnected && this._programBackgroundPendingScene !== null) {
        this.scheduleProgramBackgroundReconcile(undefined, this._programBackgroundPendingForce);
      }
    });
  }

  private async reconcileProgramBackground(
    requestedScene?: string,
    force = false,
  ): Promise<void> {
    if (!this.isConnected || loadProjectionSettings().sceneMode !== "auto-duplicate") return;

    const liveProgramScene = (requestedScene || await this.getCurrentProgramSceneName(true).catch(() => "")).trim();
    if (!liveProgramScene) return;

    if (liveProgramScene !== DOCK_PRESENTATION_SCENE) {
      this.rememberLastProgramBackgroundScene(liveProgramScene);
    }

    // If MCE Presentation is already Program in non-Studio Mode, retain the
    // last real Program scene as the background instead of nesting the
    // presentation scene inside itself. This survives Dock reloads because
    // the scene name is stored in the native Dock settings database.
    let sourceScene = liveProgramScene;
    const usingRememberedScene = liveProgramScene === DOCK_PRESENTATION_SCENE;
    if (usingRememberedScene) {
      sourceScene = this.readLastProgramBackgroundScene();
      if (!sourceScene || sourceScene === DOCK_PRESENTATION_SCENE) return;
      if (DockObsClient.isManagedMultiviewSceneName(sourceScene)) return;
      if (!await this.hasObsScene(sourceScene).catch(() => false)) return;
    }

    if (
      sourceScene === DOCK_PRESENTATION_SCENE ||
      DockObsClient.isManagedMultiviewSceneName(sourceScene)
    ) return;

    const studioMode = await this.isStudioModeEnabled(true).catch(() => false);
    await this.ensureProgramSceneAsSourceInPresentation(force, {
      // The helper normally protects non-Studio Mode from scene mutations.
      // Program-background-on is the explicit exception requested by the
      // operator, so it must also reconcile the live scene without Studio
      // Mode enabled.
      allowWithoutStudioMode: !studioMode,
      programSceneName: sourceScene,
    });
  }

  // ── Branding ──

  /** Load branding from the dock JSON file served by the overlay server */
  private async _loadBranding(): Promise<void> {
    try {
      const res = await fetch(`${this.getOverlayBaseUrl()}/uploads/dock-branding.json?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      this._brandingCache = {
        logoFileName: data.brandLogoFileName || "",
        brandColor: data.brandColor || "",
        churchName: data.churchName || "",
      };
    } catch {
      // Branding file doesn't exist yet or server not ready — ignore
    }
  }

  async refreshBrandingCache(): Promise<void> {
    await this._loadBranding();
  }

  /** Get the resolved logo URL for lower-third overlays */
  private _getLogoUrl(): string {
    // 1. Try branding cache (loaded from dock-branding.json)
    if (this._brandingCache?.logoFileName) {
      return `${this.getOverlayBaseUrl()}/uploads/${encodeURIComponent(this._brandingCache.logoFileName)}`;
    }
    // 2. Fall back to ministry store logo
    const ministry = getMinistryData();
    if (ministry.logoPath) {
      const raw = ministry.logoPath.trim();
      if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
      const clean = raw.replace(/^\/+/, "");
      return `${this.getOverlayBaseUrl()}/${clean}`;
    }
    return "";
  }

  // ── Status ──

  private setStatus(s: DockObsStatus, error = "") {
    this._status = s;
    this._error = error;
    this.listeners.forEach((cb) => cb(s, error));
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Resolve connection params ──

  private resolveParams(url?: string, password?: string) {
    if (url) {
      this._url = normalizeOBSWebSocketUrl(url);
      this._password = password;
      return;
    }

    // 1. URL query params
    try {
      const params = new URLSearchParams(window.location.search);
      const qUrl = params.get("obsUrl");
      const qPw = params.get("obsPassword");
      if (qUrl) {
        this._url = normalizeOBSWebSocketUrl(qUrl);
        this._password = qPw || undefined;
        return;
      }
    } catch { /* ignore */ }

    // 2. Persisted dock connection params (from previous successful connect)
    try {
      const raw = readNativeDockSetting<unknown>(DOCK_OBS_PARAMS_KEY);
      if (raw) {
        const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as { url?: unknown; password?: unknown };
        if (p.url) {
          this._url = normalizeOBSWebSocketUrl(String(p.url));
          this._password = typeof p.password === "string" && p.password ? p.password : undefined;
          return;
        }
      }
    } catch { /* ignore */ }

    // 3. Native mv-settings (legacy multiview store)
    try {
      const stored = readNativeDockSetting<unknown>("mv-settings");
      if (stored) {
        const s = (typeof stored === "string" ? JSON.parse(stored) : stored) as { obsUrl?: unknown; obsPassword?: unknown };
        if (s.obsUrl) {
          this._url = normalizeOBSWebSocketUrl(String(s.obsUrl));
          this._password = typeof s.obsPassword === "string" && s.obsPassword ? s.obsPassword : undefined;
          return;
        }
      }
    } catch { /* ignore */ }

    // 4. Default
    this._url = normalizeOBSWebSocketUrl(getDefaultOBSUrl());
    this._password = undefined;
  }

  /** Persist current connection params so dock auto-reconnects on next reload */
  private persistParams() {
    writeNativeDockSetting(DOCK_OBS_PARAMS_KEY, {
      url: this._url,
      password: this._password || "",
    });
  }

  // ── Connection ──

  async connect(
    url?: string,
    password?: string,
    forceReconnect = false,
    options?: { persist?: boolean },
  ) {
    const hasExplicitUrl = Boolean(url);
    if (!hasExplicitUrl && !forceReconnect) {
      if (this.isConnected) return;
      if (this._connectPromise) return this._connectPromise;
    }

    const previousUrl = this._url;
    const previousPassword = this._password;

    if (hasExplicitUrl) {
      this._persistConnectionParams = options?.persist !== false;
      this._hasTransientExplicitConnection = options?.persist === false;
      this.resolveParams(url, password);
    } else if (!this._hasTransientExplicitConnection) {
      this._persistConnectionParams = true;
      this.resolveParams();
    }

    const explicitParamsChanged = hasExplicitUrl &&
      (this._url !== previousUrl || this._password !== previousPassword);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.isConnected && !forceReconnect && !explicitParamsChanged) return;
    if (this._connectPromise && !forceReconnect && !explicitParamsChanged) return this._connectPromise;

    const connectPromise = (async () => {
      this.setStatus("connecting");

      // Increment generation — any callbacks from a prior OBS instance are stale
      const gen = ++this._obsGeneration;

      // Disconnect old instance before creating a new one.
      connTracker.unregister("dock-cef");
      try { await this.obs.disconnect(); } catch { /* ignore */ }

      try {
        this.obs = new OBSWebSocket();

        // Guard: only fire status changes if this is still the current generation
        this.obs.on("ConnectionClosed", () => {
          if (this._obsGeneration !== gen) return; // stale instance — ignore
          this.resetObsStateCaches();
          connTracker.unregister("dock-cef");
          this.setStatus("disconnected", "Connection closed");
          this.scheduleReconnect();
        });
        this.obs.on("ConnectionError" as never, () => {
          if (this._obsGeneration !== gen) return; // stale instance — ignore
          this.resetObsStateCaches();
          connTracker.unregister("dock-cef");
          this.setStatus("error", "Connection error");
          this.scheduleReconnect();
        });
        const handleStudioModeStateChange = (data: { studioModeEnabled?: boolean } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const enabled = Boolean((data as { studioModeEnabled?: boolean } | undefined)?.studioModeEnabled);
          this._studioModeCache = { value: enabled, expiresAt: Date.now() + 30_000 };
          if (!enabled) {
            this.onStudioModeDisabled().catch((err) =>
              console.warn("[DockOBS] Error handling studio mode disabled:", err),
            );
          }
          this.scheduleProgramBackgroundReconcile(undefined, true);
        };
        // OBS WebSocket 5 uses the plural event name. Keep the legacy alias
        // as well because older OBS builds emitted the singular spelling.
        this.obs.on("StudioModeStateChanged" as never, handleStudioModeStateChange);
        this.obs.on("StudioModeStateChange" as never, handleStudioModeStateChange);
        this.obs.on("CurrentProgramSceneChanged" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (!sceneName) return;
          this._programSceneCache = { name: sceneName, expiresAt: Date.now() + 30_000 };
          this.rememberLastProgramBackgroundScene(sceneName);
          this.scheduleProgramBackgroundReconcile(sceneName, true);
          this._lastBibleFullscreenSetupSignature = "";
          if (sceneName !== DOCK_PRESENTATION_SCENE) {
            this._lastBibleProgramScenePrepared = "";
            this._lastFastOverlayPrepAtBySource = {};
            this._presentationProgramUnderlayCache = null;
          }
        });
        this.obs.on("CurrentPreviewSceneChanged" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (sceneName && sceneName !== DOCK_PRESENTATION_SCENE) {
            this._lastFastOverlayPrepAtBySource = {};
          }
        });
        this.obs.on("SceneCreated" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (sceneName) {
            this._knownScenes.add(sceneName);
            this.invalidateSceneItemListCache(sceneName);
            this.invalidateActiveMceOverlayState(sceneName);
          }
        });
        this.obs.on("SceneItemEnableStateChanged" as never, (data: { sceneName?: string; sceneItemId?: number; sceneItemEnabled?: boolean } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const d = data as { sceneName?: string; sceneItemId?: number; sceneItemEnabled?: boolean } | undefined;
          const sceneName = String(d?.sceneName || "").trim();
          if (sceneName) {
            this.invalidateSceneItemListCache(sceneName);
            this.invalidateActiveMceOverlayState(sceneName);
          } else {
            this.invalidateSceneItemListCache();
            this.invalidateActiveMceOverlayState();
          }
        });
        this.obs.on("SceneItemListReindex" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (sceneName) {
            this.invalidateSceneItemListCache(sceneName);
            this.invalidateActiveMceOverlayState(sceneName);
          }
        });
        this.obs.on("SceneItemCreated" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (sceneName) {
            this.invalidateSceneItemListCache(sceneName);
            this.invalidateActiveMceOverlayState(sceneName);
          }
        });
        this.obs.on("SceneItemRemoved" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (sceneName) {
            this.invalidateSceneItemListCache(sceneName);
            this.invalidateActiveMceOverlayState(sceneName);
          }
        });
        this.obs.on("SceneRemoved" as never, (data: { sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (!sceneName) return;
          this._knownScenes.delete(sceneName);
          this._cloneExistsCache.delete(sceneName);
          delete this._activeMceOverlayStateByScene[sceneName];
          if (this._sceneItemListCache?.sceneName === sceneName) this._sceneItemListCache = null;
          if (this._programSceneCache?.name === sceneName) this._programSceneCache = null;
          if (sceneName === DOCK_PRESENTATION_SCENE) {
            this._presentationSceneDeletedAt = Date.now();
            this.resetPresentationSceneState();
          }
        });
        this.obs.on("SceneNameChanged" as never, (data: { oldSceneName?: string; sceneName?: string } | unknown) => {
          if (this._obsGeneration !== gen) return;
          const oldSceneName = String((data as { oldSceneName?: string } | undefined)?.oldSceneName || "").trim();
          const sceneName = String((data as { sceneName?: string } | undefined)?.sceneName || "").trim();
          if (oldSceneName) {
            this._knownScenes.delete(oldSceneName);
            this._cloneExistsCache.delete(oldSceneName);
            delete this._activeMceOverlayStateByScene[oldSceneName];
          }
          if (sceneName) this._knownScenes.add(sceneName);
          this._sceneItemListCache = null;
          if (this._programSceneCache?.name === oldSceneName) this._programSceneCache = null;
          if (oldSceneName === DOCK_PRESENTATION_SCENE) {
            this._presentationSceneDeletedAt = Date.now();
            this.resetPresentationSceneState();
          }
        });

        await Promise.race([
          this.obs.connect(this._url, this._password, { rpcVersion: 1 }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("Connection timed out (5s)")), 5000)
          ),
        ]);

        // Verify this connect attempt is still the current one
        if (this._obsGeneration !== gen) return;

        this._reconnectAttempts = 0;
        this.resetObsStateCaches();
        // Mark the socket connected before any follow-up OBS RPCs. Otherwise
        // helper calls like ensureDedicatedScene() recurse back into connect()
        // and the dock stays stuck in "connecting".
        this.setStatus("connected");
        connTracker.register("dock-cef", this._url);
        // Wake any MCE browser source that loaded before the overlay server was ready.
        // Skipped automatically while OBS is streaming or recording.
        if (!isFreeDockPlan()) {
          // Retired sources from older versions are removed first, so the
          // refresh below does not wake a source that is about to go.
          void scheduleRetiredMceSourceCleanup(
            (type, data) => this.call(type, data, { priority: "low" }),
            "dock",
            () => {
              this.invalidateSceneItemListCache();
              this.invalidateActiveMceOverlayState();
            },
          );
          void scheduleMceBrowserSourceRefresh((type, data) => this.call(type, data, { priority: "low" }), "dock");
        }

        // Persist normal dock connection params so auto-reconnect works across
        // dock reloads. Remote presentation uses a transient target and must
        // not overwrite the user's normal OBS settings.
        if (this._persistConnectionParams) {
          this.persistParams();
        }

        this.startProgramBackgroundWatcher();

        if (isFreeDockPlan()) {
          void this.clearMCESourcesForFreePlan();
        }

        const startupPromise = (async () => {
          // A dock reload must not reorder, rebuild, or otherwise mutate the
          // MCE Presentation scene. Scene creation and source wiring now happen
          // only when an explicit dock command is sent.
        })();
        this._startupReadyPromise = startupPromise;
        void startupPromise;
      } catch (err) {
        if (this._obsGeneration !== gen) return; // stale — ignore
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[DockOBS] Connect failed:", msg);
        connTracker.unregister("dock-cef");
        this.resetObsStateCaches();
        this.setStatus("error", msg);
        this.scheduleReconnect();
      }
    })();

    this._connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this._connectPromise === connectPromise) {
        this._connectPromise = null;
      }
    }
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Bump the generation so ConnectionClosed/ConnectionError events from
    // this deliberate disconnect cannot schedule an automatic reconnect.
    this._obsGeneration += 1;
    this._connectPromise = null;
    this._persistConnectionParams = true;
    this._hasTransientExplicitConnection = false;
    this.resetObsStateCaches();
    await this.deleteClone().catch(() => { });
    try { await this.obs.disconnect(); } catch { /* ignore */ }
    connTracker.unregister("dock-cef");
    this.setStatus("disconnected");
  }

  async prewarmPrimaryDockSources(): Promise<void> {
    if (isFreeDockPlan()) return;
    if (this._startupPrewarmPromise) return this._startupPrewarmPromise;

    const warmupPromise = (async () => {
      if (!this.isConnected) {
        await this.connect();
        const deadline = Date.now() + 3000;
        while (!this.isConnected && Date.now() < deadline) {
          await this.sleep(100);
        }
        if (!this.isConnected) return;
      }

      const resources = getDockResources();
      const startupBlankTimestamp = Date.now();
      const bibleMode = readPersistedDockOverlayMode("bible") ?? "lower-third";
      const bibleBlankPacket = {
        slide: null,
        theme: null,
        live: false,
        blanked: true,
        timestamp: startupBlankTimestamp,
        mode: bibleMode,
      } as const;

      await this.ensurePresentationSceneReady().catch(() => { });
      await this.ensureProgramSceneAsSourceInPresentation(true).catch(() => { });

      // Clean off legacy MCE Browser - Bible and MCE BG - Bible so they do not linger or trigger
      await this.removeSceneItemBySource(DOCK_PRESENTATION_SCENE, "MCE Browser - Bible").catch(() => { });
      await this.removeSceneItemBySource(DOCK_PRESENTATION_SCENE, "MCE BG - Bible").catch(() => { });

      const bibleSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
      const bibleBaseUrl = this.buildCssOverlayHtmlUrlForTab("bible", bibleSourceName, bibleMode);
      const bibleCss = this.buildCssOverlayDataCss({ ...bibleBlankPacket }, "");

      await this._ensureFullscreenScene("bible", bibleMode).catch(() => { });
      await this.ensureOverlaySource(DOCK_PRESENTATION_SCENE, bibleSourceName, undefined, undefined, true).catch(() => { });
      await this.setBrowserSourceUrl(bibleSourceName, bibleBaseUrl, false, bibleCss).catch(() => { });
      this._lastCssOverlayPacketBySource[bibleSourceName] = { ...bibleBlankPacket };
      this._lastCssOverlayBaseUrlBySource[bibleSourceName] = bibleBaseUrl;
      this._lastCssOverlayThemeCssBySource[bibleSourceName] = "";

      this._bibleLtInitialized = true;

      const worshipSourceName = resources.worshipSource;
      const worshipMode = readPersistedDockOverlayMode("worship") ?? "lower-third";
      const worshipBlankPacket = {
        slide: null,
        theme: null,
        live: false,
        blanked: true,
        timestamp: startupBlankTimestamp,
        mode: worshipMode,
      } as const;
      const worshipBaseUrl = this.buildCssOverlayHtmlUrlForTab("worship", worshipSourceName);
      const worshipCss = this.buildCssOverlayDataCss({ ...worshipBlankPacket }, "");

      await this.ensureDedicatedScene(resources.worshipScene).catch(() => { });
      await this.ensureOverlaySource(resources.worshipScene, worshipSourceName, undefined, undefined, true).catch(() => { });
      await this.ensureOverlaySource(DOCK_PRESENTATION_SCENE, worshipSourceName, undefined, undefined, true).catch(() => { });
      await this.setBrowserSourceUrl(worshipSourceName, worshipBaseUrl, false, worshipCss).catch(() => { });
      this._lastCssOverlayPacketBySource[worshipSourceName] = { ...worshipBlankPacket };
      this._lastCssOverlayBaseUrlBySource[worshipSourceName] = worshipBaseUrl;
      this._lastCssOverlayThemeCssBySource[worshipSourceName] = "";
      this._worshipInitialized = true;
    })();

    const trackedPromise = warmupPromise.finally(() => {
      if (this._startupPrewarmPromise === trackedPromise) {
        this._startupPrewarmPromise = null;
      }
    });
    this._startupPrewarmPromise = trackedPromise;

    return trackedPromise;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Exponential backoff: 300ms → 600ms → 1.2s → 2.4s → 4.8s → capped at 8s
    const delay = Math.min(
      DOCK_OBS_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts),
      DOCK_OBS_RECONNECT_MAX_DELAY_MS,
    );
    this._reconnectAttempts++;
    if (this._reconnectAttempts === 1 || this._reconnectAttempts % 4 === 0) {
      console.log(`[DockOBS] Reconnect attempt ${this._reconnectAttempts}, delay ${delay}ms`);
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._status !== "connected") {
        await this.connect(this._url, this._password, true, { persist: this._persistConnectionParams });
      }
    }, delay);
  }

  async waitUntilReady(timeoutMs = 15000): Promise<void> {
    const startupPromise = this._startupReadyPromise;
    if (!startupPromise) return;

    await Promise.race([
      startupPromise,
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  // ── OBS API helpers ──

  async call(
    requestType: string,
    requestData?: Record<string, unknown>,
    options: { priority?: "high" | "normal" | "low"; bypassFreeMutationGate?: boolean } = {},
  ): Promise<unknown> {
    // Check before auto-reconnecting. A Free-plan Dock must not even open an
    // OBS mutation path that could later create or update a scene/source.
    if (!options.bypassFreeMutationGate) {
      assertDockObsMutationAllowed(requestType);
    }

    // Auto-reconnect if not connected
    if (!this.isConnected) {
      await this.connect();
      // Poll until connected or timeout — much more reliable than a fixed sleep
      const deadline = Date.now() + 3000;
      while (!this.isConnected && Date.now() < deadline) {
        await this.sleep(100);
      }
    }
    if (!this.isConnected) throw new Error("Not connected to OBS");

    // Defensively handle GetCurrentProgramScene and GetCurrentPreviewScene:
    // In obs-websocket, GetCurrentProgramScene and GetCurrentPreviewScene omit
    // null checks on obs_frontend_get_current_scene(). When an active scene or
    // MCE Presentation scene is deleted, obs_frontend_get_current_scene() temporarily returns NULL.
    // obs-websocket then passes NULL to strlen(NULL) in std::string, causing an
    // immediate SIGSEGV crash of the entire OBS Studio process.
    // In contrast, GetSceneList has explicit null guards (cbz x0 in ARM64 disassembly)
    // and safely returns currentProgramSceneName and currentPreviewSceneName without crashing.
    if (requestType === "GetCurrentProgramScene") {
      const sceneList = await this.call("GetSceneList", undefined, options) as {
        currentProgramSceneName?: string | null;
        currentProgramSceneUuid?: string | null;
      };
      const currentProgramSceneName = String(sceneList?.currentProgramSceneName ?? "").trim();
      const currentProgramSceneUuid = String(sceneList?.currentProgramSceneUuid ?? "").trim();
      return {
        currentProgramSceneName,
        sceneName: currentProgramSceneName,
        currentProgramSceneUuid,
        sceneUuid: currentProgramSceneUuid,
      };
    }
    if (requestType === "GetCurrentPreviewScene") {
      const sceneList = await this.call("GetSceneList", undefined, options) as {
        currentPreviewSceneName?: string | null;
        currentPreviewSceneUuid?: string | null;
      };
      const currentPreviewSceneName = String(sceneList?.currentPreviewSceneName ?? "").trim();
      const currentPreviewSceneUuid = String(sceneList?.currentPreviewSceneUuid ?? "").trim();
      return {
        currentPreviewSceneName,
        sceneName: currentPreviewSceneName,
        currentPreviewSceneUuid,
        sceneUuid: currentPreviewSceneUuid,
      };
    }

    const t0 = Date.now();
    try {
      const request = () => obsQueue.enqueue(
        requestType,
        () => {
          // Re-check immediately before the WebSocket write in case the
          // account was downgraded while this request was reconnecting or
          // waiting in the OBS queue.
          if (!options.bypassFreeMutationGate) {
            assertDockObsMutationAllowed(requestType);
          }
          return this.obs.call(requestType as never, requestData as never);
        },
        {
          dedupeKey: requestData?.sceneName ? `${requestType}:${requestData.sceneName}` : undefined,
          priority: options.priority,
        },
      );

      try {
        const result = await request();
        this.noteObsSceneMutation(requestType, requestData);
        return result;
      } catch (err) {
        if (!this.shouldRepairPresentationSceneReference(requestType, requestData, err)) {
          throw err;
        }

        // OBS removes the scene source before reporting the manual deletion to
        // the dock. Recreate the managed scene, then repeat the original add.
        await this.repairPresentationSceneReference();
        const result = await request();
        this.noteObsSceneMutation(requestType, requestData);
        return result;
      }
    } finally {
      this._trackCallLatency(Date.now() - t0, requestType);
    }
  }

  /**
   * Send multiple OBS requests in a single WebSocket frame via callBatch.
   * Bypasses the rate limiter since it's one network round-trip.
   * Use for independent calls that can execute in parallel (e.g., hiding multiple sources).
   */
  async callBatch(
    requests: Array<{ requestType: string; requestData?: Record<string, unknown> }>,
    executionType: 0 | 1 | 2 = 2, // default: Parallel
  ): Promise<Array<{ requestData?: unknown; requestStatus?: { code: number; comment?: string } }>> {
    for (const request of requests) {
      assertDockObsMutationAllowed(request.requestType);
    }

    if (!this.isConnected) {
      await this.connect();
      const deadline = Date.now() + 3000;
      while (!this.isConnected && Date.now() < deadline) {
        await this.sleep(100);
      }
    }
    if (!this.isConnected) throw new Error("Not connected to OBS");

    const t0 = Date.now();
    try {
      const batch = requests.map(r => ({
        requestType: r.requestType as never,
        requestData: r.requestData as never,
      }));
      for (const request of requests) {
        assertDockObsMutationAllowed(request.requestType);
      }
      const results = await this.obs.callBatch(batch, { executionType });
      for (const request of requests) {
        this.noteObsSceneMutation(request.requestType, request.requestData);
      }
      const elapsed = Date.now() - t0;
      if (elapsed > 500) {
        console.warn(`[DockOBS] Slow batch: ${requests.length} requests took ${elapsed}ms`);
      }
      return results as Array<{ requestData?: unknown; requestStatus?: { code: number; comment?: string } }>;
    } catch (err) {
      console.error(`[DockOBS] callBatch failed after ${Date.now() - t0}ms:`, err);
      throw err;
    }
  }

  /** Track call latency and warn when OBS is struggling. */
  private _trackCallLatency(durationMs: number, requestType: string): void {
    const now = Date.now();
    // Reset window every 30s
    if (now - this._callLatencyWindowStart > 30000) {
      if (this._callLatencies.length >= 10) {
        const sorted = [...this._callLatencies].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        if (p95 > 500) {
          console.warn(`[DockOBS] OBS slow — p50=${p50}ms p95=${p95}ms (${sorted.length} calls in 30s). OBS may be overloaded.`);
        } else if (p95 > 200) {
          console.log(`[DockOBS] OBS latency: p50=${p50}ms p95=${p95}ms`);
        }
      }
      this._callLatencies = [];
      this._callLatencyWindowStart = now;
    }
    this._callLatencies.push(durationMs);
    // Warn on individual slow calls
    if (durationMs > 1000 && requestType !== "Connect") {
      console.warn(`[DockOBS] Slow call: ${requestType} took ${durationMs}ms`);
    }
  }

  async getCanvasSize(): Promise<{ width: number; height: number }> {
    const now = Date.now();
    if (this._canvasCache && now < this._canvasCache.expiresAt) {
      return this._canvasCache.size;
    }
    try {
      const video = await this.call("GetVideoSettings") as {
        baseWidth?: number;
        baseHeight?: number;
      };
      const fallback = getDefaultCanvasSize();
      const size = {
        width: Number(video.baseWidth) || fallback.width,
        height: Number(video.baseHeight) || fallback.height,
      };
      this._canvasCache = { size, expiresAt: now + 60_000 };
      return size;
    } catch {
      return getDefaultCanvasSize();
    }
  }

  private async fitSceneItemToCanvas(sceneName: string, sceneItemId: number): Promise<void> {
    const { width, height } = await this.getCanvasSize();
    const sceneItemTransform: Record<string, unknown> = {
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: width,
      boundsHeight: height,
      boundsAlignment: 0,
      cropLeft: 0,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
    };
    try {
      await this.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId,
        sceneItemTransform,
      });
    } catch { /* ignore — transform is best-effort */ }
  }

  private async fitSceneSourceToCanvas(sceneName: string, sourceName: string): Promise<void> {
    const item = await this.getSceneItemBySource(sceneName, sourceName);
    if (!item) return;
    await this.fitSceneItemToCanvas(sceneName, item.sceneItemId);
  }

  private isStaticFullFrameOverlaySource(sourceName: string): boolean {
    const resources = getDockResources();
    return sourceName === this._fullscreenSceneDefs["bible"]?.browserSourceName
      || sourceName === resources.worshipSource
      || sourceName === resources.notesSource;
  }

  private async fitSceneSourceToLowerThirdWindow(sceneName: string, sourceName: string): Promise<void> {
    if (this.isStaticFullFrameOverlaySource(sourceName)) {
      await this.fitSceneSourceToCanvas(sceneName, sourceName);
      return;
    }

    const item = await this.getSceneItemBySource(sceneName, sourceName);
    if (!item) return;
    const { width, height } = await this.getCanvasSize();
    const visibleRatio = 0.42;
    const visibleHeight = Math.min(height, Math.round(height * visibleRatio));
    const cropTop = Math.max(0, height - visibleHeight);
    const sceneItemTransform: Record<string, unknown> = {
      positionX: 0,
      positionY: cropTop,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: width,
      boundsHeight: visibleHeight,
      boundsAlignment: 0,
      cropLeft: 0,
      cropTop,
      cropRight: 0,
      cropBottom: 0,
    };

    try {
      await this.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: { width, height },
      });
    } catch { /* best effort */ }

    await this.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemTransform,
    });
  }

  private async setSceneSourceEnabledByName(sceneName: string, sourceName: string, enabled: boolean): Promise<boolean> {
    const item = await this.getSceneItemBySource(sceneName, sourceName);
    if (!item) return false;
    await this.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: enabled,
    });
    this.invalidateSceneItemListCache(sceneName);
    return true;
  }

  private async fitSceneSourceToOverlayMode(
    sceneName: string,
    sourceName: string,
    _mode: DockOverlayMode,
  ): Promise<void> {
    // Both Fullscreen and Lower-Third use a unified full-canvas source.
    // Lower-third appearance is created by HTML/CSS inside the fixed source,
    // NOT by OBS cropping. This avoids scene-item resize/crop during mode switches.
    await this.fitSceneSourceToCanvas(sceneName, sourceName);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Get scene items with a short-lived cache (3s). Avoids redundant GetSceneItemList calls within a single operation. */
  private async getSceneItemListCached(sceneName: string): Promise<Array<{ sourceName: string; sceneItemId: number; sceneItemIndex?: number; sceneItemEnabled?: boolean }>> {
    const now = Date.now();
    if (this._sceneItemListCache && this._sceneItemListCache.sceneName === sceneName && this._sceneItemListCache.expiresAt > now) {
      return this._sceneItemListCache.items;
    }
    let resp: { sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number; sceneItemEnabled: boolean }> };
    try {
      resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number; sceneItemEnabled: boolean }>;
      };
    } catch (err) {
      if (sceneName !== DOCK_PRESENTATION_SCENE || !this.isMissingObsSceneError(err)) {
        throw err;
      }

      this._knownScenes.delete(sceneName);
      this.invalidateSceneItemListCache(sceneName);
      this.resetPresentationSceneState();
      await this.ensurePresentationSceneReady();
      resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number; sceneItemEnabled: boolean }>;
      };
    }
    const items = resp.sceneItems ?? [];
    if (items.length > 20) {
      console.warn(`[DockOBS] Scene "${sceneName}" has ${items.length} items — this may cause slow rendering on older hardware.`);
    }
    this._sceneItemListCache = { sceneName, items, expiresAt: now + 3000 };
    return items;
  }

  /** Invalidate the scene item list cache for a specific scene (call after mutations). */
  private invalidateSceneItemListCache(sceneName?: string): void {
    if (!sceneName || !this._sceneItemListCache || this._sceneItemListCache.sceneName === sceneName) {
      this._sceneItemListCache = null;
    }
    if (!sceneName) {
      this._lastVerifiedStackedBySceneSource = {};
    } else {
      const prefix = `${sceneName}::`;
      for (const k of Object.keys(this._lastVerifiedStackedBySceneSource)) {
        if (k.startsWith(prefix)) {
          delete this._lastVerifiedStackedBySceneSource[k];
        }
      }
    }
  }

  /**
   * OBS scene-item mutations must immediately clear our short-lived cache.
   * Otherwise a source can be disabled in OBS while the dock still believes
   * it is visible for up to 3 seconds, which causes the next push to no-op.
   */
  private noteObsSceneMutation(
    requestType: string,
    requestData?: Record<string, unknown>,
  ): void {
    const sceneName = typeof requestData?.sceneName === "string"
      ? requestData.sceneName.trim()
      : "";

    if (!sceneName) return;

    switch (requestType) {
      case "CreateInput":
      case "CreateSceneItem":
      case "DuplicateSceneItem":
      case "RemoveSceneItem":
        this.invalidateSceneItemListCache(sceneName);
        this.invalidateActiveMceOverlayState(sceneName);
        break;
      case "SetSceneItemEnabled":
      case "SetSceneItemIndex":
        this.invalidateSceneItemListCache(sceneName);
        break;
      default:
        break;
    }
  }

  private async runCollapsingQueueMutation<T>(
    getTail: () => Promise<void>,
    setTail: (tail: Promise<void>) => void,
    getCounter: () => number,
    incCounter: () => number,
    task: () => Promise<T>,
  ): Promise<T> {
    const mutationId = incCounter();
    while (getTail()) {
      const activeTail = getTail();
      try {
        await activeTail;
      } catch {
        // ignore errors from earlier mutations
      }
      if (mutationId !== getCounter()) {
        return undefined as T;
      }
      if (getTail() === activeTail) {
        break;
      }
    }
    if (mutationId !== getCounter()) {
      return undefined as T;
    }
    let resolveTail!: () => void;
    const tailPromise = new Promise<void>((r) => { resolveTail = r; });
    setTail(tailPromise);
    try {
      return await task();
    } finally {
      resolveTail();
    }
  }

  private async runSerializedBibleMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._bibleMutationTail,
      (t) => { this._bibleMutationTail = t; },
      () => this._bibleMutationCounter,
      () => ++this._bibleMutationCounter,
      task,
    );
  }

  private async runSerializedPresentationMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._presentationMutationTail,
      (t) => { this._presentationMutationTail = t; },
      () => this._presentationMutationCounter,
      () => ++this._presentationMutationCounter,
      task,
    );
  }

  private async runSerializedWorshipMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._worshipMutationTail,
      (t) => { this._worshipMutationTail = t; },
      () => this._worshipMutationCounter,
      () => ++this._worshipMutationCounter,
      task,
    );
  }

  private async runSerializedAnnouncementMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._announcementMutationTail,
      (t) => { this._announcementMutationTail = t; },
      () => this._announcementMutationCounter,
      () => ++this._announcementMutationCounter,
      task,
    );
  }

  private async runSerializedNotesMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._notesMutationTail,
      (t) => { this._notesMutationTail = t; },
      () => this._notesMutationCounter,
      () => ++this._notesMutationCounter,
      task,
    );
  }

  private async runSerializedMediaMutation<T>(task: () => Promise<T>): Promise<T> {
    return this.runCollapsingQueueMutation(
      () => this._mediaMutationTail,
      (t) => { this._mediaMutationTail = t; },
      () => this._mediaMutationCounter,
      () => ++this._mediaMutationCounter,
      task,
    );
  }

  private buildBiblePushSignature(
    sceneName: string,
    currentProgramSceneBeforeTarget: string,
    data: {
      book: string;
      chapter: number;
      verse: number;
      lineCount?: number;
      verseEnd?: number;
      verseRange?: string;
      referenceLabel?: string;
      translation: string;
      theme?: string;
      verseText?: string;
      overlayMode?: "fullscreen" | "lower-third";
      backgroundOnly?: boolean;
      compareEnabled?: boolean;
      compareMode?: "translations" | "passages";
      compareLayout?: "line-by-line" | "side-by-side";
      translationA?: string;
      translationB?: string;
      compare?: {
        enabled?: boolean;
        mode?: "translations" | "passages";
        layout?: "line-by-line" | "side-by-side";
        columns?: Array<{
          book: string;
          chapter: number;
          verse: number;
          verseEnd?: number;
          verseRange?: string;
          referenceLabel: string;
          translation: string;
          verseText: string;
        }>;
      } | null;
      bibleThemeSettings?: Record<string, unknown> | null;
      liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
    },
  ): string {
    return JSON.stringify({
      sceneName,
      currentProgramSceneBeforeTarget,
      book: data.book,
      chapter: data.chapter,
      verse: data.verse,
      lineCount: data.lineCount ?? null,
      verseEnd: data.verseEnd ?? null,
      verseRange: data.verseRange ?? "",
      referenceLabel: data.referenceLabel ?? "",
      translation: data.translation,
      theme: data.theme ?? "",
      verseText: data.verseText ?? "",
      overlayMode: data.overlayMode ?? "fullscreen",
      backgroundOnly: Boolean(data.backgroundOnly),
      compareEnabled: Boolean(data.compareEnabled),
      compareMode: data.compareMode ?? data.compare?.mode ?? "translations",
      compareLayout: data.compareLayout ?? "",
      translationA: data.translationA ?? "",
      translationB: data.translationB ?? "",
      compare: data.compare ?? null,
      bibleThemeSettings: data.bibleThemeSettings ?? null,
      liveOverrides: data.liveOverrides ?? null,
    });
  }

  private buildBibleFullscreenSetupSignature(
    sceneName: string,
    currentProgramSceneBeforeTarget: string,
    _themeSettings: Record<string, unknown> | null,
  ): string {
    const def = this._fullscreenSceneDefs["bible"];
    return JSON.stringify({
      sceneName,
      currentProgramSceneBeforeTarget,
      browserSourceName: def.browserSourceName,
      overlayFile: def.overlayFile,
    });
  }

  private buildWorshipPushSignature(
    sceneName: string,
    currentProgramSceneBeforeTarget: string,
    data: {
      sectionText: string;
      translationText?: string;
      sectionLabel: string;
      songTitle: string;
      artist?: string;
      overlayMode?: "fullscreen" | "lower-third";
      backgroundOnly?: boolean;
      ltTheme?: DockLTThemeRef;
      values?: Record<string, string>;
      bibleThemeSettings?: Record<string, unknown> | null;
      liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
    },
  ): string {
    return JSON.stringify({
      sceneName,
      currentProgramSceneBeforeTarget,
      sectionText: data.sectionText,
      translationText: data.translationText ?? "",
      sectionLabel: data.sectionLabel,
      songTitle: data.songTitle,
      artist: data.artist ?? "",
      overlayMode: data.overlayMode ?? "lower-third",
      backgroundOnly: Boolean(data.backgroundOnly),
      ltTheme: data.ltTheme?.id ?? null,
      values: data.values ?? null,
      bibleThemeSettings: data.bibleThemeSettings ?? null,
      liveOverrides: data.liveOverrides ?? null,
    });
  }

  private async getSceneItemBySource(
    sceneName: string,
    sourceName: string
  ): Promise<{ sceneItemId: number; sceneItemEnabled?: boolean } | null> {
    try {
      const items = await this.getSceneItemListCached(sceneName);
      const item = items.find((entry) => entry.sourceName === sourceName);
      return item ? { sceneItemId: item.sceneItemId, sceneItemEnabled: item.sceneItemEnabled } : null;
    } catch {
      return null;
    }
  }

  private async bringSceneSourceToFront(sceneName: string, sourceName: string): Promise<void> {
    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch {
      // Ignore ordering failures for optional overlay sources.
    }
  }

  /**
   * Helper to resolve aliases for legacy MCE sources to ensure backward compatibility.
   */
  getSourceAliases(sourceName: string): string[] {
    const trimmed = (sourceName || "").trim();
    if (!trimmed) return [];
    const aliases = new Set<string>();

    for (const a of getLegacySourceAliases(trimmed)) {
      aliases.add(a);
    }

    const descMatch = trimmed.match(/^([A-Za-z0-9 ]+?) - MCE (.+)$/);
    if (descMatch) {
      aliases.add(`MCE ${descMatch[1]} - ${descMatch[2]}`);
      aliases.add(`MCE ${descMatch[1]}`);
    }

    if (trimmed === DOCK_LT_SOURCE) {
      aliases.add("Lower Third - MCE Lower Third");
      aliases.add("MCE Lower Third");
      aliases.add("MCE Lower Thirds");
    } else if (trimmed === DOCK_TICKER_SOURCE) {
      aliases.add("Ticker - MCE Ticker");
      aliases.add("MCE Ticker");
    } else if (trimmed === DOCK_MEDIA_VIDEO_SOURCE) {
      aliases.add("Video - MCE Media");
      aliases.add("MCE Media - Video");
      aliases.add("MCE Media");
      aliases.add("MCE Video");
    } else if (trimmed === DOCK_MEDIA_IMAGE_SOURCE) {
      aliases.add("Image - MCE Media");
      aliases.add("MCE Media - Image");
      aliases.add("MCE Image");
    } else if (trimmed === DOCK_MEDIA_AUDIO_SOURCE) {
      aliases.add("Audio - MCE Media");
      aliases.add("MCE Media - Audio");
      aliases.add("Audio - MCE Media Image");
      aliases.add("MCE Media - Image Audio");
    } else if (trimmed === DOCK_MEDIA_PATTERN_SOURCE) {
      aliases.add("Pattern - MCE Media");
      aliases.add("MCE Media - Pattern");
    } else if (trimmed === DOCK_MEDIA_TEMPLATE_SOURCE) {
      aliases.add("Template - MCE Media");
    } else if (trimmed === DOCK_MEDIA_REMOTE_SOURCE) {
      aliases.add("Remote - MCE Media");
      aliases.add("MCE Media - Remote");
    } else if (trimmed === DOCK_ANIMATED_LT_SOURCE) {
      aliases.add("Animated Lower Thirds - MCE");
      aliases.add("MCE Animated Lower Thirds");
    } else if (trimmed === DOCK_FS_BG_SOURCE) {
      aliases.add("Fullscreen BG - MCE");
    }

    return Array.from(aliases);
  }

  /**
   * Ensure the source is enabled and properly stacked in the scene.
   * Stacking order from top to bottom:
   * 1. Ticker (if present, highest z-index)
   * 2. Lower-Third (if present and not the current primary source)
   * 3. Current source (Bible, Worship, Notes, Media, etc.)
   * 4. Backgrounds / cameras / other scene items
   */
  async ensureSceneItemVisibleAndStacked(
    sceneName: string,
    sourceName: string,
    force = false,
    options?: { leaveVisibility?: boolean },
  ): Promise<void> {
    // `leaveVisibility` only stacks the item; it never switches it on. Projection
    // paths use it so a source is not shown before its new content has arrived
    // and before the sources it replaces are hidden. That swap is done in one
    // ordered step by ensureActiveMceOverlaySource.
    const leaveVisibility = options?.leaveVisibility === true;
    try {
      const cacheKey = `${sceneName}::${sourceName}`;
      const lastCheck = this._lastVerifiedStackedBySceneSource[cacheKey];
      if (!force && lastCheck && Date.now() - lastCheck < 15000) {
        return;
      }
      if (force) {
        this.invalidateSceneItemListCache(sceneName);
      }

      let items = await this.getSceneItemListCached(sceneName);
      if (!items.length && sceneName !== PRESENTATION_SCENE_NAME && sceneName !== DOCK_PRESENTATION_SCENE) return;

      const aliases = this.getSourceAliases(sourceName);
      let item = items.find((i) => i.sourceName === sourceName || aliases.includes(i.sourceName));
      if (!item) {
        if (sceneName === PRESENTATION_SCENE_NAME || sceneName === DOCK_PRESENTATION_SCENE) {
          // The ticker is only created by starting it in the Ministry tab.
          if (!isMediaNativeManagedSource(sourceName) && isMcePresentationManagedSource(sourceName) && !isMceTickerSourceName(sourceName)) {
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, true).catch(() => { });
            this.invalidateSceneItemListCache(sceneName);
            items = await this.getSceneItemListCached(sceneName);
            item = items.find((i) => i.sourceName === sourceName || aliases.includes(i.sourceName));
          }
        }
      }
      if (!item) return;

      // 1. If item is currently hidden/disabled, unhide it (unless the caller
      // owns the visibility swap and only wants the stacking).
      if (item.sceneItemEnabled === false && !leaveVisibility) {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true,
        }).catch(() => { });
        item.sceneItemEnabled = true;
      }

      const stackedItem = item;
      const markVerified = () => {
        // An item that was only stacked while hidden is not verified visible yet,
        // so a later call that does want it visible must still run.
        if (leaveVisibility && stackedItem.sceneItemEnabled === false) return;
        this._lastVerifiedStackedBySceneSource[cacheKey] = Date.now();
      };

      // 2. Stacking logic
      const isTicker = (name: string) => /ticker/i.test(name);
      const isLowerThird = (name: string) => /lower\s*third|mce\s*lt:/i.test(name);

      const tickerItem = items.find((i) => isTicker(i.sourceName));
      const ltItem = items.find((i) => isLowerThird(i.sourceName) && i.sceneItemId !== item.sceneItemId);

      const topIndex = Math.max(0, items.length - 1);

      // If sourceName is itself Ticker:
      if (isTicker(item.sourceName)) {
        if (item.sceneItemIndex !== topIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemIndex: topIndex,
          }).catch(() => { });
        }
        markVerified();
        return;
      }

      // Keep Ticker at the very top if it exists
      if (tickerItem && tickerItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: tickerItem.sceneItemId,
          sceneItemIndex: topIndex,
        }).catch(() => { });
        tickerItem.sceneItemIndex = topIndex;
      }

      // If sourceName is Lower-Third:
      if (isLowerThird(item.sourceName)) {
        const targetIndex = tickerItem ? Math.max(0, topIndex - 1) : topIndex;
        if (item.sceneItemIndex !== targetIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemIndex: targetIndex,
          }).catch(() => { });
        }
        markVerified();
        return;
      }

      // For Content (Bible, Worship, etc.):
      // Keep Lower-Third above Content if Lower-Third exists
      if (ltItem) {
        const ltTargetIndex = tickerItem ? Math.max(0, topIndex - 1) : topIndex;
        if (ltItem.sceneItemIndex !== ltTargetIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId: ltItem.sceneItemId,
            sceneItemIndex: ltTargetIndex,
          }).catch(() => { });
          ltItem.sceneItemIndex = ltTargetIndex;
        }
      }

      // Content source sits right below Ticker & Lower-Third
      let contentTargetIndex = topIndex;
      if (tickerItem && ltItem) {
        contentTargetIndex = Math.max(0, topIndex - 2);
      } else if (tickerItem || ltItem) {
        contentTargetIndex = Math.max(0, topIndex - 1);
      }

      if (item.sceneItemIndex !== contentTargetIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemIndex: contentTargetIndex,
        }).catch(() => { });
      }

      markVerified();
    } catch { /* ignore ordering failures */ }
  }

  /**
   * Ensure the ticker source stays above the given source in the scene.
   * Delegates to ensureSceneItemVisibleAndStacked.
   */
  async ensureTickerAboveSource(
    sceneName: string,
    sourceName: string,
    options?: { leaveVisibility?: boolean },
  ): Promise<void> {
    return this.ensureSceneItemVisibleAndStacked(sceneName, sourceName, false, options);
  }

  private async getLikelyOverlayScenes(): Promise<string[]> {
    const scenes = new Set<string>([DOCK_PRESENTATION_SCENE, PRESENTATION_SCENE_NAME]);
    try {
      const currentProgram = await this.getCurrentProgramSceneName().catch(() => "");
      if (currentProgram) scenes.add(currentProgram);
    } catch { /* ignore */ }
    return Array.from(scenes).filter(Boolean);
  }

  private async bringExistingSourceForward(sceneName: string, sourceName: string): Promise<boolean> {
    if (!sceneName || !sourceName) return false;
    try {
      this.invalidateSceneItemListCache(sceneName);
      let items = await this.getSceneItemListCached(sceneName);
      const aliases = this.getSourceAliases(sourceName);
      let item = items.find((entry) => entry.sourceName === sourceName || aliases.includes(entry.sourceName));
      if (!item) {
        if (sceneName === PRESENTATION_SCENE_NAME || sceneName === DOCK_PRESENTATION_SCENE) {
          // The ticker is only created by starting it in the Ministry tab.
          if (!isMediaNativeManagedSource(sourceName) && isMcePresentationManagedSource(sourceName) && !isMceTickerSourceName(sourceName)) {
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, true).catch(() => { });
            this.invalidateSceneItemListCache(sceneName);
            items = await this.getSceneItemListCached(sceneName);
            item = items.find((entry) => entry.sourceName === sourceName || aliases.includes(entry.sourceName));
          }
        }
      }
      if (!item) return false;

      const tickerItem = items.find((entry) => isMceTickerSourceName(entry.sourceName));
      const topIndex = Math.max(0, items.length - 1);
      let changed = false;

      if (item.sceneItemEnabled === false) {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true,
        }).catch(() => { });
        changed = true;
      }

      if (tickerItem && tickerItem.sceneItemId !== item.sceneItemId) {
        if (tickerItem.sceneItemIndex !== topIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId: tickerItem.sceneItemId,
            sceneItemIndex: topIndex,
          }).catch(() => { });
          changed = true;
        }
        const targetIndex = Math.max(0, topIndex - 1);
        if (item.sceneItemIndex !== targetIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemIndex: targetIndex,
          }).catch(() => { });
          changed = true;
        }
      } else if (item.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemIndex: topIndex,
        }).catch(() => { });
        changed = true;
      }

      if (changed) this.invalidateSceneItemListCache(sceneName);
      return true;
    } catch {
      return false;
    }
  }

  private async bringMceOverlayForward(sourceName: string): Promise<boolean> {
    let moved = false;
    for (const sceneName of await this.getLikelyOverlayScenes()) {
      moved = (await this.bringExistingSourceForward(sceneName, sourceName)) || moved;
    }
    return moved;
  }

  async bringBibleOverlayForward(_mode: DockOverlayMode = "fullscreen"): Promise<void> {
    await this.bringMceOverlayForward(this._fullscreenSceneDefs["bible"].browserSourceName);
  }

  async bringWorshipOverlayForward(_mode: DockOverlayMode = "lower-third"): Promise<void> {
    await this.bringMceOverlayForward(getDockResources().worshipSource);
  }

  private async prepareFastOverlayScene(
    tabId: DockPreviewTab,
    sourceName: string,
    fitSource: (sceneName: string) => Promise<void>,
  ): Promise<void> {
    const key = `${tabId}:${sourceName}`;
    const now = Date.now();
    if (this._lastFastOverlayPrepAtBySource[key]) {
      return;
    }

    // The browser document is already live. Re-promoting or refitting the OBS
    // scene for every verse can briefly redraw the scene and expose the
    // underlying frame. Prepare the route once, then update only the packet.
    this._lastFastOverlayPrepAtBySource[key] = now;

    const target = await this.getPresentationTargetScene(tabId, { activate: false }).catch(() => null);
    if (target?.sceneName) {
      await fitSource(target.sceneName).catch(() => { });
      await this.ensureTickerAboveSource(target.sceneName, sourceName, { leaveVisibility: true }).catch(() => { });
    }
    await fitSource(PRESENTATION_SCENE_NAME).catch(() => { });
    await this.ensureTickerAboveSource(PRESENTATION_SCENE_NAME, sourceName, { leaveVisibility: true }).catch(() => { });
  }

  private sceneItemKey(sceneName: string, sceneItemId: number): string {
    return `${sceneName}::${sceneItemId}`;
  }

  private async getTickerClearancePx(
    sceneName: string,
    items: Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled?: boolean }>,
  ): Promise<number> {
    const tickerItem = items.find(
      (item) => isMceTickerSourceName(item.sourceName) && item.sceneItemEnabled !== false,
    );
    if (!tickerItem) return 0;

    let tickerHeight = DOCK_TICKER_CLEARANCE_FALLBACK_PX;
    let tickerY: number | null = null;

    try {
      const response = await this.call("GetSceneItemTransform", {
        sceneName,
        sceneItemId: tickerItem.sceneItemId,
      }) as { sceneItemTransform?: Record<string, unknown> };
      const transform = response.sceneItemTransform ?? {};
      const boundsHeight = Number(transform.boundsHeight);
      const sourceHeight = Number(transform.sourceHeight);
      const scaleY = Number(transform.scaleY);
      const positionY = Number(transform.positionY);

      if (Number.isFinite(positionY)) {
        tickerY = positionY;
      }
      if (Number.isFinite(boundsHeight) && boundsHeight > 0) {
        tickerHeight = boundsHeight;
      } else if (Number.isFinite(sourceHeight) && sourceHeight > 0) {
        tickerHeight = sourceHeight * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
      }
    } catch {
      // Fall back to the known dock ticker height.
    }

    // A top ticker does not collide with lower thirds.
    if (tickerY !== null && tickerY <= 4) return 0;

    return Math.max(
      0,
      Math.min(
        DOCK_TICKER_CLEARANCE_MAX_PX,
        Math.round(tickerHeight + DOCK_TICKER_CLEARANCE_GAP_PX),
      ),
    );
  }

  async syncLowerThirdTickerClearance(sceneName = DOCK_PRESENTATION_SCENE): Promise<void> {
    try {
      this.invalidateSceneItemListCache(sceneName);
      const items = await this.getSceneItemListCached(sceneName);
      const ltItems = items.filter((item) => item.sourceName === DOCK_LT_SOURCE);
      if (ltItems.length === 0) return;

      const liveKeys = new Set(ltItems.map((item) => this.sceneItemKey(sceneName, item.sceneItemId)));
      for (const key of this._ltBasePosYBySceneItem.keys()) {
        if (key.startsWith(`${sceneName}::`) && !liveKeys.has(key)) {
          this._ltBasePosYBySceneItem.delete(key);
        }
      }

      const clearancePx = await this.getTickerClearancePx(sceneName, items);

      for (const item of ltItems) {
        let currentY = 0;
        try {
          const response = await this.call("GetSceneItemTransform", {
            sceneName,
            sceneItemId: item.sceneItemId,
          }) as { sceneItemTransform?: Record<string, unknown> };
          const transform = response.sceneItemTransform ?? {};
          const positionY = Number(transform.positionY);
          if (Number.isFinite(positionY)) currentY = positionY;
        } catch {
          // Keep fallback.
        }

        const key = this.sceneItemKey(sceneName, item.sceneItemId);
        if (!this._ltBasePosYBySceneItem.has(key)) {
          let inferredBaseY = currentY;
          if (clearancePx > 0 && Math.abs(currentY + clearancePx) <= 2) {
            inferredBaseY = currentY + clearancePx;
          } else if (clearancePx === 0 && currentY < -10) {
            inferredBaseY = 0;
          }
          this._ltBasePosYBySceneItem.set(key, inferredBaseY);
        }

        const baseY = this._ltBasePosYBySceneItem.get(key) ?? 0;
        const targetY = baseY - clearancePx;
        if (Math.abs(currentY - targetY) > 0.5) {
          await this.call("SetSceneItemTransform", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemTransform: {
              positionY: targetY,
            },
          }).catch(() => { });
        }
      }
    } catch {
      // Best-effort layout correction only.
    }
  }

  private async ensureActiveMceOverlaySource(
    sceneName: string,
    primarySourceName: string,
    keepSources: string[] = [],
    _resources: DockResourceNames = DOCK_RESOURCES,
    force = false,
  ): Promise<void> {
    const primary = primarySourceName.trim();
    const targetScene = sceneName.trim();
    if (!targetScene || !primary) return;
    const projectionSettings = loadProjectionSettings();
    // A Bible / Worship / Notes source that is showing in lower-third mode is a
    // lower third too: it follows the lower-third rule (sit on top, hide nothing
    // by default) instead of the "active-only" rule used for full-screen content.
    const isLowerThirdSource = isMceLowerThirdSourceName(primary)
      || this.isMceSourceInLowerThirdMode(primary);
    // A lower third is an overlay by default: it sits on top of whatever is on
    // screen (slides, lyrics, ticker, media) and only swaps out other lower
    // thirds. The operator can choose to hide everything else instead
    // ("active-only"). Regular Bible/Worship/Notes/Media visibility has its own
    // setting (presentationSourceVisibility).
    const lowerThirdOverlay = isLowerThirdSource
      && projectionSettings.lowerThirdSourceVisibility !== "active-only";
    const shouldIsolateSources = isLowerThirdSource
      ? true
      : projectionSettings.presentationSourceVisibility === "active-only";
    const stateSignature = JSON.stringify({
      primary,
      targetScene,
      keep: keepSources.filter(Boolean).sort(),
      shouldIsolateSources,
      lowerThirdMode: isLowerThirdSource,
      presentationSourceVisibility: projectionSettings.presentationSourceVisibility,
      lowerThirdSourceVisibility: projectionSettings.lowerThirdSourceVisibility,
    });

    // Fast path: if this overlay configuration was already applied and no OBS event invalidated it,
    // skip all OBS queries and mutation calls for ultra-low latency (<2ms) and 0% CPU overhead.
    if (!force && this._activeMceOverlayStateByScene[targetScene] === stateSignature) return;

    this.invalidateSceneItemListCache(targetScene);
    if (targetScene !== PRESENTATION_SCENE_NAME) {
      this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);
    }

    // Clean up legacy alias scene items so duplicate sources (e.g. MCE Worship alongside MCE Browser - Worship) never appear in OBS.
    // This is a dozen sequential OBS requests, so run it once per scene per OBS
    // connection instead of on every projection (it delayed showing the source).
    const legacyCleanupKey = `${primary}|${targetScene}`;
    const runLegacyCleanup = !this._legacyAliasCleanupDone.has(legacyCleanupKey);
    this._legacyAliasCleanupDone.add(legacyCleanupKey);
    if (!runLegacyCleanup) {
      // already cleaned for this connection
    } else if (primary === FULLSCREEN_SOURCE_NAMES.WORSHIP) {
      await this.removeSceneItemBySource(targetScene, "MCE Worship").catch(() => { });
      await this.removeSceneItemBySource(targetScene, "MCE Worship BG").catch(() => { });
      if (targetScene !== PRESENTATION_SCENE_NAME) {
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Worship").catch(() => { });
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Worship BG").catch(() => { });
      }
      // Worship and Notes share this one source now (Notes used to have its own).
      await this.removeLegacySeparateNotesSources(targetScene).catch(() => { });
    } else if (primary === FULLSCREEN_SOURCE_NAMES.BIBLE || primary === SOURCE_NAMES.BIBLE) {
      await this.removeSceneItemBySource(targetScene, "MCE Browser - Bible").catch(() => { });
      await this.removeSceneItemBySource(targetScene, "MCE BG - Bible").catch(() => { });
      await this.removeSceneItemBySource(targetScene, "MCE Bible").catch(() => { });
      await this.removeSceneItemBySource(targetScene, "MCE Bible BG").catch(() => { });
      if (targetScene !== PRESENTATION_SCENE_NAME) {
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Browser - Bible").catch(() => { });
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE BG - Bible").catch(() => { });
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Bible").catch(() => { });
        await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Bible BG").catch(() => { });
      }
      await this.removeInputIfExists("MCE Browser - Bible").catch(() => { });
      await this.removeInputIfExists("MCE BG - Bible").catch(() => { });
    }

    const targetItems = await this.getSceneItemListCached(targetScene);
    const presentationItems = targetScene === PRESENTATION_SCENE_NAME
      ? targetItems
      : await this.getSceneItemListCached(PRESENTATION_SCENE_NAME);

    const isLegacyBibleName = (name: string) =>
      name === "MCE Browser - Bible" || name === "MCE BG - Bible" || name === "MCE Bible" || name === "MCE Bible BG";
    const primaryFamily = getMcePresentationSourceFamily(primary);
    const primaryTargetItem = targetItems.find((i) => i.sourceName === primary)
      ?? (primaryFamily ? targetItems.find((i) => getMcePresentationSourceFamily(i.sourceName) === primaryFamily && !isLegacyBibleName(i.sourceName)) : undefined);
    const primaryPresItem = presentationItems.find((i) => i.sourceName === primary)
      ?? (primaryFamily ? presentationItems.find((i) => getMcePresentationSourceFamily(i.sourceName) === primaryFamily && !isLegacyBibleName(i.sourceName)) : undefined);

    // If the primary source is missing from OBS, create it and ensure it is ready at the top.
    // Native media sources (Video, Image, Audio) are created natively on demand with their file paths
    // and must NOT be created as browser sources by ensureOverlaySource.
    if (!isMediaNativeManagedSource(primary)) {
      if (!primaryTargetItem && isMcePresentationManagedSource(primary)) {
        await this.ensureOverlaySource(targetScene, primary, undefined, undefined, true).catch(() => { });
      }
      if (targetScene !== PRESENTATION_SCENE_NAME && !primaryPresItem && isMcePresentationManagedSource(primary)) {
        await this.ensureOverlaySource(PRESENTATION_SCENE_NAME, primary, undefined, undefined, true).catch(() => { });
      }
    }

    const isPrimaryDisabled = (primaryTargetItem && primaryTargetItem.sceneItemEnabled === false)
      || (primaryPresItem && primaryPresItem.sceneItemEnabled === false);

    if (isPrimaryDisabled || !primaryTargetItem) {
      delete this._activeMceOverlayStateByScene[targetScene];
    }

    // Do not touch the scene-item order when only the verse/slide payload is
    // changing. Re-running SetSceneItemIndex for every Bible arrow press can
    // make OBS move the neighbouring source above the active source. A new
    // active source still falls through and gets ordered below the ticker.
    if (!force && this._activeMceOverlayStateByScene[targetScene] === stateSignature) return;

    // Stack the new source at the top while it is still hidden. The old code
    // also switched it on here, before the sources it replaces were hidden, so
    // the old and new content were on screen together (worst on first use,
    // when the calls between this point and the hide batch are slow).
    await this.ensureTickerAboveSource(targetScene, primary, { leaveVisibility: true }).catch(() => { });
    // Hides and shows are collected apart so the swap runs as one ordered step:
    // everything that must go off first, then the source that goes on.
    const hideRequests: Array<{ requestType: string; requestData: Record<string, unknown> }> = [];
    const showRequests: Array<{ requestType: string; requestData: Record<string, unknown> }> = [];
    const requestedRequestKeys = new Set<string>();
    const addVisibilityRequest = (
      requestScene: string,
      sceneItemId: number,
      sceneItemEnabled: boolean,
    ) => {
      const requestKey = `${requestScene}:${sceneItemId}:${sceneItemEnabled}`;
      if (requestedRequestKeys.has(requestKey)) return;
      requestedRequestKeys.add(requestKey);
      (sceneItemEnabled ? showRequests : hideRequests).push({
        requestType: "SetSceneItemEnabled",
        requestData: {
          sceneName: requestScene,
          sceneItemId,
          sceneItemEnabled,
        },
      });
    };

    // The selected active source must be enabled wherever the current push
    // uses it, including a routed target scene outside MCE Presentation.
    for (const item of targetItems) {
      if (item.sourceName === primary && item.sceneItemEnabled === false) {
        addVisibilityRequest(targetScene, item.sceneItemId, true);
      }
    }

    // Visibility is deliberately reconciled in MCE Presentation only. A
    // routed user scene may contain an MCE source for that route, but it must
    // not become the place where this global presentation preference hides
    // unrelated content.
    const keepSet = getMcePresentationVisibilityKeepSet(
      primary,
      presentationItems,
      isLowerThirdSource ? projectionSettings.lowerThirdSourceVisibility : "active-only",
      projectionSettings.preserveAudioOnSourceSwitch !== false,
    );
    for (const item of presentationItems) {
      if (!isMcePresentationManagedSource(item.sourceName)) continue;
      // The ticker is switched on and off only from the Ministry tab: a verse, song or
      // media going live never hides it (it popped back in later) or shows a stopped one.
      if (isMceTickerSourceName(item.sourceName) && item.sourceName !== primary) continue;

      const shouldKeep = keepSet.has(item.sourceName);
      if (lowerThirdOverlay) {
        // Turn on this lower third, swap out any other lower third, and leave
        // everything else exactly as it is (never re-show what the operator hid).
        if (item.sourceName === primary) {
          if (item.sceneItemEnabled !== true) {
            addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, true);
          }
          this._mcePresentationSourcesDisabledByVisibility.delete(item.sourceName);
        } else if (this._ltPerTabSources && isMinistryLtTabSource(primary) && isMinistryLtTabSource(item.sourceName)) {
          // A source for each Ministry tab: the other tabs' lower thirds stay as they are.
        } else if (!shouldKeep && item.sceneItemEnabled !== false) {
          addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, false);
          this._mcePresentationSourcesDisabledByVisibility.add(item.sourceName);
        }
        continue;
      }
      if (shouldIsolateSources) {
        if (shouldKeep) {
          // A lower third sits on top of whatever is showing: it turns on only its
          // own source and never re-shows sources the operator hid in OBS.
          const mayEnable = !isLowerThirdSource
            || item.sourceName === primary
            || this._mcePresentationSourcesDisabledByVisibility.has(item.sourceName);
          if (item.sceneItemEnabled !== true && mayEnable) {
            addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, true);
          }
          this._mcePresentationSourcesDisabledByVisibility.delete(item.sourceName);
        } else {
          if (item.sceneItemEnabled !== false) {
            addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, false);
            this._mcePresentationSourcesDisabledByVisibility.add(item.sourceName);
          }
        }
      } else {
        // When the operator changes back to "keep visible", restore only the
        // sources that this preference itself hid; do not override a manual OBS
        // disable. The active source is always re-enabled for the new push.
        const shouldRestore = item.sourceName === primary
          || this._mcePresentationSourcesDisabledByVisibility.has(item.sourceName);
        if (shouldRestore && item.sceneItemEnabled === false) {
          addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, true);
        }
        if (this._mcePresentationSourcesDisabledByVisibility.has(item.sourceName)) {
          this._mcePresentationSourcesDisabledByVisibility.delete(item.sourceName);
        }
      }
    }

    const requests = [...hideRequests, ...showRequests];
    if (requests.length > 0) {
      // Serial-frame batch: OBS applies every request in order inside a single
      // graphics frame, so the hides land before the show and no frame ever has
      // both the old and the new source on. (The old parallel batch did not
      // order them, and could leave the old source up for a moment.)
      await this.callBatch(requests, 1).catch(() => this.callBatch(requests, 0)).catch(() => { });
      this.invalidateSceneItemListCache(targetScene);
      if (targetScene !== PRESENTATION_SCENE_NAME) {
        this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);
      }
    }

    // Visibility and scene-source mutations from neighboring dock actions can
    // leave the active source lower in the stack than expected. Re-apply the
    // source ordering after the batch so the live dock source stays at the top
    // of the dock-managed stack, just beneath the ticker when it exists.
    await this.ensureTickerAboveSource(targetScene, primary).catch(() => { });

    this._activeMceOverlayStateByScene[targetScene] = stateSignature;
    this._lastActivePresentationSource = primary;
    this._lastActivePresentationLowerThirdMode = isLowerThirdSource;
  }

  /** Apply the operator's MCE-only visibility preference to MCE Presentation. */
  async applyMcePresentationSourceVisibility(primarySourceName: string, force = false): Promise<void> {
    const primary = primarySourceName.trim();
    if (!isMcePresentationManagedSource(primary)) return;
    await this.ensureActiveMceOverlaySource(
      PRESENTATION_SCENE_NAME,
      primary,
      [primary],
      DOCK_RESOURCES,
      force,
    );
  }

  /**
   * Focus the shared MCE Presentation family directly from a dock action.
   *
   * This is intentionally called by the card/live handlers instead of a
   * React effect. The OBS request is still asynchronous at the transport
   * boundary, but the visibility decision starts in the same click event.
   */
  async focusMcePresentationModule(
    module: DockPresentationModule,
    specificSourceName?: string,
    force = false,
  ): Promise<void> {
    if (!this.isConnected) return;
    const targetSource = specificSourceName && isMcePresentationManagedSource(specificSourceName)
      ? specificSourceName
      : MCE_PRESENTATION_FOCUS_SOURCES[module];

    // Ensure MCE Presentation scene exists before focusing module
    await this.ensurePresentationSceneReady().catch(() => { });

    // Fast path: if this source is already the active presentation source,
    // return immediately in 0ms without queuing or OBS calls unless forced.
    if (
      !force
      && this._lastActivePresentationSource === targetSource
      && this._lastActivePresentationLowerThirdMode === (
        isMceLowerThirdSourceName(targetSource) || this.isMceSourceInLowerThirdMode(targetSource)
      )
    ) {
      writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, module);
      return;
    }

    if (force) {
      this.invalidateActiveMceOverlayState();
      this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);
    }

    await this.runSerializedPresentationMutation(() => (
      this.applyMcePresentationSourceVisibility(targetSource, force)
    ));
    // The Dock page can refresh while OBS keeps the live MCE Presentation
    // source. Remember its selected module locally so the next Bible click
    // updates that source in place instead of briefly disabling it first.
    writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, module);
  }

  /**
   * Verify and ensure the presentation source for the given module is:
   * 1. Present and open / enabled (`sceneItemEnabled: true`)
   * 2. Stacked at the top of the scene (right below ticker if ticker exists)
   * 3. Conflicting full-screen sources (e.g. Image/Video) reconciled
   *
   * Called immediately on operator actions (e.g. clicking Bible version/verse,
   * Worship song/slide, or Note/slide).
   */
  async ensureModuleSourceOpenAndOnTop(
    module: "bible" | "worship" | "notes",
    /** Layout the click is about to project in (a lower third must not hide the other sources). */
    intendedMode?: "fullscreen" | "lower-third",
  ): Promise<void> {
    if (!this.isConnected) return;

    const sourceNameMap: Record<"bible" | "worship" | "notes", string> = {
      bible: FULLSCREEN_SOURCE_NAMES.BIBLE,
      worship: FULLSCREEN_SOURCE_NAMES.WORSHIP,
      notes: FULLSCREEN_SOURCE_NAMES.NOTES,
    };
    const targetSource = sourceNameMap[module];
    if (!targetSource) return;
    this.noteIntendedMceMode(targetSource, intendedMode);
    this.noteIntendedMceMode(this._fullscreenSceneDefs[module]?.browserSourceName, intendedMode);

    // Fast-path: if this source is already the active presentation source and verified stacked recently,
    // return immediately in 0ms without redundant OBS calls or redraw flickers.
    const presentationKey = `${PRESENTATION_SCENE_NAME}::${targetSource}`;
    const lastStacked = this._lastVerifiedStackedBySceneSource[presentationKey];
    if (this._lastActivePresentationSource === targetSource && lastStacked && Date.now() - lastStacked < 15000) {
      writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, module);
      return;
    }

    // Ensure MCE Presentation scene exists before inspecting scenes or stacking
    const revealRequestedAt = Date.now();
    await this.ensurePresentationSceneReady().catch(() => { });

    // This source is about to be shown again (another module was on air, or
    // it was cleared). It still holds its previous verse/slide, so let the
    // click's own packet (primed in parallel by the tab) land first. Capped so
    // a click that sends nothing is never held up for long.
    if (this._lastActivePresentationSource !== targetSource) {
      const packetSource = this._fullscreenSceneDefs[module]?.browserSourceName ?? targetSource;
      // The first projection after a Dock (re)load, or after the Bible output
      // mode changed, does one-time OBS setup before its packet is sent. A short
      // wait showed the source early with an old or default layout (Bible: full
      // screen before the lower third). Keep the current output on screen and
      // wait for that setup instead; later clicks keep the short wait.
      const coldStart = this._lastPacketDeliveredAtBySource[packetSource] === undefined
        || (module === "bible" && !this._bibleLtInitialized);
      await this.waitForFreshSourcePacket(packetSource, revealRequestedAt - 150, coldStart ? 3000 : 450);
      // OBS acknowledges the event before CEF paints; give it one frame.
      await this.sleep(40);
    }

    // Focus presentation module without wiping caches or forcing resets
    await this.focusMcePresentationModule(module, targetSource, false).catch(() => { });

    const likelyScenes = await this.getLikelyOverlayScenes();

    // Verify and stack target source in likely scenes without wiping unrelated caches
    for (const sceneName of likelyScenes) {
      await this.ensureSceneItemVisibleAndStacked(sceneName, targetSource, false).catch(() => { });
    }

    writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, module);
  }

  /**
   * Reconcile MCE Presentation source visibility immediately based on the
   * current active presentation source and user settings.
   */
  async reconcileMcePresentationVisibility(): Promise<void> {
    if (!this.isConnected) return;
    this.invalidateActiveMceOverlayState(PRESENTATION_SCENE_NAME);
    this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);

    const activeSource = this._lastActivePresentationSource
      || this.getActivePresentationSourceFromStorage();
    if (activeSource && isMcePresentationManagedSource(activeSource)) {
      await this.applyMcePresentationSourceVisibility(activeSource);
      return;
    }

    const settings = loadProjectionSettings();
    const items = await this.getSceneItemListCached(PRESENTATION_SCENE_NAME).catch(() => []);

    if (settings.presentationSourceVisibility === "keep-visible") {
      const requests: Array<{ requestType: string; requestData: Record<string, unknown> }> = [];
      for (const item of items) {
        if (this._mcePresentationSourcesDisabledByVisibility.has(item.sourceName) && item.sceneItemEnabled === false) {
          requests.push({
            requestType: "SetSceneItemEnabled",
            requestData: {
              sceneName: PRESENTATION_SCENE_NAME,
              sceneItemId: item.sceneItemId,
              sceneItemEnabled: true,
            },
          });
        }
      }
      this._mcePresentationSourcesDisabledByVisibility.clear();
      if (requests.length > 0) {
        await this.callBatch(requests, 2).catch(() => { });
        this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);
      }
      return;
    }

    // If in active-only mode without a known activeSource, find the highest enabled MCE content source
    const enabledMceItems = items.filter(
      (item) => isMcePresentationManagedSource(item.sourceName) && item.sceneItemEnabled !== false
    );
    if (enabledMceItems.length > 0) {
      const topItem = enabledMceItems.reduce((highest, current) => {
        const hIdx = highest.sceneItemIndex ?? 0;
        const cIdx = current.sceneItemIndex ?? 0;
        return cIdx > hIdx ? current : highest;
      }, enabledMceItems[0]);
      await this.applyMcePresentationSourceVisibility(topItem.sourceName);
    }
  }

  private getActivePresentationSourceFromStorage(): string | null {
    const activeModule = readNativeDockSetting<DockPresentationModule>(MCE_PRESENTATION_ACTIVE_MODULE_KEY);
    if (activeModule && MCE_PRESENTATION_FOCUS_SOURCES[activeModule]) {
      return MCE_PRESENTATION_FOCUS_SOURCES[activeModule];
    }
    return null;
  }

  private invalidateActiveMceOverlayState(sceneName?: string): void {
    if (sceneName) {
      delete this._activeMceOverlayStateByScene[sceneName];
      return;
    }
    this._activeMceOverlayStateByScene = {};
  }

  private async setMediaSceneItemScale(
    sceneName: string,
    sceneItemId: number,
    canvas: { width: number; height: number },
    scale: number
  ): Promise<void> {
    const boundsWidth = canvas.width * scale;
    const boundsHeight = canvas.height * scale;
    const positionX = (canvas.width - boundsWidth) / 2;
    const positionY = (canvas.height - boundsHeight) / 2;

    await this.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX,
        positionY,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth,
        boundsHeight,
        boundsAlignment: 0,
        cropLeft: 0,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
      },
    });
  }

  private async transformSceneItem(
    sceneName: string,
    sceneItemId: number,
    positionX: number,
    positionY: number,
    boundsWidth: number,
    boundsHeight: number,
  ): Promise<void> {
    await this.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX,
        positionY,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth,
        boundsHeight,
        boundsAlignment: 0,
        cropLeft: 0,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
      },
    });
  }

  private async animateMediaSceneItem(
    sceneName: string,
    sceneItemId: number,
    direction: "in" | "out"
  ): Promise<void> {
    if (direction === "in") {
      await this.fitSceneItemToCanvas(sceneName, sceneItemId);
    }
  }

  /**
   * Disable every visible scene item in `sceneName` immediately.
   * Multiview clear should be instant and low-CPU, not a filter animation.
   */
  async fadeOutAllSceneItems(sceneName: string, _durationMs = 0): Promise<void> {
    let items: Array<{ sceneItemId: number; sourceName: string; sceneItemEnabled: boolean }> = [];
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sceneItemId: number; sourceName: string; sceneItemEnabled: boolean }>;
      };
      items = (resp.sceneItems ?? []).filter((i) => i.sceneItemEnabled);
    } catch { /* scene may not exist */ }

    if (items.length === 0) return;

    await Promise.all(items.map(async (item) => {
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
      } catch { /* ignore */ }
    }));
  }

  private async hideMediaSourceWithAnimation(sceneName: string, sourceName: string): Promise<void> {
    const item = await this.getSceneItemBySource(sceneName, sourceName);
    if (!item || !item.sceneItemEnabled) return;

    try {
      await this.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: false,
      });
    } catch {
      // Ignore disable failures during clear/handover.
    }
  }

  // ── Scene helpers ──

  private rememberUserScene(sceneName: string, tabId?: DockPreviewTab): void {
    if (!sceneName || sceneName === DOCK_PRESENTATION_SCENE) return;
    const key = tabId || "__global__";
    // A second send can run after MCE Presentation is already Program. Keep
    // the first real scene so clearing the overlay still returns to the scene
    // that was live before the whole presentation session started.
    if (!this._programSceneBeforePush.has(key)) {
      this._programSceneBeforePush.set(key, sceneName);
    }
  }

  /** Get the Program scene that was active before content was pushed for a tab */
  private getRememberedSceneBeforePush(tabId?: DockPreviewTab): string {
    const key = tabId || "__global__";
    return this._programSceneBeforePush.get(key) || "";
  }

  /** Clear the remembered scene after restore */
  private clearRememberedSceneBeforePush(tabId?: DockPreviewTab): void {
    const key = tabId || "__global__";
    this._programSceneBeforePush.delete(key);
  }

  /** Restore the Program scene to what it was before content was pushed */
  private async restoreProgramSceneBeforePush(tabId?: DockPreviewTab): Promise<boolean> {
    const remembered = this.getRememberedSceneBeforePush(tabId);
    if (!remembered) return false;
    if (!this.readRestoreOriginalScene()) {
      this.clearRememberedSceneBeforePush(tabId);
      return false;
    }

    // Overlay-only mode also cleans up any legacy direct Program insertion.
    if (this.readSceneMode() === "no-clone") {
      const currentScene = await this.getCurrentProgramSceneName().catch(() => "");
      if (currentScene) {
        await this.removeMCEPresentationFromScene(currentScene);
      }
    }

    const currentProgramScene = await this.getCurrentProgramSceneName(true).catch(() => "");
    if (currentProgramScene === remembered) {
      this.clearRememberedSceneBeforePush(tabId);
      return false; // already on the right scene
    }

    try {
      await this.call("SetCurrentProgramScene", { sceneName: remembered });
      await this.waitForSceneMatch("program", remembered);
      if (await this.isStudioModeEnabled()) {
        await this.setCurrentPreviewScene(remembered);
        await this.waitForSceneMatch("preview", remembered).catch(() => { });
      }
      await this.sleep(100);
      this.clearRememberedSceneBeforePush(tabId);
      return true;
    } catch (err) {
      console.warn(`[DockOBS] Failed to restore Program scene to "${remembered}":`, err);
      return false;
    }
  }

  async ensurePresentationPreviewActive(tabId?: DockPreviewTab): Promise<boolean> {
    if (!this.isConnected) return false;

    await this.waitUntilReady().catch(() => { });

    const studioMode = await this.isStudioModeEnabled(true).catch(() => false);
    if (!studioMode) return false;

    await this.ensurePresentationSceneReady().catch(() => { });

    const currentProgramScene = await this.getCurrentProgramSceneName().catch(() => "");
    if (currentProgramScene && currentProgramScene !== DOCK_PRESENTATION_SCENE) {
      this.rememberUserScene(currentProgramScene, tabId);
      if (this.readSceneMode() === "no-clone") {
        await this.ensureNoProgramSceneUnderlayInPresentation().catch(() => { });
      } else {
        await this.ensureProgramSceneAsSourceInPresentation(true).catch(() => { });
      }
    }

    const currentPreviewScene = await this.getCurrentPreviewSceneName().catch(() => "");
    // If the preview is already MCE Presentation, nothing to do
    if (currentPreviewScene === DOCK_PRESENTATION_SCENE) return true;

    const originalPreviewScene = currentPreviewScene || currentProgramScene;
    if (originalPreviewScene && originalPreviewScene !== DOCK_PRESENTATION_SCENE) {
      if (tabId) {
        this.setPreviewSceneStateForTab(tabId, originalPreviewScene, DOCK_PRESENTATION_SCENE, "presentation");
      } else {
        this.setPreviewSceneState(originalPreviewScene, DOCK_PRESENTATION_SCENE, "presentation");
      }
    }

    const previewSet = await this.setCurrentPreviewScene(DOCK_PRESENTATION_SCENE);
    if (previewSet) {
      await this.waitForSceneMatch("preview", DOCK_PRESENTATION_SCENE).catch(() => { });
    }
    return previewSet;
  }

  /**
   * Make MCE Presentation visible after an explicit dock send.
   *
   * Studio Mode: put MCE Presentation in Preview only.
   * Non-Studio Mode: switch Program to MCE Presentation after the scene is
   * populated. Program-background-on places the previous Program scene below
   * the overlays; no-clone keeps MCE Presentation overlay-only.
   */
  private async promotePresentationScene(tabId?: DockPreviewTab): Promise<void> {
    if (await this.ensurePresentationPreviewActive(tabId).catch(() => false)) {
      return;
    }

    await this.ensurePresentationSceneReady();

    const currentProgramScene = await this.getCurrentProgramSceneName(true).catch(() => "");
    if (currentProgramScene && currentProgramScene !== DOCK_PRESENTATION_SCENE) {
      this.rememberUserScene(currentProgramScene, tabId);
    }

    if (currentProgramScene === DOCK_PRESENTATION_SCENE) return;

    if (this.readSceneMode() === "no-clone") {
      await this.ensureNoProgramSceneUnderlayInPresentation().catch(() => { });
      if (currentProgramScene) {
        await this.removeMCEPresentationFromScene(currentProgramScene).catch(() => { });
      }
    } else if (currentProgramScene) {
      await this.ensureProgramSceneAsSourceInPresentation(true, {
        allowWithoutStudioMode: true,
        programSceneName: currentProgramScene,
      }).catch(() => { });
    }

    await this.call("SetCurrentProgramScene", { sceneName: DOCK_PRESENTATION_SCENE });
    this._programSceneCache = null;
    await this.waitForSceneMatch("program", DOCK_PRESENTATION_SCENE).catch(() => { });
  }

  /**
   * Prepare the shared presentation output for a service-planner cue.
   *
   * OBS Studio Mode keeps the cue in Preview until the operator explicitly
   * takes it live. When Studio Mode is disabled, OBS has no separate Preview
   * surface, so the presentation is shown in Program immediately.
   */
  async preparePlannerOutput(
    tabId: DockPreviewTab = "bible",
    goLive = false,
  ): Promise<{ studioMode: boolean; outputMode: "preview" | "program" }> {
    const studioMode = await this.isStudioModeEnabled(true).catch(() => false);

    if (!studioMode) {
      await this.promotePresentationScene(tabId);
      return { studioMode: false, outputMode: "program" };
    }

    const previewReady = await this.ensurePresentationPreviewActive(tabId);
    if (!previewReady) {
      throw new Error("OBS Preview is not available. Enable Studio Mode and try again.");
    }

    if (goLive) {
      await this.call("TransitionToProgram");
      await this.waitForSceneMatch("program", DOCK_PRESENTATION_SCENE).catch(() => { });
    }

    return { studioMode: true, outputMode: goLive ? "program" : "preview" };
  }

  /**
   * Ensure the current Program scene exists as a source inside MCE Presentation,
   * positioned at the bottom of the z-order (behind all overlay sources).
   * This makes the live broadcast content visible behind overlays in Studio Mode,
   * where MCE Presentation is only placed in Preview.
   *
   * Non-Studio Mode can call this with an explicit pre-switch Program scene
   * when Program-background-on needs that scene under MCE Presentation.
   * Skips if the program scene IS MCE Presentation (circular reference).
   */
  private async ensureProgramSceneAsSourceInPresentation(
    _force = false,
    options: { allowWithoutStudioMode?: boolean; programSceneName?: string } = {},
  ): Promise<void> {
    return this.runSerializedPresentationMutation(async () => {
      try {
        const studioMode = options.allowWithoutStudioMode
          ? true
          : await this.isStudioModeEnabled().catch(() => false);
        if (!studioMode) return;

        if (this.readSceneMode() === "no-clone") {
          await this.ensureNoProgramSceneUnderlayInPresentation(_force);
          return;
        }

        const programScene = (options.programSceneName || await this.getCurrentProgramSceneName(true).catch(() => "")).trim();
        if (!programScene) {
          this._presentationProgramUnderlayCache = null;
          return;
        }

        if (programScene === DOCK_PRESENTATION_SCENE) {
          // MCE Presentation can become Program after a studio transition. In
          // that state the existing nested scene is still the intended live
          // background, so do not run the stale-underlay cleanup here.
          return;
        }

        if (DockObsClient.isManagedMultiviewSceneName(programScene)) {
          // Multiview scenes are themselves composed outputs. Do not replace
          // the presentation's last background scene with a Multiview scene,
          // and do not empty the presentation while a Multiview scene is live.
          return;
        }

        const cached = this._presentationProgramUnderlayCache;
        if (!_force && cached?.programScene === programScene && cached.expiresAt > Date.now()) {
          return;
        }

        const programContainsPresentation = await this.sceneContainsSource(programScene, DOCK_PRESENTATION_SCENE);
        if (programContainsPresentation) {
          console.warn(
            `[DockOBS] Removing stale "${DOCK_PRESENTATION_SCENE}" source from "${programScene}" before rebuilding presentation.`,
          );
          await this.removeMCEPresentationFromScene(programScene).catch(() => { });
          await this.sleep(120);
        }

        const presentationScene = DOCK_PRESENTATION_SCENE;
        await this.ensurePresentationSceneReady();
        await this.removeProgramSceneUnderlaysFromPresentation(programScene);

        const existing = await this.collapseDuplicateSceneItems(presentationScene, programScene);

        if (existing) {
          // Already present — just ensure it's at the bottom (behind overlays)
          if (existing.sceneItemIndex !== 0) {
            await this.call("SetSceneItemIndex", {
              sceneName: presentationScene,
              sceneItemId: existing.sceneItemId,
              sceneItemIndex: 0,
            }).catch(() => { });
          }
          if (existing.sceneItemEnabled === false) {
            await this.call("SetSceneItemEnabled", {
              sceneName: presentationScene,
              sceneItemId: existing.sceneItemId,
              sceneItemEnabled: true,
            }).catch(() => { });
          }
          this._presentationProgramUnderlayCache = { programScene, expiresAt: Date.now() + 3000 };
          return;
        }

        // Add program scene as a source to MCE Presentation
        const created = await this.call("CreateSceneItem", {
          sceneName: presentationScene,
          sourceName: programScene,
          sceneItemEnabled: true,
        }) as { sceneItemId: number };
        this.rememberProgramBackgroundManagedScene(programScene);
        this.invalidateSceneItemListCache(presentationScene);

        await this.sleep(120);
        const stableItem = await this.collapseDuplicateSceneItems(presentationScene, programScene);
        const sceneItemId = stableItem?.sceneItemId ?? created.sceneItemId;

        // Fit to canvas
        await this.fitSceneItemToCanvas(presentationScene, sceneItemId);

        // Move to bottom of z-order (index 0 = behind all overlay sources)
        await this.call("SetSceneItemIndex", {
          sceneName: presentationScene,
          sceneItemId,
          sceneItemIndex: 0,
        }).catch(() => { });
        this._presentationProgramUnderlayCache = { programScene, expiresAt: Date.now() + 3000 };

      } catch (err) {
        console.warn("[DockOBS] Failed to add program scene as source in presentation:", err);
      }
    });
  }

  private async removeProgramSceneUnderlaysFromPresentation(keepSceneName?: string): Promise<void> {
    try {
      await this.ensurePresentationSceneReady();
      const managedScenes = this.getProgramBackgroundManagedScenes();
      if (managedScenes.size === 0) return;

      this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
      const items = await this.getSceneItemListCached(DOCK_PRESENTATION_SCENE);
      let removed = false;
      for (const item of items) {
        // Do not infer ownership from the fact that a source happens to be a
        // scene. User-created nested scenes are valid sources and must remain
        // untouched. Ownership comes only from the native MCE tracking list.
        if (!managedScenes.has(item.sourceName)) continue;
        if (keepSceneName && item.sourceName === keepSceneName) continue;
        try {
          await this.call("RemoveSceneItem", {
            sceneName: DOCK_PRESENTATION_SCENE,
            sceneItemId: item.sceneItemId,
          });
          this.forgetProgramBackgroundManagedScene(item.sourceName);
          removed = true;
        } catch {
          // Keep the native ownership record so a later watcher pass can
          // retry the cleanup after OBS finishes its scene mutation.
        }
      }
      if (removed) {
        this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
      }
      if (removed || !keepSceneName) {
        this._presentationProgramUnderlayCache = null;
      }
    } catch (err) {
      console.warn("[DockOBS] Failed to remove Program scene underlay from MCE Presentation:", err);
    }
  }

  private async ensureNoProgramSceneUnderlayInPresentation(force = false): Promise<void> {
    const currentProgramScene = await this.getCurrentProgramSceneName(true).catch(() => "");
    if (DockObsClient.isManagedMultiviewSceneName(currentProgramScene)) {
      // A Multiview scene can be the live OBS output while MCE Presentation
      // remains the presentation layer. Preserve its last added underlay.
      return;
    }

    const cached = this._presentationProgramUnderlayCache;
    if (
      !force &&
      cached?.programScene === DockObsClient.NO_CLONE_UNDERLAY_CACHE_KEY &&
      cached.expiresAt > Date.now()
    ) {
      return;
    }

    await this.removeProgramSceneUnderlaysFromPresentation();
    this._presentationProgramUnderlayCache = {
      programScene: DockObsClient.NO_CLONE_UNDERLAY_CACHE_KEY,
      expiresAt: Date.now() + 3000,
    };
  }

  private async sceneContainsSource(sceneName: string, sourceName: string): Promise<boolean> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string }>;
      };
      return resp.sceneItems.some((item) => item.sourceName === sourceName);
    } catch {
      return false;
    }
  }

  private async collapseDuplicateSceneItems(
    sceneName: string,
    sourceName: string,
  ): Promise<{ sceneItemId: number; sceneItemIndex?: number; sceneItemEnabled?: boolean } | null> {
    this.invalidateSceneItemListCache(sceneName);
    let items = await this.getSceneItemListCached(sceneName);
    let matches = items
      .filter((item) => item.sourceName === sourceName)
      .sort((a, b) => a.sceneItemId - b.sceneItemId);

    if (matches.length === 0) return null;

    const duplicates = matches.slice(1);
    if (duplicates.length > 0) {
      // A user may have intentionally added the same scene more than once.
      // Only collapse duplicates when the source is an MCE-owned source or a
      // Program underlay that this Dock created and persisted.
      const canRemoveDuplicates =
        isMcePresentationManagedSource(sourceName) ||
        this.getProgramBackgroundManagedScenes().has(sourceName);
      if (!canRemoveDuplicates) return matches[0] ?? null;

      for (const item of duplicates) {
        await this.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: item.sceneItemId,
        }).catch(() => { });
      }
      await this.sleep(80);
      this.invalidateSceneItemListCache(sceneName);
      items = await this.getSceneItemListCached(sceneName);
      matches = items
        .filter((item) => item.sourceName === sourceName)
        .sort((a, b) => a.sceneItemId - b.sceneItemId);
    }

    return matches[0] ?? null;
  }

  /**
   * Remove MCE Presentation as a Scene Source from the given scene.
   * Used by routing cleanup when an older mode embedded the managed
   * presentation scene inside the user's Program scene.
   */
  private async removeMCEPresentationFromScene(sceneName: string): Promise<void> {
    try {
      if (!sceneName || sceneName === DOCK_PRESENTATION_SCENE) return;
      if (DockObsClient.isManagedMultiviewSceneName(sceneName)) return;

      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const presentationItem = resp.sceneItems.find((i) => i.sourceName === DOCK_PRESENTATION_SCENE);
      if (presentationItem) {
        await this.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: presentationItem.sceneItemId,
        }).catch(() => { });
      }
    } catch (err) {
      console.warn("[DockOBS] Failed to remove MCE Presentation from scene:", err);
    }
  }

  private loadPreviewSceneState(): DockPreviewSceneState | null {
    try {
      const raw = localStorage.getItem(DOCK_PREVIEW_SCENE_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DockPreviewSceneState>;
      const previewSceneName = String(parsed.previewSceneName || "").trim();
      const originalSceneName = String(parsed.originalSceneName || "").trim();
      const overlayType = String(parsed.overlayType || "").trim();
      if (!previewSceneName || !originalSceneName) return null;
      return {
        previewSceneName,
        originalSceneName,
        overlayType,
        createdAt: Number(parsed.createdAt) || Date.now(),
        updatedAt: Number(parsed.updatedAt) || Date.now(),
      };
    } catch {
      return null;
    }
  }

  private savePreviewSceneState(state: DockPreviewSceneState | null): void {
    this._previewSceneState = state;
    try {
      if (!state) {
        localStorage.removeItem(DOCK_PREVIEW_SCENE_STATE_KEY);
        return;
      }
      localStorage.setItem(DOCK_PREVIEW_SCENE_STATE_KEY, JSON.stringify(state));
    } catch {
      // localStorage can be unavailable in some OBS browser contexts.
    }
  }

  async applyProjectionSettings(options: { allowSceneMutation?: boolean } = {}): Promise<void> {
    if (!options.allowSceneMutation || isFreeDockPlan()) return;

    await this.ensurePresentationSceneReady().catch(() => { });

    const currentProgramScene = await this.getCurrentProgramSceneName(true).catch(() => "");

    if (this.readSceneMode() === "no-clone") {
      if (currentProgramScene && currentProgramScene !== DOCK_PRESENTATION_SCENE) {
        await this.removeMCEPresentationFromScene(currentProgramScene).catch(() => { });
      }
      await this.ensureNoProgramSceneUnderlayInPresentation(true).catch(() => { });
    } else {
      const studioMode = await this.isStudioModeEnabled(true).catch(() => false);
      await this.ensureProgramSceneAsSourceInPresentation(true, {
        allowWithoutStudioMode: !studioMode,
        programSceneName: currentProgramScene || undefined,
      }).catch(() => { });
    }

    // Keep watching after the setting is changed so a later OBS Program scene
    // switch is reconciled even when no MCE card is clicked.
    this.startProgramBackgroundWatcher();
    this.scheduleProgramBackgroundReconcile(undefined, true);

    const scenes = new Set<string>([DOCK_PRESENTATION_SCENE]);
    if (currentProgramScene) scenes.add(currentProgramScene);
    const currentPreviewScene = await this.getCurrentPreviewSceneName().catch(() => "");
    if (currentPreviewScene) scenes.add(currentPreviewScene);

    for (const sceneName of scenes) {
      // Only the order: a ticker the operator cleared or hid stays off.
      await this.ensureTickerAboveSource(sceneName, DOCK_TICKER_SOURCE, { leaveVisibility: true }).catch(() => { });
    }
  }

  /** Get the fixed preview scene name for a tab. */
  private getTabPreviewSceneName(tabId: DockPreviewTab): string {
    return TAB_PREVIEW_SCENE_NAMES[tabId];
  }

  private getStoredPreviewSceneState(): DockPreviewSceneState | null {
    return this._previewSceneState ? { ...this._previewSceneState } : null;
  }

  /** Get the stored preview scene state for a specific tab */
  private getStoredPreviewSceneStateForTab(tabId: DockPreviewTab): DockPreviewSceneState | null {
    const state = this._previewSceneStates.get(tabId);
    return state ? { ...state } : null;
  }

  private clearPreviewSceneState(): void {
    this.savePreviewSceneState(null);
  }

  /** Clear the preview scene state for a specific tab */
  private clearPreviewSceneStateForTab(tabId: DockPreviewTab): void {
    this._previewSceneStates.delete(tabId);
    this.saveTabPreviewSceneStatesToStorage();
  }

  private setPreviewSceneStateForTab(
    tabId: DockPreviewTab,
    originalSceneName: string,
    previewSceneName: string,
    overlayType: string,
  ): void {
    const now = Date.now();
    const existing = this._previewSceneStates.get(tabId);
    const createdAt = existing?.previewSceneName === previewSceneName && existing?.originalSceneName === originalSceneName
      ? existing.createdAt
      : now;
    this._previewSceneStates.set(tabId, {
      previewSceneName,
      originalSceneName,
      overlayType,
      createdAt,
      updatedAt: now,
    });
    this.saveTabPreviewSceneStatesToStorage();
  }

  private setPreviewSceneState(originalSceneName: string, previewSceneName: string, overlayType: string): void {
    const now = Date.now();
    const existing = this._previewSceneState;
    const createdAt = existing?.previewSceneName === previewSceneName && existing?.originalSceneName === originalSceneName
      ? existing.createdAt
      : now;
    this.savePreviewSceneState({
      previewSceneName,
      originalSceneName,
      overlayType,
      createdAt,
      updatedAt: now,
    });
  }

  private loadTabPreviewSceneStatesFromStorage(): void {
    try {
      const raw = localStorage.getItem(DOCK_PREVIEW_SCENE_STATE_KEY + "_tabs");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, DockPreviewSceneState>;
      for (const [key, val] of Object.entries(parsed)) {
        if (val && typeof val === "object" && val.previewSceneName && val.originalSceneName) {
          this._previewSceneStates.set(key, val);
        }
      }
    } catch { /* ignore */ }
  }

  private saveTabPreviewSceneStatesToStorage(): void {
    try {
      if (this._previewSceneStates.size === 0) {
        localStorage.removeItem(DOCK_PREVIEW_SCENE_STATE_KEY + "_tabs");
        return;
      }
      const obj: Record<string, DockPreviewSceneState> = {};
      for (const [k, v] of this._previewSceneStates) obj[k] = v;
      localStorage.setItem(DOCK_PREVIEW_SCENE_STATE_KEY + "_tabs", JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  private async getCurrentProgramSceneName(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this._programSceneCache && this._programSceneCache.expiresAt > now) {
      return this._programSceneCache.name;
    }
    const resp = await this.call("GetCurrentProgramScene") as { currentProgramSceneName?: string; sceneName?: string };
    const name = (resp.currentProgramSceneName || resp.sceneName || "").trim();
    if (name) {
      this._programSceneCache = { name, expiresAt: now + 30_000 };
    }
    return name;
  }

  private async getCurrentPreviewSceneName(): Promise<string> {
    const resp = await this.call("GetCurrentPreviewScene") as { currentPreviewSceneName?: string; sceneName?: string };
    return (resp.currentPreviewSceneName || resp.sceneName || "").trim();
  }

  private async isStudioModeEnabled(forceRefresh = false): Promise<boolean> {
    // Cache for 30s — studio mode rarely changes mid-session
    if (!forceRefresh && this._studioModeCache && Date.now() < this._studioModeCache.expiresAt) {
      return this._studioModeCache.value;
    }
    try {
      const resp = await this.call("GetStudioModeEnabled") as { studioModeEnabled?: boolean };
      const value = Boolean(resp.studioModeEnabled);
      this._studioModeCache = { value, expiresAt: Date.now() + 30_000 };
      return value;
    } catch {
      return false;
    }
  }

  /**
   * Animate a scene item entrance — zoom from slightly smaller to target size
   * over ~300ms by updating OBS bounds each frame. No Move plugin needed.
   */
  async animateSceneItemWithMove(
    sceneName: string,
    sceneItemId: number,
    targetX: number,
    targetY: number,
    targetWidth: number,
    targetHeight: number,
  ): Promise<void> {
    // Set initial position (slightly smaller, centered around target)
    const scaleStart = 0.92;
    const w0 = targetWidth * scaleStart;
    const h0 = targetHeight * scaleStart;
    const x0 = targetX + (targetWidth - w0) / 2;
    const y0 = targetY + (targetHeight - h0) / 2;

    await this.transformSceneItem(sceneName, sceneItemId, x0, y0, w0, h0);

    // Animate over ~300ms in ~8 steps
    const steps = 8;
    const durationMs = 300;
    const stepDelay = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Ease-out cubic: 1 - (1 - t)^3
      const ease = 1 - Math.pow(1 - t, 3);
      const s = scaleStart + (1 - scaleStart) * ease;
      const w = targetWidth * s;
      const h = targetHeight * s;
      const x = targetX + (targetWidth - w) / 2;
      const y = targetY + (targetHeight - h) / 2;

      await this.transformSceneItem(sceneName, sceneItemId, x, y, w, h);
      if (i < steps) await this.sleep(stepDelay);
    }

    // Ensure exact final position
    await this.transformSceneItem(sceneName, sceneItemId, targetX, targetY, targetWidth, targetHeight);
  }

  private async waitForSceneMatch(
    mode: "program" | "preview",
    expectedSceneName: string,
    attempts = 10,
    delayMs = 100,
  ): Promise<boolean> {
    const trimmed = expectedSceneName.trim();
    if (!trimmed) return false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = mode === "program"
        ? await this.getCurrentProgramSceneName(true).catch(() => "")
        : await this.getCurrentPreviewSceneName().catch(() => "");
      if (current === trimmed) return true;
      await this.sleep(delayMs);
    }

    return false;
  }

  private async restorePreviewSceneIfActiveProgram(previewSceneName: string): Promise<boolean> {
    const state = this.getStoredPreviewSceneState();
    const currentProgramScene = await this.getCurrentProgramSceneName().catch(() => "");
    const originalSceneName = state?.originalSceneName || this.getPreviewBaseSceneName(previewSceneName);
    if (currentProgramScene !== previewSceneName) {
      return false;
    }

    if (!originalSceneName) {
      console.warn(`[DockOBS] Cannot restore preview scene "${previewSceneName}" because original scene is unknown.`);
      return false;
    }

    try {
      await this.call("SetCurrentProgramScene", { sceneName: originalSceneName });
      if (await this.isStudioModeEnabled()) {
        await this.setCurrentPreviewScene(originalSceneName);
      }
      await this.waitForSceneMatch("program", originalSceneName);
      if (await this.isStudioModeEnabled()) {
        await this.waitForSceneMatch("preview", originalSceneName);
      }
      await this.sleep(100);
      return true;
    } catch (err) {
      console.warn(`[DockOBS] Failed to restore "${previewSceneName}" to "${originalSceneName}" before clear:`, err);
      return false;
    }
  }

  private getPreviewBaseSceneName(previewSceneName: string): string {
    const trimmed = previewSceneName.trim();
    return trimmed === DOCK_PRESENTATION_SCENE ? DOCK_PRESENTATION_SCENE : "";
  }

  private isPromotedPreviewScene(targetScene: string, currentProgramScene: string): boolean {
    return Boolean(targetScene) &&
      targetScene === currentProgramScene &&
      targetScene === DOCK_PRESENTATION_SCENE;
  }

  private async getObsSceneNames(): Promise<string[]> {
    const resp = await this.call("GetSceneList") as {
      scenes?: Array<{ sceneName?: string | null }>;
    };

    const sceneNames = (resp.scenes ?? [])
      .map((scene) => String(scene.sceneName ?? "").trim())
      .filter(Boolean);
    this._knownScenes = new Set(sceneNames);
    return sceneNames;
  }

  private async hasObsScene(sceneName: string): Promise<boolean> {
    const trimmedSceneName = sceneName.trim();
    if (!trimmedSceneName) return false;

    // The user can delete helper scenes directly in OBS. A cached hit is not
    // enough for recovery paths because stale positives make subsequent
    // GetSceneItemList/CreateSceneItem calls fail against a missing scene.
    if (this._knownScenes.has(trimmedSceneName)) {
      const sceneNames = await this.getObsSceneNames();
      const exists = sceneNames.includes(trimmedSceneName);
      if (!exists && trimmedSceneName === DOCK_PRESENTATION_SCENE) {
        this.resetPresentationSceneState();
      }
      return exists;
    }

    const sceneNames = await this.getObsSceneNames();
    return sceneNames.includes(trimmedSceneName);
  }

  private async setCurrentPreviewScene(sceneName: string, attempts = 3): Promise<boolean> {
    const trimmedSceneName = sceneName.trim();
    if (!trimmedSceneName) return false;

    if (trimmedSceneName === DOCK_PRESENTATION_SCENE) {
      await this.ensurePresentationSceneReady().catch((err) => {
        console.warn(`[DockOBS] Failed to ensure preview scene "${trimmedSceneName}":`, err);
      });
    }

    try {
      const resp = await this.call("GetCurrentPreviewScene") as {
        currentPreviewSceneName?: string;
        sceneName?: string;
      };
      const currentPreviewSceneName = (
        resp.currentPreviewSceneName ||
        resp.sceneName ||
        ""
      ).trim();
      if (currentPreviewSceneName === trimmedSceneName) {
        return true;
      }
    } catch {
      // Fall through to the explicit set call below.
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.call("SetCurrentPreviewScene", { sceneName: trimmedSceneName });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          attempt < attempts - 1 &&
          trimmedSceneName === DOCK_PRESENTATION_SCENE &&
          /No source was found|not found|does not exist/i.test(message)
        ) {
          await this.ensurePresentationSceneReady().catch(() => { });
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }
        if (attempt === attempts - 1) {
          console.warn(`[DockOBS] Failed to set OBS Preview to "${trimmedSceneName}":`, err);
          return false;
        }
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const resp = await this.call("GetCurrentPreviewScene") as {
          currentPreviewSceneName?: string;
          sceneName?: string;
        };
        const currentPreviewSceneName = (
          resp.currentPreviewSceneName ||
          resp.sceneName ||
          ""
        ).trim();
        if (currentPreviewSceneName === trimmedSceneName) {
          return true;
        }
      } catch {
        // Retry below.
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return false;
  }

  /**
   * Get the target scene name for the single output workflow.
   *
   * If Studio Mode is ON → returns the Preview scene (we push content there)
   * If Studio Mode is OFF → returns the Active/Program scene (we push directly)
   *
   * When tabId is provided, the dock still targets the shared
   * "MCE Presentation" scene rather than creating tab-specific preview scenes.
   *
   * Returns { sceneName, studioMode }.
   */
  private async getTargetScene(tabId?: DockPreviewTab, options?: { skipClone?: boolean }): Promise<{ sceneName: string; studioMode: boolean }> {
    const studioMode = await this.isStudioModeEnabled(true);

    // Bible fullscreen adds its scene directly to the user's scene — no clone needed.
    if (options?.skipClone) {
      const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
      this.rememberUserScene(sceneName, tabId);
      return { sceneName, studioMode: false };
    }

    if (studioMode) {
      const sceneMode = this.readSceneMode();

      if (sceneMode === "no-clone") {
        const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
        this.rememberUserScene(sceneName, tabId);
        await this.ensureNoProgramSceneUnderlayInPresentation();
        await this.setCurrentPreviewScene(DOCK_PRESENTATION_SCENE);
        await this.waitForSceneMatch("preview", DOCK_PRESENTATION_SCENE).catch(() => { });
        return { sceneName: DOCK_PRESENTATION_SCENE, studioMode: true };
      }

      return this.getPresentationTargetScene(tabId);
    }

    const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
    this.rememberUserScene(sceneName, tabId);

    return { sceneName, studioMode: false };
  }

  private async getPresentationTargetScene(
    tabId?: DockPreviewTab,
    options?: { activate?: boolean },
  ): Promise<{ sceneName: string; studioMode: boolean }> {
    await this.ensurePresentationSceneReady();

    const studioMode = await this.isStudioModeEnabled(true).catch(() => false);
    const currentProgramScene = await this.getCurrentProgramSceneName(true).catch(() => "");
    const activate = options?.activate !== false;
    const sceneMode = this.readSceneMode();

    if (currentProgramScene && currentProgramScene !== DOCK_PRESENTATION_SCENE) {
      this.rememberUserScene(currentProgramScene, tabId);
      if (studioMode) {
        if (sceneMode === "no-clone") {
          await this.ensureNoProgramSceneUnderlayInPresentation();
        } else {
          await this.ensureProgramSceneAsSourceInPresentation(true);
        }
      }
    }

    if (!activate) {
      return { sceneName: DOCK_PRESENTATION_SCENE, studioMode };
    }

    if (studioMode) {
      const currentPreviewScene = await this.getCurrentPreviewSceneName().catch(() => "");
      const originalPreviewScene = currentPreviewScene || currentProgramScene;
      if (originalPreviewScene && originalPreviewScene !== DOCK_PRESENTATION_SCENE) {
        if (tabId) {
          this.setPreviewSceneStateForTab(tabId, originalPreviewScene, DOCK_PRESENTATION_SCENE, "presentation");
        } else {
          this.setPreviewSceneState(originalPreviewScene, DOCK_PRESENTATION_SCENE, "presentation");
        }
      }
      await this.setCurrentPreviewScene(DOCK_PRESENTATION_SCENE);
      await this.waitForSceneMatch("preview", DOCK_PRESENTATION_SCENE).catch(() => { });
    } else if (currentProgramScene && currentProgramScene !== DOCK_PRESENTATION_SCENE) {
      if (sceneMode === "no-clone") {
        await this.ensureNoProgramSceneUnderlayInPresentation().catch(() => { });
        await this.removeMCEPresentationFromScene(currentProgramScene).catch(() => { });
      } else {
        await this.ensureProgramSceneAsSourceInPresentation(true, {
          allowWithoutStudioMode: true,
          programSceneName: currentProgramScene,
        }).catch(() => { });
      }
      await this.call("SetCurrentProgramScene", { sceneName: DOCK_PRESENTATION_SCENE });
      this._programSceneCache = null;
      await this.waitForSceneMatch("program", DOCK_PRESENTATION_SCENE).catch(() => { });
    }

    return { sceneName: DOCK_PRESENTATION_SCENE, studioMode };
  }
  /**
   * Read the user's chosen scene creation mode from projection settings.
   *
   * - "auto-duplicate": put the current Program scene underneath
   *   MCE Presentation as a scene source.
   * - "no-clone" (default): keep MCE Presentation overlay-only and remove Program
   *   scene underlays from it.
   */
  private readSceneMode(): "auto-duplicate" | "no-clone" {
    return loadProjectionSettings().sceneMode;
  }

  private readRestoreOriginalScene(): boolean {
    return loadProjectionSettings().restoreOriginalScene;
  }

  async deleteClone(sceneNameOrTab?: string, tabId?: DockPreviewTab): Promise<void> {
    // Overlay-only mode has no Program underlay to delete; also clean up any
    // legacy direct Program insertion from the previous routing behavior.
    if (this.readSceneMode() === "no-clone") {
      const programScene = await this.getCurrentProgramSceneName().catch(() => "");
      if (programScene) {
        await this.removeMCEPresentationFromScene(programScene);
      }
      return;
    }

    const toDelete: string[] = [];

    if (tabId) {
      // Tab-specific delete: only delete this tab's preview scene
      const tabSceneName = this.getTabPreviewSceneName(tabId);
      toDelete.push(tabSceneName);
      // Also remove from cloneMap if any entry maps to this scene
      for (const [key, val] of this._cloneMap) {
        if (val === tabSceneName) this._cloneMap.delete(key);
      }
    } else if (sceneNameOrTab) {
      const clone = this._cloneMap.get(sceneNameOrTab);
      if (clone) { toDelete.push(clone); this._cloneMap.delete(sceneNameOrTab); }
    } else {
      for (const clone of this._cloneMap.values()) toDelete.push(clone);
      this._cloneMap.clear();
    }
    // Don't delete clones that are currently Program or Preview
    const programScene = await this.getCurrentProgramSceneName().catch(() => "");
    const previewState = tabId
      ? this.getStoredPreviewSceneStateForTab(tabId)
      : this.getStoredPreviewSceneState();

    for (const clone of toDelete) {
      if (clone === DOCK_PRESENTATION_SCENE) {
        if (tabId) {
          if (previewState?.previewSceneName === clone) this.clearPreviewSceneStateForTab(tabId);
        } else {
          if (previewState?.previewSceneName === clone) this.clearPreviewSceneState();
        }
        continue;
      }
      if (clone === programScene) {
        await this.restorePreviewSceneIfActiveProgram(clone);
      }

      const refreshedProgram = await this.getCurrentProgramSceneName().catch(() => "");
      const refreshedPreview = await this.getCurrentPreviewSceneName().catch(() => "");
      if (clone === refreshedProgram || clone === refreshedPreview) {
        continue;
      }

      try {
        await this.call("RemoveScene", { sceneName: clone });
        this._knownScenes.delete(clone);
        this._cloneExistsCache.delete(clone);
        if (tabId) {
          if (previewState?.previewSceneName === clone) {
            this.clearPreviewSceneStateForTab(tabId);
          }
        } else {
          if (previewState?.previewSceneName === clone) {
            this.clearPreviewSceneState();
          }
        }
      } catch { /* ignore */ }
    }
  }

  private async onStudioModeDisabled(): Promise<void> {
    const currentProgramScene = await this.getCurrentProgramSceneName().catch(() => "");

    // Clean up staging scenes
    await this.cleanupDockPreviewStageScenes();

    // Restore staging scene if it's the current program
    if (currentProgramScene.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)) {
      await this.restoreSceneFromDockStagingScene(currentProgramScene);
    }
  }

  private async restoreSceneFromDockStagingScene(stagingSceneName: string): Promise<void> {
    const trimmedSceneName = stagingSceneName.trim();
    if (!trimmedSceneName.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)) return;

    const baseSceneName = normalizeDockStageBaseScene(trimmedSceneName);
    if (!baseSceneName || !(await this.hasObsScene(baseSceneName))) {
      return;
    }

    const studioMode = await this.isStudioModeEnabled();
    if (studioMode) {
      const restored = await this.setCurrentPreviewScene(baseSceneName);
      if (restored) {
        this.rememberUserScene(baseSceneName);
        return;
      }
      console.warn(`[DockOBS] Failed to restore OBS Preview from "${trimmedSceneName}" to "${baseSceneName}"`);
    } else {
      try {
        await this.call("SetCurrentProgramScene", { sceneName: baseSceneName });
        this.rememberUserScene(baseSceneName);
      } catch (err) {
        console.warn(`[DockOBS] Failed to restore OBS Program from "${trimmedSceneName}" to "${baseSceneName}":`, err);
      }
    }
  }

  private async cleanupDockPreviewStageScenes(): Promise<void> {
    const allSceneNames = await this.getObsSceneNames().catch(() => [] as string[]);
    const stagingSceneNames = allSceneNames.filter((sceneName) => sceneName.endsWith(DOCK_PREVIEW_STAGE_SUFFIX));
    if (stagingSceneNames.length === 0) return;

    const currentProgramScene = await (this.call("GetCurrentProgramScene") as Promise<{
      currentProgramSceneName?: string;
      sceneName?: string;
    }>).catch(() => null);
    const currentProgramSceneName = (
      currentProgramScene?.currentProgramSceneName ||
      currentProgramScene?.sceneName ||
      ""
    ).trim();
    if (currentProgramSceneName.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)) {
      await this.restoreSceneFromDockStagingScene(currentProgramSceneName);
    }

    try {
      const studioMode = await this.call("GetStudioModeEnabled") as { studioModeEnabled?: boolean };
      if (studioMode.studioModeEnabled) {
        const currentPreviewResp = await this.call("GetCurrentPreviewScene") as {
          currentPreviewSceneName?: string;
          sceneName?: string;
        };
        const currentPreviewSceneName = (
          currentPreviewResp.currentPreviewSceneName ||
          currentPreviewResp.sceneName ||
          ""
        ).trim();
        if (currentPreviewSceneName.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)) {
          await this.restoreSceneFromDockStagingScene(currentPreviewSceneName);
        }
      }
    } catch { /* ignore */ }

    const currentPreviewScene = await (this.call("GetCurrentPreviewScene") as Promise<{
      currentPreviewSceneName?: string;
      sceneName?: string;
    }>).catch(() => null);
    const currentPreviewSceneName = (
      currentPreviewScene?.currentPreviewSceneName ||
      currentPreviewScene?.sceneName ||
      ""
    ).trim();

    for (const sceneName of stagingSceneNames) {
      if (sceneName === currentProgramSceneName || sceneName === currentPreviewSceneName) {
        continue;
      }
      await this.removeSceneIfExists(sceneName);
    }
  }

  // ── Source provisioning ──

  /**
   * Returns the canonical overlay URL for known MakeChurchEazy browser sources.
   * This prevents browser sources from ever being initialized or left at about:blank.
   */
  getDefaultOverlayUrlForSource(sourceName: string): string {
    const norm = sourceName.trim();
    if (/worship/i.test(norm)) {
      return this.buildCssOverlayHtmlUrlForTab("worship", norm);
    }
    if (/note/i.test(norm)) {
      return this.buildCssOverlayHtmlUrlForTab("notes", norm);
    }
    if (/bible/i.test(norm)) {
      return this.buildCssOverlayHtmlUrlForTab("bible", norm);
    }
    if (/countdown|pre-?service/i.test(norm)) {
      return this.buildOverlayHtmlUrl("pre-service-countdown.html");
    }
    if (/animated\s*lower\s*third/i.test(norm)) {
      return `${this.getOverlayBaseUrl()}/animated-lower-thirds/lower-thirds/browser-source.html`;
    }
    if (norm === DOCK_LT_SOURCE || /lower\s*third|mce\s*lt:/i.test(norm)) {
      return this.buildOverlayHtmlUrl("lower-third-overlay.html");
    }
    if (norm === DOCK_TICKER_SOURCE || /ticker|time/i.test(norm)) {
      return this.buildOverlayHtmlUrl("time-overlay.html");
    }
    if (norm === DOCK_LIVE_TOOL_SOURCE || /live\s*tool/i.test(norm)) {
      return `${this.getOverlayBaseUrl()}/live-tool-overlay.html`;
    }
    if (norm === DOCK_MEDIA_TEMPLATE_SOURCE || /template/i.test(norm)) {
      return this.buildOverlayHtmlUrl("mce-template-overlay.html");
    }
    if (/media/i.test(norm)) {
      return this.buildOverlayHtmlUrl("mce-media-overlay.html");
    }
    return this.buildOverlayHtmlUrl("mce-bible-overlay.html");
  }

  /**
   * Ensure a browser source exists in the given scene.
   * If it doesn't exist, create it and position at (0,0) fullscreen.
   * Then move it to the TOP of the z-order so it acts as an overlay.
   * Returns the sceneItemId.
   */
  private async ensureOverlaySource(
    sceneName: string,
    sourceName: string,
    width?: number,
    height?: number,
    /** "keep" leaves an existing item's visibility untouched (new items start hidden). */
    enable: boolean | "keep" = true,
    initialPacket?: Record<string, unknown>,
    initialCss?: string,
  ): Promise<number> {
    // Ensure the target scene exists before querying it
    if (sceneName === DOCK_PRESENTATION_SCENE) {
      await this.ensurePresentationSceneReady();
    } else if (!await this.hasObsScene(sceneName).catch(() => false)) {
      try {
        await this.call("CreateScene", { sceneName });
        this._knownScenes.add(sceneName);
      } catch { /* scene may already exist */ }
    }

    const canvas = await this.getCanvasSize();
    const sourceWidth = Number(width) > 0 ? Number(width) : canvas.width;
    const sourceHeight = Number(height) > 0 ? Number(height) : canvas.height;

    // 1. Check if the source already exists in this scene. If OBS reports the
    // scene missing despite the earlier check, recreate it and retry once.
    let items: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex?: number; sceneItemEnabled?: boolean }>;
    try {
      items = await this.getSceneItemListCached(sceneName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/scene|source.*not found|not found|does not exist|No source was found/i.test(message)) {
        throw err;
      }
      this._knownScenes.delete(sceneName);
      if (sceneName === DOCK_PRESENTATION_SCENE) {
        this.resetPresentationSceneState();
      }
      await (sceneName === DOCK_PRESENTATION_SCENE
        ? this.ensurePresentationSceneReady()
        : this.ensureDedicatedScene(sceneName));
      this.invalidateSceneItemListCache(sceneName);
      items = await this.getSceneItemListCached(sceneName);
    }

    let sceneItemId: number | null = null;
    const aliases = this.getSourceAliases(sourceName);
    const existing = items.find((i) => i.sourceName === sourceName || aliases.includes(i.sourceName));
    let createdSceneItem = false;
    const modeManagedSourceNames = new Set([
      this._fullscreenSceneDefs["bible"]?.browserSourceName,
      getDockResources().worshipSource,
      getDockResources().notesSource,
    ]);
    const preserveExistingTransform = Boolean(existing && modeManagedSourceNames.has(existing.sourceName));

    if (existing) {
      sceneItemId = existing.sceneItemId;
      // Re-enable the source if it was previously hidden (e.g. by clearAllOverlays)
      if (enable === true && existing.sceneItemEnabled === false) {
        try {
          await this.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: existing.sceneItemId,
            sceneItemEnabled: true,
          });
        } catch { /* ignore */ }
      }
      if (enable === false && existing.sceneItemEnabled !== false) {
        try {
          await this.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: existing.sceneItemId,
            sceneItemEnabled: false,
          });
        } catch { /* ignore */ }
      }
    } else {
      // 2. Check if the input already exists globally (from another scene)
      let inputExists = false;
      try {
        const inputs = await this.call("GetInputList") as {
          inputs: Array<{ inputName: string; inputKind: string }>;
        };
        inputExists = inputs.inputs.some((i) => i.inputName === sourceName);
      } catch { /* ignore */ }

      // Retry logic for transient OBS failures
      const maxRetries = 3;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (inputExists) {
            // Add existing input as a scene item reference
            const created = await this.call("CreateSceneItem", {
              sceneName,
              sourceName,
              sceneItemEnabled: enable === true,
            }) as { sceneItemId: number };
            sceneItemId = created.sceneItemId;
            createdSceneItem = true;
          } else {
            // Create brand new browser source
            delete this._lastBrowserSourceUrlBySource[sourceName];
            delete this._lastCssOverlayPacketBySource[sourceName];
            delete this._lastCssOverlayBaseUrlBySource[sourceName];
            delete this._lastCssOverlayThemeCssBySource[sourceName];
            const defaultUrl = this.getDefaultOverlayUrlForSource(sourceName);
            const initialUrl = initialPacket
              ? `${defaultUrl}#data=${encodeURIComponent(JSON.stringify(initialPacket))}`
              : defaultUrl;
            const created = await this.call("CreateInput", {
              sceneName,
              inputName: sourceName,
              inputKind: "browser_source",
              inputSettings: {
                url: initialUrl,
                width: sourceWidth,
                height: sourceHeight,
                css: initialCss || "",
                bgcolor: "#00000000",
                shutdown: false,
                restart_when_active: false,
              },
              sceneItemEnabled: enable === true,
            }) as { sceneItemId: number };
            sceneItemId = created.sceneItemId;
            createdSceneItem = true;
            if (initialPacket) {
              this._lastBrowserSourceUrlBySource[sourceName] = defaultUrl;
              this._lastCssOverlayPacketBySource[sourceName] = initialPacket;
              this._lastCssOverlayBaseUrlBySource[sourceName] = defaultUrl;
              this._lastCssOverlayThemeCssBySource[sourceName] = initialCss || "";
            }
          }
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            const delay = 200 * Math.pow(2, attempt);
            console.warn(`[DockOBS] Source creation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, lastError.message);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (lastError && !sceneItemId) {
        // OBS may have actually created the source despite the error response.
        // Re-check the scene item list to recover gracefully.
        try {
          this.invalidateSceneItemListCache(sceneName);
          const recoveryItems = await this.getSceneItemListCached(sceneName);
          const recovered = recoveryItems.find((i) => i.sourceName === sourceName);
          if (recovered) {
            sceneItemId = recovered.sceneItemId;
            lastError = null;
          }
        } catch { /* ignore recovery failure */ }

        // Also check if the input exists globally and try CreateSceneItem one more time
        if (!sceneItemId) {
          try {
            const inputs = await this.call("GetInputList") as {
              inputs: Array<{ inputName: string }>;
            };
            if (inputs.inputs.some((i) => i.inputName === sourceName)) {
              const created = await this.call("CreateSceneItem", {
                sceneName,
                sourceName,
                sceneItemEnabled: enable === true,
              }) as { sceneItemId: number };
              sceneItemId = created.sceneItemId;
              createdSceneItem = true;
              lastError = null;
            }
          } catch { /* ignore */ }
        }
      }

      if (lastError && !sceneItemId) {
        console.warn(`[DockOBS] Failed to create scene item "${sourceName}" after retries and recovery:`, lastError.message);
        throw lastError;
      }
    }

    const defaultUrl = this.getDefaultOverlayUrlForSource(sourceName);
    let shouldRepairUrl = false;
    if (defaultUrl) {
      const currentUrl = await this.readBrowserSourceUrl(sourceName);
      if (!this.normalizeBrowserSourceDocumentUrl(currentUrl)) {
        shouldRepairUrl = true;
      }
    }

    const repairUrl = initialPacket
      ? `${defaultUrl}#data=${encodeURIComponent(JSON.stringify(initialPacket))}`
      : defaultUrl;

    try {
      await this.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: {
          width: sourceWidth,
          height: sourceHeight,
          ...(shouldRepairUrl ? { url: repairUrl } : {}),
          ...(initialCss !== undefined ? { css: initialCss } : {}),
        },
      });
      if (shouldRepairUrl && defaultUrl) {
        this._lastBrowserSourceUrlBySource[sourceName] = repairUrl;
      }
    } catch {
      // Some pre-existing sources may reject size-only updates; keep going.
    }

    if (createdSceneItem || !preserveExistingTransform) {
      try {
        await this.fitSceneItemToCanvas(sceneName, sceneItemId!);
      } catch (err) {
        console.warn(`[DockOBS] Failed to set transform for "${sourceName}":`, err);
      }
    }

    // 3. Move to top of z-order.
    // In OBS, larger scene-item indices are higher in the Sources stack.
    // For the Presentation scene, keep the ticker at the top if it is visible.
    try {
      if (sceneName === DOCK_PRESENTATION_SCENE) {
        this.invalidateSceneItemListCache(sceneName);
        // Stack only. The `enable` argument (step 4) decides visibility; the
        // stacking helper used to switch a hidden item back on here, which undid
        // enable=false / "keep" and showed the source before its content landed.
        await this.ensureTickerAboveSource(sceneName, sourceName, { leaveVisibility: true });
      } else {
        this.invalidateSceneItemListCache(sceneName);
        const refreshedItems = await this.getSceneItemListCached(sceneName);
        const topIndex = Math.max(0, refreshedItems.length - 1);
        const currentItem = refreshedItems.find((i) => i.sceneItemId === sceneItemId);
        if (currentItem && currentItem.sceneItemIndex !== topIndex) {
          await this.call("SetSceneItemIndex", {
            sceneName,
            sceneItemId,
            sceneItemIndex: topIndex,
          });
        }
      }
    } catch (err) {
      console.warn(`[DockOBS] Failed to reorder "${sourceName}":`, err);
    }

    // 4. Make sure it's enabled/visible (only if requested)
    if (enable === true) {
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: sceneItemId!,
          sceneItemEnabled: true,
        });
      } catch { /* ignore */ }
    }

    if (sceneName === DOCK_PRESENTATION_SCENE && sourceName === DOCK_LT_SOURCE) {
      await this.syncLowerThirdTickerClearance(sceneName).catch(() => { });
    }

    return sceneItemId!;
  }

  // ── Dedicated overlay scene management ──

  /**
   * Ensure a dedicated OBS scene exists for an overlay type.
   * The scene contains the overlay's browser source + background source,
   * kept in isolation from the user's own scenes.
   *
   * @returns the scene name (already existing or freshly created)
   */
  private async ensureDedicatedScene(dedicatedSceneName: string): Promise<string> {
    const trimmedSceneName = dedicatedSceneName.trim();
    if (!trimmedSceneName) {
      throw new Error("Dock helper scene name was empty.");
    }

    const sceneExists = await this.hasObsScene(trimmedSceneName).catch(() => false);
    if (sceneExists) {
      return trimmedSceneName;
    }

    if (trimmedSceneName === DOCK_PRESENTATION_SCENE) {
      this.resetPresentationSceneState();
    }

    try {
      await this.call("CreateScene", { sceneName: trimmedSceneName });
      this._knownScenes.add(trimmedSceneName);
      // Give OBS a moment to fully initialize the scene before adding sources
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      if (await this.hasObsScene(trimmedSceneName).catch(() => false)) {
        return trimmedSceneName;
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create scene "${trimmedSceneName}" in OBS. ${message}`);
    }

    if (!await this.hasObsScene(trimmedSceneName).catch(() => false)) {
      throw new Error(`OBS did not expose the helper scene "${trimmedSceneName}" after creation.`);
    }

    return trimmedSceneName;
  }

  private isMissingObsSceneError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /No source was found|No scene was found|scene.*not found|source.*not found|not found|does not exist|was not found/i.test(message);
  }

  private shouldRepairPresentationSceneReference(
    requestType: string,
    requestData: Record<string, unknown> | undefined,
    error: unknown,
  ): boolean {
    return requestType === "CreateSceneItem" &&
      requestData?.sourceName === DOCK_PRESENTATION_SCENE &&
      typeof requestData.sceneName === "string" &&
      requestData.sceneName !== DOCK_PRESENTATION_SCENE &&
      this.isMissingObsSceneError(error);
  }

  private async repairPresentationSceneReference(): Promise<void> {
    this._knownScenes.delete(DOCK_PRESENTATION_SCENE);
    this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);

    const sceneStillExists = await this.hasObsScene(DOCK_PRESENTATION_SCENE).catch(() => false);
    if (!sceneStillExists) {
      this._presentationSceneDeletedAt ||= Date.now();
      this.resetPresentationSceneState();
    }

    await this.ensurePresentationSceneReady();
  }

  private async waitForPresentationSceneDeletionToSettle(): Promise<void> {
    if (!this._presentationSceneDeletedAt) return;
    const elapsed = Date.now() - this._presentationSceneDeletedAt;
    const remaining = 1200 - elapsed;
    if (remaining > 0) {
      await this.sleep(remaining);
    }
  }

  private async ensurePresentationSceneReady(): Promise<string> {
    if (!this._presentationSceneDeletedAt && await this.hasObsScene(DOCK_PRESENTATION_SCENE).catch(() => false)) {
      return DOCK_PRESENTATION_SCENE;
    }

    if (this._presentationSceneRepairPromise) {
      await this._presentationSceneRepairPromise;
      return DOCK_PRESENTATION_SCENE;
    }

    const repairPromise = (async () => {
      await this.waitForPresentationSceneDeletionToSettle();
      this._knownScenes.delete(DOCK_PRESENTATION_SCENE);
      this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
      await this.ensureDedicatedScene(DOCK_PRESENTATION_SCENE);
      this._knownScenes.add(DOCK_PRESENTATION_SCENE);
      this._presentationSceneDeletedAt = 0;
      await this.sleep(160);
    })();

    const trackedRepairPromise = repairPromise.finally(() => {
      if (this._presentationSceneRepairPromise === trackedRepairPromise) {
        this._presentationSceneRepairPromise = null;
      }
    });
    this._presentationSceneRepairPromise = trackedRepairPromise;

    await trackedRepairPromise;
    return DOCK_PRESENTATION_SCENE;
  }

  private getTargetFullscreenBgSourceName(
    sceneName: string,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): string {
    const normalized = sceneName.replace(/\s+/g, " ").trim() || "Scene";
    return `${resources.fsTargetBgPrefix} - ${normalized}`;
  }

  /**
   * Add a dedicated overlay scene as a nested "scene source" into the
   * user's target scene, positioned fullscreen on top.
   *
   * This means the user's scene references our dedicated scene, which in
   * turn contains the browser source + background. Updating the browser
   * source URL happens inside the dedicated scene — the user's scene just
   * shows it through the scene reference.
   *
   * @param targetScene  The user's scene (Preview or Program)
   * @param dedicatedScene  Our dedicated scene (e.g. " MCE Bible")
   * @param enable  Whether to enable (show) the scene source
   */
  private async ensureSceneSourceInTarget(
    targetScene: string,
    dedicatedScene: string,
    enable: boolean,
  ): Promise<number> {
    // Reuse an existing item when possible. Recreating the item every time
    // is expensive and has been a source of OBS hangs when the target scene
    // is already active.
    try {
      let items = await this.getSceneItemListCached(targetScene);
      const existingItems = items.filter((i) => i.sourceName === dedicatedScene);
      if (existingItems.length > 0) {
        const [primaryItem, ...duplicateItems] = existingItems;

        for (const item of duplicateItems) {
          await this.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: item.sceneItemId }).catch(() => { });
          await new Promise((r) => setTimeout(r, 50));
        }
        if (duplicateItems.length > 0) {
          this.invalidateSceneItemListCache(targetScene);
        }

        await this.call("SetSceneItemEnabled", {
          sceneName: targetScene,
          sceneItemId: primaryItem.sceneItemId,
          sceneItemEnabled: enable,
        }).catch(() => { });

        await this.ensureTickerAboveSource(targetScene, dedicatedScene).catch(() => { });

        return primaryItem.sceneItemId;
      }
    } catch { /* ignore */ }

    // Now add fresh — with retries
    let sceneItemId: number | null = null;
    for (let attempt = 0; attempt <= 4; attempt++) {
      try {
        const sceneExists = await this.hasObsScene(dedicatedScene).catch(() => false);
        if (!sceneExists) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        const created = await this.call("CreateSceneItem", {
          sceneName: targetScene,
          sourceName: dedicatedScene,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
        this.invalidateSceneItemListCache(targetScene);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }

    if (sceneItemId === null) throw new Error(`Failed to add scene "${dedicatedScene}" to "${targetScene}"`);

    try {
      await this.fitSceneItemToCanvas(targetScene, sceneItemId);
    } catch { /* ignore */ }

    await this.ensureTickerAboveSource(targetScene, dedicatedScene).catch(() => { });

    return sceneItemId;
  }

  /**
   * Hide a dedicated scene source in the given target scene.
   */
  private async hideSceneSource(targetScene: string, dedicatedScene: string): Promise<void> {
    // Never hide MCE Presentation — only hide legacy dedicated scenes
    if (dedicatedScene === PRESENTATION_SCENE_NAME) return;
    try {
      const items = await this.getSceneItemListCached(targetScene);
      const item = items.find((i) => i.sourceName === dedicatedScene);
      if (item) {
        await this.call("SetSceneItemEnabled", {
          sceneName: targetScene,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
      }
    } catch { /* ignore */ }
  }

  private async removeSceneItemBySource(sceneName: string, sourceName: string): Promise<void> {
    // Never remove MCE Presentation scene source — only remove legacy dedicated scenes
    if (sourceName === PRESENTATION_SCENE_NAME) return;
    try {
      const items = await this.getSceneItemListCached(sceneName);
      const matched = items.filter((item) => item.sourceName === sourceName);
      for (const item of matched) {
        await this.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: item.sceneItemId,
        });
      }
      if (matched.length > 0) {
        this.invalidateSceneItemListCache(sceneName);
      }
    } catch { /* ignore */ }
  }

  /**
   * If Studio Mode is ON, remove the given source from the Program scene.
   * This prevents MCE scene changes from leaking into Program after
   * a transition (OBS scenes are single instances — modifying them
   * updates every scene that references them).
   */
  private async removeFromProgramIfExists(sourceName: string): Promise<void> {
    try {
      const sm = await this.call("GetStudioModeEnabled") as { studioModeEnabled: boolean };
      if (!sm.studioModeEnabled) return;
      const resp = await this.call("GetCurrentProgramScene") as { currentProgramSceneName: string };
      const programScene = resp.currentProgramSceneName;
      if (programScene) {
        await this.removeSceneItemBySource(programScene, sourceName);
      }
    } catch { /* ignore */ }
  }

  /**
   * Worship and Notes share one source, so the separate Notes source and Notes
   * background older versions created are removed from OBS. Only the exact
   * MakeChurchEazy names are touched.
   */
  private async removeLegacySeparateNotesSources(targetScene: string): Promise<void> {
    const inputs = await this.call("GetInputList").catch(() => null) as {
      inputs?: Array<{ inputName: string }>;
    } | null;
    const present = new Set((inputs?.inputs ?? []).map((input) => String(input.inputName || "").trim()));
    let removed = false;
    for (const name of LEGACY_NOTES_SOURCE_NAMES) {
      if (!present.has(name)) continue;
      await this.removeInputIfExists(name);
      removed = true;
    }
    if (removed) {
      this.invalidateSceneItemListCache(targetScene);
      if (targetScene !== PRESENTATION_SCENE_NAME) {
        this.invalidateSceneItemListCache(PRESENTATION_SCENE_NAME);
      }
    }
  }

  private async removeInputIfExists(inputName: string): Promise<void> {
    try {
      await this.call("RemoveInput", { inputName });
    } catch { /* ignore */ }
    delete this._lastBrowserSourceUrlBySource[inputName];
    delete this._lastCssOverlayPacketBySource[inputName];
    delete this._lastCssOverlayBaseUrlBySource[inputName];
    delete this._lastCssOverlayThemeCssBySource[inputName];
  }

  private async removeSceneIfExists(sceneName: string): Promise<void> {
    try {
      await this.call("RemoveScene", { sceneName });
      this._knownScenes.delete(sceneName);
      this._cloneExistsCache.delete(sceneName);
      delete this._lastBgItemState[sceneName];
      delete this._activeLtBgSignature[sceneName];
      delete this._activeLtBgInputKind[sceneName];
    } catch { /* ignore */ }
  }

  /**
   * Determine whether a scene name was created by MakeChurchEazy.
   *
   * Matches:
   *  - Exact names: "MCE Presentation", "MCE Lower Thirds", "MCE_PreService",
   *    "MCE Ticker Scene", "⚡ Quick Merge"
   *  - Prefix patterns: "MCE ", "MCE_", "MV: ", "Sunday - "
   *  - Source-prefixed scenes: "MCE MV: "
   */
  private static isMCEScene(name: string): boolean {
    const n = name.trim();
    // Exact matches
    if (
      n === "MCE Presentation" ||
      n === "MCE Lower Thirds" ||
      n === "MCE_PreService" ||
      n === "MCE Ticker Scene" ||
      n === "⚡ Quick Merge"
    ) return true;

    // Prefix patterns
    if (
      n.startsWith("MCE ") ||
      n.startsWith("MCE_") ||
      n.startsWith("MV: ") ||
      n.startsWith("Sunday - ")
    ) return true;

    return false;
  }

  private static isManagedMultiviewSceneName(name: string): boolean {
    return /^MV:\s*Multiview\b/i.test(name.trim());
  }

  /**
   * Delete every scene and source that MakeChurchEazy created in OBS.
   *
   * This removes MCE-managed scenes and strips MCE-prefixed sources from
   * any remaining (user-owned) scenes.  The user is responsible for
   * confirming the destructive action before calling this.
   */
  async clearAllMCEScenes(): Promise<{ deletedScenes: number; cleanedSources: number }> {
    const sceneNames = await this.getObsSceneNames();
    const mceScenes = sceneNames.filter((n) => DockObsClient.isMCEScene(n));
    const userScenes = sceneNames.filter((n) => !DockObsClient.isMCEScene(n));

    // If the current program scene is an MCE scene, switch to the first user scene
    // so OBS doesn't get stuck on a scene we're about to delete.
    if (userScenes.length > 0) {
      try {
        const currentProgram = await this.getCurrentProgramSceneName();
        if (mceScenes.includes(currentProgram)) {
          await this.call("SetCurrentProgramScene", { sceneName: userScenes[0] });
        }
      } catch { /* best effort */ }
    }

    // Delete MCE scenes
    let deletedScenes = 0;
    for (const scene of mceScenes) {
      try {
        await this.call("RemoveScene", { sceneName: scene });
        this._knownScenes.delete(scene);
        this._cloneExistsCache.delete(scene);
        deletedScenes++;
      } catch (err) {
        console.warn(`[DockOBS] Failed to delete MCE scene "${scene}":`, err);
      }
    }

    // Clean up MCE-prefixed sources from remaining user scenes
    let cleanedSources = 0;

    for (const scene of userScenes) {
      try {
        const resp = await this.call("GetSceneItemList", { sceneName: scene }) as {
          sceneItems?: Array<{ sceneItemId: number; sourceName?: string }>;
        };
        const items = resp.sceneItems ?? [];
        for (const item of items) {
          const src = (item.sourceName ?? "").trim();
          if (!DockObsClient.isMCESource(src)) continue;
          try {
            await this.call("RemoveSceneItem", {
              sceneName: scene,
              sceneItemId: item.sceneItemId,
            });
            cleanedSources++;
          } catch { /* ignore individual source failures */ }
        }
      } catch { /* ignore scene-level failures */ }
    }

    return { deletedScenes, cleanedSources };
  }

  /**
   * Determine whether an OBS source or input was created by MakeChurchEazy.
   * Matches MCE, MCA, and OCS naming conventions. Leaves user sources intact.
   */
  public static isMCESource(name: string): boolean {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("mce ") ||
      lower.startsWith("mce_") ||
      lower.startsWith("mca ") ||
      lower.startsWith("mca_") ||
      lower.startsWith("ocs ") ||
      lower.startsWith("ocs_") ||
      trimmed === "⚡ Quick Merge" ||
      lower.startsWith("mv: ") ||
      lower === "mce presentation" ||
      lower === "mce lower thirds" ||
      lower === "mce ticker" ||
      lower === "mce stage display" ||
      /\s-\s(mce|mca|ocs)(\s|$)/i.test(lower) ||
      lower.endsWith(" - mce")
    ) {
      return true;
    }
    return false;
  }

  private _isCleaningMceSources = false;

  /**
   * Remove all MCE/MCA-created sources from OBS for free plan users (after free trial).
   * Leaves user scenes, MCE scenes, and all non-MCE sources completely intact.
   */
  async clearMCESourcesForFreePlan(): Promise<{ cleanedSources: number }> {
    if (!this.isConnected || this._isCleaningMceSources) {
      return { cleanedSources: 0 };
    }
    this._isCleaningMceSources = true;
    let cleanedSources = 0;

    try {
      // 1. Remove all MCE-created inputs globally (removes them from all scenes and audio mixer)
      const inputListResp = await this.call("GetInputList", undefined, { bypassFreeMutationGate: true }).catch(() => null) as {
        inputs?: Array<{ inputName: string; inputKind: string }>;
      } | null;

      const inputs = inputListResp?.inputs ?? [];
      // Free users add the presentation link themselves as a Browser Source and
      // may name it "MCE Presentation". Never remove a source that points at the
      // presentation link, whatever its name.
      const protectedSources = new Set<string>();
      for (const input of inputs) {
        if (!DockObsClient.isMCESource(input.inputName)) continue;
        const settings = await this.call("GetInputSettings", { inputName: input.inputName }, { bypassFreeMutationGate: true })
          .catch(() => null) as { inputSettings?: { url?: unknown } } | null;
        if (isPresentationLinkUrl(settings?.inputSettings?.url)) protectedSources.add(input.inputName);
      }
      for (const input of inputs) {
        if (DockObsClient.isMCESource(input.inputName) && !protectedSources.has(input.inputName)) {
          try {
            await this.call("RemoveInput", { inputName: input.inputName }, { bypassFreeMutationGate: true });
            cleanedSources++;
          } catch (err) {
            console.warn(`[DockOBS] Failed to remove MCE input "${input.inputName}":`, err);
          }
        }
      }

      // 2. Iterate through all scenes (including MCE Presentation, user scenes, etc.)
      // and remove any scene items whose sourceName matches MCE source prefixes.
      // NOTE: Scenes themselves are kept intact, only MCE sources within them are removed.
      const sceneNames = await this.getObsSceneNames().catch(() => []);
      for (const scene of sceneNames) {
        try {
          const resp = await this.call("GetSceneItemList", { sceneName: scene }, { bypassFreeMutationGate: true }).catch(() => null) as {
            sceneItems?: Array<{ sceneItemId: number; sourceName?: string }>;
          } | null;
          const items = resp?.sceneItems ?? [];
          for (const item of items) {
            const src = (item.sourceName ?? "").trim();
            if (DockObsClient.isMCESource(src) && !protectedSources.has(src)) {
              try {
                await this.call(
                  "RemoveSceneItem",
                  { sceneName: scene, sceneItemId: item.sceneItemId },
                  { bypassFreeMutationGate: true }
                );
                cleanedSources++;
              } catch { /* ignore individual item failure */ }
            }
          }
        } catch { /* ignore scene-level failures */ }
      }
    } catch (err) {
      console.warn("[DockOBS] Failed clearing MCE sources for free plan:", err);
    } finally {
      this._isCleaningMceSources = false;
    }

    if (cleanedSources > 0) {
      console.log(`[DockOBS] Free plan cleanup: removed ${cleanedSources} MCE source(s) from OBS.`);
    }

    return { cleanedSources };
  }

  /**
   * Strip large data-URI fields from theme settings before URL encoding.
   *
   * `logoUrl` and `backgroundImage` data URIs can be 50 KB–500 KB+, which
   * blows past OBS / CEF URL length limits when JSON-stringified into the
   * URL hash fragment.  We replace them with sentinel values (e.g.
   * `__FROM_CSS__`) and inject them into the browser source via OBS's
   * `css` input-setting, where there is no length limit.
   *
   * The overlay HTML reads the CSS custom properties as a fallback.
   */
  private stripThemeDataUris(
    themeSettings: Record<string, unknown> | null | undefined,
  ): { cleanSettings: Record<string, unknown> | null; css: string } {
    if (!themeSettings) return { cleanSettings: null, css: "" };

    const clean = { ...themeSettings };
    const cssRules: string[] = [];

    // --- logoUrl ---
    const logoUrl = clean.logoUrl as string | undefined;
    if (logoUrl && logoUrl.startsWith("data:")) {
      cssRules.push(`--logo-data-uri: url(${logoUrl});`);
      clean.logoUrl = "__FROM_CSS__";
    }

    // --- backgroundImage ---
    const bgImage = clean.backgroundImage as string | undefined;
    if (bgImage && bgImage.startsWith("data:")) {
      // Deliver image data via OBS custom CSS so it works in the dock for
      // both fullscreen and lower-third themes without relying on a file path.
      cssRules.push(`--bg-image: url(${bgImage});`);
      clean.backgroundImage = "__FROM_CSS__";
    }

    // --- boxBackgroundImage ---
    const boxBgImage = clean.boxBackgroundImage as string | undefined;
    if (boxBgImage && boxBgImage.startsWith("data:")) {
      cssRules.push(`--box-bg-image: url(${boxBgImage});`);
      clean.boxBackgroundImage = "__FROM_CSS__";
    }

    // --- backgroundPattern (SVG data URIs) ---
    // Wrap in quotes because SVG data URIs may contain unencoded parentheses
    // (from transform="rotate(...)" etc.) that break CSS url() parsing.
    const bgPattern = clean.backgroundPattern as string | undefined;
    if (bgPattern && bgPattern.startsWith("data:")) {
      cssRules.push(`--bg-pattern-data: url("${bgPattern}");`);
      clean.backgroundPattern = "__FROM_CSS__";
    }

    const css = cssRules.length ? `:root { ${cssRules.join(" ")} }` : "";
    return { cleanSettings: clean, css };
  }

  private mergeThemeSettingsWithLiveOverrides(
    themeSettings: Record<string, unknown> | null | undefined,
    liveOverrides: DockLiveThemeOverrides | Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (!themeSettings && !liveOverrides) return null;
    const merged = {
      ...(themeSettings ?? {}),
      ...(liveOverrides ?? {}),
    };
    const outputFontFamily = loadDockOutputFontFamily();
    if (outputFontFamily) merged.fontFamily = outputFontFamily;
    return applyDockOutputFontScale(merged, loadDockOutputFontScale());
  }

  private hasVisualBackground(themeSettings: Record<string, unknown> | null | undefined): boolean {
    if (!themeSettings) return false;

    const bgColor = String(themeSettings.backgroundColor || "").trim().toLowerCase();
    const bgImage = String(themeSettings.backgroundImage || "").trim();
    const bgPattern = String(themeSettings.backgroundPattern || "").trim();
    const bgVideo = String(themeSettings.backgroundVideo || "").trim();
    const bgImageFilePath = String(themeSettings.backgroundImageFilePath || "").trim();
    const bgVideoFilePath = String(themeSettings.backgroundVideoFilePath || "").trim();

    if (
      Boolean(bgImage) ||
      Boolean(bgPattern) ||
      Boolean(bgVideo) ||
      Boolean(bgImageFilePath) ||
      Boolean(bgVideoFilePath)
    ) {
      return true;
    }

    return (
      Boolean(bgColor) &&
      bgColor !== "transparent" &&
      bgColor !== "#0000" &&
      bgColor !== "#00000000" &&
      bgColor !== "rgba(0,0,0,0)" &&
      bgColor !== "rgba(0, 0, 0, 0)"
    );
  }

  private _resolveNativeBackgroundSource(
    themeSettings: Record<string, unknown> | null | undefined,
    canvas: { width: number; height: number },
  ): { inputKind: "color_source_v3" | "image_source" | "ffmpeg_source"; inputSettings: Record<string, unknown> } | null {
    if (!themeSettings) return null;

    const bgVideoFilePath = this._resolveNativeVideoPath(themeSettings);
    const bgImageFilePath = String(themeSettings.backgroundImageFilePath || "").trim();
    const hasVideo = Boolean(String(themeSettings.backgroundVideo || "").trim() || bgVideoFilePath);
    const hasImage = Boolean(String(themeSettings.backgroundImage || "").trim() || bgImageFilePath);

    // Videos can render via a native OBS media source when we have a real
    // local file path. That keeps the background stable while the browser
    // source updates verse/lyrics text.
    if (hasVideo && bgVideoFilePath) {
      return {
        inputKind: "ffmpeg_source",
        inputSettings: {
          local_file: bgVideoFilePath,
          is_local_file: true,
          looping: true,
          restart_on_activate: true,
          close_when_inactive: false,
          clear_on_media_end: false,
          scale_to_fit: false,
        },
      };
    }

    // Images: use a native OBS image_source only when we have a real local
    // file path. Relative or remote URLs stay browser-rendered so OBS does not
    // silently fall back to a blank source.
    if (hasImage && bgImageFilePath) {
      const imageUrl = bgImageFilePath;
      return {
        inputKind: "image_source",
        inputSettings: {
          file: imageUrl,
          width: canvas.width,
          height: canvas.height,
        },
      };
    }

    const bgColor = String(themeSettings.backgroundColor || "").trim();
    const bgColorEnd = String(themeSettings.backgroundColorEnd || "").trim();
    const normalizedColor = bgColor.toLowerCase();
    const isTransparent =
      !normalizedColor ||
      normalizedColor === "transparent" ||
      normalizedColor === "#0000" ||
      normalizedColor === "#00000000" ||
      normalizedColor === "rgba(0,0,0,0)" ||
      normalizedColor === "rgba(0, 0, 0, 0)";
    const isGradient = !isTransparent && Boolean(bgColorEnd) && bgColorEnd !== bgColor;
    if (!isTransparent && !isGradient) {
      return {
        inputKind: "color_source_v3",
        inputSettings: {
          color: this._cssColorToObsColor(bgColor),
          width: canvas.width,
          height: canvas.height,
        },
      };
    }

    return null;
  }

  private _resolveNativeVideoPath(
    themeSettings: Record<string, unknown> | null | undefined,
  ): string {
    if (!themeSettings) return "";

    const explicitPath = String(themeSettings.backgroundVideoFilePath || "").trim();
    if (explicitPath) return explicitPath;

    const rawVideo = String(themeSettings.backgroundVideo || "").trim();
    if (!rawVideo) return "";

    if (rawVideo.startsWith("file://")) {
      try {
        return decodeURIComponent(new URL(rawVideo).pathname);
      } catch {
        return rawVideo.replace(/^file:\/\//i, "");
      }
    }

    return "";
  }

  private _hasBrowserRenderedBackground(themeSettings: Record<string, unknown> | null | undefined): boolean {
    if (!themeSettings) return false;
    const bgColor = String(themeSettings.backgroundColor || "").trim().toLowerCase();
    const bgColorEnd = String(themeSettings.backgroundColorEnd || "").trim();
    const bgImage = String(themeSettings.backgroundImage || "").trim();
    const bgPattern = String(themeSettings.backgroundPattern || "").trim();
    const bgImageFilePath = String(themeSettings.backgroundImageFilePath || "").trim();
    const bgVideo = String(themeSettings.backgroundVideo || "").trim();
    const bgVideoFilePath = String(themeSettings.backgroundVideoFilePath || "").trim();
    // Browser rendering is used for gradients, patterns, and for image/video
    // URLs that do not have a stable local file path for a native OBS source.
    return Boolean(
      (bgColor && bgColor !== "transparent" && bgColor !== "#0000" && bgColor !== "#00000000" && bgColor !== "rgba(0,0,0,0)" && bgColor !== "rgba(0, 0, 0, 0)" && bgColorEnd && bgColorEnd !== bgColor) ||
      Boolean(bgPattern) ||
      (bgImage && !bgImageFilePath) ||
      (bgVideo && !bgVideoFilePath),
    );
  }

  private async _ensureNativeBackgroundSource(
    sceneName: string,
    sourceName: string,
    background: { inputKind: "image_source" | "color_source_v3" | "ffmpeg_source"; inputSettings: Record<string, unknown> } | null,
    enable: boolean,
    canvas: { width: number; height: number },
  ): Promise<void> {
    if (!background) return;

    let inputExists = false;
    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      const existing = inputs.inputs.find((i) => i.inputName === sourceName);
      if (existing) {
        inputExists = true;
        if (existing.inputKind !== background.inputKind) {
          await this.call("RemoveInput", { inputName: sourceName }).catch(() => { });
          inputExists = false;
        }
      }
    } catch { /* ignore */ }

    if (!inputExists) {
      await this.call("CreateInput", {
        inputName: sourceName,
        inputKind: background.inputKind,
        inputSettings: background.inputSettings,
      }).catch(() => { });
    } else {
      await this.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: background.inputSettings,
      }).catch(() => { });
    }

    try {
      const items = await this.getSceneItemListCached(sceneName);
      let sceneItemId = items.find((i) => i.sourceName === sourceName)?.sceneItemId;
      if (sceneItemId === undefined) {
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
        this.invalidateSceneItemListCache(sceneName);
      }

      await this.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId,
        sceneItemTransform: {
          positionX: 0, positionY: 0,
          scaleX: 1, scaleY: 1,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width, boundsHeight: canvas.height,
          boundsAlignment: 0,
          rotation: 0,
          cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
        },
      }).catch(() => { });
      await this.call("SetSceneItemIndex", { sceneName, sceneItemId, sceneItemIndex: 0 }).catch(() => { });
      await this.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId,
        sceneItemEnabled: enable,
      }).catch(() => { });

      if (enable && background.inputKind === "ffmpeg_source") {
        await this.call("TriggerMediaInputAction", {
          inputName: sourceName,
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        }).catch(() => { });
      }
    } catch { /* best effort */ }
  }

  private async _ensureBrowserBackgroundSource(
    sceneName: string,
    sourceName: string,
    themeSettings: Record<string, unknown>,
    enable: boolean,
    canvas: { width: number; height: number },
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    const { cleanSettings, css } = this.stripThemeDataUris(themeSettings);
    const signature = JSON.stringify({
      theme: cleanSettings ?? null,
      css: css || "",
      width: canvas.width,
      height: canvas.height,
    });
    const url = this.buildFullscreenBackgroundUrl(cleanSettings);

    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      const existing = inputs.inputs.find((i) => i.inputName === sourceName);
      if (existing && existing.inputKind !== "browser_source") {
        await this.call("RemoveInput", { inputName: sourceName }).catch(() => { });
      }
    } catch { /* ignore */ }

    await this.ensureOverlaySource(sceneName, sourceName, canvas.width, canvas.height, enable);
    if (this._lastFullscreenBgSignature[sourceName] !== signature) {
      await this.setBrowserSourceUrl(sourceName, url, false, css || undefined);
      this._lastFullscreenBgSignature[sourceName] = signature;
    }
    const bgItems = await this.getSceneItemListCached(sceneName);
    const bgItem = bgItems.find((item) => item.sourceName === sourceName);
    if (bgItem) {
      await this._positionBgBelowOverlays(sceneName, bgItem.sceneItemId, resources);
    }
  }

  /**
   * Update a browser source URL in OBS.
   * Optionally forces a reload by briefly blanking the source first,
   * which is needed when switching between different overlay HTML files
   * (e.g. fullscreen → lower-third) on the same source.
   *
   * @param css  Optional CSS to inject into the browser source via
   *             OBS `SetInputSettings`. Used to deliver large data URIs
   *             (logos, box backgrounds) that would exceed URL-hash limits.
   */
  private async setBrowserSourceUrl(inputName: string, url: string, forceReload = false, css?: string): Promise<void> {
    await browserQueue.enqueue(inputName, async () => {
      const prevUrl = this._lastBrowserSourceUrlBySource[inputName];
      let urlChanged = !this.browserSourceUrlMatchesLoadedDocument(prevUrl, url);
      if (urlChanged && !prevUrl && !forceReload) {
        const currentUrl = await this.readBrowserSourceUrl(inputName);
        if (this.browserSourceUrlMatchesLoadedDocument(currentUrl, url)) {
          this._lastBrowserSourceUrlBySource[inputName] = url;
          urlChanged = false;
        }
      }

      if (forceReload || urlChanged) {
        const inputSettings: Record<string, unknown> = { url, bgcolor: "#00000000" };
        if (css !== undefined) inputSettings.css = css;
        try {
          await this.call("SetInputSettings", {
            inputName,
            inputSettings,
          });
          this._lastBrowserSourceUrlBySource[inputName] = url;
        } catch { /* ignore */ }
        return;
      }

      if (css === undefined) return;
      try {
        await this.call("SetInputSettings", {
          inputName,
          inputSettings: { css },
        });
      } catch { /* ignore */ }
    }, { label: inputName, force: forceReload });
  }

  private normalizeBrowserSourceDocumentUrl(url: string | undefined): string {
    const trimmed = String(url || "").trim();
    if (!trimmed || trimmed === "about:blank") return "";
    const hashIndex = trimmed.indexOf("#");
    const documentUrl = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
    try {
      const parsed = new URL(documentUrl);
      // The initial Bible bootstrap mode is a startup hint only. The running
      // page changes mode through the overlay packet, so a later stable URL
      // without this hint must still be treated as the same document.
      parsed.searchParams.delete("mode");
      // This token is intentionally different for each Dock process so OBS
      // fetches a current HTML document at startup. It is not a document
      // identity and must not make normal packet updates look like URL swaps.
      parsed.searchParams.delete("mceReload");
      return parsed.toString();
    } catch {
      return documentUrl;
    }
  }

  /** True when both URLs load the same overlay HTML file from the overlay server (query/hash ignored). */
  private isSameOverlayDocument(currentUrl: string | undefined, nextUrl: string): boolean {
    if (!currentUrl || !nextUrl) return false;
    try {
      const a = new URL(currentUrl);
      const b = new URL(nextUrl);
      // Same file AND same HTML content fingerprint (`v`, see overlayVersion.ts):
      // a page built from older overlay HTML must still be reloaded.
      return a.origin === b.origin
        && a.pathname === b.pathname
        && (a.searchParams.get("v") ?? "") === (b.searchParams.get("v") ?? "");
    } catch {
      return false;
    }
  }

  private browserSourceUrlMatchesLoadedDocument(currentUrl: string | undefined, nextUrl: string): boolean {
    if (!currentUrl || !nextUrl) return false;
    if (currentUrl === nextUrl) return true;
    if (nextUrl.includes("#")) return false;
    return this.normalizeBrowserSourceDocumentUrl(currentUrl)
      === this.normalizeBrowserSourceDocumentUrl(nextUrl);
  }

  private async readBrowserSourceUrl(inputName: string): Promise<string> {
    try {
      const resp = await this.call("GetInputSettings", { inputName }) as {
        inputSettings?: { url?: unknown };
      };
      return typeof resp.inputSettings?.url === "string" ? resp.inputSettings.url : "";
    } catch {
      return "";
    }
  }

  private async hasBrowserSourceUrlChanged(inputName: string, baseUrl: string): Promise<boolean> {
    const cachedUrl = this._lastBrowserSourceUrlBySource[inputName];
    if (this.browserSourceUrlMatchesLoadedDocument(cachedUrl, baseUrl)) return false;

    const currentUrl = await this.readBrowserSourceUrl(inputName);
    if (this.browserSourceUrlMatchesLoadedDocument(currentUrl, baseUrl)) {
      this._lastBrowserSourceUrlBySource[inputName] = baseUrl;
      return false;
    }

    return true;
  }

  private async hasExistingOverlaySceneItem(sourceName: string): Promise<boolean> {
    for (const sceneName of await this.getLikelyOverlayScenes()) {
      const items = await this.getSceneItemListCached(sceneName).catch(() => []);
      if (items.some((item) => item.sourceName === sourceName)) return true;
    }
    return false;
  }

  private async canReuseStableCssOverlaySource(sourceName: string, baseUrl: string): Promise<boolean> {
    const urlChanged = await this.hasBrowserSourceUrlChanged(sourceName, baseUrl).catch(() => true);
    if (urlChanged) return false;
    return this.hasExistingOverlaySceneItem(sourceName);
  }

  private async keepLoadedCssOverlaySourceStable(
    sourceName: string,
    tabType: "worship" | "notes",
    packet: Record<string, unknown>,
    baseUrl: string,
    themeCss = "",
  ): Promise<boolean> {
    const canReuseLoadedSource = await this.canReuseStableCssOverlaySource(sourceName, baseUrl).catch(() => false);
    if (!canReuseLoadedSource) return false;

    if (tabType === "worship") {
      this._worshipInitialized = true;
    } else {
      this._notesInitialized = true;
    }

    const mode = packet.mode;
    if (mode === "fullscreen" || mode === "lower-third") {
      this._lastOverlayMode[sourceName] = mode;
    }
    // Do not record `packet` as delivered: it has not been sent yet, and
    // treating it as the live packet let later pushes/redeliveries reuse it.
    this._lastCssOverlayBaseUrlBySource[sourceName] = baseUrl;
    this._lastCssOverlayTabBySource[sourceName] = tabType;
    void themeCss;
    return true;
  }

  private buildCssOverlayDataCss(
    packet: Record<string, unknown>,
    themeCss = "",
  ): string {
    const encodedPacket = encodeURIComponent(JSON.stringify(packet));
    const displayMode = packet.mode === "lower-third" || packet.mode === "fullscreen"
      ? ` --display-mode: "${String(packet.mode)}";`
      : "";
    const overlayCss = `:root { --overlay-data: "${encodedPacket}";${displayMode} }`;
    const fontCss = buildDockFontFamilyCss(loadDockOutputFontFamily());
    return [overlayCss, themeCss, fontCss].filter(Boolean).join("\n");
  }

  private async emitBrowserOverlayPacket(
    tabType: CssOverlayPacketTab,
    packet: Record<string, unknown>,
    overlayCss: string,
    targetSource?: string,
  ): Promise<boolean> {
    try {
      await this.call(
        "CallVendorRequest",
        {
          vendorName: "obs-browser",
          requestType: "emit_event",
          requestData: {
            event_name: "mce-overlay-packet",
            event_data: {
              // obs-browser dispatches requestData.event_data as the custom
              // event detail. Keep the payload one level deeper so OBS does
              // not consume targetSource as a vendor-level routing field before
              // the overlay can validate it.
              event_name: "mce-overlay-packet",
              event_data: {
                tab: tabType,
                packet,
                css: overlayCss,
                version: OVERLAY_HTML_VERSION,
                ...(targetSource ? { targetSource } : {}),
              },
            },
          },
        },
        { priority: "high" },
      );
      // A blank is not new content and must not release a waiting reveal.
      if (targetSource && packet.blanked !== true) this.noteSourcePacketDelivered(targetSource);
      return true;
    } catch {
      return false;
    }
  }

  private noteSourcePacketDelivered(source: string): void {
    const now = Date.now();
    this._lastPacketDeliveredAtBySource[source] = now;
    if (this._freshPacketWaiters.length === 0) return;
    const remaining: Array<{ source: string; since: number; resolve: () => void }> = [];
    for (const waiter of this._freshPacketWaiters) {
      if (waiter.source === source && now >= waiter.since) waiter.resolve();
      else remaining.push(waiter);
    }
    this._freshPacketWaiters = remaining;
  }

  /**
   * Resolve once OBS has accepted a packet for `source` sent at or after
   * `since` (or right away if one already was), or after `timeoutMs`.
   *
   * A hidden MCE browser source still holds the last thing it showed. Showing
   * it again before the new verse/slide lands is the "old verse for a second
   * or two" operators see after a clear, an idle pause or a Dock reload.
   */
  private waitForFreshSourcePacket(source: string, since: number, timeoutMs: number): Promise<void> {
    if ((this._lastPacketDeliveredAtBySource[source] ?? 0) >= since) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this._freshPacketWaiters = this._freshPacketWaiters.filter((w) => w.resolve !== finish);
        resolve();
      };
      this._freshPacketWaiters.push({ source, since, resolve: finish });
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * After a browser source loads a new document, packets emitted while the
   * page is still starting have no listener and are silently lost (OBS acks the
   * vendor request anyway). Re-send the NEWEST cached packet a few times while
   * the page boots so the output always ends on the latest click. Duplicates
   * are harmless: the overlay ignores packets it has already applied.
   */
  private scheduleLatestPacketRedelivery(inputName: string, tabType: CssOverlayPacketTab): void {
    for (const timer of this._redeliveryTimersBySource[inputName] ?? []) clearTimeout(timer);
    this._redeliveryTimersBySource[inputName] = [300, 700, 1400, 2600].map((delay) => setTimeout(() => {
      const latest = this._lastCssOverlayPacketBySource[inputName];
      if (!latest || !this.isConnected) return;
      const css = this.buildCssOverlayDataCss(latest, this._lastCssOverlayThemeCssBySource[inputName] || "");
      void this.emitBrowserOverlayPacket(
        this._lastCssOverlayTabBySource[inputName] ?? tabType,
        latest,
        css,
        inputName,
      ).catch(() => false);
    }, delay));
  }

  private async emitCssOverlayPacketWithFallback(
    inputName: string,
    tabType: CssOverlayPacketTab,
    packet: Record<string, unknown>,
    baseUrl: string,
    overlayCss: string,
  ): Promise<void> {
    // Browser-source CSS changes destroy and recreate OBS's CEF document.
    // Deliver the complete packet (including theme CSS) through obs-browser's
    // in-place custom event instead. The CSS write is a recovery path only
    // when this OBS build cannot emit the event at all.
    // Scope the packet to this input. obs-browser broadcasts vendor events to
    // every browser source, so an older dock window must not overwrite this
    // source while an operator advances a verse or lyric.
    const emitted = await this.emitBrowserOverlayPacket(tabType, packet, overlayCss, inputName);
    if (!emitted) {
      await this.setBrowserSourceUrl(inputName, baseUrl, false, overlayCss);
      return;
    }

    // Do not wait for a paint acknowledgement here. OBS acknowledges the
    // vendor request before CEF paints, so waiting on that acknowledgement
    // only holds up the verse-selection path. More importantly, an ordinary
    // verse change must never reload the browser source as a recovery attempt:
    // that is the black flash operators see between verses. CSS recovery is
    // reserved for an explicit vendor failure above.
  }

  private async deliverCssOverlayPacket(
    inputName: string,
    tabType: CssOverlayPacketTab,
    packet: Record<string, unknown>,
    baseUrl: string,
    themeCss = "",
  ): Promise<void> {
    const overlayCss = this.buildCssOverlayDataCss(packet, themeCss);
    const sourceWasNotTracked = !Object.prototype.hasOwnProperty.call(
      this._lastBrowserSourceUrlBySource,
      inputName,
    );
    const urlChanged = await this.hasBrowserSourceUrlChanged(inputName, baseUrl);
    if (sourceWasNotTracked && !urlChanged) {
      // After a reconnect/idle the cache was cleared, but OBS still has this
      // exact overlay page loaded. Update it in place instead of reloading it
      // (a reload blanks the output and drops the packets sent while it boots,
      // which is why the first click after a pause showed old content).
      await this.emitCssOverlayPacketWithFallback(inputName, tabType, packet, baseUrl, overlayCss);
      this.rememberCssOverlayTransport(inputName, packet, baseUrl, themeCss, tabType);
      this.scheduleLatestPacketRedelivery(inputName, tabType);
      return;
    }
    const previousMode = this._lastCssOverlayPacketBySource[inputName]?.mode;
    const modeChanged = previousMode !== undefined && previousMode !== packet.mode;
    const previousPacket = this._lastCssOverlayPacketBySource[inputName];
    const previousThemeCss = this._lastCssOverlayThemeCssBySource[inputName] || "";
    let themePayloadChanged = previousThemeCss !== (themeCss || "");
    if (!themePayloadChanged) {
      try {
        themePayloadChanged =
          JSON.stringify(previousPacket?.theme ?? null) !== JSON.stringify(packet.theme ?? null);
      } catch {
        themePayloadChanged = true;
      }
    }

    // URL changes still require a browser reload. On the first packet after
    // connecting to OBS or creating a source, put the complete packet into CSS
    // and URL hash as well with forceReload=false so CEF does not hard-reload.
    if (urlChanged || sourceWasNotTracked) {
      const bootstrapMode = packet.mode === "fullscreen" || packet.mode === "lower-third"
        ? packet.mode
        : undefined;
      const stableBootstrapUrl = tabType === "bible" && bootstrapMode
        ? this.buildCssOverlayHtmlUrlForTab("bible", inputName, bootstrapMode)
        : baseUrl;
      const bootstrapUrl = this.addOverlayDocumentSessionToken(stableBootstrapUrl);
      const bootstrapUrlWithData = `${bootstrapUrl}#data=${encodeURIComponent(JSON.stringify(packet))}`;
      // A newly loaded page must know its content before its first paint.
      // Setting both the URL hash and overlay CSS guarantees the slide renders
      // immediately on the very first click without requiring a second click.
      await this.setBrowserSourceUrl(inputName, bootstrapUrlWithData, false, overlayCss);
      if (packet.blanked !== true) this.noteSourcePacketDelivered(inputName);
      void this.emitBrowserOverlayPacket(tabType, packet, overlayCss, inputName).catch(() => false);
      this.rememberCssOverlayTransport(inputName, packet, baseUrl, themeCss, tabType);
      this.scheduleLatestPacketRedelivery(inputName, tabType);
      return;
    }

    if (modeChanged) {
      // The running page morphs in place; never recreate it for a mode switch.
      await this.emitCssOverlayPacketWithFallback(inputName, tabType, packet, baseUrl, overlayCss);
      this.rememberCssOverlayTransport(inputName, packet, baseUrl, themeCss, tabType);
      return;
    }

    if (!themePayloadChanged) {
      await this.emitCssOverlayPacketWithFallback(inputName, tabType, packet, baseUrl, overlayCss);
      this.rememberCssOverlayTransport(inputName, packet, baseUrl, themeCss, tabType);
      return;
    }

    // Theme changes use the same in-place event path, so changing a background
    // or font cannot blank the browser source between slides.
    await this.emitCssOverlayPacketWithFallback(inputName, tabType, packet, baseUrl, overlayCss);
    this.rememberCssOverlayTransport(inputName, packet, baseUrl, themeCss, tabType);
  }

  /** Mark `module` as the one projecting on the shared Worship/Notes source. */
  private claimSharedWorshipNotesSource(module: "worship" | "notes"): void {
    this._sharedWorshipNotesOwner = module;
  }

  /**
   * True while the OTHER module (Worship vs Notes) is on air on the shared
   * source. Priming or clearing from this module must not touch the source then:
   * it would replace or hide what is on screen.
   */
  isSharedWorshipNotesSourceHeldByOther(module: "worship" | "notes"): boolean {
    const owner = this._sharedWorshipNotesOwner;
    if (!owner || owner === module) return false;
    // After a Dock reload the in-memory active source is empty; fall back to
    // the remembered active module.
    const active = this._lastActivePresentationSource ?? this.getActivePresentationSourceFromStorage();
    return active === getDockResources().worshipSource;
  }

  private rememberCssOverlayTransport(
    inputName: string,
    packet: Record<string, unknown>,
    baseUrl: string,
    themeCss = "",
    tabType?: CssOverlayPacketTab,
  ): void {
    this._lastCssOverlayPacketBySource[inputName] = packet;
    this._lastCssOverlayBaseUrlBySource[inputName] = baseUrl;
    this._lastCssOverlayThemeCssBySource[inputName] = themeCss || "";
    if (tabType) this._lastCssOverlayTabBySource[inputName] = tabType;
    // Any delivery (fast, restored or prime paths) makes the full-path
    // "same content as last push" signature stale; otherwise a repeat click
    // could replay an older cached packet. The full paths set the signature
    // again right after their own delivery.
    const deliveredTab = tabType ?? this._lastCssOverlayTabBySource[inputName];
    if (deliveredTab === "bible") this._lastBiblePushSignature = "";
    else if (deliveredTab === "worship" || deliveredTab === "notes") {
      // Worship and Notes share one source: whichever delivered last replaced
      // the other's content, so neither push may be treated as a repeat.
      this._lastWorshipPushSignature = "";
      this._lastNotesPushSignature = "";
    }
  }

  private isRefreshableTextBrowserSource(sourceName: string): boolean {
    const normalized = sourceName.trim();
    return normalized === this._fullscreenSceneDefs.bible.browserSourceName
      || normalized === this._fullscreenSceneDefs.worship.browserSourceName
      || normalized === this._fullscreenSceneDefs.notes.browserSourceName
      || normalized.startsWith("MCE Bible - ")
      || normalized.startsWith("MCE Worship - ")
      || normalized.startsWith("MCE Notes - ");
  }

  private buildOutputFontRefreshCss(): string {
    const outputFontCss = buildDockFontFamilyCss(loadDockOutputFontFamily());
    if (outputFontCss) return outputFontCss;

    return [
      ":root { --mce-output-font-family: var(--font-family); }",
      "body, body *:not(.material-icons):not(.material-icons-outlined):not(.material-icons-round):not(.material-icons-sharp):not(.material-symbols-outlined):not(.fa):not([class^=\"fa-\"]):not([class*=\" fa-\"]) { font-family: var(--font-family) !important; }",
    ].join("\n");
  }

  /**
   * Apply a CSS refresh to an existing browser source and ask obs-browser to
   * restart its CEF document. Clear the one-shot flag afterwards so future
   * source-setting changes do not unexpectedly restart the page.
   */
  private async setBrowserSourceCssAndRestart(
    inputName: string,
    css: string,
    url?: string,
  ): Promise<void> {
    const inputSettings: Record<string, unknown> = {
      css,
      restart_cef: true,
    };
    if (url) inputSettings.url = url;

    await this.call("SetInputSettings", { inputName, inputSettings });
    await this.sleep(50);
    await this.call("SetInputSettings", {
      inputName,
      inputSettings: { restart_cef: false },
    }).catch(() => { });
  }

  /**
   * Reapply the configured OBS font family to browser sources that are already
   * live. The active OBS document needs the same packet refresh as a theme
   * change.
   */
  async refreshOutputTypography(): Promise<void> {
    // A font change can happen while the Dock is still reconnecting to OBS.
    // The browser preview updates immediately, but returning here would leave
    // the live source on its previous family with no later retry. Reuse the
    // normal connection path and wait briefly for the socket to become ready.
    if (!this.isConnected) {
      await this.connect().catch(() => { });
      const deadline = Date.now() + 3000;
      while (!this.isConnected && Date.now() < deadline) {
        await this.sleep(50);
      }
    }
    if (!this.isConnected) return;

    const entries = Object.entries(this._lastCssOverlayPacketBySource);
    await Promise.allSettled(entries.map(async ([sourceName, packet]) => {
      const baseUrl = this._lastCssOverlayBaseUrlBySource[sourceName];
      const tabType = this._lastCssOverlayTabBySource[sourceName];
      if (!baseUrl || !tabType) return;

      const refreshedPacket: Record<string, unknown> = { ...packet, timestamp: Date.now() };
      const themeCss = this._lastCssOverlayThemeCssBySource[sourceName] || "";
      const overlayCss = this.buildCssOverlayDataCss(refreshedPacket, themeCss);
      const emitted = await this.emitBrowserOverlayPacket(tabType, refreshedPacket, overlayCss, sourceName);
      const mode = refreshedPacket.mode === "fullscreen" || refreshedPacket.mode === "lower-third"
        ? refreshedPacket.mode
        : "";
      const rendered = emitted && mode
        ? await this.waitForOverlayRenderAck(
          tabType,
          refreshedPacket.timestamp as number,
          mode,
          350,
          undefined,
          sourceName,
        )
        : false;

      // OBS can acknowledge obs-browser's vendor request before the CEF page
      // has actually consumed it. If no render acknowledgement arrives, put
      // the complete packet into the source CSS and explicitly restart CEF so
      // the live OBS source cannot remain on its old font.
      if (!rendered) {
        await this.setBrowserSourceCssAndRestart(sourceName, overlayCss, baseUrl);
      }
      this.rememberCssOverlayTransport(sourceName, refreshedPacket, baseUrl, themeCss, tabType);
    }));

    // A source that was already live before this Dock session has no cached
    // packet yet. Update those known MCE Bible/Notes/Worship browser inputs by
    // appending the same override to their current OBS CSS.
    let inputNames: string[] = [];
    try {
      const response = await this.call("GetInputList") as {
        inputs?: Array<{ inputName?: string; inputKind?: string }>;
      };
      inputNames = (response.inputs ?? [])
        .filter((input) => input.inputKind === "browser_source")
        .map((input) => String(input.inputName || "").trim())
        .filter((inputName) => inputName && this.isRefreshableTextBrowserSource(inputName));
    } catch {
      return;
    }

    const refreshCss = this.buildOutputFontRefreshCss();
    const trackedSources = new Set(entries.map(([sourceName]) => sourceName));
    await Promise.allSettled(inputNames
      .filter((inputName) => !trackedSources.has(inputName))
      .map(async (inputName) => {
        const response = await this.call("GetInputSettings", { inputName }) as {
          inputSettings?: { css?: unknown; url?: unknown };
        };
        const currentCss = typeof response.inputSettings?.css === "string"
          ? response.inputSettings.css
          : "";
        const currentUrl = typeof response.inputSettings?.url === "string"
          ? response.inputSettings.url
          : "";
        const nextCss = [currentCss, refreshCss].filter(Boolean).join("\n");
        if (nextCss === currentCss) return;
        await this.setBrowserSourceCssAndRestart(inputName, nextCss, currentUrl);
      }));
  }

  private extractOverlayPacketFromCss(css: string | undefined): Record<string, unknown> | null {
    if (!css) return null;
    const match = css.match(/--overlay-data:\s*"([^"]+)"/);
    if (!match?.[1]) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private buildFullscreenBackgroundUrl(
    themeSettings?: Record<string, unknown> | null,
  ): string {
    const packet = {
      theme: themeSettings ?? null,
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(packet));
    return `${this.buildOverlayHtmlUrl("bible-overlay-bg.html")}#data=${encoded}`;
  }

  private prepareDedicatedLowerThirdTheme(
    themeSettings: Record<string, unknown> | null | undefined,
  ): {
    overlayTheme: Record<string, unknown> | null;
    backgroundTheme: Record<string, unknown> | null;
  } {
    if (!themeSettings) {
      return { overlayTheme: null, backgroundTheme: null };
    }

    const source = { ...themeSettings };
    const bgType = String(source.backgroundType || "").trim().toLowerCase();
    const isBackgroundOff = bgType === "off";
    const isBackgroundColor = bgType === "color" || bgType === "gradient";
    const isBackgroundPattern = bgType === "pattern";
    const isBackgroundImage = bgType === "image";
    const isBackgroundVideo = bgType === "video";

    if (isBackgroundOff) {
      return {
        overlayTheme: {
          ...source,
          backgroundColor: "transparent",
          backgroundColorEnd: "",
          backgroundImage: "",
          backgroundImageFilePath: "",
          backgroundVideo: "",
          backgroundVideoFilePath: "",
          backgroundPattern: "",
          backgroundOpacity: 0,
          fullscreenShadeEnabled: false,
          fullscreenShadeOpacity: 0,
        },
        backgroundTheme: null,
      };
    }

    if (isBackgroundColor) {
      const bgColor = String(source.backgroundColor || "").trim();
      const bgColorEnd = String(source.backgroundColorEnd || "").trim();
      const isGradient = Boolean(bgColorEnd) && bgColorEnd !== bgColor;
      const cleanTheme = {
        ...source,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundPattern: "",
      };
      return {
        overlayTheme: cleanTheme,
        backgroundTheme: isGradient ? cleanTheme : null,
      };
    }

    if (isBackgroundPattern) {
      const cleanTheme = {
        ...source,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
      };
      return { overlayTheme: cleanTheme, backgroundTheme: cleanTheme };
    }

    if (isBackgroundImage || isBackgroundVideo) {
      return { overlayTheme: source, backgroundTheme: source };
    }

    const bgColor = String(source.backgroundColor || "").trim().toLowerCase();
    const bgImage = String(source.backgroundImage || "").trim();
    const bgPattern = String(source.backgroundPattern || "").trim();
    const bgVideo = String(source.backgroundVideo || "").trim();
    const bgColorEnd = String(source.backgroundColorEnd || "").trim();

    const hasImageOrVideo = Boolean(bgImage) || Boolean(bgVideo);
    const hasPattern = Boolean(bgPattern);
    const isTransparent =
      !bgColor ||
      bgColor === "transparent" ||
      bgColor === "rgba(0,0,0,0)" ||
      bgColor === "rgba(0, 0, 0, 0)";
    const isGradient = !isTransparent && Boolean(bgColorEnd) && bgColorEnd !== bgColor;
    const isSolidColor = !isTransparent && !isGradient;

    // Images, videos, gradients, and solid colors: render in the browser overlay.
    // Solid colors go to the card's --box-background (not --bg-color), so they
    // must stay in the overlay theme — delegating to a native OBS color_source
    // would fill the entire canvas instead of just the card.
    if (hasImageOrVideo || hasPattern || isGradient) {
      return { overlayTheme: source, backgroundTheme: source };
    }

    // Solid colors: overlay handles via --box-background, no native OBS source needed
    if (isSolidColor) {
      return { overlayTheme: source, backgroundTheme: null };
    }

    // No background at all
    return {
      overlayTheme: {
        ...source,
        backgroundColor: "transparent",
        backgroundColorEnd: "",
        backgroundImage: "",
        backgroundVideo: "",
        backgroundPattern: "",
        backgroundOpacity: 1,
        fullscreenShadeEnabled: false,
        fullscreenShadeOpacity: 0,
      },
      backgroundTheme: null,
    };
  }

  /**
   * Hide (disable) an overlay source in a scene, if it exists.
   * Uses cached scene item list to avoid redundant WebSocket calls.
   */
  private async hideOverlaySource(sceneName: string, sourceName: string): Promise<void> {
    try {
      const items = await this.getSceneItemListCached(sceneName);
      const item = items.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
        // The next send must see the item as hidden so it turns it back on.
        this.invalidateSceneItemListCache(sceneName);
        this.invalidateActiveMceOverlayState(sceneName);
        delete this._lastVerifiedStackedBySceneSource[`${sceneName}::${sourceName}`];
      }
    } catch { /* ignore */ }
  }

  /**
   * Hide content sources left by the pre-unified Bible output. The current
   * Bible browser source renders both single and compare layouts, so an old
   * MCE Bible scene/browser item must not remain visible underneath it.
   * Background items are intentionally left alone; they do not contain a
   * second verse and may still be used by an older presentation setup.
   */
  private async hideLegacyBibleContentSources(
    sceneName: string,
    activeSourceName: string,
  ): Promise<void> {
    const target = sceneName.trim();
    const active = activeSourceName.trim();
    if (!target || !active) return;

    try {
      this.invalidateSceneItemListCache(target);
      const items = await this.getSceneItemListCached(target);
      const legacyItems = items.filter((item) => {
        if (item.sourceName === active || item.sceneItemEnabled === false) return false;
        if (!isMcePresentationManagedSource(item.sourceName)) return false;
        if (getMcePresentationSourceFamily(item.sourceName) !== "bible") return false;
        const normalized = item.sourceName.trim().toLocaleLowerCase();
        return !normalized.includes("background") && !normalized.includes(" bg") && !normalized.endsWith("bg");
      });

      if (legacyItems.length === 0) return;
      await Promise.all(legacyItems.map((item) => this.call("SetSceneItemEnabled", {
        sceneName: target,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: false,
      }).catch(() => { })));
      this.invalidateSceneItemListCache(target);
    } catch {
      // Legacy cleanup must never prevent the current Bible output from being
      // pushed when an old scene no longer exists.
    }
  }

  /**
   * Build batch requests to hide multiple sources in a scene.
   * Resolves source names → item IDs via the scene item list cache,
   * then returns SetSceneItemEnabled(false) requests for callBatch.
   * Items that don't exist in the scene are silently skipped.
   */
  private async _buildHideBatchRequests(
    sceneName: string,
    sourceNames: string[],
  ): Promise<Array<{ requestType: string; requestData: Record<string, unknown> }>> {
    const items = await this.getSceneItemListCached(sceneName);
    const requests: Array<{ requestType: string; requestData: Record<string, unknown> }> = [];
    for (const name of sourceNames) {
      const item = items.find((i) => i.sourceName === name);
      if (item) {
        requests.push({
          requestType: "SetSceneItemEnabled",
          requestData: {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: false,
          },
        });
      }
    }
    return requests;
  }

  // ── Fullscreen background source helpers ──

  /**
   * Ensure a fullscreen background source exists BEHIND the overlay source.
   * For image backgrounds → OBS `image_source`.
   * For solid colors → OBS `color_source_v3`.
   * The source is placed at z-index 0 (bottom) of the overlay stack so
   * that when the foreground browser source briefly blanks during URL
   * changes, the viewer sees the theme background instead of a flash.
   */
  private async ensureFullscreenBg(
    sceneName: string,
    themeSettings: Record<string, unknown> | null | undefined,
    enable = true,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    // Skip adding a fullscreen BG source into MCE Presentation — the BG
    // already lives inside the dedicated scene that is nested as a source.
    if (sceneName === PRESENTATION_SCENE_NAME) return;

    if (!themeSettings || !this.hasVisualBackground(themeSettings)) {
      await this.hideFullscreenBg(sceneName, resources);
      return;
    }

    const canvas = await this.getCanvasSize();
    const nativeBg = this._resolveNativeBackgroundSource(themeSettings, canvas);

    if (nativeBg) {
      await this._ensureNativeBackgroundSource(sceneName, resources.fsBgSource, nativeBg, enable, canvas);
      return;
    }

    if (!this._hasBrowserRenderedBackground(themeSettings)) {
      await this.hideFullscreenBg(sceneName, resources);
      return;
    }

    await this._ensureBrowserBackgroundSource(sceneName, resources.fsBgSource, themeSettings, enable, canvas, resources);
  }

  /**
   * Ensure the user's actual Preview/Program scene also contains a static
   * background layer behind the nested Bible/Worship scene source. This keeps
   * scene switches from briefly revealing the underlying camera/content.
   */
  private async ensureFullscreenTargetBg(
    targetScene: string,
    overlaySourceName: string,
    themeSettings: Record<string, unknown> | null | undefined,
    enable = true,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    // Skip adding a fullscreen BG source into MCE Presentation — the BG
    // already lives inside the dedicated scene that is nested as a source.
    if (targetScene === PRESENTATION_SCENE_NAME) return;

    if (!themeSettings || !this.hasVisualBackground(themeSettings)) {
      await this.hideFullscreenBg(targetScene, resources);
      return;
    }

    const canvas = await this.getCanvasSize();
    const sourceName = this.getTargetFullscreenBgSourceName(targetScene, resources);
    const nativeBg = this._resolveNativeBackgroundSource(themeSettings, canvas);

    if (nativeBg) {
      await this._ensureNativeBackgroundSource(targetScene, sourceName, nativeBg, enable, canvas);
    } else {
      const { cleanSettings, css } = this.stripThemeDataUris(themeSettings);
      const signature = JSON.stringify({
        theme: cleanSettings ?? null,
        css: css || "",
      });
      const url = this.buildFullscreenBackgroundUrl(cleanSettings);

      await this.ensureOverlaySource(targetScene, sourceName, canvas.width, canvas.height, enable);
      if (this._lastTargetBgSignature[sourceName] !== signature) {
        await this.setBrowserSourceUrl(sourceName, url, false, css || undefined);
        this._lastTargetBgSignature[sourceName] = signature;
      }
    }
    await this._positionSceneLocalBgBelowSource(targetScene, sourceName, overlaySourceName);
  }

  /**
   * Position the background source just below the lowest visible overlay in
   * the OBS source stack, so it sits behind all overlays but above normal
   * scene content.
   */
  private async _positionBgBelowOverlays(
    sceneName: string,
    bgSceneItemId: number,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    try {
      const items = await this.getSceneItemListCached(sceneName);

      const overlayNames = new Set([
        resources.worshipSource,
        resources.ltSource,
        resources.tickerSource,
      ]);
      const overlayItems = items.filter((i) => overlayNames.has(i.sourceName));

      if (overlayItems.length === 0) return;

      // Put the background directly beneath the lowest overlay item while
      // keeping it above the rest of the scene content.
      const lowestOverlayIndex = Math.min(...overlayItems.map((i) => i.sceneItemIndex ?? 0));
      const targetIndex = Math.max(0, lowestOverlayIndex - 1);

      const bgItem = items.find((i) => i.sceneItemId === bgSceneItemId);
      if (bgItem && bgItem.sceneItemIndex !== targetIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: bgSceneItemId,
          sceneItemIndex: targetIndex,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * Place a scene-local fullscreen background directly beneath the nested
   * fullscreen scene source in the user's target scene.
   */
  private async _positionSceneLocalBgBelowSource(
    sceneName: string,
    bgSourceName: string,
    overlaySourceName: string,
  ): Promise<void> {
    try {
      let items = await this.getSceneItemListCached(sceneName);

      const overlayItem = items.find((item) => item.sourceName === overlaySourceName);
      const bgItem = items.find((item) => item.sourceName === bgSourceName);
      if (!overlayItem || !bgItem) return;

      const topIndex = Math.max(0, items.length - 1);
      if (overlayItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: overlayItem.sceneItemId,
          sceneItemIndex: topIndex,
        });
        this.invalidateSceneItemListCache(sceneName);
        items = await this.getSceneItemListCached(sceneName);
      }

      const refreshedOverlay = items.find((item) => item.sourceName === overlaySourceName);
      const refreshedBg = items.find((item) => item.sourceName === bgSourceName);
      if (!refreshedOverlay || !refreshedBg) return;

      const desiredBgIndex = Math.max(0, refreshedOverlay.sceneItemIndex! - 1);
      if (refreshedBg.sceneItemIndex !== desiredBgIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: refreshedBg.sceneItemId,
          sceneItemIndex: desiredBgIndex,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * Convert a CSS color (#RRGGBB or #RGB) to OBS's ABGR integer format.
   */
  private _cssColorToObsColor(cssColor: string): number {
    const hex = cssColor.replace("#", "");
    let r = 0, g = 0, b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // OBS uses ABGR format: 0xAABBGGRR
    return (0xFF << 24 | b << 16 | g << 8 | r) >>> 0;
  }

  /**
   * Hide the fullscreen background source in a scene.
   */
  private async hideFullscreenBg(
    sceneName: string,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    await this.hideOverlaySource(sceneName, resources.fsBgSource);
    await this.hideOverlaySource(sceneName, this.getTargetFullscreenBgSourceName(sceneName, resources));
  }

  // ── Theme resolution helpers ──

  /**
   * The lower-third catalog (~420 KB of theme HTML/CSS) is only needed when a
   * caller doesn't pass a theme. It loads after the Dock is up (see the idle
   * warm-up at the bottom of this file), not in the Dock's start-up bundle.
   */
  private static _lowerThirdCatalog: ThemeLike[] | null = null;
  private static _lowerThirdCatalogLoad: Promise<void> | null = null;

  static warmLowerThirdCatalog(): Promise<void> {
    DockObsClient._lowerThirdCatalogLoad ??= import("../lowerthirds/themes")
      .then(({ ALL_THEMES }) => { DockObsClient._lowerThirdCatalog = ALL_THEMES; })
      .catch(() => { DockObsClient._lowerThirdCatalogLoad = null; });
    return DockObsClient._lowerThirdCatalogLoad;
  }

  private resolveLTTheme(
    theme: DockLTThemeRef | undefined,
    context: "speaker" | "sermon" | "event" | "worship" | "bible" | "ticker" | "custom",
  ): DockLTThemeRef {
    if (theme) return theme;

    const contextHints: Record<typeof context, string[]> = {
      speaker: ["speaker", "pastor", "minister", "guest", "name", "title"],
      sermon: ["sermon", "sermon title", "title", "point", "quote", "scripture", "keyword"],
      event: ["event", "announcement", "highlight", "reminder", "date", "celebration"],
      worship: ["worship", "lyrics", "song", "chorus", "verse", "music"],
      bible: ["bible", "scripture", "verse", "reference", "word"],
      ticker: ["ticker", "news", "announcement", "headline"],
      custom: ["lower third", "headline", "subtitle", "title", "name", "keyword"],
    };

    const categoryHint =
      context === "worship" ? "worship" : context === "bible" ? "bible" : "";

    const hints = contextHints[context].map(normalizeThemeToken);
    const favoriteIds = getWorshipLTFavorites();

    const catalog = DockObsClient._lowerThirdCatalog;
    if (!catalog) {
      // Only in the first seconds after start-up: use the default theme and
      // load the catalog for the next call.
      void DockObsClient.warmLowerThirdCatalog();
      return getDefaultLTTheme();
    }
    let list = catalog.filter((t) => t.html && t.css);
    if (categoryHint) {
      list = list.filter((t) => normalizeThemeToken(String(t.category || "")) === categoryHint);
    }
    list = list.filter((t) => matchesThemeHints(t, hints));

    const favoriteMatches = list.filter((t) => favoriteIds.has(t.id));
    const customMatches = list.filter((t) => isLikelyCustomTheme(t));
    const fallback = favoriteMatches[0] ?? customMatches[0] ?? list[0];

    if (!fallback) return getDefaultLTTheme();
    return {
      id: fallback.id,
      html: fallback.html || getDefaultLTTheme().html,
      css: fallback.css || getDefaultLTTheme().css,
    };
  }

  // ── Overlay URL builders ──

  private getOverlayBaseUrl(): string {
    return getOverlayBaseUrlSync();
  }

  private isRemotePresentationSession(): boolean {
    return this._hasTransientExplicitConnection && !this._persistConnectionParams;
  }

  private async toRemoteServedMediaUrl(filePath: string, fileName: string): Promise<string> {
    const trimmed = String(filePath || "").trim();
    if (!trimmed) return "";

    if (/^(https?:|data:|blob:)/i.test(trimmed)) {
      return resolveOverlayAssetUrl(trimmed);
    }

    if (trimmed.startsWith("/uploads/") || trimmed.startsWith("uploads/")) {
      return resolveOverlayAssetUrl(trimmed);
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let targetHost = "";
      try {
        targetHost = new URL(this._url).hostname;
      } catch {
        targetHost = "";
      }
      return await invoke<string>("prepare_remote_media_url", {
        filePath: trimmed,
        fileName,
        targetHost: targetHost || undefined,
      });
    } catch {
      // Non-Tauri dock contexts cannot copy files. Fall back to the managed
      // uploads URL convention; this works for media already saved in uploads.
    }

    const withoutFileProtocol = trimmed.replace(/^file:\/\//i, "");
    const safeFileName = withoutFileProtocol.split(/[\\/]/).pop()?.trim() || "";
    if (!safeFileName) return trimmed;

    return `${this.getOverlayBaseUrl()}/uploads/${encodeURIComponent(safeFileName)}`;
  }

  /**
   * Make Bible background assets addressable from the OBS browser source.
   *
   * The Dock can persist either a managed `/uploads/...` URL, a local file
   * path, or (in older themes) only the file path. OBS cannot read the latter
   * directly, so prepare it through the overlay server before building the
   * packet. Keeping this at the packet boundary also fixes older imported
   * themes without changing how the picker stores its settings.
   */
  private async prepareBrowserThemeAssets(
    themeSettings: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!themeSettings) return null;

    const prepared = { ...themeSettings };
    const assets = [
      { urlKey: "backgroundImage", pathKey: "backgroundImageFilePath" },
      { urlKey: "backgroundVideo", pathKey: "backgroundVideoFilePath" },
    ] as const;

    for (const { urlKey, pathKey } of assets) {
      const value = String(prepared[urlKey] || "").trim();
      const filePath = String(prepared[pathKey] || "").trim();
      const candidate = value || filePath;
      if (!candidate || candidate === "__FROM_CSS__" || candidate === "__FROM_LOCALSTORAGE__") {
        continue;
      }

      if (/^(?:data:|blob:)/i.test(candidate)) continue;

      if (/^(?:https?:\/\/|\/?uploads\/)/i.test(candidate)) {
        prepared[urlKey] = candidate.startsWith("uploads/") ? `/${candidate}` : candidate;
        continue;
      }

      const isLocalFileReference = Boolean(filePath) || /^file:\/\//i.test(candidate)
        || /^[A-Za-z]:[\\/]/.test(candidate)
        || /^\/(?:Users|home|private|tmp|var)\//i.test(candidate);
      if (!isLocalFileReference) continue;

      const safeFileName = candidate
        .replace(/^file:\/\//i, "")
        .split(/[\\/]/)
        .pop()
        ?.trim() || "background-asset";
      const cacheKey = `${this._url}|${candidate}`;
      const cachedUrl = this._preparedBrowserThemeAssetUrls[cacheKey];
      if (cachedUrl) {
        prepared[urlKey] = cachedUrl;
        continue;
      }
      const servedUrl = await this.toRemoteServedMediaUrl(candidate, safeFileName).catch(() => "");
      if (servedUrl) {
        this._preparedBrowserThemeAssetUrls[cacheKey] = servedUrl;
        prepared[urlKey] = servedUrl;
      }
    }

    return prepared;
  }

  private buildOverlayHtmlUrl(
    fileName: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): string {
    return buildVersionedOverlayUrl(this.getOverlayBaseUrl(), fileName, query);
  }

  private buildCssOverlayHtmlUrlForTab(
    tab: "bible" | "worship" | "announcements" | "notes",
    sourceName?: string,
    mode?: "fullscreen" | "lower-third",
  ): string {
    const route = sourceName ? { mceSource: sourceName } : {};
    if (tab === "worship") return this.buildOverlayHtmlUrl("mce-worship-overlay.html", route);
    if (tab === "notes") return this.buildOverlayHtmlUrl("mce-note.html", route);
    return this.buildOverlayHtmlUrl("mce-bible-overlay.html", {
      tab,
      ...route,
      ...(mode ? { mode } : {}),
    });
  }

  private addOverlayDocumentSessionToken(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("mceReload", this._overlayDocumentSessionToken);
      return parsed.toString();
    } catch {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}mceReload=${encodeURIComponent(this._overlayDocumentSessionToken)}`;
    }
  }

  private extractCssCustomPropertyValue(cssText: string | undefined, name: string): string {
    if (!cssText) return "";
    const propertyIndex = cssText.indexOf(name);
    if (propertyIndex === -1) return "";
    const colonIndex = cssText.indexOf(":", propertyIndex + name.length);
    if (colonIndex === -1) return "";
    let i = colonIndex + 1;
    let quote = "";
    let parenDepth = 0;

    for (; i < cssText.length; i += 1) {
      const ch = cssText[i];
      const prev = i > 0 ? cssText[i - 1] : "";
      if (quote) {
        if (ch === quote && prev !== "\\") quote = "";
        continue;
      }
      if (ch === "\"" || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        parenDepth += 1;
        continue;
      }
      if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (ch === ";" && parenDepth === 0) break;
    }

    return cssText.slice(colonIndex + 1, i).trim();
  }

  private buildStandaloneOverlayPacket(
    packet: {
      slide: Record<string, unknown> | null;
      theme: Record<string, unknown> | null;
      live: boolean;
      blanked: boolean;
      timestamp: number;
      mode?: string;
    },
    css?: string,
  ): {
    slide: Record<string, unknown> | null;
    theme: Record<string, unknown> | null;
    live: boolean;
    blanked: boolean;
    timestamp: number;
    mode?: string;
  } {
    if (!packet.theme || !css) return packet;

    const theme = { ...packet.theme } as Record<string, unknown>;
    const bgImageCss = this.extractCssCustomPropertyValue(css, "--bg-image");
    const bgPatternCss = this.extractCssCustomPropertyValue(css, "--bg-pattern-data");
    const logoCss = this.extractCssCustomPropertyValue(css, "--logo-data-uri");
    const boxBgImageCss = this.extractCssCustomPropertyValue(css, "--box-bg-image");

    const unwrapCssUrl = (value: string): string => {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const match = trimmed.match(/^url\((.*)\)$/i);
      if (!match?.[1]) return trimmed;
      return match[1].trim().replace(/^['"]|['"]$/g, "");
    };

    if (theme.backgroundImage === "__FROM_CSS__" && bgImageCss) {
      theme.backgroundImage = unwrapCssUrl(bgImageCss);
    }
    if (theme.backgroundPattern === "__FROM_CSS__" && bgPatternCss) {
      theme.backgroundPattern = unwrapCssUrl(bgPatternCss);
    }
    if (theme.logoUrl === "__FROM_CSS__" && logoCss) {
      theme.logoUrl = unwrapCssUrl(logoCss);
    }
    if (theme.boxBackgroundImage === "__FROM_CSS__" && boxBgImageCss) {
      theme.boxBackgroundImage = unwrapCssUrl(boxBgImageCss);
    }

    return {
      ...packet,
      theme,
    };
  }

  /**
   * Presentation Studio: the overlay packet an MCE source would get for this content,
   * built with the same theme preparation as the fast OBS paths (dedicated lower-third
   * theme, data URIs re-inlined) but without touching OBS. Empty text = a clear packet.
   */
  buildStudioOverlayPacket(input: {
    text: string;
    reference: string;
    verseRange?: string;
    lineCount?: number;
    mode: "fullscreen" | "lower-third";
    themeSettings: Record<string, unknown> | null;
    /** Studio side-by-side Bible: the same verse(s) in two translations. */
    compare?: Array<{
      translation: string; reference: string; text: string; book: string; chapter: number;
      verse: number; verseEnd: number; verseRange: string;
    }>;
    /** "line-by-line" (one translation under the other) or "side-by-side"; side-by-side when not given. */
    compareLayout?: "line-by-line" | "side-by-side";
    /** "passages" = two different references side by side (always columns); "translations" when not given. */
    compareMode?: "translations" | "passages";
  }): { data: Record<string, unknown>; css: string } {
    let cleanTheme: Record<string, unknown> | null = null;
    let css = "";
    if (input.themeSettings) {
      const themeForClean = input.mode === "lower-third"
        ? (this.prepareDedicatedLowerThirdTheme(input.themeSettings).overlayTheme ?? input.themeSettings)
        : input.themeSettings;
      const stripped = this.stripThemeDataUris(themeForClean);
      cleanTheme = stripped.cleanSettings ?? null;
      css = stripCompatModeCSS(stripped.css);
    }
    const text = (input.text || "").trim();
    const compareColumns = (input.compare ?? []).slice(0, 2);
    const comparePassages = input.compareMode === "passages";
    const slide = text
      ? compareColumns.length === 2
        ? {
          id: "dock-bible-compare-slide",
          layout: "compare",
          compareEnabled: true,
          compareMode: comparePassages ? "passages" : "translations",
          compareLayout: !comparePassages && input.compareLayout === "line-by-line" ? "line-by-line" : "side-by-side",
          reference: input.reference,
          text,
          verseRange: input.verseRange ?? "",
          index: 0,
          total: 1,
          translationA: compareColumns[0].translation,
          translationB: compareColumns[1].translation,
          columns: compareColumns.map((column) => ({
            book: column.book,
            chapter: column.chapter,
            verse: column.verse,
            verseEnd: column.verseEnd,
            reference: column.reference,
            translation: column.translation,
            text: column.text,
            verseRange: column.verseRange,
          })),
        } as Record<string, unknown>
        : this.buildBibleSlide(text, input.reference, input.verseRange ?? "", "", "original-first", input.lineCount)
      : null;
    const timestamp = Date.now();
    const data = this.buildStandaloneOverlayPacket(
      { slide, theme: cleanTheme, live: true, blanked: false, timestamp, mode: input.mode },
      css,
    );
    return { data: { ...data, revision: timestamp }, css };
  }

  private publishFullscreenOverlayPacket(packet: {
    slide: Record<string, unknown> | null;
    theme: Record<string, unknown> | null;
    live: boolean;
    blanked: boolean;
    timestamp: number;
    mode?: string;
  }, tabType: "bible" | "worship" | "announcements" | "sermon" | "notes" = "bible", css?: string, targetSource?: string): void {
    const baseStorageKey = tabType === "notes"
      ? "notes-overlay-data"
      : tabType === "worship" || tabType === "announcements"
        ? "worship-overlay-data"
        : "bible-overlay-data";
    const baseChannelName = tabType === "notes"
      ? "obs-church-studio-notes-overlay"
      : tabType === "worship" || tabType === "announcements"
        ? "obs-church-studio-worship-overlay"
        : "obs-church-studio-bible-overlay";
    const routedSource = targetSource?.trim() || "";
    const storageKeys = routedSource
      ? [baseStorageKey, `${baseStorageKey}:${routedSource}`]
      : [baseStorageKey];
    const channelNames = routedSource
      ? [baseChannelName, `${baseChannelName}:${routedSource}`]
      : [baseChannelName];
    const standalonePacket = this.buildStandaloneOverlayPacket(packet, css);
    let serializedPacket = "";
    try {
      serializedPacket = JSON.stringify(standalonePacket);
    } catch {
      return;
    }
    for (const storageKey of storageKeys) {
      try {
        localStorage.setItem(storageKey, serializedPacket);
      } catch { /* ignore */ }
    }

    for (const channelName of channelNames) {
      try {
        const bc = new BroadcastChannel(channelName);
        bc.postMessage(standalonePacket);
        bc.close();
      } catch { /* ignore */ }
    }

    const bridgeChannel = tabType === "notes"
      ? "notes"
      : tabType === "worship" || tabType === "announcements"
        ? "worship"
        : "bible";
    // Use the packet's own timestamp as its revision (the same clock the OBS
    // event path uses) so an older packet can never outrank a newer click.
    const revision = Number(standalonePacket.timestamp) || Date.now();
    overlayBridge.publish({
      channel: bridgeChannel,
      type: "overlay-update",
      revision,
      ...(routedSource ? { targetSource: routedSource } : {}),
      data: { ...standalonePacket, revision },
      css,
    });
  }

  private publishBlankFullscreenOverlayPacket(
    tabType: "bible" | "worship" | "announcements" | "sermon" | "notes",
    mode: "fullscreen" | "lower-third" = "lower-third",
    targetSource?: string,
  ): void {
    this.publishFullscreenOverlayPacket({
      slide: null,
      theme: null,
      live: false,
      blanked: true,
      timestamp: Date.now(),
      mode,
    }, tabType, "", targetSource);
  }

  private getOverlayRenderAckStorageKey(
    tabType: CssOverlayPacketTab = "bible",
  ): string {
    if (tabType === "notes") return "notes-overlay-render-ack";
    if (tabType === "lower-third") return "lower-third-overlay-render-ack";
    return tabType === "worship" || tabType === "announcements"
      ? "worship-overlay-render-ack"
      : "bible-overlay-render-ack";
  }

  private async waitForOverlayRenderAckPacket(
    tabType: CssOverlayPacketTab,
    timestamp: number,
    mode: string,
    timeoutMs = 250,
    transitionId?: number,
    targetSource?: string,
    requireFontFitReady = false,
  ): Promise<BridgePacket | null> {
    const bridgeChannel = tabType === "notes"
      ? "notes"
      : tabType === "worship" || tabType === "announcements"
        ? "worship"
        : "bible";

    if (targetSource) {
      overlayBridge.connect();
      let acknowledged = overlayBridge.getLatestRenderAck(bridgeChannel, targetSource);
      if (
        acknowledged &&
        Number(acknowledged.timestamp) >= timestamp &&
        acknowledged.mode === mode &&
        (transitionId === undefined || acknowledged.transitionId === transitionId) &&
        (!requireFontFitReady || acknowledged.fontFitReady === true)
      ) {
        return acknowledged;
      }

      let resolved = false;
      const unsubscribe = overlayBridge.subscribe((packet) => {
        if (
          packet.type === "overlay-render-ack" &&
          packet.channel === bridgeChannel &&
          packet.targetSource === targetSource &&
          Number(packet.timestamp) >= timestamp &&
          packet.mode === mode &&
          (transitionId === undefined || packet.transitionId === transitionId) &&
          (!requireFontFitReady || packet.fontFitReady === true)
        ) {
          resolved = true;
        }
      });

      try {
        const deadline = Date.now() + timeoutMs;
        while (!resolved && Date.now() <= deadline) {
          acknowledged = overlayBridge.getLatestRenderAck(bridgeChannel, targetSource);
          if (
            acknowledged &&
            Number(acknowledged.timestamp) >= timestamp &&
            acknowledged.mode === mode &&
            (transitionId === undefined || acknowledged.transitionId === transitionId) &&
            (!requireFontFitReady || acknowledged.fontFitReady === true)
          ) {
            return acknowledged;
          }
          await this.sleep(16);
        }
        return resolved
          ? overlayBridge.getLatestRenderAck(bridgeChannel, targetSource)
          : null;
      } finally {
        unsubscribe();
      }
    }

    const storageKey = this.getOverlayRenderAckStorageKey(tabType);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as BridgePacket | null;
          if (
            parsed &&
            Number(parsed.timestamp) >= timestamp &&
            parsed.mode === mode &&
            (transitionId === undefined || parsed.transitionId === transitionId) &&
            (!requireFontFitReady || parsed.fontFitReady === true)
          ) {
            return parsed;
          }
        }
      } catch { /* ignore */ }

      await this.sleep(16);
    }

    return null;
  }

  private async waitForOverlayRenderAck(
    tabType: CssOverlayPacketTab,
    timestamp: number,
    mode: string,
    timeoutMs = 250,
    transitionId?: number,
    targetSource?: string,
  ): Promise<boolean> {
    return Boolean(await this.waitForOverlayRenderAckPacket(
      tabType,
      timestamp,
      mode,
      timeoutMs,
      transitionId,
      targetSource,
    ));
  }

  private async waitForOverlayRenderMeasurement(
    tabType: CssOverlayPacketTab,
    timestamp: number,
    mode: "fullscreen" | "lower-third",
    timeoutMs = 500,
    targetSource?: string,
  ): Promise<DockOverlayFontFitMeasurement | null> {
    const ack = await this.waitForOverlayRenderAckPacket(
      tabType,
      timestamp,
      mode,
      timeoutMs,
      undefined,
      targetSource,
      true,
    );
    if (!ack) return null;

    const measurement: DockOverlayFontFitMeasurement = { mode };
    const fontSize = Number(ack.effectiveFontSize);
    const refFontSize = Number(ack.effectiveRefFontSize);
    const translationFontSize = Number(ack.effectiveTranslationFontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) measurement.fontSize = fontSize;
    if (Number.isFinite(refFontSize) && refFontSize > 0) measurement.refFontSize = refFontSize;
    if (Number.isFinite(translationFontSize) && translationFontSize > 0) {
      measurement.translationFontSize = translationFontSize;
    }
    return measurement.fontSize || measurement.refFontSize || measurement.translationFontSize
      ? measurement
      : null;
  }

  /**
   * Build a lower-third overlay URL with proper theme HTML/CSS payload.
   *
   * NOTE: The `live` param here is ignored — we ALWAYS send `live: true`
   * to the overlay HTML so it renders visibly. Which OBS scene the source
   * lives in (Preview vs Program) is controlled by the caller; the overlay
   * itself should never self-hide based on `live`. Hiding is done via
   * `blanked: true` or by calling `hideOverlaySource`.
   */
  private buildLowerThirdUrl(
    values: Record<string, string>,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? getDefaultLTTheme();
    const payload = {
      themeId: t.id,
      html: t.html,
      css: [stripCompatModeCSS(t.css), buildDockFontFamilyCss(loadDockOutputFontFamily())]
        .filter(Boolean)
        .join("\n"),
      values,
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 65,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-left",
      animationIn: "slide-left",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.buildOverlayHtmlUrl("lower-third-overlay.html")}#data=${encoded}`;
  }

  private parseOverlayPayloadUrl(url: string): { baseUrl: string; payload: Record<string, unknown> } | null {
    if (!url || url === "about:blank" || !url.includes("#data=")) return null;

    try {
      const [baseUrl, encoded] = url.split("#data=");
      if (!baseUrl || !encoded) return null;
      const parsed = JSON.parse(decodeURIComponent(encoded));
      if (!parsed || typeof parsed !== "object") return null;
      return { baseUrl, payload: parsed as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  private buildOverlayUrlFromPayload(baseUrl: string, payload: Record<string, unknown>): string {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${baseUrl}#data=${encoded}`;
  }

  /** Keep routed browser sources independent from the shared MCE output. */
  private buildSceneRouteOverlayUrl(url: string, sourceName: string): string {
    const [documentUrl, hash = ""] = url.split("#", 2);
    const separator = documentUrl.includes("?") ? "&" : "?";
    return `${documentUrl}${separator}mceSource=${encodeURIComponent(sourceName)}${hash ? `#${hash}` : ""}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private buildMediaPatternUrl(patternSrc: string, patternLabel: string): string {
    const safeSrc = patternSrc.replace(/"/g, "&quot;");
    const safeLabel = this.escapeHtml(patternLabel);
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000;
    }
    body {
      position: relative;
      font-family: "Segoe UI", Arial, sans-serif;
    }
    img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: center;
    }
  </style>
</head>
<body>
  <img src="${safeSrc}" alt="${safeLabel}" />
</body>
</html>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  private async buildBlankedOverlayUrlFromCurrentSource(
    inputName: string,
    fallbackUrl: string,
  ): Promise<string> {
    try {
      const current = await this.call("GetInputSettings", { inputName }) as {
        inputSettings?: { url?: string };
      };
      const currentUrl = current.inputSettings?.url ?? "";
      const parsed = this.parseOverlayPayloadUrl(currentUrl);
      if (!parsed) return fallbackUrl;

      return this.buildOverlayUrlFromPayload(parsed.baseUrl, {
        ...parsed.payload,
        live: false,
        blanked: true,
        timestamp: Date.now(),
      });
    } catch {
      return fallbackUrl;
    }
  }

  private buildBibleSlide(
    text: string,
    reference: string,
    verseRange = "",
    translationText = "",
    translationOrder: DockTranslationOrder = "original-first",
    lineCount?: number,
  ): Record<string, unknown> {
    const slide: Record<string, unknown> = {
      id: "dock-bible-slide",
      text,
      reference,
      verseRange,
      index: 0,
      total: 1,
    };
    if (Number.isFinite(lineCount) && Number(lineCount) > 0) {
      slide.lineCount = Math.round(Number(lineCount));
    }
    const cleanTranslation = translationText.trim();
    if (cleanTranslation) {
      slide.translationText = cleanTranslation;
      slide.translationOrder = translationOrder;
    }
    return slide;
  }

  private formatBibleReferenceDisplayText(
    reference: string,
    translation: string,
    displayReferenceLabel?: string,
  ): string {
    if (typeof displayReferenceLabel === "string") {
      return displayReferenceLabel;
    }
    const ref = String(reference || "").trim();
    const version = String(translation || "").trim().toUpperCase();
    if (ref && version) {
      const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\(${escapedVersion}\\)$`).test(ref)) return ref;
      return `${ref} (${version})`;
    }
    return ref || version;
  }

  async primeBibleOverlay(data: PrimeBibleOverlayData): Promise<void> {
    return this.runSerializedBibleMutation(() => this.primeBibleOverlayInternal(data));
  }

  private async primeBibleOverlayInternal(data: PrimeBibleOverlayData): Promise<void> {
    const mode = data.overlayMode ?? "fullscreen";
    const verseRange = data.verseRange ?? (data.verse != null ? String(data.verse) : "");
    const ref = data.referenceLabel ?? (data.book ? `${data.book} ${data.chapter ?? ""}:${verseRange}` : "");
    const backgroundOnly = Boolean(data.backgroundOnly);
    const primaryText = backgroundOnly ? "" : (data.verseText || ref);
    const referenceText = backgroundOnly
      ? ""
      : this.formatBibleReferenceDisplayText(ref, data.translation || "", data.displayReferenceLabel);
    const displayVerseRange = backgroundOnly ? "" : verseRange;
    const compareEnabled = Boolean(data.compareEnabled || data.compare?.enabled);
    const compareMode = data.compare?.mode ?? data.compareMode ?? "translations";
    const compareLayout = data.compare?.layout ?? data.compareLayout ?? "line-by-line";
    const compareColumns = compareEnabled && Array.isArray(data.compare?.columns)
      ? data.compare.columns.filter(Boolean).slice(0, compareMode === "passages" ? 3 : 2)
      : [];
    const effectiveThemeSettings = await this.prepareBrowserThemeAssets(
      this.mergeThemeSettingsWithLiveOverrides(
        data.bibleThemeSettings,
        data.liveOverrides,
      ),
    );
    const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const themeCss = mode === "lower-third" ? stripCompatModeCSS(css) : css;
    const hasCompareSlide = compareMode === "passages"
      ? compareColumns.length >= 2
      : compareColumns.length === 2;
    const slide = hasCompareSlide
      ? {
        id: "dock-bible-compare-slide",
        layout: "compare",
        compareEnabled: true,
        compareLayout,
        reference: referenceText,
        text: primaryText,
        verseRange: displayVerseRange,
        index: 0,
        total: 1,
        lineCount: data.lineCount,
        translationA: data.translationA ?? compareColumns[0].translation,
        translationB: data.translationB ?? compareColumns[1].translation,
        columns: compareColumns.map((column) => ({
          book: column.book,
          chapter: column.chapter,
          verse: column.verse,
          verseEnd: column.verseEnd ?? column.verse,
          reference: backgroundOnly ? "" : column.referenceLabel,
          translation: column.translation,
          text: backgroundOnly ? "" : column.verseText,
          verseRange: backgroundOnly ? "" : (column.verseRange ?? ""),
        })),
      }
      : this.buildBibleSlide(primaryText, referenceText, displayVerseRange, "", "original-first", data.lineCount);
    const packet: Record<string, unknown> = {
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };
    const sourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
    const baseUrl = this.buildCssOverlayHtmlUrlForTab("bible", sourceName);

    this.publishFullscreenOverlayPacket({
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Number(packet.timestamp) || Date.now(),
      mode,
    }, "bible", themeCss, sourceName);
    await this.deliverCssOverlayPacket(sourceName, "bible", packet, baseUrl, themeCss).catch(() => { });
    await this.bringMceOverlayForward(sourceName).catch(() => { });
  }

  /**
   * A Dock refresh loses only this client's caches; OBS keeps the existing
   * Bible browser document and its active scene item. Re-adopt that document
   * and send the next packet straight to it instead of rebuilding the scene.
   */
  private async tryPushRestoredLiveBiblePacket(data: DockBiblePushData): Promise<boolean> {
    if (
      data.targetScene
      || readNativeDockSetting<unknown>(MCE_PRESENTATION_ACTIVE_MODULE_KEY) !== "bible"
    ) {
      return false;
    }

    const mode = data.overlayMode ?? "fullscreen";
    const sourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
    const baseUrl = this.buildCssOverlayHtmlUrlForTab("bible", sourceName);
    const canReuseLiveSource = this._restoredLiveBibleSource
      || await this.canReuseStableCssOverlaySource(sourceName, baseUrl).catch(() => false);
    if (!canReuseLiveSource) return false;

    const verseRange = data.verseRange ?? String(data.verse);
    const ref = data.referenceLabel ?? `${data.book} ${data.chapter}:${verseRange}`;
    const backgroundOnly = Boolean(data.backgroundOnly);
    const primaryText = backgroundOnly ? "" : (data.verseText || ref);
    const referenceText = backgroundOnly
      ? ""
      : this.formatBibleReferenceDisplayText(ref, data.translation, data.displayReferenceLabel);
    const displayVerseRange = backgroundOnly ? "" : verseRange;
    const compareEnabled = Boolean(data.compareEnabled || data.compare?.enabled);
    const compareMode = data.compare?.mode ?? data.compareMode ?? "translations";
    const compareLayout = data.compare?.layout ?? data.compareLayout ?? "line-by-line";
    const compareColumns = compareEnabled && Array.isArray(data.compare?.columns)
      ? data.compare.columns.filter(Boolean).slice(0, compareMode === "passages" ? 3 : 2)
      : [];
    const effectiveThemeSettings = await this.prepareBrowserThemeAssets(
      this.mergeThemeSettingsWithLiveOverrides(
        data.bibleThemeSettings,
        data.liveOverrides,
      ),
    );
    const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const themeCss = mode === "lower-third" ? stripCompatModeCSS(css) : css;
    const hasCompareSlide = compareMode === "passages"
      ? compareColumns.length >= 2
      : compareColumns.length === 2;
    const slide = hasCompareSlide
      ? {
        id: "dock-bible-compare-slide",
        layout: "compare",
        compareEnabled: true,
        compareMode,
        compareLayout,
        reference: referenceText,
        text: primaryText,
        verseRange: displayVerseRange,
        index: 0,
        total: 1,
        lineCount: data.lineCount,
        translationA: data.translationA ?? compareColumns[0].translation,
        translationB: data.translationB ?? compareColumns[1].translation,
        columns: compareColumns.map((column) => ({
          book: column.book,
          chapter: column.chapter,
          verse: column.verse,
          verseEnd: column.verseEnd ?? column.verse,
          reference: backgroundOnly ? "" : column.referenceLabel,
          translation: column.translation,
          text: backgroundOnly ? "" : column.verseText,
          verseRange: backgroundOnly ? "" : (column.verseRange ?? ""),
        })),
      }
      : this.buildBibleSlide(primaryText, referenceText, displayVerseRange, "", "original-first", data.lineCount);
    const packet: Record<string, unknown> = {
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };

    try {
      this.publishFullscreenOverlayPacket({
        slide,
        theme: cleanSettings ?? null,
        live: true,
        blanked: false,
        timestamp: Number(packet.timestamp) || Date.now(),
        mode,
      }, "bible", themeCss, sourceName);
      await this.deliverCssOverlayPacket(sourceName, "bible", packet, baseUrl, themeCss);
    } catch {
      this._restoredLiveBibleSource = false;
      return false;
    }

    this._restoredLiveBibleSource = true;
    this._lastBibleMode = mode;
    this._bibleLtInitialized = true;
    return true;
  }

  async primeWorshipOverlay(data: PrimeWorshipOverlayData): Promise<void> {
    return this.runSerializedWorshipMutation(() => this.primeWorshipOverlayInternal(data));
  }

  private async primeWorshipOverlayInternal(data: PrimeWorshipOverlayData): Promise<void> {
    // Notes are on air on the shared source: priming would replace them.
    if (this.isSharedWorshipNotesSourceHeldByOther("worship")) return;
    const mode = data.overlayMode ?? "fullscreen";
    const backgroundOnly = Boolean(data.backgroundOnly);
    const sectionText = backgroundOnly ? "" : (data.sectionText ?? "");
    const translationText = backgroundOnly ? "" : (data.translationText ?? "");
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );
    const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const themeCss = mode === "lower-third" ? stripCompatModeCSS(css) : css;
    const slide = this.buildBibleSlide(sectionText, this.tabLabel("worship", data, ""), "", translationText, data.translationOrder);
    const packet: Record<string, unknown> = {
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };
    const sourceName = getDockResources().worshipSource;
    const baseUrl = this.buildCssOverlayHtmlUrlForTab("worship", sourceName);

    if (await this.keepLoadedCssOverlaySourceStable(sourceName, "worship", packet, baseUrl, themeCss)) {
      // The page is already loaded, so nothing was sent. A background change still has to reach it:
      // a theme-only packet (no words) updates the look without putting anything on the screen.
      if (backgroundOnly) {
        this.publishFullscreenOverlayPacket({
          slide: null,
          theme: cleanSettings ?? null,
          live: true,
          blanked: false,
          timestamp: Number(packet.timestamp) || Date.now(),
          mode,
        }, "worship", themeCss, sourceName);
      }
      return;
    }

    this.publishFullscreenOverlayPacket({
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Number(packet.timestamp) || Date.now(),
      mode,
    }, "worship", themeCss, sourceName);
    await this.deliverCssOverlayPacket(sourceName, "worship", packet, baseUrl, themeCss).catch(() => { });
  }

  // ── Clear all overlays ──

  /**
   * Keep the legacy clear hook available for callers while leaving other
   * MCE sources untouched. Visibility is controlled explicitly by the
   * operator rather than by a hidden send-time preference.
   */
  async clearAllOverlays(
    keepSources: string | string[] | null = null,
    sceneName?: string,
    resources: DockResourceNames = DOCK_RESOURCES,
  ): Promise<void> {
    void keepSources;
    this._lastActivePresentationSource = null;
    this.invalidateActiveMceOverlayState(sceneName);
    if (resources.mediaScene && resources.mediaScene !== sceneName) {
      this.invalidateActiveMceOverlayState(resources.mediaScene);
    }
  }

  // ── High-level actions ──

  /**
   * Returns a browser-source name that belongs to one selected OBS scene.
   * These sources deliberately do not reuse MCE Presentation's inputs: OBS
   * inputs are global, so sharing one would make the two outputs mirror each
   * other even when the operator asked for independent content.
   */
  getSceneRouteSourceName(module: DockSceneRouteModule, sceneName: string, variant = "content"): string {
    const labelByModule: Record<DockSceneRouteModule, string> = {
      bible: "Bible",
      worship: "Worship",
      notes: "Notes",
      ticker: "Ticker",
      "lower-third": "Lower Third",
      countdown: "Countdown",
      time: "Time",
    };
    const safeScene = sceneName
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9 _.-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 56) || "Scene";
    const suffix = variant === "content" ? "" : ` ${variant}`;
    return `${labelByModule[module]}${suffix} - MCE ${safeScene}`;
  }

  private async pushSceneRouteBrowserSource(options: {
    module: DockSceneRouteModule;
    sceneName: string;
    url: string;
    css?: string;
    overlayPacket?: Record<string, unknown>;
    overlayTab?: CssOverlayPacketTab;
    sourceName?: string;
    width?: number;
    height?: number;
  }): Promise<string> {
    const sceneName = options.sceneName.trim();
    if (!sceneName) throw new Error("Select an OBS scene before sending.");
    const sourceName = options.sourceName ?? this.getSceneRouteSourceName(options.module, sceneName);
    const stableSourceUrl = this.buildSceneRouteOverlayUrl(options.url, sourceName);
    const sourceWasNotTracked = !Object.prototype.hasOwnProperty.call(
      this._lastBrowserSourceUrlBySource,
      sourceName,
    );
    const routePrepKey = `scene-route:${sceneName}:${sourceName}`;
    const routeWasRecentlyPrepared = (
      Date.now() - (this._lastFastOverlayPrepAtBySource[routePrepKey] || 0)
    ) < SCENE_ROUTE_SOURCE_RECONCILE_MS;
    const hasStableLoadedDocument = this.browserSourceUrlMatchesLoadedDocument(
      this._lastBrowserSourceUrlBySource[sourceName],
      stableSourceUrl,
    );
    const needsRouteReconciliation = !routeWasRecentlyPrepared || !hasStableLoadedDocument;
    if (needsRouteReconciliation) {
      await this.ensureOverlaySource(sceneName, sourceName, options.width, options.height, true);
    }

    // A routed overlay is a long-lived browser document. Rewriting its source
    // settings for every verse makes OBS restart CEF repeatedly, which turns
    // a normal slide change into a growing multi-minute queue. Only bootstrap
    // or repair the document when the URL itself actually changed; every
    // routine update below is an in-place obs-browser packet.
    const documentNeedsLoad = needsRouteReconciliation
      ? await this.hasBrowserSourceUrlChanged(sourceName, stableSourceUrl)
      : false;
    const sourceUrl = documentNeedsLoad && sourceWasNotTracked && options.overlayPacket
      ? this.addOverlayDocumentSessionToken(stableSourceUrl)
      : stableSourceUrl;
    // OBS CEF can retain a document with a changed URL hash but never apply
    // the encoded packet, leaving a blank routed source. Keep one small,
    // stable document and target the live packet to this source instead.
    if (documentNeedsLoad) {
      await this.setBrowserSourceUrl(
        sourceName,
        sourceUrl,
        false,
        options.css,
      );
    }
    if (options.overlayPacket && options.overlayTab) {
      // A source created or reloaded by SetInputSettings needs time to attach
      // the event listener before OBS dispatches the first packet. Established
      // route sources do not reload, so they must not pay this delay per verse.
      if (documentNeedsLoad) await this.sleep(220);
      const emitted = await this.emitBrowserOverlayPacket(
        options.overlayTab,
        options.overlayPacket,
        options.css ?? "",
        sourceName,
      );
      if (!emitted) {
          // Compatibility fallback for OBS builds without obs-browser events.
          await this.setBrowserSourceUrl(
            sourceName,
            this.buildOverlayUrlFromPayload(stableSourceUrl, options.overlayPacket),
            false,
            options.css,
        );
      }
    }
    // Always ensure the source is visible and correctly stacked in the target scene
    await this.ensureSceneItemVisibleAndStacked(sceneName, sourceName).catch(() => { });
    if (needsRouteReconciliation) {
      this._lastFastOverlayPrepAtBySource[routePrepKey] = Date.now();
    }
    return sourceName;
  }

  async clearSceneRouteSource(module: DockSceneRouteModule, sceneName: string, variant = "content"): Promise<void> {
    const target = sceneName.trim();
    if (!target) return;
    const sourceName = this.getSceneRouteSourceName(module, target, variant);
    if (module === "lower-third") await this.emptyLowerThirdPage(sourceName);
    await this.hideOverlaySource(target, sourceName).catch(() => { });
  }

  /** Ministry lower-third tabs: one shared OBS source (the default) or a source for each tab. */
  setLowerThirdPerTabSources(on: boolean): void {
    if (this._ltPerTabSources === on) return;
    this._ltPerTabSources = on;
    this.invalidateActiveMceOverlayState();
  }

  /** The OBS source a Ministry lower-third tab uses (the shared one unless each tab has its own). */
  lowerThirdSourceForTab(tabId: string, isFirstTab: boolean): string {
    if (!this._ltPerTabSources || isFirstTab) return getDockResources().ltSource;
    return `MCE LT: Tab ${tabId.slice(-6)}`;
  }

  /** Is this lower-third source switched on in its OBS scene right now? */
  async isLowerThirdSourceShowing(sourceName?: string): Promise<boolean> {
    try {
      const target = await this.getPresentationTargetScene("lower-third");
      if (!target.sceneName) return false;
      const item = await this.getSceneItemBySource(target.sceneName, sourceName ?? getDockResources().ltSource);
      return Boolean(item && (item as { sceneItemEnabled?: boolean }).sceneItemEnabled !== false);
    } catch {
      return false;
    }
  }

  /** With a source per tab, each page only listens to packets meant for its own source. */
  private routeLowerThirdUrl(url: string, sourceName: string): string {
    if (!this._ltPerTabSources || /[?&]mceSource=/.test(url.split("#")[0])) return url;
    return this.buildSceneRouteOverlayUrl(url, sourceName);
  }

  /**
   * Empty a lower-third page and give OBS a moment to draw that empty frame. OBS shows a
   * hidden browser source's last picture again when it is turned back on, so hiding it
   * while an exit is still playing brings the old graphic back on the next Send.
   */
  private async emptyLowerThirdPage(sourceName: string): Promise<void> {
    try {
      const cleared = await this.emitBrowserOverlayPacket("lower-third", { action: "clear", timestamp: Date.now() }, "", sourceName);
      if (cleared) await this.sleep(LT_EMPTY_FRAME_MS);
    } catch { /* hiding still goes ahead */ }
  }

  async pushBibleToScene(
    data: DockBiblePushData,
    sceneName: string,
    sourceModule: "bible" | "lower-third" = "bible",
  ): Promise<void> {
    return this.runSerializedBibleMutation(() => this.pushBibleToSceneInternal(data, sceneName, sourceModule));
  }

  /**
   * Push routed Bible targets as one latest-only mutation. Calling
   * pushBibleToScene once per target in parallel would make the shared
   * latest-update queue discard every target except the last one.
   */
  async pushBibleToScenes(
    targets: Array<{
      data: DockBiblePushData;
      sceneName: string;
      sourceModule?: "bible" | "lower-third";
    }>,
  ): Promise<void> {
    if (targets.length === 0) return;
    return this.runSerializedBibleMutation(async () => {
      for (const target of targets) {
        await this.pushBibleToSceneInternal(target.data, target.sceneName, target.sourceModule ?? "bible");
      }
    });
  }

  private async pushBibleToSceneInternal(
    data: DockBiblePushData,
    sceneName: string,
    sourceModule: "bible" | "lower-third" = "bible",
  ): Promise<void> {
      const mode = data.overlayMode ?? "fullscreen";
      const verseRange = data.verseRange ?? String(data.verse);
      const reference = data.referenceLabel ?? `${data.book} ${data.chapter}:${verseRange}`;
      const backgroundOnly = Boolean(data.backgroundOnly);
      const text = backgroundOnly ? "" : (data.verseText || reference);
      const referenceText = backgroundOnly
        ? ""
        : this.formatBibleReferenceDisplayText(reference, data.translation, data.displayReferenceLabel);
      try {
        const refLabel = referenceText || reference;
        const hasTranslation = Boolean(data.translation && new RegExp(`\\(${data.translation}\\)$`, "i").test(refLabel.trim()));
        const label = hasTranslation || !data.translation ? refLabel : `${refLabel} (${data.translation})`;
        recordPresentationHistory({
          type: "bible",
          sourceKind: "bible-reference",
          label: label.replace(/(\([A-Za-z0-9_/-]+\))(?:\s*\1)+/gi, "$1").trim(),
          subtitle: (text || refLabel).slice(0, 200),
          notes: data.translation,
          payloadSnapshot: {
            ...data,
            overlayMode: mode,
          },
          overlayMode: mode,
        });
      } catch {
        // Ignore history recording failures
      }
      const compareEnabled = Boolean(data.compareEnabled || data.compare?.enabled);
      const compareMode = data.compare?.mode ?? data.compareMode ?? "translations";
      const compareLayout = data.compare?.layout ?? data.compareLayout ?? "line-by-line";
      const compareColumns = compareEnabled && Array.isArray(data.compare?.columns)
        ? data.compare.columns.filter(Boolean).slice(0, compareMode === "passages" ? 3 : 2)
        : [];

      const effectiveThemeSettings = await this.prepareBrowserThemeAssets(
        this.mergeThemeSettingsWithLiveOverrides(
          data.bibleThemeSettings,
          data.liveOverrides,
        ),
      );
      const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
        ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
        : effectiveThemeSettings;
      const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
      const hasCompareSlide = compareMode === "passages"
        ? compareColumns.length >= 2
        : compareColumns.length === 2;
      const slide = hasCompareSlide
        ? {
          id: "dock-bible-route-compare-slide",
          layout: "compare",
          compareEnabled: true,
          compareMode,
          compareLayout,
          reference: referenceText,
          text,
          verseRange: backgroundOnly ? "" : verseRange,
          index: 0,
          total: 1,
          lineCount: data.lineCount,
          translationA: data.translationA ?? compareColumns[0].translation,
          translationB: data.translationB ?? compareColumns[1].translation,
          columns: compareColumns.map((column) => ({
            book: column.book,
            chapter: column.chapter,
            verse: column.verse,
            verseEnd: column.verseEnd ?? column.verse,
            reference: backgroundOnly ? "" : column.referenceLabel,
            translation: column.translation,
            text: backgroundOnly ? "" : column.verseText,
            verseRange: backgroundOnly ? "" : (column.verseRange ?? ""),
          })),
        }
        : this.buildBibleSlide(text, referenceText, backgroundOnly ? "" : verseRange, "", "original-first", data.lineCount);
      const packet: Record<string, unknown> = {
        slide,
        theme: cleanSettings ?? null,
        live: true,
        blanked: false,
        timestamp: Date.now(),
        mode,
      };
      const baseUrl = this.buildOverlayHtmlUrl("mce-bible-overlay.html", { tab: "bible" });
      const sourceName = this.getSceneRouteSourceName(sourceModule, sceneName);
      if (compareEnabled) {
        await this.hideLegacyBibleContentSources(sceneName, sourceName);
      }
      await this.pushSceneRouteBrowserSource({
        module: sourceModule,
        sceneName,
        sourceName,
        url: baseUrl,
        overlayPacket: packet,
        overlayTab: "bible",
        css: this.buildCssOverlayDataCss(packet, css),
      });
      this.rememberCssOverlayTransport(sourceName, packet, baseUrl, css, "bible");
  }

  private async pushTabContentToScene(
    data: DockTabContentPushData,
    tab: "worship" | "notes",
    sceneName: string,
  ): Promise<void> {
    const mode = data.overlayMode ?? "lower-third";
    try {
      const vals = (data.values || {}) as Record<string, unknown>;
      if (tab === "worship") {
        const songTitle = (vals.title as string) || (vals.songTitle as string) || "Worship";
        const sectionLabel = (vals.sectionLabel as string) || (vals.header as string) || "";
        const label = sectionLabel ? `${songTitle} · ${sectionLabel}` : String(songTitle);
        const text = (vals.lyrics as string) || (vals.text as string) || "";
        const snippet = String(text).split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
        recordPresentationHistory({
          type: "worship",
          sourceKind: "worship-song-section",
          label,
          subtitle: snippet,
          payloadSnapshot: {
            ...vals,
            sectionText: text,
            sectionLabel,
            songTitle,
            overlayMode: mode,
          },
          overlayMode: mode,
        });
      } else if (tab === "notes") {
        const noteTitle = (vals.title as string) || "Note";
        const text = (vals.text as string) || (vals.notes as string) || "";
        const snippet = String(text).split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
        recordPresentationHistory({
          type: "sermon",
          sourceKind: "sermon-point",
          label: String(noteTitle),
          subtitle: snippet,
          payloadSnapshot: {
            ...vals,
            isNoteSlide: true,
            slideText: text,
            noteTitle,
            overlayMode: mode,
          },
          overlayMode: mode,
        });
      }
    } catch {
      // Ignore
    }
    const sourceName = this.getSceneRouteSourceName(tab, sceneName);
    if (mode === "lower-third" && data.ltTheme) {
      await this.pushSceneRouteBrowserSource({
        module: tab,
        sceneName,
        sourceName,
        url: this.buildLowerThirdUrl(data.values ?? {}, false, false, data.ltTheme),
      });
      return;
    }

    const backgroundOnly = Boolean(data.backgroundOnly);
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );
    const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const sectionText = backgroundOnly ? "" : data.sectionText;
    const translationText = backgroundOnly ? "" : (data.translationText ?? "");
    const sectionLabel = backgroundOnly || tab === "worship" ? "" : cleanWorshipObsLabel(data.sectionLabel);
    const packet: Record<string, unknown> = {
      slide: sectionText ? {
        id: `dock-${tab}-route-slide`,
        reference: this.tabLabel(tab, data, ""),
        text: sectionText,
        translationText,
        translationOrder: data.translationOrder ?? "original-first",
        verseRange: sectionLabel,
        index: 0,
        total: 1,
      } : null,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };
    const baseUrl = this.buildCssOverlayHtmlUrlForTab(tab);
    const themeCss = mode === "lower-third" ? stripCompatModeCSS(css) : css;
    await this.pushSceneRouteBrowserSource({
      module: tab,
      sceneName,
      sourceName,
      url: baseUrl,
      overlayPacket: packet,
      overlayTab: tab,
      css: this.buildCssOverlayDataCss(packet, themeCss),
    });
    this.rememberCssOverlayTransport(sourceName, packet, baseUrl, themeCss, tab);
  }

  async pushWorshipToScene(data: DockTabContentPushData, sceneName: string): Promise<void> {
    return this.runSerializedWorshipMutation(() => this.pushTabContentToScene(data, "worship", sceneName));
  }

  async pushNotesToScene(data: DockTabContentPushData, sceneName: string): Promise<void> {
    return this.runSerializedNotesMutation(() => this.pushTabContentToScene(data, "notes", sceneName));
  }

  async pushLowerThirdOverlayUrlToScene(
    url: string,
    sceneName: string,
    options?: { sourceWidth?: number; sourceHeight?: number },
  ): Promise<void> {
    const parsed = this.parseOverlayPayloadUrl(url);
    if (parsed) {
      const sourceName = this.getSceneRouteSourceName("lower-third", sceneName);
      await this.pushSceneRouteBrowserSource({
        module: "lower-third",
        sceneName,
        sourceName,
        // OBS can keep a browser document alive while ignoring a new URL
        // hash. Sending the full payload to the named source makes every
        // explicit Send apply its size, values, and theme reliably.
        url: parsed.baseUrl,
        overlayPacket: parsed.payload,
        overlayTab: "lower-third",
        css: this.buildCssOverlayDataCss(parsed.payload, ""),
        width: options?.sourceWidth,
        height: options?.sourceHeight,
      });
      this.rememberCssOverlayTransport(sourceName, parsed.payload, parsed.baseUrl, "", "lower-third");
      return;
    }

    await this.pushSceneRouteBrowserSource({
      module: "lower-third",
      sceneName,
      url,
      width: options?.sourceWidth,
      height: options?.sourceHeight,
    });
  }

  /**
   * Send a live Timer or Clock document to one OBS scene. Once the browser
   * source is prepared, control changes are delivered as a small in-place
   * packet instead of restarting the OBS browser page.
   */
  async pushTimeOverlayToScene(
    data: DockTimeOverlayData,
    sceneName: string,
    options?: { sourceName?: string },
  ): Promise<string> {
    const targetScene = sceneName.trim();
    const sourceName = options?.sourceName ?? this.getSceneRouteSourceName("time", targetScene);
    const canvas = await this.getCanvasSize();
    const packet: DockTimeOverlayData = {
      ...data,
      timestamp: Date.now(),
    };
    const source = await this.pushSceneRouteBrowserSource({
      module: "time",
      sceneName: targetScene,
      sourceName,
      url: this.buildOverlayHtmlUrl("time-overlay.html"),
      overlayPacket: { ...packet },
      overlayTab: "time",
      width: canvas.width,
      height: canvas.height,
    });

    if (targetScene === PRESENTATION_SCENE_NAME) {
      await this.applyMcePresentationSourceVisibility(source).catch(() => { });
    }

    return source;
  }

  async clearTimeOverlayFromScene(
    sceneName: string,
    options?: { sourceName?: string },
  ): Promise<void> {
    const targetScene = sceneName.trim();
    if (!targetScene) return;
    const sourceName = options?.sourceName ?? this.getSceneRouteSourceName("time", targetScene);
    await this.hideOverlaySource(targetScene, sourceName).catch(() => { });
  }

  /**
   * Push a Bible verse to OBS as an overlay.
   *
   * **Fullscreen mode**: Uses the unified `MCE Browser - Bible` source in
   * `MCE Presentation`; the browser source renders both text and background.
   *
   * **Lower-third mode**: Uses a direct browser source in the user's
   * scene (lightweight, no background needed).
   */
  async pushBible(
    data: DockBiblePushData,
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    return this.runSerializedBibleMutation(async () => {
      const resources = getDockResources();
      if (await this.tryPushRestoredLiveBiblePacket(data)) return;
      // OBS scene-change events keep this cache current. Re-querying OBS for
      // every verse adds one more request to the live projection path and can
      // compound into a long backlog on a busy service computer.
      const currentProgramSceneBeforeTarget = await this.getCurrentProgramSceneName().catch(() => "");
      // Fullscreen Bible goes straight into MCE Presentation and therefore
      // does not pass through getPresentationTargetScene(), which is where
      // the other Bible route normally records the pre-push Program scene.
      // Record it here so clearBible() can honor the sidebar restore option.
      this.rememberUserScene(currentProgramSceneBeforeTarget, "bible");
      let sceneName: string;

      // Detect mode switch early. Keep the active sources in place and only
      const mode = data.overlayMode ?? "fullscreen";
      this.noteIntendedMceMode(this._fullscreenSceneDefs["bible"]?.browserSourceName, mode);
      try {
        const refLabel = data.rawReferenceLabel || `${data.book} ${data.chapter}:${data.verseRange || data.verse}`;
        const hasTranslation = Boolean(data.translation && new RegExp(`\\(${data.translation}\\)$`, "i").test(refLabel.trim()));
        const label = hasTranslation || !data.translation ? refLabel : `${refLabel} (${data.translation})`;
        recordPresentationHistory({
          type: "bible",
          sourceKind: "bible-reference",
          label: label.replace(/(\([A-Za-z0-9_/-]+\))(?:\s*\1)+/gi, "$1").trim(),
          subtitle: (data.verseText || refLabel).slice(0, 200),
          notes: data.translation,
          payloadSnapshot: {
            ...data,
            overlayMode: mode,
          },
          overlayMode: mode,
        });
      } catch {
        // Ignore history recording failures
      }
      const bibleBrowserSourceName = this._fullscreenSceneDefs["bible"]?.browserSourceName;
      const isFirstLowerThirdBootstrap = mode === "lower-third"
        && (
          !this._bibleLtInitialized
          || !bibleBrowserSourceName
          || !Object.prototype.hasOwnProperty.call(
            this._lastBrowserSourceUrlBySource,
            bibleBrowserSourceName,
          )
        );
      const prevMode = this._lastBibleMode;
      const modeChanged = prevMode !== "" && prevMode !== mode;
      if (modeChanged) {
        this._lastBiblePushSignature = "";
        this._lastBibleFullscreenSetupSignature = "";
        this._bibleLtInitialized = false;
      }

      if (data.targetScene) {
        // Custom target scene — ensure it exists, skip clone logic
        sceneName = data.targetScene;
        if (!await this.hasObsScene(sceneName).catch(() => false)) {
          await this.call("CreateScene", { sceneName })
            .then(() => { this._knownScenes.add(sceneName); })
            .catch(() => { });
        }
        if (await this.isStudioModeEnabled().catch(() => false)) {
          // Save original preview scene before switching to custom target
          const originalPreview = await this.getCurrentPreviewSceneName().catch(() => "");
          await this.setCurrentPreviewScene(sceneName);
          this.setPreviewSceneState(originalPreview, sceneName, "custom-target");
        }
      } else {
        // Fullscreen adds MCE Browser - Bible inside MCE Presentation (no separate scene).
        // Lower-third uses the standard clone/preview flow.
        if (data.overlayMode === "fullscreen") {
          // Fullscreen mode: always use MCE Presentation scene
          sceneName = PRESENTATION_SCENE_NAME;
        } else {
          const target = await this.getPresentationTargetScene("bible", { activate: false });
          sceneName = target.sceneName;
        }
      }

      if (!sceneName) throw new Error("Could not determine the current OBS scene.");

      // Wire the current Program scene behind the overlay only when the
      // route actually changes. Repeating this scene mutation for every verse
      // can make OBS redraw the whole presentation frame.
      if (!data.targetScene && currentProgramSceneBeforeTarget !== this._lastBibleProgramScenePrepared) {
        // Fullscreen Bible writes directly to MCE Presentation, so it does
        // not pass through getPresentationTargetScene(), which already opts
        // into the non-Studio-Mode path. Pass the captured Program scene
        // explicitly so the Program background setting is honored there too.
        await this.ensureProgramSceneAsSourceInPresentation(true, {
          allowWithoutStudioMode: mode === "fullscreen",
          programSceneName: mode === "fullscreen" ? currentProgramSceneBeforeTarget : undefined,
        });
        this._lastBibleProgramScenePrepared = currentProgramSceneBeforeTarget;
      }

      const pushSignature = this.buildBiblePushSignature(sceneName, currentProgramSceneBeforeTarget, data);
      if (pushSignature === this._lastBiblePushSignature) {
        // Recover from manual OBS source deletion even when the verse payload
        // itself did not change and would normally be deduped away.
        const browserSrc = this._fullscreenSceneDefs["bible"]?.browserSourceName;
        if (browserSrc) {
          const sourceScene = mode === "fullscreen" ? PRESENTATION_SCENE_NAME : sceneName;
          if (mode === "fullscreen") {
            // Rebuild the fullscreen scene structure when MCE Presentation
            // was deleted in OBS so the cached theme/background state can be
            // applied to a fresh browser source.
            this._lastFullscreenSceneItemSignature[browserSrc] = "";
            await this._ensureFullscreenScene("bible", mode).catch(() => { });
            await this.ensureActiveMceOverlaySource(
              PRESENTATION_SCENE_NAME,
              browserSrc,
              [browserSrc],
              resources,
            ).catch(() => { });
          } else {
            await this._ensureFullscreenScene("bible", mode).catch(() => { });
            await this.ensureOverlaySource(sourceScene, browserSrc, undefined, undefined, true).catch(() => { });
          }
          const cachedPacket = this._lastCssOverlayPacketBySource[browserSrc];
          const cachedBaseUrl = this._lastCssOverlayBaseUrlBySource[browserSrc];
          if (cachedPacket && cachedBaseUrl) {
            await this.deliverCssOverlayPacket(
              browserSrc,
              "bible",
              // Fresh timestamp: the overlay only accepts packets at least as new
              // as the last one it saw (e.g. after a blank/clear).
              { ...cachedPacket, timestamp: Date.now() },
              cachedBaseUrl,
              this._lastCssOverlayThemeCssBySource[browserSrc] || "",
            ).catch(() => { });
          }
          await this.fitSceneSourceToOverlayMode(sourceScene, browserSrc, mode).catch(() => { });
          await this.ensureTickerAboveSource(sceneName, browserSrc).catch(() => { });
        }
        return;
      }

      const verseRange = data.verseRange ?? String(data.verse);
      const ref = data.referenceLabel ?? `${data.book} ${data.chapter}:${verseRange}`;
      const backgroundOnly = Boolean(data.backgroundOnly);
      const primaryText = backgroundOnly ? "" : (data.verseText || ref);
      const referenceText = backgroundOnly
        ? ""
        : this.formatBibleReferenceDisplayText(ref, data.translation, data.displayReferenceLabel);
      const displayVerseRange = backgroundOnly ? "" : verseRange;
      const compareEnabled = Boolean(data.compareEnabled || data.compare?.enabled);
      const compareMode = data.compare?.mode ?? data.compareMode ?? "translations";
      const compareLayout = data.compare?.layout ?? data.compareLayout ?? "line-by-line";
      const compareColumns = compareEnabled && Array.isArray(data.compare?.columns)
        ? data.compare.columns.filter(Boolean).slice(0, compareMode === "passages" ? 3 : 2)
        : [];

      // Compare passages replaces the single-verse output. Clean up any
      // legacy Bible content layers in both the shared presentation and the
      // current target scene before the unified browser source is updated.
      if (compareEnabled) {
        const activeBibleSourceName = bibleBrowserSourceName ?? FULLSCREEN_SOURCE_NAMES.BIBLE;
        const cleanupScenes = [...new Set([PRESENTATION_SCENE_NAME, sceneName])];
        await Promise.all(cleanupScenes.map((target) => (
          this.hideLegacyBibleContentSources(target, activeBibleSourceName)
        )));
      }
      const effectiveThemeSettings = await this.prepareBrowserThemeAssets(
        this.mergeThemeSettingsWithLiveOverrides(
          data.bibleThemeSettings,
          data.liveOverrides,
        ),
      );

      // Update mode tracking (modeChanged was computed earlier for clone cleanup)
      this._lastBibleMode = mode;

      let url = "";
      let themeCss = "";
      let cssOverlayPacket: Record<string, unknown> | null = null;
      let cssOverlayBaseUrl = "";
      let useCssOverlayTransport = false;
      if (mode === "lower-third") {
        // ── Lower-third: same unified bible browser source as fullscreen ──
        // Uses tab=bible + packet.mode so mce-bible-overlay can morph Full ↔ LT
        // in-place (bible_song-style) instead of hard-cutting between sources.
        const fsDef = this._fullscreenSceneDefs["bible"];
        const browserSourceName = fsDef.browserSourceName;
        const userScene = currentProgramSceneBeforeTarget || sceneName;

        // Ensure the unified source exists.
        if (modeChanged || !this._bibleLtInitialized || !this._lastFullscreenSceneItemSignature[browserSourceName]) {
          // On a visible Full -> Lower third switch keep the source on: the overlay
          // page only plays its morph while OBS reports the source as visible.
          // (Turning it off here and back on after the packet is a hard cut.)
          await this._ensureFullscreenScene("bible", mode, modeChanged ? "keep" : false);
        }

        const hasCompareSlide = compareMode === "passages"
          ? compareColumns.length >= 2
          : compareColumns.length === 2;
        const compareSlide = hasCompareSlide
          ? {
            id: "dock-bible-compare-slide",
            layout: "compare",
            compareEnabled: true,
            compareMode,
            compareLayout,
            reference: referenceText,
            text: primaryText,
            verseRange: displayVerseRange,
            index: 0,
            total: 1,
            translationA: data.translationA ?? compareColumns[0].translation,
            translationB: data.translationB ?? compareColumns[1].translation,
            columns: compareColumns.map((column) => ({
              book: column.book,
              chapter: column.chapter,
              verse: column.verse,
              verseEnd: column.verseEnd ?? column.verse,
              reference: backgroundOnly ? "" : column.referenceLabel,
              translation: column.translation,
              text: backgroundOnly ? "" : column.verseText,
              verseRange: backgroundOnly ? "" : (column.verseRange ?? ""),
            })),
          }
          : null;

        if (effectiveThemeSettings) {
          const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings);

          if (modeChanged) this._bibleLtInitialized = false;

          if (!this._bibleLtInitialized) {
            // Clean up any leftover fullscreen scene sources from previous mode
            const fsDef = this._fullscreenSceneDefs["bible"];
            // MCE Presentation may be the intentional last-added layer inside
            // a managed Multiview scene. It is not a temporary Bible source
            // and must remain in that scene while lower-third initializes.
            if (fsDef && !DockObsClient.isManagedMultiviewSceneName(userScene)) {
              try {
                const resp = await this.call("GetSceneItemList", { sceneName: userScene }) as {
                  sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
                };
                const fsItems = resp.sceneItems.filter((i) => i.sourceName.startsWith(fsDef.sceneName));
                for (const item of fsItems) {
                  await this.call("RemoveSceneItem", { sceneName: userScene, sceneItemId: item.sceneItemId });
                }
              } catch { /* ignore */ }
            }

            // Hide any leftover dedicated scene
            await this.hideSceneSource(sceneName, resources.bibleScene);
            await this.hideFullscreenBg(sceneName, resources);

            // Add the unified source to user's scene (source stays in MCE Presentation too — CSS handles mode)
            await this.ensureOverlaySource(sceneName, browserSourceName, undefined, undefined, false);
            await this.ensureTickerAboveSource(sceneName, browserSourceName, { leaveVisibility: true });

            // Render background via the browser overlay CSS instead of a
            // separate OBS background source so the browser + background
            // are a single unified source in OBS.
            await this._hideLowerThirdBgSource(sceneName).catch(() => { });

            this._bibleLtInitialized = true;
          } else {
            // Fast path: source already set up, just update BG if theme changed
            // Background is rendered by the browser overlay CSS; hide any
            // lower-third BG inputs to avoid duplicate layers.
            await this._hideLowerThirdBgSource(sceneName).catch(() => { });
          }

          // Recover if the shared browser source was manually deleted in OBS.
          await this.ensureOverlaySource(sceneName, browserSourceName, undefined, undefined, false);

          const { cleanSettings: ltClean, css } = this.stripThemeDataUris(overlayTheme);
          themeCss = css;
          const slide = compareSlide ?? this.buildBibleSlide(primaryText, referenceText, displayVerseRange, "", "original-first", data.lineCount);
          cssOverlayPacket = {
            slide,
            theme: ltClean ?? null,
            live: true,
            blanked: false,
            timestamp: Date.now(),
            mode,
          };
          // Unified bible overlay document — packet.mode drives lower-third layout + morph.
          cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab("bible", browserSourceName);
          useCssOverlayTransport = true;
          url = `${cssOverlayBaseUrl}#data=${encodeURIComponent(JSON.stringify(cssOverlayPacket))}`;
        } else {
          // ── Lower-third without theme settings: same unified fullscreen HTML ──
          // Add to user's scene (source stays in MCE Presentation too — CSS handles mode)
          if (!this._bibleLtInitialized) {
            await this.ensureOverlaySource(sceneName, browserSourceName, undefined, undefined, false);
            await this.ensureTickerAboveSource(sceneName, browserSourceName, { leaveVisibility: true });
          }

          const slide = compareSlide ?? this.buildBibleSlide(primaryText, referenceText, displayVerseRange, "", "original-first", data.lineCount);
          cssOverlayPacket = {
            slide,
            theme: null,
            live: true,
            blanked: false,
            timestamp: Date.now(),
            mode,
          };
          cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab("bible", browserSourceName);
          useCssOverlayTransport = true;
          url = `${cssOverlayBaseUrl}#data=${encodeURIComponent(JSON.stringify(cssOverlayPacket))}`;

          if (!this._bibleLtInitialized) {
            await this.hideFullscreenBg(sceneName, resources);
            await this.hideSceneSource(sceneName, resources.bibleScene);
            const fsDef = this._fullscreenSceneDefs["bible"];
            if (fsDef) {
              await this.hideSceneSource(sceneName, fsDef.sceneName);
            }
            this._bibleLtInitialized = true;
          }

          // Recover if the shared browser source was manually deleted in OBS.
          await this.ensureOverlaySource(sceneName, browserSourceName, undefined, undefined, false);
        }
        // Keep the source visible during mode morph — do not hard-cut enable/disable.
        // Full canvas fit so HTML can animate LT bar within the full frame (no OBS crop cut).
        await this.fitSceneSourceToCanvas(sceneName, browserSourceName).catch(() => { });
        await this.fitSceneSourceToCanvas(PRESENTATION_SCENE_NAME, browserSourceName).catch(() => { });
      } else {
        // ── Fullscreen: unified browser source in MCE Presentation ──

        const { cleanSettings, css } = this.stripThemeDataUris(effectiveThemeSettings);
        themeCss = css;
        const hasCompareSlide = compareMode === "passages"
          ? compareColumns.length >= 2
          : compareColumns.length === 2;
        const slide = hasCompareSlide
          ? {
            id: "dock-bible-compare-slide",
            layout: "compare",
            compareEnabled: true,
            compareMode,
            compareLayout,
            reference: referenceText,
            text: primaryText,
            verseRange: displayVerseRange,
            index: 0,
            total: 1,
            lineCount: data.lineCount,
            translationA: data.translationA ?? compareColumns[0].translation,
            translationB: data.translationB ?? compareColumns[1].translation,
            columns: compareColumns.map((column) => ({
              book: column.book,
              chapter: column.chapter,
              verse: column.verse,
              verseEnd: column.verseEnd ?? column.verse,
              reference: backgroundOnly ? "" : column.referenceLabel,
              translation: column.translation,
              text: backgroundOnly ? "" : column.verseText,
              verseRange: backgroundOnly ? "" : (column.verseRange ?? ""),
            })),
          }
          : {
            id: "dock-bible-slide",
            reference: referenceText,
            text: primaryText,
            verseRange: displayVerseRange,
            index: 0,
            total: 1,
            lineCount: data.lineCount,
          };
        const packet = {
          slide,
          theme: cleanSettings ?? null,
          live: true,
          blanked: false,
          timestamp: Date.now(),
          mode,
        };
        cssOverlayPacket = packet;
        cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab(
          "bible",
          this._fullscreenSceneDefs["bible"].browserSourceName,
        );
        useCssOverlayTransport = true;

        const def = this._fullscreenSceneDefs["bible"];
        const fullscreenSetupSignature = this.buildBibleFullscreenSetupSignature(
          sceneName,
          currentProgramSceneBeforeTarget,
          effectiveThemeSettings,
        );
        const setupMatches = !modeChanged && this._lastBibleFullscreenSetupSignature === fullscreenSetupSignature;
        if (!setupMatches) {
          // Bible backgrounds are rendered inside the unified browser source.
          // Remove any legacy native BG slots left by older builds so OBS keeps
          // one Bible source instead of showing MCE BG - Bible / Bible 2.
          await this._removeFullscreenBgSources("bible").catch(() => { });
          // Clean off legacy MCE Browser - Bible and MCE BG - Bible so they do not remain triggered
          await this.removeSceneItemBySource(sceneName, "MCE Browser - Bible").catch(() => { });
          await this.removeSceneItemBySource(sceneName, "MCE BG - Bible").catch(() => { });
          if (sceneName !== PRESENTATION_SCENE_NAME) {
            await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE Browser - Bible").catch(() => { });
            await this.removeSceneItemBySource(PRESENTATION_SCENE_NAME, "MCE BG - Bible").catch(() => { });
          }
        }
        if (setupMatches) {
          const packetWithMode: Record<string, unknown> = { ...packet, mode };
          try {
            this.publishFullscreenOverlayPacket({
              slide: (packetWithMode.slide as Record<string, unknown> | null) ?? null,
              theme: (packetWithMode.theme as Record<string, unknown> | null) ?? null,
              live: true,
              blanked: Boolean(packetWithMode.blanked),
              timestamp: Number(packetWithMode.timestamp) || Date.now(),
              mode: String(mode || "fullscreen"),
            }, "bible", themeCss, def.browserSourceName);

            await this.deliverCssOverlayPacket(
              def.browserSourceName,
              "bible",
              packetWithMode,
              cssOverlayBaseUrl,
              themeCss,
            ).catch(() => { });

            await this.ensureActiveMceOverlaySource(
              data.targetScene ? sceneName : PRESENTATION_SCENE_NAME,
              def.browserSourceName,
              [def.browserSourceName],
              resources,
            ).catch(() => { });
            if (!data.targetScene) {
              await this.focusMcePresentationModule("bible").catch(() => { });
            }

            this._bibleLtInitialized = true;
            this._lastBiblePushSignature = pushSignature;
            return;
          } catch {
            this._lastBibleFullscreenSetupSignature = "";
          }
        }

        // A Dock refresh clears this client's in-memory setup signature, but
        // OBS still has the live Bible source. Preserve that already-selected
        // source while replacing its packet so a refresh does not produce an
        // unnecessary off/on flash. A missing or newly-added source still
        // follows the normal hidden-until-ready path.
        // Projecting Bible must never hide an existing Bible item: the click
        // has already made it visible, and hiding it here produced the
        // show -> hide -> show flicker and a multi-second blank output after
        // Worship/Notes had been projected. Existing items keep their
        // visibility ("keep"); only a brand-new item starts hidden until its
        // first packet lands. The final ensureActiveMceOverlaySource below
        // verifies it is on (a no-op when it already is).
        await this._ensureFullscreenScene("bible", mode, "keep");
        await this.ensureOverlaySource(
          sceneName,
          def.browserSourceName,
          undefined,
          undefined,
          "keep",
        );

        // Hide the source in user's scene if it was there from lower-third mode
        const userScene = currentProgramSceneBeforeTarget || sceneName;
        if (userScene && userScene !== PRESENTATION_SCENE_NAME) {
          await this.hideOverlaySource(userScene, def.browserSourceName);
        }

        // The browser overlay renders both the Bible text and its background
        // as one OBS source. A newly-created source stays hidden until its
        // packet arrives; a restored live source remains visible in place.
        await this.fitSceneSourceToOverlayMode(sceneName, def.browserSourceName, mode).catch(() => { });

        // Keep the URL stable, but still push the latest packet through OBS CSS.
        // OBS browser sources do not reliably share localStorage/BroadcastChannel
        // with the dock page, so CSS is the authoritative cross-process transport.
        {
          // Include mode so the fullscreen HTML removes lt-mode class when switching back
          const packetWithMode = { ...packet, mode };
          await this.deliverCssOverlayPacket(
            def.browserSourceName,
            "bible",
            packetWithMode,
            cssOverlayBaseUrl,
            themeCss,
          );
          this._bibleLtInitialized = true;
        }

        // Hide leftover dedicated scene + BG
        await this.hideSceneSource(sceneName, resources.bibleScene);
        await this.hideFullscreenBg(sceneName, resources);

        // The browser source is already inside MCE Presentation (created by _ensureFullscreenScene).
        // Just find and enable it.
        let sceneItemId: number | null = null;
        let alreadyImported = false;
        try {
          const existingCheck = await this.call("GetSceneItemList", { sceneName }) as {
            sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
          };
          const browserItem = existingCheck.sceneItems.find((i) => i.sourceName === def.browserSourceName);
          if (browserItem) {
            sceneItemId = browserItem.sceneItemId;
            alreadyImported = true;
          }
        } catch { /* ignore */ }

        if (sceneItemId !== null) {
          await this.ensureTickerAboveSource(sceneName, def.browserSourceName, { leaveVisibility: true }).catch(() => { });
        }

        // If browser source not found, create it directly in MCE Presentation
        if (sceneItemId === null) {
          try {
            const canvas = await this.getCanvasSize();
            const overlayUrl = this.buildCssOverlayHtmlUrlForTab("bible", def.browserSourceName);
            const created = await this.call("CreateInput", {
              sceneName,
              inputName: def.browserSourceName,
              inputKind: "browser_source",
              inputSettings: { url: overlayUrl, width: canvas.width, height: canvas.height, css: "", bgcolor: "#00000000", shutdown: false, restart_when_active: false },
              sceneItemEnabled: false,
            }) as { sceneItemId: number };
            sceneItemId = created.sceneItemId;
            await this.fitSceneItemToCanvas(sceneName, sceneItemId);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("already exists") || msg.includes("600")) {
              try {
                const added = await this.call("CreateSceneItem", { sceneName, sourceName: def.browserSourceName, sceneItemEnabled: false }) as { sceneItemId: number };
                sceneItemId = added.sceneItemId;
                await this.fitSceneItemToCanvas(sceneName, sceneItemId);
              } catch { /* ignore */ }
            }
          }
        }

        if (sceneItemId !== null) {
          await this.ensureTickerAboveSource(sceneName, def.browserSourceName, { leaveVisibility: true }).catch(() => { });
        }

        if (sceneItemId && currentProgramSceneBeforeTarget) {
          try {
            await this.call("SetSceneItemName", {
              sceneName: sceneName,
              sceneItemId: sceneItemId,
              sceneItemName: `${def.sceneName} (${currentProgramSceneBeforeTarget})`,
            });
          } catch { /* best effort */ }
        }

        const animation = effectiveThemeSettings?.animation as string | undefined;
        if (!modeChanged && animation && animation !== "none" && sceneItemId && !alreadyImported) {
          const canvas = await this.getCanvasSize();
          await this.setMediaSceneItemScale(sceneName, sceneItemId, canvas, 0.965);
          await this.sleep(30);
          await this.setMediaSceneItemScale(sceneName, sceneItemId, canvas, 0.985);
          await this.sleep(30);
          await this.fitSceneItemToCanvas(sceneName, sceneItemId);
        } else if (sceneItemId) {
          await this.fitSceneItemToCanvas(sceneName, sceneItemId);
        }

        this._lastBibleFullscreenSetupSignature = fullscreenSetupSignature;
      }

      if (useCssOverlayTransport && cssOverlayPacket) {
        // Include mode in the overlay data so the fullscreen HTML can animate between layouts
        const packetWithMode: Record<string, unknown> = {
          ...cssOverlayPacket,
          mode,
        };

        this.publishFullscreenOverlayPacket({
          slide: (packetWithMode.slide as Record<string, unknown> | null) ?? null,
          theme: (packetWithMode.theme as Record<string, unknown> | null) ?? null,
          live: true,
          blanked: Boolean(packetWithMode.blanked),
          timestamp: Number(packetWithMode.timestamp) || Date.now(),
          mode: String(mode || "fullscreen"),
        }, "bible", themeCss, this._fullscreenSceneDefs["bible"].browserSourceName);

        const browserSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
        const nextBaseUrl = cssOverlayBaseUrl || url;
        await this.deliverCssOverlayPacket(
          browserSourceName,
          "bible",
          packetWithMode,
          nextBaseUrl,
          themeCss,
        );

        await this.ensureActiveMceOverlaySource(
          mode === "fullscreen" && !data.targetScene ? PRESENTATION_SCENE_NAME : sceneName,
          browserSourceName,
          [browserSourceName],
          resources,
        ).catch(() => { });
        if (!data.targetScene) {
          await this.focusMcePresentationModule("bible").catch(() => { });
        }
      }

      let renderMeasurement: DockOverlayFontFitMeasurement | null = null;
      if (useCssOverlayTransport && cssOverlayPacket) {
        const browserSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
        const renderTimeout = mode === "lower-third"
          ? (isFirstLowerThirdBootstrap ? 3500 : 500)
          : (options?.timeoutMs ?? 700);
        if (options?.waitForFit) {
          renderMeasurement = await this.waitForOverlayRenderMeasurement(
            "bible",
            Number(cssOverlayPacket.timestamp) || Date.now(),
            mode,
            renderTimeout,
            browserSourceName,
          ).catch(() => null);
        } else if (mode === "lower-third") {
          await this.waitForOverlayRenderAck(
            "bible",
            Number(cssOverlayPacket.timestamp) || Date.now(),
            mode,
            renderTimeout,
            undefined,
            browserSourceName,
          ).catch(() => { });
        }
      }

      if (mode === "lower-third") {
        const browserSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
        if (modeChanged) {
          await this.setSceneSourceEnabledByName(PRESENTATION_SCENE_NAME, browserSourceName, true).catch(() => { });
          if (sceneName !== PRESENTATION_SCENE_NAME) {
            await this.setSceneSourceEnabledByName(sceneName, browserSourceName, true).catch(() => { });
          }
        }
      }

      this._lastBiblePushSignature = pushSignature;
      return renderMeasurement;
    });
  }

  /**
   * Fast path for lower-third overlay updates (theme changes, verse text changes).
   *
   * Keeps the browser source document stable and sends only overlay packets
   * for verse text changes. It does not change OBS Preview or Program scene
   * routing; the existing presentation layer remains where the user left it.
   *
   * Falls back to the full `pushBible` if the source hasn't been bootstrapped yet.
   */
  async pushBibleOverlayFast(
    data: {
      lineCount?: number;
      verseText?: string;
      referenceText?: string;
      verseRange?: string;
      bibleThemeSettings?: Record<string, unknown> | null;
      liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
      themeId?: string;
      overlayMode?: "fullscreen" | "lower-third";
      compareEnabled?: boolean;
      compareMode?: "translations" | "passages";
      compareLayout?: string;
      compare?: Record<string, unknown> | null;
      translationA?: string;
      translationB?: string;
    },
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    const browserSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
    const mode = data.overlayMode || "lower-third";
    this.noteIntendedMceMode(browserSourceName, mode);

    // If the LT/Fullscreen source is not already active in the current mode, use the full push.
    if (
      !this._bibleLtInitialized
      || !this._lastBrowserSourceUrlBySource[browserSourceName]
    ) {
      // Fall back to full pushBible — the source hasn't been bootstrapped yet.
      // Build required fields from available data.
      const verseRange = data.verseRange ?? "1";
      const refText = data.referenceText ?? "";
      return this.pushBible({
        book: "",
        chapter: 1,
        verse: 1,
        lineCount: data.lineCount,
        verseRange,
        referenceLabel: refText.replace(/\s\(.*\)$/, ""),
        displayReferenceLabel: refText,
        translation: "KJV",
        theme: data.themeId,
        verseText: data.verseText,
        overlayMode: mode,
        bibleThemeSettings: data.bibleThemeSettings,
        liveOverrides: data.liveOverrides ?? null,
        compareEnabled: data.compareEnabled,
        compareMode: data.compareMode,
        compareLayout: (data.compareLayout || "line-by-line") as "line-by-line" | "side-by-side",
        compare: data.compare ? {
          ...data.compare,
          layout: ((data.compare as Record<string, unknown>).layout as string || "line-by-line") as "line-by-line" | "side-by-side",
        } as {
          enabled?: boolean;
          layout?: "line-by-line" | "side-by-side";
          columns?: Array<{ book: string; chapter: number; verse: number; verseEnd?: number; verseRange?: string; referenceLabel: string; translation: string; verseText: string }>;
        } : undefined,
        translationA: data.translationA,
        translationB: data.translationB,
      }, options);
    }

    // Compare mode needs the full pushBible path — the fast path only handles single verses
    if (data.compareEnabled && data.compare) {
      const verseRange = data.verseRange ?? "1";
      const refText = data.referenceText ?? "";
      return this.pushBible({
        book: "",
        chapter: 1,
        verse: 1,
        lineCount: data.lineCount,
        verseRange,
        referenceLabel: refText.replace(/\s\(.*\)$/, ""),
        displayReferenceLabel: refText,
        translation: "KJV",
        theme: data.themeId,
        verseText: data.verseText,
        overlayMode: mode,
        bibleThemeSettings: data.bibleThemeSettings,
        liveOverrides: data.liveOverrides ?? null,
        compareEnabled: true,
        compareMode: data.compareMode,
        compareLayout: (data.compareLayout || "line-by-line") as "line-by-line" | "side-by-side",
        compare: {
          ...data.compare,
          layout: ((data.compare as Record<string, unknown>).layout as string || "line-by-line") as "line-by-line" | "side-by-side",
        } as {
          enabled?: boolean;
          layout?: "line-by-line" | "side-by-side";
          columns?: Array<{ book: string; chapter: number; verse: number; verseEnd?: number; verseRange?: string; referenceLabel: string; translation: string; verseText: string }>;
        },
        translationA: data.translationA,
        translationB: data.translationB,
      }, options);
    }

    const effectiveThemeSettings = await this.prepareBrowserThemeAssets(
      this.mergeThemeSettingsWithLiveOverrides(
        data.bibleThemeSettings,
        data.liveOverrides,
      ),
    );

    if (!effectiveThemeSettings) {
      // No theme to update — just skip
      return;
    }

    // Keep fast updates on the same latest-update queue as the
    // full Bible path. Otherwise a quick verse/background change can finish
    // out of order and briefly repaint an older pattern after the new one.
    return this.runSerializedBibleMutation(async () => {
      this._lastBibleMode = mode;
      try {
        const refLabel = data.referenceText || (data.verseRange ? `Verse ${data.verseRange}` : "Bible");
        recordPresentationHistory({
          type: "bible",
          sourceKind: "bible-reference",
          label: refLabel,
          subtitle: (data.verseText || refLabel).slice(0, 200),
          notes: data.translationA || "Bible",
          payloadSnapshot: {
            ...data,
            overlayMode: mode,
          },
          overlayMode: mode,
        });
      } catch {
        // Ignore history recording failures
      }
      let themeSettingsForClean: Record<string, unknown>;
      if (mode === "lower-third") {
        const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings);
        themeSettingsForClean = overlayTheme ?? effectiveThemeSettings;
      } else {
        themeSettingsForClean = effectiveThemeSettings;
      }
      const { cleanSettings, css } = this.stripThemeDataUris(themeSettingsForClean);
      const themeCss = css;

      const slide = this.buildBibleSlide(
        data.verseText ?? "",
        data.referenceText ?? "",
        data.verseRange ?? "",
        "",
        "original-first",
        data.lineCount,
      );

      const cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab("bible", browserSourceName, mode);

      const cssOverlayPacket: Record<string, unknown> = {
        slide,
        theme: cleanSettings ?? null,
        live: true,
        blanked: false,
        timestamp: Date.now(),
        mode,
      };

      const packetWithMode: Record<string, unknown> = { ...cssOverlayPacket, mode };

      this.publishFullscreenOverlayPacket({
        slide: (packetWithMode.slide as Record<string, unknown> | null) ?? null,
        theme: (packetWithMode.theme as Record<string, unknown> | null) ?? null,
        live: true,
        blanked: false,
        timestamp: Number(packetWithMode.timestamp) || Date.now(),
        mode,
      }, "bible", themeCss, browserSourceName);

      await this.deliverCssOverlayPacket(
        browserSourceName,
        "bible",
        packetWithMode,
        cssOverlayBaseUrl,
        themeCss,
      );

      // Deliver the new verse while the source is still hidden, then switch
      // the active MCE source. This prevents OBS from revealing the previous
      // verse during the visibility/focus mutation.
      await this.focusMcePresentationModule("bible").catch(() => { });

      if (options?.waitForFit) {
        return this.waitForOverlayRenderMeasurement(
          "bible",
          Number(packetWithMode.timestamp) || Date.now(),
          mode,
          options.timeoutMs ?? 700,
          browserSourceName,
        );
      }
      return null;
    });
  }

  async pushWorshipOverlayFast(
    data: {
      sectionText: string;
      translationText?: string;
      translationOrder?: DockTranslationOrder;
      sectionLabel: string;
      songTitle: string;
      artist?: string;
      overlayMode?: "fullscreen" | "lower-third";
      bibleThemeSettings?: Record<string, unknown> | null;
      liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
      backgroundOnly?: boolean;
    },
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    const resources = getDockResources();
    const sourceName = resources.worshipSource;
    const mode = data.overlayMode || "lower-third";
    this.noteIntendedMceMode(sourceName, mode);
    const cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab("worship", sourceName);
    this.claimSharedWorshipNotesSource("worship");

    if (!this._worshipInitialized || !this._lastBrowserSourceUrlBySource[sourceName]) {
      const canReuseLoadedSource = await this.canReuseStableCssOverlaySource(sourceName, cssOverlayBaseUrl);
      if (canReuseLoadedSource) {
        this._worshipInitialized = true;
      }
    }

    if (!this._worshipInitialized || !this._lastBrowserSourceUrlBySource[sourceName]) {
      return this.pushWorshipLyrics({
        ...data,
        overlayMode: mode,
      }, options);
    }

    this._lastOverlayMode[sourceName] = mode;
    try {
      const songTitle = data.songTitle || "Worship";
      const sectionLabel = data.sectionLabel || "";
      const label = sectionLabel ? `${songTitle} · ${sectionLabel}` : songTitle;
      const snippet = (data.sectionText || "").split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
      recordPresentationHistory({
        type: "worship",
        sourceKind: "worship-song-section",
        label,
        subtitle: snippet,
        notes: data.artist,
        payloadSnapshot: {
          ...data,
          overlayMode: mode,
        },
        overlayMode: mode,
      });
    } catch {
      // Ignore history recording failures
    }
    const backgroundOnly = Boolean(data.backgroundOnly);
    const sectionText = backgroundOnly ? "" : data.sectionText;
    const translationText = backgroundOnly ? "" : (data.translationText ?? "");
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );

    let themeCss = "";
    let cleanTheme: Record<string, unknown> | null = null;

    if (effectiveThemeSettings) {
      let themeForClean: Record<string, unknown>;
      if (mode === "lower-third") {
        const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings);
        themeForClean = overlayTheme ?? effectiveThemeSettings;
      } else {
        themeForClean = effectiveThemeSettings;
      }
      const { cleanSettings, css } = this.stripThemeDataUris(themeForClean);
      cleanTheme = cleanSettings ?? null;
      themeCss = stripCompatModeCSS(css);
    }

    const slide = this.buildBibleSlide(sectionText, this.tabLabel("worship", data, ""), "", translationText, data.translationOrder);
    const packetWithMode: Record<string, unknown> = {
      slide,
      theme: cleanTheme,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };

    this.publishFullscreenOverlayPacket({
      slide: (packetWithMode.slide as Record<string, unknown> | null) ?? null,
      theme: (packetWithMode.theme as Record<string, unknown> | null) ?? null,
      live: true,
      blanked: false,
      timestamp: Number(packetWithMode.timestamp) || Date.now(),
      mode,
    }, "worship", themeCss, sourceName);

    await this.deliverCssOverlayPacket(
      sourceName,
      "worship",
      packetWithMode,
      cssOverlayBaseUrl,
      themeCss,
    );

    // The packet must be in the browser source before it is made visible and
    // promoted above the other MCE sources.
    await this.prepareFastOverlayScene(
      "worship",
      sourceName,
      (sceneName) => mode === "fullscreen"
        ? this.fitSceneSourceToCanvas(sceneName, sourceName)
        : this.fitSceneSourceToLowerThirdWindow(sceneName, sourceName),
    );
    await this.focusMcePresentationModule("worship").catch(() => { });
    await this.promotePresentationScene("worship").catch(() => { });
    if (options?.waitForFit) {
      return this.waitForOverlayRenderMeasurement(
        "worship",
        Number(packetWithMode.timestamp) || Date.now(),
        mode,
        options.timeoutMs ?? 700,
        sourceName,
      );
    }
    return null;
  }

  async pushNotesOverlayFast(
    data: {
      sectionText: string;
      translationText?: string;
      translationOrder?: DockTranslationOrder;
      sectionLabel: string;
      songTitle: string;
      artist?: string;
      overlayMode?: "fullscreen" | "lower-third";
      bibleThemeSettings?: Record<string, unknown> | null;
      liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
      backgroundOnly?: boolean;
    },
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    const resources = getDockResources();
    const sourceName = resources.notesSource;
    const mode = data.overlayMode || "lower-third";
    this.noteIntendedMceMode(sourceName, mode);
    const cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab("notes", sourceName);
    this.claimSharedWorshipNotesSource("notes");

    if (!this._notesInitialized || !this._lastBrowserSourceUrlBySource[sourceName]) {
      const canReuseLoadedSource = await this.canReuseStableCssOverlaySource(sourceName, cssOverlayBaseUrl);
      if (canReuseLoadedSource) {
        this._notesInitialized = true;
      }
    }

    if (!this._notesInitialized || !this._lastBrowserSourceUrlBySource[sourceName]) {
      return this.pushNotesLyrics({
        ...data,
        overlayMode: mode,
      }, options);
    }

    this._lastOverlayMode[sourceName] = mode;
    try {
      const noteTitle = data.songTitle || "Note";
      const sectionLabel = data.sectionLabel || "";
      const label = sectionLabel ? `${noteTitle} · ${sectionLabel}` : noteTitle;
      const snippet = (data.sectionText || "").split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
      recordPresentationHistory({
        type: "sermon",
        sourceKind: "sermon-point",
        label,
        subtitle: snippet,
        payloadSnapshot: {
          ...data,
          isNoteSlide: true,
          slideText: data.sectionText,
          noteTitle,
          overlayMode: mode,
        },
        overlayMode: mode,
      });
    } catch {
      // Ignore history recording failures
    }
    const backgroundOnly = Boolean(data.backgroundOnly);
    const sectionText = backgroundOnly ? "" : data.sectionText;
    const translationText = backgroundOnly ? "" : (data.translationText ?? "");
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );

    let themeCss = "";
    let cleanTheme: Record<string, unknown> | null = null;

    if (effectiveThemeSettings) {
      let themeForClean: Record<string, unknown>;
      if (mode === "lower-third") {
        const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings);
        themeForClean = overlayTheme ?? effectiveThemeSettings;
      } else {
        themeForClean = effectiveThemeSettings;
      }
      const { cleanSettings, css } = this.stripThemeDataUris(themeForClean);
      cleanTheme = cleanSettings ?? null;
      themeCss = stripCompatModeCSS(css);
    }

    const slide = this.buildBibleSlide(sectionText, this.tabLabel("notes", data, ""), "", translationText, data.translationOrder);
    const packetWithMode: Record<string, unknown> = {
      slide,
      theme: cleanTheme,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };

    this.publishFullscreenOverlayPacket({
      slide: (packetWithMode.slide as Record<string, unknown> | null) ?? null,
      theme: (packetWithMode.theme as Record<string, unknown> | null) ?? null,
      live: true,
      blanked: false,
      timestamp: Number(packetWithMode.timestamp) || Date.now(),
      mode,
    }, "notes", themeCss, sourceName);

    await this.deliverCssOverlayPacket(
      sourceName,
      "notes",
      packetWithMode,
      cssOverlayBaseUrl,
      themeCss,
    );

    await this.prepareFastOverlayScene(
      "notes",
      sourceName,
      (sceneName) => mode === "fullscreen"
        ? this.fitSceneSourceToCanvas(sceneName, sourceName)
        : this.fitSceneSourceToLowerThirdWindow(sceneName, sourceName),
    );
    await this.focusMcePresentationModule("notes").catch(() => { });
    await this.promotePresentationScene("notes").catch(() => { });
    if (options?.waitForFit) {
      return this.waitForOverlayRenderMeasurement(
        "notes",
        Number(packetWithMode.timestamp) || Date.now(),
        mode,
        options.timeoutMs ?? 700,
        sourceName,
      );
    }
    return null;
  }

  async bringNotesOverlayForward(_mode: DockOverlayMode = "lower-third"): Promise<void> {
    await this.bringMceOverlayForward(getDockResources().notesSource);
  }

  async primeNotesOverlay(data: PrimeWorshipOverlayData): Promise<void> {
    // Worship is on air on the shared source: priming would replace it.
    if (this.isSharedWorshipNotesSourceHeldByOther("notes")) return;
    const mode = data.overlayMode ?? "fullscreen";
    const backgroundOnly = Boolean(data.backgroundOnly);
    const sectionText = backgroundOnly ? "" : (data.sectionText ?? "");
    const translationText = backgroundOnly ? "" : (data.translationText ?? "");
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );
    const themeForOverlay = mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const themeCss = mode === "lower-third" ? stripCompatModeCSS(css) : css;
    const slide = this.buildBibleSlide(sectionText, this.tabLabel("notes", data, ""), "", translationText, data.translationOrder);
    const packet: Record<string, unknown> = {
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
      mode,
    };
    const sourceName = getDockResources().notesSource;
    const baseUrl = this.buildCssOverlayHtmlUrlForTab("notes", sourceName);

    if (await this.keepLoadedCssOverlaySourceStable(sourceName, "notes", packet, baseUrl, themeCss)) {
      // The page is already loaded, so nothing was sent. A background change still has to reach it:
      // a theme-only packet (no words) updates the look without putting anything on the screen.
      if (backgroundOnly) {
        this.publishFullscreenOverlayPacket({
          slide: null,
          theme: cleanSettings ?? null,
          live: true,
          blanked: false,
          timestamp: Number(packet.timestamp) || Date.now(),
          mode,
        }, "notes", themeCss, sourceName);
      }
      return;
    }

    this.publishFullscreenOverlayPacket({
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Number(packet.timestamp) || Date.now(),
      mode,
    }, "notes", themeCss, sourceName);
    await this.deliverCssOverlayPacket(sourceName, "notes", packet, baseUrl, themeCss).catch(() => { });
  }

  /**
   * Send a blank packet straight to a hidden browser source (no reload, no
   * visibility change). The cached packet is dropped so a later recovery
   * redelivery can't bring the cleared content back.
   */
  private emitBlankPacketToHiddenSource(tabType: CssOverlayPacketTab, sourceName: string): void {
    if (!this.isConnected || !sourceName) return;
    for (const timer of this._redeliveryTimersBySource[sourceName] ?? []) clearTimeout(timer);
    this._redeliveryTimersBySource[sourceName] = [];
    const blankPacket: Record<string, unknown> = {
      slide: null,
      theme: null,
      live: false,
      blanked: true,
      timestamp: Date.now(),
    };
    const previousMode = this._lastCssOverlayPacketBySource[sourceName]?.mode;
    if (previousMode === "fullscreen" || previousMode === "lower-third") blankPacket.mode = previousMode;
    delete this._lastCssOverlayPacketBySource[sourceName];
    const css = this.buildCssOverlayDataCss(blankPacket, this._lastCssOverlayThemeCssBySource[sourceName] || "");
    delete this._lastPacketDeliveredAtBySource[sourceName];
    void this.emitBrowserOverlayPacket(tabType, blankPacket, css, sourceName).catch(() => false);
  }

  /**
   * Clear the Bible overlay — hide all Bible sources in both MCE Presentation
   * (fullscreen) and the user's current scene (lower-third), then restore state.
   */
  /** True while a Bible / Worship / Notes browser source is showing in lower-third mode. */
  private isMceSourceInLowerThirdMode(sourceName: string): boolean {
    const source = sourceName.trim();
    if (!source) return false;
    const intended = this._intendedLowerThirdModeBySource[source];
    if (intended !== undefined) return intended;
    if (source === this._fullscreenSceneDefs["bible"]?.browserSourceName) {
      return this._lastBibleMode === "lower-third";
    }
    return this._lastOverlayMode[source] === "lower-third";
  }

  /** Announce the layout a Bible / Worship / Notes source is about to be projected in. */
  private noteIntendedMceMode(sourceName: string | undefined, mode: string | undefined): void {
    const source = (sourceName ?? "").trim();
    if (!source || (mode !== "lower-third" && mode !== "fullscreen")) return;
    this._intendedLowerThirdModeBySource[source] = mode === "lower-third";
  }

  /**
   * Let a Bible / Worship / Notes overlay play its exit animation, then return so
   * the caller can hide the source. Hiding the OBS source straight away cuts the
   * graphic off mid-frame. A blanked packet makes the overlay page play its own
   * exit first (the theme's "out" animation, or the legacy fade).
   */
  async animateOutPresentationOverlay(
    module: "bible" | "worship" | "notes",
    options?: {
      mode?: "fullscreen" | "lower-third";
      /** Include the shared MCE Presentation source (default true). */
      includePresentation?: boolean;
      /** Routed scenes whose own per-scene source should animate out too. */
      targets?: ReadonlyArray<{ sceneName: string; mode?: string }>;
      waitMs?: number;
    },
  ): Promise<void> {
    if (!this.isConnected) return;
    // Worship and Notes share one source: never blank the other module's graphic.
    if (module !== "bible" && this.isSharedWorshipNotesSourceHeldByOther(module)) return;
    const resources = getDockResources();
    const toMode = (value: string | undefined): "fullscreen" | "lower-third" => (
      (value ?? options?.mode) === "fullscreen" ? "fullscreen" : "lower-third"
    );
    const sources: Array<{ source: string; mode: "fullscreen" | "lower-third" }> = [];
    if (options?.includePresentation !== false) {
      const presentationSource = module === "bible"
        ? this._fullscreenSceneDefs["bible"].browserSourceName
        : module === "worship" ? resources.worshipSource : resources.notesSource;
      sources.push({ source: presentationSource, mode: toMode(undefined) });
    }
    for (const target of options?.targets ?? []) {
      sources.push({
        source: this.getSceneRouteSourceName(module, target.sceneName),
        mode: toMode(target.mode),
      });
    }
    if (sources.length === 0) return;
    await Promise.all(sources.map(async ({ source, mode }) => {
      this.publishBlankFullscreenOverlayPacket(module, mode, source);
      await this.emitBrowserOverlayPacket(module, {
        slide: null,
        theme: null,
        live: false,
        blanked: true,
        timestamp: Date.now(),
        mode,
      }, "", source).catch(() => false);
    }));
    await this.sleep(options?.waitMs ?? OVERLAY_EXIT_WAIT_MS);
  }

  async clearBible(): Promise<void> {
    return this.runSerializedBibleMutation(async () => {
      const resources = getDockResources();
      const scene = PRESENTATION_SCENE_NAME;
      const browserSourceName = this._fullscreenSceneDefs["bible"].browserSourceName;
      // Hide the unified Bible source in MCE Presentation (fullscreen mode)
      await Promise.all([
        this.hideOverlaySource(scene, SOURCE_NAMES.BIBLE).catch(() => { }),
        this.hideOverlaySource(scene, BG_SOURCE_NAMES.BIBLE).catch(() => { }),
        this.hideOverlaySource(scene, FULLSCREEN_SOURCE_NAMES.BIBLE).catch(() => { }),
        this.hideOverlaySource(scene, FULLSCREEN_BG_SOURCE_NAMES.BIBLE).catch(() => { }),
        this.hideOverlaySource(scene, browserSourceName).catch(() => { }),
        this.hideSceneSource(scene, resources.bibleScene).catch(() => { }),
        this.hideFullscreenBg(scene, resources).catch(() => { }),
        this._hideLowerThirdBgSource(scene).catch(() => { }),
      ]);
      this.invalidateActiveMceOverlayState(scene);

      // Also hide the unified Bible source from the user's current scene
      // (lower-third mode adds it there)
      const currentScene = await this.getCurrentProgramSceneName(true).catch(() => "");
      if (currentScene && currentScene !== scene) {
        await Promise.all([
          this.hideOverlaySource(currentScene, browserSourceName).catch(() => { }),
          this.hideSceneSource(currentScene, resources.bibleScene).catch(() => { }),
          this.hideFullscreenBg(currentScene, resources).catch(() => { }),
          this._hideLowerThirdBgSource(currentScene).catch(() => { }),
        ]);
        this.invalidateActiveMceOverlayState(currentScene);

        // A Multiview scene may intentionally contain MCE Presentation as its
        // last-added source. Clearing Bible must never remove that scene item.
        const fsDef = this._fullscreenSceneDefs["bible"];
        if (fsDef && !DockObsClient.isManagedMultiviewSceneName(currentScene)) {
          try {
            const resp = await this.call("GetSceneItemList", { sceneName: currentScene }) as {
              sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
            };
            const fsItems = resp.sceneItems.filter((i) => i.sourceName.startsWith(fsDef.sceneName));
            for (const item of fsItems) {
              await this.call("RemoveSceneItem", { sceneName: currentScene, sceneItemId: item.sceneItemId });
            }
          } catch { /* ignore */ }
        }
      }

      // Reset internal state
      this._lastBiblePushSignature = "";
      this._lastBibleFullscreenSetupSignature = "";
      this._bibleLtInitialized = false;
      this._lastBibleMode = "";
      this._restoredLiveBibleSource = false;
      if (readNativeDockSetting<unknown>(MCE_PRESENTATION_ACTIVE_MODULE_KEY) === "bible") {
        writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, null);
      }
      if (this._lastActivePresentationSource === this._fullscreenSceneDefs["bible"].browserSourceName) {
        this._lastActivePresentationSource = null;
      }
      this.publishBlankFullscreenOverlayPacket(
        "bible",
        "lower-third",
        this._fullscreenSceneDefs["bible"].browserSourceName,
      );
      // Also empty the (now hidden) OBS browser document. Otherwise it keeps
      // this verse and shows it again for a moment on the next Bible click.
      this.emitBlankPacketToHiddenSource("bible", browserSourceName);

      // Clean up the bible clone scene (studio mode)
      await this.deleteClone(undefined, "bible").catch(() => { });

      // Restore Program scene to what it was before Bible was pushed
      await this.restoreProgramSceneBeforePush("bible");

    });
  }

  /**
   * Switch the visible Bible overlay between Fullscreen and Lower-Third.
   *
   * Unlike pushBible, this does NOT resize/crop/disable/recreate the OBS source,
   * change the browser URL, or re-stage the verse. It updates both the live
   * browser event and the durable CSS state so the overlay HTML stays in sync
   * even if OBS restarts the browser source mid-transition.
   *
   * Does NOT wrap itself in obsQueue.enqueue — the internal OBS calls already
   * use the queue, so nesting would risk stalls.
   */
  async switchBibleOverlayMode(data: {
    mode: "fullscreen" | "lower-third";
    verseText: string;
    referenceText: string;
    verseRange: string;
    bibleThemeSettings?: Record<string, unknown> | null;
    liveOverrides?: Record<string, unknown> | null;
    compareEnabled?: boolean;
    compareMode?: "translations" | "passages";
    compareLayout?: string;
    compare?: Record<string, unknown> | null;
    transitionId: number;
  }): Promise<void> {
    const sourceName = this._fullscreenSceneDefs["bible"]?.browserSourceName;
    if (!sourceName) return;

    // Bootstrap only if the source genuinely does not exist yet
    const sceneName = DOCK_PRESENTATION_SCENE;
    const existing = await this.getSceneItemBySource(sceneName, sourceName).catch(() => null);
    if (!existing) {
      await this._ensureFullscreenScene("bible", data.mode);
    }

    // Build theme: merge with live overrides, apply mode-specific wrapping
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings ?? null,
      data.liveOverrides ?? null,
    );
    const themeForOverlay = data.mode === "lower-third" && effectiveThemeSettings
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings } = this.stripThemeDataUris(themeForOverlay);

    // Build slide
    const compareColumns = data.compareEnabled && Array.isArray(data.compare?.columns)
      ? (data.compare.columns as Array<Record<string, unknown>>).filter(Boolean).slice(0, data.compareMode === "passages" ? 3 : 2)
      : [];
    const hasCompareSlide = data.compareMode === "passages"
      ? compareColumns.length >= 2
      : compareColumns.length === 2;
    const slide = hasCompareSlide
      ? {
          id: "dock-bible-compare-slide",
          layout: "compare",
          compareEnabled: true,
          compareMode: data.compareMode ?? "translations",
          compareLayout: data.compareLayout ?? "line-by-line",
          reference: data.referenceText,
          text: data.verseText,
          verseRange: data.verseRange,
          index: 0,
          total: 1,
          translationA: String(data.compare?.translationA ?? ""),
          translationB: String(data.compare?.translationB ?? ""),
          columns: compareColumns.map((col) => ({
            book: col.book ?? "",
            chapter: col.chapter ?? "",
            verse: col.verse ?? "",
            verseEnd: col.verseEnd ?? "",
            reference: col.reference ?? "",
            translation: col.translation ?? "",
            text: col.text ?? "",
            verseRange: col.verseRange ?? "",
          })),
        }
      : this.buildBibleSlide(data.verseText, data.referenceText, data.verseRange);

    const timestamp = Date.now();
    const packet: Record<string, unknown> = {
      slide,
      theme: cleanSettings ?? null,
      compare: data.compare ?? null,
      live: true,
      blanked: false,
      mode: data.mode,
      timestamp,
      transitionId: data.transitionId,
    };

    const baseUrl = this.buildCssOverlayHtmlUrlForTab("bible", sourceName);
    await this.deliverCssOverlayPacket(sourceName, "bible", packet, baseUrl, "");

    this._lastBibleMode = data.mode;

    console.log("[BibleMode] mode packet delivered", {
      mode: data.mode,
      timestamp,
      transitionId: data.transitionId,
    });
  }

  /**
   * Push a lower-third to OBS as an overlay in the current scene.
   */
  async pushLowerThirdOverlayUrl(
    url: string,
    options?: { sourceWidth?: number; sourceHeight?: number; sourceName?: string },
  ): Promise<void> {
    const resources = getDockResources();
    const ltSource = options?.sourceName ?? resources.ltSource;
    url = this.routeLowerThirdUrl(url, ltSource);
    const target = await this.getPresentationTargetScene("lower-third");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the MCE Presentation scene.");

    await this.ensureProgramSceneAsSourceInPresentation();
    await this.clearAllOverlays(ltSource, sceneName, resources);
    // Give the source its new page before turning it on: turned on first, OBS would show
    // whatever the previous graphic left behind until the new page loads.
    const sceneItemId = await this.ensureOverlaySource(
      sceneName,
      ltSource,
      options?.sourceWidth,
      options?.sourceHeight,
      "keep",
    );

    await this.call("SetInputSettings", {
      inputName: ltSource,
      inputSettings: {
        url,
        width: options?.sourceWidth,
        height: options?.sourceHeight,
        fps_custom: true,
        fps: 60,
        shutdown: false,
        restart_when_active: false,
      },
    });
    await this.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: true }).catch(() => { });
    this.invalidateSceneItemListCache(sceneName);
    this._lastBrowserSourceUrlBySource[ltSource] = url;
    const parsed = this.parseOverlayPayloadUrl(url);
    if (parsed) {
      this._lastCssOverlayPacketBySource[ltSource] = parsed.payload;
      this._lastCssOverlayBaseUrlBySource[ltSource] = parsed.baseUrl;
      this._lastCssOverlayThemeCssBySource[ltSource] = "";
    }

    await this.ensureTickerAboveSource(sceneName, ltSource).catch(() => { });
    await this.applyMcePresentationSourceVisibility(ltSource).catch(() => { });
  }

  /**
   * Replace a live Ministry lower-third without reloading the OBS browser source.
   * The overlay page queues the new packet while the old one exits, then plays
   * the new entry animation from the same browser document.
   */
  async replaceLiveLowerThirdOverlayUrl(
    url: string,
    options?: { sourceWidth?: number; sourceHeight?: number; sourceName?: string },
    waitMs = FULLSCREEN_CLEAR_WAIT_MS,
  ): Promise<void> {
    const resources = getDockResources();
    const ltSource = options?.sourceName ?? resources.ltSource;
    // With a source per tab, packets go to this tab's page only.
    const packetTarget = this._ltPerTabSources ? ltSource : undefined;
    url = this.routeLowerThirdUrl(url, ltSource);
    const target = await this.getPresentationTargetScene("lower-third");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the MCE Presentation scene.");

    await this.ensureProgramSceneAsSourceInPresentation();

    const parsed = this.parseOverlayPayloadUrl(url);
    const existing = await this.getSceneItemBySource(sceneName, ltSource).catch(() => null);
    if (!parsed || !existing) {
      if (existing) {
        await this.animateLowerThirdOverlayUrlOut("", waitMs, { restoreProgram: false, sourceName: options?.sourceName });
      }
      await this.pushLowerThirdOverlayUrl(url, options);
      return;
    }

    await this.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: existing.sceneItemId,
      sceneItemEnabled: true,
    }).catch(() => { });
    await this.ensureTickerAboveSource(sceneName, ltSource).catch(() => { });
    await this.applyMcePresentationSourceVisibility(ltSource).catch(() => { });

    const nextPacket = {
      ...parsed.payload,
      live: true,
      blanked: false,
      timestamp: Date.now(),
    };
    const overlayCss = this.buildCssOverlayDataCss(nextPacket, "");

    let delivered = false;
    try {
      const exitDelivered = await this.emitBrowserOverlayPacket("lower-third", {
        action: "animate-out",
        timestamp: Date.now(),
      }, "", packetTarget);
      nextPacket.timestamp = Date.now();
      delivered = exitDelivered && await this.emitBrowserOverlayPacket("lower-third", nextPacket, overlayCss, packetTarget);
    } catch {
      delivered = false;
    }

    if (!delivered) {
      await this.animateLowerThirdOverlayUrlOut("", waitMs, { restoreProgram: false, sourceName: options?.sourceName });
      await this.pushLowerThirdOverlayUrl(url, options);
      return;
    }

    try {
      await this.call("SetInputSettings", {
        inputName: ltSource,
        // Persist both transports. OBS can refresh the browser source when its
        // CSS changes; leaving the old URL here would bring the previous size
        // back after the live packet briefly renders.
        inputSettings: { url, css: overlayCss },
      });
    } catch { /* keep the live event result */ }

    this._lastBrowserSourceUrlBySource[ltSource] = url;
    this._lastCssOverlayPacketBySource[ltSource] = nextPacket;
    this._lastCssOverlayBaseUrlBySource[ltSource] = parsed.baseUrl;
    this._lastCssOverlayThemeCssBySource[ltSource] = "";
  }

  /**
   * Push a lower-third to OBS as an overlay in the current scene.
   */
  async pushLowerThird(data: {
    name?: string;
    role?: string;
    title?: string;
    subtitle?: string;
    series?: string;
    speaker?: string;
    point?: string;
    date?: string;
    location?: string;
    description?: string;
    ltTheme?: DockLTThemeRef;
    context?: "speaker" | "sermon" | "event" | "custom";
    values?: Record<string, string>;
  }): Promise<void> {
    const resources = getDockResources();
    const target = await this.getPresentationTargetScene("lower-third");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    // Clear all OTHER overlays first so previous overlay doesn't persist
    await this.clearAllOverlays(resources.ltSource, sceneName, resources);

    // Ensure overlay source exists in target scene (auto-creates if needed)
    await this.ensureOverlaySource(sceneName, resources.ltSource, undefined, undefined, true);

    const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, data.context ?? "speaker");

    // Build a comprehensive values map so the overlay's {{variable}} substitution
    // can replace ALL placeholders — regardless of which theme is chosen.
    const values: Record<string, string> = {};
    const ctx = data.context ?? "speaker";
    if (ctx === "speaker") {
      const nm = data.name || "";
      let rl = data.role || data.subtitle || "";
      // Auto-resolve role from ministry store if not explicitly provided
      if (!rl && nm) {
        const roleMap = buildSpeakerRoleMap();
        const resolved = roleMap.get(nm.trim().toLowerCase());
        if (resolved) rl = resolved;
      }
      Object.assign(values, {
        name: nm,
        title: rl,
        role: rl,
        subtitle: rl,
        headline: nm,
        subline: rl,
        label: nm,
        details: rl,
        line1: nm,
        line2: rl,
      });
    } else if (ctx === "sermon") {
      const msgTitle = data.title || data.point || "";
      const seriesName = data.series || "";
      const speakerName = data.speaker || data.name || "";
      Object.assign(values, {
        name: msgTitle,
        title: msgTitle,
        headline: msgTitle,
        subtitle: seriesName || speakerName,
        subline: seriesName || speakerName,
        role: speakerName,
        series: seriesName,
        speaker: speakerName,
        point: data.point || "",
        label: msgTitle,
        details: seriesName ? `${seriesName} • ${speakerName}` : speakerName,
        line1: msgTitle,
        line2: seriesName ? `${seriesName} • ${speakerName}` : speakerName,
      });
    } else if (ctx === "event") {
      const evName = data.name || data.title || "";
      const evDate = data.date || "";
      const evLoc = data.location || "";
      const evDesc = data.description || data.subtitle || "";
      const sub = [evDate, evLoc].filter(Boolean).join(" • ") || evDesc;
      Object.assign(values, {
        name: evName,
        title: evName,
        headline: evName,
        subtitle: sub,
        subline: sub,
        role: sub,
        date: evDate,
        location: evLoc,
        description: evDesc,
        label: evName,
        details: evDesc || sub,
        line1: evName,
        line2: sub,
      });
    } else if (ctx === "custom") {
      Object.assign(values, {
        name: data.name || data.title || "",
        title: data.title || data.name || "",
        headline: data.title || data.name || "",
        subtitle: data.subtitle || data.role || "",
        subline: data.subtitle || data.role || "",
        role: data.role || data.subtitle || "",
        label: data.name || data.title || "",
        details: data.description || data.subtitle || "",
        description: data.description || "",
        meta: data.description || "",
        line1: data.title || data.name || "",
        line2: data.subtitle || data.description || "",
      });
    }

    if (data.values) {
      Object.assign(values, data.values);
    }

    // ── Inject church logo from brand settings ──
    const logoUrl = this._getLogoUrl();
    if (logoUrl && !values.logoUrl) {
      values.logoUrl = logoUrl;
    }

    const url = this.buildLowerThirdUrl(values, false, false, resolvedLTTheme);

    await this.setBrowserSourceUrl(resources.ltSource, url);
    await this.applyMcePresentationSourceVisibility(resources.ltSource).catch(() => { });
  }

  /**
   * Load the bundled NoeAL Animated Lower Thirds browser source into OBS.
   *
   * The legacy control panel talks to this browser source with BroadcastChannel,
   * so this method only provisions the correct page and scene visibility.
   */
  async loadAnimatedLowerThirdSource(payload?: Record<string, unknown>): Promise<boolean> {
    const resources = getDockResources();
    const sourceName = resources.animatedLtSource;
    const target = await this.getTargetScene();
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    const baseUrl = `${this.getOverlayBaseUrl()}/animated-lower-thirds/lower-thirds/browser-source.html`;
    const serializedPayload = payload ? encodeURIComponent(JSON.stringify(payload)) : "";
    const sourceUrl = payload ? `${baseUrl}#v=${Date.now()}` : baseUrl;
    const sourceCss = serializedPayload
      ? `:root { --animated-lt-data: "${serializedPayload}"; }`
      : "";

    await this.clearAllOverlays(sourceName, sceneName, resources);
    await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, true);

    let currentUrl = "";
    try {
      const current = await this.call("GetInputSettings", { inputName: sourceName }) as {
        inputSettings?: { url?: string };
      };
      currentUrl = current.inputSettings?.url ?? "";
    } catch { /* ignore and load below */ }

    const sourceChanged = currentUrl !== sourceUrl;
    if (sourceChanged || payload) {
      await this.setBrowserSourceUrl(sourceName, sourceUrl, false, sourceCss);
    }

    await this.applyMcePresentationSourceVisibility(sourceName).catch(() => { });

    return sourceChanged;
  }

  /**
   * Push sermon quotes/points using the same general fullscreen/lower-third
   * theme structure as Bible and Worship, while keeping the existing LT source.
   */
  async pushSermonCue(data: {
    text: string;
    label?: string;
    topic?: string;
    itemType?: "quote" | "point";
    overlayMode?: "fullscreen" | "lower-third";
    bibleThemeSettings?: Record<string, unknown> | null;
    liveOverrides?: DockLiveThemeOverrides | Record<string, unknown> | null;
    backgroundOnly?: boolean;
  }): Promise<void> {
    const resources = getDockResources();
    const target = await this.getTargetScene();
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    const mode = data.overlayMode ?? "lower-third";
    try {
      const isQuote = data.itemType === "quote";
      recordPresentationHistory({
        type: "sermon",
        sourceKind: isQuote ? "sermon-quote" : "sermon-point",
        label: isQuote ? `“${data.text.slice(0, 80)}”` : data.text.slice(0, 80),
        subtitle: data.label,
        payloadSnapshot: {
          ...data,
          overlayMode: mode,
        },
        overlayMode: mode,
      });
    } catch {
      // Ignore history recording failures
    }
    const backgroundOnly = Boolean(data.backgroundOnly);
    const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
      data.bibleThemeSettings,
      data.liveOverrides,
    );
    const prevMode = this._lastOverlayMode[resources.ltSource];
    const modeChanged = prevMode !== undefined && prevMode !== mode;
    this._lastOverlayMode[resources.ltSource] = mode;

    if (mode === "fullscreen") {
      await this.clearAllOverlays([resources.ltSource, resources.fsBgSource], sceneName, resources);
      await this.ensureFullscreenBg(sceneName, effectiveThemeSettings, true, resources);
      await this.ensureOverlaySource(sceneName, resources.ltSource, undefined, undefined, true);
    } else {
      await this.clearAllOverlays(resources.ltSource, sceneName, resources);
      await this.ensureOverlaySource(sceneName, resources.ltSource, undefined, undefined, true);
      await this.hideFullscreenBg(sceneName, resources);
    }

    const themeForOverlay = mode === "lower-third"
      ? this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings).overlayTheme
      : effectiveThemeSettings;
    const { cleanSettings, css } = this.stripThemeDataUris(themeForOverlay);
    const reference = backgroundOnly
      ? ""
      : data.itemType === "point"
        ? ""
        : data.label || data.topic || "Quote";
    const slide = {
      ...this.buildBibleSlide(backgroundOnly ? "" : data.text, reference),
      showCounter: data.itemType !== "point",
    };
    const packet = {
      slide,
      theme: cleanSettings ?? null,
      live: true,
      blanked: false,
      timestamp: Date.now(),
    };
    const baseUrl = this.buildOverlayHtmlUrl("mce-bible-overlay.html", {
      tab: "sermon",
      mode,
    });

    this.publishFullscreenOverlayPacket(packet, "sermon", css);
    const sourceSignature = JSON.stringify({
      baseUrl,
      css: css || "",
    });
    const overlayCss = this.buildCssOverlayDataCss(packet, css);
    if (modeChanged || this._lastFullscreenSourceSignature[resources.ltSource] !== sourceSignature) {
      await this.setBrowserSourceUrl(resources.ltSource, baseUrl, modeChanged, overlayCss);
      this._lastFullscreenSourceSignature[resources.ltSource] = sourceSignature;
    } else {
      await this.call("SetInputSettings", {
        inputName: resources.ltSource,
        inputSettings: { css: overlayCss },
      });
    }
    this._lastCssOverlayPacketBySource[resources.ltSource] = packet;
    this._lastCssOverlayBaseUrlBySource[resources.ltSource] = baseUrl;
    this._lastCssOverlayThemeCssBySource[resources.ltSource] = css || "";
    await this.applyMcePresentationSourceVisibility(resources.ltSource).catch(() => { });
  }

  /**
   * Clear sermon cue — simply hide the sermon source in MCE Presentation.
   */
  async clearSermonCue(): Promise<void> {
    const scene = PRESENTATION_SCENE_NAME;

    // Hide the sermon source (lower-third) in MCE Presentation
    await this.hideOverlaySource(scene, SOURCE_NAMES.LOWER_THIRD).catch(() => { });
    await this.hideOverlaySource(scene, BG_SOURCE_NAMES.LOWER_THIRD).catch(() => { });

    // Restore Program scene to what it was before Sermon Cue was pushed
    await this.restoreProgramSceneBeforePush();

  }

  /**
   * Clear all lower-third overlays.
   * Sends a blanked URL first (triggers exit animation), waits, then hides.
   */
  async clearLowerThirds(waitMs = FULLSCREEN_CLEAR_WAIT_MS): Promise<void> {
    for (const resources of getAllDockResources()) {
      try {
        const cachedPayload = this._lastCssOverlayPacketBySource[resources.ltSource];
        const cachedBaseUrl = this._lastCssOverlayBaseUrlBySource[resources.ltSource];
        if (cachedPayload && cachedBaseUrl) {
          const blankedPacket = {
            ...cachedPayload,
            live: false,
            blanked: true,
            timestamp: Date.now(),
          };
          const overlayCss = this.buildCssOverlayDataCss(
            blankedPacket,
            this._lastCssOverlayThemeCssBySource[resources.ltSource] || "",
          );
          await this.call("SetInputSettings", {
            inputName: resources.ltSource,
            inputSettings: { css: overlayCss },
          });
        } else {
          const fallbackUrl = this.buildLowerThirdUrl({}, false, true);
          const url = await this.buildBlankedOverlayUrlFromCurrentSource(resources.ltSource, fallbackUrl);
          await this.setBrowserSourceUrl(resources.ltSource, url);
        }
      } catch { /* ignore */ }
    }

    // Wait for exit animation before hiding the source
    await new Promise((r) => setTimeout(r, waitMs));

    const scenes = new Set<string>();
    scenes.add(DOCK_PRESENTATION_SCENE);
    try {
      const targetScene = await this.getCurrentProgramSceneName().catch(() => "");
      if (targetScene) scenes.add(targetScene);
    } catch { /* ignore */ }

    for (const resources of getAllDockResources()) {
      for (const sceneName of scenes) {
        // Hide only: the source stays in the scene so the next send reuses it.
        await this.hideOverlaySource(sceneName, resources.ltSource);
        await this.hideFullscreenBg(sceneName, resources);
      }
      // Do NOT delete inputs globally — keep them alive for reuse.
      delete this._lastOverlayMode[resources.ltSource];
      delete this._lastFullscreenSourceSignature[resources.ltSource];
      delete this._lastCssOverlayPacketBySource[resources.ltSource];
      delete this._lastCssOverlayBaseUrlBySource[resources.ltSource];
      delete this._lastCssOverlayThemeCssBySource[resources.ltSource];
    }

    // Restore Program scene to what it was before Lower Third was pushed
    await this.restoreProgramSceneBeforePush("lower-third");

  }

  /**
   * Animate the dock lower-third source out using the currently loaded
   * payload, then hide/remove it after the theme's exit duration.
   */
  async animateLowerThirdOverlayUrlOut(
    _url: string,
    waitMs = FULLSCREEN_CLEAR_WAIT_MS,
    options?: { restoreProgram?: boolean; sourceName?: string },
  ): Promise<void> {
    const resources = getDockResources();
    const ltSource = options?.sourceName ?? resources.ltSource;
    // With a source per tab, only this tab's lower third goes out.
    const onlyThisSource = this._ltPerTabSources;
    const scenes = new Set<string>();
    scenes.add(DOCK_PRESENTATION_SCENE);
    try {
      const target = await this.getPresentationTargetScene("lower-third");
      if (target.sceneName) scenes.add(target.sceneName);
    } catch { /* ignore */ }
    try {
      const currentProgramScene = await this.getCurrentProgramSceneName().catch(() => "");
      if (currentProgramScene) scenes.add(currentProgramScene);
    } catch { /* ignore */ }

    // BroadcastChannel message for local/embedded browser sources
    if (!onlyThisSource) try {
      const bc1 = new BroadcastChannel("ocs-lower-third");
      bc1.postMessage({ type: "animate-out", action: "animate-out", timestamp: Date.now() });
      bc1.close();
      const bc2 = new BroadcastChannel(`ocs-lower-third:${ltSource}`);
      bc2.postMessage({ type: "animate-out", action: "animate-out", timestamp: Date.now() });
      bc2.close();
    } catch { /* ignore */ }

    let delivered = false;
    try {
      const deliveredSpecific = await this.emitBrowserOverlayPacket("lower-third", {
        action: "animate-out",
        timestamp: Date.now(),
      }, "", ltSource);
      const deliveredGlobal = !onlyThisSource && await this.emitBrowserOverlayPacket("lower-third", {
        action: "animate-out",
        timestamp: Date.now(),
      }, "");
      delivered = deliveredSpecific || deliveredGlobal;
    } catch {
      delivered = false;
    }

    if (!delivered) {
      try {
        const exitUrl = _url || await this.buildBlankedOverlayUrlFromCurrentSource(ltSource, "");
        if (!exitUrl) {
          throw new Error("No current lower-third payload is available for exit animation.");
        }
        const parsed = this.parseOverlayPayloadUrl(exitUrl);
        const overlayCss = parsed ? this.buildCssOverlayDataCss({ ...parsed.payload, blanked: true, action: "animate-out" }, "") : "";
        await this.call("SetInputSettings", {
          inputName: ltSource,
          inputSettings: {
            url: exitUrl,
            css: overlayCss,
            bgcolor: "#00000000",
            shutdown: false,
            restart_when_active: false,
            fps_custom: true,
            fps: 60,
          },
        });
        this._lastBrowserSourceUrlBySource[ltSource] = exitUrl;
        delivered = true;
      } catch {
        delivered = false;
      }
    }

    if (delivered) {
      for (const sceneName of scenes) {
        const item = await this.getSceneItemBySource(sceneName, ltSource).catch(() => null);
        if (!item) continue;
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true,
        }).catch(() => { });
      }
    }

    await this.sleep(delivered ? Math.max(waitMs, LT_EXIT_SETTLE_MS) : 0);
    if (delivered) await this.emptyLowerThirdPage(ltSource);

    // Hide only: the lower-third source stays in the scene (no delete / re-create
    // on the next send).
    for (const sceneName of scenes) {
      await this.hideOverlaySource(sceneName, ltSource);
      await this.hideFullscreenBg(sceneName, resources);
    }

    delete this._lastOverlayMode[ltSource];
    delete this._lastFullscreenSourceSignature[ltSource];
    delete this._lastCssOverlayPacketBySource[ltSource];
    delete this._lastCssOverlayBaseUrlBySource[ltSource];
    delete this._lastCssOverlayThemeCssBySource[ltSource];

    if (options?.restoreProgram !== false) {
      await this.restoreProgramSceneBeforePush("lower-third");
    }
  }

  // ── Worship lyrics overlay ──

  /**
   * Push worship lyrics to OBS as an overlay in the current scene.
   * Supports both fullscreen and lower-third overlay modes.
   */
  async pushWorshipLyrics(
    data: DockTabContentPushData,
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    return this._pushTabContent(data, "worship", options);
  }

  async pushAnnouncement(
    data: DockTabContentPushData,
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    return this._pushTabContent(data, "announcements", options);
  }

  async pushNotesLyrics(
    data: DockTabContentPushData,
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    return this._pushTabContent(data, "notes", options);
  }

  /** Shared tab-content push for worship, announcements, and notes */
  private async _pushTabContent(
    data: DockTabContentPushData,
    tab: "worship" | "announcements" | "notes",
    options?: DockOverlayFitOptions,
  ): Promise<DockOverlayFontFitMeasurement | null | undefined> {
    const isWorship = tab === "worship";
    const isNotes = tab === "notes";
    const stableCssOverlayTab = isWorship || isNotes;
    const runSerialized = isWorship
      ? this.runSerializedWorshipMutation.bind(this)
      : isNotes
        ? this.runSerializedNotesMutation.bind(this)
        : this.runSerializedAnnouncementMutation.bind(this);
    const sourceKey = isWorship ? "worshipSource" : "notesSource";
    const getInitialized = () => isWorship ? this._worshipInitialized : isNotes ? this._notesInitialized : this._announcementInitialized;
    const setInitialized = (v: boolean) => { if (isWorship) this._worshipInitialized = v; else if (isNotes) this._notesInitialized = v; else this._announcementInitialized = v; };
    const getLastPushSignature = () => isWorship ? this._lastWorshipPushSignature : isNotes ? this._lastNotesPushSignature : this._lastAnnouncementPushSignature;
    const setLastPushSignature = (v: string) => { if (isWorship) this._lastWorshipPushSignature = v; else if (isNotes) this._lastNotesPushSignature = v; else this._lastAnnouncementPushSignature = v; };

    return runSerialized(async () => {
      if (isWorship || isNotes) this.claimSharedWorshipNotesSource(isWorship ? "worship" : "notes");
      const resources = getDockResources();
      const sourceName = resources[sourceKey];
      const currentProgramSceneBeforeTarget = await this.getCurrentProgramSceneName().catch(() => "");

      // Detect mode switch early — delete old clone before getting new target
      const mode = data.overlayMode ?? "lower-third";
      this.noteIntendedMceMode(sourceName, mode);
      try {
        if (isWorship) {
          const songTitle = data.songTitle || "Worship";
          const sectionLabel = data.sectionLabel || "";
          const label = sectionLabel ? `${songTitle} · ${sectionLabel}` : songTitle;
          const snippet = (data.sectionText || "").split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
          recordPresentationHistory({
            type: "worship",
            sourceKind: "worship-song-section",
            label,
            subtitle: snippet,
            notes: data.artist,
            payloadSnapshot: {
              ...data,
              overlayMode: mode,
            },
            overlayMode: mode,
          });
        } else if (isNotes) {
          const noteTitle = (data as { noteTitle?: string }).noteTitle || data.songTitle || "Note";
          const sectionLabel = data.sectionLabel || "";
          const label = sectionLabel ? `${noteTitle} · ${sectionLabel}` : noteTitle;
          const snippet = (data.sectionText || "").split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ");
          recordPresentationHistory({
            type: "sermon",
            sourceKind: "sermon-point",
            label,
            subtitle: snippet,
            payloadSnapshot: {
              ...data,
              isNoteSlide: true,
              slideText: data.sectionText,
              noteTitle,
              overlayMode: mode,
            },
            overlayMode: mode,
          });
        }
      } catch {
        // Ignore history recording failures
      }
      const prevMode = this._lastOverlayMode[sourceName];
      const modeChanged = prevMode !== undefined && prevMode !== mode;
      const shouldRebuildSceneGraph = () => !getInitialized() || (!stableCssOverlayTab && modeChanged);

      // Fast path: if already initialized, skip the expensive clone delete +
      // re-init cycle. The overlay HTML handles mode switching via CSS opacity
      // toggle (setActiveLayer), so we can just update the packet in-place.
      if (
        (isWorship || isNotes)
        && mode === "fullscreen"
        && !modeChanged
        && getInitialized()
        && this._lastBrowserSourceUrlBySource[sourceName]
      ) {
        if (modeChanged) {
          this._lastOverlayMode[sourceName] = mode;
        }
        const backgroundOnly = Boolean(data.backgroundOnly);
        const sectionText = backgroundOnly ? "" : data.sectionText;
        const translationText = backgroundOnly ? "" : (data.translationText ?? "");
        const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
          data.bibleThemeSettings,
          data.liveOverrides,
        );
        const { cleanSettings, css } = this.stripThemeDataUris(effectiveThemeSettings);
        const themeCss = stripCompatModeCSS(css);
        const slide = sectionText ? {
          id: `dock-${tab}-slide`,
          reference: this.tabLabel(tab, data, ""),
          text: sectionText,
          translationText,
          translationOrder: data.translationOrder ?? "original-first",
          verseRange: "",
          index: 0,
          total: 1,
        } : null;
        const packet: Record<string, unknown> = {
          slide,
          theme: cleanSettings ?? null,
          live: true,
          blanked: false,
          timestamp: Date.now(),
          mode,
        };
        const cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab(tab, sourceName);

        this.publishFullscreenOverlayPacket({
          slide: (packet.slide as Record<string, unknown> | null) ?? null,
          theme: (packet.theme as Record<string, unknown> | null) ?? null,
          live: true,
          blanked: false,
          timestamp: Number(packet.timestamp) || Date.now(),
          mode,
        }, tab, themeCss, sourceName);

        await this.deliverCssOverlayPacket(sourceName, tab, packet, cssOverlayBaseUrl, themeCss);
        if (isWorship || isNotes) {
          await this.focusMcePresentationModule(isWorship ? "worship" : "notes").catch(() => { });
        }
        this._lastOverlayMode[sourceName] = mode;
        setLastPushSignature("");
        if (options?.waitForFit) {
          return this.waitForOverlayRenderMeasurement(
            tab,
            Number(packet.timestamp) || Date.now(),
            mode,
            options.timeoutMs ?? 700,
            sourceName,
          );
        }
        return null;
      }

      if (modeChanged && !stableCssOverlayTab) {
        try {
          const previewScene = await this.getCurrentPreviewSceneName().catch(() => "");
          const tabPreviewName = TAB_PREVIEW_SCENE_NAMES[tab];
          if (previewScene === tabPreviewName) {
            const previewState = this.getStoredPreviewSceneStateForTab(tab);
            const original = previewState?.originalSceneName
              || this.getPreviewBaseSceneName(previewScene);
            if (original) {
              await this.setCurrentPreviewScene(original);
              await this.waitForSceneMatch("preview", original).catch(() => { });
            }
          }
        } catch { /* ignore */ }
        await this.deleteClone(undefined, tab).catch(() => { });
        setInitialized(false);
        setLastPushSignature("");
      }

      const target = mode === "lower-third"
        ? await this.getPresentationTargetScene(tab, { activate: false })
        : await this.getTargetScene(tab);
      const sceneName = target.sceneName;
      if (!sceneName) throw new Error("Could not determine the current OBS scene.");
      const presentationLive = mode === "fullscreen" && !target.studioMode;

      // Ensure the live program scene is visible behind overlays in MCE Presentation
      await this.ensureProgramSceneAsSourceInPresentation();

      // Dedup: skip identical pushes
      const pushSignature = this.buildWorshipPushSignature(
        sceneName,
        currentProgramSceneBeforeTarget,
        data,
      );
      if (pushSignature === getLastPushSignature()) {
        const recoveryScene = mode === "fullscreen" ? resources.worshipScene : sceneName;
        await this.ensureOverlaySource(
          recoveryScene,
          sourceName,
          undefined,
          undefined,
          stableCssOverlayTab ? "keep" : true,
        ).catch(() => { });
        if (!stableCssOverlayTab) {
          await this.ensureActiveMceOverlaySource(
            recoveryScene,
            sourceName,
            [sourceName],
            resources,
          ).catch(() => { });
        }

        if (mode === "fullscreen" && !presentationLive && resources.worshipScene !== sceneName) {
          await this.ensureSceneSourceInTarget(sceneName, resources.worshipScene, true).catch(() => { });
        }

        const cachedPacket = this._lastCssOverlayPacketBySource[sourceName];
        const cachedBaseUrl = this._lastCssOverlayBaseUrlBySource[sourceName];
        if (cachedPacket && cachedBaseUrl) {
          await this.deliverCssOverlayPacket(
            sourceName,
            tab,
            // Fresh timestamp: the overlay only accepts packets at least as new
            // as the last one it saw (e.g. after a blank/clear).
            { ...cachedPacket, timestamp: Date.now() },
            cachedBaseUrl,
            this._lastCssOverlayThemeCssBySource[sourceName] || "",
          ).catch(() => { });
        }
        if (mode === "fullscreen") {
          await this.fitSceneSourceToCanvas(resources.worshipScene, sourceName).catch(() => { });
        } else {
          await this.fitSceneSourceToLowerThirdWindow(recoveryScene, sourceName).catch(() => { });
        }

        if (stableCssOverlayTab) {
          await this.ensureActiveMceOverlaySource(
            recoveryScene,
            sourceName,
            [sourceName],
            resources,
          ).catch(() => { });
          await this.focusMcePresentationModule(isWorship ? "worship" : "notes").catch(() => { });
        }
        await this.promotePresentationScene(tab).catch(() => { });
        return;
      }

      const backgroundOnly = Boolean(data.backgroundOnly);
      const sectionText = backgroundOnly ? "" : data.sectionText;
      const translationText = backgroundOnly ? "" : (data.translationText ?? "");
      // Keep worship section labels available in the operator UI, but do not
      // render them into OBS preview/program overlays.
      const sectionLabel = backgroundOnly
        ? ""
        : (isWorship ? "" : cleanWorshipObsLabel(data.sectionLabel));
      const effectiveThemeSettings = this.mergeThemeSettingsWithLiveOverrides(
        data.bibleThemeSettings,
        data.liveOverrides,
      );
      this._lastOverlayMode[sourceName] = mode;

      let url: string;
      let themeCss = "";
      let cssOverlayPacket: Record<string, unknown> | null = null;
      let cssOverlayBaseUrl = "";
      let useCssOverlayTransport = false;

      if (mode === "fullscreen") {
        const { cleanSettings, css } = this.stripThemeDataUris(effectiveThemeSettings);
        themeCss = stripCompatModeCSS(css);
        const slide = sectionText ? {
          id: `dock-${tab}-slide`,
          reference: this.tabLabel(tab, data, ""),
          text: sectionText,
          translationText,
          verseRange: sectionLabel,
          index: 0,
          total: 1,
        } : null;
        const packet = {
          slide,
          theme: cleanSettings ?? null,
          live: true,
          blanked: false,
          timestamp: Date.now(),
          mode,
        };

        this._hasSeparateFullscreenBg(effectiveThemeSettings);
        cssOverlayPacket = packet;
        cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab(tab, sourceName);
        useCssOverlayTransport = true;
        url = `${cssOverlayBaseUrl}#data=${encodeURIComponent(JSON.stringify(packet))}`;

        if (shouldRebuildSceneGraph()) {
          await this.clearAllOverlays([resources.worshipScene, resources.fsBgSource], sceneName, resources);
          await this.hideOverlaySource(sceneName, sourceName);
          await this._hideLowerThirdBgSource(sceneName).catch(() => { });
          await this.ensureDedicatedScene(resources.worshipScene);
          await this.ensureOverlaySource(resources.worshipScene, sourceName, undefined, undefined, false, packet, themeCss);
          // Use browser overlay CSS for background; hide separate fullscreen
          // BG sources to keep the browser + background as a single OBS source.
          await this._hideFullscreenBgSource("worship");
          if (!this.isPromotedPreviewScene(sceneName, currentProgramSceneBeforeTarget) && resources.worshipScene !== PRESENTATION_SCENE_NAME) {
            await this.removeFromProgramIfExists(resources.worshipScene);
          }
          if (!presentationLive && resources.worshipScene !== sceneName) {
            await this.ensureSceneSourceInTarget(sceneName, resources.worshipScene, true);
          }
          if (!presentationLive) {
            await this.ensureFullscreenTargetBg(sceneName, resources.worshipScene, effectiveThemeSettings, true, resources);
          }
          setInitialized(true);
        } else {
          // "keep": never hide an already-visible Worship/Notes source between
          // slides (that caused an off/on flicker on every click); a new item
          // still starts hidden until its packet has been delivered.
          await this.ensureOverlaySource(resources.worshipScene, sourceName, undefined, undefined, "keep", packet, themeCss).catch(() => { });
          // Ensure no separate fullscreen BG inputs are left behind; the
          // background will be rendered via the browser overlay CSS.
          await this._hideFullscreenBgSource("worship");
          if (!presentationLive) {
            await this.ensureFullscreenTargetBg(sceneName, resources.worshipScene, effectiveThemeSettings, true, resources);
          }
        }

        // Keep the overlay browser source hidden until its new packet has been
        // delivered. Visibility is reconciled after delivery below.
        await this.fitSceneSourceToOverlayMode(resources.worshipScene, sourceName, mode).catch(() => { });
      } else {
        // ── OBS lower-third theme path (custom HTML/CSS themes) ──
        if (data.ltTheme) {
          const ltThemeRef: DockLTThemeRef = {
            id: data.ltTheme.id,
            html: data.ltTheme.html,
            css: data.ltTheme.css,
          };
          const values = data.values ?? {};
          url = this.buildLowerThirdUrl(values, false, false, ltThemeRef);
          useCssOverlayTransport = false;

          if (shouldRebuildSceneGraph()) {
            await this.clearAllOverlays(sourceName, sceneName, resources);
            await this.hideSceneSource(sceneName, resources.worshipScene);
            await this.hideFullscreenBg(sceneName, resources);
            await this._hideLowerThirdBgSource(sceneName).catch(() => { });
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true);
            setInitialized(true);
          } else {
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true).catch(() => { });
          }

          if (!stableCssOverlayTab) {
            await this.ensureActiveMceOverlaySource(
              sceneName,
              sourceName,
              [sourceName],
              resources,
            );
          }
        } else if (effectiveThemeSettings) {
          const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(effectiveThemeSettings);
          const { cleanSettings: wltClean, css } = this.stripThemeDataUris(overlayTheme);
          themeCss = stripCompatModeCSS(css);
          const slide = this.buildBibleSlide(sectionText, this.tabLabel(tab, data, sectionLabel), "", translationText, data.translationOrder);
          cssOverlayPacket = {
            slide,
            theme: wltClean ?? null,
            live: true,
            blanked: false,
            timestamp: Date.now(),
            mode,
          };
          cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab(tab, sourceName);
          useCssOverlayTransport = true;
          url = `${cssOverlayBaseUrl}#data=${encodeURIComponent(JSON.stringify(cssOverlayPacket))}`;

          if (shouldRebuildSceneGraph()) {
            await this.clearAllOverlays(sourceName, sceneName, resources);
            await this.hideSceneSource(sceneName, resources.worshipScene);
            await this.hideFullscreenBg(sceneName, resources);
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true, cssOverlayPacket, themeCss);
            setInitialized(true);
          } else {
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true, cssOverlayPacket, themeCss).catch(() => { });
          }

          // Background is rendered by the browser overlay; hide any
          // lower-third BG inputs and only activate the browser source.
          await this._hideLowerThirdBgSource(sceneName).catch(() => { });
          if (!stableCssOverlayTab) {
            await this.ensureActiveMceOverlaySource(sceneName, sourceName, [sourceName], resources);
          }
        } else {
          const slide = this.buildBibleSlide(sectionText, this.tabLabel(tab, data, sectionLabel), "", translationText, data.translationOrder);
          cssOverlayPacket = {
            slide,
            theme: null,
            live: true,
            blanked: false,
            timestamp: Date.now(),
            mode,
          };
          cssOverlayBaseUrl = this.buildCssOverlayHtmlUrlForTab(tab, sourceName);
          useCssOverlayTransport = true;
          url = `${cssOverlayBaseUrl}#data=${encodeURIComponent(JSON.stringify(cssOverlayPacket))}`;

          if (shouldRebuildSceneGraph()) {
            await this.clearAllOverlays(sourceName, sceneName, resources);
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true, cssOverlayPacket, themeCss);
            setInitialized(true);
          } else {
            await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, stableCssOverlayTab ? "keep" : true, cssOverlayPacket, themeCss).catch(() => { });
          }

          await this.hideFullscreenBg(sceneName, resources);
          await this.hideSceneSource(sceneName, resources.worshipScene);

          if (!stableCssOverlayTab) {
            await this.ensureActiveMceOverlaySource(
              sceneName,
              sourceName,
              [sourceName],
              resources,
            );
          }
        }
      }
      if (mode === "lower-third") {
        await this.fitSceneSourceToOverlayMode(sceneName, sourceName, mode).catch(() => { });
      }

      if (useCssOverlayTransport && cssOverlayPacket) {
        this.publishFullscreenOverlayPacket({
          slide: (cssOverlayPacket.slide as Record<string, unknown> | null) ?? null,
          theme: (cssOverlayPacket.theme as Record<string, unknown> | null) ?? null,
          live: true,
          blanked: Boolean(cssOverlayPacket.blanked),
          timestamp: Number(cssOverlayPacket.timestamp) || Date.now(),
          mode: String(mode || "fullscreen"),
        }, tab, themeCss, sourceName);
        await this.deliverCssOverlayPacket(
          sourceName,
          tab,
          cssOverlayPacket,
          cssOverlayBaseUrl,
          themeCss,
        );
        if (mode === "fullscreen") {
          await this.fitSceneSourceToOverlayMode(resources.worshipScene, sourceName, mode).catch(() => { });
        }
      } else {
        await this.setBrowserSourceUrl(sourceName, url, modeChanged, themeCss || undefined);
      }

      if (stableCssOverlayTab) {
        const activeScene = mode === "fullscreen" ? resources.worshipScene : sceneName;
        await this.ensureActiveMceOverlaySource(
          activeScene,
          sourceName,
          [sourceName],
          resources,
        ).catch(() => { });

        // The packet is now current. Only after that do we isolate this tab's
        // source and move the presentation into the live output.
        await this.focusMcePresentationModule(isWorship ? "worship" : "notes").catch(() => { });
        if (mode === "fullscreen" && presentationLive) {
          await this.promotePresentationScene(tab).catch(() => { });
        }
      }

      let renderMeasurement: DockOverlayFontFitMeasurement | null = null;
      if (useCssOverlayTransport && cssOverlayPacket) {
        const renderTimestamp = Number(cssOverlayPacket.timestamp) || Date.now();
        if (options?.waitForFit) {
          renderMeasurement = await this.waitForOverlayRenderMeasurement(
            tab,
            renderTimestamp,
            mode,
            options.timeoutMs ?? 700,
            sourceName,
          ).catch(() => null);
        } else if (mode === "lower-third") {
          await this.waitForOverlayRenderAck(
            tab,
            renderTimestamp,
            mode,
            500,
            undefined,
            sourceName,
          ).catch(() => { });
        }
      }

      if (mode === "lower-third") {
        await this.promotePresentationScene(tab).catch(() => { });
        await this.fitSceneSourceToOverlayMode(PRESENTATION_SCENE_NAME, sourceName, mode).catch(() => { });
        if (modeChanged) {
          await this.setSceneSourceEnabledByName(PRESENTATION_SCENE_NAME, sourceName, true).catch(() => { });
          if (sceneName !== PRESENTATION_SCENE_NAME) {
            await this.setSceneSourceEnabledByName(sceneName, sourceName, true).catch(() => { });
          }
        }
      }

      setLastPushSignature(pushSignature);
      return renderMeasurement;
    });
  }

  async clearAnnouncement(): Promise<void> {
    return this.runSerializedNotesMutation(async () => {
      this._lastNotesPushSignature = "";
      const resources = getDockResources();
      const sourceName = resources.notesSource;
      const scene = PRESENTATION_SCENE_NAME;
      const batchRequests = [
        ...(await this._buildHideBatchRequests(scene, [sourceName])),
      ];

      if (batchRequests.length > 0) {
        await this.callBatch(batchRequests, 2).catch(() => { });
        this.invalidateSceneItemListCache(scene);
        this.invalidateActiveMceOverlayState(scene);
      }

      await this.deleteClone(undefined, "notes").catch(() => { });
      this._notesInitialized = false;
    });
  }

  /**
   * Clear worship lyrics — hide all worship sources via a single callBatch.
   *
   * Previous implementation fired 12+ individual SetSceneItemEnabled calls
   * through the rate limiter. This version resolves all source names to item
   * IDs via the scene-item cache, then sends one batched WebSocket frame.
   */
  async clearWorshipLyrics(): Promise<void> {
    return this.runSerializedWorshipMutation(async () => {
      this._lastWorshipPushSignature = "";
      // Notes are on air on the shared source: clearing Worship leaves them there.
      if (this.isSharedWorshipNotesSourceHeldByOther("worship")) return;
      const resources = getDockResources();
      const scene = PRESENTATION_SCENE_NAME;
      const ltBg = this._ltBgNames(scene);
      const fsBg = this.getTargetFullscreenBgSourceName(scene, resources);

      // ── Phase 1: collect all source names per scene ──

      const presentationNames: string[] = [
        SOURCE_NAMES.WORSHIP,
        BG_SOURCE_NAMES.WORSHIP,
        FULLSCREEN_SOURCE_NAMES.WORSHIP,
        FULLSCREEN_BG_SOURCE_NAMES.WORSHIP,
        resources.worshipSource,
        resources.worshipScene,
        resources.fsBgSource,
        fsBg,
        ltBg.a,
        ltBg.b,
      ];

      const currentScene = await this.getCurrentProgramSceneName(true).catch(() => "");
      let currentNames: string[] = [];
      if (currentScene && currentScene !== scene) {
        const curLtBg = this._ltBgNames(currentScene);
        const curFsBg = this.getTargetFullscreenBgSourceName(currentScene, resources);
        currentNames = [
          resources.worshipSource,
          resources.worshipScene,
          resources.fsBgSource,
          curFsBg,
          curLtBg.a,
          curLtBg.b,
        ];
      }

      // ── Phase 2: resolve IDs + send single batch ──

      const batchRequests = [
        ...(await this._buildHideBatchRequests(scene, presentationNames)),
        ...(currentNames.length > 0
          ? await this._buildHideBatchRequests(currentScene, currentNames)
          : []),
      ];

      if (batchRequests.length > 0) {
        await this.callBatch(batchRequests, 2 /* Parallel */).catch(() => { });
        // Empty the hidden lyrics document so the next song can't flash these lines.
        this.emitBlankPacketToHiddenSource("worship", resources.worshipSource);
        // Invalidate caches since items were toggled
        this.invalidateSceneItemListCache(scene);
        this.invalidateActiveMceOverlayState(scene);
        if (currentScene && currentScene !== scene) {
          this.invalidateSceneItemListCache(currentScene);
          this.invalidateActiveMceOverlayState(currentScene);
        }
      }

      // ── Phase 3: remaining cleanup (non-hide operations) ──

      // Keep MCE Presentation inside managed Multiview scenes. It is the
      // user's last-added presentation layer, not a temporary overlay item.
      if (currentScene && currentScene !== scene) {
        const fsDef = this._fullscreenSceneDefs["worship"];
        if (fsDef && !DockObsClient.isManagedMultiviewSceneName(currentScene)) {
          try {
            const items = await this.getSceneItemListCached(currentScene);
            const fsItems = items.filter((i) => i.sourceName.startsWith(fsDef.sceneName));
            for (const item of fsItems) {
              await this.call("RemoveSceneItem", { sceneName: currentScene, sceneItemId: item.sceneItemId });
              this.invalidateSceneItemListCache(currentScene);
            }
          } catch { /* ignore */ }
        }
      }

      // Clean up the worship clone scene (studio mode)
      await this.deleteClone(undefined, "worship").catch(() => { });

      // Restore Program scene to what it was before Worship was pushed
      await this.restoreProgramSceneBeforePush("worship");

      // Reset so next push does full setup (the source is shared with Notes)
      this._worshipInitialized = false;
      this._notesInitialized = false;
      this._sharedWorshipNotesOwner = null;
      if (this._lastActivePresentationSource === resources.worshipSource) {
        this._lastActivePresentationSource = null;
      }
      this.publishBlankFullscreenOverlayPacket("worship", "lower-third", getDockResources().worshipSource);
    });
  }

  async clearNotesLyrics(): Promise<void> {
    return this.runSerializedNotesMutation(async () => {
      this._lastNotesPushSignature = "";
      // Worship is on air on the shared source: clearing Notes leaves it there.
      if (this.isSharedWorshipNotesSourceHeldByOther("notes")) return;
      const resources = getDockResources();
      const scene = PRESENTATION_SCENE_NAME;
      const ltBg = this._ltBgNames(scene);
      const fsBg = this.getTargetFullscreenBgSourceName(scene, resources);

      const presentationNames: string[] = [
        SOURCE_NAMES.NOTES,
        BG_SOURCE_NAMES.NOTES,
        FULLSCREEN_SOURCE_NAMES.NOTES,
        FULLSCREEN_BG_SOURCE_NAMES.NOTES,
        resources.notesSource,
        resources.worshipScene,
        resources.fsBgSource,
        fsBg,
        ltBg.a,
        ltBg.b,
      ];

      const currentScene = await this.getCurrentProgramSceneName(true).catch(() => "");
      let currentNames: string[] = [];
      if (currentScene && currentScene !== scene) {
        const curLtBg = this._ltBgNames(currentScene);
        const curFsBg = this.getTargetFullscreenBgSourceName(currentScene, resources);
        currentNames = [
          resources.notesSource,
          resources.worshipScene,
          resources.fsBgSource,
          curFsBg,
          curLtBg.a,
          curLtBg.b,
        ];
      }

      const batchRequests = [
        ...(await this._buildHideBatchRequests(scene, presentationNames)),
        ...(currentNames.length > 0
          ? await this._buildHideBatchRequests(currentScene, currentNames)
          : []),
      ];

      if (batchRequests.length > 0) {
        await this.callBatch(batchRequests, 2).catch(() => { });
        this.invalidateSceneItemListCache(scene);
        this.invalidateActiveMceOverlayState(scene);
        if (currentScene && currentScene !== scene) {
          this.invalidateSceneItemListCache(currentScene);
          this.invalidateActiveMceOverlayState(currentScene);
        }
      }

      if (currentScene && currentScene !== scene) {
        const fsDef = this._fullscreenSceneDefs["notes"];
        if (fsDef && !DockObsClient.isManagedMultiviewSceneName(currentScene)) {
          try {
            const items = await this.getSceneItemListCached(currentScene);
            const fsItems = items.filter((i) => i.sourceName.startsWith(fsDef.sceneName));
            for (const item of fsItems) {
              await this.call("RemoveSceneItem", { sceneName: currentScene, sceneItemId: item.sceneItemId });
              this.invalidateSceneItemListCache(currentScene);
            }
          } catch { /* ignore */ }
        }
      }

      await this.deleteClone(undefined, "notes").catch(() => { });
      await this.restoreProgramSceneBeforePush("notes");
      this._notesInitialized = false;
      this._worshipInitialized = false;
      this._sharedWorshipNotesOwner = null;
      if (this._lastActivePresentationSource === resources.notesSource) {
        this._lastActivePresentationSource = null;
      }
      this.publishBlankFullscreenOverlayPacket("notes", "lower-third", getDockResources().notesSource);
    });
  }

  // ── Ticker overlay ──

  /**
   * Build a ticker overlay URL using the lower-third overlay renderer.
   * Maps badge + tickerText to the theme's template variables.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   */
  private buildTickerUrl(
    badge: string,
    tickerText: string,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? getDefaultLTTheme();
    const payload = {
      themeId: t.id,
      html: t.html,
      css: stripCompatModeCSS(t.css),
      values: {
        badge: badge || "Church News",
        tickerText: tickerText || "",
        name: badge || "Church News",
        role: tickerText || "",
        title: badge,
        subtitle: tickerText,
        text: tickerText,
        headline: badge,
        details: tickerText,
        line1: badge,
        line2: tickerText,
      },
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 100,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-center",
      animationIn: "slide-up",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.buildOverlayHtmlUrl("lower-third-overlay.html")}#data=${encoded}`;
  }

  /**
   * Push a ticker to OBS as an overlay in the current scene.
   */
  async pushTicker(data: {
    badge: string;
    tickerText: string;
    ltTheme?: DockLTThemeRef;
  }): Promise<void> {
    const resources = getDockResources();
    const sceneName = DOCK_PRESENTATION_SCENE;

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    // Clear all OTHER overlays first so previous overlay doesn't persist
    await this.clearAllOverlays(resources.tickerSource, sceneName, resources);

    await this.ensureOverlaySource(sceneName, resources.tickerSource, undefined, undefined, true);
    await this.applyMcePresentationSourceVisibility(resources.tickerSource).catch(() => { });
    const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, "ticker");

    const url = this.buildTickerUrl(
      data.badge,
      data.tickerText,
      false,
      false,
      resolvedLTTheme,
    );

    await this.setBrowserSourceUrl(resources.tickerSource, url);
    await this.promotePresentationScene("ministry").catch(() => { });

  }

  /**
   * Push the Dock's fully-rendered ticker HTML through the same OBS ticker
   * source used by the Ministry tab. The mobile companion uses this instead
   * of the legacy lower-third ticker URL so theme, divider, spacing, and
   * branding remain identical on every control surface.
   */
  async pushDockTickerHtml(data: {
    html: string;
    position: "top" | "bottom";
  }): Promise<void> {
    const resources = getDockResources();
    const sceneName = DOCK_PRESENTATION_SCENE;
    const tickerHeight = 80;

    await this.ensureProgramSceneAsSourceInPresentation();
    await this.clearAllOverlays(resources.tickerSource, sceneName, resources);

    const canvas = await this.getCanvasSize();
    await this.ensureOverlaySource(
      sceneName,
      resources.tickerSource,
      canvas.width,
      tickerHeight,
      true,
    );
    await this.applyMcePresentationSourceVisibility(resources.tickerSource).catch(() => { });

    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(data.html);
    await this.setBrowserSourceUrl(resources.tickerSource, dataUrl);

    const items = await this.getSceneItemListCached(sceneName);
    const tickerItem = items.find((item) => item.sourceName === resources.tickerSource);
    if (tickerItem) {
      await this.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId: tickerItem.sceneItemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: data.position === "top" ? 0 : canvas.height - tickerHeight,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width,
          boundsHeight: tickerHeight,
          boundsAlignment: 0,
          cropLeft: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
        },
      });
    }

    await this.ensureTickerAboveSource(sceneName, resources.tickerSource).catch(() => { });
    await this.syncLowerThirdTickerClearance(sceneName).catch(() => { });
    await this.promotePresentationScene("ministry").catch(() => { });
  }

  async pushTickerToScene(data: {
    badge: string;
    tickerText: string;
    ltTheme?: DockLTThemeRef;
  }, sceneName: string): Promise<void> {
    const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, "ticker");
    await this.pushSceneRouteBrowserSource({
      module: "ticker",
      sceneName,
      url: this.buildTickerUrl(data.badge, data.tickerText, false, false, resolvedLTTheme),
    });
  }

  // ── State Recovery ──

  /**
   * Scan OBS for currently-active overlay sources created by the dock.
   * Reconstructs live state from either the browser-source CSS payload or the
   * older URL hash payload, then restores staged/live state after a restart.
   */
  async recoverLiveState(): Promise<{
    bible: {
      reference: string;
      text: string;
      overlayMode: string;
      compare: {
        enabled: boolean;
        mode: string;
        layout: string;
        columns: Array<{
          book: string;
          chapter: number;
          verse: number;
          verseEnd: number;
          verseRange: string;
          referenceLabel: string;
          translation: string;
          verseText: string;
        }>;
      } | null;
    } | null;
    worship: { sectionLabel: string; sectionText: string; translationText?: string; songTitle: string; artist: string; overlayMode: string } | null;
    lowerThird: { name: string; role: string } | null;
  }> {
    const result: {
      bible: {
        reference: string;
        text: string;
        overlayMode: string;
      compare: {
        enabled: boolean;
        mode: string;
        layout: string;
          columns: Array<{
            book: string;
            chapter: number;
            verse: number;
            verseEnd: number;
            verseRange: string;
            referenceLabel: string;
            translation: string;
            verseText: string;
          }>;
        } | null;
      } | null;
      worship: { sectionLabel: string; sectionText: string; translationText?: string; songTitle: string; artist: string; overlayMode: string } | null;
      lowerThird: { name: string; role: string } | null;
    } = { bible: null, worship: null, lowerThird: null };

    if (!this.isConnected) return result;

    const sourcesToCheck: Array<{ name: string; type: "bible" | "worship" | "notes" | "lowerThird" }> = [
      { name: this._fullscreenSceneDefs["bible"].browserSourceName, type: "bible" },
      { name: DOCK_WORSHIP_SOURCE, type: "worship" },
      // Worship and Notes share one source: it is read once below, and the page
      // it has loaded says which of the two is on it.
      ...(DOCK_NOTES_SOURCE !== DOCK_WORSHIP_SOURCE
        ? [{ name: DOCK_NOTES_SOURCE, type: "notes" as const }]
        : []),
      { name: DOCK_LT_SOURCE, type: "lowerThird" },
    ];

    let inputNames = new Set<string>();
    let currentProgramScene = "";
    let currentSceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled?: boolean }> = [];
    try {
      const inputList = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string }>;
      };
      inputNames = new Set((inputList.inputs ?? []).map((input) => String(input.inputName || "").trim()).filter(Boolean));
    } catch {
      return result;
    }

    try {
      currentProgramScene = await this.getCurrentProgramSceneName().catch(() => "");
      if (currentProgramScene) {
        const items = await this.call("GetSceneItemList", { sceneName: currentProgramScene }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled?: boolean }>;
        };
        currentSceneItems = items.sceneItems ?? [];
      }
    } catch {
      currentProgramScene = "";
      currentSceneItems = [];
    }

    for (const { name, type: checkedType } of sourcesToCheck) {
      try {
        if (!inputNames.has(name)) continue;

        const resp = await this.call("GetInputSettings", { inputName: name }) as {
          inputSettings: { url?: string; css?: string };
        };
        const url = resp.inputSettings?.url || "";
        const documentUrl = this.normalizeBrowserSourceDocumentUrl(url);
        if (documentUrl) {
          this._lastBrowserSourceUrlBySource[name] = documentUrl;
        }
        const type: "bible" | "worship" | "notes" | "lowerThird" =
          checkedType === "worship" && name === DOCK_NOTES_SOURCE && isNotesOverlayDocumentUrl(documentUrl)
            ? "notes"
            : checkedType;
        const cssPacket = this.extractOverlayPacketFromCss(resp.inputSettings?.css);
        const urlPacket = url && url !== "about:blank" && url.includes("#data=")
          ? (() => {
            try {
              const encoded = url.split("#data=")[1];
              return encoded ? JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown> : null;
            } catch {
              return null;
            }
          })()
          : null;
        const data = cssPacket ?? urlPacket;
        if (!data) continue;

        // Rebuild the in-memory transport cache from the packet that is
        // already inside OBS. A Dock reload must reuse the live browser
        // document; otherwise the first click after reconnect takes the full
        // bootstrap path, which can briefly reveal a stale verse/background
        // or make the source appear to turn off.
        const recoveredTab: CssOverlayPacketTab =
          type === "worship" ? "worship" : type === "notes" ? "notes" : "bible";
        const recoveredBaseUrl = this.buildCssOverlayHtmlUrlForTab(recoveredTab, name);
        this.rememberCssOverlayTransport(name, data, recoveredBaseUrl, "", recoveredTab);
        const recoveredMode = data.mode === "fullscreen" || data.mode === "lower-third"
          ? data.mode
          : type === "bible"
            ? "fullscreen"
            : "lower-third";
        if (type === "bible") {
          this._lastBibleMode = recoveredMode;
          if (recoveredMode === "lower-third") this._bibleLtInitialized = true;
        } else if (type === "worship") {
          if (recoveredMode === "lower-third") this._worshipInitialized = true;
        } else if (type === "notes") {
          if (recoveredMode === "lower-third") this._notesInitialized = true;
        }

        let isEnabled = false;
        if (currentProgramScene === PRESENTATION_SCENE_NAME) {
          const item = currentSceneItems.find((sceneItem) => sceneItem.sourceName === name);
          isEnabled = item?.sceneItemEnabled !== false;
        } else {
          const presentationItem = currentSceneItems.find((sceneItem) => sceneItem.sourceName === PRESENTATION_SCENE_NAME);
          const directItem = currentSceneItems.find((sceneItem) => sceneItem.sourceName === name);
          if (directItem) {
            isEnabled = directItem.sceneItemEnabled !== false;
          } else if (type === "bible" && presentationItem) {
            isEnabled = presentationItem.sceneItemEnabled !== false;
          }
        }

        if (!isEnabled) continue;
        if (data.blanked) continue; // Source exists but is blanked — treat as cleared
        if (type === "worship" || type === "notes") this._sharedWorshipNotesOwner = type;

        if (type === "bible") {
          // Fullscreen bible has data.slide, LT bible has data.values
          const slide = data.slide && typeof data.slide === "object"
            ? data.slide as Record<string, unknown>
            : null;
          const values = data.values && typeof data.values === "object"
            ? data.values as Record<string, unknown>
            : null;
          if (slide) {
            const rawCompareColumns: unknown[] = Array.isArray(slide.columns) ? slide.columns : [];
            const compareColumns = rawCompareColumns
              .filter((column): column is Record<string, unknown> => Boolean(column) && typeof column === "object")
              .map((column) => ({
                book: typeof column.book === "string" ? column.book : "",
                chapter: typeof column.chapter === "number" ? column.chapter : 0,
                verse: typeof column.verse === "number" ? column.verse : 0,
                verseEnd: typeof column.verseEnd === "number"
                  ? column.verseEnd
                  : typeof column.verse === "number"
                    ? column.verse
                    : 0,
                verseRange: typeof column.verseRange === "string" ? column.verseRange : "",
                referenceLabel: typeof column.reference === "string" ? column.reference : "",
                translation: typeof column.translation === "string" ? column.translation : "",
                verseText: typeof column.text === "string" ? column.text : "",
              }))
              .filter((column) => column.book && column.chapter > 0 && column.verse > 0);
            result.bible = {
              reference: typeof slide.reference === "string" ? slide.reference : "",
              text: typeof slide.text === "string" ? slide.text : "",
              overlayMode:
                typeof data.mode === "string" && (data.mode === "lower-third" || data.mode === "fullscreen")
                  ? data.mode
                  : url.includes("lower-third")
                    ? "lower-third"
                    : "fullscreen",
              compare:
                slide.layout === "compare"
                  && (slide.compareMode === "passages"
                    ? compareColumns.length >= 2
                    : compareColumns.length === 2)
                  ? {
                    enabled: true,
                    mode: slide.compareMode === "passages" ? "passages" : "translations",
                    layout: typeof slide.compareLayout === "string"
                      ? slide.compareLayout
                      : "line-by-line",
                    columns: compareColumns as Array<{
                      book: string;
                      chapter: number;
                      verse: number;
                      verseEnd: number;
                      verseRange: string;
                      referenceLabel: string;
                      translation: string;
                      verseText: string;
                    }>,
                  }
                  : null,
            };
          } else if (values) {
            result.bible = {
              reference:
                typeof values.reference === "string"
                  ? values.reference
                  : typeof values.role === "string"
                    ? values.role
                    : "",
              text:
                typeof values.name === "string"
                  ? values.name
                  : typeof values.text === "string"
                    ? values.text
                    : "",
              overlayMode: "lower-third",
              compare: null,
            };
          }
        } else if (type === "worship") {
          const slide = data.slide && typeof data.slide === "object"
            ? data.slide as Record<string, unknown>
            : null;
          const values = data.values && typeof data.values === "object"
            ? data.values as Record<string, unknown>
            : null;
          if (slide) {
            // Fullscreen worship (uses bible fullscreen overlay)
            const ref = String(slide.reference || "").split(" · ");
            result.worship = {
              sectionLabel: ref[1] || String(slide.verseRange || ""),
              sectionText: typeof slide.text === "string" ? slide.text : "",
              translationText: typeof slide.translationText === "string" ? slide.translationText : "",
              songTitle: (ref[0] || "").split(" — ")[0] || "",
              artist: (ref[0] || "").split(" — ")[1] || "",
              overlayMode: "fullscreen",
            };
          } else if (values) {
            // LT worship
            result.worship = {
              sectionLabel:
                typeof values.label === "string"
                  ? values.label
                  : typeof values.role === "string"
                    ? values.role
                    : "",
              sectionText:
                typeof values.lyrics === "string"
                  ? values.lyrics
                  : typeof values.text === "string"
                    ? values.text
                    : typeof values.name === "string"
                      ? values.name
                      : "",
              translationText: typeof values.translationText === "string" ? values.translationText : "",
              songTitle:
                typeof values.songName === "string"
                  ? values.songName
                  : typeof values.title === "string"
                    ? values.title
                    : "",
              artist: typeof values.artist === "string" ? values.artist : "",
              overlayMode: "lower-third",
            };
          }
        } else if (type === "lowerThird") {
          const values = data.values && typeof data.values === "object"
            ? data.values as Record<string, unknown>
            : null;
          if (values) {
            result.lowerThird = {
              name: typeof values.name === "string" ? values.name : "",
              role: typeof values.role === "string" ? values.role : "",
            };
          }
        }
      } catch (err) {
        console.warn(`[DockOBS] Failed to recover state for "${name}":`, err);
      }
    }

    return result;
  }

  // ── Media playback ──

  /**
   * Push a church-service Live Tool to the target scene.
   */
  async pushLiveTool(tool: LiveToolTemplate): Promise<void> {
    if (tool.kind === "scene" && tool.sceneName) {
      await this.switchScene(tool.sceneName);
      return;
    }

    if (tool.kind === "scene") {
      throw new Error("Choose an OBS scene in the app before using this tool.");
    }

    if (tool.kind === "safety-action") {
      await this.runLiveToolSafetyAction(tool);
      return;
    }

    if (tool.kind === "media-loop" && tool.backgroundMediaPath) {
      await this.pushLiveToolMedia(tool);
      return;
    }

    await this.pushLiveToolOverlay(tool);
  }

  private getLiveToolSources() {
    return {
      overlaySource: DOCK_LIVE_TOOL_SOURCE,
      videoSource: DOCK_LIVE_TOOL_MEDIA_VIDEO_SOURCE,
      imageSource: DOCK_LIVE_TOOL_MEDIA_IMAGE_SOURCE,
    };
  }

  private buildLiveToolOverlayUrl(tool: LiveToolTemplate): string {
    const payload: LiveToolOverlayPayload = {
      kind: tool.kind,
      label: tool.label,
      title: tool.title,
      subtitle: tool.subtitle,
      body: tool.body,
      cta: tool.cta,
      durationSeconds: tool.durationSeconds,
      backgroundColor: tool.backgroundColor,
      backgroundMediaUrl: tool.backgroundMediaUrl,
      lowerThird: tool.kind === "lower-third",
      timestamp: Date.now(),
    };
    return `${this.getOverlayBaseUrl()}/live-tool-overlay.html#data=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  private async getResolvedLiveToolScene(): Promise<string> {
    const target = await this.getTargetScene();
    if (!target.sceneName) throw new Error("Could not determine the current OBS scene.");
    return target.sceneName;
  }

  private async switchScene(sceneName: string): Promise<void> {
    const studioMode = await this.isStudioModeEnabled();
    if (studioMode) {
      try {
        await this.call("SetStudioModeEnabled", { studioModeEnabled: true });
        await this.sleep(150);
      } catch { /* ignore */ }
      await this.setCurrentPreviewScene(sceneName);
    } else {
      await this.call("SetCurrentProgramScene", { sceneName });
    }
  }

  private async pushLiveToolOverlay(tool: LiveToolTemplate): Promise<void> {
    const sources = this.getLiveToolSources();
    const sceneName = await this.getResolvedLiveToolScene();

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    await this.hideMediaSourceWithAnimation(sceneName, sources.videoSource);
    await this.hideMediaSourceWithAnimation(sceneName, sources.imageSource);
    await this.ensureOverlaySource(sceneName, sources.overlaySource, undefined, undefined, true);
    await this.setBrowserSourceUrl(sources.overlaySource, this.buildLiveToolOverlayUrl(tool), false);
    await this.applyMcePresentationSourceVisibility(sources.overlaySource).catch(() => { });
  }

  private async pushLiveToolMedia(tool: LiveToolTemplate): Promise<void> {
    const sources = this.getLiveToolSources();
    const sceneName = await this.getResolvedLiveToolScene();

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    const fileName = tool.backgroundMediaName || tool.backgroundMediaPath || tool.label;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext);

    await this.hideOverlaySource(sceneName, sources.overlaySource);
    if (isImage) {
      await this.hideMediaSourceWithAnimation(sceneName, sources.videoSource);
      const sceneItemId = await this._ensureNativeMediaSource(
        sceneName,
        sources.imageSource,
        "image_source",
        { file: tool.backgroundMediaPath },
        true,
      );
      await this.animateMediaSceneItem(sceneName, sceneItemId, "in");
      this.invalidateSceneItemListCache(sceneName);
      await this.applyMcePresentationSourceVisibility(sources.imageSource).catch(() => { });
      return;
    }

    await this.hideMediaSourceWithAnimation(sceneName, sources.imageSource);
    const sceneItemId = await this._ensureNativeMediaSource(
      sceneName,
      sources.videoSource,
      "ffmpeg_source",
      {
        local_file: tool.backgroundMediaPath,
        looping: true,
        is_local_file: true,
        restart_on_activate: true,
      },
      true,
    );
    try {
      await this.call("TriggerMediaInputAction", {
        inputName: sources.videoSource,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      });
    } catch { /* ignore */ }
    await this.animateMediaSceneItem(sceneName, sceneItemId, "in");
    this.invalidateSceneItemListCache(sceneName);
    await this.applyMcePresentationSourceVisibility(sources.videoSource).catch(() => { });
  }

  private async runLiveToolSafetyAction(tool: LiveToolTemplate): Promise<void> {
    if (tool.action === "safe-scene" && tool.sceneName) {
      await this.switchScene(tool.sceneName);
      return;
    }

    if (tool.action === "mute-mic" && tool.sourceName) {
      await this.call("SetInputMute", {
        inputName: tool.sourceName,
        inputMuted: true,
      });
      return;
    }

    if (tool.action === "mute-mic") {
      throw new Error("Choose a mic source in the app before using Mute Mic.");
    }

    if (tool.action === "hide-overlays") {
      const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      await Promise.all(resp.sceneItems.map(async (item) => {
        if (!item.sourceName.includes("OCS") && !item.sourceName.includes("MCE ") && !item.sourceName.startsWith("⚡ ")) return;
        try {
          await this.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: false,
          });
        } catch { /* ignore */ }
      }));
      return;
    }

    if (tool.action === "safe-scene") {
      throw new Error("Choose a safe OBS scene in the app before using Safe Scene.");
    }

    await this.pushLiveToolOverlay(tool);
  }

  async clearLiveTool(): Promise<void> {
    const sources = this.getLiveToolSources();
    const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
    await this.hideOverlaySource(sceneName, sources.overlaySource);
    await this.hideMediaSourceWithAnimation(sceneName, sources.videoSource);
    await this.hideMediaSourceWithAnimation(sceneName, sources.imageSource);

    // Restore Program scene to what it was before Live Tool was pushed
    await this.restoreProgramSceneBeforePush();
  }

  private isAudioInputCaptureKind(inputKind: string): boolean {
    const kind = inputKind.toLowerCase();
    if (kind.includes("output_capture") || kind.includes("ffmpeg") || kind.includes("browser")) {
      return false;
    }
    return (
      kind.includes("input_capture") ||
      kind.includes("audio_input") ||
      kind.includes("audioinput") ||
      kind === "coreaudio_input_capture" ||
      kind === "wasapi_input_capture" ||
      kind === "pulse_input_capture" ||
      kind === "alsa_input_capture"
    );
  }

  async listAudioInputSources(): Promise<DockAudioInputSource[]> {
    const resp = await this.call("GetInputList") as {
      inputs: Array<{ inputName: string; inputKind: string }>;
    };
    return resp.inputs
      .filter((input) => this.isAudioInputCaptureKind(input.inputKind))
      .filter((input) => !input.inputName.includes("Media Image Audio"))
      .map((input) => ({
        inputName: input.inputName,
        inputKind: input.inputKind,
      }))
      .sort((a, b) => a.inputName.localeCompare(b.inputName));
  }

  async setMediaVideoMuted(muted: boolean): Promise<void> {
    for (const inputName of [DOCK_MEDIA_VIDEO_SOURCE, "MCE Media - Video", "Video - MCE Media"]) {
      try {
        await this.call("SetInputMute", {
          inputName,
          inputMuted: muted,
        });
        return;
      } catch {
        // try next alias
      }
    }
  }

  async setMediaLooping(looping: boolean): Promise<void> {
    for (const inputName of [DOCK_MEDIA_VIDEO_SOURCE, "MCE Media - Video", "Video - MCE Media"]) {
      try {
        await this.call("SetInputSettings", {
          inputName,
          inputSettings: {
            looping,
            restart_on_activate: true,
          },
        });
        return;
      } catch {
        // try next alias
      }
    }
  }

  async setMediaVideoSourceSettings(settings: {
    looping?: boolean;
    restartOnActivate?: boolean;
    closeWhenInactive?: boolean;
    clearOnMediaEnd?: boolean;
    playbackSpeed?: number;
  }): Promise<void> {
    const inputSettings: Record<string, unknown> = {};
    if (settings.looping !== undefined) inputSettings.looping = settings.looping;
    if (settings.restartOnActivate !== undefined) inputSettings.restart_on_activate = settings.restartOnActivate;
    if (settings.closeWhenInactive !== undefined) inputSettings.close_when_inactive = settings.closeWhenInactive;
    if (settings.clearOnMediaEnd !== undefined) inputSettings.clear_on_media_end = settings.clearOnMediaEnd;
    if (settings.playbackSpeed !== undefined) inputSettings.speed_percent = settings.playbackSpeed;

    if (Object.keys(inputSettings).length === 0) return;

    for (const inputName of [DOCK_MEDIA_VIDEO_SOURCE, "MCE Media - Video", "Video - MCE Media"]) {
      try {
        await this.call("SetInputSettings", { inputName, inputSettings });
        return;
      } catch {
        // try next alias
      }
    }
  }

  async setMediaPlaybackPaused(paused: boolean): Promise<void> {
    for (const inputName of [DOCK_MEDIA_VIDEO_SOURCE, "MCE Media - Video", "Video - MCE Media"]) {
      try {
        await this.call("TriggerMediaInputAction", {
          inputName,
          mediaAction: paused
            ? "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE"
            : "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
        });
        return;
      } catch {
        // try next alias
      }
    }
  }

  async restartMediaPlayback(): Promise<void> {
    for (const inputName of [DOCK_MEDIA_VIDEO_SOURCE, "MCE Media - Video", "Video - MCE Media"]) {
      try {
        await this.call("TriggerMediaInputAction", {
          inputName,
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        });
        return;
      } catch {
        // try next alias
      }
    }
  }

  async setMediaFitMode(fitMode: "cover" | "contain" | "stretch"): Promise<void> {
    const { sceneName } = await this.getPresentationTargetScene("media");
    for (const sourceName of [
      DOCK_MEDIA_VIDEO_SOURCE,
      DOCK_MEDIA_IMAGE_SOURCE,
      "MCE Media - Video",
      "MCE Media - Image",
      "Video - MCE Media",
      "Image - MCE Media",
    ]) {
      try {
        const resp = await this.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        const sceneItem = resp.sceneItems.find((item) => item.sourceName === sourceName);
        if (!sceneItem) continue;
        await this.applyMediaFitMode(sceneName, sceneItem.sceneItemId, fitMode);
      } catch {
        // ignore
      }
    }
  }

  private async _ensureSceneInputSource(
    sceneName: string,
    sourceName: string,
    inputKind: string,
    inputSettings: Record<string, unknown>,
    enable: boolean,
  ): Promise<number> {
    let inputExists = false;
    try {
      const inputInfo = await this.call("GetInputSettings", { inputName: sourceName }) as {
        inputKind?: string;
      };
      if (inputInfo && (inputInfo.inputKind === inputKind || !inputInfo.inputKind)) {
        inputExists = true;
        await this.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings,
        });
      } else if (inputInfo) {
        try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
        inputExists = false;
      }
    } catch {
      // Input does not exist yet; check fallback or create below
      try {
        const inputs = await this.call("GetInputList") as {
          inputs: Array<{ inputName: string; inputKind: string }>;
        };
        const existing = inputs?.inputs?.find((input) => input.inputName === sourceName);
        if (existing) {
          inputExists = true;
          if (existing.inputKind === inputKind) {
            await this.call("SetInputSettings", {
              inputName: sourceName,
              inputSettings,
            });
          } else {
            try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
            inputExists = false;
          }
        }
      } catch {
        inputExists = false;
      }
    }

    let sceneItemId = -1;
    try {
      const itemResp = await this.call("GetSceneItemId", { sceneName, sourceName }) as { sceneItemId?: number };
      if (typeof itemResp?.sceneItemId === "number" && itemResp.sceneItemId >= 0) {
        sceneItemId = itemResp.sceneItemId;
      }
    } catch {
      // Scene item not found yet; will search sceneItems or create below
      try {
        const resp = await this.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        const found = resp?.sceneItems?.find((item) => item.sourceName === sourceName);
        if (found) {
          sceneItemId = found.sceneItemId;
        }
      } catch { /* ignore */ }
    }

    if (sceneItemId < 0) {
      if (inputExists) {
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
      } else {
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind,
          inputSettings,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
      }
    }

    try {
      await this.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId,
        sceneItemEnabled: enable,
      });
    } catch { /* ignore */ }

    return sceneItemId;
  }

  /**
   * Push one audio file as a native OBS source. Local OBS sessions use the
   * ffmpeg source so the track is available immediately; remote sessions use
   * the existing VLC playlist transport so the remote OBS host can read the
   * served upload URL.
   */
  async pushAudio(
    filePath: string,
    _fileName: string,
    options: Pick<DockMediaSendOptions, "looping" | "muted"> = {},
  ): Promise<void> {
    const fileName = _fileName || filePath.split(/[\/\\]/).pop() || "Audio";
    try {
      recordPresentationHistory({
        type: "media",
        sourceKind: "media-library-item",
        label: fileName,
        subtitle: "Audio track",
        notes: fileName,
        payloadSnapshot: {
          filePath,
          fileName,
          mediaType: "audio",
          looping: options.looping,
          muted: options.muted,
        },
      });
    } catch {
      // Ignore history recording failures
    }
    const sourceName = DOCK_MEDIA_AUDIO_SOURCE;
    if (this.isRemotePresentationSession()) {
      await this.pushVlcPlaylist({
        sourceName,
        playlist: [filePath],
        loop: options.looping ?? false,
        muted: options.muted ?? false,
      });
      return;
    }

    await this.focusMcePresentationModule("media", sourceName).catch(() => { });
    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");

    await this._ensureSceneInputSource(
      sceneName,
      sourceName,
      "ffmpeg_source",
      {
        local_file: filePath,
        looping: options.looping ?? false,
        is_local_file: true,
        restart_on_activate: true,
      },
      true,
    );

    try {
      await this.call("SetInputMute", {
        inputName: sourceName,
        inputMuted: options.muted ?? false,
      });
      await this.call("TriggerMediaInputAction", {
        inputName: sourceName,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      });
    } catch { /* source playback controls vary slightly by OBS version */ }
  }

  /**
   * Push a media file to OBS using native sources (ffmpeg_source for video,
   * image_source for images) instead of a browser source.
   * @param filePath  Absolute local file path (e.g. ~/Documents/MakeChurchEasy/uploads/video.mp4)
   * @param fileName  Human-readable name for logging
   * @param options   Audio behavior for video mute and image-linked mic/audio input.
   */
  async pushMedia(
    filePath: string,
    fileName: string,
    options: DockMediaSendOptions = {},
  ): Promise<void> {
    return this.runSerializedMediaMutation(async () => {
      const getExtension = (value: string): string => {
        const cleanValue = value.split(/[?#]/)[0].trim();
        return cleanValue.match(/\.([a-z0-9]+)(?:\s+·\s+page(?:\s+\d+(?:\/\d+)?)?)?$/i)?.[1]?.toLowerCase() || "";
      };
      const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
      const pathExtension = getExtension(filePath);
      const nameExtension = getExtension(fileName);
      const ext = imageExtensions.includes(pathExtension) || ["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(pathExtension)
        ? pathExtension
        : nameExtension;
      const isImage = imageExtensions.includes(ext);
      const audioExtensions = ["mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "m4b", "wma", "opus"];
      const isAudio = audioExtensions.includes(ext);

      if (isAudio) {
        await this.pushAudio(filePath, fileName, options);
        return;
      }

      try {
        recordPresentationHistory({
          type: "media",
          sourceKind: "media-library-item",
          label: fileName || filePath.split(/[\/\\]/).pop() || "Media",
          subtitle: isImage ? "Picture media" : "Video media",
          notes: fileName,
          payloadSnapshot: {
            filePath,
            fileName,
            mediaType: isImage ? "image" : "video",
          },
        });
      } catch {
        // Ignore history recording failures
      }

    const mediaVideoSource = DOCK_MEDIA_VIDEO_SOURCE;
    const mediaImageSource = DOCK_MEDIA_IMAGE_SOURCE;
    const mediaPatternSource = DOCK_MEDIA_PATTERN_SOURCE;
    const mediaImageAudioSource = DOCK_MEDIA_IMAGE_AUDIO_SOURCE;
    const remoteMediaSource = DOCK_MEDIA_REMOTE_SOURCE;

    // Fade transitions use the browser media source so the old native media can
    // remain underneath while the new page fades in. Cut keeps the native path.
    const mediaSource = isImage ? mediaImageSource : mediaVideoSource;

    // Complete source-family reconciliation before resolving the target scene
    // or local file. Awaiting it prevents the image/video handoff from racing
    // a focus update that could re-enable the source just hidden.
    await this.focusMcePresentationModule("media", mediaSource).catch(() => { });

    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");

    // Ensure the live program scene is visible behind overlays in MCE Presentation
    await this.ensureProgramSceneAsSourceInPresentation();

    const isDocument = Boolean(options.document);
    const hidePromises: Promise<void>[] = [];
    if (options.transition === "fade" && !isDocument) {
      hidePromises.push(this.hideOverlaySource(sceneName, mediaPatternSource).catch(() => { }));
      hidePromises.push(this.hideOverlaySource(sceneName, mediaImageAudioSource).catch(() => { }));
    } else if (isDocument) {
      // Document pages always use the browser overlay. Disable any older
      // native media in one OBS batch instead of animating it out twice.
      hidePromises.push((async () => {
        try {
          const requests = await this._buildHideBatchRequests(sceneName, [
            mediaVideoSource,
            mediaImageSource,
            mediaPatternSource,
            mediaImageAudioSource,
          ]);
          if (requests.length > 0) await this.callBatch(requests);
        } catch { /* stale media sources are optional */ }
      })());
    } else if (isImage) {
      // Switching to image: hide video with animation, just disable the rest
      hidePromises.push(this.hideMediaSourceWithAnimation(sceneName, mediaVideoSource));
      hidePromises.push(this.hideOverlaySource(sceneName, mediaPatternSource).catch(() => { }));
      hidePromises.push(this.hideOverlaySource(sceneName, mediaImageAudioSource).catch(() => { }));
    } else {
      // Switching to video: hide image with animation, just disable the rest
      hidePromises.push(this.hideMediaSourceWithAnimation(sceneName, mediaImageSource));
      hidePromises.push(this.hideOverlaySource(sceneName, mediaPatternSource).catch(() => { }));
      hidePromises.push(this.hideOverlaySource(sceneName, mediaImageAudioSource).catch(() => { }));
      hidePromises.push((async () => {
        try { await this.call("SetInputMute", { inputName: mediaVideoSource, inputMuted: true }); } catch { }
      })());
    }
    await Promise.allSettled(hidePromises);

    // Only documents (PDF/DOCX) or true remote OBS sessions where OBS cannot access local files
    // use the browser overlay (remoteMediaSource). All local image and video media must use
    // native OBS sources (image_source and ffmpeg_source).
    if (this.isRemotePresentationSession() || options.document) {
      if (!isDocument) {
        await this.hideMediaSourceWithAnimation(sceneName, mediaVideoSource).catch(() => { });
        await this.hideMediaSourceWithAnimation(sceneName, mediaImageSource).catch(() => { });
        await this.hideOverlaySource(sceneName, mediaImageAudioSource).catch(() => { });
      }

      const mediaUrl = await this.toRemoteServedMediaUrl(filePath, fileName);
      if (!mediaUrl) {
        throw new Error("Could not create a network media URL for remote OBS.");
      }

      const canvas = await this.getCanvasSize();
      const sceneItemId = await this.ensureOverlaySource(
        sceneName,
        remoteMediaSource,
        canvas.width,
        canvas.height,
        true,
      );
      await this.applyMcePresentationSourceVisibility(remoteMediaSource).catch(() => { });
      const packet = {
        url: mediaUrl,
        title: fileName,
        isImage,
        fitMode: options.fitMode ?? "cover",
        looping: options.looping ?? true,
        muted: isImage ? true : options.muted ?? true,
        transition: options.transition ?? "cut",
        document: options.document,
        timestamp: Date.now(),
      };
      const overlayUrl = `${this.buildOverlayHtmlUrl("mce-media-overlay.html")}#data=${encodeURIComponent(JSON.stringify(packet))}`;

      // Hash changes are enough for the document overlay to render the next
      // page. Avoid blanking/reloading CEF, which adds visible latency.
      await this.setBrowserSourceUrl(remoteMediaSource, overlayUrl, !isDocument);
      await this.applyMediaFitMode(sceneName, sceneItemId, options.fitMode ?? "cover");

      if (!isImage) {
        try {
          await this.call("SetInputMute", {
            inputName: remoteMediaSource,
            inputMuted: options.muted ?? true,
          });
        } catch { /* ignore */ }
      }

      if (options.transition === "fade") {
        if (!isDocument) {
          await this.sleep(150);
          await Promise.allSettled([
            this.hideMediaSourceWithAnimation(sceneName, mediaVideoSource),
            this.hideMediaSourceWithAnimation(sceneName, mediaImageSource),
          ]);
        }
      } else if (!isDocument) {
        await this.animateMediaSceneItem(sceneName, sceneItemId, "in");
      }

      if (!isDocument) {
        try {
          await this.ensureTickerAboveSource(sceneName, remoteMediaSource);
        } catch { /* ignore */ }
      }

      return;
    }

    if (isImage) {
      const sceneItemId = await this._ensureNativeMediaSource(
        sceneName, mediaImageSource, "image_source",
        { file: filePath },
        true,
      );
      await this.applyMediaFitMode(sceneName, sceneItemId, options.fitMode ?? "cover");

      if (options.imageAudioInputName) {
        try {
          const inputs = await this.call("GetInputList") as {
            inputs: Array<{ inputName: string; inputKind: string }>;
          };
          const audioSource = inputs.inputs.find((i) => i.inputName === options.imageAudioInputName);
          if (audioSource && this.isAudioInputCaptureKind(audioSource.inputKind)) {
            const current = await this.call("GetInputSettings", { inputName: options.imageAudioInputName }) as {
              inputKind?: string;
              inputSettings?: Record<string, unknown>;
            };
            const inputKind = current.inputKind || audioSource.inputKind;
            await this._ensureSceneInputSource(
              sceneName, mediaImageAudioSource, inputKind,
              current.inputSettings || {}, true,
            );
            try {
              await this.call("SetInputMute", { inputName: mediaImageAudioSource, inputMuted: false });
            } catch { /* ignore */ }
          }
        } catch (err) {
          console.warn("[DockOBS] Could not attach image audio input:", err);
          try { await this.hideOverlaySource(sceneName, mediaImageAudioSource); } catch { /* ignore */ }
        }
      } else {
        try { await this.hideOverlaySource(sceneName, mediaImageAudioSource); } catch { /* ignore */ }
      }
      await this.animateMediaSceneItem(sceneName, sceneItemId, "in");
    } else {
      const sceneItemId = await this._ensureNativeMediaSource(
        sceneName, mediaVideoSource, "ffmpeg_source",
        {
          local_file: filePath,
          looping: options.looping ?? true,
          is_local_file: true,
          restart_on_activate: options.restartOnActivate ?? true,
          close_when_inactive: options.closeWhenInactive ?? false,
          clear_on_media_end: options.clearOnMediaEnd ?? false,
          speed_percent: options.playbackSpeed ?? 100,
        },
        true,
      );
      await this.applyMediaFitMode(sceneName, sceneItemId, options.fitMode ?? "cover");
      try {
        await this.call("SetInputMute", {
          inputName: mediaVideoSource,
          inputMuted: options.muted ?? true,
        });
      } catch { /* ignore */ }

      try {
        await this.call("TriggerMediaInputAction", {
          inputName: mediaVideoSource,
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        });
      } catch { /* ignore */ }
      await this.animateMediaSceneItem(sceneName, sceneItemId, "in");
    }

    // Ensure ticker is on top (above media)
    try {
      await this.ensureTickerAboveSource(sceneName, mediaSource);
    } catch { /* ignore */ }

    this.invalidateSceneItemListCache(sceneName);
    await this.applyMcePresentationSourceVisibility(mediaSource).catch(() => { });
    });
  }

  /**
   * Create a VLC Video Source with a playlist and add it to the current preview scene.
   */
  async pushVlcPlaylist(options: {
    sourceName: string;
    playlist: string[];
    loop?: boolean;
    shuffle?: boolean;
    muted?: boolean;
  }): Promise<void> {
    const { sourceName, playlist, loop = true, shuffle = false, muted = true } = options;
    try {
      const playlistName = sourceName || "Media Playlist";
      recordPresentationHistory({
        type: "media",
        sourceKind: "media-library-item",
        label: playlistName,
        subtitle: `${playlist.length} track(s)`,
        notes: "VLC Playlist",
        payloadSnapshot: {
          sourceName,
          playlist,
          isPlaylist: true,
          loop,
          shuffle,
          muted,
        },
      });
    } catch {
      // Ignore
    }

    void this.focusMcePresentationModule("media", sourceName).catch(() => { });

    // Get the current scene via clone workflow
    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");

    // A remote OBS instance cannot read this computer's absolute paths. Serve
    // those files first, while keeping local OBS playback on native paths.
    const playlistPaths = this.isRemotePresentationSession()
      ? await Promise.all(playlist.map(async (path) => {
        const fileName = path.split(/[\\/]/).pop()?.split(/[?#]/)[0] || sourceName;
        return this.toRemoteServedMediaUrl(path, fileName);
      }))
      : playlist;

    // OBS reads each VLC playlist location from the `value` property.
    const vlcPlaylist = buildVlcPlaylistItems(playlistPaths);
    if (vlcPlaylist.length === 0) throw new Error("VLC playlist is empty");

    // Remove existing VLC source with same name if present
    try {
      const existing = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const existingItem = existing.sceneItems.find((i) => i.sourceName === sourceName);
      if (existingItem) {
        await this.call("RemoveSceneItem", { sceneName, sceneItemId: existingItem.sceneItemId });
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch { /* ignore */ }

    // Remove existing input if present
    try {
      await this.call("RemoveInput", { inputName: sourceName });
      await new Promise((r) => setTimeout(r, 100));
    } catch { /* ignore */ }

    // Create VLC Video Source
    const created = await this.call("CreateInput", {
      sceneName,
      inputName: sourceName,
      inputKind: "vlc_source",
      inputSettings: {
        playlist: vlcPlaylist,
        loop,
        shuffle,
        restart_on_activate: true,
        network_caching: 1000,
      },
      sceneItemEnabled: true,
    }) as { sceneItemId?: number } | undefined;

    // CreateInput returns the scene item, but resolve it again for OBS builds
    // that omit the id so the playlist fills the canvas in either case.
    let sceneItemId = Number.isFinite(created?.sceneItemId) ? created?.sceneItemId : undefined;
    if (sceneItemId === undefined) {
      try {
        const sceneItems = await this.call("GetSceneItemList", { sceneName }) as {
          sceneItems?: Array<{ sourceName: string; sceneItemId: number }>;
        };
        sceneItemId = sceneItems.sceneItems?.find((item) => item.sourceName === sourceName)?.sceneItemId;
      } catch { /* ignore — OBS may still be finishing source creation */ }
    }
    if (sceneItemId !== undefined) {
      await this.applyMediaFitMode(sceneName, sceneItemId, "cover");
    }

    // Mute if requested
    if (muted) {
      try {
        await this.call("SetInputMute", { inputName: sourceName, inputMuted: true });
      } catch { /* ignore */ }
    }

    // Ensure ticker is on top after source exists
    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch { /* ignore */ }

    this.invalidateSceneItemListCache(sceneName);
    await this.applyMcePresentationSourceVisibility(sourceName).catch(() => { });

  }

  /**
   * Create a native OBS image_source and rotate through images on a timer.
   *
   * A single image_source is created with the first image; a per-source
   * interval timer updates the file path via SetInputSettings on each tick.
   * If the source already exists it is reused (settings are updated).
   */
  async pushImageSlideshow(options: {
    sourceName: string;
    images: string[];
    loop?: boolean;
    slideTime?: number;
  }): Promise<void> {
    const { sourceName, images, loop = true, slideTime = 3000 } = options;
    if (images.length === 0) return;
    try {
      const showName = sourceName || "Image Slideshow";
      recordPresentationHistory({
        type: "media",
        sourceKind: "media-library-item",
        label: showName,
        subtitle: `${images.length} slide(s)`,
        notes: "Image Slideshow",
        payloadSnapshot: {
          sourceName,
          images,
          isSlideshow: true,
          loop,
          slideTime,
        },
      });
    } catch {
      // Ignore
    }

    void this.focusMcePresentationModule("media", sourceName).catch(() => { });

    // Stop any existing rotation timer for this source
    this.stopImageSlideshow(sourceName);

    // Get the current scene
    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");

    // Remove existing scene item with same name if present
    try {
      const existing = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const existingItem = existing.sceneItems.find((i) => i.sourceName === sourceName);
      if (existingItem) {
        await this.call("RemoveSceneItem", { sceneName, sceneItemId: existingItem.sceneItemId });
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch { /* ignore */ }

    // Remove existing input if present
    try {
      await this.call("RemoveInput", { inputName: sourceName });
      await new Promise((r) => setTimeout(r, 100));
    } catch { /* ignore */ }

    // Create native image_source with the first image
    const createResp = await this.call("CreateInput", {
      sceneName,
      inputName: sourceName,
      inputKind: "image_source",
      inputSettings: { file: images[0] },
      sceneItemEnabled: true,
    }) as { sceneItemId: number };

    // Stretch the image to fill the canvas so it takes full width
    await this.fitSceneItemToCanvas(sceneName, createResp.sceneItemId);

    // Ensure ticker is on top after source exists
    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch { /* ignore */ }

    this.invalidateSceneItemListCache(sceneName);
    await this.applyMcePresentationSourceVisibility(sourceName).catch(() => { });

    // If only one image, nothing to rotate
    if (images.length === 1 || slideTime <= 0) return;

    // Set up rotation timer
    let currentIndex = 0;
    const timer = setInterval(async () => {
      currentIndex = (currentIndex + 1) % images.length;
      if (!loop && currentIndex === 0) {
        // Reached the end without loop — stop on last image
        this.stopImageSlideshow(sourceName);
        return;
      }
      try {
        await this.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings: { file: images[currentIndex] },
        });
      } catch {
        // Source may have been removed — stop the timer
        this.stopImageSlideshow(sourceName);
      }
    }, slideTime);

    this._slideshowTimers.set(sourceName, timer);
  }

  async addImageSourceToScene(options: {
    sceneName: string;
    sourceName: string;
    filePath: string;
    fitMode?: "cover" | "contain" | "stretch";
  }): Promise<void> {
    const sceneName = options.sceneName.trim();
    const sourceName = options.sourceName.trim();
    const filePath = options.filePath.trim();

    if (!sceneName) throw new Error("Scene name is required");
    if (!sourceName) throw new Error("Source name is required");
    if (!filePath) throw new Error("Image file path is required");

    if (!(await this.hasObsScene(sceneName))) {
      await this.call("CreateScene", { sceneName });
    }

    const sceneItemId = await this._ensureNativeMediaSource(
      sceneName,
      sourceName,
      "image_source",
      { file: filePath },
      true,
    );

    await this.applyMediaFitMode(sceneName, sceneItemId, options.fitMode ?? "cover");

    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch {
      // Ignore ticker ordering failures for arbitrary user scenes.
    }
  }

  async addVideoSourceToScene(options: {
    sceneName: string;
    sourceName: string;
    filePath: string;
    fitMode?: "cover" | "contain" | "stretch";
    muted?: boolean;
    looping?: boolean;
    restartOnActivate?: boolean;
    closeWhenInactive?: boolean;
    clearOnMediaEnd?: boolean;
    playbackSpeed?: number;
  }): Promise<void> {
    const sceneName = options.sceneName.trim();
    const sourceName = options.sourceName.trim();
    const filePath = options.filePath.trim();

    if (!sceneName) throw new Error("Scene name is required");
    if (!sourceName) throw new Error("Source name is required");
    if (!filePath) throw new Error("Video file path is required");

    if (!(await this.hasObsScene(sceneName))) {
      await this.call("CreateScene", { sceneName });
    }

    const sceneItemId = await this._ensureNativeMediaSource(
      sceneName,
      sourceName,
      "ffmpeg_source",
      {
        local_file: filePath,
        looping: options.looping ?? true,
        is_local_file: true,
        restart_on_activate: options.restartOnActivate ?? true,
        close_when_inactive: options.closeWhenInactive ?? false,
        clear_on_media_end: options.clearOnMediaEnd ?? false,
        speed_percent: options.playbackSpeed ?? 100,
      },
      true,
    );

    await this.applyMediaFitMode(sceneName, sceneItemId, options.fitMode ?? "cover");

    try {
      await this.call("SetInputMute", {
        inputName: sourceName,
        inputMuted: options.muted ?? true,
      });
    } catch {
      // Ignore mute failures for arbitrary user scenes.
    }

    try {
      await this.call("TriggerMediaInputAction", {
        inputName: sourceName,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      });
    } catch {
      // Ignore restart failures for arbitrary user scenes.
    }

    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch {
      // Ignore ticker ordering failures for arbitrary user scenes.
    }
  }

  async addAudioSourceToScene(options: {
    sceneName: string;
    sourceName: string;
    filePath: string;
    looping?: boolean;
    muted?: boolean;
  }): Promise<void> {
    const sceneName = options.sceneName.trim();
    const sourceName = options.sourceName.trim();
    const filePath = options.filePath.trim();

    if (!sceneName) throw new Error("Scene name is required");
    if (!sourceName) throw new Error("Source name is required");
    if (!filePath) throw new Error("Audio file path is required");

    if (!(await this.hasObsScene(sceneName))) {
      await this.call("CreateScene", { sceneName });
    }

    await this._ensureNativeMediaSource(
      sceneName,
      sourceName,
      "ffmpeg_source",
      {
        local_file: filePath,
        looping: options.looping ?? false,
        is_local_file: true,
        restart_on_activate: true,
        close_when_inactive: false,
        clear_on_media_end: false,
      },
      true,
    );

    try {
      await this.call("SetInputMute", {
        inputName: sourceName,
        inputMuted: options.muted ?? false,
      });
    } catch {
      // Ignore mute failures for arbitrary user scenes.
    }

    try {
      await this.call("SetInputVolume", {
        inputName: sourceName,
        inputVolumeMul: 1.0,
      });
    } catch {
      // Ignore volume failures
    }

    try {
      await this.call("SetInputAudioMonitorType", {
        inputName: sourceName,
        monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
      });
    } catch {
      // Ignore monitor type failures
    }

    try {
      await this.call("TriggerMediaInputAction", {
        inputName: sourceName,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      });
      await this.call("TriggerMediaInputAction", {
        inputName: sourceName,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
      });
    } catch {
      // Ignore playback-control failures for arbitrary user scenes.
    }

    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch {
      // Ignore ticker ordering failures for arbitrary user scenes.
    }
  }

  /**
   * Stop a running image-slideshow rotation timer.
   */
  stopImageSlideshow(sourceName: string): void {
    const timer = this._slideshowTimers.get(sourceName);
    if (timer) {
      clearInterval(timer);
      this._slideshowTimers.delete(sourceName);
    }
  }

  /**
   * Stop all running image-slideshow rotation timers.
   */
  stopAllImageSlideshows(): void {
    for (const [, timer] of this._slideshowTimers) {
      clearInterval(timer);
    }
    this._slideshowTimers.clear();
  }

  async pushPatternBackground(patternSrc: string, patternLabel: string): Promise<void> {
    try {
      recordPresentationHistory({
        type: "media",
        sourceKind: "media-library-item",
        label: patternLabel || "Pattern Background",
        subtitle: "Background pattern",
        notes: "Pattern",
        payloadSnapshot: {
          patternSrc,
          patternLabel,
          mediaType: "pattern",
        },
      });
    } catch {
      // Ignore
    }
    const mediaVideoSource = DOCK_MEDIA_VIDEO_SOURCE;
    const mediaImageSource = DOCK_MEDIA_IMAGE_SOURCE;
    const mediaPatternSource = DOCK_MEDIA_PATTERN_SOURCE;

    void this.focusMcePresentationModule("media").catch(() => { });

    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");

    // Hide native media sources
    await this.hideMediaSourceWithAnimation(sceneName, mediaVideoSource);
    await this.hideMediaSourceWithAnimation(sceneName, mediaImageSource);
    try { await this.hideMediaSourceWithAnimation(sceneName, "MCE Media - Video"); } catch { /* ignore */ }
    try { await this.hideMediaSourceWithAnimation(sceneName, "MCE Media - Image"); } catch { /* ignore */ }
    try { await this.hideOverlaySource(sceneName, DOCK_MEDIA_IMAGE_AUDIO_SOURCE); } catch { /* ignore */ }
    try { await this.hideOverlaySource(sceneName, "MCE Media - Image Audio"); } catch { /* ignore */ }

    // Ensure pattern browser source exists directly in target scene
    await this.ensureOverlaySource(sceneName, mediaPatternSource, undefined, undefined, true);
    await this.applyMcePresentationSourceVisibility(mediaPatternSource).catch(() => { });

    // Ensure ticker is on top after source exists
    try {
      await this.ensureTickerAboveSource(sceneName, mediaPatternSource);
    } catch { /* ignore */ }
    await this.setBrowserSourceUrl(
      mediaPatternSource,
      this.buildMediaPatternUrl(patternSrc, patternLabel),
      true,
    );
    await this.bringSceneSourceToFront(sceneName, mediaPatternSource);

  }

  /**
   * Interpret and display a structured MCE template in OBS. The template is
   * rendered by the app-owned browser overlay; no PNG export is needed.
   */
  async pushEditableTemplate(template: EditableTemplate): Promise<void> {
    const resources = getDockResources();
    const target = await this.getPresentationTargetScene("media");
    const sceneName = target.sceneName;
    if (!sceneName) throw new Error("No active scene found in OBS");
    // The template packager pulls in the ~130 KB Google Fonts catalog; load it
    // only when a template is actually sent, not on every Dock start.
    const { createMceTemplateBlob } = await import("../templates/mceTemplatePackage");
    const packageText = await createMceTemplateBlob(template).text();

    await this.ensureProgramSceneAsSourceInPresentation();

    await Promise.all([
      this.hideMediaSourceWithAnimation(sceneName, resources.mediaVideoSource),
      this.hideMediaSourceWithAnimation(sceneName, resources.mediaImageSource),
      this.hideOverlaySource(sceneName, resources.mediaImageAudioSource).catch(() => { }),
      this.hideOverlaySource(sceneName, resources.mediaPatternSource).catch(() => { }),
      this.hideOverlaySource(sceneName, resources.mediaTemplateSource).catch(() => { }),
    ]);

    const sourceName = resources.mediaTemplateSource;
    await this.ensureOverlaySource(sceneName, sourceName, undefined, undefined, true);
    await this.applyMcePresentationSourceVisibility(sourceName).catch(() => { });
    await this.setBrowserSourceUrl(
      sourceName,
      `${this.buildOverlayHtmlUrl("mce-template-overlay.html")}#data=${encodeURIComponent(JSON.stringify({
        package: packageText,
        timestamp: Date.now(),
      }))}`,
      true,
    );
    await this.fitSceneSourceToCanvas(sceneName, sourceName).catch(() => { });
    await this.bringSceneSourceToFront(sceneName, sourceName);
    try {
      await this.ensureTickerAboveSource(sceneName, sourceName);
    } catch {
      // Ticker ordering is optional for template playback.
    }
  }

  /**
   * The Media tab's Text overlay was retired. This stays only so older callers
   * keep compiling: it never creates or shows anything. The OBS source it used
   * is removed from users' OBS by `services/retiredMceSources.ts`.
   */
  async setMediaTextOverlay(_payload?: unknown): Promise<void> {
    return;
  }

  /**
   * Create or update a native OBS source (ffmpeg_source or image_source)
   * for the media player, position it fullscreen, and move it to the top.
   *
   * Uses a check-update-or-create pattern instead of destructive remove-recreate
   * to avoid race conditions with shared inputs and timing issues.
   */
  private async _ensureNativeMediaSource(
    sceneName: string,
    sourceName: string,
    inputKind: string,
    inputSettings: Record<string, unknown>,
    enable: boolean,
  ): Promise<number> {
    // Helper: find scene item by source name
    const findSceneItem = async (): Promise<number | null> => {
      try {
        const resp = await this.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        const found = resp.sceneItems.find((i) => i.sourceName === sourceName);
        return found?.sceneItemId ?? null;
      } catch { return null; }
    };

    // Helper: add existing input to scene with retry
    const addInputToScene = async (): Promise<number> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const added = await this.call("CreateSceneItem", {
            sceneName,
            sourceName,
            sceneItemEnabled: enable,
          }) as { sceneItemId: number };
          return added.sceneItemId;
        } catch {
          // OBS may still be processing a recent removal — wait and retry
          await this.sleep(150);
          const found = await findSceneItem();
          if (found !== null) return found;
        }
      }
      throw new Error(`Failed to add or find ${sourceName} in ${sceneName}`);
    };

    // Step 1: Check if the global input already exists anywhere and matches expected inputKind
    let inputExists = false;
    try {
      const inputList = await this.call("GetInputList", {}) as {
        inputs: Array<{ inputName: string; inputKind?: string }>;
      };
      const foundInput = inputList.inputs.find((i) => i.inputName === sourceName);
      if (foundInput) {
        if (foundInput.inputKind && foundInput.inputKind !== inputKind) {
          // Input exists under the same name but wrong kind (e.g. old browser_source instead of native)
          try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
          inputExists = false;
        } else {
          inputExists = true;
        }
      }
    } catch { /* ignore */ }

    // Step 2: Check if a scene item for this input exists in the target scene
    let existingSceneItemId = await findSceneItem();

    let sceneItemId: number;

    if (inputExists && existingSceneItemId !== null) {
      // Input exists AND scene item exists — just update settings and enable
      try {
        await this.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings,
        });
      } catch { /* ignore */ }

      sceneItemId = existingSceneItemId;
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId,
          sceneItemEnabled: enable,
        });
      } catch { /* ignore */ }
    } else if (inputExists && existingSceneItemId === null) {
      // Input exists globally but not in this scene — update settings and add to scene
      try {
        await this.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings,
        });
      } catch { /* ignore */ }

      sceneItemId = await addInputToScene();
    } else {
      // Input does not exist at all — create both input and scene item
      try {
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind,
          inputSettings,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
      } catch {
        // Race: input was created between our check and create — find the scene item
        sceneItemId = await addInputToScene();
        try {
          await this.call("SetInputSettings", {
            inputName: sourceName,
            inputSettings,
          });
        } catch { /* ignore */ }
        try {
          await this.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId,
            sceneItemEnabled: enable,
          });
        } catch { /* ignore */ }
      }
    }

    // Position fullscreen at (0,0); fit mode is applied after source setup.
    try {
      await this.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: 0,
          scaleX: 1,
          scaleY: 1,
        },
      });
    } catch { /* ignore */ }

    await this.ensureTickerAboveSource(sceneName, sourceName).catch(() => { });

    return sceneItemId;
  }

  private async applyMediaFitMode(
    sceneName: string,
    sceneItemId: number,
    fitMode: "cover" | "contain" | "stretch",
  ): Promise<void> {
    const { width: canvasW, height: canvasH } = await this.getCanvasSize();
    const boundsType =
      fitMode === "contain"
        ? "OBS_BOUNDS_SCALE_INNER"
        : fitMode === "stretch"
          ? "OBS_BOUNDS_STRETCH"
          : "OBS_BOUNDS_SCALE_OUTER";

    await this.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX: 0,
        positionY: 0,
        scaleX: 1,
        scaleY: 1,
        boundsType,
        boundsWidth: canvasW,
        boundsHeight: canvasH,
        boundsAlignment: 0,
      },
    });
  }

  /**
   * Clear media — simply hide all media sources in MCE Presentation.
   */
  async clearMedia(_preserveSourceNames?: string[]): Promise<void> {
    const scene = PRESENTATION_SCENE_NAME;

    // Hide all media sources in MCE Presentation (current standardized names and legacy aliases)
    const sourcesToHide = [
      DOCK_MEDIA_VIDEO_SOURCE,
      DOCK_MEDIA_IMAGE_SOURCE,
      DOCK_MEDIA_AUDIO_SOURCE,
      DOCK_MEDIA_REMOTE_SOURCE,
      DOCK_MEDIA_PATTERN_SOURCE,
      DOCK_MEDIA_IMAGE_AUDIO_SOURCE,
      DOCK_MEDIA_TEMPLATE_SOURCE,
      "MCE Media - Video",
      "MCE Media - Image",
      "MCE Media - Audio",
      "MCE Media - Remote",
      "MCE Media - Pattern",
      "MCE Media - Image Audio",
      "Video - MCE Media",
      "Image - MCE Media",
      "Audio - MCE Media Image",
      "Pattern - MCE Media",
      "Template - MCE Media",
    ];

    await Promise.all(
      sourcesToHide.map((s) => this.hideOverlaySource(scene, s).catch(() => { }))
    );

    // Restore Program scene to what it was before Media was pushed
    await this.restoreProgramSceneBeforePush("media");
  }

  /**
   * Clear the ticker overlay.
   */
  async clearTicker(): Promise<void> {
    const url = this.buildTickerUrl("", "", false, true);
    try { await this.setBrowserSourceUrl(DOCK_TICKER_SOURCE, url); } catch { /* ignore */ }

    try {
      const sceneName = await this.getCurrentProgramSceneName().catch(() => "");
      if (sceneName) {
        await this.hideOverlaySource(sceneName, DOCK_TICKER_SOURCE);
        await this.removeSceneItemBySource(sceneName, DOCK_TICKER_SOURCE);
      }
    } catch { /* ignore */ }

    await this.removeInputIfExists(DOCK_TICKER_SOURCE);

    // Restore Program scene to what it was before Ticker was pushed
    await this.restoreProgramSceneBeforePush("ministry");

  }

  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════
  // FULLSCREEN SCENES — now consolidated into MCE Presentation
  // nesting them as overlays into the current scene.
  // ═══════════════════════════════════════════════════════════════════════

  private _fullscreenSceneDefs: Record<string, { sceneName: string; browserSourceName: string; bgSourceName: string; overlayFile: string }> = {
    bible: {
      sceneName: DOCK_PRESENTATION_SCENE,
      browserSourceName: FULLSCREEN_SOURCE_NAMES.BIBLE,
      bgSourceName: FULLSCREEN_BG_SOURCE_NAMES.BIBLE,
      overlayFile: "mce-bible-overlay.html",
    },
    worship: {
      sceneName: DOCK_PRESENTATION_SCENE,
      browserSourceName: FULLSCREEN_SOURCE_NAMES.WORSHIP,
      bgSourceName: FULLSCREEN_BG_SOURCE_NAMES.WORSHIP,
      overlayFile: "mce-worship-overlay.html",
    },
    notes: {
      sceneName: DOCK_PRESENTATION_SCENE,
      browserSourceName: FULLSCREEN_SOURCE_NAMES.NOTES,
      bgSourceName: FULLSCREEN_BG_SOURCE_NAMES.NOTES,
      overlayFile: "mce-note.html",
    },
    countdown: {
      sceneName: DOCK_PRESENTATION_SCENE,
      browserSourceName: FULLSCREEN_SOURCE_NAMES.COUNTDOWN,
      bgSourceName: FULLSCREEN_BG_SOURCE_NAMES.COUNTDOWN,
      overlayFile: "pre-service-countdown.html",
    },
  };

  /**
   * Ensure a fullscreen source exists in MCE Presentation.
   * No longer creates separate scenes — everything lives in MCE Presentation.
   */
  private async _ensureFullscreenScene(
    key: string,
    initialMode?: "fullscreen" | "lower-third",
    /** "keep" leaves an existing item's visibility untouched (new items start hidden). */
    enable: boolean | "keep" = true,
    initialPacket?: Record<string, unknown>,
    initialCss?: string,
  ): Promise<{ sceneName: string; browserItemId: number }> {
    const def = this._fullscreenSceneDefs[key];
    if (!def) throw new Error(`Unknown fullscreen scene key: ${key}`);

    const canvas = await this.getCanvasSize();
    const shouldBootstrapBibleMode = key === "bible"
      && Boolean(initialMode)
      && !Object.prototype.hasOwnProperty.call(
        this._lastBrowserSourceUrlBySource,
        def.browserSourceName,
      );
    const baseOverlayUrl = key === "bible" && shouldBootstrapBibleMode
      ? this.buildCssOverlayHtmlUrlForTab("bible", def.browserSourceName, initialMode)
      : this.buildOverlayHtmlUrl(
        def.overlayFile,
        key === "countdown" ? undefined : { tab: key },
      );
    const overlayUrl = initialPacket
      ? `${baseOverlayUrl}#data=${encodeURIComponent(JSON.stringify(initialPacket))}`
      : baseOverlayUrl;
    const sourceSignature = `${overlayUrl}|${canvas.width}x${canvas.height}`;

    // Ensure MCE Presentation exists
    await this.ensurePresentationSceneReady();

    // Ensure browser source exists inside MCE Presentation
    let browserItemId: number | null = null;
    let createdSceneItem = false;
    try {
      let items = await this.getSceneItemListCached(DOCK_PRESENTATION_SCENE);
      const aliases = this.getSourceAliases(def.browserSourceName);
      const existing = items.find((i) => i.sourceName === def.browserSourceName || aliases.includes(i.sourceName));
      if (existing) {
        browserItemId = existing.sceneItemId;
        const actualInputName = existing.sourceName;
        if (this._lastFullscreenSourceSignature[actualInputName] !== sourceSignature) {
          // Re-navigating a browser source that already shows this overlay page
          // reloads it in OBS (blank output for seconds, and packets sent while
          // it loads are lost). Only change the URL when the page itself differs.
          let keepLoadedDocument = false;
          if (!initialPacket) {
            const loadedUrl = this._lastBrowserSourceUrlBySource[actualInputName]
              || await this.readBrowserSourceUrl(actualInputName);
            keepLoadedDocument = this.isSameOverlayDocument(loadedUrl, baseOverlayUrl);
          }
          await this.call("SetInputSettings", {
            inputName: actualInputName,
            inputSettings: {
              ...(keepLoadedDocument ? {} : { url: overlayUrl }),
              width: canvas.width,
              height: canvas.height,
              ...(initialCss !== undefined ? { css: initialCss } : {}),
              bgcolor: "#00000000",
              shutdown: false,
              restart_when_active: false,
            },
          });
          this._lastFullscreenSourceSignature[actualInputName] = sourceSignature;
          void this.refreshBrowserSourceCache(actualInputName);
        }
      }
    } catch { /* empty scene */ }

    if (browserItemId === null) {
      try {
        const created = await this.call("CreateInput", {
          sceneName: DOCK_PRESENTATION_SCENE,
          inputName: def.browserSourceName,
          inputKind: "browser_source",
          inputSettings: {
            url: overlayUrl,
            width: canvas.width,
            height: canvas.height,
            css: initialCss || "",
            bgcolor: "#00000000",
            shutdown: false,
            restart_when_active: false,
          },
          sceneItemEnabled: enable === true,
        }) as { sceneItemId: number };
        browserItemId = created.sceneItemId;
        createdSceneItem = true;
        this._lastFullscreenSourceSignature[def.browserSourceName] = sourceSignature;
        if (initialPacket) {
          this._lastBrowserSourceUrlBySource[def.browserSourceName] = baseOverlayUrl;
          this._lastCssOverlayPacketBySource[def.browserSourceName] = initialPacket;
          this._lastCssOverlayBaseUrlBySource[def.browserSourceName] = baseOverlayUrl;
          this._lastCssOverlayThemeCssBySource[def.browserSourceName] = initialCss || "";
        }
        this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("600")) {
          const aliases = this.getSourceAliases(def.browserSourceName);
          try {
            const added = await this.call("CreateSceneItem", { sceneName: DOCK_PRESENTATION_SCENE, sourceName: def.browserSourceName, sceneItemEnabled: enable === true }) as { sceneItemId: number };
            browserItemId = added.sceneItemId;
            createdSceneItem = true;
            this._lastFullscreenSourceSignature[def.browserSourceName] = sourceSignature;
            this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
          } catch {
            const items = await this.getSceneItemListCached(DOCK_PRESENTATION_SCENE);
            const found = items.find((i) => i.sourceName === def.browserSourceName || aliases.includes(i.sourceName));
            browserItemId = found?.sceneItemId ?? null;
            if (browserItemId !== null) {
              this._lastFullscreenSourceSignature[def.browserSourceName] = sourceSignature;
            }
          }
        } else {
          throw err;
        }
      }
    }

    // Stretch to fill canvas once per source/canvas/item combination.
    if (browserItemId !== null) {
      const sceneItemSignature = `${sourceSignature}|item:${browserItemId}`;
      if (!createdSceneItem && this._lastFullscreenSceneItemSignature[def.browserSourceName] === sceneItemSignature) {
        if (enable === "keep") {
          return { sceneName: DOCK_PRESENTATION_SCENE, browserItemId };
        }
        if (!enable) {
          await this.call("SetSceneItemEnabled", {
            sceneName: DOCK_PRESENTATION_SCENE,
            sceneItemId: browserItemId,
            sceneItemEnabled: false,
          }).catch(() => { });
        } else {
          const currentItems = await this.getSceneItemListCached(DOCK_PRESENTATION_SCENE).catch(() => []);
          const currentItem = currentItems.find((i) => i.sceneItemId === browserItemId);
          if (currentItem && currentItem.sceneItemEnabled === false) {
            await this.call("SetSceneItemEnabled", {
              sceneName: DOCK_PRESENTATION_SCENE,
              sceneItemId: browserItemId,
              sceneItemEnabled: true,
            }).catch(() => { });
            this.invalidateSceneItemListCache(DOCK_PRESENTATION_SCENE);
          }
        }
        return { sceneName: DOCK_PRESENTATION_SCENE, browserItemId };
      }
      try {
        await this.call("SetSceneItemTransform", {
          sceneName: DOCK_PRESENTATION_SCENE,
          sceneItemId: browserItemId,
          sceneItemTransform: {
            positionX: 0,
            positionY: 0,
            scaleX: 1,
            scaleY: 1,
            boundsType: "OBS_BOUNDS_SCALE_OUTER",
            boundsWidth: canvas.width,
            boundsHeight: canvas.height,
            boundsAlignment: 0,
            rotation: 0,
            cropLeft: 0,
            cropTop: 0,
            cropRight: 0,
            cropBottom: 0,
          },
        });
        await this.ensureTickerAboveSource(DOCK_PRESENTATION_SCENE, def.browserSourceName, { leaveVisibility: true }).catch(() => { });
        if (enable === "keep" && !createdSceneItem) {
          // Leave visibility as the user/focus path set it.
        } else if (enable === true) {
          await this.call("SetSceneItemEnabled", { sceneName: DOCK_PRESENTATION_SCENE, sceneItemId: browserItemId, sceneItemEnabled: true });
        } else {
          await this.call("SetSceneItemEnabled", { sceneName: DOCK_PRESENTATION_SCENE, sceneItemId: browserItemId, sceneItemEnabled: false }).catch(() => { });
        }
        this._lastFullscreenSceneItemSignature[def.browserSourceName] = sceneItemSignature;
      } catch { /* best effort */ }
    }

    if (browserItemId === null) throw new Error(`Failed to ensure browser source: ${def.browserSourceName}`);
    return { sceneName: DOCK_PRESENTATION_SCENE, browserItemId };
  }

  /**
   * Returns true when the theme has a background that can be rendered by a
   * separate OBS source (color_source / image_source / media_source)
   * layered below the browser source. This keeps the background stable
   * while the browser source re-renders on verse navigation.
   *
   * Gradient backgrounds are excluded — they render in browser source CSS
   * since OBS has no native gradient source.
   */
  private _hasSeparateFullscreenBg(
    themeSettings: Record<string, unknown> | null | undefined,
  ): boolean {
    const canvas = getDefaultCanvasSize();
    return Boolean(this._resolveNativeBackgroundSource(themeSettings, canvas));
  }

  // Double-buffer slot tracking: which slot (A or B) is currently active per key.
  // Slot A = bgSourceName, Slot B = bgSourceName + " 2". Swapping avoids
  // destroy-recreate flicker when the background type changes (color → image).
  private _bgActiveSlot: Record<string, "A" | "B"> = {};

  private _bgSourceNames(key: string): { a: string; b: string } {
    const def = this._fullscreenSceneDefs[key];
    if (!def) return { a: "", b: "" };
    return { a: def.bgSourceName, b: `${def.bgSourceName} 2` };
  }

  /**
   * Ensure a persistent background source (color, image, or video) exists in
   * the fullscreen scene, layered below the browser source at index 0. This
   * keeps the background stable while the browser source re-renders on verse
   * navigation — the OBS-native source is never touched during verse changes.
   *
   * Uses double-buffer slots (A/B) so type transitions (color → image, etc.)
   * create the new source first, then swap — zero visible flicker.
   */
  private async _ensureFullscreenBgSource(
    key: string,
    themeSettings: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const def = this._fullscreenSceneDefs[key];
    if (!def || !themeSettings) return;
    const canvas = await this.getCanvasSize();
    const nativeBg = this._resolveNativeBackgroundSource(themeSettings, canvas);

    // Determine what kind of OBS source we need
    let neededKind: "image_source" | "color_source_v3" | "ffmpeg_source" | "browser_source" | null = null;
    let neededSettings: Record<string, unknown> = {};
    if (nativeBg) {
      neededKind = nativeBg.inputKind;
      neededSettings = nativeBg.inputSettings;
    } else if (this._hasBrowserRenderedBackground(themeSettings)) {
      const { cleanSettings, css } = this.stripThemeDataUris(themeSettings);
      neededKind = "browser_source";
      neededSettings = {
        url: this.buildFullscreenBackgroundUrl(cleanSettings),
        css: css || undefined,
        width: canvas.width,
        height: canvas.height,
        bgcolor: "#00000000",
        shutdown: false,
        restart_when_active: false,
      };
    }

    const bgSignature = neededKind
      ? JSON.stringify({ kind: neededKind, settings: neededSettings })
      : "__hidden__";
    if (this._activeFullscreenBgSignature[key] === bgSignature) {
      return;
    }

    if (!neededKind) {
      await this._hideFullscreenBgSource(key);
      this._activeFullscreenBgSignature[key] = "__hidden__";
      return;
    }

    const names = this._bgSourceNames(key);
    const activeSlot = this._bgActiveSlot[key] || "A";
    const activeName = activeSlot === "A" ? names.a : names.b;
    const inactiveName = activeSlot === "A" ? names.b : names.a;

    // Fetch input list once to check both active and inactive slots (saves a round-trip)
    let inputList: Array<{ inputName: string; inputKind: string }> = [];
    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      inputList = inputs.inputs;
    } catch { /* ignore */ }

    const activeKind = inputList.find((i) => i.inputName === activeName)?.inputKind ?? "";

    // If the active slot already matches the needed type, just update its settings
    if (activeKind === neededKind) {
      await this.call("SetInputSettings", { inputName: activeName, inputSettings: neededSettings }).catch(() => { });
      await this._ensureBgSceneItem(key, activeName, canvas);
      this._activeFullscreenBgSignature[key] = bgSignature;
      return;
    }

    // Type changed (or first time) — create in the inactive slot, then swap.
    // This ensures the old source stays visible until the new one is ready.

    // Create or update the inactive slot with the new type
    let inactiveKind = inputList.find((i) => i.inputName === inactiveName)?.inputKind ?? "";

    // If inactive slot has a different kind, destroy it first
    if (inactiveKind && inactiveKind !== neededKind) {
      await this._destroyBgInput(key, inactiveName);
      inactiveKind = "";
    }

    if (!inactiveKind) {
      await this.call("CreateInput", {
        inputName: inactiveName,
        inputKind: neededKind,
        inputSettings: neededSettings,
        sceneName: def.sceneName,
      }).catch(() => { });
    } else {
      await this.call("SetInputSettings", { inputName: inactiveName, inputSettings: neededSettings }).catch(() => { });
    }

    // Ensure the inactive slot is in the scene at index 0
    await this._ensureBgSceneItem(key, inactiveName, canvas);

    // Hide the old active slot
    await this._hideBgSceneItem(key, activeName);

    // Swap
    this._bgActiveSlot[key] = activeSlot === "A" ? "B" : "A";
    this._activeFullscreenBgSignature[key] = bgSignature;
  }

  /** Ensure a BG source is in the fullscreen scene at index 0 (below browser). */
  private async _ensureBgSceneItem(
    key: string,
    sourceName: string,
    canvas: { width: number; height: number },
  ): Promise<void> {
    const def = this._fullscreenSceneDefs[key];
    if (!def) return;
    try {
      const resp = await this.call("GetSceneItemList", { sceneName: def.sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };
      let bgItemId = resp.sceneItems.find((i) => i.sourceName === sourceName)?.sceneItemId;

      if (bgItemId === undefined) {
        const created = await this.call("CreateSceneItem", {
          sceneName: def.sceneName,
          sourceName,
          sceneItemEnabled: true,
        }) as { sceneItemId: number };
        bgItemId = created.sceneItemId;
      }

      await this.call("SetSceneItemTransform", {
        sceneName: def.sceneName,
        sceneItemId: bgItemId,
        positionX: 0, positionY: 0,
        boundsType: "OBS_BOUNDS_SCALE_OUTER",
        boundsWidth: canvas.width, boundsHeight: canvas.height,
        boundsAlignment: 0, rotation: 0,
      });
      await this.call("SetSceneItemIndex", { sceneName: def.sceneName, sceneItemId: bgItemId, sceneItemIndex: 0 });
      await this.call("SetSceneItemEnabled", { sceneName: def.sceneName, sceneItemId: bgItemId, sceneItemEnabled: true });
    } catch { /* best effort */ }
  }

  /** Hide a BG source's scene item (disable visibility). Uses cached scene item list. */
  private async _hideBgSceneItem(key: string, sourceName: string): Promise<void> {
    const def = this._fullscreenSceneDefs[key];
    if (!def) return;
    try {
      const items = await this.getSceneItemListCached(def.sceneName);
      const item = items.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.call("SetSceneItemEnabled", { sceneName: def.sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: false }).catch(() => { });
      }
    } catch { /* ignore */ }
  }

  /** Destroy an OBS input by name (remove scene item first, then the input). Uses cached scene item list. */
  private async _destroyBgInput(_key: string, inputName: string): Promise<void> {
    const def = this._fullscreenSceneDefs[_key];
    if (!def) return;
    try {
      const items = await this.getSceneItemListCached(def.sceneName);
      const item = items.find((i) => i.sourceName === inputName);
      if (item) {
        await this.call("RemoveSceneItem", { sceneName: def.sceneName, sceneItemId: item.sceneItemId }).catch(() => { });
        this.invalidateSceneItemListCache(def.sceneName);
      }
    } catch { /* ignore */ }
    await this.call("RemoveInput", { inputName }).catch(() => { });
  }

  /** Hide all BG sources for a key (both double-buffer slots). */
  private async _hideFullscreenBgSource(key: string): Promise<void> {
    if (this._activeFullscreenBgSignature[key] === "__hidden__") return;
    const names = this._bgSourceNames(key);
    await this._hideBgSceneItem(key, names.a);
    await this._hideBgSceneItem(key, names.b);
    this._activeFullscreenBgSignature[key] = "__hidden__";
  }

  /**
   * Remove native fullscreen BG inputs created by older builds.
   *
   * Bible now renders its background inside MCE Browser - Bible, so keeping
   * these inputs around only creates a duplicate OBS source. The cleanup is
   * intentionally one-time per OBS session to avoid extra websocket work on
   * every verse push.
   */
  private async _removeFullscreenBgSources(key: string): Promise<void> {
    if (this._legacyFullscreenBgCleanupDone[key]) return;

    const names = this._bgSourceNames(key);
    await this._destroyBgInput(key, names.a);
    await this._destroyBgInput(key, names.b);
    if (key === "bible") {
      await this._destroyBgInput(key, "MCE BG - Bible");
      await this._destroyBgInput(key, "MCE BG - Bible 2");
    }
    this._activeFullscreenBgSignature[key] = "__hidden__";
    this._bgActiveSlot[key] = "A";
    this._legacyFullscreenBgCleanupDone[key] = true;
  }

  // ── Lower-third persistent BG (reuses double-buffer pattern) ──

  private _ltBgActiveSlot: Record<string, "A" | "B"> = {};

  private _ltBgNames(sceneName: string): { a: string; b: string } {
    const safeSceneName = sceneName.replace(/\s+/g, " ").trim();
    return {
      a: `MCE BG - ${safeSceneName}`,
      b: `MCE BG - ${safeSceneName} 2`,
    };
  }

  /**
   * Ensure a persistent background source for the lower-third dedicated
   * scene, layered below the browser source. Same double-buffer approach
   * as the fullscreen variant.
   */
  private async _ensureLowerThirdBgSource(
    sceneName: string,
    themeSettings: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    if (!themeSettings) return;

    // Fast path: if the background theme hasn't changed since last push, skip all OBS calls
    const bgSig = JSON.stringify(themeSettings);
    if (this._activeLtBgSignature[sceneName] === bgSig) {
      return;
    }

    const canvas = await this.getCanvasSize();
    let neededKind: "image_source" | "color_source_v3" | "ffmpeg_source" | "browser_source" | null = null;
    let neededSettings: Record<string, unknown> = {};
    const nativeBg = this._resolveNativeBackgroundSource(themeSettings, canvas);
    if (nativeBg) {
      neededKind = nativeBg.inputKind;
      neededSettings = nativeBg.inputSettings;
    } else if (this._hasBrowserRenderedBackground(themeSettings)) {
      const { cleanSettings, css } = this.stripThemeDataUris(themeSettings);
      neededKind = "browser_source";
      neededSettings = {
        url: this.buildFullscreenBackgroundUrl(cleanSettings),
        css: css || undefined,
      };
    }

    if (!neededKind) {
      await this._hideLowerThirdBgSource(sceneName);
      return;
    }

    const names = this._ltBgNames(sceneName);
    const activeSlot = this._ltBgActiveSlot[sceneName] || "A";
    const activeName = activeSlot === "A" ? names.a : names.b;
    const inactiveName = activeSlot === "A" ? names.b : names.a;

    // Fetch input list once to check both slots (saves a round-trip)
    let inputList: Array<{ inputName: string; inputKind: string }> = [];
    try {
      const inputs = await this.call("GetInputList") as { inputs: Array<{ inputName: string; inputKind: string }> };
      inputList = inputs.inputs;
    } catch { /* ignore */ }

    const activeKind = inputList.find((i) => i.inputName === activeName)?.inputKind ?? "";

    if (activeKind === neededKind) {
      await this.call("SetInputSettings", { inputName: activeName, inputSettings: neededSettings }).catch(() => { });
      await this._ensureSceneBgItem(sceneName, activeName, canvas);
      this._activeLtBgSignature[sceneName] = bgSig;
      this._activeLtBgInputKind[sceneName] = neededKind;
      return;
    }

    // Type changed — create in inactive slot, then swap
    let inactiveKind = inputList.find((i) => i.inputName === inactiveName)?.inputKind ?? "";

    if (inactiveKind && inactiveKind !== neededKind) {
      await this._destroyBgInputByName(sceneName, inactiveName);
      inactiveKind = "";
    }

    if (!inactiveKind) {
      await this.call("CreateInput", { inputName: inactiveName, inputKind: neededKind, inputSettings: neededSettings, sceneName }).catch(() => { });
    } else {
      await this.call("SetInputSettings", { inputName: inactiveName, inputSettings: neededSettings }).catch(() => { });
    }

    await this._ensureSceneBgItem(sceneName, inactiveName, canvas);
    await this._hideSceneBgItem(sceneName, activeName);
    this._ltBgActiveSlot[sceneName] = activeSlot === "A" ? "B" : "A";
    this._activeLtBgSignature[sceneName] = bgSig;
    this._activeLtBgInputKind[sceneName] = neededKind;
  }

  /** Hide all lower-third BG sources (both double-buffer slots). */
  private async _hideLowerThirdBgSource(sceneName: string): Promise<void> {
    if (this._activeLtBgSignature[sceneName] === "__hidden__") return;
    this._activeLtBgSignature[sceneName] = "__hidden__";
    this._activeLtBgInputKind[sceneName] = "";
    const names = this._ltBgNames(sceneName);
    await this._hideSceneBgItem(sceneName, names.a);
    await this._hideSceneBgItem(sceneName, names.b);
  }

  /** Ensure a BG source is in the given scene at index 0. */
  private async _ensureSceneBgItem(
    sceneName: string,
    sourceName: string,
    canvas: { width: number; height: number },
  ): Promise<void> {
    try {
      let items = await this.getSceneItemListCached(sceneName);
      let bgItemId = items.find((i) => i.sourceName === sourceName)?.sceneItemId;

      if (bgItemId === undefined) {
        const created = await this.call("CreateSceneItem", { sceneName, sourceName, sceneItemEnabled: true }) as { sceneItemId: number };
        bgItemId = created.sceneItemId;
        this.invalidateSceneItemListCache(sceneName);
      }

      await this.call("SetSceneItemTransform", {
        sceneName, sceneItemId: bgItemId,
        positionX: 0, positionY: 0,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsWidth: canvas.width, boundsHeight: canvas.height,
        boundsAlignment: 0, rotation: 0,
      });
      await this.call("SetSceneItemIndex", { sceneName, sceneItemId: bgItemId, sceneItemIndex: 0 });
      await this.call("SetSceneItemEnabled", { sceneName, sceneItemId: bgItemId, sceneItemEnabled: true });

      this._lastBgItemState[sceneName] = { sourceName, itemId: bgItemId, width: canvas.width, height: canvas.height };
    } catch { /* best effort */ }
  }

  /** Hide a BG scene item by source name. Uses cached scene item list. */
  private async _hideSceneBgItem(sceneName: string, sourceName: string): Promise<void> {
    try {
      const items = await this.getSceneItemListCached(sceneName);
      const item = items.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.call("SetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: false }).catch(() => { });
      }
    } catch { /* ignore */ }
  }

  /** Destroy an OBS input by name within a scene. Uses cached scene item list. */
  private async _destroyBgInputByName(sceneName: string, inputName: string): Promise<void> {
    try {
      const items = await this.getSceneItemListCached(sceneName);
      const item = items.find((i) => i.sourceName === inputName);
      if (item) {
        await this.call("RemoveSceneItem", { sceneName, sceneItemId: item.sceneItemId }).catch(() => { });
      }
    } catch { /* ignore */ }
    await this.call("RemoveInput", { inputName }).catch(() => { });
  }

  async showFullscreenScene(key: string, css?: string): Promise<void> {
    await this._ensureFullscreenScene(key);
    const def = this._fullscreenSceneDefs[key];

    if (css) {
      await this.call("SetInputSettings", { inputName: def.browserSourceName, inputSettings: { css } });
    }

    const studioMode = await this.call("GetStudioModeEnabled").then((r: unknown) => (r as { studioModeEnabled: boolean }).studioModeEnabled).catch(() => false);
    if (studioMode) {
      await this.call("SetCurrentPreviewScene", { sceneName: def.sceneName });
    } else {
      await this.call("SetCurrentProgramScene", { sceneName: def.sceneName });
    }
  }

  async hideFullscreenScene(_key: string): Promise<void> {
    const scenes = await this.getObsSceneNames();
    const fallback = scenes.find((s) => !s.startsWith("MCE -") && !s.startsWith("VC -"));
    if (!fallback) return;

    const studioMode = await this.call("GetStudioModeEnabled").then((r: unknown) => (r as { studioModeEnabled: boolean }).studioModeEnabled).catch(() => false);
    if (studioMode) {
      await this.call("SetCurrentPreviewScene", { sceneName: fallback });
    } else {
      await this.call("SetCurrentProgramScene", { sceneName: fallback });
    }
  }

  async isFullscreenSceneActive(key: string): Promise<boolean> {
    const def = this._fullscreenSceneDefs[key];
    const scenes = await this.getObsSceneNames();
    if (!scenes.includes(def.sceneName)) return false;

    const studioMode = await this.call("GetStudioModeEnabled").then((r: unknown) => (r as { studioModeEnabled: boolean }).studioModeEnabled).catch(() => false);
    try {
      if (studioMode) {
        const resp = await this.call("GetCurrentPreviewScene") as { currentPreviewSceneName: string; sceneName?: string };
        return (resp.currentPreviewSceneName || resp.sceneName || "") === def.sceneName;
      } else {
        const resp = await this.call("GetCurrentProgramScene") as { currentProgramSceneName: string; sceneName?: string };
        return (resp.currentProgramSceneName || resp.sceneName || "") === def.sceneName;
      }
    } catch {
      return false;
    }
  }

  async updateFullscreenSceneContent(key: string, css: string): Promise<void> {
    await this._ensureFullscreenScene(key);
    const def = this._fullscreenSceneDefs[key];
    await this.call("SetInputSettings", { inputName: def.browserSourceName, inputSettings: { css } });
  }

  /**
   * Programmatically triggers OBS Browser Source "Refresh cache of current page".
   * Calls OBS WebSocket v5 `PressInputPropertiesButton` with propertyName: "refreshnocache".
   */
  async refreshBrowserSourceCache(inputName: string): Promise<boolean> {
    if (isFreeDockPlan()) return false;
    try {
      await this.call("PressInputPropertiesButton", {
        inputName,
        propertyName: "refreshnocache",
      });
      return true;
    } catch (err) {
      console.warn(`[DockObsClient] Failed to refresh cache for input "${inputName}":`, err);
      return false;
    }
  }

  /**
   * Refreshes the cache of all active MCE browser sources (Bible, Worship, Notes, Countdown).
   * Queries existing browser inputs to avoid unnecessary OBS errors and refreshes
   * CEF documents concurrently in the background.
   */
  async refreshAllOverlayCaches(): Promise<void> {
    if (isFreeDockPlan()) return;
    try {
      const resp = await this.call("GetInputList").catch(() => null) as {
        inputs?: Array<{ inputName: string; inputKind: string }>;
      } | null;
      if (resp?.inputs) {
        const browserInputs = new Set(
          resp.inputs.filter((i) => i.inputKind === "browser_source").map((i) => i.inputName),
        );
        const targetSources = new Set<string>();
        for (const def of Object.values(this._fullscreenSceneDefs)) {
          targetSources.add(def.browserSourceName);
          for (const alias of this.getSourceAliases(def.browserSourceName)) {
            targetSources.add(alias);
          }
        }
        const toRefresh = Array.from(targetSources).filter((name) => browserInputs.has(name));
        if (toRefresh.length > 0) {
          await Promise.allSettled(toRefresh.map((name) => this.refreshBrowserSourceCache(name)));
          return;
        }
      }
    } catch {
      // Fallback to configured source names
    }

    const sources = Object.values(this._fullscreenSceneDefs).map((d) => d.browserSourceName);
    await Promise.allSettled(sources.map((name) => this.refreshBrowserSourceCache(name)));
  }

  /**
   * Capture a lightweight JPEG screenshot of the current presentation or program output.
   * Silently returns null if OBS is disconnected or capture fails.
   */
  async captureScreenshot(sourceName?: string, imageWidth = 1280): Promise<string | null> {
    try {
      if (!this.isConnected) return null;

      let targetSource = (sourceName || "").trim();
      if (!targetSource) {
        // Try to capture MCE Presentation scene first, or fall back to Program scene
        const scenes = await this.getObsSceneNames().catch(() => [] as string[]);
        if (scenes.includes(DOCK_PRESENTATION_SCENE)) {
          targetSource = DOCK_PRESENTATION_SCENE;
        } else {
          targetSource = await this.getCurrentProgramSceneName().catch(() => "");
        }
      }

      if (!targetSource) return null;

      const resp = await this.call("GetSourceScreenshot", {
        sourceName: targetSource,
        imageFormat: "jpeg",
        imageWidth,
        imageCompressionQuality: 80,
      });

      const imageData = (resp as { imageData?: string })?.imageData;
      return typeof imageData === "string" && imageData.length > 0 ? imageData : null;
    } catch (err) {
      console.warn("[DockObsClient] captureScreenshot failed:", err);
      return null;
    }
  }

  /**
   * Get the current streaming status from OBS (whether stream is active, timecode, bytes, etc.).
   */
  async getStreamStatus(): Promise<{
    outputActive: boolean;
    outputReconnecting: boolean;
    outputTimecode: string;
    outputDuration: number;
    outputBytes: number;
    outputSkippedFrames: number;
    outputTotalFrames: number;
  }> {
    return (await this.call("GetStreamStatus", undefined, { bypassFreeMutationGate: true })) as never;
  }

  /**
   * Get the current stream service settings (RTMP server, service, key) from OBS.
   */
  async getStreamServiceSettings(): Promise<{
    streamServiceType: string;
    streamServiceSettings: Record<string, unknown>;
  }> {
    return (await this.call("GetStreamServiceSettings", undefined, { bypassFreeMutationGate: true })) as never;
  }

  /**
   * Set the stream service settings (RTMP server, service, key) in OBS.
   */
  async setStreamServiceSettings(
    streamServiceType: string,
    streamServiceSettings: Record<string, unknown>,
  ): Promise<void> {
    await this.call(
      "SetStreamServiceSettings",
      { streamServiceType, streamServiceSettings },
      { bypassFreeMutationGate: true },
    );
  }

  /**
   * Start live streaming in OBS.
   */
  async startStream(): Promise<void> {
    await this.call("StartStream", undefined, { bypassFreeMutationGate: true });
  }

  /**
   * Stop live streaming in OBS.
   */
  async stopStream(): Promise<void> {
    await this.call("StopStream", undefined, { bypassFreeMutationGate: true });
  }

  /**
   * Toggle streaming in OBS.
   */
  async toggleStream(): Promise<{ outputActive: boolean }> {
    return (await this.call("ToggleStream", undefined, { bypassFreeMutationGate: true })) as never;
  }
}

export const dockObsClient = new DockObsClient();

// Warm the lower-third catalog once the Dock is idle, off the start-up path.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const warm = () => { void DockObsClient.warmLowerThirdCatalog(); };
    if (idle) idle(warm, { timeout: 5000 });
    else warm();
  }, 3000);
}
