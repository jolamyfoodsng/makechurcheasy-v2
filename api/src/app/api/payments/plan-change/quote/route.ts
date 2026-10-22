/**
 * GET /api/payments/plan-change/quote?plan=basic|growth&billingCycle=monthly|yearly
 *
 * What changing to this plan / billing cycle would cost right now, with the credit for the unused time
 * of the current plan taken off. Uses the same price and the same formula as /api/payments/initialize,
 * so the amount shown is the amount charged (a discount code is the only thing applied later).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { resolvePaymentPricing } from "@/lib/paymentPricing";
import { rateLimit } from "@/lib/rateLimit";
import { loadPlanChangeContext, quotePlanChange } from "@/lib/planChangeCredit";

const limiter = rateLimit({ windowMs: 60_000, max: 30 });

export async function GET(req: NextRequest) {
  try {
    const rate = limiter.check(req);
    if (!rate.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const plan = req.nextUrl.searchParams.get("plan");
    const cycle = req.nextUrl.searchParams.get("billingCycle");
    if ((plan !== "basic" && plan !== "growth") || (cycle !== "monthly" && cycle !== "yearly")) {
      return NextResponse.json({ error: "plan must be basic or growth and billingCycle monthly or yearly" }, { status: 400 });
    }

    const userId = authUser.mongoUser._id.toString();
    const pricing = await resolvePaymentPricing(req, authUser.mongoUser.country, "flutterwave");
    if (pricing.requiresCountrySelection) {
      return NextResponse.json({ eligible: false, reason: "country_required" });
    }
    const price = pricing.checkoutPricing.plans[plan]?.[cycle];
    if (!price || price <= 0) return NextResponse.json({ eligible: false, reason: "no_price" });

    const context = await loadPlanChangeContext(userId, authUser.mongoUser);
    const quote = quotePlanChange({
      context,
      newPlan: plan,
      newCycle: cycle,
      newPrice: price,
      currency: pricing.checkoutPricing.currency,
    });
    return NextResponse.json({ ...quote, currencySymbol: pricing.checkoutPricing.currencySymbol });
  } catch (error) {
    console.error("[plan-change/quote] Error:", error);
    return NextResponse.json({ error: "Could not work out the plan change" }, { status: 500 });
  }
}
