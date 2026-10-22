"use client";

import { useState } from "react";
import {
  X,
  LayoutDashboard,
  CreditCard,
  Zap,
  Download,
  Landmark,
  Settings,
  HelpCircle,
  ChevronDown,
  Monitor,
  ShieldCheck,
  Users,
  Headset,
  Timer,
  Receipt,
  Gift,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/lib/useSubscription";
import { getAmbassadorInfo } from "@/lib/ambassadorUtils";
import { AppLogo } from "./AppLogo";

const SUBSCRIPTION_ROUTES = ["/subscription"];
const SETTINGS_ROUTES = ["/settings", "/security", "/church-profile"];
const HELP_ROUTES = ["/community", "/support"];

function isGroupActive(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

export function Sidebar({ isOpen, setIsOpen }: { isOpen?: boolean; setIsOpen?: (v: boolean) => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const {
    planLabel,
    isUnlimited,
    isFreePlan,
    isOnTrial,
    trialDaysLeft,
    trialDurationDays,
    mongoUser,
  } = useSubscription();

  const ambassadorInfo = getAmbassadorInfo(mongoUser?.ambassador, mongoUser?.role);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const trialDuration = trialDurationDays || 30;
  const trialProgressPct = isOnTrial
    ? Math.min(100, Math.round(((trialDuration - trialDaysLeft) / trialDuration) * 100))
    : 0;

  const subscriptionActive = isGroupActive(pathname, SUBSCRIPTION_ROUTES);
  const settingsActive = isGroupActive(pathname, SETTINGS_ROUTES);
  const helpActive = isGroupActive(pathname, HELP_ROUTES);

  const showSettingsSub = settingsActive || settingsOpen;
  const showHelpSub = helpActive || helpOpen;

  const navLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 px-3 h-[42px] rounded-xl text-sm font-medium transition-all duration-150",
      active
        ? "bg-blue-50 text-blue-700 font-semibold"
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
    );

  const subLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 pl-11 pr-3 h-[38px] rounded-xl text-[13px] font-medium transition-colors",
      active
        ? "bg-blue-50 text-blue-700 font-semibold"
        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
    );

  const separator = <div className="mx-3 my-2 border-t border-slate-100" />;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen?.(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 h-full w-[280px] bg-white border-r border-slate-200 flex flex-col z-50 transition-transform duration-300 md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between gap-3 px-5 h-[72px] shrink-0 border-b border-slate-100">
          <Link href="/dashboard" className="flex items-center gap-3">
            <AppLogo className="w-8 h-8 object-contain" mode="dark" />
            <span className="text-sm font-bold text-slate-900">{t("common.appName")}</span>
          </Link>
          <button
            className="md:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
            onClick={() => setIsOpen?.(false)}
          >
            <X className="w-[20px] h-[20px]" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {/* Dashboard */}
          <Link
            href="/dashboard"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname === "/dashboard" || pathname === "/")}
          >
            <LayoutDashboard className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.dashboard")}</span>
          </Link>

          {/* Devices — Standalone Top-Level Page */}
          <Link
            href="/devices"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname.startsWith("/devices"))}
          >
            <Monitor className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.devices") || "Devices"}</span>
          </Link>

          {/* Downloads */}
          <Link
            href="/downloads"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname.startsWith("/downloads"))}
          >
            <Download className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.downloads")}</span>
          </Link>

          {separator}

          {/* Subscription */}
          <Link
            href="/subscription/plans"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(subscriptionActive)}
          >
            <CreditCard className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.subscription")}</span>
          </Link>

          {/* Credits */}
          <Link
            href="/credits"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname.startsWith("/credits"))}
          >
            <Zap className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.credits")}</span>
          </Link>

          {/* Billing */}
          <Link
            href="/billing"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname.startsWith("/billing"))}
          >
            <Receipt className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.billing")}</span>
          </Link>

          {/* Referrals */}
          <Link
            href="/referrals"
            onClick={() => setIsOpen?.(false)}
            className={navLinkClass(pathname.startsWith("/referrals"))}
          >
            <Gift className="w-[20px] h-[20px] shrink-0" />
            <span>{t("navigation.referrals") || "Referrals"}</span>
          </Link>

          {separator}

          {/* Settings (expandable) */}
          <div>
            <div className="flex items-center">
              <Link
                href="/settings"
                onClick={() => setIsOpen?.(false)}
                className={cn(navLinkClass(settingsActive), "flex-1")}
              >
                <Settings className="w-[20px] h-[20px] shrink-0" />
                <span>{t("navigation.settings")}</span>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSettingsOpen(!settingsOpen);
                }}
                className={cn(
                  "h-[42px] w-9 flex items-center justify-center rounded-xl transition-colors -ml-1",
                  settingsActive ? "text-blue-700" : "text-slate-400 hover:text-slate-600",
                )}
              >
                <ChevronDown
                  className={cn("w-4 h-4 transition-transform", showSettingsSub && "rotate-180")}
                />
              </button>
            </div>
            {showSettingsSub && (
              <div className="mt-0.5 space-y-0.5">
                <Link
                  href="/church-profile"
                  onClick={() => setIsOpen?.(false)}
                  className={subLinkClass(pathname.startsWith("/church-profile"))}
                >
                  <Landmark className="w-[18px] h-[18px] shrink-0" />
                  <span>{t("navigation.churchProfile")}</span>
                </Link>
                <Link
                  href="/security"
                  onClick={() => setIsOpen?.(false)}
                  className={subLinkClass(pathname.startsWith("/security"))}
                >
                  <ShieldCheck className="w-[18px] h-[18px] shrink-0" />
                  <span>{t("navigation.security")}</span>
                </Link>
              </div>
            )}
          </div>

          {/* Help & Resources (expandable) */}
          <div>
            <div className="flex items-center">
              <Link
                href="/support"
                onClick={() => setIsOpen?.(false)}
                className={cn(navLinkClass(helpActive), "flex-1")}
              >
                <HelpCircle className="w-[20px] h-[20px] shrink-0" />
                <span>{t("navigation.helpAndResources") || "Help & Resources"}</span>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHelpOpen(!helpOpen);
                }}
                className={cn(
                  "h-[44px] w-9 flex items-center justify-center rounded-xl transition-colors -ml-1",
                  helpActive ? "text-blue-700" : "text-slate-400 hover:text-slate-600",
                )}
              >
                <ChevronDown
                  className={cn("w-4 h-4 transition-transform", showHelpSub && "rotate-180")}
                />
              </button>
            </div>
            {showHelpSub && (
              <div className="mt-0.5">
                <Link
                  href="/community"
                  onClick={() => setIsOpen?.(false)}
                  className={subLinkClass(pathname.startsWith("/community"))}
                >
                  <Users className="w-[18px] h-[18px] shrink-0" />
                  <span>{t("navigation.community")}</span>
                </Link>
                <Link
                  href="/support"
                  onClick={() => setIsOpen?.(false)}
                  className={subLinkClass(pathname.startsWith("/support"))}
                >
                  <Headset className="w-[18px] h-[18px] shrink-0" />
                  <span>{t("navigation.support")}</span>
                </Link>
              </div>
            )}
          </div>
        </nav>

        {/* Bottom section — plan card */}
        <div className="p-3 mt-auto border-t border-slate-100 flex flex-col gap-3">
          {isOnTrial ? (
            <Link
              href="/subscription/plans"
              className="block border border-amber-200 bg-amber-50 rounded-xl p-4 hover:bg-amber-100/60 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-semibold text-amber-700">
                  {t("trial.daysRemaining", { days: trialDaysLeft })}
                </span>
              </div>
              <div className="w-full bg-amber-200/50 rounded-full h-1.5 mb-3">
                <div
                  className="bg-amber-500 h-1.5 rounded-full"
                  style={{ width: `${trialProgressPct}%` }}
                />
              </div>
              <span className="w-full bg-amber-600 text-white font-semibold py-2 rounded-xl text-xs hover:bg-amber-700 transition-colors flex items-center justify-center">
                {t("trial.upgradeNow")}
              </span>
            </Link>
          ) : isFreePlan ? (
            <Link
              href="/subscription/plans"
              className="block border border-blue-200 bg-blue-50 rounded-xl p-4 hover:bg-blue-100/60 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-blue-700">
                  {t("subscription.plans.freePlan")}
                </span>
              </div>
              <p className="text-xs text-blue-600/70 mb-3 leading-relaxed">
                Unlock more credits, devices, and AI features.
              </p>
              <span className="w-full bg-blue-600 text-white font-semibold py-2 rounded-xl text-xs hover:bg-blue-700 transition-colors flex items-center justify-center">
                {t("subscription.plans.managePlan")}
              </span>
            </Link>
          ) : ambassadorInfo.isAmbassador ? (
            <div className="border border-purple-200 bg-gradient-to-b from-purple-50/80 to-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 text-purple-700">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    Ambassador
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  {ambassadorInfo.tenureLabel}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">Growth Plan Unlocked</p>
              <p className="text-xs text-purple-700 font-medium mt-0.5">
                {ambassadorInfo.remainingLabel}
              </p>
              {mongoUser?.credits != null ? (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {Math.max(0, mongoUser.credits).toLocaleString()} AI credits available
                </p>
              ) : null}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  {t("common.currentPlan")}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">{planLabel} Plan</p>
              {isUnlimited ? (
                <p className="text-xs text-slate-500 mt-0.5">Unlimited AI credits</p>
              ) : mongoUser?.credits != null ? (
                <p className="text-xs text-slate-500 mt-0.5">
                  {Math.max(0, mongoUser.credits).toLocaleString()} credits remaining
                </p>
              ) : null}
              <Link
                href="/subscription/plans"
                className="mt-2 block text-center text-xs font-semibold text-blue-600 hover:underline"
              >
                Manage Plan →
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
