import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import {
  escapeTelegramHtml,
  formatPlanName,
  sendTelegramMessage,
  type NotificationEnv,
} from "./telegramNotifications";

/**
 * Internal team alert for every finished payment, successful or failed.
 *
 * Webhooks and verify/status callbacks can both see the same payment, so each
 * (provider, reference, outcome) is claimed once in Mongo before sending.
 * Callers fire and forget via `reportPaymentToTelegram`; nothing here throws.
 */

export const PAYMENT_NOTIFICATIONS_COLLECTION = "telegram_payment_notifications";

export type PaymentOutcome = "success" | "failed";

export interface TelegramPaymentDetails {
  outcome: PaymentOutcome;
  provider: string;
  reference: string;
  userId?: string | null;
  name?: unknown;
  email?: unknown;
  churchName?: unknown;
  plan?: string | null;
  billingCycle?: string | null;
  /** Plan credits allocated, or transcription credits bought on a top-up. */
  credits?: number | null;
  purchase?: "plan" | "credits";
  amount?: number | null;
  currency?: string | null;
  failureReason?: unknown;
  /** Which path saw the payment finish, e.g. "webhook" or "status check". */
  source?: string;
  occurredAt?: string | Date;
}

export interface PaymentNotificationStore {
  /** Returns true when this key has not been notified before. */
  claim(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface PaymentUserProfile {
  name?: unknown;
  email?: unknown;
  churchName?: unknown;
}

export interface PaymentNotificationDeps {
  env?: NotificationEnv;
  store?: PaymentNotificationStore;
  lookupUser?: (userId: string) => Promise<PaymentUserProfile | null>;
  send?: (text: string, env: NotificationEnv) => Promise<boolean>;
}

const PROVIDER_NAMES: Record<string, string> = {
  flutterwave: "Flutterwave",
  mtn_momo: "MTN MoMo",
  nowpayments: "NOWPayments",
  paystack: "Paystack",
};

function displayProvider(provider: string): string {
  const key = String(provider || "").trim().toLowerCase();
  return PROVIDER_NAMES[key] || String(provider || "").trim() || "Unknown";
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function displayAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Unknown";
  const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${text(currency).toUpperCase()} ${formatted}`.trim();
}

function displayPurchase(details: TelegramPaymentDetails): string {
  const credits = typeof details.credits === "number" && Number.isFinite(details.credits)
    ? `${details.credits.toLocaleString("en-US")} credits`
    : "";
  if (details.purchase === "credits") return credits ? `Top-up: ${credits}` : "Credit top-up";

  const plan = details.plan ? `${formatPlanName(details.plan)} plan` : "Plan";
  const cycle = text(details.billingCycle);
  const parts = [cycle ? `${plan} (${cycle})` : plan];
  if (credits) parts.push(credits);
  return parts.join(" · ");
}

function displayTime(value: string | Date | undefined, env: NotificationEnv): string {
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

export function paymentNotificationKey(details: Pick<TelegramPaymentDetails, "provider" | "reference" | "outcome">): string {
  return `${text(details.provider).toLowerCase()}:${text(details.reference)}:${details.outcome}`;
}

export function buildTelegramPaymentMessage(
  details: TelegramPaymentDetails,
  env: NotificationEnv = process.env,
): string {
  const succeeded = details.outcome === "success";
  const church = text(details.churchName);
  const lines = [
    succeeded ? "✅ <b>Payment successful</b>" : "❌ <b>Payment failed</b>",
    `<b>Name:</b> ${escapeTelegramHtml(text(details.name) || "Unknown")}`,
    `<b>Email:</b> ${escapeTelegramHtml(text(details.email) || "Unknown")}`,
    ...(church ? [`<b>Church:</b> ${escapeTelegramHtml(church)}`] : []),
    `<b>Purchase:</b> ${escapeTelegramHtml(displayPurchase(details))}`,
    `<b>Amount:</b> ${escapeTelegramHtml(displayAmount(details.amount, details.currency))}`,
    `<b>Provider:</b> ${escapeTelegramHtml(displayProvider(details.provider))}`,
    `<b>Reference:</b> <code>${escapeTelegramHtml(text(details.reference) || "Unknown")}</code>`,
  ];
  if (!succeeded) {
    lines.push(`<b>Reason:</b> ${escapeTelegramHtml(text(details.failureReason) || "Not given")}`);
  }
  if (details.source) lines.push(`<b>Via:</b> ${escapeTelegramHtml(details.source)}`);
  lines.push(`<b>Time:</b> ${escapeTelegramHtml(displayTime(details.occurredAt, env))}`);
  return lines.join("\n");
}

// Keeps repeat callbacks inside one process from touching the database.
const recentlyClaimed = new Set<string>();
const RECENT_CLAIM_LIMIT = 2_000;

function rememberClaim(key: string) {
  recentlyClaimed.add(key);
  if (recentlyClaimed.size > RECENT_CLAIM_LIMIT) {
    const oldest = recentlyClaimed.values().next().value;
    if (oldest !== undefined) recentlyClaimed.delete(oldest);
  }
}

export function resetPaymentNotificationStateForTests() {
  recentlyClaimed.clear();
}

const mongoStore: PaymentNotificationStore = {
  async claim(key) {
    const db = (await clientPromise).db();
    try {
      await db.collection<{ _id: string; createdAt: string }>(PAYMENT_NOTIFICATIONS_COLLECTION)
        .insertOne({ _id: key, createdAt: new Date().toISOString() });
      return true;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return false;
      throw error;
    }
  },
  async release(key) {
    const db = (await clientPromise).db();
    await db.collection<{ _id: string }>(PAYMENT_NOTIFICATIONS_COLLECTION).deleteOne({ _id: key });
  },
};

async function lookupUserFromDb(userId: string): Promise<PaymentUserProfile | null> {
  const db = (await clientPromise).db();
  let filter: Record<string, unknown>;
  try {
    filter = { _id: new ObjectId(userId) };
  } catch {
    return null;
  }
  const user = await db.collection("users").findOne(filter, { projection: { name: 1, email: 1, churchName: 1 } });
  if (!user) return null;
  return { name: user.name, email: user.email, churchName: user.churchName };
}

function telegramConfigured(env: NotificationEnv): boolean {
  const disabled = ["0", "false", "off"].includes(env.TELEGRAM_NOTIFICATIONS_ENABLED?.trim().toLowerCase() || "");
  return !disabled && Boolean(env.TELEGRAM_BOT_TOKEN?.trim()) && Boolean(env.TELEGRAM_CHAT_ID?.trim());
}

let warnedMissingConfig = false;

/** Sends the payment alert once per (provider, reference, outcome). Never throws. */
export async function notifyTelegramPayment(
  details: TelegramPaymentDetails,
  deps: PaymentNotificationDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  const store = deps.store ?? mongoStore;
  const send = deps.send ?? ((message: string, sendEnv: NotificationEnv) => sendTelegramMessage(message, sendEnv));

  try {
    if (!text(details.reference)) return false;
    if (!telegramConfigured(env)) {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        console.warn("[telegram] Payment alerts skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set, or TELEGRAM_NOTIFICATIONS_ENABLED is off.");
      }
      return false;
    }

    const key = paymentNotificationKey(details);
    if (recentlyClaimed.has(key)) return false;
    rememberClaim(key);
    // If the claim store is unreachable, the in-process guard above still applies.
    const claimed = await store.claim(key).catch((error) => {
      console.warn("[telegram] Payment alert dedupe unavailable:", error instanceof Error ? error.message : error);
      return true;
    });
    if (!claimed) return false;

    let enriched = details;
    if (details.userId && (!text(details.name) || !text(details.email) || !text(details.churchName))) {
      const profile = await (deps.lookupUser ?? lookupUserFromDb)(details.userId).catch(() => null);
      if (profile) {
        enriched = {
          ...details,
          name: text(details.name) ? details.name : profile.name,
          email: text(details.email) ? details.email : profile.email,
          churchName: text(details.churchName) ? details.churchName : profile.churchName,
        };
      }
    }

    const sent = await send(buildTelegramPaymentMessage(enriched, env), env);
    if (!sent) {
      // Let a later callback for the same payment try again.
      recentlyClaimed.delete(key);
      await store.release(key).catch(() => { });
    }
    return sent;
  } catch (error) {
    console.warn("[telegram] Payment alert failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Fire-and-forget wrapper for payment routes: never awaits, never throws. */
export function reportPaymentToTelegram(details: TelegramPaymentDetails, deps?: PaymentNotificationDeps): void {
  void notifyTelegramPayment(details, deps).catch(() => { });
}

/** Builds alert details from a stored Flutterwave / MoMo / NOWPayments intent. */
export function paymentDetailsFromIntent(
  intent: Record<string, any> | null | undefined,
  base: Pick<TelegramPaymentDetails, "outcome" | "provider" | "reference"> & Partial<TelegramPaymentDetails>,
): TelegramPaymentDetails {
  const metadata = (intent?.metadata || {}) as Record<string, any>;
  const amount = Number(intent?.expectedAmount ?? intent?.amount);
  return {
    userId: intent?.userId ? String(intent.userId) : null,
    email: intent?.email,
    plan: intent?.plan || metadata.plan || null,
    billingCycle: intent?.billingCycle || metadata.billingCycle || null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: intent?.expectedCurrency || intent?.currency || null,
    ...base,
  };
}
