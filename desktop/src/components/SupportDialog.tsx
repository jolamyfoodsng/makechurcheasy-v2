/**
 * SupportDialog.tsx — the Support window (sidebar → Support).
 *
 * Every word, link and number comes from Admin → Settings → Controls (useAdminControls().support,
 * see services/supportContent.ts): the title, the live-support line, the contact channels in the
 * admin's order with the main one as the large button, and the Sunday emergency hotline.
 * Built on the shared ModalDialog; styles in supportDialog.css (theme tokens only).
 */
import type { ReactNode } from "react";
import ModalDialog from "./ModalDialog";
import { ExternalLink, Globe, HelpCircle, Mail, MessageCircle, Phone, Send, Youtube } from "./icons/NativeIcons";
import { whatsappChatLink, type SupportChannel, type SupportChannelKind, type SupportContent } from "../services/supportContent";
import "./supportDialog.css";

const CHANNEL_ICONS: Record<SupportChannelKind, (size: number) => ReactNode> = {
  whatsapp: (size) => <MessageCircle size={size} />,
  telegram: (size) => <Send size={size} />,
  email: (size) => <Mail size={size} />,
  phone: (size) => <Phone size={size} />,
  youtube: (size) => <Youtube size={size} />,
  website: (size) => <Globe size={size} />,
};

/** The link a channel opens: a web address, mailto: or tel:. */
export function supportChannelHref(channel: Pick<SupportChannel, "kind" | "value">): string {
  if (channel.kind === "email") return `mailto:${channel.value}`;
  if (channel.kind === "phone") return `tel:${channel.value.replace(/[^\d+]/g, "")}`;
  return channel.value;
}

/** Channels that can be shown: switched on and with a link or number. */
export function visibleSupportChannels(content: SupportContent): { primary: SupportChannel | null; others: SupportChannel[] } {
  const shown = content.channels.filter((c) => c.enabled && c.value);
  const primary = shown.find((c) => c.id === content.primaryChannelId) ?? null;
  return { primary, others: shown.filter((c) => c !== primary) };
}

function linkProps(channel: SupportChannel) {
  const external = channel.kind !== "email" && channel.kind !== "phone";
  return {
    href: supportChannelHref(channel),
    ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}),
  };
}

/** The hotline opens a WhatsApp chat with the number (a computer can't place a phone call). */
function emergencyLink(phone: string) {
  const chat = whatsappChatLink(phone);
  return chat
    ? { href: chat, target: "_blank", rel: "noopener noreferrer", title: "Chat on WhatsApp" }
    : { href: supportChannelHref({ kind: "phone", value: phone }) };
}

export default function SupportDialog({ content, onClose }: { content: SupportContent; onClose: () => void }) {
  const { primary, others } = visibleSupportChannels(content);
  const emergency = content.emergency.enabled && content.emergency.phone ? content.emergency : null;

  return (
    <ModalDialog
      icon={<HelpCircle size={26} />}
      title={content.title}
      width={480}
      onClose={onClose}
      actions={[{ label: "Done", onClick: onClose, variant: "ghost" }]}
      extra={
        <div className="support-dialog">
          {content.status.text && (
            <p className={`support-status${content.status.online ? " is-online" : ""}`}>
              <span className="support-status__dot" aria-hidden="true" />
              {content.status.text}
            </p>
          )}

          {primary && (
            <a className="support-primary" {...linkProps(primary)}>
              <span className="support-primary__icon" aria-hidden="true">{CHANNEL_ICONS[primary.kind](20)}</span>
              <span className="support-primary__text">
                <strong>{primary.label}</strong>
                {primary.description && <span>{primary.description}</span>}
              </span>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          )}

          {others.length > 0 && (
            <ul className="support-channels" aria-label="Other ways to reach us">
              {others.map((channel) => (
                <li key={channel.id}>
                  <a className="support-channel" {...linkProps(channel)}>
                    <span className="support-channel__icon" aria-hidden="true">{CHANNEL_ICONS[channel.kind](18)}</span>
                    <span className="support-channel__text">
                      <strong>{channel.label}</strong>
                      {channel.description && <span>{channel.description}</span>}
                    </span>
                    <ExternalLink size={14} aria-hidden="true" className="support-channel__go" />
                  </a>
                </li>
              ))}
            </ul>
          )}

          {emergency && (
            <a className="support-emergency" {...emergencyLink(emergency.phone)}>
              <span className="support-emergency__icon" aria-hidden="true"><Phone size={18} /></span>
              <span className="support-emergency__text">
                <strong>{emergency.title}</strong>
                {emergency.description && <span>{emergency.description}</span>}
              </span>
              <span className="support-emergency__number">
                {whatsappChatLink(emergency.phone) && <MessageCircle size={14} aria-label="WhatsApp" />}
                {emergency.phone}
              </span>
            </a>
          )}

          {!primary && others.length === 0 && !emergency && (
            <p className="support-empty">Support contacts aren't available right now. Please try again later.</p>
          )}
        </div>
      }
    >
      {content.subtitle || null}
    </ModalDialog>
  );
}
