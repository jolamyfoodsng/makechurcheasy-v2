import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { logAuditEvent } from "@/lib/auditLog";
import { getAdminReferralOverview, adminAssignReferral, setReferralPayoutSent } from "@/lib/referrals";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 500;
    const overview = await getAdminReferralOverview(Number.isFinite(limit) ? limit : 500);

    return NextResponse.json(overview);
  } catch (error) {
    console.error("[admin/referrals] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load referrals" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const body = (await req.json().catch(() => ({}))) as any;
    const { referrerUserId, referredUserId } = body || {};

    if (!referrerUserId || !referredUserId) {
      return NextResponse.json(
        { error: "Both referrerUserId and referredUserId are required" },
        { status: 400 },
      );
    }

    const result = await adminAssignReferral({
      referrerUserId,
      referredUserId,
    });

    return NextResponse.json({
      success: true,
      message: "Referral assigned successfully",
      ...result,
    });
  } catch (error: any) {
    console.error("[admin/referrals] POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to assign referral" },
      { status: 400 },
    );
  }
}


/** PATCH { referralId, payoutSent } — mark a referrer's reward as sent (or undo it). */
export async function PATCH(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const body = (await req.json().catch(() => ({}))) as { referralId?: unknown; payoutSent?: unknown };
    const referralId = typeof body.referralId === "string" ? body.referralId : "";
    if (!referralId || typeof body.payoutSent !== "boolean") {
      return NextResponse.json(
        { error: "referralId and payoutSent (true or false) are required" },
        { status: 400 },
      );
    }

    const referral = await setReferralPayoutSent({
      referralId,
      sent: body.payoutSent,
      adminUserId: authResult.adminUserId,
    });

    await logAuditEvent({
      adminId: authResult.adminUserId,
      action: "referral_payout",
      targetUserId: referral.referrerUserId,
      details: {
        referralId,
        referredUserId: referral.referredUserId,
        code: referral.code,
        payoutSent: body.payoutSent,
      },
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      referralId,
      payoutPaidAt: referral.payoutPaidAt || null,
    });
  } catch (error: any) {
    const message = error?.message || "Failed to update payout";
    const status = /not found/i.test(message) ? 404 : /invalid|not paid/i.test(message) ? 400 : 500;
    if (status === 500) console.error("[admin/referrals] PATCH error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to update payout" : message }, { status });
  }
}
