/**
 * emailProvider.ts — Transactional email delivery.
 *
 * When SMTP credentials are configured (SMTP_HOST, SMTP_USER, SMTP_PASS) mail is
 * sent through that mailbox, with Cloudflare Email Service as the fallback.
 * Otherwise Cloudflare is the only provider. Falls back to console in local
 * environments where neither is configured.
 */

import nodemailer from "nodemailer";

export type EmailProviderName = "smtp" | "cloudflare" | "console";

export interface TransactionalEmailMessage {
  from: {
    email: string;
    name?: string;
  };
  to: string[];
  subject: string;
  html: string;
  text?: string;
  category?: string;
}

export interface EmailDeliveryResult {
  sent: boolean;
  provider: EmailProviderName;
  messageId?: string;
  error?: string;
}

function isSmtpConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS);
}

function isCloudflareConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CLOUDFLARE_EMAIL_ACCOUNT_ID && env.CLOUDFLARE_EMAIL_API_TOKEN);
}

export function getEmailProviderChain(env: NodeJS.ProcessEnv = process.env): EmailProviderName[] {
  const chain: EmailProviderName[] = [];
  if (isSmtpConfigured(env)) chain.push("smtp");
  if (isCloudflareConfigured(env)) chain.push("cloudflare");
  return chain.length ? chain : ["console"];
}

/** The SMTP mailbox can only send as itself, so SMTP mail goes out from SMTP_FROM (or the login). */
function smtpSender(
  sender: TransactionalEmailMessage["from"],
  env: NodeJS.ProcessEnv,
): TransactionalEmailMessage["from"] {
  const email = (env.SMTP_FROM || env.SMTP_USER || sender.email).trim();
  return { email, name: env.SMTP_FROM_NAME?.trim() || sender.name };
}

export function resolveTransactionalSender(
  sender: TransactionalEmailMessage["from"],
  _env: NodeJS.ProcessEnv = process.env,
): TransactionalEmailMessage["from"] {
  return sender;
}

function failure(provider: EmailProviderName, error: unknown): EmailDeliveryResult {
  return {
    sent: false,
    provider,
    error: error instanceof Error ? error.message : String(error || "Unknown delivery failure"),
  };
}

async function sendWithCloudflare(message: TransactionalEmailMessage): Promise<EmailDeliveryResult> {
  const accountId = process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  if (!accountId) return failure("cloudflare", "CLOUDFLARE_EMAIL_ACCOUNT_ID is not configured");
  if (!apiToken) return failure("cloudflare", "CLOUDFLARE_EMAIL_API_TOKEN is not configured");

  try {
    const payload = {
      from: message.from.name
        ? { address: message.from.email, name: message.from.name }
        : message.from.email,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    };

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const body = await response.json().catch(() => null) as {
      success?: boolean;
      errors?: Array<{ code?: number; message?: string }>;
      messages?: Array<{ code?: number; message?: string }>;
      result?: {
        delivered?: string[];
        queued?: string[];
        message_id?: string;
        permanent_bounces?: string[];
        suppressed_recipients?: string[];
      } | null;
    } | null;

    if (!response.ok || body?.success !== true) {
      const errorDetails = body?.errors
        ?.map((entry) => entry.message || (entry.code ? `Cloudflare error ${entry.code}` : ""))
        .filter(Boolean)
        .join("; ");
      const msg = errorDetails || `Cloudflare Email Service returned HTTP ${response.status}`;
      console.error(`[email] Cloudflare send rejected (HTTP ${response.status}):`, msg, JSON.stringify(body));
      return failure("cloudflare", msg);
    }

    const accepted = new Set([
      ...(body.result?.delivered || []),
      ...(body.result?.queued || []),
    ].map((email) => email.toLowerCase()));

    if (message.to.some((email) => !accepted.has(email.toLowerCase()))) {
      const details = [
        body.result?.permanent_bounces?.length ? `Bounced: ${body.result.permanent_bounces.join(", ")}` : "",
        body.result?.suppressed_recipients?.length ? `Suppressed: ${body.result.suppressed_recipients.join(", ")}` : "",
      ].filter(Boolean).join("; ");
      return failure("cloudflare", `Cloudflare did not accept all recipients. ${details}`.trim());
    }

    return { sent: true, provider: "cloudflare", messageId: body.result?.message_id };
  } catch (error) {
    console.error("[email] Cloudflare network error:", error);
    return failure("cloudflare", error);
  }
}

let _smtpTransporter: nodemailer.Transporter | null = null;

function getSmtpTransporter(): nodemailer.Transporter {
  if (!_smtpTransporter) {
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    const secureSetting = process.env.SMTP_SECURE?.trim().toLowerCase();
    _smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      // 465 is implicit TLS; 587/25 upgrade with STARTTLS.
      secure: secureSetting ? secureSetting === "true" : port === 465,
      auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS! },
      pool: true,
      maxConnections: 3,
    });
  }
  return _smtpTransporter;
}

async function sendWithSmtp(message: TransactionalEmailMessage): Promise<EmailDeliveryResult> {
  try {
    const from = smtpSender(message.from, process.env);
    const info = await getSmtpTransporter().sendMail({
      from: from.name ? { address: from.email, name: from.name } : from.email,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(process.env.EMAIL_REPLY_TO?.trim() ? { replyTo: process.env.EMAIL_REPLY_TO.trim() } : {}),
    });
    const rejected = (info.rejected || []).map(String);
    if (rejected.length) {
      return failure("smtp", `SMTP server rejected: ${rejected.join(", ")}`);
    }
    return { sent: true, provider: "smtp", messageId: info.messageId };
  } catch (error) {
    console.error("[email] SMTP send error:", error);
    return failure("smtp", error);
  }
}

async function sendWithProvider(
  provider: EmailProviderName,
  message: TransactionalEmailMessage,
): Promise<EmailDeliveryResult> {
  if (provider === "smtp") return sendWithSmtp(message);
  if (provider === "cloudflare") return sendWithCloudflare(message);

  console.warn("[email] No email provider configured; email logged to console.");
  return failure("console", "No email provider configured");
}

export async function sendTransactionalEmail(
  message: TransactionalEmailMessage,
): Promise<EmailDeliveryResult> {
  let result: EmailDeliveryResult = failure("console", "No email provider configured");
  for (const provider of getEmailProviderChain()) {
    result = await sendWithProvider(provider, message);
    if (result.sent) return result;
    console.error(`[email] ${provider} delivery failed: ${result.error}`);
  }
  return result;
}
