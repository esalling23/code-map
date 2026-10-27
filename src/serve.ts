// `code-map view`: serves the viewer on localhost and opens a code-map JSON file in it.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { buildViewerHtml } from "./viewer/build";

export async function view({ file: given, port, open }: { file?: string; port: number; open: boolean }) {
  const file = given && resolve(given);
  if (file && !existsSync(file)) throw new Error(`No such file: ${file}`);
  const route = file ? `/${encodeURIComponent(basename(file))}` : undefined;
  const html = await buildViewerHtml();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/" || path === "/index.html") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (route && path === route) return new Response(readFileSync(file!), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      return new Response("Not found", { status: 404 });
    },
  });
  const url = `http://${server.hostname}:${server.port}/${route ? `?src=${route}` : ""}`;
  console.error(`Viewer at ${url}  (Ctrl+C to stop)`);
  if (open) Bun.spawn([process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", url]);
}
