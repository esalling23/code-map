#!/usr/bin/env bun
// The code-map CLI. Every command is defined in commands.ts; the MCP server runs these same commands with --json.
import { type Command, commandHelp, parseCommand } from "./command";
import { COMMANDS } from "./commands";

const HELP = `code-map — generate a code-map of how code runs

Usage:
  code-map <command> [options]
  code-map <dir> [<dir> ...] [options]     the same as \`code-map build\`
  code-map-mcp                             the commands with an MCP tool, as an MCP server (stdio)

Commands:
${COMMANDS.map((c) => `  ${c.name.padEnd(9)}${c.tool ? `(MCP: ${c.tool})`.padEnd(30) : "".padEnd(30)}${c.description.split(/(?<=\.) /)[0]}`).join("\n")}

  Run \`code-map <command> --help\` for its options. Add --json to print the result as JSON.

  Several dirs are analyzed as one system. Files are shown under each repo's folder name, and calls
  into another repo's package are linked to its source by name. The map follows every call reachable
  from the entry or selection, within the analyzed files. To focus it, narrow the scope with -i, -s
  or -e. A walk over 2000 steps fails.
`;

async function main(argv: string[]) {
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    process.exit(argv.length ? 0 : 1);
  }
  const named = COMMANDS.find((c) => c.name === argv[0]);
  const command: Command = named ?? COMMANDS.find((c) => c.name === "build")!;
  const rest = named ? argv.slice(1) : argv;
  if (rest.includes("-h") || rest.includes("--help")) return void process.stdout.write(commandHelp(command));

  const json = rest.includes("--json");
  const result = await command.run(parseCommand(command, rest.filter((a) => a !== "--json")));
  const text = json ? JSON.stringify(result) : command.print ? command.print(result as never) : typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text) console.log(text);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`code-map: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
