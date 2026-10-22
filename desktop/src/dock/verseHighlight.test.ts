import { describe, expect, it } from "vitest";
import { addHighlight, applyHighlights, cleanHighlightText, segmentHighlights } from "./verseHighlight";
import { parseEmphasis } from "../themes/layout/emphasis";

const VERSE = "The LORD is my shepherd; I shall not want. The LORD is my light.";

describe("applyHighlights", () => {
  it("wraps chosen words in the colour markup the screen understands", () => {
    const out = applyHighlights(VERSE, [{ t: "my shepherd", c: "yellow" }]);
    expect(out).toBe("The LORD is *[#facc15]my shepherd*; I shall not want. The LORD is my light.");
  });

  it("uses plain asterisks for the theme colour", () => {
    expect(applyHighlights(VERSE, [{ t: "shepherd", c: "theme" }])).toContain("my *shepherd*;");
  });

  it("marks every place the words appear", () => {
    const out = applyHighlights(VERSE, [{ t: "The LORD", c: "green" }]);
    expect(out.match(/\*\[#4ade80\]The LORD\*/g)).toHaveLength(2);
  });

  it("prefers the longer words when two highlights overlap", () => {
    const out = applyHighlights("the Lord God is great", [{ t: "Lord", c: "red" }, { t: "Lord God", c: "blue" }]);
    expect(out).toBe("the *[#38bdf8]Lord God* is great");
  });

  it("round-trips through the screen's parser", () => {
    const out = applyHighlights(VERSE, [{ t: "my light", c: "pink" }]);
    expect(parseEmphasis(out).find((p) => p.em)).toEqual({ text: "my light", em: true, color: "#f472b6" });
  });

  it("leaves the text alone with no highlights, and survives odd input", () => {
    expect(applyHighlights(VERSE, [])).toBe(VERSE);
    expect(applyHighlights("", [{ t: "x", c: "red" }])).toBe("");
    expect(applyHighlights("a (b) c", [{ t: "(b)", c: "red" }])).toBe("a *[#f87171](b)* c");
  });
});

describe("segmentHighlights", () => {
  it("cuts the text into plain and coloured pieces", () => {
    expect(segmentHighlights("one two three", [{ t: "two", c: "green" }])).toEqual([
      { text: "one " },
      { text: "two", color: "green" },
      { text: " three" },
    ]);
  });
});

describe("addHighlight / cleanHighlightText", () => {
  it("recolours words that were already highlighted", () => {
    const list = addHighlight(addHighlight([], "shepherd", "red"), "shepherd", "green");
    expect(list).toEqual([{ t: "shepherd", c: "green" }]);
  });

  it("cleans selected text: one line, no asterisks, a sensible length", () => {
    expect(cleanHighlightText("  the\n  *Lord*  ")).toBe("the Lord");
    expect(cleanHighlightText("x".repeat(500))).toHaveLength(120);
    expect(addHighlight([], "   ", "red")).toEqual([]);
  });
});
