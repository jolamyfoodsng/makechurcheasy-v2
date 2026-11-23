import { describe, expect, it } from "vitest";
import { resolveLineCountAnchorVerse, selectLineCountVerses } from "./dockBibleVerseLines";

const chapter = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ verse: index + 1, text: `v${index + 1}` }));

const verseNumbers = (result: ReturnType<typeof selectLineCountVerses>) =>
  result?.selection.map((entry) => entry.verse) ?? null;

describe("resolveLineCountAnchorVerse", () => {
  it("starts at the right-clicked verse, not the selected one", () => {
    expect(resolveLineCountAnchorVerse(4, 9)).toBe(4);
  });

  it("falls back to the selected verse when no verse was right-clicked", () => {
    expect(resolveLineCountAnchorVerse(null, 9)).toBe(9);
    expect(resolveLineCountAnchorVerse(undefined, 9)).toBe(9);
  });

  it("returns null when there is nothing to anchor to", () => {
    expect(resolveLineCountAnchorVerse(null, null)).toBeNull();
  });
});

describe("selectLineCountVerses", () => {
  it("shows one verse per line, starting at the anchor", () => {
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 1))).toEqual([4]);
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 2))).toEqual([4, 5]);
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 3))).toEqual([4, 5, 6]);
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 4))).toEqual([4, 5, 6, 7]);
  });

  it("stops at the last verse of the chapter", () => {
    expect(verseNumbers(selectLineCountVerses(chapter(11), 10, 4))).toEqual([10, 11]);
    expect(verseNumbers(selectLineCountVerses(chapter(11), 11, 3))).toEqual([11]);
  });

  it("moves a start verse outside the chapter to the nearest verse", () => {
    const past = selectLineCountVerses(chapter(11), 40, 2);
    expect(past?.startVerse).toBe(11);
    expect(verseNumbers(past)).toEqual([11]);
    expect(selectLineCountVerses(chapter(11), 0, 2)?.startVerse).toBe(1);
  });

  it("uses an explicit range end over the line count", () => {
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 1, 7))).toEqual([4, 5, 6, 7]);
  });

  it("ignores an explicit end before the start", () => {
    expect(verseNumbers(selectLineCountVerses(chapter(11), 4, 2, 2))).toEqual([4, 5]);
  });

  it("returns null for an empty chapter", () => {
    expect(selectLineCountVerses([], 4, 2)).toBeNull();
  });
});
