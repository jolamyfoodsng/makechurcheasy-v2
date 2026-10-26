/**
 * dockDisplayOutputClient.ts — the Dock's way to reach "Send to a display".
 *
 * In OBS the Dock is a plain localhost page, so it asks the main MakeChurchEazy
 * window over the local relay (see studio/dockDisplayHost.ts). Inside the main
 * window it calls the host directly. Every call is best effort: a failure is
 * reported, and OBS output is never held up by it.
 */
import { hasTauriInvoke } from "../services/tauriSafe";
import { studioItemFromDock, studioItemFromMedia } from "../studio/studioDockAdapter";
import type { MediaItem } from "../library/libraryTypes";
import { readNativeDockSetting, writeNativeDockSetting } from "../services/localDockSettings";
import type { StudioItem, StudioMode } from "../studio/studioEngine";
import type { DockDisplayNoticeTone, DockDisplayShowResult } from "../studio/dockDisplayHost";
import { overlayBridge, type BridgePacket } from "./dockOverlayBridge";
import {
  normalizeDockDisplayOutput,
  type DockDisplayInfo,
  type DockDisplayMode,
  type DockDisplayModule,
  type DockDisplayOutput,
} from "./dockDisplayOutput";
import type { DockStageType } from "./dockTypes";

const CHANNEL = "dock-display";
const REQUEST_TIMEOUT_MS = 6000;
const APP_NOT_REACHED = "MakeChurchEazy didn't answer. Make sure the app is open on this computer.";

let requestCounter = 0;
const pending = new Map<string, (packet: BridgePacket) => void>();
const noticeListeners = new Set<(message: string, tone: DockDisplayNoticeTone) => void>();
let relayHooked = false;

function hookRelay(): void {
  if (relayHooked) return;
  relayHooked = true;
  overlayBridge.subscribe((packet) => {
    if (packet.channel !== CHANNEL) return;
    if (packet.type === "reply" && typeof packet.requestId === "string") {
      const resolve = pending.get(packet.requestId);
      if (resolve) {
        pending.delete(packet.requestId);
        resolve(packet);
      }
    } else if (packet.type === "notice" && typeof packet.message === "string") {
      emitNotice(packet.message, packet.tone === "info" ? "info" : "warning");
    }
  });
  overlayBridge.connect();
}

function emitNotice(message: string, tone: DockDisplayNoticeTone = "warning"): void {
  for (const listener of noticeListeners) listener(message, tone);
}

/** Is this the main app window (where the host runs and can be called directly)? */
async function isMainAppWindow(): Promise<boolean> {
  if (!hasTauriInvoke()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label === "main";
  } catch {
    return false;
  }
}

let hostPromise: Promise<typeof import("../studio/dockDisplayHost") | null> | null = null;
function directHost(): Promise<typeof import("../studio/dockDisplayHost") | null> {
  hostPromise ??= isMainAppWindow().then((main) => (main ? import("../studio/dockDisplayHost") : null));
  return hostPromise;
}

function request(type: string, body: Record<string, unknown>): Promise<BridgePacket> {
  hookRelay();
  const requestId = `dd-${Date.now()}-${++requestCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(APP_NOT_REACHED));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, (packet) => {
      clearTimeout(timer);
      resolve(packet);
    });
    overlayBridge.publish({ channel: CHANNEL, type, requestId, ...body });
  });
}

let lastKnownDisplays: DockDisplayInfo[] | null = null;

/** The screens from the last check, so the Output settings open with the list already filled in. */
export function getLastKnownDockDisplays(): DockDisplayInfo[] | null {
  return lastKnownDisplays;
}

/** The screens plugged into this computer. Throws when the app can't be reached. */
export async function listDockDisplays(): Promise<DockDisplayInfo[]> {
  const host = await directHost();
  let displays: DockDisplayInfo[];
  if (host) {
    displays = await host.hostListDisplays();
  } else {
    const packet = await request("list", {});
    if (packet.ok !== true) throw new Error(String(packet.message || "Screens could not be listed."));
    displays = Array.isArray(packet.displays) ? (packet.displays as DockDisplayInfo[]) : [];
  }
  lastKnownDisplays = displays;
  return displays;
}

/** Operator messages: the display is missing, was unplugged, … */
export function onDockDisplayNotice(listener: (message: string, tone: DockDisplayNoticeTone) => void): () => void {
  noticeListeners.add(listener);
  hookRelay();
  let unsubscribeHost: (() => void) | null = null;
  let active = true;
  void directHost().then((host) => {
    if (host && active) unsubscribeHost = host.onDockDisplayNotice(listener);
  });
  return () => {
    active = false;
    noticeListeners.delete(listener);
    unsubscribeHost?.();
  };
}

const MODULE_STAGE_TYPE: Record<DockDisplayModule, DockStageType> = {
  bible: "bible",
  worship: "worship",
  notes: "notes",
};

/** The tab's themes for each look, so the display can use a different look than the tab. */
export interface DockDisplayThemes {
  fullscreen?: Record<string, unknown> | null;
  fullscreenOverrides?: Record<string, unknown> | null;
  lowerThird?: Record<string, unknown> | null;
}

/**
 * The tab's content as the display should draw it, in the look chosen for the
 * display: the tab's own ("Follow tab"), full screen or lower third.
 */
export function buildDockDisplayItem(
  module: DockDisplayModule,
  data: object,
  mode: DockDisplayMode,
  themes: DockDisplayThemes = {},
): { item: StudioItem; mode: StudioMode } | null {
  const record = data as Record<string, unknown>;
  const tabMode: StudioMode = record.overlayMode === "lower-third" ? "lower-third" : "fullscreen";
  const target: StudioMode = mode === "inherit" ? tabMode : mode;
  let themed: Record<string, unknown> = { ...record, overlayMode: target };
  if (target !== tabMode) {
    // The tab sent the other look: use the tab's theme for this look instead.
    themed = target === "fullscreen"
      ? { ...themed, bibleThemeSettings: themes.fullscreen ?? record.bibleThemeSettings ?? null, liveOverrides: themes.fullscreenOverrides ?? null }
      : { ...themed, bibleThemeSettings: themes.lowerThird ?? record.bibleThemeSettings ?? null, liveOverrides: null };
  }
  const label = String(record.displayReferenceLabel || record.referenceLabel || record.songTitle || record.sectionLabel || "");
  const item = studioItemFromDock(
    { type: MODULE_STAGE_TYPE[module], label, subtitle: String(record.sectionLabel || ""), data: themed },
    "cut",
  );
  return item ? { item, mode: target } : null;
}

/** A picture or video from the Media tab, played the way the operator set it up there. */
export function buildDockMediaDisplayItem(
  media: Pick<MediaItem, "type" | "name" | "url" | "diskFileName">,
  options: { fit?: string; muted?: boolean; loop?: boolean } = {},
): { item: StudioItem; mode: StudioMode } | null {
  // The adapter only reads these four fields.
  const item = studioItemFromMedia(media as MediaItem, options.fit === "contain" ? "contain" : "cover");
  if (!item || item.module !== "media") return null;
  return {
    item: { ...item, media: { ...item.media, muted: options.muted ?? item.media.muted, loop: options.loop ?? item.media.loop } },
    mode: "fullscreen",
  };
}

const MEDIA_DISPLAY_KEY = "dock-media-display-v1";

/** The screen the Media tab last sent to, picked again next time. */
export function loadDockMediaDisplay(): DockDisplayOutput {
  return normalizeDockDisplayOutput(readNativeDockSetting(MEDIA_DISPLAY_KEY));
}

export function saveDockMediaDisplay(display: DockDisplayOutput): void {
  void writeNativeDockSetting(MEDIA_DISPLAY_KEY, normalizeDockDisplayOutput(display));
}

type DisplayOp =
  | { kind: "show"; display: DockDisplayOutput; item: StudioItem; mode: StudioMode; onMoved?: (next: DockDisplayOutput) => void }
  | { kind: "clear"; module: DockDisplayModule };

/**
 * One update reaches the display at a time and only the newest waiting one is
 * kept: arrowing through verses never builds a queue, the screen lands on the
 * latest verse, and a clear can't be overtaken by an older show.
 */
let running = false;
let waiting: DisplayOp | null = null;

function enqueue(op: DisplayOp): void {
  waiting = op;
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (waiting) {
      const op = waiting;
      waiting = null;
      await (op.kind === "show" ? runShow(op) : runClear(op.module));
    }
  } finally {
    running = false;
  }
}

async function runShow(op: Extract<DisplayOp, { kind: "show" }>): Promise<void> {
  let result: DockDisplayShowResult;
  try {
    const host = await directHost();
    result = host
      ? await host.hostShowOnDisplay(op.display, op.item, op.mode)
      : (await request("show", { display: op.display, item: op.item, mode: op.mode })) as unknown as DockDisplayShowResult;
  } catch (error) {
    emitNotice(error instanceof Error ? error.message : APP_NOT_REACHED);
    return;
  }
  if (!result.ok) {
    if (result.message) emitNotice(result.message);
    return;
  }
  if (result.display && result.display.key !== op.display.monitorKey) {
    // Same screen, new position or port: remember where it is now.
    op.onMoved?.({ ...op.display, monitorKey: result.display.key, monitorName: result.display.name });
  }
}

async function runClear(module: DockDisplayModule): Promise<void> {
  try {
    const host = await directHost();
    if (host) await host.hostClearDisplay(module);
    else await request("clear", { module });
  } catch {
    /* the display is optional; OBS was already cleared */
  }
}

/**
 * Show content on the saved display. Returns at once and never throws; problems
 * are reported as a notice, so OBS is never held up.
 */
export function showOnDockDisplay(
  display: DockDisplayOutput | undefined,
  built: { item: StudioItem; mode: StudioMode } | null,
  onMoved?: (next: DockDisplayOutput) => void,
): void {
  if (!display?.enabled || !built) return;
  enqueue({ kind: "show", display, item: built.item, mode: built.mode, onMoved });
}

/** "Close all projectors": every projector window on every screen. Reports a problem as a notice. */
export async function closeAllDockProjectors(): Promise<boolean> {
  waiting = null;
  try {
    const host = await directHost();
    if (host) await host.hostCloseAllProjectors();
    else await request("close-all", {});
    return true;
  } catch (error) {
    emitNotice(error instanceof Error ? error.message : APP_NOT_REACHED);
    return false;
  }
}

/** Take this tab's content off the display. Best effort. */
export function clearDockDisplay(display: DockDisplayOutput | undefined, module: DockDisplayModule): void {
  if (!display?.enabled) return;
  enqueue({ kind: "clear", module });
}

