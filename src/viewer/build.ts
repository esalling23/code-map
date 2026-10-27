// Builds the viewer into one self-contained HTML page: the bundled app, its CSS, and (for a standalone map) the data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptJson } from "../page";
import type { CodeMapDocument } from "../pagedata";

const HLJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
const DATA_SLOT = "<!--code-map-data-->";

let cached: Promise<string> | undefined;

/** The viewer page. With no embedded data it opens on the file picker and recent files. */
export function buildViewerHtml(): Promise<string> {
  cached ??= (async () => {
    const out = await Bun.build({ entrypoints: [join(import.meta.dir, "app.ts")], target: "browser", format: "esm", minify: true });
    if (!out.success) throw new Error(`Building the viewer failed:\n${out.logs.map(String).join("\n")}`);
    const js = (await out.outputs[0].text()).replace(/<\/script/gi, "<\\/script");
    const css = ["page.css", "viewer.css"].map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code map viewer</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='5' height='4' rx='1' fill='%232f6fde'/%3E%3Crect x='10' y='6' width='5' height='4' rx='1' fill='%232f6fde'/%3E%3Crect x='1' y='11' width='5' height='4' rx='1' fill='%232f6fde'/%3E%3Cpath d='M6 3h2v10H6M8 8h2' stroke='%232f6fde' fill='none'/%3E%3C/svg%3E">
<style>
${css}
</style>
<script src="${HLJS_URL}"></script>
</head>
<body>
<div id="app"></div>
${DATA_SLOT}
<script type="module">${js}</script>
</body>
</html>
`;
  })();
  return cached;
}

/** The viewer with a document built in: one file that shows that map, with no upload screen. */
export function embedDocument(viewerHtml: string, doc: CodeMapDocument): string {
  const data = `<script type="application/json" id="code-map-data">${scriptJson(doc)}</script>`;
  return viewerHtml.replace(DATA_SLOT, () => data);
}
