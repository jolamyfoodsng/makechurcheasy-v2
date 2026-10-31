/**
 * broadcastPreviewHtml.ts
 *
 * Provides shared preview HTML generators for Broadcast Graphics and lower-third straps.
 * Supports kinetic animations, GSAP, variable injection, and responsive scaling.
 */

import { formatTickerClock, hasTickerClock, TICKER_CLOCK_SCRIPT } from "../data/tickerClock";
import { KINETIC_LOWER_THIRD_THEMES } from "./kineticThemes";
import type { TickerTheme } from "../data/tickerThemes";
import { getSettings as getMVSettings } from "../multiview/mvStore";
import { generateTickerHTML, type TickerThemeConfig } from "../components/modules/tickerThemes";
import { resolveOverlayAssetUrl } from "../services/overlayUrl";
import { substituteStyledVariables } from "./textStyle";

export interface BroadcastTheme {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  accentColor?: string;
  tags?: string[];
  variables?: Array<Record<string, unknown>>;
  html?: string;
  css?: string;
  fontImports?: string[];
  animation?: Record<string, unknown>;
  [key: string]: unknown;
}

export const TRUSTED_SCRIPTED_THEME_HTML = new Map<string, string>(
  KINETIC_LOWER_THIRD_THEMES.map((theme): [string, string] => [theme.id, theme.html]),
);

export function isKineticObsTheme(theme: BroadcastTheme): boolean {
  return typeof theme.html === "string" && theme.html.includes("kx-root");
}

/**
 * Admin-published graphics: the theme HTML is built by graphicPackages.ts (a .kx-root carrying
 * the package as base64 data); the scripts that run are the app's own bundled runtime.
 */
function isGeneratedPackageTheme(theme: BroadcastTheme): boolean {
  const html = typeof theme.html === "string" ? theme.html : "";
  return /^lt-pkg-[\w-]+$/.test(theme.id)
    && html.startsWith('<div class="kx-root" data-kx="pkg-')
    && !/<script|<iframe|<object|<embed|javascript:|\son[a-z]+\s*=/i.test(html);
}

/**
 * Motion (kinetic) graphics are only data attributes on a .kx-root; the scripts that draw
 * them are the app's own bundled runtime. Saved/customised copies get a new theme id, so
 * they are recognised by their markup rather than by id.
 */
function isScriptFreeKineticTheme(theme: BroadcastTheme): boolean {
  const html = typeof theme.html === "string" ? theme.html.trim() : "";
  return html.startsWith('<div class="kx-root"')
    && !/<script|<iframe|<object|<embed|<link|javascript:|\son[a-z]+\s*=/i.test(html);
}

export function obsPreviewSandbox(theme: BroadcastTheme): string {
  const trusted = typeof theme.html === "string"
    && (
      TRUSTED_SCRIPTED_THEME_HTML.get(theme.id) === theme.html
      || isGeneratedPackageTheme(theme)
      || isScriptFreeKineticTheme(theme)
    );
  return trusted ? "allow-same-origin allow-scripts" : "allow-same-origin";
}

/** Pick a backdrop that contrasts with a kinetic strap's text colour */
export function kineticPreviewBackdrop(theme: BroadcastTheme, customBackdrop?: string): string {
  if (customBackdrop) return customBackdrop;
  const vars = (theme.variables || []) as Array<Record<string, unknown>>;
  // Motion straps carry kxColor; graphics with dark name text (e.g. "Name + Theme") carry a "Name colour".
  const colourVar =
    vars.find((v) => v.key === "kxColor") ||
    vars.find((v) => v.type === "color" && /^name colou?r$/i.test(String(v.label || "")));
  const hex = String(colourVar?.defaultValue ?? "#ffffff").replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#1c2230";
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? "#1c2230" : "#e9e8e4";
}

export interface PreviewHtmlOptions {
  loop?: boolean;
  hover?: boolean;
  customVariables?: Record<string, string>;
  backdrop?: string;
}

/**
 * Builds preview iframe HTML for Broadcast Graphics.
 */
export function buildThemePreviewHtml(
  theme: BroadcastTheme,
  options: PreviewHtmlOptions = {},
): string {
  if (!theme.html || !theme.css) return "";
  let html = theme.html;
  const resolvedValues: Record<string, string> = {};

  if (theme.variables) {
    for (const v of theme.variables) {
      const varDef = v as Record<string, unknown>;
      if (typeof varDef.key === "string") {
        resolvedValues[varDef.key] = (varDef.defaultValue as string) ?? "";
      }
    }
  }

  // Overlay custom variables
  if (options.customVariables) {
    Object.assign(resolvedValues, options.customVariables);
  }

  // Fills {{key}} and applies each text's style (letter case, size, weight…).
  html = substituteStyledVariables(html, resolvedValues);
  html = html.split("{{state}}").join("in");

  if (isKineticObsTheme(theme)) {
    const kineticFontLinks = (Array.isArray(theme.fontImports) ? theme.fontImports : [])
      .filter((url): url is string => typeof url === "string")
      .map((url) => `<link rel="stylesheet" href="${url}">`)
      .join("\n");

    const bg = kineticPreviewBackdrop(theme, options.backdrop);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
#kx-canvas { position: absolute; left: 0; top: 0; width: 1440px; height: 810px; transform-origin: 0 0; display: flex; align-items: center; justify-content: center; }
#kx-canvas > .kx-root { width: auto; padding: 0; }
${theme.css}
html, body { background: ${bg} !important; }
</style>
<script src="/kinetic/gsap.min.js"></script>
${kineticFontLinks}
<script src="/kinetic/kinetic-lower-thirds.js?v=6"></script>
<script src="/kinetic/subscribe-lower-thirds.js?v=1"></script>
<script src="/kinetic/church-lower-thirds.js?v=4"></script>
<script src="/kinetic/sunday-lower-thirds.js?v=3"></script>
<script src="/kinetic/stream-lower-thirds.js?v=2"></script>
<script src="/kinetic/mce-graphic-packages.js?v=4"></script>
</head>
<body>
<div id="kx-canvas">${html}</div>
<script>
(function () {
  var canvas = document.getElementById("kx-canvas");
  var loop = ${options.loop ? "true" : "false"};
  var hover = ${options.hover ? "true" : "false"};
  function fit() {
    var scale = Math.min(window.innerWidth / 1440, window.innerHeight / 810);
    canvas.style.transform = "translate(" + ((window.innerWidth - 1440 * scale) / 2) + "px," + ((window.innerHeight - 810 * scale) / 2) + "px) scale(" + scale + ")";
  }
  function play() {
    if (!window.MCEKinetic) return;
    var inMs = window.MCEKinetic.run(canvas, "in");
    if (!loop) {
      setTimeout(still, inMs + 100);
      return;
    }
    setTimeout(function () {
      var outMs = window.MCEKinetic.run(canvas, "out");
      setTimeout(play, outMs + 600);
    }, inMs + 2200);
  }
  function still() { if (window.MCEKinetic) window.MCEKinetic.run(canvas, "hold"); }
  if (window.gsap && window.gsap.ticker) setInterval(function () { window.gsap.ticker.tick(); }, 33);
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || !window.MCEKinetic) return;
    if (e.data.type === "mce-kx-play") play();
    else if (e.data.type === "mce-kx-stop") still();
    else if (e.data.type === "mce-kx-in") { loop = false; play(); }
    else if (e.data.type === "mce-kx-out") { loop = false; window.MCEKinetic.run(canvas, "out"); }
  });
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(hover ? still : play);
})();
</script>
</body>
</html>`;
  }

  const rawFontImports = theme.fontImports;
  const fontImports = Array.isArray(rawFontImports)
    ? rawFontImports
        .filter((url): url is string => typeof url === "string")
        .map((url) => `<link rel="stylesheet" href="${url}">`)
        .join("\n")
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${fontImports}
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { min-width: 200px; transform-origin: top left; text-align: left; }
${theme.css}
</style>
</head>
<body>
${html}
</body>
</html>`;
}

export function buildTickerPreviewHtml(ticker: TickerTheme): string {
  let html = ticker.html;
  const resolvedValues: Record<string, string> = {
    badge: ticker.badge,
    tickerText: ticker.tickerText,
    speed: ticker.speed,
    clock: formatTickerClock(),
  };
  for (const [key, value] of Object.entries(resolvedValues)) {
    const escaped = value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    html = html.split(`{{${key}}}`).join(escaped);
  }
  const rawFontImports = ticker.fontImports;
  const fontImports = Array.isArray(rawFontImports)
    ? rawFontImports
        .filter((url): url is string => typeof url === "string")
        .map((url) => `<link rel="stylesheet" href="${url}">`)
        .join("\n")
    : "";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${fontImports}
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { min-width: 200px; transform-origin: top left; text-align: left; display: flex; align-items: flex-end; }
${ticker.css}
</style>
</head>
<body>
${html}
${hasTickerClock(html) ? TICKER_CLOCK_SCRIPT : ""}
</body>
</html>`;
}

export function buildDockTickerPreviewHtml(
  dockTheme: TickerThemeConfig,
  sampleMessages: string[],
): string {
  const branding = getMVSettings();
  return generateTickerHTML(
    dockTheme,
    dockTheme.defaultColors,
    dockTheme.defaultHeading,
    sampleMessages,
    50,
    "bottom",
    true,
    false,
    resolveOverlayAssetUrl(branding.brandLogoPath),
    branding.churchName || "MakeChurchEazy",
  );
}
