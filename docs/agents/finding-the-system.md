# Finding the code for a named system or flow

Use this when the request names a system or a flow ("the dynamic data system across game-manager and game-sdk", "how a game gets promoted"), not exact files.

The goal is a **selection file**: a short list of the functions that tell the story. That means the entry points where the work starts, plus the main functions they lead to. The tool fills in the path between them.

## 1. Find the repos

- Names given (game-manager, game-sdk, …): look for them next to the current repo (`ls ..`) and under `~/Developer/WolfGamesWork/Wolfra/`. Confirm each folder exists and has a `package.json`.
- Not found, or two candidates: ask for the path. Don't guess.
- Only one repo named, but the code clearly calls another service: map the named repo, and mention the other service in your hand-over.

## 2. Learn what the system is, from its docs

Before searching code, read what the repos say about the system:

```sh
grep -ril "<term>" <repo>/README.md <repo>/ARCHITECTURE.md <repo>/docs <repo>/src/**/ARCHITECTURE.md <repo>/packages/*/README.md 2>/dev/null
```

Try the spellings the code would use: `dynamic data` → `dynamic-data`, `dynamicData`, `DynamicData`, `dynamic_data`. From the docs, write down in a few words:
- the **flows**: what starts the work, what happens, and where it ends. Most systems have 1–3, for example *write* (an editor saves data) and *read* (a game loads it);
- the **folders and packages** that own each part;
- how the parts **talk to each other**: direct calls, HTTP, queues, or files in storage.

## 3. Find the folders and entry points in code

```sh
# Folders and files named after the system
find <repo>/src <repo>/packages -ipath '*dynamic*data*' -not -path '*/node_modules/*' | head -40
# Where the system's names appear
grep -rIl --include='*.ts' -E 'DynamicData|dynamic-data' <repo>/src | head -40
```

Entry points are where outside work comes in. Good candidates:
- HTTP controllers and route handlers (`*.controller.ts`, `@Get`/`@Post`, `app.get(...)`);
- command and query handlers (`*Handler.execute`), jobs, queue consumers, scheduled functions;
- a package's public API: classes and functions exported from its `index.ts`, like a client the games call;
- CLI commands.

The tool can rank candidates inside a folder. These are functions nothing else calls, sorted by how much code they reach. Use the `list_entries` MCP tool, or:

```sh
code-map entries <repo> -i src/modules/dynamic-data
```

Check what a spec matches before relying on it (the `list_symbols` MCP tool, or):

```sh
code-map symbols <repos…> -i <paths…> -s "DynamicDataController.*" -s "packages/client/src/dynamic-data/*.ts#*"
```

## 4. Write the selection file

One spec per line; `#` starts a comment. Group the lines by flow so the file explains itself:

```
# Order flow: the shop API takes an order, charges it and saves it
OrdersController.create
PlaceOrderHandler.execute
PaymentService.charge
OrderRepo.save

# Read flow: the mobile app shows an order through the client package
ShopClient.getOrder
ShopClient.fetchJson
```

Spec forms: `file#name`, `Class.method`, a bare `name` (an error lists the matches if it's ambiguous), globs like `Service.*` or `src/api/*.ts#handle*`, or a file path (everything in it).

Choose **the functions a new person must understand**: the entry point of each flow, the step where the main decision or change happens, and the place data is saved or sent. Leave out small helpers, logging, validation boilerplate and type guards. A function you leave out still appears on the arrows between selected steps ("via …"), so the path stays complete.

## 5. Run, look, adjust

Trace it (the `trace` tool, or `code-map trace … --template <file>`) and look at the step count and the warnings:
- **A flow is missing:** its entry point isn't in the selection or isn't under the `-i` paths.
- **Too many steps:** remove helpers, or select fewer methods of a big class.
- **Parts that should connect show as separate starting points:** they probably talk over HTTP, queues or storage. Find where one side sends and the other receives (a URL path, a bucket path, a queue name) and add a `links` entry when you write the descriptions.

Keep the analysis fast by passing only the sub-paths that matter (`-i src -i packages/client/src`), not whole monorepos.
