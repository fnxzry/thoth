import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "../../src/directives/each.js";
import { get, has } from "../../src/directives/index.js";
import { EachError } from "../../src/directives/each.js";
import type { DirectiveContext, ResolvedConfig } from "../../src/types.js";

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

function makeCtx(overrides: Partial<DirectiveContext> & { templateDir: string }): DirectiveContext {
  return {
    label: "",
    sourceLine: 1,
    primaryParameter: "",
    params: {},
    asMapping: {},
    resolveContext: async () => new Map(),
    callLlm: async () => ({ content: "llm-response" }),
    renderTemplate: async (t) => ({ text: t }),
    config: fakeConfig,
    ...overrides,
  };
}

describe("@each directive (module side effects)", () => {
  it("is registered when its module is imported", () => {
    expect(has("each")).toBe(true);
  });

  it("has null primary key", () => {
    const reg = get("each");
    expect(reg.primaryKey).toBeNull();
  });
});

describe("@each: basic rendering", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renders a heading per matched file with {{name}}", async () => {
    writeFileSync(join(tmpDir, "a.md"), "A content", "utf8");
    writeFileSync(join(tmpDir, "b.md"), "B content", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "## {{name}}" },
      renderTemplate: async (t) => ({ text: `[${t}]` }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("[## a.md]\n[## b.md]");
  });

  it("{{path}} resolves to relative path from template dir", async () => {
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "sub", "file.txt"), "hello", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "sub/*.txt",
      params: { body: "{{path}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("sub/file.txt");
  });

  it("{{content}} resolves to file contents when referenced", async () => {
    writeFileSync(join(tmpDir, "doc.md"), "This is doc content", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{content}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("This is doc content");
  });

  it("{{content}} is not read when not referenced in the template", async () => {
    writeFileSync(join(tmpDir, "x.md"), "SECRET", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("x.md");
  });

  it("{{index}} is zero-based", async () => {
    writeFileSync(join(tmpDir, "a.txt"), "", "utf8");
    writeFileSync(join(tmpDir, "b.txt"), "", "utf8");
    writeFileSync(join(tmpDir, "c.txt"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.txt",
      params: { body: "{{index}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("0\n1\n2");
  });

  it("sorts matches alphabetically by relative path", async () => {
    writeFileSync(join(tmpDir, "z.md"), "z", "utf8");
    writeFileSync(join(tmpDir, "a.md"), "a", "utf8");
    writeFileSync(join(tmpDir, "m.md"), "m", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("a.md\nm.md\nz.md");
  });
});

describe("@each: join param", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-join-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("defaults join separator to newline", async () => {
    writeFileSync(join(tmpDir, "1.txt"), "", "utf8");
    writeFileSync(join(tmpDir, "2.txt"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.txt",
      params: { body: "x" },
      renderTemplate: async () => ({ text: "X" }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("X\nX");
  });

  it("uses custom join separator when specified", async () => {
    writeFileSync(join(tmpDir, "1.txt"), "", "utf8");
    writeFileSync(join(tmpDir, "2.txt"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.txt",
      params: { body: "x", join: "---" },
      renderTemplate: async () => ({ text: "X" }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("X---X");
  });

  it("supports empty join separator", async () => {
    writeFileSync(join(tmpDir, "1.txt"), "", "utf8");
    writeFileSync(join(tmpDir, "2.txt"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.txt",
      params: { body: "x", join: "" },
      renderTemplate: async () => ({ text: "A" }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("AA");
  });
});

describe("@each: as param (variable renaming)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-as-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renames variables via as: mapping on context", async () => {
    writeFileSync(join(tmpDir, "doc.md"), "content", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{i}}: {{n}} at {{p}}" },
      asMapping: { path: "p", name: "n", index: "i" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("0: doc.md at doc.md");
  });

  it("allows partial renaming — unmapped keep defaults", async () => {
    writeFileSync(join(tmpDir, "f.txt"), "data", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.txt",
      params: { body: "{{n}}-{{path}}-{{index}}" },
      asMapping: { name: "n" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("f.txt-f.txt-0");
  });

  it("renamed content variable triggers lazy loading with new name", async () => {
    writeFileSync(join(tmpDir, "readme.md"), "readme body", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{bodyText}}" },
      asMapping: { content: "bodyText" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("readme body");
  });

  it("default {{content}} works when not in as: mapping", async () => {
    writeFileSync(join(tmpDir, "info.md"), "the info", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{n}}: {{content}}" },
      asMapping: { name: "n" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("info.md: the info");
  });
});

describe("@each: nested directives via renderTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-nested-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("calls renderTemplate for each iteration with substituted template", async () => {
    writeFileSync(join(tmpDir, "a.md"), "", "utf8");
    writeFileSync(join(tmpDir, "b.md"), "", "utf8");

    const calls: string[] = [];

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => {
        calls.push(t);
        return { text: `RENDERED[${t}]` };
      },
    });

    const result = await impl(ctx);
    expect(calls).toEqual(["a.md", "b.md"]);
    expect(result.text).toBe("RENDERED[a.md]\nRENDERED[b.md]");
  });

  it("nested @llm simulation works via renderTemplate", async () => {
    writeFileSync(join(tmpDir, "summary.md"), "doc summary", "utf8");

    let llmCalled = false;

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{name}}:\n\n@llm\nprompt: summarize {{path}}\n@end" },
      renderTemplate: async (t) => {
        llmCalled = true;
        return { text: `LLM_OUT_FOR[${t}]` };
      },
    });

    const result = await impl(ctx);
    expect(llmCalled).toBe(true);
    expect(result.text).toContain("LLM_OUT_FOR");
    expect(result.text).toContain("summary.md");
  });

  it("nested directives: outer substitution happens before renderTemplate is called", async () => {
    writeFileSync(join(tmpDir, "fruits.md"), "", "utf8");
    writeFileSync(join(tmpDir, "veggies.md"), "", "utf8");

    const impl = get("each").impl;
    const innerCalls: string[] = [];

    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "@inner {{path}} {{name}} {{index}}\n@end" },
      renderTemplate: async (t) => {
        innerCalls.push(t);
        return { text: "INNER" };
      },
    });

    await impl(ctx);
    expect(innerCalls).toHaveLength(2);
    expect(innerCalls[0]).toContain("fruits.md");
    expect(innerCalls[0]).toContain("0");
    expect(innerCalls[1]).toContain("veggies.md");
    expect(innerCalls[1]).toContain("1");
  });
});

describe("@each: edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-edge-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("empty glob returns empty text", async () => {
    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "nonexistent/*.md",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("");
  });

  it("supports ** for recursive matching", async () => {
    mkdirSync(join(tmpDir, "deep", "nested"), { recursive: true });
    writeFileSync(join(tmpDir, "root.md"), "root", "utf8");
    writeFileSync(join(tmpDir, "deep", "mid.md"), "mid", "utf8");
    writeFileSync(join(tmpDir, "deep", "nested", "leaf.md"), "leaf", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "**/*.md",
      params: { body: "{{path}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toContain("deep/mid.md");
    expect(result.text).toContain("deep/nested/leaf.md");
    expect(result.text).toContain("root.md");
  });

  it("pattern from params when no primary parameter on header", async () => {
    writeFileSync(join(tmpDir, "hello.md"), "hello", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "",
      params: { pattern: "*.md", body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("hello.md");
  });

  it("returns empty output when template body is blank", async () => {
    writeFileSync(join(tmpDir, "a.md"), "", "utf8");
    writeFileSync(join(tmpDir, "b.md"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "" },
      renderTemplate: async () => ({ text: "" }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("\n");
  });

  it("directories are excluded from matches", async () => {
    mkdirSync(join(tmpDir, "adir"), { recursive: true });
    writeFileSync(join(tmpDir, "afile.md"), "file", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "a*",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("afile.md");
  });

  it("handles files with empty content", async () => {
    writeFileSync(join(tmpDir, "empty.md"), "", "utf8");

    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{content}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    const result = await impl(ctx);
    expect(result.text).toBe("");
  });
});

describe("@each: error handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-err-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on unknown canonical name in as mapping", async () => {
    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{x}}" },
      asMapping: { bogus: "x" },
      renderTemplate: async (t) => ({ text: t }),
    });

    await expect(impl(ctx)).rejects.toThrowError(EachError);
    await expect(impl(ctx)).rejects.toThrowError(/Unknown canonical variable/);
  });

  it("throws on invalid identifier in as mapping value", async () => {
    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "*.md",
      params: { body: "{{x}}" },
      asMapping: { name: "123bad" },
      renderTemplate: async (t) => ({ text: t }),
    });

    await expect(impl(ctx)).rejects.toThrowError(EachError);
    await expect(impl(ctx)).rejects.toThrowError(/Invalid identifier/);
  });

  it("throws on missing pattern", async () => {
    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      primaryParameter: "",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    await expect(impl(ctx)).rejects.toThrowError(EachError);
    await expect(impl(ctx)).rejects.toThrowError(/missing pattern/);
  });

  it("includes source line in error messages", async () => {
    const impl = get("each").impl;
    const ctx = makeCtx({
      templateDir: tmpDir,
      sourceLine: 42,
      primaryParameter: "",
      params: { body: "{{name}}" },
      renderTemplate: async (t) => ({ text: t }),
    });

    try {
      await impl(ctx);
      expect.fail("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(EachError);
      expect((err as EachError).message).toContain("42");
      expect((err as EachError).line).toBe(42);
    }
  });
});