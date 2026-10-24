"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Minus } from "lucide-react";
import { usePricingData } from "./pricing-data";
import styles from "./pricing.module.css";

function FeatureValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <span className={styles.included}>
        <Check size={18} aria-hidden="true" />
        <span className={styles.srOnly}>Included</span>
      </span>
    ) : (
      <span className={styles.unavailable}>
        <Minus size={16} aria-hidden="true" />
        <span className={styles.srOnly}>Not included</span>
      </span>
    );
  }
  if (value === "Coming Soon") {
    return <span className={styles.comingSoon}>Coming soon</span>;
  }
  return <span>{value}</span>;
}

export interface PricingContentProps {
  embedded?: boolean;
  sectionId?: string;
  showComparison?: boolean;
  showFaqs?: boolean;
  showCta?: boolean;
  initialCountryCode?: string | null;
}

export default function PricingContent({
  embedded = false,
  sectionId = "plans",
  showComparison = true,
  showFaqs = true,
  showCta = true,
  initialCountryCode,
}: PricingContentProps) {
  const {
    pricing,
    formatPrice,
    comparisonRows,
    plans,
    faqs,
  } = usePricingData(initialCountryCode);

  const content = (
    <>
      <section className={embedded ? undefined : styles.intro} aria-labelledby="pricing-heading">
        {embedded ? (
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <p className={styles.eyebrow}>ROOM TO GROW</p>
            <h2 style={{ fontSize: "clamp(36px, 4vw, 60px)", fontWeight: 700, color: "#0f172a", lineHeight: 1.1, letterSpacing: "-.02em", marginTop: "16px" }}>
              Simple plans.<br />
              <span style={{ color: "#1D4ED8" }}>For your church media team.</span>
            </h2>
          </div>
        ) : (
          <>
            <p className={styles.eyebrow}>PRICING</p>
            <h1 id="pricing-heading">
              A plan for your church.<br />
              Room for what comes next.
            </h1>
            <p className={styles.lead}>
              From your first service to a growing team across campuses.<br className={styles.desktopBreak} />
              {" "}Choose the tools and capacity your church needs.
            </p>
          </>
        )}

        <div className={styles.plans}>
          {plans.map((plan, index) => {
            const isGrowth = plan.id === "growth";
            const isPro = plan.id === "pro";
            const PlanIcon = plan.icon;

            return (
              <article
                key={plan.id}
                className={`${styles.plan} ${isGrowth ? styles.featured : ""}`}
              >
                <div className={styles.cardHeading}>
                  <PlanIcon size={24} aria-hidden="true" />
                  {isGrowth && <span className={styles.badge}>For growing teams</span>}
                </div>

                <h2>
                  {plan.name}
                  {isPro && <span>Multi-Campus</span>}
                </h2>

                <p className={styles.audience}>{plan.audience}</p>

                <div className={styles.price} aria-live="polite" aria-atomic="true">
                  <strong>{formatPrice(index)}</strong>
                  <span>{pricing.currency} / month</span>
                </div>

                <Link
                  href={plan.href}
                  className={`${styles.planButton} ${isGrowth ? styles.planButtonSolid : styles.planButtonOutline}`}
                >
                  {plan.cta}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>

                <div className={styles.planFeatures}>
                  {"inherits" in plan && plan.inherits && (
                    <p className={styles.inheritance}>{plan.inherits}</p>
                  )}
                  <ul>
                    {plan.highlights.map((feature) => (
                      <li key={feature}>
                        <Check size={16} aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>

        <p className={styles.importNote}>
          <Check size={18} aria-hidden="true" />
          Bring your content with you. EasyWorship and ProPresenter import is free on every plan.
        </p>

        {embedded && (
          <div style={{ textAlign: "center", marginTop: "36px" }}>
            <Link
              href="/pricing"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                color: "#0238e9",
                fontWeight: 600,
                fontSize: "15px",
                textDecoration: "none",
              }}
            >
              Compare full plan details and features <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>

      {!embedded && showComparison && (
        <section className={styles.comparison} aria-labelledby="comparison-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>THE DETAILS, SIDE BY SIDE</p>
              <h2 id="comparison-heading">Find the right fit for your service.</h2>
            </div>
            <p>
              Every plan, every inclusion.<br />
              See exactly what your team gets.
            </p>
          </div>

          <p className={styles.scrollHint} id="comparison-hint">
            Scroll across the table to compare all four plans.
          </p>

          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="Plan comparison"
            aria-describedby="comparison-hint"
          >
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                MakeChurchEazy monthly pricing and feature comparison for Free, Basic, Growth and Pro Multi-Campus.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Features</th>
                  {plans.map((plan) => (
                    <th
                      key={plan.id}
                      scope="col"
                      className={plan.id === "growth" ? styles.growthColumn : undefined}
                    >
                      {plan.name}
                      {plan.id === "pro" && <span>Multi-Campus</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, rowIndex) => (
                  <tr
                    key={row.label}
                    className={rowIndex === 0 ? styles.priceRow : undefined}
                  >
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, idx) => (
                      <td
                        key={plans[idx].id}
                        className={idx === 2 ? styles.growthColumn : undefined}
                      >
                        <FeatureValue value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!embedded && showFaqs && (
        <section className={styles.faq} aria-labelledby="faq-heading">
          <div className={styles.faqIntro}>
            <p className={styles.eyebrow}>A FEW HELPFUL ANSWERS</p>
            <h2 id="faq-heading">Before you choose.</h2>
            <p>Need a hand finding the right plan for your church?</p>
            <Link href="/contact">
              Talk to our team <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.questions}>
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <ChevronDown size={20} aria-hidden="true" />
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {!embedded && showCta && (
        <section className={styles.cta} aria-labelledby="start-heading">
          <div>
            <h2 id="start-heading">Ready for your next service?</h2>
            <p>Bring your scriptures, songs, and visuals together inside OBS.</p>
          </div>
          <Link
            href="/download"
            className={`${styles.planButton} ${styles.planButtonSolid}`}
            style={{ width: "auto" }}
          >
            Download MakeChurchEazy <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      )}
    </>
  );

  if (embedded) {
    return (
      <section
        id={sectionId}
        style={{
          padding: "88px 32px",
          background: "#ffffff",
          maxWidth: "1440px",
          marginInline: "auto",
        }}
      >
        {content}
      </section>
    );
  }

  return (
    <main id="main" className={styles.page}>
      {content}
    </main>
  );
}
