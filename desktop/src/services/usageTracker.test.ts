import { describe, expect, it } from "vitest";
import { cleanUsageLabel, isContentRole, normalizeUsagePage } from "./usageTracker";

describe("normalizeUsagePage", () => {
  it("keeps normal pages as they are", () => {
    expect(normalizeUsagePage("/speech-to-scripture")).toBe("/speech-to-scripture");
    expect(normalizeUsagePage("/studio")).toBe("/studio");
    expect(normalizeUsagePage("/")).toBe("/");
  });

  it("counts every record of one kind as a single page", () => {
    expect(normalizeUsagePage("/transcripts/6720ab12cd34ef5678901234")).toBe("/transcripts/:id");
    expect(normalizeUsagePage("/transcripts/123e4567-e89b-12d3-a456-426614174000")).toBe("/transcripts/:id");
    expect(normalizeUsagePage("/songs/48213")).toBe("/songs/:id");
  });

  it("drops the query string, the hash and a trailing slash", () => {
    expect(normalizeUsagePage("/broadcast/?tab=youtube#top")).toBe("/broadcast");
  });
});

describe("cleanUsageLabel", () => {
  it("tidies the text of a button", () => {
    expect(cleanUsageLabel("  Open   Studio\nMode ")).toBe("Open Studio Mode");
    expect(cleanUsageLabel(null)).toBe("");
  });

  it("never sends an email address", () => {
    expect(cleanUsageLabel("admin@makechurcheazy.com")).toBe("(account)");
  });

  it("does not send long text, which is probably content", () => {
    expect(cleanUsageLabel("For God so loved the world that he gave his only begotten Son")).toBe("(long text)");
  });
});

describe("isContentRole", () => {
  it("treats list rows as content, buttons as controls", () => {
    expect(isContentRole("option")).toBe(true);
    expect(isContentRole("row")).toBe(true);
    expect(isContentRole("button")).toBe(false);
    expect(isContentRole(null)).toBe(false);
  });
});
