/**
 * usageEvents.ts — where people go and what they click inside the desktop app and the OBS docks.
 *
 * The desktop app (and the two docks) send batches of three kinds of events:
 *   view   a page / dock tab was opened
 *   dwell  the page was left after durationMs (gives "time spent")
 *   click  a button, link or tab was clicked (label + the area of the screen it is in)
 * They are stored in `usage_events`, one document each, attributed to the user, and read back by the
 * admin Analytics page (all users) and the user profile (one user).
 *
 * Privacy: the app only sends the page name, the label of the control that was clicked and the area it
 * is in. It never sends typed text, Bible/lyrics/transcript content, or the contents of lists.
 * Strings are cut to a safe length again here. Events are deleted after 180 days (TTL index in db.ts).
 */

import type { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import { COLLECTIONS, ensureIndexes } from "./db";
import { getAuthUserFromRequest } from "./auth";

export const USAGE_SURFACES = ["app", "dock", "lm-dock"] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];
const USAGE_TYPES = new Set(["view", "dwell", "click"]);

export const MAX_USAGE_BATCH = 60;
const MAX_DWELL_MS = 30 * 60 * 1000;

export interface UsageEventDoc {
  userId: string | null;
  deviceId: string | null;
  sessionId: string;
  surface: UsageSurface;
  type: "view" | "dwell" | "click";
  page: string;
  label?: string;
  area?: string;
  durationMs?: number;
  appVersion?: string;
  os?: string;
  ts: Date;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A route like /studio or /transcripts/:id, or a dock tab name. Anything odd becomes "unknown". */
function cleanPage(value: unknown): string {
  const page = cleanText(value, 80);
  return /^[A-Za-z0-9/_:.\-]+$/.test(page) && page.length > 0 ? page : "unknown";
}

function cleanTimestamp(value: unknown, now: number): Date {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  // Accept a little clock drift and a day of queued (offline) events; anything else is "now".
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60_000 || parsed < now - 24 * 60 * 60_000) return new Date(now);
  return new Date(parsed);
}

export interface ParsedUsageBatch {
  surface: UsageSurface;
  sessionId: string;
  appVersion: string;
  os: string;
  events: Array<Pick<UsageEventDoc, "type" | "page" | "label" | "area" | "durationMs" | "ts">>;
}

/** Turns the request body into a clean batch, or null when it is not usable. */
export function parseUsageBatch(body: unknown, now = Date.now()): ParsedUsageBatch | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const surface = USAGE_SURFACES.find((s) => s === raw.surface);
  if (!surface || !Array.isArray(raw.events)) return null;

  const events: ParsedUsageBatch["events"] = [];
  for (const item of raw.events.slice(0, MAX_USAGE_BATCH)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.type !== "string" || !USAGE_TYPES.has(e.type)) continue;
    const type = e.type as "view" | "dwell" | "click";
    const doc: ParsedUsageBatch["events"][number] = { type, page: cleanPage(e.page), ts: cleanTimestamp(e.ts, now) };
    if (type === "click") {
      const label = cleanText(e.label, 60);
      const area = cleanText(e.area, 60);
      if (label) doc.label = label;
      if (area) doc.area = area;
    }
    if (type === "dwell") {
      const ms = Number(e.durationMs);
      if (!Number.isFinite(ms) || ms < 500) continue;
      doc.durationMs = Math.min(Math.round(ms), MAX_DWELL_MS);
    }
    events.push(doc);
  }
  if (events.length === 0) return null;
  return {
    surface,
    sessionId: cleanText(raw.sessionId, 64) || "unknown",
    appVersion: cleanText(raw.appVersion, 24),
    os: cleanText(raw.os, 24),
    events,
  };
}

/** Same attribution rules as /api/tracking/event: signed-in identity first, then the paired device. */
export async function resolveUsageUser(req: NextRequest, bodyUserId: unknown): Promise<{ userId: string | null; deviceId: string | null }> {
  const deviceId = (req.headers.get("x-device-id") || req.headers.get("x-mce-device-id") || "").trim() || null;
  const authUser = await getAuthUserFromRequest(req).catch(() => null);
  let userId = authUser?.mongoUser?._id?.toString() || (typeof bodyUserId === "string" && bodyUserId.trim() ? bodyUserId.trim() : null);
  if (!userId && deviceId) {
    const client = await clientPromise;
    const device = await client.db().collection("devices").findOne({ deviceId });
    if (device?.userId) userId = device.userId.toString();
  }
  return { userId, deviceId };
}

export async function recordUsageBatch(batch: ParsedUsageBatch, who: { userId: string | null; deviceId: string | null }): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const docs: UsageEventDoc[] = batch.events.map((e) => ({
    ...e,
    userId: who.userId,
    deviceId: who.deviceId,
    sessionId: batch.sessionId,
    surface: batch.surface,
    appVersion: batch.appVersion || undefined,
    os: batch.os || undefined,
  }));
  await client.db().collection(COLLECTIONS.USAGE_EVENTS).insertMany(docs, { ordered: false });
  if (who.userId && ObjectId.isValid(who.userId)) {
    await client.db().collection("users").updateOne(
      { _id: new ObjectId(who.userId) },
      { $set: { lastActive: new Date().toISOString() } },
    ).catch(() => undefined);
  }
  return docs.length;
}

// ── Reading (admin) ─────────────────────────────────────────────────────────

export function sinceDate(days: number): Date {
  const safe = [1, 7, 30, 90].includes(days) ? days : 30;
  return new Date(Date.now() - safe * 24 * 60 * 60 * 1000);
}

function matchFor(days: number, surface: string | null, userId?: string) {
  const match: Record<string, unknown> = { ts: { $gte: sinceDate(days) } };
  if (surface && (USAGE_SURFACES as readonly string[]).includes(surface)) match.surface = surface;
  if (userId) match.userId = userId;
  return match;
}

const isType = (type: string) => ({ $cond: [{ $eq: ["$type", type] }, 1, 0] });
const dayOf = { $dateToString: { format: "%Y-%m-%d", date: "$ts" } };

interface PageRow { surface: string; page: string; views: number; clicks: number; users: number; avgSeconds: number }
interface ClickRow { surface: string; page: string; label: string; area: string; clicks: number; users: number }

async function pageAndClickTables(match: Record<string, unknown>, limit = 60) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTIONS.USAGE_EVENTS);
  const [pagesRaw, clicksRaw] = await Promise.all([
    col.aggregate([
      { $match: match },
      {
        $group: {
          _id: { s: "$surface", p: "$page" },
          views: { $sum: isType("view") },
          clicks: { $sum: isType("click") },
          dwellMs: { $sum: { $cond: [{ $eq: ["$type", "dwell"] }, { $ifNull: ["$durationMs", 0] }, 0] } },
          dwellN: { $sum: isType("dwell") },
          users: { $addToSet: "$userId" },
        },
      },
      { $sort: { views: -1, clicks: -1 } },
      { $limit: limit },
    ]).toArray(),
    col.aggregate([
      { $match: { ...match, type: "click" } },
      {
        $group: {
          _id: { s: "$surface", p: "$page", l: { $ifNull: ["$label", ""] }, a: { $ifNull: ["$area", ""] } },
          clicks: { $sum: 1 },
          users: { $addToSet: "$userId" },
        },
      },
      { $sort: { clicks: -1 } },
      { $limit: limit },
    ]).toArray(),
  ]);
  const countUsers = (set: unknown) => (Array.isArray(set) ? set.filter(Boolean).length : 0);
  const pages: PageRow[] = pagesRaw.map((r) => ({
    surface: r._id.s,
    page: r._id.p,
    views: r.views,
    clicks: r.clicks,
    users: countUsers(r.users),
    avgSeconds: r.dwellN > 0 ? Math.round(r.dwellMs / r.dwellN / 1000) : 0,
  }));
  const clicks: ClickRow[] = clicksRaw.map((r) => ({
    surface: r._id.s,
    page: r._id.p,
    label: r._id.l || "(no label)",
    area: r._id.a,
    clicks: r.clicks,
    users: countUsers(r.users),
  }));
  return { pages, clicks };
}

async function dailySeries(match: Record<string, unknown>) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTIONS.USAGE_EVENTS);
  const [counts, users] = await Promise.all([
    col.aggregate([
      { $match: match },
      { $group: { _id: dayOf, views: { $sum: isType("view") }, clicks: { $sum: isType("click") } } },
    ]).toArray(),
    col.aggregate([
      { $match: { ...match, userId: { $ne: null } } },
      { $group: { _id: { d: dayOf, u: "$userId" } } },
      { $group: { _id: "$_id.d", users: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const userMap = new Map(users.map((u) => [u._id as string, u.users as number]));
  return counts
    .map((c) => ({ date: c._id as string, views: c.views as number, clicks: c.clicks as number, users: userMap.get(c._id as string) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getUsageOverview(days: number, surface: string | null) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTIONS.USAGE_EVENTS);
  const match = matchFor(days, surface);
  const [totalsAgg, usersAgg, sessionsAgg, surfacesAgg, byDay, tables, registered] = await Promise.all([
    col.aggregate([{ $match: match }, { $group: { _id: "$type", n: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $match: { ...match, userId: { $ne: null } } }, { $group: { _id: "$userId" } }, { $count: "n" }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: "$sessionId" } }, { $count: "n" }]).toArray(),
    col.aggregate([
      { $match: matchFor(days, null) },
      { $group: { _id: "$surface", views: { $sum: isType("view") }, clicks: { $sum: isType("click") }, users: { $addToSet: "$userId" } } },
    ]).toArray(),
    dailySeries(match),
    pageAndClickTables(match),
    client.db().collection("users").estimatedDocumentCount(),
  ]);
  const count = (type: string) => totalsAgg.find((t) => t._id === type)?.n ?? 0;
  const activeUsers = usersAgg[0]?.n ?? 0;
  return {
    days,
    surface: surface ?? "all",
    totals: { views: count("view"), clicks: count("click"), activeUsers, sessions: sessionsAgg[0]?.n ?? 0, registeredUsers: registered },
    surfaces: surfacesAgg.map((s) => ({
      surface: s._id as string,
      views: s.views as number,
      clicks: s.clicks as number,
      users: (s.users as unknown[]).filter(Boolean).length,
    })),
    byDay,
    // Share of the people who were active in this period who opened each page.
    pages: tables.pages.map((p) => ({ ...p, adoptionPercent: activeUsers > 0 ? Math.round((p.users / activeUsers) * 100) : 0 })),
    clicks: tables.clicks,
  };
}

interface FeedUser { name: string; email: string }

async function loadUsers(ids: string[]): Promise<Map<string, FeedUser>> {
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const map = new Map<string, FeedUser>();
  if (objectIds.length === 0) return map;
  const client = await clientPromise;
  const users = await client.db().collection("users")
    .find({ _id: { $in: objectIds } }, { projection: { name: 1, displayName: 1, username: 1, email: 1 } })
    .toArray();
  for (const u of users) {
    map.set(u._id.toString(), {
      name: String(u.name || u.displayName || u.username || ""),
      email: String(u.email || ""),
    });
  }
  return map;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The latest page views and clicks with the person's name and email. `q` searches name, email, page and label. */
export async function getUsageFeed(options: { days: number; surface: string | null; q?: string; limit?: number; userId?: string }) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTIONS.USAGE_EVENTS);
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const match: Record<string, unknown> = { ...matchFor(options.days, options.surface, options.userId), type: { $in: ["view", "click"] } };

  const q = (options.q || "").trim().slice(0, 80);
  if (q && !options.userId) {
    const rx = new RegExp(escapeRegex(q), "i");
    const people = await client.db().collection("users")
      .find({ $or: [{ email: rx }, { name: rx }, { displayName: rx }] }, { projection: { _id: 1 } })
      .limit(100)
      .toArray();
    match.$or = [
      { userId: { $in: people.map((p) => p._id.toString()) } },
      { page: rx },
      { label: rx },
    ];
  }

  const events = await col.find(match).sort({ ts: -1 }).limit(limit).toArray();
  const users = await loadUsers([...new Set(events.map((e) => e.userId as string | null).filter((id): id is string => Boolean(id)))]);
  return events.map((e) => {
    const who = e.userId ? users.get(e.userId as string) : undefined;
    return {
      id: e._id.toString(),
      ts: (e.ts as Date).toISOString(),
      userId: (e.userId as string | null) ?? null,
      name: who?.name || "",
      email: who?.email || "",
      surface: e.surface as string,
      type: e.type as string,
      page: e.page as string,
      label: (e.label as string | undefined) ?? "",
      area: (e.area as string | undefined) ?? "",
    };
  });
}

/** Everything for one person: most used pages, most clicked controls, daily trend, latest activity. */
export async function getUserUsage(userId: string, days: number) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTIONS.USAGE_EVENTS);
  const match = matchFor(days, null, userId);
  const [totalsAgg, surfacesAgg, span, byDay, tables, recent, users] = await Promise.all([
    col.aggregate([{ $match: match }, { $group: { _id: "$type", n: { $sum: 1 } } }]).toArray(),
    col.aggregate([
      { $match: match },
      { $group: { _id: "$surface", views: { $sum: isType("view") }, clicks: { $sum: isType("click") } } },
    ]).toArray(),
    col.aggregate([
      { $match: { userId } },
      { $group: { _id: null, firstSeen: { $min: "$ts" }, lastSeen: { $max: "$ts" }, sessions: { $addToSet: "$sessionId" } } },
    ]).toArray(),
    dailySeries(match),
    pageAndClickTables(match, 40),
    getUsageFeed({ days, surface: null, userId, limit: 100 }),
    loadUsers([userId]),
  ]);
  const count = (type: string) => totalsAgg.find((t) => t._id === type)?.n ?? 0;
  const who = users.get(userId);
  return {
    days,
    user: { id: userId, name: who?.name || "", email: who?.email || "" },
    totals: { views: count("view"), clicks: count("click") },
    firstSeen: span[0]?.firstSeen ? (span[0].firstSeen as Date).toISOString() : null,
    lastSeen: span[0]?.lastSeen ? (span[0].lastSeen as Date).toISOString() : null,
    sessions: Array.isArray(span[0]?.sessions) ? (span[0].sessions as unknown[]).length : 0,
    surfaces: surfacesAgg.map((s) => ({ surface: s._id as string, views: s.views as number, clicks: s.clicks as number })),
    byDay,
    pages: tables.pages,
    clicks: tables.clicks,
    recent,
  };
}
