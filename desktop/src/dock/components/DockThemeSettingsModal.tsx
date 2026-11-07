import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { flushSync } from "react-dom";
import type { BibleTheme } from "../../bible/types";
import Icon from "../DockIcon";
import BackgroundPickerCard, { type BibleReferenceFormat } from "./BackgroundPickerCard";
import type { DockBackgroundPreset } from "../dockConsoleTheme";
import type { DockFullscreenQuickThemeSettings } from "./DockFullscreenThemeQuickSettings";
import {
  syncThemeAcrossDock,
  type DockThemeScope,
  type DockOverlayMode,
} from "../dockThemeSync";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";

/** Where the "Apply changes to" choice is kept, so the window reopens on the last one saved. */
const SYNC_SCOPE_SETTING_KEY = "dtb-theme-sync-scope";

type SyncScopeMode = "current" | "all" | "custom";
interface SavedSyncScope {
  mode: SyncScopeMode;
  tabs: Record<DockThemeScope, boolean>;
  modes: Record<DockOverlayMode, boolean>;
}

/** The last saved "Apply changes to" choice; All Tabs & Scenes until something else is saved. */
export function readSavedSyncScope(): SavedSyncScope {
  const fallback: SavedSyncScope = {
    mode: "all",
    tabs: { bible: true, worship: true, notes: true },
    modes: { fullscreen: true, "lower-third": true },
  };
  const raw = readNativeDockSetting<Partial<SavedSyncScope>>(SYNC_SCOPE_SETTING_KEY);
  if (!raw || typeof raw !== "object") return fallback;
  const mode = raw.mode === "current" || raw.mode === "custom" || raw.mode === "all" ? raw.mode : "all";
  const bool = (value: unknown, otherwise: boolean) => (typeof value === "boolean" ? value : otherwise);
  return {
    mode,
    tabs: {
      bible: bool(raw.tabs?.bible, true),
      worship: bool(raw.tabs?.worship, true),
      notes: bool(raw.tabs?.notes, true),
    },
    modes: {
      fullscreen: bool(raw.modes?.fullscreen, true),
      "lower-third": bool(raw.modes?.["lower-third"], true),
    },
  };
}

export interface DockThemeSettingsSaveContext {
  backgroundPreset?: DockBackgroundPreset | null;
  selectedTheme?: BibleTheme | null;
  referenceFormat?: BibleReferenceFormat;
  referenceVersionVisible?: boolean;
  sceneProfileId?: string;
  syncTargetTabs?: DockThemeScope[];
  syncTargetModes?: DockOverlayMode[];
}

export interface DockThemeSceneProfile {
  id: string;
  label: string;
}

interface Props {
  selectedThemeId: string | null;
  onSelect: (theme: BibleTheme) => void;
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
  sampleText?: string;
  sampleReference?: string;
  quickSettings: DockFullscreenQuickThemeSettings;
  defaultQuickSettings?: DockFullscreenQuickThemeSettings;
  onQuickSettingsSave: (
    settings: DockFullscreenQuickThemeSettings,
    context?: DockThemeSettingsSaveContext,
  ) => void | Promise<void>;
  onSaveFeedback?: (message: string) => void;
  resolveThemeQuickSettings?: (theme: BibleTheme) => DockFullscreenQuickThemeSettings;
  title: string;
  subtitle: string;
  /** When provided, modal is externally controlled */
  isOpen?: boolean;
  onClose?: () => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  /** Overlay mode — shows lower-third positioning controls in LT mode */
  overlayMode?: "fullscreen" | "lower-third";
  /** Show the Reference section in BackgroundPickerCard (only for Bible tab) */
  showReferences?: boolean;
  /** Bible-only reference display preferences surfaced in the Reference sub-tab */
  referenceFormat?: BibleReferenceFormat;
  referenceVersionVisible?: boolean;
  referenceTranslation?: string;
  onReferenceFormatChange?: (format: BibleReferenceFormat) => void;
  onReferenceVersionVisibleChange?: (visible: boolean) => void;
  onReferenceSettingsSave?: (format: BibleReferenceFormat, versionVisible: boolean) => void;
  /** Active display mode — controls whether Compare Layout section is visible */
  displayMode?: "single" | "compare";
  initialTab?: "text" | "layout" | "background" | "compare";
  /** Keeps BackgroundPickerCard local styles separate per dock section */
  storageScope?: "bible" | "worship" | "notes" | "global";
  /** When true and displayMode is "compare", BackgroundPickerCard shows only the Compare tab */
  hideBackgroundOnCompare?: boolean;
  /** Optional scene-scoped Quick Edit profiles shown above the text/background editor. */
  sceneProfiles?: DockThemeSceneProfile[];
  activeSceneProfileId?: string;
  onSceneProfileChange?: (profileId: string) => void;
}

type StudioView = "closed" | "settings";

function getThemeSettingsForMode(
  theme: BibleTheme,
  overlayMode: NonNullable<Props["overlayMode"]>,
) {
  const variant = overlayMode === "lower-third"
    ? theme.variants?.lowerThird
    : theme.variants?.fullscreen;
  return variant?.settings ?? theme.settings;
}

function resolveFallbackThemeQuickSettings(
  theme: BibleTheme,
  overlayMode: NonNullable<Props["overlayMode"]>,
  current: DockFullscreenQuickThemeSettings,
): DockFullscreenQuickThemeSettings {
  const settings = getThemeSettingsForMode(theme, overlayMode);
  return {
    ...current,
    ...settings,
    backgroundType: "theme",
    backgroundImage: settings.backgroundImage ?? "",
    backgroundImageFilePath: settings.backgroundImageFilePath ?? "",
    backgroundPattern: settings.backgroundPattern ?? "",
    backgroundVideo: settings.backgroundVideo ?? "",
    backgroundVideoFilePath: settings.backgroundVideoFilePath ?? "",
    backgroundOpacity: settings.backgroundOpacity ?? current.backgroundOpacity,
    backgroundColor: settings.backgroundColor || current.backgroundColor,
    backgroundColorEnd: settings.backgroundColorEnd ?? current.backgroundColorEnd,
    bgGradientAngle: settings.bgGradientAngle ?? current.bgGradientAngle,
    boxBackground: settings.boxBackground !== undefined ? settings.boxBackground : current.boxBackground,
    boxBackgroundImage: settings.boxBackgroundImage !== undefined ? settings.boxBackgroundImage : current.boxBackgroundImage,
    boxOpacity: settings.boxOpacity !== undefined ? settings.boxOpacity : current.boxOpacity,
    borderRadius: settings.borderRadius !== undefined ? settings.borderRadius : (settings.lowerThirdCardRadius ?? current.borderRadius),
    lowerThirdCardRadius: settings.lowerThirdCardRadius !== undefined ? settings.lowerThirdCardRadius : (settings.borderRadius ?? current.lowerThirdCardRadius),
    padding: settings.padding !== undefined ? settings.padding : current.padding,
    safeArea: settings.safeArea !== undefined ? settings.safeArea : current.safeArea,
    referenceBackgroundEnabled: settings.referenceBackgroundEnabled !== undefined ? settings.referenceBackgroundEnabled : current.referenceBackgroundEnabled,
    referenceBackgroundColor: settings.referenceBackgroundColor || current.referenceBackgroundColor,
    referenceBackgroundStyle: settings.referenceBackgroundStyle || current.referenceBackgroundStyle,
    fontColor: settings.fontColor || current.fontColor,
    refFontColor: settings.refFontColor || current.refFontColor,
    refPosition: settings.refPosition ?? current.refPosition,
    refTextAlign: settings.refTextAlign ?? current.refTextAlign,
    textTransform: settings.textTransform ?? current.textTransform,
  };
}

/* ── Main Component ── */
export default function DockThemeSettingsModal({
  selectedThemeId,
  onSelect,
  allowedCategories,
  sampleText = "Faith",
  sampleReference = "John 3:16",
  quickSettings,
  defaultQuickSettings,
  onQuickSettingsSave,
  onSaveFeedback,
  resolveThemeQuickSettings,
  title,
  subtitle,
  isOpen: externalIsOpen,
  onClose: externalOnClose,
  onBackgroundPresetChange,
  overlayMode = "fullscreen",
  showReferences = true,
  referenceFormat,
  referenceVersionVisible = false,
  referenceTranslation = "KJV",
  onReferenceFormatChange,
  onReferenceVersionVisibleChange,
  onReferenceSettingsSave,
  displayMode = "single",
  initialTab = "text",
  storageScope = "global",
  hideBackgroundOnCompare = false,
  sceneProfiles,
  activeSceneProfileId,
  onSceneProfileChange,
}: Props) {
  const { t } = useTranslation();
  const [internalView, setInternalView] = useState<StudioView>("closed");
  const view = externalIsOpen !== undefined
    ? (externalIsOpen ? (internalView === "closed" ? "settings" : internalView) : "closed")
    : internalView;
  const setView = useCallback((v: StudioView) => {
    if (externalIsOpen !== undefined && v === "closed") {
      externalOnClose?.();
      return;
    }
    setInternalView(v);
  }, [externalIsOpen, externalOnClose]);
  const [draftSettings, setDraftSettings] = useState(quickSettings);
  const [draftReferenceFormat, setDraftReferenceFormat] = useState<BibleReferenceFormat | undefined>(referenceFormat);
  const [draftReferenceVersionVisible, setDraftReferenceVersionVisible] = useState(referenceVersionVisible);
  const [draftSelectedThemeId, setDraftSelectedThemeId] = useState<string | null>(selectedThemeId);
  const draftSettingsRef = useRef(quickSettings);
  const draftReferenceFormatRef = useRef<BibleReferenceFormat | undefined>(referenceFormat);
  const draftReferenceVersionVisibleRef = useRef(referenceVersionVisible);
  const draftSelectedThemeRef = useRef<BibleTheme | null>(null);
  const pendingBackgroundPresetRef = useRef<DockBackgroundPreset | null>(null);
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(view !== "closed");
  const originalSettingsRef = useRef(quickSettings);
  const previousSceneProfileIdRef = useRef(activeSceneProfileId);

  const currentTab: DockThemeScope =
    storageScope === "bible" || storageScope === "worship" || storageScope === "notes"
      ? storageScope
      : "bible";

  const currentMode: DockOverlayMode =
    overlayMode === "lower-third" ? "lower-third" : "fullscreen";

  const [syncScopeMode, setSyncScopeMode] = useState<"current" | "all" | "custom">("all");
  const [isSyncDropdownOpen, setIsSyncDropdownOpen] = useState(false);
  const syncDropdownRef = useRef<HTMLDivElement | null>(null);

  const [syncTabs, setSyncTabs] = useState<Record<DockThemeScope, boolean>>({
    bible: true,
    worship: true,
    notes: true,
  });

  const [syncModes, setSyncModes] = useState<Record<DockOverlayMode, boolean>>({
    fullscreen: true,
    "lower-third": true,
  });

  useEffect(() => {
    if (!isSyncDropdownOpen) return undefined;
    const handleClickOutside = (e: MouseEvent) => {
      if (syncDropdownRef.current && !syncDropdownRef.current.contains(e.target as Node)) {
        setIsSyncDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSyncDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSyncDropdownOpen]);

  useEffect(() => {
    const isOpen = view !== "closed";
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (isOpen && !wasOpen) {
      originalSettingsRef.current = quickSettings;
      draftSettingsRef.current = quickSettings;
      setDraftSettings(quickSettings);
      draftReferenceFormatRef.current = referenceFormat;
      setDraftReferenceFormat(referenceFormat);
      draftReferenceVersionVisibleRef.current = referenceVersionVisible;
      setDraftReferenceVersionVisible(referenceVersionVisible);
      setDraftSelectedThemeId(selectedThemeId);
      draftSelectedThemeRef.current = null;
      pendingBackgroundPresetRef.current = null;
      // Open on the choice saved last time (All, Current only, or the same Custom tabs and scenes).
      const saved = readSavedSyncScope();
      setSyncScopeMode(saved.mode);
      setSyncTabs(saved.tabs);
      setSyncModes(saved.modes);
    }
  }, [currentMode, currentTab, referenceFormat, referenceVersionVisible, view, quickSettings, selectedThemeId]);

  useEffect(() => {
    if (previousSceneProfileIdRef.current === activeSceneProfileId) return;
    previousSceneProfileIdRef.current = activeSceneProfileId;
    if (view === "closed") return;
    originalSettingsRef.current = quickSettings;
    draftSettingsRef.current = quickSettings;
    setDraftSettings(quickSettings);
    setDraftSelectedThemeId(selectedThemeId);
    draftSelectedThemeRef.current = null;
    pendingBackgroundPresetRef.current = null;
  }, [activeSceneProfileId, quickSettings, selectedThemeId, view]);

  const updateDraft = useCallback(
    (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => {
      const next = updater(draftSettingsRef.current);
      draftSettingsRef.current = next;
      setDraftSettings(next);
    },
    [],
  );

  const updateDraftReferenceFormat = useCallback((format: BibleReferenceFormat) => {
    draftReferenceFormatRef.current = format;
    setDraftReferenceFormat(format);
  }, []);

  const updateDraftReferenceVersionVisible = useCallback((visible: boolean) => {
    draftReferenceVersionVisibleRef.current = visible;
    setDraftReferenceVersionVisible(visible);
  }, []);

  useEffect(() => {
    if (view === "closed") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("closed");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view]);

  const openSettings = useCallback(() => {
    draftSettingsRef.current = quickSettings;
    setDraftSettings(quickSettings);
    draftReferenceFormatRef.current = referenceFormat;
    setDraftReferenceFormat(referenceFormat);
    draftReferenceVersionVisibleRef.current = referenceVersionVisible;
    setDraftReferenceVersionVisible(referenceVersionVisible);
    setDraftSelectedThemeId(selectedThemeId);
    draftSelectedThemeRef.current = null;
    pendingBackgroundPresetRef.current = null;
    setView("settings");
  }, [quickSettings, referenceFormat, referenceVersionVisible, selectedThemeId]);

  const handleThemeSelect = useCallback((theme: BibleTheme) => {
    draftSelectedThemeRef.current = theme;
    setDraftSelectedThemeId(theme.id);
    pendingBackgroundPresetRef.current = "theme";
    const nextSettings = resolveThemeQuickSettings?.(theme)
      ?? resolveFallbackThemeQuickSettings(theme, overlayMode, draftSettingsRef.current);
    draftSettingsRef.current = nextSettings;
    setDraftSettings(nextSettings);
  }, [overlayMode, resolveThemeQuickSettings]);

  const handleSave = useCallback(() => {
    const nextSettings = { ...draftSettingsRef.current };
    const nextReferenceFormat = draftReferenceFormatRef.current;
    const nextReferenceVersionVisible = draftReferenceVersionVisibleRef.current;
    const nextTheme = draftSelectedThemeRef.current;
    const nextPreset = pendingBackgroundPresetRef.current;

    const effectiveTargetTabs: DockThemeScope[] = (() => {
      if (syncScopeMode === "all") return ["bible", "worship", "notes"];
      if (syncScopeMode === "custom") {
        const targetTabs = (Object.keys(syncTabs) as DockThemeScope[]).filter((k) => syncTabs[k]);
        return targetTabs.length > 0 ? targetTabs : [currentTab];
      }
      return [currentTab];
    })();

    const effectiveTargetModes: DockOverlayMode[] = (() => {
      if (syncScopeMode === "all") return ["fullscreen", "lower-third"];
      if (syncScopeMode === "custom") {
        const targetModes = (Object.keys(syncModes) as DockOverlayMode[]).filter((k) => syncModes[k]);
        return targetModes.length > 0 ? targetModes : [currentMode];
      }
      return [currentMode];
    })();

    const shouldCrossSync = effectiveTargetTabs.length > 1 || effectiveTargetModes.length > 1;
    // The next time this opens, it starts on this choice.
    void writeNativeDockSetting(SYNC_SCOPE_SETTING_KEY, { mode: syncScopeMode, tabs: syncTabs, modes: syncModes });

    setSaving(true);
    flushSync(() => setView("closed"));
    const commit = () => {
      try {
        if (nextTheme) {
          onSelect(nextTheme);
        }
        if (nextPreset) {
          onBackgroundPresetChange?.(nextPreset);
        }
        if (nextReferenceFormat && (
          nextReferenceFormat !== referenceFormat
          || nextReferenceVersionVisible !== referenceVersionVisible
        )) {
          if (onReferenceSettingsSave) {
            onReferenceSettingsSave(nextReferenceFormat, nextReferenceVersionVisible);
          } else {
            if (nextReferenceFormat !== referenceFormat) {
              onReferenceFormatChange?.(nextReferenceFormat);
            }
            if (nextReferenceVersionVisible !== referenceVersionVisible) {
              onReferenceVersionVisibleChange?.(nextReferenceVersionVisible);
            }
          }
        }
      } catch (error) {
        console.warn("[DockThemeSettingsModal] pre-save apply failed:", error);
      }

      if (shouldCrossSync) {
        void syncThemeAcrossDock({
          sourceTab: currentTab,
          sourceMode: currentMode,
          targetTabs: effectiveTargetTabs,
          targetModes: effectiveTargetModes,
          theme: nextTheme,
          themeId: nextTheme?.id ?? draftSelectedThemeId,
          quickSettings: nextSettings,
          backgroundPreset: nextPreset,
          timestamp: Date.now(),
        }).catch((err) => console.warn("[DockThemeSettingsModal] cross-sync failed:", err));
      }

      void Promise.resolve(onQuickSettingsSave(nextSettings, {
        backgroundPreset: nextPreset,
        selectedTheme: nextTheme,
        referenceFormat: nextReferenceFormat,
        referenceVersionVisible: nextReferenceFormat ? nextReferenceVersionVisible : undefined,
        sceneProfileId: activeSceneProfileId,
        syncTargetTabs: effectiveTargetTabs,
        syncTargetModes: effectiveTargetModes,
      }))
        .then(() => {
          let feedbackMsg = t("dock.feedback.bibleSettingsSaved", "Theme settings saved.");
          if (effectiveTargetTabs.length === 3 && effectiveTargetModes.length === 2) {
            feedbackMsg = t(
              "dock.feedback.syncedAll",
              "Theme settings applied to Bible, Worship & Notes across Full Scene & Lower-Third.",
            );
          } else if (effectiveTargetTabs.length > 1 && effectiveTargetModes.length > 1) {
            const tabsList = effectiveTargetTabs.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
            feedbackMsg = t(
              "dock.feedback.syncedTabsModes",
              `Theme settings applied to ${tabsList} across Full Scene & Lower-Third.`,
            );
          } else if (effectiveTargetTabs.length > 1) {
            const tabsList = effectiveTargetTabs.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
            feedbackMsg = t("dock.feedback.syncedTabs", `Theme settings applied to ${tabsList}.`);
          } else if (effectiveTargetModes.length > 1) {
            feedbackMsg = t(
              "dock.feedback.syncedModes",
              "Theme settings applied to both Full Scene & Lower-Third.",
            );
          }
          onSaveFeedback?.(feedbackMsg);
        })
        .catch((error) => console.warn("[DockThemeSettingsModal] quick settings save failed:", error))
        .finally(() => setSaving(false));
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(commit);
      return;
    }
    window.setTimeout(commit, 0);
  }, [
    activeSceneProfileId,
    currentMode,
    currentTab,
    draftSelectedThemeId,
    onBackgroundPresetChange,
    onQuickSettingsSave,
    onReferenceFormatChange,
    onReferenceSettingsSave,
    onReferenceVersionVisibleChange,
    onSaveFeedback,
    onSelect,
    referenceFormat,
    referenceVersionVisible,
    syncModes,
    syncScopeMode,
    syncTabs,
    t,
  ]);

  const handleReset = useCallback(() => {
    const nextSettings = defaultQuickSettings ?? originalSettingsRef.current;
    draftSelectedThemeRef.current = null;
    updateDraft(() => nextSettings);
  }, [updateDraft, defaultQuickSettings]);

  /* ── Render ── */
  return (
    <div className="dtb-studio">
      {externalIsOpen === undefined && (
        <button
          type="button"
          className="dtb-studio__trigger dtb-studio__trigger--labeled"
          onClick={openSettings}
          aria-haspopup="dialog"
          aria-label={t('worship.quickEdits')}
          title={t('worship.quickEdits')}
        >
          <Icon name="edit" size={13} />
          <span>{t('worship.quickEdits')}</span>
        </button>
      )}

      {view !== "closed" && (
        <div className="dtb-studio__backdrop" onClick={() => setView("closed")} role="presentation">
          <div
            className={`dtb-studio__modal${view === "settings" ? " dtb-studio__modal--picker" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="dtb-studio__header">
              <div className="dtb-studio__header-content">
                <span className="dtb-studio__header-label">{title || subtitle || t("bible.quickSettings", "Quick Settings")}</span>
                {subtitle && <span className="dtb-studio__header-subtitle">{subtitle}</span>}
              </div>
              <button
                type="button"
                className="dtb-studio__close dtb-studio__close--strong"
                onClick={() => setView("closed")}
                aria-label={t('common.close')}
                title={t('common.close')}>
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* ── Settings View ── */}
            {view === "settings" && (
              <div className="dtb-studio__settings-view dtb-studio__settings-view--picker">

                {sceneProfiles && sceneProfiles.length > 0 && (
                  <div className="dtb-studio__scene-profile-bar">
                    <div className="dtb-studio__scene-profile-copy">
                      <span className="dtb-studio__scene-profile-label">
                        {t("dock.sceneProfile", "Output profile")}
                      </span>
                      <span className="dtb-studio__scene-profile-help">
                        {t("dock.sceneProfileHelp", "Choose which scene receives these settings.")}
                      </span>
                    </div>
                    <select
                      className="dtb-studio__scene-profile-select"
                      value={activeSceneProfileId ?? sceneProfiles[0].id}
                      onChange={(event) => onSceneProfileChange?.(event.target.value)}
                      aria-label={t("dock.sceneProfile", "Output profile")}
                    >
                      {sceneProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* ═══ Background Section ═══ */}
                <BackgroundPickerCard
                  quickSettings={draftSettings}
                  onQuickSettingsChange={(updater) => updateDraft(updater)}
                  onQuickSettingsSave={(settings) => onQuickSettingsSave(settings, {
                    sceneProfileId: activeSceneProfileId,
                  })}
                  onSaveFeedback={onSaveFeedback}
                  selectedThemeId={draftSelectedThemeId}
                  onThemeSelect={handleThemeSelect}
                  allowedCategories={allowedCategories}
                  sampleText={sampleText}
                  sampleReference={sampleReference}
                  onBackgroundPresetChange={(preset) => {
                    pendingBackgroundPresetRef.current = preset;
                  }}
                  showReferences={showReferences}
                  referenceFormat={draftReferenceFormat}
                  referenceVersionVisible={draftReferenceVersionVisible}
                  referenceTranslation={referenceTranslation}
                  onReferenceFormatChange={updateDraftReferenceFormat}
                  onReferenceVersionVisibleChange={updateDraftReferenceVersionVisible}
                  overlayMode={overlayMode}
                  displayMode={displayMode}
                  initialTab={initialTab}
                  storageScope={storageScope}
                  hideBackgroundOnCompare={hideBackgroundOnCompare}
                />
                {/* Spacer for sticky footer */}
              </div>
            )}

            {/* ── Sticky Footer ── */}
            {view === "settings" && (
              <div className="dtb-studio__footer">
                {/* ── Cross-Tab & Cross-Scene Theme Sync Panel ── */}
                <div className="dtb-studio__sync-panel" ref={syncDropdownRef}>
                  <div className="dtb-studio__sync-header">
                    <div className="dtb-studio__sync-title-group">
                      <div className="dtb-studio__sync-title">
                        <Icon name="sync" size={15} />
                        <span>{t("dock.applyThemeTo", "Apply changes to:")}</span>
                      </div>
                      <div className="dtb-studio__sync-subtitle">
                        {t("dock.applyThemeSubtitle", "Choose where these theme settings should apply.")}
                      </div>
                    </div>

                  </div>

                  {/* Custom Designed Dropdown */}
                  <div className="dtb-studio__sync-dropdown-container">
                    <button
                      type="button"
                      className={`dtb-studio__sync-dropdown-trigger${isSyncDropdownOpen ? " dtb-studio__sync-dropdown-trigger--open" : ""}`}
                      onClick={() => setIsSyncDropdownOpen((prev) => !prev)}
                      aria-expanded={isSyncDropdownOpen}
                      aria-haspopup="listbox"
                      aria-label={t("dock.applyThemeTo", "Apply changes to")}
                    >
                      <div className="dtb-studio__sync-dropdown-trigger-main">
                        <Icon
                          name={
                            syncScopeMode === "all"
                              ? "grid_view"
                              : syncScopeMode === "current"
                                ? "radio_button_checked"
                                : "tune"
                          }
                          size={15}
                          className="dtb-studio__sync-dropdown-trigger-icon"
                        />
                        <span className="dtb-studio__sync-dropdown-trigger-text">
                          {syncScopeMode === "all"
                            ? t("dock.allTabsScenes", "All Tabs & Scenes")
                            : syncScopeMode === "current"
                              ? t("dock.currentOnly", "Current Only")
                              : t("dock.customScope", "Custom…")}
                        </span>
                      </div>
                      <div className="dtb-studio__sync-dropdown-trigger-end">
                        <Icon
                          name={isSyncDropdownOpen ? "expand_less" : "expand_more"}
                          size={16}
                          className="dtb-studio__sync-dropdown-chevron"
                        />
                      </div>
                    </button>

                    {isSyncDropdownOpen && (
                      <div className="dtb-studio__sync-dropdown-menu" role="listbox">
                        <button
                          type="button"
                          role="option"
                          aria-selected={syncScopeMode === "all"}
                          className={`dtb-studio__sync-dropdown-item${syncScopeMode === "all" ? " dtb-studio__sync-dropdown-item--active" : ""}`}
                          onClick={() => {
                            setSyncScopeMode("all");
                            setSyncTabs({ bible: true, worship: true, notes: true });
                            setSyncModes({ fullscreen: true, "lower-third": true });
                            setIsSyncDropdownOpen(false);
                          }}
                        >
                          <div className="dtb-studio__sync-dropdown-item-icon">
                            <Icon name="grid_view" size={15} />
                          </div>
                          <div className="dtb-studio__sync-dropdown-item-content">
                            <div className="dtb-studio__sync-dropdown-item-title">
                              {t("dock.allTabsScenes", "All Tabs & Scenes")}
                            </div>
                            <div className="dtb-studio__sync-dropdown-item-desc">
                              {t("dock.savingAllHint", "Applies to every supported tab and scene.")}
                            </div>
                          </div>
                          {syncScopeMode === "all" && (
                            <div className="dtb-studio__sync-dropdown-item-check">
                              <Icon name="check" size={14} />
                            </div>
                          )}
                        </button>

                        <button
                          type="button"
                          role="option"
                          aria-selected={syncScopeMode === "current"}
                          className={`dtb-studio__sync-dropdown-item${syncScopeMode === "current" ? " dtb-studio__sync-dropdown-item--active" : ""}`}
                          onClick={() => {
                            setSyncScopeMode("current");
                            setIsSyncDropdownOpen(false);
                          }}
                        >
                          <div className="dtb-studio__sync-dropdown-item-icon">
                            <Icon name="radio_button_checked" size={15} />
                          </div>
                          <div className="dtb-studio__sync-dropdown-item-content">
                            <div className="dtb-studio__sync-dropdown-item-title">
                              {t("dock.currentOnly", "Current Only")}
                            </div>
                            <div className="dtb-studio__sync-dropdown-item-desc">
                              {t("dock.savingCurrentHint", `Applies only to ${currentTab === "bible"
                                  ? t("dock.bible", "Bible")
                                  : currentTab === "worship"
                                    ? t("dock.worship", "Worship")
                                    : t("dock.notes", "Notes")
                                } · ${currentMode === "fullscreen"
                                  ? t("dock.fullScreen", "Full Screen")
                                  : t("dock.lowerThird", "Lower-Third")
                                }`)}
                            </div>
                          </div>
                          {syncScopeMode === "current" && (
                            <div className="dtb-studio__sync-dropdown-item-check">
                              <Icon name="check" size={14} />
                            </div>
                          )}
                        </button>

                        <button
                          type="button"
                          role="option"
                          aria-selected={syncScopeMode === "custom"}
                          className={`dtb-studio__sync-dropdown-item${syncScopeMode === "custom" ? " dtb-studio__sync-dropdown-item--active" : ""}`}
                          onClick={() => {
                            setSyncScopeMode("custom");
                            setIsSyncDropdownOpen(false);
                          }}
                        >
                          <div className="dtb-studio__sync-dropdown-item-icon">
                            <Icon name="tune" size={15} />
                          </div>
                          <div className="dtb-studio__sync-dropdown-item-content">
                            <div className="dtb-studio__sync-dropdown-item-title">
                              {t("dock.customScope", "Custom…")}
                            </div>
                            <div className="dtb-studio__sync-dropdown-item-desc">
                              {t("dock.customScopeDesc", "Choose specific tabs and scenes")}
                            </div>
                          </div>
                          {syncScopeMode === "custom" && (
                            <div className="dtb-studio__sync-dropdown-item-check">
                              <Icon name="check" size={14} />
                            </div>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {syncScopeMode === "all" && (
                    <div className="dtb-studio__sync-hint dtb-studio__sync-hint--all">
                      <span>{t("dock.savingAllHint", "Applies to every supported tab and scene.")}</span>
                    </div>
                  )}

                  {syncScopeMode === "current" && (
                    <div className="dtb-studio__sync-hint">
                      <span>
                        {t("dock.savingCurrentHint", `Applies only to ${currentTab === "bible"
                            ? t("dock.bible", "Bible")
                            : currentTab === "worship"
                              ? t("dock.worship", "Worship")
                              : t("dock.notes", "Notes")
                          } · ${currentMode === "fullscreen"
                            ? t("dock.fullScreen", "Full Screen")
                            : t("dock.lowerThird", "Lower-Third")
                          }`)}
                      </span>
                    </div>
                  )}

                  {syncScopeMode === "custom" && (
                    <div className="dtb-studio__sync-custom">
                      <div className="dtb-studio__sync-section">
                        <div className="dtb-studio__sync-section-head">
                          <span className="dtb-studio__sync-section-title">{t("dock.tabs", "Tabs")}</span>
                          <button
                            type="button"
                            className="dtb-studio__sync-toggle-all"
                            onClick={() => {
                              const allSelected =
                                syncTabs.bible && syncTabs.worship && syncTabs.notes && syncModes.fullscreen && syncModes["lower-third"];
                              if (allSelected) {
                                setSyncTabs({
                                  bible: currentTab === "bible",
                                  worship: currentTab === "worship",
                                  notes: currentTab === "notes",
                                });
                                setSyncModes({
                                  fullscreen: currentMode === "fullscreen",
                                  "lower-third": currentMode === "lower-third",
                                });
                              } else {
                                setSyncTabs({ bible: true, worship: true, notes: true });
                                setSyncModes({ fullscreen: true, "lower-third": true });
                              }
                            }}
                          >
                            {syncTabs.bible && syncTabs.worship && syncTabs.notes && syncModes.fullscreen && syncModes["lower-third"]
                              ? t("common.clearAll", "Clear all")
                              : t("common.selectAll", "Select all")}
                          </button>
                        </div>
                        <div className="dtb-studio__sync-chips">
                          <label className={`dtb-studio__sync-chip${syncTabs.bible ? " dtb-studio__sync-chip--active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={syncTabs.bible}
                              onChange={(e) => setSyncTabs((prev) => ({ ...prev, bible: e.target.checked }))}
                            />
                            <Icon name={syncTabs.bible ? "check_box" : "check_box_outline_blank"} size={13} />
                            <span>{t("dock.bible", "Bible")}</span>
                          </label>
                          <label className={`dtb-studio__sync-chip${syncTabs.worship ? " dtb-studio__sync-chip--active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={syncTabs.worship}
                              onChange={(e) => setSyncTabs((prev) => ({ ...prev, worship: e.target.checked }))}
                            />
                            <Icon name={syncTabs.worship ? "check_box" : "check_box_outline_blank"} size={13} />
                            <span>{t("dock.worship", "Worship")}</span>
                          </label>
                          <label className={`dtb-studio__sync-chip${syncTabs.notes ? " dtb-studio__sync-chip--active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={syncTabs.notes}
                              onChange={(e) => setSyncTabs((prev) => ({ ...prev, notes: e.target.checked }))}
                            />
                            <Icon name={syncTabs.notes ? "check_box" : "check_box_outline_blank"} size={13} />
                            <span>{t("dock.notes", "Notes")}</span>
                          </label>
                        </div>
                      </div>

                      <div className="dtb-studio__sync-section">
                        <div className="dtb-studio__sync-section-head">
                          <span className="dtb-studio__sync-section-title">{t("dock.scenes", "Scenes")}</span>
                        </div>
                        <div className="dtb-studio__sync-chips">
                          <label className={`dtb-studio__sync-chip${syncModes.fullscreen ? " dtb-studio__sync-chip--active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={syncModes.fullscreen}
                              onChange={(e) => setSyncModes((prev) => ({ ...prev, fullscreen: e.target.checked }))}
                            />
                            <Icon name={syncModes.fullscreen ? "check_box" : "check_box_outline_blank"} size={13} />
                            <span>{t("dock.fullScreen", "Full Screen")}</span>
                          </label>
                          <label className={`dtb-studio__sync-chip${syncModes["lower-third"] ? " dtb-studio__sync-chip--active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={syncModes["lower-third"]}
                              onChange={(e) => setSyncModes((prev) => ({ ...prev, "lower-third": e.target.checked }))}
                            />
                            <Icon name={syncModes["lower-third"] ? "check_box" : "check_box_outline_blank"} size={13} />
                            <span>{t("dock.lowerThird", "Lower-Third")}</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="dtb-studio__footer-actions">
                  <button
                    type="button"
                    className="dtb-studio__footer-btn dtb-studio__footer-btn--reset"
                    onClick={handleReset}
                    title={t('common.resetToDefault', t('common.reset', 'Reset to Default'))}>
                    <Icon name="restart_alt" size={15} />
                    <span>{t('common.resetToDefault', t('common.reset', 'Reset to Default'))}</span>
                  </button>
                  <button
                    type="button"
                    className="dtb-studio__footer-btn dtb-studio__footer-btn--save"
                    onClick={handleSave}
                    disabled={saving}
                    title={saving ? t('worship.saving') : t('worship.saveChanges', 'Save Changes')}>
                    <Icon name="save" size={15} />
                    <span>{saving ? t('worship.saving') : t('worship.saveChanges', 'Save Changes')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
