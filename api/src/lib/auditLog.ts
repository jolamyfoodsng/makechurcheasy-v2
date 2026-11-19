/**
 * Audit logging for admin actions.
 *
 * Every admin mutation (plan changes, credit grants, ambassador grants, etc.)
 * must go through this utility to ensure a complete,不可 tamperable audit trail.
 */

import clientPromise from "./mongodb";

export type AuditAction =
  | "plan_change"
  | "admin_subscription_start"
  | "admin_subscription_renew"
  | "temporary_plan_grant"
  | "temporary_plan_revoke"
  | "temporary_plan_expired"
  | "credit_grant"
  | "credit_deduct"
  | "credit_adjustment"
  | "ambassador_grant"
  | "ambassador_revoke"
  | "ambassador_expired"
  | "account_suspend"
  | "account_delete"
  | "role_change"
  | "trial_action"
  | "referral_payout";

export interface AuditEvent {
  adminId: string;
  action: AuditAction;
  targetUserId: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Insert an audit event into the `audit_events` collection.
 * Failures are logged but never thrown — audit logging must never block the caller.
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const client = await clientPromise;
    const db = client.db();
    await db.collection("audit_events").insertOne({
      adminId: event.adminId,
      action: event.action,
      targetUserId: event.targetUserId,
      details: event.details ?? {},
      timestamp: event.timestamp,
    });
  } catch (err) {
    console.error("[AuditLog] Failed to write audit event:", err);
  }
}

/**
 * Fetch paginated audit logs with admin name resolution.
 */
export async function getAuditLogs(opts: {
  page?: number;
  limit?: number;
  action?: string;
}): Promise<{ logs: Array<Record<string, unknown>>; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const skip = (page - 1) * limit;

  const client = await clientPromise;
  const db = client.db();
  const col = db.collection("audit_events");

  const filter: Record<string, unknown> = {};
  if (opts.action && opts.action !== "all") {
    filter.action = opts.action;
  }

  const [total, rawLogs] = await Promise.all([
    col.countDocuments(filter),
    col
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
  ]);

  // Resolve admin names
  const { ObjectId } = await import("mongodb");
  const adminIds = [
    ...new Set(rawLogs.map((l) => String(l.adminId)).filter(Boolean)),
  ];
  const targetIds = [
    ...new Set(rawLogs.map((l) => String(l.targetUserId)).filter(Boolean)),
  ];
  const allIds = [...new Set([...adminIds, ...targetIds])];

  const objectIds = allIds
    .filter((id) => {
      try { new ObjectId(id); return true; } catch { return false; }
    })
    .map((id) => new ObjectId(id));

  let nameMap: Record<string, string> = {};
  if (objectIds.length > 0) {
    const users = await db
      .collection("users")
      .find({ _id: { $in: objectIds } }, { projection: { name: 1, email: 1 } })
      .toArray();
    for (const u of users) {
      const id = u._id.toString();
      nameMap[id] = u.name || u.email || "Unknown";
    }
  }

  const logs = rawLogs.map((l) => ({
    id: l._id?.toString() || "",
    adminId: String(l.adminId || ""),
    adminName: nameMap[String(l.adminId)] || "System",
    action: String(l.action || ""),
    targetUserId: String(l.targetUserId || ""),
    targetUserName: nameMap[String(l.targetUserId)] || "Unknown",
    details: l.details || {},
    timestamp: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp || ""),
  }));

  return { logs, total };
}
