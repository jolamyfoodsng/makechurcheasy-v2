import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  createBroadcastEmailTemplate,
  listBroadcastEmailTemplates,
  type SaveBroadcastEmailTemplateInput,
} from "@/lib/broadcastEmailTemplates";

const MAX_NAME_LENGTH = 100;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_HTML_LENGTH = 100000;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const templates = await listBroadcastEmailTemplates();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

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

  const template = await createBroadcastEmailTemplate(input, auth.adminUserId);
  return NextResponse.json({ template }, { status: 201 });
}
