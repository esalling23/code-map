// Pure text helpers shared by the document builder and the viewer. No Node or DOM APIs.
import type { CodeSymbol, Walkthrough } from "../types";

const MAX_FULL_LINES = 45;
const CONTEXT = 3;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const mmd = (s: string) => s.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");

export function language(file: string): string {
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

export const allLines = (sym: CodeSymbol): ExcerptLine[] => sym.code.split("\n").map((text, i) => ({ line: sym.startLine + i, text }));

export const dataIdsOf = (walk: Walkthrough) => [...new Set([...walk.steps.flatMap((s) => s.dataUsed.map((d) => d.id)), ...(walk.selection?.data ?? [])])];

/** JSON safe to put inside a `<script>` element: browsers don't decode entities there, so only `<` is escaped. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The folder and file name only, e.g. `deploy/static-game-storage.service.ts`; the full path goes in a hover title. */
export const shortPath = (file: string) => file.split("/").slice(-2).join("/");

export type Inline = { kind: "text" | "code" | "strong" | "em"; text: string };

/** Splits prose into `code`, **bold** and *italic* runs. A lone asterisk stays text. */
export function inlineRuns(s: string): Inline[] {
  const out: Inline[] = [];
  const push = (kind: Inline["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (kind === "text" && last?.kind === "text") last.text += text;
    else out.push({ kind, text });
  };
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    push("text", s.slice(at, m.index));
    if (m[1] !== undefined) push("code", m[1]);
    else if (m[2] !== undefined) push("strong", m[2]);
    else push("em", m[3]);
    at = m.index! + m[0].length;
  }
  push("text", s.slice(at));
  return out;
}
