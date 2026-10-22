/**
 * usageTracker.ts — which pages people open and which buttons they click, in the desktop app and in
 * the OBS docks. Read by the admin Analytics page and the user profile ("App usage").
 *
 *   view   a page (or dock tab) was opened
 *   dwell  the page was left after N milliseconds (time spent)
 *   click  a button / link / tab was clicked: its label and the area of the screen it is in
 *
 * Events are batched and sent to /api/tracking/usage with the same identity as the other tracking
 * (the signed-in user, or the paired device). Fire-and-forget: it never blocks or breaks the UI.
 *
 * Privacy: only page names and the label of the control that was clicked. Never typed text, and never
 * the text of list rows or anything inside an element marked `data-track-private` (Bible text, lyrics,
 * transcripts, song names). Mark any container whose text is content with `data-track-private`, and
 * anything that should not be counted at all with `data-track-ignore`. Give a button a stable name for
 * the admin with `data-track="send-to-screen"`, and a region with `data-track-area="Studio preview"`.
 */

import { APP_VERSION } from "./authService";
import { getTrackingIdentity } from "./tracking";

export type UsageSurface = "app" | "dock" | "lm-dock";

interface UsageEvent {
  type: "view" | "dwell" | "click";
  page: string;
  ts: number;
  label?: string;
  area?: string;
  durationMs?: number;
}

const FLUSH_EVERY_MS = 15_000;
const BATCH_SIZE = 50;
const QUEUE_LIMIT = 500;
const MAX_LABEL = 40;
const CLICK_DEDUPE_MS = 250;

// ── Pure helpers (also used by the tests) ───────────────────────────────────

/** /transcripts/6720ab… becomes /transcripts/:id, so every record of a kind counts as one page. */
export function normalizeUsagePage(path: string): string {
  const clean = String(path || "/").split(/[?#]/)[0] || "/";
  const segments = clean.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^[0-9a-f]{12,}$/i.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
    if (/^\d{3,}$/.test(segment)) return ":id";
    return segment;
  });
  const joined = segments.join("/") || "/";
  return joined.length > 1 ? joined.replace(/\/+$/, "") : joined;
}

/** The text a person sees on a control, cut down. Long text is probably content, so it is not sent. */
export function cleanUsageLabel(text: string | null | undefined): string {
  const label = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!label) return "";
  // A button that shows a person's email (an account menu) must not send it.
  if (label.includes("@")) return "(account)";
  return label.length > MAX_LABEL ? "(long text)" : label;
}

/** Rows of a list or table are content (song titles, verses, names), not controls. */
export function isContentRole(role: string | null | undefined): boolean {
  return role === "option" || role === "row" || role === "gridcell" || role === "listitem" || role === "treeitem";
}

// ── State ───────────────────────────────────────────────────────────────────

let started = false;
let surface: UsageSurface = "app";
let sessionId = "";
let currentPage = "";
let pageOpenedAt = 0;
let queue: UsageEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let lastClick = { key: "", at: 0 };

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function osName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/windows/i.test(ua)) return "windows";
  if (/mac/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "other";
}

function push(event: UsageEvent): void {
  queue.push(event);
  if (queue.length > QUEUE_LIMIT) queue = queue.slice(queue.length - QUEUE_LIMIT);
  if (queue.length >= BATCH_SIZE) void flushUsage();
}

/** Finishes the page that was open: records how long it was on screen. */
function closeCurrentPage(now = Date.now()): void {
  if (currentPage && pageOpenedAt > 0) {
    const durationMs = now - pageOpenedAt;
    if (durationMs >= 500) push({ type: "dwell", page: currentPage, ts: pageOpenedAt, durationMs });
  }
  pageOpenedAt = 0;
}

/** Tell the tracker which page / dock tab is showing now. Safe to call often. */
export function setUsagePage(page: string): void {
  if (!started) return;
  const next = normalizeUsagePage(page);
  if (next === currentPage) return;
  const now = Date.now();
  closeCurrentPage(now);
  currentPage = next;
  pageOpenedAt = now;
  push({ type: "view", page: next, ts: now });
}

// ── Clicks ──────────────────────────────────────────────────────────────────

const INTERACTIVE =
  'button, a, summary, select, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="button"], input[type="submit"]';

function areaOf(el: Element): string {
  const marked = el.closest("[data-track-area]");
  if (marked) return cleanUsageLabel(marked.getAttribute("data-track-area"));
  const region = el.closest('section[aria-label], nav[aria-label], aside[aria-label], [role="dialog"][aria-label], [role="tablist"][aria-label], [role="dialog"][aria-labelledby]');
  if (!region) return "";
  const named = region.getAttribute("aria-label");
  if (named) return cleanUsageLabel(named);
  const titleId = region.getAttribute("aria-labelledby");
  const title = titleId ? document.getElementById(titleId) : null;
  return cleanUsageLabel(title?.textContent);
}

function labelOf(el: Element): string {
  const explicit = el.getAttribute("data-track");
  if (explicit) return cleanUsageLabel(explicit);
  if (isContentRole(el.getAttribute("role")) || el.closest("[data-track-private], [role=\"listbox\"], table")) return "(list item)";
  const aria = el.getAttribute("aria-label");
  if (aria) return cleanUsageLabel(aria);
  // A dropdown's text is all of its options; name it by its label instead.
  if (el instanceof HTMLSelectElement) return cleanUsageLabel(el.getAttribute("title")) || cleanUsageLabel(el.getAttribute("name")) || "(dropdown)";
  const text = cleanUsageLabel(el.textContent);
  if (text) return text;
  return cleanUsageLabel(el.getAttribute("title")) || cleanUsageLabel(el.getAttribute("name")) || "(icon)";
}

function onClick(event: MouseEvent): void {
  try {
    if (!currentPage || !(event.target instanceof Element)) return;
    const el = event.target.closest(INTERACTIVE);
    if (!el || el.closest("[data-track-ignore]")) return;
    if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "text")) return;
    const label = labelOf(el);
    const area = areaOf(el);
    const key = `${currentPage}|${area}|${label}`;
    const now = Date.now();
    if (key === lastClick.key && now - lastClick.at < CLICK_DEDUPE_MS) return;
    lastClick = { key, at: now };
    push({ type: "click", page: currentPage, ts: now, label, area });
  } catch {
    // Tracking must never interrupt a click.
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** Send what is queued. `final` keeps the request alive while the window closes. */
export async function flushUsage(final = false): Promise<void> {
  if (sending || queue.length === 0) return;
  const { userId, headers, apiBase } = getTrackingIdentity();
  // No account or no server yet (before sign-in): keep the events and try again later.
  if (!apiBase || (!userId && !headers["X-Device-Id"])) return;

  const batch = queue.slice(0, BATCH_SIZE);
  queue = queue.slice(batch.length);
  sending = true;
  try {
    const response = await fetch(`${apiBase}/api/tracking/usage`, {
      method: "POST",
      headers,
      keepalive: final,
      body: JSON.stringify({ surface, sessionId, appVersion: APP_VERSION, os: osName(), userId, events: batch }),
    });
    // A rejected batch (bad data) is dropped; a server or network problem is retried.
    if (!response.ok && response.status >= 500) queue = [...batch, ...queue].slice(-QUEUE_LIMIT);
  } catch {
    queue = [...batch, ...queue].slice(-QUEUE_LIMIT);
  } finally {
    sending = false;
  }
}

function onHidden(): void {
  closeCurrentPage();
  void flushUsage(true);
}

function onVisible(): void {
  // Back on the same page: time starts counting again (this is not a new view).
  if (currentPage && pageOpenedAt === 0) pageOpenedAt = Date.now();
}

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe: (listener: (state: { location: { pathname: string } }) => void) => () => void;
}

/**
 * Start tracking for this window. Call once at start-up.
 * The app passes its router (pages follow the route); the docks call setUsagePage themselves.
 */
export function startUsageTracking(which: UsageSurface, options: { router?: RouterLike } = {}): void {
  if (started || typeof window === "undefined" || typeof document === "undefined") return;
  started = true;
  surface = which;
  sessionId = newSessionId();

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHidden();
    else onVisible();
  });
  window.addEventListener("pagehide", onHidden);
  flushTimer = setInterval(() => { void flushUsage(); }, FLUSH_EVERY_MS);

  if (options.router) {
    setUsagePage(options.router.state.location.pathname);
    options.router.subscribe((state) => setUsagePage(state.location.pathname));
  }
}

/** For tests and hot reload. */
export function stopUsageTracking(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  started = false;
  currentPage = "";
  pageOpenedAt = 0;
  queue = [];
}
