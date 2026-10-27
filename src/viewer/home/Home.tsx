// The home screen: a drop zone and file picker, any error, and the recent files.
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { clearRecent, listRecent, persistent, removeRecent, type RecentFile } from "../storage";

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A hidden `.json` file input; `onFile` gets the picked file. */
export function FileInput({ onFile }: { onFile: (file: File) => void }) {
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFile(file);
  };
  return <input type="file" accept=".json,application/json" hidden onChange={change} />;
}

export function Home({ error, onFile, onRecent }: { error?: string; onFile: (file: File) => void; onRecent: (id: string) => void }) {
  const [recent, setRecent] = useState<RecentFile[] | null>(null);
  const [stored, setStored] = useState(true);
  const refresh = useCallback(async () => {
    setRecent(await listRecent());
    setStored(await persistent());
  }, []);
  useEffect(() => {
    document.title = "Code map viewer";
    refresh();
  }, [refresh]);

  return (
    <main className="home">
      <h1>Code map viewer</h1>
      <p className="muted">Open a code-map JSON file made by the code-map CLI or its MCP server. Files are read in your browser and never uploaded.</p>
      <label className="drop">
        <FileInput onFile={onFile} />
        <strong>Drop a code-map .json here</strong>
        <span>or click to choose a file</span>
      </label>
      <p className="error" role="alert" hidden={!error}>
        {error}
      </p>
      <section className="recent">
        <div className="recenthead">
          <h2>Recent</h2>
          {!!recent?.length && (
            <button type="button" className="clear" onClick={async () => (await clearRecent(), refresh())}>
              Forget all
            </button>
          )}
        </div>
        {recent?.length ? (
          <ul>
            {recent.map((f) => (
              <li key={f.id}>
                <a
                  href={`#map=${f.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onRecent(f.id);
                  }}
                >
                  <strong>{f.title}</strong>
                  <span className="muted">{`${f.name} · ${size(f.size)} · opened ${when(f.openedAt)}`}</span>
                </a>
                <button type="button" className="remove" title="Forget this file" onClick={async () => (await removeRecent(f.id), refresh())}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          recent && <p className="muted">{stored ? "Files you open are kept here, in this browser only." : "This browser blocks local storage, so files won't be remembered after you leave."}</p>
        )}
      </section>
    </main>
  );
}
