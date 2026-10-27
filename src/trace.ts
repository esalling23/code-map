import { existsSync, readFileSync } from "node:fs";
import type { CallEdge, CodeMap, PathStep, StepCall, Walkthrough } from "./types";

export interface TraceOptions {
  maxDepth?: number;
  maxSteps?: number;
  /** Only these symbols become steps; calls through other symbols are collapsed into `via` chains. */
  select?: string[];
  /** Longest chain of unselected symbols to look through between two selected ones. */
  maxHops?: number;
}

const fileMatches = (file: string, part: string | undefined) => !part || file === part || file.endsWith(`/${part}`);
const matchingFile = (map: CodeMap, spec: string) => map.files.find((f) => fileMatches(f, spec));

/**
 * Resolves a user-supplied entry to a symbol id. Accepts a full id (`src/a.ts#fn`),
 * `file#name` with a partial path, a file path (its top-level code), or a bare name.
 */
export function resolveEntry(map: CodeMap, entry: string): string {
  const ids = Object.keys(map.symbols);
  if (map.symbols[entry]) return entry;
  const norm = entry.replace(/^\.\//, "");
  const [filePart, namePart] = norm.includes("#") ? norm.split("#") : [undefined, norm];

  const file = !norm.includes("#") && matchingFile(map, norm);
  if (file) {
    const moduleId = `${file}#<module>`;
    if (map.symbols[moduleId]) return moduleId;
    const exported = ids.filter((id) => map.symbols[id].file === file && map.symbols[id].exported && map.symbols[id].kind !== "data");
    if (exported.length === 1) return exported[0];
    throw new Error(`${file} has no top-level code to start from. Pick one of:\n  ${exported.join("\n  ")}`);
  }

  const candidates = ids.filter((id) => {
    const s = map.symbols[id];
    return fileMatches(s.file, filePart) && (s.name === namePart || s.name.endsWith(`.${namePart}`));
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`"${entry}" is ambiguous. Use one of:\n  ${candidates.join("\n  ")}`);
  }
  throw new Error(`No symbol matches "${entry}". Run with --list-entries to see candidates.`);
}

const globToRegex = (glob: string) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);

/**
 * Turns selection specs into symbol ids. A spec is anything `resolveEntry` takes, a glob
 * (`OrderService.*`, `src/api/*.ts#handle*`), or a file path, which selects everything in it.
 */
export function resolveSelection(map: CodeMap, specs: string[]): string[] {
  const out = new Set<string>();
  const all = Object.values(map.symbols);
  for (const raw of specs) {
    const spec = raw.trim().replace(/^\.\//, "");
    if (!spec) continue;
    if (spec.includes("*")) {
      const [filePart, namePart] = spec.includes("#") ? spec.split("#") : [undefined, spec];
      const fileRe = filePart && globToRegex(filePart);
      const nameRe = globToRegex(namePart);
      const hits = all.filter(
        (s) =>
          s.kind !== "module" &&
          (!fileRe || fileRe.test(s.file) || s.file.split("/").some((_, i, parts) => fileRe.test(parts.slice(i).join("/")))) &&
          (nameRe.test(s.name) || (s.name.includes(".") && nameRe.test(s.name.slice(s.name.indexOf(".") + 1)))),
      );
      if (!hits.length) throw new Error(`Selection "${spec}" matches nothing.`);
      for (const s of hits) out.add(s.id);
      continue;
    }
    const file = !spec.includes("#") && matchingFile(map, spec);
    if (file) {
      for (const s of all) if (s.file === file) out.add(s.id);
      continue;
    }
    out.add(resolveEntry(map, spec));
  }
  return [...out];
}

/**
 * Reads selection specs from `--select` values. Each value is a path to a file (one spec per
 * line, `#` comment lines; or a JSON array of specs) or an inline comma/newline-separated list.
 */
export function readSelectionSpecs(values: string[]): string[] {
  return values.flatMap((v) => {
    const text = existsSync(v) ? readFileSync(v, "utf8") : v;
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) return (JSON.parse(trimmed) as string[]).map(String);
    return text
      .split(existsSync(v) ? /\r?\n/ : /[,\n]/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  });
}

/** Symbols that nothing else calls but that call into the codebase, ranked by how much they reach. */
export function entryCandidates(map: CodeMap, limit = 10): { id: string; reach: number }[] {
  const called = new Set(map.calls.map((c) => c.to));
  const out = new Map<string, string[]>();
  for (const c of map.calls) (out.get(c.from) ?? out.set(c.from, []).get(c.from)!).push(c.to);
  const reach = (id: string) => {
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) for (const n of out.get(stack.pop()!) ?? []) if (!seen.has(n)) seen.add(n) && stack.push(n);
    return seen.size - 1;
  };
  return Object.keys(map.symbols)
    .filter((id) => !called.has(id) && out.has(id) && map.symbols[id].kind !== "data")
    .map((id) => ({ id, reach: reach(id) }))
    .sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Depth-first walk of the call graph in source order — the path the code takes when it runs.
 * With `select`, only selected symbols become steps; selected symbols the walk never reaches
 * start their own segments, so every selected symbol appears.
 */
export function tracePath(map: CodeMap, entryId: string | undefined, opts: TraceOptions = {}): Walkthrough {
  const maxDepth = opts.maxDepth ?? 8;
  const maxSteps = opts.maxSteps ?? 60;
  const maxHops = opts.maxHops ?? 6;
  const selectedAll = opts.select && new Set(opts.select);
  const selectedData = opts.select?.filter((id) => map.symbols[id].kind === "data") ?? [];
  const selected = selectedAll && new Set([...selectedAll].filter((id) => map.symbols[id].kind !== "data"));
  const isSelected = (id: string) => !selected || selected.has(id);

  const byFrom = new Map<string, CallEdge[]>();
  for (const c of map.calls) (byFrom.get(c.from) ?? byFrom.set(c.from, []).get(c.from)!).push(c);
  for (const list of byFrom.values()) list.sort((a, b) => a.line - b.line || a.order - b.order);

  /** Selected symbols reachable from `start` through unselected ones, in source order. */
  const reachSelected = (start: CallEdge): { to: string; via: string[]; inferred: boolean }[] => {
    if (isSelected(start.to)) return [{ to: start.to, via: [], inferred: !!start.inferred }];
    const found: { to: string; via: string[]; inferred: boolean }[] = [];
    const seen = new Set<string>([start.to]);
    const walk = (id: string, via: string[], inferred: boolean) => {
      if (via.length > maxHops) return;
      for (const e of byFrom.get(id) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        if (isSelected(e.to)) found.push({ to: e.to, via, inferred: inferred || !!e.inferred });
        else walk(e.to, [...via, e.to], inferred || !!e.inferred);
      }
    };
    walk(start.to, [start.to], !!start.inferred);
    return found;
  };

  const steps: PathStep[] = [];
  const stepOf = new Map<string, number>();
  let truncated = false;

  const visit = (id: string, depth: number, parent?: number, callLine?: number, via: string[] = []): number | undefined => {
    if (stepOf.has(id)) return stepOf.get(id);
    if (steps.length >= maxSteps) {
      truncated = true;
      return undefined;
    }
    const step: PathStep = {
      index: steps.length,
      symbolId: id,
      depth,
      parent,
      callLine,
      via,
      calls: [],
      dataUsed: map.data.filter((d) => d.from === id).map((d) => ({ id: d.to, relation: d.relation })),
      description: "",
    };
    steps.push(step);
    stepOf.set(id, step.index);

    const seenTargets = new Set<string>([id]);
    for (const edge of byFrom.get(id) ?? []) {
      for (const hit of reachSelected(edge)) {
        if (seenTargets.has(hit.to)) continue;
        seenTargets.add(hit.to);
        const call: StepCall = { to: hit.to, line: edge.line, via: hit.via, ...(hit.inferred ? { inferred: true } : {}) };
        step.calls.push(call);
        if (depth + 1 > maxDepth) {
          truncated = true;
          call.step = stepOf.get(hit.to);
          continue;
        }
        call.step = visit(hit.to, depth + 1, step.index, edge.line, hit.via);
      }
    }
    return step.index;
  };

  let entry = entryId;
  if (entry && !isSelected(entry)) {
    // Start from an unselected entry: its first selected descendants become the roots.
    for (const edge of byFrom.get(entry) ?? []) for (const hit of reachSelected(edge)) visit(hit.to, 0, undefined, undefined, [entry, ...hit.via]);
  } else if (entry) {
    visit(entry, 0);
  }

  if (selected) {
    // Remaining selected symbols, starting with those no other selected symbol leads to.
    const order = opts.select!.filter((id) => selected.has(id));
    const reachedBySelected = new Set<string>();
    for (const id of order) for (const e of byFrom.get(id) ?? []) for (const hit of reachSelected(e)) if (hit.to !== id) reachedBySelected.add(hit.to);
    for (const id of [...order.filter((id) => !reachedBySelected.has(id)), ...order]) {
      if (!stepOf.has(id)) visit(id, 0);
    }
  }

  if (!steps.length) throw new Error("The path has no steps.");
  return {
    entry: entry && isSelected(entry) ? entry : steps[0].symbolId,
    overview: "",
    steps,
    truncated,
    ...(opts.select ? { selection: { ids: [...selected!], data: selectedData } } : {}),
  };
}
