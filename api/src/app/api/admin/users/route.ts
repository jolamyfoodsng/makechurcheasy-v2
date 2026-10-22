import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import clientPromise from "@/lib/mongodb";
import { calculateBulkCredits } from "@/lib/credits";
import { checkAllExpiredAdminTemporaryPlans } from "@/lib/adminTemporaryPlan";
import { checkAndApplyScheduledDowngrade } from "@/lib/scheduledDowngrade";
import { getEffectivePlan } from "@/lib/trial";
import { loadUserEngagement, scoreUserEngagement, presentsOf, type UserEngagement } from "@/lib/userEngagement";
import { classifyRetention, loadRealUseTimes } from "@/lib/userRetention";
import { GROWTH_REACTIVATION_CAMPAIGN_KEY } from "@/lib/reactivationAudience";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    await checkAllExpiredAdminTemporaryPlans().catch((err) => {
      console.error("Admin list users temporary-plan expiry check failed:", err);
    });

    const client = await clientPromise;
    const db = client.db();

    let users = await db
      .collection("users")
      .find({}, {
        projection: {
          password: 0,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    users = await Promise.all(
      users.map((u) => {
        const scheduledAt =
          u.scheduledDowngradeAt ||
          (u.adminManagedSubscription?.active ? u.adminManagedSubscription.expiresAt : null);
        const scheduledMs = scheduledAt ? new Date(String(scheduledAt)).getTime() : NaN;
        if ((u.plan || "free") !== "free" && Number.isFinite(scheduledMs) && scheduledMs <= Date.now()) {
          return checkAndApplyScheduledDowngrade(u._id.toString(), u);
        }
        return u;
      }),
    );

    const userIds = users.map((u) => u._id.toString());
    const userObjectIds = users.map((u) => u._id);

    const reactivationOfferMap = new Map<string, {
      status: string;
      offeredAt: string | null;
      grantedAt: string | null;
      expiresAt: string | null;
    }>();
    try {
      const offers = await db.collection("reactivation_offers")
        .find(
          { campaignKey: GROWTH_REACTIVATION_CAMPAIGN_KEY, userId: { $in: userIds } },
          { projection: { userId: 1, status: 1, offeredAt: 1, grantedAt: 1, expiresAt: 1 } },
        )
        .toArray();
      for (const offer of offers) {
        reactivationOfferMap.set(String(offer.userId), {
          status: String(offer.status || "available"),
          offeredAt: offer.offeredAt?.toISOString?.() || offer.offeredAt || null,
          grantedAt: offer.grantedAt?.toISOString?.() || offer.grantedAt || null,
          expiresAt: offer.expiresAt?.toISOString?.() || offer.expiresAt || null,
        });
      }
    } catch (err) {
      console.warn("Could not query reactivation offers:", err);
    }

    // Bulk-calculate real credit balances (2 queries total, regardless of user count)
    const creditBalances = await calculateBulkCredits(
      users.map((u) => ({
        id: u._id.toString(),
        role: u.role,
        plan: u.plan,
        trial: u.trial,
        ambassador: u.ambassador,
        adminTemporaryPlan: u.adminTemporaryPlan,
        adminManagedSubscription: u.adminManagedSubscription,
        subscriptionExpiresAt: u.subscriptionExpiresAt,
      }))
    );

    // Query latest active session per user from security_sessions
    const sessionMap = new Map<string, string>();
    try {
      const latestSessions = await db
        .collection("security_sessions")
        .aggregate<{ _id: string; latestActive: string }>([
          { $match: { userId: { $in: [...userIds, ...userObjectIds] }, lastActive: { $ne: null } } },
          { $group: { _id: "$userId", latestActive: { $max: "$lastActive" } } },
        ])
        .toArray();
      for (const s of latestSessions) {
        if (s._id && s.latestActive) {
          sessionMap.set(String(s._id), String(s.latestActive));
        }
      }
    } catch (err) {
      console.warn("Could not aggregate security_sessions:", err);
    }

    // Query device counts and latest lastSeen per user
    const deviceCountMap = new Map<string, number>();
    const deviceLastSeenMap = new Map<string, string>();
    const deviceAppMap = new Map<string, {
      appVersion: string;
      appPlatform: string;
      appVersions: string[];
      appPlatforms: string[];
    }>();
    try {
      const deviceAgg = await db
        .collection("devices")
        .aggregate<{
          _id: string;
          count: number;
          latestSeen?: string | Date;
          latestVersion?: string | null;
          latestPlatform?: string | null;
          versions?: Array<string | null>;
          platforms?: Array<string | null>;
        }>([
          { $match: { userId: { $in: userIds }, $or: [{ status: "active" }, { status: { $exists: false } }] } },
          { $sort: { lastSeen: -1 } },
          {
            $group: {
              _id: "$userId",
              count: { $sum: 1 },
              latestSeen: { $max: "$lastSeen" },
              latestVersion: { $first: "$appVersion" },
              latestPlatform: { $first: "$appPlatform" },
              versions: { $addToSet: "$appVersion" },
              platforms: { $addToSet: "$appPlatform" },
            },
          },
        ])
        .toArray();
      for (const d of deviceAgg) {
        if (d._id) {
          const clean = (list?: Array<string | null>) =>
            Array.from(new Set((list || []).map((v) => String(v || "").trim()).filter(Boolean)));
          deviceAppMap.set(String(d._id), {
            appVersion: String(d.latestVersion || "").trim(),
            appPlatform: String(d.latestPlatform || "").trim(),
            appVersions: clean(d.versions),
            appPlatforms: clean(d.platforms),
          });
          deviceCountMap.set(String(d._id), d.count);
          if (d.latestSeen) {
            deviceLastSeenMap.set(String(d._id), new Date(d.latestSeen).toISOString());
          }
        }
      }
    } catch (err) {
      console.warn("Could not aggregate devices:", err);
    }

    // Query latest activity per user from activity_events
    const activityLastSeenMap = new Map<string, string>();
    try {
      const activityAgg = await db
        .collection("activity_events")
        .aggregate<{ _id: string; latestTime: string | Date }>([
          {
            $match: {
              $or: [
                { userId: { $in: userIds } },
                { userId: { $in: userObjectIds } },
              ],
            },
          },
          {
            $group: {
              _id: "$userId",
              latestTime: { $max: { $ifNull: ["$timestamp", "$createdAt"] } },
            },
          },
        ])
        .toArray();
      for (const a of activityAgg) {
        if (a._id && a.latestTime) {
          activityLastSeenMap.set(String(a._id), new Date(a.latestTime).toISOString());
        }
      }
    } catch (err) {
      console.warn("Could not aggregate activity_events:", err);
    }

    // Real usage in the last 24h / 7 days / 30 days (drives the activity scores).
    let engagementMap = new Map<string, UserEngagement>();
    try {
      engagementMap = await loadUserEngagement(db, userIds);
    } catch (err) {
      console.warn("Could not load user engagement:", err);
    }

    // The last time each user really used the product (not just opened it): drives "still with us".
    let realUseMap = new Map<string, { firstUseAt: string; lastUseAt: string }>();
    try {
      realUseMap = await loadRealUseTimes(db, userIds);
    } catch (err) {
      console.warn("Could not load real-use times:", err);
    }

    // Query usage per user from user_usage collection
    const usageMap = new Map<string, { bibleSearches: number; songsCreated: number; mediaUploaded: number; transcriptCount: number; aiHoursUsed: number }>();
    try {
      const usageDocs = await db
        .collection("user_usage")
        .find({
          $or: [
            { userId: { $in: userIds } },
            { userId: { $in: userObjectIds } },
          ],
        })
        .toArray();
      for (const u of usageDocs) {
        const uid = String(u.userId);
        usageMap.set(uid, {
          bibleSearches: (u.bibleSearches || 0) + (u.bibleSearchVersions || 0),
          songsCreated: u.songs || 0,
          mediaUploaded: (u.images || 0) + (u.videos || 0),
          transcriptCount: u.transcripts || 0,
          aiHoursUsed: u.aiHoursUsed || 0,
        });
      }
    } catch (err) {
      console.warn("Could not query user_usage:", err);
    }

    // Query transcription balances
    const transcriptionBalanceMap = new Map<
      string,
      {
        includedSeconds: number;
        purchasedSeconds: number;
        totalAvailableSeconds: number;
        includedHours: number;
        purchasedHours: number;
        totalAvailableHours: number;
        totalAvailableCredits: number;
      }
    >();
    try {
      const transDocs = await db.collection("transcription_balances").find({ userId: { $in: userIds } }).toArray();
      for (const tb of transDocs) {
        const inc = tb.includedSeconds || 0;
        const pur = tb.purchasedSeconds || 0;
        const tot = inc + pur;
        transcriptionBalanceMap.set(tb.userId, {
          includedSeconds: inc,
          purchasedSeconds: pur,
          totalAvailableSeconds: tot,
          includedHours: Math.round((inc / 3600) * 10) / 10,
          purchasedHours: Math.round((pur / 3600) * 10) / 10,
          totalAvailableHours: Math.round((tot / 3600) * 10) / 10,
          totalAvailableCredits: Math.round(tot / 60),
        });
      }
    } catch (err) {
      console.warn("Could not query transcription_balances:", err);
    }

    // Query subscriptions to get real billing cycles & statuses
    const subscriptionMap = new Map<string, {
      plan: string;
      billingCycle: string;
      status: string;
      currentPeriodEnd: string | null;
      gracePeriodEndsAt: string | null;
    }>();
    try {
      const subs = await db
        .collection("subscriptions")
        .find({ userId: { $in: userIds } })
        .sort({ createdAt: -1 })
        .toArray();
      for (const s of subs) {
        const uid = String(s.userId);
        if (!subscriptionMap.has(uid)) {
          subscriptionMap.set(uid, {
            plan: s.plan || "free",
            billingCycle: s.billingCycle || "monthly",
            status: s.status || "active",
            currentPeriodEnd: s.currentPeriodEnd || null,
            gracePeriodEndsAt: s.gracePeriodEndsAt || null,
          });
        }
      }
    } catch (err) {
      console.warn("Could not query subscriptions:", err);
    }

    const formatted = users.map((u) => {
      const id = u._id.toString();
      const userSub = subscriptionMap.get(id) || null;
      const effectivePlan = getEffectivePlan(u as any);
      const billingCycle = userSub?.billingCycle || u.adminManagedSubscription?.billingCycle || (effectivePlan !== "free" ? "monthly" : null);
      const trial =
        effectivePlan === "trial"
          ? u.trial || null
          : u.trial
            ? { ...u.trial, active: false }
            : null;

      const lastActiveRaw = u.lastActive?.toISOString?.() || u.lastActive || null;
      const lastLoginRaw = u.lastLogin?.toISOString?.() || u.lastLogin || null;
      const sessionActiveRaw = sessionMap.get(id) || null;
      const deviceActiveRaw = deviceLastSeenMap.get(id) || null;
      const activityActiveRaw = activityLastSeenMap.get(id) || activityLastSeenMap.get(u._id.toString()) || null;

      const timestamps = [lastActiveRaw, lastLoginRaw, sessionActiveRaw, deviceActiveRaw, activityActiveRaw]
        .map((t) => (t ? new Date(t).getTime() : NaN))
        .filter((n) => Number.isFinite(n) && n > 0);

      // "Last opened": any sign of life — app launch, sign-in, update check, device ping or any event.
      // It says the app is installed and running, not that the church used it.
      const latestOpenedMs = timestamps.length > 0 ? Math.max(...timestamps) : null;
      const lastOpened = latestOpenedMs ? new Date(latestOpenedMs).toISOString() : null;

      const userUsage = usageMap.get(id) || usageMap.get(u._id.toString()) || null;
      const engagement = engagementMap.get(id);
      const activity = engagement ? scoreUserEngagement(engagement) : null;
      const realUse = realUseMap.get(id);
      const retention = classifyRetention({
        createdAt: u.createdAt,
        lastUseAt: realUse?.lastUseAt,
        firstUseAt: realUse?.firstUseAt,
      });

      const effectiveExpiresAt =
        u.adminManagedSubscription?.active && u.adminManagedSubscription.expiresAt
          ? u.adminManagedSubscription.expiresAt
          : u.adminTemporaryPlan?.active && u.adminTemporaryPlan.expiresAt
            ? u.adminTemporaryPlan.expiresAt
            : effectivePlan === "trial" && (trial?.expiresAt || trial?.endsAt)
              ? (trial.expiresAt || trial.endsAt)
              : (effectivePlan !== "free" && u.subscriptionExpiresAt)
                ? u.subscriptionExpiresAt
                : u.scheduledDowngradeAt || null;

      return {
        id,
        name: u.name || "",
        email: u.email || "",
        phone: u.phone || u.phoneNumber || "",
        avatar: u.avatar || "",
        churchName: u.churchName || "",
        churchRole: u.churchRole || u.roleInChurch || "",
        country: u.country || "",
        role: u.role || "user",
        accountStatus: u.isActive === false ? "suspended" : "active",
        billingCycle,
        subscriptionStatus: userSub?.status || null,
        credits: creditBalances.get(id) ?? 0,
        transcriptionBalance: transcriptionBalanceMap.get(id) || null,
        // Display the effective entitlement, not a stale stored paid plan.
        // Active trials remain labelled Free so the existing trial badge is shown.
        plan: effectivePlan === "trial" ? "free" : effectivePlan,
        signupDate: u.createdAt?.toISOString?.() || u.createdAt || null,
        createdAt: u.createdAt?.toISOString?.() || u.createdAt || null,
        lastLogin: lastLoginRaw,
        lastOpened,
        // "Last used": the last time they presented, searched, imported, uploaded or used voice.
        lastUsed: retention.lastUseAt,
        appId: u.appId || "",
        // Desktop app details from the user's devices (latest device first).
        deviceCount: deviceCountMap.get(id) ?? 0,
        appVersion: deviceAppMap.get(id)?.appVersion || u.appVersion || "",
        appPlatform: deviceAppMap.get(id)?.appPlatform || u.appPlatform || "",
        appVersions: deviceAppMap.get(id)?.appVersions ?? (u.appVersion ? [String(u.appVersion)] : []),
        appPlatforms: deviceAppMap.get(id)?.appPlatforms ?? (u.appPlatform ? [String(u.appPlatform)] : []),
        // Active means real use in the last 30 days; opening the app alone does not count.
        isActive: retention.lastUseAt
          ? new Date(retention.lastUseAt).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
          : false,
        trial,
        ambassador: u.ambassador || null,
        adminTemporaryPlan: u.adminTemporaryPlan || null,
        adminManagedSubscription: u.adminManagedSubscription || null,
        subscriptionExpiresAt: effectiveExpiresAt,
        scheduledDowngradeAt: u.scheduledDowngradeAt || null,
        activationMilestones: u.activationMilestones || null,
        reactivationOffer: reactivationOfferMap.get(id) || null,
        zohoLists: u.zohoCampaigns?.inZoho ? (u.zohoCampaigns.lists || []) : null,
        usage: userUsage,
        activityScore: activity
          ? {
            score: activity.score,
            grade: activity.grade,
            color: activity.color,
            badgeBg: activity.badgeBg,
            barColor: activity.barColor,
            daily: activity.daily,
            weekly: activity.weekly,
            monthly: activity.monthly,
            method: activity.method,
          }
          : null,
        retention,
        engagement30d: engagement
          ? {
            activeDays: engagement.month.activeDays,
            presented: presentsOf(engagement.month),
            multistreamSeconds: engagement.month.multistreamSeconds,
          }
          : null,
      };
    });

    return NextResponse.json({ users: formatted });
  } catch (error) {
    console.error("Admin list users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
