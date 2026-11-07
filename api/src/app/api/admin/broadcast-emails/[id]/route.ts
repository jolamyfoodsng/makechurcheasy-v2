import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getBroadcastCampaign } from "@/lib/broadcastEmail";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/admin/broadcast-emails/{id} — polled by the admin page while a send is in flight. */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const campaign = await getBroadcastCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}
