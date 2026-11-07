/**
 * broadcastGraphicsCatalog.ts — the admin-controlled Broadcast Graphics catalog.
 *
 * The admin portal (Admin → Broadcast Graphics) decides, for every graphic:
 *   • status   — "active" (listed and usable), "paused" (listed, can't be used),
 *                "hidden" (not listed at all)
 *   • tiers    — who may use it: free users, paid plans, ambassadors
 *   • packages — new graphics uploaded as an "mce-graphic@1" package (no app update needed)
 *   • tickers  — the same controls for tickers (kind "ticker"); new tickers come as "mce-ticker@1"
 *
 * The app downloads the catalog whenever it is online (on start, when the connection comes
 * back, when the window regains focus, and every 30 minutes) and keeps the last copy. With
 * no connection the last copy is used, so graphics keep working offline. Before the first
 * download every bundled graphic is available, exactly as before.
 */
import { getEnvConfig } from "./envConfig";
import { getUserScopedKey } from "./userScopedStorage";
import { packageThemeId, packageToTheme, type GraphicPackage } from "../lowerthirds/graphicPackages";
import { BUNDLED_GRAPHIC_PACKAGES } from "../lowerthirds/bundledGraphicPackages";
import type { LowerThirdTheme } from "../lowerthirds/types";
import type { TickerTheme } from "../data/tickerThemes";

export type GraphicStatus = "active" | "paused" | "hidden";
export type GraphicAudience = "free" | "paid" | "ambassador" | "admin";
export type GraphicKind = "graphic" | "ticker";

/** An admin-uploaded ticker, in the same shape as the app's bundled HTML tickers. */
export interface TickerPackage {
  format: "mce-ticker@1";
  id: string;
  version?: number;
  name: string;
  description?: string;
  color?: string;
  badge?: string;
  tickerText?: string;
  speed?: string;
  html: string;
  css?: string;
  fontImports?: string[];
  variables?: TickerTheme["variables"];
}

export interface GraphicTiers {
  free: boolean;
  paid: boolean;
  ambassador: boolean;
}

export interface BroadcastGraphicCatalogEntry {
  graphicId: string;
  /** Missing in catalogs cached before tickers were added: a graphic. */
  kind?: GraphicKind;
  source: "builtin" | "package";
  status: GraphicStatus;
  tiers: GraphicTiers;
  access: "allowed" | "locked";
  name?: string;
  category?: string;
  sortOrder?: number;
  version?: number;
  updatedAt?: string;
  package?: GraphicPackage | TickerPackage | null;
}

export interface BroadcastGraphicsCatalog {
  fetchedAt: number;
  audience: GraphicAudience;
  graphics: BroadcastGraphicCatalogEntry[];
}

export interface GraphicAvailability {
  /** Listed in the library (not hidden by the admin). */
  visible: boolean;
  /** Can be customised, added to OBS and sent live. */
  usable: boolean;
  reason: null | "paused" | "locked";
  tiers: GraphicTiers;
}

export const BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT = "broadcast-graphics-catalog-updated";
export const DOCK_GRAPHICS_POLICY_FILE = "dock-broadcast-graphics";

const STORAGE_KEY = "mce-broadcast-graphics-catalog.v1";
const REFRESH_EVERY_MS = 30 * 60 * 1000;
const FOCUS_REFRESH_MIN_MS = 5 * 60 * 1000;
const ALL_TIERS: GraphicTiers = { free: true, paid: true, ambassador: true };

let memory: BroadcastGraphicsCatalog | null | undefined;
let inFlight: Promise<BroadcastGraphicsCatalog | null> | null = null;
let started = false;

function storageKey(): string {
  try {
    return getUserScopedKey(STORAGE_KEY);
  } catch {
    return STORAGE_KEY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTiers(value: unknown): GraphicTiers {
  if (!isRecord(value)) return { ...ALL_TIERS };
  return { free: value.free !== false, paid: value.paid !== false, ambassador: value.ambassador !== false };
}

function normalizeEntry(raw: unknown): BroadcastGraphicCatalogEntry | null {
  if (!isRecord(raw)) return null;
  const graphicId = typeof raw.graphicId === "string" ? raw.graphicId.trim() : "";
  if (!graphicId) return null;
  const source = raw.source === "package" ? "package" : "builtin";
  const status: GraphicStatus = raw.status === "paused" || raw.status === "hidden" ? raw.status : "active";
  const kind: GraphicKind = raw.kind === "ticker" ? "ticker" : "graphic";
  const pkg = isRecord(raw.package) && typeof raw.package.html === "string" && typeof raw.package.id === "string"
    ? (raw.package as unknown as GraphicPackage | TickerPackage)
    : null;
  if (source === "package" && !pkg) return null;
  return {
    graphicId,
    kind,
    source,
    status,
    tiers: normalizeTiers(raw.tiers),
    access: raw.access === "locked" ? "locked" : "allowed",
    name: typeof raw.name === "string" ? raw.name : undefined,
    category: typeof raw.category === "string" ? raw.category : undefined,
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : undefined,
    version: typeof raw.version === "number" ? raw.version : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    package: pkg,
  };
}

function normalizeCatalog(raw: unknown): BroadcastGraphicsCatalog | null {
  if (!isRecord(raw) || !Array.isArray(raw.graphics)) return null;
  const audience = ["free", "paid", "ambassador", "admin"].includes(String(raw.audience))
    ? (raw.audience as GraphicAudience)
    : "free";
  return {
    fetchedAt: typeof raw.fetchedAt === "number" ? raw.fetchedAt : Date.now(),
    audience,
    graphics: raw.graphics.map(normalizeEntry).filter((e): e is BroadcastGraphicCatalogEntry => !!e),
  };
}

/** The last downloaded catalog, or null before the first successful download. */
export function getBroadcastGraphicsCatalog(): BroadcastGraphicsCatalog | null {
  if (memory !== undefined) return memory;
  memory = null;
  if (typeof localStorage === "undefined") return memory;
  try {
    const raw = localStorage.getItem(storageKey());
    memory = raw ? normalizeCatalog(JSON.parse(raw)) : null;
  } catch {
    memory = null;
  }
  return memory;
}

function saveCatalog(catalog: BroadcastGraphicsCatalog): void {
  memory = catalog;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(catalog));
  } catch {
    // Storage full: the in-memory copy still applies for this session.
  }
}

/** The theme id the app uses for an uploaded ticker. */
export function tickerPackageThemeId(packageId: string): string {
  return `ticker-pkg-${String(packageId).replace(/[^\w-]/g, "")}`;
}

/** The theme id the app uses for a catalog entry (bundled id, or the package's theme id). */
export function catalogThemeId(entry: Pick<BroadcastGraphicCatalogEntry, "graphicId" | "kind" | "source">): string {
  if (entry.source !== "package") return entry.graphicId;
  return entry.kind === "ticker" ? tickerPackageThemeId(entry.graphicId) : packageThemeId(entry.graphicId);
}

function entryForTheme(catalog: BroadcastGraphicsCatalog | null, themeId: string): BroadcastGraphicCatalogEntry | undefined {
  if (!catalog) return undefined;
  return catalog.graphics.find((g) => catalogThemeId(g) === themeId);
}

/**
 * Bundled lower thirds that moved to the Tickers section, hidden like a retired ticker even
 * before the admin catalog arrives. "lt-stream-ticker" (News Ticker Bar) is now "ticker-news-bar".
 */
const RETIRED_GRAPHIC_THEME_IDS: ReadonlySet<string> = new Set(["lt-stream-ticker"]);

/**
 * Uploaded tickers that are copies of a bundled one (the admin page's example file is the
 * Sunrise ticker). They are not listed twice; a saved pick of the copy uses the bundled ticker.
 */
const DUPLICATE_PACKAGE_TICKERS: Readonly<Record<string, string>> = {
  "starter-sunrise-ticker": "ticker-sunrise",
};

/** The bundled ticker an uploaded copy stands for (its package or theme id), if any. */
export function bundledTickerForPackage(id: string): string | undefined {
  const packageId = String(id || "").replace(/^ticker-pkg-/, "");
  return DUPLICATE_PACKAGE_TICKERS[packageId];
}

/** Whether a template (bundled theme id or package theme id) is listed and usable. */
export function getGraphicAvailability(themeId: string, catalog = getBroadcastGraphicsCatalog()): GraphicAvailability {
  if (RETIRED_GRAPHIC_THEME_IDS.has(themeId)) return { visible: false, usable: false, reason: null, tiers: { ...ALL_TIERS } };
  const entry = entryForTheme(catalog, themeId);
  if (!entry) {
    // Unknown to the admin catalog (or no catalog yet): bundled graphics stay available.
    return { visible: true, usable: true, reason: null, tiers: { ...ALL_TIERS } };
  }
  if (entry.status === "hidden") return { visible: false, usable: false, reason: null, tiers: entry.tiers };
  if (entry.status === "paused") return { visible: true, usable: false, reason: "paused", tiers: entry.tiers };
  if (entry.access === "locked") return { visible: true, usable: false, reason: "locked", tiers: entry.tiers };
  return { visible: true, usable: true, reason: null, tiers: entry.tiers };
}

/** Short text for a locked graphic, e.g. "Paid plans" or "Ambassadors". */
export function describeGraphicTiers(tiers: GraphicTiers): string {
  if (tiers.free) return "Everyone";
  const parts = [tiers.paid ? "paid plans" : "", tiers.ambassador ? "ambassadors" : ""].filter(Boolean);
  if (!parts.length) return "No one yet";
  const text = parts.join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Lower thirds built from graphic packages: the ones bundled with the app, then the
 * admin-published ones. A published package with the same id replaces the bundled one,
 * and a hidden catalog entry removes it.
 */
export function getPackageThemes(catalog = getBroadcastGraphicsCatalog()): LowerThirdTheme[] {
  const published = (catalog?.graphics ?? [])
    .filter((g) => g.kind !== "ticker" && g.source === "package" && g.package && g.status !== "hidden")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const publishedIds = new Set(published.map((g) => g.graphicId));
  const bundled = BUNDLED_GRAPHIC_PACKAGES
    .filter((pkg) => !publishedIds.has(pkg.id))
    .filter((pkg) => getGraphicAvailability(packageThemeId(pkg.id), catalog).visible)
    .map((pkg) => packageToTheme(pkg, { tags: ["Built-in"] }));
  return [
    ...bundled,
    ...published.map((g) => packageToTheme({ ...(g.package as GraphicPackage), id: g.graphicId, version: g.version ?? g.package?.version, updatedAt: g.updatedAt })),
  ];
}

/** Turn an uploaded ticker into the app's HTML ticker theme. */
export function tickerPackageToTheme(graphicId: string, pkg: TickerPackage): TickerTheme {
  return {
    id: tickerPackageThemeId(graphicId),
    name: pkg.name,
    description: pkg.description || "Ticker from Make Church Eazy.",
    accentColor: pkg.color || "#2563eb",
    badge: pkg.badge || "Announcements",
    tickerText: pkg.tickerText || "",
    speed: pkg.speed || "24s",
    html: pkg.html,
    css: pkg.css || "",
    // Only Google Fonts stylesheets (the server checks this too).
    fontImports: (pkg.fontImports || []).filter((u) => /^https:\/\/fonts\.googleapis\.com\//i.test(u)),
    variables: Array.isArray(pkg.variables) ? pkg.variables : [],
  };
}

/** Tickers for the admin-published ticker packages that are not hidden. */
export function getPackageTickers(catalog = getBroadcastGraphicsCatalog()): TickerTheme[] {
  if (!catalog) return [];
  return catalog.graphics
    .filter((g) => g.kind === "ticker" && g.source === "package" && g.package && g.status !== "hidden")
    .filter((g) => !bundledTickerForPackage(g.graphicId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g) => tickerPackageToTheme(g.graphicId, g.package as TickerPackage));
}

/** Theme ids (graphics and tickers) that must not be used right now (paused, hidden or not on the user's plan). */
export function getBlockedGraphicThemeIds(catalog = getBroadcastGraphicsCatalog()): string[] {
  if (!catalog) return [];
  return catalog.graphics
    .filter((g) => g.status !== "active" || g.access === "locked")
    .map((g) => catalogThemeId(g));
}

async function deviceHeaders(): Promise<Record<string, string>> {
  try {
    const { getDeviceId, getDeviceSecret } = await import("./authService");
    const id = getDeviceId();
    const secret = getDeviceSecret();
    return {
      ...(id ? { "X-Device-Id": id } : {}),
      ...(secret ? { "X-Device-Secret": secret } : {}),
    };
  } catch {
    return {};
  }
}

function apiBases(): string[] {
  const config = getEnvConfig();
  return Array.from(new Set([config.apiBaseUrl, config.authApiUrl].filter(Boolean).map((b) => b.replace(/\/+$/, ""))));
}

/** Write what the Dock needs (package themes + blocked ids) to its data folder. */
export async function syncGraphicsPolicyToDock(catalog = getBroadcastGraphicsCatalog()): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: DOCK_GRAPHICS_POLICY_FILE,
      data: JSON.stringify({
        blocked: getBlockedGraphicThemeIds(catalog),
        packageThemes: getPackageThemes(catalog),
        packageTickers: getPackageTickers(catalog),
      }),
    });
  } catch (err) {
    console.warn("[broadcastGraphicsCatalog] Failed to sync the graphics policy to the Dock:", err);
  }
}

async function afterCatalogChange(catalog: BroadcastGraphicsCatalog): Promise<void> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, { detail: { catalog } }));
  }
  await syncGraphicsPolicyToDock(catalog);
  try {
    // Saved graphics are re-synced so paused / locked ones leave the Dock.
    const { syncSavedGraphicsToDock } = await import("./broadcastGraphicsStorage");
    await syncSavedGraphicsToDock();
  } catch {
    // The saved graphics sync logs its own failures.
  }
}

/**
 * Download the catalog. Offline or on any error the last copy stays in place and is returned.
 */
export async function refreshBroadcastGraphicsCatalog(): Promise<BroadcastGraphicsCatalog | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const previous = getBroadcastGraphicsCatalog();
    if (typeof navigator !== "undefined" && navigator.onLine === false) return previous;
    const headers = await deviceHeaders();
    for (const base of apiBases()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${base}/api/broadcast-graphics`, { headers, cache: "no-store", signal: controller.signal });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        const catalog = normalizeCatalog({ ...body, fetchedAt: Date.now() });
        if (!catalog) continue;
        const changed = JSON.stringify(previous?.graphics ?? null) !== JSON.stringify(catalog.graphics)
          || previous?.audience !== catalog.audience;
        saveCatalog(catalog);
        if (changed) await afterCatalogChange(catalog);
        return catalog;
      } catch {
        // Try the next API base; the cached catalog remains valid.
      } finally {
        clearTimeout(timer);
      }
    }
    return previous;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Start keeping the catalog fresh. Safe to call more than once. */
export function startBroadcastGraphicsCatalog(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  let lastFocusRefresh = 0;
  const refresh = () => { void refreshBroadcastGraphicsCatalog(); };
  refresh();
  // Sign-in finishes after start-up; ask again once the device is known so plan access is right.
  window.setTimeout(refresh, 8_000);
  window.addEventListener("online", refresh);
  window.addEventListener("focus", () => {
    if (Date.now() - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
    lastFocusRefresh = Date.now();
    refresh();
  });
  window.setInterval(refresh, REFRESH_EVERY_MS);
  // A user switch changes the scoped cache; drop the in-memory copy so it is re-read.
  window.addEventListener("storage", (event) => {
    if (event.key && event.key.includes(STORAGE_KEY)) memory = undefined;
  });
}

/** Test helper: forget the in-memory copy. */
export function __resetBroadcastGraphicsCatalogForTests(): void {
  memory = undefined;
  inFlight = null;
}
