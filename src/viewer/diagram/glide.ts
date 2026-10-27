// Moving the camera to a step for the navigator, following the arrow that leads into it.
import type { View } from "./useZoomPan";

type Point = { x: number; y: number };

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The middle of the part of the stage the step panel leaves free, in stage coordinates. */
function freeCenter(stage: Element, panel: Element | null): Point {
  const r = stage.getBoundingClientRect();
  if (!panel || (panel as HTMLElement).hidden) return { x: r.width / 2, y: r.height / 2 };
  const p = panel.getBoundingClientRect();
  if (p.left - r.left > r.width / 3) return { x: (p.left - r.left) / 2, y: r.height / 2 };
  return { x: r.width / 2, y: (p.top - r.top) / 2 };
}

/** A point of the diagram, in its own unscaled coordinates, from a point on screen. */
function local(view: View, stage: Element, sx: number, sy: number): Point {
  const r = stage.getBoundingClientRect();
  return { x: (sx - r.left - view.x) / view.k, y: (sy - r.top - view.y) / view.k };
}

function centerOf(view: View, stage: Element, el: Element): Point {
  const b = el.getBoundingClientRect();
  return local(view, stage, b.left + b.width / 2, b.top + b.height / 2);
}

/** The arrow's own line, sampled from its start to its end. */
function pointsOf(view: View, stage: Element, path: SVGPathElement): Point[] {
  const ctm = path.getScreenCTM();
  if (!ctm) return [];
  const len = path.getTotalLength();
  const n = Math.max(8, Math.min(48, Math.round(len / 25)));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength((len * i) / n);
    const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
    out.push(local(view, stage, q.x, q.y));
  }
  return out;
}

/** Glides the view along a line of points (diagram coordinates), ending centred on the last one. */
function glide(view: View, stage: Element, panel: Element | null, points: Point[], toK: number) {
  const r = stage.getBoundingClientRect();
  const k0 = view.k;
  const mid = freeCenter(stage, panel);
  const line = [local(view, stage, r.left + mid.x, r.top + mid.y), ...points];
  const dist = [0];
  for (let i = 1; i < line.length; i++) dist.push(dist[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const total = dist[dist.length - 1];
  const at = (t: number): Point => {
    const d = t * total;
    let i = 1;
    while (i < line.length - 1 && dist[i] < d) i++;
    const span = dist[i] - dist[i - 1] || 1;
    const f = Math.min(1, Math.max(0, (d - dist[i - 1]) / span));
    return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * f, y: line[i - 1].y + (line[i].y - line[i - 1].y) * f };
  };
  const place = (p: Point, k: number) => view.set(mid.x - p.x * k, mid.y - p.y * k, k);
  const token = ++view.anim;
  if (reducedMotion() || total < 1) return place(line[line.length - 1], toK);
  const ms = Math.min(1600, Math.max(450, total * toK * 1.1));
  const t0 = performance.now();
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const frame = (now: number) => {
    if (token !== view.anim) return;
    const t = Math.min(1, (now - t0) / ms);
    const e = ease(t);
    place(at(e), k0 + (toK - k0) * e);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Moves the view to `node`, gliding along `edge` (the arrow into it) when `animate`. */
export function follow(view: View, stage: Element, panel: Element | null, node: Element, edge: SVGPathElement | undefined, animate: boolean) {
  const toK = view.k < 0.6 ? 0.9 : view.k;
  const end = centerOf(view, stage, node);
  if (animate) return glide(view, stage, panel, edge ? [...pointsOf(view, stage, edge), end] : [end], toK);
  view.anim++;
  const mid = freeCenter(stage, panel);
  view.set(mid.x - end.x * toK, mid.y - end.y * toK, toK);
}
