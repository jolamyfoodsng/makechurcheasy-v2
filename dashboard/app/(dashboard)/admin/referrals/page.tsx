"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Gift,
  Loader2,
  Plus,
  Search,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  getAdminReferrals,
  setAdminReferralPayoutSent,
  type AdminReferralOverview,
  type ReferralListItem,
} from "@/lib/api";

type StatusFilter = "all" | "signed_up" | "paid" | "payout_owed";

function isPayoutOwed(row: ReferralListItem): boolean {
  return row.status === "paid" && !row.payoutPaidAt;
}

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  signed_up: "Signed Up",
  paid: "Paid",
  payout_owed: "Payout Owed",
};

function formatDate(value: string | null): string {
  if (!value) return "Not yet";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function userLabel(user: ReferralListItem["referredUser"]): string {
  return user?.name || user?.email || "Unknown user";
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-gray-800 ${className}`} />;
}

export default function AdminReferralsPage() {
  const [data, setData] = useState<AdminReferralOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Assign Referral Modal State
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [referrerQuery, setReferrerQuery] = useState("");
  const [referrerResults, setReferrerResults] = useState<any[]>([]);
  const [searchingReferrer, setSearchingReferrer] = useState(false);
  const [selectedReferrer, setSelectedReferrer] = useState<any | null>(null);

  const [referredQuery, setReferredQuery] = useState("");
  const [referredResults, setReferredResults] = useState<any[]>([]);
  const [searchingReferred, setSearchingReferred] = useState(false);
  const [selectedReferred, setSelectedReferred] = useState<any | null>(null);

  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignSuccess, setAssignSuccess] = useState("");
  const [payoutSavingId, setPayoutSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getAdminReferrals();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load referrals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const searchUsers = async (query: string, type: "referrer" | "referred") => {
    if (type === "referrer") {
      setReferrerQuery(query);
      if (!query.trim()) {
        setReferrerResults([]);
        return;
      }
      setSearchingReferrer(true);
    } else {
      setReferredQuery(query);
      if (!query.trim()) {
        setReferredResults([]);
        return;
      }
      setSearchingReferred(true);
    }

    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query.trim())}`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        const users = json.users || [];
        if (type === "referrer") {
          setReferrerResults(users.filter((u: any) => u.id !== selectedReferred?.id));
        } else {
          setReferredResults(users.filter((u: any) => u.id !== selectedReferrer?.id));
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      if (type === "referrer") setSearchingReferrer(false);
      else setSearchingReferred(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (!selectedReferrer || !selectedReferred) return;
    setAssigning(true);
    setAssignError("");
    setAssignSuccess("");

    try {
      const res = await fetch("/api/admin/referrals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referrerUserId: selectedReferrer.id,
          referredUserId: selectedReferred.id,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to assign referral");
      }

      setAssignSuccess("Referral linked in database! No email was sent.");
      setTimeout(() => {
        setShowAssignModal(false);
        setSelectedReferrer(null);
        setSelectedReferred(null);
        setReferrerQuery("");
        setReferredQuery("");
        setReferrerResults([]);
        setReferredResults([]);
        setAssignSuccess("");
      }, 1500);

      await load();
    } catch (err: any) {
      setAssignError(err.message || "Failed to assign referral");
    } finally {
      setAssigning(false);
    }
  };

  const togglePayout = async (row: ReferralListItem) => {
    const sent = isPayoutOwed(row);
    if (!sent && !window.confirm("Mark this payout as not sent? It will show as owed again.")) return;
    setPayoutSavingId(row.id);
    setError("");
    try {
      const result = await setAdminReferralPayoutSent(row.id, sent);
      setData((current) => {
        if (!current) return current;
        const referrals = current.referrals.map((item) =>
          item.id === row.id ? { ...item, payoutPaidAt: result.payoutPaidAt } : item,
        );
        return {
          ...current,
          stats: { ...current.stats, payoutsOwed: referrals.filter(isPayoutOwed).length },
          referrals,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the payout");
    } finally {
      setPayoutSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const rows = data?.referrals || [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "payout_owed" ? isPayoutOwed(row) : row.status === statusFilter);
      const referrer = row.referrerUser;
      const referred = row.referredUser;
      const matchesSearch =
        !q ||
        row.code.toLowerCase().includes(q) ||
        referrer?.name.toLowerCase().includes(q) ||
        referrer?.email.toLowerCase().includes(q) ||
        referrer?.churchName.toLowerCase().includes(q) ||
        referred?.name.toLowerCase().includes(q) ||
        referred?.email.toLowerCase().includes(q) ||
        referred?.churchName.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [data?.referrals, search, statusFilter]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6 p-6 lg:p-8">
        <div>
          <SkeletonBlock className="mb-2 h-8 w-48" />
          <SkeletonBlock className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SkeletonBlock className="h-[118px]" />
          <SkeletonBlock className="h-[118px]" />
          <SkeletonBlock className="h-[118px]" />
          <SkeletonBlock className="h-[118px]" />
        </div>
        <SkeletonBlock className="h-[520px]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Referrals</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track referral signups, which became paid subscriptions, and which referrers you still owe.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowAssignModal(true);
              setReferrerQuery("");
              setReferredQuery("");
              setReferrerResults([]);
              setReferredResults([]);
              setSelectedReferrer(null);
              setSelectedReferred(null);
              setAssignError("");
              setAssignSuccess("");
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-500 transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Assign / Link Referral
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-slate-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Signups
            </span>
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-50">
            {data?.stats.totalSignups ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Paid
            </span>
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-50">
            {data?.stats.paidSignups ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pending
            </span>
            <Gift className="h-5 w-5 text-amber-400" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-50">
            {data?.stats.pendingSignups ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Conversion
            </span>
            <TrendingUp className="h-5 w-5 text-violet-400" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-50">
            {data?.stats.conversionRate ?? 0}%
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Payouts Owed
            </span>
            <Wallet className="h-5 w-5 text-rose-400" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-50">
            {data?.stats.payoutsOwed ?? (data?.referrals || []).filter(isPayoutOwed).length}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-gray-900">
        <div className="flex flex-col gap-3 border-b border-slate-700 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search referrer, referred user, church, or code..."
              className="h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          <div className="flex rounded-xl border border-slate-700 bg-slate-950 p-1">
            {(["all", "signed_up", "paid", "payout_owed"] as StatusFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`h-9 rounded-lg px-3 text-xs font-semibold transition ${
                  statusFilter === status
                    ? "bg-violet-500 text-white"
                    : "text-slate-400 hover:bg-gray-800 hover:text-slate-100"
                }`}
              >
                {STATUS_FILTER_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-700 text-xs font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Referrer</th>
                <th className="px-5 py-3">Referred User</th>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Signed Up</th>
                <th className="px-5 py-3">Paid</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3 text-right">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((row) => (
                <tr key={row.id} className="h-14">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-100">
                      {userLabel(row.referrerUser || null)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.referrerUser?.churchName || row.referrerUser?.email || "No profile"}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-100">
                      {userLabel(row.referredUser)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.referredUser?.churchName || row.referredUser?.email || "No profile"}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs font-bold tracking-wider text-slate-200">
                      {row.code}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold ${
                        row.status === "paid"
                          ? "border-green-500/30 bg-green-500/10 text-green-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {row.status === "paid" ? "Paid" : "Signed up"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-300">{formatDate(row.createdAt)}</td>
                  <td className="px-5 py-3 text-slate-300">{formatDate(row.paidAt)}</td>
                  <td className="px-5 py-3 font-semibold capitalize text-slate-100">
                    {row.paidPlan || row.referredUser?.plan || "Free"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {row.status !== "paid" ? (
                      <span className="text-xs text-slate-500">Not due</span>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold ${
                            row.payoutPaidAt
                              ? "border-green-500/30 bg-green-500/10 text-green-300"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {row.payoutPaidAt ? `Sent ${formatDate(row.payoutPaidAt)}` : "Owed"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void togglePayout(row)}
                          disabled={payoutSavingId === row.id}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                            row.payoutPaidAt
                              ? "border border-slate-700 text-slate-300 hover:bg-slate-800"
                              : "bg-violet-600 text-white hover:bg-violet-500"
                          }`}
                        >
                          {payoutSavingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {row.payoutPaidAt ? "Undo" : "Mark payout sent"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Gift className="mb-4 h-10 w-10 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-100">No referrals found</h2>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Referral signups will appear here after users create accounts with a referral code.
            </p>
          </div>
        ) : null}
      </div>

      {/* Assign Referral Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowAssignModal(false)}
          />
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-gray-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
                  <Gift className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">
                    Assign / Link Referral
                  </h3>
                  <p className="text-xs text-slate-400">
                    Search the database to link a referrer and a referee (referred user)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 p-3.5 text-xs text-violet-200">
                <span className="font-semibold">Database-only assignment:</span> This will directly record the referral attribution and update both users&apos; dashboards immediately. <strong>Zero emails will be sent.</strong>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Referrer Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    1. Referrer (Who invited)
                  </label>
                  {selectedReferrer ? (
                    <div className="p-3.5 rounded-xl border border-violet-500/40 bg-violet-950/30 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-100 truncate">
                          {selectedReferrer.name || "Unnamed user"}
                        </p>
                        <p className="text-[11px] text-slate-300 truncate">
                          {selectedReferrer.email}
                        </p>
                        {selectedReferrer.churchName && (
                          <p className="text-[10px] text-slate-400 truncate">
                            {selectedReferrer.churchName}
                          </p>
                        )}
                        <span className="mt-1 inline-block text-[10px] font-mono uppercase font-bold text-violet-300 bg-violet-900/60 px-1.5 py-0.5 rounded">
                          Plan: {selectedReferrer.plan}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedReferrer(null)}
                        className="text-xs text-red-400 hover:text-red-300 hover:underline shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                        <input
                          type="text"
                          value={referrerQuery}
                          onChange={(e) => searchUsers(e.target.value, "referrer")}
                          placeholder="Search name, email, church..."
                          className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                        />
                        {searchingReferrer && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                          </div>
                        )}
                      </div>

                      {referrerResults.length > 0 && (
                        <div className="mt-1.5 max-h-40 overflow-y-auto divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950 p-1">
                          {referrerResults.map((u) => (
                            <div
                              key={u.id}
                              onClick={() => {
                                setSelectedReferrer(u);
                                setReferrerResults([]);
                              }}
                              className="p-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between gap-2 cursor-pointer transition"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 truncate">
                                  {u.name || "Unnamed user"}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                              </div>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                                {u.plan}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Referred User Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    2. Referred User (New account)
                  </label>
                  {selectedReferred ? (
                    <div className="p-3.5 rounded-xl border border-green-500/40 bg-green-950/30 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-100 truncate">
                          {selectedReferred.name || "Unnamed user"}
                        </p>
                        <p className="text-[11px] text-slate-300 truncate">
                          {selectedReferred.email}
                        </p>
                        {selectedReferred.churchName && (
                          <p className="text-[10px] text-slate-400 truncate">
                            {selectedReferred.churchName}
                          </p>
                        )}
                        <span className="mt-1 inline-block text-[10px] font-mono uppercase font-bold text-green-300 bg-green-900/60 px-1.5 py-0.5 rounded">
                          Plan: {selectedReferred.plan}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedReferred(null)}
                        className="text-xs text-red-400 hover:text-red-300 hover:underline shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                        <input
                          type="text"
                          value={referredQuery}
                          onChange={(e) => searchUsers(e.target.value, "referred")}
                          placeholder="Search name, email, church..."
                          className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                        />
                        {searchingReferred && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400" />
                          </div>
                        )}
                      </div>

                      {referredResults.length > 0 && (
                        <div className="mt-1.5 max-h-40 overflow-y-auto divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950 p-1">
                          {referredResults.map((u) => (
                            <div
                              key={u.id}
                              onClick={() => {
                                setSelectedReferred(u);
                                setReferredResults([]);
                              }}
                              className="p-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between gap-2 cursor-pointer transition"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 truncate">
                                  {u.name || "Unnamed user"}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                              </div>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                                {u.plan}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {assignError && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{assignError}</span>
                </div>
              )}

              {assignSuccess && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{assignSuccess}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-950/40 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignSubmit}
                disabled={!selectedReferrer || !selectedReferred || assigning}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-500 disabled:opacity-50 transition"
              >
                {assigning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Linking...
                  </>
                ) : (
                  "Confirm Link (No Email)"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
