// The call path for a set of shown steps: Mermaid sources and the navigator's route, made from data.
// It runs the document builder's own diagram code (`buildDocument` → `pathDiagram`) on a walk cut down to
// the shown steps, so nothing is forked. Pure; task 05 can fold it into pagedata as a `visible` option.
import { buildDocument, routeOf, type CodeMapDocument, type Diagram, type RouteStop } from "../../pagedata";
import type { CodeMap, Walkthrough } from "../../types";

export interface PathView {
  path: Diagram;
  compact: Diagram;
  route: RouteStop[];
}

/** The call path showing only `visible` steps (0-based), with a "hidden" box under each step in `hidden`. */
export function pathView(doc: CodeMapDocument, visible: Set<number>, hidden: Map<number, number[]>): PathView {
  const d = doc.render;
  const walk = d.walkthrough;
  if (walk.steps.every((s) => visible.has(s.index))) return { path: d.diagrams.path, compact: d.diagrams.compact, route: d.route };

  const kept = walk.steps.filter((s) => visible.has(s.index));
  const hiddenSymbols = new Set(walk.steps.filter((s) => !visible.has(s.index)).map((s) => s.symbolId));
  const steps = kept.map((s) => ({
    ...s,
    calls: s.calls.map((c) => (c.step !== undefined && !visible.has(c.step) ? { ...c, step: undefined } : c)),
    dataUsed: s.dataUsed.filter((x) => !hiddenSymbols.has(x.id)),
  }));
  const links = walk.links?.filter((l) => visible.has(l.from) && visible.has(l.to));
  const shown: Walkthrough = { ...walk, steps, ...(links && { links }) };

  // The builder also writes the system summary, which finds a step's parent by array position.
  const position = new Map(kept.map((s, i) => [s.index, i]));
  const forBuilder: Walkthrough = { ...shown, steps: steps.map((s) => ({ ...s, parent: s.parent === undefined ? undefined : position.get(s.parent) })) };
  const map: CodeMap = { roots: d.roots, files: [], fileDocs: {}, symbols: d.symbols, calls: [], data: [], imports: [] };
  const built = buildDocument(map, forBuilder).render.diagrams;

  return {
    path: withHidden(built.path, hidden),
    compact: withHidden(built.compact, hidden),
    route: routeOf(map, shown),
  };
}

/** Adds a dashed "N hidden" box under each step whose helpers are hidden. */
function withHidden(diagram: Diagram, hidden: Map<number, number[]>): Diagram {
  if (!hidden.size) return diagram;
  const lines = [diagram.source];
  const info = { ...diagram.info };
  for (const [p, steps] of hidden) {
    lines.push(`  h${p}(["${steps.length} hidden"])`, `  s${p} -.- h${p}`);
    info[`h${p}`] = { title: `${steps.length} helper step${steps.length === 1 ? "" : "s"} hidden under step ${p + 1}; click to show`, kind: "hidden" };
  }
  lines.push("  classDef hidden stroke-dasharray:2 3,opacity:.8", `  class ${[...hidden.keys()].map((p) => `h${p}`).join(",")} hidden`);
  return { source: lines.join("\n"), info };
}
