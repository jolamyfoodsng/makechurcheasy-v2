/**
 * Pulls contacts from every Zoho Campaigns mailing list into the
 * `zoho_contacts` collection and links them to existing users by email.
 *
 * This is read-only toward Zoho. It never creates users or touches login
 * fields (role, password, emailVerified). On a matched user it only records
 * Zoho membership and fills phone / church name when those are empty.
 *
 * Needs a refresh token with the `ZohoCampaigns.contact.READ` scope (the
 * signup integration only needed CREATE-UPDATE). Set
 * ZOHO_CAMPAIGNS_CONTACT_SYNC_LIST_KEYS (comma separated) to limit which
 * lists are read; by default every list is read.
 */

import type { AnyBulkWriteOperation, Filter } from "mongodb";
import clientPromise from "@/lib/mongodb";

const CONTACTS_COLLECTION = "zoho_contacts";
const STATE_COLLECTION = "integration_sync_state";
const STATE_ID = "zoho_contacts";

interface SyncStateDoc {
  _id: string;
  status?: string;
  [key: string]: unknown;
}
const PAGE_SIZE = 200;
// Zoho allows 500 calls per 5 minutes before a 30 minute lock.
const MAX_API_CALLS_PER_RUN = 400;
const LEASE_MS = 10 * 60 * 1_000;
export const SCHEDULED_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export type ZohoContactSyncResult =
  | {
      status: "completed";
      lists: number;
      contacts: number;
      matchedUsers: number;
      newContacts: number;
      removedContacts: number;
      filledPhones: number;
      filledChurchNames: number;
      durationMs: number;
    }
  | { status: "busy" }
  | { status: "skipped"; reason: "not_due" }
  | { status: "failed"; stage: "config" | "oauth" | "lists" | "contacts" | "database"; errorCode: string };

interface ZohoListRow {
  listkey?: string;
  listname?: string;
}

interface ZohoContactRow {
  contact_email?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  companyname?: string;
  zuid?: string;
}

interface ZohoListResponse<T> {
  status?: string;
  code?: string | number;
  list_of_details?: T[];
}

class ZohoSyncError extends Error {
  constructor(
    readonly stage: "oauth" | "lists" | "contacts",
    readonly errorCode: string,
  ) {
    super(`${stage}:${errorCode}`);
  }
}

function safeErrorCode(value: unknown, fallback: string): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const code = String(value).trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
  return code || fallback;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getConfig() {
  const clientId = process.env.ZOHO_CAMPAIGNS_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.ZOHO_CAMPAIGNS_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const listKeys = (process.env.ZOHO_CAMPAIGNS_CONTACT_SYNC_LIST_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return { clientId, clientSecret, refreshToken, listKeys };
}

async function getAccessToken(config: NonNullable<ReturnType<typeof getConfig>>): Promise<string> {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new ZohoSyncError("oauth", safeErrorCode(payload.error, `http_${response.status}`));
  }
  return payload.access_token;
}

/** Reads every page of a Zoho Campaigns list endpoint. */
async function readAllPages<T>(
  stage: "lists" | "contacts",
  endpoint: string,
  params: Record<string, string>,
  accessToken: string,
  budget: { calls: number },
): Promise<T[]> {
  const rows: T[] = [];
  for (let fromIndex = 1; ; fromIndex += PAGE_SIZE) {
    if (budget.calls >= MAX_API_CALLS_PER_RUN) throw new ZohoSyncError(stage, "api_call_budget_exceeded");
    budget.calls += 1;

    const query = new URLSearchParams({
      resfmt: "JSON",
      sort: "asc",
      fromindex: String(fromIndex),
      range: String(PAGE_SIZE),
      ...params,
    });
    const response = await fetch(`https://campaigns.zoho.com/api/v1.1/${endpoint}?${query}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as ZohoListResponse<T>;

    // Zoho answers an out-of-range page with an error code instead of an empty
    // list, so a failure after the first page is treated as the end of the data.
    const ok = response.ok && String(payload.code) === "0" && payload.status === "success";
    if (!ok) {
      if (fromIndex > 1) break;
      throw new ZohoSyncError(stage, safeErrorCode(payload.code, `http_${response.status}`));
    }

    const page = Array.isArray(payload.list_of_details) ? payload.list_of_details : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

interface MergedContact {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  zohoContactIds: string[];
  lists: { listKey: string; listName: string }[];
}

async function fetchZohoContacts(
  config: NonNullable<ReturnType<typeof getConfig>>,
): Promise<{ listCount: number; contacts: Map<string, MergedContact> }> {
  const accessToken = await getAccessToken(config);
  const budget = { calls: 0 };

  const allLists = await readAllPages<ZohoListRow>("lists", "getmailinglists", {}, accessToken, budget);
  const lists = allLists
    .map((row) => ({ listKey: clean(row.listkey), listName: clean(row.listname) || "Untitled list" }))
    .filter((list) => list.listKey && (config.listKeys.length === 0 || config.listKeys.includes(list.listKey)));

  const contacts = new Map<string, MergedContact>();
  for (const list of lists) {
    const rows = await readAllPages<ZohoContactRow>(
      "contacts",
      "getlistsubscribers",
      { listkey: list.listKey, status: "active" },
      accessToken,
      budget,
    );
    for (const row of rows) {
      const email = clean(row.contact_email).toLowerCase();
      if (!email || !email.includes("@")) continue;
      const existing = contacts.get(email);
      if (existing) {
        existing.firstName ||= clean(row.firstname);
        existing.lastName ||= clean(row.lastname);
        existing.phone ||= clean(row.phone);
        existing.companyName ||= clean(row.companyname);
        const zuid = clean(row.zuid);
        if (zuid && !existing.zohoContactIds.includes(zuid)) existing.zohoContactIds.push(zuid);
        if (!existing.lists.some((l) => l.listKey === list.listKey)) existing.lists.push(list);
      } else {
        const zuid = clean(row.zuid);
        contacts.set(email, {
          email,
          firstName: clean(row.firstname),
          lastName: clean(row.lastname),
          phone: clean(row.phone),
          companyName: clean(row.companyname),
          zohoContactIds: zuid ? [zuid] : [],
          lists: [list],
        });
      }
    }
  }
  return { listCount: lists.length, contacts };
}

const emptyField = (field: string) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }] });

/**
 * Runs one full sync. Pass `onlyIfDue` from the scheduler so it runs at most
 * every six hours; the admin button runs it immediately.
 */
export async function syncZohoContacts(options: { onlyIfDue?: boolean; triggeredBy?: string } = {}): Promise<ZohoContactSyncResult> {
  const config = getConfig();
  if (!config) return { status: "failed", stage: "config", errorCode: "configuration_incomplete" };

  const db = (await clientPromise).db();
  const state = db.collection<SyncStateDoc>(STATE_COLLECTION);
  const now = new Date();

  await state.updateOne({ _id: STATE_ID }, { $setOnInsert: { status: "idle" } }, { upsert: true });
  const claimFilter: Filter<SyncStateDoc> = {
    _id: STATE_ID,
    $or: [{ status: { $ne: "running" } }, { leaseUntil: { $lte: now } }],
  };
  if (options.onlyIfDue) {
    claimFilter.$and = [
      {
        $or: [
          { lastFinishedAt: { $exists: false } },
          { lastFinishedAt: { $lte: new Date(now.getTime() - SCHEDULED_SYNC_INTERVAL_MS) } },
        ],
      },
    ];
  }
  const claimed = await state.findOneAndUpdate(claimFilter, {
    $set: {
      status: "running",
      startedAt: now,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      triggeredBy: options.triggeredBy || (options.onlyIfDue ? "schedule" : "admin"),
    },
  });
  if (!claimed) {
    const current = await state.findOne({ _id: STATE_ID });
    return current?.status === "running" ? { status: "busy" } : { status: "skipped", reason: "not_due" };
  }

  const finish = async (result: ZohoContactSyncResult) => {
    await state.updateOne(
      { _id: STATE_ID },
      {
        $set: { status: result.status === "completed" ? "idle" : "failed", lastFinishedAt: new Date(), lastResult: result },
        $unset: { leaseUntil: "" },
      },
    );
    return result;
  };

  let fetched: Awaited<ReturnType<typeof fetchZohoContacts>>;
  try {
    fetched = await fetchZohoContacts(config);
  } catch (error) {
    if (error instanceof ZohoSyncError) {
      console.error("[Zoho Contact Sync] Zoho request failed:", { stage: error.stage, errorCode: error.errorCode });
      return finish({ status: "failed", stage: error.stage, errorCode: error.errorCode });
    }
    const timeout = error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`);
    console.error("[Zoho Contact Sync] Network error:", { timeout });
    return finish({ status: "failed", stage: "contacts", errorCode: timeout ? "request_timeout" : "network_error" });
  }

  // An empty result usually means the token lacks the READ scope or the list
  // filter matched nothing. Never treat that as "everyone left Zoho".
  if (fetched.listCount === 0) {
    return finish({ status: "failed", stage: "lists", errorCode: "no_lists_found" });
  }

  try {
    const startedMs = now.getTime();
    const syncedAt = new Date();
    const contacts = [...fetched.contacts.values()];
    const emails = contacts.map((c) => c.email);
    const contactsCol = db.collection(CONTACTS_COLLECTION);
    const usersCol = db.collection("users");

    // Match users by email. Some older users have mixed-case emails, so the
    // comparison is done on lowercased values.
    const matchedUsers = await usersCol
      .find(
        { $expr: { $in: [{ $toLower: { $ifNull: ["$email", ""] } }, emails] } },
        { projection: { email: 1, phone: 1, churchName: 1 } },
      )
      .toArray();
    const userByEmail = new Map(matchedUsers.map((u) => [String(u.email).toLowerCase(), u]));

    const existingEmails = new Set(
      (await contactsCol.find({ email: { $in: emails } }, { projection: { email: 1 } }).toArray()).map((d) => String(d.email)),
    );

    const contactOps: AnyBulkWriteOperation[] = contacts.map((c) => {
      const user = userByEmail.get(c.email);
      return {
        updateOne: {
          filter: { email: c.email },
          update: {
            $set: {
              firstName: c.firstName,
              lastName: c.lastName,
              phone: c.phone,
              companyName: c.companyName,
              zohoContactIds: c.zohoContactIds,
              lists: c.lists,
              inZoho: true,
              userId: user ? user._id : null,
              lastSyncedAt: syncedAt,
            },
            $setOnInsert: { email: c.email, firstSeenAt: syncedAt },
            $unset: { removedFromZohoAt: "" },
          },
          upsert: true,
        },
      };
    });
    for (let i = 0; i < contactOps.length; i += 500) {
      await contactsCol.bulkWrite(contactOps.slice(i, i + 500), { ordered: false });
    }

    // Anyone not seen in a complete run has left (or unsubscribed from) every list.
    const removed = await contactsCol.updateMany(
      { inZoho: true, lastSyncedAt: { $lt: syncedAt } },
      { $set: { inZoho: false, removedFromZohoAt: syncedAt } },
    );

    const userOps: AnyBulkWriteOperation[] = [];
    let filledPhones = 0;
    let filledChurchNames = 0;
    for (const c of contacts) {
      const user = userByEmail.get(c.email);
      if (!user) continue;
      userOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              zohoCampaigns: {
                inZoho: true,
                lists: c.lists.map((l) => l.listName),
                lastSyncedAt: syncedAt,
              },
            },
          },
        },
      });
      if (c.phone && !clean(user.phone)) {
        filledPhones += 1;
        userOps.push({
          updateOne: {
            filter: { _id: user._id, ...emptyField("phone") },
            update: { $set: { phone: c.phone, phoneSource: "zoho_campaigns" } },
          },
        });
      }
      if (c.companyName && !clean(user.churchName)) {
        filledChurchNames += 1;
        userOps.push({
          updateOne: {
            filter: { _id: user._id, ...emptyField("churchName") },
            update: { $set: { churchName: c.companyName, churchNameSource: "zoho_campaigns" } },
          },
        });
      }
    }
    for (let i = 0; i < userOps.length; i += 500) {
      await usersCol.bulkWrite(userOps.slice(i, i + 500), { ordered: false });
    }
    await usersCol.updateMany(
      { "zohoCampaigns.inZoho": true, "zohoCampaigns.lastSyncedAt": { $lt: syncedAt } },
      { $set: { "zohoCampaigns.inZoho": false, "zohoCampaigns.lists": [], "zohoCampaigns.lastSyncedAt": syncedAt } },
    );

    return finish({
      status: "completed",
      lists: fetched.listCount,
      contacts: contacts.length,
      matchedUsers: userByEmail.size,
      newContacts: contacts.filter((c) => !existingEmails.has(c.email)).length,
      removedContacts: removed.modifiedCount,
      filledPhones,
      filledChurchNames,
      durationMs: Date.now() - startedMs,
    });
  } catch (error) {
    console.error("[Zoho Contact Sync] Database update failed:", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return finish({ status: "failed", stage: "database", errorCode: "database_error" });
  }
}

export async function getZohoContactSyncState() {
  const db = (await clientPromise).db();
  return db.collection<SyncStateDoc>(STATE_COLLECTION).findOne({ _id: STATE_ID });
}

export { CONTACTS_COLLECTION as ZOHO_CONTACTS_COLLECTION };
