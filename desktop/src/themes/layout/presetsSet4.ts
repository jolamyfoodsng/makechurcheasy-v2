/**
 * Fourth reference set (Oct 2026): "Prayer Point" — from Tayo's prayer-point picture.
 * A deep indigo bar across the bottom with bold, centred white text and a soft
 * light band across it (drawn in the bar's gradient, so it shows even where
 * endless loops are switched off; the shimmer loop adds movement where they run), and a white tab sitting on its top-left corner with the
 * reference in wide-spaced navy capitals (e.g. "JOHN 3:16 (KJV)", or "PRAYER POINT"
 * when Notes sends that as the label).
 *
 * The tab hugs its words, so it hides itself when Worship / Notes send no label.
 * The full screen is made from the lower third by companions.ts.
 */
import type { LayerAnimation, ThemeLayout } from "./types";

const anim = (preset: LayerAnimation["preset"], duration: number, delay = 0, extra: Partial<LayerAnimation> = {}): LayerAnimation => ({
  preset, duration, delay, easing: "out-expo", ...extra,
});

const INDIGO = "#1b0c55";
const NAVY_INK = "#1a1244";

export const PRAYER_POINT: ThemeLayout = {
  version: 1,
  format: "lower-third",
  swap: "content",
  layers: [
    {
      id: "bar",
      name: "Bar",
      type: "box",
      anchor: "top-left",
      x: 70,
      y: 852,
      w: 1780,
      h: 158,
      style: {
        fill: INDIGO,
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { color: INDIGO, at: 0 },
            { color: INDIGO, at: 66 },
            { color: "#4a3f8a", at: 71 },
            { color: INDIGO, at: 77 },
            { color: "#170a4a", at: 100 },
          ],
        },
        shadow: "0 10px 28px rgba(0,0,0,0.35)",
      },
      loop: { preset: "shimmer", duration: 5200 },
      in: anim("wipe-right", 560, 120),
      out: anim("fade", 320, 160),
    },
    {
      id: "label",
      name: "Label tab",
      type: "text",
      content: "{reference}",
      anchor: "bottom-left",
      x: 70,
      y: 852,
      w: 1100,
      h: "auto",
      style: {
        hug: true,
        fill: "#ffffff",
        padding: [10, 34, 9, 34],
        fontFamily: "Montserrat",
        fontSize: 26,
        minFontSize: 16,
        fontWeight: 700,
        letterSpacing: 6,
        textTransform: "uppercase",
        color: NAVY_INK,
        maxLines: 1,
      },
      in: anim("slide-up", 420, 0, { distance: 16 }),
      out: anim("fade", 200),
    },
    {
      id: "verse",
      name: "Verse",
      type: "text",
      parentId: "bar",
      content: "{text}",
      anchor: "top-left",
      x: 60,
      y: 16,
      w: 1660,
      h: 126,
      style: {
        fontFamily: "Montserrat",
        fontSize: 34,
        minFontSize: 20,
        fontWeight: 700,
        lineHeight: 1.32,
        align: "center",
        verticalAlign: "middle",
        color: "#ffffff",
        verseNumberColor: "#b8a9ff",
      },
      in: anim("line-rise", 480, 360, { stagger: 60 }),
      out: anim("fade", 220),
    },
  ],
};

/** Preset list entry: the lower third (its full screen is built by companions.ts). */
export const SET4_PRESETS: Array<{ id: string; name: string; layout: ThemeLayout }> = [
  { id: "preset-prayer-point", name: "Prayer Point", layout: PRAYER_POINT },
];
