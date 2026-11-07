import Icon from "./Icon";
/**
 * LiveStatusBar.tsx — Global application health center
 *
 * Persistent status bar below the app header, above page content.
 * Every long-running service registers itself here via status pills.
 * Works across all pages (Dashboard, Bible, Worship, Themes, etc.).
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { obsService, type ConnectionStatus } from "../services/obsService";
import { lmDockService, type LmDockSnapshot } from "../services/lmDockService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusItem {
  id: string;
  icon: string;
  label: string;
  color: string;         // CSS color value
  bgColor: string;       // RGBA background
  borderColor: string;   // RGBA border
  animate?: "pulse" | "glow" | "none";
  navigateTo?: string;   // Route path when pill is clicked
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const COLORS = {
  green: { color: "var(--success)", bgColor: "rgba(var(--success-rgb), 0.1)", borderColor: "rgba(var(--success-rgb), 0.25)" },
  red: { color: "var(--error)", bgColor: "rgba(var(--error-rgb), 0.1)", borderColor: "rgba(var(--error-rgb), 0.25)" },
  purple: { color: "#A855F7", bgColor: "rgba(168, 85, 247, 0.1)", borderColor: "rgba(168, 85, 247, 0.25)" },
  blue: { color: "#3B82F6", bgColor: "rgba(59, 130, 246, 0.1)", borderColor: "rgba(59, 130, 246, 0.25)" },
  orange: { color: "var(--warning)", bgColor: "rgba(245, 158, 11, 0.1)", borderColor: "rgba(245, 158, 11, 0.25)" },
  gray: { color: "var(--text-muted)", bgColor: "rgba(128, 128, 128, 0.08)", borderColor: "rgba(128, 128, 128, 0.2)" },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LiveStatusBar({ inline = false }: { inline?: boolean } = {}) {
  const navigate = useNavigate();

  const [obsStatus, setObsStatus] = useState<ConnectionStatus>(obsService.status);
  const [lmSnapshot, setLmSnapshot] = useState<LmDockSnapshot | null>(null);

  // ── Subscribe to services ──
  useEffect(() => {
    setObsStatus(obsService.status);
    const unsubObs = obsService.onStatusChange((status) => setObsStatus(status));

    const unsubLm = lmDockService.subscribe((snap) => setLmSnapshot(snap));

    return () => {
      unsubObs();
      unsubLm();
    };
  }, []);

  // ── Build status items ──
  const items: StatusItem[] = [];

  // OBS Connection
  if (obsStatus === "connected") {
    items.push({
      id: "obs",
      icon: "check_circle",
      label: "OBS Connected",
      ...COLORS.green,
      animate: "pulse",
      navigateTo: "/settings?tab=obs",
    });
  } else if (obsStatus === "connecting") {
    items.push({
      id: "obs",
      icon: "sync",
      label: "OBS Connecting",
      ...COLORS.orange,
      animate: "glow",
      navigateTo: "/settings?tab=obs",
    });
  } else if (obsStatus === "error") {
    items.push({
      id: "obs",
      icon: "error",
      label: "OBS Error",
      ...COLORS.red,
      navigateTo: "/settings?tab=obs",
    });
  }

  // Speech to Scripture
  if (lmSnapshot) {
    const { status } = lmSnapshot;

    if (status === "listening") {
      items.push({
        id: "listening",
        icon: "mic",
        label: "Listening",
        ...COLORS.purple,
        animate: "pulse",
        navigateTo: "/speech-to-scripture",
      });
    } else if (status === "connecting") {
      items.push({
        id: "listening",
        icon: "mic",
        label: "Connecting…",
        ...COLORS.purple,
        animate: "glow",
        navigateTo: "/speech-to-scripture",
      });
    } else if (status === "requesting-mic") {
      items.push({
        id: "listening",
        icon: "mic",
        label: "Requesting Mic…",
        ...COLORS.orange,
        navigateTo: "/speech-to-scripture",
      });
    } else if (status === "error") {
      items.push({
        id: "listening",
        icon: "mic",
        label: "Mic Error",
        ...COLORS.red,
        navigateTo: "/speech-to-scripture",
      });
    }

    // Current scripture (from latest candidate) — updates live as detections come in
    const latestCandidate = lmSnapshot.candidates.length > 0
      ? lmSnapshot.candidates[lmSnapshot.candidates.length - 1]
      : undefined;

    if (status === "listening") {
      if (latestCandidate?.label) {
        items.push({
          id: "scripture",
          icon: "menu_book",
          label: latestCandidate.label,
          ...COLORS.orange,
          navigateTo: "/speech-to-scripture",
        });
      } else {
        // Show live interim transcript text while speaking
        const lastEntry = lmSnapshot.entries.length > 0
          ? lmSnapshot.entries[lmSnapshot.entries.length - 1]
          : undefined;
        const interimText = lastEntry && !lastEntry.finalized && lastEntry.text.trim()
          ? lastEntry.text.trim()
          : null;
        if (interimText) {
          items.push({
            id: "transcript",
            icon: "mic",
            label: interimText.length > 40 ? `${interimText.slice(0, 38)}…` : interimText,
            ...COLORS.blue,
            navigateTo: "/speech-to-scripture",
          });
        }
      }
    }
  }

  // ── Handle pill click ──
  const handlePillClick = useCallback(
    (path?: string) => {
      if (path) navigate(path);
    },
    [navigate],
  );

  // Hide bar when only OBS connected (no other active services)
  if (items.length === 0 || (items.length === 1 && items[0].id === "obs" && obsStatus === "disconnected")) {
    return null;
  }

  const pills = items.map((item) => (
    <button
      key={item.id}
      className={`live-status-pill${item.animate === "pulse" ? " live-status-pill--pulse" : ""}${item.animate === "glow" ? " live-status-pill--glow" : ""}`}
      style={{
        color: item.color,
        background: item.bgColor,
        borderColor: item.borderColor,
      }}
      onClick={() => handlePillClick(item.navigateTo)}
      title={item.label}
    >
      <Icon name={item.icon} size={14} className="live-status-pill__icon" />
      <span className="live-status-pill__label">{item.label}</span>
    </button>
  ));

  // Inline: just the pills, for the left side of the top status strip.
  if (inline) return <div className="live-status-bar__inner live-status-bar__inner--inline">{pills}</div>;

  return (
    <div className="live-status-bar">
      <div className="live-status-bar__inner">{pills}</div>
    </div>
  );
}
