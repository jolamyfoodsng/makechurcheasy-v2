import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Crown, Megaphone, Tag, X } from "./icons/NativeIcons";
import ModalDialog, { ModalChoices, ModalCodeRow, type ModalAction, type ModalTone } from "./ModalDialog";
import { useNavigate } from "react-router-dom";
import {
  clearCachedDesktopAnnouncement,
  getCachedDesktopAnnouncements,
  setCachedDesktopAnnouncements,
  subscribeToDesktopAnnouncements,
} from "../services/desktopConfig";
import {
  checkForAnnouncementUpdate,
  dismissDesktopAnnouncement,
  dismissDesktopAnnouncements,
  startAnnouncementWatcher,
  type AnnouncementButton,
  type AnnouncementLayout,
  type DiscountBillingCycle,
  type DesktopAnnouncement,
} from "../services/announcementService";
import { CustomHtmlFrame } from "./CustomHtmlFrame";
import { getDashboardSubscriptionPlansUrl, getDashboardUrl } from "../services/subscriptionNavigation";
import "./AnnouncementPager.css";

function toneLabel(tone: DesktopAnnouncement["tone"]) {
  if (tone === "upgrade") return "Upgrade";
  if (tone === "offer") return "Offer";
  if (tone === "warning") return "Notice";
  if (tone === "success") return "Update";
  return "Announcement";
}

export function withOfferCode(url: string, offerCode?: string | null): string {
  if (!url) return url;
  if (!offerCode) return url;
  try {
    const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
    const parsed = isAbsolute
      ? new URL(url)
      : new URL(url, "https://makechurcheazy.com");
    if (!parsed.searchParams.has("promo") && !parsed.searchParams.has("code")) {
      parsed.searchParams.set("promo", offerCode);
    }
    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}promo=${encodeURIComponent(offerCode)}`;
  }
}

/** Resolve one button or link destination (adds the offer code, maps the plans page). */
export function resolveButtonUrl(rawUrl: string, offerCode?: string | null): string {
  if (!rawUrl) return "";
  const resolved = withOfferCode(rawUrl, offerCode);
  try {
    const parsed = new URL(resolved, "https://makechurcheazy.com");
    if (parsed.pathname.replace(/\/$/, "") === "/subscription/plans") {
      return getDashboardSubscriptionPlansUrl(Object.fromEntries(parsed.searchParams.entries()));
    }
    // Win-back offers are claimed on the web dashboard, signed in as the same account.
    if (parsed.pathname.replace(/\/$/, "") === "/offers/claim") {
      return getDashboardUrl("/offers/claim", Object.fromEntries(parsed.searchParams.entries()));
    }
  } catch {
    // Preserve non-plan custom destinations as entered.
  }
  return resolved;
}

/** Which design to show. Older announcements have no `layout`, so work it out as before. */
export function resolveLayout(announcement: DesktopAnnouncement): AnnouncementLayout {
  const { layout } = announcement;
  if (layout === "custom") return announcement.bodyHtml ? "custom" : "standard";
  if (layout === "image_only") return announcement.imageUrl ? "image_only" : "standard";
  if (layout === "promo" || layout === "standard") return layout;

  const imageOnly = Boolean(
    announcement.imageUrl &&
      (announcement.tags?.some((t) => t.toLowerCase().includes("image-only")) ||
        announcement.format === "image_only")
  );
  if (imageOnly) return "image_only";
  const discountSignal = Boolean(
    clampDiscount(announcement.offerDiscountPercent) ||
      announcement.offerCode ||
      announcement.tags?.some((t) => t.toLowerCase().includes("discount") || t.toLowerCase().includes("offer")) ||
      ["offer", "upgrade"].includes(announcement.tone)
  );
  return discountSignal ? "promo" : "standard";
}

/** The buttons to show. Announcements without a `buttons` list use the classic call to action. */
export function getAnnouncementButtons(announcement: DesktopAnnouncement): AnnouncementButton[] {
  if (announcement.buttons?.length) return announcement.buttons;
  if (announcement.ctaUrl) {
    return [
      {
        id: "cta",
        label: announcement.ctaLabel || (announcement.offerCode ? "Claim Offer" : "Open"),
        url: announcement.ctaUrl,
        style: "primary",
      },
    ];
  }
  return [];
}

export function resolveActionUrl(
  announcement: DesktopAnnouncement | null,
  billingCycle?: DiscountBillingCycle
): string {
  if (!announcement) return "";
  if (announcement.ctaUrl) {
    return resolveButtonUrl(announcement.ctaUrl, announcement.offerCode);
  }
  const code = announcement.offerCode || "";
  const plan = announcement.offerApplicablePlans?.[0] || "growth";
  const cycle = billingCycle || announcement.offerApplicableBillingCycles?.[0] || "monthly";
  const params = new URLSearchParams();
  if (code) params.set("promo", code);
  params.set("plan", plan);
  params.set("billing", cycle);
  return getDashboardSubscriptionPlansUrl(Object.fromEntries(params.entries()));
}

function clampDiscount(value?: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return Math.min(95, Math.max(1, Math.round(value)));
}

function offerDurationLabel(months?: number | null): string {
  if (!months || months <= 0) return "limited time";
  if (months === 1) return "1 month";
  return `${months} months`;
}

function formatCountdown(expiresAt?: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (!Number.isFinite(target)) return null;

  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

function useAnnouncementCountdown(expiresAt?: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return formatCountdown(expiresAt, now);
}

function getOfferCards(announcement: DesktopAnnouncement, discountPercent: number) {
  const cycles = announcement.offerApplicableBillingCycles?.length
    ? announcement.offerApplicableBillingCycles
    : (["monthly", "yearly"] as DiscountBillingCycle[]);
  const duration = offerDurationLabel(announcement.offerDurationMonths);

  return [
    {
      cycle: "monthly" as DiscountBillingCycle,
      title: "Monthly Billing",
      meta: `Save ${discountPercent}%`,
      body: `Discount applies for ${duration}.`,
    },
    {
      cycle: "yearly" as DiscountBillingCycle,
      title: "Yearly Billing",
      meta: `Save ${discountPercent}%`,
      body: "Applies to annual plan checkout.",
    },
    {
      cycle: "lifetime" as DiscountBillingCycle,
      title: "Lifetime Access",
      meta: `Save ${discountPercent}%`,
      body: "One-time premium access.",
    },
  ].filter((card) => cycles.includes(card.cycle));
}

const DISMISS_STORAGE_KEY = "mce_dismissed_announcements_v1";
const WEB_APP_ORIGIN = "https://makechurcheazy.com";

const DESKTOP_ANNOUNCEMENT_ROUTES: Record<string, string> = {
  "/": "/",
  "/dashboard": "/",
  "/features": "/",
  "/features/bible": "/resources?tab=bible",
  "/features/worship": "/resources?tab=worship",
  "/features/media": "/resources?tab=media",
  "/features/voice-bible": "/speech-to-scripture",
  "/features/lower-thirds": "/broadcast-graphics",
  "/features/multiview": "/multiview",
  "/features/countdowns": "/countdowns",
  "/countdowns": "/countdowns",
  "/tutorials": "/tutorials",
  "/credits": "/credits",
  "/settings": "/settings",
};

function getDesktopAnnouncementRoute(url: string): string | null {
  try {
    const destination = new URL(url, WEB_APP_ORIGIN);
    if (destination.origin !== WEB_APP_ORIGIN) return null;
    return DESKTOP_ANNOUNCEMENT_ROUTES[destination.pathname] || null;
  } catch {
    return null;
  }
}

function isLocallyDismissed(id?: string, deliveryId?: string): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const record: Record<string, number> = JSON.parse(raw);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (id && record[id] && now - record[id] < oneDayMs) return true;
    if (deliveryId && record[deliveryId] && now - record[deliveryId] < oneDayMs) return true;
    return false;
  } catch {
    return false;
  }
}

// Delivery ids whose dismissal we already re-sent this session (prevents a
// loop if the server keeps rejecting it).
const resentDismissals = new Set<string>();

// Deliveries the user closed the carousel on without ever seeing. They are not
// dismissed on the server, so they come back on the next launch, but they stay
// hidden for the rest of this session so closing the window means it stays closed.
const snoozedDeliveries = new Set<string>();

/**
 * The server returns the oldest undismissed announcement first. If an earlier
 * dismissal never reached it, that announcement (hidden locally) would block
 * every new one. Re-send the dismissal once, then ask for the next one.
 */
function resendStuckDismissal(announcement: DesktopAnnouncement): void {
  const deliveryId = announcement.deliveryId;
  if (!deliveryId || resentDismissals.has(deliveryId)) return;
  resentDismissals.add(deliveryId);
  void dismissDesktopAnnouncement(deliveryId).then((recorded) => {
    if (recorded) void checkForAnnouncementUpdate(true);
  });
}

function recordLocalDismissal(id?: string, deliveryId?: string): void {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    const record: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    if (id) record[id] = now;
    if (deliveryId) record[deliveryId] = now;
    for (const key of Object.keys(record)) {
      if (now - record[key] > 7 * 24 * 60 * 60 * 1000) delete record[key];
    }
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(record));
  } catch {}
}

function AnnouncementPager({
  count,
  index,
  onChange,
}: {
  count: number;
  index: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="desktop-announcement-pager" role="group" aria-label="Announcements">
      <button
        type="button"
        className="desktop-announcement-pager__arrow"
        onClick={() => onChange(index - 1)}
        disabled={index === 0}
        aria-label="Previous announcement"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="desktop-announcement-pager__dots">
        {Array.from({ length: count }, (_, dotIndex) => (
          <button
            type="button"
            key={dotIndex}
            className={`desktop-announcement-pager__dot${
              dotIndex === index ? " desktop-announcement-pager__dot--active" : ""
            }`}
            onClick={() => onChange(dotIndex)}
            aria-label={`Announcement ${dotIndex + 1} of ${count}`}
            aria-current={dotIndex === index ? "true" : undefined}
          />
        ))}
      </div>
      <span className="desktop-announcement-pager__count">
        {index + 1} / {count}
      </span>
      <button
        type="button"
        className="desktop-announcement-pager__arrow"
        onClick={() => onChange(index + 1)}
        disabled={index >= count - 1}
        aria-label="Next announcement"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function AnnouncementModalHost() {
  const navigate = useNavigate();
  const [{ items, index }, setPaging] = useState<{ items: DesktopAnnouncement[]; index: number }>({
    items: [],
    index: 0,
  });
  const [selectedCycle, setSelectedCycle] = useState<DiscountBillingCycle | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const announcement: DesktopAnnouncement | null = items[index] ?? null;
  // A personal offer counts down to this person's own deadline.
  const countdown = useAnnouncementCountdown(announcement?.personalOffer?.closesAt ?? announcement?.expiresAt);

  useEffect(() => {
    function applyAnnouncements(list: DesktopAnnouncement[]) {
      const visible: DesktopAnnouncement[] = [];
      for (const candidate of list) {
        if (snoozedDeliveries.has(candidate.deliveryId)) continue;
        if (isLocallyDismissed(candidate.id, candidate.deliveryId)) {
          resendStuckDismissal(candidate);
          continue;
        }
        visible.push(candidate);
      }
      setPaging((prev) => {
        if (visible.length === 0) {
          return prev.items.length === 0 ? prev : { items: [], index: 0 };
        }
        // Stay on the slide the user is looking at when the list refreshes.
        const currentId = prev.items[prev.index]?.deliveryId;
        const sameSlide = currentId
          ? visible.findIndex((item) => item.deliveryId === currentId)
          : -1;
        return {
          items: visible,
          index: sameSlide >= 0 ? sameSlide : Math.min(prev.index, visible.length - 1),
        };
      });
    }

    applyAnnouncements(getCachedDesktopAnnouncements());
    const unsubscribe = subscribeToDesktopAnnouncements(applyAnnouncements);
    const stopWatcher = startAnnouncementWatcher();
    return () => {
      unsubscribe();
      stopWatcher();
    };
  }, []);

  const currentDeliveryId = announcement?.deliveryId;
  useEffect(() => {
    if (currentDeliveryId) viewedRef.current.add(currentDeliveryId);
    setSelectedCycle(null);
  }, [currentDeliveryId]);

  function goTo(next: number) {
    setPaging((prev) => ({
      ...prev,
      index: Math.max(0, Math.min(prev.items.length - 1, next)),
    }));
  }

  function dismissItems(targets: DesktopAnnouncement[], clicked = false, buttonId?: string) {
    if (targets.length === 0) return;
    for (const target of targets) recordLocalDismissal(target.id, target.deliveryId);
    void dismissDesktopAnnouncements(
      targets.map((target) => target.deliveryId),
      clicked,
      buttonId
    );
  }

  /**
   * Close the whole carousel (X, backdrop, or after acting on an announcement).
   * Slides the user saw are dismissed; slides they never reached are kept for
   * the next launch instead of being lost.
   */
  function closeAll(clickedDeliveryId?: string, buttonId?: string) {
    if (items.length === 0) return;
    const seen = items.filter(
      (item) => item.deliveryId === announcement?.deliveryId || viewedRef.current.has(item.deliveryId)
    );
    const unseen = items.filter((item) => !seen.includes(item));
    dismissItems(seen.filter((item) => item.deliveryId !== clickedDeliveryId));
    dismissItems(
      seen.filter((item) => item.deliveryId === clickedDeliveryId),
      true,
      buttonId
    );
    for (const item of unseen) snoozedDeliveries.add(item.deliveryId);
    setPaging({ items: [], index: 0 });
    clearCachedDesktopAnnouncement();
  }

  /** "Later" / "OK": dismiss this slide and show the next one, or close after the last. */
  function dismissCurrent() {
    if (!announcement) return;
    if (index >= items.length - 1) {
      closeAll();
      return;
    }
    dismissItems([announcement]);
    const remaining = items.filter((item) => item.deliveryId !== announcement.deliveryId);
    setPaging({ items: remaining, index });
    // Keep the cache (and anything reading the active discount from it) in step.
    setCachedDesktopAnnouncements(remaining);
  }

  async function openAction(cycle?: DiscountBillingCycle) {
    const targetCycle =
      cycle || selectedCycle || announcement?.offerApplicableBillingCycles?.[0] || "monthly";
    const url = resolveActionUrl(announcement, targetCycle);
    const firstButtonId = announcement ? getAnnouncementButtons(announcement)[0]?.id : undefined;
    launchUrl(url, firstButtonId);
  }

  /** Open one button's destination and record which button was used. */
  function openButton(button: AnnouncementButton) {
    if (!announcement) return;
    launchUrl(resolveButtonUrl(button.url, announcement.offerCode), button.id);
  }

  function launchUrl(url: string, buttonId?: string) {
    if (!url) return;
    closeAll(announcement?.deliveryId, buttonId);
    if (/^mailto:/i.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
      const desktopRoute = getDesktopAnnouncementRoute(url);
      if (desktopRoute) {
        navigate(desktopRoute);
        return;
      }
      try {
        window.open(new URL(url, WEB_APP_ORIGIN).toString(), "_blank", "noopener,noreferrer");
      } catch {
        // Ignore malformed internal destinations.
      }
    }
  }

  if (!announcement) return null;

  const pager =
    items.length > 1 ? <AnnouncementPager count={items.length} index={index} onChange={goTo} /> : null;
  const pagedClass = items.length > 1 ? " desktop-announcement-overlay--paged" : "";

  const layout = resolveLayout(announcement);

  if (layout === "image_only" && announcement.imageUrl) {
    const actionUrl = resolveActionUrl(announcement);
    return (
      <div className={`desktop-announcement-overlay desktop-announcement-overlay--image-only${pagedClass}`}>
        <div className="desktop-announcement-backdrop" onClick={() => closeAll()} />
        <div className="desktop-announcement-image-card">
          <button
            type="button"
            className="desktop-announcement-image-close"
            onClick={(e) => {
              e.stopPropagation();
              closeAll();
            }}
            aria-label="Dismiss announcement"
          >
            <X size={18} />
          </button>
          <div
            role="button"
            tabIndex={0}
            className="desktop-announcement-image-wrapper"
            onClick={() => void openAction()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void openAction();
              }
            }}
            title={actionUrl ? `Open ${actionUrl}` : "Announcement"}
          >
            <img
              src={announcement.imageUrl}
              alt={announcement.title || "Announcement"}
              className="desktop-announcement-image-only"
            />
          </div>
        </div>
        {pager}
      </div>
    );
  }

  if (layout === "custom" && announcement.bodyHtml) {
    return (
      <div className={`desktop-announcement-overlay${pagedClass}`}>
        <div className="desktop-announcement-backdrop" onClick={() => closeAll()} />
        <section
          className="desktop-announcement-modal desktop-announcement-modal--custom"
          role="dialog"
          aria-modal="true"
          aria-label={announcement.title}
        >
          <button
            type="button"
            className="desktop-announcement-close"
            onClick={() => closeAll()}
            aria-label="Dismiss announcement"
          >
            <X size={16} />
          </button>
          <CustomHtmlFrame
            html={announcement.bodyHtml}
            onLinkClick={(href) =>
              launchUrl(resolveButtonUrl(href, announcement.offerCode), "html")
            }
          />
        </section>
        {pager}
      </div>
    );
  }

  return (
    <AnnouncementDialog
      announcement={announcement}
      countdown={countdown}
      selectedCycle={selectedCycle}
      onSelectCycle={setSelectedCycle}
      onClose={() => closeAll()}
      onLater={() => dismissCurrent()}
      onOpenAction={(cycle) => void openAction(cycle)}
      onOpenButton={openButton}
      pager={pager}
    />
  );
}

const TONE_ICONS: Record<DesktopAnnouncement["tone"], ReactNode> = {
  info: <Megaphone size={26} />,
  success: <CheckCircle2 size={26} />,
  warning: <AlertTriangle size={26} />,
  offer: <Tag size={26} />,
  upgrade: <Crown size={26} />,
};

const TONE_DIALOG: Record<DesktopAnnouncement["tone"], ModalTone> = {
  info: "brand",
  success: "success",
  warning: "warning",
  offer: "brand",
  upgrade: "brand",
};

/**
 * The standard and promo announcement layouts, drawn with the app's one dialog (ModalDialog).
 * Exported so the dev modal gallery shows exactly what churches see.
 */
export function AnnouncementDialog({
  announcement,
  countdown,
  selectedCycle,
  onSelectCycle,
  onClose,
  onLater,
  onOpenAction,
  onOpenButton,
  pager,
}: {
  announcement: DesktopAnnouncement;
  countdown?: string | null;
  selectedCycle: DiscountBillingCycle | null;
  onSelectCycle: (cycle: DiscountBillingCycle) => void;
  onClose: () => void;
  /** "Later" / "OK": dismiss this one (the host moves to the next). */
  onLater: () => void;
  onOpenAction: (cycle?: DiscountBillingCycle) => void;
  onOpenButton: (button: AnnouncementButton) => void;
  pager?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const layout = resolveLayout(announcement);
  const buttons = getAnnouncementButtons(announcement);
  const discountPercent = clampDiscount(announcement.offerDiscountPercent);

  useEffect(() => setCopied(false), [announcement.deliveryId]);

  const copyCode = () => {
    if (!announcement.offerCode) return;
    void navigator.clipboard?.writeText(announcement.offerCode).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  if (layout === "promo") {
    const effectivePercent = discountPercent || 50;
    const offerCards = getOfferCards(announcement, effectivePercent);
    const activeCycle =
      selectedCycle && offerCards.some((c) => c.cycle === selectedCycle)
        ? selectedCycle
        : offerCards[0]?.cycle || "monthly";
    const actionLabel =
      buttons[0]?.label ||
      announcement.ctaLabel ||
      (discountPercent ? `Claim ${discountPercent}% Discount` : "Upgrade Now");
    const actionUrl = resolveActionUrl(announcement, activeCycle);
    const label = discountPercent ? `${discountPercent}% off` : "Special offer";

    return (
      <ModalDialog
        tone="brand"
        icon={announcement.imageUrl ? null : <Tag size={26} />}
        image={announcement.imageUrl || undefined}
        eyebrow={countdown ? `${label} · Ends in ${countdown}` : label}
        title={announcement.title}
        extra={
          announcement.offerCode || offerCards.length > 1 ? (
            <>
              {announcement.offerCode ? (
                <ModalCodeRow
                  label="Promo code"
                  code={announcement.offerCode}
                  note="Applied automatically at checkout"
                  copied={copied}
                  onCopy={copyCode}
                />
              ) : null}
              {offerCards.length > 1 ? (
                <ModalChoices
                  label="Billing"
                  value={activeCycle}
                  onChange={(id) => onSelectCycle(id as DiscountBillingCycle)}
                  choices={offerCards.map((card) => ({
                    id: card.cycle,
                    title: card.title,
                    meta: card.meta,
                    description: card.body,
                  }))}
                />
              ) : null}
            </>
          ) : undefined
        }
        hint="Premium features unlock straight away. Cancel or switch plans anytime."
        actions={[
          { label: "Maybe later", variant: "ghost", onClick: onLater },
          actionUrl
            ? { label: actionLabel, variant: "primary", autoFocus: true, onClick: () => onOpenAction(activeCycle) }
            : { label: "OK", variant: "primary", autoFocus: true, onClick: onLater },
        ]}
        onClose={onClose}
        footer={pager}
        width={460}
      >
        {announcement.message ? <p>{announcement.message}</p> : null}
      </ModalDialog>
    );
  }

  const offerNote = announcement.offerDiscountPercent
    ? `${announcement.offerDiscountPercent}% off${
        announcement.offerDurationMonths
          ? ` for ${announcement.offerDurationMonths} month${announcement.offerDurationMonths === 1 ? "" : "s"}`
          : ""
      }`
    : undefined;

  return (
    <ModalDialog
      tone={TONE_DIALOG[announcement.tone] ?? "brand"}
      icon={announcement.imageUrl ? null : (TONE_ICONS[announcement.tone] ?? <Megaphone size={26} />)}
      image={announcement.imageUrl || undefined}
      eyebrow={toneLabel(announcement.tone)}
      title={announcement.title}
      extra={
        announcement.offerCode ? (
          <ModalCodeRow label="Offer code" code={announcement.offerCode} note={offerNote} copied={copied} onCopy={copyCode} />
        ) : undefined
      }
      actions={
        buttons.length > 0
          ? [
              { label: "Later", variant: "ghost", onClick: onLater },
              ...buttons.map((button, index) => ({
                label: button.label,
                variant: (button.style === "primary" || (index === buttons.length - 1 && !buttons.some((b) => b.style === "primary"))
                  ? "primary"
                  : "ghost") as ModalAction["variant"],
                onClick: () => onOpenButton(button),
              })),
            ]
          : [{ label: "OK", variant: "primary", autoFocus: true, onClick: onLater }]
      }
      onClose={onClose}
      footer={pager}
    >
      {announcement.message ? <p>{announcement.message}</p> : null}
    </ModalDialog>
  );
}
