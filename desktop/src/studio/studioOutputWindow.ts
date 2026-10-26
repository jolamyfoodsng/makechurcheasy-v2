/**
 * studioOutputWindow.ts — projectors of the Presentation Studio (like OBS's
 * "Open Program Projector" / "Open Preview Projector").
 *
 * A projector shows `studio-output.html` from the local overlay server:
 *   - on a screen: borderless and full screen on that monitor;
 *   - in a window: a normal window the operator can move, resize and close.
 * Press Esc (or right-click → Close projector) inside a projector to close it.
 * The page asks over the local relay (`studio-control` / `close-projector`),
 * and this module closes the window.
 */
import { availableMonitors, currentMonitor, PhysicalPosition, PhysicalSize, type Monitor } from "@tauri-apps/api/window";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { getOverlayBaseUrl } from "../services/overlayUrl";
import { toLoopbackBase } from "./studioEngine";
import { overlayBridge } from "../dock/dockOverlayBridge";

const OUTPUT_MONITOR_KEY = "mce-studio-output-monitor";
const ALT_MONITOR_KEY = "mce-studio-alt-output-monitor";
const LABEL_PREFIX = "studio-projector-";
/** Phase 1 window label, closed too so an old window never gets stuck. */
const LEGACY_LABEL = "studio-output";

/** program = the Output, alt = the alternate output (same item, its own look), preview = what's next. */
export type ProjectorFeed = "program" | "alt" | "preview";

const PROJECTOR_TITLE: Record<ProjectorFeed, string> = {
  program: "Program Projector",
  alt: "Alternate Output",
  preview: "Preview Projector",
};
/** A monitor key, or "window" for a normal window. */
export type ProjectorTarget = string;

export interface StudioMonitor {
  /** Stable enough to remember: name + position + size. */
  key: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** The screen the app is on (the operator's screen). */
  isControlScreen: boolean;
}

export interface OpenProjector {
  label: string;
  feed: ProjectorFeed;
  /** Monitor key, or null for a window. */
  monitorKey: string | null;
  /** "Built-in Display" or "Window". */
  where: string;
  /** Opening it again found it already open, so it was brought forward instead of being rebuilt. */
  reused?: boolean;
}

function monitorKey(m: Monitor): string {
  return `${m.name ?? "display"}@${m.position.x},${m.position.y}:${m.size.width}x${m.size.height}`;
}

function sameMonitor(a: Monitor | null, b: Monitor | null): boolean {
  return Boolean(a && b && monitorKey(a) === monitorKey(b));
}

export async function listStudioMonitors(): Promise<StudioMonitor[]> {
  const [monitors, current] = await Promise.all([availableMonitors(), currentMonitor()]);
  return monitors.map((m, i) => ({
    key: monitorKey(m),
    name: m.name?.trim() || `Display ${i + 1}`,
    width: m.size.width,
    height: m.size.height,
    x: m.position.x,
    y: m.position.y,
    isControlScreen: sameMonitor(m, current),
  }));
}

/** OBS style: "Built-in Display: 2048x1330 @ 0,0". */
export function monitorLabel(m: StudioMonitor): string {
  return `${m.name}: ${m.width}x${m.height} @ ${m.x},${m.y}`;
}

export function readSavedOutputMonitor(): string {
  try {
    return localStorage.getItem(OUTPUT_MONITOR_KEY) || "";
  } catch {
    return "";
  }
}

export function saveOutputMonitor(key: string): void {
  try {
    localStorage.setItem(OUTPUT_MONITOR_KEY, key);
  } catch {
    /* ignore */
  }
}

export function readSavedAltMonitor(): string {
  try {
    return localStorage.getItem(ALT_MONITOR_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAltMonitor(key: string): void {
  try {
    localStorage.setItem(ALT_MONITOR_KEY, key);
  } catch {
    /* ignore */
  }
}

/** The monitor to use: the saved one if still connected, else the first screen that isn't the app's. */
export async function pickDefaultMonitorKey(monitors: StudioMonitor[]): Promise<string> {
  const saved = readSavedOutputMonitor();
  if (saved && monitors.some((m) => m.key === saved)) return saved;
  return (monitors.find((m) => !m.isControlScreen) ?? monitors[0])?.key ?? "";
}

// ── Open projectors ────────────────────────────────────────────────────────

const projectors = new Map<string, OpenProjector>();
const listeners = new Set<(list: OpenProjector[]) => void>();
let counter = 0;
let relayHooked = false;

function notify(): void {
  const list = listOpenProjectors();
  for (const listener of listeners) listener(list);
  syncScreenWatch();
}

// ── A projector's screen is unplugged: close it ────────────────────────────
// A screen projector sits above everything (macOS) or is full screen, so it must never be left on
// another screen. macOS hides it natively the moment its screen goes (projector_window.m); this
// closes the window for good, on every system, within a second.

const SCREEN_WATCH_MS = 1000;
const screenLostListeners = new Set<(projector: OpenProjector) => void>();
let screenWatchTimer: ReturnType<typeof setInterval> | null = null;

/** Called when a projector was closed because its screen was disconnected. Returns an unsubscribe. */
export function onProjectorScreenLost(listener: (projector: OpenProjector) => void): () => void {
  screenLostListeners.add(listener);
  return () => { screenLostListeners.delete(listener); };
}

async function checkProjectorScreens(): Promise<void> {
  const onScreens = listOpenProjectors().filter((p) => p.monitorKey);
  if (onScreens.length === 0) return;
  let keys: Set<string>;
  try {
    keys = new Set((await availableMonitors()).map(monitorKey));
  } catch {
    return;
  }
  for (const projector of onScreens) {
    if (keys.has(projector.monitorKey as string) || !projectors.has(projector.label)) continue;
    await closeProjector(projector.label).catch(() => undefined);
    for (const listener of screenLostListeners) listener(projector);
  }
}

function syncScreenWatch(): void {
  const needed = listOpenProjectors().some((p) => p.monitorKey);
  if (needed && !screenWatchTimer) {
    screenWatchTimer = setInterval(() => { void checkProjectorScreens(); }, SCREEN_WATCH_MS);
  } else if (!needed && screenWatchTimer) {
    clearInterval(screenWatchTimer);
    screenWatchTimer = null;
  }
}

export function listOpenProjectors(): OpenProjector[] {
  return Array.from(projectors.values());
}

/** Called with the open projectors whenever one opens or closes. Returns an unsubscribe. */
export function onProjectorsChange(listener: (list: OpenProjector[]) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Esc / "Close projector" inside a projector page arrives over the local relay. */
function hookRelay(): void {
  if (relayHooked) return;
  relayHooked = true;
  overlayBridge.subscribe((packet) => {
    if (packet.channel !== "studio-control" || packet.type !== "close-projector") return;
    const label = String(packet.label ?? "");
    if (label.startsWith(LABEL_PREFIX)) void closeProjector(label);
  });
  overlayBridge.connect();
}

async function destroyWindow(label: string): Promise<void> {
  const win = await WebviewWindow.getByLabel(label);
  if (!win) return;
  try {
    await win.setFullscreen(false).catch(() => undefined);
    await win.destroy();
  } catch {
    await win.close().catch(() => undefined);
  }
}

const expectedClose = new Set<string>();
/** Set when a projector disappears without the app asking for it: how long it lived and where it pointed. */
let lastSurpriseClose = "";
export function takeSurpriseCloseNote(): string {
  const note = lastSurpriseClose;
  lastSurpriseClose = "";
  return note;
}

export async function closeProjector(label: string): Promise<void> {
  expectedClose.add(label);
  await destroyWindow(label);
  if (projectors.delete(label)) notify();
}

/** Close every projector (or every one of a feed). */
export async function closeAllProjectors(feed?: ProjectorFeed): Promise<void> {
  // Windows this page lost track of (after a reload) are closed too.
  await adoptStrayProjectors();
  const labels = listOpenProjectors().filter((p) => !feed || p.feed === feed).map((p) => p.label);
  await Promise.all(labels.map((label) => closeProjector(label)));
  if (!feed || feed === "program") await destroyWindow(LEGACY_LABEL);
}

/**
 * Create the projector window in Rust (`open_studio_projector`). Windows made from JavaScript get
 * different WebView2 settings than the main window, and on some Windows PCs WebView2 then kills
 * them a second after they open. The Rust side copies the main window's settings exactly.
 */
async function createProjectorWindow(options: {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  decorations: boolean;
  visible: boolean;
  focus: boolean;
  alwaysOnTop: boolean;
}): Promise<WebviewWindow> {
  await invoke("open_studio_projector", { ...options, x: options.x ?? null, y: options.y ?? null });
  const win = await WebviewWindow.getByLabel(options.label);
  if (!win) throw new Error("The projector window closed as soon as it opened.");
  return win;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/**
 * macOS, second screen: cover it above other apps' windows (an OBS projector included) and the
 * menu bar, without its own Space and without taking the keyboard. Returns false when the running
 * app can't (an older build), so the caller uses normal full screen.
 */
async function presentOnScreen(label: string, raiseOnly: boolean): Promise<boolean> {
  if (!IS_MAC) return false;
  try {
    await invoke("present_studio_projector", { label, raiseOnly });
    return true;
  } catch {
    return false;
  }
}

function feedFromLabel(label: string): ProjectorFeed | null {
  const feed = label.slice(LABEL_PREFIX.length).split("-")[0];
  return feed === "program" || feed === "alt" || feed === "preview" ? feed : null;
}

function track(label: string, win: WebviewWindow, entry: OpenProjector, note: string): void {
  projectors.set(label, entry);
  const openedAt = Date.now();
  void win.once("tauri://destroyed", () => {
    if (!expectedClose.delete(label)) {
      lastSurpriseClose = `It closed itself ${((Date.now() - openedAt) / 1000).toFixed(1)}s after opening (${note}).`;
      console.warn("[projector]", lastSurpriseClose);
    }
    if (projectors.delete(label)) notify();
  });
}

/**
 * Projector windows this page doesn't know about (left from before the app window reloaded) are
 * taken back, so the next open reuses them instead of stacking another "Program Projector" on the
 * same screen. A second one of the same feed on the same screen is closed.
 */
export async function adoptStrayProjectors(): Promise<void> {
  let windows: WebviewWindow[];
  try {
    windows = await getAllWebviewWindows();
  } catch {
    return;
  }
  const strays = windows.filter((win) => win.label.startsWith(LABEL_PREFIX) && !projectors.has(win.label));
  if (strays.length === 0) return;
  const monitors = await availableMonitors().catch(() => [] as Monitor[]);
  let changed = false;
  for (const win of strays) {
    const feed = feedFromLabel(win.label);
    let monitor: Monitor | null = null;
    let decorated = true;
    try {
      decorated = await win.isDecorated();
      if (!decorated) {
        const at = await win.outerPosition();
        monitor = monitors.find((m) => (
          at.x >= m.position.x && at.x < m.position.x + m.size.width
          && at.y >= m.position.y && at.y < m.position.y + m.size.height
        )) ?? null;
      }
    } catch {
      /* treat it as a window */
    }
    const key = monitor ? monitorKey(monitor) : null;
    if (!feed || listOpenProjectors().some((p) => p.feed === feed && p.monitorKey === key)) {
      await closeProjector(win.label);
      continue;
    }
    track(win.label, win, { label: win.label, feed, monitorKey: key, where: monitor?.name?.trim() || (decorated ? "Window" : "Display") }, "adopted");
    changed = true;
  }
  if (changed) notify();
}

/** The projector is already open: bring it forward (rebuilding a full-screen window right away leaves a blank one). */
async function reuseProjector(existing: OpenProjector, focus: boolean): Promise<OpenProjector | null> {
  const win = await WebviewWindow.getByLabel(existing.label);
  if (!win) {
    if (projectors.delete(existing.label)) notify();
    return null;
  }
  try {
    await win.show();
    if (focus) await win.setFocus();
    else if (existing.monitorKey) await presentOnScreen(existing.label, true);
  } catch {
    /* ignore */
  }
  return { ...existing, reused: true };
}

/**
 * Open a Program or Preview projector on a screen (full screen) or in a window.
 * A screen holds one projector: opening a new one there replaces the old one.
 */
export async function openProjector(
  feed: ProjectorFeed,
  target: ProjectorTarget,
  options: {
    /** Only this exact screen: fail instead of using another one (the Dock's "Send to a display"). */
    exactMonitor?: boolean;
    /** Leave the Studio's remembered Output screen alone. */
    rememberScreen?: boolean;
  } = {},
): Promise<OpenProjector> {
  hookRelay();
  await adoptStrayProjectors();
  if (target === "window") {
    const open = listOpenProjectors().find((p) => p.feed === feed && p.monitorKey === null);
    if (open) {
      const back = await reuseProjector(open, true);
      if (back) return back;
    }
  }
  await destroyWindow(LEGACY_LABEL);
  // This computer's own server (not the Wi-Fi address), so a network change can't blank the projector.
  const base = toLoopbackBase(await getOverlayBaseUrl());
  const label = `${LABEL_PREFIX}${feed}-${Date.now()}-${++counter}`;
  const url = `${base}/studio-output.html?feed=${feed}&win=${encodeURIComponent(label)}`;
  const title = PROJECTOR_TITLE[feed];

  let entry: OpenProjector;
  let win: WebviewWindow;

  if (target === "window") {
    win = await createProjectorWindow({
      label,
      url,
      title: `${title} (Window)`,
      width: 960,
      height: 540,
      decorations: true,
      visible: true,
      focus: true,
      alwaysOnTop: false,
    });
    entry = { label, feed, monitorKey: null, where: "Window" };
  } else {
    const monitors = await availableMonitors();
    const current = await currentMonitor();
    const exact = monitors.find((m) => monitorKey(m) === target);
    if (options.exactMonitor && !exact) throw new Error("That display is no longer connected.");
    const monitor = exact
      ?? monitors.find((m) => !sameMonitor(m, current))
      ?? current
      ?? monitors[0];
    if (!monitor) throw new Error("No screen found for the projector.");
    const key = monitorKey(monitor);
    const isControl = sameMonitor(monitor, current);

    // Already open on this screen: bring it forward. Closing it and opening a new full-screen window
    // straight away is what left a blank screen.
    const sameScreen = listOpenProjectors().find((p) => p.feed === feed && p.monitorKey === key);
    if (sameScreen) {
      const back = await reuseProjector(sameScreen, isControl);
      if (back) return back;
    }
    // One projector per screen.
    await Promise.all(listOpenProjectors().filter((p) => p.monitorKey === key).map((p) => closeProjector(p.label)));

    const scale = Math.max(monitor.scaleFactor || 1, 1);
    win = await createProjectorWindow({
      label,
      url,
      title,
      visible: false,
      decorations: false,
      // On the operator's own screen the projector takes focus so Esc reaches it;
      // on a projector screen the operator keeps the keyboard.
      focus: isControl,
      alwaysOnTop: !isControl,
      x: Math.round(monitor.position.x / scale),
      y: Math.round(monitor.position.y / scale),
      width: Math.max(640, Math.round(monitor.size.width / scale)),
      height: Math.max(360, Math.round(monitor.size.height / scale)),
    });
    entry = { label, feed, monitorKey: key, where: monitor.name?.trim() || "Display" };
    await win.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
    await win.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
    await win.show();
    // macOS second screen: above everything there, no own Space. Elsewhere: normal full screen.
    if (isControl || !(await presentOnScreen(label, false))) await win.setFullscreen(true);
    if (isControl) await win.setFocus().catch(() => undefined);
    if (options.rememberScreen !== false) {
      if (feed === "program") saveOutputMonitor(key);
      if (feed === "alt") saveAltMonitor(key);
    }
  }

  track(label, win, entry, url);
  notify();
  return entry;
}

// ── Phase 1 names (kept so nothing else breaks) ───────────────────────────

export async function isStudioOutputOpen(): Promise<boolean> {
  return listOpenProjectors().some((p) => p.feed === "program");
}

export async function closeStudioOutput(): Promise<void> {
  await closeAllProjectors("program");
}

/** Open the Program projector on a screen. Returns the screen's name. */
export async function openStudioOutput(monitorKeyToUse: string): Promise<string> {
  return (await openProjector("program", monitorKeyToUse)).where;
}
