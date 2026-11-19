import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import { LOWER_THIRD_SIZE_PRESETS } from "../bible/types";
import { themeSupportsBibleOverlayMode } from "../bible/themeVariantSupport";
import {
  DOCK_BIBLE_PREFS_KEY,
  resolveDockBibleReferenceLabels,
  resolveDockBibleThemeForOverlayMode,
  applyFullscreenQuickThemeSettings,
} from "./dockBibleThemeResolution";

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

function installStorage(userId = "theme-user"): Storage {
  const storage = createMemoryStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { pathname: "/dock.html" },
  });
  storage.setItem("mce-auth-session", JSON.stringify({
    expiresAt: Date.now() + 60_000,
    user: { id: userId },
  }));
  return storage;
}

function firstThemeFor(mode: "fullscreen" | "lower-third") {
  const theme = BUILTIN_THEMES.find((item) => themeSupportsBibleOverlayMode(item, mode));
  if (!theme) throw new Error(`No built-in ${mode} theme found`);
  return theme;
}

import { removeNativeDockSetting } from "../services/localDockSettings";

describe("dock Bible theme resolution", () => {
  beforeEach(() => {
    installStorage();
    void removeNativeDockSetting(DOCK_BIBLE_PREFS_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the user-scoped saved fullscreen stream style and resolves full theme settings", async () => {
    const theme = firstThemeFor("fullscreen");
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      fullscreenThemeId: theme.id,
      backgroundPreset: "dark",
      fullscreenQuickThemeSettings: {
        fontSize: 74,
        autoFontScale: true,
        fontFamily: "'Georgia', serif",
        fontColor: "#ffeeaa",
        refFontColor: "#aabbcc",
        animation: "none",
        backgroundType: "theme",
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("fullscreen");

    expect(resolved.themeId).toBe(theme.id);
    expect(resolved.themeSettings.fontSize).toBe(74);
    expect(resolved.themeSettings.autoFontScale).toBe(true);
    expect(resolved.themeSettings.fontFamily).toContain("Georgia");
    expect(resolved.themeSettings.fontColor).toBe("#FFEEAA");
    expect(resolved.themeSettings.refFontColor).toBe("#AABBCC");
    expect(resolved.themeSettings.animation).toBe("none");
    expect(resolved.liveOverrides?.backgroundColor).toBe("#060812");
  });

  it("migrates legacy saved settings to always-on text fitting", async () => {
    const theme = firstThemeFor("fullscreen");
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      fullscreenThemeId: theme.id,
      fullscreenQuickThemeSettings: {
        fontSize: 74,
        autoFontScale: false,
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("fullscreen");

    expect(resolved.themeSettings.autoFontScale).toBe(true);
  });

  it("resolves lower-third quick settings into the same complete payload OBS expects", async () => {
    const theme = firstThemeFor("lower-third");
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      lowerThirdThemeId: theme.id,
      lowerThirdQuickThemeSettings: {
        fontSize: 160,
        refFontSize: 80,
        lowerThirdSize: "biggest",
        backgroundType: "color",
        backgroundColor: "#102030",
        fontColor: "#ffffff",
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("lower-third");

    expect(resolved.themeId).toBe(theme.id);
    expect(resolved.themeSettings.fontSize).toBe(160);
    expect(resolved.themeSettings.refFontSize).toBe(80);
    expect(resolved.themeSettings.lowerThirdSize).toBe("biggest");
    expect(resolved.themeSettings.backgroundColor).toBe("#102030");
    expect(resolved.themeSettings.padding).toBe(LOWER_THIRD_SIZE_PRESETS.biggest.padding);
    expect(resolved.themeSettings.safeArea).toBe(LOWER_THIRD_SIZE_PRESETS.biggest.safeArea);
    expect(resolved.themeSettings.lowerThirdBarMaxHeight).toBe(LOWER_THIRD_SIZE_PRESETS.biggest.maxHeight);
    expect(resolved.liveOverrides).toBeNull();
  });

  it("preserves full width preset for lower-third theme resolution", async () => {
    const theme = firstThemeFor("lower-third");
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      lowerThirdThemeId: theme.id,
      lowerThirdQuickThemeSettings: {
        fontSize: 48,
        refFontSize: 28,
        lowerThirdWidthPreset: "full",
        lowerThirdSize: "medium",
        backgroundType: "color",
        backgroundColor: "#0A1838",
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("lower-third");
    expect(resolved.themeSettings.lowerThirdWidthPreset).toBe("full");
  });

  it("uses the saved Bible reference display rules for LM-pushed verses", () => {
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      referenceFormat: "short",
      referenceVersionVisible: false,
    }));

    expect(resolveDockBibleReferenceLabels("1 Corinthians", 3, "10", "KJV")).toEqual({
      rawReferenceLabel: "1 Corinthians 3:10",
      referenceBaseLabel: "ICOR 3:10",
      displayReferenceLabel: "ICOR 3:10",
    });
  });

  it("switches lower-third background from theme with image to color without retaining theme image", async () => {
    const theme = firstThemeFor("lower-third");
    // Simulate base theme having an image or pattern asset
    const baseThemeWithImage = {
      ...theme,
      settings: {
        ...theme.settings,
        backgroundImage: "/uploads/theme-bg.jpg",
        backgroundImageFilePath: "/uploads/theme-bg.jpg",
        backgroundVideo: "/uploads/theme-bg.mp4",
        backgroundPattern: "diagonal-lines",
      },
    };

    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      lowerThirdThemeId: baseThemeWithImage.id,
      lowerThirdQuickThemeSettings: {
        backgroundType: "color",
        backgroundColor: "#112233",
        backgroundColorEnd: "#445566",
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("lower-third");
    expect(resolved.themeSettings.backgroundType).toBe("color");
    expect(resolved.themeSettings.backgroundColor).toBe("#112233");
    expect(resolved.themeSettings.backgroundColorEnd).toBe("#445566");
    expect(resolved.themeSettings.backgroundImage).toBe("");
    expect(resolved.themeSettings.backgroundImageFilePath).toBe("");
    expect(resolved.themeSettings.backgroundVideo).toBe("");
    expect(resolved.themeSettings.backgroundVideoFilePath).toBe("");
    expect(resolved.themeSettings.backgroundPattern).toBe("");
  });

  it("switches lower-third background from theme to pattern without retaining image/video", async () => {
    localStorage.setItem(`${DOCK_BIBLE_PREFS_KEY}:theme-user`, JSON.stringify({
      lowerThirdQuickThemeSettings: {
        backgroundType: "pattern",
        backgroundPattern: "dots",
      },
    }));

    const resolved = await resolveDockBibleThemeForOverlayMode("lower-third");
    expect(resolved.themeSettings.backgroundType).toBe("pattern");
    expect(resolved.themeSettings.backgroundPattern).toBe("dots");
    expect(resolved.themeSettings.backgroundImage).toBe("");
    expect(resolved.themeSettings.backgroundVideo).toBe("");
  });

  it("Colour and Off drop the theme's text box and box picture", () => {
    const theme = {
      ...BUILTIN_THEMES[0],
      settings: { ...BUILTIN_THEMES[0].settings, boxBackground: "rgba(255,0,0,0.8)", boxBackgroundImage: "/uploads/card.png" },
    };
    const quick = { boxBackground: "rgba(255,0,0,0.8)", boxBackgroundImage: "/uploads/card.png", fullscreenShadeOpacity: 0 } as never;
    for (const backgroundType of ["color", "off"] as const) {
      const out = applyFullscreenQuickThemeSettings(theme, { ...(quick as object), backgroundType, backgroundColor: "#123456" } as never);
      expect(out.settings.boxBackground).toBe("transparent");
      expect(out.settings.boxBackgroundImage).toBe("");
    }
    const kept = applyFullscreenQuickThemeSettings(theme, { ...(quick as object), backgroundType: "theme" } as never);
    expect(kept.settings.boxBackgroundImage).toBe("/uploads/card.png");
  });
});
