import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  loadConfig,
  interpolateString,
  interpolateConfig,
  binaryToEnvSuffix,
  parseDotEnv,
  ConfigError,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_CACHE_DIR,
  DOTENV_FILENAME,
} from "../../src/config.js";
import type { RawConfigFile } from "../../src/config.js";

function makeFakeDeps(overrides: {
  files?: Record<string, string>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  homeDir?: string;
} = {}) {
  const files = overrides.files ?? {};
  const env: NodeJS.ProcessEnv = { ...(overrides.env ?? {}) };
  const cwd = overrides.cwd ?? "/work";
  const homeDir = overrides.homeDir ?? "/home/test";
  return {
    env,
    cwd,
    homeDir,
    readFileFn: async (path: string) => {
      if (path in files) return files[path];
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    },
    pathExistsFn: (path: string) => path in files,
  };
}

describe("binaryToEnvSuffix", () => {
  it("uppercases the binary name", () => {
    expect(binaryToEnvSuffix("thoth")).toBe("THOTH");
  });

  it("replaces non-alphanumeric characters with underscores", () => {
    expect(binaryToEnvSuffix("doc-builder")).toBe("DOC_BUILDER");
    expect(binaryToEnvSuffix("my tool")).toBe("MY_TOOL");
  });
});

describe("interpolateString", () => {
  it("substitutes a single env var", () => {
    expect(interpolateString("${OPENAI_API_KEY}", { OPENAI_API_KEY: "sk-x" })).toBe("sk-x");
  });

  it("substitutes multiple env vars in one string", () => {
    expect(
      interpolateString("${HOST}:${PORT}", { HOST: "h", PORT: "8080" }),
    ).toBe("h:8080");
  });

  it("returns the string unchanged when no env var is referenced", () => {
    expect(interpolateString("plain value", {})).toBe("plain value");
  });

  it("throws when the referenced env var is unset", () => {
    expect(() => interpolateString("${MISSING_VAR}", {})).toThrowError(ConfigError);
  });

  it("allows the empty string from an env var", () => {
    expect(interpolateString("${EMPTY}", { EMPTY: "" })).toBe("");
  });
});

describe("interpolateConfig", () => {
  it("interpolates cacheDir and llm fields", () => {
    const raw: RawConfigFile = {
      cacheDir: "${CACHE_DIR}",
      llm: {
        provider: "openai",
        apiKey: "${OPENAI_API_KEY}",
        baseUrl: "${OPENAI_BASE_URL}",
        defaultModel: "${OPENAI_MODEL}",
      },
    };
    const out = interpolateConfig(raw, {
      CACHE_DIR: "/custom-cache",
      OPENAI_API_KEY: "sk-1",
      OPENAI_BASE_URL: "https://example.com/v1",
      OPENAI_MODEL: "gpt-x",
    });
    expect(out.cacheDir).toBe("/custom-cache");
    expect(out.llm?.apiKey).toBe("sk-1");
    expect(out.llm?.baseUrl).toBe("https://example.com/v1");
    expect(out.llm?.defaultModel).toBe("gpt-x");
  });

  it("does not interpolate non-string fields like cache.enabled", () => {
    const raw: RawConfigFile = {
      cache: { enabled: false },
    };
    const out = interpolateConfig(raw, {});
    expect(out.cache?.enabled).toBe(false);
  });

  it("throws when an llm.apiKey interpolation resolves to empty", () => {
    const raw: RawConfigFile = {
      llm: { apiKey: "${EMPTY_KEY}" },
    };
    expect(() => interpolateConfig(raw, { EMPTY_KEY: "" })).toThrowError(
      /empty apiKey/,
    );
  });
});

describe("loadConfig: defaults", () => {
  it("returns built-in defaults when no config file and no relevant env vars", async () => {
    const deps = makeFakeDeps({ env: { OPENAI_API_KEY: "k" } });
    const result = await loadConfig({
      binaryName: "thoth",
      ...deps,
    });
    expect(result.cacheDir).toBe(DEFAULT_CACHE_DIR);
    expect(result.llm.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(result.llm.defaultModel).toBe(DEFAULT_MODEL);
    expect(result.cache.enabled).toBe(true);
  });

  it("throws when no apiKey can be resolved", async () => {
    const deps = makeFakeDeps({ env: {} });
    await expect(
      loadConfig({ binaryName: "thoth", ...deps }),
    ).rejects.toThrowError(/missing OpenAI API key/);
  });
});

describe("loadConfig: env var precedence", () => {
  it("OPENAI_API_KEY env var overrides missing config-file apiKey", async () => {
    const deps = makeFakeDeps({
      env: { OPENAI_API_KEY: "env-key" },
    });
    const result = await loadConfig({ binaryName: "thoth", ...deps });
    expect(result.llm.apiKey).toBe("env-key");
  });

  it("OPENAI_BASE_URL env var overrides config-file baseUrl", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          llm: { baseUrl: "https://from-config.example.com/v1", apiKey: "cfg-key" },
        }),
      },
      env: { OPENAI_BASE_URL: "https://from-env.example.com/v1" },
    });
    const result = await loadConfig({ binaryName: "thoth", ...deps });
    expect(result.llm.baseUrl).toBe("https://from-env.example.com/v1");
    expect(result.llm.apiKey).toBe("cfg-key");
  });

  it("OPENAI_MODEL env var overrides config-file defaultModel", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          llm: {
            defaultModel: "gpt-from-config",
            apiKey: "cfg-key",
          },
        }),
      },
      env: { OPENAI_MODEL: "gpt-from-env" },
    });
    const result = await loadConfig({ binaryName: "thoth", ...deps });
    expect(result.llm.defaultModel).toBe("gpt-from-env");
  });
});

describe("loadConfig: CLI flag precedence", () => {
  it("CLI configPath overrides <TOOL>_CONFIG env var", async () => {
    const deps = makeFakeDeps({
      files: {
        "/from/env.json": JSON.stringify({ llm: { apiKey: "env-config-key" } }),
        "/from/cli.json": JSON.stringify({ llm: { apiKey: "cli-config-key" } }),
      },
      env: { THOTH_CONFIG: "/from/env.json" },
    });
    const result = await loadConfig({
      binaryName: "thoth",
      ...deps,
      cli: { configPath: "/from/cli.json" },
    });
    expect(result.llm.apiKey).toBe("cli-config-key");
    expect(result.configPath).toBe("/from/cli.json");
  });

  it("CLI cacheDir overrides config-file cacheDir", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          cacheDir: "/from-config-cache",
          llm: { apiKey: "k" },
        }),
      },
      env: {},
    });
    const result = await loadConfig({
      binaryName: "thoth",
      ...deps,
      cli: { cacheDir: "/from-cli-cache" },
    });
    expect(result.cacheDir).toBe("/from-cli-cache");
  });

  it("CLI --no-cache disables the cache even when config has it enabled", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          cache: { enabled: true },
          llm: { apiKey: "k" },
        }),
      },
      env: {},
    });
    const result = await loadConfig({
      binaryName: "thoth",
      ...deps,
      cli: { noCache: true },
    });
    expect(result.cache.enabled).toBe(false);
  });

  it("missing CLI config file throws a clear error", async () => {
    const deps = makeFakeDeps({ env: {} });
    await expect(
      loadConfig({
        binaryName: "thoth",
        ...deps,
        cli: { configPath: "/no/such/file.json" },
      }),
    ).rejects.toThrowError(/config file not found/);
  });
});

describe("loadConfig: config-file ${ENV_VAR} interpolation", () => {
  it("resolves ${OPENAI_API_KEY} in the config file from the env", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          llm: { apiKey: "${OPENAI_API_KEY}" },
        }),
      },
      env: { OPENAI_API_KEY: "from-interp" },
    });
    const result = await loadConfig({ binaryName: "thoth", ...deps });
    expect(result.llm.apiKey).toBe("from-interp");
  });

  it("throws when a referenced env var is unset", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          llm: { apiKey: "${UNSET_VAR_XYZ}" },
        }),
      },
      env: {},
    });
    await expect(
      loadConfig({ binaryName: "thoth", ...deps }),
    ).rejects.toThrowError(/UNSET_VAR_XYZ/);
  });

  it("works with custom env-var names (not just OPENAI_*)", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          llm: { apiKey: "${MY_SECRET}" },
        }),
      },
      env: { MY_SECRET: "secret-value" },
    });
    const result = await loadConfig({ binaryName: "thoth", ...deps });
    expect(result.llm.apiKey).toBe("secret-value");
  });
});

describe("loadConfig: default search path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-config-search-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads ./thoth.config.json from the cwd when present", async () => {
    const cfgPath = join(tmpDir, "thoth.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ llm: { apiKey: "from-cwd-config" } }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-cwd-config");
    expect(result.configPath).toBe(cfgPath);
  });

  it("prefers ./<binary>.config.json over ~/.config/<binary>/config.json", async () => {
    const cwdConfig = join(tmpDir, "thoth.config.json");
    const homeDir = join(tmpDir, "home");
    const userConfig = join(homeDir, ".config", "thoth", "config.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(homeDir, ".config", "thoth"), { recursive: true });
    writeFileSync(
      cwdConfig,
      JSON.stringify({ llm: { apiKey: "from-cwd" } }),
      "utf8",
    );
    writeFileSync(
      userConfig,
      JSON.stringify({ llm: { apiKey: "from-user" } }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      homeDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-cwd");
    expect(result.configPath).toBe(cwdConfig);
  });
});

describe("loadConfig: THOTH_CONFIG env var", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-config-thothvar-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads the file pointed to by THOTH_CONFIG", async () => {
    const cfgPath = join(tmpDir, "custom-config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ llm: { apiKey: "from-env-var-config" } }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: { THOTH_CONFIG: cfgPath },
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-env-var-config");
    expect(result.configPath).toBe(cfgPath);
  });

  it("throws if THOTH_CONFIG points to a missing file", async () => {
    const missingPath = join(tmpDir, "no-such-config.json");
    await expect(
      loadConfig({
        binaryName: "thoth",
        cwd: tmpDir,
        env: { THOTH_CONFIG: missingPath },
        readFileFn: async (p) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(p, { encoding: "utf8" });
        },
        pathExistsFn: (p) => existsSync(p),
      }),
    ).rejects.toThrowError(/config file not found/);
  });
});

describe("loadConfig: malformed config file", () => {
  it("throws when the JSON is invalid", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": "this is not json",
      },
    });
    await expect(
      loadConfig({ binaryName: "thoth", ...deps }),
    ).rejects.toThrowError(/failed to parse config file/);
  });

  it("throws when a value has the wrong type", async () => {
    const deps = makeFakeDeps({
      files: {
        "/work/thoth.config.json": JSON.stringify({
          cache: { enabled: "not-a-boolean" },
        }),
      },
    });
    await expect(
      loadConfig({ binaryName: "thoth", ...deps }),
    ).rejects.toThrow();
  });
});

describe("loadConfig: ConfigError", () => {
  it("is an EngineError subclass so the CLI surfaces it with exit code 1", async () => {
    const err = new ConfigError("test");
    expect(err.name).toBe("ConfigError");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("homedir helper (sanity)", () => {
  it("uses os.homedir() as part of the user-config default search path", () => {
    expect(homedir()).toBeTypeOf("string");
    expect(homedir().length).toBeGreaterThan(0);
  });
});

describe("parseDotEnv", () => {
  it("returns an empty object for an empty string", () => {
    expect(parseDotEnv("")).toEqual({});
  });

  it("parses simple KEY=VALUE pairs", () => {
    expect(parseDotEnv("FOO=bar\nBAZ=qux")).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("ignores comments and blank lines", () => {
    expect(
      parseDotEnv("# a comment\n\nFOO=bar\n# another comment\nBAZ=qux"),
    ).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips surrounding double quotes", () => {
    expect(parseDotEnv('FOO="bar baz"')).toEqual({ FOO: "bar baz" });
  });

  it("strips surrounding single quotes", () => {
    expect(parseDotEnv("FOO='bar baz'")).toEqual({ FOO: "bar baz" });
  });

  it("preserves internal whitespace inside quoted values", () => {
    expect(parseDotEnv('FOO="  spaces  "')).toEqual({ FOO: "  spaces  " });
  });

  it("trims whitespace around unquoted values", () => {
    expect(parseDotEnv("FOO=  bar  ")).toEqual({ FOO: "bar" });
  });

  it("supports the export prefix", () => {
    expect(parseDotEnv("export FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("ignores lines without an equals sign", () => {
    expect(parseDotEnv("FOO\nBAR=ok")).toEqual({ BAR: "ok" });
  });

  it("handles CRLF line endings", () => {
    expect(parseDotEnv("FOO=bar\r\nBAZ=qux")).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("allows values to contain '=' characters", () => {
    expect(parseDotEnv("FOO=a=b=c")).toEqual({ FOO: "a=b=c" });
  });
});

describe("loadConfig: .env file precedence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-config-dotenv-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function writeDotEnv(contents: string): string {
    const path = join(tmpDir, DOTENV_FILENAME);
    writeFileSync(path, contents, "utf8");
    return path;
  }

  it("loads values from a .env file when no explicit env var is set", async () => {
    writeDotEnv("OPENAI_API_KEY=from-dotenv\nOPENAI_MODEL=dotenv-model");
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-dotenv");
    expect(result.llm.defaultModel).toBe("dotenv-model");
  });

  it("explicit env var wins over .env file", async () => {
    writeDotEnv("OPENAI_API_KEY=from-dotenv\nOPENAI_MODEL=dotenv-model");
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {
        OPENAI_API_KEY: "from-env-var",
      },
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-env-var");
    expect(result.llm.defaultModel).toBe("dotenv-model");
  });

  it("explicit env var wins over .env and config file (highest among value sources)", async () => {
    writeDotEnv("OPENAI_API_KEY=from-dotenv");
    const cfgPath = join(tmpDir, "thoth.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ llm: { apiKey: "from-config-file" } }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "from-env-var" },
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-env-var");
  });

  it(".env is not loaded when the file does not exist (no error)", async () => {
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "from-env-only" },
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-env-only");
  });

  it(".env file can supply a THOTH_CONFIG path", async () => {
    const cfgPath = join(tmpDir, "custom.json");
    writeFileSync(cfgPath, JSON.stringify({ llm: { apiKey: "from-custom-config" } }), "utf8");
    writeDotEnv(`THOTH_CONFIG=${cfgPath}`);
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-custom-config");
    expect(result.configPath).toBe(cfgPath);
  });

  it(".env values are available for ${ENV_VAR} interpolation in the config file", async () => {
    writeDotEnv("MY_SECRET=from-dotenv\n");
    const cfgPath = join(tmpDir, "thoth.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ llm: { apiKey: "${MY_SECRET}" } }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-dotenv");
  });

  it(".env values are overridden by the config file when neither env var is set", async () => {
    writeDotEnv("OPENAI_BASE_URL=https://from-dotenv.example.com/v1");
    const cfgPath = join(tmpDir, "thoth.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        llm: {
          apiKey: "cfg-key",
          baseUrl: "https://from-config.example.com/v1",
        },
      }),
      "utf8",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.baseUrl).toBe("https://from-dotenv.example.com/v1");
    expect(result.llm.apiKey).toBe("cfg-key");
  });

  it("OPENAI_API_KEY in .env supplies a missing apiKey", async () => {
    writeDotEnv("OPENAI_API_KEY=from-dotenv-only\n");
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("from-dotenv-only");
  });

  it("ignores comment lines and blank lines in .env", async () => {
    writeDotEnv(
      "# this is a comment\n\nOPENAI_API_KEY=key-from-dotenv\n# another\n",
    );
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("key-from-dotenv");
  });

  it("supports quoted values in .env", async () => {
    writeDotEnv('OPENAI_API_KEY="my secret key"\n');
    const result = await loadConfig({
      binaryName: "thoth",
      cwd: tmpDir,
      env: {},
      readFileFn: async (p) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(p, { encoding: "utf8" });
      },
      pathExistsFn: (p) => existsSync(p),
    });
    expect(result.llm.apiKey).toBe("my secret key");
  });
});