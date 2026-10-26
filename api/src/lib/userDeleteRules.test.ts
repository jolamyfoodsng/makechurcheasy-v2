import { describe, expect, it } from "vitest";
import {
  compareVersions,
  highestVersion,
  matchesVersionRule,
  parseVersionRule,
  subscriptionCountsAsBilling,
  whyProtected,
  type DeletionCandidate,
} from "./userDeleteRules";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function candidate(overrides: Partial<DeletionCandidate> = {}): DeletionCandidate {
  return {
    id: "u1",
    role: "user",
    effectivePlan: "free",
    ambassadorActive: false,
    temporaryPlanActive: false,
    managedSubscriptionActive: false,
    hasSubscriptionRecord: false,
    hasPaymentRecord: false,
    lastUseAt: null,
    versions: ["3.1.0"],
    ...overrides,
  };
}

describe("version comparison", () => {
  it("compares numbers, not text", () => {
    expect(compareVersions("3.24.1", "3.3")).toBe(1);
    expect(compareVersions("3.19.0", "3.3.0")).toBe(1);
    expect(compareVersions("3.2.4", "3.3")).toBe(-1);
    expect(compareVersions("3.3", "3.3.0")).toBe(0);
    expect(compareVersions("v2.74.0", "3.0.0")).toBe(-1);
  });

  it("finds the newest version", () => {
    expect(highestVersion(["3.1.0", "v3.24.1", "2.0.0"])).toBe("3.24.1");
    expect(highestVersion([])).toBeNull();
  });
});

describe("version rules", () => {
  it("older than uses the newest version on any computer", () => {
    expect(matchesVersionRule(["3.2.4"], { olderThan: "3.3" })).toBe(true);
    expect(matchesVersionRule(["3.2.4", "4.0.0"], { olderThan: "3.3" })).toBe(false);
    expect(matchesVersionRule(["3.3.0"], { olderThan: "3.3" })).toBe(false);
    expect(matchesVersionRule(["3.24.1"], { olderThan: "3.3" })).toBe(false);
  });

  it("a user with no version is never older than anything", () => {
    expect(matchesVersionRule([], { olderThan: "3.3" })).toBe(false);
    expect(matchesVersionRule([], { none: true })).toBe(true);
    expect(matchesVersionRule(["3.1.0"], { none: true })).toBe(false);
  });

  it("exact matches any of the user's versions", () => {
    expect(matchesVersionRule(["3.1.0", "4.0.0"], { exact: "v3.1.0" })).toBe(true);
    expect(matchesVersionRule(["3.1.1"], { exact: "3.1.0" })).toBe(false);
  });

  it("accepts exactly one valid rule", () => {
    expect(parseVersionRule({ olderThan: "3.3" })).toEqual({ olderThan: "3.3" });
    expect(parseVersionRule({ exact: "v3.1.0" })).toEqual({ exact: "3.1.0" });
    expect(parseVersionRule({ none: true })).toEqual({ none: true });
    expect(parseVersionRule({ olderThan: "3.3", exact: "3.1.0" })).toBeNull();
    expect(parseVersionRule({ olderThan: "latest" })).toBeNull();
    expect(parseVersionRule({ none: false })).toBeNull();
    expect(parseVersionRule({})).toBeNull();
    expect(parseVersionRule(null)).toBeNull();
  });
});

describe("who is protected", () => {
  const rule = { olderThan: "3.3" };

  it("lets an unused free user on an old version go", () => {
    expect(whyProtected(candidate(), rule, "admin1", NOW)).toBeNull();
    expect(whyProtected(candidate({ lastUseAt: "2026-06-01T00:00:00Z" }), rule, "admin1", NOW)).toBeNull();
  });

  it("protects admins and the admin doing the deleting", () => {
    expect(whyProtected(candidate({ role: "admin" }), rule, "admin1", NOW)).toBe("Admin account");
    expect(whyProtected(candidate({ id: "admin1" }), rule, "admin1", NOW)).toBe("Your own account");
  });

  it("protects anyone who no longer matches the version rule", () => {
    expect(whyProtected(candidate({ versions: ["4.0.0"] }), rule, "admin1", NOW)).toBe("Does not match the app version rule");
  });

  it("protects trials, paid plans and anything with billing history", () => {
    expect(whyProtected(candidate({ effectivePlan: "trial" }), rule, "admin1", NOW)).toBe("Has an active trial or paid plan");
    expect(whyProtected(candidate({ effectivePlan: "growth" }), rule, "admin1", NOW)).toBe("Has an active trial or paid plan");
    expect(whyProtected(candidate({ ambassadorActive: true }), rule, "admin1", NOW)).toBe("Active ambassador");
    expect(whyProtected(candidate({ temporaryPlanActive: true }), rule, "admin1", NOW)).toBe("Has a temporary plan from an admin");
    expect(whyProtected(candidate({ managedSubscriptionActive: true }), rule, "admin1", NOW)).toBe("Has a subscription managed by an admin");
    expect(whyProtected(candidate({ hasSubscriptionRecord: true }), rule, "admin1", NOW)).toBe("Has subscription records");
    expect(whyProtected(candidate({ hasPaymentRecord: true }), rule, "admin1", NOW)).toBe("Has payment records");
  });

  it("protects anyone who really used the product in the last 30 days", () => {
    expect(whyProtected(candidate({ lastUseAt: "2026-10-10T00:00:00Z" }), rule, "admin1", NOW)).toBe("Used the product in the last 30 days");
  });
});

describe("subscriptionCountsAsBilling", () => {
  it("does not count the ended free record a finished trial leaves behind", () => {
    expect(subscriptionCountsAsBilling({ plan: "free", status: "cancelled" })).toBe(false);
    expect(subscriptionCountsAsBilling({ plan: "free", status: "canceled" })).toBe(false);
    expect(subscriptionCountsAsBilling({ plan: "free", status: "expired" })).toBe(false);
    expect(subscriptionCountsAsBilling({ status: "cancelled" })).toBe(false);
  });

  it("counts paid plans and anything still active, whatever the plan", () => {
    expect(subscriptionCountsAsBilling({ plan: "basic", status: "cancelled" })).toBe(true);
    expect(subscriptionCountsAsBilling({ plan: "growth", status: "active" })).toBe(true);
    expect(subscriptionCountsAsBilling({ plan: "free", status: "active" })).toBe(true);
    expect(subscriptionCountsAsBilling({ plan: "free", status: "past_due" })).toBe(true);
    expect(subscriptionCountsAsBilling({})).toBe(true);
  });
});

describe("inactive-user rules", () => {
  const NOW_MS = Date.parse("2026-10-25T00:00:00Z");

  it("matches every version with the any rule", () => {
    expect(parseVersionRule({ any: true })).toEqual({ any: true });
    expect(matchesVersionRule([], { any: true })).toBe(true);
    expect(matchesVersionRule(["3.24.0"], { any: true })).toBe(true);
  });

  it("protects anyone who opened the app in the last 30 days, even without real use", () => {
    expect(whyProtected(candidate({ lastOpenedAt: "2026-10-20T00:00:00Z" }), { any: true }, "admin1", NOW_MS)).toBe(
      "Opened the app in the last 30 days",
    );
  });

  it("lets go of someone who neither opened nor used it for over a month", () => {
    expect(
      whyProtected(
        candidate({ lastOpenedAt: "2026-09-01T00:00:00Z", lastUseAt: "2026-08-01T00:00:00Z" }),
        { any: true },
        "admin1",
        NOW_MS,
      ),
    ).toBeNull();
  });
});
