// Levels: which steps to show when the viewer hides helpers with few steps beneath them. Pure; no DOM.
import type { CodeMapDocument } from "../../pagedata";
import type { PathStep } from "../../types";

/** The choices in the levels control: 0 shows every step. */
export const LEVELS = [0, 1, 3, 5, 10] as const;

/** Where a step sits in the walk's tree, by 0-based step index. */
export interface StepLevel {
  index: number;
  parent?: number;
  /** Every step beneath this one, transitively. */
  descendants: number;
}

/** Parents and descendant counts from the walk itself, for documents that don't carry them (version 1). */
export function levelsFromWalk(steps: Pick<PathStep, "index" | "parent">[]): StepLevel[] {
  const parent = new Map(steps.map((s) => [s.index, s.parent]));
  const descendants = new Map(steps.map((s) => [s.index, 0]));
  for (const s of steps) {
    const seen = new Set<number>();
    for (let p = s.parent; p !== undefined && !seen.has(p); p = parent.get(p)) {
      seen.add(p);
      descendants.set(p, (descendants.get(p) ?? 0) + 1);
    }
  }
  return steps.map((s) => ({ index: s.index, ...(s.parent !== undefined && { parent: s.parent }), descendants: descendants.get(s.index)! }));
}

type LeveledStep = { step: number; parent?: number; descendants?: number };

/** The document's own `parent` and `descendants` (1-based, version 2), or the same computed from the walk. */
export function stepLevels(doc: Pick<CodeMapDocument, "system" | "render">): StepLevel[] {
  const steps = doc.system.steps as LeveledStep[];
  if (steps.length && steps.every((s) => typeof s.descendants === "number")) {
    return steps.map((s) => ({ index: s.step - 1, ...(s.parent !== undefined && { parent: s.parent - 1 }), descendants: s.descendants! }));
  }
  return levelsFromWalk(doc.render.walkthrough.steps);
}

/**
 * Steps shown at a threshold: roots, steps with at least `min` steps beneath them, and everything under an
 * expanded step. Ancestors of a shown step always have more steps beneath them, so they show too.
 */
export function visibleSteps(levels: StepLevel[], min: number, expanded: Iterable<number> = []): Set<number> {
  if (min <= 0) return new Set(levels.map((l) => l.index));
  const open = new Set(expanded);
  const byIndex = new Map(levels.map((l) => [l.index, l]));
  const shown = new Map<number, { shown: boolean; revealed: boolean }>();
  const visit = (i: number): { shown: boolean; revealed: boolean } => {
    const known = shown.get(i);
    if (known) return known;
    const l = byIndex.get(i)!;
    let out = { shown: true, revealed: false };
    if (l.parent !== undefined && l.descendants < min) {
      const p = visit(l.parent);
      const reveal = p.shown && (open.has(l.parent) || p.revealed);
      out = { shown: reveal, revealed: reveal };
    }
    shown.set(i, out);
    return out;
  };
  return new Set(levels.filter((l) => visit(l.index).shown).map((l) => l.index));
}

/** For each shown step, the hidden steps beneath it (whole hidden subtrees), in walk order. */
export function hiddenGroups(levels: StepLevel[], visible: Set<number>): Map<number, number[]> {
  const byIndex = new Map(levels.map((l) => [l.index, l]));
  const groups = new Map<number, number[]>();
  for (const l of [...levels].sort((a, b) => a.index - b.index)) {
    if (visible.has(l.index)) continue;
    let a = l.parent;
    while (a !== undefined && !visible.has(a)) a = byIndex.get(a)?.parent;
    if (a === undefined) continue;
    (groups.get(a) ?? groups.set(a, []).get(a)!).push(l.index);
  }
  return groups;
}
