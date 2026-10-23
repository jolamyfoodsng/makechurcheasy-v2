/**
 * MediaTab.tsx — Media grid tab for the Library page
 *
 * Features:
 *   • Search by name
 *   • Filter: All / Images / Videos
 *   • Responsive card grid with thumbnails, type/duration badges
 *   • 3-dot menu: Rename, Delete (with confirmation)
 *   • Add Media modal with drag-and-drop + file browse
 *   • ESC closes modals
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, Plus, Share2, Eye, MoreVertical, ArrowLeft, X as CloseIcon, Film } from "../components/icons/NativeIcons";
import i18n from "../i18n";
import type { MediaItem } from "./libraryTypes";
import { getAllMedia, saveMedia, deleteMedia, renameMedia } from "./libraryDb";
import { resolveOverlayAssetUrl, getOverlayBaseUrl } from "../services/overlayUrl";
import Icon from "../components/Icon";
import { useAuth } from "../contexts/AuthContext";
import { getEffectivePlan } from "../services/licenseService";
import { checkEntitlementSync } from "../services/entitlementClient";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import { COMMON_DOCUMENT_EXTENSIONS, DOCK_MEDIA_ACCEPT, getMediaKind, isSupportedMediaFile } from "../services/mediaValidation";
import {
  REFERENCE_MEDIA_EXTENSIONS,
  copyReferenceIntoLibrary,
  findMissingReferenceItems,
  getCopyImportedMediaPreference,
  importMediaPaths,
  isReferenceMediaItem,
  listenForNativeFileDrops,
  mediaKindForPath,
  pickMediaPaths,
  relinkReferenceItem,
  setCopyImportedMediaPreference,
} from "./mediaReferences";
import {
  convertDocumentToPageFiles,
  isSupportedDocumentFile,
  type DocumentPageFile,
} from "../dock/documentConversion";
import {
  completeReceiverFile,
  downloadReceiverFile,
  formatReceiverFileSize,
  formatReceiverFileTime,
  getPendingReceiverFiles,
  saveReceiverFileToFolder,
  type ReceiverFile,
} from "../services/receiverService";
import { MediaShareTab } from "./MediaShareTab";
import { fuzzyMatch } from "../services/fuzzySearch";
import {
  downloadTemplatePictureToLibrary,
  fetchTemplatePictures,
  type TemplatePictureAsset,
} from "../services/templateVideos";
import { saveUploadBytes } from "../services/uploadFileBytes";

type FilterType = "all" | "image" | "video";
type AddMediaCategory = "image" | "video" | "audio" | "document";
type MediaView = "library" | "share";

export interface LibraryMediaImportItem {
  file: File;
  documentPage?: DocumentPageFile;
}

export const MEDIA_FILE_ACCEPT = DOCK_MEDIA_ACCEPT;

/* ---------- helpers ---------- */

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSupportedLibraryImportFile(file: File): boolean {
  return isSupportedMediaFile(file) || isSupportedDocumentFile(file);
}

export async function expandLibraryMediaImportFiles(
  files: FileList | File[],
  onProgress?: (status: string) => void,
): Promise<LibraryMediaImportItem[]> {
  const queue: LibraryMediaImportItem[] = [];

  for (const file of Array.from(files)) {
    if (isSupportedMediaFile(file)) {
      queue.push({ file });
      continue;
    }

    if (isSupportedDocumentFile(file)) {
      const pages = await convertDocumentToPageFiles(file, onProgress);
      queue.push(...pages.map((documentPage) => ({ file: documentPage.file, documentPage })));
    }
  }

  return queue;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function getVideoDuration(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => resolve(0);
    v.src = dataUrl;
  });
}

function getVideoDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        resolve({ width: v.videoWidth, height: v.videoHeight });
      } else {
        resolve(null);
      }
    };
    v.onerror = () => resolve(null);
    v.src = dataUrl;
  });
}

function getImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function generateVideoThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, v.duration / 4);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => resolve("");
    v.src = dataUrl;
  });
}

/**
 * Generate a small thumbnail data-URL for an image (max 320×180).
 * Keeps the stored data small for localStorage.
 */
function generateImageThumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const MAX_W = 320;
      const MAX_H = 180;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_W || h > MAX_H) {
        const ratio = Math.min(MAX_W / w, MAX_H / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

export async function saveLibraryMediaItem(
  item: LibraryMediaImportItem,
  overrideName?: string,
): Promise<void> {
  const { file, documentPage } = item;
  if (!isSupportedMediaFile(file)) {
    throw new Error(`Unsupported file type. Only image and video files are allowed.`);
  }
  const documentBaseName = documentPage
    ? (overrideName || documentPage.sourceName).replace(/\.[^.]+$/, "").trim()
    : "";
  const fileName = documentPage
    ? i18n.t("library.mediaTab.documentPage", {
        name: documentBaseName || i18n.t("library.mediaTab.addModal.document"),
        pageNumber: documentPage.pageNumber,
      })
    : (overrideName ?? file.name).trim();
  const category = getMediaKind(file);
  if (!category) {
    throw new Error(`Unsupported file type. Only image and video files are allowed.`);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploadStartedAt = Date.now();
    const uploadedAt = new Date(uploadStartedAt).toISOString();
    const safeName = `media_${uploadStartedAt}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const diskPath = await saveUploadBytes(safeName, bytes);

    const baseUrl = await getOverlayBaseUrl();
    const overlayUrl = `${baseUrl}/uploads/${encodeURIComponent(safeName)}`;

    let thumbnailUrl: string | undefined;
    let durationSec: number | undefined;
    let dimensions: { width: number; height: number } | null = null;
    const objectUrl = URL.createObjectURL(file);

    try {
      if (category === "video") {
        durationSec = await getVideoDuration(objectUrl);
        dimensions = await getVideoDimensions(objectUrl);
        thumbnailUrl = await generateVideoThumbnail(objectUrl);
      } else {
        dimensions = await getImageDimensions(objectUrl);
        thumbnailUrl = await generateImageThumbnail(objectUrl);
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    const item: MediaItem = {
      id: uid(),
      name: fileName,
      type: category,
      url: overlayUrl,
      filePath: diskPath,
      diskFileName: safeName,
      thumbnailUrl,
      width: dimensions?.width,
      height: dimensions?.height,
      durationSec: durationSec ? Math.round(durationSec) : undefined,
      fileSize: file.size,
      mimeType: file.type,
      createdAt: uploadedAt,
      uploadedAt,
      source: documentPage ? "document-conversion" : "local",
      documentSourceName: documentPage ? (overrideName || documentPage.sourceName) : undefined,
      documentId: documentPage?.documentId,
      documentPageNumber: documentPage?.pageNumber,
      documentPageCount: documentPage?.pageCount,
    };

    await saveMedia(item);
  } catch (err) {
    console.error("[MediaTab] Error in saveLibraryMediaFile:", err);
    throw err;
  }
}

export async function saveLibraryMediaFile(file: File, overrideName?: string): Promise<void> {
  if (isSupportedDocumentFile(file)) {
    const pages = await convertDocumentToPageFiles(file);
    for (const documentPage of pages) {
      await saveLibraryMediaItem({ file: documentPage.file, documentPage }, overrideName);
    }
    return;
  }

  await saveLibraryMediaItem({ file }, overrideName);
}

/* ========================================================================= */
/* MediaTab                                                                  */
/* ========================================================================= */

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function isDocumentPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return COMMON_DOCUMENT_EXTENSIONS.includes(ext);
}

/** Documents are converted to page images, so they still need their bytes. */
async function readDocumentFiles(paths: string[]): Promise<File[]> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return Promise.all(paths.map(async (path) => new File([await readFile(path)], fileNameFromPath(path))));
}

/** How many more images/videos the current plan allows. */
async function getMediaQuotaRoom(effectivePlan: string): Promise<{ image: number; video: number }> {
  const { limit: imageLimit } = checkEntitlementSync("images", effectivePlan);
  const { limit: videoLimit } = checkEntitlementSync("videos", effectivePlan);
  const currentItems = await getAllMedia();
  const imageCount = currentItems.filter((m) => m.type === "image").length;
  const videoCount = currentItems.filter((m) => m.type === "video").length;
  return {
    image: imageLimit === -1 ? Infinity : Math.max(0, imageLimit - imageCount),
    video: videoLimit === -1 ? Infinity : Math.max(0, videoLimit - videoCount),
  };
}

export function MediaTab({ focusMediaId, openReceiver = false }: { focusMediaId?: string; openReceiver?: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pageDragging, setPageDragging] = useState(false);
  const [pageUploading, setPageUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [mediaView, setMediaView] = useState<MediaView>("library");
  const [starterPictures, setStarterPictures] = useState<TemplatePictureAsset[]>([]);
  const [starterPicturesLoading, setStarterPicturesLoading] = useState(false);
  const [starterPictureDownloading, setStarterPictureDownloading] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<Set<string>>(() => new Set());
  const [copyImportedMedia, setCopyImportedMedia] = useState(getCopyImportedMediaPreference);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const starterPicturesAttemptedRef = useRef(false);
  const autoOpenedMediaIdRef = useRef<string | null>(null);
  const renameSubmittingRef = useRef(false);

  // ── Plan enforcement ──
  const { user: authUser } = useAuth();
  const effectivePlan = getEffectivePlan(authUser);
  const { limit: imageLimit } = checkEntitlementSync("images", effectivePlan);
  const { limit: videoLimit } = checkEntitlementSync("videos", effectivePlan);
  const imageCount = useMemo(() => items.filter((m) => m.type === "image").length, [items]);
  const videoCount = useMemo(() => items.filter((m) => m.type === "video").length, [items]);
  const isImageUnlimited = imageLimit === -1;
  const isVideoUnlimited = videoLimit === -1;
  const showMediaUsage = !isImageUnlimited || !isVideoUnlimited;

  const reload = useCallback(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const items = await getAllMedia();
        if (cancelled) return;
        setItems(items);
        setLoading(false);
        const missing = await findMissingReferenceItems(items);
        if (!cancelled) setMissingIds(missing);
      } catch (err) {
        if (cancelled) return;
        console.error("[MediaTab] Failed to load media:", err);
        setItems([]);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return reload();
  }, [reload]);

  useEffect(() => {
    if (loading || items.length > 0 || starterPicturesAttemptedRef.current || starterPicturesLoading || starterPictures.length > 0) return;
    starterPicturesAttemptedRef.current = true;
    let cancelled = false;
    setStarterPicturesLoading(true);
    void fetchTemplatePictures()
      .then((pictures) => {
        if (!cancelled) setStarterPictures(pictures.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setStarterPictures([]);
      })
      .finally(() => {
        if (!cancelled) setStarterPicturesLoading(false);
      });
    return () => { cancelled = true; };
  }, [items.length, loading, starterPictures.length, starterPicturesLoading]);

  useEffect(() => {
    if (!focusMediaId) {
      autoOpenedMediaIdRef.current = null;
      return;
    }
    if (focusMediaId === autoOpenedMediaIdRef.current) return;
    const target = items.find((item) => item.id === focusMediaId);
    if (!target) return;

    autoOpenedMediaIdRef.current = focusMediaId;
    setFilter("all");
    setPreviewItem(target);

    window.setTimeout(() => {
      const safeId = focusMediaId.replace(/"/g, '\\"');
      const element = document.querySelector<HTMLDivElement>(`[data-media-id="${safeId}"]`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }, [focusMediaId, items]);

  useEffect(() => {
    if (openReceiver) setMediaView("share");
  }, [openReceiver]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ESC handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) { setShowAddModal(false); return; }
        if (deleteConfirmId) { setDeleteConfirmId(null); return; }
        if (renameId) { setRenameId(null); return; }
        setMenuOpenId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, deleteConfirmId, renameId]);

  // Filter + search (memoized to avoid recomputation)
  // NOTE: Plan limits do NOT control visibility. Users always see all their media.
  // Limits only apply to upload/create/import actions.
  const visible = useMemo(() => {
    return items.filter((m) => {
      if (filter !== "all" && m.type !== filter) return false;
      if (search && !fuzzyMatch(search, m.name)) return false;
      return true;
    });
  }, [items, filter, search]);

  const isFreshMediaLibrary = items.length === 0 && !search.trim() && filter === "all";

  /* ---- actions ---- */

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteMedia(id);
        await reload();
      } finally {
        setDeleteConfirmId(null);
        setMenuOpenId(null);
      }
    },
    [reload]
  );

  const handleRenameSubmit = useCallback(
    async (id: string) => {
      if (renameSubmittingRef.current) return;
      renameSubmittingRef.current = true;
      try {
        if (renameValue.trim()) {
          await renameMedia(id, renameValue.trim());
          await reload();
        }
        setRenameId(null);
      } finally {
        renameSubmittingRef.current = false;
      }
    },
    [renameValue, reload]
  );

  const handleAddComplete = useCallback(() => {
    reload();
    setShowAddModal(false);
  }, [reload]);

  const handleDownloadStarterPicture = useCallback(async (asset: TemplatePictureAsset) => {
    const entitlement = checkEntitlementSync("images", effectivePlan);
    if (!entitlement.allowed) {
      void openDashboardSubscriptionPlans();
      return;
    }

    setStarterPictureDownloading(asset.id);
    try {
      const item = await downloadTemplatePictureToLibrary(asset);
      setItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
    } catch (error) {
      console.error("[MediaTab] Failed to download starter picture:", error);
      alert(t("library.mediaTab.failedToSaveMultiple"));
    } finally {
      setStarterPictureDownloading(null);
    }
  }, [effectivePlan, t]);

  const handleDirectUpload = useCallback(async (files: FileList | File[]) => {
    const allFiles = Array.from(files);
    // Validate file types — reject unsupported files with clear error
    const rejected = allFiles.filter((f) => !isSupportedLibraryImportFile(f));
    for (const f of rejected) {
      alert(`${t("library.mediaTab.unsupportedFileType")}: "${f.name}"`);
    }
    const sourceQueue = allFiles.filter((f) => isSupportedLibraryImportFile(f));
    if (sourceQueue.length === 0) return;

    setPageUploading(true);
    const queueItems = await expandLibraryMediaImportFiles(sourceQueue);
    if (queueItems.length === 0) {
      setPageUploading(false);
      return;
    }

    // ── Per-file-type quota enforcement ──
    // Use live entitlements from server (checkEntitlementSync reads latest)
    const { limit: liveImageLimit } = checkEntitlementSync("images", effectivePlan);
    const { limit: liveVideoLimit } = checkEntitlementSync("videos", effectivePlan);

    // Recount from DB to get current stored counts (fresh, not stale)
    const currentItems = await getAllMedia();
    const currentImageCount = currentItems.filter((m) => m.type === "image").length;
    const currentVideoCount = currentItems.filter((m) => m.type === "video").length;

    console.log("[MediaTab] Plan:", effectivePlan);
    console.log("[MediaTab] Entitlements:", { images: liveImageLimit, videos: liveVideoLimit });
    console.log("[MediaTab] Images:", currentImageCount, "/", liveImageLimit);
    console.log("[MediaTab] Videos:", currentVideoCount, "/", liveVideoLimit);

    let imagesToUpload = 0;
    let videosToUpload = 0;

    // Pre-count incoming files by type
    for (const { file } of queueItems) {
      const kind = getMediaKind(file);
      if (kind === "image") imagesToUpload++;
      else if (kind === "video") videosToUpload++;
    }

    // Check if each type exceeds quota
    const imageExceeded = liveImageLimit !== -1 && (currentImageCount + imagesToUpload) > liveImageLimit;
    const videoExceeded = liveVideoLimit !== -1 && (currentVideoCount + videosToUpload) > liveVideoLimit;

    // Both types over limit → block entirely
    if (imageExceeded && videoExceeded) {
      void openDashboardSubscriptionPlans();
      setPageUploading(false);
      return;
    }

    try {
      let imagesUploaded = 0;
      let videosUploaded = 0;
      for (const queueItem of queueItems) {
        const { file } = queueItem;
        const kind = getMediaKind(file);
        const isImage = kind === "image";
        const isVideo = kind === "video";

        // Check per-file quota — skip over-limit files, continue with valid ones
        if (isImage && liveImageLimit !== -1 && currentImageCount + imagesUploaded >= liveImageLimit) {
          continue;
        }
        if (isVideo && liveVideoLimit !== -1 && currentVideoCount + videosUploaded >= liveVideoLimit) {
          continue;
        }

        await saveLibraryMediaItem(queueItem);
        if (isImage) imagesUploaded++;
        else if (isVideo) videosUploaded++;
      }

      // Show limit modal if any files were rejected
      const uploadedCount = imagesUploaded + videosUploaded;
      const rejectedCount = queueItems.length - uploadedCount;
      if (rejectedCount > 0) {
        void openDashboardSubscriptionPlans();
      }

      reload();
    } catch (error) {
      console.error("[MediaTab] Failed to save dropped media:", error);
      alert(t("library.mediaTab.failedToSaveMultiple"));
    } finally {
      setPageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [effectivePlan, reload, t]);

  const replaceItem = useCallback((item: MediaItem) => {
    setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)));
  }, []);

  /** Import files by path: the library references them instead of copying. */
  const handlePathImport = useCallback(async (paths: string[]) => {
    const mediaPaths = paths.filter((path) => mediaKindForPath(path));
    const documentPaths = paths.filter((path) => !mediaKindForPath(path) && isDocumentPath(path));
    for (const path of paths) {
      if (!mediaKindForPath(path) && !isDocumentPath(path)) {
        alert(`${t("library.mediaTab.unsupportedFileType")}: "${fileNameFromPath(path)}"`);
      }
    }
    if (mediaPaths.length === 0 && documentPaths.length === 0) return;

    setPageUploading(true);
    try {
      if (mediaPaths.length > 0) {
        const room = await getMediaQuotaRoom(effectivePlan);
        let overLimit = false;
        const allowed = mediaPaths.filter((path) => {
          const kind = mediaKindForPath(path);
          if (kind !== "image" && kind !== "video") return true;
          if (room[kind] <= 0) {
            overLimit = true;
            return false;
          }
          room[kind] -= 1;
          return true;
        });

        const result = await importMediaPaths(allowed, {
          copyIntoLibrary: getCopyImportedMediaPreference(),
          onItemUpdated: replaceItem,
        });
        if (result.saved.length > 0) {
          const savedIds = new Set(result.saved.map((item) => item.id));
          setItems((current) => [...result.saved, ...current.filter((item) => !savedIds.has(item.id))]);
        }
        for (const failure of result.failed) {
          console.warn("[MediaTab] Could not add media:", failure);
          alert(`${t("library.mediaTab.failedToSave")}: "${fileNameFromPath(failure.path)}"`);
        }
        if (overLimit) void openDashboardSubscriptionPlans();
      }

      if (documentPaths.length > 0) {
        await handleDirectUpload(await readDocumentFiles(documentPaths));
      }
    } catch (error) {
      console.error("[MediaTab] Failed to add media:", error);
      alert(t("library.mediaTab.failedToSaveMultiple"));
    } finally {
      setPageUploading(false);
    }
  }, [effectivePlan, handleDirectUpload, replaceItem, t]);

  /** Native picker in the desktop app (real paths); file input elsewhere. */
  const openImportPicker = useCallback(async () => {
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    let paths: string[];
    try {
      paths = await pickMediaPaths({ extensions: [...REFERENCE_MEDIA_EXTENSIONS, ...COMMON_DOCUMENT_EXTENSIONS] });
    } catch (error) {
      console.warn("[MediaTab] Native file picker unavailable:", error);
      fileInputRef.current?.click();
      return;
    }
    if (paths.length > 0) await handlePathImport(paths);
  }, [handlePathImport]);

  // Native drops carry file paths, so dropped media is referenced too.
  const handlePathImportRef = useRef(handlePathImport);
  handlePathImportRef.current = handlePathImport;
  useEffect(() => {
    if (mediaView !== "library") return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForNativeFileDrops({
      onHover: setPageDragging,
      onDrop: (paths) => {
        setShowAddModal(false);
        void handlePathImportRef.current(paths);
      },
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("[MediaTab] Native drag-and-drop unavailable:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mediaView]);

  const handleRelink = useCallback(async (item: MediaItem) => {
    try {
      const updated = await relinkReferenceItem(item);
      if (!updated) return;
      replaceItem(updated);
      setMissingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    } catch (error) {
      console.error("[MediaTab] Could not relink media:", error);
      alert(String(error));
    }
  }, [replaceItem]);

  const handleMakeLocalCopy = useCallback(async (item: MediaItem) => {
    try {
      const updated = await copyReferenceIntoLibrary(item);
      if (updated) replaceItem(updated);
    } catch (error) {
      console.error("[MediaTab] Could not copy media into the library:", error);
      alert(String(error));
    }
  }, [replaceItem]);

  const handleCopyPreferenceChange = useCallback((value: boolean) => {
    setCopyImportedMedia(value);
    setCopyImportedMediaPreference(value);
  }, []);

  return (
    <div
      className={`lib-media-shell${pageDragging ? " lib-media-shell--dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounterRef.current += 1;
        setPageDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setPageDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
          setPageDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCounterRef.current = 0;
        setPageDragging(false);
        // Per-file quota enforcement happens inside handleDirectUpload
        if (event.dataTransfer.files?.length) {
          void handleDirectUpload(event.dataTransfer.files);
        }
      }}
    >
      {mediaView === "share" && (
        <div className="lib-media-share-container">
          <div className="lib-media-share-topbar">
            <button
              type="button"
              className="lib-media-back-btn"
              onClick={() => setMediaView("library")}
            >
              <ArrowLeft size={16} />
              <span>{t("library.receiver.backToMediaLibrary", "Back to Media Library")}</span>
            </button>
          </div>
          <MediaShareTab initialMode={openReceiver ? "receive" : "send"} onMediaChanged={reload} />
        </div>
      )}

      {mediaView === "library" && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) {
                void handleDirectUpload(files);
              }
            }}
          />

          {/* Top toolbar */}
          <div className="lib-media-header-toolbar">
            <div className="lib-media-search-box">
              <Search size={18} className="lib-media-search-icon" />
              <input
                className="lib-media-search-input"
                type="text"
                placeholder={t("library.mediaTab.searchPlaceholder", "Search media...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t("library.mediaTab.searchPlaceholder", "Search media...")}
              />
              {search && (
                <button
                  type="button"
                  className="lib-media-search-clear"
                  onClick={() => setSearch("")}
                  aria-label={t("library.mediaTab.clearSearch", "Clear search")}
                  title={t("library.mediaTab.clearSearch", "Clear search")}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>

            {/* Segmented Filter Pills */}
            <div className="lib-media-filter-segmented" role="tablist" aria-label={t("library.mediaTab.filter")}>
              {(["all", "image", "video"] as FilterType[]).map((f) => {
                const label = f === "all"
                  ? t("common.all", "All")
                  : f === "image"
                    ? t("library.mediaTab.preview.image", "Image")
                    : t("library.mediaTab.preview.video", "Video");
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    className={`lib-media-segmented-btn${filter === f ? " is-active" : ""}`}
                    onClick={() => setFilter(f)}
                    title={label}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {showMediaUsage && (
              <span className="lib-song-usage-badge">
                {!isImageUnlimited && `Images ${imageCount}/${imageLimit}`}
                {!isImageUnlimited && !isVideoUnlimited && " · "}
                {!isVideoUnlimited && `Videos ${videoCount}/${videoLimit}`}
              </span>
            )}

            {isTauriRuntime() && (
              <label
                className="lib-media-copy-toggle"
                title={t("library.mediaTab.copyImportedHint", "Off: the library links to your files where they are. On: a copy is also kept in the MakeChurchEazy folder.")}
              >
                <input
                  type="checkbox"
                  checked={copyImportedMedia}
                  onChange={(event) => handleCopyPreferenceChange(event.target.checked)}
                />
                <span>{t("library.mediaTab.copyImported", "Copy into library")}</span>
              </label>
            )}

            <button
              type="button"
              className="lib-media-add-action-btn"
              onClick={() => {
                void openImportPicker();
              }}
              title={t("library.mediaTab.addMedia", "Add Media")}
            >
              <Plus size={18} />
              <span>{pageUploading ? `${t("library.mediaTab.uploading")}...` : t("library.mediaTab.addMedia", "Add Media")}</span>
            </button>
          </div>

          {/* Share callout banner */}
          <div className="lib-media-share-callout">
            <div className="lib-media-share-callout__left">
              <div className="lib-media-share-callout__icon">
                <Share2 size={24} />
              </div>
              <div className="lib-media-share-callout__text">
                <h4 className="lib-media-share-callout__title">{t("library.share.teamTitle", "Share files with your team")}</h4>
                <p className="lib-media-share-callout__subtitle">{t("library.share.teamSubtitle", "Receive or send media between devices.")}</p>
              </div>
            </div>
            <button
              type="button"
              className="lib-media-share-callout__btn"
              onClick={() => setMediaView("share")}
            >
              {t("library.share.openShareFiles", "Open Share Files")}
            </button>
          </div>

      {/* Grid */}
      {loading ? (
        <div className="lib-media-loading">
          <Icon name="sync" size={24} className="spin" />
          <p>{t("library.mediaTab.loading")}...</p>
        </div>
      ) : (
        <div className="lib-media-grid">
          {visible.length === 0 && (
            isFreshMediaLibrary ? (
              <div className="lib-empty lib-empty--rich">
                <Icon name="image" size={48} style={{ opacity: 0.3 }} />
                <p className="lib-empty-title">{t("library.mediaTab.getStarted", "Get started with worship pictures")}</p>
                <p className="lib-empty-copy">{t("library.mediaTab.getStartedDescription", "Download these pictures and project them, or add your own media to the library.")}</p>
                {starterPicturesLoading && <p className="lib-empty-copy">{t("library.mediaTab.loadingTemplates", "Loading starter pictures…")}</p>}
                {starterPictures.length > 0 && (
                  <div className="lib-template-starter-grid">
                    {starterPictures.map((asset) => {
                      const downloading = starterPictureDownloading === asset.id;
                      return (
                        <article key={asset.id} className="lib-template-starter-card">
                          <img src={asset.imageUrl} alt={asset.fileName} loading="lazy" />
                          <div className="lib-template-starter-card__footer">
                            <span title={asset.fileName}>{asset.fileName}</span>
                            <button
                              type="button"
                              className="lib-template-starter-card__download"
                              onClick={() => void handleDownloadStarterPicture(asset)}
                              disabled={downloading}
                              title={t("library.mediaTab.downloadTemplate", "Download and add")}
                              aria-label={`${t("library.mediaTab.downloadTemplate", "Download and add")}: ${asset.fileName}`}
                            >
                              <Icon name={downloading ? "sync" : "download"} size={16} className={downloading ? "spin" : undefined} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                <div className="lib-empty-actions">
                  <button className="lib-add-btn" onClick={() => {
                    void openImportPicker();
                  }} title={t("library.mediaTab.addMedia")}>
                    <Icon name="add" size={20} />
                    {t("library.mediaTab.addMedia")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="lib-empty">
                <Icon name="perm_media" size={48} style={{ opacity: 0.3 }} />
                <p>{t("library.mediaTab.noMediaFound")}</p>
                <button className="lib-add-btn" onClick={() => {
                  void openImportPicker();
                }} title={t("library.mediaTab.addMedia")}>
                  <Icon name="add" size={20} />
                  {t("library.mediaTab.addMedia")}
                </button>
              </div>
            )
          )}

          {visible.map((m) => (
            <div
              className={`lib-media-card${menuOpenId === m.id ? " lib-media-card--menu-open" : ""}${previewItem?.id === m.id ? " lib-media-card--focused" : ""}`}
              key={m.id}
              data-media-id={m.id}
              onClick={() => { }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setPreviewItem(m);
              }}
              tabIndex={0}
              role="group"
              aria-label={m.name}
            >
              {/* Thumbnail */}
              <div className="lib-media-thumb">
                {m.type === "video" ? (
                  // Videos: show thumbnail or placeholder (never load video file as image)
                  m.thumbnailUrl ? (
                    <img
                      src={m.thumbnailUrl}
                      alt={m.name}
                      className="lib-media-thumb-img"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="lib-media-thumb--video-placeholder">
                      <Film size={36} />
                    </div>
                  )
                ) : m.type === "image" ? (
                  // Images: show thumbnail or full image
                  m.thumbnailUrl || m.url ? (
                    <img
                      src={m.thumbnailUrl || m.url}
                      alt={m.name}
                      className="lib-media-thumb-img"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="lib-media-thumb--image-placeholder">
                      <Icon name="image" size={32} />
                    </div>
                  )
                ) : null}
                <div className="lib-media-thumb-overlay" />
                {/* Type badge */}
                <span className="lib-media-badge-type">
                  {(m.type === "video" ? t("library.mediaTab.preview.video", "Video") : t("library.mediaTab.preview.image", "Image")).toUpperCase()}
                </span>
                {missingIds.has(m.id) && (
                  <button
                    type="button"
                    className="lib-media-badge-missing"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRelink(m);
                    }}
                    title={t("library.mediaTab.missingFile.locate", "Locate file…")}
                  >
                    {t("library.mediaTab.missingFile.badge", "File missing")}
                  </button>
                )}
                {/* Duration badge */}
                {m.type === "video" && m.durationSec != null && (
                  <span className="lib-media-badge-dur">
                    {fmtDuration(m.durationSec)}
                  </span>
                )}
                {/* Play button overlay */}
                {m.type === "video" && (
                  <div className="lib-media-play-overlay">
                    <div className="lib-media-play-btn">
                      <Icon name="play_arrow" size={20} className="filled" />
                    </div>
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="lib-media-card-footer">
                <div className="lib-media-card-info">
                  {renameId === m.id ? (
                    <input
                      className="lib-rename-input"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(m.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRenameSubmit(m.id);
                          setRenameId(null);
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRenameId(null);
                        }
                      }}
                    />
                  ) : (
                    <>
                      <h4
                        className="lib-media-name"
                        title={m.name}
                      >
                        {m.name.length > 22 ? `${m.name.slice(0, 22)}...` : m.name}
                      </h4>
                      <p className="lib-media-meta">
                        {m.createdAt ? timeAgo(m.createdAt) : "Just now"}
                      </p>
                    </>
                  )}
                </div>

                <div className="lib-media-card-actions">
                  <button
                    type="button"
                    className="lib-media-card-view-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewItem(m);
                    }}
                    aria-label={`${t("library.mediaTab.view", "View")} ${m.name}`}
                    title={t("library.mediaTab.view", "View")}>
                    <Eye size={15} />
                    <span>{t("library.mediaTab.view", "View")}</span>
                  </button>

                  {/* 3-dot menu */}
                  <div className="lib-media-menu-wrap" ref={menuOpenId === m.id ? menuRef : undefined}>
                    <button
                      type="button"
                      className="lib-media-card-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === m.id ? null : m.id);
                      }}
                      title={t("library.mediaTab.filter")}>
                      <MoreVertical size={16} />
                    </button>
                    {menuOpenId === m.id && (
                      <div className="lib-media-menu-dropdown">
                        <button
                          type="button"
                          className="lib-media-menu-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameId(m.id);
                            setRenameValue(m.name);
                            setMenuOpenId(null);
                          }}
                          title={t("library.mediaTab.rename")}>
                          <Icon name="edit" size={16} />
                          {t("library.mediaTab.rename")}
                        </button>
                        {isReferenceMediaItem(m) && m.referenceId && (
                          <button
                            type="button"
                            className="lib-media-menu-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              void handleRelink(m);
                            }}
                            title={t("library.mediaTab.missingFile.locate", "Locate file…")}>
                            <Icon name="folder" size={16} />
                            {t("library.mediaTab.missingFile.locate", "Locate file…")}
                          </button>
                        )}
                        {isReferenceMediaItem(m) && m.referenceId && m.storage !== "copy" && !missingIds.has(m.id) && (
                          <button
                            type="button"
                            className="lib-media-menu-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              void handleMakeLocalCopy(m);
                            }}
                            title={t("library.mediaTab.makeLocalCopyHint", "Keep a copy in the MakeChurchEazy library so it plays even if the original moves")}>
                            <Icon name="content_copy" size={16} />
                            {t("library.mediaTab.makeLocalCopy", "Make a local copy")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="lib-media-menu-action lib-media-menu-action--danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(m.id);
                            setMenuOpenId(null);
                          }}
                          title={t("common.delete")}>
                          <Icon name="delete" size={16} />
                          {t("common.delete")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Media Preview Modal */}
      {previewItem && (
        <MediaPreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="lib-modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="lib-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("library.mediaTab.deleteConfirm.title")}</h3>
            <p>
              {(() => {
                const target = items.find((item) => item.id === deleteConfirmId);
                return target && isReferenceMediaItem(target) && target.storage !== "copy"
                  ? t("library.mediaTab.deleteConfirm.referenceMessage", "This removes it from the library. The original file stays on your computer.")
                  : t("library.mediaTab.deleteConfirm.message");
              })()}
            </p>
            <div className="lib-confirm-actions">
              <button className="lib-confirm-cancel" onClick={() => setDeleteConfirmId(null)} title={t("common.cancel")}>{t("common.cancel")}</button>
              <button className="lib-confirm-delete" onClick={() => handleDelete(deleteConfirmId)} title={t("common.delete")}>{t("common.delete")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Media Modal */}
      {showAddModal && (
        <AddMediaModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddComplete}
          effectivePlan={effectivePlan}
        />
      )}

      {pageDragging && (
        <div className="lib-media-drop-overlay" aria-hidden="true">
          <div className="lib-media-drop-overlay__card">
            <Icon name="cloud_upload" size={22} />
            <div className="lib-media-drop-overlay__title">Drag to add</div>
            <div className="lib-media-drop-overlay__text">Drop images, videos, PDFs, DOCX, or PPTX files to save them into the library.</div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

interface ReceiverDirectoryHandle {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

type ReceiverDirectoryWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<ReceiverDirectoryHandle>;
};

interface MediaReceiverPanelProps {
  visible: boolean;
  onPendingCountChange: (count: number) => void;
  onIncomingFile: (file: ReceiverFile) => void;
  onMediaChanged: () => void;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isReceiverAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function receiverFileIcon(file: ReceiverFile): string {
  if (file.fileType.startsWith("image/")) return "image";
  if (file.fileType.startsWith("video/")) return "movie";
  return "insert_drive_file";
}

function receiverFileTypeIsVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return ["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv"].includes(
    file.name.split(".").pop()?.toLowerCase() || "",
  );
}

function receiverFileTypeLabel(file: ReceiverFile): string {
  if (file.fileType.startsWith("image/")) return "Image";
  if (file.fileType.startsWith("video/")) return "Video";
  return file.fileName.split(".").pop()?.toUpperCase() || "FILE";
}

function receiverCanSaveToMce(file: ReceiverFile): boolean {
  if (file.fileType.startsWith("image/") || file.fileType.startsWith("video/")) return true;
  return ["pdf", "docx", "pptx"].includes(file.fileName.split(".").pop()?.toLowerCase() || "");
}

export function MediaReceiverPanel({
  visible,
  onPendingCountChange,
  onIncomingFile,
  onMediaChanged,
}: MediaReceiverPanelProps) {
  const { t } = useTranslation();
  const { user: receiverUser } = useAuth();
  const receiverPlan = getEffectivePlan(receiverUser);
  const [files, setFiles] = useState<ReceiverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const knownIdsRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const nextFiles = await getPendingReceiverFiles();
      const knownIds = knownIdsRef.current;
      if (knownIds) {
        const incoming = nextFiles.find((file) => !knownIds.has(file.pendingId));
        if (incoming) onIncomingFile(incoming);
      }
      knownIdsRef.current = new Set(nextFiles.map((file) => file.pendingId));
      setFiles(nextFiles);
      onPendingCountChange(nextFiles.length);
      if (!quiet) setStatus(null);
    } catch (error) {
      if (visible) {
        setStatus({
          tone: "error",
          message: error instanceof Error ? error.message : t("library.receiver.unavailable"),
        });
      }
    } finally {
      setLoading(false);
      if (!quiet) setRefreshing(false);
    }
  }, [onIncomingFile, onPendingCountChange, t, visible]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 1800);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const removeFile = useCallback((pendingId: string) => {
    setFiles((current) => {
      const next = current.filter((file) => file.pendingId !== pendingId);
      onPendingCountChange(next.length);
      knownIdsRef.current = new Set(next.map((file) => file.pendingId));
      return next;
    });
  }, [onPendingCountChange]);

  const handleSaveToFolder = useCallback(async (file: ReceiverFile) => {
    setBusyId(file.pendingId);
    setStatus(null);
    try {
      if (isTauriRuntime()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const folderPath = await open({
          directory: true,
          multiple: false,
          title: t("library.receiver.chooseFolder"),
        });
        if (typeof folderPath !== "string" || !folderPath.trim()) return;
        const result = await saveReceiverFileToFolder(file, folderPath);
        removeFile(file.pendingId);
        setStatus({ tone: "success", message: `${result.fileName} saved to the selected folder.` });
        return;
      }

      const picker = (window as ReceiverDirectoryWindow).showDirectoryPicker;
      if (typeof picker !== "function") {
        throw new Error(t("library.receiver.openDesktopApp"));
      }
      const directory = await picker({ mode: "readwrite" });
      const blob = await downloadReceiverFile(file);
      const target = await directory.getFileHandle(file.fileName, { create: true });
      const writable = await target.createWritable();
      await writable.write(blob);
      await writable.close();
      await completeReceiverFile(file);
      removeFile(file.pendingId);
      setStatus({ tone: "success", message: `${file.fileName} saved to the selected folder.` });
    } catch (error) {
      if (!isReceiverAbortError(error)) {
        setStatus({
          tone: "error",
          message: error instanceof Error ? error.message : t("library.receiver.saveFolderFailed"),
        });
      }
    } finally {
      setBusyId(null);
    }
  }, [removeFile, t]);

  const handleSaveToMce = useCallback(async (file: ReceiverFile) => {
    setBusyId(file.pendingId);
    setStatus(null);
    try {
      if (!receiverCanSaveToMce(file)) {
        throw new Error(t("library.receiver.mceTypeHint"));
      }

      const blob = await downloadReceiverFile(file);
      const sourceFile = new File([blob], file.fileName, {
        type: file.fileType || blob.type || "application/octet-stream",
      });
      const queue = await expandLibraryMediaImportFiles([sourceFile]);
      if (queue.length === 0) throw new Error(t("library.receiver.mceTypeHint"));

      const existingItems = await getAllMedia();
      const incomingImages = queue.filter(({ file: item }) => !receiverFileTypeIsVideo(item)).length;
      const incomingVideos = queue.length - incomingImages;
      const imageEntitlement = checkEntitlementSync("images", receiverPlan).limit;
      const videoEntitlement = checkEntitlementSync("videos", receiverPlan).limit;
      const existingImages = existingItems.filter((item) => item.type === "image").length;
      const existingVideos = existingItems.filter((item) => item.type === "video").length;

      if ((imageEntitlement !== -1 && existingImages + incomingImages > imageEntitlement)
        || (videoEntitlement !== -1 && existingVideos + incomingVideos > videoEntitlement)) {
        throw new Error(t("library.receiver.mediaLimitHint"));
      }

      for (const item of queue) {
        await saveLibraryMediaItem(item);
      }
      await completeReceiverFile(file);
      removeFile(file.pendingId);
      onMediaChanged();
      setStatus({ tone: "success", message: `${file.fileName} is now ready in Media.` });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : t("library.receiver.saveMceFailed"),
      });
    } finally {
      setBusyId(null);
    }
  }, [onMediaChanged, receiverPlan, removeFile, t]);

  if (!visible) return null;

  return (
    <section className="lib-media-receiver" aria-labelledby="lib-media-receiver-title">
      <header className="lib-media-receiver__header">
        <div>
          <div className="lib-media-receiver__eyebrow">{t("library.receiver.eyebrow")}</div>
          <h2 id="lib-media-receiver-title">{t("library.receiver.title")}</h2>
          <p>{t("library.receiver.description")}</p>
        </div>
        <button
          type="button"
          className="lib-icon-btn"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label={t("library.receiver.refresh")}
          title={t("library.receiver.refresh")}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      <div className="lib-media-receiver__ready" role="status" aria-live="polite">
        <span className="lib-media-receiver__ready-icon"><Icon name="phonelink_ring" size={19} /></span>
        <span>
          <strong>{t("library.receiver.ready")}</strong>
          <small>{files.length === 0 ? t("library.receiver.waitingForPhone") : `${files.length} file${files.length === 1 ? "" : "s"} waiting for a save choice`}</small>
        </span>
        <span className="lib-media-receiver__ready-dot" aria-hidden="true" />
      </div>

      <div className="lib-media-receiver__hint">
        <Icon name="info" size={16} />
        <span>{t("library.receiver.anyFileHint")}</span>
      </div>

      {status && (
        <div className={`lib-media-receiver__status lib-media-receiver__status--${status.tone}`} role={status.tone === "error" ? "alert" : "status"}>
          <Icon name={status.tone === "error" ? "error" : "check_circle"} size={16} />
          <span>{status.message}</span>
        </div>
      )}

      {loading ? (
        <div className="lib-media-receiver__empty">
          <span className="lib-media-receiver__spinner" aria-hidden="true" />
          <strong>{t("library.receiver.loading")}</strong>
        </div>
      ) : files.length === 0 ? (
        <div className="lib-media-receiver__empty">
          <div className="lib-media-receiver__empty-icon"><Icon name="move_to_inbox" size={34} /></div>
          <strong>{t("library.receiver.emptyTitle")}</strong>
          <p>{t("library.receiver.emptyDescription")}</p>
        </div>
      ) : (
        <div className="lib-media-receiver__list" aria-label={t("library.receiver.incomingFiles")}>
          {files.map((file) => {
            const busy = busyId === file.pendingId;
            return (
              <article key={file.pendingId} className="lib-media-receiver-card">
                <div className="lib-media-receiver-card__identity">
                  <span className="lib-media-receiver-card__icon"><Icon name={receiverFileIcon(file)} size={23} /></span>
                  <span className="lib-media-receiver-card__copy">
                    <strong title={file.fileName}>{file.fileName}</strong>
                    <small>{receiverFileTypeLabel(file)} · {formatReceiverFileSize(file.fileSize)} · {formatReceiverFileTime(file.receivedAt)}</small>
                  </span>
                </div>
                <div className="lib-media-receiver-card__actions">
                  <button type="button" className="lib-receiver-action lib-receiver-action--secondary" onClick={() => void handleSaveToFolder(file)} disabled={busy}>
                    <Icon name="folder" size={15} />
                    {busy ? t("library.receiver.saving") : t("library.receiver.saveToFolder")}
                  </button>
                  <button type="button" className="lib-receiver-action lib-receiver-action--primary" onClick={() => void handleSaveToMce(file)} disabled={busy}>
                    <Icon name="save" size={15} />
                    {t("library.receiver.saveToMce")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ========================================================================= */
/* MediaPreviewModal                                                         */
/* ========================================================================= */

function MediaPreviewModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The URL might be stored as relative (/uploads/...) or absolute (http://127.0.0.1:port/uploads/...)
  // Resolve it to ensure it has the full base URL
  const resolvedUrl = resolveOverlayAssetUrl(item.url);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch media as blob to bypass CSP restrictions
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    const loadMedia = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(resolvedUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const blob = await response.blob();
        if (cancelled) return;

        blobUrl = URL.createObjectURL(blob);
        setMediaSrc(blobUrl);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[MediaPreview] Failed to fetch media:", err);
        setError(`Failed to load: ${resolvedUrl}`);
        setLoading(false);
      }
    };

    loadMedia();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [resolvedUrl]);

  // Chromium/CEF can ignore the autoPlay attribute even for muted previews.
  // Start playback explicitly after the blob has loaded so clicking View
  // consistently opens a playing video in the desktop app and the browser.
  useEffect(() => {
    if (item.type !== "video" || !mediaSrc) return;
    const video = videoRef.current;
    if (!video) return;

    const startPlayback = () => {
      video.muted = true;
      void video.play().catch((playError) => {
        console.warn("[MediaPreview] Could not start video playback:", playError);
      });
    };

    if (video.readyState >= 2) {
      startPlayback();
      return;
    }

    video.addEventListener("canplay", startPlayback, { once: true });
    return () => video.removeEventListener("canplay", startPlayback);
  }, [item.type, mediaSrc]);

  return (
    <div className="lib-preview-backdrop" onClick={onClose}>
      <div className="lib-preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lib-preview-header">
          <div className="lib-preview-title">
            <Icon name={item.type === "video" ? "movie" : "image"} size={20} />
            <span>{item.name}</span>
          </div>
          <button className="lib-preview-close" onClick={onClose} aria-label={t("library.mediaTab.preview.close")} title={t("library.mediaTab.preview.close")}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="lib-preview-content">
          {loading ? (
            <div className="lib-preview-loading">
              <Icon name="sync" size={32} className="spin" />
              <p>{t("library.mediaTab.loading")}...</p>
            </div>
          ) : error ? (
            <div className="lib-preview-error">
              <Icon name="error_outline" size={24} />
              <span>{error}</span>
            </div>
          ) : item.type === "video" ? (
            <video
              ref={videoRef}
              className="lib-preview-video"
              src={mediaSrc || undefined}
              controls
              autoPlay
              muted
              playsInline
              crossOrigin="anonymous"
            />
          ) : (
            <img
              className="lib-preview-image"
              src={mediaSrc || undefined}
              alt={item.name}
              crossOrigin="anonymous"
            />
          )}
        </div>

        {/* Footer */}
        <div className="lib-preview-footer">
          <span className="lib-preview-meta">
            {item.type === "video" ? t("library.mediaTab.preview.video") : t("library.mediaTab.preview.image")}
            {item.width && item.height && ` · ${item.width}×${item.height}`}
            {item.durationSec && ` · ${fmtDuration(item.durationSec)}`}
            {item.fileSize && ` · ${fmtFileSize(item.fileSize)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* AddMediaModal                                                             */
/* ========================================================================= */

function AddMediaModal({ onClose, onSave, effectivePlan }: { onClose: () => void; onSave: () => void; effectivePlan: string }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [category, setCategory] = useState<AddMediaCategory>("video");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleFile = useCallback((f: File) => {
    if (!isSupportedLibraryImportFile(f)) {
      alert(`${t("library.mediaTab.unsupportedFileType")}: "${f.name}"`);
      return;
    }
    setFile(f);
    setFileName(f.name);
    setCategory(isSupportedDocumentFile(f) ? "document" : getMediaKind(f) ?? "image");
  }, [t]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleSave = useCallback(async () => {
    if (!file || !fileName.trim()) return;

    setSaving(true);
    try {
      const queueItems = await expandLibraryMediaImportFiles([file]);
      const imagesToSave = queueItems.filter((item) => getMediaKind(item.file) === "image").length;
      const videosToSave = queueItems.filter((item) => getMediaKind(item.file) === "video").length;
      const { limit: imgLimit } = checkEntitlementSync("images", effectivePlan);
      const { limit: vidLimit } = checkEntitlementSync("videos", effectivePlan);
      const currentItems = await getAllMedia();
      const imgCount = currentItems.filter((m) => m.type === "image").length;
      const vidCount = currentItems.filter((m) => m.type === "video").length;

      if (imagesToSave > 0 && imgLimit !== -1 && imgCount + imagesToSave > imgLimit) {
        alert(`${t("library.mediaTab.limitReached.imageLimitReached")} (${imgCount}/${imgLimit}). ${t("library.mediaTab.limitReached.upgradeHint")}`);
        return;
      }
      if (videosToSave > 0 && vidLimit !== -1 && vidCount + videosToSave > vidLimit) {
        alert(`${t("library.mediaTab.limitReached.videoLimitReached")} (${vidCount}/${vidLimit}). ${t("library.mediaTab.limitReached.upgradeHint")}`);
        return;
      }

      for (const queueItem of queueItems) {
        await saveLibraryMediaItem(queueItem, fileName.trim());
      }
      onSave();
    } catch (err) {
      console.error("[MediaTab] Failed to save media:", err);
      alert(t("library.mediaTab.failedToSave"));
    } finally {
      setSaving(false);
    }
  }, [effectivePlan, file, fileName, onSave, t]);

  return (
    <div className="lib-modal-backdrop" onClick={onClose}>
      <div className="lib-add-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lib-add-modal-header">
          <h3>{t("library.mediaTab.addModal.title")}</h3>
          <button className="lib-modal-close-btn" onClick={onClose} title={t("common.close")}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="lib-add-modal-body">
          {/* Drop zone */}
          <label
            className={`lib-dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="lib-dropzone-content">
              <div className="lib-dropzone-icon-wrap">
                <Icon name="cloud_upload" size={20} className="lib-dropzone-icon" />
              </div>
              {file ? (
                <p className="lib-dropzone-text">{file.name}</p>
              ) : (
                <>
                  <p className="lib-dropzone-text">
                    {t("library.mediaTab.addModal.dropText").replace(/ click to /i, " ")}
                    {" "}
                    <span className="lib-dropzone-browse">{t("library.mediaTab.addModal.browse").toLowerCase()}</span>
                  </p>
                  <p className="lib-dropzone-hint">PNG, JPG, MP4, MOV, PDF, DOCX, PPTX</p>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              className="lib-dropzone-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          {/* File name */}
          <div className="lib-field">
            <label className="lib-field-label">{t("library.mediaTab.addModal.fileName")}</label>
            <div className="lib-field-input-wrap">
              <input
                className="lib-field-input"
                type="text"
                placeholder={t("library.mediaTab.addModal.fileNamePlaceholder")}
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
              <Icon name="edit" size={20} className="lib-field-input-icon" />
            </div>
          </div>

          {/* Category toggle */}
          <div className="lib-field">
            <label className="lib-field-label">{t("library.mediaTab.addModal.category")}</label>
            <div className="lib-category-toggle">
              <label className={`lib-category-opt${category === "image" ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="media-category"
                  className="sr-only"
                  checked={category === "image"}
                  onChange={() => setCategory("image")}
                />
                <Icon name="image" size={16} />
                {t("library.mediaTab.addModal.image")}
              </label>
              <label className={`lib-category-opt${category === "video" ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="media-category"
                  className="sr-only"
                  checked={category === "video"}
                  onChange={() => setCategory("video")}
                />
                <Icon name="videocam" size={16} />
                {t("library.mediaTab.addModal.video")}
              </label>
              <label className={`lib-category-opt${category === "document" ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="media-category"
                  className="sr-only"
                  checked={category === "document"}
                  onChange={() => setCategory("document")}
                />
                <Icon name="description" size={16} />
                {t("library.mediaTab.addModal.document")}
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="lib-add-modal-footer">
          <button className="lib-modal-cancel-btn" onClick={onClose} title={t("common.cancel")}>{t("common.cancel")}</button>
          <button
            className="lib-modal-save-btn"
            disabled={!file || !fileName.trim() || saving}
            onClick={handleSave}
            title={t("common.save")}>
            {saving ? `${t("library.mediaTab.addModal.saving")}…` : t("library.mediaTab.addModal.saveToLibrary")}
          </button>
        </div>
      </div>
    </div>
  );
}
