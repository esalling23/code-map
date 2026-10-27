import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Command, parseCommand, toArgv, toolShape } from "../src/command";
import { COMMANDS } from "../src/commands";
import { readSelectionSpecs } from "../src/trace";

const areas = join(import.meta.dir, "areas");
const CLI = join(import.meta.dir, "../src/cli.ts");
const command = (name: string) => COMMANDS.find((c) => c.name === name)!;
const cli = (...args: string[]) => {
  const r = Bun.spawnSync([process.execPath, CLI, ...args]);
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
};

/** A value for every option, unlike its default, so a dropped flag shows up as a difference. */
function sample(c: Command): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const [key, o] of Object.entries(c.options)) {
    if (o.choices) v[key] = o.choices[o.choices.length - 1];
    else if (o.kind === "strings") v[key] = [`${key}-a`, `${key}-b`];
    else if (o.kind === "number") v[key] = 7;
    else if (o.kind === "boolean") v[key] = o.default !== true;
    else v[key] = `${key}-value`;
  }
  return v;
}

describe("commands: one definition for the CLI and the MCP tools", () => {
  test.each(COMMANDS.map((c) => [c.name, c] as const))("%s: every option survives values → CLI args → values", (_, c) => {
    const values = sample(c);
    const argv = toArgv(c, values);
    expect(argv[0]).toBe(c.name);
    expect(parseCommand(c, argv.slice(1))).toEqual(values);
  });

  test("each MCP tool takes exactly the command's options that aren't CLI-only", () => {
    for (const c of COMMANDS.filter((x) => x.tool)) {
      const shared = Object.entries(c.options).filter(([, o]) => !o.cliOnly).map(([k]) => k);
      expect(Object.keys(toolShape(c)).sort()).toEqual(shared.sort());
    }
    expect(COMMANDS.filter((c) => c.tool).map((c) => c.tool).sort()).toEqual(["build", "check_descriptions", "guide", "list_entries", "list_symbols", "read_map", "trace"]);
  });

  test("defaults fill in, and recorded args leave out CLI-only options", () => {
    const build = command("build");
    const values = parseCommand(build, [areas, "-e", "Orders.place", "--strict", "--descriptions", "d.json", "--raw", "raw.json"]);
    expect(values.out).toEqual(["code-map.json"]);
    expect(toArgv(build, values, { recorded: true })).toEqual(["build", areas, "--entry", "Orders.place", "--out", "code-map.json", "--descriptions", "d.json"]);
  });

  test("bad values fail with a message instead of being used", () => {
    expect(() => parseCommand(command("entries"), [areas, "--limit", "abc"])).toThrow('--limit takes a positive whole number; got "abc"');
    expect(() => parseCommand(command("build"), [areas, "--max-hops", "0"])).toThrow("positive whole number");
    expect(() => parseCommand(command("view"), ["--port", "x"])).toThrow("positive whole number");
    expect(() => parseCommand(command("guide"), ["nope"])).toThrow("must be one of workflow, writing, finding-the-system");
    expect(() => parseCommand(command("symbols"), [areas])).toThrow("symbols needs --spec");
    expect(() => parseCommand(command("build"), [areas, "--llm"])).toThrow("Unknown option '--llm'");
    expect(() => parseCommand(command("check"), ["a.json", "b.json"])).toThrow("takes one");
  });
});

describe("selection specs", () => {
  test("a source file path is a spec, not a list of specs; a folder doesn't crash", () => {
    const source = join(areas, "src/modules/payments/charge.ts");
    expect(readSelectionSpecs([source])).toEqual([source]);
    expect(readSelectionSpecs([areas])).toEqual([areas]);
    expect(readSelectionSpecs([join(import.meta.dir, "selection.txt")]).length).toBeGreaterThan(0);
  });
});

describe("the CLI", () => {
  test("`code-map <dir>` builds, and `generator.args` rebuilds the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-map-cli-"));
    const first = join(dir, "first.json");
    expect(cli(areas, "-e", "Orders.place", "-o", first).code).toBe(0);
    const doc = JSON.parse(readFileSync(first, "utf8"));
    expect(doc.generator.args).toEqual(["build", areas, "--entry", "Orders.place", "--out", first]);

    const second = join(dir, "second.json");
    const args = doc.generator.args.map((a: string) => (a === first ? second : a));
    expect(cli(...args).code).toBe(0);
    expect(readFileSync(second, "utf8")).toBe(readFileSync(first, "utf8").replace(first, second));
  });

  test("commands print text, or JSON with --json; errors exit 1 with the message", () => {
    expect(cli("entries", areas).stdout).toContain("Orders.place");
    expect(JSON.parse(cli("entries", areas, "--json").stdout)[0]).toHaveProperty("reach");
    expect(cli("guide", "--help").stdout).toContain("code-map guide <workflow|writing|finding-the-system>");
    const bad = cli("trace", areas, "-e", "nope");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("code-map: ");
  });
});
