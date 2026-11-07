import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  deleteBroadcastEmailTemplate,
  getBroadcastEmailTemplate,
  updateBroadcastEmailTemplate,
  type SaveBroadcastEmailTemplateInput,
} from "@/lib/broadcastEmailTemplates";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_NAME_LENGTH = 100;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_HTML_LENGTH = 100000;

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const template = await getBroadcastEmailTemplate(id);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyMode = body.bodyMode === "html" ? "html" : "text";
  const bodyText = typeof body.bodyText === "string" ? body.bodyText.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel.trim() : "";
  const ctaUrl = typeof body.ctaUrl === "string" ? body.ctaUrl.trim() : "";

  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Template name is required (max 100 characters)." }, { status: 400 });
  }
  if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
    return NextResponse.json({ error: "Subject is required (max 200 characters)." }, { status: 400 });
  }
  if (bodyMode === "html") {
    if (!bodyHtml || bodyHtml.length > MAX_HTML_LENGTH) {
      return NextResponse.json({ error: "HTML body is required (max 100,000 characters)." }, { status: 400 });
    }
  } else if (!bodyText || bodyText.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Message body is required (max 20,000 characters)." }, { status: 400 });
  }

  const input: SaveBroadcastEmailTemplateInput = {
    name,
    subject,
    bodyMode,
    bodyText: bodyText || null,
    bodyHtml: bodyHtml || null,
    ctaLabel: ctaLabel || null,
    ctaUrl: ctaUrl || null,
  };

  const template = await updateBroadcastEmailTemplate(id, input);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const deleted = await deleteBroadcastEmailTemplate(id);
  if (!deleted) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
