/**
 * studioEngine.ts — Presentation Studio: drives the projector without OBS.
 *
 * Program (what the audience sees) is `public/studio-output.html`: the three MCE
 * overlay pages (Bible, Worship, Notes) stacked full size plus a media layer, so
 * every theme renders exactly as in OBS.
 *
 * Transport: the app keeps ONE program state ({revision, active, screen, packets,
 * media}) and POSTs it to the app's local server (`/api/studio-state`). The output
 * page reads it (instantly on a relay ping, and by polling as a fallback) and hands
 * each overlay page its packet through the URL hash, the same way Preview works.
 * Nothing depends on OBS or on a WebSocket staying healthy.
 *
 * Preview (what's next) is the same overlay page in an iframe that ignores the relay
 * (`mceRelay=0`, its own `mceSource`) and gets its packet through the URL hash.
 */
import { DEFAULT_TEXT_LOOK, withTextLook, type StudioTextLook } from "./textLook";
import { chunkLines } from "./studioTextLayout";
import type { BibleTheme, BibleThemeSettings } from "../bible/types";
import { buildDockProductionSettingsPayload } from "../services/productionSettings";
import { dockObsClient } from "../dock/dockObsClient";
import { overlayBridge } from "../dock/dockOverlayBridge";
import { getOverlayBaseUrl } from "../services/overlayUrl";
import type { StudioMixLayer } from "./studioMix";

export type StudioTextModule = "bible" | "worship" | "notes";
export type StudioModule = StudioTextModule | "media";
export type StudioMode = "fullscreen" | "lower-third";
export type StudioTransition = "fade" | "cut";
export type StudioScreen = "live" | "black" | "logo";

export const STUDIO_MODULES: StudioTextModule[] = ["bible", "worship", "notes"];

export interface StudioMedia {
  kind: "image" | "video" | "audio";
  /** Path on the overlay server, e.g. /uploads/Welcome.mp4 */
  url: string;
  fit: "contain" | "cover";
  loop: boolean;
  muted: boolean;
}

/** Where the slide came from, so it can be found again (schedule, history, Project again). */
export interface StudioSlideOrigin {
  kind: "bible" | "song" | "note" | "media" | "doc";
  /** Song, note or media id. */
  id?: string;
  /** Slide index inside the song or note. */
  index?: number;
  book?: string;
  chapter?: number;
  verse?: number;
  endVerse?: number;
  translation?: string;
}

/** One slide the operator can preview or send live. */
export interface StudioSlide {
  /** Stable key, e.g. "bible:John:3:16:KJV" or "song:<id>:2". */
  key: string;
  module: StudioModule;
  /** Short tile label: "16", "Chorus", "Slide 2". */
  label: string;
  text: string;
  /** Reference / label line for the theme heading ("John 3:16 (KJV)", "" for songs). */
  reference: string;
  /** Title of the item it belongs to (chapter, song, note, media name). */
  itemTitle: string;
  /** Bible verse number, shown big on the tile. */
  verse?: number;
  media?: StudioMedia;
  origin?: StudioSlideOrigin;
  /** Bible only: the same verse(s) in other translations, shown side by side on the screen. */
  compare?: StudioCompareColumn[];
  /** How the two translations are laid out on the screen (the Dock's "Line By Line" / "Side By Side"). */
  compareLayout?: "line-by-line" | "side-by-side";
  /** "translations" (same verse, two versions: the default) or "passages" (two different references). */
  compareMode?: "translations" | "passages";
}

/** One translation of the verse(s) in a side-by-side Bible slide. */
export interface StudioCompareColumn {
  translation: string;
  /** "John 3:16 (KJV)" */
  reference: string;
  text: string;
  book: string;
  chapter: number;
  verse: number;
  verseEnd: number;
  /** "16" or "16-17" */
  verseRange: string;
}

/** How the live camera sits with the words (see public/studio-output.html). */
export type StudioCameraLayout = "camera-only" | "behind-content" | "in-front" | "hidden";

export interface StudioCamera {
  /** The camera is open (it stays open while hidden, so showing it again is instant). */
  enabled: boolean;
  /** Empty = the system's default camera. */
  deviceId: string;
  layout: StudioCameraLayout;
  /** The camera's name. Another window can't use the id (ids belong to the window that listed them), so it finds the camera by name. */
  label?: string;
  /** Explicitly hide the text layers, even if the camera feed is missing. */
  wordsOff?: boolean;
  /** The app itself (not a window) opened this camera: screens only show the pictures it sends and never open a camera or a video link. */
  native?: boolean;
}

/** Playback of the video or audio on the screen. `seekRev` changes each time the operator seeks. */
export interface StudioMediaControl {
  paused: boolean;
  /** 0–1 */
  volume: number;
  muted: boolean;
  loop: boolean;
  fit: "contain" | "cover";
  seekTo: number;
  seekRev: number;
}

export const DEFAULT_MEDIA_CONTROL: StudioMediaControl = {
  paused: false,
  volume: 1,
  muted: false,
  loop: true,
  fit: "cover",
  seekTo: 0,
  seekRev: 0,
};

export interface StudioThemeSet {
  fullscreen: BibleTheme | null;
  lowerThird: BibleTheme | null;
}

export type StudioThemes = Record<StudioTextModule, StudioThemeSet> & { defaultMode: StudioMode };

const OVERLAY_PAGE: Record<StudioTextModule, string> = {
  bible: "mce-bible-overlay.html?tab=bible",
  worship: "mce-worship-overlay.html?x=1",
  notes: "mce-note.html?x=1",
};

/** The themes picked on the Themes page / in the Dock for Bible, Worship and Notes. */
export async function loadStudioThemes(): Promise<StudioThemes> {
  const payload = await buildDockProductionSettingsPayload();
  const set = (m?: { fullscreenTheme?: BibleTheme; lowerThirdTheme?: BibleTheme }): StudioThemeSet => ({
    fullscreen: m?.fullscreenTheme ?? null,
    lowerThird: m?.lowerThirdTheme ?? null,
  });
  return {
    bible: set(payload.bible),
    worship: set(payload.worship),
    notes: set(payload.notes ?? payload.worship),
    defaultMode: payload.bible?.defaultMode === "lower-third" ? "lower-third" : "fullscreen",
  };
}

/** A theme's settings for one mode (both-looks themes keep each look in `variants`). */
export function themeSettingsForMode(theme: BibleTheme | null, mode: StudioMode): BibleThemeSettings | null {
  if (!theme) return null;
  const variant = mode === "lower-third" ? theme.variants?.lowerThird : theme.variants?.fullscreen;
  return (variant?.settings ?? theme.settings ?? null) as BibleThemeSettings | null;
}

/** Cut = no animation: classic themes get animation "none", layer themes get no in/out per layer. */
export function withoutAnimation(settings: BibleThemeSettings): BibleThemeSettings {
  const next: BibleThemeSettings = { ...settings, animation: "none", animationDuration: 0 };
  const layout = settings.layout;
  if (layout && Array.isArray(layout.layers)) {
    const none = { preset: "none" as const, duration: 0, delay: 0, easing: "linear" as const };
    next.layout = { ...layout, layers: layout.layers.map((layer) => ({ ...layer, in: none, out: none })) };
  }
  return next;
}

function resolveSettings(
  themes: StudioThemes | null,
  module: StudioTextModule,
  mode: StudioMode,
  transition: StudioTransition,
): Record<string, unknown> | null {
  if (!themes) return null;
  const set = themes[module];
  const theme = mode === "lower-third" ? set.lowerThird ?? set.fullscreen : set.fullscreen ?? set.lowerThird;
  const settings = themeSettingsForMode(theme, mode);
  if (!settings) return null;
  const scaled = withTextLook(withTextStyle(withTextScale(settings, textScale), textBold, textItalic), textLook);
  return (transition === "cut" ? withoutAnimation(scaled) : scaled) as unknown as Record<string, unknown>;
}

/** Quick text size (percent) the operator picked in Settings; 100 = the theme's own size. */
let textScale = 100;
export function setStudioTextScale(percent: number): void {
  textScale = Number.isFinite(percent) ? Math.max(50, Math.min(200, Math.round(percent))) : 100;
}

/** Quick Bold / Italic the operator picked; they sit on top of whatever the theme says. */
let textBold = false;
let textItalic = false;
export function setStudioTextStyle(bold: boolean, italic: boolean): void {
  textBold = bold === true;
  textItalic = italic === true;
}

/** Quick colour / shadow / alignment / background from Text Settings (see textLook.ts). */
let textLook: StudioTextLook = DEFAULT_TEXT_LOOK;
export function setStudioTextLook(look: StudioTextLook): void {
  textLook = look;
}

/** The theme made bolder and/or italic (classic font weight and style, and every layer-theme text layer). */
export function withTextStyle(settings: BibleThemeSettings, bold: boolean, italic: boolean): BibleThemeSettings {
  if (!bold && !italic) return settings;
  const next: BibleThemeSettings = { ...settings };
  if (bold) next.fontWeight = settings.fontWeight === "bold" || settings.fontWeight === "extrabold" || settings.fontWeight === "black" ? "black" : "bold";
  if (italic) next.fontStyle = "italic";
  const layout = settings.layout;
  if (layout && Array.isArray(layout.layers)) {
    next.layout = {
      ...layout,
      layers: layout.layers.map((layer) => {
        const style = layer.style;
        if (!style || typeof style.fontSize !== "number") return layer;
        return {
          ...layer,
          style: {
            ...style,
            ...(bold ? { fontWeight: (style.fontWeight ?? 400) >= 700 ? 900 : 700 } : {}),
            ...(italic ? { italic: true } : {}),
          },
        };
      }),
    };
  }
  return next;
}

/** The theme with its text sizes multiplied (classic font size and every layer-theme text size). */
export function withTextScale(settings: BibleThemeSettings, percent: number): BibleThemeSettings {
  if (!percent || percent === 100) return settings;
  const k = percent / 100;
  const next: BibleThemeSettings = { ...settings };
  if (typeof settings.fontSize === "number") next.fontSize = Math.round(settings.fontSize * k);
  const layout = settings.layout;
  if (layout && Array.isArray(layout.layers)) {
    next.layout = {
      ...layout,
      layers: layout.layers.map((layer) => {
        const style = layer.style;
        if (!style || typeof style.fontSize !== "number") return layer;
        return {
          ...layer,
          style: {
            ...style,
            fontSize: Math.round(style.fontSize * k),
            ...(typeof style.minFontSize === "number" ? { minFontSize: Math.round(style.minFontSize * k) } : {}),
          },
        };
      }),
    };
  }
  return next;
}

export interface StudioPacket {
  module: StudioTextModule;
  data: Record<string, unknown>;
  css: string;
}

/** The overlay packet for a text slide (null slide = clear that module). */
export function buildStudioPacket(
  module: StudioTextModule,
  slide: StudioSlide | null,
  themes: StudioThemes | null,
  mode: StudioMode,
  transition: StudioTransition,
): StudioPacket {
  const { data, css } = dockObsClient.buildStudioOverlayPacket({
    text: slide?.text ?? "",
    reference: slide?.reference ?? "",
    mode,
    themeSettings: resolveSettings(themes, module, mode, transition),
    compare: module === "bible" && slide?.compare && slide.compare.length >= 2 ? slide.compare : undefined,
    compareLayout: slide?.compareLayout,
    compareMode: slide?.compareMode,
  });
  return { module, data, css };
}

/** The packet the Dock uses to blank a source: plays the exit animation, then nothing. */
function blankPacket(mode: StudioMode): Record<string, unknown> {
  const timestamp = Date.now();
  return { slide: null, theme: null, live: false, blanked: true, timestamp, mode, revision: timestamp };
}

// ── Program state ──────────────────────────────────────────────────────────

export interface StudioBrand {
  logoUrl?: string;
  churchName?: string;
  logoBg?: { color?: string; image?: string };
  /** Logo size in percent (100 = normal). */
  logoScale?: number;
}

/** Bumped when public/studio-output.html changes in a way an already-open projector window must reload for. */
export const OUTPUT_PAGE_REV = 12;

export interface StudioProgramState {
  revision: number;
  /** The newest output page this Studio expects; an older page that is still open reloads itself. */
  pageRev?: number;
  /** Which layer is on screen (the others are hidden after their exit animation). */
  active: StudioModule | null;
  screen: StudioScreen;
  logoUrl?: string;
  churchName?: string;
  /** What is behind the logo: one colour or a picture (nothing = the default look). */
  logoBg?: { color?: string; image?: string };
  /** How far a tall picture or document page is scrolled on screen, 0 (top) to 100 (bottom), when it fills the width. */
  scrollY?: number;
  /** The church's logo as set in the Studio: shown on the logo screen AND while nothing is on the screen. */
  brand?: StudioBrand;
  packets: Partial<Record<StudioTextModule, Record<string, unknown>>>;
  media: StudioMedia | null;
  /** Playback of the video in `media`: pause, volume, seek, loop, fit. */
  mediaControl?: StudioMediaControl;
  /** Sound only (it plays under whatever is on the screen). */
  audio?: StudioMedia | null;
  audioControl?: StudioMediaControl;
  /** The live camera and where it sits. */
  camera?: StudioCamera;
  /** The camera as arranged in Preview (it goes live with Go Live). */
  previewCamera?: StudioCamera;
  /** The camera is running and ready while an output is open, even if it is not on the screen, so
   *  the screens keep its newest picture and show it the instant it goes on (like an OBS source). */
  cameraWarm?: boolean;
  /** Screen Mix: video / camera behind the words, banners and the logo on top. */
  mix?: StudioMixLayer[];
  /** What Preview shows, for Preview projectors (always rendered as Cut, no curtain). */
  preview?: StudioPreviewState;
  /** The alternate output: the same live item in its own look (kept ready for the Studio preview). */
  alt?: StudioAltState;
}

/**
 * The alternate output shows everything Program shows (media, camera, Screen Mix, Black / Logo),
 * but its words use their own look, e.g. Lower Third for the live stream while the room sees Full Screen.
 */
export interface StudioAltState {
  mode: StudioMode;
  /** The module visible on the alternate feed (can stay live during a main-look transition). */
  active?: StudioModule | null;
  packets: Partial<Record<StudioTextModule, Record<string, unknown>>>;
}

export interface StudioPreviewState {
  active: StudioModule | null;
  packets: Partial<Record<StudioTextModule, Record<string, unknown>>>;
  media: StudioMedia | null;
  /** Playback for preview media (separate from the live screen). */
  mediaControl?: StudioMediaControl;
}

let lastRevision = 0;
function nextRevision(): number {
  lastRevision = Math.max(Date.now(), lastRevision + 1);
  return lastRevision;
}

let program: StudioProgramState = { revision: 0, active: null, screen: "live", packets: {}, media: null };
/** The alternate output's look, or null when the current plan cannot use it. */
let altMode: StudioMode | null = null;
/** The text slide on Program, so the alternate output can be redrawn when its look changes. */
let liveText: { slide: StudioSlide; themes: StudioThemes | null } | null = null;
let postChain: Promise<boolean> = Promise.resolve(true);
let lastError = "";

export function getProgramState(): StudioProgramState {
  return program;
}

/** Why the last update could not reach the output ("" when it did). */
export function getLastOutputError(): string {
  return lastError;
}

/**
 * Write the new state to the local server and ping the output page over the relay.
 * Resolves true once the output server has it, false when it could not be reached
 * (the caller then must not count the item as shown).
 */
function commit(next: Omit<StudioProgramState, "revision">): Promise<boolean> {
  program = { ...next, pageRev: OUTPUT_PAGE_REV, revision: nextRevision() };
  const body = JSON.stringify(program);
  const revision = program.revision;
  const result = postChain.then(async () => {
    try {
      const base = await studioBaseUrl();
      // text/plain keeps it a "simple" request (no CORS preflight).
      const response = await fetch(`${base}/api/studio-state`, { method: "POST", headers: { "Content-Type": "text/plain" }, body });
      if (!response.ok) throw new Error(`The output server answered ${response.status}.`);
      overlayBridge.publish({ channel: "studio", type: "studio-ping", revision });
      lastError = "";
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "The output could not be updated.";
      console.warn("[Studio] Could not update the output:", error);
      return false;
    }
  });
  postChain = result;
  return result;
}

/** Scroll a tall picture or document page up or down on Program and Preview (0 = top, 100 = bottom). */
export function setProgramScroll(scrollY: number): Promise<boolean> {
  const clamped = Math.max(0, Math.min(100, Math.round(scrollY)));
  if ((program.scrollY ?? 0) === clamped) return Promise.resolve(true);
  return commit({ ...program, scrollY: clamped });
}

/** The logo, church name, background and size used when nothing is on the screen (and by the Logo button). */
export function setProgramBrand(brand: StudioBrand): Promise<boolean> {
  return commit({ ...program, brand });
}

/** Screen state on top of the content: live, black, or the church logo. */
export function setProgramScreen(screen: StudioScreen, extra: { logoUrl?: string; churchName?: string; logoBg?: { color?: string; image?: string } } = {}): Promise<boolean> {
  return commit({
    ...program,
    screen,
    logoUrl: screen === "logo" ? extra.logoUrl : undefined,
    churchName: screen === "logo" ? extra.churchName : undefined,
    logoBg: screen === "logo" ? extra.logoBg : undefined,
  });
}

/**
 * Send a slide to Program. The module that was live is blanked first (it plays
 * its exit animation), and the screen goes back to live (lifts Black / Logo).
 * Sound (audio) plays under the screen and leaves the words alone.
 * Resolves true when the output has it.
 */
export function goLive(
  slide: StudioSlide,
  themes: StudioThemes | null,
  mode: StudioMode,
  transition: StudioTransition,
): Promise<boolean> {
  if (slide.module === "media" && slide.media?.kind === "audio") {
    return commit({
      ...program,
      audio: slide.media,
      audioControl: { ...DEFAULT_MEDIA_CONTROL, loop: slide.media.loop, muted: slide.media.muted, seekRev: Date.now() },
    });
  }
  const packets = { ...program.packets };
  const previous = program.active;
  if (previous && previous !== slide.module && previous !== "media") {
    packets[previous] = blankPacket(mode);
  }
  let media = program.media;
  let mediaControl = program.mediaControl;
  let alt = program.alt;
  if (slide.module === "media") {
    media = slide.media ?? null;
    if (media) mediaControl = { ...DEFAULT_MEDIA_CONTROL, loop: media.loop, muted: media.muted, fit: media.fit, seekRev: Date.now() };
    liveText = null;
    if (altMode) alt = { mode: altMode, packets: alt?.packets ?? blankPackets(altMode), active: "media" };
  } else {
    packets[slide.module] = buildStudioPacket(slide.module, slide, themes, mode, transition).data;
    if (previous === "media") media = null;
    liveText = { slide, themes };
    if (altMode) {
      const altPackets = { ...(alt?.packets ?? {}) };
      if (previous && previous !== slide.module && previous !== "media") altPackets[previous] = blankPacket(altMode);
      altPackets[slide.module] = buildStudioPacket(slide.module, slide, themes, altMode, transition).data;
      alt = { mode: altMode, packets: altPackets, active: slide.module };
    }
  }
  return commit({ ...program, active: slide.module, screen: "live", logoUrl: undefined, churchName: undefined, logoBg: undefined, packets, media, mediaControl, alt });
}

/** Something ready to show: an overlay packet for a text module, or a picture / video. */
export type StudioItem =
  | { module: StudioTextModule; data: Record<string, unknown>; label: string }
  | { module: "media"; media: StudioMedia; label: string };

/** Send a ready item (e.g. from the Dock) to Program; the previous module animates out. */
export function goLiveItem(item: StudioItem, mode: StudioMode): Promise<boolean> {
  const packets = { ...program.packets };
  const previous = program.active;
  if (previous && previous !== item.module && previous !== "media") {
    packets[previous] = blankPacket(mode);
  }
  let media = program.media;
  let alt = program.alt;
  liveText = null;
  if (item.module === "media") {
    media = item.media;
    if (altMode) alt = { mode: altMode, packets: alt?.packets ?? blankPackets(altMode), active: "media" };
  } else {
    packets[item.module] = item.data;
    if (previous === "media") media = null;
    // A ready-made item already has its look, so the alternate output shows it as it is.
    if (altMode) {
      const altPackets = { ...(alt?.packets ?? {}) };
      if (previous && previous !== item.module && previous !== "media") altPackets[previous] = blankPacket(altMode);
      altPackets[item.module] = item.data;
      alt = { mode: altMode, packets: altPackets, active: item.module };
    }
  }
  return commit({ ...program, active: item.module, screen: "live", logoUrl: undefined, churchName: undefined, logoBg: undefined, packets, media, alt });
}

/** Set the Screen Mix layers (what is `shown` appears on Program and Preview screens). */
export function setProgramMix(mix: StudioMixLayer[]): Promise<boolean> {
  return commit({ ...program, mix });
}

/** Open, move or hide the live camera. Hiding keeps it open so it comes back at once. */
export function setProgramCamera(camera: StudioCamera): Promise<boolean> {
  return commit({ ...program, camera: { ...camera } });
}

/** Tell the screens whether the camera is warm (running and ready to show at once). */
export function setProgramCameraWarm(warm: boolean): Promise<boolean> {
  if (Boolean(program.cameraWarm) === warm) return Promise.resolve(true);
  return commit({ ...program, cameraWarm: warm });
}

/** Arrange the camera in Preview only (the screen does not change until Go Live). */
export function setPreviewCamera(camera: StudioCamera): Promise<boolean> {
  return commit({ ...program, previewCamera: { ...camera } });
}

/** Play / pause / seek / volume of the video ("video") or the sound ("audio") that is on. */
export function setProgramMediaControl(change: Partial<StudioMediaControl>, target: "video" | "audio" = "video"): Promise<boolean> {
  if (target === "audio") {
    const current = program.audioControl ?? DEFAULT_MEDIA_CONTROL;
    return commit({ ...program, audioControl: { ...current, ...change } });
  }
  const current = program.mediaControl ?? DEFAULT_MEDIA_CONTROL;
  return commit({ ...program, mediaControl: { ...current, ...change } });
}

/** Play or pause the video in Preview without changing what is on the live screen. */
export function setPreviewMediaControl(change: Partial<StudioMediaControl>): Promise<boolean> {
  if (!program.preview?.media || program.preview.media.kind !== "video") return Promise.resolve(false);
  const current = program.preview.mediaControl ?? DEFAULT_MEDIA_CONTROL;
  return commit({
    ...program,
    preview: { ...program.preview, mediaControl: { ...current, ...change } },
  });
}

/** Stop the sound that is playing. */
export function stopProgramAudio(): Promise<boolean> {
  return commit({ ...program, audio: null });
}

/** Show an item on Preview projectors (null = empty Preview). */
export function setPreviewItem(item: StudioItem | null): Promise<boolean> {
  const packets = { ...(program.preview?.packets ?? {}) };
  let media: StudioMedia | null = null;
  if (item?.module === "media") media = item.media;
  else if (item) packets[item.module] = item.data;
  return commit({ ...program, preview: { active: item?.module ?? null, packets, media } });
}

/** Clear everything on Program (each module animates out). Sound and the camera stay. */
export interface ClearProgramOptions {
  screen?: StudioScreen;
  logoUrl?: string;
  churchName?: string;
  logoBg?: { color?: string; image?: string };
  camera?: StudioCamera;
  /** Keep the alternate feed visible while the main output changes looks. */
  preserveAlternate?: boolean;
}

export function clearProgram(mode: StudioMode, options: ClearProgramOptions = {}): Promise<boolean> {
  const packets = blankPackets(mode);
  liveText = null;
  const alt = options.preserveAlternate
    ? program.alt
    : altMode ? { mode: altMode, packets: blankPackets(altMode), active: null } : undefined;
  const screen = options.screen ?? "live";
  return commit({
    ...program,
    active: null,
    screen,
    logoUrl: screen === "logo" ? options.logoUrl : undefined,
    churchName: screen === "logo" ? options.churchName : undefined,
    logoBg: screen === "logo" ? options.logoBg : undefined,
    packets,
    media: null,
    alt,
    ...(options.camera ? { camera: { ...options.camera } } : {}),
  });
}

function blankPackets(mode: StudioMode): StudioProgramState["packets"] {
  const packets: StudioProgramState["packets"] = {};
  for (const module of STUDIO_MODULES) packets[module] = blankPacket(mode);
  return packets;
}

/**
 * Turn the alternate output on in a look (null = off) and draw what is on Program in that look now.
 * Called when the alternate preview is enabled, its look changes, or access is removed.
 */
export function setAltOutputMode(mode: StudioMode | null): Promise<boolean> {
  if (mode === altMode && Boolean(program.alt) === Boolean(mode)) return Promise.resolve(true);
  altMode = mode;
  if (!mode) return commit({ ...program, alt: undefined });
  const packets = blankPackets(mode);
  const active = program.active;
  if (active && active !== "media") {
    packets[active] = liveText && liveText.slide.module === active
      ? buildStudioPacket(active, liveText.slide, liveText.themes, mode, "cut").data
      : program.packets[active];
  }
  return commit({ ...program, alt: { mode, packets, active: active ?? null } });
}

/** Show a slide on Preview projectors (null = empty Preview). */
export function setPreviewState(slide: StudioSlide | null, themes: StudioThemes | null, mode: StudioMode): Promise<boolean> {
  const previousPreview = program.preview;
  const packets = { ...(program.preview?.packets ?? {}) };
  let media: StudioMedia | null = null;
  if (slide?.module === "media" && slide.media?.kind !== "audio") {
    media = slide.media ?? null;
  } else if (slide && slide.module !== "media") {
    packets[slide.module] = buildStudioPacket(slide.module, slide, themes, mode, "cut").data;
  }
  const active = slide ? (slide.module === "media" && !media ? null : slide.module) : null;
  // The module that was in Preview is blanked, as goLive does for Program, so its layer plays its exit
  // animation. Left as it was, the old words stayed under the new ones and then vanished with no animation.
  const leaving = previousPreview?.active;
  if (leaving && leaving !== "media" && leaving !== active) packets[leaving] = blankPacket(mode);
  const sameMedia = Boolean(media && previousPreview?.media
    && media.kind === previousPreview.media.kind && media.url === previousPreview.media.url);
  const mediaControl = media
    ? {
      ...(sameMedia ? previousPreview?.mediaControl ?? DEFAULT_MEDIA_CONTROL : DEFAULT_MEDIA_CONTROL),
      loop: media.loop,
      muted: media.muted,
      fit: media.fit,
      ...(sameMedia ? {} : { paused: false, seekTo: 0, seekRev: Date.now() }),
    }
    : undefined;
  return commit({ ...program, preview: { active, packets, media, ...(mediaControl ? { mediaControl } : {}) } });
}

// ── Frames ─────────────────────────────────────────────────────────────────

/** URL of a Preview iframe for a module, with its packet in the hash. */
export function previewFrameUrl(base: string, packet: StudioPacket | null, module: StudioTextModule): string {
  const page = OVERLAY_PAGE[module];
  const hash = packet ? `#data=${encodeURIComponent(JSON.stringify(packet.data))}` : "";
  return `${base}/${page}&mceRelay=0&mceSource=studio-preview-${module}${hash}`;
}

export function programFrameUrl(base: string): string {
  return `${base}/studio-output.html?monitor=1`;
}

/** The Studio's in-app monitor for the independent Alternate output feed. */
export function alternateFrameUrl(base: string): string {
  return `${base}/studio-output.html?monitor=1&feed=alt`;
}

/** The in-app Preview monitor: the output page showing the Preview feed. */
export function previewMonitorUrl(base: string): string {
  return `${base}/studio-output.html?monitor=1&feed=preview`;
}

/**
 * The Studio always talks to this computer's own copy of the local server (127.0.0.1).
 * The app may have cached its Wi-Fi address (http://192.168.x.x:45678) for OBS on other
 * laptops; the desktop webview blocks that address inside the app, which left the Preview
 * white and the output never updated. Same port, loopback host.
 */
export function toLoopbackBase(base: string): string {
  // Kept here (same as services/overlayUrl's) so the engine has no extra dependency.
  try {
    const url = new URL(base);
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return base;
  }
}

export async function studioBaseUrl(): Promise<string> {
  return toLoopbackBase(await getOverlayBaseUrl());
}

// ── Slides ─────────────────────────────────────────────────────────────────

/** Bible verses as slides. */
export function bibleSlides(
  book: string,
  chapter: number,
  translation: string,
  verses: Array<{ verse: number; text: string }>,
): StudioSlide[] {
  return verses.map((v) => ({
    key: `bible:${book}:${chapter}:${v.verse}:${translation}`,
    module: "bible",
    label: String(v.verse),
    verse: v.verse,
    text: v.text,
    reference: `${book} ${chapter}:${v.verse} (${translation})`,
    itemTitle: `${book} ${chapter}`,
    origin: { kind: "bible" as const, book, chapter, verse: v.verse, translation },
  }));
}

/**
 * Several verses in a row as one slide ("John 3:16-18"). Each verse keeps its number in
 * brackets, the way the Dock shows a passage.
 */
export function bibleRangeSlide(
  book: string,
  chapter: number,
  translation: string,
  verses: Array<{ verse: number; text: string }>,
): StudioSlide | null {
  const sorted = [...verses].sort((a, b) => a.verse - b.verse);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return bibleSlides(book, chapter, translation, sorted)[0];
  const first = sorted[0].verse;
  const last = sorted[sorted.length - 1].verse;
  return {
    key: `bible:${book}:${chapter}:${first}-${last}:${translation}`,
    module: "bible",
    label: `${first}-${last}`,
    verse: first,
    text: sorted.map((v) => `[${v.verse}] ${v.text}`).join("\n"),
    reference: `${book} ${chapter}:${first}-${last} (${translation})`,
    itemTitle: `${book} ${chapter}`,
    origin: { kind: "bible", book, chapter, verse: first, endVerse: last, translation },
  };
}

/** Split note text into slides on blank lines. */
export function noteSlides(noteId: string, title: string, content: string, linesPerSlide = 0): StudioSlide[] {
  const out: StudioSlide[] = [];
  content
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .forEach((block) => {
      // 0 = Original: one slide per block. Otherwise a long block is cut into slides of N lines.
      for (const text of chunkLines(block, linesPerSlide)) {
        const i = out.length;
        out.push({
          key: `note:${noteId}:${i}`,
          module: "notes" as const,
          label: `Slide ${i + 1}`,
          text,
          reference: "",
          itemTitle: title,
          origin: { kind: "note" as const, id: noteId, index: i },
        });
      }
    });
  return out;
}
