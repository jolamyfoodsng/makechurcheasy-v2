import Link from "next/link";
import { ArrowRight, BookOpen, Image as ImageIcon, Monitor, Music2, Projector, Tv } from "lucide-react";
import styles from "./homepage.module.css";

/**
 * Put a real Studio mode screenshot in /public/homepage (e.g. "/homepage/studio-mode.webp") and set
 * its path here. Until then the section shows a simple illustration of the operator screen and the
 * projector.
 */
const STUDIO_SCREENSHOT = "";

const points = [
  { icon: BookOpen, text: "Scripture from 1,000+ Bible versions in 250+ languages" },
  { icon: Music2, text: "Worship lyrics from your song library" },
  { icon: ImageIcon, text: "Pictures, videos and slides from your media" },
  { icon: Monitor, text: "Straight to a projector, TV or second screen" },
];

function Illustration() {
  return (
    <div className={styles.studioArt} role="img" aria-label="Illustration: the operator's screen sends a Bible verse straight to a projector screen">
      <div className={styles.studioArtOperator}>
        <div className={styles.studioArtBar}><i /><i /><i /><span>Studio mode</span></div>
        <div className={styles.studioArtBody}>
          <div className={styles.studioArtList}><span className={styles.isOn}>John 3:16</span><span>John 3:17</span><span>Amazing Grace · v1</span><span>Welcome.mp4</span></div>
          <div className={styles.studioArtPreview}><b>For God so loved the world…</b><small>John 3:16</small></div>
        </div>
      </div>
      <div className={styles.studioArtLink} aria-hidden="true"><ArrowRight size={22} /></div>
      <div className={styles.studioArtScreen}>
        <div className={styles.studioArtScreenInner}><b>For God so loved the world, that he gave his only begotten Son…</b><small>John 3:16</small></div>
        <span className={styles.studioArtLabel}><Projector size={14} /> Projector</span>
      </div>
    </div>
  );
}

export default function StudioModeSection() {
  return (
    <section className={`${styles.section} ${styles.studioSection}`} id="studio-mode" aria-labelledby="studio-heading">
      <div className={styles.studioCopy}>
        <p className={styles.eyebrow}><Tv size={15} /> STUDIO MODE · NO OBS REQUIRED</p>
        <h2 id="studio-heading">No OBS?<br /><span>Project straight to your screens.</span></h2>
        <p>Not every church streams. Studio mode sends scripture, worship lyrics and media straight to a projector or TV in the room, from the same app and the same library you use with OBS.</p>
        <ul className={styles.studioPoints}>
          {points.map(({ icon: Icon, text }) => <li key={text}><Icon size={18} aria-hidden="true" /><span>{text}</span></li>)}
        </ul>
        <p className={styles.studioNote}>Open Studio mode from the dashboard. Feature availability varies by plan. <a href="#plans">Find your fit <ArrowRight size={13} /></a></p>
        <Link href="/download" className={styles.textLink}>Download and open Studio mode <ArrowRight size={17} /></Link>
      </div>
      <div className={styles.studioVisual}>
        {STUDIO_SCREENSHOT
          ? <img src={STUDIO_SCREENSHOT} alt="MakeChurchEazy Studio mode sending a Bible verse to a projector" width={1280} height={800} loading="lazy" />
          : <Illustration />}
      </div>
    </section>
  );
}
