/**
 * trialRecords.ts — Centralized trial CRUD against the `trials` collection.
 *
 * Every API route MUST use these helpers instead of reading/writing
 * trial data embedded inside user documents.
 *
 * The `trials` collection is the single source of truth. Admin changes
 * to trial duration apply immediately — no per-user document updates needed.
 */

import clientPromise from "./mongodb";
import type { ObjectId } from "mongodb";
import type { TrialStatus } from "@/types/schemas";
import { markUserConverted } from "./offerMatch";
import { legacyTrialDurationDays } from "./trialDuration";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TrialRecord {
  _id?: ObjectId;
  userId: string;
  status: TrialStatus;
  startedAt: string;
  endsAt: string;
  durationDays: number;
  extendedDays: number;
  extensionCount: number;
  stoppedAt: string | null;
  stoppedReason: string | null;
  restartedAt: string | null;
  grantedBy: string | null;
  lastModifiedBy: string | null;
  welcomeShown: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = "trials";

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Get a user's trial record. Returns the most recent trial for this user.
 */
export async function getTrialForUser(userId: string): Promise<TrialRecord | null> {
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<TrialRecord>(COLLECTION)
    .findOne({ userId }, { sort: { createdAt: -1 } });
}

/** Days remaining on the user's active trial, rounded up like the dashboard. */
export async function getActiveTrialDaysRemaining(
  userId: string,
  nowMs = Date.now(),
): Promise<number> {
  const trial = await getTrialForUser(userId);
  if (trial?.status !== "active") return 0;
  const endsAtMs = new Date(trial.endsAt).getTime();
  if (!Number.isFinite(endsAtMs) || endsAtMs <= nowMs) return 0;
  return Math.ceil((endsAtMs - nowMs) / (24 * 60 * 60 * 1000));
}

/**
 * Get a trial record by its _id.
 */
export async function getTrialById(trialId: string): Promise<TrialRecord | null> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  try {
    return db
      .collection<TrialRecord>(COLLECTION)
      .findOne({ _id: new ObjectId(trialId) });
  } catch {
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Create a new trial record and link it to the user.
 * Also sets `trialId` on the user document.
 */
export async function createTrialRecord(
  userId: string,
  data: {
    durationDays: number;
    grantedBy?: string;
  }
): Promise<TrialRecord> {
  if (!Number.isInteger(data.durationDays) || data.durationDays <= 0) {
    throw new Error(
      `[trialRecords] createTrialRecord: durationDays must be a positive integer, got ${data.durationDays}`
    );
  }

  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();
  const endsAt = new Date(Date.now() + data.durationDays * 24 * 60 * 60 * 1000).toISOString();

  const record: TrialRecord = {
    userId,
    status: "active",
    startedAt: now,
    endsAt,
    durationDays: data.durationDays,
    extendedDays: 0,
    extensionCount: 0,
    stoppedAt: null,
    stoppedReason: null,
    restartedAt: null,
    grantedBy: data.grantedBy || null,
    lastModifiedBy: data.grantedBy || null,
    welcomeShown: false,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<TrialRecord>(COLLECTION).insertOne(record);
  record._id = result.insertedId;

  // Link trial to user — must replace the whole `trial` object because
  // dot-notation ($set: { "trial.active": ... }) fails when the field is null.
  await db.collection("users").updateOne(
    { _id: new (await import("mongodb")).ObjectId(userId) },
    {
      $set: {
        trialId: result.insertedId.toString(),
        trial: {
          active: true,
          status: "active",
          startedAt: now,
          endsAt: endsAt,
          durationDays: data.durationDays,
          extendedDays: 0,
          extensionCount: 0,
          grantedBy: data.grantedBy || null,
          lastModifiedBy: data.grantedBy || null,
          welcomeShown: false,
        },
      },
      // A manually granted trial is a new lifecycle. Do not let flags from a
      // previous expired trial suppress its reminders or expiry processing.
      $unset: {
        trialExpiredSent: "",
        "lifecycleEmails.trialActivatedSent": "",
        "lifecycleEmails.day1ActivationSent": "",
        "lifecycleEmails.day3FeatureDiscoverySent": "",
        "lifecycleEmails.day5ValueSent": "",
        "lifecycleEmails.trialEnding2DaysSent": "",
        "lifecycleEmails.trialEndingTomorrowSent": "",
        "lifecycleEmails.trialExpiredSent": "",
        "lifecycleEmails.reEngagementSent": "",
      },
    }
  );

  return record;
}

/**
 * Update a trial record and sync changes back to the user's legacy `trial` field.
 */
export async function updateTrialRecord(
  trialId: string,
  updates: Partial<Omit<TrialRecord, "_id" | "userId" | "createdAt">>
): Promise<TrialRecord | null> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");

  const now = new Date().toISOString();
  const setFields: Record<string, any> = { updatedAt: now };
  for (const [key, value] of Object.entries(updates)) {
    setFields[key] = value;
  }

  await db
    .collection<TrialRecord>(COLLECTION)
    .updateOne({ _id: new ObjectId(trialId) }, { $set: setFields });

  // Sync back to user's legacy trial field
  const trial = await db
    .collection<TrialRecord>(COLLECTION)
    .findOne({ _id: new ObjectId(trialId) });

  if (trial) {
    const userUpdate: Record<string, Record<string, unknown>> = {
      $set: {
        "trial.active": trial.status === "active",
        "trial.status": trial.status,
        "trial.startedAt": trial.startedAt,
        "trial.endsAt": trial.endsAt,
        "trial.durationDays": trial.durationDays,
        "trial.extendedDays": trial.extendedDays,
        "trial.extensionCount": trial.extensionCount,
        "trial.stoppedAt": trial.stoppedAt,
        "trial.stoppedReason": trial.stoppedReason,
        "trial.restartedAt": trial.restartedAt,
        "trial.grantedBy": trial.grantedBy,
        "trial.lastModifiedBy": trial.lastModifiedBy,
        "trial.welcomeShown": trial.welcomeShown,
      },
    };

    // Restart/reactivate starts a new lifecycle on the same trial record.
    // Clear notification guards so the new end date is processed normally.
    if (trial.status === "active") {
      userUpdate.$unset = {
        trialExpiredSent: "",
        "lifecycleEmails.trialActivatedSent": "",
        "lifecycleEmails.day1ActivationSent": "",
        "lifecycleEmails.day3FeatureDiscoverySent": "",
        "lifecycleEmails.day5ValueSent": "",
        "lifecycleEmails.trialEnding2DaysSent": "",
        "lifecycleEmails.trialEndingTomorrowSent": "",
        "lifecycleEmails.trialExpiredSent": "",
        "lifecycleEmails.reEngagementSent": "",
      };
    }

    await db.collection("users").updateOne({ trialId }, userUpdate);
  }

  return trial;
}

/**
 * A paid subscription supersedes a free trial. Keep the canonical trial
 * record and the legacy embedded trial field in lock-step whenever payment
 * provisioning activates a paid plan.
 */
export async function stopActiveTrialForPaidPlan(
  userId: string,
  lastModifiedBy = "system:paid-plan-activation",
): Promise<boolean> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");
  const now = new Date().toISOString();

  let userObjectId: ObjectId;
  try {
    userObjectId = new ObjectId(userId);
  } catch {
    return false;
  }

  const [trialResult, userResult] = await Promise.all([
    db.collection<TrialRecord>(COLLECTION).updateMany(
      { userId, status: "active" },
      {
        $set: {
          status: "stopped",
          stoppedAt: now,
          stoppedReason: "converted_to_paid_plan",
          lastModifiedBy,
          updatedAt: now,
        },
      },
    ),
    db.collection("users").updateOne(
      {
        _id: userObjectId,
        $or: [{ "trial.status": "active" }, { "trial.active": true }],
      },
      {
        $set: {
          "trial.active": false,
          "trial.status": "stopped",
          "trial.stoppedAt": now,
          "trial.stoppedReason": "converted_to_paid_plan",
          "trial.lastModifiedBy": lastModifiedBy,
        },
      },
    ),
  ]);

  // A free period or temporary plan that was granted before the person paid
  // must not stay active: when it ran out it would send a paying customer back
  // to Free. Only the grant is ended; the plan they just bought is untouched.
  await db
    .collection("users")
    .updateOne(
      { _id: userObjectId, "adminTemporaryPlan.active": true },
      {
        $set: {
          "adminTemporaryPlan.active": false,
          "adminTemporaryPlan.endedAt": now,
          "adminTemporaryPlan.endedBy": lastModifiedBy,
          "adminTemporaryPlan.endedReason": "paid_plan_activated",
        },
      },
    )
    .catch((error) => console.error("[trialRecords] Could not end temporary plan after payment:", error));

  // Win-back offers stop once someone is a customer.
  await markUserConverted(userId).catch((error) => console.error("[trialRecords] Offer conversion failed:", error));

  return trialResult.modifiedCount > 0 || userResult.modifiedCount > 0;
}

/**
 * Set welcomeShown on a trial record.
 */
export async function markWelcomeShown(trialId: string): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");

  await db
    .collection<TrialRecord>(COLLECTION)
    .updateOne(
      { _id: new ObjectId(trialId) },
      { $set: { welcomeShown: true, updatedAt: new Date().toISOString() } }
    );

  // Sync to user doc
  await db.collection("users").updateOne(
    { trialId },
    { $set: { "trial.welcomeShown": true } }
  );
}

/**
 * Delete a trial record (used during cleanup/migration).
 */
export async function deleteTrialRecord(trialId: string): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import("mongodb");

  await db.collection<TrialRecord>(COLLECTION).deleteOne({ _id: new ObjectId(trialId) });
}

// ── Bulk Queries (for cron jobs) ────────────────────────────────────────────

/**
 * Get all active trial records (for cron processing).
 */
export async function getActiveTrials(): Promise<TrialRecord[]> {
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<TrialRecord>(COLLECTION)
    .find({ status: "active" })
    .toArray();
}

/**
 * Get trial records by status.
 */
export async function getTrialsByStatus(status: TrialStatus): Promise<TrialRecord[]> {
  const client = await clientPromise;
  const db = client.db();
  return db
    .collection<TrialRecord>(COLLECTION)
    .find({ status })
    .toArray();
}

// ── Migration Helper ────────────────────────────────────────────────────────

/**
 * Migrate a user's embedded trial to the trials collection.
 * Creates a TrialRecord from the user's existing `trial` subdocument
 * and sets `trialId` on the user.
 *
 * Safe to call multiple times — skips users that already have a trialId.
 */
export async function migrateEmbeddedTrial(user: any): Promise<string | null> {
  if (user.trialId) return user.trialId; // Already migrated
  if (!user.trial) return null; // No trial to migrate

  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();
  const t = user.trial;

  const record: TrialRecord = {
    userId: user._id.toString(),
    status: t.status || (t.active ? "active" : "expired"),
    startedAt: t.startedAt || now,
    endsAt: t.endsAt || now,
    durationDays: legacyTrialDurationDays(t),
    extendedDays: t.extendedDays || 0,
    extensionCount: t.extensionCount || 0,
    stoppedAt: t.stoppedAt || null,
    stoppedReason: t.stoppedReason || null,
    restartedAt: t.restartedAt || null,
    grantedBy: t.grantedBy || null,
    lastModifiedBy: t.lastModifiedBy || null,
    welcomeShown: t.welcomeShown || false,
    createdAt: t.startedAt || now,
    updatedAt: now,
  };

  const result = await db.collection<TrialRecord>(COLLECTION).insertOne(record);

  await db.collection("users").updateOne(
    { _id: user._id },
    { $set: { trialId: result.insertedId.toString() } }
  );

  return result.insertedId.toString();
}
