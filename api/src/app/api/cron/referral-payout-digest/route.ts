/**
 * GET /api/cron/referral-payout-digest
 *
 * Sends the team a Telegram list of referrers still owed a payout: their church paid for a plan
 * but nobody has marked the reward as sent in Admin → Referrals. Runs once a day at 11:00 p.m.
 * Africa/Lagos time, alongside the signup report. Each local date is sent at most once.
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import {
  loadOwedReferralPayouts,
  notifyTelegramReferralPayoutDigest,
} from "@/lib/referralTelegramNotifications";

const CRON_SECRET = process.env.CRON_SECRET || "";
const DIGEST_COLLECTION = "telegram_referral_payout_digests";
const DEFAULT_TIMEZONE = "Africa/Lagos";

function verifyAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) {
    console.error("[Referral Payout Digest] FATAL: CRON_SECRET not configured");
    return false;
  }
  return req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function digestDateKey(now: Date, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = (await clientPromise).db();
    const timeZone = process.env.TELEGRAM_NOTIFICATION_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
    const dateKey = digestDateKey(new Date(), timeZone);
    const digests = db.collection<{ _id: string; status: string; createdAt: Date }>(DIGEST_COLLECTION);

    try {
      await digests.insertOne({ _id: dateKey, status: "sending", createdAt: new Date() });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        return NextResponse.json({ success: true, sent: false, skipped: true, dateKey });
      }
      throw error;
    }

    let referrers;
    try {
      referrers = await loadOwedReferralPayouts();
    } catch (error) {
      await digests.deleteOne({ _id: dateKey }).catch(() => { });
      throw error;
    }

    const sent = await notifyTelegramReferralPayoutDigest({ dateLabel: dateKey, referrers });
    if (!sent) {
      // Let a later run (or a manual retry) send today's digest.
      await digests.deleteOne({ _id: dateKey }).catch(() => { });
      return NextResponse.json(
        { success: false, sent: false, error: "Telegram notification was not delivered" },
        { status: 503 },
      );
    }

    await digests.updateOne({ _id: dateKey }, { $set: { status: "sent" } });
    return NextResponse.json({
      success: true,
      sent: true,
      dateKey,
      referrersOwed: referrers.length,
      referralsOwed: referrers.reduce((sum, item) => sum + item.owedReferrals, 0),
    });
  } catch (error) {
    console.error("[Referral Payout Digest] Cron failed:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
