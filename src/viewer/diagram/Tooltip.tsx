// The hover tip: a box's callers and callees, an arrow's two ends, or a file box's full path.
import { forwardRef, type ReactNode } from "react";
import type { NodeInfo } from "../../pagedata";
import type { Edge, Graph, HoverTarget } from "./graph";

const MAX_LISTED = 4;

function list(items: ReactNode[]): ReactNode {
  const shown = items.slice(0, MAX_LISTED).flatMap((item, i) => (i ? [", ", item] : [item]));
  return items.length > MAX_LISTED ? [...shown, ` and ${items.length - MAX_LISTED} more`] : shown;
}

function rows(target: HoverTarget, graph: Graph, info: Record<string, NodeInfo>): ReactNode[] {
  const title = (id?: string) => (id && (info[id]?.title ?? graph.nodes.get(id)?.textContent?.trim())) || id || "";
  const kind = (id?: string) => (id && info[id]?.kind) || "step";
  const k = (text: string) => <span className="k">{` (${text})`}</span>;
  const named = (id: string | undefined, e: Edge) => (
    <>
      {title(id)}
      {e.text && kind(id) !== "data" && k(e.text)}
    </>
  );
  const keyed = (items: ReactNode[]) => items.map((item, i) => <span key={i}>{item}</span>);

  if (target.kind === "cluster") return [<b key="t">{info[target.id].title}</b>];
  if (target.kind === "edge") {
    const e = graph.edges[target.i];
    return [<b key="t">{title(e.from)}</b>, <div key="to">{`→ ${title(e.to)}`}</div>, e.text ? <div key="k" className="k">{e.text}</div> : null];
  }
  const id = target.id;
  const out = graph.edges.filter((e) => e.from === id && kind(e.to) !== "hidden");
  const inc = graph.edges.filter((e) => e.to === id);
  const head = <b key="t">{title(id)}</b>;
  if (kind(id) === "hidden") return [head];
  if (kind(id) === "data")
    return [head, <div key="u">Used by: {inc.length ? list(keyed(inc.map((e) => <>{title(e.from)}{k(e.text)}</>))) : "nothing on this map"}</div>];
  if (kind(id) === "file")
    return [
      head,
      <div key="u">← Used by: {inc.length ? list(keyed(inc.map((e) => title(e.from)))) : "no file on this map"}</div>,
      <div key="o">→ Uses: {out.length ? list(keyed(out.map((e) => title(e.to)))) : "no other file on this map"}</div>,
    ];
  const callers = inc.filter((e) => kind(e.from) !== "data");
  const calls = out.filter((e) => kind(e.to) !== "data");
  const data = out.filter((e) => kind(e.to) === "data");
  return [
    head,
    <div key="c">← Called by: {callers.length ? list(keyed(callers.map((e) => named(e.from, e)))) : "nothing on this map (a starting point)"}</div>,
    <div key="o">→ Calls: {calls.length ? list(keyed(calls.map((e) => named(e.to, e)))) : "nothing else on this map"}</div>,
    data.length ? <div key="d">Data: {list(keyed(data.map((e) => <>{title(e.to)}{k(e.text)}</>)))}</div> : null,
  ];
}

/** Positioned by the diagram as the pointer moves. */
export const Tooltip = forwardRef<HTMLDivElement, { target: HoverTarget | null; graph: Graph | null; info: Record<string, NodeInfo> }>(function Tooltip({ target, graph, info }, ref) {
  return (
    <div className="tip" ref={ref} hidden={!target || !graph}>
      {target && graph && rows(target, graph, info)}
    </div>
  );
});
