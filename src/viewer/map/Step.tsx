// One walkthrough step: its explanation beside tabs with its code, data and calls.
import { Fragment, useMemo, useState, type CSSProperties } from "react";
import type { PathStep } from "../../types";
import { allLines, excerpt } from "../text";
import { CodeBox } from "./CodeBox";
import { AreaLink, StepLink, useCurrentStep, useMap } from "./context";
import { Inline } from "./Inline";
import { CallSnippet, DataSnippet } from "./Snippets";
import { Tabs, type TabDef } from "./Tabs";

/** `data:<id>` or `call:<id>`: a sub-tab a chip or call name opens. */
type OpenKey = string;

function HiddenHelpers({ step }: { step: PathStep }) {
  const { hidden, expand } = useMap();
  const n = hidden.get(step.index)?.length;
  if (!n) return null;
  return (
    <button type="button" className="hiddensteps" onClick={() => expand(step.index)} title="Show them here; the levels control sets which steps are hidden">
      {`${n} helper step${n === 1 ? "" : "s"} hidden`}
    </button>
  );
}

/** The step's text. The step panel shows it too, as `panel`: no data chips, and call names aren't buttons. */
export function StepExplain({ step, panel, onOpen }: { step: PathStep; panel?: boolean; onOpen?: (key: OpenKey) => void }) {
  const { doc } = useMap();
  const walk = doc.render.walkthrough;
  const symbols = doc.render.symbols;
  const sym = symbols[step.symbolId];
  const ctx = walk.context;
  const area = ctx?.areas.find((a) => a.id === ctx.areaOfStep[step.index]);
  const crumbs: number[] = [];
  for (let p = step.parent; p !== undefined; p = walk.steps[p].parent) crumbs.unshift(p);
  const title = sym.kind === "module" ? `${sym.file} (top level)` : sym.name;
  const relations = new Map<string, string[]>();
  for (const d of step.dataUsed) (relations.get(d.id) ?? relations.set(d.id, []).get(d.id)!).push(d.relation);

  return (
    <div className="explain">
      <div className="stepno">
        {`Step ${step.index + 1}${step.depth ? ` · depth ${step.depth}` : " · entry"}`}
        {area && (
          <>
            {" · "}
            <AreaLink className="areatag" n={ctx!.areas.indexOf(area) + 1}>
              {area.name}
            </AreaLink>
          </>
        )}
      </div>
      {crumbs.length > 0 && (
        <div className="crumbs">
          {crumbs.map((p, i) => (
            <Fragment key={p}>
              {i > 0 && " › "}
              <StepLink step={p}>{symbols[walk.steps[p].symbolId].name}</StepLink>
            </Fragment>
          ))}
          {" ›"}
        </div>
      )}
      <h3>{title}</h3>
      <div className="sig">
        <code>{sym.signature}</code>
      </div>
      <p>
        <Inline text={step.description} />
      </p>
      {!panel && relations.size > 0 && (
        <div className="chips">
          {[...relations].map(([id, rels]) => (
            <button type="button" className="chip" key={id} data-open={`data:${id}`} title="Show the definition" onClick={() => onOpen?.(`data:${id}`)}>
              <span>{rels.join(", ")}</span>
              {symbols[id].name}
            </button>
          ))}
        </div>
      )}
      {step.calls.length > 0 && (
        <ul className="calls">
          {step.calls.map((c, i) => {
            const t = symbols[c.to];
            return (
              <li key={i}>
                {panel ? (
                  <code>{t.name}</code>
                ) : (
                  <button type="button" className="peek" data-open={`call:${c.to}`} title="Preview the code" onClick={() => onOpen?.(`call:${c.to}`)}>
                    <code>{t.name}</code>
                  </button>
                )}
                {t.repo && t.repo !== sym.repo && (
                  <>
                    {" "}
                    <span className="tag">{t.repo}</span>
                  </>
                )}
                {c.inferred && (
                  <>
                    {" "}
                    <span className="tag" title="Matched by package and name">
                      by name
                    </span>
                  </>
                )}{" "}
                <span className="muted">{`line ${c.line}`}</span>
                {" · "}
                {c.step !== undefined ? <StepLink step={c.step}>{`step ${c.step + 1}`}</StepLink> : <span className="muted" title="Maps made before the walk became complete could stop early">not in this map</span>}
                {c.via.length > 0 && (
                  <>
                    {" "}
                    <span className="muted">
                      {"via "}
                      {c.via.map((v, j) => (
                        <Fragment key={j}>
                          {j > 0 && " → "}
                          <code>{symbols[v].name}</code>
                        </Fragment>
                      ))}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <HiddenHelpers step={step} />
      {panel && (
        <StepLink step={step.index} className="more">
          Read with the code ↓
        </StepLink>
      )}
    </div>
  );
}

function StepTabs({ step, main, sub, onMain, onSub }: { step: PathStep; main: string; sub: Record<string, string>; onMain: (k: string) => void; onSub: (tab: string, k: string) => void }) {
  const { doc } = useMap();
  const symbols = doc.render.symbols;
  const sym = symbols[step.symbolId];
  const { hits, lines, full } = useMemo(() => {
    const hits = new Map<number, number[]>();
    for (const c of step.calls) if (c.step !== undefined) (hits.get(c.line) ?? hits.set(c.line, []).get(c.line)!).push(c.step);
    const external = sym.externalCalls.map((c) => c.line);
    return { hits, lines: excerpt(sym, [...step.calls.map((c) => c.line), ...(sym.kind === "module" ? external : [])]), full: allLines(sym) };
  }, [step, sym]);
  const cut = lines.some((l) => l.gap);
  const tabs: TabDef[] = [{ key: "code", label: "Code", content: () => <CodeBox sym={sym} lines={lines} hits={hits} note={cut ? `excerpt of lines ${sym.startLine}–${sym.endLine}` : undefined} /> }];

  const relations = new Map<string, string[]>();
  for (const d of step.dataUsed) (relations.get(d.id) ?? relations.set(d.id, []).get(d.id)!).push(d.relation);
  if (relations.size) {
    const items: TabDef[] = [...relations].map(([id, rels]) => ({
      key: `data:${id}`,
      label: (
        <>
          <span className="rel">{rels.join(", ")}</span>
          {symbols[id].name}
        </>
      ),
      content: () => <DataSnippet id={id} />,
    }));
    tabs.push({
      key: "data",
      label: (
        <>
          Data <span className="count">{relations.size}</span>
        </>
      ),
      content: () => <Tabs className="sub" tabs={items} selected={sub.data} onSelect={(k) => onSub("data", k)} />,
    });
  }
  if (step.calls.length) {
    const items: TabDef[] = step.calls.map((c) => ({
      key: `call:${c.to}`,
      label: (
        <>
          {c.step !== undefined && <span className="rel">{c.step + 1}</span>}
          {symbols[c.to].name}
        </>
      ),
      content: () => <CallSnippet id={c.to} />,
    }));
    tabs.push({
      key: "calls",
      label: (
        <>
          Calls <span className="count">{step.calls.length}</span>
        </>
      ),
      content: () => <Tabs className="sub" tabs={items} selected={sub.calls} onSelect={(k) => onSub("calls", k)} />,
    });
  }
  if (cut) tabs.push({ key: "full", label: "Full source", content: () => <CodeBox sym={sym} lines={full} hits={hits} /> });
  return <Tabs className="main" tabs={tabs} selected={main} onSelect={onMain} />;
}

export function Step({ step }: { step: PathStep }) {
  const { target } = useMap();
  const reading = useCurrentStep((s) => s === step.index);
  const [main, setMain] = useState("code");
  const [sub, setSub] = useState<Record<string, string>>({});
  const onSub = (tab: string, key: string) => setSub((s) => ({ ...s, [tab]: key }));
  const open = (key: OpenKey) => {
    const tab = key.startsWith("data:") ? "data" : "calls";
    setMain(tab);
    onSub(tab, key);
  };
  const id = `step-${step.index + 1}`;
  const cls = ["step", reading && "current", target === id && "targeted"].filter(Boolean).join(" ");
  return (
    <section className={cls} id={id} data-node={`s${step.index}`} style={{ "--depth": Math.min(step.depth, 8) } as CSSProperties}>
      <StepExplain step={step} onOpen={open} />
      <StepTabs step={step} main={main} sub={sub} onMain={setMain} onSub={onSub} />
    </section>
  );
}
