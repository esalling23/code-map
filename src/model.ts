// One traced path as a model: the map and the walkthrough, with the lookups the document, the descriptions and the context share, built once.
// Worth it: one document build used to recompute the data ids five times, scan every step per data type, and scan every symbol per file.
// Free functions stay free when they only read a symbol or a step by position, which costs nothing to repeat:
// stepFacts, defaultTitle and routeOf (callers pass a bare `{ symbols }` map) and the Mermaid line writers.
// No Node APIs: anything that reads files (context docs, readDescriptions) stays outside, since the viewer bundles this.
import type { CodeMap, CodeSymbol, PathStep, RepoRoot, Walkthrough } from "./types";

/** Data types the steps use, then the selection's, without repeats, in first-use order. */
export const dataIdsOf = (walk: Pick<Walkthrough, "steps" | "selection">) => [...new Set([...walk.steps.flatMap((s) => s.dataUsed.map((d) => d.id)), ...(walk.selection?.data ?? [])])];

/**
 * How many steps sit beneath each step in the step tree (all levels), by position. Steps are in walk order,
 * so a parent always comes before its children and one pass from the end adds up each subtree.
 */
export function descendantCounts(steps: Pick<PathStep, "parent">[]): number[] {
  const counts = steps.map(() => 0);
  for (let i = steps.length - 1; i >= 0; i--) {
    const p = steps[i].parent;
    if (p !== undefined) counts[p] += counts[i] + 1;
  }
  return counts;
}

export interface Model {
  map: CodeMap;
  walk: Walkthrough;
  symbolOf(step: PathStep): CodeSymbol;
  /** The step that calls this one, if any. */
  parentOf(step: PathStep): PathStep | undefined;
  /** Position in `walk.steps` of the first step for a symbol, or undefined when it isn't on the path. */
  stepIndexOf(symbolId: string): number | undefined;
  stepOf(symbolId: string): PathStep | undefined;
  /** Data types the steps use, then the selection's, without repeats, in first-use order. */
  dataIds: string[];
  /** Step indexes (0-based, in step order) that use a data type. */
  usersOf(dataId: string): number[];
  /** Files the steps are in, in step order. */
  filesOnPath: Set<string>;
  /** The repo root a file is under: the labelled root it starts with, else the unlabelled one. */
  rootOf(file: string): RepoRoot | undefined;
  /** Repo label of a file, or "" when only one repo was analyzed. */
  repoOf(file: string): string;
  /** How many symbols a file has, not counting its top-level code. */
  symbolCount(file: string): number;
}

export function createModel(map: CodeMap, walk: Walkthrough): Model {
  const stepIndex = new Map<string, number>();
  walk.steps.forEach((s, i) => stepIndex.has(s.symbolId) || stepIndex.set(s.symbolId, i));

  const dataIds = dataIdsOf(walk);
  const users = new Map<string, number[]>(dataIds.map((id) => [id, []]));
  for (const s of walk.steps) for (const id of new Set(s.dataUsed.map((d) => d.id))) users.get(id)?.push(s.index);

  const filesOnPath = new Set(walk.steps.map((s) => map.symbols[s.symbolId].file));

  const labelled = new Map<string, RepoRoot | undefined>();
  const labelledRoot = (file: string) => {
    if (!labelled.has(file)) labelled.set(file, map.roots.find((r) => r.label && file.startsWith(`${r.label}/`)));
    return labelled.get(file);
  };
  const unlabelled = map.roots.find((r) => !r.label);

  // Only the files diagram counts symbols, so this index waits until it is first asked for.
  let counts: Map<string, number> | undefined;
  const countSymbols = () => {
    const c = new Map<string, number>();
    for (const s of Object.values(map.symbols)) if (s.kind !== "module") c.set(s.file, (c.get(s.file) ?? 0) + 1);
    return c;
  };

  return {
    map,
    walk,
    symbolOf: (step) => map.symbols[step.symbolId],
    parentOf: (step) => (step.parent !== undefined ? walk.steps[step.parent] : undefined),
    stepIndexOf: (symbolId) => stepIndex.get(symbolId),
    stepOf: (symbolId) => {
      const i = stepIndex.get(symbolId);
      return i === undefined ? undefined : walk.steps[i];
    },
    dataIds,
    usersOf: (dataId) => users.get(dataId) ?? [],
    filesOnPath,
    rootOf: (file) => labelledRoot(file) ?? unlabelled,
    repoOf: (file) => labelledRoot(file)?.label ?? "",
    symbolCount: (file) => (counts ??= countSymbols()).get(file) ?? 0,
  };
}
