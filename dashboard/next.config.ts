import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const configDir = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: configDir,
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: "/pricing-page",
        destination: "/pricing",
        permanent: true,
      },
      // Old docs pages, renamed when the docs moved to task-based Markdown pages.
      { source: "/docs/scripture-engine", destination: "/docs/bible", permanent: true },
      { source: "/docs/worship-lyrics", destination: "/docs/worship", permanent: true },
      { source: "/docs/multiview-production", destination: "/docs/media", permanent: true },
      { source: "/docs/stage-display", destination: "/docs/mobile-remote", permanent: true },
      { source: "/docs/hardware-projection", destination: "/docs/studio-mode", permanent: true },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "makechurcheasy.creatorstudioslabs.stream",
          },
        ],
        destination: "https://makechurcheazy.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
