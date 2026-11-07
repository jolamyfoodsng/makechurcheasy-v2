import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { normalizeDiscountCode } from "@/lib/discounts";
import {
  BroadcastTargetError,
  createBroadcastCampaign,
  listAppVersionsInUse,
  listBroadcastCampaigns,
  normalizeAppVersionFilters,
  normalizeRecipientEmails,
  SELECTED_USERS_AUDIENCE,
  previewBroadcastAudience,
  runBroadcastCampaign,
  type CreateBroadcastInput,
} from "@/lib/broadcastEmail";

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_HTML_LENGTH = 100000;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const [campaigns, appVersions] = await Promise.all([listBroadcastCampaigns(50), listAppVersionsInUse()]);
  return NextResponse.json({ campaigns, appVersions });
}

/**
 * POST /api/admin/broadcast-emails
 *
 * Body: { subject, bodyText, ctaLabel?, ctaUrl?, audience, appVersions?: string[],
 *         discountCode?: string, recipientEmails?: string[] (with audience "selected_users"), scheduledFor?: ISO string | null, dryRun?: boolean, confirmCount?: number }
 *
 * dryRun (the default) sends nothing: it previews who matches the audience right now.
 * A real send/schedule needs confirmCount equal to the live recipient count, so a
 * selection the admin reviewed a while ago is refused instead of mailing something unreviewed.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.bodyText === "string" ? body.bodyText.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
  const audience = typeof body.audience === "string" ? body.audience.trim() : "";
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel.trim() : "";
  const ctaUrl = typeof body.ctaUrl === "string" ? body.ctaUrl.trim() : "";
  const appVersions = normalizeAppVersionFilters(body.appVersions);
  const discountCode = normalizeDiscountCode(body.discountCode);
  const recipientEmails = audience === SELECTED_USERS_AUDIENCE ? normalizeRecipientEmails(body.recipientEmails) : [];
  const scheduledFor = typeof body.scheduledFor === "string" && body.scheduledFor ? body.scheduledFor : null;
  const dryRun = body.dryRun !== false;

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
  if (!audience) {
    return NextResponse.json({ error: "Audience is required." }, { status: 400 });
  }
  if (!discountCode && ((ctaLabel && !ctaUrl) || (ctaUrl && !ctaLabel))) {
    return NextResponse.json({ error: "A CTA button needs both a label and a URL." }, { status: 400 });
  }
  if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) {
    return NextResponse.json({ error: "Invalid scheduled time." }, { status: 400 });
  }

  let preview: Awaited<ReturnType<typeof previewBroadcastAudience>>;
  try {
    preview = await previewBroadcastAudience({ audience, appVersions, discountCode: discountCode || null, recipientEmails });
  } catch (err) {
    if (err instanceof BroadcastTargetError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  if (dryRun) {
    return NextResponse.json({ dryRun: true, ...preview });
  }

  const confirmCount = Number(body.confirmCount);
  if (!Number.isFinite(confirmCount) || confirmCount !== preview.recipientCount) {
    return NextResponse.json(
      {
        error: "The audience changed since you last previewed it. Preview again before sending.",
        ...preview,
      },
      { status: 409 }
    );
  }

  const input: CreateBroadcastInput = {
    subject,
    bodyText,
    bodyHtml: bodyHtml || null,
    ctaLabel: ctaLabel || null,
    ctaUrl: ctaUrl || null,
    audience,
    appVersions,
    discountCode: discountCode || null,
    recipientEmails,
    scheduledFor,
  };

  const campaignId = await createBroadcastCampaign(input, auth.adminUserId, {
    recipients: preview.recipientCount,
    sent: 0,
    failed: 0,
    skippedOptOut: preview.skippedOptOut,
    capped: preview.capped,
  });

  const isScheduled = Boolean(scheduledFor && scheduledFor > new Date().toISOString());
  if (!isScheduled) {
    // Fire-and-forget: the response returns immediately, the admin page polls the
    // campaign by id (GET /api/admin/broadcast-emails/{id}) for live sent/failed counts.
    void runBroadcastCampaign(campaignId).catch((err) => {
      console.error(`[BroadcastEmail] Campaign ${campaignId} failed:`, err);
    });
  }

  return NextResponse.json({ campaignId, status: isScheduled ? "scheduled" : "sending", ...preview }, { status: 201 });
}
