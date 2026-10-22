import { describe, expect, it } from "vitest";
import { CHARS_PER_LINE, parseVerseSplitMode, splitVerseText, verseSplitModeId } from "./verseSplit";

// 1 Samuel 10:5 (KJV): the verse from the report, 7 lines in the Dock.
const LONG_VERSE =
  "After that thou shalt come to the hill of God, where is the garrison of the Philistines: and it shall come to pass, when thou art come thither to the city, that thou shalt meet a company of prophets coming down from the high place with a psaltery, and a tabret, and a pipe, and a harp, before them; and they shall prophesy:";
const SHORT_VERSE = "Jesus wept.";

const stripMarks = (part: string) => part.replace(/^…/, "").replace(/…$/, "");

describe("splitVerseText", () => {
  it("leaves the verse whole when no split is chosen", () => {
    expect(splitVerseText(LONG_VERSE, null)).toEqual([LONG_VERSE]);
  });

  it("splits into the number of parts asked for", () => {
    expect(splitVerseText(LONG_VERSE, { kind: "parts", count: 2 })).toHaveLength(2);
    expect(splitVerseText(LONG_VERSE, { kind: "parts", count: 3 })).toHaveLength(3);
    expect(splitVerseText(LONG_VERSE, { kind: "parts", count: 4 })).toHaveLength(4);
  });

  it("keeps every word, in order, and loses nothing", () => {
    for (const mode of [{ kind: "parts", count: 3 }, { kind: "lines", lines: 3 }, { kind: "lines", lines: 4 }] as const) {
      const parts = splitVerseText(LONG_VERSE, mode);
      const joined = parts.map(stripMarks).join(" ").replace(/\s+/g, " ").trim();
      // Only the trailing commas / semicolons that were swapped for "…" may differ.
      const normalise = (s: string) => s.replace(/[,;:]/g, "");
      expect(normalise(joined)).toBe(normalise(LONG_VERSE));
    }
  });

  it("cuts at punctuation when it is close to the ideal place", () => {
    const parts = splitVerseText(LONG_VERSE, { kind: "parts", count: 2 });
    // The natural break is after "…of the Philistines:" or "…to the city,".
    expect(parts[0]).toMatch(/(Philistines|city)…$/);
  });

  it("marks parts that carry on with an ellipsis", () => {
    const parts = splitVerseText(LONG_VERSE, { kind: "parts", count: 3 });
    expect(parts[0].startsWith("…")).toBe(false);
    expect(parts[0].endsWith("…")).toBe(true);
    expect(parts[1].startsWith("…")).toBe(true);
    expect(parts[1].endsWith("…")).toBe(true);
    expect(parts[2].startsWith("…")).toBe(true);
    expect(parts[2].endsWith("…")).toBe(false);
  });

  it("makes parts of at most the number of lines asked for", () => {
    for (const lines of [3, 4] as const) {
      const parts = splitVerseText(LONG_VERSE, { kind: "lines", lines });
      expect(parts.length).toBeGreaterThan(1);
      // Balanced parts stay within about one extra line of the limit.
      for (const part of parts) expect(part.length).toBeLessThanOrEqual((lines + 1) * CHARS_PER_LINE);
    }
    expect(splitVerseText(LONG_VERSE, { kind: "lines", lines: 3 }).length)
      .toBeGreaterThanOrEqual(splitVerseText(LONG_VERSE, { kind: "lines", lines: 4 }).length);
  });

  it("does not split a verse that already fits", () => {
    expect(splitVerseText(SHORT_VERSE, { kind: "lines", lines: 3 })).toEqual([SHORT_VERSE]);
    expect(splitVerseText(SHORT_VERSE, { kind: "parts", count: 3 })).toEqual([SHORT_VERSE]);
  });

  it("does not start a part with an ellipsis after a full stop", () => {
    const text = "In the beginning was the Word. And the Word was with God, and the Word was God. The same was in the beginning with God.";
    const parts = splitVerseText(text, { kind: "parts", count: 2 });
    expect(parts).toHaveLength(2);
    if (/[.?!]$/.test(parts[0])) expect(parts[1].startsWith("…")).toBe(false);
  });

  it("handles empty text", () => {
    expect(splitVerseText("   ", { kind: "parts", count: 2 })).toEqual([]);
  });
});

describe("split mode ids", () => {
  it("round-trips every mode", () => {
    for (const id of ["parts-2", "parts-3", "parts-4", "lines-3", "lines-4"]) {
      expect(verseSplitModeId(parseVerseSplitMode(id))).toBe(id);
    }
    expect(parseVerseSplitMode("off")).toBeNull();
    expect(parseVerseSplitMode("nonsense")).toBeNull();
    expect(verseSplitModeId(null)).toBe("off");
  });
});
