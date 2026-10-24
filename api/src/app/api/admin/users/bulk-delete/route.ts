import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import clientPromise from "@/lib/mongodb";
import { deleteUsers, planDeletion } from "@/lib/bulkUserDelete";
import { parseVersionRule, type VersionRule } from "@/lib/userDeleteRules";

/** How many users one request may handle. The admin page sends bigger selections in several requests. */
const MAX_PER_REQUEST = 100;

function describeRule(rule: VersionRule): string {
  if ("none" in rule) return "app version not recorded";
  if ("exact" in rule) return `app version ${rule.exact}`;
  return `app version older than ${rule.olderThan}`;
}

/**
 * POST /api/admin/users/bulk-delete  (admin only)
 *
 * Body: { userIds: string[], rule: { olderThan } | { exact } | { none: true }, dryRun?: boolean, confirmCount?: number }
 *
 * Every user is checked again here, whatever the admin page selected: admins, trials, paid plans, anyone with
 * billing records, and anyone who used the product in the last 30 days are skipped.
 * dryRun (the default) deletes nothing and returns who would go and who would be skipped.
 * A real delete needs confirmCount equal to the number of users that would be deleted right now, so a
 * selection that changed since it was reviewed is refused instead of deleting something unexpected.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const body = (await req.json().catch(() => null)) as {
      userIds?: unknown;
      rule?: unknown;
      dryRun?: unknown;
      confirmCount?: unknown;
    } | null;

    const rule = parseVersionRule(body?.rule);
    if (!rule) {
      return NextResponse.json({ error: "Choose exactly one app version rule." }, { status: 400 });
    }
    const userIds = Array.isArray(body?.userIds)
      ? Array.from(new Set(body.userIds.filter((id): id is string => typeof id === "string" && id.length > 0)))
      : [];
    if (userIds.length === 0) {
      return NextResponse.json({ error: "No users selected." }, { status: 400 });
    }
    if (userIds.length > MAX_PER_REQUEST) {
      return NextResponse.json({ error: `Send at most ${MAX_PER_REQUEST} users per request.` }, { status: 400 });
    }

    const dryRun = body?.dryRun !== false;
    const client = await clientPromise;
    const db = client.db();

    const plan = await planDeletion(db, userIds, rule, authResult.adminUserId);
    const summary = {
      requested: userIds.length,
      willDelete: plan.willDelete.map((u) => ({ id: u.id, email: u.email, name: u.name, appVersions: u.versions })),
      skipped: plan.skipped,
    };

    if (dryRun) {
      return NextResponse.json({ dryRun: true, ...summary });
    }

    if (body?.confirmCount !== plan.willDelete.length) {
      return NextResponse.json(
        {
          error: "The selection changed since you reviewed it. Review it again before deleting.",
          dryRun: true,
          ...summary,
        },
        { status: 409 },
      );
    }

    const result = await deleteUsers(db, plan.willDelete, authResult.adminUserId, describeRule(rule));
    const emails = new Map(plan.willDelete.map((u) => [u.id, u.email]));
    return NextResponse.json({
      dryRun: false,
      requested: userIds.length,
      deleted: result.deleted.length,
      deletedEmails: result.deleted.map((id) => emails.get(id) || ""),
      skipped: plan.skipped,
      failed: result.failed,
    });
  } catch (error) {
    console.error("Admin bulk delete users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
