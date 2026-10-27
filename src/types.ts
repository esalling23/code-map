export type SymbolKind = "module" | "function" | "method" | "class" | "data";

export interface CodeSymbol {
  /** Stable id: `<file>#<name>`, e.g. `src/server.ts#Server.handle`. With several repos, `<file>` starts with the repo label. */
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  /** Label of the repo the symbol came from; empty when only one repo was analyzed. */
  repo: string;
  startLine: number;
  endLine: number;
  signature: string;
  doc: string;
  code: string;
  exported: boolean;
  /** Calls this symbol makes that resolve outside the analyzed sources (libraries, globals). */
  externalCalls: { text: string; line: number }[];
}

export interface CallEdge {
  from: string;
  to: string;
  line: number;
  order: number;
  /** True when the target was matched by package and name (e.g. a call into another repo's built package). */
  inferred?: boolean;
}

export type DataRelation = "param" | "returns" | "uses" | "creates";

export interface DataEdge {
  from: string;
  to: string;
  relation: DataRelation;
}

export interface ImportEdge {
  from: string;
  to: string;
}

export interface RepoRoot {
  label: string;
  dir: string;
}

export interface CodeMap {
  roots: RepoRoot[];
  files: string[];
  /** The comment at the top of each file, when it has one. */
  fileDocs: Record<string, string>;
  symbols: Record<string, CodeSymbol>;
  calls: CallEdge[];
  data: DataEdge[];
  imports: ImportEdge[];
}

export interface StepCall {
  to: string;
  /** Line in the calling step's code where the call (or the first hop of a `via` chain) happens. */
  line: number;
  /** Index of the step that explains this call (first visit, or an earlier step when revisited). */
  step?: number;
  /** Unselected symbols the call passed through to reach `to`, in order. */
  via: string[];
  inferred?: boolean;
}

export interface PathStep {
  index: number;
  symbolId: string;
  depth: number;
  /**
   * Index of the step that first called this one. A step reached from several callers sits
   * under its first caller only; later callers link back to it through `StepCall.step`.
   */
  parent?: number;
  /** How many steps sit beneath this one in the step tree (children, their children, and so on), counted under first parents only. */
  descendants: number;
  callLine?: number;
  via: string[];
  calls: StepCall[];
  dataUsed: { id: string; relation: DataRelation }[];
  description: string;
}

/** A part of the system the path runs through: a folder with its own docs, or a top-level folder. */
export interface SystemArea {
  id: string;
  name: string;
  repo: string;
  steps: number[];
  files: string[];
  /** What the repo's own docs say about this area. */
  doc: string;
  /** Where `doc` came from, e.g. `src/modules/deploy/ARCHITECTURE.md`. */
  docSource: string;
  /** What this area does on this path (written by Claude with --llm; otherwise empty). */
  description: string;
}

export interface SystemContext {
  repos: { label: string; name: string; description: string }[];
  areas: SystemArea[];
  /** Calls that cross from one area into another, in walkthrough order. */
  handoffs: { from: string; to: string; fromStep: number; step: number }[];
  /** Area id of each step, by step index. */
  areaOfStep: string[];
  /** What the code does overall. */
  summary: string;
  /** Which part of the system this is and why it matters. */
  role: string;
}

export interface Walkthrough {
  entry: string;
  overview: string;
  steps: PathStep[];
  /** Never set: the walk follows every call in scope. Old raw dumps may still carry it. */
  truncated?: boolean;
  /** Set when the walkthrough is limited to a selection of symbols. */
  selection?: { ids: string[]; data: string[] };
  context?: SystemContext;
  /** Connections the code analysis can't see (HTTP, queues, storage), by step index. */
  links?: { from: number; to: number; label: string }[];
}
