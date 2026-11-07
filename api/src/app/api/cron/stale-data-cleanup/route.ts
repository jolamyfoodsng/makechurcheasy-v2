/**
 * GET|POST /api/cron/stale-data-cleanup
 *
 * Purges error_logs older than 180 days and audit_events older than 365 days.
 * Returns counts only. Dry run by default — add ?apply=true to actually delete.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { cleanupStaleData } from "@/lib/staleDataCleanup";

export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET || "";

function verifyAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${CRON_SECRET}`) return true;
  return req.nextUrl.searchParams.get("secret") === CRON_SECRET;
}

async function handle(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clientPromise;
    const apply = req.nextUrl.searchParams.get("apply") === "true";
    const result = await cleanupStaleData(client.db(), { apply });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[StaleDataCleanup] Failed:", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "Stale data cleanup failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
