import type { Metadata } from "next";
import { socialPreview, socialTitle, socialDescription } from "@/lib/social-preview";
import { Inter, Sora, Open_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import I18nProvider from "@/i18n/provider";
import { DEFAULT_LOCALE, resolveLocalePreference } from "@/i18n/routing";
import { getInitialMongoUser } from "@/lib/serverAuth";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import ClientErrorTelemetry from "@/components/ClientErrorTelemetry";
import TrafficSourceCapture from "@/components/TrafficSourceCapture";

import { FOUNDER_ID, companySameAs, founderPersonNode } from "@/lib/founder";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MCE Admin",
  },
  title: {
    default: "MakeChurchEazy | Church Presentation Software for OBS",
    template: "%s | MakeChurchEazy",
  },
  description:
    "MakeChurchEazy is an all-in-one church presentation and OBS software for displaying Bible verses, worship lyrics, media, lower thirds, announcements, AI tools, and livestream graphics.",
  keywords: [
    "church presentation software",
    "OBS Studio church",
    "Bible verse display",
    "worship lyrics software",
    "church lower thirds",
    "livestream graphics",
    "church media management",
    "sermon transcription",
    "live translation church",
    "church broadcasting software",
    "OBS plugin church",
    "church announcements display",
  ],
  authors: [{ name: "MakeChurchEazy" }],
  creator: "MakeChurchEazy",
  publisher: "MakeChurchEazy",
  metadataBase: new URL("https://makechurcheazy.com"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://makechurcheazy.com",
    siteName: "MakeChurchEazy",
    title: "MakeChurchEazy | Church Presentation Software for OBS",
    description:
      "MakeChurchEazy is an all-in-one church presentation and OBS software for displaying Bible verses, worship lyrics, media, lower thirds, announcements, AI tools, and livestream graphics.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1376,
        height: 768,
        alt: "MakeChurchEazy — Church Presentation Software for OBS Studio. Get Your First Month Free!",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MakeChurchEazy | Church Presentation Software for OBS",
    description:
      "All-in-one church presentation and OBS software for Bible verses, worship lyrics, media, lower thirds, AI tools, and livestream graphics. Get your first month free!",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    other: [
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://makechurcheazy.com/#website",
      url: "https://makechurcheazy.com",
      name: "MakeChurchEazy",
      description:
        "MakeChurchEazy is an all-in-one church presentation and OBS software for displaying Bible verses, worship lyrics, media, lower thirds, announcements, AI tools, and livestream graphics.",
      publisher: { "@id": "https://makechurcheazy.com/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "Organization",
      "@id": "https://makechurcheazy.com/#organization",
      name: "MakeChurchEazy",
      url: "https://makechurcheazy.com",
      logo: {
        "@type": "ImageObject",
        url: "https://makechurcheazy.com/logos/make_church_easy_logo.png",
      },
      // Who is behind the company: lets Google and AI answers say "Founder and CEO" next to the name.
      founder: { "@id": FOUNDER_ID },
      ...(companySameAs().length ? { sameAs: companySameAs() } : {}),
    },
    founderPersonNode(),
    {
      "@type": "SoftwareApplication",
      "@id": "https://makechurcheazy.com/#software",
      name: "MakeChurchEazy",
      url: "https://makechurcheazy.com",
      description:
        "Church presentation and OBS software for Bible verses, worship lyrics, media, lower thirds, announcements, and livestream graphics.",
      applicationCategory: "BusinessApplication",
      operatingSystem: ["macOS", "Windows"],
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialMongoUser = await getInitialMongoUser();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value;
  const acceptLanguage = headerStore.get("accept-language");
  const locale = resolveLocalePreference(
    initialMongoUser?.language || localeCookie,
    initialMongoUser?.country,
    acceptLanguage,
  ) || DEFAULT_LOCALE;

  let messages: Record<string, unknown> = {};
  try {
    messages = (await import(`@/locales/${locale}.json`)).default;
  } catch {
    messages = (await import("@/locales/en.json")).default;
  }

  return (
    <html lang={locale} className={`dark ${bodyFont.variable} ${displayFont.variable} ${openSans.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.classList.toggle('dark', dark);
                document.documentElement.classList.toggle('light', !dark);
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-900 dark:text-white antialiased" style={{ fontFamily: "var(--font-body), var(--font-sans), ui-sans-serif, system-ui, sans-serif" }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(siteJsonLd).replace(/</g, "\\u003c"),
          }}
        />
        <GoogleAnalytics />
        <TrafficSourceCapture />
        <I18nProvider locale={locale} messages={messages}>
          <AuthProvider initialMongoUser={initialMongoUser}>
            <ClientErrorTelemetry />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
