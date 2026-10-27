import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../src/analyze";
import { createModel, dataIdsOf } from "../src/model";
import { resolveEntry, resolveSelection, tracePath } from "../src/trace";

const map = analyze(join(import.meta.dir, "fixture"));
const walk = tracePath(map, "src/server.ts#handlePost");
const m = createModel(map, walk);

describe("model indexes", () => {
  test("finds a step by symbol id, and nothing for a symbol off the path", () => {
    for (const [i, s] of walk.steps.entries()) {
      expect(m.stepIndexOf(s.symbolId)).toBe(i);
      expect(m.stepOf(s.symbolId)).toBe(s);
    }
    expect(m.stepIndexOf("src/types.ts#Order")).toBeUndefined();
    expect(m.stepOf("nope#x")).toBeUndefined();
  });

  test("a symbol on the path twice resolves to its first step, like findIndex", () => {
    const twice = { ...walk, steps: [...walk.steps, { ...walk.steps[1], index: walk.steps.length }] };
    expect(createModel(map, twice).stepIndexOf(walk.steps[1].symbolId)).toBe(1);
  });

  test("gives each step's symbol and parent step", () => {
    for (const s of walk.steps) {
      expect(m.symbolOf(s)).toBe(map.symbols[s.symbolId]);
      expect(m.parentOf(s)).toBe(s.parent === undefined ? undefined : walk.steps[s.parent]);
    }
    expect(m.parentOf(walk.steps[0])).toBeUndefined();
  });

  test("lists the data ids once, in first-use order, and the steps that use each", () => {
    expect(m.dataIds).toEqual(dataIdsOf(walk));
    expect(m.dataIds.length).toBeGreaterThan(0);
    for (const id of m.dataIds) {
      expect(m.usersOf(id)).toEqual(walk.steps.filter((s) => s.dataUsed.some((d) => d.id === id)).map((s) => s.index));
    }
    expect(m.usersOf("nope#x")).toEqual([]);
  });

  test("includes the selection's data even when no step uses it", () => {
    const sel = tracePath(map, undefined, { select: resolveSelection(map, ["handlePost", "OrderRepo.save", "src/types.ts#Order"]) });
    expect(createModel(map, sel).dataIds).toContain("src/types.ts#Order");
  });

  test("lists the files on the path in step order", () => {
    expect([...m.filesOnPath]).toEqual([...new Set(walk.steps.map((s) => map.symbols[s.symbolId].file))]);
  });

  test("counts a file's symbols without its top-level code", () => {
    for (const f of map.files) expect(m.symbolCount(f)).toBe(Object.values(map.symbols).filter((s) => s.file === f && s.kind !== "module").length);
    expect(m.symbolCount("nope.ts")).toBe(0);
  });

  test("with one repo, every file is in the unlabelled root and has no repo label", () => {
    expect(m.repoOf("src/server.ts")).toBe("");
    expect(m.rootOf("src/server.ts")).toBe(map.roots[0]);
  });
});

describe("model indexes across repos", () => {
  const multi = analyze([join(import.meta.dir, "multi/app"), join(import.meta.dir, "multi/lib")]);
  const mm = createModel(multi, tracePath(multi, resolveEntry(multi, "checkout")));

  test("gives each file its repo label and root", () => {
    expect(mm.repoOf("app/src/main.ts")).toBe("app");
    expect(mm.repoOf("lib/src/index.ts")).toBe("lib");
    expect(mm.rootOf("lib/src/index.ts")).toBe(multi.roots[1]);
    expect(mm.repoOf("other/x.ts")).toBe("");
    expect(mm.rootOf("other/x.ts")).toBeUndefined();
  });
});
