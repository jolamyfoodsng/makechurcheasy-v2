import { describe, expect, it } from "vitest";
import { scoreUserEngagement, USE_EVENT_NAMES, type EngagementCounts, type UserEngagement } from "./userEngagement";

const empty = (): EngagementCounts => ({
  bibleVerses: 0, bibleSearches: 0, songsPresented: 0, songsCreated: 0, mediaPresented: 0, mediaUploaded: 0,
  graphicsShown: 0, graphicsAdded: 0, liveCaptions: 0, notesShown: 0, voiceSessions: 0, transcripts: 0, translations: 0,
  obsConnections: 0, appOpens: 0, voiceSeconds: 0, multistreamSessions: 0, multistreamSeconds: 0,
  activeDays: 0, openDays: 0, lastUseAt: null,
});
const make = (day: Partial<EngagementCounts>, week: Partial<EngagementCounts>, month: Partial<EngagementCounts>): UserEngagement => ({
  day: { ...empty(), ...day }, week: { ...empty(), ...week }, month: { ...empty(), ...month },
});

describe("engagement score (what the Users page shows as D / W / M)", () => {
  it("scores nothing for someone who never did anything", () => {
    const s = scoreUserEngagement(make({}, {}, {}));
    expect([s.daily.score, s.weekly.score, s.monthly.score]).toEqual([0, 0, 0]);
    expect(s.grade).toBe("Dormant");
  });

  it("gives at most 5 for only opening the app, however often", () => {
    const opened = { appOpens: 30, openDays: 20, obsConnections: 5 };
    const s = scoreUserEngagement(make(opened, opened, opened));
    expect(s.monthly.score).toBeLessThanOrEqual(5);
    expect(s.grade).toBe("Dormant");
  });

  it("scores a church that presents on Sundays well over the month but 0 today", () => {
    const month = { activeDays: 8, bibleVerses: 120, songsPresented: 60, bibleSearches: 40, songsCreated: 5, obsConnections: 8 };
    const s = scoreUserEngagement(make({}, {}, month));
    expect(s.daily.score).toBe(0);
    expect(s.weekly.score).toBe(0);
    expect(s.monthly.score).toBeGreaterThanOrEqual(50);
  });

  it("scores the same use higher in a short window than a long one", () => {
    const use = { activeDays: 1, bibleVerses: 20, songsPresented: 10 };
    const s = scoreUserEngagement(make(use, use, use));
    expect(s.daily.score).toBeGreaterThan(s.weekly.score);
    expect(s.weekly.score).toBeGreaterThan(s.monthly.score);
  });

  it("does not count opening the app or OBS as real use", () => {
    expect(USE_EVENT_NAMES).not.toContain("app_started");
    expect(USE_EVENT_NAMES).not.toContain("obs_connected");
    expect(USE_EVENT_NAMES).toContain("bible_present");
  });

  it("stays between 0 and 100", () => {
    const huge = { activeDays: 30, bibleVerses: 9999, songsPresented: 9999, mediaPresented: 999, graphicsShown: 999, bibleSearches: 9999, voiceSessions: 50, multistreamSessions: 20 };
    const s = scoreUserEngagement(make(huge, huge, huge));
    for (const v of [s.daily.score, s.weekly.score, s.monthly.score]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(s.grade).toBe("Champion");
  });
});
