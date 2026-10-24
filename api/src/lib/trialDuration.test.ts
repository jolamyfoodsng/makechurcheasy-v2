import { describe, expect, it } from "vitest";
import { DEFAULT_TRIAL_DAYS, legacyTrialDurationDays } from "./trialDuration";

describe("legacyTrialDurationDays", () => {
  it("keeps the stored duration", () => {
    expect(legacyTrialDurationDays({ durationDays: 30 })).toBe(30);
    expect(legacyTrialDurationDays({ durationDays: 14, startedAt: "2026-01-01", endsAt: "2026-03-01" })).toBe(14);
  });

  it("works the length out from the trial's own dates when none is stored", () => {
    expect(legacyTrialDurationDays({ startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-15T00:00:00Z" })).toBe(14);
  });

  it("does not count days an admin added", () => {
    expect(legacyTrialDurationDays({ startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-05T00:00:00Z", extendedDays: 5 })).toBe(30);
  });

  it("falls back to the default, never to 7, when nothing usable is stored", () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(30);
    expect(legacyTrialDurationDays({})).toBe(30);
    expect(legacyTrialDurationDays({ durationDays: 0 })).toBe(30);
    expect(legacyTrialDurationDays({ startedAt: "2026-01-01", endsAt: "2026-01-01" })).toBe(30);
    expect(legacyTrialDurationDays({ startedAt: "nonsense", endsAt: "also nonsense" })).toBe(30);
  });
});
