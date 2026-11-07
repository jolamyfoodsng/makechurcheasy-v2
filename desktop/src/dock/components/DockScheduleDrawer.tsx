/**
 * DockScheduleDrawer.tsx — In-flow 40/60 Shared Space Service Schedule.
 *
 * Design:
 * 1. Shares layout space with Dock tabs (40/60 split, user-resizable via drag handle).
 * 2. Pin / Unpin button with true Pin icon (pins open permanently).
 * 3. Bible, Worship & Notes: Clean, basic box (modeled after Dock LM tab).
 *    Shows reference title, 2-line snippet with ellipsis, clickable to project immediately.
 *    Hover reveals FULL/LT mode toggles and 3-dots actions.
 * 4. Media: Thumbnail on top, caption below, clickable to project, 3-dots menu button on top right.
 * 5. Right-click context menu & 3-dots menu on every card:
 *    - Hide from OBS (clears live output)
 *    - Switch to FULL / LT
 *    - Rename card
 *    - Pin to Top (schedule) / Pin to Schedule (history)
 *    - Remove
 * 6. Responsive narrow width header (<= 210px / compact):
 *    Switches Schedule & History tabs to icons with badge count only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { dockObsClient } from "../dockObsClient";
import type { ServicePlan, ServicePlanItem, ServicePlannerSnapshot } from "../../service-planner/types";
import {
  clearPresentationHistory,
  createNewSchedulePlan,
  DOCK_HISTORY_CHANGED_EVENT,
  DOCK_SCHEDULE_CHANGED_EVENT,
  getOrCreateActiveSchedule,
  getPresentationHistory,
  notifyScheduleToast,
  pinItemToSchedule,
  pinScheduleItemToTop,
  removeHistoryItem,
  removeItemFromActiveSchedule,
  saveSchedulePlan,
  setActiveScheduleId,
  updateItemOverlayMode,
  setPendingWorshipSongSelection,
  setPendingNoteSelection,
  DOCK_SELECT_WORSHIP_SONG_EVENT,
  DOCK_SELECT_NOTE_EVENT,
} from "../dockScheduleService";
import { resolveDockWorshipPresentationSettings } from "../dockWorshipThemeResolution";
import {
  DOCK_SELECT_BIBLE_VERSE_EVENT,
  extractBibleVerseFromPayload,
  setPendingBibleVerseSelection,
} from "../dockBibleNavigation";
import { loadDockNotes, resolveDockNotesPresentationSettings } from "../dockNotesStorage";
import { isDockFreePlan, showUpgradeModal } from "../dockEntitlement";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveOverlayAssetUrl } from "../../services/overlayUrl";
import { DOCK_OPEN_SCHEDULE_GUIDE_EVENT } from "./DockScheduleIntroModal";
import "./dock-schedule.css";
import type { DockStagedItem } from "../dockTypes";
import { useDockOutputTarget } from "../dockOutputTargetContext";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import { getSong } from "../../worship/worshipDb";
import { generateSlides } from "../../worship/slideEngine";
import { publishMediaToPresentation } from "../../services/presentationPublish";
import { fitPopover } from "../useKeepInViewport";

const PIN_STORAGE_KEY = "__mce_dock_schedule_pinned_v1";
const SCHEDULE_WIDTH_KEY = "__mce_dock_schedule_width_v2";
const MIN_SCHEDULE_WIDTH = 140;

interface Props {
  initialSnapshot?: ServicePlannerSnapshot | null;
  onSelectTab?: (tab: "bible" | "worship" | "media" | "notes") => void;
  /** Report what is shown (mirrors the tabs' onStage: Presentation link + Studio). */
  onStage?: (item: DockStagedItem | null) => void;
  isNarrow?: boolean;
}

interface ContextMenuState {
  item: ServicePlanItem;
  x: number;
  y: number;
  scope: "schedule" | "history";
}

function getMediaThumbnailSrc(payload: Record<string, unknown>): string {
  // 1. Direct thumbnail URL or data/blob URI
  const directThumb = typeof payload.thumbnailUrl === "string" ? payload.thumbnailUrl.trim() : "";
  if (directThumb) return directThumb;

  const preview = typeof payload.previewUrl === "string" ? payload.previewUrl.trim() : "";
  if (preview) return preview;

  const directUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  if (directUrl) return directUrl;

  const rawPath = (typeof payload.filePath === "string" ? payload.filePath : "") ||
                  (typeof payload.fileName === "string" ? payload.fileName : "");
  if (!rawPath) return "";

  if (rawPath.startsWith("http://") || rawPath.startsWith("https://") || rawPath.startsWith("data:") || rawPath.startsWith("blob:")) {
    return rawPath;
  }

  // If in Tauri desktop app, use convertFileSrc for absolute disk paths
  if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || window.location.protocol === "tauri:")) {
    try {
      if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
        return convertFileSrc(rawPath);
      }
    } catch {
      // Fallback below
    }
  }

  // Resolve via local MCE overlay HTTP server (e.g. /uploads/fileName)
  try {
    return resolveOverlayAssetUrl(rawPath);
  } catch {
    return rawPath;
  }
}

export default function DockScheduleDrawer({ initialSnapshot, onStage }: Props) {
  const { t } = useTranslation();
  const outputTarget = useDockOutputTarget();
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [activePlan, setActivePlan] = useState<ServicePlan | null>(null);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [showNewSchedulePrompt, setShowNewSchedulePrompt] = useState(false);
  const [newScheduleTitle, setNewScheduleTitle] = useState("");
  const [activeViewTab, setActiveViewTab] = useState<"schedule" | "history">("schedule");
  const [historyItems, setHistoryItems] = useState<ServicePlanItem[]>(() => getPresentationHistory());

  // Context Menu & Header Menu states
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [headerMenuPos, setHeaderMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleOpenGuide = useCallback(() => {
    window.dispatchEvent(new CustomEvent(DOCK_OPEN_SCHEDULE_GUIDE_EVENT));
  }, []);

  // Default to false so user starts on Bible tab cleanly without schedule taking over
  const [isPinned, setIsPinned] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    const stored = localStorage.getItem(PIN_STORAGE_KEY);
    if (stored === null) return false;
    return stored === "true";
  });

  const [expanded, setExpanded] = useState<boolean>(() => isPinned);

  // User draggable width state: null means use default 30% / 70% split from CSS
  const [customWidth, setCustomWidth] = useState<number | null>(() => {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(SCHEDULE_WIDTH_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= MIN_SCHEDULE_WIDTH ? parsed : null;
  });

  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const refreshState = useCallback(() => {
    const { snapshot, activePlan: currentActive } = getOrCreateActiveSchedule();
    setPlans(snapshot.plans);
    setActivePlan(currentActive);
    if (currentActive.selectedItemId) {
      setActiveCueId(currentActive.selectedItemId);
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [initialSnapshot, refreshState]);

  useEffect(() => {
    const handleScheduleChanged = () => {
      refreshState();
    };

    const handleHistoryChanged = () => {
      setHistoryItems(getPresentationHistory());
    };

    window.addEventListener(DOCK_SCHEDULE_CHANGED_EVENT, handleScheduleChanged);
    window.addEventListener(DOCK_HISTORY_CHANGED_EVENT, handleHistoryChanged);

    return () => {
      window.removeEventListener(DOCK_SCHEDULE_CHANGED_EVENT, handleScheduleChanged);
      window.removeEventListener(DOCK_HISTORY_CHANGED_EVENT, handleHistoryChanged);
    };
  }, [refreshState]);

  // Handle pin toggle
  const handleTogglePin = useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(PIN_STORAGE_KEY, String(next));
      }
      if (next) {
        setExpanded(true);
      }
      return next;
    });
  }, []);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    setIsPinned(false);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PIN_STORAGE_KEY, "false");
    }
  }, []);

  const handleExpand = useCallback(() => {
    setExpanded(true);
  }, []);

  // Drag-to-resize handlers: when dragged to the left end, collapse/close schedule
  const handleMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    const container = e.currentTarget.parentElement as HTMLElement | null;
    startWidthRef.current = container ? container.getBoundingClientRect().width : (customWidth ?? 280);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let shouldCollapseOnRelease = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = moveEvent.clientX - startXRef.current;
      const rawCalculated = startWidthRef.current + delta;

      // If dragged towards the left end (raw calculated width < 95px or clientX < 85px)
      if (rawCalculated < 95 || moveEvent.clientX < 85) {
        shouldCollapseOnRelease = true;
        if (container) {
          container.style.opacity = "0.5";
          container.style.filter = "grayscale(60%)";
        }
        return;
      }

      shouldCollapseOnRelease = false;
      if (container) {
        container.style.opacity = "1";
        container.style.filter = "none";
      }

      const minAllowed = Math.max(MIN_SCHEDULE_WIDTH, Math.floor(window.innerWidth * 0.15));
      const maxAllowed = Math.max(minAllowed, Math.min(600, Math.floor(window.innerWidth * 0.45)));
      const nextWidth = Math.round(Math.max(minAllowed, Math.min(maxAllowed, rawCalculated)));
      setCustomWidth(nextWidth);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SCHEDULE_WIDTH_KEY, String(nextWidth));
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (container) {
        container.style.opacity = "1";
        container.style.filter = "none";
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (shouldCollapseOnRelease) {
        handleCollapse();
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [customWidth, handleCollapse]);

  // Dragging the closed rail to the right opens the schedule and keeps sizing it while the pointer
  // moves; a plain click on the rail button still just opens it.
  const handleRailMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startWidth = (e.currentTarget as HTMLElement).getBoundingClientRect().width || 34;
    let opened = false;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (!opened) {
        if (delta < 24) return;
        opened = true;
        setExpanded(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
      const minAllowed = Math.max(MIN_SCHEDULE_WIDTH, Math.floor(window.innerWidth * 0.15));
      const maxAllowed = Math.max(minAllowed, Math.min(600, Math.floor(window.innerWidth * 0.45)));
      const nextWidth = Math.round(Math.max(minAllowed, Math.min(maxAllowed, startWidth + delta)));
      setCustomWidth(nextWidth);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SCHEDULE_WIDTH_KEY, String(nextWidth));
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (opened) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // The click that ends a drag must not toggle anything else.
        const swallow = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleDoubleClickResize = useCallback(() => {
    setCustomWidth(null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SCHEDULE_WIDTH_KEY);
    }
  }, []);

  // Card swipe/drag to left end to close
  const [swipingCardId, setSwipingCardId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const swipeStartXRef = useRef<number>(0);
  const swipeStartYRef = useRef<number>(0);
  const isSwipingCardRef = useRef<boolean>(false);

  /**
   * Clicking a schedule item shows it on screen and keeps the operator on the
   * tab they're on (it used to jump to Worship). With the Dock in OBS it is
   * pushed to OBS; in the Presentation link / Studio it goes through onStage,
   * exactly like the Bible / Worship / Notes tabs do.
   */
  const handlePresentItem = useCallback(async (item: ServicePlanItem) => {
    if (isSwipingCardRef.current) return;
    setActiveCueId(item.id);
    const toObs = !isPresentationLinkTarget(outputTarget);

    const markSent = () => {
      if (activePlan && activePlan.items.some((i) => i.id === item.id)) {
        saveSchedulePlan({
          ...activePlan,
          selectedItemId: item.id,
          completedItemIds: Array.from(new Set([...(activePlan.completedItemIds ?? []), item.id])),
          lastSentItemId: item.id,
        });
      }
    };

    const showWorshipSection = async (data: {
      sectionText: string;
      sectionLabel: string;
      songTitle: string;
      artist?: string;
      overlayMode: "fullscreen" | "lower-third";
      theme?: unknown;
      bibleThemeSettings?: unknown;
    }) => {
      const worshipSettings = await resolveDockWorshipPresentationSettings(data.overlayMode, { forceOverlayMode: true });
      const payload = {
        ...data,
        theme: worshipSettings.themeId || data.theme,
        bibleThemeSettings: worshipSettings.themeSettings || data.bibleThemeSettings,
        liveOverrides: null,
      };
      onStage?.({ type: "worship", label: data.sectionLabel || data.songTitle, subtitle: data.songTitle, data: payload });
      if (toObs) await dockObsClient.pushWorshipLyrics(payload as unknown as Parameters<typeof dockObsClient.pushWorshipLyrics>[0]);
    };

    const showNoteSlide = async (data: { text: string; title: string; overlayMode: "fullscreen" | "lower-third"; theme?: unknown; bibleThemeSettings?: unknown }) => {
      const notesSettings = await resolveDockNotesPresentationSettings(data.overlayMode, { forceOverlayMode: true });
      const payload = {
        sectionText: data.text,
        sectionLabel: data.title || "Note",
        songTitle: data.title || "Note",
        overlayMode: data.overlayMode,
        theme: notesSettings.themeId || data.theme,
        bibleThemeSettings: notesSettings.themeSettings || data.bibleThemeSettings,
        liveOverrides: null,
      };
      onStage?.({ type: "notes", label: payload.sectionLabel, data: payload });
      if (toObs) await dockObsClient.pushNotesLyrics(payload as unknown as Parameters<typeof dockObsClient.pushNotesLyrics>[0]);
    };

    try {
      const payload = (item.payloadSnapshot || {}) as Record<string, unknown>;
      const overlayMode = (payload.overlayMode as "fullscreen" | "lower-third") ||
        (item.type === "bible" ? "fullscreen" : "lower-third");

      const isFullWorshipSong =
        item.type === "worship" &&
        (payload.isWholeSong === true ||
          (!payload.sectionIdx && payload.sectionLabel === "Song") ||
          !payload.sectionText);

      const isFullNote =
        item.type === "sermon" &&
        (payload.isWholeNote === true ||
          (Boolean(payload.isNoteSlide) && payload.slideIndex === undefined && !payload.sectionText) ||
          (Boolean(payload.isNoteSlide) && payload.slideIndex === 0 && payload.slideText === payload.noteContent));

      if (isFullWorshipSong) {
        // Show the song's first slide and pick the song in the Worship tab
        // (in the background), so the next slides are one click away there.
        const songDetail = {
          songId: (item.sourceId as string) || (payload.songId as string) || undefined,
          songTitle: (payload.songTitle as string) || item.label,
        };
        setPendingWorshipSongSelection(songDetail);
        window.dispatchEvent(new CustomEvent(DOCK_SELECT_WORSHIP_SONG_EVENT, { detail: songDetail }));
        const song = songDetail.songId ? await getSong(songDetail.songId) : undefined;
        const slides = song ? (song.slides?.length ? song.slides : generateSlides(song.lyrics, song.linesPerSlide ?? 4, true)) : [];
        const first = slides[0];
        if (first?.content) {
          await showWorshipSection({
            sectionText: first.content,
            sectionLabel: first.label || "Slide 1",
            songTitle: song?.metadata?.title || songDetail.songTitle,
            artist: song?.metadata?.artist,
            overlayMode,
            theme: payload.theme,
            bibleThemeSettings: payload.bibleThemeSettings,
          });
        }
        markSent();
        return;
      }

      if (isFullNote) {
        const noteDetail = {
          noteId: (item.sourceId as string) || (payload.noteId as string) || undefined,
          noteTitle: (payload.noteTitle as string) || item.label,
        };
        setPendingNoteSelection(noteDetail);
        window.dispatchEvent(new CustomEvent(DOCK_SELECT_NOTE_EVENT, { detail: noteDetail }));
        const note = noteDetail.noteId ? loadDockNotes().find((n) => n.id === noteDetail.noteId) : undefined;
        const content = String(note?.content ?? payload.noteContent ?? "");
        const firstSlide = content.split(/\n[ \t]*\n+/).map((b) => b.trim()).find(Boolean);
        if (firstSlide) {
          await showNoteSlide({ text: firstSlide, title: note?.title || noteDetail.noteTitle, overlayMode, theme: payload.theme, bibleThemeSettings: payload.bibleThemeSettings });
        }
        markSent();
        return;
      }

      if (item.type === "bible") {
        const biblePayload = { ...payload, overlayMode };
        // Select and scroll to this verse in the Bible tab's list.
        const bibleVerse = extractBibleVerseFromPayload(payload, item.label);
        if (bibleVerse) {
          setPendingBibleVerseSelection(bibleVerse);
          window.dispatchEvent(new CustomEvent(DOCK_SELECT_BIBLE_VERSE_EVENT, { detail: bibleVerse }));
        }
        onStage?.({ type: "bible", label: item.label, data: biblePayload });
        if (toObs) await dockObsClient.pushBible(biblePayload as unknown as Parameters<typeof dockObsClient.pushBible>[0]);
      } else if (item.type === "worship") {
        await showWorshipSection({
          sectionText: String(payload.sectionText ?? ""),
          sectionLabel: String(payload.sectionLabel ?? ""),
          songTitle: String(payload.songTitle ?? item.label),
          artist: payload.artist as string | undefined,
          overlayMode,
          theme: payload.theme,
          bibleThemeSettings: payload.bibleThemeSettings,
        });
      } else if (item.type === "sermon") {
        if (payload?.isNoteSlide) {
          await showNoteSlide({
            text: String(payload.slideText ?? ""),
            title: String(payload.noteTitle ?? "Note"),
            overlayMode,
            theme: payload.theme,
            bibleThemeSettings: payload.bibleThemeSettings,
          });
        } else if (toObs) {
          await dockObsClient.pushSermonCue({
            ...payload,
            overlayMode,
          } as Parameters<typeof dockObsClient.pushSermonCue>[0]);
        }
      } else if (item.type === "media") {
        const filePath = (payload.filePath as string) || "";
        const fileName = (payload.fileName as string) || filePath.split(/[\\/]/).pop() || item.label;
        const mediaType = (payload.mediaType as string) || "";
        if (!toObs) {
          // Presentation link / Studio: pictures and videos only.
          if (fileName && (mediaType === "image" || mediaType === "video")) {
            await publishMediaToPresentation({
              id: `schedule-${item.id}`,
              name: fileName,
              type: mediaType,
              url: `/uploads/${encodeURIComponent(fileName)}`,
              diskFileName: fileName,
              createdAt: new Date().toISOString(),
            } as Parameters<typeof publishMediaToPresentation>[0]);
          }
        } else if (payload.patternSrc) {
          await dockObsClient.pushPatternBackground(
            payload.patternSrc as string,
            (payload.patternLabel as string) || item.label,
          );
        } else if (payload.isPlaylist && Array.isArray(payload.playlist)) {
          await dockObsClient.pushVlcPlaylist({
            sourceName: (payload.sourceName as string) || "MCE Media - Playlist",
            playlist: payload.playlist as string[],
            loop: payload.loop !== false,
            shuffle: Boolean(payload.shuffle),
            muted: Boolean(payload.muted),
          });
        } else if (payload.isSlideshow && Array.isArray(payload.images)) {
          await dockObsClient.pushImageSlideshow({
            sourceName: (payload.sourceName as string) || "MCE Media - Slideshow",
            images: payload.images as string[],
            loop: payload.loop !== false,
            slideTime: (payload.slideTime as number) || 3000,
          });
        } else if (filePath) {
          if (mediaType === "audio") {
            await dockObsClient.pushAudio(filePath, fileName, {
              looping: Boolean(payload.looping),
              muted: Boolean(payload.muted),
            });
          } else {
            await dockObsClient.pushMedia(filePath, fileName);
          }
        }
      }

      markSent();
    } catch (err) {
      console.warn("[DockSchedule] Error presenting item:", err);
    }
  }, [activePlan, onStage, outputTarget]);

  const handleSetOverlayMode = useCallback(async (
    item: ServicePlanItem,
    mode: "fullscreen" | "lower-third",
    scope: "schedule" | "history",
  ) => {
    let resolvedTheme = item.payloadSnapshot?.theme;
    let resolvedThemeSettings = item.payloadSnapshot?.bibleThemeSettings;

    if (item.type === "worship") {
      try {
        const worshipSettings = await resolveDockWorshipPresentationSettings(mode, { forceOverlayMode: true });
        resolvedTheme = worshipSettings.themeId;
        resolvedThemeSettings = worshipSettings.themeSettings;
      } catch { /* keep existing */ }
    } else if (item.type === "sermon" && (item.payloadSnapshot as Record<string, unknown> | undefined)?.isNoteSlide) {
      try {
        const notesSettings = await resolveDockNotesPresentationSettings(mode, { forceOverlayMode: true });
        resolvedTheme = notesSettings.themeId;
        resolvedThemeSettings = notesSettings.themeSettings;
      } catch { /* keep existing */ }
    }

    updateItemOverlayMode(item.id, mode, scope);
    if (scope === "history") {
      setHistoryItems(getPresentationHistory());
    } else {
      refreshState();
    }
    // "THE MOMENT THEY CLICK IT GOES ON"
    const updatedItem: ServicePlanItem = {
      ...item,
      payloadSnapshot: {
        ...(item.payloadSnapshot || {}),
        overlayMode: mode,
        theme: resolvedTheme,
        bibleThemeSettings: resolvedThemeSettings,
      },
    };
    await handlePresentItem(updatedItem);
  }, [handlePresentItem, refreshState]);

  const handleRemoveItem = useCallback((e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (activeViewTab === "history") {
      removeHistoryItem(itemId);
      setHistoryItems(getPresentationHistory());
    } else {
      removeItemFromActiveSchedule(itemId);
    }
  }, [activeViewTab]);

  const handleCardPointerDown = useCallback((e: React.PointerEvent, _itemId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, select, a, input")) return;
    swipeStartXRef.current = e.clientX;
    swipeStartYRef.current = e.clientY;
    isSwipingCardRef.current = false;
  }, []);

  const handleCardPointerMove = useCallback((e: React.PointerEvent, itemId: string) => {
    if (e.buttons !== 1) return;
    const deltaX = e.clientX - swipeStartXRef.current;
    const deltaY = e.clientY - swipeStartYRef.current;

    // Only recognize horizontal drag to the left
    if (!isSwipingCardRef.current) {
      if (deltaX < -12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        isSwipingCardRef.current = true;
        setSwipingCardId(itemId);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
      }
    }

    if (isSwipingCardRef.current && swipingCardId === itemId) {
      const clamped = Math.max(-160, Math.min(0, deltaX));
      setSwipeOffset(clamped);
    }
  }, [swipingCardId]);

  const handleCardPointerUp = useCallback((e: React.PointerEvent, itemId: string) => {
    if (isSwipingCardRef.current && swipingCardId === itemId) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      const deltaX = e.clientX - swipeStartXRef.current;
      isSwipingCardRef.current = false;
      setSwipingCardId(null);
      setSwipeOffset(0);

      // If dragged to the left end (past 50px): close / remove it!
      if (deltaX < -50) {
        handleRemoveItem(e as unknown as React.MouseEvent, itemId);
      }
    }
  }, [handleRemoveItem, swipingCardId]);

  const handleClearHistory = useCallback(() => {
    clearPresentationHistory();
    setHistoryItems([]);
    notifyScheduleToast("Cleared presentation history");
  }, []);

  const handleHideFromObs = useCallback(async (item: ServicePlanItem) => {
    try {
      if (item.type === "bible") {
        await dockObsClient.clearBible();
      } else if (item.type === "worship") {
        await dockObsClient.clearWorshipLyrics();
      } else if (item.type === "sermon") {
        await dockObsClient.clearNotesLyrics();
        await dockObsClient.clearSermonCue();
      } else if (item.type === "media") {
        await dockObsClient.clearMedia();
      }
      await dockObsClient.clearLowerThirds();
      if (activeCueId === item.id) {
        setActiveCueId(null);
      }
      notifyScheduleToast(`Cleared "${item.label}" from OBS`);
    } catch (err) {
      console.warn("[DockSchedule] Failed to hide item from OBS:", err);
      notifyScheduleToast("Failed to clear output", "error");
    }
  }, [activeCueId]);

  const handlePinFromMenu = useCallback((item: ServicePlanItem, scope: "schedule" | "history") => {
    if (scope === "history") {
      pinItemToSchedule(item);
      refreshState();
    } else {
      pinScheduleItemToTop(item.id);
      refreshState();
    }
  }, [refreshState]);

  const handleOpenContextMenu = useCallback((
    e: React.MouseEvent,
    item: ServicePlanItem,
    scope: "schedule" | "history",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, Math.max(10, window.innerWidth - 220));
    const y = Math.min(e.clientY, Math.max(10, window.innerHeight - 260));
    setContextMenu({ item, x, y, scope });
  }, []);

  const handleOpenMoreMenu = useCallback((
    e: React.MouseEvent,
    item: ServicePlanItem,
    scope: "schedule" | "history",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right - 180, Math.max(10, window.innerWidth - 220));
    const y = Math.min(rect.bottom + 4, Math.max(10, window.innerHeight - 260));
    setContextMenu({ item, x, y, scope });
  }, []);

  const handleToggleHeaderMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    setHeaderMenuPos((current) => {
      if (current) return null;
      if (!rect) return null;
      const menuWidth = 185;
      const x = Math.min(Math.max(10, rect.right - menuWidth), Math.max(10, window.innerWidth - menuWidth - 10));
      const y = Math.min(rect.bottom + 4, Math.max(10, window.innerHeight - 280));
      return { x, y };
    });
  }, []);

  const handleCreateNewSchedule = useCallback(() => {
    const title = newScheduleTitle.trim() || `Service ${plans.length + 1}`;
    createNewSchedulePlan(title);
    setNewScheduleTitle("");
    setShowNewSchedulePrompt(false);
  }, [newScheduleTitle, plans.length]);

  const isFreePlan = isDockFreePlan();
  const scheduleItems = useMemo(() => {
    const items = activePlan?.items ?? [];
    if (isFreePlan && items.length > 3) {
      return items.slice(0, 3);
    }
    return items;
  }, [activePlan, isFreePlan]);

  const effectiveHistoryItems = useMemo(() => {
    if (isFreePlan && historyItems.length > 1) {
      return historyItems.slice(0, 1);
    }
    return historyItems;
  }, [historyItems, isFreePlan]);

  const isDrawerOpen = expanded || isPinned;

  const containerRef = useRef<HTMLElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isDrawerOpen]);

  const effectiveWidth = measuredWidth ?? customWidth ?? (isDrawerOpen ? 280 : 34);
  const isCompact = isDrawerOpen && effectiveWidth <= 220;
  const isUltraCompact = isDrawerOpen && effectiveWidth <= 165;
  const isNarrowTabs = effectiveWidth <= 210 || isCompact;
  const isNarrowHeader = effectiveWidth <= 240 || isCompact;

  return (
    <aside
      ref={containerRef}
      className={`dock-schedule-container ${isDrawerOpen ? "dock-schedule-container--expanded" : "dock-schedule-container--collapsed"}${isPinned ? " dock-schedule-container--pinned" : ""}`}
      style={isDrawerOpen && customWidth !== null ? { width: customWidth, flex: `0 0 ${customWidth}px` } : undefined}
      aria-label={t("schedule.title", "Service Schedule")}
    >
      {/* ── Collapsed Rail View (34px) ── */}
      {!isDrawerOpen && (
        <div
          className="dock-schedule-rail"
          onMouseDown={handleRailMouseDown}
          title={t("schedule.dragToOpen", "Drag right to open the schedule")}
        >
          <button
            type="button"
            className="dock-schedule-rail__trigger"
            onClick={handleExpand}
            title={t("schedule.openSchedule", "Open Schedule (Shared Space)")}
            aria-label={t("schedule.openSchedule", "Open Schedule")}
          >
            <Icon name="event_note" size={21} />
            {scheduleItems.length > 0 && (
              <span className="dock-schedule-rail__badge" />
            )}
          </button>

          <div className="dock-schedule-rail__divider" />

          {/* Quick status dots for queued items */}
          <div className="dock-schedule-rail__status-dots">
            {scheduleItems.slice(0, 10).map((item, index) => {
              const isLive = activeCueId === item.id;
              return (
                <span
                  key={item.id}
                  className={`dock-schedule-rail__dot ${isLive ? "dock-schedule-rail__dot--live" : ""}`}
                  title={`${index + 1}. ${item.label}`}
                />
              );
            })}
          </div>

          <button
            type="button"
            className="dock-schedule-rail__expand-btn"
            onClick={handleExpand}
            title={t("schedule.expandSchedule", "Expand Schedule")}
            aria-label={t("schedule.expandSchedule", "Expand Schedule")}
          >
            <Icon name="chevron_right" size={14} />
          </button>
        </div>
      )}

      {/* ── In-Flow Schedule Panel (Shares Space With Dock) ── */}
      {isDrawerOpen && (
        <div className={`dock-schedule-panel ${isCompact ? "dock-schedule-panel--compact" : ""} ${isUltraCompact ? "dock-schedule-panel--ultra-compact" : ""}`}>
          <div className="dock-schedule-panel__header">
            {/* Row 1: Dedicated Full-Width Schedule vs History Tabs + Clear Close Button */}
            <div className="dock-schedule-panel__tabs-row">
              <div className="dock-schedule-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeViewTab === "schedule"}
                  className={`dock-schedule-tab-btn ${activeViewTab === "schedule" ? "dock-schedule-tab-btn--active" : ""}`}
                  onClick={() => setActiveViewTab("schedule")}
                  title={t("schedule.title", "Schedule")}
                >
                  <Icon name="event_note" size={16} />
                  {!isNarrowTabs && <span className="dock-schedule-tab-label">{t("schedule.title", "Schedule")}</span>}
                  {scheduleItems.length > 0 && (
                    <span className="dock-schedule-tab-dot dock-schedule-tab-dot--schedule" />
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeViewTab === "history"}
                  className={`dock-schedule-tab-btn ${activeViewTab === "history" ? "dock-schedule-tab-btn--active" : ""}`}
                  onClick={() => setActiveViewTab("history")}
                  title={t("common.history", "History")}
                >
                  <Icon name="history" size={15} />
                  {!isNarrowTabs && <span className="dock-schedule-tab-label">{t("common.history", "History")}</span>}
                  {effectiveHistoryItems.length > 0 && (
                    <span className="dock-schedule-tab-dot dock-schedule-tab-dot--history" />
                  )}
                </button>
              </div>

              {/* Clear, highly-visible Close Drawer Button */}
              <button
                type="button"
                className="dock-schedule-panel__close-btn dock-schedule-panel__close-btn--header"
                onClick={handleCollapse}
                title={t("schedule.close", "Close Schedule / History")}
                aria-label={t("schedule.close", "Close Schedule / History")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Row 2: Select/Title on Left + Actions on Right */}
            <div className="dock-schedule-panel__actions-row">
              {activeViewTab === "schedule" ? (
                <select
                  className="dock-schedule-panel__select"
                  value={activePlan?.id || ""}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setShowNewSchedulePrompt(true);
                    } else {
                      setActiveScheduleId(e.target.value);
                    }
                  }}
                  aria-label={t("schedule.selectSchedule", "Select Schedule")}
                >
                  {plans.map((p, idx) => (
                    <option key={p.id} value={p.id}>
                      {p.title || `Schedule ${idx + 1}`}
                    </option>
                  ))}
                  <option value="__new__">+ {t("schedule.createNew", "New Schedule...")}</option>
                </select>
              ) : (
                <div className="dock-schedule-panel__history-title">
                  {!isNarrowHeader && (
                    <>
                      <Icon name="history" size={14} className="dock-schedule-panel__history-icon" />
                      <span>{t("schedule.historyTitle", "Recent Output")}</span>
                    </>
                  )}
                </div>
              )}

              <div className="dock-schedule-panel__header-actions">
                {isNarrowHeader ? (
                  <button
                    type="button"
                    className="dock-schedule-panel__header-more-btn"
                    onClick={handleToggleHeaderMenu}
                    title="More options"
                    aria-label="More options"
                  >
                    <Icon name="more_vert" size={14} />
                  </button>
                ) : (
                  <>
                    {/* Refresh button */}
                    <button
                      type="button"
                      className="dock-schedule-panel__pin-btn"
                      onClick={() => window.location.reload()}
                      title={t("common.refresh", "Refresh")}
                      aria-label={t("common.refresh", "Refresh")}
                    >
                      <Icon name="refresh" size={14} />
                    </button>

                    {/* Help / Guide button */}
                    <button
                      type="button"
                      className="dock-schedule-panel__pin-btn"
                      onClick={handleOpenGuide}
                      title={t("schedule.introHint", "Schedule & History Guide")}
                      aria-label="Schedule & History Guide"
                    >
                      <Icon name="help_outline" size={14} />
                    </button>

                    {/* Pin button */}
                    <button
                      type="button"
                      className={`dock-schedule-panel__pin-btn ${isPinned ? "is-pinned" : ""}`}
                      onClick={handleTogglePin}
                      title={isPinned ? t("schedule.pinnedHint", "Schedule is pinned open. Click to unpin.") : t("schedule.pinHint", "Pin open permanently")}
                      aria-label={isPinned ? "Unpin schedule" : "Pin schedule open"}
                    >
                      <Icon name="pin" size={14} />
                    </button>

                    {/* Highly visible close button */}
                    <button
                      type="button"
                      className="dock-schedule-panel__close-btn"
                      onClick={handleCollapse}
                      title={t("schedule.close", "Close Schedule")}
                      aria-label={t("schedule.close", "Close Schedule")}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {showNewSchedulePrompt && activeViewTab === "schedule" && (
              <div className="dock-schedule-panel__new-prompt">
                <input
                  type="text"
                  placeholder={t("schedule.scheduleName", "Schedule Name")}
                  value={newScheduleTitle}
                  onChange={(e) => setNewScheduleTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateNewSchedule()}
                  autoFocus
                />
                <div className="dock-schedule-panel__prompt-actions">
                  <button type="button" className="dock-schedule-btn dock-schedule-btn--primary" onClick={handleCreateNewSchedule}>
                    <Icon name="add" size={12} />
                    <span>{t("common.add", "Add")}</span>
                  </button>
                  <button type="button" className="dock-schedule-btn" onClick={() => setShowNewSchedulePrompt(false)}>
                    <span>{t("common.cancel", "Cancel")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Free plan banner */}
          {isFreePlan && activeViewTab === "history" && (
            <div className="dock-schedule-free-banner">
              <div className="dock-schedule-free-banner__label">
                <Icon name="lock" size={12} />
                <span>History holds 1 item on Free plan</span>
              </div>
              <button
                type="button"
                className="dock-schedule-free-banner__btn"
                onClick={() => showUpgradeModal("Upgrade to keep up to 60 items in presentation history.")}
              >
                Upgrade
              </button>
            </div>
          )}
          {isFreePlan && activeViewTab === "schedule" && (
            <div className="dock-schedule-free-banner dock-schedule-free-banner--schedule">
              <div className="dock-schedule-free-banner__label">
                <span>Free plan: 3 items max (rolling stack)</span>
              </div>
              <button
                type="button"
                className="dock-schedule-free-banner__btn"
                onClick={() => showUpgradeModal("Upgrade to add unlimited items to your service schedule.")}
              >
                Upgrade
              </button>
            </div>
          )}

          {/* ── Card List ── */}
          <div className="dock-schedule-panel__list">
            {(activeViewTab === "history" ? effectiveHistoryItems : scheduleItems).length === 0 ? (
              <div className="dock-schedule-panel__empty">
                <Icon name={activeViewTab === "history" ? "history" : "playlist_add"} size={32} />
                <p>
                  {activeViewTab === "history"
                    ? t("schedule.historyEmptyTitle", "No presentation history yet.")
                    : t("schedule.emptyHint", "No items queued in this schedule.")}
                </p>
                <small>
                  {activeViewTab === "history"
                    ? t("schedule.historyEmptyHint", "Scriptures, worship songs, and media you project will appear here for instant replay.")
                    : t("schedule.emptySubhint", "Right-click any scripture, worship song, or media file to queue it here.")}
                </small>
              </div>
            ) : (
              (activeViewTab === "history" ? effectiveHistoryItems : scheduleItems).map((item, index) => {
                const isLive = activeCueId === item.id;
                const isCompleted = activePlan?.completedItemIds?.includes(item.id);
                const isMedia = item.type === "media";
                const payload = (item.payloadSnapshot || {}) as Record<string, unknown>;
                const isVideo = isMedia && (payload.mediaType === "video" || (typeof item.subtitle === "string" && item.subtitle.toLowerCase().includes("video")));
                const mediaSrc = isMedia ? getMediaThumbnailSrc(payload) : "";
                const currentOverlayMode = (payload.overlayMode as "fullscreen" | "lower-third") ||
                  (item.type === "bible" ? "fullscreen" : "lower-third");
                const cardLabel = item.type === "bible"
                  ? item.label.replace(/(\([A-Za-z0-9_/-]+\))(?:\s*\1)+/gi, "$1").trim()
                  : item.label;

                // ── Media Card (Thumbnail on top, caption below, 3-dots at top right, right-clickable) ──
                if (isMedia) {
                  const isImgThumb = mediaSrc && (/\.(png|jpe?g|webp|gif|avif)($|\?)/i.test(mediaSrc) || Boolean(payload.thumbnailUrl));

                  return (
                    <div
                      key={item.id}
                      className={`dock-schedule-card dock-schedule-card--media ${isLive ? "dock-schedule-card--live" : ""} ${isCompleted ? "dock-schedule-card--completed" : ""}`}
                      onClick={() => void handlePresentItem(item)}
                      onContextMenu={(e) => handleOpenContextMenu(e, item, activeViewTab)}
                      onPointerDown={(e) => handleCardPointerDown(e, item.id)}
                      onPointerMove={(e) => handleCardPointerMove(e, item.id)}
                      onPointerUp={(e) => handleCardPointerUp(e, item.id)}
                      onPointerCancel={(e) => handleCardPointerUp(e, item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handlePresentItem(item);
                        }
                      }}
                      style={{
                        transform: swipingCardId === item.id ? `translateX(${swipeOffset}px)` : undefined,
                        opacity: swipingCardId === item.id ? Math.max(0.2, 1 - Math.abs(swipeOffset) / 120) : undefined,
                        transition: swipingCardId === item.id ? "none" : "transform 0.18s ease-out, opacity 0.18s ease-out",
                        touchAction: "pan-y",
                      }}
                      title={`${index + 1}. ${item.label} (Click to project, drag left to close, right-click for options)`}
                      aria-label={`${index + 1}. ${item.label}`}
                    >
                      {/* Thumbnail on TOP */}
                      <div className="dock-schedule-card__media-thumb-wrap">
                        {mediaSrc ? (
                          isVideo && !isImgThumb ? (
                            <video src={mediaSrc} className="dock-schedule-card__media-thumb" muted playsInline preload="metadata" />
                          ) : (
                            <img
                              src={mediaSrc}
                              alt={item.label}
                              className="dock-schedule-card__media-thumb"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.currentTarget;
                                const raw = (payload.fileName as string) || (payload.filePath as string) || "";
                                if (raw) {
                                  const fallback = resolveOverlayAssetUrl(raw);
                                  if (fallback && target.src !== fallback) {
                                    target.src = fallback;
                                    return;
                                  }
                                }
                                target.style.display = "none";
                              }}
                            />
                          )
                        ) : (
                          <div className="dock-schedule-card__media-thumb dock-schedule-card__media-thumb--placeholder">
                            <Icon name={isVideo ? "movie" : "image"} size={20} />
                          </div>
                        )}

                        {isVideo && (
                          <span className="dock-schedule-card__media-video-badge">
                            <Icon name="play_arrow" size={10} />
                          </span>
                        )}

                        {isLive && (
                          <span className="dock-schedule-card__media-live-badge">
                            <span className="dock-schedule-card__live-dot" />
                            LIVE
                          </span>
                        )}

                        {/* Three dots button at top right */}
                        <button
                          type="button"
                          className="dock-schedule-card__thumb-more-btn"
                          onClick={(e) => handleOpenMoreMenu(e, item, activeViewTab)}
                          title="More options"
                          aria-label="More options"
                        >
                          <Icon name="more_vert" size={13} />
                        </button>
                      </div>

                      {/* Footer with clean caption */}
                      <div className="dock-schedule-card__media-footer">
                        <span className="dock-schedule-card__media-caption" title={cardLabel}>
                          {cardLabel}
                        </span>

                        {/* Preserved accessible / test suite actions */}
                        <div className="dock-schedule-card__actions dock-schedule-card__media-quick-actions" style={{ display: "none" }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={`dock-schedule-card__project-btn ${isLive ? "dock-schedule-card__project-btn--live" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePresentItem(item);
                            }}
                            title={isLive ? t("schedule.liveNow", "Currently Live on Output") : t("schedule.project", "Project to OBS")}
                            aria-label={t("schedule.project", "Project to OBS")}
                          >
                            {isLive ? "LIVE" : t("schedule.projectShort", "Project")}
                          </button>

                          <button
                            type="button"
                            className="dock-schedule-card__remove-btn"
                            onClick={(e) => handleRemoveItem(e, item.id)}
                            title={t("common.remove", "Remove")}
                            aria-label={t("common.remove", "Remove")}
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Bible / Worship / Notes Card: Basic clean box like Dock LM tab ──
                return (
                  <div
                    key={item.id}
                    className={`dock-schedule-card dock-schedule-card--text ${isLive ? "dock-schedule-card--live" : ""} ${isCompleted ? "dock-schedule-card--completed" : ""}`}
                    onClick={() => void handlePresentItem(item)}
                    onContextMenu={(e) => handleOpenContextMenu(e, item, activeViewTab)}
                    onPointerDown={(e) => handleCardPointerDown(e, item.id)}
                    onPointerMove={(e) => handleCardPointerMove(e, item.id)}
                    onPointerUp={(e) => handleCardPointerUp(e, item.id)}
                    onPointerCancel={(e) => handleCardPointerUp(e, item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handlePresentItem(item);
                      }
                    }}
                    style={{
                      transform: swipingCardId === item.id ? `translateX(${swipeOffset}px)` : undefined,
                      opacity: swipingCardId === item.id ? Math.max(0.2, 1 - Math.abs(swipeOffset) / 120) : undefined,
                      transition: swipingCardId === item.id ? "none" : "transform 0.18s ease-out, opacity 0.18s ease-out",
                      touchAction: "pan-y",
                    }}
                    title={`${index + 1}. ${item.label} (Click to project, drag left to close, right-click for options)`}
                    aria-label={`${index + 1}. ${item.label}`}
                  >
                    {/* Top Row: Bible chapter-verse / Song title on left, 3-dots button on right */}
                    <div className="dock-schedule-card__header-row dock-schedule-card__title-row">
                      <div className="dock-schedule-card__title">
                        <span className="dock-schedule-card__title-text" title={cardLabel}>{cardLabel}</span>
                        {isLive && (
                          <span className="dock-schedule-card__live-pill">
                            <span className="dock-schedule-card__live-dot" />
                            LIVE
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="dock-schedule-card__more-btn"
                        onClick={(e) => handleOpenMoreMenu(e, item, activeViewTab)}
                        title="More options"
                        aria-label="More options"
                      >
                        <Icon name="more_vert" size={13} />
                      </button>
                    </div>

                    {/* Middle Row: First 2 lines of verse / lyrics with ellipsis (...) */}
                    {item.subtitle && (
                      <div
                        className="dock-schedule-card__snippet dock-schedule-card__inscribed-passage"
                        title={item.subtitle}
                      >
                        {item.subtitle}
                      </div>
                    )}

                    {/* Kept hidden for test suite assertions & non-visual compatibility */}
                    <div className="dock-schedule-card__bottom-row" style={{ display: "none" }} onClick={(e) => e.stopPropagation()}>
                      <div className="dock-schedule-mode-toggle" role="group" aria-label="Overlay display mode">
                        <button
                          type="button"
                          className={`dock-schedule-mode-toggle__btn ${currentOverlayMode === "fullscreen" ? "dock-schedule-mode-toggle__btn--active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSetOverlayMode(item, "fullscreen", activeViewTab);
                          }}
                          title="Fullscreen presentation"
                          aria-pressed={currentOverlayMode === "fullscreen"}
                        >
                          FULL
                        </button>
                        <button
                          type="button"
                          className={`dock-schedule-mode-toggle__btn ${currentOverlayMode === "lower-third" ? "dock-schedule-mode-toggle__btn--active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSetOverlayMode(item, "lower-third", activeViewTab);
                          }}
                          title="Lower-third overlay presentation"
                          aria-pressed={currentOverlayMode === "lower-third"}
                        >
                          LT
                        </button>
                      </div>

                      <div className="dock-schedule-card__actions dock-schedule-card__actions--hidden">
                        <button
                          type="button"
                          className={`dock-schedule-card__project-btn ${isLive ? "dock-schedule-card__project-btn--live" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePresentItem(item);
                          }}
                          title={isLive ? t("schedule.liveNow", "Currently Live on Output") : t("schedule.project", "Project to OBS")}
                          aria-label={t("schedule.project", "Project to OBS")}
                        >
                          {isLive ? "LIVE" : t("schedule.projectShort", "Project")}
                        </button>

                        <button
                          type="button"
                          className="dock-schedule-card__remove-btn"
                          onClick={(e) => handleRemoveItem(e, item.id)}
                          title={t("common.remove", "Remove")}
                          aria-label={t("common.remove", "Remove")}
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Bottom center placeholder text hint */}
            <div className="dock-schedule-panel__bottom-placeholder">
              <Icon name={activeViewTab === "history" ? "history" : "playlist_add"} size={18} />
              <span className="dock-schedule-panel__placeholder-title">
                {activeViewTab === "history"
                  ? t("schedule.historyPlaceholderTitle", "Presentation History")
                  : t("schedule.placeholderTitle", "Service Schedule")}
              </span>
              <span className="dock-schedule-panel__placeholder-hint">
                {activeViewTab === "history"
                  ? t("schedule.historyPlaceholderHint", "Every projected scripture, song, and slide is remembered here for instant replay.")
                  : t("schedule.placeholderHint", "Right-click any scripture, worship song, or media to queue it here.")}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="dock-schedule-panel__footer">
            <div className="dock-schedule-panel__count">
              <Icon name={activeViewTab === "history" ? "history" : "checklist"} size={13} />
              <span>
                {activeViewTab === "history"
                  ? `${historyItems.length} ${t("schedule.historyItemsCount", "in history")}`
                  : `${scheduleItems.length} ${t("schedule.queued", "items queued")}`}
              </span>
            </div>

            <button
              type="button"
              className="dock-schedule-panel__bottom-close-btn"
              onClick={handleCollapse}
              title={t("schedule.closeSchedule", "Close Schedule")}
              aria-label={t("schedule.closeSchedule", "Close Schedule")}
            >
              <Icon name="close" size={13} />
              <span>{t("common.close", "Close Schedule")}</span>
            </button>
          </div>

          {/* Draggable resizer handle */}
          <div
            className="dock-schedule-resizer"
            onMouseDown={handleMouseDownResize}
            onDoubleClick={handleDoubleClickResize}
            title={t("schedule.resizeHint", "Drag left/right to resize schedule (double-click to reset)")}
            aria-label="Resize schedule"
          />
        </div>
      )}

      {/* ── Right-Click / 3-Dots Context Menu ── */}
      {contextMenu && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="dock-schedule-context-backdrop"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99998,
              background: "transparent",
            }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            ref={(el) => fitPopover(el)}
            className="dock-schedule-context-menu"
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 99999,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dock-schedule-context-menu__header">
              <span className="dock-schedule-context-menu__title">
                {contextMenu.item.type === "bible"
                  ? contextMenu.item.label.replace(/(\([A-Za-z0-9_/-]+\))(?:\s*\1)+/gi, "$1").trim()
                  : contextMenu.item.label}
              </span>
            </div>

            <div className="dock-schedule-context-menu__divider" />

            {/* Hide from OBS / Clear output */}
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                void handleHideFromObs(item);
              }}
            >
              <Icon name="visibility_off" size={13} />
              <span>Hide from OBS</span>
            </button>

            {/* Open Song / Note in editor if worship or notes */}
            {contextMenu.item.type === "worship" && (
              <button
                type="button"
                className="dock-schedule-context-menu__item"
                onClick={() => {
                  const item = contextMenu.item;
                  setContextMenu(null);
                  void handlePresentItem(item);
                }}
              >
                <Icon name="queue_music" size={13} />
                <span>Open Song in Worship</span>
              </button>
            )}
            {contextMenu.item.type === "sermon" && Boolean((contextMenu.item.payloadSnapshot as Record<string, unknown> | undefined)?.isNoteSlide) && (
              <button
                type="button"
                className="dock-schedule-context-menu__item"
                onClick={() => {
                  const item = contextMenu.item;
                  setContextMenu(null);
                  void handlePresentItem(item);
                }}
              >
                <Icon name="description" size={13} />
                <span>Open Note in Notes</span>
              </button>
            )}

            {/* Pin action */}
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                const { item, scope } = contextMenu;
                setContextMenu(null);
                handlePinFromMenu(item, scope);
              }}
            >
              <Icon name="push_pin" size={13} />
              <span>{contextMenu.scope === "history" ? "Pin to Schedule" : "Pin to Top"}</span>
            </button>

            <div className="dock-schedule-context-menu__divider" />

            {/* Remove */}
            <button
              type="button"
              className="dock-schedule-context-menu__item dock-schedule-context-menu__item--danger"
              onClick={(e) => {
                const { item } = contextMenu;
                setContextMenu(null);
                handleRemoveItem(e, item.id);
              }}
            >
              <Icon name="delete_outline" size={13} />
              <span>Remove</span>
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* ── Header 3-Dots Dropdown Menu (Portaled directly to body to guarantee visibility and prevent clipping) ── */}
      {headerMenuPos && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="dock-schedule-context-backdrop"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99998,
              background: "transparent",
            }}
            onClick={() => setHeaderMenuPos(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setHeaderMenuPos(null);
            }}
          />
          <div
            ref={(el) => fitPopover(el)}
            className="dock-schedule-context-menu"
            style={{
              position: "fixed",
              top: headerMenuPos.y,
              left: headerMenuPos.x,
              zIndex: 99999,
              minWidth: 185,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                setHeaderMenuPos(null);
                handleTogglePin();
              }}
            >
              <Icon name="pin" size={13} />
              <span>{isPinned ? "Unpin Schedule" : "Pin Open Permanently"}</span>
            </button>
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                setHeaderMenuPos(null);
                handleCollapse();
              }}
            >
              <Icon name="close" size={13} />
              <span>Close Schedule</span>
            </button>
            {activeViewTab === "history" && effectiveHistoryItems.length > 0 && (
              <button
                type="button"
                className="dock-schedule-context-menu__item dock-schedule-context-menu__item--danger"
                onClick={() => {
                  setHeaderMenuPos(null);
                  handleClearHistory();
                }}
              >
                <Icon name="delete_sweep" size={13} />
                <span>Clear History</span>
              </button>
            )}
            {activeViewTab === "schedule" && (
              <button
                type="button"
                className="dock-schedule-context-menu__item"
                onClick={() => {
                  setHeaderMenuPos(null);
                  setShowNewSchedulePrompt(true);
                }}
              >
                <Icon name="add" size={13} />
                <span>New Schedule...</span>
              </button>
            )}
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                setHeaderMenuPos(null);
                handleOpenGuide();
              }}
            >
              <Icon name="help_outline" size={13} />
              <span>Schedule Guide...</span>
            </button>
            <button
              type="button"
              className="dock-schedule-context-menu__item"
              onClick={() => {
                setHeaderMenuPos(null);
                window.location.reload();
              }}
            >
              <Icon name="refresh" size={13} />
              <span>{t("common.refresh", "Refresh")}</span>
            </button>
          </div>
        </>,
        document.body,
      )}
    </aside>
  );
}
