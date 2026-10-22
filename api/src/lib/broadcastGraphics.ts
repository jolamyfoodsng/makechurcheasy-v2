/**
 * broadcastGraphics.ts — admin control of the desktop app's Broadcast Graphics.
 *
 * Every graphic (bundled with the app, or uploaded here as an "mce-graphic@1" package) has:
 *   status  "active" (listed and usable) · "paused" (listed, can't be used) · "hidden" (not listed)
 *   tiers   who may use it: { free, paid, ambassador }  (free = everyone)
 * Uploaded packages are delivered to the desktop app through GET /api/broadcast-graphics,
 * so new graphics go live without rebuilding or redeploying the app. The app caches the
 * catalog and keeps working offline with the last copy.
 */
import type { NextRequest } from "next/server";
import clientPromise from "./mongodb";
import { COLLECTIONS, ensureIndexes } from "./db";
import { getAuthUserFromRequest } from "./auth";
import { getEffectivePlan } from "./trial";
import { BUILTIN_BROADCAST_GRAPHICS } from "./builtinBroadcastGraphics";
import { BUILTIN_BROADCAST_TICKERS } from "./builtinBroadcastTickers";

export const PACKAGE_FORMAT = "mce-graphic@1";
export const TICKER_PACKAGE_FORMAT = "mce-ticker@1";
export type GraphicKind = "graphic" | "ticker";
export type GraphicStatus = "active" | "paused" | "hidden";
export type GraphicSource = "builtin" | "package";
export type GraphicAudience = "free" | "paid" | "ambassador" | "admin";

export interface GraphicTiers {
  free: boolean;
  paid: boolean;
  ambassador: boolean;
}

export const GRAPHIC_CATEGORIES = [
  "speaker", "service", "welcome", "giving", "subscribe", "announcements",
  "countdown", "social", "branding", "scripture", "quotes", "others",
] as const;

type JsonRecord = Record<string, unknown>;

export interface GraphicPackage extends JsonRecord {
  format: string;
  id: string;
  version: number;
  name: string;
  category: string;
  description: string;
  color: string;
  hold: number;
  placement: { x: number; y: number; scale: number };
  fields: JsonRecord[];
  html: string;
  css: string;
  animation: JsonRecord;
}

/** An uploaded ticker ("mce-ticker@1"), rendered by the app like its bundled HTML tickers. */
export interface TickerPackage extends JsonRecord {
  format: string;
  id: string;
  version: number;
  name: string;
  description: string;
  color: string;
  badge: string;
  tickerText: string;
  speed: string;
  html: string;
  css: string;
  fontImports: string[];
  variables: JsonRecord[];
}

export interface BroadcastGraphicDocument {
  _id?: unknown;
  graphicId: string;
  /** Missing on documents saved before tickers were added: treated as "graphic". */
  kind?: GraphicKind;
  source: GraphicSource;
  name: string;
  description: string;
  category: string;
  accentColor: string;
  status: GraphicStatus;
  tiers: GraphicTiers;
  sortOrder: number;
  version: number;
  package: GraphicPackage | TickerPackage | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

const ALL_TIERS: GraphicTiers = { free: true, paid: true, ambassador: true };
const MAX_PACKAGE_BYTES = 1_500_000; // embedded fonts / pictures as data: URIs stay offline-safe
const FIELD_TYPES = ["text", "color", "select", "list", "image"];
const FX_NAMES = [
  "wipeL", "wipeR", "wipeU", "wipeD", "wipeC", "wipeV", "growX", "growY", "pop", "spin", "slam", "up", "down",
  "left", "right", "fade", "slideUp", "maskUp", "maskDown", "maskL", "blurL", "stretch", "skew", "draw",
];

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "", max = 400): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

export function slugifyGraphicId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function normalizeStatus(value: unknown, fallback: GraphicStatus = "active"): GraphicStatus {
  return value === "active" || value === "paused" || value === "hidden" ? value : fallback;
}

function normalizeTiers(value: unknown, fallback: GraphicTiers = ALL_TIERS): GraphicTiers {
  if (!isRecord(value)) return { ...fallback };
  return {
    free: typeof value.free === "boolean" ? value.free : fallback.free,
    paid: typeof value.paid === "boolean" ? value.paid : fallback.paid,
    ambassador: typeof value.ambassador === "boolean" ? value.ambassador : fallback.ambassador,
  };
}

function normalizeCategory(value: unknown, fallback = "others"): string {
  const c = str(value, fallback, 40).toLowerCase();
  return (GRAPHIC_CATEGORIES as readonly string[]).includes(c) ? c : fallback;
}

/** Markup and styles may not run code or load remote pages (they render inside the app and OBS). */
const UNSAFE_HTML = /<\s*(script|iframe|object|embed|link|meta|base|form|frame|frameset|applet)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|srcdoc\s*=/i;
const UNSAFE_CSS = /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|@import/i;

/**
 * Validate an uploaded package and return its clean form. Throws with a readable message.
 */
export function validateGraphicPackage(raw: unknown): GraphicPackage {
  if (!isRecord(raw)) throw new Error("The file is not a graphic package (expected a JSON object).");
  const size = Buffer.byteLength(JSON.stringify(raw), "utf8");
  if (size > MAX_PACKAGE_BYTES) throw new Error(`The package is ${Math.round(size / 1024)} KB; the limit is ${MAX_PACKAGE_BYTES / 1000} KB.`);
  const format = str(raw.format, PACKAGE_FORMAT, 40);
  if (format !== PACKAGE_FORMAT) throw new Error(`Unsupported format "${format}". Use "${PACKAGE_FORMAT}".`);

  const name = str(raw.name, "", 120).trim();
  if (!name) throw new Error("The package needs a name.");
  const id = slugifyGraphicId(str(raw.id, "", 120) || name);
  if (!id) throw new Error("The package needs an id (letters, numbers and dashes).");

  const html = str(raw.html, "", 200_000);
  if (!html.trim()) throw new Error("The package needs html (the graphic's markup).");
  if (UNSAFE_HTML.test(html)) throw new Error("The html may not contain scripts, event handlers (onclick=…), iframes, links or forms.");
  const css = str(raw.css, "", 1_200_000);
  if (UNSAFE_CSS.test(css)) throw new Error("The css may not use @import, expression() or javascript: URLs.");

  if (!Array.isArray(raw.fields)) throw new Error("The package needs a fields list.");
  const seen = new Set<string>();
  const fields = raw.fields.slice(0, 80).map((f, i) => {
    if (!isRecord(f)) throw new Error(`Field ${i + 1} is not an object.`);
    const key = str(f.key, "", 60).replace(/[^\w-]/g, "");
    if (!key) throw new Error(`Field ${i + 1} needs a key.`);
    if (key.startsWith("kx")) throw new Error(`Field "${key}": keys starting with "kx" are reserved.`);
    if (seen.has(key)) throw new Error(`Field "${key}" is listed twice.`);
    seen.add(key);
    const type = FIELD_TYPES.includes(String(f.type || "text")) ? String(f.type || "text") : null;
    if (!type) throw new Error(`Field "${key}": type must be one of ${FIELD_TYPES.join(", ")}.`);
    const out: JsonRecord = {
      key,
      label: str(f.label, key, 120),
      type,
      default: str(f.default ?? f.defaultValue, "", 600_000),
    };
    if (f.shades === true) out.shades = true;
    if (f.multiline === true) out.multiline = true;
    if (f.options === "icons" || f.options === "brands") out.options = f.options;
    else if (Array.isArray(f.options)) {
      out.options = f.options.slice(0, 100).map((o) => (isRecord(o)
        ? { value: str(o.value, "", 120), label: str(o.label ?? o.value, "", 120) }
        : { value: str(o, "", 120), label: str(o, "", 120) }));
    } else if (type === "select") {
      throw new Error(`Field "${key}": a select needs options ("icons", "brands" or a list).`);
    }
    return out;
  });

  const animation = isRecord(raw.animation) ? raw.animation : {};
  const steps = (list: unknown, label: string) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`animation.${label} must be a list.`);
    return list.slice(0, 120).map((s, i) => {
      if (Array.isArray(s)) {
        if (typeof s[0] !== "string" || !FX_NAMES.includes(String(s[1]))) {
          throw new Error(`animation.${label}[${i}]: use ["selector", "effect", at, {d, e, s}] with a known effect (${FX_NAMES.join(", ")}).`);
        }
        return s;
      }
      if (isRecord(s) && typeof (s.sel ?? s.selector) === "string") {
        if (s.fx !== undefined && !FX_NAMES.includes(String(s.fx))) throw new Error(`animation.${label}[${i}]: unknown effect "${s.fx}".`);
        return s;
      }
      throw new Error(`animation.${label}[${i}] is not a valid step.`);
    });
  };
  const cleanAnimation = {
    in: steps(animation.in, "in"),
    out: steps(animation.out, "out"),
    ambient: Array.isArray(animation.ambient) ? animation.ambient.filter(isRecord).slice(0, 40) : [],
  };
  if (JSON.stringify(cleanAnimation).match(/"on[A-Z]\w*"|callback/)) throw new Error("Animation steps may not contain callbacks.");

  const placement = isRecord(raw.placement) ? raw.placement : {};
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };

  return {
    format: PACKAGE_FORMAT,
    id,
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    name,
    category: normalizeCategory(raw.category),
    description: str(raw.description, "", 400),
    color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(str(raw.color, "", 9)) ? str(raw.color, "", 9) : "#2563eb",
    hold: num(raw.hold, 8, 0, 600),
    placement: { x: num(placement.x, 120, -1920, 1920), y: num(placement.y, 90, -1080, 1080), scale: num(placement.scale, 1, 0.1, 4) },
    fields,
    html,
    css,
    animation: cleanAnimation,
  };
}

/** Only Google Fonts stylesheets may be loaded by an uploaded ticker. */
const FONT_IMPORT = /^https:\/\/fonts\.googleapis\.com\/css2?\?[^"'<>\s]+$/i;
const TICKER_VARIABLE_TYPES = ["text", "color", "image", "number"];

/**
 * Validate an uploaded ticker package. The html uses {{key}} placeholders for its variables;
 * {{badge}} (heading), {{tickerText}} (the scrolling messages), {{speed}} and {{state}} are filled by the app.
 */
export function validateTickerPackage(raw: unknown): TickerPackage {
  if (!isRecord(raw)) throw new Error("The file is not a ticker package (expected a JSON object).");
  const size = Buffer.byteLength(JSON.stringify(raw), "utf8");
  if (size > MAX_PACKAGE_BYTES) throw new Error(`The package is ${Math.round(size / 1024)} KB; the limit is ${MAX_PACKAGE_BYTES / 1000} KB.`);
  const name = str(raw.name, "", 120).trim();
  if (!name) throw new Error("The ticker needs a name.");
  const id = slugifyGraphicId(str(raw.id, "", 120) || name);
  if (!id) throw new Error("The ticker needs an id (letters, numbers and dashes).");
  const html = str(raw.html, "", 200_000);
  if (!html.trim()) throw new Error("The ticker needs html (its markup).");
  if (UNSAFE_HTML.test(html)) throw new Error("The html may not contain scripts, event handlers (onclick=…), iframes, links or forms.");
  if (!/\{\{\s*(tickerText|text|message|messages)\s*\}\}/i.test(html)) {
    throw new Error("The html needs a {{tickerText}} placeholder for the scrolling messages.");
  }
  const css = str(raw.css, "", 1_200_000);
  if (UNSAFE_CSS.test(css)) throw new Error("The css may not use @import, expression() or javascript: URLs.");
  const fontImports = Array.isArray(raw.fontImports) ? raw.fontImports.map((u) => str(u, "", 600)).filter(Boolean).slice(0, 6) : [];
  const badFont = fontImports.find((u) => !FONT_IMPORT.test(u));
  if (badFont) throw new Error(`fontImports may only list Google Fonts stylesheets (https://fonts.googleapis.com/css2?…). Not allowed: ${badFont}`);
  const seen = new Set<string>();
  const variables = (Array.isArray(raw.variables) ? raw.variables : []).slice(0, 40).map((v, i) => {
    if (!isRecord(v)) throw new Error(`Variable ${i + 1} is not an object.`);
    const key = str(v.key, "", 60).replace(/[^\w-]/g, "");
    if (!key) throw new Error(`Variable ${i + 1} needs a key.`);
    if (seen.has(key)) throw new Error(`Variable "${key}" is listed twice.`);
    seen.add(key);
    const type = TICKER_VARIABLE_TYPES.includes(String(v.type || "text")) ? String(v.type || "text") : "text";
    return {
      key,
      label: str(v.label, key, 120),
      type,
      defaultValue: str(v.defaultValue ?? v.default, "", 600_000),
      placeholder: str(v.placeholder, "", 200),
      group: str(v.group, "Content", 60),
      ...(v.required === true ? { required: true } : {}),
    };
  });
  const speedRaw = str(raw.speed, "24s", 12).trim();
  return {
    format: TICKER_PACKAGE_FORMAT,
    id,
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    name,
    description: str(raw.description, "", 400),
    color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(str(raw.color, "", 9)) ? str(raw.color, "", 9) : "#2563eb",
    badge: str(raw.badge, "Announcements", 80),
    tickerText: str(raw.tickerText, "", 2000),
    speed: /^\d{1,3}(\.\d+)?s$/.test(speedRaw) ? speedRaw : "24s",
    html,
    css,
    fontImports,
    variables,
  };
}

export function graphicKind(doc: Pick<BroadcastGraphicDocument, "kind">): GraphicKind {
  return doc.kind === "ticker" ? "ticker" : "graphic";
}

function isBuiltinId(graphicId: string): boolean {
  return BUILTIN_BROADCAST_GRAPHICS.some((b) => b.graphicId === graphicId)
    || BUILTIN_BROADCAST_TICKERS.some((t) => t.graphicId === graphicId);
}

async function collection() {
  await ensureIndexes();
  const client = await clientPromise;
  return client.db().collection<BroadcastGraphicDocument>(COLLECTIONS.BROADCAST_GRAPHICS);
}

function builtinDefaults(graphicId: string): BroadcastGraphicDocument | null {
  const t = BUILTIN_BROADCAST_TICKERS.find((g) => g.graphicId === graphicId);
  if (t) {
    return {
      graphicId: t.graphicId,
      kind: "ticker",
      source: "builtin",
      name: t.name,
      description: t.description,
      category: "ticker",
      accentColor: t.accentColor,
      status: t.retired ? "hidden" : "active",
      tiers: { ...ALL_TIERS },
      sortOrder: t.sortOrder,
      version: 0,
      package: null,
      createdAt: "",
      updatedAt: "",
      createdBy: "",
      updatedBy: "",
    };
  }
  const b = BUILTIN_BROADCAST_GRAPHICS.find((g) => g.graphicId === graphicId);
  if (!b) return null;
  return {
    graphicId: b.graphicId,
    kind: "graphic",
    source: "builtin",
    name: b.name,
    description: b.description,
    category: b.category,
    accentColor: b.accentColor,
    status: "active",
    tiers: { ...ALL_TIERS },
    sortOrder: b.sortOrder,
    version: 0,
    package: null,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
  };
}

/** Uploaded packages, then bundled graphics, then bundled tickers (with any admin settings). Each has a kind. */
export async function listBroadcastGraphics(): Promise<BroadcastGraphicDocument[]> {
  const docs = await (await collection()).find({}).toArray();
  const byId = new Map(docs.map((d) => [d.graphicId, d]));
  const builtins = [...BUILTIN_BROADCAST_GRAPHICS, ...BUILTIN_BROADCAST_TICKERS].map((b) => {
    const base = builtinDefaults(b.graphicId)!;
    const saved = byId.get(b.graphicId);
    // A retired ticker (removed from newer apps) stays hidden whatever was saved for it.
    const retired = BUILTIN_BROADCAST_TICKERS.some((t) => t.graphicId === b.graphicId && t.retired);
    return saved && saved.source === "builtin" && !retired
      ? { ...base, status: saved.status, tiers: saved.tiers, sortOrder: saved.sortOrder ?? base.sortOrder, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }
      : base;
  });
  const packages = docs
    .filter((d) => d.source === "package")
    .map((d) => ({ ...d, kind: graphicKind(d) }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  return [...packages, ...builtins];
}

export interface GraphicSettingsInput {
  status?: unknown;
  tiers?: unknown;
  sortOrder?: unknown;
  name?: unknown;
  category?: unknown;
}

/** Change status / tiers / order (and, for packages, name / category). */
export async function updateBroadcastGraphicSettings(
  graphicId: string,
  input: GraphicSettingsInput,
  adminUserId: string,
): Promise<BroadcastGraphicDocument | null> {
  const col = await collection();
  const now = new Date().toISOString();
  const existing = await col.findOne({ graphicId });
  const base = existing ?? builtinDefaults(graphicId);
  if (!base) return null;
  const next: BroadcastGraphicDocument = {
    ...base,
    status: normalizeStatus(input.status, base.status),
    tiers: normalizeTiers(input.tiers, base.tiers),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : base.sortOrder,
    name: base.source === "package" && typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : base.name,
    category: base.source === "package" && graphicKind(base) === "graphic" && input.category !== undefined ? normalizeCategory(input.category, base.category) : base.category,
    createdAt: base.createdAt || now,
    createdBy: base.createdBy || adminUserId,
    updatedAt: now,
    updatedBy: adminUserId,
  };
  const { _id: _ignored, ...doc } = next;
  void _ignored;
  doc.kind = graphicKind(base);
  if (doc.package) {
    doc.package = doc.kind === "ticker"
      ? { ...(doc.package as TickerPackage), name: doc.name }
      : { ...(doc.package as GraphicPackage), name: doc.name, category: doc.category };
  }
  await col.updateOne({ graphicId }, { $set: doc }, { upsert: true });
  return col.findOne({ graphicId });
}

/** Add a new package, or publish a new version of an existing one. The format picks graphic or ticker. */
export async function publishGraphicPackage(
  raw: unknown,
  options: { status?: unknown; tiers?: unknown; replaceId?: string },
  adminUserId: string,
): Promise<BroadcastGraphicDocument> {
  const kind: GraphicKind = isRecord(raw) && raw.format === TICKER_PACKAGE_FORMAT ? "ticker" : "graphic";
  const pkg: GraphicPackage | TickerPackage = kind === "ticker" ? validateTickerPackage(raw) : validateGraphicPackage(raw);
  const graphicId = options.replaceId ? slugifyGraphicId(options.replaceId) : pkg.id;
  if (isBuiltinId(graphicId)) {
    throw new Error(`"${graphicId}" is a bundled ${kind} id. Pick another id for the package.`);
  }
  const col = await collection();
  const existing = await col.findOne({ graphicId });
  if (existing && graphicKind(existing) !== kind) {
    throw new Error(`"${graphicId}" is already used by a ${graphicKind(existing)}. Pick another id.`);
  }
  const now = new Date().toISOString();
  const version = (existing?.version ?? 0) + 1;
  const doc: Omit<BroadcastGraphicDocument, "_id"> = {
    graphicId,
    kind,
    source: "package",
    name: pkg.name,
    description: pkg.description,
    category: kind === "ticker" ? "ticker" : (pkg as GraphicPackage).category,
    accentColor: pkg.color,
    status: normalizeStatus(options.status, existing?.status ?? "active"),
    tiers: normalizeTiers(options.tiers, existing?.tiers ?? ALL_TIERS),
    sortOrder: existing?.sortOrder ?? -1,
    version,
    package: { ...pkg, id: graphicId, version },
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? adminUserId,
    updatedAt: now,
    updatedBy: adminUserId,
  };
  await col.updateOne({ graphicId }, { $set: doc }, { upsert: true });
  const saved = await col.findOne({ graphicId });
  if (!saved) throw new Error("Failed to save the graphic.");
  return saved;
}

/** Remove an uploaded package, or reset a bundled graphic to its defaults. */
export async function deleteBroadcastGraphic(graphicId: string): Promise<boolean> {
  const col = await collection();
  const result = await col.deleteOne({ graphicId });
  return result.deletedCount > 0 || !!builtinDefaults(graphicId);
}

/** Who is asking: admin, ambassador, paid plan or free (no account / no device = free). */
export async function resolveGraphicAudience(req: NextRequest): Promise<GraphicAudience> {
  try {
    const authUser = await getAuthUserFromRequest(req);
    const user = authUser?.mongoUser as Record<string, unknown> | undefined;
    if (!user) return "free";
    if (String(user.role || "").toLowerCase() === "admin") return "admin";
    const ambassador = user.ambassador as { active?: boolean; expiresAt?: string } | undefined;
    if (ambassador?.active && (!ambassador.expiresAt || new Date(ambassador.expiresAt).getTime() > Date.now())) return "ambassador";
    return getEffectivePlan(user as never) === "free" ? "free" : "paid";
  } catch {
    return "free";
  }
}

export function canUseGraphic(tiers: GraphicTiers, audience: GraphicAudience): boolean {
  if (audience === "admin") return true;
  if (tiers.free) return true;
  return tiers[audience];
}

/** The catalog the desktop app downloads (hidden packages are listed without their content). */
export function serializeForApp(doc: BroadcastGraphicDocument, audience: GraphicAudience): JsonRecord {
  const usable = canUseGraphic(doc.tiers, audience);
  return {
    graphicId: doc.graphicId,
    kind: graphicKind(doc),
    source: doc.source,
    status: doc.status,
    tiers: doc.tiers,
    access: usable ? "allowed" : "locked",
    name: doc.name,
    category: doc.category,
    sortOrder: doc.sortOrder,
    version: doc.version,
    updatedAt: doc.updatedAt,
    ...(doc.source === "package" && doc.status !== "hidden" ? { package: doc.package } : {}),
  };
}

export function serializeForAdmin(doc: BroadcastGraphicDocument): JsonRecord {
  const { _id, ...rest } = doc;
  return { ...rest, kind: graphicKind(doc), _id: _id && typeof _id === "object" && "toString" in _id ? String(_id.toString()) : _id };
}
