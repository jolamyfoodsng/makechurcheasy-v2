/**
 * staleDataCleanup.ts — purges old rows from collections that only ever grow:
 * error_logs and audit_events. Nothing else is touched; user data, billing
 * records and email logs are out of scope for this job.
 */

import type { Db } from "mongodb";

const DEFAULT_ERROR_LOG_RETENTION_DAYS = 180;
const DEFAULT_AUDIT_EVENT_RETENTION_DAYS = 365;

export interface StaleDataCleanupResult {
  apply: boolean;
  errorLogs: { retentionDays: number; matched: number; deleted: number };
  auditEvents: { retentionDays: number; matched: number; deleted: number };
}

export async function cleanupStaleData(
  db: Db,
  opts: { apply: boolean; errorLogRetentionDays?: number; auditEventRetentionDays?: number }
): Promise<StaleDataCleanupResult> {
  const errorLogRetentionDays = opts.errorLogRetentionDays ?? DEFAULT_ERROR_LOG_RETENTION_DAYS;
  const auditEventRetentionDays = opts.auditEventRetentionDays ?? DEFAULT_AUDIT_EVENT_RETENTION_DAYS;

  const errorLogCutoff = new Date(Date.now() - errorLogRetentionDays * 86400000);
  const auditEventCutoff = new Date(Date.now() - auditEventRetentionDays * 86400000);

  const errorLogFilter = { createdAt: { $lt: errorLogCutoff } };
  const auditEventFilter = { timestamp: { $lt: auditEventCutoff } };

  const [errorLogsMatched, auditEventsMatched] = await Promise.all([
    db.collection("error_logs").countDocuments(errorLogFilter),
    db.collection("audit_events").countDocuments(auditEventFilter),
  ]);

  let errorLogsDeleted = 0;
  let auditEventsDeleted = 0;

  if (opts.apply) {
    const [errorLogsResult, auditEventsResult] = await Promise.all([
      db.collection("error_logs").deleteMany(errorLogFilter),
      db.collection("audit_events").deleteMany(auditEventFilter),
    ]);
    errorLogsDeleted = errorLogsResult.deletedCount || 0;
    auditEventsDeleted = auditEventsResult.deletedCount || 0;
  }

  return {
    apply: opts.apply,
    errorLogs: { retentionDays: errorLogRetentionDays, matched: errorLogsMatched, deleted: errorLogsDeleted },
    auditEvents: { retentionDays: auditEventRetentionDays, matched: auditEventsMatched, deleted: auditEventsDeleted },
  };
}
