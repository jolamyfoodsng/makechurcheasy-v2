/**
 * MVThemeProvider.tsx — Theme system for dark/light/system modes + high contrast
 *
 * Reads the theme from MVSettings and applies CSS classes to <html>.
 * Also listens to system preference changes for "system" mode.
 */

import { useEffect } from "react";
import { getSettings } from "../mvStore";
import { getEffectiveTheme } from "../../hooks/useAppTheme";

/**
 * Dark / light comes from the one app theme (hooks/useAppTheme.ts), which sets `light` and
 * `mv-theme-light` on <html> for every page. Multi-View only adds its own high-contrast class here,
 * so entering Multi-View can no longer flip the app to a different mode.
 */
function applyTheme(highContrast: boolean): void {
  const root = document.documentElement;
  const light = getEffectiveTheme() === "light";
  root.classList.toggle("light", light);
  root.classList.toggle("mv-theme-light", light);
  root.classList.toggle("mv-theme-dark", !light);
  root.classList.remove("dark");
  root.classList.toggle("mv-high-contrast", highContrast);
}

/**
 * Hook that syncs theme settings to the DOM.
 * Call this once in MVShell or App root.
 */
export function useThemeSync(): void {
  useEffect(() => {
    applyTheme(getSettings().highContrast);

    // Listen for system theme changes (only matters if pref === "system")
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const s = getSettings();
      if (s.theme === "system") {
        applyTheme(s.highContrast);
      }
    };
    mq.addEventListener("change", handler);

    // Also listen for storage events (settings changed from another tab/component)
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "mv-settings") {
        const s = getSettings();
        applyTheme(s.highContrast);
      }
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      mq.removeEventListener("change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
}

/**
 * Re-apply theme right now (call after settings update).
 * This is synchronous and immediate.
 */
export function refreshTheme(): void {
  applyTheme(getSettings().highContrast);
}
