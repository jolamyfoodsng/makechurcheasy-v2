/**
 * dockDisplayHost.ts — the desktop side of the Dock's "Output → Send to a display".
 *
 * The OBS Dock is a plain localhost page inside OBS: it cannot list screens or
 * open windows. It asks the main MakeChurchEazy window over the local relay
 * (channel "dock-display"), and this module answers by opening the Studio's
 * Program projector full screen on the chosen screen and putting the item on it.
 *
 * Safety rules:
 *   - It only ever uses the exact screen the operator picked (never this computer's own screen).
 *   - If that screen is unplugged while showing, the projector closes and the Dock is told.
 *   - Nothing here touches OBS, so a closed projector or missing screen never stops OBS output.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInvoke } from "../services/tauriSafe";
import { overlayBridge, type BridgePacket } from "../dock/dockOverlayBridge";
import {
  dockDisplayProblemMessage,
  resolveDockDisplayTarget,
  type DockDisplayInfo,
  type DockDisplayOutput,
  type DockDisplayResolution,
} from "../dock/dockDisplayOutput";
import { clearProgram, getProgramState, goLiveItem, type StudioItem, type StudioMode, type StudioTextModule } from "./studioEngine";
import {
  adoptStrayProjectors,
  closeAllProjectors,
  listStudioMonitors,
  onProjectorScreenLost,
  onProjectorsChange,
  openProjector,
} from "./studioOutputWindow";

export const DOCK_DISPLAY_CHANNEL = "dock-display";

export interface DockDisplayShowResult {
  ok: boolean;
  /** Why it was not shown (empty when it was). */
  message: string;
  status: DockDisplayResolution["status"] | "error";
  /** The screen it went to, with its current key (it may have moved). */
  display?: DockDisplayInfo;
  /** The projector window's label. */
  projector?: string;
}

/** "info" = a projector was opened, "warning" = something could not be shown. */
export type DockDisplayNoticeTone = "info" | "warning";
const noticeListeners = new Set<(message: string, tone: DockDisplayNoticeTone) => void>();
/** The projector the Dock opened and the screen it is on. */
let dockProjector: { label: string; monitorKey: string; monitorName: string } | null = null;
/** The look of what the Dock last showed, so clearing plays the matching exit. */
let lastMode: StudioMode = "fullscreen";

function notice(message: string, tone: DockDisplayNoticeTone = "warning"): void {
  for (const listener of noticeListeners) listener(message, tone);
  overlayBridge.publish({ channel: DOCK_DISPLAY_CHANNEL, type: "notice", message, tone, at: Date.now() });
}

/** Messages for the operator (a screen was unplugged, …) in this window. */
export function onDockDisplayNotice(listener: (message: string, tone: DockDisplayNoticeTone) => void): () => void {
  noticeListeners.add(listener);
  return () => { noticeListeners.delete(listener); };
}

export function hostListDisplays(): Promise<DockDisplayInfo[]> {
  return listStudioMonitors();
}

let projectorsHooked = false;
function hookProjectors(): void {
  if (projectorsHooked) return;
  projectorsHooked = true;
  onProjectorsChange((open) => {
    // Closed with Esc or by the Studio: forget it. The next send opens it again.
    if (dockProjector && !open.some((p) => p.label === dockProjector?.label)) dockProjector = null;
  });
  // Its screen was unplugged: the projector is already closed; tell the operator.
  onProjectorScreenLost((projector) => {
    if (dockProjector?.label === projector.label) dockProjector = null;
    notice(`${projector.where} was disconnected, so its projector was closed. OBS is not affected.`);
  });
}

/** Show a Dock item on the saved display (the projector window is full screen). Never throws. */
export async function hostShowOnDisplay(
  saved: Pick<DockDisplayOutput, "enabled" | "monitorKey" | "monitorName">,
  item: StudioItem,
  mode: StudioMode = "fullscreen",
): Promise<DockDisplayShowResult> {
  try {
    hookProjectors();
    // Fast path for the next verse / slide: the projector is already up on that screen (the watcher
    // closes it within seconds if the screen is unplugged), so only the content changes.
    const open = dockProjector;
    if (saved.enabled && open && open.monitorKey === saved.monitorKey) {
      lastMode = mode;
      const shown = await goLiveItem(item, mode);
      return shown
        ? { ok: true, status: "ready", message: "", projector: open.label }
        : { ok: false, status: "error", message: "The projector could not be updated.", projector: open.label };
    }
    const resolution = resolveDockDisplayTarget(saved, await listStudioMonitors());
    if (resolution.status !== "ready") {
      return { ok: false, status: resolution.status, message: dockDisplayProblemMessage(resolution) };
    }
    const { display } = resolution;
    const projector = await openProjector("program", display.key, { exactMonitor: true, rememberScreen: false });
    if (!projector.reused) {
      // The operator may not know a window was just made: say where it is and how to close it.
      notice(`Showing on ${display.name}. To close it: Output → Close all projectors, or right-click it.`, "info");
    }
    dockProjector = { label: projector.label, monitorKey: display.key, monitorName: display.name };
    lastMode = mode;
    const shown = await goLiveItem(item, mode);
    return shown
      ? { ok: true, status: "ready", message: "", display, projector: projector.label }
      : { ok: false, status: "error", message: "The projector could not be updated.", display, projector: projector.label };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: error instanceof Error ? error.message : "The display could not be opened.",
    };
  }
}

/** "Close all projectors": every projector window, on every screen (the Studio's too). */
export async function hostCloseAllProjectors(): Promise<void> {
  dockProjector = null;
  await closeAllProjectors().catch(() => undefined);
}

/** Clear the display when this tab's content is what it shows. */
export async function hostClearDisplay(module: StudioTextModule): Promise<void> {
  if (getProgramState().active !== module) return;
  await clearProgram(lastMode, { preserveAlternate: true }).catch(() => false);
}

function reply(packet: BridgePacket, body: Record<string, unknown>): void {
  overlayBridge.publish({ channel: DOCK_DISPLAY_CHANNEL, type: "reply", requestId: packet.requestId, ...body });
}

async function handleRequest(packet: BridgePacket): Promise<void> {
  if (packet.channel !== DOCK_DISPLAY_CHANNEL || typeof packet.requestId !== "string") return;
  if (packet.type === "list") {
    try {
      reply(packet, { ok: true, displays: await hostListDisplays() });
    } catch (error) {
      reply(packet, { ok: false, message: error instanceof Error ? error.message : "Screens could not be listed." });
    }
  } else if (packet.type === "show") {
    const mode: StudioMode = packet.mode === "lower-third" ? "lower-third" : "fullscreen";
    const result = await hostShowOnDisplay(packet.display as DockDisplayOutput, packet.item as StudioItem, mode);
    reply(packet, { ...result });
  } else if (packet.type === "close-all") {
    await hostCloseAllProjectors();
    reply(packet, { ok: true });
  } else if (packet.type === "clear") {
    await hostClearDisplay(packet.module as StudioTextModule);
    reply(packet, { ok: true });
  }
}

/** Answer the OBS Dock's display requests. Call once in the main window. */
export function startDockDisplayHost(): () => void {
  // Only the main window answers, so one request never opens two projectors.
  try {
    if (!hasTauriInvoke() || getCurrentWindow().label !== "main") return () => undefined;
  } catch {
    return () => undefined;
  }
  hookProjectors();
  // Projectors left open from before the app window reloaded: reuse them, close duplicates.
  void adoptStrayProjectors();
  const unsubscribe = overlayBridge.subscribe((packet) => { void handleRequest(packet); });
  overlayBridge.connect();
  return () => {
    unsubscribe();
  };
}
