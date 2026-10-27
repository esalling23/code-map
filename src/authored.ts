import { readFileSync } from "node:fs";
import { createModel } from "./model";
import { stepFacts } from "./pagedata";
import type { CodeMap, Walkthrough } from "./types";

/** Descriptions written outside the tool (by a person or an agent) to replace the generated text. */
export interface AuthoredDescriptions {
  title?: string;
  summary?: string;
  role?: string;
  overview?: string;
  areas?: { id: string; description: string }[];
  /** Each step by symbol id (preferred, survives re-tracing) or by step number (1-based). */
  steps?: { id?: string; step?: number; description: string }[];
  /** Connections static analysis can't see (HTTP calls, queues, storage), drawn as labelled dashed arrows. */
  links?: { from: string | number; to: string | number; label: string }[];
}

/**
 * A fill-in file for writing the page's text by hand: every step and area with the facts
 * needed to describe it, the generated draft, and an empty `description` to replace it.
 */
export function buildTemplate(map: CodeMap, walk: Walkthrough) {
  const ctx = walk.context;
  return {
    instructions:
      "Fill in title, summary, role, overview, and every areas[].description and steps[].description. The other fields are facts for reference and are ignored when the file is read back. Add links[] for connections the code analysis can't see (HTTP calls, queues, files in storage): {from, to, label} with step numbers or symbol ids. Then run code-map again with --descriptions <this file>.",
    title: "",
    summary: "",
    role: "",
    overview: "",
    draft: { summary: ctx?.summary ?? "", role: ctx?.role ?? "", overview: walk.overview },
    repos: ctx?.repos ?? [],
    areas: (ctx?.areas ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      steps: a.steps.map((i) => i + 1),
      files: a.files,
      docs: a.doc,
      docSource: a.docSource,
      description: "",
    })),
    steps: walk.steps.map((s) => ({ ...stepFacts(map, walk, s), draft: s.description, description: "" })),
    links: [] as { from: number; to: number; label: string }[],
  };
}

export function readDescriptions(path: string): AuthoredDescriptions {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Applies authored descriptions. Returns the updated walkthrough and a warning for anything that didn't match. */
export function applyDescriptions(map: CodeMap, walk: Walkthrough, d: AuthoredDescriptions): { walk: Walkthrough; title?: string; warnings: string[] } {
  const warnings: string[] = [];
  const model = createModel(map, walk);
  const stepIndex = (ref: string | number | undefined): number | undefined => {
    if (typeof ref === "number") return ref >= 1 && ref <= walk.steps.length ? ref - 1 : undefined;
    return ref === undefined ? undefined : model.stepIndexOf(ref);
  };

  const steps = walk.steps.map((s) => ({ ...s }));
  const written = new Set<number>();
  for (const entry of d.steps ?? []) {
    if (!entry.description?.trim()) continue;
    const i = stepIndex(entry.id ?? entry.step);
    if (i === undefined) {
      warnings.push(`No step matches ${entry.id ?? `step ${entry.step}`}; its description was skipped.`);
      continue;
    }
    steps[i].description = entry.description.trim();
    written.add(i);
  }
  const missing = steps.filter((s) => !written.has(s.index)).map((s) => s.index + 1);
  if (missing.length) warnings.push(`Steps without a written description (kept the generated text): ${missing.join(", ")}.`);

  let context = walk.context;
  if (context) {
    const byArea = new Map((d.areas ?? []).filter((a) => a.description?.trim()).map((a) => [a.id, a.description.trim()]));
    for (const id of byArea.keys()) if (!context.areas.some((a) => a.id === id)) warnings.push(`No area matches "${id}".`);
    context = {
      ...context,
      summary: d.summary?.trim() || context.summary,
      role: d.role?.trim() || context.role,
      areas: context.areas.map((a) => ({ ...a, description: byArea.get(a.id) ?? a.description })),
    };
  }

  const links: NonNullable<Walkthrough["links"]> = [];
  for (const l of d.links ?? []) {
    const from = stepIndex(l.from);
    const to = stepIndex(l.to);
    if (from === undefined || to === undefined) {
      warnings.push(`Link "${l.label}" skipped: ${from === undefined ? l.from : l.to} is not a step on this path.`);
      continue;
    }
    links.push({ from, to, label: l.label });
  }

  return {
    walk: { ...walk, overview: d.overview?.trim() || walk.overview, steps, context, links: links.length ? links : walk.links },
    title: d.title?.trim() || undefined,
    warnings,
  };
}
