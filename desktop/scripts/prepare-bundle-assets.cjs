const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const projectRoot = path.resolve(__dirname, "..");
const targetRoot = path.join(projectRoot, "src-tauri", "target");
const windowsRuntimeOutputDir = path.join(
  projectRoot,
  "src-tauri",
  "resources",
  "windows-runtime"
);
const appIconsSrcDir = path.join(projectRoot, "public", "app_icons");
const appIconsDestDir = path.join(projectRoot, "src-tauri", "resources", "app_icons");
const movePluginVersion = process.env.MCE_MOVE_PLUGIN_VERSION || "3.2.1";
const movePluginOutputDir = path.join(
  projectRoot,
  "src-tauri",
  "resources",
  "obs-move-transition"
);
const llmDir = path.join(projectRoot, "src-tauri", "resources", "models", "llm");
const qwenFileName = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const qwenModelPath = path.join(llmDir, qwenFileName);
const qwenMinBytes = 900 * 1024 * 1024;
const runtimeDllPattern = /^(ggml.*|llama)\.dll$/i;
const defaultDownloadTimeoutMs = Number.parseInt(
  process.env.OBS_BUNDLE_DOWNLOAD_TIMEOUT_MS || "1200000",
  10
);
const defaultDownloadAttempts = Number.parseInt(
  process.env.OBS_BUNDLE_DOWNLOAD_ATTEMPTS || "3",
  10
);
const defaultQwenModelUrl =
  "https://huggingface.co/jc-builds/Qwen2.5-1.5B-Instruct-Q4_K_M-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf?download=true";
const fallbackQwenModelUrls = [
  defaultQwenModelUrl,
  `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/${qwenFileName}?download=true`,
];

const movePluginUrls = {
  darwin: `https://github.com/exeldro/obs-move-transition/releases/download/${movePluginVersion}/move-transition-${movePluginVersion}-macos-universal.pkg`,
  win32: `https://github.com/exeldro/obs-move-transition/releases/download/${movePluginVersion}/move-transition-${movePluginVersion}-windows-programdata.zip`,
};

function getBundlePlatform() {
  const target = [
    process.env.MCE_TARGET_OS,
    process.env.TAURI_ENV_TARGET_TRIPLE,
    process.env.TAURI_ENV_PLATFORM,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (target.includes("windows") || target.includes("win32")) return "win32";
  if (target.includes("darwin") || target.includes("macos") || target.includes("apple")) {
    return "darwin";
  }
  return process.platform;
}

function getExistingFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function listRuntimeDlls(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && runtimeDllPattern.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      source: path.join(dir, entry.name),
      mtimeMs: fs.statSync(path.join(dir, entry.name)).mtimeMs,
    }));
}

function findBestWindowsRuntimeSourceDir() {
  const releaseCandidates = [path.join(targetRoot, "release")];
  const debugCandidates = [path.join(targetRoot, "debug")];

  if (fs.existsSync(targetRoot)) {
    for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      releaseCandidates.push(path.join(targetRoot, entry.name, "release"));
      debugCandidates.push(path.join(targetRoot, entry.name, "debug"));
    }
  }

  const candidates = [...releaseCandidates, ...debugCandidates];
  let best = null;

  for (const candidate of candidates) {
    const dlls = listRuntimeDlls(candidate);
    if (dlls.length === 0) {
      continue;
    }

    const newestMtime = Math.max(...dlls.map((dll) => dll.mtimeMs));
    const preference = candidate.includes(`${path.sep}release`) ? 2 : 1;

    if (
      !best ||
      preference > best.preference ||
      (preference === best.preference && newestMtime > best.newestMtime)
    ) {
      best = { dir: candidate, dlls, newestMtime, preference };
    }
  }

  return best;
}

async function downloadFile(url, destinationPath) {
  const tempPath = `${destinationPath}.partial`;
  const attempts = Number.isFinite(defaultDownloadAttempts)
    ? Math.max(1, defaultDownloadAttempts)
    : 3;
  const timeoutMs = Number.isFinite(defaultDownloadTimeoutMs)
    ? Math.max(30_000, defaultDownloadTimeoutMs)
    : 1_200_000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(
        new Error(
          `Download exceeded ${Math.round(timeoutMs / 60000)} minute timeout`
        )
      );
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "MakeChurchEasy-BundlePrep/1.0",
        },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          `Download failed with status ${response.status} ${response.statusText}`
        );
      }

      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(tempPath)
      );
      fs.renameSync(tempPath, destinationPath);
      clearTimeout(timeoutId);
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      fs.rmSync(tempPath, { force: true });
      if (attempt === attempts) {
        throw error;
      }

      console.warn(
        `[prepare-bundle-assets] Download attempt ${attempt} failed: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

function findExistingModelCandidate() {
  const candidates = [];

  if (process.env.OBS_QWEN_MODEL_SOURCE) {
    candidates.push(process.env.OBS_QWEN_MODEL_SOURCE);
  }

  if (process.env.LOCAL_LLM_MODEL_SOURCE) {
    candidates.push(process.env.LOCAL_LLM_MODEL_SOURCE);
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  if (userProfile) {
    candidates.push(path.join(userProfile, "Downloads", qwenFileName));
    candidates.push(
      path.join(userProfile, "Documents", "MakeChurchEasy", "models", "llm", qwenFileName)
    );
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (resolved === qwenModelPath) continue;
    const size = getExistingFileSize(resolved);
    if (size >= qwenMinBytes) {
      return { path: resolved, size };
    }
  }

  return null;
}

async function ensureQwenModel() {
  fs.mkdirSync(llmDir, { recursive: true });

  const existingSize = getExistingFileSize(qwenModelPath);
  if (existingSize >= qwenMinBytes) {
    console.log(
      `[prepare-bundle-assets] Qwen model already present (${Math.round(
        existingSize / (1024 * 1024)
      )} MiB).`
    );
    return;
  }

  const existingCandidate = findExistingModelCandidate();
  if (existingCandidate) {
    fs.copyFileSync(existingCandidate.path, qwenModelPath);
    console.log(
      `[prepare-bundle-assets] Copied Qwen model from ${existingCandidate.path} (${Math.round(
        existingCandidate.size / (1024 * 1024)
      )} MiB).`
    );
    return;
  }

  if (existingSize > 0) {
    fs.rmSync(qwenModelPath, { force: true });
  }

  const preferredUrl = process.env.OBS_QWEN_MODEL_URL || process.env.LOCAL_LLM_MODEL_URL;
  const urls = preferredUrl
    ? [preferredUrl, ...fallbackQwenModelUrls.filter((url) => url !== preferredUrl)]
    : fallbackQwenModelUrls;

  let lastError = null;
  for (const qwenModelUrl of urls) {
    try {
      console.log(
        `[prepare-bundle-assets] Downloading Qwen model to ${qwenModelPath} from ${qwenModelUrl}`
      );
      await downloadFile(qwenModelUrl, qwenModelPath);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      console.warn(
        `[prepare-bundle-assets] Download source failed: ${qwenModelUrl} (${error.message})`
      );
    }
  }

  if (lastError) {
    throw new Error(
      [
        "Unable to obtain the bundled Qwen GGUF model.",
        "Checked local cache paths and attempted all configured download URLs.",
        "Provide OBS_QWEN_MODEL_SOURCE or LOCAL_LLM_MODEL_SOURCE, or warm the GitHub Actions cache.",
        `Last error: ${lastError.message}`,
      ].join(" ")
    );
  }

  const downloadedSize = getExistingFileSize(qwenModelPath);
  if (downloadedSize < qwenMinBytes) {
    throw new Error(
      `[prepare-bundle-assets] Downloaded Qwen model is unexpectedly small: ${downloadedSize} bytes`
    );
  }

  console.log(
    `[prepare-bundle-assets] Qwen model ready (${Math.round(
      downloadedSize / (1024 * 1024)
    )} MiB).`
  );
}

function stageWindowsRuntimeDlls() {
  if (process.platform !== "win32") {
    console.log("[prepare-bundle-assets] Skipping Windows runtime staging on non-Windows platform.");
    return;
  }

  fs.mkdirSync(windowsRuntimeOutputDir, { recursive: true });

  for (const entry of fs.readdirSync(windowsRuntimeOutputDir, { withFileTypes: true })) {
    if (entry.isFile() && runtimeDllPattern.test(entry.name)) {
      fs.rmSync(path.join(windowsRuntimeOutputDir, entry.name));
    }
  }

  const source = findBestWindowsRuntimeSourceDir();
  if (!source) {
    console.log(
      `[prepare-bundle-assets] No runtime DLLs were found under ${targetRoot}; continuing without staged runtime DLLs.`
    );
    return;
  }

  const copied = [];
  for (const dll of source.dlls) {
    const to = path.join(windowsRuntimeOutputDir, dll.name);
    fs.copyFileSync(dll.source, to);
    copied.push(dll.name);
  }

  if (copied.length === 0) {
    console.log(
      `[prepare-bundle-assets] No runtime DLLs were found in ${source.dir}; continuing without staged runtime DLLs.`
    );
    return;
  }

  console.log(
    `[prepare-bundle-assets] Staged ${copied.length} runtime DLL(s) from ${source.dir}: ${copied.join(", ")}`
  );
}

function copyAppIcons() {
  if (!fs.existsSync(appIconsSrcDir)) {
    console.log("[prepare-bundle-assets] No app_icons source directory found; skipping.");
    return;
  }

  fs.mkdirSync(appIconsDestDir, { recursive: true });

  const files = fs.readdirSync(appIconsSrcDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (files.length === 0) {
    console.log("[prepare-bundle-assets] No icon files found in app_icons; skipping.");
    return;
  }

  for (const file of files) {
    fs.copyFileSync(path.join(appIconsSrcDir, file), path.join(appIconsDestDir, file));
  }

  console.log(
    `[prepare-bundle-assets] Copied ${files.length} app icon(s) to resources/app_icons: ${files.join(", ")}`
  );
}

function copyDirectory(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, destination);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, destination);
    }
  }
}

function readMovePluginMarker(markerPath) {
  try {
    return fs.readFileSync(markerPath, "utf8").trim() === movePluginVersion;
  } catch {
    return false;
  }
}

function movePluginAlreadyStaged(platform) {
  const platformDir = path.join(movePluginOutputDir, platform);
  const expectedPath = platform === "darwin"
    ? path.join(platformDir, "move-transition.plugin")
    : path.join(platformDir, "move-transition", "bin", "64bit", "move-transition.dll");
  return fs.existsSync(expectedPath) && readMovePluginMarker(path.join(platformDir, ".version"));
}

async function ensureMovePluginAssets() {
  const platform = getBundlePlatform();
  if (!Object.hasOwn(movePluginUrls, platform)) {
    console.log(
      `[prepare-bundle-assets] Move Transition is not bundled for ${platform}; desktop builds on macOS and Windows include it.`
    );
    return;
  }

  if (movePluginAlreadyStaged(platform)) {
    console.log(
      `[prepare-bundle-assets] Move Transition ${movePluginVersion} already staged for ${platform}.`
    );
    return;
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mce-move-transition-"));
  const platformDir = path.join(movePluginOutputDir, platform);

  try {
    const archivePath = path.join(
      temporaryRoot,
      platform === "darwin" ? "move-transition.pkg" : "move-transition.zip"
    );
    await downloadFile(movePluginUrls[platform], archivePath);

    fs.rmSync(platformDir, { recursive: true, force: true });
    fs.mkdirSync(platformDir, { recursive: true });

    if (platform === "darwin") {
      const expandedPath = path.join(temporaryRoot, "expanded");
      execFileSync("/usr/sbin/pkgutil", ["--expand-full", archivePath, expandedPath], {
        stdio: "inherit",
      });
      const macPluginRelativePath = path.join(
        "Library",
        "Application Support",
        "obs-studio",
        "plugins",
        "move-transition.plugin"
      );
      const pluginCandidates = [
        path.join(expandedPath, macPluginRelativePath),
        path.join(expandedPath, "move-transition.pkg", "Payload", macPluginRelativePath),
      ];
      const pluginPath = pluginCandidates.find((candidate) => fs.existsSync(candidate));
      if (!pluginPath || !fs.existsSync(pluginPath)) {
        throw new Error("The macOS Move Transition package did not contain the OBS plugin bundle.");
      }
      copyDirectory(pluginPath, path.join(platformDir, "move-transition.plugin"));
    } else {
      const extractedPath = path.join(temporaryRoot, "extracted");
      fs.mkdirSync(extractedPath, { recursive: true });
      const escapedArchive = archivePath.replace(/'/g, "''");
      const escapedDestination = extractedPath.replace(/'/g, "''");
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedArchive}', '${escapedDestination}')`,
        ],
        { stdio: "inherit" }
      );
      const pluginPath = path.join(extractedPath, "move-transition");
      if (!fs.existsSync(pluginPath)) {
        throw new Error("The Windows Move Transition package did not contain the OBS plugin files.");
      }
      copyDirectory(pluginPath, path.join(platformDir, "move-transition"));
    }

    fs.writeFileSync(path.join(platformDir, ".version"), `${movePluginVersion}\n`);
    console.log(
      `[prepare-bundle-assets] Staged Move Transition ${movePluginVersion} for ${platform}.`
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function ensureMceObsBridgeAssets() {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-obs-bridge.cjs")], {
    stdio: "inherit",
  });
}

function ensureFfmpegAssets() {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "prepare-ffmpeg-assets.cjs")], {
    stdio: "inherit",
  });
}

async function main() {
  stageWindowsRuntimeDlls();
  copyAppIcons();
  ensureFfmpegAssets();
  await ensureMovePluginAssets();
  ensureMceObsBridgeAssets();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
