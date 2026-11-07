/**
 * Sixth reference set (Oct 2026): "Red Ember Frame" — from Tayo's Revayah / Rivers Camp Meeting scripture slide.
 * A dark red smoke-and-embers backdrop (public/theme-backgrounds/red-ember-fullscreen.webp, made by
 * scripts/make-red-ember-texture.py), a notched dark panel, a gold-framed plaque with the reference in a
 * bold serif, the verse in white Montserrat with a gold rule under it, the two event logos at the top and
 * a footer with the dates, the event name and the social handle.
 *
 * The logos, dates, event name and handle are plain layers, so a church changes them in the theme editor.
 * The plaque hugs its words and is the heading, so it hides itself when Worship / Notes send no label.
 * The lower third (RED_EMBER_FRAME_LT) carries the same plaque on an ember band.
 */
import type { LayerAnimation, ThemeLayout } from "./types";

const anim = (preset: LayerAnimation["preset"], duration: number, delay = 0, extra: Partial<LayerAnimation> = {}): LayerAnimation => ({
  preset, duration, delay, easing: "out-expo", ...extra,
});

const EMBER_BLACK = "#0b0404";
const PLAQUE_RED = "#3b0b0b";
const GOLD = "#d6ae62";
export const RED_EMBER_FULLSCREEN_TEXTURE = "/theme-backgrounds/red-ember-fullscreen.webp";
export const RED_EMBER_BAND_TEXTURE = "/theme-backgrounds/red-ember-band.webp";
export const RED_EMBER_ASSETS = {
  leftLogo: "/theme-backgrounds/revayah/saviours-assembly.png",
  rightLogo: "/theme-backgrounds/revayah/rivers-camp-meeting.png",
  socials: "/theme-backgrounds/revayah/socials.svg",
};

/** Corners cut at 56px, like the reference panel. */
const NOTCHED = "polygon(56px 0, calc(100% - 56px) 0, 100% 56px, 100% calc(100% - 56px), calc(100% - 56px) 100%, 56px 100%, 0 calc(100% - 56px), 0 56px)";

/** Gold-framed plaque: a thin gold edge, a dark gap and a second gold line inside it. */
const plaqueStyle = (fontSize: number, padding: [number, number, number, number]) => ({
  hug: true,
  gradient: { type: "linear" as const, angle: 180, stops: [{ color: "#4a0f0f", at: 0 }, { color: PLAQUE_RED, at: 55 }, { color: "#200606", at: 100 }] },
  borderWidth: 3,
  borderColor: GOLD,
  shadow: `inset 0 0 0 7px #1c0606, inset 0 0 0 9px rgba(214,174,98,0.7), 0 14px 34px rgba(0,0,0,0.6)`,
  padding,
  fontFamily: "Libre Baskerville",
  fontSize,
  minFontSize: Math.round(fontSize * 0.55),
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase" as const,
  align: "center" as const,
  color: "#ffffff",
  textShadow: "0 3px 6px rgba(0,0,0,0.6)",
  maxLines: 1,
});

const goldRule = { type: "linear" as const, angle: 90, stops: [{ color: "rgba(214,174,98,0)", at: 0 }, { color: GOLD, at: 50 }, { color: "rgba(214,174,98,0)", at: 100 }] };

export const RED_EMBER_FRAME_FS: ThemeLayout = {
  version: 1,
  format: "fullscreen",
  swap: "content",
  layers: [
    {
      id: "bg",
      name: "Ember background",
      type: "box",
      anchor: "top-left",
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      // The fill shows while the texture loads, or if it cannot load.
      style: { fill: EMBER_BLACK, src: RED_EMBER_FULLSCREEN_TEXTURE, fit: "cover" },
      in: anim("fade", 500),
      out: anim("fade", 400, 220),
    },
    {
      id: "panel-edge",
      name: "Panel edge",
      type: "box",
      anchor: "top-left",
      x: 34,
      y: 300,
      w: 1852,
      h: 590,
      style: { fill: "rgba(150,34,28,0.55)", clipPath: NOTCHED },
      in: anim("fade", 520, 80),
      out: anim("fade", 300, 140),
    },
    {
      id: "panel",
      name: "Panel",
      type: "box",
      anchor: "top-left",
      x: 37,
      y: 303,
      w: 1846,
      h: 584,
      style: {
        gradient: { type: "linear", angle: 180, stops: [{ color: "rgba(12,4,4,0.78)", at: 0 }, { color: "rgba(8,3,3,0.68)", at: 100 }] },
        clipPath: NOTCHED,
      },
      in: anim("fade", 520, 80),
      out: anim("fade", 300, 140),
    },
    {
      id: "logo-left",
      name: "Left logo",
      type: "image",
      anchor: "top-left",
      x: 88,
      y: 74,
      w: 236,
      h: 100,
      style: { src: RED_EMBER_ASSETS.leftLogo, fit: "contain" },
      in: anim("fade", 500, 300),
      out: anim("fade", 220),
    },
    {
      id: "logo-right",
      name: "Right logo",
      type: "image",
      anchor: "top-right",
      x: 1832,
      y: 64,
      w: 236,
      h: 110,
      style: { src: RED_EMBER_ASSETS.rightLogo, fit: "contain" },
      in: anim("fade", 500, 300),
      out: anim("fade", 220),
    },
    {
      id: "label",
      name: "Reference plaque",
      type: "text",
      heading: true,
      content: "{reference}",
      anchor: "top-center",
      x: 960,
      y: 222,
      w: 1500,
      h: "auto",
      style: plaqueStyle(74, [32, 110, 28, 110]),
      in: anim("pop", 520, 260),
      out: anim("fade", 200),
    },
    {
      id: "verse",
      name: "Verse",
      type: "text",
      content: "{text}",
      anchor: "top-center",
      x: 960,
      y: 436,
      w: 1460,
      h: 390,
      style: {
        fontFamily: "Montserrat",
        fontSize: 68,
        minFontSize: 36,
        fontWeight: 600,
        lineHeight: 1.24,
        align: "center",
        verticalAlign: "middle",
        color: "#ffffff",
        textShadow: "0 4px 10px rgba(0,0,0,0.55)",
        verseNumberColor: "#ffffff",
      },
      in: anim("line-rise", 520, 460, { stagger: 70 }),
      out: anim("fade", 240),
    },
    {
      id: "rule",
      name: "Gold rule",
      type: "box",
      anchor: "top-center",
      x: 960,
      y: 852,
      w: 430,
      h: 3,
      style: { gradient: goldRule },
      in: anim("grow-x", 600, 700),
      out: anim("fade", 200),
    },
    {
      id: "dates",
      name: "Dates",
      type: "text",
      content: "OCT 30TH – NOV 1ST 2026",
      anchor: "middle-left",
      x: 98,
      y: 990,
      w: 620,
      h: "auto",
      style: { fontFamily: "Oswald", fontSize: 40, fontWeight: 500, letterSpacing: 1.5, color: "#ffffff", textTransform: "uppercase", maxLines: 1 },
      in: anim("slide-up", 500, 600, { distance: 20 }),
      out: anim("fade", 200),
    },
    {
      id: "event",
      name: "Event name",
      type: "text",
      content: "Revayah",
      anchor: "center",
      x: 960,
      y: 988,
      w: 600,
      h: "auto",
      style: {
        fontFamily: "Oswald",
        fontSize: 104,
        fontWeight: 700,
        letterSpacing: -2,
        align: "center",
        color: "#e3161b",
        textShadow: "0 0 18px rgba(227,22,27,0.45), 0 4px 8px rgba(0,0,0,0.6)",
        maxLines: 1,
      },
      in: anim("scale", 560, 640),
      out: anim("fade", 200),
    },
    {
      id: "socials",
      name: "Social icons",
      type: "image",
      anchor: "middle-left",
      x: 1290,
      y: 990,
      w: 196,
      h: 40,
      style: { src: RED_EMBER_ASSETS.socials, fit: "contain" },
      in: anim("slide-up", 500, 680, { distance: 20 }),
      out: anim("fade", 200),
    },
    {
      id: "handle",
      name: "Social handle",
      type: "text",
      content: "@savioursassembly",
      anchor: "middle-left",
      x: 1504,
      y: 990,
      w: 340,
      h: "auto",
      style: { fontFamily: "Montserrat", fontSize: 32, minFontSize: 22, fontWeight: 600, color: "#ffffff", maxLines: 1 },
      in: anim("slide-up", 500, 720, { distance: 20 }),
      out: anim("fade", 200),
    },
  ],
};

const BAND_X = 40;
const BAND_Y = 808;
const BAND_W = 1840;
const BAND_H = 236;

/** Lower third: the gold plaque sits on the top edge of an ember band, verse inside. */
export const RED_EMBER_FRAME_LT: ThemeLayout = {
  version: 1,
  format: "lower-third",
  swap: "content",
  layers: [
    {
      id: "band-edge",
      name: "Band edge",
      type: "box",
      anchor: "top-left",
      x: BAND_X - 3,
      y: BAND_Y - 3,
      w: BAND_W + 6,
      h: BAND_H + 6,
      style: { fill: "rgba(214,174,98,0.75)", clipPath: "polygon(36px 0, calc(100% - 36px) 0, 100% 36px, 100% 100%, 0 100%, 0 36px)" },
      in: anim("wipe-right", 600, 60),
      out: anim("fade", 320, 160),
    },
    {
      id: "band",
      name: "Ember band",
      type: "box",
      anchor: "top-left",
      x: BAND_X,
      y: BAND_Y,
      w: BAND_W,
      h: BAND_H,
      style: {
        fill: EMBER_BLACK,
        src: RED_EMBER_BAND_TEXTURE,
        fit: "cover",
        clipPath: "polygon(34px 0, calc(100% - 34px) 0, 100% 34px, 100% 100%, 0 100%, 0 34px)",
        shadow: "0 10px 28px rgba(0,0,0,0.4)",
      },
      in: anim("wipe-right", 600, 100),
      out: anim("fade", 320, 160),
    },
    {
      id: "label",
      name: "Reference plaque",
      type: "text",
      heading: true,
      content: "{reference}",
      anchor: "bottom-center",
      x: BAND_X + BAND_W / 2,
      y: BAND_Y + 30,
      w: 1100,
      h: "auto",
      style: plaqueStyle(40, [18, 72, 14, 72]),
      in: anim("slide-down", 420, 0, { distance: 16 }),
      out: anim("fade", 200),
    },
    {
      id: "verse",
      name: "Verse",
      type: "text",
      parentId: "band",
      content: "{text}",
      anchor: "top-left",
      x: 90,
      y: 46,
      w: BAND_W - 180,
      h: BAND_H - 64,
      style: {
        fontFamily: "Montserrat",
        fontSize: 46,
        minFontSize: 26,
        fontWeight: 600,
        lineHeight: 1.22,
        align: "center",
        verticalAlign: "middle",
        color: "#ffffff",
        textShadow: "0 3px 8px rgba(0,0,0,0.6)",
        verseNumberColor: "#ffffff",
      },
      in: anim("line-rise", 480, 380, { stagger: 60 }),
      out: anim("fade", 220),
    },
  ],
};

/** Preset list entry: the full screen from the reference and its matching lower third. */
export const SET6_PRESETS: Array<{ id: string; name: string; layout: ThemeLayout; companion: ThemeLayout }> = [
  { id: "preset-red-ember-frame", name: "Red Ember Frame", layout: RED_EMBER_FRAME_FS, companion: RED_EMBER_FRAME_LT },
];
