# Determinism review: what decides a code-map document

This review answers one question: **is a code-map document fully determined by the code, or do agents shape it?** It describes the code on baseline commit `5a6dd61`. All `file:line` references point at that commit. Tasks 03 and 04 change some of this behaviour; the last section states the intended end state.

## 1. Summary

For a fixed scope, the structure is a pure function of the source files. Two builds of the fixture differ only in `generatedAt`. But the scope is not the only input that agents set. The walk limits (`maxDepth`, `maxSteps`) cut the path short without saying what is missing, and the agent guide tells agents to tune those limits until the step count "looks right". So the shape of the walk is partly an agent's choice. Three more inputs come from outside the analyzed sources: the wall clock (`generatedAt`); the absolute checkout path (`render.roots[].dir`); and README, ARCHITECTURE and `package.json` files on disk, which decide area boundaries and hand-offs as well as the quoted docs. Agent prose enters through the descriptions file, and also through two side doors: `--llm` and `--title`.

## 2. Inputs that shape the document

"Structure" means steps, calls, data, areas, hand-offs and diagrams. "Prose" means titles, summaries and descriptions. "Metadata" means fields that do not describe the code.

| Input | Set by | Affects | Where |
|---|---|---|---|
| Source files: symbols, calls, data and imports, from the TypeScript compiler API | code | structure | `src/analyze.ts:75-441` |
| Source file list: sorted per root, in `dirs` order and then `include` order | code + scope | structure (file order, `filesAnalyzed`) | `src/analyze.ts:42`, `src/analyze.ts:78-83` |
| Duplicate-id suffix `~2`, `~3` …, by declaration order | code | structure (symbol ids) | `src/analyze.ts:166` |
| Cross-package call linking: first exported symbol with the same name | code (heuristic) | structure (`inferred` calls) | `src/analyze.ts:303-315` |
| `package.json` names found by walking the roots in `readdirSync` order (the first name found wins) | file system | structure (which package a call links to, only when two packages share a name) | `src/analyze.ts:52`, `src/analyze.ts:57` |
| Package name of a `.d.ts`, read by walking up parent folders, including folders above the analyzed root | file system | structure (`inferred` calls) | `src/analyze.ts:269-285` |
| `dirs` | agent / person | structure; repo labels come from folder names | `src/pipeline.ts:26-28`, `src/analyze.ts:66-73` |
| `include`, `tests` | agent / person | structure | `src/analyze.ts:78-83`, `src/pipeline.ts:27` |
| `entry` (or the default: the uncalled function that reaches the most code; ties break on id) | agent / person (default: code) | structure | `src/pipeline.ts:51-58`, `src/trace.ts:99-114` |
| `select`: the set of specs **and their order** | agent / person | structure (which steps exist, and their numbers) | `src/trace.ts:52-80`, `src/trace.ts:204-208` |
| `maxHops` (default 6) | agent / person | structure (`via` chains) | `src/trace.ts:124`, `src/trace.ts:140` |
| `maxDepth` (default 8) | agent / person | structure (silent cut-off) | `src/trace.ts:122`, `src/trace.ts:183-187`, `src/pipeline.ts:59` |
| `maxSteps` (default 60) | agent / person | structure (silent cut-off) | `src/trace.ts:123`, `src/trace.ts:158-161`, `src/pipeline.ts:59` |
| Absolute path of each root, after `realpath` | file system (checkout location) | metadata (`render.roots[].dir`) | `src/analyze.ts:76`, `src/pagedata.ts:152` |
| Folder name of a root | file system | prose (`repos[].name`/`label` when there is no `package.json`) | `src/context.ts:133-134` |
| `README.md`, `ARCHITECTURE.md`, `docs/*.md`, `package.json` beside the code | file system (repo docs) | **structure** (area boundaries, `handoffs`) and prose (area `doc`, `role`, repo description) | `src/context.ts:121-137`, `src/context.ts:140-150`, `src/context.ts:186-216` |
| Generated draft text: doc comments, names, calls, data | code | prose | `src/describe.ts:28-82`, `src/describe.ts:84-131` |
| Descriptions file: `title`, `summary`, `role`, `overview`, `areas[]`, `steps[]` | agent / person | prose | `src/authored.ts:52-103` |
| Descriptions file: `links[]` | agent / person | adds edges to `system.links`, the diagram and `route` | `src/authored.ts:88-97`, `src/pagedata.ts:123`, `src/pagedata.ts:312-315`, `src/pagedata.ts:343-345` |
| `--llm` (and `--model`): the model rewrites summary, role, overview, areas and steps | agent / person (output from the model) | prose | `src/cli.ts:126-131`, `src/describe.ts:139-232` |
| `--title` / MCP `title` | agent / person | prose (`system.title`) | `src/cli.ts:133`, `src/mcp.ts:163` |
| `generatedAt` | clock | metadata | `src/pagedata.ts:148` |
| `generator.args`: the CLI's own `argv` (relative paths and output paths as typed), or args rebuilt by the MCP server (absolute paths) | agent / person | metadata | `src/cli.ts:147`, `src/mcp.ts:53-66`, `src/mcp.ts:171`, `src/pagedata.ts:149` |

## 3. Deterministic today

**What is guaranteed.** With the same source files, the same scope and the same limits, the `system` and `render` sections are byte-identical between runs. The reasons:

- Source files are sorted before analysis (`src/analyze.ts:42`). Nothing depends on `readdirSync` order, except the rare case of two packages with the same name (`src/analyze.ts:52`, `src/analyze.ts:57`).
- Calls out of each symbol are sorted by line and then by position in the file before the walk (`src/trace.ts:132`). The walk visits them in that order.
- The default entry is ranked by reach, and ties break on id (`src/trace.ts:112`).
- The draft text (`src/describe.ts:28-131`) and the diagrams (`src/pagedata.ts:264-383`) are pure functions of the map and the walk. They use no randomness, no time and no hash-ordered collections. (`Map` and `Set` keep insertion order.)
- The analysis makes no network calls. The only network call is `--llm` (`src/describe.ts:195`).

**How I confirmed it.** I built the fixture twice to the same output path and compared the two files:

```sh
T=$(mktemp -d /tmp/cm01run.XXXX)
bun run src/cli.ts test/fixture -e handlePost -o $T/a.json; cp $T/a.json $T/run1.json
bun run src/cli.ts test/fixture -e handlePost -o $T/a.json; cp $T/a.json $T/run2.json
diff $T/run1.json $T/run2.json
```

Output (both runs: `Analyzed 5 files, 14 symbols, 8 calls`, `Wrote …/a.json (6 steps)`):

```
4c4
<   "generatedAt": "2026-10-27T06:31:03.967Z",
---
>   "generatedAt": "2026-10-27T06:31:04.360Z",
```

The only difference is `generatedAt`. With that field removed (`jq 'del(.generatedAt)'`), the two 24,079-byte files are identical. With the field kept, the SHA-1 hashes differ (`84c4e54f…` and `a305e38a…`), so a CI job that compares files would report a change on every rebuild.

Further checks, all on scratch copies under `/tmp` (the repo was not changed):

- **Moved checkout.** I copied `test/fixture` to `/tmp/cm01run.Ispv/copy/fixture` and built it. Besides `generatedAt`, two fields changed: `generator.args[0]` (`test/fixture` became the absolute path) and `render.roots[0].dir` (the absolute path of the worktree became `/private/tmp/cm01run.Ispv/copy/fixture`). So the same code at a different path gives a different file.
- **A README on disk.** I added a `README.md` to the copy and built again. `system.role`, `system.repos[0].description` and their `render` copies changed. No source file changed.
- **README files and area boundaries.** In a scratch project, `src/api/handle.ts` calls `src/api/orders/save.ts`. Without docs it has one area, `src/api` (steps 1-2), and no hand-offs. After I added `src/api/orders/README.md`, it has two areas (`src/api` step 1, `src/api/orders` step 2) and a new hand-off between them. A docs file changed the structure.
- **Selection order.** `-s "lineTotal,validate"` numbers the steps `1 lineTotal, 2 validate`. `-s "validate,lineTotal"` numbers them `1 validate, 2 lineTotal`. The two scopes are the same set but give different step numbers.

No existing test asserts that two builds are identical. `test/analyze.test.ts:78` and `test/analyze.test.ts:84` only check the `truncated` flag.

## 4. Not deterministic or not complete today

### 4.1 Truncation by `maxSteps` and `maxDepth` is silent about what is missing

- `src/trace.ts:158-161`: once the walk has `maxSteps` steps, every later visit returns `undefined` and sets `truncated = true`.
- `src/trace.ts:183-187`: a call one level deeper than `maxDepth` is not visited and sets `truncated`.
- In both cases the call stays in `calls`, but it has no `step` (`src/types.ts:64`). Nothing records what lies beneath it.
- The document keeps a single boolean (`src/types.ts:114`, `src/pagedata.ts:125`). The overview adds one sentence that says to raise the limits (`src/describe.ts:97`).

Example: `--max-steps 3` gives steps 1-3. Step 2 (`OrderService.place`) lists `orderTotal` and `OrderRepo.save` with no step, and `lineTotal` does not appear anywhere. `--max-depth 1` gives 2 steps, and `validate`, `orderTotal` and `OrderRepo.save` have no step.

**Effect on an agent reading the JSON:** it cannot tell how much code is missing, or where. A call without a `step` could be a short leaf or a large subsystem. `truncated: true` only says that something is missing.

The depth cut-off also depends on visit order. A symbol keeps the depth of its first visit (`src/trace.ts:157`). If the walk reaches it first through a long chain, its callees can be cut off even when a shorter chain to them exists. In a scratch project, `start` calls `viaHelper → helper → shared → leaf` and also calls `shared` directly. With `--max-depth 3`, `shared` gets depth 3 (through `helper`) and `leaf` is cut off. Through the direct call, `leaf` would be at depth 2.

### 4.2 Agents tune the limits until the size looks right

- The `trace` tool asks for "8–40 steps" (`src/mcp.ts:107`). It also returns advice: "Too wide: trim the selection or lower maxDepth." or "Narrow: widen the selection or raise maxDepth." (`src/mcp.ts:131`).
- The MCP instructions say the same (`src/mcp.ts:22`), and so does the agent guide (`docs/agents/workflow.md:22-26`).
- The limits are tool inputs (`src/mcp.ts:32-34`, `src/cli.ts:39-40`, `src/cli.ts:77-78`).

**Effect:** two agents mapping the same code with the same entry can produce different walks, because each one stops at a different depth. The step count is a target the agent aims for, not a fact about the code. `generator.args` records the limits that were chosen (`src/mcp.ts:59-61`), but nothing in the document says that the walk was cut to fit a size.

### 4.3 `generatedAt` is the wall clock

- `src/pagedata.ts:148` sets `generatedAt: new Date().toISOString()` on every build.
- Opening a raw `{map, walkthrough}` dump in the viewer calls `buildDocument` again, so it gets a new time when the dump is viewed (`src/pagedata.ts:169`).

**Effect:** no two builds are byte-identical, so a CI job that compares files reports a change on every rebuild (see section 3). The field says nothing about the code. It is not tied to a commit, so it does not say which version of the code was mapped.

### 4.4 Each step keeps one parent

- `src/trace.ts:157`: when the walk reaches a symbol a second time, it reuses the existing step. Only the first caller becomes the step's `parent` (`src/trace.ts:188`, `src/types.ts:74`).
- `calledBy` (`src/pagedata.ts:88`), the hand-offs between areas (`src/context.ts:180-182`), the route in the viewer (`src/pagedata.ts:345`) and the draft text (`src/describe.ts:42-50`) all use only that parent.
- Later callers still list the step in their `calls[].step`. In the scratch project, `shared` is called by step 1 and step 3, but `calledBy` says only "step 3 (helper)".

**Effect:** an agent that reads `calledBy` or `handoffs` misses every caller after the first. To find them all, it has to scan every step's `calls`. Which caller comes first depends on source order and on which branch the walk visits first.

### 4.5 Doc excerpts depend on files outside the analyzed sources

- `src/context.ts:121-137` reads `package.json`, `README.md`, `ARCHITECTURE.md`, `docs/ARCHITECTURE.md` and `docs/README.md` from each root.
- `src/context.ts:140-150` decides each area's folder from whether a `README.md`, `ARCHITECTURE.md` or `package.json` exists (`src/context.ts:144`).
- `src/context.ts:186-216` picks each area's quoted doc with a scoring rule over those markdown lines.
- `src/describe.ts:104-121` puts this text into the draft `summary` and `role`.
- `src/analyze.ts:269-285` reads `package.json` files above the analyzed root to link calls between packages.
- These files are not source files, and `include` does not limit them. `include` only filters source files (`src/analyze.ts:78-83`); the docs are always read from the root folder.

**Effect:** editing a README can move area boundaries and add or remove hand-offs, which is structure, and can change the quoted text (see section 3). The docs may also be stale. An agent cannot tell from the JSON whether an area's boundary came from the code layout or from a docs file being present. `docSource` names the file only for the quote.

### 4.6 Authored links

- `links` come only from the descriptions file (`src/authored.ts:15`, `src/authored.ts:88-97`). Static analysis does not find them.
- The template gives links as step numbers (`src/authored.ts:43`), and the guide says to use step numbers (`docs/agents/workflow.md:46`). `applyDescriptions` accepts numbers or symbol ids (`src/authored.ts:54-59`). The walk stores links by step index (`src/types.ts:119`).
- A link given by step number points at whatever step has that number after the next trace. If the scope or the code changes the numbering, the link silently joins the wrong steps. It only produces a warning when the number is out of range (`src/authored.ts:92-95`).
- The same applies to `steps[]` entries that have only a `step` number (`src/authored.ts:13`). The template writes both `id` and `step`, and `id` wins (`src/authored.ts:65`), so template entries are safe.

**Effect:** links are the agent's claims, not facts from the code. They sit in `system.links` beside facts from the code, and nothing marks them as authored. They feed the diagram (`src/pagedata.ts:312-315`) and the viewer's route (`src/pagedata.ts:343-345`). A link given by number can drift to the wrong steps after a re-trace without a warning.

### 4.7 Smaller findings

- **Absolute checkout path.** `render.roots[].dir` is the absolute, `realpath`'d folder (`src/analyze.ts:76`, `src/pagedata.ts:152`). The same code checked out in two places gives two different documents (see section 3).
- **`generator.args` is not normalized.** The CLI stores `argv` as typed, with relative paths and output paths (`src/cli.ts:147`). The MCP server stores absolute paths (`src/mcp.ts:53-66`). The same map built two ways records different args.
- **Selection order changes step numbers.** Selected symbols that the walk does not reach are visited in spec order (`src/trace.ts:204-208`). Within a glob, they follow symbol insertion order (`src/trace.ts:62-69`).
- **Cross-package linking is a name match.** `linkByPackage` picks the first exported symbol with that name in the package (`src/analyze.ts:312`). The result is deterministic, but it is a guess. It is flagged `inferred` (`src/analyze.ts:386`), and the draft text says so (`src/describe.ts:70-71`).

## 5. Where agents touch the output

The claim to check: *agents never edit the structure. They choose the scope, and their prose and links enter only through the descriptions file.*

**Confirmed.**

- There is no API, tool or file that lets an agent add, remove or reorder steps, calls or data directly. `trace` and `build` rebuild the walk from the code every time (`src/mcp.ts:68-72`, `src/pipeline.ts:46-61`).
- `applyDescriptions` copies each step and replaces only `description` (`src/authored.ts:61-72`). For areas it replaces only `description` (`src/authored.ts:84`). It sets `summary`, `role`, `overview` and `title` (`src/authored.ts:82-83`, `src/authored.ts:100-101`).
- The template's fact fields (`file`, `calls`, `data` and the rest) "are ignored when the file is read back" (`src/authored.ts:26`). The code confirms this: `applyDescriptions` reads only the fields named above.
- Unmatched step ids, unmatched areas and bad link ends produce warnings (`src/authored.ts:67`, `src/authored.ts:79`, `src/authored.ts:93`). Steps without a written description are listed (`src/authored.ts:73-74`). `--strict` turns warnings into exit code 1 (`src/cli.ts:155-158`).

**Corrections.**

1. **The scope includes the limits, and agents are told to tune them.** `maxDepth` and `maxSteps` are scope inputs that change the structure, and the tools coach agents to adjust them to hit a step count (section 4.2). So agents choose how much of the structure exists, not only where it starts.
2. **`links` change more than prose.** They come only through the descriptions file, as claimed. But they add edges to `system.links`, to the call-path diagram and to the viewer's route (section 4.6). They are an authored layer drawn into the structure views.
3. **Prose has two side doors.**
   - `--llm` writes summary, role, overview, area and step text from a model response straight into the walk, without a descriptions file (`src/cli.ts:126-131`, `src/describe.ts:139-232`). This text is not reproducible.
   - `--title` (CLI) and `title` (MCP `build`) set the title outside the descriptions file (`src/cli.ts:133`, `src/mcp.ts:163`).
4. **Files that agents or people edit outside the tool** (README, ARCHITECTURE, `package.json`) change area boundaries and hand-offs (section 4.5). This is not an agent editing the JSON. But it is a way for prose files to change the structure.

## 6. Target

The end state the user chose. Tasks 03 and 04 implement it.

- **Structure:** decided only by the code and the scope (`dirs`, `include`, `tests`, `entry`, `select`). The same code and scope give the same steps, calls, data, areas and diagrams.
- **No silent truncation:** `maxDepth` and `maxSteps` stop being knobs for tuning the size. One hard safety cap remains. When a walk would exceed it, the build fails with advice to narrow the scope. It never produces a partial walk.
- **No wall-clock time** in the document. `generatedAt` is removed, so two builds of the same code and scope are byte-identical.
- **Prose:** a separate authored layer (title, summary, role, overview, area and step descriptions, and links), matched by symbol id so that it survives re-tracing. Unmatched entries produce warnings.
- **Step metrics:** each step records `descendants`, the count of all steps beneath it, so the viewer can show "levels" and hide helpers. The JSON stays complete; hiding happens only in the viewer.
