import { Columns2, Monitor, Radio, Search, Settings2 } from "lucide-react";
import FeatureShowcase from "./feature-showcase";
import MediaBesideObsShowcase from "./media-beside-obs-showcase";
import FeatureTabs from "./feature-tabs";
import styles from "./media-beside-obs-showcase.module.css";

function BibleVisual() {
  return (
    <div className={styles.visual}>
      <div className={styles.screenshotStage}>
        <img
          src="/homepage/bible-obs-live.webp"
          alt="MakeChurchEazy Bible dock inside OBS Studio with 2 Corinthians 4:2 live on preview and program output"
          width={1024}
          height={640}
          loading="lazy"
        />
      </div>
      <p className={styles.visualCaption}>Inside MakeChurchEazy · Bible in OBS Studio</p>
    </div>
  );
}


export default function HomepageFeatureShowcases() {
  return <>
    <FeatureShowcase
      id="bible" eyebrow="Bible verses & translations in OBS"
      heading={<>Find every passage.<br /><span>Keep it live inside OBS.</span></>}
      description={[
        "Find and present Bible verses without leaving OBS Studio. MakeChurchEazy keeps scripture search, verse comparison, and translation comparison together in your Bible dock. Explore 1,000+ Bible versions in 250+ languages, compare passages, and show the same verse in different translations side by side.",
        "Follow the message as it unfolds: select another verse and update the displayed scripture in real time. Present it full screen or as a lower third while MakeChurchEazy creates and updates the required OBS scenes and sources automatically on paid plans.",
      ]}
      benefits={[
        { icon: Search, text: "Explore 1,000+ Bible versions in 250+ languages" },
        { icon: Columns2, text: "Compare Bible passages and translations side by side" },
        { icon: Radio, text: "Update the displayed verse in real time" },
        { icon: Monitor, text: "Choose full-screen scripture or a lower third" },
        { icon: Settings2, text: "Stay in OBS with automatic scene and source updates" },
      ]}
      microcopy="Stay with the message. Your Bible tools are right beside you."
      href="/features/bible" linkLabel="Explore Bible presentation"
    ><BibleVisual /></FeatureShowcase>
    <MediaBesideObsShowcase />
    {/* Worship, lower thirds, tickers & countdowns and multi-view: one section with a tab each. */}
    <FeatureTabs />
  </>;
}
