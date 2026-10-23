import { describe, expect, it } from "vitest";
import {
  parseEasyWorshipRtf,
  parseEasyWorshipSongSections,
  convertEasyWorshipRecordsToDrafts,
} from "./easyWorshipImportService";

describe("easyWorshipImportService", () => {
  it("cleans RTF formatting into plain text", () => {
    const rawRtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\pard\\plain Verse 1\\par A mighty fortress is our God\\par A bulwark never failing\\par}}`;
    const clean = parseEasyWorshipRtf(rawRtf);
    expect(clean).toContain("Verse 1");
    expect(clean).toContain("A mighty fortress is our God");
    expect(clean).toContain("A bulwark never failing");
  });

  it("parses RTF sections into structured slide drafts", () => {
    const lyrics = `Verse 1\nLine 1\nLine 2\n\nChorus 1\nChorus line 1\nChorus line 2`;
    const sections = parseEasyWorshipSongSections(lyrics);
    expect(sections.length).toBe(2);
    expect(sections[0].type).toBe("verse");
    expect(sections[0].label).toBe("Verse 1");
    expect(sections[1].type).toBe("chorus");
    expect(sections[1].label).toBe("Chorus 1");
  });

  // The header EasyWorship 7 writes before every song's lyrics (font table, colour table, list styles).
  const EW_HEADER =
    "{\\rtf1\\ansi\\deff0\\deftab254{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}{\\f1\\fnil\\fcharset0 Verdana;}}" +
    "{\\colortbl\\red0\\green0\\blue0;\\red255\\green0\\blue0;}\\paperw12240\\paperh15840\\margl1880\\margr1880\\margt1440\\margb1440" +
    "{\\*\\pnseclvl1\\pnucrm\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{\\pntxta{.}}}\r\n" +
    "{\\*\\pnseclvl5\\pndec\\pnstart1\\pnhang\\pnindent720{\\pntxtb{(}}{\\pntxta{)}}}\r\n";
  const line = (text: string) => `\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut ${text}\\par\r\n`;

  it("keeps EasyWorship's font and colour tables out of the lyrics, one line per line", () => {
    const rtf = `${EW_HEADER}{\\pard${line("Verse 1")}${line("A mighty fortress is our God")}${line("A bulwark never failing")}}\r\n}`;
    expect(parseEasyWorshipRtf(rtf)).toBe("Verse 1\nA mighty fortress is our God\nA bulwark never failing");
  });

  it("reads accented letters, smart quotes and Unicode the way EasyWorship stores them", () => {
    const rtf = `${EW_HEADER}{\\pard${line("\\u210?r\\'e8 \\u242?f\\'e9 \\u7864?\\uc2\\u7885?? m\\'92 \\{x\\}")}}}`;
    expect(parseEasyWorshipRtf(rtf)).toBe("Òrè òfé Ẹọ m’ {x}");
  });

  it("turns a whole EasyWorship song into its sections", () => {
    const rtf = `${EW_HEADER}{\\pard${line("Chorus 1")}${line("Come to my soul")}${line("Verse 1")}${line("Give me a love")}${line("Verse 2")}${line("Only a joy")}}\r\n}`;
    const [draft] = convertEasyWorshipRecordsToDrafts([{ rowid: 1, title: "A Heart Like Thine", author: "J. Van DeVenter", wordsRtf: rtf }]);
    expect(draft.sections.map((s) => [s.label, s.content])).toEqual([
      ["Chorus 1", "Come to my soul"],
      ["Verse 1", "Give me a love"],
      ["Verse 2", "Only a joy"],
    ]);
    expect(draft.artist).toBe("J. Van DeVenter");
  });
});
