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

export function LevelControl({ level, onChange, shown, total }: { level: number; onChange: (n: number) => void; shown: number; total: number }) {
  return (
    <label className="levels" title="Hide helper steps that have few steps beneath them. Step numbers stay the same.">
      Show steps with at least{" "}
      <select value={level} onChange={(e) => onChange(Number(e.target.value))}>
        {LEVELS.map((n) => (
          <option key={n} value={n}>
            {n ? `${n}+` : "All"}
          </option>
        ))}
      </select>{" "}
      steps beneath them
      {shown < total && <span className="muted">{` · showing ${shown} of ${total}`}</span>}
    </label>
  );
}
