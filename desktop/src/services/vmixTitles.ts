/**
 * vmixTitles.ts — MakeChurchEazy's vMix title ("vMix titles" output mode).
 *
 * One vMix title, "MCE Presentation", that vMix draws itself on the graphics
 * card, so it is far lighter than a Web Browser input (a copy of Chromium
 * inside vMix). It switches between two looks:
 *   - full screen: a dark background image, "Reference" above "Text";
 *   - lower third: a bar and an accent strip, "LTReference" above "LTText".
 * vMix can't recolour or hide shapes in a GT title, but it can swap or clear
 * an image (`SetImage`), so the backgrounds are small PNG images. The text is
 * set with `SetText`; long text shrinks to fit.
 */

import type { PresentationRemoteItem } from "../presentation/types";
import type { PresentationRemoteState } from "./presentationState";
import type { VmixTitleJob } from "./vmixClient";

export type MceTitleKind = "fullscreen" | "lowerThird";

/** The title's text fields and images, as vMix's `SelectedName` names them. */
export const MCE_TITLE_FIELDS = {
  fullscreen: { reference: "Reference.Text", text: "Text.Text" },
  lowerThird: { reference: "LTReference.Text", text: "LTText.Text" },
} as const;
export const MCE_TITLE_IMAGES = {
  background: "Background.Source",
  bar: "Bar.Source",
  accent: "Accent.Source",
} as const;

/** Paths of the title's images on this computer. */
export interface MceTitleImages {
  background: string;
  bar: string;
  accent: string;
}

/**
 * The images: a solid colour each, at the shape's proportions (vMix keeps an
 * image's proportions when it scales it). Colours are #RRGGBBAA.
 */
export const MCE_TITLE_IMAGE_SPECS: Record<keyof MceTitleImages, { width: number; height: number; color: string }> = {
  background: { width: 32, height: 18, color: "#101114F2" },
  bar: { width: 216, height: 29, color: "#141418E6" },
  accent: { width: 3, height: 58, color: "#E8C46AFF" },
};

const ACCENT = "#FFE8C46A";
const TEXT = "#FFFFFFFF";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function image(name: string, x: number, y: number, w: number, h: number, source: string): string {
  return `        <Image Name="${name}" Dimensions="${w},${h},0" Location="${x},${y},0">
          <Image.Bitmap>
            <Bitmap Source="${escapeXml(source)}" />
          </Image.Bitmap>
        </Image>`;
}

function textBlock(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { size: number; color: string; align: "Left" | "Center"; text: string },
): string {
  // TextAlign is omitted for left alignment, as vMix's own titles do.
  const align = options.align === "Center" ? ` TextAlign="Center"` : "";
  return `        <TextBlock Name="${name}" Dimensions="${w},${h},0" Location="${x},${y},0" Text="${escapeXml(options.text)}" FontFamily="Segoe UI" FontSize="${options.size}" FontWeight="Bold"${align} VerticalAlign="Center" AutoSize="Shrink">
          <TextBlock.Fill>
            <Brush Color="${options.color}" />
          </TextBlock.Fill>
        </TextBlock>`;
}

/**
 * GT XML for "MCE Presentation", 1920×1080, fading in and out. Every image is
 * set here; the app clears the ones the current look doesn't use before the
 * title goes on air.
 */
export function buildMceTitleXml(images: MceTitleImages): string {
  const shapes = [
    image("Background", 0, 0, 1920, 1080, images.background),
    image("Bar", 96, 772, 1728, 232, images.bar),
    image("Accent", 96, 772, 12, 232, images.accent),
    textBlock("Reference", 160, 110, 1600, 90, { size: 48, color: ACCENT, align: "Center", text: "" }),
    textBlock("Text", 160, 220, 1600, 760, { size: 80, color: TEXT, align: "Center", text: "" }),
    textBlock("LTReference", 144, 792, 1640, 56, { size: 36, color: ACCENT, align: "Left", text: "" }),
    textBlock("LTText", 144, 852, 1640, 136, { size: 56, color: TEXT, align: "Left", text: "" }),
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<Composition Width="1920" Height="1080">
  <Layer Name="Layer1" Dimensions="1920,1080,0">
    <Layer.Composition>
      <Composition Width="1920" Height="1080">
${shapes.join("\n")}
      </Composition>
    </Layer.Composition>
  </Layer>
  <Storyboard>
    <Storyboard.Animations>
      <Fade Object="Layer1" Duration="0.3" />
    </Storyboard.Animations>
  </Storyboard>
  <Storyboard Type="TransitionOut">
    <Storyboard.Animations>
      <Fade Object="Layer1" Duration="0.3" />
    </Storyboard.Animations>
  </Storyboard>
</Composition>
`;
}

/** Which image goes in each slot for a look ("" clears the slot). */
export function titleImagesForLayout(layout: MceTitleKind, images: MceTitleImages): Record<keyof MceTitleImages, string> {
  return layout === "fullscreen"
    ? { background: images.background, bar: "", accent: "" }
    : { background: "", bar: images.bar, accent: images.accent };
}

export interface MceTitleContent {
  /** Full screen or lower third (MCE's own title switches its look; a church title has one look). */
  kind: MceTitleKind;
  /** Which title does it: the scripture, songs or names title. */
  job: VmixTitleJob;
  /** Small line: verse reference, song title, a person's role. */
  reference: string;
  /** Main text: verse, lyric, a person's name. */
  text: string;
}

/** Which title shows this item: scripture for verses, names for people, songs for lyrics and notes. */
export function titleJobForItem(item: PresentationRemoteItem): VmixTitleJob {
  if (item.source === "bible") return "scripture";
  if (item.source === "text" && (item.title ?? "").trim() && item.title !== "Media Text") return "names";
  return "songs";
}

/** The two text fields for one presentation item, or null when a title can't show it. */
export function titleFieldsFromItem(item: PresentationRemoteItem): { reference: string; text: string } | null {
  if (item.variant === "media" || item.variant === "countdown" || item.variant === "ticker") return null;
  if (item.source === "media" || item.source === "countdown" || item.source === "ticker") return null;
  const body = (item.body ?? "").trim();
  const title = (item.title ?? "").trim();
  const reference = (item.reference ?? "").trim();

  if (item.source === "bible") {
    if (!body) return null;
    return { reference: reference ? `${title} (${reference})` : title, text: body };
  }
  if (item.source === "worship") {
    if (!body) return null;
    return { reference: item.meta?.showTitle ? title : "", text: body };
  }
  // Text: a person's name with their role, or a plain message.
  if (title && title !== "Media Text") {
    return { reference: body, text: title };
  }
  return body ? { reference: "", text: body } : null;
}

/** What the vMix title should show for this presentation state. */
export function titleContentFromState(state: PresentationRemoteState | null): MceTitleContent | null {
  if (state?.fullscreen) {
    const fields = titleFieldsFromItem(state.fullscreen);
    return fields ? { kind: "fullscreen", job: titleJobForItem(state.fullscreen), ...fields } : null;
  }
  if (state?.lowerThird) {
    const fields = titleFieldsFromItem(state.lowerThird);
    return fields ? { kind: "lowerThird", job: titleJobForItem(state.lowerThird), ...fields } : null;
  }
  return null;
}

// ── Saving the title (app only) ─────────────────────────────────────────────

/** A solid-colour PNG as base64, drawn with a canvas. */
function solidPngBase64(width: number, height: number, rgba: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the vMix title images.");
  const hex = rgba.replace("#", "");
  const [r, g, b, a] = [0, 2, 4, 6].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

export interface MceTitleFiles {
  /** The title file to give vMix (`AddInput Title|<path>`). */
  titlePath: string;
  images: MceTitleImages;
}

let titleFilesPromise: Promise<MceTitleFiles> | null = null;

/** Save the title and its images through the app (once per run) and return their paths. */
export function ensureMceTitleFiles(): Promise<MceTitleFiles> {
  titleFilesPromise ??= (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const entries = await Promise.all(
      (Object.keys(MCE_TITLE_IMAGE_SPECS) as Array<keyof MceTitleImages>).map(async (key) => {
        const spec = MCE_TITLE_IMAGE_SPECS[key];
        const path = await invoke<string>("write_vmix_title_image", {
          name: `mce-presentation-${key}`,
          pngBase64: solidPngBase64(spec.width, spec.height, spec.color),
        });
        return [key, path] as const;
      }),
    );
    const images = Object.fromEntries(entries) as unknown as MceTitleImages;
    const titlePath = await invoke<string>("write_vmix_title_file", {
      name: "mce-presentation",
      xml: buildMceTitleXml(images),
    });
    return { titlePath, images };
  })().catch((error) => {
    titleFilesPromise = null;
    throw error;
  });
  return titleFilesPromise;
}

// ── The church's own vMix titles ────────────────────────────────────────────

/** vMix's usual field names, most likely first (vMix's built-in titles use Headline/Description most). */
const REFERENCE_FIELD_NAMES = ["Verse", "Headline", "Title", "Reference", "Name", "Top Text", "First Title", "Headline1"];
const TEXT_FIELD_NAMES = ["Scripture", "Message", "Text", "Description", "Desc", "Lyrics", "Body", "Bottom Text", "Second Title"];

function fieldBaseName(field: string): string {
  return field.replace(/\.Text$/i, "").trim().toLowerCase();
}

function pickField(fields: string[], names: string[], exclude: string): string {
  for (const name of names) {
    const match = fields.find((field) => field !== exclude && fieldBaseName(field) === name.toLowerCase());
    if (match) return match;
  }
  return "";
}

/**
 * Which of a title's text fields MCE fills: the reference (or name) field and
 * the main text field, from vMix's usual names. A title with one field gets
 * only the main text.
 */
export function guessTitleFields(fields: string[]): { referenceField: string; textField: string } {
  if (fields.length === 0) return { referenceField: "", textField: "" };
  if (fields.length === 1) return { referenceField: "", textField: fields[0] };
  let textField = pickField(fields, TEXT_FIELD_NAMES, "");
  let referenceField = pickField(fields, REFERENCE_FIELD_NAMES, textField);
  if (!textField) textField = fields.find((field) => field !== referenceField) ?? "";
  if (!referenceField) referenceField = fields.find((field) => field !== textField) ?? "";
  return { referenceField, textField };
}

/**
 * The values for a church title's two fields. In a names title the person's
 * name goes in the headline field and their role underneath, as vMix's own
 * name titles (Headline/Description) expect.
 */
export function churchTitleValues(content: MceTitleContent): { reference: string; text: string } {
  return content.job === "names"
    ? { reference: content.text, text: content.reference }
    : { reference: content.reference, text: content.text };
}

/** vMix's own built-in title for each job, added when a church wants one and has none. */
export const VMIX_BUILTIN_TITLES: Record<VmixTitleJob, string> = {
  scripture: "Title 28- Scripture and Verse Blue.gtzip",
  songs: "Title 40- Songs Blue.gtzip",
  names: "Title 0- The Classic Blue.gtzip",
};
