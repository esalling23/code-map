#!/usr/bin/env bun
// code-map as an MCP server (stdio): the same analyze → describe → build loop as the CLI, for agents.
// Every tool is stateless: it takes the folders and options each time and reads or writes files by path.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyDescriptions, buildTemplate, readDescriptions } from "./authored";
import { checkDescriptions, formatProblems } from "./check";
import { buildDocument, FORMAT, type CodeMapDocument } from "./pagedata";
import { listSymbols, loadMap, walkMap, writeOutputs } from "./pipeline";
import { entryCandidates, readSelectionSpecs } from "./trace";

const GUIDES = ["workflow", "writing", "finding-the-system"] as const;
const guide = (name: (typeof GUIDES)[number]) => readFileSync(join(import.meta.dir, "../docs/agents", `${name}.md`), "utf8");

const INSTRUCTIONS = `code-map maps how code runs: the functions on one path through one or more TypeScript/JavaScript repos, the data they use, and a plain-language walkthrough. The result is one JSON file. Its \`system\` section is a sitemap agents read to understand a system without its source; the viewer draws the whole file for people.

To understand a system that already has a map, call read_map on its JSON.

To make a map: (1) decide the repos, sub-paths and an entry or selection (list_entries, list_symbols); (2) trace with a templatePath and aim for 8–40 steps; (3) read the code for every step; (4) write the descriptions into the template in short, plain English for engineers new to this code, explaining every project name; (5) check_descriptions, then build. Call guide("workflow") before your first map, and guide("writing") before writing descriptions. Pass absolute paths.`;

const source = {
  dirs: z.array(z.string()).min(1).describe("Absolute paths of the repo folders; several are analyzed as one system"),
  include: z.array(z.string()).optional().describe("Only analyze these sub-paths of each repo, e.g. src or packages/client/src"),
  tests: z.boolean().optional().describe("Include *.test.* / *.spec.* files"),
};
const walkArgs = {
  entry: z.string().optional().describe('Where the path starts: "src/server.ts#handle", "Server.handle", "handle", or a file path. Default: the uncalled function that reaches the most code'),
  select: z.array(z.string()).optional().describe('Map only these symbols: specs ("file#name", "Class.method", globs like "Service.*"), selection file paths, or comma-separated lists'),
  maxDepth: z.number().int().positive().optional().describe("Deepest call nesting to follow (default 8)"),
  maxSteps: z.number().int().positive().optional().describe("Most steps in the walkthrough (default 60)"),
  maxHops: z.number().int().positive().optional().describe("With select: longest chain of unselected functions to look through (default 6)"),
};

type WalkInput = { dirs: string[]; include?: string[]; tests?: boolean; entry?: string; select?: string[]; maxDepth?: number; maxSteps?: number; maxHops?: number };

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
/** Tool errors go back to the agent as text it can act on, not as protocol errors. */
const safe =
  <A>(fn: (args: A) => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) =>
  async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
    }
  };

/** The CLI arguments that make the same map, saved in the document so CI can rebuild it. */
function cliArgs(a: WalkInput & { descriptionsPath?: string; title?: string }, out: string[]): string[] {
  const args = [...a.dirs];
  for (const i of a.include ?? []) args.push("-i", i);
  if (a.tests) args.push("--tests");
  if (a.entry) args.push("-e", a.entry);
  for (const s of a.select ?? []) args.push("-s", s);
  if (a.maxDepth) args.push("--max-depth", String(a.maxDepth));
  if (a.maxSteps) args.push("--max-steps", String(a.maxSteps));
  if (a.maxHops) args.push("--max-hops", String(a.maxHops));
  if (a.descriptionsPath) args.push("--descriptions", a.descriptionsPath);
  if (a.title) args.push("--title", a.title);
  for (const o of out) args.push("-o", o);
  return args;
}

function walk(a: WalkInput) {
  const map = loadMap(a);
  const { walk, notes } = walkMap(map, { ...a, select: a.select?.length ? readSelectionSpecs(a.select) : undefined });
  return { map, walk, notes };
}

const server = new McpServer({ name: "code-map", version: "0.1.0" }, { instructions: INSTRUCTIONS });

server.registerTool(
  "guide",
  {
    description: "How to make a code map (workflow), how to write its descriptions (writing), and how to find the code for a system named in words (finding-the-system).",
    inputSchema: { name: z.enum(GUIDES) },
  },
  safe(({ name }) => text(guide(name))),
);

server.registerTool(
  "list_entries",
  {
    description: "Likely entry points: functions nothing else calls, ranked by how much code they reach.",
    inputSchema: { ...source, limit: z.number().int().positive().optional().describe("How many (default 20)") },
  },
  safe((a) => json(entryCandidates(loadMap(a), a.limit ?? 20))),
);

server.registerTool(
  "list_symbols",
  {
    description: "What specs or globs match, with caller and callee counts. Check a selection before tracing it.",
    inputSchema: { ...source, specs: z.array(z.string()).min(1).describe('Specs like "OrderService.*", "src/api/*.ts#handle*", "file#name"') },
  },
  safe((a) => json(listSymbols(loadMap(a), readSelectionSpecs(a.specs)))),
);

server.registerTool(
  "trace",
  {
    description:
      "Trace the path and produce the fill-in template: every step and area with the facts needed to describe it, a generated draft, and an empty description. With templatePath the template is written there and only a summary comes back; otherwise it comes back inline. Aim for 8–40 steps.",
    inputSchema: {
      ...source,
      ...walkArgs,
      templatePath: z.string().optional().describe("Where to write the template JSON"),
      descriptionsPath: z.string().optional().describe("Start from an existing descriptions file: its written text is kept in the template's drafts"),
    },
  },
  safe((a) => {
    let { map, walk: w, notes } = walk(a);
    const warnings: string[] = [];
    if (a.descriptionsPath) {
      const applied = applyDescriptions(map, w, readDescriptions(a.descriptionsPath));
      w = applied.walk;
      warnings.push(...applied.warnings);
    }
    const template = buildTemplate(map, w);
    const summary = {
      steps: w.steps.length,
      truncated: w.truncated,
      files: new Set(w.steps.map((s) => map.symbols[s.symbolId].file)).size,
      areas: template.areas.map((x) => x.name),
      notes,
      warnings,
      advice: w.truncated || w.steps.length > 40 ? "Too wide: trim the selection or lower maxDepth." : w.steps.length < 8 ? "Narrow: widen the selection or raise maxDepth." : "Good size.",
    };
    if (!a.templatePath) return json({ ...summary, template });
    writeFileSync(a.templatePath, JSON.stringify(template, null, 2));
    return json({ ...summary, templatePath: a.templatePath, stepNames: template.steps.map((s) => `${s.step}. ${s.name}`) });
  }),
);

server.registerTool(
  "check_descriptions",
  {
    description: "Check a filled-in descriptions file for plain English: empty fields, long sentences, jargon, idioms, abbreviations never spelled out, and text copied from the docs or draft. Advisory.",
    inputSchema: { path: z.string().describe("The descriptions JSON (the template, filled in)") },
  },
  safe(({ path }) => text(formatProblems(checkDescriptions(JSON.parse(readFileSync(path, "utf8")))))),
);

server.registerTool(
  "build",
  {
    description:
      "Build the code map and write it: .json paths get the code-map document (agents and the viewer read it), .html paths get one standalone page. Returns the warnings (fix each: it means text is missing) and the map's outline.",
    inputSchema: {
      ...source,
      ...walkArgs,
      out: z.array(z.string()).min(1).describe("Output paths, .json and/or .html"),
      descriptionsPath: z.string().optional().describe("The filled-in descriptions file"),
      title: z.string().optional().describe("Page title, when the descriptions file has none"),
    },
  },
  safe(async (a) => {
    let { map, walk: w, notes } = walk(a);
    let title = a.title;
    let warnings: string[] = [];
    if (a.descriptionsPath) {
      const applied = applyDescriptions(map, w, readDescriptions(a.descriptionsPath));
      w = applied.walk;
      title = applied.title ?? title;
      warnings = applied.warnings;
    }
    const doc = buildDocument(map, w, { title, args: cliArgs(a, a.out) });
    await writeOutputs(doc, a.out);
    return json({ written: a.out, notes, warnings, title: doc.system.title, summary: doc.system.summary, steps: doc.system.steps.map((s) => `${s.step}. ${s.name}`) });
  }),
);

server.registerTool(
  "read_map",
  {
    description:
      "Read an existing code map's system section: what the code does, where it sits, its areas, every step (file, lines, description, calls, data) and the links between services. Use it to understand a mapped system without reading its source.",
    inputSchema: {
      path: z.string().describe("A code-map JSON file"),
      steps: z.boolean().optional().describe("Include every step (default true); false returns the summary, areas and links only"),
    },
  },
  safe(({ path, steps }) => {
    const doc = JSON.parse(readFileSync(path, "utf8")) as CodeMapDocument;
    if (doc.format !== FORMAT) throw new Error(`${path} isn't a code-map document.`);
    const { steps: all, ...rest } = doc.system;
    return json(steps === false ? { ...rest, stepCount: all.length } : doc.system);
  }),
);

for (const name of GUIDES) {
  server.registerResource(name, `code-map://guide/${name}`, { title: `code-map guide: ${name}`, mimeType: "text/markdown" }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide(name) }],
  }));
}

await server.connect(new StdioServerTransport());
