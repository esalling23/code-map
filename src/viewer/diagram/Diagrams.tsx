// The "System diagram" section: the call path (full and compact) and the files diagram, as tabs.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Diagram as DiagramData } from "../../pagedata";
import type { PathView } from "../levels/pathView";
import { useMap } from "../map/context";
import { DiagramFrame, useDiagram } from "./Diagram";
import { follow } from "./glide";
import { NavButtons, StepPanel, useNavigator, type Navigator } from "./StepNavigator";

const PATH_CLASSES = ["on-path", "nav-edge", "nav-cur", "nav-from"];

function PathDiagram({ name, data, active, nav }: { name: string; data: DiagramData; active: boolean; nav: Navigator }) {
  const d = useDiagram(data, active);
  const { goToStep, expand, current } = useMap();
  const panel = useRef<HTMLElement>(null);
  const { graph } = d;
  const route = nav.route;
  const edgesInto = (i: number) => (graph && route[i].from ? graph.edges.filter((e) => e.from === route[i].from && e.to === route[i].id) : []);

  // The route so far (or all of it, for Full path), and the current stop with the arrow into it.
  useLayoutEffect(() => {
    if (!graph) return;
    graph.svg.querySelectorAll(PATH_CLASSES.map((c) => `.${c}`).join(",")).forEach((el) => el.classList.remove(...PATH_CLASSES));
    const upTo = nav.full ? route.length - 1 : nav.at;
    for (let i = 0; i <= upTo; i++) {
      graph.nodes.get(route[i].id)?.classList.add("on-path");
      for (const e of edgesInto(i)) [e.p, e.label].forEach((el) => el?.classList.add("on-path"));
    }
    if (nav.at >= 0) {
      const r = route[nav.at];
      graph.nodes.get(r.id)?.classList.add("nav-cur");
      if (r.from) graph.nodes.get(r.from)?.classList.add("nav-from");
      for (const e of edgesInto(nav.at)) [e.p, e.label].forEach((el) => el?.classList.add("nav-edge"));
    }
  }, [graph, route, nav.full, nav.at]);

  // The step being read in the walkthrough.
  useEffect(() => {
    const node = graph?.nodes.get(`s${current}`);
    node?.classList.add("active");
    return () => node?.classList.remove("active");
  }, [graph, current]);

  const followed = useRef(0);
  useEffect(() => {
    const stage = d.refs.stage.current;
    if (!active || !graph || !stage || nav.follow.n === followed.current) return;
    followed.current = nav.follow.n;
    if (nav.at < 0) return;
    const node = graph.nodes.get(route[nav.at].id);
    if (node) follow(d.view, stage, panel.current, node, edgesInto(nav.at)[0]?.p, nav.follow.animate);
  }, [active, graph, nav.follow, nav.at]);

  const focused = useRef(0);
  useEffect(() => {
    if (!active || nav.focus.n === focused.current) return;
    focused.current = nav.focus.n;
    if (nav.focus.fullscreen && !document.fullscreenElement) d.refs.container.current?.requestFullscreen?.();
    else if (nav.focus.fullscreen) document.exitFullscreen().then(() => d.refs.container.current?.requestFullscreen?.(), () => {});
    d.refs.stage.current?.focus({ preventScroll: true });
  }, [active, nav.focus]);

  return (
    <DiagramFrame
      name={name}
      d={d}
      active={active}
      pathView
      className={nav.full || nav.at >= 0 ? "pathing" : undefined}
      toolbar={<NavButtons nav={nav} />}
      hint="Ctrl/⌘ + scroll or pinch to zoom · drag to move · hover to trace · ← → to step"
      overlay={<StepPanel nav={nav} panelRef={panel} />}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") nav.stepBy(1);
        else if (e.key === "ArrowLeft") nav.stepBy(-1);
        else if (e.key === "Escape" && nav.at >= 0) nav.stop();
        else return;
        e.preventDefault();
      }}
      onClick={(t) => {
        const m = t?.kind === "node" ? t.id.match(/^([sh])(\d+)$/) : null;
        if (m?.[1] === "s") goToStep(Number(m[2]));
        else if (m?.[1] === "h") expand(Number(m[2]));
      }}
    />
  );
}

function FilesDiagram({ data, active }: { data: DiagramData; active: boolean }) {
  const d = useDiagram(data, active);
  return <DiagramFrame name="files" d={d} active={active} hint="Ctrl/⌘ + scroll or pinch to zoom · drag to move · hover to trace connections" />;
}

export function Diagrams({ view }: { view: PathView }) {
  const { doc } = useMap();
  const [tab, setTab] = useState<"path" | "files">("path");
  const nav = useNavigator(view.route);
  const pathShown = tab === "path";
  return (
    <>
      <h2>System diagram</h2>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={pathShown} data-tab="path" onClick={() => setTab("path")}>
          Call path
        </button>
        <button role="tab" aria-selected={!pathShown} data-tab="files" onClick={() => setTab("files")}>
          Files
        </button>
      </div>
      <PathDiagram name="path" data={view.path} active={pathShown && !nav.compact} nav={nav} />
      <PathDiagram name="pathc" data={view.compact} active={pathShown && nav.compact} nav={nav} />
      <FilesDiagram data={doc.render.diagrams.files} active={!pathShown} />
      <div className="legend">
        Boxes are functions and methods, numbered by step and grouped by file. Cylinders are data types. Solid arrows are calls; an arrow labelled "via" passes through functions outside the selection; thick arrows are calls matched by package and name (usually into another repo).
        Dotted arrows show data a step takes (param), returns, creates or uses. With several repos, files are grouped inside a box per repo. Hover a box to highlight what it calls (blue) and what calls it (orange); hover an arrow to see both ends, and click it to keep them
        highlighted. Click a box to jump to its step. Compact hides the data types; Full path highlights the route from the first step to the last; ◀ ▶ or the arrow keys step through the functions one at a time, following each arrow. A dashed "hidden" box stands for helper steps the
        levels control hides; click it to show them. The Files tab shows how the files import each other; bold borders are files on the path.
      </div>
    </>
  );
}
