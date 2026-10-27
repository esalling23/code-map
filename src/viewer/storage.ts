// Recently opened code maps, kept in this browser's IndexedDB. Falls back to memory when storage is blocked
// (private windows, sandboxed previews), so the viewer still works, just without remembering files.

const DB_NAME = "code-map";
const KEEP = 20;

export interface RecentFile {
  /** Hash of the file's text, so opening the same file again updates its entry instead of adding one. */
  id: string;
  name: string;
  title: string;
  size: number;
  openedAt: number;
}

const memory = { meta: new Map<string, RecentFile>(), text: new Map<string, string>() };
let dbPromise: Promise<IDBDatabase | null> | undefined;

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        // Metadata and text live apart so listing recent files never loads every file's text.
        req.result.createObjectStore("meta", { keyPath: "id" });
        req.result.createObjectStore("text");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => ((tx.oncomplete = () => resolve()), (tx.onerror = () => reject(tx.error))));
const result = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => ((req.onsuccess = () => resolve(req.result)), (req.onerror = () => reject(req.error))));

/** Whether files survive a reload in this browser. */
export async function persistent(): Promise<boolean> {
  return (await db()) !== null;
}

export async function listRecent(): Promise<RecentFile[]> {
  const d = await db();
  let all: RecentFile[] = [...memory.meta.values()];
  if (d) {
    try {
      all = await result(d.transaction("meta").objectStore("meta").getAll());
    } catch {}
  }
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

export async function loadText(id: string): Promise<string | undefined> {
  const d = await db();
  if (!d) return memory.text.get(id);
  try {
    return await result(d.transaction("text").objectStore("text").get(id));
  } catch {
    return undefined;
  }
}

/** Saves a file as the most recent one and drops the oldest beyond the limit. */
export async function saveRecent(file: RecentFile, text: string): Promise<void> {
  memory.meta.set(file.id, file);
  memory.text.set(file.id, text);
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(["meta", "text"], "readwrite");
    tx.objectStore("meta").put(file);
    tx.objectStore("text").put(text, file.id);
    await done(tx);
    for (const old of (await listRecent()).slice(KEEP)) await removeRecent(old.id);
  } catch {}
}

/** Updates when a file was last opened. */
export async function touchRecent(id: string): Promise<void> {
  const file = (await listRecent()).find((f) => f.id === id);
  if (!file) return;
  file.openedAt = Date.now();
  memory.meta.set(id, file);
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction("meta", "readwrite");
    tx.objectStore("meta").put(file);
    await done(tx);
  } catch {}
}

export async function removeRecent(id: string): Promise<void> {
  memory.meta.delete(id);
  memory.text.delete(id);
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(["meta", "text"], "readwrite");
    tx.objectStore("meta").delete(id);
    tx.objectStore("text").delete(id);
    await done(tx);
  } catch {}
}

export async function clearRecent(): Promise<void> {
  memory.meta.clear();
  memory.text.clear();
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(["meta", "text"], "readwrite");
    tx.objectStore("meta").clear();
    tx.objectStore("text").clear();
    await done(tx);
  } catch {}
}

/** A short id for a file's text: SHA-256 where available (secure pages), otherwise FNV-1a. */
export async function hashText(text: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return `f${(h >>> 0).toString(16)}${text.length.toString(16)}`;
  }
}
