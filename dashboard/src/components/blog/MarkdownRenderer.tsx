"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Inline token types
type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

function parseInline(text: string): React.ReactNode[] {
  // Regex to match bold, italic, code, links
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={index} className="italic text-slate-200">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[0.88em] text-indigo-300 border border-slate-700/60"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      const isExternal = url.startsWith("http");
      if (isExternal) {
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-300 hover:decoration-indigo-300 transition-colors"
          >
            {label}
          </a>
        );
      }
      return (
        <Link
          key={index}
          href={url}
          className="text-indigo-400 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-300 hover:decoration-indigo-300 transition-colors"
        >
          {label}
        </Link>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-6 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 font-mono text-sm shadow-xl">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800/80 text-xs text-slate-400">
        <span className="font-semibold uppercase tracking-wider text-slate-300">{language || "Code"}</span>
        <button
          onClick={handleCopy}
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          aria-label="Copy code snippet"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-slate-200 leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1;
}

function isTableSeparator(line: string): boolean {
  return isTableRow(line) && /^\|(\s*:?-{3,}:?\s*\|)+$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  const blocks = useMemo(() => {
    const rawLines = content.split("\n");
    const parsedBlocks: React.ReactNode[] = [];

    let i = 0;
    while (i < rawLines.length) {
      const line = rawLines[i];

      // Code blocks (```)
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
          codeLines.push(rawLines[i]);
          i++;
        }
        i++; // skip closing ```
        parsedBlocks.push(<CodeBlock key={`code-${i}`} language={lang} code={codeLines.join("\n")} />);
        continue;
      }

      // Empty line
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Headings
      if (line.startsWith("# ")) {
        parsedBlocks.push(
          <h1
            key={`h1-${i}`}
            className="mt-10 mb-5 text-3xl md:text-4xl font-serif font-bold tracking-tight text-slate-100 leading-tight"
          >
            {parseInline(line.slice(2))}
          </h1>
        );
        i++;
        continue;
      }
      if (line.startsWith("## ")) {
        parsedBlocks.push(
          <h2
            key={`h2-${i}`}
            className="mt-9 mb-4 text-2xl md:text-3xl font-serif font-semibold tracking-tight text-slate-100 leading-snug"
          >
            {parseInline(line.slice(3))}
          </h2>
        );
        i++;
        continue;
      }
      if (line.startsWith("### ")) {
        parsedBlocks.push(
          <h3
            key={`h3-${i}`}
            className="mt-7 mb-3 text-xl md:text-2xl font-serif font-medium tracking-tight text-slate-200 leading-snug"
          >
            {parseInline(line.slice(4))}
          </h3>
        );
        i++;
        continue;
      }

      // Blockquotes (> ...)
      if (line.startsWith(">")) {
        const quoteLines: string[] = [];
        while (i < rawLines.length && rawLines[i].startsWith(">")) {
          quoteLines.push(rawLines[i].replace(/^>\s?/, ""));
          i++;
        }
        parsedBlocks.push(
          <blockquote
            key={`quote-${i}`}
            className="my-7 border-l-4 border-indigo-500 pl-5 py-1 italic font-serif text-lg md:text-xl text-slate-300 leading-relaxed bg-slate-900/30 rounded-r-lg"
          >
            {quoteLines.map((ql, qIdx) => (
              <p key={qIdx} className={qIdx > 0 ? "mt-2" : ""}>
                {parseInline(ql)}
              </p>
            ))}
          </blockquote>
        );
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        parsedBlocks.push(<hr key={`hr-${i}`} className="my-10 border-slate-800" />);
        i++;
        continue;
      }

      // Markdown image ![alt](url)
      const imageMatch = line.trim().match(/^!\[(.*?)\]\((.*?)\)$/);
      if (imageMatch) {
        const [, alt, src] = imageMatch;
        parsedBlocks.push(
          <figure key={`img-${i}`} className="my-8">
            <img
              src={src}
              alt={alt}
              className="w-full rounded-2xl border border-slate-800 shadow-xl object-cover max-h-[500px]"
              loading="lazy"
            />
            {alt && (
              <figcaption className="mt-2.5 text-center text-xs text-slate-400 font-sans tracking-wide">
                {alt}
              </figcaption>
            )}
          </figure>
        );
        i++;
        continue;
      }

      // Tables (| a | b |, followed by a | --- | --- | separator row)
      if (isTableRow(line) && i + 1 < rawLines.length && isTableSeparator(rawLines[i + 1])) {
        const header = splitTableRow(line);
        const rows: string[][] = [];
        i += 2;
        while (i < rawLines.length && isTableRow(rawLines[i])) {
          rows.push(splitTableRow(rawLines[i]));
          i++;
        }
        parsedBlocks.push(
          <div key={`table-${i}`} className="my-8 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[34rem] border-collapse text-left font-sans text-sm md:text-base">
              <thead className="bg-slate-900/70 text-slate-100">
                <tr>
                  {header.map((cell, idx) => (
                    <th key={idx} scope="col" className="px-4 py-3 font-semibold border-b border-slate-800 align-bottom">
                      {parseInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-slate-800/70 last:border-b-0">
                    {row.map((cell, cIdx) =>
                      cIdx === 0 ? (
                        <th key={cIdx} scope="row" className="px-4 py-3 font-medium text-slate-100 align-top">
                          {parseInline(cell)}
                        </th>
                      ) : (
                        <td key={cIdx} className="px-4 py-3 align-top leading-relaxed">
                          {parseInline(cell)}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // Unordered list items (- or *)
      if (/^[-*]\s+/.test(line.trim())) {
        const listItems: string[] = [];
        while (i < rawLines.length && /^[-*]\s+/.test(rawLines[i].trim())) {
          listItems.push(rawLines[i].trim().replace(/^[-*]\s+/, ""));
          i++;
        }
        parsedBlocks.push(
          <ul key={`ul-${i}`} className="my-5 list-disc pl-6 space-y-2 text-slate-300 leading-relaxed font-sans text-base md:text-lg">
            {listItems.map((item, idx) => (
              <li key={idx} className="pl-1">
                {parseInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered list items (1. 2.)
      if (/^\d+\.\s+/.test(line.trim())) {
        const listItems: string[] = [];
        while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
          listItems.push(rawLines[i].trim().replace(/^\d+\.\s+/, ""));
          i++;
        }
        parsedBlocks.push(
          <ol key={`ol-${i}`} className="my-5 list-decimal pl-6 space-y-2 text-slate-300 leading-relaxed font-sans text-base md:text-lg">
            {listItems.map((item, idx) => (
              <li key={idx} className="pl-1">
                {parseInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Normal paragraph (gather consecutive non-empty lines)
      const pLines: string[] = [];
      while (
        i < rawLines.length &&
        rawLines[i].trim() !== "" &&
        !rawLines[i].startsWith("#") &&
        !rawLines[i].startsWith(">") &&
        !rawLines[i].trim().startsWith("```") &&
        !/^[-*]\s+/.test(rawLines[i].trim()) &&
        !/^\d+\.\s+/.test(rawLines[i].trim()) &&
        !isTableRow(rawLines[i]) &&
        !rawLines[i].trim().match(/^!\[(.*?)\]\((.*?)\)$/)
      ) {
        pLines.push(rawLines[i]);
        i++;
      }

      if (pLines.length > 0) {
        parsedBlocks.push(
          <p
            key={`p-${i}`}
            className="my-5 text-base md:text-lg text-slate-300 leading-[1.8] font-sans font-normal tracking-[-0.01em]"
          >
            {parseInline(pLines.join(" "))}
          </p>
        );
      } else {
        // Preserve unsupported Markdown lines and always advance the parser.
        parsedBlocks.push(<p key={`text-${i}`}>{parseInline(rawLines[i])}</p>);
        i++;
      }
    }

    return parsedBlocks;
  }, [content]);

  return <div className={`medium-article-body space-y-1 ${className}`}>{blocks}</div>;
}
