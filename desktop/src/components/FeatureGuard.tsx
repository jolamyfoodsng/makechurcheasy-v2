/**
 * FeatureGuard — Soft-blocks a feature when the user's plan doesn't include it.
 *
 * Shows an inline upgrade CTA when a free-tier user tries to access
 * a premium feature. Consistent with CreditsGuard pattern.
 *
 */

import { Lock, ExternalLink } from "./icons/NativeIcons";
import { useTranslation } from "react-i18next";
import { checkEntitlementSync, type FeatureKey } from "../services/entitlementClient";
import { getEffectivePlan } from "../services/licenseService";
import { useAuth } from "../contexts/AuthContext";
import { UPGRADE_ENTRY_PRICE_NGN, UPGRADE_PROMO_FALLBACK } from "../lib/upgradePromo";
import { getDashboardSubscriptionPlansUrl } from "../services/subscriptionNavigation";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  growth: "Growth",
  trial: "Trial",
  ambassador: "Ambassador",
};

/** Next plan tier above the given one. */
const NEXT_PLAN: Record<string, string> = {
  free: "basic",
  basic: "growth",
  growth: "growth",
};

interface FeatureGuardProps {
  /** Feature key matching licenseService names (e.g., "multiview", "tickers") */
  feature: string;
  children: React.ReactNode;
}

export default function FeatureGuard({ feature, children }: FeatureGuardProps) {
  const { user } = useAuth();
  const { t } = useTranslation();

  // No user yet — let children render (AuthGate handles auth)
  if (!user) return <>{children}</>;

  const effectivePlan = getEffectivePlan(user);
  const info = checkEntitlementSync(feature as FeatureKey, effectivePlan);

  // Feature is not locked — pass through
  if (info.allowed) return <>{children}</>;

  // Determine correct upgrade target — never suggest a plan the user
  // already has or a lower tier.
  const currentPlan = effectivePlan;
  const nextPlanKey =
    info.requiredPlan && info.requiredPlan !== currentPlan
      ? info.requiredPlan
      : NEXT_PLAN[currentPlan] || "growth";
  const upgradeLabel =
    PLAN_LABELS[nextPlanKey] ||
    nextPlanKey.charAt(0).toUpperCase() + nextPlanKey.slice(1);
  const promoText = t("common.upgradePlansStartToday", {
    amount: UPGRADE_ENTRY_PRICE_NGN.toLocaleString("en-US"),
    defaultValue: UPGRADE_PROMO_FALLBACK,
  });

  // Feature is locked — show inline upgrade prompt
  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <Lock size={28} />
        </div>
        <h2 style={styles.title}>{feature}</h2>
        <p style={styles.desc}>
          {info.reason}
        </p>
        <p style={styles.currentPlan}>
          Your plan: <strong>{PLAN_LABELS[currentPlan] || currentPlan}</strong>
        </p>
        <p style={styles.promo}>{promoText}</p>
        <a
          href={getDashboardSubscriptionPlansUrl()}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.cta}
        >
          Upgrade to {upgradeLabel}
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: 400,
    padding: 32,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    maxWidth: 360,
    textAlign: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    background: "rgba(var(--warning-rgb, 245,158,11), 0.12)",
    color: "var(--warning)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: "var(--text)",
    margin: 0,
    fontFamily: "var(--font-heading)",
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-muted)",
    margin: 0,
  },
  currentPlan: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
  },
  promo: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text)",
    fontWeight: 600,
    margin: 0,
  },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: "8px 20px",
    borderRadius: "var(--radius)",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
    transition: "background 0.15s",
  },
};
