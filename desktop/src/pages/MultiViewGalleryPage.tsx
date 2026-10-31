/**
 * MultiViewGalleryPage.tsx — Dedicated Multi-View Layout Gallery
 *
 * Browse, preview, and add multi-view layouts to OBS.
 * Layouts are JSON-driven for easy future expansion.
 *
 * Tracks which layouts have been added to OBS via localStorage.
 * Added layouts appear under the "Added" category filter.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  GALLERY_LAYOUTS,
  GALLERY_CATEGORIES,
  type GalleryLayout,
  type GalleryLayoutCategory,
} from "../multiview/galleryLayouts";
import {
  loadLocalAddedLayoutIds,
  saveAddedLayoutIdsToDockData,
  saveLocalAddedLayoutIds,
} from "../multiview/addedLayoutStorage";
import { obsService } from "../services/obsService";
import { getUserScopedKey } from "../services/userScopedStorage";
import { getCurrentUser } from "../services/authService";
import { getEffectivePlan } from "../services/licenseService";
import { checkEntitlementSync } from "../services/entitlementClient";
import Icon from "../components/Icon";
import UpgradeModal from "../components/UpgradeModal";
import ModalDialog from "../components/ModalDialog";
import { Pencil, Trash2 } from "../components/icons/NativeIcons";
import ScriptureCircleGalleryCard from "./ScriptureCircleGalleryCard";
import ScriptureCircleEditor from "./ScriptureCircleEditor";
import ScriptureCirclePreview from "./ScriptureCirclePreview";
import { deleteScriptureCircleTheme, listScriptureCircleThemes, renameScriptureCircleTheme, type ScriptureCircleTheme } from "../multiview/scriptureCircleLook";
import ScriptureArchGalleryCard from "./ScriptureArchGalleryCard";
import ScriptureArchEditor from "./ScriptureArchEditor";
import ScriptureArchPreview from "./ScriptureArchPreview";
import { deleteScriptureArchTheme, listScriptureArchThemes, renameScriptureArchTheme, type ScriptureArchTheme } from "../multiview/scriptureArchLook";
import ScriptureGoldCircleGalleryCard from "./ScriptureGoldCircleGalleryCard";
import ScriptureGoldCircleEditor from "./ScriptureGoldCircleEditor";
import ScriptureGoldCirclePreview from "./ScriptureGoldCirclePreview";
import { deleteScriptureGoldCircleTheme, listScriptureGoldCircleThemes, renameScriptureGoldCircleTheme, type ScriptureGoldCircleTheme } from "../multiview/scriptureGoldCircleLook";
import {
  listCustomMultiViewLooks,
  refreshMultiviewLookCatalog,
  MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT,
  type CustomMultiViewLook,
} from "../multiview/customLookCatalog";

/** A "My" tab entry from any of the three scripture+camera looks, tagged by which one it is so the
 *  card knows which preview/editor/CRUD functions to use (they're mixed together in one list). */
type MyThemeEntry =
  | { kind: "circle"; theme: ScriptureCircleTheme }
  | { kind: "arch"; theme: ScriptureArchTheme }
  | { kind: "gold-circle"; theme: ScriptureGoldCircleTheme };
import "./MultiViewGalleryPage.css";

// ── Dock layout storage helpers ────────────────────────────────────────────

const DOCK_MV_KEY = "dock-mv-layouts";

interface DockMVLayout {
  id: string;
  name: string;
  description: string;
  regionCount: number;
  canvasLabel: string;
  updatedAt: string;
  isTemplate: boolean;
  tags: string[];
}

type ToastType = "success" | "info" | "error";

function loadDockLayouts(): DockMVLayout[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(DOCK_MV_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDockLayouts(items: DockMVLayout[]) {
  try {
    localStorage.setItem(getUserScopedKey(DOCK_MV_KEY), JSON.stringify(items));
  } catch { /* ignore */ }
}

function saveGalleryLayoutToDock(layout: GalleryLayout): void {
  const dockEntry: DockMVLayout = {
    id: `mvg-${layout.id}`,
    name: layout.name,
    description: layout.description,
    regionCount: layout.slots.length,
    canvasLabel: "1920×1080",
    updatedAt: new Date().toISOString(),
    isTemplate: false,
    tags: layout.useCases,
  };
  const existing = loadDockLayouts().filter((item) => item.id !== dockEntry.id);
  existing.unshift(dockEntry);
  saveDockLayouts(existing);
}

// Built-in gallery categories plus a "My" tab for the operator's own saved items
// (e.g. Scripture Circle themes) — kept out of GALLERY_CATEGORIES since that list
// also describes real GalleryLayout.category values, which "my" is not.
const FILTER_TABS: { key: GalleryLayoutCategory | "all" | "my"; label: string; icon: string }[] = [
  ...GALLERY_CATEGORIES.slice(0, 2),
  { key: "my", label: "My", icon: "person" },
  ...GALLERY_CATEGORIES.slice(2),
];

// ── Slot content type → display info ───────────────────────────────────────

const CONTENT_TYPE_INFO: Record<string, { label: string; icon: string; color: string }> = {
  camera: { label: "Content area", icon: "view_quilt", color: "#0078d4" },
  scripture: { label: "Scripture area", icon: "menu_book", color: "#3B82F6" },
  translation: { label: "Translation area", icon: "translate", color: "#00bcd4" },
  "lower-third": { label: "Lower-third area", icon: "subtitles", color: "#ff9800" },
  browser: { label: "Browser area", icon: "language", color: "#ff5722" },
  image: { label: "Overlay area", icon: "layers", color: "#9c27b0" },
};

// ── SVG Preview ────────────────────────────────────────────────────────────

function LayoutPreviewSVG({ layout }: { layout: GalleryLayout }) {
  const canvasW = 1920;
  const canvasH = 1080;

  return (
    <svg viewBox={`0 0 ${canvasW} ${canvasH}`} className="mvg-card-svg">
      {/* Dark background */}
      <rect width={canvasW} height={canvasH} fill="#111" />

      {/* Slots */}
      {layout.slots.map((slot) => {
        const info = CONTENT_TYPE_INFO[slot.contentType] || CONTENT_TYPE_INFO.camera;
        const fontSize = slot.width > 400 && slot.height > 200 ? 28 : 16;
        const labelY = slot.y + slot.height / 2 + fontSize * 0.35;
        const labelX = slot.x + slot.width / 2;

        return (
          <g key={slot.id}>
            <rect
              x={slot.x}
              y={slot.y}
              width={slot.width}
              height={slot.height}
              fill={info.color}
              opacity={0.45}
            />
            <rect
              x={slot.x}
              y={slot.y}
              width={slot.width}
              height={slot.height}
              fill="none"
              stroke={info.color}
              strokeWidth={2}
              opacity={0.7}
            />
            {slot.width > 140 && slot.height > 60 && (
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fill="rgba(255,255,255,0.9)"
                fontSize={fontSize}
                fontWeight="600"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {slot.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Preview Modal ──────────────────────────────────────────────────────────

function PreviewModal({
  layout,
  onClose,
  onAddToOBS,
  obsConnected,
  installing,
  isAdded,
}: {
  layout: GalleryLayout;
  onClose: () => void;
  onAddToOBS: () => void;
  obsConnected: boolean;
  installing: boolean;
  isAdded: boolean;
}) {
  const { t } = useTranslation();
  const contentTypeLabels = useMemo(() => ({
    camera: "Content area",
    scripture: "Scripture area",
    translation: "Translation area",
    "lower-third": "Lower-third area",
    browser: "Browser area",
    image: "Overlay area",
  }), [t]);

  return (
    <div className="mvg-modal-overlay" onClick={onClose}>
      <div className="mvg-modal" onClick={(e) => e.stopPropagation()}>
        <button className="mvg-modal-close" onClick={onClose} aria-label={t("gallery.close")} title={t("gallery.close")}>
          <Icon name="close" size={20} />
        </button>

        {/* Preview */}
        <div className="mvg-modal-preview">
          <LayoutPreviewSVG layout={layout} />
        </div>

        {/* Info */}
        <div className="mvg-modal-info">
          <div className="mvg-modal-header">
            <h2 className="mvg-modal-title">{layout.name}</h2>
            <span className="mvg-modal-category">
              {isAdded ? (
                <span className="mvg-modal-added-badge">
                  <Icon name="check_circle" size={12} /> {t("gallery.added")}
                </span>
              ) : (
                GALLERY_CATEGORIES.find((c) => c.key === layout.category)?.label
              )}
            </span>
          </div>

          <p className="mvg-modal-desc">{layout.description}</p>

          {/* Slots */}
          <div className="mvg-modal-section">
            <h3 className="mvg-modal-section-title">
              {t("gallery.layoutSlots", { count: layout.slots.length })}
            </h3>
            <div className="mvg-modal-slots">
              {layout.slots.map((slot) => {
                const info = CONTENT_TYPE_INFO[slot.contentType] || CONTENT_TYPE_INFO.camera;
                return (
                  <div key={slot.id} className="mvg-modal-slot">
                    <div className="mvg-modal-slot-dot" style={{ background: info.color }} />
                    <Icon name={info.icon} size={14} className="mvg-modal-slot-icon" />
                    <span className="mvg-modal-slot-label">{slot.label}</span>
                    <span className="mvg-modal-slot-type">{contentTypeLabels[slot.contentType] || info.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Use Cases */}
          <div className="mvg-modal-section">
            <h3 className="mvg-modal-section-title">{t("gallery.useCases")}</h3>
            <div className="mvg-modal-usecases">
              {layout.useCases.map((uc) => (
                <span key={uc} className="mvg-modal-usecase">{uc}</span>
              ))}
            </div>
          </div>

          {/* Scene Dimensions */}
          <div className="mvg-modal-section">
            <div className="mvg-modal-meta">
              <span className="mvg-modal-meta-item">
                <Icon name="aspect_ratio" size={14} />
                1920 × 1080
              </span>
              <span className="mvg-modal-meta-item">
                <Icon name="view_module" size={14} />
                {t("gallery.slotCount", { count: layout.slots.length })}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="mvg-modal-actions">
            <button
              className={`mvg-btn ${isAdded ? "mvg-btn--added" : "mvg-btn--primary"}`}
              onClick={onAddToOBS}
              disabled={installing}
              title={t("gallery.addToObs")}>
              {installing ? (
                <>
                  <span className="loading-spinner-sm" /> {t("gallery.installing")}
                </>
              ) : isAdded ? (
                <>
                  <Icon name="check_circle" size={16} /> {t("gallery.addedToObs")}
                </>
              ) : (
                <>
                  <Icon name="add" size={16} /> {t("gallery.addToObs")}
                </>
              )}
            </button>
          </div>

          {!obsConnected && (
            <p className="mvg-modal-obs-hint">
              <Icon name="info" size={12} /> {t("gallery.connectToObsHint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OBS Not Connected Modal ────────────────────────────────────────────────

function OBSDisconnectedModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mvg-modal-overlay" onClick={onClose}>
      <div className="mvg-modal mvg-modal--small" onClick={(e) => e.stopPropagation()}>
        <button className="mvg-modal-close" onClick={onClose} aria-label={t("gallery.close")} title={t("gallery.close")}>
          <Icon name="close" size={20} />
        </button>
        <div className="mvg-disconnected-content">
          <Icon name="cast_connected" size={40} className="mvg-disconnected-icon" />
          <h3>{t("gallery.obsNotConnected")}</h3>
          <p>{t("gallery.obsConnectDescription")}</p>
          <div className="mvg-disconnected-actions">
            <button className="mvg-btn mvg-btn--outline" onClick={onClose} title={t("gallery.cancel")}>
              {t("gallery.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Gallery Page ──────────────────────────────────────────────────────

export default function MultiViewGalleryPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GalleryLayoutCategory | "all" | "my">("all");
  const [previewLayout, setPreviewLayout] = useState<GalleryLayout | null>(null);
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    message: string;
    requiredPlan: string;
    currentPlan: string;
  } | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => loadLocalAddedLayoutIds());
  const [, setRenderTick] = useState(0);
  const [editingCircle, setEditingCircle] = useState(false);
  const [editingCircleThemeId, setEditingCircleThemeId] = useState<string | undefined>(undefined);
  const [circleThemes, setCircleThemes] = useState<ScriptureCircleTheme[]>(() => listScriptureCircleThemes());

  const openCircleEditor = useCallback((themeId?: string) => {
    setEditingCircleThemeId(themeId);
    setEditingCircle(true);
  }, []);

  const closeCircleEditor = useCallback(() => {
    setEditingCircle(false);
    setEditingCircleThemeId(undefined);
    setCircleThemes(listScriptureCircleThemes());
  }, []);

  // Scripture Arch — same editor/theme pattern as Scripture Circle, its own state.
  const [editingArch, setEditingArch] = useState(false);
  const [editingArchThemeId, setEditingArchThemeId] = useState<string | undefined>(undefined);
  const [archThemes, setArchThemes] = useState<ScriptureArchTheme[]>(() => listScriptureArchThemes());

  const openArchEditor = useCallback((themeId?: string) => {
    setEditingArchThemeId(themeId);
    setEditingArch(true);
  }, []);

  const closeArchEditor = useCallback(() => {
    setEditingArch(false);
    setEditingArchThemeId(undefined);
    setArchThemes(listScriptureArchThemes());
  }, []);

  // Scripture Gold Circle — same editor/theme pattern as Scripture Circle, its own state.
  const [editingGoldCircle, setEditingGoldCircle] = useState(false);
  const [editingGoldCircleThemeId, setEditingGoldCircleThemeId] = useState<string | undefined>(undefined);
  const [goldCircleThemes, setGoldCircleThemes] = useState<ScriptureGoldCircleTheme[]>(() => listScriptureGoldCircleThemes());

  const openGoldCircleEditor = useCallback((themeId?: string) => {
    setEditingGoldCircleThemeId(themeId);
    setEditingGoldCircle(true);
  }, []);

  const closeGoldCircleEditor = useCallback(() => {
    setEditingGoldCircle(false);
    setEditingGoldCircleThemeId(undefined);
    setGoldCircleThemes(listScriptureGoldCircleThemes());
  }, []);

  // The "My" tab lists saved themes from all three scripture+camera looks together, newest first.
  const myThemeEntries = useMemo<MyThemeEntry[]>(() => {
    const entries: MyThemeEntry[] = [
      ...circleThemes.map((theme): MyThemeEntry => ({ kind: "circle", theme })),
      ...archThemes.map((theme): MyThemeEntry => ({ kind: "arch", theme })),
      ...goldCircleThemes.map((theme): MyThemeEntry => ({ kind: "gold-circle", theme })),
    ];
    return entries.sort((a, b) => b.theme.updatedAt.localeCompare(a.theme.updatedAt));
  }, [circleThemes, archThemes, goldCircleThemes]);

  // Native confirm()/prompt() are never used in this app — the dialog plugin's confirm/ask
  // commands aren't in src-tauri/capabilities (only dialog:allow-save is granted), so calling them
  // here would silently resolve truthy and then reject in the background. Use ModalDialog instead.
  const [deleteThemeTarget, setDeleteThemeTarget] = useState<MyThemeEntry | null>(null);
  const [renameThemeTarget, setRenameThemeTarget] = useState<MyThemeEntry | null>(null);
  const [renameThemeDraft, setRenameThemeDraft] = useState("");

  const handleDeleteTheme = useCallback((entry: MyThemeEntry) => {
    setDeleteThemeTarget(entry);
  }, []);

  const confirmDeleteTheme = useCallback(() => {
    if (!deleteThemeTarget) return;
    if (deleteThemeTarget.kind === "circle") {
      deleteScriptureCircleTheme(deleteThemeTarget.theme.id);
      setCircleThemes(listScriptureCircleThemes());
    } else if (deleteThemeTarget.kind === "arch") {
      deleteScriptureArchTheme(deleteThemeTarget.theme.id);
      setArchThemes(listScriptureArchThemes());
    } else {
      deleteScriptureGoldCircleTheme(deleteThemeTarget.theme.id);
      setGoldCircleThemes(listScriptureGoldCircleThemes());
    }
    setDeleteThemeTarget(null);
  }, [deleteThemeTarget]);

  const handleRenameTheme = useCallback((entry: MyThemeEntry) => {
    setRenameThemeDraft(entry.theme.name);
    setRenameThemeTarget(entry);
  }, []);

  const confirmRenameTheme = useCallback(() => {
    if (!renameThemeTarget) return;
    const name = renameThemeDraft.trim();
    if (name && name !== renameThemeTarget.theme.name) {
      if (renameThemeTarget.kind === "circle") {
        renameScriptureCircleTheme(renameThemeTarget.theme.id, name);
        setCircleThemes(listScriptureCircleThemes());
      } else if (renameThemeTarget.kind === "arch") {
        renameScriptureArchTheme(renameThemeTarget.theme.id, name);
        setArchThemes(listScriptureArchThemes());
      } else {
        renameScriptureGoldCircleTheme(renameThemeTarget.theme.id, name);
        setGoldCircleThemes(listScriptureGoldCircleThemes());
      }
    }
    setRenameThemeTarget(null);
  }, [renameThemeTarget, renameThemeDraft]);

  const openEditorForEntry = useCallback((entry: MyThemeEntry) => {
    if (entry.kind === "circle") openCircleEditor(entry.theme.id);
    else if (entry.kind === "arch") openArchEditor(entry.theme.id);
    else openGoldCircleEditor(entry.theme.id);
  }, [openCircleEditor, openArchEditor, openGoldCircleEditor]);

  // ── Seed server file with any existing added IDs on mount ──
  useEffect(() => {
    const ids = loadLocalAddedLayoutIds();
    setAddedIds(new Set(ids));
    if (ids.size > 0) {
      saveAddedLayoutIdsToDockData(ids).catch(() => {});
    }
  }, []);

  // ── Listen to OBS status ──
  useEffect(() => {
    setObsConnected(obsService.status === "connected");
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  // ── Added count for filter badge ──
  const addedCount = useMemo(() => addedIds.size, [addedIds]);

  // ── Filtered layouts ──
  const filtered = useMemo(() => {
    let list = GALLERY_LAYOUTS;

    if (filter === "added") {
      list = list.filter((l) => addedIds.has(l.id));
    } else if (filter !== "all") {
      list = list.filter((l) => l.category === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.useCases.some((uc) => uc.toLowerCase().includes(q))
      );
    }

    return list;
  }, [filter, search, addedIds]);

  // The Scripture Circle, Scripture Arch and Scripture Gold Circle looks are always shown on All
  // and Scripture, unless a search rules them out.
  const showScriptureCircle =
    (filter === "all" || filter === "scripture") &&
    (!search.trim() || "scripture circle camera verse".includes(search.trim().toLowerCase()));
  const showScriptureArch =
    (filter === "all" || filter === "scripture") &&
    (!search.trim() || "scripture arch camera verse".includes(search.trim().toLowerCase()));
  const showScriptureGoldCircle =
    (filter === "all" || filter === "scripture") &&
    (!search.trim() || "scripture gold circle camera verse".includes(search.trim().toLowerCase()));

  // Admin-uploaded custom Multi-View looks (see customLookCatalog.ts). Unlike the three Scripture
  // looks above, there can be an arbitrary, growing number of these, so they're shown generically
  // as a list rather than one card per named design. Each one is already a usable Dock entry the
  // moment it's published — there is no separate "add to OBS" step here, so this card is purely
  // informational (pick it up in the Dock's Multi-View tab, same note as a saved Scripture theme).
  const [customLooks, setCustomLooks] = useState<CustomMultiViewLook[]>(() => listCustomMultiViewLooks());
  useEffect(() => {
    const refresh = () => setCustomLooks(listCustomMultiViewLooks());
    refresh();
    void refreshMultiviewLookCatalog().then(refresh);
    window.addEventListener(MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(MULTIVIEW_LOOKS_CATALOG_UPDATED_EVENT, refresh);
  }, []);
  const visibleCustomLooks = useMemo(() => {
    if (filter !== "all" && filter !== "scripture") return [];
    const q = search.trim().toLowerCase();
    if (!q) return customLooks;
    return customLooks.filter((l) => [l.name, l.description].some((v) => (v || "").toLowerCase().includes(q)));
  }, [customLooks, filter, search]);

  // ── Toast helper ──
  const showToast = useCallback((message: string, type: ToastType = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Mark layout as added and refresh ──
  const markAdded = useCallback((layoutId: string) => {
    const ids = loadLocalAddedLayoutIds();
    ids.add(layoutId);
    const savedIds = saveLocalAddedLayoutIds(ids);
    saveAddedLayoutIdsToDockData(savedIds).catch(() => {});
    setAddedIds(new Set(savedIds));
    setRenderTick(t => t + 1);
  }, []);

  // ── Install layout to OBS ──
  const handleAddToOBS = useCallback(
    async (layout: GalleryLayout) => {
      // Re-adding an existing layout is idempotent. A new layout consumes one
      // of the Basic plan's five multiview template slots.
      if (!addedIds.has(layout.id)) {
        const currentPlan = getEffectivePlan(getCurrentUser());
        const access = checkEntitlementSync("multiviewTemplates", currentPlan, addedIds.size);
        if (!access.allowed) {
          setUpgradePrompt({
            message: access.reason || "You have reached the five-template Basic plan limit. Upgrade to Growth for more.",
            requiredPlan: access.requiredPlan || "growth",
            currentPlan,
          });
          return;
        }
      }

      if (addedIds.has(layout.id)) {
        if (!confirm(t("gallery.confirmReplace", { defaultValue: "This layout is already in your dock. Replace it?" }))) {
          return;
        }
      }

      setInstalling(true);
      try {
        // Save to dock storage for the dock multiview tab cards (e.g. MV: Multiview 1)
        saveGalleryLayoutToDock(layout);

        // Mark as added
        markAdded(layout.id);

        showToast(
          t("gallery.toastAdded", {
            name: layout.name,
            defaultValue: `"${layout.name}" added to MultiView templates`,
          }),
          "success",
        );
        setPreviewLayout(null);
      } catch (err) {
        console.warn("[MultiViewGallery] Error saving layout to dock templates:", err);
        showToast(t("gallery.toastError", { defaultValue: "Failed to add layout template" }), "error");
      } finally {
        setInstalling(false);
      }
    },
    [addedIds, showToast, markAdded, t]
  );

  // ── Handle preview → install ──
  const handlePreviewInstall = useCallback(() => {
    if (previewLayout) {
      handleAddToOBS(previewLayout);
    }
  }, [previewLayout, handleAddToOBS]);

  if (editingCircle) {
    return (
      <>
        <ScriptureCircleEditor obsConnected={obsConnected} themeId={editingCircleThemeId} onBack={closeCircleEditor} onNotify={showToast} />
        {toast && (
          <div className={`mvg-toast mvg-toast--${toast.type}`}>
            <Icon name={toast.type === "success" ? "check_circle" : "info"} size={18} />
            <span>{toast.message}</span>
          </div>
        )}
      </>
    );
  }

  if (editingArch) {
    return (
      <>
        <ScriptureArchEditor obsConnected={obsConnected} themeId={editingArchThemeId} onBack={closeArchEditor} onNotify={showToast} />
        {toast && (
          <div className={`mvg-toast mvg-toast--${toast.type}`}>
            <Icon name={toast.type === "success" ? "check_circle" : "info"} size={18} />
            <span>{toast.message}</span>
          </div>
        )}
      </>
    );
  }

  if (editingGoldCircle) {
    return (
      <>
        <ScriptureGoldCircleEditor obsConnected={obsConnected} themeId={editingGoldCircleThemeId} onBack={closeGoldCircleEditor} onNotify={showToast} />
        {toast && (
          <div className={`mvg-toast mvg-toast--${toast.type}`}>
            <Icon name={toast.type === "success" ? "check_circle" : "info"} size={18} />
            <span>{toast.message}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-page mvg-page">
      <div className="app-page__inner mvg-inner">
        {/* Header */}
        <header className="app-page__header mvg-header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">{t("gallery.eyebrow")}</p>
            <h1 className="app-page__title">{t("gallery.title")}</h1>
            <p className="app-page__subtitle">
              {t("gallery.subtitle")}
            </p>
          </div>
        </header>

        {/* Search */}
        <div className="mvg-search">
          <Icon name="search" size={16} className="mvg-search-icon" />
          <input
            type="text"
            className="mvg-search-input"
            placeholder={t("gallery.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="mvg-search-clear" onClick={() => setSearch("")} aria-label={t("gallery.clearSearch")} title={t("gallery.clearSearch")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="mvg-guidance" role="note">
          <Icon name="view_quilt" size={18} className="mvg-guidance-icon" />
          <div className="mvg-guidance-copy">
            <strong>Layout only</strong>
            <span>Choose the arrangement here, then assign your own OBS scenes, Scripture, media, or overlays.</span>
          </div>
        </div>

        {/* Category filters */}
        <div className="mvg-filters">
          {FILTER_TABS.map((cat) => (
            <button
              key={cat.key}
              className={`mvg-filter ${filter === cat.key ? "mvg-filter--active" : ""}`}
              onClick={() => setFilter(cat.key)}
            >
              <Icon name={cat.icon} size={14} />
              {cat.label}
              {cat.key === "added" && addedCount > 0 && (
                <span className="mvg-filter-count">{addedCount}</span>
              )}
              {cat.key === "my" && myThemeEntries.length > 0 && (
                <span className="mvg-filter-count">{myThemeEntries.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Layout grid */}
        {filtered.length > 0 || showScriptureCircle || showScriptureArch || showScriptureGoldCircle || visibleCustomLooks.length > 0 || (filter === "my" && myThemeEntries.length > 0) ? (
          <div className="mvg-grid">
            {showScriptureCircle && <ScriptureCircleGalleryCard onEdit={() => openCircleEditor(undefined)} />}
            {showScriptureArch && <ScriptureArchGalleryCard onEdit={() => openArchEditor(undefined)} />}
            {showScriptureGoldCircle && <ScriptureGoldCircleGalleryCard onEdit={() => openGoldCircleEditor(undefined)} />}
            {visibleCustomLooks.map((look) => (
              <div key={look.lookId} className="mvg-card">
                <div className="mvg-card-preview">
                  <span className="mvg-card-slots">Camera + Verse</span>
                </div>
                <div className="mvg-card-info">
                  <h3 className="mvg-card-name">{look.name}</h3>
                  <p className="mvg-card-desc">{look.description || "Custom Multi-View look."} Ready to use — pick it in the Dock's Multi-View tab and choose your camera scene there.</p>
                  <div className="mvg-card-usecases">
                    <span className="mvg-card-usecase">custom</span>
                    <span className="mvg-card-usecase">camera</span>
                  </div>
                </div>
              </div>
            ))}
            {filter === "my" && myThemeEntries.map((entry) => {
              const { theme } = entry;
              const kindLabel = entry.kind === "circle" ? "Scripture Circle" : entry.kind === "arch" ? "Scripture Arch" : "Scripture Gold Circle";
              return (
                <div key={`${entry.kind}:${theme.id}`} className="mvg-card">
                  <div className="mvg-card-preview">
                    {entry.kind === "circle" && <ScriptureCirclePreview settings={entry.theme.settings} placeholder="Camera" />}
                    {entry.kind === "arch" && <ScriptureArchPreview settings={entry.theme.settings} placeholder="Camera" />}
                    {entry.kind === "gold-circle" && <ScriptureGoldCirclePreview settings={entry.theme.settings} placeholder="Camera" />}
                    <span className="mvg-card-slots">Camera + Scripture</span>
                  </div>
                  <div className="mvg-card-info">
                    <h3 className="mvg-card-name">{theme.name}</h3>
                    <p className="mvg-card-desc">Saved {kindLabel} theme. Pick it up in the Dock's Multi-View tab to use it.</p>
                    <div className="mvg-card-usecases">
                      <span className="mvg-card-usecase">{kindLabel.toLowerCase()}</span>
                      <span className="mvg-card-usecase">camera</span>
                    </div>
                  </div>
                  <div className="mvg-card-actions">
                    <button className="mvg-btn mvg-btn--sm mvg-btn--outline" onClick={() => handleDeleteTheme(entry)} title={`Delete ${theme.name}`}>
                      <Icon name="delete" size={14} /> Delete
                    </button>
                    <button className="mvg-btn mvg-btn--sm mvg-btn--outline" onClick={() => handleRenameTheme(entry)} title={`Rename ${theme.name}`}>
                      <Icon name="edit" size={14} /> Rename
                    </button>
                    <button className="mvg-btn mvg-btn--sm mvg-btn--primary" onClick={() => openEditorForEntry(entry)} title={`Edit ${theme.name}`}>
                      <Icon name="tune" size={14} /> Edit
                    </button>
                  </div>
                </div>
              );
            })}
            {filter !== "my" && filtered.map((layout) => {
              const isAdded = addedIds.has(layout.id);
              return (
                <div key={layout.id} className={`mvg-card${isAdded ? " mvg-card--added" : ""}`}>
                  {/* Preview */}
                  <div className="mvg-card-preview">
                    <LayoutPreviewSVG layout={layout} />
                    <span className="mvg-card-slots">{t("gallery.slotCount", { count: layout.slots.length })}</span>
                    {isAdded && (
                      <span className="mvg-card-added-badge">
                        <Icon name="check_circle" size={12} /> {t("gallery.added")}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="mvg-card-info">
                    <h3 className="mvg-card-name">{layout.name}</h3>
                    <p className="mvg-card-desc">{layout.description}</p>
                    <div className="mvg-card-usecases">
                      {layout.useCases.slice(0, 2).map((uc) => (
                        <span key={uc} className="mvg-card-usecase">{uc}</span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mvg-card-actions">
                    <button
                      className="mvg-btn mvg-btn--outline mvg-btn--sm"
                      onClick={() => setPreviewLayout(layout)}
                      title={t("gallery.preview")}>
                      <Icon name="visibility" size={14} /> {t("gallery.preview")}
                    </button>
                    <button
                      className={`mvg-btn mvg-btn--sm ${isAdded ? "mvg-btn--added" : "mvg-btn--primary"}`}
                      onClick={() => handleAddToOBS(layout)}
                      title={t("gallery.addToObs")}>
                      {isAdded ? (
                        <>
                          <Icon name="check_circle" size={14} /> {t("gallery.added")}
                        </>
                      ) : (
                        <>
                          <Icon name="add" size={14} /> {t("gallery.addToObs")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mvg-empty">
            <Icon name="view_module" size={48} className="mvg-empty-icon" />
            <h3>
              {filter === "my"
                ? "No saved themes yet"
                : filter === "added"
                ? t("gallery.emptyAdded")
                : t("gallery.emptyDefault")}
            </h3>
            <p>
              {filter === "my"
                ? "Edit a Scripture Circle, Scripture Arch or Scripture Gold Circle card on the All or Scripture tab and use \"Send to Dock\" to save one here."
                : filter === "added"
                ? t("gallery.emptyAddedDesc")
                : t("gallery.emptyDefaultDesc")}
            </p>
          </div>
        )}

        {/* Preview Modal */}
        {previewLayout && (
          <PreviewModal
            layout={previewLayout}
            onClose={() => setPreviewLayout(null)}
            onAddToOBS={handlePreviewInstall}
            obsConnected={obsConnected}
            installing={installing}
            isAdded={addedIds.has(previewLayout.id)}
          />
        )}

        {/* OBS Disconnected Modal */}
        {showDisconnected && (
          <OBSDisconnectedModal onClose={() => setShowDisconnected(false)} />
        )}

        {upgradePrompt && (
          <UpgradeModal
            open
            onClose={() => setUpgradePrompt(null)}
            feature="multiviewTemplates"
            requiredPlan={upgradePrompt.requiredPlan}
            currentPlan={upgradePrompt.currentPlan}
            message={upgradePrompt.message}
          />
        )}

        {deleteThemeTarget && (
          <ModalDialog
            tone="danger"
            icon={<Trash2 size={26} />}
            title="Delete this theme?"
            onClose={() => setDeleteThemeTarget(null)}
            hint="It will no longer be available in the Dock's Multi-View tab."
            actions={[
              { label: "Cancel", variant: "ghost", onClick: () => setDeleteThemeTarget(null) },
              { label: "Delete", variant: "danger", onClick: confirmDeleteTheme },
            ]}
          >
            Delete "{deleteThemeTarget.theme.name}"?
          </ModalDialog>
        )}

        {renameThemeTarget && (
          <ModalDialog
            tone="brand"
            icon={<Pencil size={26} />}
            title="Rename theme"
            onClose={() => setRenameThemeTarget(null)}
            actions={[
              { label: "Cancel", variant: "ghost", onClick: () => setRenameThemeTarget(null) },
              { label: "Save", variant: "primary", autoFocus: true, onClick: confirmRenameTheme, disabled: !renameThemeDraft.trim() },
            ]}
            extra={
              <input
                type="text"
                className="mvg-rename-input"
                value={renameThemeDraft}
                onChange={(e) => setRenameThemeDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmRenameTheme(); }}
                autoFocus
                placeholder="Theme name"
              />
            }
          >
            Pick a new name for this theme.
          </ModalDialog>
        )}

        {/* Toast */}
        {toast && (
          <div className={`mvg-toast mvg-toast--${toast.type}`}>
            <Icon
              name={toast.type === "success" ? "check_circle" : "info"}
              size={18}
            />
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
