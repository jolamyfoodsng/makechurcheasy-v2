/**
 * graphicPackages.ts — admin-published broadcast graphics ("graphic packages").
 *
 * A package is plain data (format "mce-graphic@1"): fields, an HTML template, CSS and a
 * declarative animation — no code. It is turned into a normal Motion lower third whose
 * `.kx-root` carries the whole package base64-encoded in `data-kx-pkg`;
 * public/kinetic/mce-graphic-packages.js decodes and renders it. Because the package
 * travels inside the theme, OBS, the Dock and previews render it with no network.
 */
import type { LowerThirdTheme, LTVariable } from "./types";
import { KINETIC_THEME_CSS } from "./kineticThemes";

export const GRAPHIC_PACKAGE_FORMAT = "mce-graphic@1";

export type GraphicFieldType = "text" | "color" | "select" | "list" | "image";

export interface GraphicPackageField {
  key: string;
  label?: string;
  type?: GraphicFieldType;
  default?: string;
  defaultValue?: string;
  options?: "icons" | "brands" | Array<string | { label?: string; value: string }>;
  shades?: boolean;
  /** Text field: show a multi-line text area in the editors. */
  multiline?: boolean;
}

export interface GraphicPackage {
  format?: string;
  id: string;
  version?: number;
  name: string;
  category?: string;
  description?: string;
  color?: string;
  hold?: number;
  placement?: { x?: number; y?: number; scale?: number };
  fields: GraphicPackageField[];
  html: string;
  css?: string;
  animation?: Record<string, unknown>;
  updatedAt?: string;
  /** Extra search words for the library (shown nowhere else). */
  tags?: string[];
  /** Day the graphic joined the library (YYYY-MM-DD); recent ones are listed first and marked New. */
  addedAt?: string;
}

/** Same lists the runtime uses for `"options": "icons"` / `"brands"`. */
export const PACKAGE_ICON_OPTIONS: { label: string; value: string }[] = [
  ["globe", "Globe / website"], ["bank", "Bank"], ["phonepay", "Mobile giving"], ["people", "People / in person"],
  ["phone", "Phone"], ["mail", "Email"], ["card", "Card"], ["heart", "Heart"], ["pin", "Location"], ["qr", "Scan code"],
  ["play", "Video"], ["camera", "Camera"], ["chat", "Chat"], ["share", "Share"], ["calendar", "Calendar"], ["clock", "Clock"],
  ["bell", "Bell"], ["like", "Like"], ["cross", "Cross"], ["book", "Book"], ["mic", "Microphone"],
].map(([value, label]) => ({ value, label }));

export const PACKAGE_BRAND_OPTIONS: { label: string; value: string }[] = [
  ["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["x", "X"], ["tiktok", "TikTok"],
  ["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["threads", "Threads"], ["twitch", "Twitch"],
].map(([value, label]) => ({ value, label }));

export function packageThemeId(packageId: string): string {
  return `lt-pkg-${String(packageId).replace(/[^\w-]/g, "")}`;
}

export function isPackageThemeId(themeId: string): boolean {
  return themeId.startsWith("lt-pkg-");
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const attr = (key: string) => `data-v-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

function fieldOptions(field: GraphicPackageField): { label: string; value: string }[] | undefined {
  if (field.options === "icons") return PACKAGE_ICON_OPTIONS;
  if (field.options === "brands") return PACKAGE_BRAND_OPTIONS;
  if (Array.isArray(field.options)) {
    return field.options.map((o) => (typeof o === "string" ? { label: o, value: o } : { label: String(o.label ?? o.value), value: String(o.value) }));
  }
  return undefined;
}

function cleanKey(key: unknown): string {
  return String(key ?? "").replace(/[^\w-]/g, "");
}

/** Turn a package into the lower third the app, the Dock and OBS use. */
/** Field names/labels that hold sentences rather than a short title. */
export function looksLikeLongTextField(key: string, label: string): boolean {
  const name = `${key} ${label}`.toLowerCase();
  if (/new line|wraps|paragraph/.test(name)) return true;
  if (/\b(label|title|name|heading|kicker|tag|role|handle|time|date)\b/.test(key.toLowerCase())) return false;
  return /\b(text|body|message|prayer|answer|question|quote|description|content|notes?|verse|scripture|announcement|details)\b/.test(name);
}

export function packageToTheme(
  pkg: GraphicPackage,
  extra: { tags?: string[] } = {},
): LowerThirdTheme & { graphicCategory?: string; addedAt?: string } {
  const fields = (pkg.fields || [])
    .map((f) => ({ ...f, key: cleanKey(f.key) }))
    .filter((f) => f.key && !f.key.startsWith("kx"));
  const variables: LTVariable[] = fields.map((f) => {
    const type = (["text", "color", "select", "list", "image"].includes(String(f.type)) ? f.type : "text") as GraphicFieldType;
    const defaultValue = String(f.default ?? f.defaultValue ?? "");
    const v: LTVariable = {
      key: f.key,
      label: f.label || f.key,
      type,
      defaultValue,
      group: type === "color" ? "Style" : "Content",
    };
    if (type === "text") {
      v.placeholder = defaultValue;
      // Long text (prayers, answers, notes) gets a text area. Don't rely on the
      // default's length alone: short placeholder defaults ("Your prayer point
      // goes here") would otherwise drop long-text fields to a one-line input.
      if (f.multiline === true || defaultValue.length > 70 || looksLikeLongTextField(f.key, v.label)) {
        v.multiline = true;
      }
    }
    if (type === "list") v.separator = ",";
    const options = fieldOptions(f);
    if (options) v.options = options;
    return v;
  });
  const hold = Number.isFinite(Number(pkg.hold)) ? String(Number(pkg.hold)) : "8";
  const encoded = toBase64Utf8(JSON.stringify(pkg));
  const firstText = fields.find((f) => (f.type || "text") === "text");
  const id = String(pkg.id).replace(/[^\w-]/g, "");
  const html =
    `<div class="kx-root" data-kx="pkg-${id}" data-kx-pkg="${encoded}" data-state="{{state}}" ` +
    fields.map((f) => `${attr(f.key)}="{{${f.key}}}"`).join(" ") +
    // Per-text styling (size / weight / italic / spacing); see textStyle.ts.
    fields
      .filter((f) => (f.type || "text") === "text")
      .map((f) => ` ${attr(f.key)}-ts="{{${f.key}__style}}"`)
      .join("") +
    ` data-v-kx-color="{{kxColor}}" data-v-kx-speed="{{kxSpeed}}" data-v-kx-scale="{{kxScale}}" data-v-kx-auto-out="{{kxAutoOut}}" data-v-kx-loop="{{kxLoop}}">` +
    `<div class="kx-fallback"><div class="kx-fb-name">${firstText ? `{{${firstText.key}}}` : ""}</div></div></div>`;
  const category = String(pkg.category || "others").toLowerCase();
  return {
    id: packageThemeId(id),
    name: pkg.name,
    description: pkg.description || "Broadcast graphic from Make Church Eazy.",
    category: category === "speaker" ? "speaker" : "general",
    graphicCategory: category,
    addedAt: typeof pkg.addedAt === "string" ? pkg.addedAt : undefined,
    icon: "campaign",
    accentColor: pkg.color || "#2563eb",
    tags: [
      "Church", "Graphics", "Motion", "Animated", "Admin",
      ...(Array.isArray(pkg.tags) ? pkg.tags.filter((t): t is string => typeof t === "string") : []),
      ...(extra.tags || []),
    ],
    usesTailwind: false,
    fontImports: ["/fonts/google/google-fonts.css"],
    variables: [
      ...variables,
      { key: "kxSpeed", label: "Speed", type: "number", defaultValue: "1", group: "Style" },
      { key: "kxScale", label: "Size", type: "number", defaultValue: "1", group: "Style" },
      { key: "kxAutoOut", label: "Hold (seconds)", type: "number", defaultValue: hold, group: "Style" },
      { key: "kxLoop", label: "Loop auto", type: "toggle", defaultValue: "0", group: "Style" },
    ],
    html,
    css: KINETIC_THEME_CSS,
  } as LowerThirdTheme & { graphicCategory?: string; addedAt?: string };
}
