import { describe, expect, it } from "vitest";
import dockBibleTabSource from "./DockBibleTab.tsx?raw";
import dockObsClientSource from "../dockObsClient.ts?raw";
import bibleDockUiSource from "../components/BibleDockUI.tsx?raw";
import bottomToolbarSource from "../components/DockBottomToolbar.tsx?raw";
import backgroundPickerSource from "../components/BackgroundPickerCard.tsx?raw";

describe("DockBibleTab reference display", () => {
  it("stores reference display controls in the dock and sends one label to every Bible overlay path", () => {
    expect(dockBibleTabSource).toContain('type BibleReferenceFormat = "full" | "short" | "hidden"');
    expect(dockBibleTabSource).toContain("referenceFormat?: BibleReferenceFormat");
    expect(dockBibleTabSource).toContain("referenceVersionVisible?: boolean");
    expect(dockBibleTabSource).toContain("buildBibleReferenceDisplayLabel");
    expect(dockBibleTabSource).toContain("bible.referenceDisplay");

    expect(dockBibleTabSource).toContain("displayReferenceLabel: referenceLabel");
    expect(dockBibleTabSource).toContain("referenceText: stageData.displayReferenceLabel as string | undefined");
    expect(dockObsClientSource).toContain("formatBibleReferenceDisplayText");
    expect(dockObsClientSource).toContain("data.displayReferenceLabel");
    expect(dockObsClientSource).toContain("displayReferenceLabel: refText");
  });

  it("keeps the bottom trigger and the theme settings card on the same preferences", () => {
    expect(dockBibleTabSource).toContain("dock-bible-reference-popover");
    expect(dockBibleTabSource).toContain("dock-bible-reference-trigger");
    expect(dockBibleTabSource).toContain("referenceFormat={referenceFormat}");
    expect(dockBibleTabSource).toContain("referenceVersionVisible={referenceVersionVisible}");
    expect(backgroundPickerSource).toContain("ReferenceDisplaySection");
    expect(backgroundPickerSource).toContain("bible.referenceFormatFull");
    expect(backgroundPickerSource).toContain("bible.showBibleVersion");
  });

  it("keeps operational quick actions separate from reference appearance settings", () => {
    const quickMenuStart = dockBibleTabSource.indexOf("function BibleOutputControlsMenu");
    const quickMenuEnd = dockBibleTabSource.indexOf("function sanitizeCssPadding", quickMenuStart);
    const quickMenuSource = dockBibleTabSource.slice(quickMenuStart, quickMenuEnd);

    expect(dockBibleTabSource).toContain("displayedBrowserFontSettings");
    expect(dockBibleTabSource).toContain("browserQuickUpdateImmediately");
    expect(dockBibleTabSource).toContain("saveBrowserQuickSettings");
    expect(dockBibleTabSource).toContain("handleBrowserVerseLineCountChange");
    expect(dockBibleTabSource).toContain("Bible output controls");
    expect(quickMenuSource).toContain("Lines per verse");
    expect(quickMenuSource).not.toContain("bible.bibleVerse");
    expect(quickMenuSource).not.toContain("bible.reference");
    expect(quickMenuSource).not.toContain("referenceBackgroundEnabled");
    expect(quickMenuSource).not.toContain("keywordMatchDirectPush");
    expect(quickMenuSource).not.toContain("QuickFontSizeInput");
    expect(dockBibleTabSource).toContain("LOWER_THIRD_QUICK_SIZE_OPTIONS");
    expect(dockBibleTabSource).toContain("handleLowerThirdSizePresetChange");
    expect(dockBibleTabSource).toContain("lineHeight: preset.lineHeight");
    expect(dockBibleTabSource).toContain("refSpacing: option.refSpacing ?? preset.refSpacing");
    expect(dockBibleTabSource).toContain("const isFitTextMode = true;");
    expect(dockBibleTabSource).not.toContain("onClick={() => onApplyPatch({ autoFontScale: !settings.autoFontScale })}");
    expect(dockBibleTabSource).toContain("{isFitTextMode && (");
    expect(dockBibleTabSource).toContain("hasPendingBrowserQuickChanges");
    expect(dockBibleTabSource).toContain('<Icon name="compare_arrows" size={20} />');
    expect(dockBibleTabSource).toContain("compareVerseFontSizeLeft: nextVerseSize");
    expect(dockBibleTabSource).toContain("compareVerseFontSizeRight: nextVerseSize");
    expect(dockBibleTabSource).toContain("compareReferenceFontSizeLeft: nextReferenceSize");
    expect(dockBibleTabSource).toContain("compareReferenceFontSizeRight: nextReferenceSize");
  });

  it("carries the selected quick settings into every verse navigation path", () => {
    expect(dockBibleTabSource).toContain("const liveFullscreenThemeSettings = liveFullscreenThemeSettingsRef.current");
    expect(dockBibleTabSource).toContain("const liveLowerThirdThemeSettings = liveLowerThirdThemeSettingsRef.current");
    expect(dockBibleTabSource).toContain("bibleThemeSettings: liveThemeSettings as unknown as Record<string, unknown>");
    expect(dockBibleTabSource).toContain("liveFullscreenThemeSettingsRef.current = applyFullscreenQuickThemeSettings");
    expect(dockBibleTabSource).toContain("liveLowerThirdThemeSettingsRef.current = applyLowerThirdQuickThemeSettings");
  });

  it("uses the Bible toolbar arrows for previous and next chapter navigation", () => {
    expect(dockBibleTabSource).toContain("const handleChapterJump = useCallback");
    expect(dockBibleTabSource).toContain("selectedChapterRef.current = nextChapter");
    expect(dockBibleTabSource).toContain("persistDockBiblePreferencesNow({ selectedChapter: nextChapter })");
    expect(dockBibleTabSource).toContain("handleChapterJump(-1)");
    expect(dockBibleTabSource).toContain("handleChapterJump(1)");
    expect(dockBibleTabSource).toContain('if (event.key === "ArrowRight")');
    expect(dockBibleTabSource).toContain('} else if (event.key === "ArrowLeft")');
    expect(dockBibleTabSource).toContain('} else if (event.key === "ArrowDown")');
    expect(dockBibleTabSource).toContain('} else if (event.key === "ArrowUp")');
    expect(dockBibleTabSource).toContain('title={t("bible.previousChapter", "Previous chapter")}');
    expect(dockBibleTabSource).toContain('title={t("bible.nextChapter", "Next chapter")}');
    expect(dockBibleTabSource).toContain("dock-bible-reader__chapter-nav-btn");
    expect(bibleDockUiSource).not.toContain("BibleControls");
    expect(bottomToolbarSource).toContain("dock-btm-toolbar__center--collapsed");
  });

  it("keeps Bible keyboard navigation functional without a visible shortcut cue", () => {
    expect(dockBibleTabSource).toContain("const BIBLE_BOOK_ORDER = [...OT_BOOKS, ...NT_BOOKS]");
    expect(dockBibleTabSource).toContain("const handleBookJump = useCallback");
    expect(dockBibleTabSource).toContain("event.shiftKey && event.key === \"ArrowRight\"");
    expect(dockBibleTabSource).toContain("event.shiftKey && event.key === \"ArrowLeft\"");
    expect(dockBibleTabSource).toContain("handleBookJump(1)");
    expect(dockBibleTabSource).toContain("handleBookJump(-1)");
    expect(bibleDockUiSource).not.toContain("dock-bible-controls__keyboard-cue");
  });

  it("persists the draggable Quick handle position", () => {
    expect(dockBibleTabSource).toContain("quickActionsTop?: number");
    expect(dockBibleTabSource).toContain("quickActionsLeft?: number | null");
    expect(dockBibleTabSource).toContain("browserQuickUpdateImmediately?: boolean");
    expect(dockBibleTabSource).toContain("readDockPreference<DockBibleUiPreferences>(DOCK_BIBLE_UI_PREFS_KEY)");
    expect(dockBibleTabSource).toContain("void saveDockPreference(DOCK_BIBLE_UI_PREFS_KEY, next)");
    expect(dockBibleTabSource).toContain("clampQuickActionsTop");
    expect(dockBibleTabSource).toContain("clampQuickActionsLeft");
    expect(dockBibleTabSource).toContain("snapQuickActionsLeft");
    expect(dockBibleTabSource).toContain("getDefaultQuickActionsTop");
    expect(dockBibleTabSource).toContain("quickActionsNeedsInitialCenterRef");
    expect(dockBibleTabSource).toContain("quickActionsContainerRef");
    expect(dockBibleTabSource).toContain("useLayoutEffect");
    expect(dockBibleTabSource).toContain("handleQuickActionsPointerDown");
    expect(dockBibleTabSource).toContain("persistQuickActionsPosition(nextTop, nextLeft)");
    expect(dockBibleTabSource).toContain("saveDockBibleUiPreferencePatch({ browserQuickUpdateImmediately: checked })");
    expect(dockBibleTabSource).toContain("quickActionsLeft !== null ? { left: `${quickActionsLeft}px`, right: \"auto\" } : {}");
  });

  it("persists separate Full and LT line counts across later preference saves", () => {
    expect(dockBibleTabSource).toContain("fullscreenVerseLineCount,");
    expect(dockBibleTabSource).toContain("lowerThirdVerseLineCount,");
    expect(dockBibleTabSource).toContain("fullscreenVerseLineCount: nextLineCount");
    expect(dockBibleTabSource).toContain("lowerThirdVerseLineCount: nextLineCount");
  });

  it("keeps quick controls focused on readable text and comparison settings", () => {
    const quickMenuStart = dockBibleTabSource.indexOf("function BibleOutputControlsMenu");
    const quickMenuEnd = dockBibleTabSource.indexOf("function sanitizeCssPadding", quickMenuStart);
    const quickMenuSource = dockBibleTabSource.slice(quickMenuStart, quickMenuEnd);

    expect(quickMenuSource).not.toContain("Output Mode");
    expect(quickMenuSource).not.toContain("dock-bible-reader__mode-toggle-group");
    expect(quickMenuSource).not.toContain("dock-bible-reader__bg-presets");
    expect(quickMenuSource).not.toContain("onBackgroundSelect(");

    // Fine font size stepper
    expect(quickMenuSource).toContain("dock-bible-reader__font-size-controls");
    expect(quickMenuSource).toContain("onFontSizeStep(-2)");
    expect(quickMenuSource).toContain("onFontSizeStep(2)");

    // Secondary translation in compare mode
    expect(quickMenuSource).toContain("Compare with");
    expect(quickMenuSource).toContain("onTranslationBChange(event.target.value)");
  });
});
