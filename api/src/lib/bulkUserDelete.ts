/**
 * Admin bulk user delete: loads the facts needed to decide who is safe to delete, and removes a user
 * together with their personal data. The decision rules live in ./userDeleteRules.
 *
 * Deleted: the user, their devices, sign-in sessions, church profile, transcripts, sermon notes, themes,
 * usage and activity records, offers, and free credit history.
 * Kept on purpose: subscription and payment records (finance), trial claim records (so a deleted account's
 * device or email cannot simply start a second free trial), referrals, and the audit log.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getEffectivePlan } from "./trial";
import { loadRealUseTimes } from "./userRetention";
import { logAuditEvent } from "./auditLog";
import {
  whyProtected,
  type DeletionCandidate,
  type VersionRule,
} from "./userDeleteRules";

/** Collections that hold a user's personal data, and the field that points at the user. */
export const PERSONAL_DATA: ReadonlyArray<{ collection: string; field: "userId" | "ownerId" }> = [
  { collection: "devices", field: "userId" },
  { collection: "security_sessions", field: "userId" },
  { collection: "church_profiles", field: "userId" },
  { collection: "transcripts", field: "ownerId" },
  { collection: "custom_themes", field: "ownerId" },
  { collection: "sermon_summaries", field: "userId" },
  { collection: "sermon_notes", field: "userId" },
  { collection: "sermon_points", field: "userId" },
  { collection: "sync_jobs", field: "userId" },
  { collection: "user_storage", field: "userId" },
  { collection: "user_usage", field: "userId" },
  { collection: "api_keys", field: "userId" },
  { collection: "transcription_balances", field: "userId" },
  { collection: "transcription_transactions", field: "userId" },
  { collection: "credit_transactions", field: "userId" },
  { collection: "activity_events", field: "userId" },
  { collection: "usage_events", field: "userId" },
  { collection: "analytics_events", field: "userId" },
  { collection: "announcement_deliveries", field: "userId" },
  { collection: "user_offers", field: "userId" },
  { collection: "offer_journeys", field: "userId" },
  { collection: "trials", field: "userId" },
  { collection: "trial_notifications", field: "userId" },
  { collection: "activation_feedback", field: "userId" },
];

/** A payment intent in one of these states never took money, so it does not count as payment history. */
const UNPAID_INTENT_STATUSES = ["pending", "failed", "cancelled", "canceled", "expired", "created", "initiated", "abandoned"];

export interface LoadedCandidate extends DeletionCandidate {
  email: string;
  name: string;
}

function idVariants(ids: string[]): Array<string | ObjectId> {
  return [...ids, ...ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))];
}

/** Everything whyProtected needs, read fresh from the database for these user ids. */
export async function loadCandidates(db: Db, ids: string[]): Promise<{ candidates: LoadedCandidate[]; missing: string[] }> {
  const valid = ids.filter((id) => ObjectId.isValid(id));
  if (valid.length === 0) return { candidates: [], missing: ids };

  const users = await db
    .collection("users")
    .find({ _id: { $in: valid.map((id) => new ObjectId(id)) } }, { projection: { password: 0 } })
    .toArray();
  const found = new Set(users.map((u) => String(u._id)));
  const missing = ids.filter((id) => !found.has(id));
  const foundIds = users.map((u) => String(u._id));
  const variants = idVariants(foundIds);
  const activeTrialUserIds = new Set(
    (
      await db.collection("trials").distinct("userId", {
        userId: { $in: variants },
        status: "active",
      })
    ).map(String),
  );

  const versionsByUser = new Map<string, string[]>();
  const devices = await db
    .collection("devices")
    .aggregate<{ _id: string; versions: Array<string | null> }>([
      { $match: { userId: { $in: foundIds }, $or: [{ status: "active" }, { status: { $exists: false } }] } },
      { $group: { _id: "$userId", versions: { $addToSet: "$appVersion" } } },
    ])
    .toArray();
  for (const d of devices) {
    versionsByUser.set(String(d._id), (d.versions || []).map((v) => String(v || "").trim()).filter(Boolean));
  }

  const withSubscription = new Set(
    (await db.collection("subscriptions").distinct("userId", { userId: { $in: variants } })).map(String),
  );
  const withPayment = new Set<string>();
  const billedUserIds = await db
    .collection("billing_transactions")
    .distinct("userId", { userId: { $in: variants } });
  for (const id of billedUserIds) withPayment.add(String(id));

  for (const collection of ["flutterwave_payment_intents", "nowpayments_payment_intents"]) {
    const paid = await db
      .collection(collection)
      .distinct("userId", { userId: { $in: variants }, status: { $nin: UNPAID_INTENT_STATUSES } });
    for (const id of paid) withPayment.add(String(id));
  }

  const realUse = await loadRealUseTimes(db, foundIds);

  const candidates = users.map((u): LoadedCandidate => {
    const id = String(u._id);
    // Same fallback as the Users page: the version stored on the user when no device reported one.
    const deviceVersions = versionsByUser.get(id);
    const versions = deviceVersions ?? (u.appVersion ? [String(u.appVersion)] : []);
    return {
      id,
      email: String(u.email || ""),
      name: String(u.name || ""),
      role: String(u.role || "user"),
      // The `trials` collection is canonical; protect active records even if the legacy user field drifted.
      effectivePlan: activeTrialUserIds.has(id) ? "trial" : String(getEffectivePlan(u as never)),
      ambassadorActive: Boolean(u.ambassador?.active),
      temporaryPlanActive: Boolean(u.adminTemporaryPlan?.active),
      managedSubscriptionActive: Boolean(u.adminManagedSubscription?.active),
      hasSubscriptionRecord: withSubscription.has(id),
      hasPaymentRecord: withPayment.has(id),
      lastUseAt: realUse.get(id)?.lastUseAt ?? null,
      versions,
    };
  });
  return { candidates, missing };
}

export interface DeletionPlan {
  willDelete: LoadedCandidate[];
  skipped: Array<{ id: string; email: string; reason: string }>;
}

/** Splits the requested ids into who would be deleted and who is skipped (with the reason). */
export async function planDeletion(db: Db, ids: string[], rule: VersionRule, adminUserId: string): Promise<DeletionPlan> {
  const unique = Array.from(new Set(ids));
  const { candidates, missing } = await loadCandidates(db, unique);
  const willDelete: LoadedCandidate[] = [];
  const skipped: DeletionPlan["skipped"] = missing.map((id) => ({ id, email: "", reason: "User not found (already deleted?)" }));
  for (const c of candidates) {
    const reason = whyProtected(c, rule, adminUserId);
    if (reason) skipped.push({ id: c.id, email: c.email, reason });
    else willDelete.push(c);
  }
  return { willDelete, skipped };
}

export interface DeletionResult {
  deleted: string[];
  failed: Array<{ id: string; email: string; error: string }>;
}

/**
 * Deletes the users in the plan, one at a time. A user's own record goes last, and only if all of their
 * personal data went first, so a failure leaves the user in place and the same request can be run again.
 */
export async function deleteUsers(
  db: Db,
  plan: DeletionPlan["willDelete"],
  adminUserId: string,
  reason: string,
): Promise<DeletionResult> {
  const result: DeletionResult = { deleted: [], failed: [] };
  for (const user of plan) {
    try {
      const variants = idVariants([user.id]);
      for (const { collection, field } of PERSONAL_DATA) {
        await db.collection(collection).deleteMany({ [field]: { $in: variants } });
      }
      const removed = await db.collection("users").deleteOne({ _id: new ObjectId(user.id) });
      if (removed.deletedCount !== 1) throw new Error("The user record was not removed");
      result.deleted.push(user.id);
      await logAuditEvent({
        adminId: adminUserId,
        action: "account_delete",
        targetUserId: user.id,
        details: { email: user.email, name: user.name, appVersions: user.versions, reason, source: "bulk_delete" },
        timestamp: new Date(),
      });
    } catch (err) {
      result.failed.push({ id: user.id, email: user.email, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return result;
}
