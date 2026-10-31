/* eslint-disable */
/**


* themes.ts
 * Merged theme source with bible themes imported from bibleThemes.ts.
 * Auto-generated from existing merged theme registry.
 */

import { BIBLE_THEMES } from "./bibleThemes";
import { KINETIC_LOWER_THIRD_THEMES } from "./kineticThemes";
import { localizeLowerThirdThemeAssets, normalizeThemeFontImports } from "./runtimeBranding";

export type ThemeCategory = "bible" | "worship" | "general" | string;


export const GOOGLE_FONTS: string[] = [];


export const SHARED_CSS = `
/* Animations */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ticker {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
@keyframes bounceIn {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); opacity: 1; }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
@keyframes sheen {
  0% { transform: translateX(-100%) skewX(-15deg); }
  100% { transform: translateX(200%) skewX(-15deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0,0,0.2,1); }
}

.animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
.animate-ticker { animation: ticker 20s linear infinite; }
.animate-bounce-in { animation: bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
.animate-sheen { animation: sheen 3s infinite; }
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.animate-ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
.animate-spin { animation: spin 1s linear infinite; }
.animate-bounce { animation: bounce 1s infinite; }

/* Clip paths */
.torn-edge {
  clip-path: polygon(0% 0%, 5% 5%, 10% 0%, 15% 5%, 20% 0%, 25% 5%, 30% 0%, 35% 5%, 40% 0%, 45% 5%, 50% 0%, 55% 5%, 60% 0%, 65% 5%, 70% 0%, 75% 5%, 80% 0%, 85% 5%, 90% 0%, 95% 5%, 100% 0%, 100% 100%, 0% 100%);
}

/* Base */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: transparent; overflow: hidden; }
`;
export type ThemeLike = {
  id: string;
  name: string;
  description?: string;
  category?: ThemeCategory;
  icon?: string;
  accentColor?: string;
  tags?: string[];
  usesTailwind?: boolean;
  fontImports?: string[];
  variables?: Array<Record<string, unknown>>;
  animation?: Record<string, unknown>;
  css?: string;
  html?: string;
  [key: string]: unknown;
};

export type ThemePackKey = "all-merged";

export type ThemePack = {
  key: ThemePackKey;
  label: string;
  themes: ThemeLike[];
};

export type ThemeWithPack = ThemeLike & {
  pack: ThemePackKey;
  packLabel: string;
};
// []

/** Shared CSS for the "quote card" (.ylt/.y-quote) family — the sunrise-orange original plus the
 *  Quotes-category variants below. Identical layout/animation machinery; only the inline CSS
 *  variables on each theme's root div (--bg1/--bg2/--accent/...) differ. */
const QUOTE_CARD_CSS = "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.lt-em {\n  font-weight: 900;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n";

export const MERGED_ALL_THEMES: ThemeLike[] = [{
  "id": "lt-232-youth-quote-pulse-sunrise-orange",
  "name": "Quote Pulse — Sunrise Orange",
  "description": "Statement quote card for sermon clips and social-friendly moments.",
  "category": "general",
  "graphicCategory": "quotes",
  "icon": "format_quote",
  "accentColor": "#fb923c",
  "tags": [
    "quote",
    "sermon",
    "moment",
    "youth",
    "animated",
    "in-out",
    "modern-youth",
    "sunrise-orange"
  ],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Sermon Quote",
      "placeholder": "e.g. Key Quote",
      "group": "Header"
    },
    {
      "key": "quote",
      "label": "Quote",
      "type": "text",
      "defaultValue": "Grace does not lower truth; it gives us power to walk in it.",
      "placeholder": "Enter quote text",
      "required": true,
      "group": "Content"
    },
    {
      "key": "reference",
      "label": "Reference",
      "type": "text",
      "defaultValue": "Sunday Message",
      "placeholder": "Speaker or source",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        {
          "label": "Animate In",
          "value": "in"
        },
        {
          "label": "Animate Out",
          "value": "out"
        }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "slow",
      "options": [
        {
          "label": "Staggered",
          "value": "stagger"
        },
        {
          "label": "Together Slow",
          "value": "slow"
        },
        {
          "label": "Together",
          "value": "together"
        }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#2b150b;--bg2:#3a1d10;--fg:#fff8f2;--accent:#fb923c;--muted:rgba(255,232,214,.82);--border:rgba(251,146,60,.35);--glow:rgba(251,146,60,.23);\">\n  <div class=\"y-shell y-quote\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-quote-main y-enter-1\">\"{{quote}}\"</p>\n    <p class=\"y-quote-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": QUOTE_CARD_CSS
},
{
  "id": "lt-233-quote-card-midnight-teal",
  "name": "Quote Card — Midnight Teal",
  "description": "A speaker quote with a name and title beneath it, for sermon highlights and social clips.",
  "category": "general",
  "graphicCategory": "quotes",
  "icon": "format_quote",
  "accentColor": "#2dd4bf",
  "tags": [
    "quote",
    "sermon",
    "moment",
    "animated",
    "in-out",
    "midnight-teal"
  ],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Today's Word",
      "placeholder": "e.g. Today's Word",
      "group": "Header"
    },
    {
      "key": "quote",
      "label": "Quote",
      "type": "text",
      "defaultValue": "Faith is not the absence of fear; it is the courage to move forward anyway.",
      "placeholder": "Enter quote text — use *word* or *[#hex]word* to highlight",
      "required": true,
      "group": "Content"
    },
    {
      "key": "speaker",
      "label": "Speaker",
      "type": "text",
      "defaultValue": "Pastor John Doe",
      "placeholder": "e.g. Pastor John Doe",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        { "label": "Animate In", "value": "in" },
        { "label": "Animate Out", "value": "out" }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "slow",
      "options": [
        { "label": "Staggered", "value": "stagger" },
        { "label": "Together Slow", "value": "slow" },
        { "label": "Together", "value": "together" }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#06211f;--bg2:#0b2e2a;--fg:#f0fdfa;--accent:#2dd4bf;--muted:rgba(224,250,245,.8);--border:rgba(45,212,191,.32);--glow:rgba(45,212,191,.22);\">\n  <div class=\"y-shell y-quote\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-quote-main y-enter-1\">\"{{quote}}\"</p>\n    <p class=\"y-quote-ref y-enter-2\">{{speaker}}</p>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": QUOTE_CARD_CSS
},
{
  "id": "lt-234-quote-card-royal-plum",
  "name": "Quote Card — Royal Plum",
  "description": "A statement quote with a name and title beneath it, for sermon highlights and social clips.",
  "category": "general",
  "graphicCategory": "quotes",
  "icon": "format_quote",
  "accentColor": "#c084fc",
  "tags": [
    "quote",
    "sermon",
    "moment",
    "animated",
    "in-out",
    "royal-plum"
  ],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Key Quote",
      "placeholder": "e.g. Key Quote",
      "group": "Header"
    },
    {
      "key": "quote",
      "label": "Quote",
      "type": "text",
      "defaultValue": "Grace will always find you exactly where you are, and never leave you where it found you.",
      "placeholder": "Enter quote text — use *word* or *[#hex]word* to highlight",
      "required": true,
      "group": "Content"
    },
    {
      "key": "speaker",
      "label": "Speaker",
      "type": "text",
      "defaultValue": "Pastor Jane Smith",
      "placeholder": "e.g. Pastor Jane Smith",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        { "label": "Animate In", "value": "in" },
        { "label": "Animate Out", "value": "out" }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "slow",
      "options": [
        { "label": "Staggered", "value": "stagger" },
        { "label": "Together Slow", "value": "slow" },
        { "label": "Together", "value": "together" }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#1c0f2b;--bg2:#2a1640;--fg:#faf5ff;--accent:#c084fc;--muted:rgba(243,232,255,.8);--border:rgba(192,132,252,.32);--glow:rgba(192,132,252,.24);\">\n  <div class=\"y-shell y-quote\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-quote-main y-enter-1\">\"{{quote}}\"</p>\n    <p class=\"y-quote-ref y-enter-2\">{{speaker}}</p>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": QUOTE_CARD_CSS
},
{
  "id": "lt-135-modern-prayer-request",
  "name": "Modern Prayer Request",
  "description": "Prayer request panel with call-to-action details.",
  "category": "worship",
  "icon": "favorite",
  "accentColor": "#EF4444",
  "tags": [
    "modern",
    "prayer",
    "request",
    "cta"
  ],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Need Prayer?",
      "placeholder": "Heading label",
      "group": "Header"
    },
    {
      "key": "headline",
      "label": "Headline",
      "type": "text",
      "defaultValue": "Submit Your Request",
      "placeholder": "Main line",
      "required": true,
      "group": "Content"
    },
    {
      "key": "details",
      "label": "Details",
      "type": "text",
      "defaultValue": "Visit yourchurchname.com/prayer or text PRAY to 555-1234",
      "placeholder": "Supporting details",
      "group": "Content"
    }
  ],
  "html": "<div class=\"lt pos-br in-up\">\n  <div class=\"panel info-panel\" style=\"--bg:rgba(24,24,27,.88);--fg:#FEF2F2;--accent:#EF4444;--bd:rgba(239,68,68,.3);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"headline\">{{headline}}</p>\n    <div class=\"line-list\">\n      <span>{{details}}</span>\n    </div>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 600,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #6A34DE);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #6A34DE);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #6A34DE);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #6A34DE);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #6A34DE);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
},
{
  "id": "lt-407-core-sermon-title-ivory-gold",
  "name": "Sermon Title — Ivory Gold",
  "description": "Sermon points, series titles, and scripture reference lower thirds.",
  "category": "worship",
  "icon": "menu_book",
  "accentColor": "#d97706",
  "tags": [
    "sermon",
    "title",
    "series",
    "scripture",
    "animated",
    "in-out",
    "ivory-gold"
  ],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Sermon Title",
      "placeholder": "Label",
      "group": "Header"
    },
    {
      "key": "title",
      "label": "Title",
      "type": "text",
      "defaultValue": "The Cost of Following Jesus",
      "placeholder": "Main sermon title",
      "required": true,
      "group": "Content"
    },
    {
      "key": "subtitle",
      "label": "Subtitle",
      "type": "text",
      "defaultValue": "Series: Living the Gospel",
      "placeholder": "Subtitle / support line",
      "group": "Content"
    },
    {
      "key": "meta",
      "label": "Meta",
      "type": "text",
      "defaultValue": "Luke 9:23",
      "placeholder": "Series / scripture",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        {
          "label": "Animate In",
          "value": "in"
        },
        {
          "label": "Animate Out",
          "value": "out"
        }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "stagger",
      "options": [
        {
          "label": "Staggered",
          "value": "stagger"
        },
        {
          "label": "Together Slow",
          "value": "slow"
        },
        {
          "label": "Together",
          "value": "together"
        }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"c-lt c-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg:#ffffff;--fg:#3f2a18;--sub:#6b4f33;--accent:#d97706;--bd:rgba(217,119,6,.28);--glow:rgba(217,119,6,.16);\">\n  <div class=\"c-shell c-sermon c-row\">\n    <div class=\"c-bar c-e3\"></div>\n    <div class=\"c-sermon-copy\">\n      <span class=\"c-kicker c-e3\">{{label}}</span>\n      <p class=\"c-title c-e1\">{{title}}</p>\n      <p class=\"c-sub c-e2\">{{subtitle}}</p>\n      <p class=\"c-meta c-e3\">{{meta}}</p>\n    </div>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css",
    "/fonts/fontawesome/all.min.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n.c-lt {\n  position: fixed;\n  z-index: 60;\n  pointer-events: none;\n  --bg: #ffffff;\n  --fg: #111827;\n  --sub: #374151;\n  --accent: #6A34DE;\n  --bd: rgba(106, 52, 222, 0.28);\n  --glow: rgba(106, 52, 222, 0.16);\n}\n\n.c-pos-bl { left: 32px; bottom: 30px; }\n.c-pos-br { right: 32px; bottom: 30px; }\n.c-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.c-pos-tl { left: 32px; top: 30px; }\n.c-pos-tr { right: 32px; top: 30px; }\n\n.c-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--bd);\n  background: var(--bg);\n  color: var(--fg);\n  box-shadow:\n    0 12px 38px rgba(0,0,0,.32),\n    0 0 18px var(--glow),\n    0 0 0 1px rgba(255,255,255,.04) inset;\n}\n\n.c-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .9;\n}\n\n.c-shell,\n.c-e1,\n.c-e2,\n.c-e3 { opacity: 0; }\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.c-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .c-shell,\n.c-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .c-e1,\n.c-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .c-e2,\n.c-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .c-e3,\n.c-lt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .c-shell,\n.c-lt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .c-e1,\n.c-lt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .c-e2,\n.c-lt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .c-e3 {\n  opacity: 1;\n}\n\n.c-row { display: flex; align-items: center; }\n.c-col { display: flex; flex-direction: column; min-width: 0; }\n\n.c-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.c-title {\n  margin-top: 5px;\n  font-size: clamp(28px, 2.2vw, 54px);\n  line-height: 1.05;\n  font-weight: 800;\n  letter-spacing: .006em;\n}\n\n.c-sub {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 32px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--sub);\n}\n\n.c-meta {\n  margin-top: 8px;\n  font-size: clamp(13px, 1vw, 22px);\n  line-height: 1.2;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: .08em;\n  color: var(--sub);\n}\n\n.c-pill {\n  display: inline-flex;\n  align-items: center;\n  border-radius: 999px;\n  padding: 7px 11px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .1em;\n}\n\n.c-sermon {\n  min-width: 720px;\n  max-width: min(1420px, calc(100vw - 64px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  gap: 14px;\n}\n\n.c-bar {\n  width: 8px;\n  min-width: 8px;\n  align-self: stretch;\n  border-radius: 6px;\n  background: var(--accent);\n}\n\n.c-sermon-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.c-event {\n  min-width: 730px;\n  max-width: min(1380px, calc(100vw - 64px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  gap: 12px;\n}\n\n.c-date {\n  min-width: 88px;\n  border-radius: 11px;\n  background: var(--accent);\n  color: #fff;\n  padding: 8px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n}\n\n.c-date .m {\n  font-size: 12px;\n  text-transform: uppercase;\n  letter-spacing: .12em;\n  font-weight: 700;\n}\n\n.c-date .d {\n  font-size: 34px;\n  line-height: 1;\n  font-weight: 800;\n}\n\n.c-event-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; }\n\n.c-highlight {\n  min-width: 680px;\n  max-width: min(1260px, calc(100vw - 64px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.c-highlight .c-title {\n  font-family: \"Outfit\", sans-serif;\n  letter-spacing: .01em;\n}\n\n.c-prayer {\n  min-width: 720px;\n  max-width: min(1380px, calc(100vw - 64px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  gap: 12px;\n}\n\n.c-pray-box {\n  min-width: 110px;\n  align-self: stretch;\n  border-radius: 11px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 18px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.c-prayer-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; }\n\n.c-follow {\n  min-width: 700px;\n  max-width: min(1300px, calc(100vw - 64px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.c-follow-list {\n  min-width: 0;\n  flex: 1;\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.c-follow-item {\n  border-radius: 999px;\n  border: 1px solid var(--bd);\n  background: rgba(255,255,255,.1);\n  color: var(--fg);\n  padding: 7px 10px;\n  font-size: clamp(14px, 1.02vw, 20px);\n  font-weight: 600;\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.c-follow-item i {\n  font-size: .95em;\n  width: 1.1em;\n  text-align: center;\n  color: var(--accent);\n}\n\n@keyframes cBgIn {\n  from { opacity: 0; transform: translateY(16px) scale(.97); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes cBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(12px) scale(.97); filter: blur(2px); }\n}\n@keyframes cTextIn {\n  from { opacity: 0; transform: translateY(10px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes cTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-9px); }\n}\n@keyframes cTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(9px); }\n}\n\n.c-lt[data-state=\"in\"][data-mode=\"stagger\"] .c-shell { animation: cBgIn .48s cubic-bezier(0.16,1,0.3,1) both; }\n.c-lt[data-state=\"in\"][data-mode=\"stagger\"] .c-e1 { animation: cTextIn .32s cubic-bezier(0.16,1,0.3,1) .15s both; }\n.c-lt[data-state=\"in\"][data-mode=\"stagger\"] .c-e2 { animation: cTextIn .32s cubic-bezier(0.16,1,0.3,1) .24s both; }\n.c-lt[data-state=\"in\"][data-mode=\"stagger\"] .c-e3 { animation: cTextIn .3s cubic-bezier(0.16,1,0.3,1) .33s both; }\n\n.c-lt[data-state=\"out\"][data-mode=\"stagger\"] .c-e1 { animation: cTextOutUp .24s cubic-bezier(.4,0,1,1) both; }\n.c-lt[data-state=\"out\"][data-mode=\"stagger\"] .c-e2 { animation: cTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.c-lt[data-state=\"out\"][data-mode=\"stagger\"] .c-e3 { animation: cTextOutDown .22s cubic-bezier(.4,0,1,1) .16s both; }\n.c-lt[data-state=\"out\"][data-mode=\"stagger\"] .c-shell { animation: cBgOut .32s cubic-bezier(.4,0,1,1) .24s both; }\n\n.c-lt[data-state=\"in\"][data-mode=\"slow\"] .c-shell { animation: cBgIn .86s cubic-bezier(0.16,1,0.3,1) both; }\n.c-lt[data-state=\"in\"][data-mode=\"slow\"] .c-e1 { animation: cTextIn .62s cubic-bezier(0.16,1,0.3,1) .2s both; }\n.c-lt[data-state=\"in\"][data-mode=\"slow\"] .c-e2 { animation: cTextIn .62s cubic-bezier(0.16,1,0.3,1) .32s both; }\n.c-lt[data-state=\"in\"][data-mode=\"slow\"] .c-e3 { animation: cTextIn .62s cubic-bezier(0.16,1,0.3,1) .42s both; }\n\n.c-lt[data-state=\"out\"][data-mode=\"slow\"] .c-e1 { animation: cTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.c-lt[data-state=\"out\"][data-mode=\"slow\"] .c-e2 { animation: cTextOutDown .34s cubic-bezier(.4,0,1,1) .12s both; }\n.c-lt[data-state=\"out\"][data-mode=\"slow\"] .c-e3 { animation: cTextOutDown .32s cubic-bezier(.4,0,1,1) .22s both; }\n.c-lt[data-state=\"out\"][data-mode=\"slow\"] .c-shell { animation: cBgOut .46s cubic-bezier(.4,0,1,1) .34s both; }\n\n.c-lt[data-state=\"in\"][data-mode=\"together\"] .c-shell { animation: cBgIn .58s cubic-bezier(0.16,1,0.3,1) both; }\n.c-lt[data-state=\"in\"][data-mode=\"together\"] .c-e1,\n.c-lt[data-state=\"in\"][data-mode=\"together\"] .c-e2,\n.c-lt[data-state=\"in\"][data-mode=\"together\"] .c-e3 {\n  animation: cTextIn .46s cubic-bezier(0.16,1,0.3,1) .12s both;\n}\n.c-lt[data-state=\"out\"][data-mode=\"together\"] .c-e1,\n.c-lt[data-state=\"out\"][data-mode=\"together\"] .c-e2,\n.c-lt[data-state=\"out\"][data-mode=\"together\"] .c-e3 {\n  animation: cTextOutUp .28s cubic-bezier(.4,0,1,1) both;\n}\n.c-lt[data-state=\"out\"][data-mode=\"together\"] .c-shell { animation: cBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .c-pos-bl, .c-pos-br, .c-pos-bc, .c-pos-tl, .c-pos-tr { left: 16px; right: 16px; transform: none; }\n  .c-pos-br, .c-pos-tr { left: auto; }\n  .c-sermon, .c-event, .c-highlight, .c-prayer, .c-follow {\n    min-width: 0;\n    max-width: calc(100vw - 32px);\n  }\n  .c-event { padding: 10px 11px; }\n  .c-date { min-width: 70px; }\n  .c-date .d { font-size: 28px; }\n  .c-pray-box { min-width: 78px; font-size: 15px; }\n}\n"
},
{
  "id": "lt-306-giving-three-methods",
  "name": "Giving Three Methods",
  "description": "Three-column giving methods card for fast on-screen reading.",
  "icon": "account_balance",
  "accentColor": "#6A34DE",
  "tags": [
    "giving",
    "methods",
    "three-column",
    "bank"
  ],
  "variables": [
    {
      "key": "header",
      "label": "Header",
      "type": "text",
      "defaultValue": "Ways To Give",
      "placeholder": "Header",
      "required": true,
      "group": "Header"
    },
    {
      "key": "method1Title",
      "label": "Method 1 Title",
      "type": "text",
      "defaultValue": "Online",
      "placeholder": "Title",
      "group": "Method 1"
    },
    {
      "key": "method1Line",
      "label": "Method 1",
      "type": "text",
      "defaultValue": "yourchurchname.com/give",
      "placeholder": "Details",
      "group": "Method 1"
    },
    {
      "key": "method2Title",
      "label": "Method 2 Title",
      "type": "text",
      "defaultValue": "Text",
      "placeholder": "Title",
      "group": "Method 2"
    },
    {
      "key": "method2Line",
      "label": "Method 2",
      "type": "text",
      "defaultValue": "Text GIVE to 555-2100",
      "placeholder": "Details",
      "group": "Method 2"
    },
    {
      "key": "method3Title",
      "label": "Method 3 Title",
      "type": "text",
      "defaultValue": "Bank",
      "placeholder": "Title",
      "group": "Method 3"
    },
    {
      "key": "method3Line",
      "label": "Method 3",
      "type": "text",
      "defaultValue": "First City Bank - 1029384756",
      "placeholder": "Details",
      "group": "Method 3"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        {
          "label": "Animate In",
          "value": "in"
        },
        {
          "label": "Animate Out",
          "value": "out"
        }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "together",
      "options": [
        {
          "label": "Staggered",
          "value": "stagger"
        },
        {
          "label": "Together Slow",
          "value": "slow"
        },
        {
          "label": "Together",
          "value": "together"
        }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"g-lt g-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg:#ffffff;--fg:#0f172a;--sub:#334155;--accent:#6A34DE;--bd:rgba(106, 52, 222,.22);--glow:rgba(106, 52, 222,.14);\">\n  <div class=\"g-panel g-grid-3\">\n    <div class=\"g-cell\">\n      <p class=\"g-cell-title g-e3\">{{header}}</p>\n      <p class=\"g-cell-line g-e1\">{{method1Title}}</p>\n      <p class=\"g-sub g-e2\">{{method1Line}}</p>\n    </div>\n    <div class=\"g-cell\">\n      <p class=\"g-cell-title g-e3\">{{method2Title}}</p>\n      <p class=\"g-cell-line g-e1\">{{method2Line}}</p>\n    </div>\n    <div class=\"g-cell\">\n      <p class=\"g-cell-title g-e3\">{{method3Title}}</p>\n      <p class=\"g-cell-line g-e1\">{{method3Line}}</p>\n    </div>\n  </div>\n</div>",
  "category": "general",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n.g-lt {\n  position: fixed;\n  z-index: 60;\n  pointer-events: none;\n  --bg: #ffffff;\n  --fg: #111827;\n  --sub: #374151;\n  --accent: #1f2937;\n  --bd: rgba(17, 24, 39, 0.18);\n  --glow: rgba(17, 24, 39, 0.14);\n}\n\n.g-pos-bl { left: 34px; bottom: 30px; }\n.g-pos-br { right: 34px; bottom: 30px; }\n.g-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.g-pos-full { left: 0; right: 0; bottom: 0; }\n\n.g-panel {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--bd);\n  background: var(--bg);\n  color: var(--fg);\n  box-shadow: 0 12px 36px rgba(0,0,0,.28), 0 0 16px var(--glow);\n}\n\n.g-panel::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .88;\n}\n\n.g-row { display: flex; align-items: center; }\n.g-col { display: flex; flex-direction: column; min-width: 0; }\n\n.g-e1, .g-e2, .g-e3, .g-panel { opacity: 1; }\n\n.g-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.g-title {\n  margin-top: 6px;\n  font-size: clamp(27px, 2.15vw, 52px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .006em;\n}\n\n.g-title-condensed {\n  margin-top: 2px;\n  font-family: \"Oswald\", sans-serif;\n  font-size: clamp(42px, 3.6vw, 84px);\n  font-weight: 600;\n  line-height: 1;\n  text-transform: uppercase;\n  letter-spacing: .01em;\n}\n\n.g-sub {\n  margin-top: 7px;\n  font-size: clamp(18px, 1.44vw, 34px);\n  font-weight: 500;\n  color: var(--sub);\n  line-height: 1.16;\n}\n\n.g-meta {\n  margin-top: 8px;\n  font-size: clamp(13px, .98vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--sub);\n}\n\n.g-qr-wrap {\n  width: 118px;\n  min-width: 118px;\n  height: 118px;\n  border-radius: 10px;\n  border: 1px solid var(--bd);\n  background: #fff;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 8px;\n}\n\n.g-qr-wrap img {\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  display: block;\n}\n\n.g-bar-xl {\n  min-width: 980px;\n  max-width: min(1850px, calc(100vw - 70px));\n  border-radius: 16px;\n  padding: 16px 18px;\n  gap: 16px;\n}\n\n.g-copy { min-width: 0; flex: 1; }\n\n.g-left-line {\n  width: 8px;\n  min-width: 8px;\n  align-self: stretch;\n  border-radius: 5px;\n  background: var(--accent);\n}\n\n.g-split {\n  min-width: 980px;\n  max-width: min(1900px, calc(100vw - 70px));\n  border-radius: 0;\n  display: flex;\n}\n\n.g-split-left {\n  width: 42%;\n  min-width: 42%;\n  padding: 18px;\n  background: var(--accent);\n  color: #fff;\n}\n\n.g-split-left .g-title-condensed,\n.g-split-left .g-sub,\n.g-split-left .g-meta { color: #fff; }\n\n.g-split-right {\n  width: 58%;\n  min-width: 58%;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  padding: 18px;\n  background: #fff;\n}\n\n.g-divider {\n  width: 2px;\n  min-width: 2px;\n  align-self: stretch;\n  background: var(--bd);\n}\n\n.g-pill {\n  border-radius: 999px;\n  padding: 10px 14px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  display: inline-flex;\n  align-items: center;\n}\n\n.g-method {\n  font-size: clamp(19px, 1.45vw, 31px);\n  line-height: 1.2;\n  font-weight: 600;\n}\n\n.g-grid-3 {\n  min-width: 980px;\n  max-width: min(1900px, calc(100vw - 70px));\n  border-radius: 14px;\n  padding: 14px;\n  display: grid;\n  grid-template-columns: 1fr 1fr 1fr;\n  gap: 10px;\n}\n\n.g-cell {\n  border: 1px solid var(--bd);\n  border-radius: 11px;\n  background: #ffffff;\n  padding: 12px 12px;\n}\n\n.g-cell-title {\n  font-size: 12px;\n  letter-spacing: .11em;\n  text-transform: uppercase;\n  font-weight: 700;\n  color: var(--accent);\n}\n\n.g-cell-line {\n  margin-top: 5px;\n  font-size: clamp(18px, 1.35vw, 30px);\n  line-height: 1.2;\n  font-weight: 600;\n  color: var(--fg);\n}\n\n.g-footer {\n  width: min(1920px, calc(100vw - 12px));\n  margin: 0 auto 8px;\n  border-radius: 12px;\n  padding: 8px 10px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.g-badge {\n  min-width: 140px;\n  border-radius: 9px;\n  background: var(--accent);\n  color: #fff;\n  text-align: center;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 800;\n  letter-spacing: .1em;\n  text-transform: uppercase;\n}\n\n.g-scroll {\n  flex: 1;\n  min-width: 0;\n  font-size: clamp(17px, 1.28vw, 30px);\n  font-weight: 600;\n  color: var(--fg);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n@keyframes gBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.97); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes gBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(12px) scale(.97); filter: blur(2px); }\n}\n@keyframes gTextIn {\n  from { opacity: 0; transform: translateY(10px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes gTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-9px); }\n}\n@keyframes gTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-panel { animation: gBgIn .48s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e1 { animation: gTextIn .32s cubic-bezier(0.16,1,0.3,1) .15s both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e2 { animation: gTextIn .32s cubic-bezier(0.16,1,0.3,1) .25s both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e3 { animation: gTextIn .3s cubic-bezier(0.16,1,0.3,1) .34s both; }\n\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e1 { animation: gTextOutUp .24s cubic-bezier(.4,0,1,1) both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e2 { animation: gTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e3 { animation: gTextOutDown .22s cubic-bezier(.4,0,1,1) .16s both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-panel { animation: gBgOut .32s cubic-bezier(.4,0,1,1) .24s both; }\n\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-panel { animation: gBgIn .86s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e1 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .22s both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e2 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .34s both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e3 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .44s both; }\n\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e1 { animation: gTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e2 { animation: gTextOutDown .34s cubic-bezier(.4,0,1,1) .12s both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e3 { animation: gTextOutDown .32s cubic-bezier(.4,0,1,1) .22s both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-panel { animation: gBgOut .46s cubic-bezier(.4,0,1,1) .34s both; }\n\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-panel { animation: gBgIn .58s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e1,\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e2,\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e3 {\n  animation: gTextIn .46s cubic-bezier(0.16,1,0.3,1) .12s both;\n}\n\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e1,\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e2,\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e3 {\n  animation: gTextOutUp .28s cubic-bezier(.4,0,1,1) both;\n}\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-panel { animation: gBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .g-pos-bl, .g-pos-br, .g-pos-bc { left: 16px; right: 16px; transform: none; }\n  .g-pos-br { left: auto; }\n  .g-bar-xl, .g-split, .g-grid-3, .g-footer { min-width: 0; max-width: calc(100vw - 32px); width: calc(100vw - 32px); }\n  .g-qr-wrap { width: 84px; min-width: 84px; height: 84px; }\n  .g-split { flex-direction: column; }\n  .g-split-left, .g-split-right { width: 100%; min-width: 100%; }\n  .g-grid-3 { grid-template-columns: 1fr; }\n}\n"
},
{
  "id": "lt-301-giving-classic-white-qr",
  "name": "Giving Classic White QR",
  "description": "Large white bar with condensed heading, URL, and right-side QR.",
  "icon": "volunteer_activism",
  "accentColor": "#111827",
  "tags": [
    "giving",
    "qr",
    "classic",
    "clean",
    "white"
  ],
  "variables": [
    {
      "key": "heading",
      "label": "Heading",
      "type": "text",
      "defaultValue": "Reach The World Through Giving",
      "placeholder": "Main heading",
      "required": true,
      "group": "Content"
    },
    {
      "key": "url",
      "label": "URL",
      "type": "text",
      "defaultValue": "life.church/givetoday",
      "placeholder": "Website URL",
      "required": true,
      "group": "Content"
    },
    {
      "key": "qrUrl",
      "label": "QR URL",
      "type": "image",
      "defaultValue": "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=https://yourchurchname.com/give",
      "placeholder": "QR image URL",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        {
          "label": "Animate In",
          "value": "in"
        },
        {
          "label": "Animate Out",
          "value": "out"
        }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "stagger",
      "options": [
        {
          "label": "Staggered",
          "value": "stagger"
        },
        {
          "label": "Together Slow",
          "value": "slow"
        },
        {
          "label": "Together",
          "value": "together"
        }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"g-lt g-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg:#ffffff;--fg:#111827;--sub:#1f2937;--accent:#111827;--bd:rgba(17,24,39,.2);--glow:rgba(17,24,39,.12);\">\n  <div class=\"g-panel g-bar-xl g-row\">\n    <div class=\"g-copy\">\n      <p class=\"g-title-condensed g-e1\">{{heading}}</p>\n      <p class=\"g-sub g-e2\">{{url}}</p>\n    </div>\n    <div class=\"g-qr-wrap g-e3\">\n      <img src=\"{{qrUrl}}\" alt=\"QR code\" />\n    </div>\n  </div>\n</div>",
  "category": "general",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 650,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n.g-lt {\n  position: fixed;\n  z-index: 60;\n  pointer-events: none;\n  --bg: #ffffff;\n  --fg: #111827;\n  --sub: #374151;\n  --accent: #1f2937;\n  --bd: rgba(17, 24, 39, 0.18);\n  --glow: rgba(17, 24, 39, 0.14);\n}\n\n.g-pos-bl { left: 34px; bottom: 30px; }\n.g-pos-br { right: 34px; bottom: 30px; }\n.g-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.g-pos-full { left: 0; right: 0; bottom: 0; }\n\n.g-panel {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--bd);\n  background: var(--bg);\n  color: var(--fg);\n  box-shadow: 0 12px 36px rgba(0,0,0,.28), 0 0 16px var(--glow);\n}\n\n.g-panel::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .88;\n}\n\n.g-row { display: flex; align-items: center; }\n.g-col { display: flex; flex-direction: column; min-width: 0; }\n\n.g-e1, .g-e2, .g-e3, .g-panel { opacity: 1; }\n\n.g-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.g-title {\n  margin-top: 6px;\n  font-size: clamp(27px, 2.15vw, 52px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .006em;\n}\n\n.g-title-condensed {\n  margin-top: 2px;\n  font-family: \"Oswald\", sans-serif;\n  font-size: clamp(42px, 3.6vw, 84px);\n  font-weight: 600;\n  line-height: 1;\n  text-transform: uppercase;\n  letter-spacing: .01em;\n}\n\n.g-sub {\n  margin-top: 7px;\n  font-size: clamp(18px, 1.44vw, 34px);\n  font-weight: 500;\n  color: var(--sub);\n  line-height: 1.16;\n}\n\n.g-meta {\n  margin-top: 8px;\n  font-size: clamp(13px, .98vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--sub);\n}\n\n.g-qr-wrap {\n  width: 118px;\n  min-width: 118px;\n  height: 118px;\n  border-radius: 10px;\n  border: 1px solid var(--bd);\n  background: #fff;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 8px;\n}\n\n.g-qr-wrap img {\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  display: block;\n}\n\n.g-bar-xl {\n  min-width: 980px;\n  max-width: min(1850px, calc(100vw - 70px));\n  border-radius: 16px;\n  padding: 16px 18px;\n  gap: 16px;\n}\n\n.g-copy { min-width: 0; flex: 1; }\n\n.g-left-line {\n  width: 8px;\n  min-width: 8px;\n  align-self: stretch;\n  border-radius: 5px;\n  background: var(--accent);\n}\n\n.g-split {\n  min-width: 980px;\n  max-width: min(1900px, calc(100vw - 70px));\n  border-radius: 0;\n  display: flex;\n}\n\n.g-split-left {\n  width: 42%;\n  min-width: 42%;\n  padding: 18px;\n  background: var(--accent);\n  color: #fff;\n}\n\n.g-split-left .g-title-condensed,\n.g-split-left .g-sub,\n.g-split-left .g-meta { color: #fff; }\n\n.g-split-right {\n  width: 58%;\n  min-width: 58%;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  padding: 18px;\n  background: #fff;\n}\n\n.g-divider {\n  width: 2px;\n  min-width: 2px;\n  align-self: stretch;\n  background: var(--bd);\n}\n\n.g-pill {\n  border-radius: 999px;\n  padding: 10px 14px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  display: inline-flex;\n  align-items: center;\n}\n\n.g-method {\n  font-size: clamp(19px, 1.45vw, 31px);\n  line-height: 1.2;\n  font-weight: 600;\n}\n\n.g-grid-3 {\n  min-width: 980px;\n  max-width: min(1900px, calc(100vw - 70px));\n  border-radius: 14px;\n  padding: 14px;\n  display: grid;\n  grid-template-columns: 1fr 1fr 1fr;\n  gap: 10px;\n}\n\n.g-cell {\n  border: 1px solid var(--bd);\n  border-radius: 11px;\n  background: #ffffff;\n  padding: 12px 12px;\n}\n\n.g-cell-title {\n  font-size: 12px;\n  letter-spacing: .11em;\n  text-transform: uppercase;\n  font-weight: 700;\n  color: var(--accent);\n}\n\n.g-cell-line {\n  margin-top: 5px;\n  font-size: clamp(18px, 1.35vw, 30px);\n  line-height: 1.2;\n  font-weight: 600;\n  color: var(--fg);\n}\n\n.g-footer {\n  width: min(1920px, calc(100vw - 12px));\n  margin: 0 auto 8px;\n  border-radius: 12px;\n  padding: 8px 10px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.g-badge {\n  min-width: 140px;\n  border-radius: 9px;\n  background: var(--accent);\n  color: #fff;\n  text-align: center;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 800;\n  letter-spacing: .1em;\n  text-transform: uppercase;\n}\n\n.g-scroll {\n  flex: 1;\n  min-width: 0;\n  font-size: clamp(17px, 1.28vw, 30px);\n  font-weight: 600;\n  color: var(--fg);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n@keyframes gBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.97); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes gBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(12px) scale(.97); filter: blur(2px); }\n}\n@keyframes gTextIn {\n  from { opacity: 0; transform: translateY(10px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes gTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-9px); }\n}\n@keyframes gTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-panel { animation: gBgIn .48s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e1 { animation: gTextIn .32s cubic-bezier(0.16,1,0.3,1) .15s both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e2 { animation: gTextIn .32s cubic-bezier(0.16,1,0.3,1) .25s both; }\n.g-lt[data-state=\"in\"][data-mode=\"stagger\"] .g-e3 { animation: gTextIn .3s cubic-bezier(0.16,1,0.3,1) .34s both; }\n\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e1 { animation: gTextOutUp .24s cubic-bezier(.4,0,1,1) both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e2 { animation: gTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-e3 { animation: gTextOutDown .22s cubic-bezier(.4,0,1,1) .16s both; }\n.g-lt[data-state=\"out\"][data-mode=\"stagger\"] .g-panel { animation: gBgOut .32s cubic-bezier(.4,0,1,1) .24s both; }\n\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-panel { animation: gBgIn .86s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e1 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .22s both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e2 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .34s both; }\n.g-lt[data-state=\"in\"][data-mode=\"slow\"] .g-e3 { animation: gTextIn .62s cubic-bezier(0.16,1,0.3,1) .44s both; }\n\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e1 { animation: gTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e2 { animation: gTextOutDown .34s cubic-bezier(.4,0,1,1) .12s both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-e3 { animation: gTextOutDown .32s cubic-bezier(.4,0,1,1) .22s both; }\n.g-lt[data-state=\"out\"][data-mode=\"slow\"] .g-panel { animation: gBgOut .46s cubic-bezier(.4,0,1,1) .34s both; }\n\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-panel { animation: gBgIn .58s cubic-bezier(0.16,1,0.3,1) both; }\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e1,\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e2,\n.g-lt[data-state=\"in\"][data-mode=\"together\"] .g-e3 {\n  animation: gTextIn .46s cubic-bezier(0.16,1,0.3,1) .12s both;\n}\n\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e1,\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e2,\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-e3 {\n  animation: gTextOutUp .28s cubic-bezier(.4,0,1,1) both;\n}\n.g-lt[data-state=\"out\"][data-mode=\"together\"] .g-panel { animation: gBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .g-pos-bl, .g-pos-br, .g-pos-bc { left: 16px; right: 16px; transform: none; }\n  .g-pos-br { left: auto; }\n  .g-bar-xl, .g-split, .g-grid-3, .g-footer { min-width: 0; max-width: calc(100vw - 32px); width: calc(100vw - 32px); }\n  .g-qr-wrap { width: 84px; min-width: 84px; height: 84px; }\n  .g-split { flex-direction: column; }\n  .g-split-left, .g-split-right { width: 100%; min-width: 100%; }\n  .g-grid-3 { grid-template-columns: 1fr; }\n}\n"
},

{
  "id": "lt-faith-website-banner",
  "name": "Faith Quote Banner",
  "description": "Full-width quote banner with top label and bottom highlight.",
  "category": "general",
  "icon": "format_quote",
  "accentColor": "#4A0000",
  "tags": ["quote", "banner", "cta", "faith", "full-width"],
  "variables": [
    {
      "key": "label",
      "label": "Label",
      "type": "text",
      "defaultValue": "Today's Word",
      "placeholder": "Top label text",
      "required": true,
      "group": "Content"
    },
    {
      "key": "quote",
      "label": "Quote",
      "type": "text",
      "defaultValue": "For God so loved the world that He gave His only begotten Son.",
      "placeholder": "Enter quote text",
      "required": true,
      "group": "Content"
    },
    {
      "key": "reference",
      "label": "Reference",
      "type": "text",
      "defaultValue": "John 3:16",
      "placeholder": "Speaker or source",
      "group": "Content"
    },
    {
      "key": "state",
      "label": "Animation State",
      "type": "select",
      "defaultValue": "in",
      "options": [
        { "label": "Animate In", "value": "in" },
        { "label": "Animate Out", "value": "out" }
      ],
      "group": "Animation"
    },
    {
      "key": "animMode",
      "label": "Animation Mode",
      "type": "select",
      "defaultValue": "together",
      "options": [
        { "label": "Staggered", "value": "stagger" },
        { "label": "Together Slow", "value": "slow" },
        { "label": "Together", "value": "together" }
      ],
      "group": "Animation"
    }
  ],
  "html": "<div class=\"fw-lt fw-pos-full\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\">\n  <div class=\"fw-shell\">\n    <div class=\"fw-top fw-e1\">{{label}}</div>\n    <div class=\"fw-bottom fw-e2\">\n      <span class=\"fw-quote\">{{quote}}</span>\n      <span class=\"fw-ref\">{{reference}}</span>\n    </div>\n  </div>\n</div>",
  "usesTailwind": false,
  "fontImports": [
    "/fonts/google/google-fonts.css"
  ],
  "animation": {
    "name": "fadeInUp",
    "duration": 500,
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Inter\", sans-serif; }\n\n.fw-lt {\n  position: fixed;\n  z-index: 60;\n  pointer-events: none;\n  --fw-white: #ffffff;\n  --fw-maroon: #4A0000;\n  --fw-text-dark: #1a1a1a;\n  --fw-text-white: #ffffff;\n}\n\n.fw-pos-full {\n  left: 0;\n  right: 0;\n  bottom: 0;\n}\n\n.fw-shell {\n  width: 100%;\n  overflow: hidden;\n  opacity: 0;\n}\n\n.fw-top {\n  background: var(--fw-white);\n  color: var(--fw-text-dark);\n  padding: 8px 24px;\n  font-size: clamp(14px, 1.2vw, 24px);\n  font-weight: 600;\n  letter-spacing: 0.01em;\n  text-align: left;\n}\n\n.fw-bottom {\n  background: var(--fw-maroon);\n  color: var(--fw-text-white);\n  padding: 12px 24px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.fw-quote {\n  font-size: clamp(24px, 2.4vw, 56px);\n  font-weight: 800;\n  letter-spacing: -0.01em;\n  line-height: 1.1;\n}\n\n.fw-ref {\n  font-size: clamp(14px, 1.1vw, 26px);\n  font-weight: 500;\n  opacity: 0.85;\n}\n\n.fw-e1, .fw-e2, .fw-shell { opacity: 0; }\n\n.fw-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .fw-shell,\n.fw-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .fw-e1,\n.fw-lt:not([data-state=\"in\"]):not([data-state=\"out\"]) .fw-e2 {\n  opacity: 1;\n}\n\n.fw-lt[data-state=\"in\"] .fw-shell,\n.fw-lt[data-state=\"in\"] .fw-e1,\n.fw-lt[data-state=\"in\"] .fw-e2 {\n  animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;\n}\n\n.fw-lt[data-state=\"in\"][data-mode=\"stagger\"] .fw-e1 {\n  animation-delay: 0s;\n}\n.fw-lt[data-state=\"in\"][data-mode=\"stagger\"] .fw-e2 {\n  animation-delay: 0.12s;\n}\n\n.fw-lt[data-state=\"out\"] .fw-shell,\n.fw-lt[data-state=\"out\"] .fw-e1,\n.fw-lt[data-state=\"out\"] .fw-e2 {\n  animation: fadeOutDown 0.35s cubic-bezier(0.4, 0, 1, 1) both;\n}\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(16px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes fadeOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(12px); }\n}\n"
}


]

const LT_BRAND_PRIMARY = "#4ADE80";
const LT_BRAND_BACKGROUND = "#FFFFFF";
const LT_BRAND_SURFACE = "rgba(255, 255, 255, 0.98)";
const LT_BRAND_TEXT = "#111827";
const LT_BRAND_SUBTEXT = "rgba(17, 24, 39, 0.78)";
const LT_BRAND_BORDER = "rgba(74, 222, 128, 0.32)";
const LT_BRAND_GLOW = "rgba(74, 222, 128, 0.14)";
const LT_BRAND_LIGHT_BACKGROUND = "#FFFFFF";
const LT_BRAND_LIGHT_SURFACE = "rgba(255, 255, 255, 0.98)";
const LT_BRAND_LIGHT_TEXT = "#111827";
const LT_BRAND_LIGHT_SUBTEXT = "rgba(17, 24, 39, 0.78)";
const LT_BRAND_LIGHT_BORDER = "rgba(74, 222, 128, 0.32)";
const LT_BRAND_LIGHT_GLOW = "rgba(74, 222, 128, 0.14)";
const LT_BRAND_FONT = "\"CMG Sans\", sans-serif";
const LT_BRAND_FONT_IMPORT = "/fonts/cmg-sans-fonts.css";
const LT_LIGHT_MIRROR_CLASS = "lt-theme-light";
const LT_LIGHT_MIRROR_SUFFIX = "--light";
const LT_BRAND_BOTTOM_OFFSET = "42px";
const LT_BRAND_BOTTOM_OFFSET_COMPACT = "24px";

const LT_BRAND_OVERRIDE_CSS = `
/* Brand normalization: enforce one church-wide visual system */
:root {
  --lt-brand-primary: ${LT_BRAND_PRIMARY};
  --lt-brand-bg: ${LT_BRAND_BACKGROUND};
  --lt-brand-surface: ${LT_BRAND_SURFACE};
  --lt-brand-text: ${LT_BRAND_TEXT};
  --lt-brand-subtext: ${LT_BRAND_SUBTEXT};
  --lt-brand-border: ${LT_BRAND_BORDER};
  --lt-brand-glow: ${LT_BRAND_GLOW};
}

.${LT_LIGHT_MIRROR_CLASS} {
  --lt-brand-bg: ${LT_BRAND_LIGHT_BACKGROUND};
  --lt-brand-surface: ${LT_BRAND_LIGHT_SURFACE};
  --lt-brand-text: ${LT_BRAND_LIGHT_TEXT};
  --lt-brand-subtext: ${LT_BRAND_LIGHT_SUBTEXT};
  --lt-brand-border: ${LT_BRAND_LIGHT_BORDER};
  --lt-brand-glow: ${LT_BRAND_LIGHT_GLOW};
}

html, body {
  font-family: ${LT_BRAND_FONT} !important;
}

body :where(*):not(.material-icons):not(.material-icons-outlined):not(.material-icons-round):not(.material-icons-sharp):not(.material-icons-two-tone):not(.material-symbols-outlined):not(.material-symbols-rounded):not(.material-symbols-sharp):not(.fa):not(.fas):not(.far):not(.fal):not(.fab):not(.fad):not([class^="fa-"]):not([class*=" fa-"]) {
  font-family: ${LT_BRAND_FONT} !important;
}

.pos-bl,
.pos-bc,
.pos-br,
.pos-tl,
.pos-tr,
.pos-tc,
.pos-full-bottom,
.g-pos-bl,
.g-pos-bc,
.g-pos-br,
.g-pos-full,
.c-pos-bl,
.c-pos-bc,
.c-pos-br,
.c-pos-tl,
.c-pos-tr,
.y-pos-bl,
.y-pos-bc,
.y-pos-br,
.y-pos-tc,
.s5-pos-bl,
.s5-pos-bc,
.s5-pos-br,
.s5-pos-full,
.lt53-wrap,
.lt54-wrap {
  left: 32px;
  right: auto;
  bottom: ${LT_BRAND_BOTTOM_OFFSET};
  top: auto;
  transform: none;
  margin-left: 0;
  margin-right: 0;
}

.lt,
.g-lt,
.c-lt,
.ylt,
.s5-panel,
.lt53-wrap,
.lt54-wrap,
.panel,
.g-panel,
.c-shell,
.y-shell,
.ticker-shell,
.info-panel {
  --accent: var(--lt-brand-primary) !important;
  --bg: var(--lt-brand-surface) !important;
  --fg: var(--lt-brand-text) !important;
  --sub: var(--lt-brand-subtext) !important;
  --bd: var(--lt-brand-border) !important;
  --glow: var(--lt-brand-glow) !important;
}

.panel,
.g-panel,
.c-shell,
.y-shell,
.s5-panel,
.lt53-wrap,
.lt54-wrap,
.ticker-shell,
.info-panel,
.g-cell,
.g-split-right {
  background: var(--bg) !important;
  border-color: var(--bd) !important;
  color: var(--fg) !important;
}

.lt53-content,
.c-event-copy,
.c-prayer-copy,
.c-sermon-copy,
.y-ann-copy,
.y-event-copy,
.y-speaker-text {
  color: var(--fg) !important;
}

.v-divider,
.lt53-divider,
.g-left-line,
.tag-box,
.ticker-badge,
.g-pill,
.g-badge,
.c-pill,
.s5-label,
.s5-chip,
.y-tag,
.y-dot,
.y-vline,
.live-dot {
  background: var(--accent) !important;
}

.kicker,
.g-kicker,
.c-kicker,
.y-kicker,
.meta,
.g-meta,
.c-meta,
.y-meta,
.platform-pill,
.g-cell-title,
.lt54-platform,
.pill-label,
.y-pill-label {
  color: var(--accent) !important;
}

.headline,
.name-line,
.keyword-main,
.c-title,
.g-title,
.g-title-condensed,
.lt53-name,
.lt54-handle,
.y-line1,
.y-speaker-name,
.y-key-main,
.y-scripture-main,
.y-quote-main,
.title {
  font-family: ${LT_BRAND_FONT} !important;
  font-size: clamp(30px, 2.2vw, 52px) !important;
  line-height: 1.08 !important;
  color: var(--fg) !important;
}

.subline,
.role-line,
.keyword-sub,
.line-list,
.c-sub,
.g-sub,
.g-scroll,
.g-cell-line,
.lt53-title,
.y-line2,
.y-speaker-role,
.y-key-sub,
.y-scripture-ref,
.y-quote-ref,
.text,
.c-date,
.y-pill-context {
  font-family: ${LT_BRAND_FONT} !important;
  font-size: clamp(18px, 1.2vw, 28px) !important;
  line-height: 1.2 !important;
  color: var(--lt-brand-subtext) !important;
}

.speaker-panel,
.quote-panel,
.announce-panel,
.keyword-panel,
.date-shell,
.social-row,
.info-panel,
.g-panel,
.c-shell,
.y-shell,
.s5-triple,
.s5-rotate,
.s5-stack,
.s5-minimal,
.lt53-wrap,
.lt54-wrap {
  min-height: 106px !important;
}

.social-row,
.s5-triple,
.s5-rotate,
.s5-stack,
.s5-minimal,
.lt54-wrap {
  min-height: 122px !important;
}

.social-row,
.s5-triple,
.s5-rotate,
.s5-stack,
.s5-minimal,
.lt54-wrap {
  max-width: min(1820px, calc(100vw - 68px)) !important;
}

.handle,
.lt54-handle,
.s5-item .handle,
.s5-minimal .text {
  font-size: clamp(20px, 1.35vw, 30px) !important;
  line-height: 1.16 !important;
}

.handle,
.lt54-handle,
.s5-item .handle,
.s5-minimal .text,
.s5-stack .row {
  font-family: ${LT_BRAND_FONT} !important;
}

.lt54-rotator {
  min-height: 82px !important;
}

.s5-minimal {
  min-width: 980px !important;
  max-width: min(1860px, calc(100vw - 68px)) !important;
  padding: 16px 20px !important;
  gap: 10px !important;
  row-gap: 8px !important;
  flex-wrap: wrap !important;
}

.s5-minimal .title {
  white-space: nowrap !important;
}

.s5-minimal .text {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-width: 0 !important;
  max-width: 100% !important;
  white-space: normal !important;
  overflow-wrap: anywhere !important;
}

.s5-minimal .text i {
  flex-shrink: 0 !important;
}

.logo-box,
.lt53-logo,
.y-logo {
  width: 170px !important;
  min-width: 170px !important;
  height: 96px !important;
}

.logo-box.logo-round {
  width: 96px !important;
  min-width: 96px !important;
  height: 96px !important;
}

.logo-box img,
.lt53-logo img,
.y-logo img {
  width: 100% !important;
  max-height: 96px !important;
  object-fit: contain !important;
}

.g-qr-wrap,
.g-qr-wrap[style] {
  width: 156px !important;
  min-width: 156px !important;
  height: 156px !important;
  border-radius: 14px !important;
}

.g-qr-wrap img {
  width: 100% !important;
  height: 100% !important;
}

@media (max-width: 1180px) {
  .pos-bl,
  .pos-bc,
  .pos-br,
  .pos-tl,
  .pos-tr,
  .pos-tc,
  .pos-full-bottom,
  .g-pos-bl,
  .g-pos-bc,
  .g-pos-br,
  .g-pos-full,
  .c-pos-bl,
  .c-pos-bc,
  .c-pos-br,
  .c-pos-tl,
  .c-pos-tr,
  .y-pos-bl,
  .y-pos-bc,
  .y-pos-br,
  .y-pos-tc,
  .s5-pos-bl,
  .s5-pos-bc,
  .s5-pos-br,
  .s5-pos-full,
  .lt53-wrap,
  .lt54-wrap {
    left: 16px;
    right: auto;
    bottom: ${LT_BRAND_BOTTOM_OFFSET_COMPACT};
    top: auto;
    transform: none;
    margin-left: 0;
    margin-right: 0;
  }

  .logo-box,
  .lt53-logo,
  .y-logo {
    width: 124px !important;
    min-width: 124px !important;
    height: 72px !important;
  }

  .logo-box.logo-round {
    width: 72px !important;
    min-width: 72px !important;
    height: 72px !important;
  }

  .g-qr-wrap,
  .g-qr-wrap[style] {
    width: 112px !important;
    min-width: 112px !important;
    height: 112px !important;
  }

  .s5-minimal {
    min-width: 0 !important;
    max-width: calc(100vw - 28px) !important;
    padding: 12px 14px !important;
  }

  .s5-minimal .text {
    font-size: clamp(16px, 3.5vw, 22px) !important;
  }
}
`;

function getThemeTags(theme: ThemeLike): string[] {
  return Array.isArray(theme.tags)
    ? theme.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function withRootClass(html: string, className: string): string {
  if (!html || html.includes(className)) return html;

  return html.replace(/<([a-zA-Z][\w:-]*)([^>]*)>/, (_match, tagName, attrs) => {
    if (/class\s*=/.test(attrs)) {
      const updatedAttrs = attrs.replace(/class=(["'])(.*?)\1/, (_classMatch: string, quote: string, classValue: string) => {
        const classes = String(classValue).split(/\s+/).filter(Boolean);
        if (!classes.includes(className)) classes.push(className);
        return `class=${quote}${classes.join(" ")}${quote}`;
      });
      return `<${tagName}${updatedAttrs}>`;
    }
    return `<${tagName}${attrs} class="${className}">`;
  });
}

function toLightMirrorName(name: string): string {
  return /\bdark\b/i.test(name) ? name.replace(/\bdark\b/i, "Light") : `${name} (Light)`;
}

function toLightMirrorDescription(description: string): string {
  if (!description) return "Light (white) mirror variant.";
  return /\bdark\b/i.test(description)
    ? description.replace(/\bdark\b/i, "Light")
    : `${description} Light (white) mirror variant.`;
}

function createLightMirrorTheme(theme: ThemeLike): ThemeLike {
  const tags = getThemeTags(theme)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      return normalized !== "dark" && normalized !== "mirror-light";
    })
    .concat(["light", "white", "mirror-light"]);
  const uniqueTags = Array.from(new Set(tags));
  const themeName = typeof theme.name === "string" ? theme.name : String(theme.id || "Theme");
  const themeDescription = typeof theme.description === "string" ? theme.description : "";
  const themeHtml = typeof theme.html === "string" ? theme.html : "";

  return {
    ...theme,
    id: `${String(theme.id)}${LT_LIGHT_MIRROR_SUFFIX}`,
    name: toLightMirrorName(themeName),
    description: toLightMirrorDescription(themeDescription),
    tags: uniqueTags,
    html: withRootClass(themeHtml, LT_LIGHT_MIRROR_CLASS),
  };
}

function withLightMirrorThemes(themes: ThemeLike[]): ThemeLike[] {
  const next: ThemeLike[] = [...themes];
  const seenIds = new Set(next.map((theme) => String(theme.id)));

  for (const theme of themes) {
    const id = String(theme.id);
    if (id.endsWith(LT_LIGHT_MIRROR_SUFFIX)) continue;
    const mirrorId = `${String(theme.id)}${LT_LIGHT_MIRROR_SUFFIX}`;
    if (seenIds.has(mirrorId)) continue;
    const mirrorTheme = createLightMirrorTheme(theme);
    next.push(mirrorTheme);
    seenIds.add(mirrorId);
  }

  return next;
}

const THEME_COLOR_LABELS: Record<string, string> = {
  "electric indigo": "Indigo",
  "vibe magenta": "Magenta",
  "teal wave": "Teal",
  "sunrise orange": "Orange",
  "royal violet": "Violet",
  "electric blue": "Blue",
  "royal purple": "Purple",
  "emerald wave": "Emerald",
  "sunset orange": "Sunset",
  "crimson edge": "Crimson",
  "midnight cyan": "Cyan",
  "ivory gold": "Ivory",
  "slate teal": "Slate",
  "berry pop": "Berry",
  "graphite lime": "Lime",
};

function normalizeThemeDisplayName(rawName: string): string {
  let name = rawName.trim();
  if (!name) return "Theme";

  let isLight = false;
  let isImage = false;

  if (/\(light\)\s*$/i.test(name)) {
    isLight = true;
    name = name.replace(/\s*\(light\)\s*$/i, "").trim();
  }
  if (/\[image set\]\s*$/i.test(name)) {
    isImage = true;
    name = name.replace(/\s*\[image set\]\s*$/i, "").trim();
  }

  const colorMatch = name.match(/^(.*)\s+—\s+(.+)$/);
  if (colorMatch) {
    const base = colorMatch[1].trim();
    const color = colorMatch[2].trim();
    const shortColor = THEME_COLOR_LABELS[color.toLowerCase()] ?? color;
    name = `${base} (${shortColor})`;
  }

  if (isImage) name = `${name} (Image)`;
  if (isLight) name = `${name} (Light)`;

  return name;
}

function withFriendlyThemeNames(themes: ThemeLike[]): ThemeLike[] {
  return themes.map((theme) => {
    const fallbackName = typeof theme.name === "string" ? theme.name : String(theme.id || "Theme");
    return {
      ...theme,
      name: normalizeThemeDisplayName(fallbackName),
    };
  });
}

function withSingleGivingBoostTheme(themes: ThemeLike[]): ThemeLike[] {
  let keptId: string | null = null;

  return themes.filter((theme) => {
    const id = String(theme.id || "");
    const rawName = typeof theme.name === "string" ? theme.name : "";
    const baseName = rawName
      .replace(/\s*\(light\)\s*$/i, "")
      .replace(/\s*\[image set\]\s*$/i, "")
      .trim();
    const isGivingBoost = id.includes("giving-boost") || /^giving boost\b/i.test(baseName);
    if (!isGivingBoost) return true;

    if (keptId === null) {
      if (id.endsWith(LT_LIGHT_MIRROR_SUFFIX)) return false;
      keptId = id;
      return true;
    }

    return false;
  });
}

type ParsedThemeNameVariant = {
  baseName: string;
  colorToken: string | null;
  isImageSet: boolean;
  isLight: boolean;
};

function parseThemeNameVariant(rawName: string): ParsedThemeNameVariant {
  let name = rawName.trim();
  let isLight = false;
  let isImageSet = false;

  if (/\(light\)\s*$/i.test(name)) {
    isLight = true;
    name = name.replace(/\s*\(light\)\s*$/i, "").trim();
  }

  if (/\[image set\]\s*$/i.test(name)) {
    isImageSet = true;
    name = name.replace(/\s*\[image set\]\s*$/i, "").trim();
  }

  const colorMatch = name.match(/^(.*)\s+[—-]\s+(.+)$/);
  if (!colorMatch) {
    return { baseName: name, colorToken: null, isImageSet, isLight };
  }

  const baseName = colorMatch[1].trim();
  const colorToken = colorMatch[2].trim().toLowerCase();
  if (!(colorToken in THEME_COLOR_LABELS)) {
    return { baseName: name, colorToken: null, isImageSet, isLight };
  }

  return { baseName, colorToken, isImageSet, isLight };
}

function withSingleColorVariantThemes(themes: ThemeLike[]): ThemeLike[] {
  const keptByKey = new Map<string, string>();

  return themes.filter((theme) => {
    const rawName = typeof theme.name === "string" ? theme.name : String(theme.id || "");
    const parsed = parseThemeNameVariant(rawName);
    if (!parsed.colorToken) return true;

    const category = typeof theme.category === "string" && theme.category.trim() ? theme.category : "general";
    const key = [
      category.toLowerCase(),
      parsed.baseName.toLowerCase(),
      parsed.isImageSet ? "image" : "no-image",
      parsed.isLight ? "light" : "default",
    ].join("|");

    if (!keptByKey.has(key)) {
      keptByKey.set(key, String(theme.id || ""));
      return true;
    }

    return false;
  });
}

function normalizeThemeFamilyName(rawName: string): string {
  let name = rawName
    .replace(/\s*\(light\)\s*$/i, "")
    .replace(/\s*\[image set\]\s*$/i, "")
    .trim()
    .toLowerCase();

  const colorMatch = name.match(/^(.*)\s+[—-]\s+(.+)$/);
  if (colorMatch && colorMatch[2].trim().toLowerCase() in THEME_COLOR_LABELS) {
    name = colorMatch[1].trim();
  }

  return name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildCanonicalThemeVariantKey(theme: ThemeLike): string {
  const rawName = typeof theme.name === "string" ? theme.name : String(theme.id || "");
  const category = typeof theme.category === "string" && theme.category.trim() ? theme.category : "general";
  return `${category.toLowerCase()}|${normalizeThemeFamilyName(rawName)}`;
}

function scoreCanonicalThemeVariant(theme: ThemeLike, parsed: ParsedThemeNameVariant): number {
  const id = String(theme.id || "");
  let score = 0;
  if (!parsed.isLight && !id.endsWith(LT_LIGHT_MIRROR_SUFFIX)) score += 4;
  if (!parsed.isImageSet) score += 2;
  if (!id.startsWith("lt-img-")) score += 1;
  return score;
}

function buildCanonicalThemeIdMap(themes: ThemeLike[]): Map<string, string> {
  const bestByVariantKey = new Map<string, { themeId: string; score: number }>();

  for (const theme of themes) {
    const rawName = typeof theme.name === "string" ? theme.name : String(theme.id || "");
    const variantKey = buildCanonicalThemeVariantKey(theme);
    const parsed = parseThemeNameVariant(rawName);
    const score = scoreCanonicalThemeVariant(theme, parsed);
    const id = String(theme.id || "");
    const current = bestByVariantKey.get(variantKey);
    if (!current || score > current.score) {
      bestByVariantKey.set(variantKey, { themeId: id, score });
    }
  }

  return new Map(Array.from(bestByVariantKey.entries()).map(([variantKey, best]) => [variantKey, best.themeId]));
}

function buildCanonicalThemeIdAliases(
  themes: ThemeLike[],
  canonicalByVariantKey: Map<string, string>,
): Map<string, string> {
  const familyCounts = new Map<string, number>();

  for (const theme of themes) {
    const variantKey = buildCanonicalThemeVariantKey(theme);
    familyCounts.set(variantKey, (familyCounts.get(variantKey) || 0) + 1);
  }

  const aliases = new Map<string, string>();

  for (const theme of themes) {
    const id = String(theme.id || "");
    const variantKey = buildCanonicalThemeVariantKey(theme);
    const keepId = canonicalByVariantKey.get(variantKey);
    if (!keepId || keepId === id || (familyCounts.get(variantKey) || 0) < 2) continue;
    aliases.set(id, keepId);
  }

  return aliases;
}

function withCanonicalThemeVariants(
  themes: ThemeLike[],
  canonicalByVariantKey: Map<string, string>,
): ThemeLike[] {
  return themes.filter((theme) => {
    const keepId = canonicalByVariantKey.get(buildCanonicalThemeVariantKey(theme));
    return keepId ? keepId === String(theme.id || "") : true;
  });
}

function normalizeThemeBranding(theme: ThemeLike): ThemeLike {
  const localizedTheme = localizeLowerThirdThemeAssets(theme);
  const fontImports = normalizeThemeFontImports(localizedTheme.fontImports);

  if (!fontImports.includes(LT_BRAND_FONT_IMPORT)) {
    fontImports.unshift(LT_BRAND_FONT_IMPORT);
  }

  const themeCss = typeof localizedTheme.css === "string" ? localizedTheme.css : "";
  const css = themeCss.includes("Brand normalization: enforce one church-wide visual system")
    ? themeCss
    : `${themeCss}\n${LT_BRAND_OVERRIDE_CSS}`;

  return {
    ...localizedTheme,
    accentColor: LT_BRAND_PRIMARY,
    fontImports,
    css,
  };
}

const SHARED_WORSHIP_BIBLE_THEME_TAG = "shared-worship-bible";

const WORSHIP_BIBLE_TRANSPARENT_THEMES: ThemeLike[] = [
  {
    id: "lt-transparent-scripture-white",
    name: "Worship/Bible Transparent Text (White)",
    description: "Transparent lower-third with plain white text for Worship and Bible overlays.",
    category: "worship",
    icon: "text_fields",
    accentColor: "#FFFFFF",
    tags: [
      "transparent",
      "plain-text",
      "worship",
      "bible",
      SHARED_WORSHIP_BIBLE_THEME_TAG,
    ],
    usesTailwind: false,
    fontImports: [LT_BRAND_FONT_IMPORT],
    variables: [
      {
        key: "state",
        label: "State",
        type: "select",
        defaultValue: "in",
        options: [
          { label: "In", value: "in" },
          { label: "Out", value: "out" },
        ],
        group: "Animation",
      },
      {
        key: "animMode",
        label: "Animation",
        type: "select",
        defaultValue: "stagger",
        options: [
          { label: "Stagger", value: "stagger" },
          { label: "Together", value: "together" },
        ],
        group: "Animation",
      },
      {
        key: "verseText",
        label: "Main Text",
        type: "text",
        defaultValue: "For God so loved the world that He gave His only begotten Son.",
        placeholder: "Enter primary line",
        required: true,
        group: "Content",
      },
      {
        key: "reference",
        label: "Reference",
        type: "text",
        defaultValue: "John 3:16",
        placeholder: "Enter secondary line",
        required: true,
        group: "Content",
      },
    ],
    animation: {
      name: "ltTransparentInUp",
      duration: 420,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
    html: `<div class="lt-transparent-text lt-transparent-white" data-state="{{state}}" data-mode="{{animMode}}">
  <p class="lt-transparent-main">{{verseText}}</p>
  <p class="lt-transparent-sub">{{reference}}</p>
</div>`,
    css: `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: "Charis SIL", "Noto Sans", "CMG Sans", sans-serif; }

.lt-transparent-text {
  position: fixed;
  left: 32px;
  right: auto;
  bottom: 42px;
  max-width: min(1840px, calc(100vw - 64px));
  color: #ffffff;
  text-shadow: 0 3px 22px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

.lt-transparent-main {
  font-size: clamp(38px, 2.55vw, 74px);
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: 0.004em;
  white-space: pre-wrap;
}

.lt-transparent-sub {
  margin-top: 9px;
  font-size: clamp(24px, 1.55vw, 42px);
  line-height: 1.16;
  font-weight: 650;
  opacity: 0.95;
  white-space: pre-wrap;
}

@keyframes ltTransparentInUp {
  from { opacity: 0; transform: translateY(16px); filter: blur(1px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes ltTransparentInFade {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ltTransparentOutUp {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-12px); }
}
@keyframes ltTransparentOutDown {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(10px); }
}

.lt-transparent-main,
.lt-transparent-sub {
  opacity: 0;
}

.lt-transparent-text[data-state="in"][data-mode="stagger"] .lt-transparent-main {
  animation: ltTransparentInUp .42s cubic-bezier(0.16,1,0.3,1) both;
}
.lt-transparent-text[data-state="in"][data-mode="stagger"] .lt-transparent-sub {
  animation: ltTransparentInFade .36s cubic-bezier(0.16,1,0.3,1) .12s both;
}

.lt-transparent-text[data-state="out"][data-mode="stagger"] .lt-transparent-main {
  animation: ltTransparentOutUp .25s cubic-bezier(.4,0,1,1) both;
}
.lt-transparent-text[data-state="out"][data-mode="stagger"] .lt-transparent-sub {
  animation: ltTransparentOutDown .24s cubic-bezier(.4,0,1,1) .07s both;
}

.lt-transparent-text[data-state="in"][data-mode="together"] .lt-transparent-main,
.lt-transparent-text[data-state="in"][data-mode="together"] .lt-transparent-sub {
  animation: ltTransparentInUp .45s cubic-bezier(0.16,1,0.3,1) both;
}

.lt-transparent-text[data-state="out"][data-mode="together"] .lt-transparent-main,
.lt-transparent-text[data-state="out"][data-mode="together"] .lt-transparent-sub {
  animation: ltTransparentOutUp .26s cubic-bezier(.4,0,1,1) both;
}

.lt-transparent-text:not([data-state="in"]):not([data-state="out"]) .lt-transparent-main,
.lt-transparent-text:not([data-state="in"]):not([data-state="out"]) .lt-transparent-sub,
.lt-transparent-text:not([data-mode="stagger"]):not([data-mode="together"]) .lt-transparent-main,
.lt-transparent-text:not([data-mode="stagger"]):not([data-mode="together"]) .lt-transparent-sub {
  opacity: 1;
}

@media (max-width: 1180px) {
  .lt-transparent-text {
    left: 16px;
    right: 16px;
    bottom: 24px;
    max-width: calc(100vw - 32px);
  }
}
`,
  },
  {
    id: "lt-transparent-scripture-colored",
    name: "Worship/Bible Transparent Text (Accent)",
    description: "Transparent lower-third with accent headline + white subtext for Worship and Bible overlays.",
    category: "worship",
    icon: "palette",
    accentColor: LT_BRAND_PRIMARY,
    tags: [
      "transparent",
      "plain-text",
      "worship",
      "bible",
      SHARED_WORSHIP_BIBLE_THEME_TAG,
    ],
    usesTailwind: false,
    fontImports: [LT_BRAND_FONT_IMPORT],
    variables: [
      {
        key: "state",
        label: "State",
        type: "select",
        defaultValue: "in",
        options: [
          { label: "In", value: "in" },
          { label: "Out", value: "out" },
        ],
        group: "Animation",
      },
      {
        key: "animMode",
        label: "Animation",
        type: "select",
        defaultValue: "stagger",
        options: [
          { label: "Stagger", value: "stagger" },
          { label: "Together", value: "together" },
        ],
        group: "Animation",
      },
      {
        key: "accent",
        label: "Accent Color",
        type: "color",
        defaultValue: LT_BRAND_PRIMARY,
        group: "Style",
      },
      {
        key: "verseText",
        label: "Main Text",
        type: "text",
        defaultValue: "Now faith is the substance of things hoped for, the evidence of things not seen.",
        placeholder: "Enter primary line",
        required: true,
        group: "Content",
      },
      {
        key: "reference",
        label: "Reference",
        type: "text",
        defaultValue: "Hebrews 11:1",
        placeholder: "Enter secondary line",
        required: true,
        group: "Content",
      },
    ],
    animation: {
      name: "ltTransparentInUp",
      duration: 420,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
    html: `<div class="lt-transparent-text lt-transparent-colored" data-state="{{state}}" data-mode="{{animMode}}" style="--lt-transparent-accent:{{accent}};">
  <p class="lt-transparent-main">{{verseText}}</p>
  <p class="lt-transparent-sub">{{reference}}</p>
</div>`,
    css: `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: "Charis SIL", "Noto Sans", "CMG Sans", sans-serif; }

.lt-transparent-text {
  position: fixed;
  left: 32px;
  right: auto;
  bottom: 42px;
  max-width: min(1840px, calc(100vw - 64px));
  color: #ffffff;
  text-shadow: 0 3px 22px rgba(0, 0, 0, 0.58);
  pointer-events: none;
}

.lt-transparent-main {
  font-size: clamp(38px, 2.55vw, 74px);
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: 0.004em;
  white-space: pre-wrap;
}

.lt-transparent-colored .lt-transparent-main {
  color: var(--lt-transparent-accent, ${LT_BRAND_PRIMARY});
}

.lt-transparent-sub {
  margin-top: 9px;
  font-size: clamp(24px, 1.55vw, 42px);
  line-height: 1.16;
  font-weight: 650;
  opacity: 0.96;
  color: #ffffff;
  white-space: pre-wrap;
}

@keyframes ltTransparentInUp {
  from { opacity: 0; transform: translateY(16px); filter: blur(1px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes ltTransparentInFade {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ltTransparentOutUp {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-12px); }
}
@keyframes ltTransparentOutDown {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(10px); }
}

.lt-transparent-main,
.lt-transparent-sub {
  opacity: 0;
}

.lt-transparent-text[data-state="in"][data-mode="stagger"] .lt-transparent-main {
  animation: ltTransparentInUp .42s cubic-bezier(0.16,1,0.3,1) both;
}
.lt-transparent-text[data-state="in"][data-mode="stagger"] .lt-transparent-sub {
  animation: ltTransparentInFade .36s cubic-bezier(0.16,1,0.3,1) .12s both;
}

.lt-transparent-text[data-state="out"][data-mode="stagger"] .lt-transparent-main {
  animation: ltTransparentOutUp .25s cubic-bezier(.4,0,1,1) both;
}
.lt-transparent-text[data-state="out"][data-mode="stagger"] .lt-transparent-sub {
  animation: ltTransparentOutDown .24s cubic-bezier(.4,0,1,1) .07s both;
}

.lt-transparent-text[data-state="in"][data-mode="together"] .lt-transparent-main,
.lt-transparent-text[data-state="in"][data-mode="together"] .lt-transparent-sub {
  animation: ltTransparentInUp .45s cubic-bezier(0.16,1,0.3,1) both;
}

.lt-transparent-text[data-state="out"][data-mode="together"] .lt-transparent-main,
.lt-transparent-text[data-state="out"][data-mode="together"] .lt-transparent-sub {
  animation: ltTransparentOutUp .26s cubic-bezier(.4,0,1,1) both;
}

.lt-transparent-text:not([data-state="in"]):not([data-state="out"]) .lt-transparent-main,
.lt-transparent-text:not([data-state="in"]):not([data-state="out"]) .lt-transparent-sub,
.lt-transparent-text:not([data-mode="stagger"]):not([data-mode="together"]) .lt-transparent-main,
.lt-transparent-text:not([data-mode="stagger"]):not([data-mode="together"]) .lt-transparent-sub {
  opacity: 1;
}

@media (max-width: 1180px) {
  .lt-transparent-text {
    left: 16px;
    right: 16px;
    bottom: 24px;
    max-width: calc(100vw - 32px);
  }
}
`,
  },
];

const THEMES_WITH_LIGHT_MIRRORS: ThemeLike[] = withLightMirrorThemes([...MERGED_ALL_THEMES, ...BIBLE_THEMES]);
const THEMES_WITH_ONE_GIVING_BOOST: ThemeLike[] = withSingleGivingBoostTheme(THEMES_WITH_LIGHT_MIRRORS);
const THEMES_WITH_SINGLE_COLOR_VARIANTS: ThemeLike[] = withSingleColorVariantThemes(THEMES_WITH_ONE_GIVING_BOOST);
const CANONICAL_THEME_ID_BY_VARIANT: Map<string, string> = buildCanonicalThemeIdMap(THEMES_WITH_SINGLE_COLOR_VARIANTS);
const CANONICAL_THEME_ID_ALIASES = buildCanonicalThemeIdAliases(
  THEMES_WITH_SINGLE_COLOR_VARIANTS,
  CANONICAL_THEME_ID_BY_VARIANT,
);
const THEMES_WITH_SINGLE_DISPLAY_VARIANTS: ThemeLike[] = withCanonicalThemeVariants(
  THEMES_WITH_SINGLE_COLOR_VARIANTS,
  CANONICAL_THEME_ID_BY_VARIANT,
);
const THEMES_WITH_FRIENDLY_NAMES: ThemeLike[] = withFriendlyThemeNames(THEMES_WITH_SINGLE_DISPLAY_VARIANTS);
const THEMES_WITH_TRANSPARENT_TEXT: ThemeLike[] = [
  ...THEMES_WITH_FRIENDLY_NAMES,
  ...WORSHIP_BIBLE_TRANSPARENT_THEMES,
];
const BRAND_ALIGNED_THEMES: ThemeLike[] = [
  ...THEMES_WITH_TRANSPARENT_TEXT.map((theme) => normalizeThemeBranding(theme)),
  // Kinetic straps keep their own type and colour, so they skip brand normalisation.
  ...(KINETIC_LOWER_THIRD_THEMES as unknown as ThemeLike[]),
];

export const CHURCH_IMAGE_50_THEMES: ThemeLike[] = BRAND_ALIGNED_THEMES.filter((t) =>
  String(t.id || "").startsWith("lt-img-"),
);

export const CHURCH_IMAGE_50_BY_TEMPLATE = {
  sermonTitle: CHURCH_IMAGE_50_THEMES.filter((t) => String(t.id).includes("-sermon-title-")),
  prayerRequest: CHURCH_IMAGE_50_THEMES.filter((t) => String(t.id).includes("-prayer-request-")),
  givingMoment: CHURCH_IMAGE_50_THEMES.filter((t) => String(t.id).includes("-giving-moment-")),
  followUs: CHURCH_IMAGE_50_THEMES.filter((t) => String(t.id).includes("-follow-us-")),
  eventHighlight: CHURCH_IMAGE_50_THEMES.filter((t) => String(t.id).includes("-event-highlight-")),
};

export const THEME_PACKS: ThemePack[] = [
  {
    key: "all-merged",
    label: "All In One Theme",
    themes: BRAND_ALIGNED_THEMES,
  },
];

export const ALL_IN_ONE_THEME: ThemePack = THEME_PACKS[0];
export const ALL_THEMES: ThemeLike[] = BRAND_ALIGNED_THEMES;
export const THEMES: ThemeLike[] = ALL_THEMES;

export const ALL_THEMES_WITH_PACK: ThemeWithPack[] = ALL_THEMES.map((theme) => ({
  ...theme,
  pack: "all-merged",
  packLabel: "All In One Theme",
}));

export const ALL_THEME_IDS: string[] = ALL_THEMES.map((theme) => String(theme.id));
export const DUPLICATE_THEME_IDS: string[] = ALL_THEME_IDS.filter((id, idx, arr) => arr.indexOf(id) !== idx);
export const ALL_THEME_COUNT = ALL_THEMES.length;
const ALL_THEME_ID_SET = new Set(ALL_THEME_IDS);

export const ALL_THEMES_BY_CATEGORY = {
  bible: ALL_THEMES.filter((theme) => theme.category === "bible"),
  worship: ALL_THEMES.filter((theme) => theme.category === "worship"),
  general: ALL_THEMES.filter((theme) => theme.category === "general"),
  speaker: ALL_THEMES.filter((theme) => theme.category === "speaker"),
};

export function getThemeById(id: string): ThemeLike | undefined {
  const canonicalId = canonicalizeLowerThirdThemeId(id);
  return ALL_THEMES.find((theme) => theme.id === canonicalId);
}

export function getThemeWithPackById(id: string): ThemeWithPack | undefined {
  const canonicalId = canonicalizeLowerThirdThemeId(id);
  return ALL_THEMES_WITH_PACK.find((theme) => theme.id === canonicalId);
}

/**
 * Alias → canonical id pairs. Used by scripts/export-lower-third-theme-ids.cjs to write
 * themeIdIndex.generated.ts, which lets start-up code canonicalise ids without loading
 * this whole catalog.
 */
export function getLowerThirdThemeIdAliasEntries(): Array<[string, string]> {
  return [...CANONICAL_THEME_ID_ALIASES.entries()]
    .filter(([, canonical]) => ALL_THEME_ID_SET.has(canonical))
    .sort(([a], [b]) => a.localeCompare(b));
}

export function canonicalizeLowerThirdThemeId(themeId: string): string {
  if (!themeId) return themeId;
  if (ALL_THEME_ID_SET.has(themeId)) return themeId;
  const mapped = CANONICAL_THEME_ID_ALIASES.get(themeId);
  if (mapped && ALL_THEME_ID_SET.has(mapped)) return mapped;
  return themeId;
}

export function getThemesByPack(packKey: ThemePackKey): ThemeLike[] {
  return packKey === "all-merged" ? ALL_THEMES : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Compatibility Layer — re-export old names used across the codebase
// ═══════════════════════════════════════════════════════════════════════════
//
// The rest of the codebase uses the `LowerThirdTheme` type (from types.ts)
// and the old export names (LT_THEMES, LT_BIBLE_THEMES, etc.).
// We cast `ThemeLike[]` to `LowerThirdTheme[]` since the runtime data
// contains all required fields (id, name, description, html, css,
// variables, tags, etc.) — the only diff is TypeScript strictness.
// ═══════════════════════════════════════════════════════════════════════════

import type { LowerThirdTheme } from "./types";

/** Main theme array (excludes speaker-only / ticker-only) — now ALL themes */
export const LT_THEMES = ALL_THEMES as unknown as LowerThirdTheme[];

/** All themes including previously-excluded ones */
export const LT_ALL_THEMES = ALL_THEMES as unknown as LowerThirdTheme[];

/** Bible-category themes */
export const LT_BIBLE_THEMES = ALL_THEMES_BY_CATEGORY.bible as unknown as LowerThirdTheme[];

/** Worship-category themes */
export const LT_WORSHIP_THEMES = ALL_THEMES_BY_CATEGORY.worship as unknown as LowerThirdTheme[];

/** General-category themes */
export const LT_GENERAL_THEMES = ALL_THEMES_BY_CATEGORY.general as unknown as LowerThirdTheme[];

/** Speaker-category themes */
export const LT_SPEAKER_THEMES = ALL_THEMES_BY_CATEGORY.speaker as unknown as LowerThirdTheme[];

/** IDs that were previously excluded from the main list — now empty */
export const LT_EXCLUDED_IDS = new Set<string>();

/** Look up a theme by ID (returns typed LowerThirdTheme) */
export function getLTThemeById(id: string): LowerThirdTheme | undefined {
  return getThemeById(id) as unknown as LowerThirdTheme | undefined;
}

/** Shared CSS block (used by overlay renderers) */
export const LT_SHARED_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: "Charis SIL", "Noto Sans", "CMG Sans", sans-serif; }

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ticker {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
@keyframes bounceIn {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); opacity: 1; }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
@keyframes sheen {
  0% { transform: translateX(-100%) skewX(-15deg); }
  100% { transform: translateX(200%) skewX(-15deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0,0,0.2,1); }
}
`;
