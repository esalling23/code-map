// Zoom and pan for one diagram: buttons, Ctrl/⌘ + wheel or pinch to zoom, drag to move, double-click,
// + - 0 keys, and full screen (where a plain wheel pans). Every listener is removed when the diagram goes.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { Graph } from "./graph";

/** The camera: where the view is, and ways to move it. The step navigator glides it along arrows. */
export interface View {
  readonly k: number;
  readonly x: number;
  readonly y: number;
  set(x: number, y: number, k: number): void;
  /** Zooms by `factor` around a point of the stage; without one, around its middle. */
  zoomBy(factor: number, at?: readonly [number, number]): void;
  fit(): void;
  /** Readable size, centred on the entry box. */
  start(): void;
  toggleFullscreen(): void;
  /** Bumped to stop a running glide. */
  anim: number;
}

interface Refs {
  container: RefObject<HTMLDivElement | null>;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLPreElement | null>;
  level: RefObject<HTMLSpanElement | null>;
}

export function useZoomPan(refs: Refs, graph: Graph | null): View {
  const cam = useRef({ k: 1, x: 0, y: 0 });
  const view = useRef<View | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  if (!view.current) {
    const c = cam.current;
    const apply = () => {
      if (refs.canvas.current) refs.canvas.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
      if (refs.level.current) refs.level.current.textContent = `${Math.round(c.k * 100)}%`;
    };
    const rect = () => refs.stage.current?.getBoundingClientRect();
    view.current = {
      get k() {
        return c.k;
      },
      get x() {
        return c.x;
      },
      get y() {
        return c.y;
      },
      anim: 0,
      set(x, y, k) {
        Object.assign(c, { x, y, k });
        apply();
      },
      zoomBy(f, at) {
        const r = rect();
        if (!r) return;
        const [cx, cy] = at ?? [r.width / 2, r.height / 2];
        const nk = Math.min(4, Math.max(0.05, c.k * f));
        c.x = cx - ((cx - c.x) * nk) / c.k;
        c.y = cy - ((cy - c.y) * nk) / c.k;
        c.k = nk;
        apply();
      },
      fit() {
        const r = rect();
        const g = graphRef.current;
        if (!r?.width || !g) return;
        c.k = Math.min(r.width / g.w, r.height / g.h) * 0.96;
        c.x = (r.width - g.w * c.k) / 2;
        c.y = g.h * c.k < r.height ? (r.height - g.h * c.k) / 2 : 12;
        apply();
      },
      start() {
        const r = rect();
        const g = graphRef.current;
        if (!r?.width || !g) return;
        const { w, h } = g;
        c.k = Math.min(1, Math.max(r.width / w, 0.75));
        c.x = 0;
        c.y = 0;
        apply();
        const node = g.svg.querySelector('g.node[id^="flowchart-s0-"]') ?? g.svg.querySelector("g.node");
        const nr = node?.getBoundingClientRect();
        if (!nr) return;
        c.x = w * c.k <= r.width ? (r.width - w * c.k) / 2 : Math.min(0, Math.max(r.width - w * c.k, r.width / 2 - (nr.left - r.left + nr.width / 2)));
        c.y = h * c.k <= r.height ? (r.height - h * c.k) / 2 : Math.min(16, 32 - (nr.top - r.top));
        apply();
      },
      toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else refs.container.current?.requestFullscreen?.();
      },
    };
  }

  // A new drawing starts at the entry.
  useLayoutEffect(() => {
    if (graph) view.current!.start();
  }, [graph]);

  useEffect(() => {
    const stage = refs.stage.current;
    const container = refs.container.current;
    if (!graph || !stage || !container) return;
    const v = view.current!;
    const c = cam.current;
    const stop = () => v.anim++;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = stage.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const inPanel = (e: Event) => !!(e.target as Element).closest?.(".steppanel");

    const onWheel = (e: WheelEvent) => {
      if (inPanel(e)) return;
      stop();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        v.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), local(e));
      } else if (document.fullscreenElement === container) {
        e.preventDefault();
        v.set(c.x - e.deltaX, c.y - e.deltaY, c.k);
      }
    };
    const onDblClick = (e: MouseEvent) => {
      if ((e.target as Element).closest("g.node, .steppanel")) return;
      v.zoomBy(1.6, local(e));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") v.zoomBy(1.25);
      else if (e.key === "-") v.zoomBy(1 / 1.25);
      else if (e.key === "0") v.fit();
      else return;
      e.preventDefault();
    };

    const pts = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; ox: number; oy: number } | null = null;
    let pinch: { d: number; k: number } | null = null;
    let moved = false;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || inPanel(e)) return;
      stop();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, ox: c.x, oy: c.y };
        moved = false;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        drag = null;
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: c.k };
        for (const id of pts.keys()) stage.setPointerCapture?.(id);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const r = stage.getBoundingClientRect();
        v.zoomBy((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / c.k, [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top]);
        moved = true;
      } else if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
          moved = true;
          stage.classList.add("dragging");
          // Capture only once it is a drag, so a plain click still reaches the box under the pointer.
          stage.setPointerCapture?.(e.pointerId);
        }
        if (moved) v.set(drag.ox + dx, drag.oy + dy, c.k);
      }
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) {
        drag = null;
        stage.classList.remove("dragging");
      }
    };
    // A drag ends with a click; don't let it open a step.
    const onClickCapture = (e: MouseEvent) => {
      if (!moved) return;
      e.stopPropagation();
      e.preventDefault();
      moved = false;
    };
    const onFullscreen = () => setTimeout(() => v.fit(), 50);

    const on: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
      [stage, "wheel", onWheel as EventListener, { passive: false }],
      [stage, "dblclick", onDblClick as EventListener],
      [stage, "keydown", onKey as EventListener],
      [stage, "pointerdown", onDown as EventListener],
      [stage, "pointermove", onMove as EventListener],
      [stage, "pointerup", onUp as EventListener],
      [stage, "pointercancel", onUp as EventListener],
      [stage, "click", onClickCapture as EventListener, { capture: true }],
      [container, "fullscreenchange", onFullscreen],
    ];
    for (const [t, type, fn, opts] of on) t.addEventListener(type, fn, opts);
    return () => {
      for (const [t, type, fn, opts] of on) t.removeEventListener(type, fn, opts);
      stop();
    };
  }, [graph]);

  return view.current;
}
