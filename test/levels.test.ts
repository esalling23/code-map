import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../src/analyze";
import { describeHeuristic } from "../src/describe";
import { buildDocument, pathView, type CodeMapDocument } from "../src/pagedata";
import { tracePath } from "../src/trace";
import { hiddenGroups, levelsFromWalk, stepLevels, visibleSteps } from "../src/viewer/levels/levels";

// 0 ─┬─ 1 ─┬─ 2 ── 3
//    │     └─ 4
//    ├─ 5
//    └─ 6 ── 7
// 8 (a separate start)
const parents = [undefined, 0, 1, 2, 1, 0, 0, 6, undefined];
const walkSteps = parents.map((parent, index) => ({ index, ...(parent !== undefined && { parent }) }));

/** A hand-made document with only what the levels helpers read; `explicit` adds version-2 fields. */
function handMade(explicit: boolean) {
  const descendants = [7, 3, 1, 0, 0, 0, 1, 0, 0];
  return {
    system: { steps: parents.map((p, i) => ({ step: i + 1, ...(explicit && { descendants: descendants[i], ...(p !== undefined && { parent: p + 1 }) }) })) },
    render: { walkthrough: { steps: walkSteps } },
  } as unknown as CodeMapDocument;
}

describe("levels", () => {
  test("the version-1 fallback computes the same parents and descendants as the explicit fields", () => {
    const explicit = stepLevels(handMade(true));
    expect(explicit.map((l) => l.descendants)).toEqual([7, 3, 1, 0, 0, 0, 1, 0, 0]);
    expect(explicit[3].parent).toBe(2);
    expect(explicit[8].parent).toBeUndefined();
    expect(stepLevels(handMade(false))).toEqual(explicit);
    expect(levelsFromWalk(walkSteps)).toEqual(explicit);
  });

  test("the explicit fields win over the walk when present", () => {
    const doc = handMade(true);
    (doc.system.steps[5] as { descendants?: number }).descendants = 7;
    expect(stepLevels(doc)[5].descendants).toBe(7);
  });

  test("a threshold hides leaves and helpers, and keeps the roots and step numbers", () => {
    const levels = stepLevels(handMade(false));
    expect([...visibleSteps(levels, 0)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...visibleSteps(levels, 1)].sort()).toEqual([0, 1, 2, 6, 8]);
    expect([...visibleSteps(levels, 3)].sort()).toEqual([0, 1, 8]);
    // Roots stay even when nothing is beneath them.
    expect([...visibleSteps(levels, 10)].sort()).toEqual([0, 8]);
  });

  test("hidden steps are counted under the nearest shown step, and expanding one shows them", () => {
    const levels = stepLevels(handMade(false));
    const at3 = visibleSteps(levels, 3);
    expect(Object.fromEntries(hiddenGroups(levels, at3))).toEqual({ 0: [5, 6, 7], 1: [2, 3, 4] });
    const opened = visibleSteps(levels, 3, [1]);
    expect([...opened].sort()).toEqual([0, 1, 2, 3, 4, 8]);
    expect(Object.fromEntries(hiddenGroups(levels, opened))).toEqual({ 0: [5, 6, 7] });
    expect(hiddenGroups(levels, visibleSteps(levels, 0)).size).toBe(0);
  });
});

describe("filtered call path", () => {
  const map = analyze(join(import.meta.dir, "fixture"));
  const doc = buildDocument(map, describeHeuristic(map, tracePath(map, "src/server.ts#handlePost")));
  const levels = stepLevels(doc);
  const all = new Set(levels.map((l) => l.index));

  test("with every step shown it is the document's own diagrams and route", () => {
    const view = pathView(doc, { visible: all });
    expect(view.path).toBe(doc.render.diagrams.path);
    expect(view.route).toBe(doc.render.route);
  });

  test("hidden steps leave the diagram and route; shown ones keep their numbers", () => {
    const visible = visibleSteps(levels, 1);
    const hidden = hiddenGroups(levels, visible);
    expect(visible.size).toBeLessThan(levels.length);
    const view = pathView(doc, { visible, hidden });
    for (const l of levels) {
      const node = new RegExp(`\\bs${l.index}\\["`);
      expect(node.test(view.path.source)).toBe(visible.has(l.index));
      expect(view.route.some((r) => r.id === `s${l.index}`)).toBe(visible.has(l.index));
    }
    expect(view.path.source).toContain(`s1["2. OrderService.place()"]`);
    for (const [p, steps] of hidden) {
      expect(view.path.source).toContain(`h${p}(["${steps.length} hidden"])`);
      expect(view.path.info[`h${p}`].kind).toBe("hidden");
    }
    expect(view.compact.source).not.toMatch(/\bd\d+\[\(/);
  });
});
