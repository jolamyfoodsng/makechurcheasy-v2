/**
 * DevModalsGalleryPage.tsx — Modals & Announcements Design Gallery
 *
 * EXCLUSIVE TO LOCAL DEVELOPMENT FOR ADMINS (NEVER INCLUDED OR ACCESSIBLE IN PROD).
 * Provides an interactive testbed to trigger, preview, and verify all dialogs,
 * confirmations, paywalls, updates, and promotional announcements in MakeChurchEazy.
 */

import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import {
  FlaskConical,
  Globe,
  Crown,
  Zap,
  CloudDownload,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Tag,
  Clock,
  Eye,
  Lock,
  X,
  Undo,
  RotateCcw,
  Trash2,
  Monitor,
  Bell,
  Download,
  ShieldAlert,
  Flame,
  HelpCircle,
} from "../components/icons/NativeIcons";
import { INTERFACE_LOCALES } from "../i18n/localeCatalog";
import { getInterfaceLanguageLabel } from "../services/interfaceLanguage";
import { UpgradeModal } from "../components/UpgradeModal";
import ForceUpdateModal from "../components/ForceUpdateModal";
import TrialModal from "../components/TrialModal";
import DockPresentationLinkModal from "../dock/components/DockPresentationLinkModal";
import type { DesktopAnnouncement, DiscountBillingCycle } from "../services/announcementService";
import ModalDialog, { ModalFacts, ModalProgress } from "../components/ModalDialog";
import { AnnouncementDialog } from "../components/AnnouncementModalHost";
import UpdateReleaseNotes from "../components/UpdateReleaseNotes";
import PlanLimitModal from "../components/PlanLimitModal";
import "./dev-modals.css";

// ── Sample Data for Live Previews ──────────────────────────────────────────

const SAMPLE_UPDATE_INFO = {
  available: true,
  version: "3.31.0",
  currentVersion: "3.30.0",
  latestVersion: "3.31.0",
  notes: "- Songs keep their line breaks when you import from EasyWorship\n- The Dock reconnects to OBS faster after a restart\n- Fixed: Bible verses could show twice on the second screen",
  releaseNotes: "- Songs keep their line breaks when you import from EasyWorship\n- The Dock reconnects to OBS faster after a restart\n- Fixed: Bible verses could show twice on the second screen",
  mandatory: false,
  releaseDate: new Date().toISOString(),
  downloadUrl: "https://makechurcheazy.com/downloads",
};

const SAMPLE_ANNOUNCEMENTS: Record<string, DesktopAnnouncement> = {
  blackFriday: {
    id: "promo-black-friday-preview",
    deliveryId: "del-bf-preview",
    title: "Annual Ministry Celebration Sale!",
    message: "Get 40% OFF the MakeChurchEazy Growth Plan for your entire media team. Includes unlimited AI transcription, 4K multi-screen dock, and priority support.",
    tone: "offer",
    tags: ["promo", "growth"],
    ctaLabel: "Claim 40% Discount",
    ctaUrl: "https://makechurcheazy.com/subscription/plans?promo=CELEBRATE40",
    offerCode: "CELEBRATE40",
    offerDiscountPercent: 40,
    expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(),
    offerApplicablePlans: ["growth"],
    offerApplicableBillingCycles: ["monthly", "yearly"],
  },
  newFeature: {
    id: "feature-verse-ai-preview",
    deliveryId: "del-verse-ai-preview",
    title: "Introducing Speech-to-Scripture 2.0",
    message: "Experience near-instant offline Bible verse detection as pastors speak. Automatic citation overlays and zero cloud lag.",
    tone: "success",
    layout: "standard",
    tags: ["feature", "speech"],
    ctaLabel: "Explore Features",
    ctaUrl: "https://makechurcheazy.com/features",
  },
  maintenance: {
    id: "system-notice-preview",
    deliveryId: "del-maintenance-preview",
    title: "Scheduled Cloud Sync Maintenance",
    message: "Cloud song backup and online sync will undergo scheduled maintenance this Sunday between 02:00 UTC and 04:00 UTC. Local dock & OBS features will continue working uninterrupted.",
    tone: "warning",
    layout: "standard",
    tags: ["maintenance", "system"],
    ctaLabel: "View Status Page",
    ctaUrl: "https://status.makechurcheazy.com",
  },
};

type ActiveModalId =
  | null
  | "language"
  | "announcement_offer"
  | "announcement_feature"
  | "announcement_warning"
  | "upgrade_growth"
  | "upgrade_mobile"
  | "trial_welcome"
  | "trial_expired"
  | "update_optional"
  | "update_force"
  | "update_bg_notice"
  | "update_close_warning"
  | "plan_limit"
  | "confirm_reset_canvas"
  | "confirm_undo"
  | "confirm_delete"
  | "confirm_replace_slot"
  | "confirm_live_scene"
  | "dock_presentation_link"
  | "shortcuts";

export default function DevModalsGalleryPage() {
  // ── Absolute Safety Gate: Local dev environment ONLY ──
  if (!import.meta.env.DEV) {
    return <Navigate to="/" replace />;
  }

  const [activeModal, setActiveModal] = useState<ActiveModalId>(null);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState("ak");
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "system" | "announcements" | "updates" | "plans" | "studio">("all");
  const [previewCycle, setPreviewCycle] = useState<DiscountBillingCycle | null>(null);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeModal) {
        setActiveModal(null);
        setLastAction("Closed via ESC key");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal]);

  const handleAction = (msg: string) => {
    setLastAction(msg);
    setActiveModal(null);
  };

  return (
    <div className="dev-modals-page">
      {/* Top Banner */}
      <header className="dev-modals-header">
        <div className="dev-modals-header__top">
          <span className="dev-modals-badge">
            <FlaskConical size={14} />
            LOCAL DEV ADMIN ONLY
          </span>
          <span className="dev-modals-scope-tag">
            Never visible in production
          </span>
        </div>
        <h1 className="dev-modals-title">Modals & Announcements Gallery</h1>
        <p className="dev-modals-subtitle">
          Interactive testbench to preview, test keyboard shortcuts (ESC), and audit the visual design of every dialog and announcement banner across MakeChurchEazy.
        </p>

        {lastAction && (
          <div className="dev-modals-toast" role="status">
            <CheckCircle size={15} />
            <span>Last trigger result: <strong>{lastAction}</strong></span>
            <button type="button" onClick={() => setLastAction(null)}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Tab Filters */}
        <div className="dev-modals-filter-tabs">
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "all" ? " is-active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All Modals
          </button>
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "system" ? " is-active" : ""}`}
            onClick={() => setActiveTab("system")}
          >
            System & Language
          </button>
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "announcements" ? " is-active" : ""}`}
            onClick={() => setActiveTab("announcements")}
          >
            Announcements & Offers
          </button>
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "updates" ? " is-active" : ""}`}
            onClick={() => setActiveTab("updates")}
          >
            App Updates
          </button>
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "plans" ? " is-active" : ""}`}
            onClick={() => setActiveTab("plans")}
          >
            Plans, Trials & Paywalls
          </button>
          <button
            type="button"
            className={`dev-filter-tab${activeTab === "studio" ? " is-active" : ""}`}
            onClick={() => setActiveTab("studio")}
          >
            Studio & Confirmations
          </button>
        </div>
      </header>

      {/* Grid of Preview Cards */}
      <div className="dev-modals-grid">
        {/* 1. Language Change Modal */}
        {(activeTab === "all" || activeTab === "system") && (
          <article className="dev-modal-card dev-modal-card--highlight">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <Globe size={20} />
              </span>
              <span className="dev-card-category">Settings Dialog</span>
            </div>
            <h3>Change Language Confirmation</h3>
            <p>
              The redesigned confirmation dialog triggered when selecting a new language in Settings &gt; General. Features a glowing Globe icon, backdrop blur, and modern dark design.
            </p>
            <div className="dev-modal-card__config">
              <label>Test language target:</label>
              <select
                value={selectedLanguageCode}
                onChange={(e) => setSelectedLanguageCode(e.target.value)}
                className="dev-modal-select"
              >
                {INTERFACE_LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName} ({l.code})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="dev-launch-btn dev-launch-btn--primary"
              onClick={() => setActiveModal("language")}
            >
              <Eye size={16} />
              Preview Redesigned Modal
            </button>
          </article>
        )}

        {/* 2. Announcement - Offer Promo */}
        {(activeTab === "all" || activeTab === "announcements") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--amber">
                <Tag size={20} />
              </span>
              <span className="dev-card-category">Promotional Banner</span>
            </div>
            <h3>Special Offer Announcement</h3>
            <p>
              Server-delivered promotional announcement with a discount badge (-40%), countdown timer, coupon code with one-click copy, and upgrade CTA.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("announcement_offer")}
            >
              <Eye size={16} />
              Preview Offer Announcement
            </button>
          </article>
        )}

        {/* 3. Announcement - New Feature */}
        {(activeTab === "all" || activeTab === "announcements") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--emerald">
                <Zap size={20} />
              </span>
              <span className="dev-card-category">Product Update</span>
            </div>
            <h3>Feature Announcement</h3>
            <p>
              Product update announcement broadcast to desktop users announcing new capabilities (e.g. Speech-to-Scripture 2.0).
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("announcement_feature")}
            >
              <Eye size={16} />
              Preview Feature Notice
            </button>
          </article>
        )}

        {/* 4. Announcement - System Warning */}
        {(activeTab === "all" || activeTab === "announcements") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--red">
                <AlertTriangle size={20} />
              </span>
              <span className="dev-card-category">System Advisory</span>
            </div>
            <h3>Maintenance / Warning Notice</h3>
            <p>
              Warning/advisory announcement modal notifying production teams about upcoming cloud maintenance or network alerts.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("announcement_warning")}
            >
              <Eye size={16} />
              Preview Warning Notice
            </button>
          </article>
        )}

        {/* 5. Optional Update Dialog */}
        {(activeTab === "all" || activeTab === "updates") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <RefreshCw size={20} />
              </span>
              <span className="dev-card-category">Software Lifecycle</span>
            </div>
            <h3>Optional App Update Dialog</h3>
            <p>
              Shows when a new release is detected. Displays current version, new version, release notes, &quot;Update Now&quot;, and &quot;Remind Me Later&quot;.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("update_optional")}
            >
              <Eye size={16} />
              Preview Update Dialog
            </button>
          </article>
        )}

        {/* 6. Mandatory Force Update */}
        {(activeTab === "all" || activeTab === "updates") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--red">
                <Lock size={20} />
              </span>
              <span className="dev-card-category">Security Gate</span>
            </div>
            <h3>Mandatory Force Update</h3>
            <p>
              Locked modal displayed when the app version is too old to safely communicate with the server. Unclosable until updated.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("update_force")}
            >
              <Eye size={16} />
              Preview Force Update
            </button>
          </article>
        )}

        {/* 7. Background Update Download Notice */}
        {(activeTab === "all" || activeTab === "updates") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <Bell size={20} />
              </span>
              <span className="dev-card-category">Background Task</span>
            </div>
            <h3>Update Downloading in Background</h3>
            <p>
              Modal notifying the user that the installer is downloading in the background while they continue using the software.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("update_bg_notice")}
            >
              <Eye size={16} />
              Preview Background Notice
            </button>
          </article>
        )}

        {/* 8. Update Close Warning */}
        {(activeTab === "all" || activeTab === "updates") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--amber">
                <ShieldAlert size={20} />
              </span>
              <span className="dev-card-category">App Exit Guard</span>
            </div>
            <h3>Close App Update Warning</h3>
            <p>
              Modal warning when user attempts to quit MakeChurchEazy while an update download is actively writing to disk.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("update_close_warning")}
            >
              <Eye size={16} />
              Preview Close Warning
            </button>
          </article>
        )}

        {/* Plan limit (graphics / themes) */}
        {(activeTab === "all" || activeTab === "plans") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--amber">
                <Lock size={20} />
              </span>
              <span className="dev-card-category">Plan Limit</span>
            </div>
            <h3>Free Plan Limit Reached</h3>
            <p>
              Shown when a Free church adds a 4th broadcast graphic or creates a 3rd custom theme. The button opens the subscription plans page.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("plan_limit")}
            >
              <Eye size={16} />
              Preview Plan Limit
            </button>
          </article>
        )}

        {/* 9. Trial Welcome Modal */}
        {(activeTab === "all" || activeTab === "plans") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--amber">
                <Flame size={20} />
              </span>
              <span className="dev-card-category">Onboarding</span>
            </div>
            <h3>Trial Welcome Celebration</h3>
            <p>
              Warm welcome modal for new churches entering their 14-day free trial of Growth plan features.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("trial_welcome")}
            >
              <Eye size={16} />
              Preview Trial Welcome
            </button>
          </article>
        )}

        {/* 10. Trial Expired Upgrade */}
        {(activeTab === "all" || activeTab === "plans") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--red">
                <Clock size={20} />
              </span>
              <span className="dev-card-category">Paywall</span>
            </div>
            <h3>Trial Expired Paywall</h3>
            <p>
              Shows when 14-day trial concludes, detailing Pro vs Growth plans and direct checkout options.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("trial_expired")}
            >
              <Eye size={16} />
              Preview Trial Expired Modal
            </button>
          </article>
        )}

        {/* 11. Feature Upgrade Gate */}
        {(activeTab === "all" || activeTab === "plans") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <Crown size={20} />
              </span>
              <span className="dev-card-category">Paywall</span>
            </div>
            <h3>Feature Gate Upgrade Modal</h3>
            <p>
              Modal triggered when clicking a feature locked to Growth (e.g. Mobile Remote, 4K Multiview, Unlimited AI).
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("upgrade_growth")}
            >
              <Eye size={16} />
              Preview Upgrade Modal
            </button>
          </article>
        )}

        {/* 12. OBS Presentation Link Modal */}
        {(activeTab === "all" || activeTab === "system") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--emerald">
                <Monitor size={20} />
              </span>
              <span className="dev-card-category">OBS Integration</span>
            </div>
            <h3>Free Plan Presentation Setup</h3>
            <p>
              Dialog explaining how Free plan users can easily configure OBS Browser Source without native WebSocket controls.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("dock_presentation_link")}
            >
              <Eye size={16} />
              Preview Link Modal
            </button>
          </article>
        )}

        {/* 13. Studio - Reset Canvas */}
        {(activeTab === "all" || activeTab === "studio") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--amber">
                <RotateCcw size={20} />
              </span>
              <span className="dev-card-category">Studio Confirmation</span>
            </div>
            <h3>Reset Canvas Confirmation</h3>
            <p>
              Confirmation dialog shown in Multiview / Canvas when wiping layout regions to starting defaults.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("confirm_reset_canvas")}
            >
              <Eye size={16} />
              Preview Reset Modal
            </button>
          </article>
        )}

        {/* 14. Studio - Delete Confirmation */}
        {(activeTab === "all" || activeTab === "studio") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--red">
                <Trash2 size={20} />
              </span>
              <span className="dev-card-category">Destructive Action</span>
            </div>
            <h3>Delete Theme / Scene Modal</h3>
            <p>
              Destructive confirmation dialog warning user before permanently removing custom scene templates or theme assets.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("confirm_delete")}
            >
              <Eye size={16} />
              Preview Delete Modal
            </button>
          </article>
        )}

        {/* 15. Studio - Undo Confirmation */}
        {(activeTab === "all" || activeTab === "studio") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <Undo size={20} />
              </span>
              <span className="dev-card-category">Studio Action</span>
            </div>
            <h3>Undo Changes Confirmation</h3>
            <p>
              Confirms restoring an unpushed scene back to its active OBS state, discarding local edits.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("confirm_undo")}
            >
              <Eye size={16} />
              Preview Undo Modal
            </button>
          </article>
        )}

        {/* 16. Studio - Keyboard Shortcuts */}
        {(activeTab === "all" || activeTab === "studio") && (
          <article className="dev-modal-card">
            <div className="dev-modal-card__header">
              <span className="dev-card-icon dev-card-icon--indigo">
                <HelpCircle size={20} />
              </span>
              <span className="dev-card-category">Reference</span>
            </div>
            <h3>Keyboard Shortcuts Modal</h3>
            <p>
              Shows full list of keyboard hotkeys for live switching, slide navigation, and audio/scene controls.
            </p>
            <button
              type="button"
              className="dev-launch-btn"
              onClick={() => setActiveModal("shortcuts")}
            >
              <Eye size={16} />
              Preview Shortcuts
            </button>
          </article>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          LIVE MODAL PREVIEWS (MOUNTED CONDITIONALLY)
          ══════════════════════════════════════════════════════════════════════ */}

      {/* 1. Language Change Confirmation */}
      <ModalDialog
        open={activeModal === "language"}
        tone="brand"
        icon={<Globe size={26} />}
        title="Change Language"
        onClose={() => handleAction("Cancelled Language Modal")}
        hint="The interface will update immediately."
        actions={[
          { label: "Cancel", variant: "ghost", onClick: () => handleAction("Cancelled Language Change") },
          { label: "Change Language", variant: "primary", onClick: () => handleAction(`Confirmed language: ${getInterfaceLanguageLabel(selectedLanguageCode)}`) },
        ]}
      >
        Switch interface language to <strong>{getInterfaceLanguageLabel(selectedLanguageCode)}</strong>?
      </ModalDialog>

      {/* 2-4. Announcements: the same dialog churches see (components/AnnouncementModalHost.tsx) */}
      {activeModal === "announcement_offer" && (
        <AnnouncementDialog
          announcement={SAMPLE_ANNOUNCEMENTS.blackFriday}
          countdown="2d 14h 05m"
          selectedCycle={previewCycle}
          onSelectCycle={setPreviewCycle}
          onClose={() => handleAction("Closed Offer Announcement")}
          onLater={() => handleAction("Maybe Later clicked")}
          onOpenAction={(cycle) => handleAction(`Claim Offer Clicked (${cycle ?? "default"})`)}
          onOpenButton={(button) => handleAction(`Clicked ${button.label}`)}
        />
      )}

      {activeModal === "announcement_feature" && (
        <AnnouncementDialog
          announcement={SAMPLE_ANNOUNCEMENTS.newFeature}
          selectedCycle={null}
          onSelectCycle={() => undefined}
          onClose={() => handleAction("Closed Feature Announcement")}
          onLater={() => handleAction("Later clicked")}
          onOpenAction={() => handleAction("Opened feature")}
          onOpenButton={(button) => handleAction(`Clicked ${button.label}`)}
        />
      )}

      {activeModal === "announcement_warning" && (
        <AnnouncementDialog
          announcement={SAMPLE_ANNOUNCEMENTS.maintenance}
          selectedCycle={null}
          onSelectCycle={() => undefined}
          onClose={() => handleAction("Closed Warning Notice")}
          onLater={() => handleAction("Dismissed Warning")}
          onOpenAction={() => handleAction("Status Page Clicked")}
          onOpenButton={(button) => handleAction(`Clicked ${button.label}`)}
        />
      )}

      {/* 5. Optional Update Dialog (same layout as components/UpdateNotification.tsx) */}
      <ModalDialog
        open={activeModal === "update_optional"}
        tone="brand"
        icon={<Download size={26} />}
        eyebrow="Update available"
        title={`MakeChurchEazy ${SAMPLE_UPDATE_INFO.version} is available`}
        onClose={() => handleAction("Remind Me Later")}
        closeOnBackdrop={false}
        width={560}
        extra={<UpdateReleaseNotes version={SAMPLE_UPDATE_INFO.version} notes={SAMPLE_UPDATE_INFO.notes} />}
        actions={[
          { label: "Remind me later", variant: "ghost", onClick: () => handleAction("Remind Me Later") },
          { label: "Update in background", variant: "ghost", onClick: () => handleAction("Started Background Update") },
          { label: "Update now", variant: "primary", autoFocus: true, onClick: () => handleAction("Started Update Download") },
        ]}
      >
        A new version is ready to install. You have {SAMPLE_UPDATE_INFO.currentVersion}.
      </ModalDialog>

      {/* 6. Mandatory Force Update */}
      {activeModal === "update_force" && (
        <ForceUpdateModal
          result={SAMPLE_UPDATE_INFO as any}
          daysOld={45}
          locked={false} // Allow testing dismissal
        />
      )}

      {/* 7. Background Update Notice (same dialog as components/UpdateBackgroundNoticeModal.tsx) */}
      <ModalDialog
        open={activeModal === "update_bg_notice"}
        tone="info"
        icon={<CloudDownload size={26} />}
        title="Your update will continue downloading"
        onClose={() => handleAction("Closed Background Notice")}
        extra={<ModalProgress label="MakeChurchEazy v3.31.0" value="68% (42.1 MB / 61.8 MB)" percent={68} />}
        hint="You can check live progress at any time in the banner pinned at the top of your screen, or under Settings > About."
        actions={[
          { label: "View Download", variant: "ghost", onClick: () => handleAction("Opened Download Details") },
          { label: "Got It", variant: "primary", onClick: () => handleAction("Acknowledged Background Notice") },
        ]}
      >
        MakeChurchEazy is downloading the update in the background so you can continue working without disruption.
        MakeChurchEazy will not restart on its own: when the download finishes you can restart, or it will install the next time you close the app.
      </ModalDialog>

      {/* 8. Close Warning (same dialog as components/UpdateCloseAppWarningModal.tsx) */}
      <ModalDialog
        open={activeModal === "update_close_warning"}
        tone="warning"
        role="alertdialog"
        icon={<AlertTriangle size={26} />}
        title="Download is still in progress"
        onClose={() => handleAction("Cancelled Quit")}
        closeOnBackdrop={false}
        showClose
        extra={<ModalProgress label="Current Progress" value="45% · 28.4 MB / 61.8 MB" percent={45} />}
        actions={[
          { label: "Quit Anyway", variant: "dangerGhost", onClick: () => handleAction("Confirmed Quit During Update") },
          { label: "Keep Downloading", variant: "primary", autoFocus: true, onClick: () => handleAction("Cancelled Quit") },
        ]}
      >
        MakeChurchEazy is currently downloading the latest update (v3.31.0).
        If you close the application now, the download will be interrupted and you will need to restart it later.
      </ModalDialog>

      {/* Plan limit (graphics / themes) */}
      <PlanLimitModal
        open={activeModal === "plan_limit"}
        onClose={() => handleAction("Closed Plan Limit")}
        title="Broadcast graphics limit reached"
        message="Your plan includes up to 3 broadcast graphics and you already have 3. Remove one, or upgrade to add more."
        requiredPlan="basic"
        reason="gallery_preview"
      />

      {/* 9. Trial Welcome Modal */}
      {activeModal === "trial_welcome" && (
        <TrialModal
          trialDays={14}
          trialEndsAt={new Date(Date.now() + 14 * 86400000).toISOString()}
          isExistingUser={false}
          onDismiss={() => {
            setActiveModal(null);
            handleAction("Dismissed Trial Welcome");
          }}
        />
      )}

      {/* 10. Trial Expired Modal */}
      <ModalDialog
        open={activeModal === "trial_expired"}
        tone="brand"
        icon={<Clock size={26} />}
        eyebrow="Trial ended"
        title="Your 14-day free trial has ended"
        onClose={() => handleAction("Closed Trial Expired Modal")}
        actions={[
          { label: "Continue free", variant: "ghost", onClick: () => handleAction("Continue on Free Plan") },
          { label: "Upgrade to Growth", variant: "primary", onClick: () => handleAction("Clicked Upgrade to Growth") },
        ]}
      >
        Upgrade to the Growth plan to keep Multi-View, 4K output, Speech-to-Scripture and the full media library.
      </ModalDialog>

      {/* 11. Feature Upgrade Modal */}
      {activeModal === "upgrade_growth" && (
        <UpgradeModal
          open={true}
          onClose={() => handleAction("Closed Upgrade Modal")}
          feature="Mobile Remote & Multi-Screen 4K"
          requiredPlan="growth"
          currentPlan="basic"
          message="Mobile Remote and 4K outputs are available on the Growth plan."
        />
      )}

      {/* 12. OBS Presentation Link Modal */}
      {activeModal === "dock_presentation_link" && (
        <DockPresentationLinkModal
          open={true}
          onClose={() => handleAction("Closed OBS Link Modal")}
        />
      )}

      {/* 13. Studio - Reset Canvas */}
      <ModalDialog
        open={activeModal === "confirm_reset_canvas"}
        tone="warning"
        icon={<RotateCcw size={26} />}
        title="Reset Canvas Layout?"
        onClose={() => handleAction("Cancelled Reset")}
        actions={[
          { label: "Cancel", variant: "ghost", onClick: () => handleAction("Cancelled Reset") },
          { label: "Reset Canvas", variant: "danger", onClick: () => handleAction("Confirmed Canvas Reset") },
        ]}
      >
        This will clear all current regions and restore the starter grid. Unsaved region edits will be lost.
      </ModalDialog>

      {/* 14. Studio - Delete Scene / Theme */}
      <ModalDialog
        open={activeModal === "confirm_delete"}
        tone="danger"
        icon={<Trash2 size={26} />}
        title={"Remove Scene \u201CSunday Main\u201D?"}
        onClose={() => handleAction("Cancelled Delete")}
        actions={[
          { label: "Keep Scene", variant: "ghost", onClick: () => handleAction("Cancelled Delete") },
          { label: "Delete Scene", variant: "danger", onClick: () => handleAction("Confirmed Scene Deleted") },
        ]}
      >
        Are you sure you want to permanently delete this scene? This cannot be undone.
      </ModalDialog>

      {/* 15. Studio - Undo Changes */}
      <ModalDialog
        open={activeModal === "confirm_undo"}
        tone="brand"
        icon={<Undo size={26} />}
        title="Undo Canvas Edits?"
        onClose={() => handleAction("Cancelled Undo")}
        actions={[
          { label: "Cancel", variant: "ghost", onClick: () => handleAction("Cancelled Undo") },
          { label: "Revert Changes", variant: "primary", onClick: () => handleAction("Confirmed Undo") },
        ]}
      >
        Revert all changes made since the last save to the active OBS output?
      </ModalDialog>

      {/* 16. Studio - Keyboard Shortcuts */}
      <ModalDialog
        open={activeModal === "shortcuts"}
        tone="brand"
        icon={<HelpCircle size={26} />}
        title="Keyboard shortcuts"
        onClose={() => handleAction("Closed Shortcuts")}
        width={480}
        extra={
          <ModalFacts
            rows={[
              { label: "Next slide", value: <kbd>Space / →</kbd> },
              { label: "Previous slide", value: <kbd>←</kbd> },
              { label: "Clear / black screen", value: <kbd>B</kbd> },
              { label: "Toggle output", value: <kbd>Ctrl + O / ⌘ + O</kbd> },
              { label: "Quick Bible search", value: <kbd>Ctrl + B / ⌘ + B</kbd> },
              { label: "Close dialog", value: <kbd>Esc</kbd> },
            ]}
          />
        }
        actions={[{ label: "Got it", variant: "primary", onClick: () => handleAction("Closed Shortcuts") }]}
      />
    </div>
  );
}
