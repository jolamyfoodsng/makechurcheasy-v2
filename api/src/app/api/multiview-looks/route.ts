import { NextResponse } from "next/server";
import { listMultiviewLooks, serializeForApp } from "@/lib/multiviewLooks";

/**
 * GET /api/multiview-looks — the custom Multi-View "complete look" catalog for the desktop app.
 *
 * No auth gate (v1 has no plan/tier gating — see multiviewLooks.ts): every church's desktop app
 * can poll this and pick up admin-uploaded looks without an app update. The app caches the
 * response and keeps using it offline, the same way it does for /api/broadcast-graphics.
 */
export async function GET() {
  try {
    const looks = await listMultiviewLooks();
    return NextResponse.json(
      { looks: looks.filter((l) => l.status !== "hidden").map(serializeForApp) },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    console.error("GET /api/multiview-looks error:", error);
    return NextResponse.json({ error: "Failed to load Multi-View looks" }, { status: 500 });
  }
}
