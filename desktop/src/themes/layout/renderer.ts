/**
 * ThemeRenderer — draws a ThemeLayout into a host element.
 *
 * One file, used in two places:
 *   • the app (editor canvas, theme thumbnails, dock previews) via import
 *   • the OBS overlays via public/theme-renderer.js (scripts/build-theme-renderer.mjs)
 *
 * Performance rules it follows:
 *   • The layer DOM is built once per layout hash. New content only swaps text.
 *   • Animations use the Web Animations API on transform / opacity / clip-path.
 *   • `will-change` is set only while an animation runs.
 *   • Loops pause while the theme is hidden; the stage is visibility:hidden.
 *   • Text auto-fit is a bounded binary search (≤ 10 measurements) per change.
 */
import {
  isSplitPreset,
  layerKeyframes,
  loopKeyframes,
  splitKeyframes,
  timing,
  totalDuration,
} from "./animations";
import { emphasisColorFor, emphasisWeightFor, parseEmphasis } from "./emphasis";
import { headingLayers } from "./heading";
import { segmentSvg } from "./segments";
import { fillTokens, hasTokens, isVerseTextPattern, resolveTokens, splitVerseLines, verseTokenKey, type ResolvedTokens } from "./content";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  type LayerAnchor,
  type LayerAnimation,
  type ThemeContent,
  type ThemeLayer,
  type ThemeLayout,
  type ThemeLive,
  type WarnLevel,
} from "./types";

const WARN_DEFAULTS: Record<WarnLevel, string> = { green: "#22c55e", yellow: "#eab308", red: "#ef4444" };

export interface ThemeRendererOptions {
  /** Rewrites image URLs (e.g. to the overlay asset server). */
  resolveAsset?: (src: string) => string;
  /** Scale the 1920×1080 stage to fit the host (default true). */
  autoScale?: boolean;
  /** Skip all animations (thumbnails, editor while dragging). */
  static?: boolean;
  /** Max wait for fonts/images before the first show, ms. Default 1500. */
  preloadTimeoutMs?: number;
  /**
   * Fill any screen shape (projectors that aren't 16:9): the stage is centred
   * (lower thirds sit at the bottom) and the theme's full-screen background
   * layers stretch to cover the whole screen. Text keeps its 16:9 layout, so it
   * is never stretched or cropped. No change on a 16:9 host such as OBS.
   */
  fillViewport?: boolean;
  /**
   * Endless background loops (drift, pulse, shimmer). Default OFF: on virtual or
   * weak GPUs (Windows VMs, cloud laptops, software rendering) a never-ending,
   * screen-wide animation could leave the whole page blank. Patterns and glows
   * still show, just standing still. Entrance/exit animations are not affected.
   */
  loops?: boolean;
}

/** A top-level box/image covering (nearly) the whole canvas: the theme's background. */
function isFullFrameBackground(layer: ThemeLayer): boolean {
  return !layer.parentId
    && (layer.type === "box" || layer.type === "image")
    && layer.w >= DESIGN_WIDTH * 0.9
    && typeof layer.h === "number"
    && layer.h >= DESIGN_HEIGHT * 0.9;
}

interface LayerNode {
  layer: ThemeLayer;
  pos: HTMLDivElement;
  el: HTMLDivElement;
  surface: HTMLDivElement | null;
  shine: HTMLDivElement | null;
  text: HTMLDivElement | null;
  usesTokens: boolean;
  isVerse: boolean;
  lastValue: string;
  empty: boolean;
  /** "text" = the reference / label; "decor" = a box or line drawn behind it. */
  heading: "text" | "decor" | null;
  loopAnims: Animation[];
}

const STYLE_ID = "mtl-renderer-style";
const BASE_CSS = `
.mtl-host{position:absolute;inset:0;overflow:hidden;pointer-events:none;contain:strict}
.mtl-stage{position:absolute;left:0;top:0;width:${DESIGN_WIDTH}px;height:${DESIGN_HEIGHT}px;transform-origin:0 0;visibility:hidden}
.mtl-stage.is-visible{visibility:visible}
.mtl-pos{position:absolute;box-sizing:border-box}
.mtl-el{position:relative;box-sizing:border-box;width:100%;height:100%;overflow:hidden}
.mtl-el.is-auto{height:auto}
.mtl-surface{position:absolute;left:0;top:0;bottom:0;width:100%}
.mtl-surface.is-drift{width:200%}
.mtl-shine{position:absolute;top:0;bottom:0;left:0;width:35%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent)}
.mtl-text{position:relative;box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;overflow-wrap:break-word}
.mtl-el.is-auto .mtl-text{height:auto}
.mtl-text-inner{display:block}
.mtl-line{display:inline}
.mtl-line.is-block{display:block}
.mtl-line.is-stack+.mtl-line.is-stack{margin-top:.4em}
.mtl-em{font-weight:700}
.mtl-num{font-size:.55em;vertical-align:super;line-height:0;margin-right:.25em;font-weight:inherit;opacity:.85}
.mtl-w{display:inline-block;white-space:pre}
.mtl-img{display:block;width:100%;height:100%}
.mtl-media{position:absolute;left:0;top:0}
video::-webkit-media-controls,video::-webkit-media-controls-enclosure,video::-webkit-media-controls-panel,video::-webkit-media-controls-overlay-play-button,video::-webkit-media-controls-start-playback-button,video::-webkit-media-controls-play-button{display:none!important;opacity:0!important;visibility:hidden!important;-webkit-appearance:none!important;pointer-events:none!important}
.mtl-dim{position:absolute;inset:0;pointer-events:none}
.mtl-hidden{display:none!important}
.mtl-text.is-nowrap{white-space:nowrap}
.mtl-text.is-segment{padding:0}
.mtl-text.is-segment>svg{display:block;overflow:visible}
`;

const ANCHOR_SHIFT: Record<LayerAnchor, [number, number]> = {
  "top-left": [0, 0], "top-center": [-50, 0], "top-right": [-100, 0],
  "middle-left": [0, -50], center: [-50, -50], "middle-right": [-100, -50],
  "bottom-left": [0, -100], "bottom-center": [-50, -100], "bottom-right": [-100, -100],
};

export function hashLayout(layout: ThemeLayout): string {
  const s = JSON.stringify(layout);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function safeUrl(src: string): string {
  const v = (src || "").trim();
  if (/^(https?:|data:image\/|blob:|\/|\.\/|[\w-]+\/)/i.test(v) && !/^javascript:/i.test(v)) return v;
  return "";
}

function gradientCss(layer: ThemeLayer): string {
  const g = layer.style.gradient;
  if (!g || !g.stops?.length) return "";
  const stops = g.stops.map((s) => `${s.color} ${s.at}%`).join(", ");
  return g.type === "radial" ? `radial-gradient(circle at 30% 50%, ${stops})` : `linear-gradient(${g.angle ?? 90}deg, ${stops})`;
}

/** One SVG displacement filter per roughness level (stamp / distressed text). */
function ensureRoughFilter(doc: Document, amount: number): string {
  const level = Math.min(10, Math.max(1, Math.round(amount)));
  const id = `mtl-rough-${level}`;
  if (doc.getElementById(id)) return id;
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("style", "position:absolute");
  svg.setAttribute("aria-hidden", "true");
  const filter = doc.createElementNS(NS, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "-5%");
  filter.setAttribute("y", "-5%");
  filter.setAttribute("width", "110%");
  filter.setAttribute("height", "110%");
  const turb = doc.createElementNS(NS, "feTurbulence");
  turb.setAttribute("type", "fractalNoise");
  turb.setAttribute("baseFrequency", "0.045");
  turb.setAttribute("numOctaves", "3");
  turb.setAttribute("seed", "7");
  turb.setAttribute("result", "n");
  const disp = doc.createElementNS(NS, "feDisplacementMap");
  disp.setAttribute("in", "SourceGraphic");
  disp.setAttribute("in2", "n");
  disp.setAttribute("scale", String(level * 1.6));
  filter.appendChild(turb);
  filter.appendChild(disp);
  svg.appendChild(filter);
  doc.body.appendChild(svg);
  return id;
}

function ensureBaseStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Longest the old layout may take to play out on a Full <-> Lower third switch. */
const MODE_SWITCH_MAX_OUT_MS = 450;
/**
 * Next verse / slide while one is already on screen: only the first show plays
 * the theme's full entrance. Later swaps are squeezed into these budgets so
 * stepping through verses or lyrics feels instant (a quick out, a quick in).
 */
const QUICK_SWAP_OUT_MS = 100;
const QUICK_SWAP_IN_MS = 220;
/** Stage fade used on a mode switch when the layers have no out animation. */
const MODE_SWITCH_FALLBACK_FADE_MS = 220;

function finished(anims: Animation[]): Promise<void> {
  return Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
}

/**
 * Starts a muted background video and keeps it going (after load, after the window was hidden, after a
 * pause). The video has no autoplay attribute and no controls, so the web view never shows its play button.
 */
function keepPlaying(video: HTMLVideoElement, shouldPlay: () => boolean = () => true): void {
  const kick = () => {
    if (!video.isConnected || !video.paused || video.ended || !shouldPlay()) return;
    try {
      const started = video.play();
      if (started && typeof started.catch === "function") started.catch(() => undefined);
    } catch {
      /* not allowed yet: tried again on the next event */
    }
  };
  video.addEventListener("loadeddata", kick);
  video.addEventListener("canplay", kick);
  video.addEventListener("pause", () => setTimeout(kick, 250));
  const win = video.ownerDocument.defaultView;
  win?.document.addEventListener("visibilitychange", kick);
  const timer = win?.setInterval(() => {
    if (!video.isConnected) { win.clearInterval(timer); win.document.removeEventListener("visibilitychange", kick); return; }
    kick();
  }, 2000);
  kick();
}

/**
 * Loops a background video without the blank frame a single `<video loop>` can show
 * when it restarts (OBS's browser shows the scene behind it for a moment). A twin
 * video waits at the start; just before the end it takes over, then the first one
 * rewinds. Very short clips keep the plain loop.
 */
const SEAMLESS_LEAD_S = 0.45;
function seamlessLoop(primary: HTMLVideoElement, twin: HTMLVideoElement): void {
  let active = primary;
  let idle = twin;
  let swapping = false;
  const swap = () => {
    if (swapping) return;
    swapping = true;
    const next = idle;
    const prev = active;
    const done = () => { swapping = false; };
    const go = () => {
      next.style.opacity = "1";
      prev.style.opacity = "0";
      active = next;
      idle = prev;
      setTimeout(() => {
        try { prev.pause(); prev.currentTime = 0; } catch { /* not seekable yet */ }
        done();
      }, 150);
    };
    try { next.currentTime = 0; } catch { /* starts from the beginning anyway */ }
    try {
      const started = next.play();
      if (started && typeof started.then === "function") started.then(go, done);
      else go();
    } catch {
      done();
    }
  };
  const win = primary.ownerDocument.defaultView;
  const timer = win?.setInterval(() => {
    if (!primary.isConnected) { win.clearInterval(timer); return; }
    if (swapping) return;
    const d = active.duration;
    if (d > 0 && Number.isFinite(d) && (active.ended || d - active.currentTime <= SEAMLESS_LEAD_S)) swap();
  }, 100);
  keepPlaying(primary, () => active === primary);
  keepPlaying(twin, () => active === twin);
}

export class ThemeRenderer {
  private host: HTMLElement;
  private doc: Document;
  private opts: Required<Pick<ThemeRendererOptions, "autoScale" | "static" | "preloadTimeoutMs">> & ThemeRendererOptions;
  private root: HTMLDivElement;
  private stage: HTMLDivElement;
  private nodes: LayerNode[] = [];
  private layout: ThemeLayout | null = null;
  private hash = "";
  private preload: Promise<void> = Promise.resolve();
  /** First frames of the background videos in the current layout. */
  private mediaReady: Promise<void>[] = [];
  private visibleState = false;
  private running: Animation[] = [];
  private queue: Promise<void> = Promise.resolve();
  private pending:
    | { kind: "show"; content: ThemeContent }
    | { kind: "hide"; maxOutMs?: number }
    | { kind: "switch"; layout: ThemeLayout; content: ThemeContent | null }
    | null = null;
  /** Bumped every time the layout DOM is rebuilt, so a mode switch can tell it was superseded. */
  private layoutEpoch = 0;
  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize = () => this.rescale();
  private content: ThemeContent | null = null;
  /** ms spent on the last content swap (DOM + fit), for perf checks. */
  lastSwapMs = 0;

  constructor(host: HTMLElement, options: ThemeRendererOptions = {}) {
    this.host = host;
    this.doc = host.ownerDocument;
    this.opts = { autoScale: true, static: false, preloadTimeoutMs: 1500, ...options };
    ensureBaseStyle(this.doc);
    this.root = this.doc.createElement("div");
    this.root.className = "mtl-host";
    this.stage = this.doc.createElement("div");
    this.stage.className = "mtl-stage";
    this.root.appendChild(this.stage);
    host.appendChild(this.root);
    if (this.opts.autoScale) {
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.rescale());
        this.resizeObserver.observe(this.root);
      } else {
        window.addEventListener("resize", this.onWindowResize);
      }
      this.rescale();
    }
  }

  get visible(): boolean {
    return this.visibleState;
  }

  get layoutHash(): string {
    return this.hash;
  }

  /** Builds the layer DOM. No-op when the layout hasn't changed. */
  setLayout(layout: ThemeLayout): boolean {
    const nextHash = hashLayout(layout);
    if (nextHash === this.hash) return false;
    const wasVisible = this.visibleState;
    this.layoutEpoch++;
    // An explicit layout change replaces a queued mode switch.
    if (this.pending?.kind === "switch") this.pending = null;
    this.cancelRunning();
    this.stopLoops();
    this.stage.textContent = "";
    this.nodes = [];
    this.layout = layout;
    this.hash = nextHash;
    this.mediaReady = [];
    this.build(layout);
    if (this.opts.fillViewport) this.rescale();
    this.preload = this.preloadAssets(layout);
    if (this.content) this.applyAllContent(this.content);
    if (wasVisible) {
      this.startLoops();
    }
    return true;
  }

  /** Show content. Animates in from hidden, or swaps content while visible. Calls are coalesced. */
  show(content: ThemeContent): Promise<void> {
    this.pending = { kind: "show", content };
    return this.drain();
  }

  /**
   * Show with no entrance animation (a page reload mid-countdown must not replay the intro).
   * Waits for fonts like show(); looping effects still run.
   */
  async showInstant(content: ThemeContent): Promise<void> {
    if (!this.layout) return;
    await this.withTimeout(this.preload);
    this.cancelRunning();
    this.content = content;
    this.timeSwap(() => this.applyAllContent(content));
    this.stage.classList.add("is-visible");
    const was = this.visibleState;
    this.visibleState = true;
    if (!was) this.startLoops();
  }

  /**
   * Mode switch (Full <-> Lower third): play the current layout out, build the
   * new layout while nothing is on screen, then play the new one in. With
   * nothing visible, or an unchanged layout, this is just setLayout + show.
   */
  switchLayout(layout: ThemeLayout, content?: ThemeContent | null): Promise<void> {
    const next = content ?? this.content;
    if (!this.visibleState || hashLayout(layout) === this.hash) {
      this.setLayout(layout);
      return next ? this.show(next) : Promise.resolve();
    }
    this.pending = { kind: "switch", layout, content: next };
    return this.drain();
  }

  /**
   * Play everything out, then hide. `maxOutMs` bounds how long the out may take
   * (and fades the stage if the layers have no out animation), for callers
   * that must be done by a deadline, like a mode switch.
   */
  hide(maxOutMs?: number): Promise<void> {
    this.pending = { kind: "hide", maxOutMs };
    return this.drain();
  }

  /** Editor/thumbnail use: render content visible with no animation. */
  renderStatic(content: ThemeContent | null) {
    this.cancelRunning();
    this.content = content;
    if (content) this.applyAllContent(content);
    this.stage.classList.add("is-visible");
    this.visibleState = true;
  }

  destroy() {
    this.cancelRunning();
    this.stopLoops();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.root.remove();
    this.nodes = [];
    this.layout = null;
    this.hash = "";
  }

  rescale() {
    const w = this.root.clientWidth || this.host.clientWidth || DESIGN_WIDTH;
    const h = this.root.clientHeight || this.host.clientHeight || DESIGN_HEIGHT;
    const scale = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
    if (!this.opts.fillViewport) {
      this.stage.style.transform = `scale(${scale})`;
      return;
    }
    if (this.layout?.format !== "lower-third") {
      // Full screen on any screen shape (16:10 laptops, 4:3 projectors, ultra-wide): the stage fills
      // the whole screen. The side that has spare room grows, the layout is spread over it, and the
      // text is never stretched (see applyFill). Nothing changes on a 16:9 screen such as OBS.
      this.stage.style.transform = `scale(${scale})`;
      this.fill = { kx: w / scale / DESIGN_WIDTH, ky: h / scale / DESIGN_HEIGHT };
      this.applyFill();
      return;
    }
    this.fill = { kx: 1, ky: 1 };
    const spareX = Math.max(0, w - DESIGN_WIDTH * scale);
    const spareY = Math.max(0, h - DESIGN_HEIGHT * scale);
    const offsetX = spareX / 2;
    const offsetY = spareY; // lower thirds sit at the bottom of the screen
    this.stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    // Spare space in stage pixels on each side, for the backgrounds to bleed into.
    this.bleed = {
      left: offsetX / scale,
      right: (spareX - offsetX) / scale,
      top: offsetY / scale,
      bottom: (spareY - offsetY) / scale,
    };
    this.applyBleed();
  }

  /** How much bigger than 1920×1080 the full-screen area is on each axis (1 = same shape as 16:9). */
  private fill = { kx: 1, ky: 1 };

  /**
   * Spread a full-screen layout over a screen that is not 16:9. Positions scale with the screen, so
   * the frame, the background and the shapes reach every edge. Boxes and wide pictures grow with it, and
   * so does everything placed on a panel that grew. Free text, lines, logos and round shapes keep their
   * size and only move (never stretched or cropped).
   */
  private applyFill() {
    const { kx, ky } = this.fill;
    const px = (n: number) => `${n}px`;
    const nodeById = new Map(this.nodes.map((n) => [n.layer.id, n]));
    /** Layers that grew: their children follow with the same factors, so a panel and what is on it stay together. */
    const grew = new Set<string>();
    for (const node of this.nodes) {
      const layer = node.layer;
      const parent = layer.parentId ? nodeById.get(layer.parentId) : undefined;
      const fx = parent ? (grew.has(parent.layer.id) ? kx : 1) : kx;
      const fy = parent ? (grew.has(parent.layer.id) ? ky : 1) : ky;
      const numericH = typeof layer.h === "number";
      const h = numericH ? (layer.h as number) : 0;
      const w = Math.max(1, layer.w);
      const frame = !parent && isFullFrameBackground(layer);
      let grows = false;
      if (frame) grows = true;
      else if (layer.type === "box") grows = numericH && Math.abs(w - h) / Math.max(w, h, 1) >= 0.12;
      else if (layer.type === "image") grows = numericH && (w >= DESIGN_WIDTH * 0.5 || h >= DESIGN_HEIGHT * 0.5);
      else if (layer.type === "text") grows = Boolean(parent) && grew.has(parent!.layer.id) && numericH; // keeps its place inside a panel that grew
      if (grows) grew.add(layer.id);
      // A little overscan on the backgrounds, so a half-pixel never shows a hairline at the screen edge.
      const over = frame && (kx !== 1 || ky !== 1) ? 1 : 0;
      node.pos.style.left = px(layer.x * fx - over);
      node.pos.style.top = px(layer.y * fy - over);
      if (grows && numericH) {
        node.pos.style.width = px(w * fx + over * 2);
        node.pos.style.height = px(Math.max(1, h) * fy + over * 2);
      } else if (layer.type === "divider" && numericH) {
        // A rule keeps its thickness and grows along its length, so rules made of pieces stay joined.
        if (w >= h) node.pos.style.width = px(w * fx);
        else node.pos.style.height = px(Math.max(1, h) * fy);
      }
    }
  }

  private bleed = { left: 0, right: 0, top: 0, bottom: 0 };

  /** Stretch the full-frame background layers over the spare space. */
  private applyBleed() {
    if (!this.opts.fillViewport) return;
    const b = this.bleed;
    for (const node of this.nodes) {
      const layer = node.layer;
      if (!isFullFrameBackground(layer) || typeof layer.h !== "number") continue;
      const width = Math.max(1, layer.w) + b.left + b.right;
      const height = Math.max(1, layer.h) + b.top + b.bottom;
      if (layer.anchor === "top-left" || !layer.anchor) {
        node.pos.style.left = `${layer.x - b.left}px`;
        node.pos.style.top = `${layer.y - b.top}px`;
      } else if (layer.anchor === "center") {
        node.pos.style.left = `${layer.x + (b.right - b.left) / 2}px`;
        node.pos.style.top = `${layer.y + (b.bottom - b.top) / 2}px`;
      } else {
        continue;
      }
      node.pos.style.width = `${width}px`;
      node.pos.style.height = `${height}px`;
    }
  }

  // ───────────────────────────── queue ─────────────────────────────

  private drain(): Promise<void> {
    this.queue = this.queue.then(async () => {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        if (job.kind === "show") await this.runShow(job.content);
        else if (job.kind === "switch") await this.runSwitch(job.layout, job.content);
        else await this.runHide(job.maxOutMs);
      }
    }).catch((err) => {
      console.error("[ThemeRenderer]", err);
    });
    return this.queue;
  }

  private async runShow(content: ThemeContent) {
    if (!this.layout) return;
    await this.withTimeout(this.preload);
    if (!this.visibleState) {
      this.content = content;
      this.timeSwap(() => this.applyAllContent(content));
      await this.playIn(this.nodes);
      return;
    }
    const prev = this.content;
    this.content = content;
    if (this.layout.swap === "all") {
      await this.playOut(this.nodes, this.quickSpeed(this.nodes, "out", QUICK_SWAP_OUT_MS));
      this.timeSwap(() => this.applyAllContent(content));
      await this.playIn(this.nodes, this.quickSpeed(this.nodes, "in", QUICK_SWAP_IN_MS));
      return;
    }
    const tokens = resolveTokens(content);
    const changed = this.nodes.filter((n) => n.usesTokens && this.valueFor(n, tokens, content) !== n.lastValue);
    // The heading box goes with its label: out when the label goes blank, in when it comes back.
    const headingEmpty = this.headingEmpty(tokens, content);
    changed.push(...this.nodes.filter((n) => n.heading === "decor" && n.empty !== headingEmpty));
    if (!changed.length && prev) return;
    await this.playOut(changed, this.quickSpeed(changed, "out", QUICK_SWAP_OUT_MS));
    this.timeSwap(() => {
      for (const n of changed) this.applyContent(n, tokens, content);
      this.syncHeadingDecor(headingEmpty);
      this.applyLive(content.live);
    });
    const entering = changed.filter((n) => !n.empty);
    await this.playIn(entering, this.quickSpeed(entering, "in", QUICK_SWAP_IN_MS));
  }

  /** Speed multiplier that fits these nodes' in/out animations inside `maxMs` (never slows them down). */
  private quickSpeed(nodes: LayerNode[], dir: "in" | "out", maxMs: number): number {
    const anims = nodes.filter((n) => !n.empty).map((n) => (dir === "in" ? n.layer.in : n.layer.out));
    const total = totalDuration(anims);
    return total > maxMs ? maxMs / total : 1;
  }

  private async runSwitch(layout: ThemeLayout, content: ThemeContent | null) {
    const epoch = this.layoutEpoch;
    // Keep a live mode switch snappy even if the theme's out is long.
    if (this.visibleState) await this.playOutWithin(MODE_SWITCH_MAX_OUT_MS);
    // Something else set a newer layout while we were fading out: it owns the stage now.
    if (this.layoutEpoch !== epoch) return;
    this.cancelRunning();
    this.stopLoops();
    this.stage.classList.remove("is-visible");
    this.visibleState = false;
    this.setLayout(layout);
    if (content) await this.runShow(content);
  }

  /** Play the whole layout out within `maxMs`; with no out animation set, fade the stage instead of cutting. */
  private async playOutWithin(maxMs: number) {
    const outs = this.nodes.filter((n) => !n.empty).map((n) => n.layer.out);
    const total = totalDuration(outs);
    if (total > 0) {
      await this.playOut(this.nodes, total > maxMs ? maxMs / total : 1);
      return;
    }
    await finished([
      this.animate(this.stage, [{ opacity: 1 }, { opacity: 0 }], {
        duration: Math.min(MODE_SWITCH_FALLBACK_FADE_MS, maxMs),
        easing: "ease-in",
        fill: "forwards",
      }),
    ]);
  }

  private async runHide(maxOutMs?: number) {
    if (!this.visibleState) return;
    if (maxOutMs && maxOutMs > 0) await this.playOutWithin(maxOutMs);
    else await this.playOut(this.nodes);
    this.cancelRunning();
    this.stopLoops();
    this.stage.classList.remove("is-visible");
    this.visibleState = false;
  }

  private withTimeout(p: Promise<void>): Promise<void> {
    return Promise.race([p, new Promise<void>((r) => setTimeout(r, this.opts.preloadTimeoutMs))]);
  }

  private timeSwap(fn: () => void) {
    const t0 = performance.now();
    fn();
    this.lastSwapMs = performance.now() - t0;
  }

  // ───────────────────────────── build ─────────────────────────────

  private build(layout: ThemeLayout) {
    const byId = new Map<string, LayerNode>();
    const heading = headingLayers(layout);
    for (const layer of layout.layers) {
      if (layer.hidden) continue;
      const node = this.createNode(layer);
      node.heading = heading.text.has(layer.id) ? "text" : heading.decor.has(layer.id) ? "decor" : null;
      byId.set(layer.id, node);
      this.nodes.push(node);
    }
    for (const node of this.nodes) {
      const parent = node.layer.parentId ? byId.get(node.layer.parentId) : undefined;
      (parent ? parent.el : this.stage).appendChild(node.pos);
    }
  }

  /** Adds the layer's video (preferred) or picture. Returns false when neither URL is usable. */
  private appendMedia(el: HTMLElement, s: ThemeLayer["style"]): boolean {
    const d = this.doc;
    const resolve = (v: string) => safeUrl(v ? (this.opts.resolveAsset ? this.opts.resolveAsset(v) : v) : "");
    const videoSrc = resolve(s.videoSrc || "");
    const src = resolve(s.src || "");
    if (videoSrc) {
      const makeVideo = () => {
        const video = d.createElement("video");
        video.className = "mtl-img mtl-media";
        video.muted = true;
        video.defaultMuted = true;
        // No autoplay attribute: when a web view blocks it, WebKit shows its own big play button. We start it ourselves.
        video.autoplay = false;
        video.playsInline = true;
        video.preload = "auto";
        video.controls = false;
        video.disablePictureInPicture = true;
        video.setAttribute("muted", "");
        video.setAttribute("disablepictureinpicture", "");
        video.setAttribute("disableremoteplayback", "");
        video.src = videoSrc;
        video.style.objectFit = s.fit || "cover";
        return video;
      };
      const video = makeVideo();
      el.appendChild(video);
      // The first frame must be ready before the layer fades in, or the scene behind shows through.
      this.mediaReady.push(new Promise<void>((resolveReady) => {
        const done = () => resolveReady();
        if (video.readyState >= 2) done();
        video.addEventListener("loadeddata", done, { once: true });
        video.addEventListener("error", done, { once: true });
      }));
      // Clips over 2 s loop through a twin video (no blank frame at the restart); short ones keep the plain loop.
      const decideLoop = () => {
        if (this.opts.static || !(video.duration > 2)) {
          video.loop = true;
          keepPlaying(video);
          return;
        }
        video.loop = false;
        const twin = makeVideo();
        twin.style.opacity = "0";
        el.appendChild(twin);
        seamlessLoop(video, twin);
      };
      if (video.readyState >= 1) decideLoop();
      else video.addEventListener("loadedmetadata", decideLoop, { once: true });
      return true;
    }
    if (src) {
      const img = d.createElement("img");
      img.className = "mtl-img mtl-media";
      img.decoding = "async";
      img.alt = "";
      img.src = src;
      img.style.objectFit = s.fit || "cover";
      el.appendChild(img);
      return true;
    }
    return false;
  }

  /** Darkness over a layer's picture / video (style.dim, percent). */
  private appendDim(el: HTMLElement, s: ThemeLayer["style"]) {
    if (!(s.src || s.videoSrc) || !s.dim) return;
    const dim = this.doc.createElement("div");
    dim.className = "mtl-dim";
    dim.style.background = `rgba(0,0,0,${Math.min(100, Math.max(0, s.dim)) / 100})`;
    el.appendChild(dim);
  }

  private createNode(layer: ThemeLayer): LayerNode {
    const d = this.doc;
    const s = layer.style || {};
    const pos = d.createElement("div");
    pos.className = "mtl-pos";
    pos.dataset.layerId = layer.id;
    const [sx, sy] = ANCHOR_SHIFT[layer.anchor] || ANCHOR_SHIFT["top-left"];
    const auto = layer.h === "auto";
    const hug = layer.type === "text" && s.hug === true;
    Object.assign(pos.style, {
      left: `${layer.x}px`,
      top: `${layer.y}px`,
      width: hug ? "max-content" : `${Math.max(1, layer.w)}px`,
      maxWidth: hug ? `${Math.max(1, layer.w)}px` : "",
      height: auto ? "auto" : `${Math.max(1, layer.h as number)}px`,
      transform: `translate(${sx}%, ${sy}%)${layer.rotation ? ` rotate(${layer.rotation}deg)` : ""}`,
      opacity: String(layer.opacity ?? 1),
    } as Partial<CSSStyleDeclaration>);

    const el = d.createElement("div");
    el.className = auto ? "mtl-el is-auto" : "mtl-el";
    const es = el.style;
    if (s.radius) es.borderRadius = `${s.radius}px`;
    if (s.borderWidth) es.border = `${s.borderWidth}px solid ${s.borderColor || "rgba(255,255,255,.2)"}`;
    if (s.shadow) es.boxShadow = s.shadow;
    if (s.clipPath) es.clipPath = s.clipPath;
    if (s.backdropBlur) {
      es.setProperty("backdrop-filter", `blur(${s.backdropBlur}px)`);
      es.setProperty("-webkit-backdrop-filter", `blur(${s.backdropBlur}px)`);
    }
    pos.appendChild(el);

    let surface: HTMLDivElement | null = null;
    let shine: HTMLDivElement | null = null;
    let bg = gradientCss(layer) || s.fill || "";
    if (!bg && layer.type === "box" && (s.progress === "elapsed" || s.progress === "remaining" || s.progress === "zones")) bg = WARN_DEFAULTS.green;
    if (bg && layer.type !== "image") {
      surface = d.createElement("div");
      // The double-width surface is only needed while a drift loop pans it.
      surface.className = this.opts.loops && layer.loop?.preset === "drift" ? "mtl-surface is-drift" : "mtl-surface";
      surface.style.background = bg;
      el.appendChild(surface);
    }
    // Box layers can carry a picture or video over their fill (Theme Editor → Background).
    if (layer.type === "box" && (s.src || s.videoSrc) && this.appendMedia(el, s)) {
      es.overflow = "hidden";
    }
    if (layer.type === "box") this.appendDim(el, s);
    if (this.opts.loops && layer.loop?.preset === "shimmer") {
      shine = d.createElement("div");
      shine.className = "mtl-shine";
      el.appendChild(shine);
    }

    let text: HTMLDivElement | null = null;
    if (layer.type === "image") {
      this.appendMedia(el, s);
      this.appendDim(el, s);
    } else if (layer.type === "text") {
      text = d.createElement("div");
      text.className = "mtl-text";
      const ts = text.style;
      const [pt, pr, pb, pl] = s.padding || [0, 0, 0, 0];
      ts.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
      ts.justifyContent = s.verticalAlign === "top" ? "flex-start" : s.verticalAlign === "bottom" ? "flex-end" : "center";
      ts.textAlign = s.align || "left";
      ts.color = s.color || "#ffffff";
      ts.fontFamily = s.fontFamily ? `"${s.fontFamily}", system-ui, sans-serif` : "system-ui, sans-serif";
      ts.fontSize = `${s.fontSize || 40}px`;
      ts.fontWeight = String(s.fontWeight || 400);
      ts.fontStyle = s.italic ? "italic" : "normal";
      ts.lineHeight = String(s.lineHeight || 1.3);
      if (s.letterSpacing) ts.letterSpacing = `${s.letterSpacing}px`;
      if (s.textTransform) ts.textTransform = s.textTransform;
      if (s.textShadow) ts.textShadow = s.textShadow;
      if (s.nowrap) text.classList.add("is-nowrap");
      if (s.segment) text.classList.add("is-segment");
      if (s.flip) pos.style.perspective = "900px";
      if (s.roughen) ts.filter = `url(#${ensureRoughFilter(d, s.roughen)})`;
      if (s.underline) {
        ts.textDecoration = "underline";
        ts.textUnderlineOffset = "0.18em";
        ts.setProperty("text-decoration-thickness", "0.07em");
      }
      el.appendChild(text);
    }

    return {
      layer,
      pos,
      el,
      surface,
      shine,
      text,
      usesTokens: layer.type === "text" && hasTokens(layer.content),
      isVerse: layer.type === "text" && isVerseTextPattern(layer.content),
      lastValue: "\u0000",
      empty: false,
      heading: null,
      loopAnims: [],
    };
  }

  // ───────────────────────────── content ─────────────────────────────

  private valueFor(n: LayerNode, tokens: ResolvedTokens, content: ThemeContent): string {
    if (n.layer.type !== "text") return "";
    if (n.heading === "text" && this.layout?.showHeading === false) return "";
    if (n.isVerse) return `${content.lineCount ?? ""}|${content.stackLines ? "s" : ""}|${tokens[verseTokenKey(n.layer.content)] ?? ""}`;
    return fillTokens(n.layer.content || "", tokens);
  }

  private applyAllContent(content: ThemeContent) {
    const tokens = resolveTokens(content);
    for (const n of this.nodes) this.applyContent(n, tokens, content);
    this.syncHeadingDecor(this.headingEmpty(tokens, content));
    this.applyLive(content.live);
  }

  /** The heading is empty when it's switched off or every heading text is blank. */
  private headingEmpty(tokens: ResolvedTokens, content: ThemeContent): boolean {
    if (this.layout?.showHeading === false) return true;
    const texts = this.nodes.filter((n) => n.heading === "text");
    if (!texts.length) return false;
    return texts.every((n) => n.layer.hideWhenEmpty !== false && this.valueFor(n, tokens, content).trim() === "");
  }

  /** Boxes / lines behind the heading follow it: hidden with no label, shown with one. */
  private syncHeadingDecor(empty: boolean) {
    for (const n of this.nodes) {
      if (n.heading !== "decor") continue;
      n.empty = empty;
      n.pos.classList.toggle("mtl-hidden", empty);
    }
    this.giveHeadingSpaceToVerse(empty);
  }

  /**
   * With no heading (a song has no reference), the words take over the room the heading had above
   * them, so a lower-third box is not left with an empty strip at the top and full-screen words
   * centre on the screen. Only for words in the same box as the heading (or, on their own, words
   * centred in their area), so a layout that keeps its words at a fixed line does not move.
   */
  private giveHeadingSpaceToVerse(empty: boolean) {
    const headings = this.nodes.filter((n) => n.heading === "text");
    for (const verse of this.nodes) {
      if (!verse.isVerse || typeof verse.layer.h !== "number") continue;
      const v = verse.layer;
      const [, vsy] = ANCHOR_SHIFT[v.anchor] || ANCHOR_SHIFT["top-left"];
      const vh = v.h as number;
      const vTop = v.y + (vsy / 100) * vh;
      const above = headings
        .map((h) => {
          const [, hsy] = ANCHOR_SHIFT[h.layer.anchor] || ANCHOR_SHIFT["top-left"];
          const hh = typeof h.layer.h === "number" ? h.layer.h : 0;
          return { node: h, top: h.layer.y + (hsy / 100) * hh };
        })
        .filter(({ node, top }) => (node.layer.parentId ?? "") === (v.parentId ?? "")
          && top < vTop
          && node.layer.x < v.x + v.w && v.x < node.layer.x + node.layer.w);
      const inBox = Boolean(v.parentId);
      const centred = (v.style?.verticalAlign ?? "middle") !== "top";
      const top = above.length && (inBox || centred) ? Math.min(...above.map((a) => a.top)) : null;
      // The layer itself keeps its place (other fitting may move it); only its inside reaches up.
      const scaleY = (Number.parseFloat(verse.pos.style.height) || vh) / vh;
      const reach = empty && top !== null ? Math.max(0, vTop - Math.max(0, top)) * scaleY : 0;
      const es = verse.el.style;
      const next = reach > 0 ? `-${reach}px` : "";
      if (es.marginTop === next) continue;
      es.marginTop = next;
      es.height = reach > 0 ? `calc(100% + ${reach}px)` : "";
      if (!verse.empty && verse.lastValue !== "\u0000") this.fitText(verse);
    }
  }

  private applyContent(n: LayerNode, tokens: ResolvedTokens, content: ThemeContent) {
    if (n.layer.type !== "text" || !n.text) return;
    const value = this.valueFor(n, tokens, content);
    if (value === n.lastValue) return;
    const previous = n.lastValue;
    n.lastValue = value;
    const d = this.doc;
    const s = n.layer.style;
    if (s.segment) {
      n.text.innerHTML = value ? segmentSvg(value, s.segment, s.align || "center") : "";
      n.empty = value.length === 0 && n.layer.hideWhenEmpty !== false;
      n.pos.classList.toggle("mtl-hidden", n.empty);
      return;
    }
    const split = isSplitPreset(n.layer.in.preset) || isSplitPreset(n.layer.out.preset);
    const lineRise = n.layer.in.preset === "line-rise" || n.layer.out.preset === "line-rise";
    const inner = d.createElement("div");
    inner.className = "mtl-text-inner";

    const appendWords = (parent: HTMLElement, body: string) => {
      if (!split || lineRise) {
        parent.appendChild(d.createTextNode(body));
        return;
      }
      const parts = body.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          parent.appendChild(d.createTextNode(" "));
        } else {
          const w = d.createElement("span");
          w.className = "mtl-w";
          w.textContent = part;
          parent.appendChild(w);
        }
      }
    };

    // *Important words*: coloured and bolder, in the theme's own highlight colour.
    const emColor = emphasisColorFor(this.layout, n.layer);
    const emWeight = emphasisWeightFor(s);
    const appendRich = (parent: HTMLElement, body: string) => {
      for (const part of parseEmphasis(body)) {
        if (!part.em) {
          appendWords(parent, part.text);
          continue;
        }
        const em = d.createElement("span");
        em.className = "mtl-em";
        em.style.color = part.color ?? emColor;
        em.style.fontWeight = String(emWeight);
        appendWords(em, part.text);
        parent.appendChild(em);
      }
    };

    let isEmpty: boolean;
    if (n.isVerse) {
      const lines = splitVerseLines(tokens[verseTokenKey(n.layer.content)] ?? "", content.lineCount);
      isEmpty = lines.length === 0;
      lines.forEach((line, i) => {
        const span = d.createElement("span");
        const stack = Boolean(content.stackLines);
        span.className = lineRise ? "mtl-line is-block" : stack ? "mtl-line is-block is-stack" : "mtl-line";
        if (line.number && s.verseNumbers !== false) {
          const num = d.createElement("sup");
          num.className = "mtl-num";
          num.textContent = line.number;
          if (s.verseNumberColor) num.style.color = s.verseNumberColor;
          span.appendChild(num);
        }
        appendRich(span, line.body);
        if (!lineRise && !stack && i < lines.length - 1) span.appendChild(d.createTextNode(" "));
        inner.appendChild(span);
      });
    } else {
      isEmpty = value.length === 0;
      if (lineRise) {
        const span = d.createElement("span");
        span.className = "mtl-line is-block";
        appendRich(span, value);
        inner.appendChild(span);
      } else {
        appendRich(inner, value);
      }
    }

    n.text.replaceChildren(inner);
    n.empty = isEmpty && n.layer.hideWhenEmpty !== false;
    n.pos.classList.toggle("mtl-hidden", n.empty);
    if (!n.empty) this.fitText(n);
    if (s.flip && previous !== "\u0000" && !this.opts.static && !n.empty) {
      n.text.animate(
        [{ transform: "rotateX(-80deg)", opacity: 0.25 }, { transform: "rotateX(0deg)", opacity: 1 }],
        { duration: 260, easing: "ease-out" },
      );
    }
  }

  // ───────────────────────────── timer (countdown designs) ─────────────────────────────

  /**
   * Timer tick: swaps changed text and updates warning colours and progress bars
   * with no in/out animation. Use after the first show().
   */
  updateLive(content: ThemeContent) {
    this.content = content;
    const tokens = resolveTokens(content);
    for (const n of this.nodes) this.applyContent(n, tokens, content);
    this.applyLive(content.live);
  }

  /** Colours and sizes that follow the timer: warn colours, progress bars, markers, zones. */
  private applyLive(live?: ThemeLive) {
    for (const n of this.nodes) {
      const s = n.layer.style;
      if (s.warn) {
        const level = live?.level;
        const color = level ? s.warnColors?.[level] ?? WARN_DEFAULTS[level] : "";
        if (s.warn === "text" && n.text) n.text.style.color = color || s.color || "#ffffff";
        else if (s.warn === "fill" && n.surface) n.surface.style.background = color || gradientCss(n.layer) || s.fill || "";
        else if (s.warn === "border") n.el.style.borderColor = color || s.borderColor || "rgba(255,255,255,.2)";
      }
      if (!s.progress) continue;
      const frac = Math.min(1, Math.max(0, live?.fraction ?? 0));
      if (s.progress === "elapsed" && n.surface) n.surface.style.width = `${(frac * 100).toFixed(2)}%`;
      else if (s.progress === "remaining" && n.surface) n.surface.style.width = `${((1 - frac) * 100).toFixed(2)}%`;
      else if (s.progress === "marker") n.pos.style.left = `${(frac * 100).toFixed(2)}%`;
      else if (s.progress === "zones" && n.surface) {
        const y = live?.yellowFrom;
        const r = live?.redFrom;
        const g = s.warnColors?.green ?? WARN_DEFAULTS.green;
        const yc = s.warnColors?.yellow ?? WARN_DEFAULTS.yellow;
        const rc = s.warnColors?.red ?? WARN_DEFAULTS.red;
        const yp = y === undefined ? 100 : Math.min(100, Math.max(0, y * 100));
        const rp = r === undefined ? 100 : Math.min(100, Math.max(yp, r * 100));
        n.surface.style.background = `linear-gradient(90deg, ${g} 0%, ${g} ${yp}%, ${yc} ${yp}%, ${yc} ${rp}%, ${rc} ${rp}%, ${rc} 100%)`;
      }
    }
  }

  /** Shrinks the font until the text fits its box (fixed height) or maxLines (auto height). */
  private fitText(n: LayerNode) {
    const t = n.text;
    if (!t) return;
    const s = n.layer.style;
    const max = s.fontSize || 40;
    const min = Math.max(8, s.minFontSize || Math.round(max * 0.6));
    const lh = s.lineHeight || 1.3;
    const [pt, , pb] = s.padding || [0, 0, 0, 0];
    const fixed = n.layer.h !== "auto";
    const limitFor = (size: number) =>
      fixed ? (n.layer.h as number) - pt - pb : s.maxLines ? s.maxLines * lh * size + 1 : Infinity;
    const inner = t.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const nowrap = s.nowrap === true;
    const padX = (s.padding?.[1] ?? 0) + (s.padding?.[3] ?? 0);
    const fits = (size: number) => {
      t.style.fontSize = `${size}px`;
      const widthOk = !nowrap || inner.scrollWidth <= Math.max(1, n.layer.w - padX) + 1;
      return widthOk && inner.offsetHeight <= limitFor(size) + 1;
    };
    if ((!nowrap && limitFor(max) === Infinity) || fits(max)) {
      t.style.fontSize = `${max}px`;
      return;
    }
    // minFontSize is a preferred floor, not a hard one: in a fixed box a long
    // verse with a big size or line-height would otherwise be cut off mid-line.
    let lo = min;
    let hi = max;
    if (fixed && !fits(min)) {
      lo = 8;
      hi = min;
    }
    for (let i = 0; i < 8 && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    t.style.fontSize = `${lo}px`;
  }

  // ───────────────────────────── motion ─────────────────────────────

  private animate(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
    const h = el as HTMLElement;
    h.style.willChange = "transform, opacity";
    const anim = h.animate(frames, opts);
    this.running.push(anim);
    // "out" animations hold their last frame (fill: forwards), so they stay
    // tracked until the next in/hide cancels them. "in" animations are
    // released as soon as they finish.
    const holds = opts.fill === "forwards";
    const clear = () => {
      h.style.willChange = "";
      if (!holds) this.running = this.running.filter((a) => a !== anim);
    };
    anim.finished.then(clear, clear);
    return anim;
  }

  private animateNode(n: LayerNode, anim: LayerAnimation, dir: "in" | "out", speed: number): Animation[] {
    if (this.opts.static || anim.preset === "none" || anim.duration <= 0) return [];
    const scaled: LayerAnimation = { ...anim, duration: anim.duration * speed, delay: anim.delay * speed };
    const out: Animation[] = [];
    const frames = layerKeyframes(anim.preset, anim.distance ?? 40);
    if (frames) {
      const layerTiming = isSplitPreset(anim.preset)
        ? { ...scaled, duration: Math.min(180, scaled.duration) }
        : scaled;
      out.push(this.animate(n.el, frames, timing(layerTiming, dir)));
    }
    if (isSplitPreset(anim.preset) && n.text) {
      const parts = n.text.querySelectorAll(anim.preset === "line-rise" ? ".mtl-line" : ".mtl-w");
      const stagger = (anim.stagger ?? 35) * speed;
      const count = parts.length;
      parts.forEach((part, i) => {
        // Out plays last word first so the text "unwinds".
        const idx = dir === "in" ? i : count - 1 - i;
        out.push(this.animate(part, splitKeyframes((anim.distance ?? 18) * 0.6), timing(scaled, dir, idx * stagger)));
      });
    }
    return out;
  }

  private async playIn(nodes: LayerNode[], speed = 1) {
    this.stage.classList.add("is-visible");
    const wasVisible = this.visibleState;
    this.visibleState = true;
    // Cancel any held "out" frames on these nodes so the in starts clean.
    this.cancelOn(nodes);
    const anims: Animation[] = [];
    for (const n of nodes) {
      if (n.empty) continue;
      anims.push(...this.animateNode(n, n.layer.in, "in", speed));
    }
    if (!wasVisible) this.startLoops();
    await finished(anims);
  }

  private async playOut(nodes: LayerNode[], speed = 1) {
    if (!nodes.length) return;
    const outs = nodes.filter((n) => !n.empty).map((n) => n.layer.out);
    if (!totalDuration(outs)) return;
    this.cancelOn(nodes);
    const anims: Animation[] = [];
    for (const n of nodes) {
      if (n.empty) continue;
      anims.push(...this.animateNode(n, n.layer.out, "out", speed));
    }
    await finished(anims);
  }

  private cancelOn(nodes: LayerNode[]) {
    const els = new Set<Element>();
    for (const n of nodes) {
      els.add(n.el);
      n.text?.querySelectorAll(".mtl-w,.mtl-line").forEach((e) => els.add(e));
    }
    this.running = this.running.filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (target && els.has(target)) {
        a.cancel();
        return false;
      }
      return true;
    });
  }

  private cancelRunning() {
    const all = this.running;
    this.running = [];
    for (const a of all) a.cancel();
  }

  private startLoops() {
    if (this.opts.static || !this.opts.loops) return;
    for (const n of this.nodes) {
      const loop = n.layer.loop;
      if (!loop || loop.preset === "none") continue;
      if (n.loopAnims.length) {
        n.loopAnims.forEach((a) => a.play());
        continue;
      }
      const frames = loopKeyframes(loop.preset);
      const target = loop.preset === "shimmer" ? n.shine : n.surface;
      if (!frames || !target) continue;
      n.loopAnims.push(
        target.animate(frames, {
          duration: Math.max(800, loop.duration || 8000),
          iterations: Infinity,
          direction: loop.preset === "shimmer" ? "normal" : "alternate",
          easing: "ease-in-out",
        }),
      );
    }
  }

  private stopLoops() {
    for (const n of this.nodes) n.loopAnims.forEach((a) => a.pause());
  }
  /** Waits for fonts and images so the first "in" never shows fallback fonts. */
  private async preloadAssets(layout: ThemeLayout): Promise<void> {
    const doc = this.doc;
    const mediaReady = this.mediaReady;
    const linkLoads: Promise<unknown>[] = [];
    for (const href of layout.fontImports || []) {
      const url = safeUrl(href);
      if (!url) continue;
      const existing = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[data-mtl-font]")).some((l) => l.dataset.mtlFont === url);
      if (existing) continue;
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.mtlFont = url;
      linkLoads.push(new Promise((r) => { link.onload = r; link.onerror = r; }));
      doc.head.appendChild(link);
    }
    await Promise.all(linkLoads);
    const loads: Promise<unknown>[] = [];
    for (const layer of layout.layers) {
      const s = layer.style || {};
      if (layer.type === "text" && s.fontFamily && doc.fonts?.load) {
        loads.push(doc.fonts.load(`${s.italic ? "italic " : ""}${s.fontWeight || 400} 32px "${s.fontFamily}"`).catch(() => undefined));
      }
      if ((layer.type === "image" || layer.type === "box") && s.src && !s.videoSrc) {
        const src = safeUrl(this.opts.resolveAsset ? this.opts.resolveAsset(s.src) : s.src);
        if (src) {
          const img = new Image();
          img.src = src;
          loads.push(img.decode().catch(() => undefined));
        }
      }
    }
    loads.push(...mediaReady);
    await Promise.all(loads);
    await nextFrame();
    // Fonts may have changed metrics: refit what's on screen.
    for (const n of this.nodes) if (n.text && !n.empty && n.lastValue !== "\u0000") this.fitText(n);
  }
}
