import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Ear, MousePointerClick, Users } from "lucide-react";
import styles from "./verse-ai-showcase.module.css";

/** Screen recording of Verse AI. The poster shows until the video loads (or if the file is missing). */
const VIDEO_MP4 = "/homepage/verse-ai.mp4";
const POSTER = "/homepage/verse-ai-poster.webp";

const points: { icon: LucideIcon; text: string }[] = [
  { icon: Ear, text: "Find verses as they’re preached." },
  { icon: MousePointerClick, text: "Display them in one click." },
  { icon: Users, text: "Keep your team focused on the service." },
];

export default function VerseAiShowcase() {
  return (
    <section className={styles.showcase} id="verse-ai-showcase" aria-labelledby="verse-ai-heading">
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>VERSE AI FOR OBS</p>
          <h2 id="verse-ai-heading" className={styles.heading}>Keep the sermon moving. <span>Put each verse on screen in one click.</span></h2>
          <p className={styles.lead}>
            Verse AI listens to the sermon, finds the Bible references as they’re mentioned, and suggests the matching verses inside MakeChurchEazy. Your team can send a verse to the screen through OBS Studio without stopping to search manually.
          </p>
          <ul className={styles.points}>
            {points.map(({ icon: Icon, text }) => (
              <li key={text}><span className={styles.icon}><Icon size={18} aria-hidden="true" /></span>{text}</li>
            ))}
          </ul>
          <div className={styles.alternative}>
            <h3>A more affordable alternative to EasyWorship, ProPresenter, and Proclaim</h3>
            <p>MakeChurchEazy brings Verse AI and an OBS-centered church presentation workflow together at a more affordable price.</p>
          </div>
          <Link href="/features/voice-bible" className={styles.cta}>See Verse AI in action <ArrowRight size={17} aria-hidden="true" /></Link>
          <p className={styles.serviceNote}>Verse AI requires an internet connection and available AI credits on your plan.</p>
        </div>

        <div className={styles.device}>
          <video autoPlay muted loop playsInline preload="metadata" poster={POSTER} aria-label="Verse AI hearing “Let's go to Hebrews 2:7” in a sermon and showing the verse, ready to project">
            <source src={VIDEO_MP4} type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  );
}
