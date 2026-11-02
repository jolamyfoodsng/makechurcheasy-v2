import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { DEFAULT_PLAN_CONFIG, FEATURE_LABELS, deriveFeatureRequiredPlan } from "./src/services/planConfigTypes";

const host = process.env.TAURI_DEV_HOST;

const root: string = import.meta.dirname ?? ".";
const PUBLIC_DIR = resolve(root, "public");

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const APP_VERSION: string = pkg.version;

// OBS caches browser-source documents aggressively. Keep the URL token tied to
// the actual bundled overlay HTML so a changed renderer gets a new document,
// while verse packets can continue using the stable in-place event path.
const OVERLAY_HTML_FILES = [
  "mce-bible-overlay.html",
  "mce-worship-overlay.html",
  "mce-note.html",
  "mce-media-overlay.html",
  "lower-third-overlay.html",
  "pre-service-countdown.html",
  "countdown-overlay.html",
  "countdown-bg-overlay.html",
  "live-tool-overlay.html",
  "time-overlay.html",
  "mce-template-overlay.html",
  "bible-overlay-bg.html",
];

const OVERLAY_HTML_FINGERPRINT = createHash("sha256")
  .update(
    OVERLAY_HTML_FILES
      .map((fileName) => `${fileName}\n${readFileSync(resolve(PUBLIC_DIR, fileName), "utf-8")}`)
      .join("\n"),
  )
  .digest("hex")
  .slice(0, 12);

const OVERLAY_HTML_VERSION = `${APP_VERSION}-${OVERLAY_HTML_FINGERPRINT}`;

// Auth session file — written by desktop app, read by OBS dock.
// In dev the overlay server doesn't have the Rust auth endpoints yet,
// so this Vite plugin handles them directly.
const SESSION_FILE = resolve(root, "makechurcheasy-session.json");

// The overlay server (Rust) reads from ~/Documents/MakeChurchEasy/makechurcheasy-session.json.
// On logout we must delete from BOTH locations so the dock can't still see a stale session.
const OVERLAY_SESSION_FILE = resolve(homedir(), "Documents", "MakeChurchEasy", "makechurcheasy-session.json");
const ALLOWED_APP_DOCUMENTS = new Set([
  "/",
  "/index.html",
]);

// ── Entitlement Server Config ─────────────────────────────────────────────────
// Default plan entitlements — derived from src/services/planConfigTypes.ts (single source of truth).
// The local server uses these as the source of truth for entitlement checks.
const DEFAULT_ENTITLEMENTS: Record<string, Record<string, number | boolean>> = {};
for (const [tier, config] of Object.entries(DEFAULT_PLAN_CONFIG.plans)) {
  DEFAULT_ENTITLEMENTS[tier] = config.entitlements as unknown as Record<string, number | boolean>;
}

// Minimum plan tier required for each feature — derived at runtime, NOT hardcoded.
const FEATURE_REQUIRED_PLAN: Record<string, string> = deriveFeatureRequiredPlan(DEFAULT_PLAN_CONFIG);
const PURCHASED_PLAN_HIERARCHY = ["free", "basic", "growth"] as const;

function findRequiredPlan(feature: string, currentCount: number = 0): string {
  for (const tier of PURCHASED_PLAN_HIERARCHY) {
    const value = DEFAULT_ENTITLEMENTS[tier]?.[feature];
    if (typeof value === "boolean" && value) return tier;
    if (typeof value === "number" && (value === -1 || currentCount < value)) return tier;
  }
  return FEATURE_REQUIRED_PLAN[feature] || "growth";
}

function readStoredOverlaySession(): unknown | null {
  for (const sessionFile of [SESSION_FILE, OVERLAY_SESSION_FILE]) {
    if (!existsSync(sessionFile)) continue;

    try {
      const data = JSON.parse(readFileSync(sessionFile, "utf-8"));
      const hasUser = Boolean(data?.user && typeof data.user.id === "string" && data.user.id.trim());
      const hasDevice = typeof data?.deviceId === "string" && data.deviceId.trim();
      const isLive = typeof data?.expiresAt === "number" && Date.now() < data.expiresAt;
      if (hasUser && hasDevice && isLive) return data;
    } catch {
      // Try the other session store. A malformed or expired file must not
      // make a standalone Dock document reachable.
    }
  }

  return null;
}

function hasStoredOverlaySession(): boolean {
  return readStoredOverlaySession() !== null;
}

function resolveStandaloneHtmlCandidate(pathname: string): string | null {
  if (ALLOWED_APP_DOCUMENTS.has(pathname)) {
    return null;
  }

  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) {
    return null;
  }

  const candidates = relativePath.endsWith(".html")
    ? [
      resolve(PUBLIC_DIR, relativePath),
      resolve(root, relativePath),
    ]
    : [
      resolve(PUBLIC_DIR, `${relativePath}.html`),
      resolve(root, `${relativePath}.html`),
    ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function shouldBlockStandaloneHtmlRequest(url: string | undefined, acceptHeader: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/@")) {
    return false;
  }

  const wantsHtml = pathname.endsWith(".html") || (acceptHeader?.includes("text/html") ?? false);
  if (!wantsHtml) {
    return false;
  }

  return resolveStandaloneHtmlCandidate(pathname) !== null;
}

function renderBlockedHtmlPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Authentication Required</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, "Open Sans", system-ui, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      .panel {
        width: min(420px, 100%);
        padding: 28px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.92);
        box-shadow: 0 28px 80px rgba(2, 6, 23, 0.45);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.4rem;
        line-height: 1.2;
      }
      p {
        margin: 0 0 16px;
        color: #cbd5e1;
        line-height: 1.5;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 11px 16px;
        font: inherit;
        font-weight: 600;
        color: #eff6ff;
        background: #2563eb;
        cursor: pointer;
      }
      .hint {
        margin-top: 14px;
        margin-bottom: 0;
        font-size: 0.92rem;
        color: #94a3b8;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>Authentication Required</h1>
      <p>Please open the MakeChurchEazy desktop app and log in first.</p>
      <button type="button" onclick="window.location.reload()">Refresh</button>
      <p class="hint">This page will start working again after the desktop app restores the local session.</p>
    </main>
  </body>
</html>`;
}

/**
 * Dev only: the overlay fingerprint above is computed once when Vite starts.
 * When an OBS overlay HTML file changes, restart the dev server so the Dock
 * gets a new `v=` token and OBS loads the new overlay document instead of
 * keeping the old one in memory.
 */
function overlayHtmlRestartPlugin(): Plugin {
  const watched = new Set(OVERLAY_HTML_FILES.map((fileName) => resolve(PUBLIC_DIR, fileName)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    name: "mce-overlay-html-restart",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(Array.from(watched));
      server.watcher.on("change", (file) => {
        if (!watched.has(resolve(file))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          server.config.logger.info(`[overlay] ${file} changed, restarting so OBS reloads the overlay`);
          void server.restart();
        }, 300);
      });
    },
  };
}

function standaloneHtmlGuardPlugin(): Plugin {
  return {
    name: "standalone-html-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const method = req.method?.toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          next();
          return;
        }

        if (!shouldBlockStandaloneHtmlRequest(req.url, req.headers.accept)) {
          next();
          return;
        }

        if (hasStoredOverlaySession()) {
          next();
          return;
        }

        res.statusCode = 401;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.end(renderBlockedHtmlPage());
      });
    },
  };
}

/**
 * Dev server stand-in for the overlay server's `/api/vmix` relay (src-tauri/src/vmix.rs),
 * so the Dock can drive vMix when opened from Vite in a browser. vMix refuses
 * requests made by web pages, so the page cannot ask it directly.
 */
function vmixRelayPlugin(): Plugin {
  return {
    name: "vmix-relay",
    configureServer(server) {
      server.middlewares.use("/api/vmix", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const params = new URL(req.url ?? "", "http://localhost").searchParams;
        const host = params.get("host") ?? "";
        const port = Number(params.get("port"));
        const query = params.get("q") ?? "";
        if (!/^[A-Za-z0-9._-]+$/.test(host) || !port || !(query === "" || query.startsWith("/?"))) {
          res.end(JSON.stringify({ error: "unreachable: invalid vMix request" }));
          return;
        }
        try {
          const reply = await fetch(`http://${host}:${port}/api${query}`, { signal: AbortSignal.timeout(2500) });
          res.end(JSON.stringify({ status: reply.status, body: await reply.text() }));
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          res.end(JSON.stringify({ error: `${timedOut ? "timeout" : "unreachable"}: ${String(error)}` }));
        }
      });
    },
  };
}

function authSessionPlugin(): Plugin {
  return {
    name: "auth-session",
    configureServer(server) {
      server.middlewares.use("/uploads/dock-branding.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end("{}");
      });

      server.middlewares.use("/uploads/dock-speakers.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end("[]");
      });

      server.middlewares.use("/api/auth/status", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        const data = readStoredOverlaySession();
        res.end(data
          ? JSON.stringify({ ...data as Record<string, unknown>, authenticated: true })
          : '{"authenticated":false,"deviceId":null}');
      });

      server.middlewares.use("/api/auth/session", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.end("");
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            const trimmed = body.trim();
            // Empty body OR {"clear":true} = logout
            if (trimmed && !trimmed.includes('"clear"')) {
              writeFileSync(SESSION_FILE, body, "utf-8");
            } else {
              // Empty body = logout: delete from both Vite and overlay server paths
              if (existsSync(SESSION_FILE)) {
                unlinkSync(SESSION_FILE);
              }
              if (existsSync(OVERLAY_SESSION_FILE)) {
                unlinkSync(OVERLAY_SESSION_FILE);
              }
            }
            res.end('{"ok":true}');
          });
          return;
        }

        res.statusCode = 405;
        res.end('{"error":"Method not allowed"}');
      });
    },
  };
}

// ── Entitlement Server Plugin ─────────────────────────────────────────────────
// Local HTTP server that verifies every feature-gated action.
// UI actions POST to /api/entitlement/check → { allowed, reason, limit }.
// Works offline since plan config is embedded in the middleware.
function entitlementServerPlugin(): Plugin {
  return {
    name: "entitlement-server",
    configureServer(server) {
      // POST /api/entitlement/check — verify a single feature action
      server.middlewares.use("/api/entitlement/check", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.end("");
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk; });
        req.on("end", () => {
          try {
            const { feature, plan, currentCount = 0 } = JSON.parse(body);

            if (!feature || typeof feature !== "string") {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "feature is required" }));
              return;
            }

            const planKey = (plan || "free").toLowerCase();
            const entitlements = DEFAULT_ENTITLEMENTS[planKey] || DEFAULT_ENTITLEMENTS.free;
            const limit = entitlements[feature as keyof typeof entitlements];
            const label = FEATURE_LABELS[feature] || feature;
            const requiredPlan = findRequiredPlan(feature, currentCount);

            // Boolean features (multiview, tickers, massImport, etc.)
            if (typeof limit === "boolean") {
              res.end(JSON.stringify({
                allowed: limit,
                limit: limit ? -1 : 0,
                reason: limit ? undefined : `${label} requires ${capitalize(requiredPlan)} plan or higher.`,
                requiredPlan: limit ? undefined : requiredPlan,
              }));
              return;
            }

            // Numeric resource features (songs, images, videos, etc.)
            if (typeof limit === "number") {
              const isUnlimited = limit === -1 || limit === Infinity;
              const allowed = isUnlimited || currentCount < limit;
              const remaining = isUnlimited ? -1 : Math.max(0, limit - currentCount);
              res.end(JSON.stringify({
                allowed,
                limit,
                current: currentCount,
                remaining,
                reason: allowed ? undefined : `${label} limit reached (${currentCount}/${limit}). Upgrade to ${capitalize(requiredPlan)} for more.`,
                requiredPlan: allowed ? undefined : requiredPlan,
              }));
              return;
            }

            // Unknown feature
            res.statusCode = 400;
            res.end(JSON.stringify({ error: `Unknown feature: ${feature}` }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      });

      // GET /api/entitlement/config — return full plan config for client-side caching
      server.middlewares.use("/api/entitlement/config", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (req.method === "OPTIONS") {
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.end("");
          return;
        }

        res.end(JSON.stringify({
          plans: DEFAULT_ENTITLEMENTS,
          featureLabels: FEATURE_LABELS,
          requiredPlans: FEATURE_REQUIRED_PLAN,
          updatedAt: new Date().toISOString(),
        }));
      });
    },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [standaloneHtmlGuardPlugin(), overlayHtmlRestartPlugin(), react(), authSessionPlugin(), vmixRelayPlugin(), entitlementServerPlugin()],

  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },

  // Expose version to the app at build time
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __MCE_OVERLAY_HTML_VERSION__: JSON.stringify(OVERLAY_HTML_VERSION),
    // Never compile the speech key into a production bundle, even if it is present
    // in the environment. Release builds get a short-lived token from the API.
    ...(mode === "production"
      ? {
        "import.meta.env.VITE_ASSEMBLYAI_API_KEYS": '""',
        "import.meta.env.VITE_ASSEMBLYAI_API_KEY": '""',
      }
      : {}),
  },

  // Dev: find every dependency at start-up. Without this, opening a lazily loaded
  // screen (e.g. a Dock tab) could make Vite re-bundle dependencies mid-session;
  // pages that are not fully reloaded (the OBS Dock) then end up with two copies
  // of a library such as react-i18next and show raw translation keys.
  optimizeDeps: {
    entries: [
      "index.html",
      "dock.html",
      "lm-dock.html",
      "makechatgpt.html",
      "src/**/*.{ts,tsx}",
      "!src/**/*.test.{ts,tsx}",
      "!src/**/*.d.ts",
    ],
  },

  // Multi-page build: main app + standalone dock + LM dock + floating assistant
  build: {
    // Never ship source maps: they hand out the original TypeScript.
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        dock: resolve(root, "dock.html"),
        "lm-dock": resolve(root, "lm-dock.html"),
        makechatgpt: resolve(root, "makechatgpt.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Development-only LAN access: a second laptop on the same Wi-Fi can
    // open the dev Dock using this computer's LAN address. Production builds
    // do not use Vite's dev server.
    host: host || "0.0.0.0",
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // Proxy /uploads/* and /api/* to the Tauri overlay server so the dock
    // can load synced JSON files (dock-worship-songs.json, etc.) in dev.
    // Set OVERLAY_PORT env var to match the running Tauri app's overlay port
    // (check Tauri console output or `lsof -i -P | grep LISTEN`).
    proxy: {
      "/uploads": {
        target: `http://127.0.0.1:${process.env.OVERLAY_PORT || 45678}`,
        changeOrigin: true,
      },
      "/api": {
        target: `http://127.0.0.1:${process.env.OVERLAY_PORT || 45678}`,
        changeOrigin: true,
      },
    },
  },
}));
