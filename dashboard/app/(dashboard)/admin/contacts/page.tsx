"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Contact, Phone, RefreshCw, Search } from "lucide-react";

interface ZohoContact {
  id: string;
  email: string;
  name: string;
  phone: string;
  companyName: string;
  lists: string[];
  userId: string | null;
  inZoho: boolean;
  firstSeenAt: string | null;
  lastSyncedAt: string | null;
}

interface SyncResult {
  status: "completed" | "failed" | "busy" | "skipped";
  lists?: number;
  contacts?: number;
  matchedUsers?: number;
  newContacts?: number;
  removedContacts?: number;
  filledPhones?: number;
  filledChurchNames?: number;
  stage?: string;
  errorCode?: string;
}

interface ContactsResponse {
  contacts: ZohoContact[];
  page: number;
  pageSize: number;
  total: number;
  counts: { inZoho: number; linked: number; notUsers: number; removed: number };
  sync: {
    status: string;
    startedAt: string | null;
    lastFinishedAt: string | null;
    lastResult: SyncResult | null;
  } | null;
}

type Filter = "all" | "not_users" | "users" | "removed";

const FILTERS: { value: Filter; label: string; countKey: keyof ContactsResponse["counts"] }[] = [
  { value: "all", label: "In Zoho", countKey: "inZoho" },
  { value: "users", label: "Already users", countKey: "linked" },
  { value: "not_users", label: "Not users yet", countKey: "notUsers" },
  { value: "removed", label: "Left Zoho", countKey: "removed" },
];

const ERROR_HELP: Record<string, string> = {
  configuration_incomplete: "Zoho is not connected on the server (client ID, secret or refresh token missing).",
  no_lists_found: "Zoho returned no mailing lists. The refresh token probably needs the ZohoCampaigns.contact.READ scope.",
  invalid_code: "Zoho rejected the refresh token. Generate a new one with the ZohoCampaigns.contact.READ scope.",
  api_call_budget_exceeded: "Zoho's request limit was reached. The sync will continue on its next run.",
};

function timeAgo(value: string | null): string {
  if (!value) return "never";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function describeResult(result: SyncResult | null | undefined): { tone: "ok" | "error"; text: string } | null {
  if (!result) return null;
  if (result.status === "completed") {
    return {
      tone: "ok",
      text: `${result.contacts} contacts from ${result.lists} lists · ${result.newContacts} new · ${result.matchedUsers} matched to users · ${result.filledPhones} phones and ${result.filledChurchNames} church names filled in`,
    };
  }
  if (result.status === "failed") {
    const help = (result.errorCode && ERROR_HELP[result.errorCode]) || `Zoho sync failed at ${result.stage} (${result.errorCode}).`;
    return { tone: "error", text: help };
  }
  if (result.status === "busy") return { tone: "error", text: "A sync is already running. Try again in a minute." };
  return null;
}

export default function AdminContactsPage() {
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter, page: String(page) });
      if (query) params.set("search", query);
      const res = await fetch(`/api/admin/contacts?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setMessage({ tone: "error", text: "Could not load contacts." });
    } finally {
      setLoading(false);
    }
  }, [filter, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const runSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/contacts/sync", { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      setMessage(describeResult(body.result) || { tone: "error", text: body.error || `Sync failed (HTTP ${res.status}).` });
      await load();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setSyncing(false);
    }
  };

  const lastResult = describeResult(data?.sync?.lastResult);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Contacts</h1>
          <p className="text-sm text-slate-400 mt-1">
            People on your Zoho Campaigns lists, matched to users by email.
            Last synced {timeAgo(data?.sync?.lastFinishedAt ?? null)} · syncs automatically every 6 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={runSync}
          disabled={syncing || data?.sync?.status === "running"}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/60 hover:text-sky-100 transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing from Zoho…" : "Sync from Zoho"}
        </button>
      </div>

      {(message || lastResult) && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            (message || lastResult)!.tone === "ok"
              ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
              : "border-red-800/60 bg-red-950/30 text-red-200"
          }`}
        >
          {(message || lastResult)!.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition cursor-pointer ${
              filter === f.value
                ? "border-indigo-500 bg-indigo-600 text-white"
                : "border-slate-700 bg-gray-900 text-slate-300 hover:border-slate-600"
            }`}
          >
            {f.label}
            <span className="rounded-md bg-black/25 px-1.5 text-xs">{data?.counts[f.countKey] ?? "–"}</span>
          </button>
        ))}
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Search contacts</span>
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone or church"
          className="w-full rounded-xl border border-slate-700 bg-gray-900 pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
        />
      </label>

      <div className="rounded-2xl border border-slate-800 bg-gray-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800">
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Church</th>
              <th className="px-4 py-3 font-semibold">Zoho lists</th>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Added</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">Loading contacts…</td>
              </tr>
            ) : data && data.contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                  <Contact className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                  {data.counts.inZoho === 0 && !query
                    ? "No contacts yet. Click “Sync from Zoho” to bring them in."
                    : "No contacts match this filter."}
                </td>
              </tr>
            ) : (
              data?.contacts.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/70 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{c.name || "—"}</div>
                    <div className="text-xs text-slate-400">{c.email}</div>
                    {c.phone && (
                      <div className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
                        <Phone className="w-3 h-3" />
                        {c.phone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{c.companyName || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.lists.map((list) => (
                        <span key={list} className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300">
                          {list}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.userId ? (
                      <Link href={`/admin/users/${c.userId}`} className="text-indigo-300 hover:text-indigo-200 hover:underline text-xs font-semibold">
                        View user
                      </Link>
                    ) : (
                      <span className="text-xs text-amber-300">Not signed up</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{timeAgo(c.firstSeenAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {page} of {totalPages} · {data.total} contacts
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-gray-900 disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-gray-900 disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
