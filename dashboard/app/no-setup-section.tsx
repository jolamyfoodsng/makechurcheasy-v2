import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, MousePointerClick, RefreshCw, Wand2 } from "lucide-react";
import home from "./homepage.module.css";
import styles from "./no-setup-section.module.css";

const steps: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: MousePointerClick, title: "Choose what to show", text: "Select a Bible verse, worship lyric, media item, or lower third." },
  { icon: Wand2, title: "We set it up in OBS", text: "MakeChurchEazy creates the matching scene and source for you." },
  { icon: RefreshCw, title: "Your display stays in sync", text: "Change the content in MakeChurchEazy and OBS updates in real time." },
];

export default function NoSetupSection() {
  return (
    <section className={styles.section} id="how-it-works" aria-labelledby="setup-heading">
      <div className={styles.panel}>
        <div className={styles.copy}>
          <p className={home.eyebrow}>THE MAKECHURCHEAZY ADVANTAGE</p>
          <h2 id="setup-heading" className={styles.title}>Church presentation in OBS<br /><span>without building scenes or managing sources.</span></h2>
          <p className={styles.text}>Choose a Bible verse, worship lyric, media item, or lower third in MakeChurchEazy. It creates the matching OBS scene and source, then keeps your display in sync, so your team can focus on the service.</p>
          <p className={styles.compare}><strong>Comparing EasyWorship, ProPresenter, or Proclaim?</strong> MakeChurchEazy brings your church presentation and OBS controls together at a more affordable price.</p>
          <p className={styles.note}>
            Included with paid plans.{" "}
            <Link href="/pricing">Compare plans <ArrowRight size={15} aria-hidden="true" /></Link>
          </p>
        </div>
        <ol className={styles.steps}>
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
              <div>
                <span className={styles.num}>Step {i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
