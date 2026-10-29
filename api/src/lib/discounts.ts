import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import { COLLECTIONS } from "./db";
import { userMatchesAnnouncement } from "./announcements";
import { markOfferRedeemed } from "./offerMatch";
import type { Announcement, DiscountBillingCycle, PlanTier } from "@/types/schemas";

export class DiscountCodeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DiscountCodeError";
    this.status = status;
  }
}

export interface AppliedDiscount {
  announcementId: string;
  announcementTitle: string;
  code: string;
  percentOff: number;
  durationMonths: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  monthsRemainingAfterCheckout: number;
}

export function normalizeDiscountCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function announcementAllowsPlan(announcement: Announcement, plan: PlanTier): boolean {
  const plans = asStringArray(announcement.offerApplicablePlans);
  return plans.length === 0 || plans.includes(plan);
}

function announcementAllowsCycle(announcement: Announcement, billingCycle: DiscountBillingCycle): boolean {
  const cycles = asStringArray(announcement.offerApplicableBillingCycles);
  return cycles.length === 0 || cycles.includes(billingCycle);
}

function remainingMonthsAfterCheckout(durationMonths: number, billingCycle: DiscountBillingCycle): number {
  if (billingCycle !== "monthly") return 0;
  return Math.max(0, durationMonths - 1);
}

/** The live discount (an active announcement carrying an offer code) behind `code`, or null. */
export async function findActiveDiscount(code: string): Promise<Announcement | null> {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) return null;
  const now = new Date().toISOString();
  const client = await clientPromise;
  return client
    .db()
    .collection<Announcement>(COLLECTIONS.ANNOUNCEMENTS)
    .findOne(
      {
        offerCode: normalizedCode,
        offerDiscountPercent: { $gt: 0 },
        status: "active",
        publishAt: { $lte: now },
        $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
      },
      { collation: { locale: "en", strength: 2 }, sort: { priority: -1, createdAt: -1 } },
    );
}

/** The dashboard link that opens the plans page with the code already applied. */
export function discountClaimUrl(announcement: Announcement): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com";
  const params = new URLSearchParams({
    promo: announcement.offerCode || "",
    plan: asStringArray(announcement.offerApplicablePlans)[0] || "growth",
    billing: asStringArray(announcement.offerApplicableBillingCycles)[0] || "monthly",
  });
  return `${appUrl}/subscription/plans?${params.toString()}`;
}

export async function resolveDiscountCode({
  code,
  user,
  plan,
  billingCycle,
  originalAmount,
}: {
  code: string;
  user: Record<string, any>;
  plan: PlanTier;
  billingCycle: DiscountBillingCycle;
  originalAmount: number;
}): Promise<AppliedDiscount> {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) {
    throw new DiscountCodeError("Enter a discount code.");
  }
  if (billingCycle === "lifetime") {
    throw new DiscountCodeError("Discount codes are not available for lifetime offers.");
  }
  if (!originalAmount || originalAmount <= 0) {
    throw new DiscountCodeError("This plan does not have a valid price.");
  }

  const announcement = await findActiveDiscount(normalizedCode);

  if (!announcement) {
    throw new DiscountCodeError("This discount code is not active.");
  }
  if (!announcementAllowsPlan(announcement, plan)) {
    throw new DiscountCodeError(`This discount code does not apply to ${plan}.`);
  }
  if (!announcementAllowsCycle(announcement, billingCycle)) {
    throw new DiscountCodeError(`This discount code does not apply to ${billingCycle} billing.`);
  }
  if (!(await userMatchesAnnouncement(announcement, user))) {
    throw new DiscountCodeError("This discount code is not available for this account.", 403);
  }

  const maxRedemptions = Number(announcement.offerMaxRedemptions || 0);
  const redemptionCount = Number(announcement.offerRedemptionCount || 0);
  if (maxRedemptions > 0 && redemptionCount >= maxRedemptions) {
    throw new DiscountCodeError("This discount code has reached its redemption limit.");
  }

  const percentOff = Math.min(95, Math.max(1, Math.round(Number(announcement.offerDiscountPercent || 0))));
  const durationMonths = Math.min(60, Math.max(1, Math.round(Number(announcement.offerDurationMonths || 1))));
  const discountAmount = roundMoney((originalAmount * percentOff) / 100);
  const finalAmount = Math.max(1, roundMoney(originalAmount - discountAmount));

  return {
    announcementId: announcement._id?.toString() || "",
    announcementTitle: announcement.title,
    code: normalizedCode,
    percentOff,
    durationMonths,
    originalAmount: roundMoney(originalAmount),
    discountAmount,
    finalAmount,
    monthsRemainingAfterCheckout: remainingMonthsAfterCheckout(durationMonths, billingCycle),
  };
}

export async function recordDiscountRedemption({
  discount,
  userId,
  paystackReference,
  plan,
  billingCycle,
}: {
  discount: AppliedDiscount | null;
  userId: string;
  paystackReference: string;
  plan: PlanTier;
  billingCycle: DiscountBillingCycle;
}): Promise<void> {
  if (!discount?.code || !paystackReference) return;

  const client = await clientPromise;
  const db = client.db();
  const now = new Date().toISOString();

  // If the code belonged to a win-back offer, mark that offer redeemed. Safe to
  // repeat, so a payment that is reported twice (webhook and verify) is fine.
  await markOfferRedeemed(userId, discount.code, paystackReference).catch((error) =>
    console.error("[discounts] Could not mark win-back offer redeemed:", error),
  );

  try {
    await db.collection(COLLECTIONS.DISCOUNT_REDEMPTIONS).insertOne({
      code: discount.code,
      announcementId: discount.announcementId,
      userId,
      paystackReference,
      plan,
      billingCycle,
      percentOff: discount.percentOff,
      durationMonths: discount.durationMonths,
      discountAmount: discount.discountAmount,
      finalAmount: discount.finalAmount,
      createdAt: now,
    });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }

  if (ObjectId.isValid(discount.announcementId)) {
    await db.collection(COLLECTIONS.ANNOUNCEMENTS).updateOne(
      { _id: new ObjectId(discount.announcementId) },
      { $inc: { offerRedemptionCount: 1 }, $set: { updatedAt: now } },
    );
  }
}

export function discountFromPaymentMetadata(metadata: Record<string, any>): AppliedDiscount | null {
  const code = normalizeDiscountCode(metadata.discountCode);
  if (!code) return null;

  const originalAmount = Number(metadata.discountOriginalPrice ?? metadata.originalPrice ?? 0);
  const discountAmount = Number(metadata.discountAmount ?? 0);
  const finalAmount = Number(metadata.discountedPrice ?? metadata.price ?? 0);
  const percentOff = Number(metadata.discountPercent ?? 0);
  const durationMonths = Number(metadata.discountDurationMonths ?? 1);

  return {
    announcementId: String(metadata.discountAnnouncementId || ""),
    announcementTitle: String(metadata.discountAnnouncementTitle || ""),
    code,
    percentOff: Number.isFinite(percentOff) ? percentOff : 0,
    durationMonths: Number.isFinite(durationMonths) ? durationMonths : 1,
    originalAmount: Number.isFinite(originalAmount) ? originalAmount : 0,
    discountAmount: Number.isFinite(discountAmount) ? discountAmount : 0,
    finalAmount: Number.isFinite(finalAmount) ? finalAmount : 0,
    monthsRemainingAfterCheckout: Number(metadata.discountMonthsRemaining ?? 0) || 0,
  };
}
