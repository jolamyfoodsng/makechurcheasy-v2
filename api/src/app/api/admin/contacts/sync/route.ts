import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { syncZohoContacts } from "@/lib/zohoContactSync";

export const runtime = "nodejs";

/** "Sync from Zoho" button: pulls Zoho Campaigns contacts right away. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const result = await syncZohoContacts({ triggeredBy: `admin:${auth.adminUserId}` });
  if (result.status === "busy") {
    return NextResponse.json({ error: "A sync is already running. Try again in a minute.", result }, { status: 409 });
  }
  if (result.status === "failed") {
    return NextResponse.json({ error: "Zoho sync failed", result }, { status: 502 });
  }
  return NextResponse.json({ success: true, result });
}
