import { describe, expect, it } from "vitest";
import { MAX_EXTRA_DAYS, quotePlanChange, unusedCredit, type PlanChangeContext } from "./planChangeCredit";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-20T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const ahead = (days: number) => new Date(now.getTime() + days * DAY);

/** Paid R140 for a Growth month 10 days ago: 20 of 30 days left. */
const growthMonthly: PlanChangeContext = {
  currentPlan: "growth",
  currentCycle: "monthly",
  expiresAt: ahead(20),
  lastPayment: { amount: 140, currency: "ZAR", paidAt: ago(10), expiresAt: ahead(20) },
};

describe("unusedCredit", () => {
  it("is the share of the paid amount that is still unused", () => {
    const { creditValue } = unusedCredit({ amountPaid: 140, periodStart: ago(10), periodEnd: ahead(20), accessEnd: ahead(20), now });
    expect(creditValue).toBeCloseTo(93.33, 2);
  });

  it("is nothing once the period is over, or in the last few hours", () => {
    expect(unusedCredit({ amountPaid: 140, periodStart: ago(30), periodEnd: ago(0), accessEnd: ago(0), now }).creditValue).toBe(0);
    expect(unusedCredit({ amountPaid: 140, periodStart: ago(30), periodEnd: new Date(now.getTime() + 3 * 60 * 60 * 1000), accessEnd: ahead(1), now }).creditValue).toBe(0);
  });

  it("never exceeds what was paid, even if access was extended", () => {
    const { creditValue } = unusedCredit({ amountPaid: 140, periodStart: ago(1), periodEnd: ahead(29), accessEnd: ahead(90), now });
    expect(creditValue).toBeLessThanOrEqual(140);
  });

  it("rounds down, so the credit is never more than the time is worth", () => {
    const { creditValue } = unusedCredit({ amountPaid: 100, periodStart: ago(10), periodEnd: ahead(20), accessEnd: ahead(20), now });
    expect(creditValue).toBe(66.66);
  });
});

describe("quotePlanChange", () => {
  it("upgrade: the credit comes off the new price", () => {
    const basicMonthly: PlanChangeContext = { ...growthMonthly, currentPlan: "basic", lastPayment: { ...growthMonthly.lastPayment, amount: 70 } };
    const q = quotePlanChange({ context: basicMonthly, newPlan: "growth", newCycle: "monthly", newPrice: 140, currency: "ZAR", now });
    expect(q.eligible).toBe(true);
    expect(q.creditValue).toBeCloseTo(46.66, 2);
    expect(q.amountDue).toBeCloseTo(93.34, 2);
    expect(q.coversAll).toBe(false);
    expect(q.extraDays).toBe(0);
  });

  it("downgrade late in the month: nothing to pay, the leftover buys extra days", () => {
    // Growth R140, 20 days left: credit R93.33. Basic is R70/mo (R2.33/day): leftover R23.33 = 10 days.
    const q = quotePlanChange({ context: growthMonthly, newPlan: "basic", newCycle: "monthly", newPrice: 70, currency: "ZAR", now });
    expect(q.eligible).toBe(true);
    expect(q.coversAll).toBe(true);
    expect(q.amountDue).toBe(0);
    expect(q.extraDays).toBe(9); // floor(23.33 / 2.3333)
    expect(new Date(q.newExpiresAt).getTime() - now.getTime()).toBe((30 + 9) * DAY);
  });

  it("downgrade early in the month: the credit is smaller than the new price, so a small charge remains", () => {
    const early: PlanChangeContext = { ...growthMonthly, expiresAt: ahead(28), lastPayment: { ...growthMonthly.lastPayment, paidAt: ago(2), expiresAt: ahead(28) } };
    const q = quotePlanChange({ context: early, newPlan: "basic", newCycle: "monthly", newPrice: 70, currency: "ZAR", now });
    // Credit 28/30 x 140 = 130.66 covers Basic's R70, so it is free with extra days instead.
    expect(q.coversAll).toBe(true);
    expect(q.amountDue).toBe(0);
    expect(q.extraDays).toBeGreaterThan(20);
  });

  it("monthly to yearly on the same plan: the credit comes off the yearly price", () => {
    const q = quotePlanChange({ context: growthMonthly, newPlan: "growth", newCycle: "yearly", newPrice: 1070, currency: "ZAR", now });
    expect(q.eligible).toBe(true);
    expect(q.amountDue).toBeCloseTo(976.67, 2);
    expect(new Date(q.newExpiresAt).getTime() - now.getTime()).toBe(365 * DAY);
  });

  it("same plan and cycle is a renewal, not a change", () => {
    const q = quotePlanChange({ context: growthMonthly, newPlan: "growth", newCycle: "monthly", newPrice: 140, currency: "ZAR", now });
    expect(q).toMatchObject({ eligible: false, reason: "same_plan", amountDue: 140 });
  });

  it("no credit when there is no paid period, or it was paid in another currency", () => {
    expect(quotePlanChange({ context: null, newPlan: "basic", newCycle: "monthly", newPrice: 70, currency: "ZAR", now })).toMatchObject({ eligible: false, reason: "no_paid_period", amountDue: 70 });
    expect(quotePlanChange({ context: growthMonthly, newPlan: "basic", newCycle: "monthly", newPrice: 5, currency: "USD", now })).toMatchObject({ eligible: false, reason: "currency_differs", amountDue: 5 });
  });

  it("caps the extra days", () => {
    const yearly: PlanChangeContext = { currentPlan: "growth", currentCycle: "yearly", expiresAt: ahead(360), lastPayment: { amount: 1070, currency: "ZAR", paidAt: ago(5), expiresAt: ahead(360) } };
    // A cheap plan makes the leftover buy years: it stops at the cap.
    const q = quotePlanChange({ context: yearly, newPlan: "basic", newCycle: "monthly", newPrice: 10, currency: "ZAR", now });
    expect(q.coversAll).toBe(true);
    expect(q.extraDays).toBe(MAX_EXTRA_DAYS);
  });

  it("a yearly Growth downgraded to monthly Basic gets a long, but sensible, run", () => {
    const yearly: PlanChangeContext = { currentPlan: "growth", currentCycle: "yearly", expiresAt: ahead(360), lastPayment: { amount: 1070, currency: "ZAR", paidAt: ago(5), expiresAt: ahead(360) } };
    const q = quotePlanChange({ context: yearly, newPlan: "basic", newCycle: "monthly", newPrice: 70, currency: "ZAR", now });
    expect(q.extraDays).toBe(422);
  });

  it("is deterministic: the same inputs always give the same quote", () => {
    const a = quotePlanChange({ context: growthMonthly, newPlan: "basic", newCycle: "yearly", newPrice: 520, currency: "ZAR", now });
    const b = quotePlanChange({ context: growthMonthly, newPlan: "basic", newCycle: "yearly", newPrice: 520, currency: "ZAR", now });
    expect(a).toEqual(b);
  });
});
