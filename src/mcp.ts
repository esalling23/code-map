#!/usr/bin/env bun
// code-map as an MCP server (stdio). Each tool is a CLI command from commands.ts: its input schema comes from the
// command's options, and a call runs the CLI with --json, so agents and people get the same behaviour.
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Command, toArgv, toolShape } from "./command";
import { COMMANDS, GUIDES, guide } from "./commands";

const INSTRUCTIONS = `code-map maps how code runs: the functions on one path through one or more TypeScript/JavaScript repos, the data they use, and a plain-language walkthrough. The result is one JSON file. Its \`system\` section is a sitemap agents read to understand a system without its source; the viewer draws the whole file for people.

Use it whenever someone wants to understand, explain, onboard onto, document or visualize how code or a system works: a repo, a folder, a few files, one flow ("what happens when a game is promoted") or a named system spread over several repos. That includes "map this", "walk me through how X works", "explain this codebase to a new dev", "diagram the flow of X", or a request for an onboarding or architecture page, even when nobody says "code map".

To understand a system that already has a map, call read_map with the \`path\` of its JSON.

To make a map: (1) decide the repos (\`dirs\`), sub-paths (\`include\`) and an \`entry\` or \`select\` (list_entries, list_symbols); (2) call trace with a \`templatePath\`: the map covers everything reachable in that scope, so to focus it narrow \`include\`, \`select\` or \`entry\`, never drop steps; (3) read the code for every step; (4) write the descriptions into the template in short, plain English for engineers new to this code, explaining every project name; (5) check_descriptions, then build. Call guide with \`name: "workflow"\` before your first map, and \`name: "writing"\` before writing descriptions. Every tool lists its arguments in its input schema; use those names. Pass absolute paths.`;

/** A tool's arguments. An unknown name is rejected with the names the tool takes, so a wrong guess fixes itself on the next call. */
const args = (shape: z.ZodRawShape) =>
  z.strictObject(shape, {
    error: (iss) =>
      iss.code === "unrecognized_keys" ? `Unknown argument ${iss.keys.map((k) => `"${k}"`).join(", ")}. This tool takes: ${Object.keys(shape).join(", ")}.` : undefined,
  });

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError && { isError }) });
const CLI = join(import.meta.dir, "cli.ts");

/** Runs the command through the CLI. Failures go back to the agent as text it can act on, not as protocol errors. */
async function runCli(c: Command, input: Record<string, unknown>) {
  const proc = Bun.spawn([process.execPath, CLI, ...toArgv(c, input), "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    const at = stderr.lastIndexOf("code-map: ");
    return text((at >= 0 ? stderr.slice(at + "code-map: ".length) : stderr).trim() || `code-map ${c.name} exited with code ${code}`, true);
  }
  const result = stdout.trim() ? JSON.parse(stdout) : "";
  return text(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

const server = new McpServer({ name: "code-map", version: "0.1.0" }, { instructions: INSTRUCTIONS });

for (const c of COMMANDS) {
  if (!c.tool) continue;
  server.registerTool(c.tool, { description: c.description, inputSchema: args(toolShape(c)) }, (input) => runCli(c, input));
}

for (const name of GUIDES) {
  server.registerResource(name, `code-map://guide/${name}`, { title: `code-map guide: ${name}`, mimeType: "text/markdown" }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide(name) }],
  }));
}

await server.connect(new StdioServerTransport());
