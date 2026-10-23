/**
 * adminControls.ts — helpers for Admin → Settings → Controls.
 * (Device limits live in plan_config entitlements.devices, see deviceLimits.ts.)
 */

import { NextResponse } from "next/server";
import {
  DEFAULT_ADMIN_CONTROLS,
  getPlatformSettings,
  type AdminControls,
  type FeatureSwitchKey,
  type PaymentProviderKey,
} from "./platformSettings";
import { normalizeSupportContent } from "./supportContent";

export async function getAdminControls(): Promise<AdminControls> {
  try {
    return (await getPlatformSettings()).controls ?? DEFAULT_ADMIN_CONTROLS;
  } catch {
    return DEFAULT_ADMIN_CONTROLS;
  }
}

const PROVIDER_LABELS: Record<PaymentProviderKey, string> = {
  flutterwave: "Flutterwave",
  mtnMomo: "MTN MoMo",
  nowpayments: "Crypto (NOWPayments)",
};

export async function isPaymentProviderEnabled(provider: PaymentProviderKey): Promise<boolean> {
  const controls = await getAdminControls();
  return controls.paymentProviders?.[provider] !== false;
}

/** Returns a 503 response when the provider is switched off, otherwise null. */
export async function paymentProviderDisabledResponse(provider: PaymentProviderKey): Promise<NextResponse | null> {
  if (await isPaymentProviderEnabled(provider)) return null;
  return NextResponse.json(
    {
      error: `${PROVIDER_LABELS[provider]} payments are turned off right now. Please choose another payment method.`,
      code: "PAYMENT_PROVIDER_DISABLED",
      provider,
    },
    { status: 503 },
  );
}

export async function isFeatureEnabled(feature: FeatureSwitchKey): Promise<boolean> {
  const controls = await getAdminControls();
  return controls.features?.[feature] !== false;
}

// ── Signup abuse ─────────────────────────────────────────────────────────────

/** Common throwaway email providers. Admins can add more in Controls. */
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmailo.com",
  "throwawaymail.com", "yopmail.com", "yopmail.net", "getnada.com", "nada.email", "trashmail.com",
  "trashmail.de", "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "fakeinbox.com",
  "emailondeck.com", "moakt.com", "mohmal.com", "spamgourmet.com", "mytemp.email", "tempr.email",
  "burnermail.io", "inboxkitten.com", "mailpoof.com", "emailfake.com", "fakemail.net", "luxusmail.org",
  "tmail.ws", "tmpmail.org", "tmpmail.net", "discard.email", "mail.tm", "mail.gw", "1secmail.com",
  "1secmail.net", "1secmail.org", "byom.de", "spambox.us", "mailcatch.com", "harakirimail.com",
  "33mail.com", "anonaddy.me", "minuteinbox.com", "tempinbox.com", "dropmail.me", "emltmp.com",
]);

export function emailDomain(email: string): string {
  return String(email || "").trim().toLowerCase().split("@").pop() || "";
}

export function isBlockedEmailDomain(email: string, controls: AdminControls): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  const extra = (controls.signup?.blockedDomains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (extra.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (controls.signup?.blockDisposableEmails === false) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "";
}

// ── Sanitizer for the admin PUT ──────────────────────────────────────────────

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function int(value: unknown, fallback: number, min = 0, max = 100_000): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function sanitizeAdminControls(raw: Record<string, unknown>): AdminControls {
  const d = DEFAULT_ADMIN_CONTROLS;
  const r = raw as Partial<Record<keyof AdminControls, Record<string, unknown>>>;
  const pp = r.paymentProviders ?? {};
  const f = r.features ?? {};
  const sp = r.speech ?? {};
  const su = r.signup ?? {};
  const st = r.support ?? {};
  const model = sp.model === "universal-streaming-multilingual" ? "universal-streaming-multilingual" : "universal-streaming-english";
  const domains = Array.isArray(su.blockedDomains)
    ? su.blockedDomains
    : String(su.blockedDomains ?? "").split(/[\s,]+/);
  return {
    paymentProviders: {
      flutterwave: bool(pp.flutterwave, d.paymentProviders.flutterwave),
      mtnMomo: bool(pp.mtnMomo, d.paymentProviders.mtnMomo),
      nowpayments: bool(pp.nowpayments, d.paymentProviders.nowpayments),
    },
    features: {
      speechToScripture: bool(f.speechToScripture, true),
      liveTranslation: bool(f.liveTranslation, true),
      mobileRemote: bool(f.mobileRemote, true),
      multistream: bool(f.multistream, true),
      presentationLink: bool(f.presentationLink, true),
    },
    speech: {
      model,
      dailyMinutesCap: int(sp.dailyMinutesCap, 0, 0, 1440),
    },
    signup: {
      maxSignupsPerIpPerDay: int(su.maxSignupsPerIpPerDay, d.signup.maxSignupsPerIpPerDay, 0, 1000),
      maxSignupsPerDevicePerDay: int(su.maxSignupsPerDevicePerDay, d.signup.maxSignupsPerDevicePerDay, 0, 1000),
      blockDisposableEmails: bool(su.blockDisposableEmails, true),
      blockedDomains: [...new Set(domains.map((x) => String(x).trim().toLowerCase().replace(/^@/, "")).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))].slice(0, 500),
    },
    support: normalizeSupportContent(st),
  };
}

export interface SignupAbuseCheck {
  ok: boolean;
  code?: "disposable_email" | "too_many_signups_ip" | "too_many_signups_device";
  error?: string;
}

/**
 * Checks Admin → Settings → Controls signup rules before creating an account.
 * Counts accounts created from the same IP / device in the last 24 hours.
 */
export async function checkSignupAbuse(
  db: import("mongodb").Db,
  input: { email: string; ip?: string; deviceId?: string },
): Promise<SignupAbuseCheck> {
  const controls = await getAdminControls();
  if (isBlockedEmailDomain(input.email, controls)) {
    return {
      ok: false,
      code: "disposable_email",
      error: "Please sign up with a permanent email address (temporary email providers aren't allowed).",
    };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const createdSince = { $or: [{ createdAt: { $gte: since.toISOString() } }, { createdAt: { $gte: since } }] };
  const ipLimit = controls.signup?.maxSignupsPerIpPerDay ?? 0;
  const ip = String(input.ip || "").trim();
  if (ipLimit > 0 && ip) {
    const count = await db.collection("users").countDocuments({ signupIp: ip, ...createdSince });
    if (count >= ipLimit) {
      return {
        ok: false,
        code: "too_many_signups_ip",
        error: "Too many accounts have been created from this network today. Please try again tomorrow or contact support.",
      };
    }
  }
  const deviceLimit = controls.signup?.maxSignupsPerDevicePerDay ?? 0;
  const deviceId = String(input.deviceId || "").trim();
  if (deviceLimit > 0 && deviceId) {
    const count = await db.collection("users").countDocuments({ signupDeviceId: deviceId, ...createdSince });
    if (count >= deviceLimit) {
      return {
        ok: false,
        code: "too_many_signups_device",
        error: "Too many accounts have been created on this computer today. Please sign in to your existing account.",
      };
    }
  }
  return { ok: true };
}

/** Device id sent by the desktop app on signup (header or body). */
export function signupDeviceIdFromRequest(req: Request, body?: { installationId?: unknown; deviceId?: unknown }): string {
  const fromBody = String(body?.installationId ?? body?.deviceId ?? "").trim();
  const fromHeader = req.headers.get("x-device-id") || req.headers.get("x-mce-installation-id") || "";
  return (fromBody || fromHeader).trim().slice(0, 200);
}
