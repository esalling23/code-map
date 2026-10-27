// One definition per command, read three ways: the CLI parses argv with it, the MCP server builds each tool's
// input schema from it, and `toArgv` turns parsed values back into the CLI arguments that reproduce them.
import { parseArgs } from "node:util";
import { z } from "zod";

export interface OptionSpec {
  kind: "string" | "strings" | "number" | "boolean";
  description: string;
  /** The long CLI flag, when it isn't the key in kebab-case. */
  flag?: string;
  short?: string;
  /** Shown in help after the flag, e.g. `<file>`. */
  arg?: string;
  /** Taken from the positional arguments. A command has at most one; `strings` takes them all. */
  positional?: boolean;
  /** `"mcp"`: required from agents, while the CLI falls back to `default`. */
  required?: boolean | "mcp";
  default?: string | string[] | number | boolean;
  choices?: readonly string[];
  /** Only on the command line: not an MCP input, and not saved in the arguments that rebuild a map. */
  cliOnly?: boolean;
}

type ValueOf<O extends OptionSpec> = O["kind"] extends "strings" ? string[] : O["kind"] extends "number" ? number : O["kind"] extends "boolean" ? boolean : string;
export type Values<S extends Record<string, OptionSpec>> = { [K in keyof S]?: ValueOf<S[K]> };

export interface Command<S extends Record<string, OptionSpec> = Record<string, OptionSpec>, R = unknown> {
  name: string;
  /** The MCP tool for this command. Without one, the command is CLI-only. */
  tool?: string;
  usage: string;
  description: string;
  options: S;
  run: (values: Values<S>) => R | Promise<R>;
  /** The result as text for a person; without it the CLI prints strings as they are and anything else as JSON. */
  print?: (result: Awaited<R>) => string;
}

export const defineCommand = <const S extends Record<string, OptionSpec>, R>(c: Command<S, R>) => c as unknown as Command;

const kebab = (key: string) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const flagOf = (key: string, o: OptionSpec) => o.flag ?? kebab(key);
const entries = (c: Command) => Object.entries(c.options);

/** Parses a command's arguments (without the command name), applying defaults and checking types. */
export function parseCommand(c: Command, argv: string[]): Record<string, any> {
  const options: NonNullable<Parameters<typeof parseArgs>[0]>["options"] = {};
  for (const [key, o] of entries(c)) {
    if (o.positional) continue;
    const flag = flagOf(key, o);
    options[flag] = { type: o.kind === "boolean" ? "boolean" : "string", ...(o.short && { short: o.short }), ...(o.kind === "strings" && { multiple: true }) };
    if (o.kind === "boolean" && o.default === true) options[`no-${flag}`] = { type: "boolean" };
  }
  const { values: raw, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true });

  const out: Record<string, unknown> = {};
  const positional = entries(c).find(([, o]) => o.positional);
  if (!positional && positionals.length) throw new Error(`${c.name} takes no positional arguments; got "${positionals[0]}".`);
  if (positional) {
    const [key, o] = positional;
    if (o.kind !== "strings" && positionals.length > 1) throw new Error(`${c.name} takes one ${o.arg ?? key}; got ${positionals.length}.`);
    if (positionals.length) out[key] = o.kind === "strings" ? positionals : positionals[0];
  }
  for (const [key, o] of entries(c)) {
    if (o.positional) {
      if (out[key] === undefined && o.default !== undefined) out[key] = o.default;
    } else {
      const flag = flagOf(key, o);
      const v = raw[flag];
      if (o.kind === "boolean") out[key] = raw[`no-${flag}`] ? false : ((v as boolean | undefined) ?? o.default);
      else if (o.kind === "number") out[key] = v === undefined ? o.default : toNumber(`--${flag}`, v as string);
      else out[key] = v ?? o.default;
    }
    const v = out[key];
    if (o.required && (v === undefined || (Array.isArray(v) && !v.length))) throw new Error(`${c.name} needs ${o.positional ? (o.arg ?? key) : `--${flagOf(key, o)}`}.`);
    if (o.choices && v !== undefined && !o.choices.includes(v as string)) throw new Error(`${o.arg ?? key} must be one of ${o.choices.join(", ")}; got "${v}".`);
  }
  return out;
}

function toNumber(flag: string, text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} takes a positive whole number; got "${text}".`);
  return n;
}

/** The CLI arguments for these values, starting with the command name. `recorded` leaves out CLI-only options. */
export function toArgv(c: Command, values: Record<string, unknown>, { recorded = false } = {}): string[] {
  const positional: string[] = [];
  const flags: string[] = [];
  for (const [key, o] of entries(c)) {
    const v = values[key];
    if (v === undefined || v === null || (recorded && o.cliOnly)) continue;
    if (o.positional) {
      positional.push(...(Array.isArray(v) ? v.map(String) : [String(v)]));
      continue;
    }
    const flag = `--${flagOf(key, o)}`;
    if (o.kind === "boolean") {
      if (v && o.default !== true) flags.push(flag);
      if (!v && o.default === true) flags.push(`--no-${flagOf(key, o)}`);
    } else if (Array.isArray(v)) {
      for (const item of v) flags.push(flag, String(item));
    } else {
      flags.push(flag, String(v));
    }
  }
  return [c.name, ...positional, ...flags];
}

/** The MCP input schema: every option that isn't CLI-only, under its key. */
export function toolShape(c: Command): z.ZodRawShape {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, o] of entries(c)) {
    if (o.cliOnly) continue;
    let s: z.ZodType =
      o.choices ? z.enum(o.choices as [string, ...string[]])
      : o.kind === "strings" ? (o.required ? z.array(z.string()).min(1) : z.array(z.string()))
      : o.kind === "number" ? z.number().int().positive()
      : o.kind === "boolean" ? z.boolean()
      : z.string();
    if (!o.required) s = s.optional();
    shape[key] = s.describe(o.description);
  }
  return shape;
}

/** `code-map <name> --help`. */
export function commandHelp(c: Command): string {
  const rows = entries(c)
    .filter(([, o]) => !o.positional)
    .map(([key, o]) => {
      const flag = flagOf(key, o);
      const name = `${o.short ? `-${o.short}, ` : "    "}--${o.kind === "boolean" && o.default === true ? `no-${flag}` : flag}${o.kind === "boolean" ? "" : ` ${o.arg ?? "<value>"}`}`;
      return `  ${name.padEnd(28)} ${o.description}`;
    });
  return `code-map ${c.name} — ${c.description}\n\nUsage:\n  code-map ${c.name} ${c.usage}\n${rows.length ? `\nOptions:\n${rows.join("\n")}\n` : ""}      --json                   Print the result as JSON\n  -h, --help                   Show this help\n`;
}
