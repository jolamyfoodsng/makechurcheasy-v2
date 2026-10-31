/**
 * Built-in Multi-View Template Definitions
 *
 * Professional church broadcast templates with region constraints.
 * Templates define slots — users pick a preset and the app
 * instantly generates a ready-to-use multiview scene.
 *
 * Background is always the base slot (edge-to-edge, z=0).
 * Content regions start at z=1 and respect the safe frame.
 */

import {
  DEFAULT_BACKGROUND,
  DEFAULT_SAFE_FRAME,
  DEFAULT_CONSTRAINTS,
  type TemplateDefinition,
  type TemplateId,
  type RegionId,
  type Region,
  type CanvasConfig,
  type BackgroundConfig,
  type SafeFrameConfig,
  type RegionConstraints,
  type MVLayout,
  type LayoutId,
} from "./types";
const HD: CanvasConfig = { width: 1920, height: 1080, label: "1080p (16:9)" };

function tId(slug: string): TemplateId {
  return `tpl_${slug}` as TemplateId;
}
function rId(slug: string): RegionId {
  return `tpl_r_${slug}` as RegionId;
}

// ---------------------------------------------------------------------------
// Helper: create a region with constraints
// ---------------------------------------------------------------------------

function slot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: Record<string, any> & {
    id: RegionId;
    type: Region["type"];
    name: string;
  }
): Region {
  const base = {
    x: 0,
    y: 0,
    width: 960,
    height: 540,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    visible: true,
    borderRadius: 0,
    constraints: { ...DEFAULT_CONSTRAINTS },
  };

  const { type, constraints: cOverrides, ...rest } = overrides;
  const merged = { ...base, ...rest };

  // Apply constraint overrides
  if (cOverrides) {
    merged.constraints = { ...merged.constraints, ...cOverrides };
  }

  switch (type) {
    case "obs-scene":
      return {
        ...merged,
        type,
        sceneName: "",
        sceneIndex: -1,
        ...rest,
        constraints: merged.constraints,
      } as Region;
    case "video-input":
      return {
        ...merged,
        type,
        inputName: "",
        ...rest,
        constraints: merged.constraints,
      } as Region;
    case "image-overlay":
      return {
        type,
        ...merged,
        src: "",
        objectFit: "cover" as const,
        ...rest,
        constraints: merged.constraints,
      } as Region;
    case "media":
      return {
        type,
        ...merged,
        src: "",
        loop: true,
        objectFit: "cover" as const,
        ...rest,
        constraints: merged.constraints,
      } as Region;
    case "browser":
      return {
        type,
        ...merged,
        url: "",
        ...rest,
        constraints: merged.constraints,
      } as Region;
    case "color":
      return {
        type,
        ...merged,
        color: "#000000",
        ...rest,
        constraints: merged.constraints,
      } as Region;
    default:
      return { type, ...merged, constraints: merged.constraints } as unknown as Region;
  }
}

// ---------------------------------------------------------------------------
// Shared constraint presets
// ---------------------------------------------------------------------------

/** Main camera slot — locked position, resizable from edges, can't delete */
const CAMERA_CONSTRAINTS: Partial<RegionConstraints> = {
  lockPosition: true,
  lockSize: false,
  lockDelete: true,
  allowedContentTypes: ["obs-scene", "video-input", "media", "browser"],
  editableStyles: ["opacity", "borderRadius"],
};

/** Lower-third bar — locked position, resizable from edges, can't delete */
const LOWER_THIRD_CONSTRAINTS: Partial<RegionConstraints> = {
  lockPosition: true,
  lockSize: false,
  lockDelete: true,
  allowedContentTypes: ["obs-scene", "color", "browser", "image-overlay"],
  editableStyles: ["opacity", "color"],
};

/** Logo slot — locked position, resizable from edges, can't delete */
const LOGO_CONSTRAINTS: Partial<RegionConstraints> = {
  lockPosition: true,
  lockSize: false,
  lockDelete: true,
  allowedContentTypes: ["image-overlay", "browser"],
  editableStyles: ["opacity"],
};

/** Content area — locked position, resizable from edges, can't delete */
const CONTENT_CONSTRAINTS: Partial<RegionConstraints> = {
  lockPosition: true,
  lockSize: false,
  lockDelete: true,
  allowedContentTypes: ["obs-scene", "browser", "image-overlay", "media"],
  editableStyles: ["opacity", "borderRadius"],
};

// ---------------------------------------------------------------------------
// Background Presets
// ---------------------------------------------------------------------------

const DARK_BG: BackgroundConfig = {
  ...DEFAULT_BACKGROUND,
  color: "#0a0a14",
};

const DEEP_BLUE_BG: BackgroundConfig = {
  ...DEFAULT_BACKGROUND,
  color: "#0d1b2a",
};

const WARM_DARK_BG: BackgroundConfig = {
  ...DEFAULT_BACKGROUND,
  color: "#1a1412",
};

const SLATE_BG: BackgroundConfig = {
  ...DEFAULT_BACKGROUND,
  color: "#16213e",
};

// ---------------------------------------------------------------------------
// Safe Frame Presets
// ---------------------------------------------------------------------------

const STANDARD_SF: SafeFrameConfig = { ...DEFAULT_SAFE_FRAME };

const TIGHT_SF: SafeFrameConfig = {
  ...DEFAULT_SAFE_FRAME,
  top: 40,
  right: 40,
  bottom: 40,
  left: 40,
};

const NO_SF: SafeFrameConfig = {
  ...DEFAULT_SAFE_FRAME,
  enabled: false,
  visible: false,
};

// ---------------------------------------------------------------------------
// Template Definitions
// ---------------------------------------------------------------------------

const RAW_TEMPLATE_LIBRARY: TemplateDefinition[] = [
  // ── 1. Full Camera ──


  // ── 2. Sermon + Lower Third ──
  {
    id: tId("sermon-lower-third"),
    name: "Sermon + Lower Third",
    description:
      "Full camera with a lower-third bar for speaker name, scripture, or announcements.",
    category: "sermon",
    icon: "subtitles",
    canvas: HD,
    background: DARK_BG,
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("slt-cam"),
        type: "obs-scene",
        name: "Main Slot",
        slotLabel: "Primary Source",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        zIndex: 1,
        constraints: {
          lockPosition: true,
          lockSize: true,
          lockDelete: true,
          allowedContentTypes: ["obs-scene", "video-input", "media"],
          editableStyles: [],
        },
      }),
      slot({
        id: rId("slt-bar"),
        type: "color",
        name: "Name Bar",
        slotLabel: "Lower Third Background",
        x: 0,
        y: 880,
        width: 700,
        height: 80,
        zIndex: 2,
        color: "rgba(0,120,212,0.85)",
        borderRadius: 0,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("slt-text"),
        type: "obs-scene",
        name: "Lower Third",
        slotLabel: "Lower Third Content",
        x: 20,
        y: 890,
        width: 660,
        height: 60,
        zIndex: 3,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
    ],
    tags: ["sermon", "lower-third", "name", "speaker"],
    accentColor: "#0078d4",
  },

  // ── 5. Two-Up Split ──
  {
    id: tId("two-up-split"),
    name: "Two-Up Split",
    description: "50/50 split: two scenes side by side. Great for interviews or dual cameras.",
    category: "multi-camera",
    icon: "view_column",
    canvas: HD,
    background: DEEP_BLUE_BG,
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("2s-left"),
        type: "obs-scene",
        name: "Left Slot",
        slotLabel: "Left",
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 1,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("2s-right"),
        type: "obs-scene",
        name: "Right Slot",
        slotLabel: "Right",
        x: 960,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 2,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
    ],
    tags: ["2-up", "split", "interview", "dual", "side-by-side"],
    accentColor: "#00cec9",
  },

  // ── 6. Pre-Service / Countdown ──
  {
    id: tId("pre-service"),
    name: "Pre-Service",
    description:
      "Centered content area on a branded background. Perfect for countdown timers or welcome screens.",
    category: "announcement",
    icon: "timer",
    canvas: HD,
    background: SLATE_BG,
    safeFrame: STANDARD_SF,
    regions: [
      slot({
        id: rId("ps-content"),
        type: "obs-scene",
        name: "Content",
        slotLabel: "Countdown / Welcome",
        x: 280,
        y: 160,
        width: 1360,
        height: 760,
        zIndex: 1,
        borderRadius: 12,
        constraints: CONTENT_CONSTRAINTS,
      }),
      slot({
        id: rId("ps-logo"),
        type: "image-overlay",
        name: "Logo",
        slotLabel: "Church Logo",
        x: 810,
        y: 40,
        width: 300,
        height: 100,
        zIndex: 2,
        constraints: LOGO_CONSTRAINTS,
      }),
    ],
    tags: ["pre-service", "countdown", "welcome", "timer"],
    accentColor: "#fdcb6e",
  },

  // ── 7. Quad View ──
  {
    id: tId("quad"),
    name: "Quad View",
    description: "Four equal quadrants for multi-camera monitoring.",
    category: "multi-camera",
    icon: "grid_view",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a0a" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("q-tl"),
        type: "obs-scene",
        name: "Top-Left Slot",
        slotLabel: "Top Left",
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        zIndex: 1,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("q-tr"),
        type: "obs-scene",
        name: "Top-Right Slot",
        slotLabel: "Top Right",
        x: 960,
        y: 0,
        width: 960,
        height: 540,
        zIndex: 2,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("q-bl"),
        type: "obs-scene",
        name: "Bottom-Left Slot",
        slotLabel: "Bottom Left",
        x: 0,
        y: 540,
        width: 960,
        height: 540,
        zIndex: 3,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("q-br"),
        type: "obs-scene",
        name: "Bottom-Right Slot",
        slotLabel: "Bottom Right",
        x: 960,
        y: 540,
        width: 960,
        height: 540,
        zIndex: 4,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
    ],
    tags: ["quad", "4-up", "multi-camera", "monitoring"],
    accentColor: "#a29bfe",
  },

  // ── 8. Sermon + Scripture Side Panel ──
  {
    id: tId("sermon-scripture"),
    name: "Sermon + Scripture",
    description:
      "Camera on the left with a scripture/notes panel on the right. Ideal for teaching.",
    category: "sermon",
    icon: "menu_book",
    canvas: HD,
    background: WARM_DARK_BG,
    safeFrame: STANDARD_SF,
    regions: [
      slot({
        id: rId("ss-cam"),
        type: "obs-scene",
        name: "Speaker Slot",
        slotLabel: "Speaker Source",
        x: 0,
        y: 0,
        width: 1280,
        height: 1080,
        zIndex: 1,
        borderRadius: 10,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("ss-scripture"),
        type: "obs-scene",
        name: "Scripture",
        slotLabel: "Scripture / Notes",
        x: 1280,
        y: 0,
        width: 640,
        height: 1080,
        zIndex: 2,
        borderRadius: 10,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["sermon", "scripture", "teaching", "notes", "side-panel"],
    accentColor: "#f9a825",
  },

  // ── 10. Three-Up ──
  {
    id: tId("three-up"),
    name: "Three-Up",
    description: "Three equal columns for multi-source monitoring or side-by-side comparison.",
    category: "multi-camera",
    icon: "view_week",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0d0d1a" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("3u-1"),
        type: "obs-scene",
        name: "Left Slot",
        slotLabel: "Left",
        x: 0,
        y: 0,
        width: 640,
        height: 1080,
        zIndex: 1,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("3u-2"),
        type: "obs-scene",
        name: "Center Slot",
        slotLabel: "Center",
        x: 640,
        y: 0,
        width: 640,
        height: 1080,
        zIndex: 2,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("3u-3"),
        type: "obs-scene",
        name: "Right Slot",
        slotLabel: "Right",
        x: 1280,
        y: 0,
        width: 640,
        height: 1080,
        zIndex: 3,
        borderRadius: 6,
        constraints: CAMERA_CONSTRAINTS,
      }),
    ],
    tags: ["3-up", "triple", "multi-camera", "comparison"],
    accentColor: "#55efc4",
  },

  // ── 18. Camera + Logo + Lower Third ──
  {
    id: tId("logo-lower-third"),
    name: "Camera + Logo + Lower Third",
    description: "Full camera with top-right logo and a lower-third bar. Branded sermon view.",
    category: "sermon",
    icon: "branding_watermark",
    canvas: HD,
    background: DARK_BG,
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("llt-cam"),
        type: "obs-scene",
        name: "Full-Screen Slot",
        slotLabel: "Main Source",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 1,
        constraints: { lockPosition: true, lockSize: true, lockDelete: true, allowedContentTypes: ["obs-scene", "video-input", "media"], editableStyles: [] },
      }),
      slot({
        id: rId("llt-logo"),
        type: "image-overlay",
        name: "Logo (TR)",
        slotLabel: "Logo",
        x: 1700, y: 40, width: 180, height: 80, zIndex: 4,
        constraints: { ...LOGO_CONSTRAINTS, lockPosition: false },
      }),
      slot({
        id: rId("llt-bar"),
        type: "color",
        name: "Name Bar",
        slotLabel: "Lower Third Background",
        x: 0, y: 880, width: 700, height: 80, zIndex: 2,
        color: "rgba(0,120,212,0.85)",
        borderRadius: 0,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("llt-text"),
        type: "obs-scene",
        name: "Lower Third",
        slotLabel: "Lower Third Content",
        x: 20, y: 890, width: 660, height: 60, zIndex: 3,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
    ],
    tags: ["logo", "lower-third", "branded", "sermon"],
    accentColor: "#fab1a0",
  },

  // ════════════════════════════════════════════════════════════
  //  Church Ceremony Templates
  // ════════════════════════════════════════════════════════════

  // ── 20. Baptism ──
  {
    id: tId("baptism"),
    name: "Baptism",
    description: "Wide shot with a name/verse overlay bar and logo. Perfect for baptism services.",
    category: "ceremony",
    icon: "water_drop",
    canvas: HD,
    background: DEEP_BLUE_BG,
    safeFrame: STANDARD_SF,
    regions: [
      slot({
        id: rId("bap-cam"),
        type: "obs-scene",
        name: "Pool Camera",
        slotLabel: "Main Camera",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 1,
        constraints: { lockPosition: true, lockSize: true, lockDelete: true, allowedContentTypes: ["obs-scene", "video-input", "media"], editableStyles: [] },
      }),
      slot({
        id: rId("bap-bar"),
        type: "color",
        name: "Name Bar",
        slotLabel: "Name Overlay Background",
        x: 0, y: 860, width: 1920, height: 220, zIndex: 2,
        color: "rgba(13,27,42,0.80)",
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("bap-text"),
        type: "obs-scene",
        name: "Name Overlay",
        slotLabel: "Name / Verse",
        x: 80, y: 880, width: 1760, height: 160, zIndex: 3,
        constraints: CONTENT_CONSTRAINTS,
      }),
      slot({
        id: rId("bap-logo"),
        type: "image-overlay",
        name: "Logo",
        slotLabel: "Church Logo",
        x: 1700, y: 40, width: 180, height: 80, zIndex: 4,
        constraints: { ...LOGO_CONSTRAINTS, lockPosition: false },
      }),
    ],
    tags: ["baptism", "ceremony", "water", "name"],
    accentColor: "#74b9ff",
  },

  // ── 23. Funeral / Memorial ──
  {
    id: tId("funeral"),
    name: "Memorial Service",
    description: "Respectful single-camera layout with photo/tribute panel and subdued styling.",
    category: "ceremony",
    icon: "local_florist",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#12141a" },
    safeFrame: STANDARD_SF,
    regions: [
      slot({
        id: rId("fun-cam"),
        type: "obs-scene",
        name: "Service Camera",
        slotLabel: "Main Camera",
        x: 40, y: 40, width: 1200, height: 1000, zIndex: 1,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("fun-tribute"),
        type: "obs-scene",
        name: "Tribute",
        slotLabel: "Photo / Slideshow",
        x: 1280, y: 40, width: 600, height: 600, zIndex: 2,
        borderRadius: 8,
        constraints: CONTENT_CONSTRAINTS,
      }),
      slot({
        id: rId("fun-name"),
        type: "obs-scene",
        name: "Name & Dates",
        slotLabel: "Name Overlay",
        x: 1280, y: 670, width: 600, height: 370, zIndex: 3,
        borderRadius: 8,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["funeral", "memorial", "ceremony", "tribute"],
    accentColor: "#636e72",
  },

  // ── 24. Baby Dedication ──
  {
    id: tId("baby-dedication"),
    name: "Baby Dedication",
    description: "Warm layout with camera, family name lower-third, and a photo overlay slot.",
    category: "ceremony",
    icon: "child_friendly",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#1a1828" },
    safeFrame: STANDARD_SF,
    regions: [
      slot({
        id: rId("bd-cam"),
        type: "obs-scene",
        name: "Stage Camera",
        slotLabel: "Main Camera",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 1,
        constraints: { lockPosition: true, lockSize: true, lockDelete: true, allowedContentTypes: ["obs-scene", "video-input", "media"], editableStyles: [] },
      }),
      slot({
        id: rId("bd-bar"),
        type: "color",
        name: "Family Name Bar",
        slotLabel: "Name Background",
        x: 0, y: 880, width: 800, height: 80, zIndex: 2,
        color: "rgba(108,92,231,0.85)",
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("bd-text"),
        type: "obs-scene",
        name: "Family Name",
        slotLabel: "Family / Child Name",
        x: 20, y: 890, width: 760, height: 60, zIndex: 3,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("bd-photo"),
        type: "image-overlay",
        name: "Baby Photo",
        slotLabel: "Photo Overlay",
        x: 1560, y: 40, width: 320, height: 320, zIndex: 4,
        borderRadius: 160,
        constraints: { ...CONTENT_CONSTRAINTS, lockDelete: false },
      }),
    ],
    tags: ["baby", "dedication", "ceremony", "family"],
    accentColor: "#60A5FA",
  },

  // ════════════════════════════════════════════════════════════
  //  Worship-Specific Templates
  // ════════════════════════════════════════════════════════════

  // ── 26. Worship Full-Screen Lyrics ──
  {
    id: tId("worship-lyrics-full"),
    name: "Full-Screen Lyrics",
    description: "Full-screen lyrics/slides overlay on a background. For projection and stream.",
    category: "worship",
    icon: "text_fields",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a1a" },
    safeFrame: NO_SF,
    regions: [
      slot({
        id: rId("wlf-bg"),
        type: "obs-scene",
        name: "Background Media",
        slotLabel: "Background Video / Image",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 1,
        constraints: { lockPosition: true, lockSize: true, lockDelete: true, allowedContentTypes: ["obs-scene", "media", "image-overlay"], editableStyles: ["opacity"] },
      }),
      slot({
        id: rId("wlf-lyrics"),
        type: "obs-scene",
        name: "Lyrics",
        slotLabel: "Lyrics / ProPresenter",
        x: 80, y: 640, width: 1760, height: 380, zIndex: 2,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["worship", "lyrics", "full-screen", "propresenter"],
    accentColor: "#81ecec",
  },

  // ════════════════════════════════════════════════════════════
  //  Sermon-Specific Templates
  // ════════════════════════════════════════════════════════════

  // ── 27. Panel Discussion ──
  {
    id: tId("panel-discussion"),
    name: "Panel Discussion",
    description: "Two or three speakers in a horizontal strip with name bars. For Bible study panels.",
    category: "sermon",
    icon: "groups",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0f0f1e" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("pd-1"),
        type: "obs-scene",
        name: "Speaker 1",
        slotLabel: "Left Speaker",
        x: 20, y: 60, width: 616, height: 820, zIndex: 1,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("pd-2"),
        type: "obs-scene",
        name: "Speaker 2",
        slotLabel: "Center Speaker",
        x: 652, y: 60, width: 616, height: 820, zIndex: 2,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("pd-3"),
        type: "obs-scene",
        name: "Speaker 3",
        slotLabel: "Right Speaker",
        x: 1284, y: 60, width: 616, height: 820, zIndex: 3,
        borderRadius: 8,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("pd-bar"),
        type: "color",
        name: "Bottom Bar",
        slotLabel: "Topic / Names Bar",
        x: 0, y: 900, width: 1920, height: 180, zIndex: 4,
        color: "rgba(15,15,30,0.90)",
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("pd-text"),
        type: "obs-scene",
        name: "Topic Text",
        slotLabel: "Topic / Names Overlay",
        x: 80, y: 920, width: 1760, height: 140, zIndex: 5,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["panel", "discussion", "bible-study", "speakers", "3-up"],
    accentColor: "#ffeaa7",
  },

  // ════════════════════════════════════════════════════════════
  //  Youth & Kids Ministry Templates
  // ════════════════════════════════════════════════════════════

  // ── 33. Youth Service ──
  {
    id: tId("youth-service"),
    name: "Youth Service",
    description: "Energetic layout with main camera, social feed panel, and vibrant branding strip.",
    category: "youth",
    icon: "groups",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#1a0a2e" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("ys-cam"),
        type: "obs-scene",
        name: "Stage Camera",
        slotLabel: "Main Camera",
        x: 20, y: 20, width: 1380, height: 850, zIndex: 1,
        borderRadius: 12,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("ys-social"),
        type: "obs-scene",
        name: "Social Feed",
        slotLabel: "Social / Chat Feed",
        x: 1420, y: 20, width: 480, height: 1040, zIndex: 2,
        borderRadius: 12,
        constraints: CONTENT_CONSTRAINTS,
      }),
      slot({
        id: rId("ys-bar"),
        type: "color",
        name: "Bottom Strip",
        slotLabel: "Info Strip",
        x: 20, y: 890, width: 1380, height: 170, zIndex: 3,
        color: "rgba(108,92,231,0.9)",
        borderRadius: 12,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("ys-text"),
        type: "obs-scene",
        name: "Info Text",
        slotLabel: "Hashtag / Series Name",
        x: 40, y: 910, width: 1340, height: 130, zIndex: 4,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["youth", "teens", "energetic", "social", "vibrant"],
    accentColor: "#3B82F6",
  },

  // ── 34. Youth Game Night ──
  {
    id: tId("youth-game"),
    name: "Youth Game Night",
    description: "Fun layout with scoreboard, two team cameras, and game graphics overlay.",
    category: "youth",
    icon: "sports_esports",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a1e" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("yg-team1"),
        type: "obs-scene",
        name: "Team 1",
        slotLabel: "Team 1 Camera",
        x: 20, y: 20, width: 930, height: 720, zIndex: 1,
        borderRadius: 10,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("yg-team2"),
        type: "obs-scene",
        name: "Team 2",
        slotLabel: "Team 2 Camera",
        x: 970, y: 20, width: 930, height: 720, zIndex: 2,
        borderRadius: 10,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("yg-score"),
        type: "obs-scene",
        name: "Scoreboard",
        slotLabel: "Score / Game Overlay",
        x: 340, y: 760, width: 1240, height: 280, zIndex: 3,
        borderRadius: 12,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["youth", "game", "night", "scoreboard", "teams"],
    accentColor: "#e17055",
  },

  // ── 35. Kids Church ──
  {
    id: tId("kids-church"),
    name: "Kids Church",
    description: "Friendly layout with large camera, fun graphic panel, and big colorful lower-third.",
    category: "kids",
    icon: "child_care",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#1a1040" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({
        id: rId("kc-cam"),
        type: "obs-scene",
        name: "Kids Stage",
        slotLabel: "Main Camera",
        x: 20, y: 20, width: 1340, height: 800, zIndex: 1,
        borderRadius: 16,
        constraints: CAMERA_CONSTRAINTS,
      }),
      slot({
        id: rId("kc-graphic"),
        type: "obs-scene",
        name: "Fun Graphics",
        slotLabel: "Graphics / Animation",
        x: 1380, y: 20, width: 520, height: 800, zIndex: 2,
        borderRadius: 16,
        constraints: CONTENT_CONSTRAINTS,
      }),
      slot({
        id: rId("kc-bar"),
        type: "color",
        name: "Info Bar",
        slotLabel: "Info Background",
        x: 20, y: 840, width: 1880, height: 220, zIndex: 3,
        color: "rgba(255,159,67,0.90)",
        borderRadius: 16,
        constraints: LOWER_THIRD_CONSTRAINTS,
      }),
      slot({
        id: rId("kc-text"),
        type: "obs-scene",
        name: "Info Text",
        slotLabel: "Lesson Title / Memory Verse",
        x: 60, y: 860, width: 1800, height: 180, zIndex: 4,
        constraints: CONTENT_CONSTRAINTS,
      }),
    ],
    tags: ["kids", "children", "church", "fun", "colorful"],
    accentColor: "#ff9f43",
  },

  // ── 36. Kids Puppet Show ──
  {
    id: tId("kids-puppet"),
    name: "Kids Puppet Show",
    description: "Full-screen puppet stage with a decorative frame overlay. Fun and immersive.",
    category: "kids",
    icon: "theater_comedy",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a14" },
    safeFrame: NO_SF,
    regions: [
      slot({
        id: rId("kp-stage"),
        type: "obs-scene",
        name: "Puppet Stage",
        slotLabel: "Stage Camera",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 1,
        constraints: { lockPosition: true, lockSize: true, lockDelete: true, allowedContentTypes: ["obs-scene", "video-input", "media"], editableStyles: [] },
      }),
      slot({
        id: rId("kp-frame"),
        type: "image-overlay",
        name: "Stage Frame",
        slotLabel: "Decorative Frame Overlay",
        x: 0, y: 0, width: 1920, height: 1080, zIndex: 2,
        constraints: { ...CONTENT_CONSTRAINTS, lockPosition: true, lockSize: true },
      }),
    ],
    tags: ["kids", "puppet", "show", "theater", "fun"],
    accentColor: "#fd79a8",
  },

  // ════════════════════════════════════════════════════════════
  //  Multi-Camera Advanced Templates
  // ════════════════════════════════════════════════════════════

  // ── 37. Six-Up Monitoring ──
  {
    id: tId("six-up"),
    name: "Six-Up Monitoring",
    description: "Six camera feeds in a 3×2 grid. Full multi-cam monitoring wall.",
    category: "multi-camera",
    icon: "grid_on",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a0a" },
    safeFrame: TIGHT_SF,
    regions: [
      slot({ id: rId("6u-1"), type: "obs-scene", name: "Cam 1", slotLabel: "Camera 1", x: 0, y: 0, width: 640, height: 540, zIndex: 1, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
      slot({ id: rId("6u-2"), type: "obs-scene", name: "Cam 2", slotLabel: "Camera 2", x: 640, y: 0, width: 640, height: 540, zIndex: 2, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
      slot({ id: rId("6u-3"), type: "obs-scene", name: "Cam 3", slotLabel: "Camera 3", x: 1280, y: 0, width: 640, height: 540, zIndex: 3, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
      slot({ id: rId("6u-4"), type: "obs-scene", name: "Cam 4", slotLabel: "Camera 4", x: 0, y: 540, width: 640, height: 540, zIndex: 4, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
      slot({ id: rId("6u-5"), type: "obs-scene", name: "Cam 5", slotLabel: "Camera 5", x: 640, y: 540, width: 640, height: 540, zIndex: 5, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
      slot({ id: rId("6u-6"), type: "obs-scene", name: "Cam 6", slotLabel: "Camera 6", x: 1280, y: 540, width: 640, height: 540, zIndex: 6, borderRadius: 4, constraints: CAMERA_CONSTRAINTS }),
    ],
    tags: ["6-up", "monitoring", "multi-camera", "grid", "wall"],
    accentColor: "#b2bec3",
  },

  // ── 39. Multimedia — Scene Portrait ──
  {
    id: tId("multimedia-scene-portrait"),
    name: "Multimedia: Scene Portrait",
    description:
      "A full-canvas scene with a framed portrait or short-form scene anchored on the left.",
    category: "multimedia",
    icon: "perm_media",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a14" },
    safeFrame: NO_SF,
    regions: [
      slot({
        id: rId("multimedia-background"),
        type: "obs-scene",
        name: "Background Scene",
        slotLabel: "Background Scene",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        zIndex: 1,
        constraints: {
          lockPosition: true,
          lockSize: true,
          lockDelete: true,
          allowedContentTypes: ["obs-scene"],
          editableStyles: [],
        },
      }),
      slot({
        id: rId("multimedia-portrait"),
        type: "obs-scene",
        name: "Portrait Scene",
        slotLabel: "Portrait / Short-form Scene",
        x: 72,
        y: 72,
        width: 520,
        height: 936,
        zIndex: 2,
        borderRadius: 24,
        constraints: {
          lockPosition: true,
          lockSize: false,
          lockDelete: true,
          minWidth: 240,
          minHeight: 426,
          maxWidth: 760,
          maxHeight: 1000,
          allowedContentTypes: ["obs-scene"],
          editableStyles: ["opacity", "borderRadius"],
        },
      }),
    ],
    tags: ["multimedia", "portrait", "short-form", "scene", "vertical"],
    accentColor: "#7c3aed",
    // The dock applies this frame only to the portrait slot. The background
    // remains a clean full-canvas scene behind it.
    dockFrameId: "clean-white-round",
    dockSlotFrames: {
      [rId("multimedia-background")]: "none",
      [rId("multimedia-portrait")]: "inherit",
    },
  },

  // ── 40. Multimedia — Left Feature ──
  {
    id: tId("multimedia-scene-half-left"),
    name: "Multimedia: Left Feature",
    description:
      "A full-canvas background scene with a featured scene filling the left half of the screen.",
    category: "multimedia",
    icon: "perm_media",
    canvas: HD,
    background: { ...DEFAULT_BACKGROUND, color: "#0a0a14" },
    safeFrame: NO_SF,
    regions: [
      slot({
        id: rId("multimedia-half-background"),
        type: "obs-scene",
        name: "Background Scene",
        slotLabel: "Background Scene",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        zIndex: 1,
        constraints: {
          lockPosition: true,
          lockSize: true,
          lockDelete: true,
          allowedContentTypes: ["obs-scene"],
          editableStyles: [],
        },
      }),
      slot({
        id: rId("multimedia-half-left"),
        type: "obs-scene",
        name: "Left Half Scene",
        slotLabel: "Left Half Landscape Scene",
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 2,
        borderRadius: 0,
        constraints: {
          lockPosition: true,
          lockSize: true,
          lockDelete: true,
          allowedContentTypes: ["obs-scene"],
          editableStyles: ["opacity", "borderRadius"],
        },
      }),
    ],
    tags: ["multimedia", "landscape", "half-screen", "scene", "split-screen"],
    accentColor: "#ea580c",
    // Keep the background unframed and frame the left-half scene only.
    dockFrameId: "broadcast-gold",
    dockSlotFrames: {
      [rId("multimedia-half-background")]: "none",
      [rId("multimedia-half-left")]: "inherit",
    },
  },

  // ════════════════════════════════════════════════════════════
  // Future Premium Church Templates
  // ════════════════════════════════════════════════════════════

  // TODO Templates to implement:
  // - Sign Language Interpreter
  // - Worship Lyrics Premium
  // - Vertical Stream (9:16)
  // - Speaker + Slides + Notes
  // - Building Fund Campaign
  // - Live Prayer Request Feed
  // - Conference Speaker + Translator
  // - Multi-Campus Broadcast
  // - Social Media CTA Premium
  // - Confidence Monitor Pro
  // - Scripture Focus
  // - Scripture Comparison
  // - Prayer Hotline
  // - Intercession Room
  // - Choir Feature
  // - Instrument Feature
  // - Worship Night
  // - Campus Broadcast
  // - Branch Roll Call
  // - Thanksgiving Service
  // - Ordination Service
  // - Holy Ghost Service
  // - Mission Giving
  // - Partner Sunday
];

// These presets are no longer offered in either the Multi-View gallery or the
// OBS Dock. Keep their definitions above for backwards compatibility with
// layouts users may already have saved, but remove them from every new
// template/catalog consumer through this shared library.
const REMOVED_TEMPLATE_IDS = new Set([
  "tpl_worship",
  "tpl_pre-service",
  "tpl_baptism",
  "tpl_funeral",
  "tpl_worship-lyrics-full",
  "tpl_panel-discussion",
  "tpl_main-two-inserts",
  "tpl_youth-game",
  "tpl_kids-puppet",
  "tpl_youth-service",
]);

export const TEMPLATE_LIBRARY: TemplateDefinition[] = RAW_TEMPLATE_LIBRARY.filter((template) =>
  !REMOVED_TEMPLATE_IDS.has(template.id) &&
  !template.tags.some((tag) => tag.toLowerCase() === "lower-third") &&
  !/lower\s+third/i.test(template.name) &&
  !/lower-third/i.test(template.description),
);

// ---------------------------------------------------------------------------
// Create an MVLayout from a TemplateDefinition
// ---------------------------------------------------------------------------

export function createLayoutFromTemplate(
  template: TemplateDefinition,
  name?: string
): MVLayout {
  // Generate a unique layout ID without depending on nanoid's top-level
  // ESM import, which can fail on Windows CEF and kill the entire module
  // (including TEMPLATE_LIBRARY).
  const layoutId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` as LayoutId;
  const now = new Date().toISOString();

  // Clone regions with fresh IDs but keep constraint metadata
  const regions: Region[] = template.regions.map((r) => ({
    ...r,
    // Keep template region IDs for now (they'll be unique per layout instance)
  }));

  return {
    id: layoutId,
    name: name ?? template.name,
    description: template.description,
    canvas: { ...template.canvas },
    regions,
    background: { ...template.background },
    safeFrame: { ...template.safeFrame },
    tags: [...template.tags],
    isTemplate: false,
    fromTemplateId: template.id,
    createdAt: now,
    updatedAt: now,
    // Legacy compat
    backgroundColor: template.background.color,
  };
}

// ---------------------------------------------------------------------------
// Legacy compatibility: convert templates to MVLayout[] for seedTemplates
// ---------------------------------------------------------------------------

export const STARTER_TEMPLATES: MVLayout[] = TEMPLATE_LIBRARY.map((tpl) => {
  const now = new Date().toISOString();
  return {
    id: tpl.id as unknown as LayoutId,
    name: tpl.name,
    description: tpl.description,
    canvas: { ...tpl.canvas },
    regions: [...tpl.regions],
    background: { ...tpl.background },
    safeFrame: { ...tpl.safeFrame },
    tags: [...tpl.tags],
    isTemplate: true,
    createdAt: now,
    updatedAt: now,
    backgroundColor: tpl.background.color,
  };
});
