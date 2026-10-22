import { env as cloudflareEnv } from "cloudflare:workers";
import { Container, getContainer } from "@cloudflare/containers";

type WorkerEnv = Record<string, unknown> & {
  MCE_API_CONTAINER: DurableObjectNamespace;
};

type CloudflareRequest = Request & {
  cf?: {
    country?: string | null;
    city?: string | null;
    region?: string | null;
    regionCode?: string | null;
    timezone?: string | null;
    continent?: string | null;
    postalCode?: string | null;
    latitude?: string | null;
    longitude?: string | null;
  };
};

const CONTAINER_ENV_NAMES = [
  "APP_ENV",
  "ASSEMBLYAI_API_KEY",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "CRON_SECRET",
  "CLOUDFLARE_STREAM_ACCOUNT_ID",
  "CLOUDFLARE_STREAM_API_TOKEN",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "EMAIL_FALLBACK_PROVIDER",
  "EMAIL_PROVIDER",
  "ZOHO_CAMPAIGNS_CLIENT_ID",
  "ZOHO_CAMPAIGNS_CLIENT_SECRET",
  "ZOHO_CAMPAIGNS_REFRESH_TOKEN",
  "ZOHO_CAMPAIGNS_NEW_SIGNUPS_LIST_KEY",
  "ZOHO_CAMPAIGNS_SIGNUP_LIST_KEY",
  "ZOHO_CAMPAIGNS_SIGNUP_FORM_DISABLED",
  "ZOHO_CAMPAIGNS_SYNC_CRON_SECRET",
  "ZOHO_CAMPAIGNS_CONTACT_SYNC_LIST_KEYS",
  "CLOUDFLARE_EMAIL_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "FLW_API_BASE_URL",
  "FLW_SECRET_KEY",
  "GITHUB_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "JWT_SECRET",
  "MONGODB_URI",
  "MTN_MOMO_ALLOWED_COUNTRIES",
  "MTN_MOMO_API_KEY",
  "MTN_MOMO_API_USER",
  "MTN_MOMO_BASE_URL",
  "MTN_MOMO_CALLBACK_URL",
  "MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY",
  "MTN_MOMO_COUNTRY_CODE",
  "MTN_MOMO_CURRENCY",
  "MTN_MOMO_ENABLED",
  "MTN_MOMO_REQUEST_TIMEOUT_MS",
  "MTN_MOMO_TARGET_ENVIRONMENT",
  "NEXTAUTH_SECRET",
  "PAYLOAD_SECRET",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "NOWPAYMENTS_API_BASE_URL",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_DEFAULT_PAY_CURRENCY",
  "NOWPAYMENTS_FEE_PAID_BY_USER",
  "NOWPAYMENTS_FIXED_RATE",
  "NOWPAYMENTS_IPN_CALLBACK_URL",
  "NOWPAYMENTS_IPN_SECRET",
  "NOWPAYMENTS_SUPPORTED_PRICE_CURRENCIES",
  "PAYSTACK_SECRET_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_PREFIX",
  "R2_PUBLIC_BASE_URL",
  "R2_SECRET_ACCESS_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SUBSCRIPTION_PRIVATE_KEY",
  "SUPPORT_EMAIL",
  "TELEGRAM_API_ERROR_ALERTS_ENABLED",
  "TELEGRAM_API_ERROR_COOLDOWN_MS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_NOTIFICATION_TIMEZONE",
  "AUTH_URL",
  "TRIAL_ABUSE_SALT",
  "TRIAL_BLOCK_IP_UA",
  "TRIAL_REQUIRE_DEVICE_FINGERPRINT",
  "FLW_PUBLIC_KEY",
  "FLW_ENCRYPTION_KEY",
  "FLW_SECRET_HASH",
  "FLW_SUPPORTED_CURRENCIES",
  "OPENCODE_API_KEY",
  "OPENCODE_MODEL",
  "TRANSCRIPTION_PROFIT_NGN_PER_HOUR",
  "TRANSCRIPTION_PROVIDER_COST_USD_PER_HOUR",
  "FIREBASE_SERVICE_ACCOUNT_KEY",
  "SUBSCRIPTION_PUBLIC_KEY",
  "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_GA_ID",
  "AUTH_FACEBOOK_ID",
  "AUTH_FACEBOOK_SECRET",
] as const;

// Use a new named instance so updated Worker secrets and code are applied to a
// freshly started API container instead of a warm container with stale env.
const API_CONTAINER_INSTANCE = "api-production-v2";

function buildContainerEnv(source: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};

  for (const name of CONTAINER_ENV_NAMES) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) {
      values[name] = value;
    }
  }

  return values;
}

function forwardEdgeMetadata(request: Request): Request {
  const headers = new Headers(request.headers);
  const cloudflareRequest = request as CloudflareRequest;
  const cfCountry = cloudflareRequest.cf?.country?.trim().toUpperCase() || "";
  const country = cfCountry !== "XX" && cfCountry !== "T1" ? cfCountry : "";
  const city = cloudflareRequest.cf?.city?.trim() || "";
  const region = cloudflareRequest.cf?.region?.trim() || cloudflareRequest.cf?.regionCode?.trim() || "";
  const timezone = cloudflareRequest.cf?.timezone?.trim() || "";
  const clientIp = headers.get("CF-Connecting-IP")?.trim() || "";

  // These headers are replaced with values from Cloudflare's request metadata;
  // never forward client-provided location or IP claims to the container.
  for (const name of [
    "cf-ipcountry",
    "x-mce-geo-country",
    "x-mce-geo-city",
    "x-mce-geo-region",
    "x-mce-geo-timezone",
    "x-mce-client-ip",
  ]) {
    headers.delete(name);
  }

  if (country) {
    headers.set("x-mce-geo-country", country);
    headers.set("cf-ipcountry", country);
  }
  if (city) headers.set("x-mce-geo-city", city);
  if (region) headers.set("x-mce-geo-region", region);
  if (timezone) headers.set("x-mce-geo-timezone", timezone);
  if (clientIp) {
    headers.set("x-mce-client-ip", clientIp);
  }

  return new Request(request, { headers });
}

export class MceApiContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "30m";
  pingEndpoint = "/api/health";
  enableInternet = true;
  envVars = buildContainerEnv(cloudflareEnv as unknown as Record<string, unknown>);
}

export default {
  async fetch(request: Request, workerEnv: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const container = getContainer(workerEnv.MCE_API_CONTAINER, API_CONTAINER_INSTANCE);
    return container.fetch(forwardEdgeMetadata(request));
  },

  async scheduled(controller: ScheduledController, workerEnv: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const cron = controller.cron || "";
    const zohoSyncSecret = String((workerEnv as Record<string, unknown>).ZOHO_CAMPAIGNS_SYNC_CRON_SECRET || "");
    if (cron === "*/15 * * * *" && zohoSyncSecret) {
      const container = getContainer(workerEnv.MCE_API_CONTAINER, API_CONTAINER_INSTANCE);
      const zohoSyncUrl = "http://localhost:3000/api/cron/zoho-campaigns-sync";
      ctx.waitUntil(
        container.fetch(new Request(zohoSyncUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${zohoSyncSecret}` },
        })).then(async (res) => {
          if (!res.ok) {
            console.error(`[Cloudflare Cron] Zoho signup retry failed: HTTP ${res.status}`);
            return;
          }
          const result = await res.json().catch(() => ({}));
          console.log("[Cloudflare Cron] Zoho signup retry completed", result);
        }).catch((err) => {
          console.error("[Cloudflare Cron] Error triggering Zoho signup retry:", err);
        }),
      );
    }

    const cronSecret = String((workerEnv as Record<string, unknown>).CRON_SECRET || "");
    if (!cronSecret) {
      console.error("[Cloudflare Cron] CRON_SECRET is not configured; skipping generic scheduled jobs");
      return;
    }
    const container = getContainer(workerEnv.MCE_API_CONTAINER, API_CONTAINER_INSTANCE);

    const dispatchUrl = `http://localhost:3000/api/cron/dispatcher?cron=${encodeURIComponent(cron)}`;
    ctx.waitUntil(
      container
        .fetch(
          new Request(dispatchUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${cronSecret}`,
              "content-type": "application/json",
              "x-cloudflare-cron": cron,
            },
          }),
        )
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error(`[Cloudflare Cron] Scheduled job failed for ${cron}: HTTP ${res.status}`, body);
          } else {
            console.log(`[Cloudflare Cron] Scheduled job succeeded for ${cron}`);
          }
        })
        .catch((err) => {
          console.error(`[Cloudflare Cron] Error triggering scheduled job ${cron}:`, err);
        }),
    );
  },
};
