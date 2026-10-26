import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DockSceneRouteSendControl from "./DockSceneRouteSendControl";
import type { DockSceneRoute } from "../dockSceneRouting";

describe("DockSceneRouteSendControl", () => {
  it("renders a standard button when scene routing is disabled", () => {
    const route: DockSceneRoute = {
      enabled: false,
      sceneName: "",
      targets: [],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRouteSendControl
        route={route}
        onRouteChange={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("Send to OBS");
    expect(html).not.toContain("dock-scene-route-send-btn--routed");
    expect(html).not.toContain("dock-scene-route-send-btn__route-badge");
  });

  it("renders the routed indicator and target scene badge when scene routing is active", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "BRB SCENE",
      targets: [{ sceneName: "BRB SCENE", mode: "inherit" }],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRouteSendControl
        route={route}
        onRouteChange={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("Send to OBS");
    expect(html).toContain("dock-scene-route-send-btn--routed");
    expect(html).toContain("dock-scene-route-send-btn__route-badge");
    expect(html).toContain("BRB SCENE");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("handles multiple target scenes in the summary badge", () => {
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
      <DockSceneRouteSendControl
        route={route}
        onRouteChange={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("2 outputs");
    expect(html).toContain('title="LIVESTREAM, BRB SCENE"');
    expect(html).toContain("dock-scene-route-send-btn--routed");
  });
});
