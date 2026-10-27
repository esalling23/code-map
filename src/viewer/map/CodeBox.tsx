// A block of source lines, highlighted by highlight.js when the page has it.
import { memo, useMemo } from "react";
import type { CodeSymbol } from "../../types";
import { language, type ExcerptLine } from "../text";
import { StepLink } from "./context";
import { PathSpan } from "./Inline";

declare global {
  interface Window {
    hljs?: { highlight(code: string, opts: { language: string; ignoreIllegals: boolean }): { value: string } };
  }
}

function highlight(text: string, lang: string): string | null {
  if (typeof window === "undefined" || !window.hljs || !text) return null;
  try {
    return window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

/** `hits`: line number → the steps its calls lead to. */
export const CodeBox = memo(function CodeBox({ sym, lines, hits, note }: { sym: CodeSymbol; lines: ExcerptLine[]; hits?: Map<number, number[]>; note?: string }) {
  const lang = language(sym.file);
  const html = useMemo(() => lines.map((l) => (l.gap ? null : highlight(l.text, lang))), [lines, lang]);
  return (
    <div className="codebox" data-lang={lang}>
      <div className="codehead">
        <PathSpan file={sym.file} />
        <span>{note ?? `lines ${sym.startLine}–${sym.endLine}`}</span>
      </div>
      <div className="lines">
        {lines.map((l, i) => {
          if (l.gap)
            return (
              <div className="ln gap" key={i}>
                <span className="no"></span>
                <span className="src">{l.text}</span>
              </div>
            );
          const targets = hits?.get(l.line);
          return (
            <div className={targets ? "ln hit" : "ln"} key={i}>
              <span className="no">{l.line}</span>
              {html[i] !== null ? <span className="src" dangerouslySetInnerHTML={{ __html: html[i]! }} /> : <span className="src">{l.text || " "}</span>}
              {targets && (
                <span className="jumps">
                  {targets.map((t) => (
                    <StepLink key={t} step={t} className="badge" title={`Go to step ${t + 1}`}>
                      {`→ ${t + 1}`}
                    </StepLink>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
