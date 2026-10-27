# code-map

Generates a **code-map** for a TypeScript/JavaScript codebase: a JSON document that describes how one path through the code runs. It is built for agents first:

- **Agents** read the document's `system` section: a plain-language sitemap of the code (summary, areas, every step with its file, lines, description, calls and data, and the links between services). CI can rebuild it to keep system docs current.
- **People** open the same file in the **viewer**, which draws it as one page.

Make maps with the CLI or the MCP server (`code-map-mcp`); both write the same file. Open them in the hosted viewer (file upload, with recent files kept in your browser), locally with `code-map view`, or as a standalone `.html`.

The viewer shows

0. **What you're looking at.** What the code does overall and where it sits in the system, from the repo's README and package description. Then the *areas* the path runs through, in order (e.g. `deploy → gcs → client`). Each area quotes what the repo's own docs say about it and names the source. The hand-offs between areas are listed under that.
1. **A system diagram.** The *Call path* tab shows every function and method on an execution path, numbered by step and grouped into boxes per file. Data types (interfaces, type aliases, enums, classes) appear as cylinders. Solid arrows are calls. Dotted arrows show data a step takes (`param`), `returns`, `creates` or `uses`. The *Files* tab shows how the files on the path import each other.
2. **A walkthrough.** The path the code takes when it runs: a depth-first walk of the call graph from the entry point, in source order. Each step puts a plain-language description beside the code for that step. The call lines that lead to the next steps are highlighted and linked, and long functions are cut down to the signature plus the lines around those calls.
3. **Tabs beside each step.** *Code* is the excerpt above. *Data* has one sub-tab per type the step takes, returns, creates or uses, showing its definition. *Calls* has one sub-tab per function it calls, showing a preview with a link to its step. *Full source* appears when the excerpt is cut. Clicking a data chip or a call name in the description opens the matching tab.
4. **A data section.** Every data type the path touches, as a list on the left and the definition on the right, with links back to the steps that use it.

Diagram controls: zoom with the − / + / Fit / Entry buttons, Ctrl/⌘ + scroll, a trackpad pinch or the `+` `-` `0` keys. Drag to move around; ⤢ goes full screen, where a plain scroll pans. Hover a box to highlight what it calls (blue) and what calls it (orange), with everything else faded. Hover an arrow to highlight both of its ends. Click a box or arrow to jump to its step. As you scroll the walkthrough, the current step's box is highlighted.

The call path has three more controls:
- **Compact** hides the data types and their dotted arrows, leaving only the functions and the calls between them.
- **Full path** highlights the route the walkthrough takes: each step's box and the arrow that leads into it, from step 1 to the last. Everything else fades. It works in both modes.
- **◀ / ▶** (or the ← / → keys) step through the functions and methods in walkthrough order. Each move highlights the arrow into the new step, keeps the arrows walked so far highlighted, and glides the view along that arrow until the box is centred. Click the step's name to read it in the walkthrough; × or Esc stops. While stepping, a panel beside the diagram shows the step's description, signature and calls, the same text as in the walkthrough; its "step N" links move the navigator there. **Details** or the panel's × hides it, and the page remembers that choice. The view centres each box in the space the panel leaves free.

Each snippet is stored in the page once and copied into a tab the first time it opens, so a type shown in ten steps doesn't make the page ten times bigger.

## Where the descriptions come from

**Areas and system context** (`src/context.ts`). An area is the nearest folder above a file that has its own `README.md`, `ARCHITECTURE.md` or `package.json`. Without one, it's the first folder below `src/`, `packages/`, `modules/` and similar. Each area's text comes from the first of these that exists:
1. The intro of its own `ARCHITECTURE.md` or `README.md` (text before the first `##`, or under an Overview/Purpose heading).
2. The row, bullet or paragraph in the repo's `README.md`, `ARCHITECTURE.md` or `docs/` that names it, such as a module map table.
3. Its `package.json` description.
4. The doc comment on a class in it.
5. A file's header comment.
6. The first paragraph of its own docs, with the section named.

A repo is described by its README's opening paragraph, falling back to its `package.json` description.

**Steps and summary**:
By default the text is put together from what the analysis found, with no network calls (`describeStep` in `src/describe.ts`). It covers the first sentence of the doc comment (or the function name split into words), how the step is reached, the data it takes, returns, creates or uses, what it calls in order, and the outside code it calls. With `--llm`, the code for every step goes to Claude in one request, together with the repo and area docs above. Claude writes the summary, the "where it sits" paragraph, one sentence per area, and a 2–4 sentence description per step.

## Usage

```sh
bun install
bun run src/cli.ts <dir> [<dir> ...] [options]     # writes code-map.json
bun run src/cli.ts view code-map.json              # opens it in the viewer on localhost
```

```sh
# Find likely entry points (functions nothing calls that reach the most code)
bun run src/cli.ts ../game-manager -i src --list-entries

# Map one flow
bun run src/cli.ts ../game-manager -i src -e PromoteGameHandler.execute -o promote.json

# The same, plus a standalone page that opens anywhere
bun run src/cli.ts ../game-manager -i src -e PromoteGameHandler.execute -o promote.json -o promote.html

# Start from a file's top-level code
bun run src/cli.ts ./my-app -e src/server.ts

# Several repos as one system: calls into another repo's package link to its source
bun run src/cli.ts ../wolf-editor ../game-sdk -i src -i packages/editor-kit/src -e gameCommandKind

# Only an exact set of methods (file, inline list, or both)
bun run src/cli.ts ../wolf-editor ../game-sdk -s flow.txt -s "editor-kit/src/args.ts#*"

# Have Claude write the descriptions (sends the code on the path to the Anthropic API)
ANTHROPIC_API_KEY=... bun run src/cli.ts ./my-app -e handleRequest --llm
```

| Option | |
|---|---|
| `-e, --entry` | `file#name`, `Class.method`, a bare name, or a file path. When omitted, the tool uses the uncalled function that reaches the most code. |
| `-s, --select` | Map only these symbols (repeatable). Takes a file or an inline comma-separated list; see below. |
| `-o, --out` | Where to write the map (repeatable). `.json` writes the code-map document (default `code-map.json`); `.html` writes the viewer with the map built in |
| `--raw` | Also write the raw analysis (every symbol, call and import) and walkthrough as JSON; the viewer opens this too |
| `--strict` | With `--descriptions`: exit 1 on any warning, e.g. a step with no written description (for CI) |
| `-i, --include` | Analyze only this sub-path (repeatable) |
| `--tests` | Include `*.test.*` / `*.spec.*` files |
| `--max-depth`, `--max-steps` | Limits for the walk (defaults: 8 and 60) |
| `--max-hops` | With `--select`: the most unselected functions to look through between two selected ones (default 6) |
| `--list <spec>` | Print what a spec or glob matches, with caller and callee counts, then exit |
| `--template <file>` | Also write a fill-in JSON with every step and area: facts, the generated draft, and an empty `description` |
| `--descriptions <file>` | Use a filled-in template's `title`, `summary`, `role`, `overview`, area and step descriptions, and `links` in place of generated text |
| `--llm`, `--model` | Descriptions written by Claude (default model `claude-opus-5-5`) |

## Several repos

Pass more than one directory and they are analyzed as one system. Files are shown under each repo's folder name (`wolf-editor/src/...`), and the diagrams group them inside a box per repo. `-i` paths apply to every repo that has them.

The TypeScript compiler resolves a call into another repo's package (e.g. `@wolfgames/editor-kit`) to that package's built `.d.ts`, not its source. code-map reads every `package.json` in the analyzed repos, workspace packages included. When a call lands in one of those packages' type files, it is linked to the source function or method of the same name in that package. These links are drawn as thick arrows and tagged "by name" in the walkthrough.

## Selecting an exact set of methods

`--select` limits the map to the symbols you list. Only those become steps. A call that passes through functions you did not select becomes one arrow labelled `via a → b`, and the highlight stays on the line in the selected function where the chain starts. Selected functions that no other selected one leads to start their own part of the walkthrough, so every selected function appears. Selected data types (interfaces, types, enums) appear in the diagram and the Data section. `--entry` still works with a selection: if the entry is not selected, the first selected functions it reaches become the starting points.

A selection file has one spec per line; lines starting with `#` or `//` are comments. It can also be a JSON array of specs.

```
# Checkout flow, without pricing internals
src/server.ts#handlePost
OrderService.*
OrderRepo.save
src/types.ts#Order
editor-kit/src/args.ts#*
src/api/payments.ts
```

| Spec | Selects |
|---|---|
| `src/server.ts#handlePost` | One symbol; the path can be partial (`server.ts#handlePost`) and can start with the repo name |
| `OrderRepo.save`, `handlePost` | One symbol by name; ambiguous names are an error that lists the candidates |
| `OrderService.*`, `src/api/*.ts#handle*` | Every match of the glob (`*` stays inside one path segment, `**` crosses them) |
| `src/api/payments.ts` | Everything in that file |

## Writing the descriptions yourself (or with an agent)

```sh
bun run src/cli.ts ../game-manager -i src -e PromoteGameHandler.execute --template promote.desc.json
# fill in the empty "description" fields (and title, summary, role, overview) in promote.desc.json
bun run src/cli.ts check promote.desc.json      # plain-English check: long sentences, jargon, copied docs
bun run src/cli.ts ../game-manager -i src -e PromoteGameHandler.execute -o promote.json --descriptions promote.desc.json
```

Steps are matched by function id, so the file still applies after the code changes, as long as those functions still exist. `links` adds connections the analysis can't see, such as an HTTP request between two services or a file one writes and another reads: `{"from": 3, "to": 12, "label": "uploads bundle → CDN"}`. They are drawn as dashed arrows and listed under "Connections outside the code". Any step, area or link that doesn't match prints a warning.

The MCP server runs the same loop for any agent (see below). The `code-map` Claude Code skill (`~/.claude/skills/code-map`) runs this whole loop. It picks the code (from paths, or from a system name like "dynamic data across game-manager and game-sdk"), reads it, and writes the descriptions in plain English.

## The code-map document

```jsonc
{
  "format": "code-map", "version": 1, "generatedAt": "…",
  "generator": { "args": ["../game-manager", "-i", "src", "-e", "…"] },   // the CLI command that rebuilds it
  "system": {          // for agents: read this, stop before "render"
    "title", "summary", "role", "overview", "entry", "repos",
    "areas":  [{ "id", "name", "description", "doc", "docSource", "steps": [1, 2] }],
    "steps":  [{ "step", "id", "name", "kind", "file": "src/x.ts:12-40", "area", "signature",
                 "description", "calledBy", "calls": [{ "id", "name", "step" }], "data": [{ "id", "name", "relation" }],
                 "outsideCalls", "docComment" }],
    "data", "links", "handoffs", "truncated"
  },
  "render": { … }     // for the viewer: the walkthrough, the source of every symbol shown, diagram sources
}
```

## Viewer

One page (`src/viewer/`) draws any code-map document:

- **Hosted:** `bun run build:viewer` writes `dist/index.html`, a single static file to put on any static host. People drop or pick a `.json` file; it's read in the browser, never uploaded. The last 20 files are kept in the browser's IndexedDB and listed on the start page (`#map=<id>` links reopen one).
- **Local:** `code-map view [map.json] [--port 4173]` serves the viewer on localhost and opens the file. Reload to see a rebuilt map.
- **Standalone:** `-o map.html` writes the viewer with the map built in.

## MCP server

`code-map-mcp` (`bun run src/mcp.ts`) speaks MCP over stdio. Add it to Claude Code with:

```sh
claude mcp add code-map -- bun run /path/to/code-map/src/mcp.ts
```

Its instructions tell the agent the workflow: pick the code, trace, read every step's code, write the descriptions in plain English, check, build. Tools are stateless and take the same options as the CLI (`dirs`, `include`, `entry`, `select`, `maxDepth`, …) each call:

| Tool | |
|---|---|
| `guide` | The workflow, the writing rules, and how to find the code for a named system (`docs/agents/`; also served as `code-map://guide/<name>` resources) |
| `list_entries`, `list_symbols` | Ranked entry points; what specs and globs match |
| `trace` | Runs the walk and writes the fill-in template (or returns it inline); reports the step count |
| `check_descriptions` | The plain-English checker |
| `build` | Writes `.json` / `.html`; returns warnings and the map's outline. `generator.args` in the file is the equivalent CLI command |
| `read_map` | The `system` section of an existing map, for agents learning a system |

## Documenting systems in CI

Commit a selection file and a filled-in descriptions file next to the code, then rebuild the map on each change:

```sh
bun run src/cli.ts . -i src -s docs/maps/orders.selection.txt \
  --descriptions docs/maps/orders.desc.json -o docs/maps/orders.json --strict
```

`--strict` fails the build when a described function no longer exists or a new step has no description, so the map can't silently go stale. Agents read `docs/maps/*.json` (or call `read_map`) to learn the system; people open the same files in the viewer.

## How it works

| File | Role |
|---|---|
| `src/analyze.ts` | Builds a TypeScript program with the compiler API and indexes functions, arrow-function consts, class methods/constructors/accessors, object-literal methods and data types. It resolves every call through the type checker, following imports, `this.`, `new` and re-exports, and records the data types each symbol takes, returns, creates or uses. Calls that resolve outside the analyzed sources are kept as "outside code". |
| `src/trace.ts` | Resolves the entry and the `--select` specs, ranks candidate entries, and walks the call graph depth-first in source order. A function reached a second time links back to its first step instead of being repeated. With a selection, it walks through unselected functions to find the next selected one. |
| `src/context.ts` | Groups the steps into areas, finds each area's docs, and lists the hand-offs between areas. |
| `src/describe.ts` | Heuristic descriptions built from doc comments, the caller, data relations, calls in order and outside calls, so no network is needed. `--llm` replaces them with Claude's narration of the whole path. |
| `src/pagedata.ts` | Builds the code-map document: the `system` sitemap for agents, plus the render data (Mermaid diagram sources, the route, the symbols shown). |
| `src/pipeline.ts` | The shared steps from folders to document and output files, used by the CLI and the MCP server. |
| `src/page.ts` | Turns a document into the page's HTML. Pure, so it runs in the browser. |
| `src/viewer/` | The viewer app (upload, recent files in IndexedDB, `?src=` loading), the page's behavior (zoom, hover, step navigator) and CSS, and `build.ts`, which bundles it into one HTML file. |
| `src/mcp.ts`, `src/check.ts`, `src/serve.ts` | The MCP server, the plain-English checker, and `code-map view`. |

## Limits

- tsconfig `paths` aliases (e.g. `@contract/...`) aren't read, so calls through them show as outside code.
- Linking by name picks the exported symbol with that name inside the package. If a package has two exported symbols with the same name, the link can land on the wrong one.
- Calls are resolved statically. Calls through interfaces, dependency injection tokens, event buses or dynamic dispatch stop at the declaration the type checker finds. Those show up as outside code or as the interface method, not as the implementation.
- Calls inside callbacks and nested functions are counted as calls made by the enclosing named function.
- Only the first visit to a function becomes a step. Later visits link back to it.
