/**
 * signupSource.ts — where a new account came from (ChatGPT, TikTok, Facebook, a friend...).
 *
 * The website saves the visitor's first outside arrival in the `mce_src` cookie
 * (see dashboard/src/components/TrafficSourceCapture.tsx): the `?src=` / `?utm_*` link
 * parameters, the site that linked to us and the page they landed on. Sign-up reads that
 * cookie and stores the result on the user as `signupSource`, so the admin can see and
 * count channels.
 *
 * Links to share: https://makechurcheazy.com/?src=tiktok (or ?utm_source=tiktok&utm_campaign=...).
 * `?ref=` stays the friend referral code; `?ref=tiktok` style links still work for the
 * channel names below.
 */

export const SIGNUP_SOURCE_COOKIE = "mce_src";

export type SignupChannel =
  | "chatgpt" | "perplexity" | "gemini" | "claude" | "copilot" | "ai-other"
  | "google" | "bing" | "search-other"
  | "youtube" | "tiktok" | "facebook" | "instagram" | "x" | "linkedin" | "whatsapp" | "telegram" | "reddit"
  | "email" | "friend-referral" | "website" | "direct" | "unknown";

export const SIGNUP_CHANNEL_LABELS: Record<SignupChannel, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
  copilot: "Copilot",
  "ai-other": "Other AI",
  google: "Google",
  bing: "Bing",
  "search-other": "Other search",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  reddit: "Reddit",
  email: "Email",
  "friend-referral": "Friend referral",
  website: "Another website",
  direct: "Direct / typed in",
  unknown: "Unknown",
};

export interface SignupSource {
  channel: SignupChannel;
  label: string;
  /** The raw ?src= / ?utm_source= value, when there was one. */
  source?: string;
  medium?: string;
  campaign?: string;
  /** Host of the site that linked to us, e.g. "www.tiktok.com". */
  referrerHost?: string;
  /** First page they landed on, e.g. "/pricing". */
  landingPath?: string;
  /** Ad click id seen (fbclid, ttclid, gclid...), name only. */
  clickId?: string;
  /** When we first saw them arrive. */
  firstSeenAt?: string;
  /** Account created from the website or the desktop app. */
  signupClient: "web" | "desktop";
  /** Friend referral code used at sign-up, if any. */
  referralCode?: string;
}

/** Words and hosts for each channel. Names are matched in ?src / ?utm_source, hosts in the referrer. */
const CHANNEL_RULES: Array<{ channel: SignupChannel; names: string[]; hosts: string[] }> = [
  { channel: "chatgpt", names: ["chatgpt", "chatgpt.com", "openai", "gpt"], hosts: ["chatgpt.com", "chat.openai.com", "openai.com"] },
  { channel: "perplexity", names: ["perplexity", "perplexity.ai"], hosts: ["perplexity.ai"] },
  { channel: "gemini", names: ["gemini", "bard"], hosts: ["gemini.google.com", "bard.google.com"] },
  { channel: "claude", names: ["claude", "claude.ai", "anthropic"], hosts: ["claude.ai"] },
  { channel: "copilot", names: ["copilot"], hosts: ["copilot.microsoft.com"] },
  { channel: "ai-other", names: ["deepseek", "grok", "meta-ai", "you.com", "phind"], hosts: ["chat.deepseek.com", "grok.com", "you.com", "phind.com", "meta.ai"] },
  { channel: "youtube", names: ["youtube", "yt"], hosts: ["youtube.com", "youtu.be", "m.youtube.com"] },
  { channel: "tiktok", names: ["tiktok", "tt"], hosts: ["tiktok.com"] },
  { channel: "facebook", names: ["facebook", "fb", "meta"], hosts: ["facebook.com", "m.facebook.com", "l.facebook.com", "lm.facebook.com", "fb.com", "fb.me"] },
  { channel: "instagram", names: ["instagram", "ig", "insta"], hosts: ["instagram.com", "l.instagram.com"] },
  { channel: "x", names: ["x", "twitter"], hosts: ["x.com", "twitter.com", "t.co"] },
  { channel: "linkedin", names: ["linkedin", "li"], hosts: ["linkedin.com", "lnkd.in"] },
  { channel: "whatsapp", names: ["whatsapp", "wa"], hosts: ["whatsapp.com", "web.whatsapp.com", "wa.me"] },
  { channel: "telegram", names: ["telegram", "tg"], hosts: ["t.me", "telegram.org", "web.telegram.org"] },
  { channel: "reddit", names: ["reddit"], hosts: ["reddit.com", "old.reddit.com"] },
  { channel: "google", names: ["google", "adwords", "google-ads"], hosts: ["google.com"] },
  { channel: "bing", names: ["bing"], hosts: ["bing.com"] },
  { channel: "search-other", names: ["duckduckgo", "yahoo", "yandex", "ecosia", "brave"], hosts: ["duckduckgo.com", "search.yahoo.com", "yandex.com", "ecosia.org", "search.brave.com"] },
  { channel: "email", names: ["email", "newsletter", "zoho", "mail"], hosts: ["mail.google.com", "outlook.live.com", "mail.yahoo.com"] },
];

const OWN_HOSTS = ["makechurcheazy.com", "makechurcheasy.com"];

function hostMatches(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

/** Channel for a ?src= / ?ref= word, or null when it is not a channel we know. */
export function channelForSourceName(value: unknown): SignupChannel | null {
  const name = String(value || "").trim().toLowerCase();
  if (!name) return null;
  for (const rule of CHANNEL_RULES) {
    if (rule.names.includes(name) || rule.hosts.some((h) => hostMatches(name, h))) return rule.channel;
  }
  return null;
}

/** Channel for the site that linked to us, or null for our own pages / no referrer. */
export function channelForReferrerHost(value: unknown): SignupChannel | null {
  const host = String(value || "").trim().toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  if (OWN_HOSTS.some((own) => hostMatches(host, own))) return null;
  for (const rule of CHANNEL_RULES) {
    if (rule.hosts.some((h) => hostMatches(host, h))) return rule.channel;
  }
  // Any Google country domain (google.co.uk, google.com.ng...).
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  return "website";
}

const CLICK_ID_CHANNELS: Record<string, SignupChannel> = {
  fbclid: "facebook",
  ttclid: "tiktok",
  gclid: "google",
  msclkid: "bing",
  twclid: "x",
  li_fat_id: "linkedin",
};

/** Keep stored text short and plain: it comes from a cookie anyone can edit. */
function clean(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[^\w.\-/:@+ ]/g, "").trim().slice(0, max);
  return text || undefined;
}

export interface RawSignupSource {
  src?: unknown;
  medium?: unknown;
  campaign?: unknown;
  referrer?: unknown;
  landing?: unknown;
  clickId?: unknown;
  firstSeenAt?: unknown;
}

/** Parse the `mce_src` cookie value (URL-encoded JSON). Returns null when missing or unreadable. */
export function parseSignupSourceCookie(value: string | null | undefined): RawSignupSource | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed && typeof parsed === "object" ? parsed as RawSignupSource : null;
  } catch {
    return null;
  }
}

export function classifySignupSource(
  raw: RawSignupSource | null,
  options: { signupClient?: "web" | "desktop"; referralCode?: string | null } = {},
): SignupSource {
  const source = clean(raw?.src)?.toLowerCase();
  const medium = clean(raw?.medium)?.toLowerCase();
  const campaign = clean(raw?.campaign, 120);
  const referrerHost = clean(raw?.referrer, 120)?.toLowerCase();
  const landingPath = clean(raw?.landing, 160);
  const clickId = clean(raw?.clickId, 20)?.toLowerCase();
  const firstSeenAtMs = typeof raw?.firstSeenAt === "string" || typeof raw?.firstSeenAt === "number"
    ? new Date(raw.firstSeenAt).getTime()
    : NaN;
  const referralCode = clean(options.referralCode || "", 40);
  const signupClient = options.signupClient || "web";

  let channel: SignupChannel | null =
    channelForSourceName(source)
    ?? (clickId ? CLICK_ID_CHANNELS[clickId] ?? null : null)
    ?? channelForReferrerHost(referrerHost);
  if (!channel && medium === "email") channel = "email";
  if (!channel && source) channel = "website";
  if (!channel && referralCode) channel = "friend-referral";
  // The desktop app cannot see website visits, so a desktop sign-up with no other clue is unknown.
  if (!channel) channel = raw ? "direct" : signupClient === "desktop" ? "unknown" : "direct";

  const label = channel === "website" && (source || referrerHost)
    ? source || referrerHost!.replace(/^www\./, "")
    : SIGNUP_CHANNEL_LABELS[channel];

  return {
    channel,
    label,
    ...(source ? { source } : {}),
    ...(medium ? { medium } : {}),
    ...(campaign ? { campaign } : {}),
    ...(referrerHost ? { referrerHost } : {}),
    ...(landingPath ? { landingPath } : {}),
    ...(clickId ? { clickId } : {}),
    ...(Number.isFinite(firstSeenAtMs) ? { firstSeenAt: new Date(firstSeenAtMs).toISOString() } : {}),
    signupClient,
    ...(referralCode ? { referralCode } : {}),
  };
}

type CookieRequest = {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
};

/** Where this sign-up request came from: the website's `mce_src` cookie, plus app/referral hints. */
export function signupSourceFromRequest(req: CookieRequest, referralCode?: string | null): SignupSource {
  const raw = parseSignupSourceCookie(req.cookies.get(SIGNUP_SOURCE_COOKIE)?.value);
  const fromDesktop = Boolean(req.headers.get("x-app-version") || req.headers.get("x-device-id") || req.headers.get("x-mce-device-id"));
  return classifySignupSource(raw, { signupClient: fromDesktop ? "desktop" : "web", referralCode });
}
