/**
 * GET /api/email/track/open?c=&u=&s=
 *
 * The 1×1 image in Admin > Broadcast Email messages. Records the open when the link
 * is genuine and always answers with the image, so a mail client never shows a
 * broken picture.
 */

import { NextRequest } from "next/server";
import { isTrackableCampaignId, recordBroadcastOpen, verifyTrackingSignature } from "@/lib/broadcastTracking";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const campaignId = params.get("c");
  const userId = params.get("u") || "";
  if (isTrackableCampaignId(campaignId) && userId && verifyTrackingSignature(["open", campaignId, userId], params.get("s"))) {
    await recordBroadcastOpen(campaignId, userId).catch((err) => console.error("[track/open] Failed:", err));
  }
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
