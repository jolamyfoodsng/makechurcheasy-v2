import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { onDockDisplayNotice } from "../dockDisplayOutputClient";
import "./DockSceneRoutingControl.css";

const NOTICE_MS = 8000;

/** "Send to a display" messages: a projector was opened, or something could not be shown (display missing or unplugged). */
export default function DockDisplayOutputNotice() {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "warning" } | null>(null);
  const message = notice?.message ?? "";

  useEffect(() => onDockDisplayNotice((next, tone) => setNotice({ message: next, tone })), []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className={`dock-display-output-notice${notice?.tone === "info" ? " is-info" : ""}`} role="status" aria-live="polite">
      <Icon name={notice?.tone === "info" ? "tv" : "warning"} size={14} className="dock-display-output-notice__icon" />
      <span className="dock-display-output-notice__text">{message}</span>
      <button
        type="button"
        className="dock-btn dock-btn--ghost dock-btn--compact dock-display-output-notice__close"
        onClick={() => setNotice(null)}
        aria-label={t("common.close", "Close")}
        title={t("common.close", "Close")}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
