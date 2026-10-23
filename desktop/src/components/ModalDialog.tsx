/**
 * ModalDialog.tsx — the one modal look for MakeChurchEazy.
 *
 * Every confirm / notice / limit dialog uses this shape so they all share the same
 * card, colours, spacing and buttons (tokens live in ModalDialog.css):
 *
 *   [ round icon badge in the tone colour ]
 *   Title
 *   Short description
 *   (optional extra: a progress bar, a small list …)
 *   (optional hint line)
 *   [ Cancel ]  [ Main action ]
 *
 * Tones: brand / info (the app accent), warning, danger, success: all from the theme tokens,
 * so dialogs follow dark / light mode and the accent chosen in Settings → Appearance.
 * Buttons: ghost, primary, danger, dangerGhost. Put the safe / cancel button first.
 */
import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "./icons/NativeIcons";
import "./ModalDialog.css";

export type ModalTone = "brand" | "info" | "warning" | "danger" | "success";
export type ModalActionVariant = "ghost" | "primary" | "danger" | "dangerGhost";

export interface ModalAction {
  label: string;
  onClick: () => void;
  variant?: ModalActionVariant;
  autoFocus?: boolean;
  disabled?: boolean;
}

export interface ModalDialogProps {
  /** Default true. Pass false to keep the component mounted but hidden. */
  open?: boolean;
  tone?: ModalTone;
  /** Usually a lucide icon at size 26. */
  icon: ReactNode;
  title: string;
  /** The description: plain text or a <p>. */
  children?: ReactNode;
  /** Full-width block under the description (progress bar, details). */
  extra?: ReactNode;
  /** Small muted line under everything. */
  hint?: ReactNode;
  actions: ModalAction[];
  /** Called for Esc, backdrop click and the corner X (each can be switched off). */
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** Corner X button. Default: shown when `onClose` is given. */
  showClose?: boolean;
  role?: "dialog" | "alertdialog";
  zIndex?: number;
  /** Card width in px. Default 440. */
  width?: number;
}

export default function ModalDialog({
  open = true,
  tone = "brand",
  icon,
  title,
  children,
  extra,
  hint,
  actions,
  onClose,
  closeOnBackdrop,
  closeOnEscape,
  showClose,
  role = "dialog",
  zIndex,
  width,
}: ModalDialogProps) {
  const titleId = useId();
  const backdropCloses = closeOnBackdrop ?? Boolean(onClose);
  const escapeCloses = closeOnEscape ?? Boolean(onClose);
  const closeShown = showClose ?? Boolean(onClose);

  useEffect(() => {
    if (!open || !escapeCloses || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, escapeCloses, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="mce-modal-backdrop"
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      style={zIndex ? { zIndex } : undefined}
      onClick={backdropCloses ? onClose : undefined}
    >
      <div className="mce-modal" style={width ? { maxWidth: width } : undefined} onClick={(event) => event.stopPropagation()}>
        {closeShown && onClose && (
          <button type="button" className="mce-modal__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}
        <div className={`mce-modal__badge mce-modal__badge--${tone}`}>{icon}</div>
        <h2 id={titleId} className="mce-modal__title">{title}</h2>
        {children ? <div className="mce-modal__text">{children}</div> : null}
        {extra ? <div className="mce-modal__extra">{extra}</div> : null}
        {hint ? <div className="mce-modal__hint">{hint}</div> : null}
        <div className="mce-modal__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`mce-modal__btn mce-modal__btn--${action.variant ?? "ghost"}`}
              onClick={action.onClick}
              autoFocus={action.autoFocus}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Label + value row over a progress bar (downloads, uploads). */
export function ModalProgress({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div className="mce-modal__progress">
      <div className="mce-modal__progress-row">
        <span className="mce-modal__progress-label">{label}</span>
        <span className="mce-modal__progress-value">{value}</span>
      </div>
      <div className="mce-modal__progress-track">
        <div className="mce-modal__progress-fill" style={{ width: `${Math.min(100, Math.max(4, percent))}%` }} />
      </div>
    </div>
  );
}
