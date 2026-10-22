import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { HexColorPicker } from "react-colorful";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { themeSupportsBibleOverlayMode } from "../../bible/themeVariantSupport";
import type { BibleTheme } from "../../bible/types";
import { BACKGROUND_PATTERNS } from "../../library/backgroundAssets";
import type { MediaItem } from "../../library/libraryTypes";
import { compareMediaItemsNewest, getMediaStableKey } from "../../library/mediaOrdering";
import { isInternalDockMediaItem } from "../internalMediaAssets";
import { getDockEntitlementLimit, isDockFreePlan, showUpgradeModal } from "../dockEntitlement";
import {
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../../services/localDockSettings";
import { toStoredOverlayAssetUrl } from "../../services/overlayUrl";
import {
  loadDockPreferenceList,
  readDockPreferenceList,
  saveDockPreferenceList,
} from "../../services/dockPreferenceStorage";
import { FAVORITE_THEMES_UPDATED_EVENT } from "../../services/favoriteThemes";
import Icon from "../DockIcon";
import { dockClient } from "../../services/dockBridge";
import {
  COMPARE_GAP_PRESETS,
  COMPARE_LAYOUT_PRESETS,
  normalizeCompareThemeSettings,
  type CompareFontWeight,
  type CompareMetadataPosition,
  type CompareTextAlign
} from "../compareThemeConfig";
import type { DockBackgroundPreset } from "../dockConsoleTheme";
import { loadDockFavoriteBibleThemes, loadDockThemesForArea } from "../dockThemeData";
import { dockAreaFromScope, type DockThemeArea } from "../../services/dockThemeAvailability";
import {
  LOWER_THIRD_FIT_MIN_FONT_SIZE,
  LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
  LOWER_THIRD_FONT_SIZE_MAX,
  LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
} from "../lowerThirdQuickSettings";
import type { DockFullscreenQuickThemeSettings } from "./DockFullscreenThemeQuickSettings";
import { TextEffectsPicker } from "./TextEffectsPicker";
import LayoutThemeAdjustPanel from "./LayoutThemeAdjustPanel";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { DOCK_THEMES_REFRESHED_EVENT, type DockThemesRefreshedDetail } from "../dockThemeRefresh";
import type { ThemeLayout } from "../../themes/layout/types";
import ThemeLayoutPreview from "../../themes/layout/ThemeLayoutPreview";

/* ── Types ── */
type BackgroundType = "off" | "theme" | "color" | "image" | "pattern" | "video";
type BackgroundPickerTab = "text" | "layout" | "background" | "compare";
type BackgroundPickerStorageScope = "bible" | "worship" | "notes" | "global";
export type BibleReferenceFormat = "full" | "short" | "hidden";
type CompactFontWeight = "light" | "normal" | "bold" | "extrabold" | "black";
type CompactTextCase = "none" | "uppercase" | "lowercase" | "capitalize";
type CompactTextAlign = "match" | "left" | "center" | "right" | "justify";

export type TextShadowPresetId = "broadcast" | "soft" | "bold" | "easyworship" | "glow" | "none";

export const TEXT_SHADOW_PRESETS: Array<{ id: TextShadowPresetId; label: string; value: string }> = [
  { id: "broadcast", label: "Broadcast Bold", value: "4px 5px 2px rgba(0, 0, 0, 0.95)" },
  { id: "soft", label: "Soft (0 2px 6px)", value: "0 2px 6px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)" },
  { id: "bold", label: "Bold (0 3px 8px)", value: "0 3px 8px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.45)" },
  { id: "easyworship", label: "Solid Contour", value: "0 2px 8px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.5)" },
  { id: "glow", label: "Glow (0 0 16px)", value: "0 0 8px rgba(0,0,0,0.6), 0 0 16px rgba(0,0,0,0.4)" },
  { id: "none", label: "None", value: "none" },
];

export function parseTextShadow(shadowStr?: string | null): { distance: number; blur: number; opacity: number } {
  if (!shadowStr || shadowStr === "none") {
    return { distance: 0, blur: 0, opacity: 0 };
  }
  const m = shadowStr.match(/(-?\d+)px\s+(-?\d+)px(?:\s+(\d+)px)?.*?rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/i);
  if (m) {
    const y = parseInt(m[2], 10) || 0;
    const blur = m[3] ? parseInt(m[3], 10) : 2;
    const alpha = m[4] ? parseFloat(m[4]) : 0.95;
    return {
      distance: Math.min(15, Math.max(0, Math.abs(y))),
      blur: Math.min(15, Math.max(0, blur)),
      opacity: Math.min(100, Math.max(0, Math.round(alpha * 100))),
    };
  }
  return { distance: 5, blur: 2, opacity: 95 };
}

export function buildTextShadow(distance: number, blur: number, opacity: number): string {
  if (distance === 0 && blur === 0 && opacity === 0) return "none";
  const x = Math.round(distance * 0.8);
  const y = distance;
  const alpha = (Math.max(0, Math.min(100, opacity)) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${x}px ${y}px ${blur}px rgba(0, 0, 0, ${alpha})`;
}

export function resolveActiveShadowPreset(textShadow?: string | null): TextShadowPresetId {
  if (!textShadow || textShadow === "none") return "none";
  if (textShadow.includes("4px 5px") || textShadow.includes("0.95") || textShadow.includes("broadcast")) return "broadcast";
  if (textShadow.includes("16px") || textShadow.includes("24px") || textShadow.includes("40px") || textShadow.includes("20px") || textShadow.includes("glow")) return "glow";
  if (textShadow.includes("0 2px 8px rgba(0,0,0,0.7)") || textShadow.includes("3px 3px 0") || textShadow.includes("-2px -2px 0") || textShadow.includes("Solid")) return "easyworship";
  if (textShadow.includes("3px 8px") || textShadow.includes("3px 3px 6px") || textShadow.includes("2px 2px 0") || textShadow.includes("12px") || textShadow.includes("bold")) return "bold";
  return "soft";
}

export type StrokeThicknessOption = "none" | "thin" | "sm" | "md" | "lg" | "xl" | "xxl" | "max";

export const STROKE_THICKNESS_OPTIONS: Array<{ value: StrokeThicknessOption; label: string; width: number; enabled: boolean }> = [
  { value: "none", label: "Off (No stroke)", width: 0, enabled: false },
  { value: "thin", label: "Thin (1px)", width: 1, enabled: true },
  { value: "sm", label: "SM (2px)", width: 2, enabled: true },
  { value: "md", label: "MD (4px)", width: 4, enabled: true },
  { value: "lg", label: "LG (6px)", width: 6, enabled: true },
  { value: "xl", label: "XL (8px)", width: 8, enabled: true },
  { value: "xxl", label: "XXL (10px)", width: 10, enabled: true },
  { value: "max", label: "Max (12px)", width: 12, enabled: true },
];

export function resolveActiveOutlinePreset(outline?: boolean, width?: number): StrokeThicknessOption {
  if (!outline || !width || width <= 0) return "none";
  if (width <= 1) return "thin";
  if (width <= 2) return "sm";
  if (width <= 4) return "md";
  if (width <= 6) return "lg";
  if (width <= 8) return "xl";
  if (width <= 10) return "xxl";
  return "max";
}

/** Legacy alias for tests/components expecting TEXT_OUTLINE_OPTIONS */
export const TEXT_OUTLINE_OPTIONS = STROKE_THICKNESS_OPTIONS.map((op) => ({
  id: op.value,
  value: op.value,
  label: op.label,
  width: op.width,
  enabled: op.enabled,
}));

interface SavedLocalStyle {
  id: string;
  name: string;
  createdAt: number;
  backgroundType: BackgroundType;
  settings: DockFullscreenQuickThemeSettings;
}

interface Props {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onQuickSettingsSave?: (settings: DockFullscreenQuickThemeSettings) => void;
  onSaveFeedback?: (message: string) => void;
  selectedThemeId: string | null;
  onThemeSelect: (theme: BibleTheme) => void;
  templateType?: BibleTheme["templateType"];
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
  sampleText?: string;
  sampleReference?: string;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  /** Show the Reference section (only relevant for Bible tab) */
  showReferences?: boolean;
  /** Bible-only reference display preferences surfaced in the Reference sub-tab */
  referenceFormat?: BibleReferenceFormat;
  referenceVersionVisible?: boolean;
  referenceTranslation?: string;
  onReferenceFormatChange?: (format: BibleReferenceFormat) => void;
  onReferenceVersionVisibleChange?: (visible: boolean) => void;
  /** Active overlay mode — used to resolve variant preview in theme cards */
  overlayMode?: "fullscreen" | "lower-third";
  /** Active display mode — controls whether Compare Layout section is visible */
  displayMode?: "single" | "compare";
  initialTab?: BackgroundPickerTab;
  /** Storage scope keeps local picker preferences separate for Bible, Worship, and Notes */
  storageScope?: BackgroundPickerStorageScope;
  /** When true and displayMode is "compare", hides the Background tab and shows only the Compare tab */
  hideBackgroundOnCompare?: boolean;
}

const BG_TYPE_KEY = "dtb-bg-picker-type";
const ACTIVE_TAB_KEY = "dtb-bg-picker-tab";
const LOCAL_STYLES_KEY = "dtb-bg-picker-local-styles";
const LOCAL_STYLE_LIMIT = 12;
const LOWER_THIRD_TEXT_PADDING_MAX = 250;
export const BACKGROUND_PICKER_COMPACT_HEIGHT = 520;

const BG_OPTIONS: Array<{ id: BackgroundType; label: string; icon: string }> = [
  { id: "off", label: "bgPicker.off", icon: "block" },
  { id: "theme", label: "bgPicker.theme", icon: "palette" },
  { id: "color", label: "common.color", icon: "color_lens" },
  { id: "pattern", label: "common.pattern", icon: "texture" },
  { id: "image", label: "common.image", icon: "image" },
  { id: "video", label: "common.video", icon: "videocam" },
];
const COMPARE_BG_OPTIONS = BG_OPTIONS.filter((option) => option.id !== "theme");

const INLINE_COLOR_SWATCHES = [
  "#FFFFFF",
  "#F8FAFC",
  "#E2E8F0",
  "#CBD5E1",
  "#94A3B8",
  "#0F172A",
  "#111827",
  "#FDE68A",
  "#F4D17B",
  "#B9CCFF",
  "#60A5FA",
  "#22C55E",
];

/* ── Helpers ── */
function isOverlayAssetUrl(value: string): boolean {
  return /^(?:data:|blob:|https?:\/\/|\/uploads\/|uploads\/)/i.test(value);
}

/**
 * Normalize current and legacy library records to a URL the OBS overlay can
 * load. Older records may have a filesystem-style path in `url`; uploaded
 * records have a stable disk filename that is safer than the URL's origin.
 */
export function toBackgroundAssetUrl(item: Pick<MediaItem, "url" | "filePath" | "diskFileName">): string {
  if (item.diskFileName) {
    return `/uploads/${encodeURIComponent(item.diskFileName)}`;
  }

  const storedUrl = toStoredOverlayAssetUrl(item.url);
  if (isOverlayAssetUrl(storedUrl)) return storedUrl;

  const fileName = String(item.filePath || "")
    .replace(/^file:\/\//i, "")
    .split(/[\\/]/)
    .pop()
    ?.trim();
  if (fileName) return `/uploads/${encodeURIComponent(fileName)}`;

  return storedUrl;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sliderProgress(value: number, min: number, max: number): CSSProperties {
  const safeValue = Number.isFinite(value) ? value : min;
  const progress = Math.min(100, Math.max(0, ((safeValue - min) / (max - min)) * 100));
  return { "--dtb-slider-progress": `${progress}%` } as CSSProperties;
}

/** The layer layout a theme draws in this mode, if it is a layer (ready-made) theme. */
function layoutForMode(theme: BibleTheme, mode: "fullscreen" | "lower-third"): ThemeLayout | null {
  const variant = mode === "lower-third" ? theme.variants?.lowerThird : theme.variants?.fullscreen;
  const layout = variant?.settings?.layout ?? theme.settings?.layout;
  return layout && layout.format === mode ? layout : null;
}

function inferBgTypeFromSettings(qs: DockFullscreenQuickThemeSettings): BackgroundType {
  // Prefer explicit persisted type
  if (qs.backgroundType) return qs.backgroundType;
  if (qs.backgroundImage) return "image";
  if (qs.backgroundPattern) return "pattern";
  if (qs.backgroundVideo) return "video";
  if (qs.backgroundColor && qs.backgroundColorEnd) return "color";
  if (qs.backgroundColor && qs.backgroundColor !== "transparent") return "color";
  if (qs.fullscreenShadeColor && qs.fullscreenShadeColor !== "#000000") return "color";
  if (qs.fullscreenShadeOpacity > 0) return "theme";
  return "off";
}

function resolveInitialTab(
  tab: BackgroundPickerTab | undefined,
  displayMode: Props["displayMode"],
  activeTabKey: string,
  forceCompare?: boolean,
): BackgroundPickerTab {
  if (forceCompare && displayMode === "compare") return "compare";

  const stored = (() => {
    try {
      const v = readNativeDockSetting<string>(activeTabKey);
      if (v === "text" || v === "layout" || v === "background" || v === "compare") return v;
    } catch { /* ignore */ }
    return null;
  })();

  const resolved = stored ?? tab ?? "text";
  if (resolved === "compare" && displayMode !== "compare") return "text";
  if ((resolved === "text" || resolved === "layout") && displayMode === "compare") return "background";
  return resolved;
}

function isBackgroundType(value: string | null): value is BackgroundType {
  return value === "off" || value === "theme" || value === "color" || value === "image" || value === "pattern" || value === "video";
}

/** Apply the same plan quota used by the media library to background choices. */
export function limitBackgroundPickerAssets<T>(items: T[], limit: number): T[] {
  if (limit === -1 || limit === Number.POSITIVE_INFINITY) return items;
  return items.slice(0, Math.max(0, Math.floor(limit)));
}

export function canAddBackgroundPickerAsset(currentCount: number, limit: number): boolean {
  return limit === -1 || limit === Number.POSITIVE_INFINITY || currentCount < limit;
}

export const BACKGROUND_PATTERN_PICKER_LIMIT = 3;

export function getDockPatternLimit(isFree: boolean = isDockFreePlan()): number {
  return isFree ? BACKGROUND_PATTERN_PICKER_LIMIT : -1;
}

function createLocalStyleId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneQuickSettings(settings: DockFullscreenQuickThemeSettings): DockFullscreenQuickThemeSettings {
  try {
    return JSON.parse(JSON.stringify(settings)) as DockFullscreenQuickThemeSettings;
  } catch {
    return { ...settings };
  }
}

function parseLowerThirdPadding(value: unknown): { vertical: number; horizontal: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    const clamped = clampNumberValue(value, 0, LOWER_THIRD_TEXT_PADDING_MAX);
    return { vertical: clamped, horizontal: clamped };
  }

  if (typeof value !== "string" || !value.trim()) {
    return { vertical: 18, horizontal: 28 };
  }

  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) {
    return { vertical: 18, horizontal: 28 };
  }

  if (parts.length === 1) {
    const clamped = clampNumberValue(parts[0], 0, LOWER_THIRD_TEXT_PADDING_MAX);
    return { vertical: clamped, horizontal: clamped };
  }

  return {
    vertical: clampNumberValue(parts[0], 0, LOWER_THIRD_TEXT_PADDING_MAX),
    horizontal: clampNumberValue(parts[1], 0, LOWER_THIRD_TEXT_PADDING_MAX),
  };
}

function formatLowerThirdPadding(vertical: number, horizontal: number): string {
  return `${Math.round(clampNumberValue(vertical, 0, LOWER_THIRD_TEXT_PADDING_MAX))}px ${Math.round(clampNumberValue(horizontal, 0, LOWER_THIRD_TEXT_PADDING_MAX))}px`;
}

function validateSavedLocalStyles(parsed: unknown): SavedLocalStyle[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is SavedLocalStyle => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<SavedLocalStyle>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.createdAt === "number" &&
        isBackgroundType(candidate.backgroundType ?? null) &&
        !!candidate.settings &&
        typeof candidate.settings === "object"
      );
    })
    .slice(0, LOCAL_STYLE_LIMIT);
}

function getScopeLabel(scope: BackgroundPickerStorageScope): string {
  if (scope === "bible") return "Bible";
  if (scope === "worship") return "Worship";
  if (scope === "notes") return "Notes";
  return "Local";
}

function getModeLabel(mode: NonNullable<Props["overlayMode"]>): string {
  return mode === "lower-third" ? "Lower Third" : "Full Screen";
}

/* ── Main Component ── */
export default function BackgroundPickerCard({
  quickSettings,
  onQuickSettingsChange,
  selectedThemeId: _selectedThemeId,
  onThemeSelect: _onThemeSelect,
  templateType: _templateType,
  allowedCategories: _allowedCategories,
  sampleText: _sampleText = "Faith",
  sampleReference: _sampleReference = "John 3:16",
  onBackgroundPresetChange,
  showReferences = true,
  referenceFormat,
  referenceVersionVisible = false,
  referenceTranslation = "KJV",
  onReferenceFormatChange,
  onReferenceVersionVisibleChange,
  overlayMode = "fullscreen",
  displayMode = "single",
  initialTab,
  storageScope = "global",
  hideBackgroundOnCompare = false,
  onSaveFeedback,
}: Props) {
  const { t } = useTranslation();
  const imageLimit = getDockEntitlementLimit("images");
  const videoLimit = getDockEntitlementLimit("videos");
  const patternLimit = getDockPatternLimit();
  const backgroundTypeSelectId = useId();
  const localStylesSelectId = useId();
  const storageKeys = useMemo(() => {
    const scopeKey = `${storageScope}:${overlayMode}`;
    return {
      activeTab: `${ACTIVE_TAB_KEY}:${scopeKey}`,
      bgType: `${BG_TYPE_KEY}:${scopeKey}`,
      localStyles: `${LOCAL_STYLES_KEY}:${scopeKey}`,
      scrollTop: `dtb-bg-picker-scroll-top:${scopeKey}`,
    };
  }, [overlayMode, storageScope]);
  const [activeTab, setActiveTab] = useState<BackgroundPickerTab>(() =>
    resolveInitialTab(initialTab, displayMode, storageKeys.activeTab, hideBackgroundOnCompare && displayMode === "compare"),
  );
  const [bgType, setBgType] = useState<BackgroundType>(() => {
    try {
      const stored = readNativeDockSetting<string>(storageKeys.bgType);
      if (stored && isBackgroundType(stored)) return stored;
    } catch { /* ignore */ }
    return inferBgTypeFromSettings(quickSettings);
  });

  // Reference text follows the verse's colour, weight and case unless the
  // operator turns "Same style as verse" off. Starts on when they already match.
  const [fontStyleOpen, setFontStyleOpen] = useState(false);
  const [referenceStyleLinked, setReferenceStyleLinked] = useState<boolean>(() => (
    (quickSettings.refFontColor ?? quickSettings.fontColor) === quickSettings.fontColor
    && (quickSettings.refFontWeight ?? quickSettings.fontWeight) === quickSettings.fontWeight
    && (quickSettings.refTextTransform ?? quickSettings.textTransform ?? "none") === (quickSettings.textTransform ?? "none")
  ));
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [savedStyles, setSavedStyles] = useState<SavedLocalStyle[]>(() => {
    try { return validateSavedLocalStyles(readDockPreferenceList<SavedLocalStyle>(storageKeys.localStyles)); } catch { return []; }
  });
  const [selectedLocalStyleId, setSelectedLocalStyleId] = useState("");
  const [localStyleStatus, setLocalStyleStatus] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const [pickerHeight, setPickerHeight] = useState(0);
  const prevStorageKeysRef = useRef(storageKeys);
  const compareBackdropValue: BackgroundType = bgType;
  const lowerThirdPadding = parseLowerThirdPadding(quickSettings.lowerThirdCardPadding);
  const lowerThirdPaddingLinked = quickSettings.lowerThirdPaddingLinked ?? false;
  const lowerThirdLinkedPadding = clampNumberValue(
    Math.round((lowerThirdPadding.vertical + lowerThirdPadding.horizontal) / 2),
    0,
    LOWER_THIRD_TEXT_PADDING_MAX,
  );
  const lowerThirdCardRadius = clampNumberValue(Number(quickSettings.lowerThirdCardRadius ?? 18), 0, 64);
  const supportsLowerThirdShapeControls = storageScope === "bible" || storageScope === "worship" || storageScope === "notes";
  const isBiblePicker = storageScope === "bible" && showReferences;
  const isBiblePickerRef = useRef(isBiblePicker);
  isBiblePickerRef.current = isBiblePicker;
  const referenceStyleLinkedRef = useRef(referenceStyleLinked);
  referenceStyleLinkedRef.current = referenceStyleLinked;
  const isCompactHeight = pickerHeight > 0 && pickerHeight <= BACKGROUND_PICKER_COMPACT_HEIGHT;

  // Ready-made layer themes bring their own fonts, colours and effects, so the
  // Text / Layout editors are swapped for a simple size & position panel.
  const [layerTheme, setLayerTheme] = useState<{ name: string; layout: ThemeLayout } | null>(() => {
    const builtin = BUILTIN_THEMES.find((theme) => theme.id === _selectedThemeId);
    const layout = builtin ? layoutForMode(builtin, overlayMode) : null;
    return builtin && layout ? { name: builtin.name, layout } : null;
  });
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!_selectedThemeId) return null;
      let theme = BUILTIN_THEMES.find((item) => item.id === _selectedThemeId);
      if (!theme) {
        try {
          theme = (await loadDockFavoriteBibleThemes()).find((item) => item.id === _selectedThemeId);
        } catch {
          theme = undefined;
        }
      }
      const layout = theme ? layoutForMode(theme, overlayMode) : null;
      return theme && layout ? { name: theme.name, layout } : null;
    };
    void resolve().then((next) => {
      if (!cancelled) setLayerTheme(next);
    });
    // A theme edited in the app: use the fresh copy (new layers / colours) right away.
    const onRefreshed = (event: Event) => {
      const fresh = (event as CustomEvent<DockThemesRefreshedDetail>).detail?.themes?.find((item) => item.id === _selectedThemeId);
      const layout = fresh ? layoutForMode(fresh, overlayMode) : null;
      if (!cancelled && fresh) setLayerTheme(layout ? { name: fresh.name, layout } : null);
    };
    window.addEventListener(DOCK_THEMES_REFRESHED_EVENT, onRefreshed);
    return () => {
      cancelled = true;
      window.removeEventListener(DOCK_THEMES_REFRESHED_EVENT, onRefreshed);
    };
  }, [_selectedThemeId, overlayMode]);
  const simpleLayerMode = Boolean(layerTheme) && displayMode !== "compare";
  // Full-screen layer themes draw their own background layer; the Background tab swaps it
  // (colour / image / video / off) and darkens it. Lower thirds have no full-screen background.
  const layerBackdropMode = simpleLayerMode && layerTheme?.layout.format === "fullscreen";

  // Restore scroll position on mount or tab change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const savedScroll = readNativeDockSetting<number>(storageKeys.scrollTop);
      if (typeof savedScroll === "number" && savedScroll > 0) {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = savedScroll;
          }
        });
      }
    } catch { /* ignore */ }
  }, [activeTab, storageKeys.scrollTop]);

  const handleScroll = useCallback(() => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      if (scrollRef.current) {
        writeNativeDockSetting(storageKeys.scrollTop, scrollRef.current.scrollTop);
      }
    }, 120);
  }, [storageKeys.scrollTop]);

  const handleTabChange = useCallback((tab: BackgroundPickerTab) => {
    setActiveTab(tab);
    writeNativeDockSetting(storageKeys.activeTab, tab);
  }, [storageKeys.activeTab]);


  /** Apply a verse-style change, and mirror it to the reference while linked. */
  const updateVerseStyle = useCallback((
    patch: Partial<Pick<DockFullscreenQuickThemeSettings, "fontColor" | "fontWeight" | "textTransform" | "letterSpacing">>,
  ) => {
    onQuickSettingsChange((prev) => {
      const next = { ...prev, ...patch };
      if (isBiblePickerRef.current && referenceStyleLinkedRef.current) {
        if (patch.fontColor !== undefined) next.refFontColor = patch.fontColor;
        if (patch.fontWeight !== undefined) next.refFontWeight = patch.fontWeight;
        if (patch.textTransform !== undefined) next.refTextTransform = patch.textTransform;
        if (patch.letterSpacing !== undefined) next.refLetterSpacing = patch.letterSpacing;
      }
      return next;
    });
  }, [onQuickSettingsChange]);

  const handleReferenceStyleLinkedChange = useCallback((linked: boolean) => {
    setReferenceStyleLinked(linked);
    if (!linked) return;
    onQuickSettingsChange((prev) => ({
      ...prev,
      refFontColor: prev.fontColor,
      refFontWeight: prev.fontWeight,
      refTextTransform: prev.textTransform,
      refLetterSpacing: prev.letterSpacing ?? 0,
    }));
  }, [onQuickSettingsChange]);

  useEffect(() => {
    const element = pickerRef.current;
    if (!element) return;

    const updateHeight = () => setPickerHeight(element.clientHeight);
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPickerHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadDockPreferenceList<SavedLocalStyle>(storageKeys.localStyles).then((items) => {
      if (cancelled || !items) return;
      setSavedStyles(validateSavedLocalStyles(items));
    });
    return () => {
      cancelled = true;
    };
  }, [storageKeys.localStyles]);

  useEffect(() => {
    const previous = prevStorageKeysRef.current;
    if (previous.activeTab === storageKeys.activeTab && previous.bgType === storageKeys.bgType && previous.localStyles === storageKeys.localStyles) {
      return;
    }
    prevStorageKeysRef.current = storageKeys;
    setActiveTab(resolveInitialTab(initialTab, displayMode, storageKeys.activeTab, hideBackgroundOnCompare && displayMode === "compare"));
    try {
      const stored = readNativeDockSetting<string>(storageKeys.bgType);
      setBgType(stored && isBackgroundType(stored) ? stored : inferBgTypeFromSettings(quickSettings));
    } catch {
      setBgType(inferBgTypeFromSettings(quickSettings));
    }
    try {
      setSavedStyles(validateSavedLocalStyles(readDockPreferenceList<SavedLocalStyle>(storageKeys.localStyles)));
    } catch {
      setSavedStyles([]);
    }
    setSelectedLocalStyleId("");
    setLocalStyleStatus("");
    setStyleMenuOpen(false);
  }, [displayMode, initialTab, quickSettings, storageKeys]);

  useEffect(() => {
    if (hideBackgroundOnCompare && displayMode === "compare" && activeTab !== "compare") {
      handleTabChange("compare");
    } else if (displayMode === "compare" && (activeTab === "text" || activeTab === "layout")) {
      handleTabChange("background");
    } else if (displayMode !== "compare" && activeTab === "compare") {
      handleTabChange("text");
    }
  }, [activeTab, displayMode, handleTabChange, hideBackgroundOnCompare]);

  // Persist active tab preference
  useEffect(() => {
    writeNativeDockSetting(storageKeys.activeTab, activeTab);
  }, [activeTab, storageKeys.activeTab]);

  useEffect(() => {
    const inferredType = inferBgTypeFromSettings(quickSettings);
    setBgType((current) => (current === inferredType ? current : inferredType));
  }, [
    quickSettings.backgroundColor,
    quickSettings.backgroundColorEnd,
    quickSettings.backgroundImage,
    quickSettings.backgroundPattern,
    quickSettings.backgroundType,
    quickSettings.backgroundVideo,
    quickSettings.fullscreenShadeColor,
    quickSettings.fullscreenShadeOpacity,
  ]);

  const handleTypeChange = useCallback((type: BackgroundType) => {
    setBgType(type);
    writeNativeDockSetting(storageKeys.bgType, type);

    // Build the updater for the given type
    let updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings;
    if (type === "off") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "off",
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundColor: "",
        backgroundColorEnd: "",
        fullscreenShadeOpacity: 0,
        backgroundOpacity: 0,
      });
    } else if (type === "theme") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "theme",
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundOpacity: prev.backgroundOpacity === 0 ? 1 : prev.backgroundOpacity,
        fullscreenShadeOpacity: prev.fullscreenShadeOpacity === 0 ? 0.42 : prev.fullscreenShadeOpacity,
      });
    } else if (type === "image") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "image",
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundImageFilePath: prev.backgroundImage ? prev.backgroundImageFilePath : "",
        backgroundOpacity: prev.backgroundOpacity === 0 ? 1 : prev.backgroundOpacity,
        fullscreenShadeOpacity: prev.fullscreenShadeOpacity === 0 ? 0.42 : prev.fullscreenShadeOpacity,
      });
    } else if (type === "video") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "video",
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideoFilePath: prev.backgroundVideo ? prev.backgroundVideoFilePath : "",
        backgroundOpacity: prev.backgroundOpacity === 0 ? 1 : prev.backgroundOpacity,
        fullscreenShadeOpacity: prev.fullscreenShadeOpacity === 0 ? 0.42 : prev.fullscreenShadeOpacity,
      });
    } else if (type === "pattern") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "pattern",
        backgroundColor: "",
        backgroundColorEnd: "",
        bgGradientAngle: 180,
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundPattern: prev.backgroundPattern || PATTERN_OPTIONS[0]?.src || "",
        backgroundOpacity: prev.backgroundOpacity === 0 ? 1 : prev.backgroundOpacity,
        fullscreenShadeOpacity: prev.fullscreenShadeOpacity === 0 ? 0.42 : prev.fullscreenShadeOpacity,
      });
    } else if (type === "color") {
      updater = (prev) => ({
        ...prev,
        backgroundType: "color",
        backgroundImage: "",
        backgroundImageFilePath: "",
        backgroundVideo: "",
        backgroundVideoFilePath: "",
        backgroundColor: prev.backgroundColor || "#0F172A",
        backgroundColorEnd: "",
        backgroundOpacity: prev.backgroundOpacity === 0 ? 1 : prev.backgroundOpacity,
        fullscreenShadeOpacity: prev.fullscreenShadeOpacity === 0 ? 0.42 : prev.fullscreenShadeOpacity,
      });
    } else {
      return;
    }

    onQuickSettingsChange(updater);

    // Reset the saved preset after settings update so the next explicit apply uses the new values.
    if (onBackgroundPresetChange) {
      onBackgroundPresetChange(type === "off" ? "none" : "theme");
    }
  }, [onQuickSettingsChange, onBackgroundPresetChange, storageKeys.bgType]);

  const persistSavedStyles = useCallback((next: SavedLocalStyle[]) => {
    const trimmed = next.slice(0, LOCAL_STYLE_LIMIT);
    setSavedStyles(trimmed);
    void saveDockPreferenceList(storageKeys.localStyles, trimmed);
  }, [storageKeys.localStyles]);

  const selectedLocalStyle = savedStyles.find((style) => style.id === selectedLocalStyleId) ?? null;

  const handleSaveLocalStyle = useCallback(() => {
    const nextIndex = savedStyles.length + 1;
    const styleName = `${getScopeLabel(storageScope)} ${getModeLabel(overlayMode)} Style ${nextIndex}`;
    const style: SavedLocalStyle = {
      id: createLocalStyleId(),
      name: styleName,
      createdAt: Date.now(),
      backgroundType: bgType,
      settings: cloneQuickSettings(quickSettings),
    };
    persistSavedStyles([style, ...savedStyles].slice(0, LOCAL_STYLE_LIMIT));
    setSelectedLocalStyleId(style.id);
    setLocalStyleStatus("");
    onSaveFeedback?.(t("dock.feedback.backgroundStyleSaved", "Background style saved."));
    setStyleMenuOpen(false);
  }, [bgType, onSaveFeedback, overlayMode, persistSavedStyles, quickSettings, savedStyles, storageScope, t]);

  const handleApplyLocalStyle = useCallback((styleId: string) => {
    setSelectedLocalStyleId(styleId);
    const style = savedStyles.find((item) => item.id === styleId);
    if (!style) {
      setLocalStyleStatus("");
      return;
    }
    setBgType(style.backgroundType);
    writeNativeDockSetting(storageKeys.bgType, style.backgroundType);
    onQuickSettingsChange(() => cloneQuickSettings(style.settings));
    setLocalStyleStatus(`Applied ${style.name}`);
    setStyleMenuOpen(false);
  }, [onQuickSettingsChange, savedStyles, storageKeys.bgType]);

  const handleDeleteSelectedLocalStyle = useCallback(() => {
    if (!selectedLocalStyle) return;
    persistSavedStyles(savedStyles.filter((style) => style.id !== selectedLocalStyle.id));
    setSelectedLocalStyleId("");
    setLocalStyleStatus(`Deleted ${selectedLocalStyle.name}`);
    setStyleMenuOpen(false);
  }, [persistSavedStyles, savedStyles, selectedLocalStyle]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!styleMenuOpen) return;
    const handle = (e: MouseEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setStyleMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [styleMenuOpen]);

  const compareOnlyMode = hideBackgroundOnCompare && displayMode === "compare";
  const localStylesControl = (
    <>
      <div className="dtb-local-styles">
        <div className="dtb-local-styles__menu-wrap" ref={styleMenuRef}>
          <button
            type="button"
            className={`dtb-local-styles__menu-btn${styleMenuOpen ? " dtb-local-styles__menu-btn--open" : ""}`}
            onClick={() => setStyleMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={styleMenuOpen}
            aria-label="Saved style actions"
            title="Saved style actions"
          >
            <Icon name="more_vert" size={15} />
          </button>
          {styleMenuOpen && (
            <div className="dtb-local-styles__menu" role="menu">
              <div className="dtb-local-styles__menu-label">Saved styles</div>
              <select
                id={localStylesSelectId}
                className="dtb-local-styles__select"
                value={selectedLocalStyleId}
                onChange={(event) => handleApplyLocalStyle(event.target.value)}
                disabled={savedStyles.length === 0}
                aria-label="Saved Styles"
                title="Saved Styles"
              >
                <option value="">
                  {savedStyles.length === 0 ? "No saved styles yet" : "Choose a saved style"}
                </option>
                {savedStyles.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="dtb-local-styles__menu-item"
                role="menuitem"
                onClick={handleSaveLocalStyle}
              >
                <Icon name="save" size={14} />
                <span>Save Current Style</span>
              </button>
              <button
                type="button"
                className="dtb-local-styles__menu-item dtb-local-styles__menu-item--danger"
                role="menuitem"
                onClick={handleDeleteSelectedLocalStyle}
                disabled={!selectedLocalStyle}
              >
                <Icon name="delete_outline" size={14} />
                <span>Delete Selected Style</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {localStyleStatus && (
        <p className="dtb-local-styles__status" role="status">
          {localStyleStatus}
        </p>
      )}
    </>
  );

  return (
    <div
      ref={pickerRef}
      className={`dtb-studio-card dtb-studio-card--picker${isCompactHeight ? " dtb-studio-card--compact-height" : ""}`}
      data-compact-height={isCompactHeight || undefined}
    >

      <div className={`dtb-studio-card__body dtb-bg-picker${compareOnlyMode ? " dtb-bg-picker--compare-only" : ""}`}>
        <div className={`dtb-bg-picker__layout${isCompactHeight ? " dtb-bg-picker__layout--compact" : ""}`}>
          {/* Tab Navigation */}
          {!compareOnlyMode && (
            <div
              className="dtb-bg-picker__tabs"
              role="tablist"
              aria-orientation={isCompactHeight ? "vertical" : "horizontal"}
              aria-label={t("bgPicker.settingsTabs", "Background settings")}
            >
              {displayMode !== "compare" && (
                <>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "text" || (simpleLayerMode && activeTab === "layout")}
                    aria-label={t('bgPicker.text')}
                    title={t('bgPicker.text')}
                    className={`dtb-bg-picker__tab${activeTab === "text" || (simpleLayerMode && activeTab === "layout") ? " dtb-bg-picker__tab--active" : ""}`}
                    onClick={() => {
                      setActiveTab("text");
                      handleTabChange("text");
                    }}
                  >
                    <Icon name={simpleLayerMode ? "tune" : "text_fields"} size={15} />
                    <span>{simpleLayerMode ? t('bgPicker.sizeTab', 'Size') : t('bgPicker.text')}</span>
                  </button>
                  {!simpleLayerMode && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "layout"}
                    aria-label={t('bgPicker.layout', 'Layout')}
                    title={t('bgPicker.layout', 'Layout')}
                    className={`dtb-bg-picker__tab${activeTab === "layout" ? " dtb-bg-picker__tab--active" : ""}`}
                    onClick={() => {
                      setActiveTab("layout");
                      handleTabChange("layout");
                    }}
                  >
                    <Icon name="grid_view" size={15} />
                    <span>{t('bgPicker.layout', 'Layout')}</span>
                  </button>
                  )}
                </>
              )}
              {(!hideBackgroundOnCompare || displayMode !== "compare") && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "background"}
                  aria-label={t("bgPicker.background", "Background")}
                  title={t("bgPicker.background", "Background")}
                  className={`dtb-bg-picker__tab${activeTab === "background" ? " dtb-bg-picker__tab--active" : ""}`}
                  onClick={() => {
                    setActiveTab("background");
                    handleTabChange("background");
                  }}
                >
                  <Icon name="image" size={15} />
                  <span>{t("bgPicker.background", "Background")}</span>
                </button>
              )}
              {displayMode === "compare" && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "compare"}
                  aria-label={t("bgPicker.compare", "Compare")}
                  title={t("bgPicker.compare", "Compare")}
                  className={`dtb-bg-picker__tab${activeTab === "compare" ? " dtb-bg-picker__tab--active" : ""}`}
                  onClick={() => {
                    setActiveTab("compare");
                    handleTabChange("compare");
                  }}
                >
                  <Icon name="compare_arrows" size={13} />
                  <span>{t("bgPicker.compare", "Compare")}</span>
                </button>
              )}
            </div>
          )}

          <div className="dtb-bg-picker__panel">


            <div className="dtb-bg-picker__scroll" ref={scrollRef} onScroll={handleScroll}>
              {/* Background Tab */}
              {activeTab === "background" && (
                <>
                  <p className="dtb-bg-picker__subtitle">{t('bgPicker.chooseBackground')}</p>

                  <div className="dtb-bg-picker__background-controls">
                    <div className="dtb-bg-picker__type-field">
                      <label className="dtb-bg-picker__type-label" htmlFor={backgroundTypeSelectId}>
                        {t('bgPicker.background', 'Background type')}
                      </label>
                      <select
                        id={backgroundTypeSelectId}
                        className="dtb-bg-picker__type-select"
                        value={bgType}
                        onChange={(event) => handleTypeChange(event.target.value as BackgroundType)}
                        aria-label={t('bgPicker.background', 'Background type')}
                      >
                        {BG_OPTIONS.filter((option) => !(layerBackdropMode && option.id === "pattern")).map((option) => (
                          <option key={option.id} value={option.id}>
                            {t(option.label)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {localStylesControl}
                  </div>


                  {/* Content based on type */}
                  <div className="dtb-bg-picker__content">
                    {bgType === "color" && (
                      <ColorSection
                        quickSettings={quickSettings}
                        onQuickSettingsChange={onQuickSettingsChange}
                        onBackgroundPresetChange={onBackgroundPresetChange}
                      />
                    )}
                    {bgType === "pattern" && (
                      <PatternTab
                        quickSettings={quickSettings}
                        onQuickSettingsChange={onQuickSettingsChange}
                        onBackgroundPresetChange={onBackgroundPresetChange}
                        limit={patternLimit}
                      />
                    )}
                    {bgType === "image" && (
                      <ImageTab
                        quickSettings={quickSettings}
                        onQuickSettingsChange={onQuickSettingsChange}
                        onBackgroundPresetChange={onBackgroundPresetChange}
                        limit={imageLimit}
                      />
                    )}
                    {bgType === "video" && (
                      <VideoTab
                        quickSettings={quickSettings}
                        onQuickSettingsChange={onQuickSettingsChange}
                        onBackgroundPresetChange={onBackgroundPresetChange}
                        limit={videoLimit}
                      />
                    )}
                    {bgType === "theme" && (
                      <ThemeSection
                        selectedThemeId={_selectedThemeId}
                        onThemeSelect={_onThemeSelect}
                        allowedCategories={_allowedCategories}
                        overlayMode={overlayMode}
                        area={dockAreaFromScope(storageScope)}
                      />
                    )}
                  </div>

                  {layerBackdropMode && bgType !== "off" && (
                    <LayerBackdropControls
                      quickSettings={quickSettings}
                      onQuickSettingsChange={onQuickSettingsChange}
                      onBackgroundPresetChange={onBackgroundPresetChange}
                    />
                  )}

                  {!layerBackdropMode && (bgType === "image" || bgType === "video" || bgType === "pattern") && (
                    <BackgroundAppearanceControls
                      quickSettings={quickSettings}
                      onQuickSettingsChange={onQuickSettingsChange}
                      onBackgroundPresetChange={onBackgroundPresetChange}
                    />
                  )}

                  {(storageScope === "bible" || storageScope === "worship" || storageScope === "notes") && (
                    <MotionSection
                      quickSettings={quickSettings}
                      onQuickSettingsChange={onQuickSettingsChange}
                    />
                  )}

                </>
              )}

              {/* Size tab for layer themes (replaces Text + Layout) */}
              {simpleLayerMode && layerTheme && (activeTab === "text" || activeTab === "layout") && (
                <LayoutThemeAdjustPanel
                  themeName={layerTheme.name}
                  layout={layerTheme.layout}
                  quickSettings={quickSettings}
                  onQuickSettingsChange={onQuickSettingsChange}
                  scope={storageScope}
                />
              )}

              {/* Text Tab */}
              {activeTab === "text" && !simpleLayerMode && (
                <>

                  {(

                    <>
                      {/* ── Bible Text Section ── */}
                      {/* Presets: TEXT_SHADOW_PRESETS TEXT_OUTLINE_OPTIONS */}
                      <div className="dtb-bg-picker__settings">

                        {isBiblePicker ? (
                          <div className="dtb-section-heading">{t('bgPicker.verse', 'Verse')}</div>
                        ) : (
                          <div>
                            <div className="dtb-section-title">{t('bgPicker.text')}</div>
                            <p className="dtb-compare-section__description">
                              {t('bgPicker.textSectionDescription', 'Style the main verse text people will read on screen.')}
                            </p>
                          </div>
                        )}
                        <div className="dtb-control-section">
                          <div className="dtb-control-section__head">
                            <span className="dtb-control-section__icon">
                              <Icon name="palette" size={14} />
                            </span>
                            <span className="dtb-control-section__title">{t('bgPicker.textAppearance', 'Text appearance')}</span>
                          </div>
                          <div className="dtb-control-section__body">
                            <div className="dtb-typography-control-row">
                              <ColorPickerCard
                                label={t('common.color')}
                                value={quickSettings.fontColor ?? "#ffffff"}
                                onChange={(v) => updateVerseStyle({ fontColor: v })}
                              />

                              <SliderNumberField
                                label={t('bgPicker.fontSize')}
                                value={quickSettings.fontSize}
                                min={overlayMode === "lower-third" ? LOWER_THIRD_FIT_MIN_FONT_SIZE : 16}
                                max={overlayMode === "lower-third" ? LOWER_THIRD_FONT_SIZE_MAX : 240}
                                step={1}
                                onChange={(value) => onQuickSettingsChange((prev) => ({
                                  ...prev,
                                  fontSize: value,
                                  compareVerseFontSizeLeft: value,
                                  compareVerseFontSizeRight: value,
                                  compareAutoFitMaxFontSize: value,
                                }))}
                              />
                            </div>

                            {/* Line Height beside Letter Spacing */}
                            <div className="dtb-typography-control-row">
                              <SliderNumberField
                                label={t('bgPicker.lineHeight')}
                                value={quickSettings.lineHeight}
                                min={1.05}
                                max={1.8}
                                step={0.01}
                                onChange={(value) => onQuickSettingsChange((prev) => ({ ...prev, lineHeight: value }))}
                              />

                              <SliderNumberField
                                label={t('bgPicker.letterSpacing', 'Letter Spacing')}
                                value={quickSettings.letterSpacing ?? 0}
                                min={-2}
                                max={20}
                                step={1}
                                unit="px"
                                onChange={(value) => updateVerseStyle({ letterSpacing: value })}
                              />
                            </div>

                            {/* Word Spacing */}
                            <div className="dtb-typography-control-row">
                              <SliderNumberField
                                label={t('bgPicker.wordSpacing', 'Word Spacing')}
                                value={quickSettings.wordSpacing ?? 0}
                                min={-5}
                                max={40}
                                step={1}
                                unit="px"
                                onChange={(value) => onQuickSettingsChange((prev) => ({ ...prev, wordSpacing: value }))}
                              />
                            </div>
                          </div>
                        </div>

                        <div className={`dtb-control-section dtb-collapsible${fontStyleOpen ? " dtb-collapsible--open" : ""}`}>
                          <button
                            type="button"
                            className="dtb-control-section__head dtb-collapsible__head"
                            aria-expanded={fontStyleOpen}
                            onClick={() => setFontStyleOpen((open) => !open)}
                          >
                            <span className="dtb-control-section__icon qs-text-icon">Aa</span>
                            <span className="dtb-control-section__title">{t('bgPicker.fontAndStyle', 'Font & Style')}</span>
                            {!fontStyleOpen && (
                              <span className="dtb-collapsible__summary">
                                {getWeightOptions(t).find((o) => o.value === (quickSettings.fontWeight ?? "black"))?.label ?? ""}
                                {" · "}
                                {getTextCaseOptions(t).find((o) => o.value === (quickSettings.textTransform ?? "none"))?.label ?? ""}
                              </span>
                            )}
                            <Icon name="expand_more" size={14} className="dtb-collapsible__chevron" />
                          </button>
                          {fontStyleOpen && (
                          <div className="dtb-control-section__body">
                            <div className="dtb-typography-control-row dtb-typography-control-row--selects">
                              <CompactSelectField<CompactFontWeight>
                                label={t('bgPicker.weight')}
                                // The output's default weight is Black (900); show that when unset.
                                value={(quickSettings.fontWeight ?? "black") as CompactFontWeight}
                                options={getWeightOptions(t)}
                                onChange={(w) => updateVerseStyle({ fontWeight: w })}
                              />

                              <CompactSelectField<CompactTextCase>
                                label={t('bgPicker.textCase')}
                                value={(quickSettings.textTransform ?? "none") as CompactTextCase}
                                options={getTextCaseOptions(t)}
                                onChange={(tc) => updateVerseStyle({ textTransform: tc })}
                              />
                            </div>
                          </div>
                          )}
                        </div>

                        {/* Canva-style Text Effects */}
                        <TextEffectsPicker
                          settings={quickSettings}
                          onChange={onQuickSettingsChange}
                          target={isBiblePicker ? "all" : "verse"}
                        />
                      </div>
                    </>
                  )}



                  {/* ── Reference Section ── */}
                  {showReferences && (
                    <ReferenceSection
                      styleLinked={isBiblePicker ? referenceStyleLinked : undefined}
                      onStyleLinkedChange={isBiblePicker ? handleReferenceStyleLinkedChange : undefined}
                      quickSettings={quickSettings}
                      onQuickSettingsChange={onQuickSettingsChange}
                      overlayMode={overlayMode}
                      sampleReference={_sampleReference}
                      referenceFormat={referenceFormat}
                      referenceVersionVisible={referenceVersionVisible}
                      referenceTranslation={referenceTranslation}
                      onReferenceFormatChange={onReferenceFormatChange}
                      onReferenceVersionVisibleChange={onReferenceVersionVisibleChange}
                    />
                  )}

                  {/* ── Lower Third Sizes (only relevant in lower-third mode) ── */}

                </>
              )}

              {/* Layout Tab */}
              {activeTab === "layout" && !simpleLayerMode && (
                <>
                  {(
                    <>
                      <div className="dtb-bg-picker__settings">
                        {!isBiblePicker && (
                          <div>
                            <div className="dtb-section-title">{t('bgPicker.text')}</div>
                            <p className="dtb-compare-section__description">
                              {t('bgPicker.textLayoutDescription', 'Control text alignment, lower-third placement, and spacing on screen.')}
                            </p>
                          </div>
                        )}
                        <div className="dtb-control-section">
                          <div className="dtb-control-section__head">
                            <span className="dtb-control-section__title">{t('bgPicker.layout', 'Layout')}</span>
                          </div>
                          <div className="dtb-control-section__body">
                            <IconSegmentedControl<CompactTextAlign>
                              label={t('bgPicker.alignment')}
                              description={t('bgPicker.alignmentDesc', 'Set text alignment')}
                              value={(quickSettings.textAlign ?? "center") as CompactTextAlign}
                              options={getAlignmentOptions(t)}
                              onChange={(a) => onQuickSettingsChange((prev) => ({ ...prev, textAlign: a as "left" | "center" | "right" }))}
                            />

                            {overlayMode === "lower-third" && supportsLowerThirdShapeControls && (
                              <div className="dtb-control-subsection">
                                <div className="dtb-font-weight-row">
                                  <div className="dtb-setting-info">
                                    <span className="dtb-position-label">{t('bgPicker.lowerThirdBar', 'Lower-third bar')}</span>
                                    <span className="dtb-setting-description">{t('bgPicker.lowerThirdPlacement', 'Where the bar appears on screen')}</span>
                                  </div>
                                  <div className="dtb-setting-control">
                                    <select
                                      className="dtb-select-control"
                                      value={quickSettings.lowerThirdEdge ?? "bottom"}
                                      onChange={(e) => {
                                        const edge = e.target.value as "bottom" | "top" | "left" | "right";
                                        onQuickSettingsChange((prev) => ({ ...prev, lowerThirdEdge: edge }));
                                      }}
                                      aria-label={t('bgPicker.lowerThirdBar', 'Lower-third bar')}
                                    >
                                      {([
                                        { value: "bottom", label: t('bgPicker.edgeBottom', 'Bottom') },
                                        { value: "top", label: t('bgPicker.edgeTop', 'Top') },
                                        { value: "left", label: t('common.left', 'Left') },
                                        { value: "right", label: t('common.right', 'Right') },
                                      ] as const).map(({ value, label }) => (
                                        <option key={value} value={value}>{label}</option>
                                      ))}
                                    </select>
                                    <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
                                  </div>
                                </div>

                                {(() => {
                                  const currentWidth = quickSettings.lowerThirdWidthPreset ?? "full";
                                  const normalizedWidth = currentWidth === "xxl" ? "xl" : currentWidth === "lg" ? "md" : currentWidth;
                                  return (
                                    <div className="dtb-font-weight-row">
                                      <div className="dtb-setting-info">
                                        <span className="dtb-position-label">{t('bgPicker.lowerThirdWidth', 'Bar width')}</span>
                                        <span className="dtb-setting-description">{t('bgPicker.lowerThirdWidthDesc', 'Adjust the width of the bar')}</span>
                                      </div>
                                      <div className="dtb-setting-control">
                                        <select
                                          className="dtb-select-control"
                                          value={normalizedWidth}
                                          onChange={(e) => {
                                            const value = e.target.value as "full" | "xl" | "md" | "sm";
                                            onQuickSettingsChange((prev) => ({ ...prev, lowerThirdWidthPreset: value }));
                                          }}
                                          aria-label={t('bgPicker.lowerThirdWidth', 'Bar width')}
                                        >
                                          {([
                                            { value: "full", label: t('bgPicker.widthFull', 'Full Width') },
                                            { value: "xl", label: t('bgPicker.widthWide', 'Wide') },
                                            { value: "md", label: t('bgPicker.widthCard', 'Card') },
                                            { value: "sm", label: t('bgPicker.widthCompact', 'Compact') },
                                          ] as const).map(({ value, label }) => (
                                            <option key={value} value={value}>{label}</option>
                                          ))}
                                        </select>
                                        <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
                                      </div>
                                    </div>
                                  );
                                })()}

                                {(() => {
                                  const currentPos = quickSettings.lowerThirdPosition ?? "center";
                                  return (
                                    <div className="dtb-font-weight-row">
                                      <div className="dtb-setting-info">
                                        <span className="dtb-position-label">{t('bgPicker.cardPosition', 'Card position')}</span>
                                        <span className="dtb-setting-description">{t('bgPicker.cardPositionDesc', 'Position of the content card')}</span>
                                      </div>
                                      <div className="dtb-setting-control">
                                        <select
                                          className="dtb-select-control"
                                          value={currentPos}
                                          onChange={(e) => {
                                            const value = e.target.value as "left" | "center" | "right";
                                            onQuickSettingsChange((prev) => {
                                              const nextPatch: Partial<DockFullscreenQuickThemeSettings> = {
                                                lowerThirdPosition: value,
                                              };
                                              if (prev.lowerThirdWidthPreset === "full" && (value === "left" || value === "right")) {
                                                nextPatch.lowerThirdWidthPreset = "xl";
                                              }
                                              return { ...prev, ...nextPatch };
                                            });
                                          }}
                                          aria-label={t('bgPicker.cardPosition', 'Card position')}
                                        >
                                          {([
                                            { value: "left", label: t('common.left', 'Left') },
                                            { value: "center", label: t('bgPicker.positionCenter', 'Center') },
                                            { value: "right", label: t('common.right', 'Right') },
                                          ] as const).map(({ value, label }) => (
                                            <option key={value} value={value}>{label}</option>
                                          ))}
                                        </select>
                                        <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>

                        {overlayMode === "lower-third" && (
                          <div className="dtb-control-section">
                            <div className="dtb-control-section__body">
                              <div className="dtb-toggle-field dtb-toggle-field--inline">
                                <div className="dtb-toggle-field__copy">
                                  <span className="dtb-toggle-field__label">{t('bgPicker.linkTextPadding', 'Control both padding values')}</span>
                                </div>
                                <button
                                  type="button"
                                  className={`dtb-toggle${lowerThirdPaddingLinked ? " dtb-toggle--on" : ""}`}
                                  onClick={() => onQuickSettingsChange((prev) => {
                                    const currentPadding = parseLowerThirdPadding(prev.lowerThirdCardPadding);
                                    const linkedPadding = Math.round((currentPadding.vertical + currentPadding.horizontal) / 2);
                                    return {
                                      ...prev,
                                      lowerThirdPaddingLinked: !prev.lowerThirdPaddingLinked,
                                      lowerThirdCardPadding: !prev.lowerThirdPaddingLinked
                                        ? formatLowerThirdPadding(linkedPadding, linkedPadding)
                                        : prev.lowerThirdCardPadding,
                                    };
                                  })}
                                  role="switch"
                                  aria-checked={lowerThirdPaddingLinked}
                                  aria-label={t('bgPicker.linkTextPadding', 'Control both padding values')}
                                >
                                  <span className="dtb-toggle__knob" />
                                </button>
                              </div>

                              {lowerThirdPaddingLinked ? (
                                <div className="dtb-slider-field">
                                  <div className="dtb-slider-field__head">
                                    <span>{t('bgPicker.textPadding', 'Text padding')}</span>
                                    <span className="dtb-slider-field__value">{lowerThirdLinkedPadding}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    className="dtb-slider"
                                    min={0}
                                    max={LOWER_THIRD_TEXT_PADDING_MAX}
                                    step={2}
                                    value={lowerThirdLinkedPadding}
                                    onChange={(e) => {
                                      const nextPadding = Number(e.target.value);
                                      onQuickSettingsChange((prev) => ({
                                        ...prev,
                                        lowerThirdPaddingLinked: true,
                                        lowerThirdCardPadding: formatLowerThirdPadding(nextPadding, nextPadding),
                                      }));
                                    }}
                                    aria-label={t('bgPicker.textPadding', 'Text padding')}
                                  />
                                </div>
                              ) : (
                                <>
                                  <div className="dtb-slider-field">
                                    <div className="dtb-slider-field__head">
                                      <span>{t('bgPicker.verticalTextPadding', 'Vertical text padding')}</span>
                                      <span className="dtb-slider-field__value">{Math.round(lowerThirdPadding.vertical)}px</span>
                                    </div>
                                    <input
                                      type="range"
                                      className="dtb-slider"
                                      min={0}
                                      max={LOWER_THIRD_TEXT_PADDING_MAX}
                                      step={2}
                                      value={lowerThirdPadding.vertical}
                                      onChange={(e) => {
                                        const nextVertical = Number(e.target.value);
                                        onQuickSettingsChange((prev) => {
                                          const currentPadding = parseLowerThirdPadding(prev.lowerThirdCardPadding);
                                          return {
                                            ...prev,
                                            lowerThirdPaddingLinked: false,
                                            lowerThirdCardPadding: formatLowerThirdPadding(nextVertical, currentPadding.horizontal),
                                          };
                                        });
                                      }}
                                      aria-label={t('bgPicker.verticalTextPadding', 'Vertical text padding')}
                                    />
                                  </div>

                                  <div className="dtb-slider-field">
                                    <div className="dtb-slider-field__head">
                                      <span>{t('bgPicker.horizontalTextPadding', 'Horizontal text padding')}</span>
                                      <span className="dtb-slider-field__value">{Math.round(lowerThirdPadding.horizontal)}px</span>
                                    </div>
                                    <input
                                      type="range"
                                      className="dtb-slider"
                                      min={0}
                                      max={LOWER_THIRD_TEXT_PADDING_MAX}
                                      step={2}
                                      value={lowerThirdPadding.horizontal}
                                      onChange={(e) => {
                                        const nextHorizontal = Number(e.target.value);
                                        onQuickSettingsChange((prev) => {
                                          const currentPadding = parseLowerThirdPadding(prev.lowerThirdCardPadding);
                                          return {
                                            ...prev,
                                            lowerThirdPaddingLinked: false,
                                            lowerThirdCardPadding: formatLowerThirdPadding(currentPadding.vertical, nextHorizontal),
                                          };
                                        });
                                      }}
                                      aria-label={t('bgPicker.horizontalTextPadding', 'Horizontal text padding')}
                                    />
                                  </div>
                                </>
                              )}

                              {supportsLowerThirdShapeControls && (
                                <div className="dtb-slider-field">
                                  <div className="dtb-slider-field__head">
                                    <span>{t('bgPicker.cornerRadius', 'Corner radius')}</span>
                                    <span className="dtb-slider-field__value">{Math.round(lowerThirdCardRadius)}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    className="dtb-slider"
                                    min={0}
                                    max={64}
                                    step={1}
                                    value={lowerThirdCardRadius}
                                    onChange={(e) => onQuickSettingsChange((prev) => ({ ...prev, lowerThirdCardRadius: Number(e.target.value) }))}
                                    aria-label={t('bgPicker.cornerRadius', 'Corner radius')}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {showReferences && isBiblePicker && (
                    <div className="dtb-section-heading">{t('bgPicker.reference', 'Reference')}</div>
                  )}
                  {showReferences && (
                    <ReferenceLayoutSection
                      quickSettings={quickSettings}
                      onQuickSettingsChange={onQuickSettingsChange}
                    />
                  )}
                </>
              )}

              {/* Compare Tab */}
              {displayMode === "compare" && activeTab === "compare" && (
                <CompareSettingsPanel
                  quickSettings={quickSettings}
                  onQuickSettingsChange={onQuickSettingsChange}
                  compareBackdropValue={compareBackdropValue}
                  onBackdropChange={handleTypeChange}
                  onBackgroundPresetChange={onBackgroundPresetChange}
                  selectedThemeId={_selectedThemeId}
                  onThemeSelect={_onThemeSelect}
                  allowedCategories={_allowedCategories}
                  overlayMode={overlayMode}
                  imageLimit={imageLimit}
                  videoLimit={videoLimit}
                  patternLimit={patternLimit}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function dedupeBackgroundMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items
    .slice()
    .sort(compareMediaItemsNewest)
    .filter((item) => {
      const key = getMediaStableKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ── Image Tab ── */
function ImageTab({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
  limit,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  limit: number;
}) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMedia = async () => {
      setLoading(true);
      try {
        let indexedDbItems: MediaItem[] = [];
        try {
          const { getAllMedia } = await import("../../library/libraryDb");
          const all = await getAllMedia();
          if (Array.isArray(all)) indexedDbItems = all;
        } catch { /* ignore */ }

        let localItems: MediaItem[] = [];
        try {
          const { loadLocalLibrary } = await import("../dockUploadService");
          localItems = loadLocalLibrary();
        } catch { /* ignore */ }

        let jsonItems: MediaItem[] = [];
        if (indexedDbItems.length === 0 && localItems.length === 0) {
          try {
            const res = await fetch("/uploads/dock-media-library.json");
            if (res.ok) {
              const all = await res.json();
              if (Array.isArray(all)) jsonItems = all;
            }
          } catch { /* ignore */ }
        }

        if (!cancelled) {
          const combined = dedupeBackgroundMediaItems([
            ...indexedDbItems,
            ...localItems,
            ...jsonItems,
          ].filter((item) => !isInternalDockMediaItem(item)));
          setMedia(combined.filter((m) => m.type === "image"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadMedia();

    const handleUpdate = () => {
      void loadMedia();
    };

    const unsubscribe = dockClient.onState((message) => {
      if (message.type === "state:media-data" || message.type === "state:library-updated") {
        void loadMedia();
      }
    });

    window.addEventListener("mce-media-library-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("mce-media-library-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const filtered = useMemo(() => {
    const availableMedia = limitBackgroundPickerAssets(media, limit);
    const q = search.toLowerCase().trim();
    if (!q) return availableMedia;
    return availableMedia.filter((m) => m.name.toLowerCase().includes(q));
  }, [limit, media, search]);

  const selectedUrl = quickSettings.backgroundImage;

  const handleSelect = useCallback((item: MediaItem) => {
    const relUrl = toBackgroundAssetUrl(item);
    onQuickSettingsChange((prev) => ({
      ...prev,
      backgroundType: "image",
      backgroundImage: prev.backgroundImage === relUrl ? "" : relUrl,
      backgroundImageFilePath: prev.backgroundImage === relUrl ? "" : (item.filePath || ""),
      backgroundVideo: "",
      backgroundVideoFilePath: "",
    }));
    onBackgroundPresetChange?.("theme");
  }, [onBackgroundPresetChange, onQuickSettingsChange]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    let currentCount = media.length;
    for (const file of Array.from(files)) {
      if (!canAddBackgroundPickerAsset(currentCount, limit)) break;
      if (!file.type.startsWith("image/")) continue;
      try {
        const { uploadFileToDock } = await import("../dockUploadService");
        const result = await uploadFileToDock(file);
        if (result.item) {
          const { registerDockMediaItem } = await import("../dockUploadService");
          await registerDockMediaItem(result.item);
          setMedia((prev) => [result.item!, ...prev]);
          currentCount += 1;
          const relUrl = toBackgroundAssetUrl(result.item);
          onQuickSettingsChange((prev) => ({
            ...prev,
            backgroundType: "image",
            backgroundImage: relUrl,
            backgroundImageFilePath: result.item.filePath || "",
            backgroundVideo: "",
            backgroundVideoFilePath: "",
          }));
          onBackgroundPresetChange?.("theme");
        }
      } catch (err) {
        console.warn("[BackgroundPicker] Upload failed:", err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [limit, media.length, onBackgroundPresetChange, onQuickSettingsChange]);

  const canUpload = canAddBackgroundPickerAsset(media.length, limit);

  return (
    <div className="dtb-bg-picker__tab-content">
      <div className="dtb-bg-picker__toolbar">
        <div className="dtb-bg-picker__search">
          <Icon name="search" size={13} className="dtb-bg-picker__search-icon" />
          <input
            type="text"
            className="dtb-bg-picker__search-input"
            placeholder={t('bgPicker.searchImages')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="dtb-bg-picker__search-clear"
              onClick={() => setSearch("")}
              aria-label={t('bgPicker.clearSearch')}
              title={t('common.close')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        {Number.isFinite(limit) && limit >= 0 && (
          <span className="dtb-bg-picker__limit-count" aria-label={`${media.length} of ${limit} images`}>
            {media.length}/{limit}
          </span>
        )}
        <button
          type="button"
          className="dtb-bg-picker__upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || !canUpload}
          title={t('common.upload')}>
          <Icon name="add_photo_alternate" size={13} />
          {t('common.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={loading || !canUpload}
          className="dtb-bg-picker__file-input"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {loading ? (
        <div className="dtb-bg-picker__empty">
          <span>{t('bgPicker.loadingImages')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dtb-bg-picker__empty">
          <Icon name="image" size={20} />
          <span>{search ? t('bgPicker.noImagesMatch') : t('bgPicker.noImagesUploaded')}</span>
        </div>
      ) : (
        <div className="dtb-bg-picker__grid dtb-bg-picker__asset-grid">
          {filtered.map((item) => {
            const relUrl = toBackgroundAssetUrl(item);
            const isSelected = selectedUrl === relUrl;
            return (
              <button
                key={item.id}
                type="button"
                className={`dtb-bg-picker__card${isSelected ? " dtb-bg-picker__card--selected" : ""}`}
                onClick={() => handleSelect(item)}
                title={item.name}
              >
                <div className="dtb-bg-picker__thumb">
                  <img
                    src={item.thumbnailUrl || relUrl}
                    alt=""
                    className="dtb-bg-picker__thumb-media"
                    loading="lazy"
                  />
                </div>
                <div className="dtb-bg-picker__card-info">
                  <span className="dtb-bg-picker__card-name">{item.name}</span>
                </div>
                {isSelected && (
                  <div className="dtb-bg-picker__card-check">
                    <Icon name="check" size={14} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Video Tab ── */
function VideoTab({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
  limit,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  limit: number;
}) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMedia = async () => {
      setLoading(true);
      try {
        let indexedDbItems: MediaItem[] = [];
        try {
          const { getAllMedia } = await import("../../library/libraryDb");
          const all = await getAllMedia();
          if (Array.isArray(all)) indexedDbItems = all;
        } catch { /* ignore */ }

        let localItems: MediaItem[] = [];
        try {
          const { loadLocalLibrary } = await import("../dockUploadService");
          localItems = loadLocalLibrary();
        } catch { /* ignore */ }

        let jsonItems: MediaItem[] = [];
        if (indexedDbItems.length === 0 && localItems.length === 0) {
          try {
            const res = await fetch("/uploads/dock-media-library.json");
            if (res.ok) {
              const all = await res.json();
              if (Array.isArray(all)) jsonItems = all;
            }
          } catch { /* ignore */ }
        }

        if (!cancelled) {
          const combined = dedupeBackgroundMediaItems([
            ...indexedDbItems,
            ...localItems,
            ...jsonItems,
          ].filter((item) => !isInternalDockMediaItem(item)));
          setMedia(combined.filter((m) => m.type === "video"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadMedia();

    const handleUpdate = () => {
      void loadMedia();
    };

    const unsubscribe = dockClient.onState((message) => {
      if (message.type === "state:media-data" || message.type === "state:library-updated") {
        void loadMedia();
      }
    });

    window.addEventListener("mce-media-library-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("mce-media-library-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const filtered = useMemo(() => {
    const availableMedia = limitBackgroundPickerAssets(media, limit);
    const q = search.toLowerCase().trim();
    if (!q) return availableMedia;
    return availableMedia.filter((m) => m.name.toLowerCase().includes(q));
  }, [limit, media, search]);

  const selectedUrl = quickSettings.backgroundVideo;

  const handleSelect = useCallback((item: MediaItem) => {
    const relUrl = toBackgroundAssetUrl(item);
    onQuickSettingsChange((prev) => ({
      ...prev,
      backgroundType: "video",
      backgroundVideo: prev.backgroundVideo === relUrl ? "" : relUrl,
      backgroundVideoFilePath: prev.backgroundVideo === relUrl ? "" : (item.filePath || ""),
      backgroundImage: "",
      backgroundImageFilePath: "",
    }));
    onBackgroundPresetChange?.("theme");
  }, [onBackgroundPresetChange, onQuickSettingsChange]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    let currentCount = media.length;
    for (const file of Array.from(files)) {
      if (!canAddBackgroundPickerAsset(currentCount, limit)) break;
      if (!file.type.startsWith("video/")) continue;
      try {
        const { uploadFileToDock } = await import("../dockUploadService");
        const result = await uploadFileToDock(file);
        if (result.item) {
          const { registerDockMediaItem } = await import("../dockUploadService");
          await registerDockMediaItem(result.item);
          setMedia((prev) => [result.item!, ...prev]);
          currentCount += 1;
          const relUrl = toBackgroundAssetUrl(result.item);
          onQuickSettingsChange((prev) => ({
            ...prev,
            backgroundType: "video",
            backgroundVideo: relUrl,
            backgroundVideoFilePath: result.item.filePath || "",
            backgroundImage: "",
            backgroundImageFilePath: "",
          }));
          onBackgroundPresetChange?.("theme");
        }
      } catch (err) {
        console.warn("[BackgroundPicker] Upload failed:", err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [limit, media.length, onBackgroundPresetChange, onQuickSettingsChange]);

  const canUpload = canAddBackgroundPickerAsset(media.length, limit);

  return (
    <div className="dtb-bg-picker__tab-content">
      <div className="dtb-bg-picker__toolbar">
        <div className="dtb-bg-picker__search">
          <Icon name="search" size={13} className="dtb-bg-picker__search-icon" />
          <input
            type="text"
            className="dtb-bg-picker__search-input"
            placeholder={t('bgPicker.searchVideos')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="dtb-bg-picker__search-clear"
              onClick={() => setSearch("")}
              aria-label={t('bgPicker.clearSearch')}
              title={t('common.close')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        {Number.isFinite(limit) && limit >= 0 && (
          <span className="dtb-bg-picker__limit-count" aria-label={`${media.length} of ${limit} videos`}>
            {media.length}/{limit}
          </span>
        )}
        <button
          type="button"
          className="dtb-bg-picker__upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || !canUpload}
          title={t('common.upload')}>
          <Icon name="videocam" size={13} />
          {t('common.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          disabled={loading || !canUpload}
          className="dtb-bg-picker__file-input"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {loading ? (
        <div className="dtb-bg-picker__empty">
          <span>{t('bgPicker.loadingVideos')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dtb-bg-picker__empty">
          <Icon name="videocam" size={20} />
          <span>{search ? t('bgPicker.noVideosMatch') : t('bgPicker.noVideosUploaded')}</span>
        </div>
      ) : (
        <div className="dtb-bg-picker__grid dtb-bg-picker__asset-grid">
          {filtered.map((item) => {
            const relUrl = toBackgroundAssetUrl(item);
            const isSelected = selectedUrl === relUrl;
            const hasValidThumb = Boolean(
              item.thumbnailUrl &&
              (item.thumbnailUrl.startsWith("data:") || item.thumbnailUrl.startsWith("http") || item.thumbnailUrl.startsWith("/uploads/"))
            );
            return (
              <button
                key={item.id}
                type="button"
                className={`dtb-bg-picker__card${isSelected ? " dtb-bg-picker__card--selected" : ""}`}
                onClick={() => handleSelect(item)}
                title={item.name}
              >
                <div className="dtb-bg-picker__thumb dtb-bg-picker__thumb--video">
                  {hasValidThumb ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="dtb-bg-picker__thumb-media"
                      loading="lazy"
                    />
                  ) : (
                    <video
                      src={`${relUrl}#t=0.5`}
                      className="dtb-bg-picker__thumb-media"
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        try {
                          const v = e.target as HTMLVideoElement;
                          if (v.duration && v.duration > 0.5) v.currentTime = 0.5;
                        } catch { /* ignore */ }
                      }}
                    />
                  )}
                  <div className="dtb-bg-picker__play-icon">
                    <Icon name="play_arrow" size={18} />
                  </div>
                  {item.durationSec != null && (
                    <span className="dtb-bg-picker__duration">{formatDuration(item.durationSec)}</span>
                  )}
                </div>
                <div className="dtb-bg-picker__card-info">
                  <span className="dtb-bg-picker__card-name">{item.name}</span>
                  {item.fileSize != null && (
                    <span className="dtb-bg-picker__card-meta">{formatFileSize(item.fileSize)}</span>
                  )}
                </div>
                {isSelected && (
                  <div className="dtb-bg-picker__card-check">
                    <Icon name="check" size={14} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Pattern Tab — SVG patterns from shared backgroundAssets ── */

interface PatternOption {
  id: string;
  label: string;
  /** SVG data URI — used for both preview and overlay rendering */
  src: string;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Shared SVG patterns from backgroundAssets.ts — single source of truth */
export const PATTERN_OPTIONS: PatternOption[] = BACKGROUND_PATTERNS.map((p) => ({
  id: slugify(p.label),
  label: p.label,
  src: p.src,
}));

function PatternTab({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
  limit,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  limit: number;
}) {
  const { t } = useTranslation();
  const currentPattern = quickSettings.backgroundPattern || "";
  const isLimited = limit > 0 && limit < PATTERN_OPTIONS.length;

  const selectPattern = useCallback((src: string) => {
    onQuickSettingsChange((prev) => ({
      ...prev,
      backgroundType: "pattern",
      backgroundPattern: src,
      backgroundColor: "",
      backgroundColorEnd: "",
      bgGradientAngle: 180,
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundImage: "",
      backgroundImageFilePath: "",
    }));
    onBackgroundPresetChange?.("theme");
  }, [onBackgroundPresetChange, onQuickSettingsChange]);

  return (
    <div className="dtb-pattern-tab">
      <p className="dtb-bg-picker__sub-heading">{t('bgPicker.selectPattern')}</p>
      <div className="dtb-pattern-grid">
        {limitBackgroundPickerAssets(PATTERN_OPTIONS, limit).map((opt) => {
          const isSelected = currentPattern === opt.src;
          return (
            <button
              key={opt.id}
              type="button"
              className={`dtb-pattern-swatch${isSelected ? " dtb-pattern-swatch--selected" : ""}`}
              onClick={() => selectPattern(opt.src)}
              title={opt.label}
            >
              <div className="dtb-pattern-swatch__preview">
                <img src={opt.src} alt={opt.label} className="dtb-pattern-swatch__img" />
              </div>
              <span className="dtb-pattern-swatch__label">{opt.label}</span>
              {isSelected && (
                <div className="dtb-bg-picker__card-check">
                  <Icon name="check" size={14} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {isLimited && (
        <button
          type="button"
          className="dtb-pattern-upgrade-pill"
          onClick={() => showUpgradeModal(t('upgrade.patternsMessage', 'Upgrade to unlock all 30 background patterns.'))}
        >
          <Icon name="lock" size={12} />
          <span>{t('upgrade.unlockAllPatterns', `Upgrade to unlock all ${PATTERN_OPTIONS.length} patterns`)}</span>
        </button>
      )}
    </div>
  );
}

const MOTION_OPTIONS: Array<{ value: NonNullable<DockFullscreenQuickThemeSettings["animation"]>; label: string }> = [
  { value: "none", label: "Off" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "scale-in", label: "Scale in" },
  { value: "reveal-bg-then-text", label: "Reveal background + text" },
];

function MotionSection({
  quickSettings,
  onQuickSettingsChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
}) {
  const { t } = useTranslation();
  const animation = quickSettings.animation ?? "fade";
  const animationEnabled = animation !== "none";
  const duration = Math.min(1500, Math.max(100, Number(quickSettings.animationDuration) || 400));

  return (
    <section className="dtb-bg-picker__motion-section" aria-labelledby="dtb-motion-title">
      <div className="dtb-bg-picker__motion-header">
        <div>
          <div id="dtb-motion-title" className="dtb-bg-picker__motion-title">
            {t("bgPicker.motion", "Motion")}
          </div>
        </div>
        <select
          className="dtb-bg-picker__motion-select"
          value={animation}
          onChange={(event) => onQuickSettingsChange((prev) => ({
            ...prev,
            animation: event.target.value as NonNullable<DockFullscreenQuickThemeSettings["animation"]>,
          }))}
          aria-label={t("bgPicker.motion", "Motion")}
        >
          {MOTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {animationEnabled && (
        <div className="dtb-bg-picker__motion-duration">
          <div className="dtb-slider-field__head">
            <span>{t("bgPicker.duration", "Duration")}</span>
            <span className="dtb-slider-field__value">{duration} ms</span>
          </div>
          <input
            type="range"
            className="dtb-slider dtb-slider--filled"
            min={100}
            max={1500}
            step={10}
            value={duration}
            style={sliderProgress(duration, 100, 1500)}
            onChange={(event) => onQuickSettingsChange((prev) => ({
              ...prev,
              animationDuration: Number(event.target.value),
            }))}
            aria-label={t("bgPicker.duration", "Duration")}
            aria-valuetext={`${duration} milliseconds`}
          />
        </div>
      )}
    </section>
  );
}

/* ── Color Section — ThemeModalStitch layout, MakeChurchEazy skin ── */
function ColorSection({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
}) {
  const { t } = useTranslation();
  const [presetsCollapsed, setPresetsCollapsed] = useState(false);
  const isGradient = !!(quickSettings.backgroundColor && quickSettings.backgroundColorEnd);
  const colorStart = quickSettings.backgroundColor || "#0F172A";
  const colorEnd = quickSettings.backgroundColorEnd || "#000000";
  const angle = quickSettings.bgGradientAngle ?? 135;

  const pushChange = useCallback(
    (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => {
      onQuickSettingsChange((prev) => {
        const next = updater(prev);
        return {
          ...next,
          backgroundType: "color",
          backgroundImage: "",
          backgroundImageFilePath: "",
          backgroundVideo: "",
          backgroundVideoFilePath: "",
        };
      });
      onBackgroundPresetChange?.("theme");
    },
    [onBackgroundPresetChange, onQuickSettingsChange],
  );

  return (
    <div className="dtb-bg-picker__tab-content dtb-colors">
      {/* Solid / Gradient segmented toggle */}
      <div className="dtb-colors__section">
        <div className="dtb-color-mode-toggle">
          <button
            type="button"
            className={`dtb-color-mode-toggle__btn${!isGradient ? " dtb-color-mode-toggle__btn--active" : ""}`}
            onClick={() => {
              pushChange((prev) => ({
                ...prev,
                backgroundColor: prev.backgroundColor || "#0F172A",
                backgroundColorEnd: "",
                bgGradientAngle: 135,
              }));
            }}
            title={t('bgPicker.solid')}>
            <Icon name="stop" size={13} />
            {t('bgPicker.solid')}
          </button>
          <button
            type="button"
            className={`dtb-color-mode-toggle__btn${isGradient ? " dtb-color-mode-toggle__btn--active" : ""}`}
            onClick={() => {
              pushChange((prev) => ({
                ...prev,
                backgroundColor: prev.backgroundColor || "#AD0000",
                backgroundColorEnd: prev.backgroundColorEnd || "#000000",
                bgGradientAngle: prev.bgGradientAngle || 135,
              }));
            }}
            title={t('bgPicker.gradient')}>
            <Icon name="palette" size={13} />
            {t('bgPicker.gradient')}
          </button>
        </div>
      </div>

      {/* ── Solid mode: color swatch ── */}
      {!isGradient && (
        <div className="dtb-colors__section">
          <span className="dtb-colors__label">{t('common.color')}</span>
          <InlineColorPicker
            value={colorStart}
            onChange={(v) => pushChange((prev) => ({ ...prev, backgroundColor: v }))}
          />
        </div>
      )}

      {/* ── Gradient mode: preview + start/end + angle + presets ── */}
      {isGradient && (
        <>
          {/* Live gradient preview strip */}
          <div className="dtb-colors__section">
            <div
              className="dtb-gradient-preview"
              style={{
                width: "100%",
                height: 56,
                borderRadius: 4,
                background: `linear-gradient(${angle}deg, ${colorStart}, ${colorEnd})`,
              }}
            />
          </div>

          {/* Start + End color pickers */}
          <div className="dtb-colors__section">
            <div className="dtb-gradient-colors-row">
              <div className="dtb-gradient-colors-row__item">
                <span className="dtb-colors__label">{t('bgPicker.start')}</span>
                <InlineColorPicker
                  value={colorStart}
                  onChange={(v) => pushChange((prev) => ({ ...prev, backgroundColor: v }))}
                />
              </div>
              <div className="dtb-gradient-colors-row__item">
                <span className="dtb-colors__label">{t('bgPicker.end')}</span>
                <InlineColorPicker
                  value={colorEnd}
                  onChange={(v) => pushChange((prev) => ({ ...prev, backgroundColorEnd: v }))}
                />
              </div>
            </div>
          </div>

          {/* Angle control */}
          <div className="dtb-colors__section">
            <div className="dtb-slider-field">
              <div className="dtb-slider-field__head">
                <span>{t('bgPicker.angle')}</span>
                <span className="dtb-slider-field__value">{angle}°</span>
              </div>
              <input
                type="range"
                className="dtb-slider"
                min={0}
                max={360}
                step={1}
                value={angle}
                onChange={(e) =>
                  pushChange((prev) => ({
                    ...prev,
                    bgGradientAngle: Number(e.target.value),
                  }))
                }
                aria-label={t('bgPicker.angle')}
              />
            </div>
          </div>

          {/* Gradient presets */}
          <div className="dtb-colors__section">
            <button
              type="button"
              className="dtb-studio-card__header"
              onClick={() => setPresetsCollapsed((v) => !v)}
            >
              <span className="dtb-studio-card__title">{t('bgPicker.gradientPresets')}</span>
              <Icon
                name={presetsCollapsed ? "expand_more" : "expand_less"}
                size={14}
                className="dtb-studio-card__chevron"
              />
            </button>
            {!presetsCollapsed && (
              <div className="dtb-gradient-presets">
                {GRADIENT_PRESETS.map((preset) => {
                  const active =
                    colorStart === preset.start &&
                    colorEnd === preset.end &&
                    angle === preset.angle;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`dtb-gradient-preset${active ? " dtb-gradient-preset--active" : ""}`}
                      onClick={() =>
                        pushChange((prev) => ({
                          ...prev,
                          backgroundColor: preset.start,
                          backgroundColorEnd: preset.end,
                          bgGradientAngle: preset.angle,
                        }))
                      }
                      title={preset.label}
                    >
                      <div
                        className="dtb-gradient-preset__swatch"
                        style={{
                          background: `linear-gradient(${preset.angle}deg, ${preset.start}, ${preset.end})`,
                        }}
                      />
                      <span className="dtb-gradient-preset__label">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Darkness slider (shared) ── */}
      <div className="dtb-colors__section">
        <div className="dtb-slider-field">
          <div className="dtb-slider-field__head">
            <span>{t('bgPicker.darkness')}</span>
            <span className="dtb-slider-field__value">
              {Math.round(quickSettings.fullscreenShadeOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            className="dtb-slider dtb-slider--filled"
            min={0}
            max={100}
            step={1}
            value={Math.round(quickSettings.fullscreenShadeOpacity * 100)}
            style={sliderProgress(quickSettings.fullscreenShadeOpacity * 100, 0, 100)}
            onChange={(e) =>
              pushChange((prev) => ({
                ...prev,
                fullscreenShadeOpacity: Number(e.target.value) / 100,
              }))
            }
            aria-label={t('bgPicker.darkness')}
            aria-valuetext={`${Math.round(quickSettings.fullscreenShadeOpacity * 100)} percent`}
          />
        </div>
      </div>

      {/* ── Opacity slider (shared) ── */}
      <div className="dtb-colors__section">
        <div className="dtb-slider-field">
          <div className="dtb-slider-field__head">
            <span>{t('bgPicker.opacity')}</span>
            <span className="dtb-slider-field__value">
              {Math.round(quickSettings.backgroundOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            className="dtb-slider dtb-slider--filled"
            min={0}
            max={100}
            step={1}
            value={Math.round(quickSettings.backgroundOpacity * 100)}
            style={sliderProgress(quickSettings.backgroundOpacity * 100, 0, 100)}
            onChange={(e) =>
              pushChange((prev) => ({
                ...prev,
                backgroundOpacity: Number(e.target.value) / 100,
              }))
            }
            aria-label={t('bgPicker.opacity')}
            aria-valuetext={`${Math.round(quickSettings.backgroundOpacity * 100)} percent`}
          />
        </div>
      </div>



      {/* Theme Presets */}
      <PresetSection
        quickSettings={quickSettings}
        onQuickSettingsChange={onQuickSettingsChange}
      />
    </div>
  );
}

function LayerBackdropControls({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
}) {
  const { t } = useTranslation();
  const darkness = Math.min(100, Math.max(0, Math.round(quickSettings.layoutBackdropDarkness ?? 0)));
  return (
    <div className="dtb-colors__section">
      <div className="dtb-slider-field">
        <div className="dtb-slider-field__head">
          <span>{t("bgPicker.darkness")}</span>
          <span className="dtb-slider-field__value">{darkness}%</span>
        </div>
        <input
          type="range"
          className="dtb-slider dtb-slider--filled"
          min={0}
          max={100}
          step={1}
          value={darkness}
          style={sliderProgress(darkness, 0, 100)}
          onChange={(e) => {
            const value = Number(e.target.value);
            onQuickSettingsChange((prev) => ({ ...prev, layoutBackdropDarkness: value }));
            onBackgroundPresetChange?.("theme");
          }}
          aria-label={t("bgPicker.darkness")}
          aria-valuetext={`${darkness} percent`}
        />
      </div>
      <p className="dtb-compare-section__description">
        {t("bgPicker.layerBackdropHint", "Applies behind this theme's text. Choose Theme to keep the theme's own background.")}
      </p>
    </div>
  );
}

function BackgroundAppearanceControls({
  quickSettings,
  onQuickSettingsChange,
  onBackgroundPresetChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
}) {
  const { t } = useTranslation();
  const updateAppearance = (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => {
    onQuickSettingsChange(updater);
    onBackgroundPresetChange?.("theme");
  };

  return (
    <>
      <div className="dtb-colors__section">
        <div className="dtb-slider-field">
          <div className="dtb-slider-field__head">
            <span>{t('bgPicker.darkness')}</span>
            <span className="dtb-slider-field__value">
              {Math.round(quickSettings.fullscreenShadeOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            className="dtb-slider dtb-slider--filled"
            min={0}
            max={100}
            step={1}
            value={Math.round(quickSettings.fullscreenShadeOpacity * 100)}
            style={sliderProgress(quickSettings.fullscreenShadeOpacity * 100, 0, 100)}
            onChange={(e) =>
              updateAppearance((prev) => ({
                ...prev,
                fullscreenShadeOpacity: Number(e.target.value) / 100,
              }))
            }
            aria-label={t('bgPicker.darkness')}
            aria-valuetext={`${Math.round(quickSettings.fullscreenShadeOpacity * 100)} percent`}
          />
        </div>
      </div>

      <div className="dtb-colors__section">
        <div className="dtb-slider-field">
          <div className="dtb-slider-field__head">
            <span>{t('bgPicker.opacity')}</span>
            <span className="dtb-slider-field__value">
              {Math.round(quickSettings.backgroundOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            className="dtb-slider dtb-slider--filled"
            min={0}
            max={100}
            step={1}
            value={Math.round(quickSettings.backgroundOpacity * 100)}
            style={sliderProgress(quickSettings.backgroundOpacity * 100, 0, 100)}
            onChange={(e) =>
              updateAppearance((prev) => ({
                ...prev,
                backgroundOpacity: Number(e.target.value) / 100,
              }))
            }
            aria-label={t('bgPicker.opacity')}
            aria-valuetext={`${Math.round(quickSettings.backgroundOpacity * 100)} percent`}
          />
        </div>
      </div>
    </>
  );
}

/* ── Gradient Presets ── */
const GRADIENT_PRESETS = [
  { label: "Sunset", start: "#AD0000", end: "#000000", angle: 135 },
  { label: "Sunset", start: "#AE0000", end: "#FF0000", angle: 135 },
  { label: "Dusk", start: "#2D1B69", end: "#11001C", angle: 135 },
  { label: "Slate", start: "#334155", end: "#0F172A", angle: 180 },
];

function shortenBibleReference(reference: string): string {
  return reference
    .replace(/^Genesis\b/i, "Gen")
    .replace(/^Exodus\b/i, "Ex")
    .replace(/^Matthew\b/i, "Mt")
    .replace(/^John\b/i, "Jn")
    .replace(/^Romans\b/i, "Rom");
}

function ReferenceDisplaySection({
  sampleReference,
  referenceFormat,
  referenceVersionVisible,
  referenceTranslation,
  onReferenceFormatChange,
  onReferenceVersionVisibleChange,
}: {
  sampleReference: string;
  referenceFormat: BibleReferenceFormat;
  referenceVersionVisible: boolean;
  referenceTranslation: string;
  onReferenceFormatChange?: (format: BibleReferenceFormat) => void;
  onReferenceVersionVisibleChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const translation = referenceTranslation.trim().toUpperCase();
  const buildPreview = (format: BibleReferenceFormat) => {
    const base = format === "short" ? shortenBibleReference(sampleReference) : sampleReference;
    if (format === "hidden") return referenceVersionVisible && translation ? translation : t("common.hidden", "Hidden");
    return `${base}${referenceVersionVisible && translation ? ` (${translation})` : ""}`;
  };
  const options: Array<{ value: BibleReferenceFormat; label: string }> = [
    { value: "full", label: t("bible.referenceFormatFull", "Full") },
    { value: "short", label: t("bible.referenceFormatShort", "Short") },
    { value: "hidden", label: t("bible.referenceFormatHidden", "Off") },
  ];

  return (
    <div className="dtb-control-section dtb-reference-display-card">
      <div className="dtb-control-section__head">
        <span className="dtb-control-section__icon">
          <Icon name="bookmark" size={14} />
        </span>
        <span className="dtb-control-section__title">
          {t("bible.referenceDisplay", "Reference Display")}
        </span>
      </div>
      <div className="dtb-control-section__body">
        <div className="dock-bible-reference-options qs-choice-cards" role="group" aria-label={t("bible.referenceFormat", "Reference")}>
          {options.map((option) => {
            const isSelected = referenceFormat === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`dock-bible-reference-option qs-choice-card${isSelected ? " dock-bible-reference-option--active qs-choice-card--active" : ""}`}
                onClick={() => onReferenceFormatChange?.(option.value)}
                aria-pressed={isSelected}
              >
                <span className="qs-choice-card__title">{option.label}</span>
                <span className="qs-choice-card__subtitle">{buildPreview(option.value)}</span>
              </button>
            );
          })}
        </div>
        <div className="dock-bible-reference-popover__toggle-row qs-toggle-row">
          <div className="qs-toggle-copy">
            <span className="dock-bible-reference-popover__label qs-toggle-label">
              {t("bible.showBibleVersion", "Show Bible Version")}
            </span>
            <span className="dock-bible-reference-popover__hint qs-toggle-hint">
              {t("bible.showBibleVersionHelp", "Display the Bible version e.g. KJV, NIV")}
            </span>
          </div>
          <button
            type="button"
            className={`dtb-toggle${referenceVersionVisible ? " dtb-toggle--on" : ""}`}
            onClick={() => onReferenceVersionVisibleChange?.(!referenceVersionVisible)}
            role="switch"
            aria-checked={referenceVersionVisible}
            aria-label={t("bible.showBibleVersion", "Show Bible Version")}
          >
            <span className="dtb-toggle__knob" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Reference Section ── */
function ReferenceSection({
  styleLinked,
  onStyleLinkedChange,
  quickSettings,
  onQuickSettingsChange,
  overlayMode,
  sampleReference,
  referenceFormat,
  referenceVersionVisible,
  referenceTranslation,
  onReferenceFormatChange,
  onReferenceVersionVisibleChange,
}: {
  /** Bible picker only: reference follows the verse's colour, weight and case. */
  styleLinked?: boolean;
  onStyleLinkedChange?: (linked: boolean) => void;
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  overlayMode: NonNullable<Props["overlayMode"]>;
  sampleReference: string;
  referenceFormat?: BibleReferenceFormat;
  referenceVersionVisible: boolean;
  referenceTranslation: string;
  onReferenceFormatChange?: (format: BibleReferenceFormat) => void;
  onReferenceVersionVisibleChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const baseSize = quickSettings.fontSize ?? 48;
  const refFontSize = (quickSettings.refFontSize && quickSettings.refFontSize < baseSize)
    ? quickSettings.refFontSize
    : Math.max(14, Math.round(baseSize * 0.7));
  const refFontWeight = quickSettings.refFontWeight ?? quickSettings.fontWeight ?? "bold";
  const refTextTransform = quickSettings.refTextTransform ?? "none";
  const refOpacity = quickSettings.refOpacity ?? 1;

  const linked = Boolean(onStyleLinkedChange && styleLinked);

  return (
    <div className="dtb-bg-picker__settings">
      {onStyleLinkedChange && (
        <div className="dtb-section-heading dtb-section-heading--with-switch">
          <span>{t('bgPicker.reference', 'Reference')}</span>
          <label className="dtb-section-heading__switch">
            <span>{t('bgPicker.sameStyleAsVerse', 'Same style as verse')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={linked}
              aria-label={t('bgPicker.sameStyleAsVerse', 'Same style as verse')}
              className={`dtb-fx-switch${linked ? " dtb-fx-switch--on" : ""}`}
              onClick={() => onStyleLinkedChange(!linked)}
            >
              <span className="dtb-fx-switch__knob" />
            </button>
          </label>
        </div>
      )}
      {!referenceFormat && (
        <div>
          <div className="dtb-section-title">{t('bgPicker.reference')}</div>
          <p className="dtb-compare-section__description">
            {t('bgPicker.referenceSectionDescription', 'Control how the scripture reference is shown above or below the verse.')}
          </p>
        </div>
      )}

      <div className="dtb-control-section">
        <div className="dtb-control-section__head">
          <span className="dtb-control-section__icon">
            <Icon name="palette" size={14} />
          </span>
          <span className="dtb-control-section__title">{t('bgPicker.textAppearance', 'Text appearance')}</span>
        </div>
        <div className="dtb-control-section__body">
          <div className="dtb-typography-control-row">
            {!linked && (
              <ColorPickerCard
                label={t('common.color')}
                value={quickSettings.refFontColor ?? quickSettings.fontColor ?? "#ffffff"}
                onChange={(v) => onQuickSettingsChange((prev) => ({ ...prev, refFontColor: v }))}
              />
            )}

            <SliderNumberField
              label={t('bgPicker.fontSize')}
              value={refFontSize}
              min={overlayMode === "lower-third" ? LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE : 10}
              max={overlayMode === "lower-third" ? LOWER_THIRD_REFERENCE_FONT_SIZE_MAX : 150}
              step={1}
              onChange={(value) => onQuickSettingsChange((prev) => ({
                ...prev,
                refFontSize: value,
                compareReferenceFontSizeLeft: value,
                compareReferenceFontSizeRight: value,
              }))}
            />
          </div>


          {!linked && (
          <div className="dtb-typography-control-row dtb-typography-control-row--selects">
            <CompactSelectField<CompactFontWeight>
              label={t('bgPicker.weight')}
              value={refFontWeight as CompactFontWeight}
              options={getWeightOptions(t)}
              onChange={(w) => onQuickSettingsChange((prev) => ({ ...prev, refFontWeight: w }))}
            />

            <CompactSelectField<CompactTextCase>
              label={t('bgPicker.textCase')}
              value={refTextTransform as CompactTextCase}
              options={getTextCaseOptions(t)}
              onChange={(tc) => onQuickSettingsChange((prev) => ({ ...prev, refTextTransform: tc }))}
            />
          </div>
          )}

        </div>
      </div>

      <ReferenceBackgroundSection
        quickSettings={quickSettings}
        onQuickSettingsChange={onQuickSettingsChange}
      />

      {referenceFormat && onReferenceFormatChange && onReferenceVersionVisibleChange && (
        <ReferenceDisplaySection
          sampleReference={sampleReference}
          referenceFormat={referenceFormat}
          referenceVersionVisible={referenceVersionVisible}
          referenceTranslation={referenceTranslation}
          onReferenceFormatChange={onReferenceFormatChange}
          onReferenceVersionVisibleChange={onReferenceVersionVisibleChange}
        />
      )}

      <div className="dtb-control-section dtb-more-options-section">
        <button
          type="button"
          className="dtb-colors__collapsible-header dtb-more-options-header"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
        >
          <span className="dtb-more-options-title">
            <Icon name="settings" size={14} />
            <span>{t('common.moreOptions', 'More Options')}</span>
          </span>
          <Icon name={advancedOpen ? "expand_less" : "expand_more"} size={14} />
        </button>
        {advancedOpen && (
          <div className="dtb-control-section__body dtb-more-options-body">
            <SliderNumberField
              label={t('common.opacity', 'Opacity')}
              value={Math.round(refOpacity * 100)}
              min={10}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => onQuickSettingsChange((prev) => ({ ...prev, refOpacity: value / 100 }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Reference Layout Section ── */
function ReferenceLayoutSection({
  quickSettings,
  onQuickSettingsChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
}) {
  const { t } = useTranslation();
  const refPosition = quickSettings.refPosition ?? "bottom";
  const refTextAlign = quickSettings.refTextAlign ?? "match";
  const refSpacing = quickSettings.refSpacing ?? 24;
  const isTop = refPosition === "top";
  const setReferencePlacement = (placement: "top" | "bottom") => {
    onQuickSettingsChange((prev) => ({
      ...prev,
      refAnchor: "normal",
      refPosition: placement,
    }));
  };

  return (
    <div className="dtb-bg-picker__settings">
      <div>
        <div className="dtb-section-title">{t('bgPicker.reference')}</div>
        <p className="dtb-compare-section__description">
          {t('bgPicker.referenceLayoutDescription', 'Control where the scripture reference sits around the verse.')}
        </p>
      </div>

      <div className="dtb-control-section">
        <div className="dtb-control-section__head">
          <span className="dtb-control-section__title">{t('bgPicker.layout', 'Layout')}</span>
        </div>
        <div className="dtb-control-section__body">
          <IconSegmentedControl<CompactTextAlign>
            label={t('bgPicker.alignment')}
            value={refTextAlign as CompactTextAlign}
            options={getAlignmentOptions(t, true)}
            onChange={(a) => onQuickSettingsChange((prev) => ({ ...prev, refTextAlign: a as "match" | "left" | "center" | "right" }))}
          />

          {/* Reference Placement */}
          <div className="dtb-font-weight-row">
            <span className="dtb-position-label">{t('bgPicker.referencePlacement', 'Placement')}</span>
            <div className="dtb-position-options">
              <button
                type="button"
                className={`dtb-position-btn${isTop ? " dtb-position-btn--active" : ""}`}
                onClick={() => setReferencePlacement("top")}
                title={t('bgPicker.top', 'Top')}
              >
                {t('bgPicker.top', 'Top')}
              </button>
              <button
                type="button"
                className={`dtb-position-btn${!isTop ? " dtb-position-btn--active" : ""}`}
                onClick={() => setReferencePlacement("bottom")}
                title={t('bgPicker.bottom', 'Bottom')}
              >
                {t('bgPicker.bottom', 'Bottom')}
              </button>
            </div>
          </div>

          {/* Reference Spacing */}
          <div className="dtb-slider-field">
            <div className="dtb-slider-field__head">
              <span>{t('bgPicker.spacing', 'Reference Spacing')}</span>
              <span className="dtb-slider-field__value">{refSpacing}px</span>
            </div>
            <input
              type="range"
              className="dtb-slider"
              min={0}
              max={150}
              step={1}
              value={refSpacing}
              onChange={(e) => onQuickSettingsChange((prev) => ({ ...prev, refSpacing: Number(e.target.value) }))}
              aria-label={t('bgPicker.spacing', 'Reference Spacing')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reference Background ── */
function ReferenceBackgroundSection({
  quickSettings,
  onQuickSettingsChange,
  showColorPicker = true,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  showColorPicker?: boolean;
}) {
  const { t } = useTranslation();
  const refBgEnabled = quickSettings.referenceBackgroundEnabled;

  return (
    <div className="dtb-control-section dtb-colors__section">
      <div className={`dtb-control-section__head dtb-colors__ref-bg-header${showColorPicker ? "" : " dtb-colors__ref-bg-header--toggle-only"}`}>
        <div className="dtb-colors__toggle-row qs-section-header-toggle">
          <div className="qs-section-title-wrap">
            <span className="dtb-control-section__title dtb-colors__label">{t('bgPicker.referenceBackground', 'Reference Background')}</span>
          </div>
          <button
            type="button"
            className={`dtb-toggle${refBgEnabled ? " dtb-toggle--on" : ""}`}
            onClick={() =>
              onQuickSettingsChange((prev) => ({
                ...prev,
                referenceBackgroundEnabled: !prev.referenceBackgroundEnabled,
              }))
            }
            role="switch"
            aria-checked={refBgEnabled}
            aria-label={t('bgPicker.enableReferenceBackground')}
            title="dtb-toggle__knob">
            <span className="dtb-toggle__knob" />
          </button>
        </div>
      </div>

      {refBgEnabled && (
        <div className="dtb-control-section__body dtb-colors__ref-bg-controls">
          {showColorPicker && (
            <div className="dtb-typography-control-row">
              <ColorPickerCard
                className="dtb-colors__ref-bg-color-card"
                label={t('bgPicker.background', 'Background')}
                value={quickSettings.referenceBackgroundColor}
                onChange={(v) => onQuickSettingsChange((prev) => ({ ...prev, referenceBackgroundColor: v }))}
              />
            </div>
          )}

          <div className="dtb-colors__style-wrap">
            <div className="dtb-colors__style-label-row">
              <span className="dtb-colors__sublabel">{t('bgPicker.style', 'Style')}</span>
            </div>
            <div className="dtb-colors__style-cards">
              {([
                { id: "solid" as const, label: "bgPicker.solid", preview: "John 3:16" },
                { id: "pill" as const, label: "bgPicker.pill", preview: "John 3:16" },
                { id: "outline" as const, label: "bgPicker.outline", preview: "John 3:16" },
              ]).map((style) => {
                const isActive = quickSettings.referenceBackgroundStyle === style.id;
                const bg = quickSettings.referenceBackgroundColor;
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={`dtb-colors__style-card${isActive ? " dtb-colors__style-card--active" : ""}`}
                    onClick={() =>
                      onQuickSettingsChange((prev) => ({ ...prev, referenceBackgroundStyle: style.id }))
                    }
                  >
                    <span className="dtb-colors__style-card-label">{t(style.label)}</span>
                    <span
                      className={`dtb-colors__style-card-preview dtb-colors__style-card-preview--${style.id}`}
                      style={{
                        backgroundColor: style.id === "outline" ? "transparent" : bg,
                        borderColor: style.id === "outline" ? bg : undefined,
                        borderRadius: style.id === "pill" ? "999px" : `${quickSettings.referenceBackgroundRadius}px`,
                        color: style.id === "outline" ? bg : undefined,
                      }}
                    >
                      {style.preview}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dtb-colors__slider-row">
            <SliderNumberField
              label={t('common.cornerRadius', 'Corner Radius')}
              value={quickSettings.referenceBackgroundRadius}
              min={0}
              max={40}
              step={1}
              unit="px"
              onChange={(value) =>
                onQuickSettingsChange((prev) => ({
                  ...prev,
                  referenceBackgroundRadius: value,
                }))
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Theme Picker ── */
function ThemeSection({
  selectedThemeId,
  onThemeSelect,
  allowedCategories,
  overlayMode,
  area,
}: {
  selectedThemeId: string | null;
  onThemeSelect: (theme: BibleTheme) => void;
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
  overlayMode: "fullscreen" | "lower-third";
  /** Which Dock tab this picker belongs to; the user's own themes can be switched off per tab. */
  area: DockThemeArea | null;
}) {
  const [themes, setThemes] = useState<BibleTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [query, setQuery] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // Callers pass a fresh array every render; key on its contents so a re-render
  // does not trigger another load.
  const categoriesKey = (allowedCategories ?? []).join("|");
  const categories = useMemo(
    () => (categoriesKey ? (categoriesKey.split("|") as Array<NonNullable<BibleTheme["category"]>>) : undefined),
    [categoriesKey],
  );

  /** `fresh` re-reads the favourites from the app too (opening Quick Edits and the reload button). */
  const loadThemes = useCallback(async (fresh = false) => {
    try {
      // The user's own themes show up here by themselves (unless switched off for this tab);
      // ready-made ones follow the picker's categories.
      const available = await loadDockThemesForArea(area, categories, { fresh });
      const modeFiltered = available.filter((theme) => themeSupportsBibleOverlayMode(theme, overlayMode));
      setThemes(modeFiltered);
    } catch (err) {
      console.error("[ThemeSection] failed to load themes:", err);
      setThemes([]);
    } finally {
      setLoading(false);
    }
  }, [area, categories, overlayMode]);

  useEffect(() => {
    let cancelled = false;
    // Opening Quick Edits (this mounts) always asks for the latest themes.
    void loadThemes(true).catch(() => { });
    const refresh = () => {
      if (!cancelled) void loadThemes().catch(() => { });
    };
    window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, refresh);
    // The app tells the Dock when a theme is created, deleted or switched off.
    const unsubscribe = dockClient.onState((msg) => {
      if (msg.type === "state:favorite-themes-updated") refresh();
    });
    return () => {
      cancelled = true;
      window.removeEventListener(FAVORITE_THEMES_UPDATED_EVENT, refresh);
      unsubscribe();
    };
  }, [loadThemes]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      // Ask the app to fetch the account's latest themes and rewrite the Dock files;
      // it answers with an update that refreshes this list again.
      dockClient.sendCommand({ type: "themes:sync", timestamp: Date.now() });
      await loadThemes(true);
    } finally {
      setReloading(false);
    }
  }, [loadThemes]);

  const needle = query.trim().toLowerCase();
  const shownThemes = needle
    ? themes.filter((theme) => `${theme.name} ${theme.description ?? ""}`.toLowerCase().includes(needle))
    : themes;

  // The grid scrolls in a short box: bring the selected theme into view when it opens.
  useEffect(() => {
    if (loading || needle) return;
    const grid = gridRef.current;
    const active = grid?.querySelector<HTMLElement>(".dtb-theme-section__item--active");
    if (grid && active) grid.scrollTop = Math.max(0, active.offsetTop - grid.offsetTop - 4);
  }, [loading, needle, selectedThemeId, themes.length]);

  const themeHeader = (
    <div className="dtb-theme-section__head">
      <span className="dtb-colors__label">{t('bgPicker.selectTheme')}</span>
      <input
        type="search"
        className="dtb-theme-section__search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('bgPicker.searchThemes', 'Search themes')}
        aria-label={t('bgPicker.searchThemes', 'Search themes')}
      />
      <button
        type="button"
        className={`dtb-theme-section__reload${reloading ? " dtb-theme-section__reload--spinning" : ""}`}
        onClick={() => void handleReload()}
        disabled={reloading}
        title={t('bgPicker.reloadThemes', 'Reload themes')}
        aria-label={t('bgPicker.reloadThemes', 'Reload themes')}
      >
        <Icon name="refresh" size={14} />
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="dtb-theme-section">
        {themeHeader}
        <div className="dtb-theme-section__loading">{t('bgPicker.loadingThemes')}</div>
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div className="dtb-theme-section">
        {themeHeader}
        <div className="dtb-theme-section__empty">{t('bgPicker.noThemesFound')}</div>
      </div>
    );
  }

  return (
    <div className="dtb-theme-section">
      {themeHeader}
      {shownThemes.length === 0 && (
        <div className="dtb-theme-section__empty">{t('bgPicker.noThemesMatch', 'No themes match “{{query}}”', { query: query.trim() })}</div>
      )}
      <div className="dtb-theme-section__grid" ref={gridRef}>
        {shownThemes.map((theme) => {
          const isActive = theme.id === selectedThemeId;
          // Resolve variant for preview — use the active mode's variant, fallback to theme.settings
          const variant = overlayMode === "lower-third"
            ? theme.variants?.lowerThird
            : theme.variants?.fullscreen;
          const s = variant?.settings ?? theme.settings;
          const bgColor = s.boxBackground || s.backgroundColor || "#0F172A";
          const fontColor = s.fontColor || "#fff";
          // Determine which variants this theme supports
          const hasFs = !!(theme.variants?.fullscreen) || theme.templateType === "fullscreen";
          const hasLt = !!(theme.variants?.lowerThird) || theme.templateType === "lower-third";
          return (
            <button
              key={theme.id}
              type="button"
              className={`dtb-theme-section__item${isActive ? " dtb-theme-section__item--active" : ""}`}
              onClick={() => onThemeSelect(theme)}
              title={theme.name}
              style={{ minHeight: 50 }}
            >
              <div
                className="dtb-theme-section__preview"
                style={{ backgroundColor: bgColor, color: fontColor }}
              >
                {s.layout ? (
                  <ThemeLayoutPreview layout={s.layout} />
                ) : (
                <span
                  className="dtb-theme-section__preview-text"
                  style={{
                    fontWeight: s.fontWeight === "black" ? 900 : s.fontWeight === "extrabold" || s.fontWeight === "bold" ? 800 : undefined,
                    textShadow: s.textShadow || undefined,
                    WebkitTextStroke: s.textOutline
                      ? `${s.textOutlineWidth || 2}px ${s.textOutlineColor || "#000"}`
                      : undefined,
                  }}
                >
                  Aa
                </span>
                )}
                <div className="dtb-theme-section__variants">
                  {hasFs && <span className="dtb-theme-section__variant-badge">FS</span>}
                  {hasLt && <span className="dtb-theme-section__variant-badge">LT</span>}
                </div>
              </div>
              <span className="dtb-theme-section__name">{theme.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Theme Presets ── */
const COLOR_PRESETS = [
  {
    label: "Faith",
    backgroundColor: "#1A2244",
    backgroundOpacity: 1,
    referenceBackgroundEnabled: false,
    referenceBackgroundColor: "#F4D17B",
    referenceBackgroundStyle: "solid" as const,
    referenceBackgroundRadius: 12,
  },
  {
    label: "Minimal",
    backgroundColor: "#0F172A",
    backgroundOpacity: 1,
    referenceBackgroundEnabled: false,
    referenceBackgroundColor: "#CBD5E1",
    referenceBackgroundStyle: "solid" as const,
    referenceBackgroundRadius: 12,
  },
  {
    label: "Bold",
    backgroundColor: "#050816",
    backgroundOpacity: 1,
    referenceBackgroundEnabled: true,
    referenceBackgroundColor: "#B9CCFF",
    referenceBackgroundStyle: "pill" as const,
    referenceBackgroundRadius: 20,
  },
  {
    label: "High Contrast",
    backgroundColor: "#000000",
    backgroundOpacity: 1,
    referenceBackgroundEnabled: true,
    referenceBackgroundColor: "#FDE68A",
    referenceBackgroundStyle: "outline" as const,
    referenceBackgroundRadius: 4,
  },
  {
    label: "Elegant",
    backgroundColor: "#1C1917",
    backgroundOpacity: 1,
    referenceBackgroundEnabled: true,
    referenceBackgroundColor: "#D4A574",
    referenceBackgroundStyle: "solid" as const,
    referenceBackgroundRadius: 6,
  },
];

function PresetSection({
  quickSettings,
  onQuickSettingsChange,
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useTranslation();

  return (
    <div className="dtb-colors__section dtb-colors__section--collapsible">
      <button
        type="button"
        className="dtb-colors__collapsible-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={t('bgPicker.themePresets')}>
        <span className="dtb-colors__label">{t('bgPicker.themePresets')}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={14} />
      </button>
      {open && (
        <div className="dtb-colors__preset-grid">
          {COLOR_PRESETS.map((preset) => {
            const isActive =
              quickSettings.backgroundColor === preset.backgroundColor &&
              quickSettings.backgroundOpacity === preset.backgroundOpacity &&
              quickSettings.referenceBackgroundEnabled === preset.referenceBackgroundEnabled &&
              quickSettings.referenceBackgroundColor === preset.referenceBackgroundColor &&
              quickSettings.referenceBackgroundStyle === preset.referenceBackgroundStyle &&
              quickSettings.referenceBackgroundRadius === preset.referenceBackgroundRadius;
            return (
              <button
                key={preset.label}
                type="button"
                className={`dtb-colors__preset-card${isActive ? " dtb-colors__preset-card--active" : ""}`}
                onClick={() =>
                  onQuickSettingsChange((prev) => ({
                    ...prev,
                    backgroundColor: preset.backgroundColor,
                    backgroundOpacity: preset.backgroundOpacity,
                    referenceBackgroundEnabled: preset.referenceBackgroundEnabled,
                    referenceBackgroundColor: preset.referenceBackgroundColor,
                    referenceBackgroundStyle: preset.referenceBackgroundStyle,
                    referenceBackgroundRadius: preset.referenceBackgroundRadius,
                  }))
                }
              >
                <div
                  className="dtb-colors__preset-preview"
                  style={{ backgroundColor: preset.backgroundColor }}
                >
                  <span className="dtb-colors__preset-sample">Aa</span>
                  <span
                    className="dtb-colors__preset-ref"
                    style={{
                      backgroundColor: preset.referenceBackgroundEnabled && preset.referenceBackgroundStyle !== "outline" ? preset.referenceBackgroundColor : "transparent",
                      borderRadius: preset.referenceBackgroundStyle === "pill" ? "999px" : `${preset.referenceBackgroundRadius}px`,
                      border: preset.referenceBackgroundEnabled && preset.referenceBackgroundStyle === "outline" ? `1.5px solid ${preset.referenceBackgroundColor}` : "none",
                      color: preset.referenceBackgroundColor,
                      padding: preset.referenceBackgroundEnabled ? "2px 6px" : "0",
                    }}
                  >
                    John 3:16
                  </span>
                </div>
                <span className="dtb-colors__preset-name">{preset.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Compare Settings (simplified) ── */

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "Use Theme Font" },
  { value: '"CMG Sans Black", "CMG Sans", "Charis SIL", "Noto Sans", Arial, sans-serif', label: "CMG Sans Black (recommended)" },
  { value: '"Charis SIL", "Noto Sans", sans-serif', label: "Charis SIL (African languages)" },
  { value: '"CMG Sans", sans-serif', label: "CMG Sans" },
  { value: '"Inter", system-ui, sans-serif', label: "Inter" },
  { value: '"Charis SIL", serif', label: "Charis SIL" },
  { value: 'Georgia, serif', label: "Georgia" },
  { value: 'Arial, sans-serif', label: "Arial" },
  { value: 'Impact, sans-serif', label: "Impact" },
] as const;

const COMPARE_WEIGHT_OPTIONS: Array<{ value: CompareFontWeight; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "medium", label: "Medium" },
  { value: "semibold", label: "Semibold" },
  { value: "bold", label: "Bold" },
  { value: "extrabold", label: "Extra Bold" },
];

const COMPARE_ALIGN_OPTIONS: Array<{ value: CompareTextAlign; label: string }> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const COMPARE_META_POSITION_OPTIONS: Array<{ value: CompareMetadataPosition; label: string }> = [
  { value: "above-verse", label: "Above Verse" },
  { value: "below-verse", label: "Below Verse" },
  { value: "hidden", label: "Hidden" },
];

function clampNumberValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toQuickSettingsPatch(patch: Record<string, unknown>): Partial<DockFullscreenQuickThemeSettings> {
  return patch as Partial<DockFullscreenQuickThemeSettings>;
}

function getWeightGlyphClass(value: CompactFontWeight | CompareFontWeight): string {
  if (value === "light" || value === "regular") return "dtb-icon-segmented__glyph--light";
  if (value === "normal" || value === "medium") return "dtb-icon-segmented__glyph--normal";
  if (value === "semibold") return "dtb-icon-segmented__glyph--semibold";
  if (value === "extrabold" || value === "black") return "dtb-icon-segmented__glyph--extrabold";
  return "dtb-icon-segmented__glyph--bold";
}

function getAlignIcon(value: CompactTextAlign | CompareTextAlign): string {
  if (value === "center") return "format_align_center";
  if (value === "right") return "format_align_right";
  if (value === "justify") return "format_align_justify";
  if (value === "match") return "link";
  return "format_align_left";
}

type IconSegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
  glyph?: string;
  glyphClassName?: string;
};

function CompactSelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<IconSegmentedOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="dtb-compact-select-field">
      <span className="dtb-position-label">{label}</span>
      <div className="dtb-compact-select-field__control">
        <select
          className="dtb-compact-select-field__select"
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          aria-label={label}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <Icon name="expand_more" size={14} className="dtb-compact-select-field__chevron" />
      </div>
    </label>
  );
}

function IconSegmentedControl<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  columns,
}: {
  label: string;
  description?: string;
  value: T;
  options: Array<IconSegmentedOption<T>>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  const columnCount = columns ?? options.length;
  return (
    <div className="dtb-icon-segmented">
      <div className="dtb-setting-info">
        <span className="dtb-position-label">{label}</span>
        {description && <span className="dtb-setting-description">{description}</span>}
      </div>
      <div
        className="dtb-icon-segmented__options"
        style={{ "--dtb-icon-segment-count": columnCount } as CSSProperties}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`dtb-icon-segmented__button${value === option.value ? " dtb-icon-segmented__button--active" : ""}`}
            onClick={() => onChange(option.value)}
            title={option.label}
            aria-label={option.label}
          >
            {option.icon ? (
              <Icon name={option.icon} size={15} />
            ) : (
              <span className={`dtb-icon-segmented__glyph${option.glyphClassName ? ` ${option.glyphClassName}` : ""}`}>
                {option.glyph}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function getWeightOptions(t: ReturnType<typeof useTranslation>["t"]): Array<IconSegmentedOption<CompactFontWeight>> {
  return (["light", "normal", "bold", "extrabold", "black"] as const).map((value) => ({
    value,
    label:
      value === "light"
        ? t("bgPicker.light")
        : value === "bold"
          ? t("bgPicker.bold")
          : value === "extrabold"
            ? t("bgPicker.extraBold", "Extra bold")
            : value === "black"
              ? t("bgPicker.black", "Black (900)")
              : t("bgPicker.regular"),
    glyph: value === "black" ? "B++" : value === "extrabold" ? "B+" : "B",
    glyphClassName: getWeightGlyphClass(value),
  }));
}

function getTextCaseOptions(t: ReturnType<typeof useTranslation>["t"]): Array<IconSegmentedOption<CompactTextCase>> {
  return [
    { value: "none", label: t("bgPicker.normal"), glyph: "Aa" },
    { value: "uppercase", label: t("common.upper"), glyph: "AA" },
    { value: "lowercase", label: t("common.lower"), glyph: "aa" },
    { value: "capitalize", label: t("bgPicker.title"), glyph: "Ab" },
  ];
}

function getAlignmentOptions(
  t: ReturnType<typeof useTranslation>["t"],
  includeMatch = false,
  includeJustify = false,
): Array<IconSegmentedOption<CompactTextAlign>> {
  const values: CompactTextAlign[] = [
    ...(includeMatch ? (["match"] as const) : []),
    "left",
    "center",
    "right",
    ...(includeJustify ? (["justify"] as const) : []),
  ];
  return values.map((value) => ({
    value,
    label: value === "match" ? t("bgPicker.matchVerse") : t(`common.${value}`),
    icon: getAlignIcon(value),
  }));
}

function getCompareWeightOptions(): Array<IconSegmentedOption<CompareFontWeight>> {
  return COMPARE_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    glyph: option.value === "extrabold" ? "B+" : "B",
    glyphClassName: getWeightGlyphClass(option.value),
  }));
}

function getCompareAlignOptions(): Array<IconSegmentedOption<CompareTextAlign>> {
  return COMPARE_ALIGN_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    icon: getAlignIcon(option.value),
  }));
}

function SliderNumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const safeValue = Number(value) || 0;
  const normalizedStep = Number.isInteger(step) ? 0 : String(step).split(".")[1]?.length ?? 2;
  const formattedValue = Number(safeValue.toFixed(normalizedStep));
  const [draftValue, setDraftValue] = useState(String(formattedValue));

  useEffect(() => {
    setDraftValue(String(formattedValue));
  }, [formattedValue]);

  const commitValue = (rawValue: string) => {
    setDraftValue(rawValue);
    if (rawValue.trim() === "") return;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      onChange(clampNumberValue(parsed, min, max));
    }
  };

  const stepValue = (direction: -1 | 1) => {
    onChange(clampNumberValue(safeValue + (step * direction), min, max));
  };

  return (
    <div className="dtb-slider-field">
      <div className="dtb-slider-field__head">
        <span>{label}</span>
      </div>
      <div className="dtb-slider-field__stepper">
        <button
          type="button"
          className="dtb-slider-field__step-button"
          onClick={() => stepValue(-1)}
          disabled={safeValue <= min}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          className="dtb-slider-field__number"
          min={min}
          max={max}
          step={step}
          inputMode={step < 1 ? "decimal" : "numeric"}
          value={draftValue}
          onChange={(event) => commitValue(event.target.value)}
          onBlur={() => {
            if (draftValue.trim() === "") setDraftValue(String(formattedValue));
          }}
          aria-label={`${label} value`}
          aria-valuetext={`${formattedValue}${unit ? ` ${unit}` : ""}`}
        />
        <button
          type="button"
          className="dtb-slider-field__step-button"
          onClick={() => stepValue(1)}
          disabled={safeValue >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="dtb-position-row">
      <label className="dtb-position-label">{label}</label>
      <select className="dock-select dtb-bg-picker__select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function CompareLayoutPopover({
  value,
  gap,
  options,
  onPresetChange,
  onGapChange,
}: {
  value: string;
  gap: number;
  options: Array<{ value: string; label: string; description?: string }>;
  onPresetChange: (value: string) => void;
  onGapChange: (value: number) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 292 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const openPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(292, Math.max(240, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 430));
    setPos({ top, left, width });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="dtb-compare-layout-control">
      <button
        ref={triggerRef}
        type="button"
        className="dtb-compare-layout-trigger"
        onClick={() => open ? setOpen(false) : openPopover()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label="Layout and gap"
        title="Layout and gap"
      >
        <Icon name="tune" size={16} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          id={id}
          className="dtb-compare-layout-popover"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 10000 }}
          role="menu"
        >
          <div className="dtb-compare-layout-popover__header">
            <div>
              <span className="dtb-compare-layout-popover__eyebrow">Layout</span>
              <strong>{selected?.label ?? "Custom"}</strong>
            </div>
            <button
              type="button"
              className="dtb-compare-layout-popover__close"
              onClick={() => setOpen(false)}
              aria-label="Close layout settings"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="dtb-compare-layout-popover__section">
            <span className="dtb-compare-layout-popover__label">Preset</span>
            <div className="dtb-compare-layout-popover__options">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`dtb-compare-layout-popover__option${active ? " dtb-compare-layout-popover__option--active" : ""}`}
                    onClick={() => {
                      onPresetChange(option.value);
                    }}
                    role="menuitemradio"
                    aria-checked={active}
                  >
                    <span className="dtb-compare-layout-popover__option-icon">
                      <Icon name={option.value === "custom" ? "tune" : "view_column"} size={16} />
                    </span>
                    <span className="dtb-compare-layout-popover__option-copy">
                      <span className="dtb-compare-layout-popover__option-label">{option.label}</span>
                      {option.description && (
                        <span className="dtb-compare-layout-popover__option-desc">{option.description}</span>
                      )}
                    </span>
                    {active && <Icon name="check" size={16} className="dtb-compare-layout-popover__option-check" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="dtb-compare-layout-popover__section">
            <SliderNumberField
              label="Gap between columns"
              value={gap}
              min={0}
              max={100}
              step={1}
              unit="px"
              onChange={onGapChange}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function CompareSettingsPanel({
  quickSettings,
  onQuickSettingsChange,
  compareBackdropValue,
  onBackdropChange,
  onBackgroundPresetChange,
  overlayMode = "fullscreen",
  imageLimit,
  videoLimit,
  patternLimit = getDockPatternLimit(),
}: {
  quickSettings: DockFullscreenQuickThemeSettings;
  onQuickSettingsChange: (updater: (prev: DockFullscreenQuickThemeSettings) => DockFullscreenQuickThemeSettings) => void;
  compareBackdropValue: BackgroundType;
  onBackdropChange: (type: BackgroundType) => void;
  onBackgroundPresetChange?: (preset: DockBackgroundPreset) => void;
  selectedThemeId?: string | null;
  onThemeSelect?: (theme: BibleTheme) => void;
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
  overlayMode?: "fullscreen" | "lower-third";
  imageLimit: number;
  videoLimit: number;
  patternLimit?: number;
}) {
  const { t } = useTranslation();
  const compare = useMemo(
    () => normalizeCompareThemeSettings(quickSettings as Record<string, unknown>),
    [quickSettings],
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const compareLowerThirdTextDirection = quickSettings.lowerThirdTextDirection === "inverted" ? "inverted" : "normal";
  const resolvedCompareBackdropValue = compareBackdropValue === "theme" ? "color" : compareBackdropValue;
  const layoutOptions = useMemo(
    () => [
      ...COMPARE_LAYOUT_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
        description: `${preset.leftWidth}/${preset.rightWidth} • ${preset.gap}px gap`,
      })),
      { value: "custom", label: "Custom", description: "Manual spacing and padding" },
    ],
    [],
  );

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    onQuickSettingsChange((prev) => ({ ...prev, ...toQuickSettingsPatch(patch) }));
  }, [onQuickSettingsChange]);

  const applyLayoutPreset = useCallback((presetId: string) => {
    const preset = COMPARE_LAYOUT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const matchingGapPreset = COMPARE_GAP_PRESETS.find((item) => item.value === preset.gap)?.id ?? "custom";
    applyPatch({
      compareLayoutPreset: preset.id,
      compareGapPreset: matchingGapPreset,
      compareLeftWidth: preset.leftWidth,
      compareRightWidth: preset.rightWidth,
      compareLockWidths: preset.leftWidth === preset.rightWidth,
      compareOuterPaddingTop: preset.outerPadding,
      compareOuterPaddingBottom: preset.outerPadding,
      compareOuterPaddingLeft: preset.outerPadding,
      compareOuterPaddingRight: preset.outerPadding,
      compareLinkPadding: true,
      comparePanelInnerPadding: preset.innerPadding,
      compareTranslationGap: preset.gap,
    });
  }, [applyPatch]);

  const setGap = useCallback((value: number) => {
    applyPatch({
      compareLayoutPreset: "custom",
      compareGapPreset: "custom",
      compareTranslationGap: clampNumberValue(value, 0, 100),
    });
  }, [applyPatch]);

  const resolvedLayoutPreset = useMemo(() => {
    const match = COMPARE_LAYOUT_PRESETS.find((preset) =>
      compare.compareLeftWidth === preset.leftWidth &&
      compare.compareRightWidth === preset.rightWidth &&
      compare.gap === preset.gap &&
      compare.compareOuterPaddingTop === preset.outerPadding &&
      compare.compareOuterPaddingBottom === preset.outerPadding &&
      compare.compareOuterPaddingLeft === preset.outerPadding &&
      compare.compareOuterPaddingRight === preset.outerPadding &&
      compare.comparePanelInnerPadding === preset.innerPadding,
    );
    return match?.id ?? "custom";
  }, [compare]);

  return (
    <div className="dtb-compare-settings">


      {/* Layout */}
      <div className="dtb-bg-picker__settings" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="dtb-compare-layout-heading">
          <div className="dtb-section-title">Layout</div>
          <CompareLayoutPopover
            value={resolvedLayoutPreset}
            gap={compare.gap}
            options={layoutOptions}
            onPresetChange={(value) => {
              if (value !== "custom") applyLayoutPreset(value);
            }}
            onGapChange={(value) => setGap(value)}
          />
        </div>

        <SelectField
          label="Background"
          value={resolvedCompareBackdropValue}
          onChange={(value) => onBackdropChange(value as BackgroundType)}
          options={COMPARE_BG_OPTIONS.map((option) => ({
            value: option.id,
            label: t(option.label, option.label),
          }))}
        />

        {overlayMode === "lower-third" && (
          <div className="dtb-control-subsection">
            <span className="dtb-control-subsection__title">{t('bgPicker.lowerThirdBar', 'Lower-third bar')}</span>

            <div className="dtb-font-weight-row">
              <span className="dtb-position-label">{t('bgPicker.lowerThirdPlacement', 'Bar placement')}</span>
              <div className="dtb-setting-control">
                <select
                  className="dtb-select-control"
                  value={quickSettings.lowerThirdEdge ?? "bottom"}
                  onChange={(e) => {
                    const edge = e.target.value as "bottom" | "top" | "left" | "right";
                    onQuickSettingsChange((prev) => ({ ...prev, lowerThirdEdge: edge }));
                  }}
                  aria-label={t('bgPicker.lowerThirdPlacement', 'Bar placement')}
                >
                  {(["bottom", "top", "left", "right"] as const).map((edge) => (
                    <option key={edge} value={edge}>
                      {edge === "bottom"
                        ? t('bgPicker.edgeBottom', 'Bottom')
                        : edge === "top"
                          ? t('bgPicker.edgeTop', 'Top')
                          : edge === "left"
                            ? t('common.left', 'Left')
                            : t('common.right', 'Right')}
                    </option>
                  ))}
                </select>
                <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
              </div>
            </div>

            {(() => {
              const currentWidth = quickSettings.lowerThirdWidthPreset ?? "full";
              const normalizedWidth = currentWidth === "xxl" ? "xl" : currentWidth === "lg" ? "md" : currentWidth;
              return (
                <div className="dtb-font-weight-row">
                  <span className="dtb-position-label">{t('bgPicker.lowerThirdWidth', 'Bar width')}</span>
                  <div className="dtb-setting-control">
                    <select
                      className="dtb-select-control"
                      value={normalizedWidth}
                      onChange={(e) => {
                        const value = e.target.value as "full" | "xl" | "md" | "sm";
                        onQuickSettingsChange((prev) => ({ ...prev, lowerThirdWidthPreset: value }));
                      }}
                      aria-label={t('bgPicker.lowerThirdWidth', 'Bar width')}
                    >
                      {([
                        { value: "full", label: t('bgPicker.widthFull', 'Full Width') },
                        { value: "xl", label: t('bgPicker.widthWide', 'Wide') },
                        { value: "md", label: t('bgPicker.widthCard', 'Card') },
                        { value: "sm", label: t('bgPicker.widthCompact', 'Compact') },
                      ] as const).map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
                  </div>
                </div>
              );
            })()}

            {(() => {
              const currentPos = quickSettings.lowerThirdPosition ?? "center";
              return (
                <div className="dtb-font-weight-row">
                  <span className="dtb-position-label">{t('bgPicker.cardPosition', 'Card position')}</span>
                  <div className="dtb-setting-control">
                    <select
                      className="dtb-select-control"
                      value={currentPos}
                      onChange={(e) => {
                        const value = e.target.value as "left" | "center" | "right";
                        onQuickSettingsChange((prev) => {
                          const nextPatch: Partial<DockFullscreenQuickThemeSettings> = {
                            lowerThirdPosition: value,
                          };
                          if (prev.lowerThirdWidthPreset === "full" && (value === "left" || value === "right")) {
                            nextPatch.lowerThirdWidthPreset = "xl";
                          }
                          return { ...prev, ...nextPatch };
                        });
                      }}
                      aria-label={t('bgPicker.cardPosition', 'Card position')}
                    >
                      {([
                        { value: "left", label: t('common.left', 'Left') },
                        { value: "center", label: t('bgPicker.positionCenter', 'Center') },
                        { value: "right", label: t('common.right', 'Right') },
                      ] as const).map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
                  </div>
                </div>
              );
            })()}

            <div className="dtb-font-weight-row">
              <span className="dtb-position-label">{t('bgPicker.textDirection', 'Text direction')}</span>
              <div className="dtb-setting-control">
                <select
                  className="dtb-select-control"
                  value={compareLowerThirdTextDirection}
                  onChange={(e) => {
                    const direction = e.target.value as "normal" | "inverted";
                    onQuickSettingsChange((prev) => ({ ...prev, lowerThirdTextDirection: direction }));
                  }}
                  aria-label={t('bgPicker.textDirection', 'Text direction')}
                >
                  {(["normal", "inverted"] as const).map((direction) => (
                    <option key={direction} value={direction}>
                      {direction === "normal"
                        ? t('bgPicker.textDirectionNormal', 'Normal')
                        : t('bgPicker.textDirectionInverted', 'Inverted')}
                    </option>
                  ))}
                </select>
                <Icon name="expand_more" size={12} className="dtb-setting-control__chevron" />
              </div>
            </div>
          </div>
        )}
      </div>

      {resolvedCompareBackdropValue === "color" && (
        <ColorSection
          quickSettings={quickSettings}
          onQuickSettingsChange={onQuickSettingsChange}
          onBackgroundPresetChange={onBackgroundPresetChange}
        />
      )}
      {resolvedCompareBackdropValue === "pattern" && (
        <PatternTab
          quickSettings={quickSettings}
          onQuickSettingsChange={onQuickSettingsChange}
          onBackgroundPresetChange={onBackgroundPresetChange}
          limit={patternLimit}
        />
      )}
      {resolvedCompareBackdropValue === "image" && (
        <ImageTab
          quickSettings={quickSettings}
          onQuickSettingsChange={onQuickSettingsChange}
          onBackgroundPresetChange={onBackgroundPresetChange}
          limit={imageLimit}
        />
      )}
      {resolvedCompareBackdropValue === "video" && (
        <VideoTab
          quickSettings={quickSettings}
          onQuickSettingsChange={onQuickSettingsChange}
          onBackgroundPresetChange={onBackgroundPresetChange}
          limit={videoLimit}
        />
      )}

      {/* Style */}
      <div className="dtb-bg-picker__settings" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="dtb-section-title">Style</div>

        <SliderNumberField
          label="Font size"
          value={compare.compareVerseFontSizeLeft}
          min={18} max={120} step={1} unit="px"
          onChange={(value) => applyPatch({
            compareVerseFontSizeLeft: value,
            compareVerseFontSizeRight: value,
            fontSize: value,
            compareAutoFitMaxFontSize: value,
          })}
        />

        <div className="dtb-compare-style-grid">
          <IconSegmentedControl<CompareFontWeight>
            label="Font weight"
            value={compare.compareFontWeightLeft}
            options={getCompareWeightOptions()}
            onChange={(value) => applyPatch({
              compareFontWeightLeft: value,
              compareFontWeightRight: value,
            })}
          />

          <IconSegmentedControl<CompareTextAlign>
            label="Text alignment"
            value={compare.compareTextAlignLeft}
            options={getCompareAlignOptions()}
            onChange={(value) => applyPatch({
              compareTextAlignLeft: value,
              compareTextAlignRight: value,
            })}
          />
        </div>

        <SliderNumberField
          label="Reference font size"
          value={compare.compareReferenceFontSizeLeft}
          min={10} max={160} step={1} unit="px"
          onChange={(value) => applyPatch({
            compareReferenceFontSizeLeft: value,
            compareReferenceFontSizeRight: value,
            refFontSize: value,
          })}
        />

      </div>

      {/* Advanced */}
      <div className="dtb-bg-picker__settings" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          className="dtb-colors__collapsible-header"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <span className="dtb-section-title">Advanced</span>
          <Icon name={advancedOpen ? "expand_less" : "expand_more"} size={14} />
        </button>
        {advancedOpen && (
          <>
            <SelectField
              label="Font family"
              value={compare.compareFontFamilyLeft}
              onChange={(value) => applyPatch({
                compareFontFamilyLeft: value,
                compareFontFamilyRight: value,
              })}
              options={FONT_FAMILY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />

            <SliderNumberField
              label="Line height"
              value={compare.compareLineHeightLeft}
              min={0.9} max={2} step={0.01} unit="x"
              onChange={(value) => applyPatch({
                compareLineHeightLeft: value,
                compareLineHeightRight: value,
              })}
            />

            <SliderNumberField
              label="Outer padding"
              value={compare.compareOuterPaddingTop}
              min={0} max={150} step={1} unit="px"
              onChange={(value) => applyPatch({
                compareOuterPaddingTop: value,
                compareOuterPaddingBottom: value,
                compareOuterPaddingLeft: value,
                compareOuterPaddingRight: value,
                compareLayoutPreset: "custom",
              })}
            />

            <SliderNumberField
              label="Inner padding"
              value={compare.comparePanelInnerPadding}
              min={0} max={80} step={1} unit="px"
              onChange={(value) => applyPatch({
                comparePanelInnerPadding: value,
                compareLayoutPreset: "custom",
              })}
            />

            <SelectField
              label="Reference position"
              value={compare.compareReferencePositionLeft}
              onChange={(value) => applyPatch({
                compareReferencePositionLeft: value,
                compareReferencePositionRight: value,
              })}
              options={COMPARE_META_POSITION_OPTIONS}
            />

            <ReferenceBackgroundSection
              quickSettings={quickSettings}
              onQuickSettingsChange={onQuickSettingsChange}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Inline Color Picker ── */
function ColorPickerCard({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`dtb-color-picker-card${className ? ` ${className}` : ""}`}>
      <span className="dtb-color-picker-card__label">{label}</span>
      <InlineColorPicker value={value} onChange={onChange} variant="card" label={label} />
    </div>
  );
}

function InlineColorPicker({
  value,
  onChange,
  variant = "inline",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  variant?: "inline" | "card";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hexInput, setHexInput] = useState(value);
  const normalizedValue = value.toUpperCase();

  useEffect(() => { setHexInput(value); }, [value]);

  const openPopover = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 240);
    const left = Math.min(rect.left, window.innerWidth - 210);
    setPos({ top, left: Math.max(8, left) });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const commitHex = useCallback(() => {
    const cleaned = hexInput.trim().replace(/^#/, "");
    if (/^[\da-f]{6}$/i.test(cleaned)) {
      onChange(`#${cleaned.toUpperCase()}`);
    } else {
      setHexInput(value);
    }
  }, [hexInput, value, onChange]);

  return (
    <>
      <button
        type="button"
        className={`dtb-color-inline__trigger${variant === "card" ? " dtb-color-inline__trigger--card" : ""}`}
        ref={triggerRef}
        onClick={openPopover}
        aria-label={`${label || "Color"}: ${normalizedValue}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={variant === "card" ? `Choose ${label || "color"}` : undefined}
      >
        {variant === "card" ? (
          <div className="dtb-color-inline__card-inner">
            <span className="dtb-color-inline__card-swatch" style={{ backgroundColor: value }} />
            <span className="dtb-color-inline__card-divider" />
            <span className="dtb-color-inline__card-wheel" aria-hidden="true" />
          </div>
        ) : (
          <>
            <span className="dtb-color-inline__preview" style={{ backgroundColor: value }} />
            <span className="dtb-color-inline__meta">
              <span className="dtb-color-inline__eyebrow">Color</span>
              <span className="dtb-color-inline__hex">{normalizedValue}</span>
            </span>
            <Icon name={open ? "expand_less" : "expand_more"} size={14} className="dtb-color-inline__chevron" />
          </>
        )}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="dtb-color-inline__popover"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 10000 }}
          role="dialog"
          aria-label={`Choose ${label || "color"}`}
        >
          <div className="dtb-color-inline__popover-header">
            <span className="dtb-color-inline__popover-preview" style={{ backgroundColor: value }} />
            <div className="dtb-color-inline__popover-copy">
              <span className="dtb-color-inline__popover-label">Selected color</span>
              <span className="dtb-color-inline__popover-value">{normalizedValue}</span>
            </div>
          </div>
          <div className="dtb-color-inline__swatches">
            {INLINE_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`dtb-color-inline__swatch${normalizedValue === swatch ? " dtb-color-inline__swatch--active" : ""}`}
                style={{ backgroundColor: swatch }}
                onClick={() => onChange(swatch)}
                aria-label={swatch}
                title={swatch}
              />
            ))}
          </div>
          <HexColorPicker color={value} onChange={onChange} />
          <div className="dtb-color-inline__input-row">
            <span className="dtb-color-inline__hash">#</span>
            <input
              className="dtb-color-inline__hex-input"
              type="text"
              maxLength={6}
              value={hexInput.replace(/^#/, "")}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => { if (e.key === "Enter") commitHex(); }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
