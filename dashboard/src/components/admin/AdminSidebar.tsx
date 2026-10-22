"use client";

import {
  LayoutDashboard,
  Users,
  Contact,
  Landmark,
  CreditCard,
  Zap,
  BarChart3,
  Monitor,
  Crown,
  Headset,
  FileText,
  Settings,
  Mail,
  MailOpen,
  Megaphone,
  Palette,
  UploadCloud,
  X,
  Gift,
  FlaskConical,
  GraduationCap,
  ArrowLeft,
  Percent,
  Repeat2,
  AlertTriangle,
  ShieldAlert,
  Newspaper,
  Radio,
  MonitorPlay,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "../../lib/utils";

interface NavItem {
  path: string;
  labelKey?: string;
  label?: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const corePlatformItems: NavItem[] = [
  { path: "/admin", labelKey: "admin.sidebar.dashboard", icon: LayoutDashboard, exact: true },
  { path: "/admin/users", labelKey: "admin.sidebar.users", icon: Users },
  { path: "/admin/contacts", label: "Contacts", icon: Contact },
  { path: "/admin/churches", labelKey: "admin.sidebar.churches", icon: Landmark },
  { path: "/admin/subscriptions", labelKey: "admin.sidebar.subscriptions", icon: CreditCard },
];

const broadcastReachItems: NavItem[] = [
  { path: "/admin/blog", label: "Blog & Stories", icon: Newspaper },
  { path: "/admin/communications", label: "Communications", icon: Mail },
  { path: "/admin/email-previews", label: "Email Previews", icon: MailOpen },
  { path: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { path: "/admin/multistream", label: "Multi-Stream Usage", icon: Radio },
  { path: "/admin/broadcast-graphics", label: "Broadcast Graphics", icon: MonitorPlay },
  { path: "/admin/production-themes", label: "Production Themes", icon: Palette },
  { path: "/admin/tutorials", label: "Tutorials", icon: GraduationCap },
  { path: "/admin/release-mirror", label: "Release Mirror", icon: UploadCloud },
];

const growthSystemItems: NavItem[] = [
  { path: "/admin/discounts", label: "Discounts", icon: Percent },
  { path: "/admin/offers", label: "Win-back Offers", icon: Repeat2 },
  { path: "/admin/referrals", label: "Referrals", icon: Gift },
  { path: "/admin/credits", labelKey: "admin.sidebar.credits", icon: Zap },
  { path: "/admin/analytics", labelKey: "admin.sidebar.analytics", icon: BarChart3 },
  { path: "/admin/devices", labelKey: "admin.sidebar.devices", icon: Monitor },
  { path: "/admin/ambassadors", labelKey: "admin.sidebar.ambassadors", icon: Crown },
  { path: "/admin/activation", label: "Activation", icon: FlaskConical },
  { path: "/admin/support", labelKey: "admin.sidebar.support", icon: Headset },
  { path: "/admin/audit-logs", labelKey: "admin.sidebar.auditLogs", icon: FileText },
  { path: "/admin/error-logs", label: "Error Logs", icon: AlertTriangle },
  { path: "/admin/security-events", label: "Security Events", icon: ShieldAlert },
  { path: "/admin/settings", labelKey: "admin.sidebar.settings", icon: Settings },
];

export function AdminSidebar({ isOpen, setIsOpen }: { isOpen?: boolean; setIsOpen?: (v: boolean) => void }) {
  const t = useTranslations();
  const pathname = usePathname();

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div>
      <div className="mce-admin-nav-group-label px-3 mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path);
          const label = item.labelKey ? t(item.labelKey) : item.label;

          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => setIsOpen?.(false)}
              className={cn(
                "mce-admin-nav-link transition text-xs",
                isActive
                  ? "mce-admin-nav-link--active flex items-center justify-between px-3 py-2 rounded-lg bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 font-semibold shadow-sm shadow-indigo-950"
                  : "flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 font-medium"
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className={cn("w-4 h-4", isActive ? "text-indigo-400" : "text-slate-500")} />
                {label}
              </span>
              {isActive && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen?.(false)}
        />
      )}

      <aside
        className={cn(
          "mce-admin-sidebar fixed left-0 top-0 h-full w-[260px] flex flex-col border-r border-slate-800/80 bg-[#0B101E] z-50 select-none transition-transform duration-300 md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Top Branding */}
        <div className="mce-admin-sidebar__brand h-16 flex items-center justify-between px-5 border-b border-slate-800/80 shrink-0">
          <Link href="/admin" className="flex items-center space-x-3">
            <div className="mce-admin-brand-mark w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-bold text-base">
              ☩
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-white flex items-center gap-1.5">
                MakeChurchEazy
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 font-bold">
                  Admin
                </span>
              </span>
              <span className="text-xs text-slate-400">Church Operations</span>
            </div>
          </Link>
          <button
            className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800/60 transition"
            onClick={() => setIsOpen?.(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Navigation */}
        <nav className="mce-admin-sidebar__nav flex-1 overflow-y-auto px-3 py-4 space-y-6 text-xs">
          {renderNavGroup("Core Platform", corePlatformItems)}
          {renderNavGroup("Broadcast & Reach", broadcastReachItems)}
          {renderNavGroup("Growth & System", growthSystemItems)}
        </nav>

        {/* Bottom User Profile / Back Link */}
        <div className="mce-admin-sidebar__footer p-3 border-t border-slate-800/80 bg-[#0A0E1A] shrink-0 mt-auto">
          <Link
            href="/dashboard"
            onClick={() => setIsOpen?.(false)}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/60 transition group"
          >
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 group-hover:border-indigo-500 transition">
              A
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium text-slate-200 truncate group-hover:text-white">
                Admin Workspace
              </span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3 text-slate-400" />
                Back to User App
              </span>
            </div>
          </Link>
        </div>
      </aside>
    </>
  );
}
