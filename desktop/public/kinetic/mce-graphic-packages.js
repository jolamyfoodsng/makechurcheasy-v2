/*
 * Make Church Eazy — runtime for admin-published broadcast graphics ("graphic packages").
 * Loads after kinetic-lower-thirds.js and teaches the Motion engine to render any graphic whose
 * .kx-root carries an embedded package (data-kx-pkg). Packages are data only: an HTML template,
 * CSS, fields and a declarative GSAP animation. See the format notes below.
 *
 * Brand icons: Simple Icons (CC0 1.0). Fonts: Google Fonts (SIL Open Font License 1.1), bundled.
 */
(function (global) {
  "use strict";
  var api = global.MCEKinetic;
  if (!api) return;
  var gsap = global.gsap;
  var FONT_FACES = [["Archivo Black", 400, "normal", "/fonts/sunday/archivo-black-400.woff2"], ["Arimo", 400, "normal", "/fonts/sunday/arimo-400.woff2"], ["Arimo", 700, "normal", "/fonts/sunday/arimo-700.woff2"], ["Montserrat", 900, "normal", "/fonts/sunday/montserrat-900.woff2"], ["Montserrat", 700, "italic", "/fonts/sunday/montserrat-700-italic.woff2"], ["Montserrat", 800, "italic", "/fonts/sunday/montserrat-800-italic.woff2"], ["Open Sans", 400, "normal", "/fonts/sunday/open-sans-400.woff2"], ["Open Sans", 600, "normal", "/fonts/sunday/open-sans-600.woff2"], ["Open Sans", 800, "normal", "/fonts/sunday/open-sans-800.woff2"], ["Roboto", 400, "normal", "/fonts/sunday/roboto-400.woff2"], ["Roboto", 500, "normal", "/fonts/sunday/roboto-500.woff2"], ["Roboto", 700, "normal", "/fonts/sunday/roboto-700.woff2"], ["Tinos", 700, "normal", "/fonts/sunday/tinos-700.woff2"], ["Anton", 400, "normal", "/fonts/church/anton-400.woff2"], ["Saira", 800, "normal", "/fonts/church/saira-800.woff2"], ["Saira Semi Condensed", 700, "normal", "/fonts/church/saira-semi-condensed-700.woff2"], ["Grenze Gotisch", 700, "normal", "/fonts/church/grenze-gotisch-700.woff2"], ["Kaushan Script", 400, "normal", "/fonts/church/kaushan-script-400.woff2"]];
  var BRAND = {"facebook": {"t": "Facebook", "h": "#0866FF", "p": "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"}, "instagram": {"t": "Instagram", "h": "#FF0069", "p": "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"}, "youtube": {"t": "YouTube", "h": "#FF0000", "p": "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"}, "x": {"t": "X", "h": "#000000", "p": "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"}, "tiktok": {"t": "TikTok", "h": "#000000", "p": "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"}, "whatsapp": {"t": "WhatsApp", "h": "#25D366", "p": "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"}, "telegram": {"t": "Telegram", "h": "#26A5E4", "p": "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"}, "threads": {"t": "Threads", "h": "#000000", "p": "M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"}, "twitch": {"t": "Twitch", "h": "#9146FF", "p": "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"}};

  /* ======================================================================
   * MCE Graphic Packages — admin-published broadcast graphics.
   *
   * A package is pure data (JSON): fields, an HTML template, CSS and a declarative
   * animation. It never contains code, so a published graphic cannot run scripts in
   * the app or in OBS. The desktop app embeds the package (base64) in the theme's
   * `.kx-root` as `data-kx-pkg`, so OBS and previews render it fully offline.
   *
   * Format (format: "mce-graphic@1"):
   * {
   *   "format": "mce-graphic@1", "id": "welcome-bar", "version": 1,
   *   "name": "Welcome Bar", "category": "welcome", "description": "...",
   *   "color": "#2563eb", "hold": 8,
   *   "placement": { "x": 120, "y": 90, "scale": 1 },      // px from left / bottom of 1920x1080
   *   "fields": [
   *     { "key": "title", "label": "Title", "type": "text", "default": "WELCOME" },
   *     { "key": "bar", "label": "Bar colour", "type": "color", "default": "#2563eb", "shades": true },
   *     { "key": "icon1", "label": "Icon", "type": "select", "options": "icons", "default": "globe" },
   *     { "key": "socials", "label": "Social icons", "type": "list", "options": "brands", "default": "facebook,youtube" },
   *     { "key": "logo", "label": "Logo", "type": "image", "default": "" }
   *   ],
   *   "html": "<div class=\"bar\"><b>{{title}}</b> {{brands:socials}} {{image:logo|title}}</div>",
   *   "css": ".bar{background:var(--bar);font:800 48px/1 Montserrat,sans-serif}",
   *   "animation": {
   *     "in":  [[".bar","wipeL",0,{"d":0.8}], [".bar b","maskUp",0.3]],
   *     "out": [],                                        // optional; default = "in" reversed
   *     "ambient": [{ "sel": ".shine", "from": {"xPercent":-120}, "to": {"xPercent":560}, "d": 1.4, "repeat": -1, "repeatDelay": 3 }]
   *   }
   * }
   *
   * Template tags: {{key}} text · {{key|br}} text with "|" as a line break ·
   * {{key|rich}} like |br, and *words* in asterisks become <span class="hl"> (important words);
   * *[#hex]words* picks the highlight's own colour instead (same markup as the Scripture overlays) ·
   * {{key|words}} / {{key|chars}} text split into <span class="w"> words / <span class="ch"> letters ·
   * {{icon:key}} / {{icon=mail}} glyph icon · {{brands:key}} / {{brand=youtube}} brand icons ·
   * {{image:key|fallbackKey}} picture or fallback text · {{#key}}…{{/key}} only when key has a value.
   * Colours become CSS variables: --key (and --key-l / --key-d when "shades": true).
   * Animation steps: [selector, effect, at, {d, e, s}] with the effects below, or
   * { "sel", "from", "to", "set", "at", "d", "e", "s", "sa", "fromEnd" } for any GSAP properties
   * ("s" = stagger per element, "sa" = most seconds the whole stagger may take, "fromEnd" = last first).
   * A displayed element with class "pkg-fullscreen" makes the graphic fill the whole 1920x1080 frame.
   * Centred titles: "placement": { "mode": "centre", "fit": 0.76 } (or an element with
   * data-pkg-layout="full" / "lower" and data-pkg-fit="0.76", so a field can switch it) puts the
   * graphic in the middle of the screen, scaled up until it is "fit" of the screen wide (it never
   * runs off the top or bottom). The Dock's position and size settings don't move it.
   * ==================================================================== */
  var DESIGN_W = 1920, DESIGN_H = 1080, EDGE_TOP = 40;
  var MAX_FIELDS = 80, MAX_STEPS = 120;

  function $(s, r) { try { return r.querySelector(s); } catch (e) { return null; } }
  function $$(s, r) { try { return Array.prototype.slice.call(r.querySelectorAll(s)); } catch (e) { return []; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hex(v, fallback) { v = String(v || "").trim(); return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : fallback; }
  function shade(h, amt) {
    h = String(h).replace("#", ""); if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16); if (!isFinite(n)) return "#000000";
    var r = n >> 16, g = n >> 8 & 255, b = n & 255, t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function picUrl(v) {
    v = String(v == null ? "" : v).trim();
    if (!v || /^\{\{/.test(v)) return "";
    return /^(data:image\/|blob:|https?:|asset:|file:|\/)/i.test(v) ? v : "";
  }

  /* ---------- icons ---------- */
  function S(d, fill) { return '<svg viewBox="0 0 24 24" fill="' + (fill ? "currentColor" : "none") + '" stroke="' + (fill ? "none" : "currentColor") + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; }
  var ICON = {
    globe: S('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19M12 2.5c-3 3.2-3 15.8 0 19M4.5 6.5h15M4.5 17.5h15"/>'),
    bank: S('<path d="M12 2 2 7v2h20V7z"/><rect x="4" y="10" width="2.6" height="8"/><rect x="8.5" y="10" width="2.6" height="8"/><rect x="12.9" y="10" width="2.6" height="8"/><rect x="17.4" y="10" width="2.6" height="8"/><rect x="2" y="19" width="20" height="3"/>', 1),
    phonepay: S('<rect x="9" y="1.5" width="11" height="17" rx="2"/><path fill="#000" d="M11 4h7v11h-7z" opacity=".25"/><path d="M2 14c2-1.6 4-2 6-1.2l3 1.2c.8.3.9 1.4.1 1.8L8 17l6-1 4 2-6 4.5c-1.5.9-3.4 1-5 .2L2 20z"/>', 1),
    people: S('<circle cx="8" cy="7" r="3.2"/><circle cx="16.5" cy="7.5" r="2.7"/><path d="M1.5 20c0-4 2.9-7 6.5-7s6.5 3 6.5 7z"/><path d="M15 13.3c.5-.2 1-.3 1.5-.3 3.1 0 5.5 2.6 5.5 6.5h-6.2c0-2.4-.3-4.4-.8-6.2z"/>', 1),
    phone: S('<path d="M6.6 2.5 9.3 2.2l1.5 4.9-2.2 1.5a11.5 11.5 0 0 0 6.8 6.8l1.5-2.2 4.9 1.5-.3 2.7c-.2 1.6-1.6 2.8-3.2 2.6C9.8 19.2 4.8 14.2 4 7.7c-.2-1.6 1-3 2.6-3.2z"/>', 1),
    mail: S('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>'),
    card: S('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>'),
    heart: S('<path d="M12 21s-8.5-5.3-8.5-11.5A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.5 3.1C20.5 15.7 12 21 12 21z"/>', 1),
    pin: S('<path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.5" fill="#000" opacity=".35"/>', 1),
    qr: S('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/>'),
    play: S('<rect x="2" y="5" width="20" height="14" rx="4"/><path fill="#000" opacity=".35" d="m10 9 5 3-5 3z"/>', 1),
    camera: S('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor"/>'),
    chat: S('<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>', 1),
    share: S('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" stroke="currentColor" stroke-width="2"/>', 1),
    calendar: S('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
    clock: S('<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2.5"/>'),
    bell: S('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    like: S('<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>'),
    cross: S('<path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6z"/>', 1),
    book: S('<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>'),
    mic: S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>')
  };
  var ICON_OPTIONS = [["globe", "Globe / website"], ["bank", "Bank"], ["phonepay", "Mobile giving"], ["people", "People / in person"], ["phone", "Phone"], ["mail", "Email"], ["card", "Card"], ["heart", "Heart"], ["pin", "Location"], ["qr", "Scan code"], ["play", "Video"], ["camera", "Camera"], ["chat", "Chat"], ["share", "Share"], ["calendar", "Calendar"], ["clock", "Clock"], ["bell", "Bell"], ["like", "Like"], ["cross", "Cross"], ["book", "Book"], ["mic", "Microphone"]]
    .map(function (o) { return { value: o[0], label: o[1] }; });
  var BRAND_OPTIONS = Object.keys(BRAND).map(function (k) { return { value: k, label: BRAND[k].t }; });
  function ic(n) { return '<i class="ic">' + (ICON[n] || ICON.globe) + "</i>"; }
  function bic(slug) {
    var b = BRAND[slug]; if (!b) return "";
    return '<i class="ic bi" style="--bc:' + b.h + '" title="' + b.t + '"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + b.p + '"/></svg></i>';
  }
  function brands(v) { return String(v || "").split(/[\s,]+/).map(function (k) { return k.toLowerCase(); }).filter(function (k) { return BRAND[k]; }); }

  /* ---------- per-text soft styling (see src/lowerthirds/textStyle.ts) ---------- */
  var TS_WEIGHTS = { light: "300", normal: "400", semibold: "600", bold: "700", black: "900" };
  var TS_SPACING = { tight: "-0.02em", wide: "0.06em", wider: "0.16em" };
  function tsCss(raw) {
    raw = String(raw == null ? "" : raw);
    if (!raw || /^\{\{/.test(raw)) return "";
    var css = [];
    raw.split(";").forEach(function (part) {
      var kv = part.split("="), k = (kv[0] || "").trim(), val = (kv[1] || "").trim();
      if (k === "case" && val && val !== "none") css.push("text-transform:none!important");
      else if (k === "size" && isFinite(+val) && +val !== 100) css.push("font-size:" + Math.min(180, Math.max(60, Math.round(+val))) + "%!important");
      else if (k === "weight" && TS_WEIGHTS[val]) css.push("font-weight:" + TS_WEIGHTS[val] + "!important");
      else if (k === "italic" && (val === "1" || val === "true")) css.push("font-style:italic!important");
      else if (k === "spacing" && TS_SPACING[val]) css.push("letter-spacing:" + TS_SPACING[val] + "!important");
    });
    return css.join(";");
  }
  function styled(v, key, html) {
    var css = tsCss(v[key + "__ts"]);
    return css ? '<span class="lt-ts" style="' + esc(css) + '">' + html + "</span>" : html;
  }

  /* ---------- {{key|rich}}: text where *words* between asterisks become <span class="hl"> (the
   * graphic's own "important words" style), or *[#hex]words* for a highlight in that colour —
   * same syntax and rules as the Scripture overlays' safeEmText (mce-multiview-scripture-*.html).
   * Enter or "|" is a line break. Runs on text that is already HTML-escaped, so a quote can never
   * inject markup; only a bare #hex (3-8 hex digits) is accepted as a colour. ---------- */
  function richText(raw) {
    return String(raw == null ? "" : raw).split(/\r?\n|\|/).map(function (line) {
      return esc(line).replace(/\*(?=\S)(?:\[(#[0-9a-fA-F]{3,8})\])?([^*\n]*?\S)\*/g, function (_m, color, words) {
        return color
          ? '<span class="hl" style="color:' + color + '">' + words + "</span>"
          : '<span class="hl">' + words + "</span>";
      });
    }).join("<br>");
  }

  /* ---------- letter / word splitting for {{key|chars}} and {{key|words}} ----------
   * Each word becomes <span class="w"> (kept on one line) and, with |chars, each
   * letter inside it a <span class="ch">, so animations can target .w or .ch.
   * New lines (Enter or "|") become <br>. */
  function splitText(raw, chars) {
    return String(raw == null ? "" : raw).split(/\r?\n|\|/).map(function (line) {
      return line.split(/\s+/).filter(Boolean).map(function (word) {
        var inner = chars ? Array.from(word).map(function (c) { return '<span class="ch">' + esc(c) + "</span>"; }).join("") : esc(word);
        return '<span class="w">' + inner + "</span>";
      }).join(" ");
    }).join("<br>");
  }

  /* ---------- template ---------- */
  function render(tpl, v) {
    // {{#key}}…{{/key}} blocks first (no nesting of the same key)
    tpl = String(tpl || "").replace(/\{\{#([\w-]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (_, k, inner) {
      return String(v[k] == null ? "" : v[k]).trim() ? inner : "";
    });
    return tpl.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (_, expr) {
      var m;
      if ((m = /^icon=([\w-]+)$/.exec(expr))) return ic(m[1]);
      if ((m = /^icon:([\w-]+)$/.exec(expr))) return ic(v[m[1]]);
      if ((m = /^brand=([\w-]+)$/.exec(expr))) return bic(m[1]);
      if ((m = /^brands:([\w-]+)$/.exec(expr))) return brands(v[m[1]]).map(bic).join("");
      if ((m = /^image:([\w-]+)(?:\|([\w-]+))?$/.exec(expr))) {
        var u = picUrl(v[m[1]]);
        if (u) return '<img class="pkg-img" alt="" src="' + esc(u) + '">';
        return m[2] ? '<span class="pkg-fallback">' + String(v[m[2]] || "").split("|").map(esc).join("<br>") + "</span>" : "";
      }
      if ((m = /^([\w-]+)\|(chars|words)$/.exec(expr))) return styled(v, m[1], splitText(v[m[1]], m[2] === "chars"));
      if ((m = /^([\w-]+)\|rich$/.exec(expr))) return styled(v, m[1], richText(v[m[1]]));
      if ((m = /^([\w-]+)\|br$/.exec(expr))) return styled(v, m[1], String(v[m[1]] == null ? "" : v[m[1]]).split(/\r?\n|\|/).map(esc).join("<br>"));
      if ((m = /^([\w-]+)$/.exec(expr))) return styled(v, m[1], esc(v[m[1]]));
      return "";
    });
  }

  /* ---------- CSS scoping: every selector is prefixed with the graphic's own class ---------- */
  var SC = ":is(#overlay-root,body) .kx-root ";
  function scopeCss(css, scope) {
    css = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
    var out = "", i = 0, n = css.length;
    function selList(sel) {
      return sel.split(",").map(function (s) {
        s = s.trim(); if (!s) return "";
        if (/^(from|to|\d+(\.\d+)?%)$/.test(s)) return s; // keyframe steps
        return SC + scope + " " + s.replace(/^:root\b|^:scope\b/, "");
      }).filter(Boolean).join(",");
    }
    function bodyImportant(body) {
      // The OBS overlay forces its own font family; graphics keep theirs.
      return body.replace(/(^|;)\s*(font(?:-family)?\s*:[^;!]+?)\s*(?=;|$)/g, "$1$2 !important");
    }
    while (i < n) {
      var open = css.indexOf("{", i); if (open < 0) break;
      var head = css.slice(i, open).trim();
      if (/^@(media|supports)/i.test(head)) {
        var depth = 1, j = open + 1;
        while (j < n && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
        out += head + "{" + scopeCss(css.slice(open + 1, j - 1), scope) + "}";
        i = j; continue;
      }
      if (/^@keyframes|^@-webkit-keyframes/i.test(head)) {
        var d2 = 1, k = open + 1;
        while (k < n && d2) { if (css[k] === "{") d2++; else if (css[k] === "}") d2--; k++; }
        out += head + "{" + css.slice(open + 1, k - 1) + "}"; // keyframe names are global
        i = k; continue;
      }
      if (/^@font-face/i.test(head)) {
        var close0 = css.indexOf("}", open); if (close0 < 0) break;
        out += head + "{" + css.slice(open + 1, close0) + "}";
        i = close0 + 1; continue;
      }
      var close = css.indexOf("}", open); if (close < 0) break;
      var sel = selList(head);
      if (sel) out += sel + "{" + bodyImportant(css.slice(open + 1, close)) + "}\n";
      i = close + 1;
    }
    return out;
  }

  /* ---------- animation vocabulary (same as the bundled graphics) ---------- */
  var CL = { L: "inset(0% 100% 0% 0%)", R: "inset(0% 0% 0% 100%)", U: "inset(100% 0% 0% 0%)", D: "inset(0% 0% 100% 0%)", C: "inset(0% 50% 0% 50%)", V: "inset(50% 0% 50% 0%)", full: "inset(0% 0% 0% 0%)" };
  var FX = {
    wipeL: { f: { clipPath: CL.L }, t: { clipPath: CL.full }, o: { clipPath: CL.R }, d: .7, e: "power3.inOut" },
    wipeR: { f: { clipPath: CL.R }, t: { clipPath: CL.full }, o: { clipPath: CL.L }, d: .7, e: "power3.inOut" },
    wipeU: { f: { clipPath: CL.U }, t: { clipPath: CL.full }, o: { clipPath: CL.D }, d: .6, e: "power3.inOut" },
    wipeD: { f: { clipPath: CL.D }, t: { clipPath: CL.full }, o: { clipPath: CL.U }, d: .6, e: "power3.inOut" },
    wipeC: { f: { clipPath: CL.C }, t: { clipPath: CL.full }, d: .7, e: "power3.inOut" },
    wipeV: { f: { clipPath: CL.V }, t: { clipPath: CL.full }, d: .6, e: "power3.inOut" },
    growX: { f: { scaleX: 0, transformOrigin: "0% 50%" }, t: { scaleX: 1 }, d: .6, e: "expo.out" },
    growY: { f: { scaleY: 0, transformOrigin: "50% 50%" }, t: { scaleY: 1 }, d: .5, e: "expo.out" },
    pop: { f: { scale: 0, opacity: 0, transformOrigin: "50% 50%" }, t: { scale: 1, opacity: 1 }, d: .5, e: "back.out(2.2)" },
    spin: { f: { scale: 0, rotation: -200, transformOrigin: "50% 50%" }, t: { scale: 1, rotation: 0 }, d: .85, e: "back.out(1.5)" },
    slam: { f: { scale: 2.8, opacity: 0, transformOrigin: "50% 50%" }, t: { scale: 1, opacity: 1 }, d: .45, e: "power4.in" },
    up: { f: { y: 34, opacity: 0 }, t: { y: 0, opacity: 1 }, d: .6, e: "power3.out" },
    down: { f: { y: -34, opacity: 0 }, t: { y: 0, opacity: 1 }, d: .6, e: "power3.out" },
    left: { f: { x: -70, opacity: 0 }, t: { x: 0, opacity: 1 }, d: .6, e: "power3.out" },
    right: { f: { x: 90, opacity: 0 }, t: { x: 0, opacity: 1 }, d: .65, e: "power3.out" },
    fade: { f: { opacity: 0 }, t: { opacity: 1 }, d: .5, e: "power1.out" },
    slideUp: { f: { yPercent: 105 }, t: { yPercent: 0 }, d: .6, e: "power3.out" },
    maskUp: { f: { yPercent: 100, clipPath: "inset(0% 0% 100% 0%)" }, t: { yPercent: 0, clipPath: CL.full }, o: { yPercent: -100, clipPath: "inset(100% 0% 0% 0%)" }, d: .45, e: "expo.out" },
    maskDown: { f: { yPercent: -100, clipPath: "inset(100% 0% 0% 0%)" }, t: { yPercent: 0, clipPath: CL.full }, o: { yPercent: 100, clipPath: "inset(0% 0% 100% 0%)" }, d: .45, e: "expo.out" },
    maskL: { f: { xPercent: -100, clipPath: "inset(0% 0% 0% 100%)" }, t: { xPercent: 0, clipPath: CL.full }, o: { xPercent: 100, clipPath: "inset(0% 100% 0% 0%)" }, d: .5, e: "expo.out" },
    blurL: { f: { x: -50, opacity: 0, filter: "blur(12px)" }, t: { x: 0, opacity: 1, filter: "blur(0px)" }, d: .42, e: "power3.out" },
    stretch: { f: { scaleX: 1.7, opacity: 0, filter: "blur(6px)", transformOrigin: "0% 50%" }, t: { scaleX: 1, opacity: 1, filter: "blur(0px)" }, d: .42, e: "expo.out" },
    skew: { f: { x: -90, skewX: -28, opacity: 0 }, t: { x: 0, skewX: 0, opacity: 1 }, d: .45, e: "expo.out" }
  };
  var FX_NAMES = Object.keys(FX).concat(["draw"]);
  function assign() { var o = {}; for (var a = 0; a < arguments.length; a++) { var s = arguments[a]; if (s) for (var k in s) o[k] = s[k]; } return o; }
  // Only plain GSAP vars are passed through (no callbacks, no function values).
  function cleanVars(o) {
    var out = {};
    if (!o || typeof o !== "object") return out;
    for (var k in o) {
      if (/^on|callback/i.test(k)) continue;
      var v = o[k];
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
      else if (Array.isArray(v) && k === "keyframes") out[k] = v.filter(function (x) { return x && typeof x === "object"; }).map(cleanVars);
    }
    return out;
  }
  function normStep(s) {
    if (Array.isArray(s)) return { sel: String(s[0] || ""), fx: String(s[1] || ""), at: +s[2] || 0, d: s[3] && s[3].d, e: s[3] && s[3].e, s: s[3] && s[3].s, sa: s[3] && s[3].sa };
    if (s && typeof s === "object") return { sel: String(s.sel || s.selector || ""), fx: s.fx ? String(s.fx) : "", from: s.from, to: s.to, set: s.set, at: +s.at || 0, d: s.d, e: s.e, s: s.s, sa: s.sa, from_end: !!s.fromEnd };
    return null;
  }
  function stagOf(n, st, each) { return st != null ? +st : Math.min(.45, Math.max(0, (n - 1) * each)); }
  function buildIn(steps, r, tl) {
    steps.forEach(function (s) {
      var els = $$(s.sel, r); if (!els.length) return;
      if (s.set) { tl.set(els, cleanVars(s.set), s.at); return; }
      if (s.fx === "draw") {
        els.forEach(function (p, i) { var L = p.getTotalLength ? p.getTotalLength() : 0; if (!L) return; tl.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: +s.d || 1.2, ease: "power2.out" }, s.at + i * (+s.s || 0)); });
        return;
      }
      var fx = FX[s.fx];
      var from = fx ? assign(fx.f, cleanVars(s.from)) : cleanVars(s.from);
      var to = fx ? assign(fx.t, cleanVars(s.to)) : cleanVars(s.to);
      to.duration = +s.d || (fx ? fx.d : .5); to.ease = s.e || (fx ? fx.e : "power2.out");
      to.stagger = s.sa > 0 ? Math.min(s.s != null ? +s.s : .1, +s.sa / Math.max(1, els.length - 1)) : stagOf(els.length, s.s, .1);
      if (s.from_end) to.stagger = { each: to.stagger, from: "end" };
      if (s.from || fx) tl.fromTo(els, from, to, s.at); else tl.to(els, to, s.at);
    });
  }
  function buildOutAuto(steps, r, tl) {
    var rev = steps.filter(function (s) { return !s.set; });
    if (!rev.length) return;
    var max = Math.max.apply(null, rev.map(function (s) { return s.at; }));
    rev.slice().reverse().forEach(function (s) {
      var els = $$(s.sel, r); if (!els.length) return;
      var pos = (max - s.at) * .42;
      if (s.fx === "draw") { tl.to(els, { opacity: 0, duration: .3 }, pos); return; }
      var fx = FX[s.fx];
      var back = fx ? (fx.o || fx.f) : cleanVars(s.from);
      if (!back || !Object.keys(back).length) back = { opacity: 0 };
      tl.to(els, assign(back, { duration: (+s.d || (fx ? fx.d : .5)) * .6, ease: "power2.in", stagger: { amount: Math.min(.25, (els.length - 1) * .06), from: "end" } }), pos);
    });
  }
  function startAmbient(list, r) {
    var out = [];
    (list || []).forEach(function (a) {
      if (!a || typeof a !== "object") return;
      var els = $$(String(a.sel || ""), r); if (!els.length) return;
      var to = assign(cleanVars(a.to), { duration: +a.d || 1.5, ease: a.e || "sine.inOut", repeat: a.repeat == null ? -1 : +a.repeat, yoyo: !!a.yoyo, repeatDelay: +a.repeatDelay || 0 });
      if (a.s != null) to.stagger = +a.s;
      out.push(a.from ? gsap.fromTo(els, cleanVars(a.from), to) : gsap.to(els, to));
    });
    return out;
  }

  /* ---------- styles, fonts, lifetime ---------- */
  var BASE_CSS = SC + ".pkg{position:absolute;inset:0;pointer-events:none;color:#fff;font:400 16px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:normal;text-align:left;text-transform:none;white-space:normal;font-stretch:normal;font-style:normal;justify-content:normal}\n" +
    SC + ".pkg *{font-family:inherit !important;box-sizing:border-box}\n" +
    SC + ".pkg-lt{position:absolute;white-space:nowrap;transform-origin:0 100%}\n" +
    SC + ".pkg .ic{display:inline-block;flex:none;width:1em;height:1em}" + SC + ".pkg .ic svg{width:100%;height:100%;display:block}\n" +
    SC + ".pkg .pkg-img{display:block;max-width:100%;max-height:100%;object-fit:contain}";
  function injectBase() {
    if (typeof document === "undefined" || document.getElementById("mce-pkg-base")) return;
    var faces = FONT_FACES.map(function (f) { return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ";font-style:" + f[2] + ";font-display:block;src:url(" + f[3] + ") format('woff2')}"; }).join("\n");
    var st = document.createElement("style"); st.id = "mce-pkg-base"; st.textContent = faces + "\n" + BASE_CSS;
    (document.head || document.documentElement).appendChild(st);
    if (!document.querySelector('link[href*="/fonts/google/google-fonts.css"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/fonts/google/google-fonts.css";
      (document.head || document.documentElement).appendChild(l);
    }
  }
  function injectCss(key, css) {
    var id = "mce-pkg-css-" + key;
    if (document.getElementById(id)) return;
    var st = document.createElement("style"); st.id = id; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  var live = [], sweeper = 0;
  function killAmb(ctx) { (ctx.amb || []).forEach(function (a) { a.kill(); }); ctx.amb = []; }
  function track(ctx) {
    live.push(ctx);
    if (!sweeper) sweeper = setInterval(function () {
      live = live.filter(function (c) { if (c.sec.isConnected) return true; killAmb(c); return false; });
      if (!live.length) { clearInterval(sweeper); sweeper = 0; }
    }, 1000);
  }
  function justifyFactor(kx) { var j = kx && kx.style ? kx.style.justifyContent : ""; return j === "center" ? .5 : j === "flex-end" ? 1 : 0; }

  /* ---------- package → Motion-engine template ---------- */
  function normalizeFields(list) {
    return (Array.isArray(list) ? list : []).slice(0, MAX_FIELDS).map(function (f) {
      if (!f || typeof f !== "object") return null;
      var key = String(f.key || "").replace(/[^\w-]/g, ""); if (!key) return null;
      var type = ["text", "color", "select", "list", "image"].indexOf(f.type) >= 0 ? f.type : "text";
      var options = f.options === "icons" ? ICON_OPTIONS : f.options === "brands" ? BRAND_OPTIONS
        : Array.isArray(f.options) ? f.options.map(function (o) { return o && typeof o === "object" ? { value: String(o.value), label: String(o.label || o.value) } : { value: String(o), label: String(o) }; }) : null;
      var def = f["default"] != null ? String(f["default"]) : f.defaultValue != null ? String(f.defaultValue) : "";
      return { key: key, label: String(f.label || key), type: type, def: def, options: options, shades: !!f.shades };
    }).filter(Boolean);
  }

  /* The server already rejects these; stripping them again keeps an old or hand-made package harmless. */
  function sanitizeMarkup(html) {
    return String(html || "")
      .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|frame|frameset|applet)\b[\s\S]*?(<\s*\/\s*\1\s*>|>)/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src|xlink:href|action|formaction)\s*=\s*(["']?)\s*(javascript|vbscript)\s*:/gi, "$1=$2#");
  }

  /* Centred-title layout: from placement.mode, or a [data-pkg-layout] element a field can switch. */
  function centreLayout(box, place) {
    var on = place.mode === "centre" || place.mode === "center";
    var fit = +place.fit;
    var el = box.querySelector("[data-pkg-layout]");
    if (el) {
      var v = String(el.getAttribute("data-pkg-layout") || "").toLowerCase();
      if (v === "full" || v === "centre" || v === "center") on = true;
      else if (v === "lower" || v === "corner") on = false;
      var f = parseFloat(el.getAttribute("data-pkg-fit"));
      if (f > 0) fit = f;
    }
    if (!on) return null;
    return { fit: fit > .2 && fit <= 1 ? fit : .76 };
  }

  function makeTemplate(pkg) {
    pkg = assign(pkg, { html: sanitizeMarkup(pkg.html) });
    var id = "pkg-" + String(pkg.id).replace(/[^\w-]/g, "");
    var scopeKey = id + "-v" + (parseInt(pkg.version, 10) || 1);
    var scope = ".pkg-" + scopeKey;
    var fields = normalizeFields(pkg.fields);
    var anim = pkg.animation && typeof pkg.animation === "object" ? pkg.animation : {};
    var stepsIn = (Array.isArray(anim["in"]) ? anim["in"] : []).slice(0, MAX_STEPS).map(normStep).filter(Boolean);
    var stepsOut = (Array.isArray(anim.out) ? anim.out : []).slice(0, MAX_STEPS).map(normStep).filter(Boolean);
    var place = pkg.placement && typeof pkg.placement === "object" ? pkg.placement : {};
    var X = isFinite(+place.x) ? +place.x : 120, Y = isFinite(+place.y) ? +place.y : 90, PS = +place.scale > 0 ? +place.scale : 1;
    var css = scopeCss(pkg.css, scope);
    return {
      id: id, name: String(pkg.name || pkg.id), ref: "Admin graphics", tech: String(pkg.description || ""), color: hex(pkg.color, "#2563eb"),
      family: "package", hold: pkg.hold,
      fields: fields.map(function (f) { return [f.key, f.key, f.label, f.def, f.type, f.options]; }),
      build: function (stage, P, c) {
        injectBase(); injectCss(scopeKey, css);
        var kx = stage.parentElement;
        var inOverlay = !!(kx && kx.closest && kx.closest("#overlay-root"));
        var Sc = c.scale || 1;
        if (kx) { kx.style.padding = "0"; kx.style.lineHeight = "normal"; }
        if (!inOverlay && kx && kx.parentElement) Sc = Sc * Math.min(1, (kx.parentElement.clientWidth || DESIGN_W) / DESIGN_W);
        var crop = document.createElement("div"), frame = document.createElement("div"), sec = document.createElement("section");
        sec.className = "pkg " + scope.slice(1);
        var box = document.createElement("div"); box.className = "pkg-lt";
        fields.forEach(function (f) {
          if (f.type !== "color") return;
          var v = hex(P[f.key], hex(f.def, "#000000"));
          box.style.setProperty("--" + f.key, v);
          if (f.shades) { box.style.setProperty("--" + f.key + "-l", shade(v, .28)); box.style.setProperty("--" + f.key + "-d", shade(v, -.3)); }
        });
        // Per-text styling travels as data-v-<key>-ts on the .kx-root (written by the app).
        var PV = assign(P);
        if (kx && kx.getAttribute) {
          fields.forEach(function (f) {
            if (f.type !== "text") return;
            PV[f.key + "__ts"] = kx.getAttribute("data-v-" + f.key.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }) + "-ts") || "";
          });
        }
        box.innerHTML = render(pkg.html, PV);
        sec.appendChild(box); frame.appendChild(sec); crop.appendChild(frame); stage.appendChild(crop);
        frame.style.cssText = "position:absolute;top:0;width:" + DESIGN_W + "px;height:" + DESIGN_H + "px;transform-origin:0 0";
        // A graphic whose markup has a .pkg-fullscreen element fills the whole 1920x1080 frame.
        // (only when that element is displayed, so a "layout" option can switch it on and off).
        var fullEl = box.querySelector(".pkg-fullscreen");
        var full = !!(fullEl && fullEl.getClientRects().length);
        // A centred title sits in the middle of the screen, scaled up to "fit" of its width.
        var centre = !full && centreLayout(box, place);
        var bx = full ? 0 : X, by = full ? 0 : Y, bs = full ? 1 : PS;
        if (full) box.classList.add("pkg-full");
        if (centre) box.classList.add("pkg-centred");
        // Outside OBS (library thumbnails, preview modals) the graphic is centred like the
        // other Motion graphics, with an even margin above and below it.
        if (!inOverlay && !full && !centre) by = EDGE_TOP;
        // In OBS a full-screen or centred graphic always covers the whole output (any source size):
        // the size setting is applied to the centred graphic itself, not to the frame.
        var sizeK = 1;
        if (inOverlay && (full || centre)) {
          sizeK = Math.max(.5, Math.min(1.5, Sc));
          var host = kx.closest("#overlay-root");
          var fitW = (host && host.clientWidth) || DESIGN_W, fitH = (host && host.clientHeight) || DESIGN_H;
          Sc = Math.min(fitW / DESIGN_W, fitH / DESIGN_H) || 1;
        }
        var w0 = box.offsetWidth, h0 = box.offsetHeight;
        if (centre && w0 > 0 && h0 > 0) {
          bs = Math.min(DESIGN_W * centre.fit * sizeK / w0, DESIGN_W * .94 / w0, DESIGN_H * .86 / h0, 3);
          by = Math.round((DESIGN_H - h0 * bs) / 2);
        }
        var w = w0 * bs, h = h0 * bs;
        var f0 = inOverlay ? justifyFactor(kx) : .5;
        var left = centre ? (DESIGN_W - w) / 2 : f0 === 0 ? bx : f0 === 1 ? DESIGN_W - bx - w : (DESIGN_W - w) / 2;
        box.style.cssText += ";left:" + left + "px;bottom:" + by + "px;transform:scale(" + bs + ")";
        var H = (full || centre) ? DESIGN_H : Math.min(DESIGN_H, Math.ceil(by + h + EDGE_TOP));
        crop.style.cssText = "position:relative;overflow:visible;width:" + (inOverlay ? 0 : Math.round(DESIGN_W * Sc)) + "px;height:" + Math.round(H * Sc) + "px";
        frame.style.left = (inOverlay ? -DESIGN_W * Sc * f0 : 0) + "px";
        frame.style.transform = "scale(" + Sc + ") translateY(" + (-(DESIGN_H - H)) + "px)";

        var ctx = { sec: sec, amb: [] };
        var tin = gsap.timeline(), tout = gsap.timeline();
        try { buildIn(stepsIn, box, tin); } catch (e) { /* a bad step never blocks the graphic */ }
        if (!tin.duration()) tin.fromTo(box, { opacity: 0 }, { opacity: 1, duration: .4 });
        if (Array.isArray(anim.ambient) && anim.ambient.length) {
          tin.call(function () { killAmb(ctx); try { ctx.amb = startAmbient(anim.ambient, box); } catch (e) { ctx.amb = []; } }, null, tin.duration());
        }
        tout.call(function () { killAmb(ctx); }, null, 0);
        try { if (stepsOut.length) buildIn(stepsOut, box, tout); else buildOutAuto(stepsIn, box, tout); } catch (e) { /* ignore */ }
        if (!tout.duration()) tout.to(box, { opacity: 0, duration: .35 });
        tout.set(sec, { autoAlpha: 0 }, tout.duration() + .02);
        track(ctx);
        return { tin: tin, tout: tout };
      }
    };
  }

  /* ---------- decoding the embedded package ---------- */
  var cache = {};
  function decode(b64) {
    var bin = global.atob(b64);
    if (global.TextDecoder) {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new global.TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(escape(bin));
  }
  function fromPackage(pkg) {
    if (!pkg || typeof pkg !== "object" || !pkg.id || !pkg.html) return null;
    var key = String(pkg.id) + "@" + (parseInt(pkg.version, 10) || 1) + "@" + String(pkg.updatedAt || "");
    if (!cache[key]) cache[key] = makeTemplate(pkg);
    return cache[key];
  }
  function resolvePackage(el) {
    var raw = el && el.getAttribute && el.getAttribute("data-kx-pkg");
    if (!raw || /^\{\{/.test(raw)) return null;
    try { return fromPackage(JSON.parse(decode(raw))); } catch (e) { return null; }
  }

  api.resolvePackage = resolvePackage;
  api.packages = { fromPackage: fromPackage, iconOptions: ICON_OPTIONS, brandOptions: BRAND_OPTIONS, effects: FX_NAMES, render: render, scopeCss: scopeCss };

})(typeof window !== "undefined" ? window : globalThis);
