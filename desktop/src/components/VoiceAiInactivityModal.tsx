/**
 * VoiceAiInactivityModal — the "Are you still using Voice AI?" prompt, shown on
 * every page of the app (the Speech to Scripture page shows its own copy).
 * Yes keeps listening; No, or letting the countdown run out, stops it.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Clock } from "./icons/NativeIcons";
import ModalDialog from "./ModalDialog";

type Prompt = { active: boolean; remainingSeconds: number; intervalMinutes: number } | null;

export function VoiceAiInactivityModal() {
  const [prompt, setPrompt] = useState<Prompt>(null);
  const location = useLocation();

  useEffect(() => {
    const onPrompt = (event: Event) => setPrompt((event as CustomEvent<Prompt>).detail ?? null);
    window.addEventListener("mce:voice-ai-inactivity", onPrompt);
    return () => window.removeEventListener("mce:voice-ai-inactivity", onPrompt);
  }, []);

  if (!prompt?.active) return null;
  if (location.pathname.includes("speech-to-scripture")) return null;

  const keepListening = async () => {
    setPrompt(null);
    const { lmDockService } = await import("../services/lmDockService");
    lmDockService.confirmStillUsing();
  };
  const stop = async () => {
    setPrompt(null);
    const { lmDockService } = await import("../services/lmDockService");
    lmDockService.stopDueToInactivity();
  };

  return (
    <ModalDialog
      role="alertdialog"
      tone="warning"
      icon={<Clock size={26} />}
      title="Are you still using Voice AI?"
      zIndex={10000}
      actions={[
        { label: "No, stop", variant: "ghost", onClick: () => void stop() },
        { label: "Yes, keep listening", variant: "primary", autoFocus: true, onClick: () => void keepListening() },
      ]}
    >
      <p aria-live="assertive">
        No speech detected for {prompt.intervalMinutes} minutes. Voice AI will stop in{" "}
        <strong>{prompt.remainingSeconds}s</strong> unless you keep it on.
      </p>
    </ModalDialog>
  );
}
