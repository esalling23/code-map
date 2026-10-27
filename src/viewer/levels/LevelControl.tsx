// The levels control and its remembered value.
import { useState } from "react";
import { LEVELS } from "./levels";

const KEY = "codemap-levels";

function readLevel(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return (LEVELS as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** The threshold, kept per viewer in localStorage. */
export function useLevel(): [number, (n: number) => void] {
  const [level, setLevel] = useState(readLevel);
  const set = (n: number) => {
    setLevel(n);
    try {
      localStorage.setItem(KEY, String(n));
    } catch {}
  };
  return [level, set];
}

const HELP =
  "Hide helper steps: show only steps with at least this many steps beneath them (counting every level below). " +
  "Step numbers stay the same, and a shown step's \"N hidden\" button brings its helpers back.";

export function LevelControl({ level, onChange, shown, total }: { level: number; onChange: (n: number) => void; shown: number; total: number }) {
  return (
    <label className="levels" title={HELP}>
      Steps
      <select value={level} onChange={(e) => onChange(Number(e.target.value))} aria-label="Minimum steps beneath a shown step">
        {LEVELS.map((n) => (
          <option key={n} value={n}>
            {n ? `${n}+` : "All"}
          </option>
        ))}
      </select>
      <span className="muted" aria-label={`showing ${shown} of ${total} steps`}>{`${shown}/${total}`}</span>
    </label>
  );
}
