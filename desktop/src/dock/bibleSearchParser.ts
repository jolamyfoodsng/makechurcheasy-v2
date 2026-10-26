/**
 * bibleSearchParser.ts — Smart Bible reference parser for the dock
 *
 * Parses fuzzy queries like:
 *   "gen1vs1"     → Genesis 1:1
 *   "g11"         → Genesis 1:1
 *   "gn11"        → Genesis 1:1
 *   "gs11"        → Genesis 1:1
 *   "genesis 1:1" → Genesis 1:1
 *   "jn3:16"      → John 3:16
 *   "1cor13"      → 1 Corinthians 13
 *   "ps23"        → Psalms 23
 *   "rev22:21"    → Revelation 22:21
 *
 * Returns a list of match candidates ranked by confidence.
 */

import {
  OT_BOOKS,
  NT_BOOKS,
  BOOK_CHAPTERS,
  getCanonicalVerseCount,
} from "./dockTypes";
import { normalizeRomanNumberedBookPrefix } from "../bible/bookAliasGenerator";
import { damerauLevenshteinDistance } from "../services/fuzzySearch";
import { findMatchingBibleMacros } from "./bibleMacros";

const ALL_BOOKS = [...OT_BOOKS, ...NT_BOOKS];

// Psalm 119 is the longest chapter in the Bible at 176 verses. Keeping this
// parser-level guard prevents compact input such as "j1633" from becoming the
// impossible reference "John 1:633" while preserving every canonical verse.
const MAX_BIBLE_VERSE_NUMBER = 176;

const ROMAN_NUMERAL_PREFIX: Record<"1" | "2" | "3", string> = {
  "1": "i",
  "2": "ii",
  "3": "iii",
};

// ---------------------------------------------------------------------------
// Abbreviation map — multiple short forms per book
// ---------------------------------------------------------------------------

export interface BookAlias {
  book: string;
  aliases: string[];
}

export const BOOK_ALIASES: BookAlias[] = [
  { book: "Genesis", aliases: ["gen", "ge", "gn", "gs"] },
  { book: "Exodus", aliases: ["exo", "ex", "exod"] },
  { book: "Leviticus", aliases: ["lev", "le", "lv"] },
  { book: "Numbers", aliases: ["num", "nu", "nm", "nb"] },
  { book: "Deuteronomy", aliases: ["deut", "de", "dt"] },
  { book: "Joshua", aliases: ["josh", "jos", "jsh"] },
  { book: "Judges", aliases: ["judg", "jdg", "jg", "jdgs"] },
  { book: "Ruth", aliases: ["ruth", "rth", "ru"] },
  { book: "1 Samuel", aliases: ["1sam", "1sa", "1sm", "1s"] },
  { book: "2 Samuel", aliases: ["2sam", "2sa", "2sm", "2s"] },
  { book: "1 Kings", aliases: ["1kgs", "1ki", "1k", "1kin"] },
  { book: "2 Kings", aliases: ["2kgs", "2ki", "2k", "2kin"] },
  { book: "1 Chronicles", aliases: ["1chr", "1ch", "1chron"] },
  { book: "2 Chronicles", aliases: ["2chr", "2ch", "2chron"] },
  { book: "Ezra", aliases: ["ezr", "ez"] },
  { book: "Nehemiah", aliases: ["neh", "ne"] },
  { book: "Esther", aliases: ["esth", "est", "es"] },
  { book: "Job", aliases: ["job", "jb"] },
  { book: "Psalms", aliases: ["psa", "ps", "pss", "psalm"] },
  { book: "Proverbs", aliases: ["prov", "pro", "pr", "prv"] },
  { book: "Ecclesiastes", aliases: ["eccl", "ecc", "ec", "eccles"] },
  { book: "Song of Solomon", aliases: ["song", "sos", "ss", "sol", "sg"] },
  { book: "Isaiah", aliases: ["isa", "is"] },
  { book: "Jeremiah", aliases: ["jer", "je", "jr"] },
  { book: "Lamentations", aliases: ["lam", "la"] },
  { book: "Ezekiel", aliases: ["ezek", "eze", "ezk"] },
  { book: "Daniel", aliases: ["dan", "da", "dn"] },
  { book: "Hosea", aliases: ["hos", "ho"] },
  { book: "Joel", aliases: ["joel", "jl"] },
  { book: "Amos", aliases: ["amos", "am"] },
  { book: "Obadiah", aliases: ["obad", "ob", "obadia", "obadya", "obedia", "obediah"] },
  { book: "Jonah", aliases: ["jonah", "jon", "jnh"] },
  { book: "Micah", aliases: ["mic", "mc"] },
  { book: "Nahum", aliases: ["nah", "na"] },
  { book: "Habakkuk", aliases: ["hab", "hb"] },
  { book: "Zephaniah", aliases: ["zeph", "zep", "zp"] },
  { book: "Haggai", aliases: ["hag", "hg"] },
  { book: "Zechariah", aliases: ["zech", "zec", "zc"] },
  { book: "Malachi", aliases: ["mal", "ml"] },
  { book: "Matthew", aliases: ["matt", "mat", "mt"] },
  { book: "Mark", aliases: ["mark", "mrk", "mk"] },
  { book: "Luke", aliases: ["luke", "luk", "lk"] },
  { book: "John", aliases: ["john", "joh", "jhn", "jn", "j"] },
  { book: "Acts", aliases: ["acts", "act", "ac"] },
  { book: "Romans", aliases: ["rom", "ro", "rm"] },
  { book: "1 Corinthians", aliases: ["1cor", "1co"] },
  { book: "2 Corinthians", aliases: ["2cor", "2co"] },
  { book: "Galatians", aliases: ["gal", "ga"] },
  { book: "Ephesians", aliases: ["eph", "ep"] },
  { book: "Philippians", aliases: ["phil", "php", "pp"] },
  { book: "Colossians", aliases: ["col", "co", "coloss", "collossians"] },
  { book: "1 Thessalonians", aliases: ["1thes", "1th", "1thess"] },
  { book: "2 Thessalonians", aliases: ["2thes", "2th", "2thess"] },
  { book: "1 Timothy", aliases: ["1tim", "1ti", "1tm"] },
  { book: "2 Timothy", aliases: ["2tim", "2ti", "2tm"] },
  { book: "Titus", aliases: ["titus", "tit", "ti"] },
  { book: "Philemon", aliases: ["phm", "philem", "pm"] },
  { book: "Hebrews", aliases: ["heb", "he"] },
  { book: "James", aliases: ["jas", "ja", "jm"] },
  { book: "1 Peter", aliases: ["1pet", "1pe", "1pt", "1p"] },
  { book: "2 Peter", aliases: ["2pet", "2pe", "2pt", "2p"] },
  { book: "1 John", aliases: ["1jn", "1jo", "1joh", "1jhn", "1john"] },
  { book: "2 John", aliases: ["2jn", "2jo", "2joh", "2jhn", "2john"] },
  { book: "3 John", aliases: ["3jn", "3jo", "3joh", "3jhn", "3john"] },
  { book: "Jude", aliases: ["jude", "jud", "jd"] },
  { book: "Revelation", aliases: ["rev", "re", "rv"] },
];

function getExtendedAliases(entry: BookAlias): string[] {
  const aliases = new Set(entry.aliases);
  const numberedMatch = entry.book.match(/^([123])\s+(.+)$/);

  if (numberedMatch) {
    const digit = numberedMatch[1] as "1" | "2" | "3";
    const romanPrefix = ROMAN_NUMERAL_PREFIX[digit];

    for (const alias of entry.aliases) {
      if (alias.startsWith(digit)) {
        aliases.add(`${romanPrefix}${alias.slice(1)}`);
      }
    }

    aliases.add(`${romanPrefix}${numberedMatch[2].toLowerCase().replace(/\s+/g, "")}`);
  }

  return [...aliases];
}

// Build a flat lookup: alias → book name
const ALIAS_MAP = new Map<string, string>();
for (const entry of BOOK_ALIASES) {
  // Add all aliases
  for (const alias of getExtendedAliases(entry)) {
    ALIAS_MAP.set(alias, entry.book);
  }
  // Also add the full lowercase name
  ALIAS_MAP.set(entry.book.toLowerCase().replace(/\s+/g, ""), entry.book);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface BibleSearchResult {
  /** Full book name */
  book: string;
  /** Chapter number (or null if only book matched) */
  chapter: number | null;
  /** Verse number (or null if only book+chapter matched) */
  verse: number | null;
  /** Optional verse range end, e.g. John 3:3-4 */
  endVerse?: number | null;
  /** Display label, e.g. "Genesis 1:1" */
  label: string;
  /** Confidence 0-100 */
  score: number;
  /** Translation override requested via ~msg, @amp, /esv */
  translationOverride?: string;
  /** Output mode override requested via !lt, !full, !f */
  modeOverride?: "lower-third" | "fullscreen";
  /** If this result is a compare trigger */
  compareTranslations?: { translationA: string; translationB: string };
  /** If this result is a special action (e.g. clear overlay) */
  action?: "clear";
  /** If this result comes from a macro/shortcode */
  isMacro?: boolean;
  macroKeyword?: string;
}

export interface BibleSearchContext {
  currentBook?: string | null;
  currentChapter?: number | null;
  currentVerse?: number | null;
}

export interface BibleSearchDirectives {
  cleanedQuery: string;
  translationOverride?: string;
  modeOverride?: "lower-third" | "fullscreen";
  action?: "clear";
  isCompare?: boolean;
  compareTranslationA?: string;
  compareTranslationB?: string;
  compareRightQuery?: string;
}

export function extractSearchDirectives(raw: string): BibleSearchDirectives {
  let query = raw.trim();
  let action: "clear" | undefined;
  let modeOverride: "lower-third" | "fullscreen" | undefined;
  let translationOverride: string | undefined;
  let isCompare = false;
  let compareTranslationA: string | undefined;
  let compareTranslationB: string | undefined;
  let compareRightQuery: string | undefined;

  // 1. Quick clear triggers: single dot "." or "!clear" or "!blank" or "#clear" or "#blank"
  if (query === "." || /^[!#](?:clear|blank)$/i.test(query)) {
    return {
      cleanedQuery: "",
      action: "clear",
    };
  }

  // 2. Output mode directives: !lt, !lower, !lower-third, !full, !fullscreen, !f, #lt, #full
  const modeMatch = query.match(/(?:^|\s)[!#](lt|lower-third|lower|full|fullscreen|f|clear|blank)(?:\s|$)/i);
  if (modeMatch) {
    const token = modeMatch[1].toLowerCase();
    if (token === "clear" || token === "blank") {
      action = "clear";
    } else if (token === "lt" || token === "lower" || token === "lower-third") {
      modeOverride = "lower-third";
    } else if (token === "full" || token === "fullscreen" || token === "f") {
      modeOverride = "fullscreen";
    }
    query = query.replace(/(?:^|\s)[!#](?:lt|lower-third|lower|full|fullscreen|f|clear|blank)(?:\s|$)/i, " ").trim();
  }

  // 3. Quick Compare Triggers: "//" or "||"
  const compareDelimiterMatch = query.match(/(\/\/|\|\|)/);
  if (compareDelimiterMatch && compareDelimiterMatch.index !== undefined) {
    isCompare = true;
    const leftSide = query.slice(0, compareDelimiterMatch.index).trim();
    const rightSide = query.slice(compareDelimiterMatch.index + compareDelimiterMatch[0].length).trim();
    query = leftSide;

    // Check if rightSide has two translations: e.g. "kjv + niv", "kjv & niv", "kjv / niv", "kjv || niv"
    const dualTransMatch = rightSide.match(/^([a-zA-Z]{2,6})\s*(?:\+|\&|\||\/|and)\s*([a-zA-Z]{2,6})$/i);
    if (dualTransMatch) {
      compareTranslationA = dualTransMatch[1].toUpperCase();
      compareTranslationB = dualTransMatch[2].toUpperCase();
    } else {
      const singleTransMatch = rightSide.match(/^([a-zA-Z]{2,6})$/i);
      if (singleTransMatch) {
        compareTranslationB = singleTransMatch[1].toUpperCase();
      } else {
        compareRightQuery = rightSide;
      }
    }
  } else {
    // 4. Translation hot-swapping: ~msg, @amp, /esv, ~nlt, etc.
    const transMatch = query.match(/(?:^|[\s\d:.-])([~@/])([a-zA-Z]{2,6})(?:\s|$)/i);
    if (transMatch) {
      translationOverride = transMatch[2].toUpperCase();
      query = query.replace(/(?:^|[\s\d:.-])[~@/][a-zA-Z]{2,6}(?:\s|$)/i, (matched) => {
        const first = matched[0];
        return /[\d:.-]/.test(first) ? first : " ";
      }).trim();
    }
  }

  return {
    cleanedQuery: query,
    translationOverride,
    modeOverride,
    action,
    isCompare,
    compareTranslationA,
    compareTranslationB,
    compareRightQuery,
  };
}

export interface BibleComparisonSearchResult {
  leftQuery: string;
  rightQuery: string;
  left: BibleSearchResult | null;
  right: BibleSearchResult | null;
  translationA?: string;
  translationB?: string;
}

export function parseBibleComparisonSearchOptions(query: string): BibleComparisonSearchResult[] {
  const raw = query.trim();
  if (!raw) return [];

  // Check "//" or "||" first
  const compareMatch = raw.match(/(\/\/|\|\|)/);
  if (compareMatch && compareMatch.index !== undefined) {
    const leftQuery = raw.slice(0, compareMatch.index).trim();
    const rightQuery = raw.slice(compareMatch.index + compareMatch[0].length).trim();
    if (leftQuery) {
      const dualTransMatch = rightQuery.match(/^([a-zA-Z]{2,6})\s*(?:\+|\&|\||\/|and)\s*([a-zA-Z]{2,6})$/i);
      const singleTransMatch = !dualTransMatch ? rightQuery.match(/^([a-zA-Z]{2,6})$/i) : null;
      const leftMatches = parseBibleSearch(leftQuery).filter((r) => r.chapter !== null);
      const left = leftMatches[0] ?? null;

      if (dualTransMatch && left) {
        return [{
          leftQuery,
          rightQuery,
          left,
          right: null,
          translationA: dualTransMatch[1].toUpperCase(),
          translationB: dualTransMatch[2].toUpperCase(),
        }];
      }

      if (singleTransMatch && left) {
        return [{
          leftQuery,
          rightQuery,
          left,
          right: null,
          translationB: singleTransMatch[1].toUpperCase(),
        }];
      }

      if (rightQuery) {
        const rightMatches = parseBibleSearch(rightQuery).filter((r) => r.chapter !== null);
        const right = rightMatches[0] ?? null;
        if (left || right) {
          return [{
            leftQuery,
            rightQuery,
            left,
            right,
          }];
        }
      }
    }
  }

  const delimiterIndexes: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "-" || char === "–" || char === "—" || char === "|") {
      delimiterIndexes.push(index);
    }
  }

  for (const delimiterIndex of delimiterIndexes) {
    const leftQuery = raw.slice(0, delimiterIndex).trim();
    const rightQuery = raw.slice(delimiterIndex + 1).trim();
    if (!leftQuery || !rightQuery) continue;
    if (!/[a-z]/i.test(leftQuery) || !/[a-z]/i.test(rightQuery)) continue;

    const leftMatches = parseBibleSearch(leftQuery).filter((result) => result.chapter !== null).slice(0, 3);
    const rightMatches = parseBibleSearch(rightQuery).filter((result) => result.chapter !== null).slice(0, 3);

    if (leftMatches.length === 0 && rightMatches.length === 0) {
      continue;
    }

    const options: BibleComparisonSearchResult[] = [];
    const seen = new Set<string>();
    const leftOptions = leftMatches.length > 0 ? leftMatches : [null];
    const rightOptions = rightMatches.length > 0 ? rightMatches : [null];

    for (const left of leftOptions) {
      for (const right of rightOptions) {
        const key = `${left?.label ?? ""}|${right?.label ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          leftQuery,
          rightQuery,
          left,
          right,
        });
      }
    }

    if (options.length > 0) {
      return options;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a fuzzy Bible reference query into search results.
 *
 * Handles formats like:
 *   "gen 1:1", "gen1vs1", "gen1.1", "gen11", "g11",
 *   "genesis 1 1", "1cor13:4", "ps23", "jn3:16",
 *   "j316" → John 3:16 AND John 31:6
 *   "jn316" → John 3:16 AND John 31:6
 */
export function parseBibleSearch(
  query: string,
  options?: { context?: BibleSearchContext },
): BibleSearchResult[] {
  const raw = query.trim();
  if (!raw) return [];

  // Extract directives: translation overrides (~msg, @amp, /esv), output mode (!lt, !full, !f), actions (!clear, .), comparisons (//, ||)
  const directives = extractSearchDirectives(raw);

  // 1. Quick clear triggers: single dot "." or "!clear" or "!blank"
  if (directives.action === "clear") {
    return [{
      book: "",
      chapter: null,
      verse: null,
      label: "Clear OBS Overlay (Blank)",
      score: 150,
      action: "clear",
    }];
  }

  // 2. Contextual verse navigation when active book and chapter are known
  if (options?.context?.currentBook && options?.context?.currentChapter) {
    const curBook = options.context.currentBook;
    const curChapter = options.context.currentChapter;
    const curVerse = options.context.currentVerse ?? 1;
    const maxV = getCanonicalVerseCount(curBook, curChapter) ?? 150;

    // Relative step: +1, -1, +2, -2, +, -
    const stepMatch = directives.cleanedQuery.match(/^([+-])(\d+)?$/);
    if (stepMatch) {
      const sign = stepMatch[1];
      const delta = stepMatch[2] ? parseInt(stepMatch[2], 10) : 1;
      const targetVerse = sign === "+" ? Math.min(curVerse + delta, maxV) : Math.max(curVerse - delta, 1);
      const label = `${curBook} ${curChapter}:${targetVerse} (${sign}${delta} Verse)`;
      return [{
        book: curBook,
        chapter: curChapter,
        verse: targetVerse,
        label: directives.translationOverride ? `${label} — ${directives.translationOverride}` : label,
        score: 130,
        translationOverride: directives.translationOverride,
        modeOverride: directives.modeOverride,
      }];
    }

    // Direct verse jump: .18, v18, 18, .18-20, v18-20, 18-20
    const jumpMatch = directives.cleanedQuery.match(/^\.?v?(\d+)(?:[-–—](\d+))?$/i);
    if (jumpMatch) {
      const targetV = parseInt(jumpMatch[1], 10);
      const endV = jumpMatch[2] ? parseInt(jumpMatch[2], 10) : null;
      if (targetV >= 1 && targetV <= maxV) {
        const rangeStr = endV && endV >= targetV && endV <= maxV ? `${targetV}-${endV}` : `${targetV}`;
        const baseLabel = `${curBook} ${curChapter}:${rangeStr}`;
        const label = directives.translationOverride ? `${baseLabel} — ${directives.translationOverride}` : baseLabel;
        return [{
          book: curBook,
          chapter: curChapter,
          verse: targetV,
          endVerse: endV && endV >= targetV && endV <= maxV ? endV : null,
          label,
          score: 135,
          translationOverride: directives.translationOverride,
          modeOverride: directives.modeOverride,
        }];
      }
    }
  }

  // 3. Quick Compare Trigger (// or ||)
  if (directives.isCompare && directives.cleanedQuery) {
    const leftResults = parseBibleSearch(directives.cleanedQuery, options);
    const leftMatch = leftResults.find((r) => r.chapter !== null) ?? leftResults[0];
    if (leftMatch && leftMatch.book && leftMatch.chapter !== null) {
      const transA = directives.compareTranslationA;
      const transB = directives.compareTranslationB;
      let label = leftMatch.label;
      if (transA && transB) {
        label = `${leftMatch.label} [Compare: ${transA} || ${transB}]`;
      } else if (transB) {
        label = `${leftMatch.label} [Compare with ${transB}]`;
      }
      return [{
        ...leftMatch,
        label,
        score: 125,
        compareTranslations: transB ? { translationA: transA || "", translationB: transB } : undefined,
        modeOverride: directives.modeOverride,
      }];
    }
  }

  // 4. Custom Shortcodes / Scripture Macros (e.g. "benediction", "welcome", "#job")
  const macroMatches = findMatchingBibleMacros(directives.cleanedQuery);
  const macroResults: BibleSearchResult[] = [];
  for (const match of macroMatches) {
    const parsedRef = parseBibleSearch(match.macro.reference)[0];
    if (parsedRef) {
      const trans = directives.translationOverride || match.macro.translation;
      const label = `⚡ ${match.macro.label || match.macro.keyword}: ${parsedRef.label}${trans ? ` — ${trans}` : ""}`;
      const score = match.isExplicitMacroPrefix ? 140 : match.hasCanonicalCollision ? 55 : 120;
      macroResults.push({
        ...parsedRef,
        label,
        score,
        isMacro: true,
        macroKeyword: match.macro.keyword,
        translationOverride: trans,
        modeOverride: directives.modeOverride,
      });
    }
  }

  // If explicit macro prefix was typed (e.g. "#job", "#welcome"), return macro results immediately
  if (directives.cleanedQuery.startsWith("#") || directives.cleanedQuery.startsWith("*")) {
    if (macroResults.length > 0) return macroResults;
  }

  // 5. Standard Scripture Reference Parsing on cleaned query
  // Normalize: lowercase, collapse whitespace
  const q = normalizeRomanNumberedBookPrefix(directives.cleanedQuery.toLowerCase().replace(/\s+/g, " "));
  if (!q) {
    return macroResults;
  }

  // ── Strategy 1: Split into book-part and numbers ──
  // Handle numbered books: "1 samuel" → "1samuel", "2 kings" → "2kings", "ii cor" → "iicor"
  const normalized = q.replace(/^((?:\d|iii|ii|i))\s+/, "$1");

  // Split into book text and number portion
  // Support no-shift dot notation between book and numbers: "j3.16", "jn.3.16", "2cor.5.17", "ps.23.1-4"
  const splitMatch = normalized.match(
    /^(\d?[a-z]+)[.\s:]*(\d.*)?$/
  );

  if (!splitMatch) {
    // Try plain text match against book names
    const bookMatches = matchBooksByName(q);
    const combined = [...macroResults, ...bookMatches];
    if (directives.translationOverride || directives.modeOverride) {
      return combined.map((res) => ({
        ...res,
        label: directives.translationOverride && !res.label.includes("—")
          ? `${res.label} — ${directives.translationOverride}`
          : res.label,
        translationOverride: directives.translationOverride,
        modeOverride: directives.modeOverride,
      }));
    }
    return combined;
  }

  const bookPart = splitMatch[1]; // e.g. "gen", "1cor", "g", "j", "jn"
  const numPart = splitMatch[2] ?? ""; // e.g. "1:1", "1vs1", "11", "316", "23.1-4"

  // Find matching books
  const matchedBooks = findBooks(bookPart);

  if (matchedBooks.length === 0) {
    return macroResults;
  }

  // Parse chapter:verse candidates from number part
  const hasSeparator = /[\s.:]/.test(directives.cleanedQuery) || /[\s.:/~@]/.test(raw);
  const candidates = parseChapterVerseCandidates(numPart, hasSeparator);

  // Build results
  const results: BibleSearchResult[] = [];

  for (const { book, score: bookScore } of matchedBooks) {
    const maxCh = BOOK_CHAPTERS[book] ?? 1;

    if (maxCh === 1 && numPart) {
      const singleChapterCandidates = parseSingleChapterVerseCandidates(numPart);
      if (singleChapterCandidates.length > 0) {
        const maxV = getCanonicalVerseCount(book, 1);
        for (const candidate of singleChapterCandidates) {
          const isVsValid = maxV === null || (candidate.verse !== null && candidate.verse <= maxV);
          results.push({
            book,
            chapter: 1,
            verse: candidate.verse,
            endVerse: candidate.endVerse,
            label:
              candidate.endVerse && candidate.endVerse !== candidate.verse
                ? `${book} 1:${candidate.verse}-${candidate.endVerse}`
                : `${book} 1:${candidate.verse}`,
            score: bookScore + candidate.confidence,
          });

          if (!isVsValid && candidate.verse !== null) {
            const repairedList = recoverInvalidReference(
              book,
              1,
              candidate.verse,
              candidate.endVerse,
              candidate.confidence - 5,
            );
            for (const rep of repairedList) {
              results.push({
                book,
                chapter: rep.chapter,
                verse: rep.verse,
                endVerse: rep.endVerse,
                label:
                  rep.verse !== null
                    ? `${book} ${rep.chapter}:${rep.verse}`
                    : `${book} ${rep.chapter}`,
                score: bookScore + rep.confidence,
              });
            }
          }
        }
        continue;
      }
    }

    if (candidates.length === 0) {
      // Book-only match
      results.push({
        book,
        chapter: null,
        verse: null,
        endVerse: null,
        label: book,
        score: bookScore,
      });
    } else {
      const canonicalMatches: BibleSearchResult[] = [];
      const invalidCandidates: ChapterVerseCandidate[] = [];

      for (const candidate of candidates) {
        const { chapter, verse, endVerse, confidence } = candidate;
        if (chapter !== null && chapter >= 1 && chapter <= maxCh) {
          const maxVerse = getCanonicalVerseCount(book, chapter);
          const isVerseValid =
            verse === null || (maxVerse !== null && verse >= 1 && verse <= maxVerse);
          const isEndVerseValid =
            endVerse === null ||
            endVerse === undefined ||
            (maxVerse !== null &&
              verse !== null &&
              endVerse >= verse &&
              endVerse <= maxVerse);

          if (isVerseValid && isEndVerseValid) {
            if (verse !== null) {
              canonicalMatches.push({
                book,
                chapter,
                verse,
                endVerse,
                label:
                  endVerse && endVerse !== verse
                    ? `${book} ${chapter}:${verse}-${endVerse}`
                    : `${book} ${chapter}:${verse}`,
                score: bookScore + confidence,
              });
            } else {
              canonicalMatches.push({
                book,
                chapter,
                verse: null,
                endVerse: null,
                label: `${book} ${chapter}`,
                score: bookScore + confidence,
              });
            }
          } else {
            invalidCandidates.push(candidate);
          }
        } else if (chapter !== null) {
          invalidCandidates.push(candidate);
        }
      }

      if (canonicalMatches.length > 0) {
        results.push(...canonicalMatches);
      } else if (invalidCandidates.length > 0) {
        for (const inv of invalidCandidates) {
          if (inv.chapter !== null) {
            const repairedList = recoverInvalidReference(
              book,
              inv.chapter,
              inv.verse,
              inv.endVerse,
              inv.confidence,
            );
            for (const rep of repairedList) {
              results.push({
                book,
                chapter: rep.chapter,
                verse: rep.verse,
                endVerse: rep.endVerse,
                label:
                  rep.verse !== null
                    ? `${book} ${rep.chapter}:${rep.verse}`
                    : `${book} ${rep.chapter}`,
                score: bookScore + rep.confidence,
              });
            }
          }
        }
      }

      // If no candidates matched the book's chapter range, still show the book
      const hasValidResult = results.some((r) => r.book === book && r.chapter !== null);
      if (!hasValidResult) {
        results.push({
          book,
          chapter: null,
          verse: null,
          endVerse: null,
          label: book,
          score: bookScore - 10,
        });
      }
    }
  }

  // Apply translation / mode directives to results
  const finalizedResults = (directives.translationOverride || directives.modeOverride)
    ? results.map((r) => ({
      ...r,
      label: directives.translationOverride && !r.label.includes("—")
        ? `${r.label} — ${directives.translationOverride}`
        : r.label,
      translationOverride: directives.translationOverride,
      modeOverride: directives.modeOverride,
    }))
    : results;

  const allCandidates = [...macroResults, ...finalizedResults];

  // Deduplicate by label
  const seen = new Set<string>();
  const deduped = allCandidates.filter((r) => {
    if (seen.has(r.label)) return false;
    seen.add(r.label);
    return true;
  });

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score);

  return deduped.slice(0, 10);
}

export function parseBibleComparisonSearch(query: string): BibleComparisonSearchResult | null {
  return parseBibleComparisonSearchOptions(query)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBooks(bookPart: string): Array<{ book: string; score: number }> {
  const results: Array<{ book: string; score: number }> = [];

  // 1. Exact alias match (highest priority)
  const exact = ALIAS_MAP.get(bookPart);
  if (exact) {
    results.push({ book: exact, score: 100 });
    return results; // Exact match — don't add fuzzy results
  }

  // 2. Prefix match on aliases
  for (const entry of BOOK_ALIASES) {
    for (const alias of getExtendedAliases(entry)) {
      if (alias.startsWith(bookPart)) {
        results.push({ book: entry.book, score: 80 });
        break; // One match per book is enough
      }
    }
  }

  // 3. Prefix match on full book names
  if (results.length === 0) {
    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      if (bookLower.startsWith(bookPart)) {
        results.push({ book, score: 70 });
      }
    }
  }

  // 4. Substring match (lowest priority)
  if (results.length === 0) {
    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      if (bookLower.includes(bookPart)) {
        results.push({ book, score: 50 });
      }
    }
  }

  // 5. Fuzzy match on book names and extended aliases (typo tolerance)
  if (results.length === 0 && bookPart.length >= 3) {
    const numPrefix = bookPart.match(/^([123])/)?.[1];
    const maxDist = bookPart.length <= 4 ? 1 : 2;

    const fuzzyCandidates: Array<{
      book: string;
      dist: number;
      isFullBookMatch: boolean;
      score: number;
    }> = [];

    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      const bookNumPrefix = book.match(/^([123])/)?.[1];
      if (numPrefix && bookNumPrefix !== numPrefix) continue;

      let bestDist = Number.POSITIVE_INFINITY;
      let isFullMatch = false;

      // Full book name check
      if (Math.abs(bookPart.length - bookLower.length) <= maxDist) {
        const bookDist = damerauLevenshteinDistance(bookPart, bookLower, maxDist);
        if (bookDist <= maxDist) {
          bestDist = bookDist;
          isFullMatch = true;
        }
      }

      // Alias check (only compare if alias length is close to query)
      const aliases = BOOK_ALIASES.find((a) => a.book === book);
      if (aliases) {
        for (const alias of getExtendedAliases(aliases)) {
          if (alias.length >= 3 && Math.abs(bookPart.length - alias.length) <= maxDist) {
            const aliasDist = damerauLevenshteinDistance(bookPart, alias, maxDist);
            if (aliasDist <= maxDist && aliasDist < bestDist) {
              bestDist = aliasDist;
              isFullMatch = false;
            }
          }
        }
      }

      if (Number.isFinite(bestDist) && bestDist <= maxDist) {
        let score = Math.max(35, 65 - bestDist * 15);
        if (isFullMatch) score += 6;
        if (Math.abs(bookPart.length - bookLower.length) === 0) score += 4;

        fuzzyCandidates.push({
          book,
          dist: bestDist,
          isFullBookMatch: isFullMatch,
          score,
        });
      }
    }

    fuzzyCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return 0;
    });

    for (const cand of fuzzyCandidates) {
      results.push({ book: cand.book, score: cand.score });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.book)) return false;
    seen.add(r.book);
    return true;
  });
}

interface ChapterVerseCandidate {
  chapter: number | null;
  verse: number | null;
  endVerse?: number | null;
  /** Higher = more likely the intended interpretation */
  confidence: number;
}

function recoverInvalidReference(
  book: string,
  chapter: number,
  verse: number | null,
  endVerse: number | null = null,
  baseConfidence: number = 20,
): ChapterVerseCandidate[] {
  const maxCh = BOOK_CHAPTERS[book] ?? 1;
  const recovered: ChapterVerseCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (c: number, v: number | null, eV: number | null, conf: number) => {
    if (!Number.isFinite(c) || c < 1 || c > maxCh) return;
    const maxV = getCanonicalVerseCount(book, c);
    if (v !== null) {
      if (!Number.isFinite(v) || v < 1 || (maxV !== null && v > maxV)) return;
      if (eV !== null && (!Number.isFinite(eV) || eV < v || (maxV !== null && eV > maxV))) return;
    }
    const key = `${c}:${v ?? ""}-${eV ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    recovered.push({
      chapter: c,
      verse: v,
      endVerse: eV,
      confidence: Math.max(8, conf),
    });
  };

  const chDigits = String(chapter);
  const vsDigits = verse !== null ? String(verse) : "";
  const combinedDigits = `${chDigits}${vsDigits}`;

  // 1. Repartition raw combined digits (e.g. 3:31 -> digits 331 -> 33:1)
  if (combinedDigits.length >= 2) {
    for (let i = 1; i < combinedDigits.length; i++) {
      const cPart = combinedDigits.slice(0, i);
      const vPart = combinedDigits.slice(i);
      if (vPart.length > 1 && vPart[0] === "0") continue;
      const c = parseInt(cPart, 10);
      const v = parseInt(vPart, 10);
      if (c === chapter && v === verse) continue;
      if (c >= 1 && c <= maxCh) {
        const maxV = getCanonicalVerseCount(book, c);
        if (maxV !== null && v >= 1 && v <= maxV) {
          pushCandidate(c, v, null, baseConfidence + 6);
        }
      }
    }
  }

  // 2. Transpose adjacent digits (e.g. 331 -> 313 -> 31:3)
  if (combinedDigits.length >= 3) {
    for (let i = 0; i < combinedDigits.length - 1; i++) {
      const arr = combinedDigits.split("");
      const tmp = arr[i];
      arr[i] = arr[i + 1];
      arr[i + 1] = tmp;
      const swapped = arr.join("");
      if (swapped === combinedDigits) continue;
      for (let j = 1; j < swapped.length; j++) {
        const cPart = swapped.slice(0, j);
        const vPart = swapped.slice(j);
        if (vPart.length > 1 && vPart[0] === "0") continue;
        const c = parseInt(cPart, 10);
        const v = parseInt(vPart, 10);
        if (c >= 1 && c <= maxCh) {
          const maxV = getCanonicalVerseCount(book, c);
          if (maxV !== null && v >= 1 && v <= maxV) {
            pushCandidate(c, v, null, baseConfidence + 2);
          }
        }
      }
    }
  }

  // 3. Swap chapter and verse if verse is a valid chapter (e.g. 3:31 -> 31:3)
  if (verse !== null && verse >= 1 && verse <= maxCh && chapter >= 1) {
    const maxV = getCanonicalVerseCount(book, verse);
    if (maxV !== null && chapter <= maxV) {
      pushCandidate(verse, chapter, null, baseConfidence + 3);
    }
  }

  // 4. If chapter is valid but verse exceeds max verse in that chapter:
  if (chapter >= 1 && chapter <= maxCh) {
    const maxV = getCanonicalVerseCount(book, chapter);
    if (maxV !== null) {
      if (endVerse !== null && verse !== null && endVerse > maxV) {
        pushCandidate(chapter, Math.min(verse, maxV), maxV, baseConfidence + 4);
      }
      // Suggest last verse of chapter
      pushCandidate(chapter, maxV, null, baseConfidence);
      // Suggest whole chapter
      pushCandidate(chapter, null, null, baseConfidence - 2);
      // Suggest first verse of chapter
      pushCandidate(chapter, 1, null, baseConfidence - 4);
    }
  }

  // 5. If chapter is invalid (chapter > maxCh):
  if (chapter > maxCh) {
    if (chDigits.endsWith("0")) {
      const stripped = parseInt(chDigits.slice(0, -1), 10);
      if (stripped >= 1 && stripped <= maxCh) {
        const maxV = getCanonicalVerseCount(book, stripped);
        const safeV = verse !== null && maxV !== null ? Math.min(verse, maxV) : verse;
        pushCandidate(stripped, safeV, null, baseConfidence);
      }
    }
    if (chDigits.length >= 2) {
      const mergedChapter = Number.parseInt(chDigits[0], 10);
      const mergedVerseDigits = `${chDigits.slice(1)}${verse ?? ""}`;
      const mergedVerse = Number.parseInt(mergedVerseDigits.replace(/^0+/, "") || "0", 10);
      if (mergedChapter >= 1 && mergedChapter <= maxCh) {
        const maxV = getCanonicalVerseCount(book, mergedChapter);
        if (maxV !== null && mergedVerse >= 1 && mergedVerse <= maxV) {
          pushCandidate(mergedChapter, mergedVerse, null, baseConfidence - 2);
        }
      }
    }
    const maxChMaxV = getCanonicalVerseCount(book, maxCh);
    pushCandidate(maxCh, verse !== null && maxChMaxV !== null ? Math.min(verse, maxChMaxV) : null, null, baseConfidence - 4);
    pushCandidate(maxCh, null, null, baseConfidence - 6);
  }

  // 6. If verse was specified, find closest chapter in the same book that has this verse
  if (verse !== null && verse >= 1) {
    let closestChapter: number | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (let c = 1; c <= maxCh; c++) {
      if (c === chapter) continue;
      const maxV = getCanonicalVerseCount(book, c);
      if (maxV !== null && maxV >= verse) {
        const dist = Math.abs(c - chapter);
        if (dist < closestDist) {
          closestDist = dist;
          closestChapter = c;
        }
      }
    }
    if (closestChapter !== null) {
      pushCandidate(closestChapter, verse, null, baseConfidence - 5);
    }
  }

  return recovered;
}

function parseSingleChapterVerseCandidates(numPart: string): ChapterVerseCandidate[] {
  if (!numPart) return [];

  // Check for explicit verse range with hyphen: e.g. "1-4" or "1:1-4"
  const dashMatch = numPart.match(/^(.+?)\s*[-–—]\s*(\d+)$/);
  if (dashMatch) {
    const leftRaw = dashMatch[1].trim();
    const endVs = parseInt(dashMatch[2], 10);
    if (Number.isFinite(endVs) && endVs >= 1 && endVs <= MAX_BIBLE_VERSE_NUMBER) {
      const leftParts = leftRaw
        .replace(/vs/gi, ":")
        .replace(/v/gi, ":")
        .replace(/\./g, ":")
        .replace(/\s+/g, ":")
        .split(":")
        .filter(Boolean);
      if (leftParts.length >= 2) {
        const vs = parseInt(leftParts[1], 10);
        if (Number.isFinite(vs) && vs >= 1 && endVs >= vs) {
          return [{ chapter: 1, verse: vs, endVerse: endVs, confidence: 32 }];
        }
      } else if (leftParts.length === 1) {
        const vs = parseInt(leftParts[0], 10);
        if (Number.isFinite(vs) && vs >= 1 && endVs >= vs) {
          return [{ chapter: 1, verse: vs, endVerse: endVs, confidence: 30 }];
        }
      }
    }
  }

  const cleaned = numPart
    .replace(/vs/gi, ":")
    .replace(/v/gi, ":")
    .replace(/\./g, ":")
    .replace(/[-–—]/g, ":")
    .replace(/\s+/g, ":");

  const parts = cleaned.split(":").filter(Boolean);
  if (parts.length === 0) return [];

  if (parts.length >= 2) {
    const chapter = parseInt(parts[0], 10);
    const verse = parseInt(parts[1], 10);
    if (
      chapter === 1 &&
      Number.isFinite(verse) &&
      verse >= 1 &&
      verse <= MAX_BIBLE_VERSE_NUMBER
    ) {
      return [{ chapter: 1, verse, endVerse: null, confidence: 32 }];
    }
  }

  if (parts.length === 1) {
    const verse = parseInt(parts[0], 10);
    if (
      Number.isFinite(verse) &&
      verse >= 1 &&
      verse <= MAX_BIBLE_VERSE_NUMBER
    ) {
      return [{ chapter: 1, verse, endVerse: null, confidence: parts[0].length === 1 ? 26 : 23 }];
    }
  }

  return [];
}

/**
 * Parse a number portion into one or more chapter:verse candidates.
 *
 * For explicit separators ("3:16", "3vs16", "3.16") → single result.
 * For explicit ranges ("3:1-6", "3 1-6", "31-2", "31-6") → range result with endVerse.
 * For jammed numbers ("316") → try all split points ("3:16", "31:6") without synthesizing ranges.
 *   "316" → 3:16 (conf 25), 31:6 (conf 20)
 *   "11"  → 1:1 (conf 15), chapter 11 (conf 10)
 */
function parseChapterVerseCandidates(numPart: string, hasWhitespace = false): ChapterVerseCandidate[] {
  if (!numPart) return [];

  // Check for explicit verse range or hyphenated input: e.g. "3:1-6", "3 1-6", "31-2", "31-6", "3-16"
  const dashMatch = numPart.match(/^(.+?)\s*[-–—]\s*(\d+)$/);
  if (dashMatch) {
    const leftRaw = dashMatch[1].trim();
    const endVs = parseInt(dashMatch[2], 10);

    if (Number.isFinite(endVs) && endVs >= 1 && endVs <= MAX_BIBLE_VERSE_NUMBER) {
      const leftCleaned = leftRaw
        .replace(/vs/gi, ":")
        .replace(/v/gi, ":")
        .replace(/\./g, ":")
        .replace(/\s+/g, ":");
      const leftParts = leftCleaned.split(":").filter(Boolean);

      if (leftParts.length >= 2) {
        const ch = parseInt(leftParts[0], 10);
        const vs = parseInt(leftParts[1], 10);
        if (!isNaN(ch) && !isNaN(vs) && ch >= 1 && vs >= 1 && endVs >= vs) {
          return [{
            chapter: ch,
            verse: vs,
            endVerse: endVs,
            confidence: 32,
          }];
        }
      } else if (leftParts.length === 1) {
        const leftDigits = leftParts[0];
        // If left part is jammed digits: e.g. "31" in "31-2" or "31-6"
        if (leftDigits.length >= 2) {
          const rangeCandidates: ChapterVerseCandidate[] = [];
          for (let i = 1; i < leftDigits.length; i++) {
            const chStr = leftDigits.substring(0, i);
            const vsStr = leftDigits.substring(i);
            if (vsStr.length > 1 && vsStr[0] === "0") continue;
            const ch = parseInt(chStr, 10);
            const vs = parseInt(vsStr, 10);
            if (ch >= 1 && vs >= 1 && vs <= MAX_BIBLE_VERSE_NUMBER && endVs >= vs) {
              rangeCandidates.push({
                chapter: ch,
                verse: vs,
                endVerse: endVs,
                confidence: 30 - (i - 1) * 7,
              });
            }
          }
          if (rangeCandidates.length > 0) {
            return rangeCandidates;
          }
        } else {
          // Single digit left part: e.g. "3-16" -> chapter 3, verse 16
          const ch = parseInt(leftDigits, 10);
          if (!isNaN(ch) && ch >= 1) {
            return [{
              chapter: ch,
              verse: endVs,
              endVerse: null,
              confidence: 25,
            }];
          }
        }
      }
    }
  }

  // Clean separators: "vs", "v", ".", ":"  all become ":"
  const cleaned = numPart
    .replace(/vs/gi, ":")
    .replace(/v/gi, ":")
    .replace(/\./g, ":")
    .replace(/[-–—]/g, ":")
    .replace(/\s+/g, ":");

  // Split by ":"
  const parts = cleaned.split(":").filter(Boolean);

  if (parts.length === 0) return [];

  // Two or more explicit parts → unambiguous chapter:verse
  if (parts.length >= 2) {
    const ch = parseInt(parts[0], 10);
    const vs = parseInt(parts[1], 10);
    const endVs = parts.length >= 3 ? parseInt(parts[2], 10) : null;
    if (isNaN(ch)) return [];
    if (!isNaN(vs) && (vs < 1 || vs > MAX_BIBLE_VERSE_NUMBER)) return [];
    if (
      endVs !== null &&
      (!Number.isFinite(endVs) || endVs < vs || endVs > MAX_BIBLE_VERSE_NUMBER)
    ) return [];
    return [{
      chapter: ch,
      verse: isNaN(vs) ? null : vs,
      endVerse: endVs !== null && !isNaN(endVs) && endVs >= vs ? endVs : null,
      confidence: 30,
    }];
  }

  // Single jammed number like "316", "11", "2316" etc.
  const digits = parts[0];
  const num = parseInt(digits, 10);
  if (isNaN(num)) return [];

  const candidates: ChapterVerseCandidate[] = [];

  // Try all possible split positions: digits[0..i] : digits[i..]
  // e.g. "316" → "3":"16", "31":"6"
  for (let i = 1; i < digits.length; i++) {
    const chStr = digits.substring(0, i);
    const vsStr = digits.substring(i);
    // Skip if verse part has a leading zero (e.g. "30:06" is odd)
    if (vsStr.length > 1 && vsStr[0] === "0") continue;

    const ch = parseInt(chStr, 10);
    const vs = parseInt(vsStr, 10);
    if (ch < 1 || vs < 1 || vs > MAX_BIBLE_VERSE_NUMBER) continue;

    // For 3+ digit numbers (like "316"), the ch:vs split is almost certainly
    // intended → give high confidence to early splits.
    // For 2-digit numbers (like "22"):
    //   - If jammed without whitespace ("gen22", "ge22"): media operators use this
    //     as chapter:verse shorthand, so prioritize the ":" split (conf 18 > chapterConf 14).
    //   - If separated by whitespace ("gen 22"): chapter-only is intended (chapterConf 20 > conf 12).
    let conf: number;
    if (digits.length >= 3) {
      // "316" → 3:16 (conf 25), 31:6 (conf 18)
      conf = 25 - (i - 1) * 7;
    } else {
      // "22" → 2:2
      conf = !hasWhitespace ? 18 - (i - 1) * 3 : 12 - (i - 1) * 3;
    }
    candidates.push({ chapter: ch, verse: vs, endVerse: null, confidence: Math.max(conf, 8) });
  }

  // Also add the whole number as chapter-only (if reasonable)
  if (num >= 1 && num <= 150) {
    // For 2-digit numbers, chapter-only gets higher confidence when whitespace is present ("gen 22" -> 20),
    // but lower than ch:vs split when jammed without whitespace ("gen22" -> 14).
    const chapterConf = digits.length <= 2 ? (hasWhitespace ? 20 : 14) : 5;
    candidates.push({ chapter: num, verse: null, endVerse: null, confidence: chapterConf });
  }

  return candidates;
}

function matchBooksByName(query: string): BibleSearchResult[] {
  const results: BibleSearchResult[] = [];
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return [];

  for (const book of ALL_BOOKS) {
    const bookLower = book.toLowerCase().replace(/\s+/g, "");
    if (bookLower.includes(q) || q.includes(bookLower)) {
      results.push({
        book,
        chapter: null,
        verse: null,
        endVerse: null,
        label: book,
        score: bookLower.startsWith(q) ? 90 : 60,
      });
    }
  }

  // If no direct matches, check fuzzy distance
  if (results.length === 0 && q.length >= 3) {
    const numPrefix = q.match(/^([123])/)?.[1];
    const maxDist = q.length <= 4 ? 1 : 2;

    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      const bookNumPrefix = book.match(/^([123])/)?.[1];
      if (numPrefix && bookNumPrefix !== numPrefix) continue;

      let bestDist = Number.POSITIVE_INFINITY;
      let isFullMatch = false;

      if (Math.abs(q.length - bookLower.length) <= maxDist) {
        const bookDist = damerauLevenshteinDistance(q, bookLower, maxDist);
        if (bookDist <= maxDist) {
          bestDist = bookDist;
          isFullMatch = true;
        }
      }

      const aliases = BOOK_ALIASES.find((a) => a.book === book);
      if (aliases) {
        for (const alias of getExtendedAliases(aliases)) {
          if (alias.length >= 3 && Math.abs(q.length - alias.length) <= maxDist) {
            const aliasDist = damerauLevenshteinDistance(q, alias, maxDist);
            if (aliasDist <= maxDist && aliasDist < bestDist) {
              bestDist = aliasDist;
              isFullMatch = false;
            }
          }
        }
      }

      if (Number.isFinite(bestDist) && bestDist <= maxDist) {
        let score = Math.max(30, 55 - bestDist * 15);
        if (isFullMatch) score += 5;
        results.push({
          book,
          chapter: null,
          verse: null,
          endVerse: null,
          label: book,
          score,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 8);
}

/**
 * Parses a saved search label (a recent search or favorite). Labels can end in a translation,
 * e.g. "John 3:16 — KJV" or "John 3:16 (KJV)", which parseBibleSearch reads as the book alone,
 * so that suffix is dropped first. A suffix must contain a letter, so a verse range such as
 * "Romans 8:28-30" is kept.
 */
export function parseSavedBibleSearch(label: string): BibleSearchResult | undefined {
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  const clean = trimmed
    .replace(/\s*[—–-]\s*(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{2,}\s*$/, "")
    .replace(/\s*\((?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{2,}\)\s*$/, "")
    .trim();
  return parseBibleSearch(clean)[0] || parseBibleSearch(trimmed)[0];
}
