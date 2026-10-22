/**
 * GET /api/admin/usage — where people go and what they click in the app and the docks.
 *
 *   ?view=overview (default)  totals, daily trend, most used pages, most clicked controls, per surface
 *   ?view=feed                latest page views and clicks with the person's name and email
 *   ?period=1|7|30|90         days to look back (default 30)
 *   ?surface=app|dock|lm-dock narrow to one surface (default all)
 *   ?q=text                   feed only: search name, email, page or button label
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getUsageFeed, getUsageOverview } from "@/lib/usageEvents";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const params = req.nextUrl.searchParams;
    const days = Number.parseInt(params.get("period") || "30", 10) || 30;
    const surface = params.get("surface");

    if (params.get("view") === "feed") {
      const events = await getUsageFeed({
        days,
        surface,
        q: params.get("q") || "",
        limit: Number.parseInt(params.get("limit") || "100", 10) || 100,
      });
      return NextResponse.json({ events });
    }
    return NextResponse.json(await getUsageOverview(days, surface));
  } catch (error) {
    console.error("[admin/usage] error:", error);
    return NextResponse.json({ error: "Could not load usage" }, { status: 500 });
  }
}
