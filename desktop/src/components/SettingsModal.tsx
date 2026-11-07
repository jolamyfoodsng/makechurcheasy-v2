/**
 * SettingsModal — Settings opens over the page you were on, like a dialog,
 * instead of replacing it. Esc, the close button or a click on the dark
 * backdrop returns to that page.
 */
import { useEffect, type ReactNode } from "react";
import { X } from "./icons/NativeIcons";
import "./ModalDialog.css"; // --mce-modal-backdrop / --mce-modal-shadow

interface Props {
  onClose: () => void;
  children: ReactNode;
}

export default function SettingsModal({ onClose, children }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Leave Esc to open menus, pickers and dialogs inside Settings.
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='dialog'], [role='listbox'], [role='menu'], select, input, textarea")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <button type="button" className="settings-modal__close" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
          <X size={16} />
        </button>
        <div className="settings-modal__body">{children}</div>
      </div>
    </div>
  );
}
