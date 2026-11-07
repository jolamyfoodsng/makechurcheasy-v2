import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ModalDialog, { ModalCodeRow } from "../../components/ModalDialog";
import { Link } from "../../components/icons/NativeIcons";
import { copyTextToClipboard } from "../bibleClipboard";
import { getPresentationSettings } from "../../services/presentationSettings";

interface DockPresentationLinkModalProps {
  open: boolean;
  onClose: () => void;
  presentationLink?: string;
}

export function DockPresentationLinkModal({
  open,
  onClose,
  presentationLink: propLink,
}: DockPresentationLinkModalProps) {
  const { t } = useTranslation();
  const [presentationLink, setPresentationLink] = useState(
    () => propLink || getPresentationSettings().presentationLink,
  );
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (propLink) {
      setPresentationLink(propLink);
    } else {
      setPresentationLink(getPresentationSettings().presentationLink);
    }
  }, [propLink, open]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const link = presentationLink || getPresentationSettings().presentationLink;
    if (!link) return;
    const didCopy = await copyTextToClipboard(link);
    setCopied(didCopy);

    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    if (didCopy) {
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 2000);
    }
  }, [presentationLink]);

  if (!open) return null;

  return (
    <ModalDialog
      tone="brand"
      icon={<Link size={26} />}
      title={t("dock.freePlanNoticeTitle", "You Are on the Free Plan")}
      extra={
        <ModalCodeRow
          label={t("dock.presentationLink", "Your OBS Browser Source Link")}
          code={presentationLink}
          copied={copied}
          onCopy={presentationLink ? () => void handleCopy() : undefined}
        />
      }
      hint={t(
        "dock.freePlanModalHint",
        "Add this link as a single Browser Source in OBS (recommended resolution: 1920 × 1080). Everything you project from the Dock will update through it dynamically.",
      )}
      actions={[{ label: t("common.gotIt", "Got it"), variant: "primary", autoFocus: true, onClick: onClose }]}
      onClose={onClose}
      width={460}
    >
      <p>
        {t(
          "dock.freePlanNoticeDesc",
          "Your account is on the Free plan. Because of this, automatic OBS scene management and dedicated sources are disabled. All live presentations (Bible, worship lyrics, media, and notes) now display through this single Browser Source link.",
        )}
      </p>
    </ModalDialog>
  );
}

export default DockPresentationLinkModal;
