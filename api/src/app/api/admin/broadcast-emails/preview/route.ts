import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { BroadcastTargetError, renderBroadcastPreviewHtml } from "@/lib/broadcastEmail";
import { normalizeDiscountCode } from "@/lib/discounts";

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_HTML_LENGTH = 100000;

/**
 * POST /api/admin/broadcast-emails/preview
 *
 * Renders the composed email exactly as it would be sent — no audience scan, no DB write.
 * Body: { subject, bodyText?, bodyHtml?, ctaLabel?, ctaUrl?, discountCode? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.bodyText === "string" ? body.bodyText.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel.trim() : "";
  const ctaUrl = typeof body.ctaUrl === "string" ? body.ctaUrl.trim() : "";
  const discountCode = normalizeDiscountCode(body.discountCode);

  if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
    return NextResponse.json({ error: "Subject is required (max 200 characters)." }, { status: 400 });
  }
  if (bodyHtml) {
    if (bodyHtml.length > MAX_HTML_LENGTH) {
      return NextResponse.json({ error: "HTML body is too large (max 100,000 characters)." }, { status: 400 });
    }
  } else if (!bodyText || bodyText.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Message body is required (max 20,000 characters)." }, { status: 400 });
  }

  try {
    const html = await renderBroadcastPreviewHtml({
      subject,
      bodyText: bodyHtml ? undefined : bodyText,
      bodyHtml: bodyHtml || undefined,
      ctaLabel: ctaLabel || undefined,
      ctaUrl: ctaUrl || undefined,
      discountCode: discountCode || undefined,
    });
    return NextResponse.json({ html });
  } catch (err) {
    if (err instanceof BroadcastTargetError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
