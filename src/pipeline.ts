// The steps from source folders to a code-map document, shared by the CLI and the MCP server.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyze } from "./analyze";
import { describeHeuristic } from "./describe";
import type { CodeMapDocument } from "./pagedata";
import { entryCandidates, resolveEntry, resolveSelection, tracePath } from "./trace";
import type { CodeMap, Walkthrough } from "./types";
import { buildViewerHtml, embedDocument } from "./viewer/build";

export interface SourceOptions {
  dirs: string[];
  include?: string[];
  tests?: boolean;
}

export interface WalkOptions {
  entry?: string;
  /** Specs already read from files or inline lists (see `readSelectionSpecs`). */
  select?: string[];
  /** With `select`: longest chain of unselected symbols to look through. Part of the scope, not a trim. */
  maxHops?: number;
}

export function loadMap(o: SourceOptions): CodeMap {
  return analyze(o.dirs.map((d) => resolve(d)), { include: o.include, skipTests: !o.tests });
}

/** What each spec matches, with how many callers and callees it has. */
export function listSymbols(map: CodeMap, specs: string[]) {
  return resolveSelection(map, specs).map((id) => {
    const s = map.symbols[id];
    return {
      id,
      kind: s.kind,
      line: s.startLine,
      callers: new Set(map.calls.filter((c) => c.to === id).map((c) => c.from)).size,
      callees: new Set(map.calls.filter((c) => c.from === id).map((c) => c.to)).size,
      doc: s.doc,
    };
  });
}

/** Traces every reachable call in scope and writes the generated descriptions. `notes` says what was chosen on the caller's behalf. */
export function walkMap(map: CodeMap, o: WalkOptions): { walk: Walkthrough; notes: string[] } {
  const notes: string[] = [];
  const select = o.select?.length ? resolveSelection(map, o.select) : undefined;
  if (select) notes.push(`Selected ${select.length} symbols`);
  let entry: string | undefined;
  if (o.entry) {
    entry = resolveEntry(map, o.entry);
  } else if (!select) {
    const best = entryCandidates(map, 1)[0];
    if (!best) throw new Error("No calls found between the analyzed files; pass an entry.");
    entry = best.id;
    notes.push(`No entry given; starting at ${entry} (reaches ${best.reach} symbols).`);
  }
  const walk = describeHeuristic(map, tracePath(map, entry, { maxHops: o.maxHops ?? 6, select }));
  return { walk, notes };
}

/** Writes the document to each path: `.html` gets the standalone viewer with the map built in, anything else JSON. */
export async function writeOutputs(doc: CodeMapDocument, paths: string[]): Promise<string[]> {
  for (const path of paths) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, /\.html?$/i.test(path) ? embedDocument(await buildViewerHtml(), doc) : JSON.stringify(doc, null, 2));
  }
  return paths;
}
