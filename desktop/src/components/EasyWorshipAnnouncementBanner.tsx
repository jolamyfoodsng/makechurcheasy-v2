import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  FolderDown,
  Loader2,
  X,
} from "./icons/NativeIcons";
import {
  ewBackgroundImporter,
  EW_IMPORT_COMPLETE_EVENT,
  EW_IMPORT_PROGRESS_EVENT,
  type EWImportProgress,
  type EWImportSummary,
} from "../worship/easyWorshipBackgroundImporter";
import EasyWorshipOneClickImportModal from "../worship/EasyWorshipOneClickImportModal";
import "./easyWorshipAnnouncementBanner.css";

export const OPEN_EW_BANNER_EVENT = "mce-open-ew-import-banner";

export function triggerEasyWorshipBanner() {
  window.dispatchEvent(new CustomEvent(OPEN_EW_BANNER_EVENT));
}

const EW_BANNER_DISMISS_KEY = "mce_ew_banner_dismissed";

export default function EasyWorshipAnnouncementBanner() {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const status = ewBackgroundImporter.getStatus();
    if (status === "importing" || status === "completed") return true;
    return localStorage.getItem(EW_BANNER_DISMISS_KEY) !== "true";
  });
  const [stage, setStage] = useState<"prompt" | "running" | "completed">(() => {
    const status = ewBackgroundImporter.getStatus();
    if (status === "importing") return "running";
    if (status === "completed") return "completed";
    return "prompt";
  });
  const [progress, setProgress] = useState<EWImportProgress>({
    stage: "Preparing import...",
    percent: 0,
  });
  const [summary, setSummary] = useState<EWImportSummary | null>(() => {
    return ewBackgroundImporter.getLastSummary();
  });

  useEffect(() => {
    const handleOpen = () => {
      localStorage.removeItem(EW_BANNER_DISMISS_KEY);
      setVisible(true);
      if (ewBackgroundImporter.getStatus() === "importing") {
        setStage("running");
      } else if (ewBackgroundImporter.getStatus() === "completed") {
        setStage("completed");
      } else {
        setStage("prompt");
      }
    };

    const handleProgress = (event: Event) => {
      const detail = (event as CustomEvent<EWImportProgress>).detail;
      setProgress(detail);
      setStage("running");
      setVisible(true);
    };

    const handleComplete = (event: Event) => {
      const detail = (event as CustomEvent<EWImportSummary>).detail;
      setSummary(detail);
      setStage("completed");
      setVisible(true);
    };

    window.addEventListener(OPEN_EW_BANNER_EVENT, handleOpen);
    window.addEventListener(EW_IMPORT_PROGRESS_EVENT, handleProgress);
    window.addEventListener(EW_IMPORT_COMPLETE_EVENT, handleComplete);

    // If already running or completed on load
    const currentStatus = ewBackgroundImporter.getStatus();
    if (currentStatus === "importing") {
      setVisible(true);
      setStage("running");
      setProgress(ewBackgroundImporter.getProgress());
    } else if (currentStatus === "completed") {
      setVisible(true);
      setStage("completed");
      setSummary(ewBackgroundImporter.getLastSummary());
    }

    return () => {
      window.removeEventListener(OPEN_EW_BANNER_EVENT, handleOpen);
      window.removeEventListener(EW_IMPORT_PROGRESS_EVENT, handleProgress);
      window.removeEventListener(EW_IMPORT_COMPLETE_EVENT, handleComplete);
    };
  }, []);

  if (!visible) return null;

  // Choosing which EasyWorship library to import (and seeing how many songs it has) happens in the dialog.
  const handleStartImport = () => setChooserOpen(true);

  const handleDismiss = () => {
    localStorage.setItem(EW_BANNER_DISMISS_KEY, "true");
    if (stage === "completed") {
      ewBackgroundImporter.reset();
    }
    setVisible(false);
  };

  return (
    <>
    {chooserOpen && <EasyWorshipOneClickImportModal onClose={() => setChooserOpen(false)} />}
    <div className={`ew-announcement-banner ew-announcement-banner--${stage}`} role="status">
      <div className="ew-announcement-banner__container">
        {/* Left Icon + Text */}
        <div className="ew-announcement-banner__main">
          {stage === "prompt" && (
            <div className="ew-announcement-badge">
              <FolderDown size={18} />
            </div>
          )}

          {stage === "running" && (
            <div className="ew-announcement-badge ew-announcement-badge--spin">
              <Loader2 size={18} className="ew-spin" />
            </div>
          )}

          {stage === "completed" && (
            <div className="ew-announcement-badge ew-announcement-badge--success">
              <CheckCircle2 size={18} />
            </div>
          )}

          <div className="ew-announcement-copy">
            {stage === "prompt" && (
              <>
                <strong className="ew-announcement-title">
                  Import from EasyWorship
                </strong>
                <span className="ew-announcement-desc">
                  Bring your EasyWorship songs, pictures, videos and themes into MakeChurchEazy. EasyWorship can stay open.
                </span>
              </>
            )}

            {stage === "running" && (
              <>
                <strong className="ew-announcement-title">
                  Importing in the background...
                </strong>
                <span className="ew-announcement-desc">
                  Keep this running in the background while it is importing. You can continue using MakeChurchEazy. {progress.stage ? `(${progress.stage})` : ""}
                </span>
              </>
            )}

            {stage === "completed" && (
              <>
                <strong className="ew-announcement-title">
                  Imported from EasyWorship
                </strong>
                <span className="ew-announcement-desc">
                  {summary
                    ? `Added ${summary.importedCount.toLocaleString()} ${summary.importedCount === 1 ? "song" : "songs"}${summary.alreadyInLibraryCount ? `; ${summary.alreadyInLibraryCount.toLocaleString()} you already had were skipped` : ""}${summary.overLimitCount ? `; ${summary.overLimitCount.toLocaleString()} didn’t fit your plan’s song limit` : ""}${summary.assets ? `; ${summary.assets.mediaImported.toLocaleString()} pictures and videos and ${summary.assets.themesImported.toLocaleString()} themes added` : ""}.`
                    : "Your songs are in the library."}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div className="ew-announcement-banner__actions">
          {stage === "prompt" && (
            <>
              <button
                type="button"
                className="ew-announcement-btn ew-announcement-btn--primary"
                onClick={handleStartImport}
              >
                <Download size={15} />
                <span>Choose what to import</span>
              </button>
              <button
                type="button"
                className="ew-announcement-btn ew-announcement-btn--ghost"
                onClick={handleDismiss}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </>
          )}

          {stage === "running" && (
            <button
              type="button"
              className="ew-announcement-btn ew-announcement-btn--secondary"
              onClick={handleDismiss}
              title="Acknowledge and keep running in background"
            >
              OK (Keep in Background)
            </button>
          )}

          {stage === "completed" && (
            <button
              type="button"
              className="ew-announcement-btn ew-announcement-btn--primary"
              onClick={handleDismiss}
              title="Close announcement"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
