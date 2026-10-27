// The viewer: renders a code-map JSON document in the browser.
// Where the document comes from, in order: data embedded in the page (a standalone .html), `?src=<url>`
// (what `code-map view` opens), `#map=<id>` (a recent file in this browser), or a file the person picks.
import { renderPage } from "../page";
import { toDocument, type CodeMapDocument } from "../pagedata";
import { activate } from "./behavior.js";
import { clearRecent, hashText, listRecent, loadText, persistent, removeRecent, saveRecent, touchRecent, type RecentFile } from "./storage";

const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs";
const app = document.getElementById("app")!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function show(doc: CodeMapDocument, bar: string) {
  document.title = doc.system.title;
  app.innerHTML = bar + renderPage(doc);
  const { default: mermaid } = await import(/* @vite-ignore */ MERMAID_URL);
  await activate(mermaid);
}

const topBar = (name: string) =>
  `<nav class="viewerbar"><a href="./" class="home-link">← Code maps</a><span class="muted" title="${esc(name)}">${esc(name)}</span><label class="open-other">Open file…<input type="file" accept=".json,application/json" hidden></label></nav>`;

/** Reads a picked or dropped file, remembers it, and opens it. */
async function openFile(file: File, showing: boolean) {
  const text = await file.text();
  const doc = toDocument(JSON.parse(text));
  const id = await hashText(text);
  await saveRecent({ id, name: file.name, title: doc.system.title, size: file.size, openedAt: Date.now() }, text);
  // A page shows one map per load: the page's scripts attach document-wide listeners once.
  if (showing && (await persistent())) {
    location.hash = `map=${id}`;
    return;
  }
  history.replaceState(null, "", `#map=${id}`);
  await show(doc, topBar(file.name));
}

function acceptFiles(showing: boolean, onError: (message: string) => void) {
  const open = (file?: File) => file && openFile(file, showing).catch((e) => onError(`${file.name}: ${e instanceof Error ? e.message : e}`));
  document.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type === "file") open(input.files?.[0]);
  });
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dropping");
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.body.classList.remove("dropping");
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dropping");
    open(e.dataTransfer?.files[0]);
  });
}

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function home(error = "") {
  document.title = "Code map viewer";
  const recent = await listRecent();
  const stored = await persistent();
  const rows = recent.map(
    (f: RecentFile) =>
      `<li><a href="#map=${f.id}"><strong>${esc(f.title)}</strong><span class="muted">${esc(f.name)} · ${size(f.size)} · opened ${when(f.openedAt)}</span></a><button type="button" class="remove" data-remove="${f.id}" title="Forget this file">×</button></li>`,
  );
  app.innerHTML = `<main class="home">
  <h1>Code map viewer</h1>
  <p class="muted">Open a code-map JSON file made by the code-map CLI or its MCP server. Files are read in your browser and never uploaded.</p>
  <label class="drop"><input type="file" accept=".json,application/json" hidden><strong>Drop a code-map .json here</strong><span>or click to choose a file</span></label>
  <p class="error" role="alert"${error ? "" : " hidden"}>${esc(error)}</p>
  <section class="recent">
    <div class="recenthead"><h2>Recent</h2>${recent.length ? '<button type="button" class="clear">Forget all</button>' : ""}</div>
    ${recent.length ? `<ul>${rows.join("")}</ul>` : `<p class="muted">${stored ? "Files you open are kept here, in this browser only." : "This browser blocks local storage, so files won't be remembered after you leave."}</p>`}
  </section>
</main>`;
  app.querySelector(".clear")?.addEventListener("click", async () => (await clearRecent(), home()));
  app.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) => b.addEventListener("click", async () => (await removeRecent(b.dataset.remove!), home())));
}

const showError = (message: string) => {
  const el = app.querySelector<HTMLElement>(".error");
  if (el) {
    el.textContent = message;
    el.hidden = false;
  } else home(message);
};

async function boot() {
  const embedded = document.getElementById("code-map-data");
  if (embedded) return show(toDocument(JSON.parse(embedded.textContent!)), "");

  // Every other way in reloads on a hash change, so each map gets a fresh page.
  addEventListener("hashchange", () => location.reload());
  const src = new URLSearchParams(location.search).get("src");
  if (src) {
    acceptFiles(true, showError);
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return home(`Couldn't load ${src}: ${res.status} ${res.statusText}`);
    const text = await res.text();
    const doc = toDocument(JSON.parse(text));
    const name = decodeURIComponent(src.split("/").pop() || src);
    await saveRecent({ id: await hashText(text), name, title: doc.system.title, size: text.length, openedAt: Date.now() }, text);
    return show(doc, topBar(name));
  }

  const id = location.hash.match(/^#map=([\w-]+)$/)?.[1];
  if (id) {
    const text = await loadText(id);
    if (text) {
      acceptFiles(true, showError);
      await touchRecent(id);
      const file = (await listRecent()).find((f) => f.id === id);
      return show(toDocument(JSON.parse(text)), topBar(file?.name ?? "code map"));
    }
    history.replaceState(null, "", location.pathname + location.search);
    acceptFiles(false, showError);
    return home("That map isn't stored in this browser any more. Open the file again.");
  }
  acceptFiles(false, showError);
  return home();
}

boot().catch((e) => home(e instanceof Error ? e.message : String(e)));
