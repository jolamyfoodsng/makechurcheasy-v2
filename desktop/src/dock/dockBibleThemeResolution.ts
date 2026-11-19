import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import { BIBLE_BUILTIN_THEMES } from "../bible/bibleThemes";
import {
  BOOK_ABBREVS,
  DEFAULT_THEME_SETTINGS,
  LOWER_THIRD_SIZE_PRESETS,
  type BibleTheme,
  type BibleThemeSettings,
} from "../bible/types";
import { withScriptureFontFallback } from "../bible/scriptureFont";
import { themeSupportsBibleOverlayMode } from "../bible/themeVariantSupport";
import type { DockFullscreenQuickThemeSettings } from "./components/DockFullscreenThemeQuickSettings";
import { normalizeCompareThemeSettings } from "./compareThemeConfig";
import {
  buildDockBackgroundPresetOverrides,
  type DockBackgroundPreset,
} from "./dockConsoleTheme";
import { loadDockCustomBibleThemes, loadDockFavoriteBibleThemes } from "./dockThemeData";
import {
  buildLinkedLowerThirdQuickThemeSettings,
  LOWER_THIRD_FIT_MIN_FONT_SIZE,
  LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
  LOWER_THIRD_FONT_SIZE_MAX,
  LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
} from "./lowerThirdQuickSettings";
import { readNativeDockSetting } from "../services/localDockSettings";
import { readUserScopedStorage } from "../services/userScopedStorage";
import { pickLayoutAdjust } from "../themes/layout/adjust";

export type DockBibleOverlayMode = "fullscreen" | "lower-third";
export type DockBibleReferenceFormat = "full" | "short" | "hidden";

export interface DockBibleOutputPreferences {
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  fullscreenQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  lowerThirdQuickThemeSettingsLinkedToFullscreen?: boolean;
  referenceFormat?: DockBibleReferenceFormat;
  referenceVersionVisible?: boolean;
  /** Saved by the Bible tab; lets other tabs (LM) follow the Bible tab's mode and line count. */
  overlayMode?: DockBibleOverlayMode;
  verseLineCount?: number;
  fullscreenVerseLineCount?: number;
  lowerThirdVerseLineCount?: number;
}

export interface DockBibleResolvedOutputTheme {
  overlayMode: DockBibleOverlayMode;
  theme: BibleTheme;
  themeId: string;
  themeSettings: Record<string, unknown>;
  liveOverrides: Record<string, unknown> | null;
}

export const DOCK_BIBLE_PREFS_KEY = "ocs-dock-bible-preferences";
const DEFAULT_BIBLE_REFERENCE_FORMAT: DockBibleReferenceFormat = "full";

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readScopedStorage(baseKey: string): string | null {
  const value = readNativeDockSetting<unknown>(baseKey);
  if (value !== undefined && value !== null) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return readUserScopedStorage(baseKey);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function numberValue(
  source: Record<string, unknown>,
  key: keyof DockFullscreenQuickThemeSettings,
  fallback: number,
  min: number,
  max: number,
): number {
  return clampNumber(Number(source[key] ?? fallback), min, max);
}

function stringValue(
  source: Record<string, unknown>,
  key: keyof DockFullscreenQuickThemeSettings,
  fallback: string,
): string {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function boolValue(
  source: Record<string, unknown>,
  key: keyof DockFullscreenQuickThemeSettings,
  fallback: boolean,
): boolean {
  return typeof source[key] === "boolean" ? source[key] as boolean : fallback;
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  key: keyof DockFullscreenQuickThemeSettings,
  fallback: T,
  values: readonly T[],
): T {
  const value = source[key];
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function colorValue(
  source: Record<string, unknown>,
  key: keyof DockFullscreenQuickThemeSettings,
  fallback: string,
): string {
  const value = source[key];
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function sanitizeCssPadding(value: unknown, fallback = DEFAULT_THEME_SETTINGS.lowerThirdCardPadding ?? "18px 28px"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^-?\d+(?:\.\d+)?px(?:\s+-?\d+(?:\.\d+)?px){0,3}$/.test(trimmed)
    ? trimmed
    : fallback;
}

function sanitizeLowerThirdEdge(value: unknown): BibleThemeSettings["lowerThirdEdge"] {
  return value === "top" || value === "bottom" || value === "left" || value === "right"
    ? value
    : DEFAULT_THEME_SETTINGS.lowerThirdEdge;
}

function sanitizeLowerThirdPaddingLinked(value: unknown): boolean {
  return typeof value === "boolean" ? value : Boolean(DEFAULT_THEME_SETTINGS.lowerThirdPaddingLinked);
}

function sanitizeLowerThirdCardRadius(value: unknown): number {
  return clampNumber(Number(value ?? DEFAULT_THEME_SETTINGS.lowerThirdCardRadius ?? 18), 0, 64);
}

function sanitizeLowerThirdTextDirection(value: unknown): BibleThemeSettings["lowerThirdTextDirection"] {
  return value === "inverted" ? "inverted" : "normal";
}

function sanitizeBackgroundType(value: unknown): DockFullscreenQuickThemeSettings["backgroundType"] | undefined {
  return value === "off" ||
    value === "theme" ||
    value === "color" ||
    value === "image" ||
    value === "pattern" ||
    value === "video"
    ? value
    : undefined;
}

function sanitizeBibleReferenceFormat(value: unknown): DockBibleReferenceFormat {
  return value === "short" || value === "hidden" || value === "full"
    ? value
    : DEFAULT_BIBLE_REFERENCE_FORMAT;
}

function sanitizeReferenceVersionVisible(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function abbreviateBibleBookCompact(book: string): string {
  const aliases = BOOK_ABBREVS[book]
    ?.map((alias) => alias.replace(/\s+/g, "").trim())
    .filter(Boolean);
  if (aliases?.length) {
    const preferred = aliases
      .map((alias, index) => ({ alias, index }))
      .sort((a, b) => a.alias.length - b.alias.length || b.index - a.index)[0]?.alias;
    if (preferred) return preferred.toUpperCase();
  }

  return book
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : part.slice(0, 3)))
    .join("")
    .toUpperCase();
}

export function buildDockBibleReferenceBaseLabel(
  book: string,
  chapter: number,
  verseRange: string,
  format: DockBibleReferenceFormat,
): string {
  if (format === "hidden") return "";
  const bookLabel = format === "short" ? abbreviateBibleBookCompact(book) : book;
  return `${bookLabel} ${chapter}:${verseRange}`;
}

export function appendDockBibleVersionToReference(
  reference: string,
  translation: string,
  showVersion: boolean,
): string {
  const ref = reference.trim();
  const version = showVersion ? translation.trim().toUpperCase() : "";
  if (ref && version) return `${ref} (${version})`;
  return ref || version;
}

export function resolveDockBibleReferenceLabels(
  book: string,
  chapter: number,
  verseRange: string,
  translation: string,
  prefs: DockBibleOutputPreferences = loadDockBibleOutputPreferences(),
): {
  rawReferenceLabel: string;
  referenceBaseLabel: string;
  displayReferenceLabel: string;
} {
  const referenceFormat = sanitizeBibleReferenceFormat(prefs.referenceFormat);
  const referenceVersionVisible = sanitizeReferenceVersionVisible(prefs.referenceVersionVisible);
  const rawReferenceLabel = `${book} ${chapter}:${verseRange}`;
  const referenceBaseLabel = buildDockBibleReferenceBaseLabel(book, chapter, verseRange, referenceFormat);
  return {
    rawReferenceLabel,
    referenceBaseLabel,
    displayReferenceLabel: appendDockBibleVersionToReference(
      referenceBaseLabel,
      translation,
      referenceVersionVisible,
    ),
  };
}

export function loadDockBibleOutputPreferences(): DockBibleOutputPreferences {
  if (typeof localStorage === "undefined") return {};
  const parsed = safeJsonParse<unknown>(readScopedStorage(DOCK_BIBLE_PREFS_KEY), {});
  return parsed && typeof parsed === "object" ? parsed as DockBibleOutputPreferences : {};
}

const FAINT_REF_HEXES = new Set([
  "#AAAAAA", "#AEB9D1", "#C9D2E5", "#CCCCCC", "#E0E0E0", "#888888", "#CBD5E1", "#94A3B8", "#64748B"
]);

export function resolveEffectiveRefColor(refColor?: string, fontColor?: string): string {
  const normalizedRef = (refColor || "").trim().toUpperCase();
  const normalizedFont = (fontColor || "").trim().toUpperCase() || "#FFFFFF";
  if (!normalizedRef || FAINT_REF_HEXES.has(normalizedRef)) {
    return normalizedFont;
  }
  return normalizedRef;
}

export function resolveEffectiveRefFontSize(refFontSize?: number, fontSize?: number): number {
  const baseSize = fontSize && fontSize > 0 ? fontSize : 48;
  if (refFontSize && refFontSize > 0 && refFontSize < baseSize) {
    return refFontSize;
  }
  return Math.max(14, Math.round(baseSize * 0.7));
}

export function resolveEffectiveRefFontWeight(
  refFontWeight?: "normal" | "bold" | "light" | "extrabold" | "black",
  fontWeight?: "normal" | "bold" | "light" | "extrabold" | "black",
): "normal" | "bold" | "light" | "extrabold" | "black" {
  if (refFontWeight && refFontWeight !== "normal") {
    return refFontWeight;
  }
  // Follow the verse weight, including Regular. Previously a Regular verse
  // forced the reference back to Black.
  return fontWeight || "black";
}

export function resolveThemeForBibleOverlayMode(
  theme: BibleTheme,
  mode: DockBibleOverlayMode,
): BibleTheme {
  const variant = mode === "lower-third"
    ? theme.variants?.lowerThird
    : theme.variants?.fullscreen;
  return variant
    ? { ...theme, settings: variant.settings, rawTemplate: variant.rawTemplate }
    : theme;
}

export function extractFullscreenQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  const compareSettings = normalizeCompareThemeSettings(settings as unknown as Record<string, unknown>);
  const fontColor = settings.fontColor || DEFAULT_THEME_SETTINGS.fontColor;
  const fontSize = clampNumber(settings.fontSize, 28, 200);
  const fontWeight = settings.fontWeight || "black";
  return {
    backgroundType,
    fontSize,
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(settings.fontFamily || DEFAULT_THEME_SETTINGS.fontFamily),
    refFontSize: clampNumber(resolveEffectiveRefFontSize(settings.refFontSize, fontSize), 10, 150),
    refFontWeight: resolveEffectiveRefFontWeight(settings.refFontWeight, fontWeight),
    fontColor,
    refFontColor: resolveEffectiveRefColor(settings.refFontColor, fontColor),
    refPosition: settings.refPosition || DEFAULT_THEME_SETTINGS.refPosition,
    refAnchor: settings.refAnchor || DEFAULT_THEME_SETTINGS.refAnchor || "normal",
    refTextTransform: settings.refTextTransform || DEFAULT_THEME_SETTINGS.refTextTransform,
    refLetterSpacing: clampNumber(settings.refLetterSpacing, 0, 10),
    refOpacity: clampNumber(settings.refOpacity, 0, 1),
    refTextAlign: settings.refTextAlign || DEFAULT_THEME_SETTINGS.refTextAlign,
    refSpacing: clampNumber(settings.refSpacing, 0, 150),
    fullscreenShadeColor: settings.fullscreenShadeColor || DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
    fullscreenShadeOpacity: clampNumber(settings.fullscreenShadeOpacity, 0, 1),
    textAlign: settings.textAlign || DEFAULT_THEME_SETTINGS.textAlign,
    lineHeight: clampNumber(settings.lineHeight, 1.05, 1.8),
    letterSpacing: clampNumber(settings.letterSpacing ?? 0, -2, 20),
    wordSpacing: clampNumber(settings.wordSpacing ?? 0, -5, 40),
    fontWeight: settings.fontWeight || DEFAULT_THEME_SETTINGS.fontWeight,
    fontStyle: settings.fontStyle || DEFAULT_THEME_SETTINGS.fontStyle,
    textTransform: settings.textTransform || DEFAULT_THEME_SETTINGS.textTransform,
    textShadow: settings.textShadow ?? DEFAULT_THEME_SETTINGS.textShadow,
    textOutline: settings.textOutline ?? DEFAULT_THEME_SETTINGS.textOutline,
    textOutlineColor: settings.textOutlineColor || DEFAULT_THEME_SETTINGS.textOutlineColor,
    textOutlineWidth: clampNumber(settings.textOutlineWidth ?? DEFAULT_THEME_SETTINGS.textOutlineWidth ?? 4, 0, 12),
    animation: settings.animation ?? DEFAULT_THEME_SETTINGS.animation,
    animationDuration: settings.animationDuration ?? DEFAULT_THEME_SETTINGS.animationDuration,
    backgroundImage: settings.backgroundImage ?? "",
    backgroundImageFilePath: settings.backgroundImageFilePath ?? "",
    backgroundVideo: settings.backgroundVideo ?? "",
    backgroundVideoFilePath: settings.backgroundVideoFilePath ?? "",
    backgroundOpacity: clampNumber(settings.backgroundOpacity ?? 1, 0, 1),
    backgroundColor: settings.backgroundColor || DEFAULT_THEME_SETTINGS.backgroundColor || "#0B1426",
    backgroundColorEnd: settings.backgroundColorEnd || DEFAULT_THEME_SETTINGS.backgroundColorEnd || "#162040",
    bgGradientAngle: clampNumber(settings.bgGradientAngle ?? DEFAULT_THEME_SETTINGS.bgGradientAngle ?? 180, 0, 360),
    referenceBackgroundEnabled: settings.referenceBackgroundEnabled ?? false,
    referenceBackgroundColor: settings.referenceBackgroundColor || DEFAULT_THEME_SETTINGS.referenceBackgroundColor,
    referenceBackgroundStyle: settings.referenceBackgroundStyle || DEFAULT_THEME_SETTINGS.referenceBackgroundStyle,
    referenceBackgroundRadius: clampNumber(settings.referenceBackgroundRadius ?? 12, 0, 40),
    lowerThirdPosition: settings.lowerThirdPosition || DEFAULT_THEME_SETTINGS.lowerThirdPosition,
    lowerThirdSize: settings.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize,
    lowerThirdWidthPreset: settings.lowerThirdWidthPreset || DEFAULT_THEME_SETTINGS.lowerThirdWidthPreset,
    lowerThirdOffsetX: clampNumber(settings.lowerThirdOffsetX ?? 0, -500, 500),
    backgroundPattern: settings.backgroundPattern ?? DEFAULT_THEME_SETTINGS.backgroundPattern ?? "",
    lowerThirdCaptionPosition: settings.lowerThirdCaptionPosition || "bottom",
    lowerThirdEdge: sanitizeLowerThirdEdge(settings.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(settings.lowerThirdCardPadding),
    lowerThirdBarMaxHeight: clampNumber(Number(settings.lowerThirdBarMaxHeight ?? 600), 120, 900),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(settings.lowerThirdPaddingLinked),
    boxBackground: settings.boxBackground || (settings.backgroundColor ? settings.backgroundColor : ""),
    boxBackgroundImage: settings.boxBackgroundImage || "",
    boxOpacity: clampNumber(settings.boxOpacity ?? 1, 0, 1),
    borderRadius: clampNumber(settings.borderRadius ?? settings.lowerThirdCardRadius ?? 16, 0, 64),
    padding: typeof settings.padding === "number" ? settings.padding : 28,
    safeArea: typeof settings.safeArea === "number" ? settings.safeArea : 40,
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(settings.lowerThirdCardRadius ?? settings.borderRadius),
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(settings.lowerThirdTextDirection),
    compareTranslationWidth: settings.compareTranslationWidth ?? DEFAULT_THEME_SETTINGS.compareTranslationWidth,
    ...compareSettings,
    // Layer-theme sizes set in the Dock (text / reference size, line height, title, position)
    // must survive being re-read from the live theme, or the panel resets to 100%.
    ...pickLayoutAdjust(settings),
  };
}

export function buildDefaultLowerThirdQuickThemeSettings(
  settings: BibleThemeSettings,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): DockFullscreenQuickThemeSettings {
  const base = extractFullscreenQuickThemeSettings(settings, backgroundType);
  const sizePreset =
    LOWER_THIRD_SIZE_PRESETS[settings.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize] ||
    LOWER_THIRD_SIZE_PRESETS.medium;
  const lowerThirdFontSize = typeof settings.fontSize === "number" && settings.fontSize > 0
    ? settings.fontSize
    : (sizePreset.fontSize || 48);
  const lowerThirdRefFontSize = typeof settings.refFontSize === "number" && settings.refFontSize > 0
    ? settings.refFontSize
    : (sizePreset.refFontSize || Math.round(lowerThirdFontSize * 0.7));

  return {
    ...base,
    fontSize: lowerThirdFontSize,
    refFontSize: lowerThirdRefFontSize,
    textAlign: settings.textAlign || base.textAlign || "center",
    lineHeight: settings.lineHeight ?? sizePreset.lineHeight,
    refSpacing: settings.refSpacing ?? 14,
    lowerThirdBarMaxHeight: settings.lowerThirdBarMaxHeight ?? sizePreset.maxHeight,
    compareVerseFontSizeLeft: Math.min(36, base.compareVerseFontSizeLeft || 34),
    compareVerseFontSizeRight: Math.min(36, base.compareVerseFontSizeRight || 34),
    compareReferenceFontSizeLeft: Math.min(24, base.compareReferenceFontSizeLeft || 22),
    compareReferenceFontSizeRight: Math.min(24, base.compareReferenceFontSizeRight || 22),
  };
}

function normalizeQuickThemeSettings(
  value: unknown,
  base: DockFullscreenQuickThemeSettings,
  mode: DockBibleOverlayMode,
): DockFullscreenQuickThemeSettings | null {
  const source = asRecord(value);
  if (!source) return null;
  const compareSettings = normalizeCompareThemeSettings(source);
  const fontSizeMin = mode === "lower-third" ? LOWER_THIRD_FIT_MIN_FONT_SIZE : 16;
  const fontSizeMax = mode === "lower-third" ? LOWER_THIRD_FONT_SIZE_MAX : 200;
  const refFontSizeMin = mode === "lower-third" ? LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE : 10;
  const refFontSizeMax = mode === "lower-third" ? LOWER_THIRD_REFERENCE_FONT_SIZE_MAX : 150;

  const rawFontColor = colorValue(source, "fontColor", base.fontColor);
  const rawRefFontColor = colorValue(source, "refFontColor", base.refFontColor);
  const fontColor = rawFontColor || base.fontColor;
  const refFontColor = resolveEffectiveRefColor(rawRefFontColor, fontColor);
  const rawFontWeight = oneOf(source, "fontWeight", base.fontWeight, ["light", "normal", "bold", "extrabold", "black"] as const);
  const rawRefFontWeight = oneOf(source, "refFontWeight", base.refFontWeight, ["light", "normal", "bold", "extrabold", "black"] as const);
  const fontWeight = rawFontWeight || "bold";
  const refFontWeight = resolveEffectiveRefFontWeight(rawRefFontWeight, fontWeight);

  const rawBgType = sanitizeBackgroundType(source.backgroundType);
  const bgType = rawBgType ?? base.backgroundType;
  const isColor = bgType === "color";
  const isPattern = bgType === "pattern";
  const isImage = bgType === "image";
  const isVideo = bgType === "video";
  const isOff = bgType === "off";

  const backgroundImage = isOff || isColor || isPattern || isVideo
    ? ""
    : stringValue(source, "backgroundImage", base.backgroundImage);
  const backgroundImageFilePath = isOff || isColor || isPattern || isVideo
    ? ""
    : stringValue(source, "backgroundImageFilePath", base.backgroundImageFilePath ?? "");
  const backgroundPattern = isOff || isColor || isImage || isVideo
    ? ""
    : stringValue(source, "backgroundPattern", base.backgroundPattern);
  const backgroundVideo = isOff || isColor || isPattern || isImage
    ? ""
    : stringValue(source, "backgroundVideo", base.backgroundVideo);
  const backgroundVideoFilePath = isOff || isColor || isPattern || isImage
    ? ""
    : stringValue(source, "backgroundVideoFilePath", base.backgroundVideoFilePath ?? "");
  const backgroundOpacity = isOff
    ? 0
    : numberValue(source, "backgroundOpacity", base.backgroundOpacity, 0, 1);
  const fullscreenShadeOpacity = isOff
    ? 0
    : numberValue(source, "fullscreenShadeOpacity", base.fullscreenShadeOpacity, 0, 1);
  const backgroundColor = isOff
    ? ""
    : isColor
      ? colorValue(source, "backgroundColor", base.backgroundColor || "#0F172A")
      : colorValue(source, "backgroundColor", base.backgroundColor);
  const backgroundColorEnd = isOff
    ? ""
    : isColor
      ? colorValue(source, "backgroundColorEnd", base.backgroundColorEnd || "")
      : colorValue(source, "backgroundColorEnd", base.backgroundColorEnd || "#162040");

  return {
    fontSize: numberValue(source, "fontSize", base.fontSize, fontSizeMin, fontSizeMax),
    autoFontScale: true,
    fontFamily: withScriptureFontFallback(stringValue(source, "fontFamily", base.fontFamily)),
    refFontSize: numberValue(source, "refFontSize", base.refFontSize, refFontSizeMin, refFontSizeMax),
    refFontWeight,
    fontColor,
    refFontColor,
    refPosition: oneOf(source, "refPosition", base.refPosition, ["top", "bottom"] as const),
    refAnchor: oneOf(source, "refAnchor", base.refAnchor ?? "normal", ["top", "bottom", "normal"] as const),
    refTextTransform: oneOf(source, "refTextTransform", base.refTextTransform, ["none", "uppercase", "lowercase", "capitalize"] as const),
    refLetterSpacing: numberValue(source, "refLetterSpacing", base.refLetterSpacing, 0, 10),
    refOpacity: numberValue(source, "refOpacity", base.refOpacity, 0, 1),
    refTextAlign: oneOf(source, "refTextAlign", base.refTextAlign, ["left", "center", "right", "match"] as const),
    refSpacing: numberValue(source, "refSpacing", base.refSpacing, 0, 150),
    fullscreenShadeColor: colorValue(source, "fullscreenShadeColor", base.fullscreenShadeColor),
    fullscreenShadeOpacity,
    textAlign: oneOf(source, "textAlign", base.textAlign, ["left", "center", "right"] as const),
    lineHeight: numberValue(source, "lineHeight", base.lineHeight, 1.05, 1.8),
    letterSpacing: numberValue(source, "letterSpacing", base.letterSpacing ?? 0, -2, 20),
    wordSpacing: numberValue(source, "wordSpacing", base.wordSpacing ?? 0, -5, 40),
    fontWeight: oneOf(source, "fontWeight", base.fontWeight, ["light", "normal", "bold", "extrabold", "black"] as const),
    fontStyle: oneOf(source, "fontStyle", base.fontStyle ?? "normal", ["normal", "italic"] as const),
    textTransform: oneOf(source, "textTransform", base.textTransform, ["none", "uppercase", "lowercase", "capitalize"] as const),
    textShadow: stringValue(source, "textShadow", base.textShadow),
    textOutline: boolValue(source, "textOutline", base.textOutline === true),
    textOutlineColor: colorValue(source, "textOutlineColor", base.textOutlineColor || "#000000"),
    textOutlineWidth: numberValue(source, "textOutlineWidth", base.textOutlineWidth ?? 2, 0, 10),
    animation: oneOf(source, "animation", base.animation, ["none", "fade", "slide-up", "slide-left", "scale-in", "reveal-bg-then-text"] as const),
    animationDuration: numberValue(source, "animationDuration", base.animationDuration, 100, 2000),
    backgroundImage,
    backgroundImageFilePath,
    backgroundPattern,
    backgroundVideo,
    backgroundVideoFilePath,
    backgroundOpacity,
    backgroundColor,
    backgroundColorEnd,
    bgGradientAngle: numberValue(source, "bgGradientAngle", base.bgGradientAngle ?? 180, 0, 360),
    referenceBackgroundEnabled: boolValue(source, "referenceBackgroundEnabled", base.referenceBackgroundEnabled === true),
    referenceBackgroundColor: colorValue(source, "referenceBackgroundColor", base.referenceBackgroundColor),
    referenceBackgroundStyle: oneOf(source, "referenceBackgroundStyle", base.referenceBackgroundStyle, ["solid", "pill", "outline"] as const),
    referenceBackgroundRadius: numberValue(source, "referenceBackgroundRadius", base.referenceBackgroundRadius, 0, 40),
    lowerThirdPosition: oneOf(source, "lowerThirdPosition", base.lowerThirdPosition, ["left", "center", "right"] as const),
    lowerThirdSize: oneOf(source, "lowerThirdSize", base.lowerThirdSize, ["smallest", "smaller", "small", "medium", "big", "bigger", "biggest"] as const),
    lowerThirdWidthPreset: oneOf(source, "lowerThirdWidthPreset", base.lowerThirdWidthPreset, ["full", "sm", "md", "lg", "xl", "xxl"] as const),
    lowerThirdOffsetX: numberValue(source, "lowerThirdOffsetX", base.lowerThirdOffsetX ?? 0, -500, 500),
    lowerThirdCaptionPosition: oneOf(source, "lowerThirdCaptionPosition", base.lowerThirdCaptionPosition, ["top", "bottom"] as const),
    lowerThirdEdge: sanitizeLowerThirdEdge(source.lowerThirdEdge ?? base.lowerThirdEdge),
    lowerThirdCardPadding: sanitizeCssPadding(source.lowerThirdCardPadding ?? base.lowerThirdCardPadding),
    lowerThirdBarMaxHeight: numberValue(
      source,
      "lowerThirdBarMaxHeight",
      base.lowerThirdBarMaxHeight ?? 600,
      120,
      900,
    ),
    lowerThirdPaddingLinked: sanitizeLowerThirdPaddingLinked(source.lowerThirdPaddingLinked ?? base.lowerThirdPaddingLinked),
    boxBackground: typeof source.boxBackground === "string" ? source.boxBackground : base.boxBackground,
    boxBackgroundImage: typeof source.boxBackgroundImage === "string" ? source.boxBackgroundImage : base.boxBackgroundImage,
    boxOpacity: numberValue(source, "boxOpacity", base.boxOpacity ?? 1, 0, 1),
    borderRadius: numberValue(source, "borderRadius", base.borderRadius ?? 16, 0, 64),
    padding: numberValue(source, "padding", base.padding ?? 28, 0, 200),
    safeArea: numberValue(source, "safeArea", base.safeArea ?? 40, 0, 200),
    lowerThirdCardRadius: sanitizeLowerThirdCardRadius(source.lowerThirdCardRadius ?? source.borderRadius ?? base.lowerThirdCardRadius),
    lowerThirdTextDirection: sanitizeLowerThirdTextDirection(source.lowerThirdTextDirection ?? base.lowerThirdTextDirection),
    compareTranslationWidth: numberValue(source, "compareTranslationWidth", base.compareTranslationWidth, 30, 50),
    backgroundType: bgType,
    // Dock sizes for layer themes (text / reference size, line height, title, position).
    // Without this the saved values were dropped here and the Dock went back to 100%.
    ...pickLayoutAdjust(base),
    ...pickLayoutAdjust(source),
    ...compareSettings,
  };
}

export function applyFullscreenQuickThemeSettings(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null,
): BibleTheme {
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
  const usePatternBg = bgType === "pattern";
  const useImageBg = bgType === "image";
  const useVideoBg = bgType === "video";
  const compareSettings = normalizeCompareThemeSettings(quickSettings as Record<string, unknown>);

  return {
    ...theme,
    settings: {
      ...theme.settings,
      backgroundType: bgType,
      // Size / position tweaks for layer themes (ignored by legacy themes).
      ...pickLayoutAdjust(quickSettings),
      fontSize: quickSettings.fontSize,
      autoFontScale: true,
      fontFamily: quickSettings.fontFamily,
      refFontSize: quickSettings.refFontSize,
      fontColor: quickSettings.fontColor,
      refFontColor: quickSettings.refFontColor,
      refPosition: quickSettings.refPosition,
      refAnchor: quickSettings.refAnchor ?? "normal",
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
      letterSpacing: quickSettings.letterSpacing,
      wordSpacing: quickSettings.wordSpacing,
      fontWeight: quickSettings.fontWeight,
      refFontWeight: quickSettings.refFontWeight,
      textTransform: quickSettings.textTransform,
      textShadow: quickSettings.textShadow,
      textOutline: quickSettings.textOutline,
      textOutlineColor: quickSettings.textOutlineColor,
      textOutlineWidth: quickSettings.textOutlineWidth,
      animation: quickSettings.animation,
      animationDuration: quickSettings.animationDuration,
      backgroundImage: useNoBg || useColorBg || usePatternBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImage ?? "")
          : quickSettings.backgroundImage,
      backgroundImageFilePath: useNoBg || useColorBg || usePatternBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundImageFilePath ?? "")
          : quickSettings.backgroundImageFilePath,
      backgroundVideo: useNoBg || useColorBg || usePatternBg || useImageBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideo ?? "")
          : quickSettings.backgroundVideo,
      backgroundVideoFilePath: useNoBg || useColorBg || usePatternBg || useImageBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundVideoFilePath ?? "")
          : quickSettings.backgroundVideoFilePath,
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
      // Keep the last pattern in quick settings so the picker can restore it
      // after a temporary color/video switch, but only send it to the overlay
      // while Pattern is the active background mode.
      backgroundPattern: useNoBg || useColorBg || useImageBg || useVideoBg
        ? ""
        : useThemeBg
          ? (theme.settings.backgroundPattern ?? "")
          : quickSettings.backgroundPattern,
      // Off and Colour drop the theme's text box and its picture: only the words stay, on
      // nothing (Off) or on the picked colour (Colour).
      boxBackground: useNoBg || useColorBg
        ? "transparent"
        : (quickSettings.boxBackground || theme.settings.boxBackground || "rgba(15, 23, 42, 0.85)"),
      boxBackgroundImage: useNoBg || useColorBg ? "" : (quickSettings.boxBackgroundImage ?? theme.settings.boxBackgroundImage ?? ""),
      boxOpacity: quickSettings.boxOpacity ?? theme.settings.boxOpacity ?? 1,
      borderRadius: quickSettings.borderRadius ?? theme.settings.borderRadius ?? 16,
      referenceBackgroundEnabled: quickSettings.referenceBackgroundEnabled,
      referenceBackgroundColor: quickSettings.referenceBackgroundColor,
      referenceBackgroundStyle: quickSettings.referenceBackgroundStyle,
      referenceBackgroundRadius: quickSettings.referenceBackgroundRadius,
      fontStyle: quickSettings.fontStyle,
      lowerThirdPosition: quickSettings.lowerThirdPosition,
      lowerThirdSize: quickSettings.lowerThirdSize,
      lowerThirdWidthPreset: quickSettings.lowerThirdWidthPreset,
      lowerThirdOffsetX: quickSettings.lowerThirdOffsetX,
      lowerThirdCaptionPosition: quickSettings.lowerThirdCaptionPosition,
      lowerThirdEdge: quickSettings.lowerThirdEdge,
      lowerThirdCardPadding: quickSettings.lowerThirdCardPadding,
      lowerThirdBarMaxHeight: quickSettings.lowerThirdBarMaxHeight,
      lowerThirdPaddingLinked: quickSettings.lowerThirdPaddingLinked,
      lowerThirdCardRadius: quickSettings.lowerThirdCardRadius,
      lowerThirdTextDirection: quickSettings.lowerThirdTextDirection,
      ...compareSettings,
    },
  };
}

export function applyLowerThirdQuickThemeSettings(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null,
): BibleTheme {
  const themed = applyFullscreenQuickThemeSettings(theme, quickSettings);
  const sizePreset =
    LOWER_THIRD_SIZE_PRESETS[quickSettings?.lowerThirdSize || DEFAULT_THEME_SETTINGS.lowerThirdSize] ||
    LOWER_THIRD_SIZE_PRESETS.medium;
  return {
    ...themed,
    settings: {
      ...themed.settings,
      padding: sizePreset.padding,
      safeArea: sizePreset.safeArea,
      lowerThirdBarMaxHeight: sizePreset.maxHeight,
    },
  };
}

function getFallbackTheme(
  themes: BibleTheme[],
  mode: DockBibleOverlayMode,
  preferredThemeId?: string,
): BibleTheme {
  const allPool = [...themes, ...BIBLE_BUILTIN_THEMES.filter((bt) => !themes.some((t) => t.id === bt.id))];
  return allPool.find(
    (theme) => theme.id === preferredThemeId && themeSupportsBibleOverlayMode(theme, mode),
  )
    ?? BUILTIN_THEMES.find(
      (theme) => theme.id === preferredThemeId && themeSupportsBibleOverlayMode(theme, mode),
    )
    ?? allPool.find((theme) => themeSupportsBibleOverlayMode(theme, mode))
    ?? BUILTIN_THEMES.find((theme) => themeSupportsBibleOverlayMode(theme, mode))
    ?? BUILTIN_THEMES[0];
}

async function loadAllBibleOutputThemes(): Promise<BibleTheme[]> {
  const themeMap = new Map<string, BibleTheme>();
  for (const theme of BUILTIN_THEMES) {
    themeMap.set(theme.id, theme);
  }
  for (const theme of BIBLE_BUILTIN_THEMES) {
    if (!themeMap.has(theme.id)) {
      themeMap.set(theme.id, theme);
    }
  }

  try {
    const [favoriteThemes, customThemes] = await Promise.all([
      loadDockFavoriteBibleThemes(),
      loadDockCustomBibleThemes(),
    ]);
    for (const theme of [...favoriteThemes, ...customThemes]) {
      themeMap.set(theme.id, theme);
    }
  } catch {
    // Built-ins still give LM a valid saved-style fallback.
  }

  return [...themeMap.values()];
}

function buildFullscreenLiveOverridesForQuickSettings(
  themeSettings: BibleThemeSettings,
  preset: DockBackgroundPreset,
  backgroundType?: DockFullscreenQuickThemeSettings["backgroundType"],
): Record<string, unknown> | null {
  if (backgroundType && backgroundType !== "theme") {
    return null;
  }
  return buildDockBackgroundPresetOverrides(themeSettings, preset) as Record<string, unknown> | null;
}

export async function resolveDockBibleThemeForOverlayMode(
  overlayMode: DockBibleOverlayMode,
  prefs: DockBibleOutputPreferences = loadDockBibleOutputPreferences(),
): Promise<DockBibleResolvedOutputTheme> {
  const allThemes = await loadAllBibleOutputThemes();
  const preferredThemeId = overlayMode === "fullscreen"
    ? prefs.fullscreenThemeId
    : prefs.lowerThirdThemeId;
  const selectedTheme = getFallbackTheme(allThemes, overlayMode, preferredThemeId);
  const baseTheme = resolveThemeForBibleOverlayMode(selectedTheme, overlayMode);

  const baseQuickSettings = overlayMode === "fullscreen"
    ? extractFullscreenQuickThemeSettings(baseTheme.settings, "theme")
    : buildDefaultLowerThirdQuickThemeSettings(baseTheme.settings, "theme");
  const fullscreenBaseTheme = resolveThemeForBibleOverlayMode(
    getFallbackTheme(allThemes, "fullscreen", prefs.fullscreenThemeId),
    "fullscreen",
  );
  const fullscreenBaseQuickSettings = extractFullscreenQuickThemeSettings(fullscreenBaseTheme.settings, "theme");
  const fullscreenQuickSettings = normalizeQuickThemeSettings(
    prefs.fullscreenQuickThemeSettings,
    fullscreenBaseQuickSettings,
    "fullscreen",
  );
  const rawModeQuickSettings = overlayMode === "fullscreen"
    ? prefs.fullscreenQuickThemeSettings
    : prefs.lowerThirdQuickThemeSettings;
  const modeQuickSettings = normalizeQuickThemeSettings(rawModeQuickSettings, baseQuickSettings, overlayMode);
  const quickSettings = overlayMode === "lower-third" && prefs.lowerThirdQuickThemeSettingsLinkedToFullscreen
    ? buildLinkedLowerThirdQuickThemeSettings(baseQuickSettings, fullscreenQuickSettings)
    : modeQuickSettings;
  const effectiveTheme = overlayMode === "fullscreen"
    ? applyFullscreenQuickThemeSettings(baseTheme, quickSettings)
    : applyLowerThirdQuickThemeSettings(baseTheme, quickSettings ?? baseQuickSettings);
  const liveOverrides = overlayMode === "fullscreen"
    ? buildFullscreenLiveOverridesForQuickSettings(
      effectiveTheme.settings,
      prefs.backgroundPreset ?? "theme",
      quickSettings?.backgroundType,
    )
    : null;

  return {
    overlayMode,
    theme: effectiveTheme,
    themeId: effectiveTheme.id,
    themeSettings: effectiveTheme.settings as unknown as Record<string, unknown>,
    liveOverrides,
  };
}
