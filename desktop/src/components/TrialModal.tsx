import { CheckCircle } from "./icons/NativeIcons";
import ModalDialog, { ModalFacts, ModalPanel } from "./ModalDialog";

const TRIAL_WELCOME_KEY = "mce_trial_welcome_shown";

interface TrialModalProps {
  trialDays: number;
  trialEndsAt: string;
  isExistingUser: boolean;
  onDismiss: () => void;
}

const TRIAL_FEATURES = [
  "Translation",
  "Multiview",
  "Mass Song Import",
  "EasyWorship Import",
  "ProPresenter Import",
  "Premium Themes",
  "Speech-to-Scripture",
  "Unlimited Songs",
  "Unlimited Media",
];

export default function TrialModal({
  trialDays,
  trialEndsAt,
  isExistingUser,
  onDismiss,
}: TrialModalProps) {
  function handleDismiss() {
    localStorage.setItem(TRIAL_WELCOME_KEY, "true");
    onDismiss();
  }

  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <ModalDialog
      tone="success"
      icon={<CheckCircle size={26} />}
      eyebrow={`${trialDays}-day Growth trial`}
      title={isExistingUser ? "Welcome Back!" : "Welcome to MakeChurchEazy"}
      onClose={handleDismiss}
      showClose={false}
      zIndex={9999}
      width={420}
      extra={
        <>
          <ModalPanel heading={isExistingUser ? "Your trial includes:" : "Included in your trial:"} maxHeight={220}>
            <ul>
              {TRIAL_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </ModalPanel>
          <ModalFacts rows={[{ label: "Trial Ends", value: endDate }]} />
        </>
      }
      actions={[
        {
          label: isExistingUser ? "Start Exploring" : "Get Started",
          variant: "primary",
          autoFocus: true,
          onClick: handleDismiss,
          title: "Start",
        },
      ]}
    >
      {isExistingUser
        ? `As an early adopter of MakeChurchEazy, we've unlocked a complimentary ${trialDays}-day Growth Trial for your church.`
        : `Welcome to MakeChurchEazy. You now have full access to Growth features for the next ${trialDays} days.`}
    </ModalDialog>
  );
}

/**
 * Check if the trial welcome modal has been shown before.
 * Uses localStorage to persist across page reloads.
 */
export function hasTrialWelcomeBeenShown(): boolean {
  return localStorage.getItem(TRIAL_WELCOME_KEY) === "true";
}

/**
 * Mark the trial welcome modal as shown.
 */
export function markTrialWelcomeAsShown(): void {
  localStorage.setItem(TRIAL_WELCOME_KEY, "true");
}
