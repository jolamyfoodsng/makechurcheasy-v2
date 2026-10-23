/**
 * AppStatusStrip.tsx — slim bar at the top of the app.
 *
 *   left:  "Free plan · Upgrade"          (only while the user is on the Free plan)
 *   right: "Having any issues? Contact support · WhatsApp"   (always, quiet)
 *          "6 days left · Update now"     (only while a forced update is counting down)
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Icon from "./Icon";
import { HelpCircle, MessageCircle } from "./icons/NativeIcons";
import { useAdminControls } from "../hooks/useAdminControls";
import { openSupportDialog } from "../services/supportDialog";
import { supportChannelHref } from "./SupportDialog";
import { getCurrentUser } from "../services/authService";
import { getEffectivePlan } from "../services/licenseService";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import {
  formatTimeLeft,
  getLiveCountdown,
  getPublishedForcedUpdateState,
  installLatestUpdate,
  openUpdateDownload,
  requestForcedUpdateModal,
  subscribeForcedUpdateState,
} from "../services/forcedUpdateService";
import "./app-status-strip.css";

type InstallPhase = "idle" | "downloading" | "installing" | "relaunching";

function readIsFreePlan(): boolean {
  try {
    const user = getCurrentUser();
    if (!user) return false;
    return getEffectivePlan(user) === "free";
  } catch {
    return false;
  }
}

export default function AppStatusStrip() {
  const forced = useSyncExternalStore(
    subscribeForcedUpdateState,
    getPublishedForcedUpdateState,
    () => null,
  );
  const [isFree, setIsFree] = useState(readIsFreePlan);
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [percent, setPercent] = useState(0);

  const [updateError, setUpdateError] = useState<string | null>(null);
  const whatsapp = useAdminControls().support.channels.find((c) => c.kind === "whatsapp" && c.enabled && c.value);

  // Download and install the update inside the app, straight from the releases.
  const startUpdate = useCallback(async (downloadUrl: string) => {
    const isNativeTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isNativeTauri) {
      // A browser can't install anything; this is the only case that uses a link.
      void openUpdateDownload(downloadUrl);
      return;
    }
    try {
      setUpdateError(null);
      setPercent(0);
      setPhase("downloading");
      await installLatestUpdate(
        (p) => setPercent(p.contentLength > 0 ? Math.round((p.downloaded / p.contentLength) * 100) : 0),
        (status) => setPhase(status as InstallPhase),
      );
    } catch (err) {
      console.error("[AppStatusStrip] In-app update failed:", err);
      setPhase("idle");
      setUpdateError(err instanceof Error ? err.message : "The update could not be installed.");
    }
  }, []);

  // Plan can change after a license refresh; the countdown needs a minute tick.
  useEffect(() => {
    const refresh = () => setIsFree(readIsFreePlan());
    const planId = window.setInterval(refresh, 10_000);
    const tickId = window.setInterval(() => setTick((n) => n + 1), 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(planId);
      window.clearInterval(tickId);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const live = forced ? getLiveCountdown(forced) : null;
  const showUpdate = Boolean(
    forced &&
      forced.active &&
      live &&
      live.hoursRemaining !== null &&
      !live.expired,
  );
  const isEmergency = forced?.lockType === "emergency-lock";

  const urgent = Boolean(live?.finalDay);

  return (
    <div className={`app-status-strip${isFree ? " app-status-strip--free" : ""}`} role="status">
      <div className="app-status-strip__side">
        {isFree && (
          <div className="app-status-strip__chip app-status-strip__chip--plan">
            <Icon name="star" size={13} />
            <span className="app-status-strip__label">You&apos;re on the Free plan</span>
            <span className="app-status-strip__limits">
              1 stream channel · 2 custom themes · 3 graphics · Verse AI 15 min a day
            </span>
            <button
              type="button"
              className="app-status-strip__action app-status-strip__action--plan"
              onClick={() => void openDashboardSubscriptionPlans({ source: "free-plan-strip" })}
              title="See paid plans"
            >
              Upgrade
            </button>
          </div>
        )}
      </div>

      <div className="app-status-strip__side app-status-strip__side--end">
        <div className="app-status-strip__support">
          <span className="app-status-strip__support-text">Having any issues?</span>
          <button
            type="button"
            className="app-status-strip__support-link"
            onClick={openSupportDialog}
            title="Open Support"
          >
            <HelpCircle size={13} aria-hidden="true" />
            Contact support
          </button>
          {whatsapp && (
            <a
              className="app-status-strip__support-link"
              href={supportChannelHref(whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              title={whatsapp.label}
            >
              <MessageCircle size={13} aria-hidden="true" />
              WhatsApp
            </a>
          )}
        </div>
        {showUpdate && live && live.hoursRemaining !== null && (
          <div
            className={`app-status-strip__chip ${
              urgent ? "app-status-strip__chip--urgent" : "app-status-strip__chip--update"
            }`}
          >
            <Icon name={isEmergency ? "warning" : "system_update"} size={13} />
            <button
              type="button"
              className="app-status-strip__label app-status-strip__label--button"
              onClick={() => requestForcedUpdateModal()}
              title={updateError ?? "Show update details"}
            >
              {updateError
                ? "Update failed"
                : isEmergency
                  ? `Maintenance in ${formatTimeLeft(live.hoursRemaining).replace(" left", "")}`
                  : formatTimeLeft(live.hoursRemaining)}
            </button>
            {!isEmergency && forced && (
              <button
                type="button"
                className="app-status-strip__action app-status-strip__action--update"
                disabled={phase !== "idle"}
                onClick={() => void startUpdate(forced.downloadUrl)}
                title={`Update to v${forced.requiredVersion || "the latest version"}`}
              >
                {phase === "idle" && (updateError ? "Try again" : "Update now")}
                {phase === "downloading" && (percent > 0 ? `Downloading ${percent}%` : "Downloading…")}
                {phase === "installing" && "Installing…"}
                {phase === "relaunching" && "Restarting…"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
