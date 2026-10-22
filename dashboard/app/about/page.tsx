import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, ExternalLink } from "lucide-react";
import { socialPreview } from "@/lib/social-preview";
import { FOUNDER, aboutPageJsonLd, founderProfileLinks } from "@/lib/founder";
import { MarketingFooter, MarketingHeader } from "../marketing-shell";
import shared from "../homepage.module.css";
import styles from "./about.module.css";

const title = `About ${FOUNDER.name}, ${FOUNDER.jobTitle}`;
const description = `${FOUNDER.summary} Learn who is behind MakeChurchEazy and why it was built for church media teams.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/about" },
  openGraph: { type: "profile", images: [socialPreview], title: `${FOUNDER.name}, ${FOUNDER.jobTitle} of ${FOUNDER.company}`, description, url: "/about" },
};

const facts = [
  { label: "Runs on", value: "Windows and macOS" },
  { label: "Works with", value: "OBS Studio" },
  { label: "Bible versions", value: "1,000+ in 250+ languages" },
  { label: "Plans", value: "Free plan available" },
];

export default function AboutPage() {
  const profiles = founderProfileLinks();
  return <div className={shared.home}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutPageJsonLd()).replace(/</g, "\\u003c") }} />
    <a className={shared.skipLink} href="#main">Skip to content</a>
    <MarketingHeader />
    <main id="main" className={styles.page}>
      <section className={styles.intro} aria-labelledby="about-heading">
        <p className={styles.eyebrow}>{FOUNDER.jobTitle}, {FOUNDER.company}</p>
        <h1 id="about-heading">{FOUNDER.name}</h1>
        <p className={styles.lead}>
          {FOUNDER.name} is the founder and CEO of <Link href="/">{FOUNDER.company}</Link>, church presentation software that works inside OBS Studio.
          It helps church media teams show Bible verses, worship lyrics, media, lower thirds and countdowns on the church screens and the livestream, without needing a big media team.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="company-heading">
        <h2 id="company-heading">About {FOUNDER.company}</h2>
        <p>
          {FOUNDER.company} is built for the people behind the service: the volunteers who run the screens on Sunday.
          It puts scripture, song lyrics, announcements and live graphics in one place, and sends them to OBS so the in-person audience and the people watching online see the same thing.
        </p>
        <dl className={styles.facts}>
          {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
        <div className={styles.actions}>
          <Link className={shared.button} href="/download"><Download size={16} aria-hidden="true" /> Download MakeChurchEazy</Link>
          <Link className={styles.textLink} href="/features">See what it does <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      {profiles.length > 0 && <section className={styles.section} aria-labelledby="online-heading">
        <h2 id="online-heading">Find {FOUNDER.givenName} online</h2>
        <ul className={styles.profiles}>
          {profiles.map((link) => <li key={link.key}>
            <a href={link.href} target="_blank" rel="me noopener noreferrer">{link.label}<ExternalLink size={14} aria-hidden="true" /></a>
          </li>)}
        </ul>
      </section>}

      <section className={styles.section} aria-labelledby="contact-heading">
        <h2 id="contact-heading">Get in touch</h2>
        <p>
          For help with your setup or account, email <a href="mailto:support@makechurcheazy.com">support@makechurcheazy.com</a> or visit the <Link href="/contact">contact page</Link>.
        </p>
      </section>
    </main>
    <MarketingFooter />
  </div>;
}
