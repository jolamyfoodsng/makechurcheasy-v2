/**
 * OfflineSyncPrompt — asks a church to bring this computer online.
 *
 * Churches often keep the streaming laptop offline. The app keeps working, but
 * every 14 days it needs one sync with makechurcheazy.com to confirm the plan:
 *   - 14+ days: this pop-up asks them to connect (can be put off for a day).
 *   - 21+ days: paid features are paused (the app runs as Free) until it syncs.
 *   - A paid plan whose end date passed while offline shows the same pop-up.
 * The pop-up closes by itself once a sync succeeds.
 */
import { useEffect, useState } from "react";
import { WifiOff, CalendarX, LogIn } from "./icons/NativeIcons";
import { useAuth } from "@/contexts/AuthContext";
import ModalDialog from "./ModalDialog";
import { retryVerification, useLicenseGuardState } from "@/services/licenseGuard";
import { isSyncPromptSnoozed, snoozeSyncPrompt } from "@/services/offlineEntitlement";
import { openDashboardSubscriptionPlans } from "@/services/subscriptionNavigation";

const ENDED_DISMISS_KEY = "mce-entitlement-ended-dismissed";

function readDismissedEnd(): number {
  try {
    return Number(localStorage.getItem(ENDED_DISMISS_KEY)) || 0;
  } catch {
    return 0;
  }
}

export default function OfflineSyncPrompt() {
  const { unlocked, verifying, daysOffline, offlineWarning, paidPausedOffline, entitlementEnded, entitledUntilMs, offlineDaysRemaining, signInRequired } =
    useLicenseGuardState();
  const { logout } = useAuth();
  const [snoozed, setSnoozed] = useState(isSyncPromptSnoozed);
  const [dismissedEnd, setDismissedEnd] = useState(readDismissedEnd);
  const [result, setResult] = useState<"" | "failed">("");

  // A new day can end the snooze while the app stays open.
  useEffect(() => {
    const id = window.setInterval(() => setSnoozed(isSyncPromptSnoozed()), 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!offlineWarning) setResult("");
  }, [offlineWarning]);

  if (!unlocked) return null;

  const syncNow = async () => {
    setResult("");
    const ok = await retryVerification();
    if (!ok) setResult("failed");
  };

  const failedHint = result === "failed" && !signInRequired
    ? "Still can't reach makechurcheazy.com. Check the Wi-Fi or network cable, then press Sync now again."
    : undefined;

  // 0) Online, but the server keeps refusing this computer's sign-in.
  if (offlineWarning && signInRequired && !snoozed) {
    return (
      <ModalDialog
        tone="warning"
        icon={<LogIn size={26} />}
        title="Sign in again to sync"
        onClose={() => { snoozeSyncPrompt(24); setSnoozed(true); }}
        actions={[
          { label: "Remind me tomorrow", variant: "ghost", onClick: () => { snoozeSyncPrompt(24); setSnoozed(true); } },
          { label: verifying ? "Syncing…" : "Try again", variant: "ghost", disabled: verifying, onClick: () => void syncNow() },
          { label: "Sign in again", variant: "primary", onClick: () => void logout() },
        ]}
      >
        {`This computer is online, but makechurcheazy.com no longer recognises it, so the app hasn't been able to check your plan for ${daysOffline} days. Sign out and sign back in with your church account to fix it. ${paidPausedOffline ? "Paid features are paused until then; everything on the Free plan still works." : `Paid features pause in ${offlineDaysRemaining} day${offlineDaysRemaining === 1 ? "" : "s"} if it can't sync.`}`}
      </ModalDialog>
    );
  }

  // 1) Offline 14+ days (21+ = paid features paused).
  if (offlineWarning && !snoozed) {
    return (
      <ModalDialog
        tone="warning"
        icon={<WifiOff size={26} />}
        title={paidPausedOffline ? "Paid features are paused" : "Time to sync MakeChurchEazy"}
        hint={failedHint}
        onClose={() => { snoozeSyncPrompt(24); setSnoozed(true); }}
        actions={[
          { label: "Remind me tomorrow", variant: "ghost", onClick: () => { snoozeSyncPrompt(24); setSnoozed(true); } },
          { label: verifying ? "Syncing…" : "Sync now", variant: "primary", disabled: verifying, onClick: () => void syncNow() },
        ]}
      >
        {paidPausedOffline
          ? `This computer hasn't been online for ${daysOffline} days, so your paid features are paused. Everything on the Free plan still works. Connect to the internet and press Sync now to bring your plan back.`
          : `This computer hasn't been online for ${daysOffline} days. MakeChurchEazy needs to sync once every 2 weeks to check your subscription. Connect to the internet and press Sync now. Paid features pause in ${offlineDaysRemaining} day${offlineDaysRemaining === 1 ? "" : "s"} if it can't sync.`}
      </ModalDialog>
    );
  }

  // 2) The paid period ended (noticed offline, against this computer's trusted clock).
  if (entitlementEnded && entitledUntilMs && dismissedEnd !== entitledUntilMs) {
    const endDate = new Date(entitledUntilMs).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    const dismiss = () => {
      try { localStorage.setItem(ENDED_DISMISS_KEY, String(entitledUntilMs)); } catch { /* ignore */ }
      setDismissedEnd(entitledUntilMs);
    };
    return (
      <ModalDialog
        tone="warning"
        icon={<CalendarX size={26} />}
        title="Your plan has ended"
        hint={failedHint}
        onClose={dismiss}
        actions={[
          { label: "Not now", variant: "ghost", onClick: dismiss },
          { label: "Renew", variant: "ghost", onClick: () => void openDashboardSubscriptionPlans({ reason: "plan_ended_offline" }) },
          { label: verifying ? "Syncing…" : "Sync now", variant: "primary", disabled: verifying, onClick: () => void syncNow() },
        ]}
      >
        {`Your paid plan ran until ${endDate}, so the app is on the Free plan now. If you've already renewed, connect to the internet and press Sync now to bring your plan back.`}
      </ModalDialog>
    );
  }

  return null;
}
