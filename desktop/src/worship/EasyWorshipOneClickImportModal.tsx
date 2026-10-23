import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ModalDialog, { ModalProgress } from "../components/ModalDialog";
import { AlertCircle, CheckCircle2, FolderDown, FolderOpen, Loader2, Music2 } from "../components/icons/NativeIcons";
import { useAuth } from "../contexts/AuthContext";
import {
  getRemainingImageSlots,
  getRemainingSongSlots,
  getRemainingThemeSlots,
  getRemainingVideoSlots,
  getUserPlanLimits,
} from "../services/licenseService";
import {
  ewBackgroundImporter,
  EW_IMPORT_COMPLETE_EVENT,
  EW_IMPORT_ERROR_EVENT,
  EW_IMPORT_PROGRESS_EVENT,
  findEasyWorshipLibraries,
  inspectEasyWorshipFolder,
  type EWImportProgress,
  type EWImportSummary,
  type EWLibrary,
} from "./easyWorshipBackgroundImporter";
import "./easyWorshipOneClickModal.css";

interface EasyWorshipOneClickImportModalProps {
  onClose: () => void;
  onImported?: () => void;
}

type Stage = "choose" | "running" | "completed";

export default function EasyWorshipOneClickImportModal({ onClose, onImported }: EasyWorshipOneClickImportModalProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>("choose");
  const [libraries, setLibraries] = useState<EWLibrary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [checkingFolder, setCheckingFolder] = useState(false);
  const [progress, setProgress] = useState<EWImportProgress>({ stage: "Preparing…", percent: 0 });
  const [summary, setSummary] = useState<EWImportSummary | null>(null);
  const [error, setError] = useState("");
  const [includeMedia, setIncludeMedia] = useState(true);

  useEffect(() => {
    const handleProgress = (event: Event) => setProgress((event as CustomEvent<EWImportProgress>).detail);
    const handleComplete = (event: Event) => {
      setSummary((event as CustomEvent<EWImportSummary>).detail);
      setStage("completed");
      onImported?.();
    };
    const handleError = (event: Event) => {
      setError(String((event as CustomEvent<string>).detail || "The import stopped."));
      setStage("choose");
    };
    window.addEventListener(EW_IMPORT_PROGRESS_EVENT, handleProgress);
    window.addEventListener(EW_IMPORT_COMPLETE_EVENT, handleComplete);
    window.addEventListener(EW_IMPORT_ERROR_EVENT, handleError);

    // Opened again while an import runs (or after it finished in the background).
    const status = ewBackgroundImporter.getStatus();
    if (status === "importing") {
      setStage("running");
      setProgress(ewBackgroundImporter.getProgress());
    } else if (status === "completed" && ewBackgroundImporter.getLastSummary()) {
      setSummary(ewBackgroundImporter.getLastSummary());
      setStage("completed");
    }

    // Look for EasyWorship's libraries on this computer.
    let cancelled = false;
    void findEasyWorshipLibraries().then((found) => {
      if (cancelled) return;
      setLibraries(found);
      if (found.length > 0) setSelected((current) => current || found[0].dataDir);
    });
    return () => {
      cancelled = true;
      window.removeEventListener(EW_IMPORT_PROGRESS_EVENT, handleProgress);
      window.removeEventListener(EW_IMPORT_COMPLETE_EVENT, handleComplete);
      window.removeEventListener(EW_IMPORT_ERROR_EVENT, handleError);
    };
  }, [onImported]);

  const chooseFolder = async () => {
    setError("");
    const picked = await open({ directory: true, multiple: false, title: "Choose your EasyWorship folder" }).catch(() => null);
    if (!picked || Array.isArray(picked)) return;
    setCheckingFolder(true);
    try {
      const lib = await inspectEasyWorshipFolder(picked);
      setLibraries((current) => {
        const list = current ?? [];
        return list.some((l) => l.dataDir === lib.dataDir) ? list : [...list, lib];
      });
      setSelected(lib.dataDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingFolder(false);
    }
  };

  const chosen = libraries?.find((l) => l.dataDir === selected) ?? null;

  const startImport = async () => {
    if (!chosen) return;
    setError("");
    setStage("running");
    try {
      const who = user ?? null;
      // Importing is free, but the plan's limits still apply. If the library can't be counted,
      // a limited plan imports nothing rather than everything.
      const limits = getUserPlanLimits(who);
      const room = (slots: Promise<number>, limit: number) => slots.catch(() => (limit === -1 || limit === Infinity ? Infinity : 0));
      const [songs, images, videos, themes] = await Promise.all([
        room(getRemainingSongSlots(who), limits.songs),
        room(getRemainingImageSlots(who), limits.images),
        room(getRemainingVideoSlots(who), limits.videos),
        room(getRemainingThemeSlots(who), limits.themes),
      ]);
      await ewBackgroundImporter.startImport(chosen, { songs, images, videos, themes }, includeMedia);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("choose");
    }
  };

  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  if (stage === "running") {
    return (
      <ModalDialog
        icon={<Loader2 size={26} className="ew-spin" />}
        title="Importing from EasyWorship…"
        extra={<ModalProgress label={progress.stage} value={`${progress.percent}%`} percent={progress.percent} />}
        hint="You can close this window and keep working. The import carries on in the background."
        actions={[{ label: "Close (keeps importing)", onClick: onClose, variant: "ghost" }]}
        onClose={onClose}
      >
        Songs first, then pictures, videos and themes.
      </ModalDialog>
    );
  }

  if (stage === "completed" && summary) {
    const assets = summary.assets;
    const anything = summary.importedCount + (assets?.mediaImported ?? 0) + (assets?.themesImported ?? 0) > 0;
    const overLimit = summary.overLimitCount + (assets ? assets.mediaOverLimit + assets.themesOverLimit : 0);
    const finish = () => { ewBackgroundImporter.reset(); onClose(); };
    return (
      <ModalDialog
        tone="success"
        icon={<CheckCircle2 size={26} />}
        title={anything ? "Imported from EasyWorship" : "Nothing new to import"}
        extra={
          <>
            <dl className="ew-summary">
              <div><dt>Songs added</dt><dd>{summary.importedCount.toLocaleString()}</dd></div>
              <div><dt>Songs already in your library</dt><dd>{summary.alreadyInLibraryCount.toLocaleString()}</dd></div>
              {assets && <div><dt>Pictures and videos added</dt><dd>{assets.mediaImported.toLocaleString()}</dd></div>}
              {assets && <div><dt>Themes created</dt><dd>{assets.themesImported.toLocaleString()}</dd></div>}
            </dl>
            {summary.assetsError && (
              <p className="ew-note ew-note--warn">The songs came in, but the pictures, videos and themes couldn’t be read: {summary.assetsError}</p>
            )}
            {overLimit > 0 && (
              <p className="ew-note ew-note--warn">
                {plural(overLimit, "item wasn’t", "items weren’t")} imported because your plan’s limit was reached. Upgrade your plan, then import again: anything you already have is skipped.
              </p>
            )}
          </>
        }
        actions={[{ label: "Done", onClick: finish, variant: "primary", autoFocus: true }]}
        onClose={finish}
      >
        From “{summary.libraryName}” in EasyWorship.
      </ModalDialog>
    );
  }

  return (
    <ModalDialog
      icon={<FolderDown size={26} />}
      title="Import from EasyWorship"
      width={480}
      extra={
        <div className="ew-choose">
          <div className="ew-library-list" role="radiogroup" aria-label="EasyWorship libraries">
            {libraries === null && (
              <p className="ew-library-empty"><Loader2 size={14} className="ew-spin" /> Looking for EasyWorship on this computer…</p>
            )}
            {libraries !== null && libraries.length === 0 && (
              <p className="ew-library-empty">
                EasyWorship wasn’t found on this computer. Choose the folder that holds <strong>Songs.db</strong> and <strong>SongWords.db</strong>, for example a copy from your EasyWorship computer.
              </p>
            )}
            {libraries?.map((lib) => (
              <label key={lib.dataDir} className={`ew-library${selected === lib.dataDir ? " is-selected" : ""}`}>
                <input type="radio" name="ew-library" checked={selected === lib.dataDir} onChange={() => setSelected(lib.dataDir)} />
                <Music2 size={18} className="ew-library-icon" />
                <span className="ew-library-text">
                  <strong>{lib.name} · {plural(lib.songCount, "song", "songs")}</strong>
                  <span title={lib.dataDir}>{lib.dataDir}</span>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="app-btn ew-choose-folder" onClick={() => void chooseFolder()} disabled={checkingFolder}>
            {checkingFolder ? <Loader2 size={16} className="ew-spin" /> : <FolderOpen size={16} />}
            <span>{checkingFolder ? "Checking the folder…" : "Choose folder…"}</span>
          </button>
          <label className="ew-option">
            <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
            <span>Also import pictures, videos and themes</span>
          </label>
          {error && <p className="ew-note ew-note--error" role="alert"><AlertCircle size={16} /> <span>{error}</span></p>}
        </div>
      }
      hint="Anything already in your library is skipped. Pictures and videos are copied into your Media library, and each EasyWorship theme becomes a theme with the same background. Your plan’s limits apply."
      actions={[
        { label: "Cancel", onClick: onClose, variant: "ghost" },
        {
          label: chosen ? `Import ${plural(chosen.songCount, "song", "songs")}${includeMedia ? " and media" : ""}` : "Import",
          onClick: () => void startImport(),
          variant: "primary",
          disabled: !chosen || chosen.songCount === 0,
        },
      ]}
      onClose={onClose}
    >
      Brings in your EasyWorship 6 or 7 songs with their lyrics, and its pictures, videos and themes. EasyWorship can stay open, and nothing in it is changed.
    </ModalDialog>
  );
}
