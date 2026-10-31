/**
 * DockMultiviewTab.tsx — Multi-View tab for the MakeChurchEazy Dock
 *
 * Card-based Multi-View manager:
 *   - Each Multi-View is an independent card stacked vertically
 *   - Inline template selection + scene assignment per card
 *   - Per-card Preview in OBS
 *   - Card actions menu (⋮): Rename, Duplicate, Delete
 *   - No detail pages, no back buttons, everything on one screen
 */

import { memo, useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { dockObsClient } from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import { useDockObsReady } from "../useDockObsReady";
import Icon from "../DockIcon";
import { requireEntitlement, getDockPlan, showUpgradeModal } from "../dockEntitlement";
import { checkEntitlementSync } from "../../services/entitlementClient";
import { loadDockPreferenceList, readDockPreferenceList, saveDockPreferenceList } from "../../services/dockPreferenceStorage";
import { GALLERY_LAYOUTS, type GalleryLayout, type GallerySlot } from "../../multiview/galleryLayouts";
import { BACKGROUND_PATTERNS } from "../../library/backgroundAssets";
import {
  areAddedLayoutIdsEqual,
  getAddedLayoutLocalStorageKeys,
  loadAddedLayoutIdsFromDockData,
  loadLocalAddedLayoutIds,
  mergeAddedLayoutIds,
  MULTIVIEW_ADDED_LAYOUTS_CHANGED_EVENT,
  saveAddedLayoutIdsToDockData,
  saveLocalAddedLayoutIds,
} from "../../multiview/addedLayoutStorage";
import type { MediaItem } from "../../library/libraryTypes";
import {
  dedupeMediaItems,
  loadLocalLibrary,
  registerDockMediaItem,
  uploadFileToDock,
} from "../dockUploadService";
import { isInternalDockMediaItem } from "../internalMediaAssets";
import { getRecommendedPollingInterval } from "../../services/performanceManager";
import {
  applyScriptureCircleLook,
  getScriptureCircleTheme,
  isScriptureCircleLayoutId,
  listScriptureCircleThemes,
  loadScriptureCircleThemesFromDockData,
  parseScriptureCircleThemeId,
  scriptureCircleLayoutId,
  SCRIPTURE_CIRCLE_SCENE_NAME,
  type ScriptureCircleTheme,
} from "../../multiview/scriptureCircleLook";
import {
  applyScriptureArchLook,
  getScriptureArchTheme,
  isScriptureArchLayoutId,
  listScriptureArchThemes,
  loadScriptureArchThemesFromDockData,
  parseScriptureArchThemeId,
  scriptureArchLayoutId,
  SCRIPTURE_ARCH_SCENE_NAME,
  type ScriptureArchTheme,
} from "../../multiview/scriptureArchLook";
import {
  applyScriptureGoldCircleLook,
  getScriptureGoldCircleTheme,
  isScriptureGoldCircleLayoutId,
  listScriptureGoldCircleThemes,
  loadScriptureGoldCircleThemesFromDockData,
  parseScriptureGoldCircleThemeId,
  scriptureGoldCircleLayoutId,
  SCRIPTURE_GOLD_CIRCLE_SCENE_NAME,
  type ScriptureGoldCircleTheme,
} from "../../multiview/scriptureGoldCircleLook";
import {
  listCustomMultiViewLooks,
  refreshMultiviewLookCatalog,
  MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT,
  type CustomMultiViewLook,
} from "../../multiview/customLookCatalog";
import {
  applyCustomMultiViewLook,
  customLookLayoutId,
  customLookSceneName,
  getCustomLookCameraScene,
  isCustomLookLayoutId,
  loadCustomLookCameraScenesFromDockData,
  parseCustomLookLayoutId,
  saveCustomLookCameraScene,
} from "../../multiview/customLookLook";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dock-mv-saved";
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const DEFAULT_SLOT_FRAMING = { displayMode: "fit" as const, zoom: 1, focalX: 0.5, focalY: 0.5 };
const BACKGROUND_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const BACKGROUND_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv"]);
const MV_IMAGE_LIBRARY_UPDATED_EVENT = "dock-mv-image-library-updated";
// Scene/source inventory is useful while the tab is open, but it does not
// need to compete with OBS every few seconds on low-end machines.
const MV_OBS_SCAN_MS = 30_000;
const MV_THUMBNAIL_REFRESH_MS = 60_000;
const MV_THUMBNAIL_CONCURRENCY = 2;

const CONTENT_TYPE_INFO: Record<string, { labelKey: string; icon: string; color: string }> = {
  camera: { labelKey: "multiview.camera", icon: "videocam", color: "#0078d4" },
  scripture: { labelKey: "multiview.scripture", icon: "menu_book", color: "#3B82F6" },
  translation: { labelKey: "multiview.translation", icon: "translate", color: "#00bcd4" },
  "lower-third": { labelKey: "multiview.lowerThird", icon: "subtitles", color: "#ff9800" },
  browser: { labelKey: "multiview.browser", icon: "language", color: "#ff5722" },
  image: { labelKey: "multiview.image", icon: "image", color: "#9c27b0" },
};

const SCENE_TYPES = new Set(["camera", "scripture", "translation", "lower-third"]);

function areStringListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

type MVBgType = "color" | "image" | "video" | "pattern" | "scene";

interface MVBackground {
  type: MVBgType;
  color: string;
  filePath: string;
  patternSrc: string;
  sceneName: string;
}

const DEFAULT_MV_BG: MVBackground = { type: "color", color: "transparent", filePath: "", patternSrc: "", sceneName: "" };

interface SavedMultiView {
  id: string;
  name: string;
  /** Stable OBS scene name — one scene per card, never derived from template */
  obsSceneName: string;
  layoutId: string;
  assignments: Record<string, string>;
  slotModes: Record<string, "scene" | "source">;
  /** The one OBS scene with the camera, for a Scripture Circle theme card (layoutId starts with
   *  "scripture-circle:"). Overrides the theme's own saved camera scene for this card only, so the
   *  same theme can drive different cameras on different cards. Unused by every other layout. */
  scriptureCircleCameraSceneName?: string;
  /** Same idea as scriptureCircleCameraSceneName, for a Scripture Arch theme card. */
  scriptureArchCameraSceneName?: string;
  /** Same idea as scriptureCircleCameraSceneName, for a Scripture Gold Circle theme card. */
  scriptureGoldCircleCameraSceneName?: string;
  /** Same idea as scriptureCircleCameraSceneName, for an admin-uploaded custom Multi-View look
   *  card (layoutId starts with "multiview-look:"). Overrides the look's saved camera scene for
   *  this card only. Unused by every other layout. */
  customLookCameraSceneName?: string;
  slotFraming: Record<string, { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }>;
  /** Base64 data-URL thumbnails of assigned scenes */
  slotThumbnails: Record<string, string>;
  background: MVBackground;
  /** Frame applied to all slots (null = no frame) */
  layoutFrameId: string | null;
  /** Frame thickness override (1-20, default based on frame definition) */
  frameThickness: number;
  /** Frame corner radius override (0-40, 0 = use frame default) */
  frameCornerRadius: number;
  /** Frame opacity override (10-100, 100 = fully opaque) */
  frameOpacity: number;
  /** Frame color override (empty = use frame default colors) */
  frameColor: string;
  /** Per-slot frame override: "inherit" = use layoutFrameId, "none" = no frame, {frameId} = custom */
  slotFrames: Record<string, string>;
  /** Outer margin around layout/frame in pixels (0-80, default 5) */
  margin: number;
  /** Whether the margin affects the background (true = margin surrounds whole background & lightbox; false = margin only around scenes) */
  affectBackground: boolean;
  /** Inner spacing/gap between adjacent layout slots in pixels (0-60, default 5) */
  slotGap: number;
  customSpacing?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_MULTIVIEW_MARGIN = 5;
export const DEFAULT_MULTIVIEW_SLOT_GAP = 5;

// ── Frame Definitions ──────────────────────────────────────────────────────

interface FrameLayer {
  inset: number;       // offset from previous layer (outermost starts at 0)
  thickness: number;   // stroke width
  color: string;       // CSS color
  radius: number;      // corner radius (0 = square)
}

interface MultiviewFrame {
  id: string;
  name: string;
  category: "clean" | "broadcast" | "glow" | "decorative";
  layers: FrameLayer[];
  /** CSS fallback for editor preview (rendered by shared drawLayers on canvas) */
  css: Record<string, string | number>;
}

const FRAME_LIBRARY: MultiviewFrame[] = [
  // ── Clean ──
  {
    id: "clean-white", name: "Thin White", category: "clean",
    layers: [{ inset: 0, thickness: 2, color: "rgba(255,255,255,0.7)", radius: 0 }],
    css: { border: "2px solid rgba(255,255,255,0.7)", borderRadius: "0px" },
  },
  {
    id: "clean-black", name: "Thin Black", category: "clean",
    layers: [{ inset: 0, thickness: 2, color: "rgba(0,0,0,0.7)", radius: 0 }],
    css: { border: "2px solid rgba(0,0,0,0.7)", borderRadius: "0px" },
  },
  {
    id: "clean-gray", name: "Soft Gray", category: "clean",
    layers: [{ inset: 0, thickness: 2, color: "rgba(148,163,184,0.5)", radius: 0 }],
    css: { border: "2px solid rgba(148,163,184,0.5)", borderRadius: "0px" },
  },
  {
    id: "clean-white-round", name: "Rounded White", category: "clean",
    layers: [{ inset: 0, thickness: 2, color: "rgba(255,255,255,0.7)", radius: 12 }],
    css: { border: "2px solid rgba(255,255,255,0.7)", borderRadius: "12px" },
  },
  {
    id: "clean-dark-round", name: "Rounded Dark", category: "clean",
    layers: [{ inset: 0, thickness: 2, color: "rgba(30,41,59,0.8)", radius: 12 }],
    css: { border: "2px solid rgba(30,41,59,0.8)", borderRadius: "12px" },
  },
  // ── Broadcast ──
  {
    id: "broadcast-blue", name: "Blue Broadcast", category: "broadcast",
    layers: [
      { inset: 0, thickness: 3, color: "#1D4ED8", radius: 4 },
      { inset: 4, thickness: 1, color: "rgba(29,78,216,0.3)", radius: 2 },
    ],
    css: { border: "3px solid #1D4ED8", borderRadius: "4px", boxShadow: "inset 0 0 0 1px rgba(29,78,216,0.3)" },
  },
  {
    id: "broadcast-red", name: "Red Broadcast", category: "broadcast",
    layers: [
      { inset: 0, thickness: 3, color: "#DC2626", radius: 4 },
      { inset: 4, thickness: 1, color: "rgba(220,38,38,0.3)", radius: 2 },
    ],
    css: { border: "3px solid #DC2626", borderRadius: "4px", boxShadow: "inset 0 0 0 1px rgba(220,38,38,0.3)" },
  },
  {
    id: "broadcast-gold", name: "Gold Broadcast", category: "broadcast",
    layers: [
      { inset: 0, thickness: 3, color: "#D4A853", radius: 4 },
      { inset: 4, thickness: 1, color: "rgba(212,168,83,0.4)", radius: 2 },
    ],
    css: { border: "3px solid #D4A853", borderRadius: "4px", boxShadow: "inset 0 0 0 1px rgba(212,168,83,0.4)" },
  },
  {
    id: "broadcast-white-gold", name: "White + Gold", category: "broadcast",
    layers: [
      { inset: 0, thickness: 2, color: "#D4A853", radius: 0 },
      { inset: 3, thickness: 2, color: "rgba(255,255,255,0.3)", radius: 0 },
    ],
    css: { border: "4px double #D4A853", borderRadius: "0px" },
  },
  {
    id: "broadcast-double", name: "Double Line", category: "broadcast",
    layers: [
      { inset: 0, thickness: 2, color: "rgba(255,255,255,0.5)", radius: 0 },
      { inset: 4, thickness: 2, color: "rgba(255,255,255,0.3)", radius: 0 },
    ],
    css: { border: "4px double rgba(255,255,255,0.6)", borderRadius: "0px" },
  },
  // ── Glow ──
  {
    id: "glow-cyan", name: "Cyan Glow", category: "glow",
    layers: [
      { inset: 0, thickness: 2, color: "#06B6D4", radius: 8 },
      { inset: 3, thickness: 1, color: "rgba(6,182,212,0.4)", radius: 6 },
    ],
    css: { border: "2px solid #06B6D4", borderRadius: "8px", boxShadow: "0 0 12px rgba(6,182,212,0.5), inset 0 0 8px rgba(6,182,212,0.15)" },
  },
  {
    id: "glow-blue", name: "Blue Glow", category: "glow",
    layers: [
      { inset: 0, thickness: 2, color: "#3B82F6", radius: 8 },
      { inset: 3, thickness: 1, color: "rgba(59,130,246,0.4)", radius: 6 },
    ],
    css: { border: "2px solid #3B82F6", borderRadius: "8px", boxShadow: "0 0 12px rgba(59,130,246,0.5), inset 0 0 8px rgba(59,130,246,0.15)" },
  },
  {
    id: "glow-purple", name: "Purple Glow", category: "glow",
    layers: [
      { inset: 0, thickness: 2, color: "#8B5CF6", radius: 8 },
      { inset: 3, thickness: 1, color: "rgba(139,92,246,0.4)", radius: 6 },
    ],
    css: { border: "2px solid #8B5CF6", borderRadius: "8px", boxShadow: "0 0 12px rgba(139,92,246,0.5), inset 0 0 8px rgba(139,92,246,0.15)" },
  },
  {
    id: "glow-gold", name: "Gold Glow", category: "glow",
    layers: [
      { inset: 0, thickness: 2, color: "#D4A853", radius: 8 },
      { inset: 4, thickness: 1, color: "rgba(212,168,83,0.4)", radius: 6 },
    ],
    css: { border: "2px solid #D4A853", borderRadius: "8px", boxShadow: "0 0 14px rgba(212,168,83,0.5), inset 0 0 8px rgba(212,168,83,0.2)" },
  },
  {
    id: "glow-white", name: "White Glow", category: "glow",
    layers: [
      { inset: 0, thickness: 2, color: "rgba(255,255,255,0.5)", radius: 8 },
    ],
    css: { border: "2px solid rgba(255,255,255,0.5)", borderRadius: "8px", boxShadow: "0 0 10px rgba(255,255,255,0.25)" },
  },
  // ── Decorative ──
  {
    id: "deco-gold-ornate", name: "Gold Ornamental", category: "decorative",
    layers: [
      { inset: 0, thickness: 4, color: "#D4A853", radius: 6 },
      { inset: 5, thickness: 2, color: "rgba(212,168,83,0.2)", radius: 4 },
      { inset: 8, thickness: 1, color: "rgba(212,168,83,0.1)", radius: 2 },
    ],
    css: { border: "4px solid #D4A853", borderRadius: "6px", boxShadow: "0 0 0 3px rgba(212,168,83,0.2), 0 0 0 6px rgba(212,168,83,0.1)" },
  },
  {
    id: "deco-gold-cyan", name: "Gold + Cyan", category: "decorative",
    layers: [
      { inset: 0, thickness: 4, color: "#D4A853", radius: 8 },
      { inset: 5, thickness: 2, color: "rgba(30,30,30,0.7)", radius: 6 },
      { inset: 8, thickness: 2, color: "rgba(6,182,212,0.6)", radius: 4 },
    ],
    css: { border: "3px solid #D4A853", borderRadius: "4px", boxShadow: "0 0 0 2px rgba(6,182,212,0.4), 0 0 0 5px rgba(212,168,83,0.3)" },
  },
  {
    id: "deco-church", name: "Church Broadcast", category: "decorative",
    layers: [
      { inset: 0, thickness: 4, color: "#D4A853", radius: 10 },
      { inset: 5, thickness: 2, color: "rgba(212,168,83,0.3)", radius: 8 },
      { inset: 8, thickness: 1, color: "rgba(255,255,255,0.15)", radius: 7 },
      { inset: 10, thickness: 1, color: "rgba(212,168,83,0.2)", radius: 5 },
    ],
    css: { border: "5px double #D4A853", borderRadius: "8px", boxShadow: "inset 0 0 0 2px rgba(212,168,83,0.15), 0 0 0 1px rgba(212,168,83,0.25)" },
  },
  {
    id: "deco-cinema", name: "Cinematic", category: "decorative",
    layers: [
      { inset: 0, thickness: 3, color: "rgba(255,255,255,0.25)", radius: 0 },
      { inset: 4, thickness: 1, color: "rgba(255,255,255,0.12)", radius: 0 },
    ],
    css: { border: "2px solid rgba(255,255,255,0.3)", borderRadius: "0px", boxShadow: "0 0 20px rgba(0,0,0,0.5)" },
  },
  {
    id: "deco-metallic", name: "Metallic", category: "decorative",
    layers: [
      { inset: 0, thickness: 3, color: "#94A3B8", radius: 2 },
      { inset: 4, thickness: 1, color: "#CBD5E1", radius: 1 },
    ],
    css: { border: "3px solid #94A3B8", borderRadius: "0px" },
  },
];

const FRAME_CATEGORIES = [
  { key: "all" as const, label: "All" },
  { key: "clean" as const, label: "Clean" },
  { key: "broadcast" as const, label: "Broadcast" },
  { key: "glow" as const, label: "Glow" },
  { key: "decorative" as const, label: "Decorative" },
];

function resolveFrame(frameId: string | null | undefined): MultiviewFrame | undefined {
  if (!frameId) return undefined;
  return FRAME_LIBRARY.find(f => f.id === frameId);
}

function resolveEffectiveFrameId(
  slotFrameId: string | null | undefined,
  layoutFrameId: string | null | undefined,
): string | null {
  if (slotFrameId === "none") return null;
  if (!slotFrameId || slotFrameId === "inherit") return layoutFrameId || null;
  return slotFrameId;
}

// ── Shared frame renderer — used by both preview and OBS compositor ──

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawFrameLayers(
  ctx: CanvasRenderingContext2D,
  frame: MultiviewFrame,
  x: number, y: number, w: number, h: number,
  thicknessScale: number,
  cornerRadiusOverride: number,
  opacity: number,
  colorOverride: string,
) {
  const alpha = opacity / 100;
  for (const layer of frame.layers) {
    const t = Math.max(1, Math.round(layer.thickness * thicknessScale));
    const inset = layer.inset;
    const r = cornerRadiusOverride > 0 ? cornerRadiusOverride : Math.max(0, layer.radius - inset);
    const lx = x + inset;
    const ly = y + inset;
    const lw = w - inset * 2;
    const lh = h - inset * 2;
    const color = colorOverride || layer.color;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = t;
    ctx.globalAlpha = alpha;

    if (r > 0) {
      drawRoundedRect(ctx, lx, ly, lw, lh, r);
    } else {
      ctx.strokeRect(lx, ly, lw, lh);
    }
    ctx.stroke();
    ctx.restore();
  }
}

async function generateCompositeFramePng(
  layout: GalleryLayout,
  frameId: string | null,
  slotFrames: Record<string, string>,
  thickness: number,
  cornerRadius: number,
  opacity: number,
  color: string,
  margin: number = 0,
  slotGap: number = 0,
): Promise<Uint8Array | null> {
  // Resolve effective frame per slot
  const slotDefs = layout.slots.map(slot => {
    const effectiveFrameId = resolveEffectiveFrameId(slotFrames?.[slot.id], frameId);
    const frame = resolveFrame(effectiveFrameId);
    const eff = calculateMultiviewMarginSlotRect(slot, margin, slotGap);
    return frame
      ? { rect: { x: eff.x, y: eff.y, w: eff.width, h: eff.height }, frame }
      : null;
  }).filter((entry): entry is { rect: { x: number; y: number; w: number; h: number }; frame: MultiviewFrame } => Boolean(entry));

  if (slotDefs.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const scale = thickness / 2; // 2 = base, slider range 1-16

  for (const { rect, frame } of slotDefs) {
    drawFrameLayers(ctx, frame, rect.x, rect.y, rect.w, rect.h, scale, cornerRadius, opacity, color);
  }

  // Export as PNG bytes
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) { resolve(null); return; }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
    }, "image/png");
  });
}

async function saveFramePngToDisk(bytes: Uint8Array): Promise<string | null> {
  const safeName = `mv-frame-${Date.now()}.png`;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string>("save_upload_file", {
      fileName: safeName,
      fileData: Array.from(bytes),
    });
    return result;
  } catch {
    // HTTP fallback
    try {
      const base64 = btoa(String.fromCharCode(...bytes));
      const dataUrl = `data:image/png;base64,${base64}`;
      const res = await fetch("/api/save-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: safeName, dataUrl }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.path || null;
    } catch {
      return null;
    }
  }
}

function buildMultiviewPatternBrowserUrl(patternSrc: string): string {
  const trimmed = patternSrc.trim();
  const imageSrc = /^(data:|https?:\/\/|file:\/\/|\/)/i.test(trimmed)
    ? trimmed
    : `file://${trimmed}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:100vw;height:100vh;overflow:hidden;background:#0F172A"><img src="${imageSrc.replace(/"/g, "&quot;")}" style="display:block;width:100%;height:100%;object-fit:cover" /></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function genId(): string {
  return `mv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Short display ID like MV-001 based on index */
function shortId(index: number): string {
  return `MV-${String(index + 1).padStart(3, "0")}`;
}

/** Pick the next unused OBS scene name (e.g. "MV: Multiview 3") */
function nextObsSceneName(list: SavedMultiView[]): string {
  const used = new Set(list.map(m => m.obsSceneName).filter(Boolean));
  let n = 1;
  while (used.has(`MV: Multiview ${n}`)) n++;
  return `MV: Multiview ${n}`;
}

function normalizeLoadedMultiView(item: SavedMultiView): SavedMultiView {
  const assignments = item.assignments ?? {};
  const slotModes = item.slotModes ?? {};
  const slotThumbnails = item.slotThumbnails ?? {};
  const slotFraming = { ...(item.slotFraming ?? {}) };
  let changed = !item.assignments || !item.slotModes || !item.slotFraming || !item.slotThumbnails;

  for (const slotId of Object.keys(assignments)) {
    const framing = slotFraming[slotId];
    if (!framing || framing.displayMode === "fill") {
      slotFraming[slotId] = DEFAULT_SLOT_FRAMING;
      changed = true;
    }
  }

  const customSpacing = Boolean(item.customSpacing);
  const margin = customSpacing
    ? (typeof item.margin === "number" ? item.margin : DEFAULT_MULTIVIEW_MARGIN)
    : (typeof item.margin === "number" && item.margin > 0 ? item.margin : DEFAULT_MULTIVIEW_MARGIN);
  const affectBackground = Boolean(item.affectBackground);
  const slotGap = customSpacing
    ? (typeof item.slotGap === "number" ? item.slotGap : DEFAULT_MULTIVIEW_SLOT_GAP)
    : (typeof item.slotGap === "number" && item.slotGap > 0 ? item.slotGap : DEFAULT_MULTIVIEW_SLOT_GAP);
  if (typeof item.margin !== "number" || typeof item.affectBackground !== "boolean" || typeof item.slotGap !== "number" || item.margin !== margin || item.slotGap !== slotGap) {
    changed = true;
  }

  return changed ? { ...item, assignments, slotModes, slotFraming, slotThumbnails, margin, affectBackground, slotGap, customSpacing: customSpacing || undefined } : item;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

interface SavedStorageSnapshot {
  items: SavedMultiView[];
  /** A valid persisted value was found, including an intentional empty list. */
  hasStoredValue: boolean;
  /** The value came from a recovery/migration path and should be written back. */
  shouldMigrate: boolean;
  /** Storage was readable and may safely be written to. */
  canPersist: boolean;
}

function loadSavedSnapshot(): SavedStorageSnapshot {
  try {
    const storedItems = readDockPreferenceList<SavedMultiView>(STORAGE_KEY);
    if (storedItems !== null) {
      return { items: storedItems.map(normalizeLoadedMultiView), hasStoredValue: true, shouldMigrate: false, canPersist: true };
    }

    return { items: [], hasStoredValue: false, shouldMigrate: false, canPersist: true };
  } catch {
    // Storage can be temporarily unavailable while the dock/auth document is
    // being restored. Treat that as an unreadable session, never as an empty
    // Multiview that should be written back over the user's cards.
    return { items: [], hasStoredValue: false, shouldMigrate: false, canPersist: false };
  }
}

function saveSaved(items: SavedMultiView[]) {
  // localStorage is written synchronously for instant recovery; the same
  // snapshot is also mirrored to the dock's durable user-scoped store.
  void saveDockPreferenceList(STORAGE_KEY, items);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBackgroundMediaLabel(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function getMediaItemPreviewSrc(item: MediaItem): string {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  if (item.diskFileName) return `/uploads/${encodeURIComponent(item.diskFileName)}`;
  return item.url;
}

function getInlineImagePreviewSrc(filePath: string): string {
  const value = filePath.trim();
  if (/^(https?:\/\/|data:image\/|\/uploads\/)/i.test(value)) return value;
  return "";
}

function formatMediaItemMeta(item: MediaItem): string {
  const parts: string[] = [];
  if (item.mimeType) {
    parts.push(item.mimeType.split("/").pop()?.toUpperCase() || item.type.toUpperCase());
  } else {
    parts.push(item.type === "video" ? "VIDEO" : "IMAGE");
  }
  if (item.fileSize && Number.isFinite(item.fileSize)) {
    const mb = item.fileSize / (1024 * 1024);
    parts.push(mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`);
  }
  return parts.join(" · ");
}

function getUploadBackgroundMediaType(fileName: string): "image" | "video" | null {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (BACKGROUND_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (BACKGROUND_VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

function createUploadMediaItem(fileName: string): MediaItem | null {
  const type = getUploadBackgroundMediaType(fileName);
  if (!type) return null;
  return {
    id: `upload:${fileName}`,
    name: fileName,
    type,
    url: `/uploads/${encodeURIComponent(fileName)}`,
    diskFileName: fileName,
    createdAt: "0001-01-01T00:00:00.000Z",
    source: "local",
  };
}

function dedupeBackgroundMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.filePath || item.diskFileName || item.url || item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isMediaItemSelectedForBackground(item: MediaItem, filePath: string): boolean {
  if (!filePath) return false;
  const selectedName = getBackgroundMediaLabel(filePath);
  return item.filePath === filePath ||
    item.url === filePath ||
    item.diskFileName === selectedName ||
    item.name === selectedName;
}

function isSelectableBackgroundMediaItem(item: MediaItem, type: "image" | "video"): boolean {
  return item.type === type && item.source !== "document-conversion";
}

function isMultiviewManagedSceneName(sceneName: string): boolean {
  return /^MV:\s*Multiview\b/i.test(sceneName.trim());
}

async function loadBackgroundMediaLibrary(): Promise<MediaItem[]> {
  const sources: MediaItem[][] = [];

  try {
    const { getAllMedia } = await import("../../library/libraryDb");
    const indexedItems = await getAllMedia();
    if (indexedItems.length > 0) sources.push(indexedItems);
  } catch (err) {
    console.warn("[DockMultiview] Unable to read IndexedDB media library", err);
  }

  try {
    const res = await fetch("/uploads/dock-media-library.json");
    if (res.ok) {
      const jsonItems = await res.json();
      if (Array.isArray(jsonItems)) sources.push(jsonItems as MediaItem[]);
    }
  } catch (err) {
    console.warn("[DockMultiview] Unable to read dock media library file", err);
  }

  try {
    const res = await fetch("/api/uploads");
    if (res.ok) {
      const files = await res.json();
      if (Array.isArray(files)) {
        sources.push(files
          .filter((file): file is string => typeof file === "string")
          .map(createUploadMediaItem)
          .filter((item): item is MediaItem => Boolean(item)));
      }
    }
  } catch (err) {
    console.warn("[DockMultiview] Unable to read uploads folder media", err);
  }

  sources.push(loadLocalLibrary());
  return dedupeBackgroundMediaItems(
    dedupeMediaItems(sources.flat()).filter((item) => !isInternalDockMediaItem(item)),
  );
}

async function getUploadsDirectory(): Promise<string> {
  const res = await fetch("/api/uploads-dir");
  if (!res.ok) throw new Error(`uploads-dir failed: ${res.status}`);
  const data = await res.json();
  if (!data.path) throw new Error("Uploads directory was not returned.");
  return String(data.path);
}

async function resolveBackgroundMediaFilePath(item: MediaItem): Promise<string> {
  if (item.filePath) return item.filePath;

  if (item.url?.startsWith("data:")) {
    const response = await fetch("/api/save-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: item.diskFileName || item.name, dataUrl: item.url }),
    });
    if (!response.ok) throw new Error(`save-media failed: ${response.status}`);
    const data = await response.json();
    if (!data.path) throw new Error("Saved media path was not returned.");
    return String(data.path);
  }

  const fileName = item.diskFileName || decodeURIComponent(item.url?.split("/").pop() || item.name);
  if (!fileName) throw new Error("Media file name is missing.");
  const dir = await getUploadsDirectory();
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${fileName}`;
}

async function captureMvSourceThumbnail(sourceName: string): Promise<string | null> {
  if (!sourceName || !dockObsClient.isConnected) return null;
  try {
    const resp = await dockObsClient.call("GetSourceScreenshot", {
      sourceName,
      imageFormat: "jpeg",
      imageWidth: 320,
      imageHeight: 180,
      imageCompressionQuality: 60,
    }) as { imageData?: string };
    const data = resp.imageData;
    if (!data) return null;
    return data.startsWith("data:") ? data : `data:image/jpeg;base64,${data}`;
  } catch (err) {
    console.warn("[DockMultiview] Thumbnail capture failed", { sourceName, err });
    return null;
  }
}

/**
 * Capture previews in a small queue instead of starting one OBS screenshot
 * request per slot at the same time. The Dock is often hosted inside OBS, so
 * a burst of screenshot requests competes with the live compositor on the
 * same low-end machine.
 */
async function captureMvSourceThumbnails(sourceNames: string[]): Promise<Map<string, string | null>> {
  const captures = new Map<string, string | null>();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < sourceNames.length) {
      const sourceName = sourceNames[nextIndex++];
      captures.set(sourceName, await captureMvSourceThumbnail(sourceName));
    }
  };

  const workerCount = Math.min(MV_THUMBNAIL_CONCURRENCY, sourceNames.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return captures;
}

/** Looks up a real GalleryLayout, or — for a Scripture Circle synthetic id — the lightweight
 *  display-only stub carried in `extraLayouts` (the Dock's `addedLayouts`, which always includes
 *  one stub per saved Scripture Circle theme). */
function resolveLayout(layoutId: string, extraLayouts?: GalleryLayout[]): GalleryLayout | undefined {
  return GALLERY_LAYOUTS.find(l => l.id === layoutId) ?? extraLayouts?.find(l => l.id === layoutId);
}

function cssColorToObsInt(cssColor: string): number {
  const hex = cssColor.replace("#", "");
  let r = 0, g = 0, b = 0;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length >= 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  return (0xFF << 24 | b << 16 | g << 8 | r) >>> 0;
}

function formatMvContentLabel(value: string): string {
  const clean = value.trim();
  if (!clean) return clean;
  if (/^MCE(?: Browser)?\s*-\s*Worship$/i.test(clean) || /^MCE Worship$/i.test(clean)) return "Worship";
  if (/^MCE(?: Browser)?\s*-\s*Bible$/i.test(clean) || /^MCE Bible$/i.test(clean)) return "Bible";
  if (/^MCE Presentation$/i.test(clean)) return "Presentation";
  return clean.replace(/^MCE(?: Browser)?\s*-\s*/i, "").replace(/^MCE\s+/i, "");
}

function getMvBg(mv: SavedMultiView): MVBackground {
  return mv.background ?? DEFAULT_MV_BG;
}

function isMultiviewBackgroundEmpty(background: MVBackground): boolean {
  return (background.type === "color" && (background.color === "transparent" || background.color === "#0F172A"))
    || (background.type === "scene" && !background.sceneName)
    || (background.type === "pattern" && !background.patternSrc)
    || ((background.type === "image" || background.type === "video") && !background.filePath);
}

function getMultiviewBackgroundInput(background: MVBackground): { inputKind: string; inputSettings: Record<string, unknown> } | null {
  if (background.type === "scene") return null;

  if (background.type === "image" && background.filePath) {
    return {
      inputKind: "image_source",
      inputSettings: { file: background.filePath, width: CANVAS_W, height: CANVAS_H },
    };
  }

  if (background.type === "video" && background.filePath) {
    return {
      inputKind: "ffmpeg_source",
      inputSettings: {
        local_file: background.filePath,
        is_local_file: true,
        looping: true,
        restart_on_activate: true,
        close_when_inactive: true,
      },
    };
  }

  if (background.type === "pattern" && background.patternSrc) {
    return {
      inputKind: "browser_source",
      inputSettings: {
        url: buildMultiviewPatternBrowserUrl(background.patternSrc),
        width: CANVAS_W,
        height: CANVAS_H,
        css: "",
        bgcolor: "#00000000",
        shutdown: false,
        restart_when_active: false,
      },
    };
  }

  return {
    inputKind: "color_source_v3",
    inputSettings: {
      color: cssColorToObsInt(background.color || "#0F172A"),
      width: CANVAS_W,
      height: CANVAS_H,
    },
  };
}

/** Apply a background change to an already-created Multi-View scene. */
export async function updateMultiviewBackgroundSource(
  sceneName: string,
  multiviewId: string,
  background: MVBackground,
  previousBackground?: MVBackground,
  margin: number = 0,
  affectBackground: boolean = false,
): Promise<void> {
  const inputName = `${multiviewId}::BACKGROUND`;
  const existing = await dockObsClient.call("GetSceneItemList", { sceneName }) as {
    sceneItems?: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex?: number }>;
  };
  const previousSceneName = previousBackground?.type === "scene" ? previousBackground.sceneName.trim() : "";
  const previousSceneItem = previousSceneName
    ? (existing.sceneItems ?? []).filter((item) => item.sourceName === previousSceneName)
      .sort((a, b) => (a.sceneItemIndex ?? Number.MAX_SAFE_INTEGER) - (b.sceneItemIndex ?? Number.MAX_SAFE_INTEGER))[0]
    : undefined;

  // Remove the old managed background item, or the old nested scene item,
  // before adding the replacement. This is what makes type changes reliable.
  for (const item of existing.sceneItems ?? []) {
    const isManagedBackground = item.sourceName === inputName;
    const isPreviousNestedBackground = item.sceneItemId === previousSceneItem?.sceneItemId;
    if (!isManagedBackground && !isPreviousNestedBackground) continue;
    await dockObsClient.call("RemoveSceneItem", { sceneName, sceneItemId: item.sceneItemId }).catch(() => { });
  }

  if (isMultiviewBackgroundEmpty(background)) {
    await dockObsClient.call("RemoveInput", { inputName }).catch(() => { });
    return;
  }

  let sceneItemId: number;
  if (background.type === "scene" && background.sceneName) {
    // A nested scene does not use the managed input source.
    await dockObsClient.call("RemoveInput", { inputName }).catch(() => { });
    const created = await dockObsClient.call("CreateSceneItem", {
      sceneName,
      sourceName: background.sceneName,
      sceneItemEnabled: true,
    }) as { sceneItemId: number };
    sceneItemId = created.sceneItemId;
  } else {
    const input = getMultiviewBackgroundInput(background);
    if (!input) return;

    try {
      const inputList = await dockObsClient.call("GetInputList") as {
        inputs?: Array<{ inputName: string; inputKind?: string }>;
      };
      const existingInput = inputList.inputs?.find((item) => item.inputName === inputName);
      if (existingInput?.inputKind && existingInput.inputKind !== input.inputKind) {
        await dockObsClient.call("RemoveInput", { inputName });
      }
    } catch {
      // CreateInput below still handles bridges without input metadata.
    }

    try {
      const created = await dockObsClient.call("CreateInput", {
        sceneName,
        inputName,
        inputKind: input.inputKind,
        inputSettings: input.inputSettings,
        sceneItemEnabled: true,
      }) as { sceneItemId: number };
      sceneItemId = created.sceneItemId;
    } catch {
      // The managed input already exists: update its settings and re-add it to
      // the scene after removing the previous scene item above.
      await dockObsClient.call("SetInputSettings", { inputName, inputSettings: input.inputSettings });
      await dockObsClient.call("AddSceneItem", { sceneName, sourceName: inputName });
      const resolved = await dockObsClient.call("GetSceneItemId", { sceneName, sourceName: inputName }) as { sceneItemId: number };
      sceneItemId = resolved.sceneItemId;
    }
  }

  const canvas = typeof dockObsClient.getCanvasSize === "function"
    ? await dockObsClient.getCanvasSize()
    : { width: CANVAS_W, height: CANVAS_H };
  const currentW = canvas.width || CANVAS_W;
  const currentH = canvas.height || CANVAS_H;
  const scaleX = currentW / CANVAS_W;
  const scaleY = currentH / CANVAS_H;

  const m = (affectBackground && margin > 0) ? Math.min(margin, 200) : 0;
  const bgX = (affectBackground && m > 0) ? Math.round(m * scaleX) : 0;
  const bgY = (affectBackground && m > 0) ? Math.round(m * scaleY) : 0;
  const bgW = m > 0 ? (currentW - 2 * bgX) : currentW;
  const bgH = m > 0 ? (currentH - 2 * bgY) : currentH;

  await dockObsClient.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId,
    sceneItemTransform: {
      positionX: bgX,
      positionY: bgY,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: bgW,
      boundsHeight: bgH,
      boundsAlignment: 0,
      cropLeft: 0,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
    },
  });
  await dockObsClient.call("SetSceneItemIndex", { sceneName, sceneItemId, sceneItemIndex: 0 }).catch(() => { });
}

function isSceneType(ct: GallerySlot["contentType"]): boolean {
  return SCENE_TYPES.has(ct);
}

function SlotTypeIcon({ contentType }: { contentType: GallerySlot["contentType"] }) {
  const { t } = useTranslation();
  const info = CONTENT_TYPE_INFO[contentType] || CONTENT_TYPE_INFO.camera;
  return (
    <span className="dock-mv-slot-icon" style={{ color: info.color }} title={t(info.labelKey)}>
      <Icon name={info.icon} size={12} />
    </span>
  );
}

const LayoutMiniPreview = memo(function LayoutMiniPreview({
  layout,
  thumbnails,
  slotFraming,
  frameId,
  slotFrames,
  frameThickness,
  frameCornerRadius,
  frameOpacity,
  frameColor,
  margin = 0,
  affectBackground = false,
  slotGap = 0,
  background,
}: {
  layout: GalleryLayout;
  thumbnails?: Record<string, string>;
  slotFraming?: SavedMultiView["slotFraming"];
  frameId?: string | null;
  slotFrames?: Record<string, string>;
  frameThickness?: number;
  frameCornerRadius?: number;
  frameOpacity?: number;
  frameColor?: string;
  margin?: number;
  affectBackground?: boolean;
  slotGap?: number;
  background?: MVBackground;
}) {
  const m = margin > 0 ? Math.min(margin, 200) : 0;
  const hasThumbs = thumbnails && Object.keys(thumbnails).length > 0;

  // Resolve frames per slot for SVG overlay
  const slotFramesResolved = layout.slots.map(slot => {
    const effId = resolveEffectiveFrameId(slotFrames?.[slot.id], frameId);
    return { slot, frame: resolveFrame(effId) };
  }).filter((s): s is { slot: GallerySlot; frame: MultiviewFrame } => !!s.frame);

  const bgType = background?.type ?? "color";
  const bgColor = background?.color && background.color !== "transparent" ? background.color : "#111111";
  const isBgInset = affectBackground && m > 0;

  const bgStyle: React.CSSProperties = isBgInset
    ? {
        position: "absolute",
        left: `${(m / CANVAS_W) * 100}%`,
        top: `${(m / CANVAS_H) * 100}%`,
        width: `${((CANVAS_W - 2 * m) / CANVAS_W) * 100}%`,
        height: `${((CANVAS_H - 2 * m) / CANVAS_H) * 100}%`,
        borderRadius: 4,
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.12)",
        overflow: "hidden",
        background: bgType === "color" ? bgColor : "#1E293B",
      }
    : {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        background: bgType === "color" ? bgColor : "#1E293B",
        overflow: "hidden",
      };

  return (
    <div
      className="dock-mv-layout-preview"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${CANVAS_W}/${CANVAS_H}`,
        overflow: "hidden",
        background: isBgInset ? "#080C14" : "#111",
        borderRadius: 4,
        border: "1px solid var(--dock-border, #334155)",
      }}
    >
      {/* Background layer */}
      <div style={bgStyle}>
        {bgType === "image" && background?.filePath && (
          <img
            src={background.filePath.startsWith("data:") || background.filePath.startsWith("http") || background.filePath.startsWith("/") ? background.filePath : `file://${background.filePath}`}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </div>

      {/* Thumbnail images overlaid at inset position */}
      {hasThumbs && layout.slots.map((slot) => {
        const thumb = thumbnails?.[slot.id];
        if (!thumb) return null;
        const eff = calculateMultiviewMarginSlotRect(slot, margin, slotGap);
        const { x: effX, y: effY, width: effW, height: effH } = eff;

        const framing = slotFraming?.[slot.id] ?? DEFAULT_SLOT_FRAMING;
        const tx = calculateSlotTransform(
          320,
          180,
          { x: effX, y: effY, width: effW, height: effH },
          { mode: framing.displayMode, focalX: framing.focalX ?? 0.5, focalY: framing.focalY ?? 0.5, zoom: framing.zoom ?? 1 },
        );
        return (
          <div key={slot.id}
            style={{
              position: "absolute",
              left: `${(effX / CANVAS_W) * 100}%`,
              top: `${(effY / CANVAS_H) * 100}%`,
              width: `${(effW / CANVAS_W) * 100}%`,
              height: `${(effH / CANVAS_H) * 100}%`,
              overflow: "hidden",
            }}
          >
            <img src={thumb} alt=""
              style={{
                position: "absolute",
                left: `${((tx.positionX - effX) / effW) * 100}%`,
                top: `${((tx.positionY - effY) / effH) * 100}%`,
                width: `${(tx.renderedWidth / effW) * 100}%`,
                height: `${(tx.renderedHeight / effH) * 100}%`,
                objectFit: "fill",
                display: "block",
              }} />
          </div>
        );
      })}

      {/* SVG overlay: unassigned slot outlines + frame layer borders */}
      <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* Frame layers for assigned slots */}
        {hasThumbs && slotFramesResolved.map(({ slot, frame }) => {
          const t = frameThickness ?? 2;
          const scale = t / 2;
          const alpha = (frameOpacity ?? 100) / 100;
          const rOverride = frameCornerRadius ?? 0;
          const eff = calculateMultiviewMarginSlotRect(slot, margin, slotGap);
          const { x: effX, y: effY, width: effW, height: effH } = eff;

          return (
            <g key={`frm-${slot.id}`}>
              {frame.layers.map((layer, li) => {
                const lw = Math.max(0.5, layer.thickness * scale);
                const inset = layer.inset;
                const r = rOverride > 0 ? rOverride : Math.max(0, layer.radius - inset);
                return (
                  <rect key={li}
                    x={effX + inset} y={effY + inset}
                    width={effW - inset * 2} height={effH - inset * 2}
                    fill="none" stroke={frameColor || layer.color} strokeWidth={lw}
                    rx={r} ry={r} opacity={alpha}
                  />
                );
              })}
            </g>
          );
        })}
        {/* Unassigned slots */}
        {layout.slots.map((slot) => {
          if (thumbnails?.[slot.id]) return null;
          const info = CONTENT_TYPE_INFO[slot.contentType] || CONTENT_TYPE_INFO.camera;
          const eff = calculateMultiviewMarginSlotRect(slot, margin, slotGap);
          const { x: effX, y: effY, width: effW, height: effH } = eff;
          return (
            <g key={slot.id}>
              <rect x={effX} y={effY} width={effW} height={effH} fill={info.color} opacity={0.3} />
              <rect x={effX} y={effY} width={effW} height={effH} fill="none" stroke={info.color} strokeWidth={2} opacity={0.6} />
            </g>
          );
        })}
      </svg>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Content Picker Modal
// ---------------------------------------------------------------------------

function ContentPicker({
  open,
  obsScenes,
  loading,
  onSelect,
  onClose,
  excludeScenes,
}: {
  open: boolean;
  obsScenes: string[];
  loading: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
  excludeScenes?: string[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  if (!open) return null;

  const exclude = new Set(excludeScenes ?? []);
  const normalizedQuery = query.trim().toLowerCase();
  const scenes = obsScenes.filter(s => (!normalizedQuery || s.toLowerCase().includes(normalizedQuery)) && !exclude.has(s));

  const modalContent = (
    <div className="dock-mv-modal-overlay" onClick={onClose}>
      <div className="dock-mv-content-picker" onClick={(e) => e.stopPropagation()}>
        <div className="dock-mv-content-picker__header">
          <div>
            <span className="dock-mv-content-picker__title">{t('multiview.chooseContent')}</span>
            <span className="dock-mv-content-picker__subtitle">{t('multiview.chooseContentDesc')}</span>
          </div>
          <button type="button" className="dock-mv-content-picker__close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-mv-content-picker__search">
          <Icon name="search" size={13} />
          <input
            className="dock-mv-content-picker__search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('multiview.searchScenes', 'Search OBS scenes...')}
            autoFocus
          />
        </div>
        <div className="dock-mv-content-picker__summary" aria-live="polite">
          <span>{t('multiview.scenes')} · {scenes.length}</span>
          <span>{t('multiview.scenePickerHint', 'Use a full OBS scene inside this area.')}</span>
        </div>
        <div className="dock-mv-content-picker__list" aria-busy={loading}>
          {loading ? (
            <div className="dock-mv-content-picker__loading" role="status" aria-live="polite">
              <span>{t('common.loading')}</span>
            </div>
          ) : scenes.length === 0 ? (
            <div className="dock-mv-content-picker__empty">{t('multiview.noContentFound')}</div>
          ) : (
            scenes.map(item => (
              <button
                key={`scene:${item}`}
                type="button"
                className="dock-mv-content-picker__item"
                onClick={() => onSelect(item)}
              >
                <span className="dock-mv-content-picker__item-icon" aria-hidden="true">
                  <Icon name="grid_view" size={14} />
                </span>
                <span className="dock-mv-content-picker__item-body">
                  <span className="dock-mv-content-picker__item-name">{item}</span>
                  <span className="dock-mv-content-picker__item-meta">
                    {t('multiview.scene', 'Scene')}
                  </span>
                </span>
                <span className="dock-mv-content-picker__item-action">
                  <Icon name="arrow_forward" size={13} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ---------------------------------------------------------------------------
// Framing Editor — live OBS screenshot preview with crop/position controls
// ---------------------------------------------------------------------------
// Shared transform calculation — used by both the preview and OBS output
// ---------------------------------------------------------------------------
interface SlotRect { x: number; y: number; width: number; height: number }
interface FramingParams { mode: "fill" | "fit" | "custom"; focalX: number; focalY: number; zoom: number }
interface SourceSize { width: number; height: number }

function normalizeSourceSize(width?: number, height?: number): SourceSize {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  return {
    width: Number.isFinite(safeWidth) && safeWidth > 0 ? safeWidth : CANVAS_W,
    height: Number.isFinite(safeHeight) && safeHeight > 0 ? safeHeight : CANVAS_H,
  };
}

function normalizeSlotFraming(
  framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number },
) {
  const focalX = Number(framing.focalX);
  const focalY = Number(framing.focalY);
  return {
    displayMode: framing.displayMode,
    zoom: Math.max(1, Math.min(5, Number(framing.zoom) || 1)),
    // Do not use `|| 0.5` here: 0 is a valid edge position.
    focalX: Math.max(0, Math.min(1, Number.isFinite(focalX) ? focalX : 0.5)),
    focalY: Math.max(0, Math.min(1, Number.isFinite(focalY) ? focalY : 0.5)),
  };
}

function normalizeEditorFraming(
  framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number },
) {
  const normalized = normalizeSlotFraming(framing);
  // "fill" is retained when reading older saved cards, but the editor now
  // exposes it as the editable Custom mode.
  return normalized.displayMode === "fill"
    ? { ...normalized, displayMode: "custom" as const }
    : normalized;
}

async function getSceneItemSourceSize(sceneName: string, sceneItemId: number): Promise<SourceSize> {
  try {
    const response = await dockObsClient.call("GetSceneItemTransform", {
      sceneName,
      sceneItemId,
    }) as {
      sceneItemTransform?: {
        sourceWidth?: number;
        sourceHeight?: number;
      };
    };
    return normalizeSourceSize(
      response.sceneItemTransform?.sourceWidth,
      response.sceneItemTransform?.sourceHeight,
    );
  } catch {
    return normalizeSourceSize();
  }
}

export function calculateMultiviewMarginSlotRect(
  slot: { x: number; y: number; width: number; height: number },
  margin: number,
  slotGap: number = 0,
  canvasW: number = CANVAS_W,
  canvasH: number = CANVAS_H,
): { x: number; y: number; width: number; height: number } {
  const m = margin > 0 ? Math.min(margin, 200) : 0;
  const g = slotGap > 0 ? Math.min(slotGap, 100) : 0;
  if (m === 0 && g === 0) return { ...slot };
  const scaleX = m > 0 ? (canvasW - 2 * m) / canvasW : 1;
  const scaleY = m > 0 ? (canvasH - 2 * m) / canvasH : 1;

  let x = m > 0 ? m + slot.x * scaleX : slot.x;
  let y = m > 0 ? m + slot.y * scaleY : slot.y;
  let w = m > 0 ? slot.width * scaleX : slot.width;
  let h = m > 0 ? slot.height * scaleY : slot.height;

  if (g > 0) {
    const halfG = g / 2;
    if (slot.x > 1) {
      x += halfG;
      w -= halfG;
    }
    if (slot.x + slot.width < canvasW - 1) {
      w -= halfG;
    }
    if (slot.y > 1) {
      y += halfG;
      h -= halfG;
    }
    if (slot.y + slot.height < canvasH - 1) {
      h -= halfG;
    }
  }

  const rx = Math.round(x);
  const ry = Math.round(y);
  let rw = Math.round(w);
  let rh = Math.round(h);

  if (slot.x + slot.width >= canvasW - 1) {
    rw = Math.max(10, (canvasW - m) - rx);
  }
  if (slot.y + slot.height >= canvasH - 1) {
    rh = Math.max(10, (canvasH - m) - ry);
  }

  return {
    x: rx,
    y: ry,
    width: Math.max(10, rw),
    height: Math.max(10, rh),
  };
}

export function calculateMultiviewBackgroundRect(
  margin: number,
  affectBackground: boolean,
  canvasW: number = CANVAS_W,
  canvasH: number = CANVAS_H,
): { x: number; y: number; width: number; height: number } {
  const m = (affectBackground && margin > 0) ? Math.min(margin, 200) : 0;
  if (m === 0) return { x: 0, y: 0, width: canvasW, height: canvasH };
  return {
    x: m,
    y: m,
    width: canvasW - 2 * m,
    height: canvasH - 2 * m,
  };
}

export function calculateSlotTransform(
  sourceWidth: number,
  sourceHeight: number,
  slot: SlotRect,
  framing: FramingParams,
) {
  const sourceSize = normalizeSourceSize(sourceWidth, sourceHeight);
  const safeFraming = normalizeSlotFraming({
    displayMode: framing.mode,
    zoom: framing.zoom,
    focalX: framing.focalX,
    focalY: framing.focalY,
  });
  const fillScale = Math.max(slot.width / sourceSize.width, slot.height / sourceSize.height);

  if (safeFraming.displayMode === "fit") {
    const scaleX = slot.width / sourceSize.width;
    const scaleY = slot.height / sourceSize.height;
    return {
      scale: Math.max(scaleX, scaleY),
      scaleX,
      scaleY,
      renderedWidth: slot.width,
      renderedHeight: slot.height,
      positionX: slot.x,
      positionY: slot.y,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
    };
  }

  const scale = fillScale * safeFraming.zoom;
  const renderedWidth = sourceSize.width * scale;
  const renderedHeight = sourceSize.height * scale;
  const visibleSourceWidth = slot.width / scale;
  const visibleSourceHeight = slot.height / scale;
  const hCrop = Math.max(0, sourceSize.width - visibleSourceWidth);
  const vCrop = Math.max(0, sourceSize.height - visibleSourceHeight);

  return {
    scale,
    scaleX: scale,
    scaleY: scale,
    renderedWidth,
    renderedHeight,
    // Crop distances are measured in source pixels, so convert them back to
    // canvas pixels before positioning the rendered image. Without this
    // scale, the preview stops short of the slot edge at focalX/Y = 1.
    positionX: slot.x - hCrop * safeFraming.focalX * scale,
    positionY: slot.y - vCrop * safeFraming.focalY * scale,
    cropLeft: hCrop * safeFraming.focalX,
    cropRight: hCrop - hCrop * safeFraming.focalX,
    cropTop: vCrop * safeFraming.focalY,
    cropBottom: vCrop - vCrop * safeFraming.focalY,
  };
}

function FramingEditor({
  open,
  initialFraming,
  slotWidth,
  slotHeight,
  selectedContentName,
  selectedContentMode,
  onSave,
  onClose,
}: {
  open: boolean;
  initialFraming: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number };
  slotWidth: number;
  slotHeight: number;
  selectedContentName: string;
  selectedContentMode: "scene" | "source";
  onSave: (f: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => normalizeEditorFraming(initialFraming));
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<SourceSize>(() => normalizeSourceSize());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showCustomHint, setShowCustomHint] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startFocalX: number; startFocalY: number } | null>(null);
  const mountedRef = useRef(true);
  const captureGenRef = useRef(0);

  const isCustom = draft.displayMode !== "fit";
  const isPortraitPreview = slotHeight > slotWidth;
  const zoomPixels = Math.round(draft.zoom * 100);

  // ── Capture screenshot when modal opens ──
  const captureScreenshot = useCallback(async () => {
    if (!selectedContentName) return;
    setLoading(true);
    setError(null);
    const gen = ++captureGenRef.current;
    try {
      const resp = await dockObsClient.call("GetSourceScreenshot", {
        sourceName: selectedContentName,
        imageFormat: "png",
        imageWidth: 960,
      }) as { imageData: string };
      if (!mountedRef.current || gen !== captureGenRef.current) return;
      const data = resp.imageData;
      setScreenshot(data.startsWith("data:") ? data : `data:image/png;base64,${data}`);
    } catch (err) {
      if (!mountedRef.current || gen !== captureGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[FramingEditor] GetSourceScreenshot FAILED", { sourceName: selectedContentName, mode: selectedContentMode, error: msg });
      setError(msg);
    } finally {
      if (mountedRef.current && gen === captureGenRef.current) {
        setLoading(false);
      }
    }
  }, [selectedContentName, selectedContentMode]);

  useEffect(() => {
    if (open) {
      setDraft(normalizeEditorFraming(initialFraming));
      setScreenshot(null);
      setPreviewSize(normalizeSourceSize());
      setError(null);
      setShowCustomHint(false);
      mountedRef.current = true;
      captureScreenshot();
    }
    return () => { mountedRef.current = false; };
  }, [open]);

  useEffect(() => {
    if (!showCustomHint) return;
    const timeout = window.setTimeout(() => setShowCustomHint(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [showCustomHint]);

  const handleDisplayModeChange = useCallback((mode: "fit" | "custom") => {
    if (mode === "fit") {
      setDraft(prev => normalizeEditorFraming({ ...prev, displayMode: "fit" }));
      setShowCustomHint(false);
      return;
    }

    setDraft(prev => normalizeEditorFraming({
      ...prev,
      displayMode: "custom",
      // Switching from Fit starts Custom at a centered fill, ready to drag.
      ...(prev.displayMode === "fit" ? { zoom: 1, focalX: 0.5, focalY: 0.5 } : {}),
    }));
    setShowCustomHint(true);
  }, []);

  const saveFraming = useCallback(() => {
    onSave(normalizeEditorFraming(draft));
    onClose();
  }, [draft, onClose, onSave]);

  // ── Preview image transform using the shared calculation ──
  const imageStyle = useMemo((): React.CSSProperties => {
    const tx = calculateSlotTransform(
      previewSize.width, previewSize.height,
      { x: 0, y: 0, width: slotWidth, height: slotHeight },
      { mode: draft.displayMode, focalX: draft.focalX, focalY: draft.focalY, zoom: draft.zoom },
    );

    const pctW = (tx.renderedWidth / slotWidth) * 100;
    const pctH = (tx.renderedHeight / slotHeight) * 100;
    const pctL = (tx.positionX / slotWidth) * 100;
    const pctT = (tx.positionY / slotHeight) * 100;

    return {
      position: "absolute",
      left: `${pctL}%`,
      top: `${pctT}%`,
      width: `${pctW}%`,
      height: `${pctH}%`,
      maxWidth: "none",
      objectFit: "none",
    };
  }, [draft, previewSize.height, previewSize.width, slotWidth, slotHeight]);

  // ── Pointer handlers for Custom mode drag ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isCustom) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startFocalX: draft.focalX,
      startFocalY: draft.focalY,
    };
    setDragging(true);
  }, [isCustom, draft.focalX, draft.focalY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !isCustom) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const sensitivity = 0.003;
    setDraft(prev => normalizeSlotFraming({
      ...prev,
      // Direct manipulation: dragging the picture right/down moves the
      // picture right/down, instead of reversing the user's gesture.
      focalX: Math.max(0, Math.min(1, dragRef.current!.startFocalX - dx * sensitivity)),
      focalY: Math.max(0, Math.min(1, dragRef.current!.startFocalY - dy * sensitivity)),
    }));
  }, [isCustom]);

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isCustom) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setDraft(prev => normalizeSlotFraming({ ...prev, zoom: prev.zoom + delta }));
  }, [isCustom]);

  if (!open) return null;

  const modalContent = (
    <div className="dock-mv-modal-overlay" onClick={onClose}>
      <div className="dock-mv-framing-editor" onClick={(e) => e.stopPropagation()}>
        <div className="dock-mv-framing-editor__header">
          <span className="dock-mv-framing-editor__title">{t('multiview.adjustFraming')}</span>
          <div className="dock-mv-framing-editor__header-actions">
            <button
              type="button"
              className="dock-mv-framing-editor__refresh"
              onClick={captureScreenshot}
              disabled={loading}
              title={t('multiview.refreshPreview')}
            >
              <Icon name="refresh" size={13} />
            </button>
            <button
              type="button"
              className="dock-mv-framing-editor__save"
              onClick={saveFraming}
              title={t('multiview.saveFraming')}
              aria-label={t('multiview.saveFraming')}
            >
              {t('common.save', 'Save')}
            </button>
            <button
              type="button"
              className="dock-mv-framing-editor__close"
              onClick={onClose}
              title={t('common.cancel')}
              aria-label={t('common.cancel')}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        <div className="dock-mv-framing-editor__body">
          {/* Visual Preview */}
          <div
            className={[
              "dock-mv-framing-editor__preview",
              isPortraitPreview ? "dock-mv-framing-editor__preview--portrait" : "",
              isCustom ? "dock-mv-framing-editor__preview--draggable" : "",
              dragging ? "dock-mv-framing-editor__preview--dragging" : "",
              draft.displayMode === "fit" ? "dock-mv-framing-editor__preview--fit" : "",
            ].filter(Boolean).join(" ")}
            style={{ aspectRatio: `${slotWidth}/${slotHeight}` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {loading && (
              <div className="dock-mv-framing-editor__preview-status">
                <Icon name="hourglass_top" size={16} />
                <span>{t('multiview.capturingPreview')}</span>
              </div>
            )}

            {!loading && error && (
              <div className="dock-mv-framing-editor__preview-status dock-mv-framing-editor__preview-status--error">
                <span>{t('multiview.captureFailed')}</span>
                <button
                  type="button"
                  className="dock-btn dock-btn--xs"
                  onClick={captureScreenshot}
                >
                  {t('multiview.tryAgain')}
                </button>
              </div>
            )}

            {!loading && !error && screenshot && (
              <img
                className="dock-mv-framing-editor__preview-img"
                src={screenshot}
                alt={`Preview of ${selectedContentName}`}
                style={imageStyle}
                onLoad={(event) => {
                  setPreviewSize(normalizeSourceSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight));
                }}
                draggable={false}
              />
            )}

            {isCustom && showCustomHint && (
              <div className="dock-mv-framing-editor__custom-hint" role="status" aria-live="polite">
                <span className="dock-mv-framing-editor__custom-hint-icon" aria-hidden="true">
                  <Icon name="swap_horiz" size={18} />
                </span>
                <strong>{t('multiview.dragLeftRight', 'Drag left or right')}</strong>
                <span>{t('multiview.dragToReposition', 'Drag the preview to reposition')}</span>
              </div>
            )}

            {!loading && !error && !screenshot && (
              <div className="dock-mv-framing-editor__preview-placeholder">
                <Icon name="live_tv" size={24} />
              </div>
            )}

            {/* Slot border overlay */}
            <div className="dock-mv-framing-editor__preview-border" />
          </div>

          {/* Display Mode selector */}
          <div className="dock-mv-framing-editor__modes">
            {(["fit", "custom"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                className={`dock-mv-framing-editor__mode${draft.displayMode === mode ? " dock-mv-framing-editor__mode--active" : ""}`}
                onClick={() => handleDisplayModeChange(mode)}
              >
                {t(`multiview.framingMode_${mode}`)}
              </button>
            ))}
          </div>

          {/* Custom controls */}
          {isCustom && (
            <div className="dock-mv-framing-editor__custom-controls">
              <label className="dock-mv-framing-editor__control">
                <span className="dock-mv-framing-editor__control-label">{t('multiview.zoom')}</span>
                <div className="dock-mv-framing-editor__control-row">
                  <input
                    type="range"
                    min="100"
                    max="500"
                    step="5"
                    value={zoomPixels}
                    onChange={(e) => setDraft(prev => normalizeSlotFraming({ ...prev, zoom: parseFloat(e.target.value) / 100 }))}
                    className="dock-mv-framing-editor__slider"
                    aria-label={t('multiview.zoom')}
                  />
                  <span className="dock-mv-framing-editor__control-value">{zoomPixels}px ({draft.zoom.toFixed(2)}×)</span>
                </div>
              </label>

            </div>
          )}
        </div>


      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ---------------------------------------------------------------------------
// SlotControl — redesigned card-style slot assignment
// ---------------------------------------------------------------------------

function SlotContentMenu({
  onSelect,
  onRemove,
}: {
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 168;
    const menuHeight = 76;
    const fitsBelow = rect.bottom + menuHeight + 8 <= window.innerHeight;
    const top = fitsBelow
      ? rect.bottom + 4
      : Math.max(8, rect.top - menuHeight - 4);
    const left = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    setPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleViewportChange = () => updatePosition();
    document.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("resize", handleViewportChange);
    document.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <div className="dock-mv-slot-row__menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="dock-mv-slot-row__menu-btn"
        onClick={() => setOpen((current) => !current)}
        title={t("common.more", "More")}
        aria-label={t("common.more", "More")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more_vert" size={14} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dock-mv-slot-row__dropdown dock-mv-slot-row__dropdown--portal"
          role="menu"
          style={{ top: position.top, left: position.left, right: "auto" }}
        >
          <button
            type="button"
            role="menuitem"
            className="dock-mv-slot-row__dropdown-item"
            onClick={() => {
              setOpen(false);
              onSelect();
            }}
          >
            {t("multiview.changeContent", "Change Scene")}
          </button>
          <div className="dock-mv-slot-row__dropdown-divider" />
          <button
            type="button"
            role="menuitem"
            className="dock-mv-slot-row__dropdown-item dock-mv-slot-row__dropdown-item--danger"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {t("multiview.removeContent", "Remove Scene")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ImageSlotControl({
  slot,
  slotIndex,
  value,
  onChange,
  onRemove,
}: {
  slot: GallerySlot;
  slotIndex: number;
  value: string;
  onChange: (val: string, m: "scene" | "source") => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [imageItems, setImageItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [error, setError] = useState("");
  const [resolvingMediaId, setResolvingMediaId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refreshImages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await loadBackgroundMediaLibrary();
      setImageItems(items.filter((item) => isSelectableBackgroundMediaItem(item, "image")));
    } catch (err) {
      console.warn("[DockMultiview] Failed to load image slot media library", err);
      setImageItems([]);
      setError(t("multiview.imageLibraryLoadError", "Could not load saved images."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void refreshImages();
  }, [open, refreshImages]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    const handler = () => {
      if (open) void refreshImages();
    };
    window.addEventListener(MV_IMAGE_LIBRARY_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MV_IMAGE_LIBRARY_UPDATED_EVENT, handler);
  }, [open, refreshImages]);

  const selectedItem = imageItems.find((item) => isMediaItemSelectedForBackground(item, value));
  const selectedName = value ? getBackgroundMediaLabel(value) : "";
  const previewSrc = selectedItem ? getMediaItemPreviewSrc(selectedItem) : getInlineImagePreviewSrc(value);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleImageItems = normalizedQuery
    ? imageItems.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
    : imageItems;

  const handleUpload = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!file.type.startsWith("image/") && !BACKGROUND_IMAGE_EXTENSIONS.has(ext)) {
      setError(t("multiview.chooseImageFile", "Choose an image file."));
      return;
    }

    setUploading(true);
    setUploadStatus("");
    setError("");
    try {
      const { item, error: uploadError } = await uploadFileToDock(file, setUploadStatus);
      if (uploadError) throw new Error(uploadError);
      await registerDockMediaItem(item);
      const nextItems = dedupeBackgroundMediaItems(dedupeMediaItems([item, ...imageItems]))
        .filter((mediaItem) => isSelectableBackgroundMediaItem(mediaItem, "image"));
      setImageItems(nextItems);
      const diskPath = await resolveBackgroundMediaFilePath(item);
      onChange(diskPath, "scene");
      setOpen(false);
      window.dispatchEvent(new CustomEvent(MV_IMAGE_LIBRARY_UPDATED_EVENT));
    } catch (err) {
      console.warn("[DockMultiview] Image slot upload failed", err);
      setError(err instanceof Error ? err.message : t("multiview.imageUploadFailed", "Could not upload this image."));
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  }, [imageItems, onChange, t]);

  const handlePickerChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleUpload(file);
    event.target.value = "";
  }, [handleUpload]);

  const handleSelectImage = useCallback(async (item: MediaItem) => {
    if (uploading || resolvingMediaId !== null) return;
    setResolvingMediaId(item.id);
    setError("");
    try {
      const diskPath = await resolveBackgroundMediaFilePath(item);
      onChange(diskPath, "scene");
      setOpen(false);
    } catch (err) {
      console.warn("[DockMultiview] Failed to use library image for slot", err);
      setError(err instanceof Error ? err.message : t("multiview.imageSelectFailed", "Could not use this image."));
    } finally {
      setResolvingMediaId(null);
    }
  }, [onChange, resolvingMediaId, t, uploading]);

  const slotLabel = slot.label || t("multiview.contentN", { n: slotIndex + 1 });
  const hasImage = Boolean(value);

  return (
    <div className="dock-mv-slot-row dock-mv-slot-row--image">
      <div className="dock-mv-slot-row__main">
        <SlotTypeIcon contentType={slot.contentType} />
        <span className="dock-mv-slot-row__name">{slotLabel}</span>
        <div className="dock-mv-slot-row__spacer" />
        <div className="dock-mv-slot-image" ref={pickerRef}>
          <button
            type="button"
            className={`dock-mv-slot-image__trigger${hasImage ? " dock-mv-slot-image__trigger--selected" : ""}`}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            title={hasImage ? selectedName : t("multiview.chooseImage", "Choose image")}
          >
            <span className="dock-mv-slot-image__thumb" aria-hidden="true">
              {previewSrc ? (
                <img src={previewSrc} alt="" loading="lazy" />
              ) : (
                <Icon name="image" size={15} />
              )}
            </span>
            <span className="dock-mv-slot-image__copy">
              <span className="dock-mv-slot-image__label">{t("multiview.image", "Image")}</span>
              <span className={`dock-mv-slot-image__value${hasImage ? "" : " dock-mv-slot-image__value--empty"}`}>
                {hasImage ? selectedName : t("multiview.uploadImage", "Upload image")}
              </span>
            </span>
            <Icon name={open ? "expand_less" : "expand_more"} size={14} />
          </button>

          {open && (
            <div className="dock-mv-slot-image__popover">
              <div className="dock-mv-slot-image__head">
                <span>{t("multiview.savedImages", "Saved images")} · {imageItems.length}</span>
                <button type="button" onClick={() => void refreshImages()} disabled={loading || uploading}>
                  <Icon name="refresh" size={12} />
                  <span>{loading ? t("common.loading", "Loading") : t("common.refresh", "Refresh")}</span>
                </button>
              </div>

              <button
                type="button"
                className="dock-mv-slot-image__upload"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Icon name={uploading ? "hourglass_top" : "upload"} size={14} />
                <span>{uploading ? (uploadStatus || t("multiview.savingImage", "Saving image...")) : t("multiview.uploadImage", "Upload image")}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="dock-mv-bg__file-hidden"
                onChange={handlePickerChange}
              />

              {imageItems.length > 6 && (
                <div className="dock-mv-slot-image__search">
                  <Icon name="search" size={13} />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("multiview.searchSavedImages", "Search saved images...")}
                  />
                </div>
              )}

              {loading ? (
                <div className="dock-mv-slot-image__status" role="status">
                  <Icon name="hourglass_top" size={14} />
                  <span>{t("multiview.loadingSavedImages", "Loading saved images...")}</span>
                </div>
              ) : visibleImageItems.length > 0 ? (
                <div className="dock-mv-slot-image__list">
                  {visibleImageItems.map((item) => {
                    const selected = isMediaItemSelectedForBackground(item, value);
                    const resolving = resolvingMediaId === item.id;
                    const itemPreviewSrc = getMediaItemPreviewSrc(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`dock-mv-slot-image__item${selected ? " dock-mv-slot-image__item--selected" : ""}`}
                        onClick={() => void handleSelectImage(item)}
                        disabled={uploading || resolvingMediaId !== null}
                        title={item.name}
                      >
                        <span className="dock-mv-slot-image__item-thumb">
                          <img src={itemPreviewSrc} alt="" loading="lazy" />
                        </span>
                        <span className="dock-mv-slot-image__item-copy">
                          <span className="dock-mv-slot-image__item-name">{item.name}</span>
                          <span className="dock-mv-slot-image__item-meta">
                            {resolving ? t("common.selecting", "Selecting...") : formatMediaItemMeta(item)}
                          </span>
                        </span>
                        <Icon name={selected ? "check" : "arrow_forward"} size={13} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="dock-mv-slot-image__status">
                  <Icon name="image" size={14} />
                  <span>
                    {imageItems.length > 0
                      ? t("multiview.noSavedImageMatches", "No saved image matches that search.")
                      : t("multiview.noSavedImages", "No saved images yet.")}
                  </span>
                </div>
              )}

              {hasImage && (
                <button
                  type="button"
                  className="dock-mv-slot-image__clear"
                  onClick={() => {
                    onRemove();
                    setOpen(false);
                  }}
                >
                  {t("multiview.clearImage", "Clear image")}
                </button>
              )}

              {error && <div className="dock-mv-slot-image__error">{error}</div>}
            </div>
          )}
        </div>
        {hasImage && (
          <SlotContentMenu
            onSelect={() => setOpen(true)}
            onRemove={() => {
              onRemove();
              setOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function SlotControl({
  slot,
  slotIndex,
  value,
  mode,
  framing,
  onSelect,
  onChange,
  onFramingChange,
  onRemove,
  obsScenes,
  obsSources,
}: {
  slot: GallerySlot;
  slotIndex: number;
  value: string;
  mode: "scene" | "source";
  framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number };
  onSelect: () => void;
  onChange: (val: string, m: "scene" | "source") => void;
  onFramingChange: (f: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }) => void;
  onRemove: () => void;
  obsScenes: string[];
  obsSources: string[];
}) {
  const { t } = useTranslation();

  const hasValue = Boolean(value);
  const isLegacySource = mode === "source";
  const valueExistsInObs = hasValue && (mode === "scene" ? obsScenes.includes(value) : obsSources.includes(value));
  const displayValue = formatMvContentLabel(value);

  if (isSceneType(slot.contentType)) {
    return (
      <div className="dock-mv-slot-row">
        <div className="dock-mv-slot-row__main">
          <SlotTypeIcon contentType={slot.contentType} />
          <span className="dock-mv-slot-row__name">{slot.label || t('multiview.contentN', { n: slotIndex + 1 })}</span>
          <div className="dock-mv-slot-row__spacer" />
          {!hasValue && (
            <button type="button" className="dock-mv-slot-row__add-btn" onClick={onSelect} title={t('multiview.addContent')}>
              <Icon name="add" size={14} />
            </button>
          )}
          {hasValue && (
            <>
              <span
                className={`dock-mv-slot-row__selected-name${valueExistsInObs ? "" : " dock-mv-slot-row__selected-name--unknown"}`}
                title={valueExistsInObs ? value : `${value} (${t('multiview.notSeenInObs', 'not seen in current OBS scan')})`}
              >
                {displayValue}
              </span>
              {!isLegacySource && (
                <button
                  type="button"
                  className="dock-mv-slot-row__framing-btn"
                  onClick={() => onFramingChange(framing)}
                  title={t('multiview.adjustFraming')}
                  aria-label={t('multiview.adjustFraming')}
                >
                  <Icon name="crop" size={14} />
                </button>
              )}
              <SlotContentMenu onSelect={onSelect} onRemove={onRemove} />
            </>
          )}
        </div>
      </div>
    );
  }

  if (slot.contentType === "image") {
    return (
      <ImageSlotControl
        slot={slot}
        slotIndex={slotIndex}
        value={value}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }

  // Browser slots keep URL input because they map to OBS browser sources.
  if (slot.contentType === "browser") {
    return (
      <div className="dock-mv-slot-row">
        <div className="dock-mv-slot-row__main">
          <SlotTypeIcon contentType={slot.contentType} />
          <span className="dock-mv-slot-row__name">{slot.label || t('multiview.contentN', { n: slotIndex + 1 })}</span>
          <div className="dock-mv-slot-row__spacer" />
          <input
            className="dock-mv-slot-row__input"
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value, "scene")}
            placeholder={t('multiview.urlPlaceholder')}
          />
          {hasValue ? (
            <SlotContentMenu onSelect={onSelect} onRemove={onRemove} />
          ) : (
            <button type="button" className="dock-mv-slot-row__add-btn" onClick={onSelect} title={t('multiview.addContent')}>
              <Icon name="add" size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dock-mv-slot-row">
      <div className="dock-mv-slot-row__main">
        <SlotTypeIcon contentType={slot.contentType} />
        <span className="dock-mv-slot-row__name">{slot.label || t('multiview.contentN', { n: slotIndex + 1 })}</span>
        <div className="dock-mv-slot-row__spacer" />
        <input
          className="dock-mv-slot-row__input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value, "scene")}
          placeholder={t('multiview.value')}
        />
        {hasValue ? (
          <SlotContentMenu onSelect={onSelect} onRemove={onRemove} />
        ) : (
          <button type="button" className="dock-mv-slot-row__add-btn" onClick={onSelect} title={t('multiview.addContent')}>
            <Icon name="add" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Confirmation Modal
// ---------------------------------------------------------------------------

function DeleteModal({
  mvName,
  onConfirm,
  onCancel,
}: {
  mvName: string;
  onConfirm: (deleteObsScene: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [deleteObs, setDeleteObs] = useState(false);

  const modalContent = (
    <div className="dock-mv-modal-overlay" onClick={onCancel}>
      <div className="dock-mv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dock-mv-modal__header">
          <Icon name="warning" size={16} />
          <span className="dock-mv-modal__title">{t('multiview.deleteLayout')}</span>
        </div>
        <p className="dock-mv-modal__body">
          {t('multiview.areYouSure')} <strong>{mvName}</strong>?
          <br />
          <span style={{ color: "var(--dock-text-dim)", fontSize: 10 }}>{t('multiview.deleteConfirm')}</span>
        </p>
        <label className="dock-mv-modal__checkbox">
          <input
            type="checkbox"
            checked={deleteObs}
            onChange={(e) => setDeleteObs(e.target.checked)}
          />
          <span>{t('multiview.alsoDeleteScene')}</span>
        </label>
        <div className="dock-mv-modal__actions">
          <button type="button" className="dock-btn dock-btn--sm" onClick={onCancel} title={t('common.cancel')}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--sm dock-btn--danger"
            onClick={() => onConfirm(deleteObs)}
            title={t('common.delete')}>
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ---------------------------------------------------------------------------
// Background Section — collapsed card + modal editor
// ---------------------------------------------------------------------------

const BG_TYPE_OPTIONS: Array<{ type: MVBgType | "none"; labelKey: string; icon: string }> = [
  { type: "none", labelKey: "multiview.bgNone", icon: "block" },
  { type: "color", labelKey: "multiview.bgColor", icon: "palette" },
  { type: "image", labelKey: "multiview.bgImage", icon: "image" },
  { type: "video", labelKey: "multiview.bgVideo", icon: "movie" },
  { type: "pattern", labelKey: "common.pattern", icon: "grid_view" },
  { type: "scene", labelKey: "multiview.bgScene", icon: "grid_view" },
];

function getPatternLabel(src: string): string {
  return BACKGROUND_PATTERNS.find((pattern) => pattern.src === src)?.label || "Pattern";
}

function BackgroundSection({
  background,
  onChange,
  obsScenes,
}: {
  background: MVBackground;
  onChange: (bg: MVBackground) => void;
  obsScenes: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [libraryMedia, setLibraryMedia] = useState<MediaItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [mediaLibraryError, setMediaLibraryError] = useState("");
  const [resolvingMediaId, setResolvingMediaId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<string | null>(null);
  const [mediaQuery, setMediaQuery] = useState("");

  const hasBg = background.type === "color"
    ? background.color !== "#0F172A" && background.color !== "transparent"
    : background.type === "scene"
      ? Boolean(background.sceneName)
      : background.type === "pattern"
        ? Boolean(background.patternSrc)
        : Boolean(background.filePath);

  const isMediaType = background.type === "image" || background.type === "video";
  const isPatternType = background.type === "pattern";
  const mediaType = background.type === "video" ? "video" : "image";

  const refreshMediaLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setMediaLibraryError("");
    try {
      const items = await loadBackgroundMediaLibrary();
      setLibraryMedia(items);
    } catch (err) {
      console.warn("[DockMultiview] Failed to load background media library", err);
      setMediaLibraryError("Could not load saved media.");
      setLibraryMedia([]);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !isMediaType) return;
    void refreshMediaLibrary();
  }, [isMediaType, open, refreshMediaLibrary]);

  useEffect(() => {
    setMediaQuery("");
  }, [mediaType]);

  const handleFileUpload = useCallback(async (file: File, type: "image" | "video") => {
    setUploading(true);
    setUploadStatus("");
    setMediaLibraryError("");
    try {
      const { item, error } = await uploadFileToDock(file, setUploadStatus);
      if (error) throw new Error(error);
      await registerDockMediaItem(item);
      setLibraryMedia((current) => dedupeMediaItems([item, ...current]));
      const diskPath = await resolveBackgroundMediaFilePath(item);
      onChange({ ...background, type, filePath: diskPath, sceneName: "" });
    } catch (err) {
      console.warn("[DockMultiview] Background upload failed", err);
      setMediaLibraryError(err instanceof Error ? err.message : "Could not save media.");
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  }, [background, onChange]);

  const handlePickerChange = useCallback((event: ChangeEvent<HTMLInputElement>, type: "image" | "video") => {
    const file = event.target.files?.[0];
    if (file) void handleFileUpload(file, type);
    event.target.value = "";
  }, [handleFileUpload]);

  const matchesBackgroundMediaType = (file: File, type: "image" | "video"): boolean => {
    if (type === "image") return file.type.startsWith("image/");
    return file.type.startsWith("video/");
  };

  const handleMediaDrop = useCallback((event: DragEvent<HTMLLabelElement>, type: "image" | "video") => {
    event.preventDefault();
    setDraggingType(null);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (!file || !matchesBackgroundMediaType(file, type)) return;
    void handleFileUpload(file, type);
  }, [handleFileUpload, uploading]);

  const handleSelectLibraryMedia = useCallback(async (item: MediaItem) => {
    if (uploading || resolvingMediaId) return;
    setResolvingMediaId(item.id);
    setMediaLibraryError("");
    try {
      if (item.type !== "image" && item.type !== "video") {
        throw new Error("Only image and video files can be used as a multiview background.");
      }
      const diskPath = await resolveBackgroundMediaFilePath(item);
      onChange({ ...background, type: item.type, filePath: diskPath, sceneName: "" });
    } catch (err) {
      console.warn("[DockMultiview] Failed to use library media as background", err);
      setMediaLibraryError(err instanceof Error ? err.message : "Could not use this media file.");
    } finally {
      setResolvingMediaId(null);
    }
  }, [background, onChange, resolvingMediaId, uploading]);

  const bgLabel = background.type === "color" ? t('multiview.bgColor')
    : background.type === "image" ? t('multiview.bgImage')
      : background.type === "video" ? t('multiview.bgVideo')
        : background.type === "pattern" ? t('common.pattern')
          : background.type === "scene" ? t('multiview.bgScene')
            : "";

  const bgValue = background.type === "color" ? background.color
    : background.type === "pattern" ? getPatternLabel(background.patternSrc)
      : background.type === "scene" ? background.sceneName
        : "";

  const selectedMediaName = background.filePath ? getBackgroundMediaLabel(background.filePath) : "";
  const hasSelectedMedia = selectedMediaName.length > 0;
  const mediaTitle = mediaType === "image" ? "Choose background image" : "Choose background video";
  const mediaHint = mediaType === "image"
    ? "Drop an image here or click to browse. PNG, JPG, WEBP, SVG."
    : "Drop a video here or click to browse. MP4, MOV, WEBM, M4V.";
  const mediaLibraryItems = libraryMedia.filter((item) => isSelectableBackgroundMediaItem(item, mediaType));
  const normalizedMediaQuery = mediaQuery.trim().toLowerCase();
  const visibleMediaLibraryItems = normalizedMediaQuery
    ? mediaLibraryItems.filter((item) => item.name.toLowerCase().includes(normalizedMediaQuery))
    : mediaLibraryItems;
  const selectedMediaItem = mediaLibraryItems.find((item) => isMediaItemSelectedForBackground(item, background.filePath));
  const selectedMediaPreviewSrc = selectedMediaItem ? getMediaItemPreviewSrc(selectedMediaItem) : "";
  const selectableObsScenes = obsScenes.filter((sceneName) => !isMultiviewManagedSceneName(sceneName));
  const selectedType = background.type === "color" && (background.color === "transparent" || background.color === "#0F172A")
    ? "none"
    : background.type;

  const handleTypeChange = (type: MVBgType | "none") => {
    if (type === "none") {
      onChange({ ...DEFAULT_MV_BG });
      return;
    }
    onChange({
      ...background,
      type,
      color: type === "color" ? (background.color === "transparent" ? "#0F172A" : background.color) : background.color,
      filePath: type === "image" || type === "video" ? background.filePath : "",
      patternSrc: type === "pattern" ? (background.patternSrc || BACKGROUND_PATTERNS[0]?.src || "") : "",
      sceneName: type === "scene" ? background.sceneName : "",
    });
  };

  return (
    <div className="dock-mv-property">
      <span className="dock-mv-property__label">{t('multiview.background')}</span>
      <div className="dock-mv-property__row">
        {hasBg ? (
          <span className="dock-mv-property__value">{bgLabel}{bgValue ? `: ${bgValue}` : ""}</span>
        ) : (
          <span className="dock-mv-property__value dock-mv-property__value--empty">{t('multiview.noBackground')}</span>
        )}
        <button type="button" className="dock-mv-property__action" onClick={() => setOpen(true)}>
          {hasBg ? t('multiview.change') : `+ ${t('multiview.addBackground')}`}
        </button>
      </div>

      {/* Modal editor (same as before) */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="dock-mv-modal-overlay" onClick={() => setOpen(false)}>
          <div className="dock-mv-bg-editor" onClick={(e) => e.stopPropagation()}>
            <div className="dock-mv-bg-editor__header">
              <span className="dock-mv-bg-editor__title">{t('multiview.chooseBackground')}</span>
              <button type="button" className="dock-mv-bg-editor__close" onClick={() => setOpen(false)}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="dock-mv-bg-editor__type-select-wrap">
              <label htmlFor="dock-mv-background-type" className="dock-mv-bg-editor__type-label">Background type</label>
              <div className="dock-mv-bg-editor__type-select-control">
                <Icon name={BG_TYPE_OPTIONS.find((option) => option.type === selectedType)?.icon || "layers"} size={14} />
                <select
                  id="dock-mv-background-type"
                  className="dock-mv-bg-editor__type-select"
                  value={selectedType}
                  onChange={(event) => handleTypeChange(event.target.value as MVBgType | "none")}
                >
                  {BG_TYPE_OPTIONS.map((option) => (
                    <option key={option.type} value={option.type}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>
            </div>

            {background.type === "color" && (
              <div className="dock-mv-bg-editor__row">
                <input
                  type="color"
                  className="dock-mv-bg__color-input"
                  value={background.color}
                  onChange={(e) => onChange({ ...background, color: e.target.value })}
                />
                <input
                  className="dock-mv-bg__hex"
                  type="text"
                  value={background.color}
                  onChange={(e) => onChange({ ...background, color: e.target.value })}
                  placeholder="#0F172A"
                />
              </div>
            )}

            {isMediaType && (
              <div className="dock-mv-bg-editor__media">
                <div className="dock-mv-bg-editor__library-head">
                  <span>
                    {mediaType === "image" ? "Saved images" : "Saved videos"} · {mediaLibraryItems.length}
                  </span>
                  <button type="button" onClick={() => void refreshMediaLibrary()} disabled={libraryLoading}>
                    <Icon name="refresh" size={12} />
                    <span>{libraryLoading ? "Loading" : "Refresh"}</span>
                  </button>
                </div>
                {mediaLibraryItems.length > 8 && (
                  <div className="dock-mv-bg-editor__library-search">
                    <Icon name="search" size={13} />
                    <input
                      type="search"
                      value={mediaQuery}
                      onChange={(event) => setMediaQuery(event.target.value)}
                      placeholder={mediaType === "image" ? "Search saved images..." : "Search saved videos..."}
                    />
                  </div>
                )}
                {libraryLoading ? (
                  <div className="dock-mv-bg-editor__library-status" role="status">
                    <Icon name="hourglass_top" size={14} />
                    <span>Loading saved media...</span>
                  </div>
                ) : visibleMediaLibraryItems.length > 0 ? (
                  <div className="dock-mv-bg-editor__library-grid">
                    {visibleMediaLibraryItems.map((item) => {
                      const selected = isMediaItemSelectedForBackground(item, background.filePath);
                      const resolving = resolvingMediaId === item.id;
                      const previewSrc = getMediaItemPreviewSrc(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`dock-mv-bg-editor__library-item${selected ? " dock-mv-bg-editor__library-item--selected" : ""}`}
                          onClick={() => void handleSelectLibraryMedia(item)}
                          disabled={uploading || resolvingMediaId !== null}
                          title={item.name}
                        >
                          <span className="dock-mv-bg-editor__library-thumb">
                            {item.type === "image" ? (
                              <img src={previewSrc} alt="" loading="lazy" />
                            ) : (
                              <video src={previewSrc} muted playsInline preload="metadata" />
                            )}
                          </span>
                          <span className="dock-mv-bg-editor__library-copy">
                            <span className="dock-mv-bg-editor__library-name">{item.name}</span>
                            <span className="dock-mv-bg-editor__library-meta">{resolving ? "Selecting..." : formatMediaItemMeta(item)}</span>
                          </span>
                          <span className="dock-mv-bg-editor__library-check">
                            <Icon name={selected ? "check" : "arrow_forward"} size={13} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="dock-mv-bg-editor__library-status">
                    <Icon name={mediaType === "image" ? "image" : "movie"} size={14} />
                    <span>{mediaLibraryItems.length > 0 ? "No media matches that search." : mediaType === "image" ? "No saved images yet." : "No saved videos yet."}</span>
                  </div>
                )}
                <label
                  className={[
                    "dock-mv-bg-editor__media-card",
                    draggingType === mediaType ? "dock-mv-bg-editor__media-card--dragging" : "",
                    hasSelectedMedia ? "dock-mv-bg-editor__media-card--selected" : "",
                    uploading ? "dock-mv-bg-editor__media-card--busy" : "",
                  ].filter(Boolean).join(" ")}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    if (!uploading) setDraggingType(mediaType);
                  }}
                  onDragLeave={() => setDraggingType((current) => current === mediaType ? null : current)}
                  onDrop={(event) => void handleMediaDrop(event, mediaType)}
                  aria-busy={uploading}
                >
                  {hasSelectedMedia && selectedMediaPreviewSrc ? (
                    <span className="dock-mv-bg-editor__media-selected-thumb">
                      {mediaType === "image" ? (
                        <img src={selectedMediaPreviewSrc} alt="" />
                      ) : (
                        <video src={selectedMediaPreviewSrc} muted playsInline preload="metadata" />
                      )}
                    </span>
                  ) : (
                    <div className="dock-mv-bg-editor__media-icon">
                      <Icon name={uploading ? "hourglass_top" : mediaType === "image" ? "image" : "movie"} size={18} />
                    </div>
                  )}
                  <div className="dock-mv-bg-editor__media-copy">
                    <div className="dock-mv-bg-editor__media-title">
                      {uploading ? (uploadStatus || "Saving original media...") : hasSelectedMedia ? selectedMediaName : mediaTitle}
                    </div>
                    <div className="dock-mv-bg-editor__media-hint">{hasSelectedMedia ? "" : mediaHint}</div>
                  </div>
                  <span className="dock-mv-bg-editor__media-cta">
                    {uploading ? "Saving..." : hasSelectedMedia ? t('multiview.browseAndUpload') : t('common.upload')}
                  </span>
                  <input
                    ref={mediaType === "image" ? imgInputRef : vidInputRef}
                    type="file"
                    accept={mediaType === "image" ? "image/*" : "video/*"}
                    className="dock-mv-bg__file-hidden"
                    onChange={(event) => handlePickerChange(event, mediaType)}
                  />
                </label>
                {hasSelectedMedia && (
                  <button
                    type="button"
                    className="dock-mv-bg-editor__clear"
                    onClick={() => onChange({ ...background, filePath: "" })}
                  >
                    {t('common.clear')}
                  </button>
                )}
                {mediaLibraryError && (
                  <div className="dock-mv-bg-editor__library-error">{mediaLibraryError}</div>
                )}
              </div>
            )}

            {isPatternType && (
              <div className="dock-mv-bg-editor__visual-section">
                <div className="dock-mv-bg-editor__visual-section-head">
                  <span>Patterns</span>
                  <span>{BACKGROUND_PATTERNS.length}</span>
                </div>
                <div className="dock-mv-bg-editor__visual-grid dock-mv-bg-editor__visual-grid--patterns">
                  {BACKGROUND_PATTERNS.map((pattern) => {
                    const selected = background.patternSrc === pattern.src;
                    return (
                      <button
                        key={pattern.label}
                        type="button"
                        className={`dock-mv-bg-editor__visual-card${selected ? " dock-mv-bg-editor__visual-card--selected" : ""}`}
                        onClick={() => onChange({ ...background, type: "pattern", patternSrc: pattern.src, filePath: "", sceneName: "" })}
                        title={pattern.label}
                      >
                        <img src={pattern.src} alt="" loading="lazy" />
                        <span>{pattern.label}</span>
                        {selected && <Icon name="check" size={13} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {background.type === "scene" && (
              <div className="dock-mv-bg-editor__visual-section">
                <div className="dock-mv-bg-editor__visual-section-head">
                  <span>Scenes</span>
                  <span>{selectableObsScenes.length}</span>
                </div>
                {selectableObsScenes.length > 0 ? (
                  <div className="dock-mv-bg-editor__visual-grid dock-mv-bg-editor__visual-grid--scenes">
                    {selectableObsScenes.map((sceneName) => {
                      const selected = background.sceneName === sceneName;
                      return (
                        <button
                          key={sceneName}
                          type="button"
                          className={`dock-mv-bg-editor__visual-card dock-mv-bg-editor__visual-card--scene${selected ? " dock-mv-bg-editor__visual-card--selected" : ""}`}
                          onClick={() => onChange({ ...background, type: "scene", sceneName, filePath: "", patternSrc: "" })}
                          title={sceneName}
                        >
                          <Icon name="grid_view" size={18} />
                          <span>{sceneName}</span>
                          {selected && <Icon name="check" size={13} />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="dock-mv-bg-editor__library-status">
                    <Icon name="grid_view" size={14} />
                    <span>{t('multiview.selectScene')}</span>
                  </div>
                )}
              </div>
            )}

            <div className="dock-mv-bg-editor__actions">
              <button type="button" className="dock-btn dock-btn--sm dock-btn--primary" onClick={() => setOpen(false)}>
                {t('common.done')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper (Minus / Plus Increaser)
// ---------------------------------------------------------------------------

function NumberStepper({
  value,
  min = 0,
  max = 80,
  step = 1,
  unit = "px",
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
  label: string;
}) {
  return (
    <div className="dock-mv-stepper">
      <div className="dock-mv-stepper__control">
        <button
          type="button"
          className="dock-mv-stepper__btn"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          aria-label={`Decrease ${label}`}
          title={`Decrease ${label}`}
        >
          <Icon name="remove" size={13} />
        </button>
        <span className="dock-mv-stepper__val">{value}{unit}</span>
        <button
          type="button"
          className="dock-mv-stepper__btn"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          aria-label={`Increase ${label}`}
          title={`Increase ${label}`}
        >
          <Icon name="add" size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spacing Modal — triggered via button/icon, not permanently taking up card space
// ---------------------------------------------------------------------------

function SpacingModal({
  open,
  margin,
  slotGap,
  affectBackground,
  onChangeMargin,
  onChangeSlotGap,
  onToggleAffectBackground,
  onClose,
}: {
  open: boolean;
  margin: number;
  slotGap: number;
  affectBackground: boolean;
  onChangeMargin: (m: number) => void;
  onChangeSlotGap: (gap: number) => void;
  onToggleAffectBackground: (affect: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  const marginPresets = [0, 5, 12, 20, 40];
  const gapPresets = [0, 5, 10, 16, 24];

  const modalContent = (
    <div className="dock-mv-modal-overlay" onClick={onClose}>
      <div className="dock-mv-content-picker dock-mv-spacing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dock-mv-content-picker__header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="aspect_ratio" size={16} />
            <span className="dock-mv-content-picker__title">Spacing & Layout Margins</span>
          </div>
          <button type="button" className="dock-mv-content-picker__close" onClick={onClose} title={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="dock-mv-spacing-body">
          {/* Outer Margin */}
          <div className="dock-mv-spacing-group">
            <div className="dock-mv-spacing-group-head">
              <div className="dock-mv-spacing-group-info">
                <span className="dock-mv-spacing-group-title">Outer Margin</span>
                <span className="dock-mv-spacing-group-desc">Spacing around the canvas edges</span>
              </div>
              <NumberStepper
                label="Outer Margin"
                value={margin}
                min={0}
                max={80}
                step={1}
                onChange={onChangeMargin}
              />
            </div>
            <div className="dock-mv-margin-slider-row">
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={margin}
                onChange={(e) => onChangeMargin(parseInt(e.target.value, 10) || 0)}
                className="dock-mv-margin-slider"
                aria-label="Outer margin slider"
              />
            </div>
            <div className="dock-mv-margin-presets">
              {marginPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`dock-mv-margin-preset-chip${margin === preset ? " dock-mv-margin-preset-chip--active" : ""}`}
                  onClick={() => onChangeMargin(preset)}
                >
                  {preset === 0 ? "None" : `${preset}px`}
                </button>
              ))}
            </div>
          </div>

          {/* Inner Gap / Space Between Elements */}
          <div className="dock-mv-spacing-group">
            <div className="dock-mv-spacing-group-head">
              <div className="dock-mv-spacing-group-info">
                <span className="dock-mv-spacing-group-title">Inner Gap</span>
                <span className="dock-mv-spacing-group-desc">Spacing between camera slots</span>
              </div>
              <NumberStepper
                label="Inner Gap"
                value={slotGap}
                min={0}
                max={48}
                step={1}
                onChange={onChangeSlotGap}
              />
            </div>
            <div className="dock-mv-margin-slider-row">
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={slotGap}
                onChange={(e) => onChangeSlotGap(parseInt(e.target.value, 10) || 0)}
                className="dock-mv-margin-slider"
                aria-label="Inner gap slider"
              />
            </div>
            <div className="dock-mv-margin-presets">
              {gapPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`dock-mv-margin-preset-chip${slotGap === preset ? " dock-mv-margin-preset-chip--active" : ""}`}
                  onClick={() => onChangeSlotGap(preset)}
                >
                  {preset === 0 ? "None" : `${preset}px`}
                </button>
              ))}
            </div>
          </div>

          {/* Affect Background toggle */}
          <div
            className={`dock-mv-affect-bg-card${affectBackground ? " dock-mv-affect-bg-card--active" : ""}`}
            onClick={() => onToggleAffectBackground(!affectBackground)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleAffectBackground(!affectBackground);
              }
            }}
          >
            <div className="dock-mv-affect-bg-head">
              <div className="dock-mv-affect-bg-title-wrap">
                <div className="dock-mv-affect-bg-icon">
                  <Icon name={affectBackground ? "fit_screen" : "crop_free"} size={13} />
                </div>
                <span className="dock-mv-affect-bg-title">Affect Background</span>
              </div>
              <div className={`dock-mv-switch${affectBackground ? " dock-mv-switch--active" : ""}`} aria-hidden="true">
                <div className="dock-mv-switch-knob" />
              </div>
            </div>
            <p className="dock-mv-affect-bg-desc">
              {affectBackground
                ? "Background shrinks with margin (lightbox border effect)."
                : "Background stays full screen edge-to-edge behind slots."}
            </p>
          </div>
        </div>

        <div className="dock-mv-spacing-footer">
          {(margin !== DEFAULT_MULTIVIEW_MARGIN || slotGap !== DEFAULT_MULTIVIEW_SLOT_GAP) && (
            <button
              type="button"
              className="dock-btn dock-btn--sm"
              onClick={() => {
                onChangeMargin(DEFAULT_MULTIVIEW_MARGIN);
                onChangeSlotGap(DEFAULT_MULTIVIEW_SLOT_GAP);
              }}
              style={{ background: "transparent", border: "1px solid var(--dock-border)" }}
            >
              Reset All
            </button>
          )}
          <button
            type="button"
            className="dock-btn dock-btn--sm dock-btn--primary"
            onClick={onClose}
            style={{ marginLeft: "auto" }}
          >
            {t("common.done", "Done")}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ---------------------------------------------------------------------------
// Frame Picker Modal
// ---------------------------------------------------------------------------

function FramePreviewThumb({ frame }: { frame: MultiviewFrame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 90, 60);
    drawFrameLayers(ctx, frame, 0, 0, 90, 60, 0.7, 0, 100, "");
  }, [frame]);

  return <canvas ref={ref} width={90} height={60} style={{ width: 68, height: 45, borderRadius: 2 }} />;
}

function FramePicker({
  open,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  selectedId: string | null;
  onSelect: (frameId: string | null) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState<"all" | "clean" | "broadcast" | "glow" | "decorative">("all");
  if (!open) return null;

  const filtered = cat === "all" ? FRAME_LIBRARY : FRAME_LIBRARY.filter(f => f.category === cat);

  const modalContent = (
    <div className="dock-mv-modal-overlay" onClick={onClose}>
      <div className="dock-mv-content-picker" onClick={(e) => e.stopPropagation()}>
        <div className="dock-mv-content-picker__header">
          <span className="dock-mv-content-picker__title">Choose Frame</span>
          <button type="button" className="dock-mv-content-picker__close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-mv-content-picker__tabs" style={{ paddingBottom: 4 }}>
          {FRAME_CATEGORIES.map(c => (
            <button
              key={c.key}
              type="button"
              className={`dock-mv-content-picker__tab${cat === c.key ? " dock-mv-content-picker__tab--active" : ""}`}
              onClick={() => setCat(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="dock-mv-content-picker__list" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, padding: 8 }}>
          {filtered.map(frame => {
            const isSelected = selectedId === frame.id;
            return (
              <button
                key={frame.id}
                type="button"
                onClick={() => onSelect(frame.id)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  padding: 10, borderRadius: 4, border: isSelected ? "1px solid var(--dock-accent)" : "1px solid var(--dock-border)",
                  background: isSelected ? "var(--dock-accent-bg, rgba(99,102,241,0.1))" : "transparent",
                  cursor: "pointer",
                }}
              >
                <FramePreviewThumb frame={frame} />
                <span style={{ fontSize: 10, color: "var(--dock-text-dim)", textAlign: "center" }}>{frame.name}</span>
              </button>
            );
          })}
        </div>
        <div style={{ padding: 8, borderTop: "1px solid var(--dock-border)" }}>
          <button
            type="button"
            className="dock-btn dock-btn--sm"
            style={{ width: "100%" }}
            onClick={() => onSelect(null)}
          >
            No Frame
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ---------------------------------------------------------------------------
// MV Template Dropdown — custom dropdown with reload button & hover-to-delete
// ---------------------------------------------------------------------------

function MVTemplateDropdown({
  value,
  layout,
  addedLayouts,
  onSelect,
  onReloadTemplates,
  onDeleteTemplate,
  isReloading = false,
}: {
  value: string;
  layout?: GalleryLayout;
  addedLayouts: GalleryLayout[];
  onSelect: (layoutId: string) => void;
  onReloadTemplates?: () => void;
  onDeleteTemplate?: (layoutId: string) => void;
  isReloading?: boolean;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 200 });

  const allTemplates = useMemo(() => {
    if (layout && !addedLayouts.some((l) => l.id === layout.id)) {
      return [layout, ...addedLayouts];
    }
    return addedLayouts;
  }, [addedLayouts, layout]);

  const selectedLayout = useMemo(() => {
    return allTemplates.find((l) => l.id === value);
  }, [allTemplates, value]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 240);
    const estimatedHeight = Math.min(320, 52 + (allTemplates.length + 1) * 32);
    const fitsBelow = rect.bottom + estimatedHeight + 8 <= window.innerHeight;
    const top = fitsBelow
      ? rect.bottom + 4
      : Math.max(8, rect.top - estimatedHeight - 4);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    setPosition({ top, left, width });
  }, [allTemplates.length]);

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    document.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <div className="dock-mv-property">
      <div className="dock-mv-property__header">
        <span className="dock-mv-property__label">{t('multiview.template')}</span>
        {onReloadTemplates && (
          <button
            type="button"
            className="dock-mv-property__reload-btn"
            onClick={onReloadTemplates}
            title={t('multiview.reloadTemplates', 'Reload templates')}
            aria-label={t('multiview.reloadTemplates', 'Reload templates')}
            disabled={isReloading}
          >
            <Icon name="refresh" size={13} className={isReloading ? "dock-mv-spin" : ""} />
          </button>
        )}
      </div>

      <button
        ref={triggerRef}
        type="button"
        className={`dock-mv-property__select dock-mv-property__select--visible dock-mv-template-trigger ${isOpen ? "dock-mv-template-trigger--open" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selectedLayout && (
          <span className="dock-mv-template-trigger__preview" aria-hidden="true">
            <LayoutMiniPreview layout={selectedLayout} />
          </span>
        )}
        <span className={`dock-mv-template-trigger__label ${!selectedLayout ? "dock-mv-template-trigger__label--empty" : ""}`}>
          {selectedLayout?.name ?? `— ${t('multiview.selectTemplate')} —`}
        </span>
        <Icon name={isOpen ? "expand_less" : "expand_more"} size={14} className="dock-mv-template-trigger__chevron" />
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="dock-mv-template-dropdown"
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
          }}
          role="listbox"
        >
          {onReloadTemplates && (
            <>
              <div className="dock-mv-template-dropdown__action-bar">
                <span className="dock-mv-template-dropdown__count">
                  {allTemplates.length} {allTemplates.length === 1 ? "template" : "templates"}
                </span>
                <button
                  type="button"
                  className="dock-mv-template-dropdown__action-reload"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReloadTemplates();
                  }}
                  title={t('multiview.reloadTemplates', 'Reload templates')}
                  disabled={isReloading}
                >
                  <Icon name="refresh" size={12} className={isReloading ? "dock-mv-spin" : ""} />
                  <span>{t('common.reload', 'Reload')}</span>
                </button>
              </div>
              <div className="dock-mv-slot-row__dropdown-divider" />
            </>
          )}

          <div className="dock-mv-template-dropdown__list">
            <div
              className={`dock-mv-template-item ${!value ? "dock-mv-template-item--selected" : ""}`}
              onClick={() => {
                onSelect("");
                setIsOpen(false);
              }}
              role="option"
              aria-selected={!value}
            >
              <span className="dock-mv-template-item__check">
                {!value && <Icon name="check" size={13} />}
              </span>
              <span className="dock-mv-template-item__preview dock-mv-template-item__preview--muted" aria-hidden="true">
                <span className="dock-mv-template-item__preview-placeholder">
                  <Icon name="apps" size={13} />
                </span>
              </span>
              <span className="dock-mv-template-item__name dock-mv-template-item__name--muted">
                — {t('multiview.selectTemplate')} —
              </span>
            </div>

            {allTemplates.map((l) => {
              const isSelected = value === l.id;
              return (
                <div
                  key={l.id}
                  className={`dock-mv-template-item ${isSelected ? "dock-mv-template-item--selected" : ""}`}
                  onClick={() => {
                    onSelect(l.id);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="dock-mv-template-item__check">
                    {isSelected && <Icon name="check" size={13} />}
                  </span>
                  <span className="dock-mv-template-item__preview" aria-hidden="true">
                    <LayoutMiniPreview layout={l} />
                  </span>
                  <span className="dock-mv-template-item__name">{l.name}</span>
                  {onDeleteTemplate && !isScriptureCircleLayoutId(l.id) && !isScriptureArchLayoutId(l.id) && !isScriptureGoldCircleLayoutId(l.id) && !isCustomLookLayoutId(l.id) && (
                    <button
                      type="button"
                      className="dock-mv-template-item__delete-btn"
                      title={t('multiview.deleteTemplate', 'Delete template')}
                      aria-label={t('multiview.deleteTemplate', 'Delete template')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (value === l.id) {
                          onSelect("");
                        }
                        onDeleteTemplate(l.id);
                      }}
                    >
                      <Icon name="delete_outline" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MV Card — one independent card per saved Multi-View
// ---------------------------------------------------------------------------

const MVCard = memo(function MVCard({
  mv,
  index,
  isActive,
  obsScenes,
  obsSources,
  obsContentLoading,
  addedLayouts,
  pushingId,
  clearingId,
  onPush,
  onClear,
  onUpdateName,
  onUpdateLayout,
  onUpdateBackground,
  onAssign,
  onAssignSlotFraming,
  onAssignScriptureCircleCamera,
  onAssignScriptureArchCamera,
  onAssignScriptureGoldCircleCamera,
  onAssignCustomLookCamera,
  onClearSlot,
  onUpdateFrame,
  onUpdateFrameThickness,
  onUpdateFrameCornerRadius,
  onUpdateFrameOpacity,
  onUpdateFrameColor,
  onUpdateSlotFrame: _onUpdateSlotFrame,
  onUpdateMargin,
  onUpdateAffectBackground,
  onUpdateSlotGap,
  onDuplicate,
  onDelete,
  onReloadTemplates,
  onDeleteTemplate,
  isReloadingTemplates,
}: {
  mv: SavedMultiView;
  index: number;
  isActive: boolean;
  obsScenes: string[];
  obsSources: string[];
  obsContentLoading: boolean;
  addedLayouts: GalleryLayout[];
  pushingId: string | null;
  clearingId: string | null;
  onPush: (mv: SavedMultiView) => void;
  onClear: (mv: SavedMultiView) => void;
  onUpdateName: (id: string, name: string) => void;
  onUpdateLayout: (id: string, layoutId: string) => void;
  onUpdateBackground: (id: string, bg: MVBackground) => void;
  onAssign: (id: string, slotId: string, val: string, mode: "scene" | "source") => void;
  onAssignSlotFraming: (id: string, slotId: string, framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }) => void;
  onAssignScriptureCircleCamera: (id: string, sceneName: string) => void;
  onAssignScriptureArchCamera: (id: string, sceneName: string) => void;
  onAssignScriptureGoldCircleCamera: (id: string, sceneName: string) => void;
  onAssignCustomLookCamera: (id: string, sceneName: string) => void;
  onClearSlot: (id: string, slotId: string) => void;
  onUpdateFrame: (id: string, frameId: string | null) => void;
  onUpdateFrameThickness: (id: string, thickness: number) => void;
  onUpdateFrameCornerRadius: (id: string, radius: number) => void;
  onUpdateFrameOpacity: (id: string, opacity: number) => void;
  onUpdateFrameColor: (id: string, color: string) => void;
  onUpdateSlotFrame: (id: string, slotId: string, frameMode: string) => void;
  onUpdateMargin: (id: string, margin: number) => void;
  onUpdateAffectBackground: (id: string, affectBackground: boolean) => void;
  onUpdateSlotGap: (id: string, slotGap: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReloadTemplates?: () => void;
  onDeleteTemplate?: (layoutId: string) => void;
  isReloadingTemplates?: boolean;
}) {
  const { t } = useTranslation();
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);
  const [framingSlot, setFramingSlot] = useState<string | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(mv.name);
  const cardMenuRef = useRef<HTMLDivElement>(null);
  const [showFramePicker, setShowFramePicker] = useState(false);
  const [showFrameSettings, setShowFrameSettings] = useState(false);
  const [showSpacingModal, setShowSpacingModal] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const frameSettingsRef = useRef<HTMLDivElement>(null);
  const layout = resolveLayout(mv.layoutId, addedLayouts);
  const isScriptureCircle = isScriptureCircleLayoutId(mv.layoutId);
  const isScriptureArch = isScriptureArchLayoutId(mv.layoutId);
  const isScriptureGoldCircle = isScriptureGoldCircleLayoutId(mv.layoutId);
  const customLookId = parseCustomLookLayoutId(mv.layoutId);
  const isCustomLook = !!customLookId;
  const isSingleCameraLook = isScriptureCircle || isScriptureArch || isScriptureGoldCircle || isCustomLook;
  const assignedCount = Object.values(mv.assignments).filter(Boolean).length;
  const allSlotsFilled = !!layout && (isSingleCameraLook || assignedCount >= layout.slots.length);
  const scriptureCircleScenes = obsScenes.filter((name) => name !== SCRIPTURE_CIRCLE_SCENE_NAME && !/^MV:/i.test(name));
  const scriptureArchScenes = obsScenes.filter((name) => name !== SCRIPTURE_ARCH_SCENE_NAME && !/^MV:/i.test(name));
  const scriptureGoldCircleScenes = obsScenes.filter((name) => name !== SCRIPTURE_GOLD_CIRCLE_SCENE_NAME && !/^MV:/i.test(name));
  const customLookScenes = obsScenes.filter((name) => (!customLookId || name !== customLookSceneName(customLookId)) && !/^MV:/i.test(name));
  const isPushing = pushingId === mv.id;
  const isClearing = clearingId === mv.id;

  useEffect(() => {
    if (!renameOpen) setRenameDraft(mv.name);
  }, [mv.name, renameOpen]);

  useEffect(() => {
    if (!cardMenuOpen) return;
    const handler = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !cardMenuRef.current?.contains(target)) {
        setCardMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [cardMenuOpen]);

  // Close frame settings on outside click
  useEffect(() => {
    if (!showFrameSettings) return;
    const handler = (e: MouseEvent) => {
      if (frameSettingsRef.current && !frameSettingsRef.current.contains(e.target as Node)) {
        setShowFrameSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFrameSettings]);

  const handleContentSelect = (slotId: string, value: string) => {
    onAssign(mv.id, slotId, value, "scene");
    setPickerSlot(null);
  };

  const handleFramingChange = (slotId: string, framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }) => {
    onAssignSlotFraming(mv.id, slotId, framing);
    setFramingSlot(null);
  };

  return (
    <div className="dock-mv-card">
      {/* Card Header */}
      <div className="dock-mv-card__header">
        <div className="dock-mv-card__title-group">
          {renameOpen ? (
            <form
              className="dock-mv-card__rename"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = renameDraft.trim();
                if (nextName && nextName !== mv.name) onUpdateName(mv.id, nextName);
                setRenameOpen(false);
              }}
            >
              <input
                autoFocus
                className="dock-mv-card__rename-input"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenameOpen(false);
                  }
                }}
                aria-label={t("common.rename")}
              />
              <button type="submit" className="dock-mv-card__rename-action" title={t("common.save")} aria-label={t("common.save")}>
                <Icon name="check" size={13} />
              </button>
              <button type="button" className="dock-mv-card__rename-action" onClick={() => setRenameOpen(false)} title={t("common.cancel")} aria-label={t("common.cancel")}>
                <Icon name="close" size={13} />
              </button>
            </form>
          ) : (
            <span className="dock-mv-card__name">
              {mv.name}
              {isActive && <span className="dock-mv-card__badge">{t('multiview.on')}</span>}
            </span>
          )}
          <span className="dock-mv-card__id">{shortId(index)}</span>
        </div>
        <div className="dock-mv-card__menu-wrap" ref={cardMenuRef}>
          <button
            type="button"
            className="dock-mv-card__menu-btn"
            onClick={() => setCardMenuOpen((current) => !current)}
            title={t("common.more", "More")}
            aria-label={`${t("common.more", "More")} ${mv.name}`}
            aria-haspopup="menu"
            aria-expanded={cardMenuOpen}
          >
            <Icon name="more_vert" size={15} />
          </button>
          {cardMenuOpen && (
            <div className="dock-mv-card__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="dock-mv-card__menu-item"
                onClick={() => {
                  setCardMenuOpen(false);
                  setRenameDraft(mv.name);
                  setRenameOpen(true);
                }}
              >
                <Icon name="edit" size={13} />
                <span>{t("common.rename", t("multiview.rename"))}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dock-mv-card__menu-item"
                onClick={() => {
                  setCardMenuOpen(false);
                  onDuplicate(mv.id);
                }}
              >
                <Icon name="content_copy" size={13} />
                <span>{t("multiview.copy")}</span>
              </button>
              <div className="dock-mv-card__menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="dock-mv-card__menu-item dock-mv-card__menu-item--danger"
                onClick={() => {
                  setCardMenuOpen(false);
                  onDelete(mv.id);
                }}
              >
                <Icon name="delete_outline" size={13} />
                <span>{t("common.delete")}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Template — custom dropdown with reload & hover-to-delete */}
      <MVTemplateDropdown
        value={mv.layoutId}
        layout={layout}
        addedLayouts={addedLayouts}
        onSelect={(layoutId) => onUpdateLayout(mv.id, layoutId)}
        onReloadTemplates={onReloadTemplates}
        onDeleteTemplate={onDeleteTemplate}
        isReloading={isReloadingTemplates}
      />

      {/* Layout Preview — shown below template */}
      {layout && (
        <LayoutMiniPreview
          layout={layout}
          thumbnails={mv.slotThumbnails}
          slotFraming={mv.slotFraming}
          frameId={mv.layoutFrameId}
          slotFrames={mv.slotFrames}
          frameThickness={mv.frameThickness}
          frameCornerRadius={mv.frameCornerRadius}
          frameOpacity={mv.frameOpacity}
          frameColor={mv.frameColor}
          margin={mv.margin ?? DEFAULT_MULTIVIEW_MARGIN}
          affectBackground={Boolean(mv.affectBackground)}
          slotGap={mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP}
          background={getMvBg(mv)}
        />
      )}

      {/* Studio Properties (Frame, Background, Spacing) — a complete-look template (Scripture
          Circle/Arch/Gold Circle) is a single fixed OBS scene, not a slot grid, so none of the
          generic frame/background/spacing styling applies to it; only the single camera-scene
          picker above is relevant. */}
      {!isSingleCameraLook && (
      <div className="dock-mv-properties-group">
        <button
          type="button"
          className={`dock-mv-properties-group__header ${propertiesOpen ? "dock-mv-properties-group__header--open" : ""}`}
          onClick={() => setPropertiesOpen((prev) => !prev)}
          aria-expanded={propertiesOpen}
        >
          <div className="dock-mv-properties-group__header-left">
            <Icon name="palette" size={12} />
            <span className="dock-mv-properties-group__title">
              {t('multiview.styling', 'Styling & Spacing')}
            </span>
            {!propertiesOpen && (
              <span className="dock-mv-properties-group__summary">
                {mv.layoutFrameId ? (resolveFrame(mv.layoutFrameId)?.name ?? "Frame") : t('multiview.noFrame', 'No frame')}
                {" · "}
                {`${mv.margin ?? DEFAULT_MULTIVIEW_MARGIN}px margin · ${mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP}px gap`}
              </span>
            )}
          </div>
          <Icon name={propertiesOpen ? "expand_less" : "expand_more"} size={14} className="dock-mv-properties-group__chevron" />
        </button>

        {propertiesOpen && (
          <div className="dock-mv-properties-group__body">
            {/* Frames */}
            <div className="dock-mv-property">
              <span className="dock-mv-property__label">{t('multiview.frame', 'Frame')}</span>
              <div className="dock-mv-property__row">
                {mv.layoutFrameId ? (
                  <span className="dock-mv-property__value">{resolveFrame(mv.layoutFrameId)?.name ?? "Unknown"}</span>
                ) : (
                  <span className="dock-mv-property__value dock-mv-property__value--empty">No frame selected</span>
                )}
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" className="dock-mv-property__action" onClick={() => setShowFramePicker(true)}>
                    {mv.layoutFrameId ? "Change" : "+ Add Frame"}
                  </button>
                  <div ref={frameSettingsRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="dock-mv-property__action"
                      disabled={!mv.layoutFrameId}
                      onClick={() => setShowFrameSettings(s => !s)}
                      title="Frame settings"
                      style={{ opacity: mv.layoutFrameId ? 1 : 0.4 }}
                    >
                      <Icon name="tune" size={12} />
                    </button>
                    {showFrameSettings && mv.layoutFrameId && (
                      <div style={{
                        position: "absolute", right: 0, top: "100%", marginTop: 4,
                        background: "var(--dock-surface, #1E293B)", border: "1px solid var(--dock-border, #334155)",
                        borderRadius: 4, padding: 10, zIndex: 50, minWidth: 180,
                        display: "flex", flexDirection: "column", gap: 8,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 52 }}>Thickness</span>
                          <input type="range" min={1} max={16} step={1} value={mv.frameThickness ?? 2}
                            onChange={(e) => onUpdateFrameThickness(mv.id, parseInt(e.target.value))}
                            style={{ flex: 1, height: 3, accentColor: "var(--dock-accent)" }} />
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 22 }}>{mv.frameThickness ?? 2}px</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 52 }}>Radius</span>
                          <input type="range" min={0} max={40} step={2} value={mv.frameCornerRadius ?? 0}
                            onChange={(e) => onUpdateFrameCornerRadius(mv.id, parseInt(e.target.value))}
                            style={{ flex: 1, height: 3, accentColor: "var(--dock-accent)" }} />
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 22 }}>{mv.frameCornerRadius ?? 0}px</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 52 }}>Opacity</span>
                          <input type="range" min={10} max={100} step={5} value={mv.frameOpacity ?? 100}
                            onChange={(e) => onUpdateFrameOpacity(mv.id, parseInt(e.target.value))}
                            style={{ flex: 1, height: 3, accentColor: "var(--dock-accent)" }} />
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 22 }}>{mv.frameOpacity ?? 100}%</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--dock-text-dim)", minWidth: 52 }}>Color</span>
                          <input type="color" value={mv.frameColor || "#D4A853"}
                            onChange={(e) => onUpdateFrameColor(mv.id, e.target.value)}
                            style={{ width: 28, height: 20, border: "none", borderRadius: 3, cursor: "pointer", padding: 0, background: "transparent" }} />
                          <button type="button" style={{ fontSize: 9, color: "var(--dock-text-dim)", border: "none", background: "transparent", cursor: "pointer" }}
                            onClick={() => onUpdateFrameColor(mv.id, "")}>Reset</button>
                        </div>
                        <div style={{ borderTop: "1px solid var(--dock-border)", paddingTop: 6 }}>
                          <button type="button" className="dock-btn dock-btn--sm dock-btn--danger" style={{ width: "100%", fontSize: 10 }}
                            onClick={() => { onUpdateFrame(mv.id, null); setShowFrameSettings(false); }}>
                            Remove Frame
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <FramePicker
                open={showFramePicker}
                selectedId={mv.layoutFrameId}
                onSelect={(frameId) => { onUpdateFrame(mv.id, frameId); setShowFramePicker(false); }}
                onClose={() => setShowFramePicker(false)}
              />
            </div>

            {/* Background */}
            <BackgroundSection
              background={getMvBg(mv)}
              onChange={(bg) => onUpdateBackground(mv.id, bg)}
              obsScenes={obsScenes}
            />

            {/* Spacing & Margins */}
            <div className="dock-mv-property">
              <span className="dock-mv-property__label">{t('multiview.spacing', 'Spacing')}</span>
              <div className="dock-mv-property__row">
                <span className="dock-mv-property__value">
                  {`${mv.margin ?? DEFAULT_MULTIVIEW_MARGIN}px margin · ${mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP}px gap`}
                </span>
                <button
                  type="button"
                  className="dock-mv-property__action"
                  onClick={() => setShowSpacingModal(true)}
                  title="Adjust layout margin and gap"
                >
                  <Icon name="tune" size={12} />
                  <span>{t('common.adjust', 'Adjust')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      <SpacingModal
        open={showSpacingModal}
        margin={mv.margin ?? DEFAULT_MULTIVIEW_MARGIN}
        slotGap={mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP}
        affectBackground={Boolean(mv.affectBackground)}
        onChangeMargin={(val) => onUpdateMargin(mv.id, val)}
        onChangeSlotGap={(val) => onUpdateSlotGap(mv.id, val)}
        onToggleAffectBackground={(val) => onUpdateAffectBackground(mv.id, val)}
        onClose={() => setShowSpacingModal(false)}
      />

      {layout && isScriptureCircle && (
        <div className="dock-mv-assign-section">
          <div className="dock-mv-assign-header">
            <Icon name="videocam" size={13} />
            <span>{t('multiview.sceneAssignments')}</span>
          </div>
          <div className="dock-mv-property">
            <span className="dock-mv-property__label">Camera scene</span>
            <select
              className="dock-mv-property__select dock-mv-property__select--visible"
              value={mv.scriptureCircleCameraSceneName ?? ""}
              onChange={(e) => onAssignScriptureCircleCamera(mv.id, e.target.value)}
            >
              <option value="">Use the theme's saved camera scene</option>
              {scriptureCircleScenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {layout && isScriptureArch && (
        <div className="dock-mv-assign-section">
          <div className="dock-mv-assign-header">
            <Icon name="videocam" size={13} />
            <span>{t('multiview.sceneAssignments')}</span>
          </div>
          <div className="dock-mv-property">
            <span className="dock-mv-property__label">Camera scene</span>
            <select
              className="dock-mv-property__select dock-mv-property__select--visible"
              value={mv.scriptureArchCameraSceneName ?? ""}
              onChange={(e) => onAssignScriptureArchCamera(mv.id, e.target.value)}
            >
              <option value="">Use the theme's saved camera scene</option>
              {scriptureArchScenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {layout && isScriptureGoldCircle && (
        <div className="dock-mv-assign-section">
          <div className="dock-mv-assign-header">
            <Icon name="videocam" size={13} />
            <span>{t('multiview.sceneAssignments')}</span>
          </div>
          <div className="dock-mv-property">
            <span className="dock-mv-property__label">Camera scene</span>
            <select
              className="dock-mv-property__select dock-mv-property__select--visible"
              value={mv.scriptureGoldCircleCameraSceneName ?? ""}
              onChange={(e) => onAssignScriptureGoldCircleCamera(mv.id, e.target.value)}
            >
              <option value="">Use the theme's saved camera scene</option>
              {scriptureGoldCircleScenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {layout && isCustomLook && (
        <div className="dock-mv-assign-section">
          <div className="dock-mv-assign-header">
            <Icon name="videocam" size={13} />
            <span>{t('multiview.sceneAssignments')}</span>
          </div>
          <div className="dock-mv-property">
            <span className="dock-mv-property__label">Camera scene</span>
            <select
              className="dock-mv-property__select dock-mv-property__select--visible"
              value={mv.customLookCameraSceneName ?? ""}
              onChange={(e) => onAssignCustomLookCamera(mv.id, e.target.value)}
            >
              <option value="">Choose a camera scene…</option>
              {customLookScenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {layout && !isSingleCameraLook && (<><div className="dock-mv-assign-section">
        <div className="dock-mv-assign-header">
          <Icon name="videocam" size={13} />
          <span>{t('multiview.sceneAssignments')}</span>
          <span className="dock-mv-assign-count">
            {assignedCount}/{layout.slots.length}
          </span>
        </div>
        {layout.slots.map((slot, slotIdx) => {
          const val = mv.assignments[slot.id] ?? "";
          const mode = mv.slotModes?.[slot.id] ?? "scene";
          const framing = mv.slotFraming?.[slot.id] ?? DEFAULT_SLOT_FRAMING;
          return (
            <div key={slot.id}>
              <SlotControl
                slot={slot}
                slotIndex={slotIdx}
                value={val}
                mode={mode}
                framing={framing}
                onSelect={() => setPickerSlot(slot.id)}
                onChange={(v) => handleContentSelect(slot.id, v)}
                onFramingChange={(_f) => setFramingSlot(slot.id)}
                onRemove={() => onClearSlot(mv.id, slot.id)}
                obsScenes={obsScenes}
                obsSources={obsSources}
              />
              {/* Content Picker for this slot */}
              {pickerSlot === slot.id && (
                <ContentPicker
                  open
                  obsScenes={obsScenes}
                  loading={obsContentLoading}
                  onSelect={(v) => handleContentSelect(slot.id, v)}
                  onClose={() => setPickerSlot(null)}
                  excludeScenes={[mv.obsSceneName]}
                />
              )}
              {/* Framing Editor for this slot */}
              {framingSlot === slot.id && (
                <FramingEditor
                  open
                  initialFraming={framing}
                  slotWidth={slot.width}
                  slotHeight={slot.height}
                  selectedContentName={val}
                  selectedContentMode={mode}
                  onSave={(f) => handleFramingChange(slot.id, f)}
                  onClose={() => setFramingSlot(null)}
                />
              )}
            </div>
          );
        })}
      </div>
      </>
      )}

      {/* Preview in OBS — per card */}
      <div className="dock-mv-card__actions">
        <button
          type="button"
          className={`dock-btn dock-btn--sm ${isPushing ? "dock-btn--loading" : "dock-btn--primary"}`}
          onClick={() => onPush(mv)}
          disabled={isPushing || isClearing || !allSlotsFilled}
          style={{ flex: 1 }}
          title={isPushing ? t('multiview.previewing', 'Previewing…') : t('common.preview', 'Preview')}>
          <Icon name="cast" size={14} />
          <span>{isPushing ? t('multiview.previewing', 'Previewing…') : t('common.preview', 'Preview')}</span>
        </button>
        {isActive && (
          <button
            type="button"
            className={`dock-btn dock-btn--sm ${isClearing ? "dock-btn--loading" : ""}`}
            onClick={() => onClear(mv)}
            disabled={isClearing || isPushing}
            style={{
              background: "transparent",
              border: "1px solid var(--dock-border)",
              color: "var(--dock-text-dim)",
            }}
            title={t('multiview.clearing')}>
            <Icon name="visibility_off" size={14} />
            <span>{isClearing ? t('multiview.clearing') : t('common.clear')}</span>
          </button>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function DockMultiviewTab({ isActive = true }: { isActive?: boolean }) {
  const { t } = useTranslation();
  const [dockPlan, setDockPlan] = useState<string>(() => getDockPlan());
  const [savedList, setSavedList] = useState<SavedMultiView[]>([]);
  const [obsScenes, setObsScenes] = useState<string[]>([]);
  const [obsSources, setObsSources] = useState<string[]>([]);
  const [obsContentLoading, setObsContentLoading] = useState(false);
  const [obsContentLoaded, setObsContentLoaded] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const obsScanBusyRef = useRef(false);
  const obsContentLoadedRef = useRef(false);
  const obsSceneSignatureRef = useRef("");
  const thumbnailRefreshSignatureRef = useRef("");
  const thumbnailRefreshAtRef = useRef(0);
  const thumbnailRefreshBusyRef = useRef(false);
  const savedListRef = useRef<SavedMultiView[]>([]);

  useEffect(() => {
    if (!isActive) return;
    setDockPlan(getDockPlan());
    const interval = window.setInterval(() => setDockPlan(getDockPlan()), 30_000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  // Show layouts that are added via gallery OR in use by saved cards
  const [addedLayoutIds, setAddedLayoutIds] = useState<Set<string>>(() => loadLocalAddedLayoutIds());

  const mergeIntoAddedLayoutIds = useCallback((...sources: Array<Iterable<unknown> | null | undefined>) => {
    setAddedLayoutIds(prev => {
      const next = mergeAddedLayoutIds(prev, ...sources);
      if (areAddedLayoutIdsEqual(prev, next)) return prev;
      saveLocalAddedLayoutIds(next, { emit: false });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;

    const mergeLocalIds = () => {
      mergeIntoAddedLayoutIds(loadLocalAddedLayoutIds());
    };

    const refreshFromDockData = async () => {
      const remoteIds = await loadAddedLayoutIdsFromDockData();
      if (cancelled) return;

      const localIds = loadLocalAddedLayoutIds();
      const mergedIds = mergeAddedLayoutIds(localIds, remoteIds);
      mergeIntoAddedLayoutIds(mergedIds);

      if (remoteIds.size === 0 && mergedIds.size > 0) {
        saveAddedLayoutIdsToDockData(mergedIds).catch(() => { });
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && !getAddedLayoutLocalStorageKeys().includes(event.key)) return;
      mergeLocalIds();
    };

    const handleAddedLayoutsChanged = (event: Event) => {
      const ids = (event as CustomEvent<{ ids?: string[] }>).detail?.ids;
      mergeIntoAddedLayoutIds(ids ?? loadLocalAddedLayoutIds());
    };

    mergeLocalIds();
    refreshFromDockData();
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshFromDockData();
    }, 30000);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(MULTIVIEW_ADDED_LAYOUTS_CHANGED_EVENT, handleAddedLayoutsChanged);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(MULTIVIEW_ADDED_LAYOUTS_CHANGED_EVENT, handleAddedLayoutsChanged);
    };
  }, [isActive, mergeIntoAddedLayoutIds]);

  const usedLayoutIds = useMemo(() => (
    [...new Set(savedList.map(m => m.layoutId).filter(Boolean))].sort().join("|")
  ), [savedList]);

  // Scripture Circle themes are saved from the gallery's editor, which can be a different window
  // entirely — and when the Dock is opened as an OBS browser dock rather than a Tauri window, it's
  // a completely separate browser process that never sees this window's localStorage at all.
  // So, like addedLayoutIds above: start from this window's own local copy, then reconcile against
  // the durable dock-data file (load/saveScriptureCircleThemesFromDockData) on mount, whenever this
  // tab becomes active, and on a 30s poll while visible — local storage/focus events are a
  // same-process bonus, not the real sync path.
  const [scriptureCircleThemes, setScriptureCircleThemes] = useState<ScriptureCircleTheme[]>(() => listScriptureCircleThemes());

  const refreshScriptureCircleThemes = useCallback(async () => {
    const remote = await loadScriptureCircleThemesFromDockData();
    if (remote.length > 0) {
      setScriptureCircleThemes(remote);
    } else {
      // Nothing written to dock data yet (e.g. first run before any theme was ever saved) —
      // fall back to this window's own copy rather than showing nothing.
      setScriptureCircleThemes(listScriptureCircleThemes());
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refreshScriptureCircleThemes();
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshScriptureCircleThemes();
    }, 30000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "mce-dock-scripture-circle-themes") return;
      void refreshScriptureCircleThemes();
    };
    const handleFocus = () => void refreshScriptureCircleThemes();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isActive, refreshScriptureCircleThemes]);

  // Scripture Circle themes are lightweight display-only stubs, not real GalleryLayouts — they
  // never decompose into a grid of slots, so handlePush/resolveLayout branch on their id prefix
  // instead of treating `slots` as real rectangles. They're always available in the picker; unlike
  // the generic gallery layouts, there is no separate "add this layout" step for them.
  const scriptureCircleStubLayouts = useMemo<GalleryLayout[]>(() => scriptureCircleThemes.map((theme) => ({
    id: scriptureCircleLayoutId(theme.id),
    name: theme.name,
    description: "Camera in a circle with the verse you click in the Bible tab beside it.",
    category: "custom",
    slots: [],
    useCases: [],
    scenePrefix: SCRIPTURE_CIRCLE_SCENE_NAME,
  })), [scriptureCircleThemes]);

  // Scripture Arch themes — same cross-process dock-data sync as Scripture Circle, its own channel.
  const [scriptureArchThemes, setScriptureArchThemes] = useState<ScriptureArchTheme[]>(() => listScriptureArchThemes());

  const refreshScriptureArchThemes = useCallback(async () => {
    const remote = await loadScriptureArchThemesFromDockData();
    if (remote.length > 0) {
      setScriptureArchThemes(remote);
    } else {
      setScriptureArchThemes(listScriptureArchThemes());
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refreshScriptureArchThemes();
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshScriptureArchThemes();
    }, 30000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "mce-dock-scripture-arch-themes") return;
      void refreshScriptureArchThemes();
    };
    const handleFocus = () => void refreshScriptureArchThemes();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isActive, refreshScriptureArchThemes]);

  const scriptureArchStubLayouts = useMemo<GalleryLayout[]>(() => scriptureArchThemes.map((theme) => ({
    id: scriptureArchLayoutId(theme.id),
    name: theme.name,
    description: "Camera in an arch window with the verse you click in the Bible tab beside it.",
    category: "custom",
    slots: [],
    useCases: [],
    scenePrefix: SCRIPTURE_ARCH_SCENE_NAME,
  })), [scriptureArchThemes]);

  // Scripture Gold Circle themes — same cross-process dock-data sync, its own channel.
  const [scriptureGoldCircleThemes, setScriptureGoldCircleThemes] = useState<ScriptureGoldCircleTheme[]>(() => listScriptureGoldCircleThemes());

  const refreshScriptureGoldCircleThemes = useCallback(async () => {
    const remote = await loadScriptureGoldCircleThemesFromDockData();
    if (remote.length > 0) {
      setScriptureGoldCircleThemes(remote);
    } else {
      setScriptureGoldCircleThemes(listScriptureGoldCircleThemes());
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refreshScriptureGoldCircleThemes();
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshScriptureGoldCircleThemes();
    }, 30000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "mce-dock-scripture-gold-circle-themes") return;
      void refreshScriptureGoldCircleThemes();
    };
    const handleFocus = () => void refreshScriptureGoldCircleThemes();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isActive, refreshScriptureGoldCircleThemes]);

  const scriptureGoldCircleStubLayouts = useMemo<GalleryLayout[]>(() => scriptureGoldCircleThemes.map((theme) => ({
    id: scriptureGoldCircleLayoutId(theme.id),
    name: theme.name,
    description: "Camera in a gold-ringed circle with the verse you click in the Bible tab beside it.",
    category: "custom",
    slots: [],
    useCases: [],
    scenePrefix: SCRIPTURE_GOLD_CIRCLE_SCENE_NAME,
  })), [scriptureGoldCircleThemes]);

  // Admin-uploaded custom Multi-View looks (see customLookCatalog.ts) — unlike the three Scripture
  // looks above, there can be an arbitrary, growing number of these, so they're iterated over
  // generically instead of being named one by one. Each fetched look becomes its own stub layout;
  // there is no separate "saved theme" step (one look = one directly usable Dock entry — see the
  // judgment call in the report), so there's no cross-process themes-list sync to do here, only a
  // catalog refresh.
  const [customLooks, setCustomLooks] = useState<CustomMultiViewLook[]>(() => listCustomMultiViewLooks());
  // Per-look camera scene, read from the durable dock-data file (see the comment on
  // customLookLook.ts's camera-scene helpers) for the same cross-process reason the Scripture
  // themes lists above need it: a Dock running as a separate OBS browser-dock process never sees
  // another window's localStorage.
  const [customLookCameraScenes, setCustomLookCameraScenes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isActive) return;
    const refresh = () => setCustomLooks(listCustomMultiViewLooks());
    refresh();
    void refreshMultiviewLookCatalog().then(refresh);
    void loadCustomLookCameraScenesFromDockData().then(setCustomLookCameraScenes);
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refresh();
    }, 30000);
    window.addEventListener(MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener(MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [isActive]);

  const customLookStubLayouts = useMemo<GalleryLayout[]>(() => customLooks.map((look) => ({
    id: customLookLayoutId(look.lookId),
    name: look.name,
    description: look.description || "Custom Multi-View look.",
    category: "custom",
    slots: [],
    useCases: [],
    scenePrefix: customLookSceneName(look.lookId),
  })), [customLooks]);

  const addedLayouts = useMemo(() => {
    const visibleIds = new Set([
      ...addedLayoutIds,
      ...usedLayoutIds.split("|").filter(Boolean),
    ]);
    return [
      ...scriptureCircleStubLayouts,
      ...scriptureArchStubLayouts,
      ...scriptureGoldCircleStubLayouts,
      ...customLookStubLayouts,
      ...GALLERY_LAYOUTS.filter(l => visibleIds.has(l.id)),
    ];
  }, [addedLayoutIds, usedLayoutIds, scriptureCircleStubLayouts, scriptureArchStubLayouts, scriptureGoldCircleStubLayouts, customLookStubLayouts]);

  // ── Load saved list without overwriting it during a remount ──
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      let snapshot = loadSavedSnapshot();

      // If the fast local copy is missing, give the durable user-scoped copy a
      // chance to restore the cards before creating the first three defaults.
      if (!snapshot.hasStoredValue) {
        const durableItems = await loadDockPreferenceList<SavedMultiView>(STORAGE_KEY);
        if (cancelled) return;
        if (durableItems) {
          snapshot = {
            items: durableItems.map(normalizeLoadedMultiView),
            hasStoredValue: true,
            shouldMigrate: true,
            canPersist: true,
          };
        }
      }

      let list = snapshot.items;
      let changed = false;
      const usedSceneNames = new Set(list.map((m) => m.obsSceneName).filter(Boolean));

      // Migrate old data: cards without obsSceneName get one assigned
      list = list.map((m, i) => {
        if (!m.obsSceneName) {
          let number = i + 1;
          let obsSceneName = `MV: Multiview ${number}`;
          while (usedSceneNames.has(obsSceneName)) {
            number += 1;
            obsSceneName = `MV: Multiview ${number}`;
          }
          usedSceneNames.add(obsSceneName);
          changed = true;
          return { ...m, obsSceneName, background: { ...DEFAULT_MV_BG, ...(m.background ?? {}) } };
        }
        // Migrate: ensure slotThumbnails, layoutFrameId, slotFrames, frameThickness, margin, affectBackground exist
        if (!m.slotThumbnails || !("layoutFrameId" in m) || !m.slotFrames || typeof m.frameThickness !== "number" || !m.background || typeof (m.background as Partial<MVBackground>).patternSrc !== "string" || typeof m.margin !== "number" || typeof m.affectBackground !== "boolean") {
          changed = true;
          return {
            ...m,
            slotThumbnails: m.slotThumbnails ?? {},
            layoutFrameId: m.layoutFrameId ?? null,
            slotFrames: m.slotFrames ?? {},
            frameThickness: m.frameThickness ?? 2,
            frameCornerRadius: (m as any).frameCornerRadius ?? 0,
            frameOpacity: (m as any).frameOpacity ?? 100,
            frameColor: (m as any).frameColor ?? "",
            background: { ...DEFAULT_MV_BG, ...(m.background ?? {}) },
            margin: typeof m.margin === "number" ? m.margin : DEFAULT_MULTIVIEW_MARGIN,
            affectBackground: Boolean(m.affectBackground),
            slotGap: typeof m.slotGap === "number" ? m.slotGap : DEFAULT_MULTIVIEW_SLOT_GAP,
          };
        }
        return m;
      });

      const now = new Date().toISOString();
      const cards: SavedMultiView[] = [...list];
      // Seed only a brand-new store. If the user deliberately has an empty
      // stored list, keep it empty. Never truncate saved cards to the first 3.
      const shouldSeedDefaults = !snapshot.hasStoredValue || cards.length > 0;
      while (shouldSeedDefaults && cards.length < 3) {
        const n = cards.length + 1;
        const obsSceneName = nextObsSceneName(cards);
        cards.push({
          id: genId(),
          name: `${t('multiview.title')} ${n}`,
          obsSceneName,
          layoutId: GALLERY_LAYOUTS[0]?.id ?? "",
          assignments: {},
          slotModes: {},
          slotFraming: {},
          slotThumbnails: {},
          layoutFrameId: null,
          slotFrames: {},
          frameThickness: 2,
          frameCornerRadius: 0,
          frameOpacity: 100,
          frameColor: "",
          background: { ...DEFAULT_MV_BG },
          margin: DEFAULT_MULTIVIEW_MARGIN,
          affectBackground: false,
          slotGap: DEFAULT_MULTIVIEW_SLOT_GAP,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      }

      if (cancelled) return;

      // A failed/temporary storage read must not be written back as defaults.
      // Persist only migrations, durable recovery, or intentional seeding.
      if (snapshot.canPersist && (changed || snapshot.shouldMigrate)) {
        saveSaved(cards);
      }
      savedListRef.current = cards;
      setSavedList(cards);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const obsReady = useDockObsReady();

  useEffect(() => {
    savedListRef.current = savedList;
  }, [savedList]);

  useEffect(() => {
    obsContentLoadedRef.current = obsContentLoaded;
  }, [obsContentLoaded]);

  const commitSavedList = useCallback((next: SavedMultiView[]) => {
    savedListRef.current = next;
    setSavedList(next);
    saveSaved(next);
  }, []);

  const refreshAssignedThumbnails = useCallback(async (
    availableSceneNames: string[],
    options?: { force?: boolean },
  ) => {
    if (!dockObsClient.isConnected) return;
    if (thumbnailRefreshBusyRef.current) return;
    const available = new Set(availableSceneNames);
    const snapshot = savedListRef.current;
    const targetKeys = new Set<string>();
    const captureSources = new Set<string>();

    for (const mv of snapshot) {
      for (const [slotId, sourceName] of Object.entries(mv.assignments ?? {})) {
        if (!sourceName) continue;
        const mode = mv.slotModes?.[slotId] ?? "scene";
        if (mode !== "scene") continue;
        targetKeys.add(`${mv.id}:${slotId}:${sourceName}`);
        if (available.has(sourceName)) {
          captureSources.add(sourceName);
        }
      }
    }

    if (targetKeys.size === 0) return;

    const captureSourceNames = [...captureSources].sort();
    const signature = `${[...targetKeys].sort().join("|")}::${captureSourceNames.join("|")}`;
    const now = Date.now();
    if (!options?.force && signature === thumbnailRefreshSignatureRef.current && now - thumbnailRefreshAtRef.current < MV_THUMBNAIL_REFRESH_MS) {
      return;
    }
    thumbnailRefreshSignatureRef.current = signature;
    thumbnailRefreshAtRef.current = now;
    thumbnailRefreshBusyRef.current = true;

    try {
      const captures = await captureMvSourceThumbnails(captureSourceNames);

      if (!mountedRef.current) return;

      setSavedList((current) => {
        let changed = false;
        const next = current.map((mv) => {
          const currentThumbs = mv.slotThumbnails ?? {};
          let nextThumbs = currentThumbs;

          for (const [slotId, sourceName] of Object.entries(mv.assignments ?? {})) {
            const key = `${mv.id}:${slotId}:${sourceName}`;
            if (!targetKeys.has(key)) continue;
            const mode = mv.slotModes?.[slotId] ?? "scene";
            if (mode !== "scene") continue;

            const nextUrl = available.has(sourceName) ? captures.get(sourceName) ?? null : null;
            if (nextUrl) {
              if (nextThumbs[slotId] !== nextUrl) {
                if (nextThumbs === currentThumbs) nextThumbs = { ...currentThumbs };
                nextThumbs[slotId] = nextUrl;
                changed = true;
              }
            } else if (nextThumbs[slotId]) {
              if (nextThumbs === currentThumbs) nextThumbs = { ...currentThumbs };
              delete nextThumbs[slotId];
              changed = true;
            }
          }

          return nextThumbs === currentThumbs ? mv : { ...mv, slotThumbnails: nextThumbs };
        });

        if (changed) {
          savedListRef.current = next;
          saveSaved(next);
        }
        return changed ? next : current;
      });
    } finally {
      thumbnailRefreshBusyRef.current = false;
    }
  }, []);

  // ── Single GetSceneList + GetInputList call ──
  const refreshObsScenes = useCallback(async (options?: { forceThumbnails?: boolean }) => {
    if (!mountedRef.current) return;
    if (obsScanBusyRef.current) return;
    obsScanBusyRef.current = true;
    if (!obsContentLoadedRef.current) setObsContentLoading(true);
    try {
      const result = await Promise.race([
        Promise.all([
          dockObsClient.call("GetSceneList") as Promise<{ scenes: Array<{ sceneName: string }> }>,
          dockObsClient.call("GetInputList") as Promise<{ inputs: Array<{ inputName: string }> }>,
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("refreshObsScenes timed out")), 15000)
        ),
      ]);
      const [sceneResp, inputResp] = result;
      const scenes = sceneResp.scenes ?? [];
      const inputs = inputResp.inputs ?? [];
      if (!mountedRef.current) return;
      const sceneNames = scenes.map(s => s.sceneName);
      const sourceNames = inputs.map(i => i.inputName);
      const sceneSignature = sceneNames.join("\n");
      const scenesChanged = sceneSignature !== obsSceneSignatureRef.current;
      obsSceneSignatureRef.current = sceneSignature;
      setObsScenes(current => areStringListsEqual(current, sceneNames) ? current : sceneNames);
      setObsSources(current => areStringListsEqual(current, sourceNames) ? current : sourceNames);
      setObsContentLoaded(true);

      // Let the card list paint before the heavier OBS screenshot work starts.
      // The screenshots are useful previews, but they are not required to open
      // the tab and can otherwise compete with the first visible render.
      if (Boolean(options?.forceThumbnails) || scenesChanged) {
        window.setTimeout(() => {
          if (mountedRef.current) {
            void refreshAssignedThumbnails(sceneNames, { force: Boolean(options?.forceThumbnails) || scenesChanged });
          }
        }, 0);
      }
    } catch (err) {
      console.warn("[MV] refreshObsScenes FAILED", err);
      if (mountedRef.current) setObsContentLoaded(true);
    } finally {
      obsScanBusyRef.current = false;
      if (mountedRef.current) setObsContentLoading(false);
    }
  }, [refreshAssignedThumbnails]);

  useEffect(() => {
    if (!isActive || !obsReady) return;
    let cancelled = false;
    let interval: number | null = null;
    let startTimer: number | null = null;

    // Defer OBS enumeration until after the active tab has committed. This
    // keeps the navigation response independent from WebSocket round trips.
    const frame = window.requestAnimationFrame(() => {
      startTimer = window.setTimeout(() => {
        if (cancelled) return;
        mountedRef.current = true;
        void refreshObsScenes({ forceThumbnails: true });
        interval = window.setInterval(() => {
          if (document.visibilityState === "hidden") return;
          void refreshObsScenes();
        }, getRecommendedPollingInterval(MV_OBS_SCAN_MS));
      }, 0);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (startTimer !== null) window.clearTimeout(startTimer);
      if (interval !== null) window.clearInterval(interval);
      mountedRef.current = false;
    };
  }, [isActive, obsReady, refreshObsScenes]);

  // ── Show feedback briefly ──
  const showFeedback = useCallback((type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => { if (mountedRef.current) setFeedback(null); }, 3000);
  }, []);

  // ════════════════════════════════════════════════════════════════════════
  // CRUD Operations
  // ════════════════════════════════════════════════════════════════════════

  const handleUpdateName = useCallback((id: string, name: string) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, name, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateLayout = useCallback((id: string, layoutId: string) => {
    const selectedLayout = resolveLayout(layoutId, addedLayouts);
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      layoutId,
      assignments: {},
      slotModes: {},
      slotFraming: {},
      slotThumbnails: {},
      scriptureCircleCameraSceneName: undefined,
      scriptureArchCameraSceneName: undefined,
      scriptureGoldCircleCameraSceneName: undefined,
      customLookCameraSceneName: undefined,
      layoutFrameId: selectedLayout?.defaultFrameId ?? null,
      slotFrames: { ...(selectedLayout?.defaultSlotFrames ?? {}) },
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
  }, [commitSavedList, addedLayouts]);

  const handleAssignScriptureCircleCamera = useCallback((id: string, sceneName: string) => {
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      scriptureCircleCameraSceneName: sceneName || undefined,
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleAssignScriptureArchCamera = useCallback((id: string, sceneName: string) => {
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      scriptureArchCameraSceneName: sceneName || undefined,
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleAssignScriptureGoldCircleCamera = useCallback((id: string, sceneName: string) => {
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      scriptureGoldCircleCameraSceneName: sceneName || undefined,
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleAssignCustomLookCamera = useCallback((id: string, sceneName: string) => {
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      customLookCameraSceneName: sceneName || undefined,
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
    const lookId = parseCustomLookLayoutId(next.find(m => m.id === id)?.layoutId);
    if (lookId) saveCustomLookCameraScene(lookId, sceneName);
  }, [commitSavedList]);

  const handleAssign = useCallback((id: string, slotId: string, val: string, mode: "scene" | "source") => {
    const now = new Date().toISOString();
    const next = savedListRef.current.map(m => {
      if (m.id !== id) return m;
      const slotThumbnails = { ...(m.slotThumbnails ?? {}) };
      delete slotThumbnails[slotId];
      return {
        ...m,
        assignments: { ...m.assignments, [slotId]: val },
        slotModes: { ...m.slotModes, [slotId]: mode },
        slotFraming: m.slotFraming?.[slotId] ? m.slotFraming : { ...m.slotFraming, [slotId]: DEFAULT_SLOT_FRAMING },
        slotThumbnails,
        updatedAt: now,
      };
    });
    commitSavedList(next);
    if (dockObsClient.isConnected && val && mode === "scene" && !thumbnailRefreshBusyRef.current) {
      thumbnailRefreshBusyRef.current = true;
      captureMvSourceThumbnails([val]).then((captures) => {
        const url = captures.get(val);
        if (!url) return;
        setSavedList(prev => {
          let changed = false;
          const updated = prev.map(m => {
            if (m.id !== id || m.assignments?.[slotId] !== val) return m;
            changed = true;
            return { ...m, slotThumbnails: { ...(m.slotThumbnails ?? {}), [slotId]: url } };
          });
          if (!changed) return prev;
          savedListRef.current = updated;
          saveSaved(updated);
          return updated;
        });
      }).catch(() => { }).finally(() => {
        thumbnailRefreshBusyRef.current = false;
      });
    }
  }, [commitSavedList]);

  const handleAssignSlotFraming = useCallback((id: string, slotId: string, framing: { displayMode: "fill" | "fit" | "custom"; zoom: number; focalX: number; focalY: number }) => {
    const next = savedListRef.current.map(m => {
      if (m.id !== id) return m;
      return { ...m, slotFraming: { ...m.slotFraming, [slotId]: framing }, updatedAt: new Date().toISOString() };
    });
    commitSavedList(next);
  }, [commitSavedList]);

  const handleRemoveSlot = useCallback((id: string, slotId: string) => {
    const next = savedListRef.current.map(m => {
      if (m.id !== id) return m;
      const assigns = { ...m.assignments };
      delete assigns[slotId];
      const modes = { ...m.slotModes };
      delete modes[slotId];
      const framing = { ...m.slotFraming };
      delete framing[slotId];
      const slotThumbnails = { ...(m.slotThumbnails ?? {}) };
      delete slotThumbnails[slotId];
      return { ...m, assignments: assigns, slotModes: modes, slotFraming: framing, slotThumbnails, updatedAt: new Date().toISOString() };
    });
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateBackground = useCallback((id: string, bg: MVBackground) => {
    const current = savedListRef.current;
    const next = current.map(m => m.id === id ? { ...m, background: bg, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateMargin = useCallback((id: string, margin: number) => {
    const current = savedListRef.current;
    const next = current.map(m => m.id === id ? { ...m, margin, customSpacing: true, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateSlotGap = useCallback((id: string, slotGap: number) => {
    const current = savedListRef.current;
    const next = current.map(m => m.id === id ? { ...m, slotGap, customSpacing: true, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateAffectBackground = useCallback((id: string, affectBackground: boolean) => {
    const current = savedListRef.current;
    const next = current.map(m => m.id === id ? { ...m, affectBackground, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateFrame = useCallback((id: string, frameId: string | null) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, layoutFrameId: frameId, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateFrameThickness = useCallback((id: string, thickness: number) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, frameThickness: thickness, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateFrameCornerRadius = useCallback((id: string, radius: number) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, frameCornerRadius: radius, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateFrameOpacity = useCallback((id: string, opacity: number) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, frameOpacity: opacity, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateFrameColor = useCallback((id: string, color: string) => {
    const next = savedListRef.current.map(m => m.id === id ? { ...m, frameColor: color, updatedAt: new Date().toISOString() } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleUpdateSlotFrame = useCallback((id: string, slotId: string, frameMode: string) => {
    const next = savedListRef.current.map(m => m.id === id ? {
      ...m,
      slotFrames: { ...(m.slotFrames ?? {}), [slotId]: frameMode },
      updatedAt: new Date().toISOString(),
    } : m);
    commitSavedList(next);
  }, [commitSavedList]);

  const handleDuplicate = useCallback((id: string) => {
    const current = savedListRef.current;
    const src = current.find(m => m.id === id);
    if (!src) return;
    const now = new Date().toISOString();
    const dupe: SavedMultiView = {
      ...src,
      id: genId(),
      name: `${src.name} (${t('multiview.copy')})`,
      obsSceneName: nextObsSceneName(current),
      assignments: { ...src.assignments },
      background: { ...(src.background ?? DEFAULT_MV_BG) },
      margin: src.margin ?? DEFAULT_MULTIVIEW_MARGIN,
      affectBackground: Boolean(src.affectBackground),
      slotGap: src.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP,
      customSpacing: src.customSpacing,
      createdAt: now,
      updatedAt: now,
    };
    const next = [dupe, ...current];
    commitSavedList(next);
    showFeedback("success", `"${dupe.name}" created`);
  }, [commitSavedList, showFeedback, t]);

  const handleDeleteConfirmed = useCallback((id: string, deleteObsScene: boolean) => {
    const current = savedListRef.current;
    const mv = current.find(m => m.id === id);
    const next = current.filter(m => m.id !== id);
    commitSavedList(next);
    setDeleteTargetId(null);

    if (deleteObsScene && mv && dockObsClient.isConnected) {
      dockObsClient.call("RemoveScene", { sceneName: mv.obsSceneName }).catch(() => { });
    }

    showFeedback("success", t('common.delete'));
  }, [commitSavedList, showFeedback, t]);

  const handleDelete = useCallback((id: string) => {
    setDeleteTargetId(id);
  }, []);

  const [isReloadingTemplates, setIsReloadingTemplates] = useState(false);

  const handleReloadLayouts = useCallback(async () => {
    setIsReloadingTemplates(true);
    try {
      const remoteIds = await loadAddedLayoutIdsFromDockData();
      const localIds = loadLocalAddedLayoutIds();
      const merged = mergeAddedLayoutIds(localIds, remoteIds);
      setAddedLayoutIds(merged);
      saveLocalAddedLayoutIds(merged);
      await refreshScriptureCircleThemes();
      await refreshScriptureArchThemes();
      await refreshScriptureGoldCircleThemes();
      void refreshObsScenes({ forceThumbnails: true });
    } finally {
      setTimeout(() => setIsReloadingTemplates(false), 400);
    }
  }, [refreshObsScenes, refreshScriptureCircleThemes, refreshScriptureArchThemes, refreshScriptureGoldCircleThemes]);

  const handleDeleteTemplate = useCallback((layoutId: string) => {
    const currentLocal = loadLocalAddedLayoutIds();
    currentLocal.delete(layoutId);
    saveLocalAddedLayoutIds(currentLocal);
    saveAddedLayoutIdsToDockData(currentLocal).catch(() => {});
    setAddedLayoutIds(new Set(currentLocal));

    const next = savedListRef.current.map((item) => {
      if (item.layoutId !== layoutId) return item;
      return {
        ...item,
        layoutId: "",
        assignments: {},
        slotModes: {},
        slotFraming: {},
        slotThumbnails: {},
        layoutFrameId: null,
        slotFrames: {},
        updatedAt: new Date().toISOString(),
      };
    });
    commitSavedList(next);
  }, [commitSavedList]);

  // ════════════════════════════════════════════════════════════════════════
  // OBS Operations
  // ════════════════════════════════════════════════════════════════════════

  const ensureScene = useCallback(async (sceneName: string) => {
    try {
      const resp = await dockObsClient.call("GetSceneList") as { scenes: Array<{ sceneName: string }> };
      if (!resp.scenes?.some(s => s.sceneName === sceneName)) {
        await dockObsClient.call("CreateScene", { sceneName });
      }
    } catch { /* ignore */ }
  }, []);

  const handlePush = useCallback(async (mv: SavedMultiView) => {
    if (!(await requireEntitlement("multiview", 0))) return;
    await ensureObsConnected();
    if (!dockObsClient.isConnected) return;

    // Scripture Circle is a single complete OBS look, not a grid of slots — build it directly and
    // skip the generic slot-wiping/transform pipeline below entirely.
    const scriptureThemeId = parseScriptureCircleThemeId(mv.layoutId);
    if (scriptureThemeId) {
      // getScriptureCircleTheme() only reads this window's own localStorage, which is empty when
      // the Dock runs as a separate process (an OBS browser dock or a second Tauri window) — the
      // same cross-process gap documented above `scriptureCircleThemes`. That state is already kept
      // in sync via the durable dock-data file, so look there first.
      const theme = scriptureCircleThemes.find((entry) => entry.id === scriptureThemeId) ?? getScriptureCircleTheme(scriptureThemeId);
      if (!theme) { showFeedback("error", t('multiview.layoutNotFound')); return; }
      setPushingId(mv.id);
      try {
        const settings = {
          ...theme.settings,
          cameraSceneName: mv.scriptureCircleCameraSceneName || theme.settings.cameraSceneName,
        };
        const { sceneName } = await applyScriptureCircleLook(dockObsClient, settings);
        try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { /* non-critical */ }
        showFeedback("success", `"${sceneName}" previewed in OBS`);
        refreshObsScenes({ forceThumbnails: true });
      } catch (err) {
        showFeedback("error", err instanceof Error ? err.message : t('multiview.previewFailed', 'Preview failed'));
      } finally {
        if (mountedRef.current) setPushingId(null);
      }
      return;
    }

    // Admin-uploaded custom Multi-View look — also a single complete OBS look, generic/data-driven
    // (see customLookLook.ts): there is one function for every uploaded look, parameterized by the
    // fetched package's own html + cameraSlot, rather than one hardcoded module per design.
    const customLookId = parseCustomLookLayoutId(mv.layoutId);
    if (customLookId) {
      const look = customLooks.find((entry) => entry.lookId === customLookId);
      if (!look || !look.package) { showFeedback("error", t('multiview.layoutNotFound')); return; }
      const cameraSceneName = mv.customLookCameraSceneName || customLookCameraScenes[customLookId] || getCustomLookCameraScene(customLookId);
      if (!cameraSceneName) { showFeedback("error", "Choose which OBS scene has your camera first."); return; }
      setPushingId(mv.id);
      try {
        const { sceneName } = await applyCustomMultiViewLook(dockObsClient, {
          lookId: customLookId,
          html: look.package.html,
          cameraSlot: look.package.cameraSlot,
          cameraSceneName,
        });
        try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { /* non-critical */ }
        showFeedback("success", `"${sceneName}" previewed in OBS`);
        refreshObsScenes({ forceThumbnails: true });
      } catch (err) {
        showFeedback("error", err instanceof Error ? err.message : t('multiview.previewFailed', 'Preview failed'));
      } finally {
        if (mountedRef.current) setPushingId(null);
      }
      return;
    }

    // Scripture Arch — same single-look pipeline as Scripture Circle above.
    const archThemeId = parseScriptureArchThemeId(mv.layoutId);
    if (archThemeId) {
      const theme = scriptureArchThemes.find((entry) => entry.id === archThemeId) ?? getScriptureArchTheme(archThemeId);
      if (!theme) { showFeedback("error", t('multiview.layoutNotFound')); return; }
      setPushingId(mv.id);
      try {
        const settings = {
          ...theme.settings,
          cameraSceneName: mv.scriptureArchCameraSceneName || theme.settings.cameraSceneName,
        };
        const { sceneName } = await applyScriptureArchLook(dockObsClient, settings);
        try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { /* non-critical */ }
        showFeedback("success", `"${sceneName}" previewed in OBS`);
        refreshObsScenes({ forceThumbnails: true });
      } catch (err) {
        showFeedback("error", err instanceof Error ? err.message : t('multiview.previewFailed', 'Preview failed'));
      } finally {
        if (mountedRef.current) setPushingId(null);
      }
      return;
    }

    // Scripture Gold Circle — same single-look pipeline as Scripture Circle above.
    const goldCircleThemeId = parseScriptureGoldCircleThemeId(mv.layoutId);
    if (goldCircleThemeId) {
      const theme = scriptureGoldCircleThemes.find((entry) => entry.id === goldCircleThemeId) ?? getScriptureGoldCircleTheme(goldCircleThemeId);
      if (!theme) { showFeedback("error", t('multiview.layoutNotFound')); return; }
      setPushingId(mv.id);
      try {
        const settings = {
          ...theme.settings,
          cameraSceneName: mv.scriptureGoldCircleCameraSceneName || theme.settings.cameraSceneName,
        };
        const { sceneName } = await applyScriptureGoldCircleLook(dockObsClient, settings);
        try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { /* non-critical */ }
        showFeedback("success", `"${sceneName}" previewed in OBS`);
        refreshObsScenes({ forceThumbnails: true });
      } catch (err) {
        showFeedback("error", err instanceof Error ? err.message : t('multiview.previewFailed', 'Preview failed'));
      } finally {
        if (mountedRef.current) setPushingId(null);
      }
      return;
    }

    const layout = resolveLayout(mv.layoutId, addedLayouts);
    if (!layout) { showFeedback("error", t('multiview.layoutNotFound')); return; }

    const hasAny = Object.values(mv.assignments).some(v => v);
    if (!hasAny) { showFeedback("error", t('multiview.assignBeforePush')); return; }

    const legacySourceSlot = layout.slots.find(slot => mv.assignments[slot.id] && mv.slotModes?.[slot.id] === "source");
    if (legacySourceSlot) {
      showFeedback("error", t('multiview.sourcesNoLongerSupported', 'Replace source assignments with OBS scenes before pushing.'));
      return;
    }

    setPushingId(mv.id);
    try {
      const sceneName = mv.obsSceneName;
      await ensureScene(sceneName);
      const prefix = `${mv.id}::`;

      // ── Phase 0: Remove ALL existing items from this scene before rebuilding ──
      try {
        const existing = await dockObsClient.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        for (const item of existing.sceneItems ?? []) {
          await dockObsClient.call("RemoveSceneItem", { sceneName, sceneItemId: item.sceneItemId }).catch(() => { });
        }
      } catch { /* scene may be empty */ }

      // Helper: create or update a managed input and return its sceneItemId
      const createManagedItem = async (inputName: string, inputKind: string, inputSettings: Record<string, unknown>): Promise<number> => {
        // A managed source can change type when the user switches a card from
        // color/image/video to a pattern (or back). OBS does not allow
        // SetInputSettings to change the input kind, so remove only this
        // uniquely-named MCE input before recreating it with the new kind.
        try {
          const inputList = await dockObsClient.call("GetInputList") as {
            inputs?: Array<{ inputName: string; inputKind?: string }>;
          };
          const existingInput = inputList.inputs?.find((input) => input.inputName === inputName);
          if (existingInput?.inputKind && existingInput.inputKind !== inputKind) {
            await dockObsClient.call("RemoveInput", { inputName });
          }
        } catch {
          // CreateInput's existing-source fallback below still handles older
          // OBS bridges that do not expose input metadata.
        }

        try {
          const resp = await dockObsClient.call("CreateInput", {
            sceneName, inputName, inputKind, inputSettings, sceneItemEnabled: true,
          }) as { sceneItemId: number };
          return resp.sceneItemId;
        } catch (createErr) {
          // CreateInput may fail if the source already exists — fall back to re-adding it
          console.warn("[DockMultiview] CreateInput failed, attempting fallback:", { inputName, inputKind }, String(createErr));
          // Update existing source settings, then re-add to scene
          await dockObsClient.call("SetInputSettings", { inputName, inputSettings }).catch(() => { });
          await dockObsClient.call("RemoveSceneItem", { sceneName, sourceName: inputName }).catch(() => { });
          await dockObsClient.call("AddSceneItem", { sceneName, sourceName: inputName });
          const existing = await dockObsClient.call("GetSceneItemId", { sceneName, sourceName: inputName }) as { sceneItemId: number };
          return existing.sceneItemId;
        }
      };

      // ── Phase 1: Create / find all managed scene items ──────────────────
      const entries: Array<{ slotId: string; sceneItemId: number; zIndex: number; sourceSize?: SourceSize }> = [];

      // Background (always zIndex 0) — skip when transparent/effectively none
      const bg = getMvBg(mv);
      const bgSourceName = `${prefix}BACKGROUND`;
      const isBgEmpty = (bg.type === "color" && (bg.color === "transparent" || bg.color === "#0F172A"))
        || (bg.type === "scene" && !bg.sceneName)
        || (bg.type === "pattern" && !bg.patternSrc)
        || ((bg.type === "image" || bg.type === "video") && !bg.filePath);
      try {
        let bgItemId = -1;
        if (isBgEmpty) {
          // No background — skip
        } else if (bg.type === "scene" && bg.sceneName) {
          // Scene as background — CreateSceneItem adds a scene as a nested source
          const created = await dockObsClient.call("CreateSceneItem", {
            sceneName, sourceName: bg.sceneName, sceneItemEnabled: true,
          }) as { sceneItemId: number };
          bgItemId = created.sceneItemId;
        } else {
          let inputKind = "color_source_v3";
          let inputSettings: Record<string, unknown> = { color: cssColorToObsInt(bg.color || "#0F172A"), width: CANVAS_W, height: CANVAS_H };
          if (bg.type === "image" && bg.filePath) {
            inputKind = "image_source";
            inputSettings = { file: bg.filePath, width: CANVAS_W, height: CANVAS_H };
          } else if (bg.type === "video" && bg.filePath) {
            inputKind = "ffmpeg_source";
            inputSettings = { local_file: bg.filePath, is_local_file: true, looping: true, restart_on_activate: true, close_when_inactive: true };
          } else if (bg.type === "pattern" && bg.patternSrc) {
            // SVG is not consistently rendered by OBS's native image source.
            // Keep the pattern in memory and let Browser Source render it so
            // the selected pattern is visible without creating user media.
            inputKind = "browser_source";
            inputSettings = {
              url: buildMultiviewPatternBrowserUrl(bg.patternSrc),
              width: CANVAS_W,
              height: CANVAS_H,
              css: "",
              bgcolor: "#00000000",
              shutdown: false,
              restart_when_active: false,
            };
          }
          bgItemId = await createManagedItem(bgSourceName, inputKind, inputSettings);
        }
        if (bgItemId >= 0) entries.push({ slotId: "bg", sceneItemId: bgItemId, zIndex: 0 });
      } catch { /* non-critical */ }

      // Slots — add assigned scenes directly as scene items (scenes are sources in OBS)
      for (const slot of layout.slots) {
        const assigned = mv.assignments[slot.id];
        if (!assigned) continue;
        const assignedMode = mv.slotModes?.[slot.id] ?? "scene";
        try {
          const created = await dockObsClient.call("CreateSceneItem", {
            sceneName, sourceName: assigned, sceneItemEnabled: true,
          }) as { sceneItemId: number };
          if (created.sceneItemId >= 0) {
            const sourceSize = await getSceneItemSourceSize(sceneName, created.sceneItemId);
            entries.push({ slotId: slot.id, sceneItemId: created.sceneItemId, zIndex: slot.zIndex ?? 1, sourceSize });
          }
        } catch (err) {
          console.warn("[DockMultiview] slot push failed for", { slotId: slot.id, assigned, mode: assignedMode, err });
        }
      }

      // ── Phase 1.5: Generate composite frame overlay (one transparent PNG with all frames) ──
      const frameSourceName = "MCE · Frames";
      const pngBytes = await generateCompositeFramePng(
        layout,
        mv.layoutFrameId,
        mv.slotFrames,
        mv.frameThickness ?? 2,
        mv.frameCornerRadius ?? 0,
        mv.frameOpacity ?? 100,
        mv.frameColor ?? "",
        mv.margin ?? DEFAULT_MULTIVIEW_MARGIN,
        mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP,
      );
      if (pngBytes) {
        const framePath = await saveFramePngToDisk(pngBytes);
        if (framePath) {
          try {
            const frameItemId = await createManagedItem(frameSourceName, "image_source", { file: framePath });
            if (frameItemId >= 0) {
              entries.push({ slotId: "__frame__", sceneItemId: frameItemId, zIndex: 999 });
            }
          } catch (err) {
            console.warn("[DockMultiview] frame source creation failed", err);
          }
        }
      } else {
        // No frames — remove existing frame source if present
        try {
          await dockObsClient.call("RemoveSceneItem", { sceneName, sourceName: frameSourceName }).catch(() => { });
        } catch { }
      }

      try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { }

      // ── Phase 2: Apply transforms ──────────────────────────────────────
      const canvas = typeof dockObsClient.getCanvasSize === "function"
        ? await dockObsClient.getCanvasSize()
        : { width: CANVAS_W, height: CANVAS_H };
      const currentW = canvas.width || CANVAS_W;
      const currentH = canvas.height || CANVAS_H;
      const scaleX = currentW / CANVAS_W;
      const scaleY = currentH / CANVAS_H;

      const m = (mv.margin ?? DEFAULT_MULTIVIEW_MARGIN) > 0 ? Math.min(mv.margin ?? DEFAULT_MULTIVIEW_MARGIN, 200) : 0;

      for (const entry of entries) {
        if (entry.slotId === "bg") {
          const bgX = (mv.affectBackground && m > 0) ? Math.round(m * scaleX) : 0;
          const bgY = (mv.affectBackground && m > 0) ? Math.round(m * scaleY) : 0;
          const bgW = (mv.affectBackground && m > 0) ? (currentW - 2 * bgX) : currentW;
          const bgH = (mv.affectBackground && m > 0) ? (currentH - 2 * bgY) : currentH;
          await dockObsClient.call("SetSceneItemTransform", {
            sceneName,
            sceneItemId: entry.sceneItemId,
            sceneItemTransform: {
              positionX: bgX, positionY: bgY, scaleX: 1, scaleY: 1, rotation: 0,
              boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: bgW, boundsHeight: bgH,
              boundsAlignment: 0, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
            },
          });
        } else if (entry.slotId === "__frame__") {
          // Full-canvas frame overlay at origin
          await dockObsClient.call("SetSceneItemTransform", {
            sceneName,
            sceneItemId: entry.sceneItemId,
            sceneItemTransform: {
              positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0,
              boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: currentW, boundsHeight: currentH,
              boundsAlignment: 0, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
            },
          });
        } else {
          const slot = layout.slots.find(s => s.id === entry.slotId);
          if (!slot) continue;
          const framing = mv.slotFraming?.[entry.slotId] ?? DEFAULT_SLOT_FRAMING;
          const sourceSize = entry.sourceSize ?? normalizeSourceSize();
          const eff = calculateMultiviewMarginSlotRect(slot, mv.margin ?? DEFAULT_MULTIVIEW_MARGIN, mv.slotGap ?? DEFAULT_MULTIVIEW_SLOT_GAP, CANVAS_W, CANVAS_H);
          const effX = Math.round(eff.x * scaleX);
          const effY = Math.round(eff.y * scaleY);
          const effW = Math.round(eff.width * scaleX);
          const effH = Math.round(eff.height * scaleY);
          const tx = calculateSlotTransform(
            sourceSize.width, sourceSize.height,
            { x: effX, y: effY, width: effW, height: effH },
            { mode: framing.displayMode, focalX: framing.focalX ?? 0.5, focalY: framing.focalY ?? 0.5, zoom: framing.zoom ?? 1 },
          );
          const hasCrop = (tx.cropLeft ?? 0) > 0 || (tx.cropRight ?? 0) > 0 || (tx.cropTop ?? 0) > 0 || (tx.cropBottom ?? 0) > 0;
          await dockObsClient.call("SetSceneItemTransform", {
            sceneName,
            sceneItemId: entry.sceneItemId,
            sceneItemTransform: {
              positionX: hasCrop ? effX : tx.positionX,
              positionY: hasCrop ? effY : tx.positionY,
              scaleX: tx.scaleX ?? tx.scale,
              scaleY: tx.scaleY ?? tx.scale,
              rotation: 0,
              boundsType: "OBS_BOUNDS_NONE",
              cropLeft: Math.round(tx.cropLeft ?? 0),
              cropRight: Math.round(tx.cropRight ?? 0),
              cropTop: Math.round(tx.cropTop ?? 0),
              cropBottom: Math.round(tx.cropBottom ?? 0),
            },
          });
        }
      }

      // ── Phase 3: Order by zIndex ───────────────────────────────────────
      entries.sort((a, b) => a.zIndex - b.zIndex);
      for (let i = 0; i < entries.length; i++) {
        await dockObsClient.call("SetSceneItemIndex", { sceneName, sceneItemId: entries[i].sceneItemId, sceneItemIndex: i });
      }

      // ── Phase 4: Lock items ────────────────────────────────────────────
      for (const entry of entries) {
        try {
          await dockObsClient.call("SetSceneItemLocked", { sceneName, sceneItemId: entry.sceneItemId, sceneItemLocked: true });
        } catch { /* not supported on older OBS versions */ }
      }

      // ── Phase 5: Verify order ──────────────────────────────────────────
      try {
        const verify = await dockObsClient.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }>;
        };
        const orderedItems = [...(verify.sceneItems ?? [])].sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
        const expectedIds = entries.map(e => e.sceneItemId);
        const actualIds = orderedItems.map(si => si.sceneItemId);
        if (expectedIds.some((id, idx) => id !== actualIds[idx])) {
          console.warn("[Multiview] Order mismatch after SetSceneItemIndex — reapplying order", { expected: expectedIds, actual: actualIds });
          for (let i = 0; i < entries.length; i++) {
            await dockObsClient.call("SetSceneItemIndex", { sceneName, sceneItemId: entries[i].sceneItemId, sceneItemIndex: i });
          }
        }
      } catch { /* verify non-critical */ }

      try { await dockObsClient.call("SetCurrentPreviewScene", { sceneName }); } catch { }

      showFeedback("success", `"${sceneName}" previewed in OBS`);
      refreshObsScenes({ forceThumbnails: true });
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : t('multiview.previewFailed', 'Preview failed'));
    } finally {
      if (mountedRef.current) setPushingId(null);
    }
  }, [ensureScene, refreshObsScenes, showFeedback, t, addedLayouts, scriptureCircleThemes, scriptureArchThemes, scriptureGoldCircleThemes, customLooks, customLookCameraScenes]);

  const handleClear = useCallback(async (mv: SavedMultiView) => {
    await ensureObsConnected();
    if (!dockObsClient.isConnected) return;
    setClearingId(mv.id);
    try {
      const sceneName = mv.obsSceneName;
      const prefix = `${mv.id}::`;
      await dockObsClient.fadeOutAllSceneItems(sceneName).catch(() => { });

      try {
        const prog = await dockObsClient.call("GetCurrentProgramScene") as { currentProgramSceneName?: string };
        if (prog.currentProgramSceneName && prog.currentProgramSceneName !== sceneName) {
          await dockObsClient.call("SetCurrentPreviewScene", { sceneName: prog.currentProgramSceneName }).catch(() => { });
        }
      } catch { }

      try {
        const items = await dockObsClient.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        for (const item of items.sceneItems ?? []) {
          if (!item.sourceName?.startsWith(prefix)) continue;
          await dockObsClient.call("RemoveSceneItem", { sceneName, sceneItemId: item.sceneItemId }).catch(() => { });
        }
      } catch { }

      showFeedback("success", `"${sceneName}" cleared`);
      refreshObsScenes({ forceThumbnails: true });
    } catch { /* ignore */ }
    finally { if (mountedRef.current) setClearingId(null); }
  }, [refreshObsScenes, showFeedback]);

  // ════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════

  const deleteTarget = deleteTargetId ? savedList.find(m => m.id === deleteTargetId) : null;
  const multiviewEntitlement = checkEntitlementSync("multiview", dockPlan);

  if (!multiviewEntitlement.allowed) {
    return (
      <div className="dock-mv-tab" role="status">
        <div style={{ padding: "32px 20px", textAlign: "center" }}>
          <Icon name="lock" size={36} />
          <div style={{ fontSize: 14, fontWeight: 700, margin: "14px 0 8px" }}>
            {t("upgrade.multiviewRequired", "Multi-View requires Basic plan or higher")}
          </div>
          <div style={{ fontSize: 11, color: "var(--dock-text-dim)", lineHeight: 1.5, marginBottom: 18 }}>
            {t("upgrade.multiviewDescription", "Build broadcast layouts with multiple camera, scripture, and media views.")}
          </div>
          <button
            type="button"
            className="dock-btn dock-btn--primary dock-btn--sm dock-upgrade-plan-btn"
            onClick={() => showUpgradeModal(t("upgrade.multiviewRequiredMessage", "Upgrade to Basic or higher to enable Multi-View."))}
          >
            <Icon name="upgrade" size={14} />
            <span>{t("upgrade.upgradePlan", "Upgrade Plan")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dock-mv-tab">
      {/* ── Feedback ── */}
      {feedback && (
        <div className={`dock-mv-tab__feedback dock-mv-tab__feedback--${feedback.type}`}>
          <Icon name={feedback.type === "success" ? "check_circle" : "error"} size={14} />
          <span>{feedback.text}</span>
          <button type="button" className="dock-mv-tab__feedback-close" onClick={() => setFeedback(null)} title={t('common.close')}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* ── Cards ── */}
      <div className="dock-mv-tab__list">
        {savedList.map((mv, idx) => (
          <MVCard
            key={mv.id}
            mv={mv}
            index={idx}
            isActive={obsScenes.includes(mv.obsSceneName)}
            obsScenes={obsScenes}
            obsSources={obsSources}
            obsContentLoading={obsContentLoading || (!obsContentLoaded && obsReady)}
            addedLayouts={addedLayouts}
            pushingId={pushingId}
            clearingId={clearingId}
            onPush={handlePush}
            onClear={handleClear}
            onUpdateName={handleUpdateName}
            onUpdateLayout={handleUpdateLayout}
            onUpdateBackground={handleUpdateBackground}
            onAssign={handleAssign}
            onAssignSlotFraming={handleAssignSlotFraming}
            onAssignScriptureCircleCamera={handleAssignScriptureCircleCamera}
            onAssignScriptureArchCamera={handleAssignScriptureArchCamera}
            onAssignScriptureGoldCircleCamera={handleAssignScriptureGoldCircleCamera}
            onAssignCustomLookCamera={handleAssignCustomLookCamera}
            onClearSlot={handleRemoveSlot}
            onUpdateFrame={handleUpdateFrame}
            onUpdateFrameThickness={handleUpdateFrameThickness}
            onUpdateFrameCornerRadius={handleUpdateFrameCornerRadius}
            onUpdateFrameOpacity={handleUpdateFrameOpacity}
            onUpdateFrameColor={handleUpdateFrameColor}
            onUpdateSlotFrame={handleUpdateSlotFrame}
            onUpdateMargin={handleUpdateMargin}
            onUpdateSlotGap={handleUpdateSlotGap}
            onUpdateAffectBackground={handleUpdateAffectBackground}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onReloadTemplates={handleReloadLayouts}
            onDeleteTemplate={handleDeleteTemplate}
            isReloadingTemplates={isReloadingTemplates}
          />
        ))}
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <DeleteModal
          mvName={deleteTarget.name}
          onConfirm={(deleteObs) => handleDeleteConfirmed(deleteTarget.id, deleteObs)}
          onCancel={() => setDeleteTargetId(null)}
        />
      )}
    </div>
  );
}

export default memo(DockMultiviewTab);
