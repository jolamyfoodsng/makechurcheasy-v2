/**
 * ForcedUpdateOverlay.tsx — Full-screen overlay for forced updates
 *
 * Two modes:
 *   1. Countdown mode: closeable, shows time remaining, "Update Now" button
 *   2. Locked mode: no dismiss, only "Update Now", blocks all app usage
 *
 * The countdown continues offline because it's computed from the local
 * forcedUpdateStartedAt timestamp stored in localStorage.
 */

import { useState, useCallback, useEffect } from "react";
import type { DownloadProgress } from "../services/updateService";
import { exit } from "@tauri-apps/plugin-process";
import {
  getTrustedNowMs,
  installLatestUpdate,
  openUpdateDownload,
  type ForcedUpdateState,
  type LockType,
} from "../services/forcedUpdateService";
import ModalDialog, { ModalFacts, ModalNotice, ModalProgress, type ModalAction } from "./ModalDialog";
import { AlertCircle, AlertTriangle, Download, Lock, RefreshCw } from "./icons/NativeIcons";

interface ForcedUpdateOverlayProps {
  state: ForcedUpdateState;
  onDismiss?: () => void;
  onRefresh?: () => void | Promise<void>;
  isDock?: boolean;
  /** Last 24 hours of the countdown (still closable until the last 30 minutes). */
  finalDay?: boolean;
}

type UpdateStatus = "prompt" | "downloading" | "installing" | "relaunching" | "error";

// ── Formatting helpers ─────────────────────────────────────────────────────

function formatCountdownPrecise(hours: number): string {
  if (hours <= 0) return "Update required now";
  if (hours >= 24) {
    // floor, not round: rounding turned 11 days 23.6h into "11 days 24h".
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return `${d} day${d === 1 ? "" : "s"}${h > 0 ? ` ${h}h` : ""} remaining`;
  }
  if (hours >= 1) {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${h}h${m > 0 ? ` ${m}m` : ""} remaining`;
  }
  const m = Math.max(1, Math.ceil(hours * 60));
  return `${m}m remaining`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function lockTypeLabel(lockType: LockType | null): string {
  if (lockType === "emergency-lock") return "Emergency Maintenance";
  return "Update Required";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ForcedUpdateOverlay({ state, onDismiss, onRefresh, isDock, finalDay = false }: ForcedUpdateOverlayProps) {
  const [status, setStatus] = useState<UpdateStatus>("prompt");
  const [progress, setProgress] = useState<DownloadProgress>({
    contentLength: 0,
    downloaded: 0,
  });
  const [errorMsg, setErrorMsg] = useState("");
  const [dockRefreshing, setDockRefreshing] = useState(false);

  const handleDockRefresh = async () => {
    setDockRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
    } catch {
      // non-critical
    }
    try {
      window.location.reload();
    } catch {
      // ignore
    }
  };

  // Live countdown — tick every 30 seconds for precise display
  const [hoursRemaining, setHoursRemaining] = useState(state.hoursRemaining);

  useEffect(() => {
    setHoursRemaining(state.hoursRemaining);
  }, [state.hoursRemaining]);

  // Local tick for smoother countdown between polls — compute from state prop, not localStorage
  const showLiveCountdown = hoursRemaining !== null && hoursRemaining > 0 && !!state.lockAt;
  useEffect(() => {
    if (!showLiveCountdown || !state.lockAt) return;

    const tick = () => {
      // Deadline comes from the server; compare against the server-corrected clock.
      const remainingMs = new Date(state.lockAt!).getTime() - getTrustedNowMs();
      setHoursRemaining(Math.max(0, remainingMs / (60 * 60 * 1000)));
    };
    tick();
    const id = window.setInterval(tick, 30_000);

    return () => window.clearInterval(id);
  }, [showLiveCountdown, state.lockAt]);

  const percentComplete =
    progress.contentLength > 0
      ? Math.round((progress.downloaded / progress.contentLength) * 100)
      : 0;

  const handleUpdate = useCallback(async () => {
    const isNativeTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isNativeTauri) {
      void openUpdateDownload(state.downloadUrl);
      return;
    }

    try {
      setStatus("downloading");
      setProgress({ contentLength: 0, downloaded: 0 });
      setErrorMsg("");

      await installLatestUpdate(
        (p) => setProgress(p),
        (st) => setStatus(st),
      );
    } catch (err: any) {
      console.error("[ForcedUpdate] Update failed:", err);
      // Stay in the app and say what went wrong; the user can try again.
      setErrorMsg(err?.message || "The update could not be installed. Please try again.");
      setStatus("error");
    }
  }, [state.downloadUrl]);

  const handleQuit = useCallback(async () => {
    try {
      await exit(0);
    } catch {
      try {
        window.close();
      } catch {
        // CEF in OBS may ignore window.close()
      }
    }
  }, []);

  const handleSupport = useCallback(() => {
    const base =
      import.meta.env.VITE_AUTH_API_URL ||
      "https://api.makechurcheazy.com";
    window.open(`${base}/support`, "_blank", "noopener,noreferrer");
  }, []);

  const handleRetry = useCallback(() => {
    setStatus("prompt");
    setProgress({ contentLength: 0, downloaded: 0 });
    setErrorMsg("");
  }, []);

  const isBlocked = state.blocked;
  const isEmergency = state.lockType === "emergency-lock";
  const showCountdown = !isBlocked && hoursRemaining !== null && hoursRemaining > 0;
  const isBusy = status === "downloading" || status === "installing" || status === "relaunching";

  const statusLabel: Record<UpdateStatus, string> = {
    prompt: "Update Required",
    downloading: "Downloading...",
    installing: "Installing...",
    relaunching: "Relaunching...",
    error: "Update Failed",
  };

  const eyebrow = isDock
    ? (isBlocked ? "Dock Blocked" : lockTypeLabel(state.lockType))
    : finalDay && !isBlocked && !isEmergency
      ? "Final day to update"
      : lockTypeLabel(state.lockType);

  const title = isDock
    ? (isBlocked ? "Dock Blocked" : statusLabel[status])
    : isBlocked
      ? isEmergency ? "Emergency Lock Active" : "App Locked"
      : isEmergency
        ? "Emergency Maintenance Scheduled"
        : statusLabel[status];

  const icon = isBlocked
    ? <Lock size={26} />
    : status === "error" || isEmergency
      ? <AlertTriangle size={26} />
      : isBusy
        ? <RefreshCw size={26} />
        : <Download size={26} />;

  const message = isDock
    ? isBlocked
      ? "This has been blocked because you need to update the app. Please open MakeChurchEazy on this computer to update."
      : "A new version of MakeChurchEazy is required. Please open MakeChurchEazy on this computer to update before the deadline."
    : isEmergency
      ? state.updateMessage
      : state.updateMessage ||
        `A new version of MakeChurchEazy is required. Your version is v${state.currentVersion}. Update to v${state.requiredVersion} or later to continue.`;

  const extra = (
    <>
      {status === "prompt" && !isEmergency && state.requiredVersion ? (
        <ModalFacts
          rows={[
            { label: "Your version", value: `v${state.currentVersion}` },
            { label: "Required version", value: `v${state.requiredVersion}` },
          ]}
        />
      ) : null}
      {status === "prompt" && !isDock && finalDay && !isBlocked && !isEmergency ? (
        <ModalNotice tone="danger" icon={<AlertCircle size={14} />}>
          This is the last day. Update MakeChurchEazy now so you are not locked out.
        </ModalNotice>
      ) : null}
      {status === "prompt" && !isDock && isBlocked ? (
        <ModalNotice tone="danger" icon={<AlertCircle size={14} />}>
          {isEmergency
            ? "Emergency lock is active. Access will remain restricted until your administrator disables it."
            : "Grace period has expired. You must update to continue using the app."}
        </ModalNotice>
      ) : null}
      {status === "downloading" ? (
        <ModalProgress
          label={state.requiredVersion ? `MakeChurchEazy v${state.requiredVersion}` : "Update"}
          value={`${percentComplete}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.contentLength)}`}
          percent={percentComplete}
        />
      ) : null}
      {status === "installing" ? <ModalProgress label="Installing update..." value="" percent={100} /> : null}
      {status === "error" ? (
        <ModalNotice tone="danger" icon={<AlertCircle size={14} />}>{errorMsg}</ModalNotice>
      ) : null}
    </>
  );

  const actions: ModalAction[] = [];
  if (isDock) {
    if (onDismiss && !isBlocked) {
      // Until the last 30 minutes the dock can be used; the reminder returns later.
      actions.push({ label: "Close for now", variant: "ghost", onClick: onDismiss });
    }
    actions.push({
      label: dockRefreshing ? "Refreshing…" : "I Updated, Refresh",
      variant: "primary",
      icon: <RefreshCw size={14} />,
      disabled: dockRefreshing,
      onClick: () => void handleDockRefresh(),
    });
  } else if (status === "prompt") {
    if (isBlocked) actions.push({ label: "Quit App", variant: "ghost", onClick: () => void handleQuit() });
    if (showCountdown && onDismiss) {
      actions.push({ label: isEmergency ? "Learn More Later" : "Remind Me Later", variant: "ghost", onClick: onDismiss });
    }
    actions.push(
      isEmergency
        ? { label: "Support", variant: "primary", onClick: handleSupport }
        : { label: "Update Now", variant: "primary", autoFocus: true, icon: <Download size={14} />, onClick: () => void handleUpdate() },
    );
  } else if (status === "error") {
    actions.push({ label: "Try Again", variant: "primary", autoFocus: true, icon: <RefreshCw size={14} />, onClick: handleRetry });
  }

  return (
    <ModalDialog
      tone={isBlocked || isEmergency || status === "error" ? "danger" : "warning"}
      role="alertdialog"
      icon={icon}
      iconBusy={!isDock && isBusy}
      eyebrow={showCountdown ? `${eyebrow} · ${formatCountdownPrecise(hoursRemaining!)}` : eyebrow}
      title={title}
      extra={extra}
      hint={
        status === "prompt" && showCountdown
          ? `The app will be locked in ${formatCountdownPrecise(hoursRemaining!)}. Update before then to avoid disruption.`
          : status === "relaunching"
            ? "Restarting MakeChurchEazy..."
            : undefined
      }
      actions={actions}
      width={460}
      zIndex={99999}
    >
      {state.requiredVersion ? <p className="mce-modal__subtle">v{state.requiredVersion} is required</p> : null}
      {status === "prompt" && message ? <p>{message}</p> : null}
    </ModalDialog>
  );
}
