/**
 * builtinBroadcastTickers.ts — the tickers bundled with the desktop app.
 *
 * Mirrors desktop/src/components/modules/tickerThemes.ts (TICKER_THEMES) and
 * desktop/src/data/tickerThemes.ts (defaultTickerThemes). The admin portal lists these
 * next to uploaded ticker packages so each one can be paused, hidden or limited to a plan.
 * Add a line here when a ticker is added to the app.
 */
export interface BuiltinBroadcastTicker {
  graphicId: string;
  name: string;
  accentColor: string;
  description: string;
  sortOrder: number;
  /**
   * Taken out of newer apps. Older apps still bundle it, so it stays in this list but is always
   * "hidden", whatever an admin saved, and disappears from every user's ticker list.
   */
  retired?: boolean;
}

export const BUILTIN_BROADCAST_TICKERS: BuiltinBroadcastTicker[] = [
  { graphicId: "ticker-sunrise", name: "Sunrise", accentColor: "#F97316", description: "Warm orange gradient bar with a cream pill heading and soft glow. The heading can show your text or the live time.", sortOrder: 0 },
  { graphicId: "ticker-sunrise-clock", name: "Sunrise Clock", accentColor: "#F97316", description: "The Sunrise pill bar with the live time in the heading instead of a title.", sortOrder: 1, retired: true },
  { graphicId: "ticker-ocean", name: "Ocean Pill", accentColor: "#0EA5E9", description: "Deep navy to teal gradient with a light sweep and white pill heading.", sortOrder: 2 },
  { graphicId: "ticker-royal", name: "Royal Glow", accentColor: "#A855F7", description: "Purple to magenta gradient with a gold pill heading.", sortOrder: 3 },
  { graphicId: "ticker-emerald", name: "Emerald Live", accentColor: "#10B981", description: "Fresh green gradient with a pulsing live dot in the heading.", sortOrder: 4 },
  { graphicId: "ticker-midnight-gold", name: "Midnight Gold", accentColor: "#D4A017", description: "Elegant dark bar with a thin gold border and classic serif heading.", sortOrder: 5 },
  { graphicId: "ticker-fresh", name: "Fresh", accentColor: "#6366F1", description: "Clean modern ticker with rounded badge heading and smooth scroll", sortOrder: 6 },
  { graphicId: "ticker-minimal", name: "Minimal", accentColor: "#10B981", description: "Ultra-clean white ticker with subtle accent line", sortOrder: 7 },
  { graphicId: "ticker-glass", name: "Glass", accentColor: "#8B5CF6", description: "Frosted glass translucent bar with blur backdrop effect", sortOrder: 8 },
  { graphicId: "ticker-rotating-logo", name: "Rotating Logo", accentColor: "#1D4ED8", description: "Church logo rotates in, the line opens, then text scrolls", sortOrder: 9, retired: true },
  { graphicId: "ticker-bottom", name: "Bottom Ticker", accentColor: "#2F4D8A", description: "Bottom ticker-style footer for website and contact details.", sortOrder: 10 },
];
