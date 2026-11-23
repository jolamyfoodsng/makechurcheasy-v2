/**
 * "Lines per stage" in the Dock Bible tab: how many verses go on screen at once.
 * One "line" is one verse, so 2 Lines from verse 4 shows verses 4–5.
 */

/**
 * The verse the output starts from after a line count change. Picking a line count
 * from a verse's right-click menu starts at that verse; the toolbar control keeps the
 * verse that is already selected.
 */
export function resolveLineCountAnchorVerse(
  contextMenuVerse: number | null | undefined,
  selectedVerse: number | null | undefined,
): number | null {
  if (typeof contextMenuVerse === "number" && contextMenuVerse > 0) return contextMenuVerse;
  if (typeof selectedVerse === "number" && selectedVerse > 0) return selectedVerse;
  return null;
}

/**
 * Picks the verses to show: `lineCount` verses starting at `startVerse`, or up to
 * `explicitVerseEnd` when a range was asked for. Never runs past the last verse of the
 * chapter. A start verse that isn't in the chapter is moved to the nearest one.
 * Returns null when the chapter has no verses.
 */
export function selectLineCountVerses<T extends { verse: number }>(
  verses: readonly T[],
  startVerse: number,
  lineCount: number,
  explicitVerseEnd?: number | null,
): { startVerse: number; selection: T[] } | null {
  if (verses.length === 0) return null;
  let targetVerse = startVerse;
  let startIndex = verses.findIndex((entry) => entry.verse === targetVerse);
  if (startIndex === -1) {
    const minV = verses[0]?.verse ?? 1;
    const maxV = verses[verses.length - 1]?.verse ?? minV;
    targetVerse = Math.min(Math.max(startVerse, minV), maxV);
    startIndex = verses.findIndex((entry) => entry.verse === targetVerse);
  }
  if (startIndex === -1) return null;

  const safeLineCount = Math.max(1, Math.floor(lineCount) || 1);
  const explicitEndIndex =
    explicitVerseEnd && explicitVerseEnd >= targetVerse
      ? verses.findIndex((entry) => entry.verse === explicitVerseEnd)
      : -1;
  const selection =
    explicitEndIndex >= startIndex
      ? verses.slice(startIndex, explicitEndIndex + 1)
      : verses.slice(startIndex, startIndex + safeLineCount);
  return { startVerse: targetVerse, selection };
}
