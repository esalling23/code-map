// Mermaid, loaded once from the CDN, rendering one diagram source to SVG when it is first shown.
import { useEffect, useState } from "react";

const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs";

interface Mermaid {
  initialize(config: object): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let loading: Promise<Mermaid> | undefined;
// Mermaid renders one diagram at a time.
let queue: Promise<unknown> = Promise.resolve();
let ids = 0;

function mermaid(): Promise<Mermaid> {
  loading ??= import(/* @vite-ignore */ MERMAID_URL).then(({ default: m }: { default: Mermaid }) => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    m.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", flowchart: { htmlLabels: true, curve: "basis" }, maxTextSize: 200000 });
    return m;
  });
  // A failed load (offline, CDN down) is retried by the next diagram instead of failing every one until reload.
  loading.catch(() => (loading = undefined));
  return loading;
}

function render(source: string): Promise<string> {
  const next = queue.then(async () => (await (await mermaid()).render(`cm-diagram-${++ids}`, source)).svg);
  queue = next.catch(() => {});
  return next;
}

/** The SVG for `source`, rendered once `enabled` (the diagram is on screen); the last one while a new one renders. */
export function useMermaid(source: string, enabled: boolean): { svg: string | null; error: string } {
  const [done, setDone] = useState<{ source: string; svg: string | null; error: string }>({ source: "", svg: null, error: "" });
  useEffect(() => {
    if (!enabled || done.source === source) return;
    let live = true;
    render(source).then(
      (svg) => live && setDone({ source, svg, error: "" }),
      (e) => live && setDone((d) => ({ source, svg: d.svg, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      live = false;
    };
  }, [source, enabled, done.source]);
  return { svg: done.svg, error: done.error };
}
