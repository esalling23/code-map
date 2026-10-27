#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyDescriptions, buildTemplate, readDescriptions } from "./authored";
import { checkDescriptions, formatProblems } from "./check";
import { describeWithClaude } from "./describe";
import { buildDocument } from "./pagedata";
import { listSymbols, loadMap, walkMap, writeOutputs } from "./pipeline";
import { view } from "./serve";
import { entryCandidates, readSelectionSpecs } from "./trace";

const HELP = `code-map — generate a code-map of how code runs

Usage:
  code-map <dir> [<dir> ...] [options]     build a code map
  code-map view [<map.json>]               open a code map in the viewer (see view --help)
  code-map check <descriptions.json>       check written descriptions for plain English
  code-map-mcp                             the same tools as an MCP server (stdio)

  Several dirs are analyzed as one system. Files are shown under each repo's folder
  name, and calls into another repo's package are linked to its source by name.

Options:
  -e, --entry <spec>     Where the path starts: "src/server.ts#handle", "Server.handle",
                         "handle", or a file path (its top-level code). Default: the
                         uncalled function that reaches the most code.
  -s, --select <spec>    Map only these functions/methods/types (repeatable). A path to a
                         file (one spec per line, # comments, or a JSON array) or an
                         inline comma-separated list. Specs: "file#name", "Class.method",
                         "name", globs like "OrderService.*" or "src/api/*.ts#handle*",
                         or a file path (everything in it).
  -o, --out <file>       Where to write the map (repeatable). .json writes the code-map
                         document (default: code-map.json); .html writes the viewer with
                         the map built in, as one file that opens anywhere.
      --raw <file>       Also write the raw analysis (every symbol, call and import) and
                         walkthrough as JSON
  -i, --include <path>   Only analyze this sub-path of <dir> (repeatable)
      --tests            Include *.test.* / *.spec.* files
      --max-depth <n>    Deepest call nesting to follow (default: 8)
      --max-steps <n>    Most steps in the walkthrough (default: 60)
      --max-hops <n>     With --select: longest chain of unselected functions to look
                         through between two selected ones (default: 6)
      --list-entries     Print likely entry points and exit
      --list <spec>      Print the symbols a spec or glob matches, with callers and
                         callees, and exit (repeatable; same syntax as --select)
      --template <file>  Also write a fill-in JSON file with every step and area, for
                         writing the page's descriptions by hand
      --descriptions <file>
                         Use descriptions from a filled-in --template file (title,
                         summary, role, areas, steps, links) in place of generated text
      --strict           With --descriptions: exit 1 when anything didn't match or a step
                         has no written description (for CI)
      --llm              Have Claude write the step descriptions. Sends the code on the
                         path to the Anthropic API; needs ANTHROPIC_API_KEY.
      --model <id>       Model for --llm (default: claude-opus-5-5)
      --title <text>     Page title
  -h, --help             Show this help
`;

async function main() {
  if (process.argv[2] === "view") return view(process.argv.slice(3));
  if (process.argv[2] === "check") {
    const path = process.argv[3];
    if (!path) throw new Error("Usage: code-map check <descriptions.json>");
    return console.log(formatProblems(checkDescriptions(JSON.parse(readFileSync(path, "utf8")))));
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      entry: { type: "string", short: "e" },
      out: { type: "string", short: "o", multiple: true },
      raw: { type: "string" },
      include: { type: "string", short: "i", multiple: true },
      select: { type: "string", short: "s", multiple: true },
      "max-hops": { type: "string", default: "6" },
      tests: { type: "boolean", default: false },
      "max-depth": { type: "string", default: "8" },
      "max-steps": { type: "string", default: "60" },
      "list-entries": { type: "boolean", default: false },
      list: { type: "string", multiple: true },
      template: { type: "string" },
      descriptions: { type: "string" },
      strict: { type: "boolean", default: false },
      llm: { type: "boolean", default: false },
      model: { type: "string", default: "claude-opus-5-5" },
      title: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }
  if (values.strict && !values.descriptions) throw new Error("--strict checks written descriptions; pass --descriptions <file>.");

  const started = performance.now();
  const map = loadMap({ dirs: positionals, include: values.include, tests: values.tests });
  const symbolCount = Object.keys(map.symbols).length;
  const inferred = map.calls.filter((c) => c.inferred).length;
  console.error(
    `Analyzed ${map.roots.length > 1 ? `${map.roots.length} repos, ` : ""}${map.files.length} files, ${symbolCount} symbols, ${map.calls.length} calls${inferred ? ` (${inferred} linked by package name)` : ""} in ${Math.round(performance.now() - started)} ms`,
  );

  if (values["list-entries"]) {
    for (const c of entryCandidates(map, 20)) console.log(`${String(c.reach).padStart(4)}  ${c.id}`);
    return;
  }

  if (values.list?.length) {
    for (const s of listSymbols(map, readSelectionSpecs(values.list))) {
      console.log(`${s.kind.padEnd(8)} ${s.id}  (line ${s.line}, ${s.callers} callers, ${s.callees} callees)${s.doc ? `  — ${s.doc.slice(0, 80)}` : ""}`);
    }
    return;
  }

  let { walk, notes } = walkMap(map, {
    entry: values.entry,
    select: values.select?.length ? readSelectionSpecs(values.select) : undefined,
    maxDepth: Number(values["max-depth"]),
    maxSteps: Number(values["max-steps"]),
    maxHops: Number(values["max-hops"]),
  });
  for (const n of notes) console.error(n);

  if (values.llm) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("--llm needs ANTHROPIC_API_KEY in the environment.");
    console.error(`Asking ${values.model} to describe ${walk.steps.length} steps...`);
    walk = await describeWithClaude(map, walk, { apiKey, model: values.model! });
  }

  let title = values.title;
  let warnings: string[] = [];
  if (values.descriptions) {
    const applied = applyDescriptions(map, walk, readDescriptions(values.descriptions));
    walk = applied.walk;
    title ??= applied.title;
    warnings = applied.warnings;
    for (const w of warnings) console.error(`warning: ${w}`);
  }
  if (values.template) {
    writeFileSync(values.template, JSON.stringify(buildTemplate(map, walk), null, 2));
    console.error(`Wrote ${values.template}`);
  }

  const doc = buildDocument(map, walk, { title, args: process.argv.slice(2) });
  for (const out of await writeOutputs(doc, values.out?.length ? values.out : ["code-map.json"])) {
    console.error(`Wrote ${out} (${walk.steps.length} steps${walk.truncated ? ", truncated" : ""})`);
  }
  if (values.raw) {
    writeFileSync(values.raw, JSON.stringify({ map, walkthrough: walk }, null, 2));
    console.error(`Wrote ${values.raw}`);
  }
  if (values.strict && warnings.length) {
    console.error(`--strict: ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`code-map: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
