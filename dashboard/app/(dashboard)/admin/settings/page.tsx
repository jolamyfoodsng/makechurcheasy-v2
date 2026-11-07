"use client";

import { useState, useEffect } from "react";
import { Settings, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppUpdatesSection } from "./sections/AppUpdatesSection";
import { TrialSection } from "./sections/TrialSection";
import { CreditsSection } from "./sections/CreditsSection";
import { AmbassadorSection } from "./sections/AmbassadorSection";
import { EarlyAccessSection } from "./sections/EarlyAccessSection";
import { SpecialOffersSection } from "./sections/SpecialOffersSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { EmailBrandingSection } from "./sections/EmailBrandingSection";
import { SecuritySection } from "./sections/SecuritySection";
import { CountryPricingSection } from "./sections/CountryPricingSection";
import { SystemControlsSection } from "./sections/SystemControlsSection";
import { ControlsSection } from "./sections/ControlsSection";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { type PlatformSettings, DEFAULT_SETTINGS } from "./types";

export type { PlatformSettings };

const TABS = [
  { id: "app-updates", label: "App Updates" },
  { id: "trial", label: "Trial", },
  { id: "credits", label: "Credits", },
  { id: "ambassador", label: "Ambassador", },
  { id: "early-access", label: "Early Access", },
  { id: "special-offers", label: "Special Offers", },
  { id: "notifications", label: "Notifications", },
  { id: "brand-email", label: "Brand & Email", },
  { id: "security", label: "Security", },
  { id: "system-controls", label: "System Controls", },
  { id: "controls", label: "Controls", },
  { id: "country-pricing", label: "Country Pricing", },
] as const;

export type TabId = (typeof TABS)[number]["id"];

const STORAGE_KEY = "admin-settings-active-tab";

export default function AdminSettingsPage() {
  const t = useTranslations();
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabId>("app-updates");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const TAB_LABELS: Record<string, string> = {
    "app-updates": String(t('admin.settings.tabs.appUpdates')),
    "trial": String(t('admin.settings.tabs.trial')),
    "credits": String(t('admin.settings.tabs.credits')),
    "ambassador": String(t('admin.settings.tabs.ambassador')),
    "early-access": "Early Access",
    "earlyAccess": "Early Access",
    "special-offers": "Special Offers",
    "authentication": String(t('admin.settings.tabs.authentication')),
    "notifications": "Notifications",
    "brand-email": "Brand & Email",
    "emailBranding": "Brand & Email",
    "storage": String(t('admin.settings.tabs.storage')),
    "security": String(t('admin.settings.tabs.security')),
    "system-controls": "System Controls",
    "system": "System Controls",
    "featureFlags": "Feature Flags",
    "controls": "Controls",
  };

  useEffect(() => {
    // A link like /admin/settings?tab=notifications opens that tab; otherwise reopen the last one.
    const requested = new URLSearchParams(window.location.search).get("tab");
    const saved = requested && TABS.some((t) => t.id === requested) ? requested : localStorage.getItem(STORAGE_KEY);
    if (saved && TABS.some((t) => t.id === saved)) {
      setActiveTab(saved as TabId);
    }
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/admin/platform-settings");
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    localStorage.setItem(STORAGE_KEY, tabId);
  };

  const saveSection = async (section: keyof PlatformSettings) => {
    setSaving(section);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data: settings[section] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save");
      }
      setToast({ type: "success", message: `${TAB_LABELS[section] || section} settings saved successfully` });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setToast({ type: "error", message: msg });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(null);
    }
  };

  const updateSection = <K extends keyof PlatformSettings>(
    section: K,
    data: PlatformSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [section]: data }));
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              {t('admin.settings.title')}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {t('admin.settings.description')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
          <div className="space-y-1 rounded-2xl border border-slate-800 bg-[#0B101E]/60 p-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-slate-800/60 animate-pulse" />
            ))}
          </div>
          <div className="space-y-6">
            <div className="h-8 w-48 rounded-lg bg-slate-800/60 animate-pulse" />
            <div className="h-64 rounded-2xl bg-slate-800/40 border border-slate-800 animate-pulse" />
            <div className="h-48 rounded-2xl bg-slate-800/40 border border-slate-800 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const renderSection = () => {
    switch (activeTab) {
      case "app-updates":
        return (
          <AppUpdatesSection
            data={settings.appUpdates}
            onChange={(d) => updateSection("appUpdates", d)}
            onSave={() => saveSection("appUpdates")}
            saving={saving === "appUpdates"}
          />
        );
      case "trial":
        return (
          <TrialSection
            data={settings.trial}
            onChange={(d) => updateSection("trial", d)}
            onSave={() => saveSection("trial")}
            saving={saving === "trial"}
          />
        );
      case "credits":
        return <CreditsSection />;
      case "ambassador":
        return (
          <AmbassadorSection
            data={settings.ambassador}
            onChange={(d) => updateSection("ambassador", d)}
            onSave={() => saveSection("ambassador")}
            saving={saving === "ambassador"}
          />
        );
      case "early-access":
        return (
          <EarlyAccessSection
            data={settings.earlyAccess}
            onChange={(d) => updateSection("earlyAccess", d)}
            onSave={() => saveSection("earlyAccess")}
            saving={saving === "earlyAccess"}
          />
        );
      case "special-offers":
        return <SpecialOffersSection />;
      case "notifications":
        return (
          <NotificationsSection
            data={settings.notifications}
            onChange={(d) => updateSection("notifications", d)}
            onSave={() => saveSection("notifications")}
            saving={saving === "notifications"}
          />
        );
      case "brand-email":
        return (
          <EmailBrandingSection
            data={settings.emailBranding}
            onChange={(d) => updateSection("emailBranding", d)}
            onSave={() => saveSection("emailBranding")}
            saving={saving === "emailBranding"}
          />
        );
      case "security":
        return (
          <SecuritySection
            data={settings.security}
            onChange={(d) => updateSection("security", d)}
            onSave={() => saveSection("security")}
            saving={saving === "security"}
          />
        );
      case "system-controls":
        return (
          <SystemControlsSection
            system={settings.system}
            onSystemChange={(d) => updateSection("system", d)}
            onSaveSystem={() => saveSection("system")}
            savingSystem={saving === "system"}
          />
        );
      case "controls":
        return (
          <ControlsSection
            data={settings.controls}
            onChange={(d) => updateSection("controls", d)}
            onSave={() => saveSection("controls")}
            saving={saving === "controls"}
          />
        );
      case "country-pricing":
        return <CountryPricingSection />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            {t('admin.settings.title')}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {t('admin.settings.description')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 min-h-[600px]">
        {/* Sidebar */}
        <nav className="space-y-1 bg-[#0B101E]/60 border border-slate-800 p-2 rounded-2xl h-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3.5 h-10 rounded-xl text-sm font-medium transition-all text-left",
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 font-semibold"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              )}
            >
              {/* <span className="text-base">{tab.icon}</span> */}
              {TAB_LABELS[tab.id] || tab.label}
              {saving === (
                tab.id === "early-access"
                  ? "earlyAccess"
                  : tab.id === "brand-email"
                    ? "emailBranding"
                    : tab.id
              ) && (
                <Loader2 className="w-3.5 h-3.5 ml-auto animate-spin" />
              )}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div>{renderSection()}</div>
      </div>

      {/* Save feedback toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium shadow-2xl border backdrop-blur-md",
            toast.type === "success"
              ? "bg-slate-900/95 border-emerald-500/40 text-emerald-300 shadow-emerald-950/30"
              : "bg-slate-900/95 border-rose-500/40 text-rose-300 shadow-rose-950/30"
          )}>
            {toast.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
