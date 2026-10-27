# 01 — Determinism review of how a code map is generated

Wave 1 (runs in parallel with 02, 03, 04). Depends on: nothing.

## Goal

Write a review that answers: **is a code-map document fully determined by the code, or do agents shape it?** Name every input that changes the output, and say for each whether it comes from the code, from an agent or person, or from the clock. Tasks 03 and 04 are changing the behaviour this review describes at the same time. Review the code **as it is on the baseline commit**, and end with a short "Target" section that states the intended end state, listed below.

## Where to look

- `src/analyze.ts`: TypeScript compiler-API analysis that produces the symbols, calls, data and imports. Note the sorting and any order that comes from the file system.
- `src/trace.ts`:
  - `entryCandidates`: the default entry is the uncalled function that reaches the most code; ties break on id.
  - `tracePath`: a depth-first walk in source order with `maxDepth` (default 8), `maxSteps` (default 60) and `maxHops` (default 6).
  - When the walk stops at either limit it sets `truncated`. It does not record which steps are missing.
  - A step reached from several places keeps only the first caller as its `parent`.
- `src/describe.ts`, `src/context.ts`: the generated draft text, and doc excerpts from README/ARCHITECTURE files on disk.
- `src/authored.ts`:
  - `buildTemplate` writes the fill-in file.
  - `applyDescriptions` merges the agent's prose into the walk, matching by symbol id or step number.
  - `links` are authored by agents. Static analysis does not find them.
- `src/pagedata.ts`, `buildDocument`: `generatedAt: new Date()` changes on every build, and `generator.args` is recorded.
- `src/pipeline.ts`, `src/cli.ts`, `src/mcp.ts`: the defaults for the limits, and the `trace` tool's "aim for 8–40 steps" advice, which tells agents to tune the limits until the step count looks right.
- `docs/agents/workflow.md`: the same advice in the agent guide.

## Deliverable

Create `docs/DETERMINISM.md` with these sections:

1. **Summary**: 3–5 sentences.
2. **Inputs that shape the document**: a table with columns input, set by (code / agent / person / clock / file system), affects (structure / prose / metadata), and file:line.
3. **Deterministic today**: what is guaranteed, and how you confirmed it.
   - Run `bun run src/cli.ts test/fixture -e handlePost -o <tmp>/a.json` twice and diff the two outputs. Report what differs.
4. **Not deterministic or not complete today**: each finding with file:line and its effect on an agent reading the JSON. Include at least:
   - truncation by `maxSteps` and `maxDepth`;
   - agent tuning of those limits;
   - `generatedAt`;
   - the single parent per step;
   - doc excerpts that depend on files outside the analyzed sources;
   - authored links.
5. **Where agents touch the output**: agents never edit the structure. They choose the scope, and their prose and links enter only through the descriptions file. Confirm or correct this from the code.
6. **Target**: the end state the user chose:
   - **Structure:** decided only by the code and the scope (`dirs`, `include`, `tests`, `entry`, `select`).
   - **No silent truncation:** one hard safety cap that fails with advice to narrow the scope.
   - **No wall-clock time** in the document.
   - **Prose:** a separate authored layer, matched by symbol id.
   - **Step metrics:** each step records `descendants`, the count of all steps beneath it, so the viewer can show "levels" and hide helpers. The JSON stays complete.

## Acceptance criteria

- `docs/DETERMINISM.md` exists and has all 6 sections.
- Every finding cites a file and line that exists on the baseline commit.
- Section 3 reports a real double-build diff that you ran, not a guessed one.
- No source, test or config file is changed. This task only adds the doc.

## Out of scope

Changing any code. Tasks 03 and 04 do that.
