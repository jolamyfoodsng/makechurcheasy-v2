/**
 * MVRegionLibrary.tsx — Left panel: OBS Scenes + Background + Logo + Slots
 *
 * v3: Compact Background row with "Change" button → opens a background modal.
 *     Logo section with upload + preview. Empty-slot click-to-add popover.
 *     Fetches real OBS scenes and lets users place them on the canvas.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useEditor } from "../editorStore";
import { regionTypeLabel, regionTypeIcon, type Region, type OBSSceneRegion, type RegionId, type MVLayout, type TemplateId } from "../types";
import { obsService } from "../../services/obsService";
import { startSceneDrag, useDragState } from "../hooks/useDragDrop";
import { TEMPLATE_LIBRARY } from "../templates";
import * as db from "../mvStore";
import type { MediaItem } from "../mvStore";
import { nanoid } from "nanoid";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { DEFAULT_THEME_SETTINGS, type BibleTheme } from "../../bible/types";
import { getCustomThemes } from "../../bible/bibleDb";
import Icon from "../../components/Icon";
import { getRecommendedPollingInterval } from "../../services/performanceManager";

type SidebarTab = "main" | "templates" | "logos" | "media";

const MV_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"] as const;
const MV_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".wmv", ".m4v", ".3gp"] as const;
const MV_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp"] as const;
const MV_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/mkv",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/x-m4v",
  "video/3gpp",
] as const;
const MV_BG_IMAGE_ACCEPT = [...MV_IMAGE_MIME_TYPES, ...MV_IMAGE_EXTENSIONS].join(",");
const MV_BG_VIDEO_ACCEPT = [...MV_VIDEO_MIME_TYPES, ...MV_VIDEO_EXTENSIONS].join(",");
const MV_LOGO_IMAGE_ACCEPT = [...MV_IMAGE_MIME_TYPES, ...MV_IMAGE_EXTENSIONS].join(",");

function hasAllowedExtension(filename: string, allowed: readonly string[]): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = filename.slice(dot).toLowerCase();
  return allowed.includes(ext);
}

// ── Worship themes (same set shared with MVCanvas & MVInspector) ──
const WORSHIP_THEMES: BibleTheme[] = [
  { id: "worship-classic", name: "Classic Worship", description: "Traditional worship lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans", sans-serif', fontSize: 52, fontWeight: "bold", fontColor: "#FFFFFF", lineHeight: 1.7, textAlign: "center", textShadow: "0 2px 12px rgba(0,0,0,0.8)", textOutline: false, textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none", refFontSize: 22, refFontColor: "#aaaaaa", refFontWeight: "normal", refPosition: "bottom", backgroundColor: "#0a0a14", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 60, padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "fade", animationDuration: 500 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
  { id: "worship-modern", name: "Modern Worship", description: "Bold modern lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans Bold", sans-serif', fontSize: 56, fontWeight: "bold", fontColor: "#FFFFFF", lineHeight: 1.6, textAlign: "center", textShadow: "0 4px 20px rgba(0,0,0,0.9)", textOutline: true, textOutlineColor: "rgba(0,0,0,0.3)", textOutlineWidth: 1, textTransform: "uppercase", refFontSize: 20, refFontColor: "#d4af37", refFontWeight: "bold", refPosition: "bottom", backgroundColor: "#000000", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 60, padding: 100, safeArea: 60, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "slide-up", animationDuration: 600 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
  { id: "worship-minimal", name: "Minimal Worship", description: "Clean minimal lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans Light", sans-serif', fontSize: 44, fontWeight: "light", fontColor: "#333333", lineHeight: 1.5, textAlign: "center", textShadow: "none", textOutline: false, textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none", refFontSize: 18, refFontColor: "#888888", refFontWeight: "normal", refPosition: "bottom", backgroundColor: "#f8f8f8", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 50, padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "fade", animationDuration: 300 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
];

interface OBSSceneItem {
  sceneName: string;
  sceneIndex: number;
  thumbnail: string | null;
}

interface SceneCtxMenu {
  x: number;
  y: number;
  sceneName: string;
  sceneIndex: number;
}

/** Popover anchor for "click to add source" on empty slots */
interface SlotPopover {
  regionId: RegionId;
  x: number;
  y: number;
}

export function MVRegionLibrary() {
  const { state, dispatch, updateRegion, setBackground, assignSceneToRegion, unassignSceneFromRegion } = useEditor();
  const regions = state.layout?.regions ?? [];
  const background = state.layout?.background;

  // ── Drag state (for sidebar slot drop targets) ──
  const { isDragging, payload: dragPayload } = useDragState();

  // ── OBS Scenes ──
  const [scenes, setScenes] = useState<OBSSceneItem[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [obsConnected, setOBSConnected] = useState(obsService.status === "connected");
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const bgVideoInputRef = useRef<HTMLInputElement>(null);

  // ── Scene context menu (right-click on OBS scene) ──
  const [sceneCtx, setSceneCtx] = useState<SceneCtxMenu | null>(null);

  // ── Expanded slots ──
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());

  // ── Background modal ──
  const [showBgModal, setShowBgModal] = useState(false);
  const [bgModalTab, setBgModalTab] = useState<"library" | "upload" | "color">("upload");

  // ── Logo modal ──
  const [showLogoModal, setShowLogoModal] = useState(false);

  // ── Sidebar tab state ──
  const [activeTab, setActiveTab] = useState<SidebarTab>("main");

  // ── Templates tab search + data ──
  const [tplSearch, setTplSearch] = useState("");
  const [pastLayouts, setPastLayouts] = useState<MVLayout[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [tplSubTab, setTplSubTab] = useState<"templates" | "layouts">("templates");
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "video">("all");
  const [mediaSearch, setMediaSearch] = useState("");

  // ── Slot popover (empty slot → click to add) ──
  const [slotPopover, setSlotPopover] = useState<SlotPopover | null>(null);
  const [slotPopoverTab, setSlotPopoverTab] = useState<"scenes" | "bible" | "worship">("scenes");

  // ── Missing scenes modal ──
  const [missingScene, setMissingScene] = useState<{ regionId: RegionId; sceneName: string } | null>(null);
  const [substitutePopover, setSubstitutePopover] = useState<{ regionId: RegionId; x: number; y: number } | null>(null);

  // ── Custom Bible themes from IndexedDB ──
  const [customBibleThemes, setCustomBibleThemes] = useState<BibleTheme[]>([]);

  // ── Scene list reorder drag ──
  const [reorderDrag, setReorderDrag] = useState<{ fromIndex: number } | null>(null);
  const [reorderOverIndex, setReorderOverIndex] = useState<number | null>(null);

  // ── OBS scene multi-select + delete ──
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [showSceneDeleteModal, setShowSceneDeleteModal] = useState(false);
  const [deletingScenes, setDeletingScenes] = useState(false);
  const [liveSceneWarning, setLiveSceneWarning] = useState(false);

  // ── Live program scene (polled from OBS) ──
  const [programScene, setProgramScene] = useState<string>("");

  // ── Template confirmation modal ──
  const [pendingTemplate, setPendingTemplate] = useState<{
    regions: Region[];
    canvas: MVLayout["canvas"];
    background: MVLayout["background"];
    safeFrame: MVLayout["safeFrame"];
    fromTemplateId?: TemplateId;
    name: string;
    icon?: string;
  } | null>(null);
  const [showOverflowModal, setShowOverflowModal] = useState(false);
  const [overflowScenes, setOverflowScenes] = useState<string[]>([]);
  const [_overflowKept, setOverflowKept] = useState<Set<string>>(new Set());

  // ── Logo regions (all image-overlay regions with "logo" in name/slotLabel) ──
  const logoRegions = regions.filter(
    (r) => r.type === "image-overlay" && (r.name?.toLowerCase().includes("logo") || r.slotLabel?.toLowerCase().includes("logo"))
  );
  // Keep single-logo shortcut for backwards compatibility
  const logoRegion = logoRegions[0] ?? null;

  // ── Logo edit state ──
  const [editingLogoId, setEditingLogoId] = useState<RegionId | null>(null);

  // Hidden file inputs for each logo region — we'll use a ref map
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  // ── Load past layouts + media when relevant tabs open ──
  useEffect(() => {
    if (activeTab === "templates") {
      db.getUserLayouts().then((layouts) => setPastLayouts(layouts)).catch(() => { });
    }
    if (activeTab === "templates" || activeTab === "media") {
      db.getAllMedia().then((items) => setMediaItems(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch(() => { });
    }
  }, [activeTab]);

  // ── Load custom Bible themes from IndexedDB ──
  useEffect(() => {
    let cancelled = false;
    getCustomThemes().then((themes) => { if (!cancelled) setCustomBibleThemes(themes); }).catch(() => { });
    return () => { cancelled = true; };
  }, [slotPopover]);

  // ── Sync editor state's showBackgroundPicker → local modal ──
  useEffect(() => {
    if (state.showBackgroundPicker) {
      setShowBgModal(true);
      // Reset the editor state flag so it can be toggled again
      dispatch({ type: "TOGGLE_BACKGROUND_PICKER" });
    }
  }, [state.showBackgroundPicker, dispatch]);

  // Listen for OBS connection changes
  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setOBSConnected(s === "connected"));
    return unsub;
  }, []);

  // Fetch scenes when connected
  const fetchScenes = useCallback(async () => {
    if (obsService.status !== "connected") { setScenes([]); return; }
    setLoadingScenes(true);
    try {
      const sceneList = await obsService.getSceneList();
      const items: OBSSceneItem[] = await Promise.all(
        sceneList.map(async (s, i) => {
          let thumb: string | null = null;
          try { thumb = await obsService.getSourceScreenshot(s.sceneName, 160); } catch { /* */ }
          return { sceneName: s.sceneName, sceneIndex: i, thumbnail: thumb };
        })
      );
      setScenes(items);
    } catch (err) {
      console.warn("[MVRegionLibrary] Failed to fetch scenes:", err);
      setScenes([]);
    } finally { setLoadingScenes(false); }
  }, []);

  useEffect(() => {
    if (obsConnected) fetchScenes(); else setScenes([]);
  }, [obsConnected, fetchScenes]);

  // ── Poll live program scene from OBS (every 2s) ──
  useEffect(() => {
    if (!obsConnected) { setProgramScene(""); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const name = await obsService.getCurrentProgramScene();
        if (!cancelled) setProgramScene(name);
      } catch { /* OBS not ready */ }
    };
    poll();
    const iv = setInterval(poll, getRecommendedPollingInterval(2000));
    return () => { cancelled = true; clearInterval(iv); };
  }, [obsConnected]);

  // ── Periodic OBS scene validation ──
  // Check every 10s if assigned scenes still exist in OBS
  useEffect(() => {
    if (!obsConnected) return;
    let cancelled = false;

    const validate = async () => {
      try {
        const sceneList = await obsService.getSceneList();
        const existingNames = new Set(sceneList.map((s) => s.sceneName));
        const assignedRegions = regions.filter(
          (r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName
        ) as OBSSceneRegion[];

        for (const region of assignedRegions) {
          if (cancelled) return;
          if (!existingNames.has(region.sceneName)) {
            // Scene was removed from OBS
            setMissingScene({ regionId: region.id, sceneName: region.sceneName });
            return; // Show one at a time
          }
        }
      } catch {
        // OBS may have disconnected
      }
    };

    const iv = setInterval(validate, 10_000);
    // Also validate once immediately
    const timeout = setTimeout(validate, 2000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(timeout); };
  }, [obsConnected, regions]);

  // ── Handle background file uploads ──
  const onBgFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video") => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate MIME type
      if (type === "image" && !file.type.startsWith("image/") && !hasAllowedExtension(file.name, MV_IMAGE_EXTENSIONS)) {
        alert("Please select an image file (JPG, PNG, WebP, etc.)");
        e.target.value = "";
        return;
      }
      if (type === "video" && !file.type.startsWith("video/") && !hasAllowedExtension(file.name, MV_VIDEO_EXTENSIONS)) {
        alert("Please select a video file (MP4, WebM, MOV, etc.)");
        e.target.value = "";
        return;
      }

      // Read as data URL for canvas preview
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      // Save to disk via Tauri so OBS can reference the file path
      let diskPath: string | undefined;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const safeName = `bg_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        diskPath = await invoke<string>("save_upload_file", {
          fileName: safeName,
          fileData: Array.from(bytes),
        });
      } catch (err) {
        console.warn("[MVRegionLibrary] Could not save to disk (OBS may not show file):", err);
      }

      if (type === "image") {
        setBackground({ type: "image", imageSrc: dataUrl, filePath: diskPath });
      } else {
        setBackground({ type: "video", videoSrc: dataUrl, loop: true, filePath: diskPath });
      }

      // Persist to media library for reuse
      if (diskPath) {
        const existing = await db.findMediaByPath(diskPath);
        if (!existing) {
          await db.saveMediaItem({
            id: nanoid(12),
            name: file.name,
            mediaType: type,
            filePath: diskPath,
            previewSrc: dataUrl,
            mimeType: file.type,
            size: file.size,
            createdAt: new Date().toISOString(),
            tags: ["background"],
          });
        }
      }

      setShowBgModal(false);
      e.target.value = "";
    },
    [setBackground]
  );

  // ── Handle logo file upload (per-region) ──
  const [uploadTargetLogoId, setUploadTargetLogoId] = useState<RegionId | null>(null);

  const onLogoFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate MIME type
      if (!file.type.startsWith("image/") && !hasAllowedExtension(file.name, MV_IMAGE_EXTENSIONS)) {
        alert("Please select an image file (PNG recommended for transparency)");
        e.target.value = "";
        return;
      }

      // Read as data URL for canvas preview
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      // Save to disk via Tauri so OBS can reference the file path
      let diskPath: string | undefined;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const safeName = `logo_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        diskPath = await invoke<string>("save_upload_file", {
          fileName: safeName,
          fileData: Array.from(bytes),
        });
      } catch (err) {
        console.warn("[MVRegionLibrary] Could not save logo to disk:", err);
      }

      const logoName = file.name.replace(/\.[^.]+$/, "") || "Logo";
      const targetId = uploadTargetLogoId;

      if (targetId) {
        // Update existing logo region
        const target = regions.find((r) => r.id === targetId);
        if (target) {
          updateRegion(target.id, {
            src: diskPath || dataUrl,
            filePath: diskPath,
            name: target.name || logoName,
          } as Partial<Region>);
        }
      } else {
        // Find first logo region without a src, or the single logo region
        const emptyLogo = logoRegions.find((r) => !(r as any).src);
        const targetRegion = emptyLogo || logoRegion;
        if (targetRegion) {
          updateRegion(targetRegion.id, {
            src: diskPath || dataUrl,
            filePath: diskPath,
            name: targetRegion.name || logoName,
          } as Partial<Region>);
        } else {
          // Create a new image-overlay region
          dispatch({ type: "SNAPSHOT" });
          dispatch({ type: "ADD_REGION", regionType: "image-overlay" });
          requestAnimationFrame(() => {
            setTimeout(() => {
              const currentRegions = state.layout?.regions;
              if (!currentRegions) return;
              const newLogo = [...currentRegions].reverse().find((r) => r.type === "image-overlay");
              if (newLogo) {
                updateRegion(newLogo.id, {
                  src: diskPath || dataUrl,
                  filePath: diskPath,
                  name: logoName,
                  slotLabel: "Logo",
                } as Partial<Region>);
              }
            }, 100);
          });
        }
      }
      setUploadTargetLogoId(null);
      setShowLogoModal(false);

      // Persist to media library for reuse
      if (diskPath) {
        const existing = await db.findMediaByPath(diskPath);
        if (!existing) {
          await db.saveMediaItem({
            id: nanoid(12),
            name: file.name,
            mediaType: "image",
            filePath: diskPath,
            previewSrc: dataUrl,
            mimeType: file.type,
            size: file.size,
            createdAt: new Date().toISOString(),
            tags: ["logo"],
          });
        }
      }

      e.target.value = "";
    },
    [uploadTargetLogoId, regions, logoRegions, logoRegion, dispatch, updateRegion, state.layout?.regions]
  );

  // ── Slot click ──
  const handleSlotClick = (region: Region, e: React.MouseEvent) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    dispatch({ type: "SELECT_REGION", regionId: region.id, additive: multi });
  };

  // ── Toggle slot dropdown ──
  const toggleSlot = (regionId: string) => {
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(regionId)) next.delete(regionId); else next.add(regionId);
      return next;
    });
  };

  // ── Scene right-click context menu ──
  const handleSceneContextMenu = (e: React.MouseEvent, scene: OBSSceneItem) => {
    e.preventDefault();
    e.stopPropagation();
    setSceneCtx({ x: e.clientX, y: e.clientY, sceneName: scene.sceneName, sceneIndex: scene.sceneIndex });
  };

  // Close popups on outside click
  useEffect(() => {
    if (!sceneCtx) return;
    const close = () => setSceneCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
  }, [sceneCtx]);

  useEffect(() => {
    if (!slotPopover) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".mv-popover")) return;
      setSlotPopover(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [slotPopover]);

  useEffect(() => {
    if (!substitutePopover) return;
    const close = () => setSubstitutePopover(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [substitutePopover]);

  // Get obs-scene slots for context menu
  const obsSceneSlots = regions.filter((r) => r.type === "obs-scene");

  // ── Template apply helper: shows confirmation, auto-fits scenes ──
  const requestTemplateApply = useCallback((templateData: {
    regions: Region[];
    canvas: MVLayout["canvas"];
    background: MVLayout["background"];
    safeFrame: MVLayout["safeFrame"];
    fromTemplateId?: TemplateId;
    name: string;
    icon?: string;
  }) => {
    // If no regions currently assigned, skip confirmation and apply directly
    const currentAssigned = regions.filter(
      (r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName
    );
    if (currentAssigned.length === 0) {
      dispatch({ type: "SNAPSHOT" });
      dispatch({
        type: "UPDATE_LAYOUT",
        changes: {
          regions: templateData.regions.map((r) => ({ ...r })),
          canvas: { ...templateData.canvas },
          background: { ...templateData.background },
          safeFrame: { ...templateData.safeFrame },
          fromTemplateId: templateData.fromTemplateId,
        },
      });
      setActiveTab("main");
      return;
    }
    // Otherwise, show confirmation modal
    setPendingTemplate(templateData);
  }, [regions, dispatch]);

  /** Apply a pending template: auto-fit existing assigned scenes into new slots */
  const applyPendingTemplate = useCallback((autoFit: boolean) => {
    if (!pendingTemplate) return;
    dispatch({ type: "SNAPSHOT" });

    const newRegions = pendingTemplate.regions.map((r) => ({ ...r }));

    if (autoFit) {
      // Collect currently assigned scene names in z-order
      const currentAssigned = [...regions]
        .filter((r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((r) => ({
          sceneName: (r as OBSSceneRegion).sceneName,
          sceneIndex: (r as OBSSceneRegion).sceneIndex,
        }));

      // Find obs-scene slots in the new template
      const newSlots = newRegions.filter((r) => r.type === "obs-scene");

      // Map scenes into slots
      const scenesToFit = currentAssigned.slice(0, newSlots.length);
      scenesToFit.forEach((scene, i) => {
        const slot = newSlots[i] as OBSSceneRegion;
        slot.sceneName = scene.sceneName;
        slot.sceneIndex = scene.sceneIndex;
        slot.name = scene.sceneName;
      });

      // Check for overflow scenes (more existing scenes than available slots)
      const overflow = currentAssigned.slice(newSlots.length).map((s) => s.sceneName);
      if (overflow.length > 0) {
        // Apply the template first, then show overflow modal
        dispatch({
          type: "UPDATE_LAYOUT",
          changes: {
            regions: newRegions,
            canvas: { ...pendingTemplate.canvas },
            background: { ...pendingTemplate.background },
            safeFrame: { ...pendingTemplate.safeFrame },
            fromTemplateId: pendingTemplate.fromTemplateId,
          },
        });
        setOverflowScenes(overflow);
        setOverflowKept(new Set(overflow));
        setShowOverflowModal(true);
        setPendingTemplate(null);
        setActiveTab("main");
        return;
      }
    }

    dispatch({
      type: "UPDATE_LAYOUT",
      changes: {
        regions: newRegions,
        canvas: { ...pendingTemplate.canvas },
        background: { ...pendingTemplate.background },
        safeFrame: { ...pendingTemplate.safeFrame },
        fromTemplateId: pendingTemplate.fromTemplateId,
      },
    });
    setPendingTemplate(null);
    setActiveTab("main");
  }, [pendingTemplate, regions, dispatch]);

  // Background label
  const bgLabel = !background || background.type === "color" ? "Solid Color" : background.type === "image" ? "Image" : "Video";

  return (
    <div className="mv-region-library" role="complementary" aria-label="Region library">
      {/* Hidden file inputs */}
      <input ref={bgImageInputRef} type="file" accept={MV_BG_IMAGE_ACCEPT} style={{ display: "none" }} onChange={(e) => onBgFileSelected(e, "image")} />
      <input ref={bgVideoInputRef} type="file" accept={MV_BG_VIDEO_ACCEPT} style={{ display: "none" }} onChange={(e) => onBgFileSelected(e, "video")} />
      <input ref={logoFileInputRef} type="file" accept={MV_LOGO_IMAGE_ACCEPT} style={{ display: "none" }} onChange={(e) => onLogoFileSelected(e)} />

      {/* ── Sidebar Tabs ── */}
      <div className="mv-sidebar-tabs">
        <button className={`mv-sidebar-tab ${activeTab === "main" ? "mv-sidebar-tab--active" : ""}`}
          onClick={() => setActiveTab("main")} title="Main">
          <Icon name="dashboard" size={20} />
          Main
        </button>
        <button className={`mv-sidebar-tab ${activeTab === "templates" ? "mv-sidebar-tab--active" : ""}`}
          onClick={() => setActiveTab("templates")} title="Grid view">
          <Icon name="grid_view" size={20} />
          Templates
        </button>
        <button className={`mv-sidebar-tab ${activeTab === "logos" ? "mv-sidebar-tab--active" : ""}`}
          onClick={() => setActiveTab("logos")} title="Logos">
          <Icon name="branding_watermark" size={20} />
          Logos
        </button>
        <button className={`mv-sidebar-tab ${activeTab === "media" ? "mv-sidebar-tab--active" : ""}`}
          onClick={() => setActiveTab("media")} title="Media">
          <Icon name="perm_media" size={20} />
          Media
        </button>
      </div>

      <div className="mv-sidebar-tab-content">
        {/* ════════════════════════════════════════════════════════
         TAB 1: MAIN — OBS Scenes + Background + Slots
         ════════════════════════════════════════════════════════ */}
        {activeTab === "main" && (
          <>
            {/* ── OBS Scenes ── */}
            <div className="mv-panel-section">
              <h3 className="mv-panel-heading">
                Your Scenes (OBS)
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {selectedScenes.size > 0 && (
                    <button className="mv-panel-heading-action mv-panel-heading-action--danger" title={`Delete ${selectedScenes.size} scene(s) from OBS`}
                      onClick={() => setShowSceneDeleteModal(true)}>
                      <Icon name="delete" size={16} />
                      <span style={{ fontSize: 11 }}>{selectedScenes.size}</span>
                    </button>
                  )}
                  {scenes.length > 0 && (
                    <button className="mv-panel-heading-action" title={selectedScenes.size > 0 ? "Clear selection" : "Select scenes (excludes live)"}
                      onClick={() => {
                        if (selectedScenes.size > 0) setSelectedScenes(new Set());
                        else setSelectedScenes(new Set(scenes.filter((s) => s.sceneName !== programScene).map((s) => s.sceneName)));
                      }}>
                      <Icon name={selectedScenes.size > 0 ? "deselect" : "select_all"} size={16} />
                    </button>
                  )}
                  {obsConnected && (
                    <button className="mv-panel-heading-action" onClick={fetchScenes} title="Refresh scenes">
                      <Icon name="refresh" size={16} />
                    </button>
                  )}
                </div>
              </h3>

              {!obsConnected ? (
                <div className="mv-scenes-empty">
                  <Icon name="link_off" size={24} style={{ opacity: 0.3 }} />
                  <p>Connect to OBS to see scenes</p>
                </div>
              ) : loadingScenes ? (
                <div className="mv-scenes-empty">
                  <Icon name="refresh" size={24} className="mv-spin" style={{ opacity: 0.5 }} />
                  <p>Loading scenes…</p>
                </div>
              ) : scenes.length === 0 ? (
                <div className="mv-scenes-empty">
                  <Icon name="slideshow" size={24} style={{ opacity: 0.3 }} />
                  <p>No scenes found in OBS</p>
                </div>
              ) : (
                <>
                  <p className="mv-drag-hint">Drag a scene onto a canvas slot · Drag handle to reorder</p>
                  <div className="mv-scene-list">
                    {/* ── Live scene (shown first with badge) ── */}
                    {(() => {
                      const liveScene = programScene ? scenes.find((s) => s.sceneName === programScene) : null;
                      const otherScenes = programScene ? scenes.filter((s) => s.sceneName !== programScene) : scenes;
                      const allScenes = liveScene ? [liveScene, ...otherScenes] : otherScenes;

                      return allScenes.map((scene) => {
                        const idx = scenes.indexOf(scene);
                        const isLive = scene.sceneName === programScene;

                        return (
                          <div
                            key={scene.sceneName}
                            role="button"
                            tabIndex={0}
                            className={`mv-scene-item ${isLive ? "mv-scene-item--live" : ""} ${reorderDrag && reorderOverIndex === idx ? "mv-scene-item--drag-over" : ""} ${reorderDrag?.fromIndex === idx ? "mv-scene-item--dragging" : ""} ${selectedScenes.has(scene.sceneName) ? "mv-scene-item--selected" : ""}`}
                            onMouseDown={(e) => {
                              if (e.button === 2) return;
                              const target = e.target as HTMLElement;
                              // Ignore checkbox clicks — handled by onClick on the checkbox span
                              if (target.closest(".mv-scene-select-cb")) return;
                              // Reorder drag handle
                              if (target.closest(".mv-scene-reorder-handle")) {
                                e.preventDefault();
                                setReorderDrag({ fromIndex: idx });
                                const onMove = (me: MouseEvent) => {
                                  const els = document.querySelectorAll(".mv-scene-item");
                                  let closestIdx = idx;
                                  let closestDist = Infinity;
                                  els.forEach((el, i) => {
                                    const rect = el.getBoundingClientRect();
                                    const cy = rect.top + rect.height / 2;
                                    const d = Math.abs(me.clientY - cy);
                                    if (d < closestDist) { closestDist = d; closestIdx = i; }
                                  });
                                  setReorderOverIndex(closestIdx);
                                };
                                const onUp = () => {
                                  window.removeEventListener("mousemove", onMove);
                                  window.removeEventListener("mouseup", onUp);
                                  setReorderDrag(null);
                                  setReorderOverIndex((overIdx) => {
                                    if (overIdx !== null && overIdx !== idx) {
                                      setScenes((prev) => {
                                        const next = [...prev];
                                        const [moved] = next.splice(idx, 1);
                                        next.splice(overIdx, 0, moved);
                                        return next;
                                      });
                                    }
                                    return null;
                                  });
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                                return;
                              }
                              // Canvas drag (default for the scene body)
                              e.preventDefault();
                              startSceneDrag({ sceneName: scene.sceneName, sceneIndex: scene.sceneIndex }, e.clientX, e.clientY);
                            }}
                            onContextMenu={(e) => handleSceneContextMenu(e, scene)}
                            title={isLive ? `🔴 LIVE — ${scene.sceneName}` : "Drag onto a slot, or right-click for options"}
                          >
                            {/* Checkbox — its own click handler, stopPropagation */}
                            <span
                              className={`mv-scene-select-cb ${selectedScenes.has(scene.sceneName) ? "mv-scene-select-cb--checked" : ""}`}
                              style={{ cursor: "pointer", flexShrink: 0, opacity: selectedScenes.size > 0 ? 1 : (isLive ? 0.15 : 0.3) }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isLive) {
                                  setLiveSceneWarning(true);
                                  setTimeout(() => setLiveSceneWarning(false), 3000);
                                  return;
                                }
                                setSelectedScenes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(scene.sceneName)) next.delete(scene.sceneName); else next.add(scene.sceneName);
                                  return next;
                                });
                              }}
                            >
                              <Icon name={isLive ? "block" : selectedScenes.has(scene.sceneName) ? "check_box" : "check_box_outline_blank"} size={16} />
                            </span>
                            {isLive && (
                              <span className="mv-scene-live-badge" title="Currently live on Program output">
                                <span className="mv-scene-live-dot" />
                                LIVE
                              </span>
                            )}
                            <div className="mv-scene-thumb">
                              {scene.thumbnail ? (
                                <img src={scene.thumbnail} alt={scene.sceneName} draggable={false} />
                              ) : (
                                <Icon name="slideshow" size={20} />
                              )}
                            </div>
                            <span className="mv-scene-name">{scene.sceneName}</span>
                            <Icon name="drag_indicator" size={20} className="mv-scene-reorder-handle" />
                          </div>
                        );
                      });
                    })()}
                  </div>
                </>
              )}
            </div>

            {/* ── Background (compact row + Change button) ── */}
            <div className="mv-panel-section">
              <h3 className="mv-panel-heading">Background</h3>
              <div className="mv-bg-compact-row">
                <div className="mv-bg-preview-swatch">
                  {background?.type === "image" && background.imageSrc ? (
                    <img className="mv-bg-swatch-img" src={background.imageSrc} alt="bg" />
                  ) : background?.type === "video" && background.videoSrc ? (
                    <video
                      className="mv-bg-swatch-video-thumb"
                      src={background.videoSrc}
                      autoPlay loop muted playsInline
                    />
                  ) : (
                    <div className="mv-bg-swatch-color" style={{ background: background?.color ?? "#0a0a14" }} />
                  )}
                </div>
                <div className="mv-bg-compact-info">
                  <span className="mv-bg-compact-label">{bgLabel}</span>
                  <span className="mv-bg-compact-meta">
                    {background?.type === "color" ? (background.color ?? "#0a0a14") : bgLabel}
                  </span>
                </div>
                <button className="mv-btn mv-btn--sm mv-btn--outline mv-bg-change-btn" onClick={() => setShowBgModal(true)} title="Change">
                  Change
                </button>
              </div>
            </div>

            {/* ── Slots ── */}
            <div className="mv-panel-section mv-panel-section--grow">
              <h3 className="mv-panel-heading">
                Slots
                <span className="mv-panel-badge">{regions.length}</span>
              </h3>
              <div className="mv-slots-list">
                {[...regions].reverse().map((region) => {
                  const isSelected = state.selectedRegionIds.includes(region.id);
                  const isExpanded = expandedSlots.has(region.id);
                  const hasScene = region.type === "obs-scene" && !!(region as OBSSceneRegion).sceneName;
                  const assignedScene = hasScene ? (region as OBSSceneRegion).sceneName : null;
                  const isBible = !!(region.name?.startsWith("Bible:") && region.themeSettings);
                  const isWorship = !!(region.name?.startsWith("Worship:") && region.themeSettings);
                  const isLT = !!(region.name?.startsWith("LT:") && region.themeId);
                  const isThemed = isBible || isWorship || isLT;
                  // Truly empty: obs-scene with no sceneName AND not themed
                  const isEmpty = region.type === "obs-scene" && !(region as OBSSceneRegion).sceneName && !isThemed;
                  // Can this slot accept a scene drop?
                  const canDrop = isDragging && dragPayload && region.type === "obs-scene";
                  // Slot icon: use Bible/Worship/LT icon if themed
                  const slotIcon = isBible ? "menu_book" : isWorship ? "music_note" : isLT ? "subtitles" : regionTypeIcon(region.type);
                  return (
                    <div key={region.id} className="mv-slot-dropdown">
                      <div
                        className={`mv-slot-item ${isSelected ? "mv-slot-item--selected" : ""} ${region.locked ? "mv-slot-item--locked" : ""} ${!region.visible ? "mv-slot-item--hidden" : ""} ${canDrop ? "mv-slot-item--drop-target" : ""}`}
                        onClick={(e) => handleSlotClick(region, e)}
                        onMouseUp={() => {
                          // If we're dragging a scene and mouse-up on this slot, assign it
                          if (canDrop && dragPayload) {
                            assignSceneToRegion(region.id, dragPayload.sceneName, dragPayload.sceneIndex);
                          }
                        }}
                      >
                        <button
                          className="mv-slot-expand-btn"
                          onClick={(e) => { e.stopPropagation(); toggleSlot(region.id); }}
                          title={isExpanded ? "Collapse" : "Expand"}
                        >
                          <Icon name="chevron_right" size={16} style={{ transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }} />
                        </button>
                        <Icon name={slotIcon} size={20} className="mv-slot-icon" />
                        <span className="mv-slot-name">
                          {region.name || region.slotLabel || regionTypeLabel(region.type)}
                        </span>
                        {(hasScene || isThemed) && (
                          <span className="mv-slot-scene-badge" title={isThemed ? `Theme: ${region.name}` : `Assigned: ${assignedScene}`}>●</span>
                        )}
                        {region.constraints?.lockDelete && (
                          <span className="mv-slot-badge" title="Protected by template"><Icon name="lock" size={14} style={{ verticalAlign: "middle" }} /></span>
                        )}
                        <div className="mv-slot-actions">
                          <button className="mv-slot-action" title={region.visible ? "Hide" : "Show"}
                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_VISIBILITY", regionId: region.id }); }}>
                            <Icon name={region.visible ? "visibility" : "visibility_off"} size={20} />
                          </button>
                          <button className="mv-slot-action" title={region.locked ? "Unlock" : "Lock"}
                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_LOCK", regionId: region.id }); }}>
                            <Icon name={region.locked ? "lock" : "lock_open"} size={20} />
                          </button>
                        </div>
                      </div>
                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="mv-slot-content">
                          {hasScene ? (
                            <div className="mv-slot-scene-info">
                              <Icon name="videocam" size={14} style={{ color: "var(--primary)" }} />
                              <span className="mv-slot-scene-name">{assignedScene}</span>
                            </div>
                          ) : isThemed ? (
                            <div className="mv-slot-scene-info">
                              <Icon name={isBible ? "menu_book" : isWorship ? "music_note" : "subtitles"} size={14} style={{ color: isBible ? "#d4af37" : isWorship ? "#af52de" : "#00E676" }} />
                              <span className="mv-slot-scene-name">{region.name}</span>
                            </div>
                          ) : isEmpty ? (
                            <div
                              className="mv-slot-scene-empty mv-slot-scene-empty--clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setSlotPopover({ regionId: region.id, x: rect.right + 4, y: rect.top });
                              }}
                            >
                              <Icon name="add_circle_outline" size={14} style={{ opacity: 0.4 }} />
                              <span>Drop scene here or click to add new source</span>
                            </div>
                          ) : (
                            <div className="mv-slot-scene-empty">
                              <Icon name="add_circle_outline" size={14} style={{ opacity: 0.3 }} />
                              <span>No source assigned — drag one here</span>
                            </div>
                          )}
                          <div className="mv-slot-meta">
                            <span>{region.width}×{region.height}</span>
                            <span>({region.x}, {region.y})</span>
                            {region.opacity < 1 && <span>{Math.round(region.opacity * 100)}%</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {regions.length === 0 && (
                  <div className="mv-slots-empty">
                    <Icon name="grid_view" size={24} style={{ opacity: 0.3 }} />
                    <p>No regions yet. Add a scene above.</p>
                  </div>
                )}
              </div>
            </div>
          </> /* end main tab */
        )}

        {/* ════════════════════════════════════════════════════════
         TAB 2: TEMPLATES — Search + Templates + Past Layouts + Media
         ════════════════════════════════════════════════════════ */}
        {activeTab === "templates" && (() => {
          const q = tplSearch.toLowerCase().trim();

          // Filter templates
          const filteredTemplates = q
            ? TEMPLATE_LIBRARY.filter((t) =>
              t.name.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q) ||
              t.tags.some((tag) => tag.toLowerCase().includes(q))
            )
            : TEMPLATE_LIBRARY;

          // Filter past layouts
          const filteredLayouts = q
            ? pastLayouts.filter((l) =>
              l.name.toLowerCase().includes(q) ||
              l.description?.toLowerCase().includes(q) ||
              l.tags?.some((tag) => tag.toLowerCase().includes(q))
            )
            : pastLayouts;

          const fmtDate = (ts: string) => {
            const d = new Date(ts);
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          };

          /** Region type → fill color for SVG preview */
          const regionColor = (type: string): string => {
            switch (type) {
              case "obs-scene": return "#3B82F6";
              case "video-input": return "#0078d4";
              case "image-overlay": return "#00bcd4";
              case "media": return "#9c27b0";
              case "browser": return "#ff5722";
              case "color": return "#78909c";
              default: return "#666";
            }
          };

          return (
            <div className="mv-tpl-tab">
              {/* Search bar */}
              <div className="mv-tpl-search-wrap">
                <Icon name="search" size={20} className="mv-tpl-search-icon" />
                <input
                  className="mv-tpl-search"
                  type="text"
                  placeholder="Search templates, layouts…"
                  value={tplSearch}
                  onChange={(e) => setTplSearch(e.target.value)}
                  aria-label="Search templates and layouts"
                />
                {tplSearch && (
                  <button
                    type="button"
                    className="mv-tpl-search-clear"
                    onClick={() => setTplSearch("")}
                    aria-label="Clear template search"
                    title="Clear template search"
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>

              {/* Sub-tabs: Templates | Past Layouts */}
              <div className="mv-tpl-sub-tabs">
                <button className={`mv-tpl-sub-tab ${tplSubTab === "templates" ? "mv-tpl-sub-tab--active" : ""}`}
                  onClick={() => setTplSubTab("templates")} title="Templates )`">
                  Templates{filteredTemplates.length > 0 && ` (${filteredTemplates.length})`}
                </button>
                <button className={`mv-tpl-sub-tab ${tplSubTab === "layouts" ? "mv-tpl-sub-tab--active" : ""}`}
                  onClick={() => setTplSubTab("layouts")} title="My Layouts )`">
                  My Layouts{filteredLayouts.length > 0 && ` (${filteredLayouts.length})`}
                </button>
              </div>

              {/* ── Sub-tab: Templates ── */}
              {tplSubTab === "templates" && (
                <div className="mv-tpl-section">
                  {filteredTemplates.length === 0 ? (
                    <div className="mv-tpl-empty">
                      <Icon name="search_off" size={32} style={{ opacity: 0.2 }} />
                      <p>No templates match "{tplSearch}"</p>
                    </div>
                  ) : (
                    <div className="mv-tpl-list">
                      {filteredTemplates.map((tpl) => (
                        <button key={tpl.id} className="mv-tpl-list-item"
                          onClick={() => {
                            requestTemplateApply({
                              regions: tpl.regions,
                              canvas: tpl.canvas,
                              background: tpl.background,
                              safeFrame: tpl.safeFrame,
                              fromTemplateId: tpl.id,
                              name: tpl.name,
                              icon: tpl.icon,
                            });
                          }} title="slots">
                          <Icon name={tpl.icon} size={20} className="mv-tpl-list-item-icon" />
                          <div className="mv-tpl-list-item-info">
                            <span className="mv-tpl-list-item-name">{tpl.name}</span>
                            <span className="mv-tpl-list-item-desc">{tpl.description}</span>
                          </div>
                          <span className="mv-tpl-list-item-badge">{tpl.regions.length} slots</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Sub-tab: Past Layouts ── */}
              {tplSubTab === "layouts" && (
                <div className="mv-tpl-section">
                  {filteredLayouts.length === 0 ? (
                    <div className="mv-tpl-empty">
                      <Icon name={q ? "search_off" : "history"} size={32} style={{ opacity: 0.2 }} />
                      <p>{q ? `No layouts match "${tplSearch}"` : "No saved layouts yet. Create one from the dashboard."}</p>
                    </div>
                  ) : (
                    <div className="mv-tpl-list">
                      {filteredLayouts.map((layout) => (
                        <button key={layout.id} className="mv-tpl-list-item"
                          title={`Apply "${layout.name}" — ${layout.regions.length} slots. Last edited ${fmtDate(layout.updatedAt)}`}
                          onClick={() => {
                            requestTemplateApply({
                              regions: layout.regions,
                              canvas: layout.canvas,
                              background: layout.background,
                              safeFrame: layout.safeFrame,
                              fromTemplateId: layout.fromTemplateId,
                              name: layout.name,
                            });
                          }}>
                          {/* Mini SVG preview */}
                          <div className="mv-tpl-layout-thumb">
                            <svg viewBox={`0 0 ${layout.canvas.width} ${layout.canvas.height}`} width="48" height="27">
                              <rect width={layout.canvas.width} height={layout.canvas.height} fill={layout.background?.color ?? "#0a0a14"} rx="4" />
                              {layout.regions.map((r) => (
                                <rect key={r.id} x={r.x} y={r.y} width={r.width} height={r.height}
                                  fill={regionColor(r.type)} opacity={0.6} rx="2" />
                              ))}
                            </svg>
                          </div>
                          <div className="mv-tpl-list-item-info">
                            <span className="mv-tpl-list-item-name">{layout.name}</span>
                            <span className="mv-tpl-list-item-desc">{fmtDate(layout.updatedAt)} · {layout.regions.length} layers</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ════════════════════════════════════════════════════════
         TAB 3: LOGOS — Logo upload & edit per corner
         ════════════════════════════════════════════════════════ */}
        {activeTab === "logos" && (
          <div className="mv-panel-section" style={{ padding: 8 }}>
            <h3 className="mv-panel-heading">
              Logos
              {logoRegions.length > 0 && <span className="mv-panel-badge">{logoRegions.length}</span>}
            </h3>
            {logoRegions.length > 0 ? (
              <div className="mv-logo-grid" style={{ display: "grid", gridTemplateColumns: logoRegions.length <= 2 ? "1fr" : "1fr 1fr", gap: 8 }}>
                {logoRegions.map((lr) => {
                  const lrSrc = (lr as any).src as string | undefined;
                  const posLabel = lr.name || lr.slotLabel || "Logo";
                  return (
                    <div key={lr.id} className={`mv-logo-slot ${editingLogoId === lr.id ? "mv-logo-slot--editing" : ""}`}>
                      <div
                        className="mv-logo-slot-preview"
                        onClick={() => {
                          setUploadTargetLogoId(lr.id);
                          logoFileInputRef.current?.click();
                        }}
                        title={lrSrc ? "Click to replace" : "Click to upload"}
                      >
                        {lrSrc ? (
                          <img src={lrSrc} alt={posLabel} style={{ objectFit: (lr as any).objectFit || "cover" }} />
                        ) : (
                          <Icon name="add_photo_alternate" size={28} style={{ opacity: 0.25 }} />
                        )}
                      </div>
                      <div className="mv-logo-slot-info">
                        <span className="mv-logo-slot-name" title={posLabel}>{posLabel}</span>
                        <button
                          className="mv-logo-slot-edit-btn"
                          title="Edit logo"
                          onClick={() => setEditingLogoId(editingLogoId === lr.id ? null : lr.id)}
                        >
                          <Icon name={editingLogoId === lr.id ? "expand_less" : "tune"} size={14} />
                        </button>
                      </div>
                      {/* Inline edit controls */}
                      {editingLogoId === lr.id && (
                        <div className="mv-logo-edit-panel">
                          {/* Width × Height */}
                          <div className="mv-logo-edit-row">
                            <label className="mv-field-label">Size</label>
                            <input type="number" className="mv-field-input mv-field-input--sm" value={lr.width}
                              onChange={(e) => updateRegion(lr.id, { width: Math.max(20, Number(e.target.value)) })} style={{ width: 60 }} />
                            <span style={{ opacity: 0.4 }}>×</span>
                            <input type="number" className="mv-field-input mv-field-input--sm" value={lr.height}
                              onChange={(e) => updateRegion(lr.id, { height: Math.max(20, Number(e.target.value)) })} style={{ width: 60 }} />
                          </div>
                          {/* Object fit */}
                          <div className="mv-logo-edit-row">
                            <label className="mv-field-label">Fit</label>
                            <div className="mv-logo-fit-btns">
                              {(["contain", "cover", "fill"] as const).map((fit) => (
                                <button key={fit}
                                  className={`mv-logo-fit-btn ${(lr as any).objectFit === fit ? "mv-logo-fit-btn--active" : ""}`}
                                  onClick={() => updateRegion(lr.id, { objectFit: fit } as Partial<Region>)}
                                  title={fit}
                                >{fit}</button>
                              ))}
                            </div>
                          </div>
                          {/* Opacity */}
                          <div className="mv-logo-edit-row">
                            <label className="mv-field-label">Opacity</label>
                            <input type="range" min={0} max={100} value={Math.round(lr.opacity * 100)}
                              onChange={(e) => updateRegion(lr.id, { opacity: Number(e.target.value) / 100 })}
                              style={{ flex: 1 }} />
                            <span style={{ fontSize: 11, opacity: 0.5, minWidth: 28, textAlign: "right" }}>{Math.round(lr.opacity * 100)}%</span>
                          </div>
                          {/* Replace / Remove */}
                          <div className="mv-logo-edit-row" style={{ justifyContent: "flex-end", gap: 4 }}>
                            <button className="mv-btn mv-btn--sm mv-btn--outline"
                              onClick={() => { setUploadTargetLogoId(lr.id); logoFileInputRef.current?.click(); }} title="Replace">
                              <Icon name="upload_file" size={14} /> Replace
                            </button>
                            {lrSrc && (
                              <button className="mv-btn mv-btn--sm mv-btn--ghost"
                                onClick={() => updateRegion(lr.id, { src: "", filePath: undefined } as Partial<Region>)} title="Delete">
                                <Icon name="delete" size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 24 }}>
                <Icon name="branding_watermark" size={40} style={{ opacity: 0.2 }} />
                <p style={{ marginTop: 8, color: "var(--text-muted, #888)", fontSize: 12 }}>
                  No logo regions in this layout. Choose a logo overlay template from the Templates tab.
                </p>
                <button className="mv-btn mv-btn--sm mv-btn--outline" onClick={() => setActiveTab("templates")} title="Browse">
                  <Icon name="grid_view" size={14} /> Browse Templates
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
         TAB 4: MEDIA — Uploaded images & videos library
         ════════════════════════════════════════════════════════ */}
        {activeTab === "media" && (() => {
          const mq = mediaSearch.toLowerCase().trim();
          const filteredMedia = (mq
            ? mediaItems.filter((m) =>
              m.name.toLowerCase().includes(mq) ||
              m.tags?.some((tag) => tag.toLowerCase().includes(mq))
            )
            : mediaItems
          ).filter((m) => mediaFilter === "all" || m.mediaType === mediaFilter);

          const fmtDate = (ts: string) => {
            const d = new Date(ts);
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          };

          return (
            <div className="mv-tpl-tab">
              {/* Search bar */}
              <div className="mv-tpl-search-wrap">
                <Icon name="search" size={20} className="mv-tpl-search-icon" />
                <input
                  className="mv-tpl-search"
                  type="text"
                  placeholder="Search media…"
                  value={mediaSearch}
                  onChange={(e) => setMediaSearch(e.target.value)}
                  aria-label="Search media"
                />
                {mediaSearch && (
                  <button
                    type="button"
                    className="mv-tpl-search-clear"
                    onClick={() => setMediaSearch("")}
                    aria-label="Clear media search"
                    title="Clear media search"
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>

              {/* Media type filter chips */}
              <div className="mv-tpl-media-filters">
                {(["all", "image", "video"] as const).map((f) => (
                  <button key={f} className={`mv-tpl-media-chip ${mediaFilter === f ? "mv-tpl-media-chip--active" : ""}`}
                    onClick={() => setMediaFilter(f)}>
                    {f === "all" ? `All (${mediaItems.length})` : f === "image" ? `Images (${mediaItems.filter((m) => m.mediaType === "image").length})` : `Videos (${mediaItems.filter((m) => m.mediaType === "video").length})`}
                  </button>
                ))}
              </div>

              <div className="mv-tpl-section">
                {filteredMedia.length === 0 ? (
                  <div className="mv-tpl-empty">
                    <Icon name={mq ? "search_off" : "perm_media"} size={32} style={{ opacity: 0.2 }} />
                    <p>{mq ? `No media match "${mediaSearch}"` : "No uploaded media yet. Upload backgrounds or logos to build your library."}</p>
                  </div>
                ) : (
                  <div className="mv-tpl-media-grid">
                    {filteredMedia.map((item) => (
                      <div key={item.id} className="mv-tpl-media-card"
                        title={`${item.name}\n${item.mediaType} · ${(item.size / 1024).toFixed(0)} KB\n${fmtDate(item.createdAt)}\nClick to use as background`}
                        onClick={() => {
                          dispatch({ type: "SNAPSHOT" });
                          if (item.mediaType === "image") {
                            setBackground({ type: "image", imageSrc: item.previewSrc, filePath: item.filePath });
                          } else {
                            setBackground({ type: "video", videoSrc: item.previewSrc, loop: true, filePath: item.filePath });
                          }
                        }}>
                        <div className="mv-tpl-media-card-thumb">
                          {item.mediaType === "image" ? (
                            <img src={item.previewSrc} alt={item.name} />
                          ) : (
                            <video src={item.previewSrc} muted playsInline preload="metadata" />
                          )}
                          <span className="mv-tpl-media-type-badge">
                            <Icon name={item.mediaType === "image" ? "image" : "videocam"} size={12} />
                          </span>
                        </div>
                        <span className="mv-tpl-media-card-name">{item.name}</span>
                        <button className="mv-tpl-media-card-delete"
                          title="Remove from library"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await db.deleteMediaItem(item.id);
                            setMediaItems((prev) => prev.filter((m) => m.id !== item.id));
                          }}>
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      </div>{/* end mv-sidebar-tab-content */}

      {/* ── Scene Context Menu (right-click on OBS scene) ── */}
      {sceneCtx && (
        <div className="mv-context-menu" style={{ left: sceneCtx.x, top: sceneCtx.y }}
          onClick={(e) => e.stopPropagation()}>
          {obsSceneSlots.length > 0 ? (
            obsSceneSlots.map((layer) => {
              const layerScene = (layer as OBSSceneRegion).sceneName;
              const layerLabel = layer.name || layer.slotLabel || regionTypeLabel(layer.type);
              const isOccupied = !!layerScene;
              const isSameScene = layerScene === sceneCtx.sceneName;
              return (
                <button key={layer.id} className="mv-context-menu-item"
                  disabled={isSameScene}
                  title={isSameScene ? `"${sceneCtx.sceneName}" is already in this slot` : undefined}
                  onClick={() => { if (isSameScene) return; setSceneCtx(null); assignSceneToRegion(layer.id, sceneCtx.sceneName, sceneCtx.sceneIndex); }}>
                  <Icon name={isSameScene ? "check_circle" : isOccupied ? "swap_horiz" : "add_circle"} size={20} />
                  {isSameScene ? `${layerLabel} — already assigned` : isOccupied ? `Substitute ${layerLabel} (${layerScene})` : `Add to ${layerLabel}`}
                </button>
              );
            })
          ) : (
            <div className="mv-context-menu-item" style={{ opacity: 0.5, cursor: "default" }}>
              <Icon name="info" size={20} />
              No layers available
            </div>
          )}
        </div>
      )}

      {/* ── Layer Popover (click-to-add on empty slots — 3-tab: Scenes / Bible / Worship) ── */}
      {slotPopover && (
        <div className="mv-popover mv-popover--wide" style={{ left: slotPopover.x, top: slotPopover.y }}
          onClick={(e) => e.stopPropagation()}>
          <div className="mv-popover-header">
            <Icon name="playlist_add" size={14} />
            <span>Assign to Slot</span>
            <button className="mv-popover-close" onClick={() => setSlotPopover(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2 }} title="Close">
              <Icon name="close" size={14} style={{ color: "var(--text-muted)" }} />
            </button>
          </div>
          {/* Tabs */}
          <div className="mv-popover-tabs">
            <button className={`mv-popover-tab ${slotPopoverTab === "scenes" ? "mv-popover-tab--active" : ""}`}
              onClick={() => setSlotPopoverTab("scenes")} title="Scenes">
              <Icon name="videocam" size={13} /> Scenes
            </button>
            <button className={`mv-popover-tab ${slotPopoverTab === "bible" ? "mv-popover-tab--active" : ""}`}
              onClick={() => setSlotPopoverTab("bible")} title="Book">
              <Icon name="menu_book" size={13} /> Bible
            </button>
            <button className={`mv-popover-tab ${slotPopoverTab === "worship" ? "mv-popover-tab--active" : ""}`}
              onClick={() => setSlotPopoverTab("worship")} title="Music">
              <Icon name="music_note" size={13} /> Worship
            </button>
          </div>

          {/* Tab: Scenes */}
          {slotPopoverTab === "scenes" && (
            obsConnected && scenes.length > 0 ? (
              <div className="mv-popover-list">
                {scenes.map((scene) => (
                  <button key={scene.sceneName} className="mv-popover-item"
                    onClick={() => {
                      assignSceneToRegion(slotPopover.regionId, scene.sceneName, scene.sceneIndex);
                      setSlotPopover(null);
                    }} title="videocam">
                    <Icon name="videocam" size={14} />
                    <span>{scene.sceneName}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mv-popover-empty">
                <Icon name="link_off" size={16} style={{ opacity: 0.3 }} />
                <span>{obsConnected ? "No scenes found" : "Connect to OBS first"}</span>
              </div>
            )
          )}

          {/* Tab: Bible Themes */}
          {slotPopoverTab === "bible" && (
            <div className="mv-popover-list">
              {BUILTIN_THEMES.filter((t) => t.source === "builtin").map((theme) => (
                <button key={theme.id} className="mv-popover-item"
                  onClick={() => {
                    updateRegion(slotPopover.regionId, {
                      name: `Bible: ${theme.name}`,
                      themeId: theme.id,
                      themeSettings: { ...theme.settings },
                      fontOverrides: undefined,
                    } as any);
                    setSlotPopover(null);
                  }} title="Aa">
                  <span style={{ width: 20, height: 20, borderRadius: 4, background: theme.settings.backgroundColor, color: theme.settings.fontColor, fontSize: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>Aa</span>
                  <span>{theme.name}</span>
                </button>
              ))}
              {customBibleThemes.length > 0 && (
                <>
                  <div style={{ padding: "6px 10px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>Custom</div>
                  {customBibleThemes.map((theme) => (
                    <button key={theme.id} className="mv-popover-item"
                      onClick={() => {
                        updateRegion(slotPopover.regionId, {
                          name: `Bible: ${theme.name}`,
                          themeId: theme.id,
                          themeSettings: { ...theme.settings },
                          fontOverrides: undefined,
                        } as any);
                        setSlotPopover(null);
                      }} title="Aa">
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: theme.settings.backgroundColor, color: theme.settings.fontColor, fontSize: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>Aa</span>
                      <span>{theme.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Tab: Worship Themes */}
          {slotPopoverTab === "worship" && (
            <div className="mv-popover-list">
              {WORSHIP_THEMES.map((theme) => (
                <button key={theme.id} className="mv-popover-item"
                  onClick={() => {
                    updateRegion(slotPopover.regionId, {
                      name: `Worship: ${theme.name}`,
                      themeId: theme.id,
                      themeSettings: { ...theme.settings },
                      fontOverrides: undefined,
                    } as any);
                    setSlotPopover(null);
                  }} title="Aa">
                  <span style={{ width: 20, height: 20, borderRadius: 4, background: theme.settings.backgroundColor, color: theme.settings.fontColor, fontSize: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>Aa</span>
                  <span>{theme.name}</span>
                </button>
              ))}
            </div>
          )}

        </div>
      )}

      {/* ── Background Modal ── */}
      {showBgModal && (
        <div className="mv-modal-backdrop" onClick={() => setShowBgModal(false)}>
          <div className="mv-modal mv-modal--lg" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-header-row">
              <div className="mv-modal-header-left">
                <Icon name="wallpaper" size={24} style={{ color: "var(--primary)" }} />
                <h3 className="mv-modal-title" style={{ margin: 0 }}>Background Selector</h3>
              </div>
              <button className="mv-modal-close" onClick={() => setShowBgModal(false)} title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <nav className="mv-modal-tabs">
              <button className={`mv-modal-tab ${bgModalTab === "upload" ? "mv-modal-tab--active" : ""}`}
                onClick={() => setBgModalTab("upload")} title="Upload">Upload</button>
              <button className={`mv-modal-tab ${bgModalTab === "color" ? "mv-modal-tab--active" : ""}`}
                onClick={() => setBgModalTab("color")} title="Color">Color</button>
              <button className={`mv-modal-tab ${bgModalTab === "library" ? "mv-modal-tab--active" : ""}`}
                onClick={() => setBgModalTab("library")} title="Library">Library</button>
            </nav>

            <div className="mv-modal-body">
              {bgModalTab === "upload" && (
                <div className="mv-bg-upload-tab">
                  <div className="mv-bg-upload-grid">
                    <div className="mv-bg-upload-card" onClick={() => bgImageInputRef.current?.click()}>
                      <Icon name="image" size={20} />
                      <span className="mv-bg-upload-card-title">Upload Image</span>
                      <span className="mv-bg-upload-card-desc">JPG, PNG, WebP</span>
                    </div>
                    <div className="mv-bg-upload-card" onClick={() => bgVideoInputRef.current?.click()}>
                      <Icon name="videocam" size={20} />
                      <span className="mv-bg-upload-card-title">Upload Video</span>
                      <span className="mv-bg-upload-card-desc">MP4, WebM, MOV</span>
                    </div>
                  </div>
                  {background && background.type !== "color" && (
                    <div className="mv-bg-current-preview">
                      <span className="mv-field-label">Current Background</span>
                      <div className="mv-bg-current-thumb">
                        {background.type === "image" && background.imageSrc && (
                          <img src={background.imageSrc} alt="Current BG" />
                        )}
                        {background.type === "video" && background.videoSrc && (
                          <video
                            src={background.videoSrc}
                            autoPlay
                            loop
                            muted
                            playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {bgModalTab === "color" && (
                <div className="mv-bg-color-tab">
                  <div className="mv-bg-color-picker-row">
                    <label className="mv-field-label">Pick a Color</label>
                    <input type="color" className="mv-bg-color-picker-lg"
                      value={background?.color ?? "#0a0a14"}
                      onChange={(e) => setBackground({ type: "color", color: e.target.value })} />
                    <span className="mv-bg-color-hex">{background?.color ?? "#0a0a14"}</span>
                  </div>
                  <div className="mv-bg-swatches">
                    {["#0a0a14", "#0F172A", "#16213e", "#0f3460", "#533483", "#2c3e50", "#1b1b2f", "#2d132c", "#0d0d0d", "#141e30", "#243b55", "#2c2c54"].map((c) => (
                      <button key={c} className="mv-bg-swatch-btn" style={{ background: c }} title={c}
                        onClick={() => setBackground({ type: "color", color: c })} />
                    ))}
                  </div>
                </div>
              )}

              {bgModalTab === "library" && (
                <div className="mv-bg-library">
                  <div className="mv-bg-library-filters">
                    <button className="mv-bg-filter-chip mv-bg-filter-chip--active" title="All">All</button>
                    <button className="mv-bg-filter-chip" title="Abstract">Abstract</button>
                    <button className="mv-bg-filter-chip" title="Texture">Texture</button>
                    <button className="mv-bg-filter-chip" title="Worship">Worship</button>
                    <button className="mv-bg-filter-chip" title="Nature">Nature</button>
                  </div>
                  <div className="mv-bg-library-empty">
                    <Icon name="photo_library" size={40} style={{ opacity: 0.2 }} />
                    <p>No library assets yet. Upload your own backgrounds from the Upload tab.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mv-modal-footer">
              <div className="mv-modal-footer-info">
                Current: <strong>{bgLabel}</strong>
              </div>
              <div className="mv-modal-actions">
                <button className="mv-btn mv-btn--ghost" onClick={() => setShowBgModal(false)} title="Cancel">Cancel</button>
                <button className="mv-btn mv-btn--primary" onClick={() => setShowBgModal(false)} title="Done">
                  <Icon name="check" size={16} />
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Logo Modal (multi-logo) ── */}
      {showLogoModal && (
        <div className="mv-modal-backdrop" onClick={() => setShowLogoModal(false)}>
          <div className="mv-modal mv-modal--lg" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-header-row">
              <div className="mv-modal-header-left">
                <Icon name="add_photo_alternate" size={24} style={{ color: "var(--primary)" }} />
                <h3 className="mv-modal-title" style={{ margin: 0 }}>Logo Overlays{logoRegions.length > 0 ? ` (${logoRegions.length})` : ""}</h3>
              </div>
              <button className="mv-modal-close" onClick={() => setShowLogoModal(false)} title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="mv-modal-body">
              {logoRegions.length > 0 ? (
                <div className="mv-logo-modal-grid" style={{
                  display: "grid",
                  gridTemplateColumns: logoRegions.length === 1 ? "1fr" : logoRegions.length <= 4 ? "1fr 1fr" : "1fr 1fr 1fr",
                  gap: 16,
                }}>
                  {logoRegions.map((lr) => {
                    const lrSrc = (lr as any).src as string | undefined;
                    const posLabel = lr.name || lr.slotLabel || "Logo";
                    return (
                      <div key={lr.id} className="mv-logo-modal-card">
                        <div className="mv-logo-modal-card-preview"
                          onClick={() => { setUploadTargetLogoId(lr.id); logoFileInputRef.current?.click(); }}>
                          {lrSrc ? (
                            <img src={lrSrc} alt={posLabel} style={{ objectFit: (lr as any).objectFit || "cover" }} />
                          ) : (
                            <div className="mv-logo-modal-card-empty">
                              <Icon name="add_photo_alternate" size={20} />
                              <span>Upload Image</span>
                            </div>
                          )}
                        </div>
                        <div className="mv-logo-modal-card-body">
                          <strong>{posLabel}</strong>
                          <span className="mv-logo-modal-card-meta">{lr.width}×{lr.height} · pos ({lr.x}, {lr.y})</span>
                          {/* Edit controls */}
                          <div className="mv-logo-modal-controls">
                            <div className="mv-logo-edit-row">
                              <label className="mv-field-label">Size</label>
                              <input type="number" className="mv-field-input mv-field-input--sm" value={lr.width}
                                onChange={(e) => updateRegion(lr.id, { width: Math.max(20, Number(e.target.value)) })} style={{ width: 60 }} />
                              <span style={{ opacity: 0.4 }}>×</span>
                              <input type="number" className="mv-field-input mv-field-input--sm" value={lr.height}
                                onChange={(e) => updateRegion(lr.id, { height: Math.max(20, Number(e.target.value)) })} style={{ width: 60 }} />
                            </div>
                            <div className="mv-logo-edit-row">
                              <label className="mv-field-label">Fit</label>
                              <div className="mv-logo-fit-btns">
                                {(["contain", "cover", "fill"] as const).map((fit) => (
                                  <button key={fit}
                                    className={`mv-logo-fit-btn ${(lr as any).objectFit === fit ? "mv-logo-fit-btn--active" : ""}`}
                                    onClick={() => updateRegion(lr.id, { objectFit: fit } as Partial<Region>)}>{fit}</button>
                                ))}
                              </div>
                            </div>
                            <div className="mv-logo-edit-row">
                              <label className="mv-field-label">Opacity</label>
                              <input type="range" min={0} max={100} value={Math.round(lr.opacity * 100)}
                                onChange={(e) => updateRegion(lr.id, { opacity: Number(e.target.value) / 100 })}
                                style={{ flex: 1 }} />
                              <span style={{ fontSize: 11, opacity: 0.5 }}>{Math.round(lr.opacity * 100)}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <Icon name="photo_library" size={48} style={{ opacity: 0.2 }} />
                  <p style={{ marginTop: 12, color: "var(--text-muted)" }}>No logo regions in this layout. Use a logo overlay template to get started.</p>
                  <div className="mv-bg-upload-card" onClick={() => { setUploadTargetLogoId(null); logoFileInputRef.current?.click(); }} style={{ margin: "16px auto 0", maxWidth: 260 }}>
                    <Icon name="upload_file" size={20} />
                    <span className="mv-bg-upload-card-title">Upload Logo Image</span>
                    <span className="mv-bg-upload-card-desc">PNG recommended (transparent)</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mv-modal-footer">
              <div className="mv-modal-footer-info">
                {logoRegions.length} logo region{logoRegions.length !== 1 ? "s" : ""}
              </div>
              <div className="mv-modal-actions">
                <button className="mv-btn mv-btn--ghost" onClick={() => setShowLogoModal(false)} title="Close">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── OBS Scene Delete Confirmation Modal ── */}
      {showSceneDeleteModal && selectedScenes.size > 0 && (() => {
        // Never allow deleting the live/program scene
        const safeToDelete = new Set([...selectedScenes].filter((name) => name !== programScene));
        const liveSceneBlocked = selectedScenes.has(programScene);
        const nonLiveSceneCount = scenes.filter((s) => s.sceneName !== programScene).length;
        const isDeletingAllNonLive = safeToDelete.size >= nonLiveSceneCount && nonLiveSceneCount > 0;

        return (
          <div className="mv-modal-backdrop" onClick={() => setShowSceneDeleteModal(false)}>
            <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
              <div className="mv-modal-icon"><Icon name="warning" size={20} style={{ color: "#ef4444" }} /></div>
              <h3 className="mv-modal-title">Delete {safeToDelete.size} OBS Scene{safeToDelete.size !== 1 ? "s" : ""}?</h3>

              {safeToDelete.size === 0 ? (
                <>
                  <p className="mv-modal-text" style={{ color: "#ef4444" }}>
                    <strong>Cannot delete the live/program scene.</strong> Switch to a different scene in OBS first.
                  </p>
                  <div className="mv-modal-actions">
                    <button className="mv-btn mv-btn--ghost" onClick={() => setShowSceneDeleteModal(false)} title="OK">OK</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mv-modal-text">
                    This will <strong>permanently delete</strong> the following scene{safeToDelete.size !== 1 ? "s" : ""} from OBS:
                  </p>
                  <ul style={{ margin: "8px 0", paddingLeft: 20, fontSize: 13, color: "var(--text-muted, #aaa)", maxHeight: 120, overflow: "auto" }}>
                    {[...safeToDelete].map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                  {liveSceneBlocked && (
                    <p className="mv-modal-text" style={{ color: "#f59e0b", fontSize: 12 }}>
                      ⚠ <strong>"{programScene}"</strong> is currently live and was excluded from deletion.
                    </p>
                  )}
                  <p className="mv-modal-text" style={{ color: "#ef4444", fontSize: 12 }}>
                    ⚠ Scenes will also be removed from OBS and any layouts using them.
                  </p>
                  {isDeletingAllNonLive && (
                    <p className="mv-modal-text" style={{ color: "#f59e0b", fontSize: 12, marginTop: 4 }}>
                      ⚠ You're deleting all non-live scenes. A default scene will be created to keep OBS stable.
                    </p>
                  )}
                  <div className="mv-modal-actions">
                    <button className="mv-btn mv-btn--ghost" onClick={() => setShowSceneDeleteModal(false)} title="Cancel">Cancel</button>
                    <button className="mv-btn mv-btn--danger" disabled={deletingScenes}
                      onClick={async () => {
                        setDeletingScenes(true);
                        try {
                          // If deleting all non-live scenes, create a fallback first
                          if (isDeletingAllNonLive) {
                            try {
                              await obsService.createScene("Default Scene");
                              await obsService.createInput("Default Scene", "Black Background", "color_source_v3", { color: 0xff000000 });
                            } catch { /* may already exist */ }
                          }
                          for (const name of safeToDelete) {
                            try {
                              await obsService.call("RemoveScene", { sceneName: name });
                            } catch (err) {
                              console.warn(`[MVRegionLibrary] Failed to delete scene "${name}":`, err);
                            }
                          }
                          // Also unassign deleted scenes from current layout regions
                          for (const region of regions) {
                            if (region.type === "obs-scene" && safeToDelete.has((region as OBSSceneRegion).sceneName)) {
                              unassignSceneFromRegion(region.id);
                            }
                          }
                          setSelectedScenes(new Set());
                          await fetchScenes();
                        } finally {
                          setDeletingScenes(false);
                          setShowSceneDeleteModal(false);
                        }
                      }}>
                      {deletingScenes ? "Deleting…" : <><Icon name="delete" size={16} /> Delete from OBS</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Missing Scene Error Modal ── */}
      {missingScene && (
        <div className="mv-modal-backdrop" onClick={() => setMissingScene(null)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon"><Icon name="error_outline" size={20} style={{ color: "var(--error, #e74c3c)" }} /></div>
            <h3 className="mv-modal-title">Scene Not Found in OBS</h3>
            <p className="mv-modal-text">
              The scene <strong>"{missingScene.sceneName}"</strong> was removed from OBS or no longer exists.
              Would you like to remove it from this slot or substitute it with another source?
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setMissingScene(null)} title="Dismiss">Dismiss</button>
              <button className="mv-btn mv-btn--danger"
                onClick={() => {
                  unassignSceneFromRegion(missingScene.regionId);
                  setMissingScene(null);
                }} title="Remove">
                <Icon name="delete" size={16} />
                Remove
              </button>
              <button className="mv-btn mv-btn--primary"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSubstitutePopover({ regionId: missingScene.regionId, x: rect.left, y: rect.bottom + 4 });
                  setMissingScene(null);
                }} title="Swap">
                <Icon name="swap_horiz" size={16} />
                Substitute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Substitute Scene Popover ── */}
      {substitutePopover && (
        <div className="mv-popover" style={{ left: substitutePopover.x, top: substitutePopover.y, minWidth: 220 }}
          onClick={(e) => e.stopPropagation()}>
          <div className="mv-popover-header">
            <Icon name="swap_horiz" size={14} />
            <span>Substitute Source</span>
          </div>
          {obsConnected && scenes.length > 0 ? (
            <div className="mv-popover-list">
              {scenes.map((scene) => (
                <button key={scene.sceneName} className="mv-popover-item"
                  onClick={() => {
                    assignSceneToRegion(substitutePopover.regionId, scene.sceneName, scene.sceneIndex);
                    setSubstitutePopover(null);
                  }} title="videocam">
                  <Icon name="videocam" size={14} />
                  <span>{scene.sceneName}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mv-popover-empty">
              <Icon name="link_off" size={16} style={{ opacity: 0.3 }} />
              <span>{obsConnected ? "No scenes found" : "Connect to OBS first"}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Template Confirmation Modal ── */}
      {pendingTemplate && (
        <div className="mv-modal-backdrop" onClick={() => setPendingTemplate(null)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon">
              <Icon name={pendingTemplate.icon || "grid_view"} size={20} />
            </div>
            <h3 className="mv-modal-title">Apply Template?</h3>
            <p className="mv-modal-text">
              Apply <strong>"{pendingTemplate.name}"</strong> ({pendingTemplate.regions.filter((r) => r.type === "obs-scene").length} layers)?
              This will replace your current layout.
            </p>
            {(() => {
              const currentAssigned = regions.filter(
                (r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName
              );
              const newSlotCount = pendingTemplate.regions.filter((r) => r.type === "obs-scene").length;
              if (currentAssigned.length > 0) {
                return (
                  <div style={{ margin: "8px 0", fontSize: 13, color: "var(--text-muted, #aaa)" }}>
                    <p style={{ marginBottom: 4 }}>
                      <strong>{currentAssigned.length}</strong> assigned scene{currentAssigned.length !== 1 ? "s" : ""} →{" "}
                      <strong>{newSlotCount}</strong> available slot{newSlotCount !== 1 ? "s" : ""}
                    </p>
                    {currentAssigned.length > newSlotCount && (
                      <p style={{ color: "#f59e0b", fontSize: 12 }}>
                        ⚠ {currentAssigned.length - newSlotCount} scene{currentAssigned.length - newSlotCount !== 1 ? "s" : ""} won't fit and will be unassigned.
                      </p>
                    )}
                    <ul style={{ paddingLeft: 16, margin: "4px 0" }}>
                      {currentAssigned.map((r, i) => (
                        <li key={r.id} style={{ opacity: i < newSlotCount ? 1 : 0.5 }}>
                          {(r as OBSSceneRegion).sceneName}
                          {i < newSlotCount ? " → slot " + (i + 1) : " (will be unassigned)"}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
              return null;
            })()}
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setPendingTemplate(null)} title="Cancel">Cancel</button>
              {regions.some((r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName) && (
                <button className="mv-btn mv-btn--outline" onClick={() => applyPendingTemplate(false)} title="Apply">
                  Apply Without Scenes
                </button>
              )}
              <button className="mv-btn mv-btn--primary" onClick={() => applyPendingTemplate(true)} title="Apply">
                <Icon name="auto_fix_high" size={16} />
                {regions.some((r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName)
                  ? "Apply & Keep Scenes"
                  : "Apply Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Overflow Scenes Modal ── */}
      {showOverflowModal && overflowScenes.length > 0 && (
        <div className="mv-modal-backdrop" onClick={() => setShowOverflowModal(false)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon">
              <Icon name="info" size={20} style={{ color: "#f59e0b" }} />
            </div>
            <h3 className="mv-modal-title">Some Scenes Didn't Fit</h3>
            <p className="mv-modal-text">
              The new template has fewer slots than your previous layout.
              These scenes were not placed:
            </p>
            <ul style={{ margin: "8px 0", paddingLeft: 20, fontSize: 13, color: "var(--text-muted, #aaa)" }}>
              {overflowScenes.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="mv-modal-text" style={{ fontSize: 12 }}>
              You can drag them onto any layer from the OBS Scenes list.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--primary" onClick={() => {
                setShowOverflowModal(false);
                setOverflowScenes([]);
              }} title="Got it">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Live Scene Warning Toast ── */}
      {liveSceneWarning && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "#f59e0b", color: "#000", padding: "8px 16px", borderRadius: 6,
          fontSize: 13, fontWeight: 600, zIndex: 10000, display: "flex", alignItems: "center", gap: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)", animation: "fadeIn .15s ease-out",
        }}>
          <Icon name="live_tv" size={18} />
          Can't delete the live/program scene — switch scenes in OBS first
        </div>
      )}
    </div>
  );
}
