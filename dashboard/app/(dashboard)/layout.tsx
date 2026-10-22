"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Topbar } from "@/components/Topbar";
import { TrialBanner } from "@/components/TrialBanner";
import { AppUpdateNotice } from "@/components/AppUpdateNotice";
import { TrialWelcomeModal } from "@/components/TrialWelcomeModal";
import { FirstLoginWelcomeModal } from "@/components/FirstLoginWelcomeModal";
import { ProfileCompletionModal } from "@/components/ProfileCompletionModal";
import { PremiumWelcomeModal } from "@/components/PremiumWelcomeModal";
import { TrialExpiredUpgradeModal } from "@/components/TrialExpiredUpgradeModal";
import { UserPendingModalHost } from "@/components/UserPendingModalHost";
import { AnnouncementModalHost } from "@/components/AnnouncementModalHost";
import { ReferralCodePrompt } from "@/components/ReferralCodePrompt";
import { ActivationSurveyModal } from "@/components/ActivationSurveyModal";
import { AmbassadorWelcomeModal } from "@/components/AmbassadorWelcomeModal";
import { useAuth } from "@/contexts/AuthContext";

const SIDEBAR_COLLAPSED_KEY = "mce-dashboard-sidebar-collapsed";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { mongoUser, loading, logOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Desktop only: hide the sidebar to give pages the full width. Remembered per browser.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);

  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
      return next;
    });
  };

  const isAdminRoute = pathname.startsWith("/admin");
  const isActualAdmin = mongoUser?.role === "admin";

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isAdminRoute ? "bg-slate-900" : "bg-slate-50"}`}>
        <Loader2 className={`w-6 h-6 animate-spin ${isAdminRoute ? "text-slate-500" : "text-slate-400"}`} />
      </div>
    );
  }

  if (!mongoUser) {
    const callbackUrl =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/dashboard";
    const safeCallbackUrl =
      callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? callbackUrl
        : "/dashboard";
    router.replace(`/login?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`);
    return null;
  }

  // If user is accessing an /admin route without admin privileges,
  // do NOT render the admin sidebar, topbar, or internal workspace chrome.
  // Instead, show a clean, centered "Access Restricted" screen.
  if (isAdminRoute && !isActualAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center select-none font-sans">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6 shadow-xl shadow-amber-500/5">
          <ShieldAlert className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-slate-50 mb-2 tracking-tight">Access Restricted</h1>
        <p className="text-slate-400 text-sm max-w-md mb-8 leading-relaxed">
          You are signed in as <span className="font-semibold text-slate-200">{mongoUser.email}</span>, but your account does not have administrator privileges to view this section.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs sm:max-w-none justify-center">
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-all shadow-md active:scale-95"
          >
            Return to Dashboard
          </button>
          <button
            onClick={() => logOut()}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium text-sm transition-all border border-slate-800 active:scale-95"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = isAdminRoute && isActualAdmin;

  return (
    <div className={`mce-dashboard-shell min-h-screen flex font-sans ${isAdmin ? "mce-admin-mode bg-slate-900 text-slate-50" : "mce-user-mode bg-slate-50 text-slate-900"}`}>
      {isAdmin ? (
        <AdminSidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} collapsed={isSidebarCollapsed} />
      ) : (
        <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} collapsed={isSidebarCollapsed} />
      )}
      <div className={`flex-1 ${isSidebarCollapsed ? "md:ml-0" : isAdmin ? "md:ml-[260px]" : "md:ml-[280px]"} flex flex-col min-w-0 transition-[margin] duration-300`}>
        <Topbar
          onMenuClick={() => setIsSidebarOpen(true)}
          sidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={toggleSidebarCollapsed}
        />
        {!isAdmin && <AppUpdateNotice />}
        {!isAdmin && <TrialBanner />}
        <main className="mce-dashboard-main flex-1 overflow-x-hidden overflow-y-auto w-full">
          {children}
        </main>
      </div>
      {!isAdmin && <TrialWelcomeModal />}
      {!isAdmin && <FirstLoginWelcomeModal />}
      {!isAdmin && <ProfileCompletionModal />}
      {!isAdmin && <PremiumWelcomeModal />}
      {!isAdmin && <TrialExpiredUpgradeModal />}
      {!isAdmin && <AmbassadorWelcomeModal />}
      {!isAdmin && <UserPendingModalHost />}
      {!isAdmin && <AnnouncementModalHost />}
      {!isAdmin && <ReferralCodePrompt />}
      {!isAdmin && <ActivationSurveyModal />}
    </div>
  );
}
