/**
 * ForceUpdateModal.tsx — Blocking modal shown when the app version is too old.
 *
 * Progressive urgency:
 *   - Day 14-20: Persistent (can't dismiss, but app still works)
 *   - Day 21+: Full lockout (app is blocked until updated)
 *
 * The modal downloads and installs the update inline.
 */

import { useState, useCallback, useMemo } from "react";
import {
  checkForUpdate,
  downloadAndInstallVerifiedUpdate,
  type UpdateCheckResult,
  type DownloadProgress,
} from "../services/updateService";
import { getReleaseHighlights } from "../services/releaseNotesService";
import type { Update } from "@tauri-apps/plugin-updater";
import ModalDialog, { ModalProgress, type ModalAction } from "./ModalDialog";
import UpdateReleaseNotes from "./UpdateReleaseNotes";
import { AlertTriangle, Download, Lock, RefreshCw } from "./icons/NativeIcons";

interface ForceUpdateModalProps {
  result: UpdateCheckResult;
  daysOld: number;
  /** If true, app is fully blocked */
  locked: boolean;
}

type UpdateStatus = "prompt" | "downloading" | "installing" | "relaunching" | "error";

function formatCountdown(daysOld: number): string {
  const remaining = Math.max(0, 21 - daysOld);
  if (remaining === 0) return "App is locked";
  return `${remaining} day${remaining === 1 ? "" : "s"} until the app locks`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ForceUpdateModal({ result, daysOld, locked }: ForceUpdateModalProps) {
  const [status, setStatus] = useState<UpdateStatus>("prompt");
  const [progress, setProgress] = useState<DownloadProgress>({ contentLength: 0, downloaded: 0 });
  const [errorMsg, setErrorMsg] = useState("");

  const percentComplete =
    progress.contentLength > 0
      ? Math.round((progress.downloaded / progress.contentLength) * 100)
      : 0;

  const highlights = useMemo(() => {
    return getReleaseHighlights(result.version, result.notes);
  }, [result.version, result.notes]);

  const handleUpdate = useCallback(async () => {
    // If no Update object (fake/test result), check for a real update first
    let update = result.update;
    if (!update) {
      try {
        setStatus("downloading");
        setProgress({ contentLength: 0, downloaded: 0 });
        const realResult = await checkForUpdate();
        if (realResult.update) {
          update = realResult.update;
        } else if (realResult.error) {
          // Network error — can't reach update server
          const isOffline = /network|fetch|failed to fetch|internet|ENOTFOUND|ECONNREFUSED/i.test(realResult.error);
          setErrorMsg(
            isOffline
              ? "No internet connection. Please connect to the internet and try again."
              : realResult.error || "Could not check for updates."
          );
          setStatus("error");
          return;
        } else {
          // No real update available — app is up to date
          setErrorMsg("Your app is already up to date. No update needed.");
          setStatus("error");
          return;
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        const isOffline = /network|fetch|failed to fetch|internet|ENOTFOUND|ECONNREFUSED/i.test(msg);
        setErrorMsg(
          isOffline
            ? "No internet connection. Please connect to the internet and try again."
            : msg || "Could not check for updates."
        );
        setStatus("error");
        return;
      }
    }
    try {
      setStatus("downloading");
      await downloadAndInstallVerifiedUpdate(
        update as Update,
        (p) => setProgress(p),
        (s) => setStatus(s)
      );
    } catch (err: any) {
      console.error("[ForceUpdate] Update failed:", err);
      setErrorMsg(err?.message || "Update failed. Please try again.");
      setStatus("error");
    }
  }, [result.update]);

  const handleRetry = useCallback(() => {
    setStatus("prompt");
    setProgress({ contentLength: 0, downloaded: 0 });
    setErrorMsg("");
  }, []);

  const isBusy = status === "downloading" || status === "installing" || status === "relaunching";
  const outOfDate = `Your version is ${daysOld} day${daysOld === 1 ? "" : "s"} out of date.`;
  const versionLine = result.version
    ? `MakeChurchEazy ${result.version} is available${result.currentVersion ? ` (you have ${result.currentVersion})` : ""}.`
    : "A new version of MakeChurchEazy is available.";

  const title =
    status === "downloading" ? "Downloading update"
      : status === "installing" ? "Installing update"
        : status === "relaunching" ? "Restarting MakeChurchEazy"
          : status === "error" ? "Update failed"
            : "Update required";

  const icon =
    status === "error" ? <AlertTriangle size={26} />
      : status === "prompt" ? (locked ? <Lock size={26} /> : <Download size={26} />)
        : <RefreshCw size={26} />;

  const body =
    status === "prompt" ? (
      <>
        <p>{versionLine} Update to keep using the app.</p>
        <p>{outOfDate}</p>
      </>
    ) : status === "error" ? (
      <p>{errorMsg}</p>
    ) : status === "relaunching" ? (
      <p>MakeChurchEazy will open again in a moment.</p>
    ) : (
      <p>Keep MakeChurchEazy open until this finishes.</p>
    );

  const extra =
    status === "prompt" && (highlights.length > 0 || result.notes) ? (
      <UpdateReleaseNotes version={result.version} notes={result.notes} maxItems={3} maxHeight={180} />
    ) : status === "downloading" ? (
      <ModalProgress
        label={result.version ? `MakeChurchEazy ${result.version}` : "Update"}
        value={`${percentComplete}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.contentLength)}`}
        percent={percentComplete}
      />
    ) : status === "installing" ? (
      <ModalProgress label="Installing" value="Almost done" percent={100} />
    ) : undefined;

  const actions: ModalAction[] =
    status === "prompt"
      ? [{ label: "Update now", variant: "primary", autoFocus: true, icon: <Download size={14} />, onClick: () => void handleUpdate() }]
      : status === "error"
        ? [{ label: "Try again", variant: "primary", autoFocus: true, icon: <RefreshCw size={14} />, onClick: handleRetry }]
        : [];

  // Blocking: no close button, Esc or backdrop. The countdown says how long the app keeps working.
  return (
    <ModalDialog
      tone={status === "error" || locked ? "danger" : "warning"}
      role="alertdialog"
      icon={icon}
      iconBusy={isBusy}
      eyebrow={locked ? "App is locked" : formatCountdown(daysOld)}
      title={title}
      extra={extra}
      actions={actions}
      width={460}
      zIndex={99999}
    >
      {body}
    </ModalDialog>
  );
}
