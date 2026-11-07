/**
 * releaseNotesService.ts — Provides rich, OBS-style changelog highlights for update modals.
 *
 * When an update modal is displayed, operators should see clear, human-readable
 * descriptions of what has changed ("You can now do X, Y, Z") rather than raw git commit hashes.
 */

export type HighlightBadge = "new" | "improvement" | "fix" | "update";

export interface ReleasePoint {
  lead?: string; // Bold opening prefix (e.g. "Custom Margins:")
  text: string;
}

export interface ReleaseHighlight {
  id: string;
  number: number;
  badge: HighlightBadge;
  badgeLabel: string;
  title: string;
  summary?: string;
  points: ReleasePoint[];
}

/**
 * Built-in curated release notes for recent / upcoming versions.
 * When server notes are brief or generic (e.g. "MakeChurchEazy vX.Y.Z"),
 * these ensure operators always see rich, detailed feature walkthroughs.
 */
export const CURATED_RELEASE_NOTES: Record<string, ReleaseHighlight[]> = {
  // v3.32.0 highlights. Kept under "latest" for reference only — it is no
  // longer shown as a fallback for other versions.
  latest: [
    {
      id: "multiview-spacing",
      number: 1,
      badge: "new",
      badgeLabel: "NEW FEATURE",
      title: "Multi-View Custom Spacing & Live Preview Sync",
      summary: "Full control over multi-view layout geometry and live production broadcasting.",
      points: [
        {
          lead: "Custom Outer Margin & Slot Gap",
          text: "Adjust outer frame margin (0–200px) and inner slot gaps (0–100px) with interactive stepper controls.",
        },
        {
          lead: "Background Lightbox Toggle",
          text: "Choose whether custom backdrops shrink neatly with layout margins or extend edge-to-edge.",
        },
        {
          lead: "Safe Draft Mode",
          text: "Background and spacing tweaks stay in preview and only push live to OBS when you click \"Preview\".",
        },
        {
          lead: "Collapsible Inspector",
          text: "Frame, Background, and Spacing properties are grouped in an open-by-default collapsible bar, saving over 50% vertical space.",
        },
      ],
    },
    {
      id: "voice-ai-guard",
      number: 2,
      badge: "new",
      badgeLabel: "NEW FEATURE",
      title: "Voice AI Speech-to-Scripture Inactivity Guard",
      summary: "Intelligent safeguards to protect transcription credits when microphones are unattended.",
      points: [
        {
          lead: "5-Minute Inactivity Prompt",
          text: "If no voice or speech is detected for 5 minutes, an interactive prompt asks if you're still using it.",
        },
        {
          lead: "10-Minute Extension",
          text: "Click \"I'm still using it\" to reset the timer and extend active listening by 10 minutes without interruption.",
        },
        {
          lead: "Automatic Stop with Notification",
          text: "If left unattended for 60 seconds, listening stops automatically and displays a \"Stopped due to inactivity\" toast.",
        },
      ],
    },
    {
      id: "obs-performance",
      number: 3,
      badge: "improvement",
      badgeLabel: "IMPROVEMENT",
      title: "OBS Sync & Presentation Performance",
      summary: "Optimized scene rendering and faster OBS WebSocket communication.",
      points: [
        {
          lead: "Instant Layout Switching",
          text: "Reduced slot repositioning latency when switching between grid, stacked, and picture-in-picture layouts.",
        },
        {
          lead: "Accurate Sub-Pixel Alignment",
          text: "Slots and frame borders now align pixel-perfect across standard and ultrawide resolutions.",
        },
      ],
    },
    {
      id: "dock-bible-refinements",
      number: 4,
      badge: "improvement",
      badgeLabel: "IMPROVEMENT",
      title: "Dock Bible Tab Toolbar & Picker Refinements",
      summary: "Streamlined navigation, unified overflow actions, and compact book pickers.",
      points: [
        {
          lead: "Promoted Quick Edit",
          text: "Quick Edit is now immediately accessible directly from the bottom toolbar.",
        },
        {
          lead: "Unified Action Menu",
          text: "Compare Translations, Bible History, Reload, and Theme toggles are now unified in the 3-dots menu—always accessible in any search mode.",
        },
        {
          lead: "Compact Book & Chapter Pickers",
          text: "5-column book picker with standard initials and 6-column chapter grid for faster navigation.",
        },
        {
          lead: "Improved Popover Stacking",
          text: "Reference and translation compare popovers always render comfortably above the search bar.",
        },
      ],
    },
    {
      id: "fixes",
      number: 5,
      badge: "fix",
      badgeLabel: "BUG FIX",
      title: "Stability & Polish Fixes",
      points: [
        {
          lead: "OBS Live Leak Fix",
          text: "Resolved an issue where changing background colors in card settings updated OBS prematurely.",
        },
        {
          lead: "Localization Cleanup",
          text: "Fixed missing translations for frame properties and spacing controls.",
        },
      ],
    },
  ],
};

/**
 * Parses raw release notes (markdown / text) into structured OBS-style highlights.
 */
export function parseRawReleaseNotes(notes: string): ReleaseHighlight[] {
  if (!notes || typeof notes !== "string") return [];

  const lines = notes.slice(0, 16_000).split(/\r?\n/);
  const highlights: ReleaseHighlight[] = [];
  let currentHighlight: ReleaseHighlight | null = null;
  let itemCounter = 1;

  const detectBadge = (text: string): { badge: HighlightBadge; badgeLabel: string } => {
    const lower = text.toLowerCase();
    if (lower.includes("new") || lower.includes("feature") || lower.includes("added")) {
      return { badge: "new", badgeLabel: "NEW FEATURE" };
    }
    if (lower.includes("fix") || lower.includes("resolved") || lower.includes("bug")) {
      return { badge: "fix", badgeLabel: "BUG FIX" };
    }
    if (lower.includes("improv") || lower.includes("enhanc") || lower.includes("optimi") || lower.includes("perf")) {
      return { badge: "improvement", badgeLabel: "IMPROVEMENT" };
    }
    return { badge: "update", badgeLabel: "UPDATE" };
  };

  const parsePoint = (rawText: string): ReleasePoint => {
    // Check for bold leading text: **Lead:** Rest of text or **Lead** - Rest of text
    const boldMatch = rawText.match(/^\*\*([^*]+)\*\*[:\s-]*(.+)$/);
    if (boldMatch) {
      const cleanLead = boldMatch[1].replace(/[:\s-]+$/, "").trim();
      return { lead: cleanLead, text: boldMatch[2].trim() };
    }
    const colonMatch = rawText.match(/^([A-Za-z0-9\s/_-]{3,25}):\s+(.+)$/);
    if (colonMatch && !colonMatch[1].startsWith("http")) {
      return { lead: colonMatch[1].trim(), text: colonMatch[2].trim() };
    }
    return { text: rawText };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for numbered heading or markdown heading:
    // e.g., "## 1. Multi-View" or "### New Features" or "1. Multi-View"
    const headingMatch =
      trimmed.match(/^#{1,3}\s*(?:\d+[\.\)]\s*)?(.+)$/) ||
      trimmed.match(/^(?:\d+[\.\)]\s+)(.+)$/);

    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      const { badge, badgeLabel } = detectBadge(headingText);

      // Strip badge prefix if user wrote "[NEW] Multi-View"
      const cleanTitle = headingText.replace(/^\[(NEW|FEATURE|IMPROVEMENT|FIX|BUG FIX)\]\s*/i, "");

      currentHighlight = {
        id: `section-${itemCounter}`,
        number: itemCounter++,
        badge,
        badgeLabel,
        title: cleanTitle,
        points: [],
      };
      highlights.push(currentHighlight);
      continue;
    }

    // Check for bullet points (- or * or •)
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      const point = parsePoint(bulletMatch[1]);
      if (!currentHighlight) {
        // Create initial section if notes started with bullets directly
        currentHighlight = {
          id: `section-${itemCounter}`,
          number: itemCounter++,
          badge: "new",
          badgeLabel: "NEW",
          title: "What's New in this Release",
          points: [],
        };
        highlights.push(currentHighlight);
      }
      currentHighlight.points.push(point);
      continue;
    }

    // If it's a standalone descriptive paragraph under a section
    if (currentHighlight && !currentHighlight.summary && currentHighlight.points.length === 0) {
      currentHighlight.summary = trimmed;
    } else if (currentHighlight) {
      currentHighlight.points.push(parsePoint(trimmed));
    }
  }

  return highlights;
}

/**
 * Remove the generic GitHub release template that CI used to put in
 * latest.json ("## MakeChurchEazy", the "### Downloads" table, "### Auto-Update",
 * "Built automatically from commit ..."). What is left is the real changelog,
 * or an empty string when there was none.
 */
export function stripReleaseBoilerplate(notes?: string | null): string {
  if (!notes || typeof notes !== "string") return "";
  const lines = notes.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const title = heading[1].trim().toLowerCase();
      skipping =
        /^makechurch(?:eazy|easy)$/.test(title) ||
        title === "downloads" ||
        title === "auto-update" ||
        title === "auto update";
      if (skipping) continue;
    }
    if (skipping) continue;
    if (/^\|.*\|$/.test(trimmed)) continue; // markdown table rows
    if (/^_?built automatically from commit/i.test(trimmed)) continue;
    if (/^-{3,}$/.test(trimmed)) continue;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

/**
 * Determines whether raw notes contain meaningful release descriptions
 * or are merely trivial automated strings (e.g. "MakeChurchEazy v3.19.0").
 */
export function isTrivialReleaseNotes(notes?: string | null): boolean {
  const cleaned = stripReleaseBoilerplate(notes);
  if (!cleaned) return true;
  // If it's just "MakeChurchEazy vX.Y.Z" or "vX.Y.Z"
  if (/^(?:MakeChurchEazy\s+)?v?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i.test(cleaned)) {
    return true;
  }
  return false;
}

/**
 * Returns the OBS-style release highlights for the given version and raw notes.
 * Real notes from the release manifest win. Curated notes are used only when
 * they were written for this exact version, so users never see an older
 * release's changelog presented as "What's New".
 */
export function getReleaseHighlights(version?: string, rawNotes?: string): ReleaseHighlight[] {
  if (rawNotes && !isTrivialReleaseNotes(rawNotes)) {
    const parsed = parseRawReleaseNotes(stripReleaseBoilerplate(rawNotes));
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const normalizedVer = (version || "").replace(/^v/, "");
  if (normalizedVer && CURATED_RELEASE_NOTES[normalizedVer]) {
    return CURATED_RELEASE_NOTES[normalizedVer];
  }

  return [];
}
