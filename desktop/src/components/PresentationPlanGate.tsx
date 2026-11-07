import { Lock } from "./icons/NativeIcons";
import type { CSSProperties, ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import { UPGRADE_PROMO_FALLBACK } from "../lib/upgradePromo";
import { checkEntitlementSync } from "../services/entitlementClient";
import { getEffectivePlan } from "../services/licenseService";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";

interface PresentationPlanGateProps {
  children: ReactNode;
}

export default function PresentationPlanGate({ children }: PresentationPlanGateProps) {
  const { user } = useAuth();

  if (!user) return <>{children}</>;

  const currentPlan = getEffectivePlan(user);
  const access = checkEntitlementSync("presentationMode", currentPlan);

  if (access.allowed) return <>{children}</>;

  const message =
    "Presentation Mode is available on Growth. Free trial users can use it during the trial. Upgrade to Growth to open the presentation hub and use the local screen link.";
  const promoText = UPGRADE_PROMO_FALLBACK;

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <Lock size={28} />
        </div>
        <h2 style={styles.title}>Presentation Mode requires Growth</h2>
        <p style={styles.desc}>{message}</p>
        <p style={styles.promo}>{promoText}</p>
        <button
          type="button"
          style={styles.button}
          onClick={() => void openDashboardSubscriptionPlans()}
        >
          Upgrade to Growth
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100%",
    padding: 32,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    maxWidth: 420,
    textAlign: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    background: "rgba(59, 130, 246, 0.12)",
    color: "var(--primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text)",
    margin: 0,
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.6,
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
  button: {
    marginTop: 8,
    border: 0,
    borderRadius: "var(--radius)",
    background: "var(--primary)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    padding: "10px 18px",
  },
};
