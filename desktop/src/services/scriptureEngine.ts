/**
 * scriptureEngine.ts — Incremental Scripture Detection Engine
 *
 * A real-time semantic state machine over noisy, delayed, self-correcting
 * ASR input streams. Every design choice is made for determinism under
 * concurrent async operations.
 *
 * Guarantees:
 *   - Revision-safe: stale ASR revisions are never reprocessed
 *   - Serialized pipeline: chunks are processed in arrival order
 *   - Deterministic dedup: state-delta based, not text-hash based
 *   - Context decay: old book context fades with time and topic switches
 *   - Never guesses: ambiguous relative references return candidates, not null
 */

import {
  parseScriptureReferenceAll,
  parseScriptureIntent,
  resolveScriptureSpeech,
  resolveWithContext,
  createScriptureContext,
  createScriptureSpeechState,
  pushScriptureContext,
  type ScriptureContext,
  type ScriptureIntent,
  type ScriptureSpeechState,
  isLikelyScriptureReferenceAttempt,
} from "./scriptureParser";
import { getVerse, getVerseCount, getChapterCount } from "../bible/bibleData";
import { resolveScriptureProjection } from "./scriptureProjection";
import { getReadyQuoteIndex, warmQuoteIndex } from "../bible/quoteIndexStore";
import { isVerbatimLikely, quoteHitConfidence, searchQuoteIndex, type QuoteHit } from "../bible/quoteIndex";
import type { VoiceBibleCandidate } from "./voiceBibleTypes";

type BibleDataModule = typeof import("../bible/bibleData");
type BibleEmbeddingsModule = typeof import("../bible/bibleEmbeddings");
type ScriptureRerankerModule = typeof import("../bible/scriptureReranker");

let bibleDataModulePromise: Promise<BibleDataModule> | null = null;
let bibleEmbeddingsModulePromise: Promise<BibleEmbeddingsModule> | null = null;
let scriptureRerankerModulePromise: Promise<ScriptureRerankerModule> | null = null;

function loadBibleDataModule(): Promise<BibleDataModule> {
  bibleDataModulePromise ??= import("../bible/bibleData");
  return bibleDataModulePromise;
}

function loadBibleEmbeddingsModule(): Promise<BibleEmbeddingsModule> {
  bibleEmbeddingsModulePromise ??= import("../bible/bibleEmbeddings");
  return bibleEmbeddingsModulePromise;
}

function loadScriptureRerankerModule(): Promise<ScriptureRerankerModule> {
  scriptureRerankerModulePromise ??= import("../bible/scriptureReranker");
  return scriptureRerankerModulePromise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScriptureMatch {
  candidate: VoiceBibleCandidate;
  source: "reference" | "context" | "quote";
  confidence: number;
  navigationOnly?: boolean;
}

export interface DetectionResult {
  matches: ScriptureMatch[];
  context: ScriptureContext;
  handledReference?: boolean;
}

/**
 * The passage currently being preached. Quote search uses this as a hard
 * boundary until an explicit new Bible reference is spoken.
 */
export interface ScriptureSearchScope {
  book: string;
  chapter: number;
  verse?: number | null;
}

type QuoteSearchScope = ScriptureSearchScope | string | null | undefined;
type QuoteSearchMode = "strict" | "closest";

interface QuoteSearchOptions {
  mode?: QuoteSearchMode;
  /** Previous finalized words, used only if the new turn needs completion. */
  contextText?: string;
}

function normalizeBookForScope(book: string): string {
  const normalized = book.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "psalm" ? "psalms" : normalized;
}

function normalizeQuoteSearchScope(scope: QuoteSearchScope): { book: string; chapter?: number } | undefined {
  if (typeof scope === "string") {
    const book = scope.trim();
    return book ? { book } : undefined;
  }

  if (!scope?.book) return undefined;
  return {
    book: scope.book,
    chapter: Number.isFinite(scope.chapter) ? scope.chapter : undefined,
  };
}

function matchesQuoteSearchScope(
  book: string,
  chapter: number,
  scope: { book: string; chapter?: number } | undefined,
): boolean {
  if (!scope) return true;
  if (normalizeBookForScope(book) !== normalizeBookForScope(scope.book)) return false;
  return scope.chapter === undefined || chapter === scope.chapter;
}

function isSupportingPassageResult(
  best: { book: string; chapter: number; verse: number },
  runnerUp: { book: string; chapter: number; verse: number; endVerse?: number },
): boolean {
  return (
    normalizeBookForScope(best.book) === normalizeBookForScope(runnerUp.book) &&
    best.chapter === runnerUp.chapter &&
    runnerUp.endVerse !== undefined &&
    runnerUp.verse <= best.verse &&
    runnerUp.endVerse >= best.verse
  );
}

function canStrongQuoteLeaveScope(confidence: number, profile: QuoteQueryProfile): boolean {
  return confidence >= 0.82 && (profile.strongAnchors > 0 || profile.contentTokens.length >= 4 ||
    (confidence >= 0.95 && new Set(profile.contentTokens).size >= 3));
}

function hasStrongRankedSearchWinner(
  rankedResults: RankedBibleSearchResult[],
  quoteThresholds: QuoteSearchThresholds,
): boolean {
  if (rankedResults.length === 0) return false;

  const best = rankedResults[0];
  const runnerUp = rankedResults.length > 1 ? rankedResults[1] : null;
  const hasStrongScore = best.score >= quoteThresholds.lexicalMinScore;
  const hasClearGap = runnerUp
    ? (best.score >= 0.95 && isSupportingPassageResult(best, runnerUp)) ||
      (Math.min(1, best.score) - Math.min(1, runnerUp.score)) >= quoteThresholds.lexicalMinGap
    : true;

  return hasStrongScore && hasClearGap;
}

function buildLexicalQuoteMatches(
  rankedResults: RankedBibleSearchResult[],
  translation: string,
): ScriptureMatch[] {
  const confident = rankedResults[0]?.score >= 0.90;
  return rankedResults.slice(0, confident ? 1 : 5).map((result) => ({
    candidate: {
      book: result.book,
      chapter: result.chapter,
      verse: result.verse,
      endVerse: result.endVerse,
      translation,
      label: `${result.book} ${result.chapter}:${result.verse}${result.endVerse ? `-${result.endVerse}` : ""}`,
      snippet: result.text,
      confidence: Math.min(1, result.score),
      source: confident ? "keyword" : "fuzzy",
    },
    source: "quote" as const,
    confidence: Math.min(1, result.score),
  }));
}

interface ChunkRecord {
  text: string;
  timestamp: number;
  finalized: boolean;
  chunkId: number;
}

interface EmissionRecord {
  refKey: string;
  timestamp: number;
  /** Structural snapshot at emission time — not raw text */
  stateHash: string;
}

interface VerseHistoryEntry {
  book: string;
  chapter: number;
  verse: number;
  label: string;
  snippet: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Navigation commands — detected BEFORE parsing (via parseScriptureIntent)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MS = 15_000;
const QUOTE_WINDOW_MS = 12_000; // 12-second sliding window for quote search
const MIN_QUOTE_LENGTH = 8;
const CONTEXT_DECAY_MS = 120_000; // 2 minutes — context entries older than this are inactive

// ── Quote stabilization thresholds ──────────────────────────────────────────

/** Minimum finalScore for a result to be shown to the user */
const MIN_DISPLAY_SCORE = 0.30;

// Fuzzy search is a recovery path for ASR errors, not a license to turn
// ordinary sermon language into a Bible reference. Keep it conservative and
// require a clear winner before returning a candidate.
const MIN_FUZZY_QUOTE_SCORE = 0.72;
const MIN_FUZZY_QUOTE_GAP = 0.06;
const CLOSEST_QUOTE_SEARCH_MIN_SCORE = 0.08;
const MIN_CLOSEST_QUOTE_SCORE = 0.08;
const MIN_UNSCOPED_CLOSEST_QUOTE_SCORE = 0.08;

/**
 * Semantic (embedding) quote search is switched off: it needs a very large model file, is slow, and
 * the plain keyword index (`bible/quoteIndex.ts`) finds paraphrases faster. Flip to true to restore it.
 */
const ENABLE_SEMANTIC_QUOTE_SEARCH = false;

/** Lowest index score a live (strict) search will show. */
const STRICT_INDEX_MIN_SCORE = 0.7;
/** The exact-quote search's own list is kept as is when it has at least this many verses. */
const INDEX_FILL_BELOW = 3;
/** The most index suggestions offered for one sentence. */
const INDEX_SUGGESTION_LIMIT = 6;
/** How long a search may wait for the index to finish building the first time. */
const INDEX_BUILD_WAIT_MS = 1500;

/** Score decay factor per update cycle for unreinforced candidates */
const CANDIDATE_DECAY_FACTOR = 0.98;

const QUOTE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does",
  "did", "for", "from", "had", "has", "have", "he", "her", "him", "his",
  "i", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "she",
  "that", "the", "their", "them", "there", "they", "this", "to", "us", "was",
  "we", "were", "with", "you", "your", "not", "no",
]);

const GENERIC_QUOTE_ANCHORS = new Set([
  "god", "lord", "jesus", "christ", "spirit", "love", "faith", "grace",
  "mercy", "peace", "strength", "good", "evil", "heart", "world", "life",
  "light", "truth", "way", "word", "son", "father", "king", "kingdom",
  "people", "holy", "blood", "cross", "name", "man", "men", "going",
  "through", "suddenly", "begin", "began", "fade", "away", "thank", "thanks",
  "today", "morning", "coming", "things",
]);

interface QuoteQueryProfile {
  normalized: string;
  tokens: string[];
  contentTokens: string[];
  strongAnchors: number;
}

interface QuoteSearchThresholds {
  lexicalMinScore: number;
  lexicalMinGap: number;
  embeddingMinScore: number;
  embeddingMinGap: number;
  allowSemanticSearch: boolean;
  allowFuzzySearch: boolean;
}

interface RankedBibleSearchResult {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  text: string;
  snippet?: string;
  score: number;
}

function analyzeQuoteQuery(input: string): QuoteQueryProfile {
  const normalized = input
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized ? normalized.split(" ").filter(Boolean) : [];
  const contentTokens = tokens.filter((token) => token.length > 2 && !QUOTE_STOP_WORDS.has(token));
  const strongAnchors = contentTokens.filter(
    (token) => token.length >= 6 && !GENERIC_QUOTE_ANCHORS.has(token),
  ).length;

  return { normalized, tokens, contentTokens, strongAnchors };
}

function getQuoteSearchThresholds(profile: QuoteQueryProfile): QuoteSearchThresholds {
  const contentCount = profile.contentTokens.length;
  const veryShort = contentCount <= 2;
  const short = contentCount <= 4;

  return {
    lexicalMinScore: veryShort ? 0.82 : short ? 0.68 : 0.60,
    lexicalMinGap: veryShort ? 0.12 : short ? 0.08 : 0.05,
    embeddingMinScore: veryShort
      ? (profile.strongAnchors > 0 ? 0.58 : 0.66)
      : short
        ? 0.45
        : 0.35,
    embeddingMinGap: veryShort ? 0.10 : short ? 0.08 : 0.05,
    allowSemanticSearch: contentCount >= 3 || profile.strongAnchors > 0,
    allowFuzzySearch: contentCount >= 3 || profile.strongAnchors >= 2,
  };
}

// ---------------------------------------------------------------------------
// Fast keyword→verse index (no LLM needed for common scriptures)
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two strings.
 * Used for fuzzy word matching to handle speech recognition errors.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two words match fuzzily based on word length.
 * Handles speech recognition errors like "value" → "valley".
 */
function fuzzyWordMatch(spoken: string, keyword: string): boolean {
  if (spoken === keyword) return true;
  if (spoken.length < 3 || keyword.length < 3) return false; // Too short for fuzzy

  const distance = levenshtein(spoken, keyword);
  const maxLen = Math.max(spoken.length, keyword.length);

  // Dynamic threshold based on word length
  if (maxLen <= 4) return distance === 0;      // Short words (≤4 chars): exact match only
  if (maxLen <= 6) return distance <= 1;        // Medium words: 1 edit allowed
  return distance <= 2;                          // Long words: 2 edits allowed
}

interface KeywordVerse {
  book: string;
  chapter: number;
  verse: number;
  keywords: string[]; // normalized keywords that trigger this match
}

const KEYWORD_VERSES: KeywordVerse[] = [
  { book: "John", chapter: 3, verse: 16, keywords: ["god", "loved", "world", "gave", "begotten", "son"] },
  { book: "Psalms", chapter: 23, verse: 1, keywords: ["lord", "shepherd", "shall", "not", "want"] },
  { book: "Romans", chapter: 8, verse: 28, keywords: ["all", "things", "work", "together", "good", "love", "god"] },
  { book: "Philippians", chapter: 4, verse: 13, keywords: ["all", "things", "through", "christ", "strengthens"] },
  { book: "Jeremiah", chapter: 29, verse: 11, keywords: ["plans", "prosper", "hope", "future"] },
  { book: "Isaiah", chapter: 41, verse: 10, keywords: ["fear", "not", "with", "you", "strengthen", "help"] },
  { book: "Proverbs", chapter: 3, verse: 5, keywords: ["trust", "lord", "heart", "with", "all", "lean", "not", "understanding"] },
  { book: "Matthew", chapter: 11, verse: 28, keywords: ["come", "all", "weary", "heavy", "laden", "rest"] },
  { book: "Romans", chapter: 3, verse: 23, keywords: ["all", "sinned", "fallen", "short", "glory"] },
  { book: "Ephesians", chapter: 2, verse: 8, keywords: ["grace", "saved", "through", "faith", "not", "works"] },
  { book: "2 Timothy", chapter: 1, verse: 7, keywords: ["spirit", "fear", "power", "love", "sound", "mind"] },
  { book: "Psalms", chapter: 46, verse: 1, keywords: ["god", "refuge", "strength", "present", "help", "trouble"] },
  { book: "Romans", chapter: 12, verse: 1, keywords: ["living", "sacrifice", "holy", "acceptable", "reasonable"] },
  { book: "Galatians", chapter: 5, verse: 22, keywords: ["fruit", "spirit", "love", "joy", "peace", "patience"] },
  { book: "Hebrews", chapter: 11, verse: 1, keywords: ["faith", "substance", "hoped", "evidence", "not", "seen"] },
  { book: "James", chapter: 1, verse: 5, keywords: ["lacks", "wisdom", "ask", "god", "gives", "generously"] },
  { book: "1 Corinthians", chapter: 13, verse: 4, keywords: ["love", "patient", "kind", "not", "envy", "boast"] },
  { book: "Psalms", chapter: 119, verse: 105, keywords: ["word", "lamp", "feet", "light", "path"] },
  { book: "Matthew", chapter: 28, verse: 19, keywords: ["go", "therefore", "make", "disciples", "nations", "baptize"] },
  { book: "Joshua", chapter: 1, verse: 9, keywords: ["strong", "courageous", "not", "afraid", "god", "with"] },
  { book: "Romans", chapter: 8, verse: 38, keywords: ["nothing", "separate", "us", "love", "god", "neither", "death"] },
  { book: "Psalms", chapter: 23, verse: 4, keywords: ["valley", "shadow", "death", "fear", "no", "evil", "rod", "staff", "walk", "through", "dark", "comfort"] },
  { book: "Isaiah", chapter: 40, verse: 31, keywords: ["wait", "lord", "renew", "strength", "wings", "eagles"] },
  { book: "Matthew", chapter: 6, verse: 33, keywords: ["seek", "first", "kingdom", "righteousness", "all", "added"] },
  { book: "John", chapter: 14, verse: 6, keywords: ["way", "truth", "life", "no", "one", "comes", "father"] },
  { book: "Psalms", chapter: 37, verse: 4, keywords: ["delight", "lord", "desires", "heart"] },
  { book: "Micah", chapter: 6, verse: 8, keywords: ["requires", "act", "justly", "love", "mercy", "walk", "humbly"] },
  { book: "Colossians", chapter: 3, verse: 23, keywords: ["whatever", "work", "heartily", "lord", "not", "men"] },
  { book: "Psalms", chapter: 51, verse: 10, keywords: ["create", "clean", "heart", "renew", "right", "spirit"] },
  { book: "Romans", chapter: 5, verse: 8, keywords: ["god", "demonstrates", "love", "while", "still", "sinners", "christ"] },
  { book: "John", chapter: 1, verse: 1, keywords: ["beginning", "word", "with", "god", "was"] },
  { book: "Genesis", chapter: 1, verse: 1, keywords: ["beginning", "god", "created", "heavens", "earth"] },
  { book: "Revelation", chapter: 21, verse: 4, keywords: ["wipe", "away", "every", "tear", "no", "more", "death", "sorrow"] },
  { book: "2 Corinthians", chapter: 5, verse: 17, keywords: ["anyone", "christ", "new", "creation", "old", "passed"] },
  { book: "Psalms", chapter: 139, verse: 14, keywords: ["fearfully", "wonderfully", "made", "works", "marvelous"] },
  { book: "Matthew", chapter: 5, verse: 16, keywords: ["let", "light", "shine", "before", "men", "good", "works"] },
  { book: "Philippians", chapter: 4, verse: 6, keywords: ["anxious", "nothing", "prayer", "supplication", "requests", "known"] },
  { book: "1 Peter", chapter: 5, verse: 7, keywords: ["cast", "all", "care", "upon", "cares", "for", "you"] },
  { book: "Psalms", chapter: 27, verse: 1, keywords: ["lord", "light", "salvation", "whom", "shall", "fear"] },
  { book: "Isaiah", chapter: 53, verse: 5, keywords: ["wounded", "transgressions", "bruised", "iniquities", "chastisement", "peace"] },
  { book: "John", chapter: 11, verse: 25, keywords: ["resurrection", "life", "whoever", "believes", "though", "die"] },
  { book: "Deuteronomy", chapter: 31, verse: 8, keywords: ["lord", "go", "before", "will", "not", "fail", "forsake", "fear", "dismayed"] },
  { book: "Hebrews", chapter: 13, verse: 5, keywords: ["never", "leave", "forsake", "content", "have", "said"] },
];

/**
 * Fast keyword matching — checks if the speech contains enough keywords
 * from any known verse. Returns the best match or null.
 * Runs in <1ms, no LLM needed.
 */
function fastKeywordMatch(speech: string): { book: string; chapter: number; verse: number; confidence: number } | null {
  const words = speech.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let bestMatch: { book: string; chapter: number; verse: number; confidence: number } | null = null;
  let bestScore = 0;

  for (const kv of KEYWORD_VERSES) {
    let matched = 0;
    for (const kw of kv.keywords) {
      // Fuzzy match: allows for speech recognition errors
      if (words.some((w) => fuzzyWordMatch(w, kw))) matched++;
    }
    // Dynamic threshold: for verses with many keywords, require fewer matches
    // For verses with few keywords, require more matches
    const ratio = matched / kv.keywords.length;
    const queryCoverage = matched / words.length;
    const minRatio = kv.keywords.length > 5 ? 0.33 : 0.45;
    if (ratio >= minRatio && matched >= 2 && matched > bestScore) {
      bestScore = matched;
      const conf = queryCoverage >= 0.8 && matched >= 3 ? 1.0 : Math.min(0.95, 0.5 + ratio * 0.5);
      bestMatch = {
        book: kv.book,
        chapter: kv.chapter,
        verse: kv.verse,
        confidence: conf,
      };
    }
  }

  return bestMatch;
}

interface IndexSearchOutcome {
  matches: ScriptureMatch[];
  top: QuoteHit | null;
  verbatimLikely: boolean;
}

/** Combine two result lists: one entry per verse (the more confident one), best first. */
function mergeQuoteMatches(primary: ScriptureMatch[], secondary: ScriptureMatch[]): ScriptureMatch[] {
  const byVerse = new Map<string, ScriptureMatch>();
  for (const match of [...primary, ...secondary]) {
    const key = `${match.candidate.book}|${match.candidate.chapter}|${match.candidate.verse}`;
    const existing = byVerse.get(key);
    if (!existing || match.confidence > existing.confidence) byVerse.set(key, match);
  }
  return [...byVerse.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

export class ScriptureDetectionEngine {
  private context: ScriptureContext = createScriptureContext();
  private translation = "KJV";
  private bibleDataLoaded = false;

  /** Time-windowed finalized chunks for quote search */
  private finalizedChunks: ChunkRecord[] = [];

  /** Latest interim chunk (replaced on each ASR revision) */
  private interimChunk: ChunkRecord | null = null;

  /** Revision guard: chunkId → last processed revisionId */
  private processedRevisions = new Map<number, number>();

  /** Monotonic chunk counter */
  private nextChunkId = 0;

  /** Time-based dedup: ref key → emission record */
  private recentEmissions = new Map<string, EmissionRecord>();

  /** Backpressure: only one quote search at a time */
  private quoteAbortController: AbortController | null = null;

  /** Ordered log of resolved verses for navigation */
  private verseHistory: VerseHistoryEntry[] = [];

  /** Active quote candidate for expiration tracking */
  private activeCandidate: { ref: string; score: number; timestamp: number } | null = null;
  /** Fast speech-state resolver for continuations and corrections */
  private speechState: ScriptureSpeechState = createScriptureSpeechState();

  /** Preload Bible data and embeddings to avoid first-call latency */
  private bibleDataLoadPromise: Promise<void> | null = null;
  private embeddingsLoadPromise: Promise<void> | null = null;

  /**
   * Warm the small, frequently-used Bible lookup data. The semantic index is
   * intentionally opt-in because its raw KJV embedding asset is very large;
   * loading it while the microphone starts creates a needless memory spike on
   * lower-RAM laptops.
   */
  async preload(options: { includeEmbeddings?: boolean } = {}): Promise<void> {
    // The quote index is small and builds in under a second; start it first so the very first
    // sentence already gets suggestions.
    void warmQuoteIndex(this.translation);
    try {
      if (!this.bibleDataLoaded) {
        this.bibleDataLoadPromise ??= (async () => {
          const { preloadBibleSearch } = await loadBibleDataModule();
          await preloadBibleSearch(this.translation as "KJV");
          this.bibleDataLoaded = true;
        })().catch((error) => {
          this.bibleDataLoadPromise = null;
          throw error;
        });
        await this.bibleDataLoadPromise;
      }

      if (options.includeEmbeddings && !this.embeddingsLoadPromise) {
        this.embeddingsLoadPromise = loadBibleEmbeddingsModule()
          .then(({ loadBibleEmbeddings }) => loadBibleEmbeddings())
          .catch((error) => {
            this.embeddingsLoadPromise = null;
            throw error;
          });
      }
      if (this.embeddingsLoadPromise) await this.embeddingsLoadPromise;
    } catch (err) {
      console.warn("[ScriptureEngine] Preload failed:", err);
    }
  }

  reset(): void {
    this.context = createScriptureContext();
    this.finalizedChunks = [];
    this.interimChunk = null;
    this.processedRevisions.clear();
    this.nextChunkId = 0;
    this.recentEmissions.clear();
    this.cancelQuoteSearch();
    this.verseHistory = [];
    this.activeCandidate = null;
    this.speechState = createScriptureSpeechState();
  }

  /**
   * Decay the active candidate's score over time. Called on each quote search
   * cycle. If the score drops below MIN_DISPLAY_SCORE, the candidate expires.
   */
  private decayActiveCandidate(): void {
    if (!this.activeCandidate) return;
    this.activeCandidate.score *= CANDIDATE_DECAY_FACTOR;
    if (this.activeCandidate.score < MIN_DISPLAY_SCORE) {
      this.activeCandidate = null;
    }
  }

  /**
   * Process a transcript chunk. Runs non-blocking — returns immediately,
   * results are delivered via the returned promise which resolves in background.
   */
  async processChunk(text: string, isFinal: boolean): Promise<DetectionResult> {
    const handledReference = this.isReferenceSpeech(text);
    const result = await this.processChunkInner(text, isFinal);
    return { ...result, handledReference };
  }

  isReferenceSpeech(text: string): boolean {
    return parseScriptureIntent(text) !== null ||
      resolveScriptureSpeech(text, { ...this.speechState }) !== null ||
      isLikelyScriptureReferenceAttempt(text);
  }

  private async processChunkInner(text: string, isFinal: boolean): Promise<DetectionResult> {
    const trimmed = text.trim();
    if (!trimmed) return { matches: [], context: this.context };
    const now = Date.now();
    if (!isFinal) return { matches: [], context: this.context };
    const previousSpeechState = { ...this.speechState };
    const speechResolution = resolveScriptureSpeech(trimmed, this.speechState, now);
    if (speechResolution?.book && speechResolution.chapter === null && speechResolution.verse === null) {
      this.context = createScriptureContext();
    }

    // ── Intent parsing: handle BEFORE reference parsing ──
    // Fast (<1ms) structured command detection for navigation, open, etc.
    const intent = parseScriptureIntent(trimmed);

    // Apply translation commands once, when the ASR turn is final.
    if (intent?.type === "use-translation") {
      const intentResults = await this.resolveIntent(intent);
      return {
        matches: intentResults.map((candidate) => ({
          candidate,
          source: "reference" as const,
          confidence: candidate.confidence,
        })),
        context: this.context,
      };
    }

    // Other intents only on final
    if (intent && isFinal && !speechResolution?.isCorrection && !speechResolution?.isRelative) {
      const intentResults = await this.resolveIntent(intent);
      const active = this.context.stack[0];
      if (active) {
        this.speechState = { lastBook: active.book, lastChapter: active.chapter,
          lastVerse: active.verse, lastReferenceTimestamp: now };
      } else if (intentResults.length === 0) {
        this.speechState = previousSpeechState;
      }
      if (intentResults.length > 0) {
        const navOnly = intent.type === "open" && intent.navigationOnly === true;
        return {
          matches: intentResults.map((candidate) => ({
            candidate,
            source: "reference" as const,
            confidence: candidate.confidence,
            navigationOnly: navOnly || undefined,
          })),
          context: this.context,
        };
      }
      return { matches: [], context: this.context };
    }

    // ── Speech-state resolver: book/chapter continuations and corrections ──
    if (speechResolution) {
      const { book, chapter, verse } = speechResolution;
      const endVerse = speechResolution.endVerse ?? null;

      // Book-only and chapter-only entries update conversational state but do
      // not fabricate a verse 1 projection.
      if (!speechResolution.shouldProject || verse === null) {
        if (book && chapter !== null) {
          this.context = pushScriptureContext(this.context, book, chapter, null, false);
        }
        return { matches: [], context: this.context };
      }

      if (book && chapter !== null && verse !== null) {
        if (endVerse !== null && endVerse > verse) {
          const maxVerse = await getVerseCount(book, chapter, this.translation);
          if (maxVerse > 0) {
            const clampedEnd = Math.min(endVerse, maxVerse);
            const passageResults: ScriptureMatch[] = [];
            for (let v = verse; v <= clampedEnd; v++) {
              const candidate = await this.buildCandidate(book, chapter, v);
              if (candidate) {
                passageResults.push({
                  candidate,
                  source: "reference",
                  confidence: candidate.confidence,
                });
              }
            }
            if (passageResults.length > 0) {
              this.context = pushScriptureContext(this.context, book, chapter, verse, false);
              this.pushVerseHistory({ book, chapter, verse, label: passageResults[0].candidate.label,
                snippet: passageResults[0].candidate.snippet, timestamp: now });
              return { matches: passageResults, context: this.context };
            }
          }
        } else {
          const candidate = await this.buildCandidate(book, chapter, verse);
          if (candidate) {
            this.context = pushScriptureContext(this.context, book, chapter, verse, false);
            this.pushVerseHistory({ book, chapter, verse, label: candidate.label, snippet: candidate.snippet, timestamp: now });
            return {
              matches: [{
                candidate,
                source: "reference",
                confidence: candidate.confidence,
              }],
              context: this.context,
            };
          }
        }
      }
    }

    if (speechResolution?.shouldProject) this.speechState = previousSpeechState;

    // ── Chunk versioning ──

    let chunkId: number;
    let revisionId: number;

    if (isFinal) {
      // Finalized: new immutable chunk
      chunkId = this.nextChunkId++;
      revisionId = 0;
      this.interimChunk = null; // ASR finalized — interim is now stale
      this.finalizedChunks.push({
        text: trimmed,
        timestamp: now,
        finalized: true,
        chunkId,
      });
    } else {
      // Interim: ASR revision of the same stream position
      if (this.interimChunk) {
        chunkId = this.interimChunk.chunkId;
        revisionId = (this.processedRevisions.get(chunkId) ?? -1) + 1;
        this.interimChunk.text = trimmed;
        this.interimChunk.timestamp = now;
      } else {
        chunkId = this.nextChunkId++;
        revisionId = 0;
        this.interimChunk = {
          text: trimmed,
          timestamp: now,
          finalized: false,
          chunkId,
        };
      }
    }

    // ── Revision guard: skip if already processed this revision ──

    const lastProcessed = this.processedRevisions.get(chunkId) ?? -1;
    if (revisionId <= lastProcessed) {
      return { matches: [], context: this.context };
    }
    this.processedRevisions.set(chunkId, revisionId);

    // ── Prune old data ──

    const quoteCutoff = now - QUOTE_WINDOW_MS;
    this.finalizedChunks = this.finalizedChunks.filter((c) => c.timestamp >= quoteCutoff);

    const decayCutoff = now - CONTEXT_DECAY_MS;
    this.context = {
      stack: this.context.stack.filter((e) => e.timestamp >= decayCutoff),
    };

    // Prune old emissions
    for (const [key, record] of this.recentEmissions) {
      if (now - record.timestamp > DEDUP_WINDOW_MS) this.recentEmissions.delete(key);
    }

    // ── Stage 1: Fast reference parser (multiple candidates for jammed numbers) ──

    const allParsed = parseScriptureReferenceAll(trimmed);
    if (allParsed.length > 0) {
      const matches: ScriptureMatch[] = [];

      for (const parsed of allParsed) {
        const resolved = resolveWithContext(parsed, this.context);
        if (resolved && resolved.book) {
          // Early bounds check — skip invalid references before async work
          const maxCh = await getChapterCount(resolved.book, this.translation);
          if (maxCh === 0 || resolved.chapter < 1 || resolved.chapter > maxCh) continue;
          if (resolved.verse != null) {
            const maxV = await getVerseCount(resolved.book, resolved.chapter, this.translation);
            if (maxV === 0 || resolved.verse < 1 || resolved.verse > maxV) continue;
          }

          const refKey = `${resolved.book}:${resolved.chapter}:${resolved.verse ?? ""}`;

          // State-delta dedup
          const shouldEmit = this.shouldEmit(refKey, now);

          if (shouldEmit) {
            const stateHash = this.computeStateHash();
            this.recentEmissions.set(refKey, { refKey, timestamp: now, stateHash });

            const candidate = await this.buildCandidate(
              resolved.book,
              resolved.chapter,
              resolved.verse,
            );

            if (candidate) {
              matches.push({ candidate, source: parsed.isRelative ? "context" : "reference", confidence: candidate.confidence });
            }
          }
        }
      }

      if (matches.length > 0) {
        // Update context with the first (most likely) match
        const bestParsed = allParsed[0];
        const bestResolved = resolveWithContext(bestParsed, this.context);
        if (bestResolved) {
          this.context = pushScriptureContext(
            this.context,
            bestResolved.book,
            bestResolved.chapter,
            bestResolved.verse,
            bestParsed.isRelative,
          );
        }

        // Log if ASR produced a different book than what's bound in context
        if (this.context.stack.length > 1) {
          const prevBook = this.context.stack[1]?.book;
          const newBook = this.context.stack[0]?.book;
          if (prevBook && newBook && prevBook !== newBook) {
          }
        }

        // Record in verse history (first match)
        const bestCandidate = matches[0].candidate;
        this.pushVerseHistory({
          book: bestCandidate.book,
          chapter: bestCandidate.chapter,
          verse: bestCandidate.verse,
          label: bestCandidate.label,
          snippet: bestCandidate.snippet,
          timestamp: now,
        });

        return { matches, context: this.context };
      }
    }

    return { matches: [], context: this.context };
  }

  /**
   * State-delta dedup: emit if the interpretation state has changed.
   *
   * State is defined by:
   *   - Structural hash (chunkIds + context stack entries)
   *   - NOT raw text (deterministic across identical inputs)
   *
   * Allow re-emission if ANY of:
   *   1. Never emitted this ref
   *   2. TTL expired (15s)
   *   3. State hash changed (new speech or context shift)
   */
  private shouldEmit(refKey: string, now: number): boolean {
    const record = this.recentEmissions.get(refKey);
    if (!record) return true;

    if (now - record.timestamp > DEDUP_WINDOW_MS) return true;

    const currentHash = this.computeStateHash();
    if (currentHash !== record.stateHash) return true;

    return false;
  }

  /**
   * Deterministic structural hash.
   * Hashes chunkIds + context stack entries — NOT raw text.
   * This ensures identical inputs produce identical hashes.
   */
  private computeStateHash(): string {
    const chunkIds = this.finalizedChunks
      .map((c) => `${c.chunkId}`)
      .join(",");
    const contextSig = this.context.stack
      .map((e) => `${e.book}:${e.chapter}:${e.verse ?? ""}`)
      .join("|");
    return `${chunkIds}#${contextSig}`;
  }

  /**
   * Get the currently bound book from context.
   * Returns the most recent book in the context stack, or null.
   */
  getBoundPassage(): ScriptureSearchScope | null {
    const now = Date.now();
    const fullRef = this.context.stack.find(
      (entry) => entry.chapter !== null && now - entry.timestamp <= CONTEXT_DECAY_MS,
    );
    if (!fullRef || fullRef.chapter === null) return null;
    return {
      book: fullRef.book,
      chapter: fullRef.chapter,
      verse: fullRef.verse,
    };
  }

  getBoundBook(): string | null {
    return this.getBoundPassage()?.book ?? null;
  }

  /**
   * Run quote search on the time-based speech window.
   * If a passage is active, filters candidates to that chapter.
   * Uses backpressure: only one search at a time.
   */
  async searchQuotes(scope?: QuoteSearchScope, options: QuoteSearchOptions = {}): Promise<ScriptureMatch[]> {
    this.cancelQuoteSearch();
    this.quoteAbortController = new AbortController();
    const signal = this.quoteAbortController.signal;

    const now = Date.now();
    const cutoff = now - QUOTE_WINDOW_MS;
    const windowText = this.finalizedChunks
      .filter((c) => c.timestamp >= cutoff)
      .map((c) => c.text)
      .join(" ");
    const interimText = this.interimChunk?.text ?? "";
    const searchInput = interimText ? `${windowText} ${interimText}`.trim() : windowText;

    const searchScope = normalizeQuoteSearchScope(scope) ?? this.getBoundPassage() ?? undefined;
    const matches = await this.runQuoteSearchPipeline(searchInput, searchScope, signal, options);
    if (signal.aborted) return [];
    this.bindSearchMatch(matches, analyzeQuoteQuery(searchInput));
    return matches;
  }

  /**
   * Run quote search with caller-provided text (sentence-based).
   * Bypasses the time-based finalizedChunks window — the caller controls
   * what text is searched. This is the primary search path for the
   * sentence-detection architecture.
   */
  async searchQuotesWithText(
    text: string,
    scope?: QuoteSearchScope,
    options: QuoteSearchOptions = {},
  ): Promise<ScriptureMatch[]> {
    this.cancelQuoteSearch();
    this.quoteAbortController = new AbortController();
    const signal = this.quoteAbortController.signal;

    const searchInput = text.trim();
    const searchScope = normalizeQuoteSearchScope(scope) ?? this.getBoundPassage() ?? undefined;
    let matches = await this.runQuoteSearchPipeline(searchInput, searchScope, signal, options);
    if (signal.aborted) return [];
    let matchedInput = searchInput;
    if (options.contextText && (!matches[0] || matches[0].confidence < 0.9 || matches[0].candidate.source === "fuzzy")) {
      const combined = `${options.contextText} ${searchInput}`.split(/\s+/).slice(-60).join(" ");
      const completed = await this.runQuoteSearchPipeline(combined, searchScope, signal, options);
      if (signal.aborted) return [];
      if (completed[0] && (!matches[0] || completed[0].confidence > matches[0].confidence ||
        (matches[0].candidate.source === "fuzzy" && completed[0].candidate.source !== "fuzzy" && completed[0].confidence >= 0.9))) {
        matches = completed;
        matchedInput = combined;
      }
    }
    this.bindSearchMatch(matches, analyzeQuoteQuery(matchedInput));
    return matches;
  }

  /**
   * Shared search pipeline — fast keyword → verse alias → fuzzy → embedding.
   * Accepts pre-built searchInput so callers control the text window.
   */
  private async runQuoteSearchPipeline(
    searchInput: string,
    searchScope: { book: string; chapter?: number } | undefined,
    signal: AbortSignal,
    options: QuoteSearchOptions = {},
  ): Promise<ScriptureMatch[]> {
    if (searchInput.length < MIN_QUOTE_LENGTH || signal.aborted) return [];

    // 1) Plain keyword index: a few milliseconds, understands paraphrase and King James wording.
    const mode: QuoteSearchMode = options.mode === "closest" ? "closest" : "strict";
    let indexed: IndexSearchOutcome | null = null;
    try {
      indexed = await this.searchQuoteIndexMatches(searchInput, searchScope, mode);
    } catch (err) {
      console.warn("[ScriptureEngine] Quote index search failed:", err);
    }
    if (signal.aborted) return [];

    // 2) Exact-quote / alias / lexical search (slower, and the one that recognises a verse read out
    //    word for word with a confident match). When it finds a few verses, those are the answer;
    //    when it finds little or nothing, the index's suggestions fill in.
    const legacy = await this.runExactQuoteSearchPipeline(searchInput, searchScope, signal, options);
    if (signal.aborted) return [];
    // Live (strict) searches stay conservative: the index only speaks when the exact-quote search is
    // silent and the index match is strong. The final-sentence ("closest") search is the generous one.
    if (mode === "strict") return legacy.length > 0 ? legacy : (indexed?.matches ?? []);
    if (legacy.length >= INDEX_FILL_BELOW) return legacy;
    return mergeQuoteMatches(legacy, indexed?.matches ?? []);
  }

  /**
   * Fast suggestions for a spoken sentence: only the keyword index, no waiting for the slower
   * exact-quote search. Returns [] while the index is still building.
   */
  async quickQuoteSuggestions(
    text: string,
    scope?: QuoteSearchScope,
    mode: QuoteSearchMode = "closest",
  ): Promise<ScriptureMatch[]> {
    const searchInput = text.trim();
    if (searchInput.length < MIN_QUOTE_LENGTH) return [];
    const searchScope = normalizeQuoteSearchScope(scope) ?? this.getBoundPassage() ?? undefined;
    try {
      return (await this.searchQuoteIndexMatches(searchInput, searchScope, mode))?.matches ?? [];
    } catch (err) {
      console.warn("[ScriptureEngine] Quick suggestions failed:", err);
      return [];
    }
  }

  /** Search the keyword index and turn the hits into suggestions. */
  private async searchQuoteIndexMatches(
    searchInput: string,
    searchScope: { book: string; chapter?: number } | undefined,
    mode: QuoteSearchMode,
  ): Promise<IndexSearchOutcome | null> {
    let index = getReadyQuoteIndex(this.translation);
    if (!index) {
      index = await Promise.race([
        warmQuoteIndex(this.translation),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), INDEX_BUILD_WAIT_MS)),
      ]);
    }
    if (!index) return null;

    const pool: QuoteHit[] = searchQuoteIndex(index, searchInput, { limit: INDEX_SUGGESTION_LIMIT + 2 });
    if (searchScope) {
      // The chapter being preached from gets a small lift; a verse elsewhere must be a clearly better fit.
      const inScope = searchQuoteIndex(index, searchInput, { limit: INDEX_SUGGESTION_LIMIT, scope: searchScope });
      const seen = new Set(inScope.map((hit) => `${hit.book}|${hit.chapter}|${hit.verse}`));
      for (const hit of inScope) hit.score = Math.min(1, hit.score + 0.08);
      const outside = pool.filter(
        (hit) => !seen.has(`${hit.book}|${hit.chapter}|${hit.verse}`) &&
          !matchesQuoteSearchScope(hit.book, hit.chapter, searchScope) && hit.score >= 0.6,
      );
      pool.length = 0;
      pool.push(...inScope, ...outside);
      pool.sort((a, b) => b.score - a.score);
    }

    // Live (strict) searches only trust a strong match built on several matched words.
    const hits = pool
      .filter((hit) => mode === "closest" || (hit.score >= STRICT_INDEX_MIN_SCORE && hit.matched.length >= 3))
      .slice(0, INDEX_SUGGESTION_LIMIT);
    if (hits.length === 0) return { matches: [], top: null, verbatimLikely: false };

    const matches: ScriptureMatch[] = hits.map((hit) => {
      const confidence = quoteHitConfidence(hit);
      return {
        candidate: {
          book: hit.book,
          chapter: hit.chapter,
          verse: hit.verse,
          translation: this.translation,
          label: `${hit.book} ${hit.chapter}:${hit.verse}`,
          snippet: hit.text,
          confidence,
          // "fuzzy" = "Possible match": shown as a suggestion, never projected automatically.
          source: "fuzzy" as const,
        },
        source: "quote" as const,
        confidence,
      };
    });
    return { matches, top: hits[0], verbatimLikely: isVerbatimLikely(hits[0]) };
  }

  /**
   * Exact-quote search: fast keyword → lexical corpus search → verse alias → fuzzy.
   * Slower than the index (hundreds of ms) but it is the one that recognises verses read out in full.
   */
  private async runExactQuoteSearchPipeline(
    searchInput: string,
    searchScope: { book: string; chapter?: number } | undefined,
    signal: AbortSignal,
    options: QuoteSearchOptions = {},
  ): Promise<ScriptureMatch[]> {

    if (searchInput.length < MIN_QUOTE_LENGTH) return [];
    if (signal.aborted) return [];

    const useClosestFallback = options.mode === "closest";

    // Decay any active candidate from a previous search cycle
    this.decayActiveCandidate();
    const quoteProfile = analyzeQuoteQuery(searchInput);
    const quoteThresholds = getQuoteSearchThresholds(quoteProfile);
    let rankedSearchResults: RankedBibleSearchResult[] = [];
    const hasEnoughDistinctiveText = new Set(quoteProfile.contentTokens).size >= 2;
    const canUseClosestFallback =
      useClosestFallback &&
      quoteProfile.tokens.length >= 3 &&
      quoteProfile.contentTokens.length > 0;

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 0: Fast O(1) keyword shortcut (<1ms)
    // Instant resolution for high-confidence core scripture phrases
    // ────────────────────────────────────────────────────────────────────────
    const earlyFastMatch = fastKeywordMatch(searchInput);
    if (earlyFastMatch && earlyFastMatch.confidence >= 0.85) {
      const candidate = await this.buildCandidate(earlyFastMatch.book, earlyFastMatch.chapter, earlyFastMatch.verse);
      if (candidate) {
        return [{
          candidate: { ...candidate, source: "keyword" },
          source: "quote",
          confidence: earlyFastMatch.confidence,
        }];
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 1: Lexical Bible corpus search
    // Search the actual Bible text before curated shortcuts. Strong corpus
    // matches may override stale passage context; weak closest matches remain
    // scoped so ordinary sermon language does not jump books.
    // ────────────────────────────────────────────────────────────────────────

    if (hasEnoughDistinctiveText || canUseClosestFallback) {
      try {
        const { searchBibleRanked } = await loadBibleDataModule();
        if (signal.aborted) return [];

        const globalRankedResults = await searchBibleRanked(
          searchInput,
          this.translation as "KJV",
          5,
          undefined,
          useClosestFallback ? CLOSEST_QUOTE_SEARCH_MIN_SCORE : undefined,
        );
        rankedSearchResults = globalRankedResults;
        if (signal.aborted) return [];

        if (hasStrongRankedSearchWinner(globalRankedResults, quoteThresholds)) {
          const best = globalRankedResults[0];
          if (
            matchesQuoteSearchScope(best.book, best.chapter, searchScope) ||
            canStrongQuoteLeaveScope(best.score, quoteProfile)
          ) {
            return buildLexicalQuoteMatches(globalRankedResults, this.translation);
          }
        }

        if (searchScope) {
          const scopedRankedResults = await searchBibleRanked(
            searchInput,
            this.translation as "KJV",
            5,
            searchScope,
            useClosestFallback ? CLOSEST_QUOTE_SEARCH_MIN_SCORE : undefined,
          );
          rankedSearchResults = scopedRankedResults.length > 0 ? scopedRankedResults : globalRankedResults;
          if (signal.aborted) return [];

          if (hasStrongRankedSearchWinner(scopedRankedResults, quoteThresholds)) {
            return buildLexicalQuoteMatches(scopedRankedResults, this.translation);
          }
        }

        // When the words fit several passages, show those actual passages
        // immediately. Loading a semantic model cannot make a shared phrase
        // uniquely identify one verse, and must not delay useful suggestions.
        if ((canUseClosestFallback && rankedSearchResults[0]?.score >= 0.72) ||
            (hasEnoughDistinctiveText && rankedSearchResults[0]?.score >= 0.98)) {
          return this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope);
        }
      } catch (err) {
        console.warn("[ScriptureEngine] Lexical search failed:", err);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 2: Fast keyword match (<1ms, no LLM)
    // O(1) lookup for hardcoded common scriptures. Strong deterministic
    // matches may override stale passage context; weak fallbacks stay scoped.
    // ────────────────────────────────────────────────────────────────────────
    const fastMatch = fastKeywordMatch(searchInput);
    // Generic speech ("god be with") can hit a verse's keyword list; only a confident match, or one
    // backed by several distinctive words, is trusted.
    if (
      fastMatch &&
      (hasEnoughDistinctiveText || fastMatch.confidence >= 0.85) &&
      (
        matchesQuoteSearchScope(fastMatch.book, fastMatch.chapter, searchScope) ||
        canStrongQuoteLeaveScope(fastMatch.confidence, quoteProfile)
      )
    ) {
      const verseData = await getVerse(fastMatch.book, fastMatch.chapter, fastMatch.verse, this.translation as "KJV").catch(() => null);
      if (!verseData?.text) return [];
      const snippet = verseData.text;
      const label = `${fastMatch.book} ${fastMatch.chapter}:${fastMatch.verse}`;
      return [{
        candidate: {
          book: fastMatch.book,
          chapter: fastMatch.chapter,
          verse: fastMatch.verse,
          translation: this.translation,
          label,
          snippet,
          confidence: fastMatch.confidence,
          source: "keyword",
        },
        source: "quote",
        confidence: fastMatch.confidence,
      }];
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 3: Verse alias fast path (<1ms, no embedding)
    // Direct phrase→reference lookup for universally known quotations.
    // Strong aliases may override stale passage context; weaker stages below
    // stay scoped to avoid turning sermon filler into a random reference.
    // ────────────────────────────────────────────────────────────────────────
    try {
      const { matchVerseAlias } = await loadScriptureRerankerModule();
      const aliasRef = matchVerseAlias(searchInput);
      if (aliasRef) {
        const { getVerse: getV } = await loadBibleDataModule();
        const parsed = aliasRef.match(/^(.+?)\s+(\d+):(\d+)$/);
        if (
          parsed &&
          (
            matchesQuoteSearchScope(parsed[1], +parsed[2], searchScope) ||
            canStrongQuoteLeaveScope(0.95, quoteProfile)
          )
        ) {
          const [, book, ch, vs] = parsed;
          const verseData = await getV(book, +ch, +vs, this.translation as "KJV").catch(() => null);
          if (!verseData?.text) return [];
          return [{
            candidate: {
              book,
              chapter: +ch,
              verse: +vs,
              translation: this.translation,
              label: aliasRef,
              snippet: verseData.text,
              confidence: 0.95,
              source: "alias",
            },
            source: "quote" as const,
            confidence: 0.95,
          }];
        }
      }
    } catch (err) {
      console.warn("[ScriptureEngine] Verse alias lookup failed:", err);
    }

    if (!hasEnoughDistinctiveText && !canUseClosestFallback) {
      return [];
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 4: Semantic embedding search (PRIMARY discovery engine)
    // This is the core quote-retrieval mechanism for paraphrases that do not
    // have a strong lexical match. With an active passage, only embedding
    // results from that passage are eligible. A new book must be named.
    //
    // Parameters:
    //   topK = 100  — large candidate pool so the reranker has room to work
    //   minScore = 0.15 — permissive threshold; the reranker handles precision
    // ────────────────────────────────────────────────────────────────────────

    if (ENABLE_SEMANTIC_QUOTE_SEARCH && !quoteThresholds.allowSemanticSearch) {
      return useClosestFallback
        ? this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope)
        : [];
    }

    if (ENABLE_SEMANTIC_QUOTE_SEARCH) try {
      const { hasEmbeddings, loadBibleEmbeddings, searchByEmbedding } = await loadBibleEmbeddingsModule();
      const { rerankCandidates } = await loadScriptureRerankerModule();
      if (signal.aborted) return [];

      // Semantic search is the first operation that needs the large
      // embedding index. Keep it out of microphone/startup preload, but load
      // it once here when the operator actually asks for semantic matching.
      if (!hasEmbeddings()) await loadBibleEmbeddings();
      if (signal.aborted) return [];

      const embeddingsReady = hasEmbeddings();
      if (!embeddingsReady) {
      } else {
        // Tighter candidate pool: 75 results at min cosine similarity 0.25.
        // Previous (100, 0.15) flooded the reranker with noise — irrelevant
        // verses with 0.16 similarity diluted the results and confused
        // the reranker's ability to pick a clear winner.
        const embeddingResults = await searchByEmbedding(searchInput, 75, 0.25);
        if (signal.aborted) return [];

        const scopedEmbeddingResults = searchScope
          ? embeddingResults.filter((result) =>
            matchesQuoteSearchScope(result.book, result.chapter, searchScope),
          )
          : embeddingResults;

        if (scopedEmbeddingResults.length > 0) {
          const reranked = rerankCandidates(searchInput, scopedEmbeddingResults, null);

          if (reranked.length > 0) {
            const best = reranked[0];
            const runnerUp = reranked.length > 1 ? reranked[1] : null;

            // ── Score gap validation ──
            // Require minimum winner score and clear separation from runner-up.
            // Without this, a weak 0.28 winner with 0.26 runner-up both
            // pass — the system can't tell them apart and shows garbage.
            const hasMinWinnerScore = best.finalScore >= quoteThresholds.embeddingMinScore;
            const hasClearGap = runnerUp
              ? (best.finalScore >= 0.95 && isSupportingPassageResult(best, runnerUp)) || (best.finalScore - runnerUp.finalScore) >= quoteThresholds.embeddingMinGap
              : true;

            if (!hasMinWinnerScore || !hasClearGap) {
              // Don't return — fall through to fuzzy stage
            } else {
              const matches = await Promise.all(reranked.slice(0, 10).map(async (result) => ({
                candidate: await resolveScriptureProjection({
                  book: result.book,
                  chapter: result.chapter,
                  verse: result.verse,
                  translation: this.translation,
                  label: result.reference,
                  snippet: result.text,
                  confidence: result.finalScore,
                  source: "embedding",
                }),
                source: "quote" as const,
                confidence: result.finalScore,
              })));
              return signal.aborted ? [] : matches;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[ScriptureEngine] Embedding search failed:", err);
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 5: Fuzzy Bible search (fallback for STT errors)
    // Handles speech-recognition misrecognitions when embeddings are
    // unavailable or returned no results.
    // ────────────────────────────────────────────────────────────────────────
    if (!quoteThresholds.allowFuzzySearch) {
      return useClosestFallback
        ? this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope)
        : [];
    }

    try {
      if (signal.aborted) return [];

      // Stage 3 already performed the same ranked corpus lookup. Reuse it
      // instead of scanning the Bible a second time for the fuzzy fallback.
      const fuzzyResults = rankedSearchResults;
      if (signal.aborted || fuzzyResults.length === 0) {
        return useClosestFallback
          ? this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope)
          : [];
      }

      const best = fuzzyResults[0];
      const runnerUp = fuzzyResults[1];
      const hasMinimumScore = best.score >= MIN_FUZZY_QUOTE_SCORE;
      const hasClearGap = !runnerUp ||
        (best.score >= 0.95 && isSupportingPassageResult(best, runnerUp)) ||
        (best.score - runnerUp.score) >= MIN_FUZZY_QUOTE_GAP;
      if (!hasMinimumScore || !hasClearGap) {
        return useClosestFallback
          ? this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope)
          : [];
      }

      return [{
        candidate: {
          book: best.book,
          chapter: best.chapter,
          verse: best.verse,
          endVerse: best.endVerse,
          translation: this.translation,
          label: `${best.book} ${best.chapter}:${best.verse}${best.endVerse ? `-${best.endVerse}` : ""}`,
          snippet: best.snippet || best.text,
          confidence: best.score,
          source: "fuzzy",
        },
        source: "quote" as const,
        confidence: best.score,
      }];
    } catch (err) {
      console.warn("[ScriptureEngine] Fuzzy Bible search failed:", err);
    }

    return useClosestFallback
      ? this.buildClosestQuoteMatches(rankedSearchResults, quoteProfile, searchScope)
      : [];
  }

  private buildClosestQuoteMatches(
    rankedResults: RankedBibleSearchResult[],
    profile: QuoteQueryProfile,
    searchScope: { book: string; chapter?: number } | undefined,
  ): ScriptureMatch[] {
    if (rankedResults.length === 0) return [];

    const best = rankedResults[0];
    const minScore = searchScope ? MIN_CLOSEST_QUOTE_SCORE : MIN_UNSCOPED_CLOSEST_QUOTE_SCORE;
    const hasUsableContext =
      searchScope !== undefined ||
      profile.contentTokens.length > 0 ||
      best.score >= 0.58;
    if (!hasUsableContext || best.score < minScore) return [];

    return rankedResults.slice(0, 5).map((result) => ({
      candidate: {
        book: result.book,
        chapter: result.chapter,
        verse: result.verse,
        endVerse: result.endVerse,
        translation: this.translation,
        label: `${result.book} ${result.chapter}:${result.verse}${result.endVerse ? `-${result.endVerse}` : ""}`,
        snippet: result.snippet || result.text,
        confidence: Math.min(1, result.score),
        source: "fuzzy",
      },
      source: "quote" as const,
      confidence: Math.min(1, result.score),
    }));
  }

  cancelQuoteSearchPublic(): void {
    this.cancelQuoteSearch();
  }

  getDiagnosticCounts(): {
    finalizedChunkCount: number;
    recentEmissionCount: number;
    verseHistoryCount: number;
  } {
    return {
      finalizedChunkCount: this.finalizedChunks.length,
      recentEmissionCount: this.recentEmissions.size,
      verseHistoryCount: this.verseHistory.length,
    };
  }

  private cancelQuoteSearch(): void {
    if (this.quoteAbortController) {
      this.quoteAbortController.abort();
      this.quoteAbortController = null;
    }
  }

  // ── Verse history & navigation ─────────────────────────────────────────

  private pushVerseHistory(entry: VerseHistoryEntry): void {
    this.verseHistory.push(entry);
    // Cap at 50 entries
    if (this.verseHistory.length > 50) {
      this.verseHistory = this.verseHistory.slice(-50);
    }
  }

  /**
   * Promote a confident quote result to the active sermon passage. This lets
   * the next spoken verse stay in the same chapter even when the first verse
   * was found from its words rather than from an explicit reference.
   */
  private bindSearchMatch(matches: ScriptureMatch[], profile: QuoteQueryProfile): void {
    const candidate = matches[0]?.candidate;
    if (!candidate) return;

    // Quote matches are provisional. Only a highly confident result, or an
    // explicit alias, may change the chapter used by later spoken numbers.
    // This prevents ordinary sermon language from becoming false context.
    if (
      candidate.source === "fuzzy" ||
      candidate.confidence < 0.90 ||
      (candidate.source !== "alias" && profile.strongAnchors === 0 &&
        !(candidate.confidence >= 0.95 && new Set(profile.contentTokens).size >= 3))
    ) {
      return;
    }

    this.speechState = { lastBook: candidate.book, lastChapter: candidate.chapter,
      lastVerse: candidate.verse, lastReferenceTimestamp: Date.now() };
    const current = this.getCurrentVerseRef();
    if (
      !current ||
      normalizeBookForScope(current.book) !== normalizeBookForScope(candidate.book) ||
      current.chapter !== candidate.chapter ||
      current.verse !== candidate.verse
    ) {
      this.pushVerseHistory({
        book: candidate.book,
        chapter: candidate.chapter,
        verse: candidate.verse,
        label: candidate.label,
        snippet: candidate.snippet,
        timestamp: Date.now(),
      });
    }

    this.context = pushScriptureContext(
      this.context,
      candidate.book,
      candidate.chapter,
      candidate.verse,
      true,
    );
  }

  /**
   * Resolve a structured ScriptureIntent into candidates.
   * Handles all navigation commands: open, next/prev verse, next/prev chapter, range, set-verse/chapter.
   * Returns array of candidates (multiple for ambiguous references like "romans 11").
   */
  private async resolveIntent(intent: ScriptureIntent): Promise<VoiceBibleCandidate[]> {
    if (!intent) return [];

    switch (intent.type) {
      case "open": {
        // Validate book exists
        const maxCh = await getChapterCount(intent.book, this.translation);
        if (maxCh === 0) return []; // Invalid book

        // If multiple candidates provided (ambiguous reference), validate and return all valid ones
        if (intent.candidates && intent.candidates.length > 1) {
          const validCandidates: Array<{ candidate: VoiceBibleCandidate; index: number }> = [];
          for (let i = 0; i < intent.candidates.length; i++) {
            const c = intent.candidates[i];
            if (c.chapter > maxCh) continue; // Skip invalid chapters
            const maxVerse = await getVerseCount(intent.book, c.chapter, this.translation);
            if (maxVerse === 0) continue; // Skip invalid chapter
            if (c.verse !== undefined && c.verse > maxVerse) continue; // Skip invalid verse
            const candidate = await this.buildCandidate(intent.book, c.chapter, c.verse ?? null);
            if (candidate) {
              // Keep original order from parser (chapter:verse splits first)
              validCandidates.push({ candidate, index: i });
            }
          }
          if (validCandidates.length > 0) {
            // Sort by original order (from parser) — chapter:verse splits come first
            validCandidates.sort((a, b) => a.index - b.index);
            const sortedCandidates = validCandidates.map((v) => v.candidate);
            // Update context with the first (most likely) candidate
            const primary = sortedCandidates[0];
            this.pushVerseHistory({
              book: primary.book,
              chapter: primary.chapter,
              verse: primary.verse,
              label: primary.label,
              snippet: primary.snippet,
              timestamp: Date.now(),
            });
            this.context = pushScriptureContext(this.context, primary.book, primary.chapter, primary.verse, false);
            return sortedCandidates;
          }
          return [];
        }

        // Single candidate — validate and return
        if (intent.chapter > maxCh) return []; // Chapter exceeds max
        if (intent.verse !== undefined) {
          const maxVerse = await getVerseCount(intent.book, intent.chapter, this.translation);
          if (maxVerse === 0) return []; // Invalid chapter
          if (intent.verse > maxVerse) return []; // Verse exceeds max
        }

        if (intent.navigationOnly === true && intent.verse === undefined && intent.endVerse === undefined) {
          this.context = pushScriptureContext(this.context, intent.book, intent.chapter, null, false);
          return [];
        }

        // Range: generate multiple candidates for verse range
        if (intent.endVerse !== undefined && intent.verse !== undefined && intent.endVerse > intent.verse) {
          const maxVerse = await getVerseCount(intent.book, intent.chapter, this.translation);
          const clampedEnd = Math.min(intent.endVerse, maxVerse);
          const rangeCandidates: VoiceBibleCandidate[] = [];
          for (let v = intent.verse; v <= clampedEnd; v++) {
            const c = await this.buildCandidate(intent.book, intent.chapter, v);
            if (c) rangeCandidates.push(c);
          }
          if (rangeCandidates.length > 0) {
            const primary = rangeCandidates[0];
            this.pushVerseHistory({
              book: primary.book,
              chapter: primary.chapter,
              verse: primary.verse,
              label: primary.label,
              snippet: primary.snippet,
              timestamp: Date.now(),
            });
            this.context = pushScriptureContext(this.context, primary.book, primary.chapter, primary.verse, false);
            return rangeCandidates;
          }
          return [];
        }

        const candidate = await this.buildCandidate(intent.book, intent.chapter, intent.verse ?? null);
        if (candidate) {
          this.pushVerseHistory({
            book: intent.book,
            chapter: intent.chapter,
            verse: intent.verse ?? 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, intent.book, intent.chapter, intent.verse ?? null, false);
          return [candidate];
        }
        return [];
      }

      case "next-verse": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const result = await this.navigateRelative(current.book, current.chapter, current.verse, intent.count, "forward");
        return result ? [result] : [];
      }

      case "prev-verse": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const result = await this.navigateRelative(current.book, current.chapter, current.verse, -intent.count, "backward");
        return result ? [result] : [];
      }

      case "next-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const maxCh = await getChapterCount(current.book, this.translation);
        const nextCh = current.chapter + intent.count;
        if (nextCh > maxCh) return []; // Exceeds last chapter
        const candidate = await this.buildCandidate(current.book, nextCh, 1);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: nextCh,
            verse: 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, nextCh, 1, true);
          return [candidate];
        }
        return [];
      }

      case "prev-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const prevCh = current.chapter - intent.count;
        if (prevCh < 1) return []; // Before first chapter
        const candidate = await this.buildCandidate(current.book, prevCh, 1);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: prevCh,
            verse: 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, prevCh, 1, true);
          return [candidate];
        }
        return [];
      }

      case "set-verse": {
        const current = this.getCurrentVerseRef();
        if (!current) return []; // No context — cannot resolve relative verse

        // Validate verse range
        const maxVerse = await getVerseCount(current.book, current.chapter, this.translation);
        if (maxVerse === 0) return []; // Invalid chapter
        if (intent.verse > maxVerse) return []; // Verse exceeds max — DO NOT resolve

        // Range: generate multiple candidates for verse range
        if (intent.endVerse !== undefined && intent.endVerse > intent.verse) {
          const clampedEnd = Math.min(intent.endVerse, maxVerse);
          const rangeCandidates: VoiceBibleCandidate[] = [];
          for (let v = intent.verse; v <= clampedEnd; v++) {
            const c = await this.buildCandidate(current.book, current.chapter, v);
            if (c) rangeCandidates.push(c);
          }
          if (rangeCandidates.length > 0) {
            const primary = rangeCandidates[0];
            this.pushVerseHistory({
              book: current.book,
              chapter: current.chapter,
              verse: primary.verse,
              label: primary.label,
              snippet: primary.snippet,
              timestamp: Date.now(),
            });
            this.context = pushScriptureContext(this.context, current.book, current.chapter, primary.verse, true);
            return rangeCandidates;
          }
          return [];
        }

        const candidate = await this.buildCandidate(current.book, current.chapter, intent.verse);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: current.chapter,
            verse: intent.verse,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, current.chapter, intent.verse, true);
          return [candidate];
        }
        return [];
      }

      case "set-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];

        // Validate chapter range
        const maxCh = await getChapterCount(current.book, this.translation);
        if (maxCh === 0) return []; // Invalid book
        if (intent.chapter > maxCh) return []; // Chapter exceeds max — DO NOT resolve

        const candidate = await this.buildCandidate(current.book, intent.chapter, 1);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: intent.chapter,
            verse: 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, intent.chapter, 1, true);
          return [candidate];
        }
        return [];
      }

      case "use-translation": {
        const prevTranslation = this.translation;
        try {
          // Try to preload the translation to verify it's available
          const { preloadTranslation } = await import("../bible/bibleData");
          await preloadTranslation(intent.translation as "KJV");
          this.translation = intent.translation;
        } catch (err) {
          // Translation not available — revert and notify
          this.translation = prevTranslation;
          console.warn(`[Intent] Translation "${intent.translation}" not available:`, err);
          // Return empty to indicate failure (UI could show a toast)
          return [];
        }
        // Return current verse with new translation
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const candidate = await this.buildCandidate(current.book, current.chapter, current.verse);
        return candidate ? [candidate] : [];
      }

      case "first-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        if (current.chapter === 1) return []; // Already at first chapter
        const candidate = await this.buildCandidate(current.book, 1, 1);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: 1,
            verse: 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, 1, 1, true);
          return [candidate];
        }
        return [];
      }

      case "last-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const maxCh = await getChapterCount(current.book, this.translation);
        if (maxCh === 0) return [];
        if (current.chapter === maxCh) return []; // Already at last chapter
        const candidate = await this.buildCandidate(current.book, maxCh, 1);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: maxCh,
            verse: 1,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, maxCh, 1, true);
          return [candidate];
        }
        return [];
      }

      case "middle-of-chapter": {
        const current = this.getCurrentVerseRef();
        if (!current) return [];
        const verseCount = await getVerseCount(current.book, current.chapter, this.translation);
        const middleVerse = Math.ceil(verseCount / 2);
        const candidate = await this.buildCandidate(current.book, current.chapter, middleVerse);
        if (candidate) {
          this.pushVerseHistory({
            book: current.book,
            chapter: current.chapter,
            verse: middleVerse,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, current.book, current.chapter, middleVerse, true);
          return [candidate];
        }
        return [];
      }

      case "return-to-passage": {
        // Return to the last referenced passage (from history)
        if (this.verseHistory.length === 0) return [];
        const lastEntry = this.verseHistory[this.verseHistory.length - 1];
        const candidate = await this.buildCandidate(lastEntry.book, lastEntry.chapter, lastEntry.verse);
        if (candidate) {
          this.pushVerseHistory({
            book: lastEntry.book,
            chapter: lastEntry.chapter,
            verse: lastEntry.verse,
            label: candidate.label,
            snippet: candidate.snippet,
            timestamp: Date.now(),
          });
          this.context = pushScriptureContext(this.context, lastEntry.book, lastEntry.chapter, lastEntry.verse, true);
          return [candidate];
        }
        return [];
      }

      default:
        return [];
    }
  }

  /**
   * Get the current verse reference from history or context.
   */
  private getCurrentVerseRef(): { book: string; chapter: number; verse: number } | null {
    const fullRef = this.context.stack[0];
    if (fullRef && Date.now() - fullRef.timestamp <= CONTEXT_DECAY_MS) {
      return { book: fullRef.book, chapter: fullRef.chapter, verse: fullRef.verse ?? 1 };
    }
    return null;
  }

  /**
   * Navigate relative to current position (forward or backward N verses).
   * Handles cross-chapter overflow/underflow.
   */
  private async navigateRelative(
    book: string,
    chapter: number,
    verse: number,
    delta: number,
    _direction: "forward" | "backward",
  ): Promise<VoiceBibleCandidate | null> {
    let targetChapter = chapter;
    let targetVerse = verse + delta;

    // Resolve overflow/underflow
    while (true) {
      if (targetVerse < 1) {
        // Go to previous chapter
        targetChapter -= 1;
        if (targetChapter < 1) return null; // Already at Genesis 1:1
        const prevVerseCount = await getVerseCount(book, targetChapter, this.translation);
        targetVerse = prevVerseCount + targetVerse; // targetVerse is negative here
      } else {
        const verseCount = await getVerseCount(book, targetChapter, this.translation);
        if (targetVerse > verseCount) {
          // Go to next chapter
          targetVerse -= verseCount;
          targetChapter += 1;
          const maxCh = await getChapterCount(book, this.translation);
          if (targetChapter > maxCh) return null; // Past last chapter
        } else {
          break; // Valid verse
        }
      }
    }

    const candidate = await this.buildCandidate(book, targetChapter, targetVerse);
    if (candidate) {
      this.pushVerseHistory({
        book,
        chapter: targetChapter,
        verse: targetVerse,
        label: candidate.label,
        snippet: candidate.snippet,
        timestamp: Date.now(),
      });
      this.context = pushScriptureContext(this.context, book, targetChapter, targetVerse, true);
    }
    return candidate;
  }

  private async buildCandidate(
    book: string,
    chapter: number,
    verse: number | null,
  ): Promise<VoiceBibleCandidate | null> {
    try {
      // Validate bounds before building
      const maxCh = await getChapterCount(book, this.translation);
      if (maxCh === 0 || chapter < 1 || chapter > maxCh) return null;

      // Default to verse 1 when no verse specified
      const resolvedVerse = verse ?? 1;
      const maxVerse = await getVerseCount(book, chapter, this.translation);
      if (maxVerse === 0 || resolvedVerse < 1 || resolvedVerse > maxVerse) return null;

      const verseData = await getVerse(book, chapter, resolvedVerse, this.translation as "KJV");
      if (!verseData) return null;

      const snippet = verseData.text;
      const label = `${book} ${chapter}:${resolvedVerse}`;

      return {
        book,
        chapter,
        verse: resolvedVerse,
        translation: this.translation,
        label,
        snippet,
        confidence: verse === null ? 0.9 : 1.0,
        source: "keyword",
      };
    } catch {
      return null;
    }
  }

  getContext(): ScriptureContext {
    return { ...this.context };
  }
}
