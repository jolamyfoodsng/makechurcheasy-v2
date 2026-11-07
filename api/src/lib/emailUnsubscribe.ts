/**
 * Signed unsubscribe links for marketing email.
 *
 * The token carries the user id and is signed, so a link cannot be forged for
 * someone else. Links never expire: an unsubscribe link that stops working is
 * worse than none.
 */
import crypto from "crypto";

let warned = false;

/** The secret that signs links in our emails (unsubscribe, open and click tracking). */
export function emailLinkSecret(): string {
  const value =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (value) return value;
  if (!warned && process.env.NODE_ENV === "production") {
    warned = true;
    console.warn("[emailUnsubscribe] No signing secret is configured; using a built-in development value.");
  }
  return "makechurcheasy-unsubscribe-dev";
}

function sign(userId: string): string {
  return crypto.createHmac("sha256", emailLinkSecret()).update(`unsubscribe:marketing:${userId}`).digest("hex").slice(0, 40);
}

export function createUnsubscribeToken(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Returns the user id when the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(userId);
  if (signature.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return ok ? userId : null;
}

export function buildUnsubscribeUrl(userId: string): string {
  const base = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com").replace(/\/$/, "");
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId))}`;
}
