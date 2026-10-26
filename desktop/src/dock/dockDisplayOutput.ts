/**
 * dockDisplayOutput.ts — "Output → Send to a display".
 *
 * Besides OBS scenes, a Dock tab can show what it sends full screen on a
 * projector, TV or second monitor plugged into this computer. It reuses the
 * Presentation Studio's Program projector (studio-output.html), so the screen
 * looks exactly like Studio Mode.
 *
 * This file is the pure part: the saved choice and how a saved display is
 * matched against the screens connected right now. It never picks this
 * computer's own screen on its own.
 */

/** The look on the display, like a scene target's: the tab's own, or always full screen / lower third. */
export type DockDisplayMode = "inherit" | "fullscreen" | "lower-third";

/** The display choice saved with a tab's Output settings. */
export interface DockDisplayOutput {
  enabled: boolean;
  /** Studio monitor key (name + position + size) of the chosen screen. */
  monitorKey: string;
  /** Its name when it was chosen, to find it again if it moves and to tell the operator which one is missing. */
  monitorName: string;
  /** Full screen unless the operator picks another look (a projector usually wants full screen). */
  mode: DockDisplayMode;
}

export const DEFAULT_DOCK_DISPLAY_OUTPUT: DockDisplayOutput = {
  enabled: false,
  monitorKey: "",
  monitorName: "",
  mode: "fullscreen",
};

/** Tabs whose content the projector page can draw (words and their theme). */
export const DOCK_DISPLAY_MODULES = ["bible", "worship", "notes"] as const;
export type DockDisplayModule = typeof DOCK_DISPLAY_MODULES[number];

export function supportsDockDisplayOutput(module: string): module is DockDisplayModule {
  return (DOCK_DISPLAY_MODULES as readonly string[]).includes(module);
}

export function normalizeDockDisplayOutput(value: unknown): DockDisplayOutput {
  if (!value || typeof value !== "object") return { ...DEFAULT_DOCK_DISPLAY_OUTPUT };
  const candidate = value as Partial<Record<keyof DockDisplayOutput, unknown>>;
  const monitorKey = typeof candidate.monitorKey === "string" ? candidate.monitorKey.trim() : "";
  const monitorName = typeof candidate.monitorName === "string" ? candidate.monitorName.trim() : "";
  return {
    // Turned on without a screen means nothing to send to.
    enabled: candidate.enabled === true && Boolean(monitorKey),
    monitorKey,
    monitorName,
    mode: candidate.mode === "inherit" || candidate.mode === "lower-third" ? candidate.mode : "fullscreen",
  };
}

/** A screen as the desktop app reports it (same shape as the Studio's monitor list). */
export interface DockDisplayInfo {
  key: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** The screen the MakeChurchEazy window is on. */
  isControlScreen: boolean;
}

export interface DockDisplayChoice extends DockDisplayInfo {
  /** This computer's own screen (built in, or the one the app is on): listed, never offered. */
  isComputerScreen: boolean;
}

/** A laptop's own panel, by the names macOS and Windows give it. */
export function isBuiltInDisplayName(name: string): boolean {
  return /built[-\s]?in|internal|retina display|color lcd/i.test(name);
}

export function describeDockDisplays(displays: DockDisplayInfo[]): DockDisplayChoice[] {
  return displays.map((display) => ({
    ...display,
    isComputerScreen: display.isControlScreen || isBuiltInDisplayName(display.name),
  }));
}

/** "LG HDR 4K · 3840×2160" */
export function dockDisplayLabel(display: Pick<DockDisplayInfo, "name" | "width" | "height">): string {
  return `${display.name} · ${display.width}×${display.height}`;
}

/** The screens that may receive content: everything except this computer's own screen. */
export function selectableDockDisplays(displays: DockDisplayInfo[]): DockDisplayChoice[] {
  return describeDockDisplays(displays).filter((display) => !display.isComputerScreen);
}

export type DockDisplayResolution =
  | { status: "ready"; display: DockDisplayChoice; /** The saved key changed (the screen moved); save the new one. */ moved: boolean }
  | { status: "off" }
  | { status: "missing"; monitorName: string }
  | { status: "computer-screen"; monitorName: string };

/** "x,y:WxH" from a monitor key ("Name@x,y:WxH"): where the screen sits and its size. */
function keyGeometry(key: string): string {
  const at = key.lastIndexOf("@");
  return at >= 0 ? key.slice(at + 1) : "";
}

function keySize(key: string): string {
  const geometry = keyGeometry(key);
  return geometry.slice(geometry.indexOf(":") + 1);
}

/**
 * Where the content should go right now. A saved screen is found by its key; then by its
 * name (moved or rearranged); then by place and size (macOS names a re-plugged screen
 * "Monitor #28970" instead of "#28969"); then by size when exactly one other screen has it.
 * When it isn't connected, or it is now this computer's own screen, nothing is projected:
 * the caller tells the operator instead of using another screen.
 */
export function resolveDockDisplayTarget(
  saved: Pick<DockDisplayOutput, "enabled" | "monitorKey" | "monitorName">,
  displays: DockDisplayInfo[],
): DockDisplayResolution {
  if (!saved.enabled || !saved.monitorKey) return { status: "off" };
  const choices = describeDockDisplays(displays);
  const others = choices.filter((display) => !display.isComputerScreen);
  const geometry = keyGeometry(saved.monitorKey);
  const size = keySize(saved.monitorKey);
  const sameSize = size ? others.filter((display) => keySize(display.key) === size) : [];
  const found = choices.find((display) => display.key === saved.monitorKey)
    ?? (saved.monitorName ? others.find((display) => display.name === saved.monitorName) : undefined)
    ?? (geometry ? others.find((display) => keyGeometry(display.key) === geometry) : undefined)
    ?? (sameSize.length === 1 ? sameSize[0] : undefined);
  const monitorName = saved.monitorName || "the chosen display";
  if (!found) return { status: "missing", monitorName };
  if (found.isComputerScreen) return { status: "computer-screen", monitorName };
  return { status: "ready", display: found, moved: found.key !== saved.monitorKey };
}

/** What the operator is told when the content could not go to the display. */
export function dockDisplayProblemMessage(resolution: DockDisplayResolution): string {
  switch (resolution.status) {
    case "missing":
      return `${resolution.monitorName} isn't connected, so nothing was shown on it. OBS still got the content. Plug it in or pick another display in Output.`;
    case "computer-screen":
      return `${resolution.monitorName} is now this computer's own screen, so nothing was projected on it. Pick another display in Output.`;
    default:
      return "";
  }
}
