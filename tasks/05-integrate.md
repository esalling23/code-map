# 05 — Integrate tasks 01–04 and verify end to end

Wave 2. Depends on: 01, 02, 03 and 04 all judged PASS.

## Goal

Merge the four task branches into one working tree, resolve the conflicts, connect what each task left for this step, and verify the whole system.

## Steps

1. **Merge** the task branches into the integration branch, in this order:

   | Order | Branch |
   |---|---|
   | 1 | `orch/01-determinism-review` |
   | 2 | `orch/02-model-service` |
   | 3 | `orch/03-deterministic-complete-data` |
   | 4 | `orch/04-react-viewer` |

   **Expected conflicts:**
   - `src/pagedata.ts`:
     - 02 restructured its internals onto the model;
     - 03 changed `stepFacts`, `VERSION`, `generatedAt` and `toDocument`, and added `descendants` and `parent`.

     Keep 02's structure and 03's behaviour.
   - `test/analyze.test.ts` and `test/document.test.ts`:
     - 03 changed the options;
     - 04 changed the render assertions.

     Keep both.
2. **Connect** the pieces:
   - **Levels:** the React viewer reads `descendants` and `parent` from version-2 documents. The version-1 fallback stays for old files.
   - **Diagram adapter:** if 04 left a pure diagram adapter in `src/viewer/`, merge it into the model or `pagedata.ts`, so one function makes the Mermaid source with an optional visible-step set.
   - **`dataIdsOf`:** move it onto the model from 02, if it isn't there already.
   - **Truncation text:** remove any truncation wording that is left in `src/describe.ts`.
   - **Determinism review:** update the "Target" section of `docs/DETERMINISM.md` into an "Implemented" note, with file references to the final code.
3. **Check** that `README.md` and `docs/agents/*.md` describe the final behaviour:
   - no step limits;
   - levels in the viewer;
   - React viewer build;
   - document version 2.

## Acceptance criteria

- `git status` is clean after the merge commit: no conflict markers (`grep -rn "^<<<<<<<\|^>>>>>>>" src test docs README.md` is empty).
- **Typecheck and tests:** `bun run typecheck` and `bun run test` pass. Report the test count.
- **Build:** `bun run build:viewer` succeeds.
- **Determinism:** build `bun run src/cli.ts test/fixture -e handlePost -o <tmp>/a.json` twice. The two files are byte-identical (`cmp`).
- **Map of the repo itself:** build `bun run src/cli.ts . -i src -o <tmp>/self.json -o <tmp>/self.html`.
  - It completes with no truncation.
  - Every step has `descendants`.
- **MCP round trip:** `test/mcp.test.ts` passes. The `trace` tool's advice no longer mentions step limits.
- **Browser check** with Playwright, served by `code-map view <tmp>/self.json --no-open`:
  - the diagram, walkthrough and step navigator work;
  - the levels filter at 3+ hides helpers and keeps the numbering, and expanding a group works;
  - the recent list works and survives a reload;
  - the standalone `self.html` renders;
  - the console has no errors.
- **Leftovers:** no file from the old viewer remains (`src/page.ts`, `src/viewer/behavior.js`). No step-limit options remain except the removal message.

## Out of scope

- Deploying.
- Editing `~/.claude/skills/code-map/SKILL.md`. Give the user the lines from task 03's report instead.
