import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { resolveDockDisplayTarget, type DockDisplayChoice } from "../dockDisplayOutput";
import {
  buildDockMediaDisplayItem,
  loadDockMediaDisplay,
  saveDockMediaDisplay,
  showOnDockDisplay,
} from "../dockDisplayOutputClient";
import type { MediaItem } from "../../library/libraryTypes";
import { useDockDisplays } from "../useDockDisplays";
import DockDisplayList from "./DockDisplayList";

interface Props {
  name: string;
  media: Pick<MediaItem, "type" | "name" | "url" | "diskFileName">;
  /** How the Media tab plays it (fit, sound, loop). */
  options: { fit?: string; muted?: boolean; loop?: boolean };
  onClose: () => void;
}

/**
 * Media → "Send to a display": shows a picture or video full screen on a projector
 * or TV plugged into this computer (the Studio projector, one per screen).
 * The screen picked last time is chosen again.
 */
export default function DockMediaDisplayDialog({ name, media, options, onClose }: Props) {
  const { t } = useTranslation();
  const { displays, error } = useDockDisplays(true);
  const saved = useMemo(() => loadDockMediaDisplay(), []);
  const [picked, setPicked] = useState<DockDisplayChoice | null>(null);

  // The saved screen if it's connected (found by name if it moved), else the first other screen.
  const resolution = resolveDockDisplayTarget({ ...saved, enabled: Boolean(saved.monitorKey) }, displays ?? []);
  const fallback = displays?.find((display) => !display.isComputerScreen) ?? null;
  const chosen = picked
    ?? (resolution.status === "ready" ? resolution.display : null)
    ?? fallback;
  const savedMissing = Boolean(saved.monitorKey) && displays !== null && resolution.status !== "ready" && !picked
    ? saved.monitorName || t("sceneRouting.savedDisplay", "Saved display")
    : undefined;

  const handleSend = () => {
    if (!chosen) return;
    const display = { enabled: true, monitorKey: chosen.key, monitorName: chosen.name, mode: "fullscreen" as const };
    saveDockMediaDisplay(display);
    showOnDockDisplay(display, buildDockMediaDisplayItem(media, options));
    onClose();
  };

  return (
    <div className="dock-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dock-dialog dock-dialog--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dock-media-send-display-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      >
        <div className="dock-dialog__header">
          <h2 id="dock-media-send-display-title" className="dock-dialog__title">
            {t("media.sendToDisplay", "Send to a display")}
          </h2>
          <button
            type="button"
            className="dock-dialog__close"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-dialog__body">
          <DockDisplayList
            displays={displays}
            error={error}
            selectedKey={chosen?.key ?? ""}
            name="dock-media-display"
            onPick={setPicked}
            missingName={savedMissing}
            hint={t("media.sendToDisplayHint", "Shows it full screen on that display. One projector per display.")}
          />
          <p className="dock-media-clear-confirm__summary" style={{ marginTop: 12 }}>{name}</p>
        </div>
        <div className="dock-dialog__footer">
          <button type="button" className="dock-btn dock-btn--compact" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--primary dock-btn--compact"
            onClick={handleSend}
            disabled={!chosen}
            title={chosen ? `${t("media.sendToDisplay", "Send to a display")}: ${chosen.name}` : undefined}
          >
            <Icon name="tv" size={12} />
            {chosen
              ? t("media.sendToDisplayNamed", "Send to {{name}}", { name: chosen.name })
              : t("media.sendToDisplay", "Send to a display")}
          </button>
        </div>
      </div>
    </div>
  );
}
