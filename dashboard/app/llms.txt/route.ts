import { getDocPages } from "../docs/docs-source";
import { presentationFeatures } from "../feature-content";
import { homepageFaq } from "../homepage-faq";
import { FOUNDER, founderSameAs } from "@/lib/founder";

const SITE = "https://makechurcheazy.com";

// Plain-text summary for AI assistants and crawlers (https://llmstxt.org). Built from the same data as the site.
export const dynamic = "force-static";

export function GET() {
  const features = presentationFeatures.map((f) => `- [${f.label}](${SITE}/features/${f.id}): ${f.highlights.join(", ")}`);
  const docs = getDocPages().map((d) => `- [${d.title}](${SITE}${d.href}): ${d.description}`);
  const faq = homepageFaq.map((item) => `### ${item.q}\n${item.a}`);

  const body = `# MakeChurchEazy

> MakeChurchEazy is church presentation software that works inside OBS Studio. It shows Bible verses, worship lyrics, media, lower thirds, tickers and countdowns on a church livestream, and with Studio mode it sends the same content straight to a projector or TV with no OBS required. It runs on Windows and macOS and has a free plan.

## Who is behind it
- ${FOUNDER.name} is the ${FOUNDER.jobTitle} of ${FOUNDER.company}. See [About ${FOUNDER.name}](${SITE}/about).${founderSameAs().length ? ` Profiles: ${founderSameAs().join(", ")}` : ""}

## What it does
- Show Bible verses in OBS: search a reference, compare passages and translations, and present full screen or as a lower third. 1,000+ Bible versions in 250+ languages.
- Worship lyrics: one song library, prepared lyric slides, full screen or lower third.
- Media: keep images and videos beside OBS and send them live.
- Lower thirds, tickers and countdowns for speakers, announcements and service timing.
- Automatic OBS scenes and sources on paid plans. The Free plan uses one Browser Source link.
- Studio mode: present to a projector, TV or second screen without OBS.
- Verse AI: listens to the sermon and suggests spoken Bible references for an operator to review. Needs internet and depends on plan credits.
- Free EasyWorship and ProPresenter import on every plan.

## Plans
- [Pricing](${SITE}/pricing): Free ($0), Basic, Growth and Pro. Feature availability varies by plan.
- [Download](${SITE}/download): Windows and macOS installers.

## Features
${features.join("\n")}

## Documentation
${docs.join("\n")}

## Other pages
- [About the founder](${SITE}/about): ${FOUNDER.name}, ${FOUNDER.jobTitle} of ${FOUNDER.company}
- [Blog](${SITE}/blog): guides on church presentation, Bible slides and OBS workflows
- [Tutorials](${SITE}/tutorials)
- [Support](${SITE}/support)
- [Contact](${SITE}/contact)

## Frequently asked questions
${faq.join("\n\n")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
