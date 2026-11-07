/**
 * emailPreferences.ts — Email preference checking utility.
 *
 * Users can opt out of marketing, billing, and product update emails.
 * Security emails cannot be disabled.
 */

import clientPromise from "./mongodb";
import type { ObjectId } from "mongodb";

export type EmailCategory = "security" | "billing" | "marketing" | "product_updates";

export interface EmailPreferences {
  marketing: boolean;
  billing: boolean;
  security: boolean;      // always true, cannot be disabled
  productUpdates: boolean;
}

const DEFAULT_PREFERENCES: EmailPreferences = {
  marketing: true,
  billing: true,
  security: true,
  productUpdates: true,
};

/** Category mapping for each email template type */
const TEMPLATE_CATEGORIES: Record<string, EmailCategory> = {
  // Security — cannot be disabled
  login_code: "security",
  verification: "security",
  password_reset: "security",
  email_change_verification: "security",
  email_change_notification: "security",
  new_device_login: "security",

  // Billing
  subscription_activated: "billing",
  subscription_renewed: "billing",
  subscription_cancelled: "billing",
  payment_failed: "billing",
  payment_receipt: "billing",
  subscription_expiring: "billing",

  // Marketing
  welcome: "marketing",
  plan_upgrade: "marketing",
  admin_broadcast: "marketing",

  // Product updates
  trial_started: "product_updates",
  trial_day1_activation: "product_updates",
  trial_day3_feature_discovery: "product_updates",
  trial_day5_feature_driving: "product_updates",
  trial_ending_soon: "product_updates",
  trial_1_day_remaining: "product_updates",
  trial_expired: "product_updates",
};

/**
 * Check if a user has opted in to receive a specific email type.
 * Security emails always return true.
 *
 * @param user - The MongoDB user document (must have emailPreferences field)
 * @param templateType - The template type key (e.g. "subscription_activated")
 * @returns true if the email should be sent
 */
export async function shouldSendEmail(
  user: { _id?: ObjectId | string; emailPreferences?: Partial<EmailPreferences> },
  templateType: string
): Promise<boolean> {
  const category = TEMPLATE_CATEGORIES[templateType];
  if (!category) return true; // Unknown template — allow by default
  if (category === "security") return true; // Security emails always send

  const prefs: EmailPreferences = {
    ...DEFAULT_PREFERENCES,
    ...user.emailPreferences,
    security: true, // Always true
  };

  switch (category) {
    case "billing":
      return prefs.billing;
    case "marketing":
      return prefs.marketing;
    case "product_updates":
      return prefs.productUpdates;
    default:
      return true;
  }
}

/**
 * Get default email preferences for a new user.
 */
export function getDefaultEmailPreferences(): EmailPreferences {
  return { ...DEFAULT_PREFERENCES };
}
