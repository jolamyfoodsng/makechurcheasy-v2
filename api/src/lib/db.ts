/**
 * Database helper for new dashboard collections.
 *
 * Provides index initialization and CRUD operations for:
 * - church_profiles
 * - subscriptions
 * - credit_transactions
 * - security_sessions
 *
 * Extends the existing MongoDB setup without modifying the old database.
 */

import clientPromise from "./mongodb";
import { defaultSpecialOffers, sanitizeSpecialOffers } from "./specialOffers";
import type {
  ChurchProfile,
  Subscription,
  CreditTransaction,
  SecuritySession,
  PlanConfig,
  PlanEntitlements,
  UserUsage,
  Country,
  SermonSummary,
  SermonNote,
  SermonPoint,
  SyncJob,
  AnalyticsEvent,
  UserStorage,
  AppSettings,
  ReferralRecord,
} from "@/types/schemas";

// ─── Collection Names ────────────────────────────────────────────────────────

// In-memory cache for plan config — avoids expensive backfill checks on every request
let _planConfigCache: { doc: PlanConfig; ts: number } | null = null;
const PLAN_CONFIG_CACHE_TTL_MS = 60_000;

export function invalidatePlanConfigCache() {
  _planConfigCache = null;
}

export const COLLECTIONS = {
  CHURCH_PROFILES: "church_profiles",
  SUBSCRIPTIONS: "subscriptions",
  CREDIT_TRANSACTIONS: "credit_transactions",
  TRANSCRIPTION_BALANCES: "transcription_balances",
  TRANSCRIPTION_TRANSACTIONS: "transcription_transactions",
  SECURITY_SESSIONS: "security_sessions",
  PLAN_CONFIG: "plan_config",
  USER_USAGE: "user_usage",
  COUNTRIES: "countries",
  COUNTRY_PRICING: "country_pricing",
  SERMON_SUMMARIES: "sermon_summaries",
  SERMON_NOTES: "sermon_notes",
  SERMON_POINTS: "sermon_points",
  SYNC_JOBS: "sync_jobs",
  ANALYTICS_EVENTS: "analytics_events",
  USER_STORAGE: "user_storage",
  API_KEYS: "api_keys",
  API_USAGE: "api_usage",
  API_LOGS: "api_logs",
  RESERVED_EMAILS: "reserved_emails",
  TRANSCRIPTS: "transcripts",
  CUSTOM_THEMES: "custom_themes",
  PRODUCTION_THEMES: "production_themes",
  BROADCAST_GRAPHICS: "broadcast_graphics",
  TUTORIAL_PLAYLISTS: "tutorial_playlists",
  APP_SETTINGS: "app_settings",
  TRIAL_SETTINGS: "trial_settings",
  TRIAL_AUDIT_LOGS: "trial_audit_logs",
  TRIAL_NOTIFICATIONS: "trial_notifications",
  TRIAL_CLAIM_SIGNALS: "trial_claim_signals",
  TRIAL_EXPERIMENT_SETTINGS: "trial_experiment_settings",
  TRIAL_ACTIVATION_ELIGIBILITY: "trial_activation_eligibility",
  ACTIVATION_FEEDBACK: "activation_feedback",
  ACTIVITY_EVENTS: "activity_events",
  /** Page views and clicks inside the desktop app and the OBS docks (see lib/usageEvents.ts). */
  USAGE_EVENTS: "usage_events",
  ANNOUNCEMENTS: "announcements",
  ANNOUNCEMENT_DELIVERIES: "announcement_deliveries",
  DISCOUNT_REDEMPTIONS: "discount_redemptions",
  USER_OFFERS: "user_offers",
  OFFER_JOURNEYS: "offer_journeys",
  OFFER_SETTINGS: "offer_settings",
  OFFER_CLAIM_SIGNALS: "offer_claim_signals",
  REFERRALS: "referrals",
  NOWPAYMENTS_INTENTS: "nowpayments_payment_intents",
  FLUTTERWAVE_INTENTS: "flutterwave_payment_intents",
  BLOG_POSTS: "blog_posts",
} as const;

// ─── Index Initialization ────────────────────────────────────────────────────

let indexesInitialized = false;

export async function ensureIndexes() {
  if (indexesInitialized) return;

  const client = await clientPromise;
  const db = client.db();

  await Promise.all([
    // church_profiles
    db.collection(COLLECTIONS.CHURCH_PROFILES).createIndex({ userId: 1 }, { unique: true }),

    // subscriptions
    db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ userId: 1 }),
    db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ status: 1 }),

    // credit_transactions
    db.collection(COLLECTIONS.CREDIT_TRANSACTIONS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.CREDIT_TRANSACTIONS).createIndex({ userId: 1, type: 1 }),

    // transcription_balances
    db.collection(COLLECTIONS.TRANSCRIPTION_BALANCES).createIndex({ userId: 1 }, { unique: true }),

    // transcription_transactions
    db.collection(COLLECTIONS.TRANSCRIPTION_TRANSACTIONS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRANSCRIPTION_TRANSACTIONS).createIndex({ userId: 1, requestId: 1 }, { sparse: true }),

    // security_sessions
    db.collection(COLLECTIONS.SECURITY_SESSIONS).createIndex({ userId: 1, lastActive: -1 }),
    db.collection(COLLECTIONS.SECURITY_SESSIONS).createIndex(
      { userId: 1, sessionId: 1 },
      { unique: true }
    ),
    db.collection(COLLECTIONS.SECURITY_SESSIONS).createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30-day TTL
    ),

    // countries
    db.collection(COLLECTIONS.COUNTRIES).createIndex({ iso2: 1 }, { unique: true }),
    db.collection(COLLECTIONS.COUNTRIES).createIndex({ name: 1 }),

    // country_pricing (single document — no index needed beyond _id)
    db.collection(COLLECTIONS.COUNTRY_PRICING).createIndex({ _id: 1 }),

    // user_usage
    db.collection(COLLECTIONS.USER_USAGE).createIndex({ userId: 1 }, { unique: true }),

    // sermon_summaries
    db.collection(COLLECTIONS.SERMON_SUMMARIES).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.SERMON_SUMMARIES).createIndex({ userId: 1, sermonId: 1 }),

    // sermon_notes
    db.collection(COLLECTIONS.SERMON_NOTES).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.SERMON_NOTES).createIndex({ userId: 1, sermonId: 1 }),

    // sermon_points
    db.collection(COLLECTIONS.SERMON_POINTS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.SERMON_POINTS).createIndex({ userId: 1, sermonId: 1 }),

    // sync_jobs
    db.collection(COLLECTIONS.SYNC_JOBS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.SYNC_JOBS).createIndex({ userId: 1, status: 1 }),

    // analytics_events
    db.collection(COLLECTIONS.ANALYTICS_EVENTS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.ANALYTICS_EVENTS).createIndex({ userId: 1, event: 1 }),

    // user_storage
    db.collection(COLLECTIONS.USER_STORAGE).createIndex({ userId: 1 }, { unique: true }),

    // api_keys
    db.collection(COLLECTIONS.API_KEYS).createIndex({ userId: 1 }),
    db.collection(COLLECTIONS.API_KEYS).createIndex({ keyHash: 1 }, { unique: true }),

    // api_usage (rate limiting)
    db.collection(COLLECTIONS.API_USAGE).createIndex({ apiKeyId: 1, date: 1 }, { unique: true }),

    // api_logs (audit trail — TTL index auto-deletes after 30 days)
    db.collection(COLLECTIONS.API_LOGS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.API_LOGS).createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 },
    ),

    // reserved_emails (permanent — no TTL)
    db.collection(COLLECTIONS.RESERVED_EMAILS).createIndex({ email: 1 }, { unique: true }),
    db.collection(COLLECTIONS.RESERVED_EMAILS).createIndex({ userId: 1 }),

    // transcripts
    db.collection(COLLECTIONS.TRANSCRIPTS).createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRANSCRIPTS).createIndex({ ownerId: 1, title: 1 }),

    // custom_themes
    db.collection(COLLECTIONS.CUSTOM_THEMES).createIndex({ ownerId: 1, themeId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.CUSTOM_THEMES).createIndex({ ownerId: 1, createdAt: -1 }),

    // production_themes — admin-managed catalog consumed by deployed desktop apps
    db.collection(COLLECTIONS.PRODUCTION_THEMES).createIndex({ themeId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.PRODUCTION_THEMES).createIndex({ kind: 1, enabled: 1, updatedAt: -1 }),

    // broadcast_graphics — admin settings for bundled graphics + uploaded graphic packages
    db.collection(COLLECTIONS.BROADCAST_GRAPHICS).createIndex({ graphicId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.BROADCAST_GRAPHICS).createIndex({ source: 1, status: 1, sortOrder: 1 }),

    // tutorial_playlists — admin-managed detailed training catalogue for the desktop app
    db.collection(COLLECTIONS.TUTORIAL_PLAYLISTS).createIndex({ playlistId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.TUTORIAL_PLAYLISTS).createIndex({ enabled: 1, featured: -1, sortOrder: 1, updatedAt: -1 }),

    // trial_audit_logs
    db.collection(COLLECTIONS.TRIAL_AUDIT_LOGS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRIAL_AUDIT_LOGS).createIndex({ action: 1 }),

    // trial_notifications
    db.collection(COLLECTIONS.TRIAL_NOTIFICATIONS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRIAL_NOTIFICATIONS).createIndex({ sent: 1 }),

    // trial_claim_signals
    db.collection(COLLECTIONS.TRIAL_CLAIM_SIGNALS).createIndex({ signalKey: 1 }, { unique: true }),
    db.collection(COLLECTIONS.TRIAL_CLAIM_SIGNALS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRIAL_CLAIM_SIGNALS).createIndex({ status: 1, createdAt: -1 }),

    // activation feedback and experiment controls
    db.collection(COLLECTIONS.ACTIVATION_FEEDBACK).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.ACTIVATION_FEEDBACK).createIndex({ reason: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.TRIAL_EXPERIMENT_SETTINGS).createIndex({ _id: 1 }),
    db.collection(COLLECTIONS.TRIAL_ACTIVATION_ELIGIBILITY).createIndex({ userId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.TRIAL_ACTIVATION_ELIGIBILITY).createIndex({ status: 1, createdAt: -1 }),

    // product activation events
    db.collection(COLLECTIONS.ACTIVITY_EVENTS).createIndex({ userId: 1, timestamp: -1 }),
    db.collection(COLLECTIONS.ACTIVITY_EVENTS).createIndex({ event: 1, timestamp: -1 }),

    // usage_events — page views and clicks (high volume). Deleted automatically after 180 days.
    db.collection(COLLECTIONS.USAGE_EVENTS).createIndex({ userId: 1, ts: -1 }),
    db.collection(COLLECTIONS.USAGE_EVENTS).createIndex({ surface: 1, page: 1, ts: -1 }),
    db.collection(COLLECTIONS.USAGE_EVENTS).createIndex({ type: 1, ts: -1 }),
    db.collection(COLLECTIONS.USAGE_EVENTS).createIndex({ ts: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 }),

    // announcements — query by status+surfaces+publish for eligibility
    db.collection(COLLECTIONS.ANNOUNCEMENTS).createIndex({ status: 1, surfaces: 1, publishAt: 1 }),
    db.collection(COLLECTIONS.ANNOUNCEMENTS).createIndex({ createdBy: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.ANNOUNCEMENTS).createIndex({ offerCode: 1 }),

    // announcement_deliveries — query by user+surface for pending deliveries
    db.collection(COLLECTIONS.ANNOUNCEMENT_DELIVERIES).createIndex({ userId: 1, surface: 1, dismissedAt: 1 }),
    db.collection(COLLECTIONS.ANNOUNCEMENT_DELIVERIES).createIndex({ announcementId: 1, userId: 1 }),

    // discount_redemptions — prevents duplicate redemption counts when verify/webhook both run
    db.collection(COLLECTIONS.DISCOUNT_REDEMPTIONS).createIndex({ paystackReference: 1 }, { unique: true }),
    db.collection(COLLECTIONS.DISCOUNT_REDEMPTIONS).createIndex({ code: 1, createdAt: -1 }),

    // win-back offers: one offer per user per ladder rung, one journey per user per ladder
    db.collection(COLLECTIONS.USER_OFFERS).createIndex({ userId: 1, ladderId: 1, rungIndex: 1 }, { unique: true }),
    db.collection(COLLECTIONS.USER_OFFERS).createIndex({ status: 1, closesAt: 1 }),
    db.collection(COLLECTIONS.USER_OFFERS).createIndex({ ladderId: 1, rungId: 1, issuedAt: -1 }),
    db.collection(COLLECTIONS.OFFER_JOURNEYS).createIndex({ userId: 1, ladderId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.OFFER_JOURNEYS).createIndex({ ladderId: 1, state: 1 }),
    db.collection(COLLECTIONS.OFFER_CLAIM_SIGNALS).createIndex({ signalKey: 1, kind: 1 }, { unique: true }),
    db.collection(COLLECTIONS.OFFER_CLAIM_SIGNALS).createIndex({ userId: 1, createdAt: -1 }),

    // referrals — one referral code per referrer and one referrer per referred user
    db.collection("users").createIndex({ referralCode: 1 }, { unique: true, sparse: true }),
    db.collection(COLLECTIONS.REFERRALS).createIndex({ referrerUserId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.REFERRALS).createIndex({ referredUserId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.REFERRALS).createIndex({ code: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.REFERRALS).createIndex({ status: 1, updatedAt: -1 }),
    db.collection(COLLECTIONS.REFERRALS).createIndex({ paidBillingReference: 1 }, { sparse: true }),

    // nowpayments_payment_intents — one hosted invoice per checkout attempt
    db.collection(COLLECTIONS.NOWPAYMENTS_INTENTS).createIndex({ orderId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.NOWPAYMENTS_INTENTS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.NOWPAYMENTS_INTENTS).createIndex({ providerInvoiceId: 1 }, { sparse: true }),
    db.collection(COLLECTIONS.NOWPAYMENTS_INTENTS).createIndex({ providerPaymentId: 1 }, { sparse: true }),

    // flutterwave_payment_intents — one hosted checkout per payment attempt
    db.collection(COLLECTIONS.FLUTTERWAVE_INTENTS).createIndex({ reference: 1 }, { unique: true }),
    db.collection(COLLECTIONS.FLUTTERWAVE_INTENTS).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.FLUTTERWAVE_INTENTS).createIndex({ providerTransactionId: 1 }, { sparse: true }),

    // blog_posts — unique slug and fast listing by status + publishedAt
    db.collection(COLLECTIONS.BLOG_POSTS).createIndex({ slug: 1 }, { unique: true }),
    db.collection(COLLECTIONS.BLOG_POSTS).createIndex({ status: 1, publishedAt: -1 }),
    db.collection(COLLECTIONS.BLOG_POSTS).createIndex({ tags: 1 }),
    db.collection(COLLECTIONS.BLOG_POSTS).createIndex({ category: 1 }),
  ]);

  indexesInitialized = true;
}

// ─── Church Profiles ─────────────────────────────────────────────────────────

export async function getChurchProfile(userId: string): Promise<ChurchProfile | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db.collection<ChurchProfile>(COLLECTIONS.CHURCH_PROFILES).findOne({ userId });
}

export async function upsertChurchProfile(
  userId: string,
  data: Partial<ChurchProfile>
): Promise<ChurchProfile> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();

  const update = {
    $set: { ...data, userId, updatedAt: now },
    $setOnInsert: { createdAt: now },
  };

  await db
    .collection<ChurchProfile>(COLLECTIONS.CHURCH_PROFILES)
    .updateOne({ userId }, update, { upsert: true });

  const profile = await getChurchProfile(userId);

  // Two-way binding: push church profile ID into user's churchProfileId
  if (profile?._id) {
    const profileId = profile._id.toString();
    await db
      .collection("users")
      .updateOne(
        { _id: new (await import("mongodb")).ObjectId(userId) },
        { $set: { churchProfileId: profileId } }
      );
  }

  return profile!;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export async function getSubscription(userId: string): Promise<Subscription | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS)
    .findOne({ userId }, { sort: { createdAt: -1 } });
}

export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();
  const filter: any = {
    userId,
    $or: [
      {
        status: "active",
        $or: [
          { currentPeriodEnd: { $exists: false } },
          { currentPeriodEnd: null },
          { currentPeriodEnd: "" },
          { currentPeriodEnd: { $gt: now } },
        ],
      },
      {
        status: "past_due",
        gracePeriodEndsAt: { $gt: now },
      },
    ],
  };
  return db
    .collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS)
    .findOne(
      filter,
      { sort: { createdAt: -1 } },
    );
}

export async function upsertSubscription(
  userId: string,
  data: Partial<Subscription>
): Promise<Subscription> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();

  const unsetFields: Record<string, ""> = {};
  const setData: Record<string, unknown> = { userId, updatedAt: now };

  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      unsetFields[key] = "";
    } else if (value !== undefined) {
      setData[key] = value;
    }
  }

  const update: {
    $set: Record<string, unknown>;
    $setOnInsert: Record<string, unknown>;
    $unset?: Record<string, "">;
  } = {
    $set: setData,
    $setOnInsert: { createdAt: now },
  };

  // Re-activating a subscription must remove any old cancellation marker.
  // Otherwise billing UIs can display a cancelled/trial state alongside an
  // active paid subscription.
  if (data.status === "active") {
    unsetFields.cancelledAt = "";
  }

  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields;
  }

  if (data.plan === "free") {
    (update.$set as Record<string, unknown>).portedToFreeAt = now;
    try {
      const { ObjectId } = await import("mongodb");
      if (ObjectId.isValid(userId)) {
        await db.collection("users").updateOne(
          { _id: new ObjectId(userId) },
          { $set: { portedToFreeAt: now } }
        );
      }
    } catch {
      // Best-effort user update
    }
  }

  // If setting to active, deactivate any other active subscription for this user
  if (data.status === "active") {
    await db
      .collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS)
      .updateMany(
        { userId, status: "active" },
        { $set: { status: "cancelled", cancelledAt: now, updatedAt: now } }
      );
  }

  const existing = await db
    .collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS)
    .findOne({ userId }, { sort: { createdAt: -1 } });

  if (existing) {
    await db
      .collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS)
      .updateOne({ _id: existing._id }, update);
  } else {
    await db.collection<Subscription>(COLLECTIONS.SUBSCRIPTIONS).insertOne({
      ...data,
      userId,
      createdAt: now,
      updatedAt: now,
    } as Subscription);
  }

  return (await getSubscription(userId))!;
}

// ─── Credit Transactions ─────────────────────────────────────────────────────

export async function getCreditTransactions(
  userId: string,
  options: { limit?: number; skip?: number; type?: string } = {}
): Promise<CreditTransaction[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 50, skip = 0, type } = options;

  const filter: Record<string, unknown> = { userId };
  if (type) filter.type = type;

  return db
    .collection<CreditTransaction>(COLLECTIONS.CREDIT_TRANSACTIONS)
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

export async function getCreditTransactionCount(
  userId: string,
  type?: string
): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const filter: Record<string, unknown> = { userId };
  if (type) filter.type = type;
  return db.collection(COLLECTIONS.CREDIT_TRANSACTIONS).countDocuments(filter);
}

export async function getCreditUsageByDay(
  userId: string,
  days: number = 7
): Promise<{ date: string; amount: number }[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const results = await db
    .collection<CreditTransaction>(COLLECTIONS.CREDIT_TRANSACTIONS)
    .aggregate([
      {
        $match: {
          userId,
          type: "usage",
          createdAt: { $gte: sinceStr },
        },
      },
      {
        $group: {
          _id: { $substr: ["$createdAt", 0, 10] }, // YYYY-MM-DD
          total: { $sum: { $abs: "$amount" } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  // Fill in missing days with 0
  const map = new Map(results.map((r) => [r._id, r.total]));
  const days_arr: { date: string; amount: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days_arr.push({ date: label, amount: map.get(key) || 0 });
  }

  return days_arr;
}

export async function insertCreditTransaction(
  data: Omit<CreditTransaction, "_id">,
  session?: import("mongodb").ClientSession,
): Promise<CreditTransaction> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  const opts: any = {};
  if (session) opts.session = session;

  const result = await db
    .collection<CreditTransaction>(COLLECTIONS.CREDIT_TRANSACTIONS)
    .insertOne(data as CreditTransaction, opts);

  // Two-way binding: push transaction ID into user's creditTransactions array
  const txId = result.insertedId.toString();
  await db
    .collection("users")
    .updateOne(
      { _id: new (await import("mongodb")).ObjectId(data.userId) },
      { $addToSet: { creditTransactions: txId } },
      opts,
    );

  return { ...data, _id: result.insertedId };
}

// ─── Security Sessions ───────────────────────────────────────────────────────

export async function getSecuritySessions(
  userId: string
): Promise<SecuritySession[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<SecuritySession>(COLLECTIONS.SECURITY_SESSIONS)
    .find({ userId })
    .sort({ lastActive: -1 })
    .toArray();
}

export async function upsertSecuritySession(
  data: SecuritySession
): Promise<SecuritySession> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  await db
    .collection<SecuritySession>(COLLECTIONS.SECURITY_SESSIONS)
    .updateOne(
      { userId: data.userId, sessionId: data.sessionId },
      { $set: data },
      { upsert: true }
    );

  return data;
}

export async function removeSecuritySession(
  userId: string,
  sessionId: string
): Promise<void> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<SecuritySession>(COLLECTIONS.SECURITY_SESSIONS)
    .deleteOne({ userId, sessionId });
}

export async function removeOtherSessions(
  userId: string,
  currentSessionId: string
): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<SecuritySession>(COLLECTIONS.SECURITY_SESSIONS)
    .deleteMany({ userId, sessionId: { $ne: currentSessionId } });
  return result.deletedCount;
}

// ─── Billing Transactions ──────────────────────────────────────────────────

interface BillingTransactionData {
  userId: string;
  plan: string;
  planName: string;
  amount: number;
  subtotal?: number;
  discount?: number;
  discountCode?: string | null;
  discountPercent?: number | null;
  discountDurationMonths?: number | null;
  currency: string;
  paymentProvider: string;
  /** Legacy Paystack reference. New providers should use providerReference. */
  paystackReference?: string;
  providerReference?: string;
  type: string;
  status: string;
  billingCycle: "monthly" | "yearly" | "lifetime" | "gift_3m" | "gift_6m" | "gift_12m";
  purchaseKind?: "subscription" | "one_time";
  oneTimeOfferId?: string | null;
  oneTimeOfferName?: string | null;
  offerOriginalPrice?: number | null;
  offerAppliedPrice?: number | null;
  trialDaysCarried?: number;
  /** Value of unused time on the previous plan that was taken off this purchase. */
  creditApplied?: number;
  creditUnusedDays?: number;
  receiptUrl?: string;
  failureCode?: string;
  failureReason?: string;
  paymentMethod?: string;
  expiresAt: string;
  paidAt: string;
  createdAt: string;
}

export async function insertBillingTransaction(
  data: BillingTransactionData
) {
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection("billing_transactions").insertOne(data as any);
  return { _id: result.insertedId };
}

export async function getBillingTransactions(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<any[]> {
  const client = await clientPromise;
  const db = client.db();
  const { limit = 50, skip = 0 } = options;
  return db
    .collection("billing_transactions")
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

export async function getBillingTransactionCount(userId: string): Promise<number> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection("billing_transactions").countDocuments({ userId });
}

export async function getBillingTransactionById(
  id: string,
): Promise<any | null> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  let objectId: any;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }
  return db.collection("billing_transactions").findOne({ _id: objectId });
}

export async function getCreditTransactionById(
  id: string,
): Promise<CreditTransaction | null> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  let objectId: any;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }
  return db
    .collection(COLLECTIONS.CREDIT_TRANSACTIONS)
    .findOne({ _id: objectId }) as Promise<CreditTransaction | null>;
}

// ─── Plan Configuration ──────────────────────────────────────────────────────

/**
 * Helper: extract the NGN monthly price from a plan tier config.
 * Handles both v1 (flat `price`) and v2 (`pricing.NGN.monthly`) formats.
 */
export function getPlanMonthlyPrice(planCfg: { price?: number; pricing?: { NGN?: { monthly?: number } } }): number {
  if (planCfg.pricing?.NGN?.monthly != null) return planCfg.pricing.NGN.monthly;
  return planCfg.price ?? 0;
}

/** Hardcoded defaults — used to seed or migrate the DB-backed plan config. */
const DEFAULT_PLAN_CONFIG: PlanConfig = {
  version: 11,
  plans: {
    trial: {
      label: "Trial",
      pricing: { NGN: { monthly: 0, yearly: 0 }, USD: { monthly: 0, yearly: 0 } },
      paystack: { monthlyPlanCode: "", yearlyPlanCode: "" },
      credits: 500,
      entitlements: {
        songs: -1, images: -1, videos: -1, themes: -1, lowerThirds: -1, devices: 10,
        bibleVersions: -1, multiviewTemplates: -1, tickerThemes: -1, themePresets: -1,
        cloudStorageGB: 5,
        multiview: true, tickers: true, massImport: true, easyWorshipImport: true,
        proPresenterImport: true, translation: true, speechToScripture: true,
        sermonExport: true, aiFeatures: true, cloudSync: true, advancedAnalytics: true,
        customReports: true, mobileControl: true, apiAccess: false, slideshow: true,
        teamManagement: false, campusManagement: false, countdowns: true,
      },
    },
    free: {
      label: "Free",
      pricing: { NGN: { monthly: 0, yearly: 0 }, USD: { monthly: 0, yearly: 0 } },
      paystack: { monthlyPlanCode: "", yearlyPlanCode: "" },
      credits: 50,
      entitlements: {
        songs: 3, images: 2, videos: 1, themes: 2, lowerThirds: 3, devices: 1,
        bibleVersions: 4, multiviewTemplates: 0, tickerThemes: 3, themePresets: 0,
        cloudStorageGB: 0.5,
        multiview: false, tickers: true, massImport: false, easyWorshipImport: false,
        proPresenterImport: false, translation: false, speechToScripture: true,
        sermonExport: false, aiFeatures: false, cloudSync: false, advancedAnalytics: false,
        customReports: false, mobileControl: false, apiAccess: false, slideshow: false,
        teamManagement: false, campusManagement: false, countdowns: false,
      },
    },
    basic: {
      label: "Basic",
      pricing: { NGN: { monthly: 4000, yearly: 40000 }, USD: { monthly: 5, yearly: 50 } },
      paystack: { monthlyPlanCode: "mce_basic_monthly", yearlyPlanCode: "mce_basic_yearly" },
      credits: 720,
      entitlements: {
        songs: 100, images: 100, videos: 100, themes: 10, lowerThirds: 15, devices: 3,
        bibleVersions: -1, multiviewTemplates: 5, tickerThemes: -1, themePresets: 3,
        cloudStorageGB: 5,
        multiview: true, tickers: true, massImport: false, easyWorshipImport: false,
        proPresenterImport: false, translation: false, speechToScripture: true,
        sermonExport: false, aiFeatures: false, cloudSync: true, advancedAnalytics: false,
        customReports: false, mobileControl: false, apiAccess: false, slideshow: true,
        teamManagement: false, campusManagement: false, countdowns: false,
      },
    },
    growth: {
      label: "Growth",
      pricing: { NGN: { monthly: 8000, yearly: 85000 }, USD: { monthly: 15, yearly: 150 } },
      paystack: { monthlyPlanCode: "mce_growth_monthly", yearlyPlanCode: "mce_growth_yearly" },
      credits: 1800,
      entitlements: {
        songs: -1, images: -1, videos: -1, themes: -1, lowerThirds: -1, devices: 10,
        bibleVersions: -1, multiviewTemplates: -1, tickerThemes: -1, themePresets: -1,
        cloudStorageGB: 20,
        multiview: true, tickers: true, massImport: true, easyWorshipImport: true,
        proPresenterImport: true, translation: true, speechToScripture: true,
        sermonExport: true, aiFeatures: true, cloudSync: true, advancedAnalytics: true,
        customReports: false, mobileControl: false, apiAccess: false, slideshow: true,
        teamManagement: false, campusManagement: false, countdowns: true,
      },
    },
  },
  creditCosts: [
    { name: "Speech-to-Scripture", cost: 1, unit: "per minute", description: "Automatically transcribe live audio and detect scripture references." },
    { name: "Live Translation", cost: 2, unit: "per minute", description: "Translate live speech into another language." },
    { name: "AI Summary", cost: 5, unit: "flat", description: "Generate a sermon summary." },
  ],
  translationWordsPerCredit: 150,
  trial: { durationDays: 30, enabled: true },
  pricingPlans: [
    {
      id: "basic",
      name: "Basic",
      target: "For small congregations getting started",
      iconName: "leaf",
      styles: { iconBg: "bg-emerald-50", iconColor: "text-emerald-500", border: "border-emerald-100", button: "bg-emerald-500 text-white", buttonHover: "hover:bg-emerald-600", checkColor: "text-emerald-500" },
      pricing: {
        NGN: { monthly: "₦3,500", originalMonthly: "₦4,000", yearly: "₦40,000" },
        USD: { monthly: "$5", yearly: "$50" },
      },
      features: [
        { text: "100 songs, 100 images, and 100 videos" },
        { text: "Unlimited Bible versions and 3 devices" },
        { text: "Bible, Worship, Media, and up to 5 multiview templates" },
        { text: "Verse AI with 100 monthly credits" },
        { text: "Up to 15 broadcast graphics and 10 themes, unlimited tickers" },
        { text: "Countdowns and transcript translation require Growth" },
      ],
      buttonText: "Get Basic",
      paystackPlanCode: "mce_basic_monthly",
      paystackAmount: { NGN: 350000, USD: 500 },
    },
    {
      id: "growth",
      name: "Growth",
      target: "For ministries scaling their production",
      iconName: "chart",
      styles: { iconBg: "bg-blue-50", iconColor: "text-blue-500", border: "border-blue-200 border-2", button: "bg-blue-600 text-white", buttonHover: "hover:bg-blue-700", popular: true, popularBadgeBg: "bg-blue-600", checkColor: "text-blue-500" },
      pricing: {
        NGN: { monthly: "₦7,500", originalMonthly: "₦8,000", yearly: "₦85,000" },
        USD: { monthly: "$15", yearly: "$150" },
      },
      features: [
        { text: "Countdowns that keep your services on time" },
        { text: "Speech-to-Scripture — never type a verse again" },
        { text: "Control everything from your phone" },
        { text: "Live Translation for multilingual congregations" },
        { text: "Import your EasyWorship library in one click" },
        { text: "Free sermon transcription with every service" },
        { text: "Unlimited themes, devices, and cloud sync" },
        { text: "2,000 AI credits per month" },
      ],
      buttonText: "Get Growth",
      paystackPlanCode: "mce_growth_monthly",
      paystackAmount: { NGN: 750000, USD: 1500 },
    },
  ],
  featureBanners: [
    {
      id: "time",
      title: "Save Hours Every Week",
      description: "Automate sermon prep with AI transcription, scripture lookup, and media import.",
      iconName: "clock",
      bg: "bg-purple-50",
      color: "text-purple-600",
    },
    {
      id: "production",
      title: "Broadcast-Quality Production",
      description: "Lower thirds, tickers, countdowns, and multi-view — without the learning curve.",
      iconName: "monitor",
      bg: "bg-blue-50",
      color: "text-blue-600",
    },
    {
      id: "reach",
      title: "Reach Every Language",
      description: "Live translation turns one sermon into a multilingual experience for your whole congregation.",
      iconName: "language",
      bg: "bg-green-50",
      color: "text-green-600",
    },
    {
      id: "control",
      title: "Control From Anywhere",
      description: "Run your media from your phone, tablet, or any device — no desk required.",
      iconName: "smartphone",
      bg: "bg-amber-50",
      color: "text-amber-600",
    },
  ],
  specialOffers: defaultSpecialOffers(),
  updatedAt: new Date().toISOString(),
};

function removeRetiredProPlan(doc: PlanConfig): PlanConfig {
  const plans = { ...(doc.plans || {}) } as Record<string, unknown>;
  const pricingPlans = doc.pricingPlans || DEFAULT_PLAN_CONFIG.pricingPlans || [];
  delete plans.pro;
  const growth = plans.growth as PlanConfig["plans"][string] | undefined;
  if (growth?.entitlements) {
    plans.growth = {
      ...growth,
      entitlements: {
        ...growth.entitlements,
        advancedAnalytics: true,
        customReports: true,
        mobileControl: true,
        apiAccess: true,
        teamManagement: true,
        campusManagement: true,
      },
    };
  }

  return {
    ...doc,
    plans: plans as PlanConfig["plans"],
    pricingPlans: pricingPlans.filter(
      (plan) => String(plan.id).toLowerCase() !== "pro",
    ),
  };
}

/**
 * Get the plan configuration from MongoDB.
 * Auto-seeds with defaults if the collection is empty.
 * The document is always keyed as _id: "default".
 */
export async function getPlanConfig(): Promise<PlanConfig> {
  if (_planConfigCache && (Date.now() - _planConfigCache.ts) < PLAN_CONFIG_CACHE_TTL_MS) {
    return _planConfigCache.doc;
  }

  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  let doc = await db
    .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
    .findOne({ _id: "default" as any }) as PlanConfig | null;

  if (!doc) {
    // Seed with defaults
    const seed: PlanConfig = { ...DEFAULT_PLAN_CONFIG, updatedAt: new Date().toISOString() };
    await db
      .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
      .updateOne({ _id: "default" as any }, { $set: seed }, { upsert: true });
    doc = seed;
  } else {
    // v11: enable the free Speech to Scripture allowance, align product limits,
    // and set the canonical Nigerian monthly prices. This is a
    // targeted migration so existing paid users receive the new entitlements
    // while preserving USD prices and unrelated plan settings.
    if ((doc.version ?? 0) < DEFAULT_PLAN_CONFIG.version) {
      const defaultBasic = DEFAULT_PLAN_CONFIG.plans.basic;
      const defaultFree = DEFAULT_PLAN_CONFIG.plans.free;
      const defaultGrowth = DEFAULT_PLAN_CONFIG.plans.growth;
      const existingBasic = (doc.plans as any)?.basic || {};
      const pricingPlans = (doc.pricingPlans || DEFAULT_PLAN_CONFIG.pricingPlans || []).map((plan) =>
        plan.id === "basic" || plan.id === "growth"
          ? (() => {
              const defaultPlan = DEFAULT_PLAN_CONFIG.pricingPlans?.find((candidate) => candidate.id === plan.id);
              return {
                ...plan,
                ...(plan.id === "basic" ? { features: defaultPlan?.features || plan.features } : {}),
                ...(defaultPlan ? {
                  pricing: { ...plan.pricing, NGN: defaultPlan.pricing.NGN },
                  ...(defaultPlan.paystackAmount
                    ? {
                        paystackAmount: {
                          NGN: defaultPlan.paystackAmount.NGN,
                          USD: plan.paystackAmount?.USD ?? defaultPlan.paystackAmount.USD,
                        },
                      }
                    : {}),
                } : {}),
              };
            })()
          : plan,
      );
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne(
          { _id: "default" as any },
          {
            $set: {
              "plans.basic": {
                ...existingBasic,
                credits: defaultBasic.credits,
                pricing: {
                  ...(existingBasic.pricing || {}),
                  NGN: defaultBasic.pricing.NGN,
                },
                entitlements: {
                  ...(existingBasic.entitlements || {}),
                  ...defaultBasic.entitlements,
                },
              },
              "plans.free.entitlements.lowerThirds": defaultFree.entitlements.lowerThirds,
              "plans.free.entitlements.countdowns": defaultFree.entitlements.countdowns,
              "plans.free.entitlements.speechToScripture": defaultFree.entitlements.speechToScripture,
              "plans.growth.entitlements.multiviewTemplates": defaultGrowth.entitlements.multiviewTemplates,
              "plans.growth.entitlements.multiview": defaultGrowth.entitlements.multiview,
              "plans.growth.entitlements.tickerThemes": defaultGrowth.entitlements.tickerThemes,
              "plans.growth.entitlements.lowerThirds": defaultGrowth.entitlements.lowerThirds,
              "plans.growth.entitlements.countdowns": defaultGrowth.entitlements.countdowns,
              "plans.growth.pricing.NGN": defaultGrowth.pricing.NGN,
              pricingPlans,
              version: DEFAULT_PLAN_CONFIG.version,
              updatedAt: new Date().toISOString(),
            },
          },
        );
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }

    // Ensure all tiers from defaults exist (backfill missing tiers like "trial")
    const missingTiers: Record<string, any> = {};
    if (!doc) throw new Error("Plan configuration could not be loaded after migration");
    for (const [tier, config] of Object.entries(DEFAULT_PLAN_CONFIG.plans)) {
      if (!(doc.plans as any)?.[tier]) {
        missingTiers[`plans.${tier}`] = config;
      }
    }
    if (Object.keys(missingTiers).length > 0) {
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne({ _id: "default" as any }, { $set: missingTiers });
      // Re-fetch with the merged tiers
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }

    // Patch free plan credits if the DB value differs from the default
    if (doc && (doc.plans as any)?.free?.credits !== DEFAULT_PLAN_CONFIG.plans.free.credits) {
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne({ _id: "default" as any }, { $set: { "plans.free.credits": DEFAULT_PLAN_CONFIG.plans.free.credits } });
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }

    // Backfill trial config if missing (schema v2 → v3 migration)
    if (doc && !doc.trial) {
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne({ _id: "default" as any }, { $set: { trial: DEFAULT_PLAN_CONFIG.trial, version: 3 } });
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }

    // Backfill pricingPlans and featureBanners if missing
    if (doc && (!doc.pricingPlans || doc.pricingPlans.length === 0)) {
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne({ _id: "default" as any }, { $set: { pricingPlans: DEFAULT_PLAN_CONFIG.pricingPlans, featureBanners: DEFAULT_PLAN_CONFIG.featureBanners } });
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }

    if (doc && !Array.isArray(doc.specialOffers)) {
      await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .updateOne({ _id: "default" as any }, { $set: { specialOffers: DEFAULT_PLAN_CONFIG.specialOffers || [], version: DEFAULT_PLAN_CONFIG.version } });
      doc = await db
        .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
        .findOne({ _id: "default" as any }) as PlanConfig | null;
    }
  }

  const sanitizedDoc = {
    ...removeRetiredProPlan(doc!),
    specialOffers: sanitizeSpecialOffers(doc!.specialOffers),
  };
  _planConfigCache = { doc: sanitizedDoc, ts: Date.now() };
  return sanitizedDoc;
}

/**
 * Upsert plan configuration (admin-only).
 * Merges provided fields into the existing document.
 */
export async function upsertPlanConfig(
  data: Partial<Omit<PlanConfig, "_id" | "updatedAt">>
): Promise<PlanConfig> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();
  const normalizedData = {
    ...data,
    ...(Array.isArray(data.specialOffers)
      ? { specialOffers: sanitizeSpecialOffers(data.specialOffers).map((offer) => ({ ...offer, updatedAt: now })) }
      : {}),
  };

  await db
    .collection<PlanConfig>(COLLECTIONS.PLAN_CONFIG)
    .updateOne(
      { _id: "default" as any },
      { $set: { ...normalizedData, updatedAt: now } },
      { upsert: true }
    );

  _planConfigCache = null;
  return getPlanConfig();
}

// ─── Countries ──────────────────────────────────────────────────────────────

/**
 * Get all countries, sorted by name. Returns an empty array if the
 * collection hasn't been seeded yet.
 */
export async function getCountries(): Promise<Country[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<Country>(COLLECTIONS.COUNTRIES)
    .find({})
    .sort({ name: 1 })
    .toArray();
}

/**
 * Upsert a batch of countries (idempotent by iso2).
 * Used by the seed endpoint.
 */
export async function upsertCountries(countries: Omit<Country, "_id">[]): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  if (countries.length === 0) return 0;

  const ops = countries.map((c) => ({
    updateOne: {
      filter: { iso2: c.iso2 },
      update: { $set: c },
      upsert: true,
    },
  }));

  const result = await db.collection(COLLECTIONS.COUNTRIES).bulkWrite(ops);
  return result.upsertedCount + result.modifiedCount;
}

// ─── User Usage Tracking ─────────────────────────────────────────────────────

/**
 * Get the user's usage record. Returns null if the user has never synced.
 */
export async function getUserUsage(userId: string): Promise<UserUsage | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db.collection<UserUsage>(COLLECTIONS.USER_USAGE).findOne({ userId });
}

/**
 * Upsert the user's usage record from a desktop sync.
 * Only updates fields that are provided (partial merge).
 * Sets lastSyncedAt to the current time.
 */
export async function upsertUserUsage(
  userId: string,
  data: Partial<Omit<UserUsage, "_id" | "userId" | "createdAt" | "updatedAt">>
): Promise<UserUsage> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { $set: { lastSyncedAt: data.lastSyncedAt || now, updatedAt: now } };
  // Only set fields that were explicitly provided
  for (const [key, val] of Object.entries(data)) {
    if (key !== "lastSyncedAt" && val !== undefined) {
      (update.$set as Record<string, unknown>)[key] = val;
    }
  }
  (update as any).$setOnInsert = { createdAt: now, userId };

  await db
    .collection<UserUsage>(COLLECTIONS.USER_USAGE)
    .updateOne({ userId }, update, { upsert: true });

  return (await getUserUsage(userId))!;
}

/**
 * Get all usage records (admin: for overview page).
 */
export async function getAllUserUsage(): Promise<UserUsage[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db.collection<UserUsage>(COLLECTIONS.USER_USAGE).find({}).toArray();
}

// ─── AI Sermon Summaries ────────────────────────────────────────────────────

export async function insertSermonSummary(
  data: Omit<SermonSummary, "_id">
): Promise<SermonSummary> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<SermonSummary>(COLLECTIONS.SERMON_SUMMARIES)
    .insertOne(data as SermonSummary);
  return { ...data, _id: result.insertedId };
}

export async function getSermonSummaries(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<SermonSummary[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 20, skip = 0 } = options;
  return db
    .collection<SermonSummary>(COLLECTIONS.SERMON_SUMMARIES)
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

export async function getSermonSummaryById(
  userId: string,
  summaryId: string
): Promise<SermonSummary | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  return db
    .collection<SermonSummary>(COLLECTIONS.SERMON_SUMMARIES)
    .findOne({ userId, _id: new ObjectId(summaryId) });
}

// ─── AI Sermon Notes ────────────────────────────────────────────────────────

export async function insertSermonNote(
  data: Omit<SermonNote, "_id">
): Promise<SermonNote> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<SermonNote>(COLLECTIONS.SERMON_NOTES)
    .insertOne(data as SermonNote);
  return { ...data, _id: result.insertedId };
}

export async function getSermonNotes(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<SermonNote[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 20, skip = 0 } = options;
  return db
    .collection<SermonNote>(COLLECTIONS.SERMON_NOTES)
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

// ─── AI Sermon Points ───────────────────────────────────────────────────────

export async function insertSermonPoint(
  data: Omit<SermonPoint, "_id">
): Promise<SermonPoint> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<SermonPoint>(COLLECTIONS.SERMON_POINTS)
    .insertOne(data as SermonPoint);
  return { ...data, _id: result.insertedId };
}

export async function getSermonPoints(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<SermonPoint[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 20, skip = 0 } = options;
  return db
    .collection<SermonPoint>(COLLECTIONS.SERMON_POINTS)
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

// ─── Cloud Sync Jobs ────────────────────────────────────────────────────────

export async function insertSyncJob(
  data: Omit<SyncJob, "_id">
): Promise<SyncJob> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<SyncJob>(COLLECTIONS.SYNC_JOBS)
    .insertOne(data as SyncJob);
  return { ...data, _id: result.insertedId };
}

export async function updateSyncJob(
  userId: string,
  jobId: string,
  update: Partial<Omit<SyncJob, "_id" | "userId" | "createdAt">>
): Promise<void> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  await db
    .collection<SyncJob>(COLLECTIONS.SYNC_JOBS)
    .updateOne({ userId, _id: new ObjectId(jobId) }, { $set: update });
}

export async function getSyncJobs(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<SyncJob[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 10, skip = 0 } = options;
  return db
    .collection<SyncJob>(COLLECTIONS.SYNC_JOBS)
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

// ─── Analytics Events ───────────────────────────────────────────────────────

export async function insertAnalyticsEvent(
  data: Omit<AnalyticsEvent, "_id">
): Promise<AnalyticsEvent> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<AnalyticsEvent>(COLLECTIONS.ANALYTICS_EVENTS)
    .insertOne(data as AnalyticsEvent);
  return { ...data, _id: result.insertedId };
}

export async function getAnalyticsEvents(
  userId: string,
  options: { limit?: number; skip?: number; event?: string; since?: string } = {}
): Promise<AnalyticsEvent[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { limit = 100, skip = 0, event, since } = options;

  const filter: Record<string, unknown> = { userId };
  if (event) filter.event = event;
  if (since) filter.createdAt = { $gte: since };

  return db
    .collection<AnalyticsEvent>(COLLECTIONS.ANALYTICS_EVENTS)
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

export async function getAnalyticsAggregation(
  userId: string,
  days: number = 30
): Promise<{ event: string; count: number }[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const results = await db
    .collection<AnalyticsEvent>(COLLECTIONS.ANALYTICS_EVENTS)
    .aggregate([
      { $match: { userId, createdAt: { $gte: sinceStr } } },
      { $group: { _id: "$event", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, event: "$_id", count: 1 } },
    ])
    .toArray();

  return results as { event: string; count: number }[];
}

// ─── User Storage ───────────────────────────────────────────────────────────

export async function getUserStorage(userId: string): Promise<UserStorage | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db.collection<UserStorage>(COLLECTIONS.USER_STORAGE).findOne({ userId });
}

export async function upsertUserStorage(
  userId: string,
  data: { usedBytes: number; quotaBytes: number }
): Promise<UserStorage> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();

  await db
    .collection<UserStorage>(COLLECTIONS.USER_STORAGE)
    .updateOne(
      { userId },
      {
        $set: { usedBytes: data.usedBytes, quotaBytes: data.quotaBytes, lastUpdated: now, updatedAt: now },
        $setOnInsert: { createdAt: now, userId },
      },
      { upsert: true }
    );

  return (await getUserStorage(userId))!;
}

// ─── API Keys ───────────────────────────────────────────────────────────────

export interface ApiKeyDoc {
  _id?: import("mongodb").ObjectId;
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export async function listApiKeys(userId: string): Promise<Omit<ApiKeyDoc, "keyHash">[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<ApiKeyDoc>(COLLECTIONS.API_KEYS)
    .find({ userId })
    .project<Omit<ApiKeyDoc, "keyHash">>({ keyHash: 0 })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function findApiKeyByHash(keyHash: string): Promise<ApiKeyDoc | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  return db.collection<ApiKeyDoc>(COLLECTIONS.API_KEYS).findOne({ keyHash, revoked: false });
}

export async function insertApiKey(doc: Omit<ApiKeyDoc, "_id">): Promise<ApiKeyDoc> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection<ApiKeyDoc>(COLLECTIONS.API_KEYS).insertOne(doc as ApiKeyDoc);
  return { ...doc, _id: result.insertedId };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  const result = await db
    .collection<ApiKeyDoc>(COLLECTIONS.API_KEYS)
    .updateOne({ _id: new ObjectId(keyId), userId }, { $set: { revoked: true } });
  return result.modifiedCount > 0;
}

// ─── API Usage (Rate Limiting) ──────────────────────────────────────────────

export interface ApiUsageDoc {
  _id?: import("mongodb").ObjectId;
  apiKeyId: string;
  date: string; // "YYYY-MM-DD"
  count: number;
}

export async function incrementApiUsage(apiKeyId: string, date: string): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const result = await db
    .collection<ApiUsageDoc>(COLLECTIONS.API_USAGE)
    .findOneAndUpdate(
      { apiKeyId, date },
      { $inc: { count: 1 }, $setOnInsert: { apiKeyId, date } },
      { upsert: true, returnDocument: "after" },
    );
  return result?.count ?? 1;
}

export async function getApiUsageCount(apiKeyId: string, date: string): Promise<number> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<ApiUsageDoc>(COLLECTIONS.API_USAGE)
    .findOne({ apiKeyId, date });
  return doc?.count ?? 0;
}

// ─── API Logs (Audit Trail) ─────────────────────────────────────────────────

export interface ApiLogDoc {
  _id?: import("mongodb").ObjectId;
  userId: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  createdAt: string;
}

export async function insertApiLog(doc: Omit<ApiLogDoc, "_id">): Promise<void> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  await db.collection<ApiLogDoc>(COLLECTIONS.API_LOGS).insertOne(doc as ApiLogDoc);
}

// ─── App Settings (forced update / version gate) ────────────────────────────

const DEFAULT_APP_SETTINGS: Omit<AppSettings, "_id" | "updatedAt"> = {
  latestVersion: "",
  minimumSupportedVersion: "",
  forceUpdatesEnabled: false,
  emergencyLock: false,
  emergencyLockDelay: 0,
  gracePeriodHours: 72,
  updateMessage: "A new version of MakeChurchEazy is available. Please update to continue.",
  emergencyLockMessage: "MakeChurchEazy is temporarily unavailable due to emergency maintenance.",
  windowsDownloadUrl: "",
  macDownloadUrl: "",
  linuxDownloadUrl: "",
  releaseNotesUrl: "",
  policyPublishedAt: new Date(0).toISOString(),
  emergencyLockEnabledAt: null,
  emergencyLockEffectiveAt: null,
};

export async function getAppSettings(): Promise<AppSettings> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<AppSettings>(COLLECTIONS.APP_SETTINGS);

  const existing = await col.findOne({ _id: "default" as any });
  if (existing) return existing;

  // Seed defaults
  const now = new Date().toISOString();
  const seeded: AppSettings = { ...DEFAULT_APP_SETTINGS, updatedAt: now } as AppSettings;
  await col.updateOne(
    { _id: "default" as any },
    { $setOnInsert: { ...seeded, _id: "default" as any } },
    { upsert: true }
  );
  return { ...seeded, _id: "default" as any } as AppSettings;
}

export async function upsertAppSettings(
  data: Partial<Omit<AppSettings, "_id" | "updatedAt">>
): Promise<AppSettings> {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<AppSettings>(COLLECTIONS.APP_SETTINGS);
  const now = new Date().toISOString();
  await col.updateOne(
    { _id: "default" as any },
    { $set: { ...data, updatedAt: now } },
    { upsert: true }
  );
  return (await getAppSettings())!;
}
