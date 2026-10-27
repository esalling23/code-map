// Where the document comes from, in order: data embedded in the page (a standalone .html), `?src=<url>`
// (what `code-map view` opens), `#map=<id>` (a recent file in this browser), or the home screen.
import { toDocument, type CodeMapDocument } from "../pagedata";
import { hashText, listRecent, loadText, saveRecent, touchRecent } from "./storage";

export type Screen =
  | { kind: "loading" }
  | { kind: "home"; error?: string }
  /** `standalone`: the map is built into the page, so there's no bar, home or file picking. */
  | { kind: "map"; doc: CodeMapDocument; name: string; standalone?: boolean };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function embedded(): Screen | null {
  const el = document.getElementById("code-map-data");
  return el ? { kind: "map", doc: toDocument(JSON.parse(el.textContent!)), name: "", standalone: true } : null;
}

/** The screen for the current URL. */
export async function fromUrl(): Promise<Screen> {
  const src = new URLSearchParams(location.search).get("src");
  if (src) {
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return { kind: "home", error: `Couldn't load ${src}: ${res.status} ${res.statusText}` };
    const text = await res.text();
    const doc = toDocument(JSON.parse(text));
    const name = decodeURIComponent(src.split("/").pop() || src);
    await saveRecent({ id: await hashText(text), name, title: doc.system.title, size: text.length, openedAt: Date.now() }, text);
    return { kind: "map", doc, name };
  }
  const id = location.hash.match(/^#map=([\w-]+)$/)?.[1];
  if (id) {
    const text = await loadText(id);
    if (text) {
      await touchRecent(id);
      const file = (await listRecent()).find((f) => f.id === id);
      return { kind: "map", doc: toDocument(JSON.parse(text)), name: file?.name ?? "code map" };
    }
    history.replaceState(null, "", location.pathname);
    return { kind: "home", error: "That map isn't stored in this browser any more. Open the file again." };
  }
  return { kind: "home" };
}

export async function boot(): Promise<Screen> {
  try {
    return embedded() ?? (await fromUrl());
  } catch (e) {
    return { kind: "home", error: message(e) };
  }
}

/** Reads a picked or dropped file, remembers it, and points the URL at it. */
export async function openFile(file: File): Promise<Screen> {
  try {
    const text = await file.text();
    const doc = toDocument(JSON.parse(text));
    const id = await hashText(text);
    await saveRecent({ id, name: file.name, title: doc.system.title, size: file.size, openedAt: Date.now() }, text);
    history.pushState(null, "", `${location.pathname}#map=${id}`);
    return { kind: "map", doc, name: file.name };
  } catch (e) {
    return { kind: "home", error: `${file.name}: ${message(e)}` };
  }
}

/** Opens a recent file by id. */
export async function openRecent(id: string): Promise<Screen> {
  history.pushState(null, "", `${location.pathname}#map=${id}`);
  try {
    return await fromUrl();
  } catch (e) {
    return { kind: "home", error: message(e) };
  }
}

export function goHome(): Screen {
  history.pushState(null, "", location.pathname);
  return { kind: "home" };
}
