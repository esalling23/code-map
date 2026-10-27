// The call path's view state, shared by its full and compact drawings: compact, the full path, and stepping
// through the path one function at a time with a panel describing the current step.
import { useEffect, useMemo, useState, type MouseEvent, type RefObject } from "react";
import type { RouteStop } from "../../pagedata";
import { StepLinkProvider, useMap } from "../map/context";
import { StepExplain } from "../map/Step";

const PANEL_KEY = "codemap-panel";

export interface Navigator {
  route: RouteStop[];
  compact: boolean;
  full: boolean;
  /** Index into `route` of the current stop, or -1 when not stepping. */
  at: number;
  panel: boolean;
  /** Bumped when the view should move to the current stop. */
  follow: { n: number; animate: boolean };
  /** Bumped when the shown drawing should take focus (and full screen, when the other one had it). */
  focus: { n: number; fullscreen: boolean };
  stepBy(delta: number): void;
  stop(): void;
  /** Moves to a step, by 0-based step index; false when the navigator doesn't stop there. */
  jumpTo(step: number): boolean;
  toggleFull(): void;
  toggleCompact(): void;
  togglePanel(): void;
  /** The step index of the current stop. */
  stepAt(): number;
}

const indexOf = (stop: RouteStop) => Number(stop.id.slice(1));

export function useNavigator(route: RouteStop[]): Navigator {
  const [compact, setCompact] = useState(false);
  const [full, setFull] = useState(false);
  const [at, setAt] = useState(-1);
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [follow, setFollow] = useState({ n: 0, animate: true });
  const [focus, setFocus] = useState({ n: 0, fullscreen: false });
  const stops = useMemo(() => route.flatMap((r, i) => (r.nav ? [i] : [])), [route]);
  const go = (i: number, animate = true) => {
    setAt(i);
    setFollow((f) => ({ n: f.n + 1, animate }));
  };

  // A different set of steps (the levels control) starts over.
  useEffect(() => setAt(-1), [route]);

  return {
    route,
    compact,
    full,
    at,
    panel,
    follow,
    focus,
    stepBy(delta) {
      if (!stops.length) return;
      const pos = stops.indexOf(at);
      const next = pos < 0 ? (delta > 0 ? 0 : stops.length - 1) : Math.min(stops.length - 1, Math.max(0, pos + delta));
      if (stops[next] !== at) go(stops[next]);
    },
    stop: () => setAt(-1),
    jumpTo(step) {
      const i = route.findIndex((r) => indexOf(r) === step);
      if (i < 0 || !route[i].nav) return false;
      go(i);
      return true;
    },
    toggleFull: () => setFull((f) => !f),
    toggleCompact() {
      const fullscreen = !!document.fullscreenElement?.matches(".diagram[data-path-view]");
      setCompact((c) => !c);
      setFocus((f) => ({ n: f.n + 1, fullscreen }));
      if (at >= 0) setFollow((f) => ({ n: f.n + 1, animate: false }));
    },
    togglePanel() {
      const open = !panel;
      setPanel(open);
      try {
        localStorage.setItem(PANEL_KEY, open ? "1" : "0");
      } catch {}
      if (at >= 0) setFollow((f) => ({ n: f.n + 1, animate: true }));
    },
    stepAt: () => (at >= 0 ? indexOf(route[at]) : -1),
  };
}

/** The toolbar's path controls: Compact, Full path, ◀ step ▶, ×, Details. */
export function NavButtons({ nav }: { nav: Navigator }) {
  const { goToStep } = useMap();
  const stops = nav.route.flatMap((r, i) => (r.nav ? [i] : []));
  const stepping = nav.at >= 0;
  const pos = stops.indexOf(nav.at);
  return (
    <>
      <span className="sep"></span>
      <button type="button" data-mode="compact" aria-pressed={nav.compact} title="Hide the data types and their arrows" onClick={nav.toggleCompact}>
        Compact
      </button>
      <button type="button" data-path="full" aria-pressed={nav.full} title="Highlight the route the walkthrough takes, from the first step to the last" onClick={nav.toggleFull}>
        Full path
      </button>
      <span className="sep"></span>
      <span className="nav">
        <button type="button" data-nav="prev" title="Previous step (←)" disabled={stepping && pos <= 0} onClick={() => nav.stepBy(-1)}>
          ◀
        </button>
        <button
          type="button"
          className="navlabel"
          data-nav="open"
          title="Step through the path with ◀ ▶ or the arrow keys; click to read this step"
          onClick={() => (stepping ? goToStep(nav.stepAt()) : nav.stepBy(1))}
        >
          {stepping ? `Step #${nav.stepAt() + 1}` : "Step through"}
        </button>
        <button type="button" data-nav="next" title="Next step (→)" disabled={stepping && pos >= stops.length - 1} onClick={() => nav.stepBy(1)}>
          ▶
        </button>
        <button type="button" data-nav="stop" title="Stop stepping (Esc)" hidden={!stepping} onClick={nav.stop}>
          ×
        </button>
      </span>
      <button type="button" data-nav="panel" aria-pressed={nav.panel} title="Show or hide the description of each step while stepping" onClick={nav.togglePanel}>
        Details
      </button>
    </>
  );
}

/** The current step's text beside the diagram. Its "step N" links move the navigator. */
export function StepPanel({ nav, panelRef }: { nav: Navigator; panelRef: RefObject<HTMLElement | null> }) {
  const { doc } = useMap();
  const index = nav.stepAt();
  const open = index >= 0 && nav.panel;
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [index, panelRef]);
  const onLink = (step: number, e: MouseEvent) => {
    if ((e.currentTarget as Element).classList.contains("more")) return;
    if (nav.jumpTo(step)) e.preventDefault();
  };
  return (
    <aside className="steppanel" hidden={!open} ref={panelRef}>
      <button type="button" className="close" data-nav="panel" title="Hide the description" onClick={nav.togglePanel}>
        ×
      </button>
      <div className="body">
        {open && (
          <StepLinkProvider onLink={onLink}>
            <StepExplain step={doc.render.walkthrough.steps[index]} panel />
          </StepLinkProvider>
        )}
      </div>
    </aside>
  );
}
