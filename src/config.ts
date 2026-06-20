import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { EngineError } from "./engine.js";
import type { ResolvedConfig } from "./types.js";

export class ConfigError extends EngineError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const BinaryNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/);

const RawConfigFileSchema = z
  .object({
    cacheDir: z.string().optional(),
    cache: z
      .object({
        enabled: z.boolean().optional(),
      })
      .optional(),
    llm: z
      .object({
        provider: z.literal("openai").optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        defaultModel: z.string().optional(),
      })
      .optional(),
  })
  .partial();

export type RawConfigFile = z.infer<typeof RawConfigFileSchema>;

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_CACHE_DIR = "./.doc-cache";

export interface LoadConfigCliOverrides {
  configPath?: string;
  cacheDir?: string;
  noCache?: boolean;
}

export interface LoadConfigOptions {
  binaryName: string;
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  readFileFn?: (path: string) => Promise<string>;
  pathExistsFn?: (path: string) => boolean;
  cli?: LoadConfigCliOverrides;
}

export function binaryToEnvSuffix(binaryName: string): string {
  return binaryName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function defaultSearchPaths(binaryName: string, cwd: string, homeDir: string): string[] {
  return [
    join(cwd, `${binaryName}.config.json`),
    join(homeDir, ".config", binaryName, "config.json"),
  ];
}

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function interpolateString(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(ENV_VAR_PATTERN, (_match, name: string) => {
    const v = env[name];
    if (v === undefined) {
      throw new ConfigError(
        `config references environment variable \${${name}} which is not set`,
      );
    }
    return v;
  });
}

export function interpolateConfig(
  raw: RawConfigFile,
  env: NodeJS.ProcessEnv,
): RawConfigFile {
  const out: RawConfigFile = {};
  if (raw.cacheDir !== undefined) {
    out.cacheDir = interpolateString(raw.cacheDir, env);
  }
  if (raw.cache !== undefined && raw.cache.enabled !== undefined) {
    out.cache = { enabled: raw.cache.enabled };
  }
  if (raw.llm !== undefined) {
    const llm: RawConfigFile["llm"] = {};
    if (raw.llm.apiKey !== undefined) {
      const v = interpolateString(raw.llm.apiKey, env);
      if (v === "") {
        throw new ConfigError(
          "config references an empty apiKey after interpolation",
        );
      }
      llm.apiKey = v;
    }
    if (raw.llm.baseUrl !== undefined) {
      llm.baseUrl = interpolateString(raw.llm.baseUrl, env);
    }
    if (raw.llm.defaultModel !== undefined) {
      llm.defaultModel = interpolateString(raw.llm.defaultModel, env);
    }
    if (raw.llm.provider !== undefined) {
      llm.provider = raw.llm.provider;
    }
    out.llm = llm;
  }
  return out;
}

async function readMaybeConfig(
  path: string,
  readFileFn: (path: string) => Promise<string>,
  pathExistsFn: (path: string) => boolean,
): Promise<RawConfigFile | undefined> {
  if (!pathExistsFn(path)) return undefined;
  let text: string;
  try {
    text = await readFileFn(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return undefined;
    throw new ConfigError(
      `failed to read config file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `failed to parse config file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return RawConfigFileSchema.parse(parsed);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

export const DOTENV_FILENAME = ".env";
const DOTENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTENV_EXPORT_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s\t]+|[\s\t]+$/g, "");
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(DOTENV_EXPORT_PATTERN);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (DOTENV_KEY_PATTERN.test(key)) {
      out[key] = value;
    }
  }
  return out;
}

async function loadDotEnvFile(
  path: string,
  readFileFn: (path: string) => Promise<string>,
  pathExistsFn: (path: string) => boolean,
): Promise<Record<string, string>> {
  if (!pathExistsFn(path)) return {};
  let text: string;
  try {
    text = await readFileFn(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return {};
    throw new ConfigError(
      `failed to read .env file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return parseDotEnv(text);
  } catch (err) {
    throw new ConfigError(
      `failed to parse .env file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function loadConfig(
  opts: LoadConfigOptions,
): Promise<ResolvedConfig> {
  const binaryName = BinaryNameSchema.parse(opts.binaryName);
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const homeDir = opts.homeDir ?? homedir();
  const readFileFn =
    opts.readFileFn ?? ((path) => readFile(path, { encoding: "utf8" }));
  const pathExistsFn = opts.pathExistsFn ?? ((path) => existsSync(path));
  const cli = opts.cli ?? {};

  const dotEnv = await loadDotEnvFile(
    join(cwd, DOTENV_FILENAME),
    readFileFn,
    pathExistsFn,
  );
  const mergedEnv: NodeJS.ProcessEnv = { ...dotEnv, ...env };

  const configEnvName = `${binaryToEnvSuffix(binaryName)}_CONFIG`;

  let rawConfig: RawConfigFile | undefined;
  let resolvedConfigPath: string | undefined;
  let missingRequiredPath: string | undefined;

  if (cli.configPath !== undefined) {
    resolvedConfigPath = cli.configPath;
    rawConfig = await readMaybeConfig(cli.configPath, readFileFn, pathExistsFn);
    if (rawConfig === undefined) {
      missingRequiredPath = cli.configPath;
    }
  } else {
    const envConfigPath = nonEmpty(mergedEnv[configEnvName]);
    if (envConfigPath !== undefined) {
      resolvedConfigPath = envConfigPath;
      rawConfig = await readMaybeConfig(envConfigPath, readFileFn, pathExistsFn);
      if (rawConfig === undefined) {
        missingRequiredPath = envConfigPath;
      }
    } else {
      for (const candidate of defaultSearchPaths(binaryName, cwd, homeDir)) {
        const found = await readMaybeConfig(candidate, readFileFn, pathExistsFn);
        if (found !== undefined) {
          rawConfig = found;
          resolvedConfigPath = candidate;
          break;
        }
      }
    }
  }

  if (missingRequiredPath !== undefined) {
    if (cli.configPath !== undefined) {
      throw new ConfigError(`config file not found: ${missingRequiredPath}`);
    }
    throw new ConfigError(
      `config file not found (from $${configEnvName}): ${missingRequiredPath}`,
    );
  }

  const interpolated = interpolateConfig(rawConfig ?? {}, mergedEnv);

  const fileCacheEnabled = interpolated.cache?.enabled;
  const cliCacheDir = cli.cacheDir;
  const cliNoCache = cli.noCache === true;

  const cacheDir = nonEmpty(cliCacheDir) ?? nonEmpty(interpolated.cacheDir) ?? DEFAULT_CACHE_DIR;

  const cacheEnabled =
    !cliNoCache && (fileCacheEnabled ?? true);

  const envApiKey = nonEmpty(mergedEnv.OPENAI_API_KEY);
  const envBaseUrl = nonEmpty(mergedEnv.OPENAI_BASE_URL);
  const envModel = nonEmpty(mergedEnv.OPENAI_MODEL);

  const fileApiKey = nonEmpty(interpolated.llm?.apiKey);
  const fileBaseUrl = nonEmpty(interpolated.llm?.baseUrl);
  const fileModel = nonEmpty(interpolated.llm?.defaultModel);

  const apiKey = envApiKey ?? fileApiKey ?? "";

  if (apiKey === "") {
    throw new ConfigError(
      "missing OpenAI API key: set OPENAI_API_KEY or llm.apiKey in the config file",
    );
  }

  const baseUrl = envBaseUrl ?? fileBaseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = envModel ?? fileModel ?? DEFAULT_MODEL;

  const result: ResolvedConfig = {
    cacheDir,
    llm: {
      provider: "openai",
      apiKey,
      baseUrl,
      defaultModel,
    },
    cache: {
      enabled: cacheEnabled,
    },
  };
  if (resolvedConfigPath !== undefined) {
    result.configPath = resolvedConfigPath;
  }
  return result;
}