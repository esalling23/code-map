import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../src/analyze";
import { applyDescriptions } from "../src/authored";
import { checkDescriptions, similarity } from "../src/check";
import { describeHeuristic } from "../src/describe";
import { buildDocument, toDocument } from "../src/pagedata";
import { resolveEntry, tracePath } from "../src/trace";
import { buildViewerHtml, embedDocument } from "../src/viewer/build";

const shop = analyze(join(import.meta.dir, "areas"));
const walk = describeHeuristic(shop, tracePath(shop, resolveEntry(shop, "Orders.place")));

describe("code-map document", () => {
  const { walk: written, title } = applyDescriptions(shop, walk, {
    title: "How an order is paid",
    steps: [{ step: 2, description: "Charges the card." }],
    links: [{ from: 3, to: 1, label: "audit queue" }],
  });
  const doc = buildDocument(shop, written, { title, args: ["test/areas", "-e", "Orders.place"] });

  test("the system section describes every step in words, numbered from 1", () => {
    expect(doc.system.title).toBe("How an order is paid");
    expect(doc.system.steps.map((s) => [s.step, s.name, s.kind])).toEqual([
      [1, "Orders.place", "method"],
      [2, "charge", "function"],
      [3, "audit", "function"],
    ]);
    expect(doc.system.steps[1]).toMatchObject({ file: "src/modules/payments/charge.ts:3-6", description: "Charges the card.", calledBy: "step 1 (Orders.place), line 6" });
    expect(doc.system.steps[1].calls).toEqual([{ id: "src/modules/audit/audit.ts#audit", name: "audit", step: 3 }]);
    expect(doc.system.areas.map((a) => [a.name, a.steps])).toEqual([["orders", [1]], ["payments", [2]], ["audit", [3]]]);
    expect(doc.system.links).toEqual([{ from: 3, to: 1, label: "audit queue" }]);
    expect(doc.system.handoffs[0]).toMatchObject({ fromStep: 1, step: 2 });
    expect(doc.system.steps.map((s) => [s.parent, s.descendants])).toEqual([[undefined, 2], [1, 1], [2, 0]]);
    expect(doc.generator?.args).toEqual(["test/areas", "-e", "Orders.place"]);
  });

  test("the system section comes first, so an agent can stop reading before the code", () => {
    const text = JSON.stringify(doc);
    expect(text.indexOf('"system"')).toBeLessThan(text.indexOf('"render"'));
  });

  test("render data keeps only the symbols the page refers to", () => {
    const ids = Object.keys(doc.render.symbols);
    expect(ids).toContain("src/modules/payments/charge.ts#charge");
    expect(ids.length).toBeLessThanOrEqual(Object.keys(shop.symbols).length);
    expect(ids.every((id) => !id.endsWith("#<module>") || doc.render.walkthrough.steps.some((s) => s.symbolId === id))).toBe(true);
  });

  test("the viewer reads a document, or builds one from a raw {map, walkthrough} dump", () => {
    expect(toDocument(JSON.parse(JSON.stringify(doc))).system.title).toBe("How an order is paid");
    expect(toDocument({ map: shop, walkthrough: walk }).system.steps).toHaveLength(3);
    expect(() => toDocument({ hello: 1 })).toThrow("isn't a code-map file");
    expect(() => toDocument({ ...doc, version: 99 })).toThrow("version 99");
  });

  test("a standalone page embeds the document where the viewer looks for it", async () => {
    const html = embedDocument(await buildViewerHtml(), doc);
    const data = html.match(/<script type="application\/json" id="code-map-data">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(data).system.title).toBe("How an order is paid");
    expect(html).toContain('<div id="app"></div>');
  });
});

describe("description checker", () => {
  test("flags empty fields, long sentences, jargon, idioms, unexplained abbreviations and copies", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ") + ".";
    const { problems } = checkDescriptions({
      title: "",
      summary: "It leverages the cache to kick off the job.",
      role: long,
      overview: "Talks to GCS and the API (application programming interface).",
      draft: {},
      steps: [{ step: 1, name: "save", draft: "Saves an order to the database and returns it to the caller.", description: "Saves an order to the database and returns it to the caller." }],
    });
    const text = problems.map((p) => `${p.field}: ${p.problem}`);
    expect(text).toContain("title: empty — write it");
    expect(text.some((t) => t.startsWith("summary:") && t.includes('"leverages" → uses'))).toBe(true);
    expect(text).toContain('summary: idiom "kick off" — say the literal thing');
    expect(text.some((t) => t.startsWith("role: 30-word sentence"))).toBe(true);
    expect(text).toContain('overview: "GCS" is never spelled out — write the full name once, then (GCS)');
    expect(text.some((t) => t.includes("API"))).toBe(false);
    expect(text).toContain("step 1 (save): reads like a copy of the docs or draft — rewrite it in plain words");
  });

  test("similarity matches difflib's ratio", () => {
    expect(similarity("abcd", "bcde")).toBeCloseTo(0.75);
    expect(similarity("same text", "Same, text!")).toBe(1);
    expect(similarity("", "x")).toBe(0);
  });
});
