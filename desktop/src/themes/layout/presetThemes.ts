/**
 * The layout presets as BibleTheme records, so they show up anywhere the app
 * lists themes (Create Theme library, Themes page, dock pickers).
 *
 * Every preset ships both looks: its own format plus a matching companion
 * (see companions.ts), so a theme always works full screen and as a lower third.
 */
import { DEFAULT_THEME_SETTINGS, type BibleTheme } from "../../bible/types";
import { ROYAL_BLUE_GLOW, THEME_PRESETS } from "./presets";
import { presetPair } from "./companions";
import { withAnimatedBackground } from "./backgroundPatterns";
import {
  NAVY_SCRIPTURE,
  PAPER_CARD_FS,
  SET2_PRESETS,
  VIOLET_PLAIN_FS,
  VIOLET_SPLIT,
  WHITE_PILL,
} from "./presetsSet2";
import { SET3_PRESETS } from "./presetsSet3";
import { SET4_PRESETS } from "./presetsSet4";
import type { ThemeLayout } from "./types";

const PRESET_DATE = "2026-10-08T00:00:00.000Z";
const SET2_DATE = "2026-10-12T00:00:00.000Z";
const SET3_DATE = "2026-10-13T00:00:00.000Z";
const SET4_DATE = "2026-10-25T00:00:00.000Z";

function layoutTheme(
  id: string,
  name: string,
  primary: "fullscreen" | "lower-third",
  fullscreenLayout: ThemeLayout,
  lowerThirdLayout: ThemeLayout,
  date: string,
  description?: string,
): BibleTheme {
  // Full screens get the slow animated pattern + glow behind the text (backgroundPatterns.ts).
  const fullscreen = { ...DEFAULT_THEME_SETTINGS, layout: withAnimatedBackground(fullscreenLayout, id) };
  const lowerThird = { ...DEFAULT_THEME_SETTINGS, layout: lowerThirdLayout };
  return {
    id,
    name,
    description,
    source: "builtin",
    templateType: primary,
    category: "bible",
    categories: ["bible", "worship", "general"],
    settings: primary === "fullscreen" ? fullscreen : lowerThird,
    variants: { fullscreen: { settings: fullscreen }, lowerThird: { settings: lowerThird } },
    enabledVariants: ["fullscreen", "lower-third"],
    createdAt: date,
    updatedAt: date,
  };
}

/** Second reference set: lower thirds with hand-made full screens. */
const SET2_THEMES: BibleTheme[] = SET2_PRESETS.map(({ id, name, layout, companion }) =>
  layoutTheme(id, name, "lower-third", companion, layout, SET2_DATE),
);

/** Third reference set: Confetti Frame (lower third plus its hand-made full screen). */
const SET3_THEMES: BibleTheme[] = SET3_PRESETS.map(({ id, name, layout, companion }) =>
  layoutTheme(id, name, "lower-third", companion, layout, SET3_DATE),
);

function presetTheme({ id, name, layout }: { id: string; name: string; layout: ThemeLayout }, date = PRESET_DATE): BibleTheme {
  const pair = presetPair(layout);
  return layoutTheme(id, name, layout.format, pair.fullscreen, pair.lowerThird, date);
}

/** Fourth reference set: Prayer Point (lower third; its full screen comes from companions.ts). */
const SET4_THEMES: BibleTheme[] = SET4_PRESETS.map((p) => presetTheme(p, SET4_DATE));

/** Ready-made themes promoted to starters (same ids as before, so saved picks keep working). */
const PRESET_STARTER_IDS = ["preset-caption-rule", "preset-broadcast-caption", "preset-chapter-number"];
const PRESET_STARTERS: BibleTheme[] = PRESET_STARTER_IDS.map((id) => presetTheme(THEME_PRESETS.find((p) => p.id === id)!));

// The promoted ones are listed once, as starters.
const FIRST_SET_THEMES: BibleTheme[] = THEME_PRESETS.filter((p) => !PRESET_STARTER_IDS.includes(p.id)).map((p) => presetTheme(p));

/**
 * Starter themes a new account sees first: Caption Rule, Broadcast Caption and
 * Chapter Number, then three looks put together from the ready-made ones.
 * `STARTER_DEFAULT_THEME_ID` (Royal Blue Glow) is what Bible, Worship and Notes use
 * until someone picks another theme.
 */
export const STARTER_DEFAULT_THEME_ID = "preset-royal-blue-glow";

/**
 * The only ready-made themes a brand-new account sees (Themes page and Dock). Every other
 * ready-made theme waits in the Theme Library until it is added (services/themeLibrary.ts).
 * The first one is the default for Bible, Worship and Notes.
 */
export const NEW_USER_THEME_IDS: readonly string[] = ["preset-royal-blue-glow", "preset-serif-tab-band", "preset-royal-frame"];
export const STARTER_THEMES: BibleTheme[] = [
  ...PRESET_STARTERS,
  layoutTheme("starter-glory-blue", "Glory Blue", "fullscreen", ROYAL_BLUE_GLOW, NAVY_SCRIPTURE, SET2_DATE,
    "Starter theme: Royal Blue Glow full screen with the Navy Scripture lower third."),
  layoutTheme("starter-clean-paper", "Clean Paper", "fullscreen", PAPER_CARD_FS, WHITE_PILL, SET2_DATE,
    "Starter theme: light paper card full screen with the White Pill lower third."),
  layoutTheme("starter-violet-praise", "Violet Praise", "fullscreen", VIOLET_PLAIN_FS, VIOLET_SPLIT, SET2_DATE,
    "Starter theme: plain violet full screen (reference on top, verse below) with the Violet Split lower third."),
];

/** Every ready-made layer theme: starters, then the newest sets, then the first set. */
const ALL_LAYOUT_THEMES: BibleTheme[] = [...STARTER_THEMES, ...SET4_THEMES, ...SET3_THEMES, ...SET2_THEMES, ...FIRST_SET_THEMES];

/** The new-account themes lead (so they are also the plan's open themes), then the rest. */
export const LAYOUT_PRESET_THEMES: BibleTheme[] = [
  ...NEW_USER_THEME_IDS.map((id) => ALL_LAYOUT_THEMES.find((theme) => theme.id === id)!),
  ...ALL_LAYOUT_THEMES.filter((theme) => !NEW_USER_THEME_IDS.includes(theme.id)),
];

/** Layout of a theme for a mode, if it is an editor-built theme. */
export function getThemeLayout(theme: Pick<BibleTheme, "settings" | "variants" | "templateType">) {
  return (
    theme.settings?.layout ??
    theme.variants?.lowerThird?.settings?.layout ??
    theme.variants?.fullscreen?.settings?.layout ??
    null
  );
}
