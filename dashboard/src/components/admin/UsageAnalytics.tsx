"use client";

/**
 * UsageAnalytics.tsx — where people go and what they click in the desktop app and the OBS docks.
 *
 *   <UsageAnalyticsSection />   all users, on the admin Analytics page
 *   <UserUsagePanel userId />   one user, on the user profile ("App usage" tab)
 *
 * Data comes from /api/admin/usage and /api/admin/users/[id]/usage (events sent by
 * desktop/src/services/usageTracker.ts). Page names come from lib/usagePageLabels.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Clock, Eye, MousePointerClick, RefreshCw, Search, Users } from "lucide-react";
import { KEY_USAGE_PAGES, USAGE_SURFACE_LABELS, usagePageLabel } from "@/lib/usagePageLabels";

interface DayPoint { date: string; views: number; clicks: number; users: number }
interface PageRow { surface: string; page: string; views: number; clicks: number; users: number; avgSeconds: number; adoptionPercent?: number }
interface ClickRow { surface: string; page: string; label: string; area: string; clicks: number; users: number }
interface FeedRow { id: string; ts: string; userId: string | null; name: string; email: string; surface: string; type: string; page: string; label: string; area: string }
interface Overview {
  totals: { views: number; clicks: number; activeUsers: number; sessions: number; registeredUsers: number };
  surfaces: Array<{ surface: string; views: number; clicks: number; users: number }>;
  byDay: DayPoint[];
  pages: PageRow[];
  clicks: ClickRow[];
}
interface UserUsage {
  user: { id: string; name: string; email: string };
  totals: { views: number; clicks: number };
  firstSeen: string | null;
  lastSeen: string | null;
  sessions: number;
  surfaces: Array<{ surface: string; views: number; clicks: number }>;
  byDay: DayPoint[];
  pages: PageRow[];
  clicks: ClickRow[];
  recent: FeedRow[];
}

const PERIODS = [
  { value: 1, label: "Last 24 hours" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

const SELECT_CLASS =
  "h-10 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500";

function formatSeconds(seconds: number): string {
  if (!seconds) return "–";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "–";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Kpi({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-gray-800/60 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-50 tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function SurfaceBadge({ surface }: { surface: string }) {
  return <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-[10px] text-slate-300 whitespace-nowrap">{USAGE_SURFACE_LABELS[surface] ?? surface}</span>;
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-700/60 bg-gray-800/40 p-5">
      <h3 className="text-sm font-semibold text-slate-50">{title}</h3>
      {description && <p className="text-[11px] text-slate-500 mt-0.5 mb-3">{description}</p>}
      <div className={description ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function DailyBars({ days }: { days: DayPoint[] }) {
  const max = Math.max(1, ...days.map((d) => d.views + d.clicks));
  if (days.length === 0) return <p className="text-sm text-slate-500">No activity in this period yet.</p>;
  return (
    <div className="flex items-end gap-1 h-28" role="img" aria-label="Page views and clicks per day">
      {days.map((d) => (
        <div key={d.date} className="flex-1 min-w-[3px] flex flex-col justify-end" title={`${d.date}: ${d.views} page views, ${d.clicks} clicks, ${d.users} people`}>
          <div className="w-full rounded-t bg-sky-500/70" style={{ height: `${(d.clicks / max) * 100}%` }} />
          <div className="w-full bg-indigo-500/80" style={{ height: `${(d.views / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function PagesTable({ pages, showAdoption }: { pages: PageRow[]; showAdoption: boolean }) {
  if (pages.length === 0) return <p className="text-sm text-slate-500">No page views yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Page</th>
            <th className="py-2 pr-3 font-medium text-right">Views</th>
            {showAdoption && <th className="py-2 pr-3 font-medium text-right">People</th>}
            {showAdoption && <th className="py-2 pr-3 font-medium w-40">Of active people</th>}
            <th className="py-2 pr-3 font-medium text-right">Avg time</th>
            <th className="py-2 font-medium text-right">Clicks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {pages.map((p) => (
            <tr key={`${p.surface}|${p.page}`} className="text-slate-200">
              <td className="py-2 pr-3"><span className="font-medium">{usagePageLabel(p.page)}</span> <SurfaceBadge surface={p.surface} /></td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.views.toLocaleString()}</td>
              {showAdoption && <td className="py-2 pr-3 text-right tabular-nums">{p.users.toLocaleString()}</td>}
              {showAdoption && (
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded bg-slate-700"><div className="h-full rounded bg-emerald-500" style={{ width: `${Math.min(100, p.adoptionPercent ?? 0)}%` }} /></div>
                    <span className="w-9 text-right text-xs text-slate-400 tabular-nums">{p.adoptionPercent ?? 0}%</span>
                  </div>
                </td>
              )}
              <td className="py-2 pr-3 text-right tabular-nums text-slate-400">{formatSeconds(p.avgSeconds)}</td>
              <td className="py-2 text-right tabular-nums">{p.clicks.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClicksTable({ clicks, showPeople }: { clicks: ClickRow[]; showPeople: boolean }) {
  if (clicks.length === 0) return <p className="text-sm text-slate-500">No clicks yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Button</th>
            <th className="py-2 pr-3 font-medium">On page</th>
            <th className="py-2 pr-3 font-medium">Area</th>
            {showPeople && <th className="py-2 pr-3 font-medium text-right">People</th>}
            <th className="py-2 font-medium text-right">Clicks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {clicks.map((c, i) => (
            <tr key={`${c.surface}|${c.page}|${c.label}|${c.area}|${i}`} className="text-slate-200">
              <td className="py-2 pr-3 font-medium">{c.label}</td>
              <td className="py-2 pr-3">{usagePageLabel(c.page)} <SurfaceBadge surface={c.surface} /></td>
              <td className="py-2 pr-3 text-slate-400">{c.area || "–"}</td>
              {showPeople && <td className="py-2 pr-3 text-right tabular-nums">{c.users.toLocaleString()}</td>}
              <td className="py-2 text-right tabular-nums">{c.clicks.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityList({ rows, showPerson }: { rows: FeedRow[]; showPerson: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No activity found.</p>;
  return (
    <ul className="divide-y divide-slate-800 max-h-[28rem] overflow-y-auto">
      {rows.map((r) => (
        <li key={r.id} className="py-2 flex items-start gap-3 text-sm">
          <span className="w-16 shrink-0 text-[11px] text-slate-500 pt-0.5" title={new Date(r.ts).toLocaleString()}>{timeAgo(r.ts)}</span>
          {showPerson && (
            <div className="w-56 shrink-0 min-w-0">
              {r.userId ? (
                <Link href={`/admin/users/${r.userId}`} className="block truncate text-indigo-300 hover:text-indigo-200">{r.name || r.email || "Unknown user"}</Link>
              ) : (
                <span className="text-slate-500">Unknown user</span>
              )}
              {r.name && r.email && <span className="block truncate text-[11px] text-slate-500">{r.email}</span>}
            </div>
          )}
          <div className="min-w-0 flex-1 text-slate-200">
            {r.type === "click" ? (
              <>Clicked <span className="font-medium">{r.label || "a control"}</span>{r.area ? <span className="text-slate-500"> in {r.area}</span> : null} on </>
            ) : (
              <>Opened </>
            )}
            <span className="font-medium">{usagePageLabel(r.page)}</span> <SurfaceBadge surface={r.surface} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function useJson<T>(url: string | null): { data: T | null; loading: boolean; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    setLoading(true);
    fetch(url, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load usage (${res.status})`);
        return res.json() as Promise<T>;
      })
      .then((json) => { if (!cancelled) { setData(json); setError(""); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load usage"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, tick]);
  return { data, loading, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

// ── All users ───────────────────────────────────────────────────────────────

export function UsageAnalyticsSection() {
  const [period, setPeriod] = useState(30);
  const [surface, setSurface] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const base = `period=${period}${surface === "all" ? "" : `&surface=${surface}`}`;
  const overview = useJson<Overview>(`/api/admin/usage?${base}`);
  const feed = useJson<{ events: FeedRow[] }>(`/api/admin/usage?view=feed&${base}${query ? `&q=${encodeURIComponent(query)}` : ""}`);

  // The live activity list refreshes by itself.
  const reloadFeed = feed.reload;
  useEffect(() => {
    const timer = setInterval(reloadFeed, 30_000);
    return () => clearInterval(timer);
  }, [reloadFeed]);

  const data = overview.data;
  const keyPages = useMemo(
    () => KEY_USAGE_PAGES.map((k) => ({ ...k, row: data?.pages.find((p) => p.surface === k.surface && p.page === k.page) })),
    [data],
  );

  return (
    <section className="space-y-5" aria-label="App usage">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-50">App usage</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Pages opened and buttons clicked in the desktop app and the OBS docks, by person. Only people on a version with usage tracking appear.</p>
        </div>
        <div className="flex gap-2">
          <select aria-label="Where" value={surface} onChange={(e) => setSurface(e.target.value)} className={SELECT_CLASS}>
            <option value="all">Everywhere</option>
            <option value="app">Desktop app</option>
            <option value="dock">OBS dock</option>
            <option value="lm-dock">Verse AI dock</option>
          </select>
          <select aria-label="Period" value={period} onChange={(e) => setPeriod(parseInt(e.target.value, 10))} className={SELECT_CLASS}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {overview.error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{overview.error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Users} label="Active people" value={overview.loading ? "…" : data?.totals.activeUsers ?? 0} hint={data ? `of ${data.totals.registeredUsers.toLocaleString()} registered` : undefined} />
        <Kpi icon={Eye} label="Page views" value={overview.loading ? "…" : data?.totals.views ?? 0} />
        <Kpi icon={MousePointerClick} label="Clicks" value={overview.loading ? "…" : data?.totals.clicks ?? 0} />
        <Kpi icon={Activity} label="Sessions" value={overview.loading ? "…" : data?.totals.sessions ?? 0} hint="Each time the app or dock was opened" />
      </div>

      <Panel title="Are people using the key pages?" description="People who opened each page, out of everyone active in this period.">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {keyPages.map((k) => (
            <div key={`${k.surface}|${k.page}`} className="rounded-xl border border-slate-700/60 bg-gray-900/40 p-3">
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-100">{k.label}</span><SurfaceBadge surface={k.surface} /></div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-bold text-slate-50 tabular-nums">{k.row?.adoptionPercent ?? 0}%</span>
                <span className="text-[11px] text-slate-500">{(k.row?.users ?? 0).toLocaleString()} people · {(k.row?.views ?? 0).toLocaleString()} views · {(k.row?.clicks ?? 0).toLocaleString()} clicks</span>
              </div>
              <div className="mt-2 h-1.5 rounded bg-slate-700"><div className="h-full rounded bg-emerald-500" style={{ width: `${Math.min(100, k.row?.adoptionPercent ?? 0)}%` }} /></div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Panel title="Activity per day" description="Page views (indigo) and clicks (blue).">
            <DailyBars days={data?.byDay ?? []} />
          </Panel>
        </div>
        <Panel title="By place" description="Where the activity happens.">
          <ul className="space-y-2 text-sm">
            {(data?.surfaces ?? []).map((s) => (
              <li key={s.surface} className="flex items-center justify-between text-slate-200">
                <span>{USAGE_SURFACE_LABELS[s.surface] ?? s.surface}</span>
                <span className="text-[11px] text-slate-500 tabular-nums">{s.users} people · {s.views} views · {s.clicks} clicks</span>
              </li>
            ))}
            {(data?.surfaces.length ?? 0) === 0 && <li className="text-slate-500">No activity yet.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="Most used pages" description="Sorted by page views.">
        <PagesTable pages={data?.pages ?? []} showAdoption />
      </Panel>

      <Panel title="Most clicked buttons" description="The controls people press most, and on which page.">
        <ClicksTable clicks={data?.clicks ?? []} showPeople />
      </Panel>

      <Panel title="Live activity" description="Latest pages opened and buttons clicked, with the person's name and email.">
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}
        >
          <label className="relative flex-1">
            <span className="sr-only">Search activity</span>
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a name, email, page or button"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-700 bg-gray-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            />
          </label>
          <button type="submit" className="h-10 px-4 rounded-xl bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500">Search</button>
          <button type="button" onClick={feed.reload} aria-label="Refresh" className="h-10 w-10 inline-flex items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`w-4 h-4 ${feed.loading ? "animate-spin" : ""}`} />
          </button>
        </form>
        {feed.error ? <p className="text-sm text-red-300">{feed.error}</p> : <ActivityList rows={feed.data?.events ?? []} showPerson />}
      </Panel>
    </section>
  );
}

// ── One user ────────────────────────────────────────────────────────────────

export function UserUsagePanel({ userId }: { userId: string }) {
  const [period, setPeriod] = useState(30);
  const { data, loading, error } = useJson<UserUsage>(`/api/admin/users/${userId}/usage?period=${period}`);

  return (
    <section className="space-y-5" aria-label="App usage">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-50">App usage</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Which pages this person opens and what they click in the desktop app and the OBS docks.</p>
        </div>
        <select aria-label="Period" value={period} onChange={(e) => setPeriod(parseInt(e.target.value, 10))} className={SELECT_CLASS}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Eye} label="Page views" value={loading ? "…" : data?.totals.views ?? 0} />
        <Kpi icon={MousePointerClick} label="Clicks" value={loading ? "…" : data?.totals.clicks ?? 0} />
        <Kpi icon={Activity} label="Sessions (all time)" value={loading ? "…" : data?.sessions ?? 0} />
        <Kpi icon={Clock} label="Last seen" value={loading ? "…" : timeAgo(data?.lastSeen ?? null)} hint={data?.firstSeen ? `First seen ${new Date(data.firstSeen).toLocaleDateString()}` : undefined} />
      </div>

      {!loading && data && data.totals.views + data.totals.clicks === 0 && (
        <p className="rounded-2xl border border-slate-700/60 bg-gray-800/40 p-4 text-sm text-slate-400">
          No usage recorded for this person in this period. They may be on a version before usage tracking, or have not opened the app.
        </p>
      )}

      <Panel title="Most used pages" description="Sorted by page views.">
        <PagesTable pages={data?.pages ?? []} showAdoption={false} />
      </Panel>
      <Panel title="Most clicked buttons"><ClicksTable clicks={data?.clicks ?? []} showPeople={false} /></Panel>
      <Panel title="Activity per day" description="Page views (indigo) and clicks (blue)."><DailyBars days={data?.byDay ?? []} /></Panel>
      <Panel title="Latest activity" description="The last 100 pages opened and buttons clicked.">
        <ActivityList rows={data?.recent ?? []} showPerson={false} />
      </Panel>
    </section>
  );
}
