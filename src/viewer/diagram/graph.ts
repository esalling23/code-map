// The boxes and arrows of a rendered Mermaid diagram, by Mermaid id, and the hover highlight on them.
import type { NodeInfo } from "../../pagedata";

export interface Edge {
  p: SVGPathElement;
  label?: Element;
  from?: string;
  to?: string;
  /** A wide invisible copy of the arrow, so it is easy to hover. */
  hit: SVGPathElement;
  text: string;
}

export interface Graph {
  svg: SVGSVGElement;
  w: number;
  h: number;
  nodes: Map<string, Element>;
  edges: Edge[];
  /** File and class boxes. */
  clusters: Map<string, Element>;
}

export type HoverTarget = { kind: "node"; id: string } | { kind: "edge"; i: number } | { kind: "cluster"; id: string };

const HL = ["hl-self", "hl-next", "hl-prev", "hl-out", "hl-in"];

/** Reads a freshly rendered diagram, sizes it to its own width and height, and adds the arrows' hover targets. */
export function readGraph(svg: SVGSVGElement): Graph {
  const vb = svg.viewBox.baseVal;
  svg.removeAttribute("style");
  svg.setAttribute("width", String(vb.width));
  svg.setAttribute("height", String(vb.height));
  const nodes = new Map<string, Element>();
  svg.querySelectorAll("g.node").forEach((n) => {
    const m = n.id.match(/^flowchart-(.+)-\d+$/);
    if (m) nodes.set(m[1], n);
  });
  const labels = [...svg.querySelectorAll(".edgeLabels > .edgeLabel")];
  const edges: Edge[] = [];
  [...svg.querySelectorAll<SVGPathElement>("path.flowchart-link")].forEach((p, i) => {
    // Invisible layout links (`~~~`) have no stroke; leave them out.
    if (/stroke-width:\s*0/.test(p.getAttribute("style") || "")) return;
    const cls = [...p.classList];
    const hit = p.cloneNode() as SVGPathElement;
    ["id", "style", "marker-end", "marker-start"].forEach((a) => hit.removeAttribute(a));
    hit.setAttribute("class", "edge-hit");
    hit.dataset.edge = String(edges.length);
    p.after(hit);
    edges.push({ p, hit, label: labels[i], from: cls.find((c) => c.startsWith("LS-"))?.slice(3), to: cls.find((c) => c.startsWith("LE-"))?.slice(3), text: labels[i]?.textContent?.trim() || "" });
  });
  const clusters = new Map<string, Element>();
  svg.querySelectorAll("g.cluster").forEach((c) => clusters.set(c.id, c));
  return { svg, w: vb.width, h: vb.height, nodes, edges, clusters };
}

/** What the pointer is over: a box, an arrow, or a file or class box's label. */
export function targetOf(graph: Graph, el: Element | null, info: Record<string, NodeInfo>): HoverTarget | null {
  if (!el) return null;
  const hit = el.closest<SVGPathElement>(".edge-hit");
  if (hit) return { kind: "edge", i: Number(hit.dataset.edge) };
  const node = el.closest("g.node");
  if (node) {
    for (const [id, n] of graph.nodes) if (n === node) return { kind: "node", id };
    return null;
  }
  const label = el.closest(".cluster-label");
  const cluster = label?.closest("g.cluster");
  return cluster && info[cluster.id] ? { kind: "cluster", id: cluster.id } : null;
}

export const sameTarget = (a: HoverTarget | null, b: HoverTarget | null) => JSON.stringify(a) === JSON.stringify(b);

/** Marks a hovered box with what it calls (blue) and what calls it (orange), or a hovered arrow with both its ends. */
export function markHover(graph: Graph, target: HoverTarget | null) {
  graph.svg.querySelectorAll(HL.map((c) => `.${c}`).join(",")).forEach((el) => el.classList.remove(...HL));
  if (!target || target.kind === "cluster") return;
  const mark = (el: Element | undefined, c: string) => el?.classList.add(c);
  if (target.kind === "edge") {
    const e = graph.edges[target.i];
    mark(e.p, "hl-out");
    mark(e.label, "hl-out");
    mark(graph.nodes.get(e.from!), "hl-prev");
    mark(graph.nodes.get(e.to!), "hl-next");
    return;
  }
  mark(graph.nodes.get(target.id), "hl-self");
  for (const e of graph.edges) {
    if (e.from === target.id) {
      mark(e.p, "hl-out");
      mark(e.label, "hl-out");
      mark(graph.nodes.get(e.to!), "hl-next");
    }
    if (e.to === target.id) {
      mark(e.p, "hl-in");
      mark(e.label, "hl-in");
      mark(graph.nodes.get(e.from!), "hl-prev");
    }
  }
}
