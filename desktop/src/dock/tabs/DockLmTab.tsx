import { loadLmSettings as loadSettings, saveLmSettings as saveSettings, type LmDockSettings, type LmOverlayMode } from "../../services/lmSettings";
export { normalizeLmOverlayMode } from "../../services/lmSettings";
import { resolveScriptureProjection, isConfidentScriptureSuggestion } from "../../services/scriptureProjection";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Edit2, MonitorUp, Check, StickyNote, MoreHorizontal, X } from "../../components/icons/NativeIcons";
import { useAppTheme } from "../../hooks/useAppTheme";
import { dockObsClient, type DockObsStatus } from "../dockObsClient";
import {
  dockClient,
  DOCK_BIBLE_LIVE_THEME_KEY,
  type DockStateMessage,
  type DockCommandType,
} from "../../services/dockBridge";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import type { VoiceBibleCandidate, TranscriptEntry } from "../../services/voiceBibleTypes";

import { parseScriptureReference } from "../../services/scriptureParser";
import { trackStsPushToLive, trackTranscriptCreated } from "../../services/tracking";
import { onCreditChange, isProUnlocked } from "../../services/credits";
import Icon from "../DockIcon";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { getDockPlan } from "../dockEntitlement";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { getEnvConfig } from "../../services/envConfig";
import type { LmDockSnapshot } from "../../services/lmDockService";
import { publishDockStagedItemToPresentation } from "../../services/presentationDockBridge";
import {
  appendTextToDockNotes,
  resolveDockNotesPresentationSettings,
} from "../dockNotesStorage";
import {
  loadDockBibleOutputPreferences,
  resolveDockBibleReferenceLabels,
  resolveDockBibleThemeForOverlayMode,
} from "../dockBibleThemeResolution";
import {
  pickNewestLiveBibleSnapshot,
  resolveLmEffectiveOverlayMode,
  resolveLmReferencePrefs,
  resolveLmVerseLineCount,
  type LiveBibleStyleHints,
} from "../lmBibleStyle";
import {
  createDockNotesAppendCommand,
  postDockNotesAppendCommand,
} from "../../services/dockNotesInterop";
import { getRecommendedPollingInterval } from "../../services/performanceManager";
import DockNotesTextTools from "../components/DockNotesTextTools";
import { formatNoteText, type NoteTextToolAction } from "../noteTextTools";
import { loadDockSceneRoute } from "../dockSceneRouting";

type LmStatus = "idle" | "requesting-mic" | "connecting" | "listening" | "error";

const PREFERRED_MIC_STORAGE_KEY = "ocs-speech-to-scripture-mic-id";
const HISTORY_STORAGE_KEY = "ocs-lm-dock-history";
const MAX_HISTORY = 50;
const MAX_TRANSCRIPT_LINES = 40;
const MAX_QUEUE_SIZE = 3;
const LM_QUEUE_RETENTION_MS = 90_000;
/**
 * Auto-push only acts on a verse detected moments ago. Anything older is
 * history: it stays clickable, but is never sent to the screen on its own.
 */
export const LM_AUTO_PUSH_MAX_AGE_MS = 15_000;
const LM_LIVE_VERSE_STORAGE_KEY = "ocs-lm-dock-live-verse";
const SUGGESTION_COOLDOWN_MS = 60_000;
// The relay is local-only. Poll often enough for a detected reference to feel live;
// performanceManager still applies a device-specific minimum interval.
const LM_RELAY_POLL_MS = 500;
const LM_RELAY_HIDDEN_POLL_MS = 2_000;
export const LM_COMPACT_HEIGHT_PX = 400;
const DEFAULT_SUGGESTIONS_HEIGHT_PERCENT = 42;
const MIN_SUGGESTIONS_HEIGHT_PERCENT = 18;
const MAX_SUGGESTIONS_HEIGHT_PERCENT = 72;

export function isLmCompactHeight(height: number): boolean {
  return Number.isFinite(height) && height > 0 && height < LM_COMPACT_HEIGHT_PX;
}

function clampSuggestionsHeightPercent(value: number): number {
  return Math.min(
    MAX_SUGGESTIONS_HEIGHT_PERCENT,
    Math.max(MIN_SUGGESTIONS_HEIGHT_PERCENT, value),
  );
}

async function loadLmDockService() {
  const module = await import("../../services/lmDockService");
  return module.lmDockService;
}

interface DockLmTabProps {
  presentationOutputTarget?: DockPresentationOutputTarget;
  enablePresentationMicControls?: boolean;
  onNavigateToBible?: () => void;
}

interface FreshnessInfo {
  label: string;
  color: string;
  level: "fresh" | "warning" | "stale";
}

interface LiveBibleThemeSnapshot extends LiveBibleStyleHints {
  fullscreen?: {
    themeId?: string;
    themeSettings?: Record<string, unknown>;
    liveOverrides?: Record<string, unknown> | null;
  };
  lowerThird?: {
    themeId?: string;
    themeSettings?: Record<string, unknown>;
    liveOverrides?: Record<string, unknown> | null;
  };
}

const BIBLE_BACKGROUND_SETTING_KEYS = [
  "backgroundType",
  "backgroundColor",
  "backgroundColorEnd",
  "bgGradientAngle",
  "backgroundImage",
  "backgroundImageFilePath",
  "backgroundPattern",
  "backgroundVideo",
  "backgroundVideoFilePath",
  "backgroundOpacity",
  "fullscreenShadeEnabled",
  "fullscreenShadeColor",
  "fullscreenShadeOpacity",
  "boxBackground",
  "boxOpacity",
  "boxBackgroundImage",
] as const;

function mergeBibleBackgroundSettings(
  baseSettings: Record<string, unknown>,
  bibleSettings: Record<string, unknown>,
): Record<string, unknown> {
  const backgroundSettings: Record<string, unknown> = {};
  for (const key of BIBLE_BACKGROUND_SETTING_KEYS) {
    if (key in bibleSettings) backgroundSettings[key] = bibleSettings[key];
  }
  return { ...baseSettings, ...backgroundSettings };
}

async function resolveLmBibleTheme(
  overlayMode: LmOverlayMode,
  liveSnapshot: LiveBibleThemeSnapshot | null,
) {
  const resolvedBibleTheme = await resolveDockBibleThemeForOverlayMode(overlayMode);
  const liveTheme = overlayMode === "fullscreen"
    ? liveSnapshot?.fullscreen
    : liveSnapshot?.lowerThird;
  if (!liveTheme?.themeSettings) return resolvedBibleTheme;

  return {
    ...resolvedBibleTheme,
    themeId: liveTheme.themeId || resolvedBibleTheme.themeId,
    themeSettings: liveTheme.themeSettings,
    liveOverrides: liveTheme.liveOverrides === undefined
      ? resolvedBibleTheme.liveOverrides
      : liveTheme.liveOverrides,
  };
}

function loadLiveBibleThemeSnapshot(): LiveBibleThemeSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(getUserScopedKey(DOCK_BIBLE_LIVE_THEME_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveBibleThemeSnapshot;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export interface RetainedLmCandidate {
  key: string;
  candidate: VoiceBibleCandidate;
  detectedAt: number;
  lastSeenAt: number;
}

function getFreshness(detectedAt: number, now: number): FreshnessInfo {
  const elapsed = (now - detectedAt) / 1000;
  if (elapsed <= 10) return { label: `${Math.round(elapsed)}s ago`, color: "#4caf50", level: "fresh" };
  if (elapsed <= 20) return { label: `${Math.round(elapsed)}s ago`, color: "#FFC107", level: "warning" };
  return { label: `~${Math.round(elapsed)}s ago`, color: "#EF4444", level: "stale" };
}

export function isLmAutoPushSuppressed(
  lastPushedAt: number | undefined,
  nowMs: number,
  duplicateWindowSec: number,
): boolean {
  if (!lastPushedAt) return false;
  const windowMs = Math.max(0, Number(duplicateWindowSec) || 0) * 1000;
  return windowMs > 0 && nowMs - lastPushedAt < windowMs;
}

export function getSelectedTranscriptEntries(
  entries: TranscriptEntry[],
  selectedEntryIds: ReadonlySet<string>,
): TranscriptEntry[] {
  return entries.filter((entry) => selectedEntryIds.has(entry.id));
}

export function getLmCandidateKey(candidate: Pick<VoiceBibleCandidate, "book" | "chapter" | "verse">): string {
  return `${candidate.book}:${candidate.chapter}:${candidate.verse}`;
}

/** True when a detection is recent enough to be auto-pushed. Unknown age = not fresh. */
export function isFreshForLmAutoPush(detectedAt: number | undefined, nowMs: number): boolean {
  if (!detectedAt || !Number.isFinite(detectedAt)) return false;
  const age = nowMs - detectedAt;
  return age >= -5_000 && age <= LM_AUTO_PUSH_MAX_AGE_MS;
}

export function claimNextLmAutoPushCandidate<T extends { key: string; candidate: VoiceBibleCandidate }>(
  candidates: T[],
  claimedKeys: Set<string>,
  lastPushedAt: ReadonlyMap<string, number>,
  nowMs: number,
  duplicateWindowSec: number,
): T | null {
  const target = candidates.find(({ key, candidate }) => (
    !claimedKeys.has(key) &&
    !isLmAutoPushSuppressed(
      lastPushedAt.get(getLmCandidateKey(candidate)),
      nowMs,
      duplicateWindowSec,
    )
  ));

  if (target) claimedKeys.add(target.key);
  return target ?? null;
}

export function mergeRetainedLmQueue(
  current: RetainedLmCandidate[],
  incoming: VoiceBibleCandidate[],
  nowMs: number,
  retentionMs = LM_QUEUE_RETENTION_MS,
): RetainedLmCandidate[] {
  const previous = new Map(current.map((item) => [item.key, item]));
  const next = new Map<string, RetainedLmCandidate>();
  for (const [index, candidate] of incoming.entries()) {
    const key = getLmCandidateKey(candidate);
    const existing = previous.get(key);
    const newlySelected = index === 0 && current[0]?.key !== key;
    next.set(key, {
      key,
      candidate,
      detectedAt: candidate.detectedAt ?? (newlySelected || !existing ? nowMs : existing.detectedAt),
      lastSeenAt: nowMs,
    });
  }
  for (const item of current) {
    if (!next.has(item.key) && nowMs - item.lastSeenAt <= retentionMs) next.set(item.key, item);
  }
  return Array.from(next.values())
    .sort((a, b) => b.detectedAt - a.detectedAt)
    .slice(0, 20);
}

function loadPreferredMicId(): string {
  return readNativeDockSetting<string>(PREFERRED_MIC_STORAGE_KEY) || "";
}

function savePreferredMicId(micId: string): void {
  writeNativeDockSetting(PREFERRED_MIC_STORAGE_KEY, micId);
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(HISTORY_STORAGE_KEY));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(getUserScopedKey(HISTORY_STORAGE_KEY), JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { }
}

function loadLiveVerse(): VoiceBibleCandidate | null {
  try {
    const raw = localStorage.getItem(getUserScopedKey(LM_LIVE_VERSE_STORAGE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as VoiceBibleCandidate : null;
  } catch {
    return null;
  }
}

function saveLiveVerse(candidate: VoiceBibleCandidate | null): void {
  try {
    if (candidate) {
      localStorage.setItem(getUserScopedKey(LM_LIVE_VERSE_STORAGE_KEY), JSON.stringify(candidate));
    } else {
      localStorage.removeItem(getUserScopedKey(LM_LIVE_VERSE_STORAGE_KEY));
    }
  } catch { }
}


export default function DockLmTab({
  presentationOutputTarget = "obs",
  enablePresentationMicControls = false,
  onNavigateToBible,
}: DockLmTabProps = {}) {
  const { t } = useTranslation();
  useAppTheme();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const allowLocalMicControls = presentationLinkMode && enablePresentationMicControls;
  const isTestEnv = getEnvConfig().isTest;
  const openAppToStartText = isTestEnv
    ? "Open Speech to Scripture in MakeChurchEazy Test on this computer to start listening."
    : allowLocalMicControls
      ? "Choose a microphone in settings, then start listening from this presentation page."
      : t("lm.openAppToStart");
  const pushActionLabel = t("common.sendToObs", "Send to OBS");
  const pushActionTitle = t("common.sendToObs", "Send to OBS");
  const transcriptPushLabel = t("common.sendToObs", "Send to OBS");
  const transcriptPushShortLabel = t("common.sendToObs", "Send to OBS");

  const [settings, setSettings] = useState<LmDockSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const updateSetting = useCallback(<K extends keyof LmDockSettings>(key: K, value: LmDockSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }, []);

  const [obsStatus, setObsStatus] = useState<DockObsStatus>("disconnected");

  useEffect(() => {
    if (presentationLinkMode) return () => { };
    const unsub = dockObsClient.onStatusChange((status) => setObsStatus(status));
    void dockObsClient.connect();
    return unsub;
  }, [presentationLinkMode]);

  const [appConnected, setAppConnected] = useState(false);
  const [dockPlan, setDockPlan] = useState(() => getDockPlan());
  const isFreePlan = dockPlan === "free";

  useEffect(() => {
    dockClient.init();
    const unsub = dockClient.onState((msg: DockStateMessage) => {
      if (msg.type === "state:pong") {
        setAppConnected(true);
      }
      if (msg.type === "state:plan-update") {
        setDockPlan(getDockPlan());
      }
    });
    dockClient.sendCommand({ type: "ping", timestamp: Date.now() });
    const interval = setInterval(() => {
      dockClient.sendCommand({ type: "ping", timestamp: Date.now() });
    }, 5000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const [lmStatus, setLmStatus] = useState<LmStatus>("idle");
  const [lmSessionStartedAt, setLmSessionStartedAt] = useState<number | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [candidates, setCandidates] = useState<VoiceBibleCandidate[]>([]);
  const [retainedQueue, setRetainedQueue] = useState<RetainedLmCandidate[]>([]);
  const [suggestions, setSuggestions] = useState<VoiceBibleCandidate[]>([]);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedMic, setSelectedMic] = useState(() => loadPreferredMicId());
  const [micLoading, setMicLoading] = useState(false);
  const [micError, setMicError] = useState("");

  const pollRelayRef = useRef<(() => Promise<void>) | null>(null);
  const relayBusyRef = useRef(false);

  const [activeTab, setActiveTab] = useState<"up-next" | "transcript" | "history">("up-next");
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [liveVerse, setLiveVerseState] = useState<VoiceBibleCandidate | null>(() => loadLiveVerse());
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [inactivityPrompt, setInactivityPrompt] = useState<{ active: boolean; remainingSeconds: number; intervalMinutes: number } | null>(null);
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);

  const detectedAtRef = useRef<Map<string, number>>(new Map());
  const suggestionCooldownRef = useRef<Map<string, number>>(new Map());
  const autoPushedKeysRef = useRef<Set<string>>(new Set());
  const autoPushInFlightRef = useRef<Set<string>>(new Set());
  const autoPushLastPushedAtRef = useRef<Map<string, number>>(new Map());
  const liveVerseRef = useRef<VoiceBibleCandidate | null>(liveVerse);
  const lastRepublishedOverlayModeRef = useRef<{ key: string; effective: LmOverlayMode } | null>(null);
  const liveBibleThemeSnapshotRef = useRef<LiveBibleThemeSnapshot | null>(loadLiveBibleThemeSnapshot());
  const resolvedProjectionCacheRef = useRef<Map<string, VoiceBibleCandidate>>(new Map());
  const resolvedBibleThemeCacheRef = useRef<Map<LmOverlayMode, { theme: Awaited<ReturnType<typeof resolveLmBibleTheme>>; ts: number; stamp: number }>>(new Map());

  const getProjectionCacheKey = useCallback((c: VoiceBibleCandidate, tr: string) => {
    return `${c.book}:${c.chapter}:${c.verse}:${c.endVerse ?? c.verse}:${tr.trim().toUpperCase()}`;
  }, []);

  const prefetchProjections = useCallback((items: VoiceBibleCandidate[], translation: string) => {
    for (const item of items) {
      if (!item.book || !item.chapter || !item.verse) continue;
      const key = `${item.book}:${item.chapter}:${item.verse}:${item.endVerse ?? item.verse}:${translation.trim().toUpperCase()}`;
      if (resolvedProjectionCacheRef.current.has(key)) continue;
      resolveScriptureProjection(item, translation)
        .then((resolved) => {
          resolvedProjectionCacheRef.current.set(key, resolved);
        })
        .catch(() => { });
    }
  }, []);

  const getCachedLmBibleTheme = useCallback(async (
    overlayMode: LmOverlayMode,
    liveSnapshot: LiveBibleThemeSnapshot | null,
  ) => {
    // The cache is only valid for the exact Bible-tab snapshot it was built
    // from. A newer snapshot (the operator changed text size, theme or
    // background) must never be answered with an older cached style. Without
    // a snapshot the saved Bible preferences are the only source, so keep that
    // cache short.
    const stamp = Number(liveSnapshot?.updatedAt) || 0;
    const maxAgeMs = liveSnapshot?.fullscreen || liveSnapshot?.lowerThird ? 10000 : 2000;
    const cached = resolvedBibleThemeCacheRef.current.get(overlayMode);
    if (cached && cached.stamp === stamp && Date.now() - cached.ts < maxAgeMs) {
      return cached.theme;
    }
    const resolved = await resolveLmBibleTheme(overlayMode, liveSnapshot);
    resolvedBibleThemeCacheRef.current.set(overlayMode, { theme: resolved, ts: Date.now(), stamp });
    return resolved;
  }, []);

  // The Bible tab can live in another OBS dock (another process), where the
  // BroadcastChannel never reaches us. Its snapshot is also written to
  // localStorage, so read that again whenever we are about to project and
  // keep whichever copy is newer.
  const getLiveBibleSnapshot = useCallback((): LiveBibleThemeSnapshot | null => {
    const newest = pickNewestLiveBibleSnapshot(
      liveBibleThemeSnapshotRef.current,
      loadLiveBibleThemeSnapshot(),
    );
    liveBibleThemeSnapshotRef.current = newest;
    return newest;
  }, []);

  // The mode LM projects in right now: the Bible tab's own mode while LM is
  // following it (default), otherwise LM's Full/LT buttons.
  const getEffectiveLmOverlayMode = useCallback((): LmOverlayMode => resolveLmEffectiveOverlayMode({
    follow: settings.followBibleStyle,
    lmMode: settings.overlayMode,
    hints: getLiveBibleSnapshot(),
    prefs: loadDockBibleOutputPreferences(),
  }), [getLiveBibleSnapshot, settings.followBibleStyle, settings.overlayMode]);

  const setLiveVerse = useCallback((candidate: VoiceBibleCandidate | null) => {
    liveVerseRef.current = candidate;
    setLiveVerseState(candidate);
    saveLiveVerse(candidate);
    if (candidate) {
      detectedAtRef.current.set(getLmCandidateKey(candidate), Date.now());
    }
  }, []);

  const syncQueueSnapshot = useCallback((incoming: VoiceBibleCandidate[]) => {
    const nowMs = Date.now();
    setRetainedQueue((current) => mergeRetainedLmQueue(current, incoming, nowMs));
    for (const candidate of incoming) {
      detectedAtRef.current.set(getLmCandidateKey(candidate), candidate.detectedAt ?? detectedAtRef.current.get(getLmCandidateKey(candidate)) ?? nowMs);
    }
    prefetchProjections(incoming, settings.translation);
  }, [prefetchProjections, settings.translation]);

  const syncSuggestionSnapshot = useCallback((
    incoming: VoiceBibleCandidate[],
    clearEmpty = false,
  ) => {
    if (incoming.length > 0) {
      const nowMs = Date.now();
      for (const candidate of incoming) {
        detectedAtRef.current.set(getLmCandidateKey(candidate), candidate.detectedAt ?? detectedAtRef.current.get(getLmCandidateKey(candidate)) ?? nowMs);
      }
      prefetchProjections(incoming, settings.translation);
    }
    // A relay poll can briefly return the previous empty state while a new
    // search result is being posted. Do not erase a clickable suggestion
    // during an active listening session; explicit session resets may clear.
    if (incoming.length > 0 || clearEmpty) {
      setSuggestions(incoming);
    }
  }, [prefetchProjections, settings.translation]);

  // ── Pinned verses ──
  const PINNED_STORAGE_KEY = "ocs-lm-dock-pinned";
  const [pinnedVerses, setPinnedVerses] = useState<VoiceBibleCandidate[]>(() => {
    try {
      const raw = localStorage.getItem(getUserScopedKey(PINNED_STORAGE_KEY));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const savePinned = useCallback((verses: VoiceBibleCandidate[]) => {
    try { localStorage.setItem(getUserScopedKey(PINNED_STORAGE_KEY), JSON.stringify(verses)); } catch { }
  }, []);

  const applyLmSnapshot = useCallback((snapshot: LmDockSnapshot) => {
    setAppConnected(true);
    setLmStatus(snapshot.status);
    setLmSessionStartedAt((current) => (
      typeof snapshot.startedAt === "number"
        ? snapshot.startedAt
        : snapshot.status === "idle" ? null : current
    ));
    setEntries(snapshot.entries);
    setCandidates(snapshot.candidates);
    syncQueueSnapshot(snapshot.queue);
    syncSuggestionSnapshot(
      snapshot.suggestions,
      snapshot.status === "idle" || snapshot.status === "requesting-mic" || snapshot.status === "connecting",
    );
    setMatching(snapshot.matching);
    setError(snapshot.error ?? null);
  }, [syncQueueSnapshot, syncSuggestionSnapshot]);

  const selectPresentationMic = useCallback((micId: string) => {
    setSelectedMic(micId);
    savePreferredMicId(micId);
  }, []);

  const refreshPresentationMics = useCallback(async () => {
    if (!allowLocalMicControls) return;
    setMicLoading(true);
    setMicError("");
    try {
      const service = await loadLmDockService();
      const devices = await service.getMics();
      setMics(devices);
      if (devices.length > 0) {
        const savedMic = loadPreferredMicId();
        const selectedStillAvailable = selectedMic && devices.some((device) => device.id === selectedMic);
        const savedStillAvailable = savedMic && devices.some((device) => device.id === savedMic);
        if (!selectedStillAvailable) {
          selectPresentationMic(savedStillAvailable ? savedMic : devices[0].id);
        }
      }
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Could not load microphones.");
    } finally {
      setMicLoading(false);
    }
  }, [allowLocalMicControls, selectPresentationMic, selectedMic]);

  const handlePinVerse = useCallback((c: VoiceBibleCandidate) => {
    setPinnedVerses((prev) => {
      const key = `${c.book}:${c.chapter}:${c.verse}`;
      const exists = prev.some((p) => `${p.book}:${p.chapter}:${p.verse}` === key);
      if (exists) return prev;
      const next = [...prev, c];
      savePinned(next);
      return next;
    });
  }, [savePinned]);

  const handleUnpinVerse = useCallback((key: string) => {
    setPinnedVerses((prev) => {
      const next = prev.filter((p) => `${p.book}:${p.chapter}:${p.verse}` !== key);
      savePinned(next);
      return next;
    });
  }, [savePinned]);

  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [proUnlocked] = useState(() => isProUnlocked());

  useEffect(() => {
    const unsub = onCreditChange((newBalance) => {
      setCreditBalance(newBalance);
    });
    return unsub;
  }, []);

  const creditLabel = proUnlocked ? "Full" : creditBalance > 0 ? `${creditBalance} cr` : null;

  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // ── Transcript interaction state ──
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; entryId: string | null }>({
    visible: false, x: 0, y: 0, entryId: null,
  });
  const [editModal, setEditModal] = useState<{ visible: boolean; text: string }>({
    visible: false, text: "",
  });
  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionActionsRef = useRef<HTMLDivElement | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const [suggestionsHeightPercent, setSuggestionsHeightPercent] = useState(DEFAULT_SUGGESTIONS_HEIGHT_PERCENT);
  const [isResizingSuggestions, setIsResizingSuggestions] = useState(false);
  const [rootHeight, setRootHeight] = useState(() => (
    typeof window === "undefined" ? 0 : window.innerHeight
  ));
  const [now, setNow] = useState(Date.now());
  const isCompactHeight = isLmCompactHeight(rootHeight);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenu.visible) setContextMenu(prev => ({ ...prev, visible: false }));
      if (
        selectionActionsOpen &&
        !selectionActionsRef.current?.contains(event.target as Node)
      ) {
        setSelectionActionsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [contextMenu.visible, selectionActionsOpen]);

  // ── Polling / BroadcastChannel ──
  useEffect(() => {
    const unsub = dockClient.onState((msg: DockStateMessage) => {
      if (msg.type === "state:lm-status") {
        const payload = msg.payload as {
          status: LmStatus;
          startedAt?: number;
          entries?: TranscriptEntry[];
          suggestions?: VoiceBibleCandidate[];
          matching: boolean;
          error?: string;
          inactivityPrompt?: { active: boolean; remainingSeconds: number; intervalMinutes: number } | null;
          inactivityNotice?: string | null;
        };
        setLmStatus(payload.status);
        setLmSessionStartedAt((current) => (
          typeof payload.startedAt === "number"
            ? payload.startedAt
            : payload.status === "idle" ? null : current
        ));
        if (payload.entries) setEntries(payload.entries);
        if (payload.suggestions) {
          syncSuggestionSnapshot(
            payload.suggestions,
            payload.status === "idle" || payload.status === "requesting-mic" || payload.status === "connecting",
          );
        }
        setMatching(payload.matching);
        setError(payload.error ?? null);
        if (payload.inactivityPrompt !== undefined) {
          setInactivityPrompt(payload.inactivityPrompt);
        }
        if (payload.inactivityNotice !== undefined) {
          setInactivityNotice(payload.inactivityNotice);
        }
      } else if (msg.type === "state:lm-transcript") {
        const payload = msg.payload as { entries: TranscriptEntry[] };
        setEntries(payload.entries);
      } else if (msg.type === "state:lm-candidates") {
        const payload = msg.payload as {
          candidates: VoiceBibleCandidate[];
          queue?: VoiceBibleCandidate[];
          suggestions?: VoiceBibleCandidate[];
        };
        setCandidates(payload.candidates);
        prefetchProjections(payload.candidates, settings.translation);
        if (payload.queue) syncQueueSnapshot(payload.queue);
        if (payload.suggestions) syncSuggestionSnapshot(payload.suggestions);
      } else if (msg.type === "state:bible-theme-updated") {
        const payload = msg.payload as LiveBibleThemeSnapshot | null;
        if (payload && typeof payload === "object") {
          liveBibleThemeSnapshotRef.current = payload;
          resolvedBibleThemeCacheRef.current.clear();
        }
      }
    });

    const pollRelay = async () => {
      if (relayBusyRef.current) return;
      relayBusyRef.current = true;
      try {
        const res = await fetch(`${getOverlayBaseUrlSync()}/api/lm-state`);
        const state = await res.json();
        // The relay lives inside the app's own local server: any answer means
        // the app is running, even before Verse AI has published a status.
        if (res.ok) setAppConnected(true);
        if (state && state.status) {
          setAppConnected(true);
          setLmStatus(state.status);
          setLmSessionStartedAt((current) => (
            typeof state.startedAt === "number"
              ? state.startedAt
              : state.status === "idle" ? null : current
          ));
          if (state.entries) setEntries(state.entries);
          setMatching(state.matching ?? false);
          setError(state.error ?? null);
          if (state.candidates) {
            setCandidates(state.candidates);
            prefetchProjections(state.candidates, settings.translation);
          }
          if (state.queue) syncQueueSnapshot(state.queue);
          if (state.suggestions) {
            syncSuggestionSnapshot(
              state.suggestions,
              state.status === "idle" || state.status === "requesting-mic" || state.status === "connecting",
            );
          }
          if (state.inactivityPrompt !== undefined) {
            setInactivityPrompt(state.inactivityPrompt);
          }
          if (state.inactivityNotice !== undefined) {
            setInactivityNotice(state.inactivityNotice);
          }
        }
      } catch (err) {
        console.warn("[DockLmTab] pollRelay FAILED:", err);
      } finally {
        relayBusyRef.current = false;
      }
    };
    const getRelayPollInterval = () =>
      document.visibilityState === "hidden"
        ? getRecommendedPollingInterval(LM_RELAY_HIDDEN_POLL_MS)
        : getRecommendedPollingInterval(LM_RELAY_POLL_MS);
    let relayTimer: number | null = null;
    let stopped = false;
    const scheduleRelayPoll = () => {
      if (stopped) return;
      relayTimer = window.setTimeout(async () => {
        relayTimer = null;
        await pollRelay();
        scheduleRelayPoll();
      }, getRelayPollInterval());
    };

    pollRelayRef.current = pollRelay;
    void pollRelay();
    scheduleRelayPoll();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && pollRelayRef.current) {
        if (relayTimer) window.clearTimeout(relayTimer);
        void pollRelayRef.current();
        scheduleRelayPoll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      unsub();
      if (relayTimer) window.clearTimeout(relayTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [syncQueueSnapshot, syncSuggestionSnapshot]);

  useEffect(() => {
    if (!allowLocalMicControls) return undefined;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void loadLmDockService().then((service) => {
      if (cancelled) return;
      unsubscribe = service.subscribe(applyLmSnapshot);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [allowLocalMicControls, applyLmSnapshot]);

  useEffect(() => {
    if (!allowLocalMicControls) return;
    void refreshPresentationMics();
  }, [allowLocalMicControls, refreshPresentationMics]);

  useEffect(() => {
    const all = [...retainedQueue.map((item) => item.candidate), ...suggestions];
    for (const c of all) {
      const key = getLmCandidateKey(c);
      if (!detectedAtRef.current.has(key)) {
        detectedAtRef.current.set(key, Date.now());
      }
    }
  }, [retainedQueue, suggestions]);

  const hasFreshnessItems = retainedQueue.length > 0 || suggestions.length > 0;

  useEffect(() => {
    if (!hasFreshnessItems) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasFreshnessItems]);

  useEffect(() => {
    if (settings.autoScroll && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [entries, settings.autoScroll]);

  const pushBibleCandidateToOutput = useCallback(async (
    candidate: VoiceBibleCandidate,
    overlayMode: LmOverlayMode,
  ) => {
    const cacheKey = getProjectionCacheKey(candidate, settings.translation);
    let resolvedCandidate = resolvedProjectionCacheRef.current.get(cacheKey);
    if (!resolvedCandidate) {
      resolvedCandidate = await resolveScriptureProjection(candidate, settings.translation);
      resolvedProjectionCacheRef.current.set(cacheKey, resolvedCandidate);
    }
    candidate = resolvedCandidate;

    // Use the Bible tab's current style: its newest theme snapshot, plus the
    // reference format and line count it is using for this mode.
    const liveSnapshot = getLiveBibleSnapshot();
    const savedBiblePrefs = loadDockBibleOutputPreferences();
    const bibleTheme = await getCachedLmBibleTheme(overlayMode, liveSnapshot);
    const lineCount = resolveLmVerseLineCount(overlayMode, liveSnapshot, savedBiblePrefs);
    const verseRange = candidate.endVerse ? `${candidate.verse}-${candidate.endVerse}` : String(candidate.verse);
    const referenceLabels = resolveDockBibleReferenceLabels(
      candidate.book,
      candidate.chapter,
      verseRange,
      settings.translation,
      resolveLmReferencePrefs(liveSnapshot, savedBiblePrefs),
    );
    trackStsPushToLive();

    if (presentationLinkMode) {
      await publishDockStagedItemToPresentation({
        type: "bible",
        label: referenceLabels.displayReferenceLabel,
        subtitle: candidate.snippet,
        data: {
          book: candidate.book,
          chapter: candidate.chapter,
          verse: candidate.verse,
          verseEnd: candidate.endVerse ?? candidate.verse,
          verseRange,
          rawReferenceLabel: referenceLabels.rawReferenceLabel,
          referenceLabel: referenceLabels.displayReferenceLabel,
          displayReferenceLabel: referenceLabels.displayReferenceLabel,
          referenceBaseLabel: referenceLabels.referenceBaseLabel,
          translation: settings.translation,
          verseText: candidate.snippet,
          ...(lineCount ? { lineCount } : {}),
          overlayMode,
          theme: bibleTheme.themeId,
          bibleThemeSettings: bibleTheme.themeSettings,
          liveOverrides: bibleTheme.liveOverrides,
          _dockLive: true,
        },
      });
      return candidate;
    }

    const targetScene = settings.pushScene === "ai" ? "MCE Presentation" : undefined;
    const stageData: Parameters<typeof dockObsClient.pushBible>[0] = {
      book: candidate.book,
      chapter: candidate.chapter,
      verse: candidate.verse,
      verseEnd: candidate.endVerse ?? candidate.verse,
      verseRange,
      translation: settings.translation,
      rawReferenceLabel: referenceLabels.rawReferenceLabel,
      referenceLabel: referenceLabels.displayReferenceLabel,
      displayReferenceLabel: referenceLabels.displayReferenceLabel,
      referenceBaseLabel: referenceLabels.referenceBaseLabel,
      verseText: candidate.snippet,
      ...(lineCount ? { lineCount } : {}),
      overlayMode,
      theme: bibleTheme.themeId,
      bibleThemeSettings: bibleTheme.themeSettings,
      liveOverrides: bibleTheme.liveOverrides,
      targetScene,
    };
    // Keep the theme's live overrides (full-screen background preset). They
    // used to be dropped here, so a verse sent from LM could look different
    // from the same verse sent from the Bible tab.
    const overlayPayload = {
      verseText: candidate.snippet,
      referenceText: referenceLabels.displayReferenceLabel,
      verseRange,
      ...(lineCount ? { lineCount } : {}),
      bibleThemeSettings: bibleTheme.themeSettings,
      liveOverrides: bibleTheme.liveOverrides,
      themeId: bibleTheme.themeId,
      overlayMode,
    };
    const pushLive = () => dockObsClient.pushBibleOverlayFast(overlayPayload);

    const bibleSceneRoute = loadDockSceneRoute("bible");
    if (bibleSceneRoute.enabled && bibleSceneRoute.targets.length > 0) {
      await Promise.all(bibleSceneRoute.targets.map((target) => dockObsClient.pushBibleToScene(
        target.mode === "inherit" ? stageData : { ...stageData, overlayMode: target.mode },
        target.sceneName,
      )));
      if (bibleSceneRoute.syncPresentation) await pushLive();
      return candidate;
    }

    await pushLive();
    return candidate;
  }, [getCachedLmBibleTheme, getLiveBibleSnapshot, getProjectionCacheKey, presentationLinkMode, settings.pushScene, settings.translation]);

  // Re-project the verse that is live when the operator changes how LM
  // projects (Bible / Full / LT buttons). Changes made in the Bible tab are
  // not republished from here: the Bible tab owns its own output.
  useEffect(() => {
    const key = `${settings.followBibleStyle ? "bible" : "own"}|${settings.overlayMode}`;
    const effectiveMode = getEffectiveLmOverlayMode();
    const last = lastRepublishedOverlayModeRef.current;
    lastRepublishedOverlayModeRef.current = { key, effective: effectiveMode };
    // First run, or one of the other dependencies changed (OBS connected,
    // translation...): not a reason to touch what is on the output. The Bible
    // tab changing its own mode must not republish LM's verse either.
    if (!last || last.key === key) return;
    // The buttons changed but the resulting mode did not: nothing to redo.
    if (last.effective === effectiveMode) return;
    const live = liveVerseRef.current;
    if (!live) return;
    if (!presentationLinkMode && obsStatus !== "connected") return;

    setPushError(null);
    void pushBibleCandidateToOutput(live, effectiveMode)
      .then((projected) => {
        setLiveVerse(projected);
        setPushSuccess(effectiveMode === "lower-third" ? "Switched to LT" : "Switched to Full");
        setTimeout(() => setPushSuccess(null), 1600);
      })
      .catch((err) => {
        setPushError(err instanceof Error ? err.message : String(err));
      });
  }, [getEffectiveLmOverlayMode, obsStatus, presentationLinkMode, pushBibleCandidateToOutput, setLiveVerse, settings.followBibleStyle, settings.overlayMode]);

  const sendLmCommand = useCallback((type: DockCommandType, payload?: unknown) => {
    const cmd = {
      type,
      payload: payload ?? {},
      commandId: `lm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    dockClient.sendCommand(cmd);
    fetch(`${getOverlayBaseUrlSync()}/api/lm-command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      keepalive: true,
    }).catch(() => { });
  }, []);

  const navigateBibleDock = useCallback((
    reference: Pick<VoiceBibleCandidate, "book" | "chapter" | "verse">,
    pushToPreview = false,
    markLive = false,
  ) => {
    sendLmCommand("lm:navigate", {
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
      translation: settings.translation,
      ...(pushToPreview ? { pushToPreview: true } : {}),
      // LM already projected this verse; the Bible tab only needs to mark it live.
      ...(markLive ? { markLive: true } : {}),
    });
  }, [sendLmCommand, settings.translation]);

  // ── Show/push detected scripture ──
  const handlePushVerse = useCallback(async (candidate: VoiceBibleCandidate, source?: "queue" | "suggestion") => {
    if (!presentationLinkMode && obsStatus !== "connected") {
      setPushError(t("lm.notConnected"));
      return false;
    }

    // Showing an AI match should also move the Bible dock to the exact
    // reference, so the operator can continue from the neighboring verses.
    // Defer non-critical navigation so it doesn't block or race with the live OBS push!
    setTimeout(() => {
      onNavigateToBible?.();
      navigateBibleDock(candidate);
    }, 0);

    setPushing(true);
    setPushError(null);
    setPushSuccess(null);
    try {
      const overlayMode = getEffectiveLmOverlayMode();
      candidate = await pushBibleCandidateToOutput(candidate, overlayMode);
      setLiveVerse(candidate);
      // The verse is on the output now: tell the Bible tab so its list stays
      // on this verse and it knows this is what is live (it will not push its
      // own, older verse over it when the operator changes size or theme).
      navigateBibleDock(candidate, false, true);
      setRetainedQueue((current) => mergeRetainedLmQueue(current, [candidate], Date.now()));

      if (source === "suggestion") {
        suggestionCooldownRef.current.set(getLmCandidateKey(candidate), Date.now());
      }

      setHistory((prev) => {
        const next = [candidate.label, ...prev.filter((h) => h !== candidate.label)].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });

      setPushSuccess(`${t("lm.pushed")} ${candidate.label}`);
      setTimeout(() => setPushSuccess(null), 4000);
      return true;
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPushing(false);
    }
  }, [getEffectiveLmOverlayMode, navigateBibleDock, obsStatus, onNavigateToBible, presentationLinkMode, pushBibleCandidateToOutput, setLiveVerse, t]);

  // ── Show/push transcript text ──
  const pushTranscriptToOBS = useCallback(async (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) {
      showToast("Nothing to push");
      return;
    }
    if (!presentationLinkMode && obsStatus !== "connected") {
      showToast(t("lm.notConnected"));
      return;
    }
    setPushing(true);
    try {
      const effectiveMode = getEffectiveLmOverlayMode();
      const notesSettings = await resolveDockNotesPresentationSettings(effectiveMode, {
        forceOverlayMode: true,
      });
      const bibleTheme = await resolveLmBibleTheme(effectiveMode, getLiveBibleSnapshot());
      const obsData = {
        sectionText: cleanText,
        sectionLabel: "Transcript Note",
        songTitle: "Transcript Note",
        overlayMode: notesSettings.overlayMode,
        bibleThemeSettings: mergeBibleBackgroundSettings(
          notesSettings.themeSettings ?? {},
          bibleTheme.themeSettings,
        ),
        liveOverrides: null,
        backgroundOnly: false,
      };

      if (presentationLinkMode) {
        await publishDockStagedItemToPresentation({
          type: "notes",
          label: "Transcript Note",
          subtitle: cleanText,
          data: {
            ...obsData,
            theme: notesSettings.themeId,
            _dockLive: true,
          },
        });
        showToast("Shown on presentation screen");
        return;
      }

      const notesSceneRoute = loadDockSceneRoute("notes");
      if (notesSceneRoute.enabled && notesSceneRoute.targets.length > 0) {
        await Promise.all(notesSceneRoute.targets.map((target) => dockObsClient.pushNotesToScene(
          target.mode === "inherit" ? obsData : { ...obsData, overlayMode: target.mode },
          target.sceneName,
        )));
        if (notesSceneRoute.syncPresentation) {
          await dockObsClient.pushNotesOverlayFast(obsData);
        }
        showToast("Pushed to OBS");
        return;
      }

      const bringNotesForward = dockObsClient
        .bringNotesOverlayForward(notesSettings.overlayMode)
        .catch(() => { });

      void bringNotesForward
        .then(() => dockObsClient.primeNotesOverlay(obsData))
        .catch(() => { });

      await bringNotesForward.then(() => dockObsClient.pushNotesOverlayFast(obsData));

      showToast("Pushed to OBS");
    } catch (err) {
      showToast(presentationLinkMode ? "Failed to show on presentation screen" : "Failed to push to OBS");
    } finally {
      setPushing(false);
    }
  }, [getEffectiveLmOverlayMode, getLiveBibleSnapshot, obsStatus, presentationLinkMode, showToast, t]);

  const isListening = lmStatus === "listening" || lmStatus === "connecting" || lmStatus === "requesting-mic";

  const handlePresentationListeningToggle = useCallback(async () => {
    if (!allowLocalMicControls) return;
    if (isListening) {
      setShowStopConfirm(true);
      return;
    }
    setMicError("");
    try {
      if (mics.length === 0) {
        await refreshPresentationMics();
      }
      const service = await loadLmDockService();
      await service.startListening(selectedMic || undefined);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Could not start listening.");
    }
  }, [allowLocalMicControls, isListening, mics.length, refreshPresentationMics, selectedMic]);

  const autoNavigatedReferenceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings.autoNavigate || lmStatus !== "listening") {
      autoNavigatedReferenceRef.current = null;
      return;
    }
    const latest = retainedQueue[0]?.candidate;
    if (!latest) return;
    const key = `${getLmCandidateKey(latest)}:${settings.translation}`;
    if (autoNavigatedReferenceRef.current === key) return;
    autoNavigatedReferenceRef.current = key;
    navigateBibleDock(latest);
  }, [lmStatus, navigateBibleDock, retainedQueue, settings.autoNavigate, settings.translation]);


  // ── Track tab bar width for responsive layout ──
  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTabBarWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The LM dock can be resized independently of the main Dock. Measure its
  // actual container so the short-height layout also works inside OBS and
  // presentation browser sources, not only when the window is resized.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const updateHeight = () => setRootHeight(el.getBoundingClientRect().height);
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const ro = new ResizeObserver(([entry]) => {
      setRootHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const adjustSuggestionsHeight = useCallback((deltaPercent: number) => {
    setSuggestionsHeightPercent((current) => clampSuggestionsHeightPercent(current + deltaPercent));
  }, []);

  const handleSuggestionsResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      adjustSuggestionsHeight(5);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      adjustSuggestionsHeight(-5);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSuggestionsHeightPercent(MAX_SUGGESTIONS_HEIGHT_PERCENT);
    } else if (event.key === "End") {
      event.preventDefault();
      setSuggestionsHeightPercent(MIN_SUGGESTIONS_HEIGHT_PERCENT);
    }
  }, [adjustSuggestionsHeight]);

  const startSuggestionsResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const tabContent = event.currentTarget.parentElement?.parentElement;
    const tabContentHeight = tabContent?.getBoundingClientRect().height ?? 0;
    if (tabContentHeight <= 0) return;

    const startY = event.clientY;
    const startHeightPercent = suggestionsHeightPercent;
    setIsResizingSuggestions(true);

    const updateHeight = (clientY: number) => {
      const deltaPercent = ((clientY - startY) / tabContentHeight) * 100;
      setSuggestionsHeightPercent(
        clampSuggestionsHeightPercent(startHeightPercent - deltaPercent),
      );
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateHeight(moveEvent.clientY);
    };
    const stopResize = () => {
      setIsResizingSuggestions(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [suggestionsHeightPercent]);

  // ── Auto-navigate inside the dock only ──
  useEffect(() => {
    if (!settings.autoNavigate) return;
    if (candidates.length === 0) return;
    const best = candidates[0];
    if (!best) return;

    navigateBibleDock(best);
  }, [candidates, settings.autoNavigate, navigateBibleDock]);

  const confirmStop = useCallback(() => {
    if (allowLocalMicControls) {
      void loadLmDockService().then((service) => service.stopListening());
    } else {
      sendLmCommand("lm:stop");
    }
    setShowStopConfirm(false);
  }, [allowLocalMicControls, sendLmCommand]);

  const handleConfirmStillUsing = useCallback(async () => {
    setInactivityPrompt(null);
    if (allowLocalMicControls) {
      const service = await loadLmDockService();
      service.confirmStillUsing();
    } else {
      sendLmCommand("lm:keep-listening");
    }
  }, [allowLocalMicControls, sendLmCommand]);

  const handleInactivityStop = useCallback(async () => {
    setInactivityPrompt(null);
    if (allowLocalMicControls) {
      const service = await loadLmDockService();
      service.stopDueToInactivity();
    } else {
      sendLmCommand("lm:stop");
    }
  }, [allowLocalMicControls, sendLmCommand]);

  useEffect(() => {
    if (!inactivityNotice) return;
    const timer = setTimeout(() => {
      setInactivityNotice(null);
      void loadLmDockService().then((s) => s.clearInactivityNotice());
    }, 6000);
    return () => clearTimeout(timer);
  }, [inactivityNotice]);

  const processedQueue = useMemo(() => {
    const seen = new Set<string>();
    const result: VoiceBibleCandidate[] = [];
    for (const retained of retainedQueue) {
      const item = retained.candidate;
      const key = retained.key;
      detectedAtRef.current.set(key, retained.detectedAt);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result.slice(0, MAX_QUEUE_SIZE);
  }, [retainedQueue]);

  const queueVerses = processedQueue;
  const suggestionExpiryMs = Math.max(5, Number(settings.suggestionLifetime) || 20) * 1000;
  const queuedVerseKeys = useMemo(() => new Set(processedQueue.map((c) => getLmCandidateKey(c))), [processedQueue]);
  const pinnedVerseKeys = useMemo(
    () => new Set(pinnedVerses.map((candidate) => getLmCandidateKey(candidate))),
    [pinnedVerses],
  );

  const filteredSuggestions = useMemo(() => {
    const nowMs = Date.now();
    return suggestions.filter((s) => {
      const key = getLmCandidateKey(s);
      if (queuedVerseKeys.has(key)) return false;
      const detectedAt = detectedAtRef.current.get(key) ?? nowMs;
      // Keep the last usable suggestion mounted while speech is active. A
      // relay poll can briefly expose an older or empty snapshot between a
      // match and its follow-up update, which otherwise makes the panel blink.
      if (!isListening && nowMs - detectedAt > suggestionExpiryMs) return false;
      const cooldownAt = suggestionCooldownRef.current.get(key);
      if (cooldownAt && nowMs - cooldownAt < SUGGESTION_COOLDOWN_MS) return false;
      return true;
    });
  }, [isListening, queuedVerseKeys, suggestionExpiryMs, suggestions, now]);

  useEffect(() => {
    // Forget an auto-pushed detection only once it is far too old to be pushed
    // again. Forgetting it as soon as it left the list let it be pushed again
    // when a later snapshot brought the same old detection back.
    const nowMs = Date.now();
    for (const key of Array.from(autoPushedKeysRef.current)) {
      const detectedAt = Number(key.slice(key.lastIndexOf(":") + 1));
      if (!Number.isFinite(detectedAt) || nowMs - detectedAt > 10 * 60_000) {
        autoPushedKeysRef.current.delete(key);
      }
    }
  }, [filteredSuggestions, queueVerses]);

  useEffect(() => {
    if (!settings.autoPushQueue && !settings.autoPushSuggestions) return;
    // Auto-push follows live speech only; nothing is pushed while not listening.
    if (!isListening) return;
    if (!presentationLinkMode && obsStatus !== "connected") return;
    if (pushing || autoPushInFlightRef.current.size > 0) return;
    const nowMs = Date.now();

    const candidatesToPush: Array<{
      key: string;
      source: "queue" | "suggestion";
      candidate: VoiceBibleCandidate;
    }> = [];

    if (settings.autoPushQueue) {
      for (const candidate of queueVerses) {
        if (!isFreshForLmAutoPush(candidate.detectedAt, nowMs)) continue;
        candidatesToPush.push({
          key: `queue:${getLmCandidateKey(candidate)}:${candidate.detectedAt ?? "legacy"}`,
          source: "queue",
          candidate,
        });
      }
    }

    if (settings.autoPushSuggestions) {
      for (const candidate of filteredSuggestions.slice(0, 1).filter(isConfidentScriptureSuggestion)) {
        if (!isFreshForLmAutoPush(candidate.detectedAt, nowMs)) continue;
        candidatesToPush.push({
          key: `suggestion:${getLmCandidateKey(candidate)}:${candidate.detectedAt ?? "legacy"}`,
          source: "suggestion",
          candidate,
        });
      }
    }

    const target = claimNextLmAutoPushCandidate(
      candidatesToPush,
      autoPushedKeysRef.current,
      autoPushLastPushedAtRef.current,
      nowMs,
      settings.autoPushDedupWindow,
    );
    if (!target) return;

    // Send one verse at a time. Other candidates stay unclaimed for the next
    // render after this push completes.
    autoPushInFlightRef.current.add(target.key);
    void handlePushVerse(target.candidate, target.source).then((success) => {
      if (success) autoPushLastPushedAtRef.current.set(getLmCandidateKey(target.candidate), Date.now());
    }).finally(() => {
      autoPushInFlightRef.current.delete(target.key);
    });
  }, [
    filteredSuggestions,
    handlePushVerse,
    isListening,
    obsStatus,
    presentationLinkMode,
    queueVerses,
    pushing,
    settings.autoPushDedupWindow,
    settings.autoPushQueue,
    settings.autoPushSuggestions,
  ]);

  useEffect(() => {
    const cutoff = Date.now() - Math.max(suggestionExpiryMs, LM_QUEUE_RETENTION_MS);
    for (const [key, time] of Array.from(detectedAtRef.current.entries())) {
      if (time < cutoff) {
        detectedAtRef.current.delete(key);
      }
    }
  }, [filteredSuggestions, now, suggestionExpiryMs]);

  useEffect(() => {
    const cutoff = Date.now() - SUGGESTION_COOLDOWN_MS;
    for (const [key, time] of Array.from(suggestionCooldownRef.current.entries())) {
      if (time < cutoff) {
        suggestionCooldownRef.current.delete(key);
      }
    }
  }, [now]);

  const recentEntries = useMemo(() => entries.slice(-MAX_TRANSCRIPT_LINES), [entries]);
  const selectedEntries = useMemo(
    () => getSelectedTranscriptEntries(recentEntries, selectedEntryIds),
    [recentEntries, selectedEntryIds],
  );
  const contextEntry = useMemo(
    () => contextMenu.entryId
      ? recentEntries.find((entry) => entry.id === contextMenu.entryId) ?? null
      : null,
    [contextMenu.entryId, recentEntries],
  );

  // Keep selection limited to entries that are still in the visible transcript
  // window, while preserving selected entries when new lines are appended.
  useEffect(() => {
    const visibleIds = new Set(recentEntries.map((entry) => entry.id));
    setSelectedEntryIds((current) => {
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [recentEntries]);

  // ── Live word indicator ──
  const liveEntryIndex = useMemo(() => {
    for (let i = recentEntries.length - 1; i >= 0; i--) {
      if (!recentEntries[i].finalized) return i;
    }
    return recentEntries.length > 0 ? recentEntries.length - 1 : -1;
  }, [recentEntries]);

  const renderText = useCallback((text: string, isLive: boolean) => {
    if (!isLive || !text) return text;
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return text;
    const lastWord = words.pop()!;
    return (
      <>
        {words.join(" ")} <span style={S.liveWord}>{lastWord}</span>
      </>
    );
  }, []);

  // ── Transcript interaction handlers ──
  const handleContextMenu = useCallback((e: React.MouseEvent, entryId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entryId });
  }, []);

  const handleLineClick = useCallback((entryId: string) => {
    if (isSelectionMode) {
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        if (next.has(entryId)) next.delete(entryId);
        else next.add(entryId);
        return next;
      });
    } else {
      if (clickTimeout.current) {
        clearTimeout(clickTimeout.current);
        clickTimeout.current = null;
        setIsSelectionMode(true);
        setSelectedEntryIds(new Set([entryId]));
        window.getSelection()?.removeAllRanges();
      } else {
        clickTimeout.current = setTimeout(() => {
          const text = recentEntries.find((entry) => entry.id === entryId)?.text;
          if (text) {
            navigator.clipboard.writeText(text).catch(() => { });
            showToast("Copied to clipboard!");
          }
          clickTimeout.current = null;
        }, 250);
      }
    }
  }, [isSelectionMode, recentEntries, showToast]);

  const handleCancelSelection = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedEntryIds(new Set());
    setSelectionActionsOpen(false);
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = selectedEntries.map((entry) => entry.text).filter(Boolean).join("\n");
    if (text) {
      navigator.clipboard.writeText(text).catch(() => { });
      showToast(`Copied ${selectedEntries.length} lines`);
    }
    handleCancelSelection();
  }, [selectedEntries, showToast, handleCancelSelection]);

  const handleEditAll = useCallback(() => {
    const text = selectedEntries.map((entry) => entry.text).filter(Boolean).join("\n");
    setEditModal({ visible: true, text });
    handleCancelSelection();
  }, [selectedEntries, handleCancelSelection]);

  const applyEditTextTool = useCallback((action: NoteTextToolAction, linesPerSlide?: number) => {
    setEditModal((current) => ({
      ...current,
      text: formatNoteText(current.text, action, linesPerSlide),
    }));
  }, []);

  const appendTranscriptToNotes = useCallback(async (text: string): Promise<boolean> => {
    const cleanText = text.trim();
    if (!cleanText) {
      showToast("Nothing to save");
      return false;
    }

    const sessionId = isListening && lmSessionStartedAt !== null
      ? `lm-session-${lmSessionStartedAt}`
      : undefined;
    const sessionTitle = sessionId
      ? `Speech Notes · ${new Date(lmSessionStartedAt!).toLocaleString()}`
      : undefined;
    const command = createDockNotesAppendCommand(cleanText, sessionTitle, "lm", sessionId);
    const result = appendTextToDockNotes(cleanText, sessionTitle, {
      sourceId: command.commandId,
      sessionId,
    });
    const relayCommand = {
      ...command,
      ...(result?.note.title ? { title: result.note.title } : {}),
    };
    dockClient.sendCommand({
      type: "notes:append",
      payload: relayCommand,
      commandId: relayCommand.commandId,
      timestamp: Date.now(),
    });
    // Complete the cross-window relay before an OBS publish can navigate or
    // replace the dock. The local append above remains immediate, while the
    // timeout prevents an unavailable relay from blocking the OBS action.
    await Promise.race([
      postDockNotesAppendCommand(relayCommand).catch((err) => {
        console.warn("[DockLmTab] Notes relay failed:", err);
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
    ]);
    showToast(result ? "Saved in Notes" : "Nothing to save");
    return Boolean(result);
  }, [isListening, lmSessionStartedAt, showToast]);

  const handlePushToNotes = useCallback(async (text: string): Promise<boolean> => {
    if (isFreePlan) {
      showToast("Save in Notes requires a paid plan");
      return false;
    }
    return appendTranscriptToNotes(text);
  }, [appendTranscriptToNotes, isFreePlan, showToast]);

  const handleSaveAndShowTranscript = useCallback(async (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) {
      showToast("Nothing to push");
      return;
    }
    // Sending to OBS includes saving the transcript in Notes, even for Free
    // users. The standalone Save in Notes action remains plan-gated.
    await appendTranscriptToNotes(cleanText);
    trackTranscriptCreated(cleanText.split(/\s+/).filter(Boolean).length);
    await pushTranscriptToOBS(cleanText);
  }, [appendTranscriptToNotes, pushTranscriptToOBS, showToast]);

  const handleEditPushToOBS = useCallback(() => {
    void handleSaveAndShowTranscript(editModal.text);
    setEditModal({ visible: false, text: "" });
  }, [editModal.text, handleSaveAndShowTranscript]);

  const lastSelectedEntryId = selectedEntries.length > 0
    ? selectedEntries[selectedEntries.length - 1].id
    : null;
  const renderOverlayModeSwitch = useCallback(() => {
    const options: Array<{ mode: LmOverlayMode | "bible"; label: string; ariaLabel: string; title: string }> = [
      {
        mode: "bible",
        label: "Bible",
        ariaLabel: t("lm.followBible", "Same as Bible tab"),
        title: "Project exactly like the Bible tab: its Full/LT mode, theme, text size and reference style",
      },
      {
        mode: "fullscreen",
        label: "Full",
        ariaLabel: t("lm.fullscreen"),
        title: "Show detected scriptures as a full-screen slide",
      },
      {
        mode: "lower-third",
        label: "LT",
        ariaLabel: t("lm.lowerThird"),
        title: "Show detected scriptures as a lower-third overlay",
      },
    ];

    return (
      <div
        style={S.modeSwitchPanel}
        data-testid="lm-overlay-mode-switch"
      >
        <div style={S.modeSwitchLabelWide}>
          <Icon name="slideshow" size={13} />
          <span>{t("lm.overlayMode")}</span>
        </div>
        <div
          style={{ ...S.modeSegmentedWide, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          role="group"
          aria-label={t("lm.overlayMode")}
        >
          {options.map((option) => {
            const active = option.mode === "bible"
              ? settings.followBibleStyle
              : !settings.followBibleStyle && settings.overlayMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                style={{
                  ...S.modeSegmentButton,
                  ...S.modeSegmentButtonWide,
                  ...(active ? S.modeSegmentButtonActive : undefined),
                }}
                onClick={() => {
                  if (option.mode === "bible") {
                    updateSetting("followBibleStyle", true);
                    return;
                  }
                  // One write so Full/LT and "not following" are saved together.
                  setSettings((prev) => {
                    const next = { ...prev, followBibleStyle: false, overlayMode: option.mode as LmOverlayMode };
                    saveSettings(next);
                    return next;
                  });
                }}
                aria-pressed={active}
                aria-label={option.ariaLabel}
                title={option.title}
                data-testid={`lm-mode-${option.mode}`}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [settings.followBibleStyle, settings.overlayMode, t, updateSetting]);

  return (
    <div style={S.root} ref={rootRef}>
      <style>{`
        @keyframes lm-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.6)}100%{opacity:1;transform:scale(1)}}
        .lm-candidate-card {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: #131724;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
        }
        .lm-candidate-card:hover {
          border-color: rgba(56, 189, 248, 0.6);
          background: #1c2132;
          box-shadow: 0 4px 16px rgba(14, 165, 233, 0.16);
          transform: translateY(-1px);
        }
        .lm-candidate-card:focus-visible {
          outline: 2px solid #38BDF8;
          outline-offset: 1px;
        }
        .lm-candidate-card--suggestion {
          border-color: rgba(255, 255, 255, 0.08);
          background: #131724;
        }
        .lm-candidate-card--suggestion:hover {
          border-color: rgba(56, 189, 248, 0.6);
          background: #1c2132;
          box-shadow: 0 4px 16px rgba(14, 165, 233, 0.16);
        }
        .lm-candidate-card--pinned {
          box-shadow: inset 3px 0 0 rgba(56, 189, 248, 0.9);
        }
        .lm-candidate-card--active,
        .lm-candidate-card--active:hover {
          border-color: rgba(56, 189, 248, 0.85);
          background: #1e293b;
          box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.3), 0 4px 16px rgba(14, 165, 233, 0.25);
        }
        .lm-tab--compact:hover {
          border-color: rgba(96,165,250,0.58) !important;
          background: rgba(59,130,246,0.12) !important;
          color: #F8FAFC !important;
          box-shadow: 0 4px 12px rgba(15,23,42,0.24);
          transform: translateY(-1px);
        }
        .lm-tab--compact:focus-visible {
          outline: 2px solid #60A5FA;
          outline-offset: 1px;
        }
        .lm-tab--compact:active {
          transform: translateY(1px) scale(0.98);
        }
        .lm-pin-button {
          border: 1px solid var(--dock-border, rgba(255,255,255,0.1));
          background: rgba(255,255,255,0.04);
          color: var(--dock-text-dim, #94A3B8);
          cursor: pointer;
          transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
        }
        .lm-pin-button:hover {
          border-color: rgba(96,165,250,0.6);
          background: rgba(96,165,250,0.18);
          color: #BFDBFE;
        }
        .lm-pin-button:active {
          transform: scale(0.94);
        }
        .lm-pin-button--active {
          border-color: rgba(96,165,250,0.7);
          background: rgba(96,165,250,0.2);
          color: #60A5FA;
        }
        .lm-suggestions-resizer {
          border-top: 1px solid var(--dock-border, rgba(255,255,255,0.08));
          background: rgba(255,255,255,0.015);
          cursor: row-resize;
          transition: background-color 140ms ease, border-color 140ms ease;
        }
        .lm-suggestions-resizer:hover,
        .lm-suggestions-resizer:focus-visible,
        .lm-suggestions-resizer--active {
          border-top-color: rgba(96,165,250,0.72);
          background: rgba(59,130,246,0.1);
          outline: none;
        }
        .lm-suggestions-resizer__grip {
          width: 38px;
          height: 3px;
          border-radius: 999px;
          background: var(--dock-text-dim, #64748B);
          transition: background-color 140ms ease, width 140ms ease;
        }
        .lm-suggestions-resizer:hover .lm-suggestions-resizer__grip,
        .lm-suggestions-resizer:focus-visible .lm-suggestions-resizer__grip,
        .lm-suggestions-resizer--active .lm-suggestions-resizer__grip {
          width: 48px;
          background: #60A5FA;
        }
      `}</style>
      {isTestEnv && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "rgba(127, 29, 29, 0.92)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.65)",
            color: "#fff7ed",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 42,
              padding: "2px 6px",
              borderRadius: 999,
              background: "#f59e0b",
              color: "#7f1d1d",
            }}
          >
            Test
          </span>
          <span>Testing environment only. Start Speech to Scripture from the test desktop app on this machine.</span>
        </div>
      )}
      <div style={S.statusBar}>
        <div style={S.statusBarLeft}>
          <div
            style={{
              ...S.statusDot,
              background: isListening ? "#4caf50" : appConnected ? "#ff9800" : "#666",
              boxShadow: isListening ? "0 0 6px #4caf50" : "none",
            }}
          />
          <span style={S.statusText}>
            {isListening ? t("lm.listening") : appConnected ? t("lm.connected") : t("lm.offline")}
          </span>
        </div>
        <div style={S.statusBarRight}>
          <span style={S.statusChip}>
            <Icon name="subtitles" size={10} />
            {entries.length}
          </span>
          <span style={S.statusChip}>
            <Icon name="menu_book" size={10} />
            {processedQueue.length + filteredSuggestions.length}
          </span>
          {creditLabel && (
            <span style={{ ...S.statusChip, color: proUnlocked ? "#4caf50" : undefined }}>
              {creditLabel}
            </span>
          )}
          <button
            type="button"
            style={S.helpBtn}
            onClick={() => setShowHelp(true)}
            title={t("lm.interactionHelp", "Interaction help")}
            aria-label={t("lm.interactionHelp", "Interaction help")}
            aria-expanded={showHelp}
            data-testid="lm-interaction-help"
          >
            <Icon name="help_outline" size={14} />
          </button>
          <button
            type="button"
            style={S.gearBtn}
            onClick={() => setShowSettings(!showSettings)}
            title={t("lm.settings")}
          >
            <Icon name="settings" size={14} />
          </button>

        </div>
      </div>

      <div style={isCompactHeight ? S.mainAreaCompact : S.mainArea} data-compact-height={isCompactHeight}>
      <div
        style={{ ...S.tabBar, ...(isCompactHeight ? S.tabBarCompact : undefined) }}
        className={isCompactHeight ? "lm-tab-bar lm-tab-bar--compact" : "lm-tab-bar"}
        ref={tabBarRef}
        role="tablist"
        aria-orientation={isCompactHeight ? "vertical" : "horizontal"}
        aria-label={t("lm.tabs", "Speech assistant views")}
      >
        {(["up-next", "transcript", "history"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`lm-tab${isCompactHeight ? " lm-tab--compact" : ""}`}
            style={{
              ...S.tab,
              ...(isCompactHeight ? S.tabCompact : undefined),
              ...(activeTab === tab ? S.tabActive : undefined),
              ...(isCompactHeight && activeTab === tab ? S.tabActiveCompact : undefined),
            }}
            onClick={() => setActiveTab(tab)}
            title={tab === "up-next" ? t("lm.tabUpNext") : tab === "transcript" ? t("lm.tabTranscript") : t("lm.tabHistory")}
            aria-label={tab === "up-next" ? t("lm.tabUpNext") : tab === "transcript" ? t("lm.tabTranscript") : t("lm.tabHistory")}
            data-testid={`lm-tab-${tab}`}
          >
            <Icon
              name={tab === "up-next" ? "queue" : tab === "transcript" ? "subtitles" : "history"}
              size={12}
            />
            {!isCompactHeight && tabBarWidth >= 200 && (
              <span>{tab === "up-next" ? t("lm.tabUpNext") : tab === "transcript" ? t("lm.tabTranscript") : t("lm.tabHistory")}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "up-next" && (
        <div style={S.tabContent}>
          {/* ── QUEUE ── */}
          <div style={S.queueSectionFull}>
            <div style={S.sectionHeader}>
              <span style={S.sectionLabel}>{t("lm.queue")}</span>
              {queueVerses.length > 0 && (
                <span style={S.sectionCount}>{queueVerses.length}</span>
              )}
            </div>
            {pinnedVerses.length > 0 && (
              <div style={S.pinnedRow}>
                {pinnedVerses.map((c, i) => {
                  const key = getLmCandidateKey(c);
                  return (
                    <div
                      key={`pin-${key}-${i}`}
                      style={S.pinnedChip}
                      onClick={() => void handlePushVerse(c, "queue")}
                      title={presentationLinkMode ? "Click to show on the presentation screen" : "Click to push to OBS"}
                    >
                      <Icon name="push_pin" size={14} /> {c.label}
                      <button
                        style={S.pinnedChipClose}
                        onClick={(e) => { e.stopPropagation(); handleUnpinVerse(key); }}
                        title="Unpin"
                      >
                        <Icon name="close" size={9} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={S.queueScroll}>
              {queueVerses.length === 0 && pinnedVerses.length === 0 && (
                <div style={S.sectionEmpty}>
                  <Icon name="mic" size={32} style={{ opacity: 0.15 }} />
                  <span style={S.sectionEmptyText}>
                    {appConnected ? t("lm.waitingForDetection") : openAppToStartText}
                  </span>
                </div>
              )}
              {queueVerses.map((c, i) => {
                const key = getLmCandidateKey(c);
                const detectedAt = detectedAtRef.current.get(key) ?? Date.now();
                const freshness = getFreshness(detectedAt, now);
                const isLive = liveVerse ? getLmCandidateKey(liveVerse) === key : false;
                const isPinned = pinnedVerseKeys.has(key);

                return (
                  <div
                    key={`queue-${key}-${i}`}
                    className={`lm-candidate-card${isLive ? " lm-candidate-card--active" : ""}${isPinned ? " lm-candidate-card--pinned" : ""}`}
                    style={S.queueCard}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isLive}
                    aria-label={`${c.label}. ${pushActionLabel}`}
                    title={pushActionTitle}
                    onClick={() => void handlePushVerse(c, "queue")}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handlePushVerse(c, "queue");
                      }
                    }}
                  >
                    <div style={S.queueCardHeader}>
                      <span style={S.verseRefBadge}>
                        <Icon name="book" size={13} style={{ marginRight: 6, flexShrink: 0, opacity: 0.95 }} />
                        {c.label}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--dock-text-dim, #94A3B8)", fontWeight: 500 }}>{freshness.label}</span>
                    </div>

                    {c.snippet && (
                      <div style={S.verseText}>{c.snippet}</div>
                    )}

                    <div style={S.queueCardBottom}>
                      <div style={{ flex: 1 }} />
                      <div style={{ display: "flex", gap: 5 }}>
                        <button
                          className={`lm-pin-button${isPinned ? " lm-pin-button--active" : ""}`}
                          style={S.pinBtnSmall}
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePinVerse(c);
                          }}
                          aria-pressed={isPinned}
                          title="Pin verse"
                        >
                          <Icon name="push_pin" size={12} />
                        </button>
                        <button
                          style={S.pushBtn}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePushVerse(c, "queue");
                          }}
                          disabled={pushing || (!presentationLinkMode && obsStatus !== "connected")}
                          title={pushActionTitle}
                        >
                          <Icon name="play" size={11} />
                          {pushActionLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {filteredSuggestions.length > 0 && (
            <div style={{ ...S.suggestionsSection, height: `${suggestionsHeightPercent}%` }}>
              <div
                className={`lm-suggestions-resizer${isResizingSuggestions ? " lm-suggestions-resizer--active" : ""}`}
                style={S.suggestionsResizeHandle}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label={t("lm.resizeSuggestions", "Resize suggestions panel")}
                aria-valuemin={MIN_SUGGESTIONS_HEIGHT_PERCENT}
                aria-valuemax={MAX_SUGGESTIONS_HEIGHT_PERCENT}
                aria-valuenow={Math.round(suggestionsHeightPercent)}
                aria-valuetext={`${Math.round(suggestionsHeightPercent)}% suggestions panel height`}
                title={t("lm.resizeSuggestionsHint", "Drag to resize Queue and Suggestions")}
                onPointerDown={startSuggestionsResize}
                onKeyDown={handleSuggestionsResizeKeyDown}
              >
                <span className="lm-suggestions-resizer__grip" style={S.suggestionsResizeGrip} aria-hidden="true" />
              </div>
              <div style={S.sectionHeader}>
                <span style={S.sectionLabel}>{t("lm.suggestions", "Suggestions")}</span>
                <span style={S.sectionCount}>{filteredSuggestions.length}</span>
              </div>
              <div style={S.suggestionsScroll}>
                {filteredSuggestions.map((c, i) => {
                  const key = getLmCandidateKey(c);
                  const detectedAt = detectedAtRef.current.get(key) ?? Date.now();
                  const freshness = getFreshness(detectedAt, now);
                  const isLive = liveVerse ? getLmCandidateKey(liveVerse) === key : false;
                  const isPinned = pinnedVerseKeys.has(key);

                  return (
                    <div
                      key={`suggestion-${key}-${i}`}
                      className={`lm-candidate-card lm-candidate-card--suggestion${isLive ? " lm-candidate-card--active" : ""}${isPinned ? " lm-candidate-card--pinned" : ""}`}
                      style={S.suggestionCard}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isLive}
                      aria-label={`${c.label}. ${pushActionLabel}`}
                      title={pushActionTitle}
                      onClick={() => void handlePushVerse(c, "suggestion")}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void handlePushVerse(c, "suggestion");
                        }
                      }}
                    >
                    <div style={S.queueCardHeader}>
                      <span style={S.verseRefBadge}>
                        <Icon name="book" size={13} style={{ marginRight: 6, flexShrink: 0, opacity: 0.95 }} />
                        {c.label}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--dock-text-dim, #94A3B8)", fontWeight: 500 }}>{freshness.label}</span>
                    </div>

                    {c.snippet && (
                      <div style={S.verseText}>{c.snippet}</div>
                    )}
                      <div style={S.queueCardBottom}>
                        <span style={S.suggestionHint}>{t("lm.manualSuggestion", "Suggested match")}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className={`lm-pin-button${isPinned ? " lm-pin-button--active" : ""}`}
                            style={S.pinBtnSmall}
                            onClick={(event) => {
                              event.stopPropagation();
                              handlePinVerse(c);
                            }}
                            aria-pressed={isPinned}
                            title="Pin verse"
                          >
                            <Icon name="push_pin" size={12} />
                          </button>
                          <button
                            style={S.pushBtn}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handlePushVerse(c, "suggestion");
                            }}
                            disabled={pushing || (!presentationLinkMode && obsStatus !== "connected")}
                            title={pushActionTitle}
                          >
                            <Icon name="play" size={11} />
                            {pushActionLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "transcript" && (
        <div style={S.tabContent}>
          <div style={S.transcriptSectionFull}>
            <div style={S.transcriptFeed} ref={transcriptRef}>
              {recentEntries.length === 0 && (
                <div style={S.sectionEmpty}>
                  <span style={S.sectionEmptyText}>
                    {isListening ? t("lm.waitingForSpeech") : t("lm.noTranscript")}
                  </span>
                </div>
              )}
              {recentEntries.map((entry, index) => {
                const isSelected = selectedEntryIds.has(entry.id);
                const showActionBar = isSelectionMode && entry.id === lastSelectedEntryId;
                const isLive = index === liveEntryIndex;

                return (
                  <div
                    key={entry.id}
                    style={{
                      ...S.transcriptItem,
                      ...(isSelected ? S.transcriptItemSelected : {}),
                      ...(isSelectionMode ? { paddingLeft: 2 } : {}),
                      ...(showActionBar ? { paddingBottom: 0 } : {}),
                      ...(isLive ? S.transcriptItemLive : {}),
                    }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-action-bar]')) return;
                      if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
                      handleLineClick(entry.id);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, entry.id)}
                  >
                    <div style={S.transcriptLine}>
                      <div style={{
                        ...S.checkboxContainer,
                        ...(isSelectionMode ? S.checkboxContainerVisible : {}),
                      }}>
                        <input
                          type="checkbox"
                          style={S.checkbox}
                          checked={isSelected}
                          onChange={(e) => {
                            setSelectedEntryIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(entry.id);
                              else next.delete(entry.id);
                              return next;
                            });
                          }}
                        />
                      </div>
                      {isLive && <span style={S.liveDot} />}
                      <span style={{
                        ...S.transcriptTextBase,
                        ...(isSelected ? S.transcriptTextSelected : {}),
                        ...(!entry.finalized ? S.transcriptTextActive : S.transcriptTextDim),
                        ...(isLive ? S.transcriptTextLive : {}),
                      }}>
                        {renderText(entry.text, isLive)}
                      </span>

                    </div>

                    {showActionBar && (
                      <div data-action-bar style={S.actionBar}>
                        <div style={S.actionBarLeft}>
                          <span style={S.selectionCount}>{selectedEntries.length} selected</span>
                        </div>
                        <div style={S.actionBarRight} ref={selectionActionsRef}>
                          <button
                            type="button"
                            style={S.btnCloseSelection}
                            onClick={(e) => { e.stopPropagation(); handleCancelSelection(); }}
                            aria-label="Close selection"
                            title="Close selection"
                          >
                            <X size={14} strokeWidth={2.4} />
                          </button>
                          <button
                            type="button"
                            style={S.btnAction}
                            onClick={(e) => { e.stopPropagation(); handleCopyAll(); }}
                            title="Copy selected transcript lines"
                            aria-label="Copy selected transcript lines"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            style={S.btnIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectionActionsOpen((open) => !open);
                            }}
                            aria-label="More selection actions"
                            title="More selection actions"
                            aria-haspopup="menu"
                            aria-expanded={selectionActionsOpen}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                          {selectionActionsOpen && (
                            <div style={S.selectionOverflowMenu} role="menu">
                              <button
                                type="button"
                                style={{ ...S.contextMenuItem, ...(isFreePlan ? S.contextMenuItemDisabled : {}) }}
                                role="menuitem"
                                onClick={(e) => { e.stopPropagation(); handleEditAll(); }}
                                disabled={isFreePlan}
                                title={isFreePlan ? "Edit requires a paid plan" : "Edit selected transcript lines"}
                              >
                                <Edit2 size={13} />
                                Edit
                              </button>
                              <button
                                type="button"
                                style={{ ...S.contextMenuItem, ...(isFreePlan ? S.contextMenuItemDisabled : {}) }}
                                role="menuitem"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const text = selectedEntries.map((selected) => selected.text).filter(Boolean).join("\n");
                                  void handlePushToNotes(text);
                                  handleCancelSelection();
                                }}
                                disabled={isFreePlan}
                                title={isFreePlan ? "Save in Notes requires a paid plan" : "Save selected transcript lines in Notes"}
                              >
                                <StickyNote size={13} />
                                Save in Notes
                              </button>
                              <button
                                type="button"
                                style={S.contextMenuItem}
                                role="menuitem"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const text = selectedEntries.map((selected) => selected.text).filter(Boolean).join("\n");
                                  void handleSaveAndShowTranscript(text);
                                  handleCancelSelection();
                                }}
                                disabled={pushing || (!presentationLinkMode && obsStatus !== "connected")}
                              >
                                <MonitorUp size={13} />
                                {transcriptPushShortLabel}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div style={S.tabContent}>
          <div style={S.historySectionFull}>
            {history.length === 0 && (
              <div style={S.sectionEmpty}>
                <span style={S.sectionEmptyText}>{t("lm.historyEmpty")}</span>
              </div>
            )}
            {history.map((ref, i) => {
              const parsed = parseScriptureReference(ref);
              const clickable = parsed && parsed.book && parsed.chapter && parsed.verse;
              return (
                <div
                  key={`hist-${i}`}
                  style={clickable ? S.historyItemClickable : S.historyItem}
                  onClick={() => {
                    if (!clickable || !parsed.book || !parsed.chapter || !parsed.verse) return;
                    onNavigateToBible?.();
                    navigateBibleDock({
                      book: parsed.book,
                      chapter: parsed.chapter,
                      verse: parsed.verse!,
                    }, true);
                  }}
                  title={clickable ? t("lm.historyClickHint") : undefined}
                >
                  {clickable && <Icon name="menu_book" size={12} style={{ flexShrink: 0, opacity: 0.5 }} />}
                  <span>{ref}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>

      {pushSuccess && (
        <div style={S.toast}>
          <Icon name="check_circle" size={14} />
          <span>{pushSuccess}</span>
        </div>
      )}
      {pushError && (
        <div style={S.toastError}>
          <Icon name="error" size={14} />
          <span>{pushError}</span>
        </div>
      )}

      {toastMessage && (
        <div style={S.transcriptToast}>
          <Check size={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      {matching && (
        <div style={S.matchingBar}>
          <span style={S.matchingText}>{t("lm.searchingScriptures")}</span>
        </div>
      )}

      {showStopConfirm && (
        <div style={S.modalOverlay} onClick={() => setShowStopConfirm(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <h3 style={S.modalTitle}>{t("lm.stopListening")}</h3>
            </div>
            <div style={S.modalBody}>
              <p style={S.modalText}>{t("lm.stopListeningConfirm")}</p>
            </div>
            <div style={S.modalFooter}>
              <button style={S.modalBtnGhost} onClick={() => setShowStopConfirm(false)}>
                {t("common.cancel")}
              </button>
              <button style={S.modalBtnDanger} onClick={confirmStop}>
                <Icon name="stop" size={12} />
                <span>{t("lm.stopListening")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {inactivityPrompt?.active && (
        <div style={S.modalOverlay}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <h3 style={S.modalTitle}>Are you still using Voice AI?</h3>
            </div>
            <div style={S.modalBody}>
              <p style={S.modalText}>
                No speech detected for {inactivityPrompt.intervalMinutes} minutes. Voice AI will stop in {inactivityPrompt.remainingSeconds}s unless you keep it on.
              </p>
            </div>
            <div style={S.modalFooter}>
              <button style={S.modalBtnGhost} onClick={handleInactivityStop}>
                No, stop
              </button>
              <button style={S.modalBtnPrimary} onClick={handleConfirmStillUsing}>
                Yes, keep listening
              </button>
            </div>
          </div>
        </div>
      )}

      {inactivityNotice && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: "#1e2029",
            color: "#f9fafb",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span>{inactivityNotice}</span>
          <button
            onClick={() => {
              setInactivityNotice(null);
              void loadLmDockService().then((s) => s.clearInactivityNotice());
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              marginLeft: 4,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {showHelp && (
        <div
          style={S.modalOverlay}
          onClick={() => setShowHelp(false)}
          role="presentation"
        >
          <div
            style={{ ...S.modal, ...S.helpModal }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lm-help-title"
            data-testid="lm-interaction-help-modal"
          >
            <div style={S.modalHeader}>
              <h3 id="lm-help-title" style={S.modalTitle}>
                <Icon name="help_outline" size={15} />
                {t("lm.interactionHelpTitle", "LM transcript help")}
              </h3>
              <button
                type="button"
                style={S.settingsClose}
                onClick={() => setShowHelp(false)}
                aria-label={t("common.close", "Close")}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div style={S.helpList}>
              <div style={S.helpItem}>
                <Icon name="content_copy" size={14} />
                <span>{t("lm.interactionHelpCopy", "Click a transcript line to copy it.")}</span>
              </div>
              <div style={S.helpItem}>
                <Icon name="select_all" size={14} />
                <span>{t("lm.interactionHelpSelect", "Double-click a line to select it for actions.")}</span>
              </div>
              <div style={S.helpItem}>
                <Icon name="send" size={14} />
                <span>{t("lm.interactionHelpActions", "Use the action buttons to save in Notes or send to OBS.")}</span>
              </div>
            </div>
            <div style={S.modalFooter}>
              <button type="button" style={S.btnSecondary} onClick={() => setShowHelp(false)}>
                {t("common.done", "Done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={S.errorBanner}>
          <Icon name="warning" size={12} style={{ color: "#EF4444" }} />
          <span style={{ color: "#FCA5A5", fontSize: 11 }}>{error}</span>
        </div>
      )}

      {contextMenu.visible && (
        <div
          style={{ ...S.contextMenu, top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={S.contextMenuItem}
            onClick={() => {
              if (contextMenu.entryId !== null) {
                setIsSelectionMode(true);
                setSelectedEntryIds(new Set([contextMenu.entryId]));
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
          >
            Select
          </button>
          <button
            style={S.contextMenuItem}
            onClick={() => {
              if (contextEntry?.text) {
                const text = contextEntry.text;
                if (text) {
                  navigator.clipboard.writeText(text).catch(() => { });
                  showToast("Copied to clipboard!");
                }
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
          >
            Copy
          </button>
          <button
            style={{ ...S.contextMenuItem, ...(isFreePlan ? S.contextMenuItemDisabled : {}) }}
            onClick={() => {
              if (contextEntry) {
                setEditModal({ visible: true, text: contextEntry.text });
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            disabled={isFreePlan}
            title={isFreePlan ? "Edit requires a paid plan" : "Edit selected transcript line"}
          >
            Edit
          </button>
          <button
            style={S.contextMenuItem}
            onClick={() => {
              if (contextEntry?.text) {
                const text = contextEntry.text;
                if (text) void handleSaveAndShowTranscript(text);
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            disabled={pushing || (!presentationLinkMode && obsStatus !== "connected")}
          >
            {transcriptPushLabel}
          </button>
          <button
            style={{ ...S.contextMenuItem, ...(isFreePlan ? S.contextMenuItemDisabled : {}) }}
            onClick={() => {
              if (contextEntry) {
                void handlePushToNotes(contextEntry.text);
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            disabled={isFreePlan}
            title={isFreePlan ? "Save in Notes requires a paid plan" : "Save selected transcript line in Notes"}
          >
            Save in Notes
          </button>
        </div>
      )}

      {editModal.visible && (
        <div style={S.editModalOverlay} onClick={() => setEditModal({ visible: false, text: "" })}>
          <div style={S.editModalContent} onClick={(e) => e.stopPropagation()}>
            <div style={S.editModalHeader}>
              <h2 style={S.editModalTitle}>
                <Edit2 size={16} /> Edit Selection
              </h2>
              <button style={S.editModalClose} onClick={() => setEditModal({ visible: false, text: "" })}>
                ✕
              </button>
            </div>
            <div style={S.editModalBody}>
              <DockNotesTextTools
                className="dock-notes-text-tools dock-notes-text-tools--editor"
                buttonClassName="dock-notes-text-tools__btn"
                onAction={applyEditTextTool}
              />
              <label style={S.editModalLabel}>Content to edit</label>
              <textarea
                style={S.editModalTextarea}
                rows={6}
                value={editModal.text}
                onChange={(e) => setEditModal(prev => ({ ...prev, text: e.target.value }))}
              />
            </div>
            <div style={S.editModalFooter}>
              <button style={S.modalBtnGhost} onClick={() => { setEditModal({ visible: false, text: "" }); handleCancelSelection(); }}>Cancel</button>
              <button
                style={{ ...S.btnSecondary, ...(isFreePlan ? S.modalButtonDisabled : {}) }}
                onClick={() => { void handlePushToNotes(editModal.text); setEditModal({ visible: false, text: "" }); handleCancelSelection(); }}
                disabled={isFreePlan}
                title={isFreePlan ? "Save in Notes requires a paid plan" : "Save in Notes"}
              >
                <StickyNote size={14} /> Save in Notes
              </button>
              <button
                style={S.btnPrimary}
                onClick={() => { handleEditPushToOBS(); handleCancelSelection(); }}
                disabled={pushing || (!presentationLinkMode && obsStatus !== "connected")}
              >
                {transcriptPushLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <>
          <div style={S.settingsOverlay} onClick={() => setShowSettings(false)} />
          <div style={S.settingsPanel}>
            <div style={S.settingsHeader}>
              <span style={S.settingsTitle}>{t("lm.settings")}</span>
              <button style={S.settingsClose} onClick={() => setShowSettings(false)}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div style={S.settingsBody}>
              {!presentationLinkMode && (
                <div style={S.settingsGroup}>
                  <div style={S.settingsGroupLabel}>{t("lm.overlayMode")}</div>
                  {renderOverlayModeSwitch()}
                  <span style={S.settingHint}>{t("lm.overlayModeHintBible", "Bible projects exactly like the Bible tab (its Full/LT mode, theme, text size and reference style). Full or LT forces that mode for scriptures and transcript notes.")}</span>
                </div>
              )}

              {allowLocalMicControls && (
                <div style={S.settingsGroup}>
                  <div style={S.settingsGroupLabel}>MICROPHONE</div>
                  <div style={S.settingRow}>
                    <span style={S.settingLabel}>Default mic</span>
                    <button
                      type="button"
                      style={S.settingGhostButton}
                      onClick={() => void refreshPresentationMics()}
                      disabled={micLoading || isListening}
                    >
                      {micLoading ? "Loading..." : "Refresh"}
                    </button>
                  </div>
                  <select
                    style={{ ...S.settingSelect, ...S.settingSelectFull }}
                    value={selectedMic}
                    onChange={(e) => selectPresentationMic(e.target.value)}
                    disabled={micLoading || isListening}
                    aria-label="Default microphone"
                  >
                    {mics.length === 0 ? (
                      <option value="">{micLoading ? "Loading microphones..." : "Default microphone"}</option>
                    ) : (
                      mics.map((mic) => (
                        <option key={mic.id || mic.label} value={mic.id}>{mic.label}</option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    style={{
                      ...S.presentationMicButton,
                      ...(isListening ? S.presentationMicButtonActive : null),
                    }}
                    onClick={() => void handlePresentationListeningToggle()}
                  >
                    <Icon name={isListening ? "stop" : "mic"} size={13} />
                    <span>
                      {lmStatus === "requesting-mic" || lmStatus === "connecting"
                        ? "Cancel start"
                        : isListening
                          ? "Stop listening"
                          : "Start listening"}
                    </span>
                  </button>
                  <span style={S.settingHint}>Start Scripture Assistant from this presentation page without opening Verse AI.</span>
                  {micError && <span style={S.settingError}>{micError}</span>}
                </div>
              )}

              <div style={S.settingsGroup}>
                <div style={S.settingsGroupLabel}>AUTO-PUSH</div>
                <label style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.autoPushQueue")}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoPushQueue}
                    onChange={(e) => updateSetting("autoPushQueue", e.target.checked)}
                    style={S.settingCheckbox}
                  />
                </label>
                <span style={S.settingHint}>{t("lm.autoPushQueueHint")}</span>

                <label style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.autoPushSuggestions")}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoPushSuggestions}
                    onChange={(e) => updateSetting("autoPushSuggestions", e.target.checked)}
                    style={S.settingCheckbox}
                  />
                </label>
                <span style={S.settingHint}>{t("lm.autoPushSuggestionsHint")}</span>

                {(settings.autoPushQueue || settings.autoPushSuggestions) && (
                  <>
                    <div style={S.settingRow}>
                      <span style={S.settingLabel}>{t("lm.dedupWindow")}</span>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={settings.autoPushDedupWindow}
                        onChange={(e) => updateSetting("autoPushDedupWindow", Math.max(0, Number(e.target.value) || 0))}
                        style={S.settingNumber}
                      />
                      <span style={S.settingUnit}>sec</span>
                    </div>
                    <span style={S.settingHint}>{t("lm.dedupHint")}</span>
                  </>
                )}
              </div>

              <div style={S.settingsGroup}>
                <div style={S.settingsGroupLabel}>NAVIGATION</div>
                <label style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.autoNavigate")}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoNavigate}
                    onChange={(e) => updateSetting("autoNavigate", e.target.checked)}
                    style={S.settingCheckbox}
                  />
                </label>
                <span style={S.settingHint}>{t("lm.autoNavigateHint")}</span>
              </div>

              {!presentationLinkMode && (
                <div style={S.settingsGroup}>
                  <div style={S.settingsGroupLabel}>PUSH TARGET</div>
                  <div style={S.settingRow}>
                    <span style={S.settingLabel}>{t("lm.pushTarget")}</span>
                    <select
                      style={S.settingSelect}
                      value={settings.pushScene}
                      onChange={(e) => updateSetting("pushScene", e.target.value as "ai" | "main")}
                    >
                      <option value="ai">{t("lm.pushTargetAi")}</option>
                      <option value="main">{t("lm.pushTargetMain")}</option>
                    </select>
                  </div>
                </div>
              )}

              <div style={S.settingsGroup}>
                <div style={S.settingsGroupLabel}>SUGGESTION LIFETIME</div>
                <div style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.expireAfter")}</span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={settings.suggestionLifetime}
                    onChange={(e) => updateSetting("suggestionLifetime", Math.max(5, Number(e.target.value) || 20))}
                    style={S.settingNumber}
                  />
                  <span style={S.settingUnit}>sec</span>
                </div>
                <span style={S.settingHint}>{t("lm.expireAfterHint")}</span>
              </div>

              <div style={S.settingsGroup}>
                <div style={S.settingsGroupLabel}>TRANSLATION</div>
                <div style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.translation")}</span>
                  <select
                    style={S.settingSelect}
                    value={settings.translation}
                    onChange={(e) => updateSetting("translation", e.target.value)}
                  >
                    <option value="KJV">KJV</option>
                    <option value="NKJV">NKJV</option>
                    <option value="NIV">NIV</option>
                    <option value="ESV">ESV</option>
                    <option value="NLT">NLT</option>
                  </select>
                </div>
              </div>

              <div style={S.settingsGroup}>
                <div style={S.settingsGroupLabel}>DISPLAY</div>
                <label style={S.settingRow}>
                  <span style={S.settingLabel}>{t("lm.autoScrollTranscript")}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoScroll}
                    onChange={(e) => updateSetting("autoScroll", e.target.checked)}
                    style={S.settingCheckbox}
                  />
                </label>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    background: "var(--dock-bg, #0f172a)",
    color: "var(--dock-text, #E2E8F0)",
    fontSize: 12,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },

  statusBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "2px 12px",
    borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    flexShrink: 0,
    minHeight: 12,
    background: "var(--dock-bg, #0f172a)",
  },
  statusBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    opacity: 0.8,
  },
  statusBarRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statusChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.06)",
    color: "var(--dock-text-dim, #94A3B8)",
  },
  gearBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "var(--dock-text-dim, #94A3B8)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  mainArea: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  mainAreaCompact: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
  },
  helpBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--dock-text-dim, #64748B)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  modeSwitchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    background: "rgba(255,255,255,0.025)",
    flexShrink: 0,
  },
  modeSwitchPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 6,
  },
  modeSwitchLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    minWidth: 74,
    color: "var(--dock-text, #E2E8F0)",
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  modeSwitchLabelWide: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--dock-text, #E2E8F0)",
    fontSize: 11,
    fontWeight: 700,
  },
  modeSegmented: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    minHeight: 30,
    padding: 2,
    borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(0,0,0,0.16)",
    gap: 2,
  },
  modeSegmentedWide: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    minHeight: 34,
    padding: 2,
    borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(0,0,0,0.16)",
    gap: 2,
  },
  modeSegmentButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minWidth: 0,
    minHeight: 26,
    padding: "4px 6px",
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "var(--dock-text-dim, #94A3B8)",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
  },
  modeSegmentButtonWide: {
    minHeight: 30,
    fontSize: 11,
  },
  modeSegmentButtonActive: {
    background: "#9F442B",
    color: "#FFFFFF",
  },

  tabBar: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    flexShrink: 0,
    background: "var(--dock-bg, #0f172a)",
  },
  tabBarCompact: {
    flexDirection: "column",
    flex: "0 0 54px",
    width: 54,
    height: "100%",
    boxSizing: "border-box",
    minHeight: 0,
    alignSelf: "stretch",
    borderBottom: "none",
    borderRight: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    overflow: "hidden",
    padding: "7px 5px",
    gap: 6,
  },
  tab: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "8px 0",
    border: "none",
    borderBottom: "2px solid transparent",
    background: "transparent",
    color: "var(--dock-text-dim, #64748B)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "inherit",
  },
  tabCompact: {
    flex: "1 1 0",
    width: 42,
    height: "auto",
    minHeight: 48,
    margin: "0 auto",
    padding: 0,
    boxSizing: "border-box",
    border: "1px solid var(--dock-border, rgba(255,255,255,0.1))",
    borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.1))",
    borderRadius: 0,
    background: "color-mix(in srgb, var(--dock-surface-alt, #1F2937) 78%, var(--dock-surface, #111827))",
  },
  tabActive: {
    color: "#3B82F6",
    borderBottom: "2px solid #3B82F6",
    background: "rgba(59,130,246,0.06)",
  },
  tabActiveCompact: {
    color: "#FFFFFF",
    borderBottom: "1px solid rgba(96,165,250,0.76)",
    borderColor: "rgba(96,165,250,0.76)",
    background: "color-mix(in srgb, var(--dock-accent, #1D4ED8) 26%, var(--dock-surface, #111827))",
    boxShadow: "inset 3px 0 0 var(--dock-accent-hover, #2563EB), 0 4px 12px rgba(15,23,42,0.24)",
  },
  tabContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },

  // ── Current / Live verse ──
  currentSection: {
    flexShrink: 0,
    padding: "6px 12px 4px",
  },
  currentCard: {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(59,130,246,0.25)",
    background: "rgba(59,130,246,0.04)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  currentCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  currentDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#60A5FA",
    animation: "lm-pulse 1.2s ease-in-out infinite",
    flexShrink: 0,
  },
  currentBadge: {
    fontSize: 9,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#60A5FA",
  },
  currentRef: {
    fontSize: 13,
    fontWeight: 700,
    color: "#E2E8F0",
  },
  currentText: {
    fontSize: 11,
    lineHeight: "1.5",
    color: "var(--dock-text-dim, #94A3B8)",
    fontStyle: "italic",
  },
  currentBottom: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  currentTime: {
    fontSize: 10,
    color: "var(--dock-text-dim, #64748B)",
  },
  pinBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 3,
    border: "1px solid var(--dock-border, rgba(255,255,255,0.08))",
    background: "rgba(255,255,255,0.04)",
    color: "var(--dock-text-dim, #94A3B8)",
    cursor: "pointer",
  },
  pinBtnSmall: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 3,
  },
  // ── Pinned chips ──
  pinnedRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  pinnedChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 8px 1px 6px",
    borderRadius: 3,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--dock-text-dim, #94A3B8)",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  pinnedChipClose: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 12,
    height: 12,
    borderRadius: 2,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.2)",
    cursor: "pointer",
    padding: 0,
  },
  // ── Queue list ──
  queueSectionFull: {
    flex: "1 1 0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px 4px",
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--dock-text-dim, #64748B)",
  },
  sectionCount: {
    fontSize: 9,
    fontWeight: 600,
    padding: "1px 5px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.08)",
    color: "var(--dock-text-dim, #94A3B8)",
  },
  queueScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 12px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  suggestionsSection: {
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
  suggestionsResizeHandle: {
    flex: "0 0 10px",
    height: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  suggestionsResizeGrip: {
    display: "block",
  },
  suggestionsScroll: {
    overflowY: "auto",
    padding: "4px 12px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sectionEmpty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  sectionEmptyText: {
    fontSize: 11,
    color: "var(--dock-text-dim, #64748B)",
    textAlign: "center",
  },

  queueCard: {
    padding: "10px 12px",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    cursor: "pointer",
  },
  suggestionCard: {
    padding: "10px 12px",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    cursor: "pointer",
  },
  queueCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  queueCardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  queueRef: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--dock-text, #E2E8F0)",
  },
  queueCardBottom: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  suggestionHint: {
    fontSize: 10,
    color: "var(--dock-text-dim, #94A3B8)",
  },

  verseText: {
    fontSize: 13.5,
    lineHeight: "1.55",
    color: "rgba(255, 255, 255, 0.92)",
    fontWeight: 500,
    fontStyle: "normal",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    letterSpacing: "0.01em",
  },
  verseRefBadge: {
    fontSize: 14.5,
    fontWeight: 800,
    color: "#F8FAFC",
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
    borderRadius: 6,
    padding: "3px 10px",
    display: "inline-flex",
    alignItems: "center",
    letterSpacing: "0.02em",
  },
  verseRefBadgeLarge: {
    fontSize: 15.5,
    fontWeight: 800,
    color: "#F8FAFC",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
    borderRadius: 7,
    padding: "4px 12px",
    display: "inline-flex",
    alignItems: "center",
    letterSpacing: "0.02em",
  },

  pushBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 11px",
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid rgba(59, 130, 246, 0.4)",
    background: "#1e293b",
    color: "#93C5FD",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },

  // ── Transcript ──
  transcriptSectionFull: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
  transcriptFeed: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 8px 8px",
    maxHeight: "70%",
  },
  transcriptItem: {
    padding: "4px 6px",
    borderRadius: 4,
    cursor: "pointer",
    transition: "background-color 0.15s",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },
  transcriptItemSelected: {
    background: "rgba(59,130,246,0.1)",
  },
  transcriptLine: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
  },
  transcriptTextBase: {
    flex: 1,
    fontSize: 12,
    lineHeight: "1.5",
    userSelect: "none",
    transition: "color 0.15s",
  },
  transcriptTextDim: {
    color: "var(--dock-text-dim, #64748B)",
  },
  transcriptTextActive: {
    color: "var(--dock-text, #E2E8F0)",
  },
  transcriptTextSelected: {
    color: "#93C5FD",
  },

  checkboxContainer: {
    width: 0,
    opacity: 0,
    overflow: "hidden",
    transition: "width 0.2s, opacity 0.2s",
    flexShrink: 0,
    paddingTop: 2,
  },
  checkboxContainerVisible: {
    width: 18,
    opacity: 1,
    marginRight: 4,
  },
  checkbox: {
    width: 14,
    height: 14,
    accentColor: "#3B82F6",
    cursor: "pointer",
    flexShrink: 0,
  },

  actionBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginLeft: 28,
    padding: 6,
    gap: 8,
    border: "1px solid rgba(59,130,246,0.22)",
    borderRadius: 8,
    background: "rgba(15,23,42,0.82)",
  },
  actionBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  selectionCount: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--dock-text, #E2E8F0)",
  },
  actionBarRight: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "center",
    position: "relative" as const,
  },
  btnCloseSelection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    padding: 0,
    background: "rgba(127,29,29,0.28)",
    color: "#F87171",
    border: "1px solid rgba(248,113,113,0.38)",
    borderRadius: 6,
    cursor: "pointer",
  },
  btnIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    padding: 0,
    background: "#1F2937",
    color: "#E2E8F0",
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: 6,
    cursor: "pointer",
  },
  selectionOverflowMenu: {
    position: "absolute" as const,
    top: "calc(100% + 4px)",
    right: 0,
    minWidth: 154,
    display: "flex",
    flexDirection: "column" as const,
    padding: "4px 0",
    background: "#0F172A",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 8,
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5)",
    zIndex: 110,
  },
  btnAction: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#1e293b",
    color: "#f8fafc",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    padding: "5px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    padding: "5px 9px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  // ── Context menu ──
  contextMenu: {
    position: "fixed" as const,
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "4px 0",
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5)",
    zIndex: 100,
    minWidth: 140,
    display: "flex",
    flexDirection: "column" as const,
  },
  contextMenuItem: {
    padding: "6px 12px",
    fontSize: 12,
    color: "#cbd5e1",
    background: "none",
    border: "none",
    textAlign: "left" as const,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  contextMenuItemDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },

  // ── Edit modal ──
  modalButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  editModalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  editModalContent: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    width: "90%",
    maxWidth: 500,
    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
    margin: "0 12px",
    overflow: "hidden",
  },
  editModalHeader: {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  editModalTitle: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
  },
  editModalClose: {
    background: "none",
    border: "none",
    color: "#64748B",
    fontSize: 18,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
  },
  editModalBody: {
    padding: "14px 16px",
  },
  editModalLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    color: "#64748B",
    marginBottom: 6,
  },
  editModalTextarea: {
    width: "100%",
    background: "rgba(15,23,42,0.8)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#cbd5e1",
    padding: "10px 12px",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: "1.5",
    resize: "vertical" as const,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  editModalFooter: {
    padding: "12px 16px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(30,41,59,0.3)",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  btnSecondary: {
    background: "transparent",
    border: "1px solid #475569",
    color: "#cbd5e1",
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },

  // ── Transcript toast ──
  transcriptToast: {
    position: "fixed" as const,
    top: 60,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1e293b",
    border: "1px solid #475569",
    color: "#E2E8F0",
    padding: "6px 14px",
    borderRadius: 9999,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5)",
    zIndex: 50,
    pointerEvents: "none" as const,
  },

  // ── History ──
  historySectionFull: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 12px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  historyItem: {
    fontSize: 11,
    padding: "6px 8px",
    color: "var(--dock-text-dim, #94A3B8)",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  historyItemClickable: {
    fontSize: 11,
    padding: "6px 8px",
    color: "var(--dock-text, #E2E8F0)",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    background: "rgba(59,130,246,0.06)",
    border: "1px solid rgba(59,130,246,0.15)",
    transition: "all 0.15s",
  },

  // ── Toasts ──
  toast: {
    position: "fixed" as const,
    bottom: 60,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: 8,
    background: "#166534",
    color: "#BBF7D0",
    fontSize: 12,
    fontWeight: 600,
    zIndex: 1000,
    pointerEvents: "none" as const,
  },
  toastError: {
    position: "fixed" as const,
    bottom: 60,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: 8,
    background: "#991B1B",
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: 600,
    zIndex: 1000,
    pointerEvents: "none" as const,
  },

  // ── Matching indicator ──
  matchingBar: {
    padding: "4px 12px",
    borderTop: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    background: "rgba(59,130,246,0.06)",
  },
  matchingText: {
    fontSize: 10,
    color: "#60A5FA",
    fontWeight: 600,
  },

  // ── Stop confirmation modal ──
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  modal: {
    width: "80%",
    maxWidth: 280,
    borderRadius: 10,
    background: "var(--dock-bg, #1E293B)",
    border: "1px solid var(--dock-border, rgba(255,255,255,0.1))",
    overflow: "hidden",
  },
  helpModal: {
    width: "min(88%, 340px)",
    maxWidth: 340,
  },
  modalHeader: {
    padding: "12px 16px 0",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
    color: "var(--dock-text, #E2E8F0)",
  },
  modalBody: {
    padding: "8px 16px",
  },
  modalText: {
    fontSize: 12,
    color: "var(--dock-text-dim, #94A3B8)",
    margin: 0,
  },
  helpList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "4px 16px 14px",
  },
  helpItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    color: "var(--dock-text-dim, #CBD5E1)",
    fontSize: 12,
    lineHeight: 1.4,
  },
  modalFooter: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    padding: "8px 16px 12px",
  },
  modalBtnGhost: {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: "var(--dock-text-dim, #94A3B8)",
    cursor: "pointer",
  },
  modalBtnDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    background: "#DC2626",
    color: "#fff",
    cursor: "pointer",
  },

  // ── Settings side panel ──
  settingsOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 900,
  },
  settingsPanel: {
    position: "fixed" as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: "85%",
    maxWidth: 300,
    background: "var(--dock-bg, #0f172a)",
    borderLeft: "1px solid var(--dock-border, rgba(255,255,255,0.08))",
    display: "flex",
    flexDirection: "column",
    zIndex: 901,
    overflow: "hidden",
  },
  settingsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    flexShrink: 0,
  },
  settingsTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--dock-text, #E2E8F0)",
  },
  settingsClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "var(--dock-text-dim, #94A3B8)",
    cursor: "pointer",
  },
  settingsBody: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 14px 20px",
  },
  settingsGroup: {
    marginBottom: 16,
  },
  settingsGroupLabel: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--dock-text-dim, #64748B)",
    marginBottom: 6,
  },
  settingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 0",
  },
  settingLabel: {
    fontSize: 11,
    color: "var(--dock-text, #E2E8F0)",
  },
  settingHint: {
    fontSize: 10,
    color: "var(--dock-text-dim, #64748B)",
    marginTop: 6,
    marginBottom: 6,
    display: "block",
    lineHeight: 1.35,
  },
  settingError: {
    display: "block",
    marginTop: 6,
    color: "#EF4444",
    fontSize: 10,
    lineHeight: 1.35,
  },
  settingCheckbox: {
    width: 14,
    height: 14,
    accentColor: "#3B82F6",
  },
  settingSelect: {
    fontSize: 11,
    padding: "3px 6px",
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "var(--dock-text, #E2E8F0)",
    outline: "none",
  },
  settingSelectFull: {
    width: "100%",
    minHeight: 30,
    marginBottom: 8,
  },
  settingGhostButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 24,
    padding: "0 8px",
    borderRadius: 5,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "rgba(15,23,42,0.35)",
    color: "var(--dock-text-dim, #94A3B8)",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
  },
  presentationMicButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    minHeight: 32,
    marginBottom: 8,
    borderRadius: 6,
    border: "1px solid rgba(29,78,216,0.55)",
    background: "#1D4ED8",
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
  },
  presentationMicButtonActive: {
    borderColor: "rgba(239,68,68,0.7)",
    background: "#991B1B",
  },
  settingNumber: {
    width: 50,
    fontSize: 11,
    padding: "3px 6px",
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "var(--dock-text, #E2E8F0)",
    outline: "none",
    textAlign: "center",
  },
  settingUnit: {
    fontSize: 10,
    color: "var(--dock-text-dim, #64748B)",
    marginLeft: 4,
  },
  startBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    background: "#166534",
    color: "#BBF7D0",
    cursor: "pointer",
    marginTop: 8,
  },
  stopBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "none",
    background: "rgba(239,68,68,0.15)",
    color: "#EF4444",
    cursor: "pointer",
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    background: "rgba(239,68,68,0.08)",
    borderTop: "1px solid rgba(239,68,68,0.15)",
  },

  // ── Live word indicator ──
  transcriptItemLive: {
    borderLeft: "3px solid #3B82F6",
    paddingLeft: 4,
    background: "rgba(59,130,246,0.04)",
    borderRadius: "0 4px 4px 0",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#3B82F6",
    flexShrink: 0,
    marginTop: 5,
    animation: "lm-pulse 1.2s ease-in-out infinite",
    boxShadow: "0 0 6px rgba(59,130,246,0.6)",
  },
  transcriptTextLive: {
    color: "#ffffff",
    fontWeight: 600,
  },
  liveWord: {
    color: "#93C5FD",
    fontWeight: 700,
    fontSize: 13,
    textShadow: "0 0 12px rgba(59,130,246,0.35)",
  },

  hintBar: {
    flexShrink: 0,
    padding: "4px 12px",
    borderTop: "1px solid var(--dock-border, rgba(255,255,255,0.06))",
    background: "rgba(255,255,255,0.02)",
    textAlign: "center",
  },
  hintText: {
    fontSize: 9,
    color: "var(--dock-text-dim, #64748B)",
    letterSpacing: "0.02em",
  },
};
