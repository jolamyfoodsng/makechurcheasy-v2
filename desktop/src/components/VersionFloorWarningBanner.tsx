/**
 * VersionFloorWarningBanner.tsx — Non-blocking countdown banner for version floor grace period
 *
 * Displayed at the top of the screen when the app version is below the
 * admin-configured minimum but the grace period has not yet expired.
 *
 * The countdown is driven by startedAt + gracePeriodHours stored in
 * localStorage, so it continues offline.
 *
 * After the grace period expires, the parent (App.tsx) renders the
 * hard-blocking version floor lock screen instead.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Icon from "./Icon";

interface VersionFloorWarningBannerProps {
  currentVersion: string;
  minimumVersion: string;
  startedAt: string;
  gracePeriodHours: number;
  onUpdate: () => void;
  onDismiss: () => void;
  updateStatus?: "idle" | "checking" | "downloading" | "installing" | "relaunching" | "error";
}

function computeHoursRemaining(startedAt: string, gracePeriodHours: number): number {
  const startMs = new Date(startedAt).getTime();
  const endMs = startMs + gracePeriodHours * 60 * 60 * 1000;
  return Math.max(0, (endMs - Date.now()) / (60 * 60 * 1000));
}

function formatCountdownPrecise(hours: number, t: (key: string, opts?: any) => string): string {
  if (hours <= 0) return t("versionFloor.grace.expired");
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return h > 0
      ? t("versionFloor.grace.daysHours", { days: d, hours: h })
      : t("versionFloor.grace.days", { count: d });
  }
  if (hours >= 1) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return t("versionFloor.grace.hoursMinutes", { hours: h, minutes: m });
  }
  const m = Math.round(hours * 60);
  return t("versionFloor.grace.minutes", { count: m });
}

export default function VersionFloorWarningBanner({
  currentVersion,
  minimumVersion,
  startedAt,
  gracePeriodHours,
  onUpdate,
  onDismiss,
  updateStatus = "idle",
}: VersionFloorWarningBannerProps) {
  const { t } = useTranslation();
  const [hoursRemaining, setHoursRemaining] = useState(() =>
    computeHoursRemaining(startedAt, gracePeriodHours)
  );

  // Tick every 30 seconds for live countdown
  useEffect(() => {
    const id = window.setInterval(() => {
      setHoursRemaining(computeHoursRemaining(startedAt, gracePeriodHours));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [startedAt, gracePeriodHours]);

  const countdownText = formatCountdownPrecise(hoursRemaining, t);
  const isUrgent = hoursRemaining <= 1;
  const isWarning = hoursRemaining <= 24;

  const bgColor = isUrgent
    ? "var(--error)"
    : isWarning
      ? "var(--warning)"
      : "var(--primary)";

  return (
    <div
      className="version-floor-warning-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99998,
        background: bgColor,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 2px 12px rgba(0, 0, 0, 0.3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <Icon name="warning" size={16} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {t("versionFloor.grace.message", {
            currentVersion,
            minimumVersion,
            countdown: countdownText,
          })}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
        <button
          onClick={onUpdate}
          disabled={updateStatus !== "idle" && updateStatus !== "error"}
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "none",
            borderRadius: 4,
            color: bgColor,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: updateStatus === "idle" || updateStatus === "error" ? "pointer" : "default",
            opacity: updateStatus !== "idle" && updateStatus !== "error" ? 0.7 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {updateStatus === "checking" && t("versionFloor.grace.checking")}
          {updateStatus === "downloading" && t("versionFloor.grace.downloading")}
          {(updateStatus === "installing" || updateStatus === "relaunching") &&
            t("versionFloor.grace.installing")}
          {(updateStatus === "idle" || updateStatus === "error") &&
            t("versionFloor.grace.updateNow")}
        </button>
        <button
          onClick={onDismiss}
          style={{
            background: "rgba(255, 255, 255, 0.2)",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title={t("versionFloor.grace.dismiss")}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
