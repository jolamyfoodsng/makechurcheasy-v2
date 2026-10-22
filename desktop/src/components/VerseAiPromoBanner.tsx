import { ArrowRight, BookOpen, ChevronRight, Mic, Monitor } from "./icons/NativeIcons";

interface VerseAiPromoBannerProps {
  onOpenVerseAi: () => void;
}

/**
 * Home screen card for Verse AI (speech to scripture). Same card as the Studio Mode one, shown
 * beside it, first in the row: the pastor says a verse and it is found and ready to show.
 */
export function VerseAiPromoBanner({ onOpenVerseAi }: VerseAiPromoBannerProps) {
  return (
    <section className="studio-mode-promo studio-mode-promo--half verse-ai-promo" aria-label="Verse AI announcement">
      <div className="studio-mode-promo__main">
        <div className="studio-mode-promo__icon" aria-hidden="true">
          <Mic size={23} />
        </div>
        <div className="studio-mode-promo__copy">
          <div className="studio-mode-promo__title-row">
            <h2>Verse AI</h2>
            <span className="studio-mode-promo__badge">AI</span>
          </div>
          <p className="studio-mode-promo__tagline">The pastor speaks. The verse is ready.</p>
          <p className="studio-mode-promo__description">
            Verse AI listens to the message, finds every Bible verse mentioned, and puts it on your screen in one
            click. No more flipping pages while the pastor moves on. Try it free.
          </p>
        </div>
      </div>

      <div className="studio-mode-promo__action">
        <div className="studio-mode-promo__flow" aria-hidden="true">
          <span><Mic size={15} /> Pastor speaks</span>
          <ArrowRight size={17} />
          <span><BookOpen size={15} /> John 3:16</span>
          <ArrowRight size={17} />
          <span><Monitor size={15} /> On screen</span>
        </div>
        <button type="button" onClick={onOpenVerseAi}>
          <span>Open Verse AI</span>
          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}

export default VerseAiPromoBanner;
