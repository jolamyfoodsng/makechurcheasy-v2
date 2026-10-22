import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import clientPromise from "@/lib/mongodb";
import { getZohoContactSyncState, ZOHO_CONTACTS_COLLECTION } from "@/lib/zohoContactSync";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lists contacts pulled from Zoho Campaigns, with sync status and counts. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const search = (params.get("search") || "").trim().slice(0, 100);
    const filter = params.get("filter") || "all";
    const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);

    const query: Record<string, unknown> = {};
    if (filter === "not_users") Object.assign(query, { inZoho: true, userId: null });
    else if (filter === "users") Object.assign(query, { inZoho: true, userId: { $ne: null } });
    else if (filter === "removed") Object.assign(query, { inZoho: false });
    else Object.assign(query, { inZoho: true });

    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { email: pattern },
        { firstName: pattern },
        { lastName: pattern },
        { phone: pattern },
        { companyName: pattern },
      ];
    }

    const db = (await clientPromise).db();
    const contacts = db.collection(ZOHO_CONTACTS_COLLECTION);
    const [rows, total, inZoho, linked, removed, state] = await Promise.all([
      contacts
        .find(query)
        .sort({ firstSeenAt: -1, email: 1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      contacts.countDocuments(query),
      contacts.countDocuments({ inZoho: true }),
      contacts.countDocuments({ inZoho: true, userId: { $ne: null } }),
      contacts.countDocuments({ inZoho: false }),
      getZohoContactSyncState(),
    ]);

    return NextResponse.json({
      contacts: rows.map((c) => ({
        id: c._id.toString(),
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone: c.phone || "",
        companyName: c.companyName || "",
        lists: Array.isArray(c.lists) ? c.lists.map((l: { listName?: string }) => l.listName).filter(Boolean) : [],
        userId: c.userId ? c.userId.toString() : null,
        inZoho: c.inZoho !== false,
        firstSeenAt: c.firstSeenAt || null,
        lastSyncedAt: c.lastSyncedAt || null,
      })),
      page,
      pageSize: PAGE_SIZE,
      total,
      counts: { inZoho, linked, notUsers: inZoho - linked, removed },
      sync: state
        ? {
            status: state.status,
            startedAt: state.startedAt || null,
            lastFinishedAt: state.lastFinishedAt || null,
            lastResult: state.lastResult || null,
          }
        : null,
    });
  } catch (error) {
    console.error("[Admin Contacts] List failed:", error instanceof Error ? error.name : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
