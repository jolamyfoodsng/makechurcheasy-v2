/**
 * galleryLayouts.ts — JSON-driven Multi-View layout definitions
 *
 * Sources layouts from two places:
 *   1. All TEMPLATE_LIBRARY entries from templates.ts (auto-mapped)
 *   2. Extra hand-crafted gallery layouts (GALLERY_EXTRA)
 *
 * New layouts can be added without changing frontend code —
 * either append to GALLERY_EXTRA or add to TEMPLATE_LIBRARY.
 */

import { TEMPLATE_LIBRARY } from "./templates";
import type { TemplateDefinition } from "./types";

export type GalleryLayoutCategory =
  | "cameras"
  | "scripture"
  | "translation"
  | "speaker-focus"
  | "hybrid"
  | "multimedia"
  | "custom"
  | "added";

export interface GallerySlot {
  id: string;
  label: string;
  /** OBS source kind the slot expects */
  contentType: "camera" | "scripture" | "translation" | "lower-third" | "browser" | "image";
  /** Position on 1920×1080 canvas */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface GalleryLayout {
  id: string;
  name: string;
  description: string;
  category: GalleryLayoutCategory;
  slots: GallerySlot[];
  useCases: string[];
  /** Scene name prefix used when creating in OBS */
  scenePrefix: string;
  /** Optional frame defaults applied when this layout is selected in the dock. */
  defaultFrameId?: string | null;
  defaultSlotFrames?: Record<string, string>;
}

export const GALLERY_CATEGORIES: { key: GalleryLayoutCategory | "all"; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "apps" },
  { key: "added", label: "Added", icon: "check_circle" },
  { key: "cameras", label: "Multi-source", icon: "view_week" },
  { key: "scripture", label: "Scripture", icon: "menu_book" },
  { key: "translation", label: "Translation", icon: "translate" },
  { key: "speaker-focus", label: "Speaker Focus", icon: "person" },
  { key: "hybrid", label: "Combined", icon: "dashboard" },
  { key: "multimedia", label: "Media", icon: "perm_media" },
  { key: "custom", label: "Custom", icon: "tune" },
];

// ── Template → Gallery mapping helpers ─────────────────────────────────────

const CATEGORY_MAP: Record<string, GalleryLayoutCategory> = {
  sermon: "speaker-focus",
  worship: "hybrid",
  "multi-camera": "cameras",
  announcement: "custom",
  multimedia: "multimedia",
  ceremony: "hybrid",
  youth: "custom",
  kids: "custom",
};

/**
 * Gallery copy describes the arrangement, not the equipment a user may put
 * into it. The underlying template names stay unchanged for compatibility;
 * these names are used by the user-facing gallery and Dock list.
 */
const GALLERY_COPY_OVERRIDES: Record<string, Pick<GalleryLayout, "name" | "description">> = {
  "tpl_two-up-split": {
    name: "Two-Up Split",
    description: "Two equal content areas side by side. Choose the scenes or sources to place in each area.",
  },
  "tpl_pre-service": {
    name: "Centered Content",
    description: "A centered content area on a branded background for countdowns, welcome screens, or announcements.",
  },
  "tpl_quad": {
    name: "Four-Up Grid",
    description: "Four equal content areas for monitoring or side-by-side content.",
  },
  "tpl_sermon-scripture": {
    name: "Main Content + Scripture",
    description: "A large content area beside a Scripture or notes panel. Assign your own scenes to both areas.",
  },
  "tpl_three-up": {
    name: "Three-Up Columns",
    description: "Three equal content areas for monitoring or comparison.",
  },
  "tpl_six-up": {
    name: "Six-Up Grid",
    description: "Six equal content areas for monitoring multiple scenes at once.",
  },
  "tpl_multimedia-scene-portrait": {
    name: "Main + Portrait Panel",
    description: "A full-canvas area with a portrait panel for vertical media or a secondary scene.",
  },
  "tpl_multimedia-scene-half-left": {
    name: "Main + Left Panel",
    description: "A full-canvas area with a half-width panel on the left for secondary content.",
  },
};

const GALLERY_TAG_LABELS: Record<string, string> = {
  camera: "content",
  "multi-camera": "multi-source",
  logo: "overlay",
  branding: "overlays",
  scene: "content",
};

function mapContentType(regionType: string, name: string, slotLabel?: string): GallerySlot["contentType"] {
  const haystack = `${name} ${slotLabel || ""}`.toLowerCase();
  if (regionType === "image-overlay") return "image";
  if (regionType === "color") return "lower-third";
  if (regionType === "browser") return "browser";
  if (regionType === "media") return "camera";
  if (regionType === "video-input") return "camera";
  // obs-scene — infer from name
  if (/scripture|verse|bible|notes|liturgy|reading/.test(haystack)) return "scripture";
  if (/translation|lang(uage)?|caption|subtitle/.test(haystack)) return "translation";
  if (/lower.?third|name.?bar|info.?text|info.?strip|topic|hashtag/.test(haystack)) return "lower-third";
  if (/logo|photo|qr|frame|overlay|graphic/.test(haystack)) return "image";
  return "camera";
}

function getGallerySlotLabel(
  contentType: GallerySlot["contentType"],
  name: string,
  slotLabel?: string,
): string {
  const label = (slotLabel || name).trim();

  if (contentType === "camera" && /^(main|primary|full[- ]screen)\s+(source|slot)$/i.test(label)) {
    return "Main content";
  }

  if (contentType === "camera" && /camera/i.test(label)) {
    return label.replace(/camera/gi, "content");
  }

  if (contentType === "image" && /logo/i.test(label)) {
    const position = label.match(/top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right/i)?.[0];
    return position ? `${position.replace(/-/g, " ")} overlay` : "Overlay area";
  }

  return label;
}

function getGalleryUseCases(tags: string[]): string[] {
  return tags.slice(0, 3).map((tag) => GALLERY_TAG_LABELS[tag.toLowerCase()] ?? tag);
}

function templateToGalleryLayout(tpl: TemplateDefinition): GalleryLayout {
  const id = tpl.id.replace("tpl_", "");
  const copy = GALLERY_COPY_OVERRIDES[tpl.id];
  return {
    id,
    name: copy?.name ?? tpl.name,
    description: copy?.description ?? tpl.description,
    category: CATEGORY_MAP[tpl.category] || "custom",
    scenePrefix: `MultiView - ${tpl.name}`,
    useCases: getGalleryUseCases(tpl.tags),
    defaultFrameId: tpl.dockFrameId,
    defaultSlotFrames: tpl.dockSlotFrames
      ? Object.fromEntries(
          Object.entries(tpl.dockSlotFrames).map(([key, value]) => [key.replace(/^tpl_r_/, ""), value]),
        )
      : undefined,
    slots: tpl.regions.map((r) => ({
      id: r.id.replace("tpl_r_", ""),
      label: getGallerySlotLabel(
        mapContentType(r.type, r.name, r.slotLabel),
        r.name,
        r.slotLabel,
      ),
      contentType: mapContentType(r.type, r.name, r.slotLabel),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      zIndex: r.zIndex,
    })),
  };
}

// ── Auto-generated from templates.ts ───────────────────────────────────────

const GALLERY_FROM_TEMPLATES: GalleryLayout[] = TEMPLATE_LIBRARY.map(templateToGalleryLayout);

// ── Extra hand-crafted layouts (not in TEMPLATE_LIBRARY) ───────────────────

const GALLERY_EXTRA: GalleryLayout[] = [];

// ── Exported combined list ─────────────────────────────────────────────────

export const GALLERY_LAYOUTS: GalleryLayout[] = [
  ...GALLERY_FROM_TEMPLATES,
  ...GALLERY_EXTRA,
];
