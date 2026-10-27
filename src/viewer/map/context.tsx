// What every part of a map page shares: the document, which steps are shown, and how to move around.
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import type { CodeMapDocument } from "../../pagedata";

export interface MapState {
  doc: CodeMapDocument;
  visible: Set<number>;
  /** Hidden steps beneath each shown step. */
  hidden: Map<number, number[]>;
  expand(step: number): void;
  goToStep(step: number): void;
  goToArea(n: number): void;
  /** The step being read in the walkthrough, or -1. */
  current: number;
  setCurrent(step: number): void;
  /** `step-N` or `area-N` just jumped to. */
  target: string;
}

const MapContext = createContext<MapState | null>(null);
export const MapProvider = ({ value, children }: { value: MapState; children: ReactNode }) => <MapContext.Provider value={value}>{children}</MapContext.Provider>;

export function useMap(): MapState {
  const value = useContext(MapContext);
  if (!value) throw new Error("useMap outside a map page");
  return value;
}

/** What a "step N" link does: scroll the walkthrough there, or (inside the step panel) move the navigator. */
type StepLinkHandler = (step: number, e: MouseEvent) => void;
const StepLinkContext = createContext<StepLinkHandler | null>(null);
export const StepLinkProvider = ({ onLink, children }: { onLink: StepLinkHandler; children: ReactNode }) => <StepLinkContext.Provider value={onLink}>{children}</StepLinkContext.Provider>;

export function StepLink({ step, className, title, children }: { step: number; className?: string; title?: string; children: ReactNode }) {
  const map = useMap();
  const override = useContext(StepLinkContext);
  const onClick = (e: MouseEvent) => {
    if (override) override(step, e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    map.goToStep(step);
  };
  return (
    <a className={className} href={`#step-${step + 1}`} title={title} onClick={onClick}>
      {children}
    </a>
  );
}

export function AreaLink({ n, className, children }: { n: number; className?: string; children: ReactNode }) {
  const map = useMap();
  return (
    <a
      className={className}
      href={`#area-${n}`}
      onClick={(e) => {
        e.preventDefault();
        map.goToArea(n);
      }}
    >
      {children}
    </a>
  );
}
