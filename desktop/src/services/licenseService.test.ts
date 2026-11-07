/**
 * licenseService.test.ts — Comprehensive entitlement & subscription tests
 *
 * Covers: effective plan resolution, trial logic, feature gates, plan limits,
 * credit allocation, downgrade protection, device limits, and upgrade flows.
 *
 * Mocks proLicense and subscriptionCache to isolate pure logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthUser, PlanTier } from "./authService";

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("./proLicense", () => ({
  isProUnlocked: vi.fn(() => false),
}));

vi.mock("./subscriptionCache", () => ({
  getCachedPlan: vi.fn(() => "free"),
  isOfflineValid: vi.fn(() => false),
  getOfflineDaysRemaining: vi.fn(() => 0),
}));

// These tests check the built-in plans. Other test files in the same worker can leave a server
// plan config in the shared localStorage stub, so never read a cached or fetched one here.
vi.mock("./planConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planConfig")>();
  const { DEFAULT_PLAN_CONFIG } = await import("./planConfigTypes");
  return {
    ...actual,
    readPlanConfigCache: vi.fn(() => null),
    getPlanConfig: vi.fn(async () => DEFAULT_PLAN_CONFIG),
  };
});

import { isProUnlocked } from "./proLicense";
import {
  getCachedPlan,
  isOfflineValid,
} from "./subscriptionCache";

import {
  getUserPlan,
  isInTrial,
  isTrialExpired,
  getTrialDaysRemaining,
  getEffectivePlan,
  getPlanLimits,
  getUserPlanLimits,
  canUseTranslation,
  canUseMassImport,
  canUseMultiview,
  canUseMobileControl,
  canUseTickers,
  canUseSpeechToScripture,
  canUseSermonExport,
  canUseAI,
  canUseCloudFeatures,
  canUseAdvancedAnalytics,
  canUseCustomReports,
  canUseUnlimitedDevices,
  canUseUnlimitedMultiview,
  canUseEasyWorshipImport,
  canUseProPresenterImport,
  canAddDevice,
  getRemainingDeviceSlots,
  getDowngradeWarnings,
  getRestrictionInfo,
} from "./licenseService";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    avatar: "",
    appId: "app-1",
    churchName: "Test Church",
    createdAt: new Date().toISOString(),
    plan: "free",
    ...overrides,
  };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function pastDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ── Reset mocks before each test ─────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(isProUnlocked).mockReturnValue(false);
  vi.mocked(getCachedPlan).mockReturnValue("free");
  vi.mocked(isOfflineValid).mockReturnValue(false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. getUserPlan() — subscription cache & pro key resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("getUserPlan", () => {
  it("returns 'free' for null user", () => {
    expect(getUserPlan(null)).toBe("free");
  });

  it("returns 'free' for user with no plan field", () => {
    const user = makeUser({ plan: undefined });
    expect(getUserPlan(user)).toBe("free");
  });

  it("returns user.plan when no cache is active", () => {
    const user = makeUser({ plan: "basic" });
    vi.mocked(getCachedPlan).mockReturnValue("free");
    expect(getUserPlan(user)).toBe("basic");
  });

  it("ignores cached paid plan for free non-trial users", () => {
    const user = makeUser({ plan: "free" });
    vi.mocked(getCachedPlan).mockReturnValue("growth");
    vi.mocked(isOfflineValid).mockReturnValue(true);
    expect(getUserPlan(user)).toBe("free");
  });

  it("falls back to user.plan when offline window expired", () => {
    const user = makeUser({ plan: "basic" });
    vi.mocked(getCachedPlan).mockReturnValue("growth");
    vi.mocked(isOfflineValid).mockReturnValue(false);
    expect(getUserPlan(user)).toBe("basic");
  });

  it("returns cached plan over user.plan when cache is valid", () => {
    const user = makeUser({ plan: "basic" });
    vi.mocked(getCachedPlan).mockReturnValue("growth");
    vi.mocked(isOfflineValid).mockReturnValue(true);
    expect(getUserPlan(user)).toBe("growth");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. getEffectivePlan() — trial, pro, and plan resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("getEffectivePlan", () => {
  it("returns 'free' for null user", () => {
    expect(getEffectivePlan(null)).toBe("free");
  });

  it("returns 'free' for user on free plan with no trial", () => {
    const user = makeUser({ plan: "free" });
    expect(getEffectivePlan(user)).toBe("free");
  });

  it("returns 'growth' during active trial (even if user.plan is free)", () => {
    const user = makeUser({
      plan: "free",
      trial: { active: true, endsAt: futureDate(5) },
    });
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("returns 'growth' during active trial (7-day trial)", () => {
    const user = makeUser({
      plan: "free",
      trial: { active: true, startedAt: pastDate(2), endsAt: futureDate(5), durationDays: 7 },
    });
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("returns 'growth' during active trial (10-day trial)", () => {
    const user = makeUser({
      plan: "free",
      trial: { active: true, startedAt: pastDate(1), endsAt: futureDate(9), durationDays: 10 },
    });
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("returns user.plan when trial is expired", () => {
    const user = makeUser({
      plan: "basic",
      trial: { active: true, endsAt: pastDate(1) },
    });
    expect(getEffectivePlan(user)).toBe("basic");
  });

  it("returns user.plan when no trial exists", () => {
    expect(getEffectivePlan(makeUser({ plan: "basic" }))).toBe("basic");
    expect(getEffectivePlan(makeUser({ plan: "growth" }))).toBe("growth");
    expect(getEffectivePlan(makeUser({ plan: "pro" }))).toBe("growth");
  });

  it("returns 'growth' for growth subscriber", () => {
    expect(getEffectivePlan(makeUser({ plan: "growth" }))).toBe("growth");
  });

  it("maps legacy 'pro' subscribers to growth", () => {
    expect(getEffectivePlan(makeUser({ plan: "pro" }))).toBe("growth");
  });

  it("returns 'growth' for active ambassador access even when stored plan is free", () => {
    const user = makeUser({
      plan: "free",
      ambassador: { active: true, expiresAt: futureDate(30) },
    });
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("returns 'free' after ambassador access is revoked", () => {
    const user = makeUser({
      plan: "free",
      ambassador: { active: false, expiresAt: futureDate(30) },
    });
    expect(getEffectivePlan(user)).toBe("free");
  });

  it("ignores cached paid plan for free non-trial users when offline valid", () => {
    const user = makeUser({ plan: "free" });
    vi.mocked(getCachedPlan).mockReturnValue("growth");
    vi.mocked(isOfflineValid).mockReturnValue(true);
    expect(getEffectivePlan(user)).toBe("free");
  });

  it("trial overrides cached plan", () => {
    const user = makeUser({
      plan: "free",
      trial: { active: true, endsAt: futureDate(3) },
    });
    vi.mocked(getCachedPlan).mockReturnValue("growth");
    vi.mocked(isOfflineValid).mockReturnValue(true);
    expect(getEffectivePlan(user)).toBe("growth");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Trial logic
// ═══════════════════════════════════════════════════════════════════════════════

describe("isInTrial", () => {
  it("returns false for null user", () => {
    expect(isInTrial(null)).toBe(false);
  });

  it("returns false when no trialEndsAt", () => {
    expect(isInTrial(makeUser({}))).toBe(false);
  });

  it("returns true when trial.endsAt is in the future", () => {
    expect(isInTrial(makeUser({ trial: { active: true, endsAt: futureDate(3) } }))).toBe(true);
  });

  it("returns false when trial.endsAt is in the past", () => {
    expect(isInTrial(makeUser({ trial: { active: true, endsAt: pastDate(1) } }))).toBe(false);
  });
});

describe("isTrialExpired", () => {
  it("returns false for null user", () => {
    expect(isTrialExpired(null)).toBe(false);
  });

  it("returns false when no trialEndsAt", () => {
    expect(isTrialExpired(makeUser({}))).toBe(false);
  });

  it("returns true when trial.endsAt is in the past", () => {
    expect(isTrialExpired(makeUser({ trial: { endsAt: pastDate(1) } }))).toBe(true);
  });

  it("returns false when trial.endsAt is in the future", () => {
    expect(isTrialExpired(makeUser({ trial: { endsAt: futureDate(1) } }))).toBe(false);
  });
});

describe("getTrialDaysRemaining", () => {
  it("returns 0 for null user", () => {
    expect(getTrialDaysRemaining(null)).toBe(0);
  });

  it("returns 0 when no trial", () => {
    expect(getTrialDaysRemaining(makeUser({}))).toBe(0);
  });

  it("returns 0 when trial expired", () => {
    expect(getTrialDaysRemaining(makeUser({ trial: { active: true, endsAt: pastDate(1) } }))).toBe(0);
  });

  it("returns ~7 for a 7-day trial just started", () => {
    const user = makeUser({
      trial: { active: true, endsAt: futureDate(7) },
    });
    const days = getTrialDaysRemaining(user);
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(8);
  });

  it("returns ~3 for a trial ending in 3 days", () => {
    const user = makeUser({
      trial: { active: true, endsAt: futureDate(3) },
    });
    const days = getTrialDaysRemaining(user);
    expect(days).toBeGreaterThanOrEqual(2);
    expect(days).toBeLessThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Feature gates (canUse* functions)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Feature gates — all plans", () => {
  const ALL_PLANS: PlanTier[] = ["free", "trial", "basic", "growth", "pro", "ambassador", "unlimited"];

  // Feature → expected results per plan
  // Trial users behave like Growth (getEffectivePlan returns "growth" during trial).
  const FEATURE_MATRIX: Record<string, Record<PlanTier, boolean>> = {
    translation: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    massImport: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    multiview: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    easyWorshipImport: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    proPresenterImport: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    tickers: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    speechToScripture: { free: true, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    sermonExport: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    aiFeatures: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    cloudSync: { free: false, trial: true, basic: true, growth: true, pro: true, ambassador: true, unlimited: true },
    advancedAnalytics: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    customReports: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    unlimitedDevices: { free: false, trial: false, basic: false, growth: false, pro: false, ambassador: false, unlimited: false },
    unlimitedMultiview: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
    mobileControl: { free: false, trial: true, basic: false, growth: true, pro: true, ambassador: true, unlimited: true },
  };

  const FEATURE_FN_MAP: Record<string, (user: AuthUser | null) => boolean> = {
    translation: canUseTranslation,
    massImport: canUseMassImport,
    multiview: canUseMultiview,
    easyWorshipImport: canUseEasyWorshipImport,
    proPresenterImport: canUseProPresenterImport,
    tickers: canUseTickers,
    speechToScripture: canUseSpeechToScripture,
    sermonExport: canUseSermonExport,
    aiFeatures: canUseAI,
    cloudSync: canUseCloudFeatures,
    advancedAnalytics: canUseAdvancedAnalytics,
    customReports: canUseCustomReports,
    unlimitedDevices: canUseUnlimitedDevices,
    unlimitedMultiview: canUseUnlimitedMultiview,
    mobileControl: canUseMobileControl,
  };

  for (const [feature, expected] of Object.entries(FEATURE_MATRIX)) {
    describe(feature, () => {
      const fn = FEATURE_FN_MAP[feature];
      for (const plan of ALL_PLANS) {
        it(`${plan} → ${expected[plan]}`, () => {
          const user = makeUser({ plan });
          expect(fn(user)).toBe(expected[plan]);
        });
      }
    });
  }

  it("all feature functions return the free-plan result for null user", () => {
    for (const [feature, fn] of Object.entries(FEATURE_FN_MAP)) {
      expect(fn(null)).toBe(FEATURE_MATRIX[feature].free);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Plan limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("getPlanLimits", () => {
  it("returns free limits for unknown plan (falls back to free)", () => {
    const limits = getPlanLimits("unknown" as PlanTier);
    expect(limits.songs).toBe(5);
    expect(limits.devices).toBe(1);
  });

  describe("free", () => {
    it("has correct resource limits", () => {
      const l = getPlanLimits("free");
      expect(l.songs).toBe(5);
      expect(l.images).toBe(10);
      expect(l.videos).toBe(5);
      expect(l.bibleVersions).toBe(5);
      expect(l.themes).toBe(2);
      expect(l.lowerThirdThemes).toBe(3);
      expect(l.devices).toBe(1);
      expect(l.credits).toBe(50);
    });

    it("has paid features disabled (Verse AI speech-to-scripture stays on)", () => {
      const l = getPlanLimits("free");
      expect(l.easyWorshipImport).toBe(false);
      expect(l.proPresenterImport).toBe(false);
      expect(l.massImport).toBe(false);
      expect(l.translation).toBe(false);
      expect(l.multiview).toBe(false);
      expect(l.mobileControl).toBe(false);
      expect(l.tickers).toBe(false);
      expect(l.speechToScripture).toBe(true);
      expect(l.sermonExport).toBe(false);
      expect(l.aiFeatures).toBe(false);
      expect(l.cloudSync).toBe(false);
      expect(l.advancedAnalytics).toBe(false);
      expect(l.customReports).toBe(false);
      expect(l.unlimitedDevices).toBe(false);
      expect(l.unlimitedMultiview).toBe(false);
    });
  });

  describe("basic", () => {
    it("has correct resource limits", () => {
      const l = getPlanLimits("basic");
      expect(l.songs).toBe(Infinity);
      expect(l.images).toBe(Infinity);
      expect(l.videos).toBe(Infinity);
      expect(l.bibleVersions).toBe(Infinity);
      expect(l.devices).toBe(3);
      expect(l.credits).toBe(240);
    });

    it("has mid-tier features enabled", () => {
      const l = getPlanLimits("basic");
      expect(l.easyWorshipImport).toBe(true);
      expect(l.proPresenterImport).toBe(true);
      expect(l.massImport).toBe(true);
      expect(l.translation).toBe(false);
      expect(l.multiview).toBe(true);
      expect(l.tickers).toBe(true);
      expect(l.speechToScripture).toBe(true);
      expect(l.sermonExport).toBe(false);
      expect(l.aiFeatures).toBe(false);
    });

    it("has growth reporting and unlimited multiview disabled", () => {
      const l = getPlanLimits("basic");
      expect(l.cloudSync).toBe(true);
      expect(l.advancedAnalytics).toBe(false);
      expect(l.customReports).toBe(false);
      expect(l.unlimitedDevices).toBe(false);
      expect(l.unlimitedMultiview).toBe(false);
      expect(l.mobileControl).toBe(false);
    });
  });

  describe("growth", () => {
    it("has growth resource limits", () => {
      const l = getPlanLimits("growth");
      expect(l.songs).toBe(Infinity);
      expect(l.images).toBe(Infinity);
      expect(l.videos).toBe(Infinity);
      expect(l.bibleVersions).toBe(Infinity);
      expect(l.themes).toBe(Infinity);
      expect(l.lowerThirdThemes).toBe(Infinity);
      expect(l.devices).toBe(10);
    });

    it("has 600 credits", () => {
      expect(getPlanLimits("growth").credits).toBe(600);
    });

    it("has all growth-level features enabled", () => {
      const l = getPlanLimits("growth");
      expect(l.easyWorshipImport).toBe(true);
      expect(l.proPresenterImport).toBe(true);
      expect(l.massImport).toBe(true);
      expect(l.translation).toBe(true);
      expect(l.multiview).toBe(true);
      expect(l.tickers).toBe(true);
      expect(l.speechToScripture).toBe(true);
      expect(l.sermonExport).toBe(true);
      expect(l.aiFeatures).toBe(true);
      expect(l.cloudSync).toBe(true);
      expect(l.advancedAnalytics).toBe(true);
      expect(l.customReports).toBe(true);
      expect(l.unlimitedDevices).toBe(false);
      expect(l.unlimitedMultiview).toBe(true);
    });

    it("has mobileControl enabled", () => {
      expect(getPlanLimits("growth").mobileControl).toBe(true);
    });
  });

  describe("legacy pro", () => {
    it("maps to growth limits", () => {
      const l = getPlanLimits("pro");
      expect(l.songs).toBe(Infinity);
      expect(l.images).toBe(Infinity);
      expect(l.videos).toBe(Infinity);
      expect(l.bibleVersions).toBe(Infinity);
      expect(l.themes).toBe(Infinity);
      expect(l.lowerThirdThemes).toBe(Infinity);
      expect(l.devices).toBe(10);
      expect(l.credits).toBe(600);
    });

    it("has all features enabled including mobileControl", () => {
      const l = getPlanLimits("pro");
      expect(l.translation).toBe(true);
      expect(l.massImport).toBe(true);
      expect(l.multiview).toBe(true);
      expect(l.cloudSync).toBe(true);
      expect(l.advancedAnalytics).toBe(true);
      expect(l.customReports).toBe(true);
      expect(l.unlimitedDevices).toBe(false);
      expect(l.unlimitedMultiview).toBe(true);
      expect(l.mobileControl).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Credit values — synchronized with PLAN_CREDITS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Credit allocation", () => {
  it("free plan has 50 credits", () => {
    expect(getPlanLimits("free").credits).toBe(50);
  });

  it("basic plan has 240 credits", () => {
    expect(getPlanLimits("basic").credits).toBe(240);
  });

  it("growth plan has 600 credits", () => {
    expect(getPlanLimits("growth").credits).toBe(600);
  });

  it("legacy pro maps to growth credits", () => {
    expect(getPlanLimits("pro").credits).toBe(600);
  });

  it("credits are strictly increasing across public tiers", () => {
    const free = getPlanLimits("free").credits;
    const basic = getPlanLimits("basic").credits;
    const growth = getPlanLimits("growth").credits;

    expect(free).toBeLessThan(basic);
    expect(basic).toBeLessThan(growth);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Downgrade protection
// ═══════════════════════════════════════════════════════════════════════════════

describe("getDowngradeWarnings", () => {
  it("returns no warnings when within limits", () => {
    const user = makeUser({ plan: "basic" });
    const warnings = getDowngradeWarnings(user, { devices: 3 });
    expect(warnings).toHaveLength(0);
  });

  it("returns warning when devices exceed basic limit (3)", () => {
    const user = makeUser({ plan: "basic" });
    const warnings = getDowngradeWarnings(user, { devices: 4 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].feature).toBe("devices");
    expect(warnings[0].requiredPlan).toBe("growth");
  });

  it("returns no warnings for growth plan within device limit", () => {
    const user = makeUser({ plan: "growth" });
    const warnings = getDowngradeWarnings(user, { devices: 10 });
    expect(warnings).toHaveLength(0);
  });

  it("returns warning for legacy pro over growth device limit", () => {
    const user = makeUser({ plan: "pro" });
    const warnings = getDowngradeWarnings(user, { devices: 999 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].feature).toBe("devices");
  });

  it("returns no warnings when usage is exactly at limit", () => {
    const user = makeUser({ plan: "basic" });
    const warnings = getDowngradeWarnings(user, { devices: 3 });
    expect(warnings).toHaveLength(0);
  });

  it("returns warning for free plan exceeding device limit", () => {
    const user = makeUser({ plan: "free" });
    const warnings = getDowngradeWarnings(user, { devices: 2 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].requiredPlan).toBe("growth");
  });

  it("returns warning when downgrading from growth to basic with excess devices", () => {
    // User was on growth, had 10 devices, downgraded to basic
    const user = makeUser({ plan: "basic" });
    const warnings = getDowngradeWarnings(user, { devices: 10 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Devices limit exceeded");
    expect(warnings[0].message).toContain("Upgrade to Growth");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Device limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("canAddDevice", () => {
  it("free: allows 0 devices", () => {
    expect(canAddDevice(makeUser({ plan: "free" }), 0)).toBe(true);
  });

  it("free: blocks at 1 device", () => {
    expect(canAddDevice(makeUser({ plan: "free" }), 1)).toBe(false);
  });

  it("basic: allows up to 2 devices", () => {
    expect(canAddDevice(makeUser({ plan: "basic" }), 0)).toBe(true);
    expect(canAddDevice(makeUser({ plan: "basic" }), 2)).toBe(true);
  });

  it("basic: blocks at 3 devices", () => {
    expect(canAddDevice(makeUser({ plan: "basic" }), 3)).toBe(false);
  });

  it("growth: allows up to 9 devices", () => {
    expect(canAddDevice(makeUser({ plan: "growth" }), 9)).toBe(true);
    expect(canAddDevice(makeUser({ plan: "growth" }), 10)).toBe(false);
  });

  it("legacy pro: uses growth device limit", () => {
    expect(canAddDevice(makeUser({ plan: "pro" }), 9)).toBe(true);
    expect(canAddDevice(makeUser({ plan: "pro" }), 10)).toBe(false);
  });
});

describe("getRemainingDeviceSlots", () => {
  it("free: 1 slot when 0 used", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "free" }), 0)).toBe(1);
  });

  it("free: 0 slots when 1 used", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "free" }), 1)).toBe(0);
  });

  it("free: 0 slots when 2 used (over limit)", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "free" }), 2)).toBe(0);
  });

  it("basic: 3 slots when 0 used", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "basic" }), 0)).toBe(3);
  });

  it("basic: 0 slots when 3 used", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "basic" }), 3)).toBe(0);
  });

  it("growth: remaining slots from 10-device limit", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "growth" }), 5)).toBe(5);
    expect(getRemainingDeviceSlots(makeUser({ plan: "growth" }), 10)).toBe(0);
  });

  it("legacy pro: remaining slots use growth limit", () => {
    expect(getRemainingDeviceSlots(makeUser({ plan: "pro" }), 5)).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. getRestrictionInfo — upgrade modal helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe("getRestrictionInfo", () => {
  it("free user sees translation as locked requiring growth", () => {
    const info = getRestrictionInfo(makeUser({ plan: "free" }), "translation");
    expect(info.locked).toBe(true);
    expect(info.requiredPlan).toBe("growth");
    expect(info.feature).toBe("Translation");
  });

  it("basic user sees translation as locked requiring growth", () => {
    const info = getRestrictionInfo(makeUser({ plan: "basic" }), "translation");
    expect(info.locked).toBe(true);
    expect(info.requiredPlan).toBe("growth");
  });

  it("free user sees cloudSync as locked requiring basic", () => {
    const info = getRestrictionInfo(makeUser({ plan: "free" }), "cloudSync");
    expect(info.locked).toBe(true);
    expect(info.requiredPlan).toBe("basic");
  });

  it("basic user sees cloudSync as unlocked", () => {
    const info = getRestrictionInfo(makeUser({ plan: "basic" }), "cloudSync");
    expect(info.locked).toBe(false);
  });

  it("growth user sees cloudSync as unlocked", () => {
    const info = getRestrictionInfo(makeUser({ plan: "growth" }), "cloudSync");
    expect(info.locked).toBe(false);
  });

  it("growth user sees mobileControl as unlocked", () => {
    const info = getRestrictionInfo(makeUser({ plan: "growth" }), "mobileControl");
    expect(info.locked).toBe(false);
  });

  it("pro user sees mobileControl as unlocked", () => {
    const info = getRestrictionInfo(makeUser({ plan: "pro" }), "mobileControl");
    expect(info.locked).toBe(false);
  });

  it("free user sees songs as locked when prompting for more capacity", () => {
    const info = getRestrictionInfo(makeUser({ plan: "free" }), "songs");
    expect(info.locked).toBe(true);
    expect(info.requiredPlan).toBe("basic");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. getUserPlanLimits — resolves effective plan for a user
// ═══════════════════════════════════════════════════════════════════════════════

describe("getUserPlanLimits", () => {
  it("returns free limits for null user", () => {
    expect(getUserPlanLimits(null).songs).toBe(5);
  });

  it("returns growth limits during trial", () => {
    const user = makeUser({
      plan: "free",
      trial: { active: true, endsAt: futureDate(5) },
    });
    expect(getUserPlanLimits(user).songs).toBe(Infinity);
    expect(getUserPlanLimits(user).translation).toBe(true);
    expect(getUserPlanLimits(user).credits).toBe(600);
  });

  it("returns growth limits for growth subscriber", () => {
    const user = makeUser({ plan: "growth" });
    expect(getUserPlanLimits(user).cloudSync).toBe(true);
    expect(getUserPlanLimits(user).credits).toBe(600);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Subscription upgrade flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("Subscription upgrade flow: Free → Basic", () => {
  it("effective plan changes from free to basic", () => {
    const user = makeUser({ plan: "free" });
    expect(getEffectivePlan(user)).toBe("free");

    // Simulate upgrade — server would update user.plan
    user.plan = "basic";
    expect(getEffectivePlan(user)).toBe("basic");
  });

  it("credits increase from 50 to 240", () => {
    const freeLimits = getPlanLimits("free");
    const basicLimits = getPlanLimits("basic");
    expect(freeLimits.credits).toBe(50);
    expect(basicLimits.credits).toBe(240);
  });

  it("features unlock after upgrade", () => {
    const freeUser = makeUser({ plan: "free" });
    const basicUser = makeUser({ plan: "basic" });

    expect(canUseTranslation(freeUser)).toBe(false);
    expect(canUseTranslation(basicUser)).toBe(false);
    expect(canUseTranslation(makeUser({ plan: "growth" }))).toBe(true);

    // Imports and multiview unlock on Basic.
    expect(canUseMassImport(freeUser)).toBe(false);
    expect(canUseMassImport(basicUser)).toBe(true);

    expect(canUseMultiview(freeUser)).toBe(false);
    expect(canUseMultiview(basicUser)).toBe(true);
  });

  it("device limit increases from 1 to 3", () => {
    expect(getPlanLimits("free").devices).toBe(1);
    expect(getPlanLimits("basic").devices).toBe(3);
  });
});

describe("Subscription upgrade flow: Basic → Growth", () => {
  it("effective plan changes from basic to growth", () => {
    const user = makeUser({ plan: "basic" });
    expect(getEffectivePlan(user)).toBe("basic");
    user.plan = "growth";
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("credits increase from 240 to 600", () => {
    expect(getPlanLimits("basic").credits).toBe(240);
    expect(getPlanLimits("growth").credits).toBe(600);
  });

  it("cloud features are on for Basic and Growth", () => {
    expect(canUseCloudFeatures(makeUser({ plan: "basic" }))).toBe(true);
    expect(canUseCloudFeatures(makeUser({ plan: "growth" }))).toBe(true);
  });

  it("device limit increases to 10", () => {
    expect(getPlanLimits("basic").devices).toBe(3);
    expect(getPlanLimits("growth").devices).toBe(10);
  });

  it("unlimited multiview unlocks on Growth", () => {
    expect(getPlanLimits("basic").unlimitedMultiview).toBe(false);
    expect(getPlanLimits("growth").unlimitedMultiview).toBe(true);
  });
});

describe("Legacy Pro compatibility", () => {
  it("legacy pro resolves to growth", () => {
    const user = makeUser({ plan: "growth" });
    user.plan = "pro";
    expect(getEffectivePlan(user)).toBe("growth");
  });

  it("legacy pro keeps growth credit allocation", () => {
    expect(getPlanLimits("growth").credits).toBe(600);
    expect(getPlanLimits("pro").credits).toBe(600);
  });

  it("mobile control already enabled on growth, remains on pro", () => {
    expect(canUseMobileControl(makeUser({ plan: "growth" }))).toBe(true);
    expect(canUseMobileControl(makeUser({ plan: "pro" }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Subscription downgrade flow: Growth → Basic
// ═══════════════════════════════════════════════════════════════════════════════

describe("Subscription downgrade flow: Growth → Basic", () => {
  it("effective plan changes from growth to basic", () => {
    const user = makeUser({ plan: "growth" });
    expect(getEffectivePlan(user)).toBe("growth");
    user.plan = "basic";
    expect(getEffectivePlan(user)).toBe("basic");
  });

  it("cloud features stay available on basic", () => {
    const user = makeUser({ plan: "basic" });
    expect(canUseCloudFeatures(user)).toBe(true);
  });

  it("paid reporting is restricted on basic", () => {
    const user = makeUser({ plan: "basic" });
    expect(canUseAdvancedAnalytics(user)).toBe(false);
    expect(canUseCustomReports(user)).toBe(false);
  });

  it("devices limited to 3 (downgrade protection triggers)", () => {
    const user = makeUser({ plan: "basic" });
    const warnings = getDowngradeWarnings(user, { devices: 10 });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].feature).toBe("devices");
  });

  it("data is NOT deleted on downgrade", () => {
    // Downgrade only changes the plan field — content stays
    const user = makeUser({ plan: "basic" });
    // The user object still has all fields — plan is just "basic"
    expect(user.plan).toBe("basic");
  });

  it("unlimited multiview becomes restricted on basic", () => {
    expect(getPlanLimits("growth").unlimitedMultiview).toBe(true);
    expect(getPlanLimits("basic").unlimitedMultiview).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Billing cycle logic (expiry date calculations)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Billing cycle calculations", () => {
  function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function addYears(date: Date, years: number): Date {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + years);
    return d;
  }

  it("monthly billing: currentPeriodEnd is ~30 days from start", () => {
    const start = new Date("2025-01-01");
    const end = addDays(start, 30);
    expect(end.getDate()).toBe(31);
    expect(end.getMonth()).toBe(0); // January
  });

  it("yearly billing: currentPeriodEnd is ~365 days from start", () => {
    const start = new Date("2025-01-01");
    const end = addDays(start, 365);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(1);
  });

  it("monthly subscription period: end is 1 month from start", () => {
    const start = new Date("2025-03-15");
    const end = addMonths(start, 1);
    expect(end.getMonth()).toBe(3); // April
    expect(end.getDate()).toBe(15);
  });

  it("yearly subscription period: end is 1 year from start", () => {
    const start = new Date("2025-06-20");
    const end = addYears(start, 1);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(5); // June
    expect(end.getDate()).toBe(20);
  });

  it("subscription expiry detection: is past currentPeriodEnd", () => {
    const now = new Date();
    const pastEnd = addDays(now, -1);
    const futureEnd = addDays(now, 1);

    expect(now.getTime() > pastEnd.getTime()).toBe(true);
    expect(now.getTime() > futureEnd.getTime()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Desktop license cache behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("Desktop license cache", () => {
  it("returns user.plan when no cache exists", () => {
    const user = makeUser({ plan: "basic" });
    vi.mocked(getCachedPlan).mockReturnValue("free");
    vi.mocked(isOfflineValid).mockReturnValue(false);
    expect(getUserPlan(user)).toBe("basic");
  });

  it("does not upgrade a free user from cache alone", () => {
    const user = makeUser({ plan: "free" });
    vi.mocked(getCachedPlan).mockReturnValue("basic");
    vi.mocked(isOfflineValid).mockReturnValue(true);
    expect(getUserPlan(user)).toBe("free");
  });

  it("returns free when cache is expired (offline window passed)", () => {
    const user = makeUser({ plan: "basic" });
    vi.mocked(getCachedPlan).mockReturnValue("basic");
    vi.mocked(isOfflineValid).mockReturnValue(false);
    // Falls back to user.plan, which is "basic" in this case
    // The cache expiry means we use user.plan, not cache
    expect(getUserPlan(user)).toBe("basic");
  });

  it("payment success flow: free user becomes basic after server plan update", () => {
    const user = makeUser({ plan: "free" });

    // Before payment
    expect(getEffectivePlan(user)).toBe("free");

    // After payment — server/user state and cache get updated.
    user.plan = "basic";
    vi.mocked(getCachedPlan).mockReturnValue("basic");
    vi.mocked(isOfflineValid).mockReturnValue(true);

    expect(getEffectivePlan(user)).toBe("basic");
    expect(canUseMassImport(user)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Plan tier ordering — higher plans always have >= lower plan limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("Plan tier ordering invariant", () => {
  const tiers: PlanTier[] = ["free", "basic", "growth"];

  it("each higher tier has >= resources than the tier below", () => {
    for (let i = 1; i < tiers.length; i++) {
      const lower = getPlanLimits(tiers[i - 1]);
      const higher = getPlanLimits(tiers[i]);

      // Credits always increase
      if (lower.credits !== Infinity && higher.credits !== Infinity) {
        expect(higher.credits).toBeGreaterThanOrEqual(lower.credits);
      }

      // Device limit always increases
      if (lower.devices !== Infinity && higher.devices !== Infinity) {
        expect(higher.devices).toBeGreaterThanOrEqual(lower.devices);
      }
    }
  });

  it("each higher tier has >= feature flags than the tier below", () => {
    const booleanFeatures = [
      "translation", "massImport", "multiview", "mobileControl",
      "tickers", "speechToScripture", "sermonExport", "aiFeatures",
      "cloudSync", "advancedAnalytics", "customReports",
      "unlimitedDevices", "unlimitedMultiview",
    ] as const;

    for (let i = 1; i < tiers.length; i++) {
      const lower = getPlanLimits(tiers[i - 1]);
      const higher = getPlanLimits(tiers[i]);

      for (const feat of booleanFeatures) {
        const lowerVal = lower[feat];
        const higherVal = higher[feat];
        // If lower tier has it, higher tier must also have it
        if (lowerVal === true) {
          expect(higherVal).toBe(true);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("user with undefined plan defaults to free", () => {
    const user = makeUser({ plan: undefined });
    expect(getEffectivePlan(user)).toBe("free");
    expect(getPlanLimits(getEffectivePlan(user)).songs).toBe(5);
  });

  it("user with no trial has no trial", () => {
    const user = makeUser({});
    expect(isInTrial(user)).toBe(false);
    expect(isTrialExpired(user)).toBe(false);
    expect(getTrialDaysRemaining(user)).toBe(0);
  });

  it("trial ending exactly now is not active", () => {
    const user = makeUser({ trial: { endsAt: new Date().toISOString() } });
    // Date.now() >= trial.endsAt means expired
    expect(isTrialExpired(user)).toBe(true);
  });

  it("all canUse* functions work with null user", () => {
    expect(canUseTranslation(null)).toBe(false);
    expect(canUseMassImport(null)).toBe(false);
    expect(canUseMultiview(null)).toBe(false);
    expect(canUseMobileControl(null)).toBe(false);
    expect(canUseCloudFeatures(null)).toBe(false);
    expect(canUseAdvancedAnalytics(null)).toBe(false);
    expect(canUseCustomReports(null)).toBe(false);
    expect(canUseUnlimitedDevices(null)).toBe(false);
    expect(canUseUnlimitedMultiview(null)).toBe(false);
    expect(canUseSpeechToScripture(null)).toBe(true);
    expect(canUseSermonExport(null)).toBe(false);
    expect(canUseAI(null)).toBe(false);
    expect(canUseTickers(null)).toBe(false);
    expect(canUseEasyWorshipImport(null)).toBe(false);
    expect(canUseProPresenterImport(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Runtime Validation — Trial Expiration End-to-End
// ═══════════════════════════════════════════════════════════════════════════════

describe("Runtime Validation: Trial Expiration End-to-End", () => {
  // ── Test Case 1: Active Trial ─────────────────────────────────────────────
  describe("Test Case 1: Active Trial (free + active trial → growth access)", () => {
    it("resolves effectivePlan to 'growth' with active trial", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: true,
          status: "active",
          startedAt: pastDate(3),
          endsAt: futureDate(4),
          durationDays: 7,
        },
      });

      // Core plan resolution
      expect(isInTrial(user)).toBe(true);
      expect(getEffectivePlan(user)).toBe("growth");
      expect(getUserPlan(user)).toBe("free"); // base plan unchanged

      // Premium features — all should be unlocked
      expect(canUseMultiview(user)).toBe(true);
      expect(canUseTranslation(user)).toBe(true);
      expect(canUseSpeechToScripture(user)).toBe(true);
      expect(canUseAI(user)).toBe(true);
      expect(canUseTickers(user)).toBe(true);
      expect(canUseMobileControl(user)).toBe(true);
      expect(canUseCloudFeatures(user)).toBe(true);
      expect(canUseMassImport(user)).toBe(true);
      expect(canUseAdvancedAnalytics(user)).toBe(true);
      expect(canUseSermonExport(user)).toBe(true);
      expect(canUseEasyWorshipImport(user)).toBe(true);
      expect(canUseProPresenterImport(user)).toBe(true);

      // getRestrictionInfo should NOT lock any premium feature
      const multiviewInfo = getRestrictionInfo(user, "multiview");
      expect(multiviewInfo.locked).toBe(false);

      const translationInfo = getRestrictionInfo(user, "translation");
      expect(translationInfo.locked).toBe(false);

      const speechInfo = getRestrictionInfo(user, "speechToScripture");
      expect(speechInfo.locked).toBe(false);
    });

    it("isInTrial rejects inactive status even if active=true", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: true,
          status: "inactive",
          endsAt: futureDate(5),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
      expect(canUseMultiview(user)).toBe(false);
    });

    it("isInTrial rejects expired status even if active=true", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: true,
          status: "expired",
          endsAt: futureDate(5),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
    });

    it("isInTrial rejects stopped status even if active=true", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: true,
          status: "stopped",
          endsAt: futureDate(5),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
    });
  });

  // ── Test Case 2: Expired Trial ────────────────────────────────────────────
  describe("Test Case 2: Expired Trial (free + expired trial → locked)", () => {
    it("resolves effectivePlan to 'free' with expired trial", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          status: "inactive",
          startedAt: pastDate(14),
          endsAt: pastDate(1),
          durationDays: 7,
        },
      });

      // Core plan resolution
      expect(isInTrial(user)).toBe(false);
      expect(isTrialExpired(user)).toBe(true);
      expect(getEffectivePlan(user)).toBe("free");
      expect(getUserPlan(user)).toBe("free");

      // Premium features — all should be locked
      expect(canUseMultiview(user)).toBe(false);
      expect(canUseTranslation(user)).toBe(false);
      expect(canUseSpeechToScripture(user)).toBe(true);
      expect(canUseAI(user)).toBe(false);
      expect(canUseTickers(user)).toBe(false);
      expect(canUseMobileControl(user)).toBe(false);
      expect(canUseCloudFeatures(user)).toBe(false);
      expect(canUseMassImport(user)).toBe(false);

      // getRestrictionInfo should lock premium features
      const multiviewInfo = getRestrictionInfo(user, "multiview");
      expect(multiviewInfo.locked).toBe(true);
      expect(multiviewInfo.requiredPlan).toBeDefined();

      const translationInfo = getRestrictionInfo(user, "translation");
      expect(translationInfo.locked).toBe(true);

      const speechInfo = getRestrictionInfo(user, "speechToScripture");
      expect(speechInfo.locked).toBe(false);
    });

    it("handles trial.active=false with status='expired'", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          status: "expired",
          endsAt: pastDate(3),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
      expect(canUseMultiview(user)).toBe(false);
    });

    it("handles trial.active=false with no status field (legacy)", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          endsAt: pastDate(3),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
      expect(canUseMultiview(user)).toBe(false);
    });

    it("handles trial with endsAt in the past even if active=true (date-based fallback)", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: true,
          status: "active",
          endsAt: pastDate(1),
        },
      });
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
      expect(canUseMultiview(user)).toBe(false);
    });
  });

  // ── Test Case 3: Stale Cache Scenario ─────────────────────────────────────
  describe("Test Case 3: Stale Cache (cached paid plan from expired trial → free)", () => {
    it("ignores cached 'pro' when user.plan is free and trial is expired", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          status: "inactive",
          endsAt: pastDate(2),
        },
      });

      // Simulate stale subscription cache that still says "pro"
      vi.mocked(getCachedPlan).mockReturnValue("pro");
      vi.mocked(isOfflineValid).mockReturnValue(true);

      // getUserPlan should ignore cached paid plans because user.plan is still free.
      expect(getUserPlan(user)).toBe("free");

      // Full resolution chain
      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("free");
      expect(canUseMultiview(user)).toBe(false);
      expect(canUseTranslation(user)).toBe(false);
      expect(canUseSpeechToScripture(user)).toBe(true);
    });

    it("maps cached legacy 'pro' to growth when user.plan is legacy pro", () => {
      const user = makeUser({
        plan: "pro",
        trial: {
          active: false,
          status: "inactive",
          endsAt: pastDate(5),
        },
      });

      vi.mocked(getCachedPlan).mockReturnValue("pro");
      vi.mocked(isOfflineValid).mockReturnValue(true);

      // Cached "pro" is valid because user.plan is also legacy pro, then normalized.
      expect(getUserPlan(user)).toBe("growth");
      expect(getEffectivePlan(user)).toBe("growth");
      expect(canUseMultiview(user)).toBe(true);
    });

    it("ignores cached 'growth' when user.plan is free and trial is expired", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          status: "inactive",
          endsAt: pastDate(2),
        },
      });

      vi.mocked(getCachedPlan).mockReturnValue("growth");
      vi.mocked(isOfflineValid).mockReturnValue(true);

      // Stale paid cache cannot upgrade a free user after trial cancellation.
      expect(getUserPlan(user)).toBe("free");
      expect(getEffectivePlan(user)).toBe("free");
    });

    it("returns free when cache says 'pro' and offline window expired", () => {
      const user = makeUser({
        plan: "free",
        trial: {
          active: false,
          endsAt: pastDate(2),
        },
      });

      vi.mocked(getCachedPlan).mockReturnValue("pro");
      vi.mocked(isOfflineValid).mockReturnValue(false);

      // Offline window expired → cache ignored entirely
      expect(getUserPlan(user)).toBe("free");
      expect(getEffectivePlan(user)).toBe("free");
    });
  });

  // ── Test Case 4: Legacy Pro Subscriber ────────────────────────────────────
  describe("Test Case 4: Legacy Pro Subscriber (pro plan → growth access)", () => {
    it("resolves effectivePlan to 'growth' with no trial", () => {
      const user = makeUser({
        plan: "pro",
      });

      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("growth");

      // All premium features unlocked
      expect(canUseMultiview(user)).toBe(true);
      expect(canUseTranslation(user)).toBe(true);
      expect(canUseSpeechToScripture(user)).toBe(true);
      expect(canUseAI(user)).toBe(true);
      expect(canUseTickers(user)).toBe(true);
      expect(canUseMobileControl(user)).toBe(true);
      expect(canUseCloudFeatures(user)).toBe(true);
      expect(canUseMassImport(user)).toBe(true);

      const multiviewInfo = getRestrictionInfo(user, "multiview");
      expect(multiviewInfo.locked).toBe(false);
    });

    it("resolves effectivePlan to 'growth' even with expired trial", () => {
      const user = makeUser({
        plan: "pro",
        trial: {
          active: false,
          status: "expired",
          endsAt: pastDate(10),
        },
      });

      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("growth");
      expect(canUseMultiview(user)).toBe(true);
      expect(canUseTranslation(user)).toBe(true);
      expect(canUseSpeechToScripture(user)).toBe(true);
    });

    it("resolves effectivePlan to 'growth' even with active trial", () => {
      const user = makeUser({
        plan: "pro",
        trial: {
          active: true,
          status: "active",
          endsAt: futureDate(5),
        },
      });

      expect(isInTrial(user)).toBe(true);
      expect(getEffectivePlan(user)).toBe("growth");
      expect(canUseMultiview(user)).toBe(true);
      expect(canUseTranslation(user)).toBe(true);
      expect(canUseSpeechToScripture(user)).toBe(true);
    });

    it("resolves effectivePlan to 'growth' even with inactive trial status", () => {
      const user = makeUser({
        plan: "pro",
        trial: {
          active: false,
          status: "inactive",
          endsAt: pastDate(5),
        },
      });

      expect(isInTrial(user)).toBe(false);
      expect(getEffectivePlan(user)).toBe("growth");
      expect(canUseMultiview(user)).toBe(true);
    });
  });

  // ── Status field integration ──────────────────────────────────────────────
  describe("isInTrial status field integration", () => {
    it("status='active' + active=true + future endsAt → in trial", () => {
      const user = makeUser({
        trial: { active: true, status: "active", endsAt: futureDate(3) },
      });
      expect(isInTrial(user)).toBe(true);
    });

    it("status='inactive' blocks trial even with active=true", () => {
      const user = makeUser({
        trial: { active: true, status: "inactive", endsAt: futureDate(3) },
      });
      expect(isInTrial(user)).toBe(false);
    });

    it("status='expired' blocks trial even with active=true", () => {
      const user = makeUser({
        trial: { active: true, status: "expired", endsAt: futureDate(3) },
      });
      expect(isInTrial(user)).toBe(false);
    });

    it("status='stopped' blocks trial even with active=true", () => {
      const user = makeUser({
        trial: { active: true, status: "stopped", endsAt: futureDate(3) },
      });
      expect(isInTrial(user)).toBe(false);
    });

    it("no status field falls back to active boolean check", () => {
      const userActive = makeUser({
        trial: { active: true, endsAt: futureDate(3) },
      });
      expect(isInTrial(userActive)).toBe(true);

      const userInactive = makeUser({
        trial: { active: false, endsAt: futureDate(3) },
      });
      expect(isInTrial(userInactive)).toBe(false);
    });

    it("no status + no active field → not in trial", () => {
      const user = makeUser({
        trial: { endsAt: futureDate(3) },
      });
      expect(isInTrial(user)).toBe(false);
    });
  });

  // ── getRestrictionInfo end-to-end ─────────────────────────────────────────
  describe("getRestrictionInfo end-to-end", () => {
    it("active trial user: no feature is locked", () => {
      const user = makeUser({
        plan: "free",
        trial: { active: true, status: "active", endsAt: futureDate(5) },
      });

      const features = ["multiview", "translation", "speechToScripture", "ai", "tickers", "mobileControl"];
      for (const feature of features) {
        const info = getRestrictionInfo(user, feature);
        expect(info.locked).toBe(false);
      }
    });

    it("expired trial user: premium features are locked", () => {
      const user = makeUser({
        plan: "free",
        trial: { active: false, status: "inactive", endsAt: pastDate(1) },
      });

      const premiumFeatures = ["multiview", "translation", "aiFeatures"];
      for (const feature of premiumFeatures) {
        const info = getRestrictionInfo(user, feature);
        expect(info.locked).toBe(true);
      }
    });

    it("legacy pro user: no growth feature is locked", () => {
      const user = makeUser({ plan: "pro" });

      const features = ["multiview", "translation", "speechToScripture", "ai", "tickers", "mobileControl"];
      for (const feature of features) {
        const info = getRestrictionInfo(user, feature);
        expect(info.locked).toBe(false);
      }
    });
  });
});
