/**
 * songLimitFilter.test.ts — Verify songs are sliced to plan limit before reaching the dock
 */

import { describe, it, expect, vi } from "vitest";
import type { AuthUser } from "./authService";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./proLicense", () => ({
  isProUnlocked: vi.fn(() => false),
}));

vi.mock("./subscriptionCache", () => ({
  getCachedPlan: vi.fn(() => "basic"),
  isOfflineValid: vi.fn(() => false),
  getOfflineDaysRemaining: vi.fn(() => 0),
}));

import { getCachedPlan } from "./subscriptionCache";
import { getUserPlanLimits } from "./licenseService";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate 200 songs */
function makeSongs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `song-${i}`,
    title: `Song ${i}`,
  }));
}

/** The same slicing logic used in App.tsx and worshipDb.ts */
function sliceToLimit<T>(items: T[], user: AuthUser | null): T[] {
  const limit = getUserPlanLimits(user).songs;
  return limit > 0 && limit < 9999 ? items.slice(0, limit) : items;
}

const FREE_USER = { id: "u1", email: "test@test.com", plan: "free" } as AuthUser;
const BASIC_USER = { id: "u2", email: "test@test.com", plan: "basic" } as AuthUser;
const PRO_USER = { id: "u3", email: "test@test.com", plan: "pro" } as AuthUser;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Song limit filtering before dock delivery", () => {
  const twoHundredSongs = makeSongs(200);

  it("free plan: slices 200 songs down to 5", () => {
    vi.mocked(getCachedPlan).mockReturnValue("free");
    const result = sliceToLimit(twoHundredSongs, FREE_USER);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe("song-0");
    expect(result[2].id).toBe("song-2");
  });

  it("basic plan: keeps all 200 songs (unlimited in canonical entitlements)", () => {
    vi.mocked(getCachedPlan).mockReturnValue("basic");
    const result = sliceToLimit(twoHundredSongs, BASIC_USER);
    expect(result).toHaveLength(200);
    expect(result[49].id).toBe("song-49");
  });

  it("legacy pro plan maps to Growth and keeps all 200 songs", () => {
    vi.mocked(getCachedPlan).mockReturnValue("pro");
    const result = sliceToLimit(twoHundredSongs, PRO_USER);
    expect(result).toHaveLength(200);
  });

  it("null user falls back to free plan: 5 songs", () => {
    vi.mocked(getCachedPlan).mockReturnValue("free");
    const result = sliceToLimit(twoHundredSongs, null);
    expect(result).toHaveLength(5);
  });

  it("free plan with only 2 songs returns all 2 (no over-slicing)", () => {
    vi.mocked(getCachedPlan).mockReturnValue("free");
    const smallSet = makeSongs(2);
    const result = sliceToLimit(smallSet, FREE_USER);
    expect(result).toHaveLength(2);
  });

  it("basic plan limit is unlimited (Infinity)", () => {
    vi.mocked(getCachedPlan).mockReturnValue("basic");
    const limits = getUserPlanLimits(BASIC_USER);
    expect(limits.songs).toBe(Infinity);
  });

  it("free plan limit is exactly 5", () => {
    vi.mocked(getCachedPlan).mockReturnValue("free");
    const limits = getUserPlanLimits(FREE_USER);
    expect(limits.songs).toBe(5);
  });

  it("legacy pro plan limit is Infinity through the Growth mapping", () => {
    vi.mocked(getCachedPlan).mockReturnValue("pro");
    const limits = getUserPlanLimits(PRO_USER);
    expect(limits.songs).toBe(Infinity);
  });
});
