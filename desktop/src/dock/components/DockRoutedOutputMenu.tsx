import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { closeAllDockProjectors } from "../dockDisplayOutputClient";
import {
  getDockOutputDestinations,
  type DockOutputDestination,
  type DockSceneOutputMode,
  type DockSceneRoute,
} from "../dockSceneRouting";
import "./DockSceneRouteSendControl.css";
import "./DockSceneRoutingControl.css";

interface Props {
  route: DockSceneRoute;
  /** "menu" = the Output button (status), "confirm" = asked before the first send after Output changed. */
  variant: "menu" | "confirm";
  itemLabel?: string;
  /** Whether scene targets may use their own format (Bible, Worship, Notes). */
  showFormats?: boolean;
  sending?: boolean;
  onSend?: () => void;
  onPresentationOnly?: () => void;
  onConfigure?: () => void;
  onClose: () => void;
}

const DESTINATION_ICON: Record<DockOutputDestination["kind"], string> = {
  scene: "layers",
  presentation: "desktop_windows",
  display: "tv",
};

/**
 * Where this tab's content goes while Output is on, and what the operator can do about it:
 * send to those outputs, go back to MCE Presentation only, or change the outputs.
 */
export default function DockRoutedOutputMenu({
  route,
  variant,
  itemLabel,
  showFormats = false,
  sending = false,
  onSend,
  onPresentationOnly,
  onConfigure,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const destinations = getDockOutputDestinations(route);
  const presentationUpdated = destinations.some((d) => d.kind === "presentation");
  const onlyPresentation = destinations.length === 1 && presentationUpdated;
  const usesDisplay = destinations.some((d) => d.kind === "display");

  const modeLabel = (mode: DockSceneOutputMode) => (
    mode === "fullscreen"
      ? t("sceneRouting.fullscreenOutput", "Full screen")
      : mode === "lower-third"
        ? t("sceneRouting.lowerThirdOutput", "Lower third")
        : t("sceneRouting.followTab", "Follow tab")
  );
  const detail = (destination: DockOutputDestination) => {
    if (destination.kind === "scene") return showFormats ? modeLabel(destination.mode) : t("sceneRouting.obsScene", "OBS scene");
    if (destination.kind === "display") return `${t("sceneRouting.display", "Display")} · ${modeLabel(destination.mode)}`;
    return t("sceneRouting.mainOutput", "Main output");
  };

  const title = variant === "confirm"
    ? t("sceneRouting.confirmSendTitle", "Send to these outputs?")
    : t("sceneRouting.outputOnTitle", "Output is on");
  const lead = itemLabel
    ? t("sceneRouting.goesToItem", "Your {{item}} goes to:", { item: itemLabel })
    : t("sceneRouting.goesTo", "This content goes to:");
  const sendLabel = destinations.length === 1
    ? t("sceneRouting.sendToOne", "Send to {{name}}", { name: destinations[0].name })
    : t("sceneRouting.sendToMany", "Send to {{count}} outputs", { count: destinations.length });

  return (
    <div className="dock-routed-output">
      <div className="dock-routed-output__head">
        <div className="dock-routed-output__title">
          <span className="dock-routed-output__dot" aria-hidden="true" />
          {title}
        </div>
        <button
          type="button"
          className="dock-btn dock-btn--ghost dock-btn--compact dock-routed-output__close"
          onClick={onClose}
          title={t("common.close", "Close")}
          aria-label={t("common.close", "Close")}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="dock-routed-output__lead">{lead}</div>
      <ul className="dock-routed-output__list">
        {destinations.map((destination) => (
          <li key={`${destination.kind}:${destination.name}`} className="dock-routed-output__row">
            <Icon name={DESTINATION_ICON[destination.kind]} size={14} className="dock-routed-output__row-icon" />
            <span className="dock-routed-output__row-name" title={destination.name}>{destination.name}</span>
            <span className="dock-routed-output__row-detail">{detail(destination)}</span>
          </li>
        ))}
      </ul>
      {!presentationUpdated && (
        <div className="dock-routed-output__note">
          {t("sceneRouting.presentationNotUpdated", "MCE Presentation isn't updated.")}
        </div>
      )}
      {usesDisplay && (
        <button
          type="button"
          className="dock-btn dock-btn--ghost dock-btn--compact dock-display-list__close-all"
          onClick={() => { void closeAllDockProjectors(); }}
          title={t("sceneRouting.closeAllProjectorsHint", "Closes every projector window on every screen.")}
        >
          <Icon name="tv_off" size={13} />
          <span>{t("sceneRouting.closeAllProjectors", "Close all projectors")}</span>
        </button>
      )}

      {onSend && (
        <button
          type="button"
          className="dock-btn dock-btn--primary dock-routed-output__send"
          onClick={onSend}
          disabled={sending}
          title={sendLabel}
        >
          <Icon name="play_arrow" size={14} />
          <span>{sendLabel}</span>
        </button>
      )}

      <div className="dock-routed-output__actions">
        {onPresentationOnly && !onlyPresentation && (
          <button
            type="button"
            className="dock-btn dock-btn--secondary dock-btn--compact"
            onClick={onPresentationOnly}
            disabled={sending}
            title={t("sceneRouting.presentationOnlyHint", "Turns off the scenes and display for this tab, then sends to MCE Presentation.")}
          >
            <Icon name="desktop_windows" size={13} />
            <span>{t("sceneRouting.presentationOnly", "Presentation only")}</span>
          </button>
        )}
        {variant === "menu" && onConfigure ? (
          <button type="button" className="dock-btn dock-btn--secondary dock-btn--compact" onClick={onConfigure}>
            <Icon name="settings" size={13} />
            <span>{t("sceneRouting.changeOutput", "Change output")}</span>
          </button>
        ) : (
          <button type="button" className="dock-btn dock-btn--ghost dock-btn--compact" onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
