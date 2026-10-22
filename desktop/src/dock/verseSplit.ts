/**
 * verseSplit.ts — cut one long Bible verse into a few parts that fit the screen.
 *
 * The operator picks it from the verse's right-click menu in the Bible Dock:
 *   - "2 parts" / "3 parts": the verse in that many parts of about the same size
 *   - "3 lines" / "4 lines": parts of at most that many lines on the display (a line is estimated
 *     at CHARS_PER_LINE characters, since the real width depends on the theme)
 * Cuts are made at a comma, semicolon, colon or full stop when one is near the ideal place, otherwise
 * between words. A part that is cut mid-sentence shows "…" at the end, and the next part starts with "…".
 */

export type VerseSplitMode =
  | { kind: "parts"; count: 2 | 3 | 4 }
  | { kind: "lines"; lines: 3 | 4 };

/** About how many characters fit on one line of the display. */
export const CHARS_PER_LINE = 42;

const BREAK_AFTER = /[,;:.?!—–]$/;
const SENTENCE_END = /[.?!]["”’)]*$/;

export function verseSplitModeId(mode: VerseSplitMode | null | undefined): string {
  if (!mode) return "off";
  return mode.kind === "parts" ? `parts-${mode.count}` : `lines-${mode.lines}`;
}

export function parseVerseSplitMode(id: string | null | undefined): VerseSplitMode | null {
  switch (id) {
    case "parts-2": return { kind: "parts", count: 2 };
    case "parts-3": return { kind: "parts", count: 3 };
    case "parts-4": return { kind: "parts", count: 4 };
    case "lines-3": return { kind: "lines", lines: 3 };
    case "lines-4": return { kind: "lines", lines: 4 };
    default: return null;
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Word boundaries of the text: the index just after each word (and its trailing punctuation). */
function wordEnds(words: string[]): number[] {
  const ends: number[] = [];
  let at = 0;
  for (const word of words) {
    at += word.length;
    ends.push(at);
    at += 1; // the space
  }
  return ends;
}

/** Splits into `count` parts of about the same length, cutting at punctuation when it is close. */
function splitIntoParts(text: string, count: number): string[] {
  const words = text.split(" ");
  if (count <= 1 || words.length < count) return [text];
  const ends = wordEnds(words);
  const total = text.length;
  const cuts: number[] = []; // index of the last word of each part except the final one
  let previous = -1;

  for (let part = 1; part < count; part += 1) {
    const ideal = (total * part) / count;
    const tolerance = (total / count) * 0.3;
    let best = -1;
    let bestScore = Infinity;
    // Leave at least one word for every part that still has to be made.
    const first = previous + 1;
    const last = words.length - 1 - (count - part);
    for (let i = first; i <= last; i += 1) {
      const distance = Math.abs(ends[i] - ideal);
      const atPunctuation = BREAK_AFTER.test(words[i]);
      // A punctuation mark within tolerance beats a closer plain word.
      const score = distance - (atPunctuation && distance <= tolerance ? tolerance : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    cuts.push(best);
    previous = best;
  }

  const parts: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    parts.push(words.slice(from, cut + 1).join(" "));
    from = cut + 1;
  }
  parts.push(words.slice(from).join(" "));
  return parts.filter(Boolean);
}

/** Adds the "…" that shows a verse carries on, and removes a dangling comma or semicolon. */
function withContinuationMarks(parts: string[]): string[] {
  return parts.map((part, index) => {
    let text = part;
    const continuesAfter = index < parts.length - 1;
    const continuedFromPrevious = index > 0 && !SENTENCE_END.test(parts[index - 1]);
    if (continuesAfter && !SENTENCE_END.test(text)) text = `${text.replace(/[,;:\s—–]+$/, "")}…`;
    if (continuedFromPrevious) text = `…${text}`;
    return text;
  });
}

/**
 * The parts of a verse for a split mode. A verse that already fits in one part comes back whole,
 * unchanged, so turning a split on for a short verse changes nothing.
 */
export function splitVerseText(text: string, mode: VerseSplitMode | null | undefined): string[] {
  const source = clean(text);
  if (!source) return [];
  if (!mode) return [source];
  const count = mode.kind === "parts"
    ? mode.count
    : Math.max(1, Math.ceil(source.length / (mode.lines * CHARS_PER_LINE)));
  if (count <= 1) return [source];
  const parts = splitIntoParts(source, count);
  return parts.length <= 1 ? [source] : withContinuationMarks(parts);
}
