import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DockSceneRouteConfirmDialog from "./DockSceneRouteConfirmDialog";
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

describe("DockSceneRouteConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "BRB SCENE",
      targets: [{ sceneName: "BRB SCENE", mode: "inherit" }],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRouteConfirmDialog
        open={false}
        route={route}
        itemLabel="scripture"
        onConfirmRouted={vi.fn()}
        onSendToMceAlone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(html).toBe("");
  });

  it("renders single-target scene confirmation when open is true", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "BRB SCENE",
      targets: [{ sceneName: "BRB SCENE", mode: "inherit" }],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRouteConfirmDialog
        open={true}
        route={route}
        itemLabel="scripture"
        onConfirmRouted={vi.fn()}
        onSendToMceAlone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Every output it will reach, so the operator knows Output is on before sending.
    expect(html).toContain("Send to these outputs?");
    expect(html).toContain("Your scripture goes to:");
    expect(html).toContain("BRB SCENE");
    expect(html).toContain("MCE Presentation");
    expect(html).toContain("Send to 2 outputs");
    expect(html).toContain("Presentation only");
    expect(html).toContain("Cancel");
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });

  it("renders multi-target scene confirmation with all target scenes listed", () => {
    const route: DockSceneRoute = {
      enabled: true,
      sceneName: "BRB SCENE",
      targets: [
        { sceneName: "BRB SCENE", mode: "inherit" },
        { sceneName: "OVERFLOW ROOM", mode: "fullscreen" },
      ],
      syncPresentation: true,
    };

    const html = renderToStaticMarkup(
      <DockSceneRouteConfirmDialog
        open={true}
        route={route}
        itemLabel="worship slide"
        onConfirmRouted={vi.fn()}
        onSendToMceAlone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(html).toContain("Send to these outputs?");
    expect(html).toContain("Send to 3 outputs");
    expect(html).toContain("BRB SCENE");
    expect(html).toContain("OVERFLOW ROOM");
    expect(html).toContain("Full screen");
    expect(html).toContain("Presentation only");
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });
});
