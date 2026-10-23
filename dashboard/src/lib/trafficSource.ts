/**
 * trafficSource.ts — remember where a website visitor first came from, for the sign-up.
 *
 * Saved in the first-party `mce_src` cookie, which the API reads when the account is
 * created (api/src/lib/signupSource.ts turns it into a channel such as "TikTok").
 *
 * Share links like https://makechurcheazy.com/?src=tiktok or ?utm_source=tiktok&utm_campaign=easter.
 * `?ref=` is the friend referral code; a `?ref=` holding a channel word below is treated as a source.
 */

export const TRAFFIC_SOURCE_COOKIE = "mce_src";
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Channel words accepted in ?ref= (keep in step with CHANNEL_RULES names in api/src/lib/signupSource.ts). */
const CHANNEL_WORDS = new Set([
  "chatgpt", "openai", "gpt", "perplexity", "gemini", "bard", "claude", "copilot", "deepseek", "grok",
  "youtube", "yt", "tiktok", "tt", "facebook", "fb", "meta", "instagram", "ig", "insta", "x", "twitter",
  "linkedin", "li", "whatsapp", "wa", "telegram", "tg", "reddit", "google", "bing", "email", "newsletter",
]);

/** True when a ?ref= value is a channel name (e.g. "tiktok") rather than a friend's referral code. */
export function isTrafficSourceWord(value: string | null | undefined): boolean {
  return CHANNEL_WORDS.has(String(value || "").trim().toLowerCase());
}

const CLICK_IDS = ["fbclid", "ttclid", "gclid", "msclkid", "twclid", "li_fat_id"];
const OWN_HOST = /(^|\.)makechurche[az]sy\.com$|^localhost$|^127\.0\.0\.1$/;

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

/**
 * Save this visit's source if it came from outside and nothing is saved yet (first outside touch wins).
 * Call once per page load.
 */
export function captureTrafficSource(): void {
  try {
    if (readCookie(TRAFFIC_SOURCE_COOKIE)) return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const refParam = params.get("ref");
    const src =
      params.get("src") ||
      params.get("source") ||
      params.get("utm_source") ||
      (isTrafficSourceWord(refParam) ? refParam : null);
    const clickId = CLICK_IDS.find((id) => params.has(id)) || null;

    let referrer: string | null = null;
    try {
      const host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : "";
      if (host && !OWN_HOST.test(host) && host !== window.location.hostname) referrer = host;
    } catch {
      // Unreadable referrer: ignore it.
    }

    if (!src && !clickId && !referrer && !params.get("utm_medium")) return;

    const value = encodeURIComponent(JSON.stringify({
      src: src || undefined,
      medium: params.get("utm_medium") || undefined,
      campaign: params.get("utm_campaign") || undefined,
      referrer: referrer || undefined,
      landing: url.pathname,
      clickId: clickId || undefined,
      firstSeenAt: new Date().toISOString(),
    })).slice(0, 1500);

    // Shared by makechurcheazy.com and www so the sign-up (and Google sign-in return) can read it.
    const domain = /(^|\.)makechurcheazy\.com$/.test(window.location.hostname) ? "; domain=.makechurcheazy.com" : "";
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${TRAFFIC_SOURCE_COOKIE}=${value}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax${domain}${secure}`;
  } catch {
    // Cookies blocked: the sign-up is recorded as direct.
  }
}
