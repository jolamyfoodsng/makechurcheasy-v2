/**
 * broadcastEmail.ts — Admin > Broadcast Email.
 *
 * Lets an admin compose one email and send it to an audience segment (reusing the
 * same audience matching as Announcements). Every send is recorded as a
 * `broadcast_campaigns` document so the admin page can show recipients/sent/failed
 * after the fact, and so a scheduled send can be picked up later by the cron
 * dispatcher instead of the original admin request.
 */

import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import { COLLECTIONS } from "./db";
import { userMatchesAnnouncement } from "./announcements";
import type { Announcement } from "@/types/schemas";
import { sendEmail, adminBroadcastEmail, type BroadcastDiscount } from "./emailTemplates";
import { discountClaimUrl, findActiveDiscount } from "./discounts";
import { getBroadcastEngagement, instrumentBroadcastHtml, recordBroadcastDelivery } from "./broadcastTracking";
import { renderEmailHtml } from "./emailBranding";
import { buildUnsubscribeUrl } from "./emailUnsubscribe";
import { shouldSendEmail } from "./emailPreferences";

/** Stops a single request from walking the entire user base when the audience needs a lookup per person. */
export const BROADCAST_MAX_USERS_SCANNED = 100000;
/** Hard cap per campaign so a mistaken "all users" send can't fan out without bound. */
export const BROADCAST_MAX_RECIPIENTS = 20000;
/** Sent in small groups so a large audience does not flood the email provider. */
const EMAIL_BATCH_SIZE = 25;

/** Audience value for "send to the people I list" (e.g. a test to yourself). */
export const SELECTED_USERS_AUDIENCE = "selected_users";
/** Keeps "specific people" a hand-picked list rather than a second way to mail everyone. */
export const MAX_SELECTED_RECIPIENTS = 50;

/** Audiences only Broadcast Email offers, matched as the opposite of the inactive ones. */
const ACTIVE_AUDIENCE_INVERSE: Record<string, string> = {
  active_7d: "inactive_7d",
  active_30d: "inactive_30d",
};

/**
 * Who a campaign goes to: an audience segment, optionally narrowed to people running
 * certain desktop versions and, for a discount email, to people the discount applies to.
 */
export interface BroadcastTarget {
  audience: string;
  /** Version prefixes ("3" matches 3.x.x, "4.1" matches 4.1.x). Empty = any version. */
  appVersions?: string[] | null;
  /** Offer code of an active discount to attach. */
  discountCode?: string | null;
  /** With the "selected_users" audience: the account emails to send to. */
  recipientEmails?: string[] | null;
}

export function normalizeRecipientEmails(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/) : [];
  return [...new Set(raw.map((v) => String(v).trim().toLowerCase()).filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class BroadcastTargetError extends Error {}

export function normalizeAppVersionFilters(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(raw.map((v) => String(v).trim().replace(/^v/i, "")).filter((v) => /^[0-9][0-9A-Za-z.\-]*$/.test(v)))].slice(0, 20);
}

function versionMatches(version: string, filters: string[]): boolean {
  const v = version.replace(/^v/i, "");
  return filters.some((f) => v === f || v.startsWith(`${f}.`) || v.startsWith(`${f}-`));
}

/** Desktop versions per user, from their active devices. */
async function loadUserVersions(): Promise<Map<string, string[]>> {
  const client = await clientPromise;
  const rows = await client
    .db()
    .collection("devices")
    .aggregate<{ _id: string; versions: Array<string | null> }>([
      { $match: { appVersion: { $nin: [null, ""] }, $or: [{ status: "active" }, { status: { $exists: false } }] } },
      { $group: { _id: "$userId", versions: { $addToSet: "$appVersion" } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [String(r._id), (r.versions || []).map((v) => String(v || "").trim()).filter(Boolean)]));
}

/** Desktop versions in use, newest first, with how many people run each — for the admin picker. */
export async function listAppVersionsInUse(): Promise<Array<{ version: string; users: number }>> {
  const counts = new Map<string, number>();
  for (const versions of (await loadUserVersions()).values()) {
    for (const version of new Set(versions)) counts.set(version, (counts.get(version) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([version, users]) => ({ version, users }))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    .slice(0, 60);
}

/** The attached discount as the email shows it, or throws when the code is not live. */
export async function resolveBroadcastDiscount(code: string): Promise<{ announcement: Announcement; discount: BroadcastDiscount }> {
  const announcement = await findActiveDiscount(code);
  if (!announcement?.offerCode) throw new BroadcastTargetError("That discount code is not active.");
  return {
    announcement,
    discount: {
      code: announcement.offerCode,
      percentOff: Math.min(95, Math.max(1, Math.round(Number(announcement.offerDiscountPercent || 0)))),
      durationMonths: Math.min(60, Math.max(1, Math.round(Number(announcement.offerDurationMonths || 1)))),
      claimUrl: discountClaimUrl(announcement),
    },
  };
}

export type BroadcastStatus = "scheduled" | "sending" | "sent" | "failed";

export interface BroadcastCampaignStats {
  recipients: number;
  sent: number;
  failed: number;
  skippedOptOut: number;
  capped: boolean;
}

export interface BroadcastCampaign {
  _id?: ObjectId;
  subject: string;
  bodyText: string;
  /** Raw HTML pasted by the admin. When set, this replaces `bodyText` in the sent email. */
  bodyHtml: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: string;
  appVersions?: string[] | null;
  discountCode?: string | null;
  recipientEmails?: string[] | null;
  status: BroadcastStatus;
  scheduledFor: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sendStartedAt: string | null;
  sendCompletedAt: string | null;
  stats: BroadcastCampaignStats;
  error: string | null;
}

const USER_PROJECTION = {
  _id: 1,
  email: 1,
  plan: 1,
  effectivePlan: 1,
  lastLogin: 1,
  lastActive: 1,
  trial: 1,
  ambassador: 1,
  subscriptionStatus: 1,
  paymentStatus: 1,
  emailPreferences: 1,
} as const;

/** A minimal Announcement-shaped stand-in so we can reuse `userMatchesAnnouncement`'s audience logic as-is. */
function audienceMatcher(audience: string): Announcement {
  return { audience, targetUserIds: [], targetEmails: [] } as unknown as Announcement;
}

async function scanAudience(
  target: BroadcastTarget,
  onMatch?: (user: { _id: unknown; email: string }) => void
): Promise<{ recipientCount: number; skippedOptOut: number; capped: boolean; notFound: string[]; skippedIneligible: number }> {
  const client = await clientPromise;
  const db = client.db();
  const selectedEmails = target.audience === SELECTED_USERS_AUDIENCE ? normalizeRecipientEmails(target.recipientEmails) : null;
  if (selectedEmails && !selectedEmails.length) throw new BroadcastTargetError("Add at least one email address.");
  if (selectedEmails && selectedEmails.length > MAX_SELECTED_RECIPIENTS) {
    throw new BroadcastTargetError(`Specific people is limited to ${MAX_SELECTED_RECIPIENTS} addresses — use an audience for more.`);
  }
  const inverse = ACTIVE_AUDIENCE_INVERSE[target.audience];
  const fakeAnnouncement = audienceMatcher(inverse || target.audience);
  const versionFilters = normalizeAppVersionFilters(target.appVersions);
  const userVersions = versionFilters.length ? await loadUserVersions() : null;
  // A discount email only goes to people the code will actually work for.
  const discountAnnouncement = target.discountCode
    ? (await resolveBroadcastDiscount(target.discountCode)).announcement
    : null;

  const userFilter: Record<string, unknown> = selectedEmails
    ? { email: { $in: selectedEmails.map((e) => new RegExp(`^${escapeRegex(e)}$`, "i")) }, status: { $ne: "deleted" } }
    : { email: { $exists: true, $ne: null }, status: { $ne: "deleted" } };
  const cursor = db.collection("users").find(userFilter, { projection: USER_PROJECTION }).batchSize(500);
  const foundEmails = new Set<string>();
  let skippedIneligible = 0;

  let recipientCount = 0;
  let skippedOptOut = 0;
  let scanned = 0;
  let capped = false;

  for await (const user of cursor) {
    scanned += 1;
    if (scanned > BROADCAST_MAX_USERS_SCANNED) {
      capped = true;
      break;
    }
    if (!user.email) continue;
    if (selectedEmails) {
      // Hand-picked people skip the audience and version filters, but a discount
      // still only goes to someone it will work for.
      foundEmails.add(String(user.email).toLowerCase());
      if (discountAnnouncement && !(await userMatchesAnnouncement(discountAnnouncement, user))) {
        skippedIneligible += 1;
        continue;
      }
      if (!(await shouldSendEmail(user, "admin_broadcast"))) {
        skippedOptOut += 1;
        continue;
      }
      recipientCount += 1;
      onMatch?.({ _id: user._id, email: String(user.email) });
      continue;
    }
    if (userVersions) {
      const versions = userVersions.get(String(user._id)) || [];
      if (!versions.some((v) => versionMatches(v, versionFilters))) continue;
    }
    if ((await userMatchesAnnouncement(fakeAnnouncement, user)) === Boolean(inverse)) continue;
    if (discountAnnouncement && !(await userMatchesAnnouncement(discountAnnouncement, user))) continue;
    if (!(await shouldSendEmail(user, "admin_broadcast"))) {
      skippedOptOut += 1;
      continue;
    }
    if (recipientCount >= BROADCAST_MAX_RECIPIENTS) {
      capped = true;
      break;
    }
    recipientCount += 1;
    onMatch?.({ _id: user._id, email: String(user.email) });
  }

  const notFound = selectedEmails ? selectedEmails.filter((e) => !foundEmails.has(e)) : [];
  return { recipientCount, skippedOptOut, capped, notFound, skippedIneligible };
}

/** Dry run: counts who would receive the email right now, without sending or saving anything. */
export async function previewBroadcastAudience(target: BroadcastTarget) {
  return scanAudience(target);
}

export interface RenderBroadcastPreviewInput {
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  discountCode?: string;
}

/** Renders the exact email an admin is composing, without touching the database or any audience. */
export async function renderBroadcastPreviewHtml(input: RenderBroadcastPreviewInput): Promise<string> {
  const discount = input.discountCode ? (await resolveBroadcastDiscount(input.discountCode)).discount : undefined;
  const { html } = adminBroadcastEmail({
    discount,
    toEmail: "preview@example.com",
    subject: input.subject,
    bodyText: input.bodyText || "",
    bodyHtml: input.bodyHtml || undefined,
    ctaLabel: input.ctaLabel || undefined,
    ctaUrl: input.ctaUrl || undefined,
    unsubscribeUrl: "#",
  });
  return renderEmailHtml(html, { recipient: "preview@example.com" });
}

function campaignsCollection() {
  return clientPromise.then((client) => client.db().collection<BroadcastCampaign>(COLLECTIONS.BROADCAST_CAMPAIGNS));
}

function serializeCampaign(doc: BroadcastCampaign & { _id?: ObjectId }) {
  return { ...doc, _id: doc._id?.toString?.() || String(doc._id) };
}

/** Campaigns with unique opens and clicks attached. */
async function withEngagement(docs: BroadcastCampaign[]) {
  const campaigns = docs.map(serializeCampaign);
  const engagement = await getBroadcastEngagement(campaigns.map((c) => c._id));
  return campaigns.map((c) => ({ ...c, engagement: engagement.get(c._id) || { delivered: 0, opened: 0, clicked: 0 } }));
}

export async function listBroadcastCampaigns(limit = 50) {
  const col = await campaignsCollection();
  const docs = await col.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  return withEngagement(docs);
}

export async function getBroadcastCampaign(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const col = await campaignsCollection();
  const doc = await col.findOne({ _id: new ObjectId(id) });
  return doc ? (await withEngagement([doc]))[0] : null;
}

export interface CreateBroadcastInput {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  audience: string;
  appVersions?: string[] | null;
  discountCode?: string | null;
  recipientEmails?: string[] | null;
  scheduledFor?: string | null;
}

/** Creates the campaign record. Caller decides whether to send it immediately or leave it scheduled. */
export async function createBroadcastCampaign(
  input: CreateBroadcastInput,
  adminUserId: string,
  stats: BroadcastCampaignStats
): Promise<string> {
  const col = await campaignsCollection();
  const now = new Date().toISOString();
  const isScheduled = Boolean(input.scheduledFor && input.scheduledFor > now);

  const doc: BroadcastCampaign = {
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml || null,
    ctaLabel: input.ctaLabel || null,
    ctaUrl: input.ctaUrl || null,
    audience: input.audience,
    appVersions: input.appVersions?.length ? input.appVersions : null,
    discountCode: input.discountCode || null,
    recipientEmails: input.recipientEmails?.length ? input.recipientEmails : null,
    status: isScheduled ? "scheduled" : "sending",
    scheduledFor: isScheduled ? input.scheduledFor! : null,
    createdBy: adminUserId,
    createdAt: now,
    updatedAt: now,
    sendStartedAt: isScheduled ? null : now,
    sendCompletedAt: null,
    stats,
    error: null,
  };

  const result = await col.insertOne(doc as BroadcastCampaign & { _id?: ObjectId });
  return result.insertedId.toString();
}

function campaignTarget(campaign: BroadcastCampaign): BroadcastTarget {
  return {
    audience: campaign.audience,
    appVersions: campaign.appVersions,
    discountCode: campaign.discountCode,
    recipientEmails: campaign.recipientEmails,
  };
}

/**
 * Sends a campaign that is due now: re-scans the audience (membership may have shifted
 * since it was created/previewed), sends in small batches, and persists running totals
 * after every batch so the admin page can poll progress while it's in flight.
 */
export async function runBroadcastCampaign(campaignId: string): Promise<void> {
  const col = await campaignsCollection();
  const _id = new ObjectId(campaignId);
  const campaign = await col.findOne({ _id });
  if (!campaign) return;

  await col.updateOne(
    { _id },
    { $set: { status: "sending", sendStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
  );

  let discount: BroadcastDiscount | undefined;
  if (campaign.discountCode) {
    try {
      discount = (await resolveBroadcastDiscount(campaign.discountCode)).discount;
    } catch (err) {
      // The discount ended (or was turned off) before a scheduled send: don't mail a dead code.
      const message = err instanceof Error ? err.message : String(err);
      await col.updateOne(
        { _id },
        { $set: { status: "failed", error: message, sendCompletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
      );
      return;
    }
  }

  const recipients: Array<{ id: string; email: string }> = [];
  const { skippedOptOut, capped } = await scanAudience(campaignTarget(campaign), (user) => {
    recipients.push({ id: String(user._id), email: user.email });
  });

  let sent = 0;
  let failed = 0;

  const sendOne = async (recipient: { id: string; email: string }) => {
    try {
      const unsubscribeUrl = buildUnsubscribeUrl(recipient.id);
      const message = adminBroadcastEmail({
        toEmail: recipient.email,
        subject: campaign.subject,
        bodyText: campaign.bodyText,
        bodyHtml: campaign.bodyHtml || undefined,
        ctaLabel: campaign.ctaLabel || undefined,
        ctaUrl: campaign.ctaUrl || undefined,
        unsubscribeUrl,
        discount,
      });
      message.html = instrumentBroadcastHtml(message.html, campaignId, recipient.id, [unsubscribeUrl]);
      const ok = await sendEmail(message);
      if (ok) sent += 1;
      else failed += 1;
      await recordBroadcastDelivery({ campaignId, userId: recipient.id, email: recipient.email, sent: ok }).catch((err) =>
        console.error(`[BroadcastEmail] Could not record delivery for ${recipient.email}:`, err)
      );
    } catch (err) {
      failed += 1;
      console.error(`[BroadcastEmail] Send failed for ${recipient.email}:`, err);
      await recordBroadcastDelivery({
        campaignId,
        userId: recipient.id,
        email: recipient.email,
        sent: false,
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  };

  for (let i = 0; i < recipients.length; i += EMAIL_BATCH_SIZE) {
    await Promise.allSettled(recipients.slice(i, i + EMAIL_BATCH_SIZE).map(sendOne));
    await col.updateOne(
      { _id },
      {
        $set: {
          updatedAt: new Date().toISOString(),
          "stats.recipients": recipients.length,
          "stats.sent": sent,
          "stats.failed": failed,
          "stats.skippedOptOut": skippedOptOut,
          "stats.capped": capped,
        },
      }
    );
  }

  await col.updateOne(
    { _id },
    {
      $set: {
        status: "sent",
        sendCompletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        "stats.recipients": recipients.length,
        "stats.sent": sent,
        "stats.failed": failed,
        "stats.skippedOptOut": skippedOptOut,
        "stats.capped": capped,
      },
    }
  );
}

/** Used by the cron dispatcher: campaigns scheduled for a time that has now passed. */
export async function getDueBroadcastCampaignIds(): Promise<string[]> {
  const col = await campaignsCollection();
  const now = new Date().toISOString();
  const due = await col
    .find({ status: "scheduled", scheduledFor: { $lte: now } }, { projection: { _id: 1 } })
    .limit(20)
    .toArray();
  return due.map((d) => d._id!.toString());
}
