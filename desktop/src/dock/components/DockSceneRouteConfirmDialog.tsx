import { useTranslation } from "react-i18next";
import ModalDialog, { ModalFacts, type ModalAction } from "../../components/ModalDialog";
import { Cast, MonitorOff, MonitorPlay, Play } from "../../components/icons/NativeIcons";
import { closeAllDockProjectors } from "../dockDisplayOutputClient";
import {
  getDockOutputDestinations,
  type DockOutputDestination,
  type DockSceneOutputMode,
  type DockSceneRoute,
} from "../dockSceneRouting";

export interface DockSceneRouteConfirmDialogProps {
  open: boolean;
  route?: DockSceneRoute | null;
  itemLabel?: string;
  onConfirmRouted: () => void | Promise<void>;
  onSendToMceAlone: () => void | Promise<void>;
  onCancel: () => void;
  sending?: boolean;
}

/**
 * DockSceneRouteConfirmDialog — asked when an operator projects content (Bible, Worship, Notes)
 * while Output is routed to other scenes.
 *
 * It lists every output the content will reach (scenes, MCE Presentation, a display) and offers:
 * send to them, MCE Presentation only, or Cancel. Uses the app's one dialog look (ModalDialog).
 */
export default function DockSceneRouteConfirmDialog({
  open,
  route,
  itemLabel,
  onConfirmRouted,
  onSendToMceAlone,
  onCancel,
  sending = false,
}: DockSceneRouteConfirmDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const destinations = route ? getDockOutputDestinations(route) : [];
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
    if (destination.kind === "scene") return modeLabel(destination.mode);
    if (destination.kind === "display") return `${t("sceneRouting.display", "Display")} · ${modeLabel(destination.mode)}`;
    return t("sceneRouting.mainOutput", "Main output");
  };

  const lead = itemLabel
    ? t("sceneRouting.goesToItem", "Your {{item}} goes to:", { item: itemLabel })
    : t("sceneRouting.goesTo", "This content goes to:");
  const sendLabel = destinations.length === 1
    ? t("sceneRouting.sendToOne", "Send to {{name}}", { name: destinations[0].name })
    : t("sceneRouting.sendToMany", "Send to {{count}} outputs", { count: destinations.length });

  const actions: ModalAction[] = [
    { label: t("common.cancel", "Cancel"), variant: "ghost", onClick: onCancel },
  ];
  if (route && !onlyPresentation) {
    actions.push({
      label: t("sceneRouting.presentationOnly", "Presentation only"),
      variant: "ghost",
      disabled: sending,
      icon: <MonitorPlay size={14} />,
      title: t("sceneRouting.presentationOnlyHint", "Turns off the scenes and display for this tab, then sends to MCE Presentation."),
      onClick: () => { void onSendToMceAlone(); },
    });
  }
  if (route) {
    actions.push({
      label: sendLabel,
      variant: "primary",
      autoFocus: true,
      disabled: sending,
      icon: <Play size={14} />,
      title: sendLabel,
      onClick: () => { void onConfirmRouted(); },
    });
  }

  return (
    <ModalDialog
      tone="brand"
      icon={<Cast size={26} />}
      eyebrow={t("sceneRouting.outputOnTitle", "Output is on")}
      title={t("sceneRouting.confirmSendTitle", "Send to these outputs?")}
      extra={route ? (
        <ModalFacts
          rows={destinations.map((destination) => ({ label: destination.name, value: detail(destination) }))}
        />
      ) : undefined}
      hint={route && !presentationUpdated
        ? t("sceneRouting.presentationNotUpdated", "MCE Presentation isn't updated.")
        : undefined}
      actions={actions}
      footer={usesDisplay ? (
        <button
          type="button"
          className="mce-modal__btn mce-modal__btn--ghost"
          onClick={() => { void closeAllDockProjectors(); }}
          title={t("sceneRouting.closeAllProjectorsHint", "Closes every projector window on every screen.")}
        >
          <MonitorOff size={14} />
          {t("sceneRouting.closeAllProjectors", "Close all projectors")}
        </button>
      ) : undefined}
      onClose={onCancel}
      zIndex={10002}
      width={380}
    >
      {route ? <p>{lead}</p> : null}
    </ModalDialog>
  );
}
