import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import {
  escapeTelegramHtml,
  formatPlanName,
  sendTelegramMessage,
  type NotificationEnv,
} from "./telegramNotifications";

/**
 * Internal team alert sent each time a church uses another church's referral code.
 *
 * Called from `applyReferralCode`, which every user-facing path goes through (email signup,
 * Google signup, the "Have a referral code?" page and the dashboard Referrals page), and only
 * when a new referral record is created. Callers fire and forget via `reportReferralUsedToTelegram`;
 * nothing here throws.
 */

export interface ReferralPerson {
  name?: unknown;
  email?: unknown;
  churchName?: unknown;
  plan?: unknown;
}

export interface TelegramReferralUsedDetails {
  code: string;
  referrerUserId: string;
  referredUserId: string;
  /** "paid" when the new church had already paid by the time the code was applied. */
  status?: string;
  referrer?: ReferralPerson | null;
  referred?: ReferralPerson | null;
  appliedAt?: string | Date;
}

export interface ReferralNotificationDeps {
  env?: NotificationEnv;
  lookupUser?: (userId: string) => Promise<ReferralPerson | null>;
  send?: (text: string, env: NotificationEnv) => Promise<boolean>;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function displayTelegramTime(value: string | Date | undefined, env: NotificationEnv): string {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "Unknown";
  try {
    return new Intl.DateTimeFormat("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: env.TELEGRAM_NOTIFICATION_TIMEZONE?.trim() || "Africa/Lagos",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function personLines(person: ReferralPerson | null | undefined): string[] {
  return [
    `• <b>Name:</b> ${escapeTelegramHtml(text(person?.name) || "Unknown")}`,
    `• <b>Church:</b> ${escapeTelegramHtml(text(person?.churchName) || "Unknown")}`,
    `• <b>Email:</b> ${escapeTelegramHtml(text(person?.email) || "Unknown")}`,
  ];
}

export function buildTelegramReferralUsedMessage(
  details: TelegramReferralUsedDetails,
  env: NotificationEnv = process.env,
): string {
  const lines = [
    "🤝 <b>Referral code used</b>",
    `<b>Code:</b> <code>${escapeTelegramHtml(text(details.code) || "Unknown")}</code>`,
    "",
    "<b>Used by (new church)</b>",
    ...personLines(details.referred),
  ];
  const plan = text(details.referred?.plan);
  if (details.status === "paid") {
    lines.push(`• <b>Status:</b> Already paid${plan ? ` (${escapeTelegramHtml(formatPlanName(plan))})` : ""}`);
  }
  lines.push(
    "",
    "<b>Code owner (referrer)</b>",
    ...personLines(details.referrer),
    "",
    `<b>Time:</b> ${escapeTelegramHtml(displayTelegramTime(details.appliedAt, env))}`,
  );
  return lines.join("\n");
}

export async function lookupReferralPersonFromDb(userId: string): Promise<ReferralPerson | null> {
  let _id: ObjectId;
  try {
    _id = new ObjectId(userId);
  } catch {
    return null;
  }
  const db = (await clientPromise).db();
  const user = await db.collection("users").findOne(
    { _id },
    { projection: { name: 1, email: 1, churchName: 1, plan: 1 } },
  );
  if (!user) return null;
  return { name: user.name, email: user.email, churchName: user.churchName, plan: user.plan };
}

/** Sends the "referral code used" alert. Never throws. */
export async function notifyTelegramReferralUsed(
  details: TelegramReferralUsedDetails,
  deps: ReferralNotificationDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  const send = deps.send ?? ((message: string, sendEnv: NotificationEnv) => sendTelegramMessage(message, sendEnv));
  const lookupUser = deps.lookupUser ?? lookupReferralPersonFromDb;

  try {
    const [referrer, referred] = await Promise.all([
      details.referrer ?? lookupUser(details.referrerUserId).catch(() => null),
      details.referred ?? lookupUser(details.referredUserId).catch(() => null),
    ]);
    return await send(buildTelegramReferralUsedMessage({ ...details, referrer, referred }, env), env);
  } catch (error) {
    console.warn("[telegram] Referral alert failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Fire-and-forget wrapper: never awaits, never throws, never blocks applying a code. */
export function reportReferralUsedToTelegram(
  details: TelegramReferralUsedDetails,
  deps?: ReferralNotificationDeps,
): void {
  void notifyTelegramReferralUsed(details, deps).catch(() => { });
}

// ─── Daily payout digest ─────────────────────────────────────────────────────

/** Minimal referral fields the digest needs (a subset of `ReferralRecord`). */
export interface OwedReferralRecord {
  code: string;
  referrerUserId: string;
  status: string;
  paidAt?: string | null;
  paidAmount?: number | null;
  paidCurrency?: string | null;
  payoutPaidAt?: string | null;
}

export interface OwedReferrerPayout {
  referrerUserId: string;
  code: string;
  referrer: ReferralPerson | null;
  owedReferrals: number;
  /** What the referred churches paid, per currency. Context for working out the reward. */
  paidByCurrency: Record<string, number>;
  oldestPaidAt: string | null;
}

export interface ReferralPayoutDigestDetails {
  dateLabel: string;
  referrers: OwedReferrerPayout[];
}

/** A referral is owed when its church has paid and the referrer has not been paid out. */
export function isReferralPayoutOwed(referral: Pick<OwedReferralRecord, "status" | "payoutPaidAt">): boolean {
  return referral.status === "paid" && !referral.payoutPaidAt;
}

/** Groups owed referrals by referrer, most owed (then longest waiting) first. */
export function groupOwedReferralPayouts(
  referrals: OwedReferralRecord[],
  referrersById: Map<string, ReferralPerson | null> = new Map(),
): OwedReferrerPayout[] {
  const byReferrer = new Map<string, OwedReferrerPayout>();
  for (const referral of referrals) {
    if (!isReferralPayoutOwed(referral)) continue;
    let entry = byReferrer.get(referral.referrerUserId);
    if (!entry) {
      entry = {
        referrerUserId: referral.referrerUserId,
        code: referral.code,
        referrer: referrersById.get(referral.referrerUserId) ?? null,
        owedReferrals: 0,
        paidByCurrency: {},
        oldestPaidAt: null,
      };
      byReferrer.set(referral.referrerUserId, entry);
    }
    entry.owedReferrals += 1;
    if (typeof referral.paidAmount === "number" && Number.isFinite(referral.paidAmount) && referral.paidAmount > 0) {
      const currency = text(referral.paidCurrency).toUpperCase() || "?";
      entry.paidByCurrency[currency] = (entry.paidByCurrency[currency] || 0) + referral.paidAmount;
    }
    if (referral.paidAt && (!entry.oldestPaidAt || referral.paidAt < entry.oldestPaidAt)) {
      entry.oldestPaidAt = referral.paidAt;
    }
  }
  return [...byReferrer.values()].sort((a, b) =>
    b.owedReferrals - a.owedReferrals
    || String(a.oldestPaidAt || "").localeCompare(String(b.oldestPaidAt || "")));
}

function formatMoney(paidByCurrency: Record<string, number>): string {
  return Object.entries(paidByCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
    .join(" + ");
}

/** Telegram allows 4,096 characters per message; leave room for the footer. */
const DIGEST_MAX_CHARS = 3_700;

function digestBlock(item: OwedReferrerPayout, position: number): string[] {
  const name = text(item.referrer?.name) || text(item.referrer?.email) || "Unknown";
  const church = text(item.referrer?.churchName);
  const email = text(item.referrer?.email);
  const block = [
    "",
    `${position}. <b>${escapeTelegramHtml(name)}</b>${church ? ` — ${escapeTelegramHtml(church)}` : ""}`,
  ];
  if (email && email !== name) block.push(`   ${escapeTelegramHtml(email)}`);
  block.push(
    `   Code <code>${escapeTelegramHtml(item.code)}</code> · ${item.owedReferrals} unpaid ${item.owedReferrals === 1 ? "referral" : "referrals"}`,
  );
  const money = formatMoney(item.paidByCurrency);
  if (money) block.push(`   Their churches paid: ${escapeTelegramHtml(money)}`);
  if (item.oldestPaidAt) block.push(`   Waiting since: ${escapeTelegramHtml(item.oldestPaidAt.slice(0, 10))}`);
  return block;
}

export function buildTelegramReferralPayoutDigestMessage(details: ReferralPayoutDigestDetails): string {
  const header = [
    "💸 <b>Referral payouts owed</b>",
    `<b>Date:</b> ${escapeTelegramHtml(details.dateLabel)}`,
  ];
  if (details.referrers.length === 0) {
    return [...header, "", "✅ Every referrer has been paid. Nothing owed today."].join("\n");
  }

  const totalOwed = details.referrers.reduce((sum, item) => sum + item.owedReferrals, 0);
  const lines = [
    ...header,
    `<b>Referrers owed:</b> ${details.referrers.length} · <b>Unpaid referrals:</b> ${totalOwed}`,
  ];

  let length = lines.join("\n").length;
  let shown = 0;
  for (const item of details.referrers) {
    const block = digestBlock(item, shown + 1);
    const blockLength = block.join("\n").length + 1;
    if (length + blockLength > DIGEST_MAX_CHARS) break;
    lines.push(...block);
    length += blockLength;
    shown += 1;
  }

  const hidden = details.referrers.length - shown;
  if (hidden > 0) lines.push("", `…and ${hidden} more. See Admin → Referrals.`);
  lines.push("", "Mark payouts as sent in Admin → Referrals.");
  return lines.join("\n");
}

/** Loads every owed referral and its referrer from the database. */
export async function loadOwedReferralPayouts(): Promise<OwedReferrerPayout[]> {
  const db = (await clientPromise).db();
  const referrals = await db
    .collection<OwedReferralRecord>("referrals")
    .find(
      { status: "paid", $or: [{ payoutPaidAt: { $exists: false } }, { payoutPaidAt: null }, { payoutPaidAt: "" }] },
      { projection: { code: 1, referrerUserId: 1, status: 1, paidAt: 1, paidAmount: 1, paidCurrency: 1, payoutPaidAt: 1 } },
    )
    .toArray();

  const ids = [...new Set(referrals.map((referral) => referral.referrerUserId))]
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is ObjectId => Boolean(id));
  const users = ids.length
    ? await db
      .collection("users")
      .find({ _id: { $in: ids } }, { projection: { name: 1, email: 1, churchName: 1, referralCode: 1 } })
      .toArray()
    : [];
  const referrersById = new Map<string, ReferralPerson | null>(
    users.map((user) => [user._id.toString(), { name: user.name, email: user.email, churchName: user.churchName }]),
  );
  const grouped = groupOwedReferralPayouts(referrals, referrersById);
  // Show the referrer's current code where we have it.
  const codes = new Map(users.map((user) => [user._id.toString(), text(user.referralCode)]));
  return grouped.map((item) => ({ ...item, code: codes.get(item.referrerUserId) || item.code }));
}

export function notifyTelegramReferralPayoutDigest(
  details: ReferralPayoutDigestDetails,
  env: NotificationEnv = process.env,
): Promise<boolean> {
  return sendTelegramMessage(buildTelegramReferralPayoutDigestMessage(details), env);
}
