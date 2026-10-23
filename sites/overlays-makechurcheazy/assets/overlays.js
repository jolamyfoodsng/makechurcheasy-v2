/* Make Church Eazy — Overlays
 * Template registry + renderer shared by the gallery/customizer (index.html)
 * and the page OBS loads as a browser source (overlay.html).
 * Every overlay is drawn on a 1920x1080 stage; callers scale the stage.
 */
(function (global) {
  "use strict";

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var clip = function (s, n) { return String(s == null ? "" : s).slice(0, n || 400); };
  var hex = function (v, d) {
    v = String(v || "").replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(v) ? "#" + v : "#" + d;
  };
  var safeUrl = function (u) {
    try {
      var x = new URL(String(u || ""));
      return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
    } catch (e) { return ""; }
  };
  var fit = function (len, steps) {
    for (var i = 0; i < steps.length; i++) if (len <= steps[i][0]) return steps[i][1];
    return steps[steps.length - 1][1];
  };

  function nextSunday(h) {
    var d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    d.setHours(h, 0, 0, 0);
    var z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes());
  }

  var FONTS = {
    sans: "'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif",
    serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
    round: "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif"
  };

  var ICON = {
    note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 17V5.500l11-2V15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.500" cy="17.500" r="3.200"/><circle cx="17.500" cy="15.500" r="3.200"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.6 1.1 4.6 2.7h2C14 6.1 15.600 5 17.600 5 21 5 23.100 8.400 21.600 11.800 19.500 16.400 12 21 12 21z"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.200 2h3.600v6.200H20v3.600h-6.200V22h-3.600V11.800H4V8.200h6.200z"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.200"><rect x="3.500" y="3.500" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.200" cy="6.800" r="1" fill="currentColor" stroke="none"/></svg>',
    yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.600 7.200a2.500 2.500 0 0 0-1.800-1.800C18.200 5 12 5 12 5s-6.200 0-7.800.4A2.500 2.500 0 0 0 2.400 7.200C2 8.800 2 12 2 12s0 3.200.4 4.800a2.500 2.500 0 0 0 1.800 1.800C5.800 19 12 19 12 19s6.200 0 7.800-.4a2.500 2.500 0 0 0 1.800-1.800c.4-1.600.4-4.800.4-4.800s0-3.200-.4-4.800zM10 15V9l5.200 3z"/></svg>',
    fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.500V6.800c0-.8.200-1.300 1.400-1.300H17V2.300C16.700 2.300 15.700 2.200 14.600 2.200 12.100 2.200 10.400 3.700 10.400 6.500v2H7.600v3.400h2.800V21.800H14V11.900h2.600l.4-3.400z"/></svg>'
  };

  /* ---------- fields shared by every template ---------- */
  var STYLE_FIELDS = [
    { key: "c1", label: "Main colour", type: "color", def: "0238E9", group: "Style" },
    { key: "c2", label: "Accent colour", type: "color", def: "F59E0B", group: "Style" },
    { key: "font", label: "Font", type: "select", def: "sans", group: "Style",
      options: [["sans", "Modern sans"], ["serif", "Classic serif"], ["round", "Friendly rounded"]] },
    { key: "logo", label: "Logo image link (optional)", type: "text", def: "", group: "Style",
      hint: "A public https:// link to your logo (PNG with transparent background works best).", logoOnly: true }
  ];
  var BEHAVIOUR_FIELDS = [
    { key: "hide", label: "Hide automatically after (seconds)", type: "number", def: "0", group: "Behaviour",
      hint: "0 keeps the overlay on screen until you refresh or hide the source in OBS." },
    { key: "repeat", label: "Show again every (seconds)", type: "number", def: "0", group: "Behaviour",
      hint: "0 shows it once. Use with auto-hide, e.g. hide after 8, repeat every 60." }
  ];

  var POS3 = [["l", "Left"], ["c", "Centre"], ["r", "Right"]];
  var POS6 = [["bl", "Bottom left"], ["bc", "Bottom centre"], ["br", "Bottom right"], ["tl", "Top left"], ["tc", "Top centre"], ["tr", "Top right"]];
  var POS_BAR = [["b", "Bottom of screen"], ["t", "Top of screen"]];
  var POS_CORNER = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];

  function rowClass(pos) {
    pos = String(pos || "l");
    if (pos.length === 1) pos = "b" + pos;
    var v = pos.charAt(0) === "t" ? "t" : "b";
    var h = pos.charAt(1) === "c" ? "c" : pos.charAt(1) === "r" ? "r" : "l";
    return "row " + v + " " + h;
  }

  /* ---------- templates ---------- */
  var T = [];

  T.push({
    id: "lower-third-clean", name: "Speaker Lower Third — Clean", category: "Lower thirds", logo: false,
    desc: "Name and title with a slim accent bar. The everyday pastor / guest speaker graphic.",
    fields: [
      { key: "name", label: "Name", type: "text", def: "Pastor Grace Okafor", group: "Content" },
      { key: "title", label: "Title", type: "text", def: "Senior Pastor", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "l", options: POS3, group: "Content" }
    ],
    html: function (p) {
      return '<div class="' + rowClass(p.pos) + '"><div class="lt1">' +
        '<div class="lt1-bar"></div><div class="lt1-card"><div class="lt1-name">' + esc(clip(p.name, 80)) + "</div>" +
        (p.title ? '<div class="lt1-sub">' + esc(clip(p.title, 90)) + "</div>" : "") + "</div></div></div>";
    }
  });

  T.push({
    id: "lower-third-bold", name: "Speaker Lower Third — Bold", category: "Lower thirds",
    desc: "Big colour block for the name, white strip for the title. Reads well on busy video.",
    fields: [
      { key: "name", label: "Name", type: "text", def: "Evangelist David Mensah", group: "Content" },
      { key: "title", label: "Title", type: "text", def: "Guest Minister", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "l", options: POS3, group: "Content" }
    ],
    html: function (p) {
      return '<div class="' + rowClass(p.pos) + '"><div class="lt2">' +
        '<div class="lt2-name">' + esc(clip(p.name, 80)) + "</div>" +
        (p.title ? '<div class="lt2-sub">' + esc(clip(p.title, 90)) + "</div>" : "") + "</div></div>";
    }
  });

  T.push({
    id: "song-title", name: "Song Title", category: "Lower thirds",
    desc: "Show the song or hymn that is being sung, with a small music badge.",
    fields: [
      { key: "label", label: "Small label", type: "text", def: "Now singing", group: "Content" },
      { key: "song", label: "Song title", type: "text", def: "Amazing Grace", group: "Content" },
      { key: "by", label: "Writer / hymn number (optional)", type: "text", def: "John Newton · Hymn 108", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "l", options: POS3, group: "Content" }
    ],
    html: function (p) {
      return '<div class="' + rowClass(p.pos) + '"><div class="sg"><div class="sg-icon">' + ICON.note + "</div>" +
        '<div class="sg-card">' + (p.label ? '<div class="sg-label">' + esc(clip(p.label, 40)) + "</div>" : "") +
        '<div class="sg-song">' + esc(clip(p.song, 80)) + "</div>" +
        (p.by ? '<div class="sg-by">' + esc(clip(p.by, 90)) + "</div>" : "") + "</div></div></div>";
    }
  });

  T.push({
    id: "scripture-bar", name: "Scripture Lower Third", category: "Scripture",
    desc: "Verse text along the bottom of the screen with the reference in a colour block.",
    logo: false,
    fields: [
      { key: "ref", label: "Reference", type: "text", def: "John 3:16", group: "Content" },
      { key: "version", label: "Bible version", type: "text", def: "KJV", group: "Content" },
      { key: "text", label: "Verse text", type: "textarea", group: "Content",
        def: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." }
    ],
    html: function (p) {
      var t = clip(p.text, 500), size = fit(t.length, [[110, 46], [170, 40], [260, 34], [380, 29], [9999, 25]]);
      return '<div class="sb"><div class="sb-ref"><div class="sb-refname">' + esc(clip(p.ref, 40)) + "</div>" +
        (p.version ? '<div class="sb-ver">' + esc(clip(p.version, 12)) + "</div>" : "") + "</div>" +
        '<div class="sb-text" style="font-size:' + size + 'px">' + esc(t) + "</div></div>";
    }
  });

  T.push({
    id: "scripture-card", name: "Scripture Card — Full Screen", category: "Scripture",
    desc: "Large centred verse over a soft dark wash. For the moment the whole room reads together.",
    fields: [
      { key: "ref", label: "Reference", type: "text", def: "Psalm 23:1", group: "Content" },
      { key: "version", label: "Bible version", type: "text", def: "KJV", group: "Content" },
      { key: "text", label: "Verse text", type: "textarea", def: "The Lord is my shepherd; I shall not want.", group: "Content" }
    ],
    html: function (p) {
      var t = clip(p.text, 600), size = fit(t.length, [[90, 92], [170, 72], [280, 58], [420, 48], [9999, 40]]);
      return '<div class="sc"><div class="sc-wash"></div><div class="sc-body"><div class="sc-cross">' + ICON.cross + "</div>" +
        '<div class="sc-text" style="font-size:' + size + 'px">' + esc(t) + "</div>" +
        '<div class="sc-ref">' + esc(clip(p.ref, 40)) + (p.version ? ' <span>' + esc(clip(p.version, 12)) + "</span>" : "") + "</div></div></div>";
    }
  });

  T.push({
    id: "announcement-ticker", name: "Announcement Ticker", category: "Bars & tickers",
    desc: "A scrolling strip for this week's announcements. One line per announcement.",
    fields: [
      { key: "label", label: "Label", type: "text", def: "Announcements", group: "Content" },
      { key: "items", label: "Announcements (one per line)", type: "textarea", group: "Content",
        def: "Youth night this Friday at 6pm\nMidweek prayer every Wednesday at 7pm\nWelcome, first-time guests — visit the connect desk\nBaptism class starts next Sunday after service" },
      { key: "speed", label: "Scroll speed", type: "select", def: "normal", group: "Content",
        options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] },
      { key: "pos", label: "Position", type: "select", def: "b", options: POS_BAR, group: "Content" }
    ],
    html: function (p) {
      var items = String(p.items || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12);
      if (!items.length) items = ["Welcome to church"];
      var inner = items.map(function (s) { return '<span class="tk-item">' + esc(clip(s, 140)) + '</span><span class="tk-sep">&#9670;</span>'; }).join("");
      return '<div class="tk ' + (p.pos === "t" ? "t" : "b") + '">' +
        (p.label ? '<div class="tk-label">' + esc(clip(p.label, 30)) + "</div>" : "") +
        '<div class="tk-track"><div class="tk-run" data-speed="' + esc(p.speed) + '"><div class="tk-group">' + inner + "</div></div></div></div>";
    },
    init: function (root) {
      var run = root.querySelector(".tk-run"), group = root.querySelector(".tk-group"), track = root.querySelector(".tk-track");
      if (!run || !group || !track) return;
      var base = group.innerHTML, need = Math.max(track.clientWidth, 1700), n = 0;
      while (group.scrollWidth < need && n++ < 30) group.insertAdjacentHTML("beforeend", base);
      run.appendChild(group.cloneNode(true));
      var pps = { slow: 90, normal: 140, fast: 210 }[run.getAttribute("data-speed")] || 140;
      run.style.setProperty("--dur", (group.scrollWidth / pps).toFixed(1) + "s");
    }
  });

  T.push({
    id: "giving-bar", name: "Giving Bar", category: "Bars & tickers",
    desc: "Point people to your giving link or text-to-give number.",
    fields: [
      { key: "heading", label: "Heading", type: "text", def: "Give online", group: "Content" },
      { key: "url", label: "Link or number", type: "text", def: "give.gracechapel.org", group: "Content" },
      { key: "note", label: "Extra note (optional)", type: "text", def: "Thank you for sowing into this house", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "bc", options: POS6, group: "Content" }
    ],
    html: function (p) {
      return '<div class="' + rowClass(p.pos) + '"><div class="gv"><div class="gv-icon">' + ICON.heart + "</div>" +
        '<div class="gv-body"><div class="gv-head">' + esc(clip(p.heading, 40)) + '</div><div class="gv-url">' + esc(clip(p.url, 60)) + "</div>" +
        (p.note ? '<div class="gv-note">' + esc(clip(p.note, 90)) + "</div>" : "") + "</div></div></div>";
    }
  });

  T.push({
    id: "prayer-bar", name: "Prayer Request Bar", category: "Bars & tickers",
    desc: "A calm pill for prayer points, testimonies and short messages from the pulpit.",
    fields: [
      { key: "label", label: "Label", type: "text", def: "Let us pray", group: "Content" },
      { key: "text", label: "Message", type: "textarea", def: "For our nation, our families and everyone who is searching for hope today.", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "c", options: POS3, group: "Content" }
    ],
    html: function (p) {
      var t = clip(p.text, 220);
      return '<div class="' + rowClass(p.pos) + '"><div class="pr"><div class="pr-icon">' + ICON.cross + "</div>" +
        '<div class="pr-body">' + (p.label ? '<div class="pr-label">' + esc(clip(p.label, 40)) + "</div>" : "") +
        '<div class="pr-text" style="font-size:' + fit(t.length, [[70, 46], [120, 40], [9999, 34]]) + 'px">' + esc(t) + "</div></div></div></div>";
    }
  });

  T.push({
    id: "social-bar", name: "Social Follow Bar", category: "Bars & tickers",
    desc: "Invite viewers to follow on Instagram, YouTube and Facebook. Leave a handle empty to hide it.",
    fields: [
      { key: "label", label: "Label", type: "text", def: "Follow us", group: "Content" },
      { key: "ig", label: "Instagram", type: "text", def: "@gracechapel", group: "Content" },
      { key: "yt", label: "YouTube", type: "text", def: "@gracechapeltv", group: "Content" },
      { key: "fb", label: "Facebook", type: "text", def: "/gracechapel", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "bc", options: POS6, group: "Content" }
    ],
    html: function (p) {
      var items = [["ig", p.ig], ["yt", p.yt], ["fb", p.fb]].filter(function (x) { return x[1]; });
      return '<div class="' + rowClass(p.pos) + '"><div class="so">' +
        (p.label ? '<div class="so-label">' + esc(clip(p.label, 30)) + "</div>" : "") +
        items.map(function (x) { return '<div class="so-item"><span class="so-icon">' + ICON[x[0]] + "</span>" + esc(clip(x[1], 40)) + "</div>"; }).join("") +
        "</div></div>";
    }
  });

  T.push({
    id: "service-countdown", name: "Service Countdown", category: "Countdowns & scenes",
    desc: "Days, hours, minutes and seconds to the start of service. Shows a welcome message at zero.",
    fields: [
      { key: "title", label: "Heading", type: "text", def: "Service starts in", group: "Content" },
      { key: "at", label: "Service start (your local time)", type: "datetime", def: nextSunday(10), group: "Content" },
      { key: "done", label: "Message at zero", type: "text", def: "Welcome — we are live!", group: "Content" }
    ],
    html: function (p) {
      var seg = function (k, l) { return '<div class="cd-box"><div class="cd-num" data-k="' + k + '">00</div><div class="cd-lab">' + l + "</div></div>"; };
      return '<div class="cd"><div class="cd-title">' + esc(clip(p.title, 60)) + '</div><div class="cd-boxes">' +
        seg("d", "Days") + seg("h", "Hours") + seg("m", "Minutes") + seg("s", "Seconds") + "</div>" +
        '<div class="cd-done">' + esc(clip(p.done, 80)) + '</div></div>';
    },
    init: function (root, p) { return runCountdown(root, p.at, function (parts, done) {
      root.classList.toggle("is-done", done);
      ["d", "h", "m", "s"].forEach(function (k) {
        var el = root.querySelector('[data-k="' + k + '"]');
        if (el) el.textContent = String(parts[k]).padStart(2, "0");
      });
    }); }
  });

  T.push({
    id: "starting-soon", name: "Starting Soon Screen", category: "Countdowns & scenes",
    desc: "Full-screen holding scene for before service, with an optional live countdown.",
    logo: true,
    fields: [
      { key: "church", label: "Church name", type: "text", def: "Grace Chapel", group: "Content" },
      { key: "headline", label: "Headline", type: "text", def: "Starting soon", group: "Content" },
      { key: "sub", label: "Sub-line", type: "text", def: "Take a moment to pray and get ready to worship", group: "Content" },
      { key: "at", label: "Countdown to (optional)", type: "datetime", def: "", group: "Content", optional: true },
      { key: "bg", label: "Background", type: "select", def: "gradient", group: "Content",
        options: [["gradient", "Colour gradient"], ["none", "Transparent (over video)"]] }
    ],
    html: function (p) {
      var logo = safeUrl(p.logo);
      return '<div class="ss ' + (p.bg === "none" ? "nobg" : "") + '"><div class="ss-bg"></div>' +
        '<div class="ss-body">' + (logo ? '<img class="ss-logo" alt="" src="' + esc(logo) + '">' : "") +
        (p.church ? '<div class="ss-church">' + esc(clip(p.church, 60)) + "</div>" : "") +
        '<div class="ss-head">' + esc(clip(p.headline, 40)) + "</div>" +
        (p.sub ? '<div class="ss-sub">' + esc(clip(p.sub, 120)) + "</div>" : "") +
        (p.at ? '<div class="ss-time" data-k="clock">--:--:--</div>' : "") + "</div></div>";
    },
    init: function (root, p) {
      if (!p.at) return;
      return runCountdown(root, p.at, function (parts, done) {
        var el = root.querySelector('[data-k="clock"]');
        if (!el) return;
        var z = function (n) { return String(n).padStart(2, "0"); };
        el.textContent = done ? "" : (parts.d ? parts.d + "d " : "") + z(parts.h) + ":" + z(parts.m) + ":" + z(parts.s);
      });
    }
  });

  T.push({
    id: "live-bug", name: "Live Bug", category: "Branding",
    desc: "A small corner badge with your church name and a pulsing LIVE tag.",
    logo: true,
    fields: [
      { key: "church", label: "Church name", type: "text", def: "Grace Chapel", group: "Content" },
      { key: "text", label: "Tag", type: "text", def: "LIVE", group: "Content" },
      { key: "pos", label: "Position", type: "select", def: "tl", options: POS_CORNER, group: "Content" }
    ],
    html: function (p) {
      var logo = safeUrl(p.logo), pos = ["tl", "tr", "bl", "br"].indexOf(p.pos) >= 0 ? p.pos : "tl";
      return '<div class="lb ' + pos + '">' + (logo ? '<img class="lb-logo" alt="" src="' + esc(logo) + '">' : "") +
        (p.church ? '<div class="lb-name">' + esc(clip(p.church, 40)) + "</div>" : "") +
        '<div class="lb-tag"><i></i>' + esc(clip(p.text || "LIVE", 12)) + "</div></div>";
    }
  });

  function runCountdown(root, at, render) {
    var target = new Date(at).getTime();
    function tick() {
      if (isNaN(target)) { render({ d: 0, h: 0, m: 0, s: 0 }, false); return; }
      var ms = Math.max(0, target - Date.now()), s = Math.floor(ms / 1000);
      render({ d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }, ms === 0);
    }
    tick();
    var id = setInterval(tick, 500);
    return function () { clearInterval(id); };
  }

  /* ---------- registry helpers ---------- */
  var byId = {};
  T.forEach(function (t) { byId[t.id] = t; });

  function fieldsFor(t) {
    var style = STYLE_FIELDS.filter(function (f) { return !f.logoOnly || t.logo === true; });
    return t.fields.concat(style, BEHAVIOUR_FIELDS);
  }

  function resolve(t, params) {
    var out = {};
    fieldsFor(t).forEach(function (f) { out[f.key] = f.def; });
    params = params || {};
    Object.keys(params).forEach(function (k) { if (k in out && params[k] != null) out[k] = String(params[k]); });
    return out;
  }

  function mount(stage, id, params, opts) {
    opts = opts || {};
    var t = byId[id];
    if (!t) { stage.innerHTML = ""; return null; }
    var p = resolve(t, params);
    stage.innerHTML = '<div class="ov" style="--c1:' + hex(p.c1, "0238E9") + ";--c2:" + hex(p.c2, "F59E0B") +
      ";--ff:" + (FONTS[p.font] || FONTS.sans) + '">' + t.html(p) + "</div>";
    var root = stage.firstChild, cleanup = t.init ? t.init(root, p) : null, timer = null;
    var api = {
      params: p,
      show: function (instant) {
        clearTimeout(timer);
        root.classList.remove("in");
        void root.offsetWidth;
        if (instant) root.classList.add("noanim");
        root.classList.add("in");
        if (instant) { void root.offsetWidth; root.classList.remove("noanim"); }
        var h = Number(p.hide) || 0;
        if (h > 0 && !opts.noAutoHide) timer = setTimeout(api.hide, h * 1000);
      },
      hide: function () { clearTimeout(timer); root.classList.remove("in"); },
      destroy: function () { clearTimeout(timer); if (cleanup) cleanup(); stage.innerHTML = ""; }
    };
    return api;
  }

  function buildUrl(id, params, base) {
    var t = byId[id], p = resolve(t, params), u = new URL(base || "overlay.html", location.href);
    u.search = "";
    u.searchParams.set("t", id);
    fieldsFor(t).forEach(function (f) {
      // dates are always written into the link so a saved link keeps counting to the same service
      if (String(p[f.key]) !== String(f.def) || (f.type === "datetime" && p[f.key])) u.searchParams.set(f.key, f.key === "c1" || f.key === "c2" ? String(p[f.key]).replace(/^#/, "") : p[f.key]);
    });
    return u.href;
  }

  function scaleStage(frame, stage) {
    var fit = function () { stage.style.transform = "scale(" + (frame.clientWidth / 1920) + ")"; };
    fit();
    if (global.ResizeObserver) new ResizeObserver(fit).observe(frame);
    else global.addEventListener("resize", fit);
  }

  global.MCEOverlays = {
    templates: T, byId: byId, fieldsFor: fieldsFor, resolve: resolve, mount: mount, buildUrl: buildUrl,
    scaleStage: scaleStage, nextSunday: nextSunday, styleKeys: ["c1", "c2", "font", "logo", "church"]
  };
})(window);
