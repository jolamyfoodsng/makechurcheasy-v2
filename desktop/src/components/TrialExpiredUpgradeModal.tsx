import { useMemo, useState, useEffect } from "react";
import { Lock } from "./icons/NativeIcons";
import ModalDialog, { ModalPanel } from "./ModalDialog";
import { useAuth } from "../contexts/AuthContext";
import { getEffectivePlan, isTrialExpired } from "../services/licenseService";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
const DISMISS_SESSION_KEY = "trial_expired_dismissed";

async function openCheckout() {
  await openDashboardSubscriptionPlans({ checkout: "growth", billingCycle: "monthly", reason: "trial_expired" });
}

export default function TrialExpiredUpgradeModal() {
  const { user, authenticated, loading, isAdmin } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const dismissKey = user?.id ? `${DISMISS_SESSION_KEY}:${user.id}` : DISMISS_SESSION_KEY;

  useEffect(() => {
    const stored = sessionStorage.getItem(dismissKey);
    setDismissed(stored === "true");
  }, [dismissKey]);

  useEffect(() => {
    if (dismissed) {
      sessionStorage.setItem(dismissKey, "true");
    }
  }, [dismissKey, dismissed]);

  const shouldShow = useMemo(() => {
    if (dismissed || loading || !authenticated || !user || isAdmin) return false;
    return getEffectivePlan(user) === "free" && isTrialExpired(user);
  }, [authenticated, dismissed, isAdmin, loading, user]);

  if (!shouldShow) return null;

  const handleDismiss = () => setDismissed(true);

  return (
    <ModalDialog
      role="status"
      tone="warning"
      icon={<Lock size={26} />}
      eyebrow="Free trial ended"
      title="Your trial has ended. You are now on the Free plan."
      onClose={handleDismiss}
      closeLabel="Close trial ended notice"
      extra={
        <ModalPanel heading="Growth plan">
          <p>
            The dashboard opens the secure Paystack checkout. Desktop access updates after payment is confirmed.
          </p>
        </ModalPanel>
      }
      actions={[
        { label: "Continue with Free plan", variant: "ghost", onClick: handleDismiss },
        { label: "View upgrade plans", variant: "primary", onClick: () => void openCheckout() },
      ]}
    >
      Your account remains available with Free plan limits. Upgrade when you need more presentation, broadcast,
      library, or team capacity.
    </ModalDialog>
  );
}
