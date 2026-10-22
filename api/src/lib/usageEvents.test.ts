import { describe, expect, it, vi } from "vitest";

// parseUsageBatch is pure; the database and auth modules are only imported by the other functions.
vi.mock("./mongodb", () => ({ default: Promise.resolve({}) }));
vi.mock("./auth", () => ({ getAuthUserFromRequest: vi.fn() }));
vi.mock("./db", () => ({ COLLECTIONS: { USAGE_EVENTS: "usage_events" }, ensureIndexes: vi.fn() }));

import { MAX_USAGE_BATCH, parseUsageBatch } from "./usageEvents";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const view = { type: "view", page: "/studio", ts: NOW };

describe("parseUsageBatch", () => {
  it("accepts a normal batch", () => {
    const batch = parseUsageBatch({
      surface: "app",
      sessionId: "abc",
      appVersion: "4.3.0",
      os: "windows",
      events: [view, { type: "click", page: "/studio", ts: NOW, label: "Send", area: "Preview" }, { type: "dwell", page: "/studio", ts: NOW, durationMs: 12_000 }],
    }, NOW);
    expect(batch?.events).toHaveLength(3);
    expect(batch?.events[1]).toMatchObject({ label: "Send", area: "Preview" });
    expect(batch?.events[2].durationMs).toBe(12_000);
  });

  it("rejects an unknown surface or a missing events list", () => {
    expect(parseUsageBatch({ surface: "toaster", events: [view] }, NOW)).toBeNull();
    expect(parseUsageBatch({ surface: "app" }, NOW)).toBeNull();
    expect(parseUsageBatch(null, NOW)).toBeNull();
  });

  it("drops unknown event types and tiny dwell times", () => {
    const batch = parseUsageBatch({
      surface: "dock",
      events: [{ type: "keypress", page: "/x", ts: NOW }, { type: "dwell", page: "/x", ts: NOW, durationMs: 50 }, view],
    }, NOW);
    expect(batch?.events).toHaveLength(1);
  });

  it("cuts long text and caps time on a page at 30 minutes", () => {
    const batch = parseUsageBatch({
      surface: "app",
      events: [
        { type: "click", page: "/studio", ts: NOW, label: "x".repeat(500) },
        { type: "dwell", page: "/studio", ts: NOW, durationMs: 9_999_999 },
      ],
    }, NOW);
    expect(batch?.events[0].label).toHaveLength(60);
    expect(batch?.events[1].durationMs).toBe(30 * 60 * 1000);
  });

  it("replaces odd page names and forged timestamps", () => {
    const batch = parseUsageBatch({
      surface: "app",
      events: [
        { type: "view", page: "<script>alert(1)</script>", ts: NOW },
        { type: "view", page: "/studio", ts: NOW + 10 * 24 * 3600_000 },
        { type: "view", page: "/studio", ts: "yesterday" },
      ],
    }, NOW);
    expect(batch?.events[0].page).toBe("unknown");
    expect(batch?.events[1].ts.getTime()).toBe(NOW);
    expect(batch?.events[2].ts.getTime()).toBe(NOW);
  });

  it("takes at most one batch worth of events", () => {
    const events = Array.from({ length: MAX_USAGE_BATCH + 40 }, () => view);
    expect(parseUsageBatch({ surface: "app", events }, NOW)?.events).toHaveLength(MAX_USAGE_BATCH);
  });
});
