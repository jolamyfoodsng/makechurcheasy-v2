import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Laptop,
  ArrowDownToLine,
  Crown,
  UploadCloud,
} from "./icons/NativeIcons";
import {
  fetchCloudSyncStatus,
  uploadSnapshotToCloud,
  getBackupFrequency,
  setBackupFrequency,
  isIncludeImagesEnabled,
  setIncludeImagesEnabled,
  isIncludeVideosEnabled,
  setIncludeVideosEnabled,
  type BackupFrequency,
  getSyncDeviceName,
  setSyncDeviceName,
  CLOUD_SYNC_STATUS_CHANGED_EVENT,
  type CloudSyncStatusInfo,
} from "../services/cloudSyncService";
import { useAuth } from "../contexts/AuthContext";
import { canUseCloudSync } from "../services/licenseService";
import { CloudSyncRestoreModal } from "./CloudSyncRestoreModal";

interface CloudSyncSettingsCardProps {
  onOpenUpgrade?: () => void;
}

export function CloudSyncSettingsCard({ onOpenUpgrade }: CloudSyncSettingsCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const hasEntitlement = canUseCloudSync(user);

  const [status, setStatus] = useState<CloudSyncStatusInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  // Form states
  const [frequency, setFrequency] = useState<BackupFrequency>(getBackupFrequency());
  const [includeImages, setIncludeImages] = useState(isIncludeImagesEnabled());
  const [includeVideos, setIncludeVideos] = useState(isIncludeVideosEnabled());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [deviceName, setDeviceName] = useState(getSyncDeviceName());
  const [editingDevice, setEditingDevice] = useState(false);

  const refreshStatus = () => {
    fetchCloudSyncStatus()
      .then((s) => setStatus(s))
      .catch(() => {});
  };

  useEffect(() => {
    refreshStatus();

    const handleUpdate = () => {
      refreshStatus();
      setFrequency(getBackupFrequency());
      setIncludeImages(isIncludeImagesEnabled());
      setIncludeVideos(isIncludeVideosEnabled());
      setDeviceName(getSyncDeviceName());
    };

    window.addEventListener(CLOUD_SYNC_STATUS_CHANGED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(CLOUD_SYNC_STATUS_CHANGED_EVENT, handleUpdate);
    };
  }, []);

  const handleManualBackup = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const result = await uploadSnapshotToCloud((done, total) => setProgress({ done, total }));
      const files = result.files;
      if (files?.storageFull) {
        setErrorMsg(t("cloudSync.storageFullMsg", "Your text backup is saved, but your cloud storage is full so some pictures or videos were not sent."));
      } else if (files && files.failed > 0) {
        setSuccessMsg(
          t("cloudSync.backupPartial", "Backup saved. {{count}} file(s) could not be sent and will be retried next time.", { count: files.failed }) +
            (files.firstError ? ` (${files.firstError})` : ""),
        );
      } else {
        setSuccessMsg(t("cloudSync.backupSuccess", "Backup uploaded to cloud successfully!"));
      }
      setTimeout(() => setSuccessMsg(null), 15000);
      refreshStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const handleFrequency = (next: BackupFrequency) => {
    setFrequency(next);
    setBackupFrequency(next);
  };

  const handleToggleImages = () => {
    const next = !includeImages;
    setIncludeImages(next);
    setIncludeImagesEnabled(next);
  };

  const handleToggleVideos = () => {
    const next = !includeVideos;
    setIncludeVideos(next);
    setIncludeVideosEnabled(next);
  };

  const handleSaveDeviceName = () => {
    setSyncDeviceName(deviceName);
    setEditingDevice(false);
  };

  // ── Render Free/Locked Tier Teaser ─────────────────────────────────────────
  if (!hasEntitlement) {
    return (
      <div
        className="settings-card fields-rows-stack"
        style={{
          marginBottom: "20px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div className="flex-between-center">
          <div className="switch-left" style={{ maxWidth: "680px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                }}
              >
                <Cloud size={18} />
              </div>
              <span className="switch-title" style={{ color: "var(--text-primary)", fontSize: "1.05rem", fontWeight: 700 }}>
                {t("cloudSync.lockedTitle", "Make Church Eazy Cloud Backup & Sync")}
              </span>
              <span
                style={{
                  background: "rgba(99, 102, 241, 0.2)",
                  color: "var(--accent-blue)",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(99, 102, 241, 0.35)",
                }}
              >
                BASIC & GROWTH
              </span>
            </div>
            <span className="switch-subtitle" style={{ color: "var(--text-secondary)", lineHeight: 1.5, fontSize: "0.875rem" }}>
              {t(
                "cloudSync.lockedDesc",
                "Log in on any computer and immediately restore your complete worship catalog, broadcast channels, stream keys, and preacher notes without copying files or credentials manually."
              )}
            </span>
          </div>

          <button
            type="button"
            className="action-btn btn-primary"
            onClick={onOpenUpgrade}
            style={{
              background: "var(--primary)",
              color: "#ffffff",
              padding: "0.6rem 1.25rem",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: "0.875rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 2px 10px rgba(79, 70, 229, 0.35)",
              flexShrink: 0,
            }}
          >
            <Crown size={15} />
            <span>{t("cloudSync.upgradeCta", "Upgrade to Basic")}</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Render Entitled/Paid Tier Management Card ──────────────────────────────
  const usedBytes = status?.storageUsedBytes ?? 0;
  const limitBytes = (status?.storageLimitGB ?? 5) * 1024 * 1024 * 1024;
  const percent = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  const formatSize = (bytes: number) =>
    bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const nextText = status?.nextBackupAt && frequency !== "off"
    ? new Date(status.nextBackupAt).getTime() <= Date.now()
      ? t("cloudSync.nextDue", "Next backup: due now")
      : t("cloudSync.nextAt", "Next backup: {{time}}", { time: new Date(status.nextBackupAt).toLocaleDateString() })
    : null;

  return (
    <>
      <div
        className="settings-card fields-rows-stack"
        style={{
          marginBottom: "20px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
        }}
      >
        {/* Card Header & Status */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            paddingBottom: "1.25rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(99, 102, 241, 0.15)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-blue)",
                flexShrink: 0,
              }}
            >
              <Cloud size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  {t("cloudSync.headerTitle", "Cloud Backup & Multi-Laptop Sync")}
                </h4>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(34, 197, 94, 0.12)",
                    color: "var(--success)",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 9999,
                    border: "1px solid rgba(34, 197, 94, 0.25)",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                  {t("cloudSync.activePill", "Cloud Connected")}
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.825rem", color: "var(--text-secondary)" }}>
                {status?.lastSyncedAt
                  ? t("cloudSync.lastSyncedText", "Last synced {{time}} from {{device}}", {
                      time: new Date(status.lastSyncedAt).toLocaleString(),
                      device: status.lastSyncedDevice || getSyncDeviceName(),
                    })
                  : t("cloudSync.neverSyncedText", "Ready to sync worship songs, broadcast profiles & notes")}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="action-btn"
              onClick={() => setShowRestoreModal(true)}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontSize: "0.85rem",
                fontWeight: 600,
                padding: "0.5rem 1rem",
                borderRadius: 7,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              <ArrowDownToLine size={15} />
              <span>{t("cloudSync.restoreBtn", "Restore from Cloud")}</span>
            </button>

            <button
              type="button"
              className="action-btn btn-primary"
              onClick={handleManualBackup}
              disabled={syncing || Boolean(status?.upToDate)}
              style={{
                background: "var(--primary)",
                border: "none",
                color: "#ffffff",
                fontSize: "0.85rem",
                fontWeight: 600,
                padding: "0.5rem 1.15rem",
                borderRadius: 7,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: syncing || status?.upToDate ? "not-allowed" : "pointer",
                opacity: status?.upToDate && !syncing ? 0.6 : 1,
              }}
            >
              {syncing ? (
                <>
                  <RefreshCw size={15} className="spin-animation" />
                  <span>{t("cloudSync.syncingBtn", "Backing Up...")}</span>
                </>
              ) : (
                status?.upToDate ? (
                  <>
                    <CheckCircle size={15} />
                    <span>{t("cloudSync.upToDateBtn", "Everything is backed up")}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={15} />
                    <span>{t("cloudSync.backupNowBtn", "Backup to Cloud Now")}</span>
                  </>
                )
              )}
            </button>
          </div>
        </div>

        {/* Feedback Alerts */}
        {successMsg && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "rgba(34, 197, 94, 0.12)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: 8,
              color: "var(--success)",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <CheckCircle size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 8,
              color: "var(--error)",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Preferences Grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.5rem" }}>
          {/* Row 1: How often to back up */}
          <div className="flex-between-center">
            <div className="switch-left">
              <span className="switch-title" style={{ fontSize: "0.9rem" }}>
                {t("cloudSync.frequencyTitle", "Automatic backup")}
              </span>
              <span className="switch-subtitle" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {t("cloudSync.frequencyDesc", "Back up your songs, notes, graphics and settings to the cloud on a schedule.")}
                {nextText && (
                  <span style={{ display: "block", marginTop: "3px", color: "var(--accent-blue)", fontSize: "0.75rem" }}>{nextText}</span>
                )}
              </span>
            </div>
            <select
              value={frequency}
              onChange={(e) => handleFrequency(e.target.value as BackupFrequency)}
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: 6,
                color: "var(--text-primary)",
                padding: "6px 10px",
                fontSize: "0.85rem",
              }}
            >
              <option value="off">{t("cloudSync.freqOff", "Off")}</option>
              <option value="daily">{t("cloudSync.freqDaily", "Daily")}</option>
              <option value="weekly">{t("cloudSync.freqWeekly", "Weekly")}</option>
              <option value="monthly">{t("cloudSync.freqMonthly", "Monthly")}</option>
            </select>
          </div>

          {/* Row 2: Pictures */}
          <div className="flex-between-center">
            <div className="switch-left">
              <span className="switch-title" style={{ fontSize: "0.9rem" }}>
                {t("cloudSync.includeImagesTitle", "Include pictures")}
              </span>
              <span className="switch-subtitle" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {t("cloudSync.includeImagesDesc", "Logos and images from your media library and saved graphics.")}
              </span>
            </div>
            <label className="theme-toggle-switch" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={includeImages} onChange={handleToggleImages} />
              <span className="theme-toggle-slider" />
            </label>
          </div>

          {/* Row 2b: Videos */}
          <div className="flex-between-center">
            <div className="switch-left">
              <span className="switch-title" style={{ fontSize: "0.9rem" }}>
                {t("cloudSync.includeVideosTitle", "Include videos")}
              </span>
              <span className="switch-subtitle" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {t("cloudSync.includeVideosDesc", "Videos are large and use your cloud storage quickly, so they are off by default.")}
              </span>
            </div>
            <label className="theme-toggle-switch" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={includeVideos} onChange={handleToggleVideos} />
              <span className="theme-toggle-slider" />
            </label>
          </div>

          {/* Storage used */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 6 }}>
              <span>{t("cloudSync.storageTitle", "Cloud storage")}</span>
              <span>{formatSize(usedBytes)} / {formatSize(limitBytes)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 9999, background: "var(--surface-raised)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: percent >= 100 ? "#ef4444" : percent >= 80 ? "#f59e0b" : "#6366f1",
                  transition: "width 0.3s",
                }}
              />
            </div>
            {progress && progress.total > 0 && (
              <span style={{ display: "block", marginTop: 6, fontSize: "0.75rem", color: "var(--accent-blue)" }}>
                {t("cloudSync.sendingFiles", "Sending files {{done}} of {{total}}", progress)}
              </span>
            )}
          </div>

          {/* Row 3: Device Name / Machine Identifier */}
          <div className="flex-between-center" style={{ paddingTop: "0.25rem" }}>
            <div className="switch-left">
              <span className="switch-title" style={{ fontSize: "0.9rem" }}>
                {t("cloudSync.deviceNameTitle", "Current Laptop / PC Name")}
              </span>
              <span className="switch-subtitle" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {t("cloudSync.deviceNameDesc", "Distinguish which computer created each cloud backup.")}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {editingDevice ? (
                <>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    style={{
                      background: "var(--input-bg)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      padding: "4px 10px",
                      fontSize: "0.85rem",
                    }}
                  />
                  <button
                    type="button"
                    className="action-btn"
                    onClick={handleSaveDeviceName}
                    style={{ padding: "4px 12px", fontSize: "0.8rem", fontWeight: 600 }}
                  >
                    Save
                  </button>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "0.85rem",
                      color: "var(--text-primary)",
                      background: "var(--surface-raised)",
                      padding: "4px 10px",
                      borderRadius: 6,
                    }}
                  >
                    <Laptop size={14} style={{ color: "var(--accent-blue)" }} />
                    {deviceName}
                  </span>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setEditingDevice(true)}
                    style={{
                      padding: "4px 10px",
                      fontSize: "0.775rem",
                      background: "transparent",
                      border: "none",
                      color: "var(--accent-blue)",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Rename
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <CloudSyncRestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        onRestored={() => refreshStatus()}
      />
    </>
  );
}
