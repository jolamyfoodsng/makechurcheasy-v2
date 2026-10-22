/**
 * userEngagement.ts — how much a church actually USES the product, per time window.
 *
 * Replaces the old milestone-based score, which mixed lifetime milestones
 * ("presented once, ever") with sign-in recency, so a user who presented once
 * months ago and opened the app today scored ~100% "daily".
 *
 * Every score here is computed only from what happened inside the window:
 *   daily   = last 24 hours    weekly = last 7 days    monthly = last 30 days
 *
 * Inputs (all from real events):
 *   activity_events       bible_present, worship_song_presented, media_presented,
 *                         broadcast_graphic_shown, lower_third_shown, ticker_shown, note_shown,
 *                         countdown_shown, sts_push_to_live, voice_session_completed,
 *                         searches / songs created / uploads / transcripts / translations,
 *                         obs_connected, app_started
 *   multistream_sessions  usedSeconds per session
 *
 * Score (0-100) per window:
 *   Consistency  30  days with real use vs. what a church normally needs
 *                    (1 day per 24h, 2 days per week, 6 days per month — most use is Sunday + midweek)
 *   Presenting   35  verses, songs, media, graphics, notes, countdowns and voice verses sent to screen (log-scaled)
 *   Preparation  10  searches, songs created, uploads, transcripts, translations (log-scaled)
 *   Breadth      15  feature areas used: Bible, worship, media, voice, graphics, notes, multi-stream (4 = full)
 *   Live         10  multi-stream used (10) · OBS connected while presenting (6) · OBS connected only (3)
 * Opening the app without doing anything scores at most 5.
 */
import { ObjectId, type Db } from "mongodb";

export const ENGAGEMENT_EVENTS = {
  bibleVerses: ["bible_present"],
  bibleSearches: ["bible_search", "bible_search_version"],
  songsPresented: ["worship_song_presented", "song_presented"],
  songsCreated: ["worship_song_created", "worship_song_imported"],
  mediaPresented: ["media_presented"],
  mediaUploaded: ["media_uploaded"],
  graphicsShown: ["broadcast_graphic_shown", "lower_third_shown", "ticker_shown"],
  graphicsAdded: ["broadcast_graphic_added_to_obs"],
  liveCaptions: ["sts_push_to_live"],
  notesShown: ["note_shown", "countdown_shown"],
  voiceSessions: ["voice_session_completed"],
  transcripts: ["transcript_created"],
  translations: ["translation_generated"],
  obsConnections: ["obs_connected"],
  appOpens: ["app_started"],
} as const;

export type EngagementMetric = keyof typeof ENGAGEMENT_EVENTS;

const EVENT_TO_METRIC = new Map<string, EngagementMetric>();
for (const [metric, events] of Object.entries(ENGAGEMENT_EVENTS) as Array<[EngagementMetric, readonly string[]]>) {
  for (const event of events) EVENT_TO_METRIC.set(event, metric);
}
export const TRACKED_EVENTS = Array.from(EVENT_TO_METRIC.keys());

/** Events that count as "used the product" for active days (opening the app or OBS alone does not). */
const USE_METRICS = new Set<EngagementMetric>([
  "bibleVerses", "bibleSearches", "songsPresented", "songsCreated", "mediaPresented", "mediaUploaded",
  "graphicsShown", "graphicsAdded", "liveCaptions", "notesShown", "voiceSessions", "transcripts", "translations",
]);

/** Event names that count as real use of the product (not just opening the app or connecting OBS). */
export const USE_EVENT_NAMES: string[] = Array.from(EVENT_TO_METRIC.entries())
  .filter(([, metric]) => USE_METRICS.has(metric))
  .map(([event]) => event);

export type EngagementCounts = Record<EngagementMetric, number> & {
  voiceSeconds: number;
  multistreamSessions: number;
  multistreamSeconds: number;
  /** Days with real use (UTC days). */
  activeDays: number;
  /** Days the app was opened at all. */
  openDays: number;
  /** Most recent real use in the window. */
  lastUseAt: string | null;
};

export type EngagementWindow = "day" | "week" | "month";
export type UserEngagement = Record<EngagementWindow, EngagementCounts>;

const WINDOW_HOURS: Record<EngagementWindow, number> = { day: 24, week: 24 * 7, month: 24 * 30 };

function emptyCounts(): EngagementCounts {
  const base = Object.fromEntries(Object.keys(ENGAGEMENT_EVENTS).map((k) => [k, 0])) as Record<EngagementMetric, number>;
  return { ...base, voiceSeconds: 0, multistreamSessions: 0, multistreamSeconds: 0, activeDays: 0, openDays: 0, lastUseAt: null };
}

type HourBucket = { userId: string; event: string; hour: string; count: number; seconds: number };
type StreamRow = { userId: string; startedAt: Date; usedSeconds: number };

/**
 * Load the last 30 days of usage for many users in two queries.
 * userIds are the string ids stored on events (activity_events.userId is a string).
 */
export async function loadUserEngagement(db: Db, userIds: string[], now = new Date()): Promise<Map<string, UserEngagement>> {
  const result = new Map<string, UserEngagement>();
  for (const id of userIds) result.set(id, { day: emptyCounts(), week: emptyCounts(), month: emptyCounts() });
  if (!userIds.length) return result;

  const since = new Date(now.getTime() - WINDOW_HOURS.month * 3600 * 1000);
  const idVariants: Array<string | ObjectId> = [
    ...userIds,
    ...userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)),
  ];
  const [buckets, streams] = await Promise.all([
    db.collection("activity_events").aggregate<HourBucket>([
      // Older events may store the user id as an ObjectId; match both and normalise to a string.
      { $match: { userId: { $in: idVariants }, event: { $in: TRACKED_EVENTS }, timestamp: { $gte: since, $lte: now } } },
      {
        $group: {
          _id: { userId: { $toString: "$userId" }, event: "$event", hour: { $dateToString: { format: "%Y-%m-%dT%H", date: "$timestamp" } } },
          count: { $sum: 1 },
          seconds: { $sum: { $convert: { input: "$properties.durationSeconds", to: "double", onError: 0, onNull: 0 } } },
        },
      },
      { $project: { _id: 0, userId: "$_id.userId", event: "$_id.event", hour: "$_id.hour", count: 1, seconds: 1 } },
    ], { allowDiskUse: true }).toArray(),
    db.collection("multistream_sessions").find(
      { userId: { $in: userIds }, startedAt: { $gte: since } },
      { projection: { userId: 1, startedAt: 1, usedSeconds: 1 } },
    ).toArray().catch(() => [] as any[]) as Promise<StreamRow[]>,
  ]);

  const nowMs = now.getTime();
  const useDays: Record<EngagementWindow, Map<string, Set<string>>> = { day: new Map(), week: new Map(), month: new Map() };
  const openDays: Record<EngagementWindow, Map<string, Set<string>>> = { day: new Map(), week: new Map(), month: new Map() };
  const addDay = (map: Map<string, Set<string>>, userId: string, day: string) => {
    if (!map.has(userId)) map.set(userId, new Set());
    map.get(userId)!.add(day);
  };

  for (const b of buckets) {
    const eng = result.get(b.userId);
    const metric = EVENT_TO_METRIC.get(b.event);
    if (!eng || !metric) continue;
    // Bucket end (start of hour + 1h) decides which windows it belongs to.
    const hourStartMs = Date.parse(`${b.hour}:00:00Z`);
    if (!Number.isFinite(hourStartMs)) continue;
    const ageHours = (nowMs - hourStartMs) / 3600000;
    const day = b.hour.slice(0, 10);
    for (const w of ["day", "week", "month"] as EngagementWindow[]) {
      if (ageHours > WINDOW_HOURS[w]) continue;
      const c = eng[w];
      c[metric] += b.count;
      if (metric === "voiceSessions") c.voiceSeconds += b.seconds || 0;
      if (USE_METRICS.has(metric)) {
        addDay(useDays[w], b.userId, day);
        const iso = new Date(Math.min(nowMs, hourStartMs + 3599000)).toISOString();
        if (!c.lastUseAt || iso > c.lastUseAt) c.lastUseAt = iso;
      }
      if (metric === "appOpens" || USE_METRICS.has(metric)) addDay(openDays[w], b.userId, day);
    }
  }

  for (const s of streams) {
    const eng = result.get(String(s.userId));
    const started = new Date(s.startedAt).getTime();
    if (!eng || !Number.isFinite(started)) continue;
    const ageHours = (nowMs - started) / 3600000;
    const day = new Date(started).toISOString().slice(0, 10);
    for (const w of ["day", "week", "month"] as EngagementWindow[]) {
      if (ageHours > WINDOW_HOURS[w]) continue;
      eng[w].multistreamSessions += 1;
      eng[w].multistreamSeconds += Math.max(0, Number(s.usedSeconds) || 0);
      addDay(useDays[w], String(s.userId), day);
      addDay(openDays[w], String(s.userId), day);
    }
  }

  for (const [userId, eng] of result) {
    for (const w of ["day", "week", "month"] as EngagementWindow[]) {
      eng[w].activeDays = useDays[w].get(userId)?.size || 0;
      eng[w].openDays = openDays[w].get(userId)?.size || 0;
    }
  }
  return result;
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

export type ActivityGrade = "Champion" | "High Active" | "Moderate" | "Getting Started" | "Dormant";

export interface PeriodScore {
  score: number;
  grade: ActivityGrade;
  color: string;
  badgeBg: string;
}

export interface ActivityScoreResult extends PeriodScore {
  badgeBorder: string;
  barColor: string;
  breakdown: Array<{ category: string; score: number; maxScore: number; detail: string }>;
  daily: PeriodScore;
  weekly: PeriodScore;
  monthly: PeriodScore;
  /** How the score is computed (shown as a tooltip in the admin). */
  method: "engagement-v2";
}

const TARGETS: Record<EngagementWindow, { days: number; presents: number; prep: number }> = {
  day: { days: 1, presents: 25, prep: 10 },
  week: { days: 2, presents: 60, prep: 25 },
  month: { days: 6, presents: 200, prep: 80 },
};

export function presentsOf(c: EngagementCounts): number {
  return c.bibleVerses + c.songsPresented + c.mediaPresented + c.graphicsShown + c.liveCaptions + c.notesShown;
}

export function prepOf(c: EngagementCounts): number {
  return c.bibleSearches + c.songsCreated + c.mediaUploaded + c.transcripts + c.translations + c.graphicsAdded;
}

export function areasOf(c: EngagementCounts): string[] {
  const areas: string[] = [];
  if (c.bibleVerses || c.bibleSearches) areas.push("Bible");
  if (c.songsPresented || c.songsCreated) areas.push("Worship");
  if (c.mediaPresented || c.mediaUploaded) areas.push("Media");
  if (c.voiceSessions || c.liveCaptions || c.transcripts || c.translations) areas.push("Voice");
  if (c.graphicsShown || c.graphicsAdded) areas.push("Graphics");
  if (c.notesShown) areas.push("Notes & countdowns");
  if (c.multistreamSessions) areas.push("Multi-stream");
  return areas;
}

function logShare(value: number, target: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log(1 + value) / Math.log(1 + target));
}

function scoreParts(c: EngagementCounts, w: EngagementWindow) {
  const t = TARGETS[w];
  const presents = presentsOf(c);
  const prep = prepOf(c);
  const areas = areasOf(c);
  const consistency = Math.round(Math.min(1, c.activeDays / t.days) * 30);
  const presenting = Math.round(logShare(presents, t.presents) * 35);
  const preparation = Math.round(logShare(prep, t.prep) * 10);
  const breadth = Math.round(Math.min(1, areas.length / 4) * 15);
  const live = c.multistreamSessions > 0 ? 10 : c.obsConnections > 0 && presents > 0 ? 6 : c.obsConnections > 0 ? 3 : 0;
  const used = c.activeDays > 0 || presents > 0 || prep > 0 || c.multistreamSessions > 0 || c.voiceSessions > 0;
  let total = consistency + presenting + preparation + breadth + live;
  if (!used) total = Math.min(5, c.openDays > 0 ? 3 + (c.obsConnections > 0 ? 2 : 0) : 0);
  return { total: Math.max(0, Math.min(100, total)), consistency, presenting, preparation, breadth, live, presents, prep, areas };
}

const GRADES: Array<[number, ActivityGrade, string, string, string, string]> = [
  [75, "Champion", "text-emerald-400", "bg-emerald-950/60 text-emerald-300 border-emerald-700/60", "border-emerald-500/40", "bg-emerald-500"],
  [50, "High Active", "text-indigo-400", "bg-indigo-950/60 text-indigo-300 border-indigo-700/60", "border-indigo-500/40", "bg-indigo-500"],
  [25, "Moderate", "text-amber-400", "bg-amber-950/60 text-amber-300 border-amber-700/60", "border-amber-500/40", "bg-amber-500"],
  [10, "Getting Started", "text-blue-400", "bg-blue-950/60 text-blue-300 border-blue-700/60", "border-blue-500/40", "bg-blue-500"],
  [0, "Dormant", "text-rose-400", "bg-rose-950/50 text-rose-300 border-rose-800/60", "border-rose-500/30", "bg-rose-500"],
];

function gradeOf(score: number) {
  const g = GRADES.find(([min]) => score >= min) || GRADES[GRADES.length - 1];
  return { grade: g[1], color: g[2], badgeBg: g[3], badgeBorder: g[4], barColor: g[5] };
}

function period(c: EngagementCounts, w: EngagementWindow): PeriodScore {
  const { total } = scoreParts(c, w);
  const g = gradeOf(total);
  return { score: total, grade: g.grade, color: g.color, badgeBg: g.badgeBg };
}

/** Headline score = last 30 days, with a breakdown; plus daily / weekly / monthly. */
export function scoreUserEngagement(e: UserEngagement): ActivityScoreResult {
  const m = scoreParts(e.month, "month");
  const g = gradeOf(m.total);
  const fmtMin = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
  return {
    score: m.total,
    ...g,
    breakdown: [
      { category: "Consistency", score: m.consistency, maxScore: 30, detail: `${e.month.activeDays} day${e.month.activeDays === 1 ? "" : "s"} of real use in 30 days (6 = full)` },
      { category: "Presenting", score: m.presenting, maxScore: 35, detail: `${m.presents} item${m.presents === 1 ? "" : "s"} sent to screen (verses ${e.month.bibleVerses}, songs ${e.month.songsPresented}, media ${e.month.mediaPresented}, graphics ${e.month.graphicsShown}, voice ${e.month.liveCaptions}, notes & countdowns ${e.month.notesShown})` },
      { category: "Preparation", score: m.preparation, maxScore: 10, detail: `${m.prep} search${m.prep === 1 ? "" : "es"}, songs, uploads or transcripts` },
      { category: "Feature breadth", score: m.breadth, maxScore: 15, detail: m.areas.length ? m.areas.join(", ") : "No features used" },
      { category: "Live production", score: m.live, maxScore: 10, detail: e.month.multistreamSessions ? `Multi-stream ${e.month.multistreamSessions}× (${fmtMin(e.month.multistreamSeconds)})` : e.month.obsConnections ? "OBS connected" : "No OBS or multi-stream" },
    ],
    daily: period(e.day, "day"),
    weekly: period(e.week, "week"),
    monthly: period(e.month, "month"),
    method: "engagement-v2",
  };
}
