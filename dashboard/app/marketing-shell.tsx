"use client";

import Link from "next/link";
import { ArrowRight, Download, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./homepage.module.css";

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={styles.brand} aria-label="MakeChurchEazy home">
    <img src={light ? "/homepage/logo-light.webp" : "/homepage/logo.webp"} alt="" width="40" height="40" />
    <span>MakeChurchEazy<span className={styles.brandDot}>.</span></span>
  </Link>;
}

export function MarketingHeader({ homepage = false }: { homepage?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("marketing-menu-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  const home = homepage ? "" : "/";
  const links = <><Link href="/features">Features</Link><a href={`${home}#how-it-works`}>How it works</a><Link href="/docs">Docs</Link><Link href="/pricing">Pricing</Link><Link href="/blog">Blog</Link><Link href="/tutorials">Resources <ArrowRight size={14} /></Link></>;
  return <header className={styles.header}>
    <div className={styles.headerInner}>
      <Brand />
      <nav className={styles.desktopNav} aria-label="Main navigation">{links}</nav>
      <div className={styles.headerActions}>
        <Link className={styles.login} href="/login">Log in</Link>
        <Link className={`${styles.button} ${styles.headerDownload}`} href="/download"><Download size={16} /> Download</Link>
        <button id="marketing-menu-toggle" className={styles.menuToggle} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </div>
    {menuOpen && <nav id="mobile-menu" className={styles.mobileNav} aria-label="Mobile navigation" onClick={() => setMenuOpen(false)}>{links}<Link href="/login">Log in</Link></nav>}
  </header>;
}

export function MarketingFooter() {
  return <footer className={styles.footer}>
    <div className={styles.footerTop}>
      <div><Brand light /><p>For the people behind the service.</p></div>
      <nav aria-label="Footer navigation">
        <div><strong>Product</strong><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/download">Download</Link></div>
        <div><strong>Resources</strong><Link href="/docs">Documentation</Link><Link href="/blog">Blog</Link><Link href="/tutorials">Tutorials</Link><Link href="/support">Support</Link><Link href="/about">About</Link><Link href="/contact">Contact us</Link><Link href="/login">Your account</Link></div>
      </nav>
    </div>
    <div className={styles.footerBottom}><span>© {new Date().getFullYear()} MakeChurchEazy.</span><span>Made for church media teams. Built around OBS.</span></div>
  </footer>;
}
