import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "../../src/directives/static.js";
import "../../src/directives/include.js";
import { get, has } from "../../src/directives/index.js";
import { ResolvedConfig } from "../../src/types.js";

const fakeConfig: ResolvedConfig = {
  cacheDir: ".doc-cache",
  llm: {
    provider: "openai",
    apiKey: "test-key",
    baseUrl: "https://api.example.com/v1",
    defaultModel: "gpt-test",
  },
  cache: {
    enabled: true,
  },
};

describe("static directive (module side effects)", () => {
  it("is registered when its module is imported", () => {
    expect(has("static")).toBe(true);
  });

  it("returns the block body unchanged", async () => {
    const impl = get("static");
    const ctx = {
      block: {
        kind: "directive" as const,
        name: "static",
        id: "x",
        attributes: {},
        body: "verbatim content",
        sourceLine: 1,
      },
      resolveContext: async () => new Map<string, string>(),
      callLlm: async () => {
        throw new Error("not implemented");
      },
      config: fakeConfig,
      templateDir: "/tmp",
    };
    const result = await impl(ctx);
    expect(result.text).toBe("verbatim content");
  });

  it("returns empty text for empty body", async () => {
    const impl = get("static");
    const ctx = {
      block: {
        kind: "directive" as const,
        name: "static",
        id: "x",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
      resolveContext: async () => new Map<string, string>(),
      callLlm: async () => {
        throw new Error("not implemented");
      },
      config: fakeConfig,
      templateDir: "/tmp",
    };
    const result = await impl(ctx);
    expect(result.text).toBe("");
  });
});

describe("include directive (module side effects)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-include-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeCtx(templateDir: string, id: string, sourceLine = 1) {
    return {
      block: {
        kind: "directive" as const,
        name: "include",
        id,
        attributes: {},
        body: "",
        sourceLine,
      },
      resolveContext: async () => new Map<string, string>(),
      callLlm: async () => {
        throw new Error("not implemented");
      },
      config: fakeConfig,
      templateDir,
    };
  }

  it("is registered when its module is imported", () => {
    expect(has("include")).toBe(true);
  });

  it("inlines the contents of a file specified by a relative path", async () => {
    const path = join(tmpDir, "snippet.md");
    writeFileSync(path, "inlined content", "utf8");

    const impl = get("include");
    const result = await impl(makeCtx(tmpDir, "snippet.md"));
    expect(result.text).toBe("inlined content");
  });

  it("inlines the contents of a file specified by an absolute path", async () => {
    const path = join(tmpDir, "absolute.md");
    writeFileSync(path, "absolute content", "utf8");

    const impl = get("include");
    const result = await impl(makeCtx(tmpDir, path));
    expect(result.text).toBe("absolute content");
  });

  it("resolves nested relative paths against the template directory", async () => {
    const nested = join(tmpDir, "nested");
    mkdirSync(nested, { recursive: true });
    const path = join(nested, "deep.md");
    writeFileSync(path, "deep content", "utf8");

    const impl = get("include");
    const result = await impl(makeCtx(tmpDir, "nested/deep.md"));
    expect(result.text).toBe("deep content");
  });

  it("preserves the file's trailing newline", async () => {
    const path = join(tmpDir, "newline.md");
    writeFileSync(path, "with newline\n", "utf8");

    const impl = get("include");
    const result = await impl(makeCtx(tmpDir, "newline.md"));
    expect(result.text).toBe("with newline\n");
  });

  it("throws when the id is empty", async () => {
    const impl = get("include");
    await expect(impl(makeCtx(tmpDir, ""))).rejects.toThrowError(/no path/);
  });

  it("throws a clear error when the referenced file does not exist", async () => {
    const impl = get("include");
    await expect(impl(makeCtx(tmpDir, "missing.md"))).rejects.toThrowError(
      /file not found/,
    );
  });

  it("reports a permission-denied error when the file is unreadable", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const path = join(tmpDir, "locked.md");
    writeFileSync(path, "secret", "utf8");
    chmodSync(path, 0o000);
    try {
      const impl = get("include");
      await expect(impl(makeCtx(tmpDir, "locked.md"))).rejects.toThrowError(
        /permission denied/,
      );
    } finally {
      chmodSync(path, 0o600);
    }
  });
});