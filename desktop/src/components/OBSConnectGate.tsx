import { useState, useEffect, useRef } from "react";
import { obsService, type ConnectionStatus } from "../services/obsService";
import { loadData, updateData } from "../services/store";
import { getDefaultOBSUrl } from "../services/desktopConfig";
import { Cast } from "./icons/NativeIcons";
import ModalDialog, { ModalNotice, ModalPanel } from "./ModalDialog";
import { shouldAutoConnectObs } from "../services/workspacePreference";

const OBS_SETUP_STEPS = [
  { title: "Open OBS Studio", detail: "Launch OBS on your computer" },
  { title: "Go to Tools → Settings", detail: "Access OBS settings from the menu bar" },
  { title: "Open WebSocket Server Settings", detail: 'Find "WebSocket Server Settings" in the left sidebar' },
  { title: "Enable WebSocket server", detail: "Check the box and set a password (optional)" },
  { title: "Click Apply → OK", detail: "Save your settings" },
];

interface Props {
  children: React.ReactNode;
}

export function OBSConnectGate({ children }: Props) {
  const [, setStatus] = useState<ConnectionStatus>(obsService.status);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(getDefaultOBSUrl());
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [, setAutoConnectTried] = useState(false);
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const autoConnectRef = useRef(false);

  // Subscribe to OBS status changes
  useEffect(() => {
    const unsub = obsService.onStatusChange((s, err) => {
      setStatus(s);
      if (err) setError(err);
    });
    setStatus(obsService.status);

    // Listen for custom event to show connection panel
    const handleShowConnectPanel = () => {
      setShowConnectPanel(true);
    };

    window.addEventListener('showOBSConnectPanel', handleShowConnectPanel);

    return () => {
      unsub();
      window.removeEventListener('showOBSConnectPanel', handleShowConnectPanel);
    };
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnectRef.current) return;
    autoConnectRef.current = true;

    // Studio starts without probing OBS. OBS-selected and migrated installs
    // retain the previous automatic reconnect behavior.
    if (!shouldAutoConnectObs()) {
      setAutoConnectTried(true);
      return;
    }

    (async () => {
      try {
        const data = await loadData();
        const { url: savedUrl, password: savedPw, autoConnect } = data.obsWebSocket;

        if (savedUrl) setUrl(savedUrl);
        if (savedPw) setPassword(savedPw);

        if (autoConnect && savedUrl) {
          setConnecting(true);
          setError(null);
          try {
            await obsService.connect(savedUrl, savedPw || undefined);
            await updateData({
              obsWebSocket: { url: savedUrl, password: savedPw, autoConnect: true },
            });
          } catch {
            // Failed
          } finally {
            setConnecting(false);
          }
        }
      } catch {
        // Store read failed
      } finally {
        setAutoConnectTried(true);
      }
    })();
  }, []);

  const handleConnect = async () => {
    if (connecting) return;

    setConnecting(true);
    setError(null);

    try {
      await obsService.connect(url, password || undefined);
      await updateData({
        obsWebSocket: { url, password, autoConnect: true },
      });
      setShowConnectPanel(false);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err || "");
      if (/auth|password/i.test(rawMsg)) {
        setError("OBS authentication failed. Check your password in OBS → Tools → WebSocket Server Settings and confirm it aligns with MakeChurchEazy.");
      } else {
        setError("Failed to connect to OBS. Please check that OBS is running, open Tools → WebSocket Server Settings to confirm it is enabled on port 4455, and ensure credentials align with MakeChurchEazy.");
      }
    } finally {
      setConnecting(false);
    }
  };

  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleConnect();
    }
  };

  // Always render children
  return (
    <>
      {children}

      {/* Connection Modal */}
      <ModalDialog
        open={showConnectPanel}
        tone="brand"
        icon={<Cast size={26} />}
        title="Connect to OBS"
        onClose={() => setShowConnectPanel(false)}
        width={480}
        extra={
          <>
            <ModalPanel heading="Setup Instructions" maxHeight={200}>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {OBS_SETUP_STEPS.map((step) => (
                  <li key={step.title}>
                    <strong>{step.title}</strong>: {step.detail}
                  </li>
                ))}
              </ol>
            </ModalPanel>
            <div className="obs-field">
              <label htmlFor="obs-connect-url">Server URL</label>
              <input
                id="obs-connect-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="ws://localhost:4455"
              />
            </div>
            <div className="obs-field">
              <label htmlFor="obs-connect-password">Password</label>
              <input
                id="obs-connect-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Optional"
              />
            </div>
            {error && <ModalNotice tone="danger">{error}</ModalNotice>}
          </>
        }
        actions={[
          { label: "Cancel", variant: "ghost", onClick: () => setShowConnectPanel(false) },
          {
            label: connecting ? "Connecting..." : "Connect to OBS",
            variant: "primary",
            disabled: connecting,
            title: "Connect",
            onClick: () => void handleConnect(),
          },
        ]}
      >
        Enable WebSocket to control OBS remotely
      </ModalDialog>
    </>
  );
}
