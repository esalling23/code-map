import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { createModel, type Model } from "./model";
import type { CodeMap, SystemArea, SystemContext, Walkthrough } from "./types";

const DOC_FILES = ["ARCHITECTURE.md", "README.md"];
const REPO_DOCS = ["README.md", "ARCHITECTURE.md", "docs/ARCHITECTURE.md", "docs/README.md"];
/** Folder names that only hold other folders; an area is named after the first folder below them. */
const CONTAINERS = new Set(["src", "lib", "libs", "packages", "apps", "modules", "source", "internal", "pkg", "app"]);
const MAX_DOC = 420;

interface DocLine {
  file: string;
  heading: string;
  text: string;
  kind: "row" | "bullet" | "para";
}

const read = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
};

/** Markdown to one line of plain text: links keep their text, formatting is dropped. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max = MAX_DOC): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const INTRO_HEADING = /overview|purpose|summary|about|introduction|what (it|this)/i;

/**
 * The first prose paragraph of a markdown file, skipping badges, quotes, tables and code.
 * With `introOnly`, only a paragraph before the first `##` or under an overview-style heading counts.
 */
function firstParagraph(md: string, introOnly = false): { text: string; heading: string } | undefined {
  let heading = "";
  let level = 0;
  for (const p of md.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/)) {
    const lines = p.trim().split("\n");
    while (lines[0]?.startsWith("#")) {
      const h = lines.shift()!;
      level = h.match(/^#+/)![0].length;
      heading = plain(h.replace(/^#+/, ""));
    }
    const t = lines.join("\n").trim();
    if (!t || /^(>|\||!\[|<|---|\[!\[)/.test(t) || /^[-*] /.test(t)) continue;
    if (introOnly && level > 1 && !INTRO_HEADING.test(heading)) return undefined;
    const text = plain(t);
    if (text.length > 30) return { text: clip(text), heading: level > 1 ? heading : "" };
  }
  return undefined;
}

/** Table rows, bullets and paragraphs of a markdown file, each tagged with its section heading. */
function docLines(md: string, file: string): DocLine[] {
  const out: DocLine[] = [];
  let heading = "";
  for (const block of md.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => l.trim().startsWith("|") || l.trim().startsWith("-") || l.trim().startsWith("*") || l.trim().startsWith("#"))) {
      for (const l of lines) {
        const t = l.trim();
        if (t.startsWith("#")) heading = plain(t.replace(/^#+/, ""));
        else if (t.startsWith("|") && !/^\|[\s:|-]+\|$/.test(t)) out.push({ file, heading, text: t, kind: "row" });
        else if (/^[-*] /.test(t)) out.push({ file, heading, text: t.slice(2), kind: "bullet" });
      }
    } else {
      if (lines[0].trim().startsWith("#")) heading = plain(lines.shift()!.replace(/^#+/, ""));
      const text = lines.join(" ").trim();
      if (text) out.push({ file, heading, text, kind: "para" });
    }
  }
  return out;
}

function packageJson(dir: string): { name?: string; description?: string } {
  const raw = read(join(dir, "package.json"));
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const humanize = (s: string) => s.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * Gathers what the repos say about themselves — package descriptions, READMEs, architecture
 * docs and file header comments — and groups the steps of a walkthrough into areas of the system.
 */
export function buildContext(map: CodeMap, walk: Walkthrough, m: Model = createModel(map, walk)): SystemContext {
  const rootOf = (file: string) => m.rootOf(file)!;
  const absOf = (file: string) => {
    const r = rootOf(file);
    return join(r.dir, r.label ? file.slice(r.label.length + 1) : file);
  };
  const displayOf = (abs: string) => {
    const r = map.roots.find((x) => abs === x.dir || abs.startsWith(x.dir + sep)) ?? map.roots[0];
    const path = relative(r.dir, abs).split(sep).join("/");
    return [r.label, path].filter(Boolean).join("/") || basename(r.dir);
  };

  const repoDocs = new Map<string, DocLine[]>();
  const rootsOnPath = new Set([...m.filesOnPath].map(rootOf));
  const repos = map.roots
    .filter((r) => rootsOnPath.has(r))
    .map((r) => {
      const pkg = packageJson(r.dir);
      const readme = read(join(r.dir, "README.md"));
      const lines: DocLine[] = [];
      for (const d of REPO_DOCS) {
        const md = read(join(r.dir, d));
        if (md) lines.push(...docLines(md, d));
      }
      repoDocs.set(r.dir, lines);
      return {
        label: r.label || basename(r.dir),
        name: pkg.name ?? basename(r.dir),
        description: (readme && firstParagraph(readme)?.text) || clip(plain(pkg.description ?? "")),
      };
    });

  /** The folder a file's area is named after: the nearest folder with its own docs, else the first folder past the containers. */
  const areaDirOf = (file: string): string => {
    const abs = absOf(file);
    const root = rootOf(file).dir;
    for (let d = dirname(abs); d.startsWith(root) && d !== root; d = dirname(d)) {
      if (DOC_FILES.some((f) => existsSync(join(d, f))) || existsSync(join(d, "package.json"))) return d;
    }
    const parts = relative(root, dirname(abs)).split(sep).filter(Boolean);
    let i = 0;
    while (i < parts.length - 1 && CONTAINERS.has(parts[i])) i++;
    return join(root, ...parts.slice(0, i + 1));
  };

  const areas = new Map<string, SystemArea & { fallback?: { doc: string; docSource: string } }>();
  const areaOfStep: string[] = [];
  for (const step of walk.steps) {
    const sym = m.symbolOf(step);
    const dir = areaDirOf(sym.file);
    const id = displayOf(dir);
    areaOfStep.push(id);
    let area = areas.get(id);
    if (!area) {
      area = { id, name: basename(dir), repo: sym.repo, steps: [], files: [], doc: "", docSource: "", description: "" };
      areas.set(id, area);
      Object.assign(area, findAreaDoc(dir, area.name, rootOf(sym.file).dir, repoDocs.get(rootOf(sym.file).dir) ?? []));
    }
    area.steps.push(step.index);
    if (!area.files.includes(sym.file)) area.files.push(sym.file);
  }
  for (const area of areas.values()) {
    if (area.doc) continue;
    // A doc comment on a class in this area, then a file's header comment, then any doc's first paragraph.
    const cls = Object.values(map.symbols).find((s) => s.kind === "class" && s.doc && area.files.includes(s.file));
    const header = area.files.find((f) => map.fileDocs[f]);
    const fallback = area.fallback;
    if (cls) Object.assign(area, { doc: clip(cls.doc), docSource: `doc comment on ${cls.name} (${cls.file})` });
    else if (header) Object.assign(area, { doc: clip(map.fileDocs[header]), docSource: `header comment of ${header}` });
    else if (fallback) Object.assign(area, { doc: fallback.doc, docSource: fallback.docSource });
  }
  for (const area of areas.values()) delete area.fallback;

  const handoffs = walk.steps
    .filter((s) => s.parent !== undefined && areaOfStep[s.parent] !== areaOfStep[s.index])
    .map((s) => ({ from: areaOfStep[s.parent!], to: areaOfStep[s.index], fromStep: s.parent!, step: s.index }));

  return { repos, areas: [...areas.values()], handoffs, areaOfStep, summary: "", role: "" };

  function findAreaDoc(dir: string, name: string, root: string, lines: DocLine[]): Partial<SystemArea> & { fallback?: { doc: string; docSource: string } } {
    let fallback: { doc: string; docSource: string } | undefined;
    for (const f of DOC_FILES) {
      const md = read(join(dir, f));
      if (!md) continue;
      const intro = firstParagraph(md, true);
      if (intro) return { doc: intro.text, docSource: displayOf(join(dir, f)) };
      const any = firstParagraph(md);
      if (any && !fallback) fallback = { doc: any.text, docSource: `${displayOf(join(dir, f))}${any.heading ? ` › ${any.heading}` : ""}` };
    }
    const pkg = packageJson(dir);
    if (pkg.description) return { doc: clip(plain(pkg.description)), docSource: displayOf(join(dir, "package.json")) };
    if (lines.length === 0) return { fallback };

    // Otherwise, the line in the repo's own docs that talks about this area.
    const rel = relative(root, dir).split(sep).join("/");
    const words = [name, humanize(name)].map((w) => w.toLowerCase());
    const score = (l: DocLine) => {
      const t = l.text.toLowerCase();
      let s = 0;
      if (rel && t.includes(rel.toLowerCase())) s += 6;
      if (l.kind === "row" && (t.includes(`[${words[0]}]`) || t.includes(`| ${words[0]} |`) || t.includes(`\`${words[0]}\``))) s += 5;
      if (l.kind === "bullet" && /^\*\*[^*]+\*\*/.test(l.text) && words.some((w) => l.text.slice(0, 40).toLowerCase().includes(w))) s += 4;
      if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))) s += 1;
      return s;
    };
    const best = lines.map((l) => ({ l, s: score(l) })).filter((x) => x.s >= 4).sort((a, b) => b.s - a.s)[0];
    if (!best) return { fallback };
    const text = best.l.kind === "row" ? best.l.text.split("|").map((c) => plain(c)).filter(Boolean).join(" — ") : plain(best.l.text);
    return { doc: clip(text), docSource: `${displayOf(join(root, best.l.file))}${best.l.heading ? ` › ${best.l.heading}` : ""}` };
  }
}
