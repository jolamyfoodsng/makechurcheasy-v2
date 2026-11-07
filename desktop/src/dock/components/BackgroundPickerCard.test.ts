import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DockFullscreenQuickThemeSettings } from "./DockFullscreenThemeQuickSettings";
import type { BibleThemeSettings } from "../../bible/types";
import { DEFAULT_THEME_SETTINGS } from "../../bible/types";
import { getManagedUploadFileName } from "../../library/libraryDb";
import overlayHtml from "../../../public/mce-bible-overlay.html?raw";
import worshipOverlayHtml from "../../../public/mce-worship-overlay.html?raw";
import backgroundOverlayHtml from "../../../public/bible-overlay-bg.html?raw";
import noteOverlayHtml from "../../../public/mce-note.html?raw";
import backgroundPickerSource from "./BackgroundPickerCard.tsx?raw";
import {
  BACKGROUND_PATTERN_PICKER_LIMIT,
  BACKGROUND_PICKER_COMPACT_HEIGHT,
  PATTERN_OPTIONS,
  canAddBackgroundPickerAsset,
  getDockPatternLimit,
  limitBackgroundPickerAssets,
  toBackgroundAssetUrl,
} from "./BackgroundPickerCard";
import { checkEntitlementSync } from "../../services/entitlementClient";
import { getDockEntitlementLimit } from "../dockEntitlement";
import dockThemeSettingsModalSource from "./DockThemeSettingsModal.tsx?raw";
import dockOutputQuickActionsSource from "./DockOutputQuickActions.tsx?raw";
import dockBibleTabSource from "../tabs/DockBibleTab.tsx?raw";
import dockNotesTabSource from "../tabs/DockNotesTab.tsx?raw";
import dockBibleThemeResolutionSource from "../dockBibleThemeResolution.ts?raw";
import dockWorshipTabSource from "../tabs/DockWorshipTab.tsx?raw";
import dockThemeDataSource from "../dockThemeData.ts?raw";
import themeCreatorSource from "../../pages/ThemeCreatorModal.tsx?raw";
import productionThemeSettingsSource from "../../pages/ProductionThemeSettingsPage.tsx?raw";
import productionSettingsSource from "../../services/productionSettings.ts?raw";
import bibleDbSource from "../../bible/bibleDb.ts?raw";

const dockCssSource = readFileSync(fileURLToPath(new URL("../dock.css", import.meta.url)), "utf8");
const libraryDbSource = readFileSync(fileURLToPath(new URL("../../library/libraryDb.ts", import.meta.url)), "utf8");
const dockMediaTabSource = readFileSync(fileURLToPath(new URL("../tabs/DockMediaTab.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../../App.tsx", import.meta.url)), "utf8");

describe("Bible save feedback", () => {
  it("wires the explicit Bible save actions to the shared feedback toast", () => {
    expect(dockBibleTabSource).toContain("onSaveFeedback?.(t(\"dock.feedback.bibleDisplaySaved\"");
    expect(dockThemeSettingsModalSource).toContain("t(\"dock.feedback.bibleSettingsSaved\"");
    expect(dockThemeSettingsModalSource).toContain("onSaveFeedback?.(feedbackMsg)");
    expect(backgroundPickerSource).toContain("onSaveFeedback?.(t(\"dock.feedback.backgroundStyleSaved\"");
  });
});

describe("Quick edits affordance", () => {
  it("opens the shared editor from the bottom overflow text action", () => {
    expect(dockOutputQuickActionsSource).not.toContain("onOpenQuickEdits");
    expect(dockBibleTabSource).toContain('onClick={() => openThemeSettings("text")}');
    expect(dockNotesTabSource).toContain("onClick={() => setShowThemeSettings(true)}");
    expect(dockWorshipTabSource).toContain("onClick={() => setShowThemeSettings(true)}");
    expect(dockNotesTabSource).toContain("data-dock-close-overflow=\"true\"");
    expect(dockWorshipTabSource).toContain("data-dock-close-overflow=\"true\"");
  });
});

/* ── Helpers — mirrors the updater pattern each Text tab control uses ── */

type Updater = (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings;

const BASE: DockFullscreenQuickThemeSettings = {
  fontSize: 48,
  fontFamily: "Inter, system-ui, sans-serif",
  refFontSize: 20,
  refFontWeight: "normal",
  fontColor: "#ffffff",
  refFontColor: "#ffffff",
  refPosition: "bottom",
  refTextTransform: "none",
  refLetterSpacing: 0,
  refOpacity: 1,
  refTextAlign: "match",
  refSpacing: 24,
  fullscreenShadeColor: "#000000",
  fullscreenShadeOpacity: 0,
  textAlign: "center",
  lineHeight: 1.4,
  fontWeight: "normal",
  fontStyle: "normal",
  textTransform: "none",
  textShadow: "none",
  animation: "fade",
  animationDuration: 400,
  backgroundImage: "",
  backgroundImageFilePath: "",
  backgroundPattern: "",
  backgroundVideo: "",
  backgroundVideoFilePath: "",
  backgroundOpacity: 1,
  backgroundColor: "#000000",
  backgroundColorEnd: "#000000",
  bgGradientAngle: 180,
  referenceBackgroundEnabled: false,
  referenceBackgroundColor: "#ffffff",
  referenceBackgroundStyle: "solid",
  referenceBackgroundRadius: 12,
  lowerThirdPosition: "left",
  lowerThirdSize: "medium",
  lowerThirdWidthPreset: "md",
  lowerThirdOffsetX: 0,
  lowerThirdCaptionPosition: "bottom",
  compareTranslationWidth: 40,
  compareTranslationGap: 40,
};

/* ── Text Tab updaters (copied verbatim from BackgroundPickerCard.tsx) ── */

function applyUpdater(prev: DockFullscreenQuickThemeSettings, updater: Updater): DockFullscreenQuickThemeSettings {
  return updater(prev);
}

describe("Text Tab settings pipeline", () => {
  it("fontColor: color picker calls onQuickSettingsChange with fontColor", () => {
    const updater: Updater = (prev) => ({ ...prev, fontColor: "#ff0000" });
    const result = applyUpdater(BASE, updater);
    expect(result.fontColor).toBe("#ff0000");
  });

  it("fontSize: slider calls onQuickSettingsChange with fontSize", () => {
    const updater: Updater = (prev) => ({ ...prev, fontSize: Number(72) });
    const result = applyUpdater(BASE, updater);
    expect(result.fontSize).toBe(72);
  });

  it.each(["light", "normal", "bold", "extrabold"] as const)("fontWeight: %s button calls onQuickSettingsChange with fontWeight=%s", (w) => {
    const updater: Updater = (prev) => ({ ...prev, fontWeight: w });
    const result = applyUpdater(BASE, updater);
    expect(result.fontWeight).toBe(w);
  });

  it.each(["left", "center", "right"] as const)("textAlign: %s button calls onQuickSettingsChange with textAlign=%s", (a) => {
    const updater: Updater = (prev) => ({ ...prev, textAlign: a });
    const result = applyUpdater(BASE, updater);
    expect(result.textAlign).toBe(a);
  });

  it("lineHeight: slider calls onQuickSettingsChange with lineHeight", () => {
    const updater: Updater = (prev) => ({ ...prev, lineHeight: Number(1.6) });
    const result = applyUpdater(BASE, updater);
    expect(result.lineHeight).toBe(1.6);
  });

  it.each(["none", "uppercase", "lowercase", "capitalize"] as const)("textTransform: %s button calls onQuickSettingsChange with textTransform=%s", (tc) => {
    const updater: Updater = (prev) => ({ ...prev, textTransform: tc });
    const result = applyUpdater(BASE, updater);
    expect(result.textTransform).toBe(tc);
  });
});

describe("Background picker plan limits", () => {
  const media = ["first", "second", "third", "fourth", "fifth", "sixth"];

  it("shows only the current plan's image and video allowance", () => {
    const freeImageLimit = checkEntitlementSync("images", "free").limit;
    const freeVideoLimit = checkEntitlementSync("videos", "free").limit;
    const basicImageLimit = checkEntitlementSync("images", "basic").limit;
    const growthVideoLimit = checkEntitlementSync("videos", "growth").limit;

    expect(freeImageLimit).toBe(10);
    expect(freeVideoLimit).toBe(5);
    expect(limitBackgroundPickerAssets(media, freeImageLimit)).toEqual(media);
    expect(limitBackgroundPickerAssets(media, freeVideoLimit)).toEqual(media.slice(0, 5));
    expect(limitBackgroundPickerAssets(media, basicImageLimit)).toEqual(media);
    expect(limitBackgroundPickerAssets(media, growthVideoLimit)).toEqual(media);
  });

  it("uses Dock entitlements without requiring the React auth context", () => {
    expect(backgroundPickerSource).toContain('getDockEntitlementLimit("images")');
    expect(backgroundPickerSource).toContain('getDockEntitlementLimit("videos")');
    expect(backgroundPickerSource).not.toContain("useAuth");
    expect(getDockEntitlementLimit("images")).toBe(checkEntitlementSync("images", "free").limit);
    expect(getDockEntitlementLimit("videos")).toBe(checkEntitlementSync("videos", "free").limit);
  });

  it("stops picker uploads at the same quota and limits patterns to the first three", () => {
    expect(canAddBackgroundPickerAsset(2, 3)).toBe(true);
    expect(canAddBackgroundPickerAsset(3, 3)).toBe(false);
    expect(canAddBackgroundPickerAsset(500, -1)).toBe(true);
    expect(limitBackgroundPickerAssets(PATTERN_OPTIONS, BACKGROUND_PATTERN_PICKER_LIMIT)).toEqual(PATTERN_OPTIONS.slice(0, 3));
    expect(BACKGROUND_PATTERN_PICKER_LIMIT).toBe(3);
    expect(getDockPatternLimit(true)).toBe(3);
    expect(getDockPatternLimit(false)).toBe(-1);
    expect(limitBackgroundPickerAssets(PATTERN_OPTIONS, getDockPatternLimit(false))).toHaveLength(PATTERN_OPTIONS.length);

    const imageTabStart = backgroundPickerSource.indexOf("function ImageTab");
    const videoTabStart = backgroundPickerSource.indexOf("function VideoTab", imageTabStart);
    const patternTabStart = backgroundPickerSource.indexOf("function PatternTab", videoTabStart);
    const imageTabSource = backgroundPickerSource.slice(imageTabStart, videoTabStart);
    const videoTabSource = backgroundPickerSource.slice(videoTabStart, patternTabStart);
    const patternTabSource = backgroundPickerSource.slice(patternTabStart);
    expect(imageTabSource).toContain("limitBackgroundPickerAssets(media, limit)");
    expect(imageTabSource).toContain("canAddBackgroundPickerAsset(currentCount, limit)");
    expect(imageTabSource).toContain("disabled={loading || !canUpload}");
    expect(videoTabSource).toContain("limitBackgroundPickerAssets(media, limit)");
    expect(videoTabSource).toContain("canAddBackgroundPickerAsset(currentCount, limit)");
    expect(videoTabSource).toContain("disabled={loading || !canUpload}");
    expect(patternTabSource).toContain("limitBackgroundPickerAssets(PATTERN_OPTIONS, limit)");
  });
});

describe("Background picker compact navigation", () => {
  it("keeps the compact side tabs recognizable as buttons", () => {
    expect(dockCssSource).toContain(".dtb-bg-picker__layout--compact .dtb-bg-picker__tab {");
    expect(dockCssSource).toContain("border: 1px solid color-mix(in srgb, var(--dock-border) 86%, transparent);");
    expect(dockCssSource).toContain("border-radius: 0;");
    expect(dockCssSource).toContain("min-height: 48px;");
    expect(dockCssSource).toContain(".dtb-bg-picker__layout--compact .dtb-bg-picker__tab:focus-visible {");
  });
});

describe("Text appearance layout", () => {
  it("places the color card beside font size for Bible and Reference", () => {
    // Bible text, then Reference text (which only shows the colour card when it is not linked).
    expect(backgroundPickerSource).toMatch(/dtb-typography-control-row">\s*<ColorPickerCard/);
    expect(backgroundPickerSource).toMatch(/dtb-typography-control-row">\s*\{!linked && \(\s*<ColorPickerCard/);
  });
});

describe("Dock motion defaults", () => {
  it("defaults to fade and keeps the dock motion in the live theme payload", () => {
    expect(DEFAULT_THEME_SETTINGS.animation).toBe("fade");
    expect(backgroundPickerSource).toContain("MOTION_OPTIONS");
    expect(backgroundPickerSource).toContain("function MotionSection");
    expect(backgroundPickerSource).toContain('storageScope === "bible" || storageScope === "worship" || storageScope === "notes"');
    expect(backgroundPickerSource).toContain('quickSettings.animation ?? "fade"');
    expect(backgroundPickerSource).not.toContain("Animations are off by default");
    expect(backgroundPickerSource).toContain("animation: event.target.value");
    expect(dockBibleTabSource).toContain("return extracted;");
    expect(dockBibleTabSource).toContain('| "animation"');
  });

  it("does not restart the preview fade when motion is disabled", () => {
    expect(overlayHtml).toContain("function isOverlayAnimationEnabled(data)");
    expect(overlayHtml).toContain("isOverlayAnimationEnabled(packet)");
    expect(overlayHtml).toContain("const animationsEnabled = animationName !== 'none';");
    expect(overlayHtml).toContain("const animateIn = hasShownOnce");
  });

  it("applies the selected motion to Worship and Notes live slide changes", () => {
    for (const source of [worshipOverlayHtml, noteOverlayHtml]) {
      expect(source).toContain("function getOverlayAnimationName(data)");
      expect(source).toContain("function runOverlayTransitionQueue()");
      expect(source).toContain("mce-preview-text-fade-in");
      expect(source).toContain("mce-preview-text-exit");
      expect(source).toContain("prefers-reduced-motion");
      expect(source).toContain("pendingOverlayPacket = packet");
    }
  });

  it("uses the configured motion duration instead of compressing it to a fixed short transition", () => {
    for (const source of [overlayHtml, worshipOverlayHtml, noteOverlayHtml]) {
      expect(source).toContain("Number.isFinite(configuredAnimationDuration)");
      expect(source).toContain("Math.min(1500");
      expect(source).not.toContain("Math.min(170");
      expect(source).not.toContain("* 0.38");
    }
  });
});

describe("Background picker layout", () => {
  it("sizes the picker from the live viewport while the shared content region owns scrolling", () => {
    const tabsIndex = backgroundPickerSource.indexOf('className="dtb-bg-picker__tabs"');
    const scrollIndex = backgroundPickerSource.indexOf('className="dtb-bg-picker__scroll"');

    expect(backgroundPickerSource).toContain('dtb-studio-card dtb-studio-card--picker${isCompactHeight ?');
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeGreaterThan(tabsIndex);
    expect(dockThemeSettingsModalSource).toContain('dtb-studio__settings-view dtb-studio__settings-view--picker');
    expect(dockCssSource).toContain('.dtb-studio__settings-view--picker {\n  overflow: hidden;\n}');
    expect(dockCssSource).toContain('align-items: center;\n  justify-content: center;');
    expect(dockCssSource).toContain('padding: 16px;\n  animation: dtb-studio-fadeIn');
    expect(dockCssSource).toContain('calc(80dvh / var(--dock-font-scale, 1))');
    expect(dockCssSource).toContain('calc((100dvh - 32px) / var(--dock-font-scale, 1))');
    expect(dockCssSource).toContain('--dtb-studio-height: min(');
    expect(dockCssSource).toContain('--dtb-studio-width: min(');
    expect(dockCssSource).toContain('width: var(--dtb-studio-width);\n  max-width: none;\n  height: var(--dtb-studio-height);');
    expect(dockCssSource).not.toMatch(/(?:^|\n)\s*height:\s*50vh;/);
    expect(dockCssSource).toContain('.dtb-studio-card--picker {\n  display: flex;\n  flex: 1 1 auto;\n  width: 100%;\n  max-width: 100%;\n  min-width: 0;\n  min-height: 0;\n}');
    expect(dockCssSource).toContain('.dtb-bg-picker {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: hidden;\n}');
    expect(dockCssSource).toContain('.dtb-bg-picker__grid {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 14px;\n}');
    expect(backgroundPickerSource).toContain('className="dtb-bg-picker__grid dtb-bg-picker__asset-grid"');
    expect(dockMediaTabSource).not.toContain('--scrollable');
    expect(dockCssSource).toContain('height: 260px;\n  max-height: 260px;\n  overflow-x: hidden;\n  overflow-y: auto;');
    expect(dockCssSource).toContain('.dtb-bg-picker__asset-grid {\n  grid-auto-rows: max-content;\n  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));\n  gap: 12px;\n}');
    expect(dockCssSource).toContain('.dock-media-browser {\n  min-height: 0;\n}');
    expect(dockCssSource).toContain('.dtb-bg-picker__theme-grid {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}');
    expect(dockCssSource).not.toContain('max-height: 560px;\n  max-height: min(560px');
    expect(dockCssSource).toContain('overflow-y: auto;');
  });

  it("keeps Bible and Reference subtabs horizontal on short cards", () => {
    expect(BACKGROUND_PICKER_COMPACT_HEIGHT).toBe(520);
    expect(backgroundPickerSource).toContain('data-compact-height={isCompactHeight || undefined}');
    expect(backgroundPickerSource).toContain('aria-orientation={isCompactHeight ? "vertical" : "horizontal"}');
    expect(backgroundPickerSource).toContain('dtb-bg-picker__layout--compact');
    expect(backgroundPickerSource).not.toContain('dtb-bg-picker__panel--compact-subtabs');
    expect(dockThemeSettingsModalSource).toContain('dtb-studio__modal${view === "settings" ? " dtb-studio__modal--picker" : ""}');
    expect(dockCssSource).toContain('.dtb-studio__modal--picker');
    expect(dockCssSource).toContain('.dtb-bg-picker__layout--compact .dtb-bg-picker__tabs');
    expect(dockCssSource).toContain('.dtb-bg-picker__subtabs {\n  display: flex;');
    expect(dockCssSource).not.toContain('.dtb-bg-picker__panel--compact-subtabs');
  });

  it("uses a visible background type select and keeps saved styles behind the overflow menu", () => {
    expect(backgroundPickerSource).toContain('className="dtb-bg-picker__type-select"');
    expect(backgroundPickerSource).toContain('value={bgType}');
    expect(backgroundPickerSource).toContain('className="dtb-local-styles__menu-label"');
    expect(backgroundPickerSource).not.toContain('className="dtb-bg-dropdown__trigger');
    expect(dockCssSource).toContain('.dtb-bg-picker__background-controls {');
    expect(dockCssSource).toContain('.dtb-bg-picker__type-select {');
  });

  it("puts Text appearance before Reference display in the reference settings", () => {
    const referenceSectionStart = backgroundPickerSource.indexOf("function ReferenceSection");
    const referenceSectionSource = backgroundPickerSource.slice(referenceSectionStart);
    const textAppearanceIndex = referenceSectionSource.indexOf("{t('bgPicker.textAppearance', 'Text appearance')}");
    const referenceDisplayIndex = referenceSectionSource.indexOf("<ReferenceDisplaySection");

    expect(referenceSectionStart).toBeGreaterThan(-1);
    expect(textAppearanceIndex).toBeGreaterThan(-1);
    expect(referenceDisplayIndex).toBeGreaterThan(-1);
    expect(textAppearanceIndex).toBeLessThan(referenceDisplayIndex);
  });
});

describe("Background picker background retention", () => {
  it("shows Darkness and Opacity for image, pattern, and video without adding them to Theme", () => {
    expect(backgroundPickerSource).toContain("function BackgroundAppearanceControls");
    expect(backgroundPickerSource).toContain(
      '(bgType === "image" || bgType === "video" || bgType === "pattern")',
    );
    expect(backgroundPickerSource).toContain("fullscreenShadeOpacity: Number(e.target.value) / 100");
    expect(backgroundPickerSource).toContain("backgroundOpacity: Number(e.target.value) / 100");
    expect(backgroundPickerSource).toContain('className="dtb-slider dtb-slider--filled"');
    expect(backgroundPickerSource).toContain("step={10}");
    expect(backgroundPickerSource).toContain('bgType === "theme"');
  });

  it("passes those controls through to every projected background layer", () => {
    expect(dockBibleThemeResolutionSource).toContain("fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity");
    expect(dockBibleThemeResolutionSource).toContain("backgroundOpacity: useNoBg ? 0");
    expect(overlayHtml).toContain("backgroundVideoEl.style.opacity = bgOpacity");
    expect(overlayHtml).toContain("barBackgroundVideoEl.style.opacity = String(s.backgroundOpacity ?? 1)");
    expect(overlayHtml).toContain("root.style.setProperty('--lt-bg-shade-opacity'");
    expect(worshipOverlayHtml).toContain("barBackgroundVideoEl.style.opacity = String(s.backgroundOpacity ?? 1)");
    expect(worshipOverlayHtml).toContain("root.style.setProperty('--lt-bg-shade-opacity'");
    expect(worshipOverlayHtml).toContain("root.style.setProperty('--text-transition-duration', ead + 'ms');");
    expect(overlayHtml).toContain("root.style.setProperty('--bg-opacity', bgOpacity)");
    expect(overlayHtml).toContain("buildShadeGradient(s.fullscreenShadeColor || '#000', s.fullscreenShadeOpacity ?? 0.42)");
  });

  it("invalidates cached overlay themes when an injected image or pattern changes", () => {
    for (const source of [overlayHtml, worshipOverlayHtml, noteOverlayHtml]) {
      expect(source).toContain("lastAppliedThemeKeyByMode.fullscreen = ''");
      expect(source).toContain("lastAppliedThemeKeyByMode['lower-third'] = ''");
    }
  });

  it("keeps the last selected pattern when switching through another background mode", () => {
    const typeChangeStart = backgroundPickerSource.indexOf("const handleTypeChange = useCallback");
    const typeChangeEnd = backgroundPickerSource.indexOf("const persistSavedStyles", typeChangeStart);
    const typeChangeSource = backgroundPickerSource.slice(typeChangeStart, typeChangeEnd);

    expect(typeChangeSource).toContain('backgroundPattern: prev.backgroundPattern || PATTERN_OPTIONS[0]?.src || ""');
    expect(typeChangeSource).not.toContain('backgroundPattern: ""');
    expect(backgroundPickerSource).toContain('backgroundPattern: src');
    expect(backgroundPickerSource).not.toContain('backgroundPattern: ""');
    expect(dockBibleTabSource).toContain('bgType === "pattern"');
    expect(dockBibleThemeResolutionSource).toContain('bgType === "pattern"');
  });
});

describe("Background picker media URLs", () => {
  it("uses the managed uploads URL for legacy filesystem-backed records", () => {
    expect(toBackgroundAssetUrl({
      url: "/Users/pc/Documents/MakeChurchEasy/uploads/old-background.png",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/old-background.png",
    })).toBe("/uploads/old-background.png");
  });

  it("prefers the stable disk filename for uploaded video records", () => {
    expect(toBackgroundAssetUrl({
      url: "http://localhost:1420/uploads/stale-video.mp4",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/live-video.mp4",
      diskFileName: "live-video.mp4",
    })).toBe("/uploads/live-video.mp4");
  });
});

describe("Deleted media propagation", () => {
  it("only resolves exact root uploads for physical deletion", () => {
    expect(getManagedUploadFileName({
      diskFileName: "deleted-image.png",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/deleted-image.png",
      source: "local",
    })).toBe("deleted-image.png");
    expect(getManagedUploadFileName({
      diskFileName: "../outside.png",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/outside.png",
      source: "local",
    })).toBeNull();
    expect(getManagedUploadFileName({
      diskFileName: "template.png",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/backgrounds/template.png",
      source: "template-cloudflare",
    })).toBeNull();
  });

  it("removes the shared file and refreshes every picker copy after deletion", () => {
    expect(libraryDbSource).toContain('invoke("delete_upload_file"');
    expect(libraryDbSource).toContain("/api/delete-upload?fileName=");
    expect(libraryDbSource).toContain("listingAvailable");
    expect(dockMediaTabSource).toContain("deleteUploadedMediaFile");
    expect(dockMediaTabSource).toContain("setUploadedFiles((current)");
    expect(dockMediaTabSource).toContain("await refreshMedia()");
    expect(backgroundPickerSource).toContain('message.type === "state:media-data"');
    expect(backgroundPickerSource).toContain('message.type === "state:library-updated"');
    expect(appSource).toContain("deleteUploadedMediaFile(fileName)");
  });
});

describe("Bible picker reference tabs", () => {
  it("keeps Bible text and layout in the Text and Layout tabs, with reference settings in their own sections", () => {
    expect(backgroundPickerSource).toContain('setActiveTab("text")');
    expect(backgroundPickerSource).toContain('setActiveTab("layout")');
    expect(backgroundPickerSource).toContain("ReferenceDisplaySection");
    expect(backgroundPickerSource).toContain("ReferenceBackgroundSection");
    expect(backgroundPickerSource).toContain("!isBiblePicker && (");
  });

  it("wires Bible reference display preferences from the dock into the picker", () => {
    expect(backgroundPickerSource).toContain("referenceFormat");
    expect(backgroundPickerSource).toContain("referenceVersionVisible");
    expect(backgroundPickerSource).toContain("onReferenceFormatChange");
    expect(backgroundPickerSource).toContain("onReferenceVersionVisibleChange");
    expect(dockThemeSettingsModalSource).toContain("referenceTranslation={referenceTranslation}");
    expect(dockBibleTabSource).toContain("referenceFormat={referenceFormat}");
    expect(dockBibleTabSource).toContain("onReferenceFormatChange={handleReferenceFormatChange}");
    expect(dockBibleTabSource).toContain("onReferenceVersionVisibleChange={handleReferenceVersionVisibleChange}");
  });

  it("keeps reference display changes in the modal draft until Save is pressed", () => {
    expect(dockThemeSettingsModalSource).toContain("draftReferenceFormat");
    expect(dockThemeSettingsModalSource).toContain("draftReferenceVersionVisible");
    expect(dockThemeSettingsModalSource).toContain("referenceFormat={draftReferenceFormat}");
    expect(dockThemeSettingsModalSource).toContain("onReferenceFormatChange={updateDraftReferenceFormat}");
    expect(dockThemeSettingsModalSource).toContain("onReferenceSettingsSave(nextReferenceFormat, nextReferenceVersionVisible)");
    expect(dockThemeSettingsModalSource).toContain("referenceFormat: nextReferenceFormat");
    expect(dockBibleTabSource).toContain("onReferenceSettingsSave={handleReferenceSettingsSave}");
  });
});

describe("Bible stable auto-fit", () => {
  it("keeps the fitted Bible size stable when the verse changes", () => {
    expect(overlayHtml).toContain("stableFullscreenTextSize");
    expect(overlayHtml).toContain("Math.min(baseTextSize, stableFullscreenTextSize)");
    expect(overlayHtml).toContain("function resolveAutoFontFloor(baseSize, fallback)");
    expect(overlayHtml).toContain("const absoluteFloor = Math.max(fallback, 16)");
    expect(overlayHtml).toContain("if (themeChanged) resetStableAutoFitSizes();");
  });
});

describe("Bible reader font-size quick actions", () => {
  it("keeps verse and reference appearance controls in the theme picker", () => {
    const referenceSectionStart = backgroundPickerSource.indexOf("function ReferenceSection");
    const referenceSectionEnd = backgroundPickerSource.indexOf("/* ── Reference Layout Section ── */", referenceSectionStart);
    const referenceSectionSource = backgroundPickerSource.slice(referenceSectionStart, referenceSectionEnd);

    expect(referenceSectionSource).toContain("refFontSize");
    expect(referenceSectionSource).toContain("SliderNumberField");
    expect(referenceSectionSource).toContain("<ReferenceBackgroundSection");
    expect(backgroundPickerSource).toContain("referenceBackgroundColor");
    expect(dockBibleTabSource).toContain("handleSyncBibleBrowserSettings");
    expect(dockBibleTabSource).toContain("autoFontScale: true");
    expect(dockBibleTabSource).toContain("nextLowerThirdSettings");
    expect(dockBibleTabSource).toContain("saveBrowserQuickSettings");
    expect(dockBibleTabSource).toContain("refreshCurrentBibleOutputAfterThemeSave");
  });
});

/* ── Full pipeline: after updater → applyFullscreenQuickThemeSettings → BibleThemeSettings ── */

function applyFullscreenQuickThemeSettings(
  theme: { settings: BibleThemeSettings },
  quickSettings: DockFullscreenQuickThemeSettings | null,
): { settings: BibleThemeSettings } {
  if (!quickSettings) return theme;
  const bgType = quickSettings.backgroundType
    ?? (quickSettings.backgroundVideo
      ? "video"
      : quickSettings.backgroundImage
        ? "image"
        : quickSettings.backgroundPattern
          ? "pattern"
          : quickSettings.backgroundColor && quickSettings.backgroundColor !== "transparent"
            ? "color"
            : "theme");
  const useThemeBg = bgType === "theme";
  const useNoBg = bgType === "off";
  const useColorBg = bgType === "color";
  return {
      ...theme,
    settings: {
      ...theme.settings,
      backgroundType: bgType,
      fontSize: quickSettings.fontSize,
      refFontSize: quickSettings.refFontSize,
      fontColor: quickSettings.fontColor,
      refFontColor: quickSettings.refFontColor,
      refPosition: quickSettings.refPosition,
      refTextTransform: quickSettings.refTextTransform,
      refLetterSpacing: quickSettings.refLetterSpacing,
      refOpacity: quickSettings.refOpacity,
      refTextAlign: quickSettings.refTextAlign,
      refSpacing: quickSettings.refSpacing,
      fullscreenShadeColor: quickSettings.fullscreenShadeColor,
      fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity,
      fullscreenShadeEnabled: quickSettings.fullscreenShadeOpacity > 0,
      textAlign: quickSettings.textAlign,
      lineHeight: quickSettings.lineHeight,
      fontWeight: quickSettings.fontWeight,
      refFontWeight: quickSettings.refFontWeight,
      textTransform: quickSettings.textTransform,
      textShadow: quickSettings.textShadow,
      animation: quickSettings.animation,
      animationDuration: quickSettings.animationDuration,
      backgroundImage: useNoBg ? "" : useThemeBg ? (theme.settings.backgroundImage ?? "") : quickSettings.backgroundImage,
      backgroundImageFilePath: useNoBg ? "" : useThemeBg ? (theme.settings.backgroundImageFilePath ?? "") : quickSettings.backgroundImageFilePath,
      backgroundVideo: useNoBg ? "" : useThemeBg ? (theme.settings.backgroundVideo ?? "") : quickSettings.backgroundVideo,
      backgroundVideoFilePath: useNoBg ? "" : useThemeBg ? (theme.settings.backgroundVideoFilePath ?? "") : quickSettings.backgroundVideoFilePath,
      backgroundOpacity: useNoBg ? 0 : quickSettings.backgroundOpacity,
      backgroundColor: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColor || "#0B1426")
          : useColorBg
            ? (quickSettings.backgroundColor || "#0B1426")
            : (quickSettings.backgroundColor || "transparent"),
      backgroundColorEnd: useNoBg
        ? "transparent"
        : useThemeBg
          ? (theme.settings.backgroundColorEnd || "#162040")
          : useColorBg
            ? (quickSettings.backgroundColorEnd || "#162040")
            : (quickSettings.backgroundColorEnd || ""),
      bgGradientAngle: useThemeBg ? (theme.settings.bgGradientAngle ?? 180) : quickSettings.bgGradientAngle,
      backgroundPattern: useNoBg ? "" : useThemeBg ? (theme.settings.backgroundPattern ?? "") : quickSettings.backgroundPattern,
      fontStyle: quickSettings.fontStyle,
    },
  };
}

function extractFullscreenQuickThemeSettings(
  settings: BibleThemeSettings,
): DockFullscreenQuickThemeSettings {
  return {
    ...BASE,
    fontSize: settings.fontSize ?? BASE.fontSize,
    fontColor: settings.fontColor ?? BASE.fontColor,
    textAlign: settings.textAlign ?? BASE.textAlign,
    lineHeight: settings.lineHeight ?? BASE.lineHeight,
    fontWeight: settings.fontWeight ?? BASE.fontWeight,
    fontStyle: settings.fontStyle ?? BASE.fontStyle,
    textTransform: settings.textTransform ?? BASE.textTransform,
  };
}

describe("Full pipeline: Text tab → BibleThemeSettings → extract back", () => {
  const baseTheme = { settings: { fontSize: 48, fontColor: "#ffffff", textAlign: "center", lineHeight: 1.4, fontWeight: "normal", fontStyle: "normal", textTransform: "none", refFontSize: 20, refFontWeight: "normal", refFontColor: "#ffffff", refPosition: "bottom", refTextTransform: "none", refLetterSpacing: 0, refOpacity: 1, refTextAlign: "match", refSpacing: 24, fullscreenShadeColor: "#000000", fullscreenShadeOpacity: 0, fullscreenShadeEnabled: false, textShadow: "none", animation: "none", animationDuration: 400, backgroundImage: "", backgroundImageFilePath: "", backgroundPattern: "", backgroundVideo: "", backgroundVideoFilePath: "", backgroundOpacity: 1, backgroundColor: "#000000", backgroundColorEnd: "#000000", bgGradientAngle: 180, referenceBackgroundEnabled: false, referenceBackgroundColor: "#ffffff", referenceBackgroundStyle: "solid", referenceBackgroundRadius: 12, lowerThirdPosition: "left", lowerThirdSize: "medium", lowerThirdWidthPreset: "md", lowerThirdOffsetX: 0, lowerThirdCaptionPosition: "bottom", } as unknown as BibleThemeSettings };

  it("fontColor changes round-trips through theme settings", () => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, fontColor: "#ff0000" };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.fontColor).toBe("#ff0000");
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.fontColor).toBe("#ff0000");
  });

  it("fontSize changes round-trips through theme settings", () => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, fontSize: 72 };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.fontSize).toBe(72);
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.fontSize).toBe(72);
  });

  it.each(["light", "normal", "bold", "extrabold"] as const)("fontWeight=%s round-trips", (weight) => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, fontWeight: weight };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.fontWeight).toBe(weight);
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.fontWeight).toBe(weight);
  });

  it.each(["left", "center", "right"] as const)("textAlign=%s round-trips", (align) => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, textAlign: align };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.textAlign).toBe(align);
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.textAlign).toBe(align);
  });

  it("lineHeight changes round-trips", () => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, lineHeight: 1.8 };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.lineHeight).toBe(1.8);
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.lineHeight).toBe(1.8);
  });

  it.each(["none", "uppercase", "lowercase", "capitalize"] as const)("textTransform=%s round-trips", (tc) => {
    const quickSettings: DockFullscreenQuickThemeSettings = { ...BASE, textTransform: tc };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.textTransform).toBe(tc);
    const extracted = extractFullscreenQuickThemeSettings(themed.settings);
    expect(extracted.textTransform).toBe(tc);
  });

  it("image background does not get overridden by fallback gradient colors", () => {
    const quickSettings: DockFullscreenQuickThemeSettings = {
      ...BASE,
      backgroundType: "image",
      backgroundImage: "/uploads/example.png",
      backgroundColor: "",
      backgroundColorEnd: "",
    };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.backgroundImage).toBe("/uploads/example.png");
    expect(themed.settings.backgroundType).toBe("image");
    expect(themed.settings.backgroundColor).toBe("transparent");
    expect(themed.settings.backgroundColorEnd).toBe("");
  });

  it("video background keeps the video source and does not inject gradient defaults", () => {
    const quickSettings: DockFullscreenQuickThemeSettings = {
      ...BASE,
      backgroundType: "video",
      backgroundVideo: "/uploads/example.mp4",
      backgroundColor: "",
      backgroundColorEnd: "",
    };
    const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
    expect(themed.settings.backgroundVideo).toBe("/uploads/example.mp4");
    expect(themed.settings.backgroundType).toBe("video");
    expect(themed.settings.backgroundColor).toBe("transparent");
    expect(themed.settings.backgroundColorEnd).toBe("");
  });

  it("survives 50 sequential font and background changes without dropping the latest values", () => {
    const variants: Array<{
      backgroundType: DockFullscreenQuickThemeSettings["backgroundType"];
      backgroundColor: string;
      backgroundColorEnd: string;
      backgroundImage: string;
      backgroundVideo: string;
      backgroundPattern: string;
    }> = [
        {
          backgroundType: "color",
          backgroundColor: "#102030",
          backgroundColorEnd: "#405060",
          backgroundImage: "",
          backgroundVideo: "",
          backgroundPattern: "",
        },
        {
          backgroundType: "image",
          backgroundColor: "",
          backgroundColorEnd: "",
          backgroundImage: "/uploads/stress-image.png",
          backgroundVideo: "",
          backgroundPattern: "",
        },
        {
          backgroundType: "video",
          backgroundColor: "",
          backgroundColorEnd: "",
          backgroundImage: "",
          backgroundVideo: "/uploads/stress-video.mp4",
          backgroundPattern: "",
        },
        {
          backgroundType: "pattern",
          backgroundColor: "transparent",
          backgroundColorEnd: "",
          backgroundImage: "",
          backgroundVideo: "",
          backgroundPattern: "diagonal-lines",
        },
        {
          backgroundType: "off",
          backgroundColor: "transparent",
          backgroundColorEnd: "transparent",
          backgroundImage: "",
          backgroundVideo: "",
          backgroundPattern: "",
        },
      ];

    const baseTheme = {
      settings: {
        fontSize: 48,
        fontColor: "#ffffff",
        textAlign: "center",
        lineHeight: 1.4,
        fontWeight: "normal",
        fontStyle: "normal",
        textTransform: "none",
        refFontSize: 20,
        refFontWeight: "normal",
        refFontColor: "#ffffff",
        refPosition: "bottom",
        refTextTransform: "none",
        refLetterSpacing: 0,
        refOpacity: 1,
        refTextAlign: "match",
        refSpacing: 24,
        fullscreenShadeColor: "#000000",
        fullscreenShadeOpacity: 0,
        fullscreenShadeEnabled: false,
        textShadow: "none",
        animation: "none",
        animationDuration: 400,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundPattern: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundOpacity: 1,
        backgroundColor: "#000000",
        backgroundColorEnd: "#000000",
        bgGradientAngle: 180,
        referenceBackgroundEnabled: false,
        referenceBackgroundColor: "#ffffff",
        referenceBackgroundStyle: "solid",
        referenceBackgroundRadius: 12,
        lowerThirdPosition: "left",
        lowerThirdSize: "medium",
        lowerThirdWidthPreset: "md",
        lowerThirdOffsetX: 0,
        lowerThirdCaptionPosition: "bottom",
      } as unknown as BibleThemeSettings,
    };

    for (let index = 0; index < 50; index += 1) {
      const variant = variants[index % variants.length];
      const fontSize = 48 + index;
      const quickSettings: DockFullscreenQuickThemeSettings = {
        ...BASE,
        fontSize,
        fontColor: `#${(0x110000 + index).toString(16).padStart(6, "0").slice(-6)}`,
        backgroundType: variant.backgroundType,
        backgroundColor: variant.backgroundColor,
        backgroundColorEnd: variant.backgroundColorEnd,
        backgroundImage: variant.backgroundImage,
        backgroundVideo: variant.backgroundVideo,
        backgroundPattern: variant.backgroundPattern,
      };

      const themed = applyFullscreenQuickThemeSettings(baseTheme, quickSettings);
      const extracted = extractFullscreenQuickThemeSettings(themed.settings);

      expect(themed.settings.fontSize).toBe(fontSize);
      expect(extracted.fontSize).toBe(fontSize);
      expect(themed.settings.fontColor).toBe(quickSettings.fontColor);
      expect(extracted.fontColor).toBe(quickSettings.fontColor);
      switch (variant.backgroundType) {
        case "color":
          expect(themed.settings.backgroundColor).toBe(variant.backgroundColor);
          expect(themed.settings.backgroundColorEnd).toBe(variant.backgroundColorEnd);
          break;
        case "image":
          expect(themed.settings.backgroundImage).toBe(variant.backgroundImage);
          expect(themed.settings.backgroundColor).toBe("transparent");
          break;
        case "video":
          expect(themed.settings.backgroundVideo).toBe(variant.backgroundVideo);
          expect(themed.settings.backgroundColor).toBe("transparent");
          break;
        case "pattern":
          expect(themed.settings.backgroundPattern).toBe(variant.backgroundPattern);
          expect(themed.settings.backgroundColor).toBe("transparent");
          break;
        case "off":
          expect(themed.settings.backgroundColor).toBe("transparent");
          expect(themed.settings.backgroundImage).toBe("");
          expect(themed.settings.backgroundVideo).toBe("");
          expect(themed.settings.backgroundPattern).toBe("");
          expect(themed.settings.backgroundOpacity).toBe(0);
          break;
        default:
          break;
      }
    }
  });
});

describe("Active OBS Bible overlay wiring", () => {
  it("consumes compare layout fields emitted by BackgroundPickerCard", () => {
    expect(overlayHtml).toContain("s.compareLeftWidth");
    expect(overlayHtml).toContain("s.compareRightWidth");
    expect(overlayHtml).toContain("s.compareOuterPaddingTop");
    expect(overlayHtml).toContain("s.compareOuterPaddingRight");
    expect(overlayHtml).toContain("s.compareOuterPaddingBottom");
    expect(overlayHtml).toContain("s.compareOuterPaddingLeft");
    expect(overlayHtml).toContain("s.comparePanelInnerPadding");
    expect(overlayHtml).toContain("s.compareReferencePositionLeft");
    expect(overlayHtml).toContain("s.compareReferencePositionRight");
  });

  it("uses the compare text alignment for references without a separate reference alignment setting", () => {
    expect(overlayHtml).toContain("const compareReferenceAlign = compareTextAlignForReference(compareAlign)");
    expect(overlayHtml).toContain("root.style.setProperty('--compare-reference-align', compareReferenceAlign)");
    expect(overlayHtml).toContain("root.style.setProperty('--compare-inline-align', mapFlexAlign(compareReferenceAlign))");
    expect(overlayHtml).toContain("align-self: var(--compare-inline-align, center)");
    expect(overlayHtml).toContain("#compare-layout.is-line-by-line .compare-column__reference");
    expect(overlayHtml).toContain("compareLayout.classList.toggle('is-line-by-line', mode === 'line-by-line')");
    expect(backgroundPickerSource).not.toContain("Reference alignment");
    expect(backgroundPickerSource).not.toContain("compareReferenceAlignmentLeft");
    expect(backgroundPickerSource).not.toContain("compareReferenceAlignmentRight");
  });

  it("opens compare layout preset and gap controls from a compact icon trigger", () => {
    expect(backgroundPickerSource).toContain("function CompareLayoutPopover");
    expect(backgroundPickerSource).toContain("aria-label=\"Layout and gap\"");
    expect(backgroundPickerSource).toContain("label=\"Gap between columns\"");
    expect(backgroundPickerSource).toContain("label=\"Background\"");
    expect(backgroundPickerSource).not.toContain("label=\"Layout preset\"");
  });

  it("keeps compare-only quick settings compact without the single Compare tab or theme presets", () => {
    const comparePanelStart = backgroundPickerSource.indexOf("function CompareSettingsPanel");
    const comparePanelEnd = backgroundPickerSource.indexOf("/* ── Inline Color Picker ── */", comparePanelStart);
    const comparePanelSource = backgroundPickerSource.slice(comparePanelStart, comparePanelEnd);

    expect(backgroundPickerSource).toContain('const compareOnlyMode = hideBackgroundOnCompare && displayMode === "compare"');
    expect(backgroundPickerSource).toContain('{!compareOnlyMode && (');
    expect(backgroundPickerSource).toContain("dtb-bg-picker--compare-only");
    expect(backgroundPickerSource).toContain("const COMPARE_BG_OPTIONS = BG_OPTIONS.filter((option) => option.id !== \"theme\")");
    expect(comparePanelSource).toContain("resolvedCompareBackdropValue");
    expect(comparePanelSource).toContain("COMPARE_BG_OPTIONS.map");
    expect(comparePanelSource).not.toContain("<ThemeSection");
  });

  it("exposes lower-third bar placement and direction controls inside compare settings", () => {
    const comparePanelStart = backgroundPickerSource.indexOf("function CompareSettingsPanel");
    const comparePanelEnd = backgroundPickerSource.indexOf("/* ── Inline Color Picker ── */", comparePanelStart);
    const comparePanelSource = backgroundPickerSource.slice(comparePanelStart, comparePanelEnd);

    expect(comparePanelSource).toContain('overlayMode === "lower-third"');
    expect(comparePanelSource).toContain("compareLowerThirdTextDirection");
    expect(comparePanelSource).toContain("lowerThirdEdge: edge");
    expect(comparePanelSource).toContain("lowerThirdTextDirection: direction");
    expect(comparePanelSource).toContain("bgPicker.lowerThirdBar");
    expect(comparePanelSource).toContain("bgPicker.lowerThirdPlacement");
    expect(comparePanelSource).toContain("bgPicker.textDirection");
    expect(overlayHtml).toContain("const isCompare = sl.layout === 'compare'");
    expect(overlayHtml).toContain("compareMode === 'passages' ? cc.length >= 2 : cc.length === 2");
    expect(overlayHtml).toContain("grid-template-columns: repeat(var(--compare-column-count, 2), minmax(0, 1fr));");
    expect(overlayHtml).toContain("compareLayout.style.setProperty('--compare-column-count', String(passageColumnCount));");
    expect(overlayHtml).toContain("#compare-layout .compare-column--line-hidden {\n      display: none;");
    expect(overlayHtml).not.toContain("#compare-layout.is-multi-passage .compare-column--line-hidden {\n      display: flex;");
    expect(overlayHtml).toContain("ltBar.classList.add('lt-edge-' + edge)");
    expect(overlayHtml).toContain("ltBar.classList.toggle('lt-text-inverted'");
  });

  it("places compare font weight and text alignment side by side with compact icon controls", () => {
    const comparePanelStart = backgroundPickerSource.indexOf("function CompareSettingsPanel");
    const comparePanelEnd = backgroundPickerSource.indexOf("/* ── Inline Color Picker ── */", comparePanelStart);
    const comparePanelSource = backgroundPickerSource.slice(comparePanelStart, comparePanelEnd);

    expect(comparePanelSource).toContain('className="dtb-compare-style-grid"');
    expect(comparePanelSource).toContain('label="Font weight"');
    expect(comparePanelSource).toContain('label="Text alignment"');
    expect(comparePanelSource).toContain("getCompareWeightOptions()");
    expect(comparePanelSource).toContain("getCompareAlignOptions()");
  });

  it("keeps text weight and text case in compact side-by-side dropdowns", () => {
    const textSectionStart = backgroundPickerSource.indexOf("{/* ── Bible Text Section ── */}");
    const referenceSectionStart = backgroundPickerSource.indexOf("{/* ── Reference Section ── */}", textSectionStart);
    const textSectionSource = backgroundPickerSource.slice(textSectionStart, referenceSectionStart);

    expect(textSectionSource).toContain("dtb-typography-control-row");
    expect(backgroundPickerSource).toContain('["light", "normal", "bold", "extrabold", "black"]');
    expect(textSectionSource).toContain("fontWeight: w");
    expect(textSectionSource).toContain("lineHeight: value");
    expect(textSectionSource).toContain("textTransform: tc");
    expect(textSectionSource).toContain("CompactSelectField<CompactFontWeight>");
    expect(textSectionSource).toContain("CompactSelectField<CompactTextCase>");
    expect(textSectionSource).toContain("TEXT_SHADOW_PRESETS");
    expect(textSectionSource).toContain("TEXT_OUTLINE_OPTIONS");
    expect(textSectionSource).not.toContain("dtb-btn-easyworship-pop");
    expect(textSectionSource).not.toContain("sermon.typography");
    expect(textSectionSource).not.toContain("common.moreOptions");
  });

  it("applies worship text case directly in the overlay renderer", () => {
    expect(worshipOverlayHtml).toContain("function applyDisplayTextTransform");
    expect(worshipOverlayHtml).toContain("case 'uppercase': return value.toLocaleUpperCase()");
    expect(worshipOverlayHtml).toContain("verseText.innerHTML = renderVerseLines(applyDisplayTextTransform(displayText.primary, textTransform), sl.lineCount);");
    expect(worshipOverlayHtml).toContain("renderTranslationBlock(translationText, displayText.secondary, textTransform);");
  });

  it("adds a Layout tab and groups text layout controls there", () => {
    const tabNavigationStart = backgroundPickerSource.indexOf("{/* Tab Navigation */}");
    const backgroundTabStart = backgroundPickerSource.indexOf("{/* Background Tab */}", tabNavigationStart);
    const tabNavigationSource = backgroundPickerSource.slice(tabNavigationStart, backgroundTabStart);

    expect(tabNavigationSource).toContain('setActiveTab("layout")');
    expect(tabNavigationSource).toContain('activeTab === "layout"');
    expect(tabNavigationSource).toContain("bgPicker.layout");

    const layoutSectionStart = backgroundPickerSource.indexOf("{/* Layout Tab */}");
    const compareTabStart = backgroundPickerSource.indexOf("{/* Compare Tab */}", layoutSectionStart);
    const layoutSectionSource = backgroundPickerSource.slice(layoutSectionStart, compareTabStart);
    const layoutIndex = layoutSectionSource.indexOf("bgPicker.layout");
    const textAlignIndex = layoutSectionSource.indexOf("textAlign: a");
    const lowerThirdBarIndex = layoutSectionSource.indexOf("bgPicker.lowerThirdBar");
    const paddingIndex = layoutSectionSource.indexOf("bgPicker.linkTextPadding");

    expect(layoutSectionSource).toContain('activeTab === "layout"');
    expect(layoutIndex).toBeGreaterThan(-1);
    expect(textAlignIndex).toBeGreaterThan(layoutIndex);
    expect(lowerThirdBarIndex).toBeGreaterThan(textAlignIndex);
    expect(paddingIndex).toBeGreaterThan(lowerThirdBarIndex);
    expect(layoutSectionSource).not.toContain("setSpacingShapeOpen");
    expect(layoutSectionSource).not.toContain("dtb-control-section--collapsible");
    expect(layoutSectionSource).not.toContain("bgPicker.spacingAndShape");
  });

  it("keeps reference typography in Text and moves reference layout controls into Layout", () => {
    const referenceSectionStart = backgroundPickerSource.indexOf("function ReferenceSection");
    const referenceSectionEnd = backgroundPickerSource.indexOf("/* ── Reference Layout Section ── */", referenceSectionStart);
    const referenceSectionSource = backgroundPickerSource.slice(referenceSectionStart, referenceSectionEnd);
    const colorIndex = referenceSectionSource.indexOf("refFontColor: v");
    const fontSizeIndex = referenceSectionSource.indexOf("bgPicker.fontSize");
    const weightIndex = referenceSectionSource.indexOf("refFontWeight: w");
    const textCaseIndex = referenceSectionSource.indexOf("refTextTransform: tc");
    const moreOptionsIndex = referenceSectionSource.indexOf("common.moreOptions");

    expect(colorIndex).toBeGreaterThan(-1);
    expect(fontSizeIndex).toBeGreaterThan(-1);
    expect(fontSizeIndex).toBeGreaterThan(colorIndex);
    expect(weightIndex).toBeGreaterThan(fontSizeIndex);
    expect(textCaseIndex).toBeGreaterThan(weightIndex);
    expect(referenceSectionSource).toContain("CompactSelectField<CompactFontWeight>");
    expect(referenceSectionSource).toContain("CompactSelectField<CompactTextCase>");
    expect(moreOptionsIndex).toBeGreaterThan(textCaseIndex);
    expect(referenceSectionSource).not.toContain("refTextAlign: a");
    expect(referenceSectionSource).not.toContain("setReferencePlacement");
    expect(referenceSectionSource).not.toContain("Reference Placement");
    expect(referenceSectionSource).not.toContain("Reference Spacing");
    expect(referenceSectionSource).not.toContain("bgPicker.nearVersePosition");
    expect(referenceSectionSource).not.toContain("Near verse");

    const referenceLayoutStart = backgroundPickerSource.indexOf("function ReferenceLayoutSection");
    const referenceLayoutEnd = backgroundPickerSource.indexOf("/* ── Reference Background ── */", referenceLayoutStart);
    const referenceLayoutSource = backgroundPickerSource.slice(referenceLayoutStart, referenceLayoutEnd);
    const alignmentIndex = referenceLayoutSource.indexOf("refTextAlign: a");
    const placementIndex = referenceLayoutSource.indexOf("Reference Placement");
    const spacingIndex = referenceLayoutSource.indexOf("Reference Spacing");

    expect(referenceLayoutSource).toContain("bgPicker.reference");
    expect(referenceLayoutSource).toContain("bgPicker.layout");
    expect(referenceLayoutSource).toContain("IconSegmentedControl<CompactTextAlign>");
    expect(alignmentIndex).toBeGreaterThan(-1);
    expect(placementIndex).toBeGreaterThan(alignmentIndex);
    expect(spacingIndex).toBeGreaterThan(placementIndex);
    expect(referenceLayoutSource).toContain("setReferencePlacement");
    expect(referenceLayoutSource).toContain('"top"');
    expect(referenceLayoutSource).toContain('"bottom"');
  });

  it("places reference typography first and keeps its badge color control inside that section", () => {
    const referenceSectionStart = backgroundPickerSource.indexOf("function ReferenceSection");
    const referenceSectionEnd = backgroundPickerSource.indexOf("/* ── Reference Layout Section ── */", referenceSectionStart);
    const referenceSectionSource = backgroundPickerSource.slice(referenceSectionStart, referenceSectionEnd);
    const referenceBackgroundIndex = referenceSectionSource.indexOf("<ReferenceBackgroundSection");
    const textAppearanceIndex = referenceSectionSource.indexOf("dtb-control-section__title");
    const referenceBackgroundStart = backgroundPickerSource.indexOf("function ReferenceBackgroundSection");
    const referenceBackgroundEnd = backgroundPickerSource.indexOf("/* ── Reference Layout Section ── */", referenceBackgroundStart);
    const referenceBackgroundSource = backgroundPickerSource.slice(referenceBackgroundStart, referenceBackgroundEnd);

    expect(referenceBackgroundIndex).toBeGreaterThan(-1);
    expect(referenceBackgroundIndex).toBeGreaterThan(textAppearanceIndex);
    expect(referenceBackgroundSource).toContain('label={t(\'bgPicker.background\', \'Background\')}');
    expect(referenceBackgroundSource).toContain("referenceBackgroundColor");
    expect(referenceBackgroundSource).toContain("<ColorPickerCard");
    expect(referenceSectionSource).not.toContain('showColorPicker={false}');
    expect(dockCssSource).toContain(".dtb-color-inline__trigger--card");
    expect(dockCssSource).toContain(".dtb-bg-picker__subtab--active");

    const inlinePickerStart = backgroundPickerSource.indexOf("function InlineColorPicker");
    const inlinePickerSource = backgroundPickerSource.slice(inlinePickerStart);
    const cardBranchStart = inlinePickerSource.indexOf('{variant === "card" ? (');
    const cardBranchEnd = inlinePickerSource.indexOf(": (", cardBranchStart);
    const cardBranchSource = inlinePickerSource.slice(cardBranchStart, cardBranchEnd);
    expect(cardBranchSource).toContain("dtb-color-inline__card-swatch");
    expect(cardBranchSource).not.toContain("dtb-color-inline__hex");
    expect(backgroundPickerSource).toContain('variant="card"');
    expect(backgroundPickerSource).toContain("dtb-color-picker-card__label");
  });

  it("centers Bible compare content by default while keeping edge-aware lower-third placement", () => {
    expect(overlayHtml).toContain("#compare-layout");
    expect(overlayHtml).toContain("align-content: center");
    expect(overlayHtml).toContain("function normalizeCompareVerticalAlign");
    expect(overlayHtml).toContain("compareGridVerticalAlign(leftVerticalAlign, 'center')");
    expect(overlayHtml).toContain("compareColumnVerticalAlign(index === 1 ? rightVerticalAlign : leftVerticalAlign, 'flex-start')");
    expect(overlayHtml).toContain("const edge = s.lowerThirdEdge === 'top' || s.lowerThirdEdge === 'left' || s.lowerThirdEdge === 'right' ? s.lowerThirdEdge : 'bottom'");
    expect(overlayHtml).toContain("ltBar.classList.add('lt-edge-' + edge)");
    expect(overlayHtml).toContain("ltBar.style.justifyContent = edge === 'left' || edge === 'right'");
    expect(overlayHtml).toContain("lowerThirdContentVerticalAlign(s.lowerThirdCaptionPosition)");
    expect(backgroundPickerSource).toContain('storageScope === "bible" || storageScope === "worship" || storageScope === "notes"');
  });

  it("renders compare reference and bible version as one label", () => {
    expect(overlayHtml).toContain("function formatCompareReference");
    expect(overlayHtml).toContain("formatCompareReference(value.reference, value.translation)");
    expect(overlayHtml).toContain("const columns = [");
    expect(overlayHtml).toContain("[compareTranslationLeft, compareTranslationRight, compareTranslationThird]");
    expect(overlayHtml).toContain("lt-compare-unit");
  });

  it("auto-scales line-by-line compare content against the actual overlay frame", () => {
    expect(overlayHtml).toContain("function getVisibleCompareFitNodes()");
    expect(overlayHtml).toContain("function resolveCompareAutoFontFloor(baseSize)");
    expect(overlayHtml).toContain("if (!String(node.textContent || '').trim()) return false");
    expect(overlayHtml).toContain("const rects = node.getClientRects()");
    expect(overlayHtml).toContain("compareTextLeft?.querySelector('.compare-line-list')");
    expect(overlayHtml).toContain("isContentOutsideFrame(fitNodes, compareLayout) || isContentOutsideFrame(fitNodes, overlay)");
    expect(overlayHtml).toContain("isOverflowing(column, width, frameHeight)");
    expect(overlayHtml).toContain("#compare-layout.is-line-by-line .compare-column");
    expect(overlayHtml).toContain("max-height: 100%");
  });

  it("renders lower-third Bible content at the configured font size without unstable shrink loops", () => {
    expect(overlayHtml).toContain("function autoScaleLowerThirdContent()");
    expect(overlayHtml).toContain("const baseTextSize = Math.max(10, Math.round(baseFontSize));");
    expect(overlayHtml).toContain("ltVerseText.style.fontSize = `${baseTextSize}px`;");
    expect(overlayHtml).toContain("const wp2 = s.lowerThirdWidthPreset || 'full'");
    expect(overlayHtml).toContain("root.style.setProperty('--lt-max-width', isLowerThird ? 'none'");
    expect(overlayHtml).toContain("root.style.setProperty('--lt-text-max-width', isLowerThird ? '100%' : wpr.maxWidth + 'px')");
    expect(overlayHtml).toContain("max-width: var(--lt-text-max-width, 100%)");
    expect(overlayHtml).toContain("width: calc(100% - var(--lt-h-margin, 120px));");
    expect(overlayHtml).toContain("#lt-bar.lt-edge-bottom #lt-verse-text,");
    expect(overlayHtml).toContain("max-width: none;");
  });

  it("orders scripture reference above or below the verse without DOM reshuffling", () => {
    expect(overlayHtml).toContain("#reference.top");
    expect(overlayHtml).toContain("#lt-bar #ref-text.top");
    expect(overlayHtml).toContain("#lt-bar #ref-text:empty");
    expect(overlayHtml).toContain("order: 0");
    expect(overlayHtml).toContain("order: 2");
  });

  it("shows reference background controls for lower-third Bible output", () => {
    const referenceSectionStart = backgroundPickerSource.indexOf("function ReferenceSection");
    const referenceSectionEnd = backgroundPickerSource.indexOf("/* ── Reference Layout Section ── */", referenceSectionStart);
    const referenceSectionSource = backgroundPickerSource.slice(referenceSectionStart, referenceSectionEnd);

    expect(referenceSectionSource).toContain("<ReferenceBackgroundSection");
    expect(backgroundPickerSource).toContain("referenceBackgroundColor");
    expect(referenceSectionSource).not.toContain('overlayMode !== "lower-third"');
    expect(overlayHtml).toContain("--ref-bg-color");
    expect(overlayHtml).toContain("if (s.referenceBackgroundEnabled !== true)");
  });

  it("keeps background picker color/image/pattern/video fields wired into the active overlay", () => {
    expect(overlayHtml).toContain("theme.backgroundVideo");
    expect(overlayHtml).toContain("theme.backgroundPattern");
    expect(overlayHtml).toContain("theme.backgroundImage");
    expect(overlayHtml).toContain("theme.backgroundColor");
    expect(overlayHtml).toContain("theme.backgroundColorEnd");
    expect(overlayHtml).toContain("theme.bgGradientAngle");
    expect(overlayHtml).toContain("theme.backgroundOpacity");
  });

  it("keeps mce-bible-overlay background behavior aligned with bible-overlay-bg", () => {
    [
      "diagonal-lines",
      "horizontal-lines",
      "vertical-lines",
      "chevrons",
      "cross-hatch",
      "subtle-noise",
      "star-field",
    ].forEach((patternName) => {
      expect(backgroundOverlayHtml).toContain(patternName);
      expect(overlayHtml).toContain(patternName);
    });

    expect(overlayHtml).toContain("function applyFullscreenBackground");
    expect(overlayHtml).toContain("function readInjectedCssVar");
    expect(overlayHtml).toContain("function resolveBackgroundImageCss");
    expect(overlayHtml).toContain("function resolveOverlayMediaUrl");
    expect(overlayHtml).toContain("const bgImageCss = resolveBackgroundImageCss(bgUrl)");
    expect(overlayHtml).toContain("const bgVideoUrl = resolveOverlayMediaUrl(theme.backgroundVideo)");
    expect(overlayHtml).toContain("const patternCss = resolvePatternCss(theme.backgroundPattern)");
    expect(overlayHtml).toContain("const bgImageCss = resolveBackgroundImageCss(s.backgroundImage)");
    expect(overlayHtml).toContain("const backgroundType = String(theme.backgroundType || '').trim().toLowerCase()");
    expect(overlayHtml).toContain("const shouldUseImage = Boolean(resolvedRawBgImage)");
    expect(overlayHtml).toContain("const shouldUseGradient = hasGradient");
    expect(overlayHtml).toContain("const rawBgImage = String(theme.backgroundImage || '').trim()");
    expect(overlayHtml).toContain("value === '__FROM_CSS__'");
    expect(overlayHtml).toContain("url(\"${value.replace(/\"/g, '\\\\\"')}\")");

    expect(backgroundOverlayHtml).toContain("function readInjectedCssVar");
    expect(backgroundOverlayHtml).toContain("value === '__FROM_CSS__'");
    expect(backgroundOverlayHtml).toContain("backgroundVideoEl.load()");
    expect(backgroundOverlayHtml).toContain("const patternCss = resolvePatternCss(theme.backgroundPattern)");

    const videoIndex = overlayHtml.indexOf("const bgVideoUrl = String(theme.backgroundVideo || '').trim()");
    const patternIndex = overlayHtml.indexOf("const patternCss = resolvePatternCss(theme.backgroundPattern)");
    const gradientIndex = overlayHtml.indexOf("const shouldUseGradient = hasGradient");
    const imageIndex = overlayHtml.indexOf("const rawBgImage = String(theme.backgroundImage || '').trim()");
    expect(videoIndex).toBeLessThan(patternIndex);
    expect(patternIndex).toBeLessThan(imageIndex);
    expect(imageIndex).toBeLessThan(gradientIndex);
  });

  it("fades Bible content without fading the background layer", () => {
    expect(overlayHtml).toContain("@keyframes mce-preview-text-exit");
    expect(overlayHtml).toContain("@keyframes mce-preview-text-fade-in");
    expect(overlayHtml).toContain(".mce-preview-text-enter--fade");
    expect(overlayHtml).toContain("animation: mce-preview-text-fade-in var(--anim-duration, 152ms) cubic-bezier(0.16, 1, 0.3, 1) both");
    expect(overlayHtml).toContain("animation: mce-preview-text-exit var(--anim-duration, 152ms) cubic-bezier(0.4, 0, 1, 1) both");
    expect(overlayHtml).toContain("function getVerseAnimationTargets");
    expect(overlayHtml).toContain("const targets = targetMode === 'lower-third'");
    expect(overlayHtml).toContain("compareLayout && compareLayout.classList.contains('is-visible')");
    expect(overlayHtml).not.toContain("mode-layer.mce-preview-slide-fade");
  });

  it("does not re-apply the background when both Bible modes render a new verse", () => {
    expect(overlayHtml).toContain("const lastAppliedThemeKeyByMode = {");
    expect(overlayHtml).toContain("const themeChanged = themeKey !== lastAppliedThemeKeyByMode[targetMode]");
    expect(overlayHtml).toContain("lastAppliedThemeKeyByMode[targetMode] = themeKey");
  });

  it("updates OBS CSS variables without replacing the live stylesheet", () => {
    expect(overlayHtml).toContain("const propertyNames = [");
    expect(overlayHtml).toContain("rootRule.style.setProperty(name, value)");
    expect(overlayHtml).not.toContain("styleEl.textContent = cssText");
  });

  it("lets an explicit newer URL packet replace a cached background", () => {
    expect(overlayHtml).toContain("URL packets are explicit updates.");
    expect(worshipOverlayHtml).toContain("URL packets are explicit updates.");
    expect(overlayHtml).not.toContain("function readFromUrlHash() { if (hasReceivedLiveOverlayUpdate) return;");
    expect(worshipOverlayHtml).not.toContain("function readFromUrlHash() { if (hasReceivedLiveOverlayUpdate) return;");
  });

  it("keeps notes lower-third pattern background behavior aligned with worship", () => {
    expect(noteOverlayHtml).toContain("function applyThemeLowerThird");
    expect(noteOverlayHtml).toContain("const bgPattern = String(s.backgroundPattern || '').trim()");
    expect(noteOverlayHtml).toContain("const pc = resolvePatternCss(bgPattern)");
    expect(noteOverlayHtml).toContain("ltBarBg.style.background = pc || 'transparent'");
  });

  it("sends the active theme with Bible full/lower-third staged payloads", () => {
    expect(dockBibleTabSource).toContain('theme: liveOverlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id');
    expect(dockBibleTabSource).toContain("liveOverlayMode === \"fullscreen\"\n              ? liveFullscreenThemeSettings\n              : liveLowerThirdThemeSettings");
    expect(dockBibleTabSource).toContain("fullscreenLiveOverrides as Record<string, unknown> | null");
    expect(dockBibleTabSource).toContain("saveDockBibleOverlayMode(nextMode)");
  });

  it("keeps theme/background draft changes local until the theme settings save commit", () => {
    const handleThemeSelectStart = dockThemeSettingsModalSource.indexOf("const handleThemeSelect");
    const handleSaveStart = dockThemeSettingsModalSource.indexOf("const handleSave", handleThemeSelectStart);
    const draftSelectionBlock = dockThemeSettingsModalSource.slice(handleThemeSelectStart, handleSaveStart);

    expect(handleThemeSelectStart).toBeGreaterThan(-1);
    expect(handleSaveStart).toBeGreaterThan(handleThemeSelectStart);
    expect(draftSelectionBlock).toContain("pendingBackgroundPresetRef.current = \"theme\"");
    expect(draftSelectionBlock).toContain("setDraftSettings(nextSettings)");
    expect(draftSelectionBlock).not.toContain("onSelect(theme)");
    expect(draftSelectionBlock).not.toContain("onBackgroundPresetChange?.(\"theme\")");

    const backgroundPickerPropsStart = dockThemeSettingsModalSource.indexOf("<BackgroundPickerCard");
    const sectionDividerStart = dockThemeSettingsModalSource.indexOf("{/* Spacer for sticky footer */}", backgroundPickerPropsStart);
    const backgroundPickerProps = dockThemeSettingsModalSource.slice(backgroundPickerPropsStart, sectionDividerStart);

    expect(backgroundPickerPropsStart).toBeGreaterThan(-1);
    expect(sectionDividerStart).toBeGreaterThan(backgroundPickerPropsStart);
    expect(backgroundPickerProps).toContain("pendingBackgroundPresetRef.current = preset");
    expect(backgroundPickerProps).not.toContain("onBackgroundPresetChange?.(preset)");

    const saveBlock = dockThemeSettingsModalSource.slice(handleSaveStart, dockThemeSettingsModalSource.indexOf("const handleReset", handleSaveStart));
    expect(saveBlock).toContain("onSelect(nextTheme)");
    expect(saveBlock).toContain("onBackgroundPresetChange?.(nextPreset)");
    expect(saveBlock).toContain("onQuickSettingsSave(nextSettings, {");
  });

  it("hydrates saved Bible dock background preferences before first render and persists saves immediately", () => {
    expect(dockBibleTabSource).toContain("initialPrefsRef.current = loadDockBiblePreferences()");
    expect(dockBibleTabSource).toContain("useState<DockBackgroundPreset>(");
    expect(dockBibleTabSource).toContain("initialPrefs.backgroundPreset ?? \"theme\"");
    expect(dockBibleTabSource).toContain("useState<DockFullscreenQuickThemeSettings | null>(initialFullscreenQuickThemeSettings)");
    expect(dockBibleTabSource).toContain("persistDockBiblePreferencesNow({");
    expect(dockBibleTabSource).toContain("fullscreenQuickThemeSettings: nextSavedSettings");
  });

  it("uses linked lower-third size presets with fitting always enabled", () => {
    expect(dockBibleTabSource).not.toContain('Fit text to frame');
    expect(dockBibleTabSource).not.toContain('Shrinks the verse and reference when they would overflow.');
    expect(dockBibleTabSource).toContain('const isFitTextMode = true;');
    expect(dockBibleTabSource).toContain('LOWER_THIRD_QUICK_SIZE_OPTIONS');
    expect(dockBibleTabSource).toContain('lowerThirdCardPadding: `${cardPadding}px ${horizontalPadding}px`');
    expect(dockBibleTabSource).toContain('lowerThirdBarMaxHeight: option.cardMaxHeight ?? preset.maxHeight');
    expect(dockBibleTabSource).not.toContain('areManualFontSizesDisabled');
    expect(dockBibleTabSource).not.toContain('QuickFontSizeInput');
  });

  it("pairs dual-variant Bible theme selection so later lower-third uses the same theme", () => {
    const fullscreenSelectStart = dockBibleTabSource.indexOf("const handleSelectFullscreenTheme");
    const lowerThirdSelectStart = dockBibleTabSource.indexOf("const handleSelectLowerThirdTheme");
    const activePickerStart = dockBibleTabSource.indexOf("const activeThemePickerProps");
    const fullscreenSelectBlock = dockBibleTabSource.slice(fullscreenSelectStart, lowerThirdSelectStart);
    const lowerThirdSelectBlock = dockBibleTabSource.slice(lowerThirdSelectStart, activePickerStart);

    expect(fullscreenSelectStart).toBeGreaterThan(-1);
    expect(lowerThirdSelectStart).toBeGreaterThan(fullscreenSelectStart);
    expect(activePickerStart).toBeGreaterThan(lowerThirdSelectStart);
    expect(fullscreenSelectBlock).toContain("themeSupportsBibleOverlayMode(theme, \"lower-third\")");
    expect(fullscreenSelectBlock).toContain("setSelectedLowerThirdTheme(theme)");
    expect(fullscreenSelectBlock).toContain("setSavedLowerThirdQuickThemeSettings(nextLowerThirdQuickSettings)");
    expect(fullscreenSelectBlock).toContain("handleOverlayModeChange(\"fullscreen\")");
    expect(lowerThirdSelectBlock).toContain("themeSupportsBibleOverlayMode(theme, \"fullscreen\")");
    expect(lowerThirdSelectBlock).toContain("setSelectedBibleTheme(theme)");
    expect(lowerThirdSelectBlock).toContain("setSavedFullscreenQuickThemeSettings(nextFullscreenQuickSettings)");
    expect(dockBibleTabSource).toContain("function extractLowerThirdQuickThemeSettings");
    expect(dockBibleTabSource).toContain("return extractThemeQuickSettingsForOverlayMode(theme, effectiveOverlayMode)");
  });

  it("keeps custom Bible themes visible in the dock background theme picker", () => {
    expect(themeCreatorSource).toContain("await saveCustomTheme(themeToSave)");
    expect(themeCreatorSource).toContain("await addBibleFavorite(themeToSave.id)");
    expect(productionThemeSettingsSource).toContain("<ThemeCreatorModal");
    expect(productionThemeSettingsSource).toContain("onSaved={(theme) => void handleThemeSaved(theme)}");
    expect(productionSettingsSource).toContain("customThemes = await getCustomThemes()");
    expect(productionSettingsSource).toContain("...customThemes.filter((theme) => !builtinIds.has(theme.id))");
    expect(bibleDbSource).toContain("syncCustomThemesToDock()");
    expect(bibleDbSource).toContain("syncFavoriteBibleThemesToDock()");
    expect(bibleDbSource).toContain('name: "dock-bible-themes"');
    expect(dockThemeDataSource).toContain("const customThemes = await loadDockCustomBibleThemes()");
    expect(dockThemeDataSource).toContain("const localThemes = [...uniqueCustom, ...favoritedBuiltins, ...otherBuiltins]");
    expect(backgroundPickerSource).toContain("const available = await loadDockThemesForArea(area, categories, { fresh })");
    expect(backgroundPickerSource).toContain("themeSupportsBibleOverlayMode(theme, overlayMode)");
    expect(backgroundPickerSource).toContain("window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, refresh)");
    expect(dockBibleTabSource).toContain('allowedCategories={["bible", "general"]}');
    expect(dockWorshipTabSource).toContain('allowedCategories={["worship", "general"]}');
  });

  it("provides card position (left, center, right) and card width default in theme layout controls", () => {
    expect(backgroundPickerSource).toContain("t('bgPicker.cardPosition', 'Card position')");
    expect(backgroundPickerSource).toContain("t('bgPicker.positionCenter', 'Center')");
    expect(backgroundPickerSource).toContain('currentWidth = quickSettings.lowerThirdWidthPreset ?? "full"');
    expect(backgroundPickerSource).toContain('currentPos = quickSettings.lowerThirdPosition ?? "center"');
    expect(backgroundPickerSource).toContain('if (prev.lowerThirdWidthPreset === "full" && (value === "left" || value === "right"))');
    expect(backgroundPickerSource).toContain('nextPatch.lowerThirdWidthPreset = "xl"');
  });
});

describe("Quick Settings modal redesign", () => {
  it("removes text direction normal/inverted from Layout tab", () => {
    const layoutSectionStart = backgroundPickerSource.indexOf('{/* Layout Tab */}');
    const compareTabStart = backgroundPickerSource.indexOf('{/* Compare Tab */}', layoutSectionStart);
    const layoutSectionSource = backgroundPickerSource.slice(layoutSectionStart, compareTabStart);

    expect(layoutSectionSource).not.toContain("bgPicker.textDirection");
    expect(layoutSectionSource).not.toContain("lowerThirdTextDirection");
    expect(layoutSectionSource).not.toContain("textDirectionNormal");
    expect(layoutSectionSource).not.toContain("textDirectionInverted");
  });

  it("defaults theme sync scope to all and shows the redesigned Apply changes to custom dropdown", () => {
    expect(dockThemeSettingsModalSource).toContain('useState<"current" | "all" | "custom">("all")');
    expect(dockThemeSettingsModalSource).toContain('setSyncScopeMode("all")');

    const syncPanelStart = dockThemeSettingsModalSource.indexOf('className="dtb-studio__sync-panel"');
    const syncPanelEnd = dockThemeSettingsModalSource.indexOf('className="dtb-studio__footer-actions"', syncPanelStart);
    const syncPanelSource = dockThemeSettingsModalSource.slice(syncPanelStart, syncPanelEnd);

    // Custom dropdown trigger & menu
    expect(syncPanelSource).toContain('className="dtb-studio__sync-dropdown-container"');
    expect(syncPanelSource).toContain('dtb-studio__sync-dropdown-trigger');
    expect(syncPanelSource).toContain('dtb-studio__sync-dropdown-menu');

    // Dropdown order: All Tabs & Scenes, Current Only, Custom...
    const allIndex = syncPanelSource.indexOf('t("dock.allTabsScenes", "All Tabs & Scenes")');
    const currentIndex = syncPanelSource.indexOf('t("dock.currentOnly", "Current Only")');
    const customIndex = syncPanelSource.indexOf('t("dock.customScope", "Custom…")');

    expect(allIndex).toBeGreaterThan(-1);
    expect(currentIndex).toBeGreaterThan(allIndex);
    expect(customIndex).toBeGreaterThan(currentIndex);

    // Supporting hint for All
    expect(syncPanelSource).toContain('t("dock.savingAllHint", "Applies to every supported tab and scene.")');

    // Dynamic current hint
    expect(syncPanelSource).toContain('t("dock.savingCurrentHint"');
    expect(syncPanelSource).toContain('Applies only to');

    // Custom section has Tabs (Bible, Worship, Notes) and Scenes (Full Screen, Lower-Third)
    expect(syncPanelSource).toContain('t("dock.tabs", "Tabs")');
    expect(syncPanelSource).toContain('t("dock.scenes", "Scenes")');
    expect(syncPanelSource).toContain('t("common.clearAll", "Clear all")');
    expect(syncPanelSource).toContain('t("common.selectAll", "Select all")');
    // Media is NOT part of theme sync
    expect(syncPanelSource).not.toContain('t("dock.media"');
  });

  it("renders top tabs horizontally and styles footer buttons with correct proportions", () => {
    expect(dockCssSource).toContain('.dtb-studio__modal--picker .dtb-bg-picker__tabs');
    expect(dockCssSource).toContain('.dtb-studio__modal--picker .dtb-bg-picker__tab--active');
    expect(dockCssSource).toContain('.dtb-studio__modal--picker .dtb-bg-picker__tab span');
    expect(dockCssSource).toContain('.dtb-studio__modal--picker .dtb-studio__footer-btn--reset');
    expect(dockCssSource).toContain('.dtb-studio__modal--picker .dtb-studio__footer-btn--save');
    expect(dockCssSource).toContain('flex: 0 0 32%');
    expect(dockCssSource).toContain('flex: 1 1 auto');
    expect(dockCssSource).toContain('.dtb-studio__sync-dropdown-container');
    expect(dockCssSource).toContain('height: auto !important');
    expect(dockCssSource).toContain('max-width: 390px');
  });
});

