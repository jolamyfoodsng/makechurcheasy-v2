(function () {
  "use strict";
  var O = window.MCEOverlays;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var KEY = "mce-overlays-church";

  var fontsReady = document.fonts && document.fonts.ready
    ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 2500); })])
    : Promise.resolve();

  function saved() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function store(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function withSaved(t, params) {
    var s = saved(), keys = O.fieldsFor(t).map(function (f) { return f.key; }), out = {};
    O.styleKeys.forEach(function (k) { if (s[k] && keys.indexOf(k) >= 0) out[k] = s[k]; });
    return Object.assign(out, params || {});
  }
  function toast(msg) {
    var el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1800);
  }

  /* ---------- looping preview used by hero + gallery cards ---------- */
  var loops = [];
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var l = e.target._loop;
      if (!l) return;
      l.visible = e.isIntersecting;
      if (l.visible) l.start(); else l.stop();
    });
  }, { threshold: 0.2 }) : null;

  function previewLoop(frame, stage, id, params, stagger) {
    var api = O.mount(stage, id, Object.assign({}, params, { hide: "0", repeat: "0" }), {});
    if (!api) return;
    O.scaleStage(frame, stage);
    var t1, t2, t3, loop = { visible: true };
    loop.start = function () {
      loop.stop();
      if (reduce) { api.show(true); return; }
      var cycle = function () {
        api.show();
        t2 = setTimeout(api.hide, 4200);
        t3 = setTimeout(cycle, 6200);
      };
      t1 = setTimeout(cycle, stagger || 0);
    };
    loop.stop = function () { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    frame._loop = loop;
    if (io) io.observe(frame); else loop.start();
    loops.push(loop);
  }

  /* ---------- gallery ---------- */
  var grid = $("#grid"), chips = $("#chips"), activeCat = "All";

  function buildGallery() {
    fontsReady.then(function () {
      loops.forEach(function (l) { l.stop(); });
      loops = [];
      grid.innerHTML = "";
      O.templates.forEach(function (t, i) {
        var card = document.createElement("article");
        card.className = "card"; card.dataset.cat = t.category; card.dataset.id = t.id;
        card.innerHTML =
          '<div class="frame bg-video" role="button" tabindex="0" aria-label="Customize ' + t.name + '"><span class="badge"></span><div class="stage"></div></div>' +
          '<div class="meta"><div><h3></h3><p></p></div><button class="btn sm" type="button">Customize</button></div>';
        $(".badge", card).textContent = t.category;
        $("h3", card).textContent = t.name;
        $("p", card).textContent = t.desc;
        grid.appendChild(card);
        var frame = $(".frame", card);
        var open = function () { openStudio(t.id); };
        frame.addEventListener("click", open);
        frame.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        $(".btn", card).addEventListener("click", open);
        previewLoop(frame, $(".stage", frame), t.id, withSaved(t), (i % 4) * 350);
      });
      applyFilter();
    });
  }

  function buildChips() {
    var cats = ["All"];
    O.templates.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
    cats.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.textContent = c; b.setAttribute("aria-pressed", String(c === activeCat));
      b.addEventListener("click", function () {
        activeCat = c;
        Array.prototype.forEach.call(chips.children, function (x) { x.setAttribute("aria-pressed", String(x.textContent === c)); });
        applyFilter();
      });
      chips.appendChild(b);
    });
  }

  function applyFilter() {
    Array.prototype.forEach.call(grid.children, function (card) {
      card.hidden = !(activeCat === "All" || card.dataset.cat === activeCat);
    });
    // preview frames that were hidden have no width, so re-fit them
    window.dispatchEvent(new Event("resize"));
  }

  /* ---------- customizer ---------- */
  var dlg = $("#studio"), form = $("#form"), frame = $("#studioFrame"), stage = $("#studioStage");
  var cur = null, params = {}, api = null, scaled = false, timer = null;

  var BGS = [["bg-video", "#26305f", "Stream still"], ["bg-dark", "#121214", "Dark"], ["bg-green", "#00b140", "Green"], ["bg-checker", "#cfcfcf", "Transparent"], ["bg-light", "#e9ecf4", "Light"]];
  (function () {
    var box = $("#bgs");
    BGS.forEach(function (b, i) {
      var d = document.createElement("button");
      d.type = "button"; d.className = "bgdot"; d.title = b[2]; d.setAttribute("aria-label", "Preview on " + b[2]);
      d.style.background = b[0] === "bg-checker" ? "repeating-conic-gradient(#cfcfcf 0 25%,#f4f4f4 0 50%) 0 0/10px 10px" : b[1];
      d.setAttribute("aria-pressed", String(i === 0));
      d.addEventListener("click", function () {
        frame.className = "frame " + b[0];
        Array.prototype.forEach.call(box.querySelectorAll(".bgdot"), function (x) { x.setAttribute("aria-pressed", String(x === d)); });
      });
      box.appendChild(d);
    });
  })();

  function toInputValue(f, v) { return f.type === "color" ? "#" + String(v).replace(/^#/, "") : v; }

  function buildForm(t) {
    form.innerHTML = "";
    var groups = {};
    O.fieldsFor(t).forEach(function (f) { (groups[f.group || "Content"] = groups[f.group || "Content"] || []).push(f); });
    ["Content", "Style", "Behaviour"].forEach(function (g) {
      if (!groups[g]) return;
      var fs = document.createElement("div"); fs.className = "fgroup";
      var h = document.createElement("h4"); h.textContent = g; fs.appendChild(h);
      groups[g].forEach(function (f) {
        var lab = document.createElement("label"); lab.className = "field" + (f.type === "color" ? " inline" : "");
        var sp = document.createElement("span"); sp.textContent = f.label; lab.appendChild(sp);
        var el;
        if (f.type === "textarea") el = document.createElement("textarea");
        else if (f.type === "select") {
          el = document.createElement("select");
          f.options.forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; el.appendChild(op); });
        } else {
          el = document.createElement("input");
          el.type = f.type === "datetime" ? "datetime-local" : f.type === "color" ? "color" : f.type === "number" ? "number" : "text";
          if (f.type === "number") { el.min = "0"; el.max = "3600"; el.step = "1"; }
        }
        el.name = f.key;
        el.value = toInputValue(f, params[f.key]);
        el.addEventListener("input", function () {
          params[f.key] = f.type === "color" ? el.value.replace(/^#/, "") : el.value;
          schedule();
        });
        lab.appendChild(el);
        if (f.hint) { var hn = document.createElement("p"); hn.className = "hint"; hn.textContent = f.hint; lab.appendChild(hn); }
        fs.appendChild(lab);
      });
      form.appendChild(fs);
    });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(render, 120); updateLink(); }

  function render() {
    if (!cur) return;
    if (api) api.destroy();
    api = O.mount(stage, cur.id, params, { noAutoHide: true });
    if (api) api.show(true);
  }

  function updateLink() {
    if (!cur) return;
    var url = O.buildUrl(cur.id, params);
    $("#linkBox").value = url;
    $("#openLink").href = url + (url.indexOf("?") > 0 ? "&" : "?") + "bg=dark";
  }

  function openStudio(id) {
    var t = O.byId[id];
    if (!t) return;
    cur = t;
    params = O.resolve(t, withSaved(t));
    $("#studioTitle").textContent = t.name;
    buildForm(t);
    if (!dlg.open) dlg.showModal();
    if (!scaled) { O.scaleStage(frame, stage); scaled = true; }
    fontsReady.then(function () { render(); updateLink(); });
    history.replaceState(null, "", "#t=" + id);
  }

  function closeStudio() {
    if (api) { api.destroy(); api = null; }
    cur = null;
    if (dlg.open) dlg.close();
    history.replaceState(null, "", location.pathname + location.search);
  }

  $("#studioClose").addEventListener("click", closeStudio);
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeStudio(); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) closeStudio(); });
  $("#playBtn").addEventListener("click", function () { if (api) api.show(); });
  $("#hideBtn").addEventListener("click", function () { if (api) api.hide(); });

  $("#copyBtn").addEventListener("click", function () {
    var box = $("#linkBox"), text = box.value;
    var done = function () { toast("Link copied. Paste it into OBS."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() { box.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Press Ctrl/Cmd+C to copy"); } }
  });

  $("#saveDefaults").addEventListener("click", function () {
    var s = saved();
    O.styleKeys.forEach(function (k) { if (params[k] != null && params[k] !== "") s[k] = params[k]; });
    if (store(s)) { toast("Saved on this device"); buildGallery(); } else toast("Could not save in this browser");
  });
  $("#resetDefaults").addEventListener("click", function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    if (cur) { params = O.resolve(cur, {}); buildForm(cur); render(); updateLink(); }
    buildGallery();
  });

  window.addEventListener("hashchange", function () {
    var m = /^#t=([\w-]+)$/.exec(location.hash);
    if (m && O.byId[m[1]]) openStudio(m[1]);
  });

  /* ---------- hero ---------- */
  fontsReady.then(function () {
    previewLoop($("#heroFrame"), $("#heroStage"), "lower-third-clean", withSaved(O.byId["lower-third-clean"]), 400);
  });

  buildChips();
  buildGallery();
  var m = /^#t=([\w-]+)$/.exec(location.hash);
  if (m && O.byId[m[1]]) openStudio(m[1]);
})();
