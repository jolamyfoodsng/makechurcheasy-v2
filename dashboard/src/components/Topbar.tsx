"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Menu, User, Settings, Shield, LogOut, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "../contexts/AuthContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { UserNotificationsBell } from "./UserNotificationsBell";
import { getSubscriptionState } from "../lib/trialState";
import { getAmbassadorInfo } from "@/lib/ambassadorUtils";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const { mongoUser, logOut } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const displayName = mongoUser?.name || "User";
  const email = mongoUser?.email || "";
  const role = mongoUser?.role || "User";
  const isAdmin = pathname.startsWith("/admin");
  const ambassadorInfo = getAmbassadorInfo(mongoUser?.ambassador, mongoUser?.role);
  const subscriptionState = getSubscriptionState(mongoUser || null);
  const planBadge = ambassadorInfo.isAmbassador
    ? { label: "Ambassador", tone: "bg-purple-100 text-purple-700 border border-purple-200" }
    : subscriptionState.isTrialActive
    ? { label: subscriptionState.planLabel, tone: isAdmin ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700" }
    : subscriptionState.isFreePlan
      ? null
      : { label: subscriptionState.planLabel, tone: isAdmin ? "bg-blue-500/15 text-blue-200" : "bg-blue-50 text-blue-700" };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getPageTitle = () => {
    if (pathname.startsWith('/settings/email')) return t("pageTitles.securitySettings");
    if (pathname === '/security/sessions') return t("pageTitles.manageActiveSessions");
    if (pathname === '/security/password') return t("pageTitles.changePassword");
    if (pathname === '/notifications') return t("common.notifications");
    if (pathname.startsWith('/error')) return t("pageTitles.actionRequired");
    if (pathname === '/settings/deactivate') return t("pageTitles.deactivateAccount");
    if (pathname === '/credits/history') return t("pageTitles.creditsHistory");
    if (pathname.startsWith('/referrals')) return "Referrals";

    switch (pathname) {
      case "/": return t("pageTitles.overview");
      case "/settings": return t("pageTitles.profileSettings");
      case "/devices": return t("pageTitles.devices");
      case "/church-profile": return t("pageTitles.churchProfile");
      case "/security": return t("pageTitles.security");
      case "/credits": return t("pageTitles.credits");
      case "/downloads": return t("pageTitles.downloads");
      case "/subscription": return t("pageTitles.subscription");
      case "/subscription/plans": return t("pageTitles.subscription");
      case "/billing": return t("pageTitles.billing");
      case "/tutorials": return t("pageTitles.tutorials");
      case "/community": return t("pageTitles.community");
      case "/support": return t("pageTitles.support");
      default: return t("pageTitles.dashboard");
    }
  };

  return (
    <header className={`mce-dashboard-topbar sticky top-0 z-40 w-full h-[72px] backdrop-blur-md border-b flex justify-between items-center px-4 md:px-6 shrink-0 ${isAdmin ? "mce-dashboard-topbar--admin bg-slate-900/80 border-slate-700" : "bg-white/80 border-slate-200"}`}>
      {/* Left: Mobile menu + page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className={`md:hidden p-2 rounded-lg transition-colors ${isAdmin ? "text-slate-400 hover:bg-gray-800" : "text-slate-500 hover:bg-slate-100"}`}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className={`text-base font-bold hidden md:block ${isAdmin ? "text-slate-50" : "text-slate-900"}`}>{getPageTitle()}</h1>
      </div>

      {/* Right: Notifications + user menu */}
      <div className="flex items-center gap-2">
        <UserNotificationsBell isAdmin={isAdmin} />

        {/* Language Switcher */}
        <LanguageSwitcher />

        {/* Divider */}
        <div className={`h-6 w-px mx-1 ${isAdmin ? "bg-slate-700" : "bg-slate-200"}`} />

        {/* User menu */}
        <div className="relative" ref={profileRef}>
          <button
            className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors cursor-pointer ${isAdmin ? "hover:bg-gray-800" : "hover:bg-slate-50"}`}
            onClick={() => setIsProfileOpen(!isProfileOpen)}
          >
            <img
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=${isAdmin ? "334155" : "0F172A"}&color=fff&size=150`}
              alt={displayName}
              className={`w-8 h-8 rounded-full object-cover border ${isAdmin ? "border-slate-700" : "border-slate-200"}`}
            />
            <div className="hidden md:block text-left">
              <div className={`text-sm font-semibold leading-none ${isAdmin ? "text-slate-50" : "text-slate-900"}`}>{displayName}</div>
              <div className="mt-0.5 flex items-center gap-2">
                {ambassadorInfo.isAmbassador ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                    <Sparkles className="w-2.5 h-2.5 text-purple-600" />
                    Ambassador
                  </span>
                ) : (
                  <div className={`text-[11px] ${isAdmin ? "text-slate-400" : "text-slate-500"}`}>
                    {mongoUser?.role === "admin" ? "Admin" : role}
                  </div>
                )}
                {planBadge && !ambassadorInfo.isAmbassador ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${planBadge.tone}`}>
                    {planBadge.label}
                  </span>
                ) : null}
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 ml-0.5 transition-transform hidden md:block ${isAdmin ? "text-slate-500" : "text-slate-400"}`} style={{ transform: isProfileOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
          </button>

          {isProfileOpen && (
            <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg overflow-hidden z-50 border ${isAdmin ? "bg-gray-900 border-slate-700" : "bg-white border-slate-200"}`}>
              <div className={`p-4 border-b ${isAdmin ? "border-slate-700" : "border-slate-100"}`}>
                <p className={`text-sm font-semibold ${isAdmin ? "text-slate-50" : "text-slate-900"}`}>{displayName}</p>
                <p className={`text-xs truncate ${isAdmin ? "text-slate-400" : "text-slate-500"}`}>{email}</p>
                {ambassadorInfo.isAmbassador ? (
                  <div className="mt-2.5 p-2 rounded-lg bg-purple-50 border border-purple-100 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      <span>Ambassador Access</span>
                    </div>
                    <p className="text-[11px] text-purple-700/90 font-medium">
                      {ambassadorInfo.tenureLabel} ({ambassadorInfo.remainingLabel})
                    </p>
                  </div>
                ) : planBadge ? (
                  <div className="mt-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${planBadge.tone}`}>
                      {planBadge.label}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="p-1.5 space-y-0.5">
                <Link href="/settings" onClick={() => setIsProfileOpen(false)} className={`flex items-center gap-3 px-3 h-[36px] text-sm font-medium rounded-lg transition-colors ${isAdmin ? "text-slate-300 hover:bg-gray-800" : "text-slate-700 hover:bg-slate-50"}`}>
                  <User className={`w-4 h-4 ${isAdmin ? "text-slate-500" : "text-slate-400"}`} /> {t("navigation.myProfile")}
                </Link>
                <Link href="/security" onClick={() => setIsProfileOpen(false)} className={`flex items-center gap-3 px-3 h-[36px] text-sm font-medium rounded-lg transition-colors ${isAdmin ? "text-slate-300 hover:bg-gray-800" : "text-slate-700 hover:bg-slate-50"}`}>
                  <Shield className={`w-4 h-4 ${isAdmin ? "text-slate-500" : "text-slate-400"}`} /> {t("navigation.security")}
                </Link>
                <Link href="/settings" onClick={() => setIsProfileOpen(false)} className={`flex items-center gap-3 px-3 h-[36px] text-sm font-medium rounded-lg transition-colors ${isAdmin ? "text-slate-300 hover:bg-gray-800" : "text-slate-700 hover:bg-slate-50"}`}>
                  <Settings className={`w-4 h-4 ${isAdmin ? "text-slate-500" : "text-slate-400"}`} /> {t("navigation.settings")}
                </Link>
              </div>
              <div className={`p-1.5 border-t ${isAdmin ? "border-slate-700" : "border-slate-100"}`}>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = window.confirm(t("common.areYouSureSignOut"));
                    if (!ok) return;
                    setIsProfileOpen(false);
                    try {
                      await logOut();
                    } catch (err) {
                      console.error("[Topbar] logOut failed:", err);
                    }
                    router.push("/login");
                  }}
                  className={`flex items-center gap-3 px-3 h-[36px] text-sm font-medium rounded-lg transition-colors w-full text-left ${isAdmin ? "text-red-400 hover:bg-red-900/20" : "text-red-600 hover:bg-red-50"}`}
                >
                  <LogOut className="w-4 h-4" /> {t("common.signOut")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
