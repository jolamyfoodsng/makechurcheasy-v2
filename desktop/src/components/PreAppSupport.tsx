/**
 * PreAppSupport.tsx — "Need help?" on the screens before the app opens (sign in, sign up,
 * onboarding). The sidebar's Support isn't there yet, so this corner card gives churches a way
 * to reach us while they get set up. Same content as the Support window (Admin → Settings → Controls).
 */
import { useState } from "react";
import SupportDialog, { supportChannelHref, visibleSupportChannels } from "./SupportDialog";
import { HelpCircle, MessageCircle } from "./icons/NativeIcons";
import { useAdminControls } from "../hooks/useAdminControls";
import "./preAppSupport.css";

export default function PreAppSupport() {
  const support = useAdminControls().support;
  const [open, setOpen] = useState(false);
  const { primary } = visibleSupportChannels(support);
  const chat = primary?.kind === "whatsapp" || primary?.kind === "telegram" ? primary : null;

  return (
    <>
      <aside className="pre-app-support" aria-label="Support">
        <div className="pre-app-support__copy">
          <strong>
            {support.status.online && <span className="pre-app-support__dot" aria-hidden="true" />}
            Need help getting set up?
          </strong>
          <span>{support.status.text || "Chat with our team any time."}</span>
        </div>
        <div className="pre-app-support__actions">
          {chat && (
            <a
              className="pre-app-support__btn pre-app-support__btn--primary"
              href={supportChannelHref(chat)}
              target="_blank"
              rel="noopener noreferrer"
              title={chat.label}
            >
              <MessageCircle size={14} aria-hidden="true" />
              Chat with us
            </a>
          )}
          <button type="button" className="pre-app-support__btn" onClick={() => setOpen(true)} title="All the ways to reach us">
            <HelpCircle size={14} aria-hidden="true" />
            {chat ? "More" : "Get help"}
          </button>
        </div>
      </aside>
      {open && <SupportDialog content={support} onClose={() => setOpen(false)} />}
    </>
  );
}
