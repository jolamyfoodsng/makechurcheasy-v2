import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DockSceneRoutingControl from "./DockSceneRoutingControl";
import type { DockSceneRoute } from "../dockSceneRouting";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      let str = typeof defaultValue === "string" ? defaultValue : key;
      const opts = (typeof defaultValue === "object" ? defaultValue : options) || {};
      for (const [k, v] of Object.entries(opts)) {
        str = str.replace(new RegExp(`{{${k}}}`, "g"), String(v));
      }
      return str;
    },
  }),
}));

describe("DockSceneRoutingControl", () => {
  it("renders basic unrouted button when scene routing is disabled", () => {
    const route: DockSceneRoute = {
      enabled: false,
      sceneName: "",
      targets: [],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRoutingControl
        module="bible"
        route={route}
        onRouteChange={vi.fn()}
      />
    );

    expect(html).toContain("dock-btm-toolbar__icon-btn");
    expect(html).not.toContain("dock-btm-toolbar__icon-btn--active");
    expect(html).not.toContain("dock-scene-route-send-btn--routed");
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });

  it("renders active badge with target scene name when scene routing is enabled", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "BRB SCENE",
      targets: [{ sceneName: "BRB SCENE", mode: "inherit" }],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRoutingControl
        module="bible"
        route={route}
        onRouteChange={vi.fn()}
      />
    );

    expect(html).toContain("dock-btm-toolbar__icon-btn--active");
    expect(html).toContain("dock-scene-route-send-btn--routed");
    expect(html).toContain("dock-scene-route-send-btn__route-badge");
    expect(html).toContain("BRB SCENE");
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });

  it("renders multi-target scene count badge when multiple targets are routed", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "LIVESTREAM",
      targets: [
        { sceneName: "LIVESTREAM", mode: "inherit" },
        { sceneName: "BRB SCENE", mode: "inherit" },
      ],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRoutingControl
        module="worship"
        route={route}
        onRouteChange={vi.fn()}
      />
    );

    expect(html).toContain("dock-scene-route-send-btn--routed");
    expect(html).toContain("dock-scene-route-send-btn__route-badge");
    expect(html).toContain("2 outputs");
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });
});
