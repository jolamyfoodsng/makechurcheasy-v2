/**
 * The founder's public profile, in one place. The About page, the site-wide
 * structured data (JSON-LD), the sitemap and llms.txt all read from here, so a
 * profile link added once reaches Google and AI assistants everywhere.
 */
export const SITE_URL = "https://makechurcheazy.com";

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const FOUNDER_PATH = "/about";
export const FOUNDER_ID = `${SITE_URL}${FOUNDER_PATH}#tayo-akosile`;

export const FOUNDER = {
  name: "Tayo Akosile",
  givenName: "Tayo",
  familyName: "Akosile",
  /** Shown on the page and used as schema.org jobTitle. */
  jobTitle: "Founder and CEO",
  company: "MakeChurchEazy",
  /** One sentence, used for the page description, search snippets and AI summaries. */
  summary:
    "Tayo Akosile is the founder and CEO of MakeChurchEazy, church presentation software that works inside OBS Studio.",
} as const;

/**
 * Tayo's own profiles. Paste the full https:// address of each one and it is
 * linked on the About page and published as `sameAs`, which is how Google
 * connects the name to these accounts. Leave a value empty to leave it out.
 */
export const FOUNDER_PROFILES = {
  linkedin: "",
  x: "",
  youtube: "",
  instagram: "",
  facebook: "",
} as const;

/** MakeChurchEazy's own channels (company, not personal). */
export const COMPANY_PROFILES = {
  telegram: "https://t.me/makechurcheasy",
} as const;

const PROFILE_LABELS: Record<keyof typeof FOUNDER_PROFILES, string> = {
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

function cleanUrls(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of urls) {
    const value = raw.trim();
    if (!/^https:\/\/[^\s]+$/i.test(value)) continue;
    seen.add(value.replace(/\/+$/, ""));
  }
  return [...seen];
}

/** Founder profile links that are filled in, with their names, for the page. */
export function founderProfileLinks(
  profiles: Readonly<Record<string, string>> = FOUNDER_PROFILES,
): Array<{ key: string; label: string; href: string }> {
  return Object.entries(profiles)
    .map(([key, href]) => ({ key, label: PROFILE_LABELS[key as keyof typeof FOUNDER_PROFILES] ?? key, href: href.trim() }))
    .filter((link) => cleanUrls([link.href]).length > 0);
}

export function founderSameAs(profiles: Readonly<Record<string, string>> = FOUNDER_PROFILES): string[] {
  return cleanUrls(Object.values(profiles));
}

export function companySameAs(profiles: Readonly<Record<string, string>> = COMPANY_PROFILES): string[] {
  return cleanUrls(Object.values(profiles));
}

/** The person, as a schema.org node. */
export function founderPersonNode(profiles: Readonly<Record<string, string>> = FOUNDER_PROFILES) {
  const sameAs = founderSameAs(profiles);
  return {
    "@type": "Person",
    "@id": FOUNDER_ID,
    name: FOUNDER.name,
    givenName: FOUNDER.givenName,
    familyName: FOUNDER.familyName,
    jobTitle: FOUNDER.jobTitle,
    description: FOUNDER.summary,
    url: `${SITE_URL}${FOUNDER_PATH}`,
    worksFor: { "@id": ORGANIZATION_ID },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** What the About page publishes: a profile page whose subject is the founder. */
export function aboutPageJsonLd(profiles: Readonly<Record<string, string>> = FOUNDER_PROFILES) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${SITE_URL}${FOUNDER_PATH}#profile`,
        url: `${SITE_URL}${FOUNDER_PATH}`,
        name: `About ${FOUNDER.name}, ${FOUNDER.jobTitle} of ${FOUNDER.company}`,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": FOUNDER_ID },
        mainEntity: { "@id": FOUNDER_ID },
      },
      founderPersonNode(profiles),
    ],
  };
}
