import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../src/analyze";
import { applyDescriptions, buildTemplate } from "../src/authored";
import { describeHeuristic } from "../src/describe";
import { readFileSync } from "node:fs";
import { excerpt, shortPath } from "../src/viewer/text";
import { renderMapHtml } from "../src/viewer/ssr";
import { buildDocument, routeOf } from "../src/pagedata";
import { entryCandidates, readSelectionSpecs, resolveEntry, resolveSelection, tracePath } from "../src/trace";

const map = analyze(join(import.meta.dir, "fixture"));
const renderHtml = (...args: Parameters<typeof buildDocument>) => renderMapHtml(buildDocument(...args));
const css = readFileSync(join(import.meta.dir, "../src/viewer/page.css"), "utf8");

describe("analyze", () => {
  test("indexes functions, methods, classes and data", () => {
    const kinds = Object.fromEntries(Object.values(map.symbols).map((s) => [s.id, s.kind]));
    expect(kinds["src/server.ts#handlePost"]).toBe("function");
    expect(kinds["src/service.ts#OrderService.place"]).toBe("method");
    expect(kinds["src/pricing.ts#lineTotal"]).toBe("function");
    expect(kinds["src/repo.ts#OrderRepo"]).toBe("class");
    expect(kinds["src/types.ts#Order"]).toBe("data");
    expect(kinds["src/types.ts#OrderRequest"]).toBe("data");
    expect(map.symbols["src/repo.ts#OrderRepo.save"].doc).toBe("Saves an order and returns it.");
  });

  test("resolves calls across imports, through this. and new", () => {
    const has = (from: string, to: string) => map.calls.some((c) => c.from === from && c.to === to);
    expect(has("src/server.ts#handlePost", "src/service.ts#OrderService.place")).toBe(true);
    expect(has("src/service.ts#OrderService.place", "src/repo.ts#OrderRepo.save")).toBe(true);
    expect(has("src/service.ts#OrderService.place", "src/service.ts#validate")).toBe(true);
    expect(has("src/pricing.ts#orderTotal", "src/pricing.ts#lineTotal")).toBe(true);
    expect(has("src/server.ts#<module>", "src/service.ts#OrderService.constructor")).toBe(true);
  });

  test("records data edges by relation", () => {
    const rel = (from: string, to: string) => map.data.filter((d) => d.from === from && d.to === to).map((d) => d.relation);
    expect(rel("src/service.ts#OrderService.place", "src/types.ts#OrderRequest")).toContain("param");
    expect(rel("src/service.ts#OrderService.place", "src/types.ts#Order")).toContain("returns");
    expect(rel("src/service.ts#OrderService.constructor", "src/repo.ts#OrderRepo")).toContain("creates");
  });

  test("records external calls and file imports", () => {
    expect(map.symbols["src/server.ts#handlePost"].externalCalls.map((c) => c.text)).toContain("JSON.parse");
    expect(map.imports).toContainEqual({ from: "src/service.ts", to: "src/pricing.ts" });
  });

  test("drops module pseudo-symbols with no top-level behaviour", () => {
    expect(map.symbols["src/types.ts#<module>"]).toBeUndefined();
    expect(map.symbols["src/server.ts#<module>"]).toBeDefined();
  });
});

describe("trace", () => {
  test("resolves entry specs", () => {
    expect(resolveEntry(map, "handlePost")).toBe("src/server.ts#handlePost");
    expect(resolveEntry(map, "OrderService.place")).toBe("src/service.ts#OrderService.place");
    expect(resolveEntry(map, "server.ts")).toBe("src/server.ts#<module>");
    expect(() => resolveEntry(map, "nope")).toThrow();
  });

  test("picks the top-level server code as the best entry", () => {
    expect(entryCandidates(map)[0].id).toBe("src/server.ts#<module>");
  });

  test("walks the call graph depth-first in source order", () => {
    const walk = tracePath(map, "src/server.ts#handlePost");
    expect(walk.steps.map((s) => map.symbols[s.symbolId].name)).toEqual([
      "handlePost",
      "OrderService.place",
      "validate",
      "orderTotal",
      "lineTotal",
      "OrderRepo.save",
    ]);
    expect(walk.steps[4].parent).toBe(3);
    expect(walk.truncated).toBeUndefined();
  });

  test("follows every reachable call: each call leads to a step", () => {
    const walk = tracePath(map, "src/server.ts#<module>");
    expect(walk.steps.flatMap((s) => s.calls).every((c) => c.step !== undefined)).toBe(true);
  });
});

describe("describe + render", () => {
  const walk = describeHeuristic(map, tracePath(map, "src/server.ts#handlePost"));

  test("describes each step from docs, callers, data and calls", () => {
    const place = walk.steps[1].description;
    expect(place).toContain("Validates the request, prices it and stores the order.");
    expect(place).toContain("Called by `handlePost` (step 1)");
    expect(place).toContain("Takes `OrderRequest` as input.");
    expect(place).toContain("Returns `Order`.");
    expect(place).toContain("`validate` (step 3)");
    expect(walk.overview).toContain("6 functions in 4 files");
  });

  test("renders a diagram and side-by-side steps", () => {
    const html = renderHtml(map, walk);
    expect(html).toContain("flowchart TD");
    expect(html).toContain('id="step-6"');
    expect(html).toContain('<span class="jumps"><a class="badge" href="#step-2" title="Go to step 2">→ 2</a></span>');
    expect(html).not.toContain('class="ln ext"');
    expect(html).toContain("subgraph");
    expect(html).toContain('data-key="data:src/types.ts#Order"');
    expect(html).toContain('data-open="call:src/service.ts#OrderService.place"');
    // Tab panels are built when first opened: only the first tab of each set has content.
    expect(html).toContain('<div class="tabpanel" role="tabpanel" hidden=""></div>');
    expect(html).not.toContain("<template");
  });

  test("excerpts long functions around the focus lines", () => {
    const sym = { ...map.symbols["src/server.ts#handlePost"], code: Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n"), startLine: 1 };
    const lines = excerpt(sym, [50]);
    expect(lines.some((l) => l.line === 50)).toBe(true);
    expect(lines.some((l) => l.gap)).toBe(true);
    expect(lines.length).toBeLessThan(25);
  });
});

describe("selection", () => {
  test("only selected symbols become steps; skipped calls collapse into via chains", () => {
    const select = resolveSelection(map, ["handlePost", "OrderRepo.save"]);
    const walk = tracePath(map, undefined, { select });
    expect(walk.steps.map((s) => map.symbols[s.symbolId].name)).toEqual(["handlePost", "OrderRepo.save"]);
    const call = walk.steps[0].calls[0];
    expect(call.to).toBe("src/repo.ts#OrderRepo.save");
    expect(call.via).toEqual(["src/service.ts#OrderService.place"]);
    expect(call.line).toBe(6);
    expect(walk.steps[1].parent).toBe(0);
  });

  test("globs and file paths expand to every match", () => {
    expect(resolveSelection(map, ["OrderService.*"]).sort()).toEqual(["src/service.ts#OrderService.constructor", "src/service.ts#OrderService.place"]);
    expect(resolveSelection(map, ["src/*.ts#*Total"]).sort()).toEqual(["src/pricing.ts#lineTotal", "src/pricing.ts#orderTotal"]);
    expect(resolveSelection(map, ["pricing.ts"]).sort()).toEqual(["src/pricing.ts#lineTotal", "src/pricing.ts#orderTotal"]);
    expect(() => resolveSelection(map, ["Nope.*"])).toThrow();
  });

  test("selected symbols the walk never reaches start their own segment", () => {
    const select = resolveSelection(map, ["validate", "lineTotal"]);
    const walk = tracePath(map, undefined, { select });
    expect(walk.steps.map((s) => map.symbols[s.symbolId].name)).toEqual(["validate", "lineTotal"]);
    expect(walk.steps.every((s) => s.parent === undefined)).toBe(true);
    expect(describeHeuristic(map, walk).steps[1].description).toContain("starts a separate part of the path");
  });

  test("an unselected entry leads into the selection", () => {
    const select = resolveSelection(map, ["orderTotal", "OrderRepo.save"]);
    const walk = tracePath(map, "src/server.ts#handlePost", { select });
    expect(walk.steps.map((s) => map.symbols[s.symbolId].name)).toEqual(["orderTotal", "OrderRepo.save"]);
    expect(walk.steps[0].via).toEqual(["src/server.ts#handlePost", "src/service.ts#OrderService.place"]);
  });

  test("reads specs from a file, inline lists and JSON, and keeps selected data types", () => {
    const specs = readSelectionSpecs([join(import.meta.dir, "selection.txt"), "lineTotal, orderTotal", '["validate"]']);
    expect(specs).toEqual(["handlePost", "OrderRepo.save", "src/types.ts#Order", "lineTotal", "orderTotal", "validate"]);
    const walk = describeHeuristic(map, tracePath(map, undefined, { select: resolveSelection(map, specs.slice(0, 3)) }));
    expect(walk.selection?.data).toEqual(["src/types.ts#Order"]);
    const html = renderHtml(map, walk);
    expect(html).toContain("s0 --&gt;|&quot;via place&quot;| s1");
    expect(html).toContain("via <code>OrderService.place</code>");
    expect(html).toContain("selection: 2 functions, 1 data types");
  });
});

describe("multiple repos", () => {
  const multi = analyze([join(import.meta.dir, "multi/app"), join(import.meta.dir, "multi/lib")]);

  test("labels files by repo", () => {
    expect(multi.roots.map((r) => r.label)).toEqual(["app", "lib"]);
    expect(multi.files).toEqual(["app/src/main.ts", "lib/src/index.ts"]);
    expect(multi.symbols["lib/src/index.ts#Ledger.record"].repo).toBe("lib");
  });

  test("links calls into another repo's built package to its source by name", () => {
    const linked = multi.calls.filter((c) => c.from === "app/src/main.ts#checkout");
    expect(linked.map((c) => [c.to, !!c.inferred])).toEqual([
      ["lib/src/index.ts#Ledger", true],
      ["lib/src/index.ts#Ledger.record", true],
      ["lib/src/index.ts#audit", true],
      ["app/src/main.ts#finish", false],
    ]);
  });

  test("walks across repos and groups the diagram by repo", () => {
    const walk = describeHeuristic(multi, tracePath(multi, resolveEntry(multi, "checkout")));
    expect(walk.steps.map((s) => multi.symbols[s.symbolId].name)).toEqual(["checkout", "Ledger", "Ledger.record", "log", "audit", "finish"]);
    expect(walk.steps[2].description).toContain("from the `app` repo");
    expect(walk.overview).toContain("across 2 repos");
    const html = renderHtml(multi, walk);
    expect(html).toContain('subgraph r0[&quot;app&quot;]');
    expect(html).toContain("s0 ==&gt; s2");
  });

  test("a local helper is never linked by name to a same-named function", () => {
    expect(multi.calls.filter((c) => c.from === "app/src/main.ts#refund")).toEqual([]);
    expect(multi.symbols["app/src/main.ts#refund"].externalCalls.map((c) => c.text)).toEqual(["finish"]);
  });

  test("a single repo is not linked to packages it doesn't contain", () => {
    const app = analyze(join(import.meta.dir, "multi/app"));
    expect(app.calls.filter((c) => c.from === "src/main.ts#checkout").map((c) => c.to)).toEqual(["src/main.ts#finish"]);
    expect(app.symbols["src/main.ts#checkout"].externalCalls.map((c) => c.text)).toContain("ledger.record");
  });
});

describe("system context", () => {
  const shop = analyze(join(import.meta.dir, "areas"));
  const walk = describeHeuristic(shop, tracePath(shop, resolveEntry(shop, "Orders.place")));
  const ctx = walk.context!;

  test("groups steps into areas in the order the path reaches them", () => {
    expect(ctx.areas.map((a) => a.name)).toEqual(["orders", "payments", "audit"]);
    expect(ctx.areaOfStep).toEqual(["src/modules/orders", "src/modules/payments", "src/modules/audit"]);
    expect(ctx.handoffs.map((h) => `${h.from}>${h.to}`)).toEqual(["src/modules/orders>src/modules/payments", "src/modules/payments>src/modules/audit"]);
  });

  test("quotes each area's docs from the best source available", () => {
    const [orders, payments, audit] = ctx.areas;
    expect(orders.doc).toBe("orders — Takes and stores orders");
    expect(orders.docSource).toBe("README.md › Modules");
    expect(payments.doc).toBe("Charges cards through the payment provider.");
    expect(payments.docSource).toBe("src/modules/payments/ARCHITECTURE.md");
    expect(audit.doc).toBe("Audit trail for every money movement.");
    expect(audit.docSource).toBe("header comment of src/modules/audit/audit.ts");
  });

  test("summarizes what the code does and where it sits", () => {
    expect(ctx.summary).toBe("Order intake. It starts in the **orders** area (orders — Takes and stores orders) and hands off to **payments** and **audit**.");
    expect(ctx.role).toBe("Part of **shop**: The shop service takes orders and charges cards for them.");
  });

  test("renders the intro, area tags, and a zoomable, hoverable diagram", () => {
    const html = renderHtml(shop, walk);
    expect(html).toContain('<li class="area" id="area-2">');
    expect(html).toContain("<strong>orders</strong> → <strong>payments</strong>");
    expect(html).toContain('href="#area-3">audit</a>');
    expect(html).toContain('data-zoom="fit"');
    expect(html).toContain('<div class="tip" hidden="">');
  });
});

describe("authored descriptions", () => {
  const shop = analyze(join(import.meta.dir, "areas"));
  const walk = describeHeuristic(shop, tracePath(shop, resolveEntry(shop, "Orders.place")));

  test("the template lists every step and area with facts and an empty description", () => {
    const t = buildTemplate(shop, walk);
    expect(t.steps.map((s) => s.id)).toEqual(["src/modules/orders/orders.ts#Orders.place", "src/modules/payments/charge.ts#charge", "src/modules/audit/audit.ts#audit"]);
    expect(t.steps[1]).toMatchObject({ step: 2, calledBy: "step 1 (Orders.place), line 6", calls: ["audit (step 3)"], description: "" });
    expect(t.steps[1].file).toBe("src/modules/payments/charge.ts:3-6");
    expect(t.areas[1]).toMatchObject({ id: "src/modules/payments", docs: "Charges cards through the payment provider.", description: "" });
  });

  test("written text replaces generated text; links become dashed arrows; mismatches warn", () => {
    const { walk: out, title, warnings } = applyDescriptions(shop, walk, {
      title: "How an order is paid",
      summary: "A customer places an order. The shop charges the card and writes an audit note.",
      areas: [{ id: "src/modules/payments", description: "Takes money from the card." }, { id: "nope", description: "x" }],
      steps: [
        { id: "src/modules/payments/charge.ts#charge", description: "Charges the card." },
        { step: 1, description: "Starts the order." },
        { id: "missing#fn", description: "x" },
      ],
      links: [{ from: 3, to: 1, label: "audit queue (HTTP)" }, { from: 9, to: 1, label: "bad" }],
    });
    expect(title).toBe("How an order is paid");
    expect(out.steps.map((s) => s.description).slice(0, 2)).toEqual(["Starts the order.", "Charges the card."]);
    expect(out.context!.summary).toBe("A customer places an order. The shop charges the card and writes an audit note.");
    expect(out.context!.areas[1].description).toBe("Takes money from the card.");
    expect(out.links).toEqual([{ from: 2, to: 0, label: "audit queue (HTTP)" }]);
    expect(warnings).toEqual([
      "No step matches missing#fn; its description was skipped.",
      "Steps without a written description (kept the generated text): 3.",
      'No area matches "nope".',
      'Link "bad" skipped: 9 is not a step on this path.',
    ]);
    const html = renderHtml(shop, out, { title });
    expect(html).toContain("s2 -. &quot;audit queue (HTTP)&quot; .-&gt; s0");
    expect(html).toContain("Connections outside the code");
    expect(html).toContain("<h1>How an order is paid</h1>");
  });
});

describe("diagram layout", () => {
  const doc = buildDocument(map, describeHeuristic(map, tracePath(map, "src/server.ts#handlePost")));
  const html = renderMapHtml(doc);
  const source = html.slice(html.indexOf('<pre class="mermaid">'), html.indexOf("</pre>"));

  test("a class with one method on the path keeps its full label and the file's box", () => {
    expect(source).toContain("subgraph f1[&quot;src/service.ts&quot;]");
    expect(source).toContain("s1[&quot;2. OrderService.place()&quot;]");
  });

  test("hover info gives every node and file box its full name", () => {
    const info = doc.render.diagrams.path.info;
    expect(info.s1).toEqual({ title: "2. OrderService.place", kind: "step" });
    expect(info.f1).toEqual({ title: "src/service.ts", kind: "file" });
    expect(Object.values(info).some((v: any) => v.kind === "data")).toBe(true);
  });

  test("shortens paths to folder and file", () => {
    expect(shortPath("game-manager/src/modules/deploy/static-game-storage.service.ts")).toBe("deploy/static-game-storage.service.ts");
    expect(shortPath("main.ts")).toBe("main.ts");
    expect(html).toContain('<span title="src/service.ts">src/service.ts</span>');
  });

  test("dead-end methods of one box are stacked in a grid with invisible links after the real arrows", () => {
    const wide = analyze(join(import.meta.dir, "fixture"));
    // Fake a class with five leaf methods called from one step.
    const walk = describeHeuristic(wide, tracePath(wide, "src/server.ts#handlePost"));
    const steps = ["a", "b", "c", "d", "e"].map((n, i) => {
      const id = `src/big.ts#Big.${n}`;
      wide.symbols[id] = { ...wide.symbols["src/repo.ts#OrderRepo.save"], id, name: `Big.${n}`, file: "src/big.ts" };
      return { ...walk.steps[5], index: 6 + i, symbolId: id, calls: [], dataUsed: [], parent: 0 };
    });
    walk.steps.push(...steps);
    walk.steps[0].calls.push(...steps.map((s) => ({ to: s.symbolId, line: 6, step: s.index, via: [] })));
    walk.context = undefined;
    const out = renderHtml(wide, walk);
    const src = out.slice(out.indexOf('<pre class="mermaid">'), out.indexOf("</pre>"));
    expect(src).toMatch(/subgraph f\d+\[&quot;&lt;b&gt;Big&lt;\/b&gt;&lt;br\/&gt;&lt;small&gt;src\/big.ts&lt;\/small&gt;&quot;\]/);
    expect(src).toContain("s6[&quot;7. a()&quot;]");
    expect(src).toContain("s6 ~~~ s9");
    expect(src).toContain("s7 ~~~ s10");
    expect(src.lastIndexOf("--&gt;")).toBeLessThan(src.indexOf("~~~"));
  });
});

describe("call path views", () => {
  const walk = describeHeuristic(map, tracePath(map, "src/server.ts#handlePost"));
  const html = renderHtml(map, walk);
  const sourceOf = (name: string) => {
    const at = html.indexOf(`id="tab-${name}"`);
    return html.slice(html.indexOf('<pre class="mermaid">', at), html.indexOf("</pre>", at));
  };

  test("compact mode is a second call path with no data types or data arrows", () => {
    const full = sourceOf("path");
    const compact = sourceOf("pathc");
    expect(full).toMatch(/d0\[\(/);
    expect(compact).not.toMatch(/\bd\d+\[\(/);
    expect(compact).not.toContain(".-&gt; d");
    expect(compact).toContain("s0 --&gt;");
    expect(html).toContain('id="tab-pathc" data-path-view="1" hidden=""');
    expect(html).toContain('data-mode="compact"');
    expect(html).toContain('data-path="full"');
    expect(html).toContain('data-nav="next"');
  });

  test("fading leaves highlighted boxes bright: the fade rule stays less specific than the highlight rules", () => {
    expect(css).toContain(".diagram.focusing g.node:where(:not(:has(g.node))){opacity:.25");
    expect(css).toContain(".diagram.pathing g.node:where(:not(:has(g.node))){opacity:.28");
  });

  test("the route gives each step the arrow into it, and the navigator stops only at functions and methods", () => {
    const route = routeOf(map, walk);
    expect(route[0]).toEqual({ id: "s0", from: null, nav: true });
    for (const [i, s] of walk.steps.entries()) expect(route[i].from).toBe(s.parent === undefined ? null : `s${s.parent}`);
    const linked = { ...walk, links: [{ from: 0, to: 2, label: "x" }], steps: walk.steps.map((s) => (s.index === 2 ? { ...s, parent: undefined } : s)) };
    expect(routeOf(map, linked)[2].from).toBe("s0");
  });
});

test("descriptions render `code`, **bold** and *italic*, but not a lone asterisk", () => {
  const walk = describeHeuristic(map, tracePath(map, "src/server.ts#handlePost"));
  walk.steps[0].description = "Saves the *phase slots* with **care** using `save()`; 2 * 3 stays.";
  const html = renderHtml(map, walk);
  expect(html).toContain("Saves the <em>phase slots</em> with <strong>care</strong> using <code>save()</code>; 2 * 3 stays.");
});
