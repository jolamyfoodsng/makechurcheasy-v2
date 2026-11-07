import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ModalDialog, { ModalPanel } from "../../components/ModalDialog";
import { CalendarDays, Check } from "../../components/icons/NativeIcons";
import { DOCK_ONBOARDING_KEY, DOCK_ONBOARDING_COMPLETED_EVENT } from "./DockOnboardingTour";

export const DOCK_SCHEDULE_INTRO_KEY = "__mce_dock_schedule_intro_v1";
export const DOCK_OPEN_SCHEDULE_GUIDE_EVENT = "mce-open-schedule-guide";

interface Props {
  open?: boolean;
  onClose?: () => void;
}

export function DockScheduleIntroModal({ open: controlledOpen, onClose: controlledClose }: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    const handleOpenEvent = () => {
      setInternalOpen(true);
    };
    window.addEventListener(DOCK_OPEN_SCHEDULE_GUIDE_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener(DOCK_OPEN_SCHEDULE_GUIDE_EVENT, handleOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (isControlled) return;
    try {
      if (typeof localStorage === "undefined") return;
      const seen = localStorage.getItem(DOCK_SCHEDULE_INTRO_KEY);
      if (seen === "true") return;

      const hasCompletedTour = localStorage.getItem(DOCK_ONBOARDING_KEY) === "true";

      if (hasCompletedTour) {
        // Step-by-step dock guide was already finished: show schedule modal after brief settle delay
        const timer = setTimeout(() => {
          setInternalOpen(true);
        }, 900);
        return () => clearTimeout(timer);
      }

      // Step-by-step dock guide is still pending: wait until it is finished or skipped first
      let showTimer: ReturnType<typeof setTimeout> | null = null;
      const handleTourCompleted = () => {
        const stillSeen = localStorage.getItem(DOCK_SCHEDULE_INTRO_KEY);
        if (stillSeen !== "true") {
          showTimer = setTimeout(() => {
            setInternalOpen(true);
          }, 600);
        }
      };

      window.addEventListener(DOCK_ONBOARDING_COMPLETED_EVENT, handleTourCompleted);
      return () => {
        window.removeEventListener(DOCK_ONBOARDING_COMPLETED_EVENT, handleTourCompleted);
        if (showTimer) clearTimeout(showTimer);
      };
    } catch {
      // Ignore localStorage errors
    }
  }, [isControlled]);

  const handleDismiss = useCallback(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(DOCK_SCHEDULE_INTRO_KEY, "true");
      }
    } catch {
      // Ignore
    }
    if (controlledClose) {
      controlledClose();
    } else {
      setInternalOpen(false);
    }
  }, [controlledClose]);

  if (!isOpen) return null;

  return (
    <ModalDialog
      tone="brand"
      icon={<CalendarDays size={26} />}
      eyebrow={t("schedule.intro.badge", "Quick guide")}
      title={t("schedule.intro.title", "Service Schedule & History")}
      extra={
        <ModalPanel>
          <ul>
            <li>
              <strong>{t("schedule.intro.locationLabel", "Where to find it:")}</strong>{" "}
              {t("schedule.intro.locationText", "click the schedule icon on the left edge of your Dock to open or close it.")}
            </li>
            <li>
              <strong>{t("schedule.intro.point1Title", "Schedule & History:")}</strong>{" "}
              {t("schedule.intro.point1Detail", "queue items for the service, or switch tabs to see what you projected earlier.")}
            </li>
            <li>
              <strong>{t("schedule.intro.point2Title", "One-click projection:")}</strong>{" "}
              {t("schedule.intro.point2Detail", "click any card to show it on your live screen and OBS.")}
            </li>
            <li>
              <strong>{t("schedule.intro.point3Title", "Resize & pin:")}</strong>{" "}
              {t("schedule.intro.point3Detail", "drag the right edge to resize, or pin it to keep it open.")}
            </li>
          </ul>
        </ModalPanel>
      }
      hint={t("schedule.intro.reopenHint", "Reopen this from the ? icon in the Schedule header.")}
      actions={[
        {
          label: t("schedule.intro.gotIt", "Got it"),
          variant: "primary",
          autoFocus: true,
          icon: <Check size={14} />,
          onClick: handleDismiss,
        },
      ]}
      onClose={handleDismiss}
      zIndex={10002}
    >
      <p>{t("schedule.intro.subtitle", "Queue scriptures, songs and media, or bring back anything you already projected.")}</p>
    </ModalDialog>
  );
}

export default DockScheduleIntroModal;
