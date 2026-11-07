import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Download, ExternalLink, Loader2, Puzzle, RefreshCw } from "./icons/NativeIcons";
import ModalDialog, { ModalFacts, ModalNotice } from "./ModalDialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getObsMovePluginStatus,
  isMceBridgeLoaded,
  ensureMoveTransition,
  installObsMovePlugin,
  isMovePluginLoaded,
  MOVE_TRANSITION_RELEASE_URL,
  type ObsMovePluginStatus,
} from "../services/obsMovePlugin";

interface Props {
  onClose: () => void;
}

type ModalState = "checking" | "ready" | "not-installed" | "installed" | "installing" | "error";

export default function MovePluginInstallModal({ onClose }: Props) {
  const [plugin, setPlugin] = useState<ObsMovePluginStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bridgeLoaded, setBridgeLoaded] = useState(false);
  const [state, setState] = useState<ModalState>("checking");

  const check = useCallback(async () => {
    setState("checking");
    try {
      const status = await getObsMovePluginStatus();
      const [runtimeLoaded, runtimeBridgeLoaded] = await Promise.all([
        isMovePluginLoaded(),
        isMceBridgeLoaded(),
      ]);
      setPlugin(status);
      setLoaded(runtimeLoaded);
      setBridgeLoaded(runtimeBridgeLoaded);
      if (runtimeLoaded && runtimeBridgeLoaded) {
        void ensureMoveTransition();
      }
      const installed = status.installed && status.bridgeInstalled;
      const available = status.bundled && status.bridgeBundled;
      setState(installed ? (runtimeLoaded && runtimeBridgeLoaded ? "ready" : "installed") : available ? "not-installed" : "error");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const install = async () => {
    setState("installing");
    if (!window.confirm("Install Move Transition and the MakeChurchEazy OBS Bridge for this user?")) {
      setState(plugin?.installed && plugin.bridgeInstalled ? "installed" : "not-installed");
      return;
    }
    try {
      const status = await installObsMovePlugin();
      setPlugin(status);
      setLoaded(false);
      setBridgeLoaded(false);
      setState("installed");
    } catch {
      setState("error");
    }
  };

  const canInstallInApp = Boolean(plugin?.bundled && plugin.bridgeBundled);
  const openMoveTransitionRelease = () => {
    void openUrl(MOVE_TRANSITION_RELEASE_URL);
  };

  const busy = state === "checking" || state === "installing";
  const pluginInstalled = Boolean(plugin?.installed && plugin.bridgeInstalled);
  const runtimeReady = loaded && bridgeLoaded;
  const statusLabel = busy ? "Checking" : runtimeReady ? "Ready" : pluginInstalled ? "Restart OBS" : "Not installed";

  return (
    <ModalDialog
      tone={runtimeReady ? "success" : "brand"}
      icon={state === "installing" ? <Loader2 size={26} /> : <Puzzle size={26} />}
      iconBusy={state === "installing"}
      title="Install OBS motion support"
      onClose={onClose}
      width={460}
      extra={
        <>
          <ModalFacts
            rows={[
              {
                label: "OBS motion support",
                value: `${plugin?.platform || "Desktop"} · Move ${plugin?.version || "3.2.1"} · Bridge ${plugin?.bridgeVersion || "1.0.0"}`,
              },
              { label: "Status", value: statusLabel },
            ]}
          />
          {pluginInstalled && !runtimeReady && (
            <ModalNotice tone="info" icon={<RefreshCw size={15} />}>
              Restart OBS, then return here and choose Check again.
            </ModalNotice>
          )}
          {runtimeReady && (
            <ModalNotice tone="info" icon={<CheckCircle size={15} />}>
              Move Transition and the MCE OBS Bridge are active in OBS.
            </ModalNotice>
          )}
        </>
      }
      actions={[
        { label: "Not now", variant: "ghost", onClick: onClose, title: "Not now" },
        pluginInstalled
          ? {
              label: "Check again",
              variant: "primary",
              icon: <RefreshCw size={14} />,
              disabled: busy,
              title: "Check plugin status",
              onClick: () => void check(),
            }
          : {
              label: canInstallInApp ? "Install motion support" : "Open Move Transition",
              variant: "primary",
              icon: canInstallInApp ? <Download size={14} /> : <ExternalLink size={14} />,
              disabled: busy,
              title: canInstallInApp ? "Install OBS motion support" : "Open Move Transition download",
              onClick: () => {
                if (canInstallInApp) void install();
                else openMoveTransitionRelease();
              },
            },
      ]}
    >
      Add optional smooth scene movement to OBS. MakeChurchEazy downloads Move Transition and its small bridge, then
      places both in your user OBS folder. You can leave this disabled and use the built-in layout fallback.
    </ModalDialog>
  );
}
