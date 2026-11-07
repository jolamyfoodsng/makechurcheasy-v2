/**
 * LicenseGuard.tsx — License Enforcement UI
 *
 * Wraps the application and renders a full-screen lock screen whenever
 * the license guard determines the app should be locked.
 *
 * No page should implement its own subscription/trial logic.
 * Every protected feature simply checks licenseGuard.isUnlocked().
 *
 * This component:
 *   1. Initializes the license guard on mount
 *   2. Subscribes to state changes
 *   3. Renders a blocking lock screen when validation fails
 *   4. Provides retry, manage subscription, and quit actions
 *   5. Traps focus and blocks Escape key to prevent bypass
 */

import { type ReactNode, useEffect, useRef, useCallback, useState } from "react";
import {
  useLicenseGuardState,
  getLockScreenConfig,
  retryVerification,
  disconnectOtherDevicesAndUnlock,
  hasPendingDowngradeNotification,
  markDowngradeNotified,
  type LockReason,
} from "@/services/licenseGuard";
import { getDashboardBaseForAuth } from "@/services/authService";
import ForcedUpdateOverlay from "./ForcedUpdateOverlay";
import {
  getForcedUpdateState,
  refreshAppSettings,
  type ForcedUpdateState,
} from "../services/forcedUpdateService";
import { useAuth } from "@/contexts/AuthContext";
import Icon from "./Icon";
import { AlertCircle, Crown, ExternalLink, Headphones, LogIn, LogOut, Monitor, RefreshCw, User } from "./icons/NativeIcons";
import ModalDialog, { ModalNotice, type ModalAction } from "./ModalDialog";
import OfflineSyncPrompt from "./OfflineSyncPrompt";

const API_BASE = import.meta.env.VITE_AUTH_API_URL || "https://api.makechurcheazy.com";

interface LicenseGuardProps {
  children: ReactNode;
}

const CURRENT_APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/**
 * Version-gate responses happen before the license payload is returned, so
 * the license guard cannot use the normal license retry screen to update.
 * Reuse the real updater overlay instead and load the admin download settings
 * so Update Now can install the configured release.
 */
function ForcedUpgradeScreen() {
  const [state, setState] = useState<ForcedUpdateState>(() => ({
    blocked: true,
    active: true,
    lockType: "forced-update",
    requiredVersion: "",
    hoursRemaining: null,
    gracePeriodHours: null,
    startedAt: null,
    lockAt: null,
    updateMessage: "A mandatory update is required to continue using MakeChurchEazy.",
    currentVersion: CURRENT_APP_VERSION,
    downloadUrl: "",
    releaseNotesUrl: "",
    loading: true,
  }));

  useEffect(() => {
    let mounted = true;
    void refreshAppSettings().then((settings) => {
      if (!mounted) return;
      const next = getForcedUpdateState(settings, CURRENT_APP_VERSION);
      setState({
        ...next,
        blocked: true,
        active: true,
        lockType: "forced-update",
        hoursRemaining: null,
        gracePeriodHours: null,
        loading: false,
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  return <ForcedUpdateOverlay state={state} />;
}

export default function LicenseGuard({ children }: LicenseGuardProps) {
  const { unlocked, lockReason, payload, verifying, daysOffline, offlineWarning, paidPausedOffline, offlineDaysRemaining } = useLicenseGuardState();
  const [showDowngradeBanner, setShowDowngradeBanner] = useState(false);
  const [showDeviceLimitPreview, setShowDeviceLimitPreview] = useState(false);

  useEffect(() => {
    (window as any).__triggerDeviceLimitModal = () => setShowDeviceLimitPreview(true);
    return () => {
      delete (window as any).__triggerDeviceLimitModal;
    };
  }, []);

  // Automatically retry verification when internet reconnects
  useEffect(() => {
    const handleOnline = () => {
      void retryVerification();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const handleRetry = async () => {
    await retryVerification();
  };

  const handleManageSubscription = async () => {
    const url = `${getDashboardBaseForAuth()}/subscription/plans`;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  useEffect(() => {
    if (unlocked && hasPendingDowngradeNotification()) {
      setShowDowngradeBanner(true);
    } else {
      setShowDowngradeBanner(false);
    }
  }, [unlocked, payload]);

  const dismissDowngradeBanner = () => {
    markDowngradeNotified();
    setShowDowngradeBanner(false);
  };

  return (
    <>
      {children}
      <OfflineSyncPrompt />
      {offlineWarning && unlocked && (
        <div className="license-offline-warning-banner" role="alert">
          <div className="license-offline-warning-banner__icon" aria-hidden="true">
            <Icon name="wifi_off" size={18} />
          </div>
          <div className="license-offline-warning-banner__content">
            <p className="license-offline-warning-banner__title">
              {paidPausedOffline ? "Paid features paused: sync needed" : "Connect to the internet to sync"}
            </p>
            <p className="license-offline-warning-banner__description">
              {paidPausedOffline
                ? `Not online for ${daysOffline} days. The app runs as Free until it syncs with makechurcheazy.com.`
                : `Not online for ${daysOffline} days. Sync once every 2 weeks; paid features pause in ${offlineDaysRemaining} day${offlineDaysRemaining === 1 ? "" : "s"}.`}
            </p>
          </div>
          <div className="license-offline-warning-banner__actions">
            <button
              type="button"
              onClick={handleRetry}
              disabled={verifying}
              className="license-offline-warning-banner__action"
            >
              {verifying ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>
      )}
      {showDowngradeBanner && (
        <div className="license-downgrade-banner" role="alert">
          <div className="license-downgrade-banner__icon" aria-hidden="true">
            <Icon name="info" size={18} />
          </div>
          <div className="license-downgrade-banner__content">
            <p className="license-downgrade-banner__title">Your account is now on the Free plan</p>
            <p className="license-downgrade-banner__description">
              Your paid subscription has ended. Premium features and higher limits are now
              unavailable until you upgrade again.
            </p>
          </div>
          <div className="license-downgrade-banner__actions">
            <button
              type="button"
              onClick={handleManageSubscription}
              className="license-downgrade-banner__action"
            >
              Restore Premium Access
            </button>
            <button
              type="button"
              onClick={dismissDowngradeBanner}
              aria-label="Dismiss downgrade notice"
              className="license-downgrade-banner__dismiss"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}
      {showDeviceLimitPreview ? (
        <LicenseLockScreen
          reason="too_many_devices"
          payload={
            payload && payload.otherDevices?.length
              ? payload
              : {
                  plan: "free",
                  maxDevices: 1,
                  deviceCount: 2,
                  otherDevices: [
                    {
                      deviceId: "vc_media_pc",
                      deviceName: "Media PC",
                      lastSeen: new Date().toISOString(),
                    },
                  ],
                }
          }
          verifying={verifying}
          onDismiss={() => setShowDeviceLimitPreview(false)}
        />
      ) : !unlocked && lockReason === "forced_upgrade" ? (
        <ForcedUpgradeScreen />
      ) : !unlocked ? (
        <LicenseLockScreen
          reason={lockReason}
          payload={payload}
          verifying={verifying}
        />
      ) : null}
    </>
  );
}

// ── Lock Screen ──────────────────────────────────────────────────────────────

function LicenseLockScreen({
  reason,
  payload,
  verifying,
  onDismiss,
}: {
  reason: LockReason;
  payload: any;
  verifying: boolean;
  onDismiss?: () => void;
}) {
  const config = getLockScreenConfig(reason, payload);
  // Marker rendered inside the dialog card, used to find it for the focus trap.
  const markerRef = useRef<HTMLSpanElement>(null);
  const { logout } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // A maintenance lock is temporary and controlled by the admin. Recheck on our
  // own so the screen clears soon after the lock is switched off, instead of
  // waiting for the 6-hour background check or a manual Retry.
  useEffect(() => {
    if (reason !== "maintenance") return;
    const id = window.setInterval(() => {
      void retryVerification();
    }, 40_000);
    return () => window.clearInterval(id);
  }, [reason]);

  const handleRetry = async () => {
    setActionError(null);
    await retryVerification();
  };

  const handleDisconnectOthers = async () => {
    setDisconnecting(true);
    setActionError(null);
    try {
      const res = await disconnectOtherDevicesAndUnlock();
      if (!res.success) {
        if (onDismiss) {
          setTimeout(() => {
            setDisconnecting(false);
            onDismiss();
          }, 600);
          return;
        }
        setActionError(res.error || "Failed to log out other computer. Please try again.");
      } else if (onDismiss) {
        onDismiss();
      }
    } catch (err: any) {
      if (onDismiss) {
        setTimeout(() => {
          setDisconnecting(false);
          onDismiss();
        }, 600);
        return;
      }
      setActionError(err?.message || "Failed to log out other computer.");
    } finally {
      if (!onDismiss) {
        setDisconnecting(false);
      }
    }
  };

  const handleManageSubscription = async () => {
    const url = `${getDashboardBaseForAuth()}/subscription/plans`;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleContactSupport = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(`${API_BASE}/support`);
    } catch {
      window.open(`${API_BASE}/support`, "_blank");
    }
  };

  const handleManageDevices = async () => {
    const url = `${getDashboardBaseForAuth()}/devices`;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleQuit = async () => {
    if (onDismiss) {
      onDismiss();
      return;
    }
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch {
      // Not in Tauri — close the window
      window.close();
    }
  };

  // Focus trap + keyboard handler
  const getFocusableElements = useCallback(() => {
    const card = markerRef.current?.closest(".mce-modal");
    if (!card) return [];
    return Array.from(
      card.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }, []);

  // Auto-focus the first button when lock screen appears
  useEffect(() => {
    const timer = setTimeout(() => {
      const els = getFocusableElements();
      if (els.length > 0) els[0].focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [getFocusableElements, reason]);

  // Focus trap + Escape block
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Block Escape — user must use Quit button
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Trap Tab inside the modal
      if (e.key === "Tab") {
        const els = getFocusableElements();
        if (els.length === 0) {
          e.preventDefault();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];

        if (e.shiftKey) {
          // Shift+Tab: wrap from first to last
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: wrap from last to first
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [getFocusableElements]);

  type LockAction = ModalAction;
  const quitAction: LockAction = { label: "Quit Application", variant: "ghost", onClick: () => void handleQuit() };
  const upgradeAction: LockAction = {
    label: "Upgrade Plan (Use Multiple Computers)",
    variant: "ghost",
    icon: <Crown size={14} />,
    onClick: () => void handleManageSubscription(),
  };

  let actions: LockAction[];
  if (config.primaryAction === "disconnect_others") {
    actions = [
      quitAction,
      { label: "Sign Out This Computer", variant: "ghost", icon: <User size={14} />, onClick: () => void logout() },
      upgradeAction,
      {
        label: disconnecting ? "Logging out other computer…" : config.primaryLabel,
        variant: "primary",
        icon: disconnecting ? <RefreshCw size={14} /> : <LogOut size={14} />,
        disabled: disconnecting || verifying,
        onClick: () => void handleDisconnectOthers(),
      },
    ];
  } else if (config.primaryAction === "reconnect") {
    actions = [
      quitAction,
      upgradeAction,
      { label: "Sign In & Use Here", variant: "primary", icon: <LogIn size={14} />, onClick: () => void logout() },
    ];
  } else {
    actions = [quitAction];
    if (reason !== "maintenance") {
      actions.push({ label: "Sign Out & Reconnect", variant: "ghost", icon: <LogOut size={14} />, onClick: () => void logout() });
    }
    if (config.primaryAction !== "retry") {
      actions.push({
        label: "Retry Verification",
        variant: "ghost",
        icon: <RefreshCw size={14} />,
        disabled: verifying,
        onClick: () => void handleRetry(),
      });
    }
    if (config.primaryAction === "retry") {
      actions.push({
        label: config.primaryLabel,
        variant: "primary",
        icon: <RefreshCw size={14} />,
        disabled: verifying,
        onClick: () => void handleRetry(),
      });
    } else if (config.primaryAction === "subscribe") {
      actions.push({ label: config.primaryLabel, variant: "primary", icon: <ExternalLink size={14} />, onClick: () => void handleManageSubscription() });
    } else if (config.primaryAction === "manage_devices") {
      actions.push({ label: config.primaryLabel, variant: "primary", icon: <Monitor size={14} />, onClick: () => void handleManageDevices() });
    } else if (config.primaryAction === "contact_support") {
      actions.push({ label: config.primaryLabel, variant: "primary", icon: <Headphones size={14} />, onClick: () => void handleContactSupport() });
    }
  }

  const tone =
    reason === "internet_required" || reason === "maintenance"
      ? "warning"
      : reason === "too_many_devices" || reason === "device_disconnected_by_other"
      ? "info"
      : "danger";

  const eyebrow =
    reason === "too_many_devices"
      ? payload?.plan === "free" || payload?.maxDevices === 1
        ? "Free Plan • 1 Computer Limit"
        : "Device Limit Reached"
      : reason === "device_disconnected_by_other"
      ? "Session Transferred to Another Device"
      : reason === "internet_required"
      ? "Offline limit reached (3 weeks offline)"
      : reason === "maintenance"
      ? "Checking again automatically"
      : "Access to MakeChurchEazy is currently blocked";

  return (
    <ModalDialog
      tone={tone}
      icon={<Icon name={config.icon} size={26} />}
      eyebrow={eyebrow}
      title={config.title}
      // Blocking: only the preview (onDismiss) can be closed, and only with its X.
      onClose={onDismiss}
      closeOnBackdrop={false}
      closeOnEscape={false}
      closeLabel="Close Preview"
      zIndex={999999}
      width={520}
      extra={
        <>
          <span ref={markerRef} hidden />
          {actionError && (
            <ModalNotice tone="danger" icon={<AlertCircle size={15} />}>
              {actionError}
            </ModalNotice>
          )}
          {verifying && (
            <div aria-live="polite">
              <ModalNotice tone="info" icon={<RefreshCw size={15} />}>
                {reason === "internet_required" ? "Checking internet connection…" : "Verifying your license…"}
              </ModalNotice>
            </div>
          )}
        </>
      }
      actions={actions}
    >
      {config.description}
    </ModalDialog>
  );
}
