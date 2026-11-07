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
 * Longer content (release notes, a promo code, a choice of options) goes in `extra`, built from
 * the shared blocks at the bottom of this file (ModalPanel, ModalCodeRow, ModalChoices), so
 * announcements and update prompts look like every other dialog instead of inventing their own.
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
  /** Small icon before the label (size 14). */
  icon?: ReactNode;
  title?: string;
}

export interface ModalDialogProps {
  /** Default true. Pass false to keep the component mounted but hidden. */
  open?: boolean;
  tone?: ModalTone;
  /** Usually a lucide icon at size 26. Pass null to show no badge (e.g. with `image`). */
  icon: ReactNode;
  /** Spin the badge icon (downloading, installing). */
  iconBusy?: boolean;
  /** Small muted label above the title ("Offer", "Notice", "Update required"). */
  eyebrow?: ReactNode;
  /** Cover image across the top of the card. */
  image?: string;
  title: string;
  /** The description: plain text or a <p>. */
  children?: ReactNode;
  /** Full-width block under the description (progress bar, details). */
  extra?: ReactNode;
  /** Small muted line under everything. */
  hint?: ReactNode;
  actions: ModalAction[];
  /** Row under the actions, inside the card (e.g. a pager between several announcements). */
  footer?: ReactNode;
  /** Called for Esc, backdrop click and the corner X (each can be switched off). */
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** Corner X button. Default: shown when `onClose` is given. */
  showClose?: boolean;
  /** Accessible label for the corner X. Default "Close". */
  closeLabel?: string;
  /** "status" for a non-blocking notice (no aria-modal). */
  role?: "dialog" | "alertdialog" | "status";
  zIndex?: number;
  /** Card width in px. Default 440. */
  width?: number;
}

export default function ModalDialog({
  open = true,
  tone = "brand",
  icon,
  iconBusy,
  eyebrow,
  image,
  title,
  children,
  extra,
  hint,
  actions,
  footer,
  onClose,
  closeOnBackdrop,
  closeOnEscape,
  showClose,
  closeLabel = "Close",
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

  if (!open) return null;

  const dialog = (
    <div
      className="mce-modal-backdrop"
      role={role}
      aria-modal={role === "status" ? undefined : "true"}
      aria-labelledby={titleId}
      style={zIndex ? { zIndex } : undefined}
      onClick={backdropCloses ? onClose : undefined}
    >
      <div
        className={`mce-modal${image ? " mce-modal--image" : ""}`}
        style={width ? { maxWidth: width } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {closeShown && onClose && (
          <button type="button" className="mce-modal__close" onClick={onClose} aria-label={closeLabel}>
            <X size={16} />
          </button>
        )}
        {image ? <img className="mce-modal__image" src={image} alt="" /> : null}
        {icon ? (
          <div className={`mce-modal__badge mce-modal__badge--${tone}${iconBusy ? " mce-modal__badge--busy" : ""}`}>{icon}</div>
        ) : null}
        {eyebrow ? <div className={`mce-modal__eyebrow mce-modal__eyebrow--${tone}`}>{eyebrow}</div> : null}
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
              title={action.title}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
        {footer ? <div className="mce-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );

  // Without a document (server-rendered tests) the dialog renders in place.
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
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

/** Bordered, scrollable box for release notes, lists or details inside `extra`. */
export function ModalPanel({ heading, children, maxHeight }: { heading?: ReactNode; children: ReactNode; maxHeight?: number }) {
  return (
    <section className="mce-modal__panel">
      {heading ? <div className="mce-modal__panel-heading">{heading}</div> : null}
      <div className="mce-modal__panel-body" style={maxHeight ? { maxHeight } : undefined}>{children}</div>
    </section>
  );
}

/** A code the person can copy (promo codes). */
export function ModalCodeRow({
  label,
  code,
  note,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  note?: ReactNode;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="mce-modal__code">
      <div className="mce-modal__code-copy">
        <span className="mce-modal__code-label">{label}</span>
        <code className="mce-modal__code-value">{code}</code>
        {note ? <span className="mce-modal__code-note">{note}</span> : null}
      </div>
      {onCopy ? (
        <button type="button" className="mce-modal__code-btn" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}

export interface ModalChoice {
  id: string;
  title: string;
  meta?: string;
  description?: string;
}

/** Pick one of a few options (billing cycle, plan). */
export function ModalChoices({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: ModalChoice[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mce-modal__choices" role="radiogroup" aria-label={label}>
      <div className="mce-modal__panel-heading">{label}</div>
      {choices.map((choice) => {
        const selected = choice.id === value;
        return (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`mce-modal__choice${selected ? " mce-modal__choice--selected" : ""}`}
            onClick={() => onChange(choice.id)}
          >
            <span className="mce-modal__choice-dot" aria-hidden="true" />
            <span className="mce-modal__choice-text">
              <span className="mce-modal__choice-title">{choice.title}</span>
              {choice.description ? <span className="mce-modal__choice-desc">{choice.description}</span> : null}
            </span>
            {choice.meta ? <span className="mce-modal__choice-meta">{choice.meta}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** One-line warning / error inside `extra` ("This is the last day to update"). */
export function ModalNotice({ tone = "warning", icon, children }: { tone?: "warning" | "danger" | "info"; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`mce-modal__notice mce-modal__notice--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

/** Label / value rows (version numbers, details). */
export function ModalFacts({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="mce-modal__facts">
      {rows.map((row) => (
        <div key={row.label} className="mce-modal__facts-row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
