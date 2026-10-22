export type SubscriptionLifecycleWindow = "seven-day" | "two-day" | "one-day" | "expired" | null;

const DAY_MS = 24 * 60 * 60 * 1000;

function finiteTimestamp(value: unknown): number | null {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function toSubscriptionExpiryKey(value: unknown): string | null {
  const timestamp = finiteTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function getSubscriptionLifecycleWindow(
  expiresAt: unknown,
  nowMs = Date.now(),
): SubscriptionLifecycleWindow {
  const expiryMs = finiteTimestamp(expiresAt);
  if (expiryMs === null) return null;
  if (expiryMs <= nowMs) return "expired";

  const daysLeft = Math.ceil((expiryMs - nowMs) / DAY_MS);
  if (daysLeft <= 1) return "one-day";
  if (daysLeft <= 2) return "two-day";
  if (daysLeft <= 7) return "seven-day";
  return null;
}

export function isLifetimeSubscription(subscription: Record<string, any>): boolean {
  return subscription.purchaseKind === "one_time" || subscription.billingCycle === "lifetime";
}

export function hasProtectedAccess(
  user: Record<string, any> | null | undefined,
  subscription?: Record<string, any> | null,
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (subscription?.adminManaged === true) return true;
  if (user.ambassador?.active === true) return true;
  if (user.adminTemporaryPlan?.active === true) return true;
  if (user.adminManagedSubscription?.active === true) return true;
  return false;
}

export function isPaidPlan(plan: unknown): boolean {
  const normalized = String(plan || "free").trim().toLowerCase();
  return normalized === "basic" || normalized === "growth" || normalized === "pro";
}

export function normalizePaidPlan(plan: unknown): "basic" | "growth" | null {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "basic") return "basic";
  if (normalized === "growth" || normalized === "pro") return "growth";
  return null;
}

export function subscriptionDaysLeft(expiresAt: unknown, nowMs = Date.now()): number | null {
  const expiryMs = finiteTimestamp(expiresAt);
  if (expiryMs === null) return null;
  return Math.ceil((expiryMs - nowMs) / DAY_MS);
}
