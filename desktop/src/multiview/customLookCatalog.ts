/**
 * customLookCatalog.ts — the admin-uploaded Multi-View "complete look" catalog.
 *
 * Mirrors services/broadcastGraphicsCatalog.ts's fetch/cache/offline pattern (see that file for
 * the full rationale): the app downloads the catalog from GET /api/multiview-looks whenever it is
 * online and keeps the last copy, so a published look keeps working offline once it has been seen
 * once. Unlike Broadcast Graphics, there is no tiers/audience gating in this v1 — see
 * api/src/lib/multiviewLooks.ts for that judgment call.
 */
import { getEnvConfig } from "../services/envConfig";
import { getUserScopedKey } from "../services/userScopedStorage";

export type MultiviewLookStatus = "active" | "paused" | "hidden";

export interface MultiviewLookCameraSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: "rect" | "circle";
}

export interface MultiviewLookPackage {
  format: "mce-multiview-look@1";
  id: string;
  version?: number;
  name: string;
  description?: string;
  html: string;
  cameraSlot: MultiviewLookCameraSlot;
}

export interface CustomMultiViewLook {
  lookId: string;
  status: MultiviewLookStatus;
  name: string;
  description?: string;
  sortOrder?: number;
  version?: number;
  updatedAt?: string;
  package: MultiviewLookPackage | null;
}

export interface MultiviewLookCatalog {
  fetchedAt: number;
  looks: CustomMultiViewLook[];
}

export const MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT = "multiview-looks-catalog-updated";

const STORAGE_KEY = "mce-multiview-looks-catalog.v1";
const REFRESH_EVERY_MS = 30 * 60 * 1000;
const FOCUS_REFRESH_MIN_MS = 5 * 60 * 1000;

let memory: MultiviewLookCatalog | null | undefined;
let inFlight: Promise<MultiviewLookCatalog | null> | null = null;
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

function normalizeCameraSlot(raw: unknown): MultiviewLookCameraSlot {
  const v = isRecord(raw) ? raw : {};
  return {
    x: Number(v.x) || 0,
    y: Number(v.y) || 0,
    width: Number(v.width) || 960,
    height: Number(v.height) || 1080,
    shape: v.shape === "circle" ? "circle" : "rect",
  };
}

function normalizeEntry(raw: unknown): CustomMultiViewLook | null {
  if (!isRecord(raw)) return null;
  const lookId = typeof raw.lookId === "string" ? raw.lookId.trim() : "";
  if (!lookId) return null;
  const status: MultiviewLookStatus = raw.status === "paused" || raw.status === "hidden" ? raw.status : "active";
  const pkg = isRecord(raw.package) && typeof raw.package.html === "string"
    ? {
      format: "mce-multiview-look@1" as const,
      id: lookId,
      version: typeof raw.package.version === "number" ? raw.package.version : undefined,
      name: typeof raw.package.name === "string" ? raw.package.name : (typeof raw.name === "string" ? raw.name : lookId),
      description: typeof raw.package.description === "string" ? raw.package.description : undefined,
      html: raw.package.html,
      cameraSlot: normalizeCameraSlot(raw.package.cameraSlot),
    }
    : null;
  if (status !== "hidden" && !pkg) return null;
  return {
    lookId,
    status,
    name: typeof raw.name === "string" ? raw.name : lookId,
    description: typeof raw.description === "string" ? raw.description : undefined,
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : undefined,
    version: typeof raw.version === "number" ? raw.version : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    package: pkg,
  };
}

function normalizeCatalog(raw: unknown): MultiviewLookCatalog | null {
  if (!isRecord(raw) || !Array.isArray(raw.looks)) return null;
  return {
    fetchedAt: typeof raw.fetchedAt === "number" ? raw.fetchedAt : Date.now(),
    looks: raw.looks.map(normalizeEntry).filter((e): e is CustomMultiViewLook => !!e),
  };
}

/** The last downloaded catalog, or null before the first successful download. */
export function getMultiviewLookCatalog(): MultiviewLookCatalog | null {
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

function saveCatalog(catalog: MultiviewLookCatalog): void {
  memory = catalog;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(catalog));
  } catch {
    // Storage full: the in-memory copy still applies for this session.
  }
}

/** Every active, usable custom Multi-View look — what the gallery/Dock iterate over. */
export function listCustomMultiViewLooks(catalog = getMultiviewLookCatalog()): CustomMultiViewLook[] {
  return (catalog?.looks ?? [])
    .filter((l) => l.status === "active" && l.package)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export function getCustomMultiViewLook(lookId: string, catalog = getMultiviewLookCatalog()): CustomMultiViewLook | undefined {
  return (catalog?.looks ?? []).find((l) => l.lookId === lookId);
}

function apiBases(): string[] {
  const config = getEnvConfig();
  return Array.from(new Set([config.apiBaseUrl, config.authApiUrl].filter(Boolean).map((b) => b.replace(/\/+$/, ""))));
}

async function afterCatalogChange(catalog: MultiviewLookCatalog): Promise<void> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT, { detail: { catalog } }));
  }
}

/** Download the catalog. Offline or on any error the last copy stays in place and is returned. */
export async function refreshMultiviewLookCatalog(): Promise<MultiviewLookCatalog | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const previous = getMultiviewLookCatalog();
    if (typeof navigator !== "undefined" && navigator.onLine === false) return previous;
    for (const base of apiBases()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${base}/api/multiview-looks`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        const catalog = normalizeCatalog({ ...body, fetchedAt: Date.now() });
        if (!catalog) continue;
        const changed = JSON.stringify(previous?.looks ?? null) !== JSON.stringify(catalog.looks);
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
export function startMultiviewLookCatalog(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  let lastFocusRefresh = 0;
  const refresh = () => { void refreshMultiviewLookCatalog(); };
  refresh();
  window.setTimeout(refresh, 8_000);
  window.addEventListener("online", refresh);
  window.addEventListener("focus", () => {
    if (Date.now() - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
    lastFocusRefresh = Date.now();
    refresh();
  });
  window.setInterval(refresh, REFRESH_EVERY_MS);
  window.addEventListener("storage", (event) => {
    if (event.key && event.key.includes(STORAGE_KEY)) memory = undefined;
  });
}

/** Test helper: forget the in-memory copy. */
export function __resetMultiviewLookCatalogForTests(): void {
  memory = undefined;
  inFlight = null;
}
