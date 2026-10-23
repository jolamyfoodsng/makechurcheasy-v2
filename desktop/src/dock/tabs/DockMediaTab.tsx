/**
 * DockMediaTab.tsx — Media tab for the MakeChurchEazy Dock
 *
 * Lists all sources in the current OBS scene and lets the user:
 *   • Toggle source visibility (show/hide)
 *   • Refresh the source list
 *   • Browse uploaded media files and play them in OBS
 *
 * Replaces the former "Ticker" tab.
 */

import { memo, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import {
  dockObsClient,
  type DockDocumentMediaOptions,
  type DockMediaSendOptions,
  DOCK_MEDIA_VIDEO_SOURCE,
  DOCK_MEDIA_IMAGE_SOURCE,
  DOCK_MEDIA_AUDIO_SOURCE,
  getSceneMediaSourceName,
} from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import { dockClient } from "../../services/dockBridge";
import type { DockStagedItem } from "../dockTypes";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import type { MediaItem } from "../../library/libraryTypes";
import {
  compareMediaItemsNewest,
  getMediaSortTimestamp,
  getMediaStableKey,
  getUploadTimestampFromFileName,
  type MediaOrderMetadata,
} from "../../library/mediaOrdering";
import { BACKGROUND_PATTERNS, type BackgroundPattern } from "../../library/backgroundAssets";
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { track } from "../../services/analytics";
import { trackMediaPresented, trackMediaUploaded } from "../../services/tracking";
import {
  downloadTemplatePictureToLibrary,
  downloadTemplateVideoToLibrary,
  compareTemplateAssetsNewest,
  fetchTemplatePictures,
  fetchTemplateVideos,
  type TemplatePictureAsset,
  type TemplateVideoAsset,
} from "../../services/templateVideos";
import { getSafeFileName, registerDockMediaItem, uploadFileToDock } from "../dockUploadService";
import { isInternalDockMediaItem, isInternalDockUploadFile } from "../internalMediaAssets";
import { getDockPlan, isDockTrialActive, requireEntitlement, showUpgradeModal } from "../dockEntitlement";
import { getMediaKind, isSupportedMediaFile } from "../../services/mediaValidation";
import {
  convertDocumentToPageFiles,
  getDocumentTypeLabel,
  isSupportedDocumentFile,
  type DocumentPageFile,
} from "../documentConversion";
import { checkEntitlementSync, getFeatureLimit } from "../../services/entitlementClient";
import Icon from "../DockIcon";
import { addMediaToActiveSchedule } from "../dockScheduleService";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import { isUserSelectableObsScene } from "../../services/dockSceneNames";
import { useTranslation } from "react-i18next";
import {
  clearPresentationScreen,
  publishMediaToPresentation,
  publishTextOverlayToPresentation,
} from "../../services/presentationPublish";
import { fuzzyMatch } from "../../services/fuzzySearch";
import { isDockTabVisible } from "../dockTabVisibility";
import {
  EDITABLE_TEMPLATE_BROADCAST_CHANNEL,
  EDITABLE_TEMPLATE_STORAGE_EVENT,
  loadSavedTemplateImagesFromDockData,
  type DockTemplateImage,
} from "../../templates/editableTemplateStorage";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  presentationOutputTarget?: DockPresentationOutputTarget;
}

type DockMediaKind = "video" | "image" | "audio";
type DockMediaFilter = "all" | DockMediaKind | "document";
/** One ticked type in the Filter menu. No ticked type means "all". */
type DockMediaFilterKind = Exclude<DockMediaFilter, "all">;
type DockMediaViewMode = "uploaded" | "recent";
type DockMediaBrowserTab = "uploads" | "templates" | "animations" | "patterns" | "text";
type DockAddMediaTab = "background" | "template-videos";
type DockAnimationCatalogTab = "videos" | "pictures";
type DockTextAlign = "left" | "center" | "right";
type DockTextVerticalPos = "top" | "center" | "bottom";
type DockTextAnimation = "none" | "fade" | "fade-up" | "slide-up" | "slide-down" | "zoom";
type OverlayDisplayMode = "text-only" | "box" | "lower-third" | "fullscreen";
type OverlayBgType = "color" | "image" | "pattern";
type OverlayBgWidth = "full" | "clip";

interface OverlayBackgroundSettings {
  enabled: boolean;
  mode: OverlayDisplayMode;
  bgType: OverlayBgType;
  color: string;
  opacity: number;
  imageId: string | null;
  patternId: string | null;
  blur: number;
  scale: number;
  radius: number;
  padding: number;
  width: OverlayBgWidth;
  imageDataUrl?: string | null;
  patternSvgData?: string | null;
}

interface DockTextOverlayState {
  headline: string;
  subline: string;
  textColor: string;
  align: DockTextAlign;
  verticalPos: DockTextVerticalPos;
  headlineSize: number;
  sublineSize: number;
  animation: DockTextAnimation;
  animationDuration: number;
  background: OverlayBackgroundSettings;
}

interface DockMediaEntry {
  key: string;
  prefKey: string;
  name: string;
  kind: DockMediaKind;
  createdAt: string;
  uploadedAt?: string;
  originLabel: string;
  mimeLabel?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  libraryItem?: MediaItem;
  durationSec?: number;
  fileSize?: number;
  playingKey: string;
  uploadFile?: string;
}

interface DockDocumentDeck {
  key: string;
  documentId: string;
  name: string;
  mimeLabel: string;
  pages: DockMediaEntry[];
  pageCount: number;
  createdAt: string;
  coverPage: DockMediaEntry;
}

type DockDocumentTransition = "cut" | "fade";
type DockDocumentAlignment = DockDocumentMediaOptions["alignment"];

interface DockDocumentDisplayState {
  fitMode: "cover" | "contain";
  showBackground: boolean;
  showPageLabel: boolean;
  alignment: DockDocumentAlignment;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

interface ActiveMediaTargets {
  active: DockMediaEntry | null;
}

interface DockMediaPreference {
  videoMuted?: boolean;
  imageAudioInputName?: string | null;
  loop?: boolean;
  restartOnActivate?: boolean;
  closeWhenInactive?: boolean;
  clearOnMediaEnd?: boolean;
  playbackSpeed?: number;
  fitMode?: "cover" | "contain" | "stretch";
  label?: string;
  pinned?: boolean;
  folder?: string | null;
  hidden?: boolean;
  lastUsedAt?: string;
}

type DockMediaPreferences = Record<string, DockMediaPreference>;
type DockMediaFitMode = "cover" | "contain" | "stretch";

interface ActiveMediaPlaybackState {
  active: boolean;
}

interface DockMediaTargetKeys {
  active: string | null;
}

interface DockMediaSessionState {
  browserTab: DockMediaBrowserTab;
  activeKind: DockMediaFilter;
  /** Types ticked in the Filter menu (several allowed). Missing in older saved sessions. */
  activeKinds?: DockMediaFilterKind[];
  viewMode: DockMediaViewMode;
  activeTargetKeys: DockMediaTargetKeys;
  pausedTargets: ActiveMediaPlaybackState;
  textOverlay: DockTextOverlayState;
  textOverlayTargets: { active: boolean };
}

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "avi", "mkv", "wmv", "flv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "m4b", "wma", "opus"]);
const MEDIA_PREFS_STORAGE_KEY = "ocs-dock-media-preferences-v1";
const MEDIA_FOLDERS_STORAGE_KEY = "ocs-dock-media-folders-v1";
const MEDIA_LOCAL_LIBRARY_STORAGE_KEY = "ocs-dock-media-library-v1";
const MEDIA_SESSION_STORAGE_KEY = "ocs-dock-media-session-v1";
const MEDIA_CONTEXT_MENU_WIDTH = 260;
const MEDIA_CONTEXT_MENU_GAP = 8;
const MEDIA_CONTEXT_MENU_GUTTER = 8;
const INTERNAL_UPLOAD_PREFIXES = ["dock_theme_bg_", "dock_theme_box_bg_", "dock_theme_logo_", "mce-template-"];
const TEXT_OVERLAY_HEADLINE_MIN_SIZE = 24;
const TEXT_OVERLAY_SUBLINE_MIN_SIZE = 14;
const TEXT_OVERLAY_MAX_FONT_SIZE = 250;
const TEXT_OVERLAY_PADDING_MIN = 0;
const TEXT_OVERLAY_PADDING_MAX = 250;
type DockTextSizePresetId = "small" | "large" | "larger" | "extra-large";

interface DockTextSizePreset {
  id: DockTextSizePresetId;
  value: number;
  labelKey: string;
}

const HEADLINE_SIZE_PRESETS: DockTextSizePreset[] = [
  { id: "small", value: 48, labelKey: "media.sizeSmall" },
  { id: "large", value: 72, labelKey: "media.sizeLarge" },
  { id: "larger", value: 96, labelKey: "media.sizeLarger" },
  { id: "extra-large", value: 128, labelKey: "media.sizeExtraLarge" },
];

const SUBLINE_SIZE_PRESETS: DockTextSizePreset[] = [
  { id: "small", value: 16, labelKey: "media.sizeSmall" },
  { id: "large", value: 28, labelKey: "media.sizeLarge" },
  { id: "larger", value: 40, labelKey: "media.sizeLarger" },
  { id: "extra-large", value: 56, labelKey: "media.sizeExtraLarge" },
];

const DEFAULT_DOCUMENT_DISPLAY: DockDocumentDisplayState = {
  fitMode: "contain",
  showBackground: true,
  showPageLabel: true,
  alignment: "center",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

const DEFAULT_BACKGROUND_SETTINGS: OverlayBackgroundSettings = {
  enabled: false,
  mode: "text-only",
  bgType: "color",
  color: "#000000",
  opacity: 0.85,
  imageId: null,
  patternId: null,
  blur: 0,
  scale: 1,
  radius: 12,
  padding: 24,
  width: "full",
};

/** Determine icon for file type */
function getFileIcon(kind: DockMediaKind): string {
  if (kind === "video") return "movie";
  if (kind === "audio") return "music_note";
  return "image";
}

function getUploadMediaKind(name: string): DockMediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return null;
}

function isMediaFile(name: string): boolean {
  return getUploadMediaKind(name) !== null;
}

function isInternalUploadFile(name: string): boolean {
  return isInternalDockUploadFile(name) || INTERNAL_UPLOAD_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Extract createdAt ISO string from "media_<timestamp>_<safeName>" filename. */
function extractUploadTimestamp(filename: string): string {
  return getUploadTimestampFromFileName(filename);
}

/** Show the user-facing filename instead of the generated disk-storage prefix. */
function getUploadDisplayName(filename: string): string {
  return filename.replace(/^media_\d{10,13}_/, "");
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "tauri:" || "__TAURI_INTERNALS__" in window;
}

function getMediaDownloadFileName(entry: DockMediaEntry, preferredName?: string): string {
  const sourceName = (
    entry.uploadFile
    || entry.libraryItem?.diskFileName
    || entry.libraryItem?.name
    || entry.name
  ).split(/[\\/]/).pop() || "media";
  const cleanSourceName = getUploadDisplayName(sourceName);
  const sourceExtension = cleanSourceName.match(/\.[a-z0-9]{1,8}$/i)?.[0] || "";
  const requestedName = preferredName?.trim() || getUploadDisplayName(entry.name).trim() || cleanSourceName;
  const fileName = /\.[a-z0-9]{1,8}$/i.test(requestedName)
    ? requestedName
    : `${requestedName}${sourceExtension}`;
  return getSafeFileName(fileName);
}

function normalizeUploadFileName(value: string): string {
  const basename = value.split(/[\\/]/).pop() || value;
  try {
    return decodeURIComponent(basename).trim().toLowerCase();
  } catch {
    return basename.trim().toLowerCase();
  }
}

function isTemplateCatalogUploadFile(value: string): boolean {
  const name = normalizeUploadFileName(value);
  // Preserve compatibility with the existing catalog files, including the
  // historical `vidoes` spelling used by the template download endpoint.
  return name.startsWith("template_")
    || name.startsWith("template-")
    || name.startsWith("template.")
    || name.startsWith("mce-template-")
    || name.startsWith("dock_theme_")
    || name.startsWith("mv-frame-")
    || name.startsWith("mv-pattern-")
    || name.startsWith("starter_");
}

function loadMediaPreferences(): DockMediaPreferences {
  try {
    const stored = readNativeDockSetting<unknown>(MEDIA_PREFS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DockMediaPreferences;
  } catch {
    return {};
  }
}

function loadMediaFolders(): string[] {
  try {
    const stored = readNativeDockSetting<unknown>(MEDIA_FOLDERS_STORAGE_KEY);
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    if (!Array.isArray(parsed)) return [];

    return Array.from(new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    )).slice(0, 100);
  } catch {
    return [];
  }
}

function loadLocalMediaLibrary(): MediaItem[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(MEDIA_LOCAL_LIBRARY_STORAGE_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as MediaItem[]).filter((item) => !isInternalDockMediaItem(item))
      : [];
  } catch {
    return [];
  }
}

function isDockMediaBrowserTab(value: unknown): value is DockMediaBrowserTab {
  return value === "uploads" || value === "templates" || value === "animations" || value === "patterns";
}

function isDockMediaKind(value: unknown): value is DockMediaFilter {
  return value === "video" || value === "image" || value === "audio" || value === "document" || value === "all";
}

function sanitizeMediaKinds(value: unknown): DockMediaFilterKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kinds = value.filter((item): item is DockMediaFilterKind => isDockMediaKind(item) && item !== "all");
  return [...new Set(kinds)];
}

function initialMediaKinds(session: DockMediaSessionState): DockMediaFilterKind[] {
  if (session.activeKinds) return session.activeKinds;
  return session.activeKind === "all" ? [] : [session.activeKind];
}

function isDockTextAlign(value: unknown): value is DockTextAlign {
  return value === "left" || value === "center" || value === "right";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseBackgroundSettings(raw: unknown): OverlayBackgroundSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BACKGROUND_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const mode = (["text-only", "box", "lower-third", "fullscreen"] as OverlayDisplayMode[]).includes(obj.mode as OverlayDisplayMode)
    ? obj.mode as OverlayDisplayMode : DEFAULT_BACKGROUND_SETTINGS.mode;
  const bgType = (["color", "image", "pattern"] as OverlayBgType[]).includes(obj.bgType as OverlayBgType)
    ? obj.bgType as OverlayBgType : DEFAULT_BACKGROUND_SETTINGS.bgType;
  const width = (["full", "clip"] as OverlayBgWidth[]).includes(obj.width as OverlayBgWidth)
    ? obj.width as OverlayBgWidth : DEFAULT_BACKGROUND_SETTINGS.width;
  return {
    enabled: Boolean(obj.enabled),
    mode,
    bgType,
    color: typeof obj.color === "string" ? obj.color : DEFAULT_BACKGROUND_SETTINGS.color,
    opacity: typeof obj.opacity === "number" ? obj.opacity : DEFAULT_BACKGROUND_SETTINGS.opacity,
    imageId: typeof obj.imageId === "string" ? obj.imageId : null,
    patternId: typeof obj.patternId === "string" ? obj.patternId : null,
    blur: typeof obj.blur === "number" ? obj.blur : DEFAULT_BACKGROUND_SETTINGS.blur,
    scale: typeof obj.scale === "number" ? obj.scale : DEFAULT_BACKGROUND_SETTINGS.scale,
    radius: typeof obj.radius === "number" ? obj.radius : DEFAULT_BACKGROUND_SETTINGS.radius,
    padding: clampNumber(obj.padding, TEXT_OVERLAY_PADDING_MIN, TEXT_OVERLAY_PADDING_MAX, DEFAULT_BACKGROUND_SETTINGS.padding),
    width,
  };
}

function loadMediaSessionState(): DockMediaSessionState {
  const fallback: DockMediaSessionState = {
    browserTab: "uploads",
    activeKind: "all",
    viewMode: "uploaded",
    activeTargetKeys: {
      active: null,
    },
    pausedTargets: {
      active: false,
    },
    textOverlay: {
      headline: "",
      subline: "",
      textColor: "#ffffff",
      align: "center",
      verticalPos: "center",
      headlineSize: 72,
      sublineSize: 28,
      animation: "fade",
      animationDuration: 1.0,
      background: { ...DEFAULT_BACKGROUND_SETTINGS },
    },
    textOverlayTargets: {
      active: false,
    },
  };

  try {
    const raw = localStorage.getItem(MEDIA_SESSION_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DockMediaSessionState> | null;
    if (!parsed || typeof parsed !== "object") return fallback;

    const storedBrowserTab = parsed.browserTab;

    return {
      browserTab: isDockMediaBrowserTab(storedBrowserTab) ? storedBrowserTab : fallback.browserTab,
      activeKind: isDockMediaKind(parsed.activeKind) ? parsed.activeKind : fallback.activeKind,
      activeKinds: sanitizeMediaKinds(parsed.activeKinds),
      viewMode: (parsed.viewMode === "uploaded" || parsed.viewMode === "recent") ? parsed.viewMode : fallback.viewMode,
      activeTargetKeys: {
        active: typeof parsed.activeTargetKeys?.active === "string" ? parsed.activeTargetKeys.active : null,
      },
      pausedTargets: {
        active: Boolean(parsed.pausedTargets?.active),
      },
      textOverlay: {
        headline: typeof parsed.textOverlay?.headline === "string" ? parsed.textOverlay.headline : "",
        subline: typeof parsed.textOverlay?.subline === "string" ? parsed.textOverlay.subline : "",
        textColor: typeof parsed.textOverlay?.textColor === "string" ? parsed.textOverlay.textColor : fallback.textOverlay.textColor,
        align: isDockTextAlign(parsed.textOverlay?.align) ? parsed.textOverlay.align : fallback.textOverlay.align,
        verticalPos: (parsed.textOverlay?.verticalPos === "top" || parsed.textOverlay?.verticalPos === "center" || parsed.textOverlay?.verticalPos === "bottom")
          ? parsed.textOverlay.verticalPos : fallback.textOverlay.verticalPos,
        headlineSize: clampNumber(parsed.textOverlay?.headlineSize, TEXT_OVERLAY_HEADLINE_MIN_SIZE, TEXT_OVERLAY_MAX_FONT_SIZE, fallback.textOverlay.headlineSize),
        sublineSize: clampNumber(parsed.textOverlay?.sublineSize, TEXT_OVERLAY_SUBLINE_MIN_SIZE, TEXT_OVERLAY_MAX_FONT_SIZE, fallback.textOverlay.sublineSize),
        animation: parsed.textOverlay && (["none", "fade", "fade-up", "slide-up", "slide-down", "zoom"] as DockTextAnimation[]).includes(parsed.textOverlay.animation as DockTextAnimation)
          ? parsed.textOverlay.animation as DockTextAnimation : fallback.textOverlay.animation,
        animationDuration: typeof parsed.textOverlay?.animationDuration === "number" ? parsed.textOverlay.animationDuration : fallback.textOverlay.animationDuration,
        background: parseBackgroundSettings(parsed.textOverlay?.background),
      },
      textOverlayTargets: {
        active: Boolean(parsed.textOverlayTargets?.active),
      },
    };
  } catch {
    return fallback;
  }
}

function dedupeMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items
    .slice()
    .sort(compareMediaItemsNewest)
    .filter((item) => {
      const key = getMediaStableKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isTemplateMediaItem(
  item: Pick<MediaItem, "id" | "name" | "source" | "sourceAssetId" | "cloudflareKey" | "filePath" | "diskFileName" | "url">,
  templateVideos?: TemplateVideoAsset[],
  templatePictures?: TemplatePictureAsset[],
): boolean {
  if (!item) return false;
  const source = (item.source || "").toLowerCase();
  if (
    source === "template" ||
    source === "template-cloudflare" ||
    source === "template-local" ||
    source === "template-video" ||
    source === "template-picture" ||
    source.includes("template") ||
    source === "starter"
  ) {
    return true;
  }
  if (Boolean(item.sourceAssetId) || Boolean(item.cloudflareKey)) {
    return true;
  }
  const id = (item.id || "").toLowerCase();
  if (
    id.startsWith("saved-template:") ||
    id.startsWith("template:") ||
    id.startsWith("template-") ||
    id.startsWith("starter:")
  ) {
    return true;
  }
  const filePath = item.filePath || "";
  if (filePath.includes("backgrounds/videos") || filePath.includes("backgrounds\\videos")) {
    return true;
  }
  const url = item.url || "";
  if (url.includes("/uploads/backgrounds/videos/")) {
    return true;
  }
  const name = item.name || "";
  const diskFileName = item.diskFileName || "";
  if (isTemplateCatalogUploadFile(name) || isTemplateCatalogUploadFile(diskFileName) || isTemplateCatalogUploadFile(filePath)) {
    return true;
  }
  if (isInternalDockMediaItem(item as MediaItem)) {
    return true;
  }
  const normName = normalizeUploadFileName(name);
  const normDisk = normalizeUploadFileName(diskFileName);
  if (templateVideos && templateVideos.length > 0) {
    if (templateVideos.some((v) => {
      const vName = normalizeUploadFileName(v.fileName);
      return vName === normName || vName === normDisk || (v.cloudflareKey && normalizeUploadFileName(v.cloudflareKey) === normName);
    })) {
      return true;
    }
  }
  if (templatePictures && templatePictures.length > 0) {
    if (templatePictures.some((p) => {
      const pName = normalizeUploadFileName(p.fileName);
      return pName === normName || pName === normDisk || (p.cloudflareKey && normalizeUploadFileName(p.cloudflareKey) === normName);
    })) {
      return true;
    }
  }
  return false;
}

function isAnimationMediaItem(item: MediaItem, templateVideos?: TemplateVideoAsset[], templatePictures?: TemplatePictureAsset[]): boolean {
  return (item.type === "video" || item.type === "image") && isTemplateMediaItem(item, templateVideos, templatePictures);
}

function getMediaPreviewUrl(item: MediaItem, overlayBaseUrl: string): string {
  if (item.diskFileName) {
    return `${overlayBaseUrl}/uploads/${encodeURIComponent(item.diskFileName)}`;
  }
  return item.url;
}

function fmtDuration(totalSeconds?: number): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

function formatFitMode(value: DockMediaFitMode, t: (key: string) => string): string {
  switch (value) {
    case "contain":
      return t('media.fitModeFit');
    case "stretch":
      return t('media.fitModeStretch');
    case "cover":
    default:
      return t('media.fitModeFill');
  }
}

function getClosestTextSizePreset(value: number, presets: readonly DockTextSizePreset[]): DockTextSizePreset {
  return presets.reduce((closest, preset) => {
    return Math.abs(preset.value - value) < Math.abs(closest.value - value) ? preset : closest;
  }, presets[0]);
}

function buildSceneMediaSourceName(entry: DockMediaEntry, targetScene?: string): string {
  return getSceneMediaSourceName(entry.kind, entry.name, targetScene, entry.prefKey);
}

function canSendEntryToScene(entry: DockMediaEntry): boolean {
  return Boolean(entry.uploadFile || entry.libraryItem);
}

function createLibraryEntry(item: MediaItem, overlayBaseUrl: string, originLabel: string): DockMediaEntry {
  const prefKey = `media:${item.filePath || item.diskFileName || item.id}`;
  const isDocumentPage = item.source === "document-conversion" && item.documentPageNumber;
  return {
    key: prefKey,
    prefKey,
    name: isDocumentPage
      ? `${item.documentSourceName || item.name} · Page ${item.documentPageNumber}${item.documentPageCount ? `/${item.documentPageCount}` : ""}`
      : item.name,
    kind: item.type,
    createdAt: item.createdAt,
    uploadedAt: item.uploadedAt,
    originLabel: isDocumentPage ? "Document" : originLabel,
    mimeLabel: isDocumentPage
      ? `Page ${item.documentPageNumber}${item.documentPageCount ? `/${item.documentPageCount}` : ""}`
      : item.mimeType?.split("/")[1]?.toUpperCase(),
    thumbnailUrl: item.thumbnailUrl,
    previewUrl: getMediaPreviewUrl(item, overlayBaseUrl),
    libraryItem: item,
    durationSec: item.durationSec,
    fileSize: item.fileSize,
    playingKey: `library:${item.id}`,
  };
}

function createSavedTemplateEntry(template: DockTemplateImage): DockMediaEntry {
  const safeId = template.id.replace(/[^a-z0-9_-]+/gi, "-") || "template";
  const imageFileName = `mce-template-${safeId}.png`;
  const libraryItem: MediaItem = {
    id: `saved-template:${template.id}`,
    name: imageFileName,
    type: "image",
    url: template.imageUrl,
    thumbnailUrl: template.imageUrl,
    width: template.width,
    height: template.height,
    mimeType: "image/png",
    createdAt: template.updatedAt || new Date().toISOString(),
    uploadedAt: template.updatedAt || undefined,
    source: "local",
  };

  return {
    key: `saved-template:${template.id}`,
    prefKey: `saved-template:${template.id}`,
    name: template.name,
    kind: "image",
    createdAt: libraryItem.createdAt,
    uploadedAt: libraryItem.uploadedAt,
    originLabel: "Templates",
    mimeLabel: "TEMPLATE",
    thumbnailUrl: template.imageUrl,
    previewUrl: template.imageUrl,
    libraryItem,
    playingKey: `saved-template:${template.id}`,
  };
}

function getDockMediaOrderMetadata(entry: DockMediaEntry): MediaOrderMetadata {
  return {
    createdAt: entry.createdAt,
    uploadedAt: entry.uploadedAt || entry.libraryItem?.uploadedAt,
    downloadedAt: entry.libraryItem?.downloadedAt,
    diskFileName: entry.uploadFile || entry.libraryItem?.diskFileName,
    filePath: entry.libraryItem?.filePath,
    id: entry.libraryItem?.id || entry.key,
    name: entry.name,
    type: entry.kind,
  };
}

function matchesMediaEntrySearch(
  entry: DockMediaEntry,
  preference: DockMediaPreference | undefined,
  query: string,
): boolean {
  if (!query) return true;
  return [entry.name, preference?.label]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => fuzzyMatch(query, value));
}

function getDocumentImportDate(createdAt: string | undefined): string {
  if (!createdAt || createdAt.startsWith("0001-")) return "";
  return createdAt;
}

function createPatternEntry(pattern: BackgroundPattern, originLabel: string): DockMediaEntry {
  const key = `pattern:${pattern.label}`;
  return {
    key,
    prefKey: key,
    name: pattern.label,
    kind: "image",
    createdAt: "",
    originLabel,
    mimeLabel: "SVG",
    previewUrl: pattern.src,
    playingKey: key,
  };
}

function isAnimatedPattern(pattern: BackgroundPattern): boolean {
  return /%3Canimate(?:Transform)?/i.test(pattern.src);
}

function AnimationTilePreview({ src, label }: { src: string; label: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [hoverPlay, setHoverPlay] = useState(false);
  const previewSrc = `${src}#t=0.1`;

  useEffect(() => {
    const node = hostRef.current;
    if (!node || shouldLoad) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!hoverPlay || !shouldLoad) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => { });
    return () => {
      if (video) { video.pause(); try { video.currentTime = 0.1; } catch { /* */ } }
    };
  }, [hoverPlay, shouldLoad]);

  return (
    <div
      ref={hostRef}
      className="dock-animation-tile__thumb"
      onMouseEnter={() => setHoverPlay(true)}
      onMouseLeave={() => setHoverPlay(false)}
      onFocus={() => setHoverPlay(true)}
      onBlur={() => setHoverPlay(false)}
    >
      {shouldLoad ? (
        <video
          ref={videoRef}
          className="dock-animation-tile__img"
          src={previewSrc}
          muted
          playsInline
          preload="metadata"
          aria-label={`${label} preview`}
        />
      ) : (
        <div className="dock-animation-tile__placeholder" aria-hidden="true">
          <Icon name="movie" size={20} />
        </div>
      )}
    </div>
  );
}

function DockMediaTab({
  staged: _staged,
  onStage: _onStage,
  presentationOutputTarget = "obs",
}: Props) {
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const overlayBaseUrl = getOverlayBaseUrlSync();
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isNarrowWidth, setIsNarrowWidth] = useState(false);
  const [isCompactHeight, setIsCompactHeight] = useState(false);
  const [isUltraCompactHeight, setIsUltraCompactHeight] = useState(false);
  const [isMicroHeight, setIsMicroHeight] = useState(false);
  const [mediaSession] = useState<DockMediaSessionState>(() => loadMediaSessionState());
  const [browserTab, setBrowserTab] = useState<DockMediaBrowserTab>(() => mediaSession.browserTab === "templates" ? "uploads" : mediaSession.browserTab);

  useEffect(() => {
    if (browserTab === "templates") {
      setBrowserTab("uploads");
    }
  }, [browserTab]);
  const [dockPlan, setDockPlan] = useState(() => getDockPlan());
  // Filter menu: any number of types can be ticked (none = all). The older single-type logic below
  // keeps reading `activeKind`: exactly one ticked type is that type, anything else counts as "all".
  const [activeKinds, setActiveKinds] = useState<DockMediaFilterKind[]>(() => initialMediaKinds(mediaSession));
  const activeKind: DockMediaFilter = activeKinds.length === 1 ? activeKinds[0] : "all";
  const setActiveKind = useCallback(
    (kind: DockMediaFilter) => setActiveKinds(kind === "all" ? [] : [kind]),
    [],
  );
  const toggleMediaKind = useCallback(
    (kind: DockMediaFilterKind) => setActiveKinds((current) => (
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
    )),
    [],
  );
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  // Short docks: Uploads / Animations / Patterns collapse into one dropdown (was a third side column).
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [viewMenuOpen]);
  useEffect(() => {
    if (!filterMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) setFilterMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterMenuOpen]);
  const [viewMode, setViewMode] = useState<DockMediaViewMode>(() => mediaSession.viewMode);
  const [assetSearch, setAssetSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showAddMediaModal, setShowAddMediaModal] = useState(false);
  const [templateVideoOnlyModal, setTemplateVideoOnlyModal] = useState(false);
  const [addMediaTab, setAddMediaTab] = useState<DockAddMediaTab>("background");
  const [animationCatalogTab, setAnimationCatalogTab] = useState<DockAnimationCatalogTab>("videos");
  const [templateVideoSearch, setTemplateVideoSearch] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  // Legacy uploads do not always contain the generated media timestamp in
  // their filename. Keep a timestamp for those files so Newly Uploaded is a
  // real ordering, not an empty-timestamp bucket at the end of the list.
  const uploadedFileTimestampsRef = useRef(new Map<string, string>());
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [sendingFile, setSendingFile] = useState<string | null>(null);
  const [downloadingMediaKey, setDownloadingMediaKey] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!downloadSuccess) return;
    const timer = window.setTimeout(() => setDownloadSuccess(null), 4000);
    return () => window.clearTimeout(timer);
  }, [downloadSuccess]);
  const [mediaPrefs, setMediaPrefs] = useState<DockMediaPreferences>(() => loadMediaPreferences());
  const [mediaFolders, setMediaFolders] = useState<string[]>(() => loadMediaFolders());
  const [activeFolder, setActiveFolder] = useState("all");
  const [localLibrary, setLocalLibrary] = useState<MediaItem[]>(() => loadLocalMediaLibrary());
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [openOptionsKey, setOpenOptionsKey] = useState<string | null>(null);
  const [mediaContextMenu, setMediaContextMenu] = useState<{
    entry: DockMediaEntry;
    x: number;
    y: number;
  } | null>(null);
  const [mediaContextFolderOpen, setMediaContextFolderOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [editingEntryLabelKey, setEditingEntryLabelKey] = useState<string | null>(null);
  const [entryLabelDraft, setEntryLabelDraft] = useState("");
  const [previewEntry, setPreviewEntry] = useState<DockMediaEntry | null>(null);
  const [documentDeck, setDocumentDeck] = useState<DockDocumentDeck | null>(null);
  const [documentPageIndex, setDocumentPageIndex] = useState(0);
  const [documentTransition, setDocumentTransition] = useState<DockDocumentTransition>("cut");
  const [documentDisplay, setDocumentDisplay] = useState<DockDocumentDisplayState>(DEFAULT_DOCUMENT_DISPLAY);
  const [documentDisplayDraft, setDocumentDisplayDraft] = useState<DockDocumentDisplayState>(DEFAULT_DOCUMENT_DISPLAY);
  const [documentControlsOpen, setDocumentControlsOpen] = useState(false);
  const [savingDocumentControls, setSavingDocumentControls] = useState(false);
  const [sendingDocumentPage, setSendingDocumentPage] = useState<string | null>(null);
  const [sceneSendEntry, setSceneSendEntry] = useState<DockMediaEntry | null>(null);
  const [sceneSendChoices, setSceneSendChoices] = useState<string[]>([]);
  const [sceneSendSelection, setSceneSendSelection] = useState("");
  const [sceneSendLoading, setSceneSendLoading] = useState(false);
  const [sceneSendSubmitting, setSceneSendSubmitting] = useState(false);
  const [sceneSendError, setSceneSendError] = useState<string | null>(null);
  const [activeTargets, setActiveTargets] = useState<ActiveMediaTargets>({
    active: null,
  });
  const [activeTargetKeys, setActiveTargetKeys] = useState<DockMediaTargetKeys>(() => mediaSession.activeTargetKeys);
  const [pausedTargets, setPausedTargets] = useState<ActiveMediaPlaybackState>(() => mediaSession.pausedTargets);
  const [textOverlay, setTextOverlay] = useState<DockTextOverlayState>(() => mediaSession.textOverlay);
  const [textOverlayTargets, setTextOverlayTargets] = useState<{ active: boolean }>(() => mediaSession.textOverlayTargets);
  const [applyingTextTarget, setApplyingTextTarget] = useState<boolean | null>(null);
  const [clearingTarget, setClearingTarget] = useState<boolean | null>(null);
  const [animatingPreview, setAnimatingPreview] = useState(false);
  const [textTab, setTextTab] = useState<"content" | "background">("content");
  const [templateVideos, setTemplateVideos] = useState<TemplateVideoAsset[]>([]);
  const [templateVideosLoading, setTemplateVideosLoading] = useState(false);
  const [templateVideosError, setTemplateVideosError] = useState<string | null>(null);
  const [templateVideoProgress, setTemplateVideoProgress] = useState<Record<string, number | null>>({});
  const [templatePictures, setTemplatePictures] = useState<TemplatePictureAsset[]>([]);
  const [templatePicturesLoading, setTemplatePicturesLoading] = useState(false);
  const [templatePicturesError, setTemplatePicturesError] = useState<string | null>(null);
  const [templatePictureProgress, setTemplatePictureProgress] = useState<Record<string, number | null>>({});
  const [savedTemplateImages, setSavedTemplateImages] = useState<DockTemplateImage[]>([]);
  const [savedTemplateImagesLoading, setSavedTemplateImagesLoading] = useState(false);
  const [savedTemplateImagesError, setSavedTemplateImagesError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const templatePicturesLoadAttemptedRef = useRef(false);
  // Set once the video catalog has been asked for, so a failed load (offline, signed out) is not retried forever.
  const templateVideosLoadAttemptedRef = useRef(false);
  const savedTemplateImagesRequestRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const mediaPollBusyRef = useRef(false);
  const libraryLoadRequestRef = useRef(0);
  const uploadListRequestRef = useRef(0);
  const pendingMediaItemsRef = useRef(new Map<string, MediaItem>());
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const inspectorPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const animationEntitlement = useMemo(
    () => checkEntitlementSync("slideshow", dockPlan),
    [dockPlan],
  );
  const animationsLocked = !animationEntitlement.allowed;



  // ── Video Loop / Playlist state ──
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [playlistName, setPlaylistName] = useState("MCE slideshow");
  const [playlistLoop, setPlaylistLoop] = useState(true);
  const [playlistShuffle, setPlaylistShuffle] = useState(false);
  const [playlistMuted, setPlaylistMuted] = useState(true);

  // ── Absolute path to the uploads directory (for native OBS sources) ──
  const [uploadsDir, setUploadsDir] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the animation lock in sync when the desktop app refreshes or upgrades
  // the dock session without requiring a full dock reload.
  useEffect(() => {
    const syncPlan = () => setDockPlan(getDockPlan());
    const unsubscribe = dockClient.onState((msg) => {
      if (msg.type === "state:plan-update") syncPlan();
    });
    const onStorage = () => syncPlan();
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(syncPlan, 60_000);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!animationsLocked) return;
    if (browserTab === "animations") setBrowserTab("uploads");
    if (addMediaTab === "template-videos") setAddMediaTab("background");
  }, [addMediaTab, animationsLocked, browserTab]);

  // Use icon-only tabs when the media console is narrow, but keep the tabs
  // horizontal. The left rail is reserved for short-height docks below.
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setIsNarrowWidth(width <= 300);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compact mode based on dock window height
  useEffect(() => {
    const check = () => {
      const h = window.innerHeight;
      setIsCompactHeight(h <= 600);
      setIsUltraCompactHeight(h <= 400);
      setIsMicroHeight(h <= 360);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    writeNativeDockSetting(MEDIA_PREFS_STORAGE_KEY, mediaPrefs);
  }, [mediaPrefs]);

  useEffect(() => {
    writeNativeDockSetting(MEDIA_FOLDERS_STORAGE_KEY, mediaFolders);
  }, [mediaFolders]);

  useEffect(() => {
    if (activeFolder !== "all" && !mediaFolders.includes(activeFolder)) {
      setActiveFolder("all");
    }
  }, [activeFolder, mediaFolders]);

  useEffect(() => {
    if (!mediaContextMenu) return;

    const closeMenu = () => setMediaContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mediaContextMenu]);

  useEffect(() => {
    const handleMediaSearchTrigger = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => {
        const input = searchInputRef.current || document.querySelector<HTMLInputElement>(".dock-media-search__input");
        if (input) {
          input.focus();
          try {
            input.select();
          } catch {
            // ignore
          }
        }
      });
    };
    window.addEventListener("dock-trigger-media-search", handleMediaSearchTrigger);
    return () => window.removeEventListener("dock-trigger-media-search", handleMediaSearchTrigger);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(getUserScopedKey(MEDIA_LOCAL_LIBRARY_STORAGE_KEY), JSON.stringify(localLibrary));
    } catch {
      // ignore local fallback persistence failures
    }
  }, [localLibrary]);

  const updateMediaPreference = useCallback((entryKey: string, patch: DockMediaPreference) => {
    setMediaPrefs((prev) => ({
      ...prev,
      [entryKey]: {
        ...prev[entryKey],
        ...patch,
      },
    }));
  }, []);

  const openMediaContextMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    entry: DockMediaEntry,
    isLocked: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (isLocked) return;

    // Context menus should open to the left of the pointer when possible so
    // media cards near the right edge of a narrow OBS dock do not cover or
    // spill beyond the dock boundary.
    const menuWidth = Math.min(
      MEDIA_CONTEXT_MENU_WIDTH,
      Math.max(0, window.innerWidth - MEDIA_CONTEXT_MENU_GUTTER * 2),
    );
    const menuHeight = entry.kind === "video" ? 460 : 420;
    const leftPlacement = event.clientX - menuWidth - MEDIA_CONTEXT_MENU_GAP;
    const rightmostX = Math.max(
      MEDIA_CONTEXT_MENU_GUTTER,
      window.innerWidth - menuWidth - MEDIA_CONTEXT_MENU_GUTTER,
    );
    const x = leftPlacement >= MEDIA_CONTEXT_MENU_GUTTER
      ? leftPlacement
      : Math.min(
        Math.max(MEDIA_CONTEXT_MENU_GUTTER, event.clientX + MEDIA_CONTEXT_MENU_GAP),
        rightmostX,
      );
    const y = Math.min(
      Math.max(MEDIA_CONTEXT_MENU_GUTTER, event.clientY),
      Math.max(MEDIA_CONTEXT_MENU_GUTTER, window.innerHeight - menuHeight - MEDIA_CONTEXT_MENU_GUTTER),
    );

    setOpenOptionsKey(null);
    setMediaContextFolderOpen(false);
    setNewFolderDraft("");
    setMediaContextMenu({ entry, x, y });
  }, []);

  const persistLocalLibrary = useCallback((updater: (current: MediaItem[]) => MediaItem[]) => {
    setLocalLibrary((current) => {
      const next = dedupeMediaItems(updater(current));
      import("../dockUploadService").then((m) => m.saveLocalLibrary(next)).catch(() => {});
      return next;
    });
  }, []);

  // Fetch uploads directory path on mount (with retries for startup timing)
  useEffect(() => {
    let cancelled = false;
    async function fetchDir(retries = 5) {
      for (let i = 0; i < retries; i++) {
        try {
          const res = await fetch("/api/uploads-dir", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (data.path && !cancelled) {
              setUploadsDir(data.path);
              return;
            }
          }
        } catch { /* server not ready yet */ }
        // Wait before retrying (1s, 2s, 3s...)
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
      if (!cancelled) console.warn("[DockMediaTab] Could not fetch uploads dir after retries");
    }
    const timer = window.setTimeout(() => {
      void fetchDir();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // ── Library media items (from main app) ──
  const [libraryMedia, setLibraryMedia] = useState<MediaItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const rememberPendingMedia = useCallback((items: MediaItem[]) => {
    for (const item of items) {
      pendingMediaItemsRef.current.set(getMediaStableKey(item), item);
    }
  }, []);

  const applyLibraryMediaSnapshot = useCallback((items: MediaItem[]) => {
    const filteredItems = items.filter((item) => !isInternalDockMediaItem(item));
    const incomingKeys = new Set(filteredItems.map((item) => getMediaStableKey(item)));
    const stillPending: MediaItem[] = [];

    for (const [key, item] of pendingMediaItemsRef.current) {
      if (incomingKeys.has(key)) {
        // The authoritative snapshot has caught up with this upload.
        pendingMediaItemsRef.current.delete(key);
      } else {
        // Keep a just-uploaded item visible if this snapshot was produced
        // before the save finished.
        stillPending.push(item);
      }
    }

    setLibraryMedia(dedupeMediaItems([...filteredItems, ...stillPending]));
  }, []);

  const loadLibraryMedia = useCallback(async () => {
    const requestId = ++libraryLoadRequestRef.current;
    const isCurrentRequest = () => mountedRef.current && requestId === libraryLoadRequestRef.current;
    if (!mountedRef.current) return;

    console.log("[UPLOAD] loadLibraryMedia: start", { requestId });
    setLibraryLoading(true);
    try {
      // Strategy 1: try IndexedDB (async)
      try {
        const { getAllMedia } = await import("../../library/libraryDb");
        const all = await getAllMedia();
        console.log("[UPLOAD] loadLibraryMedia: IndexedDB returned", all.length, "items", { requestId });
        if (!isCurrentRequest()) return;
        if (all.length > 0) {
          applyLibraryMediaSnapshot(all);
          console.log("[UPLOAD] loadLibraryMedia: applied current IndexedDB snapshot", { requestId });
          return;
        }
      } catch (err) {
        console.log("[UPLOAD] loadLibraryMedia: IndexedDB unavailable →", err);
        // IndexedDB not available, fall through to JSON fetch.
      }

      if (!isCurrentRequest()) return;

      // Strategy 2: fetch from overlay server (works when dock runs in OBS CEF)
      try {
        const res = await fetch("/uploads/dock-media-library.json", { cache: "no-store" });
        if (!res.ok) {
          // File doesn't exist yet — create it with an empty array so subsequent requests work
          if (res.status === 404) {
            try {
              await fetch("/api/save-dock-data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "dock-media-library", data: "[]" }),
              });
            } catch { /* best effort */ }
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const all = await res.json();
        console.log("[UPLOAD] loadLibraryMedia: JSON fetch returned", Array.isArray(all) ? all.length : 0, "items", { requestId });
        if (!isCurrentRequest()) return;
        if (Array.isArray(all) && all.length > 0) {
          applyLibraryMediaSnapshot(all as MediaItem[]);
          console.log("[UPLOAD] loadLibraryMedia: applied current JSON snapshot", { requestId });
          return;
        }
      } catch (err) {
        console.log("[UPLOAD] loadLibraryMedia: JSON fetch failed →", err);
        // JSON fetch failed, continue to finally.
      }
      console.log("[UPLOAD] loadLibraryMedia: no data found, keeping current state");
    } finally {
      if (isCurrentRequest()) setLibraryLoading(false);
    }
  }, [applyLibraryMediaSnapshot]);

  const loadTemplateVideos = useCallback(async () => {
    if (animationsLocked) return;
    templateVideosLoadAttemptedRef.current = true;
    setTemplateVideosLoading(true);
    setTemplateVideosError(null);
    try {
      const items = await fetchTemplateVideos();
      if (!mountedRef.current) return;
      setTemplateVideos(items);
    } catch (err) {
      if (!mountedRef.current) return;
      setTemplateVideosError(err instanceof Error ? err.message : t('media.unableToLoadTemplates'));
      setTemplateVideos([]);
    } finally {
      if (mountedRef.current) {
        setTemplateVideosLoading(false);
      }
    }
  }, [animationsLocked, t]);

  // Load the catalog early because downloaded template files share the
  // uploads directory. The Newly Uploaded filter needs the catalog filenames
  // even when the user opens Uploads directly instead of Animations first.
  useEffect(() => {
    if (!animationsLocked) void loadTemplateVideos();
  }, [animationsLocked, loadTemplateVideos]);

  const loadTemplatePictures = useCallback(async () => {
    if (animationsLocked) return;
    setTemplatePicturesLoading(true);
    setTemplatePicturesError(null);
    try {
      const items = await fetchTemplatePictures();
      if (!mountedRef.current) return;
      setTemplatePictures(items);
    } catch (err) {
      if (!mountedRef.current) return;
      setTemplatePicturesError(err instanceof Error ? err.message : t('media.unableToLoadTemplates'));
      setTemplatePictures([]);
    } finally {
      if (mountedRef.current) {
        setTemplatePicturesLoading(false);
      }
    }
  }, [animationsLocked, t]);

  const loadSavedTemplateImages = useCallback(async () => {
    const requestId = ++savedTemplateImagesRequestRef.current;
    setSavedTemplateImagesLoading(true);
    setSavedTemplateImagesError(null);
    try {
      const snapshot = await loadSavedTemplateImagesFromDockData();
      if (!mountedRef.current || requestId !== savedTemplateImagesRequestRef.current) return;
      setSavedTemplateImages(snapshot?.templates ?? []);
    } catch {
      if (!mountedRef.current || requestId !== savedTemplateImagesRequestRef.current) return;
      setSavedTemplateImages([]);
      setSavedTemplateImagesError("Could not load saved templates.");
    } finally {
      if (mountedRef.current && requestId === savedTemplateImagesRequestRef.current) {
        setSavedTemplateImagesLoading(false);
      }
    }
  }, []);

  const openAnimationsTab = useCallback(() => {
    if (animationsLocked) return;
    setBrowserTab("animations");
    // Refresh when the tab is opened so a newly added template is immediately
    // available and is placed at the top by the catalog sort.
    void loadTemplateVideos();
    void loadTemplatePictures();
  }, [animationsLocked, loadTemplatePictures, loadTemplateVideos]);

  const openAddMediaModal = useCallback(async (tab: DockAddMediaTab = "background") => {
    if (tab === "template-videos" && !(await requireEntitlement("slideshow", 0))) return;
    setAddMediaTab(tab);
    setTemplateVideoOnlyModal(tab === "template-videos");
    setTemplateVideoSearch("");
    setShowAddMediaModal(true);
  }, []);

  const closeAddMediaModal = useCallback(() => {
    setShowAddMediaModal(false);
    setTemplateVideoOnlyModal(false);
  }, []);

  // Load library media on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibraryMedia();
      dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLibraryMedia]);

  // Listen for library-updated signal to refresh media
  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type === "state:media-data" && Array.isArray(msg.payload)) {
        // A bridge snapshot is the authoritative result of the app's latest
        // library read. Do not let an older IndexedDB/HTTP read finish after
        // it and replace the snapshot with stale ordering or data.
        libraryLoadRequestRef.current += 1;
        applyLibraryMediaSnapshot(msg.payload as MediaItem[]);
        setLibraryLoading(false);
        return;
      }
      if (msg.type === "state:library-updated") {
        loadLibraryMedia();
      }
    });
    return unsub;
  }, [applyLibraryMediaSnapshot, loadLibraryMedia]);

  // Fallback polling: refresh media every 30s in case event-based sync fails
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDockTabVisible(containerRef.current)) return;
      if (mediaPollBusyRef.current) return;
      mediaPollBusyRef.current = true;
      void loadLibraryMedia().finally(() => { mediaPollBusyRef.current = false; });
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadLibraryMedia]);

  // ── Fetch uploaded files from overlay server ──

  const fetchUploads = useCallback(async () => {
    const requestId = ++uploadListRequestRef.current;
    const isCurrentRequest = () => mountedRef.current && requestId === uploadListRequestRef.current;
    if (!mountedRef.current) return;

    setUploadsLoading(true);
    try {
      const resp = await fetch("/api/uploads", { cache: "no-store" });
      if (resp.ok) {
        const files: string[] = await resp.json();
        if (isCurrentRequest()) {
          const mediaFiles = files.filter((file) => (
            isMediaFile(file)
            && !isInternalUploadFile(file)
            && !isTemplateCatalogUploadFile(file)
          ));
          const mediaFileSet = new Set(mediaFiles);
          for (const file of uploadedFileTimestampsRef.current.keys()) {
            if (!mediaFileSet.has(file)) uploadedFileTimestampsRef.current.delete(file);
          }
          mediaFiles.forEach((file) => {
            const parsedTimestamp = extractUploadTimestamp(file);
            if (parsedTimestamp) {
              uploadedFileTimestampsRef.current.set(file, parsedTimestamp);
            } else if (!uploadedFileTimestampsRef.current.has(file)) {
              // Un-timestamped files should not receive Date.now() which would push
              // them ahead of genuine user uploads. Use a low fallback timestamp.
              uploadedFileTimestampsRef.current.set(
                file,
                "1970-01-01T00:00:00.000Z",
              );
            }
          });
          setUploadedFiles(mediaFiles);
        }
      }
    } catch {
      // Silently fail — uploads listing is optional
    } finally {
      if (isCurrentRequest()) setUploadsLoading(false);
    }
  }, []);

  // Fetch uploads on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUploads();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchUploads]);

  // Validate file existence on load — remove entries whose files are missing from disk
  const uploadsValidatedRef = useRef(false);
  useEffect(() => {
    if (!uploadsDir || uploadedFiles.length === 0 || uploadsValidatedRef.current) return;
    uploadsValidatedRef.current = true;
    const sep = uploadsDir.includes("\\") ? "\\" : "/";
    const checkAndClean = async () => {
      const results = await Promise.all(
        uploadedFiles.map(async (file) => {
          try {
            const filePath = `${uploadsDir}${sep}${file}`;
            const resp = await fetch(`/api/file-exists?path=${encodeURIComponent(filePath)}`);
            if (!resp.ok) return { file, exists: true };
            const data = await resp.json();
            return { file, exists: !!data.exists };
          } catch {
            return { file, exists: true };
          }
        }),
      );
      const missing = results.filter((r) => !r.exists);
      if (missing.length > 0) {
        console.warn("[DockMediaTab] Removing upload entries with missing files:", missing.map((r) => r.file));
        setUploadedFiles((prev) => prev.filter((f) => !missing.some((m) => m.file === f)));
      }
    };
    void checkAndClean();
  }, [uploadsDir, uploadedFiles]);

  // Validate local library file paths on load
  const libraryValidatedRef = useRef(false);
  useEffect(() => {
    if (localLibrary.length === 0 || libraryValidatedRef.current) return;
    libraryValidatedRef.current = true;
    const checkAndClean = async () => {
      const results = await Promise.all(
        localLibrary.map(async (item) => {
          if (!item.filePath) return { id: item.id, exists: true };
          try {
            const resp = await fetch(`/api/file-exists?path=${encodeURIComponent(item.filePath)}`);
            if (!resp.ok) return { id: item.id, exists: true };
            const data = await resp.json();
            return { id: item.id, exists: !!data.exists };
          } catch {
            return { id: item.id, exists: true };
          }
        }),
      );
      const missingIds = new Set(results.filter((r) => !r.exists).map((r) => r.id));
      if (missingIds.size > 0) {
        console.warn("[DockMediaTab] Removing library items with missing files:", [...missingIds]);
        setLocalLibrary((prev) => prev.filter((item) => !missingIds.has(item.id)));
      }
    };
    void checkAndClean();
  }, [localLibrary]);

  useEffect(() => {
    if (animationsLocked || templateVideosLoadAttemptedRef.current || templateVideos.length > 0 || templateVideosLoading) {
      return;
    }
    void loadTemplateVideos();
  }, [animationsLocked, loadTemplateVideos, templateVideos.length, templateVideosLoading]);

  useEffect(() => {
    if (animationsLocked || templatePicturesLoadAttemptedRef.current || templatePictures.length > 0 || templatePicturesLoading) {
      return;
    }
    templatePicturesLoadAttemptedRef.current = true;
    void loadTemplatePictures();
  }, [animationsLocked, loadTemplatePictures, templatePictures.length, templatePicturesLoading]);

  useEffect(() => {
    if (browserTab !== "templates") return;

    const refresh = () => { void loadSavedTemplateImages(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener(EDITABLE_TEMPLATE_STORAGE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(EDITABLE_TEMPLATE_BROADCAST_CHANNEL);
      channel.addEventListener("message", refresh);
    } catch {
      // Focus refresh remains available in embedded Dock windows.
    }

    return () => {
      window.removeEventListener(EDITABLE_TEMPLATE_STORAGE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      channel?.removeEventListener("message", refresh);
      channel?.close();
    };
  }, [browserTab, loadSavedTemplateImages]);

let _cachedGlobalUploadsDir: string | null = null;

  // ── Play uploaded media via OBS — send to Preview or Send to OBS ──

  const resolveUploadFilePath = useCallback(async (fileName: string): Promise<string> => {
    let dir = uploadsDir || _cachedGlobalUploadsDir;
    if (!dir) {
      const res = await fetch("/api/uploads-dir");
      if (res.ok) {
        const data = await res.json();
        dir = data.path || null;
        if (dir) {
          _cachedGlobalUploadsDir = dir;
          setUploadsDir(dir);
        }
      }
    }
    if (!dir) {
      throw new Error("Could not resolve uploads directory");
    }

    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir}${sep}${fileName}`;
  }, [uploadsDir]);

  const resolveLibraryMediaFilePath = useCallback(async (item: MediaItem): Promise<string> => {
    if (item.filePath) {
      return item.filePath;
    }

    let dir = uploadsDir || _cachedGlobalUploadsDir;
    if (!dir) {
      try {
        const res = await fetch("/api/uploads-dir");
        if (res.ok) {
          const data = await res.json();
          dir = data.path || null;
          if (dir) {
            _cachedGlobalUploadsDir = dir;
            setUploadsDir(dir);
          }
        }
      } catch { /* ignore */ }
    }

    if (item.url.startsWith("data:")) {
      const res = await fetch("/api/save-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: item.name, dataUrl: item.url }),
      });
      if (!res.ok) throw new Error(`save-media failed: ${res.status}`);
      const data = await res.json();
      if (!data.path) throw new Error("No path returned from save-media");
      return data.path;
    }

    if (dir && !item.url.startsWith("http") && !item.url.startsWith("blob:") && !item.url.startsWith("data:")) {
      return item.url;
    }

    if (dir) {
      const fileName = item.diskFileName || item.url.split("/").pop() || item.name;
      const sep = dir.includes("\\") ? "\\" : "/";
      return `${dir}${sep}${decodeURIComponent(fileName)}`;
    }

    throw new Error("Cannot resolve media to a local file path");
  }, [uploadsDir]);

  const downloadMediaEntry = useCallback(async (entry: DockMediaEntry) => {
    const mediaFileName = entry.uploadFile || entry.libraryItem?.diskFileName;
    const sourceUrl = mediaFileName
      ? `${overlayBaseUrl}/uploads/${encodeURIComponent(mediaFileName)}`
      : entry.previewUrl || entry.libraryItem?.url || "";
    const fileName = getMediaDownloadFileName(entry, mediaPrefs[entry.prefKey]?.label);

    setMediaContextMenu(null);
    setDownloadingMediaKey(entry.key);
    setSendError(null);
    setDownloadSuccess(null);

    try {
      if (!sourceUrl && !mediaFileName) throw new Error("No media source is available.");

      // 1. If running in native Tauri runtime: prompt native Save As dialog
      if (isTauriRuntime()) {
        try {
          const [{ save }, { writeFile, copyFile }] = await Promise.all([
            import("@tauri-apps/plugin-dialog"),
            import("@tauri-apps/plugin-fs"),
          ]);
          const ext = fileName.includes(".") ? (fileName.split(".").pop() || "") : "";
          const filePath = await save({
            defaultPath: fileName,
            filters: ext ? [{ name: `${entry.kind.toUpperCase()} files`, extensions: [ext] }] : undefined,
          });

          if (!filePath) {
            // User cancelled the file dialog
            return;
          }

          let savedDirectly = false;
          if (uploadsDir && mediaFileName) {
            try {
              const sep = uploadsDir.includes("\\") ? "\\" : "/";
              const sourcePath = `${uploadsDir}${sep}${decodeURIComponent(mediaFileName)}`;
              await copyFile(sourcePath, filePath);
              savedDirectly = true;
            } catch (copyErr) {
              console.warn("[DockMediaTab] Direct copyFile failed, will write buffer:", copyErr);
            }
          }

          if (!savedDirectly) {
            let buffer: ArrayBuffer;
            if (sourceUrl.startsWith("data:")) {
              const res = await fetch(sourceUrl);
              buffer = await res.arrayBuffer();
            } else {
              const res = await fetch(sourceUrl, { cache: "no-store" });
              if (!res.ok) throw new Error(`Media fetch failed (${res.status}).`);
              buffer = await res.arrayBuffer();
            }
            await writeFile(filePath, new Uint8Array(buffer));
          }

          const savedFileName = filePath.split(/[\\/]/).pop() || fileName;
          setDownloadSuccess(t('media.savedToFile', { defaultValue: 'Saved {{fileName}}', fileName: savedFileName }));
          return;
        } catch (tauriError) {
          console.warn("[DockMediaTab] Tauri save dialog failed, attempting server fallback:", tauriError);
        }
      }

      // 2. In OBS CEF dock / browser environment: Try the local server endpoint
      try {
        const saveApiUrl = `${overlayBaseUrl}/api/save-to-downloads`;
        let res: Response | null = null;

        if (mediaFileName) {
          res = await fetch(saveApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName, uploadFile: mediaFileName }),
          });
        } else if (sourceUrl.startsWith("data:")) {
          res = await fetch(saveApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName, dataUrl: sourceUrl }),
          });
        } else if (sourceUrl) {
          const fetchRes = await fetch(sourceUrl, { cache: "no-store" });
          if (fetchRes.ok) {
            const blob = await fetchRes.blob();
            res = await fetch(`${saveApiUrl}?filename=${encodeURIComponent(fileName)}`, {
              method: "POST",
              headers: { "Content-Type": blob.type || "application/octet-stream" },
              body: blob,
            });
          }
        }

        if (res && res.ok) {
          const data = await res.json() as { ok?: boolean; fileName?: string; path?: string };
          if (data.ok) {
            const savedName = data.fileName || fileName;
            setDownloadSuccess(t('media.savedToDownloads', { defaultValue: 'Saved to Downloads: {{fileName}}', fileName: savedName }));
            return;
          }
        }
      } catch (apiError) {
        console.warn("[DockMediaTab] Local server save-to-downloads unavailable, trying browser fallback:", apiError);
      }

      // 3. Browser fallback (for regular web browsers outside OBS)
      let blob: Blob;
      if (sourceUrl.startsWith("data:")) {
        const res = await fetch(sourceUrl);
        blob = await res.blob();
      } else {
        const res = await fetch(sourceUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`Media download failed (${res.status}).`);
        blob = await res.blob();
      }

      if (blob.size === 0) throw new Error("The media file was empty.");

      // Check for window.showSaveFilePicker
      type WindowWithPicker = Window & {
        showSaveFilePicker?: (opts: { suggestedName?: string }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      };
      const picker = (window as WindowWithPicker).showSaveFilePicker;
      if (typeof picker === "function") {
        try {
          const handle = await picker({ suggestedName: fileName });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setDownloadSuccess(t('media.savedToFile', { defaultValue: 'Saved {{fileName}}', fileName }));
          return;
        } catch (pickerErr) {
          if (pickerErr instanceof DOMException && pickerErr.name === "AbortError") {
            return; // User cancelled
          }
          console.warn("[DockMediaTab] showSaveFilePicker failed, trying file-saver:", pickerErr);
        }
      }

      // Final browser fallback: file-saver saveAs or anchor click
      try {
        const { saveAs } = await import("file-saver");
        saveAs(blob, fileName);
        setDownloadSuccess(t('media.savedToFile', { defaultValue: 'Saved {{fileName}}', fileName }));
      } catch {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
        setDownloadSuccess(t('media.savedToFile', { defaultValue: 'Saved {{fileName}}', fileName }));
      }
    } catch (error) {
      console.warn("[DockMediaTab] Media download failed:", error);
      setSendError(t('media.downloadFailed', { defaultValue: 'Could not download this media.' }));
    } finally {
      setDownloadingMediaKey(null);
    }
  }, [mediaPrefs, overlayBaseUrl, t, uploadsDir]);

  const playMedia = useCallback(
    async (fileName: string, options?: DockMediaSendOptions): Promise<boolean> => {
      if (presentationLinkMode) {
        const kind = getUploadMediaKind(fileName);
        if (!kind || kind === "audio") {
          setSendError(kind === "audio" ? "Audio playback requires a direct OBS connection." : t('media.failedToSendMedia'));
          return false;
        }
        setSendingFile(`upload:${fileName}`);
        try {
          await publishMediaToPresentation({
            id: `upload-${fileName}`,
            name: fileName,
            type: kind,
            url: `/uploads/${encodeURIComponent(fileName)}`,
            diskFileName: fileName,
            createdAt: new Date().toISOString(),
          }, {
            fit: options?.fitMode ?? "cover",
          });
          setSendError(null);
          track("media_presented");
          trackMediaPresented("uploaded");
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : t('media.failedToSendMedia');
          console.warn("[DockMediaTab] Publish media to presentation link failed:", msg);
          setSendError(msg);
          return false;
        } finally {
          setSendingFile(null);
        }
      }

      const uploadKind = getUploadMediaKind(fileName);
      const targetSource = uploadKind === "audio"
        ? DOCK_MEDIA_AUDIO_SOURCE
        : uploadKind === "image"
          ? DOCK_MEDIA_IMAGE_SOURCE
          : DOCK_MEDIA_VIDEO_SOURCE;

      // Focus the specific Media source immediately on the card action. The native
      // media push can take a moment to resolve a local file, so waiting for
      // the push would leave the previously selected MCE source visible.
      void dockObsClient.focusMcePresentationModule("media", targetSource).catch((err) => {
        console.warn("[DockMediaTab] Failed to focus Media presentation source:", err);
      });

      try {
        await ensureObsConnected();
      } catch {
        console.warn("[DockMediaTab] Not connected to OBS");
        return false;
      }

      setSendingFile(`upload:${fileName}`);
      try {
        const filePath = await resolveUploadFilePath(fileName);
        try {
          await dockObsClient.pushMedia(filePath, fileName, options);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/scene item|create.*input|create.*scene|failed to create/i.test(message)) {
            throw err;
          }
          await ensureObsConnected();
          await dockObsClient.pushMedia(filePath, fileName, options);
        }
        setSendError(null);
        track("media_presented");
        trackMediaPresented("uploaded");
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('media.failedToSendMedia');
        console.warn("[DockMediaTab] Play media failed:", msg);
        setSendError(msg);
        return false;
      } finally {
        setSendingFile(null);
      }
    },
    [presentationLinkMode, resolveUploadFilePath, t]
  );

  // ── Play library media item via OBS ──

  const playLibraryMedia = useCallback(
    async (item: MediaItem, options?: DockMediaSendOptions): Promise<boolean> => {
      if (presentationLinkMode) {
        if (item.type === "audio") {
          setSendError("Audio playback requires a direct OBS connection.");
          return false;
        }
        setSendingFile(`library:${item.id}`);
        try {
          await publishMediaToPresentation(item, {
            fit: options?.fitMode ?? "cover",
          });
          setSendError(null);
          track("media_presented");
          trackMediaPresented("library");
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : t('media.failedToSendMedia');
          console.warn("[DockMediaTab] Publish library media to presentation link failed:", msg);
          setSendError(msg);
          return false;
        } finally {
          setSendingFile(null);
        }
      }

      const targetSource = item.type === "audio"
        ? DOCK_MEDIA_AUDIO_SOURCE
        : item.type === "image"
          ? DOCK_MEDIA_IMAGE_SOURCE
          : DOCK_MEDIA_VIDEO_SOURCE;

      void dockObsClient.focusMcePresentationModule("media", targetSource).catch((err) => {
        console.warn("[DockMediaTab] Failed to focus Media presentation source:", err);
      });

      try {
        await ensureObsConnected();
      } catch {
        return false;
      }

      setSendingFile(`library:${item.id}`);
      try {
        const filePath = await resolveLibraryMediaFilePath(item);
        try {
          await dockObsClient.pushMedia(filePath, item.name, options);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/scene item|create.*input|create.*scene|failed to create/i.test(message)) {
            throw err;
          }
          await ensureObsConnected();
          await dockObsClient.pushMedia(filePath, item.name, options);
        }
        setSendError(null);
        track("media_presented");
        trackMediaPresented("library");
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('media.failedToSendMedia');
        console.warn("[DockMediaTab] Play library media failed:", msg);
        setSendError(msg);
        return false;
      } finally {
        setSendingFile(null);
      }
    },
    [presentationLinkMode, resolveLibraryMediaFilePath, t]
  );

  const loadSceneSendChoices = useCallback(async () => {
    if (presentationLinkMode) {
      setSceneSendChoices([]);
      setSceneSendSelection("");
      setSceneSendError(null);
      setSceneSendLoading(false);
      return;
    }

    setSceneSendChoices([]);
    setSceneSendSelection("");
    setSceneSendError(null);
    setSceneSendLoading(true);

    try {
      await ensureObsConnected();
      const [sceneListResp, currentSceneResp] = await Promise.all([
        dockObsClient.call("GetSceneList") as Promise<{ scenes?: Array<{ sceneName?: string | null }> }>,
        dockObsClient.call("GetCurrentProgramScene") as Promise<{ currentProgramSceneName?: string; sceneName?: string }>,
      ]);

      const currentSceneName = String(
        currentSceneResp.currentProgramSceneName || currentSceneResp.sceneName || "",
      ).trim();

      const choices = (sceneListResp.scenes ?? [])
        .map((scene) => String(scene.sceneName ?? "").trim())
        .filter(isUserSelectableObsScene)
        .sort((a, b) => {
          if (a === currentSceneName) return -1;
          if (b === currentSceneName) return 1;
          return a.localeCompare(b);
        });

      setSceneSendChoices(choices);
      setSceneSendSelection(choices.includes(currentSceneName) ? currentSceneName : (choices[0] ?? ""));
      if (choices.length === 0) {
        setSceneSendError(t('media.noObsScenesAvailable'));
      }
    } catch (err) {
      setSceneSendError(err instanceof Error ? err.message : t('media.unableToLoadScenes'));
    } finally {
      setSceneSendLoading(false);
    }
  }, [presentationLinkMode, t]);

  const openSceneSendDialog = useCallback(async (entry: DockMediaEntry) => {
    if (presentationLinkMode) return;
    setOpenOptionsKey(null);
    setSceneSendEntry(entry);
    await loadSceneSendChoices();
  }, [loadSceneSendChoices, presentationLinkMode]);

  const resetSceneSendDialog = useCallback(() => {
    setSceneSendEntry(null);
    setSceneSendChoices([]);
    setSceneSendSelection("");
    setSceneSendError(null);
    setSceneSendLoading(false);
  }, []);

  const closeSceneSendDialog = useCallback(() => {
    if (sceneSendSubmitting) return;
    resetSceneSendDialog();
  }, [resetSceneSendDialog, sceneSendSubmitting]);

  const getEntryPrefs = useCallback(
    (entry: DockMediaEntry): DockMediaPreference => mediaPrefs[entry.prefKey] ?? {},
    [mediaPrefs],
  );

  const getEntrySendOptions = useCallback(
    (entry: DockMediaEntry): DockMediaSendOptions => {
      const prefs = getEntryPrefs(entry);
      if (entry.kind === "video") {
        return {
          muted: prefs.videoMuted ?? true,
          looping: prefs.loop ?? true,
          restartOnActivate: prefs.restartOnActivate ?? true,
          closeWhenInactive: prefs.closeWhenInactive ?? false,
          clearOnMediaEnd: prefs.clearOnMediaEnd ?? false,
          playbackSpeed: prefs.playbackSpeed ?? 100,
          fitMode: prefs.fitMode ?? "cover",
        };
      }
      if (entry.kind === "audio") {
        return {
          muted: false,
          looping: prefs.loop ?? false,
        };
      }
      return {
        imageAudioInputName: prefs.imageAudioInputName || null,
        fitMode: prefs.fitMode ?? "cover",
      };
    },
    [getEntryPrefs],
  );

  const sendEntryToSelectedScene = useCallback(async (entry: DockMediaEntry): Promise<boolean> => {
    if (presentationLinkMode) return false;
    if (!sceneSendSelection) return false;

    setSceneSendSubmitting(true);
    setSceneSendError(null);
    try {
      let filePath = "";
      if (entry.uploadFile) {
        filePath = await resolveUploadFilePath(entry.uploadFile);
      } else if (entry.libraryItem) {
        filePath = await resolveLibraryMediaFilePath(entry.libraryItem);
      } else {
        throw new Error(t('media.thisMediaCannotBeSentToScene'));
      }

      const entryPrefs = mediaPrefs[entry.prefKey] ?? {};
      await ensureObsConnected();
      if (entry.kind === "video") {
        await dockObsClient.addVideoSourceToScene({
          sceneName: sceneSendSelection,
          sourceName: buildSceneMediaSourceName(entry, sceneSendSelection),
          filePath,
          fitMode: entryPrefs.fitMode ?? "cover",
          muted: entryPrefs.videoMuted ?? true,
          looping: entryPrefs.loop ?? true,
          restartOnActivate: entryPrefs.restartOnActivate ?? true,
          closeWhenInactive: entryPrefs.closeWhenInactive ?? false,
          clearOnMediaEnd: entryPrefs.clearOnMediaEnd ?? false,
          playbackSpeed: entryPrefs.playbackSpeed ?? 100,
        });
      } else if (entry.kind === "image") {
        await dockObsClient.addImageSourceToScene({
          sceneName: sceneSendSelection,
          sourceName: buildSceneMediaSourceName(entry, sceneSendSelection),
          filePath,
          fitMode: entryPrefs.fitMode ?? "cover",
        });
      } else {
        await dockObsClient.addAudioSourceToScene({
          sceneName: sceneSendSelection,
          sourceName: buildSceneMediaSourceName(entry, sceneSendSelection),
          filePath,
          looping: entryPrefs.loop ?? false,
          muted: false,
        });
      }

      updateMediaPreference(entry.prefKey, { lastUsedAt: new Date().toISOString() });
      return true;
    } catch (err) {
      setSceneSendError(err instanceof Error ? err.message : t('media.failedToSendToScene'));
      return false;
    } finally {
      setSceneSendSubmitting(false);
    }
  }, [
    mediaPrefs,
    presentationLinkMode,
    resolveLibraryMediaFilePath,
    resolveUploadFilePath,
    sceneSendSelection,
    t,
    updateMediaPreference,
  ]);

  const handleSendMediaToSelectedScene = useCallback(async () => {
    if (!sceneSendEntry) return;
    const success = await sendEntryToSelectedScene(sceneSendEntry);
    if (success) {
      resetSceneSendDialog();
    }
  }, [resetSceneSendDialog, sceneSendEntry, sendEntryToSelectedScene]);

  const refreshMedia = useCallback(async () => {
    await Promise.all([fetchUploads(), loadLibraryMedia()]);
  }, [fetchUploads, loadLibraryMedia]);

  const mergedLibraryItems = useMemo(
    () => dedupeMediaItems([...libraryMedia, ...localLibrary].filter((item) => !isInternalDockMediaItem(item))),
    [libraryMedia, localLibrary],
  );

  const representedUploadNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of mergedLibraryItems) {
      if (item.diskFileName) names.add(item.diskFileName);
      if (item.name) names.add(item.name);
    }
    return names;
  }, [mergedLibraryItems]);

  const uploadedEntries = useMemo(
    () => uploadedFiles.reduce<DockMediaEntry[]>((entries, file) => {
      const kind = getUploadMediaKind(file);
      if (!kind) return entries;
      const normalizedFile = normalizeUploadFileName(file);
      const isDownloadedTemplate = isTemplateCatalogUploadFile(file)
        || isInternalUploadFile(file)
        || templateVideos.some((asset) => (
          normalizeUploadFileName(asset.fileName) === normalizedFile || normalizeUploadFileName(asset.cloudflareKey) === normalizedFile
        ))
        || templatePictures.some((asset) => (
          normalizeUploadFileName(asset.fileName) === normalizedFile || normalizeUploadFileName(asset.cloudflareKey) === normalizedFile
        ));
      if (isDownloadedTemplate || representedUploadNames.has(file)) return entries;
      const prefKey = `media:${file}`;
      if (mediaPrefs[prefKey]?.hidden) return entries;
      const uploadedAt = extractUploadTimestamp(file) || uploadedFileTimestampsRef.current.get(file) || "";
      entries.push({
        key: prefKey,
        prefKey,
        name: getUploadDisplayName(file),
        kind,
        createdAt: uploadedAt,
        uploadedAt,
        originLabel: t('media.uploads'),
        mimeLabel: file.split(".").pop()?.toUpperCase(),
        uploadFile: file,
        previewUrl: `${overlayBaseUrl}/uploads/${encodeURIComponent(file)}`,
        playingKey: `upload:${file}`,
      });
      return entries;
    }, []),
    [mediaPrefs, overlayBaseUrl, representedUploadNames, t, templatePictures, templateVideos, uploadedFiles],
  );

  const libraryEntries = useMemo(
    () => mergedLibraryItems
      .filter((item) => {
        if (item.type !== "video" && item.type !== "image" && item.type !== "audio") return false;
        if (isAnimationMediaItem(item, templateVideos, templatePictures)) return false;
        if (isTemplateCatalogUploadFile(item.name)) return false;
        if (isTemplateCatalogUploadFile(item.diskFileName || item.filePath || "")) return false;
        return true;
      })
      .map((item) => createLibraryEntry(
        item,
        overlayBaseUrl,
        libraryMedia.some((candidate) => candidate.id === item.id) ? t('media.library') : t('media.dock'),
      ))
      .filter((entry) => !mediaPrefs[entry.prefKey]?.hidden),
    [libraryMedia, mediaPrefs, mergedLibraryItems, overlayBaseUrl, t, templatePictures, templateVideos],
  );

  const animationEntries = useMemo(
    () => mergedLibraryItems
      .filter((item) => isAnimationMediaItem(item, templateVideos, templatePictures))
      .map((item) => createLibraryEntry(item, overlayBaseUrl, t('media.animation')))
      .filter((entry) => !mediaPrefs[entry.prefKey]?.hidden)
      .sort((a, b) => {
        const aPinned = Boolean(mediaPrefs[a.prefKey]?.pinned);
        const bPinned = Boolean(mediaPrefs[b.prefKey]?.pinned);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return compareMediaItemsNewest(
          getDockMediaOrderMetadata(a),
          getDockMediaOrderMetadata(b),
        );
      }),
    [mediaPrefs, mergedLibraryItems, overlayBaseUrl, t, templatePictures, templateVideos],
  );

  const mediaEntries = useMemo(
    () => [...libraryEntries, ...uploadedEntries].sort((a, b) => {
      const aPinned = Boolean(mediaPrefs[a.prefKey]?.pinned);
      const bPinned = Boolean(mediaPrefs[b.prefKey]?.pinned);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aOrder = getDockMediaOrderMetadata(a);
      const bOrder = getDockMediaOrderMetadata(b);

      if (viewMode === "recent") {
        // Recently Used: sort by lastUsedAt DESC, items without usage go to bottom
        const aUsed = mediaPrefs[a.prefKey]?.lastUsedAt || "";
        const bUsed = mediaPrefs[b.prefKey]?.lastUsedAt || "";
        if (aUsed && !bUsed) return -1;
        if (!aUsed && bUsed) return 1;
        if (aUsed && bUsed) return bUsed.localeCompare(aUsed);
        // Both unused — fall back to the same stable upload ordering.
        return compareMediaItemsNewest(aOrder, bOrder);
      }
      // Newly Uploaded (default): use the explicit upload marker, then the
      // generated disk-name timestamp, then the legacy createdAt value.
      const aCreatedAt = getMediaSortTimestamp(aOrder);
      const bCreatedAt = getMediaSortTimestamp(bOrder);
      if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
      const aUsed = mediaPrefs[a.prefKey]?.lastUsedAt || "";
      const bUsed = mediaPrefs[b.prefKey]?.lastUsedAt || "";
      const usedComparison = bUsed.localeCompare(aUsed);
      return usedComparison || compareMediaItemsNewest(aOrder, bOrder);
    }),
    [libraryEntries, mediaPrefs, uploadedEntries, viewMode],
  );

  const documentEntries = useMemo(
    () => mediaEntries.filter((entry) => entry.libraryItem?.source === "document-conversion"),
    [mediaEntries],
  );
  const documentDecks = useMemo<DockDocumentDeck[]>(() => {
    const groups = new Map<string, {
      documentId: string;
      name: string;
      mimeLabel: string;
      pages: DockMediaEntry[];
      pageCount: number;
      createdAt: string;
    }>();

    for (const entry of documentEntries) {
      const item = entry.libraryItem;
      const pageCount = Math.max(1, Number(item?.documentPageCount) || 1);
      const sourceName = (item?.documentSourceName || entry.name)
        .replace(/\s+·\s+Page\s+\d+(?:\/\d+)?$/i, "")
        .trim();
      // Older imports have no documentId. Keep those usable with a stable
      // legacy key while new imports remain separate even with the same name.
      const documentId = item?.documentId?.trim()
        || `legacy:${sourceName.toLowerCase()}:${pageCount}`;
      const existing = groups.get(documentId);
      if (existing) {
        existing.pages.push(entry);
        existing.pageCount = Math.max(existing.pageCount, pageCount);
        const entryCreatedAt = getDocumentImportDate(entry.createdAt);
        if (entryCreatedAt && (!existing.createdAt || entryCreatedAt < existing.createdAt)) {
          existing.createdAt = entryCreatedAt;
        }
        continue;
      }

      groups.set(documentId, {
        documentId,
        name: sourceName || "Document",
        mimeLabel: sourceName.split(".").pop()?.toUpperCase() || "DOC",
        pages: [entry],
        pageCount,
        createdAt: getDocumentImportDate(entry.createdAt),
      });
    }

    // documentEntries already has the ordering selected by the Newly Uploaded
    // control. Map insertion order preserves the first page encountered for
    // each document deck, so grouping cannot introduce a second, conflicting
    // sort order.
    return Array.from(groups.values()).map((group) => {
      const pages = [...group.pages].sort((a, b) => (
        (a.libraryItem?.documentPageNumber ?? 0) - (b.libraryItem?.documentPageNumber ?? 0)
      ));
      return {
        key: `document:${group.documentId}`,
        documentId: group.documentId,
        name: group.name,
        mimeLabel: group.mimeLabel,
        pages,
        pageCount: Math.max(group.pageCount, pages.length),
        createdAt: group.createdAt,
        coverPage: pages.find((page) => page.libraryItem?.documentPageNumber === 1) || pages[0],
      };
    });
  }, [documentEntries]);

  const nonDocumentMediaEntries = useMemo(
    () => mediaEntries.filter((entry) => entry.libraryItem?.source !== "document-conversion"),
    [mediaEntries],
  );
  const videoEntries = useMemo(() => mediaEntries.filter((entry) => entry.kind === "video"), [mediaEntries]);
  const imageEntries = useMemo(
    () => mediaEntries.filter((entry) => entry.kind === "image" && entry.libraryItem?.source !== "document-conversion"),
    [mediaEntries],
  );
  const audioEntries = useMemo(() => mediaEntries.filter((entry) => entry.kind === "audio"), [mediaEntries]);
  const savedTemplateEntries = useMemo(
    () => [...savedTemplateImages]
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(createSavedTemplateEntry),
    [savedTemplateImages],
  );
  const patternEntries = useMemo(() => BACKGROUND_PATTERNS.map((p) => createPatternEntry(p, t('media.pattern'))), []);
  // ── Plan-locked items: items beyond the plan limit get a blur + padlock ──
  const lockedKeys = useMemo(() => {
    const locked = new Set<string>();
    const plan = dockPlan;

    // Try server-provided entitlements first, then FALLBACK_LIMITS
    let serverEntitlements: Record<string, number | boolean> | null = null;
    try {
      const raw = localStorage.getItem(getUserScopedKey("ocs-dock-entitlements"));
      if (raw) serverEntitlements = JSON.parse(raw);
    } catch { /* */ }

    const getLimit = (feature: string): number => {
      if (serverEntitlements && serverEntitlements[feature] !== undefined) {
        const v = serverEntitlements[feature];
        if (typeof v === "boolean") return v ? -1 : 0;
        if (typeof v === "number") return v;
      }
      return getFeatureLimit(feature as any, plan);
    };

    const imageLimit = getLimit("images");
    const videoLimit = getLimit("videos");

    // Lock excess images in the same order shown by the gallery; the first N
    // items are available and the remainder stay visible as upgrade prompts.
    if (imageLimit >= 0) {
      let count = 0;
      for (const entry of mediaEntries) {
        if (entry.kind === "image") {
          if (count >= imageLimit) locked.add(entry.key);
          count++;
        }
      }
    }

    // Lock excess videos
    if (videoLimit >= 0) {
      let count = 0;
      for (const entry of mediaEntries) {
        if (entry.kind === "video") {
          if (count >= videoLimit) locked.add(entry.key);
          count++;
        }
      }
    }

    // Audio is completely locked on Free plans (after free trial).
    // Paid plans and active trials keep audio available.
    if (plan === "free") {
      const audioLocked = !isDockTrialActive();
      let count = 0;
      for (const entry of mediaEntries) {
        if (entry.kind === "audio") {
          if (audioLocked || count >= 1) locked.add(entry.key);
          count++;
        }
      }
    }

    return locked;
  }, [dockPlan, mediaEntries]);

  // Free-plan gating: mark uploads beyond the configured quota while keeping
  // the full library visible so locked items can explain how to upgrade.
  const isFreePlan = dockPlan === "free";
  const isAudioLocked = isFreePlan && !isDockTrialActive();

  useEffect(() => {
    if (isAudioLocked && activeKinds.includes("audio")) {
      setActiveKinds((current) => current.filter((kind) => kind !== "audio"));
    }
  }, [isAudioLocked, activeKinds]);

  const animationIdentitySet = useMemo(() => new Set(
    animationEntries.flatMap((entry) => [
      normalizeUploadFileName(entry.name),
      normalizeUploadFileName(entry.uploadFile || ""),
      normalizeUploadFileName(entry.libraryItem?.name || ""),
      normalizeUploadFileName(entry.libraryItem?.diskFileName || ""),
      normalizeUploadFileName(entry.libraryItem?.filePath || ""),
    ].filter(Boolean)),
  ), [animationEntries]);

  const filteredUploadEntries = useMemo(() => {
    const multiKindKeys = new Set<string>();
    if (activeKinds.length > 1) {
      if (activeKinds.includes("video")) videoEntries.forEach((entry) => multiKindKeys.add(entry.key));
      if (activeKinds.includes("image")) imageEntries.forEach((entry) => multiKindKeys.add(entry.key));
      if (activeKinds.includes("audio")) audioEntries.forEach((entry) => multiKindKeys.add(entry.key));
    }
    const pool = activeKinds.length > 1
      ? nonDocumentMediaEntries.filter((entry) => multiKindKeys.has(entry.key))
      : activeKind === "all"
      ? nonDocumentMediaEntries
      : activeKind === "video"
        ? videoEntries
        : activeKind === "audio"
          ? audioEntries
          : activeKind === "document"
            ? []
            : imageEntries;
    const query = assetSearch.trim().toLowerCase();
    const folderPool = activeFolder === "all"
      ? pool
      : pool.filter((entry) => mediaPrefs[entry.prefKey]?.folder === activeFolder);
    // A downloaded template can arrive through both the library snapshot and
    // the uploads directory. Exclude the duplicate from Newly Uploaded when
    // it is already represented in the animation/template collection.
    const searchMatched = !query
      ? folderPool
      : folderPool.filter((entry) => matchesMediaEntrySearch(entry, mediaPrefs[entry.prefKey], query));
    const withoutTemplateDuplicates = searchMatched.filter((entry) => {
      const identities = [
        normalizeUploadFileName(entry.name),
        normalizeUploadFileName(entry.uploadFile || ""),
        normalizeUploadFileName(entry.libraryItem?.name || ""),
        normalizeUploadFileName(entry.libraryItem?.diskFileName || ""),
        normalizeUploadFileName(entry.libraryItem?.filePath || ""),
      ].filter(Boolean);
      return !identities.some((identity) => animationIdentitySet.has(identity));
    });
    return withoutTemplateDuplicates;
  }, [activeFolder, activeKind, activeKinds, animationIdentitySet, assetSearch, audioEntries, imageEntries, mediaPrefs, nonDocumentMediaEntries, videoEntries]);

  const filteredDocumentDecks = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    const folderDecks = activeFolder === "all"
      ? documentDecks
      : documentDecks.filter((deck) => deck.pages.some((page) => mediaPrefs[page.prefKey]?.folder === activeFolder));
    if (!query) return folderDecks;
    return folderDecks.filter((deck) => deck.name.toLowerCase().includes(query));
  }, [activeFolder, assetSearch, documentDecks, mediaPrefs]);

  const filteredPatternEntries = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) return patternEntries;
    return patternEntries.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [assetSearch, patternEntries]);
  const filteredSavedTemplateEntries = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) return savedTemplateEntries;
    return savedTemplateEntries.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [assetSearch, savedTemplateEntries]);
  const filteredAnimationEntries = useMemo(() => {
    if (animationsLocked) return [];
    const query = assetSearch.trim().toLowerCase();
    const folderEntries = activeFolder === "all"
      ? animationEntries
      : animationEntries.filter((entry) => mediaPrefs[entry.prefKey]?.folder === activeFolder);
    const requestedKind = animationCatalogTab === "videos" ? "video" : "image";
    const kindEntries = folderEntries.filter((entry) => entry.kind === requestedKind);
    if (!query) return kindEntries;
    return kindEntries.filter((entry) => matchesMediaEntrySearch(entry, mediaPrefs[entry.prefKey], query));
  }, [activeFolder, animationCatalogTab, animationEntries, animationsLocked, assetSearch, mediaPrefs]);
  const filteredTemplateVideos = useMemo(() => {
    const query = templateVideoSearch.trim().toLowerCase();
    return templateVideos
      .filter((asset) => !query || asset.fileName.toLowerCase().includes(query))
      .sort(compareTemplateAssetsNewest);
  }, [templateVideoSearch, templateVideos]);
  const filteredAnimationTemplateVideos = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return templateVideos
      .filter((asset) => !query || asset.fileName.toLowerCase().includes(query))
      .sort(compareTemplateAssetsNewest);
  }, [assetSearch, templateVideos]);
  const filteredAnimationTemplatePictures = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return templatePictures
      .filter((asset) => !query || asset.fileName.toLowerCase().includes(query))
      .sort(compareTemplateAssetsNewest);
  }, [assetSearch, templatePictures]);
  // The Animations tab represents the shared template catalog. Downloaded
  // items are still used for local playback, but the count comes from the
  // same remote list used by the template picker.
  const templateCatalogCount = templateVideos.length + templatePictures.length;
  const animationCatalogCount: number | string = (templateVideosLoading || templatePicturesLoading) && templateCatalogCount === 0
    ? "…"
    : templateVideosError && templatePicturesError && templateCatalogCount === 0
      ? animationEntries.length
      : templateCatalogCount;
  const managedEntries = useMemo(
    () => [...mediaEntries, ...animationEntries],
    [animationEntries, mediaEntries],
  );
  const allResolvableEntries = useMemo(
    () => [...managedEntries, ...savedTemplateEntries, ...patternEntries],
    [managedEntries, patternEntries, savedTemplateEntries],
  );
  const activeOptionsEntry = useMemo(
    () => managedEntries.find((entry) => entry.key === openOptionsKey) ?? null,
    [managedEntries, openOptionsKey],
  );

  // Chromium/CEF can ignore autoPlay when a preview is mounted dynamically.
  // Explicitly start clicked previews after their media element is ready.
  useEffect(() => {
    if (!previewEntry || previewEntry.kind !== "video") return;
    const video = previewVideoRef.current;
    if (!video) return;
    const previewPrefs = getEntryPrefs(previewEntry);

    const startPlayback = () => {
      video.muted = previewPrefs.videoMuted ?? true;
      video.loop = previewPrefs.loop ?? true;
      video.playbackRate = (previewPrefs.playbackSpeed ?? 100) / 100;
      void video.play().catch((playError) => {
        console.warn("[DockMediaTab] Could not start video preview:", playError);
      });
    };

    if (video.readyState >= 2) {
      startPlayback();
      return;
    }

    video.addEventListener("canplay", startPlayback, { once: true });
    return () => video.removeEventListener("canplay", startPlayback);
  }, [getEntryPrefs, mediaPrefs, previewEntry]);

  useEffect(() => {
    if (!previewPlaying || activeOptionsEntry?.kind !== "video") return;
    const video = inspectorPreviewVideoRef.current;
    if (!video) return;
    const inspectorPrefs = getEntryPrefs(activeOptionsEntry);

    const startPlayback = () => {
      video.muted = inspectorPrefs.videoMuted ?? true;
      video.loop = inspectorPrefs.loop ?? true;
      video.playbackRate = (inspectorPrefs.playbackSpeed ?? 100) / 100;
      void video.play().catch((playError) => {
        console.warn("[DockMediaTab] Could not start inspector video preview:", playError);
      });
    };

    if (video.readyState >= 2) {
      startPlayback();
      return;
    }

    video.addEventListener("canplay", startPlayback, { once: true });
    return () => video.removeEventListener("canplay", startPlayback);
  }, [activeOptionsEntry, getEntryPrefs, mediaPrefs, previewPlaying]);

  useEffect(() => {
    if (presentationLinkMode || !activeOptionsEntry || !canSendEntryToScene(activeOptionsEntry)) {
      setSceneSendChoices([]);
      setSceneSendSelection("");
      setSceneSendError(null);
      setSceneSendLoading(false);
      return;
    }
    void loadSceneSendChoices();
  }, [activeOptionsEntry, loadSceneSendChoices, presentationLinkMode]);

  useEffect(() => {
    if (!presentationLinkMode) return;
    setSceneSendEntry(null);
    setSceneSendChoices([]);
    setSceneSendSelection("");
    setSceneSendError(null);
  }, [presentationLinkMode]);
  const previewBaseEntry = activeTargets.active;
  // The entry can take a moment to rehydrate after reload, but the persisted key
  // still tells us that OBS has an active media target that can be cleared.
  const hasActiveMediaTarget = Boolean(activeTargets.active || activeTargetKeys.active);

  // ── Selection helpers ──
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedKeys(new Set());
      return !prev;
    });
  }, []);

  const toggleSelectKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }, []);

  const handleCreateVlcPlaylist = useCallback(async () => {
    if (selectedKeys.size === 0) return;

    const entryMap = new Map(allResolvableEntries.map((e) => [e.key, e]));
    const selectedMedia = Array.from(selectedKeys)
      .map((key) => entryMap.get(key))
      .filter((entry): entry is DockMediaEntry => Boolean(entry));
    const hasAudio = selectedMedia.some((entry) => entry.kind === "audio");
    const hasVisualMedia = selectedMedia.some((entry) => entry.kind === "video" || entry.kind === "image");

    if (hasAudio && isAudioLocked) {
      showUpgradeModal("Audio playlist creation is available on Basic and Growth plans. Upgrade to unlock.");
      return;
    }

    // Audio playlists are part of the Audio section and do not require the
    // visual slideshow entitlement. Mixed visual playlists keep the existing
    // slideshow gate.
    if (!hasAudio || hasVisualMedia) {
      if (!(await requireEntitlement("slideshow", 0))) return;
      const videoCount = libraryMedia.filter((m) => m.type === "video").length;
      if (!(await requireEntitlement("videos", videoCount))) return;
    }
    try {
      await ensureObsConnected();
    } catch {
      console.warn("[DockMediaTab] Cannot create playlist: not connected to OBS");
      return;
    }

    const videoPaths: string[] = [];
    const imagePaths: string[] = [];
    const audioPaths: string[] = [];

    for (const key of selectedKeys) {
      const entry = entryMap.get(key);
      if (!entry) continue;

      let filePath: string | null = null;
      try {
        if (entry.uploadFile) {
          filePath = await resolveUploadFilePath(entry.uploadFile);
        } else if (entry.libraryItem) {
          filePath = await resolveLibraryMediaFilePath(entry.libraryItem);
        }
      } catch (err) {
        console.warn("[DockMediaTab] Could not resolve playlist media path:", entry.name, err);
      }

      if (filePath) {
        if (entry.kind === "image") {
          imagePaths.push(filePath);
        } else if (entry.kind === "video") {
          videoPaths.push(filePath);
        } else {
          audioPaths.push(filePath);
        }
      }
    }

    try {
      // Keep the OBS source name readable when the operator leaves the name
      // empty. The media-type suffix keeps image and video sources distinct.
      const sourceName = playlistName.trim() || "MCE slideshow";

      // Create Slideshow for videos
      if (videoPaths.length > 0) {
        await dockObsClient.pushVlcPlaylist({
          sourceName: `${sourceName} ${t('media.videos')}`,
          playlist: videoPaths,
          loop: playlistLoop,
          shuffle: playlistShuffle,
          muted: playlistMuted,
        });
      }

      // Create image slideshow for images
      if (imagePaths.length > 0) {
        await dockObsClient.pushImageSlideshow({
          sourceName: `${sourceName} ${t('media.images')}`,
          images: imagePaths,
          loop: playlistLoop,
          slideTime: 3000,
        });
      }

      if (audioPaths.length > 0) {
        await dockObsClient.pushVlcPlaylist({
          sourceName: `${sourceName} Audio`,
          playlist: audioPaths,
          loop: playlistLoop,
          shuffle: playlistShuffle,
          muted: false,
        });
      }

      setShowPlaylistModal(false);
      clearSelection();
    } catch (err) {
      console.warn("[DockMediaTab] Failed to create playlist:", err);
    }
  }, [
    allResolvableEntries,
    clearSelection,
    playlistLoop,
    playlistMuted,
    playlistName,
    playlistShuffle,
    resolveLibraryMediaFilePath,
    resolveUploadFilePath,
    selectedKeys,
    t,
  ]);

  const selectedEntries = useMemo(
    () => {
      const entryMap = new Map(allResolvableEntries.map((e) => [e.key, e]));
      return Array.from(selectedKeys)
        .map(key => entryMap.get(key))
        .filter((e): e is DockMediaEntry => !!e);
    },
    [selectedKeys, allResolvableEntries],
  );

  const selectedVideoEntries = useMemo(
    () => selectedEntries.filter((e) => e.kind === "video"),
    [selectedEntries],
  );

  const selectedImageEntries = useMemo(
    () => selectedEntries.filter((e) => e.kind === "image"),
    [selectedEntries],
  );

  const selectedAudioEntries = useMemo(
    () => selectedEntries.filter((e) => e.kind === "audio"),
    [selectedEntries],
  );

  useEffect(() => {
    const entryMap = new Map(allResolvableEntries.map((entry) => [entry.key, entry]));
    setActiveTargets({
      active: activeTargetKeys.active ? entryMap.get(activeTargetKeys.active) ?? null : null,
    });
  }, [activeTargetKeys.active, allResolvableEntries]);

  useEffect(() => {
    try {
      localStorage.setItem(MEDIA_SESSION_STORAGE_KEY, JSON.stringify({
        browserTab,
        activeKind,
        activeKinds,
        viewMode,
        activeTargetKeys,
        pausedTargets,
        textOverlay,
        textOverlayTargets,
      } satisfies DockMediaSessionState));
    } catch {
      // Dock session persistence is convenience-only.
    }
  }, [activeKind, activeKinds, activeTargetKeys, browserTab, pausedTargets, textOverlay, textOverlayTargets, viewMode]);

  useEffect(() => {
    if (activeKind === "video" && videoEntries.length === 0 && imageEntries.length > 0) {
      setActiveKind("image");
      return;
    }
    if (activeKind === "image" && imageEntries.length === 0 && videoEntries.length > 0) {
      setActiveKind("video");
    }
    if (activeKind === "all" && mediaEntries.length === 0) {
      // Stay on "all" even when empty — shows the empty state
    }
  }, [activeKind, imageEntries.length, mediaEntries.length, videoEntries.length]);

  const toggleVideoMute = useCallback(
    async (entry: DockMediaEntry) => {
      const currentMuted = getEntryPrefs(entry).videoMuted ?? true;
      const nextMuted = !currentMuted;
      updateMediaPreference(entry.prefKey, { videoMuted: nextMuted });

      if (activeTargets.active?.key === entry.key) {
        try {
          await ensureObsConnected();
          await dockObsClient.setMediaVideoMuted(nextMuted);
        } catch (err) {
          console.warn("[DockMediaTab] toggleVideoMute failed:", err);
        }
      }
    },
    [activeTargets.active, getEntryPrefs, updateMediaPreference],
  );

  const setEntryVideoSourceSetting = useCallback(
    async (
      entry: DockMediaEntry,
      patch: Pick<DockMediaPreference, "loop" | "restartOnActivate" | "closeWhenInactive" | "clearOnMediaEnd" | "playbackSpeed">,
      sourceSettings: {
        looping?: boolean;
        restartOnActivate?: boolean;
        closeWhenInactive?: boolean;
        clearOnMediaEnd?: boolean;
        playbackSpeed?: number;
      },
    ) => {
      updateMediaPreference(entry.prefKey, patch);
      if (activeTargets.active?.key !== entry.key) return;

      try {
        await ensureObsConnected();
        await dockObsClient.setMediaVideoSourceSettings(sourceSettings);
      } catch (err) {
        console.warn("[DockMediaTab] setEntryVideoSourceSetting failed:", err);
      }
    },
    [activeTargets.active, updateMediaPreference],
  );

  const setEntryLoop = useCallback(
    async (entry: DockMediaEntry, looping: boolean) => {
      await setEntryVideoSourceSetting(entry, { loop: looping }, { looping });
    },
    [setEntryVideoSourceSetting],
  );

  const setEntryFitMode = useCallback(
    async (entry: DockMediaEntry, fitMode: DockMediaFitMode) => {
      updateMediaPreference(entry.prefKey, { fitMode });
      if (activeTargets.active?.key === entry.key) {
        try {
          await ensureObsConnected();
          await dockObsClient.setMediaFitMode(fitMode);
        } catch (err) {
          console.warn("[DockMediaTab] setEntryFitMode failed:", err);
        }
      }
    },
    [activeTargets.active, updateMediaPreference],
  );

  const setEntryLabel = useCallback((entry: DockMediaEntry, label: string) => {
    updateMediaPreference(entry.prefKey, { label });
  }, [updateMediaPreference]);

  const beginEntryLabelEdit = useCallback((entry: DockMediaEntry) => {
    const currentLabel = mediaPrefs[entry.prefKey]?.label?.trim();
    const fallbackLabel = entry.name.replace(/^media_\d+_/, "").replace(/\.[^.]+$/, "");
    setEntryLabelDraft(currentLabel || fallbackLabel);
    setEditingEntryLabelKey(entry.key);
  }, [mediaPrefs]);

  const commitEntryLabel = useCallback((entry: DockMediaEntry) => {
    setEntryLabel(entry, entryLabelDraft.trim());
    setEditingEntryLabelKey(null);
  }, [entryLabelDraft, setEntryLabel]);

  const toggleMediaPinned = useCallback((entry: DockMediaEntry) => {
    setMediaPrefs((prev) => ({
      ...prev,
      [entry.prefKey]: {
        ...prev[entry.prefKey],
        pinned: !prev[entry.prefKey]?.pinned,
      },
    }));
    setMediaContextMenu(null);
  }, []);

  const assignMediaFolder = useCallback((entry: DockMediaEntry, folder: string | null) => {
    updateMediaPreference(entry.prefKey, { folder: folder || null });
    setMediaContextMenu(null);
    setMediaContextFolderOpen(false);
  }, [updateMediaPreference]);

  const createMediaFolder = useCallback((entry: DockMediaEntry) => {
    const requestedName = newFolderDraft.trim();
    if (!requestedName) return;

    const existingFolder = mediaFolders.find(
      (folder) => folder.toLocaleLowerCase() === requestedName.toLocaleLowerCase(),
    );
    const folder = existingFolder || requestedName;
    if (!existingFolder) {
      setMediaFolders((current) => [...current, folder].sort((a, b) => a.localeCompare(b)));
    }
    updateMediaPreference(entry.prefKey, { folder });
    setActiveFolder(folder);
    setNewFolderDraft("");
    setMediaContextMenu(null);
    setMediaContextFolderOpen(false);
  }, [mediaFolders, newFolderDraft, updateMediaPreference]);

  const closeEntryOptions = useCallback(() => {
    setEditingEntryLabelKey(null);
    setOpenOptionsKey(null);
  }, []);

  const removeMediaFromAppLibrary = useCallback((id?: string, fileName?: string) => {
    if (!id && !fileName) return;
    dockClient.sendCommand({
      type: "media:delete",
      payload: { ...(id ? { id } : {}), ...(fileName ? { fileName } : {}) },
      timestamp: Date.now(),
      commandId: `dock-media-delete-${id || fileName}`,
    });
    dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
  }, []);

  // Directly delete from IndexedDB (called alongside the bridge command for reliability)
  const deleteFromIndexedDb = useCallback(async (id: string) => {
    try {
      const { deleteMedia } = await import("../../library/libraryDb");
      await deleteMedia(id);
    } catch {
      // Bridge command is the primary path; this is a safety net
    }
  }, []);

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    console.log("[UPLOAD] ─── handleUploadFiles started ───");
    const allFiles = Array.from(files);
    console.log("[UPLOAD] Total files:", allFiles.length);

    type UploadQueueItem = { file: File; documentPage?: DocumentPageFile };
    const mediaFiles = allFiles.filter((f) => isSupportedMediaFile(f));
    const documentFiles = allFiles.filter((f) => isSupportedDocumentFile(f));

    // Validate file types — reject unsupported files with clear error
    const rejected = allFiles.filter((f) => !isSupportedMediaFile(f) && !isSupportedDocumentFile(f));
    for (const f of rejected) {
      showUpgradeModal(`Unsupported file type: ${f.name}. Please upload an image, video, audio, PDF, DOCX, or PPTX file.`);
    }

    let queueItems: UploadQueueItem[] = mediaFiles.map((file) => ({ file }));
    if (documentFiles.length > 0) {
      setUploading(true);
      setUploadStatus("Preparing document pages…");
      for (const documentFile of documentFiles) {
        try {
          const label = getDocumentTypeLabel(documentFile);
          setUploadStatus(`Preparing ${label}: ${documentFile.name}…`);
          const pages = await convertDocumentToPageFiles(documentFile, setUploadStatus);
          queueItems = [
            ...queueItems,
            ...pages.map((page) => ({ file: page.file, documentPage: page })),
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not prepare document.";
          showUpgradeModal(`Could not prepare ${documentFile.name}: ${message}`);
        }
      }
    }

    if (queueItems.length === 0) {
      setUploading(false);
      setUploadStatus("");
      return;
    }
    const queue = queueItems.map((item) => item.file);

    // ── Per-file-type quota enforcement ──
    // Resolve limits from server entitlements → localStorage → fallback
    const plan = getDockPlan();
    let serverEntitlements: Record<string, number | boolean> | null = null;
    try {
      const raw = localStorage.getItem(getUserScopedKey("ocs-dock-entitlements"));
      if (raw) serverEntitlements = JSON.parse(raw);
    } catch { /* */ }
    const getLimit = (feature: string): number => {
      if (serverEntitlements && serverEntitlements[feature] !== undefined) {
        const v = serverEntitlements[feature];
        if (typeof v === "boolean") return v ? -1 : 0;
        if (typeof v === "number") return v;
      }
      return getFeatureLimit(feature as any, plan);
    };
    const imageLimit = getLimit("images");
    const videoLimit = getLimit("videos");
    const audioLimit = isAudioLocked ? 0 : (plan === "free" ? 1 : -1);

    // Count both the shared library and the local fallback library. The upload
    // path writes to both, and counting only IndexedDB can make quota state
    // stale while the newly uploaded item is being added.
    const currentMediaItems = dedupeMediaItems([...libraryMedia, ...localLibrary]);
    const currentImages = currentMediaItems.filter((m) => m.type === "image").length;
    const currentVideos = currentMediaItems.filter((m) => m.type === "video").length;
    const currentAudio = currentMediaItems.filter((m) => m.type === "audio").length;

    // Count incoming files per type
    const incomingImages = queue.filter((f) => getMediaKind(f) === "image").length;
    const incomingVideos = queue.filter((f) => getMediaKind(f) === "video").length;
    const incomingAudio = queue.filter((f) => getMediaKind(f) === "audio").length;

    // Check if each type would exceed quota
    const imageQuotaExceeded = imageLimit >= 0 && (currentImages + incomingImages) > imageLimit;
    const videoQuotaExceeded = videoLimit >= 0 && (currentVideos + incomingVideos) > videoLimit;
    const audioQuotaExceeded = isAudioLocked ? incomingAudio > 0 : (audioLimit >= 0 && (currentAudio + incomingAudio) > audioLimit);

    // Both types over limit → block entirely
    if (imageQuotaExceeded && videoQuotaExceeded && audioQuotaExceeded) {
      showUpgradeModal(t('media.mediaLimitsReached', { currentImages, imageLimit, currentVideos, videoLimit }));
      setUploading(false);
      setUploadStatus("");
      return;
    }

    // Filter queue to only allow files whose type is within quota
    const allowedQueueItems = queueItems.filter(({ file }) => {
      if (getMediaKind(file) === "image" && imageQuotaExceeded) return false;
      if (getMediaKind(file) === "video" && videoQuotaExceeded) return false;
      if (getMediaKind(file) === "audio" && (isAudioLocked || audioQuotaExceeded)) return false;
      return true;
    });
    const allowedQueue = allowedQueueItems.map((item) => item.file);

    if (allowedQueueItems.length === 0) {
      // All files rejected — show upgrade modal
      if (audioQuotaExceeded && !imageQuotaExceeded && !videoQuotaExceeded) {
        showUpgradeModal(
          isAudioLocked
            ? "Audio uploads are available on Basic and Growth plans. Upgrade to unlock."
            : "Free plans allow one audio file. Upgrade to add more audio files."
        );
      } else {
        const rejectedType = imageQuotaExceeded ? "images" : "videos";
        const limit = imageQuotaExceeded ? imageLimit : videoLimit;
        const current = imageQuotaExceeded ? currentImages : currentVideos;
        showUpgradeModal(t('media.typeLimitReached', { type: rejectedType, current, limit }));
      }
      setUploading(false);
      setUploadStatus("");
      return;
    }

    // Show explanation if some files were rejected
    const rejectedCount = queueItems.length - allowedQueueItems.length;
    if (rejectedCount > 0) {
      if (audioQuotaExceeded && !imageQuotaExceeded && !videoQuotaExceeded) {
        showUpgradeModal(
          isAudioLocked
            ? "Audio uploads are available on Basic and Growth plans. Upgrade to unlock."
            : `Free plans allow one audio file. ${rejectedCount} audio file${rejectedCount === 1 ? " was" : "s were"} skipped.`
        );
      } else {
        const rejectedType = imageQuotaExceeded ? "images" : "videos";
        const limit = imageQuotaExceeded ? imageLimit : videoLimit;
        const current = imageQuotaExceeded ? currentImages : currentVideos;
        showUpgradeModal(t('media.typeLimitWithSkipped', { type: rejectedType, current, limit, skipped: rejectedCount, skippedPlural: rejectedCount > 1 ? "s were" : " was" }));
      }
    }

    setUploading(true);
    console.log("[UPLOAD] Queue after filtering:", allowedQueue.map((f) => f.name));
    console.log("[UPLOAD] Limits:", { imageLimit, videoLimit, audioLimit, currentImages, currentVideos, currentAudio });
    try {
      const nextItems: MediaItem[] = [];
      for (const { file, documentPage } of allowedQueueItems) {
        console.log("[UPLOAD] ── Uploading:", file.name, { size: file.size, type: file.type });
        setUploadStatus(documentPage
          ? `Saving page ${documentPage.pageNumber} of ${documentPage.pageCount}…`
          : `Saving ${file.name}…`);
        const uploadStart = performance.now();
        const { item, error } = await uploadFileToDock(file, setUploadStatus);
        const uploadMs = Math.round(performance.now() - uploadStart);
        if (error) {
          console.warn("[UPLOAD] ✗ Upload FAILED:", file.name, error, `${uploadMs}ms`);
          continue;
        }
        if (documentPage) {
          item.source = "document-conversion";
          item.documentSourceName = documentPage.sourceName;
          item.documentId = documentPage.documentId;
          item.documentPageNumber = documentPage.pageNumber;
          item.documentPageCount = documentPage.pageCount;
          item.name = `${documentPage.sourceName} · Page ${documentPage.pageNumber}`;
        }
        console.log("[UPLOAD] ✓ Upload OK:", file.name, { id: item.id, filePath: item.filePath, uploadMs });
        nextItems.push(item);
        console.log("[UPLOAD] Registering shared dock media item:", item.id);
        await registerDockMediaItem(item);
        // Show each file as soon as it is saved instead of after the whole batch, so a
        // new upload is at the top of Newly Uploaded straight away.
        rememberPendingMedia([item]);
        setLibraryMedia((current) => dedupeMediaItems([item, ...current]));
        if (documentPage) {
          updateMediaPreference(`media:${item.filePath || item.diskFileName || item.id}`, { fitMode: "contain" });
        }
      }
      if (nextItems.length > 0) {
        // Keep the timestamp returned by the upload service. Newly uploaded
        // items must remain visible in the Uploaded/Newly Updated view.
        rememberPendingMedia(nextItems);
        persistLocalLibrary((current) => [...nextItems, ...current]);
        setLibraryMedia((current) => dedupeMediaItems([...nextItems, ...current]));
        console.log("[UPLOAD] About to refreshMedia. Library size:", mergedLibraryItems.length, "Local:", localLibrary.length);
        await refreshMedia();
        console.log("[UPLOAD] refreshMedia complete. Library size:", libraryMedia.length);
        setShowAddMediaModal(false);
        setBrowserTab("uploads");
        setActiveKind("all");
        setAssetSearch("");
        setActiveFolder("all");
        dockClient.sendState({ type: "state:library-updated", payload: null, timestamp: Date.now() });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("mce-media-library-updated"));
        }
        for (const item of nextItems) {
          track("media_uploaded", { mediaType: item.type });
          trackMediaUploaded(item.type || "unknown");
        }
        console.log("[UPLOAD] ─── Upload flow finished successfully ───");
      } else {
        console.log("[UPLOAD] No items uploaded (all failed or quota blocked)");
      }
    } catch (err) {
      console.error("[UPLOAD] ✗ Upload flow FAILED:", err);
    } finally {
      console.log("[UPLOAD] Finally block — setting uploading=false");
      setUploading(false);
      setUploadStatus("");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [libraryMedia, localLibrary, persistLocalLibrary, refreshMedia, rememberPendingMedia, t, updateMediaPreference]);

  const deleteEntry = useCallback(
    async (entry: DockMediaEntry) => {
      const { getManagedUploadFileName, deleteUploadedMediaFile } = await import("../../library/libraryDb");
      const fileName = entry.uploadFile || (entry.libraryItem ? getManagedUploadFileName(entry.libraryItem) : null);
      pendingMediaItemsRef.current.delete(getMediaStableKey(getDockMediaOrderMetadata(entry)));
      try {
        if (fileName) await deleteUploadedMediaFile(fileName);
      } catch (error) {
        console.warn("[DockMediaTab] Could not delete the uploaded media file:", error);
        return;
      }

      updateMediaPreference(entry.prefKey, { hidden: true });
      if (entry.libraryItem?.id) {
        removeMediaFromAppLibrary(entry.libraryItem.id);
        await deleteFromIndexedDb(entry.libraryItem.id);
      } else if (fileName) {
        removeMediaFromAppLibrary(undefined, fileName);
      }

      const itemId = entry.libraryItem?.id;
      const matchesDeletedItem = (item: MediaItem) => (
        item.id === itemId
        || Boolean(fileName && getManagedUploadFileName(item) === fileName)
      );
      setUploadedFiles((current) => (fileName ? current.filter((file) => file !== fileName) : current));
      setLibraryMedia((current) => current.filter((item) => !matchesDeletedItem(item)));
      persistLocalLibrary((current) => current.filter((item) => !matchesDeletedItem(item)));
      const { deleteDockMediaItem } = await import("../dockUploadService");
      await deleteDockMediaItem(itemId, fileName);
      await refreshMedia();
      dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
      dockClient.sendState({ type: "state:library-updated", payload: null, timestamp: Date.now() });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mce-media-library-updated"));
      }
      if (activeTargets.active?.key === entry.key) {
        setOpenOptionsKey(null);
      }
    },
    [activeTargets.active, deleteFromIndexedDb, persistLocalLibrary, refreshMedia, removeMediaFromAppLibrary, updateMediaPreference],
  );

  const handleSendEntry = useCallback(
    async (entry: DockMediaEntry, optionOverrides: DockMediaSendOptions = {}) => {
      // Presentation actions do NOT consume storage quota — no entitlement check needed.
      // The media already exists within the user's allowed quota.
      if (entry.kind === "audio" && isAudioLocked) {
        showUpgradeModal("Audio playback is available on Basic and Growth plans. Upgrade to unlock.");
        return false;
      }
      if (entry.libraryItem && isAnimationMediaItem(entry.libraryItem)) {
        if (!(await requireEntitlement("slideshow", 0))) return false;
      }
      let success = false;
      const options = { ...getEntrySendOptions(entry), ...optionOverrides };
      if (entry.uploadFile) {
        success = await playMedia(entry.uploadFile, options);
      } else if (entry.libraryItem) {
        success = await playLibraryMedia(entry.libraryItem, options);
      }

      if (!success) return false;

      setActiveTargetKeys({ active: entry.key });
      updateMediaPreference(entry.prefKey, { lastUsedAt: new Date().toISOString() });
      setPausedTargets({ active: false });
      return true;
    },
    [getEntrySendOptions, playLibraryMedia, playMedia, updateMediaPreference]
  );

  const openDocumentDeck = useCallback((deck: DockDocumentDeck) => {
    setOpenOptionsKey(null);
    setDocumentDeck(deck);
    setDocumentPageIndex(0);
    setDocumentDisplay(DEFAULT_DOCUMENT_DISPLAY);
    setDocumentDisplayDraft(DEFAULT_DOCUMENT_DISPLAY);
    setDocumentControlsOpen(false);
  }, []);

  const closeDocumentDeck = useCallback(() => {
    if (sendingDocumentPage || savingDocumentControls) return;
    setDocumentDeck(null);
    setDocumentPageIndex(0);
    setDocumentControlsOpen(false);
  }, [savingDocumentControls, sendingDocumentPage]);

  const deleteDocumentDeck = useCallback(async (deck: DockDocumentDeck) => {
    if (sendingDocumentPage) return;
    for (const page of deck.pages) {
      await deleteEntry(page);
    }
    if (documentDeck?.documentId === deck.documentId) {
      setDocumentDeck(null);
      setDocumentPageIndex(0);
      setDocumentControlsOpen(false);
    }
  }, [deleteEntry, documentDeck?.documentId, sendingDocumentPage]);

  const updateDocumentPositionFromPointer = useCallback((element: HTMLDivElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const offsetX = Math.round(Math.max(-100, Math.min(100, ((clientX - bounds.left) / bounds.width - 0.5) * 200)));
    const offsetY = Math.round(Math.max(-100, Math.min(100, ((clientY - bounds.top) / bounds.height - 0.5) * 200)));
    setDocumentDisplayDraft((current) => ({ ...current, offsetX, offsetY }));
  }, []);

  const handleDocumentPositionPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDocumentPositionFromPointer(event.currentTarget, event.clientX, event.clientY);
  }, [updateDocumentPositionFromPointer]);

  const handleDocumentPositionPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateDocumentPositionFromPointer(event.currentTarget, event.clientX, event.clientY);
    }
  }, [updateDocumentPositionFromPointer]);

  const handleDocumentPositionKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 5;
    const direction = event.key === "ArrowUp" ? -1 : 1;
    setDocumentDisplayDraft((current) => ({
      ...current,
      offsetY: Math.max(-100, Math.min(100, current.offsetY + direction * step)),
    }));
  }, []);

  const resetDocumentPosition = useCallback(() => {
    setDocumentDisplayDraft((current) => ({ ...current, offsetX: 0, offsetY: 0 }));
  }, []);

  const openDocumentControls = useCallback(() => {
    setDocumentDisplayDraft(documentDisplay);
    setDocumentControlsOpen(true);
  }, [documentDisplay]);

  const closeDocumentControls = useCallback(() => {
    if (savingDocumentControls) return;
    setDocumentControlsOpen(false);
  }, [savingDocumentControls]);

  const showDocumentPage = useCallback(async (pageIndex: number, display = documentDisplay): Promise<boolean> => {
    const page = documentDeck?.pages[pageIndex];
    if (!page || sendingDocumentPage) return false;
    if (isFreePlan && lockedKeys.has(page.key)) {
      void requireEntitlement("images", documentEntries.length);
      return false;
    }

    setDocumentPageIndex(pageIndex);
    setSendingDocumentPage(page.key);
    try {
      const documentOptions: DockDocumentMediaOptions = {
        pageNumber: page.libraryItem?.documentPageNumber ?? pageIndex + 1,
        pageCount: documentDeck.pageCount,
        showBackground: display.showBackground,
        showPageLabel: display.showPageLabel,
        alignment: display.alignment,
        zoom: display.zoom,
        offsetX: display.offsetX,
        offsetY: display.offsetY,
        legacyCanvas: page.libraryItem?.width !== undefined && page.libraryItem?.height !== undefined
          ? page.libraryItem.width === 1920 && page.libraryItem.height === 1080
          : undefined,
      };
      const success = await handleSendEntry(page, {
        transition: documentTransition,
        fitMode: display.fitMode,
        document: documentOptions,
      });
      return Boolean(success);
    } finally {
      setSendingDocumentPage(null);
    }
  }, [documentDeck, documentDisplay, documentEntries.length, documentTransition, handleSendEntry, isFreePlan, lockedKeys, sendingDocumentPage]);

  const saveDocumentControls = useCallback(async () => {
    if (!documentDeck || savingDocumentControls) return;
    setSavingDocumentControls(true);
    try {
      const success = await showDocumentPage(documentPageIndex, documentDisplayDraft);
      if (success) {
        setDocumentDisplay(documentDisplayDraft);
        setDocumentControlsOpen(false);
      }
    } finally {
      setSavingDocumentControls(false);
    }
  }, [documentDeck, documentDisplayDraft, documentPageIndex, savingDocumentControls, showDocumentPage]);

  const handleSendPattern = useCallback(async (entry: DockMediaEntry) => {
    // Presentation actions do NOT consume storage quota — no entitlement check needed.
    if (!presentationLinkMode) {
      void dockObsClient.focusMcePresentationModule("media").catch((err) => {
        console.warn("[DockMediaTab] Failed to focus Media presentation source:", err);
      });
    }
    setSendingFile(entry.playingKey);
    try {
      if (!entry.previewUrl) return;
      if (presentationLinkMode) {
        await publishMediaToPresentation({
          id: entry.key,
          name: entry.name,
          type: "image",
          url: entry.previewUrl,
          createdAt: new Date().toISOString(),
        }, {
          fit: "cover",
        });
        setActiveTargetKeys({ active: entry.key });
        setPausedTargets({ active: false });
        updateMediaPreference(entry.prefKey, { lastUsedAt: new Date().toISOString() });
        return;
      }
      await ensureObsConnected();
      await dockObsClient.pushPatternBackground(entry.previewUrl, entry.name);
      setActiveTargetKeys({ active: entry.key });
      setPausedTargets({ active: false });
      updateMediaPreference(entry.prefKey, { lastUsedAt: new Date().toISOString() });
    } catch (err) {
      console.warn("[DockMediaTab] Pattern push failed:", err);
    } finally {
      setSendingFile(null);
    }
  }, [presentationLinkMode, updateMediaPreference]);

  const findDownloadedTemplateVideo = useCallback((asset: TemplateVideoAsset) => (
    mergedLibraryItems.find((item) => (
      item.type === "video" &&
      Boolean(item.filePath) &&
      (item.sourceAssetId === asset.id ||
        item.cloudflareKey === asset.cloudflareKey ||
        (item.source === "template-cloudflare" && item.name === asset.fileName))
    ))
  ), [mergedLibraryItems]);

  const findDownloadedTemplatePicture = useCallback((asset: TemplatePictureAsset) => (
    mergedLibraryItems.find((item) => (
      item.type === "image" &&
      Boolean(item.filePath) &&
      (item.sourceAssetId === asset.id ||
        item.cloudflareKey === asset.cloudflareKey ||
        (item.source === "template-cloudflare" && item.name === asset.fileName))
    ))
  ), [mergedLibraryItems]);

  const handleDownloadTemplateVideo = useCallback(async (asset: TemplateVideoAsset) => {
    // Instant UI feedback: transition to downloading state immediately on click
    setTemplateVideoProgress((current) => ({ ...current, [asset.id]: 0 }));
    setSendingFile(`template:${asset.id}`);

    const videoCount = libraryMedia.filter((m) => m.type === "video").length;
    let entitled = false;
    try {
      entitled = await requireEntitlement("videos", videoCount);
    } catch {
      entitled = false;
    }

    if (!entitled) {
      setTemplateVideoProgress((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      setSendingFile(null);
      return;
    }

    try {
      const item = await downloadTemplateVideoToLibrary(asset, (fraction) => {
        setTemplateVideoProgress((current) => ({ ...current, [asset.id]: fraction }));
      });

      rememberPendingMedia([item]);
      setLibraryMedia((current) => dedupeMediaItems([item, ...current]));
      persistLocalLibrary((current) => dedupeMediaItems([item, ...current]));
      dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
    } catch (err) {
      console.warn("[DockMediaTab] Template video download failed:", err);
      setTemplateVideosError(err instanceof Error ? err.message : t('media.unableToDownload', { fileName: asset.fileName }));
    } finally {
      setTemplateVideoProgress((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      setSendingFile(null);
    }
  }, [
    dockClient,
    libraryMedia,
    persistLocalLibrary,
    rememberPendingMedia,
    t,
  ]);

  const handleDownloadTemplatePicture = useCallback(async (asset: TemplatePictureAsset) => {
    // Instant UI feedback: transition to downloading state immediately on click
    setTemplatePictureProgress((current) => ({ ...current, [asset.id]: 0 }));
    setSendingFile(`template:${asset.id}`);

    const imageCount = libraryMedia.filter((item) => item.type === "image").length;
    let entitled = false;
    try {
      entitled = await requireEntitlement("images", imageCount);
    } catch {
      entitled = false;
    }

    if (!entitled) {
      setTemplatePictureProgress((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      setSendingFile(null);
      return;
    }

    try {
      const item = await downloadTemplatePictureToLibrary(asset, (fraction) => {
        setTemplatePictureProgress((current) => ({ ...current, [asset.id]: fraction }));
      });

      rememberPendingMedia([item]);
      setLibraryMedia((current) => dedupeMediaItems([item, ...current]));
      persistLocalLibrary((current) => dedupeMediaItems([item, ...current]));
      dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });
    } catch (err) {
      console.warn("[DockMediaTab] Template picture download failed:", err);
      setTemplatePicturesError(err instanceof Error ? err.message : t('media.unableToDownload', { fileName: asset.fileName }));
    } finally {
      setTemplatePictureProgress((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      setSendingFile(null);
    }
  }, [libraryMedia, persistLocalLibrary, rememberPendingMedia, t]);

  const playDownloadedTemplateVideo = useCallback((item: MediaItem) => {
    void handleSendEntry(createLibraryEntry(item, overlayBaseUrl, t('media.animation')));
  }, [handleSendEntry, overlayBaseUrl, t]);

  const playDownloadedTemplatePicture = useCallback((item: MediaItem) => {
    void handleSendEntry(createLibraryEntry(item, overlayBaseUrl, t('media.animation')));
  }, [handleSendEntry, overlayBaseUrl, t]);

  const applyTextOverlay = useCallback(async () => {
    const trimmedHeadline = textOverlay.headline.trim();
    const trimmedSubline = textOverlay.subline.trim();

    /* Resolve background image/pattern data for OBS overlay */
    let bgPayload = textOverlay.background.enabled ? { ...textOverlay.background } : undefined;
    if (bgPayload && bgPayload.bgType === "image" && bgPayload.imageId) {
      const img = localLibrary.find((item) => item.id === bgPayload!.imageId && item.type === "image");
      if (img) {
        bgPayload = { ...bgPayload, imageDataUrl: img.url || null };
      }
    } else if (bgPayload && bgPayload.bgType === "pattern" && bgPayload.patternId) {
      const pat = BACKGROUND_PATTERNS.find((p) => p.label === bgPayload!.patternId);
      if (pat) {
        bgPayload = { ...bgPayload, patternSvgData: pat.src };
      }
    }

    setApplyingTextTarget(true);
    try {
      const hasContent = Boolean(trimmedHeadline || trimmedSubline);
      const hasBg = Boolean(textOverlay.background.enabled && textOverlay.background.mode !== "text-only");

      if (presentationLinkMode) {
        if (hasContent || hasBg) {
          await publishTextOverlayToPresentation({
            headline: trimmedHeadline,
            subline: trimmedSubline,
            textColor: textOverlay.textColor,
            align: textOverlay.align,
            headlineSize: textOverlay.headlineSize,
            background: bgPayload,
          });
        } else {
          await clearPresentationScreen();
        }
        setTextOverlayTargets({ active: hasContent || hasBg });
        return;
      }

      await ensureObsConnected();
      await dockObsClient.setMediaTextOverlay(hasContent || hasBg ? {
        headline: trimmedHeadline,
        subline: trimmedSubline || undefined,
        textColor: textOverlay.textColor,
        align: textOverlay.align,
        verticalPos: textOverlay.verticalPos,
        headlineSize: textOverlay.headlineSize,
        sublineSize: textOverlay.sublineSize,
        animation: textOverlay.animation,
        animationDuration: textOverlay.animationDuration,
        background: bgPayload,
      } : null);
      setTextOverlayTargets({ active: hasContent || hasBg });
    } catch (err) {
      console.warn("[DockMediaTab] Failed to apply text overlay:", err);
    } finally {
      setApplyingTextTarget(null);
    }
  }, [textOverlay, localLibrary, presentationLinkMode]);

  const clearTextOverlayEverywhere = useCallback(async () => {
    setApplyingTextTarget(true);
    try {
      if (presentationLinkMode) {
        await clearPresentationScreen();
        setTextOverlayTargets({ active: false });
        return;
      }

      await ensureObsConnected();
      await dockObsClient.setMediaTextOverlay(null);
      setTextOverlayTargets({ active: false });
    } catch (err) {
      console.warn("[DockMediaTab] Failed to clear text overlays:", err);
    } finally {
      setApplyingTextTarget(null);
    }
  }, [presentationLinkMode]);

  const triggerAnimPreview = useCallback(() => {
    setAnimatingPreview(true);
    setTimeout(() => setAnimatingPreview(false), (textOverlay.animationDuration || 1) * 1000 + 200);
  }, [textOverlay.animationDuration]);

  const getAnimationClass = useCallback((): string => {
    if (!animatingPreview) return "";
    switch (textOverlay.animation) {
      case "fade": return "dock-overlay-anim--fade";
      case "fade-up": return "dock-overlay-anim--fade-up";
      case "slide-up": return "dock-overlay-anim--slide-up";
      case "slide-down": return "dock-overlay-anim--slide-down";
      case "zoom": return "dock-overlay-anim--zoom";
      default: return "";
    }
  }, [animatingPreview, textOverlay.animation]);

  const getVerticalPosStyle = useCallback((): React.CSSProperties => {
    switch (textOverlay.verticalPos) {
      case "top": return { justifyContent: "flex-start", paddingTop: "12%" };
      case "center": return { justifyContent: "center" };
      case "bottom": return { justifyContent: "flex-end", paddingBottom: "12%" };
      default: return { justifyContent: "flex-end", paddingBottom: "12%" };
    }
  }, [textOverlay.verticalPos]);

  const clearMedia = useCallback(async () => {
    setClearingTarget(true);
    try {
      if (presentationLinkMode) {
        await clearPresentationScreen();
        setActiveTargetKeys({ active: null });
        setPausedTargets({ active: false });
        setTextOverlayTargets({ active: false });
        return;
      }

      await ensureObsConnected();

      await dockObsClient.clearMedia();
      setActiveTargetKeys({ active: null });
      setPausedTargets({ active: false });
      setTextOverlayTargets({ active: false });
    } catch (err) {
      console.warn("[DockMediaTab] Clear media failed:", err);
    } finally {
      setClearingTarget(null);
    }
  }, [presentationLinkMode]);

  const clearAllMedia = useCallback(async () => {
    // Hide all entries via preferences
    setMediaPrefs((prev) => {
      const next = { ...prev };
      for (const entry of mediaEntries) {
        next[entry.prefKey] = { ...next[entry.prefKey], hidden: true };
      }
      return next;
    });
    // Delete the physical files as well as their library records so they are
    // not rediscovered by the Background picker later.
    for (const entry of mediaEntries) {
      await deleteEntry(entry);
    }
    setShowClearAllConfirm(false);
  }, [deleteEntry, mediaEntries]);

  const renderMediaCard = useCallback(
    (entry: DockMediaEntry) => {
      const isActiveTarget = activeTargets.active?.key === entry.key;
      const prefs = getEntryPrefs(entry);
      const displayName = prefs.label?.trim() || entry.name;
      const isSelected = selectedKeys.has(entry.key);
      const canSelect = selectionMode && (entry.kind === "video" || entry.kind === "image" || entry.kind === "audio");
      const isLocked = lockedKeys.has(entry.key);

      let thumbUrl = "";
      if (entry.thumbnailUrl) {
        thumbUrl = entry.thumbnailUrl;
      } else if (entry.previewUrl && entry.kind === "image") {
        thumbUrl = entry.previewUrl;
      }

      const statusLabel = isActiveTarget ? (pausedTargets.active ? t('media.inPreview') : t('media.live')) : null;
      const statusVariant = isActiveTarget ? (pausedTargets.active ? "preview" : "live") : null;

      const handleCardClick = () => {
        if (isLocked) {
          if (entry.kind === "audio") {
            showUpgradeModal(
              isAudioLocked
                ? "Audio library and playback are available on Basic and Growth plans. Upgrade to unlock."
                : "Free plans allow one audio file. Upgrade to use more audio files."
            );
          } else {
            void requireEntitlement(
              entry.kind === "video" ? "videos" : "images",
              entry.kind === "video" ? videoEntries.length : imageEntries.length,
            );
          }
          return;
        }
        if (canSelect) toggleSelectKey(entry.key);
        else void handleSendEntry(entry);
      };

      const handleCardKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardClick();
        }
      };

      return (
        <div
          key={entry.key}
          className={`dock-media-gallery-card${isActiveTarget ? " dock-media-gallery-card--active" : ""}${isSelected ? " dock-media-gallery-card--selected" : ""}${isLocked ? " dock-media-gallery-card--locked" : ""}${prefs.pinned ? " dock-media-gallery-card--pinned" : ""}`}
          role="button"
          tabIndex={0}
          onClick={handleCardClick}
          onKeyDown={handleCardKeyDown}
          onContextMenu={(event) => openMediaContextMenu(event, entry, isLocked)}
        >
          <div className="dock-media-gallery-card__image-wrap">
            {canSelect && !isLocked && (
              <span className={`dock-media-gallery-card__checkbox${isSelected ? " dock-media-gallery-card__checkbox--checked" : ""}`}>
                {isSelected ? <Icon name="check" size={10} /> : null}
              </span>
            )}
            {thumbUrl ? (
              <img src={thumbUrl} alt={displayName} loading="lazy" className="dock-media-gallery-card__image" />
            ) : entry.previewUrl && entry.kind === "video" ? (
              <video src={entry.previewUrl} className="dock-media-gallery-card__image" muted playsInline preload="metadata" />
            ) : (
              <div className="dock-media-gallery-card__placeholder">
                <Icon name={getFileIcon(entry.kind)} size={24} />
              </div>
            )}
            {prefs.pinned && !isLocked && (
              <span
                className="dock-media-gallery-card__pin-badge"
                title={t('media.pinned', 'Pinned')}
                aria-label={t('media.pinned', 'Pinned')}
              >
                <Icon name="push_pin" size={11} />
              </span>
            )}
            {isLocked ? (
              <div className="dock-media-gallery-card__lock-overlay">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span className="dock-media-gallery-card__lock-label">{t('media.upgradeToAccess')}</span>
              </div>
            ) : (
              <div className="dock-media-gallery-card__overlay">
                {!canSelect && (
                  <div className="dock-media-gallery-card__overlay-top">
                    <button
                      type="button"
                      className="dock-media-gallery-card__menu-btn"
                      aria-label={downloadingMediaKey === entry.key ? t('media.downloadProgress', 'Downloading…') : t('media.downloadAsset', { fileName: displayName })}
                      onClick={(event) => {
                        event.stopPropagation();
                        void downloadMediaEntry(entry);
                      }}
                      title={downloadingMediaKey === entry.key ? t('media.downloadProgress', 'Downloading…') : t('media.downloadAsset', { fileName: displayName })}
                      disabled={downloadingMediaKey === entry.key}
                    >
                      <Icon
                        name={downloadingMediaKey === entry.key ? "downloading" : "download"}
                        size={14}
                        style={{ animation: downloadingMediaKey === entry.key ? "spin 1s linear infinite" : undefined }}
                      />
                    </button>
                    <button
                      type="button"
                      className="dock-media-gallery-card__menu-btn"
                      aria-label={t('media.moreOptions')}
                      onClick={(event) => openMediaContextMenu(event, entry, isLocked)}
                      title={t('media.moreOptions')}
                    >
                      <Icon name="more_vert" size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="dock-media-gallery-card__meta">
            <span className="dock-media-gallery-card__name">{displayName}</span>
            <div className="dock-media-gallery-card__meta-row">
              <span className="dock-media-gallery-card__type-badge">{entry.mimeLabel || (entry.kind === "video" ? "VID" : entry.kind === "audio" ? "AUD" : "IMG")}</span>
              {entry.durationSec ? (
                <span className="dock-media-gallery-card__duration">
                  <Icon name={entry.kind === "audio" ? "music_note" : "movie"} size={10} />
                  {fmtDuration(entry.durationSec)}
                </span>
              ) : null}
            </div>
          </div>
          {statusLabel && (
            <span className={`dock-media-gallery-card__status-chip dock-media-gallery-card__status-chip--${statusVariant}`}>
              {statusLabel}
            </span>
          )}
        </div>
      );
    },
    [
      activeTargets.active,
      downloadMediaEntry,
      downloadingMediaKey,
      getEntryPrefs,
      handleSendEntry,
      imageEntries.length,
      lockedKeys,
      openMediaContextMenu,
      pausedTargets.active,
      selectedKeys,
      selectionMode,
      t,
      toggleSelectKey,
      videoEntries.length,
    ]
  );

  const renderSavedTemplateCard = useCallback((entry: DockMediaEntry) => {
    const isActiveTarget = activeTargets.active?.key === entry.key;
    const isSending = sendingFile === `library:${entry.libraryItem?.id}`;
    const statusLabel = isActiveTarget ? (pausedTargets.active ? t('media.inPreview') : t('media.live')) : null;
    const statusVariant = isActiveTarget ? (pausedTargets.active ? "preview" : "live") : null;

    const showInObs = () => { void handleSendEntry(entry); };
    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showInObs();
      }
    };

    return (
      <div
        key={entry.key}
        className={`dock-media-gallery-card${isActiveTarget ? " dock-media-gallery-card--active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={showInObs}
        onKeyDown={handleKeyDown}
        aria-label={`${entry.name}. Click to show in OBS.`}
      >
        <div className="dock-media-gallery-card__image-wrap">
          {entry.previewUrl || entry.thumbnailUrl ? (
            <img src={entry.previewUrl || entry.thumbnailUrl} alt={entry.name} loading="lazy" className="dock-media-gallery-card__image" />
          ) : (
            <div className="dock-media-gallery-card__placeholder">
              <Icon name="collections" size={24} />
            </div>
          )}
          <div className="dock-media-gallery-card__overlay">
            <div className="dock-media-gallery-card__overlay-top">
              <button
                type="button"
                className="dock-media-gallery-card__menu-btn"
                aria-label={downloadingMediaKey === entry.key ? t('media.downloadProgress', 'Downloading…') : t('media.downloadAsset', { fileName: entry.name })}
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadMediaEntry(entry);
                }}
                title={downloadingMediaKey === entry.key ? t('media.downloadProgress', 'Downloading…') : t('media.downloadAsset', { fileName: entry.name })}
                disabled={downloadingMediaKey === entry.key}
              >
                <Icon
                  name={downloadingMediaKey === entry.key ? "downloading" : "download"}
                  size={14}
                  style={{ animation: downloadingMediaKey === entry.key ? "spin 1s linear infinite" : undefined }}
                />
              </button>
            </div>
            <div className="dock-media-gallery-card__overlay-center">
              <button
                type="button"
                className="dock-media-gallery-card__preview-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewEntry(entry);
                }}
              >
                <Icon name="visibility" size={13} />
                {t('common.preview')}
              </button>
            </div>
          </div>
          <span className="dock-media-gallery-card__type-badge">TEMPLATE</span>
        </div>
        <div className="dock-media-gallery-card__meta">
          <span className="dock-media-gallery-card__name">{entry.name}</span>
          <div className="dock-media-gallery-card__meta-row">
            <span className="dock-media-gallery-card__duration">
              <Icon name={isSending ? "hourglass_top" : "send"} size={10} />
              {isSending ? t('media.sending') : "Show in OBS"}
            </span>
          </div>
        </div>
        {statusLabel && (
          <span className={`dock-media-gallery-card__status-chip dock-media-gallery-card__status-chip--${statusVariant}`}>
            {statusLabel}
          </span>
        )}
      </div>
    );
  }, [activeTargets.active, downloadMediaEntry, downloadingMediaKey, handleSendEntry, pausedTargets.active, sendingFile, t]);

  const renderDocumentCard = useCallback(
    (deck: DockDocumentDeck) => {
      const isActiveTarget = deck.pages.some((page) => activeTargets.active?.key === page.key);
      const isLocked = isFreePlan && deck.pages.every((page) => lockedKeys.has(page.key));
      const importedDate = deck.createdAt ? new Date(deck.createdAt) : null;
      const importedLabel = importedDate && !Number.isNaN(importedDate.getTime())
        ? importedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "Date unavailable";
      const coverUrl = deck.coverPage?.thumbnailUrl || deck.coverPage?.previewUrl || "";

      const handleOpen = () => {
        if (isLocked) {
          void requireEntitlement("images", documentEntries.length);
          return;
        }
        openDocumentDeck(deck);
      };

      return (
        <article
          key={deck.key}
          className={`dock-document-card${isActiveTarget ? " dock-document-card--active" : ""}${isLocked ? " dock-document-card--locked" : ""}`}
        >
          <button
            type="button"
            className="dock-document-card__main"
            onClick={handleOpen}
            title={isLocked ? t('common.locked') : `Open ${deck.name}`}
          >
            <span className="dock-document-card__cover">
              {coverUrl ? (
                <img src={coverUrl} alt={`${deck.name} first page`} loading="lazy" />
              ) : (
                <span className="dock-document-card__cover-placeholder"><Icon name="description" size={28} /></span>
              )}
              <span className="dock-document-card__page-count">
                <Icon name="description" size={11} />
                {deck.pageCount} {deck.pageCount === 1 ? "page" : "pages"}
              </span>
              {isLocked && (
                <span className="dock-document-card__lock">
                  <Icon name="lock" size={14} />
                  {t('media.upgradeToAccess')}
                </span>
              )}
            </span>
            <span className="dock-document-card__meta">
              <span className="dock-document-card__name">{deck.name}</span>
              <span className="dock-document-card__details">
                {deck.mimeLabel} · Imported {importedLabel}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="dock-document-card__delete"
            onClick={(event) => {
              event.stopPropagation();
              void deleteDocumentDeck(deck);
            }}
            aria-label={`Delete ${deck.name}`}
            title={`Delete ${deck.name}`}
          >
            <Icon name="delete" size={13} />
          </button>
          {isActiveTarget && (
            <span className="dock-document-card__status">
              <Icon name="visibility" size={11} />
              {t('media.showing')}
            </span>
          )}
        </article>
      );
    },
    [activeTargets.active, deleteDocumentDeck, documentEntries.length, isFreePlan, lockedKeys, openDocumentDeck, t],
  );

  const renderTemplatePictureTile = (asset: TemplatePictureAsset) => {
    const downloadedItem = findDownloadedTemplatePicture(asset);
    const progressFraction = templatePictureProgress[asset.id];
    const downloading = progressFraction !== undefined;
    const progressPercent = progressFraction != null ? Math.round(progressFraction * 100) : null;
    const progressLabel = progressPercent != null
      ? `${progressPercent}%`
      : t('media.preparing');

    return (
      <div
        key={asset.id}
        className={`dock-animation-tile${downloadedItem ? " dock-animation-tile--downloaded" : ""}${downloading ? " dock-animation-tile--downloading" : ""}`}
      >
        {downloadedItem ? (
          <div
            className="dock-animation-tile__thumb dock-animation-tile__thumb--playable"
            role="button"
            tabIndex={0}
            aria-label={`${t('common.play')}: ${asset.fileName}`}
            title={`${t('common.play')}: ${asset.fileName}`}
            onClick={() => playDownloadedTemplatePicture(downloadedItem)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                playDownloadedTemplatePicture(downloadedItem);
              }
            }}
          >
            <img src={getMediaPreviewUrl(downloadedItem, overlayBaseUrl)} alt={asset.fileName} loading="lazy" className="dock-animation-tile__img" />
            <div className="dock-animation-tile__play-hint">
              <Icon name="play_arrow" size={22} />
            </div>
            <div className="dock-animation-tile__gradient" />
            <div className="dock-animation-tile__info">
              <span className="dock-animation-tile__name">{asset.fileName}</span>
              <span className="dock-animation-tile__meta">{formatFileSize(asset.size)}</span>
            </div>
          </div>
        ) : (
          <div
            className={`dock-animation-tile__thumb dock-animation-tile__thumb--clickable${downloading ? " dock-animation-tile__thumb--busy" : ""}`}
            role="button"
            tabIndex={downloading ? -1 : 0}
            aria-label={downloading ? t('media.downloadingProgress', { progress: progressLabel }) : `${t('media.downloadAsset', 'Download')}: ${asset.fileName}`}
            title={downloading ? t('media.downloadingProgress', { progress: progressLabel }) : `${t('media.downloadAsset', 'Download')}: ${asset.fileName}`}
            onClick={() => {
              if (!downloading) void handleDownloadTemplatePicture(asset);
            }}
            onKeyDown={(event) => {
              if (!downloading && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                void handleDownloadTemplatePicture(asset);
              }
            }}
          >
            {asset.imageUrl ? (
              <img src={asset.imageUrl} alt={asset.fileName} loading="lazy" className="dock-animation-tile__img" />
            ) : (
              <div className="dock-animation-tile__placeholder"><Icon name="image" size={20} /></div>
            )}
            {!downloading && (
              <div className="dock-animation-tile__download-hint">
                <span className="dock-animation-tile__download-hint-badge">
                  <Icon name="download" size={13} />
                  {t('media.downloadTemplate', 'Download')}
                </span>
              </div>
            )}
            <div className="dock-animation-tile__gradient" />
            <div className="dock-animation-tile__info">
              <span className="dock-animation-tile__name">{asset.fileName}</span>
              <span className="dock-animation-tile__meta">{formatFileSize(asset.size) || t('media.templatePictures', 'Picture')}</span>
            </div>
          </div>
        )}

        {downloading && (
          <div
            className="dock-animation-tile__download-overlay"
            role="progressbar"
            aria-valuenow={progressPercent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('media.downloadingProgress', { progress: progressLabel })}
          >
            <div className="dock-animation-tile__progress-ring-wrap">
              <svg className="dock-animation-tile__progress-ring" viewBox="0 0 36 36">
                <path
                  className="dock-animation-tile__progress-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  strokeWidth="3.2"
                />
                <path
                  className={`dock-animation-tile__progress-ring-bar${progressPercent == null ? " dock-animation-tile__progress-ring-bar--indeterminate" : ""}`}
                  strokeDasharray={`${progressPercent ?? 28}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  strokeWidth="3.2"
                />
              </svg>
              <div className="dock-animation-tile__progress-ring-text">
                {progressPercent != null && progressPercent > 0 ? (
                  `${progressPercent}%`
                ) : (
                  <Icon name="cloud_download" size={16} />
                )}
              </div>
            </div>
            <span className="dock-animation-tile__download-status">
              {progressPercent == null || progressPercent === 0
                ? t('media.preparing')
                : progressPercent >= 100
                  ? t('media.savingToLibrary', 'Saving…')
                  : `${t('media.downloadProgress', 'Downloading…')} ${progressPercent}%`}
            </span>
            <div className="dock-animation-tile__progress-track">
              <div
                className={`dock-animation-tile__progress-fill${progressPercent == null ? " dock-animation-tile__progress-fill--indeterminate" : ""}`}
                style={{ width: progressPercent != null ? `${progressPercent}%` : undefined }}
              />
            </div>
          </div>
        )}

        {downloadedItem && (
          <span className="dock-animation-tile__downloaded-label" role="status">
            <Icon name="check_circle" size={10} />
            {t('media.downloaded')}
          </span>
        )}
        <button
          type="button"
          className="dock-animation-tile__dl-btn"
          aria-label={downloadedItem ? t('media.isAlreadySaved', { fileName: asset.fileName }) : t('media.downloadAsset', { fileName: asset.fileName })}
          title={downloadedItem ? t('media.alreadySavedToAnimations') : downloading ? t('media.downloadingProgress', { progress: progressLabel }) : t('media.downloadTemplatePicture', 'Download picture')}
          disabled={downloading || Boolean(downloadedItem)}
          onClick={(e) => {
            e.stopPropagation();
            void handleDownloadTemplatePicture(asset);
          }}
        >
          <Icon
            name={downloadedItem ? "check_circle" : downloading ? "downloading" : "download"}
            size={13}
            style={{ animation: downloading ? "spin 1s linear infinite" : undefined }}
          />
        </button>
      </div>
    );
  };

  const renderTemplateVideoTile = (asset: TemplateVideoAsset) => {
    const downloadedItem = findDownloadedTemplateVideo(asset);
    const progressFraction = templateVideoProgress[asset.id];
    const downloading = progressFraction !== undefined;
    const progressPercent = progressFraction != null ? Math.round(progressFraction * 100) : null;
    const progressLabel = progressPercent != null
      ? `${progressPercent}%`
      : t('media.preparing');

    return (
      <div
        key={asset.id}
        className={`dock-animation-tile${downloadedItem ? " dock-animation-tile--downloaded" : ""}${downloading ? " dock-animation-tile--downloading" : ""}`}
      >
        {downloadedItem ? (
          <div
            className="dock-animation-tile__thumb dock-animation-tile__thumb--playable"
            role="button"
            tabIndex={0}
            aria-label={`${t('common.play')}: ${asset.fileName}`}
            title={`${t('common.play')}: ${asset.fileName}`}
            onClick={() => playDownloadedTemplateVideo(downloadedItem)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                playDownloadedTemplateVideo(downloadedItem);
              }
            }}
          >
            {downloadedItem.thumbnailUrl ? (
              <img src={downloadedItem.thumbnailUrl} alt={asset.fileName} loading="lazy" className="dock-animation-tile__img" />
            ) : (
              <video src={getMediaPreviewUrl(downloadedItem, overlayBaseUrl)} className="dock-animation-tile__img" muted playsInline preload="metadata" />
            )}
            <div className="dock-animation-tile__play-hint"><Icon name="play_arrow" size={22} /></div>
            <div className="dock-animation-tile__gradient" />
            <div className="dock-animation-tile__info">
              <span className="dock-animation-tile__name">{asset.fileName}</span>
              <span className="dock-animation-tile__meta">{downloadedItem.durationSec ? fmtDuration(downloadedItem.durationSec) : formatFileSize(asset.size)}</span>
            </div>
          </div>
        ) : (
          <div
            className={`dock-animation-tile__thumb dock-animation-tile__thumb--clickable${downloading ? " dock-animation-tile__thumb--busy" : ""}`}
            role="button"
            tabIndex={downloading ? -1 : 0}
            aria-label={downloading ? t('media.downloadingProgress', { progress: progressLabel }) : `${t('media.downloadAsset', 'Download')}: ${asset.fileName}`}
            title={downloading ? t('media.downloadingProgress', { progress: progressLabel }) : `${t('media.downloadAsset', 'Download')}: ${asset.fileName}`}
            onClick={() => {
              if (!downloading) void handleDownloadTemplateVideo(asset);
            }}
            onKeyDown={(event) => {
              if (!downloading && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                void handleDownloadTemplateVideo(asset);
              }
            }}
          >
            <AnimationTilePreview src={asset.videoUrl} label={asset.fileName} />
            {!downloading && (
              <div className="dock-animation-tile__download-hint">
                <span className="dock-animation-tile__download-hint-badge">
                  <Icon name="download" size={13} />
                  {t('media.downloadTemplate', 'Download')}
                </span>
              </div>
            )}
            <div className="dock-animation-tile__gradient" />
            <div className="dock-animation-tile__info">
              <span className="dock-animation-tile__name">{asset.fileName}</span>
              <span className="dock-animation-tile__meta">{formatFileSize(asset.size)}</span>
            </div>
          </div>
        )}

        {downloading && (
          <div
            className="dock-animation-tile__download-overlay"
            role="progressbar"
            aria-valuenow={progressPercent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('media.downloadingProgress', { progress: progressLabel })}
          >
            <div className="dock-animation-tile__progress-ring-wrap">
              <svg className="dock-animation-tile__progress-ring" viewBox="0 0 36 36">
                <path
                  className="dock-animation-tile__progress-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  strokeWidth="3.2"
                />
                <path
                  className={`dock-animation-tile__progress-ring-bar${progressPercent == null ? " dock-animation-tile__progress-ring-bar--indeterminate" : ""}`}
                  strokeDasharray={`${progressPercent ?? 28}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  strokeWidth="3.2"
                />
              </svg>
              <div className="dock-animation-tile__progress-ring-text">
                {progressPercent != null && progressPercent > 0 ? (
                  `${progressPercent}%`
                ) : (
                  <Icon name="cloud_download" size={16} />
                )}
              </div>
            </div>
            <span className="dock-animation-tile__download-status">
              {progressPercent == null || progressPercent === 0
                ? t('media.preparing')
                : progressPercent >= 100
                  ? t('media.savingToLibrary', 'Saving…')
                  : `${t('media.downloadProgress', 'Downloading…')} ${progressPercent}%`}
            </span>
            <div className="dock-animation-tile__progress-track">
              <div
                className={`dock-animation-tile__progress-fill${progressPercent == null ? " dock-animation-tile__progress-fill--indeterminate" : ""}`}
                style={{ width: progressPercent != null ? `${progressPercent}%` : undefined }}
              />
            </div>
          </div>
        )}

        {downloadedItem && (
          <span className="dock-animation-tile__downloaded-label" role="status">
            <Icon name="check_circle" size={10} />
            {t('media.downloaded')}
          </span>
        )}
        <button
          type="button"
          className="dock-animation-tile__dl-btn"
          aria-label={downloadedItem ? t('media.isAlreadySaved', { fileName: asset.fileName }) : t('media.downloadAsset', { fileName: asset.fileName })}
          title={downloadedItem ? t('media.alreadySavedToAnimations') : downloading ? t('media.downloadingProgress', { progress: progressLabel }) : t('media.downloadTemplateVideo')}
          disabled={downloading || Boolean(downloadedItem)}
          onClick={(e) => {
            e.stopPropagation();
            void handleDownloadTemplateVideo(asset);
          }}
        >
          <Icon
            name={downloadedItem ? "check_circle" : downloading ? "downloading" : "download"}
            size={13}
            style={{ animation: downloading ? "spin 1s linear infinite" : undefined }}
          />
        </button>
      </div>
    );
  };

  const searchPlaceholder = browserTab === "animations"
    ? t('media.searchAnimations')
    : browserTab === "templates"
      ? "Search saved templates"
    : browserTab === "patterns"
      ? t('media.searchTemplates')
      : t('media.searchPlaceholderShort');

  const updateOverlayFontSize = (
    key: "headlineSize" | "sublineSize",
    nextValue: number,
    min: number,
    max: number,
  ) => {
    const clamped = clampNumber(nextValue, min, max, min);
    setTextOverlay((current) => ({ ...current, [key]: clamped }));
  };

  const renderOverlayTextSizeControl = (
    key: "headlineSize" | "sublineSize",
    value: number,
    min: number,
    max: number,
    presets: readonly DockTextSizePreset[],
    label: string,
  ) => {
    const selectedPreset = getClosestTextSizePreset(value, presets);

    return (
      <div className="dock-overlay-size-control">
        <label className="dock-overlay-size-control__header" htmlFor={`dock-overlay-size-${key}`}>
          <span>{label}</span>
        </label>
        <div className="dock-overlay-size-control__select-wrap">
          <select
            id={`dock-overlay-size-${key}`}
            className="dock-overlay-size-control__select"
            value={selectedPreset.id}
            onChange={(e) => {
              const matched = presets.find((p) => p.id === e.target.value);
              if (matched) {
                updateOverlayFontSize(key, matched.value, min, max);
              }
            }}
            aria-label={label}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(preset.labelKey)}
              </option>
            ))}
          </select>
          <Icon name="expand_more" size={16} className="dock-overlay-size-control__select-arrow" />
        </div>
      </div>
    );
  };

  const renderOverlayPreview = () => (
    <div className="dock-overlay-canvas">
      <div className="dock-overlay-canvas__bg">
        {previewBaseEntry?.kind === "image" && previewBaseEntry.previewUrl ? (
          <img src={previewBaseEntry.previewUrl} alt="" />
        ) : previewBaseEntry?.thumbnailUrl ? (
          <img src={previewBaseEntry.thumbnailUrl} alt="" />
        ) : previewBaseEntry?.previewUrl ? (
          <video src={previewBaseEntry.previewUrl} muted playsInline preload="metadata" />
        ) : (
          <div className="dock-overlay-canvas__placeholder">
            <Icon name="theaters" size={24} />
          </div>
        )}
      </div>

      {textOverlay.background.enabled && textOverlay.background.mode !== "text-only" && (
        <div className={`dock-overlay-canvas__bg-preview dock-overlay-canvas__bg-preview--${textOverlay.background.mode}`}>
          {(() => {
            const bg = textOverlay.background;
            let bgImageStyle = "none";
            if (bg.bgType === "image" && bg.imageId) {
              const img = localLibrary.find((item) => item.id === bg.imageId && item.type === "image");
              if (img) bgImageStyle = `url("${img.thumbnailUrl || img.url}")`;
            } else if (bg.bgType === "pattern" && bg.patternId) {
              const pat = BACKGROUND_PATTERNS.find((p) => p.label === bg.patternId);
              if (pat) bgImageStyle = `url("${pat.src}")`;
            }
            return (
              <div
                className="dock-overlay-canvas__bg-fill"
                style={{
                  backgroundColor: bg.color,
                  backgroundImage: bgImageStyle !== "none" ? bgImageStyle : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  opacity: bg.opacity,
                  filter: bg.blur > 0 ? `blur(${Math.min(bg.blur / 2, 8)}px)` : undefined,
                  borderRadius: bg.mode === "lower-third" ? `${bg.radius}px ${bg.radius}px 0 0` : bg.mode === "box" ? `${bg.radius}px` : "0",
                }}
              />
            );
          })()}
        </div>
      )}

      <div className="dock-overlay-canvas__guides">
        <div className="dock-overlay-canvas__guide--h" />
        <div className="dock-overlay-canvas__guide--v" />
        <div className="dock-overlay-canvas__corner dock-overlay-canvas__corner--tl" />
        <div className="dock-overlay-canvas__corner dock-overlay-canvas__corner--tr" />
        <div className="dock-overlay-canvas__corner dock-overlay-canvas__corner--bl" />
        <div className="dock-overlay-canvas__corner dock-overlay-canvas__corner--br" />
      </div>

      <div
        className={`dock-overlay-canvas__text ${getAnimationClass()}`}
        style={{ ...getVerticalPosStyle(), "--overlay-anim-duration": `${textOverlay.animationDuration}s`, color: textOverlay.textColor } as React.CSSProperties}
      >
        <div className={`dock-overlay-canvas__text-inner dock-overlay-canvas__text-inner--${textOverlay.align}`}>
          {textOverlay.headline.trim() && (
            <div
              className="dock-overlay-canvas__headline"
              style={{ fontSize: `${Math.max(12, Math.min(48, Math.round(textOverlay.headlineSize / 5)))}px` }}
            >
              {textOverlay.headline}
            </div>
          )}
          {textOverlay.subline.trim() && (
            <div
              className="dock-overlay-canvas__subline"
              style={{ fontSize: `${Math.max(10, Math.min(36, Math.round(textOverlay.sublineSize / 6)))}px` }}
            >
              {textOverlay.subline}
            </div>
          )}
          {!textOverlay.headline.trim() && !textOverlay.subline.trim() && (
            <div className="dock-overlay-canvas__empty-hint">{t('media.overlayTextPlaceholder')}</div>
          )}
        </div>
      </div>

      <div className="dock-overlay-canvas__controls">
        <span className="dock-overlay-canvas__safe-badge">
          <Icon name="crop_free" size={10} />
          {t('media.safeArea')}
        </span>
      </div>
    </div>
  );

  const hasVisibleDocumentDecks = (activeKinds.length === 0 || activeKinds.includes("document")) && filteredDocumentDecks.length > 0;
  const hasVisibleMediaEntries = filteredUploadEntries.length > 0;
  const mediaKindOptions: Array<{ id: DockMediaFilterKind; label: string; count: number; locked?: boolean }> = [
    { id: "video", label: t('media.tabVideos'), count: videoEntries.length },
    { id: "image", label: t('media.tabImages'), count: imageEntries.length },
    { id: "audio", label: "Audio", count: audioEntries.length, locked: isAudioLocked },
    { id: "document", label: "Docs", count: documentDecks.length },
  ];
  const mediaFilterSummary = activeKinds.length === 0
    ? t('media.all')
    : activeKinds.length <= 2
      ? mediaKindOptions.filter((option) => activeKinds.includes(option.id)).map((option) => option.label).join(", ")
      : `${activeKinds.length} ${t('media.types', 'types')}`;
  const mediaFilterCount = filteredUploadEntries.length + (hasVisibleDocumentDecks ? filteredDocumentDecks.length : 0);
  const activeKindSearchLabel = activeKind === "audio"
    ? "audio"
    : activeKind === "video"
      ? "videos"
      : activeKind === "image"
        ? "images"
        : activeKind === "document"
          ? "documents"
          : "media";

  const renderSearchEmptyNotice = (
    label: string,
    onClear: () => void = () => setAssetSearch(""),
    query = assetSearch,
  ) => (
    <div
      className="dock-empty__search-notice"
      style={{
        display: "grid",
        gap: "6px",
        textAlign: "center",
        padding: "14px 8px",
        alignItems: "center",
        justifyItems: "center",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "12px", color: "var(--dock-text, #f8fafc)" }}>
        No {label} match "{query.trim()}".
      </div>
      <div style={{ fontWeight: 700, fontSize: "11px", color: "var(--dock-text-dim, #94a3b8)", lineHeight: "1.4" }}>
        This is because you searched for a term. Clear your search or search for something else.
      </div>
      <button
        type="button"
        className="dock-btn dock-btn--sm dock-btn--secondary"
        onClick={onClear}
        style={{
          fontWeight: 700,
          fontSize: "11px",
          padding: "4px 12px",
          marginTop: "4px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <Icon name="close" size={12} />
        Clear search
      </button>
    </div>
  );
  const useCompactMediaTabs = isNarrowWidth || isCompactHeight;
  const renderCompactMediaActions = () => (
    <div className="dock-media-search-row__actions">
      <button
        type="button"
        className="dock-console-toggle dock-console-toggle--primary dock-console-toggle--icon-only"
        onClick={() => {
          if (browserTab === "animations") {
            openAddMediaModal("template-videos");
          } else {
            uploadInputRef.current?.click();
          }
        }}
        disabled={uploading || (browserTab !== "uploads" && browserTab !== "animations") || (browserTab === "animations" && animationsLocked)}
        title={
          browserTab === "animations"
            ? animationsLocked ? t('media.upgradeToAccess') : t('common.add')
            : browserTab !== "uploads"
              ? t('media.uploadRestricted')
              : uploading ? t('media.preparing') : t('media.addMedia')
        }
        aria-label={
          browserTab === "animations"
            ? animationsLocked ? t('media.upgradeToAccess') : t('common.add')
            : browserTab !== "uploads"
              ? t('media.uploadRestricted')
              : uploading ? t('media.preparing') : t('media.addMedia')
        }
      >
        <Icon name="add" size={14} />
      </button>
      {!isUltraCompactHeight && (
        <button
          type="button"
          className={`dock-console-toggle dock-console-toggle--icon-only${selectionMode ? " dock-console-toggle--active" : ""}`}
          onClick={async () => {
            if (selectionMode) {
              toggleSelectionMode();
              return;
            }
            if (activeKind === "audio" && isAudioLocked) {
              showUpgradeModal("Audio playlist creation is available on Basic and Growth plans. Upgrade to unlock.");
              return;
            }
            if (activeKind !== "audio" && !(await requireEntitlement("slideshow", 0))) return;
            toggleSelectionMode();
          }}
          disabled={browserTab !== "uploads"}
          title={browserTab !== "uploads" ? t('media.slideshowRestricted') : (selectionMode ? t('media.dismiss') : activeKind === "audio" ? "Create audio playlist" : t('media.createSlideshow'))}
          aria-label={browserTab !== "uploads" ? t('media.slideshowRestricted') : (selectionMode ? t('media.dismiss') : activeKind === "audio" ? "Create audio playlist" : t('media.createSlideshow'))}
        >
          <Icon name={selectionMode ? "close" : "slideshow"} size={14} />
        </button>
      )}
    </div>
  );

  const renderMediaViewSwitch = () => {
    const views: Array<{ id: "uploads" | "animations" | "patterns"; icon: string; label: string; count: ReactNode; locked?: boolean; onPick: () => void }> = [
      { id: "uploads", icon: "perm_media", label: t('media.uploads'), count: mediaEntries.length, onPick: () => setBrowserTab("uploads") },
      { id: "animations", icon: "movie", label: t('media.tabAnimations'), count: animationsLocked ? <Icon name="lock" size={10} /> : animationCatalogCount, locked: animationsLocked, onPick: openAnimationsTab },
      { id: "patterns", icon: "grid_view", label: t('media.patterns', 'Patterns'), count: BACKGROUND_PATTERNS.length, onPick: () => setBrowserTab("patterns") },
    ];
    const current = views.find((view) => view.id === browserTab) ?? views[0];
    return (
      <div className="dock-media-viewswitch" ref={viewMenuRef}>
        <button
          type="button"
          className={`dock-media-viewswitch__trigger${viewMenuOpen ? " dock-media-viewswitch__trigger--open" : ""}`}
          onClick={() => setViewMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={viewMenuOpen}
          aria-label={t('media.mediaBrowserViews')}
          title={current.label}>
          <Icon name={current.icon} size={14} />
          <Icon name="expand_more" size={12} />
        </button>
        {viewMenuOpen && (
          <div className="dock-media-filterbar__menu dock-media-viewswitch__menu" role="menu" aria-label={t('media.mediaBrowserViews')}>
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                role="menuitemradio"
                aria-checked={browserTab === view.id}
                disabled={view.locked}
                className={`dock-media-filterbar__item${view.locked ? " dock-media-filterbar__item--locked" : ""}`}
                onClick={() => {
                  view.onPick();
                  setViewMenuOpen(false);
                }}>
                <span className={`dock-media-filterbar__radio${browserTab === view.id ? " dock-media-filterbar__radio--on" : ""}`} />
                <Icon name={view.icon} size={13} />
                <span className="dock-media-filterbar__item-label">{view.label}</span>
                <span className="dock-media-filterbar__item-count">{view.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderMediaFolderFilter = () => {
    if (mediaFolders.length === 0 || (browserTab !== "uploads" && browserTab !== "animations")) {
      return null;
    }

    return (
      <label className="dock-media-folder-filter">
        <Icon name="folder" size={12} />
        <span className="dock-media-folder-filter__label">{t('media.folder', 'Folder')}</span>
        <select
          className="dock-media-folder-filter__select"
          value={activeFolder}
          onChange={(event) => setActiveFolder(event.target.value)}
          aria-label={t('media.filterByFolder', 'Filter by folder')}
        >
          <option value="all">{t('media.allFolders', 'All folders')}</option>
          {mediaFolders.map((folder) => (
            <option key={folder} value={folder}>{folder}</option>
          ))}
        </select>
      </label>
    );
  };

  // ── Render ──



  return (
    <div ref={(node) => { tabsRef.current = node; containerRef.current = node; }} className={`dock-media-console${isCompactHeight ? " dock-media-console--short-height" : ""}${isUltraCompactHeight ? " dock-media-console--ultra-compact" : ""}${isMicroHeight ? " dock-media-console--micro" : ""}`}>
      {/* ── Header (normal mode only) ── */}
      {!isCompactHeight && (
        <div className="dock-media-header">
          <div className="dock-media-header__left">
            <span className="dock-media-header__label">{t('media.title')}</span>
          </div>
          <div className="dock-media-header__actions">
            <button
              type="button"
              className="dock-console-toggle dock-console-toggle--primary dock-console-toggle--icon-only"
              onClick={() => {
                if (browserTab === "animations") {
                  openAddMediaModal("template-videos");
                } else {
                  uploadInputRef.current?.click();
                }
              }}
              disabled={uploading || (browserTab !== "uploads" && browserTab !== "animations") || (browserTab === "animations" && animationsLocked)}
              title={
                browserTab === "animations"
                  ? animationsLocked ? t('media.upgradeToAccess') : t('common.add')
                  : browserTab !== "uploads"
                    ? t('media.uploadRestricted')
                    : uploading ? t('media.preparing') : t('media.addMedia')
              }
              aria-label={t('media.addMedia')}
            >
              <Icon name="add" size={14} />
            </button>
            <button
              type="button"
              className={`dock-console-toggle dock-console-toggle--icon-only${selectionMode ? " dock-console-toggle--active" : ""}`}
              onClick={async () => {
                // Allow cancelling selection mode without entitlement check
                if (selectionMode) {
                  toggleSelectionMode();
                  return;
                }
                if (activeKind === "audio" && isAudioLocked) {
                  showUpgradeModal("Audio playlist creation is available on Basic and Growth plans. Upgrade to unlock.");
                  return;
                }
                if (activeKind !== "audio" && !(await requireEntitlement("slideshow", 0))) return;
                toggleSelectionMode();
              }}
              disabled={browserTab !== "uploads"}
              title={browserTab !== "uploads" ? t('media.slideshowRestricted') : (selectionMode ? t('media.dismiss') : activeKind === "audio" ? "Create audio playlist" : t('media.createSlideshow'))}
              aria-label={selectionMode ? t('media.dismiss') : t('media.createSlideshow')}
            >
              <Icon name={selectionMode ? "close" : "slideshow"} size={14} />
            </button>
          </div>
        </div>
      )}

      <input
        ref={uploadInputRef}
        type="file"
        className="dock-media-upload-input"
        multiple
        onChange={(event) => {
          const files = event.target.files;
          console.log("[UPLOAD] File picker changed", { count: files?.length ?? 0 });
          if (files?.length) {
            for (let i = 0; i < files.length; i++) {
              console.log(`[UPLOAD] File ${i}:`, { name: files[i].name, type: files[i].type, size: files[i].size });
            }
            void handleUploadFiles(files);
          }
        }}
      />

      <div className="dock-media-content-layout">
        <aside className="dock-media-tabs-column" aria-label={t('media.mediaBrowserViews')}>
      {/* ── Category Tabs (with inline actions in compact mode) ── */}
      <div className={`dock-media-tabs-row${isCompactHeight ? " dock-media-tabs-row--compact" : ""}`}>
        <div className={`dock-media-tabs${useCompactMediaTabs ? " dock-media-tabs--compact" : ""}`} role="tablist" aria-orientation={isCompactHeight ? "vertical" : "horizontal"} aria-label={t('media.mediaBrowserViews')}>
          <button
            type="button"
            role="tab"
            aria-selected={browserTab === "uploads"}
            className={`dock-media-tab ${browserTab === "uploads" ? "dock-media-tab--active" : ""}`}
            onClick={() => setBrowserTab("uploads")}
            title={t('media.uploads')}
            aria-label={t('media.uploads')}
          >
            <Icon name="perm_media" size={14} />
            <span className="dock-media-tab__label">{t('media.uploads')}</span>
            <span className="dock-media-tab__count">{mediaEntries.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={browserTab === "animations"}
            className={`dock-media-tab ${browserTab === "animations" ? "dock-media-tab--active" : ""}${animationsLocked ? " dock-media-tab--locked" : ""}`}
            onClick={openAnimationsTab}
            disabled={animationsLocked}
            title={animationsLocked ? t('media.upgradeToAccess') : t('media.tabAnimations')}
            aria-label={t('media.tabAnimations')}
          >
            <Icon name="movie" size={14} />
            <span className="dock-media-tab__label">{t('media.tabAnimations')}</span>
            <span className="dock-media-tab__count">{animationsLocked ? <Icon name="lock" size={10} /> : animationCatalogCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={browserTab === "patterns"}
            className={`dock-media-tab ${browserTab === "patterns" ? "dock-media-tab--active" : ""}`}
            onClick={() => setBrowserTab("patterns")}
            title={t('media.patterns', 'Patterns')}
            aria-label={t('media.patterns', 'Patterns')}
          >
            <Icon name="grid_view" size={14} />
            <span className="dock-media-tab__label">{t('media.patterns', 'Patterns')}</span>
            <span className="dock-media-tab__count">{BACKGROUND_PATTERNS.length}</span>
          </button>
          {/* The Text overlay tab was retired. Its OBS source is removed by services/retiredMceSources.ts. */}
        </div>
      </div>

        </aside>
        <div className="dock-media-content-main">
      {/* ── Search Bar (collapsible) ── */}
      {browserTab !== "text" && (
        <div className={`dock-media-search-row${isCompactHeight ? " dock-media-search-row--compact" : ""}`}>
          {isCompactHeight && renderMediaViewSwitch()}
          <div
            role={searchOpen ? undefined : "button"}
            tabIndex={searchOpen ? undefined : 0}
            onClick={() => {
              if (!searchOpen) {
                setSearchOpen(true);
              } else {
                searchInputRef.current?.focus();
              }
            }}
            onKeyDown={(e) => {
              if (!searchOpen && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                setSearchOpen(true);
              }
            }}
            className="dock-media-search"
            style={{ cursor: searchOpen ? "text" : "pointer", userSelect: searchOpen ? "auto" : "none" }}
            title={searchOpen ? undefined : "Expand search"}
          >
            {searchOpen ? (
              <button
                type="button"
                style={{ background: "none", border: "none", padding: 0, margin: 0, display: "inline-flex", alignItems: "center", cursor: "pointer", color: "inherit" }}
                onClick={(e) => { e.stopPropagation(); setSearchOpen(false); }}
                aria-label="Collapse search"
                title="Collapse search"
              >
                <Icon name="search" size={12} className="dock-media-search__icon" />
              </button>
            ) : (
              <Icon name="search" size={12} className="dock-media-search__icon" />
            )}
            {searchOpen && (
              <>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="dock-media-search__input"
                  value={assetSearch}
                  onChange={(event) => { event.stopPropagation(); setAssetSearch(event.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") {
                      if (assetSearch) {
                        setAssetSearch("");
                      } else {
                        setSearchOpen(false);
                      }
                    }
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  autoFocus
                />
                {assetSearch && (
                  <button
                    type="button"
                    className="dock-media-search__clear"
                    onClick={(e) => { e.stopPropagation(); setAssetSearch(""); }}
                    aria-label={t('media.clearAssetSearch')}
                    title={t('media.clearAssetSearch')}
                  >
                    <Icon name="close" size={10} />
                  </button>
                )}
              </>
            )}
          </div>
          {isCompactHeight && renderCompactMediaActions()}
        </div>
      )}

      {uploading && uploadStatus && (
        <div className="dock-media-send-error dock-media-send-error--info">
          <Icon name="hourglass_top" size={13} />
          <span>{uploadStatus}</span>
        </div>
      )}


      {/* ── Compact Status Row ── */}


      {/* ── Asset Browser ── */}
      <div className="dock-media-browser">
        {browserTab === "uploads" && (
          <>
            {mediaEntries.length === 0 && !uploadsLoading && !libraryLoading && !uploading ? (
              <div className="dock-media-empty">
                <div className="dock-media-empty__icon">
                  <Icon name="perm_media" size={24} />
                </div>
                <div className="dock-media-empty__title">{t('media.noUploads')}</div>
                <div className="dock-media-empty__text">
                  {t('media.getStartedByDownloadingPictures', 'Get started by downloading these pictures and projecting them, or add your own media.')}
                </div>
                {templatePictures.length > 0 && (
                  <div className="dock-animation-grid dock-media-empty__starter-grid">
                    {templatePictures.slice(0, 4).map(renderTemplatePictureTile)}
                  </div>
                )}
                {templatePicturesLoading && templatePictures.length === 0 && (
                  <div className="dock-empty__text">{t('media.loadingTemplatePictures', 'Loading template pictures…')}</div>
                )}
                <button
                  type="button"
                  className="dock-btn dock-btn--primary dock-btn--compact"
                  onClick={() => {
                    openAnimationsTab();
                    setAnimationCatalogTab("pictures");
                  }}
                  title={t('media.templatePictures', 'Template pictures')}>
                  <Icon name="image" size={12} />
                  {t('media.browseTemplatePictures', 'Browse template pictures')}
                </button>
                <button
                  type="button"
                  className="dock-btn dock-btn--compact"
                  onClick={() => openAddMediaModal("background")}
                  title={t('media.addMedia')}>
                  <Icon name="add" size={12} />
                  {t('media.addMedia')}
                </button>
              </div>
            ) : (
              <>
                {documentDeck ? (() => {
                  const importedDate = documentDeck.createdAt ? new Date(documentDeck.createdAt) : null;
                  const importedLabel = importedDate && !Number.isNaN(importedDate.getTime())
                    ? importedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : "Date unavailable";
                  const documentPreviewPage = documentDeck.pages[documentPageIndex] ?? documentDeck.pages[0];
                  const documentPreviewUrl = documentPreviewPage?.thumbnailUrl || documentPreviewPage?.previewUrl || "";
                  const documentPreviewNumber = documentPreviewPage?.libraryItem?.documentPageNumber ?? documentPageIndex + 1;

                  return (
                    <section className="dock-media-document-workspace">
                      <div className="dock-media-document-header">
                        <button
                          type="button"
                          className="dock-worship-back-btn"
                          onClick={closeDocumentDeck}
                          disabled={sendingDocumentPage !== null}
                          title={t('common.back')}
                        >
                          <Icon name="arrow_back" size={14} />
                        </button>
                        <div className="dock-media-document-header__copy">
                          <h2 className="dock-media-document-header__title">{documentDeck.name}</h2>
                          <span className="dock-media-document-header__meta">
                            {documentDeck.mimeLabel} · {documentDeck.pageCount} {documentDeck.pageCount === 1 ? "page" : "pages"} · Imported {importedLabel}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="dock-media-document-header__controls"
                          onClick={openDocumentControls}
                          disabled={savingDocumentControls}
                          title="Document controls"
                          aria-label="Document controls"
                        >
                          <Icon name="tune" size={14} />
                        </button>
                      </div>

                      <div className="dock-media-document-transition" role="group" aria-label="Page transition">
                        <span className="dock-media-document-transition__label">
                          <Icon name="swap_horiz" size={13} />
                          Page transition
                        </span>
                        <button
                          type="button"
                          className={`dock-media-document-transition__option${documentTransition === "cut" ? " dock-media-document-transition__option--active" : ""}`}
                          onClick={() => setDocumentTransition("cut")}
                        >
                          Cut
                        </button>
                        <button
                          type="button"
                          className={`dock-media-document-transition__option${documentTransition === "fade" ? " dock-media-document-transition__option--active" : ""}`}
                          onClick={() => setDocumentTransition("fade")}
                        >
                          Fade in/out
                        </button>
                      </div>

                      {documentControlsOpen && (
                        <div className="dock-media-document-modal-backdrop" role="presentation" onClick={closeDocumentControls}>
                          <div
                            className="dock-media-document-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="dock-document-controls-title"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="dock-media-document-modal__header">
                              <div>
                                <h3 id="dock-document-controls-title">Document controls</h3>
                                <span>{documentDeck.name}</span>
                              </div>
                              <button
                                type="button"
                                className="dock-media-document-modal__close"
                                onClick={closeDocumentControls}
                                disabled={savingDocumentControls}
                                title="Close"
                                aria-label="Close document controls"
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </div>

                            <div
                              className="dock-media-document-modal__preview"
                              style={{ background: documentDisplayDraft.showBackground ? "#0f172a" : "transparent" }}
                            >
                              {documentPreviewUrl ? (
                                <img
                                  src={documentPreviewUrl}
                                  alt={`${documentDeck.name} page ${documentPreviewNumber}`}
                                  style={{
                                    objectFit: documentDisplayDraft.fitMode === "contain" ? "contain" : "cover",
                                    objectPosition: `${documentDisplayDraft.alignment} center`,
                                    transformOrigin: `${documentDisplayDraft.alignment} center`,
                                    transform: `translate(${documentDisplayDraft.offsetX}%, ${documentDisplayDraft.offsetY}%) scale(${documentDisplayDraft.zoom})`,
                                  }}
                                />
                              ) : (
                                <Icon name="description" size={28} />
                              )}
                              {documentDisplayDraft.showPageLabel && (
                                <span className={`dock-media-document-modal__page-label dock-media-document-modal__page-label--${documentDisplayDraft.alignment}`}>
                                  Page {documentPreviewNumber} of {documentDeck.pageCount}
                                </span>
                              )}
                            </div>

                            <div className="dock-media-document-controls">
                              <div className="dock-media-document-controls__row">
                                <span className="dock-media-document-controls__label">Frame</span>
                                <div className="dock-media-document-controls__segmented" role="group" aria-label="Document frame">
                                  <button
                                    type="button"
                                    className={`dock-media-document-controls__option${documentDisplayDraft.fitMode === "contain" ? " dock-media-document-controls__option--active" : ""}`}
                                    onClick={() => setDocumentDisplayDraft((current) => ({ ...current, fitMode: "contain" }))}
                                    aria-pressed={documentDisplayDraft.fitMode === "contain"}
                                    title="Fit document"
                                  >
                                    <Icon name="fit_screen" size={12} />
                                    Fit
                                  </button>
                                  <button
                                    type="button"
                                    className={`dock-media-document-controls__option${documentDisplayDraft.fitMode === "cover" ? " dock-media-document-controls__option--active" : ""}`}
                                    onClick={() => setDocumentDisplayDraft((current) => ({ ...current, fitMode: "cover" }))}
                                    aria-pressed={documentDisplayDraft.fitMode === "cover"}
                                    title="Fill frame"
                                  >
                                    <Icon name="crop" size={12} />
                                    Fill
                                  </button>
                                </div>
                              </div>

                              <div className="dock-media-document-controls__row dock-media-document-controls__row--wrap">
                                <span className="dock-media-document-controls__label">Show</span>
                                <button
                                  type="button"
                                  className={`dock-media-document-controls__toggle${documentDisplayDraft.showBackground ? " dock-media-document-controls__toggle--active" : ""}`}
                                  onClick={() => setDocumentDisplayDraft((current) => ({ ...current, showBackground: !current.showBackground }))}
                                  aria-pressed={documentDisplayDraft.showBackground}
                                  title={documentDisplayDraft.showBackground ? "Remove background" : "Show background"}
                                >
                                  <Icon name={documentDisplayDraft.showBackground ? "visibility" : "visibility_off"} size={12} />
                                  Background
                                </button>
                                <button
                                  type="button"
                                  className={`dock-media-document-controls__toggle${documentDisplayDraft.showPageLabel ? " dock-media-document-controls__toggle--active" : ""}`}
                                  onClick={() => setDocumentDisplayDraft((current) => ({ ...current, showPageLabel: !current.showPageLabel }))}
                                  aria-pressed={documentDisplayDraft.showPageLabel}
                                  title={documentDisplayDraft.showPageLabel ? "Remove page label" : "Show page label"}
                                >
                                  <Icon name="tag" size={12} />
                                  Page label
                                </button>
                              </div>

                              <div className="dock-media-document-controls__row">
                                <span className="dock-media-document-controls__label">Align</span>
                                <div className="dock-media-document-controls__align" role="group" aria-label="Document alignment">
                                  {([
                                    ["left", "format_align_left", "Align left"],
                                    ["center", "format_align_center", "Align center"],
                                    ["right", "format_align_right", "Align right"],
                                  ] as Array<[DockDocumentAlignment, string, string]>).map(([alignment, icon, label]) => (
                                    <button
                                      key={alignment}
                                      type="button"
                                      className={`dock-media-document-controls__icon-option${documentDisplayDraft.alignment === alignment ? " dock-media-document-controls__icon-option--active" : ""}`}
                                      onClick={() => setDocumentDisplayDraft((current) => ({ ...current, alignment }))}
                                      aria-label={label}
                                      aria-pressed={documentDisplayDraft.alignment === alignment}
                                      title={label}
                                    >
                                      <Icon name={icon} size={13} />
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <label className="dock-media-document-controls__zoom">
                                <span className="dock-media-document-controls__label">Zoom <output>{documentDisplayDraft.zoom.toFixed(1)}×</output></span>
                                <input
                                  type="range"
                                  min="1"
                                  max="3"
                                  step="0.1"
                                  value={documentDisplayDraft.zoom}
                                  onChange={(event) => setDocumentDisplayDraft((current) => ({ ...current, zoom: Number(event.target.value) }))}
                                  aria-label="Document zoom"
                                />
                              </label>

                              <div className="dock-media-document-controls__position">
                                <div className="dock-media-document-controls__position-header">
                                  <span className="dock-media-document-controls__label">
                                    <Icon name="open_with" size={12} />
                                    Position
                                  </span>
                                  <button
                                    type="button"
                                    className="dock-media-document-controls__reset"
                                    onClick={resetDocumentPosition}
                                    title="Reset position to center"
                                    aria-label="Reset position to center"
                                  >
                                    <Icon name="refresh" size={12} />
                                  </button>
                                </div>
                                <div
                                  className="dock-media-document-controls__pad"
                                  onPointerDown={handleDocumentPositionPointerDown}
                                  onPointerMove={handleDocumentPositionPointerMove}
                                  onKeyDown={handleDocumentPositionKeyDown}
                                  onPointerUp={(event) => {
                                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                      event.currentTarget.releasePointerCapture(event.pointerId);
                                    }
                                  }}
                                  onPointerCancel={(event) => {
                                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                      event.currentTarget.releasePointerCapture(event.pointerId);
                                    }
                                  }}
                                  role="slider"
                                  aria-label="Drag document position"
                                  aria-valuemin={-100}
                                  aria-valuemax={100}
                                  aria-valuenow={documentDisplayDraft.offsetY}
                                  aria-valuetext={`${documentDisplayDraft.offsetX}, ${documentDisplayDraft.offsetY}`}
                                  tabIndex={0}
                                >
                                  <span className="dock-media-document-controls__pad-crosshair" />
                                  <span
                                    className="dock-media-document-controls__pad-thumb"
                                    style={{
                                      left: `${50 + documentDisplayDraft.offsetX / 2}%`,
                                      top: `${50 + documentDisplayDraft.offsetY / 2}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="dock-media-document-modal__actions">
                              <button
                                type="button"
                                className="dock-btn dock-btn--secondary dock-btn--compact"
                                onClick={closeDocumentControls}
                                disabled={savingDocumentControls}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="dock-btn dock-btn--primary dock-btn--compact"
                                onClick={() => void saveDocumentControls()}
                                disabled={savingDocumentControls || sendingDocumentPage !== null}
                              >
                                <Icon name="save" size={12} />
                                {savingDocumentControls ? "Saving…" : "Save and show"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="dock-media-document-list">
                        {documentDeck.pages.map((page, index) => {
                          const isSelected = documentPageIndex === index;
                          const isActive = activeTargets.active?.key === page.key;
                          const isLocked = isFreePlan && lockedKeys.has(page.key);
                          const pageUrl = page.thumbnailUrl || page.previewUrl || "";

                          return (
                            <button
                              type="button"
                              key={page.key}
                              className={`dock-media-document-page${isSelected ? " dock-media-document-page--selected" : ""}${isActive ? " dock-media-document-page--active" : ""}${isLocked ? " dock-media-document-page--locked" : ""}`}
                              onClick={() => void showDocumentPage(index)}
                              disabled={sendingDocumentPage !== null}
                              title={isLocked ? t('common.locked') : `Show page ${index + 1}`}
                            >
                              <span className="dock-media-document-page__thumb">
                                {pageUrl ? (
                                  <img src={pageUrl} alt={`${documentDeck.name} page ${index + 1}`} loading="lazy" />
                                ) : (
                                  <Icon name="description" size={22} />
                                )}
                              </span>
                              <span className="dock-media-document-page__copy">
                                <span className="dock-media-document-page__number">Page {index + 1}</span>
                                <span className="dock-media-document-page__status">
                                  {sendingDocumentPage === page.key
                                    ? "Showing…"
                                    : isActive
                                      ? "Showing in OBS"
                                      : isLocked
                                        ? t('media.upgradeToAccess')
                                        : "Ready to show"}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })() : (
                  <>
                    {/* Filter: pick one or several types and the order, in one menu. */}
                    <div className="dock-media-filterbar" ref={filterMenuRef}>
                      <button
                        type="button"
                        className={`dock-media-filterbar__trigger${filterMenuOpen ? " dock-media-filterbar__trigger--open" : ""}${activeKinds.length > 0 ? " dock-media-filterbar__trigger--active" : ""}`}
                        onClick={() => setFilterMenuOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={filterMenuOpen}
                        aria-label={t('media.filter', 'Filter')}
                        title={t('media.filter', 'Filter')}>
                        <Icon name="filter_list" size={13} />
                        <span className="dock-media-filterbar__label">{mediaFilterSummary}</span>
                        <span className="dock-media-filterbar__count">{mediaFilterCount}</span>
                        <Icon name={filterMenuOpen ? "expand_less" : "expand_more"} size={14} />
                      </button>
                      {activeKinds.length > 0 && (
                        <button
                          type="button"
                          className="dock-media-filterbar__clear"
                          onClick={() => setActiveKinds([])}
                          aria-label={t('media.clearFilter', 'Clear filter')}
                          title={t('media.clearFilter', 'Clear filter')}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                      {filterMenuOpen && (
                        <div className="dock-media-filterbar__menu" role="menu" aria-label={t('media.filter', 'Filter')}>
                          <div className="dock-media-filterbar__heading">{t('media.filterType', 'Type')}</div>
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={activeKinds.length === 0}
                            className="dock-media-filterbar__item"
                            onClick={() => setActiveKinds([])}>
                            <span className={`dock-media-filterbar__box${activeKinds.length === 0 ? " dock-media-filterbar__box--on" : ""}`}>
                              {activeKinds.length === 0 && <Icon name="check" size={10} />}
                            </span>
                            <span className="dock-media-filterbar__item-label">{t('media.all')}</span>
                            <span className="dock-media-filterbar__item-count">{nonDocumentMediaEntries.length + documentDecks.length}</span>
                          </button>
                          {mediaKindOptions.map((option) => {
                            const checked = activeKinds.includes(option.id);
                            return (
                              <button
                                key={option.id}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={checked}
                                aria-disabled={option.locked || undefined}
                                className={`dock-media-filterbar__item${option.locked ? " dock-media-filterbar__item--locked" : ""}`}
                                onClick={() => {
                                  if (option.locked) {
                                    showUpgradeModal("Audio library and playback are available on Basic and Growth plans. Upgrade to unlock.");
                                    return;
                                  }
                                  toggleMediaKind(option.id);
                                }}>
                                <span className={`dock-media-filterbar__box${checked ? " dock-media-filterbar__box--on" : ""}`}>
                                  {checked && <Icon name="check" size={10} />}
                                </span>
                                <span className="dock-media-filterbar__item-label">{option.label}</span>
                                <span className="dock-media-filterbar__item-count">
                                  {option.locked ? <Icon name="lock" size={10} /> : option.count}
                                </span>
                              </button>
                            );
                          })}
                          {!isFreePlan && (
                            <>
                              <div className="dock-media-filterbar__heading">{t('media.sortOrder')}</div>
                              {([
                                { id: "recent", label: t('media.recentlyUsed') },
                                { id: "uploaded", label: t('media.newlyUploaded') },
                              ] as const).map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={viewMode === option.id}
                                  className="dock-media-filterbar__item"
                                  onClick={() => {
                                    setViewMode(option.id);
                                    setFilterMenuOpen(false);
                                  }}>
                                  <span className={`dock-media-filterbar__radio${viewMode === option.id ? " dock-media-filterbar__radio--on" : ""}`} />
                                  <span className="dock-media-filterbar__item-label">{option.label}</span>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {renderMediaFolderFilter()}

                    {/* Feedback banners */}
                    {downloadSuccess && (
                      <div className="dock-media-send-error dock-media-send-error--info">
                        <Icon name="check_circle" size={13} />
                        <span>{downloadSuccess}</span>
                        <button
                          type="button"
                          className="dock-media-send-error__dismiss"
                          onClick={() => setDownloadSuccess(null)}
                          aria-label={t('media.dismiss', 'Dismiss')}
                          title={t('common.close', 'Close')}>
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    )}
                    {sendError && (
                      <div className="dock-media-send-error">
                        <Icon name="error_outline" size={13} />
                        <span>{sendError}</span>
                        <button
                          type="button"
                          className="dock-media-send-error__dismiss"
                          onClick={() => setSendError(null)}
                          aria-label={t('media.dismiss')}
                          title={t('common.close')}>
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    )}

                    {/* Asset list */}
                    {!hasVisibleMediaEntries && !hasVisibleDocumentDecks ? (
                      <div className="dock-empty dock-empty--inline">
                        {assetSearch.trim() ? (
                          renderSearchEmptyNotice(activeKindSearchLabel)
                        ) : (
                          <div className="dock-empty__text">
                            {activeKind === "all"
                              ? t('media.noUploads')
                              : activeKind === "video"
                                ? t('media.noVideos')
                                : activeKind === "audio"
                                  ? "No audio imported"
                                : activeKind === "document"
                                  ? "No documents yet"
                                  : t('media.noImages')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div key={`${browserTab}-${activeKinds.join("+")}`} className="dock-media-list">
                        {hasVisibleDocumentDecks && filteredDocumentDecks.map((deck) => renderDocumentCard(deck))}
                        {filteredUploadEntries.map((entry) => renderMediaCard(entry))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {browserTab === "templates" && (
          <section className="dock-media-section" aria-label="Saved templates">
            <div className="dock-media-section__header">
              <div>
                <div className="dock-media-section__title">Templates</div>
                {!isUltraCompactHeight && (
                  <div className="dock-media-section__meta">Saved designs are sent here as images. Preview or click one to show it in OBS.</div>
                )}
              </div>
              <div className="dock-media-section__actions">
                <span className="dock-media-section__count">{filteredSavedTemplateEntries.length}</span>
                <button
                  type="button"
                  className="dock-shell-icon-btn"
                  onClick={() => void loadSavedTemplateImages()}
                  disabled={savedTemplateImagesLoading}
                  aria-label="Refresh saved templates"
                  title="Refresh saved templates"
                >
                  <Icon
                    name="refresh"
                    size={12}
                    style={{ animation: savedTemplateImagesLoading ? "spin 1s linear infinite" : undefined }}
                  />
                </button>
              </div>
            </div>

            {downloadSuccess && (
              <div className="dock-media-send-error dock-media-send-error--info">
                <Icon name="check_circle" size={13} />
                <span>{downloadSuccess}</span>
                <button
                  type="button"
                  className="dock-media-send-error__dismiss"
                  onClick={() => setDownloadSuccess(null)}
                  aria-label={t('media.dismiss', 'Dismiss')}
                  title={t('common.close', 'Close')}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}
            {sendError && (
              <div className="dock-media-send-error">
                <Icon name="error_outline" size={13} />
                <span>{sendError}</span>
                <button
                  type="button"
                  className="dock-media-send-error__dismiss"
                  onClick={() => setSendError(null)}
                  aria-label={t('media.dismiss')}
                  title={t('common.close')}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}

            {savedTemplateImagesError ? (
              <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">{savedTemplateImagesError}</div></div>
            ) : savedTemplateImagesLoading && savedTemplateEntries.length === 0 ? (
              <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">Loading saved templates…</div></div>
            ) : filteredSavedTemplateEntries.length === 0 ? (
              <div className="dock-empty dock-empty--inline">
                {assetSearch.trim() ? (
                  renderSearchEmptyNotice("templates")
                ) : (
                  <div className="dock-empty__text">
                    {savedTemplateEntries.length > 0 ? "No saved templates match your search." : "Save an edited template in Templates to see its image here."}
                  </div>
                )}
              </div>
            ) : (
              <div className="dock-media-list">{filteredSavedTemplateEntries.map(renderSavedTemplateCard)}</div>
            )}
          </section>
        )}

        {browserTab === "animations" && (
          <>
            {renderMediaFolderFilter()}
            {animationsLocked ? (
              <div className="dock-media-empty dock-media-empty--locked">
                <div className="dock-media-empty__icon">
                  <Icon name="lock" size={24} />
                </div>
                <div className="dock-media-empty__title">{t('media.tabAnimations')}</div>
                <div className="dock-media-empty__text">{t('media.upgradeToAccess')}</div>
                <button
                  type="button"
                  className="dock-btn dock-btn--preview dock-btn--compact dock-upgrade-plan-btn"
                  onClick={() => void requireEntitlement("slideshow", 0)}
                  title={t('media.upgradeToAccess')}
                >
                  <Icon name="upgrade" size={12} />
                  {t('media.upgradeToAccess')}
                </button>
              </div>
            ) : (
              <>
                <div className="dock-animation-catalog-tabs" role="tablist" aria-label={t('media.animationCatalog', 'Animation templates')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={animationCatalogTab === "videos"}
                    className={`dock-animation-catalog-tabs__item${animationCatalogTab === "videos" ? " dock-animation-catalog-tabs__item--active" : ""}`}
                    onClick={() => setAnimationCatalogTab("videos")}
                  >
                    <Icon name="movie" size={13} />
                    {t('media.templateVideos', 'Videos')}
                    <span>{templateVideos.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={animationCatalogTab === "pictures"}
                    className={`dock-animation-catalog-tabs__item${animationCatalogTab === "pictures" ? " dock-animation-catalog-tabs__item--active" : ""}`}
                    onClick={() => setAnimationCatalogTab("pictures")}
                  >
                    <Icon name="image" size={13} />
                    {t('media.templatePictures', 'Pictures')}
                    <span>{templatePictures.length}</span>
                  </button>
                </div>

                <section
                  className="dock-media-section dock-animation-catalog"
                  style={{ order: 2 }}
                  aria-label={animationCatalogTab === "videos" ? t('media.templateVideos', 'Template videos') : t('media.templatePictures', 'Template pictures')}
                >
                  <div className="dock-media-section__header">
                    <div>
                      <div className="dock-media-section__title">
                        {animationCatalogTab === "videos" ? t('media.templateVideos', 'Template videos') : t('media.templatePictures', 'Template pictures')}
                      </div>
                      {!isUltraCompactHeight && (
                        <div className="dock-media-section__meta">
                          {animationCatalogTab === "videos"
                            ? t('media.templateVideosMeta', 'Download a video and project it in OBS.')
                            : t('media.templatePicturesMeta', 'Get started by downloading these pictures and projecting them.')}
                        </div>
                      )}
                    </div>
                    <div className="dock-media-section__actions">
                      <span className="dock-media-section__count">
                        {animationCatalogTab === "videos" ? filteredAnimationTemplateVideos.length : filteredAnimationTemplatePictures.length}
                      </span>
                      <button
                        type="button"
                        className="dock-shell-icon-btn"
                        onClick={() => void (animationCatalogTab === "videos" ? loadTemplateVideos() : loadTemplatePictures())}
                        disabled={animationCatalogTab === "videos" ? templateVideosLoading : templatePicturesLoading}
                        aria-label={t('media.refreshTemplateVideos', 'Refresh templates')}
                        title={t('media.refreshTemplateVideos', 'Refresh templates')}
                      >
                        <Icon
                          name="refresh"
                          size={12}
                          style={{ animation: (animationCatalogTab === "videos" ? templateVideosLoading : templatePicturesLoading) ? "spin 1s linear infinite" : undefined }}
                        />
                      </button>
                    </div>
                  </div>

                  {animationCatalogTab === "videos" ? (
                    templateVideosError ? (
                      <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">{templateVideosError}</div></div>
                    ) : templateVideosLoading && filteredAnimationTemplateVideos.length === 0 ? (
                      <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">{t('media.loadingTemplateVideos')}</div></div>
                    ) : filteredAnimationTemplateVideos.length === 0 ? (
                      <div className="dock-empty dock-empty--inline">
                        {assetSearch.trim() ? (
                          renderSearchEmptyNotice("template videos")
                        ) : (
                          <div className="dock-empty__text">{t('media.noTemplateVideosMatch')}</div>
                        )}
                      </div>
                    ) : (
                      <div className="dock-animation-grid">{filteredAnimationTemplateVideos.map(renderTemplateVideoTile)}</div>
                    )
                  ) : (
                    templatePicturesError ? (
                      <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">{templatePicturesError}</div></div>
                    ) : templatePicturesLoading && filteredAnimationTemplatePictures.length === 0 ? (
                      <div className="dock-empty dock-empty--inline"><div className="dock-empty__text">{t('media.loadingTemplatePictures', 'Loading template pictures…')}</div></div>
                    ) : filteredAnimationTemplatePictures.length === 0 ? (
                      <div className="dock-empty dock-empty--inline">
                        {assetSearch.trim() ? (
                          renderSearchEmptyNotice("template pictures")
                        ) : (
                          <div className="dock-empty__text">{t('media.noTemplatePicturesMatch', 'No template pictures match your search.')}</div>
                        )}
                      </div>
                    ) : (
                      <div className="dock-animation-grid">{filteredAnimationTemplatePictures.map(renderTemplatePictureTile)}</div>
                    )
                  )}
                </section>

                {filteredAnimationEntries.length > 0 && (
                  <section
                    className="dock-media-section dock-animation-downloaded"
                    style={{ order: 1 }}
                    aria-label={animationCatalogTab === "videos" ? t('media.downloadedAnimations') : t('media.downloadedPictures', 'Downloaded pictures')}
                  >
                    <div className="dock-media-section__header">
                      <div>
                        <div className="dock-media-section__title">{animationCatalogTab === "videos" ? t('media.downloadedAnimations') : t('media.downloadedPictures', 'Downloaded pictures')}</div>
                        {!isUltraCompactHeight && (
                          <div className="dock-media-section__meta">{t('media.clickToProject', 'Click a downloaded item to project it.')}</div>
                        )}
                      </div>
                      <span className="dock-media-section__count">{filteredAnimationEntries.length}</span>
                    </div>
                    <div className="dock-animation-grid">
                      {filteredAnimationEntries.map((entry) => {
                        const isActiveTarget = activeTargets.active?.key === entry.key;
                        const prefs = getEntryPrefs(entry);
                        const displayName = prefs.label?.trim() || entry.name;
                        const thumbUrl = entry.thumbnailUrl || (entry.previewUrl && entry.kind === "image" ? entry.previewUrl : null);

                        return (
                          <div
                            key={entry.key}
                            className={`dock-animation-tile${isActiveTarget ? " dock-animation-tile--active" : ""}${prefs.pinned ? " dock-animation-tile--pinned" : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => { void handleSendEntry(entry); }}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void handleSendEntry(entry); } }}
                            onContextMenu={(event) => openMediaContextMenu(event, entry, false)}
                          >
                            <div className="dock-animation-tile__thumb">
                              {thumbUrl ? (
                                <img src={thumbUrl} alt={displayName} loading="lazy" className="dock-animation-tile__img" />
                              ) : entry.previewUrl && entry.kind === "video" ? (
                                <video src={entry.previewUrl} className="dock-animation-tile__img" muted playsInline preload="metadata" />
                              ) : (
                                <div className="dock-animation-tile__placeholder">
                                  <Icon name={entry.kind === "image" ? "image" : "movie"} size={20} />
                                </div>
                              )}
                              <div className="dock-animation-tile__play-hint"><Icon name="play_arrow" size={22} /></div>
                              <div className="dock-animation-tile__gradient" />
                              {prefs.pinned && (
                                <span className="dock-animation-tile__pin-badge" title={t('media.pinned', 'Pinned')}><Icon name="push_pin" size={11} /></span>
                              )}
                              <div className="dock-animation-tile__info">
                                <span className="dock-animation-tile__name">{displayName}</span>
                                <span className="dock-animation-tile__meta">{entry.durationSec ? fmtDuration(entry.durationSec) : t('media.animation').toUpperCase()}</span>
                              </div>
                              <span className="dock-animation-tile__dl-badge"><Icon name="check_circle" size={11} /></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}

        {browserTab === "patterns" && (
          <>
            {filteredPatternEntries.length === 0 ? (
              <div className="dock-empty dock-empty--inline">
                {assetSearch.trim() ? (
                  renderSearchEmptyNotice("patterns")
                ) : (
                  <div className="dock-empty__text">{t('media.noPatternsMatch')}</div>
                )}
              </div>
            ) : (
              <div className="dock-media-list">
                {filteredPatternEntries.map((entry) => {
                  const pattern = BACKGROUND_PATTERNS.find((item) => `pattern:${item.label}` === entry.key);
                  const animated = pattern ? isAnimatedPattern(pattern) : false;
                  const isActiveTarget = activeTargets.active?.key === entry.key;

                  return (
                    <div
                      key={entry.key}
                      className={`dock-media-gallery-card${isActiveTarget ? " dock-media-gallery-card--active" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleSendPattern(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void handleSendPattern(entry);
                        }
                      }}
                    >
                      <div className="dock-media-gallery-card__image-wrap">
                        <img src={entry.previewUrl} alt={entry.name} loading="lazy" className="dock-media-gallery-card__image" />
                        <div className="dock-media-gallery-card__overlay">
                          <span className="dock-media-gallery-card__name">{entry.name}</span>
                        </div>
                        {isActiveTarget && (
                          <span className="dock-media-gallery-card__active-badge">
                            <Icon name="visibility" size={10} />
                            {t('media.showing')}
                          </span>
                        )}
                        <span className="dock-media-gallery-card__type-badge">
                          {animated ? t('media.motion') : t('media.still')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {browserTab === "text" && (
          <div className="dock-overlay-composer">
            {/* ── Status Header ── */}

            {renderOverlayPreview()}

            {/* ── Inner Tab Bar ── */}
            <div className="dock-overlay-tabs" role="tablist" aria-label={t('media.textOverlayTabs')}>
              <button
                type="button"
                role="tab"
                aria-selected={textTab === "content"}
                className={`dock-overlay-tabs__btn${textTab === "content" ? " dock-overlay-tabs__btn--active" : ""}`}
                onClick={() => setTextTab("content")}
                title={t('media.tabText')}>
                <Icon name="title" size={12} />
                {t('media.tabText')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={textTab === "background"}
                className={`dock-overlay-tabs__btn${textTab === "background" ? " dock-overlay-tabs__btn--active" : ""}`}
                onClick={() => setTextTab("background")}
                title={t('media.background')}>
                <Icon name="palette" size={12} />
                {t('media.background')}
              </button>
            </div>

            {/* ── Content Tab ── */}
            {textTab === "content" && (
              <>
                {/* ── Animation Bar ── */}
                <div className="dock-overlay-anim-bar">
                  <button type="button" className="dock-overlay-anim-bar__preview" onClick={triggerAnimPreview} title={t('media.addAnimation')}>
                    <Icon name="play_arrow" size={12} />
                    {t('media.addAnimation')}
                  </button>
                  {/* <div className="dock-overlay-anim-bar__select-wrap">
                <select
                  className="dock-overlay-anim-bar__select"
                  value={textOverlay.animation}
                  onChange={(e) => setTextOverlay((c) => ({ ...c, animation: e.target.value as DockTextAnimation }))}
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="fade-up">Fade Up</option>
                  <option value="slide-up">Slide Up</option>
                  <option value="slide-down">Slide Down</option>
                  <option value="zoom">Zoom</option>
                </select>
              </div> */}
                  <div className="dock-overlay-anim-bar__duration">
                    <span>{t('media.duration')}</span>
                    <input
                      type="number"
                      className="dock-overlay-anim-bar__duration-input"
                      value={textOverlay.animationDuration}
                      min={0.3}
                      max={3}
                      step={0.1}
                      onChange={(e) => setTextOverlay((c) => ({ ...c, animationDuration: parseFloat(e.target.value) || 1 }))}
                    />
                    <span>s</span>
                  </div>
                </div>

                {/* ── Text Controls ── */}
                <div className="dock-overlay-text-controls">
                  <div className="dock-overlay-text-controls__field">
                    <label className="dock-overlay-text-controls__label" htmlFor="dock-media-overlay-headline">{t('media.mainText', 'Main text')}</label>
                    <textarea
                      id="dock-media-overlay-headline"
                      className="dock-overlay-text-controls__textarea dock-overlay-text-controls__textarea--headline"
                      value={textOverlay.headline}
                      onChange={(e) => setTextOverlay((c) => ({ ...c, headline: e.target.value }))}
                      placeholder={t('media.mainTextPlaceholder', 'Type the main text…')}
                      rows={2}
                    />
                    {renderOverlayTextSizeControl(
                      "headlineSize",
                      textOverlay.headlineSize,
                      TEXT_OVERLAY_HEADLINE_MIN_SIZE,
                      TEXT_OVERLAY_MAX_FONT_SIZE,
                      HEADLINE_SIZE_PRESETS,
                      t('media.mainTextSize', 'Main text size'),
                    )}
                  </div>
                  <div className="dock-overlay-text-controls__field">
                    <label className="dock-overlay-text-controls__label" htmlFor="dock-media-overlay-subline">
                      {t('media.supportingText', 'Supporting text')} <span className="dock-overlay-text-controls__optional">{t('common.optional')}</span>
                    </label>
                    <textarea
                      id="dock-media-overlay-subline"
                      className="dock-overlay-text-controls__textarea dock-overlay-text-controls__textarea--subline"
                      value={textOverlay.subline}
                      onChange={(e) => setTextOverlay((c) => ({ ...c, subline: e.target.value }))}
                      placeholder={t('media.supportingTextPlaceholder', 'Add supporting text…')}
                      rows={1}
                    />
                    {renderOverlayTextSizeControl(
                      "sublineSize",
                      textOverlay.sublineSize,
                      TEXT_OVERLAY_SUBLINE_MIN_SIZE,
                      TEXT_OVERLAY_MAX_FONT_SIZE,
                      SUBLINE_SIZE_PRESETS,
                      t('media.supportingTextSize', 'Supporting text size'),
                    )}
                  </div>
                </div>

                {/* ── Alignment & Position ── */}
                <div className="dock-overlay-align-section">
                  <div className="dock-overlay-align-section__label">{t('media.whereTextAppears', 'Where the text appears')}</div>
                  <div className="dock-overlay-align-section__row">
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.verticalPos === "top" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, verticalPos: "top" }))} title={t('common.up')}>
                      <Icon name="arrow_upward" size={14} />
                      {t('common.up')}
                    </button>
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.verticalPos === "center" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, verticalPos: "center" }))} title={t('common.center')}>
                      <Icon name="vertical_align_center" size={14} />
                      {t('common.center')}
                    </button>
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.verticalPos === "bottom" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, verticalPos: "bottom" }))} title={t('common.down')}>
                      <Icon name="arrow_downward" size={14} />
                      {t('common.down')}
                    </button>
                  </div>
                  <div className="dock-overlay-align-section__row">
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.align === "left" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, align: "left" }))} title={t('common.left')}>
                      <Icon name="format_align_left" size={14} />
                      {t('common.left')}
                    </button>
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.align === "center" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, align: "center" }))} title={t('common.center')}>
                      <Icon name="format_align_center" size={14} />
                      {t('common.center')}
                    </button>
                    <button type="button" className={`dock-overlay-align-section__btn ${textOverlay.align === "right" ? "dock-overlay-align-section__btn--active" : ""}`} onClick={() => setTextOverlay((c) => ({ ...c, align: "right" }))} title={t('common.right')}>
                      <Icon name="format_align_right" size={14} />
                      {t('common.right')}
                    </button>
                  </div>
                </div>

                {/* ── Animation Selection ── */}
                <div className="dock-overlay-anim-section">
                  <div className="dock-overlay-anim-section__label">{t('media.howTextAppears', 'How the text appears')}</div>
                  <div className="dock-overlay-anim-section__options">
                    {([
                      { key: "none", label: t('media.animNone'), icon: "block" },
                      { key: "fade", label: t('media.animFade'), icon: "opacity" },
                      { key: "fade-up", label: t('media.animFadeUp'), icon: "north" },
                      { key: "slide-up", label: t('media.animSlideUp'), icon: "arrow_upward" },
                      { key: "slide-down", label: t('media.animSlideDown'), icon: "arrow_downward" },
                      { key: "zoom", label: t('media.animZoom'), icon: "zoom_in" },
                    ] as { key: DockTextAnimation; label: string; icon: string }[]).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        className={`dock-overlay-anim-section__opt ${textOverlay.animation === opt.key ? "dock-overlay-anim-section__opt--active" : ""}`}
                        onClick={() => setTextOverlay((c) => ({ ...c, animation: opt.key }))}
                      >
                        <Icon name={opt.icon} size={12} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

              </>
            )}

            {/* ── Background Tab ── */}
            {textTab === "background" && (
              <>
                {/* ── Enable Toggle ── */}
                <div className="dock-overlay-bg-section">
                  <div className="dock-overlay-bg-section__row">
                    <span className="dock-overlay-bg-section__label">{t('media.background')}</span>
                    <button
                      type="button"
                      className={`dock-overlay-bg-toggle ${textOverlay.background.enabled ? "dock-overlay-bg-toggle--on" : ""}`}
                      onClick={() => setTextOverlay((c) => ({
                        ...c,
                        background: { ...c.background, enabled: !c.background.enabled },
                      }))}
                      title={t('media.background')}>
                      <span className="dock-overlay-bg-toggle__thumb" />
                    </button>
                  </div>
                </div>

                {textOverlay.background.enabled && (
                  <>
                    {/* ── Display Mode ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__label">{t('media.displayMode')}</div>
                      <div className="dock-overlay-bg-segmented">
                        {([
                          { key: "text-only" as OverlayDisplayMode, label: t('media.displayTextOnly'), icon: "title" },
                          { key: "box" as OverlayDisplayMode, label: t('media.displayBox'), icon: "square" },
                          { key: "lower-third" as OverlayDisplayMode, label: t('media.displayLowerThird'), icon: "move_down" },
                          { key: "fullscreen" as OverlayDisplayMode, label: t('media.displayFullscreen'), icon: "fullscreen" },
                        ]).map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            className={`dock-overlay-bg-seg ${textOverlay.background.mode === opt.key ? "dock-overlay-bg-seg--active" : ""}`}
                            onClick={() => setTextOverlay((c) => ({
                              ...c,
                              background: { ...c.background, mode: opt.key },
                            }))}
                          >
                            <Icon name={opt.icon} size={11} />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── Text Color ── */}
                    {textOverlay.background.mode !== "text-only" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('media.textColor')}</div>
                        <div className="dock-overlay-bg-color-row">
                          <input
                            type="color"
                            className="dock-overlay-bg-color-input"
                            value={textOverlay.textColor}
                            onChange={(e) => setTextOverlay((c) => ({ ...c, textColor: e.target.value }))}
                          />
                          <input
                            type="text"
                            className="dock-overlay-bg-hex-input"
                            value={textOverlay.textColor}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                setTextOverlay((c) => ({ ...c, textColor: val }));
                              }
                            }}
                            maxLength={7}
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Background Type ── */}
                    {textOverlay.background.mode !== "text-only" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('media.backgroundType')}</div>
                        <div className="dock-overlay-bg-segmented">
                          {([
                            { key: "color" as OverlayBgType, label: t('media.bgTypeSolidColor'), icon: "palette" },
                            { key: "image" as OverlayBgType, label: t('common.image'), icon: "image" },
                            { key: "pattern" as OverlayBgType, label: t('common.pattern'), icon: "grid_on" },
                          ]).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              className={`dock-overlay-bg-seg ${textOverlay.background.bgType === opt.key ? "dock-overlay-bg-seg--active" : ""}`}
                              onClick={() => setTextOverlay((c) => ({
                                ...c,
                                background: { ...c.background, bgType: opt.key },
                              }))}
                            >
                              <Icon name={opt.icon} size={11} />
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Color Picker ── */}
                    {textOverlay.background.bgType === "color" && textOverlay.background.mode !== "text-only" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('common.color')}</div>
                        <div className="dock-overlay-bg-color-row">
                          <input
                            type="color"
                            className="dock-overlay-bg-color-input"
                            value={textOverlay.background.color}
                            onChange={(e) => setTextOverlay((c) => ({
                              ...c,
                              background: { ...c.background, color: e.target.value },
                            }))}
                          />
                          <input
                            type="text"
                            className="dock-overlay-bg-hex-input"
                            value={textOverlay.background.color}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                setTextOverlay((c) => ({
                                  ...c,
                                  background: { ...c.background, color: val },
                                }));
                              }
                            }}
                            maxLength={7}
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Image Selector ── */}
                    {textOverlay.background.bgType === "image" && textOverlay.background.mode !== "text-only" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('common.image')}</div>
                        <div className="dock-overlay-bg-image-grid">
                          {localLibrary.filter((item) => item.type === "image").length === 0 ? (
                            <div className="dock-overlay-bg-empty">{t('media.noImagesInLibrary')}</div>
                          ) : (
                            localLibrary.filter((item) => item.type === "image").map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`dock-overlay-bg-image-card ${textOverlay.background.imageId === item.id ? "dock-overlay-bg-image-card--active" : ""}`}
                                onClick={() => setTextOverlay((c) => ({
                                  ...c,
                                  background: { ...c.background, imageId: item.id },
                                }))}
                              >
                                <img src={item.thumbnailUrl || item.url} alt={item.name} />
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Pattern Selector ── */}
                    {textOverlay.background.bgType === "pattern" && textOverlay.background.mode !== "text-only" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('common.pattern')}</div>
                        <div className="dock-overlay-bg-pattern-grid">
                          {BACKGROUND_PATTERNS.map((pat) => (
                            <button
                              key={pat.label}
                              type="button"
                              className={`dock-overlay-bg-pattern-card ${textOverlay.background.patternId === pat.label ? "dock-overlay-bg-pattern-card--active" : ""}`}
                              onClick={() => setTextOverlay((c) => ({
                                ...c,
                                background: { ...c.background, patternId: pat.label },
                              }))}
                            >
                              <img src={pat.src} alt={pat.label} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Opacity ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__row">
                        <span className="dock-overlay-bg-section__label">{t('common.opacity')}</span>
                        <span className="dock-overlay-bg-section__value">{Math.round(textOverlay.background.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        className="dock-overlay-bg-slider"
                        min={0}
                        max={1}
                        step={0.05}
                        value={textOverlay.background.opacity}
                        onChange={(e) => setTextOverlay((c) => ({
                          ...c,
                          background: { ...c.background, opacity: parseFloat(e.target.value) },
                        }))}
                      />
                    </div>

                    {/* ── Blur ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__row">
                        <span className="dock-overlay-bg-section__label">{t('common.blur')}</span>
                        <span className="dock-overlay-bg-section__value">{textOverlay.background.blur}px</span>
                      </div>
                      <input
                        type="range"
                        className="dock-overlay-bg-slider"
                        min={0}
                        max={30}
                        step={1}
                        value={textOverlay.background.blur}
                        onChange={(e) => setTextOverlay((c) => ({
                          ...c,
                          background: { ...c.background, blur: parseInt(e.target.value, 10) },
                        }))}
                      />
                    </div>

                    {/* ── Scale ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__row">
                        <span className="dock-overlay-bg-section__label">{t('common.scale')}</span>
                        <span className="dock-overlay-bg-section__value">{textOverlay.background.scale.toFixed(1)}×</span>
                      </div>
                      <input
                        type="range"
                        className="dock-overlay-bg-slider"
                        min={0.5}
                        max={2}
                        step={0.1}
                        value={textOverlay.background.scale}
                        onChange={(e) => setTextOverlay((c) => ({
                          ...c,
                          background: { ...c.background, scale: parseFloat(e.target.value) },
                        }))}
                      />
                    </div>

                    {/* ── Corner Radius ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__row">
                        <span className="dock-overlay-bg-section__label">{t('common.cornerRadius')}</span>
                        <span className="dock-overlay-bg-section__value">{textOverlay.background.radius}px</span>
                      </div>
                      <input
                        type="range"
                        className="dock-overlay-bg-slider"
                        min={0}
                        max={48}
                        step={2}
                        value={textOverlay.background.radius}
                        onChange={(e) => setTextOverlay((c) => ({
                          ...c,
                          background: { ...c.background, radius: parseInt(e.target.value, 10) },
                        }))}
                      />
                    </div>

                    {/* ── Padding ── */}
                    <div className="dock-overlay-bg-section">
                      <div className="dock-overlay-bg-section__row">
                        <span className="dock-overlay-bg-section__label">{t('common.padding')}</span>
                        <span className="dock-overlay-bg-section__value">{textOverlay.background.padding}px</span>
                      </div>
                      <input
                        type="range"
                        className="dock-overlay-bg-slider"
                        min={TEXT_OVERLAY_PADDING_MIN}
                        max={TEXT_OVERLAY_PADDING_MAX}
                        step={2}
                        value={textOverlay.background.padding}
                        onChange={(e) => setTextOverlay((c) => ({
                          ...c,
                          background: {
                            ...c.background,
                            padding: clampNumber(Number(e.target.value), TEXT_OVERLAY_PADDING_MIN, TEXT_OVERLAY_PADDING_MAX, DEFAULT_BACKGROUND_SETTINGS.padding),
                          },
                        }))}
                      />
                    </div>

                    {/* ── Width ── */}
                    {textOverlay.background.mode !== "fullscreen" && (
                      <div className="dock-overlay-bg-section">
                        <div className="dock-overlay-bg-section__label">{t('media.backgroundWidth')}</div>
                        <div className="dock-overlay-bg-segmented">
                          {([
                            { key: "full" as OverlayBgWidth, label: t('media.bgWidthFull'), icon: "aspect_ratio" },
                            { key: "clip" as OverlayBgWidth, label: t('media.bgWidthClip'), icon: "crop" },
                          ]).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              className={`dock-overlay-bg-seg ${textOverlay.background.width === opt.key ? "dock-overlay-bg-seg--active" : ""}`}
                              onClick={() => setTextOverlay((c) => ({
                                ...c,
                                background: { ...c.background, width: opt.key },
                              }))}
                            >
                              <Icon name={opt.icon} size={11} />
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

              </>
            )}

            <div className="dock-overlay-actions dock-overlay-actions--shared">
              <button
                type="button"
                className="dock-overlay-actions__btn dock-overlay-actions__btn--show"
                onClick={() => void applyTextOverlay()}
                disabled={applyingTextTarget !== null}
                title={textOverlayTargets.active ? t('media.apply') : t('media.show')}>
                <Icon name="visibility" size={14} />
                {applyingTextTarget ? t('media.applying') : textOverlayTargets.active ? t('media.apply') : t('media.show')}
              </button>
              <button
                type="button"
                className="dock-overlay-actions__btn dock-overlay-actions__btn--clear"
                onClick={() => void clearTextOverlayEverywhere()}
                disabled={applyingTextTarget !== null || !textOverlayTargets.active}
                title={t('common.clear')}>
                <Icon name="delete" size={14} />
                {t('common.clear')}
              </button>
            </div>

          </div>
        )}
      </div>
        </div>
      </div>

      {showAddMediaModal && (
        <div className="dock-dialog-backdrop" role="presentation" onClick={closeAddMediaModal}>
          <div
            className="dock-dialog dock-media-add-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dock-media-add-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">{templateVideoOnlyModal ? t('common.add') : t('media.addMedia')}</div>
                {/* <h2 id="dock-media-add-title" className="dock-dialog__title">{t('media.chooseWhatToAdd')}</h2> */}
              </div>
              <button type="button" className="dock-dialog__close" onClick={closeAddMediaModal} aria-label={t('media.closeAddMediaDialog')} title={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              {!templateVideoOnlyModal && (
                <div className="dock-console-segmented dock-media-tabs" role="tablist" aria-label={t('media.addMediaTabs')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addMediaTab === "background"}
                    className={`dock-console-segmented__item${addMediaTab === "background" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => setAddMediaTab("background")}
                    title={t('media.background')}>
                    {t('media.background')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addMediaTab === "template-videos"}
                    className={`dock-console-segmented__item${addMediaTab === "template-videos" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => {
                      if (!animationsLocked) setAddMediaTab("template-videos");
                    }}
                    disabled={animationsLocked}
                    title={animationsLocked ? t('media.upgradeToAccess') : t('media.templateVideos')}>
                    {t('media.templateVideos')}
                  </button>
                </div>
              )}

              {addMediaTab === "background" ? (
                <div className="dock-media-add-modal__pane">
                  <div className="dock-media-add-modal__hero">
                    <div className="dock-media-add-modal__hero-icon">
                      <Icon name="perm_media" size={18} />
                    </div>
                    <div className="dock-media-add-modal__hero-copy">
                      <div className="dock-media-add-modal__hero-title">{t('media.addRegularMedia')}</div>
                      <div className="dock-media-add-modal__hero-text">Upload images, videos, PDFs, DOCX, or PPTX files. Documents become easy page cards.</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dock-btn dock-btn--preview dock-btn--compact"
                    onClick={() => {
                      // Always open the file picker — per-file quota is enforced inside handleUploadFiles
                      uploadInputRef.current?.click();
                    }}
                    disabled={uploading}
                    title={t('media.uploading')}>
                    <Icon name="upload" size={12} />
                    {uploading ? t('media.uploading') : t('media.chooseFiles')}
                  </button>
                  <div className="dock-media-card__hint">
                    {presentationLinkMode
                      ? "Accepted: images, videos, PDF, DOCX, PPTX. Documents become page images for the presentation screen."
                      : "Accepted: images, videos, PDF, DOCX, PPTX. Documents are converted to page images for OBS."}
                  </div>
                </div>
              ) : (
                <div className="dock-media-add-modal__pane dock-media-add-modal__pane--template">
                  <div className="dock-media-searchbar dock-media-add-modal__searchbar">
                    <Icon name="search" size={12} />
                    <input
                      type="text"
                      className="dock-input dock-media-searchbar__input"
                      value={templateVideoSearch}
                      onChange={(event) => setTemplateVideoSearch(event.target.value)}
                      placeholder={t('media.searchTemplateVideos')}
                      aria-label={t('media.searchTemplateVideos')}
                    />
                    {templateVideoSearch && (
                      <button
                        type="button"
                        className="dock-shell-icon-btn dock-media-searchbar__clear"
                        onClick={() => setTemplateVideoSearch("")}
                        aria-label={t('media.clearTemplateVideoSearch')}
                        title={t('media.clearTemplateVideoSearch')}
                      >
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </div>

                  <div className="dock-media-section__header">
                    <div>
                      <div className="dock-media-section__title">{t('media.templateVideos')}</div>
                      {!isUltraCompactHeight && (
                        <div className="dock-media-section__meta">{t('media.templateVideosMeta')}</div>
                      )}
                    </div>
                    <div className="dock-media-section__actions">
                      <span className="dock-media-section__count">{templateVideosLoading ? "…" : filteredTemplateVideos.length}</span>
                      <button
                        type="button"
                        className="dock-shell-icon-btn"
                        onClick={() => void loadTemplateVideos()}
                        disabled={templateVideosLoading}
                        aria-label={t('media.refreshTemplateVideos')}
                        title={t('media.refreshTemplateVideos')}
                      >
                        <Icon
                          name="refresh"
                          size={12}
                          style={{ animation: templateVideosLoading ? "spin 1s linear infinite" : undefined }}
                        />
                      </button>
                    </div>
                  </div>

                  {templateVideosError ? (
                    <div className="dock-empty dock-empty--inline">
                      <div className="dock-empty__text">{templateVideosError}</div>
                    </div>
                  ) : templateVideosLoading && filteredTemplateVideos.length === 0 ? (
                    <div className="dock-empty dock-empty--inline">
                      <div className="dock-empty__text">{t('media.loadingTemplateVideos')}</div>
                    </div>
                  ) : filteredTemplateVideos.length === 0 ? (
                    <div className="dock-empty dock-empty--inline">
                      {templateVideoSearch.trim() ? (
                        renderSearchEmptyNotice("template videos", () => setTemplateVideoSearch(""), templateVideoSearch)
                      ) : (
                        <div className="dock-empty__text">{t('media.noTemplateVideosMatch')}</div>
                      )}
                    </div>
                  ) : (
                    <div className="dock-animation-grid">
                      {filteredTemplateVideos.map(renderTemplateVideoTile)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="dock-dialog__footer">
              <button type="button" className="dock-btn dock-btn--compact" onClick={closeAddMediaModal} title={t('common.close')}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Selection Tray ── */}
      {selectionMode && selectedKeys.size > 0 && (
        <div className="dock-media-selection-tray">
          <div className="dock-media-selection-tray__info">
            <span className="dock-media-selection-tray__count">{t('media.selectedCount', { count: selectedKeys.size })}</span>
            <div className="dock-media-selection-tray__thumbs">
              {selectedEntries.slice(0, 5).map((entry) => (
                <div key={entry.key} className="dock-media-selection-tray__thumb">
                  {entry.thumbnailUrl
                    ? <img src={entry.thumbnailUrl} alt="" />
                    : <Icon name={getFileIcon(entry.kind)} size={10} />
                  }
                </div>
              ))}
              {selectedEntries.length > 5 && (
                <span className="dock-media-selection-tray__more">+{selectedEntries.length - 5}</span>
              )}
            </div>
          </div>
          <div className="dock-media-selection-tray__actions">
            <button
              type="button"
              className="dock-btn dock-btn--primary dock-btn--compact"
              onClick={() => setShowPlaylistModal(true)}
              title={selectedAudioEntries.length > 0 && selectedVideoEntries.length === 0 && selectedImageEntries.length === 0 ? "Create audio playlist" : t('media.createSlideshow')}>
              <Icon name="playlist_add" size={12} />
              {selectedAudioEntries.length > 0 && selectedVideoEntries.length === 0 && selectedImageEntries.length === 0 ? "Create audio playlist" : t('media.createSlideshow')}
            </button>
            <button
              type="button"
              className="dock-btn dock-btn--secondary dock-btn--compact"
              onClick={clearSelection}
              title={t('common.cancel')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Footer actions (hidden when in text section — it has its own clear) ── */}
      {browserTab !== "text" && (
        <button
          type="button"
          className="dock-btn dock-btn--secondary dock-btn--compact dock-media-hide-btn"
          onClick={() => void clearMedia()}
          disabled={clearingTarget !== null || (!hasActiveMediaTarget && !textOverlayTargets.active)}
          aria-label={t('media.clearMedia')}
          title={t('media.hideMedia')}>
          <span>{hasActiveMediaTarget || textOverlayTargets.active ? t('media.hideMedia') : t('common.clear')}</span>
        </button>
      )}

      {activeOptionsEntry && (() => {
        const entry = activeOptionsEntry;
        const entryPrefs = mediaPrefs[entry.prefKey] ?? {};
        const thumbUrl = entry.thumbnailUrl || (entry.previewUrl && entry.kind === "image" ? entry.previewUrl : null);
        const cleanName = entryPrefs.label?.trim()
          || entry.name.replace(/^media_\d+_/, "").replace(/\.[^.]+$/, "");
        const restartOnActivate = entryPrefs.restartOnActivate ?? true;
        const closeWhenInactive = entryPrefs.closeWhenInactive ?? false;
        const clearOnMediaEnd = entryPrefs.clearOnMediaEnd ?? false;
        const playbackSpeed = entryPrefs.playbackSpeed ?? 100;
        // const addedDate = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
        // const usedDate = entryPrefs.lastUsedAt ? new Date(entryPrefs.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

        return (
          <div className="dock-dialog-backdrop" role="presentation" onClick={closeEntryOptions}>
            <div
              key={entry.key}
              className="dock-dialog dock-media-inspector"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dock-media-inspector-title"
              onClick={(event) => event.stopPropagation()}
            >
              {/* Close button */}
              <button type="button" className="dock-media-inspector__close" onClick={() => { setPreviewPlaying(false); closeEntryOptions(); }} aria-label={t('common.close')} title={t('common.close')}>
                <Icon name="close" size={14} />
              </button>

              {/* ── Preview ── */}
              {entry.kind === "video" && entry.previewUrl ? (
                <div className="dock-media-inspector__preview">
                  {previewPlaying ? (
                    <video
                      ref={inspectorPreviewVideoRef}
                      className="dock-media-inspector__preview-media"
                      src={entry.previewUrl}
                      controls
                      preload="metadata"
                      autoPlay
                      muted={entryPrefs.videoMuted ?? true}
                      loop={entryPrefs.loop ?? true}
                    />
                  ) : (
                    <>
                      {thumbUrl ? (
                        <img className="dock-media-inspector__preview-media" src={thumbUrl} alt={cleanName} />
                      ) : (
                        <div className="dock-media-inspector__preview-placeholder">

                        </div>
                      )}
                      <button type="button" className="dock-media-inspector__play-btn" onClick={() => setPreviewPlaying(true)} title={t('common.play')}>
                        <Icon name="play_arrow" size={22} />
                      </button>
                    </>
                  )}
                </div>
              ) : entry.kind === "audio" && entry.previewUrl ? (
                <div className="dock-media-inspector__preview" style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <Icon name="music_note" size={40} style={{ color: "var(--dock-accent, #3b82f6)" }} />
                  <audio
                    src={entry.previewUrl}
                    controls
                    style={{ width: "100%", maxHeight: 36, outline: "none" }}
                  />
                </div>
              ) : thumbUrl ? (
                <div className="dock-media-inspector__preview">
                  <img className="dock-media-inspector__preview-media" src={thumbUrl} alt={cleanName} />
                </div>
              ) : (
                <div className="dock-media-inspector__preview dock-media-inspector__preview--placeholder">
                  <Icon name={entry.kind === "video" ? "movie" : entry.kind === "audio" ? "music_note" : "image"} size={32} />
                </div>
              )}

              {/* ── Title + Status ── */}
              <div className="dock-media-inspector__title-block">
                {editingEntryLabelKey === entry.key ? (
                  <div
                    className="dock-media-inspector__title-editing"
                    onBlur={(event) => {
                      const nextFocus = event.relatedTarget;
                      if (!nextFocus || !event.currentTarget.contains(nextFocus as Node)) {
                        commitEntryLabel(entry);
                      }
                    }}
                  >
                    <input
                      type="text"
                      className="dock-input dock-media-inspector__title-input"
                      value={entryLabelDraft}
                      onChange={(event) => setEntryLabelDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitEntryLabel(entry);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingEntryLabelKey(null);
                        }
                      }}
                      aria-label={t('media.label')}
                      autoFocus
                    />
                    <div className="dock-media-inspector__title-actions">
                      <button
                        type="button"
                        className="dock-media-inspector__title-action dock-media-inspector__title-action--confirm"
                        onClick={() => commitEntryLabel(entry)}
                        aria-label={t('common.save')}
                        title={t('common.save')}
                      >
                        <Icon name="check" size={12} />
                      </button>
                      <button
                        type="button"
                        className="dock-media-inspector__title-action dock-media-inspector__title-action--cancel"
                        onClick={() => setEditingEntryLabelKey(null)}
                        aria-label={t('common.cancel')}
                        title={t('common.cancel')}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 id="dock-media-inspector-title" className="dock-media-inspector__title">{cleanName}</h2>
                    <button
                      type="button"
                      className="dock-media-inspector__title-edit"
                      onClick={() => beginEntryLabelEdit(entry)}
                      aria-label={t('common.edit')}
                      title={t('common.edit')}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  </>
                )}
              </div>

              {/* ── Actions ── */}
              {!presentationLinkMode && (
                <div className="dock-media-inspector__actions">
                  <div className="dock-media-inspector__send-row">
                    <select
                      className="dock-input dock-media-inspector__scene-select"
                      value={sceneSendSelection}
                      onChange={(event) => setSceneSendSelection(event.target.value)}
                      disabled={sceneSendLoading || sceneSendSubmitting || sceneSendChoices.length === 0}
                      aria-label={t('media.scene')}
                    >
                      {sceneSendChoices.length === 0 ? (
                        <option value="">{sceneSendLoading ? t('media.loadingScenes') : t('media.noScenesAvailable')}</option>
                      ) : (
                        sceneSendChoices.map((sceneName) => (
                          <option key={sceneName} value={sceneName}>{sceneName}</option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      className="dock-media-inspector__action-btn dock-media-inspector__action-btn--primary"
                      onClick={() => {
                        void (async () => {
                          const success = await sendEntryToSelectedScene(entry);
                          if (success) closeEntryOptions();
                        })();
                      }}
                      disabled={sceneSendLoading || sceneSendSubmitting || !sceneSendSelection}
                      title={t('media.sendToScene')}>
                      <Icon name="send" size={14} />
                      {sceneSendSubmitting ? t('media.sending') : t('media.sendToScene')}
                    </button>
                  </div>
                  {sceneSendError ? <p className="dock-dialog__error">{sceneSendError}</p> : null}
                </div>
              )}

              <div className={`dock-media-inspector__options${entry.kind === "video" ? " dock-media-inspector__options--with-audio" : ""}`}>
                {/* ── Display ── */}
                <div className="dock-media-inspector__card">
                  <h4 className="dock-media-inspector__card-title">{t('media.display')}</h4>
                  <div className="dock-media-inspector__segmented" role="group" aria-label={t('media.display')}>
                    {["cover", "contain", "stretch"].map((option) => {
                      const fitMode = option as DockMediaFitMode;
                      const isActiveFit = (entryPrefs.fitMode ?? "cover") === fitMode;
                      const icons: Record<DockMediaFitMode, string> = { cover: "crop", contain: "fit_screen", stretch: "aspect_ratio" };
                      const fitTitles: Record<DockMediaFitMode, string> = { cover: t('media.fillScreen'), contain: t('media.fitWithinScreen'), stretch: t('media.stretchToScreen') };
                      return (
                        <button
                          key={fitMode}
                          type="button"
                          className={`dock-media-inspector__seg-btn${isActiveFit ? " dock-media-inspector__seg-btn--active" : ""}`}
                          onClick={() => void setEntryFitMode(entry, fitMode)}
                          title={fitTitles[fitMode]}
                          aria-pressed={isActiveFit}
                        >
                          <Icon name={icons[fitMode]} size={12} />
                          {formatFitMode(fitMode, t)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Audio ── */}
                {entry.kind === "video" && (
                  <div className="dock-media-inspector__card">
                    <h4 className="dock-media-inspector__card-title">{t('media.audio')}</h4>
                    <div className="dock-media-inspector__chips" role="group" aria-label={t('media.audio')}>
                      <button
                        type="button"
                        className={`dock-media-inspector__chip${!(entryPrefs.videoMuted ?? true) ? " dock-media-inspector__chip--active" : ""}`}
                        disabled={sendingFile === entry.playingKey}
                        onClick={() => void toggleVideoMute(entry)}
                        title={t('media.muted')}
                        aria-pressed={!(entryPrefs.videoMuted ?? true)}>
                        <Icon name={(entryPrefs.videoMuted ?? true) ? "volume_off" : "volume_up"} size={12} />
                        {(entryPrefs.videoMuted ?? true) ? t('media.muted') : t('media.audioOn')}
                      </button>
                      <button
                        type="button"
                        className={`dock-media-inspector__chip${(entryPrefs.loop ?? true) ? " dock-media-inspector__chip--active" : ""}`}
                        disabled={sendingFile === entry.playingKey}
                        onClick={() => void setEntryLoop(entry, !(entryPrefs.loop ?? true))}
                        title={t('media.loop')}
                        aria-pressed={entryPrefs.loop ?? true}>
                        <Icon name="refresh" size={12} />
                        {(entryPrefs.loop ?? true) ? t('media.loop') : t('media.once')}
                      </button>
                    </div>
                  </div>
                )}
                {entry.kind === "video" && (
                  <div className="dock-media-inspector__card dock-media-inspector__card--full">
                    <h4 className="dock-media-inspector__card-title">{t('media.videoSettings', 'Video settings')}</h4>
                    <div className="dock-media-inspector__toggle-list">
                      <label className="dock-media-inspector__toggle-row">
                        <input
                          type="checkbox"
                          checked={restartOnActivate}
                          onChange={(event) => void setEntryVideoSourceSetting(
                            entry,
                            { restartOnActivate: event.target.checked },
                            { restartOnActivate: event.target.checked },
                          )}
                        />
                        <span>{t('media.restartWhenShown', 'Restart when shown')}</span>
                      </label>
                      <label className="dock-media-inspector__toggle-row">
                        <input
                          type="checkbox"
                          checked={closeWhenInactive}
                          onChange={(event) => void setEntryVideoSourceSetting(
                            entry,
                            { closeWhenInactive: event.target.checked },
                            { closeWhenInactive: event.target.checked },
                          )}
                        />
                        <span>{t('media.unloadWhenHidden', 'Unload when hidden')}</span>
                      </label>
                      <label className="dock-media-inspector__toggle-row">
                        <input
                          type="checkbox"
                          checked={clearOnMediaEnd}
                          onChange={(event) => void setEntryVideoSourceSetting(
                            entry,
                            { clearOnMediaEnd: event.target.checked },
                            { clearOnMediaEnd: event.target.checked },
                          )}
                        />
                        <span>{t('media.clearWhenFinished', 'Clear when finished')}</span>
                      </label>
                    </div>
                    <label className="dock-media-inspector__select-row">
                      <span>{t('media.playbackSpeed', 'Playback speed')}</span>
                      <select
                        className="dock-input dock-media-inspector__speed-select"
                        value={playbackSpeed}
                        onChange={(event) => {
                          const nextSpeed = Number(event.target.value);
                          void setEntryVideoSourceSetting(entry, { playbackSpeed: nextSpeed }, { playbackSpeed: nextSpeed });
                        }}
                      >
                        {[50, 75, 100, 125, 150, 200].map((speed) => (
                          <option key={speed} value={speed}>{speed}%</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>

              {/* ── Information ── */}


              {/* ── Danger Zone ── */}
              <div className="dock-media-inspector__danger">
                <button
                  type="button"
                  className="dock-media-inspector__delete-btn"
                  onClick={() => { void deleteEntry(entry); closeEntryOptions(); }}
                  title={t('media.delete')}>
                  <Icon name="delete" size={12} />
                  {t('media.delete')} {entry.kind === "video" ? t('media.video') : entry.kind === "audio" ? "audio" : t('common.image')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Playlist Configuration Modal ── */}
      {
        showPlaylistModal && (
          <div className="dock-dialog-backdrop" role="presentation" onClick={() => setShowPlaylistModal(false)}>
            <div
              className="dock-dialog dock-media-playlist-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dock-playlist-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dock-dialog__header">
                <div>
                  <div className="dock-dialog__eyebrow">{t('media.mediaSource')}</div>
                  <h2 id="dock-playlist-title" className="dock-dialog__title">{t('media.createMediaPlaylist')}</h2>
                </div>
                <button type="button" className="dock-dialog__close" onClick={() => setShowPlaylistModal(false)} aria-label={t('common.close')} title={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="dock-dialog__body">
                <div className="dock-playlist-modal__field">
                  <label className="dock-playlist-modal__label">{t('media.sourceName')}</label>
                  <input
                    type="text"
                    className="dock-input"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder={t('media.sourceNamePlaceholder')}
                  />
                </div>
                {selectedVideoEntries.length > 0 && (
                  <div className="dock-playlist-modal__field">
                    <label className="dock-playlist-modal__label">{t('media.videos')} ({selectedVideoEntries.length})</label>
                    <div className="dock-playlist-modal__thumbs">
                      {selectedVideoEntries.map((entry) => entry && (
                        <div key={entry.key} className="dock-playlist-modal__thumb">
                          {entry.thumbnailUrl
                            ? <img src={entry.thumbnailUrl} alt={entry.name} />
                            : <Icon name="movie" size={14} />
                          }
                          <span className="dock-playlist-modal__thumb-name">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedImageEntries.length > 0 && (
                  <div className="dock-playlist-modal__field">
                    <label className="dock-playlist-modal__label">{t('common.images')} ({selectedImageEntries.length})</label>
                    <div className="dock-playlist-modal__thumbs">
                      {selectedImageEntries.map((entry) => entry && (
                        <div key={entry.key} className="dock-playlist-modal__thumb">
                          {entry.thumbnailUrl
                            ? <img src={entry.thumbnailUrl} alt={entry.name} />
                            : <Icon name="image" size={14} />
                          }
                          <span className="dock-playlist-modal__thumb-name">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedAudioEntries.length > 0 && (
                  <div className="dock-playlist-modal__field">
                    <label className="dock-playlist-modal__label">Audio ({selectedAudioEntries.length})</label>
                    <div className="dock-playlist-modal__thumbs">
                      {selectedAudioEntries.map((entry) => (
                        <div key={entry.key} className="dock-playlist-modal__thumb">
                          <Icon name="music_note" size={14} />
                          <span className="dock-playlist-modal__thumb-name">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="dock-playlist-modal__toggles">
                  <label className="dock-playlist-modal__toggle">
                    <input type="checkbox" checked={playlistLoop} onChange={(e) => setPlaylistLoop(e.target.checked)} />
                    <span>{t('media.loopPlaylist')}</span>
                  </label>
                  <label className="dock-playlist-modal__toggle">
                    <input type="checkbox" checked={playlistShuffle} onChange={(e) => setPlaylistShuffle(e.target.checked)} />
                    <span>{t('media.shuffle')}</span>
                  </label>
                  <label className="dock-playlist-modal__toggle">
                    <input type="checkbox" checked={playlistMuted} onChange={(e) => setPlaylistMuted(e.target.checked)} />
                    <span>{t('media.muteAudio')}</span>
                  </label>
                </div>
                <div className="dock-playlist-modal__hint">
                  {selectedAudioEntries.length > 0 && selectedVideoEntries.length === 0 && selectedImageEntries.length === 0
                    ? "Creates a VLC audio playlist source in the current OBS scene."
                    : selectedVideoEntries.length > 0 && selectedImageEntries.length > 0
                    ? t('media.playlistHintBoth')
                    : selectedVideoEntries.length > 0
                      ? t('media.playlistHintVideos')
                      : t('media.playlistHintImages')
                  }
                </div>
              </div>
              <div className="dock-dialog__footer">
                <button type="button" className="dock-btn dock-btn--compact" onClick={() => setShowPlaylistModal(false)} title={t('common.cancel')}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="dock-btn dock-btn--primary dock-btn--compact"
                  onClick={() => void handleCreateVlcPlaylist()}
                  disabled={selectedKeys.size === 0}
                  title={t('media.create')}>
                  <Icon name="playlist_add" size={12} />
                  {t('media.create')}{selectedAudioEntries.length > 0 && selectedVideoEntries.length === 0 && selectedImageEntries.length === 0 ? " audio playlist" : selectedVideoEntries.length > 0 && selectedImageEntries.length > 0 ? t('media.createBoth') : selectedVideoEntries.length > 0 ? t('media.createVlcSource') : t('media.createSlideshow')}
                </button>
              </div>
            </div>
          </div>
        )
      }

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Preview Modal ── */}
      {
        previewEntry && (
          <div
            className="dock-dialog-backdrop"
            onClick={() => setPreviewEntry(null)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <div
              className="dock-media-preview-modal"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                maxWidth: "90vw",
                maxHeight: "85vh",
                background: "#000",
                borderRadius: 6,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--dock-surface)" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dock-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                  {previewEntry.name}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewEntry(null)}
                  style={{ background: "none", border: "none", color: "var(--dock-text-dim)", cursor: "pointer", padding: 4, display: "flex" }}
                  title={t('common.close')}>
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 12, minHeight: 200 }}>
                {previewEntry.kind === "video" ? (
                  <video
                    ref={previewVideoRef}
                    src={previewEntry.previewUrl}
                    controls
                    autoPlay
                    muted={getEntryPrefs(previewEntry).videoMuted ?? true}
                    loop={getEntryPrefs(previewEntry).loop ?? true}
                    style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 4 }}
                  />
                ) : previewEntry.kind === "audio" ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 20,
                      padding: "32px 24px",
                      width: "100%",
                      minWidth: 320,
                      maxWidth: 480,
                    }}
                  >
                    <div
                      style={{
                        width: 96,
                        height: 96,
                        borderRadius: "50%",
                        background: "var(--surface-raised)",
                        border: "2px solid rgba(59, 130, 246, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--accent-blue)",
                        boxShadow: "0 8px 24px rgba(37, 99, 235, 0.25)",
                      }}
                    >
                      <Icon name="music_note" size={48} />
                    </div>
                    <div style={{ textAlign: "center", width: "100%" }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          marginBottom: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {previewEntry.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--dock-text-dim, #94a3b8)" }}>
                        {t("media.audio", "Audio")}
                      </div>
                    </div>
                    <audio
                      src={previewEntry.previewUrl}
                      controls
                      autoPlay
                      style={{ width: "100%", borderRadius: 8, outline: "none" }}
                    />
                  </div>
                ) : (
                  <img
                    src={previewEntry.previewUrl || previewEntry.thumbnailUrl || ""}
                    alt={previewEntry.name}
                    style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 4, objectFit: "contain" }}
                  />
                )}
              </div>
            </div>
          </div>
        )
      }

      {!presentationLinkMode && sceneSendEntry && (
        <div className="dock-dialog-backdrop" role="presentation" onClick={closeSceneSendDialog}>
          <div
            className="dock-dialog dock-dialog--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dock-media-send-scene-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dock-dialog__header">
              <h2 id="dock-media-send-scene-title" className="dock-dialog__title">{t('media.sendToScene')}</h2>
              <button
                type="button"
                className="dock-dialog__close"
                onClick={closeSceneSendDialog}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <div className="dock-dialog-field">
                <label className="dock-dialog-field__label" htmlFor="dock-media-send-scene-select">{t('media.scene')}</label>
                <select
                  id="dock-media-send-scene-select"
                  className="dock-input"
                  value={sceneSendSelection}
                  onChange={(event) => setSceneSendSelection(event.target.value)}
                  disabled={sceneSendLoading || sceneSendSubmitting || sceneSendChoices.length === 0}
                >
                  {sceneSendChoices.length === 0 ? (
                    <option value="">{sceneSendLoading ? t('media.loadingScenes') : t('media.noScenesAvailable')}</option>
                  ) : (
                    sceneSendChoices.map((sceneName) => (
                      <option key={sceneName} value={sceneName}>{sceneName}</option>
                    ))
                  )}
                </select>
              </div>
              {sceneSendEntry ? (
                <p className="dock-media-clear-confirm__summary" style={{ marginTop: 12 }}>
                  {sceneSendEntry.name}
                </p>
              ) : null}
              {sceneSendError ? <p className="dock-dialog__error">{sceneSendError}</p> : null}
            </div>
            <div className="dock-dialog__footer">
              <button
                type="button"
                className="dock-btn dock-btn--compact"
                onClick={closeSceneSendDialog}
                disabled={sceneSendSubmitting}
                title={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--primary dock-btn--compact"
                onClick={() => void handleSendMediaToSelectedScene()}
                disabled={sceneSendLoading || sceneSendSubmitting || !sceneSendSelection}
                title={t('media.sendToScene')}
              >
                <Icon name="send" size={12} />
                {sceneSendSubmitting ? t('media.sending') : t('media.sendToScene')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mediaContextMenu && (() => {
        const contextEntry = mediaContextMenu.entry;
        const contextPrefs = getEntryPrefs(contextEntry);
        const contextDisplayName = contextPrefs.label?.trim() || contextEntry.name;
        const contextFolder = contextPrefs.folder?.trim() || "";
        const contextPinned = Boolean(contextPrefs.pinned);

        return (
          <div
            className="dock-media-context-menu"
            role="menu"
            style={{ left: mediaContextMenu.x, top: mediaContextMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="dock-media-context-menu__header">
              <Icon name={getFileIcon(contextEntry.kind)} size={16} />
              <span title={contextDisplayName}>{contextDisplayName}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item"
              onClick={() => {
                const thumb =
                  contextEntry.thumbnailUrl ||
                  contextEntry.previewUrl ||
                  contextEntry.libraryItem?.thumbnailUrl ||
                  contextEntry.libraryItem?.url ||
                  contextEntry.libraryItem?.filePath;
                addMediaToActiveSchedule({
                  id: contextEntry.libraryItem?.id || contextEntry.key,
                  name: contextDisplayName,
                  filePath: contextEntry.libraryItem?.filePath || contextEntry.previewUrl || contextEntry.libraryItem?.url || "",
                  fileName: contextEntry.libraryItem?.diskFileName || contextEntry.libraryItem?.name || contextEntry.name,
                  mediaType: contextEntry.kind === "video" ? "video" : "image",
                  thumbnailUrl: thumb,
                  previewUrl: contextEntry.previewUrl || contextEntry.libraryItem?.url,
                });
                setMediaContextMenu(null);
              }}
            >
              <Icon name="playlist_add" size={16} />
              <span className="dock-media-context-menu__label">{t('schedule.addToSchedule', 'Add to Schedule')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item"
              onClick={() => {
                setOpenOptionsKey(contextEntry.key);
                beginEntryLabelEdit(contextEntry);
                setMediaContextMenu(null);
              }}
            >
              <Icon name="edit" size={16} />
              <span className="dock-media-context-menu__label">{t('common.rename')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item"
              onClick={() => toggleMediaPinned(contextEntry)}
            >
              <Icon name="push_pin" size={16} />
              <span className="dock-media-context-menu__label">
                {contextPinned ? t('media.unpin', 'Unpin') : t('media.pin', 'Pin')}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item"
              onClick={() => {
                setPreviewEntry(contextEntry);
                setMediaContextMenu(null);
              }}
            >
              <Icon name="open_in_full" size={16} />
              <span className="dock-media-context-menu__label">{t('common.preview')}</span>
            </button>
            {contextEntry.kind === "video" && (
              <button
                type="button"
                role="menuitem"
                className="dock-media-context-menu__item"
                onClick={() => {
                  setPreviewPlaying(false);
                  setOpenOptionsKey(contextEntry.key);
                  setMediaContextMenu(null);
                }}
              >
                <Icon name="settings" size={16} />
                <span className="dock-media-context-menu__label">{t('media.settings', 'Settings')}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item"
              onClick={() => void downloadMediaEntry(contextEntry)}
              disabled={downloadingMediaKey === contextEntry.key}
              title={t('media.downloadAsset')}
            >
              <Icon name={downloadingMediaKey === contextEntry.key ? "downloading" : "download"} size={16} />
              <span className="dock-media-context-menu__label">
                {downloadingMediaKey === contextEntry.key ? t('media.downloadProgress') : t('media.downloadAsset')}
              </span>
            </button>
            {!presentationLinkMode && canSendEntryToScene(contextEntry) && (
              <button
                type="button"
                role="menuitem"
                className="dock-media-context-menu__item"
                onClick={() => {
                  void openSceneSendDialog(contextEntry);
                  setMediaContextMenu(null);
                }}
              >
                <Icon name="send" size={16} />
                <span className="dock-media-context-menu__label">{t('media.sendToScene')}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              aria-expanded={mediaContextFolderOpen}
              className="dock-media-context-menu__item"
              onClick={() => setMediaContextFolderOpen((current) => !current)}
            >
              <Icon name="folder" size={16} />
              <span className="dock-media-context-menu__label">{t('media.addToFolder', 'Add to folder')}</span>
              <Icon name={mediaContextFolderOpen ? "expand_less" : "expand_more"} size={16} />
            </button>
            {mediaContextFolderOpen && (
              <div className="dock-media-context-menu__folders">
                <button
                  type="button"
                  role="menuitem"
                  className={`dock-media-context-menu__folder${!contextFolder ? " dock-media-context-menu__folder--active" : ""}`}
                  onClick={() => assignMediaFolder(contextEntry, null)}
                >
                  <Icon name="folder_off" size={14} />
                  <span className="dock-media-context-menu__label">{t('media.noFolder', 'No folder')}</span>
                </button>
                {mediaFolders.map((folder) => (
                  <button
                    type="button"
                    role="menuitem"
                    className={`dock-media-context-menu__folder${contextFolder === folder ? " dock-media-context-menu__folder--active" : ""}`}
                    key={folder}
                    onClick={() => assignMediaFolder(contextEntry, folder)}
                  >
                    <Icon name="folder" size={14} />
                    <span title={folder}>{folder}</span>
                    {contextFolder === folder && <Icon name="check" size={14} />}
                  </button>
                ))}
                <div className="dock-media-context-menu__new-folder">
                  <input
                    type="text"
                    value={newFolderDraft}
                    onChange={(event) => setNewFolderDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        createMediaFolder(contextEntry);
                      }
                    }}
                    placeholder={t('media.folderNamePlaceholder', 'New folder name')}
                    aria-label={t('media.folderNamePlaceholder', 'New folder name')}
                  />
                  <button
                    type="button"
                    aria-label={t('media.createFolder', 'Create folder')}
                    title={t('media.createFolder', 'Create folder')}
                    disabled={!newFolderDraft.trim()}
                    onClick={() => createMediaFolder(contextEntry)}
                  >
                    <Icon name="add" size={16} />
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              className="dock-media-context-menu__item dock-media-context-menu__item--danger"
              onClick={() => {
                void deleteEntry(contextEntry);
                setMediaContextMenu(null);
              }}
            >
              <Icon name="delete" size={16} />
              <span className="dock-media-context-menu__label">
                {contextEntry.kind === "video"
                  ? t('media.deleteVideo')
                  : contextEntry.kind === "audio"
                  ? t('media.deleteAudio', 'Delete Audio')
                  : t('media.deleteImage')}
              </span>
            </button>
          </div>
        );
      })()}

      {/* ── Clear All Confirmation Dialog ── */}
      {showClearAllConfirm && (() => {
        const totalCount = mediaEntries.length;
        return (
          <div className="dock-dialog-backdrop" role="presentation" onClick={() => setShowClearAllConfirm(false)}>
            <div
              className="dock-dialog dock-media-clear-confirm"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dock-dialog__header">
                <h2 className="dock-dialog__title">{t('media.clearAllMedia')}</h2>
                <button type="button" className="dock-dialog__close" onClick={() => setShowClearAllConfirm(false)} aria-label={t('common.close')} title={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="dock-dialog__body">
                <p className="dock-media-clear-confirm__summary">
                  {t('media.clearAllSummary', { count: totalCount, item: totalCount === 1 ? t('media.upload') : t('media.uploads') })}
                </p>
              </div>
              <div className="dock-dialog__footer">
                <button type="button" className="dock-btn dock-btn--compact" onClick={() => setShowClearAllConfirm(false)} title={t('common.cancel')}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="dock-btn dock-btn--danger dock-btn--compact" onClick={() => void clearAllMedia()} title={t('media.clearAll')}>
                  <Icon name="delete_sweep" size={12} />
                  {t('media.clearAll')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div >
  );
}

export default memo(DockMediaTab);
