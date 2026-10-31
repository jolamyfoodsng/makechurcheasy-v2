/**
 * multiviewLooks.ts — admin control of the desktop app's custom Multi-View "complete looks".
 *
 * Mirrors broadcastGraphics.ts's shape, adapted for a different delivery mechanism: a Multi-View
 * look is a full standalone HTML *page* (not a DOM fragment rendered inside an existing overlay),
 * because OBS's browser source needs a real URL to point at. The desktop app downloads the
 * package, writes its `html` to a local file (see desktop/src/multiview/customLookCatalog.ts +
 * the `save_dock_html` Tauri command) and points an OBS browser source at that file.
 *
 * Every look has:
 *   status  "active" (listed and usable) · "paused" (listed, can't be used) · "hidden" (not listed)
 *
 * v1 judgment call: no tiers/audience gating (unlike Broadcast Graphics) — every plan can use an
 * uploaded look once it's active. This keeps the first version simple; audience gating can be
 * added later the same way broadcastGraphics.ts does it, if ever needed.
 */
import clientPromise from "./mongodb";
import { COLLECTIONS, ensureIndexes } from "./db";

export const MULTIVIEW_LOOK_FORMAT = "mce-multiview-look@1";
export type MultiviewLookStatus = "active" | "paused" | "hidden";

type JsonRecord = Record<string, unknown>;

export interface MultiviewLookCameraSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: "rect" | "circle";
}

export interface MultiviewLookPackage extends JsonRecord {
  format: string;
  id: string;
  version: number;
  name: string;
  description: string;
  html: string;
  cameraSlot: MultiviewLookCameraSlot;
}

export interface MultiviewLookDocument {
  _id?: unknown;
  lookId: string;
  name: string;
  description: string;
  status: MultiviewLookStatus;
  sortOrder: number;
  version: number;
  package: MultiviewLookPackage;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

const MAX_PACKAGE_BYTES = 1_500_000;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "", max = 400): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

export function slugifyLookId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function normalizeStatus(value: unknown, fallback: MultiviewLookStatus = "active"): MultiviewLookStatus {
  return value === "active" || value === "paused" || value === "hidden" ? value : fallback;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function num(v: unknown, d: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

function normalizeCameraSlot(raw: unknown): MultiviewLookCameraSlot {
  const v = isRecord(raw) ? raw : {};
  return {
    x: num(v.x, 0, 0, CANVAS_W),
    y: num(v.y, 0, 0, CANVAS_H),
    width: num(v.width, 960, 16, CANVAS_W),
    height: num(v.height, 1080, 16, CANVAS_H),
    shape: v.shape === "circle" ? "circle" : "rect",
  };
}

/** A look's html is a complete standalone page (it becomes a real file served to OBS's browser
 *  source), unlike a Broadcast Graphic fragment — so, unlike validateGraphicPackage, scripts are
 *  allowed here (the live-verse-update transport needs them). Only admins can publish a look. */
export function validateMultiviewLookPackage(raw: unknown): MultiviewLookPackage {
  if (!isRecord(raw)) throw new Error("The file is not a Multi-View look package (expected a JSON object).");
  const size = Buffer.byteLength(JSON.stringify(raw), "utf8");
  if (size > MAX_PACKAGE_BYTES) throw new Error(`The package is ${Math.round(size / 1024)} KB; the limit is ${MAX_PACKAGE_BYTES / 1000} KB.`);
  const format = str(raw.format, MULTIVIEW_LOOK_FORMAT, 40);
  if (format !== MULTIVIEW_LOOK_FORMAT) throw new Error(`Unsupported format "${format}". Use "${MULTIVIEW_LOOK_FORMAT}".`);

  const name = str(raw.name, "", 120).trim();
  if (!name) throw new Error("The look needs a name.");
  const id = slugifyLookId(str(raw.id, "", 120) || name);
  if (!id) throw new Error("The look needs an id (letters, numbers and dashes).");

  const html = str(raw.html, "", 400_000);
  if (!html.trim()) throw new Error("The look needs html (the overlay page's full markup).");
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("The html must be a complete standalone page (needs <html>…</html>), not a fragment.");
  }

  return {
    format: MULTIVIEW_LOOK_FORMAT,
    id,
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    name,
    description: str(raw.description, "", 400),
    html,
    cameraSlot: normalizeCameraSlot(raw.cameraSlot),
  };
}

async function collection() {
  await ensureIndexes();
  const client = await clientPromise;
  return client.db().collection<MultiviewLookDocument>(COLLECTIONS.MULTIVIEW_LOOK_PACKAGES);
}

/** Every uploaded look, uploaded ones first by sort order then name. */
export async function listMultiviewLooks(): Promise<MultiviewLookDocument[]> {
  const docs = await (await collection()).find({}).toArray();
  return docs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export interface MultiviewLookSettingsInput {
  status?: unknown;
  sortOrder?: unknown;
  name?: unknown;
}

export async function updateMultiviewLookSettings(
  lookId: string,
  input: MultiviewLookSettingsInput,
  adminUserId: string,
): Promise<MultiviewLookDocument | null> {
  const col = await collection();
  const now = new Date().toISOString();
  const existing = await col.findOne({ lookId });
  if (!existing) return null;
  const next: MultiviewLookDocument = {
    ...existing,
    status: normalizeStatus(input.status, existing.status),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : existing.sortOrder,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : existing.name,
    updatedAt: now,
    updatedBy: adminUserId,
  };
  const { _id: _ignored, ...doc } = next;
  void _ignored;
  if (doc.package) doc.package = { ...doc.package, name: doc.name };
  await col.updateOne({ lookId }, { $set: doc }, { upsert: true });
  return col.findOne({ lookId });
}

/** Add a new look package, or publish a new version of an existing one. */
export async function publishMultiviewLookPackage(
  raw: unknown,
  options: { status?: unknown; replaceId?: string },
  adminUserId: string,
): Promise<MultiviewLookDocument> {
  const pkg = validateMultiviewLookPackage(raw);
  const lookId = options.replaceId ? slugifyLookId(options.replaceId) : pkg.id;
  const col = await collection();
  const existing = await col.findOne({ lookId });
  const now = new Date().toISOString();
  const version = (existing?.version ?? 0) + 1;
  const doc: Omit<MultiviewLookDocument, "_id"> = {
    lookId,
    name: pkg.name,
    description: pkg.description,
    status: normalizeStatus(options.status, existing?.status ?? "active"),
    sortOrder: existing?.sortOrder ?? -1,
    version,
    package: { ...pkg, id: lookId, version },
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? adminUserId,
    updatedAt: now,
    updatedBy: adminUserId,
  };
  await col.updateOne({ lookId }, { $set: doc }, { upsert: true });
  const saved = await col.findOne({ lookId });
  if (!saved) throw new Error("Failed to save the look.");
  return saved;
}

export async function deleteMultiviewLook(lookId: string): Promise<boolean> {
  const col = await collection();
  const result = await col.deleteOne({ lookId });
  return result.deletedCount > 0;
}

/** The catalog the desktop app downloads. Hidden looks are listed without their content, like
 *  broadcastGraphics.ts's serializeForApp does for hidden graphics. */
export function serializeForApp(doc: MultiviewLookDocument): JsonRecord {
  return {
    lookId: doc.lookId,
    status: doc.status,
    name: doc.name,
    description: doc.description,
    sortOrder: doc.sortOrder,
    version: doc.version,
    updatedAt: doc.updatedAt,
    ...(doc.status !== "hidden" ? { package: doc.package } : {}),
  };
}

export function serializeForAdmin(doc: MultiviewLookDocument): JsonRecord {
  const { _id, ...rest } = doc;
  return { ...rest, _id: _id && typeof _id === "object" && "toString" in _id ? String(_id.toString()) : _id };
}
