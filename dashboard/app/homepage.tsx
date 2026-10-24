"use client";

import { ArrowRight, ChevronDown, Download, Monitor, Play, Radio, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./homepage.module.css";
import { MarketingHeader, MarketingFooter } from "./marketing-shell";
import FeatureBento from "./feature-bento";
import NoSetupSection from "./no-setup-section";
import VerseAiShowcase from "./verse-ai-showcase";
import PricingContent from "./pricing/PricingContent";
import ProofStrip from "./proof-strip";
import StudioModeSection from "./studio-mode-section";
import { homepageFaq as questions } from "./homepage-faq";

function ProductView() {
  return <div className={styles.showcasePanel}>
    <div className={styles.showcaseImage}>
      <img className={styles.showcasePoster} src="/homepage/church-presentation-software-obs-hero-poster.jpg" alt="" aria-hidden="true" fetchPriority="high" />
      <video className={styles.showcaseVideo} autoPlay muted loop playsInline preload="metadata" poster="/homepage/church-presentation-software-obs-hero-poster.jpg" aria-label="MakeChurchEazy church presentation software displaying Bible verses in OBS">
        <source src="/homepage/church-presentation-software-obs-hero.mp4" type="video/mp4" />
        <source src="/homepage/church-presentation-software-obs-hero.webm" type="video/webm" />
      </video>
    </div>
  </div>;
}

export default function Homepage() {
  const [downloadLabel, setDownloadLabel] = useState("Download MakeChurchEazy");
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) setDownloadLabel("Download for Windows");
    else if (/Macintosh|Mac OS/i.test(ua)) setDownloadLabel("Download for macOS");
  }, []);

  useEffect(() => {
    if (!demoOpen) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, [demoOpen]);

  const openDemo = () => { setDemoLoaded(false); setDemoOpen(true); };


  return <div className={`${styles.home} ${styles.homePage}`}>
    <a className={styles.skipLink} href="#main">Skip to content</a>
    <MarketingHeader homepage />

    <main id="main">
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>Bible, lyrics and lower thirds.<br /><span>On your stream and in the room.</span></h1>
          <p className={styles.heroDescription}>Church presentation software that works inside OBS Studio. Show Bible verses, worship lyrics, media and lower thirds on your livestream, or send them straight to your projector or TV with Studio mode. No scenes to build, no window juggling.</p>
          <div className={styles.heroActions}>
            <Link href="/download" className={styles.downloadButton}>
              <Download size={17} /> Download for Free
            </Link>
            <button className={styles.demoLink} onClick={openDemo}>
              <Play size={14} fill="currentColor" /> Watch Demo
            </button>
          </div>
          <p className={styles.platforms}><Monitor size={14} /> <b>Mac &amp; Windows</b> <span aria-hidden="true">·</span> <b>Set up in minutes</b> <span aria-hidden="true">·</span> <b>Bible &amp; lyrics work offline</b></p>
        </div>
        <div className={styles.heroProduct}><ProductView /></div>
      </section>

      <ProofStrip />

      <VerseAiShowcase />

      <FeatureBento />

      <NoSetupSection />

      <StudioModeSection />

      <section className={styles.obsSection} id="obs-workflow"><div className={styles.obsInner}><div className={styles.obsImage}><img src="/homepage/obs.webp" alt="OBS Studio with the MakeChurchEazy presentation dock integrated directly into the workspace" width="1269" height="768" loading="lazy" /></div><div className={styles.obsHeading}><p className={styles.eyebrow}><Radio size={15} /> BUILT FOR OBS STUDIO</p><h2>One screen.<br /><span>Zero window switching.</span></h2><p>No second laptop. No panic alt-tabbing while the pastor is preaching. Your scriptures, lyrics, and media dock directly into OBS so your team controls the entire broadcast from a single window.</p></div></div></section>

      <PricingContent embedded sectionId="plans" />

      <section className={`${styles.section} ${styles.faqSection}`}><div><p className={styles.eyebrow}>GOOD QUESTIONS</p><h2>A little clarity<br />before you begin.</h2><Link href="/support" className={styles.textLink}>Visit support <ArrowRight size={17} /></Link></div><div className={styles.faqList}>{questions.map(item => <details key={item.q}><summary>{item.q}<ChevronDown size={20} /></summary><p>{item.a}</p></details>)}</div></section>

      <section className={styles.finalCta}><div className={styles.finalMark}><img src="/homepage/logo-light.webp" alt="" width="58" height="58" /></div><p className={styles.eyebrow}>LESS FRICTION. MORE FOCUS.</p><h2>Make your next<br />service <span>Eazier.</span></h2><p>Bible. Worship. Media. Lower thirds. AI.<br />Built around OBS without the complicated setup.</p><Link href="/download" className={styles.lightButton}><Download size={19} />{downloadLabel}</Link><p className={styles.finalPlatforms}>Windows & macOS</p></section>
    </main>

    <MarketingFooter />

    {demoOpen && <dialog ref={dialogRef} className={styles.demoDialog} aria-labelledby="demo-title" onCancel={() => setDemoOpen(false)} onClose={() => setDemoOpen(false)} onClick={event => { if (event.target === event.currentTarget) setDemoOpen(false); }}><div className={styles.dialogHeader}><h2 id="demo-title">MakeChurchEazy in action</h2><button aria-label="Close demo" onClick={() => setDemoOpen(false)} autoFocus><X size={22} /></button></div><div className={styles.videoFrame}>{!demoLoaded && <div className={styles.videoLoading}>Loading the walkthrough…</div>}<iframe src="https://www.youtube.com/embed/NmneQhxY2jQ?autoplay=1&playsinline=1&rel=0" title="MakeChurchEazy product demo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen onLoad={() => setDemoLoaded(true)} /></div><div className={styles.dialogFooter}>Trouble playing? <a href="https://www.youtube.com/watch?v=NmneQhxY2jQ" target="_blank" rel="noreferrer">Open the demo on YouTube <ArrowRight size={14} /></a></div></dialog>}
  </div>;
}
