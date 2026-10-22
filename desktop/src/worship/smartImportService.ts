import {
  formatLyricsFromSections,
  generateSlides,
} from "./slideEngine";
import type { Song } from "./types";
import { saveSongsBatch } from "./worshipDb";
import { trackWorshipSongImported } from "../services/tracking";
import type {
  SmartImportSectionDraft,
  SmartImportSectionType,
  SmartImportSongDraft,
} from "./smartImportTypes";

const DEFAULT_IMPORT_LINES_PER_SLIDE = 2;
const DEFAULT_IMPORT_AUTO_SPLIT = true;
const IMPORT_YIELD_INTERVAL = 8;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function sectionTypeToLabel(type: SmartImportSectionType, number?: string): string {
  const suffix = number?.trim() ? ` ${number.trim()}` : "";
  switch (type) {
    case "chorus":
      return `Chorus${suffix}`;
    case "refrain":
      return `Refrain${suffix}`;
    case "bridge":
      return `Bridge${suffix}`;
    case "tag":
      return `Tag${suffix}`;
    case "pre-chorus":
      return `Pre-Chorus${suffix}`;
    case "intro":
      return `Intro${suffix}`;
    case "outro":
      return `Outro${suffix}`;
    case "other":
      return number?.trim() ? `Section ${number.trim()}` : "Section";
    default:
      return `Verse${suffix}`;
  }
}

function slideTypeFromImportType(type: SmartImportSectionType): Song["slides"][number]["type"] {
  return type === "refrain" ? "chorus" : type;
}

function inferSectionNumber(label: string): string | undefined {
  const match = label.match(/\b(\d+|[ivxlcdm]+)\b/i);
  return match?.[1];
}

function inferSectionType(label: string, fallback: SmartImportSectionType = "verse"): SmartImportSectionType {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized.startsWith("chorus")) return "chorus";
  if (normalized.startsWith("refrain")) return "refrain";
  if (normalized.startsWith("bridge")) return "bridge";
  if (normalized.startsWith("tag") || normalized.startsWith("vamp") || normalized.startsWith("hook")) return "tag";
  if (normalized.startsWith("pre-chorus") || normalized.startsWith("prechorus")) return "pre-chorus";
  if (normalized.startsWith("intro")) return "intro";
  if (normalized.startsWith("outro") || normalized.startsWith("ending")) return "outro";
  if (normalized.startsWith("verse")) return "verse";
  return fallback;
}

function sanitizeSectionDraft(section: Partial<SmartImportSectionDraft>, fallbackIndex: number): SmartImportSectionDraft | null {
  const content = sanitizeLineBreaks(section.content ?? "").trim();
  if (!content) return null;

  const type = inferSectionType(section.label ?? "", section.type ?? "verse");
  const number = section.number?.trim() || inferSectionNumber(section.label ?? "");
  const label = (section.label?.trim() || sectionTypeToLabel(type, number)).replace(/\s+/g, " ").trim();

  return {
    id: section.id?.trim() || uid(`import-section-${fallbackIndex}`),
    type,
    label,
    number: number || undefined,
    content,
    warnings: Array.isArray(section.warnings)
      ? section.warnings.map((warning) => String(warning).trim()).filter(Boolean)
      : [],
  };
}

export function formatDraftLyrics(song: SmartImportSongDraft): string {
  const sections = song.sections
    .map((section) => sanitizeSectionDraft(section, 0))
    .filter((section): section is SmartImportSectionDraft => Boolean(section))
    .map((section) => ({
      label: section.label || sectionTypeToLabel(section.type, section.number),
      lines: sanitizeLineBreaks(section.content).split("\n").map((line) => line.trim()).filter(Boolean),
    }))
    .filter((section) => section.lines.length > 0);

  return formatLyricsFromSections(sections);
}

export function estimateDraftSlideCount(
  song: SmartImportSongDraft,
  options: { linesPerSlide?: number; autoSplit?: boolean } = {},
): number {
  const lyrics = formatDraftLyrics(song);
  if (!lyrics.trim()) return 0;
  return generateSlides(
    lyrics,
    options.linesPerSlide ?? DEFAULT_IMPORT_LINES_PER_SLIDE,
    options.autoSplit ?? DEFAULT_IMPORT_AUTO_SPLIT,
  ).length;
}

export function createEmptyImportSection(type: SmartImportSectionType = "verse"): SmartImportSectionDraft {
  const number = type === "verse" ? "1" : undefined;
  return {
    id: uid("import-section"),
    type,
    label: sectionTypeToLabel(type, number),
    number,
    content: "",
    warnings: [],
  };
}

export function buildFallbackDraft(rawText: string, sourceName: string): SmartImportSongDraft[] {
  const text = rawText.trim();
  if (!text) return [];
  return [{
    id: uid("import-song"),
    title: sourceName.replace(/\.[^.]+$/, "").trim() || "Imported Document",
    sections: [{
      ...createEmptyImportSection("verse"),
      content: text,
    }],
    artist: "",
    language: undefined,
    hymnNumber: undefined,
    warnings: [],
    reviewNotes: ["Document text extracted. AI structuring was unavailable — review and organize sections before importing."],
    method: "fallback",
    rawExcerpt: text.slice(0, 2400),
  }];
}

export async function importSmartSongs(
  songs: SmartImportSongDraft[],
  options: {
    sourceName?: string;
    saveBatch?: typeof saveSongsBatch;
    linesPerSlide?: number;
    autoSplit?: boolean;
  } = {},
  onProgress?: (imported: number, total: number) => void,
): Promise<Song[]> {
  const imported: Song[] = [];
  const now = new Date().toISOString();
  const linesPerSlide = options.linesPerSlide ?? DEFAULT_IMPORT_LINES_PER_SLIDE;
  const autoSplit = options.autoSplit ?? DEFAULT_IMPORT_AUTO_SPLIT;

  for (let i = 0; i < songs.length; i += 1) {
    const draft = songs[i];
    const lyrics = formatDraftLyrics(draft);
    const song: Song = {
      id: `song-import-${draft.id}`,
      metadata: {
        title: draft.title.trim() || "Untitled Song",
        artist: draft.artist?.trim() || "",
        language: draft.language,
        hymnNumber: draft.hymnNumber?.trim() || undefined,
      },
      lyrics,
      slides: generateSlides(lyrics, linesPerSlide, autoSplit).map((slide) => ({
        ...slide,
        type: slideTypeFromImportType(slide.type),
      })),
      createdAt: now,
      updatedAt: now,
      importSourceName: options.sourceName?.trim() || undefined,
      importSourceType: "document",
      autoSplit,
      linesPerSlide,
    };

    imported.push(song);

    if ((i + 1) % IMPORT_YIELD_INTERVAL === 0) {
      await yieldToMainThread();
    }
  }

  await (options.saveBatch ?? saveSongsBatch)(imported, { onProgress });

  if (imported.length) {
    // Only the kind of source is sent, never the file name.
    const source = options.sourceName?.trim() || "";
    const format = /^easyworship/i.test(source) ? "easyworship" : source.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    trackWorshipSongImported(imported.length, format);
  }

  return imported;
}
