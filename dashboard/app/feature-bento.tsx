import type { LucideIcon } from "lucide-react";
import { BookOpen, Cast, Megaphone, MonitorPlay, Music2, Sparkles, Type } from "lucide-react";
import styles from "./feature-bento.module.css";

const features: { icon: LucideIcon; title: string; text: string; points: string[] }[] = [
  {
    icon: BookOpen,
    title: "Bible verses in OBS",
    text: "Search by reference or by any words in a verse, compare translations, and put scripture on your stream in one click.",
    points: ["Full screen or lower third", "Compare translations side by side"],
  },
  {
    icon: Music2,
    title: "Worship lyrics inside OBS",
    text: "Keep every song in one library and follow the worship team verse by verse, right from your OBS workspace.",
    points: ["Import from EasyWorship or ProPresenter", "No retyping your songs"],
  },
  {
    icon: MonitorPlay,
    title: "Studio Mode",
    text: "Send scripture, lyrics and media straight to the projector or TV in the room. No OBS needed.",
    points: ["Church screens and livestream from one app", "Works on a second screen"],
  },
  {
    icon: Cast,
    title: "Multi-Stream",
    text: "Go live everywhere at once. One click from OBS sends your service to every channel.",
    points: ["YouTube, Facebook and TikTok", "Any custom RTMP destination"],
  },
  {
    icon: Type,
    title: "Lower thirds",
    text: "Show speaker names, sermon titles and scripture references that match your church colours and fonts.",
    points: ["Theme Studio and Design Studio", "Ready-made church templates"],
  },
  {
    icon: Megaphone,
    title: "Tickers and countdowns",
    text: "Run announcements along the bottom of the stream and count down to the start of service.",
    points: ["Prayer, social and giving bars", "Countdown and service rundown"],
  },
];

export default function FeatureBento() {
  return (
    <section id="overview" className={styles.bento} aria-labelledby="bento-heading">
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>ONE APP FOR THE WHOLE SERVICE</p>
          <h2 id="bento-heading" className={styles.title}>Everything your church team needs.<br /><span>Without the complexity.</span></h2>
          <p className={styles.subtitle}>From Bible search to Sunday service and livestream.</p>
        </header>
        <ul className={styles.grid}>
          {features.map(({ icon: Icon, title, text, points }) => (
            <li key={title} className={styles.card}>
              <span className={styles.icon}><Icon size={22} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <ul className={styles.points}>
                {points.map(point => <li key={point}>{point}</li>)}
              </ul>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          <Sparkles size={16} aria-hidden="true" />
          <span>No scenes or sources to create. MakeChurchEazy sets them up in OBS for you, and keeps them updated as your content changes (paid plans).</span>
        </p>
      </div>
    </section>
  );
}
