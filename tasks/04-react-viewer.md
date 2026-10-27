# 04 — Rewrite the viewer as a React app, with a levels filter

Wave 1 (runs in parallel with 01, 02, 03). Depends on: nothing. It codes against the data contract in "Levels" below, with a fallback for documents that predate it.

## Goal

Today the viewer has three parts:
- an HTML-string renderer, `src/page.ts` (`renderPage`);
- a 500-line imperative DOM script, `src/viewer/behavior.js` (`activate(mermaid)`), with tabs, zoom and pan, hover tooltips, the step navigator and call-path modes;
- the boot, home and recent-files logic in `src/viewer/app.ts`.

Replace all three with a **modular React app**. Organize the components by feature, with no duplicated logic and no document-wide listeners that make a page reload necessary.

It must keep **every current feature** and add a **levels filter**.

## Current features to keep (check each in the browser)

1. **Boot order:**
   1. data embedded in `<script id="code-map-data">` (a standalone `.html` page; no top bar shown);
   2. `?src=<url>` (used by `code-map view`);
   3. `#map=<id>` (a recent file from IndexedDB);
   4. the home screen.
2. **Home screen:**
   - a drop zone and file picker that accept `.json`;
   - a list of recent files (title, file name, size, when opened), with a remove button on each and a "forget all" button;
   - an inline error for a bad file.
   - Storage stays in `src/viewer/storage.ts` with the same API: newest 20 kept, SHA-256 id, in-memory fallback.
3. **Top bar:** a "← Code maps" link home, and "Open file…". Opening another map no longer needs a full page reload.
4. **Intro:** title, summary, role, repos and areas, and the overview.
5. **Diagrams** (Mermaid 10.9.1, imported dynamically from jsdelivr as it is now): the call path in full and compact modes, and the files diagram.
   - **Zoom and pan:** buttons, Ctrl/⌘+wheel and pinch, drag, double-click, keyboard, full screen.
   - **Hover:** tooltips showing callers and callees.
   - **Clicks:** clicking a node scrolls to its step; clicking an edge highlights both ends.
6. **Step navigator:** step through the path with the view gliding along the arrows, and the side step panel.
7. **Walkthrough:**
   - each step's description, with code excerpts highlighted by highlight.js 11.9.0 (from cdnjs, theme CSS inlined, as now);
   - tabs and nested tabs, filled lazily;
   - call and data snippets;
   - the data section.
8. **Light and dark theme**, styled by the existing `src/viewer/page.css` and `viewer.css`. Restructure the CSS as needed, but keep the look.

## Levels (new)

A control in the top bar or intro: **"Show steps with at least N steps beneath them"**.

- **Options:** All (default), 1+, 3+, 5+, 10+.
- **Value:** stored per viewer in `localStorage`, with every access in try/catch.
- **When it is set:**
  - steps below the threshold are hidden from the call-path diagram, the step navigator and the walkthrough;
  - step numbers stay as they are in the JSON. Don't renumber.
  - a step whose children are hidden shows "N helper steps hidden", and clicking it expands them inline.
  - the root and any step without a parent are always shown.
- **Data contract** (produced by task 03, document version 2):
  - `system.steps[i].descendants: number`, the count of all steps beneath it;
  - `system.steps[i].parent?: number`, a 1-based step number.

  For version-1 documents that lack these fields, compute both in one pure helper from `render.walkthrough.steps[].parent`, which is 0-based. Don't put the computation in components.
- **Diagram data:** the Mermaid source for a filtered path must be generated from data. Reuse `pathDiagram`'s node and edge logic in `src/pagedata.ts`; don't fork it. If it can't take a visible set, tell the judge in your report. Don't change `pagedata.ts`, which tasks 02 and 03 are editing. Put a pure adapter in `src/viewer/` instead, and task 05 merges it.

## Technical requirements

- **React:** add `react` and `react-dom` with `bun add`. Keep their types as dev dependencies. React is **bundled** into the single-file viewer, not loaded from a CDN.
- **Build:** `src/viewer/build.ts` (`buildViewerHtml`, `embedDocument`) keeps its API and still produces one self-contained HTML file.
  - Bundle the `.tsx` entry with `Bun.build`. Mermaid and hljs stay on the CDN.
  - Keep the `<!--code-map-data-->` embed slot and the `</script` escaping.
- **Layout:** `src/viewer/` organized by feature, for example:
  - `App.tsx`, `boot.ts`;
  - `home/`;
  - `map/` (Intro, Walkthrough, Step, CodeBox, Tabs);
  - `diagram/` (Diagram, useZoomPan, useMermaid, Tooltip, StepNavigator);
  - `levels/` (the pure filter helpers and the control);
  - `storage.ts`.

  Shared hooks hold logic that is used in several places, such as zoom and pan, and lazy tabs.
- **Removals:** delete `src/page.ts`, `src/viewer/behavior.js` and `behavior.d.ts` once nothing imports them.
  - The pure helpers in `page.ts` that other code needs (`excerpt`, `shortPath`, `esc`, `dataIdsOf`) move into the viewer or a pure shared module.
- **Isomorphic:** keep the React tree renderable with `react-dom/server` `renderToString` from a document. Port the `renderPage` string assertions in `test/analyze.test.ts` to render the React tree.
  - Change only the render-assertion parts of that test file. Task 03 also edits it, for its options, and task 05 merges the two.
- **Tests:** add `test/levels.test.ts` for the pure filter helpers:
  - the fallback compute matches the explicit fields;
  - the threshold hides leaves and keeps roots;
  - the hidden-child counts are right.
- **Config:** keep `tsconfig.json` strict; add `jsx: "react-jsx"` if needed.

## Files you own

- `src/viewer/**`, `src/page.ts` (delete), `scripts/build-viewer.ts`
- `package.json` and `bun.lock` (react dependencies only), `tsconfig.json` (the jsx setting)
- `test/levels.test.ts`, and the render-assertion parts of `test/analyze.test.ts` and `test/document.test.ts`

**Do not edit:** `src/pagedata.ts`, `src/trace.ts`, `src/types.ts`, `src/pipeline.ts`, `src/cli.ts`, `src/mcp.ts`, `src/authored.ts`, `src/describe.ts`, `src/context.ts`.

## Acceptance criteria

- **Typecheck and tests:** `bun run typecheck` and `bun run test` pass.
- **Build:** `bun run build:viewer` writes one `dist/index.html`. Report its size.
- **Browser check:** use Playwright. It refuses `file://` URLs, so serve the files with a small `Bun.serve` from inside the repo. Then:
  - Load a JSON built from `test/fixture` through `?src=`, and through file upload.
  - Confirm features 1–8 work and the console has no errors.
  - Reload and reopen from the recent list.
  - Build a standalone `.html` with `bun run src/cli.ts test/fixture -e handlePost -o <tmp>/x.html` and open it.
- **Levels on a big map:** build `bun run src/cli.ts . -i src -o <tmp>/self.json` and set the filter to 3+.
  - The diagram and walkthrough get shorter, and step numbers are unchanged.
  - Expanding a "hidden" group shows its steps.
  - Report the step counts at All and at 3+.
- **Cleanup:** no `innerHTML` built from strings remains in the viewer, except highlight.js and Mermaid output.
  - No document-level listeners remain that are not cleaned up on unmount.
  - `behavior.js` is gone.

## Out of scope

- Hosting or deploying.
- Changes to the JSON shape (task 03).
- Restructuring the helpers in `pagedata.ts` (task 02).
