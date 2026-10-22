/**
 * GET /api/admin/users/[id]/usage?period=1|7|30|90 — one person's usage: most used pages, most clicked
 * controls, daily trend and the latest activity. Shown on the user profile ("App usage" tab).
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAdmin } from "@/lib/adminAuth";
import { getUserUsage } from "@/lib/usageEvents";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    const days = Number.parseInt(req.nextUrl.searchParams.get("period") || "30", 10) || 30;
    return NextResponse.json(await getUserUsage(id, days));
  } catch (error) {
    console.error("[admin/users/usage] error:", error);
    return NextResponse.json({ error: "Could not load usage" }, { status: 500 });
  }
}
