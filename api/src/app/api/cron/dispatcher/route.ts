/**
 * /api/cron/dispatcher
 *
 * Unified cron job dispatcher for Cloudflare Workers and external runners.
 * Routes scheduled events based on cron expression or runs all tasks on demand.
 *
 * Supported crons:
 *   - "every 15 min" (star/15) : High-frequency trial checks, near-payment alerts, and lifecycle emails
 *   - "0 2 * * *"              : Subscription lifecycle & auto-charges (02:00 UTC)
 *   - "0 3 * * *"              : Trial reconciliation & downgrades (03:00 UTC)
 *   - "30 3 * * *"             : Ambassador expiry (03:30 UTC)
 *   - "45 3 * * *"             : Temporary plan expiry (03:45 UTC)
 *   - "15 4 * * *"             : Refresh saved reactivation eligibility, then run win-back offer ladders (04:15 UTC)
 *   - "0 22 * * *"             : Daily Telegram signup report (22:00 UTC / 23:00 Lagos)
 *
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { runAllUserTrialAndPaymentChecks } from "@/lib/userTrialPaymentCheck";
import { checkAllExpiredAmbassadors } from "@/lib/ambassadorExpiration";
import { checkAllExpiredAdminTemporaryPlans } from "@/lib/adminTemporaryPlan";

const CRON_SECRET = process.env.CRON_SECRET || "";

function verifyAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) {
    console.error("[Cron Dispatcher] FATAL: CRON_SECRET not configured — rejecting request");
    return false;
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${CRON_SECRET}`) return true;

  const urlSecret = req.nextUrl.searchParams.get("secret");
  return urlSecret === CRON_SECRET;
}

export async function GET(req: NextRequest) {
  return handleDispatch(req);
}

export async function POST(req: NextRequest) {
  return handleDispatch(req);
}

async function handleDispatch(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronParam =
    req.nextUrl.searchParams.get("cron") ||
    req.headers.get("x-cloudflare-cron") ||
    "";
  const runAll = req.nextUrl.searchParams.get("all") === "true" || cronParam === "all";

  const results: Record<string, unknown> = {
    dispatcherTimestamp: new Date().toISOString(),
    matchedCron: cronParam || (runAll ? "all" : "default"),
  };

  try {
    // 1. High frequency checks (trials, near payment, low credits):
    // Runs on */15 * * * *, or on full dispatch
    if (runAll || cronParam.includes("*/15") || !cronParam) {
      results.userTrialAndPayments = await runAllUserTrialAndPaymentChecks();
    }

    // 1b. Scheduled Admin > Broadcast Email sends that are now due (*/15 * * * *):
    if (runAll || cronParam.includes("*/15") || !cronParam) {
      try {
        const { GET: runBroadcastDispatch } = await import("@/app/api/cron/broadcast-dispatch/route");
        const broadcastReq = new NextRequest(new URL("/api/cron/broadcast-dispatch", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const broadcastRes = await runBroadcastDispatch(broadcastReq);
        results.broadcastDispatch = await broadcastRes.json().catch(() => ({ status: broadcastRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Broadcast dispatch failed:", err);
        results.broadcastDispatch = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 2. Subscription lifecycle (0 2 * * *):
    if (runAll || cronParam.includes("0 2 *")) {
      try {
        const { GET: runSubscriptionLifecycle } = await import("@/app/api/cron/subscription-lifecycle/route");
        const subReq = new NextRequest(new URL("/api/cron/subscription-lifecycle", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const subRes = await runSubscriptionLifecycle(subReq);
        results.subscriptionLifecycle = await subRes.json().catch(() => ({ status: subRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Subscription lifecycle failed:", err);
        results.subscriptionLifecycle = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 3. Ambassador expiry (30 3 * * *):
    if (runAll || cronParam.includes("30 3 *")) {
      try {
        results.ambassadorExpiry = await checkAllExpiredAmbassadors();
      } catch (err) {
        console.error("[Cron Dispatcher] Ambassador expiry failed:", err);
        results.ambassadorExpiry = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 4. Temporary plan expiry (45 3 * * *):
    if (runAll || cronParam.includes("45 3 *")) {
      try {
        results.temporaryPlanExpiry = await checkAllExpiredAdminTemporaryPlans();
      } catch (err) {
        console.error("[Cron Dispatcher] Temporary plan expiry failed:", err);
        results.temporaryPlanExpiry = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 5. Trial check daily routine (0 3 * * *):
    if (runAll || cronParam.includes("0 3 *")) {
      try {
        const { GET: runTrialCheck } = await import("@/app/api/cron/trial-check/route");
        const trialReq = new NextRequest(new URL("/api/cron/trial-check", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const trialRes = await runTrialCheck(trialReq);
        results.trialCheck = await trialRes.json().catch(() => ({ status: trialRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Trial check daily failed:", err);
        results.trialCheck = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 6. Internal reactivation audience refresh (04:15 UTC). This stores
    // eligibility/suppression only and must never send or export email data.
    if (runAll || cronParam.includes("15 4 *")) {
      try {
        const { GET: refreshAudience } = await import("@/app/api/cron/reactivation-audience/route");
        const audienceReq = new NextRequest(new URL("/api/cron/reactivation-audience", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const audienceRes = await refreshAudience(audienceReq);
        results.reactivationAudience = await audienceRes.json().catch(() => ({ status: audienceRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Reactivation audience refresh failed:", err);
        results.reactivationAudience = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 6b. Win-back offer ladders (04:15 UTC, after trials and temporary plans
    // have expired for the day). Does nothing unless switched on in Admin > Offers.
    if (runAll || cronParam.includes("15 4 *")) {
      try {
        const { GET: runOfferJourneys } = await import("@/app/api/cron/offer-journeys/route");
        const offerReq = new NextRequest(new URL("/api/cron/offer-journeys", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const offerRes = await runOfferJourneys(offerReq);
        results.offerJourneys = await offerRes.json().catch(() => ({ status: offerRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Offer journeys failed:", err);
        results.offerJourneys = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 7. Daily Telegram signup report (0 22 * * *):
    if (runAll || cronParam.includes("0 22 *")) {
      try {
        const { GET: runSignupReport } = await import("@/app/api/cron/signup-report/route");
        const reportReq = new NextRequest(new URL("/api/cron/signup-report", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const reportRes = await runSignupReport(reportReq);
        results.signupReport = await reportRes.json().catch(() => ({ status: reportRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Signup report failed:", err);
        results.signupReport = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 8. Lifecycle emails (15 3 * * *, or explicitly requested):
    if (runAll || cronParam.includes("15 3 *")) {
      try {
        const { GET: runLifecycleEmails } = await import("@/app/api/cron/lifecycle-emails/route");
        const lifeReq = new NextRequest(new URL("/api/cron/lifecycle-emails", req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const lifeRes = await runLifecycleEmails(lifeReq);
        results.lifecycleEmails = await lifeRes.json().catch(() => ({ status: lifeRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Lifecycle emails failed:", err);
        results.lifecycleEmails = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    // 9. Update campaign list cleanup (0 14 * * *, 15:00 Lagos, before the 17:00
    // sends). A manual full run only reports counts; only the real cron removes.
    if (runAll || cronParam.includes("0 14 *")) {
      try {
        const { GET: runUpdateCampaignPrune } = await import("@/app/api/cron/update-campaign-prune/route");
        const apply = cronParam.includes("0 14 *");
        const pruneReq = new NextRequest(new URL(`/api/cron/update-campaign-prune?apply=${apply}`, req.url), {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const pruneRes = await runUpdateCampaignPrune(pruneReq);
        results.updateCampaignPrune = await pruneRes.json().catch(() => ({ status: pruneRes.status }));
      } catch (err) {
        console.error("[Cron Dispatcher] Update campaign prune failed:", err);
        results.updateCampaignPrune = { error: err instanceof Error ? err.message : "Failed" };
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error("[Cron Dispatcher] Fatal error during dispatch:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
