// `code-map view`: serves the viewer on localhost and opens a code-map JSON file in it.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildViewerHtml } from "./viewer/build";

export const VIEW_HELP = `code-map view — open a code-map JSON file in the viewer

Usage:
  code-map view [<map.json>] [--port <n>] [--no-open]

  Serves the viewer on localhost. With a file, opens it; reloading the page reads the file
  again, so a rebuilt map shows up on refresh. Without one, opens the file picker and the
  maps opened before in this browser.

Options:
      --port <n>   Port to serve on (default: 4173; keep it fixed so recent files are remembered)
      --no-open    Don't open a browser
`;

export async function view(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { port: { type: "string", default: "4173" }, "no-open": { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
  });
  if (values.help) return void process.stdout.write(VIEW_HELP);
  const file = positionals[0] && resolve(positionals[0]);
  if (file && !existsSync(file)) throw new Error(`No such file: ${file}`);
  const route = file ? `/${encodeURIComponent(basename(file))}` : undefined;
  const html = await buildViewerHtml();

  const server = Bun.serve({
    port: Number(values.port),
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/" || path === "/index.html") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (route && path === route) return new Response(readFileSync(file!), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      return new Response("Not found", { status: 404 });
    },
  });
  const url = `http://${server.hostname}:${server.port}/${route ? `?src=${route}` : ""}`;
  console.error(`Viewer at ${url}  (Ctrl+C to stop)`);
  if (!values["no-open"]) Bun.spawn([process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", url]);
}
