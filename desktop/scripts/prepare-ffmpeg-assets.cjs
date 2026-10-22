const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "src-tauri", "resources", "ffmpeg");
const cacheRoot = path.join(os.homedir(), ".cache", "makechurcheasy", "ffmpeg");
const ffmpegVersion = "8.0.3";
const releaseTag = "ffmpeg-8.0.3-build4";
const releaseBase = `https://github.com/jolamyfoodsng/makechurcheasy-v2/releases/download/${releaseTag}`;
const licenseUrl = `${releaseBase}/COPYING.LGPLv2.1`;
const licenseSha256 = "246041b6ecf9bc32d718a62c57877c78b5eb397b6467e74ed7ae2626ab189c30";

const targets = {
  arm64: {
    folder: "macos-arm64",
    archive: "ffmpeg-8.0.3-macos-arm64.tar.gz",
    archiveSha256: "48e8b255af75fef75aa6415306fc9f0f5fe1a36cd483f31bdade41680421e51a",
    report: "ffmpeg-8.0.3-macos-arm64.configure.txt",
    reportSha256: "35e03b193478f2d5bca3a1ff0db92afade1dd2d616dc78946ae81907c0337222",
  },
  x64: {
    folder: "macos-x64",
    archive: "ffmpeg-8.0.3-macos-x64.tar.gz",
    archiveSha256: "789555b8f82a9386db0c63fc37678f9311bfa4a31f99966ad27de4f1e6ff3a2c",
    report: "ffmpeg-8.0.3-macos-x64.configure.txt",
    reportSha256: "b23147a6f4e7dd65abb8e312722d6dccffeea75c353c2cf78cf72f3369c26c56",
  },
  windows: {
    folder: "windows-x64",
    archive: "ffmpeg-8.0.3-win-x64.zip",
    archiveSha256: "4ca8e1ddb71eaff78d2e0acb13437276d874ef3d7f6bfd03251819489a832663",
    report: "ffmpeg-8.0.3-win-x64.configure.txt",
    reportSha256: "6d0d6e37f261fb2a9ffc5bbd50db13256d6427f248496b34cc1e9be2e1f2ba06",
  },
};

function getTargetPlatform() {
  const value = [
    process.env.MCE_TARGET_OS,
    process.env.MCE_TARGET_TRIPLE,
    process.env.TAURI_ENV_TARGET_TRIPLE,
    process.env.TAURI_ENV_PLATFORM,
  ].filter(Boolean).join(" ").toLowerCase();
  if (value.includes("windows") || value.includes("win32")) return "win32";
  if (value.includes("darwin") || value.includes("macos") || value.includes("apple")) return "darwin";
  if (value.includes("linux")) return "linux";
  return process.platform;
}

function getMacArchitecture() {
  const target = [process.env.MCE_TARGET_TRIPLE, process.env.TAURI_ENV_TARGET_TRIPLE]
    .filter(Boolean).join(" ").toLowerCase();
  if (target.includes("x86_64-apple-darwin")) return "x64";
  if (target.includes("aarch64-apple-darwin")) return "arm64";
  return process.arch === "x64" ? "x64" : "arm64";
}

function isReady(target) {
  const dir = path.join(outputRoot, target.folder);
  const binaryExtension = target.folder.startsWith("windows") ? ".exe" : "";
  const marker = path.join(dir, ".version");
  return fs.existsSync(marker)
    && fs.readFileSync(marker, "utf8").trim() === `${ffmpegVersion}:${releaseTag}`
    && fs.existsSync(path.join(dir, "bin", `ffmpeg${binaryExtension}`))
    && fs.existsSync(path.join(dir, "bin", `ffprobe${binaryExtension}`))
    && fs.existsSync(path.join(dir, "LICENSES", "COPYING.LGPLv2.1"))
    && fs.existsSync(path.join(dir, "BUILDINFO.txt"));
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`FFmpeg download failed (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function downloadVerified(url, destination, expectedSha256, description) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const cachedPath = path.join(cacheRoot, path.basename(new URL(url).pathname));
  if (fs.existsSync(cachedPath) && sha256(cachedPath) === expectedSha256) {
    fs.copyFileSync(cachedPath, destination);
    return;
  }

  await downloadFile(url, destination);
  if (sha256(destination) !== expectedSha256) {
    throw new Error(`The pinned ${description} checksum did not match.`);
  }
  fs.copyFileSync(destination, cachedPath);
}

function resetDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function removeOtherTargets(activeFolder) {
  if (!fs.existsSync(outputRoot)) return;
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== activeFolder) {
      fs.rmSync(path.join(outputRoot, entry.name), { recursive: true, force: true });
    }
  }
}

async function downloadBuildReport(target, tempRoot) {
  const reportPath = path.join(tempRoot, target.report);
  await downloadVerified(
    `${releaseBase}/${target.report}`,
    reportPath,
    target.reportSha256,
    "FFmpeg build report",
  );
  return reportPath;
}

async function downloadLicense(tempRoot) {
  const licensePath = path.join(tempRoot, "COPYING.LGPLv2.1");
  await downloadVerified(licenseUrl, licensePath, licenseSha256, "FFmpeg LGPL license");
  return licensePath;
}

function stageCommonFiles(destination, reportPath, licensePath) {
  const licensesDir = path.join(destination, "LICENSES");
  fs.mkdirSync(licensesDir, { recursive: true });
  fs.copyFileSync(licensePath, path.join(licensesDir, "COPYING.LGPLv2.1"));
  fs.copyFileSync(reportPath, path.join(destination, "BUILDINFO.txt"));
  fs.writeFileSync(path.join(destination, ".version"), `${ffmpegVersion}:${releaseTag}\n`);
  fs.writeFileSync(
    path.join(licensesDir, "FFmpeg-notice.txt"),
    [
      "FFmpeg is bundled as a separate executable and is licensed under LGPL-2.1-or-later.",
      `FFmpeg source: https://ffmpeg.org/releases/ffmpeg-${ffmpegVersion}.tar.xz`,
      "The bundled build configuration and third-party component license summary are in ../BUILDINFO.txt.",
      "No GPL or non-free components are enabled in this build.",
      "",
    ].join("\n"),
  );
}

async function stageMac(architecture) {
  const target = targets[architecture];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mce-ffmpeg-macos-"));
  try {
    const archivePath = path.join(tempRoot, target.archive);
    await downloadVerified(`${releaseBase}/${target.archive}`, archivePath, target.archiveSha256, `macOS ${architecture} FFmpeg`);
    const reportPath = await downloadBuildReport(target, tempRoot);
    const licensePath = await downloadLicense(tempRoot);
    const extracted = path.join(tempRoot, "extracted");
    fs.mkdirSync(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archivePath, "-C", extracted], { stdio: "inherit" });
    const destination = path.join(outputRoot, target.folder);
    resetDirectory(destination);
    const binDir = path.join(destination, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ["ffmpeg", "ffprobe"]) {
      fs.copyFileSync(path.join(extracted, name), path.join(binDir, name));
      fs.chmodSync(path.join(binDir, name), 0o755);
    }
    stageCommonFiles(destination, reportPath, licensePath);
    console.log(`[prepare-ffmpeg-assets] Staged LGPL FFmpeg ${ffmpegVersion} for macOS ${architecture}.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function stageWindows() {
  const target = targets.windows;
  removeOtherTargets(target.folder);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mce-ffmpeg-windows-"));
  try {
    const archivePath = path.join(tempRoot, target.archive);
    await downloadVerified(`${releaseBase}/${target.archive}`, archivePath, target.archiveSha256, "Windows x64 FFmpeg");
    const reportPath = await downloadBuildReport(target, tempRoot);
    const licensePath = await downloadLicense(tempRoot);
    const extracted = path.join(tempRoot, "extracted");
    fs.mkdirSync(extracted, { recursive: true });
    const archiveLiteral = archivePath.replace(/'/g, "''");
    const destinationLiteral = extracted.replace(/'/g, "''");
    execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${destinationLiteral}' -Force`,
    ], { stdio: "inherit" });
    const destination = path.join(outputRoot, target.folder);
    resetDirectory(destination);
    const binDir = path.join(destination, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      const binary = path.join(extracted, name);
      if (!fs.existsSync(binary)) throw new Error(`The Windows FFmpeg package is missing ${name}.`);
      fs.copyFileSync(binary, path.join(binDir, name));
    }
    stageCommonFiles(destination, reportPath, licensePath);
    console.log(`[prepare-ffmpeg-assets] Staged LGPL FFmpeg ${ffmpegVersion} for Windows x64.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const platform = getTargetPlatform();
  if (platform === "darwin") {
    const architecture = getMacArchitecture();
    const target = targets[architecture];
    removeOtherTargets(target.folder);
    if (isReady(target)) {
      console.log(`[prepare-ffmpeg-assets] Pinned FFmpeg runtime already staged for macOS ${architecture}.`);
      return;
    }
    await stageMac(architecture);
    return;
  }
  if (platform === "win32") {
    removeOtherTargets(targets.windows.folder);
    if (isReady(targets.windows)) {
      console.log("[prepare-ffmpeg-assets] Pinned FFmpeg runtime already staged for Windows x64.");
      return;
    }
    await stageWindows();
    return;
  }
  console.log(`[prepare-ffmpeg-assets] No bundled FFmpeg runtime is configured for ${platform}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
