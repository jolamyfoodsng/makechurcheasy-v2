/**
 * StudioPage.tsx — the Presentation Studio: one screen for Bible, Worship, Media and Docs.
 *
 *  Header   Back · BIBLE | WORSHIP | MEDIA | DOCS · theme · Schedule/History · Outputs · settings · full screen
 *  Left     Verse AI (Bible only): live transcript, detected references, suggestions, Auto mode
 *  Centre   the section's workspace (Bible reader, songs, media, documents) beside ONE Preview
 *           (Full Screen / Lower Third and themes under it). Under them, in Bible, the
 *           Queue / Suggestions drawer.
 *  Right    Schedule / History, docked (it takes its own space, never covers the Preview), pinnable
 *  Bottom   camera, camera display, quick actions — the same in every section
 *
 * Selected (highlighted in the workspace), Preview (the Preview screen) and Live (the projector)
 * are independent: browsing or previewing never changes what the congregation sees until
 * Project / Go Live. Everything goes through one controller (studio/studioEngine.ts) to one
 * output page; only what reached the output is written to History.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, startTransition } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  Maximize2,
  ChevronDown,
  Minimize2,
  Monitor,
  MonitorOff,
  MonitorPlay,
  Lock,
  Megaphone,
  Music,
  Play,
  Type as TextIcon,
  Settings as SettingsIcon,
  Square,
  Sun,
  Wifi,
  X,
} from "../components/icons/NativeIcons";
import { useNavigate } from "react-router-dom";
import { useThemeCreateGate } from "../hooks/useThemeCreateGate";
import type { BibleTheme } from "../bible/types";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSettings as getMvSettings } from "../multiview/mvStore";
import { resolveOverlayAssetUrl } from "../services/overlayUrl";
import { getAllSongs, WORSHIP_SONGS_UPDATED_EVENT } from "../worship/worshipDb";
import type { Song } from "../worship/types";
import { DOCK_NOTES_UPDATED_EVENT, loadDockNotes, saveDockNotes, type DockNote } from "../dock/dockNotesStorage";
import type { DockTranslationValue } from "../dock/components/DockTranslationControls";
import { applyTranslation, clampLines, noteLinesOf, reflowSlides, translationSections } from "../studio/studioTextLayout";
import TextSlideTools from "../studio/ui/TextSlideTools";
import { bringInDockNotes, bringInDockSongs } from "../studio/dockImport";
import { BROADCAST_GRAPHICS_UPDATED_EVENT, loadSavedBroadcastGraphics } from "../services/broadcastGraphicsStorage";
import { consumeFreeUse, freeLeftNote, freeLimitMessage } from "../studio/studioAccess";
import { clearStudioLogo, readStudioPrefs, saveStudioLogo, studioLogoUrl } from "../studio/studioPrefs";
import type { VoiceBibleCandidate } from "../services/voiceBibleTypes";
import { deleteMedia, getAllMedia } from "../library/libraryDb";
import type { MediaItem } from "../library/libraryTypes";
import type { ServicePlanItem } from "../service-planner/types";
import { getChapter } from "../bible/bibleData";
import { formatBiblePassageReference, parseBiblePassageReference } from "../dock/bibleMultiPassage";
import { useAuth } from "../contexts/AuthContext";
import { getEffectivePlan } from "../services/licenseService";
import { isProUnlocked } from "../services/proLicense";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import {
  DEFAULT_MEDIA_CONTROL,
  alternateFrameUrl,
  bibleRangeSlide,
  bibleSlides,
  clearProgram,
  getLastOutputError,
  goLive,
  noteSlides,
  previewMonitorUrl,
  setPreviewState,
  setProgramBrand,
  setProgramCamera,
  setPreviewMediaControl,
  type StudioCamera,
  type StudioCompareColumn,
  setProgramMediaControl,
  setProgramMix,
  setProgramScroll,
  setProgramScreen,
  setProgramCameraWarm,
  setAltOutputMode,
  setStudioTextScale,
  setStudioTextStyle,
  setStudioTextLook,
  stopProgramAudio,
  studioBaseUrl,
  type StudioMediaControl,
  type StudioMode,
  type StudioScreen,
  type StudioSlide,
  type StudioTextModule,
} from "../studio/studioEngine";
import { mediaSlide, songSlides, type DeckSlide } from "../studio/studioSlides";
import { useStudioBible } from "../studio/useStudioBible";
import { useVerseAi } from "../studio/useVerseAi";
import { useStudioThemes } from "../studio/useStudioThemes";
import { useStudioCamera } from "../studio/useStudioCamera";
import { useCameraRelay, cameraRelayStatus } from "../studio/useCameraRelay";
import { useCameraLink } from "../studio/useCameraLink";
import { loadMix, saveMix, type StudioMixLayer } from "../studio/studioMix";
import {
  DEFAULT_LAYOUT,
  DRAWER_COLLAPSED,
  VERSE_AI_RAIL,
  LAYOUT_LIMITS,
  clamp,
  planColumns,
  readLayout,
  saveLayout,
  type StudioLayout,
  type StudioSection,
} from "../studio/studioLayout";
import { candidateKey, decideAutoProjection, isAutoProjectable, mentionKey, type AutoTarget } from "../studio/studioQueue";
import { planDraftForSlide, planItemMatchesSlide, resolvePlanItem, type PlanTarget } from "../studio/studioItems";
import { appendToSchedule, markScheduleItemDone, nextScheduleItemId, readActivePlan, recordProjected } from "../studio/studioSchedule";
import { DOCK_SCHEDULE_CHANGED_EVENT } from "../dock/dockScheduleService";
import { importPathsToLibrary, importToLibrary, type ImportResult } from "../studio/studioImport";
import {
  REFERENCE_MEDIA_EXTENSIONS,
  copyReferenceIntoLibrary,
  findMissingReferenceItems,
  isTauriRuntime,
  listenForNativeFileDrops,
  pickMediaPaths,
  relinkReferenceItem,
} from "../library/mediaReferences";
import { COMMON_DOCUMENT_EXTENSIONS } from "../services/mediaValidation";
import StudioTip, { generalTips } from "../studio/ui/StudioTip";
import VerseAiSidebar, { VAI_NEXT_TAB_EVENT, VerseAiRail } from "../studio/ui/VerseAiSidebar";
import QueueDrawer from "../studio/ui/QueueDrawer";
import BroadcastGraphicsDrawer, { type ProjectedGraphic } from "../studio/ui/BroadcastGraphicsDrawer";
import ScheduleDock from "../studio/ui/ScheduleDock";
import ThemePanel from "../studio/ui/ThemePanel";
import PreviewPanel, { type PreviewTab } from "../studio/ui/PreviewPanel";
import SharedControls from "../studio/ui/SharedControls";
import ScenePicker, { type StudioScene } from "../studio/ui/ScenePicker";
import BibleWorkspace from "../studio/ui/BibleWorkspace";
import WorshipWorkspace, { markSongRecent } from "../studio/ui/WorshipWorkspace";
import MediaWorkspace, { MediaControls } from "../studio/ui/MediaWorkspace";
import SlideshowControls from "../studio/ui/SlideshowControls";
import { probeVideoDuration, useSlideshow } from "../studio/useSlideshow";
import DocsWorkspace, { groupDocuments, type DocsSelection } from "../studio/ui/DocsWorkspace";
import MixPanel from "../studio/ui/MixPanel";
import MinistryWorkspace from "../studio/ui/MinistryWorkspace";
import { checkEntitlementSync } from "../services/entitlementClient";
import SettingsModal, { type LogoBg, type SettingsTab } from "../studio/ui/SettingsModal";
import { eventToCombo, isMacPlatform, matchShortcut, shortcutDef, useShortcutBindings, type ShortcutId } from "../studio/shortcuts";
import GlobalSearch, { type GlobalCommand, type GlobalResult, type GlobalRunMode } from "../studio/ui/GlobalSearch";
import ThemeModal from "../studio/ui/ThemeModal";
import Splitter from "../studio/ui/Splitter";
import {
  closeAllProjectors,
  closeProjector,
  listOpenProjectors,
  listStudioMonitors,
  monitorLabel,
  onProjectorsChange,
  openProjector,
  takeSurpriseCloseNote,
  pickDefaultMonitorKey,
  readSavedAltMonitor,
  saveOutputMonitor,
  type OpenProjector,
  type ProjectorFeed,
  type StudioMonitor,
} from "../studio/studioOutputWindow";
import "./StudioPage.css";
import "./StudioShell.css";

/** The Studio has the whole window: the app sidebar and status strips are hidden while it is open. */
const PAGE_CLASS = "studio-page";

const SECTIONS: Array<{ id: StudioSection; label: string; icon: typeof BookOpen }> = [
  { id: "bible", label: "Bible", icon: BookOpen },
  { id: "worship", label: "Text", icon: TextIcon },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "ministry", label: "Ministry", icon: Megaphone },
];

type Message = { text: string; tone: "info" | "error" } | null;

/** The Ministry section has no slides of its own. */
const NO_SLIDES: StudioSlide[] = [];

/** Bible choices the operator keeps between visits: verses per slide and the side-by-side translation. */
interface PassageDraft { reference: string; translation: string }
interface BibleOpts {
  perSlide: number;
  compareWith: string;
  compareLayout: "line-by-line" | "side-by-side";
  /** Compare two different passages (each with its own translation), like the Dock's Passages tab. */
  passagesOn: boolean;
  passages: [PassageDraft, PassageDraft];
}
const EMPTY_PASSAGES: [PassageDraft, PassageDraft] = [{ reference: "", translation: "" }, { reference: "", translation: "" }];
const BIBLE_OPTS_KEY = "mce.studio.bibleOpts.v1";
/** A logo picked in Studio settings (a small picture kept on this computer); empty = the church logo. */
const LOGO_KEY = "mce.studio.logoOverride.v1";
function readLogoOverride(): string {
  try { return localStorage.getItem(LOGO_KEY) || ""; } catch { return ""; }
}
/** Read a picture file, shrink it (max 900 px, transparency kept) and return it as a small data URL. */
function shrinkLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture.")); };
    img.src = url;
  });
}
/** What is behind the logo on the screen: the default look, one colour, or a picture. */
const LOGO_BG_KEY = "mce.studio.logoBg.v1";
const DEFAULT_LOGO_BG: LogoBg = { kind: "default", color: "#0b1f4d", image: "" };
function readLogoBg(): LogoBg {
  try {
    const raw = JSON.parse(localStorage.getItem(LOGO_BG_KEY) || "{}") as Partial<LogoBg>;
    const kind = raw.kind === "color" || raw.kind === "image" ? raw.kind : "default";
    const color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_LOGO_BG.color;
    const image = typeof raw.image === "string" && raw.image.startsWith("data:image/") ? raw.image : "";
    return { kind: kind === "image" && !image ? "default" : kind, color, image };
  } catch {
    return DEFAULT_LOGO_BG;
  }
}
/** The part of the background the output page needs (nothing for the default look). */
function logoBgPayload(bg: LogoBg): { color?: string; image?: string } | undefined {
  if (bg.kind === "color") return { color: bg.color };
  if (bg.kind === "image" && bg.image) return { image: bg.image };
  return undefined;
}
/** Read a picture file for use as a full-screen background (max 1920 px wide, JPEG). */
function shrinkBackground(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture.")); };
    img.src = url;
  });
}
function readBibleOpts(): BibleOpts {
  try {
    const raw = JSON.parse(localStorage.getItem(BIBLE_OPTS_KEY) || "{}") as Partial<BibleOpts>;
    const perSlide = Math.round(Number(raw.perSlide));
    return {
      perSlide: perSlide >= 1 && perSlide <= 4 ? perSlide : 1,
      // Compare is always off when the Studio opens; it is a choice for the verse in front of you, not a setting.
      compareWith: "",
      // Line by line is the Dock's default too.
      compareLayout: raw.compareLayout === "side-by-side" ? "side-by-side" : "line-by-line",
      passagesOn: false,
      passages: [0, 1].map((i) => {
        const p = Array.isArray(raw.passages) ? raw.passages[i] : null;
        return { reference: typeof p?.reference === "string" ? p.reference : "", translation: typeof p?.translation === "string" ? p.translation : "" };
      }) as [PassageDraft, PassageDraft],
    };
  } catch {
    return { perSlide: 1, compareWith: "", compareLayout: "line-by-line", passagesOn: false, passages: EMPTY_PASSAGES };
  }
}
const TEXT_TAB_KEY = "mce.studio.textTab.v1";
function readTextTab(): "worship" | "notes" {
  try { return localStorage.getItem(TEXT_TAB_KEY) === "notes" ? "notes" : "worship"; } catch { return "worship"; }
}

const SONG_LINES_KEY = "mce.studio.songLines.v1";
const TRANSLATIONS_KEY = "mce.studio.translations.v1";
function readRecord<T>(key: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, T> : {};
  } catch { return {}; }
}
function writeRecord(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: the choice just is not remembered */ }
}

/** Where the reader should go, and what to do once the chapter has loaded. */
interface PendingVerse {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  action: "select" | "preview" | "project";
}

function logoUrlFromPath(path: string): string {
  const value = (path || "").trim();
  if (!value) return "";
  if (/^(data:|https?:|blob:)/i.test(value) || value.startsWith("/uploads/")) return value;
  const name = value.replace(/^file:\/\//i, "").split(/[\\/]/).pop();
  return name ? `/uploads/${encodeURIComponent(name)}` : "";
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function slideName(slide: StudioSlide | null): string {
  if (!slide) return "";
  return slide.reference || `${slide.itemTitle}${slide.label ? ` · ${slide.label}` : ""}`;
}

/** The key Verse AI uses for a verse (to mark it LIVE / in Preview in its lists). */
function slideCandidateKey(slide: StudioSlide | null): string {
  const o = slide?.origin;
  if (!slide || slide.module !== "bible" || !o?.book || !o.chapter || !o.verse) return "";
  return candidateKey({ book: o.book, chapter: o.chapter, verse: o.verse, endVerse: o.endVerse });
}

function range(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

async function loadChapterVerses(book: string, chapter: number, translation: string) {
  const passage = await getChapter(book, chapter, translation);
  return passage.verses.map((v) => ({ verse: v.verse, text: v.text }));
}

/** One column of the Passages compare: a typed reference read in its own translation. */
async function buildPassageColumn(reference: string, translation: string): Promise<{ column?: StudioCompareColumn; error?: string }> {
  const parsed = parseBiblePassageReference(reference);
  if (!parsed) return { error: reference.trim() ? "that is not a Bible reference" : "type a reference, like John 3:16" };
  try {
    const verses = await loadChapterVerses(parsed.book, parsed.chapter, translation);
    const last = parsed.endVerse && parsed.endVerse > parsed.verse ? parsed.endVerse : parsed.verse;
    const picked = verses.filter((v) => v.verse >= parsed.verse && v.verse <= last);
    if (picked.length === 0) return { error: `${translation} has no ${formatBiblePassageReference(parsed)} on this computer` };
    const multi = last > parsed.verse;
    const range = multi ? `${parsed.verse}-${last}` : `${parsed.verse}`;
    return {
      column: {
        translation,
        reference: `${parsed.book} ${parsed.chapter}:${range}`,
        text: picked.map((v) => (multi ? `[${v.verse}] ${v.text}` : v.text)).join(" "),
        book: parsed.book,
        chapter: parsed.chapter,
        verse: parsed.verse,
        verseEnd: last,
        verseRange: range,
      },
    };
  } catch {
    return { error: `${translation} could not be read` };
  }
}

/** A Bible slide that shows two different passages side by side. */
function passagesSlide(columns: StudioCompareColumn[]): StudioSlide {
  const a = columns[0];
  return {
    key: `bible-passages:${columns.map((c) => `${c.book}:${c.chapter}:${c.verseRange}:${c.translation}`).join("|")}`,
    module: "bible",
    label: "Passages",
    text: a.text,
    reference: `${a.reference} (${a.translation})`,
    itemTitle: "Two passages",
    origin: { kind: "bible", book: a.book, chapter: a.chapter, verse: a.verse, endVerse: a.verseEnd > a.verse ? a.verseEnd : undefined, translation: a.translation },
    compare: columns,
    compareLayout: "side-by-side",
    compareMode: "passages",
  };
}

/** The slide with the same verse(s) from a second translation, for the side-by-side screen. */
function withCompareColumns(
  slide: StudioSlide | null,
  second: { translation: string; verses: Array<{ verse: number; text: string }> } | null,
  firstTranslation: string,
  compareLayout: "line-by-line" | "side-by-side" = "line-by-line",
): StudioSlide | null {
  if (!slide || slide.module !== "bible" || !second) return slide;
  const o = slide.origin;
  if (!o?.book || !o.chapter || !o.verse) return slide;
  if (second.translation.toUpperCase() === (o.translation ?? firstTranslation).toUpperCase()) return slide;
  const last = o.endVerse && o.endVerse > o.verse ? o.endVerse : o.verse;
  const picked = second.verses.filter((v) => v.verse >= (o.verse as number) && v.verse <= last);
  if (picked.length === 0) return slide;
  const multi = last > o.verse;
  const range = multi ? `${o.verse}-${last}` : `${o.verse}`;
  const base = { book: o.book, chapter: o.chapter, verse: o.verse, verseEnd: last, verseRange: range };
  const columns: StudioCompareColumn[] = [
    // The screen adds "(KJV)" itself, so the reference goes in without it.
    { ...base, translation: o.translation ?? firstTranslation, reference: slide.reference.replace(/\s*\([^)]*\)\s*$/, ""), text: slide.text },
    {
      ...base,
      translation: second.translation,
      reference: `${o.book} ${o.chapter}:${range}`,
      text: picked.map((v) => (multi ? `[${v.verse}] ${v.text}` : v.text)).join(" "),
    },
  ];
  return { ...slide, compare: columns, compareLayout };
}

function localUploadNameFromMediaUrl(url: string): string | null {
  const match = url.split(/[?#]/, 1)[0].match(/(?:^|\/)uploads\/([^/]+)$/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// The theme editor opens in a window on top of the Studio (never a different page).
const ThemeCreatorModal = lazy(() => import("./ThemeCreatorModal"));
const WorshipSongModal = lazy(() => import("../worship/WorshipSongModal"));
const DocumentSongImport = lazy(() => import("../../others/SongImportFullprocess"));

export default function StudioPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canUseAlternateOutput = getEffectivePlan(user) !== "free" || isProUnlocked();
  // The Dock's Ministry tools follow the same plan rules here.
  const canUseTicker = isProUnlocked() || checkEntitlementSync("tickers", getEffectivePlan(user)).allowed;
  const canUseTime = isProUnlocked() || checkEntitlementSync("countdowns", getEffectivePlan(user)).allowed;
  const promptAlternateOutputUpgrade = useCallback(() => {
    void openDashboardSubscriptionPlans();
  }, []);
  const [layout, setLayout] = useState<StudioLayout>(readLayout);
  const section = layout.section;
  // Text has two tabs: Worship (songs) and Notes. `view` is what is really open.
  const [textTab, setTextTabState] = useState<"worship" | "notes">(readTextTab);
  const setTextTab = useCallback((tab: "worship" | "notes") => {
    setTextTabState(tab);
    try { localStorage.setItem(TEXT_TAB_KEY, tab); } catch { /* not remembered */ }
  }, []);
  const view: "bible" | "worship" | "notes" | "media" | "docs" | "ministry" = section === "worship" && textTab === "notes" ? "notes" : section;
  const [bibleOpts, setBibleOptsState] = useState<BibleOpts>(readBibleOpts);
  const bibleOptsRef = useRef(bibleOpts);
  bibleOptsRef.current = bibleOpts;
  const patchBibleOpts = useCallback((patch: Partial<BibleOpts>) => {
    setBibleOptsState((current) => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(BIBLE_OPTS_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  const displayMode = layout.displayMode;
  const transition = layout.transition;
  const previewFirst = layout.previewFirst;
  const textScale = layout.textScale;
  setStudioTextScale(textScale);
  const textBold = layout.textBold;
  const textItalic = layout.textItalic;
  setStudioTextStyle(textBold, textItalic);
  const textColor = layout.textColor;
  const textShadow = layout.textShadow;
  const textAlign = layout.textAlign;
  const textBackground = layout.textBackground;
  const textLook = useMemo(
    () => ({ color: textColor, shadow: textShadow, align: textAlign, background: textBackground }),
    [textColor, textShadow, textAlign, textBackground],
  );
  setStudioTextLook(textLook);
  const [base, setBase] = useState("");
  const [themeModal, setThemeModal] = useState(false);
  const themeGate = useThemeCreateGate();
  const guardTheme = themeGate.guard;
  // Adding or editing a song also opens on top of the Studio ("new" = a blank song, or the song being edited).
  const [songEdit, setSongEdit] = useState<"new" | "edit" | null>(null);
  const [songImport, setSongImport] = useState(false);
  const [themeEdit, setThemeEdit] = useState<{ theme: BibleTheme | null } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [immersive, setImmersive] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("preview");

  // Graphics live in the bottom drawer (Verse AI has the side panel to itself).
  const openGraphics = useCallback(() => {
    setLayout((c) => ({ ...c, drawer: { ...c.drawer, tab: "graphics", open: true } }));
  }, []);

  useEffect(() => saveLayout(layout), [layout]);
  const patchLayout = useCallback((patch: Partial<StudioLayout>) => setLayout((current) => ({ ...current, ...patch })), []);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Info messages fade; errors stay until dismissed.
  useEffect(() => {
    if (!message || message.tone === "error") return undefined;
    const id = window.setTimeout(() => setMessage(null), 4500);
    return () => window.clearTimeout(id);
  }, [message]);
  const say = useCallback((text: string, tone: "info" | "error" = "info") => setMessage({ text, tone }), []);

  // ── Library ──
  const bible = useStudioBible();
  const themesApi = useStudioThemes();
  const themes = themesApi.themes;
  const [songs, setSongs] = useState<Song[]>([]);
  const [notes, setNotes] = useState<DockNote[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [importing, setImporting] = useState("");
  const [missingMediaIds, setMissingMediaIds] = useState<Set<string>>(() => new Set());
  const [mediaDropActive, setMediaDropActive] = useState(false);

  const loadMedia = useCallback(() => {
    void getAllMedia()
      .then((list) => {
        setMedia(list);
        return findMissingReferenceItems(list).then(setMissingMediaIds);
      })
      .catch(() => undefined);
  }, []);

  /** A referenced item got its details, thumbnail or library copy in the background. */
  const replaceMediaItem = useCallback((item: MediaItem) => {
    setMedia((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSongs = () => void getAllSongs().then((list) => { if (!cancelled) setSongs(list); }).catch(() => undefined);
    const loadNotes = () => { if (!cancelled) setNotes(loadDockNotes()); };
    loadSongs();
    loadNotes();
    loadMedia();
    const onFocus = () => { loadSongs(); loadNotes(); loadMedia(); };
    window.addEventListener(WORSHIP_SONGS_UPDATED_EVENT, loadSongs);
    window.addEventListener(DOCK_NOTES_UPDATED_EVENT, loadNotes);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener(WORSHIP_SONGS_UPDATED_EVENT, loadSongs);
      window.removeEventListener(DOCK_NOTES_UPDATED_EVENT, loadNotes);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadMedia]);

  // The Dock's worship songs and notes come in by themselves (once the local server address is known, and again on focus).
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const bring = () => {
      void bringInDockNotes(base).then((n) => { if (!cancelled && n > 0) setNotes(loadDockNotes()); }).catch(() => undefined);
      void bringInDockSongs(base).then((n) => { if (!cancelled && n > 0) void getAllSongs().then(setSongs).catch(() => undefined); }).catch(() => undefined);
    };
    bring();
    window.addEventListener("focus", bring);
    return () => { cancelled = true; window.removeEventListener("focus", bring); };
  }, [base]);

  // ── Selection per section ──
  const chapterKey = `${bible.book}|${bible.chapter}`;
  const [bibleSel, setBibleSel] = useState<{ key: string; anchor: number; verses: number[] }>({ key: "", anchor: 0, verses: [] });
  const selectedVerses = useMemo(() => (bibleSel.key === chapterKey ? bibleSel.verses : []), [bibleSel, chapterKey]);
  const [pending, setPending] = useState<PendingVerse | null>(null);
  const [songId, setSongId] = useState("");
  const [songIdx, setSongIdx] = useState(0);
  const [mediaId, setMediaId] = useState("");
  const [docsSel, setDocsSel] = useState<DocsSelection>(null);
  const [docIdx, setDocIdx] = useState(0);
  // Lines per slide for each song (0 = Original) and the translations made for songs and notes.
  const [songLines, setSongLines] = useState<Record<string, number>>(() => readRecord<number>(SONG_LINES_KEY));
  const [translations, setTranslations] = useState<Record<string, DockTranslationValue>>(() => readRecord<DockTranslationValue>(TRANSLATIONS_KEY));
  const [docFit, setDocFit] = useState<"contain" | "cover">("contain");
  const [screenScroll, setScreenScroll] = useState(0);

  // Notes (in Text) and Documents (in Docs) each show their own kind of item.
  useEffect(() => {
    setDocsSel((current) => {
      if (view === "notes" && current?.kind === "doc") return null;
      if (view === "docs" && current?.kind === "note") return null;
      return current;
    });
  }, [view]);

  // ── Preview / Live ──
  const [previewSlide, setPreviewSlide] = useState<StudioSlide | null>(null);
  const [liveSlide, setLiveSlide] = useState<StudioSlide | null>(null);
  const [screen, setScreen] = useState<StudioScreen>("live");
  const liveSlideRef = useRef<StudioSlide | null>(null);
  const screenRef = useRef<StudioScreen>("live");
  /** The look (Full screen / Lower third) the words on the screen were sent in. */
  const liveModeRef = useRef<StudioMode | null>(null);
  liveSlideRef.current = liveSlide;
  screenRef.current = screen;
  // Picking something (Preview first) flips the monitor from Alternate back to Preview.
  const previewKeyNow = previewSlide?.key ?? "";
  useEffect(() => {
    if (previewKeyNow && previewFirst) setPreviewTab("preview");
  }, [previewKeyNow, previewFirst]);
  const [mediaCtl, setMediaCtl] = useState<StudioMediaControl>(DEFAULT_MEDIA_CONTROL);
  const [audioSlide, setAudioSlide] = useState<StudioSlide | null>(null);
  const [audioCtl, setAudioCtl] = useState<StudioMediaControl>(DEFAULT_MEDIA_CONTROL);
  const [liveScheduleItemId, setLiveScheduleItemId] = useState<string | null>(null);
  const liveScheduleRef = useRef<string | null>(null);

  // ── Decks: the slides of what is open in each section ──
  const bibleReady = bible.loadedKey === `${bible.book}|${bible.chapter}|${bible.translation}`;

  // Side by side: this chapter in the second translation (so Preview shows both at once).
  const [compareData, setCompareData] = useState<{ key: string; translation: string; verses: Array<{ verse: number; text: string }> } | null>(null);
  const [compareStatus, setCompareStatus] = useState<"off" | "loading" | "ready" | "missing">("off");
  useEffect(() => {
    const translation = bibleOpts.compareWith;
    if (!translation || translation === bible.translation) {
      setCompareData(null);
      setCompareStatus("off");
      return undefined;
    }
    let cancelled = false;
    const key = `${bible.book}|${bible.chapter}|${translation}`;
    setCompareStatus("loading");
    void loadChapterVerses(bible.book, bible.chapter, translation)
      .then((verses) => {
        if (cancelled) return;
        setCompareData({ key, translation, verses });
        setCompareStatus(verses.length ? "ready" : "missing");
      })
      .catch((error) => {
        console.warn("[Studio] Could not read the second translation:", translation, error);
        if (cancelled) return;
        setCompareData(null);
        setCompareStatus("missing");
      });
    return () => { cancelled = true; };
  }, [bibleOpts.compareWith, bible.book, bible.chapter, bible.translation]);
  const compareFor = useCallback((slide: StudioSlide | null) => {
    const o = slide?.origin;
    if (!slide || slide.module !== "bible" || slide.compareMode === "passages" || !o?.book || !compareData) return slide;
    if (compareData.key !== `${o.book}|${o.chapter}|${compareData.translation}`) return slide;
    return withCompareColumns(slide, compareData, bible.translation, bibleOpts.compareLayout);
  }, [compareData, bible.translation, bibleOpts.compareLayout]);
  /** Passages tab "Save": read both passages, remember them, and put them in Preview. */
  const savePassages = useCallback(async (drafts: PassageDraft[]): Promise<string[]> => {
    const slow = new Promise<{ column?: StudioCompareColumn; error?: string }>((resolve) => window.setTimeout(() => resolve({ error: "the Bible took too long to answer" }), 8000));
    const results = await Promise.all(drafts.slice(0, 2).map((d) => Promise.race([buildPassageColumn(d.reference, d.translation), slow])));
    const errors = results.map((r, i) => (r.error ? `Passage ${i + 1}: ${r.error}.` : "")).filter(Boolean);
    patchBibleOpts({ passages: [drafts[0], drafts[1]], passagesOn: true, compareWith: "" });
    if (errors.length === 0) {
      setPreviewSlide(passagesSlide(results.map((r) => r.column as StudioCompareColumn)));
      say("Both passages are in Preview. Press Go Live to show them on the screen.");
    }
    return errors;
  }, [patchBibleOpts, say]);
  const bibleDeck = useMemo(
    () => (bibleReady ? bibleSlides(bible.book, bible.chapter, bible.translation, bible.verses) : []),
    [bibleReady, bible.book, bible.chapter, bible.translation, bible.verses],
  );
  const song = songs.find((s) => s.id === songId);
  const songLinesNow = clampLines(songLines[songId]);
  const worshipBase = useMemo<DeckSlide[]>(() => (song ? reflowSlides(songSlides(song), songLinesNow) : []), [song, songLinesNow]);
  const worshipTranslation = songId ? translations[`song:${songId}`] ?? null : null;
  const worshipDeck = useMemo<DeckSlide[]>(() => applyTranslation(worshipBase, worshipTranslation), [worshipBase, worshipTranslation]);
  // The note open in Text → Notes: its slides follow the note's own lines-per-slide (shared with the Dock).
  const openNote = docsSel?.kind === "note" ? notes.find((n) => n.id === docsSel.id) ?? null : null;
  const noteLinesNow = noteLinesOf(openNote);
  const noteBase = useMemo<StudioSlide[]>(
    () => (openNote ? noteSlides(openNote.id, openNote.title || "Note", openNote.content, noteLinesNow) : []),
    [openNote, noteLinesNow],
  );
  const noteTranslation = openNote ? translations[`note:${openNote.id}`] ?? null : null;
  const setTranslationFor = useCallback((key: string, value: DockTranslationValue | null) => {
    setTranslations((current) => {
      const next = { ...current };
      if (value) next[key] = value; else delete next[key];
      writeRecord(TRANSLATIONS_KEY, next);
      return next;
    });
  }, []);
  const changeSongLines = useCallback((lines: number) => {
    if (!songId) return;
    setSongLines((current) => {
      const next = { ...current, [songId]: clampLines(lines) };
      writeRecord(SONG_LINES_KEY, next);
      return next;
    });
    setSongIdx(0);
  }, [songId]);
  const saveNoteEdit = useCallback((id: string, changes: { title: string; content: string }) => {
    // Read the saved notes again first, so a note Verse AI added a moment ago is not lost.
    const next = loadDockNotes().map((x) => (x.id === id ? { ...x, title: changes.title || x.title, content: changes.content, updatedAt: Date.now() } : x));
    saveDockNotes(next);
    setNotes(next);
    setDocIdx(0);
  }, []);
  const changeNoteLines = useCallback((lines: number) => {
    if (!openNote) return;
    const n = clampLines(lines);
    // Saved on the note itself, so the Dock's Notes tab shows the same split.
    const next = loadDockNotes().map((x) => (x.id === openNote.id ? { ...x, autoSplit: n > 0, linesPerSlide: n > 0 ? n : x.linesPerSlide } : x));
    saveDockNotes(next);
    setNotes(next);
    setDocIdx(0);
  }, [openNote]);
  const libraryMedia = useMemo(() => media.filter((m) => !m.documentId && m.source !== "document-conversion"), [media]);
  const mediaDeck = useMemo(() => libraryMedia.map((m) => mediaSlide(m)).filter((s): s is DeckSlide => s !== null), [libraryMedia]);
  const documents = useMemo(() => groupDocuments(media), [media]);
  const docsDeck = useMemo<StudioSlide[]>(() => {
    if (docsSel?.kind === "doc") {
      const doc = documents.find((d) => d.id === docsSel.id);
      return doc ? doc.pages.map((p) => mediaSlide(p, docFit)).filter((s): s is DeckSlide => s !== null) : [];
    }
    if (docsSel?.kind === "note") return applyTranslation(noteBase, noteTranslation);
    return [];
  }, [docsSel, documents, docFit, noteBase, noteTranslation]);

  const bibleSelectedSlide = useMemo(() => {
    if (!bibleReady || selectedVerses.length === 0) return null;
    return bibleRangeSlide(bible.book, bible.chapter, bible.translation, bible.verses.filter((v) => selectedVerses.includes(v.verse)));
  }, [bibleReady, selectedVerses, bible.book, bible.chapter, bible.translation, bible.verses]);

  const selectedSlide: StudioSlide | null = view === "bible" ? bibleSelectedSlide
    : view === "worship" ? worshipDeck[songIdx] ?? null
      : view === "media" ? mediaDeck.find((s) => s.origin?.id === mediaId) ?? null
        : view === "docs" || view === "notes" ? docsDeck[docIdx] ?? null
          : null;

  /** The module whose look (theme, Full Screen / Lower Third) applies to what is open. */
  const lookModule: StudioTextModule | null = previewSlide && previewSlide.module !== "media"
    ? previewSlide.module
    : view === "bible" ? "bible" : view === "worship" ? "worship" : view === "notes" ? "notes" : null;

  // Keep the Preview screen on the previewed slide (never touches the projector).
  useEffect(() => {
    void setPreviewState(compareFor(previewSlide), themes, displayMode);
  }, [previewSlide, themes, displayMode, textScale, textBold, textItalic, textLook, compareFor]);

  // ── Outputs (projector windows) ──
  const [monitors, setMonitors] = useState<StudioMonitor[]>([]);
  const [monitorKey, setMonitorKey] = useState("");
  const [projectorList, setProjectorList] = useState<OpenProjector[]>(() => listOpenProjectors());
  const [busy, setBusy] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState(false);
  /** Which tab of the settings opens (Ctrl/Cmd+/ opens the keyboard shortcuts one). */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsFocus, setSettingsFocus] = useState<"logo" | undefined>(undefined);
  const shortcutBindings = useShortcutBindings();
  /** Search everything: null = closed, otherwise what was typed to open it. */
  const [searchAll, setSearchAll] = useState<string | null>(null);
  const searchAllRef = useRef<string | null>(null);
  searchAllRef.current = searchAll;
  const [wifiLink, setWifiLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; feed: ProjectorFeed } | null>(null);
  const [outputPop, setOutputPop] = useState<{ x: number; y: number } | null>(null);
  const [outputHelp, setOutputHelp] = useState<"output" | "alternate" | null>(null);
  const outputMenuRef = useRef<HTMLDivElement>(null);
  // New users get a pointer to "Start output" until they open the output once (or dismiss it).
  const [outputHintSeen, setOutputHintSeen] = useState(() => {
    try { return localStorage.getItem("mce-studio-output-hint-seen") === "1"; } catch { return false; }
  });
  const markOutputHintSeen = useCallback(() => {
    setOutputHintSeen(true);
    try { localStorage.setItem("mce-studio-output-hint-seen", "1"); } catch { /* ignore */ }
  }, []);
  /** The screen chosen in the Output menu's drop-down ("window" = a new window). */
  const [outPick, setOutPick] = useState("");
  const outputOpen = projectorList.some((p) => p.feed === "program");
  // Alternate output: a second screen with the same item in its own look (e.g. Lower Third for the stream).
  const [altPick, setAltPick] = useState("");
  const [altLook, setAltLookState] = useState<StudioMode>(() => {
    try { return localStorage.getItem("mce-studio-alt-look") === "fullscreen" ? "fullscreen" : "lower-third"; } catch { return "lower-third"; }
  });
  const setAltLook = useCallback((mode: StudioMode) => {
    setAltLookState(mode);
    try { localStorage.setItem("mce-studio-alt-look", mode); } catch { /* ignore */ }
  }, []);
  const altProjector = projectorList.find((p) => p.feed === "alt");
  const altOpen = Boolean(altProjector);
  // Keep a separate alternate packet ready for the Studio's Alternate preview tab,
  // even before a projector or NDI receiver is connected.
  useEffect(() => { void setAltOutputMode(canUseAlternateOutput ? altLook : null); }, [canUseAlternateOutput, altLook]);
  const closingOutputRef = useRef(false);
  const hadOutputRef = useRef(outputOpen);

  useEffect(() => onProjectorsChange(setProjectorList), []);
  useEffect(() => {
    if (outputOpen && !outputHintSeen) markOutputHintSeen();
  }, [outputOpen, outputHintSeen, markOutputHintSeen]);

  // The projector window closing by itself (unplugged screen, crash): a short note.
  useEffect(() => {
    if (hadOutputRef.current && !outputOpen && !closingOutputRef.current) {
      // Keep the technical reason for the console only; the operator just needs to know.
      const why = takeSurpriseCloseNote();
      if (why) console.info("[Studio] Output closed:", why);
      say("The output screen was closed.", "info");
    }
    if (!outputOpen) closingOutputRef.current = false;
    hadOutputRef.current = outputOpen;
  }, [outputOpen, say]);

  const refreshMonitors = useCallback(async () => {
    try {
      const list = await listStudioMonitors();
      setMonitors(list);
      if (list.length) {
        const key = await pickDefaultMonitorKey(list);
        setMonitorKey((current) => (current && list.some((m) => m.key === current) ? current : key));
      }
    } catch {
      setMonitors([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void studioBaseUrl().then((url) => { if (!cancelled) setBase(url); });
    void refreshMonitors();
    window.addEventListener("focus", refreshMonitors);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshMonitors);
    };
  }, [refreshMonitors]);

  // ── The one way onto the screen ──
  const autoRef = useRef<{ since: number; lastAt: number; handled: Set<string> }>({ since: Date.now(), lastAt: 0, handled: new Set() });

  // The camera on the screen right now. The camera arranged in the Layers card is only in Preview
  // until Go Live sends it (like Studio Mode in OBS).
  const [liveCamera, setLiveCamera] = useState<StudioCamera | null>(null);
  const liveCameraRef = useRef<StudioCamera | null>(null);
  liveCameraRef.current = liveCamera;

  // The camera only runs when the operator turns it on, or while it is live on the screen
  // (so taking it off Preview never cuts the camera that is on air). Opening the Studio
  // no longer switches the camera (and its light) on by itself.
  const wordsOn = layout.wordsOn;
  // Like an OBS source, the camera stays running while an output is open (once it has been used here),
  // so switching to it is instant instead of waiting for the camera to start.
  const [cameraReady, setCameraReadyState] = useState(() => {
    try { return localStorage.getItem("mce-studio-camera-ready") !== "0"; } catch { return true; }
  });
  const setCameraReady = useCallback((on: boolean) => {
    setCameraReadyState(on);
    try { localStorage.setItem("mce-studio-camera-ready", on ? "1" : "0"); } catch { /* ignore */ }
  }, []);
  const [cameraUsed, setCameraUsed] = useState(() => {
    try { return localStorage.getItem("mce-studio-camera-used") === "1"; } catch { return false; }
  });
  const anyOutputOpen = projectorList.some((p) => p.feed !== "preview");
  const warmCamera = cameraReady && cameraUsed && anyOutputOpen;
  const camera = useStudioCamera(layout.camera, Boolean(liveCamera?.enabled) || warmCamera, !wordsOn);
  useEffect(() => {
    if (!camera.enabled || cameraUsed) return;
    setCameraUsed(true);
    try { localStorage.setItem("mce-studio-camera-used", "1"); } catch { /* ignore */ }
  }, [camera.enabled, cameraUsed]);
  // The screens keep fetching the camera's pictures while it is warm, so it shows the instant it goes on.
  const cameraIsWarm = warmCamera && Boolean(camera.stream);
  useEffect(() => { void setProgramCameraWarm(cameraIsWarm); }, [cameraIsWarm]);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // The screen windows can't always open the camera themselves, so this window always sends them the
  // camera (live video, plus pictures as a backup) whenever it is running. No Go Live needed first.
  // With the native camera the app itself sends the pictures to every screen, so neither runs.
  const sendingCamera = Boolean(camera.stream) && !camera.native;
  useCameraLink(camera.stream, sendingCamera); // real live video
  useCameraRelay(camera.stream, sendingCamera); // backup pictures
  const pushCameraLive = useCallback(async (cam: StudioCamera): Promise<boolean> => {
    const label = cameraRef.current.devices.find((d) => d.id === cam.deviceId)?.label ?? "";
    const next: StudioCamera = {
      enabled: cam.enabled && cam.layout !== "hidden",
      deviceId: cam.deviceId,
      layout: cam.enabled ? cam.layout : "hidden",
      label,
      wordsOff: cam.wordsOff ?? !layoutRef.current.wordsOn,
      native: cameraRef.current.native,
    };
    const ok = await setProgramCamera(next);
    if (ok) setLiveCamera(next);
    return ok;
  }, []);

  /** "Neither": the camera is off and the words are hidden, so the screen is cleared. */
  const nothingToShow = !layout.wordsOn && !camera.enabled;

  /** Show Bible / Text on or off. The camera is not touched, it only moves behind the words or in front alone. */
  const setWordsOn = useCallback((on: boolean) => {
    patchLayout({ wordsOn: on });
    const cam = cameraRef.current;
    if (cam.enabled) cam.setLayout(on ? "behind-content" : "camera-only");
    // This switch controls whether Bible / song text is visible on Program too. Preview-first
    // stages slides, but a visibility change must take effect on the screen immediately.
    const live = liveCameraRef.current;
    const next: StudioCamera = {
      ...(live ?? { enabled: false, deviceId: cam.deviceId, layout: "hidden" as const, native: cam.native }),
      layout: on && live?.enabled ? "behind-content" : live?.layout ?? "hidden",
      wordsOff: !on,
    };
    void setProgramCamera(next).then((ok) => {
      if (ok) setLiveCamera(next);
    });
  }, [patchLayout]);

  /** Camera on or off. The words are not touched. */
  const setCameraOn = useCallback((on: boolean) => {
    const cam = cameraRef.current;
    if (on) {
      // Free plan: a few camera turn-ons a day (switching a camera that is already on costs nothing).
      const alreadyOn = cam.enabled && cam.layout !== "hidden";
      if (!alreadyOn) {
        if (!consumeFreeUse("camera")) {
          say(freeLimitMessage("camera"), "error");
          return;
        }
        const left = freeLeftNote("camera");
        if (left) say(left);
      }
      cam.setLayout(layoutRef.current.wordsOn ? "behind-content" : "camera-only");
      // Only ask for access when it is missing: asking opens the camera a second time and restarts it.
      if (!cam.enabled && (cam.denied || cam.devices.length === 0)) void cam.requestAccess();
    } else {
      cam.setLayout("hidden");
      // Camera off: Show Bible / Text goes on and stays on (its switch is locked), so the screen is never empty by accident.
      if (!layoutRef.current.wordsOn) patchLayout({ wordsOn: true });
    }
  }, [patchLayout, say]);

  // Camera off means the words are on and locked. This also fixes a saved layout that had both off.
  useEffect(() => {
    if (!camera.enabled && !layout.wordsOn) patchLayout({ wordsOn: true });
  }, [camera.enabled, layout.wordsOn, patchLayout]);

  // "Straight to screen": changing the camera card goes live at once, no second click.
  // Publish the source mode too: switching from the browser fallback to native capture changes
  // how projector windows receive the picture, even when the selected camera stays the same.
  const cameraKey = `${camera.enabled}|${camera.layout}|${camera.deviceId}|${camera.native}`;
  const lastCameraKey = useRef(cameraKey);
  useEffect(() => {
    if (lastCameraKey.current === cameraKey) return;
    lastCameraKey.current = cameraKey;
    if (previewFirst) return;
    const cam = cameraRef.current;
    const on = cam.enabled && cam.layout !== "hidden";
    if (!on && !liveCameraRef.current?.enabled) return;
    void pushCameraLive({ enabled: on, deviceId: cam.deviceId, layout: on ? cam.layout : "hidden" });
  }, [cameraKey, previewFirst, pushCameraLive]);

  const handleClearRef = useRef<() => Promise<void>>(async () => undefined);
  // "Straight to screen": hiding the words with no camera clears the screen at once.
  const lastWordsOn = useRef(layout.wordsOn);
  useEffect(() => {
    if (lastWordsOn.current === wordsOn) return;
    lastWordsOn.current = wordsOn;
    if (previewFirst) return;
    if (!wordsOn && !cameraRef.current.enabled) {
      void pushCameraLive({ enabled: false, deviceId: cameraRef.current.deviceId, layout: "hidden" }).then(() => handleClearRef.current());
    }
  }, [wordsOn, previewFirst, pushCameraLive]);

  const project = useCallback(async (slide: StudioSlide | null, opts: { scheduleItemId?: string | null } = {}): Promise<boolean> => {
    if (!slide) return false;
    let readySlide = slide;
    if (slide.media?.kind === "video") {
      const fileName = localUploadNameFromMediaUrl(slide.media.url);
      if (fileName) {
        let preparationNoticeShown = false;
        const preparationNotice = window.setTimeout(() => {
          preparationNoticeShown = true;
          say(`Preparing “${slideName(slide)}” for Program playback…`);
        }, 700);
        try {
          const prepared = await invoke<{ fileName: string; converted: boolean }>("prepare_studio_video_for_program", { fileName });
          readySlide = {
            ...slide,
            media: { ...slide.media, url: `/uploads/${encodeURIComponent(prepared.fileName)}` },
          };
          if (preparationNoticeShown) say(`“${slideName(slide)}” is ready for Program playback.`);
        } catch (error) {
          console.warn("[Studio] Could not prepare video for Program playback:", error);
          say("This video could not be prepared for Program playback. Try an MP4 with H.264 video and AAC audio, then import it again.", "error");
          return false;
        } finally {
          window.clearTimeout(preparationNotice);
        }
      }
    }
    // Showing words means the operator wants them seen: "camera only" gives way to the words.
    const cam = cameraRef.current;
    let stagedLayout = cam.layout;
    if (slide.media?.kind !== "audio" && (!layoutRef.current.wordsOn || (cam.enabled && cam.layout === "camera-only"))) {
      // Projecting words means they should be seen, so the words come back on. The camera stays as it was.
      patchLayout({ wordsOn: true });
      if (cam.enabled) {
        stagedLayout = "behind-content";
        // The camera effect must not push this change on its own: it would show the bare camera
        // for a moment before the words. The words go first, then the camera follows after them.
        lastCameraKey.current = `${cam.enabled}|${stagedLayout}|${cam.deviceId}`;
        cam.setLayout(stagedLayout);
      }
      say(`The words were hidden, so “${slideName(slide)}” turned them back on.`);
    }
    if (slide.module !== "media" && !slide.text.trim()) {
      say(`“${slideName(slide)}” has no words to show.`, "error");
      return false;
    }
    // Everything passes through Preview: what goes on the screen is shown in Preview first.
    if (slide.media?.kind !== "audio") setPreviewSlide(readySlide);
    // Side by side: load the second translation if it is not ready yet, then show both.
    let outgoing: StudioSlide = readySlide;
    const secondTranslation = bibleOptsRef.current.compareWith;
    const origin = slide.origin;
    if (slide.module === "bible" && slide.compareMode !== "passages" && secondTranslation && origin?.book && origin.chapter && origin.verse) {
      try {
        const verses = await loadChapterVerses(origin.book, origin.chapter, secondTranslation);
        outgoing = withCompareColumns(slide, { translation: secondTranslation, verses }, origin.translation ?? "", bibleOptsRef.current.compareLayout) ?? slide;
      } catch {
        outgoing = slide;
      }
    }
    // Full screen <-> Lower third was changed in Preview: the old look animates out first, then the new one in.
    const liveNow = liveSlideRef.current;
    if (liveNow && liveNow.module !== "media" && slide.module !== "media" && screenRef.current === "live" && liveModeRef.current && liveModeRef.current !== displayMode && transition !== "cut") {
      await clearProgram(liveModeRef.current, { preserveAlternate: true });
      await new Promise((resolve) => window.setTimeout(resolve, 480));
    }
    const ok = await goLive(outgoing, themes, displayMode, transition);
    if (ok && slide.module !== "media") liveModeRef.current = displayMode;
    if (!ok) {
      say(`Couldn't show “${slideName(slide)}” on the screen: ${getLastOutputError() || "the output did not answer"}.`, "error");
      return false;
    }
    if (slide.media?.kind === "audio") {
      setAudioSlide(slide);
      setAudioCtl({ ...DEFAULT_MEDIA_CONTROL, loop: slide.media.loop, muted: slide.media.muted });
    } else {
      setLiveSlide(outgoing);
      setScreen("live");
      // The camera arranged in Preview goes live with the words.
      const staged: StudioCamera = { enabled: cam.enabled && stagedLayout !== "hidden", deviceId: cam.deviceId, layout: cam.enabled ? stagedLayout : "hidden", wordsOff: false };
      const now = liveCameraRef.current;
      if (staged.enabled !== Boolean(now?.enabled) || (staged.enabled && (staged.layout !== now?.layout || staged.deviceId !== now?.deviceId))) {
        void pushCameraLive(staged);
      }
      if (slide.media) setMediaCtl({ ...DEFAULT_MEDIA_CONTROL, loop: slide.media.loop, muted: slide.media.muted, fit: slide.media.fit });
    }
    // A manual Project counts for Auto mode's cool-down, so it never fights the operator.
    autoRef.current.lastAt = Date.now();
    const draft = planDraftForSlide(slide, displayMode);
    if (draft) recordProjected(draft);
    if (slide.origin?.kind === "song" && slide.origin.id) markSongRecent(slide.origin.id);

    // Schedule: the item now on the screen is LIVE; the one before it is done.
    const plan = readActivePlan();
    const match = opts.scheduleItemId
      ?? plan?.items.find((i) => planItemMatchesSlide(i, slide, displayMode))?.id
      ?? null;
    const previous = liveScheduleRef.current;
    if (previous && match !== previous) markScheduleItemDone(previous);
    liveScheduleRef.current = match;
    setLiveScheduleItemId(match);
    return true;
  }, [themes, displayMode, transition, say, pushCameraLive]);

  // Changing the look or the theme re-draws what is live (it is not a new item in History).
  const liveModule: StudioTextModule | null = liveSlide && liveSlide.module !== "media" ? liveSlide.module : null;
  const lookSig = `${displayMode}|${liveModule ? themesApi.current(liveModule, displayMode)?.id ?? "" : ""}|${liveSlide?.key ?? ""}|${textScale}|${textBold ? "b" : ""}${textItalic ? "i" : ""}|${textColor}|${textShadow}|${textAlign}|${textBackground}`;
  const lastLookSig = useRef(lookSig);
  const switchingRef = useRef(false);
  useEffect(() => {
    const previous = lastLookSig.current;
    lastLookSig.current = lookSig;
    // Only a new look or theme for the SAME live slide is re-drawn (a new slide was just sent).
    const sameSlide = previous.split("|")[2] === (liveSlide?.key ?? "");
    if (previous === lookSig || !sameSlide || switchingRef.current) return;
    // "Preview first": a new look only reaches the screen when Go Live is pressed.
    if (previewFirst) return;
    if (liveSlide && liveSlide.module !== "media" && screen === "live") void goLive(liveSlide, themes, displayMode, "cut").then((ok) => { if (ok) liveModeRef.current = displayMode; });
  }, [lookSig, liveSlide, themes, displayMode, screen, previewFirst]);

  /** Edit a theme (or make a new one) in a window inside the Studio. A ready-made theme is edited as your own copy. */
  const startEditTheme = useCallback(async (theme: BibleTheme | null) => {
    if (!theme) {
      setThemeEdit({ theme: null });
      return;
    }
    if (theme.source === "custom") {
      setThemeEdit({ theme });
      return;
    }
    if (!(await guardTheme())) return;
    setThemeEdit({ theme: { ...theme, id: `custom-${theme.id}-${Date.now().toString(36)}`, name: `${theme.name} (my copy)`, source: "custom" } });
  }, [guardTheme]);

  // Full Screen <-> Lower Third: the old look animates out, then the new one animates in.
  const changeDisplayMode = useCallback(async (mode: StudioMode) => {
    if (mode === displayMode) return;
    const live = liveSlide;
    // "Preview first": only Preview changes; the screen follows when Go Live is pressed.
    if (previewFirst) {
      patchLayout({ displayMode: mode });
      return;
    }
    if (!live || live.module === "media" || screen !== "live" || transition === "cut") {
      patchLayout({ displayMode: mode });
      return;
    }
    switchingRef.current = true;
    try {
      await clearProgram(displayMode, { preserveAlternate: true });
      await new Promise((resolve) => window.setTimeout(resolve, 480));
      patchLayout({ displayMode: mode });
      const ok = await goLive(live, themes, mode, "fade");
      if (ok) liveModeRef.current = mode;
      if (!ok) say(`Couldn't change the look: ${getLastOutputError() || "the output did not answer"}.`, "error");
    } finally {
      window.setTimeout(() => { switchingRef.current = false; }, 400);
    }
  }, [displayMode, liveSlide, screen, transition, themes, patchLayout, say, previewFirst]);

  // ── "What's on the screen": Full screen / Lower third / Camera / Camera + lower third ──
  // One choice instead of separate words and camera switches. "Straight to screen": it goes on
  // the screen at once. "Preview first": it is set up in Preview, and Send to Screen puts it up.
  const cameraShown = camera.enabled && camera.layout !== "hidden";
  const activeScene: StudioScene | null =
    cameraShown && !wordsOn ? "camera"
      : cameraShown && wordsOn && displayMode === "lower-third" ? "camera-lt"
        : !cameraShown && wordsOn && displayMode === "fullscreen" ? "fullscreen"
          : !cameraShown && wordsOn && displayMode === "lower-third" ? "lower-third"
            : null;

  /** Full Screen / Lower Third, applied to what is on the screen now. */
  const applyLook = useCallback(async (mode: StudioMode) => {
    if (mode === displayMode) return;
    if (!previewFirst) {
      await changeDisplayMode(mode);
      return;
    }
    // Preview first: only Preview changes; Send to Screen puts the new look up.
    patchLayout({ displayMode: mode });
  }, [displayMode, previewFirst, changeDisplayMode, patchLayout]);

  // Set by the word choices (not Camera); the effect below then puts the selected verse/song up
  // (once the look has switched) if nothing is on the screen yet.
  const [sceneGo, setSceneGo] = useState<{ mode: StudioMode; n: number } | null>(null);
  const chooseScene = useCallback(async (scene: StudioScene) => {
    // Media and Docs fill the screen on their own: there the choice is only the picture or the
    // camera, and the Bible / song look (Full screen / Lower third) is left as it is.
    const pictureView = view === "media" || view === "docs";
    setSceneGo(scene === "camera" || previewFirst || pictureView ? null : { mode: scene === "fullscreen" ? "fullscreen" : "lower-third", n: Date.now() });
    const cam = cameraRef.current;
    const camWasOn = cam.enabled && cam.layout !== "hidden";
    if (scene === "fullscreen" || scene === "lower-third") {
      // Words / picture only: the camera goes off.
      if (camWasOn) cam.setLayout("hidden");
      if (!layoutRef.current.wordsOn) patchLayout({ wordsOn: true });
      if (previewFirst) {
        if (!pictureView) patchLayout({ displayMode: scene });
        return;
      }
      await pushCameraLive({ enabled: false, deviceId: cam.deviceId, layout: "hidden", wordsOff: false });
      if (!pictureView) await applyLook(scene);
      return;
    }
    if (!camWasOn) {
      // Free plan: a few camera turn-ons a day (switching between the camera choices costs nothing).
      if (!consumeFreeUse("camera")) {
        say(freeLimitMessage("camera"), "error");
        return;
      }
      const left = freeLeftNote("camera");
      if (left) say(left);
      // Only ask for access when it is missing: asking opens the camera a second time and restarts it.
      if (!cam.enabled && (cam.denied || cam.devices.length === 0)) void cam.requestAccess();
    }
    if (scene === "camera") {
      patchLayout({ wordsOn: false });
      cam.setLayout("camera-only");
      if (previewFirst) return;
      await pushCameraLive({ enabled: true, deviceId: cam.deviceId, layout: "camera-only", wordsOff: true });
      return;
    }
    patchLayout({ wordsOn: true });
    cam.setLayout("behind-content");
    if (previewFirst) {
      patchLayout({ displayMode: "lower-third" });
      return;
    }
    await pushCameraLive({ enabled: true, deviceId: cam.deviceId, layout: "behind-content", wordsOff: false });
    await applyLook("lower-third");
  }, [applyLook, patchLayout, pushCameraLive, say, previewFirst, view]);

  // A word choice with nothing on the screen yet: put up the selected verse or song
  // in the new look. Runs after the look has changed, so `project` uses the new Full Screen / Lower Third.
  useEffect(() => {
    if (!sceneGo || displayMode !== sceneGo.mode || !wordsOn) return;
    setSceneGo(null);
    if (liveSlide) return;
    const target = previewSlide ?? selectedSlide;
    if (target && target.module !== "media") void project(target);
    // Only when a choice is made (and its look is in place), not whenever the slide changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneGo, wordsOn, displayMode]);

  const handleClear = useCallback(async () => {
    const settings = getMvSettings();
    const cameraNow = cameraRef.current;
    // Studio logos are saved in uploads plus studio-prefs.json. Read that record here as
    // well as browser storage so Clear still uses the church's logo after a fresh launch.
    const override = readLogoOverride();
    const prefs = !override && base ? await readStudioPrefs(base) : null;
    const savedLogo = prefs?.logoFile ? studioLogoUrl(prefs.logoVersion) : "";
    const ok = await clearProgram(displayMode, {
      screen: "logo",
      logoUrl: logoUrlFromPath(override || savedLogo || settings.brandLogoPath),
      churchName: settings.churchName,
      logoBg: logoBgPayload(readLogoBg()),
      camera: { enabled: false, deviceId: cameraNow.deviceId, layout: "hidden", wordsOff: false, native: cameraNow.native },
    });
    if (!ok) say(`Couldn't clear the screen: ${getLastOutputError() || "the output did not answer"}.`, "error");
    liveModeRef.current = null;
    setLiveSlide(null);
    setLiveCamera(null);
    setScreen("logo");
    liveScheduleRef.current = null;
    setLiveScheduleItemId(null);
  }, [base, displayMode, say]);
  handleClearRef.current = handleClear;

  const [logoOverride, setLogoOverride] = useState<string>(readLogoOverride);
  const logoSrc = logoUrlFromPath(logoOverride) || logoUrlFromPath(getMvSettings().brandLogoPath);
  const applyLogo = useCallback((value: string) => {
    if (!value) void clearStudioLogo();
    try {
      if (value) localStorage.setItem(LOGO_KEY, value); else localStorage.removeItem(LOGO_KEY);
    } catch {
      say("The logo could not be saved on this computer.", "error");
    }
    setLogoOverride(value);
    // The logo is on the screen right now: it changes there too.
    if (screenRef.current === "logo") {
      void setProgramScreen("logo", { logoUrl: value || logoUrlFromPath(getMvSettings().brandLogoPath), churchName: getMvSettings().churchName, logoBg: logoBgPayload(logoBgRef.current) });
    }
  }, [say]);
  const [logoBg, setLogoBg] = useState<LogoBg>(readLogoBg);
  const logoBgRef = useRef(logoBg);
  logoBgRef.current = logoBg;
  useEffect(() => {
    const settings = getMvSettings();
    void setProgramBrand({
      logoUrl: logoUrlFromPath(logoOverride) || logoUrlFromPath(settings.brandLogoPath),
      churchName: settings.churchName,
      logoBg: logoBgPayload(logoBg),
      logoScale: layout.logoScale,
    });
  }, [layout.logoScale, logoBg, logoOverride]);
  const applyLogoBg = useCallback((next: LogoBg) => {
    try {
      localStorage.setItem(LOGO_BG_KEY, JSON.stringify(next));
    } catch {
      say("The background could not be saved on this computer.", "error");
    }
    setLogoBg(next);
    // The logo is on the screen right now: the background changes there too.
    if (screenRef.current === "logo") {
      void setProgramScreen("logo", { logoUrl: logoOverride || logoUrlFromPath(getMvSettings().brandLogoPath), churchName: getMvSettings().churchName, logoBg: logoBgPayload(next) });
    }
  }, [say, logoOverride]);
  const pickLogoBg = useCallback(async (file: File) => {
    try {
      applyLogoBg({ ...logoBgRef.current, kind: "image", image: await shrinkBackground(file) });
      say("Logo background changed.");
    } catch (err) {
      say(err instanceof Error ? err.message : "That picture could not be read.", "error");
    }
  }, [applyLogoBg, say]);
  const pickLogo = useCallback(async (file: File) => {
    try {
      const data = await shrinkLogo(file);
      // Kept as a file on this computer (and in the cloud backup), so it is still there after a refresh or restart.
      const saved = await saveStudioLogo(data);
      if (saved) applyLogo(saved);
      else {
        applyLogo(data);
        say("The logo is in use, but it could not be saved as a file.", "error");
        return;
      }
      say("Logo changed.");
    } catch (err) {
      say(err instanceof Error ? err.message : "That logo could not be read.", "error");
    }
  }, [applyLogo, say]);

  // The saved logo comes back from disk on start, even if the browser storage was cleared.
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    void readStudioPrefs(base).then(async (prefs) => {
      if (cancelled) return;
      if (prefs) {
        const wanted = prefs.logoFile ? studioLogoUrl(prefs.logoVersion) : "";
        setLogoOverride((current) => {
          if (current === wanted) return current;
          try { if (wanted) localStorage.setItem(LOGO_KEY, wanted); else localStorage.removeItem(LOGO_KEY); } catch { /* the file is the source of truth */ }
          return wanted;
        });
        return;
      }
      // A logo picked before it was kept as a file: move it to disk once.
      const old = readLogoOverride();
      if (old.startsWith("data:")) {
        const url = await saveStudioLogo(old);
        if (url && !cancelled) {
          try { localStorage.setItem(LOGO_KEY, url); } catch { /* ignore */ }
          setLogoOverride(url);
        }
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [base]);

  const toggleScreen = useCallback((next: StudioScreen) => {
    const target: StudioScreen = screen === next ? "live" : next;
    if (target === "logo") {
      const settings = getMvSettings();
      void setProgramScreen("logo", { logoUrl: logoOverride || logoUrlFromPath(settings.brandLogoPath), churchName: settings.churchName, logoBg: logoBgPayload(logoBgRef.current) });
    } else {
      void setProgramScreen(target);
    }
    setScreen(target);
  }, [screen, logoOverride, say]);

  const changeMedia = useCallback((change: Partial<StudioMediaControl>) => {
    setMediaCtl((current) => ({ ...current, ...change }));
    void setProgramMediaControl(change, "video");
  }, []);
  const changeAudio = useCallback((change: Partial<StudioMediaControl>) => {
    setAudioCtl((current) => ({ ...current, ...change }));
    void setProgramMediaControl(change, "audio");
  }, []);
  const stopAudio = useCallback(() => {
    void stopProgramAudio();
    setAudioSlide(null);
  }, []);

  // ── Picture / video slideshow (Media tab: tick several, Start slideshow) ──
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const slideshowIsLiveRef = useRef(false);
  const slideshow = useSlideshow({
    project: (id, kind) => {
      const slide = mediaDeck.find((s) => s.origin?.id === id);
      if (!slide) return;
      setMediaId(id);
      // In a video slideshow each video plays once, then the next one starts.
      const shown = kind === "video" && slide.media ? { ...slide, media: { ...slide.media, loop: false } } : slide;
      if (layoutRef.current.previewFirst && !slideshowIsLiveRef.current) {
        setPreviewSlide(shown);
        return;
      }
      return project(shown);
    },
    durationOf: async (id) => {
      const known = mediaById.get(id)?.durationSec;
      if (known && known > 0) return known;
      const url = mediaDeck.find((s) => s.origin?.id === id)?.media?.url;
      return url ? probeVideoDuration(/^(https?:|blob:|data:)/i.test(url) ? url : `${base}${url}`) : undefined;
    },
    onVideoPaused: (paused) => {
      if (layoutRef.current.previewFirst && !slideshowIsLiveRef.current) void setPreviewMediaControl({ paused });
      else changeMedia({ paused });
    },
  });
  const startSlideshow = useCallback((ids: string[], kind: "image" | "video", startIndex = 0) => {
    slideshowIsLiveRef.current = !layoutRef.current.previewFirst;
    slideshow.start(ids, kind, startIndex);
  }, [slideshow.start]);
  const setPreviewFirst = useCallback((value: boolean) => {
    if (value) slideshowIsLiveRef.current = false;
    patchLayout({ previewFirst: value });
  }, [patchLayout]);
  useEffect(() => {
    if (!slideshow.show) slideshowIsLiveRef.current = false;
  }, [slideshow.show]);
  // Showing anything else on the screen ends the slideshow (its place is kept for "Resume").
  // It only counts once one of the slideshow's own items has been on the screen (the first
  // item is projected a moment after Start, while the old item is still live).
  const slideshowIds = slideshow.show?.ids;
  const slideshowWasLive = useRef(false);
  useEffect(() => { slideshowWasLive.current = false; }, [slideshowIds]);
  useEffect(() => {
    if (!slideshowIds || !liveSlide) return;
    const id = liveSlide.module === "media" ? liveSlide.origin?.id : undefined;
    if (id && slideshowIds.includes(id)) { slideshowWasLive.current = true; return; }
    if (slideshowWasLive.current) slideshow.stop();
  }, [liveSlide, slideshowIds, slideshow.stop]);

  // ── Choosing a section ──
  // The Schedule / History panel stays exactly as it is when you move between sections.
  const chooseSection = useCallback((next: StudioSection, _keepDock = false) => {
    // A transition: the tab highlights at once, the heavier workspace swaps in right after.
    startTransition(() => setLayout((current) => (current.section === next ? current : { ...current, section: next })));
  }, []);

  // ── Bible ──
  const goToReference = useCallback((book: string, chapter: number, verse?: number, endVerse?: number, action: PendingVerse["action"] = "preview") => {
    bible.goTo(book, chapter);
    setPending({ book, chapter, verse: verse ?? 1, endVerse, action });
  }, [bible]);

  const rangeSlideFor = useCallback((verses: number[]) => (
    bibleRangeSlide(bible.book, bible.chapter, bible.translation, bible.verses.filter((v) => verses.includes(v.verse)))
  ), [bible.book, bible.chapter, bible.translation, bible.verses]);

  // Once the chapter has loaded: select the verse(s), and preview or project them.
  useEffect(() => {
    if (!pending || !bibleReady || bible.book !== pending.book || bible.chapter !== pending.chapter) return;
    const job = pending;
    setPending(null);
    const exists = bible.verses.some((v) => v.verse === job.verse);
    if (!exists) {
      if (bible.verses.length) say(`${job.book} ${job.chapter}:${job.verse} isn't in ${bible.translation}.`, "error");
      return;
    }
    const last = job.endVerse && job.endVerse > job.verse ? Math.min(job.endVerse, job.verse + 40) : job.verse;
    const verses = range(job.verse, last).filter((n) => bible.verses.some((v) => v.verse === n));
    setBibleSel({ key: `${job.book}|${job.chapter}`, anchor: job.verse, verses });
    const slide = bibleRangeSlide(job.book, job.chapter, bible.translation, bible.verses.filter((v) => verses.includes(v.verse)));
    if (job.action === "preview") setPreviewSlide(slide);
    if (job.action === "project") void project(slide);
  }, [pending, bibleReady, bible.book, bible.chapter, bible.verses, bible.translation, project, say]);

  const pickVerse = useCallback((verse: number, extend: boolean) => {
    const current = bibleSel.key === chapterKey ? bibleSel : { key: chapterKey, anchor: verse, verses: [] as number[] };
    let verses: number[];
    let anchor = current.anchor;
    if (extend && current.verses.length) {
      verses = range(anchor, verse).slice(0, 41);
    } else {
      // "Verses on the screen": 1 shows one verse, 2-4 shows that many verses together.
      const per = bibleOptsRef.current.perSlide;
      const lastVerse = bible.verses.length ? bible.verses[bible.verses.length - 1].verse : verse;
      verses = range(verse, Math.max(verse, Math.min(verse + per - 1, lastVerse)));
      anchor = verse;
    }
    setBibleSel({ key: chapterKey, anchor, verses });
    const slide = rangeSlideFor(verses);
    if (previewFirst || extend) setPreviewSlide(slide);
    else void project(slide);
  }, [bibleSel, chapterKey, rangeSlideFor, previewFirst, project, bible.verses]);

  const projectVerses = useCallback((verses: number[]) => {
    setBibleSel({ key: chapterKey, anchor: verses[0], verses });
    void project(rangeSlideFor(verses));
  }, [chapterKey, rangeSlideFor, project]);

  const candidateFromVerses = useCallback((verses: number[]): VoiceBibleCandidate | null => {
    const slide = rangeSlideFor(verses);
    if (!slide?.origin?.verse) return null;
    const end = slide.origin.endVerse;
    return {
      book: bible.book,
      chapter: bible.chapter,
      verse: slide.origin.verse,
      endVerse: end,
      translation: bible.translation,
      label: end ? `${bible.book} ${bible.chapter}:${slide.origin.verse}-${end}` : `${bible.book} ${bible.chapter}:${slide.origin.verse}`,
      snippet: slide.text.replace(/\[\d+\]\s*/g, ""),
      confidence: 1,
      source: "keyword",
      detectedAt: Date.now(),
    };
  }, [rangeSlideFor, bible.book, bible.chapter, bible.translation]);

  const schedule = useCallback((slide: StudioSlide | null, extra?: { whole?: "song" | "note" }) => {
    if (!slide) return;
    const draft = planDraftForSlide(slide, displayMode);
    if (!draft) {
      say("This item can't be added to the schedule.", "error");
      return;
    }
    if (extra?.whole === "song" && song) {
      draft.label = song.metadata.title;
      draft.payloadSnapshot = { ...draft.payloadSnapshot, isWholeSong: true, sectionIdx: 0, sectionLabel: "Song" };
    }
    if (extra?.whole === "note") {
      draft.label = slide.itemTitle;
      draft.payloadSnapshot = { ...draft.payloadSnapshot, isWholeNote: true, slideIndex: 0 };
    }
    const added = appendToSchedule(draft);
    if (added) say(`Added “${added.label}” to the schedule.`);
    else say("Couldn't add it to the schedule.", "error");
  }, [displayMode, song, say]);

  // ── Verse AI ──
  const ai = useVerseAi(true);
  // Auto mode is on by default in the Studio (references said after it opens go on the screen).
  const [autoMode, setAutoModeState] = useState(true);
  const [autoMessage, setAutoMessage] = useState("");

  /** A verse (or passage) from Verse AI as a slide, read from the operator's translation. */
  const slideForReference = useCallback(async (ref: { book: string; chapter: number; verse: number; endVerse?: number }): Promise<StudioSlide | null> => {
    const translation = bible.translation;
    try {
      const verses = await loadChapterVerses(ref.book, ref.chapter, translation);
      const last = ref.endVerse && ref.endVerse > ref.verse ? ref.endVerse : ref.verse;
      const picked = verses.filter((v) => v.verse >= ref.verse && v.verse <= last);
      return picked.length ? bibleRangeSlide(ref.book, ref.chapter, translation, picked) : null;
    } catch {
      return null;
    }
  }, [bible.translation]);

  const previewCandidate = useCallback((c: VoiceBibleCandidate) => {
    chooseSection("bible");
    goToReference(c.book, c.chapter, c.verse, c.endVerse, "preview");
  }, [chooseSection, goToReference]);

  const projectCandidate = useCallback(async (c: { book: string; chapter: number; verse: number; endVerse?: number; label: string }) => {
    const slide = await slideForReference(c);
    if (!slide) {
      say(`Couldn't read ${c.label} in ${bible.translation}, so nothing was shown.`, "error");
      return false;
    }
    return project(slide);
  }, [slideForReference, project, say, bible.translation]);

  const scheduleCandidate = useCallback(async (c: VoiceBibleCandidate) => {
    const slide = await slideForReference(c);
    if (!slide) {
      say(`Couldn't read ${c.label} in ${bible.translation}.`, "error");
      return;
    }
    schedule(slide);
  }, [slideForReference, schedule, say, bible.translation]);

  const setAutoMode = useCallback((on: boolean) => {
    autoRef.current = { since: Date.now(), lastAt: 0, handled: new Set() };
    setAutoModeState(on);
    setAutoMessage(on ? "On: references said from now on go on the screen" : "");
  }, []);

  // Auto mode: put certain, newly said references on the screen (never suggestions).
  const projectAuto = useCallback(async (target: AutoTarget) => {
    // "Preview first": a detected verse only waits in Preview, it never goes on the screen by itself.
    if (previewFirst) {
      const slide = await slideForReference(target);
      if (slide) setPreviewSlide(slide);
      setAutoMessage(slide ? `${target.label} is ready in Preview (Send to Screen to show it)` : `Couldn't read ${target.label}`);
      return;
    }
    const ok = await projectCandidate(target);
    setAutoMessage(ok
      ? `Showed ${target.label} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : `Couldn't show ${target.label}`);
  }, [projectCandidate, previewFirst, slideForReference]);

  useEffect(() => {
    if (!autoMode) return undefined;
    let timer = 0;
    const run = () => {
      const state = autoRef.current;
      const decision = decideAutoProjection(ai.detected, state, Date.now());
      decision.skip.forEach((k) => state.handled.add(k));
      if (decision.target) {
        decision.target.keys.forEach((k) => state.handled.add(k));
        state.lastAt = Date.now();
        void projectAuto(decision.target);
      } else if (decision.retryInMs > 0) {
        timer = window.setTimeout(run, decision.retryInMs + 50);
      }
    };
    run();
    return () => window.clearTimeout(timer);
  }, [autoMode, ai.detected, projectAuto]);


  // "Verse found" card: while the Verse AI panel is closed, a verse that was heard (or suggested) pops up
  // so it can be previewed or projected without opening the panel.
  const [foundCard, setFoundCard] = useState<VoiceBibleCandidate | null>(null);
  const foundSeenRef = useRef<Set<string>>(new Set());
  const foundSinceRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!layout.verseAiCollapsed) return;
    const pool: VoiceBibleCandidate[] = [...ai.suggestions, ...ai.detected.filter((c) => !(autoMode && isAutoProjectable(c)))];
    const fresh = pool
      .filter((c) => (c.detectedAt ?? 0) >= foundSinceRef.current && !foundSeenRef.current.has(mentionKey(c)))
      .sort((a, b) => (b.detectedAt ?? 0) - (a.detectedAt ?? 0))[0];
    if (!fresh) return;
    foundSeenRef.current.add(mentionKey(fresh));
    setFoundCard(fresh);
  }, [ai.suggestions, ai.detected, layout.verseAiCollapsed, autoMode]);
  useEffect(() => {
    if (!foundCard) return undefined;
    const id = window.setTimeout(() => setFoundCard(null), 15000);
    return () => window.clearTimeout(id);
  }, [foundCard]);

  // ── Worship / Media / Docs ──
  const pickIndex = useCallback((slides: StudioSlide[], index: number, setIdx: (i: number) => void) => {
    const slide = slides[index];
    if (!slide) return;
    setIdx(index);
    if (previewFirst) setPreviewSlide(slide);
    else void project(slide);
  }, [previewFirst, project]);

  const pickMedia = useCallback((id: string) => {
    setMediaId(id);
    const slide = mediaDeck.find((s) => s.origin?.id === id) ?? null;
    if (!slide) return;
    if (previewFirst || slide.media?.kind === "audio") setPreviewSlide(slide);
    else void project(slide);
  }, [mediaDeck, previewFirst, project]);

  const projectMedia = useCallback((id: string) => {
    setMediaId(id);
    const slide = mediaDeck.find((s) => s.origin?.id === id) ?? null;
    if (slide) void project(slide);
  }, [mediaDeck, project]);

  const reportImport = useCallback((result: ImportResult, what: "media" | "document") => {
    const parts: string[] = [];
    if (result.imported) parts.push(`${result.imported} ${what === "document" ? "page" : "file"}${result.imported === 1 ? "" : "s"} added`);
    if (result.overLimit) parts.push(`${result.overLimit} skipped (your plan's limit is reached)`);
    if (result.unsupported.length) parts.push(`not supported: ${result.unsupported.join(", ")}`);
    if (result.rejected.length) parts.push(result.rejected.join(" "));
    say(parts.join(" · ") || "Nothing was imported.", result.imported ? "info" : "error");
  }, [say]);

  const runImport = useCallback(async (files: FileList, what: "media" | "document") => {
    setImporting(what === "document" ? "Reading the document…" : "Importing…");
    try {
      const result = await importToLibrary(files, getEffectivePlan(user), (status) => setImporting(status));
      loadMedia();
      reportImport(result, what);
    } catch (err) {
      say(err instanceof Error ? `Import failed: ${err.message}` : "Import failed.", "error");
    } finally {
      setImporting("");
    }
  }, [user, loadMedia, reportImport, say]);

  // Desktop app: pictures, videos and sound are referenced where they are (no copy), so even a
  // large video is in the library at once.
  const runPathImport = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting("Importing…");
    try {
      const result = await importPathsToLibrary(paths, getEffectivePlan(user), {
        onProgress: (status) => setImporting(status),
        onItemUpdated: replaceMediaItem,
      });
      loadMedia();
      reportImport(result, "media");
    } catch (err) {
      say(err instanceof Error ? `Import failed: ${err.message}` : "Import failed.", "error");
    } finally {
      setImporting("");
    }
  }, [user, loadMedia, replaceMediaItem, reportImport, say]);

  const openMediaPicker = useCallback(async () => {
    try {
      const paths = await pickMediaPaths({ extensions: [...REFERENCE_MEDIA_EXTENSIONS, ...COMMON_DOCUMENT_EXTENSIONS] });
      await runPathImport(paths);
    } catch (err) {
      say(err instanceof Error ? `Import failed: ${err.message}` : "Import failed.", "error");
    }
  }, [runPathImport, say]);

  const relinkMedia = useCallback(async (id: string) => {
    const item = media.find((candidate) => candidate.id === id);
    if (!item) return;
    try {
      const updated = await relinkReferenceItem(item);
      if (!updated) return;
      replaceMediaItem(updated);
      setMissingMediaIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      say(`“${updated.name}” found again.`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), "error");
    }
  }, [media, replaceMediaItem, say]);

  const copyMediaIntoLibrary = useCallback(async (id: string) => {
    const item = media.find((candidate) => candidate.id === id);
    if (!item) return;
    say(`Copying “${item.name}” into your library…`);
    try {
      const updated = await copyReferenceIntoLibrary(item);
      if (updated) replaceMediaItem(updated);
      say(`“${item.name}” is now kept in your library.`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), "error");
    }
  }, [media, replaceMediaItem, say]);

  // Files dropped on the window while the Media view is open go straight into the library.
  const runPathImportRef = useRef(runPathImport);
  runPathImportRef.current = runPathImport;
  useEffect(() => {
    if (view !== "media" || !isTauriRuntime()) return;
    let stop: (() => void) | null = null;
    let disposed = false;
    void listenForNativeFileDrops({
      onHover: setMediaDropActive,
      onDrop: (paths) => void runPathImportRef.current(paths),
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
      setMediaDropActive(false);
    };
  }, [view]);

  // Fit / Fill for a document page that is on the screen applies at once.
  const changeDocFit = useCallback((fit: "contain" | "cover") => {
    setDocFit(fit);
    if (liveSlide?.origin?.kind === "doc") changeMedia({ fit });
  }, [liveSlide, changeMedia]);
  const changeScreenScroll = useCallback((percent: number) => {
    const next = clamp(percent, 0, 100);
    setScreenScroll(next);
    void setProgramScroll(next);
  }, []);

  // A document page that fills the screen is taller than the screen: it can be scrolled (wheel, scrollbar, slider).
  const pageScrollable = docFit === "cover" && (previewSlide?.origin?.kind === "doc" || liveSlide?.origin?.kind === "doc");
  // A new page on the screen starts at its top.
  useEffect(() => {
    if (liveSlide?.origin?.kind === "doc") changeScreenScroll(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSlide?.key]);

  // ── Schedule / History ──
  const planContext = useMemo(() => ({ songs, notes, media, translation: bible.translation, loadChapter: loadChapterVerses }), [songs, notes, media, bible.translation]);

  const openTarget = useCallback((target: PlanTarget | null, fallback: StudioSection) => {
    chooseSection(target?.section ?? fallback, true);
    if (!target) return;
    if (target.section === "bible") {
      if (target.translation && bible.translations.includes(target.translation)) bible.setTranslation(target.translation);
      goToReference(target.book, target.chapter, target.verse, target.endVerse, "select");
    } else if (target.section === "worship") {
      setTextTab("worship");
      setSongId(target.songId);
      setSongIdx(target.index);
    } else if ("noteId" in target) {
      setTextTab("notes");
      chooseSection("worship", true);
      setDocsSel({ kind: "note", id: target.noteId });
      setDocIdx(target.index);
    } else {
      const doc = documents.find((d) => d.pages.some((p) => p.id === target.mediaId));
      if (doc) {
        setDocsSel({ kind: "doc", id: doc.id });
        setDocIdx(Math.max(0, doc.pages.findIndex((p) => p.id === target.mediaId)));
      } else {
        setMediaId(target.mediaId);
      }
    }
  }, [chooseSection, bible, goToReference, documents, setTextTab]);

  const openPlanItem = useCallback(async (item: ServicePlanItem) => {
    const resolved = await resolvePlanItem(item, planContext);
    if (!resolved.slide) {
      say(`Couldn't find “${item.label}” any more (it may have been deleted).`, "error");
      return;
    }
    openTarget(resolved.target, resolved.section);
    setPreviewSlide(resolved.slide);
  }, [planContext, openTarget, say]);

  const projectPlanItem = useCallback(async (item: ServicePlanItem) => {
    const resolved = await resolvePlanItem(item, planContext);
    if (!resolved.slide) {
      say(`Couldn't find “${item.label}” any more (it may have been deleted).`, "error");
      return;
    }
    openTarget(resolved.target, resolved.section);
    setPreviewSlide(resolved.slide);
    const plan = readActivePlan();
    const inSchedule = plan?.items.some((i) => i.id === item.id) ? item.id : null;
    await project(resolved.slide, { scheduleItemId: inSchedule });
  }, [planContext, openTarget, project, say]);

  // ── Screen Mix (Media → Overlays) ──
  const [mix, setMix] = useState<StudioMixLayer[]>(loadMix);
  const mixRef = useRef<StudioMixLayer[]>(mix);
  const mixTimers = useRef<Record<string, number>>({});
  useEffect(() => {
    mixRef.current = mix;
    void setProgramMix(mix);
    saveMix(mix);
  }, [mix]);
  useEffect(() => () => {
    Object.values(mixTimers.current).forEach((id) => window.clearTimeout(id));
  }, []);
  const toggleMixLayer = useCallback((id: string) => {
    const layer = mixRef.current.find((l) => l.id === id);
    if (!layer) return;
    const shown = !layer.shown;
    window.clearTimeout(mixTimers.current[id]);
    setMix((current) => current.map((l) => (l.id === id ? { ...l, shown } : l)));
    if (shown && layer.kind === "banner" && (layer.seconds ?? 0) > 0) {
      mixTimers.current[id] = window.setTimeout(() => {
        setMix((current) => current.map((l) => (l.id === id ? { ...l, shown: false } : l)));
      }, (layer.seconds ?? 0) * 1000);
    }
  }, []);

  // ── Broadcast graphics (the drawer's second tab): one graphic at a time, on top of everything ──
  const GRAPHIC_LAYER_ID = "mix-graphic-live";
  const [graphicLive, setGraphicLive] = useState<{ id: string; name: string } | null>(null);
  const [savedGraphicsCount, setSavedGraphicsCount] = useState(() => { try { return loadSavedBroadcastGraphics().length; } catch { return 0; } });
  useEffect(() => {
    const refresh = () => { try { setSavedGraphicsCount(loadSavedBroadcastGraphics().length); } catch { /* keep the count */ } };
    window.addEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, refresh);
  }, []);
  const closeGraphic = useCallback(() => {
    window.clearTimeout(mixTimers.current[GRAPHIC_LAYER_ID]);
    setGraphicLive(null);
    // The output plays the graphic's Out animation; once it has finished the layer is dropped.
    setMix((current) => current.map((l) => (l.id === GRAPHIC_LAYER_ID ? { ...l, shown: false } : l)));
    mixTimers.current[`${GRAPHIC_LAYER_ID}-drop`] = window.setTimeout(() => {
      setMix((current) => current.filter((l) => l.id !== GRAPHIC_LAYER_ID || l.shown));
    }, 3000);
  }, []);
  const projectGraphic = useCallback((g: ProjectedGraphic) => {
    window.clearTimeout(mixTimers.current[GRAPHIC_LAYER_ID]);
    window.clearTimeout(mixTimers.current[`${GRAPHIC_LAYER_ID}-drop`]);
    const layer: StudioMixLayer = {
      id: GRAPHIC_LAYER_ID,
      kind: "graphic",
      name: g.name,
      shown: true,
      graphicHtml: g.html,
      graphicSandbox: g.sandbox,
      graphicKey: `${g.id}-${Date.now()}`,
      graphicPos: g.position,
      graphicScale: g.scale,
    };
    setMix((current) => [...current.filter((l) => l.id !== GRAPHIC_LAYER_ID), layer]);
    setGraphicLive({ id: g.id, name: g.name });
    if (g.seconds > 0) mixTimers.current[GRAPHIC_LAYER_ID] = window.setTimeout(closeGraphic, g.seconds * 1000);
  }, [closeGraphic]);
  // ── Ministry tools (ticker, countdown, clock): layers on top, run from the Ministry section ──
  const putMinistryLayers = useCallback((layers: StudioMixLayer[]) => {
    const ids = new Set(layers.map((l) => l.id));
    ids.forEach((id) => window.clearTimeout(mixTimers.current[`${id}-drop`]));
    // Replace in place so the output keeps the running page; new ones go on top.
    setMix((current) => {
      const byId = new Map(layers.map((l) => [l.id, l]));
      const kept = current.map((l) => byId.get(l.id) ?? l);
      const added = layers.filter((l) => !current.some((c) => c.id === l.id));
      return [...kept, ...added];
    });
  }, []);
  const hideMinistryLayers = useCallback((ids: string[]) => {
    setMix((current) => current.map((l) => (ids.includes(l.id) ? { ...l, shown: false } : l)));
    ids.forEach((id) => {
      window.clearTimeout(mixTimers.current[`${id}-drop`]);
      mixTimers.current[`${id}-drop`] = window.setTimeout(() => {
        setMix((current) => current.filter((l) => l.id !== id || l.shown));
      }, 800);
    });
  }, []);
  const searchMix = useMemo(() => mix.filter((l) => l.kind !== "graphic" && l.kind !== "page"), [mix]);

  // ── Camera ──
  useEffect(() => {
    setLayout((current) => (current.camera.deviceId === camera.deviceId && current.camera.layout === camera.layout
      ? current
      : { ...current, camera: { deviceId: camera.deviceId, layout: camera.layout } }));
  }, [camera.deviceId, camera.layout]);
  const cameraHint = camera.enabled && camera.layout === "behind-content" && displayMode === "fullscreen" && liveSlide && liveSlide.module !== "media"
    ? "A full-screen theme can cover the camera. Use Lower Third to see the camera behind the words."
    : "";

  // Layers work like OBS sources: nothing turns on, off or moves by itself. Choosing something in
  // Preview does not touch the Words / Camera layers.

  // ── Full screen window ──
  const toggleImmersive = useCallback(async (force?: boolean) => {
    const next = force ?? !immersive;
    setImmersive(next);
    try {
      await getCurrentWindow().setFullscreen(next);
    } catch {
      /* browser preview */
    }
  }, [immersive]);

  useEffect(() => {
    document.documentElement.classList.add(PAGE_CLASS);
    return () => {
      document.documentElement.classList.remove(PAGE_CLASS);
      void getCurrentWindow().setFullscreen(false).catch(() => undefined);
    };
  }, []);

  // Back goes to the previous app page (falls back to Home when Studio was the first page).
  const goBack = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
      window.setTimeout(() => {
        if (window.location.hash.replace(/^#/, "").split("?")[0] === "/studio") navigate("/", { replace: true });
      }, 250);
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // ── Stepping through what is open (keys and the ‹ › buttons) ──
  const currentDeck: StudioSlide[] = view === "bible" ? bibleDeck : view === "worship" ? worshipDeck : view === "media" ? mediaDeck : view === "ministry" ? NO_SLIDES : docsDeck;

  /** Index in the open deck of a slide (a Bible passage counts as its first / last verse). */
  const deckIndexOf = useCallback((slide: StudioSlide | null, end: "first" | "last"): number => {
    if (!slide) return -1;
    if (view === "bible" && slide.module === "bible") {
      const o = slide.origin;
      if (!o || o.book !== bible.book || o.chapter !== bible.chapter) return -1;
      const verse = end === "last" ? (o.endVerse ?? o.verse ?? 0) : (o.verse ?? 0);
      return bibleDeck.findIndex((s) => s.verse === verse);
    }
    return currentDeck.findIndex((s) => s.key === slide.key);
  }, [view, bible.book, bible.chapter, bibleDeck, currentDeck]);

  /** Select slide `index` of the open deck (and preview it, or show it when `live`). */
  const selectIndex = useCallback((index: number, live: boolean) => {
    const deck = currentDeck;
    if (deck.length === 0) return;
    const i = clamp(index, 0, deck.length - 1);
    const slide = deck[i];
    if (view === "bible" && slide.verse) {
      // "Verses per slide": the arrow keys move by that many verses and show them together (as a click does).
      const per = bibleOptsRef.current.perSlide;
      const lastVerse = bible.verses.length ? bible.verses[bible.verses.length - 1].verse : slide.verse;
      const verses = range(slide.verse, Math.max(slide.verse, Math.min(slide.verse + per - 1, lastVerse))).filter((n) => bible.verses.some((v) => v.verse === n));
      setBibleSel({ key: chapterKey, anchor: slide.verse, verses });
      const group = verses.length > 1 ? rangeSlideFor(verses) ?? slide : slide;
      if (live) void project(group);
      else setPreviewSlide(group);
      return;
    }
    if (view === "worship") setSongIdx(i);
    else if (view === "media") setMediaId(slide.origin?.id ?? "");
    else setDocIdx(i);
    if (live) void project(slide);
    else setPreviewSlide(slide);
  }, [currentDeck, view, chapterKey, project, bible.verses, rangeSlideFor]);

  /** Arrow keys: move to the next/previous slide. Straight to screen, or already on air with this one: it goes on the screen too. */
  const stepSelection = useCallback((delta: 1 | -1) => {
    const from = deckIndexOf(selectedSlide, delta > 0 ? "last" : "first");
    const onAirNow = Boolean(selectedSlide && liveSlideRef.current && liveSlideRef.current.key === selectedSlide.key);
    // Going back in the Bible jumps a whole group (2 verses per slide = back by 2).
    const back = view === "bible" ? bibleOptsRef.current.perSlide : 1;
    selectIndex(from < 0 ? 0 : delta > 0 ? from + 1 : from - back, !previewFirst || onAirNow);
  }, [deckIndexOf, selectedSlide, selectIndex, previewFirst, view]);

  /** Space / Page Down: show Preview; if Preview is already live, show the next one. */
  const goLiveNext = useCallback(() => {
    const cam = cameraRef.current;
    const target = previewSlide ?? selectedSlide;
    // Camera off and words hidden: Go Live clears the screen.
    if (!layoutRef.current.wordsOn && !cam.enabled) {
      void pushCameraLive({ enabled: false, deviceId: cam.deviceId, layout: "hidden" }).then(() => handleClear());
      return;
    }
    // Preview shows only the camera (Words switched off): Go Live sends just the camera.
    if (cam.enabled && cam.layout === "camera-only") {
      const now = liveCameraRef.current;
      if (!now || !now.enabled || now.layout !== "camera-only" || now.deviceId !== cam.deviceId) {
        void pushCameraLive({ enabled: true, deviceId: cam.deviceId, layout: "camera-only" });
        return;
      }
    }
    if (!target) {
      // Nothing to show but the camera arrangement: send that.
      if (cam.enabled !== Boolean(liveCameraRef.current?.enabled)) void pushCameraLive({ enabled: cam.enabled, deviceId: cam.deviceId, layout: cam.layout });
      return;
    }
    // Preview first: the slide is already up, but Preview has a new camera arrangement or look.
    // Send to Screen puts that change up instead of moving on to the next slide.
    if (liveSlide && target.key === liveSlide.key) {
      const now = liveCameraRef.current;
      const camOn = cam.enabled && cam.layout !== "hidden";
      const cameraChanged = camOn !== Boolean(now?.enabled)
        || (camOn && (cam.layout !== now?.layout || cam.deviceId !== now?.deviceId))
        || Boolean(now?.wordsOff) !== !layoutRef.current.wordsOn;
      const lookChanged = target.module !== "media" && liveModeRef.current !== null && liveModeRef.current !== displayMode;
      if (lookChanged) {
        void project(target);
        return;
      }
      if (cameraChanged) {
        // A picture or video keeps playing: only the camera changes.
        void pushCameraLive({ enabled: camOn, deviceId: cam.deviceId, layout: camOn ? cam.layout : "hidden", wordsOff: !layoutRef.current.wordsOn });
        return;
      }
    }
    if (!liveSlide || target.key !== liveSlide.key) {
      void project(target).then((ok) => {
        if (!ok || !previewFirst) return;
        const at = deckIndexOf(target, "last");
        if (at >= 0 && at + 1 < currentDeck.length) selectIndex(at + 1, false);
      });
      return;
    }
    const at = deckIndexOf(liveSlide, "last");
    if (at >= 0 && at + 1 < currentDeck.length) selectIndex(at + 1, true);
  }, [previewSlide, selectedSlide, liveSlide, project, previewFirst, deckIndexOf, currentDeck, selectIndex, pushCameraLive, handleClear, displayMode]);

  const goLivePrev = useCallback(() => {
    const at = deckIndexOf(liveSlide ?? selectedSlide, "first");
    if (at > 0) selectIndex(at - (view === "bible" ? bibleOptsRef.current.perSlide : 1), true);
  }, [deckIndexOf, liveSlide, selectedSlide, selectIndex, view]);

  // ── Schedule: the next item ("N") ──
  const [plan, setPlan] = useState(readActivePlan);
  useEffect(() => {
    const refresh = () => setPlan(readActivePlan());
    window.addEventListener(DOCK_SCHEDULE_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(DOCK_SCHEDULE_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const scheduleItems = plan?.items ?? [];
  const scheduleLiveId = liveScheduleItemId && scheduleItems.some((i) => i.id === liveScheduleItemId) ? liveScheduleItemId : null;
  const nextItemId = nextScheduleItemId(scheduleItems, scheduleLiveId, new Set(plan?.completedItemIds ?? []));
  const nextItem = scheduleItems.find((i) => i.id === nextItemId) ?? null;
  const projectNextItem = useCallback(() => {
    if (nextItem) void projectPlanItem(nextItem);
  }, [nextItem, projectPlanItem]);

  // ── Search everything (type anywhere) ──
  const runGlobal = useCallback(async (r: GlobalResult, how: GlobalRunMode) => {
    // Enter follows the mode: Preview first -> Preview, Straight to screen -> the screen. Cmd/Ctrl+Enter is the other way.
    const toScreen = how === "schedule" ? false : how === "follow" ? !previewFirst : previewFirst;
    const show = (slide: StudioSlide | null) => {
      if (!slide) return;
      if (how === "schedule") schedule(slide);
      else if (toScreen && slide.media?.kind !== "audio") void project(slide);
      else setPreviewSlide(slide);
    };
    switch (r.kind) {
      case "command":
        r.run();
        return;
      case "graphic":
        toggleMixLayer(r.layerId);
        return;
      case "bible": {
        chooseSection("bible");
        if (r.translation && r.translation !== bible.translation && bible.translations.includes(r.translation)) bible.setTranslation(r.translation);
        if (!r.book || !r.chapter) return;
        if (how === "schedule") {
          schedule(await slideForReference({ book: r.book, chapter: r.chapter, verse: r.verse ?? 1, endVerse: r.endVerse }));
          return;
        }
        goToReference(r.book, r.chapter, r.verse, r.endVerse, toScreen ? "project" : "preview");
        return;
      }
      case "song": {
        const found = songs.find((x) => x.id === r.songId);
        if (!found) return;
        chooseSection("worship");
        setTextTab("worship");
        setSongId(found.id);
        setSongIdx(r.index);
        // Picking a song only takes you there; it is never previewed or projected (Shift+Enter still schedules it).
        if (how === "schedule") show(songSlides(found)[r.index] ?? null);
        return;
      }
      case "note": {
        const note = notes.find((x) => x.id === r.noteId);
        if (!note) return;
        chooseSection("worship");
        setTextTab("notes");
        setDocsSel({ kind: "note", id: note.id });
        setDocIdx(r.index);
        if (how === "schedule") show(noteSlides(note.id, note.title || "Note", note.content, noteLinesOf(note))[r.index] ?? null);
        return;
      }
      case "media":
        chooseSection("media");
        setMediaId(r.mediaId);
        show(mediaDeck.find((x) => x.origin?.id === r.mediaId) ?? null);
        return;
      case "doc": {
        const doc = documents.find((d) => d.pages.some((p) => p.id === r.mediaId));
        chooseSection("docs");
        if (!doc) return;
        const at = Math.max(0, doc.pages.findIndex((p) => p.id === r.mediaId));
        setDocsSel({ kind: "doc", id: doc.id });
        setDocIdx(at);
        show(mediaSlide(doc.pages[at], docFit));
        return;
      }
    }
  }, [previewFirst, schedule, project, toggleMixLayer, chooseSection, bible, slideForReference, goToReference, songs, notes, mediaDeck, documents, docFit, setTextTab]);

  const globalCommands = useMemo<GlobalCommand[]>(() => [
    { id: "auto", title: autoMode ? "Turn Auto mode off" : "Turn Auto mode on", hint: "Detected Bible references go on the screen by themselves", keywords: "auto mode automatic verse ai detect", run: () => setAutoMode(!autoMode) },
    { id: "listen", title: ai.listening ? "Stop listening" : "Start listening", hint: "Verse AI", keywords: "verse ai microphone listen sermon speech", run: () => { if (ai.listening) ai.stop(); else void ai.start(); } },
    { id: "clear", title: "Clear the screen", hint: "Take everything off", keywords: "clear remove take off empty", run: () => void handleClear() },
    { id: "black", title: screen === "black" ? "Lift the black screen" : "Black screen", hint: "Alt+B", keywords: "black blank dark", run: () => toggleScreen("black") },
    { id: "logo", title: screen === "logo" ? "Hide the logo" : "Show the logo", keywords: "logo church", run: () => toggleScreen("logo") },
    { id: "prevfirst", title: "Preview first", hint: previewFirst ? "On now" : "Things wait in Preview until Send to Screen", keywords: "preview first wait", run: () => patchLayout({ previewFirst: true }) },
    { id: "straight", title: "Straight to screen", hint: !previewFirst ? "On now" : "Clicks and search go on the screen at once", keywords: "straight to screen live direct", run: () => patchLayout({ previewFirst: false }) },
    { id: "scene-fullscreen", title: "Full screen (words, no camera)", hint: "Alt+1", keywords: "full screen fullscreen words bible song notes", run: () => void chooseScene("fullscreen") },
    { id: "scene-lowerthird", title: "Lower third (words, no camera)", hint: "Alt+2", keywords: "lower third bar words", run: () => void chooseScene("lower-third") },
    { id: "scene-camera", title: "Camera only", hint: "Alt+3", keywords: "camera video webcam", run: () => void chooseScene("camera") },
    { id: "scene-camera-lt", title: "Camera + lower third", hint: "Alt+4", keywords: "camera lower third words video", run: () => void chooseScene("camera-lt") },
    { id: "next", title: "Next in schedule", hint: "Alt+N", keywords: "next schedule item", run: () => projectNextItem() },
    { id: "sec-bible", title: "Go to Bible", keywords: "open bible section", run: () => chooseSection("bible") },
    { id: "sec-text", title: "Go to Text (songs and notes)", keywords: "open text songs lyrics worship section", run: () => chooseSection("worship") },
    { id: "sec-media", title: "Go to Media", keywords: "open media pictures videos section", run: () => chooseSection("media") },
    { id: "sec-docs", title: "Go to Docs", keywords: "open docs documents section", run: () => chooseSection("docs") },
    { id: "sec-ministry", title: "Go to Ministry (ticker, countdown, clock)", keywords: "open ministry ticker announcements countdown timer clock time section", run: () => chooseSection("ministry") },
    { id: "graphics", title: "Open Broadcast graphics", hint: "The Graphics tab in the side panel", keywords: "broadcast graphics lower third banner templates drawer", run: () => openGraphics() },
    ...(graphicLive ? [{ id: "graphic-close", title: `Close the graphic (${graphicLive.name})`, keywords: "close graphic out animation hide", run: () => closeGraphic() }] : []),
    { id: "shortcuts", title: "Keyboard shortcuts", hint: "See and change the keys", keywords: "keyboard shortcuts keys hotkeys", run: () => { setSettingsTab("shortcuts"); setSettingsPanel(true); } },
    { id: "import-songs", title: "Import songs from a document", hint: "PDF, Word, PowerPoint, text and more", keywords: "import songs document pdf word docx powerpoint pptx odt rtf txt lyrics hymn file", run: () => { chooseSection("worship"); setTextTab("worship"); setSongImport(true); } },
    { id: "settings", title: "Open Settings and Output", keywords: "settings output options preferences projector monitor", run: () => setSettingsPanel(true) },
  ], [autoMode, setAutoMode, ai, handleClear, screen, toggleScreen, previewFirst, patchLayout, chooseScene, projectNextItem, chooseSection, layout.drawer, graphicLive, closeGraphic, setTextTab]);


  // ── Projectors ──
  const openProjectorOn = useCallback(async (feed: ProjectorFeed, target: string) => {
    if (feed === "alt" && !canUseAlternateOutput) {
      setMenu(null);
      setOutputPop(null);
      promptAlternateOutputUpgrade();
      return;
    }
    setBusy(true);
    setMenu(null);
    try {
      if (feed === "program" && target !== "window") {
        setMonitorKey(target);
        saveOutputMonitor(target);
      }
      // A screen holds one projector: putting another one there replaces the Output, so that is not a surprise close.
      if (feed !== "program" && target !== "window" && listOpenProjectors().some((p) => p.feed === "program" && p.monitorKey === target)) {
        closingOutputRef.current = true;
      }
      const opened = await openProjector(feed, target);
      const what = feed === "program" ? "Output" : feed === "alt" ? "Alternate output" : "Preview";
      if (opened.reused) say(`${what} is already open${opened.monitorKey ? ` on ${opened.where}` : " in a window"}.`);
      else say(opened.monitorKey ? `${what} is on ${opened.where}. Press Esc on it to close it.` : `${what} opened in a window.`);
    } catch (error) {
      say(error instanceof Error ? error.message : "Couldn't open the output.", "error");
    } finally {
      setBusy(false);
    }
  }, [canUseAlternateOutput, promptAlternateOutputUpgrade, say]);

  const handleCloseOutput = useCallback(async (feed: ProjectorFeed = "program") => {
    setMenu(null);
    if (feed === "program") closingOutputRef.current = true;
    await closeAllProjectors(feed);
  }, []);

  useEffect(() => {
    if (!canUseAlternateOutput && altOpen) void handleCloseOutput("alt");
  }, [canUseAlternateOutput, altOpen, handleCloseOutput]);

  // One click: send the Output to the projector/TV. With a second screen it goes there; with only this screen it opens a window.
  const startOutput = useCallback(async () => {
    const saved = monitors.find((m) => m.key === monitorKey && !m.isControlScreen);
    const other = saved ?? monitors.find((m) => !m.isControlScreen);
    await openProjectorOn("program", other ? other.key : "window");
  }, [monitors, monitorKey, openProjectorOn]);

  // ── Send Preview to Screen (the Send to Screen button, Enter) ──
  const goLiveNow = () => {
    if (slideshow.show) {
      // Sending the current Preview item also moves the running slideshow onto Program.
      slideshowIsLiveRef.current = true;
      slideshow.goTo(slideshow.show.pos);
      return;
    }
    const cam = cameraRef.current;
    const target = previewSlide ?? selectedSlide;
    if (!layoutRef.current.wordsOn && !cam.enabled) {
      // Camera off and words hidden: nothing should be on the screen.
      void pushCameraLive({ enabled: false, deviceId: cam.deviceId, layout: "hidden" }).then(() => handleClear());
    } else if (cam.enabled && cam.layout === "camera-only") {
      void pushCameraLive({ enabled: true, deviceId: cam.deviceId, layout: "camera-only" }).then((ok) => {
        if (ok) say("The camera is on the screen.");
      });
    } else if (target) {
      void project(target);
    } else {
      void pushCameraLive({ enabled: cam.enabled, deviceId: cam.deviceId, layout: cam.layout });
    }
  };

  // ── Keyboard shortcuts (the keys are in studio/shortcuts.ts and can be changed in Settings) ──
  const runShortcut = (id: ShortcutId) => {
    switch (id) {
      case "section-bible": chooseSection("bible"); break;
      case "section-text": chooseSection("worship"); break;
      case "section-media": chooseSection("media"); break;
      case "section-docs": chooseSection("docs"); break;
      case "section-ministry": chooseSection("ministry"); break;
      case "text-songs": chooseSection("worship"); setTextTab("worship"); break;
      case "text-notes": chooseSection("worship"); setTextTab("notes"); break;
      case "search": setSearchAll(""); break;
      case "toggle-schedule": setLayout((c) => ({ ...c, dock: { ...c.dock, open: !c.dock.open } })); break;
      case "graphics": openGraphics(); break;
      case "themes":
        if (lookModule) setThemeModal(true);
        else say("Open the Bible or Text first, then choose a theme.");
        break;
      case "edit-theme": if (lookModule && currentTheme) void startEditTheme(currentTheme); break;
      case "new-song": chooseSection("worship"); setTextTab("worship"); setSongEdit("new"); break;
      case "send-screen": goLiveNow(); break;
      case "go-live-next": goLiveNext(); break;
      case "go-live-prev": goLivePrev(); break;
      case "select-next": stepSelection(1); break;
      case "select-prev": stepSelection(-1); break;
      case "clear-screen": void handleClear(); break;
      case "black-screen": toggleScreen("black"); break;
      case "logo-screen": toggleScreen("logo"); break;
      case "next-schedule": projectNextItem(); break;
      case "add-schedule": {
        const target = previewSlide ?? selectedSlide;
        if (target) schedule(target);
        break;
      }
      case "close-graphic": if (graphicLive) closeGraphic(); break;
      case "preview-first": patchLayout({ previewFirst: !previewFirst }); break;
      case "look-fullscreen": void chooseScene("fullscreen"); break;
      case "look-lowerthird": void chooseScene("lower-third"); break;
      case "scene-camera": void chooseScene("camera"); break;
      case "scene-camera-lt": void chooseScene("camera-lt"); break;
      case "queue-project":
        if (ai.queue[0]) void projectCandidate(ai.queue[0]);
        else say("The Queue is empty.");
        break;
      case "monitor-toggle": setPreviewTab((t) => (altOpen && t === "preview" ? "alternate" : "preview")); break;
      case "panel-verseai": patchLayout({ verseAiCollapsed: false }); break;
      case "vai-tab":
        if (layout.verseAiCollapsed) patchLayout({ verseAiCollapsed: false });
        window.dispatchEvent(new Event(VAI_NEXT_TAB_EVENT));
        break;
      case "fold-panel": patchLayout({ verseAiCollapsed: !layout.verseAiCollapsed }); break;
      case "transition": patchLayout({ transition: transition === "fade" ? "cut" : "fade" }); break;
      case "auto": setAutoMode(!autoMode); break;
      case "listen": if (ai.listening) ai.stop(); else void ai.start(); break;
      case "text-bigger": patchLayout({ textScale: clamp(textScale + 5, 70, 160) }); break;
      case "text-smaller": patchLayout({ textScale: clamp(textScale - 5, 70, 160) }); break;
      case "text-reset": patchLayout({ textScale: 100 }); break;
      case "output-open": void startOutput(); break;
      case "output-stop": if (outputOpen) void handleCloseOutput("program"); break;
      case "settings": setSettingsTab("general"); setSettingsPanel(true); break;
      case "shortcuts": setSettingsTab("shortcuts"); setSettingsPanel(true); break;
      case "fullscreen": void toggleImmersive(); break;
      case "back": goBack(); break;
    }
  };
  const runShortcutRef = useRef(runShortcut);
  runShortcutRef.current = runShortcut;

  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu) {
        setMenu(null);
        return;
      }
      const combo = eventToCombo(event, mac);
      const id = combo ? matchShortcut(combo, shortcutBindings) : null;
      const def = id ? shortcutDef(id) : undefined;
      // Full screen works everywhere, even over a dialog.
      if (id === "fullscreen") {
        event.preventDefault();
        runShortcutRef.current(id);
        return;
      }
      if (settingsPanel || themeModal || themeEdit || songEdit || songImport) return;
      if (searchAllRef.current !== null) return; // the search box handles its own keys
      const typing = isTyping(event.target);
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (id && def) {
        if (typing && !def.whileTyping) return;
        if (plain && document.querySelector(".studio-menu-backdrop")) return;
        // Enter on a button, a slide card or a list row belongs to that control.
        if (combo === "Enter" && (event.target as HTMLElement | null)?.closest?.("a, button, summary, select, [role=button], [role=option], [role=tab], [role=menuitem]")) return;
        if (event.repeat && !def.repeat) return;
        event.preventDefault();
        runShortcutRef.current(id);
        return;
      }
      // Anything else typed (a letter, a number, a symbol) starts the search.
      if (typing || !plain || event.key === " " || event.key.length !== 1 || event.repeat) return;
      if (document.querySelector(".studio-menu-backdrop")) return;
      event.preventDefault();
      setSearchAll(event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, themeModal, themeEdit, songEdit, songImport, settingsPanel, shortcutBindings]);

  // When the Output menu opens, the drop-down starts on the screen the output is on (or the saved / second screen).
  useEffect(() => {
    if (!outputPop) return;
    const current = projectorList.find((p) => p.feed === "program");
    const saved = monitors.find((m) => m.key === monitorKey);
    const other = monitors.find((m) => !m.isControlScreen);
    setOutPick(current ? (current.monitorKey || "window") : (saved?.key ?? other?.key ?? monitors[0]?.key ?? "window"));
    // The alternate output starts on its own screen: where it is, the saved one, or a free screen.
    const alt = projectorList.find((p) => p.feed === "alt");
    const taken = current?.monitorKey ?? saved?.key ?? other?.key;
    const savedAlt = monitors.find((m) => m.key === readSavedAltMonitor() && m.key !== taken);
    const freeAlt = monitors.find((m) => !m.isControlScreen && m.key !== taken);
    setAltPick(alt ? (alt.monitorKey || "window") : (savedAlt?.key ?? freeAlt?.key ?? "window"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(outputPop)]);

  useEffect(() => {
    if (!outputPop) setOutputHelp(null);
  }, [outputPop]);

  const outputMenuOpen = Boolean(outputPop);
  useEffect(() => {
    if (!outputMenuOpen) return;
    const trigger = document.activeElement;
    outputMenuRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [outputMenuOpen]);

  // The Output menu shows whether the camera is reaching the screen (refreshed while it is open).
  const [, setRelayTick] = useState(0);
  useEffect(() => {
    if (!outputPop) return undefined;
    const t = window.setInterval(() => setRelayTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [outputPop]);

  const loadWifiLink = useCallback(async () => {
    try {
      const info = await invoke<{ baseUrl?: string }>("get_lan_overlay_info", { targetHost: null });
      const lanBase = String(info?.baseUrl || "").replace(/\/+$/, "");
      setWifiLink(lanBase ? `${lanBase}/studio-output.html` : "");
    } catch {
      setWifiLink("");
    }
  }, []);

  useEffect(() => {
    if (settingsPanel) void loadWifiLink();
  }, [settingsPanel, loadWifiLink]);

  const copyWifiLink = useCallback(async () => {
    if (!wifiLink) return;
    await navigator.clipboard.writeText(wifiLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [wifiLink]);

  const openMonitorMenu = useCallback((feed: ProjectorFeed, event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    void refreshMonitors();
    setMenu({
      feed,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 520)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
    });
  }, [refreshMonitors]);

  // ── Layout: fit the columns to the window ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState({ width: 1400, height: 700 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const update = () => setBodySize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showVerseAi = true;
  const dockOpen = layout.dock.open;
  const columns = planColumns(bodySize.width, {
    verseAi: showVerseAi ? (layout.verseAiCollapsed ? VERSE_AI_RAIL : layout.verseAiWidth) : null,
    dock: dockOpen ? layout.dock.width : null,
    preview: layout.previewWidth,
  });
  /** Half-width window or smaller: Bible, Worship, Notes, Media and Docs are ONE row of named tabs at the left, under the header. */
  const sectionsInBody = columns.compact || columns.stacked || bodySize.width <= 1300;
  // Keep at least ~300px (or 55% of the height) for the reader and Preview above the drawer.
  const drawerMax = Math.max(110, Math.min(LAYOUT_LIMITS.drawer.max, bodySize.height - 300, Math.round(bodySize.height * (bodySize.height < 640 ? 0.24 : 0.45))));
  // The full side panel (right) has Queue, History and Graphics, so the bottom drawer and the
  // Schedule's History tab are only used while the panel is folded to the slim rail.
  const leftFull = !(layout.verseAiCollapsed || columns.verseAiRail);
  const drawerTabView: "verseai" | "graphics" | "mine" = layout.drawer.tab === "graphics" ? "graphics" : layout.drawer.tab === "mine" ? "mine" : "verseai";
  // Side panel open: Verse AI is there, so the drawer holds only the graphics. Folded to the rail: both.
  const drawerView: "verseai" | "graphics" | "mine" = leftFull ? (drawerTabView === "mine" ? "mine" : "graphics") : drawerTabView;
  const drawerHasContent = drawerView !== "verseai" || ai.listening || ai.queue.length > 0 || ai.suggestions.length > 0;
  const drawerOpen = layout.drawer.open && drawerHasContent;
  const drawerHeight = drawerOpen ? clamp(layout.drawer.height, 100, drawerMax) : DRAWER_COLLAPSED;
  const openDrawer = (tab: "queue" | "suggestions") => setLayout((c) => ({ ...c, drawer: { ...c.drawer, tab, open: true } }));
  const recentKeys = new Set(ai.detected.filter((c) => (c.detectedAt ?? 0) > Date.now() - 90_000).map((c) => candidateKey(c)));

  const dragStart = useRef(0);

  const liveVideo = liveSlide?.media?.kind === "video" ? liveSlide : null;
  const liveMediaId = liveVideo?.origin?.id;
  const activeSlideshow = slideshow.show;
  const slideshowOwnsLiveVideo = Boolean(
    activeSlideshow?.kind === "video"
    && slideshowIsLiveRef.current
    && liveMediaId
    && activeSlideshow.ids.includes(liveMediaId),
  );

  // Room the Preview panel needs besides the screen itself (so the screen shrinks, not the buttons).
  const shortScreen = typeof window !== "undefined" && window.innerHeight <= 820;
  const previewReserve = (shortScreen ? 350 : 380)
    + (lookModule ? 40 : 0)
    + (nextItem && !dockOpen ? 42 : 0)
    + (liveVideo ? 84 : 0)
    + (audioSlide ? 84 : 0);

  // ── Labels ──
  const previewUrl = base ? previewMonitorUrl(base) : "";
  const alternateUrl = base ? alternateFrameUrl(base) : "";
  const outputMonitorName = projectorList.find((p) => p.feed === "program")?.where ?? "";
  const liveKey = liveSlide?.key ?? "";
  const versesOf = (slide: StudioSlide | null): number[] => {
    const o = slide?.origin;
    if (!slide || slide.module !== "bible" || !o || o.book !== bible.book || o.chapter !== bible.chapter || !o.verse) return [];
    return range(o.verse, o.endVerse ?? o.verse);
  };

  const lookThemes = lookModule ? themesApi.forMode(displayMode) : [];
  const currentTheme = lookModule ? themesApi.current(lookModule, displayMode) : null;
  const liveMediaItem = liveSlide?.module === "media" && liveSlide.origin?.id ? media.find((m) => m.id === liveSlide.origin?.id) : undefined;
  const audioItem = audioSlide?.origin?.id ? media.find((m) => m.id === audioSlide.origin?.id) : undefined;

  // ── Workspaces ──
  let workspace: ReactNode = null;
  if (view === "bible") {
    workspace = (
      <BibleWorkspace
        compact={dockOpen}
        bible={bible}
        selected={selectedVerses}
        previewVerses={versesOf(previewSlide)}
        liveVerses={versesOf(liveSlide)}
        onGoTo={(book, chapter, verse, endVerse) => goToReference(book, chapter, verse, endVerse, "preview")}
        onGoToScreen={(book, chapter, verse, endVerse) => goToReference(book, chapter, verse, endVerse, "project")}
        onPick={pickVerse}
        onProject={projectVerses}
        onQueue={(verses) => {
          const c = candidateFromVerses(verses);
          if (c) {
            ai.addToQueue(c);
            say(`${c.label} added to the Queue.`);
          }
        }}
        onSchedule={(verses) => schedule(rangeSlideFor(verses))}
        onStep={(delta) => {
          setPending(null);
          void bible.step(delta);
        }}
        live={liveSlide?.module === "bible" && liveSlide.origin?.book && liveSlide.origin.chapter && liveSlide.origin.verse
          ? { label: liveSlide.reference || liveSlide.itemTitle, book: liveSlide.origin.book, chapter: liveSlide.origin.chapter, verse: liveSlide.origin.verse }
          : null}
        compareWith={bibleOpts.compareWith}
        onCompareWith={(translation) => patchBibleOpts(translation ? { compareWith: translation, passagesOn: false } : { compareWith: "" })}
        passagesOn={bibleOpts.passagesOn}
        passages={bibleOpts.passages}
        onPassagesOn={(on) => patchBibleOpts(on ? { passagesOn: true, compareWith: "" } : { passagesOn: false })}
        onPassagesSave={savePassages}
        compareLayout={bibleOpts.compareLayout}
        onCompareLayout={(value) => patchBibleOpts({ compareLayout: value })}
        compareVerses={compareData?.verses ?? []}
        compareStatus={compareStatus}
        versesPerSlide={bibleOpts.perSlide}
        onVersesPerSlide={(count) => patchBibleOpts({ perSlide: count })}
        onShowLive={() => {
          const o = liveSlide?.origin;
          if (o?.book && o.chapter && o.verse) goToReference(o.book, o.chapter, o.verse, o.endVerse, "select");
        }}
      />
    );
  } else if (view === "worship") {
    workspace = (
      <WorshipWorkspace
        songs={songs}
        songId={songId}
        onSong={(id) => {
          // Opening a song only opens it. Preview and Program change when a slide is clicked.
          setSongId(id);
          setSongIdx(0);
        }}
        onSendSong={(id) => {
          const found = songs.find((x) => x.id === id);
          if (!found) return;
          const deck = songSlides(found);
          setSongId(id);
          setSongIdx(0);
          void project(deck[0] ?? null);
        }}
        slides={worshipDeck}
        selectedKey={worshipDeck[songIdx]?.key ?? ""}
        liveKey={liveKey}
        onPick={(i) => pickIndex(worshipDeck, i, setSongIdx)}
        onProject={(i) => { setSongIdx(i); void project(worshipDeck[i] ?? null); }}
        onScheduleSection={(i) => schedule(worshipDeck[i] ?? null)}
        onScheduleSong={() => schedule(worshipDeck[0] ?? null, { whole: "song" })}
        onNewSong={() => setSongEdit("new")}
        onImportSongs={() => setSongImport(true)}
        onEditSong={() => setSongEdit(song ? "edit" : "new")}
        tools={(
          <TextSlideTools
            lines={songLinesNow}
            onLines={changeSongLines}
            sections={translationSections(worshipBase)}
            translation={worshipTranslation}
            onTranslation={(value) => setTranslationFor(`song:${songId}`, value)}
          />
        )}
      />
    );
  } else if (view === "media") {
    workspace = (
      <MediaWorkspace
        media={media}
        base={base}
        selectedId={mediaId}
        liveId={liveSlide?.origin?.kind === "media" ? liveSlide.origin.id ?? "" : audioSlide?.origin?.id ?? ""}
        previewFirst={previewFirst}
        onPick={pickMedia}
        onProject={projectMedia}
        onSchedule={(id) => schedule(mediaDeck.find((s) => s.origin?.id === id) ?? null)}
        onImport={(files) => void runImport(files, "media")}
        onImportClick={isTauriRuntime() ? () => void openMediaPicker() : undefined}
        dropActive={mediaDropActive}
        missingIds={missingMediaIds}
        onRelink={(id) => void relinkMedia(id)}
        onMakeCopy={(id) => void copyMediaIntoLibrary(id)}
        onDelete={async (ids) => {
          try {
            for (const id of ids) {
              await deleteMedia(id);
              if (id === mediaId) setMediaId("");
            }
          } finally {
            loadMedia();
          }
        }}
        importing={importing}
        onSlideshow={startSlideshow}
        resumeIndexFor={slideshow.resumeIndexFor}
        slideshowIds={slideshow.show?.ids}
        overlays={(
          <MixPanel
            layers={mix}
            media={libraryMedia}
            logoUrl={logoSrc}
            onChange={setMix}
            onToggle={toggleMixLayer}
            lowerThird={displayMode === "lower-third"}
            onLowerThird={(on) => patchLayout({ displayMode: on ? "lower-third" : "fullscreen" })}
          />
        )}
      />
    );
  } else if (view === "ministry") {
    workspace = (
      <MinistryWorkspace
        mix={mix}
        onPut={putMinistryLayers}
        onHide={hideMinistryLayers}
        canTicker={canUseTicker}
        canTime={canUseTime}
        onUpgrade={promptAlternateOutputUpgrade}
      />
    );
  } else {
    workspace = (
      <DocsWorkspace
        mode={view === "notes" ? "notes" : "documents"}
        documents={documents}
        notes={notes}
        selection={docsSel}
        onSelect={(sel) => {
          setDocsSel(sel);
          setDocIdx(0);
        }}
        slides={docsDeck}
        selectedKey={docsDeck[docIdx]?.key ?? ""}
        liveKey={liveKey}
        base={base}
        onPick={(i) => pickIndex(docsDeck, i, setDocIdx)}
        onProject={(i) => { setDocIdx(i); void project(docsDeck[i] ?? null); }}
        onSchedule={(i) => schedule(docsDeck[i] ?? null)}
        onScheduleWhole={() => schedule(docsDeck[0] ?? null, docsSel?.kind === "note" ? { whole: "note" } : undefined)}
        fit={docFit}
        onFit={changeDocFit}
        scroll={screenScroll}
        onScroll={changeScreenScroll}
        onImport={(files) => void runImport(files, "document")}
        importing={importing}
        onSaveNote={saveNoteEdit}
        tools={openNote ? (
          <TextSlideTools
            lines={noteLinesNow}
            onLines={changeNoteLines}
            sections={translationSections(noteBase)}
            translation={noteTranslation}
            onTranslation={(value) => setTranslationFor(`note:${openNote.id}`, value)}
          />
        ) : undefined}
      />
    );
  }

  // Text has two tabs: Worship (songs) and Notes.
  if (section === "worship") {
    workspace = (
      <div className="st-textwrap">
        {!sectionsInBody && <div className="st-subtabs" role="tablist" aria-label="Text">
          <button type="button" role="tab" aria-selected={textTab === "worship"} className={textTab === "worship" ? "is-on" : ""} onClick={() => setTextTab("worship")}><Music size={14} /> Worship</button>
          <button type="button" role="tab" aria-selected={textTab === "notes"} className={textTab === "notes" ? "is-on" : ""} onClick={() => setTextTab("notes")}><FileText size={14} /> Notes</button>
        </div>}
        <div className="st-textwrap__body">{workspace}</div>
      </div>
    );
  }

  const playbar = slideshow.show || liveVideo || audioSlide ? (
    <div className="st-playbars">
      {slideshow.show && (
        <SlideshowControls
          show={slideshow.show}
          items={mediaById}
          base={base}
          itemMs={slideshow.itemMs}
          timeLeft={slideshow.timeLeft}
          progressKey={slideshow.progressKey}
          onPlay={slideshow.play}
          onPause={slideshow.pause}
          onNext={slideshow.next}
          onPrev={slideshow.prev}
          onRestart={slideshow.restart}
          onGoTo={slideshow.goTo}
          onInterval={slideshow.setIntervalSec}
          onLoop={slideshow.setLoop}
          onShuffle={slideshow.setShuffle}
          onStop={slideshow.stop}
          videoControls={slideshowOwnsLiveVideo && liveVideo ? (
            <MediaControls slide={liveVideo} durationSec={liveMediaItem?.durationSec} control={mediaCtl} onChange={changeMedia} compact />
          ) : undefined}
        />
      )}
      {liveVideo && !slideshowOwnsLiveVideo && (
        <MediaControls slide={liveVideo} durationSec={liveMediaItem?.durationSec} control={mediaCtl} onChange={changeMedia} />
      )}
      {audioSlide && (
        <MediaControls slide={audioSlide} durationSec={audioItem?.durationSec} control={audioCtl} onChange={changeAudio} onStopSound={stopAudio} />
      )}
    </div>
  ) : null;


  return (
    <div className={`studio st${immersive ? " studio--immersive" : ""}`}>
      <header className={`st-head${sectionsInBody ? " is-small" : ""}`}>
        <div className="st-head__left">
          <button type="button" className="st-back" onClick={goBack} title="Back to the app" aria-label="Back to the app">
            <ArrowLeft size={16} />
          </button>
          <div className="st-brand" title="MakeChurchEazy">
            <span className="st-brand__logo" aria-label="MakeChurchEazy">M</span>
          </div>
        </div>

        {!sectionsInBody && (
          <nav className="st-nav" role="tablist" aria-label="Studio sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={section === id} className={`st-nav__btn${section === id ? " is-on" : ""}`} title={label} aria-label={label} onClick={() => chooseSection(id)}>
                <Icon size={18} /> <span>{label}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="st-head__right">
          <div className="st-outsplit">
            <button
              type="button"
              className={`st-headbtn st-headbtn--output st-outsplit__main${outputOpen ? " is-out" : ""}`}
              disabled={busy}
              onClick={(e) => {
                if (!outputOpen) { markOutputHintSeen(); void startOutput(); return; }
                const r = e.currentTarget.getBoundingClientRect();
                setOutputPop((cur) => (cur ? null : { x: Math.max(8, Math.min(window.innerWidth - 348, r.right - 340)), y: r.bottom + 6 }));
              }}
              title={outputOpen ? `Output is on ${outputMonitorName || "a screen"}${altProjector ? `, alternate output on ${altProjector.where}` : ""}. Click for options.` : monitors.some((m) => !m.isControlScreen) ? "Send the Studio to the projector or TV" : "Open the output in a window you can drag to a projector"}
            >
              <Monitor size={15} /> <span className="st-headbtn__label">{outputOpen ? (altOpen ? "Outputs on" : "Output on") : "Start output"}</span>
            </button>
            <button
              type="button"
              className={`st-headbtn st-headbtn--output st-outsplit__more${outputOpen ? " is-out" : ""}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setOutputPop((cur) => (cur ? null : { x: Math.max(8, Math.min(window.innerWidth - 348, r.right - 340)), y: r.bottom + 6 }));
              }}
              aria-haspopup="menu"
              aria-expanded={Boolean(outputPop)}
              aria-label="Choose the screen for the output"
              title="Choose the screen"
            >
              <ChevronDown size={14} />
            </button>
            {!outputHintSeen && !outputOpen && (
              <div className="st-outhint" role="note">
                <span className="st-outhint__arrow" aria-hidden="true" />
                <span className="st-outhint__text"><strong>Click to project</strong> Show the Studio on your projector or TV</span>
                <button type="button" className="st-outhint__close" onClick={markOutputHintSeen} aria-label="Got it"><X size={13} /></button>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`st-headbtn${dockOpen ? " is-on" : ""}`}
            onClick={() => setLayout((c) => ({ ...c, dock: { ...c.dock, open: !c.dock.open } }))}
            aria-pressed={dockOpen}
            title="Schedule and History"
          >
            <CalendarClock size={15} /> <span className="st-headbtn__label">Schedule</span>
          </button>
          <button type="button" className={`st-headbtn st-headbtn--icon st-headbtn--gear${outputOpen ? " has-output" : ""}`} onClick={() => setSettingsPanel(true)} title={outputOpen ? `Settings and Output (on ${outputMonitorName || "a screen"})` : "Settings and Output"} aria-label="Settings and Output">
            <SettingsIcon size={16} />
          </button>
          <button type="button" className="st-headbtn st-headbtn--icon" onClick={() => void toggleImmersive()} title={immersive ? "Exit full screen (F11)" : "Full screen (F11)"} aria-label="Full screen">
            {immersive ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>

      {message && (
        <div className={`studio-message st-message${message.tone === "error" ? " is-error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
          <button type="button" className="studio-message__close" onClick={() => setMessage(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      {foundCard && (layout.verseAiCollapsed || columns.verseAiRail) && (
        <div className="st-found" role="status">
          <div className="st-found__txt">
            <strong>Verse found: {foundCard.label}</strong>
            {foundCard.snippet ? <span>{foundCard.snippet}</span> : null}
          </div>
          <div className="st-found__btns">
            <button type="button" className="st-found__go" onClick={() => { const c = foundCard; setFoundCard(null); void projectCandidate(c); }}>Project</button>
            <button type="button" onClick={() => { const c = foundCard; setFoundCard(null); void slideForReference(c).then((sl) => { if (sl) setPreviewSlide(sl); }); }}>Preview</button>
            <button type="button" className="st-found__x" onClick={() => setFoundCard(null)} aria-label="Dismiss"><X size={13} /></button>
          </div>
        </div>
      )}

      <div className="st-body" ref={bodyRef}>
        {dockOpen && columns.dock > 0 && columns.dockOverlay && (
          <div className="st-dockback" onClick={() => patchLayout({ dock: { ...layout.dock, open: false } })} aria-hidden="true" />
        )}
        {dockOpen && columns.dock > 0 && (
          <div className={`st-col st-col--dock${columns.dockOverlay ? " is-overlay" : ""}`} style={{ width: columns.dock }}>
            <Splitter
              axis="x"
              edge="right"
              label="Resize Schedule"
              onStart={() => { dragStart.current = columns.dock; }}
              onDrag={(d) => patchLayout({ dock: { ...layout.dock, width: clamp(dragStart.current + d, LAYOUT_LIMITS.dock.min, LAYOUT_LIMITS.dock.max) } })}
              onReset={() => patchLayout({ dock: { ...layout.dock, width: DEFAULT_LAYOUT.dock.width } })}
            />
            <ScheduleDock
              only={leftFull ? "schedule" : undefined}
              tab={layout.dock.tab}
              onTab={(tab) => patchLayout({ dock: { ...layout.dock, tab } })}
              onClose={() => patchLayout({ dock: { ...layout.dock, open: false } })}
              liveSlide={liveSlide}
              displayMode={displayMode}
              liveItemId={liveScheduleItemId}
              onOpenItem={(item) => void openPlanItem(item)}
              onProjectItem={(item) => void projectPlanItem(item)}
              onAddCurrent={() => schedule(previewSlide ?? selectedSlide)}
              canAddCurrent={Boolean(previewSlide ?? selectedSlide)}
            />
          </div>
        )}

        <div className="st-center">
          <div
            className={`st-work${columns.stacked ? " is-stacked" : ""}${columns.compact ? " is-compact" : ""}`}
            style={columns.stacked ? undefined : { gridTemplateColumns: `minmax(0, 1fr) ${columns.preview}px` }}
          >
            <div className="st-workspace">
              {sectionsInBody && (
                // One row, left: Bible · Worship · Notes · Media · Docs · Ministry (Worship and Notes are the two halves of "Text").
                <div className="st-subtabs st-subtabs--sections" role="tablist" aria-label="Studio sections">
                  {([
                    { key: "bible", label: "Bible", icon: BookOpen, on: view === "bible", go: () => chooseSection("bible") },
                    { key: "worship", label: "Worship", icon: Music, on: view === "worship", go: () => { chooseSection("worship"); setTextTab("worship"); } },
                    { key: "notes", label: "Notes", icon: FileText, on: view === "notes", go: () => { chooseSection("worship"); setTextTab("notes"); } },
                    { key: "media", label: "Media", icon: ImageIcon, on: view === "media", go: () => chooseSection("media") },
                    { key: "docs", label: "Docs", icon: FileText, on: view === "docs", go: () => chooseSection("docs") },
                    { key: "ministry", label: "Ministry", icon: Megaphone, on: view === "ministry", go: () => chooseSection("ministry") },
                  ]).map(({ key, label, icon: Icon, on, go }) => (
                    <button key={key} type="button" role="tab" aria-selected={on} className={on ? "is-on" : ""} onClick={go}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="st-workspace__body">{workspace}</div>
            </div>
            <div className="st-col st-col--preview" style={{ ["--st-reserve" as string]: `${previewReserve}px` }}>
              {!columns.stacked && (
                <Splitter
                  axis="x"
                  edge="left"
                  label="Resize Preview"
                  onStart={() => { dragStart.current = columns.preview; }}
                  onDrag={(d) => patchLayout({ previewWidth: clamp(dragStart.current - d, LAYOUT_LIMITS.preview.min, LAYOUT_LIMITS.preview.max) })}
                  onReset={() => patchLayout({ previewWidth: DEFAULT_LAYOUT.previewWidth })}
                />
              )}
              <PreviewPanel
                // Alternate is only a tab while an alternate output is running.
                tab={previewTab === "alternate" && altOpen ? "alternate" : "preview"}
                alternateOpen={altOpen}
                onTab={setPreviewTab}
                previewUrl={previewUrl}
                alternateUrl={alternateUrl}
                canUseAlternateOutput={canUseAlternateOutput}
                onUpgradeAlternate={promptAlternateOutputUpgrade}
                previewSlide={previewSlide}
                liveSlide={liveSlide}
                screen={screen}
                displayMode={displayMode}
                onDisplayMode={(mode: StudioMode) => void changeDisplayMode(mode)}
                alternateMode={altLook}
                onAlternateMode={setAltLook}
                hasLook={Boolean(lookModule)}
                currentTheme={currentTheme}
                onOpenThemes={() => setThemeModal(true)}
                transition={transition}
                onTransition={(value) => patchLayout({ transition: value })}
                textScale={textScale}
                onTextScale={(percent) => patchLayout({ textScale: percent })}
                textBold={textBold}
                textItalic={textItalic}
                onTextBold={(on) => patchLayout({ textBold: on })}
                onTextItalic={(on) => patchLayout({ textItalic: on })}
                textLook={textLook}
                onTextLook={(patch) => patchLayout({
                  ...(patch.color !== undefined ? { textColor: patch.color } : {}),
                  ...(patch.shadow !== undefined ? { textShadow: patch.shadow } : {}),
                  ...(patch.align !== undefined ? { textAlign: patch.align } : {}),
                  ...(patch.background !== undefined ? { textBackground: patch.background } : {}),
                })}
                onMonitorMenu={openMonitorMenu}
                playback={playbar}
                canGoLive={Boolean(previewSlide ?? selectedSlide) || camera.enabled || Boolean(liveCamera?.enabled) || nothingToShow}
                wordsOn={wordsOn}
                wordsLocked={!camera.enabled}
                onWords={setWordsOn}
                wordsLabel="Show Content"
                onGoLive={goLiveNow}
                onClear={() => { slideshow.stop(); void handleClear(); }}
                onPrev={goLivePrev}
                onNext={goLiveNext}
                previewFirst={previewFirst}
                onPreviewFirst={setPreviewFirst}
                logoOn={screen === "logo"}
                onLogo={() => toggleScreen("logo")}
                onEditLogo={() => { setSettingsTab("general"); setSettingsFocus("logo"); setSettingsPanel(true); }}
                onWheelScroll={pageScrollable ? (deltaY) => changeScreenScroll(screenScroll + deltaY / 6) : undefined}
                pageScroll={pageScrollable ? { value: screenScroll, onChange: changeScreenScroll } : null}
                canSchedule={Boolean(previewSlide ?? selectedSlide)}
                onSchedule={() => schedule(previewSlide ?? selectedSlide)}
                nextLabel={dockOpen ? undefined : nextItem?.label}
                onNextItem={nextItem && !dockOpen ? projectNextItem : undefined}
                notice={liveCamera?.enabled && liveCamera.layout === "camera-only" ? "Camera only: the screen shows just the camera, no words." : ""}
                previewCam={{ enabled: camera.enabled, layout: camera.layout, stream: camera.stream }}
                cameraCard={<><SharedControls camera={camera} cameraHint={cameraHint} wordsOn={wordsOn} onCamera={setCameraOn} showToggle={false} /><StudioTip tips={generalTips()} /></>}
                scenePicker={view === "media" || view === "docs"
                  ? <ScenePicker fillLabel={view === "media" ? "Media" : "Document"} active={cameraShown ? (wordsOn ? null : "camera") : "fullscreen"} onChoose={(scene) => void chooseScene(scene)} />
                  : <ScenePicker active={activeScene} onChoose={(scene) => void chooseScene(scene)} />}
                themeCard={lookModule ? (
                  <ThemePanel
                    themes={lookThemes}
                    currentId={currentTheme?.id ?? ""}
                    mode={displayMode}
                    forLabel={lookModule === "bible" ? "Bible" : lookModule === "worship" ? "Worship" : "Notes"}
                    sample={previewSlide && previewSlide.module === lookModule ? { text: previewSlide.text, reference: previewSlide.reference } : null}
                    onMore={() => setThemeModal(true)}
                    onEdit={(theme) => void startEditTheme(theme)}
                  />
                ) : undefined}
                graphicLive={graphicLive}
                onCloseGraphic={closeGraphic}
                liveCam={{
                  enabled: Boolean(liveCamera?.enabled),
                  layout: liveCamera?.layout ?? "hidden",
                  // The Studio's own picture is used while it is the same camera.
                  stream: liveCamera && liveCamera.deviceId === camera.deviceId ? camera.stream : null,
                }}
              >
              </PreviewPanel>
            </div>
          </div>

          {(
            <div className="st-drawer-wrap" style={{ height: drawerHeight }}>
              {drawerOpen && (
                <Splitter
                  axis="y"
                  edge="top"
                  label="Resize the drawer"
                  onStart={() => { dragStart.current = drawerHeight; }}
                  onDrag={(d) => patchLayout({ drawer: { ...layout.drawer, height: clamp(dragStart.current - d, 100, drawerMax) } })}
                  onReset={() => patchLayout({ drawer: { ...layout.drawer, height: DEFAULT_LAYOUT.drawer.height } })}
                />
              )}
              <QueueDrawer
                open={drawerOpen}
                onToggle={() => patchLayout({ drawer: { ...layout.drawer, open: !drawerOpen } })}
                newKeys={recentKeys}
                view={drawerView}
                onView={(view) => patchLayout({ drawer: { ...layout.drawer, tab: view === "graphics" ? "graphics" : view === "mine" ? "mine" : "queue", open: true } })}
                graphicLive={Boolean(graphicLive)}
                hideVerseAi={leftFull}
                savedCount={savedGraphicsCount}
                graphics={<BroadcastGraphicsDrawer mode={drawerView === "mine" ? "mine" : "all"} live={graphicLive} onProject={projectGraphic} onClose={closeGraphic} />}
                queue={ai.queue}
                suggestions={ai.suggestions}
                recentSpeech={ai.recentSpeech}
                liveKey={slideCandidateKey(liveSlide)}
                previewKey={slideCandidateKey(previewSlide)}
                onOpen={previewCandidate}
                onProject={(c) => void projectCandidate(c)}
                onSchedule={(c) => void scheduleCandidate(c)}
                onAddToQueue={ai.addToQueue}
                onRemove={ai.removeFromQueue}
                onMove={ai.moveInQueue}
                onClear={ai.clearQueue}
              />
            </div>
          )}
        </div>

        {showVerseAi && columns.verseAi > 0 && (layout.verseAiCollapsed || columns.verseAiRail ? (
          <div className="st-col st-col--vai" style={{ width: columns.verseAi }}>
            <VerseAiRail ai={ai} autoMode={autoMode} onExpand={() => patchLayout({ verseAiCollapsed: false })} onOpenDrawer={openDrawer} />
          </div>
        ) : (
          <div className="st-col st-col--vai" style={{ width: columns.verseAi }}>
              <VerseAiSidebar
                ai={ai}
                autoMode={autoMode}
                onAutoMode={setAutoMode}
                onSearchAll={() => setSearchAll("")}
                autoMessage={autoMessage}
                onOpenDrawer={openDrawer}
                onCollapse={() => patchLayout({ verseAiCollapsed: true })}
                queuePanel={(
                  <QueueDrawer
                    embedded
                    open
                    onToggle={() => undefined}
                    view="verseai"
                    onView={() => undefined}
                    graphics={null}
                    graphicLive={false}
                    newKeys={recentKeys}
                    queue={ai.queue}
                    suggestions={ai.suggestions}
                    recentSpeech={ai.recentSpeech}
                    liveKey={slideCandidateKey(liveSlide)}
                    previewKey={slideCandidateKey(previewSlide)}
                    onOpen={previewCandidate}
                    onProject={(c) => void projectCandidate(c)}
                    onSchedule={(c) => void scheduleCandidate(c)}
                    onAddToQueue={ai.addToQueue}
                    onRemove={ai.removeFromQueue}
                    onMove={ai.moveInQueue}
                    onClear={ai.clearQueue}
                  />
                )}
                historyPanel={(
                  <ScheduleDock
                    only="history"
                    tab="history"
                    onTab={() => undefined}
                    onClose={() => undefined}
                    liveSlide={liveSlide}
                    displayMode={displayMode}
                    liveItemId={liveScheduleItemId}
                    onOpenItem={(item) => void openPlanItem(item)}
                    onProjectItem={(item) => void projectPlanItem(item)}
                    onAddCurrent={() => schedule(previewSlide ?? selectedSlide)}
                    canAddCurrent={Boolean(previewSlide ?? selectedSlide)}
                  />
                )}
              />
            <Splitter
              axis="x"
              edge="left"
              label="Resize Verse AI"
              onStart={() => { dragStart.current = columns.verseAi; }}
              onDrag={(d) => patchLayout({ verseAiWidth: clamp(dragStart.current - d, LAYOUT_LIMITS.verseAi.min, LAYOUT_LIMITS.verseAi.max) })}
              onReset={() => patchLayout({ verseAiWidth: DEFAULT_LAYOUT.verseAiWidth })}
            />
          </div>
        ))}
      </div>

      {themeGate.modal}
      {songEdit && (
        <Suspense fallback={null}>
          <WorshipSongModal
            song={songEdit === "edit" ? song : undefined}
            onClose={() => setSongEdit(null)}
            onSave={() => {
              setSongEdit(null);
              void getAllSongs().then(setSongs).catch(() => undefined);
              say("Song saved.");
            }}
          />
        </Suspense>
      )}
      {songImport && (
        <Suspense fallback={null}>
          <DocumentSongImport
            onClose={() => setSongImport(false)}
            onImported={() => {
              void getAllSongs().then(setSongs).catch(() => undefined);
              say("Songs imported.");
            }}
          />
        </Suspense>
      )}
      {themeEdit && (
        <Suspense fallback={null}>
          <ThemeCreatorModal
            editTheme={themeEdit.theme}
            onClose={() => setThemeEdit(null)}
            onSaved={(saved) => {
              setThemeEdit(null);
              // The saved theme is used right away (in Preview; the screen follows on Send to Screen).
              if (lookModule) void themesApi.choose(lookModule, displayMode, saved.id).then(() => { themesApi.reload(); say("Theme saved and applied."); });
              else themesApi.reload();
            }}
          />
        </Suspense>
      )}

      {themeModal && lookModule && (
        <ThemeModal
          themes={lookThemes}
          currentId={currentTheme?.id ?? ""}
          mode={displayMode}
          forLabel={lookModule === "bible" ? "Bible" : lookModule === "worship" ? "Worship" : "Notes"}
          sample={previewSlide && previewSlide.module === lookModule ? { text: previewSlide.text, reference: previewSlide.reference } : null}
          onPick={(id) => void themesApi.choose(lookModule, displayMode, id)}
          onEdit={() => { setThemeModal(false); void startEditTheme(currentTheme); }}
          onCreate={() => { setThemeModal(false); void startEditTheme(null); }}
          onClose={() => setThemeModal(false)}
        />
      )}

      {searchAll !== null && (
        <GlobalSearch
          initial={searchAll}
          onClose={() => setSearchAll(null)}
          onRun={(result, how) => void runGlobal(result, how)}
          book={bible.book}
          chapter={bible.chapter}
          translation={bible.translation}
          translations={bible.translations}
          songs={songs}
          notes={notes}
          media={media}
          mediaBase={base}
          mix={searchMix}
          commands={globalCommands}
          previewFirst={previewFirst}
        />
      )}

      {settingsPanel && (
        <SettingsModal
          initialTab={settingsTab}
          focus={settingsFocus}
          previewFirst={previewFirst}
          onPreviewFirst={setPreviewFirst}
          transition={transition}
          onTransition={(value) => patchLayout({ transition: value })}
          textScale={textScale}
          onTextScale={(percent) => patchLayout({ textScale: percent })}
          onResetLayout={() => setLayout((c) => ({ ...DEFAULT_LAYOUT, section: c.section, displayMode: c.displayMode, transition: c.transition, previewFirst: c.previewFirst, camera: c.camera, micId: c.micId, textScale: c.textScale, textBold: c.textBold, textItalic: c.textItalic, textColor: c.textColor, textShadow: c.textShadow, textAlign: c.textAlign, textBackground: c.textBackground, logoScale: c.logoScale }))}
          onClose={() => { setSettingsPanel(false); setSettingsTab("general"); setSettingsFocus(undefined); }}
          logo={{ url: logoOverride ? resolveOverlayAssetUrl(logoOverride) : resolveOverlayAssetUrl(getMvSettings().brandLogoPath), custom: Boolean(logoOverride), onPick: (file) => void pickLogo(file), onReset: () => applyLogo(""), scale: layout.logoScale, onScale: (percent) => patchLayout({ logoScale: clamp(percent, 30, 250) }), bg: logoBg, onBg: applyLogoBg, onPickBgImage: (file) => void pickLogoBg(file) }}
          output={{
            monitors,
            monitorKey,
            onMonitorKey: (key) => { setMonitorKey(key); saveOutputMonitor(key); },
            outputOpen,
            outputName: outputMonitorName,
            busy,
            onOpen: (target) => void openProjectorOn("program", target),
            onCloseOutput: () => void handleCloseOutput("program"),
            wifiLink,
            copied,
            onCopy: () => void copyWifiLink(),
            cameraReady,
            onCameraReady: setCameraReady,
          }}
        />
      )}

      {outputPop && (
        <>
          <div className="studio-menu-backdrop" onClick={() => setOutputPop(null)} onContextMenu={(e) => { e.preventDefault(); setOutputPop(null); }} />
          <div
            className="studio-menu st-outpop"
            ref={outputMenuRef}
            style={{ left: outputPop.x, top: outputPop.y }}
            role="dialog"
            aria-label="Output settings"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (outputHelp && !target.closest(".st-outpop__help, .st-outpop__info")) setOutputHelp(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (outputHelp) setOutputHelp(null);
                else setOutputPop(null);
              }
            }}
          >
            <div className="st-outpop__heading">
              <div className="st-outpop__title"><Monitor size={14} /> Output · projector or TV</div>
              <button
                type="button"
                className="st-outpop__info"
                aria-label="About the output screen"
                aria-expanded={outputHelp === "output"}
                aria-controls={outputHelp === "output" ? "st-output-help" : undefined}
                title="About the output screen"
                onClick={() => setOutputHelp((current) => current === "output" ? null : "output")}
              >
                <Info size={14} />
              </button>
              {outputHelp === "output" && (
                <div id="st-output-help" className="st-outpop__help" role="note">
                  <p>{outputOpen ? `The output is on ${outputMonitorName || "a screen"}. Choose another screen, then move the output there.` : "Choose the screen that should show the presentation, then start the output."}</p>
                  {monitors.length < 2 && <p>Only this screen was found. Connect a projector or TV with HDMI to see it here.</p>}
                  <p>Press Esc on the output to close it, or D to check what it is receiving.</p>
                </div>
              )}
            </div>
            <label className="st-outpop__field">
              <span>Screen</span>
              <select value={outPick} onChange={(e) => setOutPick(e.target.value)} disabled={busy} aria-label="Screen for the output">
                {monitors.map((m) => (
                  <option key={m.key} value={m.key}>{monitorLabel(m)}{m.isControlScreen ? " (this screen)" : ""}</option>
                ))}
                <option value="window">New window (drag it to any screen)</option>
              </select>
            </label>
            <div className="st-outpop__btns">
              <button type="button" className="st-outpop__go" disabled={busy || !outPick} onClick={() => { setOutputPop(null); void openProjectorOn("program", outPick); }}>
                <Monitor size={14} /> <span>{outputOpen ? "Move output" : "Start output"}</span>
              </button>
              <button type="button" className="st-outpop__stopbtn" disabled={!outputOpen || busy} onClick={() => { setOutputPop(null); void handleCloseOutput("program"); }} title={outputOpen ? "Close the output screen" : "No output is open"}>
                <X size={14} /> <span>Stop output</span>
              </button>
            </div>
            <div className="studio-menu__divider" />
            <div className="st-outpop__heading">
              <div className="st-outpop__title"><MonitorPlay size={14} /> Alternate output {!canUseAlternateOutput && <span className="st-outpop__pro">PRO</span>}</div>
              <button
                type="button"
                className="st-outpop__info"
                aria-label="About the alternate output"
                aria-expanded={outputHelp === "alternate"}
                aria-controls={outputHelp === "alternate" ? "st-alternate-help" : undefined}
                title="About the alternate output"
                onClick={() => setOutputHelp((current) => current === "alternate" ? null : "alternate")}
              >
                <Info size={14} />
              </button>
              {outputHelp === "alternate" && (
                <div id="st-alternate-help" className="st-outpop__help" role="note">
                  <p>{altProjector
                    ? `On ${altProjector.where}: the same item, with the words as ${altLook === "lower-third" ? "a lower third" : "full screen"}.`
                    : "A second screen shows the same item in its own look. For example, use a lower third for the live stream while the main screen shows full screen."}</p>
                  {!canUseAlternateOutput && <p>Alternate outputs are included with Pro and trial access.</p>}
                  <p className={liveCamera?.enabled && !cameraRelayStatus.ok ? "is-warning" : ""}>
                    {liveCamera?.enabled
                      ? `Camera to the screen: ${cameraRelayStatus.ok ? "sending" : cameraRelayStatus.text}.`
                      : "Camera is not live. Turn it on and press Go Live to show it on the output."}
                  </p>
                </div>
              )}
            </div>
            <div className="st-outpop__row">
              <label className="st-outpop__field">
                <span>Words</span>
                <select value={altLook} disabled={!canUseAlternateOutput} onChange={(e) => setAltLook(e.target.value === "fullscreen" ? "fullscreen" : "lower-third")} aria-label="Look of the words on the alternate output">
                  <option value="lower-third">Lower third</option>
                  <option value="fullscreen">Full screen</option>
                </select>
              </label>
              <label className="st-outpop__field">
                <span>Screen</span>
                <select value={altPick} onChange={(e) => setAltPick(e.target.value)} disabled={!canUseAlternateOutput || busy} aria-label="Screen for the alternate output">
                  {monitors.map((m) => (
                    <option key={m.key} value={m.key}>{monitorLabel(m)}{m.isControlScreen ? " (this screen)" : ""}{projectorList.some((p) => p.feed === "program" && p.monitorKey === m.key) ? " (Output)" : ""}</option>
                  ))}
                  <option value="window">New window</option>
                </select>
              </label>
            </div>
            <div className="st-outpop__btns">
              <button type="button" className="st-outpop__go" disabled={busy || (canUseAlternateOutput && !altPick)} onClick={() => {
                if (!canUseAlternateOutput) { setOutputPop(null); promptAlternateOutputUpgrade(); return; }
                setOutputPop(null);
                void openProjectorOn("alt", altPick);
              }}>
                {canUseAlternateOutput ? <MonitorPlay size={14} /> : <Lock size={14} />} <span>{canUseAlternateOutput ? (altOpen ? "Move here" : "Start alternate") : "Unlock Pro"}</span>
              </button>
              <button type="button" className="st-outpop__stopbtn" disabled={!altOpen || busy} onClick={() => { setOutputPop(null); void handleCloseOutput("alt"); }} title={altOpen ? "Close the alternate output" : "No alternate output is open"}>
                <X size={14} /> <span>Stop</span>
              </button>
            </div>
            <div className="studio-menu__divider" />
            <button type="button" className="st-outpop__share" onClick={() => { setOutputPop(null); setSettingsTab("general"); setSettingsFocus(undefined); setSettingsPanel(true); }}>
              <Wifi size={14} /> <span>Share over Wi-Fi…</span>
            </button>
          </div>
        </>
      )}

      {menu && (() => {
        const feedName = menu.feed === "program" ? "Main output" : menu.feed === "alt" ? "Alternate output" : "Preview";
        const open = projectorList.filter((p) => p.feed === menu.feed);
        return (
          <>
            <div className="studio-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <div className="studio-menu" style={{ left: menu.x, top: menu.y }} role="menu">
              <div className="studio-menu__item studio-menu__item--sub" role="menuitem" aria-haspopup="menu" tabIndex={0}>
                {menu.feed === "program" ? <Monitor size={14} /> : menu.feed === "alt" ? <MonitorPlay size={14} /> : <Eye size={14} />}
                <span>Open {feedName} on a screen</span>
                <ChevronRight size={14} />
                <div className="studio-menu studio-menu--flyout" role="menu">
                  {monitors.map((m) => {
                    const here = open.some((p) => p.monitorKey === m.key);
                    return (
                      <button key={m.key} type="button" role="menuitem" disabled={busy} onClick={() => void openProjectorOn(menu.feed, m.key)}>
                        <span>{monitorLabel(m)}{m.isControlScreen ? " (this screen)" : ""}</span>
                        {here && <Check size={14} />}
                      </button>
                    );
                  })}
                  {monitors.length === 0 && <div className="studio-menu__empty">No screens found</div>}
                  <div className="studio-menu__divider" />
                  <button type="button" role="menuitem" disabled={busy} onClick={() => void openProjectorOn(menu.feed, "window")}>
                    <span>New window</span>
                  </button>
                </div>
              </div>
              {open.length > 0 && (
                <>
                  <div className="studio-menu__divider" />
                  {open.map((p) => (
                    <button key={p.label} type="button" role="menuitem" onClick={() => { setMenu(null); if (p.feed === "program") closingOutputRef.current = true; void closeProjector(p.label); }}>
                      <X size={14} /> <span>Close {feedName} ({p.where})</span>
                    </button>
                  ))}
                </>
              )}
              <div className="studio-menu__divider" />
              {menu.feed === "preview" && (
                <button type="button" role="menuitem" disabled={!previewSlide} onClick={() => { setMenu(null); void project(previewSlide); }}>
                  <Play size={14} /> <span>Go Live</span>
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenu(null); toggleScreen("black"); }}>
                <Square size={14} /> <span>{screen === "black" ? "Show content again" : "Black screen"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); toggleScreen("logo"); }}>
                <Sun size={14} /> <span>{screen === "logo" ? "Hide logo" : "Show logo"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); void handleClear(); }}>
                <MonitorOff size={14} /> <span>Clear screen</span>
              </button>
              <div className="studio-menu__divider" />
              <button type="button" role="menuitem" onClick={() => { setMenu(null); setSettingsPanel(true); }}>
                <Wifi size={14} /> <span>Share over Wi-Fi…</span>
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
