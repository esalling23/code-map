// code-map's commands. The CLI runs them; the MCP server exposes every command with a `tool` by running the CLI.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyDescriptions, buildTemplate, readDescriptions } from "./authored";
import { checkDescriptions, formatProblems } from "./check";
import { type Command, defineCommand, type OptionSpec, toArgv } from "./command";
import { buildDocument, FORMAT, toDocument } from "./pagedata";
import { listSymbols, loadMap, walkMap, writeOutputs } from "./pipeline";
import { view } from "./serve";
import { entryCandidates, readSelectionSpecs } from "./trace";

export const GUIDES = ["workflow", "writing", "finding-the-system"] as const;
export const guide = (name: string) => readFileSync(join(import.meta.dir, "../docs/agents", `${name}.md`), "utf8");

const source = {
  dirs: { kind: "strings", positional: true, required: true, arg: "<dir>", description: "The repo folders (absolute paths from agents); several are analyzed as one system" },
  include: { kind: "strings", short: "i", arg: "<path>", description: "Only analyze these sub-paths of each repo, e.g. src or packages/client/src" },
  tests: { kind: "boolean", description: "Include *.test.* / *.spec.* files" },
} as const satisfies Record<string, OptionSpec>;

const walkOptions = {
  entry: { kind: "string", short: "e", arg: "<spec>", description: 'Where the path starts: "src/server.ts#handle", "Server.handle", "handle", or a file path (its top-level code). Default: the uncalled function that reaches the most code' },
  select: { kind: "strings", short: "s", arg: "<spec>", description: 'Map only these symbols: specs ("file#name", "Class.method", globs like "Service.*", a source file for everything in it), selection files (one spec per line, or a JSON array), or comma-separated lists' },
  maxHops: { kind: "number", arg: "<n>", description: "With select: longest chain of unselected functions to look through (default 6). Part of the scope" },
} as const satisfies Record<string, OptionSpec>;

type SourceValues = { dirs?: string[]; include?: string[]; tests?: boolean };
type WalkValues = SourceValues & { entry?: string; select?: string[]; maxHops?: number };

function analyzed(v: SourceValues) {
  const started = performance.now();
  const map = loadMap({ dirs: v.dirs!, include: v.include, tests: v.tests });
  const inferred = map.calls.filter((c) => c.inferred).length;
  console.error(
    `Analyzed ${map.roots.length > 1 ? `${map.roots.length} repos, ` : ""}${map.files.length} files, ${Object.keys(map.symbols).length} symbols, ${map.calls.length} calls${inferred ? ` (${inferred} linked by package name)` : ""} in ${Math.round(performance.now() - started)} ms`,
  );
  return map;
}

/** Analyzes, walks and applies a descriptions file: what trace and build share. */
function described(v: WalkValues & { descriptionsPath?: string }) {
  const map = analyzed(v);
  let { walk, notes } = walkMap(map, { entry: v.entry, select: v.select?.length ? readSelectionSpecs(v.select) : undefined, maxHops: v.maxHops });
  let title: string | undefined;
  let warnings: string[] = [];
  if (v.descriptionsPath) {
    const applied = applyDescriptions(map, walk, readDescriptions(v.descriptionsPath));
    ({ walk, title, warnings } = applied);
  }
  return { map, walk, notes, title, warnings };
}

const lines = (...groups: (string | string[] | undefined | false)[]) => groups.flat().filter(Boolean).join("\n");

const build = defineCommand({
  name: "build",
  tool: "build",
  usage: "<dir> [<dir> ...] [options]",
  description:
    "Build the code map and write it: .json paths get the code-map document (agents and the viewer read it), .html paths get one standalone page. Returns the warnings (fix each: it means text is missing) and the map's outline.",
  options: {
    ...source,
    ...walkOptions,
    out: { kind: "strings", short: "o", arg: "<file>", required: "mcp", default: ["code-map.json"], description: "Output paths, .json and/or .html (CLI default: code-map.json)" },
    descriptionsPath: { kind: "string", flag: "descriptions", arg: "<file>", description: "The filled-in descriptions file: the trace template with its descriptions written" },
    title: { kind: "string", arg: "<text>", description: "Page title, when the descriptions file has none" },
    raw: { kind: "string", arg: "<file>", cliOnly: true, description: "Also write the raw analysis and walkthrough as JSON" },
    strict: { kind: "boolean", cliOnly: true, description: "With --descriptions: exit 1 when anything didn't match or a step has no written description (for CI)" },
  },
  async run(v) {
    if (v.strict && !v.descriptionsPath) throw new Error("--strict checks written descriptions; pass --descriptions <file>.");
    const { map, walk, notes, title, warnings } = described(v);
    const doc = buildDocument(map, walk, { title: title ?? v.title, args: toArgv(build, v, { recorded: true }) });
    await writeOutputs(doc, v.out!);
    if (v.raw) writeFileSync(v.raw, JSON.stringify({ map, walkthrough: walk }, null, 2));
    if (v.strict && warnings.length) {
      for (const w of warnings) console.error(`warning: ${w}`);
      throw new Error(`--strict: ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`);
    }
    return { written: [...v.out!, ...(v.raw ? [v.raw] : [])], notes, warnings, title: doc.system.title, summary: doc.system.summary, steps: doc.system.steps.map((s) => `${s.step}. ${s.name}`) };
  },
  print: (r) => lines(r.notes, r.warnings.map((w) => `warning: ${w}`), r.written.map((p) => `Wrote ${p} (${r.steps.length} steps)`)),
});

const trace = defineCommand({
  name: "trace",
  tool: "trace",
  usage: "<dir> [<dir> ...] [options]",
  description:
    "Trace the path and produce the fill-in template: every step and area with the facts needed to describe it, a generated draft, and an empty description. With templatePath the template is written there and only a summary comes back; otherwise it comes back inline. The walk follows every call reachable in the scope (dirs, include, tests, entry, select); the summary gives the step count and the steps with the most steps beneath them. To focus the map, narrow the scope; never drop steps.",
  options: {
    ...source,
    ...walkOptions,
    templatePath: { kind: "string", flag: "template", arg: "<file>", description: "Where to write the template JSON; its folder is created if needed" },
    descriptionsPath: { kind: "string", flag: "descriptions", arg: "<file>", description: "Start from an existing descriptions file: its written text is kept in the template's drafts" },
  },
  run(v) {
    const { map, walk, notes, warnings } = described(v);
    const template = buildTemplate(map, walk);
    const summary = {
      steps: walk.steps.length,
      files: new Set(walk.steps.map((s) => map.symbols[s.symbolId].file)).size,
      areas: template.areas.map((a) => a.name),
      notes,
      warnings,
      largest: [...walk.steps]
        .sort((x, y) => y.descendants - x.descendants || x.index - y.index)
        .slice(0, 5)
        .filter((s) => s.descendants > 0)
        .map((s) => `${s.index + 1}. ${map.symbols[s.symbolId].name} (${s.descendants} step${s.descendants === 1 ? "" : "s"} beneath)`),
      advice:
        "The map covers everything reachable in this scope. If it covers code you did not mean to map, narrow include, select or entry and trace again; never drop steps. People hide small helpers with the viewer's level filter.",
    };
    if (!v.templatePath) return { ...summary, template };
    mkdirSync(dirname(v.templatePath), { recursive: true });
    writeFileSync(v.templatePath, JSON.stringify(template, null, 2));
    return { ...summary, templatePath: v.templatePath, stepNames: template.steps.map((s) => `${s.step}. ${s.name}`) };
  },
  print: (r) =>
    "template" in r
      ? JSON.stringify(r, null, 2)
      : lines(`${r.steps} steps in ${r.files} files; areas: ${r.areas.join(", ")}`, r.notes, r.warnings.map((w) => `warning: ${w}`), r.largest.length > 0 && "Largest:", r.largest.map((l) => `  ${l}`), `Wrote ${r.templatePath}`),
});

const entries = defineCommand({
  name: "entries",
  tool: "list_entries",
  usage: "<dir> [<dir> ...] [options]",
  description: "Likely entry points: functions nothing else calls, ranked by how much code they reach.",
  options: { ...source, limit: { kind: "number", arg: "<n>", default: 20, description: "How many (default 20)" } },
  run: (v) => entryCandidates(analyzed(v), v.limit!),
  print: (r) => r.map((c) => `${String(c.reach).padStart(4)}  ${c.id}`).join("\n"),
});

const symbols = defineCommand({
  name: "symbols",
  tool: "list_symbols",
  usage: "<dir> [<dir> ...] -s <spec> [options]",
  description: "What specs or globs match, with caller and callee counts. Check a selection before tracing it.",
  options: { ...source, specs: { kind: "strings", short: "s", flag: "spec", arg: "<spec>", required: true, description: 'Specs like "OrderService.*", "src/api/*.ts#handle*", "file#name"; same syntax as select' } },
  run: (v) => listSymbols(analyzed(v), readSelectionSpecs(v.specs!)),
  print: (r) => r.map((s) => `${s.kind.padEnd(8)} ${s.id}  (line ${s.line}, ${s.callers} callers, ${s.callees} callees)${s.doc ? `  — ${s.doc.slice(0, 80)}` : ""}`).join("\n"),
});

const check = defineCommand({
  name: "check",
  tool: "check_descriptions",
  usage: "<descriptions.json>",
  description: "Check a filled-in descriptions file for plain English: empty fields, long sentences, jargon, idioms, abbreviations never spelled out, and text copied from the docs or draft. Advisory.",
  options: { path: { kind: "string", positional: true, required: true, arg: "<descriptions.json>", description: "The descriptions JSON (the template, filled in)" } },
  run: (v) => formatProblems(checkDescriptions(JSON.parse(readFileSync(v.path!, "utf8")))),
});

const read = defineCommand({
  name: "read",
  tool: "read_map",
  usage: "<map.json> [--no-steps]",
  description:
    "Read an existing code map's system section: what the code does, where it sits, its areas, every step (file, lines, description, calls, data, parent step and how many steps sit beneath it) and the links between services. Use it to understand a mapped system without reading its source.",
  options: {
    path: { kind: "string", positional: true, required: true, arg: "<map.json>", description: "A code-map JSON file" },
    steps: { kind: "boolean", default: true, description: "Include every step (default true); false returns the summary, areas and links only" },
  },
  run(v) {
    const raw = JSON.parse(readFileSync(v.path!, "utf8"));
    if (raw?.format !== FORMAT) throw new Error(`${v.path} isn't a code-map document.`);
    const { steps, ...rest } = toDocument(raw).system;
    return v.steps === false ? { ...rest, stepCount: steps.length } : { ...rest, steps };
  },
});

const guideCommand = defineCommand({
  name: "guide",
  tool: "guide",
  usage: `<${GUIDES.join("|")}>`,
  description: "How to make a code map (workflow), how to write its descriptions (writing), and how to find the code for a system named in words (finding-the-system).",
  options: { name: { kind: "string", positional: true, required: true, choices: GUIDES, arg: "<name>", description: "Which guide: workflow, writing or finding-the-system" } },
  run: (v) => guide(v.name!),
});

const viewCommand = defineCommand({
  name: "view",
  usage: "[<map.json>] [--port <n>] [--no-open]",
  description:
    "Serve the viewer on localhost. With a file, open it; reloading the page reads the file again, so a rebuilt map shows up on refresh. Without one, open the file picker and the maps opened before in this browser.",
  options: {
    file: { kind: "string", positional: true, arg: "<map.json>", description: "The code-map JSON to open" },
    port: { kind: "number", arg: "<n>", default: 4173, description: "Port to serve on (default 4173; keep it fixed so recent files are remembered)" },
    open: { kind: "boolean", default: true, description: "Don't open a browser" },
  },
  run: (v) => view({ file: v.file, port: v.port!, open: v.open! }),
  print: () => "",
});

export const COMMANDS: Command[] = [build, trace, entries, symbols, check, read, guideCommand, viewCommand];
