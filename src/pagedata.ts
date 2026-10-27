// The code-map document: what the CLI and MCP server write, and what the viewer reads.
// The `system` part is for agents (a sitemap of the code); `render` is what the viewer needs to draw the page.
// No Node or DOM APIs, so the viewer can also build a document from a raw `{ map, walkthrough }` dump.
import { createModel, descendantCounts, type Model } from "./model";
import { mmd, shortPath } from "./viewer/text";
import type { CodeMap, CodeSymbol, DataRelation, PathStep, RepoRoot, Walkthrough } from "./types";

export const FORMAT = "code-map";
export const VERSION = 2;

/** One step in words, for agents. */
export interface SystemStep {
  step: number;
  id: string;
  name: string;
  kind: CodeSymbol["kind"];
  /** `file:start-end` */
  file: string;
  area?: string;
  signature: string;
  description: string;
  calledBy: string;
  /** Step number (1-based) of the step that first called this one. A step reached from several callers sits under its first caller only. */
  parent?: number;
  /** How many steps sit beneath this one in the step tree (all levels, not only direct calls), counted under first callers only. */
  descendants: number;
  calls: { id: string; name: string; step?: number; via?: string[] }[];
  data: { id: string; name: string; relation: DataRelation }[];
  outsideCalls: string[];
  docComment: string;
}

/** The system at a glance: what an agent reads to understand the code without the source. */
export interface SystemSummary {
  title: string;
  summary: string;
  role: string;
  overview: string;
  entry: string;
  repos: { label: string; name: string; description: string }[];
  areas: { id: string; name: string; repo: string; description: string; doc: string; docSource: string; steps: number[] }[];
  steps: SystemStep[];
  data: { id: string; name: string; file: string; usedBy: number[] }[];
  /** Connections the analysis can't see (HTTP, queues, storage), by step number. */
  links: { from: number; to: number; label: string }[];
  /** Where the path crosses from one area into another, by step number. */
  handoffs: { from: string; to: string; fromStep: number; step: number }[];
}

export interface NodeInfo {
  title: string;
  kind: string;
}

export interface Diagram {
  source: string;
  /** Hover text for nodes and file boxes, by Mermaid id. */
  info: Record<string, NodeInfo>;
}

export interface RenderData {
  roots: RepoRoot[];
  filesAnalyzed: number;
  walkthrough: Walkthrough;
  /** Only the symbols the page refers to. */
  symbols: Record<string, CodeSymbol>;
  diagrams: { path: Diagram; compact: Diagram; files: Diagram };
  route: RouteStop[];
}

export interface CodeMapDocument {
  format: typeof FORMAT;
  version: typeof VERSION;
  /** The command line (or MCP call) that made this file, to regenerate it. */
  generator?: { args: string[] };
  system: SystemSummary;
  render: RenderData;
}

/** What the analysis knows about one step, in words: the facts an agent or a person needs to describe it. */
export function stepFacts(map: Pick<CodeMap, "symbols">, walk: Walkthrough, s: PathStep) {
  const name = (id: string) => map.symbols[id].name;
  const sym = map.symbols[s.symbolId];
  return {
    step: s.index + 1,
    id: s.symbolId,
    name: sym.name,
    file: `${sym.file}:${sym.startLine}-${sym.endLine}`,
    area: walk.context?.areaOfStep[s.index],
    signature: sym.signature,
    calledBy: s.parent !== undefined ? `step ${s.parent + 1} (${name(walk.steps[s.parent].symbolId)}), line ${s.callLine}` : s.via.length ? `reached by way of ${s.via.map(name).join(" → ")}` : "nothing on this path",
    ...(s.parent !== undefined && { parent: s.parent + 1 }),
    descendants: s.descendants,
    calls: s.calls.map((c) => `${name(c.to)}${c.step !== undefined ? ` (step ${c.step + 1})` : ""}${c.via.length ? ` via ${c.via.map(name).join(" → ")}` : ""}`),
    data: s.dataUsed.map((d) => `${name(d.id)} (${d.relation})`),
    outsideCalls: [...new Set(sym.externalCalls.map((c) => c.text))].slice(0, 12),
    docComment: sym.doc,
  };
}

export const defaultTitle = (map: Pick<CodeMap, "symbols">, walk: Walkthrough) => {
  const entry = map.symbols[walk.entry];
  return `Code map: ${entry.kind === "module" ? entry.file : entry.name}`;
};

function systemSummary(m: Model, title: string): SystemSummary {
  const { map, walk } = m;
  const ctx = walk.context;
  const name = (id: string) => map.symbols[id].name;
  return {
    title,
    summary: ctx?.summary ?? "",
    role: ctx?.role ?? "",
    overview: walk.overview,
    entry: walk.entry,
    repos: ctx?.repos ?? [],
    areas: (ctx?.areas ?? []).map((a) => ({ id: a.id, name: a.name, repo: a.repo, description: a.description, doc: a.doc, docSource: a.docSource, steps: a.steps.map((i) => i + 1) })),
    steps: walk.steps.map((s) => ({
      ...stepFacts(map, walk, s),
      kind: m.symbolOf(s).kind,
      description: s.description,
      calls: s.calls.map((c) => ({ id: c.to, name: name(c.to), ...(c.step !== undefined && { step: c.step + 1 }), ...(c.via.length && { via: c.via.map(name) }) })),
      data: s.dataUsed.map((d) => ({ id: d.id, name: name(d.id), relation: d.relation })),
    })),
    data: m.dataIds.map((id) => {
      const sym = map.symbols[id];
      return { id, name: sym.name, file: `${sym.file}:${sym.startLine}-${sym.endLine}`, usedBy: m.usersOf(id).map((i) => i + 1) };
    }),
    links: (walk.links ?? []).map((l) => ({ from: l.from + 1, to: l.to + 1, label: l.label })),
    handoffs: (ctx?.handoffs ?? []).map((h) => ({ ...h, fromStep: h.fromStep + 1, step: h.step + 1 })),
  };
}

/** The symbols the page shows or names: steps, what they call (and through), and their data. */
function referencedSymbols({ map, walk, dataIds }: Model): Record<string, CodeSymbol> {
  const ids = new Set<string>([walk.entry, ...dataIds]);
  for (const s of walk.steps) {
    ids.add(s.symbolId);
    s.via.forEach((v) => ids.add(v));
    for (const c of s.calls) {
      ids.add(c.to);
      c.via.forEach((v) => ids.add(v));
    }
  }
  return Object.fromEntries([...ids].filter((id) => map.symbols[id]).map((id) => [id, map.symbols[id]]));
}

export function buildDocument(map: CodeMap, walk: Walkthrough, opts: { title?: string; args?: string[] } = {}): CodeMapDocument {
  const title = opts.title ?? defaultTitle(map, walk);
  const m = createModel(map, walk);
  return {
    format: FORMAT,
    version: VERSION,
    ...(opts.args && { generator: { args: opts.args } }),
    system: systemSummary(m, title),
    render: {
      roots: map.roots,
      filesAnalyzed: map.files.length,
      walkthrough: walk,
      symbols: referencedSymbols(m),
      diagrams: { path: pathDiagram(m), compact: pathDiagram(m, true), files: filesDiagram(m) },
      route: routeOf(map, walk),
    },
  };
}

/** A walk written before version 2: without `truncated`, and with `descendants` filled in on its steps. */
function withLevels(old: Walkthrough & { truncated?: boolean }): Walkthrough {
  const { truncated: _, ...walk } = old;
  if (walk.steps.every((s) => typeof s.descendants === "number")) return walk;
  const counts = descendantCounts(walk.steps);
  return { ...walk, steps: walk.steps.map((s, i) => ({ ...s, descendants: counts[i] })) };
}

/** A version-1 document as version 2: no `generatedAt` or `truncated`, and the step levels added. */
function upgradeV1(v1: CodeMapDocument & { generatedAt?: string; system: { truncated?: boolean } }): CodeMapDocument {
  const { generatedAt: _, ...doc } = v1;
  const { truncated: __, ...system } = doc.system;
  const walk = withLevels(doc.render.walkthrough);
  const levels = (s: PathStep) => ({ ...(s.parent !== undefined && { parent: s.parent + 1 }), descendants: s.descendants });
  return {
    ...doc,
    version: VERSION,
    system: { ...system, steps: system.steps.map((s, i) => ({ ...s, ...levels(walk.steps[i]) })) },
    render: { ...doc.render, walkthrough: walk },
  };
}

/** A document from parsed JSON: a code-map document as written (this version or 1), or a raw `{ map, walkthrough }` dump (`--raw`). */
export function toDocument(value: unknown): CodeMapDocument {
  const v = value as Omit<Partial<CodeMapDocument>, "version"> & { version?: number; map?: CodeMap; walkthrough?: Walkthrough };
  if (v?.format === FORMAT) {
    if (v.version === 1) return upgradeV1(v as unknown as Parameters<typeof upgradeV1>[0]);
    if (v.version !== VERSION) throw new Error(`This file is code-map format version ${v.version}; this viewer reads versions 1 and ${VERSION}.`);
    return v as CodeMapDocument;
  }
  if (v?.map?.symbols && v.walkthrough?.steps) return buildDocument(v.map, withLevels(v.walkthrough));
  throw new Error("This isn't a code-map file. Make one with the code-map CLI (-o map.json) or its MCP server.");
}

interface DiagramNode {
  id: string;
  /** Label when the node sits inside its class's box (method name only). */
  short: string;
  /** Label everywhere else. */
  full: string;
  shape: "box" | "data";
  /** Class the node belongs to, for grouping a service's methods in one box. */
  group?: string;
}

const nodeLine = (n: DiagramNode, short: boolean) => {
  const text = mmd(short ? n.short : n.full);
  return n.shape === "data" ? `${n.id}[("${text}")]` : `${n.id}["${text}"]`;
};

/**
 * Emits `subgraph` blocks: by repo (when there are several), then by file, then one box per
 * class holding its methods. Returns the lines and the class boxes, for laying out leaves.
 */
function groupedSubgraphs(m: Model, nodesByFile: Map<string, DiagramNode[]>): { lines: string[]; boxes: DiagramNode[][]; clusters: Record<string, NodeInfo> } {
  const lines: string[] = [];
  const clusters: Record<string, NodeInfo> = {};
  const boxes: DiagramNode[][] = [];
  const byRepo = new Map<string, string[]>();
  for (const file of nodesByFile.keys()) {
    const repo = m.repoOf(file);
    (byRepo.get(repo) ?? byRepo.set(repo, []).get(repo)!).push(file);
  }
  let f = 0;
  let r = 0;
  let c = 0;
  for (const [repo, files] of byRepo) {
    const indent = repo ? "    " : "  ";
    if (repo) lines.push(`  subgraph r${r++}["${mmd(repo)}"]`);
    for (const file of files) {
      const title = mmd(shortPath(file));
      const nodes = nodesByFile.get(file)!;
      const groups = new Map<string, DiagramNode[]>();
      for (const n of nodes) if (n.group) (groups.get(n.group) ?? groups.set(n.group, []).get(n.group)!).push(n);
      for (const [g, members] of groups) if (members.length < 2) groups.delete(g);
      const loose = nodes.filter((n) => !n.group || !groups.has(n.group));

      if (groups.size === 1 && !loose.some((n) => n.shape === "box")) {
        // The file is one class: label the file's box with the class name.
        const [[g, members]] = [...groups];
        clusters[`f${f}`] = { title: `${g} · ${file}`, kind: "file" };
        lines.push(`${indent}subgraph f${f++}["<b>${mmd(g)}</b><br/><small>${title}</small>"]`);
        for (const n of members) lines.push(`${indent}  ${nodeLine(n, true)}`);
        for (const n of loose) lines.push(`${indent}  ${nodeLine(n, false)}`);
        lines.push(`${indent}end`);
        boxes.push(members);
        continue;
      }
      clusters[`f${f}`] = { title: file, kind: "file" };
      lines.push(`${indent}subgraph f${f++}["${title}"]`);
      for (const [g, members] of groups) {
        clusters[`c${c}`] = { title: `${g} · ${file}`, kind: "file" };
        lines.push(`${indent}  subgraph c${c++}["<b>${mmd(g)}</b>"]`);
        for (const n of members) lines.push(`${indent}    ${nodeLine(n, true)}`);
        lines.push(`${indent}  end`);
        boxes.push(members);
      }
      for (const n of loose) lines.push(`${indent}  ${nodeLine(n, false)}`);
      lines.push(`${indent}end`);
      const looseBoxes = loose.filter((n) => n.shape === "box");
      if (looseBoxes.length) boxes.push(looseBoxes);
    }
    if (repo) lines.push("  end");
  }
  return { lines, boxes, clusters };
}


/** What the page shows when hovering each node: its full name and kind. */
function pathNodeInfo({ map, symbolOf }: Model, steps: PathStep[], dataIds: string[]): Record<string, NodeInfo> {
  const info: Record<string, NodeInfo> = {};
  for (const s of steps) {
    const sym = symbolOf(s);
    info[`s${s.index}`] = { title: `${s.index + 1}. ${sym.kind === "module" ? `${sym.file} (top level)` : sym.name}`, kind: "step" };
    if (s.parent === undefined && s.via.length) info[`x${s.index}`] = { title: map.symbols[s.via[0]].name, kind: "outside" };
  }
  dataIds.forEach((id, i) => (info[`d${i}`] = { title: map.symbols[id].name, kind: "data" }));
  return info;
}


/** The steps a call path shows, for the viewer's levels filter. */
export interface StepFilter {
  /** Step indexes (0-based) to draw; the rest leave the diagram, and shown steps keep their numbers. */
  visible: Set<number>;
  /** For each shown step, the hidden steps beneath it: drawn as one dashed "N hidden" box. */
  hidden?: Map<number, number[]>;
}

/** The call path. `compact` leaves out the data types and their dotted arrows; `only` draws a subset of the steps. */
function pathDiagram(m: Model, compact = false, only?: StepFilter): Diagram {
  const { map, walk } = m;
  const keep = (i: number) => !only || only.visible.has(i);
  const steps = walk.steps.filter((s) => keep(s.index));
  // A data type that is also a step (a class) leaves with its step.
  const dataUsed = new Map(steps.map((s) => [s.index, s.dataUsed.filter((d) => keep(m.stepIndexOf(d.id) ?? s.index))]));
  const pathData = only ? m.dataIds.filter((id) => walk.selection?.data.includes(id) || steps.some((s) => dataUsed.get(s.index)!.some((d) => d.id === id))) : m.dataIds;
  const dataIds = compact ? [] : pathData;
  const lines = ["flowchart TD"];
  const dataNode = new Map(dataIds.map((id, i) => [id, `d${i}`]));
  const nodesByFile = new Map<string, DiagramNode[]>();
  const push = (file: string, node: DiagramNode) => (nodesByFile.get(file) ?? nodesByFile.set(file, []).get(file)!).push(node);

  for (const s of steps) {
    const sym = m.symbolOf(s);
    const label = sym.kind === "module" ? "top-level code" : sym.kind === "class" ? sym.name : `${sym.name}()`;
    const dot = sym.kind === "method" ? sym.name.indexOf(".") : -1;
    push(sym.file, {
      id: `s${s.index}`,
      full: `${s.index + 1}. ${label}`,
      short: dot > 0 ? `${s.index + 1}. ${sym.name.slice(dot + 1)}()` : `${s.index + 1}. ${label}`,
      shape: "box",
      group: dot > 0 ? sym.name.slice(0, dot) : undefined,
    });
  }
  for (const id of dataIds) {
    if (m.stepOf(id)) continue;
    const name = map.symbols[id].name;
    push(map.symbols[id].file, { id: dataNode.get(id)!, full: name, short: name, shape: "data" });
  }
  const { lines: groups, boxes, clusters } = groupedSubgraphs(m, nodesByFile);
  lines.push(...groups);

  const leadsSomewhere = new Set<string>();
  for (const s of steps) {
    if (s.parent === undefined && s.via.length) {
      lines.push(`  x${s.index}(["${mmd(map.symbols[s.via[0]].name)}"]) -.-> s${s.index}`);
    }
    for (const c of s.calls) {
      if (c.step === undefined || !keep(c.step)) continue;
      leadsSomewhere.add(`s${s.index}`);
      const arrow = c.inferred ? "==>" : "-->";
      const shown = c.via.slice(0, 3).map((v) => map.symbols[v].name.split(".").pop());
      const label = c.via.length ? `|"via ${mmd(shown.join(" → "))}${c.via.length > 3 ? ` +${c.via.length - 3}` : ""}"|` : "";
      lines.push(`  s${s.index} ${arrow}${label} s${c.step}`);
    }
  }
  for (const s of compact ? [] : steps) {
    for (const d of dataUsed.get(s.index)!) {
      const step = m.stepOf(d.id);
      const target = step ? `s${step.index}` : dataNode.get(d.id);
      lines.push(`  s${s.index} -. ${d.relation} .-> ${target}`);
    }
  }
  for (const l of (walk.links ?? []).filter((l) => keep(l.from) && keep(l.to))) {
    leadsSomewhere.add(`s${l.from}`);
    lines.push(`  s${l.from} -. "${mmd(l.label)}" .-> s${l.to}`);
  }
  // Stack a box's dead-end steps in a grid, not one long row: invisible links push each row down a rank.
  // They come after every real arrow so the page can tell them apart by position.
  for (const box of boxes) {
    const leaves = box.filter((n) => n.shape === "box" && !leadsSomewhere.has(n.id));
    if (leaves.length < 4) continue;
    const cols = Math.min(4, Math.ceil(Math.sqrt(leaves.length)));
    for (let i = cols; i < leaves.length; i++) lines.push(`  ${leaves[i - cols].id} ~~~ ${leaves[i].id}`);
  }
  lines.push("  classDef entry stroke-width:3px");
  lines.push("  classDef data stroke-dasharray:4 3");
  lines.push("  class s0 entry");
  if (dataIds.length) lines.push(`  class ${[...dataNode.values()].join(",")} data`);
  const info = { ...clusters, ...pathNodeInfo(m, steps, pathData) };
  const hidden = only?.hidden ?? new Map<number, number[]>();
  for (const [p, under] of hidden) {
    lines.push(`  h${p}(["${under.length} hidden"])`, `  s${p} -.- h${p}`);
    info[`h${p}`] = { title: `${under.length} helper step${under.length === 1 ? "" : "s"} hidden under step ${p + 1}; click to show`, kind: "hidden" };
  }
  if (hidden.size) lines.push("  classDef hidden stroke-dasharray:2 3,opacity:.8", `  class ${[...hidden.keys()].map((p) => `h${p}`).join(",")} hidden`);
  return { source: lines.join("\n"), info };
}

/** The call path and route for the viewer's levels filter. */
export interface PathView {
  path: Diagram;
  compact: Diagram;
  route: RouteStop[];
}

/** The call path of a document showing only some steps, made from the document alone; with every step shown, the document's own. */
export function pathView(doc: CodeMapDocument, only: StepFilter): PathView {
  const d = doc.render;
  const walk = d.walkthrough;
  if (walk.steps.every((s) => only.visible.has(s.index))) return { path: d.diagrams.path, compact: d.diagrams.compact, route: d.route };
  // The document keeps every symbol the diagram names, which is all the model needs from the map.
  const m = createModel({ roots: d.roots, files: [], fileDocs: {}, symbols: d.symbols, calls: [], data: [], imports: [] }, walk);
  return { path: pathDiagram(m, false, only), compact: pathDiagram(m, true, only), route: routeOf(m.map, walk, only.visible) };
}

export interface RouteStop {
  /** Mermaid id of the step's box. */
  id: string;
  /** The box the walkthrough reached this step from: its caller, or a link's source; null for a separate start. */
  from: string | null;
  /** Whether the step navigator stops here: functions, methods and top-level code, not types. */
  nav: boolean;
}

/** The steps in walkthrough order, each with the arrow that leads into it; only the `visible` ones when given. */
export function routeOf(map: Pick<CodeMap, "symbols">, walk: Walkthrough, visible?: Set<number>): RouteStop[] {
  const keep = (i: number) => !visible || visible.has(i);
  const links = (walk.links ?? []).filter((l) => keep(l.from) && keep(l.to));
  return walk.steps.filter((s) => keep(s.index)).map((s) => {
    const into = links.filter((l) => l.to === s.index && l.from !== s.index);
    const link = into.find((l) => l.from === s.index - 1) ?? into.sort((a, b) => b.from - a.from)[0];
    const from = s.parent !== undefined ? `s${s.parent}` : link ? `s${link.from}` : null;
    return { id: `s${s.index}`, from, nav: map.symbols[s.symbolId].kind !== "class" && map.symbols[s.symbolId].kind !== "data" };
  });
}

function filesDiagram(m: Model): Diagram {
  const { map } = m;
  const onPath = m.filesOnPath;
  // Imports, plus file pairs linked only by calls (e.g. into another repo's package).
  const links = new Map<string, { from: string; to: string; inferred: boolean }>();
  for (const i of map.imports) links.set(`${i.from}|${i.to}`, { ...i, inferred: false });
  for (const c of map.calls) {
    const from = map.symbols[c.from]?.file;
    const to = map.symbols[c.to]?.file;
    if (from && to && from !== to && !links.has(`${from}|${to}`)) links.set(`${from}|${to}`, { from, to, inferred: !!c.inferred });
  }
  const files = map.files.filter((f) => onPath.has(f) || [...links.values()].some((l) => (l.from === f || l.to === f) && (onPath.has(l.from) || onPath.has(l.to))));
  const shown = files.length > 80 ? files.filter((f) => onPath.has(f)) : files;
  const id = new Map(shown.map((f, i) => [f, `m${i}`]));
  const lines = ["flowchart LR"];
  const byRepo = new Map<string, string[]>();
  for (const f of shown) {
    const repo = m.repoOf(f);
    const count = m.symbolCount(f);
    (byRepo.get(repo) ?? byRepo.set(repo, []).get(repo)!).push(`${id.get(f)}["${mmd(shortPath(f))}<br/><small>${count} symbols</small>"]`);
  }
  let r = 0;
  for (const [repo, nodes] of byRepo) {
    if (repo) lines.push(`  subgraph r${r++}["${mmd(repo)}"]`);
    for (const n of nodes) lines.push(`${repo ? "    " : "  "}${n}`);
    if (repo) lines.push("  end");
  }
  for (const l of links.values()) if (id.has(l.from) && id.has(l.to)) lines.push(`  ${id.get(l.from)} ${l.inferred ? "==>" : "-->"} ${id.get(l.to)}`);
  lines.push("  classDef onpath stroke-width:3px");
  const path = shown.filter((f) => onPath.has(f)).map((f) => id.get(f));
  if (path.length) lines.push(`  class ${path.join(",")} onpath`);
  const info: Record<string, NodeInfo> = {};
  for (const f of shown) info[id.get(f)!] = { title: f, kind: "file" };
  return { source: lines.join("\n"), info };
}
