import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useAppTheme", () => ({
  useAppTheme: () => ({ appearance: { theme: "dark" }, setTheme: vi.fn() }),
}));
import {
  claimNextLmAutoPushCandidate,
  getLmCandidateKey,
  getSelectedTranscriptEntries,
  isFreshForLmAutoPush,
  isLmAutoPushSuppressed,
  LM_AUTO_PUSH_MAX_AGE_MS,
  isLmCompactHeight,
  LM_COMPACT_HEIGHT_PX,
  mergeRetainedLmQueue,
  normalizeLmOverlayMode,
} from "./DockLmTab";
import { retainSuggestionsUntilReplacement } from "../../services/lmDockService";
import dockLmTabSource from "./DockLmTab.tsx?raw";
import speechToScripturePageSource from "../../pages/SpeechToScripturePage.tsx?raw";
import lmDockServiceSource from "../../services/lmDockService.ts?raw";
import type { VoiceBibleCandidate } from "../../services/voiceBibleTypes";
import dockBibleTabSource from "./DockBibleTab.tsx?raw";

function candidate(book: string, chapter: number, verse: number): VoiceBibleCandidate {
  return {
    book,
    chapter,
    verse,
    translation: "KJV",
    label: `${book} ${chapter}:${verse}`,
    snippet: "Verse text",
    confidence: 0.95,
    source: "keyword",
  };
}

describe("DockLmTab settings helpers", () => {
  it("uses the requested short-height breakpoint for the vertical tab rail", () => {
    expect(LM_COMPACT_HEIGHT_PX).toBe(400);
    expect(isLmCompactHeight(399)).toBe(true);
    expect(isLmCompactHeight(400)).toBe(false);
    expect(isLmCompactHeight(0)).toBe(false);
  });

  it("uses icon-only vertical tabs and keeps overlay mode in settings", () => {
    expect(dockLmTabSource).toContain('aria-orientation={isCompactHeight ? "vertical" : "horizontal"}');
    expect(dockLmTabSource).toContain('data-testid={`lm-tab-${tab}`}');
    expect(dockLmTabSource).toMatch(/tabBarCompact:\s*\{[\s\S]*?height: "100%"[\s\S]*?boxSizing: "border-box"[\s\S]*?overflow: "hidden"/);
    expect(dockLmTabSource).toMatch(/tabCompact:\s*\{[\s\S]*?flex: "1 1 0"/);
    expect(dockLmTabSource).not.toContain("style={S.emptyState}");
    expect(dockLmTabSource).not.toContain("!presentationLinkMode && renderOverlayModeSwitch()");
    expect(dockLmTabSource).toContain("{renderOverlayModeSwitch()}");
  });

  it("opens interaction instructions from the help icon instead of a permanent hint bar", () => {
    expect(dockLmTabSource).toContain('data-testid="lm-interaction-help"');
    expect(dockLmTabSource).toContain('data-testid="lm-interaction-help-modal"');
    expect(dockLmTabSource).toContain('t("lm.interactionHelpCopy", "Click a transcript line to copy it.")');
    expect(dockLmTabSource).not.toContain("style={S.hintBar}");
  });

  it("normalizes overlay mode values", () => {
    expect(normalizeLmOverlayMode("lower-third")).toBe("lower-third");
    expect(normalizeLmOverlayMode("fullscreen")).toBe("fullscreen");
    expect(normalizeLmOverlayMode("bad-mode", "lower-third")).toBe("lower-third");
  });

  it("suppresses repeated auto-pushes only inside the configured window", () => {
    expect(isLmAutoPushSuppressed(undefined, 10_000, 15)).toBe(false);
    expect(isLmAutoPushSuppressed(1_000, 10_000, 15)).toBe(true);
    expect(isLmAutoPushSuppressed(1_000, 20_000, 15)).toBe(false);
    expect(isLmAutoPushSuppressed(1_000, 10_000, 0)).toBe(false);
  });

  it("claims one auto-push verse at a time so later verses in a batch are not skipped", () => {
    const first = candidate("John", 3, 11);
    const second = candidate("John", 3, 12);
    const batch = [first, second].map((item) => ({
      key: `queue:${getLmCandidateKey(item)}:1000`,
      candidate: item,
      source: "queue" as const,
    }));
    const claimedKeys = new Set<string>();

    expect(claimNextLmAutoPushCandidate(batch, claimedKeys, new Map(), 1_000, 15)).toBe(batch[0]);
    expect([...claimedKeys]).toEqual([batch[0].key]);
    expect(claimNextLmAutoPushCandidate(batch, claimedKeys, new Map(), 1_100, 15)).toBe(batch[1]);
    expect([...claimedKeys]).toEqual([batch[0].key, batch[1].key]);
  });

  it("uses compact Full/LT mode labels", () => {
    expect(dockLmTabSource).toContain('label: "Full"');
    expect(dockLmTabSource).toContain('label: "LT"');
    expect(dockLmTabSource).not.toContain('label: t("dock.bottomToolbar.fullLabel", "FULL")');
    expect(dockLmTabSource).not.toContain('label: t("dock.bottomToolbar.ltLabel", "LT")');
    expect(dockLmTabSource).toContain("ariaLabel: t(\"lm.fullscreen\")");
    expect(dockLmTabSource).toContain("ariaLabel: t(\"lm.lowerThird\")");
  });

  it("retains detected queue items through temporary empty snapshots", () => {
    const first = candidate("Genesis", 1, 2);
    const retained = mergeRetainedLmQueue([], [first], 1_000, 90_000);
    const stillVisible = mergeRetainedLmQueue(retained, [], 45_000, 90_000);
    const expired = mergeRetainedLmQueue(retained, [], 92_000, 90_000);

    expect(getLmCandidateKey(first)).toBe("Genesis:1:2");
    expect(stillVisible).toHaveLength(1);
    expect(stillVisible[0].candidate.label).toBe("Genesis 1:2");
    expect(expired).toHaveLength(0);
  });

  it("keeps a new or revisited reference ahead of retained queue history", () => {
    const john = candidate("John", 3, 16);
    const genesis = candidate("Genesis", 3, 7);
    const initial = mergeRetainedLmQueue([], [john], 1000);
    const next = mergeRetainedLmQueue(initial, [genesis, john], 2000);
    expect(next[0].candidate.label).toBe("Genesis 3:7");
    expect(next[1].detectedAt).toBe(1000);
    expect(mergeRetainedLmQueue(next, [john, genesis], 3000)[0].candidate.label).toBe("John 3:16");
  });

  it("keeps a suggestion through a temporary empty live-search result", () => {
    const first = candidate("Psalms", 91, 1);
    const replacement = candidate("Psalms", 91, 2);

    expect(retainSuggestionsUntilReplacement([first], [])).toEqual([first]);
    expect(retainSuggestionsUntilReplacement([first], [replacement])).toEqual([replacement]);
  });

  it("keeps transcript selection attached to entry IDs when new lines arrive", () => {
    const firstEntries = ["one", "two", "three"].map((text) => ({
      id: text,
      text,
      finalized: true,
    }));
    const selectedIds = new Set(["one", "two", "three"]);
    const updatedEntries = [
      ...firstEntries,
      { id: "four", text: "four", finalized: true },
    ];

    expect(getSelectedTranscriptEntries(updatedEntries, selectedIds).map((entry) => entry.id))
      .toEqual(["one", "two", "three"]);
  });

  it("tracks actual pushed verses as the live card source", () => {
    expect(dockLmTabSource).toContain("setLiveVerse(candidate)");
    expect(dockLmTabSource).toContain("pushBibleCandidateToOutput(live, effectiveMode)");
  });

  it("projects with the Bible tab's current style and keeps the Bible tab in step", () => {
    // Mode follows the Bible tab (default), with LM's own Full/LT as the override.
    expect(dockLmTabSource).toContain("resolveLmEffectiveOverlayMode({");
    expect(dockLmTabSource).toContain("settings.followBibleStyle");
    expect(dockLmTabSource).toContain('mode: "bible"');
    // Theme overrides are no longer dropped, and the line count / reference prefs come from the Bible tab.
    expect(dockLmTabSource).not.toContain("liveOverrides: null,\n      themeId: bibleTheme.themeId");
    expect(dockLmTabSource).toContain("resolveLmVerseLineCount(overlayMode, liveSnapshot, savedBiblePrefs)");
    expect(dockLmTabSource).toContain("resolveLmReferencePrefs(liveSnapshot, savedBiblePrefs)");
    // A newer stored snapshot wins over an older in-memory one, and the cache is stamped by snapshot.
    expect(dockLmTabSource).toContain("pickNewestLiveBibleSnapshot(");
    expect(dockLmTabSource).toContain("cached.stamp === stamp");
    // After projecting, the Bible tab is told what went live.
    expect(dockLmTabSource).toContain("navigateBibleDock(candidate, false, true)");
    expect(dockLmTabSource).toContain("markLive: true");
    expect(dockBibleTabSource).toContain("payload.markLive");
    expect(dockBibleTabSource).toContain("fullscreenLineCount: fullscreenVerseLineCount");
    expect(dockBibleTabSource).toContain("updatedAt: Date.now()");
  });

  it("moves the Bible dock to an AI reference when the operator shows it", () => {
    const showVerseHandler = dockLmTabSource.match(/const handlePushVerse = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] ?? "";
    expect(showVerseHandler).toContain("onNavigateToBible?.()");
    expect(showVerseHandler).toContain("navigateBibleDock(candidate)");
  });

  it("groups transcript saves by the active microphone session", () => {
    expect(dockLmTabSource).toContain("snapshot.startedAt");
    expect(dockLmTabSource).toContain("`lm-session-${lmSessionStartedAt}`");
    expect(dockLmTabSource).toContain("handleSaveAndShowTranscript(editModal.text)");
    expect(lmDockServiceSource).toContain("startedAt: this.snapshot.startedAt");
  });

  it("takes clickable history references to Bible and requests an OBS preview push", () => {
    expect(dockLmTabSource).toContain("onNavigateToBible?.()");
    expect(dockLmTabSource).toContain("navigateBibleDock({");
    expect(dockLmTabSource).toContain("pushToPreview: true");
    expect(dockBibleTabSource).toContain("payload.pushToPreview");
    expect(dockBibleTabSource).toContain('preparePlannerOutput("bible", false)');
    expect(dockBibleTabSource).toContain("recordHistory: false");
  });

  it("renders the queue without guided target attributes", () => {
    const guidedTargetAttr = ["data", "onboarding"].join("-");
    expect(dockLmTabSource).not.toContain(`${guidedTargetAttr}=`);
  });

  it("keeps queue previews compact while preserving the verse reference", () => {
    expect(dockLmTabSource).toContain("WebkitLineClamp: 3");
    expect(dockLmTabSource).toContain("verseText:");
  });

  it("makes queue and suggestion cards send to OBS when clicked", () => {
    expect(dockLmTabSource).toContain('onClick={() => void handlePushVerse(c, "queue")}');
    expect(dockLmTabSource).toContain('onClick={() => void handlePushVerse(c, "suggestion")}');
    expect(dockLmTabSource).toContain('aria-label={`${c.label}. ${pushActionLabel}`}');
    expect(dockLmTabSource).toContain("event.stopPropagation();");
  });

  it("renders a keyboard-accessible draggable queue and suggestions divider", () => {
    expect(dockLmTabSource).toContain("lm-suggestions-resizer");
    expect(dockLmTabSource).toContain("startSuggestionsResize");
    expect(dockLmTabSource).toContain('aria-valuemin={MIN_SUGGESTIONS_HEIGHT_PERCENT}');
    expect(dockLmTabSource).toContain('event.key === "ArrowUp"');
    expect(dockLmTabSource).toContain('event.key === "ArrowDown"');
    expect(dockLmTabSource).toContain('overflowY: "auto"');
  });

  it("keeps compact LM side tabs recognizable as buttons", () => {
    expect(dockLmTabSource).toContain('className={`lm-tab${isCompactHeight ? " lm-tab--compact" : ""}`}');
    expect(dockLmTabSource).toContain('border: "1px solid var(--dock-border, var(--border))"');
    expect(dockLmTabSource).toContain('borderRadius: 0');
    expect(dockLmTabSource).toContain('minHeight: 48');
    expect(dockLmTabSource).toContain(".lm-tab--compact:hover");
  });

  it("uses the saved Bible stream style when pushing LM verses", () => {
    expect(dockLmTabSource).toContain("resolveDockBibleThemeForOverlayMode(overlayMode)");
    expect(dockLmTabSource).toContain('msg.type === "state:bible-theme-updated"');
    expect(dockLmTabSource).toContain("loadLiveBibleThemeSnapshot()");
    expect(dockLmTabSource).toContain("liveBibleThemeSnapshotRef.current");
    expect(dockLmTabSource).toContain("mergeBibleBackgroundSettings(");
    expect(dockLmTabSource).toContain("resolveDockBibleReferenceLabels(");
    expect(dockLmTabSource).toContain("bibleThemeSettings: bibleTheme.themeSettings");
    expect(dockLmTabSource).toContain("liveOverrides: bibleTheme.liveOverrides");
    expect(dockLmTabSource).toContain("displayReferenceLabel: referenceLabels.displayReferenceLabel");
    expect(dockLmTabSource).not.toContain("loadBiblePrefs()");
  });

  it("renders and wires the auto-push controls", () => {
    expect(dockLmTabSource).toContain("AUTO-PUSH");
    expect(dockLmTabSource).toContain('t("lm.autoPushQueue")');
    expect(dockLmTabSource).toContain('updateSetting("autoPushQueue", e.target.checked)');
    expect(dockLmTabSource).toContain('t("lm.autoPushSuggestions")');
    expect(dockLmTabSource).toContain('updateSetting("autoPushSuggestions", e.target.checked)');
    expect(dockLmTabSource).toContain("isLmAutoPushSuppressed");
  });

  it("keeps speech startup cancellable while slow native mic startup is pending", () => {
    expect(lmDockServiceSource).toContain("void this.scriptureEngine.preload()");
    expect(lmDockServiceSource).toContain("MIC_START_TIMEOUT_MS");
    expect(lmDockServiceSource).toContain("Microphone start timed out.");

    expect(dockLmTabSource).toContain('"Cancel start"');
    expect(dockLmTabSource).not.toContain('disabled={lmStatus === "connecting" || lmStatus === "requesting-mic"}');

    expect(speechToScripturePageSource).toContain("const canStopListening = isListening || isConnecting;");
    expect(speechToScripturePageSource).toContain("onClick={canStopListening ? handleStop : handleStart}");
    expect(speechToScripturePageSource).toContain("disabled={checkingAccess || (!canStopListening && !hasCredits)}");
  });
});

describe("LM auto-push freshness", () => {
  const now = 1_000_000;
  it("auto-pushes only verses detected moments ago", () => {
    expect(isFreshForLmAutoPush(now - 2_000, now)).toBe(true);
    expect(isFreshForLmAutoPush(now - LM_AUTO_PUSH_MAX_AGE_MS, now)).toBe(true);
  });
  it("never auto-pushes an old detection, even if it shows up again later", () => {
    expect(isFreshForLmAutoPush(now - LM_AUTO_PUSH_MAX_AGE_MS - 1, now)).toBe(false);
    expect(isFreshForLmAutoPush(now - 60 * 60_000, now)).toBe(false);
  });
  it("treats a detection with no time as not fresh", () => {
    expect(isFreshForLmAutoPush(undefined, now)).toBe(false);
  });
  it("does not forget pushed detections just because they left the list", () => {
    expect(dockLmTabSource).not.toContain("visibleAutoPushKeys");
    expect(dockLmTabSource).toContain("if (!isListening) return;");
  });
});
