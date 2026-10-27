// Checks written descriptions for plain, readable English: empty fields, long sentences, jargon and idioms,
// abbreviations never spelled out, and text that copies the docs or the tool's draft. Advisory only.

const MAX_WORDS = 25;
const COMMON_ABBREVIATIONS = new Set([
  "API", "APIS", "HTTP", "HTTPS", "URL", "URLS", "JSON", "ID", "IDS", "UI", "CLI", "SDK", "HTML", "CSS",
  "JS", "TS", "SQL", "DB", "OK", "QA", "AI", "PR", "CI", "UUID", "JWT", "GET", "POST", "PUT", "PATCH", "DELETE",
]);
const JARGON: [RegExp, string][] = [
  [/\borchestrat\w*/, "runs / controls"],
  [/\bleverag\w*/, "uses"],
  [/\butili[sz]\w*/, "uses"],
  [/\binitiat\w*/, "starts"],
  [/\bpersist(s|ed|ing)?\b/, "saves"],
  [/\bpropagat\w*/, "passes on / sends on"],
  [/\bhydrat\w*/, "fills in / loads"],
  [/\bfacilitat\w*/, "lets / helps"],
  [/\bsubsequently\b/, "then"],
  [/\bin order to\b/, "to"],
  [/\bis responsible for\b/, "does / owns"],
  [/\bencapsulat\w*/, "holds / wraps"],
  [/\bidempoten\w*/, "explain it: safe to run twice"],
  [/\bsynerg\w*/, "(remove)"],
  [/\bseamless\w*/, "(remove)"],
  [/\brobust\w*/, "(say what it handles)"],
];
const IDIOMS = [
  "under the hood", "spin up", "spins up", "boils down", "heavy lifting", "glue code", "out of the box",
  "kick off", "kicks off", "on the fly", "behind the scenes", "at the end of the day", "in a nutshell",
  "bread and butter", "low-hanging", "plumbing", "wires up", "wire up", "hand-rolled", "bubbles up",
];

export interface TextProblem {
  field: string;
  problem: string;
}

const sentences = (text: string) =>
  text
    .replace(/`[^`]*`/g, "CODE")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Ratcliff/Obershelp similarity, as Python's difflib.SequenceMatcher.ratio() computes it. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\W+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const matches = (x0: number, x1: number, y0: number, y1: number): number => {
    let best = 0, bx = 0, by = 0;
    let prev = new Array(y1 - y0 + 1).fill(0);
    for (let i = x0; i < x1; i++) {
      const row = new Array(y1 - y0 + 1).fill(0);
      for (let j = y0; j < y1; j++) {
        if (x[i] !== y[j]) continue;
        const k = (row[j - y0 + 1] = prev[j - y0] + 1);
        if (k > best) [best, bx, by] = [k, i - k + 1, j - k + 1];
      }
      prev = row;
    }
    return best ? best + matches(x0, bx, y0, by) + matches(bx + best, x1, by + best, y1) : 0;
  };
  return (2 * matches(0, x.length, 0, y.length)) / (x.length + y.length);
}

/** Problems in a filled-in descriptions file (the shape `buildTemplate` writes). */
export function checkDescriptions(data: any): { fields: number; problems: TextProblem[] } {
  const fields: [string, string, string[]][] = [];
  const draft = data.draft ?? {};
  for (const key of ["title", "summary", "role", "overview"]) fields.push([key, data[key] ?? "", [draft[key] ?? ""]]);
  for (const a of data.areas ?? []) fields.push([`area ${a.name ?? a.id}`, a.description ?? "", [a.docs ?? ""]]);
  for (const s of data.steps ?? []) fields.push([`step ${s.step} (${s.name ?? s.id})`, s.description ?? "", [s.draft ?? "", s.docComment ?? ""]]);

  const problems: TextProblem[] = [];
  const add = (field: string, problem: string) => problems.push({ field, problem });
  const allText = fields.map(([, t]) => t).filter(Boolean).join(" ");
  const expanded = new Set([...allText.matchAll(/\(([A-Z][A-Z0-9]{1,6})s?\)/g)].map((m) => m[1]));
  const seenAbbr = new Set<string>();

  for (const [field, text, sources] of fields) {
    if (!text.trim()) {
      add(field, "empty — write it");
      continue;
    }
    for (const sent of sentences(text)) {
      const n = sent.split(/\s+/).length;
      if (n > MAX_WORDS) add(field, `${n}-word sentence — split it: "${sent.slice(0, 90)}…"`);
    }
    const low = text.toLowerCase();
    for (const [pattern, plain] of JARGON) {
      const m = low.match(pattern);
      if (m) add(field, `"${m[0]}" → ${plain}`);
    }
    for (const idiom of IDIOMS) if (low.includes(idiom)) add(field, `idiom "${idiom}" — say the literal thing`);
    for (const [abbr] of text.replace(/`[^`]*`/g, "").matchAll(/\b[A-Z][A-Z0-9]{1,6}s?\b/g)) {
      const base = abbr.endsWith("s") && abbr.slice(0, -1) === abbr.slice(0, -1).toUpperCase() ? abbr.replace(/s+$/, "") : abbr;
      if (COMMON_ABBREVIATIONS.has(base) || expanded.has(base) || seenAbbr.has(base)) continue;
      seenAbbr.add(base);
      add(field, `"${base}" is never spelled out — write the full name once, then (${base})`);
    }
    if (text.length > 40 && sources.some((src) => src && similarity(text, src) > 0.75)) {
      add(field, "reads like a copy of the docs or draft — rewrite it in plain words");
    }
  }
  return { fields: fields.length, problems };
}

export function formatProblems(r: { fields: number; problems: TextProblem[] }): string {
  if (!r.problems.length) return `OK: ${r.fields} fields checked, nothing flagged.`;
  return `${r.problems.length} things to look at across ${r.fields} fields:\n\n${r.problems.map((p) => `- ${p.field}: ${p.problem}`).join("\n")}`;
}
