/**
 * easyWorshipImportService.ts — EasyWorship 6/7 Database Importer
 *
 * Reads EasyWorship SQLite database tables (`Songs.db` and `SongWords.db`)
 * or RTF lyric payloads and converts them into structured `SmartImportSongDraft`
 * records for MakeChurchEazy's worship library.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  SmartImportSectionDraft,
  SmartImportSectionType,
  SmartImportSongDraft,
} from "./smartImportTypes";

export interface EasyWorshipRawRecord {
  rowid: number;
  title: string;
  author?: string;
  copyright?: string;
  administrator?: string;
  referenceNumber?: string;
  tags?: string;
  wordsRtf: string;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** RTF groups whose text is not lyrics (font and colour tables, document info, pictures…). */
const RTF_SKIPPED_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr",
  "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl",
  "themedata", "colorschememapping", "datastore", "latentstyles", "object", "fldinst",
]);

const RTF_SYMBOLS: Record<string, string> = {
  emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", bullet: "•",
  emspace: " ", enspace: " ", qmspace: " ",
};

const CONTROL_WORD = /([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;

function rtfByteDecoder(codepage: number): TextDecoder {
  try {
    return new TextDecoder(`windows-${codepage}`);
  } catch {
    return new TextDecoder("windows-1252");
  }
}

/**
 * Turns the RTF EasyWorship keeps in `word.words` into plain text, one lyric line per line,
 * with the section markers ("Verse 1", "Chorus") kept as their own lines.
 * Handles accented letters stored as \'xx (in the song's code page) or \uN (Unicode).
 */
export function parseEasyWorshipRtf(rtf: string): string {
  if (!rtf || typeof rtf !== "string") return "";
  if (!rtf.trimStart().startsWith("{\\rtf")) {
    return rtf.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).join("\n").trim();
  }

  let out = "";
  let bytes: number[] = [];
  let decoder = rtfByteDecoder(1252);
  // Per group: is its text skipped, and how many fallback characters follow a \uN.
  const stack: Array<{ skip: boolean; uc: number }> = [];
  let skip = false;
  let uc = 1;
  let fallbackToSkip = 0;

  const flushBytes = () => {
    if (bytes.length) {
      out += decoder.decode(new Uint8Array(bytes));
      bytes = [];
    }
  };
  const emit = (text: string) => {
    if (skip) return;
    if (fallbackToSkip > 0) {
      fallbackToSkip -= 1;
      return;
    }
    flushBytes();
    out += text;
  };

  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      i += 1;
      continue;
    }
    if (ch === "}") {
      const parent = stack.pop();
      if (parent) ({ skip, uc } = parent);
      fallbackToSkip = 0;
      i += 1;
      continue;
    }
    // Raw line breaks in RTF are only there to wrap the file; \par marks the real ones.
    if (ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch !== "\\") {
      emit(ch);
      i += 1;
      continue;
    }

    const next = rtf[i + 1];
    if (next === undefined) break;
    if (next === "\\" || next === "{" || next === "}") {
      emit(next);
      i += 2;
      continue;
    }
    if (next === "'") {
      const byte = parseInt(rtf.substr(i + 2, 2), 16);
      i += 4;
      if (skip || Number.isNaN(byte)) continue;
      if (fallbackToSkip > 0) {
        fallbackToSkip -= 1;
        continue;
      }
      bytes.push(byte);
      continue;
    }
    if (next === "*") {
      skip = true;
      i += 2;
      continue;
    }
    if (next === "~") {
      emit(" ");
      i += 2;
      continue;
    }
    if (next === "_") {
      emit("-");
      i += 2;
      continue;
    }
    if (next === "\r" || next === "\n") {
      emit("\n");
      i += 2;
      continue;
    }

    CONTROL_WORD.lastIndex = i + 1;
    const match = CONTROL_WORD.exec(rtf);
    if (!match) {
      // Other control symbols (\-, \|, \:) carry no text.
      i += 2;
      continue;
    }
    i += 1 + match[0].length;
    const word = match[1];
    const param = match[2] === undefined ? undefined : Number(match[2]);

    if (RTF_SKIPPED_DESTINATIONS.has(word)) {
      skip = true;
    } else if (word === "par" || word === "line" || word === "page" || word === "sect") {
      emit("\n");
    } else if (word === "tab") {
      emit(" ");
    } else if (word === "ansicpg" && param) {
      flushBytes();
      decoder = rtfByteDecoder(param);
    } else if (word === "uc" && param !== undefined) {
      uc = Math.max(0, param);
    } else if (word === "u" && param !== undefined) {
      emit(String.fromCharCode(param < 0 ? param + 65536 : param));
      if (!skip) fallbackToSkip = uc;
    } else if (RTF_SYMBOLS[word]) {
      emit(RTF_SYMBOLS[word]);
    }
  }
  flushBytes();

  const lines = out.split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Parses cleaned EasyWorship lyrics into structured section drafts
 * (Verse 1, Chorus 1, Bridge, Pre-Chorus, etc.)
 */
export function parseEasyWorshipSongSections(cleanLyrics: string): SmartImportSectionDraft[] {
  const lines = cleanLyrics.split("\n");
  const sections: SmartImportSectionDraft[] = [];
  let currentLabel = "Verse 1";
  let currentType: SmartImportSectionType = "verse";
  let currentNumber = "1";
  let currentLines: string[] = [];

  const SECTION_HEADER_RE =
    /^(verse|chorus|bridge|tag|pre-chorus|pre chorus|prechorus|refrain|intro|outro|ending|vamp|hook)\s*(\d*):?$/i;

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content) {
      sections.push({
        id: uid("ew-sec"),
        type: currentType,
        label: currentLabel,
        number: currentNumber || undefined,
        content,
        warnings: [],
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(SECTION_HEADER_RE);
    if (match) {
      flush();
      const rawType = match[1].toLowerCase();
      const num = match[2] || "";
      if (rawType.startsWith("chorus") || rawType.startsWith("refrain")) {
        currentType = "chorus";
        currentLabel = num ? `Chorus ${num}` : "Chorus";
      } else if (rawType.startsWith("bridge")) {
        currentType = "bridge";
        currentLabel = num ? `Bridge ${num}` : "Bridge";
      } else if (
        rawType.startsWith("tag") ||
        rawType.startsWith("vamp") ||
        rawType.startsWith("hook")
      ) {
        currentType = "tag";
        currentLabel = num ? `Tag ${num}` : "Tag";
      } else if (rawType.startsWith("pre")) {
        currentType = "pre-chorus";
        currentLabel = num ? `Pre-Chorus ${num}` : "Pre-Chorus";
      } else if (rawType.startsWith("intro")) {
        currentType = "intro";
        currentLabel = num ? `Intro ${num}` : "Intro";
      } else if (rawType.startsWith("outro") || rawType.startsWith("ending")) {
        currentType = "outro";
        currentLabel = num ? `Outro ${num}` : "Outro";
      } else {
        currentType = "verse";
        currentLabel = num ? `Verse ${num}` : "Verse";
      }
      currentNumber = num;
    } else {
      currentLines.push(line);
    }
  }

  flush();

  if (sections.length === 0 && cleanLyrics.trim()) {
    sections.push({
      id: uid("ew-sec"),
      type: "verse",
      label: "Verse 1",
      number: "1",
      content: cleanLyrics.trim(),
      warnings: [],
    });
  }

  return sections;
}

/**
 * Converts raw EasyWorship records into `SmartImportSongDraft` items
 */
export function convertEasyWorshipRecordsToDrafts(
  records: EasyWorshipRawRecord[],
): SmartImportSongDraft[] {
  return records.map((rec) => {
    const cleaned = parseEasyWorshipRtf(rec.wordsRtf);
    const sections = parseEasyWorshipSongSections(cleaned);

    return {
      id: uid(`ew-${rec.rowid}`),
      title: rec.title.trim() || `EasyWorship Song ${rec.rowid}`,
      artist: rec.author?.trim() || "",
      copyright: rec.copyright?.trim() || undefined,
      ccliNumber: rec.referenceNumber?.trim() || undefined,
      sections,
      warnings: [],
      reviewNotes: ["Imported from EasyWorship profile database."],
      method: "easyworship",
      rawExcerpt: cleaned.slice(0, 500),
    };
  });
}

/**
 * Invokes Tauri backend command to read EasyWorship SQLite database from folder path
 */
export async function importEasyWorshipFolder(folderPath: string): Promise<SmartImportSongDraft[]> {
  const records = await invoke<EasyWorshipRawRecord[]>("read_easyworship_db_folder", {
    folderPath,
  });
  return convertEasyWorshipRecordsToDrafts(records);
}
