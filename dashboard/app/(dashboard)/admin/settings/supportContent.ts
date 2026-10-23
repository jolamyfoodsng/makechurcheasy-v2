/**
 * supportContent.ts — the desktop app's Support window, as edited in Controls → Support window.
 * Mirrors api/src/lib/supportContent.ts (the API cleans and stores it) and
 * desktop/src/services/supportContent.ts (the app shows it).
 */

export type SupportChannelKind = "whatsapp" | "telegram" | "email" | "phone" | "youtube" | "website";

export interface SupportChannel {
  id: string;
  kind: SupportChannelKind;
  label: string;
  description: string;
  value: string;
  enabled: boolean;
}

export interface SupportContent {
  /** Filled in from the channels when saved; used by emails. */
  whatsappUrl: string;
  youtubeUrl: string;
  supportEmail: string;
  title: string;
  subtitle: string;
  status: { online: boolean; text: string };
  primaryChannelId: string;
  channels: SupportChannel[];
  emergency: { enabled: boolean; title: string; description: string; phone: string };
}

export const SUPPORT_CHANNEL_KINDS: Array<{ value: SupportChannelKind; label: string; valueLabel: string; placeholder: string }> = [
  { value: "whatsapp", label: "WhatsApp", valueLabel: "WhatsApp number or link", placeholder: "+234 905 454 5286" },
  { value: "telegram", label: "Telegram", valueLabel: "Telegram link", placeholder: "https://t.me/…" },
  { value: "email", label: "Email", valueLabel: "Email address", placeholder: "support@makechurcheazy.com" },
  { value: "phone", label: "Phone", valueLabel: "Phone number", placeholder: "+234 906 945 5406" },
  { value: "youtube", label: "YouTube", valueLabel: "YouTube link", placeholder: "https://www.youtube.com/…" },
  { value: "website", label: "Website / other link", valueLabel: "Link", placeholder: "https://…" },
];

export const MAX_SUPPORT_CHANNELS = 12;

/** "" when the value fits the channel kind, otherwise what is wrong. */
export function supportValueProblem(kind: SupportChannelKind, value: string): string {
  const v = value.trim();
  if (!v) return "Add a link or number, or switch this channel off.";
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter an email address.";
  if (kind === "phone") return /^\+?[0-9 ()-]{5,25}$/.test(v) ? "" : "Enter a phone number, e.g. +234 906 945 5406.";
  if (kind === "whatsapp" && !/^https?:\/\//i.test(v)) {
    return whatsappChatLink(v) ? "" : "Enter the number with its country code (e.g. +234 905 454 5286), or a WhatsApp link.";
  }
  return /^https?:\/\/\S+$/i.test(v) ? "" : "Enter a full link starting with https://";
}

/**
 * A wa.me link that opens a WhatsApp chat with this number, or "" when it isn't a full
 * international number. The API turns WhatsApp numbers into these links on save.
 */
export function whatsappChatLink(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (!/^\+?[0-9 ()-]{5,25}$/.test(phone.trim()) || digits.startsWith("0") || digits.length < 8 || digits.length > 15) return "";
  return `https://wa.me/${digits}`;
}

/** The community group link that was the WhatsApp default before; treated as "not changed". */
const OLD_DEFAULT_WHATSAPP = "https://chat.whatsapp.com/EQIuXfpCTBOG7YOSf2nKqU?mode=gi_t";

export const DEFAULT_SUPPORT_CONTENT: SupportContent = {
  whatsappUrl: "https://wa.me/2349054545286",
  youtubeUrl: "https://www.youtube.com/playlist?list=PLRua6gJfgC0o",
  supportEmail: "support@makechurcheazy.com",
  title: "Get help",
  subtitle: "We're here to help Sunday run smoothly.",
  status: { online: true, text: "Our team usually replies within minutes." },
  primaryChannelId: "whatsapp",
  channels: [
    { id: "whatsapp", kind: "whatsapp", label: "Chat on WhatsApp", description: "Message our support team directly.", value: "https://wa.me/2349054545286", enabled: true },
    { id: "telegram", kind: "telegram", label: "Telegram", description: "Chat with us at @makechurcheasy.", value: "https://t.me/makechurcheasy", enabled: true },
    { id: "email", kind: "email", label: "Email", description: "We reply within one working day.", value: "support@makechurcheazy.com", enabled: true },
    { id: "videos", kind: "youtube", label: "Help videos", description: "Step-by-step tutorials on YouTube.", value: "https://www.youtube.com/playlist?list=PLRua6gJfgC0o", enabled: true },
  ],
  emergency: {
    enabled: true,
    title: "Sunday emergency hotline",
    description: "Something stopped working during the service? Message us on WhatsApp.",
    phone: "+234 906 945 5406",
  },
};

/** Fills in what an older API leaves out (it only sends the three links). */
export function withSupportDefaults(raw: Partial<SupportContent> | undefined): SupportContent {
  const d = DEFAULT_SUPPORT_CONTENT;
  if (raw && Array.isArray(raw.channels)) {
    return {
      ...d,
      ...raw,
      status: { ...d.status, ...(raw.status ?? {}) },
      emergency: { ...d.emergency, ...(raw.emergency ?? {}) },
      channels: raw.channels,
    };
  }
  const legacy: Partial<Record<SupportChannelKind, string | undefined>> = {
    whatsapp: raw?.whatsappUrl,
    youtube: raw?.youtubeUrl,
    email: raw?.supportEmail,
  };
  return {
    ...d,
    channels: d.channels.map((c) => {
      const value = legacy[c.kind];
      return value === undefined || value === OLD_DEFAULT_WHATSAPP ? { ...c } : { ...c, value, enabled: value.trim() !== "" };
    }),
  };
}
