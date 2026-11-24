#!/usr/bin/env node

/**
 * normalize-update-json.cjs — Normalize Tauri latest.json into the public MCE shape.
 *
 * Tauri's release action emits updater-only aliases like `*-app` / `*-msi` and
 * points URLs at the repository that ran the workflow. MCE publishes downloads
 * through the source release repository and keeps dashboard download
 * aliases (`*-dmg`, `*-exe`) in the same manifest.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE_REPO = "jolamyfoodsng/makechurcheasy";
const LEGACY_SOURCE_REPO = "jolamyfoodsng/makechurcheasy-releases";
const DEFAULT_TARGET_REPO = "jolamyfoodsng/makechurcheasy";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(
    "Usage: node scripts/normalize-update-json.cjs <latest.json> [--out latest.json] [--source-repo owner/repo] [--target-repo owner/repo] [--tag vX.Y.Z] [--notes-file notes.md]",
  );
  process.exit(1);
}

const inputFile = path.resolve(args[0]);
const outIdx = args.indexOf("--out");
const outFile = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : inputFile;

function argValue(name, fallback = "") {
  const idx = args.indexOf(name);
  return idx !== -1 ? String(args[idx + 1] || fallback) : fallback;
}

const sourceRepo = argValue("--source-repo", DEFAULT_SOURCE_REPO);
const targetRepo = argValue("--target-repo", DEFAULT_TARGET_REPO);

if (!fs.existsSync(inputFile)) {
  console.error(`latest.json not found: ${inputFile}`);
  process.exit(1);
}

const original = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const version = String(argValue("--version", original.version || "")).replace(/^v/, "");
if (!version) {
  console.error("Manifest version is missing.");
  process.exit(1);
}

const tag = argValue("--tag", `v${version}`);
const platforms = original.platforms || {};
const targetBase = `https://github.com/${targetRepo}/releases/download/${tag}/`;

function downloadUrl(filename) {
  return `${targetBase}${filename}`;
}

function rewriteUrl(url) {
  if (!url) return "";
  const value = String(url);
  const apiAssetPrefix = `https://api.github.com/repos/${sourceRepo}/releases/assets/`;
  if (value.startsWith(apiAssetPrefix) && /^\d+$/.test(value.slice(apiAssetPrefix.length))) {
    // Tauri points at the build repository's asset API. Use the public release
    // filename fallback in normalizeEntry so updater downloads stay public.
    return "";
  }
  return value
    .replaceAll(`https://github.com/${sourceRepo}/releases/download/${tag}/`, targetBase)
    .replaceAll(`https://github.com/${sourceRepo}/releases/latest/download/`, `https://github.com/${targetRepo}/releases/latest/download/`)
    .replaceAll(`https://github.com/${DEFAULT_SOURCE_REPO}/releases/download/${tag}/`, targetBase)
    .replaceAll(`https://github.com/${DEFAULT_SOURCE_REPO}/releases/latest/download/`, `https://github.com/${targetRepo}/releases/latest/download/`)
    .replaceAll(`https://github.com/${LEGACY_SOURCE_REPO}/releases/download/${tag}/`, targetBase)
    .replaceAll(`https://github.com/${LEGACY_SOURCE_REPO}/releases/latest/download/`, `https://github.com/${targetRepo}/releases/latest/download/`);
}

function firstEntry(keys) {
  for (const key of keys) {
    if (platforms[key]) return platforms[key];
  }
  return null;
}

function normalizeEntry(keys, fallbackFilename, fallbackSignature = "") {
  const entry = firstEntry(keys);
  const signature = entry?.signature || fallbackSignature || "";
  const url = rewriteUrl(entry?.url) || downloadUrl(fallbackFilename);
  return { signature, url };
}

const windowsNsis = firstEntry(["windows-x86_64-nsis", "windows-x86_64-exe"]);
const windowsMsi = firstEntry(["windows-x86_64", "windows-x86_64-msi"]);
const darwinArm = firstEntry(["darwin-aarch64", "darwin-aarch64-app"]);
const darwinX64 = firstEntry(["darwin-x86_64", "darwin-x86_64-app"]);

const normalizedPlatforms = {};

if (windowsNsis) {
  normalizedPlatforms["windows-x86_64-nsis"] = normalizeEntry(
    ["windows-x86_64-nsis", "windows-x86_64-exe"],
    `MakeChurchEasy_${version}_x64-setup.exe`,
  );
}

if (windowsMsi) {
  normalizedPlatforms["windows-x86_64"] = normalizeEntry(
    ["windows-x86_64", "windows-x86_64-msi"],
    `MakeChurchEasy_${version}_x64_en-US.msi`,
  );
}

if (darwinArm) {
  normalizedPlatforms["darwin-aarch64"] = normalizeEntry(
    ["darwin-aarch64", "darwin-aarch64-app"],
    `MakeChurchEasy_${version}_aarch64.app.tar.gz`,
  );
}

if (darwinX64) {
  normalizedPlatforms["darwin-x86_64"] = normalizeEntry(
    ["darwin-x86_64", "darwin-x86_64-app"],
    `MakeChurchEasy_${version}_x64.app.tar.gz`,
  );
}

if (darwinArm) {
  normalizedPlatforms["darwin-aarch64-dmg"] = normalizeEntry(
    ["darwin-aarch64-dmg"],
    `MakeChurchEasy_${version}_aarch64.dmg`,
  );
}

if (darwinX64) {
  normalizedPlatforms["darwin-x86_64-dmg"] = normalizeEntry(
    ["darwin-x86_64-dmg"],
    `MakeChurchEasy_${version}_x64.dmg`,
  );
}

if (windowsNsis) {
  normalizedPlatforms["windows-x86_64-exe"] = normalizeEntry(
    ["windows-x86_64-exe", "windows-x86_64-nsis"],
    `MakeChurchEasy_${version}_x64-setup.exe`,
    windowsNsis.signature || "",
  );
}

// Real release notes (from RELEASE_NOTES.md) replace the generic GitHub
// release template, which is what the in-app "What's New" list shows.
const notesFile = argValue("--notes-file");
let notes = original.notes;
if (notesFile) {
  const resolved = path.resolve(notesFile);
  const text = fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8").trim() : "";
  if (text) notes = text;
  else console.warn(`Notes file ${notesFile} is empty or missing; keeping existing notes.`);
}

const normalized = {
  ...original,
  version,
  notes,
  platforms: normalizedPlatforms,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Normalized latest.json written to ${outFile}`);
