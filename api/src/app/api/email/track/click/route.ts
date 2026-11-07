/**
 * GET /api/email/track/click?c=&u=&url=&s=
 *
 * Links in Admin > Broadcast Email messages point here. A genuine link records the
 * click and redirects to its destination; anything else goes to the home page, so
 * this can't be used to bounce people to an arbitrary site.
 */

import { NextRequest, NextResponse } from "next/server";
import { isTrackableCampaignId, recordBroadcastClick, verifyTrackingSignature } from "@/lib/broadcastTracking";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const campaignId = params.get("c");
  const userId = params.get("u") || "";
  const url = params.get("url") || "";

  const genuine =
    isTrackableCampaignId(campaignId) &&
    Boolean(userId) &&
    /^https?:\/\//i.test(url) &&
    verifyTrackingSignature(["click", campaignId, userId, url], params.get("s"));

  if (!genuine) return NextResponse.redirect(APP_URL, 302);

  await recordBroadcastClick(campaignId, userId, url).catch((err) => console.error("[track/click] Failed:", err));
  return NextResponse.redirect(url, 302);
}
