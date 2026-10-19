#!/usr/bin/env node
/**
 * release.cjs — bump the desktop version and publish a release from the
 * MakeChurchEasy V2 repository.
 *
 *   npm run release:patch   (or :minor / :major)
 *
 * What it does:
 *   1. Checks the repo root (the folder above desktop/) is jolamyfoodsng/makechurcheasy-v2.
 *   2. Bumps desktop/package.json and syncs tauri.conf.json.
 *   3. Commits the version files and release workflow metadata, tags vX.Y.Z,
 *      and pushes the branch and tag to origin. The tag starts the release workflow.
 *
 * Other uncommitted changes are NOT included. Commit them first, or pass
 * --allow-dirty to release anyway.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const EXPECTED_REPO = "jolamyfoodsng/makechurcheasy-v2";
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..");
const bump = process.argv[2];
const allowDirty = process.argv.includes("--allow-dirty");
const dryRun = process.argv.includes("--dry-run");

if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: node scripts/release.cjs <patch|minor|major> [--allow-dirty] [--dry-run]");
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

const remote = git("remote", "get-url", "origin");
if (!remote.replace(/\.git$/, "").endsWith(EXPECTED_REPO)) {
  console.error(`Refusing to release: origin is ${remote}, expected github.com/${EXPECTED_REPO}`);
  process.exit(1);
}

const versionFiles = [
  "desktop/package.json",
  "desktop/package-lock.json",
  "desktop/src-tauri/tauri.conf.json",
  "desktop/beta-landing/index.html",
];
const releaseMetadataFiles = [".github/workflows/release.yml", "desktop/scripts/release.cjs"];
const releaseFiles = [...versionFiles, ...releaseMetadataFiles];
const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3))
  .filter((file) => !releaseFiles.includes(file));
if (dirty.length && !allowDirty) {
  console.error(`There are ${dirty.length} other uncommitted changes, which would NOT be in this release:`);
  console.error(dirty.slice(0, 15).map((f) => `  ${f}`).join("\n") + (dirty.length > 15 ? "\n  ..." : ""));
  console.error("Commit them first, or rerun with --allow-dirty.");
  process.exit(1);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const pkgPath = path.join(desktopDir, "package.json");
const current = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const [maj, min, pat] = current.split(".").map(Number);
const next = bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
const tag = `v${next}`;

if (git("tag", "--list", tag)) {
  console.error(`Tag ${tag} already exists. Set desktop/package.json to the latest released version first.`);
  process.exit(1);
}

console.log(`Releasing ${tag} from ${branch} to ${EXPECTED_REPO} (current ${current})`);
if (dryRun) process.exit(0);

execFileSync("npm", ["version", next, "--no-git-tag-version", "--allow-same-version"], { cwd: desktopDir, stdio: "inherit" });
execFileSync("node", [path.join(__dirname, "sync-version.cjs")], { cwd: desktopDir, stdio: "inherit" });

const toAdd = releaseFiles.filter((file) => fs.existsSync(path.join(repoRoot, file)));
git("add", "--", ...toAdd);
git("commit", "-m", tag, "--", ...toAdd);
git("tag", "-a", tag, "-m", `MakeChurchEazy ${tag}`);
execFileSync("git", ["-C", repoRoot, "push", "origin", branch], { stdio: "inherit" });
execFileSync("git", ["-C", repoRoot, "push", "origin", tag], { stdio: "inherit" });
console.log(`Pushed ${tag}. Watch the build: https://github.com/${EXPECTED_REPO}/actions`);
