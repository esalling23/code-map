import { buildContext } from "./context";
import { createModel, type Model } from "./model";
import type { CodeMap, CodeSymbol, PathStep, SystemContext, Walkthrough } from "./types";

const short = (s: CodeSymbol) => (s.kind === "module" ? s.file : s.name);
const code = (t: string) => `\`${t}\``;

function humanize(name: string): string {
  const base = name.split(".").pop()!.replace(/^(get|set) /, "");
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstSentence(doc: string): string {
  const m = doc.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : doc).trim();
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Plain-language description of one step, built only from what static analysis knows. */
export function describeStep(m: Model, step: PathStep): string {
  const { map } = m;
  const sym = m.symbolOf(step);
  const parts: string[] = [];

  if (sym.kind === "module") {
    parts.push(`Top-level code in ${code(sym.file)} runs when the file is loaded.`);
  } else if (sym.doc) {
    parts.push(firstSentence(sym.doc));
  } else {
    const what = sym.name.endsWith(".constructor") ? `Builds a new ${code(sym.name.split(".")[0])}` : humanize(sym.name);
    parts.push(`${what}.`);
  }

  const via = step.via.length ? ` by way of ${list(step.via.map((v) => code(short(map.symbols[v]))))}` : "";
  if (step.parent === undefined && step.via.length) {
    parts.push(`Reached${via}.`);
  } else if (step.parent === undefined) {
    parts.push(step.index === 0 ? "This is where the path starts." : "No earlier step leads here, so this starts a separate part of the path.");
  } else {
    const parent = m.symbolOf(m.parentOf(step)!);
    const viaRepo = parent.repo !== sym.repo && sym.repo ? ` from the ${code(parent.repo)} repo` : "";
    parts.push(`Called by ${code(short(parent))} (step ${step.parent + 1})${viaRepo} on line ${step.callLine}${via}.`);
  }

  const byRel = (r: string) => step.dataUsed.filter((d) => d.relation === r).map((d) => code(map.symbols[d.id].name));
  const takes = byRel("param");
  const returns = byRel("returns");
  const creates = byRel("creates");
  const uses = byRel("uses");
  if (takes.length) parts.push(`Takes ${list(takes)} as input.`);
  if (creates.length) parts.push(`Creates ${list(creates)}.`);
  if (uses.length) parts.push(`Works with ${list(uses)}.`);
  if (returns.length) parts.push(`Returns ${list(returns)}.`);

  if (step.calls.length) {
    const calls = step.calls.map((c) => {
      const target = map.symbols[c.to];
      const ref = c.step !== undefined ? ` (step ${c.step + 1})` : "";
      const through = c.via.length ? ` through ${c.via.length} other function${c.via.length === 1 ? "" : "s"}` : "";
      return `${code(short(target))}${ref}${through}`;
    });
    parts.push(`${step.calls.length > 1 ? "In order, it calls" : "It calls"} ${list(calls)}.`);
    const inferred = step.calls.filter((c) => c.inferred).map((c) => code(short(map.symbols[c.to])));
    if (inferred.length) parts.push(`${list(inferred)} ${inferred.length === 1 ? "was" : "were"} matched by package and name, not resolved directly.`);
  }

  const external = [...new Set(sym.externalCalls.map((c) => c.text))].filter((t) => !/^(console\.|JSON\.|Object\.|Array\.|String\(|Number\(|Promise\.)/.test(t));
  if (external.length) {
    const shown = external.slice(0, 6).map(code);
    parts.push(`Uses outside code: ${list(shown)}${external.length > 6 ? ` and ${external.length - 6} more` : ""}.`);
  }
  if (!step.calls.length && !external.length && sym.kind !== "class") parts.push("It doesn't call into any other code.");

  return parts.join(" ");
}

export function describeOverview(m: Model): string {
  const { map, walk } = m;
  const entry = map.symbols[walk.entry];
  const files = [...m.filesOnPath];
  const data = [...new Set(m.dataIds.map((id) => map.symbols[id].name))];
  const repos = [...new Set(walk.steps.map((s) => m.symbolOf(s).repo))].filter(Boolean);
  const where = entry.kind === "module" ? `the top-level code of ${code(entry.file)}` : `${code(entry.name)} in ${code(entry.file)}`;
  const inRepos = repos.length > 1 ? ` across ${repos.length} repos (${list(repos.map(code))})` : "";
  let text = walk.selection
    ? `This map covers ${walk.steps.length} selected function${walk.steps.length === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}${inRepos}, starting at ${where}. Calls through functions outside the selection are shown as one hop.`
    : `The path starts at ${where} and passes through ${walk.steps.length} function${walk.steps.length === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}${inRepos}.`;
  const starts = walk.steps.filter((s) => s.parent === undefined).length;
  if (starts > 1) text += ` It has ${starts} separate starting points.`;
  if (data.length) text += ` Along the way it handles these data types: ${list(data.slice(0, 8).map(code))}${data.length > 8 ? ` and ${data.length - 8} more` : ""}.`;
  return text;
}

const bold = (t: string) => `**${t}**`;

/** What the path does overall, from the entry's doc comment and the areas it runs through. */
export function describeSummary(map: CodeMap, walk: Walkthrough, ctx: SystemContext): string {
  const entry = map.symbols[walk.entry];
  const owner = entry.name.includes(".") ? map.symbols[`${entry.file}#${entry.name.split(".")[0]}`] : undefined;
  const doc = entry.doc || owner?.doc || map.fileDocs[entry.file];
  const what = doc ? firstSentence(doc) : `This map follows ${code(entry.kind === "module" ? entry.file : entry.name)}.`;
  const [first, ...rest] = ctx.areas;
  let text = `${what} It starts in the ${bold(first.name)} area`;
  if (first.doc) text += ` (${firstSentence(first.doc).replace(/\.$/, "")})`;
  text += rest.length ? ` and hands off to ${list(rest.slice(0, 6).map((a) => bold(a.name)))}${rest.length > 6 ? ` and ${rest.length - 6} more` : ""}.` : ", and stays there.";
  return text;
}

/** Which repos and packages the path belongs to, from their package.json and README. */
export function describeRole(ctx: SystemContext): string {
  const one = (r: SystemContext["repos"][number]) => `${bold(r.name)}${r.description ? `: ${r.description}` : ""}`;
  if (ctx.repos.length === 1) return `Part of ${one(ctx.repos[0])}`;
  return `Spans ${ctx.repos.length} repos. ${ctx.repos.map(one).join(" ")}`;
}

export function describeHeuristic(map: CodeMap, walk: Walkthrough): Walkthrough {
  const m = createModel(map, walk);
  const ctx = walk.context ?? buildContext(map, walk, m);
  return {
    ...walk,
    overview: describeOverview(m),
    steps: walk.steps.map((s) => ({ ...s, description: describeStep(m, s) })),
    context: { ...ctx, summary: describeSummary(map, walk, ctx), role: describeRole(ctx) },
  };
}
