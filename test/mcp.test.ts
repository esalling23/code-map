import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "test", version: "0" });
const dir = mkdtempSync(join(tmpdir(), "code-map-mcp-"));
const areas = join(import.meta.dir, "areas");
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0].text, isError: !!r.isError };
};

beforeAll(async () => {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, "../src/mcp.ts")] }));
});
afterAll(() => client.close());

test("lists the tools and gives agents the workflow", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(names).toEqual(["build", "check_descriptions", "guide", "list_entries", "list_symbols", "read_map", "trace"]);
  expect(client.getInstructions()).toContain("read_map");
  expect((await call("guide", { name: "writing" })).text.length).toBeGreaterThan(500);
});

test("trace → write descriptions → check → build → read_map", async () => {
  const templatePath = join(dir, "descriptions.json");
  const traced = JSON.parse((await call("trace", { dirs: [areas], entry: "Orders.place", templatePath })).text);
  expect(traced.steps).toBe(3);
  expect(traced.stepNames).toEqual(["1. Orders.place", "2. charge", "3. audit"]);
  expect(traced.largest).toEqual(["1. Orders.place (2 steps beneath)", "2. charge (1 step beneath)"]);

  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  template.title = "How an order is paid";
  template.steps[1].description = "Takes the money from the card.";
  writeFileSync(templatePath, JSON.stringify(template));
  expect((await call("check_descriptions", { path: templatePath })).text).toContain("summary: empty");

  const out = join(dir, "map.json");
  const built = JSON.parse((await call("build", { dirs: [areas], entry: "Orders.place", descriptionsPath: templatePath, out: [out, join(dir, "map.html")] })).text);
  expect(built.title).toBe("How an order is paid");
  expect(built.warnings[0]).toContain("Steps without a written description");
  const doc = JSON.parse(readFileSync(out, "utf8"));
  expect(doc.generator.args).toEqual([areas, "-e", "Orders.place", "--descriptions", templatePath, "-o", out, "-o", join(dir, "map.html")]);

  const read = JSON.parse((await call("read_map", { path: out, steps: false })).text);
  expect(read).toMatchObject({ title: "How an order is paid", stepCount: 3 });
  expect(read.steps).toBeUndefined();
  expect(JSON.parse((await call("read_map", { path: out })).text).steps[0]).toMatchObject({ step: 1, descendants: 2 });
});

test("errors come back as tool results", async () => {
  const r = await call("trace", { dirs: [areas], entry: "nope" });
  expect(r.isError).toBe(true);
});

test("a wrong argument name is rejected with the names the tool takes", async () => {
  const guide = await call("guide", { topic: "workflow" });
  expect(guide.isError).toBe(true);
  expect(guide.text).toContain('Unknown argument "topic". This tool takes: name.');
  const entries = await call("list_entries", { repo: areas });
  expect(entries.isError).toBe(true);
  expect(entries.text).toContain('Unknown argument "repo". This tool takes: dirs, include, tests, limit.');
  // Removed options fail too, rather than being dropped.
  expect((await call("trace", { dirs: [areas], maxSteps: 5 })).text).toContain('Unknown argument "maxSteps"');
});

test("trace creates the template's folder", async () => {
  const templatePath = join(dir, "new", "folder", "descriptions.json");
  const traced = await call("trace", { dirs: [areas], entry: "Orders.place", templatePath });
  expect(traced.isError).toBe(false);
  expect(JSON.parse(readFileSync(templatePath, "utf8")).steps).toHaveLength(3);
});
