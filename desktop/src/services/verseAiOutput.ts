/**
 * verseAiOutput.ts — Verse AI's own output: its own Bible theme and its own NDI® source.
 *
 * Nothing here touches the Dock, the Studio or the production theme settings:
 *   - the theme choice is saved only for Verse AI (localStorage);
 *   - the verse is written to /api/verse-ai-state, read only by verse-ai-output.html;
 *   - NDI runs as its own source ("MakeChurchEazy – Verse AI") next to the Studio's.
 * Mac only for now. Needs the free NDI Tools (ndi.video).
 */
import { invoke } from "@tauri-apps/api/core";
import type { BibleTheme } from "../bible/types";
import { getVerse } from "../bible/bibleData";
import { themeSupportsBibleOverlayMode } from "../bible/themeVariantSupport";
import { dockObsClient } from "../dock/dockObsClient";
import { bibleRangeSlide, themeSettingsForMode, toLoopbackBase, withoutAnimation, type StudioMode } from "../studio/studioEngine";
import { getOverlayBaseUrl } from "./overlayUrl";
import { loadAvailableProductionThemes } from "./productionSettings";
import type { VoiceBibleCandidate } from "./voiceBibleTypes";

export interface VerseAiNdiStatus {
  running: boolean;
  feed: string;
  sourceName: string;
  connections: number;
  error: string;
}

const THEME_KEY = "mce-verse-ai-output-theme";
const MODE_KEY = "mce-verse-ai-output-mode";
const NDI_NAME = "MakeChurchEazy – Verse AI";

// ── Theme choice (Verse AI only) ──

export function readVerseAiThemeId(): string {
  try { return localStorage.getItem(THEME_KEY) || ""; } catch { return ""; }
}

export function saveVerseAiThemeId(id: string): void {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
}

export function readVerseAiMode(): StudioMode {
  try { return localStorage.getItem(MODE_KEY) === "lower-third" ? "lower-third" : "fullscreen"; } catch { return "fullscreen"; }
}

export function saveVerseAiMode(mode: StudioMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
}

/** Every visible theme (built-in and the ones the church made) that has this look. */
export async function loadVerseAiThemes(mode: StudioMode): Promise<BibleTheme[]> {
  const all = await loadAvailableProductionThemes();
  return all.filter((theme) => !theme.hidden && themeSupportsBibleOverlayMode(theme, mode));
}

// ── The verse on the output ──

let revision = Date.now();

async function postState(packet: Record<string, unknown>): Promise<void> {
  const base = toLoopbackBase(await getOverlayBaseUrl());
  revision = Math.max(revision + 1, Date.now());
  const response = await fetch(`${base}/api/verse-ai-state`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // a "simple" request: no CORS preflight
    body: JSON.stringify({ revision, packet }),
  });
  if (!response.ok) throw new Error(`The output server answered ${response.status}.`);
}

/** Put a detected verse on Verse AI's output in the chosen theme and look. */
export async function projectVerseAiVerse(candidate: VoiceBibleCandidate, theme: BibleTheme | null, mode: StudioMode): Promise<void> {
  const end = candidate.endVerse && candidate.endVerse > candidate.verse ? candidate.endVerse : candidate.verse;
  const translation = (candidate.translation || "KJV").toUpperCase();
  const verses: Array<{ verse: number; text: string }> = [];
  for (let n = candidate.verse; n <= end; n += 1) {
    const found = await getVerse(candidate.book, candidate.chapter, n, translation);
    if (!found?.text) throw new Error(`${candidate.book} ${candidate.chapter}:${n} is not in ${translation}.`);
    verses.push({ verse: n, text: found.text });
  }
  const slide = bibleRangeSlide(candidate.book, candidate.chapter, translation, verses);
  if (!slide) throw new Error("That verse could not be loaded.");
  const settings = themeSettingsForMode(theme, mode);
  const { data } = dockObsClient.buildStudioOverlayPacket({
    text: slide.text,
    reference: slide.reference,
    mode,
    themeSettings: settings ? (settings as unknown as Record<string, unknown>) : null,
  });
  await postState(data);
}

/** Take the verse off the output (the theme plays its exit animation). */
export async function clearVerseAiVerse(mode: StudioMode): Promise<void> {
  const timestamp = Date.now();
  await postState({ slide: null, theme: null, live: false, blanked: true, timestamp, mode, revision: timestamp });
}

/** Cut = no animation. Exposed so a caller can show a theme without its entrance. */
export { withoutAnimation };

// ── NDI (its own source) ──

const IDLE: VerseAiNdiStatus = { running: false, feed: "", sourceName: "", connections: 0, error: "" };
let current: VerseAiNdiStatus = IDLE;
const listeners = new Set<(status: VerseAiNdiStatus) => void>();
let poll: ReturnType<typeof setInterval> | null = null;

function publish(next: VerseAiNdiStatus): void {
  current = next;
  for (const listener of listeners) listener(current);
  if (current.running && !poll) poll = setInterval(() => { void refreshVerseAiNdi(); }, 2000);
  if (!current.running && poll) { clearInterval(poll); poll = null; }
}

export function getVerseAiNdiStatus(): VerseAiNdiStatus {
  return current;
}

export function onVerseAiNdiChange(listener: (status: VerseAiNdiStatus) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshVerseAiNdi(): Promise<VerseAiNdiStatus> {
  try {
    publish(await invoke<VerseAiNdiStatus>("get_verse_ai_ndi_status"));
  } catch {
    /* not in the app (browser preview) */
  }
  return current;
}

export async function startVerseAiNdi(): Promise<VerseAiNdiStatus> {
  try {
    const base = toLoopbackBase(await getOverlayBaseUrl());
    const url = `${base}/verse-ai-output.html`;
    const answer = invoke<VerseAiNdiStatus>("start_verse_ai_ndi", { url, feed: "verse", name: NDI_NAME });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("The app did not answer. Restart MakeChurchEazy and try again.")), 15000);
    });
    const status = await Promise.race([answer, timeout]);
    publish(status.running || status.error ? status : { ...status, error: "NDI did not start (no reason given)." });
  } catch (error) {
    console.error("[Verse AI NDI]", error);
    publish({ ...IDLE, error: error instanceof Error ? error.message : String(error) });
  }
  return current;
}

export async function stopVerseAiNdi(): Promise<void> {
  try {
    await invoke("stop_verse_ai_ndi");
  } catch {
    /* ignore */
  }
  publish(IDLE);
}
