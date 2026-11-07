import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listBroadcastRecipients, type RecipientFilter } from "@/lib/broadcastTracking";

type RouteContext = { params: Promise<{ id: string }> };

const FILTERS: RecipientFilter[] = ["all", "opened", "clicked", "not_opened", "failed"];

/**
 * GET /api/admin/broadcast-emails/{id}/recipients?filter=all|opened|clicked|not_opened|failed
 *
 * Who a campaign went to, when they opened it and which links they clicked (newest activity first).
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const requested = req.nextUrl.searchParams.get("filter") as RecipientFilter | null;
  const filter = requested && FILTERS.includes(requested) ? requested : "all";
  const recipients = await listBroadcastRecipients(id, filter);
  return NextResponse.json({ recipients });
}
