import { inlineRuns, shortPath } from "../text";

/** Prose with `code`, **bold** and *italic*. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) =>
        r.kind === "code" ? <code key={i}>{r.text}</code> : r.kind === "strong" ? <strong key={i}>{r.text}</strong> : r.kind === "em" ? <em key={i}>{r.text}</em> : r.text,
      )}
    </>
  );
}

/** A file's folder and name, with the full path on hover. */
export const PathSpan = ({ file }: { file: string }) => <span title={file}>{shortPath(file)}</span>;
