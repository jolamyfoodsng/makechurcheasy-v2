/**
 * broadcastTracking.ts — who received, opened and clicked an Admin > Broadcast Email.
 *
 * Every send writes one `broadcast_email_recipients` document. The email carries a
 * signed 1×1 image (open) and its links go through a signed redirect (click), both
 * served by /api/email/track/*. Signing stops anyone forging events for another
 * person or turning the redirect into an open redirect.
 *
 * Opens are approximate: some mail apps load images for privacy reasons (counting an
 * open that didn't happen) and others block them (missing a real one). Clicks are the
 * reliable signal.
 */

import crypto from "crypto";
import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import { COLLECTIONS } from "./db";
import { emailLinkSecret } from "./emailUnsubscribe";

export interface BroadcastRecipient {
  _id?: ObjectId;
  campaignId: string;
  userId: string;
  email: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
  openedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  lastClickedAt: string | null;
  clickCount: number;
  clicks: Array<{ url: string; at: string }>;
}

/** Keeps a recipient document small when someone clicks the same email many times. */
const MAX_CLICKS_KEPT = 20;

function trackingBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com").replace(/\/$/, "");
}

function sign(parts: string[]): string {
  return crypto.createHmac("sha256", emailLinkSecret()).update(`broadcast:${parts.join(":")}`).digest("hex").slice(0, 32);
}

export function verifyTrackingSignature(parts: string[], signature: unknown): boolean {
  if (typeof signature !== "string") return false;
  const expected = sign(parts);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function buildOpenPixelUrl(campaignId: string, userId: string): string {
  const params = new URLSearchParams({ c: campaignId, u: userId, s: sign(["open", campaignId, userId]) });
  return `${trackingBase()}/api/email/track/open?${params.toString()}`;
}

export function buildClickUrl(campaignId: string, userId: string, url: string): string {
  const params = new URLSearchParams({ c: campaignId, u: userId, url, s: sign(["click", campaignId, userId, url]) });
  return `${trackingBase()}/api/email/track/click?${params.toString()}`;
}

function decodeHtmlAttr(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function encodeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Routes every web link through the click tracker (except `skipUrls`) and adds the open pixel. */
export function instrumentBroadcastHtml(html: string, campaignId: string, userId: string, skipUrls: string[] = []): string {
  const skip = new Set(skipUrls);
  const tracked = html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (match, quote: string, rawUrl: string) => {
    const url = decodeHtmlAttr(rawUrl);
    if (skip.has(url)) return match;
    return `href=${quote}${encodeHtmlAttr(buildClickUrl(campaignId, userId, url))}${quote}`;
  });
  const pixel = `<img src="${encodeHtmlAttr(buildOpenPixelUrl(campaignId, userId))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`;
  return /<\/body>/i.test(tracked) ? tracked.replace(/<\/body>/i, `${pixel}</body>`) : `${tracked}${pixel}`;
}

let indexesReady: Promise<unknown> | null = null;

async function recipientsCollection() {
  const db = (await clientPromise).db();
  const col = db.collection<BroadcastRecipient>(COLLECTIONS.BROADCAST_RECIPIENTS);
  indexesReady ??= Promise.all([
    col.createIndex({ campaignId: 1, userId: 1 }, { unique: true }),
    col.createIndex({ campaignId: 1, sentAt: -1 }),
  ]).catch((err) => {
    indexesReady = null;
    console.error("[BroadcastTracking] Index creation failed:", err);
  });
  await indexesReady;
  return col;
}

export async function recordBroadcastDelivery(input: {
  campaignId: string;
  userId: string;
  email: string;
  sent: boolean;
  error?: string | null;
}): Promise<void> {
  const col = await recipientsCollection();
  await col.updateOne(
    { campaignId: input.campaignId, userId: input.userId },
    {
      $set: {
        email: input.email,
        status: input.sent ? "sent" : "failed",
        error: input.sent ? null : input.error || "Delivery failed",
        sentAt: new Date().toISOString(),
      },
      $setOnInsert: {
        openedAt: null,
        lastOpenedAt: null,
        openCount: 0,
        clickedAt: null,
        lastClickedAt: null,
        clickCount: 0,
        clicks: [],
      },
    },
    { upsert: true }
  );
}

export async function recordBroadcastOpen(campaignId: string, userId: string): Promise<void> {
  const col = await recipientsCollection();
  const now = new Date().toISOString();
  await col.updateOne({ campaignId, userId, openedAt: null }, { $set: { openedAt: now } });
  await col.updateOne({ campaignId, userId }, { $set: { lastOpenedAt: now }, $inc: { openCount: 1 } });
}

export async function recordBroadcastClick(campaignId: string, userId: string, url: string): Promise<void> {
  const col = await recipientsCollection();
  const now = new Date().toISOString();
  // A click means the email was opened, even when the mail app blocked the image.
  await col.updateOne({ campaignId, userId, openedAt: null }, { $set: { openedAt: now, lastOpenedAt: now } });
  await col.updateOne({ campaignId, userId, clickedAt: null }, { $set: { clickedAt: now } });
  await col.updateOne(
    { campaignId, userId },
    {
      $set: { lastClickedAt: now },
      $inc: { clickCount: 1 },
      $push: { clicks: { $each: [{ url, at: now }], $slice: -MAX_CLICKS_KEPT } },
    }
  );
}

export interface BroadcastEngagement {
  delivered: number;
  opened: number;
  clicked: number;
}

/** Unique opens and clicks per campaign, for the campaign list. */
export async function getBroadcastEngagement(campaignIds: string[]): Promise<Map<string, BroadcastEngagement>> {
  const result = new Map<string, BroadcastEngagement>();
  if (!campaignIds.length) return result;
  const col = await recipientsCollection();
  const rows = await col
    .aggregate<{ _id: string; delivered: number; opened: number; clicked: number }>([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: "$campaignId",
          delivered: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $ne: ["$openedAt", null] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $ne: ["$clickedAt", null] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  for (const row of rows) result.set(row._id, { delivered: row.delivered, opened: row.opened, clicked: row.clicked });
  return result;
}

export type RecipientFilter = "all" | "opened" | "clicked" | "not_opened" | "failed";

/** The people a campaign went to, with when they opened and what they clicked. */
export async function listBroadcastRecipients(campaignId: string, filter: RecipientFilter = "all", limit = 500) {
  const col = await recipientsCollection();
  const query: Record<string, unknown> = { campaignId };
  if (filter === "opened") query.openedAt = { $ne: null };
  if (filter === "clicked") query.clickedAt = { $ne: null };
  if (filter === "not_opened") Object.assign(query, { openedAt: null, status: "sent" });
  if (filter === "failed") query.status = "failed";
  const docs = await col.find(query).sort({ lastClickedAt: -1, lastOpenedAt: -1, sentAt: -1 }).limit(limit).toArray();
  return docs.map(({ _id, ...doc }) => ({ ...doc, _id: _id?.toString() }));
}

export function isTrackableCampaignId(value: unknown): value is string {
  return typeof value === "string" && ObjectId.isValid(value);
}
