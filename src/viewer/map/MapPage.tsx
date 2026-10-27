// A whole map: the sticky bar with the title and levels control, then the header, intro, diagrams, walkthrough and data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { dataIdsOf } from "../../model";
import { pathView, type CodeMapDocument } from "../../pagedata";
import { Diagrams } from "../diagram/Diagrams";
import { LevelControl, useLevel } from "../levels/LevelControl";
import { hiddenGroups, stepLevels, visibleSteps } from "../levels/levels";
import { MapProvider, type MapState } from "./context";
import { Intro } from "./Intro";
import { MapBar, type MapNav, type MapSection } from "./MapBar";
import { DataSection, Walkthrough } from "./Walkthrough";

export function MapPage({ doc, nav }: { doc: CodeMapDocument; nav?: MapNav }) {
  const d = doc.render;
  const walk = d.walkthrough;
  const [level, setLevel] = useLevel();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [current, setCurrent] = useState(-1);
  const [target, setTarget] = useState("");
  const [scrollTo, setScrollTo] = useState("");

  const levels = useMemo(() => stepLevels(doc), [doc]);
  const visible = useMemo(() => visibleSteps(levels, level, expanded), [levels, level, expanded]);
  const hidden = useMemo(() => hiddenGroups(levels, visible), [levels, visible]);
  const view = useMemo(() => pathView(doc, { visible, hidden }), [doc, visible, hidden]);

  const expand = useCallback((step: number) => setExpanded((e) => new Set(e).add(step)), []);
  const goToStep = useCallback(
    (step: number) => {
      if (!visible.has(step)) {
        const owner = [...hidden].find(([, steps]) => steps.includes(step))?.[0];
        if (owner !== undefined) expand(owner);
      }
      setScrollTo(`step-${step + 1}`);
    },
    [visible, hidden, expand],
  );

  // Scroll once the target is on the page (after an expand has rendered it).
  useEffect(() => {
    if (!scrollTo) return;
    const el = document.getElementById(scrollTo);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth" });
    setTarget(scrollTo);
    setScrollTo("");
  }, [scrollTo, visible]);

  const state: MapState = {
    doc,
    visible,
    hidden,
    expand,
    goToStep,
    goToArea: (n) => setScrollTo(`area-${n}`),
    current,
    setCurrent,
    target,
  };

  const dataCount = dataIdsOf(walk).length;
  const sections: MapSection[] = [
    { id: "overview", label: "Overview" },
    { id: "diagram", label: "Map" },
    { id: "walkthrough", label: "Code" },
    ...(dataCount ? [{ id: "data", label: "Data" }] : []),
  ];
  const files = new Set(walk.steps.map((s) => d.symbols[s.symbolId].file));
  const rootsText = d.roots.map((r) => (r.label ? `${r.label}: ${r.dir}` : r.dir)).join(" · ");
  return (
    <MapProvider value={state}>
      <MapBar title={doc.system.title} sections={sections} nav={nav}>
        <LevelControl
          level={level}
          shown={visible.size}
          total={walk.steps.length}
          onChange={(n) => {
            setLevel(n);
            setExpanded(new Set());
          }}
        />
      </MapBar>
      <main>
        <header>
          <h1>{doc.system.title}</h1>
          <div className="stats">
            <span>{`${walk.steps.length} steps`}</span>
            <span>{`${files.size} files on the path`}</span>
            <span>{`${dataCount} data types`}</span>
            <span>{`${d.filesAnalyzed} files analyzed`}</span>
            {walk.selection && <span>{`selection: ${walk.selection.ids.length} functions, ${walk.selection.data.length} data types`}</span>}
            <span>{`${d.roots.length > 1 ? `${d.roots.length} repos — ` : "root: "}${rootsText}`}</span>
          </div>
        </header>
        <Intro />
        <Diagrams view={view} />
        <Walkthrough />
        <DataSection />
      </main>
    </MapProvider>
  );
}
