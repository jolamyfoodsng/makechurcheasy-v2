/**
 * GET /api/cron/broadcast-dispatch
 *
 * Runs on the existing every-15-minutes trigger (via the cron dispatcher): sends any
 * Admin > Broadcast Email campaign whose scheduledFor time has passed.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDueBroadcastCampaignIds, runBroadcastCampaign } from "@/lib/broadcastEmail";

const CRON_SECRET = process.env.CRON_SECRET || "";

function verifyAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${CRON_SECRET}`) return true;
  return req.nextUrl.searchParams.get("secret") === CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dueIds = await getDueBroadcastCampaignIds();
  for (const id of dueIds) {
    try {
      await runBroadcastCampaign(id);
    } catch (err) {
      console.error(`[BroadcastDispatch] Campaign ${id} failed:`, err);
    }
  }

  return NextResponse.json({ success: true, dispatched: dueIds.length });
}
