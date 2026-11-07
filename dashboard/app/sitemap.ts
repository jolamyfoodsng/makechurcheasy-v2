import type { MetadataRoute } from "next";
import { presentationFeatures } from "./feature-content";

const SITE = "https://makechurcheazy.com";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3004";
// Keep this list aligned with dashboard/content/docs. The worker cannot read the
// Markdown source directory when it regenerates the sitemap at runtime.
const DOC_PATHS = [
  "/docs",
  "/docs/bible",
  "/docs/graphics",
  "/docs/media",
  "/docs/mobile-remote",
  "/docs/obs-setup",
  "/docs/reference",
  "/docs/studio-mode",
  "/docs/troubleshooting",
  "/docs/verse-ai",
  "/docs/worship",
];

// Docs and features are known at build time; blog posts come from the API, so refresh hourly.
export const revalidate = 3600;

async function getBlogEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/blog?limit=200`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.posts || [])
      .filter((post: { slug?: string }) => post.slug)
      .map((post: { slug: string; date?: string; updatedAt?: string }) => {
        const modified = new Date(post.updatedAt || post.date || "");
        return {
          url: `${SITE}/blog/${post.slug}`,
          ...(Number.isNaN(modified.getTime()) ? {} : { lastModified: modified }),
          changeFrequency: "monthly" as const,
          priority: 0.7,
        };
      });
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly"): MetadataRoute.Sitemap[number] => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    page("", 1, "weekly"),
    page("/download", 0.9, "weekly"),
    page("/pricing", 0.9, "weekly"),
    page("/features", 0.9, "monthly"),
    ...presentationFeatures.map((feature) => page(`/features/${feature.id}`, 0.8, "monthly")),
    page("/docs", 0.8, "monthly"),
    ...DOC_PATHS.filter((path) => path !== "/docs").map((path) => page(path, 0.7, "monthly")),
    page("/blog", 0.8, "weekly"),
    ...(await getBlogEntries()),
    page("/tutorials", 0.7, "monthly"),
    page("/support", 0.6, "monthly"),
    page("/about", 0.6, "monthly"),
    page("/contact", 0.5, "monthly"),
  ];
}
