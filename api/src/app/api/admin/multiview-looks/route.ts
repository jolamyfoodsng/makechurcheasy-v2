import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  listMultiviewLooks,
  publishMultiviewLookPackage,
  serializeForAdmin,
} from "@/lib/multiviewLooks";

/** GET — every uploaded Multi-View look. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const looks = await listMultiviewLooks();
    return NextResponse.json({ looks: looks.map(serializeForAdmin) });
  } catch (error) {
    console.error("GET /api/admin/multiview-looks error:", error);
    return NextResponse.json({ error: "Failed to load Multi-View looks" }, { status: 500 });
  }
}

/**
 * POST — publish a Multi-View look package (new, or a new version of an existing one).
 * Body: { package: {...mce-multiview-look@1...}, status?, replaceId? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const doc = await publishMultiviewLookPackage(
      body.package ?? body,
      { status: body.status, replaceId: typeof body.replaceId === "string" ? body.replaceId : undefined },
      auth.adminUserId,
    );
    return NextResponse.json({ success: true, look: serializeForAdmin(doc) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to publish the look";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
