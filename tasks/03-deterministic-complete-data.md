# 03 — Complete, code-defined JSON with step levels

Wave 1 (runs in parallel with 01, 02, 04). Depends on: nothing.

## Goal

The code-map JSON must be a **complete and deterministic** record of what the code does within a scope that a person or agent chooses. Today it is not, for two reasons:
- `maxSteps` (default 60) and `maxDepth` (default 8) silently cut the walk short (`src/trace.ts`, `tracePath`);
- agents are told to tune those limits until the map has 8–40 steps.

Make the walk complete, take the clock out of the document, and add per-step hierarchy data so the viewer can show "levels".

## Required changes

1. **No silent truncation.** `tracePath` follows every reachable call within the scope.
   - **Scope:** the scope is `dirs`, `include`, `tests`, `entry` and `select`. With `select`, `maxHops` stays: it decides which unselected functions the walk looks through, so it is part of the scope.
   - **Flags:** remove `maxSteps` and `maxDepth` as trimming knobs from `src/trace.ts`, `src/pipeline.ts`, `src/cli.ts` (`--max-steps`, `--max-depth`) and `src/mcp.ts`.
   - **Old CLI flags:** passing them must fail with a clear message that the walk is now complete, so use `include` or `select` to narrow it.
   - **Safety cap:** add one hard cap, default 2000 steps. When it is hit, the build **fails** with an error that gives the step count and advises narrowing the scope. It never writes a partial map.
   - **Truncation fields:** remove `truncated` from the walk and the document, or make it always false.
2. **Deterministic document.**
   - **No clock:** remove `generatedAt` from `CodeMapDocument`. Two builds from the same code and arguments must be byte-identical.
   - **Version:** bump `VERSION` to 2. `toDocument` must still accept version-1 documents and raw `{map, walkthrough}` dumps.
3. **Levels data.** Each step records two new fields:
   - `parent`: the 1-based step number in `system.steps`. It already exists 0-based on `PathStep`.
   - `descendants`: the count of **all** steps beneath it in the step tree, not only direct children.
   - **Where:** compute both in `tracePath` and add them to `PathStep` in `src/types.ts`. Expose them in `system.steps[]` (from `stepFacts` in `src/pagedata.ts`) and in `render.walkthrough.steps[]`.
   - **Shared steps:** a step reached from several callers counts under its first parent only, matching the existing `parent`. Write this on the field's doc comment.
   - **Contract:** this is fixed, because task 04 codes against it: `system.steps[i].descendants: number`, `system.steps[i].parent?: number` (1-based).
4. **Agent guidance.** Replace the "aim for 8–40 steps / lower maxDepth" advice in:
   - `src/mcp.ts` (INSTRUCTIONS, the `trace` advice and the tool descriptions);
   - `docs/agents/workflow.md`;
   - `README.md`.

   The new advice: the map covers everything reachable in the chosen scope. To focus it, narrow the scope with `include`, `select` or `entry`, never by dropping steps. People hide helpers with the viewer's level filter. The `trace` summary should report the step count and the steps with the most descendants.
5. **Tests.** Add `test/determinism.test.ts` with these cases:
   - Two `buildDocument` runs on the fixture are byte-identical.
   - `descendants` is correct on a hand-checked fixture path: the root equals the total steps minus 1, and every leaf has 0.
   - The safety cap throws.
   - A version-1 document still loads through `toDocument`.

   Update existing tests that used the removed options.

## Files you own

- `src/trace.ts`, `src/types.ts`, `src/pipeline.ts`, `src/cli.ts`, `src/mcp.ts`
- `docs/agents/workflow.md`, `README.md`
- `test/determinism.test.ts`, `test/analyze.test.ts`, `test/mcp.test.ts`, `test/document.test.ts`
- In `src/pagedata.ts`, **only**:
  - the `SystemStep` and `CodeMapDocument` interfaces;
  - `stepFacts`;
  - `VERSION`;
  - `generatedAt`;
  - `toDocument`;
  - the removal of `truncated`.

  Task 02 is restructuring the internals of that file at the same time, so keep your edits there small and local.

**Do not edit:** `src/page.ts`, `src/viewer/**` (task 04), `src/describe.ts`, `src/context.ts`, `src/authored.ts` (task 02). If `describe.ts` mentions truncation, leave it and note it in your report; task 05 removes it.

## Acceptance criteria

- `grep -rn "maxSteps\|max-steps\|maxDepth\|max-depth" src docs README.md` matches only the removal error message.
- `bun run src/cli.ts test/fixture -e handlePost -o <tmp>/a.json`, run twice, gives identical files (`cmp`).
- `bun run src/cli.ts . -i src -o <tmp>/self.json`, the repo mapping itself, completes, and `jq '.system.steps[0].descendants'` returns a number.
- The safety cap is covered by a test. Passing `--max-steps 5` exits non-zero with the new message.
- `bun run typecheck` and `bun run test` pass.

## Out of scope

- Viewer UI.
- Restructuring the helpers in `pagedata.ts` (task 02).
- `~/.claude/skills/code-map/SKILL.md`, which is outside the repo. Instead, list in your report the lines in it that need updating.
