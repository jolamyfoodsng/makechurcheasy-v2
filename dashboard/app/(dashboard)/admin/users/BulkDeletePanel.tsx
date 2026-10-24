"use client";

import { useMemo, useState } from "react";
import { Download, Trash2, ShieldCheck, X } from "lucide-react";

/** The parts of a user this panel reads. The Users page passes its own AdminUser, which has all of these. */
export interface BulkDeleteUser {
  id: string;
  name: string;
  email: string;
  country?: string;
  role: string;
  plan: string;
  subscriptionStatus?: string | null;
  appVersion?: string;
  appVersions?: string[];
  isActive: boolean;
  lastUsed: string | null;
  trial?: { active: boolean } | null;
  ambassador?: { active: boolean } | null;
  adminTemporaryPlan?: { active: boolean } | null;
  adminManagedSubscription?: { active: boolean } | null;
}

type RuleKind = "olderThan" | "exact" | "none";
type Rule = { olderThan: string } | { exact: string } | { none: true };

interface PlanUser { id: string; email: string; name: string; appVersions: string[] }
interface Skipped { id: string; email: string; reason: string }
interface ReviewChunk { ids: string[]; willDelete: PlanUser[] }

const CHUNK = 100;

function versionsOf(u: BulkDeleteUser): string[] {
  const raw = u.appVersions && u.appVersions.length > 0 ? u.appVersions : u.appVersion ? [u.appVersion] : [];
  return Array.from(new Set(raw.map((v) => String(v).trim().replace(/^v/i, "")).filter(Boolean)));
}

function parts(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
}

/** Numbers, not text: 3.24.1 is newer than 3.3. */
function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function matches(u: BulkDeleteUser, kind: RuleKind, version: string): boolean {
  const list = versionsOf(u);
  if (kind === "none") return list.length === 0;
  if (kind === "exact") return list.some((v) => compareVersions(v, version) === 0);
  if (list.length === 0) return false;
  const best = list.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
  return compareVersions(best, version) < 0;
}

/** A first filter so the list only shows people who could be deleted. The server checks everyone again. */
function looksProtected(u: BulkDeleteUser): boolean {
  return (
    u.role === "admin" ||
    (u.plan !== "" && u.plan !== "free") ||
    Boolean(u.trial?.active) ||
    Boolean(u.ambassador?.active) ||
    Boolean(u.adminTemporaryPlan?.active) ||
    Boolean(u.adminManagedSubscription?.active) ||
    Boolean(u.subscriptionStatus) ||
    u.isActive
  );
}

async function post(body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/admin/users/bulk-delete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function downloadCsv(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkDeletePanel({ users, onDone }: { users: BulkDeleteUser[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RuleKind>("olderThan");
  const [version, setVersion] = useState("3.3");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ chunks: ReviewChunk[]; skipped: Skipped[]; willDelete: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ deleted: number; emails: string[]; failed: number; skipped: number } | null>(null);

  const versionList = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => versionsOf(u).forEach((v) => set.add(v)));
    return Array.from(set).sort((a, b) => compareVersions(b, a));
  }, [users]);

  const validVersion = kind === "none" || /^\d+(\.\d+){0,3}$/.test(version.replace(/^v/i, ""));
  const rule: Rule | null = !validVersion
    ? null
    : kind === "none"
      ? { none: true }
      : kind === "exact"
        ? { exact: version.replace(/^v/i, "") }
        : { olderThan: version.replace(/^v/i, "") };

  const matched = useMemo(
    () => (validVersion ? users.filter((u) => matches(u, kind, version)) : []),
    [users, kind, version, validVersion],
  );
  const candidates = useMemo(() => matched.filter((u) => !looksProtected(u)), [matched]);
  const protectedCount = matched.length - candidates.length;
  const allSelected = candidates.length > 0 && candidates.every((u) => selected.has(u.id));
  const chosen = candidates.filter((u) => selected.has(u.id));

  function resetFlow() {
    setReview(null);
    setTyped("");
    setError("");
    setResult(null);
  }

  function changeRule(next: () => void) {
    next();
    setSelected(new Set());
    resetFlow();
  }

  async function runReview() {
    if (!rule || chosen.length === 0) return;
    setBusy("Checking each user again on the server…");
    setError("");
    try {
      const chunks: ReviewChunk[] = [];
      const skipped: Skipped[] = [];
      for (let i = 0; i < chosen.length; i += CHUNK) {
        const ids = chosen.slice(i, i + CHUNK).map((u) => u.id);
        const { ok, data } = await post({ userIds: ids, rule, dryRun: true });
        if (!ok) throw new Error(String(data.error || "The check failed."));
        chunks.push({ ids, willDelete: (data.willDelete as PlanUser[]) || [] });
        skipped.push(...((data.skipped as Skipped[]) || []));
      }
      setReview({ chunks, skipped, willDelete: chunks.reduce((n, c) => n + c.willDelete.length, 0) });
      setTyped("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setBusy("");
    }
  }

  async function runDelete() {
    if (!rule || !review) return;
    const emails: string[] = [];
    let deleted = 0;
    let failed = 0;
    const skipped = review.skipped.length;
    setError("");
    try {
      for (let i = 0; i < review.chunks.length; i += 1) {
        const chunk = review.chunks[i];
        if (chunk.willDelete.length === 0) continue;
        setBusy(`Deleting… ${deleted + failed} of ${review.willDelete}`);
        const { ok, status, data } = await post({
          userIds: chunk.willDelete.map((u) => u.id),
          rule,
          dryRun: false,
          confirmCount: chunk.willDelete.length,
        });
        if (!ok) {
          setResult({ deleted, emails, failed, skipped });
          throw new Error(
            status === 409
              ? "The selection changed since you reviewed it, so the rest was not deleted. Review it again."
              : String(data.error || "Delete failed."),
          );
        }
        deleted += Number(data.deleted) || 0;
        failed += ((data.failed as unknown[]) || []).length;
        emails.push(...(((data.deletedEmails as string[]) || []).filter(Boolean)));
      }
      setResult({ deleted, emails, failed, skipped });
      setReview(null);
      setSelected(new Set());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy("");
    }
  }

  const confirmPhrase = review ? `DELETE ${review.willDelete}` : "";
  const reasons = useMemo(() => {
    const counts = new Map<string, number>();
    review?.skipped.forEach((s) => counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1));
    return Array.from(counts.entries());
  }, [review]);

  if (!open) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-red-800/60 bg-red-950/30 text-red-300 hover:bg-red-900/40 transition"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" /> Bulk delete by app version
        </button>
      </div>
    );
  }

  return (
    <section className="mb-4 rounded-xl border border-red-900/60 bg-red-950/10 p-4" aria-label="Bulk delete users by app version">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-50 flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" aria-hidden="true" /> Bulk delete by app version
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Deleting removes the user and their personal data and cannot be undone. Admins, trials, paid plans, anyone with billing
            records and anyone who used the product in the last 30 days are never deleted.
          </p>
        </div>
        <button type="button" onClick={() => { setOpen(false); resetFlow(); }} aria-label="Close bulk delete" className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => changeRule(() => { const k = e.target.value as RuleKind; setKind(k); if (k === "exact" && versionList[0]) setVersion(versionList[versionList.length - 1]); if (k === "olderThan") setVersion("3.3"); })}
          className="h-10 px-3 rounded-xl border border-slate-700 bg-gray-900 text-sm text-slate-100"
          aria-label="Which users"
        >
          <option value="olderThan">App version older than</option>
          <option value="exact">Exactly this app version</option>
          <option value="none">No app version recorded</option>
        </select>
        {kind === "olderThan" && (
          <input
            value={version}
            onChange={(e) => changeRule(() => setVersion(e.target.value))}
            inputMode="decimal"
            aria-label="Version"
            aria-invalid={!validVersion}
            placeholder="3.3"
            className={`h-10 w-28 px-3 rounded-xl border bg-gray-900 text-sm text-slate-100 ${validVersion ? "border-slate-700" : "border-red-500"}`}
          />
        )}
        {kind === "exact" && (
          <select
            value={version}
            onChange={(e) => changeRule(() => setVersion(e.target.value))}
            aria-label="Version"
            className="h-10 px-3 rounded-xl border border-slate-700 bg-gray-900 text-sm text-slate-100"
          >
            {versionList.map((v) => <option key={v} value={v}>v{v}</option>)}
          </select>
        )}
        <span className="text-sm text-slate-300">
          {matched.length} match · <strong className="text-slate-50">{candidates.length} can be deleted</strong>
          {protectedCount > 0 && <span className="text-slate-500"> · {protectedCount} kept (paid, trial, admin or recently used)</span>}
        </span>
      </div>
      {kind === "none" && (
        <p className="mt-2 text-xs text-amber-300">
          These users have no recorded app version. They may never have opened the desktop app, or may have signed up recently. Check the list carefully.
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-gray-900/60">
          <label className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => { setSelected(e.target.checked ? new Set(candidates.map((u) => u.id)) : new Set()); resetFlow(); }}
            />
            Select all ({candidates.length})
            <span className="ml-auto font-normal text-slate-400">{chosen.length} selected</span>
          </label>
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-800/70">
            {candidates.slice(0, 300).map((u) => (
              <li key={u.id}>
                <label className="flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(u.id); else next.delete(u.id);
                      setSelected(next);
                      resetFlow();
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-slate-100">{u.name || "(no name)"}</span>{" "}
                    <span className="text-slate-400 break-all">{u.email}</span>
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {versionsOf(u).map((v) => `v${v}`).join(", ") || "no version"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {candidates.length > 300 && (
            <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-800">
              Showing the first 300. "Select all" still selects all {candidates.length}.
            </p>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {busy && <p role="status" className="mt-3 text-sm text-slate-300">{busy}</p>}

      {!review && !result && (
        <div className="mt-3">
          <button
            type="button"
            disabled={chosen.length === 0 || !!busy || !rule}
            onClick={() => void runReview()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" /> Review {chosen.length || ""} before deleting
          </button>
        </div>
      )}

      {review && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-gray-900/70 p-3">
          <p className="text-sm text-slate-100">
            <strong>{review.willDelete} will be deleted.</strong> {review.skipped.length} were skipped after the server checked them again.
          </p>
          {reasons.length > 0 && (
            <ul className="mt-1 text-xs text-slate-400 list-disc pl-5">
              {reasons.map(([reason, count]) => <li key={reason}>{count}: {reason}</li>)}
            </ul>
          )}
          {review.willDelete > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-300" htmlFor="bulk-delete-confirm">Type <code className="px-1 rounded bg-slate-800 text-red-300">{confirmPhrase}</code> to confirm</label>
              <input
                id="bulk-delete-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="h-10 w-48 px-3 rounded-xl border border-slate-700 bg-gray-900 text-sm text-slate-100"
              />
              <button
                type="button"
                disabled={typed.trim() !== confirmPhrase || !!busy}
                onClick={() => void runDelete()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete {review.willDelete} users permanently
              </button>
              <button type="button" onClick={resetFlow} className="px-3 py-2 text-sm rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={resetFlow} className="mt-3 px-3 py-2 text-sm rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800">Close</button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-sm text-slate-100">
          <p>
            <strong>{result.deleted} deleted.</strong>
            {result.skipped > 0 && ` ${result.skipped} skipped.`}
            {result.failed > 0 && <span className="text-red-300"> {result.failed} failed. Run it again to retry them.</span>}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Zoho Campaigns is not changed from here. Download these emails and remove the same contacts in Zoho.
          </p>
          {result.emails.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(`deleted-users-${new Date().toISOString().slice(0, 10)}.csv`, [["Contact Email"], ...result.emails.map((e) => [e])])}
              className="mt-2 inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/60"
            >
              <Download className="w-4 h-4" aria-hidden="true" /> Download emails for Zoho ({result.emails.length})
            </button>
          )}
        </div>
      )}
    </section>
  );
}
