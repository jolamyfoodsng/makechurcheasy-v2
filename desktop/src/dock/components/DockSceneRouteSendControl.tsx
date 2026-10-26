import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isDockOutputRouted, presentationOnlyRoutePatch, type DockSceneRoute } from "../dockSceneRouting";
import DockRoutedOutputMenu from "./DockRoutedOutputMenu";
import Icon from "../DockIcon";
import "./DockSceneRouteSendControl.css";

export interface DockSceneRouteSendControlProps {
  /** The current scene routing configuration for this module (e.g. lower-third). */
  route?: DockSceneRoute | null;
  /** Callback when scene routing is modified (e.g. disabled from the dropdown). */
  onRouteChange?: (patch: Partial<DockSceneRoute>) => void;
  /** Callback to send to OBS. Receives { bypassSceneRoute: true } if routing should be bypassed. */
  onSend: (options?: { bypassSceneRoute?: boolean }) => void | Promise<void>;
  /** Loading/busy state while sending to OBS. */
  sending?: boolean;
  /** Disabled state for the button. */
  disabled?: boolean;
  /** Custom button class name. Defaults to "dock-btn dock-btn--sm dock-btn--primary". */
  className?: string;
  /** Inline style overrides for the button. */
  style?: React.CSSProperties;
  /** Label for the button. Defaults to "Send to OBS". */
  label?: string;
  /** Icon name for the button. Defaults to "play_arrow". */
  iconName?: string;
  /** Hover title. */
  title?: string;
  /** Keyboard shortcut to mention at the end of the hover title, e.g. "Ctrl+Enter". */
  shortcutHint?: string;
  /** Optional content type label for the question (e.g. "scripture", "worship slide", "note", "lower-third"). Defaults to "lower-third". */
  itemLabel?: string;
}

/**
 * DockSceneRouteSendControl — "Send to OBS" button that detects when scene routing is ON.
 *
 * When scene routing is OFF:
 *   Immediately executes `onSend()`.
 *
 * When scene routing is ON (e.g. sent to another scene like "BRB SCENE"):
 *   Clicking the button opens a menu that lists every output the content will
 *   reach, with: send to them, MCE Presentation only (turns the routing off), or Cancel.
 */
export default function DockSceneRouteSendControl({
  route,
  onRouteChange,
  onSend,
  sending = false,
  disabled = false,
  className = "dock-btn dock-btn--sm dock-btn--primary",
  style,
  label,
  iconName = "play_arrow",
  title,
  shortcutHint,
  itemLabel,
}: DockSceneRouteSendControlProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  const hasActiveRoute = Boolean(route && isDockOutputRouted(route));
  const routedNames = useMemo(() => [
    ...(route?.enabled ? (route.targets ?? []).map((target) => target.sceneName).filter(Boolean) : []),
    ...(route?.display?.enabled ? [route.display.monitorName || "Display"] : []),
  ], [route]);
  const targetSummary = routedNames.join(", ");
  const badgeText = routedNames.length <= 1 ? (routedNames[0] ?? "") : `${routedNames.length} outputs`;

  const defaultLabel = label ?? t("common.sendToObs", "Send to OBS");
  const baseTitle = title ?? (
    hasActiveRoute
      ? `${defaultLabel} (${t("sceneRouting.routedTo", "Routed to:")} ${targetSummary})`
      : defaultLabel
  );
  const buttonTitle = shortcutHint ? `${baseTitle} · ${shortcutHint}` : baseTitle;

  const handleButtonClick = () => {
    if (disabled || sending) return;
    if (!hasActiveRoute) {
      void onSend({ bypassSceneRoute: false });
      return;
    }
    setMenuOpen((open) => !open);
  };

  const handleSendToRoutedScene = useCallback(() => {
    setMenuOpen(false);
    void onSend({ bypassSceneRoute: false });
  }, [onSend]);

  const handleDisableAndSend = useCallback(() => {
    setMenuOpen(false);
    if (route) onRouteChange?.(presentationOnlyRoutePatch(route));
    void onSend({ bypassSceneRoute: true });
  }, [onRouteChange, onSend, route]);

  // Close dropdown if route becomes inactive externally
  useEffect(() => {
    if (!hasActiveRoute && menuOpen) {
      setMenuOpen(false);
    }
  }, [hasActiveRoute, menuOpen]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Smart popover positioning (prefer opening above the button because the dock action bar is at the bottom)
  useLayoutEffect(() => {
    if (!menuOpen) {
      setPopoverPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover?.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
      const viewportPadding = 8;
      const gap = 8;
      const popoverWidth = popoverRect?.width || Math.min(320, viewportWidth - viewportPadding * 2);
      const popoverHeight = popoverRect?.height || 220;

      // Position horizontally: align with trigger left, clamped to viewport
      let left = triggerRect.left;
      if (left + popoverWidth > viewportWidth - viewportPadding) {
        left = viewportWidth - popoverWidth - viewportPadding;
      }
      if (left < viewportPadding) {
        left = viewportPadding;
      }

      // Position vertically: prefer opening above the button
      const spaceAbove = triggerRect.top - viewportPadding;
      const spaceBelow = viewportHeight - triggerRect.bottom - viewportPadding;
      const fitsAbove = spaceAbove >= popoverHeight + gap;
      const fitsBelow = spaceBelow >= popoverHeight + gap;

      const top = fitsAbove
        ? triggerRect.top - popoverHeight - gap
        : fitsBelow
          ? triggerRect.bottom + gap
          : Math.max(viewportPadding, triggerRect.top - popoverHeight - gap);

      setPopoverPosition((current) => (
        current?.top === top && current.left === left ? current : { top, left }
      ));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);

    const resizeObserver = typeof ResizeObserver !== "undefined" && popoverRef.current
      ? new ResizeObserver(updatePosition)
      : null;
    if (resizeObserver && popoverRef.current) resizeObserver.observe(popoverRef.current);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [menuOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${className}${sending ? " dock-btn--loading" : ""}${hasActiveRoute ? " dock-scene-route-send-btn--routed" : ""}`}
        onClick={handleButtonClick}
        disabled={disabled || sending}
        style={style}
        title={buttonTitle}
        aria-haspopup={hasActiveRoute ? "menu" : undefined}
        aria-expanded={hasActiveRoute ? menuOpen : undefined}
      >
        <Icon name={iconName} size={14} />
        <span>{defaultLabel}</span>
        {hasActiveRoute && (
          <>
            <span className="dock-scene-route-send-btn__route-badge" title={targetSummary}>
              <Icon name="alt_route" size={11} />
              <span className="dock-scene-route-send-btn__route-text">{badgeText}</span>
            </span>
            <Icon
              name={menuOpen ? "expand_more" : "expand_less"}
              size={13}
              className="dock-scene-route-send-btn__arrow"
            />
          </>
        )}
      </button>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          data-dock-keep-overflow-open="true"
          role="menu"
          aria-label={t("sceneRouting.routedOutputMenu", "Routed output options")}
          style={{
            position: "fixed",
            top: popoverPosition?.top ?? 0,
            left: popoverPosition?.left ?? 0,
            zIndex: 10001,
            width: 330,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            boxSizing: "border-box",
            padding: 12,
            border: "1px solid var(--dock-border)",
            borderRadius: 6,
            background: "var(--dock-surface)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            visibility: popoverPosition ? "visible" : "hidden",
          }}
        >
          {route && (
            <DockRoutedOutputMenu
              route={route}
              variant="confirm"
              itemLabel={itemLabel}
              onSend={handleSendToRoutedScene}
              onPresentationOnly={handleDisableAndSend}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
