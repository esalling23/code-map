// "What you're looking at": what the code does, where it sits, and the areas it runs through.
import { Fragment } from "react";
import type { SystemArea } from "../../types";
import { StepLink, useMap } from "./context";
import { Inline } from "./Inline";

const MAX_HANDOFFS = 14;

export function Intro() {
  const { doc } = useMap();
  const walk = doc.render.walkthrough;
  const symbols = doc.render.symbols;
  const ctx = walk.context;
  if (!ctx)
    return (
      <div className="overview">
        <Inline text={walk.overview} />
      </div>
    );
  const nameOf = new Map(ctx.areas.map((a) => [a.id, a.name]));
  const stepName = (i: number) => symbols[walk.steps[i].symbolId].name;
  const links = walk.links ?? [];

  return (
    <section className="intro">
      <div className="introgrid">
        <div className="card lead">
          <div className="eyebrow">What this code does</div>
          <p className="summary">
            <Inline text={ctx.summary} />
          </p>
          <p className="muted small">
            <Inline text={walk.overview} />
          </p>
        </div>
        <div className="card">
          <div className="eyebrow">Where it sits in the system</div>
          <p>
            <Inline text={ctx.role} />
          </p>
        </div>
      </div>
      <h2>Areas on this path</h2>
      <p className="muted">The parts of the system the code passes through, in the order it reaches them. Quoted text is what the repo's own docs say about each area.</p>
      <ol className="areas">
        {ctx.areas.map((a, i) => (
          <Area key={a.id} n={i + 1} area={a} showRepo={!!a.repo && ctx.repos.length > 1} />
        ))}
      </ol>
      {links.length > 0 && (
        <div className="card links">
          <div className="eyebrow">Connections outside the code</div>
          <p className="muted small">These parts talk through the network, a queue or stored files, not direct calls. They show as dashed arrows in the diagram.</p>
          <ul>
            {links.map((l, i) => (
              <li key={i}>
                <code>{stepName(l.from)}</code> (<StepLink step={l.from}>{`step ${l.from + 1}`}</StepLink>) → <code>{stepName(l.to)}</code> (
                <StepLink step={l.to}>{`step ${l.to + 1}`}</StepLink>): <Inline text={l.label} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {ctx.handoffs.length > 0 && (
        <details className="fold">
          <summary>
            How it moves between areas <span className="count">{ctx.handoffs.length}</span>
          </summary>
          <ol className="handoffs">
            {ctx.handoffs.slice(0, MAX_HANDOFFS).map((h, i) => (
              <li key={i}>
                <strong>{nameOf.get(h.from)}</strong> → <strong>{nameOf.get(h.to)}</strong>: <code>{stepName(h.fromStep)}</code> calls <code>{stepName(h.step)}</code> (
                <StepLink step={h.step}>{`step ${h.step + 1}`}</StepLink>)
              </li>
            ))}
            {ctx.handoffs.length > MAX_HANDOFFS && <li className="muted">{`and ${ctx.handoffs.length - MAX_HANDOFFS} more`}</li>}
          </ol>
        </details>
      )}
      <details className="fold">
        <summary>How to read this page</summary>
        <ul>
          <li>
            <strong>Areas</strong> (above): the folders and packages the code runs through, with what their docs say about them.
          </li>
          <li>
            <strong>Levels</strong>: hide helper steps that have few steps beneath them, to see the main path first. Step numbers don't change; a step with hidden helpers says how many, and clicking that shows them.
          </li>
          <li>
            <strong>System diagram</strong>: every step as a box, grouped by file (and by repo when there are several). Hover a box or arrow to highlight what it connects to. Zoom with the buttons, Ctrl/⌘ + scroll or a pinch, and drag to move around.
          </li>
          <li>
            <strong>Walkthrough</strong>: the steps in the order the code runs them. The text on the left explains each step. The tabs on the right show its code, the data it uses and the functions it calls.
          </li>
          <li>
            <strong>Data</strong>: every type the path touches, with its definition.
          </li>
        </ul>
      </details>
    </section>
  );
}

function Area({ n, area, showRepo }: { n: number; area: SystemArea; showRepo: boolean }) {
  const { target } = useMap();
  const id = `area-${n}`;
  return (
    <li className={target === id ? "area targeted" : "area"} id={id}>
      <div className="areahead">
        <span className="areano">{n}</span>
        <strong>{area.name}</strong>
        {showRepo && (
          <>
            {" "}
            <span className="tag">{area.repo}</span>
          </>
        )}
      </div>
      <div className="areapath">{area.id}</div>
      {area.description && (
        <p>
          <Inline text={area.description} />
        </p>
      )}
      {area.doc ? (
        <blockquote>
          <Inline text={area.doc} />
          <cite>{area.docSource}</cite>
        </blockquote>
      ) : (
        !area.description && <p className="muted">No docs found for this folder.</p>
      )}
      <div className="areasteps">
        steps{" "}
        {area.steps.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && " "}
            <StepLink step={s}>{s + 1}</StepLink>
          </Fragment>
        ))}
      </div>
    </li>
  );
}
