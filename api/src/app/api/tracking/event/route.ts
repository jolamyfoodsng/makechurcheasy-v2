/**
 * POST /api/tracking/event — Event ingestion endpoint.
 *
 * Accepts events from the desktop app and stores them in MongoDB.
 * No auth required — the desktop app sends userId in the body.
 * Rate-limited per IP to prevent abuse.
 *
 * Event schema:
 *   { event: string, userId?: string, properties?: Record<string, unknown>, timestamp?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getAuthUserFromRequest } from "@/lib/auth";
import { recordActivationEvent } from "@/lib/activation";
import { recordGraphicUsage } from "@/lib/broadcastGraphicUsage";

// Simple in-memory rate limiter (per-IP, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // 120 events per minute per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Valid event names the system accepts
const VALID_EVENTS = new Set([
  // Auth
  "user_signup",
  "user_login",
  "user_logout",
  "device_paired",
  // Bible
  "bible_search",
  "bible_present",
  "bible_search_version",
  // Worship
  "worship_song_created",
  "worship_song_imported",
  "worship_song_presented",
  "worship_presentation_created",
  // Media
  "media_uploaded",
  "media_presented",
  // Voice / Transcription
  "voice_session_started",
  "voice_session_completed",
  "transcript_created",
  "transcript_exported",
  "translation_generated",
  "sts_push_to_live",
  // Themes
  "theme_created",
  "theme_applied",
  // Broadcast Graphics usage (per graphic, per user — see lib/broadcastGraphicUsage.ts)
  "broadcast_graphic_added_to_obs",
  "broadcast_graphic_shown",
  // Other output put on screen
  "note_shown",
  "countdown_shown",
  "ticker_shown",
  "lower_third_shown",
  // General
  "first_app_open",
  "app_started",
  "app_closed",
  "obs_connected",
  "first_use_started",
  "first_use",
  "first_presentation",
  "first_presentation_screenshot",
  "overlay_mode_switched",
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "onboarding_skipped",
  "paywall_viewed",
  "trial_paywall_viewed",
  "upgrade_modal_viewed",
  "checkout_started",
  "payment_completed",
  "payment_failed",
  "feature_used",
]);

function getCorsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, X-MCE-Device-Id, X-Device-Secret, X-App-Version, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);
  try {
    // Rate limit
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429, headers: corsHeaders });
    }

    const body = await req.json() as {
      event?: unknown;
      userId?: unknown;
      properties?: unknown;
      timestamp?: unknown;
    };
    const { event, userId, properties, timestamp } = body;

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "event is required" }, { status: 400, headers: corsHeaders });
    }

    const bodyUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
    // Prefer the authenticated identity whenever available. The body fallback
    // preserves compatibility with older desktop clients that send only a
    // paired user id, while preventing a signed-in client from attributing
    // events to another account.
    const authUser = await getAuthUserFromRequest(req).catch(() => null);
    const authenticatedUserId = authUser?.mongoUser?._id?.toString() || null;
    let resolvedUserId = authenticatedUserId || bodyUserId;

    // Fallback: If userId wasn't resolved yet, look up device from headers
    if (!resolvedUserId) {
      const deviceIdHeader = req.headers.get("x-device-id") || req.headers.get("x-mce-device-id");
      if (deviceIdHeader) {
        const client = await clientPromise;
        const db = client.db();
        const device = await db.collection("devices").findOne({ deviceId: deviceIdHeader.trim() });
        if (device?.userId) {
          resolvedUserId = device.userId.toString();
        }
      }
    }

    const timestampValue = typeof timestamp === "string" || typeof timestamp === "number"
      ? timestamp
      : undefined;
    const eventDate = timestampValue ? new Date(timestampValue) : new Date();
    await recordActivationEvent(
      resolvedUserId,
      event,
      properties && typeof properties === "object" ? properties as Record<string, unknown> : {},
      Number.isFinite(eventDate.getTime()) ? eventDate : new Date(),
    );

    const eventProps = properties && typeof properties === "object" ? properties as Record<string, unknown> : {};
    try {
      await recordGraphicUsage(
        resolvedUserId,
        event,
        eventProps,
        Number.isFinite(eventDate.getTime()) ? eventDate : new Date(),
      );
    } catch (usageError) {
      console.warn("[tracking/event] Graphic usage not recorded:", usageError);
    }

    const client = await clientPromise;
    const db = client.db();

    // Fire-and-forget: update daily_metrics
    updateDailyMetrics(db, event, resolvedUserId || undefined).catch(() => { });

    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Tracking event error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}

/**
 * Update daily_metrics aggregation for chart data.
 * Runs async after event insertion — failures are non-fatal.
 */
async function updateDailyMetrics(db: any, event: string, userId?: string) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const filter = { date: today };

  const update: Record<string, any> = {
    $inc: { totalEvents: 1 },
    $setOnInsert: { date: today },
  };

  // Increment category counters
  if (event.startsWith("bible_")) {
    update.$inc.bibleEvents = 1;
  } else if (event.startsWith("worship_")) {
    update.$inc.worshipEvents = 1;
  } else if (event.startsWith("media_")) {
    update.$inc.mediaEvents = 1;
  } else if (event.startsWith("voice_") || event.startsWith("transcript_") || event.startsWith("translation_")) {
    update.$inc.voiceEvents = 1;
  } else if (event === "user_signup") {
    update.$inc.signups = 1;
    update.$inc.activeUsers = 1;
  } else if (event === "user_login" || event === "app_started") {
    update.$inc.activeUsers = 1;
  } else if (event === "theme_created" || event === "theme_applied") {
    update.$inc.themeEvents = 1;
  }

  await db.collection("daily_metrics").updateOne(filter, update, { upsert: true });
}
