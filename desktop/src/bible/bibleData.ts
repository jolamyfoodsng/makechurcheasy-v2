/**
 * bibleData.ts — Bible data service
 *
 * Provides:
 * - Bible data loaded from IndexedDB (downloaded translations) with
 *   fallback to the bundled KJV JSON in public/ for offline use.
 * - Fast search (book/chapter/verse lookup + keyword search)
 * - Book metadata (chapter counts, verse counts)
 * - Reference resolution (abbreviation → canonical name)
 *
 * Translation flow:
 * 1. Check in-memory cache
 * 2. Check IndexedDB "translations" store
 * 3. Fall back to /bible-kjv.json (bundled) if translation is "KJV"
 */

import type {
  BibleBookName,
  BiblePassage,
  BibleTranslation,
  BibleVerse,
  RawBibleData,
} from "./types";
import { BIBLE_BOOKS, BOOK_ABBREVS } from "./types";
import { getTranslationData } from "./bibleDb";
import { getConceptVerses, matchVerseAlias } from "./scriptureReranker";
import { damerauLevenshteinDistance } from "../services/fuzzySearch";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const translationCache = new Map<string, RawBibleData>();
const corpusCache = new Map<string, BibleCorpusEntry[]>();
const corpusBuilds = new Map<string, Promise<BibleCorpusEntry[]>>();
const searchVocabularyCache = new Map<string, Map<string, number>>();
const normalizedSearchVocabularyCache = new Map<string, Map<string, number>>();
const rankedSearchCache = new Map<string, RankedSearchResult[]>();

interface CorpusSearchIndex {
  tokens: Map<string, number[]>;
  numbers: Map<number, number[]>;
  references: Map<string, number[]>;
}
// The index lives exactly as long as its cached corpus, including after a
// downloaded translation is replaced or removed.
const corpusSearchIndexes = new WeakMap<BibleCorpusEntry[], CorpusSearchIndex>();

function addEntryToSearchIndex(index: CorpusSearchIndex, entry: BibleCorpusEntry, id: number): void {
  const add = <T,>(map: Map<T, number[]>, key: T, entryId: number) => {
    const ids = map.get(key);
    if (ids) ids.push(entryId);
    else map.set(key, [entryId]);
  };
  for (const token of entry.searchTokenSet ?? []) add(index.tokens, token, id);
  const numbers = new Set([entry.chapter]);
  for (let verse = entry.verse; verse <= entry.endVerse; verse++) numbers.add(verse);
  for (const number of numbers) add(index.numbers, number, id);
  add(index.references, `${normalizeSearchScopeBook(entry.book)} ${entry.chapter}:${entry.verse}`, id);
}

// Building the corpus, its index and the word list is a lot of work (about 93,000 entries for a
// whole Bible). Done in one go it freezes the page for seconds on a slower PC, so the builders below
// work in short slices and let the page paint and answer clicks in between.
const SLICE_MS = 12;
// A message-channel hop hands control back without setTimeout's 4 ms minimum, so slicing adds almost no time.
const yieldToMain = (): Promise<void> => new Promise((resolve) => {
  if (typeof MessageChannel === "undefined") {
    setTimeout(resolve, 0);
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    resolve();
  };
  channel.port2.postMessage(null);
});

function createSlicer(): () => Promise<void> {
  let sliceStart = performance.now();
  return async () => {
    if (performance.now() - sliceStart < SLICE_MS) return;
    await yieldToMain();
    sliceStart = performance.now();
  };
}

const corpusIndexBuilds = new WeakMap<BibleCorpusEntry[], Promise<CorpusSearchIndex>>();

/** Same index as getCorpusSearchIndex, built in slices. Callers share one build. */
function getCorpusSearchIndexAsync(corpus: BibleCorpusEntry[]): Promise<CorpusSearchIndex> {
  const cached = corpusSearchIndexes.get(corpus);
  if (cached) return Promise.resolve(cached);
  const pending = corpusIndexBuilds.get(corpus);
  if (pending) return pending;
  const build = (async () => {
    const index: CorpusSearchIndex = { tokens: new Map(), numbers: new Map(), references: new Map() };
    const slice = createSlicer();
    for (let id = 0; id < corpus.length; id += 1) {
      addEntryToSearchIndex(index, corpus[id], id);
      if (id % 256 === 255) await slice();
    }
    corpusSearchIndexes.set(corpus, index);
    return index;
  })();
  corpusIndexBuilds.set(corpus, build);
  return build;
}

const vocabularyBuilds = new Map<string, Promise<void>>();

/** Fills the (normalized) word lists in slices, so the synchronous lookups later find them ready. */
function warmSearchVocabulary(translation: BibleTranslation, data: RawBibleData): Promise<void> {
  const key = translation.toUpperCase();
  if (searchVocabularyCache.has(key) && normalizedSearchVocabularyCache.has(key)) return Promise.resolve();
  const pending = vocabularyBuilds.get(key);
  if (pending) return pending;
  const build = (async () => {
    const slice = createSlicer();
    let vocabulary = searchVocabularyCache.get(key);
    if (!vocabulary) {
      vocabulary = new Map<string, number>();
      for (const book of BIBLE_BOOKS) {
        const bookData = data[book];
        if (!bookData) continue;
        for (const chapterData of Object.values(bookData)) {
          for (const text of Object.values(chapterData)) {
            for (const token of normalizeSearchText(text).split(" ").filter(Boolean)) {
              if (token.length < 2) continue;
              vocabulary.set(token, (vocabulary.get(token) ?? 0) + 1);
            }
          }
          await slice();
        }
      }
      // A translation replaced or removed while this ran must not get the old words back.
      if (translationCache.get(key) === data) searchVocabularyCache.set(key, vocabulary);
    }
    if (!normalizedSearchVocabularyCache.has(key)) {
      const normalized = new Map<string, number>();
      let count = 0;
      for (const [token, tokenCount] of vocabulary) {
        const keyToken = normalizeSearchToken(token);
        normalized.set(keyToken, (normalized.get(keyToken) ?? 0) + tokenCount);
        count += 1;
        if (count % 1024 === 0) await slice();
      }
      if (translationCache.get(key) === data) normalizedSearchVocabularyCache.set(key, normalized);
    }
  })().finally(() => { vocabularyBuilds.delete(key); });
  vocabularyBuilds.set(key, build);
  return build;
}

/** Warm once while listening starts, so the first phrase can use the index. */
export async function preloadBibleSearch(translation: BibleTranslation = "KJV"): Promise<void> {
  const data = await loadTranslation(translation);
  await getCorpusSearchIndexAsync(await getBibleCorpus(translation, 3));
  await warmSearchVocabulary(translation, data);
}

export interface BibleCorpusEntry {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
  translation: string;
  reference: string;
  text: string;
  normalizedText?: string;
  searchTokens?: string[];
  normalizedSearchTokens?: string[];
  searchTokenSet?: Set<string>;
  searchContentTokens?: string[];
}

// ---------------------------------------------------------------------------
// Load Bible data
// ---------------------------------------------------------------------------

/**
 * Load a translation into memory.
 * Priority: in-memory cache → IndexedDB → bundled JSON (KJV only).
 */
async function loadTranslation(t: BibleTranslation): Promise<RawBibleData> {
  const key = t.toUpperCase();
  const cached = translationCache.get(key);
  if (cached) return cached;

  // Try IndexedDB (downloaded translations)
  // Wrapped in try-catch because IndexedDB may be unavailable in some
  // environments (e.g. OBS CEF browser dock).
  try {
    const idbData = await getTranslationData(key);
    if (idbData) {
      translationCache.set(key, idbData);
      return idbData;
    }
  } catch {
    // IndexedDB unavailable — fall through to bundled fallback
  }

  if (key !== "KJV") {
    // 1. Try Tauri dock data directly if running inside Tauri
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<string>("load_dock_data", {
          name: `dock-bible-translation-${key.toLowerCase()}`,
        });
        if (raw) {
          const parsed = JSON.parse(raw) as RawBibleData;
          if (parsed && typeof parsed === "object") {
            translationCache.set(key, parsed);
            return parsed;
          }
        }
      }
    } catch {
      // Fall through to remote fetch
    }

    // 2. Try remote upload endpoints (OBS browser dock, CEF, web)
    const candidateUrls = [
      `/uploads/dock-bible-translation-${key.toLowerCase()}.json`,
      `${import.meta.env.BASE_URL}uploads/dock-bible-translation-${key.toLowerCase()}.json`,
    ];
    for (const remoteUrl of candidateUrls) {
      try {
        const remoteRes = await fetch(remoteUrl);
        if (remoteRes.ok) {
          const remoteData: RawBibleData = await remoteRes.json();
          translationCache.set(key, remoteData);
          return remoteData;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  // Fallback: bundled KJV JSON in public/
  if (key === "KJV") {
    try {
      const url = `${import.meta.env.BASE_URL}bible-kjv.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(500) }).catch(() => null);
      if (res?.ok) {
        const data: RawBibleData = await res.json();
        translationCache.set(key, data);
        return data;
      }
    } catch {
      // Ignore fetch failure and try the bundled module fallback below.
    }

    try {
      const bundled = await import("../../public/bible-kjv.json");
      const data = bundled.default as RawBibleData;
      translationCache.set(key, data);
      return data;
    } catch (err) {
      throw new Error(`Failed to load bundled KJV: ${(err as Error).message}`);
    }
  }

  throw new Error(
    `Translation "${t}" is not installed. Download it from the Bible Library.`
  );
}

/**
 * Evict a translation from the in-memory cache
 * (e.g. after deleting from IndexedDB).
 */
export function evictTranslationCache(t: string): void {
  const key = t.toUpperCase();
  translationCache.delete(key);
  searchVocabularyCache.delete(key);
  normalizedSearchVocabularyCache.delete(key);
  rankedSearchCache.clear();
  vocabularyBuilds.delete(key);
  for (const cacheKey of [...corpusCache.keys()]) {
    if (cacheKey.startsWith(`${key}:`)) {
      corpusCache.delete(cacheKey);
    }
  }
  for (const cacheKey of [...corpusBuilds.keys()]) {
    if (cacheKey.startsWith(`${key}:`)) {
      corpusBuilds.delete(cacheKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Book name resolution
// ---------------------------------------------------------------------------

/** Build a lookup map: lowercase abbreviation/name → canonical book name */
const bookLookup = new Map<string, string>();
for (const book of BIBLE_BOOKS) {
  bookLookup.set(book.toLowerCase(), book);
  const abbrevs = BOOK_ABBREVS[book];
  if (abbrevs) {
    for (const a of abbrevs) {
      bookLookup.set(a.toLowerCase(), book);
      // Also without spaces for things like "1cor"
      bookLookup.set(a.toLowerCase().replace(/\s/g, ""), book);
    }
  }
}

/**
 * Resolve a user-typed book name or abbreviation to the canonical name.
 * Returns null if no match found.
 */
export function resolveBookName(input: string): BibleBookName | null {
  const key = input.trim().toLowerCase();

  // Exact match
  if (bookLookup.has(key)) {
    return bookLookup.get(key) as BibleBookName;
  }

  // No-space match (e.g. "1samuel" → "1 Samuel")
  const noSpace = key.replace(/\s/g, "");
  if (bookLookup.has(noSpace)) {
    return bookLookup.get(noSpace) as BibleBookName;
  }

  // Prefix match — find first book that starts with the input
  for (const book of BIBLE_BOOKS) {
    if (book.toLowerCase().startsWith(key)) {
      return book;
    }
  }

  // Try abbreviation prefix match
  for (const [abbr, canonical] of bookLookup.entries()) {
    if (abbr.startsWith(key)) {
      return canonical as BibleBookName;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Data queries
// ---------------------------------------------------------------------------

/**
 * Get the list of chapters for a book.
 */
export async function getChapterCount(
  book: string,
  translation: BibleTranslation = "KJV"
): Promise<number> {
  const data = await loadTranslation(translation);
  const bookData = data[book];
  if (!bookData) return 0;
  return Object.keys(bookData).length;
}

/**
 * Get the verse count for a specific chapter.
 */
export async function getVerseCount(
  book: string,
  chapter: number,
  translation: BibleTranslation = "KJV"
): Promise<number> {
  const data = await loadTranslation(translation);
  const chapterData = data[book]?.[String(chapter)];
  if (!chapterData) return 0;
  return Object.keys(chapterData).length;
}

/**
 * Get a specific verse.
 */
export async function getVerse(
  book: string,
  chapter: number,
  verse: number,
  translation: BibleTranslation = "KJV"
): Promise<BibleVerse | null> {
  const data = await loadTranslation(translation);
  const text = data[book]?.[String(chapter)]?.[String(verse)];
  if (!text) return null;

  const abbrevList = BOOK_ABBREVS[book];
  const abbrev = abbrevList?.[0] ?? book.slice(0, 3);

  return { book, chapter, verse, text, abbrev };
}

/**
 * Get a passage (range of verses).
 */
export async function getPassage(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
  translation: BibleTranslation = "KJV"
): Promise<BiblePassage> {
  const data = await loadTranslation(translation);
  const chapterData = data[book]?.[String(chapter)];
  const verses: BibleVerse[] = [];
  const abbrevList = BOOK_ABBREVS[book];
  const abbrev = abbrevList?.[0] ?? book.slice(0, 3);

  if (chapterData) {
    for (let v = startVerse; v <= endVerse; v++) {
      const text = chapterData[String(v)];
      if (text) {
        verses.push({ book, chapter, verse: v, text, abbrev });
      }
    }
  }

  const reference =
    startVerse === endVerse
      ? `${book} ${chapter}:${startVerse}`
      : `${book} ${chapter}:${startVerse}-${endVerse}`;

  return {
    reference,
    book,
    chapter,
    startVerse,
    endVerse,
    verses,
    translation,
  };
}

/**
 * Get an entire chapter.
 */
export async function getChapter(
  book: string,
  chapter: number,
  translation: BibleTranslation = "KJV"
): Promise<BiblePassage> {
  const verseCount = await getVerseCount(book, chapter, translation);
  return getPassage(book, chapter, 1, verseCount, translation);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  text: string;
  /** Highlighted snippet around the match */
  snippet: string;
}

export interface RankedSearchResult extends SearchResult {
  score: number;
}

/**
 * Optional passage boundary for live sermon matching.
 * When present, quote search must stay inside this book/chapter.
 */
export interface BibleSearchScope {
  book?: string;
  chapter?: number;
}

interface BibleSearchSignals {
  aliasReference: string | null;
  conceptReferences: Set<string>;
}

function parseSearchReference(reference: string): {
  book: string;
  chapter: number;
  verse: number;
} | null {
  const match = reference.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!match) return null;

  return {
    book: normalizeSearchScopeBook(match[1]),
    chapter: Number(match[2]),
    verse: Number(match[3]),
  };
}

function buildBibleSearchSignals(query: string): BibleSearchSignals {
  const aliasQueryVariants = [
    query,
    query
      .replace(/\b(me|my|mine)\b/gi, "you")
      .replace(/\b(thee|thou|thy|thine|ye)\b/gi, "you"),
  ];

  return {
    aliasReference: aliasQueryVariants
      .map((variant) => matchVerseAlias(variant))
      .find((reference): reference is string => Boolean(reference)) ?? null,
    conceptReferences: new Set(getConceptVerses(query)),
  };
}

function normalizeSearchScopeBook(book: string): string {
  const normalized = book.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "psalm" ? "psalms" : normalized;
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);
const COMMON_SEARCH_TOKEN_ALIASES = new Map<string, string>([
  ["captity", "captivity"],
  ["captivty", "captivity"],
  ["captiviti", "captivity"],
  ["captivite", "captivity"],
  ["bonus", "bones"],
  ["word", "world"],
  ["load", "lord"],
  ["ion", "zion"],
  ["vally", "valley"],
  ["rejoyce", "rejoice"],
  ["must", "should"],
]);

// Treat common British and American spellings as the same search term. The
// corpus can come from different translations, so normalizing both the query
// and the verse tokens keeps searches portable across translations.
const SEARCH_SPELLING_VARIANTS = new Map<string, string>([
  ["favour", "favor"],
  ["favours", "favors"],
  ["favoured", "favored"],
  ["favouring", "favoring"],
  ["favourite", "favorite"],
  ["favourites", "favorites"],
  ["colour", "color"],
  ["colours", "colors"],
  ["coloured", "colored"],
  ["honour", "honor"],
  ["honours", "honors"],
  ["honoured", "honored"],
  ["honouring", "honoring"],
  ["labour", "labor"],
  ["labours", "labors"],
  ["laboured", "labored"],
  ["labouring", "laboring"],
  ["neighbour", "neighbor"],
  ["neighbours", "neighbors"],
  ["neighbourhood", "neighborhood"],
  ["neighbourhoods", "neighborhoods"],
  ["behaviour", "behavior"],
  ["behaviours", "behaviors"],
  ["saviour", "savior"],
  ["saviours", "saviors"],
  ["valour", "valor"],
  ["splendour", "splendor"],
  ["splendours", "splendors"],
  ["glamour", "glamor"],
  ["clamour", "clamor"],
  ["odour", "odor"],
  ["odours", "odors"],
  ["armour", "armor"],
  ["armours", "armors"],
  ["rumour", "rumor"],
  ["rumours", "rumors"],
  ["tumour", "tumor"],
  ["tumours", "tumors"],
  ["succour", "succor"],
  ["ardour", "ardor"],
  ["fervour", "fervor"],
  ["harbour", "harbor"],
  ["harbours", "harbors"],
  ["rigour", "rigor"],
  ["vigour", "vigor"],
  ["centre", "center"],
  ["centres", "centers"],
  ["centred", "centered"],
  ["theatre", "theater"],
  ["theatres", "theaters"],
  ["metre", "meter"],
  ["metres", "meters"],
  ["litre", "liter"],
  ["litres", "liters"],
  ["fibre", "fiber"],
  ["fibres", "fibers"],
  ["sepulchre", "sepulcher"],
  ["sepulchres", "sepulchers"],
  ["sombre", "somber"],
  ["organise", "organize"],
  ["organised", "organized"],
  ["organising", "organizing"],
  ["recognise", "recognize"],
  ["recognised", "recognized"],
  ["recognising", "recognizing"],
  ["realise", "realize"],
  ["realised", "realized"],
  ["realising", "realizing"],
  ["apologise", "apologize"],
  ["authorise", "authorize"],
  ["emphasise", "emphasize"],
  ["baptise", "baptize"],
  ["baptised", "baptized"],
  ["baptising", "baptizing"],
  ["evangelise", "evangelize"],
  ["programme", "program"],
  ["programmes", "programs"],
  ["judgement", "judgment"],
  ["judgements", "judgments"],
  ["fulfil", "fulfill"],
  ["fulfils", "fulfills"],
  ["fulfilment", "fulfillment"],
  ["defence", "defense"],
  ["defences", "defenses"],
  ["offence", "offense"],
  ["offences", "offenses"],
  ["pretence", "pretense"],
  ["practise", "practice"],
  ["counsellor", "counselor"],
  ["counsellors", "counselors"],
  ["travelling", "traveling"],
  ["travelled", "traveled"],
  ["traveller", "traveler"],
  ["travellers", "travelers"],
  ["labelled", "labeled"],
  ["cancelled", "canceled"],
  ["cancelling", "canceling"],
  ["worshipped", "worshiped"],
  ["worshipping", "worshiping"],
]);

const SEARCH_TOKEN_NORMALIZATIONS = new Map<string, string>([
  ["hath", "has"],
  ["hast", "has"],
  ["hadst", "had"],
  ["doth", "does"],
  ["doeth", "does"],
  ["didst", "did"],
  ["saith", "says"],
  ["sayest", "says"],
  ["spake", "spoke"],
  ["shew", "show"],
  ["shewed", "show"],
  ["sheweth", "show"],
  ["ye", "you"],
  ["thee", "you"],
  ["thou", "you"],
  ["thy", "your"],
  ["thine", "your"],
  ["unto", "to"],
  ["wherefore", "why"],
  ["whosoever", "whoever"],
  ["whatsoever", "whatever"],
  // Modern query wording should match common KJV inflections.
  ["loved", "love"],
  ["loves", "love"],
  ["loving", "love"],
  ["loveth", "love"],
  ["lovest", "love"],
  ["hated", "hate"],
  ["hates", "hate"],
  ["hating", "hate"],
  ["hateth", "hate"],
  ["hatest", "hate"],
  ["cometh", "come"],
  ["goeth", "go"],
  ["giveth", "give"],
  ["maketh", "make"],
  ["seeketh", "seek"],
  ["asketh", "ask"],
  ["speaketh", "speak"],
  ["worketh", "work"],
  ["leaveth", "leave"],
  // Common irregular forms used in natural-language searches.
  ["men", "man"],
  ["women", "woman"],
  ["children", "child"],
  ["brethren", "brother"],
  ["oxen", "ox"],
  // Modern synonyms mapped to canonical biblical / KJV terminology
  ["scared", "fear"],
  ["terrified", "fear"],
  ["frightened", "fear"],
  ["fearful", "fear"],
  ["afraid", "fear"],
  ["anxious", "careful"],
  ["anxiety", "careful"],
  ["worried", "careful"],
  ["worry", "careful"],
  ["wealthy", "rich"],
  ["prosperity", "blessing"],
  ["disease", "sickness"],
  ["illness", "sickness"],
  ["ailment", "infirmity"],
  ["battle", "war"],
  ["warfare", "war"],
  ["warrior", "man of war"],
  ["demons", "devil"],
  ["demon", "devil"],
  ["savior", "saviour"],
  ["helper", "comforter"],
  // Preserve words ending in -ed that are not past-tense verbs
  ["hundred", "hundred"],
  ["hundr", "hundred"],
  ["kindred", "kindred"],
  ["kindr", "kindred"],
  ["hatred", "hatred"],
  ["hatr", "hatred"],
  ["sacred", "sacred"],
  ["wicked", "wicked"],
  ["naked", "naked"],
]);

const SEARCH_NUMBER_UNDER_TWENTY = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const SEARCH_NUMBER_TENS = new Map<number, string>([
  [20, "twenty"],
  [30, "thirty"],
  [40, "forty"],
  [50, "fifty"],
  [60, "sixty"],
  [70, "seventy"],
  [80, "eighty"],
  [90, "ninety"],
  [100, "hundred"],
  [1000, "thousand"],
]);

const SEARCH_ORDINAL_MAP = new Map<string, string>([
  ["1st", "first"],
  ["2nd", "second"],
  ["3rd", "third"],
  ["4th", "fourth"],
  ["5th", "fifth"],
  ["6th", "sixth"],
  ["7th", "seventh"],
  ["8th", "eighth"],
  ["9th", "ninth"],
  ["10th", "tenth"],
]);

function numberSearchWord(token: string): string | null {
  const ordinal = SEARCH_ORDINAL_MAP.get(token);
  if (ordinal) return ordinal;

  if (!/^\d+$/.test(token)) return null;

  const value = Number(token);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  if (value < SEARCH_NUMBER_UNDER_TWENTY.length) {
    return SEARCH_NUMBER_UNDER_TWENTY[value];
  }
  return SEARCH_NUMBER_TENS.get(value) ?? null;
}

function canonicalizeSearchSpelling(token: string): string {
  return SEARCH_SPELLING_VARIANTS.get(token) ?? token;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const filtered = tokens.filter(
    (token) =>
      (token.length > 1 || /^\d+$/.test(token)) &&
      !SEARCH_STOP_WORDS.has(token),
  );

  return filtered.length > 0
    ? filtered
    : tokens.filter((token) => token.length > 1 || /^\d+$/.test(token));
}

// The same few thousand words are normalized again and again (a whole Bible is about 800,000 words),
// and the result only depends on the word, so each word is worked out once.
const normalizedSearchTokenCache = new Map<string, string>();

function normalizeSearchToken(token: string): string {
  const cached = normalizedSearchTokenCache.get(token);
  if (cached !== undefined) return cached;
  const result = computeNormalizedSearchToken(token);
  normalizedSearchTokenCache.set(token, result);
  return result;
}

function computeNormalizedSearchToken(token: string): string {
  const numericWord = numberSearchWord(token);
  if (numericWord) return normalizeSearchToken(numericWord);

  const spellingNormalized = canonicalizeSearchSpelling(token);
  const direct = SEARCH_TOKEN_NORMALIZATIONS.get(spellingNormalized);
  if (direct) return canonicalizeSearchSpelling(direct);

  if (spellingNormalized.length <= 4) return spellingNormalized;

  if (spellingNormalized.endsWith("eth") && spellingNormalized.length > 5) {
    const normalized = spellingNormalized.slice(0, -3);
    return canonicalizeSearchSpelling(
      SEARCH_TOKEN_NORMALIZATIONS.get(normalized) ?? restoreSilentE(normalized),
    );
  }
  if (spellingNormalized.endsWith("est") && spellingNormalized.length > 5) {
    const normalized = spellingNormalized.slice(0, -3);
    return canonicalizeSearchSpelling(
      SEARCH_TOKEN_NORMALIZATIONS.get(normalized) ?? restoreSilentE(normalized),
    );
  }
  if (spellingNormalized.endsWith("ing") && spellingNormalized.length > 6) {
    return canonicalizeSearchSpelling(spellingNormalized.slice(0, -3));
  }
  if (spellingNormalized.endsWith("ed") && spellingNormalized.length > 5) {
    return canonicalizeSearchSpelling(spellingNormalized.slice(0, -2));
  }
  if (spellingNormalized.endsWith("es") && spellingNormalized.length > 5) {
    return canonicalizeSearchSpelling(spellingNormalized.slice(0, -2));
  }
  if (spellingNormalized.endsWith("s") && spellingNormalized.length > 4) {
    return canonicalizeSearchSpelling(spellingNormalized.slice(0, -1));
  }
  if (spellingNormalized.endsWith("e") && spellingNormalized.length > 6) {
    return canonicalizeSearchSpelling(spellingNormalized.slice(0, -1));
  }

  return spellingNormalized;
}

/**
 * KJV often drops the final silent e before an inflectional suffix
 * (loveth → lov, giveth → giv). Restore it so modern queries match too.
 */
function restoreSilentE(token: string): string {
  return token.endsWith("v") ? `${token}e` : token;
}

function buildNormalizedSearchVocabulary(
  translation: BibleTranslation,
  data: RawBibleData,
): Map<string, number> {
  const key = translation.toUpperCase();
  const cached = normalizedSearchVocabularyCache.get(key);
  if (cached) return cached;

  const vocabulary = buildSearchVocabulary(translation, data);
  const normalized = new Map<string, number>();

  for (const [token, count] of vocabulary) {
    const keyToken = normalizeSearchToken(token);
    normalized.set(keyToken, (normalized.get(keyToken) ?? 0) + count);
  }

  normalizedSearchVocabularyCache.set(key, normalized);
  return normalized;
}

function buildSearchVocabulary(
  translation: BibleTranslation,
  data: RawBibleData,
): Map<string, number> {
  const key = translation.toUpperCase();
  const cached = searchVocabularyCache.get(key);
  if (cached) return cached;

  const vocabulary = new Map<string, number>();

  for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const chapterData of Object.values(bookData)) {
      for (const text of Object.values(chapterData)) {
        for (const token of normalizeSearchText(text).split(" ").filter(Boolean)) {
          if (token.length < 2) continue;
          vocabulary.set(token, (vocabulary.get(token) ?? 0) + 1);
        }
      }
    }
  }

  searchVocabularyCache.set(key, vocabulary);
  return vocabulary;
}

export function repairSearchQuery(
  query: string,
  translation: BibleTranslation,
  data: RawBibleData,
): string {
  const normalized = normalizeSearchText(query);
  if (!normalized) return normalized;

  const vocabulary = buildSearchVocabulary(translation, data);
  const corrected = normalized.split(" ").filter(Boolean).map((token) => {
    const alias = COMMON_SEARCH_TOKEN_ALIASES.get(token);
    if (alias) return alias;

    if (
      token.length < 3 ||
      SEARCH_STOP_WORDS.has(token) ||
      /^\d+$/.test(token) ||
      vocabulary.has(token)
    ) {
      return token;
    }

    let bestCandidate: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestFrequency = -1;
    const maxDist = token.length <= 4 ? 1 : 2;

    for (const [candidate, frequency] of vocabulary) {
      if (
        candidate.length < 3 ||
        Math.abs(candidate.length - token.length) > maxDist
      ) {
        continue;
      }

      const firstLetterMatch = candidate[0] === token[0];
      const transposedFirstTwo =
        token.length >= 4 &&
        candidate.length >= 4 &&
        token[0] === candidate[1] &&
        token[1] === candidate[0];

      if (!firstLetterMatch && !transposedFirstTwo) {
        continue;
      }

      const distance = damerauLevenshteinDistance(token, candidate, maxDist);
      if (distance > maxDist) continue;

      if (
        distance < bestDistance ||
        (distance === bestDistance && frequency > bestFrequency)
      ) {
        bestCandidate = candidate;
        bestDistance = distance;
        bestFrequency = frequency;
      }
    }

    return bestCandidate && bestDistance <= maxDist ? bestCandidate : token;
  });

  return corrected.join(" ")
    .replace(/\breverse\b(?=.*\bcaptivity\b)/g, "turn")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTokenWeight(
  token: string,
  normalizedVocabulary: Map<string, number>,
): number {
  const frequency = normalizedVocabulary.get(normalizeSearchToken(token)) ?? 1;
  return Math.min(3, Math.max(0.35, 6 / Math.sqrt(frequency + 1)));
}

function weightedTokenCoverage(
  queryTokens: string[],
  textTokenSet: Set<string>,
  queryTokenWeights: number[],
): number {
  const totalWeight = queryTokenWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return 0;

  const matchedWeight = queryTokens.reduce((sum, token, index) => {
    const matched = textTokenSet.has(token);
    return matched ? sum + queryTokenWeights[index] : sum;
  }, 0);

  return matchedWeight / totalWeight;
}

function weightedOrderedTokenCoverage(
  queryTokens: string[],
  textTokens: string[],
  queryTokenWeights: number[],
): number {
  const totalWeight = queryTokenWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0 || textTokens.length === 0) return 0;

  let matchedWeight = 0;
  let startIndex = 0;

  for (let index = 0; index < queryTokens.length; index += 1) {
    const queryToken = queryTokens[index];
    const foundIndex = textTokens.findIndex(
      (textToken, textIndex) => textIndex >= startIndex && queryToken === textToken,
    );
    if (foundIndex === -1) continue;
    matchedWeight += queryTokenWeights[index];
    startIndex = foundIndex + 1;
  }

  return matchedWeight / totalWeight;
}

function nearbyPairCoverage(queryTokens: string[], textTokens: string[]): number {
  if (queryTokens.length < 2 || textTokens.length === 0) return 0;

  let matchedPairs = 0;

  for (let index = 0; index < queryTokens.length - 1; index += 1) {
    const first = queryTokens[index];
    const second = queryTokens[index + 1];
    const firstIndex = textTokens.findIndex((textToken) => first === textToken);
    if (firstIndex === -1) continue;

    const window = textTokens.slice(firstIndex + 1, firstIndex + 4);
    if (window.some((textToken) => second === textToken)) {
      matchedPairs += 1;
    }
  }

  return matchedPairs / (queryTokens.length - 1);
}

function contentTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => normalizeSearchToken(token))
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function contentPhraseCoverage(queryContent: string[], textContent: string[]): number {
  if (queryContent.length < 2) return 0;
  if (textContent.length === 0) return 0;

  const queryPhrase = queryContent.join(" ");
  const textPhrase = textContent.join(" ");
  if (textPhrase.includes(queryPhrase)) return 1;

  let bestRun = 0;

  for (let start = 0; start < queryContent.length; start += 1) {
    let run = 0;
    let textIndex = 0;

    for (let queryIndex = start; queryIndex < queryContent.length; queryIndex += 1) {
      const token = queryContent[queryIndex];
      const foundIndex = textContent.findIndex(
        (textToken, index) => index >= textIndex && token === textToken,
      );
      if (foundIndex === -1) break;

      if (run > 0 && foundIndex - textIndex > 3) break;

      run += 1;
      textIndex = foundIndex + 1;
    }

    bestRun = Math.max(bestRun, run);
  }

  return bestRun / queryContent.length;
}

function numericReferenceCoverage(queryTokens: string[], entry: BibleCorpusEntry): number {
  const numericTokens = Array.from(
    new Set(queryTokens.filter((token) => /^\d+$/.test(token))),
  );
  if (numericTokens.length === 0) return 0;

  const entryEndVerse = Math.max(entry.verse, entry.endVerse);
  const matchedTokens = numericTokens.filter((token) => {
    const value = Number(token);
    return (
      Number.isSafeInteger(value) &&
      (entry.chapter === value || (entry.verse <= value && value <= entryEndVerse))
    );
  });

  return matchedTokens.length / numericTokens.length;
}

function denseContentCoverageBonus(queryContent: string[], textContent: string[]): number {
  if (queryContent.length < 4 || textContent.length === 0) return 0;
  if (!queryContent.some((token) => token.length >= 6)) return 0;

  const textTokenSet = new Set(textContent);
  const matchedCount = queryContent.filter((token) => textTokenSet.has(token)).length;
  const coverage = matchedCount / queryContent.length;

  if (coverage >= 0.9) return 0.16;
  if (coverage >= 0.8) return 0.10;
  return 0;
}

function firstStrongTokenBonus(queryContent: string[], textContent: string[]): number {
  const firstStrongToken = queryContent.find((token) => token.length >= 5);
  if (!firstStrongToken) return 0;

  const index = textContent.findIndex((token) => firstStrongToken === token);
  if (index === -1) return 0;

  return Math.max(0, 0.06 - index * 0.01);
}

type PreparedVerseSearchText = {
  normalizedText: string;
  searchTokens: string[];
  normalizedSearchTokens: string[];
  searchContentTokens: string[];
};

function prepareVerseSearchText(text: string): PreparedVerseSearchText {
  const normalizedText = normalizeSearchText(text);
  const searchTokens = normalizedText.split(" ").filter(Boolean);
  const normalizedSearchTokens = searchTokens.map((token) => normalizeSearchToken(token));
  return {
    normalizedText,
    searchTokens,
    normalizedSearchTokens,
    searchContentTokens: normalizedSearchTokens.filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)),
  };
}

function joinPreparedSearchText(parts: PreparedVerseSearchText[]): Pick<
  BibleCorpusEntry,
  "normalizedText" | "searchTokens" | "normalizedSearchTokens" | "searchTokenSet" | "searchContentTokens"
> {
  if (parts.length === 1) {
    const only = parts[0];
    return {
      normalizedText: only.normalizedText,
      searchTokens: only.searchTokens,
      normalizedSearchTokens: only.normalizedSearchTokens,
      searchTokenSet: new Set(only.normalizedSearchTokens),
      searchContentTokens: only.searchContentTokens,
    };
  }
  const normalizedSearchTokens = parts.flatMap((part) => part.normalizedSearchTokens);
  return {
    normalizedText: parts.map((part) => part.normalizedText).filter(Boolean).join(" "),
    searchTokens: parts.flatMap((part) => part.searchTokens),
    normalizedSearchTokens,
    searchTokenSet: new Set(normalizedSearchTokens),
    searchContentTokens: parts.flatMap((part) => part.searchContentTokens),
  };
}

function buildSearchSnippet(text: string, _queryTokens: string[]): string {
  // Always return the full verse text — Bible content should never be truncated
  return text;
}

function scoreVerseMatch(
  entry: BibleCorpusEntry,
  normalizedQuery: string,
  queryTokens: string[],
  normalizedQueryTokens: string[],
  queryTokenWeights: number[],
  queryContent: string[],
): number {
  if (!normalizedQuery) return 0;

  const normalizedText = entry.normalizedText ?? normalizeSearchText(entry.text);
  if (!normalizedText) return 0;

  if (` ${normalizedText} `.includes(` ${normalizedQuery} `)) {
    return 1;
  }

  const textTokens =
    entry.normalizedSearchTokens ??
    normalizedText.split(" ").filter(Boolean).map((token) => normalizeSearchToken(token));
  if (textTokens.length === 0 || queryTokens.length === 0) return 0;

  const textTokenSet = entry.searchTokenSet ?? new Set(textTokens);
  const tokenMatches = normalizedQueryTokens.filter((token) => textTokenSet.has(token)).length;
  const numericReferenceMatch = numericReferenceCoverage(queryTokens, entry);
  if (tokenMatches === 0 && numericReferenceMatch === 0) return 0;

  const tokenCoverage = weightedTokenCoverage(normalizedQueryTokens, textTokenSet, queryTokenWeights);
  const orderedCoverage = weightedOrderedTokenCoverage(normalizedQueryTokens, textTokens, queryTokenWeights);
  const pairCoverage = nearbyPairCoverage(normalizedQueryTokens, textTokens);
  const textContent = entry.searchContentTokens ?? contentTokens(textTokens);
  // A compact phrase beats words scattered through a long verse/window.
  // Keep a little separation below an exact quotation for inflection changes
  // and omitted connecting words.
  const compactPhrase = queryContent.length >= 2 &&
    ` ${textContent.join(" ")} `.includes(` ${queryContent.join(" ")} `);
  const contentCoverage = contentPhraseCoverage(queryContent, textContent);
  const denseCoverageBonus = denseContentCoverageBonus(queryContent, textContent);
  const prefixBonus =
    queryTokens.length > 0 && normalizedText.startsWith(queryTokens[0]) ? 0.06 : 0;
  const strongStartBonus = firstStrongTokenBonus(queryContent, textContent);

  const textMatchScore = Math.min(
    entry.endVerse > entry.verse && contentCoverage < 1 ? 0.89 : compactPhrase ? 0.98 : 0.94,
    tokenCoverage * 0.42 +
    orderedCoverage * 0.22 +
    pairCoverage * 0.12 +
    contentCoverage * 0.20 +
    denseCoverageBonus +
    prefixBonus +
    strongStartBonus,
  );

  // A number is also useful as a chapter/verse search. This keeps inputs such
  // as "30" or "30%" searchable even when the translation spells the number
  // out in the verse text instead of storing it as digits.
  const hasNonNumericTokens = queryTokens.some(
    (token) => !/^\d+$/.test(token) && !SEARCH_ORDINAL_MAP.has(token),
  );
  const numericCap = hasNonNumericTokens ? 0.38 : 0.78;
  return Math.min(1, Math.max(textMatchScore, numericReferenceMatch * numericCap));
}

function scoreVerseUpperBound(
  entry: BibleCorpusEntry,
  tokens: string[],
  weights: number[],
  queryContent: string[],
): number {
  const textTokens = entry.searchTokenSet!;
  const coverage = weightedTokenCoverage(tokens, textTokens, weights);
  const contentMatches = queryContent.filter((token) => textTokens.has(token)).length;
  const contentCoverage = queryContent.length >= 2 ? contentMatches / queryContent.length : 0;
  const possiblePairs = tokens.slice(1).filter((token, i) => textTokens.has(tokens[i]) && textTokens.has(token)).length;
  const pairCoverage = tokens.length >= 2 ? possiblePairs / (tokens.length - 1) : 0;
  const denseBonus = queryContent.length >= 4 && queryContent.some((token) => token.length >= 6)
    ? contentCoverage >= 0.9 ? 0.16 : contentCoverage >= 0.8 ? 0.10 : 0
    : 0;
  // Exact substring matches also have complete token coverage.
  return Math.min(1, coverage * 0.64 + pairCoverage * 0.12 + contentCoverage * 0.20 + denseBonus + 0.12);
}

async function searchBibleInTranslation(
  query: string,
  translation: BibleTranslation,
  limit: number,
  scope?: BibleSearchScope,
  minScore = 0.42,
  signals: BibleSearchSignals = {
    aliasReference: null,
    conceptReferences: new Set<string>(),
  },
): Promise<RankedSearchResult[]> {
  const data = await loadTranslation(translation);
  const corpus = await getBibleCorpus(translation, 3);
  const aliasTarget = signals.aliasReference
    ? parseSearchReference(signals.aliasReference)
    : null;
  const conceptTargets = Array.from(signals.conceptReferences)
    .map(parseSearchReference)
    .filter((target): target is NonNullable<typeof target> => Boolean(target));
  const results: RankedSearchResult[] = [];
  await warmSearchVocabulary(translation, data);
  const repairedQuery = repairSearchQuery(query, translation, data);
  const normalizedVocabulary = buildNormalizedSearchVocabulary(translation, data);
  const spelledQuery = normalizeSearchText(query)
    .split(" ")
    .map((w) => numberSearchWord(w) ?? canonicalizeSearchSpelling(w))
    .join(" ");

  const queryVariants = Array.from(
    new Set([
      normalizeSearchText(query),
      spelledQuery,
      normalizeSearchText(repairedQuery),
      // Modal wording varies between spoken quotations and translations.
      normalizeSearchText(query).replace(/\bshall\b/g, "should"),
    ].filter(Boolean)),
  ).map((variant) => ({
    normalizedQuery: variant,
    queryTokens: tokenizeSearch(variant),
  })).map((variant) => ({
    ...variant,
    normalizedQueryTokens: variant.queryTokens.map((token) => normalizeSearchToken(token)),
    queryContent: contentTokens(variant.queryTokens),
    queryTokenWeights: variant.queryTokens.map((token) =>
      getSearchTokenWeight(token, normalizedVocabulary),
    ),
  }));

  const scopedBook = scope?.book ? normalizeSearchScopeBook(scope.book) : undefined;

  // Look up words once, then score the most complete matches first. This is
  // lossless: the upper bound below only skips entries that cannot beat the
  // current results, even with every order/proximity bonus applied.
  const index = await getCorpusSearchIndexAsync(corpus);
  const candidateCoverage = new Map<number, number>();
  for (const variant of queryVariants) {
    const weights = new Map<number, number>();
    const totalWeight = variant.queryTokenWeights.reduce((sum, weight) => sum + weight, 0);
    variant.normalizedQueryTokens.forEach((token, tokenIndex) => {
      const ids = index.tokens.get(token) ?? [];
      for (const id of ids) {
        weights.set(id, (weights.get(id) ?? 0) + variant.queryTokenWeights[tokenIndex]);
      }
    });
    for (const [id, weight] of weights) {
      candidateCoverage.set(id, Math.max(candidateCoverage.get(id) ?? 0, weight / totalWeight));
    }
    for (const token of variant.queryTokens.filter((token) => /^\d+$/.test(token))) {
      for (const id of index.numbers.get(Number(token)) ?? []) {
        candidateCoverage.set(id, Math.max(candidateCoverage.get(id) ?? 0, 1));
      }
    }
  }
  for (const reference of [signals.aliasReference, ...signals.conceptReferences]) {
    const target = reference ? parseSearchReference(reference) : null;
    if (!target) continue;
    for (const id of index.references.get(`${target.book} ${target.chapter}:${target.verse}`) ?? []) {
      candidateCoverage.set(id, 1);
    }
  }
  const candidates = [...candidateCoverage].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  let cutoff = minScore;

  for (const [id, coverage] of candidates) {
    const entry = corpus[id];
    if (
      (scopedBook && normalizeSearchScopeBook(entry.book) !== scopedBook) ||
      (scope?.chapter !== undefined && entry.chapter !== scope.chapter)
    ) {
      continue;
    }

    if (coverage < 1 && queryVariants.every((variant) => {
      const hasNonNumeric = variant.queryTokens.some(
        (token) => !/^\d+$/.test(token) && !SEARCH_ORDINAL_MAP.has(token),
      );
      const cap = hasNonNumeric ? 0.38 : 0.78;
      return (
        Math.max(
          scoreVerseUpperBound(entry, variant.normalizedQueryTokens, variant.queryTokenWeights, variant.queryContent),
          numericReferenceCoverage(variant.queryTokens, entry) * cap,
        ) + 1e-9 < cutoff
      );
    })) continue;

    let bestScore = 0;
    let bestTokens: string[] = [];

    for (const variant of queryVariants) {
      const score = scoreVerseMatch(
        entry,
        variant.normalizedQuery,
        variant.queryTokens,
        variant.normalizedQueryTokens,
        variant.queryTokenWeights,
        variant.queryContent,
      );
      if (score > bestScore) {
        bestScore = score;
        bestTokens = variant.queryTokens;
      }
    }

    const windowSize = Math.max(1, entry.endVerse - entry.verse + 1);
    const aliasMatch = Boolean(
      aliasTarget &&
      normalizeSearchScopeBook(entry.book) === aliasTarget.book &&
      entry.chapter === aliasTarget.chapter &&
      entry.verse === aliasTarget.verse,
    );
    const conceptMatch = conceptTargets.some(
      (target) =>
        normalizeSearchScopeBook(entry.book) === target.book &&
        entry.chapter === target.chapter &&
        entry.verse === target.verse,
    );

    // Quote aliases and curated Bible concepts are stronger than a generic
    // word overlap. Keep the boost modest so ordinary keyword searches still
    // return every relevant passage, while a known phrase reaches the top.
    const bibleSignalBoost = (aliasMatch ? 0.70 : 0) + (conceptMatch ? 0.10 : 0);
    const score = aliasMatch
      ? Math.max(0, bestScore - (windowSize - 1) * 0.02 + bibleSignalBoost)
      : Math.min(1, Math.max(0, bestScore - (windowSize - 1) * 0.02 + bibleSignalBoost));
    if (score < minScore && !aliasMatch) continue;
    if (score < cutoff) continue;
    if (results.some((best) => best.score >= score && best.book === entry.book &&
      best.chapter === entry.chapter && entry.verse <= best.verse &&
      entry.endVerse >= (best.endVerse ?? best.verse))) continue;

    results.push({
      book: entry.book,
      chapter: entry.chapter,
      verse: entry.verse,
      endVerse: entry.endVerse > entry.verse ? entry.endVerse : undefined,
      text: entry.text,
      snippet: buildSearchSnippet(entry.text, bestTokens),
      score,
    });
    // Keep enough independent passages without filling the shortlist with
    // two- and three-verse windows surrounding the same exact verse.
    results.sort((a, b) => b.score - a.score ||
      (a.endVerse ?? a.verse) - a.verse - ((b.endVerse ?? b.verse) - b.verse));
    const distinct = results.filter((candidate, candidateIndex) => !results.slice(0, candidateIndex).some((best) =>
      best.book === candidate.book && best.chapter === candidate.chapter &&
      candidate.verse <= best.verse && (candidate.endVerse ?? candidate.verse) >= (best.endVerse ?? best.verse),
    ));
    results.splice(0, results.length, ...distinct.slice(0, limit));
    cutoff = results.length >= limit ? Math.max(minScore, results[results.length - 1].score) : minScore;
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Keyword search across the Bible, or inside an optional book/chapter scope.
 * Returns up to `limit` results.
 */
export async function searchBibleRanked(
  query: string,
  translation: BibleTranslation = "KJV",
  limit = 50,
  scope?: BibleSearchScope,
  minScore = 0.42,
): Promise<RankedSearchResult[]> {
  if (!query.trim() || limit <= 0) return [];

  const selectedTranslation = translation.toUpperCase() as BibleTranslation;
  const cacheKey = JSON.stringify([selectedTranslation, normalizeSearchText(query), limit, scope?.book, scope?.chapter, minScore]);
  const cached = rankedSearchCache.get(cacheKey);
  if (cached) return cached.map((result) => ({ ...result }));
  const signals = buildBibleSearchSignals(query);
  const primaryResults = await searchBibleInTranslation(
    query,
    selectedTranslation,
    limit,
    scope,
    minScore,
    signals,
  );
  const shouldSearchKjv =
    selectedTranslation !== "KJV" &&
    (primaryResults.length === 0 || primaryResults[0].score < 0.78);

  const fallbackResults = shouldSearchKjv
    ? await searchBibleInTranslation(query, "KJV", limit, scope, minScore, signals)
    : [];

  const merged = [...primaryResults, ...fallbackResults]
    .reduce<RankedSearchResult[]>((accumulator, candidate) => {
      if (
        accumulator.some(
          (existing) =>
            existing.book === candidate.book &&
            existing.chapter === candidate.chapter &&
            existing.verse === candidate.verse,
        )
      ) {
        return accumulator;
      }
      accumulator.push(candidate);
      return accumulator;
    }, [])
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Bound memory during long sermons. Repeated ASR interim/final revisions
  // should reuse their answers instead of re-running the same search.
  if (rankedSearchCache.size >= 32) rankedSearchCache.delete(rankedSearchCache.keys().next().value!);
  rankedSearchCache.set(cacheKey, merged);
  return merged.map((result) => ({ ...result }));
}

export async function searchBible(
  query: string,
  translation: BibleTranslation = "KJV",
  limit = 50,
  scope?: BibleSearchScope,
): Promise<SearchResult[]> {
  const merged = await searchBibleRanked(query, translation, limit, scope);
  return merged.map(({ score: _score, ...result }) => result);
}

/**
 * Get all books with their chapter counts (for the book picker UI).
 */
export async function getBookIndex(
  translation: BibleTranslation = "KJV"
): Promise<{ book: string; chapters: number }[]> {
  const data = await loadTranslation(translation);
  return BIBLE_BOOKS.map((book) => ({
    book,
    chapters: data[book] ? Object.keys(data[book]).length : 0,
  })).filter((b) => b.chapters > 0);
}

/**
 * Raw verse data for one translation (book → chapter → verse → text). Used by the quote index.
 */
export async function getRawBibleData(translation: string): Promise<RawBibleData> {
  return loadTranslation(translation.toUpperCase() as BibleTranslation);
}

/**
 * Pre-load a translation into memory (call on app start).
 */
export async function preloadTranslation(
  t: BibleTranslation = "KJV"
): Promise<void> {
  await loadTranslation(t);
}

/**
 * Build a cached verse/window corpus for fuzzy and semantic search.
 */
export function getBibleCorpus(
  translation: BibleTranslation = "KJV",
  maxWindowSize = 3,
): Promise<BibleCorpusEntry[]> {
  const key = `${translation.toUpperCase()}:${maxWindowSize}`;
  const cached = corpusCache.get(key);
  if (cached) return Promise.resolve(cached);
  // A microphone preload, a search and the first transcript can ask together: they share one build.
  const pending = corpusBuilds.get(key);
  if (pending) return pending;
  const build = buildBibleCorpus(translation, maxWindowSize, key).finally(() => {
    if (corpusBuilds.get(key) === build) corpusBuilds.delete(key);
  });
  corpusBuilds.set(key, build);
  return build;
}

async function buildBibleCorpus(
  translation: BibleTranslation,
  maxWindowSize: number,
  key: string,
): Promise<BibleCorpusEntry[]> {
  const data = await loadTranslation(translation);
  const entries: BibleCorpusEntry[] = [];
  const slice = createSlicer();

  for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const [chapterStr, chapterData] of Object.entries(bookData)) {
      const chapter = parseInt(chapterStr, 10);
      const verses = Object.entries(chapterData)
        .map(([verseStr, text]) => ({
          verse: parseInt(verseStr, 10),
          text,
        }))
        .sort((a, b) => a.verse - b.verse);

      // Each verse is normalized once. Words are normalized one by one, so a window of verses has
      // exactly the words of its verses joined: the same entries as normalizing every window's text.
      const prepared = verses.map((verse) => prepareVerseSearchText(verse.text));

      for (let index = 0; index < verses.length; index += 1) {
        let combinedText = "";
        const windowParts: PreparedVerseSearchText[] = [];

        for (
          let windowSize = 1;
          windowSize <= maxWindowSize && index + windowSize - 1 < verses.length;
          windowSize += 1
        ) {
          const item = verses[index + windowSize - 1];
          combinedText = combinedText ? `${combinedText} ${item.text}` : item.text;
          windowParts.push(prepared[index + windowSize - 1]);

          const startVerse = verses[index].verse;
          const endVerse = item.verse;
          const searchText = joinPreparedSearchText(windowParts);
          entries.push({
            book,
            chapter,
            verse: startVerse,
            endVerse,
            translation: translation.toUpperCase(),
            reference:
              startVerse === endVerse
                ? `${book} ${chapter}:${startVerse}`
                : `${book} ${chapter}:${startVerse}-${endVerse}`,
            text: combinedText,
            ...searchText,
          });
        }
      }
      await slice();
    }
  }

  // A translation replaced or removed while this ran must not be cached from its old text.
  if (translationCache.get(translation.toUpperCase()) === data) corpusCache.set(key, entries);
  return entries;
}
