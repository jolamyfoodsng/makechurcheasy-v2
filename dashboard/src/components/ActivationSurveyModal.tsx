"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MessageCircle, X } from "lucide-react";

type SurveyReason =
  | "could_not_connect"
  | "did_not_understand"
  | "did_not_need_it_yet"
  | "missing_feature"
  | "technical_problem"
  | "already_use_something_else"
  | "still_testing"
  | "other";

const OPTIONS: Array<{ value: SurveyReason; label: string }> = [
  { value: "could_not_connect", label: "I couldn't connect OBS" },
  { value: "did_not_understand", label: "I didn't understand how to use it" },
  { value: "did_not_need_it_yet", label: "I don't need it yet" },
  { value: "missing_feature", label: "It is missing something I need" },
  { value: "technical_problem", label: "I had a technical problem" },
  { value: "already_use_something_else", label: "I already use something else" },
  { value: "still_testing", label: "I'm still testing it" },
  { value: "other", label: "Something else" },
];

export function ActivationSurveyModal() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SurveyReason | "">("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/user/activation-survey", { credentials: "include", cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.eligible) setOpen(true);
        })
        .catch(() => { });
    }, 3500);
    return () => window.clearTimeout(timer);
  }, []);

  async function closeSurvey() {
    setOpen(false);
    void fetch("/api/user/activation-survey", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    }).catch(() => { });
  }

  async function submit() {
    if (!reason) return;
    setSaving(true);
    try {
      const response = await fetch("/api/user/activation-survey", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, detail }),
      });
      if (!response.ok) return;
      setSubmitted(true);
      window.setTimeout(() => setOpen(false), 1200);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="activation-survey-title">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              {submitted ? <CheckCircle2 className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="activation-survey-title" className="text-lg font-semibold text-slate-900">
                {submitted ? "Thank you" : "Can we improve your first experience?"}
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                {submitted ? "Your answer helps us make setup easier for every church." : "You signed up, but we noticed you may not have reached your first useful result."}
              </p>
            </div>
          </div>
          {!submitted && (
            <button type="button" onClick={closeSurvey} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close survey">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {!submitted && (
          <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-800">What stopped you?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {OPTIONS.map((option) => (
                  <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${reason === option.value ? "border-blue-500 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      name="activation-reason"
                      value={option.value}
                      checked={reason === option.value}
                      onChange={() => setReason(option.value)}
                      className="mt-0.5 accent-blue-700"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Anything else? <span className="font-normal text-slate-400">(Optional)</span></span>
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value.slice(0, 600))}
                placeholder="Tell us what happened..."
                className="min-h-[72px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none ring-blue-500 placeholder:text-slate-400 focus:ring-2"
              />
            </label>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-3">
              <button type="button" onClick={closeSurvey} className="h-11 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">Not now</button>
              <button type="button" onClick={submit} disabled={!reason || saving} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Saving..." : "Send feedback"}
              </button>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
