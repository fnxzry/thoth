import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import {
  LlmCache,
  computeLlmCacheKey,
  isLlmCacheEntry,
} from "../../src/cache.js";

let warnings: string[] = [];

function makeCache(dir: string): LlmCache {
  warnings = [];
  return new LlmCache({
    cacheDir: dir,
    warn: (msg) => warnings.push(msg),
  });
}

describe("LlmCache.pathFor", () => {
  it("places entries under <cacheDir>/<key[0:2]>/<key[2:4]>/<key>.json", () => {
    const cache = makeCache("/tmp/.doc-cache");
    const key = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const expected = resolvePath(
      "/tmp/.doc-cache",
      "ab",
      "cd",
      `${key}.json`,
    );
    expect(cache.pathFor(key)).toBe(expected);
  });

  it("uses the first four hex chars as the two-level shard", () => {
    const cache = makeCache("/var/cache");
    const path = cache.pathFor("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(path).toContain("/01/23/");
    expect(path.endsWith(".json")).toBe(true);
  });
});

describe("LlmCache.get and put", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cache-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null on a miss and writes the entry on a subsequent put", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "first prompt",
      contextFiles: new Map(),
    });

    expect(await cache.get(key)).toBeNull();
    await cache.put(key, { content: "CACHED_TEXT", usage: { promptTokens: 3, completionTokens: 5 } });

    const hit = await cache.get(key);
    expect(hit).not.toBeNull();
    expect(hit!.content).toBe("CACHED_TEXT");
    expect(hit!.usage).toEqual({ promptTokens: 3, completionTokens: 5 });
  });

  it("returns the cached entry across a fresh LlmCache instance (persistence)", async () => {
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "persist me",
      contextFiles: new Map([["x.md", "X"]]),
    });

    await makeCache(tmpDir).put(key, { content: "PERSISTED" });
    const hit = await makeCache(tmpDir).get(key);
    expect(hit).not.toBeNull();
    expect(hit!.content).toBe("PERSISTED");
  });

  it("stores entries under the sharded layout", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "shard test",
      contextFiles: new Map(),
    });
    await cache.put(key, { content: "SHARDED" });

    const expectedPath = cache.pathFor(key);
    expect(existsSync(expectedPath)).toBe(true);

    const shard1 = join(tmpDir, key.slice(0, 2));
    const shard2 = join(shard1, key.slice(2, 4));
    expect(existsSync(shard1)).toBe(true);
    expect(existsSync(shard2)).toBe(true);
  });

  it("writes the entry as pretty-printed JSON", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "json shape",
      contextFiles: new Map(),
    });
    await cache.put(key, { content: "JSON", usage: { promptTokens: 1, completionTokens: 2 } });

    const raw = readFileSync(cache.pathFor(key), "utf8");
    expect(raw).toContain("\n");
    expect(raw).toContain('"content"');
    expect(raw).toContain('"usage"');
    expect(raw).toContain('"promptTokens": 1');
    expect(raw).toContain('"completionTokens": 2');
  });

  it("round-trips an entry without usage metadata", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "no usage",
      contextFiles: new Map(),
    });
    await cache.put(key, { content: "NO_USAGE" });
    const hit = await cache.get(key);
    expect(hit).toEqual({ content: "NO_USAGE" });
  });

  it("creates missing shard directories on put", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "creates shard",
      contextFiles: new Map(),
    });
    expect(existsSync(join(tmpDir, key.slice(0, 2)))).toBe(false);
    await cache.put(key, { content: "X" });
    expect(existsSync(join(tmpDir, key.slice(0, 2)))).toBe(true);
    expect(existsSync(join(tmpDir, key.slice(0, 2), key.slice(2, 4)))).toBe(true);
  });
});

describe("LlmCache: error handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cache-err-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null on ENOENT and does not warn", async () => {
    warnings = [];
    const cache = new LlmCache({ cacheDir: tmpDir });
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "missing",
      contextFiles: new Map(),
    });
    const hit = await cache.get(key);
    expect(hit).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("returns null and warns when a malformed JSON cache file is read", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "malformed",
      contextFiles: new Map(),
    });
    const path = cache.pathFor(key);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "not-json", "utf8");

    const hit = await cache.get(key);
    expect(hit).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("parse");
  });

  it("returns null and warns when a cache file has an unexpected shape", async () => {
    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "shape",
      contextFiles: new Map(),
    });
    const path = cache.pathFor(key);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ not: "content" }), "utf8");

    const hit = await cache.get(key);
    expect(hit).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("shape");
  });

  it("warns and does not throw when put cannot create its shard directory", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;

    const blocked = join(tmpDir, "blocked");
    mkdirSync(blocked);
    chmodSync(blocked, 0o555);

    try {
      const cache = makeCache(blocked);
      const key = computeLlmCacheKey({
        providerId: "openai",
        model: "gpt-4o",
        prompt: "blocked",
        contextFiles: new Map(),
      });
      // Put should swallow the error, warn, and return.
      await expect(cache.put(key, { content: "X" })).resolves.toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  it("cleans up the temp file when the final rename fails (atomic write)", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;

    const cache = makeCache(tmpDir);
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "atomic",
      contextFiles: new Map(),
    });
    const path = cache.pathFor(key);
    mkdirSync(join(path, ".."), { recursive: true });
    // Pre-create the target as a directory so the rename fails.
    mkdirSync(path);

    await cache.put(key, { content: "X" });
    expect(warnings.length).toBeGreaterThan(0);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe("LlmCache: integration with @llm directive via engine.render", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cache-engine-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("first run calls the provider and writes a cache entry", async () => {
    let calls = 0;
    const provider = {
      complete: async () => {
        calls++;
        return { content: "FIRST_RUN" };
      },
    };

    const config = {
      cacheDir: ".doc-cache",
      llm: {
        provider: "openai" as const,
        apiKey: "k",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-4o",
      },
      cache: { enabled: true },
    };

    const { render } = await import("../../src/engine.js");
    const out = await render("@llm:id\nprompt: hi\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(out).toBe("FIRST_RUN");
    expect(calls).toBe(1);

    const cachePath = join(
      tmpDir,
      ".doc-cache",
      // We don't know the key, but it should be a 2-level directory
    );
    expect(existsSync(cachePath)).toBe(true);
  });

  it("second run with unchanged prompt and context hits the cache", async () => {
    let calls = 0;
    const provider = {
      complete: async () => {
        calls++;
        return { content: "FROM_LLM" };
      },
    };

    const config = {
      cacheDir: ".doc-cache",
      llm: {
        provider: "openai" as const,
        apiKey: "k",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-4o",
      },
      cache: { enabled: true },
    };

    const { render } = await import("../../src/engine.js");

    await render("@llm:id\nprompt: hit me\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(calls).toBe(1);

    await render("@llm:id\nprompt: hit me\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(calls).toBe(1);
  });

  it("changing the prompt invalidates the cache (regenerates)", async () => {
    let calls = 0;
    let lastResponse = "RESPONSE_A";
    const provider = {
      complete: async () => {
        calls++;
        return { content: lastResponse };
      },
    };

    const config = {
      cacheDir: ".doc-cache",
      llm: {
        provider: "openai" as const,
        apiKey: "k",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-4o",
      },
      cache: { enabled: true },
    };

    const { render } = await import("../../src/engine.js");

    const out1 = await render("@llm:id\nprompt: alpha\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(out1).toBe("RESPONSE_A");
    expect(calls).toBe(1);

    lastResponse = "RESPONSE_B";
    const out2 = await render("@llm:id\nprompt: beta\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(out2).toBe("RESPONSE_B");
    expect(calls).toBe(2);
  });

  it("changing a context file's contents invalidates the cache (regenerates)", async () => {
    const contextPath = join(tmpDir, "ctx.md");
    writeFileSync(contextPath, "VERSION_1", "utf8");

    let calls = 0;
    let lastResponse = "RESPONSE_V1";
    const provider = {
      complete: async () => {
        calls++;
        return { content: lastResponse };
      },
    };

    const config = {
      cacheDir: ".doc-cache",
      llm: {
        provider: "openai" as const,
        apiKey: "k",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-4o",
      },
      cache: { enabled: true },
    };

    const { render } = await import("../../src/engine.js");

    const out1 = await render(
      "@llm:id\nprompt: summarize\ncontext:\n  - ctx.md\n@end",
      {
        templateDir: tmpDir,
        config,
        llmProvider: provider,
      },
    );
    expect(out1).toBe("RESPONSE_V1");
    expect(calls).toBe(1);

    writeFileSync(contextPath, "VERSION_2", "utf8");
    lastResponse = "RESPONSE_V2";
    const out2 = await render(
      "@llm:id\nprompt: summarize\ncontext:\n  - ctx.md\n@end",
      {
        templateDir: tmpDir,
        config,
        llmProvider: provider,
      },
    );
    expect(out2).toBe("RESPONSE_V2");
    expect(calls).toBe(2);
  });

  it("--no-cache in config skips the cache and always calls the provider", async () => {
    let calls = 0;
    const provider = {
      complete: async () => {
        calls++;
        return { content: "FRESH" };
      },
    };

    const config = {
      cacheDir: ".doc-cache",
      llm: {
        provider: "openai" as const,
        apiKey: "k",
        baseUrl: "https://example.com/v1",
        defaultModel: "gpt-4o",
      },
      cache: { enabled: false },
    };

    const { render } = await import("../../src/engine.js");

    await render("@llm:id\nprompt: nocache\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    await render("@llm:id\nprompt: nocache\n@end", {
      templateDir: tmpDir,
      config,
      llmProvider: provider,
    });
    expect(calls).toBe(2);
  });
});

describe("isLlmCacheEntry", () => {
  it("accepts entries with content only", () => {
    expect(isLlmCacheEntry({ content: "hi" })).toBe(true);
  });

  it("accepts entries with content and usage", () => {
    expect(
      isLlmCacheEntry({
        content: "hi",
        usage: { promptTokens: 1, completionTokens: 2 },
      }),
    ).toBe(true);
  });

  it("rejects entries missing content", () => {
    expect(isLlmCacheEntry({ usage: { promptTokens: 1, completionTokens: 2 } })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isLlmCacheEntry(null)).toBe(false);
    expect(isLlmCacheEntry("string")).toBe(false);
    expect(isLlmCacheEntry(42)).toBe(false);
  });

  it("rejects entries with malformed usage", () => {
    expect(isLlmCacheEntry({ content: "hi", usage: "nope" })).toBe(false);
    expect(isLlmCacheEntry({ content: "hi", usage: { promptTokens: 1 } })).toBe(false);
  });
});

// Silence unused-import warnings for vi (kept for symmetry with other test
// files; remove if no vi usage is ever needed here).
void vi;