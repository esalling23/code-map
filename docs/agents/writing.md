# Writing the descriptions

The readers are engineers who are new to this code, and many read English as a second language. They may read slowly or put text through a translator. Every rule below has the same aim: **the reader understands each sentence on the first read, and a translation still makes sense.**

## The rules

1. **Short sentences, one idea each.** Aim for under 20 words. Split a sentence at "and", "which" and "so that".
2. **Common words.** Use the plain word when one exists:

   | Instead of | Write |
   |---|---|
   | orchestrates, coordinates | runs, controls, calls … in order |
   | leverages, utilizes | uses |
   | initiates, kicks off | starts |
   | persists | saves, writes to the database |
   | retrieves, fetches | gets, reads, downloads |
   | propagates | passes on, sends on |
   | hydrates | fills in, loads |
   | is responsible for | does, owns |
   | in order to | to |
   | subsequently | then |
   | facilitates | lets, helps |

3. **No idioms or metaphors.** "Under the hood", "spin up", "boils down to", "the heavy lifting", "glue code", "out of the box" don't translate. Say the literal thing.
4. **Active voice; name who does what.** "game-manager saves the bundle to storage", not "the bundle is persisted".
5. **Present tense.** "It checks the slug", not "it will check".
6. **Explain project names the first time.** Give the meaning in plain words, then the name: "a *GamePack* (the set of game content for one day)". After that, the name alone is fine. This covers code names, product names and team terms alike.
7. **Spell out abbreviations once.** "Google Cloud Storage (GCS)", "content delivery network (CDN)". Common ones like API, HTTP, URL, JSON and ID need no expansion.
8. **Code names are references, not explanations.** Say what happens in words, and put the function or class name in backticks as a pointer: "It checks that the player may edit this game (`assertCanEdit`)." Don't build a sentence out of nothing but code names.
9. **What and why, not how line by line.** The code is shown beside the text. Describe what the step achieves and why the flow needs it. Mention a detail only when it would surprise a reader: a retry, a cache, an order that matters, a case that is skipped.
10. **Be exact, and only say what you read.** Don't guess at behaviour you didn't see in the code. When you're unsure, say so briefly ("This looks like it only runs in production; check the config").
11. **Rewrite docs; don't copy them.** Doc text is written for people who already know the system. Take the facts and say them again in these rules.

## Before and after

**Step description**

> Before (copied doc comment): *Orchestrates the promotion pipeline by leveraging the storage service to propagate the build artifacts and hydrate the vault config.*
>
> After: *This is where promotion starts. It copies the finished game build from the QA folder to the production folder in Google Cloud Storage (GCS). Then it rebuilds the vault config (the file each game reads to find its content) so players get the new version. Steps 3–9 do the copying; step 15 rebuilds the config.*

**Summary**

> Before: *The `PromoteGameHandler.execute` method invokes `StaticGameStorageService.copyFolder` and `VaultPublisherService.publishForGame`, then calls `invalidateCdnCache`.*
>
> After: *When someone promotes a game, this code makes the tested version live for players. It copies the game's files from the QA environment to production. It writes a new config file so the game knows which version to load. Last, it clears the content delivery network (CDN) cache so players don't get old files.*

**Area description**

> Before: *Sole writer of `{clientUid}/vault-config.json`, the one file games-vault reads.*
>
> After: *On this path, the client area rebuilds the vault config file. Only this code writes that file, and the games-vault service reads it to decide which games to show.*

**Link label** (keep it short; it's drawn on an arrow)

> `uploads bundle → CDN`, `POST /deploy/status`, `task queue`, `reads vault-config.json`

## Before you finish

Read the summary and three random step descriptions out loud. If you'd stumble, or a new teammate would ask "what does that mean?", rewrite it. Then run the checker (the `check_descriptions` MCP tool, or `code-map check <descriptions.json>`) and fix what it flags.
