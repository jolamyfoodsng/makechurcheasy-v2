"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

interface PendingUserModal {
  id: string;
  title: string;
  message: string;
  type: "success" | "warning" | "error" | "info";
  actionUrl?: string | null;
  actionLabel?: string | null;
  requiresAcknowledgement: boolean;
  summaryRows?: Array<{ label: string; value: string }>;
}

function iconForType(type: PendingUserModal["type"]) {
  if (type === "success") return CheckCircle2;
  if (type === "warning") return AlertTriangle;
  if (type === "error") return XCircle;
  return Info;
}

function accentForType(type: PendingUserModal["type"]) {
  if (type === "success") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (type === "warning") return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  if (type === "error") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
}

/**
 * "Account Update" pop-ups queued by the server. The /api/user/modals route behind them is not in the
 * API source right now, so asking for it only produced a 404 on every page and every window focus.
 * Set NEXT_PUBLIC_USER_MODALS=true once the route is deployed to switch them back on.
 */
const USER_MODALS_ENABLED = process.env.NEXT_PUBLIC_USER_MODALS === "true";

export function UserPendingModalHost() {
  return USER_MODALS_ENABLED ? <PendingModalHost /> : null;
}

function PendingModalHost() {
  const router = useRouter();
  const [modal, setModal] = useState<PendingUserModal | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/user/modals", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setModal(data.modal || null);
    } catch (error) {
      console.error("[UserPendingModalHost] Failed to fetch pending modal:", error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  async function acknowledgeModal() {
    if (!modal) return;
    await fetch("/api/user/modals", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modalId: modal.id }),
    }).catch(() => {});
    setModal(null);
  }

  if (!modal) return null;

  const Icon = iconForType(modal.type);
  const accent = accentForType(modal.type);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="px-6 pt-6">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${accent}`}>
            <Icon className="w-4 h-4" />
            <span>Account Update</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">{modal.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{modal.message}</p>
        </div>

        {modal.summaryRows && modal.summaryRows.length > 0 && (
          <div className="mx-6 mt-5 rounded-2xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
            {modal.summaryRows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="flex items-start justify-between gap-4 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</span>
                <span className="text-sm font-medium text-slate-900 text-right">{row.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5 mt-6 border-t border-slate-200 flex items-center justify-end gap-3">
          {modal.actionUrl && (
            <button
              type="button"
              onClick={() => router.push(modal.actionUrl!)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {modal.actionLabel || "Open"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void acknowledgeModal()}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
