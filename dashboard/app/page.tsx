import type { Metadata } from "next";
import { socialPreview, socialTitle, socialDescription } from "@/lib/social-preview";
import Homepage from "./homepage";
import { homepageFaq } from "./homepage-faq";

const title = "Show Bible Verses, Lyrics & Lower Thirds in OBS | MakeChurchEazy";
const description = "Church presentation software for OBS Studio. Show Bible verses, worship lyrics, media and lower thirds on your livestream or projector. Free plan available.";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://makechurcheazy.com/#faq",
  mainEntity: homepageFaq.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: socialTitle, description: socialDescription, type: "website", url: "/", siteName: "MakeChurchEazy",
    images: [socialPreview],
  },
  twitter: { card: "summary_large_image", title: socialTitle, description: socialDescription, images: [socialPreview] },
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }} />
    <Homepage />
  </>;
}
