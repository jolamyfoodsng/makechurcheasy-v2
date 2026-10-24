/**
 * Pure rules for the admin bulk user delete: which users match an app-version rule and which ones
 * must never be deleted. No database access here, so it is easy to test.
 */

/** Pick users by their desktop app version. Exactly one key is set. */
export type VersionRule = { olderThan: string } | { exact: string } | { none: true };

export const RECENT_USE_PROTECTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeVersion(value: unknown): string {
  return String(value ?? "").trim().replace(/^v/i, "");
}

function parseVersion(value: string): number[] {
  return normalizeVersion(value)
    .split(/[.-]/)
    .map((part) => parseInt(part, 10) || 0);
}

/** Compares as numbers, part by part: 3.24.1 is newer than 3.3, and 3.3 equals 3.3.0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function highestVersion(versions: string[]): string | null {
  const clean = versions.map(normalizeVersion).filter(Boolean);
  if (clean.length === 0) return null;
  return clean.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** Reads a rule from request JSON. Returns null if it is not exactly one valid rule. */
export function parseVersionRule(raw: unknown): VersionRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const keys = ["olderThan", "exact", "none"].filter((k) => r[k] !== undefined && r[k] !== null && r[k] !== false);
  if (keys.length !== 1) return null;
  const version = /^\d+(\.\d+){0,3}$/;
  if (keys[0] === "none") return r.none === true ? { none: true } : null;
  const value = normalizeVersion(r[keys[0]]);
  if (!version.test(value)) return null;
  return keys[0] === "olderThan" ? { olderThan: value } : { exact: value };
}

/** "Older than" uses the newest version on any of the user's computers. No version at all never counts as older. */
export function matchesVersionRule(versions: string[], rule: VersionRule): boolean {
  const clean = Array.from(new Set(versions.map(normalizeVersion).filter(Boolean)));
  if ("none" in rule) return clean.length === 0;
  if ("exact" in rule) return clean.some((v) => compareVersions(v, rule.exact) === 0);
  const best = highestVersion(clean);
  return best !== null && compareVersions(best, rule.olderThan) < 0;
}

export interface DeletionCandidate {
  id: string;
  role: string;
  /** From getEffectivePlan: "free", "trial" or a paid plan. */
  effectivePlan: string;
  ambassadorActive: boolean;
  temporaryPlanActive: boolean;
  managedSubscriptionActive: boolean;
  hasSubscriptionRecord: boolean;
  hasPaymentRecord: boolean;
  /** Last real use (presenting, searching, songs, uploads), ISO string or null. */
  lastUseAt: string | null;
  versions: string[];
}

/**
 * Why this user must not be deleted, or null when they can go. The first reason found is returned.
 * Checked again on the server for every user, whatever the admin page selected.
 */
export function whyProtected(
  candidate: DeletionCandidate,
  rule: VersionRule,
  adminUserId: string,
  nowMs: number = Date.now(),
): string | null {
  if (candidate.id === adminUserId) return "Your own account";
  if (candidate.role === "admin") return "Admin account";
  if (!matchesVersionRule(candidate.versions, rule)) return "Does not match the app version rule";
  if (candidate.effectivePlan !== "free") return "Has an active trial or paid plan";
  if (candidate.ambassadorActive) return "Active ambassador";
  if (candidate.temporaryPlanActive) return "Has a temporary plan from an admin";
  if (candidate.managedSubscriptionActive) return "Has a subscription managed by an admin";
  if (candidate.hasSubscriptionRecord) return "Has subscription records";
  if (candidate.hasPaymentRecord) return "Has payment records";
  if (candidate.lastUseAt) {
    const last = Date.parse(candidate.lastUseAt);
    if (Number.isFinite(last) && nowMs - last < RECENT_USE_PROTECTION_DAYS * DAY_MS) {
      return `Used the product in the last ${RECENT_USE_PROTECTION_DAYS} days`;
    }
  }
  return null;
}
