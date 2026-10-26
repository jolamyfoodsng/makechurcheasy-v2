import {
  hydrateNativeDockSettings,
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../services/localDockSettings";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import type { CountdownConfig } from "../countdowns/types";
import type { Song } from "../worship/types";

export const DOCK_SESSION_FORMAT = "makechurch-easy-dock-session";
export const DOCK_SESSION_VERSION = 1;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type StorageScope = "user" | "global";
type StorageEncoding = "json" | "text";

type DockSessionSectionId =
  | "dock"
  | "bible"
  | "worship"
  | "notes"
  | "media"
  | "ministry"
  | "multiview"
  | "sermon"
  | "pre-service";

interface TransferKeyDefinition {
  baseKey: string;
  scope: StorageScope;
}

interface DockSessionStorageEntry {
  scope: StorageScope;
  encoding: StorageEncoding;
  value: JsonValue | string;
}

export interface DockSessionSection {
  id: DockSessionSectionId;
  label: string;
  storage: Record<string, DockSessionStorageEntry>;
}

interface DockSessionRecords {
  worshipSongs: JsonValue[];
  countdowns: JsonValue[];
  mediaLibrary: JsonValue[];
  multiview: {
    layouts: JsonValue[];
    assets: JsonValue[];
    media: JsonValue[];
    mappings: JsonValue[];
  };
}

export interface DockSessionExport {
  _format: typeof DOCK_SESSION_FORMAT;
  _version: typeof DOCK_SESSION_VERSION;
  _exportedAt: string;
  app: {
    activeTab: string;
    disabledTabs: string[];
    colorMode: string;
    appearance: JsonValue | null;
    typography: JsonValue | null;
  };
  sections: DockSessionSection[];
  records: DockSessionRecords;
  /** Studio settings (panel layout, text size, camera, saved verse queue…), kept as raw strings. */
  studio?: Record<string, string>;
  warnings: string[];
}

export interface DockSessionApplyOptions {
  /** Keep what is already on this computer and only add what is missing. */
  merge?: boolean;
}

export interface DockSessionImportResult {
  sectionCount: number;
  storageEntryCount: number;
  restored: {
    worshipSongs: number;
    countdowns: number;
    media: number;
    layouts: number;
    assets: number;
    multiviewMedia: number;
    mappings: number;
  };
  warnings: string[];
}

const SECTION_DEFINITIONS: ReadonlyArray<{
  id: DockSessionSectionId;
  label: string;
  keys: readonly TransferKeyDefinition[];
}> = [
  {
    id: "dock",
    label: "Dock appearance and session",
    keys: [
      { baseKey: "ocs-app-appearance", scope: "user" },
      { baseKey: "obs-church-studio.theme-preference", scope: "user" },
      { baseKey: "ocs-dock-typography", scope: "user" },
      { baseKey: "ocs-dock-font-family", scope: "user" },
      { baseKey: "ocs-dock-font-scale", scope: "user" },
      { baseKey: "ocs-dock-output-typography", scope: "user" },
      { baseKey: "ocs-dock-shell-preferences", scope: "global" },
      { baseKey: "ocs-dock-projection-settings", scope: "user" },
      { baseKey: "ocs-production-mode-settings", scope: "user" },
      { baseKey: "ocs-dock-staged-item", scope: "global" },
      { baseKey: "mce_interface_language", scope: "global" },
      { baseKey: "ocs-lm-dock-settings", scope: "user" },
      { baseKey: "ocs-speech-to-scripture-mic-id", scope: "user" },
    ],
  },
  {
    id: "bible",
    label: "Bible text and Bible appearance",
    keys: [
      { baseKey: "ocs-dock-bible-preferences", scope: "user" },
      { baseKey: "ocs-dock-bible-ui-preferences", scope: "user" },
      { baseKey: "ocs-dock-bible-recent-searches-v1", scope: "user" },
      { baseKey: "ocs-dock-bible-history-v1", scope: "user" },
      { baseKey: "ocs-bible-custom-themes", scope: "user" },
      { baseKey: "ocs-fav-bible-themes", scope: "user" },
      ...backgroundPickerTransferKeys(["bible"]),
    ],
  },
  {
    id: "worship",
    label: "Lyrics and worship text",
    keys: [
      { baseKey: "ocs-dock-worship-preferences", scope: "user" },
      { baseKey: "dock-worship-preferences", scope: "user" },
      { baseKey: "ocs-dock-worship-ui-preferences", scope: "user" },
      { baseKey: "ocs-dock-worship-song-defaults-v1", scope: "user" },
      { baseKey: "ocs-dock-worship-cached-songs-v1", scope: "user" },
      { baseKey: "ocs-dock-worship-recent-searches-v1", scope: "user" },
      { baseKey: "ocs-fav-worship-lt-themes", scope: "user" },
      { baseKey: "ocs-worship-layout-prefs", scope: "user" },
      ...backgroundPickerTransferKeys(["worship"]),
    ],
  },
  {
    id: "notes",
    label: "Notes and note appearance",
    keys: [
      { baseKey: "ocs-dock-notes-v1", scope: "user" },
      { baseKey: "ocs-dock-notes-v1-saved-at", scope: "user" },
      { baseKey: "ocs-dock-notes-preferences", scope: "user" },
      ...backgroundPickerTransferKeys(["notes"]),
    ],
  },
  {
    id: "media",
    label: "Media and text overlays",
    keys: [
      { baseKey: "ocs-dock-media-preferences-v1", scope: "user" },
      { baseKey: "ocs-dock-media-library-v1", scope: "user" },
      { baseKey: "ocs-dock-media-session-v1", scope: "global" },
    ],
  },
  {
    id: "ministry",
    label: "Ministry ticker and lower thirds",
    keys: [
      { baseKey: "dock-ticker-messages", scope: "user" },
      { baseKey: "dock-ticker-settings", scope: "user" },
      { baseKey: "ocs.ticker-messages", scope: "user" },
      { baseKey: "ocs.ticker-settings", scope: "user" },
      { baseKey: "dock-bible-lt-color-overrides", scope: "user" },
      { baseKey: "ocs-fav-ticker-themes", scope: "user" },
      { baseKey: "ocs-ticker-templates", scope: "user" },
      { baseKey: "service-hub.speaker.presets", scope: "user" },
      { baseKey: "service-hub.speaker.theme-order", scope: "user" },
      { baseKey: "service-hub.lt.presets", scope: "user" },
      { baseKey: "service-hub.lt.version-history", scope: "user" },
      { baseKey: "dock-ministry-lower-third-size", scope: "user" },
      { baseKey: "dock-scene-routing-v1", scope: "user" },
      { baseKey: "ocs-lt-global-defaults", scope: "user" },
      { baseKey: "ocs-lt-duration-configs", scope: "user" },
      { baseKey: "dock-lt-saved", scope: "user" },
      { baseKey: "ocs-fav-obs-themes", scope: "user" },
    ],
  },
  {
    id: "multiview",
    label: "Multi-View layouts and settings",
    keys: [
      { baseKey: "dock-mv-saved", scope: "user" },
      { baseKey: "dock-mv-layouts", scope: "user" },
      { baseKey: "mvg-added-ids", scope: "user" },
      { baseKey: "mv-settings", scope: "user" },
      { baseKey: "mv-recovery-layout", scope: "user" },
      { baseKey: "mv-onboarding-complete", scope: "user" },
      { baseKey: "mv-templates-dashboard-settings-v1", scope: "global" },
      { baseKey: "mce-presentation-text-slides", scope: "user" },
      { baseKey: "mce-presentation-tickers", scope: "user" },
    ],
  },
  {
    id: "sermon",
    label: "Sermon notes",
    keys: [
      { baseKey: "ocs-dock-sermon-items-v1", scope: "user" },
      { baseKey: "ocs-dock-sermon", scope: "user" },
      { baseKey: "ocs-dock-sermon-view-v1", scope: "user" },
      { baseKey: "ocs-dock-sermon-theme-prefs-v1", scope: "user" },
      { baseKey: "ocs-dock-sermon-theme-settings-v1", scope: "user" },
      { baseKey: "ocs-dock-sermon-history-v1", scope: "user" },
    ],
  },
  {
    id: "pre-service",
    label: "Pre-service plan",
    keys: [
      { baseKey: "preservice.plan", scope: "user" },
      { baseKey: "preservice.runtime", scope: "user" },
      { baseKey: "preservice.audioLibrary", scope: "user" },
    ],
  },
];

const ALLOWED_STORAGE_KEYS = new Map(
  SECTION_DEFINITIONS.flatMap((section) => section.keys.map((definition) => [definition.baseKey, definition] as const)),
);

function backgroundPickerTransferKeys(scopes: readonly string[]): TransferKeyDefinition[] {
  return scopes.flatMap((scope) => ["fullscreen", "lower-third"].flatMap((overlayMode) => [
    { baseKey: `dtb-bg-picker-tab:${scope}:${overlayMode}`, scope: "user" as const },
    { baseKey: `dtb-bg-picker-type:${scope}:${overlayMode}`, scope: "user" as const },
    { baseKey: `dtb-bg-picker-local-styles:${scope}:${overlayMode}`, scope: "user" as const },
  ]));
}

const STUDIO_KEY_PATTERN = /^mce[-.]studio[-.]/;
/** Machine-specific: which monitor the output sits on. */
const STUDIO_SKIP_KEYS = new Set(["mce-studio-output-monitor"]);

function isStudioKey(key: string): boolean {
  return STUDIO_KEY_PATTERN.test(key) && !STUDIO_SKIP_KEYS.has(key);
}

function collectStudioSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !isStudioKey(key)) continue;
      const value = localStorage.getItem(key);
      if (typeof value === "string") out[key] = value;
    }
  } catch {
    // Storage blocked: the Studio settings are simply not exported.
  }
  return out;
}

function normalizeStudio(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isStudioKey(key) && typeof item === "string") out[key] = item;
  }
  return Object.keys(out).length ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

function sanitizeJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item));
  if (isRecord(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (/^(?:password|obspassword|secret|devicesecret|accesstoken|refreshtoken|apikey)$/i.test(key)) continue;
      output[key] = sanitizeJsonValue(item);
    }
    return output;
  }
  return null;
}

function readStorageEntry(definition: TransferKeyDefinition): DockSessionStorageEntry | null {
  const value = readNativeDockSetting<unknown>(definition.baseKey);
  if (value === undefined) return null;
  if (typeof value === "string") {
    return {
      scope: definition.scope,
      encoding: "text",
      value,
    };
  }
  return {
    scope: definition.scope,
    encoding: "json",
    value: sanitizeJsonValue(value),
  };
}

function readJsonStorageValue(baseKey: string, scope: StorageScope): JsonValue | null {
  const definition = { baseKey, scope } satisfies TransferKeyDefinition;
  const entry = readStorageEntry(definition);
  return entry?.encoding === "json" && isJsonValue(entry.value) ? entry.value : null;
}

function sectionSnapshot(definition: (typeof SECTION_DEFINITIONS)[number]): DockSessionSection {
  const storage: Record<string, DockSessionStorageEntry> = {};
  for (const keyDefinition of definition.keys) {
    const entry = readStorageEntry(keyDefinition);
    if (entry) storage[keyDefinition.baseKey] = entry;
  }
  return {
    id: definition.id,
    label: definition.label,
    storage,
  };
}

function sanitizeMediaRecord(value: unknown): JsonValue | null {
  if (!isRecord(value)) return null;
  const copy = { ...value };
  // Thumbnails are regenerated by the media library and can make a session
  // file unnecessarily large. The actual media reference and settings stay.
  delete copy.thumbnailUrl;
  delete copy.thumbnail;
  return sanitizeJsonValue(copy);
}

async function collectMultiViewRecords(): Promise<DockSessionRecords["multiview"]> {
  try {
    const {
      getUserLayouts,
      getAllAssets,
      getAllMedia,
      getMapping,
    } = await import("../multiview/mvStore");
    const layouts = await getUserLayouts();
    const [assets, media, mappings] = await Promise.all([
      getAllAssets(),
      getAllMedia(),
      Promise.all(layouts.map((layout) => getMapping(layout.id))),
    ]);
    return {
      layouts: layouts.map((layout) => sanitizeJsonValue({ ...layout, thumbnail: undefined })),
      assets: assets.map((asset) => sanitizeJsonValue(asset)),
      media: media.map((item) => sanitizeJsonValue({ ...item, thumbnail: undefined, previewSrc: item.filePath })),
      mappings: mappings.filter(Boolean).map((mapping) => sanitizeJsonValue(mapping)),
    };
  } catch {
    return { layouts: [], assets: [], media: [], mappings: [] };
  }
}

async function collectMediaRecords(): Promise<JsonValue[]> {
  try {
    const { getAllMedia } = await import("../library/libraryDb");
    return (await getAllMedia())
      .map((item) => sanitizeMediaRecord(item))
      .filter((item): item is JsonValue => item !== null);
  } catch {
    return [];
  }
}

async function collectWorshipSongs(): Promise<JsonValue[]> {
  try {
    const { getAllSongs } = await import("../worship/worshipDb");
    return (await getAllSongs()).map((song) => {
      const copy = { ...song } as Record<string, unknown>;
      delete copy.userId;
      return sanitizeJsonValue(copy);
    });
  } catch {
    return [];
  }
}

async function collectCountdowns(): Promise<JsonValue[]> {
  try {
    const { getCountdowns } = await import("../countdowns/countdownStore");
    return (await getCountdowns()).map((countdown) => sanitizeJsonValue(countdown));
  } catch {
    return [];
  }
}

export async function createDockSessionExport(): Promise<DockSessionExport> {
  await hydrateNativeDockSettings().catch(() => undefined);
  const sections = SECTION_DEFINITIONS.map(sectionSnapshot);
  const [mediaLibrary, worshipSongs, countdowns, multiview] = await Promise.all([
    collectMediaRecords(),
    collectWorshipSongs(),
    collectCountdowns(),
    collectMultiViewRecords(),
  ]);
  const shellPreferences = readJsonStorageValue("ocs-dock-shell-preferences", "global");
  const typography = readJsonStorageValue("ocs-dock-typography", "user");
  const appearance = readJsonStorageValue("ocs-app-appearance", "user");
  const colorModeEntry = readStorageEntry({
    baseKey: "obs-church-studio.theme-preference",
    scope: "user",
  });

  const warnings = [
    "Media, Multi-View, and countdown files are referenced by their saved paths; the JSON file does not copy binary media files.",
  ];
  if (
    mediaLibrary.length === 0
    && worshipSongs.length === 0
    && countdowns.length === 0
    && multiview.layouts.length === 0
    && multiview.assets.length === 0
    && multiview.media.length === 0
  ) {
    warnings.length = 0;
  }

  const shell = isRecord(shellPreferences) ? shellPreferences : {};
  const studio = collectStudioSettings();
  return {
    _format: DOCK_SESSION_FORMAT,
    _version: DOCK_SESSION_VERSION,
    _exportedAt: new Date().toISOString(),
    app: {
      activeTab: typeof shell.activeTab === "string" ? shell.activeTab : "bible",
      disabledTabs: Array.isArray(shell.disabledTabs)
        ? shell.disabledTabs.filter((tab): tab is string => typeof tab === "string")
        : [],
      colorMode: colorModeEntry?.encoding === "text" && typeof colorModeEntry.value === "string"
        ? colorModeEntry.value
        : "dark",
      appearance,
      typography,
    },
    sections,
    records: {
      worshipSongs,
      countdowns,
      mediaLibrary,
      multiview,
    },
    ...(Object.keys(studio).length ? { studio } : {}),
    warnings,
  };
}

function isSectionId(value: unknown): value is DockSessionSectionId {
  return SECTION_DEFINITIONS.some((definition) => definition.id === value);
}

function normalizeStorageEntry(value: unknown): DockSessionStorageEntry | null {
  if (!isRecord(value)) return null;
  const scope = value.scope === "global" ? "global" : value.scope === "user" ? "user" : null;
  const encoding = value.encoding === "json" ? "json" : value.encoding === "text" ? "text" : null;
  if (!scope || !encoding) return null;
  if (encoding === "text" && typeof value.value !== "string") return null;
  if (encoding === "json" && !isJsonValue(value.value)) return null;
  return {
    scope,
    encoding,
    value: value.value as JsonValue | string,
  };
}

function normalizeSections(value: unknown): DockSessionSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((sectionValue) => {
    if (!isRecord(sectionValue) || !isSectionId(sectionValue.id)) return [];
    const definition = SECTION_DEFINITIONS.find((item) => item.id === sectionValue.id);
    if (!definition || !isRecord(sectionValue.storage)) return [];
    const storage: Record<string, DockSessionStorageEntry> = {};
    for (const [baseKey, rawEntry] of Object.entries(sectionValue.storage)) {
      const allowed = ALLOWED_STORAGE_KEYS.get(baseKey);
      const entry = normalizeStorageEntry(rawEntry);
      if (!allowed || !entry || entry.scope !== allowed.scope) continue;
      storage[baseKey] = entry;
    }
    return [{ id: definition.id, label: definition.label, storage }];
  });
}

function normalizeJsonArray(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonValue => isJsonValue(item));
}

function normalizeRecords(value: unknown): DockSessionRecords {
  if (!isRecord(value)) {
    return {
      worshipSongs: [],
      countdowns: [],
      mediaLibrary: [],
      multiview: { layouts: [], assets: [], media: [], mappings: [] },
    };
  }
  const multiview = isRecord(value.multiview) ? value.multiview : {};
  return {
    worshipSongs: normalizeJsonArray(value.worshipSongs),
    countdowns: normalizeJsonArray(value.countdowns),
    mediaLibrary: normalizeJsonArray(value.mediaLibrary),
    multiview: {
      layouts: normalizeJsonArray(multiview.layouts),
      assets: normalizeJsonArray(multiview.assets),
      media: normalizeJsonArray(multiview.media),
      mappings: normalizeJsonArray(multiview.mappings),
    },
  };
}

function normalizeApp(value: unknown): DockSessionExport["app"] {
  const app = isRecord(value) ? value : {};
  return {
    activeTab: typeof app.activeTab === "string" ? app.activeTab : "bible",
    disabledTabs: Array.isArray(app.disabledTabs)
      ? app.disabledTabs.filter((tab): tab is string => typeof tab === "string")
      : [],
    colorMode: typeof app.colorMode === "string" ? app.colorMode : "dark",
    appearance: isJsonValue(app.appearance) ? app.appearance : null,
    typography: isJsonValue(app.typography) ? app.typography : null,
  };
}

export function parseDockSessionJSON(jsonString: string): DockSessionExport {
  if (jsonString.length > 25 * 1024 * 1024) {
    throw new Error("This Dock session file is too large to import.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed._format !== DOCK_SESSION_FORMAT) {
    throw new Error("This is not a MakeChurchEazy Dock session file.");
  }
  if (parsed._version !== DOCK_SESSION_VERSION) {
    throw new Error(`Unsupported Dock session version: ${String(parsed._version ?? "unknown")}.`);
  }

  return {
    _format: DOCK_SESSION_FORMAT,
    _version: DOCK_SESSION_VERSION,
    _exportedAt: typeof parsed._exportedAt === "string" ? parsed._exportedAt : new Date().toISOString(),
    app: normalizeApp(parsed.app),
    sections: normalizeSections(parsed.sections),
    records: normalizeRecords(parsed.records),
    ...(normalizeStudio(parsed.studio) ? { studio: normalizeStudio(parsed.studio) } : {}),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

function prepareImportedValue(value: JsonValue): JsonValue {
  if (!isRecord(value) || Array.isArray(value)) return value;
  if (!("updatedAt" in value)) return value;
  const current = value.updatedAt;
  return {
    ...value,
    updatedAt: typeof current === "number" ? Date.now() : new Date().toISOString(),
  };
}

function itemIdentity(item: JsonValue): string {
  if (isRecord(item)) {
    for (const field of ["id", "key", "slug", "name"]) {
      const candidate = item[field];
      if (typeof candidate === "string" || typeof candidate === "number") return `${field}:${candidate}`;
    }
  }
  return JSON.stringify(item);
}

/** Merge: what is already here wins; the file only adds what is missing. */
function mergeJsonValues(existing: unknown, imported: JsonValue): JsonValue {
  if (Array.isArray(existing) && Array.isArray(imported)) {
    const seen = new Set((existing as JsonValue[]).map((item) => itemIdentity(item)));
    const added = imported.filter((item) => !seen.has(itemIdentity(item)));
    return [...(existing as JsonValue[]), ...added];
  }
  if (isRecord(existing) && isRecord(imported) && !Array.isArray(existing) && !Array.isArray(imported)) {
    const out: Record<string, JsonValue> = { ...(imported as Record<string, JsonValue>) };
    for (const [key, value] of Object.entries(existing)) {
      const incoming = (imported as Record<string, JsonValue>)[key];
      out[key] = incoming === undefined ? value as JsonValue : mergeJsonValues(value, incoming);
    }
    return out;
  }
  return existing === undefined || existing === null ? imported : existing as JsonValue;
}

function writeStorageEntry(baseKey: string, entry: DockSessionStorageEntry, merge = false): void {
  if (merge) {
    const existing = readNativeDockSetting<unknown>(baseKey);
    if (existing !== undefined && existing !== null) {
      if (entry.encoding === "text") return;
      writeNativeDockSetting(baseKey, mergeJsonValues(existing, entry.value as JsonValue));
      return;
    }
  }
  const value = entry.encoding === "json"
    ? prepareImportedValue(entry.value as JsonValue)
    : String(entry.value);
  writeNativeDockSetting(baseKey, value);
}

function hasImportedStorageEntry(session: DockSessionExport, baseKey: string): boolean {
  return session.sections.some((section) => Object.prototype.hasOwnProperty.call(section.storage, baseKey));
}

function restoreExplicitAppPreferences(session: DockSessionExport, merge = false): number {
  let restored = 0;
  const write = (baseKey: string, entry: DockSessionStorageEntry) => {
    if (hasImportedStorageEntry(session, baseKey)) return;
    try {
      writeStorageEntry(baseKey, entry, merge);
      restored += 1;
    } catch {
      // The regular section pass will report failures for entries that were
      // actually present in the file. App metadata is best-effort fallback.
    }
  };

  if (session.app.appearance !== null) {
    write("ocs-app-appearance", { scope: "user", encoding: "json", value: session.app.appearance });
  }
  write("obs-church-studio.theme-preference", {
    scope: "user",
    encoding: "text",
    value: session.app.colorMode,
  });
  if (isRecord(session.app.typography)) {
    write("ocs-dock-typography", { scope: "user", encoding: "json", value: session.app.typography });
    if (typeof session.app.typography.fontFamily === "string") {
      write("ocs-dock-font-family", {
        scope: "user",
        encoding: "text",
        value: session.app.typography.fontFamily,
      });
    }
    if (typeof session.app.typography.fontScale === "number" && Number.isFinite(session.app.typography.fontScale)) {
      write("ocs-dock-font-scale", {
        scope: "user",
        encoding: "text",
        value: String(session.app.typography.fontScale),
      });
    }
  }
  if (!hasImportedStorageEntry(session, "ocs-dock-shell-preferences")) {
    write("ocs-dock-shell-preferences", {
      scope: "global",
      encoding: "json",
      value: {
        activeTab: session.app.activeTab,
        disabledTabs: session.app.disabledTabs,
      },
    });
  }
  return restored;
}

function isMediaRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && (value.type === "image" || value.type === "video")
    && typeof value.url === "string"
    && typeof value.createdAt === "string";
}

function isWorshipSongRecord(value: JsonValue): boolean {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.lyrics !== "string") return false;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return false;
  if (!isRecord(value.metadata) || typeof value.metadata.title !== "string" || typeof value.metadata.artist !== "string") return false;
  if (!Array.isArray(value.slides)) return false;
  return value.slides.every((slide) => isRecord(slide)
    && typeof slide.id === "string"
    && typeof slide.label === "string"
    && typeof slide.content === "string"
    && typeof slide.isContinuation === "boolean"
    && typeof slide.type === "string");
}

function isCountdownRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && isRecord(value.timer)
    && isRecord(value.background)
    && isRecord(value.text)
    && isRecord(value.animation)
    && isRecord(value.obs)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isMultiViewLayoutRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isRecord(value.canvas)
    && Array.isArray(value.regions)
    && isRecord(value.background)
    && isRecord(value.safeFrame);
}

function isMultiViewAssetRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && (value.type === "image" || value.type === "video" || value.type === "audio")
    && typeof value.src === "string";
}

function isMultiViewMediaRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && (value.mediaType === "image" || value.mediaType === "video")
    && typeof value.filePath === "string"
    && typeof value.previewSrc === "string"
    && typeof value.mimeType === "string"
    && typeof value.size === "number"
    && typeof value.createdAt === "string";
}

function isMultiViewMappingRecord(value: JsonValue): boolean {
  return isRecord(value)
    && typeof value.layoutId === "string"
    && typeof value.obsSceneName === "string"
    && Array.isArray(value.regionMappings);
}

function stripRecordOwner(value: JsonValue): JsonValue {
  if (!isRecord(value)) return value;
  const copy = { ...value };
  delete copy.userId;
  return copy;
}

async function restoreWorshipSongs(
  songs: JsonValue[],
  warnings: string[],
  merge = false,
): Promise<number> {
  if (songs.length === 0) return 0;
  try {
    const { saveSong, getAllSongs } = await import("../worship/worshipDb");
    const have = merge ? new Set((await getAllSongs()).map((song) => song.id)) : new Set<string>();
    let restored = 0;
    let skipped = 0;
    for (const value of songs) {
      if (merge && isRecord(value) && typeof value.id === "string" && have.has(value.id)) continue;
      if (!isWorshipSongRecord(value)) {
        skipped += 1;
        continue;
      }
      try {
        await saveSong(stripRecordOwner(value) as unknown as Song, { notify: false });
        restored += 1;
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      warnings.push(`${skipped} lyric record${skipped === 1 ? " was" : "s were"} skipped during import.`);
    }
    return restored;
  } catch {
    warnings.push("Lyrics were included in the session file, but the worship library could not be updated.");
    return 0;
  }
}

async function restoreCountdowns(
  countdowns: JsonValue[],
  warnings: string[],
  merge = false,
): Promise<number> {
  if (countdowns.length === 0) return 0;
  try {
    const { saveCountdown, getCountdowns } = await import("../countdowns/countdownStore");
    const have = merge ? new Set((await getCountdowns()).map((item) => item.id)) : new Set<string>();
    let restored = 0;
    let skipped = 0;
    for (const value of countdowns) {
      if (merge && isRecord(value) && typeof value.id === "string" && have.has(value.id)) continue;
      if (!isCountdownRecord(value)) {
        skipped += 1;
        continue;
      }
      try {
        await saveCountdown(stripRecordOwner(value) as unknown as CountdownConfig);
        restored += 1;
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      warnings.push(`${skipped} countdown record${skipped === 1 ? " was" : "s were"} skipped during import.`);
    }
    return restored;
  } catch {
    warnings.push("Countdowns were included in the session file, but the countdown library could not be updated.");
    return 0;
  }
}

async function restoreRecords(
  records: DockSessionRecords,
  warnings: string[],
  merge = false,
): Promise<DockSessionImportResult["restored"]> {
  const restored = {
    worshipSongs: await restoreWorshipSongs(records.worshipSongs, warnings, merge),
    countdowns: await restoreCountdowns(records.countdowns, warnings, merge),
    media: 0,
    layouts: 0,
    assets: 0,
    multiviewMedia: 0,
    mappings: 0,
  };

  if (records.mediaLibrary.length > 0) {
    try {
      const { saveMedia, getAllMedia } = await import("../library/libraryDb");
      const have = merge ? new Set((await getAllMedia()).map((item) => item.id)) : new Set<string>();
      for (const value of records.mediaLibrary) {
        if (!isMediaRecord(value)) continue;
        if (merge && isRecord(value) && typeof value.id === "string" && have.has(value.id)) continue;
        await saveMedia(stripRecordOwner(value) as never);
        restored.media += 1;
      }
    } catch {
      warnings.push("Media references were saved in the session file, but the local media library could not be updated.");
    }
  }

  const { layouts, assets, media, mappings } = records.multiview;
  if (layouts.length > 0 || assets.length > 0 || media.length > 0 || mappings.length > 0) {
    try {
      const { saveLayout, saveAsset, saveMediaItem, saveMapping } = await import("../multiview/mvStore");
      for (const value of layouts) {
        if (!isMultiViewLayoutRecord(value)) continue;
        const layout = stripRecordOwner(value) as Record<string, unknown>;
        await saveLayout({ ...layout, isTemplate: false, userId: undefined } as never);
        restored.layouts += 1;
      }
      for (const value of assets) {
        if (!isMultiViewAssetRecord(value)) continue;
        await saveAsset(stripRecordOwner(value) as never);
        restored.assets += 1;
      }
      for (const value of media) {
        if (!isMultiViewMediaRecord(value)) continue;
        await saveMediaItem(stripRecordOwner(value) as never);
        restored.multiviewMedia += 1;
      }
      for (const value of mappings) {
        if (!isMultiViewMappingRecord(value)) continue;
        await saveMapping(stripRecordOwner(value) as never);
        restored.mappings += 1;
      }
    } catch {
      warnings.push("Multi-View settings were restored, but one or more saved layouts could not be updated.");
    }
  }

  return restored;
}

export async function applyDockSession(
  session: DockSessionExport,
  options: DockSessionApplyOptions = {},
): Promise<DockSessionImportResult> {
  const merge = options.merge === true;
  await hydrateNativeDockSettings().catch(() => undefined);
  const warnings = [...session.warnings];
  let storageEntryCount = restoreExplicitAppPreferences(session, merge);

  for (const section of session.sections) {
    for (const [baseKey, entry] of Object.entries(section.storage)) {
      const allowed = ALLOWED_STORAGE_KEYS.get(baseKey);
      if (!allowed || allowed.scope !== entry.scope) continue;
      try {
        writeStorageEntry(baseKey, entry, merge);
        storageEntryCount += 1;
      } catch {
        warnings.push(`Could not restore ${baseKey}.`);
      }
    }
  }

  for (const [key, raw] of Object.entries(session.studio ?? {})) {
    if (!isStudioKey(key)) continue;
    try {
      if (merge && localStorage.getItem(key) !== null) continue;
      localStorage.setItem(key, raw);
      storageEntryCount += 1;
    } catch {
      warnings.push(`Could not restore ${key}.`);
    }
  }

  const restored = await restoreRecords(session.records, warnings, merge);
  return {
    sectionCount: session.sections.length,
    storageEntryCount,
    restored,
    warnings,
  };
}

export async function importDockSessionFromFile(
  file: File,
  options: DockSessionApplyOptions = {},
): Promise<DockSessionImportResult> {
  const { importDockSessionAnyFile } = await import("./dockSessionBundle");
  return importDockSessionAnyFile(file, options);
}

export interface DockSessionDownloadResult {
  session: DockSessionExport;
  savedPath: string | null;
  cancelled: boolean;
  usedBrowserDownload: boolean;
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tryTauriSaveDialog(filename: string, json: string): Promise<
  { status: "saved"; path: string } | { status: "cancelled" } | { status: "unavailable" }
> {
  if (!isTauriRuntime()) return { status: "unavailable" };
  try {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    if (!filePath) return { status: "cancelled" };
    await writeTextFile(filePath, json);
    return { status: "saved", path: filePath };
  } catch (error) {
    console.warn("[Dock] Native Dock session save unavailable:", error);
    return { status: "unavailable" };
  }
}

async function tryBrowserSaveDialog(filename: string, json: string): Promise<
  { status: "saved" } | { status: "cancelled" } | { status: "unavailable" }
> {
  if (typeof window === "undefined") return { status: "unavailable" };
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (typeof picker !== "function") return { status: "unavailable" };
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: "JSON files", accept: { "application/json": [".json"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return { status: "saved" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "cancelled" };
    }
    console.warn("[Dock] Browser Dock session save unavailable:", error);
    return { status: "unavailable" };
  }
}

async function tryOverlayServerSave(filename: string, json: string): Promise<
  { status: "saved"; path: string } | { status: "unavailable" }
> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await fetch(
      `${getOverlayBaseUrlSync()}/api/save-dock-session?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      },
    );
    if (!response.ok) return { status: "unavailable" };
    const result = await response.json() as { path?: unknown; bytes?: unknown };
    if (typeof result.path !== "string" || typeof result.bytes !== "number" || result.bytes <= 0) {
      return { status: "unavailable" };
    }
    return { status: "saved", path: result.path };
  } catch (error) {
    console.warn("[Dock] Local Dock session save unavailable:", error);
    return { status: "unavailable" };
  }
}

export async function downloadDockSession(): Promise<DockSessionDownloadResult> {
  const session = await createDockSessionExport();
  const json = JSON.stringify(session, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `makechurch-easy-dock-session-${stamp}.json`;

  const nativeSave = await tryTauriSaveDialog(filename, json);
  if (nativeSave.status === "saved") {
    return { session, savedPath: nativeSave.path, cancelled: false, usedBrowserDownload: false };
  }
  if (nativeSave.status === "cancelled") {
    return { session, savedPath: null, cancelled: true, usedBrowserDownload: false };
  }

  const browserSave = await tryBrowserSaveDialog(filename, json);
  if (browserSave.status === "saved") {
    return { session, savedPath: null, cancelled: false, usedBrowserDownload: false };
  }
  if (browserSave.status === "cancelled") {
    return { session, savedPath: null, cancelled: true, usedBrowserDownload: false };
  }

  const overlaySave = await tryOverlayServerSave(filename, json);
  if (overlaySave.status === "saved") {
    return { session, savedPath: overlaySave.path, cancelled: false, usedBrowserDownload: false };
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Let the browser/OBS CEF finish consuming the blob before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { session, savedPath: null, cancelled: false, usedBrowserDownload: true };
}
