/**
 * vmixDockWindow.ts — the Dock in its own app window, for churches that run vMix.
 *
 * OBS shows the Dock as a custom browser dock inside OBS. vMix cannot hold a
 * web panel, so the app opens the Dock in a narrow window beside vMix that
 * stays on top until the operator unpins it. It never opens inside the main window.
 */

import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { hasTauriInvoke } from "./tauriSafe";
import { writeDockOutputSoftware } from "../dock/dockOutputSoftware";

export const VMIX_DOCK_WINDOW_LABEL = "mce-vmix-dock";
const PIN_KEY = "mce-vmix-dock-pinned";

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Open the vMix Dock window, or bring it forward if it is already open. */
export async function openVmixDockWindow(): Promise<void> {
  writeDockOutputSoftware("vmix");
  if (!hasTauriInvoke()) {
    window.open(new URL("/dock?output=vmix", window.location.href).toString(), "_blank", "noopener");
    return;
  }
  // Built in Rust (`open_vmix_dock_window`) so the window gets the main
  // window's WebView2 arguments; without them it closes as soon as it opens.
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_vmix_dock_window", { alwaysOnTop: readPinned() });
}

/** True inside the window `openVmixDockWindow` opened. */
export function isVmixDockWindow(): boolean {
  if (!hasTauriInvoke()) return false;
  try {
    return getCurrentWebviewWindow().label === VMIX_DOCK_WINDOW_LABEL;
  } catch {
    return false;
  }
}

export function isVmixDockPinned(): boolean {
  return readPinned();
}

/** Keep the Dock window above vMix (pinned) or let it go behind other windows. */
export async function setVmixDockPinned(pinned: boolean): Promise<void> {
  try {
    localStorage.setItem(PIN_KEY, String(pinned));
  } catch {
    // The window still changes; it just won't be remembered.
  }
  if (!hasTauriInvoke()) return;
  const windowRef = isVmixDockWindow()
    ? getCurrentWebviewWindow()
    : await WebviewWindow.getByLabel(VMIX_DOCK_WINDOW_LABEL);
  await windowRef?.setAlwaysOnTop(pinned);
}
