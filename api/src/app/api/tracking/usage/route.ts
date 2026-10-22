/**
 * POST /api/tracking/usage — batches of page views and clicks from the desktop app and the OBS docks.
 *
 * Body: { surface: "app" | "dock" | "lm-dock", sessionId, appVersion?, os?, userId?, events: [...] }
 * Same identity rules as /api/tracking/event: the signed-in user, else the paired device. Events that
 * cannot be attributed to a user are dropped (they would not be useful in the admin).
 * Read back by /api/admin/usage and /api/admin/users/[id]/usage. See lib/usageEvents.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { MAX_USAGE_BATCH, parseUsageBatch, recordUsageBatch, resolveUsageUser } from "@/lib/usageEvents";

export const dynamic = "force-dynamic";

// In-memory limiter per IP (resets on cold start): one busy session is a few events a second at most.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 40; // batches per minute per IP

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, X-MCE-Device-Id, X-Device-Secret, X-App-Version, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
    if (!allowed(ip)) return NextResponse.json({ error: "Rate limited" }, { status: 429, headers });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const batch = parseUsageBatch(body);
    if (!batch) return NextResponse.json({ error: `Send up to ${MAX_USAGE_BATCH} valid events` }, { status: 400, headers });

    const who = await resolveUsageUser(req, body?.userId);
    if (!who.userId) return NextResponse.json({ ok: true, stored: 0 }, { headers });

    const stored = await recordUsageBatch(batch, who);
    return NextResponse.json({ ok: true, stored }, { headers });
  } catch (error) {
    console.error("[tracking/usage] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers });
  }
}
