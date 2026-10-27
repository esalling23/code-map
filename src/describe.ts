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
  if (walk.truncated) text += " The path was cut short at the depth or step limit; raise --max-depth or --max-steps to see more.";
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

const MAX_LINES_PER_STEP = 80;

/**
 * Replaces the heuristic text with descriptions written by Claude. Sends the code of every
 * step on the path to the Anthropic API, so it only runs when the caller opts in.
 */
export async function describeWithClaude(
  map: CodeMap,
  walk: Walkthrough,
  opts: { apiKey: string; model: string },
): Promise<Walkthrough> {
  const stepsText = walk.steps
    .map((s) => {
      const sym = map.symbols[s.symbolId];
      const lines = sym.code.split("\n");
      const body = lines.length > MAX_LINES_PER_STEP ? `${lines.slice(0, MAX_LINES_PER_STEP).join("\n")}\n// ... ${lines.length - MAX_LINES_PER_STEP} more lines` : sym.code;
      const calls = s.calls
        .map((c) => {
          const via = c.via.length ? `, via ${c.via.map((v) => map.symbols[v].name).join(" → ")}` : "";
          return `${map.symbols[c.to].name} (line ${c.line}${c.step !== undefined ? `, step ${c.step + 1}` : ""}${via})`;
        })
        .join(", ");
      return `### Step ${s.index + 1}: ${sym.name} — ${sym.file}:${sym.startLine}\nCalled from: ${s.parent !== undefined ? `step ${s.parent + 1}, line ${s.callLine}` : "entry"}\nCalls: ${calls || "none"}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");

  const scope = walk.selection
    ? "Below are the steps for a hand-picked set of functions, in the order the code reaches them. Calls marked \"via\" pass through functions left out of the selection; steps with no caller start a separate part of the path."
    : "Below are the steps of one execution path, in the order the code reaches them (a depth-first walk of the call graph from the entry point).";
  const ctx = walk.context;
  const contextText = ctx
    ? `## What the repos say about themselves

${ctx.repos.map((r) => `- Repo ${r.label} (package ${r.name}): ${r.description || "no description"}`).join("\n")}

## Areas of the system on this path, in order

${ctx.areas.map((a) => `- ${a.id} (steps ${a.steps.map((i) => i + 1).join(", ")}): ${a.doc ? `${a.doc} [from ${a.docSource}]` : "no docs"}`).join("\n")}

## Hand-offs between areas

${ctx.handoffs.map((h) => `- step ${h.fromStep + 1} in ${h.from} calls step ${h.step + 1} in ${h.to}`).join("\n") || "- none"}
`
    : "";

  const prompt = `You are writing a guided tour of how a piece of code runs, for an engineer who does not know this codebase. ${scope}

Write:
- "summary": 3-5 sentences on what this code does overall, at a high level, in plain language: what triggers it, what it accomplishes, and what changes in the world when it finishes (data written, requests sent, files published). Avoid listing function names; mention at most two.
- "role": 2-3 sentences on which part of the larger system this is and why it matters, using the repo and area docs below.
- "areas": for each area listed below, one sentence on what that area does on this particular path.
- "overview": 2-3 sentences on the main hand-offs between areas.
- "steps": for each step, 2-4 plain-language sentences explaining what that code does at this point in the path, why it matters to the overall flow, and what data it reads, changes or returns. Refer to other steps by number when helpful. Do not restate the code line by line.

Respond with only JSON, in this shape:
{"summary": "...", "role": "...", "areas": [{"id": "<area id>", "description": "..."}], "overview": "...", "steps": [{"step": 1, "description": "..."}, ...]}

${contextText}
## Steps

${stepsText}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = body.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as {
    summary?: string;
    role?: string;
    areas?: { id: string; description: string }[];
    overview?: string;
    steps: { step: number; description: string }[];
  };
  const byStep = new Map(parsed.steps.map((s) => [s.step - 1, s.description]));
  const byArea = new Map((parsed.areas ?? []).map((a) => [a.id, a.description]));
  return {
    ...walk,
    overview: parsed.overview || walk.overview,
    steps: walk.steps.map((s) => ({ ...s, description: byStep.get(s.index) ?? s.description })),
    context: ctx && {
      ...ctx,
      summary: parsed.summary || ctx.summary,
      role: parsed.role || ctx.role,
      areas: ctx.areas.map((a) => ({ ...a, description: byArea.get(a.id) ?? a.description })),
    },
  };
}
