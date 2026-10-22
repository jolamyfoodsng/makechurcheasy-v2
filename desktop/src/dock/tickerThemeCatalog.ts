import { formatTickerClock, hasTickerClock, TICKER_CLOCK_SCRIPT } from "../data/tickerClock";
import { buildTickerSpeedScript, hasTickerMove, tickerPixelsPerSecond } from "../data/tickerSpeed";
import {
  TICKER_THEMES as DOCK_TICKER_THEMES,
  generateTickerHTML,
  type TickerThemeColors,
  type TickerThemeConfig,
} from "../components/modules/tickerThemes";
import { defaultTickerThemes, type TickerTheme as PermanentTickerTheme } from "../data/tickerThemes";
import {
  remoteThemeToPermanentTickerTheme,
  remoteThemeToTickerConfig,
  type RemoteProductionTheme,
} from "../services/remoteProductionThemes";
import { normalizeDockFontFamily } from "./dockFontFamily";

export type DockTickerThemeOption =
  | {
      id: string;
      name: string;
      description: string;
      defaultHeading: string;
      accentColor: string;
      source: "dock";
      theme: TickerThemeConfig;
    }
  | {
      id: string;
      name: string;
      description: string;
      defaultHeading: string;
      accentColor: string;
      source: "remote";
      theme: TickerThemeConfig;
    }
  | {
      id: string;
      name: string;
      description: string;
      defaultHeading: string;
      accentColor: string;
      source: "remote-template";
      theme: PermanentTickerTheme;
    }
  | {
      id: string;
      name: string;
      description: string;
      defaultHeading: string;
      accentColor: string;
      source: "permanent";
      theme: PermanentTickerTheme;
    };

export type DockTickerDivider = "theme" | "none" | "dot" | "line" | "diamond" | "spark";

const DOCK_TICKER_DIVIDER_CHARS: Record<Exclude<DockTickerDivider, "theme" | "none">, string> = {
  dot: "•",
  line: "—",
  diamond: "◆",
  spark: "✦",
};

export function resolveDockTickerDividerChar(
  divider: DockTickerDivider | undefined,
  fallback = "•",
): string {
  if (divider === "none") return "";
  if (divider && divider !== "theme") return DOCK_TICKER_DIVIDER_CHARS[divider];
  return fallback;
}

export function formatDockTickerMessages(
  messages: string[],
  divider: DockTickerDivider | undefined = "theme",
  extraSpacing = 0,
  fallbackDivider = "•",
): string {
  const safeMessages = messages.map((message) => message.trim()).filter(Boolean);
  const dividerChar = resolveDockTickerDividerChar(divider, fallbackDivider);
  const spacing = Math.max(0, Math.min(100, Math.round(Number(extraSpacing) || 0)));
  const extraSpace = "\u00a0".repeat(Math.ceil(spacing / 8));
  const separator = dividerChar
    ? `${extraSpace}   ${dividerChar}   ${extraSpace}`
    : `${extraSpace}   `;
  return safeMessages.join(separator);
}

interface RenderDockTickerThemeOptions {
  option: DockTickerThemeOption;
  heading: string;
  messages: string[];
  speed: number;
  position: "top" | "bottom";
  loop: boolean;
  paused?: boolean;
  colors?: TickerThemeColors;
  fontFamily?: string;
  brandLogoUrl?: string;
  brandName?: string;
  divider?: DockTickerDivider;
  messageSpacing?: number;
  /** Pill tickers: what the heading shows. "time" = the live clock instead of the heading text. */
  headingMode?: "text" | "time";
}

const ALL_DOCK_TICKER_THEME_OPTIONS: DockTickerThemeOption[] = [
  ...DOCK_TICKER_THEMES.map((theme) => ({
    id: theme.id,
    name: theme.name,
    description: theme.description,
    defaultHeading: theme.defaultHeading,
    accentColor: theme.defaultColors.accent,
    source: "dock" as const,
    theme,
  })),
  ...defaultTickerThemes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    description: theme.description,
    defaultHeading: theme.badge || theme.name,
    accentColor: theme.accentColor,
    source: "permanent" as const,
    theme,
  })),
];

export const DEFAULT_DOCK_TICKER_THEME_OPTION =
  ALL_DOCK_TICKER_THEME_OPTIONS[0];

/**
 * Admin control (Admin → Broadcast Graphics → Tickers): tickers uploaded as "mce-ticker@1"
 * packages, and the ids that are paused, hidden or not on this user's plan. Set from the
 * downloaded catalog (main app) or dock-broadcast-graphics.json (Dock).
 */
let adminPackageTickers: PermanentTickerTheme[] = [];
let adminBlockedTickerIds = new Set<string>();

export function setDockTickerAdminPolicy(policy: {
  blocked?: Iterable<string>;
  packageTickers?: PermanentTickerTheme[];
}): void {
  adminBlockedTickerIds = new Set(policy.blocked ?? []);
  adminPackageTickers = (policy.packageTickers ?? []).filter(
    (theme) => theme && typeof theme.id === "string" && typeof theme.html === "string",
  );
}

export function isDockTickerBlocked(themeId: string): boolean {
  return adminBlockedTickerIds.has(themeId);
}

export function getAllDockTickerThemeOptions(
  remoteThemes: RemoteProductionTheme[] = [],
): DockTickerThemeOption[] {
  const merged = new Map<string, DockTickerThemeOption>();
  for (const theme of adminPackageTickers) {
    merged.set(theme.id, {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      defaultHeading: theme.badge || theme.name,
      accentColor: theme.accentColor,
      source: "permanent",
      theme,
    });
  }
  for (const option of ALL_DOCK_TICKER_THEME_OPTIONS) {
    merged.set(option.id, option);
  }

  for (const remoteTheme of remoteThemes) {
    const permanentTheme = remoteThemeToPermanentTickerTheme(remoteTheme);
    if (permanentTheme) {
      merged.set(permanentTheme.id, {
        id: permanentTheme.id,
        name: permanentTheme.name,
        description: permanentTheme.description,
        defaultHeading: permanentTheme.badge || permanentTheme.name,
        accentColor: permanentTheme.accentColor,
        source: "remote-template",
        theme: permanentTheme,
      });
      continue;
    }

    const theme = remoteThemeToTickerConfig(remoteTheme);
    if (!theme) continue;
    merged.set(theme.id, {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      defaultHeading: theme.defaultHeading,
      accentColor: theme.defaultColors.accent,
      source: "remote",
      theme,
    });
  }

  return [...merged.values()].filter((option) => !adminBlockedTickerIds.has(option.id));
}

export function resolveDockTickerThemeOption(
  themeId: string | null | undefined,
  remoteThemes: RemoteProductionTheme[] = [],
): DockTickerThemeOption | undefined {
  if (!themeId) return undefined;
  return getAllDockTickerThemeOptions(remoteThemes).find((option) => option.id === themeId);
}

/**
 * The tickers the Dock offers: the ones added to OBS in Broadcast Graphics, or all of them
 * when none were added. `limit` (the plan's ticker limit, -1 = unlimited) caps the list.
 */
export function getDockTickerThemeOptionsForFavorites(
  favorites: ReadonlySet<string> | null | undefined,
  remoteThemes: RemoteProductionTheme[] = [],
  limit = -1,
): DockTickerThemeOption[] {
  const allOptions = getAllDockTickerThemeOptions(remoteThemes);
  const cap = (list: DockTickerThemeOption[]) =>
    limit >= 0 && Number.isFinite(limit) ? list.slice(0, Math.max(0, limit)) : list;
  if (!favorites || favorites.size === 0) {
    return cap(allOptions);
  }

  const filtered = allOptions.filter((option) => favorites.has(option.id));
  return cap(filtered.length > 0 ? filtered : allOptions);
}

export function renderDockTickerThemeHtml({
  option,
  heading,
  messages,
  speed,
  position,
  loop,
  paused = false,
  colors,
  fontFamily,
  brandLogoUrl = "",
  brandName = "",
  divider,
  messageSpacing,
  headingMode,
}: RenderDockTickerThemeOptions): string {
  const safeMessages = messages.map((message) => message.trim()).filter(Boolean);
  const resolvedHeading = heading.trim() || option.defaultHeading;
  const resolvedFontFamily = normalizeDockFontFamily(fontFamily);

  if (option.source === "dock" || option.source === "remote") {
    return generateTickerHTML(
      option.theme,
      colors ?? option.theme.defaultColors,
      resolvedHeading,
      safeMessages,
      speed,
      position,
      loop,
      paused,
      brandLogoUrl,
      brandName,
      resolvedFontFamily || undefined,
      resolveDockTickerDividerChar(divider, option.theme.separatorChar),
      messageSpacing,
    );
  }

  return renderPermanentTickerThemeHtml(option.theme, {
    heading: resolvedHeading,
    messages: safeMessages,
    speed,
    position,
    loop,
    paused,
    colors,
    fontFamily: resolvedFontFamily,
    divider,
    messageSpacing,
    headingMode,
  });
}

function cssColorToHex(value: string | undefined): string | undefined {
  const m = String(value || "").match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return undefined;
  if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
  return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Works out the colours an HTML ticker really shows (bar, heading, text) by rendering it once in a hidden,
 * script-free frame and reading the computed styles. The colour picker uses this so its swatches match
 * the ticker on screen instead of generic defaults. Gradients report their first colour.
 */
export function probeHtmlTickerColors(option: DockTickerThemeOption): Promise<Partial<TickerThemeColors>> {
  if (typeof document === "undefined" || option.source === "dock" || option.source === "remote") {
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    let done = false;
    const finish = (colors: Partial<TickerThemeColors>) => {
      if (done) return;
      done = true;
      frame.remove();
      resolve(colors);
    };
    try {
      const html = renderDockTickerThemeHtml({
        option,
        heading: "Preview",
        messages: ["Preview"],
        speed: 20,
        position: "bottom",
        loop: true,
        paused: true,
        divider: "theme",
        messageSpacing: 0,
      });
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:200px;border:0;visibility:hidden;pointer-events:none;";
      frame.onload = () => {
        try {
          const doc = frame.contentDocument;
          const win = frame.contentWindow;
          if (!doc || !win) return finish({});
          const first = (selectors: string) => doc.querySelector(selectors) as HTMLElement | null;
          const bgOf = (el: HTMLElement | null) => {
            if (!el) return undefined;
            const cs = win.getComputedStyle(el);
            return cssColorToHex(cs.backgroundColor)
              ?? cssColorToHex(cs.backgroundImage.match(/rgba?\([^)]*\)/i)?.[0]);
          };
          const colorOf = (el: HTMLElement | null) => (el ? cssColorToHex(win.getComputedStyle(el).color) : undefined);
          const bar = first(".ticker-shell, .ticker-wrap, .ticker-container, .ticker-bar, .s5-banner");
          const badge = first(".ticker-badge, .ticker-label, .ticker-heading, .ticker-title, .s5-badge, .s5-label");
          const text = first(".ticker-move, .s5-move") ?? bar;
          const found: Partial<TickerThemeColors> = {};
          const set = (key: keyof TickerThemeColors, value: string | undefined) => { if (value) found[key] = value; };
          set("barBg", bgOf(bar));
          set("barText", colorOf(text));
          set("accent", bgOf(badge));
          set("accentText", colorOf(badge));
          finish(found);
        } catch {
          finish({});
        }
      };
      document.body.appendChild(frame);
      frame.srcdoc = html;
      window.setTimeout(() => finish({}), 2500);
    } catch {
      finish({});
    }
  });
}

function renderPermanentTickerThemeHtml(
  theme: PermanentTickerTheme,
  options: Omit<RenderDockTickerThemeOptions, "option">,
): string {
  const messageSequence = options.messages.length > 0 ? options.messages : [theme.tickerText || " "];
  const joinedMessages = formatDockTickerMessages(
    messageSequence,
    options.divider,
    options.messageSpacing,
  );
  const values = resolvePermanentTickerValues(theme, {
    heading: options.heading,
    messages: messageSequence,
    joinedMessages,
    speed: options.speed,
    headingMode: options.headingMode,
  });

  const html = theme.html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
    const resolved = values[key] ?? "";
    return escapeHtml(resolved);
  });

  const fontImports = theme.fontImports
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => `<link rel="stylesheet" href="${url}">`)
    .join("\n");

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
${buildPermanentTickerColorOverrides(options.colors)}
${buildPermanentTickerFontOverride(options.fontFamily)}
${buildPermanentTickerSpacingOverrides(options.messageSpacing, options.divider, options.colors?.separator)}
${buildPermanentTickerOverrides(options.position, options.loop, Boolean(options.paused))}
</style>
</head>
<body>
${html}
${hasTickerClock(html) ? TICKER_CLOCK_SCRIPT : ""}
${hasTickerMove(html) ? buildTickerSpeedScript(tickerPixelsPerSecond(options.speed)) : ""}
</body>
</html>`;
}

function buildPermanentTickerFontOverride(fontFamily: string | undefined): string {
  const safeFontFamily = normalizeDockFontFamily(fontFamily);
  if (!safeFontFamily) return "";

  return [
    "body, body *:not(.material-icons):not(.material-icons-outlined):not(.material-icons-round):not(.material-icons-sharp):not(.material-symbols-outlined):not(.fa):not([class^=\"fa-\"]):not([class*=\" fa-\"]) {",
    `  font-family: ${safeFontFamily} !important;`,
    "}",
  ].join("\n");
}

function buildPermanentTickerSpacingOverrides(
  extraSpacing: number | undefined,
  divider: DockTickerDivider | undefined,
  separatorColor: string | undefined,
): string {
  const spacing = Math.max(0, Math.min(100, Math.round(Number(extraSpacing) || 0)));
  const rules = [
    `.s5-move { gap: calc(22px + ${spacing}px) !important; }`,
    // Pill / HTML tickers: space between the two copies of the text, plus space between messages.
    `.ticker-move { gap: calc(60px + ${spacing}px) !important; }`,
  ];

  if (divider && divider !== "theme" && divider !== "none") {
    const dividerChar = resolveDockTickerDividerChar(divider);
    rules.push([
      ".s5-move > span:not(:last-child)::after, .ticker-move > span::after {",
      `  content: ${JSON.stringify(dividerChar)};`,
      `  color: ${safeCssColor(separatorColor) ?? "currentColor"};`,
      "  display: inline-block;",
      "  margin-left: 8px;",
      "  font-weight: 900;",
      "}",
    ].join("\n"));
  }

  return rules.join("\n");
}

function resolvePermanentTickerValues(
  theme: PermanentTickerTheme,
  context: {
    heading: string;
    messages: string[];
    joinedMessages: string;
    speed: number;
    headingMode?: "text" | "time";
  },
): Record<string, string> {
  const defaults: Record<string, string> = {};
  const contentSlots: string[] = [];

  for (const variable of theme.variables) {
    const key = String(variable.key || "");
    defaults[key] = String(variable.defaultValue || "");
    if (shouldUseMessageSlot(key, variable.type)) {
      contentSlots.push(key);
    }
  }

  // {{badge}} and {{tickerText}} are always filled, even when the theme doesn't list them
  // as variables (uploaded mce-ticker@1 packages usually ship "variables": []).
  const values: Record<string, string> = {
    badge: context.heading || theme.badge || "",
    tickerText: context.joinedMessages || theme.tickerText || "",
    ...defaults,
    state: "in",
    speed: speedToDuration(context.speed),
    clock: formatTickerClock(),
    headingMode: context.headingMode === "time" ? "time" : "text",
  };
  if (!values.badge) values.badge = context.heading || theme.badge || "";
  if (!values.tickerText) values.tickerText = context.joinedMessages || theme.tickerText || "";

  for (const key of Object.keys(defaults)) {
    const normalized = key.toLowerCase();

    if (isHeadingKey(normalized)) {
      values[key] = context.heading || defaults[key];
      continue;
    }

    if (isTickerBodyKey(normalized)) {
      values[key] = context.joinedMessages || defaults[key];
    }
  }

  contentSlots.forEach((key, index) => {
    const fallback = defaults[key];
    const message = context.messages[index] ?? context.messages[index % context.messages.length] ?? context.joinedMessages;
    values[key] = message || fallback;
  });

  return values;
}

function buildPermanentTickerColorOverrides(colors: TickerThemeColors | undefined): string {
  if (!colors) return "";
  const accent = safeCssColor(colors.accent);
  const accentText = safeCssColor(colors.accentText);
  const barBg = safeCssColor(colors.barBg);
  const barText = safeCssColor(colors.barText);
  const separator = safeCssColor(colors.separator);
  const rules: string[] = [];

  if (barBg) {
    rules.push([
      ".ticker-shell, .ticker-wrap, .ticker-container, .ticker-bar, .s5-banner, .s5-card, .s5-inner {",
      `  background: ${barBg} !important;`,
      "}",
    ].join("\n"));
  }

  if (barText) {
    rules.push([
      ".ticker-shell, .ticker-shell *, .ticker-wrap, .ticker-wrap *, .ticker-container, .ticker-container *, .ticker-bar, .ticker-bar *, .s5-banner, .s5-banner * {",
      `  color: ${barText} !important;`,
      "}",
    ].join("\n"));
  }

  if (accent || accentText) {
    rules.push([
      ".ticker-badge, .ticker-label, .ticker-heading, .ticker-title, .s5-badge, .s5-label {",
      accent ? `  background: ${accent} !important; border-color: ${accent} !important;` : "",
      accentText ? `  color: ${accentText} !important;` : "",
      "}",
    ].filter(Boolean).join("\n"));
  }

  if (separator) {
    rules.push([
      ".ticker-separator, .ticker-sep, .s5-separator, .s5-divider {",
      `  color: ${separator} !important; border-color: ${separator} !important;`,
      "}",
    ].join("\n"));
  }

  return rules.join("\n");
}

function safeCssColor(value: string | undefined): string | undefined {
  const trimmed = String(value || "").trim().slice(0, 80);
  if (!trimmed || /[;{}<>]/.test(trimmed)) return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function shouldUseMessageSlot(key: string, type: string): boolean {
  if (type !== "text") return false;
  const normalized = key.toLowerCase();
  return !isHeadingKey(normalized) && !isTickerBodyKey(normalized) && normalized !== "speed" && normalized !== "state";
}

function isHeadingKey(key: string): boolean {
  return key === "badge" || key === "label" || key === "heading" || key === "title";
}

function isTickerBodyKey(key: string): boolean {
  return (
    key === "tickertext" ||
    key === "text" ||
    key === "message" ||
    key === "messages" ||
    key === "headline" ||
    key === "details" ||
    key === "subtitle" ||
    key === "line2"
  );
}

function buildPermanentTickerOverrides(
  position: "top" | "bottom",
  loop: boolean,
  paused: boolean,
): string {
  const rules: string[] = [];

  if (position === "top") {
    rules.push(
      [
        ".pos-full-bottom, .s5-pos-full { top: 0 !important; bottom: auto !important; }",
        ".ticker-shell { margin: 10px auto 0 !important; }",
        ".s5-banner { margin: 8px auto 0 !important; }",
      ].join("\n"),
    );
  }

  if (!loop) {
    rules.push(
      ".ticker-move, .s5-move { animation-iteration-count: 1 !important; animation-fill-mode: forwards !important; }",
    );
  }

  if (paused) {
    rules.push(
      ".ticker-move, .s5-move { animation-play-state: paused !important; }",
    );
  }

  return rules.join("\n");
}

function speedToDuration(speed: number): string {
  const bounded = Number.isFinite(speed) ? Math.max(1, Math.min(100, speed)) : 50;
  const seconds = Math.round(40 - ((bounded - 1) / 99) * 26);
  return `${seconds}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
