/**
 * emailTemplates.ts — Shared email layout, components, and template functions.
 *
 * Provider:
 *   - Development: nodemailer via local MailDev SMTP (localhost:1025) or console
 *   - Production:  Cloudflare Email Service (sole transactional email provider)
 *
 * Configure via environment variables:
 *   EMAIL_PROVIDER  — cloudflare (default) or console
 *   CLOUDFLARE_EMAIL_ACCOUNT_ID / CLOUDFLARE_EMAIL_API_TOKEN — Cloudflare sender credentials
 *   EMAIL_FROM      — sender address (default: noreply@notifications.makechurcheazy.com)
 */

import nodemailer from "nodemailer";
import { renderEmailHtml } from "./emailBranding";
import { resolveTransactionalSender, sendTransactionalEmail } from "./emailProvider";
import { logEmailEvent } from "./emailLog";

// ─── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_EMAIL_FROM = "noreply@notifications.makechurcheazy.com";
const APPROVED_EMAIL_SENDER_DOMAIN = "notifications.makechurcheazy.com";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "MakeChurchEazy";
const EMAIL_FROM = resolveEmailFrom(process.env.EMAIL_FROM);
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@makechurcheazy.com";
const COMMUNITY_URL = "https://chat.whatsapp.com/EQIuXfpCTBOG7YOSf2nKqU?mode=gi_t";

function extractEmailAddress(value: string): string {
  const bracketMatch = value.match(/<([^>]+)>/);
  return (bracketMatch?.[1] || value).trim().replace(/^["']|["']$/g, "");
}

function resolveEmailFrom(value: string | undefined): string {
  const raw = (value || DEFAULT_EMAIL_FROM).trim();
  const email = extractEmailAddress(raw);
  const domain = email.split("@")[1]?.toLowerCase() || "";

  if (domain !== APPROVED_EMAIL_SENDER_DOMAIN) {
    if (value) {
      console.warn(`[email] Ignoring unverified sender domain "${domain}". Using ${DEFAULT_EMAIL_FROM}.`);
    }
    return DEFAULT_EMAIL_FROM;
  }

  return email;
}

function formatEmailFrom(): string {
  return `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`;
}

// ─── Dev SMTP Transport (MailDev) ───────────────────────────────────────────

let _devTransporter: nodemailer.Transporter | null = null;

function getDevTransporter(): nodemailer.Transporter {
  if (!_devTransporter) {
    _devTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "localhost",
      port: parseInt(process.env.SMTP_PORT || "1025", 10),
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    console.log("[email] Dev SMTP transport created → MailDev at localhost:1025");
  }
  return _devTransporter;
}

// ─── Send Utility ───────────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, html } = options;
  const renderedHtml = await renderEmailHtml(html, { recipient: to });
  console.log(`[email] To: ${to} | Subject: ${subject}`);

  // ── Development: route through MailDev SMTP or real provider if requested ──
  const useRealInDev = process.env.EMAIL_DEV_SEND_REAL === "true";
  if (process.env.NODE_ENV === "development" && !useRealInDev) {
    try {
      const transporter = getDevTransporter();
      const info = await transporter.sendMail({
        from: formatEmailFrom(),
        to,
        subject,
        html: renderedHtml,
      });
      console.log(`[email] Dev SMTP sent → ${info.messageId}`);
      console.log(`[email] Preview: http://localhost:1080/#/email/${info.messageId}`);
      logEmailEvent({
        to,
        subject,
        html: renderedHtml,
        status: "sent",
        provider: "maildev-smtp",
      }).catch(() => {});
      return true;
    } catch (err) {
      const codeMatch =
        renderedHtml.match(/font-family:\s*monospace[^>]*>(\d{4,8})<\/span>/i) ||
        renderedHtml.match(/>(\d{6})<\/span>/) ||
        subject.match(/\b\d{6}\b/);
      if (codeMatch) {
        console.log(`\n======================================================`);
        console.log(`🔑 DEV AUTH CODE for ${to}: [ ${codeMatch[1] || codeMatch[0]} ]`);
        console.log(`   Subject: ${subject}`);
        console.log(`======================================================\n`);
      } else {
        console.log(`[email] DEV EMAIL for ${to}: ${subject}`);
      }
      logEmailEvent({
        to,
        subject,
        html: renderedHtml,
        status: "sent",
        provider: "console-dev",
      }).catch(() => {});
      return true;
    }
  }

  // ── Production / Real Provider: selected provider ──
  const result = await sendTransactionalEmail({
    from: resolveTransactionalSender({ email: EMAIL_FROM, name: EMAIL_FROM_NAME }),
    to: [to],
    subject,
    html: renderedHtml,
    category: "transactional",
  });

  if (!result.sent) {
    console.error(`[email] Delivery failed for ${to} via ${result.provider}:`, result.error);
    logEmailEvent({
      to,
      subject,
      html: renderedHtml,
      status: "failed",
      provider: result.provider || "transactional",
      error: result.error || "Provider failed to send email",
    }).catch(() => {});
    return false;
  }

  console.log(`[email] ${result.provider} sent successfully to: ${to}`);
  logEmailEvent({
    to,
    subject,
    html: renderedHtml,
    status: "sent",
    provider: result.provider || "transactional",
  }).catch(() => {});
  return true;
}

/**
 * Re-send an email exactly as it was stored in `email_logs` (the HTML there is
 * already rendered, so it is not wrapped again). Used by the admin "Resend"
 * button. Logs a new email_logs entry linked to the original.
 */
export async function resendLoggedEmail(options: {
  to: string;
  subject: string;
  html: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ sent: boolean; provider: string; error?: string; logId: string | null }> {
  const { to, subject, html, userId, metadata } = options;
  const useDevTransport = process.env.NODE_ENV === "development" && process.env.EMAIL_DEV_SEND_REAL !== "true";

  let sent = false;
  let provider = "transactional";
  let error: string | undefined;

  if (useDevTransport) {
    try {
      await getDevTransporter().sendMail({ from: formatEmailFrom(), to, subject, html });
      sent = true;
      provider = "maildev-smtp";
    } catch (err) {
      sent = false;
      provider = "maildev-smtp";
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    const result = await sendTransactionalEmail({
      from: resolveTransactionalSender({ email: EMAIL_FROM, name: EMAIL_FROM_NAME }),
      to: [to],
      subject,
      html,
      category: "transactional",
    });
    sent = result.sent;
    provider = result.provider || "transactional";
    error = result.sent ? undefined : result.error || "Provider failed to send email";
  }

  const logId = await logEmailEvent({
    to,
    userId: userId ?? null,
    subject,
    html,
    status: sent ? "sent" : "failed",
    provider,
    error,
    metadata,
  });
  return { sent, provider, error, logId };
}

// ─── Layout & Components ────────────────────────────────────────────────────
//
// Email design system (follows docs/DESIGN.md):
//   • Light content panel (#F8FAFC) with the brand mark + wordmark top-left,
//     plain-language greeting and prose, and a "— The MakeChurchEazy Team" sign-off.
//   • Dark footer band (#0F172A) with the white mark, social icons, a hairline
//     divider, footer text and "This email was sent to …".
//   • Inter type, slate neutrals, Primary Blue for links/buttons, orange used sparingly.

const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const C = {
  page: "#FFFFFF",
  panel: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  footerBg: "#0F172A",
  footerRule: "#334155",
  footerText: "#94A3B8",
} as const;

const EMAIL_ASSET_BASE = `${APP_URL.replace(/\/+$/, "")}/email`;

function socialIcon(urlVar: string, icon: string, label: string): string {
  return `{{#if social.${urlVar}}}<td style="padding:0 18px 0 0;"><a href="{{social.${urlVar}}}" target="_blank" style="display:inline-block;text-decoration:none;"><img src="${EMAIL_ASSET_BASE}/social-${icon}.png" width="22" height="22" alt="${label}" style="display:block;width:22px;height:22px;border:0;outline:none;"></a></td>{{/if}}`;
}

function wordmark(markVar: string, color: string, size: number): string {
  const markH = Math.round(size * 1.15);
  const markW = Math.round((markH * 77) / 96);
  return `
    <a href="{{brand.websiteUrl}}" target="_blank" style="text-decoration:none;display:inline-block;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding:0 10px 0 0;">
            <img src="{{brand.${markVar}}}" width="${markW}" height="${markH}" alt="" style="display:block;width:${markW}px;height:${markH}px;border:0;outline:none;">
          </td>
          <td style="vertical-align:middle;font-family:${FONT};font-size:${size}px;font-weight:700;letter-spacing:-0.02em;color:${color};line-height:1;">{{brand.appName}}</td>
        </tr>
      </table>
    </a>`;
}

function wrap(title: string, body: string): string {
  return `
    <!doctype html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <title>${title}</title>
        <style>
          @media only screen and (max-width:620px) {
            .mce-pad { padding-left:24px !important; padding-right:24px !important; }
            .mce-btn a { display:block !important; text-align:center !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:${C.page};font-family:${FONT};-webkit-font-smoothing:antialiased;">
        <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;">
          {{brand.appName}} - ${title}
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:24px 0;">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;">

                <!-- Content panel -->
                <tr>
                  <td class="mce-pad" style="background:${C.panel};padding:36px 40px 44px;">
                    ${wordmark("markUrl", C.text, 22)}
                    <div style="height:40px;line-height:40px;font-size:0;">&nbsp;</div>
                    <div style="font-family:${FONT};font-size:16px;line-height:1.75;color:${C.body};">
                      ${body}
                      <p style="margin:28px 0 0;font-size:16px;line-height:1.75;color:${C.text};">&mdash; The {{brand.appName}} Team</p>
                    </div>
                  </td>
                </tr>

                <!-- Footer band -->
                <tr>
                  <td class="mce-pad" style="background:${C.footerBg};padding:36px 44px 40px;">
                    ${wordmark("markLightUrl", "#FFFFFF", 24)}
                    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:26px 0 0;">
                      <tr>
                        ${socialIcon("youtubeUrl", "youtube", "YouTube")}
                        ${socialIcon("whatsappUrl", "whatsapp", "WhatsApp")}
                        ${socialIcon("facebookUrl", "facebook", "Facebook")}
                        ${socialIcon("instagramUrl", "instagram", "Instagram")}
                        ${socialIcon("twitterUrl", "x", "X")}
                        ${socialIcon("linkedinUrl", "linkedin", "LinkedIn")}
                        ${socialIcon("tiktokUrl", "tiktok", "TikTok")}
                      </tr>
                    </table>
                    <div style="border-top:1px solid ${C.footerRule};margin:26px 0 20px;height:0;line-height:0;font-size:0;">&nbsp;</div>
                    <p style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footerText};">{{brand.footerText}}</p>
                    <p style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footerText};">
                      <a href="mailto:{{brand.supportEmail}}" style="color:${C.footerText};text-decoration:underline;">{{brand.supportEmail}}</a>
                      &nbsp;&middot;&nbsp;
                      <a href="{{brand.preferencesUrl}}" target="_blank" style="color:${C.footerText};text-decoration:underline;">Email preferences</a>
                      &nbsp;&middot;&nbsp;
                      <a href="{{brand.websiteUrl}}" target="_blank" style="color:${C.footerText};text-decoration:underline;">Website</a>
                    </p>
                    {{#if recipient}}<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footerText};">This email was sent to <span style="color:${C.footerText};text-decoration:none;">{{recipient}}</span>.</p>{{/if}}
                    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footerText};">&copy; {{year}} {{brand.appName}}. All rights reserved.</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;font-weight:600;color:${C.text};line-height:1.3;letter-spacing:-0.01em;">${text}</h1>`;
}

// Older templates pass the pre-redesign light grey (#94a3b8) for secondary copy.
// It fails contrast on the light panel, so map it to the design-system muted text.
const LEGACY_MUTED = new Set(["#94a3b8", "#94A3B8"]);

function paragraph(text: string, opts?: { color?: string; mt?: number }): string {
  const requested = opts?.color;
  const color = !requested ? C.body : LEGACY_MUTED.has(requested) ? C.muted : requested;
  const size = color === C.muted ? 14 : 16;
  const mt = opts?.mt ?? 0;
  return `<p style="margin:${mt}px 0 16px;font-family:${FONT};font-size:${size}px;color:${color};line-height:1.75;">${text}</p>`;
}

function escapeEmailText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function button(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" class="mce-btn" style="border-collapse:collapse;margin:8px 0 24px;">
      <tr>
        <td style="border-radius:8px;background:{{brand.primaryColor}};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:8px;">${label}</a>
        </td>
      </tr>
    </table>
  `;
}

function card(rows: [label: string, value: string][]): string {
  const cells = rows
    .map(
      ([label, value], i) => `
        <tr>
          <td style="padding:${i === 0 ? 0 : 12}px 0 0;">
            <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:500;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;">${label}</p>
            <p style="margin:3px 0 0;font-family:${FONT};font-size:15px;color:${C.text};font-weight:600;">${value}</p>
          </td>
        </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:8px 0 24px;">
      <tr>
        <td style="background:${C.surface};border:1px solid ${C.border};border-left:3px solid {{brand.primaryColor}};border-radius:8px;padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${cells}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/** One-time code block (login / verification). */
function codeBlock(code: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:8px 0 24px;">
      <tr>
        <td style="background:${C.surface};border:1px solid ${C.border};border-radius:8px;padding:16px 28px;">
          <span style="font-size:30px;font-weight:700;color:${C.text};letter-spacing:0.18em;font-family:monospace;">${code}</span>
        </td>
      </tr>
    </table>
  `;
}

function divider(): string {
  return `<div style="border-top:1px solid ${C.border};margin:28px 0;height:0;line-height:0;font-size:0;">&nbsp;</div>`;
}

/** Footer line for marketing email: one click to stop offers and promotional email. */
function unsubscribeFooter(url: string): string {
  return `<p style="margin:26px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">Don't want offers like this? <a href="${url}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>. Account, security and billing emails will still reach you.</p>`;
}

// ─── Auth Email Templates ───────────────────────────────────────────────────

export function loginCodeEmail(code: string): SendEmailOptions {
  return {
    to: "", // set by caller
    subject: "Your MakeChurchEazy Login Code",
    html: wrap(
      "Login verification",
      `
        ${heading("Your login code")}
        ${paragraph("Enter the code below to sign in to your MakeChurchEazy account. It expires in 1 minute.")}
        ${codeBlock(code)}
        ${paragraph("If you didn't request this, you can safely ignore this email.", { color: "#94a3b8", mt: 8 })}
      `
    ),
  };
}

export function verificationEmail(actionUrl: string): SendEmailOptions {
  return {
    to: "",
    subject: "Verify your email address — MakeChurchEazy",
    html: wrap(
      "Email verification",
      `
        ${heading("Verify your email")}
        ${paragraph("Click the button below to verify your email address and continue setting up your MakeChurchEazy account.")}
        ${button(actionUrl, "Verify Email Address")}
        ${paragraph("If you didn't create an account, you can safely ignore this email.", { color: "#94a3b8" })}
      `
    ),
  };
}

export function verificationCodeEmail(code: string): SendEmailOptions {
  return {
    to: "",
    subject: "Your MakeChurchEazy Verification Code",
    html: wrap(
      "Email verification",
      `
        ${heading("Verify your email")}
        ${paragraph("Enter the code below to verify your email address. It expires in 10 minutes.")}
        ${codeBlock(code)}
        ${paragraph("If you didn't create an account, you can safely ignore this email.", { color: "#94a3b8", mt: 8 })}
      `
    ),
  };
}

export function welcomeEmail(params: {
  userName: string;
  userEmail: string;
  trialDays: number;
  trialEndsAt: string;
}): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: "Welcome to MakeChurchEazy! 🎉",
    html: wrap(
      "Welcome",
      `
        ${heading("Welcome to MakeChurchEazy!")}
        ${paragraph(`Hi ${userName}, your email is verified and your account is ready. MakeChurchEazy helps your church deliver powerful presentations, go live to several platforms at once, translate services in real time, and transcribe sermons — all from one app.`)}
        ${card([
        ["Trial", `${trialDays} days of full access`],
        ["Expires", endDate],
      ])}
        ${paragraph("<strong style=\"color:#0f172a;\">Here's what you can do:</strong>")}
        ${paragraph("• <strong>Multi-stream</strong> — Go live to YouTube, Facebook and more at the same time, straight from the app. Your trial includes 20 hours of multi-streaming a month<br>• <strong>Lower Thirds &amp; Tickers</strong> — Show names, titles, scriptures and announcements over your live stream<br>• <strong>Bible Presentations</strong> — Display scriptures beautifully on screen<br>• <strong>Live Translation</strong> — Translate your service into 50+ languages<br>• <strong>Speech-to-Scripture</strong> — Transcribe sermons and auto-display verses<br>• <strong>AI Summaries</strong> — Auto-generate sermon notes and bulletins")}
        ${paragraph("<strong style=\"color:#0f172a;\">Try multi-stream this Sunday:</strong> add your YouTube and Facebook stream keys under your speaker profile, switch on two or more destinations, and press Go Live. MakeChurchEazy sends your service to every platform for you — no extra software needed.", { mt: 14 })}
        ${button(APP_URL + "/dashboard", "Go to Dashboard")}
        ${paragraph(`<strong style="color:#0f172a;\">Download the desktop app:</strong>`)}
        ${paragraph(`<a href="${APP_URL}/downloads" style="color:{{brand.primaryColor}};font-weight:600;">Download MakeChurchEazy →</a>`)}
        ${paragraph(`Need help getting started? Join our <a href="${COMMUNITY_URL}" style="color:{{brand.primaryColor}};">community</a> for guides and support.`, { color: "#94a3b8", mt: 12 })}
      `
    ),
  };
}

export function passwordResetEmail(actionUrl: string): SendEmailOptions {
  return {
    to: "",
    subject: "Reset your password — MakeChurchEazy",
    html: wrap(
      "Password reset",
      `
        ${heading("Reset your password")}
        ${paragraph("We received a request to reset the password for your MakeChurchEazy account. Click the button below to set a new password.")}
        ${button(actionUrl, "Reset Password")}
        ${paragraph("If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.", { color: "#94a3b8" })}
      `
    ),
  };
}

export function migrationEmail(actionUrl: string): SendEmailOptions {
  return {
    to: "",
    subject: "Set your password — MakeChurchEazy",
    html: wrap(
      "Set your password",
      `
        ${heading("Set your password")}
        ${paragraph("You previously signed in to MakeChurchEazy using Google. To continue using your account, please set a password by clicking the button below.")}
        ${button(actionUrl, "Set Password")}
        ${paragraph("If you didn't request this, you can safely ignore this email.", { color: "#94a3b8" })}
      `
    ),
  };
}

export function passwordChangedEmail(params: {
  userName: string;
  userEmail: string;
  changedBy?: "migration" | "reset" | "manual";
}): SendEmailOptions {
  const { userName, userEmail, changedBy } = params;
  const contextMap = {
    migration: "Your password has been set after migrating from your previous authentication method.",
    reset: "Your password has been reset successfully.",
    manual: "Your password has been changed.",
  };
  const context = changedBy ? contextMap[changedBy] : "Your password has been changed.";

  return {
    to: userEmail,
    subject: "Your password has been changed — MakeChurchEazy",
    html: wrap(
      "Password changed",
      `
        ${heading("Password changed")}
        ${paragraph(`Hi ${userName}, ${context}`)}
        ${card([["Time", new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })]])}
        ${paragraph("If you did not make this change, please contact our support team immediately so we can secure your account.")}
        ${button(`mailto:${SUPPORT_EMAIL}`, "Contact Support")}
        ${paragraph("For your security, we recommend enabling two-factor authentication in your account settings.", { color: "#94a3b8", mt: 16 })}
      `
    ),
  };
}

// ─── Email Change Templates ─────────────────────────────────────────────────

export function emailChangeVerificationEmail(
  newEmail: string,
  token: string
): SendEmailOptions {
  const confirmUrl = `${APP_URL}/settings/email/confirm?token=${token}`;
  return {
    to: newEmail,
    subject: "Verify your new email address — MakeChurchEazy",
    html: wrap(
      "Email change",
      `
        ${heading("Verify your new email")}
        ${paragraph(`You requested to change your MakeChurchEazy account email to <strong style="color:#0f172a;">${newEmail}</strong>.`)}
        ${paragraph("Click the button below to confirm this change. This link expires in 24 hours.")}
        ${button(confirmUrl, "Verify Email Address")}
        ${paragraph("If you didn't request this change, you can safely ignore this email. Your current email will remain active.", { color: "#94a3b8" })}
        ${paragraph("For security, you can only change your email once every 30 days.", { color: "#94a3b8", mt: 4 })}
      `
    ),
  };
}

export function emailChangeNotificationEmail(
  oldEmail: string,
  newEmail: string
): SendEmailOptions {
  return {
    to: oldEmail,
    subject: "Your MakeChurchEazy email was changed",
    html: wrap(
      "Email changed",
      `
        ${heading("Email address changed")}
        ${paragraph(`Your MakeChurchEazy account email has been changed from <strong style="color:#0f172a;">${oldEmail}</strong> to <strong style="color:#0f172a;">${newEmail}</strong>.`)}
        ${paragraph(`If you did not make this change, please contact support immediately at <a href="mailto:${SUPPORT_EMAIL}" style="color:{{brand.primaryColor}};">${SUPPORT_EMAIL}</a>.`)}
      `
    ),
  };
}

export function emailChangeConfirmedEmail(
  newEmail: string
): SendEmailOptions {
  return {
    to: newEmail,
    subject: "Your MakeChurchEazy email has been updated",
    html: wrap(
      "Email updated",
      `
        ${heading("Email address verified")}
        ${paragraph(`Your MakeChurchEazy account email has been successfully updated to <strong style="color:#0f172a;">${newEmail}</strong>.`)}
        ${paragraph("All future notifications and account communications will be sent to this address.")}
        ${paragraph("For security, you can only change your email once every 30 days.", { color: "#94a3b8", mt: 4 })}
      `
    ),
  };
}

// ─── Subscription Email Templates ───────────────────────────────────────────

interface SubscriptionEmailParams {
  userName: string;
  userEmail: string;
  planName: string;
  billingCycle?: string;
  credits?: number;
  expiresAt?: string;
  amountPaid?: string;
}

/** Plan-specific feature lists for welcome emails */
const PLAN_EMAIL_FEATURES: Record<string, string[]> = {
  basic: [
    "Countdowns to keep your services running on time",
    "Slideshow mode for worship lyrics and announcements",
    "30 songs, 20 images, and 10 videos in your library",
    "50 AI credits for Speech-to-Scripture",
    "Lower thirds and tickers for live graphics",
  ],
  growth: [
    "Countdowns to keep your services running on time",
    "Speech-to-Scripture — never type a verse again",
    "Mobile Control from your phone or tablet",
    "Live Translation for multilingual congregations",
    "EasyWorship library import in one click",
    "Free sermon transcription with every service",
    "MultiView for multi-camera setups",
    "Tickers and lower thirds for live graphics",
    "2,000 AI credits per month",
    "Unlimited themes, devices, and cloud sync",
  ],
};

export function subscriptionActivatedEmail(
  params: SubscriptionEmailParams
): SendEmailOptions {
  const { userName, userEmail, planName, billingCycle, credits, expiresAt, amountPaid } = params;
  const renewDate = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    : null;

  const planKey = planName.toLowerCase();
  const features = PLAN_EMAIL_FEATURES[planKey] || [];

  const featureListHtml =
    features.length > 0
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr><td>
            <p style="margin:0 0 12px;font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">What you've unlocked</p>
            ${features
        .map(
          (f) => `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="20" valign="top" style="padding:0 8px 8px 0;">
                    <span style="display:inline-block;width:18px;height:18px;background:#DCFCE7;border-radius:50%;text-align:center;line-height:18px;font-size:11px;color:#15803D;">✓</span>
                  </td>
                  <td style="padding:0 0 8px;font-size:15px;color:${C.body};line-height:1.6;">${f}</td>
                </tr>
              </table>`
        )
        .join("")}
          </td></tr>
        </table>
      `
      : "";

  return {
    to: userEmail,
    subject: `Your ${planName} subscription is active — MakeChurchEazy`,
    html: wrap(
      "Subscription active",
      `
        ${heading(`Welcome to ${planName}!`)}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription is now active.`)}
        ${card(
        [
          ["Plan", `${planName}${billingCycle ? ` (${billingCycle})` : ""}`],
          ...(credits != null
            ? [["Credits", credits === -1 ? "Unlimited" : String(credits)] as [string, string]]
            : []),
          ...(amountPaid ? [["Amount paid", amountPaid] as [string, string]] : []),
          ...(renewDate ? [["Renews", renewDate] as [string, string]] : []),
        ]
      )}
        ${featureListHtml}
        ${button(`${APP_URL}/`, "Open Dashboard")}
        ${paragraph(`Your desktop app will pick up the new plan automatically. Need help? Visit our <a href="${COMMUNITY_URL}" style="color:{{brand.primaryColor}};">community</a>.`, { color: "#94a3b8" })}
      `
    ),
  };
}

export function subscriptionRenewedEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    expiresAt: string;
    amountPaid?: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, expiresAt, amountPaid } = params;
  const renewDate = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your ${planName} subscription has renewed — MakeChurchEazy`,
    html: wrap(
      "Subscription renewed",
      `
        ${heading("Subscription renewed")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription has been renewed successfully.`)}
        ${card([
        ["Plan", planName],
        ...(amountPaid ? [["Amount charged", amountPaid] as [string, string]] : []),
        ["Next renewal", renewDate],
      ])}
      `
    ),
  };
}

export function adminManagedSubscriptionEmail(params: {
  userName: string;
  userEmail: string;
  planName: string;
  billingCycle: string;
  expiresAt: string;
  mode: "started" | "renewed";
  amountPaid?: string;
  paymentReference?: string;
}): SendEmailOptions {
  const { userName, userEmail, planName, billingCycle, expiresAt, mode, amountPaid, paymentReference } = params;
  const accessUntil = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isRenewal = mode === "renewed";

  return {
    to: userEmail,
    subject: `Your ${planName} subscription has ${isRenewal ? "renewed" : "started"} — MakeChurchEazy`,
    html: wrap(
      isRenewal ? "Subscription renewed" : "Subscription started",
      `
        ${heading(isRenewal ? "Subscription renewed" : "Subscription started")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription has been ${isRenewal ? "renewed" : "started"}.`)}
        ${paragraph("Your payment was confirmed by the MakeChurchEazy admin team, so your access is active immediately.")}
        ${card([
        ["Plan", `${planName} (${billingCycle})`],
        ...(amountPaid ? [["Amount paid", amountPaid] as [string, string]] : []),
        ...(paymentReference ? [["Payment reference", paymentReference] as [string, string]] : []),
        ["Access until", accessUntil],
      ])}
        ${button(`${APP_URL}/`, "Open Dashboard")}
        ${paragraph("Your desktop app will pick up the subscription automatically the next time it syncs.", { color: "#94a3b8" })}
      `
    ),
  };
}

export function subscriptionCancelledEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    expiresAt: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, expiresAt } = params;
  const accessUntil = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your ${planName} subscription has been cancelled — MakeChurchEazy`,
    html: wrap(
      "Subscription cancelled",
      `
        ${heading("Subscription cancelled")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription has been cancelled.`)}
        ${paragraph(`You'll continue to have access until <strong style="color:#0f172a;">${accessUntil}</strong>. After that, your account will return to the Free plan.`)}
        ${button(`${APP_URL}/dashboard`, "Resubscribe")}
      `
    ),
  };
}

export function subscriptionExpiredEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    expiredAt: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, expiredAt } = params;
  const expiryDate = new Date(expiredAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your ${planName} subscription has expired — MakeChurchEazy`,
    html: wrap(
      "Subscription expired",
      `
        ${heading("Your subscription has expired")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription expired on <strong style="color:#0f172a;">${expiryDate}</strong>.`)}
        ${paragraph("Your account has been returned to the Free plan. You can upgrade again at any time to restore your paid features and credits.")}
        ${button(`${APP_URL}/dashboard`, "View Plans")}
      `
    ),
  };
}

export function paymentFailedEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    gracePeriodEndsAt?: string | null;
    retryUrl?: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, gracePeriodEndsAt, retryUrl } = params;
  const graceDate = gracePeriodEndsAt
    ? new Date(gracePeriodEndsAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    : null;
  return {
    to: userEmail,
    subject: `Payment failed for your ${planName} subscription — MakeChurchEazy`,
    html: wrap(
      "Payment failed",
      `
        ${heading("Payment failed")}
        ${paragraph(`Hi ${userName}, we couldn't process your payment for the <strong style="color:#0f172a;">${planName}</strong> subscription.`)}
        ${paragraph(graceDate
        ? `Your paid access stays active during the grace period. If the payment is not completed by <strong style="color:#0f172a;">${graceDate}</strong>, your account will move to the Free plan.`
        : "Your paid access stays active for the grace period. If the payment is not completed in time, your account will move to the Free plan.")}
        ${paragraph("Please update your payment method or retry the payment. If the issue persists, contact your bank or payment provider.")}
        ${button(retryUrl || `${APP_URL}/billing`, "Fix Payment")}
      `
    ),
  };
}

export function subscriptionGracePeriodReminderEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    gracePeriodEndsAt: string;
    dayNumber: 1 | 2 | 5;
    retryUrl?: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, gracePeriodEndsAt, dayNumber, retryUrl } = params;
  const graceDate = new Date(gracePeriodEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let subject = "";
  let title = "";
  let message = "";

  if (dayNumber === 1) {
    subject = `Action Required: Your ${planName} subscription has expired (7-Day Grace Period Active) — MakeChurchEazy`;
    title = `Your 7-day grace period is active`;
    message = `Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription has passed its renewal date. To ensure your church presentations and services continue without interruption, we have placed your account in a <strong>7-day grace period</strong> until <strong style="color:#0f172a;">${graceDate}</strong>. All paid features remain active during this period. Please renew before this date to maintain uninterrupted access.`;
  } else if (dayNumber === 2) {
    subject = `Reminder: 5 days left in your ${planName} grace period — MakeChurchEazy`;
    title = `5 days left in your grace period`;
    message = `Hi ${userName}, this is a reminder that you have <strong>5 days remaining</strong> in your <strong style="color:#0f172a;">${planName}</strong> grace period. On <strong style="color:#0f172a;">${graceDate}</strong>, your subscription will be downgraded to the Free plan. Renew now to avoid any disruptions during your church services.`;
  } else {
    // Day 5
    subject = `Urgent: 2 days left to keep your ${planName} subscription — MakeChurchEazy`;
    title = `Final Notice: 2 days remaining`;
    message = `Hi ${userName}, your 7-day grace period will end in <strong>2 days</strong> on <strong style="color:#0f172a;">${graceDate}</strong>. After this date, your account will return to the Free plan. Renew today to keep your offline projection, team access, and AI features active.`;
  }

  return {
    to: userEmail,
    subject,
    html: wrap(
      title,
      `
        ${heading(title)}
        ${paragraph(message)}
        ${button(retryUrl || `${APP_URL}/dashboard/billing`, "Renew Subscription Now")}
        ${paragraph("If you have already renewed or need help, reply to this email or contact support.", { color: "#94a3b8", mt: 16 })}
      `
    ),
  };
}

// ─── Trial Email Templates ──────────────────────────────────────────────────

interface TrialEmailParams {
  userName: string;
  userEmail: string;
  trialDays: number;
  trialEndsAt: string;
}

export function trialActivatedEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your ${trialDays}-day Growth Trial is live! — MakeChurchEazy`,
    html: wrap(
      "Trial activated",
      `
        ${heading("Your Growth Trial is live!")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${trialDays}-day Growth Trial</strong> is now active. You have full access to premium features including translation, speech-to-scripture, AI summaries, and more.`)}
        ${card([
        ["Trial ends", endDate],
        ["Credits", "Full trial allocation"],
        ["Features", "Translation, Speech-to-Scripture, AI, and more"],
      ])}
        ${paragraph("<strong style=\"color:#0f172a;\">Quick setup checklist:</strong>")}
        ${paragraph("1. Download MakeChurchEazy<br>2. Pair your first device<br>3. Connect OBS<br>4. Run your first presentation")}
        ${button(`${APP_URL}/dashboard`, "View Dashboard")}
        ${paragraph("Upgrade anytime to keep your access after the trial. No charge until you decide.", { color: "#94a3b8" })}
      `
    ),
  };
}

/** Sent to activated-trial experiment users before their first useful setup. */
export function activationRequiredWelcomeEmail(params: {
  userName: string;
  userEmail: string;
  trialDays?: number;
}): SendEmailOptions {
  const { userName, userEmail, trialDays = 7 } = params;
  return {
    to: userEmail,
    subject: "Your first MakeChurchEazy setup starts here",
    html: wrap(
      "First setup",
      `
        ${heading("Let's get your first presentation running")}
        ${paragraph(`Hi ${userName}, your MakeChurchEazy account is ready. Your Growth access starts when you connect OBS, so your trial time is reserved for when you can actually use the product.`)}
        ${card([
          ["First step", "Open MakeChurchEazy Desktop"],
          ["Then", "Connect OBS and present one verse"],
          ["Trial", `${trialDays} days after activation`],
        ])}
        ${button(`${APP_URL}/dashboard`, "Continue Setup")}
        ${paragraph(`If anything blocks you, reply to this email or use our <a href="${COMMUNITY_URL}" style="color:{{brand.primaryColor}};">community support</a>.`, { color: "#94a3b8" })}
      `,
    ),
  };
}

/** @deprecated Use trialActivatedEmail instead */
export const welcomeTrialActivatedEmail = trialActivatedEmail;

export function trialDay1ActivationEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: "Get your first presentation running — MakeChurchEazy",
    html: wrap(
      "Activation",
      `
        ${heading("Ready to get started?")}
        ${paragraph(`Hi ${userName}, your Growth Trial is going strong! Here's a quick checklist to get your first presentation running:`)}
        ${card([
        ["Trial status", `${trialDays} days remaining`],
        ["Trial ends", endDate],
      ])}
        ${paragraph("<strong style=\"color:#0f172a;\">Quick setup checklist:</strong>")}
        ${paragraph("✓ Download MakeChurchEazy<br>✓ Pair your first device<br>✓ Connect OBS<br>✓ Run your first presentation")}
        ${button(`${APP_URL}/dashboard`, "Complete Setup")}
        ${paragraph("Need help? Visit our community for guides and support.", { color: "#94a3b8" })}
  `
    ),
  };
}

export function activationNudgeEmail(params: {
  userName: string;
  userEmail: string;
  trialDays: number;
  activationRequired?: boolean;
}): SendEmailOptions {
  const { userName, userEmail, trialDays, activationRequired = false } = params;
  return {
    to: userEmail,
    subject: "Need a hand getting MakeChurchEazy ready?",
    html: wrap(
      "Activation reminder",
      `
        ${heading("Let's get your first result")}
        ${paragraph(`Hi ${userName}, the fastest way to see MakeChurchEazy's value is to connect OBS and present one Bible verse. ${activationRequired ? `Your ${trialDays}-day trial starts after that first activation, so you have the full window to test it.` : "Your trial is already running, so this is a good time to try it."}`)}
        ${paragraph("1. Open MakeChurchEazy Desktop<br>2. Connect OBS<br>3. Open Bible and push one verse to OBS")}
        ${button(`${APP_URL}/dashboard`, "Continue Setup")}
        ${paragraph(`If something stopped you, <a href="${APP_URL}/dashboard?activationSurvey=1" style="color:{{brand.primaryColor}};font-weight:600;">tell us what happened</a>.`, { color: "#94a3b8" })}
      `,
    ),
  };
}

export function trialDay3FeatureDiscoveryEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: "Have you tried Speech-to-Scripture yet? — MakeChurchEazy",
    html: wrap(
      "Feature discovery",
      `
        ${heading("Try Speech-to-Scripture")}
        ${paragraph(`Hi ${userName}, have you tried our Speech-to-Scripture feature yet? It transcribes sermons in real time and displays scripture on screen automatically.`)}
        ${card([
        ["Trial status", `${trialDays} days remaining`],
        ["Trial ends", endDate],
      ])
      }
        ${paragraph("<strong style=\"color:#0f172a;\">Features to explore:</strong>")}
        ${paragraph("• <strong>Speech-to-Scripture</strong> — Transcribe sermons in real time<br>• <strong>Live Translation</strong> — Translate to 50+ languages<br>• <strong>AI Summaries</strong> — Auto-generate sermon notes")}
        ${button(`${APP_URL}/library`, "Explore Features")}
        ${paragraph("These features are included in your trial and available with the Growth plan.", { color: "#94a3b8" })}
  `
    ),
  };
}

export function trialDay5FeatureDrivingEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: "Most churches start here — MakeChurchEazy",
    html: wrap(
      "Feature driving",
      `
        ${heading("Most churches start here")}
        ${paragraph(`Hi ${userName}, you're halfway through your Growth Trial! Here are the features most churches use first:`)}
        ${card([
        ["Trial status", `${trialDays} days remaining`],
        ["Trial ends", endDate],
      ])
      }
        ${paragraph("<strong style=\"color:#0f172a;\">Popular features:</strong>")}
        ${paragraph("• <strong>Translation</strong> — Reach your entire congregation in their language<br>• <strong>AI Summaries</strong> — Auto-generate sermon notes and bulletins<br>• <strong>OBS Integration</strong> — Direct broadcast control from the app")}
        ${button(`${APP_URL}/library`, "Try These Features")}
        ${paragraph("You have full access during your trial. Upgrade anytime to keep using these features.", { color: "#94a3b8" })}
  `
    ),
  };
}

export function trialEndingSoonEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your trial ends in ${trialDays} day${trialDays === 1 ? "" : "s"} — MakeChurchEazy`,
    html: wrap(
      "Trial ending soon",
      `
        ${heading("Trial ending soon")}
        ${paragraph(`Hi ${userName}, your Growth Trial ends in <strong style="color:#0f172a;">${trialDays} day${trialDays === 1 ? "" : "s"}</strong> on ${endDate}.`)}
        ${paragraph("After your trial ends, your account will return to the Free plan with limited access. Upgrade now to keep all Growth features.")}
        ${button(`${APP_URL}/dashboard`, "Upgrade Now")}
  `
    ),
  };
}

export function trial1DayRemainingEmail(params: TrialEmailParams): SendEmailOptions {
  const { userName, userEmail, trialDays, trialEndsAt } = params;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: "Your trial ends tomorrow — MakeChurchEazy",
    html: wrap(
      "Trial ending",
      `
        ${heading("Your trial ends tomorrow")}
        ${paragraph(`Hi ${userName}, your Growth Trial ends tomorrow on ${endDate}.`)}
        ${paragraph("Here's what you've accomplished during your trial:")}
        ${card([
        ["Trial ends", "Tomorrow"],
        ["Upgrade to keep", "Translation, Speech-to-Scripture, AI Summaries"],
      ])
      }
        ${paragraph("Upgrade now to avoid interruption and keep all your premium features.")}
        ${button(`${APP_URL}/dashboard`, "Upgrade Now")}
        ${paragraph("You can also continue with the Free plan with limited access.", { color: "#94a3b8" })}
  `
    ),
  };
}

export function trialExpiredEmail(
  params: {
    userName: string;
    userEmail: string;
    freeCredits?: number;
  }
): SendEmailOptions {
  const { userName, userEmail, freeCredits = 25 } = params;
  return {
    to: userEmail,
    subject: "Your trial has ended — MakeChurchEazy",
    html: wrap(
      "Trial ended",
      `
        ${heading("Trial ended")}
        ${paragraph(`Hi ${userName}, your Growth Trial has ended. Your account has been returned to the Free plan.`)}
        ${card([
        ["Free plan limits", `${freeCredits.toLocaleString()} Credits/month, 1 Device`],
        ["Upgrade to restore", "Translation, Speech-to-Scripture, AI Features"],
      ])
      }
        ${paragraph("Upgrade anytime to unlock more features and credits.")}
        ${button(`${APP_URL}/dashboard`, "View Plans")}
  `
    ),
  };
}

export function reEngagementEmail(
  params: {
    userName: string;
    userEmail: string;
    /** Marketing emails carry a one-click unsubscribe link. */
    unsubscribeUrl?: string;
  }
): SendEmailOptions {
  const { userName, userEmail, unsubscribeUrl } = params;
  return {
    to: userEmail,
    subject: "We miss you at MakeChurchEazy",
    html: wrap(
      "We miss you",
      `
        ${heading("We miss you!")}
        ${paragraph(`Hi ${escapeEmailText(userName)}, it's been a week since your free trial ended. Your church community is waiting, and we'd love to have you back.`)}
        ${paragraph("While you were away, here's what churches using MakeChurchEazy have been doing:")}
        ${paragraph("• <strong>Delivered 1,000+ presentations</strong> across congregations<br>• <strong>Translated services</strong> for multilingual communities<br>• <strong>Transcribed sermons</strong> with Speech-to-Scripture<br>• <strong>Generated sermon notes</strong> with AI Summaries")}
        ${button(`${APP_URL}/subscription/plans`, "See plans")}
        ${paragraph(`Questions? Reply to this email or reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:{{brand.primaryColor}};">${SUPPORT_EMAIL}</a>.`, { color: "#94a3b8", mt: 8 })}
        ${unsubscribeUrl ? unsubscribeFooter(unsubscribeUrl) : ""}
  `
    ),
  };
}

// ─── Lifecycle Email Templates ──────────────────────────────────────────────

export function newDeviceLoginEmail(
  params: {
    userName: string;
    userEmail: string;
    deviceName: string;
    deviceOs: string;
    loginTime: string;
  }
): SendEmailOptions {
  const { userName, userEmail, deviceName, deviceOs, loginTime } = params;
  return {
    to: userEmail,
    subject: "New device connected to your MakeChurchEazy account",
    html: wrap(
      "New device login",
      `
        ${heading("New device connected")}
        ${paragraph(`Hi ${userName}, a new device was connected to your MakeChurchEazy account:`)}
        ${card([
        ["Device", `${deviceName} (${deviceOs})`],
        ["Login time", loginTime],
      ])
      }
        ${paragraph("If this wasn't you, please contact our support team immediately so we can secure your account.")}
        ${button(`mailto:${SUPPORT_EMAIL}`, "Contact Support")}
        ${paragraph(`For your security, we recommend reviewing your <a href="${APP_URL}/settings" style="color:{{brand.primaryColor}};">account settings</a> and ensuring two-factor authentication is enabled.`, { color: "#94a3b8", mt: 16 })}
  `
    ),
  };
}

export function subscriptionExpiringSoonEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    expiresAt: string;
    daysLeft: number;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, expiresAt, daysLeft } = params;
  const expiryDate = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    to: userEmail,
    subject: `Your ${planName} subscription expires ${daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`}`,
    html: wrap(
      "Subscription expiring",
      `
        ${heading("Subscription expiring soon")}
        ${paragraph(`Hi ${userName}, your <strong style="color:#0f172a;">${planName}</strong> subscription expires in <strong style="color:#0f172a;">${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong> on ${expiryDate}.`)}
        ${paragraph("To keep your access to all features without interruption, renew your subscription before it expires.")}
        ${button(`${APP_URL}/dashboard`, "Renew Subscription")}
        ${paragraph("After expiry, your account will return to the Free plan with limited access.", { color: "#94a3b8" })}
  `
    ),
  };
}

export function paymentReceiptEmail(
  params: {
    userName: string;
    userEmail: string;
    planName: string;
    amount: string;
    billingCycle: string;
    paidAt: string;
    receiptNumber: string;
    invoiceUrl?: string;
  }
): SendEmailOptions {
  const { userName, userEmail, planName, amount, billingCycle, paidAt, receiptNumber, invoiceUrl } = params;
  return {
    to: userEmail,
    subject: `Payment receipt — ${planName} `,
    html: wrap(
      "Payment receipt",
      `
        ${heading("Payment receipt")}
        ${paragraph(`Hi ${userName}, your payment has been processed successfully.`)}
        ${card([
        ["Plan", planName],
        ["Amount", amount],
        ["Billing cycle", billingCycle],
        ["Paid on", paidAt],
        ["Receipt number", receiptNumber],
      ])
      }
        ${invoiceUrl ? button(invoiceUrl, "View invoice") : ""}
        ${paragraph(`You can also view all receipts in your <a href="${APP_URL}/billing" style="color:{{brand.primaryColor}};">billing history</a>.`, { color: "#94a3b8" })}
  `
    ),
  };
}

export function planUpgradeEmail(
  params: {
    userName: string;
    userEmail: string;
    fromPlan: string;
    toPlan: string;
    newFeatures: string[];
  }
): SendEmailOptions {
  const { userName, userEmail, fromPlan, toPlan, newFeatures } = params;
  const featuresList =
    newFeatures.length > 0
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;border-collapse:collapse;">
          ${newFeatures
            .map(
              (feature) => `
                <tr>
                  <td width="20" valign="top" style="padding:0 8px 8px 0;">
                    <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#fff7ed;color:{{brand.accentColor}};font-size:12px;font-weight:800;line-height:18px;text-align:center;">•</span>
                  </td>
                  <td style="padding:0 0 8px;font-size:15px;color:${C.body};line-height:1.6;">
                    ${escapeEmailText(feature)}
                  </td>
                </tr>`
            )
            .join("")}
        </table>
      `
      : "";
  return {
    to: userEmail,
    subject: `Welcome to ${toPlan}!`,
    html: wrap(
      "Plan upgraded",
      `
        ${heading("You've upgraded!")}
        ${paragraph(`Hi ${userName}, congratulations on upgrading from <strong style="color:#0f172a;">${fromPlan}</strong> to <strong style="color:#0f172a;">${toPlan}</strong>!`)}
        ${paragraph("Here are the features you've just unlocked:")}
        ${featuresList}
        ${button(`${APP_URL}/dashboard`, "Go to Dashboard")}
        ${paragraph("Your new plan is active immediately. Enjoy the new features!", { color: "#94a3b8" })}
      `
    ),
  };
}

// What each paid plan switches on, written for the people who run Sunday.
// Kept in step with dashboard/app/pricing/pricing-data.ts.
const PLAN_UNLOCKS: Record<string, Array<{ title: string; detail: string }>> = {
  basic: [
    { title: "Unlimited songs, lyrics & media", detail: "Bring your whole worship library — no 10-item cap." },
    { title: "Every Bible version", detail: "Switch translations live, mid-sermon, in one click." },
    { title: "Automatic OBS scenes", detail: "Your scenes and sources build themselves. No manual setup." },
    { title: "Multistream from OBS", detail: "Go live on more than one platform at once — 10 hours a month, no plugin." },
    { title: "Voice to Scripture", detail: "Say the verse; it appears on screen. 4 hours a month." },
  ],
  growth: [
    { title: "Unlimited songs, lyrics & media", detail: "Bring your whole worship library — no 10-item cap." },
    { title: "Every Bible version", detail: "Switch translations live, mid-sermon, in one click." },
    { title: "Automatic OBS scenes", detail: "Your scenes and sources build themselves. No manual setup." },
    { title: "Multistream to YouTube & Facebook", detail: "Stream to both at the same time, straight from OBS — 20 hours a month." },
    { title: "Cloud sync for your team", detail: "Songs, lyrics and media follow every operator, on every computer." },
    { title: "Mobile control app", detail: "Run slides and lyrics from your phone anywhere in the room." },
    { title: "Lower thirds & sermon export", detail: "Polished name straps, prayer bars and sermon notes in minutes." },
    { title: "Voice to Scripture — 10 hours", detail: "The preacher says the verse; it's on screen before they finish." },
    { title: "Priority support", detail: "Your questions jump the queue." },
  ],
  pro: [
    { title: "Everything in Growth", detail: "Cloud sync, mobile control, lower thirds, every Bible version and more." },
    { title: "Multistream — 40 hours a month", detail: "Broadcast to every platform you use, all at once." },
    { title: "Multi-campus content sync", detail: "One library, kept in step across all your campuses." },
    { title: "Voice to Scripture — 20 hours", detail: "Hands-free scripture for every service, every campus." },
    { title: "Direct phone support", detail: "A direct line to our team when it matters." },
  ],
};

function planUnlockList(plan: string): string {
  const items = PLAN_UNLOCKS[plan.trim().toLowerCase()] || PLAN_UNLOCKS.growth;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 24px;">
      <tr>
        <td style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:8px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${items
              .map(
                (item, i) => `
                  <tr>
                    <td width="30" valign="top" style="padding:${i === 0 ? 14 : 12}px 10px 12px 0;${i ? `border-top:1px solid ${C.border};` : ""}">
                      <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:{{brand.primaryColor}};color:#FFFFFF;font-family:${FONT};font-size:13px;font-weight:700;line-height:22px;text-align:center;">&#10003;</span>
                    </td>
                    <td valign="top" style="padding:${i === 0 ? 14 : 12}px 0 12px;${i ? `border-top:1px solid ${C.border};` : ""}">
                      <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:600;color:${C.text};line-height:1.4;">${escapeEmailText(item.title)}</p>
                      <p style="margin:2px 0 0;font-family:${FONT};font-size:14px;color:${C.muted};line-height:1.55;">${escapeEmailText(item.detail)}</p>
                    </td>
                  </tr>`
              )
              .join("")}
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function adminTemporaryPlanGrantedEmail(params: {
  userName: string;
  userEmail: string;
  previousPlan: string;
  newPlan: string;
  expiresAt: string;
  reason?: string;
}): SendEmailOptions {
  const { userName, userEmail, newPlan, expiresAt, reason } = params;
  const endDate = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const firstName = escapeEmailText(String(userName || "there").trim().split(/\s+/)[0] || "there");
  const plan = escapeEmailText(newPlan);

  return {
    to: userEmail,
    subject: `You've been upgraded to ${newPlan} 🎉 — on us until ${endDate}`,
    html: wrap(
      `You're on ${newPlan}`,
      `
        <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;font-weight:700;color:{{brand.accentColor}};text-transform:uppercase;letter-spacing:0.12em;">Upgrade unlocked</p>
        ${heading(`${firstName}, you're on ${plan} — free until ${endDate}`)}
        ${paragraph(`Good news: we've upgraded your MakeChurchEazy account to <strong style="color:${C.text};">${plan}</strong>, on us. Everything below is switched on right now — so make this Sunday your smoothest service yet.`)}
        ${reason ? paragraph(`<em>${escapeEmailText(reason)}</em>`, { color: C.muted }) : ""}
        <p style="margin:8px 0 10px;font-family:${FONT};font-size:13px;font-weight:600;color:${C.text};text-transform:uppercase;letter-spacing:0.08em;">What you get with ${plan}</p>
        ${planUnlockList(newPlan)}
        <p style="margin:8px 0 10px;font-family:${FONT};font-size:13px;font-weight:600;color:${C.text};text-transform:uppercase;letter-spacing:0.08em;">Start in 30 seconds</p>
        ${paragraph(`<strong style="color:${C.text};">1.</strong> Open MakeChurchEazy on your computer (already open? restart it).<br/><strong style="color:${C.text};">2.</strong> Your ${plan} features appear on their own — no code, no card.<br/><strong style="color:${C.text};">3.</strong> Try one today: turn on Voice to Scripture or sync your songs to the cloud.`)}
        ${button(`${APP_URL}/download`, "Open MakeChurchEazy")}
        ${card([
          ["Your plan", plan],
          ["Free until", endDate],
          ["After that", "You move back to Free — no charge, nothing to cancel"],
        ])}
        ${paragraph(`Want to keep ${plan} after ${endDate}? You can continue any time from <a href="${APP_URL}/subscription/plans" style="color:{{brand.primaryColor}};">your plans page</a>.`, { color: C.muted })}
      `
    ),
  };
}

export function adminTemporaryPlanEndedEmail(params: {
  userName: string;
  userEmail: string;
  endedPlan: string;
  reason?: "expired" | "ended_by_admin";
}): SendEmailOptions {
  const { userName, userEmail, endedPlan, reason } = params;
  const endedByAdmin = reason === "ended_by_admin";

  return {
    to: userEmail,
    subject: "Your temporary MakeChurchEazy access has ended",
    html: wrap(
      "Temporary access ended",
      `
        ${heading("Temporary access ended")}
        ${paragraph(`Hi ${userName}, your temporary <strong style="color:#0f172a;">${endedPlan}</strong> access has ${endedByAdmin ? "been ended by an admin" : "expired"}.`)}
        ${card([
        ["Current plan", "Free"],
        ["What happens now", "Your account continues on the Free plan"],
      ])}
        ${paragraph("Bible presentation, worship presentation, media management, OBS integration, themes, and lower thirds are still available according to your Free plan limits.")}
        ${button(`${APP_URL}/subscription/plans`, "View Plans")}
      `
    ),
  };
}

export function ambassadorWelcomeEmail(params: {
  name: string;
  credits: number;
  expiresAt: string;
}): SendEmailOptions {
  const { name, credits, expiresAt } = params;
  return {
    to: "",
    subject: "Welcome to the MakeChurchEazy Ambassador Program",
    html: wrap(
      "Ambassador Program",
      `
        ${heading("Congratulations!")}
        ${paragraph(`Hi ${name},`)}
        ${paragraph("You have been selected as a <strong style=\"color:#1D4ED8;\">MakeChurchEazy Ambassador</strong>. Your account has been upgraded to Ambassador status.")}
        ${paragraph("<strong>Your Ambassador Benefits:</strong>")}
        ${card([
        ["Plan", "Growth (Full Access)"],
        ["Credits", `${credits.toLocaleString()} credits`],
        ["Access Until", expiresAt],
      ])}
        ${paragraph("Thank you for helping churches discover MakeChurchEazy. As an Ambassador, you have full access to Growth features to share with your community.")}
        ${button(`${APP_URL}/dashboard`, "Go to Dashboard")}
        ${paragraph("If you have any questions, reply to this email or contact our support team.", { color: "#94a3b8" })}
      `
    ),
  };
}

export interface DiscountOfferEmailParams {
  toEmail: string;
  name?: string;
  churchName?: string;
  headline?: string;
  discountPercent?: number;
  durationMonths?: number;
  trialExtensionDays?: number;
  promoCode?: string;
  claimUrl: string;
  planName?: string;
  billingCycle?: string;
  expiresAt?: string;
  customNote?: string;
  /** Marketing emails carry a one-click unsubscribe link. */
  unsubscribeUrl?: string;
}

export function discountOfferEmail(params: DiscountOfferEmailParams): SendEmailOptions {
  const {
    toEmail,
    name,
    churchName,
    headline,
    discountPercent,
    durationMonths = 1,
    trialExtensionDays,
    promoCode,
    claimUrl,
    planName = "Growth",
    billingCycle = "monthly",
    expiresAt,
    customNote,
    unsubscribeUrl,
  } = params;

  const recipientLabel = churchName || name || "Church Leader";
  const subject = headline || (discountPercent ? `Special Offer: ${discountPercent}% off MakeChurchEazy` : "Special Offer from MakeChurchEazy");

  let offerSummary = "";
  if (discountPercent) {
    offerSummary = `${discountPercent}% off for ${durationMonths} month${durationMonths > 1 ? "s" : ""}`;
  } else if (trialExtensionDays) {
    offerSummary = `${trialExtensionDays} extra days on your Free Trial`;
  }

  const cardRows: [string, string][] = [];
  if (planName) cardRows.push(["Plan", planName]);
  if (offerSummary) cardRows.push(["Discount", offerSummary]);
  if (billingCycle) cardRows.push(["Billing", billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)]);
  if (expiresAt) cardRows.push(["Expires On", new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })]);

  const promoBox = promoCode
    ? `
      <div style="background:${C.surface};border:1px dashed {{brand.primaryColor}};border-radius:8px;padding:22px;text-align:center;margin:8px 0 24px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">Your promo code</p>
        <div style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:0.12em;color:{{brand.primaryColor}};">${promoCode}</div>
        <p style="margin:10px 0 0;font-size:15px;font-weight:600;color:${C.text};">${offerSummary}</p>
      </div>
    `
    : trialExtensionDays
      ? `
      <div style="background:${C.surface};border:1px dashed #22C55E;border-radius:8px;padding:22px;text-align:center;margin:8px 0 24px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#15803D;">Trial extended</p>
        <div style="font-size:26px;font-weight:700;color:#15803D;">+${trialExtensionDays} days free</div>
        <p style="margin:10px 0 0;font-size:15px;font-weight:600;color:${C.text};">Your trial has been extended! Continue using all features without interruption.</p>
      </div>
    `
      : "";

  const html = wrap(
    "Special Discount",
    `
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:{{brand.accentColor}};">Exclusive ministry offer</p>
      ${heading(headline || (discountPercent ? `Get ${discountPercent}% Off MakeChurchEazy` : "Special Discount For Your Ministry"))}
      ${paragraph(`Dear ${escapeEmailText(recipientLabel)},`)}
      ${paragraph(customNote || "We want to help your church present scripture, worship songs, and church media with complete excellence and zero stress. We've unlocked a special discount tailored for your ministry:")}
      ${promoBox}
      ${cardRows.length > 0 ? card(cardRows) : ""}
      ${button(claimUrl, "Claim discount &rarr;")}
      <p style="margin:0;font-size:14px;color:${C.muted};line-height:1.6;">
        Clicking the button will automatically apply your discount at checkout. You can also enter the promo code <strong>${promoCode || ""}</strong> on the plans page.
      </p>
      ${paragraph("If you have any questions or need setup assistance for your service, just reply directly to this email.", { color: "#94a3b8", mt: 24 })}
      ${unsubscribeUrl ? unsubscribeFooter(unsubscribeUrl) : ""}
    `
  );

  return {
    to: toEmail,
    subject,
    html,
  };
}


// ─── Win-back offer ladder emails ───────────────────────────────────────────

export interface OfferJourneyEmailParams {
  toEmail: string;
  name?: string;
  subject: string;
  title: string;
  message: string;
  /** Plain-language summary, e.g. "50% off for 1 month". */
  offerSummary: string;
  primary: { label: string; url: string };
  secondary?: { label: string; url: string } | null;
  promoCode?: string | null;
  /** When the offer closes (ISO). */
  closesAt: string;
  unsubscribeUrl: string;
}

function formatEmailDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
}

export function offerJourneyEmail(params: OfferJourneyEmailParams): SendEmailOptions {
  const { toEmail, name, subject, title, message, offerSummary, primary, secondary, promoCode, closesAt, unsubscribeUrl } = params;
  const greeting = name ? `Hi ${escapeEmailText(name)},` : "Hi there,";
  const until = formatEmailDate(closesAt);
  const rows: [string, string][] = [["Your offer", escapeEmailText(offerSummary)]];
  if (until) rows.push(["Open until", until]);
  const promoBox = promoCode
    ? `<p style="margin:0 0 18px;font-size:13px;color:#64748b;">Your code, applied automatically when you use the button: <strong style="font-family:monospace;letter-spacing:0.06em;color:#0f172a;">${escapeEmailText(promoCode)}</strong></p>`
    : "";
  return {
    to: toEmail,
    subject,
    html: wrap(
      "Your offer",
      `
        ${heading(escapeEmailText(title))}
        ${paragraph(greeting)}
        ${paragraph(escapeEmailText(message), { mt: 10 })}
        ${card(rows)}
        ${promoBox}
        ${button(primary.url, escapeEmailText(primary.label))}
        ${secondary ? `<p style="margin:-10px 0 20px;font-size:14px;"><a href="${secondary.url}" style="color:{{brand.primaryColor}};font-weight:700;">${escapeEmailText(secondary.label)}</a></p>` : ""}
        ${paragraph(`Questions? Reply to this email or reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:{{brand.primaryColor}};">${SUPPORT_EMAIL}</a>.`, { color: "#94a3b8", mt: 8 })}
        ${unsubscribeFooter(unsubscribeUrl)}
      `
    ),
  };
}

export interface OfferFreePeriodEndingEmailParams {
  toEmail: string;
  name?: string;
  freeUntil: string;
  percentOff: number;
  discountMonths: number;
  ctaUrl: string;
  promoCode: string;
  unsubscribeUrl: string;
}

export function offerFreePeriodEndingEmail(params: OfferFreePeriodEndingEmailParams): SendEmailOptions {
  const { toEmail, name, freeUntil, percentOff, discountMonths, ctaUrl, promoCode, unsubscribeUrl } = params;
  const greeting = name ? `Hi ${escapeEmailText(name)},` : "Hi there,";
  const months = `${discountMonths} month${discountMonths === 1 ? "" : "s"}`;
  return {
    to: toEmail,
    subject: `Your free Basic period ends ${formatEmailDate(freeUntil) || "soon"}`,
    html: wrap(
      "Your free period is ending",
      `
        ${heading("Keep Basic at half the price")}
        ${paragraph(greeting)}
        ${paragraph(`Your free Basic period ends on ${formatEmailDate(freeUntil) || "soon"}. If your team found it useful, you can keep going with ${percentOff}% off for your first ${months}.`, { mt: 10 })}
        ${card([["Your offer", `${percentOff}% off for ${months}`], ["Code", escapeEmailText(promoCode)]])}
        ${button(ctaUrl, `Keep Basic at ${percentOff}% off`)}
        ${paragraph("If you don't subscribe, your account simply returns to the Free plan. Nothing is charged.", { color: "#94a3b8", mt: 8 })}
        ${unsubscribeFooter(unsubscribeUrl)}
      `
    ),
  };
}
