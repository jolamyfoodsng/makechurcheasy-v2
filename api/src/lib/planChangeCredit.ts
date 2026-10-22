/**
 * planChangeCredit.ts — credit for the unused time of the current plan when someone changes plan
 * (Growth to Basic, Basic to Growth) or switches between monthly and yearly.
 *
 * Payments here are one-off charges for a period, so changing plan used to throw the remaining days away.
 * The formula is the usual proration one:
 *
 *   credit = amount paid for the current period x (time left / length of that period)
 *
 * The credit comes off the new plan's price. When it is worth more than the new price (a downgrade late in a
 * paid period), nothing is charged and the leftover buys extra days of the new plan at its daily price.
 */
import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";

export type ChangeableCycle = "monthly" | "yearly";
export type ChangeablePlan = "basic" | "growth";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_DAYS: Record<ChangeableCycle, number> = { monthly: 30, yearly: 365 };
/** Below this the leftover is not worth a card charge: the new plan is simply switched on. */
export const MIN_CHARGE = 1;
/** However big the leftover credit is, the new plan never runs longer than this beyond its paid period. */
export const MAX_EXTRA_DAYS = 730;
/** With less than this left there is nothing worth crediting. */
export const MIN_REMAINING_MS = 6 * 60 * 60 * 1000;

export interface PlanChangeContext {
  currentPlan: ChangeablePlan;
  currentCycle: ChangeableCycle;
  /** When the current paid access ends. */
  expiresAt: Date;
  /** The payment that bought the current period. */
  lastPayment: {
    amount: number;
    currency: string;
    paidAt: Date;
    expiresAt: Date;
  };
}

export interface PlanChangeQuote {
  eligible: boolean;
  reason?: "same_plan" | "no_credit" | "currency_differs" | "no_paid_period";
  currentPlan?: ChangeablePlan;
  currentCycle?: ChangeableCycle;
  newPlan: ChangeablePlan;
  newCycle: ChangeableCycle;
  currency: string;
  /** Whole days left on the current plan (rounded down). */
  daysLeft: number;
  /** The new plan's price before credit. */
  newPrice: number;
  /** Value of the unused time. */
  creditValue: number;
  /** How much of the credit is used on the new price. */
  creditApplied: number;
  /** What is left to pay (0 when the credit covers everything). */
  amountDue: number;
  /** True when no payment is needed: the credit covers the new price. */
  coversAll: boolean;
  /** Extra days of the new plan bought with the leftover credit (only when coversAll). */
  extraDays: number;
  /** When access on the new plan ends. */
  newExpiresAt: string;
}

const roundDown2 = (value: number) => Math.floor(value * 100 + 1e-9) / 100;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The value of the time left on the current period. */
export function unusedCredit(input: {
  amountPaid: number;
  periodStart: Date;
  periodEnd: Date;
  /** When the plan is paid until (it can be later than the period if access was extended). */
  accessEnd: Date;
  now: Date;
}): { creditValue: number; remainingMs: number; totalMs: number } {
  const totalMs = input.periodEnd.getTime() - input.periodStart.getTime();
  if (!(totalMs > 0) || !(input.amountPaid > 0)) return { creditValue: 0, remainingMs: 0, totalMs: Math.max(0, totalMs) };
  const remaining = Math.min(input.accessEnd.getTime(), input.periodEnd.getTime()) - input.now.getTime();
  const remainingMs = Math.min(totalMs, Math.max(0, remaining));
  if (remainingMs < MIN_REMAINING_MS) return { creditValue: 0, remainingMs, totalMs };
  return { creditValue: roundDown2(input.amountPaid * (remainingMs / totalMs)), remainingMs, totalMs };
}

/**
 * What changing plan costs, given what is already paid. Pure: the route and the quote endpoint both use it,
 * so the price shown is the price charged.
 */
export function quotePlanChange(input: {
  context: PlanChangeContext | null;
  newPlan: ChangeablePlan;
  newCycle: ChangeableCycle;
  /** The new plan's price in `currency`, after any discount code. */
  newPrice: number;
  currency: string;
  now?: Date;
}): PlanChangeQuote {
  const now = input.now ?? new Date();
  const newPeriodDays = PERIOD_DAYS[input.newCycle];
  const base: PlanChangeQuote = {
    eligible: false,
    newPlan: input.newPlan,
    newCycle: input.newCycle,
    currency: input.currency.toUpperCase(),
    daysLeft: 0,
    newPrice: round2(input.newPrice),
    creditValue: 0,
    creditApplied: 0,
    amountDue: round2(input.newPrice),
    coversAll: false,
    extraDays: 0,
    newExpiresAt: new Date(now.getTime() + newPeriodDays * DAY_MS).toISOString(),
  };
  const ctx = input.context;
  if (!ctx) return { ...base, reason: "no_paid_period" };
  const withCurrent = { ...base, currentPlan: ctx.currentPlan, currentCycle: ctx.currentCycle };
  if (ctx.currentPlan === input.newPlan && ctx.currentCycle === input.newCycle) return { ...withCurrent, reason: "same_plan" };
  if (ctx.lastPayment.currency.toUpperCase() !== input.currency.toUpperCase()) return { ...withCurrent, reason: "currency_differs" };

  const { creditValue, remainingMs } = unusedCredit({
    amountPaid: ctx.lastPayment.amount,
    periodStart: ctx.lastPayment.paidAt,
    periodEnd: ctx.lastPayment.expiresAt,
    accessEnd: ctx.expiresAt,
    now,
  });
  const daysLeft = Math.floor(remainingMs / DAY_MS);
  if (creditValue <= 0) return { ...withCurrent, daysLeft, reason: "no_credit" };

  const price = round2(input.newPrice);
  const due = round2(Math.max(0, price - creditValue));
  if (due >= MIN_CHARGE) {
    return {
      ...withCurrent,
      eligible: true,
      daysLeft,
      creditValue,
      creditApplied: creditValue,
      amountDue: due,
      coversAll: false,
      extraDays: 0,
    };
  }

  // The credit covers the new plan. What is left over buys more days at the new plan's daily price.
  const leftover = Math.max(0, creditValue - price);
  const dailyPrice = price / newPeriodDays;
  const extraDays = dailyPrice > 0 ? Math.min(MAX_EXTRA_DAYS, Math.floor(leftover / dailyPrice)) : 0;
  return {
    ...withCurrent,
    eligible: true,
    daysLeft,
    creditValue,
    creditApplied: Math.min(creditValue, price),
    amountDue: 0,
    coversAll: true,
    extraDays,
    newExpiresAt: new Date(now.getTime() + (newPeriodDays + extraDays) * DAY_MS).toISOString(),
  };
}

const PLANS: ChangeablePlan[] = ["basic", "growth"];

/**
 * The person's current paid period, or null when there is none to credit: free or trial, admin-given access,
 * expired, a one-time purchase, or no payment on record.
 */
export async function loadPlanChangeContext(
  userId: string,
  user: {
    plan?: string;
    role?: string;
    subscriptionExpiresAt?: string | Date | null;
    ambassador?: { active?: boolean } | null;
    adminTemporaryPlan?: { active?: boolean; expiresAt?: string | null } | null;
    adminManagedSubscription?: { active?: boolean; expiresAt?: string | null } | null;
  },
  now: Date = new Date(),
): Promise<PlanChangeContext | null> {
  const plan = String(user.plan || "").toLowerCase() as ChangeablePlan;
  if (!PLANS.includes(plan)) return null;
  const grantActive = (grant?: { active?: boolean; expiresAt?: string | null } | null) =>
    Boolean(grant?.active) && (!grant?.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime());
  if (user.role === "admin" || user.ambassador?.active || grantActive(user.adminTemporaryPlan) || grantActive(user.adminManagedSubscription)) {
    return null;
  }
  const accessEnd = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  if (!accessEnd || !Number.isFinite(accessEnd.getTime()) || accessEnd.getTime() <= now.getTime()) return null;

  let objectId: ObjectId | string = userId;
  try { objectId = new ObjectId(userId); } catch { /* legacy ids are stored as given */ }
  const client = await clientPromise;
  const last = await client.db().collection("billing_transactions").findOne(
    {
      userId: { $in: [userId, objectId] },
      status: "success",
      type: "subscription_purchase",
      purchaseKind: "subscription",
      amount: { $gt: 0 },
      billingCycle: { $in: ["monthly", "yearly"] },
    },
    { sort: { paidAt: -1 } },
  );
  if (!last) return null;
  const paidAt = new Date(String(last.paidAt || last.createdAt || ""));
  const expiresAt = new Date(String(last.expiresAt || ""));
  const amount = Number(last.amount);
  if (!Number.isFinite(paidAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || !(amount > 0)) return null;
  // The payment that is still paying for the plan the person is on.
  if (String(last.plan || "").toLowerCase() !== plan) return null;

  return {
    currentPlan: plan,
    currentCycle: last.billingCycle === "yearly" ? "yearly" : "monthly",
    expiresAt: accessEnd,
    lastPayment: { amount, currency: String(last.currency || "").toUpperCase(), paidAt, expiresAt },
  };
}
