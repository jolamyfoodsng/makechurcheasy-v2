import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./fonts.css";
import "./i18n";
import App from "./App";
import { LayoutStoreProvider } from "./hooks/useLayoutStore";
import { AuthProvider } from "./contexts/AuthContext";
import DesktopBrowserGate from "./components/DesktopBrowserGate";
import { initOverlayUrl } from "./services/overlayUrl";
import { initAuthStore } from "./services/authService";
import { initAnalytics, captureException } from "./services/analytics";
import { migrateStorageKeys } from "./services/storageMigration";
import { startUsageTracking } from "./services/usageTracker";

// Migrate old storage keys before anything else reads them
migrateStorageKeys();

// In the desktop app, window.open() does nothing (Tauri has no new-window
// handler), so announcement buttons, "download the update" fallbacks and other
// external links silently failed. Send web links to the system browser.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : "";
    let absolute = "";
    try {
      absolute = new URL(href, window.location.href).toString();
    } catch {
      absolute = "";
    }
    if (/^(https?:|mailto:|tel:)/i.test(absolute)) {
      void import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(absolute))
        .catch((error) => console.warn("[window.open] Could not open in browser:", error));
      return null;
    }
    return nativeOpen(url as string, target, features);
  }) as typeof window.open;
}

// Detect OS platform (Windows vs macOS) for native typography & metrics
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? navigator.userAgent);
if (typeof document !== "undefined") {
  document.documentElement.dataset.platform = isMac ? "macos" : "windows";
}

// Initialize analytics before anything else
initAnalytics();

// Global error handler — capture uncaught errors
window.addEventListener("error", (event) => {
  captureException(event.error ?? new Error(event.message), {
    page: window.location.hash,
    source: "window.error",
  });
});
window.addEventListener("unhandledrejection", (event) => {
  captureException(event.reason ?? new Error("Unhandled promise rejection"), {
    page: window.location.hash,
    source: "unhandledrejection",
  });
});

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const overlayInitPromise = initOverlayUrl();

function getPublicPresentationSessionId(): string | null {
  const match = window.location.pathname.match(/^\/p\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function renderPresentationOpening(message = "Opening presentation screen...") {
  root.render(
    <React.StrictMode>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#000", color: "var(--text-primary)", fontFamily: "var(--font-body)" }}>
        <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid #1D4ED8", borderTopColor: "transparent", animation: "spin 0.6s linear infinite" }} />
          <span>{message}</span>
        </div>
      </div>
    </React.StrictMode>,
  );
}

async function openPublicPresentationRoute(sessionId: string) {
  renderPresentationOpening();

  try {
    const { getPresentationRemoteAccessInfo } = await import("./services/presentationRemote");
    const info = await getPresentationRemoteAccessInfo(sessionId);
    const candidates = [info.localLink, info.link].filter(Boolean);
    const current = new URL(window.location.href);
    const target = candidates.find((candidate) => {
      try {
        const parsed = new URL(candidate);
        return parsed.origin !== current.origin || parsed.pathname !== current.pathname;
      } catch {
        return false;
      }
    });

    if (target) {
      window.location.replace(target);
      return;
    }

    const params = new URLSearchParams({ sessionId });
    if (info.wsPort > 0) params.set("wsPort", String(info.wsPort));
    window.location.replace(`/presentation.html?${params.toString()}`);
  } catch (error) {
    console.warn("[PresentationRoute] Could not open presentation server:", error);
    const params = new URLSearchParams({ sessionId });
    window.location.replace(`/presentation.html?${params.toString()}`);
  }
}

const appRouter = createHashRouter([
  {
    path: "*",
    element: (
      <DesktopBrowserGate>
        <AuthProvider>
          <LayoutStoreProvider>
            <App />
          </LayoutStoreProvider>
        </AuthProvider>
      </DesktopBrowserGate>
    ),
  },
]);

const publicPresentationSessionId = getPublicPresentationSessionId();

// Await auth store so the session is in memory before any component reads it.
// initAuthStore no longer blocks on network (plan refresh is fire-and-forget),
// so this resolves immediately from local storage.
// Detect /dock immediately to parallelize asset and data fetching
const isDock = window.location.pathname === "/dock" || window.location.pathname === "/dock/";

if (isDock) {
  // 1. Kick off Dock bundle chunk downloads immediately in parallel with hydration
  const dockBundlePromise = Promise.all([
    import("./dock/DockPage"),
    import("./dock/DockAuthGate"),
    import("./dock/dock.css"),
    import("./dock/dock-auth.css"),
  ]);

  // 2. Initialize BroadcastChannel before React renders
  import("./services/dockBridge").then(({ dockClient }) => dockClient.init()).catch(() => {});

  // 3. Hydrate local auth and native dock settings in parallel (all local, zero network wait)
  Promise.all([
    initAuthStore(),
    overlayInitPromise,
    import("./services/localDockSettings").then(({ hydrateNativeDockSettings }) => hydrateNativeDockSettings()).catch(() => {}),
  ]).then(() => {
    dockBundlePromise.then(([{ default: DockPage }, { default: DockAuthGate }]) => {
      root.render(
        <DockAuthGate>
          <DockPage />
        </DockAuthGate>
      );
    });
  });

  // 4. Run background non-critical syncs asynchronously without blocking dock UI
  void (async () => {
    try {
      const { refreshAppAppearance } = await import("./services/appAppearance");
      refreshAppAppearance();
      const { refreshAppThemePreference } = await import("./hooks/useAppTheme");
      refreshAppThemePreference();
    } catch { /* best-effort */ }

    try {
      const { refreshDesktopConfig } = await import("./services/desktopConfig");
      void refreshDesktopConfig();
    } catch { /* best-effort */ }
  })();
} else if (publicPresentationSessionId) {
  void openPublicPresentationRoute(publicPresentationSessionId);
} else {
  // Main Desktop App Bootstrap
  void Promise.all([
    initAuthStore(),
    overlayInitPromise,
    import("./services/localDockSettings").then(({ hydrateNativeDockSettings }) => hydrateNativeDockSettings()).catch(() => {}),
  ]).then(async () => {
    // Synchronously apply appearance & cached theme overrides so first paint is correct
    try {
      const { refreshAppAppearance } = await import("./services/appAppearance");
      refreshAppAppearance();
      const { refreshAppThemePreference } = await import("./hooks/useAppTheme");
      refreshAppThemePreference();
      const { applyThemeConfigOverrides } = await import("./bible/types");
      applyThemeConfigOverrides();
    } catch { /* best-effort */ }

    // Pages opened and buttons clicked, for the admin usage analytics (no typed text or content is sent).
    startUsageTracking("app", { router: appRouter });

    // Mount main app immediately without StrictMode double-rendering
    root.render(
      <RouterProvider router={appRouter} />
    );

    // Asynchronous background syncs (stale-while-revalidate, usage sync, profile sync)
    void (async () => {
      try {
        const { syncChurchProfile, startChurchProfileAutoRefresh } = await import("./services/churchProfileSync");
        void syncChurchProfile();
        // Pick up changes made on the website while the app stays open.
        startChurchProfileAutoRefresh();
      } catch { /* best-effort */ }

      try {
        const { startUsageSync } = await import("./services/usageSync");
        startUsageSync();
      } catch { /* best-effort */ }

      try {
        const { syncPendingTransactions } = await import("./services/credits");
        void syncPendingTransactions();
      } catch { /* best-effort */ }

      try {
        const { refreshDesktopConfig } = await import("./services/desktopConfig");
        const { applyThemeConfigOverrides } = await import("./bible/types");
        await refreshDesktopConfig();
        applyThemeConfigOverrides();

        const refreshDesktopSettings = () => {
          void refreshDesktopConfig().then(() => {
            applyThemeConfigOverrides();
          });
        };

        setInterval(() => {
          if (document.visibilityState !== "visible") return;
          refreshDesktopSettings();
        }, 5 * 60 * 1000);

        window.addEventListener("focus", refreshDesktopSettings);
        window.addEventListener("online", () => {
          refreshDesktopSettings();
          import("./services/credits").then(({ syncPendingTransactions }) => {
            void syncPendingTransactions();
          }).catch(() => { /* best-effort */ });
        });
      } catch { /* best-effort */ }
    })();
  });
}
