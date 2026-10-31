import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  deleteMultiviewLook,
  serializeForAdmin,
  updateMultiviewLookSettings,
} from "@/lib/multiviewLooks";

/** PATCH — change status (active / paused / hidden), order, or name. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ lookId: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const { lookId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const doc = await updateMultiviewLookSettings(decodeURIComponent(lookId), body, auth.adminUserId);
    if (!doc) return NextResponse.json({ error: "Look not found" }, { status: 404 });
    return NextResponse.json({ success: true, look: serializeForAdmin(doc) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update the look";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** DELETE — remove an uploaded look. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ lookId: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const { lookId } = await params;
    const ok = await deleteMultiviewLook(decodeURIComponent(lookId));
    if (!ok) return NextResponse.json({ error: "Look not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete the look";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
