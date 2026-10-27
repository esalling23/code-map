import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../src/analyze";
import { buildDocument, toDocument } from "../src/pagedata";
import { walkMap } from "../src/pipeline";
import { tracePath } from "../src/trace";

const fixture = join(import.meta.dir, "fixture");
const map = analyze(fixture);

describe("a complete, deterministic map", () => {
  test("two builds from the same code and arguments are byte-identical", () => {
    const build = () => JSON.stringify(buildDocument(analyze(fixture), walkMap(analyze(fixture), { entry: "handlePost" }).walk, { args: ["test/fixture", "-e", "handlePost"] }), null, 2);
    const first = build();
    expect(build()).toBe(first);
    expect(first).not.toContain("generatedAt");
    expect(first).not.toContain("truncated");
  });

  test("descendants counts every step beneath, under first callers only", () => {
    // handlePost → OrderService.place → { validate, orderTotal → lineTotal, OrderRepo.save }
    const walk = tracePath(map, "src/server.ts#handlePost");
    const levels = walk.steps.map((s) => [map.symbols[s.symbolId].name, s.parent, s.descendants]);
    expect(levels).toEqual([
      ["handlePost", undefined, 5],
      ["OrderService.place", 0, 4],
      ["validate", 1, 0],
      ["orderTotal", 1, 1],
      ["lineTotal", 3, 0],
      ["OrderRepo.save", 1, 0],
    ]);
    expect(walk.steps[0].descendants).toBe(walk.steps.length - 1);
    const parents = new Set(walk.steps.map((s) => s.parent));
    for (const s of walk.steps) if (!parents.has(s.index)) expect(s.descendants).toBe(0);
  });

  test("the system section numbers parents from 1 and carries descendants", () => {
    const doc = buildDocument(map, tracePath(map, "src/server.ts#handlePost"));
    expect(doc.system.steps.map((s) => [s.step, s.parent, s.descendants])).toEqual([
      [1, undefined, 5],
      [2, 1, 4],
      [3, 2, 0],
      [4, 2, 1],
      [5, 4, 0],
      [6, 2, 0],
    ]);
    expect(doc.render.walkthrough.steps[1].descendants).toBe(4);
  });

  test("a walk over the safety cap fails instead of writing a partial map", () => {
    expect(() => tracePath(map, "src/server.ts#handlePost", { stepCap: 3 })).toThrow("passed 3 steps");
    expect(tracePath(map, "src/server.ts#handlePost", { stepCap: 6 }).steps).toHaveLength(6);
  });

  test("a version-1 document still loads, with its step levels filled in", () => {
    const v2 = buildDocument(map, tracePath(map, "src/server.ts#handlePost"));
    // A version-1 file: a clock, `truncated`, and no step levels.
    const v1 = JSON.parse(JSON.stringify(v2));
    v1.version = 1;
    v1.generatedAt = "2025-01-01T00:00:00.000Z";
    v1.system.truncated = false;
    v1.render.walkthrough.truncated = false;
    for (const s of v1.system.steps) delete s.parent, delete s.descendants;
    for (const s of v1.render.walkthrough.steps) delete s.descendants;

    const doc = toDocument(v1);
    expect(doc.version).toBe(2);
    expect("generatedAt" in doc).toBe(false);
    expect("truncated" in doc.system).toBe(false);
    expect("truncated" in doc.render.walkthrough).toBe(false);
    expect(doc.system.steps.map((s) => [s.parent, s.descendants])).toEqual(v2.system.steps.map((s) => [s.parent, s.descendants]));
    expect(doc.render.walkthrough.steps.map((s) => s.descendants)).toEqual([5, 4, 0, 1, 0, 0]);
  });

  test("an old raw dump still loads: its `truncated` flag goes and its step levels are filled in", () => {
    const walk = tracePath(map, "src/server.ts#handlePost");
    const old = { ...walk, truncated: false, steps: walk.steps.map(({ descendants: _, ...s }) => s) };
    const doc = toDocument({ map, walkthrough: old });
    expect("truncated" in doc.render.walkthrough).toBe(false);
    expect(doc.system.steps.map((s) => s.descendants)).toEqual(walk.steps.map((s) => s.descendants));
  });
});
