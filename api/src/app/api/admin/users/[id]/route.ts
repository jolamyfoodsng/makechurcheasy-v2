import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import clientPromise from "@/lib/mongodb";
import { calculateUserCredits } from "@/lib/credits";
import { getTrialForUser } from "@/lib/trialRecords";
import { checkAndExpireAdminTemporaryPlan } from "@/lib/adminTemporaryPlan";
import { getEffectivePlan } from "@/lib/trial";
import { logAuditEvent } from "@/lib/auditLog";
import { loadUserEngagement, scoreUserEngagement } from "@/lib/userEngagement";
import { findPossibleTrialAccounts } from "@/lib/adminTrialAccountLinks";
import { loadRealUseTimes } from "@/lib/userRetention";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const { id } = await params;
    const paymentPage = Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("paymentsPage") || "1", 10) || 1);
    const paymentPageSize = 50;
    const activityPage = Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("activityPage") || "1", 10) || 1);
    const activityPageSize = Math.max(1, Math.min(100, Number.parseInt(req.nextUrl.searchParams.get("activityLimit") || "15", 10) || 15));
    const client = await clientPromise;
    const db = client.db();
    const { ObjectId } = await import("mongodb");

    let objectId: InstanceType<typeof ObjectId>;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    let user: any = await db
      .collection("users")
      .findOne({ $or: [{ _id: objectId }, { _id: id as any }, { id }] }, { projection: { password: 0 } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    user = await checkAndExpireAdminTemporaryPlan(id, user);

    // Aggregate usage stats from activity_events
    const eventsCol = db.collection("activity_events");
    const activityMatch = {
      $or: [
        { userId: id },
        { userId: objectId },
        { userId: objectId.toString() },
      ],
    };

    const [usageAgg, userUsageDoc, dbTranscriptsCount] = await Promise.all([
      eventsCol
        .aggregate([
          { $match: activityMatch },
          {
            $group: {
              _id: "$event",
              count: { $sum: 1 },
              seconds: { $sum: { $convert: { input: "$properties.durationSeconds", to: "double", onError: 0, onNull: 0 } } },
            },
          },
        ])
        .toArray(),
      db.collection("user_usage").findOne({ $or: [{ userId: id }, { userId: objectId }] }).catch(() => null),
      db.collection("transcripts").countDocuments({ $or: [{ ownerId: id }, { ownerId: objectId }] }).catch(() => 0),
    ]);

    const eventCounts: Record<string, number> = {};
    const eventSeconds: Record<string, number> = {};
    for (const doc of usageAgg) {
      eventCounts[doc._id] = doc.count;
      eventSeconds[doc._id] = Number(doc.seconds) || 0;
    }

    // Real speech-to-scripture time from completed sessions (durationSeconds).
    const voiceSeconds = eventSeconds["voice_session_completed"] || 0;

    // Usage by window, emails, errors, multi-stream and graphics — all for this one user.
    const userIdString = objectId.toString();
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const userIdMatch = { $or: [{ userId: userIdString }, { userId: objectId }] };
    const userEmail = String(user.email || "").toLowerCase().trim();
    const emailMatch = { $or: [{ userId: userIdString }, ...(userEmail ? [{ to: userEmail }, { recipientEmail: userEmail }] : [])] };
    const [
      engagementMap,
      emailsTotal, emails30, emailsFailed, lastEmail,
      errorsTotal, errors30, lastError,
      streamAgg, streamRecent, streamErrorsTotal, streamErrorsRecent,
      graphicsTop,
      realUseMap,
    ] = await Promise.all([
      loadUserEngagement(db, [userIdString]).catch(() => null),
      db.collection("email_logs").countDocuments(emailMatch).catch(() => 0),
      db.collection("email_logs").countDocuments({ ...emailMatch, createdAt: { $gte: since30 } }).catch(() => 0),
      db.collection("email_logs").countDocuments({ ...emailMatch, status: "failed" }).catch(() => 0),
      db.collection("email_logs").findOne(emailMatch, { sort: { createdAt: -1 }, projection: { subject: 1, createdAt: 1, status: 1 } }).catch(() => null),
      db.collection("error_logs").countDocuments(userIdMatch).catch(() => 0),
      db.collection("error_logs").countDocuments({ ...userIdMatch, createdAt: { $gte: since30 } }).catch(() => 0),
      db.collection("error_logs").findOne(userIdMatch, { sort: { createdAt: -1 }, projection: { message: 1, pathname: 1, createdAt: 1 } }).catch(() => null),
      db.collection("multistream_sessions").aggregate([
        { $match: { userId: userIdString } },
        {
          $group: {
            _id: null,
            sessions: { $sum: 1 },
            seconds: { $sum: { $ifNull: ["$usedSeconds", 0] } },
            errors: { $sum: { $ifNull: ["$errorCount", 0] } },
            firstAt: { $min: "$startedAt" },
            lastAt: { $max: "$startedAt" },
            platforms: { $addToSet: "$channels.platform" },
          },
        },
      ]).toArray().catch(() => []),
      db.collection("multistream_sessions").find({ userId: userIdString }, { projection: { profileName: 1, channels: 1, status: 1, startedAt: 1, endedAt: 1, usedSeconds: 1, errorCount: 1, lastErrorCode: 1 } })
        .sort({ startedAt: -1 }).limit(10).toArray().catch(() => []),
      db.collection("multistream_errors").countDocuments({ userId: userIdString }).catch(() => 0),
      db.collection("multistream_errors").find({ userId: userIdString }, { projection: { stage: 1, code: 1, message: 1, createdAt: 1, channels: 1 } })
        .sort({ createdAt: -1 }).limit(10).toArray().catch(() => []),
      db.collection("broadcast_graphic_usage").find({ userId: userIdString }, { projection: { graphicId: 1, name: 1, addedCount: 1, shownCount: 1, lastShownAt: 1 } })
        .sort({ shownCount: -1, addedCount: -1 }).limit(8).toArray().catch(() => []),
      loadRealUseTimes(db, [userIdString]).catch(() => null),
    ]);
    const lastUsed = realUseMap?.get(userIdString)?.lastUseAt || null;
    const engagement = engagementMap?.get(userIdString) || null;
    const streamSummary = (streamAgg as any[])[0] || null;

    const [activity, activityCount, devices, payments, paymentTotals, paymentCount] = await Promise.all([
      eventsCol
        .find(
          activityMatch,
          { projection: { event: 1, properties: 1, timestamp: 1, createdAt: 1 } },
        )
        .sort({ timestamp: -1, createdAt: -1 })
        .skip((activityPage - 1) * activityPageSize)
        .limit(activityPageSize)
        .toArray(),
      eventsCol.countDocuments(activityMatch),
      db
        .collection("devices")
        .find(
          { userId: id, $or: [{ status: "active" }, { status: { $exists: false } }] },
          { projection: { deviceId: 1, deviceName: 1, appVersion: 1, appPlatform: 1, lastSeen: 1, createdAt: 1, status: 1 } },
        )
        .sort({ lastSeen: -1 })
        .toArray(),
      db
        .collection("billing_transactions")
        .find(
          { userId: id },
          { projection: { plan: 1, planName: 1, amount: 1, currency: 1, paymentProvider: 1, providerReference: 1, paystackReference: 1, type: 1, status: 1, paidAt: 1, createdAt: 1 } },
        )
        .sort({ paidAt: -1, createdAt: -1 })
        .skip((paymentPage - 1) * paymentPageSize)
        .limit(paymentPageSize)
        .toArray(),
      db
        .collection("billing_transactions")
        .aggregate([
          { $match: { userId: id, status: "success" } },
          {
            $group: {
              _id: { $toUpper: { $ifNull: ["$currency", "NGN"] } },
              amount: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      db.collection("billing_transactions").countDocuments({ userId: id }),
    ]);

    const creditResult = await calculateUserCredits(id, user);
    const effectivePlan = getEffectivePlan(user);
    const possibleTrialAccounts = await findPossibleTrialAccounts(db, userIdString, user).catch((error) => {
      console.error("Admin linked trial account lookup failed:", error);
      return null;
    });
    const subscription = await db
      .collection("subscriptions")
      .findOne({ userId: id }, { sort: { createdAt: -1 } });

    // Read trial from trials collection (single source of truth)
    const trialRecord = await getTrialForUser(id);
    const hasEffectiveTrial = getEffectivePlan(user) === "trial";
    const trialResponse = trialRecord
      ? {
        active:
          hasEffectiveTrial &&
          trialRecord.status === "active" &&
          new Date(trialRecord.endsAt).getTime() > Date.now(),
        status: hasEffectiveTrial ? trialRecord.status : "stopped",
        startedAt: trialRecord.startedAt,
        endsAt: trialRecord.endsAt,
        durationDays: trialRecord.durationDays,
        extendedDays: trialRecord.extendedDays,
        extensionCount: trialRecord.extensionCount,
        stoppedAt: trialRecord.stoppedAt,
        stoppedReason: trialRecord.stoppedReason,
        restartedAt: trialRecord.restartedAt,
        grantedBy: trialRecord.grantedBy,
        lastModifiedBy: trialRecord.lastModifiedBy,
        welcomeShown: trialRecord.welcomeShown,
      }
      : user.trial
        ? {
          ...user.trial,
          active: hasEffectiveTrial && user.trial.active === true,
          status: hasEffectiveTrial ? user.trial.status : "stopped",
        }
        : null;

    const latestEvent = activityPage === 1
      ? activity[0]
      : await eventsCol.findOne(activityMatch, { projection: { timestamp: 1, createdAt: 1 }, sort: { timestamp: -1, createdAt: -1 } });
    const latestActivityTimestamp = latestEvent?.timestamp || latestEvent?.createdAt || null;
    const latestDeviceLastSeen = devices[0]?.lastSeen || null;

    const candidateTimestamps = [
      user.lastActive?.toISOString?.() || user.lastActive,
      user.lastLogin?.toISOString?.() || user.lastLogin,
      latestActivityTimestamp ? new Date(latestActivityTimestamp).toISOString() : null,
      latestDeviceLastSeen ? new Date(latestDeviceLastSeen).toISOString() : null,
    ]
      .map((t) => (t ? new Date(t).getTime() : NaN))
      .filter((n) => Number.isFinite(n) && n > 0);

    // "Last opened": any sign of life (launch, sign-in, device ping, any event), not real use.
    const latestOpenedMs = candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : null;
    const lastOpened = latestOpenedMs
      ? new Date(latestOpenedMs).toISOString()
      : (user.lastActive?.toISOString?.() || user.lastActive || null);
    const effectiveExpiresAt =
      user.adminManagedSubscription?.active && user.adminManagedSubscription.expiresAt
        ? user.adminManagedSubscription.expiresAt
        : user.adminTemporaryPlan?.active && user.adminTemporaryPlan.expiresAt
          ? user.adminTemporaryPlan.expiresAt
          : hasEffectiveTrial && (trialResponse?.endsAt || trialResponse?.expiresAt)
            ? (trialResponse.endsAt || trialResponse.expiresAt)
            : (effectivePlan !== "free" && user.subscriptionExpiresAt)
              ? user.subscriptionExpiresAt
              : user.scheduledDowngradeAt || subscription?.currentPeriodEnd || null;

    // Who referred this person (the admin page shows the name and email, not just the code).
    let referredByName = "";
    const referrerId = typeof user.referredBy === "object" && user.referredBy ? String(user.referredBy.referrerUserId || "") : "";
    if (referrerId) {
      try {
        const referrer = await db.collection("users").findOne(
          { _id: new ObjectId(referrerId) },
          { projection: { name: 1, email: 1 } },
        );
        if (referrer) referredByName = [referrer.name, referrer.email ? `(${referrer.email})` : ""].filter(Boolean).join(" ");
      } catch {
        // Not a valid id: show the code only.
      }
    }

    return NextResponse.json({
      id: user._id.toString(),
      name: user.name || "",
      email: user.email || "",
      avatar: user.avatar || "",
      phone: user.phone || "",
      country: user.country || "",
      signupCountry: user.signupCountry || user.country || "",
      signupCity: user.signupCity || user.city || "",
      lastLoginCountry: user.lastLoginCountry || "",
      lastLoginCity: user.lastLoginCity || "",
      lastLoginTimezone: user.lastLoginTimezone || "",
      locationHistory: user.locationHistory || [],
      language: user.language || "",
      city: user.city || "",
      state: user.state || "",
      churchName: user.churchName || "",
      churchRole: user.churchRole || user.roleInChurch || "",
      denomination: user.denomination || "",
      churchSize: user.churchSize || "",
      appVersion: user.appVersion || devices[0]?.appVersion || "",
      appPlatform: user.appPlatform || devices[0]?.appPlatform || "",
      authProvider: user.provider || "credentials",
      emailVerified: Boolean(user.emailVerified),
      twoFactorEnabled: Boolean(user.twoFactorEnabled || user.twoFactorSecret),
      referralCode: user.referralCode || "",
      referredByName,
      // Older accounts store a string; newer ones an object { code, referrerUserId, ... }.
      referredBy: typeof user.referredBy === "string"
        ? user.referredBy
        : String(user.referredBy?.code || user.referredBy?.referrerUserId || ""),
      lastIp: user.lastIp || user.ipAddress || user.signupIp || user.lastLoginIp || "",
      role: user.role || "user",
      accountStatus: user.isActive === false ? "suspended" : "active",
      credits: creditResult.credits,
      // Keep the admin detail view aligned with actual entitlement when the
      // stored plan has not yet been reconciled by the daily lifecycle job.
      plan: effectivePlan === "trial" ? "free" : effectivePlan,
      signupDate: user.createdAt?.toISOString?.() || user.createdAt || null,
      // Where they came from (ChatGPT, TikTok, a friend...). Null for accounts made before this was recorded.
      signupSource: user.signupSource || null,
      createdAt: user.createdAt?.toISOString?.() || user.createdAt || null,
      lastLogin: user.lastLogin?.toISOString?.() || user.lastLogin || null,
      lastOpened,
      // Last time they presented, searched, imported, uploaded or used voice.
      lastUsed,
      appId: user.appId || "",
      trialId: user.trialId || null,
      trial: trialResponse,
      trialEligibility: ["used_on_device", "desktop_required"].includes(String(user.trialEligibility?.status))
        ? { status: user.trialEligibility.status, updatedAt: user.trialEligibility.updatedAt || null }
        : null,
      possibleTrialAccounts,
      activationMilestones: user.activationMilestones || null,
      ambassador: user.ambassador || null,
      adminTemporaryPlan: user.adminTemporaryPlan || null,
      adminManagedSubscription: user.adminManagedSubscription || null,
      subscriptionExpiresAt: effectiveExpiresAt,
      scheduledDowngradeAt: user.scheduledDowngradeAt || null,
      subscription: subscription
        ? {
          plan: subscription.plan || user.plan || "free",
          status: subscription.status || null,
          billingCycle: subscription.billingCycle || null,
          currentPeriodEnd: effectivePlan === "free" ? null : (subscription.currentPeriodEnd || null),
          nextBillingDate: effectivePlan === "free" ? null : (subscription.nextBillingDate || null),
          autoRenew: subscription.autoRenew ?? false,
          adminManaged: subscription.adminManaged || false,
          paymentProvider: subscription.paymentProvider || null,
        }
        : null,
      usage: {
        bibleSearches: (eventCounts["bible_search"] || 0) + (eventCounts["bible_search_version"] || 0),
        songsCreated: Math.max(eventCounts["worship_song_created"] || 0, userUsageDoc?.songs || 0),
        mediaUploaded: Math.max(eventCounts["media_uploaded"] || 0, (userUsageDoc?.images || 0) + (userUsageDoc?.videos || 0)),
        // Was (started + completed sessions) × 0.025 h — an estimate that double-counted.
        aiHoursUsed: +(voiceSeconds / 3600).toFixed(1),
        transcriptCount: Math.max(eventCounts["transcript_created"] || 0, dbTranscriptsCount || 0),
        bibleVersesPresented: eventCounts["bible_present"] || 0,
        songsPresented: (eventCounts["worship_song_presented"] || 0) + (eventCounts["song_presented"] || 0),
        mediaPresented: eventCounts["media_presented"] || 0,
        graphicsShown: eventCounts["broadcast_graphic_shown"] || 0,
        liveCaptionsSent: eventCounts["sts_push_to_live"] || 0,
        voiceSessions: eventCounts["voice_session_completed"] || 0,
        voiceMinutes: Math.round(voiceSeconds / 60),
        transcriptsExported: eventCounts["transcript_exported"] || 0,
        translations: eventCounts["translation_generated"] || 0,
        obsConnections: eventCounts["obs_connected"] || 0,
        appOpens: eventCounts["app_started"] || 0,
      },
      activityScore: engagement ? scoreUserEngagement(engagement) : null,
      engagement: engagement
        ? { day: engagement.day, week: engagement.week, month: engagement.month }
        : null,
      insights: {
        emails: {
          total: emailsTotal,
          last30Days: emails30,
          failed: emailsFailed,
          last: lastEmail ? { subject: String(lastEmail.subject || ""), status: String(lastEmail.status || ""), createdAt: lastEmail.createdAt || null } : null,
        },
        errors: {
          total: errorsTotal,
          last30Days: errors30,
          last: lastError ? { message: String(lastError.message || ""), pathname: String(lastError.pathname || ""), createdAt: lastError.createdAt || null } : null,
        },
        multistream: {
          sessions: Number(streamSummary?.sessions) || 0,
          seconds: Number(streamSummary?.seconds) || 0,
          firstAt: streamSummary?.firstAt || null,
          lastAt: streamSummary?.lastAt || null,
          platforms: Array.from(new Set(((streamSummary?.platforms || []) as unknown[]).flat().map(String).filter(Boolean))),
          errors: Math.max(Number(streamSummary?.errors) || 0, streamErrorsTotal),
          recentSessions: (streamRecent as any[]).map((s) => ({
            profileName: String(s.profileName || ""),
            channels: Array.isArray(s.channels) ? s.channels : [],
            status: String(s.status || ""),
            startedAt: s.startedAt || null,
            endedAt: s.endedAt || null,
            seconds: Number(s.usedSeconds) || 0,
            errorCount: Number(s.errorCount) || 0,
            lastErrorCode: String(s.lastErrorCode || ""),
          })),
          recentErrors: (streamErrorsRecent as any[]).map((e) => ({
            stage: String(e.stage || ""),
            code: String(e.code || ""),
            message: String(e.message || ""),
            createdAt: e.createdAt || null,
            channels: Array.isArray(e.channels) ? e.channels : [],
          })),
        },
        graphics: (graphicsTop as any[]).map((g) => ({
          graphicId: String(g.graphicId || ""),
          name: String(g.name || g.graphicId || ""),
          addedCount: Number(g.addedCount) || 0,
          shownCount: Number(g.shownCount) || 0,
          lastShownAt: g.lastShownAt || null,
        })),
      },
      activity: activity.map((event) => ({
        event: String(event.event || "activity"),
        properties: event.properties && typeof event.properties === "object"
          ? event.properties
          : {},
        timestamp: event.timestamp || event.createdAt || null,
      })),
      activityPage,
      activityPageCount: Math.max(1, Math.ceil(activityCount / activityPageSize)),
      activityCount,
      devices: devices.map((device) => ({
        deviceId: String(device.deviceId || ""),
        deviceName: String(device.deviceName || ""),
        appVersion: String(device.appVersion || ""),
        appPlatform: String(device.appPlatform || ""),
        lastSeen: device.lastSeen || null,
        createdAt: device.createdAt || null,
        status: String(device.status || "active"),
      })),
      payments: payments.map((payment) => ({
        plan: String(payment.planName || payment.plan || payment.type || "Payment"),
        amount: Number(payment.amount) || 0,
        currency: String(payment.currency || "NGN").toUpperCase(),
        provider: String(payment.paymentProvider || "unknown"),
        reference: String(payment.providerReference || payment.paystackReference || ""),
        status: String(payment.status || "unknown"),
        paidAt: payment.paidAt || payment.createdAt || null,
      })),
      paymentTotals: paymentTotals.map((total) => ({
        currency: String(total._id || "NGN"),
        amount: Number(total.amount) || 0,
        count: Number(total.count) || 0,
      })),
      paymentPage,
      paymentPageCount: Math.max(1, Math.ceil(paymentCount / paymentPageSize)),
      paymentCount,
    });
  } catch (error) {
    console.error("Admin get user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.ok) return authResult.response;

    const { id } = await params;
    const body = await req.json().catch(() => null) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== "suspend" && action !== "unsuspend") {
      return NextResponse.json({ error: "Unsupported account action" }, { status: 400 });
    }

    const { ObjectId } = await import("mongodb");
    let objectId: InstanceType<typeof ObjectId>;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const targetUser = await db.collection("users").findOne({ _id: objectId });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (targetUser.role === "admin" && action === "suspend") {
      return NextResponse.json({ error: "Admin users cannot be blocked" }, { status: 400 });
    }

    const isActive = action === "unsuspend";
    await db.collection("users").updateOne(
      { _id: objectId },
      { $set: { isActive, updatedAt: new Date() } },
    );

    await logAuditEvent({
      adminId: authResult.adminUserId,
      action: "account_suspend",
      targetUserId: id,
      details: { suspended: !isActive, source: "admin_user_profile" },
      timestamp: new Date(),
    });

    return NextResponse.json({ accountStatus: isActive ? "active" : "suspended" });
  } catch (error) {
    console.error("Admin update user account status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
