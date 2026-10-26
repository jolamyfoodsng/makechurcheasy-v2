import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DockSceneRoute } from "../dockSceneRouting";
import DockRoutedOutputMenu from "./DockRoutedOutputMenu";
import "./DockSceneRouteSendControl.css";

export interface DockSceneRouteConfirmDialogProps {
  open: boolean;
  route?: DockSceneRoute | null;
  itemLabel?: string;
  onConfirmRouted: () => void | Promise<void>;
  onSendToMceAlone: () => void | Promise<void>;
  onCancel: () => void;
  sending?: boolean;
}

/**
 * DockSceneRouteConfirmDialog — Modal dialog prompted when an operator projects
 * content (Bible, Worship, Notes) while Output is routed to another scene.
 *
 * It lists every output the content will reach (scenes, MCE Presentation,
 * a display) and offers: send to them, MCE Presentation only, or Cancel.
 */
export default function DockSceneRouteConfirmDialog({
  open,
  route,
  itemLabel,
  onConfirmRouted,
  onSendToMceAlone,
  onCancel,
  sending = false,
}: DockSceneRouteConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const content = (
    <div
      className="dock-dialog-backdrop"
      role="presentation"
      onClick={onCancel}
      style={{ zIndex: 10002 }}
    >
      <div
        className="dock-dialog dock-dialog--compact dock-scene-route-confirm-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 340,
          maxWidth: "calc(100vw - 24px)",
          padding: 16,
          borderRadius: 6,
          background: "var(--dock-surface)",
          border: "1px solid var(--dock-border)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
          color: "var(--dock-text)",
        }}
      >
        {route && (
          <DockRoutedOutputMenu
            route={route}
            variant="confirm"
            itemLabel={itemLabel}
            showFormats
            sending={sending}
            onSend={() => { void onConfirmRouted(); }}
            onPresentationOnly={() => { void onSendToMceAlone(); }}
            onClose={onCancel}
          />
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
