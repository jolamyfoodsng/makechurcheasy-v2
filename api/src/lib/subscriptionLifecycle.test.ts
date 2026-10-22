import assert from "node:assert/strict";
import test from "node:test";
import {
  getSubscriptionLifecycleWindow,
  hasProtectedAccess,
  isLifetimeSubscription,
  subscriptionDaysLeft,
  toSubscriptionExpiryKey,
} from "./subscriptionLifecycle";

const NOW = Date.parse("2026-08-23T00:00:00.000Z");

test("classifies seven-day and two-day reminders", () => {
  assert.equal(
    getSubscriptionLifecycleWindow("2026-08-30T00:00:00.000Z", NOW),
    "seven-day",
  );
  assert.equal(
    getSubscriptionLifecycleWindow("2026-08-25T00:00:00.000Z", NOW),
    "two-day",
  );
  assert.equal(
    getSubscriptionLifecycleWindow("2026-08-24T23:59:59.000Z", NOW),
    "two-day",
  );
});

test("classifies the final day as one-day", () => {
  assert.equal(getSubscriptionLifecycleWindow("2026-08-23T23:59:59.000Z", NOW), "one-day");
  assert.equal(getSubscriptionLifecycleWindow("2026-08-24T00:00:00.000Z", NOW), "one-day");
});

test("classifies expired and ignores invalid or distant dates", () => {
  assert.equal(
    getSubscriptionLifecycleWindow("2026-08-22T23:59:59.000Z", NOW),
    "expired",
  );
  assert.equal(getSubscriptionLifecycleWindow("not-a-date", NOW), null);
  assert.equal(getSubscriptionLifecycleWindow("2026-09-01T00:00:00.000Z", NOW), null);
  assert.equal(subscriptionDaysLeft("2026-08-30T00:00:00.000Z", NOW), 7);
  assert.equal(toSubscriptionExpiryKey("2026-08-30T00:00:00.000Z"), "2026-08-30T00:00:00.000Z");
});

test("protects lifetime and managed access from paid expiry demotion", () => {
  assert.equal(isLifetimeSubscription({ purchaseKind: "one_time" }), true);
  assert.equal(isLifetimeSubscription({ billingCycle: "lifetime" }), true);
  assert.equal(isLifetimeSubscription({ billingCycle: "monthly" }), false);
  assert.equal(hasProtectedAccess({ role: "admin" }), true);
  assert.equal(hasProtectedAccess({ ambassador: { active: true } }), true);
  assert.equal(hasProtectedAccess({ adminTemporaryPlan: { active: true } }), true);
  assert.equal(hasProtectedAccess({}, { adminManaged: true }), true);
  assert.equal(hasProtectedAccess({}), false);
});
