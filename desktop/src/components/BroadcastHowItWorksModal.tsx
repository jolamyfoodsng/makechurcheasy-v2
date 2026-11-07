/**
 * BroadcastHowItWorksModal.tsx — the Multi-Stream "How it works" guide.
 *
 * Built on the app's one dialog (ModalDialog) so it follows dark / light mode and the accent
 * colour like every other dialog: five numbered steps in a panel, one "Got it" button.
 */
import ModalDialog, { ModalPanel } from "./ModalDialog";
import { Radio } from "./icons/NativeIcons";
import type { MultistreamPlanAllocation } from "../services/broadcastSettingsService";
import { getMultistreamPlanAllocation } from "../services/broadcastSettingsService";
import "./BroadcastHowItWorksModal.css";

function getPlanContinuationText(allocation: MultistreamPlanAllocation): string {
  if (allocation.plan === "growth") {
    return "You have access to 20 hours based on your Growth Plan.";
  }
  if (allocation.plan === "basic") {
    return "You have access to 10 hours based on your Basic Plan.";
  }
  if (allocation.plan === "pro") {
    return "You have access to 40 hours based on your Pro Plan.";
  }
  if (allocation.plan === "unlimited" || allocation.plan === "ambassador") {
    return "You have unlimited streaming hours on your plan.";
  }
  return "You have access to 1 channel on the Free Plan. Upgrade for multi-platform streaming.";
}

const STEPS: Array<{ title: string; text: string }> = [
  { title: "Create Profiles", text: "One profile per account: Church Account, First Lady’s Account, Youth Ministry Account." },
  { title: "Add Channels", text: "Save YouTube and Facebook streaming details to each profile once." },
  { title: "Select a Profile", text: "Choose which setup you want to use for the current service." },
  { title: "Sync with OBS", text: "Church Eazy loads that profile's streaming setup into OBS in one click." },
  { title: "Go Live", text: "Start streaming from OBS. It goes live to the selected profile's channels." },
];

export interface BroadcastHowItWorksModalProps {
  open: boolean;
  onClose: () => void;
  allocation?: MultistreamPlanAllocation;
  onOpenUpgrade?: () => void;
}

export function BroadcastHowItWorksModal({
  open,
  onClose,
  allocation: passedAllocation,
}: BroadcastHowItWorksModalProps) {
  if (!open) return null;
  const allocation = passedAllocation || getMultistreamPlanAllocation("free");

  return (
    <ModalDialog
      tone="brand"
      icon={<Radio size={26} />}
      eyebrow="Multi-Stream"
      title="How it works"
      width={520}
      zIndex={10000}
      onClose={onClose}
      hint={getPlanContinuationText(allocation)}
      extra={
        <ModalPanel heading="Set it up once, then switch and stream without copying stream keys every time.">
          <ol className="broadcast-how-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="broadcast-how-steps__item">
                <span className="broadcast-how-steps__number" aria-hidden="true">{index + 1}</span>
                <span className="broadcast-how-steps__copy">
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </ModalPanel>
      }
      actions={[{ label: "Got it", variant: "primary", autoFocus: true, onClick: onClose }]}
    >
      Set up once, then switch and stream with one click.
    </ModalDialog>
  );
}

export default BroadcastHowItWorksModal;
