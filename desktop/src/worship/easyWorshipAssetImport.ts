/**
 * easyWorshipAssetImport.ts — brings an EasyWorship profile's pictures, videos and themes into
 * MakeChurchEazy.
 *
 * read_easyworship_assets (src-tauri/src/lib.rs) lists them read-only. Pictures and videos are copied
 * into the media library, so they keep working when EasyWorship is removed. Each EasyWorship song or
 * scripture theme becomes a fullscreen theme with the same background. EasyWorship videos are often
 * .wmv, which OBS plays but the app's previews can't, so a theme's video also gets an MP4 copy for
 * the previews.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCustomThemes, saveCustomTheme } from "../bible/bibleDb";
import { DEFAULT_THEME_SETTINGS, type BibleTheme, type BibleThemeCategory, type BibleThemeSettings } from "../bible/types";
import { getAllMedia, patchMedia } from "../library/libraryDb";
import type { MediaItem } from "../library/libraryTypes";
import { copyReferenceIntoLibrary, enrichReferenceItem, importMediaPaths } from "../library/mediaReferences";
import { getOverlayBaseUrl } from "../services/overlayUrl";

export interface EasyWorshipMediaFile {
  title: string;
  path: string;
  kind: "image" | "video";
}

export interface EasyWorshipThemeRecord {
  title: string;
  kind: "song" | "scripture";
  mediaPath?: string | null;
  color?: string | null;
}

export interface EasyWorshipAssets {
  media: EasyWorshipMediaFile[];
  themes: EasyWorshipThemeRecord[];
}

/** A library item an EasyWorship file became, as a theme background needs it. */
export interface ImportedBackground {
  kind: "image" | "video";
  url: string;
  filePath: string;
  /** A browser-playable copy of a video, when the original isn't one. */
  previewUrl?: string;
}

export interface EasyWorshipLimits {
  images: number;
  videos: number;
  themes: number;
}

export interface EasyWorshipAssetSummary {
  mediaFound: number;
  mediaImported: number;
  mediaAlreadyInLibrary: number;
  mediaOverLimit: number;
  themesFound: number;
  themesImported: number;
  themesAlreadyThere: number;
  themesOverLimit: number;
}

const pathKey = (path: string) => path.replace(/\//g, "\\").toLowerCase();

const slug = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "theme";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * The MakeChurchEazy themes for EasyWorship's themes. A song theme and a scripture theme with the same
 * name and background become one theme for both. Themes whose picture or video wasn't imported fall
 * back to their colour, or are left out.
 */
export function buildEasyWorshipThemes(
  records: EasyWorshipThemeRecord[],
  backgrounds: Map<string, ImportedBackground>,
  now = new Date().toISOString(),
): BibleTheme[] {
  const byKey = new Map<string, { record: EasyWorshipThemeRecord; background?: ImportedBackground; categories: Set<BibleThemeCategory> }>();
  for (const record of records) {
    const background = record.mediaPath ? backgrounds.get(pathKey(record.mediaPath)) : undefined;
    if (!background && !record.color) continue;
    const key = `${slug(record.title)}-${slug(background ? fileName(background.filePath) : record.color ?? "")}`;
    const entry = byKey.get(key) ?? { record, background, categories: new Set<BibleThemeCategory>() };
    entry.categories.add(record.kind === "scripture" ? "bible" : "worship");
    byKey.set(key, entry);
  }

  return [...byKey].map(([key, { record, background, categories }]) => {
    const backgroundSettings: Partial<BibleThemeSettings> = !background
      ? { backgroundType: "color", backgroundColor: record.color ?? "#000000", backgroundImage: "", backgroundVideo: "" }
      : background.kind === "image"
        ? { backgroundType: "image", backgroundColor: "transparent", backgroundImage: background.url, backgroundImageFilePath: background.filePath, backgroundVideo: "" }
        : {
          backgroundType: "video",
          backgroundImage: "",
          backgroundVideo: background.previewUrl ?? background.url,
          backgroundVideoFilePath: background.filePath,
        };
    const list = [...categories].sort((a, b) => (a === "worship" ? -1 : b === "worship" ? 1 : 0));
    return {
      id: `easyworship-${key}`,
      name: record.title,
      description: "Imported from EasyWorship.",
      source: "custom",
      templateType: "fullscreen",
      category: list[0],
      categories: list,
      settings: { ...DEFAULT_THEME_SETTINGS, ...backgroundSettings },
      createdAt: now,
      updatedAt: now,
    } satisfies BibleTheme;
  });
}

/** Reads the profile's pictures, videos and themes (read-only). */
export function readEasyWorshipAssets(dataDir: string): Promise<EasyWorshipAssets> {
  return invoke<EasyWorshipAssets>("read_easyworship_assets", { folderPath: dataDir });
}

/**
 * Copies EasyWorship's pictures and videos into the media library and creates its themes.
 * Files and themes already imported are skipped, and the plan's limits are kept.
 */
export async function importEasyWorshipAssets(
  assets: EasyWorshipAssets,
  limits: EasyWorshipLimits,
  onProgress: (stage: string, fraction: number) => void,
): Promise<EasyWorshipAssetSummary> {
  const summary: EasyWorshipAssetSummary = {
    mediaFound: assets.media.length,
    mediaImported: 0,
    mediaAlreadyInLibrary: 0,
    mediaOverLimit: 0,
    themesFound: 0,
    themesImported: 0,
    themesAlreadyThere: 0,
    themesOverLimit: 0,
  };

  // Pictures and videos already imported (the library remembers where each came from).
  const backgrounds = new Map<string, ImportedBackground>();
  const asBackground = (item: MediaItem): ImportedBackground | null =>
    item.type === "image" || item.type === "video"
      ? { kind: item.type, url: item.url, filePath: item.filePath ?? item.originalPath ?? "" }
      : null;
  const existing = new Map<string, MediaItem>();
  for (const item of await getAllMedia()) {
    if (item.originalPath) existing.set(pathKey(item.originalPath), item);
  }

  const room = { image: limits.images, video: limits.videos };
  const toImport: EasyWorshipMediaFile[] = [];
  for (const file of assets.media) {
    const already = existing.get(pathKey(file.path));
    const background = already && asBackground(already);
    if (background) {
      backgrounds.set(pathKey(file.path), background);
      summary.mediaAlreadyInLibrary += 1;
    } else if (room[file.kind] > 0) {
      room[file.kind] -= 1;
      toImport.push(file);
    } else {
      summary.mediaOverLimit += 1;
    }
  }

  if (toImport.length) {
    onProgress(`Adding ${toImport.length} pictures and videos…`, 0);
    const { saved } = await importMediaPaths(toImport.map((f) => f.path));
    for (let i = 0; i < saved.length; i += 1) {
      let item = saved[i];
      const source = toImport.find((f) => pathKey(f.path) === pathKey(item.originalPath ?? ""));
      onProgress(`Copying pictures and videos… ${i + 1} of ${saved.length}`, (i + 1) / saved.length);
      try {
        // Copied now (not in the background) so themes point at MakeChurchEazy's own copy.
        item = (await copyReferenceIntoLibrary(item)) ?? item;
      } catch (error) {
        console.warn("[EasyWorship] Could not copy into the library, keeping a link to the file:", error);
      }
      if (source?.title && source.title !== item.name) {
        item = (await patchMedia(item.id, { name: source.title })) ?? item;
      }
      void enrichReferenceItem(item);
      const background = asBackground(item);
      if (background && item.originalPath) backgrounds.set(pathKey(item.originalPath), background);
      summary.mediaImported += 1;
    }
  }

  // Themes.
  const themes = buildEasyWorshipThemes(assets.themes, backgrounds);
  summary.themesFound = themes.length;
  const existingThemeIds = new Set((await getCustomThemes()).map((t) => t.id));
  let themeRoom = limits.themes;
  const overlayBase = themes.some((t) => t.settings.backgroundType === "video") ? await getOverlayBaseUrl() : "";
  for (let i = 0; i < themes.length; i += 1) {
    const theme = themes[i];
    if (existingThemeIds.has(theme.id)) {
      summary.themesAlreadyThere += 1;
      continue;
    }
    if (themeRoom <= 0) {
      summary.themesOverLimit += 1;
      continue;
    }
    onProgress(`Creating themes… ${i + 1} of ${themes.length}`, (i + 1) / themes.length);
    if (theme.settings.backgroundType === "video") {
      theme.settings.backgroundVideo = await playableVideoUrl(theme.settings.backgroundVideo, overlayBase);
    }
    await saveCustomTheme(theme);
    themeRoom -= 1;
    summary.themesImported += 1;
  }
  if (summary.themesImported) {
    try {
      window.dispatchEvent(new Event("obs-themes-updated"));
    } catch {}
  }
  return summary;
}

/** An MP4 the app's previews can play, made with the bundled FFmpeg when the video isn't one already. */
async function playableVideoUrl(url: string, overlayBase: string): Promise<string> {
  const name = decodeURIComponent(url.split("/uploads/").pop() ?? "");
  if (!name || name === url) return url;
  try {
    const prepared = await invoke<{ fileName: string }>("prepare_studio_video_for_program", { fileName: name });
    return `${overlayBase}/uploads/${encodeURIComponent(prepared.fileName)}`;
  } catch (error) {
    console.warn("[EasyWorship] Could not make a preview copy of a theme video:", error);
    return url;
  }
}
