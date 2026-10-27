// The page's behavior: tabs, syntax highlighting, and the zoomable, hoverable diagrams with the step navigator.
// Runs once per page load, after the page's HTML (from page.ts) is in the document.

/** Wire up the rendered page. `mermaid` is the Mermaid module, loaded by the caller. */
export async function activate(mermaid) {
  function highlight(root) {
    if (!window.hljs) return;
    for (const box of root.querySelectorAll(".codebox:not([data-hl])")) {
      box.dataset.hl = "1";
      const language = box.dataset.lang;
      for (const src of box.querySelectorAll(".ln:not(.gap) .src")) {
        try { src.innerHTML = hljs.highlight(src.textContent, { language, ignoreIllegals: true }).value; } catch {}
      }
    }
  }

  // Fill a panel (and any visible nested panels) from its template the first time it shows.
  function fill(panel) {
    const pending = [panel, ...panel.querySelectorAll(".tabpanel:not([hidden])")].filter((p) => p.dataset.tpl && !p.dataset.filled);
    for (const p of pending) {
      p.dataset.filled = "1";
      p.append(document.getElementById(p.dataset.tpl).content.cloneNode(true));
    }
    highlight(panel);
  }

  const panelsOf = (set) => [...set.children].filter((c) => c.classList.contains("tabpanel"));
  function select(button) {
    const bar = button.parentElement;
    const set = bar.parentElement;
    const index = [...bar.children].indexOf(button);
    [...bar.children].forEach((b, i) => b.setAttribute("aria-selected", String(i === index)));
    panelsOf(set).forEach((p, i) => (p.hidden = i !== index));
    fill(panelsOf(set)[index]);
  }
  // Select a tab and every tab above it, so a nested tab ends up visible.
  function reveal(button) {
    const outerPanel = button.closest(".tabset").parentElement.closest(".tabpanel");
    if (outerPanel) {
      const outerSet = outerPanel.parentElement;
      const i = panelsOf(outerSet).indexOf(outerPanel);
      reveal(outerSet.querySelector(":scope > .tabbar").children[i]);
    }
    select(button);
  }

  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tabbar > button");
    if (tab) return select(tab);
    const opener = e.target.closest("[data-open]");
    if (opener) {
      const target = opener.closest(".step").querySelector('[data-key="' + CSS.escape(opener.dataset.open) + '"]');
      if (target) reveal(target);
    }
  });

  highlight(document);
  document.querySelectorAll(".tabset").forEach((set) => fill(panelsOf(set)[0]));

  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", flowchart: { htmlLabels: true, curve: "basis" }, maxTextSize: 200000 });


  // Zoom and pan: buttons, Ctrl/⌘ + wheel or pinch to zoom, drag to move. In full screen, a plain wheel pans.
  function setupDiagram(container) {
    const stage = container.querySelector(".stage");
    const pre = stage.querySelector("pre");
    const svg = pre.querySelector("svg");
    if (!svg || container.dataset.ready) return;
    container.dataset.ready = "1";
    const vb = svg.viewBox.baseVal;
    const w = vb.width, h = vb.height;
    svg.removeAttribute("style");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    const level = container.querySelector(".zoomlevel");
    let k = 1, x = 0, y = 0;
    const apply = () => { pre.style.transform = `translate(${x}px, ${y}px) scale(${k})`; level.textContent = Math.round(k * 100) + "%"; };
    const zoomTo = (nk, cx, cy) => { nk = Math.min(4, Math.max(0.05, nk)); x = cx - (cx - x) * nk / k; y = cy - (cy - y) * nk / k; k = nk; apply(); };
    const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    const fit = () => {
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      k = Math.min(r.width / w, r.height / h) * 0.96;
      x = (r.width - w * k) / 2;
      y = h * k < r.height ? (r.height - h * k) / 2 : 12;
      apply();
    };
    // Start readable, centred on the entry box; Fit shows the whole diagram.
    const start = () => {
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      k = Math.min(1, Math.max(r.width / w, 0.75));
      x = 0; y = 0; apply();
      const node = svg.querySelector('g.node[id^="flowchart-s0-"]') ?? svg.querySelector("g.node");
      const nr = node.getBoundingClientRect();
      x = w * k <= r.width ? (r.width - w * k) / 2 : Math.min(0, Math.max(r.width - w * k, r.width / 2 - (nr.left - r.left + nr.width / 2)));
      y = h * k <= r.height ? (r.height - h * k) / 2 : Math.min(16, 32 - (nr.top - r.top));
      apply();
    };
    start();
    // The camera, for the step navigator: where the view is, and a way to move it.
    const view = container.view = {
      stage, svg,
      get k() { return k; }, get x() { return x; }, get y() { return y; },
      set(nx, ny, nk) { x = nx; y = ny; k = nk; apply(); },
      start, anim: 0,
    };
    const stopGlide = () => { view.anim++; };

    container.querySelector(".toolbar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-zoom]");
      if (!b) return;
      const act = b.dataset.zoom;
      if (act === "in") zoomTo(k * 1.25, ...center());
      if (act === "out") zoomTo(k / 1.25, ...center());
      if (act === "fit") fit();
      if (act === "start") start();
      if (act === "full") document.fullscreenElement ? document.exitFullscreen() : container.requestFullscreen?.();
    });
    container.addEventListener("fullscreenchange", () => setTimeout(() => fit(), 50));

    stage.addEventListener("wheel", (e) => {
      if (e.target.closest(".steppanel")) return;
      stopGlide();
      const r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(k * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      } else if (document.fullscreenElement === container) {
        e.preventDefault();
        x -= e.deltaX; y -= e.deltaY; apply();
      }
    }, { passive: false });
    stage.addEventListener("dblclick", (e) => { if (e.target.closest("g.node, .steppanel")) return; const r = stage.getBoundingClientRect(); zoomTo(k * 1.6, e.clientX - r.left, e.clientY - r.top); });
    stage.addEventListener("keydown", (e) => {
      if (e.key === "+" || e.key === "=") zoomTo(k * 1.25, ...center());
      else if (e.key === "-") zoomTo(k / 1.25, ...center());
      else if (e.key === "0") fit();
      else return;
      e.preventDefault();
    });
    // The step navigator's keys work anywhere in the panel, toolbar included.
    if (container.dataset.pathView) container.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") stepBy(1);
      else if (e.key === "ArrowLeft") stepBy(-1);
      else if (e.key === "Escape" && state.at >= 0) stopStepping();
      else return;
      e.preventDefault();
    });

    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".steppanel")) return;
      stopGlide();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, ox: x, oy: y }; moved = false; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; drag = null; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k }; }
    });
    window.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const r = stage.getBoundingClientRect();
        zoomTo(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        moved = true;
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; stage.classList.add("dragging"); }
        if (moved) { x = drag.ox + dx; y = drag.oy + dy; apply(); }
      }
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; stage.classList.remove("dragging"); } };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    // A drag ends with a click; don't let it open a step.
    stage.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);

    setupHover(container, svg);
    if (container.dataset.pathView) {
      svg.querySelectorAll("g.node").forEach((n) => {
        const m = n.id.match(/^flowchart-s(\d+)-/);
        if (m) n.addEventListener("click", () => document.getElementById("step-" + (Number(m[1]) + 1))?.scrollIntoView({ behavior: "smooth" }));
      });
    }
  }

  // Hover a box: what calls it (orange) and what it calls (blue), by step number and name. Hover an arrow: both ends.
  function setupHover(container, svg) {
    const tip = container.querySelector(".tip");
    const info = JSON.parse(document.getElementById(container.dataset.info)?.textContent || "{}");
    const nodes = new Map();
    svg.querySelectorAll("g.node").forEach((n) => { const m = n.id.match(/^flowchart-(.+)-\d+$/); if (m) nodes.set(m[1], n); });
    const labels = [...svg.querySelectorAll(".edgeLabels > .edgeLabel")];
    const edges = [...svg.querySelectorAll("path.flowchart-link")].map((p, i) => {
      const cls = [...p.classList];
      return { p, label: labels[i], from: cls.find((c) => c.startsWith("LS-"))?.slice(3), to: cls.find((c) => c.startsWith("LE-"))?.slice(3) };
    }).filter((e) => !/stroke-width:\s*0/.test(e.p.getAttribute("style") || ""));
    for (const e of edges) {
      e.hit = e.p.cloneNode();
      ["id", "style", "marker-end", "marker-start"].forEach((a) => e.hit.removeAttribute(a));
      e.hit.setAttribute("class", "edge-hit");
      e.p.after(e.hit);
      e.text = e.label?.textContent.trim() || "";
    }
    container.nodeMap = nodes;
    container.edgeList = edges;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const title = (id) => info[id]?.title ?? nodes.get(id)?.textContent.trim() ?? id;
    const kind = (id) => info[id]?.kind ?? "step";
    const list = (items) => items.length <= 4 ? items.join(", ") : items.slice(0, 4).join(", ") + " and " + (items.length - 4) + " more";
    const mark = (el, c) => el?.classList.add(c);
    const clear = () => {
      container.classList.remove("focusing");
      svg.querySelectorAll(".hl-self,.hl-next,.hl-prev,.hl-out,.hl-in").forEach((el) => el.classList.remove("hl-self", "hl-next", "hl-prev", "hl-out", "hl-in"));
      tip.hidden = true;
    };
    const show = (rows) => { tip.innerHTML = rows.join(""); tip.hidden = false; };
    const named = (id, e) => esc(title(id)) + (e.text && kind(id) !== "data" ? ' <span class="k">(' + esc(e.text) + ")</span>" : "");

    function describeNode(id) {
      const out = edges.filter((e) => e.from === id), inc = edges.filter((e) => e.to === id);
      const rows = ["<b>" + esc(title(id)) + "</b>"];
      if (kind(id) === "data") {
        rows.push("<div>Used by: " + (inc.length ? list(inc.map((e) => esc(title(e.from)) + ' <span class="k">(' + esc(e.text) + ")</span>")) : "nothing on this map") + "</div>");
      } else if (kind(id) === "file") {
        rows.push("<div>← Used by: " + (inc.length ? list(inc.map((e) => esc(title(e.from)))) : "no file on this map") + "</div>");
        rows.push("<div>→ Uses: " + (out.length ? list(out.map((e) => esc(title(e.to)))) : "no other file on this map") + "</div>");
      } else {
        const callers = inc.filter((e) => kind(e.from) !== "data");
        const calls = out.filter((e) => kind(e.to) !== "data");
        const data = out.filter((e) => kind(e.to) === "data");
        rows.push("<div>← Called by: " + (callers.length ? list(callers.map((e) => named(e.from, e))) : "nothing on this map (a starting point)") + "</div>");
        rows.push("<div>→ Calls: " + (calls.length ? list(calls.map((e) => named(e.to, e))) : "nothing else on this map") + "</div>");
        if (data.length) rows.push("<div>Data: " + list(data.map((e) => esc(title(e.to)) + ' <span class="k">(' + esc(e.text) + ")</span>")) + "</div>");
      }
      return rows;
    }

    for (const [id, n] of nodes) {
      n.addEventListener("mouseenter", () => {
        clear();
        container.classList.add("focusing");
        mark(n, "hl-self");
        for (const e of edges.filter((e) => e.from === id)) { mark(e.p, "hl-out"); mark(e.label, "hl-out"); mark(nodes.get(e.to), "hl-next"); }
        for (const e of edges.filter((e) => e.to === id)) { mark(e.p, "hl-in"); mark(e.label, "hl-in"); mark(nodes.get(e.from), "hl-prev"); }
        show(describeNode(id));
      });
      n.addEventListener("mouseleave", clear);
    }
    for (const e of edges) {
      e.hit.addEventListener("mouseenter", () => {
        clear();
        container.classList.add("focusing");
        mark(e.p, "hl-out"); mark(e.label, "hl-out");
        mark(nodes.get(e.from), "hl-prev"); mark(nodes.get(e.to), "hl-next");
        show(["<b>" + esc(title(e.from)) + "</b>", "<div>→ " + esc(title(e.to)) + "</div>", e.text ? '<div class="k">' + esc(e.text) + "</div>" : ""]);
      });
      e.hit.addEventListener("mouseleave", clear);
      e.hit.addEventListener("click", () => {
        const m = e.to?.match(/^s(\d+)$/);
        if (m) document.getElementById("step-" + (Number(m[1]) + 1))?.scrollIntoView({ behavior: "smooth" });
      });
    }
    // File and class boxes: the full path on hover.
    svg.querySelectorAll("g.cluster").forEach((c) => {
      const id = [...nodesIdsOf(c)][0];
      if (!info[id]) return;
      const label = c.querySelector(".cluster-label") || c;
      label.addEventListener("mouseenter", () => { clear(); show(["<b>" + esc(info[id].title) + "</b>"]); });
      label.addEventListener("mouseleave", clear);
    });
    function nodesIdsOf(c) { return [c.id, c.getAttribute("data-id")].filter(Boolean); }
    container.querySelector(".stage").addEventListener("mousemove", (ev) => {
      if (tip.hidden) return;
      const r = container.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8)) + "px";
      tip.style.top = ev.clientY - r.top + 16 + "px";
    });
  }

  const tabs = document.querySelectorAll(".tabs button");
  async function renderTab(name) {
    const container = document.getElementById("tab-" + name);
    const el = container.querySelector(".mermaid");
    if (el && !el.dataset.processed) await mermaid.run({ nodes: [el] });
    setupDiagram(container);
  }

  // ── The call path's view state, shared by its two modes: compact, the full path, and the step navigator ──
  const route = JSON.parse(document.getElementById("route")?.textContent || "[]");
  const stops = route.map((r, i) => i).filter((i) => route[i].nav);
  let panelOpen = true;
  try { panelOpen = localStorage.getItem("codemap-panel") !== "0"; } catch {}
  const state = { compact: false, full: false, at: -1, panel: panelOpen };
  const pathName = () => (state.compact ? "pathc" : "path");
  const pathView = () => document.getElementById("tab-" + pathName());
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const edgesInto = (c, r) => (r.from ? c.edgeList.filter((e) => e.from === r.from && e.to === r.id) : []);

  function applyPath(c) {
    if (!c?.edgeList) return;
    const svg = c.view.svg;
    svg.querySelectorAll(".on-path,.nav-edge,.nav-cur,.nav-from").forEach((el) => el.classList.remove("on-path", "nav-edge", "nav-cur", "nav-from"));
    const stepping = state.at >= 0;
    c.classList.toggle("pathing", state.full || stepping);
    const upTo = state.full ? route.length - 1 : state.at;
    for (let i = 0; i <= upTo; i++) {
      const r = route[i];
      c.nodeMap.get(r.id)?.classList.add("on-path");
      for (const e of edgesInto(c, r)) { e.p.classList.add("on-path"); e.label?.classList.add("on-path"); }
    }
    if (stepping) {
      const r = route[state.at];
      c.nodeMap.get(r.id)?.classList.add("nav-cur");
      if (r.from) c.nodeMap.get(r.from)?.classList.add("nav-from");
      for (const e of edgesInto(c, r)) { e.p.classList.add("nav-edge"); e.label?.classList.add("nav-edge"); }
    }
    c.querySelector('[data-path="full"]').setAttribute("aria-pressed", String(state.full));
    c.querySelector('[data-mode="compact"]').setAttribute("aria-pressed", String(state.compact));
    const pos = stops.indexOf(state.at);
    const label = c.querySelector(".navlabel");
    label.textContent = stepping ? "Step #" + (Number(route[state.at].id.slice(1)) + 1) : "Step through";
    c.querySelector('[data-nav="prev"]').disabled = stepping && pos <= 0;
    c.querySelector('[data-nav="next"]').disabled = stepping && pos >= stops.length - 1;
    c.querySelector('[data-nav="stop"]').hidden = !stepping;
    c.querySelector('.toolbar [data-nav="panel"]').setAttribute("aria-pressed", String(state.panel));
    const panel = c.querySelector(".steppanel");
    panel.hidden = !(stepping && state.panel);
    if (!panel.hidden && panel.dataset.step !== route[state.at].id) {
      // The step's own text from the walkthrough below, without its data and code previews.
      const n = Number(route[state.at].id.slice(1)) + 1;
      const explain = document.getElementById("step-" + n)?.querySelector(".explain")?.cloneNode(true);
      const body = panel.querySelector(".body");
      body.replaceChildren();
      if (explain) {
        explain.querySelectorAll(".chips").forEach((el) => el.remove());
        explain.querySelectorAll("button.peek").forEach((b) => b.replaceWith(...b.childNodes));
        const more = document.createElement("a");
        more.className = "more";
        more.href = "#step-" + n;
        more.textContent = "Read with the code ↓";
        explain.append(more);
        body.append(explain);
      }
      panel.dataset.step = route[state.at].id;
      panel.scrollTop = 0;
    }
  }

  // The middle of the part of the stage the step panel leaves free, in stage coordinates.
  function freeCenter(c) {
    const r = c.view.stage.getBoundingClientRect();
    const panel = c.querySelector(".steppanel");
    if (!panel || panel.hidden) return { x: r.width / 2, y: r.height / 2 };
    const p = panel.getBoundingClientRect();
    if (p.left - r.left > r.width / 3) return { x: (p.left - r.left) / 2, y: r.height / 2 };
    return { x: r.width / 2, y: (p.top - r.top) / 2 };
  }
  // A point of the diagram, in its own unscaled coordinates, from a point on screen.
  function local(c, sx, sy) {
    const r = c.view.stage.getBoundingClientRect();
    return { x: (sx - r.left - c.view.x) / c.view.k, y: (sy - r.top - c.view.y) / c.view.k };
  }
  function centerOf(c, el) {
    const b = el.getBoundingClientRect();
    return local(c, b.left + b.width / 2, b.top + b.height / 2);
  }
  // The arrow's own line, sampled from its start to its end.
  function pointsOf(c, path) {
    const ctm = path.getScreenCTM();
    const len = path.getTotalLength();
    const n = Math.max(8, Math.min(48, Math.round(len / 25)));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const p = path.getPointAtLength((len * i) / n);
      const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      out.push(local(c, q.x, q.y));
    }
    return out;
  }

  // Glide the view along a line of points (diagram coordinates), ending centred on the last one.
  function glide(c, points, toK) {
    const v = c.view;
    const r = v.stage.getBoundingClientRect();
    const k0 = v.k, k1 = toK ?? v.k;
    const mid = freeCenter(c);
    const here = local(c, r.left + mid.x, r.top + mid.y);
    const line = [here, ...points];
    const dist = [0];
    for (let i = 1; i < line.length; i++) dist.push(dist[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    const total = dist[dist.length - 1];
    const at = (t) => {
      const d = t * total;
      let i = 1;
      while (i < line.length - 1 && dist[i] < d) i++;
      const span = dist[i] - dist[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (d - dist[i - 1]) / span));
      return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * f, y: line[i - 1].y + (line[i].y - line[i - 1].y) * f };
    };
    const place = (p, k) => v.set(mid.x - p.x * k, mid.y - p.y * k, k);
    const token = ++v.anim;
    if (reducedMotion || total < 1) return place(line[line.length - 1], k1);
    const ms = Math.min(1600, Math.max(450, total * k1 * 1.1));
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const frame = (now) => {
      if (token !== v.anim) return;
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      place(at(e), k0 + (k1 - k0) * e);
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Move the view to the current step, following the arrow that leads into it.
  function follow(c, animate) {
    const r = route[state.at];
    const node = c.nodeMap.get(r.id);
    if (!node) return;
    const toK = c.view.k < 0.6 ? 0.9 : c.view.k;
    const end = centerOf(c, node);
    const edge = edgesInto(c, r)[0];
    const points = edge ? [...pointsOf(c, edge.p), end] : [end];
    if (animate) glide(c, points, toK);
    else { const mid = freeCenter(c); c.view.set(mid.x - end.x * toK, mid.y - end.y * toK, toK); }
  }

  function stepBy(delta) {
    if (!stops.length) return;
    const pos = stops.indexOf(state.at);
    const next = pos < 0 ? (delta > 0 ? 0 : stops.length - 1) : Math.min(stops.length - 1, Math.max(0, pos + delta));
    if (stops[next] === state.at) return;
    state.at = stops[next];
    const c = pathView();
    applyPath(c);
    follow(c, true);
  }
  function stopStepping() {
    state.at = -1;
    applyPath(pathView());
  }

  document.addEventListener("click", async (e) => {
    const jump = e.target.closest(".steppanel a[href^='#step-']");
    if (jump && !jump.classList.contains("more")) {
      const i = route.findIndex((r) => r.id === "s" + (Number(jump.getAttribute("href").slice(6)) - 1));
      if (i >= 0 && route[i].nav) {
        e.preventDefault();
        state.at = i;
        applyPath(pathView());
        follow(pathView(), true);
      }
      return;
    }
    const b = e.target.closest("[data-path-view] .toolbar button, .steppanel .close");
    if (!b) return;
    if (b.dataset.nav === "prev") stepBy(-1);
    else if (b.dataset.nav === "next") stepBy(1);
    else if (b.dataset.nav === "stop") stopStepping();
    else if (b.dataset.nav === "panel") {
      state.panel = !state.panel;
      try { localStorage.setItem("codemap-panel", state.panel ? "1" : "0"); } catch {}
      applyPath(pathView());
      if (state.at >= 0) follow(pathView(), true);
    }
    else if (b.dataset.nav === "open") {
      if (state.at < 0) return stepBy(1);
      document.getElementById("step-" + (Number(route[state.at].id.slice(1)) + 1))?.scrollIntoView({ behavior: "smooth" });
    } else if (b.dataset.path === "full") {
      state.full = !state.full;
      applyPath(pathView());
    } else if (b.dataset.mode === "compact") {
      const from = pathView();
      const full = document.fullscreenElement === from;
      state.compact = !state.compact;
      const to = pathView();
      from.hidden = true;
      to.hidden = false;
      await renderTab(pathName());
      applyPath(to);
      if (state.at >= 0) follow(to, false);
      if (full) to.requestFullscreen?.();
      to.querySelector(".stage").focus({ preventScroll: true });
    }
  });

  tabs.forEach((b) => b.addEventListener("click", async () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    const name = b.dataset.tab === "path" ? pathName() : b.dataset.tab;
    document.querySelectorAll(".diagram").forEach((d) => (d.hidden = d.id !== "tab-" + name));
    await renderTab(name);
    if (b.dataset.tab === "path") applyPath(pathView());
  }));

  await renderTab("path");
  applyPath(pathView());
  let active = [];
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      document.querySelectorAll(".step.current").forEach((s) => s.classList.remove("current"));
      e.target.classList.add("current");
      active.forEach((n) => n.classList.remove("active"));
      active = [...document.querySelectorAll('[data-path-view] g.node[id^="flowchart-' + e.target.dataset.node + '-"]')];
      active.forEach((n) => n.classList.add("active"));
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  document.querySelectorAll(".step").forEach((s) => observer.observe(s));
}
