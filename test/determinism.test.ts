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

  test("a version-1 document is refused with a message to build it again", () => {
    const v1 = { ...JSON.parse(JSON.stringify(buildDocument(map, tracePath(map, "src/server.ts#handlePost")))), version: 1 };
    expect(() => toDocument(v1)).toThrow("Build the map again");
  });
});
