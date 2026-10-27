// Turns page data into the page's HTML. No Node or DOM APIs: the CLI and the browser viewer both use it.
import type { CodeMapDocument } from "./pagedata";
import type { CodeMap, CodeSymbol, PathStep, Walkthrough } from "./types";

/** What the renderer needs from a code map: the symbols the page refers to. */
type SymbolSource = Pick<CodeMap, "symbols">;

const MAX_FULL_LINES = 45;
const CONTEXT = 3;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const mmd = (s: string) => s.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
const inlineCode = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>");

function language(file: string): string {
  return /\.(tsx?|mts|cts)$/.test(file) ? "typescript" : "javascript";
}

export interface ExcerptLine {
  line: number;
  text: string;
  gap?: boolean;
}

/** Lines of a symbol to show: all of it when short, otherwise the signature plus windows around `focus` lines. */
export function excerpt(sym: CodeSymbol, focus: number[]): ExcerptLine[] {
  const lines = sym.code.split("\n");
  const all = lines.map((text, i) => ({ line: sym.startLine + i, text }));
  if (lines.length <= MAX_FULL_LINES) return all;

  const keep = new Set<number>();
  const head = sym.kind === "module" ? 0 : Math.min(5, lines.length);
  for (let i = 0; i < head; i++) keep.add(i);
  for (const f of focus) {
    const i = f - sym.startLine;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep.add(j);
  }
  if (sym.kind !== "module") keep.add(lines.length - 1);
  if (keep.size === 0) for (let i = 0; i < MAX_FULL_LINES; i++) keep.add(i);

  const out: ExcerptLine[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev !== -1 && i > prev + 1) out.push({ line: -1, text: `… ${i - prev - 1} lines`, gap: true });
    else if (prev === -1 && i > 0) out.push({ line: -1, text: `… ${i} lines`, gap: true });
    out.push(all[i]);
    prev = i;
  }
  if (prev < lines.length - 1) out.push({ line: -1, text: `… ${lines.length - 1 - prev} lines`, gap: true });
  return out;
}

export const dataIdsOf = (walk: Walkthrough) => [...new Set([...walk.steps.flatMap((s) => s.dataUsed.map((d) => d.id)), ...(walk.selection?.data ?? [])])];

/** JSON safe to put inside a `<script>` element: browsers don't decode entities there, so only `<` is escaped. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The folder and file name only, e.g. `deploy/static-game-storage.service.ts`; the full path goes in a hover title. */
export const shortPath = (file: string) => file.split("/").slice(-2).join("/");
const pathSpan = (file: string) => `<span title="${esc(file)}">${esc(shortPath(file))}</span>`;

/** Snippets stored once as `<template>`s; tab panels name a template and the page clones it when the tab first opens. */
class Snippets {
  private ids = new Map<string, string>();
  private html: string[] = [];

  ref(key: string, build: () => string): string {
    let id = this.ids.get(key);
    if (!id) {
      id = `t${this.ids.size}`;
      this.ids.set(key, id);
      this.html.push(`<template id="${id}">${build()}</template>`);
    }
    return id;
  }

  toString() {
    return this.html.join("\n");
  }
}

interface Tab {
  label: string;
  body?: string;
  tpl?: string;
  key?: string;
}

function tabset(cls: string, tabs: Tab[]): string {
  const bar = tabs
    .map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}"${t.key ? ` data-key="${esc(t.key)}"` : ""}>${t.label}</button>`)
    .join("");
  const panels = tabs.map((t, i) => `<div class="tabpanel" role="tabpanel"${i ? " hidden" : ""}${t.tpl ? ` data-tpl="${t.tpl}"` : ""}>${t.body ?? ""}</div>`).join("");
  return `<div class="tabset ${cls}"><div class="tabbar" role="tablist">${bar}</div>${panels}</div>`;
}

function codeRows(lines: ExcerptLine[], hits = new Map<number, number[]>()): string {
  return lines
    .map((l) => {
      if (l.gap) return `<div class="ln gap"><span class="no"></span><span class="src">${esc(l.text)}</span></div>`;
      const targets = hits.get(l.line);
      const badges = targets ? `<span class="jumps">${targets.map((t) => `<a class="badge" href="#step-${t + 1}" title="Go to step ${t + 1}">→ ${t + 1}</a>`).join("")}</span>` : "";
      const cls = targets ? " hit" : "";
      return `<div class="ln${cls}"><span class="no">${l.line}</span><span class="src">${esc(l.text) || " "}</span>${badges}</div>`;
    })
    .join("");
}

function codebox(sym: CodeSymbol, rows: string, note = `lines ${sym.startLine}–${sym.endLine}`): string {
  return `<div class="codebox" data-lang="${language(sym.file)}"><div class="codehead">${pathSpan(sym.file)}<span>${esc(note)}</span></div><div class="lines">${rows}</div></div>`;
}

const allLines = (sym: CodeSymbol): ExcerptLine[] => sym.code.split("\n").map((text, i) => ({ line: sym.startLine + i, text }));

/** A data type's definition, with where it lives and which steps use it. */
function dataSnippet(map: SymbolSource, walk: Walkthrough, snippets: Snippets, id: string): string {
  return snippets.ref(`data:${id}`, () => {
    const sym = map.symbols[id];
    const users = walk.steps.filter((s) => s.dataUsed.some((d) => d.id === id)).map((s) => `<a href="#step-${s.index + 1}">${s.index + 1}</a>`);
    const lines = allLines(sym);
    const shown = lines.length > 80 ? [...lines.slice(0, 80), { line: -1, text: `… ${lines.length - 80} more lines`, gap: true }] : lines;
    const meta = `<div class="snipmeta"><strong>${esc(sym.name)}</strong> <span class="muted">${sym.kind === "class" ? "class" : "type"}${users.length ? ` · used in steps ${users.join(", ")}` : " · selected"}</span></div>`;
    return `${meta}${sym.doc ? `<p class="snipdoc">${esc(sym.doc)}</p>` : ""}${codebox(sym, codeRows(shown))}`;
  });
}

/** A preview of a called function: its doc, a short excerpt and a link to its step. */
function callSnippet(map: SymbolSource, walk: Walkthrough, snippets: Snippets, id: string): string {
  return snippets.ref(`call:${id}`, () => {
    const sym = map.symbols[id];
    const step = walk.steps.find((s) => s.symbolId === id);
    const link = step ? `<a href="#step-${step.index + 1}">go to step ${step.index + 1}</a>` : '<span class="muted">not a step on this path</span>';
    const meta = `<div class="snipmeta"><strong>${esc(sym.name)}</strong>${sym.repo ? ` <span class="tag">${esc(sym.repo)}</span>` : ""} · ${link}</div>`;
    return `${meta}${sym.doc ? `<p class="snipdoc">${esc(sym.doc)}</p>` : ""}${codebox(sym, codeRows(excerpt(sym, [])))}`;
  });
}

function renderPanel(map: SymbolSource, walk: Walkthrough, step: PathStep, snippets: Snippets): string {
  const sym = map.symbols[step.symbolId];
  const hits = new Map<number, number[]>();
  for (const c of step.calls) if (c.step !== undefined) (hits.get(c.line) ?? hits.set(c.line, []).get(c.line)!).push(c.step);
  const external = new Set(sym.externalCalls.map((c) => c.line));
  const lines = excerpt(sym, [...step.calls.map((c) => c.line), ...(sym.kind === "module" ? [...external] : [])]);
  const cut = lines.some((l) => l.gap);
  const tabs: Tab[] = [{ label: "Code", body: codebox(sym, codeRows(lines, hits), cut ? `excerpt of lines ${sym.startLine}–${sym.endLine}` : undefined) }];

  const relations = new Map<string, string[]>();
  for (const d of step.dataUsed) (relations.get(d.id) ?? relations.set(d.id, []).get(d.id)!).push(d.relation);
  if (relations.size) {
    const sub = [...relations].map(([id, rels]) => ({
      label: `<span class="rel">${rels.join(", ")}</span>${esc(map.symbols[id].name)}`,
      tpl: dataSnippet(map, walk, snippets, id),
      key: `data:${id}`,
    }));
    tabs.push({ label: `Data <span class="count">${relations.size}</span>`, body: tabset("sub", sub) });
  }
  if (step.calls.length) {
    const sub = step.calls.map((c) => ({
      label: `${c.step !== undefined ? `<span class="rel">${c.step + 1}</span>` : ""}${esc(map.symbols[c.to].name)}`,
      tpl: callSnippet(map, walk, snippets, c.to),
      key: `call:${c.to}`,
    }));
    tabs.push({ label: `Calls <span class="count">${step.calls.length}</span>`, body: tabset("sub", sub) });
  }
  if (cut) {
    tabs.push({ label: "Full source", tpl: snippets.ref(`full:${sym.id}`, () => codebox(sym, codeRows(allLines(sym), hits))) });
  }
  return tabset("main", tabs);
}

function renderStep(map: SymbolSource, walk: Walkthrough, step: PathStep, snippets: Snippets): string {
  const sym = map.symbols[step.symbolId];
  const area = walk.context?.areas.find((a) => a.id === walk.context!.areaOfStep[step.index]);
  const crumbs: string[] = [];
  for (let p = step.parent; p !== undefined; p = walk.steps[p].parent) crumbs.unshift(`<a href="#step-${p + 1}">${esc(map.symbols[walk.steps[p].symbolId].name)}</a>`);
  const title = sym.kind === "module" ? `${sym.file} (top level)` : sym.name;
  const calls = step.calls.length
    ? `<ul class="calls">${step.calls
        .map((c) => {
          const t = map.symbols[c.to];
          const link = c.step !== undefined ? `<a href="#step-${c.step + 1}">step ${c.step + 1}</a>` : "<span class=\"muted\">beyond depth limit</span>";
          const via = c.via.length ? ` <span class="muted">via ${c.via.map((v) => `<code>${esc(map.symbols[v].name)}</code>`).join(" → ")}</span>` : "";
          const inferred = c.inferred ? ' <span class="tag" title="Matched by package and name">by name</span>' : "";
          const repo = t.repo && t.repo !== sym.repo ? ` <span class="tag">${esc(t.repo)}</span>` : "";
          return `<li><button type="button" class="peek" data-open="call:${esc(c.to)}" title="Preview the code"><code>${esc(t.name)}</code></button>${repo}${inferred} <span class="muted">line ${c.line}</span> · ${link}${via}</li>`;
        })
        .join("")}</ul>`
    : "";
  const seen = new Set<string>();
  const chips = step.dataUsed
    .filter((d) => !seen.has(d.id) && seen.add(d.id))
    .map((d) => {
      const rels = step.dataUsed.filter((x) => x.id === d.id).map((x) => x.relation).join(", ");
      return `<button type="button" class="chip" data-open="data:${esc(d.id)}" title="Show the definition"><span>${rels}</span>${esc(map.symbols[d.id].name)}</button>`;
    });
  return `<section class="step" id="step-${step.index + 1}" data-node="s${step.index}" style="--depth:${Math.min(step.depth, 8)}">
  <div class="explain">
    <div class="stepno">Step ${step.index + 1}${step.depth ? ` · depth ${step.depth}` : " · entry"}${area ? ` · <a class="areatag" href="#area-${walk.context!.areas.indexOf(area) + 1}">${esc(area.name)}</a>` : ""}</div>
    ${crumbs.length ? `<div class="crumbs">${crumbs.join(" › ")} ›</div>` : ""}
    <h3>${esc(title)}</h3>
    <div class="sig"><code>${esc(sym.signature)}</code></div>
    <p>${inlineCode(step.description)}</p>
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
    ${calls}
  </div>
  ${renderPanel(map, walk, step, snippets)}
</section>`;
}

function renderData(map: SymbolSource, walk: Walkthrough, snippets: Snippets): string {
  const ids = dataIdsOf(walk);
  if (!ids.length) return "";
  const tabs = ids.map((id) => {
    const sym = map.symbols[id];
    return { label: `<span class="dname">${esc(sym.name)}</span><span class="dfile" title="${esc(sym.file)}">${esc(shortPath(sym.file))}</span>`, tpl: dataSnippet(map, walk, snippets, id), key: `data:${id}` };
  });
  return `<h2 id="data">Data <span class="count">${ids.length}</span></h2><p class="muted">Types, interfaces, enums and classes the path reads, returns or creates.</p>${tabset("vertical", tabs)}`;
}

/** The "what you're looking at" section: what the code does, where it sits, and the areas it runs through. */
function renderIntro(map: SymbolSource, walk: Walkthrough): string {
  const ctx = walk.context;
  if (!ctx) return `<div class="overview">${inlineCode(walk.overview)}</div>`;
  const nameOf = new Map(ctx.areas.map((a) => [a.id, a.name]));
  const cards = ctx.areas.map((a, i) => {
    const steps = a.steps.map((s) => `<a href="#step-${s + 1}">${s + 1}</a>`).join(" ");
    const repo = a.repo && ctx.repos.length > 1 ? ` <span class="tag">${esc(a.repo)}</span>` : "";
    const doc = a.doc ? `<blockquote>${inlineCode(a.doc)}<cite>${esc(a.docSource)}</cite></blockquote>` : a.description ? "" : '<p class="muted">No docs found for this folder.</p>';
    return `<li class="area" id="area-${i + 1}"><div class="areahead"><span class="areano">${i + 1}</span><strong>${esc(a.name)}</strong>${repo}</div><div class="areapath">${esc(a.id)}</div>${a.description ? `<p>${inlineCode(a.description)}</p>` : ""}${doc}<div class="areasteps">steps ${steps}</div></li>`;
  });
  const handoffs = ctx.handoffs.slice(0, 14).map((h) => {
    const from = map.symbols[walk.steps[h.fromStep].symbolId].name;
    const to = map.symbols[walk.steps[h.step].symbolId].name;
    return `<li><strong>${esc(nameOf.get(h.from)!)}</strong> → <strong>${esc(nameOf.get(h.to)!)}</strong>: <code>${esc(from)}</code> calls <code>${esc(to)}</code> (<a href="#step-${h.step + 1}">step ${h.step + 1}</a>)</li>`;
  });
  const links = (walk.links ?? []).map((l) => {
    const from = map.symbols[walk.steps[l.from].symbolId].name;
    const to = map.symbols[walk.steps[l.to].symbolId].name;
    return `<li><code>${esc(from)}</code> (<a href="#step-${l.from + 1}">step ${l.from + 1}</a>) → <code>${esc(to)}</code> (<a href="#step-${l.to + 1}">step ${l.to + 1}</a>): ${inlineCode(l.label)}</li>`;
  });
  const more = ctx.handoffs.length > 14 ? `<li class="muted">and ${ctx.handoffs.length - 14} more</li>` : "";
  return `<section class="intro">
  <div class="introgrid">
    <div class="card lead"><div class="eyebrow">What this code does</div><p class="summary">${inlineCode(ctx.summary)}</p><p class="muted small">${inlineCode(walk.overview)}</p></div>
    <div class="card"><div class="eyebrow">Where it sits in the system</div><p>${inlineCode(ctx.role)}</p></div>
  </div>
  <h2>Areas on this path</h2>
  <p class="muted">The parts of the system the code passes through, in the order it reaches them. Quoted text is what the repo's own docs say about each area.</p>
  <ol class="areas">${cards.join("")}</ol>
  ${links.length ? `<div class="card links"><div class="eyebrow">Connections outside the code</div><p class="muted small">These parts talk through the network, a queue or stored files, not direct calls. They show as dashed arrows in the diagram.</p><ul>${links.join("")}</ul></div>` : ""}
  ${handoffs.length ? `<details class="fold"><summary>How it moves between areas <span class="count">${ctx.handoffs.length}</span></summary><ol class="handoffs">${handoffs.join("")}${more}</ol></details>` : ""}
  <details class="fold"><summary>How to read this page</summary><ul>
    <li><strong>Areas</strong> (above): the folders and packages the code runs through, with what their docs say about them.</li>
    <li><strong>System diagram</strong>: every step as a box, grouped by file (and by repo when there are several). Hover a box or arrow to highlight what it connects to. Zoom with the buttons, Ctrl/⌘ + scroll or a pinch, and drag to move around.</li>
    <li><strong>Walkthrough</strong>: the steps in the order the code runs them. The text on the left explains each step. The tabs on the right show its code, the data it uses and the functions it calls.</li>
    <li><strong>Data</strong>: every type the path touches, with its definition.</li>
  </ul></details>
</section>`;
}

const ZOOM_BUTTONS =
  '<button type="button" data-zoom="out" title="Zoom out">−</button><span class="zoomlevel">100%</span><button type="button" data-zoom="in" title="Zoom in">+</button><button type="button" data-zoom="fit" title="Fit the whole diagram (0)">Fit</button><button type="button" data-zoom="start" title="Back to the entry">Entry</button><button type="button" data-zoom="full" title="Full screen">⤢</button>';
const PATH_BUTTONS =
  '<span class="sep"></span><button type="button" data-mode="compact" aria-pressed="false" title="Hide the data types and their arrows">Compact</button><button type="button" data-path="full" aria-pressed="false" title="Highlight the route the walkthrough takes, from the first step to the last">Full path</button>' +
  '<span class="sep"></span><span class="nav"><button type="button" data-nav="prev" title="Previous step (←)">◀</button><button type="button" class="navlabel" data-nav="open" title="Step through the path with ◀ ▶ or the arrow keys; click to read this step">Step through</button><button type="button" data-nav="next" title="Next step (→)">▶</button><button type="button" data-nav="stop" title="Stop stepping (Esc)" hidden>×</button></span><button type="button" data-nav="panel" aria-pressed="true" title="Show or hide the description of each step while stepping">Details</button>';

/** One diagram panel: its toolbar, the zoomable stage and the hover tip. The call path's two modes share the path controls. */
function diagramBox(name: string, source: string, info: string, pathControls: boolean, hidden: boolean): string {
  const hint = pathControls ? "Ctrl/⌘ + scroll or pinch to zoom · drag to move · hover to trace · ← → to step" : "Ctrl/⌘ + scroll or pinch to zoom · drag to move · hover to trace connections";
  return `<div class="diagram" id="tab-${name}" data-info="${info}"${pathControls ? ' data-path-view="1"' : ""}${hidden ? " hidden" : ""}><div class="toolbar">${ZOOM_BUTTONS}${pathControls ? PATH_BUTTONS : ""}<span class="hint">${hint}</span></div><div class="stage" tabindex="0"><pre class="mermaid">${esc(source)}</pre>${pathControls ? '<aside class="steppanel" hidden><button type="button" class="close" data-nav="panel" title="Hide the description">×</button><div class="body"></div></aside>' : ""}</div><div class="tip" hidden></div></div>`;
}

/** The page itself, from `<main>` down: header, intro, diagrams, walkthrough, data and the snippet templates. */
export function renderPage(doc: CodeMapDocument): string {
  const d = doc.render;
  const walk = d.walkthrough;
  const files = new Set(walk.steps.map((s) => d.symbols[s.symbolId].file));
  const dataCount = dataIdsOf(walk).length;
  const rootsText = d.roots.map((r) => (r.label ? `${r.label}: ${r.dir}` : r.dir)).join(" · ");
  const snippets = new Snippets();
  const steps = walk.steps.map((s) => renderStep(d, walk, s, snippets)).join("\n");
  const data = renderData(d, walk, snippets);
  const { path, compact, files: fileGraph } = d.diagrams;

  return `<main>
<header>
  <h1>${esc(doc.system.title)}</h1>
  <div class="stats"><span>${walk.steps.length} steps</span><span>${files.size} files on the path</span><span>${dataCount} data types</span><span>${d.filesAnalyzed} files analyzed</span>${walk.selection ? `<span>selection: ${walk.selection.ids.length} functions, ${walk.selection.data.length} data types</span>` : ""}<span>${d.roots.length > 1 ? `${d.roots.length} repos — ` : "root: "}${esc(rootsText)}</span></div>
</header>
${renderIntro(d, walk)}

<h2>System diagram</h2>
<div class="tabs" role="tablist">
  <button role="tab" aria-selected="true" data-tab="path">Call path</button>
  <button role="tab" aria-selected="false" data-tab="files">Files</button>
</div>
<script type="application/json" id="info-path">${scriptJson(path.info)}</script>
<script type="application/json" id="info-files">${scriptJson(fileGraph.info)}</script>
<script type="application/json" id="route">${scriptJson(d.route)}</script>
${diagramBox("path", path.source, "info-path", true, false)}
${diagramBox("pathc", compact.source, "info-path", true, true)}
${diagramBox("files", fileGraph.source, "info-files", false, true)}
<div class="legend">Boxes are functions and methods, numbered by step and grouped by file. Cylinders are data types. Solid arrows are calls; an arrow labelled "via" passes through functions outside the selection; thick arrows are calls matched by package and name (usually into another repo). Dotted arrows show data a step takes (param), returns, creates or uses. With several repos, files are grouped inside a box per repo. Hover a box to highlight what it calls (blue) and what calls it (orange); hover an arrow to see both ends. Click a box or arrow to jump to its step. Compact hides the data types; Full path highlights the route from the first step to the last; ◀ ▶ or the arrow keys step through the functions one at a time, following each arrow. The Files tab shows how the files import each other; bold borders are files on the path.</div>

<h2>Walkthrough</h2>
<p class="muted">The path the code takes when it runs, in order. Highlighted lines are the calls that lead to the next steps; the → buttons on them jump there. Use the tabs beside each step to see the data it uses and preview the code it calls.</p>
${steps}

${data}
</main>
${snippets}`;
}
