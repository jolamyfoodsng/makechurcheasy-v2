import { ArrowRight, ChevronRight, Monitor } from "./icons/NativeIcons";

interface StudioModePromoBannerProps {
  onOpenStudio: () => void;
  /** Half width, beside another card (the card stacks its content). */
  half?: boolean;
}

export function StudioModePromoBanner({ onOpenStudio, half = false }: StudioModePromoBannerProps) {
  return (
    <section className={`studio-mode-promo${half ? " studio-mode-promo--half" : ""}`} aria-label="Studio Mode announcement">
      <div className="studio-mode-promo__main">
        <div className="studio-mode-promo__icon" aria-hidden="true">
          <Monitor size={23} />
        </div>
        <div className="studio-mode-promo__copy">
          <div className="studio-mode-promo__title-row">
            <h2>Studio Mode is here</h2>
            <span className="studio-mode-promo__badge">NEW</span>
          </div>
          <p className="studio-mode-promo__tagline">Project directly to your screens—no OBS required.</p>
          <p className="studio-mode-promo__description">
            Run your service in MakeChurchEazy Studio and send scripture, lyrics, and media to a projector or TV.
          </p>
        </div>
      </div>

      <div className="studio-mode-promo__action">
        <div className="studio-mode-promo__flow" aria-hidden="true">
          <span><Monitor size={15} /> Studio</span>
          <ArrowRight size={17} />
          <span><Monitor size={15} /> Projector</span>
        </div>
        <button type="button" onClick={onOpenStudio}>
          <span>Open Studio Mode</span>
          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}

export default StudioModePromoBanner;
