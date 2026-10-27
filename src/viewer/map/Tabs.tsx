// Tab sets: main, nested and vertical. A panel's content is built the first time its tab is selected.
import { useRef, useState, type ReactNode } from "react";

export interface TabDef {
  key: string;
  label: ReactNode;
  content: () => ReactNode;
}

/** The tabs selected so far: their panels stay built, the rest stay empty. */
export function useLazyTabs(selected: string): Set<string> {
  const seen = useRef(new Set<string>());
  seen.current.add(selected);
  return seen.current;
}

/** A tab set. Pass `selected` and `onSelect` to control it from outside, e.g. to open a tab from a link. */
export function Tabs({ className, tabs, selected, onSelect }: { className: string; tabs: TabDef[]; selected?: string; onSelect?: (key: string) => void }) {
  const [own, setOwn] = useState(tabs[0]?.key ?? "");
  const current = tabs.some((t) => t.key === selected) ? selected! : tabs.some((t) => t.key === own) ? own : (tabs[0]?.key ?? "");
  const built = useLazyTabs(current);
  const select = (key: string) => (onSelect ? onSelect(key) : setOwn(key));
  return (
    <div className={`tabset ${className}`}>
      <div className="tabbar" role="tablist">
        {tabs.map((t) => (
          <button type="button" role="tab" key={t.key} aria-selected={t.key === current} data-key={t.key} onClick={() => select(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div className="tabpanel" role="tabpanel" key={t.key} hidden={t.key !== current}>
          {built.has(t.key) ? t.content() : null}
        </div>
      ))}
    </div>
  );
}
