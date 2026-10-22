/**
 * bible/types.ts — Type definitions for the Bible Module
 *
 * Core types for scripture data, slides, themes, queue, and OBS output.
 */

import type { ThemeLayout } from "../themes/layout/types";

import { getDefaultBibleTheme } from "../services/desktopConfig";
import { QUIET_CLOUDS_PATTERN_SRC } from "../library/backgroundAssets";
import { SCRIPTURE_FONT_FAMILY, withScriptureFontFallback } from "./scriptureFont";

// ---------------------------------------------------------------------------
// Bible Data Types
// ---------------------------------------------------------------------------

export interface BibleVerse {
  book: string;          // e.g. "John"
  chapter: number;
  verse: number;
  text: string;
  /** Canonical abbreviation like "Jn", "Gen" */
  abbrev: string;
}

export interface BiblePassage {
  reference: string;     // "John 3:16-18" or "John 3:16"
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  verses: BibleVerse[];
  translation: string;   // "KJV", "NIV", etc.
}

/**
 * Dynamic translation identifier — no longer a fixed union.
 * Stored as the uppercase abbreviation string (e.g. "KJV", "ESV", "NIV").
 */
export type BibleTranslation = string;

/** Raw Bible JSON: Book → Chapter → Verse → Text */
export type RawBibleData = Record<string, Record<string, Record<string, string>>>;

// ---------------------------------------------------------------------------
// API / Library Types
// ---------------------------------------------------------------------------

/** A Bible in the remote catalog (from API response) */
export interface CatalogBible {
  id: string;
  name: string;
  language: string;
  country: string;
  version: string;
  filename: string;
  filesize: number;
  sha256: string;
}

/** A Bible that has been downloaded and stored locally in IndexedDB */
export interface InstalledBible {
  /** Catalog UUID */
  id: string;
  /** Short abbreviation used as translation key, e.g. "KJV" */
  abbr: string;
  /** Full display name, e.g. "King James Version" */
  name: string;
  /** Language, e.g. "English" */
  language: string;
  /** Parsed Bible data (Book → Chapter → Verse → Text) */
  data: RawBibleData;
  /** ISO timestamp of when this was downloaded */
  downloadedAt: string;
  /** File size in bytes (from catalog) */
  filesize: number;
}

// ---------------------------------------------------------------------------
// Slide System
// ---------------------------------------------------------------------------

export interface BibleSlide {
  id: string;
  /** Rendered text for this slide (may be a portion of a passage) */
  text: string;
  /** Reference label shown on the slide, e.g. "John 3:16 (KJV)" */
  reference: string;
  /** Verse numbers contained in this slide */
  verseRange: string;
  /** Index in the queue item's slide array */
  index: number;
  /** Total slides for this queue item */
  total: number;
}

export interface SlideConfig {
  /** Max lines per slide (default 4) */
  maxLines: number;
  /** Max characters per slide (default 200) */
  maxChars: number;
  /** Show verse numbers inline */
  showVerseNumbers: boolean;
  /** Try to avoid splitting mid-sentence */
  smartSplit: boolean;
}

export const DEFAULT_SLIDE_CONFIG: SlideConfig = {
  maxLines: 4,
  maxChars: 200,
  showVerseNumbers: true,
  smartSplit: true,
};

// ---------------------------------------------------------------------------
// Queue System
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: string;
  passage: BiblePassage;
  slides: BibleSlide[];
  /** Currently active slide index */
  currentSlide: number;
}

// ---------------------------------------------------------------------------
// Theme System (Theme Pack)
// ---------------------------------------------------------------------------

export type BibleThemeCategory = "bible" | "worship" | "general";

/**
 * Raw HTML/CSS template data from all_themes.json lower-third themes.
 * When present, the preview renders the actual template instead of
 * building HTML from BibleThemeSettings.
 */
export interface BibleThemeRawTemplate {
  html: string;
  css: string;
  variables: Array<{
    key: string;
    label: string;
    type: string;
    defaultValue: string;
    placeholder?: string;
    required?: boolean;
    group?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  fontImports?: string[];
  animation?: { name: string; duration: number; easing: string };
  exitAnimation?: { name: string; duration: number; easing: string };
  accentColor?: string;
  /** Default values for rendering the template in preview */
  previewValues?: Record<string, string>;
}

/**
 * A single variant's settings + optional raw template.
 * One theme can contain up to two variants: fullscreen and lowerThird.
 */
export interface BibleThemeVariant {
  settings: BibleThemeSettings;
  rawTemplate?: BibleThemeRawTemplate;
}

export interface BibleThemeVariants {
  fullscreen?: BibleThemeVariant;
  lowerThird?: BibleThemeVariant;
}

export interface BibleTheme {
  id: string;
  name: string;
  description?: string;
  /** "builtin" for shipped themes, "custom" for user-created */
  source: "builtin" | "custom";
  /** Template type this theme uses (primary variant for backward compat) */
  templateType: BibleTemplateType;
  /** Category for filtering in the Templates Library */
  category?: BibleThemeCategory;
  /** Optional multi-category mapping for custom themes */
  categories?: BibleThemeCategory[];
  /** Theme settings (primary variant's settings for backward compat) */
  settings: BibleThemeSettings;
  /** Preview thumbnail data URL (optional) */
  preview?: string;
  /** Whether this theme is hidden from the theme picker modal */
  hidden?: boolean;
  /** Raw HTML/CSS template from all_themes.json (for lower-third templates, primary variant) */
  rawTemplate?: BibleThemeRawTemplate;
  /** Independent fullscreen + lower-third variants */
  variants?: BibleThemeVariants;
  /** Which variants are enabled (defaults to [templateType]) */
  enabledVariants?: BibleTemplateType[];
  createdAt: string;
  updatedAt: string;
}

export type BibleTemplateType =
  | "fullscreen"
  | "lower-third"
  | "side-by-side";

/**
 * Lower-third bar size presets.
 * Controls max-height, padding, font-size scaling, and safe-area inset.
 */
export type LowerThirdSize =
  | "smallest"
  | "smaller"
  | "small"
  | "medium"
  | "big"
  | "bigger"
  | "biggest";

export type LowerThirdWidthPreset =
  | "full"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "xxl";

/**
 * Pixel values for each lower-third size preset.
 * Consumed by the overlay HTML to scale the bar.
 */
export const LOWER_THIRD_SIZE_PRESETS: Record<LowerThirdSize, {
  maxHeight: number;  // px — max bar height
  padding: number;    // px — inner padding
  fontSize: number;   // px — base font size
  refFontSize: number;// px — reference label font size
  safeArea: number;   // px — margin from screen edges
  lineHeight: number; // line-height multiplier
  refSpacing: number; // px — gap between verse and reference
}> = {
  smallest: { maxHeight: 180, padding: 14, fontSize: 24, refFontSize: 18, safeArea: 30, lineHeight: 1.25, refSpacing: 10 },
  smaller: { maxHeight: 240, padding: 20, fontSize: 28, refFontSize: 20, safeArea: 35, lineHeight: 1.26, refSpacing: 12 },
  small: { maxHeight: 320, padding: 24, fontSize: 32, refFontSize: 24, safeArea: 38, lineHeight: 1.27, refSpacing: 14 },
  medium: { maxHeight: 400, padding: 30, fontSize: 36, refFontSize: 26, safeArea: 40, lineHeight: 1.28, refSpacing: 16 },
  big: { maxHeight: 520, padding: 36, fontSize: 48, refFontSize: 34, safeArea: 44, lineHeight: 1.3, refSpacing: 20 },
  bigger: { maxHeight: 620, padding: 44, fontSize: 60, refFontSize: 42, safeArea: 48, lineHeight: 1.32, refSpacing: 24 },
  biggest: { maxHeight: 760, padding: 52, fontSize: 72, refFontSize: 50, safeArea: 52, lineHeight: 1.34, refSpacing: 28 },
};

export interface BibleThemeSettings {
  // Typography
  fontFamily: string;
  fontSize: number;          // px
  /** Reduce text only when it would overflow the selected overlay frame. */
  autoFontScale?: boolean;
  fontWeight: "normal" | "bold" | "light" | "extrabold" | "black";
  fontStyle?: "normal" | "italic";
  fontColor: string;         // hex
  lineHeight: number;        // ratio e.g. 1.6
  letterSpacing?: number;    // px
  wordSpacing?: number;      // px
  textAlign: "left" | "center" | "right";
  textShadow: string;        // CSS text-shadow value
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: number;
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";

  // Reference label
  refFontFamily?: string;
  refFontSize: number;
  refFontColor: string;
  refFontWeight: "normal" | "bold" | "light" | "extrabold" | "black";
  refPosition: "top" | "bottom";
  refAnchor?: "normal" | "top" | "bottom";
  refTextTransform: "none" | "uppercase" | "lowercase" | "capitalize";
  refLetterSpacing: number;       // px
  refOpacity: number;             // 0-1
  refTextAlign: "left" | "center" | "right" | "match";
  refSpacing: number;             // px — distance between reference and verse

  // Reference background
  referenceBackgroundEnabled: boolean;
  referenceBackgroundColor: string;
  referenceBackgroundStyle: "solid" | "pill" | "outline";
  referenceBackgroundRadius: number;

  // Box border & effects
  boxBorderEnabled?: boolean;
  boxBorderWidth?: number;
  boxBorderStyle?: "solid" | "dashed" | "dotted";
  boxBorderColor?: string;
  boxBorderTop?: string;
  boxShadowEnabled?: boolean;
  boxShadowX?: number;
  boxShadowY?: number;
  boxShadowBlur?: number;
  boxShadowColor?: string;
  boxShadow?: string;
  showAccentBar?: boolean;

  // Background
  /** Dock-selected background mode. Kept with the live settings so OBS and
   * the Bible overlay agree on which background asset is active. */
  backgroundType?: "off" | "theme" | "color" | "image" | "pattern" | "video";
  backgroundColor: string;
  backgroundColorEnd?: string;   // gradient end color (optional)
  bgGradientAngle?: number;      // gradient angle in degrees (optional, default 135)
  backgroundImage: string;   // URL or data URL
  backgroundImageFilePath?: string; // Absolute local file path for OBS-native image background
  backgroundPattern: string; // SVG data URI from BACKGROUND_PATTERNS, or legacy CSS pattern slug (e.g. "diagonal-lines")
  backgroundVideo: string;   // URL or data URL
  backgroundVideoFilePath?: string; // Absolute local file path for OBS-native video background
  backgroundOpacity: number; // 0–1
  /** Fullscreen readability shade overlay (drawn over BG, under text) */
  fullscreenShadeEnabled: boolean;
  fullscreenShadeColor: string;   // hex
  fullscreenShadeOpacity: number; // 0–1

  // Logo / branding
  logoUrl: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoSize: number;          // px width

  // Layout
  padding: number;           // px
  safeArea: number;          // px inset from edges
  borderRadius: number;      // px
  boxBackground: string;     // Background behind text box (for lower-third etc.)
  boxOpacity: number;        // 0–1
  boxBackgroundImage: string; // Image for lower-third box background

  /** Lower-third bar size preset — controls max-height, padding, and font scaling */
  lowerThirdSize: LowerThirdSize;
  /** Lower-third horizontal placement on the screen */
  lowerThirdPosition: "left" | "center" | "right";
  /** Optional minimum bar height in pixels (0 = auto) */
  lowerThirdHeight: number;
  /** Reduce width from both left and right edges using preset insets */
  lowerThirdWidthPreset: LowerThirdWidthPreset;
  /** Horizontal offset in pixels after width/placement are applied */
  lowerThirdOffsetX: number;
  /** Lower-third vertical caption position — "bottom" anchors text at bottom (default), "top" anchors at top */
  lowerThirdCaptionPosition: "top" | "bottom";
  /** Screen edge where the lower-third bar is placed. */
  lowerThirdEdge?: "bottom" | "top" | "left" | "right";
  /** CSS padding for the lower-third text card. Accepts CSS padding syntax, e.g. "18px 28px". */
  lowerThirdCardPadding?: string;
  /** Maximum lower-third card height used by the fitted-size presets. */
  lowerThirdBarMaxHeight?: number;
  /** When true, the dock controls vertical and horizontal lower-third text padding together. */
  lowerThirdPaddingLinked?: boolean;
  /** Rounded corner radius for the lower-third text card. */
  lowerThirdCardRadius?: number;
  /** Optional text inversion for lower-third bars, useful for side/top projection layouts. */
  lowerThirdTextDirection?: "normal" | "inverted";

  // Compare Translation layout
  /** Width percentage of each translation panel in compare mode (30–50, default 40) */
  compareTranslationWidth: number;
  /** Horizontal gap in pixels between translation panels in compare mode (0–200, default 40) */
  compareTranslationGap: number;

  // Animation
  animation: "none" | "fade" | "slide-up" | "slide-left" | "scale-in" | "reveal-bg-then-text";
  animationDuration: number; // ms

  /**
   * Editor-built layout (Theme Editor). When present, the Bible / Worship /
   * Notes overlays draw this layout with the shared theme renderer instead of
   * the fixed legacy layout. Absent on legacy themes.
   */
  layout?: ThemeLayout;

  /** Dock tweaks for layout themes (see themes/layout/adjust.ts): percent sizes and lower-third offset. */
  layoutTextScale?: number;
  layoutRefScale?: number;
  /** Dock: verse line spacing for layout themes, percent of the theme's own (100 = as designed). */
  layoutLineHeight?: number;
  /** Dock: show / hide the theme's title (reference / label). Missing = the theme's own setting. */
  layoutShowTitle?: boolean;
  /** Dock: bold / italic for the verse text of a layout theme (undefined = as the theme is designed). */
  layoutBold?: boolean;
  layoutItalic?: boolean;
  layoutOffsetY?: number;
  /** Dock: how much to darken the background of a full-screen layout theme, percent (0 = as designed). */
  layoutBackdropDarkness?: number;
}

export const DEFAULT_THEME_SETTINGS: BibleThemeSettings = {
  fontFamily: SCRIPTURE_FONT_FAMILY,
  fontSize: 145,
  autoFontScale: true,
  fontWeight: "black",
  fontStyle: "normal",
  fontColor: "#FFFFFF",
  lineHeight: 1.5,
  letterSpacing: 0,
  wordSpacing: 0,
  textAlign: "center",
  textShadow: "4px 5px 2px rgba(0, 0, 0, 0.95)",
  textOutline: true,
  textOutlineColor: "#000000",
  textOutlineWidth: 4,
  textTransform: "none",

  refFontFamily: "",
  refFontSize: 42,
  refFontColor: "#FACC15",
  refFontWeight: "black",
  refPosition: "bottom",
  refAnchor: "normal",
  refTextTransform: "none",
  refLetterSpacing: 0,
  refOpacity: 1,
  refTextAlign: "match",
  refSpacing: 20,

  referenceBackgroundEnabled: false,
  referenceBackgroundColor: "#F4D17B",
  referenceBackgroundStyle: "solid",
  referenceBackgroundRadius: 12,

  backgroundType: "pattern",
  backgroundColor: "#000000",
  backgroundImage: "",
  backgroundPattern: QUIET_CLOUDS_PATTERN_SRC,
  backgroundVideo: "",
  backgroundOpacity: 1,
  fullscreenShadeEnabled: true,
  fullscreenShadeColor: "#000000",
  fullscreenShadeOpacity: 0.42,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 80,

  padding: 60,
  safeArea: 40,
  borderRadius: 0,
  boxBackground: "rgba(0,0,0,0.7)",
  boxOpacity: 1,
  boxBackgroundImage: "",

  lowerThirdSize: "medium",
  lowerThirdPosition: "center",
  lowerThirdHeight: 0,
  lowerThirdWidthPreset: "full",
  lowerThirdOffsetX: 0,
  lowerThirdCaptionPosition: "bottom",
  lowerThirdEdge: "bottom",
  lowerThirdCardPadding: "18px 28px",
  lowerThirdPaddingLinked: false,
  lowerThirdCardRadius: 18,
  lowerThirdTextDirection: "normal",

  compareTranslationWidth: 40,
  compareTranslationGap: 40,

  animation: "fade",
  animationDuration: 400,
};

/**
 * Applies admin-configured theme overrides to DEFAULT_THEME_SETTINGS.
 * Call once at app startup after config is loaded.
 * Mutates the exported object so all 150+ usage sites pick up the values.
 */
export function applyThemeConfigOverrides(): void {
  const bible = getDefaultBibleTheme();
  DEFAULT_THEME_SETTINGS.fontFamily = withScriptureFontFallback(bible.font);
  DEFAULT_THEME_SETTINGS.fontSize = bible.textSize || 140;
  DEFAULT_THEME_SETTINGS.fontColor = bible.textColor || "#FFFFFF";
  DEFAULT_THEME_SETTINGS.backgroundColor = bible.backgroundColor;
  DEFAULT_THEME_SETTINGS.referenceBackgroundColor = bible.accentColor;
  DEFAULT_THEME_SETTINGS.refFontSize = Math.max(16, Math.round((bible.textSize || 140) * 0.7));
  DEFAULT_THEME_SETTINGS.refFontColor = bible.textColor || "#FACC15";
  DEFAULT_THEME_SETTINGS.fontWeight = "black";
  DEFAULT_THEME_SETTINGS.refFontWeight = "black";
  DEFAULT_THEME_SETTINGS.textOutline = true;
  DEFAULT_THEME_SETTINGS.textOutlineWidth = 4;
  DEFAULT_THEME_SETTINGS.textOutlineColor = "#000000";
  DEFAULT_THEME_SETTINGS.textShadow = "4px 5px 2px rgba(0, 0, 0, 0.95)";
  DEFAULT_THEME_SETTINGS.backgroundType = "pattern";
  DEFAULT_THEME_SETTINGS.backgroundPattern = QUIET_CLOUDS_PATTERN_SRC;
}

// ---------------------------------------------------------------------------
// Bible Module State
// ---------------------------------------------------------------------------

export interface BibleState {
  /** Current translation */
  translation: BibleTranslation;
  /** Search query */
  searchQuery: string;
  /** Selected passage */
  selectedPassage: BiblePassage | null;
  /** Slide configuration */
  slideConfig: SlideConfig;
  /** Queue of passages */
  queue: QueueItem[];
  /** Currently active queue item index */
  activeQueueIndex: number;
  /** Selected theme */
  activeThemeId: string;
  /** All available themes */
  themes: BibleTheme[];
  /** History of displayed passages */
  history: BiblePassage[];
  /** Favorite passages */
  favorites: BiblePassage[];
  /** UI colour mode */
  colorMode: "dark" | "light" | "system";
  /** Auto-send verse on double-click */
  autoSendOnDoubleClick: boolean;
  /** Reduce motion / animations */
  reduceMotion: boolean;
  /** High-contrast borders and text */
  highContrast: boolean;
}

export const BIBLE_BOOKS = [
  // Old Testament
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
  "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi",
  // New Testament
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

export type BibleBookName = (typeof BIBLE_BOOKS)[number];

export const BOOK_ABBREVS: Record<string, string[]> = {
  Genesis: ["Gen", "Ge", "Gn"],
  Exodus: ["Exod", "Ex", "Exo"],
  Leviticus: ["Lev", "Le", "Lv"],
  Numbers: ["Num", "Nu", "Nm", "Nb"],
  Deuteronomy: ["Deut", "Dt"],
  Joshua: ["Josh", "Jos", "Jsh"],
  Judges: ["Judg", "Jdg", "Jg", "Jdgs"],
  Ruth: ["Rth", "Ru"],
  "1 Samuel": ["1Sam", "1 Sam", "1S", "I Sam"],
  "2 Samuel": ["2Sam", "2 Sam", "2S", "II Sam"],
  "1 Kings": ["1Kgs", "1 Kgs", "1Ki", "I Kgs"],
  "2 Kings": ["2Kgs", "2 Kgs", "2Ki", "II Kgs"],
  "1 Chronicles": ["1Chr", "1 Chr", "I Chr"],
  "2 Chronicles": ["2Chr", "2 Chr", "II Chr"],
  Ezra: ["Ezr"],
  Nehemiah: ["Neh", "Ne"],
  Esther: ["Est", "Esth"],
  Job: ["Jb"],
  Psalms: ["Ps", "Psa", "Psm", "Pss", "Psalm"],
  Proverbs: ["Prov", "Pro", "Prv"],
  Ecclesiastes: ["Eccl", "Ecc", "Ec", "Qoh"],
  "Song of Solomon": ["Song", "SOS", "Sg", "Cant"],
  Isaiah: ["Isa", "Is"],
  Jeremiah: ["Jer", "Je", "Jr"],
  Lamentations: ["Lam", "La"],
  Ezekiel: ["Ezek", "Eze", "Ezk"],
  Daniel: ["Dan", "Da", "Dn"],
  Hosea: ["Hos", "Ho"],
  Joel: ["Joe", "Jl"],
  Amos: ["Am"],
  Obadiah: ["Obad", "Ob"],
  Jonah: ["Jon", "Jnh"],
  Micah: ["Mic", "Mc"],
  Nahum: ["Nah", "Na"],
  Habakkuk: ["Hab", "Hb"],
  Zephaniah: ["Zeph", "Zep", "Zp"],
  Haggai: ["Hag", "Hg"],
  Zechariah: ["Zech", "Zec", "Zc"],
  Malachi: ["Mal", "Ml"],
  Matthew: ["Matt", "Mt"],
  Mark: ["Mrk", "Mk", "Mr"],
  Luke: ["Luk", "Lk"],
  John: ["Jn", "Jhn"],
  Acts: ["Act", "Ac"],
  Romans: ["Rom", "Ro", "Rm"],
  "1 Corinthians": ["1Cor", "1 Cor", "I Cor"],
  "2 Corinthians": ["2Cor", "2 Cor", "II Cor"],
  Galatians: ["Gal", "Ga"],
  Ephesians: ["Eph", "Ephes"],
  Philippians: ["Phil", "Php", "Pp"],
  Colossians: ["Col"],
  "1 Thessalonians": ["1Thess", "1 Thess", "I Thess"],
  "2 Thessalonians": ["2Thess", "2 Thess", "II Thess"],
  "1 Timothy": ["1Tim", "1 Tim", "I Tim"],
  "2 Timothy": ["2Tim", "2 Tim", "II Tim"],
  Titus: ["Tit", "Ti"],
  Philemon: ["Phlm", "Phm"],
  Hebrews: ["Heb"],
  James: ["Jas", "Jm"],
  "1 Peter": ["1Pet", "1 Pet", "I Pet"],
  "2 Peter": ["2Pet", "2 Pet", "II Pet"],
  "1 John": ["1Jn", "1 Jn", "I Jn"],
  "2 John": ["2Jn", "2 Jn", "II Jn"],
  "3 John": ["3Jn", "3 Jn", "III Jn"],
  Jude: ["Jud", "Jd"],
  Revelation: ["Rev", "Re"],
};
