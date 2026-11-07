/**
 * UpdateReleaseNotes.tsx — "What's new" for the update dialogs (optional and required).
 *
 * Renders inside ModalDialog's `extra` with the shared ModalPanel, so both update prompts read
 * the same and follow the app's tokens.
 */
import { useMemo, type ReactNode } from "react";
import { getReleaseHighlights, stripReleaseBoilerplate } from "../services/releaseNotesService";
import { ModalPanel } from "./ModalDialog";

function renderPlainNotes(notes: string): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key}>
        {bullets.map((text, index) => <li key={index}>{text}</li>)}
      </ul>,
    );
    bullets = [];
  };
  notes.slice(0, 12_000).split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flush(`list-${index}`);
    if (!trimmed) return;
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    blocks.push(heading ? <h3 key={index}>{heading[1]}</h3> : <p key={index}>{trimmed}</p>);
  });
  flush("list-end");
  return blocks;
}

export default function UpdateReleaseNotes({
  version,
  notes,
  maxItems,
  maxHeight = 220,
  footer,
}: {
  version?: string | null;
  notes?: string | null;
  /** Show only the first few highlights (the required-update dialog keeps it short). */
  maxItems?: number;
  maxHeight?: number;
  footer?: ReactNode;
}) {
  const highlights = useMemo(() => getReleaseHighlights(version ?? undefined, notes ?? undefined), [version, notes]);
  const cleaned = useMemo(() => stripReleaseBoilerplate(notes ?? undefined), [notes]);
  const shown = maxItems ? highlights.slice(0, maxItems) : highlights;

  return (
    <ModalPanel heading="What's new" maxHeight={maxHeight}>
      {shown.length > 0 ? (
        shown.map((highlight) => (
          <div key={highlight.id} className="mce-modal__note">
            {/* One highlight is the whole release: the panel heading already says "What's new". */}
            {shown.length > 1 ? <h3>{highlight.title}</h3> : null}
            {highlight.summary ? <p>{highlight.summary}</p> : null}
            {highlight.points.length > 0 ? (
              <ul>
                {highlight.points.map((point, index) => (
                  <li key={index}>
                    {point.lead ? <strong>{point.lead}: </strong> : null}
                    {point.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))
      ) : cleaned ? (
        renderPlainNotes(cleaned)
      ) : (
        <p>This update includes fixes and improvements.</p>
      )}
      {footer}
    </ModalPanel>
  );
}
