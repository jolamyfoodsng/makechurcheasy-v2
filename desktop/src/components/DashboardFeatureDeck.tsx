/**
 * DashboardFeatureDeck.tsx — the four main features at the top of the dashboard.
 *
 * Verse AI is the large card on the left; Studio Mode, Broadcast Graphics and Multi-Stream are
 * stacked on the right. The deck sizes itself to the window so all four are visible without
 * scrolling, on a short laptop screen and on a tall monitor alike. When the page is narrower,
 * Verse AI spans the top with the other three in a row below it; on a very narrow page it is one
 * column that scrolls like the rest of the page. Styles: dashboardFeatureDeck.css (theme
 * tokens only, see docs/DESIGN_SYSTEM.md).
 */
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  HelpCircle,
  Layers,
  Mic,
  Monitor,
  Radio,
} from "./icons/NativeIcons";
import "./dashboardFeatureDeck.css";

interface DashboardFeatureDeckProps {
  onOpenVerseAi: () => void;
  onOpenStudio: () => void;
  onOpenGraphics: () => void;
  onOpenBroadcast: () => void;
  onHowItWorks: () => void;
}

const MIN_HEIGHT = 360;
const MAX_HEIGHT = 640;
const BOTTOM_GAP = 24;
/** Deck widths (px) for the side-by-side layout, and below which it becomes one column. */
const SPLIT_WIDTH = 1000;
const STACK_WIDTH = 640;
/** At or above this height the side cards also list what they include. */
const ROOMY_HEIGHT = 500;

/** Fits the deck between its top and the bottom of the scrolling page area. */
function useFitToWindow() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const deck = ref.current;
    if (!deck) return;
    const scroller = deck.closest<HTMLElement>(".app-main");
    const fit = () => {
      const width = deck.clientWidth;
      deck.dataset.layout = width < STACK_WIDTH ? "stack" : width < SPLIT_WIDTH ? "row" : "split";
      if (deck.dataset.layout === "stack") {
        deck.style.removeProperty("--deck-height");
        deck.dataset.roomy = "true";
        return;
      }
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
      const scrolled = scroller ? scroller.scrollTop : window.scrollY;
      const top = deck.getBoundingClientRect().top - viewTop + scrolled;
      const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, viewHeight - top - BOTTOM_GAP)));
      deck.style.setProperty("--deck-height", `${height}px`);
      deck.dataset.roomy = String(height >= ROOMY_HEIGHT);
    };
    fit();
    // Re-fit when the window resizes or something above the deck (a banner) appears or goes.
    const observer = new ResizeObserver(fit);
    if (scroller) observer.observe(scroller);
    if (deck.parentElement) observer.observe(deck.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  return ref;
}

function SideCard({
  icon,
  title,
  badge,
  tagline,
  meta,
  action,
  extra,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  tagline: string;
  meta: string;
  action: { label: string; onClick: () => void };
  extra?: ReactNode;
}) {
  return (
    <section className="deck-card" aria-label={title}>
      <div className="deck-card__icon" aria-hidden="true">{icon}</div>
      <div className="deck-card__copy">
        <div className="deck-card__title-row">
          <h3 className="deck-card__title">{title}</h3>
          {badge && <span className="deck-badge">{badge}</span>}
        </div>
        <p className="deck-card__tagline">{tagline}</p>
        <p className="deck-card__meta">{meta}</p>
      </div>
      <div className="deck-card__actions">
        {extra}
        <button type="button" className="deck-btn" onClick={action.onClick}>
          <span>{action.label}</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

export default function DashboardFeatureDeck({
  onOpenVerseAi,
  onOpenStudio,
  onOpenGraphics,
  onOpenBroadcast,
  onHowItWorks,
}: DashboardFeatureDeckProps) {
  const ref = useFitToWindow();
  return (
    <div ref={ref} className="dashboard-feature-deck">
      <section className="deck-hero" aria-label="Verse AI">
        <div className="deck-hero__head">
          <div className="deck-hero__icon" aria-hidden="true"><Mic size={26} /></div>
          <div className="deck-card__title-row">
            <h2 className="deck-hero__title">Verse AI</h2>
            <span className="deck-badge">AI</span>
          </div>
        </div>
        <div className="deck-hero__body">
          <p className="deck-hero__tagline">The pastor speaks. The verse is ready.</p>
          <p className="deck-hero__description">
            Verse AI listens to the message, finds every Bible verse mentioned, and puts it on your screen in one click.
            No more flipping pages while the pastor moves on. Try it free.
          </p>
          <div className="deck-hero__flow" aria-hidden="true">
            <span><Mic size={15} /> Pastor speaks</span>
            <ArrowRight size={16} />
            <span><BookOpen size={15} /> John 3:16</span>
            <ArrowRight size={16} />
            <span><Monitor size={15} /> On screen</span>
          </div>
        </div>
        <button type="button" className="deck-btn deck-btn--primary deck-hero__action" onClick={onOpenVerseAi}>
          <Mic size={16} />
          <span>Open Verse AI</span>
          <ChevronRight size={16} />
        </button>
      </section>

      <SideCard
        icon={<Monitor size={20} />}
        title="Studio Mode"
        badge="NEW"
        tagline="Project to your screens, no OBS required."
        meta="Scripture, lyrics and media on a projector or TV."
        action={{ label: "Open Studio", onClick: onOpenStudio }}
      />
      <SideCard
        icon={<Layers size={20} />}
        title="Broadcast Graphics"
        tagline="Make your stream look like a studio."
        meta="Lower thirds · Scripture · Countdowns · Quote cards"
        action={{ label: "Open Graphics", onClick: onOpenGraphics }}
      />
      <SideCard
        icon={<Radio size={20} />}
        title="Multi-Stream"
        badge="NEW"
        tagline="One click from OBS, live on every channel."
        meta="YouTube · Facebook · TikTok · Custom RTMP"
        action={{ label: "Open Broadcast", onClick: onOpenBroadcast }}
        extra={
          <button type="button" className="deck-icon-btn" onClick={onHowItWorks} title="How multi-streaming works" aria-label="How multi-streaming works">
            <HelpCircle size={16} />
          </button>
        }
      />
    </div>
  );
}
