/**
 * ServiceGateModal.tsx — Prompts users to start a service before sending content
 *
 * Displayed when a user tries to send Bible verses, worship lyrics,
 * lower thirds, or any content to OBS without an active service.
 * Offers a quick "Start Service" button that opens the StartServiceModal.
 */

import { useCallback } from "react";
import Icon from "./Icon";

interface ServiceGateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when user clicks "Start Service" — parent should open the StartServiceModal */
  onStartService: () => void;
  /** Optional: what the user was trying to do (shown in the message) */
  action?: string;
}

export function ServiceGateModal({ open, onClose, onStartService, action }: ServiceGateModalProps) {
  const handleStart = useCallback(() => {
    onClose();
    onStartService();
  }, [onClose, onStartService]);

  if (!open) return null;

  return (
    <div className="ssm-backdrop" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="ssm-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440, padding: 0 }}
      >
        {/* Header */}
        <div style={{
          padding: "24px 24px 0",
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(0,230,118,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <Icon name="play_circle_outline" size={24} style={{ color: "var(--success)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.3,
            }}>
              Start a Service First
            </h2>
            <p style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}>
              {action
                ? `You need to start a service before you can ${action}. Starting a service lets you configure your OBS scenes and track statistics.`
                : "You need to start a service before sending content to OBS. Starting a service lets you configure your OBS scenes and track statistics."
              }
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              display: "flex",
            }}
           title="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: "20px 24px",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
           title="Cancel">
            Cancel
          </button>
          <button
            onClick={handleStart}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "#00E676",
              color: "#000",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
           title="Start service">
            <Icon name="play_arrow" size={16} />
            Start Service
          </button>
        </div>
      </div>
    </div>
  );
}

export default ServiceGateModal;
