/**
 * HighlightedVerseText.tsx — verse text in the Dock list with its highlighted words in colour,
 * the same colours the screen will show (see verseHighlight.ts).
 */
import { highlightColorHex, segmentHighlights, type VerseHighlight } from "./verseHighlight";

interface Props {
  text: string;
  highlights: VerseHighlight[];
}

export default function HighlightedVerseText({ text, highlights }: Props) {
  if (highlights.length === 0) return <>{text}</>;
  return (
    <>
      {segmentHighlights(text, highlights).map((segment, index) => {
        if (!segment.color) return <span key={index}>{segment.text}</span>;
        const hex = highlightColorHex(segment.color);
        return (
          <mark
            key={index}
            className="dock-bible-hl"
            style={hex ? { color: hex, boxShadow: `inset 0 -2px 0 ${hex}` } : undefined}
          >
            {segment.text}
          </mark>
        );
      })}
    </>
  );
}
