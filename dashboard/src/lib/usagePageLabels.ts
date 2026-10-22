/**
 * Friendly names for the pages and dock tabs the desktop app reports in its usage events
 * (see desktop/src/services/usageTracker.ts). Unknown pages are shown as they were reported.
 */

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/speech-to-scripture": "Verse AI",
  "/studio": "Studio",
  "/broadcast": "Broadcast",
  "/broadcast-graphics": "Broadcast Graphics",
  "/countdowns": "Countdowns",
  "/bible": "Bible",
  "/bible-library": "Bible library",
  "/bible/translations": "Bible translations",
  "/worship": "Worship",
  "/songs": "Songs",
  "/library": "Library",
  "/lower-thirds": "Lower thirds",
  "/live": "Live",
  "/live-tools": "Live tools",
  "/multiview": "Multi-View",
  "/scenes": "Scenes",
  "/templates": "Templates",
  "/design-studio": "Design Studio",
  "/production/themes": "Themes",
  "/transcripts": "Transcripts",
  "/transcripts/:id": "Transcript detail",
  "/transcribe": "Transcribe",
  "/service": "Service",
  "/service-planner": "Service planner",
  "/service-hub": "Service hub",
  "/service-control-hub": "Service control hub",
  "/hub": "Hub",
  "/resources": "Resources",
  "/tutorials": "Tutorials",
  "/credits": "Credits",
  "/settings": "Settings",
  "/onboarding": "Onboarding",
  "/quick-merge": "Quick merge",
  "/gallery": "Gallery",
  "/graphics": "Graphics",
  "/new": "New",
  "dock/planner": "Dock: Planner",
  "dock/bible": "Dock: Bible",
  "dock/worship": "Dock: Worship",
  "dock/notes": "Dock: Notes",
  "dock/media": "Dock: Media",
  "dock/multiview": "Dock: Multi-View",
  "dock/ministry": "Dock: Ministry",
  "dock/broadcast": "Dock: Broadcast",
  "verse-ai-dock": "Verse AI dock",
};

export function usagePageLabel(page: string): string {
  return PAGE_LABELS[page] ?? page;
}

export const USAGE_SURFACE_LABELS: Record<string, string> = {
  app: "Desktop app",
  dock: "OBS dock",
  "lm-dock": "Verse AI dock",
};

/** The pages the team watches most closely: is anyone really using them? */
export const KEY_USAGE_PAGES: Array<{ surface: string; page: string; label: string }> = [
  { surface: "app", page: "/speech-to-scripture", label: "Verse AI" },
  { surface: "app", page: "/broadcast", label: "Broadcast" },
  { surface: "app", page: "/studio", label: "Studio" },
  { surface: "app", page: "/broadcast-graphics", label: "Broadcast Graphics" },
  { surface: "lm-dock", page: "verse-ai-dock", label: "Verse AI dock" },
  { surface: "dock", page: "dock/bible", label: "Dock: Bible" },
];
