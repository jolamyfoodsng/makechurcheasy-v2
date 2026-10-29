import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getEmailProviderStatus } from "@/lib/emailProvider";

/**
 * GET /api/admin/email-status
 *
 * Which email providers are active (SMTP first when configured, then Cloudflare) and
 * whether the SMTP mailbox accepts our login. Never returns the password.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getEmailProviderStatus());
}
