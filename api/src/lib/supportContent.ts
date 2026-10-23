/**
 * supportContent.ts — the desktop app's Support window, edited in Admin → Settings → Controls.
 *
 * Everything the window shows is here: its title, the "live support" status, the contact
 * channels (in order, each with its own label, description, link and on/off switch, one of
 * them the main one) and the Sunday emergency hotline. The desktop app keeps a copy of the
 * defaults and of normalizeSupportContent (desktop/src/services/supportContent.ts) for
 * servers that still send the older three-link format.
 *
 * whatsappUrl, youtubeUrl and supportEmail are kept for the emails that link to support; they
 * are filled in from the channels on save.
 */

export type SupportChannelKind = "whatsapp" | "telegram" | "email" | "phone" | "youtube" | "website";

export interface SupportChannel {
  id: string;
  kind: SupportChannelKind;
  label: string;
  description: string;
  /** A link for whatsapp / telegram / youtube / website, an address for email, a number for phone. */
  value: string;
  enabled: boolean;
}

export interface SupportContent {
  whatsappUrl: string;
  youtubeUrl: string;
  supportEmail: string;
  title: string;
  subtitle: string;
  /** Drives the green "live support" dot in the sidebar and the line under the title. */
  status: { online: boolean; text: string };
  /** The channel shown as the large button at the top. */
  primaryChannelId: string;
  channels: SupportChannel[];
  emergency: { enabled: boolean; title: string; description: string; phone: string };
}

export const SUPPORT_CHANNEL_KINDS: SupportChannelKind[] = ["whatsapp", "telegram", "email", "phone", "youtube", "website"];
export const MAX_SUPPORT_CHANNELS = 12;

const SUPPORT_PHONE = "+234 906 945 5406";
/** A WhatsApp chat with the support number. */
const DEFAULT_WHATSAPP = "https://wa.me/2349054545286";
/** The community group link that was the WhatsApp default before; treated as "not changed". */
const OLD_DEFAULT_WHATSAPP = "https://chat.whatsapp.com/EQIuXfpCTBOG7YOSf2nKqU?mode=gi_t";
const DEFAULT_YOUTUBE = "https://www.youtube.com/playlist?list=PLRua6gJfgC0o";
const DEFAULT_EMAIL = "support@makechurcheazy.com";

export const DEFAULT_SUPPORT_CHANNELS: SupportChannel[] = [
  { id: "whatsapp", kind: "whatsapp", label: "Chat on WhatsApp", description: "Message our support team directly.", value: DEFAULT_WHATSAPP, enabled: true },
  { id: "telegram", kind: "telegram", label: "Telegram", description: "Chat with us at @makechurcheasy.", value: "https://t.me/makechurcheasy", enabled: true },
  { id: "email", kind: "email", label: "Email", description: "We reply within one working day.", value: DEFAULT_EMAIL, enabled: true },
  { id: "videos", kind: "youtube", label: "Help videos", description: "Step-by-step tutorials on YouTube.", value: DEFAULT_YOUTUBE, enabled: true },
];

export const DEFAULT_SUPPORT_CONTENT: SupportContent = {
  whatsappUrl: DEFAULT_WHATSAPP,
  youtubeUrl: DEFAULT_YOUTUBE,
  supportEmail: DEFAULT_EMAIL,
  title: "Get help",
  subtitle: "We're here to help Sunday run smoothly.",
  status: { online: true, text: "Our team usually replies within minutes." },
  primaryChannelId: "whatsapp",
  channels: DEFAULT_SUPPORT_CHANNELS,
  emergency: {
    enabled: true,
    title: "Sunday emergency hotline",
    description: "Something stopped working during the service? Message us on WhatsApp.",
    phone: SUPPORT_PHONE,
  },
};

function text(value: unknown, max: number, fallback = ""): string {
  const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (v || fallback).slice(0, max);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string): boolean {
  return /^\+?[0-9 ()-]{5,25}$/.test(value);
}

/**
 * A wa.me link that opens a WhatsApp chat with this number, or "" when it isn't a full
 * international number (country code first, e.g. +234 906 945 5406).
 */
export function whatsappChatLink(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (!isPhone(phone.trim()) || digits.startsWith("0") || digits.length < 8 || digits.length > 15) return "";
  return `https://wa.me/${digits}`;
}

/** The value if it fits the channel kind, otherwise "". */
export function cleanChannelValue(kind: SupportChannelKind, raw: unknown): string {
  const value = text(raw, 500);
  if (!value) return "";
  if (kind === "email") return isEmail(value) ? value : "";
  if (kind === "phone") return isPhone(value) ? value : "";
  // WhatsApp also takes a phone number and turns it into a chat link.
  if (kind === "whatsapp" && !isHttpUrl(value)) return whatsappChatLink(value);
  return isHttpUrl(value) ? value : "";
}

function cleanChannel(raw: unknown, index: number, usedIds: Set<string>): SupportChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = SUPPORT_CHANNEL_KINDS.includes(r.kind as SupportChannelKind) ? (r.kind as SupportChannelKind) : "website";
  let id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : `channel-${index + 1}`;
  while (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);
  const value = cleanChannelValue(kind, r.value);
  return {
    id,
    kind,
    label: text(r.label, 60, kind === "email" ? "Email" : "Contact us"),
    description: text(r.description, 140),
    value,
    // A channel without a usable link or number can't be shown.
    enabled: r.enabled !== false && value !== "",
  };
}

const firstValue = (channels: SupportChannel[], kind: SupportChannelKind) =>
  channels.find((c) => c.kind === kind && c.enabled)?.value ?? "";

/**
 * Cleans what an admin saved (or what is stored) into a complete SupportContent. Stored settings
 * from before the Support editor only have the three links: the default channels are used, with
 * those links in them.
 */
export function normalizeSupportContent(raw: unknown): SupportContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SUPPORT_CONTENT;

  let channels: SupportChannel[];
  if (Array.isArray(r.channels)) {
    const used = new Set<string>();
    channels = r.channels
      .slice(0, MAX_SUPPORT_CHANNELS)
      .map((c, i) => cleanChannel(c, i, used))
      .filter((c): c is SupportChannel => c !== null);
  } else {
    const legacy: Partial<Record<SupportChannelKind, unknown>> = {
      whatsapp: r.whatsappUrl,
      youtube: r.youtubeUrl,
      email: r.supportEmail,
    };
    channels = d.channels.map((c) => {
      if (!(c.kind in legacy) || legacy[c.kind] === undefined || legacy[c.kind] === OLD_DEFAULT_WHATSAPP) return { ...c };
      const value = cleanChannelValue(c.kind, legacy[c.kind]);
      return { ...c, value, enabled: value !== "" };
    });
  }

  const status = (r.status && typeof r.status === "object" ? r.status : {}) as Record<string, unknown>;
  const emergency = (r.emergency && typeof r.emergency === "object" ? r.emergency : {}) as Record<string, unknown>;
  const emergencyPhone = text(emergency.phone, 25, emergency.phone === undefined ? d.emergency.phone : "");
  const requestedPrimary = typeof r.primaryChannelId === "string" ? r.primaryChannelId : d.primaryChannelId;
  const primary = channels.find((c) => c.id === requestedPrimary && c.enabled) ?? channels.find((c) => c.enabled);

  return {
    whatsappUrl: firstValue(channels, "whatsapp"),
    youtubeUrl: firstValue(channels, "youtube"),
    supportEmail: firstValue(channels, "email"),
    title: text(r.title, 60, d.title),
    subtitle: text(r.subtitle, 140, r.subtitle === undefined ? d.subtitle : ""),
    status: {
      online: typeof status.online === "boolean" ? status.online : d.status.online,
      text: text(status.text, 140, status.text === undefined ? d.status.text : ""),
    },
    primaryChannelId: primary?.id ?? "",
    channels,
    emergency: {
      enabled: emergency.enabled !== false && isPhone(emergencyPhone),
      title: text(emergency.title, 60, d.emergency.title),
      description: text(emergency.description, 140, emergency.description === undefined ? d.emergency.description : ""),
      phone: isPhone(emergencyPhone) ? emergencyPhone : "",
    },
  };
}
