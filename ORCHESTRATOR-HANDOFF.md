# Orchestrator handoff: code-map determinism, model service, React viewer

**Prepared:** 2026-10-26
**Repository:** /Users/eronsalling/Developer/ESTech/code-map
**Branch:** `main`. The repo has **no commits yet**; see Setup.
**Run ledger:** /Users/eronsalling/Developer/ESTech/code-map/ORCHESTRATOR-LEDGER.md

## Your role

You are the **orchestrator**. You direct other agents and do none of the work yourself.

- **You never implement.** You never write code, edit source files, run builds that change the tree, or resolve merge conflicts. Every unit of work goes to a worker subagent. The exceptions are the ledger, the setup commits and the branch merges listed under Setup.
- **Run in waves, in parallel.** This overrides the default sequential protocol, at the user's request.
  - **Wave 1:** tasks 01–04 run at the same time, each in its own git worktree on its own branch.
  - **Wave 2:** task 05 runs only after all four are judged PASS.
  - The tasks were written to own separate files, so they can run in parallel; see "Files you own" in each spec.
- **Pass specs verbatim.** Each worker's brief contains its spec file's full contents, unchanged. Never summarise, reword or "improve" it.
- **You are the judge.** Judge each task on its own branch, from primary evidence: the branch diff, the command output you ran yourself in that worktree, and the files. The worker's report shows where to look but proves nothing.
- **Iterate until every task passes.** A task that fails goes to a fresh worker, in a fresh worktree from the same base, with the verbatim spec plus your findings. The other wave-1 tasks keep running.

Why it is built this way: a judge that also implements is grading its own work, and a judge that reads a summary instead of the spec is grading its own paraphrase.

## Context the workers need

**What the project is.** code-map is a Bun + TypeScript tool.
- It analyzes TS/JS repos with the TypeScript compiler API (`src/analyze.ts`) and traces one call path (`src/trace.ts`).
- It writes a **JSON document** (`src/pagedata.ts`, `buildDocument`):
  - `system`: an agent-readable sitemap of the steps, areas and links;
  - `render`: the data the viewer needs.
- A single-file browser viewer (`src/viewer/`) draws the document. The viewer can be hosted with file upload and a recent-files list in IndexedDB, opened locally with `code-map view`, or embedded in a standalone `.html`.
- An MCP server (`src/mcp.ts`) and the CLI (`src/cli.ts`) share one pipeline (`src/pipeline.ts`).
- Agents never edit the JSON. They choose the scope and write prose in a descriptions file (`src/authored.ts`), which is merged in by symbol id.

**What this change set does:**
1. A written review of how deterministic the output is (01).
2. One model service for the helpers that all take `(map, walk)` (02).
3. A complete, code-defined JSON: step limits are gone, there is a fail-loud safety cap, no timestamp, and each step has `parent` and `descendants` (03).
4. The viewer rewritten in React, with a "levels" filter that hides steps with fewer than N steps beneath them, while the JSON stays complete (04).
5. Integration of all four (05).

**Decisions the user made (don't revisit):**
- **Step limits:** remove them and fail loudly at a safety cap.
- **Levels metric:** all steps beneath a step, transitively.
- **React:** bundled, not loaded from a CDN.
- **Tasks:** split into five, with 01–04 in parallel.

**Read first:**
- `README.md`
- `docs/agents/workflow.md`
- `package.json` (scripts are the source of truth)
- your task spec

There is no `PAINS.md`, `FINDINGS.md` or `docs/ARCHITECTURE.md` in this repo.

**User rules that apply to every worker:**
- Use `bun`, never npm, npx or yarn.
- Read `package.json` before running scripts.
- Run the tests before committing.
- Use they/them for any person.

## Setup (orchestrator, before Wave 1)

1. **Baseline commit.** The repo has no commits, and worktrees need one.
   - The user must explicitly approve this first commit. Their global rule is to commit only when asked; saying "run it" for this handoff counts as approval for the baseline commit and for the commits on the task branches.
   - Commit the current tree on `main` as `chore: baseline before orchestrated refactor`.
   - Don't commit `generated/`: it holds symlinked external repos. Add it to `.gitignore` in the baseline commit if it isn't there already.
2. **Baseline evidence.**
   - Run `bun install`, `bun run typecheck` and `bun run test`, and record the results. At preparation time there were 46 tests passing in 3 files.
   - Record the outputs of `bun run src/cli.ts test/fixture -e handlePost -o /tmp/orch-baseline/fixture.json` and `bun run src/cli.ts . -i src -o /tmp/orch-baseline/self.json`.
3. **Worktrees.** For each task 01–04, create a worktree:
   ```
   git worktree add ../code-map-wt/NN-slug -b orch/NN-slug main
   ```
   Then run `bun install` inside it. Workers work and commit only inside their worktree.
4. **Ledger.** Create the ledger with the baseline recorded.

## Invariants: these must hold after EVERY task

Check them on each task's branch, and again after task 05.

### Business rules
- **Agents never edit the structure of the JSON.**
  - The steps, calls, data, areas and diagrams come only from the code plus the scope (`dirs`, `include`, `tests`, `entry`, `select`, `maxHops`).
  - Agent or person prose and links enter only through the descriptions file, applied by `applyDescriptions`.
  - Verify: read the diff of `src/authored.ts` and `src/pipeline.ts`; no new path writes structure from agent input.
- **`system` comes before `render` in the document**, and `read_map` returns `system`.
  - Verify: the "system before render" test in `test/document.test.ts`, and `test/mcp.test.ts`.
- **Authored descriptions match by symbol id and survive re-tracing.** Unmatched entries produce warnings and never fail silently.
  - Verify: the `applyDescriptions` tests in `test/analyze.test.ts`.
- **Old files still load.** `toDocument` accepts current documents, version-1 documents and raw `{map, walkthrough}` dumps, and rejects anything else with a clear error.
  - Verify: `test/document.test.ts`.
- **The descriptions checker is unchanged**: `src/check.ts`, `code-map check`, and the MCP tool `check_descriptions`.
  - Verify: the checker tests pass, and `src/check.ts` is untouched.

### Product behaviour
- **Every MCP tool still works** over stdio: `guide`, `list_entries`, `list_symbols`, `trace`, `check_descriptions`, `build`, `read_map`.
  - Verify: `test/mcp.test.ts`.
- **CLI commands work:**
  - `-o` is repeatable, and the extension picks the format: `.json` is the document, `.html` is the standalone viewer.
  - `--raw`, `--descriptions`, `--strict`, `check`, `view`.
  - Verify: run the fixture build with both `-o` types; run `bun run src/cli.ts view <file> --no-open` and curl `/` and the file route.
- **Viewer** (from task 04 on):
  - boot order: embedded data, then `?src`, then `#map`, then home;
  - recent files: the newest 20 are kept, they survive a reload, and storage falls back to memory;
  - drag-and-drop and the file picker;
  - diagrams with zoom, pan and hover;
  - the step navigator;
  - highlighted code;
  - light and dark themes.
  - Verify: Playwright against a locally served build. It refuses `file://` URLs, so serve with `Bun.serve` from inside the repo.

### Architectural constraints
- **Pure modules:** `src/pagedata.ts`, `src/model.ts` (once it exists) and everything bundled into the viewer import no `node:*`, `fs` or Bun APIs.
  - Verify: `grep -n "from \"node:\|from 'node:\|require(" src/pagedata.ts src/model.ts src/viewer -r`, excluding `src/viewer/build.ts`, which runs in Bun.
- **One self-contained HTML file.** The viewer builds to a single file. The only network loads are Mermaid (jsdelivr, 10.9.1) and highlight.js (cdnjs, 11.9.0).
  - Verify: inspect `dist/index.html` after `bun run build:viewer`.
- **Bun only.** There is no `package-lock.json`, `yarn.lock` or npx usage, and dependencies are added with `bun add`.
  - Verify: `git diff --stat` on the branch.
- **Ownership.** Each wave-1 task edits only the files its spec lists under "Files you own".
  - Verify: `git diff --name-only main...orch/NN-slug`.

### Out of bounds
These must not change in any task unless its spec says so:
- `generated/`
- `src/check.ts`
- `src/analyze.ts`
- `docs/agents/writing.md`
- `docs/agents/finding-the-system.md`
- `bunfig.toml`
- `test/fixture/`
- anything outside the repo, including `~/.claude/skills/code-map/SKILL.md`

## Tasks

Each spec is a file; pass its full contents verbatim.

| # | Task | Spec file | Wave | Depends on |
|---|------|-----------|------|------------|
| 01 | Determinism review | `tasks/01-determinism-review.md` | 1 | — |
| 02 | Model service for the (map, walk) helpers | `tasks/02-model-service.md` | 1 | — |
| 03 | Complete, code-defined JSON with step levels | `tasks/03-deterministic-complete-data.md` | 1 | — |
| 04 | React viewer with levels filter | `tasks/04-react-viewer.md` | 1 | — (codes against 03's contract, with a fallback) |
| 05 | Integrate and verify end to end | `tasks/05-integrate.md` | 2 | 01, 02, 03, 04 PASS |

**Wave 1 dispatch:**
- Send the four workers in one message, each with `isolation` handled by you through the pre-made worktree.
- Put the absolute worktree path in each brief as the only directory it may touch. Tell each worker to commit its work on its branch when done.

**Wave 2 dispatch:** after the four PASS verdicts, merge the branches yourself, in the order 01, 02, 03, 04, into a new branch:

```
git checkout -b orch/integration main
git merge --no-ff orch/01-…
```

- Stop at the first conflict and hand the conflicted tree to the task 05 worker. Don't resolve conflicts yourself.
- The worker finishes the merges and does the rest of task 05.

## Verdict criteria

A task is **PASS** only when all of these are true:

1. Every acceptance criterion in its spec is met. You confirmed each one against the branch diff or a command you ran in that worktree, not against the worker's report.
2. `bun run typecheck` and `bun run test` pass in that worktree, and you saw the output.
   - For 04 and 05: `bun run build:viewer` also passes, and the Playwright checks in the spec were run. Open a screenshot or snapshot yourself, or send an independent verification subagent.
3. No invariant above is broken.
4. Nothing outside the spec's "Files you own" changed, except what it plainly implies, such as `bun.lock` with a dependency.
5. Nothing is left as a placeholder: no stubbed functions, skipped tests, commented-out assertions, or TODOs standing in for required behaviour.

Anything else is **FAIL**. "Mostly done" is FAIL.

If a verdict is genuinely uncertain, especially for the UI parity in 04, send a separate verification subagent. Give it the spec and the branch, but not the worker's conclusions.

## Retry policy

Each task gets up to **3** attempts.
- **Each retry** goes to a fresh worker in a fresh worktree from `main`, with the verbatim spec plus your specific findings from the failed attempt. Append this to the brief: "The specification above is unchanged and still authoritative. Address the findings without narrowing the spec to only those findings."
- **When the budget is spent:** stop that task and report to the user with your findings. The other wave-1 tasks can still finish, but don't start wave 2.

## Reporting

After every verdict, append to the ledger:

```
## Task NN — <title>
Attempt: n/3  Verdict: PASS | FAIL
Branch / worktree: orch/NN-slug  ../code-map-wt/NN-slug
Worker changed: <files>
Evidence: <commands run + what the diff showed>
Invariants: <checked / any broken>
Findings: <for FAIL — specific, actionable>
```

When every task is PASS, report to the user with:
- the tasks completed, and the branches (leave `orch/integration` unmerged into `main` until the user says to merge);
- the files changed overall;
- the verification commands and their results;
- the invariants you confirmed;
- the `SKILL.md` lines task 03 flagged;
- anything you flagged but did not act on.

Leave the worktrees in place until the user says to clean them up.
