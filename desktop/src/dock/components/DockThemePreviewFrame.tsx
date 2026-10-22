/**
 * DockThemePreviewFrame.tsx — a small live picture of a theme (lower third or ticker), used inside the
 * theme dropdown so a theme can be looked at without choosing it or closing the list.
 * The page is drawn at 1280x720 and scaled down, so it looks the way it will on the screen.
 */
import "./DockSearchableSelect.css";

const PAGE_W = 1280;
const PAGE_H = 720;
/** Width of the picture in the dropdown, in pixels. */
export const PREVIEW_WIDTH = 200;

interface Props {
  html: string;
  /** The iframe `sandbox` value: what the theme's own page is allowed to do. */
  sandbox: string;
  title: string;
  /** Behind the theme, like the stage it will appear over. */
  backdrop?: string;
}

export default function DockThemePreviewFrame({ html, sandbox, title, backdrop = "#1c2230" }: Props) {
  const scale = PREVIEW_WIDTH / PAGE_W;
  return (
    <div className="dss__frame" style={{ width: PREVIEW_WIDTH, height: Math.round(PAGE_H * scale), background: backdrop }}>
      {html ? (
        <iframe
          title={title}
          srcDoc={html}
          sandbox={sandbox}
          tabIndex={-1}
          // colorScheme "light": a page without its own scheme next to a dark Dock page would get an opaque white background.
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, colorScheme: "light" }}
        />
      ) : (
        <span className="dss__frame-empty">No preview</span>
      )}
    </div>
  );
}
