import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../bible/bibleDb", () => ({ getCustomThemes: vi.fn(async () => []), saveCustomTheme: vi.fn() }));
vi.mock("../library/libraryDb", () => ({ getAllMedia: vi.fn(async () => []), patchMedia: vi.fn() }));
vi.mock("../library/mediaReferences", () => ({ copyReferenceIntoLibrary: vi.fn(), enrichReferenceItem: vi.fn(), importMediaPaths: vi.fn() }));
vi.mock("../services/overlayUrl", () => ({ getOverlayBaseUrl: vi.fn(async () => "http://127.0.0.1:1") }));

import { buildEasyWorshipThemes, type ImportedBackground } from "./easyWorshipAssetImport";

const IMAGES = "C:\\Users\\Public\\Documents\\Softouch\\Easyworship\\Default\\Resources\\Images\\";
const VIDEOS = "C:\\Users\\Public\\Documents\\Softouch\\Easyworship\\Default\\Resources\\Videos\\";

const backgrounds = new Map<string, ImportedBackground>([
  [`${IMAGES}ws_fall_aspen.jpg`.toLowerCase(), { kind: "image", url: "http://x/uploads/ref_a.jpg", filePath: "D:\\copies\\ref_a.jpg" }],
  [`${VIDEOS}communion.wmv`.toLowerCase(), { kind: "video", url: "http://x/uploads/ref_b.wmv", filePath: "D:\\copies\\ref_b.wmv" }],
]);

describe("EasyWorship themes", () => {
  it("makes one theme for a song theme and a scripture theme with the same background", () => {
    const themes = buildEasyWorshipThemes([
      { title: "Fall Aspen", kind: "song", mediaPath: `${IMAGES}ws_fall_aspen.jpg` },
      { title: "Fall Aspen", kind: "scripture", mediaPath: `${IMAGES}WS_FALL_ASPEN.jpg` },
    ], backgrounds);
    expect(themes).toHaveLength(1);
    expect(themes[0].categories).toEqual(["worship", "bible"]);
    expect(themes[0].settings).toMatchObject({
      backgroundType: "image",
      backgroundImage: "http://x/uploads/ref_a.jpg",
      backgroundImageFilePath: "D:\\copies\\ref_a.jpg",
    });
  });

  it("gives OBS the video file and keeps re-imports on the same theme id", () => {
    const records = [{ title: "Communion", kind: "song" as const, mediaPath: `${VIDEOS}communion.wmv` }];
    const [theme] = buildEasyWorshipThemes(records, backgrounds);
    expect(theme.settings).toMatchObject({ backgroundType: "video", backgroundVideoFilePath: "D:\\copies\\ref_b.wmv" });
    expect(buildEasyWorshipThemes(records, backgrounds)[0].id).toBe(theme.id);
  });

  it("falls back to the theme's colour, and leaves out themes with nothing to show", () => {
    const themes = buildEasyWorshipThemes([
      { title: "Missing Picture", kind: "song", mediaPath: `${IMAGES}gone.jpg`, color: "#102030" },
      { title: "Lower Transparent", kind: "song" },
    ], backgrounds);
    expect(themes.map((t) => [t.name, t.settings.backgroundType, t.settings.backgroundColor])).toEqual([
      ["Missing Picture", "color", "#102030"],
    ]);
  });
});
