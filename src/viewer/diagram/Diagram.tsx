// One zoomable, hoverable Mermaid diagram. The call path adds the step navigator on top (PathDiagram).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { Diagram as DiagramData } from "../../pagedata";
import { markHover, readGraph, sameTarget, targetOf, type Graph, type HoverTarget } from "./graph";
import { Tooltip } from "./Tooltip";
import { useMermaid } from "./useMermaid";
import { useZoomPan, type View } from "./useZoomPan";

export interface DiagramHandle {
  data: DiagramData;
  graph: Graph | null;
  view: View;
  error: string;
  svg: string | null;
  hover: HoverTarget | null;
  refs: {
    container: RefObject<HTMLDivElement | null>;
    stage: RefObject<HTMLDivElement | null>;
    canvas: RefObject<HTMLPreElement | null>;
    level: RefObject<HTMLSpanElement | null>;
    tip: RefObject<HTMLDivElement | null>;
  };
  onMouseOver(e: MouseEvent): void;
  onMouseMove(e: MouseEvent): void;
  onMouseLeave(): void;
  /** Clicking an arrow keeps both its ends highlighted until the next click. */
  pin(target: HoverTarget | null): void;
}

/** Draws `data` once `active`, and tracks what the pointer is over. */
export function useDiagram(data: DiagramData, active: boolean): DiagramHandle {
  const refs = {
    container: useRef<HTMLDivElement>(null),
    stage: useRef<HTMLDivElement>(null),
    canvas: useRef<HTMLPreElement>(null),
    level: useRef<HTMLSpanElement>(null),
    tip: useRef<HTMLDivElement>(null),
  };
  const { svg, error } = useMermaid(data.source, active);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const [pinned, setPinned] = useState<HoverTarget | null>(null);
  const view = useZoomPan(refs, graph);
  const hover = hovered ?? pinned;

  useLayoutEffect(() => {
    const el = svg && refs.canvas.current?.querySelector("svg");
    setGraph(el ? readGraph(el) : null);
    setHovered(null);
    setPinned(null);
  }, [svg]);

  useLayoutEffect(() => {
    if (graph) markHover(graph, hover);
  }, [graph, hover]);

  return {
    data,
    graph,
    view,
    error,
    svg,
    hover,
    refs,
    onMouseOver(e) {
      if (!graph) return;
      const t = targetOf(graph, e.target as Element, data.info);
      if (!sameTarget(t, hovered)) setHovered(t);
    },
    onMouseMove(e) {
      const tip = refs.tip.current;
      const box = refs.container.current;
      if (!tip || tip.hidden || !box) return;
      const r = box.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8))}px`;
      tip.style.top = `${e.clientY - r.top + 16}px`;
    },
    onMouseLeave() {
      setHovered(null);
    },
    pin: setPinned,
  };
}

export function ZoomButtons({ d }: { d: DiagramHandle }) {
  return (
    <>
      <button type="button" data-zoom="out" title="Zoom out" onClick={() => d.view.zoomBy(1 / 1.25)}>
        −
      </button>
      <span className="zoomlevel" ref={d.refs.level}>
        100%
      </span>
      <button type="button" data-zoom="in" title="Zoom in" onClick={() => d.view.zoomBy(1.25)}>
        +
      </button>
      <button type="button" data-zoom="fit" title="Fit the whole diagram (0)" onClick={() => d.view.fit()}>
        Fit
      </button>
      <button type="button" data-zoom="start" title="Back to the entry" onClick={() => d.view.start()}>
        Entry
      </button>
      <button type="button" data-zoom="full" title="Full screen" onClick={() => d.view.toggleFullscreen()}>
        ⤢
      </button>
    </>
  );
}

interface FrameProps {
  name: string;
  d: DiagramHandle;
  active: boolean;
  className?: string;
  pathView?: boolean;
  toolbar?: ReactNode;
  hint: string;
  overlay?: ReactNode;
  onKeyDown?: (e: KeyboardEvent) => void;
  onClick?: (target: HoverTarget | null, e: MouseEvent) => void;
}

export function DiagramFrame({ name, d, active, className, pathView, toolbar, hint, overlay, onKeyDown, onClick }: FrameProps) {
  const focusing = !!d.hover && d.hover.kind !== "cluster";
  return (
    <div className={["diagram", focusing && "focusing", className].filter(Boolean).join(" ")} id={`tab-${name}`} data-path-view={pathView ? "1" : undefined} hidden={!active} ref={d.refs.container} onKeyDown={onKeyDown}>
      <div className="toolbar">
        <ZoomButtons d={d} />
        {toolbar}
        <span className="hint">{hint}</span>
      </div>
      <div
        className="stage"
        tabIndex={0}
        ref={d.refs.stage}
        onMouseOver={d.onMouseOver}
        onMouseMove={d.onMouseMove}
        onMouseLeave={d.onMouseLeave}
        onClick={(e) => {
          if ((e.target as Element).closest(".steppanel")) return;
          const t = d.graph ? targetOf(d.graph, e.target as Element, d.data.info) : null;
          d.pin(t?.kind === "edge" ? t : null);
          onClick?.(t, e);
        }}
      >
        {d.svg ? (
          <pre className="mermaid" key="svg" ref={d.refs.canvas} dangerouslySetInnerHTML={{ __html: d.svg }} />
        ) : (
          <pre className="mermaid" key="source" ref={d.refs.canvas}>
            {d.data.source}
          </pre>
        )}
        {overlay}
      </div>
      {d.error && <p className="error">{`The diagram didn't draw: ${d.error}`}</p>}
      <Tooltip ref={d.refs.tip} target={d.hover} graph={d.graph} info={d.data.info} />
    </div>
  );
}
