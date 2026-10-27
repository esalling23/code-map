# Making a code map

A code map shows how some code works when it runs: the functions on one path, grouped by file and repo, the data they use, and a walkthrough that explains each step beside its code. It is saved as one JSON file. The `system` part of that file is a plain-language sitemap that other agents read to understand the system without opening the source; the viewer draws the rest for people.

The tools do the analysis. **Your job is what they can't do well:** choosing what to map, and writing the explanations. The tools only copy doc comments and describe structure. You can read the code and the docs, understand them, and explain them so a new person follows on the first read.

The readers are **engineers new to this code**, and many read English as a second language. They know what an API, a database or a queue is. They don't know this codebase, its names or its history. Write short sentences with common words, and explain every project-specific name the first time it appears.

Use absolute paths for every folder and file you pass to the tools. Keep working files (selection, descriptions, outputs) in one folder under the current working directory, for example `<cwd>/code-maps/<short-slug>/`, unless the person names another place.

## 1. Decide what to map

Turn the request into the **repo folders** (`dirs`), the **sub-paths** to analyze (`include`), and either an **entry point** (`entry`) or a **selection** of functions (`select`).

- **Paths or files given:** use them. For one file or one function, an entry point is usually enough.
- **A flow or system named in words:** find the code first. Read the `finding-the-system` guide. `list_entries` ranks likely entry points; `list_symbols` shows what a spec or glob matches.

If you can't find a repo, ask for its path. A map of the wrong code is worse than no map.

## 2. Trace, and check the scope

Call `trace` with a `templatePath`. It writes the fill-in file and reports the step count and the steps with the most steps beneath them.

The map covers **everything reachable in the scope you chose**: the `dirs`, `include`, `tests`, `entry` and `select` you passed (and `maxHops` with a selection). It never drops steps, and two builds of the same code give the same file. If the map covers code you did not mean to map, narrow the scope and trace again:
- `include` to analyze fewer folders;
- `select` to map an exact set of functions;
- `entry` to start later in the flow.

Never remove steps from a map to make it shorter. People hide small helpers with the viewer's level filter. A walk over 2000 steps fails; narrow the scope.

Fix the scope and trace again before you write anything.

The fill-in file lists every step and area with the facts you need (file and lines, caller, calls, data, outside calls, doc comment, quoted docs), the tool's own `draft`, and an empty `description` for you.

## 3. Read before you write

For each step, open the file at the given lines and read the code. The draft and the doc comment are only hints. Read the docs quoted for each area, and the repo's README or ARCHITECTURE.md if the system is new to you. When docs and code disagree, **the code is the truth**; if it matters to a reader, say so plainly.

## 4. Write the descriptions

Read the `writing` guide first. Fill in:

| Field | What to write |
|---|---|
| `title` | A plain name, like "How a game is promoted to production". Not a function name. |
| `summary` | 3–5 sentences: what starts this code, what it does, what has changed when it finishes. At most two code names. |
| `role` | 2–3 sentences: which part of the larger system this is, and why it matters. |
| `overview` | 2–3 sentences on how the work moves between areas or repos. |
| `areas[].description` | 1–2 sentences on what this area does **on this path**. Not a copy of its docs. |
| `steps[].description` | 2–4 sentences: what the step does and why the flow needs it, plus the data it reads, changes or returns. Refer to other steps by number. |
| `links` | Connections the analysis can't see (HTTP between services, queues, files one side writes and another reads): `{"from": <step>, "to": <step>, "label": "short plain label"}`. Add them whenever the map covers more than one service. |

Leave the other fields alone; they are ignored when the file is read back.

## 5. Check, then build

Call `check_descriptions` and fix what it flags (it is advisory; use judgment). Then call `build` with the same source and walk arguments, the `descriptionsPath`, and `out` paths: `.json` for the code-map document, `.html` for one standalone page. Fix every warning it returns; each means text is missing from the map.

## 6. Hand it over

Tell the person where the files are and how to open them (`code-map view <map.json>`, the hosted viewer, or the `.html` file); what the map covers and leaves out; and how to rebuild it after the code changes (the same `build` call, or the CLI command in the document's `generator.args`). List any stale docs you found, without fixing them unless asked.

## Reading a map

To understand a system someone already mapped, call `read_map` on its JSON. It returns the `system` section: summary, role, areas, every step with its file, lines, description, calls and data, and the links between services.
