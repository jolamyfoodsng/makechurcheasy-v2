/**
 * lmDockService.ts — Main-app service for LM Dock mic capture + AssemblyAI realtime STT.
 *
 * Uses Rust-side cpal audio capture (via Tauri commands) so mic access
 * works even in the Tauri WKWebView where navigator.mediaDevices is unavailable.
 *
 * The Tauri backend captures mic audio and streams short PCM frames to
 * AssemblyAI's realtime WebSocket API for live transcription turns.
 *
 * Transcript is stored as TranscriptEntry[] — each finalized speech segment
 * is its own line. Interim text is a separate active entry with a live indicator.
 */

import { dockBridge } from "./dockBridge";
import { getAdminControls } from "./desktopConfig";
import { ScriptureDetectionEngine } from "./scriptureEngine";
import { getOverlayBaseUrl } from "./overlayUrl";
import { getSettings as getMvSettings } from "../multiview/mvStore";
import type { VoiceBibleCandidate, TranscriptEntry, DetectionSpeed, LmDockTelemetry } from "./voiceBibleTypes";
import { DETECTION_SPEED_CONFIG } from "./voiceBibleTypes";
import { hasTauriInvoke, safeTauriInvoke, safeTauriListen, type TauriUnlisten } from "./tauriSafe";
import { getSpeechCredential } from "./speechCredential";

/**
 * Bible abbreviations and common honorifics/contractions that should not trigger sentence splits.
 */
const BIBLE_ABBREVIATIONS = new Set([
  "gen", "ex", "exod", "lev", "num", "deut", "josh", "judg", "ruth",
  "1sam", "2sam", "1kgs", "2kgs", "1chron", "2chron", "ezra", "neh", "esth",
  "job", "ps", "psa", "psalm", "psalms", "prov", "eccl", "song", "isa",
  "jer", "lam", "ezek", "dan", "hos", "joel", "amos", "obad", "jon",
  "mic", "nah", "hab", "zeph", "hag", "zech", "mal", "matt", "mk",
  "lk", "jn", "act", "acts", "rom", "1cor", "2cor", "gal", "eph",
  "phil", "col", "1thess", "2thess", "1tim", "2tim", "tit", "phlm",
  "heb", "jas", "1pet", "2pet", "1jn", "2jn", "3jn", "jude", "rev",
  "ch", "chap", "v", "vs", "dr", "mr", "mrs", "ms", "st", "etc", "eg", "ie",
  // Standalone forms (appear after number prefix: "1 Cor." → lastWord is "cor")
  "cor", "sam", "kgs", "kings", "chron", "thess", "tim", "pet",
]);

/**
 * Splits text into completed sentences based on punctuation (. ? ! \n).
 * Distinguishes sentence-ending punctuation from Bible abbreviations ("1 Cor.", "v. 5")
 * and decimal numbers ("3.16").
 *
 * When forceAll is false, trailing text without ending punctuation remains in `remaining`.
 * When forceAll is true (e.g. at end_of_turn), any non-empty trailing text is completed.
 */
export function splitSentenceBoundaries(
  text: string,
  forceAll = false,
): { completed: string[]; remaining: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { completed: [], remaining: "" };
  }

  const completed: string[] = [];
  const boundaryRegex = /([.?!]+|\n+)(?:\s+|$)/g;
  let currentStart = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryRegex.exec(trimmed)) !== null) {
    const punct = match[1];
    const matchIndex = match.index;
    const punctEndIndex = matchIndex + punct.length;

    // Guard: decimal numbers like 3.16 or 1.5
    if (punct === "." && matchIndex > 0 && punctEndIndex < trimmed.length) {
      const prevChar = trimmed[matchIndex - 1];
      const nextChar = trimmed[punctEndIndex];
      if (/\d/.test(prevChar) && /\d/.test(nextChar)) {
        continue;
      }
    }

    // Guard: abbreviations like "1 Cor." or "Gen." or "Dr."
    const precedingText = trimmed.slice(currentStart, matchIndex).trim();
    const precedingWords = precedingText.split(/\s+/);
    const lastWord = precedingWords[precedingWords.length - 1]?.toLowerCase().replace(/[^\w]/g, "");
    if (lastWord && BIBLE_ABBREVIATIONS.has(lastWord)) {
      continue;
    }

    const sentence = trimmed.slice(currentStart, punctEndIndex).trim();
    if (sentence) {
      completed.push(sentence);
      currentStart = match.index + match[0].length;
      lastEnd = currentStart;
    }
  }

  let remaining = trimmed.slice(lastEnd).trim();
  if (forceAll && remaining) {
    completed.push(remaining);
    remaining = "";
  }

  return { completed, remaining };
}

/**
 * Strips prefix text that has already been finalized into earlier lines in the active turn.
 * Uses exact match first, falling back to word-level alignment to tolerate minor ASR casing/punctuation shifts.
 */
export function stripCommittedPrefix(fullText: string, committedText: string): string {
  const normCommitted = committedText.trim();
  if (!normCommitted) return fullText.trim();

  if (fullText.startsWith(normCommitted)) {
    return fullText.slice(normCommitted.length).trimStart();
  }

  const committedWords = normCommitted.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  if (committedWords.length === 0) return fullText.trim();

  const fullWords = fullText.trim().split(/\s+/).filter(Boolean);
  let matchCount = 0;
  for (let i = 0; i < Math.min(committedWords.length, fullWords.length); i++) {
    const normFullWord = fullWords[i].toLowerCase().replace(/[^\w\s]/g, "");
    if (normFullWord === committedWords[i]) {
      matchCount++;
    } else {
      break;
    }
  }

  if (matchCount >= committedWords.length) {
    return fullWords.slice(matchCount).join(" ").trimStart();
  }

  return fullText.trim();
}

/**
 * Detect hallucinated transcripts from AssemblyAI or ASR engine.
 * 1. Non-Latin script characters (Cyrillic, CJK, Arabic, etc.) > 10%
 * 2. Repetitive word loops / stutter (e.g. 4+ in a row or >70% frequency in >= 8 words)
 * 3. Repetitive multi-word loops (e.g. "thank you thank you thank you thank you")
 */
export function isHallucinated(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. Count non-ASCII letters (Cyrillic, CJK, Arabic, etc.)
  const nonLatin = trimmed.match(/[\u0400-\u04FF\u0370-\u03FF\u0600-\u06FF\u0980-\u09FF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g);
  const letterCount = trimmed.replace(/[^a-zA-Z]/g, "").length;
  const nonLatinCount = nonLatin?.length ?? 0;
  // Entirely non-Latin text (pure Cyrillic, CJK, etc.) — flag as hallucinated
  if (letterCount === 0 && nonLatinCount > 0) {
    return true;
  }
  if (letterCount > 0 && nonLatinCount / letterCount > 0.1) {
    return true;
  }

  // 2. Repetitive word loops / ASR decoder stutter
  const words = trimmed.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    // 4+ identical consecutive words (e.g. "you you you you")
    for (let i = 0; i <= words.length - 4; i++) {
      if (words[i] === words[i + 1] && words[i + 1] === words[i + 2] && words[i + 2] === words[i + 3]) {
        return true;
      }
    }

    // 2-word phrase repeated 3+ times back-to-back (e.g. "thank you thank you thank you")
    if (words.length >= 6) {
      for (let i = 0; i <= words.length - 6; i++) {
        if (
          words[i] === words[i + 2] && words[i + 2] === words[i + 4] &&
          words[i + 1] === words[i + 3] && words[i + 3] === words[i + 5]
        ) {
          return true;
        }
      }
    }

    // Dominant single word > 70% of sentence when length >= 8
    if (words.length >= 8) {
      const counts = new Map<string, number>();
      for (const w of words) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      for (const c of counts.values()) {
        if (c / words.length >= 0.7) {
          return true;
        }
      }
    }
  }

  return false;
}

export type LmServiceStatus = "idle" | "requesting-mic" | "connecting" | "listening" | "error";

export interface LmDockInactivityPrompt {
  active: boolean;
  remainingSeconds: number;
  intervalMinutes: number;
}

export interface LmDockSnapshot {
  status: LmServiceStatus;
  entries: TranscriptEntry[];
  candidates: VoiceBibleCandidate[];
  latestMatch?: VoiceBibleCandidate | null;
  queue: VoiceBibleCandidate[];      // High-confidence detections eligible for auto-push or manual review
  suggestions: VoiceBibleCandidate[]; // Manual push only (quote matches)
  matching: boolean;
  error?: string;
  inputLevel: number;
  startedAt?: number;
  lastSpeechAt?: number;
  inactivityPrompt?: LmDockInactivityPrompt | null;
  inactivityNotice?: string | null;
  detectionSpeed: DetectionSpeed;
  telemetry?: LmDockTelemetry;
}

/** Suggestions are provisional and must be materially stronger than noise. */
const MIN_LIVE_QUOTE_CONFIDENCE = 0.55;
const MIN_SILENCE_QUOTE_CONFIDENCE = 0.08;

type QuoteSearchMode = "strict" | "closest";

interface QueueQuoteSearchOptions {
  mode?: QuoteSearchMode;
  contextText?: string;
}

/**
 * A live quote search is provisional. An empty result can be caused by the
 * next few spoken words not being enough to match yet, so it must not erase a
 * suggestion that is still waiting for the operator to click it. Suggestions
 * are replaced by the next positive result and explicitly cleared when the
 * listening session stops.
 */
export function retainSuggestionsUntilReplacement(
  current: VoiceBibleCandidate[],
  next: VoiceBibleCandidate[],
): VoiceBibleCandidate[] {
  return next.length > 0 ? next.slice(0, 20) : current;
}

type SnapshotListener = (snapshot: LmDockSnapshot) => void;

class LmStartupTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LmStartupTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new LmStartupTimeoutError(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function isLocalStartupFailure(message: string): boolean {
  return /microphone|mic|audio stream|input device|permission|timed out|timeout|default input|enumerate devices/i.test(message);
}

/**
 * Relay URL helper — builds absolute URLs to the overlay server's HTTP relay.
 * In the Tauri webview, relative URLs resolve to tauri://localhost which
 * doesn't have the relay. The overlay server (127.0.0.1:<port>) does.
 */
async function relayUrl(path: string): Promise<string> {
  return `${await getOverlayBaseUrl()}${path}`;
}

let _entryId = 0;
function nextEntryId(): string {
  return `e${++_entryId}`;
}

// ── Diagnostics: why did Verse AI stop or restart? ──────────────────────────
// Every stop, restart and watchdog decision is logged with a timestamp and a snapshot of the state,
// and the last 200 lines are kept. In the app's developer console, run  __verseAiDiag()  to copy them.
const VAI_DIAG_LIMIT = 200;
const vaiDiagLines: string[] = [];

export function vaiDiag(event: string, detail: Record<string, unknown> = {}): void {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(detail)}`;
  vaiDiagLines.push(line);
  if (vaiDiagLines.length > VAI_DIAG_LIMIT) vaiDiagLines.shift();
  console.info(`[VerseAI diag] ${line}`);
}

/** The line of the stack that called a stop, so the log says who asked for it. */
function vaiCaller(): string {
  const lines = (new Error().stack ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(3, 6).join(" <- ").slice(0, 400);
}

if (typeof window !== "undefined") {
  (window as unknown as { __verseAiDiag?: () => string }).__verseAiDiag = () => vaiDiagLines.join("\n");
}

export class LmDockService {
  private initialized = false;
  private unsubscribeDock: (() => void) | null = null;
  private listeners = new Set<SnapshotListener>();
  private snapshot: LmDockSnapshot = {
    status: "idle",
    entries: [],
    candidates: [],
    queue: [],
    suggestions: [],
    matching: false,
    inputLevel: 0,
    inactivityPrompt: null,
    inactivityNotice: null,
    detectionSpeed: "sharp",
  };

  // Audio refs — Rust-side AssemblyAI realtime STT (via Tauri commands)
  private transcriptUnlisten: TauriUnlisten | null = null;
  private statusUnlisten: TauriUnlisten | null = null;
  private levelUnlisten: TauriUnlisten | null = null;
  private trayStopUnlisten: TauriUnlisten | null = null;
  private visibilityHandler: (() => void) | null = null;
  private focusHandler: (() => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private scriptureEngine = new ScriptureDetectionEngine();
  /** Speech buffer for phrase-based matching */
  private speechBuffer = "";
  private lastSpeechTime = 0;
  private pauseCheckTimer: ReturnType<typeof setInterval> | null = null;
  private commandPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Inactivity detection timer and thresholds */
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  /** Prompt intervals: first after 5 min of silence, then 10, then every 15. */
  private static readonly INACTIVITY_STEPS_MIN = [5, 10, 15];
  private static readonly INACTIVITY_COUNTDOWN_S = 60;
  private inactivityStep = 0;
  private currentInactivityThresholdMs = 5 * 60 * 1000;
  private inactivityPromptActive = false;
  private inactivityPromptExpiresAt = 0;
  /** Serialized final chunks plus one latest-wins interim chunk. */
  private matchingQueueRunning = false;
  private pendingFinalChunks: Array<{ text: string; isFinal: true }> = [];
  private pendingInterimChunk: string | null = null;
  /** Throttled live quote search state */
  private liveQuoteSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private liveQuoteSearchPendingText = "";
  private lastLiveQuoteSearchAt = 0;
  /** Quote searches are latest-wins so slow semantic work cannot backlog speech. */
  private quoteSearchInFlight = false;
  private pendingQuoteSearch: {
    text: string;
    timestamp: number;
    options: QueueQuoteSearchOptions;
    searchId: number;
  } | null = null;
  /** Resolved overlay base URL (http://127.0.0.1:<port>) — set once at init */
  private overlayBaseUrl: string | null = null;
  /** The relay only needs the newest snapshot; serialize writes to prevent stale posts winning. */
  private relayPostInFlight = false;
  private relayPendingPayload: Record<string, unknown> | null = null;

  /** User intent survives an unexpected native stream close, but never a manual stop. */
  private shouldKeepListening = false;
  private activeMicId: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private nativeStopPromise: Promise<void> | null = null;
  /** Detect a stream that connected successfully but never receives mic audio. */
  private audioWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private audioConnectedAt = 0;
  private lastAudioSignalAt = 0;
  private audioRecoveryAttempts = 0;
  private static readonly AUDIO_SIGNAL_GRACE_MS = 30_000;
  private static readonly MAX_AUDIO_RECOVERY_ATTEMPTS = 3;

  // ── Sentence detection state ──────────────────────────────────────────────
  /** Accumulated text for the current sentence (across ASR finals) */
  private sentenceBuffer = "";
  /** Monotonically increasing search ID — discards stale results */
  private latestSearchId = 0;
  private static readonly LIVE_QUOTE_SEARCH_WINDOW_WORDS = 18;
  /** The dock only renders recent lines; never serialize an entire service into each live relay packet. */
  private static readonly MAX_RELAY_TRANSCRIPT_ENTRIES = 60;
  /** Bounded in-memory transcript lines to keep RAM/CPU minimal on 4GB-6GB machines */
  private static readonly MAX_IN_MEMORY_ENTRIES = 200;
  /** Accumulated text already finalized into previous lines in the active turn */
  private turnCommittedText = "";
  /** Dedup guard to avoid duplicating finalized lines */
  private lastFinalizedLineText = "";
  private lastFinalizedAt = 0;
  /** Timestamp when current listening session started (for transparent recycling) */
  private sessionStartTime = 0;
  private lastSessionRecycleAt = 0;
  /** Throttled interim push timer to prevent React render storms / background hanging */
  private pendingInterimPushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly RECONNECT_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000];
  private static readonly MIC_START_TIMEOUT_MS = 12_000;
  private static readonly CONNECTION_WATCHDOG_TIMEOUT_MS = 20_000;
  private connectionWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private lastQueuedQuoteSearchKey = "";
  private lastQueuedQuoteSearchAt = 0;

  // ── Interim provisional search ────────────────────────────────────────────
  /** Debounce timer for provisional quote search on interim text */
  private interimSearchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last interim text that was submitted for provisional search */
  private lastInterimSearched = "";
  /** Prevent duplicate starts when BroadcastChannel and HTTP relay overlap. */
  private startInFlight = false;
  /** Invalidates stale start attempts when stop/start races happen. */
  private sessionToken = 0;
  /** Throttle audio level notifications to avoid render storms. */
  private lastLevelNotifyAt = 0;
  private lastLevelValue = 0;
  /** Diagnostics only: how many mic level events arrived since the speech service said Begin. */
  private diagLevelEvents = 0;
  private diagMaxLevel = 0;
  private diagLastSummaryAt = 0;

  /** A snapshot of everything that decides whether listening continues (for the diagnostic log). */
  private diagState(): Record<string, unknown> {
    const now = Date.now();
    return {
      status: this.snapshot.status,
      keepListening: this.shouldKeepListening,
      token: this.sessionToken,
      sessionAgeS: this.sessionStartTime ? Math.round((now - this.sessionStartTime) / 1000) : null,
      reconnectAttempts: this.reconnectAttempts,
      audioRecoveryAttempts: this.audioRecoveryAttempts,
      sinceConnectedS: this.audioConnectedAt ? Math.round((now - this.audioConnectedAt) / 1000) : null,
      sinceLastLevelS: this.lastAudioSignalAt ? Math.round((now - this.lastAudioSignalAt) / 1000) : null,
      levelEventsSinceBegin: this.diagLevelEvents,
      maxLevelSinceBegin: Math.round(this.diagMaxLevel * 1000) / 1000,
      sinceLastSpeechS: this.lastSpeechReceivedAt ? Math.round((now - this.lastSpeechReceivedAt) / 1000) : null,
      inactivityPromptActive: this.inactivityPromptActive,
      inactivityThresholdMin: Math.round(this.currentInactivityThresholdMs / 60_000),
    };
  }

  // ── Detection profile ─────────────────────────────────────────────────────
  /** Fixed sharp detection mode. Kept as a typed field for Rust/settings compatibility. */
  private detectionSpeed: DetectionSpeed = "sharp";
  /** Cached sharp-profile config */
  private get speedConfig() {
    return DETECTION_SPEED_CONFIG[this.detectionSpeed];
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────
  private telemetry: LmDockTelemetry = {
    lastSpeechAt: 0,
    lastSearchAt: 0,
    lastResultsAt: 0,
    speechToSearchMs: 0,
    searchToResultsMs: 0,
    totalLatencyMs: 0,
    searchCount: 0,
    avgLatencyMs: 0,
  };
  /** Rolling latency accumulator for average calculation */
  private latencySum = 0;
  /** Last observed speech timestamp for live-search telemetry */
  private lastSpeechReceivedAt = 0;

  /**
   * Keep only the most recent clause for quote matching.
   * Long transcripts get noisy quickly; the verse clue is usually in the tail.
   */
  private buildLiveQuoteSearchText(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    const words = normalized.split(" ");
    if (words.length <= LmDockService.LIVE_QUOTE_SEARCH_WINDOW_WORDS) {
      return normalized;
    }

    return words.slice(-LmDockService.LIVE_QUOTE_SEARCH_WINDOW_WORDS).join(" ");
  }

  /**
   * Throttle quote searches so we update during speech instead of waiting
   * for a full pause. The latest text wins.
   */
  private scheduleLiveQuoteSearch(text: string): void {
    const searchText = this.buildLiveQuoteSearchText(text);
    if (!searchText) return;

    this.liveQuoteSearchPendingText = searchText;

    if (this.liveQuoteSearchTimer) return;

    const throttleMs = this.speedConfig.debounceMs;
    const now = Date.now();
    const elapsed = now - this.lastLiveQuoteSearchAt;
    const delay = Math.max(0, throttleMs - elapsed);

    this.liveQuoteSearchTimer = setTimeout(() => {
      this.liveQuoteSearchTimer = null;
      const pending = this.liveQuoteSearchPendingText.trim();
      if (!pending || pending === this.lastInterimSearched) return;

      this.lastLiveQuoteSearchAt = Date.now();
      this.lastInterimSearched = pending;
      this.telemetry.lastSearchAt = Date.now();
      this.telemetry.speechToSearchMs = this.lastSpeechReceivedAt > 0
        ? this.telemetry.lastSearchAt - this.lastSpeechReceivedAt
        : 0;

      this.queueQuoteSearch(pending);
    }, delay);
  }

  private queueQuoteSearch(text: string, options: QueueQuoteSearchOptions = {}): void {
    if (this.snapshot.status !== "listening") return;
    const trimmed = text.trim();
    if (trimmed.length < 10) return;

    const mode = options.mode ?? "strict";
    const now = Date.now();
    const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
    const key = `${mode}:${normalized}:${options.contextText ?? ""}`;
    if (key === this.lastQueuedQuoteSearchKey && now - this.lastQueuedQuoteSearchAt < 1_000) {
      return;
    }

    this.lastQueuedQuoteSearchKey = key;
    this.lastQueuedQuoteSearchAt = now;
    this.pendingQuoteSearch = {
      text: trimmed,
      timestamp: now,
      options: { ...options, mode },
      searchId: ++this.latestSearchId,
    };

    // Abort the current search as soon as newer speech arrives. The drain
    // below will process only the newest pending query after the abort settles.
    if (this.quoteSearchInFlight) {
      this.scriptureEngine.cancelQuoteSearchPublic();
      return;
    }

    this.quoteSearchInFlight = true;
    void this.drainQuoteSearches();
  }

  private async drainQuoteSearches(): Promise<void> {
    try {
      while (this.pendingQuoteSearch && this.snapshot.status === "listening") {
        const job = this.pendingQuoteSearch;
        this.pendingQuoteSearch = null;
        await this.runQuoteSearchWithText(job.text, job.timestamp, job.options, job.searchId);
      }
    } finally {
      this.quoteSearchInFlight = false;
      if (this.pendingQuoteSearch && this.snapshot.status === "listening") {
        this.quoteSearchInFlight = true;
        void this.drainQuoteSearches();
      }
    }
  }

  /**
   * A command the OBS dock sent over the HTTP relay (/api/lm-command).
   * Public so the app's startup relay watcher can hand over commands that
   * arrived before this service was loaded.
   */
  handleRelayCommand(cmd: { type: string; commandId?: string; payload?: unknown }): void {
    if (cmd.type === "lm:start") {
      const payload = cmd.payload as { micId?: string } | undefined;
      console.log("[lmDockService] 🎤 HTTP lm:start → startListening()");
      void this.startListening(payload?.micId);
    } else if (cmd.type === "lm:stop") {
      this.stopListening();
    } else if (cmd.type === "lm:keep-listening") {
      if (this.inactivityPromptActive) this.confirmStillUsing();
    } else if (cmd.type === "lm:navigate") {
      // The LM dock can run in a separate OBS CEF process. Re-broadcast
      // the relayed command so the Bible dock can focus the reference
      // and push it through its OBS output path.
      dockBridge.sendCommand({
        type: "lm:navigate",
        commandId: cmd.commandId,
        payload: cmd.payload,
        timestamp: Date.now(),
      });
      dockBridge.sendState({ type: "state:lm-status", payload: { ...this.snapshot }, timestamp: Date.now() });
    }
  }

  init(): () => void {
    if (this.initialized) return () => { };
    this.initialized = true;

    // Eagerly resolve the overlay base URL so relay POSTs always use
    // http://127.0.0.1:<port> instead of falling back to tauri://localhost
    // or http://localhost (Vite dev server) which would hit the wrong proxy.
    getOverlayBaseUrl().then((url) => {
      this.overlayBaseUrl = url;
      console.log("[lmDockService] overlay base URL resolved:", url);
    }).catch((err) => {
      console.warn("[lmDockService] overlay base URL resolve FAILED:", err);
    });

    // Do NOT push idle state at init — the dock should only show content
    // after the user explicitly starts listening via SpeechToScripturePage.
    // The "ping" handler below covers late-connecting docks.

    this.unsubscribeDock = dockBridge.onCommand((cmd) => {
      console.log("[lmDockService] 📡 dockBridge command:", cmd.type);
      if (cmd.type === "lm:start") {
        const payload = cmd.payload as { micId?: string } | undefined;
        console.log("[lmDockService] 🎤 dockBridge lm:start → startListening()");
        void this.startListening(payload?.micId);
      } else if (cmd.type === "lm:stop") {
        this.stopListening();
      } else if (cmd.type === "lm:keep-listening") {
        if (this.inactivityPromptActive) this.confirmStillUsing();
      } else if (cmd.type === "ping") {
        // Dock just connected — push current state so it updates immediately
        this.pushStatus();
        this.pushCandidates();
      }
    });

    // The macOS menu-bar VoiceAI action must use the same stop path as the
    // in-app button so reconnection, timers, listeners, and native capture are
    // all shut down together.
    void safeTauriListen("voiceai-tray-stop", () => {
      this.stopListening();
    }).then((unlisten) => {
      if (!this.initialized) {
        unlisten();
        return;
      }
      this.trayStopUnlisten = unlisten;
    }).catch(() => {
      // Browser/dock contexts do not expose Tauri events.
    });

    // HTTP command polling — cross-process fallback for OBS CEF dock
    // BroadcastChannel only works within the same browser process.
    // In OBS, the dock runs in CEF (separate process), so we need HTTP relay.
    this.commandPollTimer = setInterval(async () => {
      try {
        const url = await relayUrl("/api/lm-command");
        const res = await fetch(url);
        const raw = (await res.json()) as unknown;
        // Rust returns Vec<String> (raw JSON strings), not Vec<Value>
        const commands: Array<{ type: string; commandId?: string; payload?: unknown }> = Array.isArray(raw)
          ? raw.map((item) =>
            typeof item === "string"
              ? (JSON.parse(item) as { type: string; commandId?: string; payload?: unknown })
              : (item as { type: string; commandId?: string; payload?: unknown }),
          )
          : [];
        for (const cmd of commands) this.handleRelayCommand(cmd);
      } catch (err) {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.05) {
          console.warn("[lmDockService] ⚠️ commandPoll failed:", err);
        }
      }
    }, 500);

    return () => {
      this.unsubscribeDock?.();
      this.unsubscribeDock = null;
      if (this.commandPollTimer) {
        clearInterval(this.commandPollTimer);
        this.commandPollTimer = null;
      }
      this.trayStopUnlisten?.();
      this.trayStopUnlisten = null;
      this.stopListening();
      this.initialized = false;
    };
  }

  // ── Snapshot helpers ─────────────────────────────────────────────────────

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private pushStatus(): void {
    this.notifyListeners();
    // Lets the app show the "still using it?" prompt on any page without loading this service.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mce:voice-ai-inactivity", { detail: this.snapshot.inactivityPrompt ?? null }));
    }
    dockBridge.sendState({
      type: "state:lm-status",
      payload: { ...this.snapshot },
      timestamp: Date.now(),
    });
    this.postToRelay();
  }

  private pushCandidates(): void {
    this.notifyListeners();
    dockBridge.sendState({
      type: "state:lm-candidates",
      payload: {
        transcript: this.getPlainText(),
        candidates: this.snapshot.candidates,
        queue: this.snapshot.queue,
        suggestions: this.snapshot.suggestions,
      },
      timestamp: Date.now(),
    });
    this.postToRelay();
  }

  private pushTranscript(): void {
    this.notifyListeners();
    dockBridge.sendState({
      type: "state:lm-transcript",
      payload: {
        entries: this.snapshot.entries.slice(-LmDockService.MAX_RELAY_TRANSCRIPT_ENTRIES),
      },
      timestamp: Date.now(),
    });
    this.postToRelay();
  }

  /** Coalesces interim transcript UI updates to 120ms to prevent React re-render lag and background freeze */
  private scheduleThrottledTranscriptPush(): void {
    if (this.pendingInterimPushTimer) return;
    this.pendingInterimPushTimer = setTimeout(() => {
      this.pendingInterimPushTimer = null;
      this.pushTranscript();
    }, 120);
  }

  /** Flushes any pending throttled push immediately (used on sentence completion, pause, or focus) */
  private flushTranscriptPush(): void {
    if (this.pendingInterimPushTimer) {
      clearTimeout(this.pendingInterimPushTimer);
      this.pendingInterimPushTimer = null;
    }
    this.pushTranscript();
  }

  /** POST snapshot to overlay server relay for cross-process LM Dock communication */
  private postToRelay(): void {
    this.relayPendingPayload = {
      status: this.snapshot.status,
      startedAt: this.snapshot.startedAt,
      lastSpeechAt: this.snapshot.lastSpeechAt,
      inactivityPrompt: this.snapshot.inactivityPrompt,
      inactivityNotice: this.snapshot.inactivityNotice,
      entries: this.snapshot.entries.slice(-LmDockService.MAX_RELAY_TRANSCRIPT_ENTRIES),
      candidates: this.snapshot.candidates,
      queue: this.snapshot.queue,
      suggestions: this.snapshot.suggestions,
      matching: this.snapshot.matching,
      error: this.snapshot.error,
    };
    void this.flushRelaySnapshot();
  }

  private async flushRelaySnapshot(): Promise<void> {
    if (this.relayPostInFlight) return;
    this.relayPostInFlight = true;

    try {
      while (this.relayPendingPayload) {
        const payload = this.relayPendingPayload;
        this.relayPendingPayload = null;
        const baseUrl = this.overlayBaseUrl || await getOverlayBaseUrl();
        this.overlayBaseUrl = baseUrl;

        const response = await fetch(`${baseUrl}/api/lm-state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          console.warn("[lmDockService] postToRelay HTTP", response.status, response.statusText);
        }
      }
    } catch (err) {
      console.warn("[lmDockService] postToRelay failed:", err);
    } finally {
      this.relayPostInFlight = false;
      // A snapshot may arrive between the final loop check and clearing the lock.
      if (this.relayPendingPayload) void this.flushRelaySnapshot();
    }
  }

  /** Get all finalized text joined for Bible matching */
  private getPlainText(): string {
    return this.snapshot.entries
      .filter((e) => e.finalized)
      .map((e) => e.text)
      .join("\n");
  }

  // ── Transcript entry management ──────────────────────────────────────────

  /** Update or create the active (interim) entry, bounded to MAX_IN_MEMORY_ENTRIES */
  private upsertInterim(text: string, audioStartMs?: number, audioEndMs?: number): void {
    const trimmed = text.trim();
    const activeIndex = this.snapshot.entries.findIndex((e) => !e.finalized);

    if (!trimmed) {
      if (activeIndex >= 0) {
        const nextEntries = this.snapshot.entries.filter((_, index) => index !== activeIndex);
        this.snapshot = { ...this.snapshot, entries: nextEntries };
      }
      return;
    }

    const active = activeIndex >= 0 ? this.snapshot.entries[activeIndex] : null;
    const nextEntry = {
      id: active?.id ?? nextEntryId(),
      text: trimmed,
      finalized: false,
      startTime: audioStartMs != null && audioStartMs > 0 ? audioStartMs / 1000 : active?.startTime,
      endTime: audioEndMs != null && audioEndMs > 0 ? audioEndMs / 1000 : active?.endTime,
    };

    let nextEntries: TranscriptEntry[];
    if (activeIndex >= 0) {
      nextEntries = this.snapshot.entries.map((entry, index) =>
        index === activeIndex ? nextEntry : entry,
      );
    } else {
      nextEntries = [...this.snapshot.entries, nextEntry];
    }

    if (nextEntries.length > LmDockService.MAX_IN_MEMORY_ENTRIES) {
      nextEntries = nextEntries.slice(-LmDockService.MAX_IN_MEMORY_ENTRIES);
    }

    this.snapshot = { ...this.snapshot, entries: nextEntries };
  }

  /** Finalize a single line entry with bounding and dedup protection */
  private finalizeLine(finalText: string, audioStartMs?: number, audioEndMs?: number): void {
    const trimmed = finalText.trim();
    if (!trimmed) return;

    const now = Date.now();
    const activeIndex = this.snapshot.entries.findIndex((e) => !e.finalized);
    const active = activeIndex >= 0 ? this.snapshot.entries[activeIndex] : null;

    // 1. Strict Duplicate Suppression:
    // If the exact same text was finalized recently (< 5000ms), do not add a duplicate entry!
    const normTrimmed = trimmed.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const lastFinalized = [...this.snapshot.entries].reverse().find((e) => e.finalized);
    const normLast = (this.lastFinalizedLineText || lastFinalized?.text || "").toLowerCase().replace(/[^\w\s]/g, "").trim();

    if (normTrimmed && normLast && normTrimmed === normLast && now - this.lastFinalizedAt < 5000) {
      if (activeIndex >= 0) {
        this.snapshot = {
          ...this.snapshot,
          entries: this.snapshot.entries.filter((_, i) => i !== activeIndex),
        };
      }
      return;
    }

    // 2. STT Revision Rollup:
    // When the ASR model refines a short phrase in quick succession (e.g. "Hebrews two five" -> "Hebrews two seven"):
    // Check if the previous entry shares >= 50% prefix words and occurred within 2000ms.
    const lastIndex = this.snapshot.entries.length - 1;
    if (
      lastIndex >= 0 &&
      this.snapshot.entries[lastIndex].finalized &&
      now - this.lastFinalizedAt < 2000
    ) {
      const prevWords = (normLast || "").split(/\s+/).filter(Boolean);
      const currWords = normTrimmed.split(/\s+/).filter(Boolean);
      if (prevWords.length <= 5 && currWords.length <= 6 && prevWords.length > 0 && currWords.length > 0) {
        let sharedPrefixCount = 0;
        while (
          sharedPrefixCount < prevWords.length &&
          sharedPrefixCount < currWords.length &&
          prevWords[sharedPrefixCount] === currWords[sharedPrefixCount]
        ) {
          sharedPrefixCount++;
        }

        const overlap = sharedPrefixCount / Math.max(prevWords.length, 1);
        if (sharedPrefixCount >= 2 || (prevWords.length <= 2 && sharedPrefixCount >= 1 && overlap >= 0.5)) {
          console.log(`[LmDockService] Rolling up STT revision: "${this.snapshot.entries[lastIndex].text}" -> "${trimmed}"`);
          const updatedEntry: TranscriptEntry = {
            ...this.snapshot.entries[lastIndex],
            text: trimmed,
            endTime: audioEndMs != null && audioEndMs > 0 ? audioEndMs / 1000 : this.snapshot.entries[lastIndex].endTime,
          };
          let nextEntries = this.snapshot.entries.map((e, idx) => (idx === lastIndex ? updatedEntry : e));
          if (activeIndex >= 0) {
            nextEntries = nextEntries.filter((_, i) => i !== activeIndex);
          }
          this.snapshot = { ...this.snapshot, entries: nextEntries };
          this.lastFinalizedLineText = trimmed;
          this.lastFinalizedAt = now;
          this.turnCommittedText = trimmed;
          return;
        }
      }
    }

    this.lastFinalizedLineText = trimmed;
    this.lastFinalizedAt = now;

    const finalizedEntry: TranscriptEntry = {
      id: active?.id ?? nextEntryId(),
      text: trimmed,
      finalized: true,
      startTime: audioStartMs != null && audioStartMs > 0 ? audioStartMs / 1000 : active?.startTime,
      endTime: audioEndMs != null && audioEndMs > 0 ? audioEndMs / 1000 : active?.endTime,
    };

    let nextEntries: TranscriptEntry[];
    if (activeIndex >= 0) {
      nextEntries = this.snapshot.entries.map((entry, index) =>
        index === activeIndex ? finalizedEntry : entry,
      );
    } else {
      nextEntries = [...this.snapshot.entries, finalizedEntry];
    }

    if (nextEntries.length > LmDockService.MAX_IN_MEMORY_ENTRIES) {
      nextEntries = nextEntries.slice(-LmDockService.MAX_IN_MEMORY_ENTRIES);
    }

    this.snapshot = { ...this.snapshot, entries: nextEntries };
  }



  // ── Bible matching (incremental) ────────────────────────────────────────

  /**
   * Process transcript chunks through the Scripture Detection Engine. Final
   * chunks stay ordered; interim revisions are coalesced to the newest value
   * so matching work cannot grow faster than speech.
   */
  private processChunk(text: string, isFinal: boolean): void {
    if (!text.trim()) return;
    if (this.snapshot.status !== "listening") return;

    if (isFinal || this.scriptureEngine.isReferenceSpeech(text)) {
      this.latestSearchId++;
      this.pendingQuoteSearch = null;
      this.scriptureEngine.cancelQuoteSearchPublic();
      if (this.liveQuoteSearchTimer) clearTimeout(this.liveQuoteSearchTimer);
      this.liveQuoteSearchTimer = null;
      this.liveQuoteSearchPendingText = "";
      this.snapshot = { ...this.snapshot, matching: false };
    }
    if (isFinal) {
      // A final ASR result supersedes the currently pending interim revision.
      this.pendingInterimChunk = null;
      this.pendingFinalChunks.push({ text, isFinal: true });
    } else {
      this.pendingInterimChunk = text;
    }

    void this.drainMatchingChunks();
  }

  private async drainMatchingChunks(): Promise<void> {
    if (this.matchingQueueRunning) return;
    this.matchingQueueRunning = true;

    try {
      while (this.snapshot.status === "listening") {
        const nextFinal = this.pendingFinalChunks.shift();
        const next = nextFinal ?? (
          this.pendingInterimChunk
            ? { text: this.pendingInterimChunk, isFinal: false as const }
            : null
        );
        if (!next) break;
        if (!next.isFinal) this.pendingInterimChunk = null;

        try {
          const token = this.sessionToken;
          const result = await this.scriptureEngine.processChunk(next.text, next.isFinal);
          if (token !== this.sessionToken) continue;
          if (this.snapshot.status !== "listening") return;
          this.handleMatchResult(result);
          if (next.isFinal) {
            if (result.handledReference) this.sentenceBuffer = "";
            else this.onTranscriptFinal(next.text);
          }
        } catch (err) {
          console.warn("[LmDockService] processChunk error:", err);
        }
      }
    } finally {
      this.matchingQueueRunning = false;
      if (
        this.snapshot.status === "listening" &&
        (this.pendingFinalChunks.length > 0 || this.pendingInterimChunk)
      ) {
        void this.drainMatchingChunks();
      }
    }
  }

  private handleMatchResult(
    result: { matches: Array<{ candidate: VoiceBibleCandidate; source: string; confidence: number; navigationOnly?: boolean }> },
  ): void {
    if (result.matches.length > 0) {
      const newCandidates = result.matches.map((m) => ({ ...m.candidate, detectedAt: Date.now() }));

        // Confidence routing:
        // - source=reference OR confidence >= 0.90 → queue for configured push behavior
        // - navigationOnly (chapter-only open) → suggestions only (no auto-push)
        // - confidence >= 0.75 → suggestion
        // - confidence < 0.75 → low-confidence suggestion
      const isReferenceCommand = result.matches.some((m) => m.source === "reference");
      const highConfidence = result.matches.some((m) => m.confidence >= 0.90);
      const isNavigationOnly = result.matches.some((m) => m.navigationOnly === true);

      if ((isReferenceCommand || highConfidence) && !isNavigationOnly) {
        const newKeys = new Set(newCandidates.map((c) => `${c.book}:${c.chapter}:${c.verse}`));
        const queue = [...newCandidates, ...this.snapshot.queue.filter((c) => !newKeys.has(`${c.book}:${c.chapter}:${c.verse}`))].slice(0, 20);
        this.snapshot = { ...this.snapshot, queue, suggestions: [] };


      } else {
        // REPLACE suggestions — same principle as runQuoteSearchWithText.
        // Each new match result represents the latest detection, not an
        // addition to historical matches.
        const suggestions = newCandidates.slice(0, 20);
        this.snapshot = { ...this.snapshot, suggestions };
      }

      const candidates = [...this.snapshot.queue, ...this.snapshot.suggestions].slice(0, 20);
      this.snapshot = { ...this.snapshot, candidates, latestMatch: newCandidates[0] };
      this.pushCandidates();
      return;
    }
  }

  // ── Sentence detection ────────────────────────────────────────────────────

  /**
   * Called after a finalized ASR turn has been checked for references.
   * Keep a bounded context for quotes split across adjacent turns.
   */
  private onTranscriptFinal(text: string): void {
    const now = Date.now();

    // Record speech timestamp for telemetry
    this.telemetry.lastSpeechAt = now;

    // A short final may complete the quotation from the previous ASR turn.
    // Search the whole turn so punctuation plus a short trailing "Amen" cannot
    // cancel a verse search that has just started.
    const words = text.trim().split(/\s+/);
    const previous = this.sentenceBuffer;
    const searchText = words.length < 6 && previous
      ? `${previous} ${text}`
      : text;
    this.sentenceBuffer = searchText.split(/\s+/).slice(-60).join(" ");
    this.queueQuoteSearch(text, { mode: "closest", contextText: words.length < 6 ? previous : undefined });
  }

  /**
   * Run verse search with freshness protection.
   * Cancels any in-flight search. Results are discarded if a newer search
   * has started by the time they arrive.
   */
  private async runQuoteSearchWithText(
    text: string,
    _transcriptTimestamp: number,
    options: QueueQuoteSearchOptions = {},
    searchId = ++this.latestSearchId,
  ): Promise<void> {
    if (this.snapshot.status !== "listening") return;

    // Cancel any in-flight search — we only care about the latest
    this.scriptureEngine.cancelQuoteSearchPublic();

    const token = this.sessionToken;
    const boundPassage = this.scriptureEngine.getBoundPassage();
    const searchStartedAt = Date.now();
    this.telemetry.lastSearchAt = searchStartedAt;
    this.telemetry.speechToSearchMs = this.lastSpeechReceivedAt > 0
      ? searchStartedAt - this.lastSpeechReceivedAt
      : this.telemetry.speechToSearchMs;


    this.snapshot = { ...this.snapshot, matching: true };
    this.pushStatus();

    try {
      // Show keyword-index suggestions straight away (a few ms). The slower exact-quote search below
      // can still replace them, and a verse read out in full is promoted there.
      try {
        const quickMatches = await this.scriptureEngine.quickQuoteSuggestions(text, boundPassage, options.mode ?? "strict");
        if (searchId === this.latestSearchId && token === this.sessionToken && this.snapshot.status === "listening") {
          const quickUsable = quickMatches.filter((match) => match.confidence >= (options.mode === "closest"
            ? MIN_SILENCE_QUOTE_CONFIDENCE
            : MIN_LIVE_QUOTE_CONFIDENCE));
          if (quickUsable.length > 0) {
            const quickSuggestions = retainSuggestionsUntilReplacement(
              this.snapshot.suggestions,
              quickUsable.map((m) => ({ ...m.candidate, detectedAt: Date.now() })),
            );
            const quickCandidates = [...this.snapshot.queue, ...quickSuggestions].slice(0, 20);
            this.snapshot = { ...this.snapshot, suggestions: quickSuggestions, candidates: quickCandidates, latestMatch: quickSuggestions[0] };
            this.telemetry.lastResultsAt = Date.now();
            this.pushCandidates();
          }
        }

      } catch (quickError) {
        // Quick suggestions are a bonus; the full search below still runs.
        console.warn("[LmDockService] Quick suggestions failed:", quickError);
      }

      const quoteMatches = await this.scriptureEngine.searchQuotesWithText(
        text,
        boundPassage,
        { ...options, mode: options.mode ?? "strict" },
      );

      // Freshness guard: discard if a newer search has started
      if (searchId !== this.latestSearchId || token !== this.sessionToken || this.snapshot.status !== "listening") {
        return;
      }

      // Record telemetry — search completed
      const searchCompletedAt = Date.now();
      this.telemetry.searchToResultsMs = searchCompletedAt - this.telemetry.lastSearchAt;
      this.telemetry.searchCount++;
      this.latencySum += this.telemetry.searchToResultsMs;
      this.telemetry.avgLatencyMs = Math.round(this.latencySum / this.telemetry.searchCount);

      const minConfidence = options.mode === "closest"
        ? MIN_SILENCE_QUOTE_CONFIDENCE
        : MIN_LIVE_QUOTE_CONFIDENCE;
      const usableQuoteMatches = quoteMatches.filter((match) => match.confidence >= minConfidence);

      if (usableQuoteMatches.length > 0) {
        // Replace suggestions only when a newer search has a real match.
        // Empty interim searches must not remove a clickable suggestion.
        const suggestions = retainSuggestionsUntilReplacement(
          this.snapshot.suggestions,
          usableQuoteMatches.map((m) => ({ ...m.candidate, detectedAt: Date.now() })),
        );
        const candidates = [...this.snapshot.queue, ...suggestions].slice(0, 20);
        this.snapshot = { ...this.snapshot, suggestions, candidates, latestMatch: suggestions[0] };
        this.telemetry.lastResultsAt = Date.now();
        this.telemetry.totalLatencyMs = this.lastSpeechReceivedAt > 0
          ? searchCompletedAt - this.lastSpeechReceivedAt
          : this.telemetry.searchToResultsMs;
        this.pushCandidates();
      } else {
        // Keep the previous suggestion visible. The dock owns its configured
        // suggestion lifetime, and the next partial search may simply be too
        // short to match while the pastor is still speaking.
      }
    } catch (err) {
      console.warn("[LmDockService] Sentence quote search failed:", err);
    } finally {
      if (searchId !== this.latestSearchId || token !== this.sessionToken) return;
      this.snapshot = { ...this.snapshot, matching: false };
      // Don't push status after stop — the stop handler already pushed idle
      if (this.snapshot.status !== "idle") {
        this.pushStatus();
      }
    }
  }

  // ── Start / Stop ────────────────────────────────────────────────────────

  private recoverFromUnexpectedStreamEnd(reason: string): void {
    vaiDiag("stream ended unexpectedly", { reason, willRecover: this.shouldKeepListening && !this.reconnectTimer, ...this.diagState() });
    if (!this.shouldKeepListening || this.reconnectTimer) return;

    const isConfigurationFailure = /api key|unauthori[sz]ed|forbidden|invalid.*key/i.test(reason);
    if (isConfigurationFailure) {
      this.shouldKeepListening = false;
      void this.cleanup();
      return;
    }

    const nextAttempt = this.reconnectAttempts + 1;
    if (nextAttempt > LmDockService.MAX_RECONNECT_ATTEMPTS) {
      this.shouldKeepListening = false;
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        error: "Speech connection stopped. Start listening again to retry.",
      };
      this.pushStatus();
      void this.cleanup();
      return;
    }

    this.reconnectAttempts = nextAttempt;
    void this.cleanup().finally(() => {
      if (!this.shouldKeepListening || this.reconnectTimer) return;

      const delay = LmDockService.RECONNECT_DELAYS_MS[nextAttempt - 1] ?? 8_000;
      this.snapshot = {
        ...this.snapshot,
        status: "connecting",
        error: `Reconnecting speech service (${nextAttempt}/${LmDockService.MAX_RECONNECT_ATTEMPTS})…`,
      };
      this.pushStatus();

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.shouldKeepListening) return;
        void this.startListening(this.activeMicId, { reconnect: true });
      }, delay);
    });
  }

  private startConnectionWatchdog(token: number): void {
    this.stopConnectionWatchdog();
    this.connectionWatchdogTimer = setTimeout(() => {
      this.connectionWatchdogTimer = null;
      if (token !== this.sessionToken) return;
      if (this.snapshot.status === "connecting" || this.snapshot.status === "requesting-mic") {
        console.warn("[LmDockService] Connection watchdog timed out while waiting for speech service.");
        vaiDiag("connection watchdog fired: no Begin from the speech service in time", this.diagState());
        this.shouldKeepListening = false;
        this.snapshot = {
          ...this.snapshot,
          status: "error",
          error: "Connection to speech service timed out. Start listening again to retry.",
        };
        this.pushStatus();
        void this.cleanup();
      }
    }, LmDockService.CONNECTION_WATCHDOG_TIMEOUT_MS);
  }

  private stopConnectionWatchdog(): void {
    if (this.connectionWatchdogTimer) {
      clearTimeout(this.connectionWatchdogTimer);
      this.connectionWatchdogTimer = null;
    }
  }

  private stopAudioSignalMonitor(): void {
    if (this.audioWatchdogTimer) {
      clearInterval(this.audioWatchdogTimer);
      this.audioWatchdogTimer = null;
    }
    this.audioConnectedAt = 0;
    this.lastAudioSignalAt = 0;
  }

  private startAudioSignalMonitor(): void {
    this.stopAudioSignalMonitor();
    this.audioConnectedAt = Date.now();
    this.audioWatchdogTimer = setInterval(() => {
      if (
        !this.shouldKeepListening
        || (this.snapshot.status !== "connecting" && this.snapshot.status !== "listening")
      ) return;

      const connectedFor = Date.now() - this.audioConnectedAt;
      if (Date.now() - this.diagLastSummaryAt >= 30_000) {
        this.diagLastSummaryAt = Date.now();
        vaiDiag("alive", this.diagState());
      }
      if (connectedFor < LmDockService.AUDIO_SIGNAL_GRACE_MS) return;
      // The local capture callback has been observed. Long periods of silence
      // are valid and must not restart a pastor's session.
      if (this.lastAudioSignalAt >= this.audioConnectedAt) return;
      vaiDiag("audio watchdog: no mic level events since the speech service said Begin", { graceMs: LmDockService.AUDIO_SIGNAL_GRACE_MS, ...this.diagState() });
      if (this.audioRecoveryAttempts >= LmDockService.MAX_AUDIO_RECOVERY_ATTEMPTS) {
        this.shouldKeepListening = false;
        this.snapshot = {
          ...this.snapshot,
          status: "error",
          error: "No microphone audio was received. Check the selected input and microphone permission, then start listening again.",
        };
        this.pushStatus();
        void this.cleanup();
        return;
      }

      this.audioRecoveryAttempts += 1;
      console.warn("[LmDockService] Listening is connected but no microphone audio was received; restarting capture.");
      this.stopAudioSignalMonitor();
      this.recoverFromUnexpectedStreamEnd("Microphone input is not receiving audio.");
    }, 1_000);
  }

  /**
   * Process realtime transcript events from AssemblyAI.
   * Splits multi-sentence turns line-by-line upon punctuation (. ! ?),
   * instantly triggers verse search per completed line, bounds memory,
   * and coalesces interim UI updates to prevent UI stutter/hang.
   */
  handleTranscriptStream(payload: {
    text: string;
    end_of_turn: boolean;
    audio_start: number;
    audio_end: number;
  }): void {
    const { text, end_of_turn, audio_start, audio_end } = payload;
    const now = Date.now();

    // Filter hallucinated transcripts (non-Latin script garbage or repetitive loops).
    // These must not count as speech, or background noise keeps Voice AI alive forever.
    if (isHallucinated(text)) {
      console.warn("[Transcript] Hallucinated entry discarded:", text.substring(0, 60));
      return;
    }
    if (!String(text || "").trim()) return;

    this.lastSpeechReceivedAt = now;
    this.lastSpeechTime = now;
    this.snapshot = { ...this.snapshot, lastSpeechAt: now };
    if (this.inactivityPromptActive) {
      this.confirmStillUsing();
    }

    // Strip out text that was already committed into completed lines earlier in this turn
    const uncommitted = stripCommittedPrefix(text, this.turnCommittedText);

    if (end_of_turn) {
      if (Date.now() - this.lastSpeechTime > 12_000) this.sentenceBuffer = "";

      // Finalize all remaining sentences or trailing fragments
      const sourceText = uncommitted.trim() || this.speechBuffer.trim();
      const { completed, remaining } = splitSentenceBoundaries(sourceText, true);
      const allToFinalize = completed.length > 0 ? [...completed] : (sourceText ? [sourceText] : []);
      if (remaining.trim() && !completed.includes(remaining.trim())) {
        allToFinalize.push(remaining.trim());
      }

      for (const lineText of allToFinalize) {
        const trimmed = lineText.trim();
        if (trimmed) {
          this.finalizeLine(trimmed, audio_start, audio_end);
          this.processLineQuoteSearch(trimmed);
        }
      }

      this.turnCommittedText = "";
      this.speechBuffer = "";
      this.upsertInterim("", audio_start, audio_end);
      this.flushTranscriptPush();

    } else {
      // Interim stream within turn:
      // Check if any sentences reached completion via sentence-ending punctuation (. ? !)
      const { completed, remaining } = splitSentenceBoundaries(uncommitted, false);

      if (completed.length > 0) {
        for (const lineText of completed) {
          this.finalizeLine(lineText, audio_start, audio_end);
          this.turnCommittedText = this.turnCommittedText
            ? `${this.turnCommittedText} ${lineText}`
            : lineText;
          this.processLineQuoteSearch(lineText);
        }
      }

      // Handle active interim speech
      if (remaining.trim()) {
        this.upsertInterim(remaining, audio_start, audio_end);
        this.speechBuffer = remaining;

        const interimRef = this.scriptureEngine.isReferenceSpeech(remaining);
        if (interimRef || (!this.speedConfig.requireSentenceBoundary && remaining.length >= 8)) {
          void this.processChunk(remaining, false);
        }

        const interimWordCount = remaining.split(/\s+/).filter(Boolean).length;
        if (
          !this.speedConfig.requireSentenceBoundary &&
          !interimRef &&
          interimWordCount >= this.speedConfig.minWords &&
          remaining !== this.lastInterimSearched
        ) {
          this.scheduleLiveQuoteSearch(remaining);
        }
      } else {
        this.upsertInterim("", audio_start, audio_end);
        this.speechBuffer = "";
      }

      if (completed.length > 0) {
        this.flushTranscriptPush();
      } else {
        this.scheduleThrottledTranscriptPush();
      }
    }
  }

  private processLineQuoteSearch(lineText: string): void {
    const trimmed = lineText.trim();
    if (!trimmed) return;

    const isRef = this.scriptureEngine.isReferenceSpeech(trimmed);
    if (isRef) {
      void this.processChunk(trimmed, true);
      return;
    }

    this.onTranscriptFinal(trimmed);
  }

  private setupVisibilityListeners(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    if (!this.visibilityHandler) {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          this.flushTranscriptPush();
          this.pushCandidates();
          this.pushStatus();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    if (!this.focusHandler) {
      this.focusHandler = () => {
        this.flushTranscriptPush();
        this.pushCandidates();
        this.pushStatus();
      };
      window.addEventListener("focus", this.focusHandler);
    }
  }

  async startListening(micId?: string, options: { reconnect?: boolean } = {}): Promise<void> {
    if (!options.reconnect) {
      this.shouldKeepListening = true;
      this.reconnectAttempts = 0;
      this.audioRecoveryAttempts = 0;
    }
    this.activeMicId = micId;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    console.log("[lmDockService] 🎤 startListening() called, micId:", micId, "currentStatus:", this.snapshot.status, "reconnect:", !!options.reconnect);
    vaiDiag("startListening", { reconnect: !!options.reconnect, micId: micId ?? null, caller: vaiCaller(), ...this.diagState() });
    if (this.startInFlight) {
      return;
    }
    if (
      !options.reconnect &&
      (this.snapshot.status === "listening" ||
        this.snapshot.status === "connecting" ||
        this.snapshot.status === "requesting-mic")
    ) {
      return;
    }

    this.startInFlight = true;
    const token = ++this.sessionToken;

    // A manual stop is asynchronous in Tauri. Wait for that native task to
    // finish before starting the next stream, otherwise the new start can be
    // accepted while the old stream still owns the microphone.
    await this.cleanup();
    if (token !== this.sessionToken || !this.shouldKeepListening) {
      this.startInFlight = false;
      return;
    }

    this.detectionSpeed = "sharp";

    // Reset telemetry for new session
    this.telemetry = {
      lastSpeechAt: 0,
      lastSearchAt: 0,
      lastResultsAt: 0,
      speechToSearchMs: 0,
      searchToResultsMs: 0,
      totalLatencyMs: 0,
      searchCount: 0,
      avgLatencyMs: 0,
    };
    this.latencySum = 0;

    const sessionStartAt = options.reconnect
      ? this.snapshot.startedAt ?? Date.now()
      : Date.now();
    if (!options.reconnect) {
      this.inactivityStep = 0;
      this.currentInactivityThresholdMs = LmDockService.INACTIVITY_STEPS_MIN[0] * 60 * 1000;
    }
    this.inactivityPromptActive = false;
    this.inactivityPromptExpiresAt = 0;
    this.lastSpeechReceivedAt = sessionStartAt;
    this.sessionStartTime = sessionStartAt;
    this.lastSessionRecycleAt = sessionStartAt;
    this.turnCommittedText = "";
    this.lastFinalizedLineText = "";
    this.lastFinalizedAt = 0;
    this.setupVisibilityListeners();

    this.snapshot = {
      status: "requesting-mic",
      candidates: [],
      queue: [],
      suggestions: [],
      latestMatch: null,
      matching: false,
      inputLevel: 0,
      startedAt: sessionStartAt,
      lastSpeechAt: sessionStartAt,
      inactivityPrompt: null,
      inactivityNotice: null,
      entries: this.snapshot.entries,
      detectionSpeed: this.detectionSpeed,
    };
    this.scriptureEngine.cancelQuoteSearchPublic();
    this.scriptureEngine = new ScriptureDetectionEngine();
    this.latestSearchId++;
    this.sentenceBuffer = "";
    this.lastQueuedQuoteSearchKey = "";
    this.lastQueuedQuoteSearchAt = 0;
    this.pendingFinalChunks = [];
    this.pendingInterimChunk = null;
    this.pendingQuoteSearch = null;
    this.pushStatus();
    this.startConnectionWatchdog(token);

    let nativeStartCompleted = false;

    try {
      if (!hasTauriInvoke()) {
        throw new Error("Speech listening must run inside the desktop app so the microphone engine can start.");
      }
      if (token !== this.sessionToken) return;

      // Heavy scripture data must not block microphone startup. The first
      // transcript can still trigger lazy loading if this has not finished yet.
      void this.scriptureEngine.preload().catch((err) => {
        console.warn("[LmDockService] Scripture preload failed:", err);
      });

      // No offline Whisper warm-up here: live transcription runs through the
      // native AssemblyAI stream, nothing reads the browser Whisper model, and
      // loading it cost 150–300 MB of RAM on low-memory laptops while offline.

      // A one-minute token from the API (never a key shipped in the app). The API
      // re-checks plan, credits and daily limits, so this also stops a session
      // that is no longer allowed when the stream is recycled or reconnected.
      const apiKey = await getSpeechCredential();
      if (token !== this.sessionToken) return;

      // Listen for transcript events from Rust backend
      this.transcriptUnlisten = await withTimeout(
        safeTauriListen<{
          text: string;
          end_of_turn: boolean;
          audio_start: number;
          audio_end: number;
        }>("assemblyai-transcript", (event) => {
          if (token !== this.sessionToken) return;
          this.handleTranscriptStream(event.payload);
        }),
        LmDockService.MIC_START_TIMEOUT_MS,
        "Microphone startup timed out while preparing audio events.",
      );
      if (token !== this.sessionToken) {
        await this.cleanup();
        return;
      }

      // Listen for status events from Rust backend
      this.statusUnlisten = await withTimeout(
        safeTauriListen<{ status: string }>(
          "assemblyai-status",
          (event) => {
          if (token !== this.sessionToken) return;
          const { status } = event.payload;
          vaiDiag("native status event", { status, ...this.diagState() });
          if (status === "stopped-inactivity" || status === "stopped-screen-off") {
            this.handleNativeGuardStop(status === "stopped-screen-off" ? "screen-off" : "inactivity");
          } else if (status === "connected") {
            this.diagLevelEvents = 0;
            this.diagMaxLevel = 0;
            this.diagLastSummaryAt = Date.now();
            this.reconnectAttempts = 0;
            this.stopConnectionWatchdog();
            this.startAudioSignalMonitor();
            this.snapshot = { ...this.snapshot, status: "listening", error: undefined };
            this.pushStatus();
            this.startInactivityMonitor();
            this.syncNativeGuard();
          } else if (status.startsWith("error")) {
            this.stopConnectionWatchdog();
            this.stopAudioSignalMonitor();
            this.stopInactivityMonitor();
            this.snapshot = { ...this.snapshot, status: "error", error: status };
            this.pushStatus();
            this.recoverFromUnexpectedStreamEnd(status);
          } else if (status === "stopped") {
            this.stopConnectionWatchdog();
            this.stopAudioSignalMonitor();
            this.stopInactivityMonitor();
            this.snapshot = { ...this.snapshot, status: "idle" };
            this.pushStatus();
            this.recoverFromUnexpectedStreamEnd("The speech connection closed unexpectedly.");
          }
          },
        ),
        LmDockService.MIC_START_TIMEOUT_MS,
        "Microphone startup timed out while preparing connection events.",
      );
      if (token !== this.sessionToken) {
        await this.cleanup();
        return;
      }

      // Listen for audio level events from Rust backend
      this.levelUnlisten = await withTimeout(
        safeTauriListen<{ level: number }>(
          "assemblyai-audio-level",
          (event) => {
          if (token !== this.sessionToken) return;
          const level = event.payload.level;
          const now = Date.now();
          this.lastAudioSignalAt = now;
          this.diagLevelEvents += 1;
          if (level > this.diagMaxLevel) this.diagMaxLevel = level;
          if (level > 0.01) {
            this.audioRecoveryAttempts = 0;
          }
          if (this.snapshot.status === "connecting") {
            this.stopConnectionWatchdog();
            this.snapshot = { ...this.snapshot, status: "listening", error: undefined };
            this.pushStatus();
            this.startInactivityMonitor();
          }
          this.snapshot = { ...this.snapshot, inputLevel: level };

          // The meter updates frequently; throttle notifications so the page
          // does not re-render the transcript list on every chunk.
          const shouldNotify =
            now - this.lastLevelNotifyAt >= 250 ||
            Math.abs(level - this.lastLevelValue) >= 0.08 ||
            level === 0;

          if (shouldNotify) {
            this.lastLevelNotifyAt = now;
            this.lastLevelValue = level;
            this.notifyListeners();
          }
          },
        ),
        LmDockService.MIC_START_TIMEOUT_MS,
        "Microphone startup timed out while preparing the audio meter.",
      );
      if (token !== this.sessionToken) {
        await this.cleanup();
        return;
      }

      // Start pause detection timer — checks every 100ms for silence
      this.pauseCheckTimer = setInterval(() => {
        if (this.snapshot.status !== "listening") return;
        const now = Date.now();
        const silenceMs = this.lastSpeechTime > 0 ? now - this.lastSpeechTime : 0;

        if (this.speechBuffer.length > 0 && this.lastSpeechTime > 0) {
          const wordCount = this.speechBuffer.split(/\s+/).filter(Boolean).length;

          // 1. Trigger provisional search quickly after a short pause with enough content
          if (silenceMs > 180 && (this.speechBuffer.length > 8 || wordCount >= this.speedConfig.minWords)) {
            const phrase = this.speechBuffer.trim();
            if (phrase !== this.lastInterimSearched) {
              this.lastInterimSearched = phrase;
              void this.processChunk(phrase, false);
            }
          }
        }

        // 2. Long-session anti-hallucination / refresh:
        // Transparently recycle during natural silence (> 1.5s) if session has run for a long time (> 15 mins).
        if (
          this.sessionStartTime > 0 &&
          now - this.sessionStartTime > 15 * 60 * 1000 &&
          silenceMs > 1500 &&
          now - this.lastSessionRecycleAt > 60_000
        ) {
          this.lastSessionRecycleAt = now;
          this.sessionStartTime = now;
          console.log("[LmDockService] Transparently recycling AssemblyAI stream after 15+ minutes during natural pause...");
          vaiDiag("15-minute recycle during a pause", this.diagState());
          void this.startListening(this.activeMicId, { reconnect: true });
        }
      }, 100);

      // Invoke the Rust backend to start mic capture + AssemblyAI realtime STT.
      // Pass the current user gain so the Rust pipeline applies it from the start.
      const mvSettings = getMvSettings();
      const rawGain = Number(mvSettings.inputGain ?? 150);
      const gainMultiplier = Number.isFinite(rawGain) ? Math.max(0.1, Math.min(5, rawGain / 100)) : 1.5;
      const nativeStartPromise = safeTauriInvoke("start_assemblyai_stream", {
        apiKey,
        deviceId: micId || null,
        detectionSpeed: this.detectionSpeed,
        speechModel: getAdminControls().speech.model,
      });
      void nativeStartPromise
        .then(() => {
          if (token !== this.sessionToken) {
            void this.cleanup();
          }
        })
        .catch(() => {
          // The awaited path below owns visible errors.
        });
      await withTimeout(
        nativeStartPromise,
        LmDockService.MIC_START_TIMEOUT_MS,
        "Microphone start timed out. Check microphone permission, the default input device, or choose another input.",
      );
      nativeStartCompleted = true;
      if (token !== this.sessionToken) {
        await this.cleanup();
        return;
      }
      if (this.snapshot.status === "requesting-mic") {
        this.snapshot = { ...this.snapshot, status: "connecting" };
        this.pushStatus();
      }
      // Apply current gain (separate call so it's live-updatable)
      await safeTauriInvoke("set_microphone_gain", { gain: gainMultiplier }).catch(() => { });
    } catch (err) {
      this.stopConnectionWatchdog();
      if (token !== this.sessionToken) {
        return;
      }
      console.warn("[LmDockService] Failed to start listening:", err);
      const msg = err instanceof Error ? err.message : String(err);
      // Errors thrown from this method happen during startup. Runtime network
      // failures are reported through `assemblyai-status` and handled by the
      // reconnect path there. Retrying an unhandled startup error would keep
      // cycling the UI back to "Requesting Mic" forever.
      const stopStartup = !nativeStartCompleted || err instanceof LmStartupTimeoutError || isLocalStartupFailure(msg);
      if (stopStartup) {
        this.shouldKeepListening = false;
        this.startInFlight = false;
        if (err instanceof LmStartupTimeoutError) {
          this.sessionToken++;
        }
        void this.cleanup();
      }
      this.snapshot = { ...this.snapshot, status: "error", error: msg };
      this.pushStatus();
      if (!stopStartup) {
        this.recoverFromUnexpectedStreamEnd(msg);
      }
    } finally {
      if (token === this.sessionToken) {
        this.startInFlight = false;
      }
    }
  }

  stopListening(): void {
    console.log("[LmDockService] 🛑 stopListening() called. Call stack:\n", new Error().stack);
    vaiDiag("stopListening", { caller: vaiCaller(), ...this.diagState() });
    this.shouldKeepListening = false;
    this.activeMicId = undefined;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sessionToken++;
    this.startInFlight = false;
    this.stopConnectionWatchdog();
    if (this.pauseCheckTimer) {
      clearInterval(this.pauseCheckTimer);
      this.pauseCheckTimer = null;
    }
    if (this.liveQuoteSearchTimer) {
      clearTimeout(this.liveQuoteSearchTimer);
      this.liveQuoteSearchTimer = null;
    }
    if (this.interimSearchTimer) {
      clearTimeout(this.interimSearchTimer);
      this.interimSearchTimer = null;
    }
    if (this.pendingInterimPushTimer) {
      clearTimeout(this.pendingInterimPushTimer);
      this.pendingInterimPushTimer = null;
    }
    this.turnCommittedText = "";
    this.lastFinalizedLineText = "";
    this.lastFinalizedAt = 0;
    this.sessionStartTime = 0;
    this.lastSessionRecycleAt = 0;
    this.speechBuffer = "";
    this.lastSpeechTime = 0;
    this.lastSpeechReceivedAt = 0;
    this.sentenceBuffer = "";
    this.lastInterimSearched = "";
    this.lastQueuedQuoteSearchKey = "";
    this.lastQueuedQuoteSearchAt = 0;
    this.pendingFinalChunks = [];
    this.pendingInterimChunk = null;
    this.pendingQuoteSearch = null;
    this.scriptureEngine.cancelQuoteSearchPublic();
    this.latestSearchId++;
    this.liveQuoteSearchPendingText = "";
    this.lastLevelNotifyAt = 0;
    this.lastLevelValue = 0;

    this.stopAudioSignalMonitor();
    this.stopInactivityMonitor();
    this.inactivityPromptActive = false;
    this.inactivityPromptExpiresAt = 0;
    this.inactivityStep = 0;
    this.currentInactivityThresholdMs = LmDockService.INACTIVITY_STEPS_MIN[0] * 60 * 1000;

    void this.cleanup();

    this.snapshot = {
      ...this.snapshot,
      status: "idle",
      inputLevel: 0,
      startedAt: undefined,
      lastSpeechAt: undefined,
      inactivityPrompt: null,
      entries: [],
      candidates: [],
      queue: [],
      suggestions: [],
      latestMatch: null,
      matching: false,
    };
    this.pushStatus();
    this.pushCandidates();
  }

  // ── Inactivity Detection ──────────────────────────────────────────────────

  private startInactivityMonitor(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
    }
    this.inactivityTimer = setInterval(() => {
      this.checkInactivity();
    }, 1000);
  }

  private stopInactivityMonitor(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private checkInactivity(): void {
    if (this.snapshot.status !== "listening") return;

    const now = Date.now();
    const lastSpeech = this.snapshot.lastSpeechAt ?? this.snapshot.startedAt ?? now;

    if (!this.inactivityPromptActive) {
      if (now - lastSpeech >= this.currentInactivityThresholdMs) {
        vaiDiag("inactivity prompt shown (no speech for the threshold)", this.diagState());
        this.inactivityPromptActive = true;
        this.inactivityPromptExpiresAt = now + LmDockService.INACTIVITY_COUNTDOWN_S * 1000;
        this.snapshot = {
          ...this.snapshot,
          inactivityPrompt: {
            active: true,
            remainingSeconds: LmDockService.INACTIVITY_COUNTDOWN_S,
            intervalMinutes: Math.round(this.currentInactivityThresholdMs / 60_000),
          },
        };
        this.pushStatus();
      }
    } else {
      const remainingSeconds = Math.max(0, Math.ceil((this.inactivityPromptExpiresAt - now) / 1000));
      if (remainingSeconds <= 0) {
        this.stopDueToInactivity();
      } else if (this.snapshot.inactivityPrompt?.remainingSeconds !== remainingSeconds) {
        this.snapshot = {
          ...this.snapshot,
          inactivityPrompt: {
            active: true,
            remainingSeconds,
            intervalMinutes: Math.round(this.currentInactivityThresholdMs / 60_000),
          },
        };
        this.pushStatus();
      }
    }
  }

  confirmStillUsing(): void {
    const now = Date.now();
    const steps = LmDockService.INACTIVITY_STEPS_MIN;
    this.inactivityPromptActive = false;
    this.inactivityPromptExpiresAt = 0;
    this.inactivityStep = Math.min(this.inactivityStep + 1, steps.length - 1);
    this.currentInactivityThresholdMs = steps[this.inactivityStep] * 60 * 1000;
    this.syncNativeGuard();
    this.lastSpeechReceivedAt = now;
    this.snapshot = {
      ...this.snapshot,
      lastSpeechAt: now,
      inactivityPrompt: null,
    };
    this.pushStatus();
  }

  /** Tell the native safety net the current prompt interval (it stops the mic if the UI is frozen). */
  private syncNativeGuard(): void {
    if (!hasTauriInvoke()) return;
    safeTauriInvoke("voice_guard_keep_alive", {
      intervalMinutes: Math.round(this.currentInactivityThresholdMs / 60_000),
    }).catch(() => { });
  }

  /** The native side already stopped the microphone (screen off or no answer to the prompt). */
  private handleNativeGuardStop(reason: "inactivity" | "screen-off"): void {
    vaiDiag("native guard stopped the stream", { reason, ...this.diagState() });
    this.shouldKeepListening = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.inactivityPromptActive = false;
    this.inactivityPromptExpiresAt = 0;
    this.stopInactivityMonitor();
    this.stopListening();
    this.snapshot = {
      ...this.snapshot,
      inactivityPrompt: null,
      inactivityNotice: reason === "screen-off"
        ? "Voice AI stopped because the screen turned off"
        : "Stopped due to inactivity",
    };
    this.pushStatus();
  }

  stopDueToInactivity(): void {
    vaiDiag("stopDueToInactivity", { caller: vaiCaller(), ...this.diagState() });
    this.inactivityPromptActive = false;
    this.inactivityPromptExpiresAt = 0;
    this.stopInactivityMonitor();
    this.stopListening();
    this.snapshot = {
      ...this.snapshot,
      inactivityPrompt: null,
      inactivityNotice: "Stopped due to inactivity",
    };
    this.pushStatus();
  }

  setInactivityNotice(notice: string): void {
    this.snapshot = {
      ...this.snapshot,
      inactivityNotice: notice,
    };
    this.pushStatus();
  }

  clearInactivityNotice(): void {
    if (this.snapshot.inactivityNotice) {
      this.snapshot = {
        ...this.snapshot,
        inactivityNotice: null,
      };
      this.pushStatus();
    }
  }

  /**
   * Update the microphone input gain at runtime (0–500 → 0.0–5.0 multiplier).
   * Calls the Rust-side set_microphone_gain command — no stream restart needed.
   */
  async setInputGain(gainPercent: number): Promise<void> {
    const gain = Math.max(0.1, Math.min(5, gainPercent / 100));
    await safeTauriInvoke("set_microphone_gain", { gain }).catch(() => { });
  }

  private cleanup(): Promise<void> {
    vaiDiag("cleanup (stops the native stream)", { caller: vaiCaller(), ...this.diagState() });
    // Unlisten Tauri event listeners
    this.transcriptUnlisten?.();
    this.transcriptUnlisten = null;
    this.statusUnlisten?.();
    this.statusUnlisten = null;
    this.levelUnlisten?.();
    this.levelUnlisten = null;

    // Cancel pending timers
    this.stopConnectionWatchdog();
    if (this.pauseCheckTimer) {
      clearInterval(this.pauseCheckTimer);
      this.pauseCheckTimer = null;
    }
    this.stopAudioSignalMonitor();
    this.stopInactivityMonitor();
    this.inactivityPromptActive = false;
    if (this.liveQuoteSearchTimer) {
      clearTimeout(this.liveQuoteSearchTimer);
      this.liveQuoteSearchTimer = null;
    }
    this.liveQuoteSearchPendingText = "";
    this.lastLiveQuoteSearchAt = 0;
    if (this.interimSearchTimer) {
      clearTimeout(this.interimSearchTimer);
      this.interimSearchTimer = null;
    }
    if (this.pendingInterimPushTimer) {
      clearTimeout(this.pendingInterimPushTimer);
      this.pendingInterimPushTimer = null;
    }
    this.pendingFinalChunks = [];
    this.pendingInterimChunk = null;
    this.pendingQuoteSearch = null;
    this.scriptureEngine.cancelQuoteSearchPublic();

    // Remove focus/visibility handlers
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.blurHandler) {
      window.removeEventListener("blur", this.blurHandler);
      this.blurHandler = null;
    }
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
      this.focusHandler = null;
    }

    // Stop Rust-side AssemblyAI realtime STT (mic capture + transcription task).
    // Keep one shared promise so a reconnect never races a previous shutdown.
    if (!this.nativeStopPromise) {
      console.log("[LmDockService] 🛑 Invoking safeTauriInvoke('stop_assemblyai_stream'). Call stack:\n", new Error().stack);
      this.nativeStopPromise = Promise.resolve(safeTauriInvoke("stop_assemblyai_stream"))
        .then(() => undefined)
        .catch((err) => {
          console.warn("[LmDockService] Failed to stop voice stream:", err);
        })
        .finally(() => {
          this.nativeStopPromise = null;
        });
    }
    return this.nativeStopPromise;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async getMics(): Promise<Array<{ id: string; label: string }>> {
    // Always use Rust cpal — the entire audio pipeline runs in the Tauri backend.
    // Browser navigator.mediaDevices returns macOS Core Audio UIDs which don't
    // match cpal device names, so we must not mix the two.
    try {
      if (!hasTauriInvoke()) {
        return [{ id: "", label: "Default microphone" }];
      }
      const devices = await safeTauriInvoke<Array<{ id: string; name: string; is_default: boolean }>>(
        "list_audio_devices",
      );
      return devices.map((d) => ({ id: d.id, label: d.name }));
    } catch (err) {
      console.warn("[LmDockService] Failed to list audio devices:", err);
      return [];
    }
  }

  getSnapshot(): LmDockSnapshot {
    return {
      ...this.snapshot,
      detectionSpeed: this.detectionSpeed,
      telemetry: { ...this.telemetry },
    };
  }

  getDiagnostics(): {
    status: LmServiceStatus;
    sessionToken: number;
    startInFlight: boolean;
    activeTimers: number;
    listenerCount: number;
    transcriptListenerActive: boolean;
    statusListenerActive: boolean;
    levelListenerActive: boolean;
    commandPollTimerActive: boolean;
    pauseCheckTimerActive: boolean;
    liveQuoteSearchTimerActive: boolean;
    interimSearchTimerActive: boolean;
    finalizedChunkCount: number;
    recentEmissionCount: number;
    verseHistoryCount: number;
    entryCount: number;
    candidateCount: number;
    queueCount: number;
    suggestionCount: number;
    audioLevel: number;
  } {
    const scriptureCounts = this.scriptureEngine.getDiagnosticCounts();
    return {
      status: this.snapshot.status,
      sessionToken: this.sessionToken,
      startInFlight: this.startInFlight,
      activeTimers: [
        this.pauseCheckTimer,
        this.commandPollTimer,
        this.liveQuoteSearchTimer,
        this.interimSearchTimer,
      ].filter(Boolean).length,
      listenerCount: this.listeners.size,
      transcriptListenerActive: this.transcriptUnlisten != null,
      statusListenerActive: this.statusUnlisten != null,
      levelListenerActive: this.levelUnlisten != null,
      commandPollTimerActive: this.commandPollTimer != null,
      pauseCheckTimerActive: this.pauseCheckTimer != null,
      liveQuoteSearchTimerActive: this.liveQuoteSearchTimer != null,
      interimSearchTimerActive: this.interimSearchTimer != null,
      finalizedChunkCount: scriptureCounts.finalizedChunkCount,
      recentEmissionCount: scriptureCounts.recentEmissionCount,
      verseHistoryCount: scriptureCounts.verseHistoryCount,
      entryCount: this.snapshot.entries.length,
      candidateCount: this.snapshot.candidates.length,
      queueCount: this.snapshot.queue.length,
      suggestionCount: this.snapshot.suggestions.length,
      audioLevel: this.snapshot.inputLevel,
    };
  }

  /**
   * Compatibility shim for older UI/settings callers. The runtime always uses
   * the fixed sharp profile.
   */
  setDetectionSpeed(_speed: DetectionSpeed): void {
    const speed: DetectionSpeed = "sharp";
    this.detectionSpeed = speed;
    this.snapshot = { ...this.snapshot, detectionSpeed: speed };
    this.pushStatus();
    safeTauriInvoke("set_assemblyai_stream_speed", { detectionSpeed: speed }).catch((err) => {
      console.warn("[LmDockService] Failed to update AssemblyAI stream speed:", err);
    });
  }

  /**
   * Get current detection speed.
   */
  getDetectionSpeed(): DetectionSpeed {
    return this.detectionSpeed;
  }
}

export const lmDockService = new LmDockService();
