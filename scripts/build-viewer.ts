// Writes the hostable viewer (file upload + recent files) to dist/index.html.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildViewerHtml } from "../src/viewer/build";

const out = join(import.meta.dir, "../dist/index.html");
mkdirSync(join(out, ".."), { recursive: true });
const html = await buildViewerHtml();
writeFileSync(out, html);
console.error(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
