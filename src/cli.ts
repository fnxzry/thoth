#!/usr/bin/env node

import { readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

import { render, EngineError, defaultConfig } from "./engine.js";

export interface CliDeps {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  getPackageVersion: () => string;
}

export interface ParsedArgs {
  config?: string;
  check: boolean;
  output?: string;
  cacheDir?: string;
  noCache: boolean;
  help: boolean;
  version: boolean;
  input?: string;
}

export type ParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string };

const USAGE = `Usage: thoth [options] <input.md>

Render a thoth template to stdout (or to --output if given).

Options:
  --config <path>      Path to config file (no-op in this build)
  --check              Drift detection (no-op in this build)
  --output <path>      Write output to <path> instead of stdout
  --cache-dir <path>   Override cache directory (no-op in this build)
  --no-cache           Bypass the cache (no-op in this build)
  --help               Print this help and exit
  --version            Print the version and exit

Exit codes:
  0  success
  1  unexpected runtime error
  2  usage error
  3  drift detected (only with --check)
`;

export function usage(): string {
  return USAGE;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const args: ParsedArgs = {
    check: false,
    noCache: false,
    help: false,
    version: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case "--help":
        args.help = true;
        i++;
        break;
      case "--version":
        args.version = true;
        i++;
        break;
      case "--check":
        args.check = true;
        i++;
        break;
      case "--no-cache":
        args.noCache = true;
        i++;
        break;
      case "--config": {
        const value = argv[i + 1];
        if (value === undefined) {
          return { ok: false, error: "--config requires a value" };
        }
        args.config = value;
        i += 2;
        break;
      }
      case "--output": {
        const value = argv[i + 1];
        if (value === undefined) {
          return { ok: false, error: "--output requires a value" };
        }
        args.output = value;
        i += 2;
        break;
      }
      case "--cache-dir": {
        const value = argv[i + 1];
        if (value === undefined) {
          return { ok: false, error: "--cache-dir requires a value" };
        }
        args.cacheDir = value;
        i += 2;
        break;
      }
      default:
        if (arg.startsWith("--")) {
          return { ok: false, error: `unknown flag: ${arg}` };
        }
        if (args.input !== undefined) {
          return { ok: false, error: `unexpected positional argument: ${arg}` };
        }
        args.input = arg;
        i++;
        break;
    }
  }

  return { ok: true, args };
}

function defaultDeps(): CliDeps {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (filePath) => readFileAsync(filePath, { encoding: "utf8" }),
    writeFile: (filePath, data) => writeFileAsync(filePath, data, { encoding: "utf8" }),
    getPackageVersion: () => {
      const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
      const pkg = require(pkgPath) as { version: string };
      return pkg.version;
    },
  };
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    const argvPath = realpathSync(process.argv[1]);
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return argvPath === modulePath;
  } catch {
    return false;
  }
}

function formatFsError(err: unknown, path: string): { message: string; code: number } {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return { message: `error: ${path}: no such file or directory\n`, code: 2 };
  }
  if (code === "EACCES") {
    return { message: `error: ${path}: permission denied\n`, code: 2 };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { message: `error: ${path}: ${detail}\n`, code: 1 };
}

export async function run(
  argv: readonly string[],
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    deps.stderr.write(`error: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const args = parsed.args;

  if (args.help) {
    deps.stdout.write(USAGE);
    return 0;
  }
  if (args.version) {
    deps.stdout.write(`${deps.getPackageVersion()}\n`);
    return 0;
  }
  if (!args.input) {
    deps.stderr.write(`error: missing input file\n\n${USAGE}`);
    return 2;
  }

  let text: string;
  try {
    text = await deps.readFile(args.input);
  } catch (err) {
    const { message, code } = formatFsError(err, args.input);
    deps.stderr.write(message);
    return code;
  }

  let rendered: string;
  try {
    const templateDir = dirname(resolvePath(args.input));
    rendered = await render(text, { templateDir, config: defaultConfig });
  } catch (err: unknown) {
    if (err instanceof EngineError) {
      deps.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    const detail = err instanceof Error ? err.message : String(err);
    deps.stderr.write(`error: ${detail}\n`);
    return 1;
  }

  try {
    if (args.output !== undefined) {
      await deps.writeFile(args.output, rendered);
    } else {
      deps.stdout.write(rendered);
    }
  } catch (err) {
    const target = args.output ?? args.input;
    const { message, code } = formatFsError(err, target);
    deps.stderr.write(message);
    return code;
  }

  return 0;
}

if (isMain()) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}