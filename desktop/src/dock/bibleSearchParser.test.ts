import { describe, expect, it } from "vitest";
import { parseBibleSearch, parseSavedBibleSearch } from "./bibleSearchParser";

describe("Bible reference search parser", () => {
  it("drops impossible compact verse candidates", () => {
    const labels = parseBibleSearch("j1633").map((result) => result.label);

    expect(labels).toEqual(["John 16:33"]);
  });

  it("resolves ps331 to Psalms 33:1 and never impossible Psalms 3:31", () => {
    const results = parseBibleSearch("ps331");
    const labels = results.map((result) => result.label);

    expect(labels[0]).toBe("Psalms 33:1");
    expect(labels).not.toContain("Psalms 3:31");
  });

  it("resolves ps1191 to Psalms 119:1 instead of impossible Psalms 11:91", () => {
    const results = parseBibleSearch("ps1191");
    const labels = results.map((result) => result.label);

    expect(labels[0]).toBe("Psalms 119:1");
    expect(labels).not.toContain("Psalms 11:91");
  });

  it("drops impossible explicit verse candidates", () => {
    const labels = parseBibleSearch("John 1:633").map((result) => result.label);

    expect(labels).not.toContain("John 1:633");
  });

  it("creatively recovers similar valid references for non-existent ps 3:31", () => {
    const results = parseBibleSearch("ps 3:31");
    const labels = results.map((result) => result.label);

    expect(labels).not.toContain("Psalms 3:31");
    expect(labels).toContain("Psalms 33:1");
    expect(labels).toContain("Psalms 3:8");
  });

  it("creatively recovers similar valid references for ps3:31", () => {
    const results = parseBibleSearch("ps3:31");
    const labels = results.map((result) => result.label);

    expect(labels).not.toContain("Psalms 3:31");
    expect(labels[0]).toBe("Psalms 33:1");
  });

  it("keeps valid compact references and excludes unprompted ranges", () => {
    const j316Labels = parseBibleSearch("j316").map((result) => result.label);
    expect(j316Labels).toContain("John 3:16");
    expect(j316Labels).not.toContain("John 3:1-6");

    const jColon316Labels = parseBibleSearch("j:316").map((result) => result.label);
    expect(jColon316Labels).toContain("John 3:16");
    expect(jColon316Labels).not.toContain("John 3:1-6");

    const john316Labels = parseBibleSearch("john316").map((result) => result.label);
    expect(john316Labels).toContain("John 3:16");
    expect(john316Labels).not.toContain("John 3:1-6");
  });

  it("parses explicit verse ranges only when range delimiters are typed", () => {
    expect(parseBibleSearch("j31-2")[0]?.label).toBe("John 3:1-2");
    expect(parseBibleSearch("j:31-2")[0]?.label).toBe("John 3:1-2");
    expect(parseBibleSearch("j31-6")[0]?.label).toBe("John 3:1-6");
    expect(parseBibleSearch("john3:1-6")[0]?.label).toBe("John 3:1-6");
    expect(parseBibleSearch("john 3:1-6")[0]?.label).toBe("John 3:1-6");
  });

  it.each([
    ["john55", "John 5:5"],
    ["joh 55", "John 5:5"],
    ["2john 55", "2 John 1:55"],
    ["2jhn 55", "2 John 1:55"],
    ["gen22", "Genesis 2:2"],
    ["ge22", "Genesis 2:2"],
    ["gen 22", "Genesis 22"],
  ])("keeps numbered John references distinct for %s", (query, expected) => {
    expect(parseBibleSearch(query)[0]?.label).toBe(expected);
  });

  it.each([
    ["1 Kings", "1 Kings"],
    ["1kings", "1 Kings"],
    ["I Kings", "1 Kings"],
    ["ikings", "1 Kings"],
    ["II Kings", "2 Kings"],
    ["I-I Kings", "2 Kings"],
    ["iikings", "2 Kings"],
  ])("recognizes numbered book form %s", (query, expectedBook) => {
    expect(parseBibleSearch(query)[0]?.label).toBe(expectedBook);
  });

  it.each([
    ["kings", ["1 Kings", "2 Kings"]],
    ["chronicles", ["1 Chronicles", "2 Chronicles"]],
    ["corinthians", ["1 Corinthians", "2 Corinthians"]],
  ])("suggests both numbered books for %s", (query, expectedBooks) => {
    expect(parseBibleSearch(query).map((result) => result.label)).toEqual(expectedBooks);
  });

  describe("typo-tolerant book and reference parsing", () => {
    it.each([
      ["mathew 5:3", "Matthew 5:3"],
      ["genisis 1:1", "Genesis 1:1"],
      ["revelatn 21", "Revelation 21"],
      ["hebrws 11", "Hebrews 11"],
      ["jhon 3:16", "John 3:16"],
      ["psams 23", "Psalms 23"],
      ["1corintians 13", "1 Corinthians 13"],
      ["eclesiastes 3", "Ecclesiastes 3"],
      ["mathew", "Matthew"],
      ["revelatn", "Revelation"],
    ])("correctly parses reference with typo: %s -> %s", (query, expectedLabel) => {
      const results = parseBibleSearch(query);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toBe(expectedLabel);
    });
  });

  describe("translation hot-swapping directives (~, @, /)", () => {
    it.each([
      ["jn3:16 ~msg", "John 3:16 — MSG", "MSG"],
      ["jn3:16 @amp", "John 3:16 — AMP", "AMP"],
      ["jn 3 16 /esv", "John 3:16 — ESV", "ESV"],
      ["rom 8:28 ~nlt", "Romans 8:28 — NLT", "NLT"],
      ["j3.16@amp", "John 3:16 — AMP", "AMP"],
      ["ps23/kjv", "Psalms 23 — KJV", "KJV"],
    ])("correctly parses %s with translation %s", (query, expectedLabel, expectedTrans) => {
      const results = parseBibleSearch(query);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toBe(expectedLabel);
      expect(results[0]?.translationOverride).toBe(expectedTrans);
    });
  });

  describe("no-shift dot notation and verse ranges", () => {
    it.each([
      ["j3.16", "John 3:16", 3, 16, null],
      ["jn.3.16", "John 3:16", 3, 16, null],
      ["2cor.5.17", "2 Corinthians 5:17", 5, 17, null],
      ["ps.23.1-4", "Psalms 23:1-4", 23, 1, 4],
      ["ps.23.1.4", "Psalms 23:1-4", 23, 1, 4],
      ["ps.23", "Psalms 23", 23, null, null],
      ["1jn.1.9", "1 John 1:9", 1, 9, null],
    ])("correctly parses dot-notation %s -> %s", (query, expectedLabel, chapter, verse, endVerse) => {
      const results = parseBibleSearch(query);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toBe(expectedLabel);
      expect(results[0]?.chapter).toBe(chapter);
      expect(results[0]?.verse).toBe(verse);
      if (endVerse !== null) {
        expect(results[0]?.endVerse).toBe(endVerse);
      }
    });
  });

  describe("contextual verse jumping and relative navigation", () => {
    const context = { currentBook: "John", currentChapter: 3, currentVerse: 16 };

    it("jumps to verse using dot notation .18", () => {
      const results = parseBibleSearch(".18", { context });
      expect(results[0]?.label).toBe("John 3:18");
      expect(results[0]?.verse).toBe(18);
    });

    it("jumps to verse using v notation v18", () => {
      const results = parseBibleSearch("v18", { context });
      expect(results[0]?.label).toBe("John 3:18");
      expect(results[0]?.verse).toBe(18);
    });

    it("jumps to verse using bare number 18 in active chapter", () => {
      const results = parseBibleSearch("18", { context });
      expect(results[0]?.label).toBe("John 3:18");
      expect(results[0]?.verse).toBe(18);
    });

    it("steps forward with +1", () => {
      const results = parseBibleSearch("+1", { context });
      expect(results[0]?.label).toBe("John 3:17 (+1 Verse)");
      expect(results[0]?.verse).toBe(17);
    });

    it("steps backward with -1", () => {
      const results = parseBibleSearch("-1", { context });
      expect(results[0]?.label).toBe("John 3:15 (-1 Verse)");
      expect(results[0]?.verse).toBe(15);
    });
  });

  describe("quick compare triggers (// and ||)", () => {
    it("parses single translation comparison (jn 3:16 // msg)", () => {
      const results = parseBibleSearch("jn 3:16 // msg");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toContain("John 3:16 [Compare with MSG]");
      expect(results[0]?.compareTranslations?.translationB).toBe("MSG");
    });

    it("parses dual translation comparison (ps 23:1 // kjv + niv)", () => {
      const results = parseBibleSearch("ps 23:1 // kjv + niv");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toContain("Psalms 23:1 [Compare: KJV || NIV]");
      expect(results[0]?.compareTranslations?.translationA).toBe("KJV");
      expect(results[0]?.compareTranslations?.translationB).toBe("NIV");
    });

    it("parses dual translation comparison with || delimiter (ps 23:1 || kjv + niv)", () => {
      const results = parseBibleSearch("ps 23:1 || kjv + niv");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.label).toContain("Psalms 23:1 [Compare: KJV || NIV]");
    });
  });

  describe("inline output mode directives (! and #)", () => {
    it("forces lower-third overlay mode with !lt", () => {
      const results = parseBibleSearch("heb 11:1 !lt");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.modeOverride).toBe("lower-third");
      expect(results[0]?.book).toBe("Hebrews");
      expect(results[0]?.chapter).toBe(11);
      expect(results[0]?.verse).toBe(1);
    });

    it("forces fullscreen overlay mode with !full or !f", () => {
      const results = parseBibleSearch("heb 11:1 !full");
      expect(results[0]?.modeOverride).toBe("fullscreen");

      const fResults = parseBibleSearch("heb 11:1 !f");
      expect(fResults[0]?.modeOverride).toBe("fullscreen");
    });

    it("handles clear overlay directive !clear, !blank, or .", () => {
      const clearResults = parseBibleSearch("!clear");
      expect(clearResults[0]?.action).toBe("clear");

      const dotResults = parseBibleSearch(".");
      expect(dotResults[0]?.action).toBe("clear");
    });
  });

  describe("operator custom shortcodes and macros", () => {
    it("resolves benediction to Numbers 6:24-26", () => {
      const results = parseBibleSearch("benediction");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.isMacro).toBe(true);
      expect(results[0]?.book).toBe("Numbers");
      expect(results[0]?.chapter).toBe(6);
      expect(results[0]?.verse).toBe(24);
      expect(results[0]?.endVerse).toBe(26);
    });

    it("resolves grace to 2 Corinthians 13:14", () => {
      const results = parseBibleSearch("grace");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.isMacro).toBe(true);
      expect(results[0]?.book).toBe("2 Corinthians");
      expect(results[0]?.chapter).toBe(13);
      expect(results[0]?.verse).toBe(14);
    });

    it("preserves canonical book priority for collisions like 'job' but allows explicit #job", () => {
      // Plain "job" should prioritize book Job
      const plainResults = parseBibleSearch("job 1:1");
      expect(plainResults[0]?.book).toBe("Job");
      expect(plainResults[0]?.isMacro).toBeUndefined();

      // Explicit "#grace" triggers macro
      const macroResults = parseBibleSearch("#grace");
      expect(macroResults[0]?.isMacro).toBe(true);
      expect(macroResults[0]?.book).toBe("2 Corinthians");
    });
  });
});

describe("saved Bible search labels (recent searches and favorites)", () => {
  const ref = (label: string) => {
    const r = parseSavedBibleSearch(label);
    return r ? [r.book, r.chapter, r.verse, r.endVerse ?? null] : null;
  };

  it("opens the verse when the label ends in a translation", () => {
    expect(ref("John 3:16 — KJV")).toEqual(["John", 3, 16, null]);
    expect(ref("John 3:16 (KJV)")).toEqual(["John", 3, 16, null]);
    expect(ref("John 3:16 - NIV")).toEqual(["John", 3, 16, null]);
  });

  it("keeps verse ranges and plain references", () => {
    expect(ref("Romans 8:28-30")).toEqual(["Romans", 8, 28, 30]);
    expect(ref("Romans 8:28-30 — NIV")).toEqual(["Romans", 8, 28, 30]);
    expect(ref("John 3:16")).toEqual(["John", 3, 16, null]);
    expect(ref("Psalms 23")?.slice(0, 2)).toEqual(["Psalms", 23]);
  });

  it("returns nothing for an empty label", () => {
    expect(parseSavedBibleSearch("   ")).toBeUndefined();
  });
});
