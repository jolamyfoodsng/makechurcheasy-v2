/**
 * Fifth reference set (Oct 2026): "Blue Paint Banner" — from Tayo's scripture-reference picture.
 * A wide band across the bottom painted with a blue acrylic texture
 * (public/theme-backgrounds/blue-paint-banner.webp, made by scripts/make-blue-paint-texture.py),
 * bold condensed white capitals with a drop shadow, and a navy tab centred on the band's top edge
 * with the reference (e.g. "JOHN 3:16 (KJV)").
 *
 * The tab hugs its words, so it hides itself when Worship / Notes send no label.
 * The full screen (BLUE_PAINT_BANNER_FS) is hand-made so it keeps the paint, using a full-size
 * texture (public/theme-backgrounds/blue-paint-fullscreen.webp) from the same script.
 */
import type { LayerAnimation, ThemeLayout } from "./types";

const anim = (preset: LayerAnimation["preset"], duration: number, delay = 0, extra: Partial<LayerAnimation> = {}): LayerAnimation => ({
  preset, duration, delay, easing: "out-expo", ...extra,
});

const PAINT_BLUE = "#1b5f8c";
const TAB_NAVY = "#0a1433";
export const BLUE_PAINT_TEXTURE = "/theme-backgrounds/blue-paint-banner.webp";
export const BLUE_PAINT_FULLSCREEN_TEXTURE = "/theme-backgrounds/blue-paint-fullscreen.webp";

const BAND_X = 40;
const BAND_Y = 832;
const BAND_W = 1840;
const BAND_H = 210;

export const BLUE_PAINT_BANNER: ThemeLayout = {
  version: 1,
  format: "lower-third",
  swap: "content",
  layers: [
    {
      id: "band",
      name: "Paint band",
      type: "box",
      anchor: "top-left",
      x: BAND_X,
      y: BAND_Y,
      w: BAND_W,
      h: BAND_H,
      style: {
        // The fill shows while the texture loads, or if it cannot load.
        fill: PAINT_BLUE,
        src: BLUE_PAINT_TEXTURE,
        fit: "cover",
        shadow: "0 10px 28px rgba(0,0,0,0.35)",
      },
      in: anim("wipe-right", 600, 100),
      out: anim("fade", 320, 160),
    },
    {
      id: "label",
      name: "Reference tab",
      type: "text",
      content: "{reference}",
      anchor: "bottom-center",
      x: BAND_X + BAND_W / 2,
      y: BAND_Y + 26,
      w: 900,
      h: "auto",
      style: {
        hug: true,
        fill: TAB_NAVY,
        padding: [8, 110, 6, 110],
        fontFamily: "Bebas Neue",
        fontSize: 38,
        minFontSize: 22,
        letterSpacing: 2,
        textTransform: "uppercase",
        align: "center",
        color: "#ffffff",
        maxLines: 1,
      },
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
      y: 38,
      w: BAND_W - 180,
      h: BAND_H - 56,
      style: {
        fontFamily: "Bebas Neue",
        fontSize: 66,
        minFontSize: 34,
        letterSpacing: 1,
        lineHeight: 1.08,
        textTransform: "uppercase",
        align: "center",
        verticalAlign: "middle",
        color: "#ffffff",
        textShadow: "0 4px 6px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.6)",
        verseNumberColor: "#9fd8ff",
      },
      in: anim("line-rise", 480, 380, { stagger: 60 }),
      out: anim("fade", 220),
    },
  ],
};

/** Full screen: the paint fills the screen, with the navy tab above big shadowed capitals. */
export const BLUE_PAINT_BANNER_FS: ThemeLayout = {
  version: 1,
  format: "fullscreen",
  swap: "content",
  layers: [
    {
      id: "bg",
      name: "Paint background",
      type: "box",
      anchor: "top-left",
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      style: {
        fill: PAINT_BLUE,
        src: BLUE_PAINT_FULLSCREEN_TEXTURE,
        fit: "cover",
        // Darkened a little so the white capitals stay readable on the lighter strokes.
        dim: 18,
      },
      in: anim("fade", 500),
      out: anim("fade", 400, 200),
    },
    {
      id: "label",
      name: "Reference tab",
      type: "text",
      content: "{reference}",
      anchor: "bottom-center",
      x: 960,
      y: 300,
      w: 1200,
      h: "auto",
      style: {
        hug: true,
        fill: TAB_NAVY,
        padding: [12, 140, 8, 140],
        fontFamily: "Bebas Neue",
        fontSize: 56,
        minFontSize: 30,
        letterSpacing: 3,
        textTransform: "uppercase",
        align: "center",
        color: "#ffffff",
        maxLines: 1,
        shadow: "0 10px 28px rgba(0,0,0,0.35)",
      },
      in: anim("slide-down", 480, 200, { distance: 24 }),
      out: anim("fade", 200),
    },
    {
      id: "verse",
      name: "Verse",
      type: "text",
      content: "{text}",
      anchor: "top-center",
      x: 960,
      y: 360,
      w: 1640,
      h: 600,
      style: {
        fontFamily: "Bebas Neue",
        fontSize: 120,
        minFontSize: 52,
        letterSpacing: 1.5,
        lineHeight: 1.06,
        textTransform: "uppercase",
        align: "center",
        verticalAlign: "middle",
        color: "#ffffff",
        textShadow: "0 6px 10px rgba(0,0,0,0.55), 0 2px 3px rgba(0,0,0,0.6)",
        verseNumberColor: "#9fd8ff",
      },
      in: anim("line-rise", 560, 420, { stagger: 70 }),
      out: anim("fade", 260),
    },
  ],
};

/** Preset list entry: the lower third and its hand-made full screen. */
export const SET5_PRESETS: Array<{ id: string; name: string; layout: ThemeLayout; companion: ThemeLayout }> = [
  { id: "preset-blue-paint-banner", name: "Blue Paint Banner", layout: BLUE_PAINT_BANNER, companion: BLUE_PAINT_BANNER_FS },
];
