import { NextRequest, NextResponse } from "next/server";
import { processDueZohoSignupSyncs } from "@/lib/zohoSignupSync";
import { syncZohoContacts } from "@/lib/zohoContactSync";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.ZOHO_CAMPAIGNS_SYNC_CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueZohoSignupSyncs();
    // Runs every 15 minutes; the contact pull itself only runs when the last
    // one finished more than six hours ago.
    const contactSync = await syncZohoContacts({ onlyIfDue: true }).catch(() => ({
      status: "failed" as const,
      stage: "database" as const,
      errorCode: "unexpected_error",
    }));
    return NextResponse.json({ success: true, ...result, contactSync });
  } catch (error) {
    console.error("[Zoho Signup Sync] Scheduled retry failed:", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "Zoho signup sync failed" }, { status: 500 });
  }
}
