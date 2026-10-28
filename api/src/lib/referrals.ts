import { ObjectId } from "mongodb";
import { customAlphabet } from "nanoid";
import clientPromise from "./mongodb";
import { COLLECTIONS, ensureIndexes } from "./db";
import type { ReferralRecord } from "@/types/schemas";

const referralCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCodeSuffix = customAlphabet(referralCodeAlphabet, 8);

export interface ReferralUserSummary {
  id: string;
  name: string;
  email: string;
  churchName: string;
  plan: string;
}

export interface ReferralListItem {
  id: string;
  code: string;
  status: ReferralRecord["status"];
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  paidPlan: string | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  paidBillingReference: string | null;
  referredUser: ReferralUserSummary | null;
  referrerUser?: ReferralUserSummary | null;
}

export interface ReferralDashboard {
  code: string;
  promptSkippedAt: string | null;
  /** True while this account still has to enter a referral code (new Google sign-ups). */
  referralRequired: boolean;
  referredBy: {
    code: string;
    referrerUserId: string;
    referralId: string;
    appliedAt: string;
  } | null;
  stats: {
    totalSignups: number;
    paidSignups: number;
    pendingSignups: number;
    conversionRate: number;
  };
  referrals: ReferralListItem[];
}

export interface ReferralPaymentInfo {
  plan?: string | null;
  amount?: number | null;
  currency?: string | null;
  paystackReference?: string | null;
  billingTransactionId?: string | null;
  paidAt?: string | null;
}

export function normalizeReferralCode(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

function userSummaryFromDoc(user: any): ReferralUserSummary | null {
  if (!user?._id) return null;
  return {
    id: user._id.toString(),
    name: user.name || "",
    email: user.email || "",
    churchName: user.churchName || "",
    plan: user.plan || "free",
  };
}

function referralItemFromDoc(
  referral: ReferralRecord,
  usersById: Map<string, ReferralUserSummary>,
  includeReferrer = false,
): ReferralListItem {
  const id = referral._id?.toString() || "";
  const item: ReferralListItem = {
    id,
    code: referral.code,
    status: referral.status,
    createdAt: referral.createdAt,
    updatedAt: referral.updatedAt,
    paidAt: referral.paidAt || null,
    paidPlan: referral.paidPlan || null,
    paidAmount: referral.paidAmount ?? null,
    paidCurrency: referral.paidCurrency || null,
    paidBillingReference: referral.paidBillingReference || null,
    referredUser: usersById.get(referral.referredUserId) || null,
  };
  if (includeReferrer) {
    item.referrerUser = usersById.get(referral.referrerUserId) || null;
  }
  return item;
}

export async function ensureReferralCodeForUser(userId: string): Promise<string> {
  await ensureIndexes();
  const userObjectId = toObjectId(userId);
  if (!userObjectId) throw new Error("Invalid user");

  const client = await clientPromise;
  const db = client.db();
  const users = db.collection("users");

  const existing = await users.findOne(
    { _id: userObjectId },
    { projection: { referralCode: 1 } },
  );
  if (!existing) throw new Error("User not found");

  const currentCode = normalizeReferralCode(existing.referralCode);
  if (currentCode) return currentCode;

  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `MCE${makeCodeSuffix()}`;
    try {
      const result = await users.updateOne(
        {
          _id: userObjectId,
          $or: [
            { referralCode: { $exists: false } },
            { referralCode: null },
            { referralCode: "" },
          ],
        },
        { $set: { referralCode: code, referralCodeCreatedAt: now } },
      );
      if (result.modifiedCount > 0) return code;

      const refreshed = await users.findOne(
        { _id: userObjectId },
        { projection: { referralCode: 1 } },
      );
      const refreshedCode = normalizeReferralCode(refreshed?.referralCode);
      if (refreshedCode) return refreshedCode;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  throw new Error("Could not generate referral code");
}

export async function getReferralDashboard(userId: string): Promise<ReferralDashboard> {
  await ensureIndexes();
  const userObjectId = toObjectId(userId);
  if (!userObjectId) throw new Error("Invalid user");

  const client = await clientPromise;
  const db = client.db();
  const code = await ensureReferralCodeForUser(userId);

  const user = await db.collection("users").findOne(
    { _id: userObjectId },
    { projection: { referredBy: 1, referralPromptSkippedAt: 1, referralRequired: 1 } },
  );

  const referrals = await db
    .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
    .find({ referrerUserId: userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const referredObjectIds = referrals
    .map((referral) => toObjectId(referral.referredUserId))
    .filter((id): id is ObjectId => Boolean(id));

  const referredUsers = referredObjectIds.length
    ? await db
      .collection("users")
      .find(
        { _id: { $in: referredObjectIds } },
        { projection: { name: 1, email: 1, churchName: 1, plan: 1 } },
      )
      .toArray()
    : [];
  const usersById = new Map(
    referredUsers
      .map(userSummaryFromDoc)
      .filter((summary): summary is ReferralUserSummary => Boolean(summary))
      .map((summary) => [summary.id, summary]),
  );

  const paidSignups = referrals.filter((referral) => referral.status === "paid").length;
  const totalSignups = referrals.length;

  return {
    code,
    promptSkippedAt: user?.referralPromptSkippedAt || null,
    referralRequired: Boolean(user?.referralRequired) && !user?.referredBy,
    referredBy: user?.referredBy || null,
    stats: {
      totalSignups,
      paidSignups,
      pendingSignups: Math.max(0, totalSignups - paidSignups),
      conversionRate: totalSignups > 0 ? Math.round((paidSignups / totalSignups) * 100) : 0,
    },
    referrals: referrals.map((referral) => referralItemFromDoc(referral, usersById)),
  };
}

export interface ReferralCodeCheck {
  valid: boolean;
  code: string;
  /** Why it is not valid, written for the person typing it. */
  error?: string;
}

/**
 * Checks a referral code without using it. Used on the signup form and the "Have a referral code?"
 * page so a wrong code is reported under the input before anything is created.
 */
export async function validateReferralCode(
  rawCode: unknown,
  options: { excludeUserId?: string } = {},
): Promise<ReferralCodeCheck> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { valid: false, code, error: "Enter a referral code" };
  if (code.length < 6 || code.length > 16) {
    return { valid: false, code, error: "This referral code isn't valid. Check it and try again." };
  }

  const client = await clientPromise;
  const referrer = await client
    .db()
    .collection("users")
    .findOne({ referralCode: code }, { projection: { _id: 1 } });
  if (!referrer?._id) {
    return { valid: false, code, error: "This referral code isn't valid. Check it and try again." };
  }
  if (options.excludeUserId && referrer._id.toString() === options.excludeUserId) {
    return { valid: false, code, error: "You cannot use your own referral code" };
  }
  return { valid: true, code };
}

export async function applyReferralCode(
  referredUserId: string,
  rawCode: string,
): Promise<{ referral: ReferralRecord; alreadyApplied: boolean }> {
  await ensureIndexes();
  const code = normalizeReferralCode(rawCode);
  if (!code) throw new Error("Enter a referral code");

  const referredObjectId = toObjectId(referredUserId);
  if (!referredObjectId) throw new Error("Invalid user");

  const client = await clientPromise;
  const db = client.db();
  const users = db.collection("users");

  const referredUser = await users.findOne(
    { _id: referredObjectId },
    { projection: { referredBy: 1, referralCode: 1, plan: 1 } },
  );
  if (!referredUser) throw new Error("User not found");

  const existingReferral = await db
    .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
    .findOne({ referredUserId });
  if (existingReferral) {
    return { referral: existingReferral, alreadyApplied: true };
  }

  if (referredUser.referredBy?.referralId) {
    const existing = await db
      .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
      .findOne({ _id: toObjectId(referredUser.referredBy.referralId) } as any);
    if (existing) return { referral: existing, alreadyApplied: true };
  }

  const ownCode = normalizeReferralCode(referredUser.referralCode);
  if (ownCode && ownCode === code) {
    throw new Error("You cannot use your own referral code");
  }

  const referrer = await users.findOne(
    { referralCode: code },
    { projection: { _id: 1 } },
  );
  if (!referrer?._id) {
    throw new Error("Referral code was not found");
  }

  const referrerUserId = referrer._id.toString();
  if (referrerUserId === referredUserId) {
    throw new Error("You cannot use your own referral code");
  }

  const now = new Date().toISOString();
  const referral: ReferralRecord = {
    code,
    referrerUserId,
    referredUserId,
    status: "signed_up",
    paidAt: null,
    paidPlan: null,
    paidAmount: null,
    paidCurrency: null,
    paidBillingReference: null,
    paidBillingTransactionId: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const inserted = await db
      .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
      .insertOne(referral);
    referral._id = inserted.insertedId;
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const existing = await db
      .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
      .findOne({ referredUserId });
    if (existing) return { referral: existing, alreadyApplied: true };
    throw error;
  }

  await users.updateOne(
    { _id: referredObjectId },
    {
      $set: {
        referredBy: {
          code,
          referrerUserId,
          referralId: referral._id?.toString() || "",
          appliedAt: now,
        },
      },
      $unset: { referralPromptSkippedAt: "", referralRequired: "" },
    },
  );

  const paidTransaction = await db
    .collection("billing_transactions")
    .findOne(
      {
        userId: referredUserId,
        status: "success",
        type: { $in: ["subscription_purchase", "subscription_renewal", "plan_upgrade"] },
      },
      { sort: { paidAt: -1, createdAt: -1 } },
    );

  if (paidTransaction || (referredUser.plan && referredUser.plan !== "free")) {
    const marked = await markReferralPaidForUser(referredUserId, {
      plan: paidTransaction?.plan || referredUser.plan || null,
      amount: paidTransaction?.amount ?? null,
      currency: paidTransaction?.currency || null,
      paystackReference: paidTransaction?.paystackReference || null,
      billingTransactionId: paidTransaction?._id?.toString() || null,
      paidAt: paidTransaction?.paidAt || now,
    });
    if (marked) referral.status = marked.status;
  }

  return { referral, alreadyApplied: false };
}

export async function dismissReferralPrompt(userId: string): Promise<string> {
  await ensureIndexes();
  const userObjectId = toObjectId(userId);
  if (!userObjectId) throw new Error("Invalid user");

  const now = new Date().toISOString();
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection("users")
    .updateOne(
      { _id: userObjectId },
      { $set: { referralPromptSkippedAt: now }, $unset: { referralRequired: "" } },
    );
  return now;
}

export async function markReferralPaidForUser(
  referredUserId: string,
  payment: ReferralPaymentInfo,
): Promise<ReferralRecord | null> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const referrals = db.collection<ReferralRecord>(COLLECTIONS.REFERRALS);

  const referral = await referrals.findOne({ referredUserId });
  if (!referral) return null;
  if (referral.status === "paid") return referral;

  const paidAt = payment.paidAt || new Date().toISOString();
  await referrals.updateOne(
    { _id: referral._id },
    {
      $set: {
        status: "paid",
        paidAt,
        paidPlan: payment.plan || null,
        paidAmount: payment.amount ?? null,
        paidCurrency: payment.currency || null,
        paidBillingReference: payment.paystackReference || null,
        paidBillingTransactionId: payment.billingTransactionId || null,
        updatedAt: new Date().toISOString(),
      },
    },
  );

  return (await referrals.findOne({ _id: referral._id })) || null;
}

export async function getAdminReferralOverview(limit = 500) {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();

  const referrals = await db
    .collection<ReferralRecord>(COLLECTIONS.REFERRALS)
    .find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 1000))
    .toArray();

  const userIds = new Set<string>();
  for (const referral of referrals) {
    userIds.add(referral.referrerUserId);
    userIds.add(referral.referredUserId);
  }

  const objectIds = [...userIds]
    .map(toObjectId)
    .filter((id): id is ObjectId => Boolean(id));

  const users = objectIds.length
    ? await db
      .collection("users")
      .find(
        { _id: { $in: objectIds } },
        { projection: { name: 1, email: 1, churchName: 1, plan: 1 } },
      )
      .toArray()
    : [];

  const usersById = new Map(
    users
      .map(userSummaryFromDoc)
      .filter((summary): summary is ReferralUserSummary => Boolean(summary))
      .map((summary) => [summary.id, summary]),
  );

  const paidSignups = referrals.filter((referral) => referral.status === "paid").length;
  const totalSignups = referrals.length;
  const referrers = new Set(referrals.map((referral) => referral.referrerUserId)).size;

  return {
    stats: {
      totalSignups,
      paidSignups,
      pendingSignups: Math.max(0, totalSignups - paidSignups),
      referrers,
      conversionRate: totalSignups > 0 ? Math.round((paidSignups / totalSignups) * 100) : 0,
    },
    referrals: referrals.map((referral) => referralItemFromDoc(referral, usersById, true)),
  };
}

export async function adminAssignReferral(params: {
  referrerUserId: string;
  referredUserId: string;
}): Promise<{
  referral: ReferralRecord;
  referrer: ReferralUserSummary;
  referred: ReferralUserSummary;
  isNew: boolean;
}> {
  await ensureIndexes();
  const { referrerUserId, referredUserId } = params;

  if (!referrerUserId || !referredUserId) {
    throw new Error("Both referrer and referred user are required");
  }
  if (referrerUserId === referredUserId) {
    throw new Error("A user cannot refer themselves");
  }

  const referrerObjectId = toObjectId(referrerUserId);
  const referredObjectId = toObjectId(referredUserId);
  if (!referrerObjectId || !referredObjectId) {
    throw new Error("Invalid user IDs");
  }

  const client = await clientPromise;
  const db = client.db();
  const users = db.collection("users");
  const referralsCol = db.collection<ReferralRecord>(COLLECTIONS.REFERRALS);

  const [referrerDoc, referredDoc] = await Promise.all([
    users.findOne({ _id: referrerObjectId }),
    users.findOne({ _id: referredObjectId }),
  ]);

  if (!referrerDoc) throw new Error("Referrer user not found");
  if (!referredDoc) throw new Error("Referred user not found");

  const code = await ensureReferralCodeForUser(referrerUserId);
  const now = new Date().toISOString();

  let existingReferral = await referralsCol.findOne({ referredUserId });
  let isNew = false;
  let referralRecord: ReferralRecord;

  const isPaid = (referredDoc.plan && referredDoc.plan !== "free");

  if (existingReferral) {
    await referralsCol.updateOne(
      { _id: existingReferral._id },
      {
        $set: {
          code,
          referrerUserId,
          status: isPaid ? "paid" : existingReferral.status || "signed_up",
          paidAt: isPaid ? (existingReferral.paidAt || now) : existingReferral.paidAt,
          paidPlan: isPaid ? (existingReferral.paidPlan || referredDoc.plan) : existingReferral.paidPlan,
          updatedAt: now,
        },
      }
    );
    referralRecord = {
      ...existingReferral,
      code,
      referrerUserId,
      status: isPaid ? "paid" : existingReferral.status || "signed_up",
      updatedAt: now,
    };
  } else {
    isNew = true;
    const newRecord: ReferralRecord = {
      code,
      referrerUserId,
      referredUserId,
      status: isPaid ? "paid" : "signed_up",
      paidAt: isPaid ? now : null,
      paidPlan: isPaid ? referredDoc.plan : null,
      paidAmount: null,
      paidCurrency: null,
      paidBillingReference: null,
      paidBillingTransactionId: null,
      createdAt: now,
      updatedAt: now,
    };
    const insertRes = await referralsCol.insertOne(newRecord);
    newRecord._id = insertRes.insertedId;
    referralRecord = newRecord;
  }

  await users.updateOne(
    { _id: referredObjectId },
    {
      $set: {
        referredBy: {
          code,
          referrerUserId,
          referralId: referralRecord._id?.toString() || "",
          appliedAt: now,
        },
      },
      $unset: { referralPromptSkippedAt: "", referralRequired: "" },
    }
  );

  return {
    referral: referralRecord,
    referrer: userSummaryFromDoc(referrerDoc)!,
    referred: userSummaryFromDoc(referredDoc)!,
    isNew,
  };
}

