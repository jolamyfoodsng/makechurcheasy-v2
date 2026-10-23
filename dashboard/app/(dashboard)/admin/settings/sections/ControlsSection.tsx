"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Mic, Monitor, Power, Save, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeader, Input, Select, Textarea, Toggle } from "@/components/ui";
import type { AdminControls, FeatureSwitchKey, PaymentProviderKey, PlatformSettings } from "../types";
import { withSupportDefaults } from "../supportContent";
import { SupportWindowEditor } from "./SupportWindowEditor";

interface Props {
  data: PlatformSettings["controls"];
  onChange: (data: PlatformSettings["controls"]) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

const PROVIDERS: Array<{ key: PaymentProviderKey; label: string; description: string }> = [
  { key: "flutterwave", label: "Flutterwave (cards & bank)", description: "Card, bank transfer and USSD checkout. Paystack checkouts also go through Flutterwave." },
  { key: "mtnMomo", label: "MTN Mobile Money", description: "MoMo checkout in supported countries." },
  { key: "nowpayments", label: "Crypto (NOWPayments)", description: "USD crypto checkout." },
];

const FEATURES: Array<{ key: FeatureSwitchKey; label: string; description: string }> = [
  { key: "speechToScripture", label: "Speech to Scripture", description: "Blocks new listening sessions on the server. Users see a \"paused for maintenance\" message." },
  { key: "liveTranslation", label: "Live translation", description: "Hides and stops scripture/lyrics translation in the desktop app." },
  { key: "mobileRemote", label: "Mobile remote", description: "Stops the phone remote / mobile companion from connecting." },
  { key: "multistream", label: "Multistream", description: "Blocks starting new multistream destinations." },
  { key: "presentationLink", label: "Presentation link", description: "Blocks sharing the presentation link (browser source on another computer)." },
];

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  trial: "Trial",
  basic: "Basic",
  growth: "Growth",
  pro: "Pro",
  ambassador: "Ambassador",
};

interface PlanConfigLike {
  plans: Record<string, { entitlements?: { devices?: number } & Record<string, unknown> } & Record<string, unknown>>;
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <Button size="sm" loading={saving} onClick={onClick} icon={<Save className="w-3.5 h-3.5" />}>
      Save
    </Button>
  );
}

export function ControlsSection({ data, onChange, onSave, saving }: Props) {
  const set = <K extends keyof AdminControls>(key: K, value: AdminControls[K]) => onChange({ ...data, [key]: value });
  const [domainsText, setDomainsText] = useState((data.signup.blockedDomains ?? []).join(", "));

  // ── Device limits live in Plan Config (entitlements.devices) ──
  const [planConfig, setPlanConfig] = useState<PlanConfigLike | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState<"ok" | "error" | null>(null);

  useEffect(() => {
    fetch("/api/admin/plan-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => setPlanConfig(cfg))
      .catch(() => setPlanConfig(null))
      .finally(() => setPlanLoading(false));
  }, []);

  useEffect(() => {
    setDomainsText((data.signup.blockedDomains ?? []).join(", "));
  }, [data.signup.blockedDomains]);

  const setDeviceLimit = (tier: string, value: number) => {
    if (!planConfig) return;
    const tierCfg = planConfig.plans[tier] ?? {};
    setPlanConfig({
      ...planConfig,
      plans: {
        ...planConfig.plans,
        [tier]: { ...tierCfg, entitlements: { ...(tierCfg.entitlements ?? {}), devices: value } },
      },
    });
  };

  const saveDeviceLimits = async () => {
    if (!planConfig) return;
    setPlanSaving(true);
    setPlanSaved(null);
    try {
      const res = await fetch("/api/admin/plan-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plans: planConfig.plans }),
      });
      setPlanSaved(res.ok ? "ok" : "error");
    } catch {
      setPlanSaved("error");
    } finally {
      setPlanSaving(false);
      setTimeout(() => setPlanSaved(null), 3000);
    }
  };

  const planTiers = planConfig
    ? Object.keys(planConfig.plans).filter((tier) => tier in PLAN_LABELS)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Controls</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Switches that take effect without a release. Desktop apps pick up changes within a few minutes.
        </p>
      </div>

      {/* Device limits */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title="Device limits"
            description="How many computers each plan can use at once. -1 = unlimited. Free plans with 1 device sign the older computer out automatically."
            icon={<Monitor className="w-4 h-4" />}
            action={<SaveButton saving={planSaving} onClick={saveDeviceLimits} />}
          />
        </div>
        <div className="px-6 py-4">
          {planLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : !planConfig ? (
            <p className="text-sm text-rose-400">Couldn't load Plan Config.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {planTiers.map((tier) => (
                <Input
                  key={tier}
                  label={PLAN_LABELS[tier]}
                  type="number"
                  min={-1}
                  value={planConfig.plans[tier]?.entitlements?.devices ?? ""}
                  onChange={(e) => setDeviceLimit(tier, Math.max(-1, Math.round(Number(e.target.value))))}
                />
              ))}
            </div>
          )}
          {planSaved && (
            <p className={`text-xs mt-2 ${planSaved === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
              {planSaved === "ok" ? "Device limits saved." : "Couldn't save device limits."}
            </p>
          )}
        </div>
      </Card>

      {/* Payment providers */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title="Payment providers"
            description={'Turn a checkout method off (e.g. during an outage). "Allow payments" in System Controls still turns all of them off.'}
            icon={<CreditCard className="w-4 h-4" />}
            action={<SaveButton saving={saving} onClick={onSave} />}
          />
        </div>
        <div className="divide-y divide-slate-100">
          {PROVIDERS.map((p) => (
            <div key={p.key} className="px-6 py-4">
              <Toggle
                label={p.label}
                description={p.description}
                checked={data.paymentProviders[p.key] !== false}
                onChange={(v) => set("paymentProviders", { ...data.paymentProviders, [p.key]: v })}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Feature off switches */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title="Feature switches"
            description="Emergency off switches. Turning one off affects every user immediately."
            icon={<Power className="w-4 h-4" />}
            action={<SaveButton saving={saving} onClick={onSave} />}
          />
        </div>
        <div className="divide-y divide-slate-100">
          {FEATURES.map((f) => (
            <div key={f.key} className="px-6 py-4">
              <Toggle
                label={f.label}
                description={f.description}
                checked={data.features[f.key] !== false}
                onChange={(v) => set("features", { ...data.features, [f.key]: v })}
                destructive={data.features[f.key] === false}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Speech */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title="Speech to Scripture"
            description="Speech model and a fair-use cap. Free-plan minutes are set in Admin → Credits."
            icon={<Mic className="w-4 h-4" />}
            action={<SaveButton saving={saving} onClick={onSave} />}
          />
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Speech model (AssemblyAI)"
            value={data.speech.model}
            onChange={(e) => set("speech", { ...data.speech, model: e.target.value as AdminControls["speech"]["model"] })}
            options={[
              { value: "universal-streaming-english", label: "Universal Streaming — English (most accurate)" },
              { value: "universal-streaming-multilingual", label: "Universal Streaming — Multilingual" },
            ]}
          />
          <Input
            label="Daily cap for trial & paid users (minutes, 0 = no cap)"
            type="number"
            min={0}
            max={1440}
            value={data.speech.dailyMinutesCap}
            onChange={(e) => set("speech", { ...data.speech, dailyMinutesCap: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
          />
        </div>
      </Card>

      {/* Signup protection */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title="Signup protection"
            description="Stops people creating many accounts to reuse trials. Counts accounts made in the last 24 hours. 0 = no limit."
            icon={<ShieldCheck className="w-4 h-4" />}
            action={<SaveButton saving={saving} onClick={onSave} />}
          />
        </div>
        <div className="divide-y divide-slate-100">
          <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Max new accounts per network (IP) per day"
              type="number"
              min={0}
              value={data.signup.maxSignupsPerIpPerDay}
              onChange={(e) => set("signup", { ...data.signup, maxSignupsPerIpPerDay: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            <Input
              label="Max new accounts per browser / computer per day"
              type="number"
              min={0}
              value={data.signup.maxSignupsPerDevicePerDay}
              onChange={(e) => set("signup", { ...data.signup, maxSignupsPerDevicePerDay: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
          </div>
          <div className="px-6 py-4">
            <Toggle
              label="Block temporary email addresses"
              description="Rejects sign-ups from throwaway providers like Mailinator, YOPmail and 10MinuteMail."
              checked={data.signup.blockDisposableEmails !== false}
              onChange={(v) => set("signup", { ...data.signup, blockDisposableEmails: v })}
            />
          </div>
          <div className="px-6 py-4">
            <Textarea
              label="Also block these email domains"
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              onBlur={() =>
                set("signup", {
                  ...data.signup,
                  blockedDomains: domainsText
                    .split(/[\s,]+/)
                    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
                    .filter(Boolean),
                })
              }
              placeholder="example.com, spamdomain.net"
              rows={2}
            />
          </div>
        </div>
      </Card>

      {/* Support window in the desktop app */}
      <SupportWindowEditor
        value={withSupportDefaults(data.support)}
        onChange={(support) => set("support", support)}
        saveButton={<SaveButton saving={saving} onClick={onSave} />}
      />
    </div>
  );
}
