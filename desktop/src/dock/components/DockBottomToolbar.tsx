/**
 * DockBottomToolbar.tsx — Shared bottom toolbar for Bible & Worship tabs
 *
 * Compact layout with a two-row fallback for ultra-narrow docks.
 * [ Full | LT ] [ centered action ] ... [ visibility ] [ ⋯ ]
 */

import { useCallback, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import "./DockBottomToolbar.css";

type OverlayMode = "fullscreen" | "lower-third";
type DisplayMode = "single" | "compare";
interface BottomPanelToggle {
  expanded: boolean;
  onToggle: () => void;
}
const DISPLAY_MODES = [
  { id: "single" as const, labelKey: "dock.bottomToolbar.singleTranslation" },
  { id: "compare" as const, labelKey: "dock.bottomToolbar.compareTranslations" },
];

interface Props {
  /** Current overlay mode */
  overlayMode: OverlayMode;
  /** Called when the operator toggles Full ↔ LT */
  onModeChange: (mode: OverlayMode) => void;
  /** Current display mode (single translation or compare) */
  displayMode?: DisplayMode;
  /** Called when the operator switches display mode */
  onDisplayModeChange?: (mode: DisplayMode) => void;
  /** Whether the segmented control shows the morphing pulse */
  morphing?: boolean;
  /** Hide Full/LT mode controls when the output is fixed to fullscreen */
  hideOverlayModeToggle?: boolean;
  /** Disable Full/LT while an automated slide run owns the output mode */
  overlayModeToggleDisabled?: boolean;
  /** Action buttons rendered between the divider and spacer */
  children?: React.ReactNode;
  /** Label for the clear button */
  clearLabel?: string;
  /** Called when the clear button is clicked */
  onClear?: () => void;
  /** Whether the clear button is disabled */
  clearDisabled?: boolean;
  /** Whether the associated OBS source is currently visible */
  sourceVisible?: boolean;
  /** Move the clear/visibility action into the overflow menu */
  clearInOverflow?: boolean;
  /** Optional action centered between the overlay mode and toolbar actions */
  centerAction?: React.ReactNode;
  /** Optional search/control card rendered inside the lower-third toolbar */
  bottomPanel?: React.ReactNode;
  /** Optional search/control toggle rendered after the overflow button */
  bottomPanelToggle?: BottomPanelToggle;
  /** Notify consumers when the shared lower-toolbar overflow opens or closes */
  onOverflowChange?: (open: boolean) => void;
  /** Whether the toolbar is collapsed (controlled) */
  collapsed?: boolean;
  /** Whether to hide the collapse button and suppress collapsed mode */
  hideCollapse?: boolean;
  /** Called when collapse/expand is toggled */
  onCollapseChange?: (collapsed: boolean) => void;
  /** Optional direct handler for quick edits when moved to overflow */
  onQuickEdit?: () => void;
  /** Optional label for quick edits when moved to overflow */
  quickEditLabel?: string;
}

export default function DockBottomToolbar({
  overlayMode,
  onModeChange,
  displayMode = "single",
  onDisplayModeChange,
  morphing = false,
  hideOverlayModeToggle = false,
  overlayModeToggleDisabled = false,
  children,
  clearLabel,
  onClear,
  clearDisabled = false,
  sourceVisible = true,
  clearInOverflow = false,
  centerAction,
  bottomPanel,
  bottomPanelToggle,
  onOverflowChange,
  collapsed = false,
  hideCollapse = false,
  onCollapseChange,
  onQuickEdit,
  quickEditLabel,
}: Props) {
  const { t } = useTranslation();
  const resolvedClearLabel = clearLabel ?? t("dock.bottomToolbar.hideBible");
  const [showOverflow, setShowOverflow] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [showDisplayModeMenu, setShowDisplayModeMenu] = useState(false);
  const displayModeMenuRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isUltraNarrow, setIsUltraNarrow] = useState(false);
  const [isBelow300, setIsBelow300] = useState(false);
  const visibilityIcon = sourceVisible ? "visibility_off" : "visibility";
  const modeToggleDisabled = morphing || overlayModeToggleDisabled;

  // The dock can be narrower than the browser window, so use the toolbar's
  // actual width instead of a viewport media query for the compact action set.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;

    const updateNarrowState = () => {
      const width = toolbar.clientWidth;
      const dockRoot = toolbar.closest(".dock-root");
      const dockRootWidth = dockRoot ? dockRoot.clientWidth : width;
      setIsNarrow(width <= 350);
      setIsUltraNarrow(width <= 239);
      setIsBelow300(width < 300 || dockRootWidth < 300);
    };
    updateNarrowState();

    const observer = new ResizeObserver(updateNarrowState);
    observer.observe(toolbar);
    const dockRoot = toolbar.closest(".dock-root");
    if (dockRoot) {
      observer.observe(dockRoot);
    }
    return () => observer.disconnect();
  }, [collapsed]);

  // Close overflow on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-dock-keep-overflow-open='true']")) return;
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
        onOverflowChange?.(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onOverflowChange, showOverflow]);

  // Close display mode menu on outside click
  useEffect(() => {
    if (!showDisplayModeMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (displayModeMenuRef.current && !displayModeMenuRef.current.contains(e.target as Node)) {
        setShowDisplayModeMenu(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showDisplayModeMenu]);

  const toggleOverflow = useCallback(() => {
    const next = !showOverflow;
    setShowOverflow(next);
    onOverflowChange?.(next);
  }, [onOverflowChange, showOverflow]);

  const closeOverflow = useCallback(() => {
    setShowOverflow(false);
    onOverflowChange?.(false);
  }, [onOverflowChange]);

  const renderVisibilityButton = (className: string) => (
    <button
      type="button"
      className={className}
      onClick={onClear}
      disabled={clearDisabled}
      aria-label={resolvedClearLabel}
      aria-pressed={!sourceVisible}
      title={resolvedClearLabel}
    >
      <Icon name={visibilityIcon} size={16} />
    </button>
  );

  const handleDisplayModeSelect = useCallback(
    (mode: DisplayMode) => {
      onDisplayModeChange?.(mode);
      setShowDisplayModeMenu(false);
    },
    [onDisplayModeChange],
  );

  if (collapsed) {
    if (!hideCollapse) {
      if (bottomPanel) {
        return (
          <div className="dock-btm-toolbar dock-btm-toolbar--bottom-panel-only" ref={toolbarRef}>
            {bottomPanel}
          </div>
        );
      }
      return (
        <div className="dock-btm-toolbar dock-btm-toolbar--collapsed" ref={toolbarRef}>
          {onClear && !clearInOverflow && (
            <button
              type="button"
              className={`dock-btm-toolbar__clear dock-btm-toolbar__clear--bible${sourceVisible ? " is-live" : ""}`}
              onClick={onClear}
              disabled={clearDisabled}
              aria-pressed={!sourceVisible}
              title={resolvedClearLabel}
            >
              <Icon name={visibilityIcon} size={14} />
              <span>{resolvedClearLabel}</span>
            </button>
          )}
          {centerAction && (
            <div
              className="dock-btm-toolbar__center dock-btm-toolbar__center--collapsed"
              aria-label={t("dock.bottomToolbar.centerActions", "Navigation")}
            >
              {centerAction}
            </div>
          )}
          <button
            type="button"
            className="dock-btm-toolbar__icon-btn"
            onClick={() => onCollapseChange?.(false)}
            aria-label={t("dock.bottomToolbar.expandTooltip")}
            title={t("dock.bottomToolbar.expandTooltip")}
          >
            <Icon name="expand_less" size={18} />
          </button>
        </div>
      );
    }
  }

  const showCenterActionInRow = Boolean(centerAction) && !isBelow300;
  const showInlineClear = Boolean(onClear) && !clearInOverflow && !isBelow300;
  const hasOverflowItems = Boolean(children) || (Boolean(onClear) && (clearInOverflow || isBelow300)) || (isBelow300 && Boolean(onQuickEdit || centerAction));

  return (
    <div
      className={`dock-btm-toolbar dock-btm-toolbar--compact${isNarrow ? " dock-btm-toolbar--narrow" : ""}${isUltraNarrow ? " dock-btm-toolbar--ultra-narrow" : ""}${isBelow300 ? " dock-btm-toolbar--below-300" : ""}`}
      ref={toolbarRef}
    >
      {bottomPanel}
      <div className={`dock-btm-toolbar__row${showCenterActionInRow ? " dock-btm-toolbar__row--centered" : ""}`}>
        {!hideOverlayModeToggle && (
          <div
            className={`dock-btm-segmented${morphing ? " dock-btm-segmented--morphing" : ""}`}
            role="group"
            aria-label={`${t("dock.bottomToolbar.overlayModeLabel")}: ${overlayMode === "fullscreen" ? t("dock.bottomToolbar.fullLabel") : t("dock.bottomToolbar.ltLabel")}`}
          >
            <div className="dock-btm-display-mode-anchor" ref={displayModeMenuRef}>
              <button
                type="button"
                className={`dock-btm-segmented__item dock-btm-segmented__item--full${overlayMode === "fullscreen" ? " dock-btm-segmented__item--active" : ""}`}
                onClick={() => {
                  if (!morphing && overlayMode !== "fullscreen") onModeChange("fullscreen");
                }}
                disabled={modeToggleDisabled}
                aria-busy={morphing || undefined}
                aria-pressed={overlayMode === "fullscreen"}
                title={t("dock.bottomToolbar.fullscreenTooltip")}
              >
                {t("dock.bottomToolbar.fullLabel")}
              </button>
              {showDisplayModeMenu && onDisplayModeChange && (
                <div className="dock-btm-display-mode-menu" role="menu">
                  {DISPLAY_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`dock-btm-display-mode-menu__item${displayMode === mode.id ? " dock-btm-display-mode-menu__item--active" : ""}`}
                      onClick={() => handleDisplayModeSelect(mode.id)}
                      role="menuitem"
                    >
                      {t(mode.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`dock-btm-segmented__item${overlayMode === "lower-third" ? " dock-btm-segmented__item--active" : ""}`}
              onClick={() => {
                if (!morphing && overlayMode !== "lower-third") onModeChange("lower-third");
              }}
              disabled={modeToggleDisabled}
              aria-busy={morphing || undefined}
              aria-pressed={overlayMode === "lower-third"}
              title={t("dock.bottomToolbar.lowerThirdTooltip")}
            >
              {t("dock.bottomToolbar.ltLabel")}
            </button>
          </div>
        )}

        {showCenterActionInRow && (
          <div className="dock-btm-toolbar__center" aria-label={t("dock.bottomToolbar.centerActions", "Navigation")}>
            {centerAction}
          </div>
        )}

        <div className="dock_bottom_bar">
          {/* Visibility toggle — inline when not in narrow overflow mode */}
          {showInlineClear && (
            renderVisibilityButton("dock-btm-toolbar__clear--inline")
          )}

          {/* ⋯ Overflow menu for hidden actions */}
          {hasOverflowItems && (
            <div className="dock-btm-overflow" ref={overflowRef}>
              <button
                type="button"
                className={`dock-btm-toolbar__icon-btn${showOverflow ? " dock-btm-toolbar__icon-btn--active" : ""}`}
                onClick={toggleOverflow}
                aria-label={t("dock.bottomToolbar.moreActions")}
                title={t("dock.bottomToolbar.moreActions")}
              >
                <Icon name="more_vert" size={16} />
              </button>
              {showOverflow && (
                <div className="dock-btm-overflow__menu" role="menu">
                  {onClear && (clearInOverflow || isBelow300) && (
                    <button
                      type="button"
                      className="dock-btm-overflow__menu-item"
                      data-dock-close-overflow="true"
                      onClick={() => {
                        onClear();
                        closeOverflow();
                      }}
                      disabled={clearDisabled}
                      aria-label={resolvedClearLabel}
                      aria-pressed={!sourceVisible}
                      title={resolvedClearLabel}
                    >
                      <Icon name={visibilityIcon} size={16} />
                      <span>{resolvedClearLabel}</span>
                    </button>
                  )}
                  {isBelow300 && (onQuickEdit || centerAction) && (
                    onQuickEdit ? (
                      <button
                        type="button"
                        className="dock-btm-overflow__menu-item"
                        data-dock-close-overflow="true"
                        onClick={() => {
                          onQuickEdit();
                          closeOverflow();
                        }}
                        title={quickEditLabel ?? t("bible.quickEdits", "Quick Edits")}
                        aria-label={quickEditLabel ?? t("bible.quickEdits", "Quick Edits")}
                      >
                        <Icon name="edit" size={16} />
                        <span>{quickEditLabel ?? t("bible.quickEdits", "Quick Edits")}</span>
                      </button>
                    ) : (
                      <div
                        className="dock-btm-overflow__center-action"
                        data-dock-close-overflow="true"
                        onClick={() => closeOverflow()}
                      >
                        {centerAction}
                      </div>
                    )
                  )}
                  {children && (
                    <div
                      className="dock-btm-overflow__children"
                      onClick={(event) => {
                        const target = event.target as Element | null;
                        if (target?.closest("[data-dock-close-overflow='true']")) {
                          closeOverflow();
                        }
                      }}
                    >
                      {children}
                    </div>
                  )}
                </div>
              )}
              {bottomPanelToggle && (
                <button
                  type="button"
                  className={`dock-btm-toolbar__icon-btn dock-btm-toolbar__bottom-panel-toggle${bottomPanelToggle.expanded ? " dock-btm-toolbar__icon-btn--active" : ""}`}
                  onClick={bottomPanelToggle.onToggle}
                  aria-expanded={bottomPanelToggle.expanded}
                  aria-label={bottomPanelToggle.expanded ? t("dock.collapseSearchPanel", "Collapse search panel") : t("dock.expandSearchPanel", "Expand search panel")}
                  title={bottomPanelToggle.expanded ? t("dock.collapseSearchPanel", "Collapse search panel") : t("dock.expandSearchPanel", "Expand search panel")}
                >
                  <Icon name={bottomPanelToggle.expanded ? "expand_more" : "expand_less"} size={15} />
                </button>
              )}
              {onCollapseChange && !bottomPanelToggle && (
                !hideCollapse ? (
                  <button
                    type="button"
                    className="dock-btm-toolbar__icon-btn dock-btm-toolbar__collapse-btn"
                    onClick={() => onCollapseChange(true)}
                    aria-label={t("dock.bottomToolbar.collapseTooltip")}
                    title={t("dock.bottomToolbar.collapseTooltip")}
                  >
                    <Icon name="expand_more" size={15} />
                  </button>
                ) : null
              )}
            </div>
          )}
          {onCollapseChange && !bottomPanelToggle && !hasOverflowItems && (
            !hideCollapse ? (
              <button
                type="button"
                className="dock-btm-toolbar__icon-btn dock-btm-toolbar__collapse-btn"
                onClick={() => onCollapseChange(true)}
                aria-label={t("dock.bottomToolbar.collapseTooltip")}
                title={t("dock.bottomToolbar.collapseTooltip")}
              >
                <Icon name="expand_more" size={15} />
              </button>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
