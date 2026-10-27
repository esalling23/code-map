# 02 — Combine the (map, walk) helpers into one model service

Wave 1 (runs in parallel with 01, 03, 04). Depends on: nothing.

## Goal

Many helpers take the same pair, `(map: CodeMap, walk: Walkthrough)`, and each rebuilds the same lookups:
- step by symbol id;
- the symbol of a step;
- the repo of a file;
- the parent step;
- the data ids used.

Combine them into **one model service** that owns that shared data and its derived indexes, built once. The helpers become methods or thin functions over it. This is a refactor: **the JSON document produced must be byte-identical before and after**, apart from the `generatedAt` value.

First decide whether the combination is worth it. Write the decision in the header comment of the new module, in at most 5 lines. If a helper does not share data, leave it as a free function and say why.

## Files you own

You may edit only these:
- `src/model.ts` (new)
- `src/pagedata.ts` (internals only)
- `src/authored.ts`
- `src/describe.ts`
- `src/context.ts`
- New tests under `test/model.test.ts`.

**Do not edit:**
- `src/page.ts` or anything under `src/viewer/`. Task 04 is rewriting the viewer in React.
- `src/trace.ts`, `src/pipeline.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`. Task 03 owns these.

## Helpers to consider

- `src/pagedata.ts`:
  - `stepFacts`, `defaultTitle`, `systemSummary`, `referencedSymbols`;
  - `repoOfFile`, `groupedSubgraphs`, `pathNodeInfo`, `pathDiagram`, `routeOf`, `filesDiagram`.
- `src/describe.ts`: `describeStep`, `describeHeuristic`.
- `src/context.ts`: `buildContext`.
- `src/authored.ts`: `buildTemplate`, `applyDescriptions`.
- `src/page.ts`: `dataIdsOf`. Note it as a candidate for the model, but don't move it; task 05 wires it up.

## Constraints

- **Pure:** `src/model.ts` and `src/pagedata.ts` must not import `node:*` or `fs`. They are bundled into the browser viewer.
  - Anything that reads files (the docs read in `context.ts`, `readDescriptions` in `authored.ts`) stays outside the pure module.
- **Same contract:** keep the shape and key order of `CodeMapDocument` exactly as they are. Agents rely on `system` coming before `render`.
- **Same output:** the sort and iteration order of every output stays the same. That is what makes the output byte-identical.
- **Keep callers working:** keep the public exports that other files import: `buildDocument`, `toDocument`, `stepFacts`, `routeOf`, `defaultTitle`, `FORMAT`, `VERSION`, `buildTemplate`, `applyDescriptions`, `readDescriptions`, `describeHeuristic`. They can delegate to the model.

## Acceptance criteria

- **Model module:** `src/model.ts` exports a model built from `(map, walk)`. It builds its indexes once, not per call.
- **No duplicates:** none of the files you own rebuilds the same lookup.
  - Check: `grep -n "findIndex((s) => s.symbolId" src/` should show at most the model itself.
- **Byte-identical output:**
  - Capture the output on the baseline before you change anything: `bun run src/cli.ts test/fixture -e handlePost -o <tmp>/before.json`.
  - Build the same file after your change, removing `generatedAt` from both, and diff them. The diff must be empty.
  - Do the same with `bun run src/cli.ts . -i src -o <tmp>/self.json`, the repo mapping itself.
- **Tests:** `test/model.test.ts` covers the model's indexes.
- **Checks pass:** `bun run typecheck` and `bun run test`.

## Out of scope

- Changing behaviour, step limits or the document shape.
- Any viewer code.
