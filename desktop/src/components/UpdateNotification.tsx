/**
 * UpdateNotification.tsx — Centered update dialog for optional releases.
 *
 * Behavior:
 * - Shows the release notes before the user chooses an action
 * - Offers "Update Now", "Update in Background" or "Remind me later"
 * - "Update in Background" downloads quietly and waits for a restart (or
 *   installs when the app is quit) instead of restarting mid-service
 * - Remembers the reminder choice and re-shows after the reminder window
 * - Shows download progress inline when updating
 */

import { useCallback, useEffect } from "react";
import {
  type UpdateCheckResult,
} from "../services/updateService";
import {
  updateDownloadManager,
  useUpdateDownload,
} from "../services/updateDownloadManager";
import type { Update } from "@tauri-apps/plugin-updater";
import ModalDialog, { ModalProgress, type ModalAction } from "./ModalDialog";
import UpdateReleaseNotes from "./UpdateReleaseNotes";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, RefreshCw } from "./icons/NativeIcons";

interface UpdateNotificationProps {
  result: UpdateCheckResult;
  onRemindLater: () => void;
  manualDownloadUrl?: string;
  releaseNotesUrl?: string;
  message?: string;
}

type UpdateStatus = "prompt" | "downloading" | "ready" | "installing" | "relaunching" | "error";

const STORAGE_KEY = "ocs-update-notification-v1";

interface UpdateNotificationPrefs {
  dismissedVersion?: string;
  dismissedAt?: number;
  remindLaterAt?: number;
  ignoredCount?: number;
}

function loadPrefs(): UpdateNotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UpdateNotificationPrefs;
  } catch { /* ignore */ }
  return {};
}

function savePrefs(prefs: UpdateNotificationPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

function shouldShowNotification(result: UpdateCheckResult): boolean {
  if (!result.available) return false;
  const prefs = loadPrefs();
  if (prefs.remindLaterAt && prefs.remindLaterAt > Date.now()) return false;
  if (prefs.dismissedVersion === result.version && prefs.dismissedAt) {
    const daysSinceDismissal = (Date.now() - prefs.dismissedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceDismissal < 1) return false;
  }
  return true;
}

export default function UpdateNotification({
  result,
  onRemindLater,
  manualDownloadUrl,
  releaseNotesUrl,
  message,
}: UpdateNotificationProps) {
  const downloadState = useUpdateDownload();

  // Register available update with central manager
  useEffect(() => {
    if (result.available) {
      updateDownloadManager.registerAvailableUpdate(
        (result.update as Update) ?? null,
        result.version ?? "",
        result.currentVersion ?? "",
        manualDownloadUrl,
        shouldShowNotification(result),
      );
    }
  }, [result, manualDownloadUrl]);

  const rawStatus = downloadState.status;
  const status: UpdateStatus =
    rawStatus === "downloading" ||
    rawStatus === "ready" ||
    rawStatus === "installing" ||
    rawStatus === "relaunching" ||
    rawStatus === "error"
      ? rawStatus
      : "prompt";

  const progress = downloadState.progress;
  const errorMsg = downloadState.errorMsg;
  const percentComplete = progress.percent;

  const isBusy = status === "downloading" || status === "installing" || status === "relaunching";

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };



  const handleUpdate = useCallback(async () => {
    if (!result.update) {
      if (manualDownloadUrl) {
        window.open(manualDownloadUrl, "_blank", "noopener,noreferrer");
        return;
      }
    }
    await updateDownloadManager.startDownload((result.update as Update) ?? null, result.version);
  }, [manualDownloadUrl, result.update, result.version]);

  const handleUpdateInBackground = useCallback(async () => {
    if (!result.update && manualDownloadUrl) {
      window.open(manualDownloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    await updateDownloadManager.startDownload((result.update as Update) ?? null, result.version, { background: true });
  }, [manualDownloadUrl, result.update, result.version]);

  const handleContinueInBackground = useCallback(() => {
    updateDownloadManager.continueInBackground();
  }, []);

  const handleRestartNow = useCallback(() => {
    void updateDownloadManager.installNow();
  }, []);

  const handleRetry = useCallback(() => {
    updateDownloadManager.retry();
  }, []);

  const handleRemindLater = useCallback(() => {
    if (updateDownloadManager.isBusy() || updateDownloadManager.isReady()) {
      updateDownloadManager.dismissModal();
      return;
    }

    updateDownloadManager.dismissModal();
    savePrefs({
      ...loadPrefs(),
      remindLaterAt: Date.now() + 4 * 60 * 60 * 1000,
    });
    setTimeout(() => onRemindLater(), 300);
  }, [onRemindLater]);

  if (!downloadState.isModalVisible) return null;

  const readyVersion = downloadState.version || result.version;
  const title =
    status === "ready" ? `MakeChurchEazy ${readyVersion} is ready`
      : status === "downloading" ? "Downloading update"
        : status === "installing" ? "Installing update"
          : status === "relaunching" ? "Restarting MakeChurchEazy"
            : status === "error" ? "Update failed"
              : `MakeChurchEazy ${result.version || "update"} is available`;

  const icon =
    status === "ready" ? <CheckCircle2 size={26} />
      : status === "error" ? <AlertTriangle size={26} />
        : isBusy ? <RefreshCw size={26} />
          : <Download size={26} />;

  const body =
    status === "prompt" ? (
      <p>
        {message || "A new version is ready to install."}
        {result.currentVersion ? ` You have ${result.currentVersion}.` : ""}
      </p>
    ) : status === "ready" ? (
      <p>Restart now to finish updating, or keep working: it installs automatically when you close MakeChurchEazy.</p>
    ) : status === "error" ? (
      <p>{errorMsg}</p>
    ) : status === "relaunching" ? (
      <p>MakeChurchEazy will open again in a moment.</p>
    ) : (
      <p>You can keep working while it downloads.</p>
    );

  const extra =
    status === "prompt" ? (
      <UpdateReleaseNotes
        version={result.version}
        notes={result.notes}
        footer={releaseNotesUrl ? (
          <button
            type="button"
            className="mce-modal__link"
            onClick={() => window.open(releaseNotesUrl, "_blank", "noopener,noreferrer")}
          >
            Open full release notes
            <ExternalLink size={12} />
          </button>
        ) : null}
      />
    ) : status === "downloading" ? (
      <ModalProgress
        label={`MakeChurchEazy ${result.version ?? ""}`.trim()}
        value={`${percentComplete}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.contentLength)}`}
        percent={percentComplete}
      />
    ) : status === "installing" ? (
      <ModalProgress label="Installing" value="Almost done" percent={100} />
    ) : undefined;

  const actions: ModalAction[] =
    status === "prompt"
      ? [
          { label: "Remind me later", variant: "ghost", onClick: handleRemindLater },
          { label: "Update in background", variant: "ghost", title: "Download quietly; restart when you are ready", onClick: () => void handleUpdateInBackground() },
          { label: "Update now", variant: "primary", autoFocus: true, title: "Download, install and restart now", onClick: () => void handleUpdate() },
        ]
      : status === "downloading"
        ? [{ label: "Continue in background", variant: "ghost", onClick: handleContinueInBackground }]
        : status === "ready"
          ? [
              { label: "Later", variant: "ghost", title: "Install when I close MakeChurchEazy", onClick: () => updateDownloadManager.dismissModal() },
              { label: "Restart now", variant: "primary", autoFocus: true, onClick: handleRestartNow },
            ]
          : status === "error"
            ? [
                { label: "Remind me later", variant: "ghost", onClick: handleRemindLater },
                { label: "Try again", variant: "primary", autoFocus: true, onClick: handleRetry },
              ]
            : [];

  return (
    <ModalDialog
      tone={status === "error" ? "danger" : status === "ready" ? "success" : "brand"}
      icon={icon}
      iconBusy={isBusy}
      eyebrow="Update available"
      title={title}
      extra={extra}
      actions={actions}
      onClose={isBusy ? undefined : handleRemindLater}
      closeOnBackdrop={false}
      width={status === "prompt" ? 560 : 460}
    >
      {body}
    </ModalDialog>
  );
}
