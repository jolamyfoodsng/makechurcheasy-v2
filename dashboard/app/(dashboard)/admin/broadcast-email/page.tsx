"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock4, Code2, Eye, FileText, Loader2, Mail, MousePointerClick, RefreshCw, Save, Send, Trash2, TriangleAlert, Users, X } from "lucide-react";

type Audience =
  | "all_users"
  | "free_users"
  | "paid_users"
  | "trial_users"
  | "basic_users"
  | "growth_users"
  | "ambassador_users"
  | "just_subscribed"
  | "cancelled_users"
  | "expired_trials"
  | "inactive_7d"
  | "inactive_30d"
  | "active_7d"
  | "active_30d"
  | "never_opened_app"
  | "selected_users";

const AUDIENCES: Array<{ value: Audience; label: string; hint: string }> = [
  { value: "selected_users", label: "Specific people (e.g. a test to yourself)", hint: "Only the account emails you list below" },
  { value: "all_users", label: "Everyone", hint: "Every registered user" },
  { value: "free_users", label: "Free plan", hint: "Users on the free plan" },
  { value: "paid_users", label: "Paying subscribers", hint: "Active paid accounts" },
  { value: "trial_users", label: "On a trial", hint: "Accounts currently in their trial" },
  { value: "basic_users", label: "Basic plan", hint: "Users on Basic" },
  { value: "growth_users", label: "Growth plan", hint: "Users on Growth" },
  { value: "ambassador_users", label: "Ambassadors", hint: "Ambassadors and affiliates" },
  { value: "just_subscribed", label: "New subscribers", hint: "Subscribed in the last 14 days" },
  { value: "cancelled_users", label: "Cancelled", hint: "Users who cancelled their subscription" },
  { value: "expired_trials", label: "Expired trials", hint: "Trial ended without upgrading" },
  { value: "active_7d", label: "Active in the last 7 days", hint: "Signed in or used the app in the last week" },
  { value: "active_30d", label: "Active in the last 30 days", hint: "Signed in or used the app in the last month" },
  { value: "inactive_7d", label: "Inactive for 7 days", hint: "No activity in the last week" },
  { value: "inactive_30d", label: "Inactive for 30 days", hint: "No activity in the last month" },
  { value: "never_opened_app", label: "Never opened the app", hint: "Signed up but never opened the desktop app" },
];

type BodyMode = "text" | "html";

interface ActiveDiscount {
  _id: string;
  title: string;
  offerCode: string;
  offerDiscountPercent: number;
  offerDurationMonths?: number;
  status: string;
  expiresAt?: string | null;
}

type AppVersionInUse = { version: string; users: number };

/** "3.2.1" → "3": the version families shown as quick picks. */
function majorVersions(versions: AppVersionInUse[]): AppVersionInUse[] {
  const counts = new Map<string, number>();
  for (const { version, users } of versions) {
    const major = version.replace(/^v/i, "").split(".")[0];
    if (/^\d+$/.test(major)) counts.set(major, (counts.get(major) || 0) + users);
  }
  return [...counts.entries()]
    .map(([version, users]) => ({ version, users }))
    .sort((a, b) => Number(b.version) - Number(a.version));
}

function parseEmailList(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function parseVersionList(value: string): string[] {
  return [...new Set(value.split(",").map((v) => v.trim().replace(/^v/i, "")).filter(Boolean))];
}

interface SavedTemplate {
  _id: string;
  name: string;
  subject: string;
  bodyMode: BodyMode;
  bodyText: string | null;
  bodyHtml: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

type CampaignStatus = "scheduled" | "sending" | "sent" | "failed";

interface Campaign {
  _id: string;
  subject: string;
  bodyText: string;
  audience: Audience;
  status: CampaignStatus;
  scheduledFor: string | null;
  createdAt: string;
  sendCompletedAt: string | null;
  stats: { recipients: number; sent: number; failed: number; skippedOptOut: number; capped: boolean };
  engagement?: { delivered: number; opened: number; clicked: number };
  recipientEmails?: string[] | null;
}

type RecipientFilter = "all" | "opened" | "clicked" | "not_opened" | "failed";

interface CampaignRecipient {
  _id: string;
  email: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  clicks: Array<{ url: string; at: string }>;
}

const RECIPIENT_FILTERS: Array<{ value: RecipientFilter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "not_opened", label: "Not opened" },
  { value: "failed", label: "Failed" },
];

function percent(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

type Toast = { type: "success" | "error"; message: string };

const defaultForm = {
  subject: "",
  bodyText: "",
  bodyHtml: "",
  bodyMode: "text" as BodyMode,
  ctaLabel: "",
  ctaUrl: "",
  audience: "all_users" as Audience,
  appVersions: "",
  discountCode: "",
  recipientEmails: "",
  scheduleMode: "send_now" as "send_now" | "schedule_later",
  scheduledFor: "",
};

type Preview = {
  recipientCount: number;
  skippedOptOut: number;
  capped: boolean;
  notFound?: string[];
  skippedIneligible?: number;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

const STATUS_BADGE_CLASS: Record<CampaignStatus, string> = {
  scheduled: "adm-badge adm-badge--info",
  sending: "adm-badge adm-badge--warning",
  sent: "adm-badge adm-badge--success",
  failed: "adm-badge adm-badge--danger",
};

export default function AdminBroadcastEmailPage() {
  const [form, setForm] = useState(defaultForm);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewingEmail, setPreviewingEmail] = useState(false);
  const [appVersionsInUse, setAppVersionsInUse] = useState<AppVersionInUse[]>([]);
  const [discounts, setDiscounts] = useState<ActiveDiscount[]>([]);
  const [openCampaign, setOpenCampaign] = useState<Campaign | null>(null);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("all");
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  useEffect(() => {
    if (!openCampaign) return;
    let cancelled = false;
    setLoadingRecipients(true);
    fetch(`/api/admin/broadcast-emails/${openCampaign._id}/recipients?filter=${recipientFilter}`, { credentials: "include" })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) throw new Error(body.error || "Failed to load recipients");
        setRecipients(body.recipients || []);
      })
      .catch((error) => {
        if (!cancelled) setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to load recipients" });
      })
      .finally(() => {
        if (!cancelled) setLoadingRecipients(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openCampaign, recipientFilter]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function updateForm(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function load(manual = false) {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/admin/broadcast-emails", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to load campaigns");
      setCampaigns(body.campaigns || []);
      setAppVersionsInUse(body.appVersions || []);
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to load campaigns" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    void loadTemplates();
    void loadDiscounts();
  }, []);

  async function loadDiscounts() {
    try {
      const res = await fetch("/api/admin/discounts", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const now = new Date().toISOString();
      setDiscounts(
        ((body.discounts || []) as ActiveDiscount[]).filter(
          (d) => d.status === "active" && d.offerCode && d.offerDiscountPercent > 0 && (!d.expiresAt || d.expiresAt > now)
        )
      );
    } catch {
      // Discounts are optional; the composer still works without them.
    }
  }

  async function loadTemplates() {
    try {
      const res = await fetch("/api/admin/broadcast-email-templates", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to load templates");
      setTemplates(body.templates || []);
    } catch {
      // Templates are a convenience; silently skip if they fail to load.
    }
  }

  function applyTemplate(template: SavedTemplate) {
    updateForm({
      subject: template.subject,
      bodyMode: template.bodyMode,
      bodyText: template.bodyMode === "text" ? template.bodyText || "" : "",
      bodyHtml: template.bodyMode === "html" ? template.bodyHtml || "" : "",
      ctaLabel: template.ctaLabel || "",
      ctaUrl: template.ctaUrl || "",
    });
  }

  async function handleSaveTemplate() {
    if (!form.subject.trim() || !body) {
      setToast({ type: "error", message: "Add a subject and message body before saving a template." });
      return;
    }
    const name = window.prompt("Name this template", form.subject.trim())?.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/admin/broadcast-email-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject: form.subject.trim(),
          bodyMode: form.bodyMode,
          bodyText: form.bodyMode === "text" ? form.bodyText.trim() : undefined,
          bodyHtml: form.bodyMode === "html" ? form.bodyHtml.trim() : undefined,
          ctaLabel: form.ctaLabel.trim() || undefined,
          ctaUrl: form.ctaUrl.trim() || undefined,
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || "Failed to save template");
      setToast({ type: "success", message: "Template saved." });
      await loadTemplates();
      setSelectedTemplateId(resBody.template?._id || "");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to save template" });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    const template = templates.find((t) => t._id === selectedTemplateId);
    if (!template) return;
    if (!window.confirm(`Delete the template "${template.name}"?`)) return;
    setDeletingTemplate(true);
    try {
      const res = await fetch(`/api/admin/broadcast-email-templates/${template._id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || "Failed to delete template");
      setToast({ type: "success", message: "Template deleted." });
      setSelectedTemplateId("");
      await loadTemplates();
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to delete template" });
    } finally {
      setDeletingTemplate(false);
    }
  }

  async function handlePreviewEmail() {
    if (!form.subject.trim() || !body) {
      setToast({ type: "error", message: "Add a subject and message body first." });
      return;
    }
    setPreviewingEmail(true);
    try {
      const res = await fetch("/api/admin/broadcast-emails/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: form.subject.trim(),
          bodyText: form.bodyMode === "text" ? form.bodyText.trim() : undefined,
          bodyHtml: form.bodyMode === "html" ? form.bodyHtml.trim() : undefined,
          ctaLabel: form.ctaLabel.trim() || undefined,
          ctaUrl: form.discountCode ? undefined : form.ctaUrl.trim() || undefined,
          discountCode: form.discountCode || undefined,
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || "Failed to render preview");
      setPreviewHtml(resBody.html);
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to render preview" });
    } finally {
      setPreviewingEmail(false);
    }
  }

  // While any campaign is still sending, poll the list so stats update live.
  useEffect(() => {
    const hasActiveSend = campaigns.some((c) => c.status === "sending");
    if (hasActiveSend && !pollRef.current) {
      pollRef.current = setInterval(() => void load(), 4000);
    } else if (!hasActiveSend && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [campaigns]);

  function buildBasePayload() {
    return {
      subject: form.subject.trim(),
      bodyText: form.bodyMode === "text" ? form.bodyText.trim() : "",
      bodyHtml: form.bodyMode === "html" ? form.bodyHtml.trim() : undefined,
      ctaLabel: form.ctaLabel.trim() || undefined,
      ctaUrl: form.discountCode ? undefined : form.ctaUrl.trim() || undefined,
      audience: form.audience,
      appVersions: form.audience === "selected_users" ? [] : parseVersionList(form.appVersions),
      recipientEmails: form.audience === "selected_users" ? parseEmailList(form.recipientEmails) : undefined,
      discountCode: form.discountCode || undefined,
      scheduledFor: form.scheduleMode === "schedule_later" && form.scheduledFor ? new Date(form.scheduledFor).toISOString() : null,
    };
  }

  const body = form.bodyMode === "html" ? form.bodyHtml.trim() : form.bodyText.trim();

  async function handlePreview() {
    if (!form.subject.trim() || !body) {
      setToast({ type: "error", message: "Add a subject and message body first." });
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/admin/broadcast-emails", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildBasePayload(), dryRun: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to preview audience");
      setPreview({
        recipientCount: body.recipientCount,
        skippedOptOut: body.skippedOptOut,
        capped: body.capped,
        notFound: body.notFound,
        skippedIneligible: body.skippedIneligible,
      });
      setConfirming(true);
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to preview audience" });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirmSend() {
    if (!preview) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcast-emails", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildBasePayload(), dryRun: false, confirmCount: preview.recipientCount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to send");
      setToast({
        type: "success",
        message: body.status === "scheduled" ? "Broadcast scheduled." : "Broadcast is sending now.",
      });
      setConfirming(false);
      setPreview(null);
      setForm(defaultForm);
      await load();
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Failed to send broadcast" });
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  const audienceEntry = AUDIENCES.find((a) => a.value === form.audience);
  const isSelectedUsers = form.audience === "selected_users";
  const selectedVersions = isSelectedUsers ? [] : parseVersionList(form.appVersions);
  const selectedEmails = parseEmailList(form.recipientEmails);
  const selectedDiscount = discounts.find((d) => d.offerCode === form.discountCode);
  const versionFamilies = majorVersions(appVersionsInUse);

  function toggleVersion(version: string) {
    const next = selectedVersions.includes(version)
      ? selectedVersions.filter((v) => v !== version)
      : [...selectedVersions, version];
    updateForm({ appVersions: next.join(", ") });
  }

  return (
    <div className="adm-page">
      {toast && (
        <div
          role="status"
          className="fixed right-5 top-5 z-[80] flex items-center gap-2 rounded-lg border border-[var(--mce-admin-border-strong)] bg-[var(--mce-admin-surface-raised)] px-3.5 py-2.5 text-[13px] shadow-xl"
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--mce-admin-success)]" />
          ) : (
            <TriangleAlert className="h-4 w-4 text-[var(--mce-admin-danger)]" />
          )}
          <span className="text-[var(--mce-admin-text)]">{toast.message}</span>
          <button type="button" className="adm-icon-btn !h-6 !w-6" onClick={() => setToast(null)} aria-label="Dismiss message">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <header className="adm-header">
        <div>
          <h1 className="adm-title">Broadcast Email</h1>
          <p className="adm-subtitle">Compose one email and send it to all users or a chosen segment.</p>
        </div>
        <button type="button" className="adm-icon-btn" onClick={() => void load(true)} disabled={refreshing || loading} aria-label="Refresh" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="adm-card p-5 space-y-4">
          <div>
            <label className="adm-label" htmlFor="broadcast-template">Template (optional)</label>
            <div className="flex items-center gap-2">
              <select
                id="broadcast-template"
                className="adm-input w-full"
                value={selectedTemplateId}
                onChange={(e) => {
                  setSelectedTemplateId(e.target.value);
                  const template = templates.find((t) => t._id === e.target.value);
                  if (template) applyTemplate(template);
                }}
              >
                <option value="">{templates.length ? "Choose a saved template…" : "No saved templates yet"}</option>
                {templates.map((t) => (
                  <option key={t._id} value={t._id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="adm-icon-btn"
                onClick={() => void handleSaveTemplate()}
                disabled={savingTemplate || !form.subject.trim() || !body}
                title="Save current message as a template"
                aria-label="Save as template"
              >
                {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </button>
              <button
                type="button"
                className="adm-icon-btn"
                onClick={() => void handleDeleteTemplate()}
                disabled={deletingTemplate || !selectedTemplateId}
                title="Delete selected template"
                aria-label="Delete template"
              >
                {deletingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
            <p className="adm-hint">Pick a saved template to fill the form, or write your message and save it as a new one.</p>
          </div>

          <div>
            <label className="adm-label" htmlFor="broadcast-subject">Subject</label>
            <input
              id="broadcast-subject"
              className="adm-input w-full"
              value={form.subject}
              onChange={(e) => updateForm({ subject: e.target.value })}
              placeholder="An update from MakeChurchEazy"
              maxLength={200}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="adm-label !mb-0" htmlFor="broadcast-body">Message</label>
              <div className="adm-seg" role="group" aria-label="Body format">
                <button
                  type="button"
                  className={`adm-seg__item inline-flex items-center gap-1.5 ${form.bodyMode === "text" ? "adm-seg__item--active" : ""}`}
                  onClick={() => updateForm({ bodyMode: "text" })}
                >
                  <FileText className="h-3.5 w-3.5" /> Plain text
                </button>
                <button
                  type="button"
                  className={`adm-seg__item inline-flex items-center gap-1.5 ${form.bodyMode === "html" ? "adm-seg__item--active" : ""}`}
                  onClick={() => updateForm({ bodyMode: "html" })}
                >
                  <Code2 className="h-3.5 w-3.5" /> Paste HTML
                </button>
              </div>
            </div>
            {form.bodyMode === "text" ? (
              <>
                <textarea
                  id="broadcast-body"
                  className="adm-input w-full min-h-[220px]"
                  value={form.bodyText}
                  onChange={(e) => updateForm({ bodyText: e.target.value })}
                  placeholder={"Hi {name},\n\nWrite your update here. Leave a blank line between paragraphs."}
                  maxLength={20000}
                />
                <p className="adm-hint">Plain text. Blank lines start a new paragraph. An unsubscribe link is added automatically.</p>
              </>
            ) : (
              <>
                <textarea
                  id="broadcast-body"
                  className="adm-input w-full min-h-[220px] font-mono text-[12px]"
                  value={form.bodyHtml}
                  onChange={(e) => updateForm({ bodyHtml: e.target.value })}
                  placeholder="<p>Paste your email HTML here…</p>"
                  maxLength={100000}
                />
                <p className="adm-hint">Sent exactly as pasted, inside our branded header/footer. An unsubscribe link is still added automatically.</p>
              </>
            )}
          </div>

          <div>
            <label className="adm-label" htmlFor="broadcast-discount">Attach a discount (optional)</label>
            <select
              id="broadcast-discount"
              className="adm-input w-full"
              value={form.discountCode}
              onChange={(e) => updateForm({ discountCode: e.target.value })}
            >
              <option value="">{discounts.length ? "No discount" : "No active discounts — create one under Discounts"}</option>
              {discounts.map((d) => (
                <option key={d._id} value={d.offerCode}>
                  {d.offerCode} — {d.offerDiscountPercent}% off ({d.title})
                </option>
              ))}
            </select>
            <p className="adm-hint">
              {selectedDiscount
                ? `The email shows the code and a button that opens the Plans page with ${selectedDiscount.offerDiscountPercent}% off already applied. Only people the discount is available to receive it.`
                : "Adds the code to the email with a button that applies it on the user's dashboard."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="adm-label" htmlFor="broadcast-cta-label">CTA button label (optional)</label>
              <input
                id="broadcast-cta-label"
                className="adm-input w-full"
                value={form.ctaLabel}
                onChange={(e) => updateForm({ ctaLabel: e.target.value })}
                placeholder={selectedDiscount ? `Claim ${selectedDiscount.offerDiscountPercent}% off` : "See what's new"}
              />
            </div>
            <div>
              <label className="adm-label" htmlFor="broadcast-cta-url">CTA URL (optional)</label>
              <input
                id="broadcast-cta-url"
                className="adm-input w-full"
                value={selectedDiscount ? "" : form.ctaUrl}
                onChange={(e) => updateForm({ ctaUrl: e.target.value })}
                placeholder={selectedDiscount ? "Set by the discount" : "https://..."}
                disabled={Boolean(selectedDiscount)}
              />
            </div>
          </div>

          <div>
            <label className="adm-label" htmlFor="broadcast-audience">Audience</label>
            <select
              id="broadcast-audience"
              className="adm-input w-full"
              value={form.audience}
              onChange={(e) => updateForm({ audience: e.target.value as Audience })}
            >
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            {audienceEntry ? <p className="adm-hint">{audienceEntry.hint}</p> : null}
          </div>

          {isSelectedUsers ? (
          <div>
            <label className="adm-label" htmlFor="broadcast-recipients">Send to these accounts</label>
            <textarea
              id="broadcast-recipients"
              className="adm-input w-full min-h-[80px]"
              value={form.recipientEmails}
              onChange={(e) => updateForm({ recipientEmails: e.target.value })}
              placeholder={"you@yourchurch.org\nsomeone@example.com"}
            />
            <p className="adm-hint">
              Account emails, one per line or separated by commas (up to 50). Use your own address to test the email, the discount link and the open/click tracking before sending to everyone.
            </p>
          </div>
          ) : (
          <div>
            <label className="adm-label" htmlFor="broadcast-versions">Desktop app version (optional)</label>
            {versionFamilies.length ? (
              <div className="adm-seg flex-wrap mb-2" role="group" aria-label="Version quick picks">
                {versionFamilies.map((v) => (
                  <button
                    key={v.version}
                    type="button"
                    className={`adm-seg__item ${selectedVersions.includes(v.version) ? "adm-seg__item--active" : ""}`}
                    onClick={() => toggleVersion(v.version)}
                    aria-pressed={selectedVersions.includes(v.version)}
                  >
                    Version {v.version} · {v.users.toLocaleString()}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              id="broadcast-versions"
              className="adm-input w-full"
              value={form.appVersions}
              onChange={(e) => updateForm({ appVersions: e.target.value })}
              placeholder="Any version — or e.g. 3, 4.1, 4.2.0"
              list="broadcast-version-options"
            />
            <datalist id="broadcast-version-options">
              {appVersionsInUse.map((v) => (
                <option key={v.version} value={v.version}>{`${v.users} user${v.users === 1 ? "" : "s"}`}</option>
              ))}
            </datalist>
            <p className="adm-hint">
              Only people whose desktop app is on one of these versions. &ldquo;4&rdquo; matches every 4.x release. Leave blank for everyone in the audience.
            </p>
          </div>
          )}

          <div className="adm-card p-4 space-y-3" style={{ background: "var(--mce-admin-bg)" }}>
            <div className="adm-seg flex-wrap" role="group" aria-label="When to send">
              <button
                type="button"
                className={`adm-seg__item ${form.scheduleMode === "send_now" ? "adm-seg__item--active" : ""}`}
                onClick={() => updateForm({ scheduleMode: "send_now" })}
              >
                Send now
              </button>
              <button
                type="button"
                className={`adm-seg__item ${form.scheduleMode === "schedule_later" ? "adm-seg__item--active" : ""}`}
                onClick={() => updateForm({ scheduleMode: "schedule_later" })}
              >
                Schedule for later
              </button>
            </div>
            {form.scheduleMode === "schedule_later" ? (
              <div>
                <label className="adm-label" htmlFor="broadcast-schedule">Send at</label>
                <input
                  id="broadcast-schedule"
                  type="datetime-local"
                  className="adm-input w-full"
                  value={form.scheduledFor}
                  onChange={(e) => updateForm({ scheduledFor: e.target.value })}
                />
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="adm-hint max-w-sm">
              This sends a real email to every matching user and can't be undone. You'll review the recipient count before anything goes out.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="adm-btn adm-btn--ghost"
                onClick={() => void handlePreviewEmail()}
                disabled={previewingEmail || !form.subject.trim() || !body}
              >
                {previewingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview email
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                onClick={() => void handlePreview()}
                disabled={previewing || !form.subject.trim() || !body}
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Review &amp; {form.scheduleMode === "schedule_later" ? "schedule" : "send"}
              </button>
            </div>
          </div>
        </div>

        <div className="adm-card p-5">
          <div className="adm-card__head !border-0 !p-0 !mb-4">
            <div className="adm-card__title">
              <Mail className="inline h-4 w-4 mr-2" />
              Recent broadcasts
            </div>
          </div>
          {loading ? (
            <div className="adm-empty">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading…
            </div>
          ) : campaigns.length === 0 ? (
            <div className="adm-empty">No broadcasts sent yet.</div>
          ) : (
            <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              {campaigns.map((c) => (
                <div key={c._id} className="rounded-lg border p-3.5" style={{ borderColor: "var(--mce-admin-border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-[var(--mce-admin-text)]">{c.subject}</p>
                    <span className={STATUS_BADGE_CLASS[c.status]}>{STATUS_LABEL[c.status]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--mce-admin-text-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <Clock4 className="h-3 w-3" />
                      {c.status === "scheduled" ? formatDate(c.scheduledFor) : formatDate(c.sendCompletedAt || c.createdAt)}
                    </span>
                    <span>
                      {c.audience === "selected_users"
                        ? (c.recipientEmails || []).slice(0, 2).join(", ") + ((c.recipientEmails?.length || 0) > 2 ? ` +${(c.recipientEmails?.length || 0) - 2}` : "")
                        : AUDIENCES.find((a) => a.value === c.audience)?.label || c.audience}
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <div className="rounded-md px-2.5 py-1.5" style={{ background: "var(--mce-admin-surface-raised)" }}>
                      <div className="adm-stat__label !text-[10px]">Recipients</div>
                      <div className="text-[13px] font-semibold text-[var(--mce-admin-text)]">{c.stats.recipients}</div>
                    </div>
                    <div className="rounded-md px-2.5 py-1.5" style={{ background: "var(--mce-admin-surface-raised)" }}>
                      <div className="adm-stat__label !text-[10px]">Sent</div>
                      <div className="text-[13px] font-semibold text-[var(--mce-admin-success)]">{c.stats.sent}</div>
                    </div>
                    <div className="rounded-md px-2.5 py-1.5" style={{ background: "var(--mce-admin-surface-raised)" }}>
                      <div className="adm-stat__label !text-[10px]">Failed</div>
                      <div className="text-[13px] font-semibold text-[var(--mce-admin-danger)]">{c.stats.failed}</div>
                    </div>
                  </div>
                  {c.stats.skippedOptOut > 0 ? (
                    <p className="adm-hint mt-1.5">{c.stats.skippedOptOut} skipped (unsubscribed from marketing email)</p>
                  ) : null}
                  {c.status !== "scheduled" ? (
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--mce-admin-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          Opened <strong className="text-[var(--mce-admin-text)]">{c.engagement?.opened ?? 0}</strong> ({percent(c.engagement?.opened ?? 0, c.engagement?.delivered ?? c.stats.sent)})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MousePointerClick className="h-3 w-3" />
                          Clicked <strong className="text-[var(--mce-admin-text)]">{c.engagement?.clicked ?? 0}</strong> ({percent(c.engagement?.clicked ?? 0, c.engagement?.delivered ?? c.stats.sent)})
                        </span>
                      </div>
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost !h-7 !px-2.5 !text-[12px]"
                        onClick={() => {
                          setRecipientFilter("all");
                          setRecipients([]);
                          setOpenCampaign(c);
                        }}
                      >
                        <Users className="h-3.5 w-3.5" /> Who opened / clicked
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirming && preview ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <div className="adm-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "var(--mce-admin-accent-soft)" }}>
                <Send className="h-5 w-5 text-[var(--mce-admin-accent-bright)]" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--mce-admin-text)]">
                  {form.scheduleMode === "schedule_later" ? "Confirm scheduled broadcast" : "Confirm broadcast send"}
                </h2>
                <p className="adm-hint">This can't be undone once it goes out.</p>
              </div>
            </div>

            <div className="rounded-lg border p-3.5 space-y-1.5 text-[13px]" style={{ borderColor: "var(--mce-admin-border)" }}>
              <p><span className="text-[var(--mce-admin-text-muted)]">Subject:</span> <span className="text-[var(--mce-admin-text)] font-medium">{form.subject}</span></p>
              <p>
                <span className="text-[var(--mce-admin-text-muted)]">Audience:</span>{" "}
                <span className="text-[var(--mce-admin-text)] font-medium">{isSelectedUsers ? selectedEmails.join(", ") : audienceEntry?.label}</span>
              </p>
              {selectedVersions.length ? (
                <p><span className="text-[var(--mce-admin-text-muted)]">App versions:</span> <span className="text-[var(--mce-admin-text)] font-medium">{selectedVersions.join(", ")}</span></p>
              ) : null}
              {selectedDiscount ? (
                <p><span className="text-[var(--mce-admin-text-muted)]">Discount:</span> <span className="text-[var(--mce-admin-text)] font-medium">{selectedDiscount.offerCode} — {selectedDiscount.offerDiscountPercent}% off</span></p>
              ) : null}
              <p><span className="text-[var(--mce-admin-text-muted)]">Recipients right now:</span> <span className="text-[var(--mce-admin-text)] font-semibold">{preview.recipientCount.toLocaleString()}</span></p>
              {preview.skippedOptOut > 0 ? (
                <p className="text-[var(--mce-admin-text-muted)]">{preview.skippedOptOut.toLocaleString()} more opted out of marketing email and will be skipped.</p>
              ) : null}
              {preview.notFound?.length ? (
                <p className="text-[var(--mce-admin-warning)]">No account found for: {preview.notFound.join(", ")}</p>
              ) : null}
              {preview.skippedIneligible ? (
                <p className="text-[var(--mce-admin-warning)]">{preview.skippedIneligible} skipped because the discount isn&apos;t available to them.</p>
              ) : null}
              {preview.capped ? (
                <p className="text-[var(--mce-admin-warning)]">This audience is larger than the per-campaign cap — only the first batch will be sent.</p>
              ) : null}
              {form.scheduleMode === "schedule_later" ? (
                <p><span className="text-[var(--mce-admin-text-muted)]">Sends at:</span> <span className="text-[var(--mce-admin-text)] font-medium">{formatDate(new Date(form.scheduledFor).toISOString())}</span></p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setConfirming(false)} disabled={sending}>
                Cancel
              </button>
              <button type="button" className="adm-btn adm-btn--primary" onClick={() => void handleConfirmSend()} disabled={sending || preview.recipientCount === 0}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {form.scheduleMode === "schedule_later" ? "Confirm schedule" : `Send to ${preview.recipientCount.toLocaleString()} ${preview.recipientCount === 1 ? "person" : "people"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openCampaign ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-8" role="dialog" aria-modal="true">
          <div className="adm-card flex w-full max-w-3xl flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
            <div className="flex items-start justify-between gap-3 border-b p-4" style={{ borderColor: "var(--mce-admin-border)" }}>
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-[var(--mce-admin-text)]">{openCampaign.subject}</h2>
                <p className="adm-hint">
                  Opened {openCampaign.engagement?.opened ?? 0} · Clicked {openCampaign.engagement?.clicked ?? 0} · Delivered {openCampaign.engagement?.delivered ?? openCampaign.stats.sent}.
                  Opens are approximate — some mail apps load or block images on their own; clicks are exact.
                </p>
              </div>
              <button type="button" className="adm-icon-btn" onClick={() => setOpenCampaign(null)} aria-label="Close recipients">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--mce-admin-border)" }}>
              <div className="adm-seg flex-wrap" role="group" aria-label="Filter recipients">
                {RECIPIENT_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`adm-seg__item ${recipientFilter === f.value ? "adm-seg__item--active" : ""}`}
                    onClick={() => setRecipientFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingRecipients ? (
                <div className="adm-empty">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading…
                </div>
              ) : recipients.length === 0 ? (
                <div className="adm-empty">No one here yet.</div>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[var(--mce-admin-text-muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Opened</th>
                      <th className="px-4 py-2 font-medium">Clicked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r._id} className="border-t align-top" style={{ borderColor: "var(--mce-admin-border)" }}>
                        <td className="px-4 py-2 text-[var(--mce-admin-text)]">
                          {r.email}
                          {r.status === "failed" ? (
                            <div className="text-[var(--mce-admin-danger)]">Not delivered{r.error ? ` — ${r.error}` : ""}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-[var(--mce-admin-text-muted)]">
                          {r.openedAt ? `${formatDate(r.openedAt)}${r.openCount > 1 ? ` · ${r.openCount}×` : ""}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-[var(--mce-admin-text-muted)]">
                          {r.clickedAt ? (
                            <>
                              {formatDate(r.clickedAt)}
                              {r.clickCount > 1 ? ` · ${r.clickCount}×` : ""}
                              {[...new Set(r.clicks.map((k) => k.url))].map((url) => (
                                <div key={url} className="max-w-[260px] truncate text-[var(--mce-admin-text)]" title={url}>{url}</div>
                              ))}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {previewHtml !== null ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-8" role="dialog" aria-modal="true">
          <div className="adm-card flex w-full max-w-2xl flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
            <div className="flex items-center justify-between border-b p-4" style={{ borderColor: "var(--mce-admin-border)" }}>
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[var(--mce-admin-text-muted)]" />
                <h2 className="text-[15px] font-semibold text-[var(--mce-admin-text)]">Email preview</h2>
              </div>
              <button type="button" className="adm-icon-btn" onClick={() => setPreviewHtml(null)} aria-label="Close preview">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-white">
              <iframe title="Broadcast email preview" srcDoc={previewHtml} sandbox="" className="h-[70vh] w-full" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
