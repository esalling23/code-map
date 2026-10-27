// Previews shown in tabs: a data type's definition, and a called function's code.
import { Fragment, useMemo } from "react";
import { allLines, excerpt } from "../text";
import { CodeBox } from "./CodeBox";
import { StepLink, useMap } from "./context";

/** A data type's definition, with which steps use it. */
export function DataSnippet({ id }: { id: string }) {
  const { doc } = useMap();
  const sym = doc.render.symbols[id];
  const users = doc.render.walkthrough.steps.filter((s) => s.dataUsed.some((d) => d.id === id));
  const shown = useMemo(() => {
    const lines = allLines(sym);
    return lines.length > 80 ? [...lines.slice(0, 80), { line: -1, text: `… ${lines.length - 80} more lines`, gap: true }] : lines;
  }, [sym]);
  return (
    <>
      <div className="snipmeta">
        <strong>{sym.name}</strong>{" "}
        <span className="muted">
          {sym.kind === "class" ? "class" : "type"}
          {users.length ? " · used in steps " : " · selected"}
          {users.map((s, i) => (
            <Fragment key={s.index}>
              {i > 0 && ", "}
              <StepLink step={s.index}>{s.index + 1}</StepLink>
            </Fragment>
          ))}
        </span>
      </div>
      {sym.doc && <p className="snipdoc">{sym.doc}</p>}
      <CodeBox sym={sym} lines={shown} />
    </>
  );
}

/** A called function: its doc, a short excerpt and a link to its step. */
export function CallSnippet({ id }: { id: string }) {
  const { doc } = useMap();
  const sym = doc.render.symbols[id];
  const step = doc.render.walkthrough.steps.find((s) => s.symbolId === id);
  const lines = useMemo(() => excerpt(sym, []), [sym]);
  return (
    <>
      <div className="snipmeta">
        <strong>{sym.name}</strong>
        {sym.repo && (
          <>
            {" "}
            <span className="tag">{sym.repo}</span>
          </>
        )}
        {" · "}
        {step ? <StepLink step={step.index}>{`go to step ${step.index + 1}`}</StepLink> : <span className="muted">not a step on this path</span>}
      </div>
      {sym.doc && <p className="snipdoc">{sym.doc}</p>}
      <CodeBox sym={sym} lines={lines} />
    </>
  );
}
