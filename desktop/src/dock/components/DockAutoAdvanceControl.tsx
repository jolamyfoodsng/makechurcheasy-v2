import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import {
  readNativeDockSetting,
  writeNativeDockSetting,
} from "../../services/localDockSettings";
import { fitPopover } from "../useKeepInViewport";

export interface DockAutoAdvanceItem {
  id: string;
  label: string;
}

type AutoAdvanceStatus = "idle" | "running" | "paused" | "completed";
type AutoAdvanceStartFrom = "current" | "first";
type AutoAdvanceEndBehavior = "stop" | "loop";
type AutoAdvanceItemKind = "song" | "note";
type AutoAdvanceStorageScope = "worship" | "notes";

export interface DockAutoAdvanceTransition {
  handled: boolean;
  nextIndex?: number;
}

export type DockAutoAdvanceHandler = (
  currentIndex: number,
  defaultNextIndex: number | null,
) => DockAutoAdvanceTransition | void;

interface DockAutoAdvanceSettings {
  durationMinutes: number;
  intervalSeconds: number;
  startFrom: AutoAdvanceStartFrom;
  endBehavior: AutoAdvanceEndBehavior;
}

interface DockAutoAdvanceControlProps {
  items: readonly DockAutoAdvanceItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClose?: () => void;
  onAdvance?: DockAutoAdvanceHandler;
  onStart?: (startIndex: number) => void;
  onActiveChange?: (active: boolean) => void;
  itemKind: AutoAdvanceItemKind;
  storageScope: AutoAdvanceStorageScope;
  compactLabel?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export interface DockAutoAdvanceViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockAutoAdvancePopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** Keep the auto-advance panel inside the visible Dock viewport. */
export function getAutoAdvancePopoverPosition(
  triggerRect: Pick<DOMRect, "top" | "right" | "bottom">,
  viewport: DockAutoAdvanceViewport,
  popoverHeight: number,
  measuredPopoverWidth?: number,
): DockAutoAdvancePopoverPosition {
  const viewportPadding = 8;
  const gap = 8;
  const maxWidth = 330;
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const availableWidth = Math.max(0, viewportWidth - (viewportPadding * 2));
  const width = Math.min(
    maxWidth,
    availableWidth,
    Number.isFinite(measuredPopoverWidth) && measuredPopoverWidth && measuredPopoverWidth > 0
      ? measuredPopoverWidth
      : maxWidth,
  );
  const maxViewportHeight = Math.max(0, viewportHeight - (viewportPadding * 2));
  const minimumPanelHeight = Math.min(120, maxViewportHeight);
  const naturalHeight = Math.min(
    Math.max(Number.isFinite(popoverHeight) && popoverHeight > 0 ? popoverHeight : 420, minimumPanelHeight),
    maxViewportHeight,
  );
  const availableBelow = Math.max(
    0,
    viewport.top + viewport.height - triggerRect.bottom - gap - viewportPadding,
  );
  const availableAbove = Math.max(0, triggerRect.top - viewport.top - gap - viewportPadding);
  const openAbove = availableBelow < naturalHeight && availableAbove > availableBelow;
  const availableHeight = openAbove ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    minimumPanelHeight,
    Math.min(maxViewportHeight, availableHeight || maxViewportHeight),
  );
  const renderedHeight = Math.min(naturalHeight, maxHeight);
  const preferredTop = openAbove
    ? triggerRect.top - gap - renderedHeight
    : triggerRect.bottom + gap;
  const minTop = viewport.top + viewportPadding;
  const maxTop = viewport.top + viewport.height - viewportPadding - renderedHeight;
  const top = Math.max(minTop, Math.min(preferredTop, Math.max(minTop, maxTop)));
  const minLeft = viewport.left + viewportPadding;
  const maxLeft = Math.max(minLeft, viewport.left + viewport.width - viewportPadding - width);
  const left = Math.max(minLeft, Math.min(triggerRect.right - width, maxLeft));

  return { top, left, width, maxHeight };
}

const DEFAULT_SETTINGS: DockAutoAdvanceSettings = {
  durationMinutes: 5,
  intervalSeconds: 30,
  startFrom: "current",
  endBehavior: "stop",
};

const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 180;
const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 3600;
const AUTO_ADVANCE_TICK_MS = 250;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function loadSettings(storageScope: AutoAdvanceStorageScope): DockAutoAdvanceSettings {
  try {
    const raw = readNativeDockSetting<unknown>(`ocs-dock-auto-advance-${storageScope}`);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = typeof raw === "string"
      ? JSON.parse(raw) as Partial<DockAutoAdvanceSettings>
      : raw as Partial<DockAutoAdvanceSettings>;
    return {
      durationMinutes: clampNumber(
        Number(parsed.durationMinutes),
        MIN_DURATION_MINUTES,
        MAX_DURATION_MINUTES,
      ),
      intervalSeconds: clampNumber(
        Number(parsed.intervalSeconds),
        MIN_INTERVAL_SECONDS,
        MAX_INTERVAL_SECONDS,
      ),
      startFrom: parsed.startFrom === "first" ? "first" : "current",
      endBehavior: parsed.endBehavior === "loop" ? "loop" : "stop",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : `${seconds}s`;
}

/** Returns the next item, or null when a stop-at-end queue is complete. */
export function getAutoAdvanceIndex(
  currentIndex: number,
  itemCount: number,
  endBehavior: AutoAdvanceEndBehavior,
  steps = 1,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return null;
  const safeSteps = Math.max(1, Math.trunc(steps));
  if (endBehavior === "loop") return (currentIndex + safeSteps) % itemCount;
  const nextIndex = currentIndex + safeSteps;
  return nextIndex < itemCount ? nextIndex : null;
}

export function computeDefaultAutoAdvanceBannerPosition(
  bannerEl: HTMLElement | null,
  windowObj?: Pick<Window, "innerWidth" | "innerHeight">,
  docObj?: { querySelector: (selector: string) => Element | null },
): { x: number; y: number } {
  const win = windowObj || (typeof window !== "undefined" ? window : undefined);
  const winWidth = win?.innerWidth ?? 800;
  const winHeight = win?.innerHeight ?? 600;
  const bannerWidth = bannerEl?.offsetWidth || 300;
  const bannerHeight = bannerEl?.offsetHeight || 38;

  // Look for the worship bottom toolbar first, then any dock bottom toolbar, then bottom navigation
  const doc = docObj || (typeof document !== "undefined" ? document : undefined);
  const toolbar = doc
    ? (doc.querySelector(".dock-worship-toolbar .dock-btm-toolbar")
      || doc.querySelector(".dock-btm-toolbar")
      || doc.querySelector(".dock-bottom-nav"))
    : null;

  let targetY: number;
  if (toolbar) {
    const rect = toolbar.getBoundingClientRect();
    // Directly above the toolbar with 8px clearance
    targetY = Math.max(8, rect.top - bannerHeight - 8);
  } else {
    // 96px above window bottom (bottom nav ~42px + toolbar ~46px + 8px gap)
    targetY = Math.max(8, winHeight - 96 - bannerHeight);
  }

  const maxX = Math.max(8, winWidth - bannerWidth - 8);
  const targetX = Math.max(8, Math.min(16, maxX));

  return { x: targetX, y: targetY };
}

const BANNER_POS_STORAGE_KEY = "ocs-dock-auto-advance-banner-pos";

export default function DockAutoAdvanceControl({
  items,
  selectedIndex,
  onSelectIndex,
  onClose,
  onAdvance,
  onStart,
  onActiveChange,
  itemKind,
  storageScope,
  compactLabel = false,
  isOpen: isOpenProp,
  onOpenChange,
  showTrigger = true,
}: DockAutoAdvanceControlProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const previousSelectedIndexRef = useRef(selectedIndex);
  const expectedIndexRef = useRef<number | null>(null);
  const currentIndexRef = useRef(selectedIndex);
  const statusRef = useRef<AutoAdvanceStatus>("idle");
  const deadlinesRef = useRef({ runAt: 0, itemAt: 0 });
  const [settings, setSettings] = useState<DockAutoAdvanceSettings>(() => loadSettings(storageScope));
  const [status, setStatus] = useState<AutoAdvanceStatus>("idle");
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = isOpenProp !== undefined ? isOpenProp : internalIsOpen;
  const setIsOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === "function" ? action(isOpen) : action;
      if (onOpenChange) {
        onOpenChange(next);
      }
      if (isOpenProp === undefined) {
        setInternalIsOpen(next);
      }
    },
    [isOpen, isOpenProp, onOpenChange],
  );
  const [pauseReason, setPauseReason] = useState<"manual" | "user" | null>(null);
  const [remainingRunMs, setRemainingRunMs] = useState(0);
  const [remainingItemMs, setRemainingItemMs] = useState(0);
  const [activeRunDurationMs, setActiveRunDurationMs] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState<DockAutoAdvancePopoverPosition | null>(null);
  const [bannerPos, setBannerPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    hasMoved: boolean;
  } | null>(null);
  const dragJustEndedRef = useRef(false);

  currentIndexRef.current = selectedIndex;
  statusRef.current = status;

  const storageKey = `ocs-dock-auto-advance-${storageScope}`;
  const itemCollectionLabel = itemKind === "song" ? t("worship.title") : t("notes.title");
  const currentItem = items[selectedIndex];
  const canStart = items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length;
  const isActive = status === "running" || status === "paused";

  useLayoutEffect(() => {
    if (!isActive || isOpen || typeof window === "undefined") return;

    const saved = readNativeDockSetting<{ x: number; y: number }>(BANNER_POS_STORAGE_KEY);
    const bannerWidth = bannerRef.current?.offsetWidth || 300;
    const bannerHeight = bannerRef.current?.offsetHeight || 38;
    const maxX = Math.max(8, window.innerWidth - bannerWidth - 8);
    const maxY = Math.max(8, window.innerHeight - bannerHeight - 8);

    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      setBannerPos({
        x: Math.max(8, Math.min(maxX, saved.x)),
        y: Math.max(8, Math.min(maxY, saved.y)),
      });
    } else {
      setBannerPos(computeDefaultAutoAdvanceBannerPosition(bannerRef.current));
    }
  }, [isActive, isOpen]);

  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;
    const onResize = () => {
      const bannerWidth = bannerRef.current?.offsetWidth || 300;
      const bannerHeight = bannerRef.current?.offsetHeight || 38;
      const maxX = Math.max(8, window.innerWidth - bannerWidth - 8);
      const maxY = Math.max(8, window.innerHeight - bannerHeight - 8);

      setBannerPos((curr) => {
        if (!curr) return computeDefaultAutoAdvanceBannerPosition(bannerRef.current);
        return {
          x: Math.max(8, Math.min(maxX, curr.x)),
          y: Math.max(8, Math.min(maxY, curr.y)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isActive]);

  const handleBannerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    if (e.button !== 0) return;

    const currentPos = bannerPos || computeDefaultAutoAdvanceBannerPosition(bannerRef.current);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentPos.x,
      initialY: currentPos.y,
      hasMoved: false,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [bannerPos]);

  const handleBannerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    if (!dragStartRef.current.hasMoved && Math.hypot(dx, dy) >= 4) {
      dragStartRef.current.hasMoved = true;
      setIsDragging(true);
    }

    if (dragStartRef.current.hasMoved) {
      const bannerWidth = bannerRef.current?.offsetWidth || 300;
      const bannerHeight = bannerRef.current?.offsetHeight || 38;
      const maxX = Math.max(8, window.innerWidth - bannerWidth - 8);
      const maxY = Math.max(8, window.innerHeight - bannerHeight - 8);

      const nextX = Math.max(8, Math.min(maxX, dragStartRef.current.initialX + dx));
      const nextY = Math.max(8, Math.min(maxY, dragStartRef.current.initialY + dy));

      setBannerPos({ x: nextX, y: nextY });
    }
  }, []);

  const handleBannerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (dragStartRef.current.hasMoved) {
      dragJustEndedRef.current = true;
      setTimeout(() => {
        dragJustEndedRef.current = false;
      }, 120);

      const bannerWidth = bannerRef.current?.offsetWidth || 300;
      const bannerHeight = bannerRef.current?.offsetHeight || 38;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      const maxX = Math.max(8, window.innerWidth - bannerWidth - 8);
      const maxY = Math.max(8, window.innerHeight - bannerHeight - 8);
      const finalX = Math.max(8, Math.min(maxX, dragStartRef.current.initialX + dx));
      const finalY = Math.max(8, Math.min(maxY, dragStartRef.current.initialY + dy));

      writeNativeDockSetting(BANNER_POS_STORAGE_KEY, { x: finalX, y: finalY });
    }

    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  const handleBannerPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  useEffect(() => {
    writeNativeDockSetting(storageKey, settings);
  }, [settings, storageKey]);

  const pauseAutomation = useCallback((reason: "manual" | "user" = "user") => {
    if (statusRef.current !== "running") return;
    const now = Date.now();
    setRemainingRunMs(Math.max(0, deadlinesRef.current.runAt - now));
    setRemainingItemMs(Math.max(0, deadlinesRef.current.itemAt - now));
    setPauseReason(reason === "manual" ? "manual" : null);
    setStatus("paused");
  }, []);

  const stopAutomation = useCallback(() => {
    expectedIndexRef.current = null;
    deadlinesRef.current = { runAt: 0, itemAt: 0 };
    setPauseReason(null);
    setRemainingRunMs(0);
    setRemainingItemMs(0);
    setActiveRunDurationMs(0);
    setStatus("idle");
  }, []);

  const finishAutomation = useCallback(() => {
    expectedIndexRef.current = null;
    setPauseReason(null);
    setRemainingRunMs(0);
    setRemainingItemMs(0);
    setStatus("completed");
  }, []);

  const handleStart = useCallback(() => {
    if (!canStart) return;
    const durationMs = settings.durationMinutes * 60_000;
    const intervalMs = settings.intervalSeconds * 1_000;
    const startIndex = settings.startFrom === "first" ? 0 : selectedIndex;
    if (startIndex < 0 || startIndex >= items.length) return;

    const now = Date.now();
    expectedIndexRef.current = startIndex === selectedIndex ? null : startIndex;
    onSelectIndex(startIndex);
    onStart?.(startIndex);
    deadlinesRef.current = {
      runAt: now + durationMs,
      itemAt: now + intervalMs,
    };
    setPauseReason(null);
    setRemainingRunMs(durationMs);
    setRemainingItemMs(intervalMs);
    setActiveRunDurationMs(durationMs);
    setStatus("running");
  }, [canStart, items.length, onSelectIndex, onStart, selectedIndex, settings]);

  const handleResume = useCallback(() => {
    if (statusRef.current !== "paused" || remainingRunMs <= 0) return;
    const now = Date.now();
    deadlinesRef.current = {
      runAt: now + remainingRunMs,
      itemAt: now + Math.max(0, remainingItemMs),
    };
    setPauseReason(null);
    setStatus("running");
  }, [remainingItemMs, remainingRunMs]);

  // Any selection change that did not come from the timer is an intentional
  // manual navigation, so pause before the next item can be selected.
  useEffect(() => {
    if (previousSelectedIndexRef.current === selectedIndex) return;
    const expectedIndex = expectedIndexRef.current;
    if (statusRef.current === "running" && expectedIndex !== selectedIndex) {
      pauseAutomation("manual");
    }
    expectedIndexRef.current = null;
    previousSelectedIndexRef.current = selectedIndex;
  }, [pauseAutomation, selectedIndex]);

  useEffect(() => {
    if (statusRef.current !== "running") return;
    if (items.length === 0 || currentIndexRef.current < 0 || currentIndexRef.current >= items.length) {
      stopAutomation();
    }
  }, [items.length, selectedIndex, stopAutomation]);

  useEffect(() => {
    if (status !== "running") return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const runRemaining = deadlinesRef.current.runAt - now;
      if (runRemaining <= 0) {
        finishAutomation();
        return;
      }

      const intervalMs = settings.intervalSeconds * 1_000;
      let nextItemAt = deadlinesRef.current.itemAt;
      let nextIndex = currentIndexRef.current;
      let guard = 0;

      while (now >= nextItemAt && guard < 1000) {
        const candidate = getAutoAdvanceIndex(
          nextIndex,
          items.length,
          settings.endBehavior,
        );
        const transition = onAdvance?.(nextIndex, candidate);
        if (transition?.handled) {
          nextIndex = transition.nextIndex ?? nextIndex;
          // A custom transition owns the nested queue. Process one transition
          // at a time so a delayed timer cannot skip several slides at once.
          nextItemAt = now + intervalMs;
          break;
        }
        if (candidate === null) {
          finishAutomation();
          return;
        }
        nextIndex = candidate;
        nextItemAt += intervalMs;
        guard += 1;
      }

      if (nextIndex !== currentIndexRef.current) {
        expectedIndexRef.current = nextIndex;
        onSelectIndex(nextIndex);
      }

      deadlinesRef.current.itemAt = nextItemAt > now ? nextItemAt : now + intervalMs;
      setRemainingRunMs(Math.max(0, runRemaining));
      setRemainingItemMs(Math.max(0, deadlinesRef.current.itemAt - now));
    }, AUTO_ADVANCE_TICK_MS);

    return () => window.clearInterval(timer);
  }, [finishAutomation, items.length, onAdvance, onSelectIndex, settings.endBehavior, settings.intervalSeconds, status]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target) &&
        !(target instanceof Element && target.closest("[data-dock-keep-overflow-open='true']"))
      ) {
        setIsOpen(false);
        onClose?.();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        onClose?.();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      return;
    }

    const updatePopoverPosition = () => {
      const trigger = triggerRef.current;
      const dockRoot = rootRef.current?.closest<HTMLElement>(".dock-root");
      const dockRect = dockRoot?.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
      const viewport: DockAutoAdvanceViewport = dockRect && dockRect.width > 0 && dockRect.height > 0
        ? {
          left: dockRect.left,
          top: dockRect.top,
          width: Math.min(viewportWidth, dockRect.width),
          height: Math.min(viewportHeight, dockRect.height),
        }
        : { left: 0, top: 0, width: viewportWidth, height: viewportHeight };
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      const triggerRect = trigger
        ? trigger.getBoundingClientRect()
        : {
            top: viewport.top + 64,
            right: viewport.left + Math.min(320, viewport.width - 16),
            bottom: viewport.top + 98,
          };
      const nextPosition = getAutoAdvancePopoverPosition(
        triggerRect,
        viewport,
        popoverRect?.height ?? 420,
        popoverRect?.width,
      );

      setPopoverPosition((current) => (
        current
        && current.top === nextPosition.top
        && current.left === nextPosition.left
        && current.width === nextPosition.width
        && current.maxHeight === nextPosition.maxHeight
          ? current
          : nextPosition
      ));
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    window.visualViewport?.addEventListener("resize", updatePopoverPosition);
    window.visualViewport?.addEventListener("scroll", updatePopoverPosition);

    const resizeObserver = typeof ResizeObserver !== "undefined" && popoverRef.current
      ? new ResizeObserver(updatePopoverPosition)
      : null;
    if (resizeObserver && popoverRef.current) resizeObserver.observe(popoverRef.current);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
      window.visualViewport?.removeEventListener("resize", updatePopoverPosition);
      window.visualViewport?.removeEventListener("scroll", updatePopoverPosition);
      resizeObserver?.disconnect();
    };
  }, [isOpen]);

  const statusLabel = status === "running"
    ? t("autoAdvance.running")
    : status === "paused"
      ? t("autoAdvance.paused")
      : t("autoAdvance.finished");
  const elapsedPercent = activeRunDurationMs > 0
    ? Math.min(100, Math.max(0, ((activeRunDurationMs - remainingRunMs) / activeRunDurationMs) * 100))
    : 0;

  return (
    <div ref={rootRef} className={`dock-auto-advance${compactLabel ? " dock-auto-advance--labeled" : ""}`}>
      {showTrigger && (
        <button
          type="button"
          ref={triggerRef}
          className={`dock-shell-icon-btn dock-auto-advance__trigger${compactLabel ? " dock-auto-advance__trigger--labeled" : ""}${isActive ? " dock-shell-icon-btn--active dock-auto-advance__trigger--active" : ""}`}
          onClick={() => setIsOpen((open) => !open)}
          disabled={items.length === 0}
          title={t("autoAdvance.open")}
          aria-label={t("autoAdvance.open")}
          aria-expanded={isOpen}
        >
          <Icon name={isActive ? "timer" : "playlist_play"} size={16} />
          {compactLabel && <span className="dock-auto-advance__trigger-label">{t("autoAdvance.title")}</span>}
          {isActive && <span className="dock-auto-advance__dot" aria-hidden="true" />}
        </button>
      )}

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={(el) => { popoverRef.current = el; fitPopover(el); }}
          className="dock-auto-advance__popover"
          data-dock-keep-overflow-open="true"
          role="dialog"
          aria-label={t("autoAdvance.title")}
          style={{
            position: "fixed",
            top: popoverPosition?.top ?? 0,
            left: popoverPosition?.left ?? 0,
            width: popoverPosition?.width ?? 360,
            maxHeight: popoverPosition?.maxHeight,
            visibility: popoverPosition ? "visible" : "hidden",
          }}
        >
          <div className="dock-auto-advance__header">
            <div>
              <div className="dock-auto-advance__eyebrow">{t("autoAdvance.title")}</div>
              <div className="dock-auto-advance__title">{itemCollectionLabel}</div>
            </div>
            <button
              type="button"
              className="dock-auto-advance__close"
              onClick={() => {
                setIsOpen(false);
                onClose?.();
              }}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>

          <p className="dock-auto-advance__description">{t("autoAdvance.description")}</p>

          {status !== "idle" && (
            <div className={`dock-auto-advance__status dock-auto-advance__status--${status}`} aria-live="polite">
              <div className="dock-auto-advance__status-head">
                <span className="dock-auto-advance__status-label">{statusLabel}</span>
                <span className="dock-auto-advance__position">
                  {t("autoAdvance.itemPosition", { current: Math.max(0, selectedIndex + 1), total: items.length })}
                </span>
              </div>
              {currentItem && <div className="dock-auto-advance__current">{currentItem.label}</div>}
              {status !== "completed" && (
                <>
                  <div className="dock-auto-advance__progress" aria-hidden="true">
                    <span style={{ width: `${elapsedPercent}%` }} />
                  </div>
                  <div className="dock-auto-advance__timers">
                    <span>{t("autoAdvance.nextIn", { time: formatRemaining(remainingItemMs) })}</span>
                    <span>{t("autoAdvance.runRemaining", { time: formatRemaining(remainingRunMs) })}</span>
                  </div>
                </>
              )}
              {pauseReason === "manual" && (
                <div className="dock-auto-advance__pause-note">{t("autoAdvance.manualPause")}</div>
              )}
            </div>
          )}

          <div className="dock-auto-advance__fields">
            <label className="dock-auto-advance__field">
              <span>{t("autoAdvance.runFor")}</span>
              <span className="dock-auto-advance__number-input">
                <input
                  type="number"
                  min={MIN_DURATION_MINUTES}
                  max={MAX_DURATION_MINUTES}
                  step={1}
                  value={settings.durationMinutes}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    durationMinutes: clampNumber(Number(event.target.value), MIN_DURATION_MINUTES, MAX_DURATION_MINUTES),
                  }))}
                  disabled={isActive}
                  aria-label={t("autoAdvance.runFor")}
                />
                <span>{t("autoAdvance.minutes")}</span>
              </span>
            </label>
            <label className="dock-auto-advance__field">
              <span>{t("autoAdvance.advanceEvery")}</span>
              <span className="dock-auto-advance__number-input">
                <input
                  type="number"
                  min={MIN_INTERVAL_SECONDS}
                  max={MAX_INTERVAL_SECONDS}
                  step={5}
                  value={settings.intervalSeconds}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    intervalSeconds: clampNumber(Number(event.target.value), MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS),
                  }))}
                  disabled={isActive}
                  aria-label={t("autoAdvance.advanceEvery")}
                />
                <span>{t("autoAdvance.seconds")}</span>
              </span>
            </label>
          </div>

          <div className="dock-auto-advance__option-section">
            <label className="dock-auto-advance__select-field">
              <span className="dock-auto-advance__option-label">{t("autoAdvance.startFrom")}</span>
              <select
                className="dock-select dock-auto-advance__select"
                value={settings.startFrom}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  startFrom: event.target.value === "first" ? "first" : "current",
                }))}
                disabled={isActive}
                aria-label={t("autoAdvance.startFrom")}
              >
                <option value="current">{t("autoAdvance.currentItem")}</option>
                <option value="first">{t("autoAdvance.firstItem")}</option>
              </select>
            </label>
          </div>

          <div className="dock-auto-advance__option-section">
            <label className="dock-auto-advance__select-field">
              <span className="dock-auto-advance__option-label">{t("autoAdvance.whenListEnds")}</span>
              <select
                className="dock-select dock-auto-advance__select"
                value={settings.endBehavior}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  endBehavior: event.target.value === "loop" ? "loop" : "stop",
                }))}
                disabled={isActive}
                aria-label={t("autoAdvance.whenListEnds")}
              >
                <option value="stop">{t("autoAdvance.stopAtEnd")}</option>
                <option value="loop">{t("autoAdvance.loop")}</option>
              </select>
            </label>
          </div>

          <div className="dock-auto-advance__footer">
            {isActive ? (
              <>
                <button
                  type="button"
                  className="dock-auto-advance__button dock-auto-advance__button--primary"
                  onClick={() => (status === "running" ? pauseAutomation() : handleResume())}
                >
                  <Icon name={status === "running" ? "pause" : "play_arrow"} size={14} />
                  {status === "running" ? t("autoAdvance.pause") : t("autoAdvance.resume")}
                </button>
                <button
                  type="button"
                  className="dock-auto-advance__button dock-auto-advance__button--danger"
                  onClick={stopAutomation}
                >
                  <Icon name="stop" size={14} />
                  {t("autoAdvance.stop")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="dock-auto-advance__button dock-auto-advance__button--primary dock-auto-advance__button--start"
                onClick={handleStart}
                disabled={!canStart}
              >
                <Icon name="play_arrow" size={14} />
                {t("autoAdvance.start")}
              </button>
            )}
          </div>

          {!canStart && <div className="dock-auto-advance__empty">{t("autoAdvance.selectItem")}</div>}
        </div>,
        rootRef.current?.closest<HTMLElement>(".dock-root") ?? document.body,
      )}

      {!isOpen && isActive && typeof document !== "undefined" && createPortal(
        <div
          ref={bannerRef}
          className={`dock-auto-advance-banner dock-auto-advance-banner--${status}${isDragging ? " dock-auto-advance-banner--dragging" : ""}`}
          role="status"
          aria-live="polite"
          data-dock-keep-overflow-open="true"
          style={bannerPos ? { left: `${bannerPos.x}px`, top: `${bannerPos.y}px`, right: "auto", bottom: "auto" } : undefined}
          onPointerDown={handleBannerPointerDown}
          onPointerMove={handleBannerPointerMove}
          onPointerUp={handleBannerPointerUp}
          onPointerCancel={handleBannerPointerCancel}
        >
          <span
            className="dock-auto-advance-banner__drag-handle"
            title={t("autoAdvance.dragToMove", "Drag to move")}
            aria-hidden="true"
          >
            <Icon name="drag_indicator" size={13} />
          </span>
          <div
            className="dock-auto-advance-banner__info"
            onClick={() => {
              if (dragJustEndedRef.current) return;
              setIsOpen(true);
            }}
            role="button"
            tabIndex={0}
            title={t("autoAdvance.clickToOpenSettings", "Click to open auto-advance settings")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsOpen(true);
              }
            }}
          >
            <span className={`dock-auto-advance-banner__indicator dock-auto-advance-banner__indicator--${status}`}>
              <span className="dock-auto-advance-banner__pulse" />
            </span>
            <div className="dock-auto-advance-banner__texts">
              <span className="dock-auto-advance-banner__status">
                {status === "running"
                  ? t("autoAdvance.runningBanner", "Auto-advancing")
                  : t("autoAdvance.pausedBanner", "Auto-advance paused")}
              </span>
              <span className="dock-auto-advance-banner__countdown">
                {status === "running"
                  ? t("autoAdvance.nextSlideIn", "Next in {{seconds}}s", {
                      seconds: Math.max(1, Math.ceil(remainingItemMs / 1000)),
                    })
                  : t("autoAdvance.secondsRemaining", "{{seconds}}s left", {
                      seconds: Math.max(1, Math.ceil(remainingItemMs / 1000)),
                    })}
              </span>
            </div>
          </div>

          <div className="dock-auto-advance-banner__actions">
            {status === "running" ? (
              <button
                type="button"
                className="dock-auto-advance-banner__btn dock-auto-advance-banner__btn--pause"
                onClick={() => pauseAutomation("manual")}
                title={t("autoAdvance.pause", "Pause auto-advance")}
                aria-label={t("autoAdvance.pause", "Pause auto-advance")}
              >
                <Icon name="pause" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="dock-auto-advance-banner__btn dock-auto-advance-banner__btn--resume"
                onClick={handleResume}
                title={t("autoAdvance.resume", "Resume auto-advance")}
                aria-label={t("autoAdvance.resume", "Resume auto-advance")}
              >
                <Icon name="play_arrow" size={14} />
              </button>
            )}

            <button
              type="button"
              className="dock-auto-advance-banner__btn dock-auto-advance-banner__btn--stop"
              onClick={stopAutomation}
              title={t("autoAdvance.stop", "Stop auto-advance")}
              aria-label={t("autoAdvance.stop", "Stop auto-advance")}
            >
              <Icon name="stop" size={14} />
            </button>

            <button
              type="button"
              className="dock-auto-advance-banner__btn dock-auto-advance-banner__btn--settings"
              onClick={() => setIsOpen(true)}
              title={t("autoAdvance.settings", "Auto-advance settings")}
              aria-label={t("autoAdvance.settings", "Auto-advance settings")}
            >
              <Icon name="tune" size={14} />
            </button>
          </div>
        </div>,
        rootRef.current?.closest<HTMLElement>(".dock-root") ?? document.body,
      )}
    </div>
  );
}
