// The walkthrough (the shown steps, in order) and the data section.
import { useEffect, useRef } from "react";
import { dataIdsOf, shortPath } from "../text";
import { useMap } from "./context";
import { DataSnippet } from "./Snippets";
import { Step } from "./Step";
import { Tabs } from "./Tabs";

export function Walkthrough() {
  const { doc, visible, setCurrent } = useMap();
  const steps = doc.render.walkthrough.steps.filter((s) => visible.has(s.index));
  const box = useRef<HTMLDivElement>(null);
  const shownKey = steps.map((s) => s.index).join(",");

  // The step being read: the one crossing the upper part of the window.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.node!.slice(1)));
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    box.current?.querySelectorAll(".step").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [shownKey, setCurrent]);

  return (
    <>
      <h2>Walkthrough</h2>
      <p className="muted">
        The path the code takes when it runs, in order. Highlighted lines are the calls that lead to the next steps; the → buttons on them jump there. Use the tabs beside each step to see the data it uses and preview the code it calls.
      </p>
      <div ref={box}>
        {steps.map((s) => (
          <Step key={s.index} step={s} />
        ))}
      </div>
    </>
  );
}

export function DataSection() {
  const { doc } = useMap();
  const ids = dataIdsOf(doc.render.walkthrough);
  if (!ids.length) return null;
  const symbols = doc.render.symbols;
  const tabs = ids.map((id) => ({
    key: `data:${id}`,
    label: (
      <>
        <span className="dname">{symbols[id].name}</span>
        <span className="dfile" title={symbols[id].file}>
          {shortPath(symbols[id].file)}
        </span>
      </>
    ),
    content: () => <DataSnippet id={id} />,
  }));
  return (
    <>
      <h2 id="data">
        Data <span className="count">{ids.length}</span>
      </h2>
      <p className="muted">Types, interfaces, enums and classes the path reads, returns or creates.</p>
      <Tabs className="vertical" tabs={tabs} />
    </>
  );
}
