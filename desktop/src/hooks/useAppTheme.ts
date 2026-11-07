/**
 * useAppTheme.ts — Centralized dark/light mode for the entire app
 *
 * Reads the preference from localStorage and applies the class to <html>.
 * All CSS variables in App.css inherit from :root / :root.light automatically.
 *
 * Usage: Call `useAppTheme()` once in App.tsx root.
 * To change theme: `setAppTheme("dark" | "light" | "system")`
 */

import { useEffect, useSyncExternalStore } from "react";
import { track } from "../services/analytics";
import { readNativeDockSetting, writeNativeDockSetting } from "../services/localDockSettings";
import {
  applyAppAppearanceToDOM,
  loadAppAppearance,
  useAppAppearance,
} from "../services/appAppearance";

const STORAGE_KEY = "obs-church-studio.theme-preference";

type ThemePref = "dark" | "light" | "system";

function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

function loadPref(): ThemePref {
  try {
    const stored = readNativeDockSetting(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;

    // Preserve the older settings-page preference when upgrading to the
    // shared app/Dock theme source of truth.
    const legacy = readNativeDockSetting<Record<string, unknown>>("mv-settings");
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      if (legacy.theme === "dark" || legacy.theme === "light" || legacy.theme === "system") {
        return legacy.theme;
      }
    }
  } catch {
    // ignore
  }
  return "dark";
}

function applyToDOM(effective: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  // `mv-theme-light` is the older name many stylesheets (App.css, library, Multi-View, dashboard)
  // still write their light-mode rules against; keep both in step so every page follows one theme.
  root.classList.toggle("light", effective === "light");
  root.classList.toggle("mv-theme-light", effective === "light");
  root.classList.toggle("mv-theme-dark", effective !== "light");
}

/** Immediately apply on module load (prevents flash) */
if (typeof document !== "undefined") {
  applyToDOM(resolveTheme(loadPref()));
  applyAppAppearanceToDOM(loadAppAppearance(), resolveTheme(loadPref()));
}

// ---------- External store for cross-component reactivity ----------

let currentPref: ThemePref = loadPref();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentPref;
}

/** Re-read the native preference after the desktop database is hydrated. */
export function refreshAppThemePreference(): ThemePref {
  const next = loadPref();
  if (next === currentPref) return currentPref;
  currentPref = next;
  applyToDOM(resolveTheme(currentPref));
  listeners.forEach((cb) => cb());
  return currentPref;
}

export function setAppTheme(pref: ThemePref) {
  currentPref = pref;
  writeNativeDockSetting(STORAGE_KEY, pref);
  const legacy = readNativeDockSetting<Record<string, unknown>>("mv-settings");
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    writeNativeDockSetting("mv-settings", { ...legacy, theme: pref });
  }
  applyToDOM(resolveTheme(pref));
  track("theme_changed", { mode: pref });
  listeners.forEach((cb) => cb());
}

export function getEffectiveTheme(): "dark" | "light" {
  return resolveTheme(currentPref);
}

// ---------- React hook ----------

export function useAppTheme() {
  const pref = useSyncExternalStore(subscribe, getSnapshot);
  const effective = resolveTheme(pref);
  const appAppearance = useAppAppearance();

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      if (currentPref === "system") {
        applyToDOM(resolveTheme("system"));
        listeners.forEach((cb) => cb());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // The main app and OBS dock are separate browser documents. Mirror a mode
  // chosen in either one through the shared user-scoped storage key.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const scopedKey = `${STORAGE_KEY}:`;
      if (event.key !== STORAGE_KEY && !event.key?.startsWith(scopedKey)) return;
      currentPref = loadPref();
      applyToDOM(resolveTheme(currentPref));
      listeners.forEach((cb) => cb());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Re-apply on pref changes
  useEffect(() => {
    applyToDOM(effective);
    applyAppAppearanceToDOM(appAppearance.appearance, effective);
  }, [appAppearance.appearance, effective]);

  return {
    /** The user's saved preference: "dark" | "light" | "system" */
    preference: pref,
    /** The resolved/effective theme applied to the DOM */
    effective,
    /** Change the theme preference */
    setTheme: setAppTheme,
    /** Shared color palette used by the main app and the OBS dock */
    appearance: appAppearance.appearance,
    /** Change the shared color palette */
    setAppearance: appAppearance.setAppearance,
  };
}
