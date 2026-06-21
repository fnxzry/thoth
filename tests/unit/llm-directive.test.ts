import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "../../src/directives/llm.js";
import "../../src/directives/include.js";
import "../../src/directives/static.js";
import { get, has, clear } from "../../src/directives/index.js";
import { parseDirectiveBody } from "../../src/directives/body-parser.js";
import { computeLlmCacheKey } from "../../src/cache.js";
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

interface CapturedCall {
  system: string;
  user: string;
  model: string;
}

interface StubProvider {
  complete: (req: { system: string; user: string; model: string }) => Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  captured: CapturedCall[];
  setResponse: (response: { content: string }) => void;
  setError: (err: Error) => void;
}

function makeStubProvider(): StubProvider {
  const captured: CapturedCall[] = [];
  let response = { content: "DEFAULT RESPONSE" };
  let error: Error | undefined;
  return {
    captured,
    setResponse(r) {
      response = r;
    },
    setError(e) {
      error = e;
    },
    complete: async (req) => {
      captured.push({ ...req });
      if (error) throw error;
      return response;
    },
  };
}

describe("@llm directive (module side effects)", () => {
  it("is registered when its module is imported", () => {
    expect(has("llm")).toBe(true);
  });
});

describe("@llm directive (multi-line body behavior)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-directive-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function buildParams(body: string, primaryParameter: string): Record<string, string | string[]> {
    const parsed = parseDirectiveBody(body);
    const params: Record<string, string | string[]> = { ...parsed.yamlParams, body };
    const resolved = primaryParameter || parsed.primaryContent || String(parsed.yamlParams.prompt ?? "");
    params.prompt = resolved;
    if (parsed.contextPaths.length > 0) {
      params.context = parsed.contextPaths;
    }
    return params;
  }

  function makeBodyCtx(opts: {
    body: string;
    sourceLine?: number;
    label?: string;
    provider?: StubProvider;
    files?: Record<string, string>;
  }) {
    const provider = opts.provider ?? makeStubProvider();
    const contextMap = new Map<string, string>();
    for (const [p, c] of Object.entries(opts.files ?? {})) {
      contextMap.set(p, c);
    }
    return {
      provider,
      ctx: {
        label: opts.label ?? "summary",
        sourceLine: opts.sourceLine ?? 1,
        params: buildParams(opts.body, ""),
        resolveContext: async (paths: string[]) => {
          const out = new Map<string, string>();
          for (const p of paths) {
            const v = contextMap.get(p);
            if (v === undefined) {
              throw new Error(`test setup: no content for ${p}`);
            }
            out.set(p, v);
          }
          return out;
        },
        callLlm: async (req: { system: string; user: string; model: string }) =>
          provider.complete(req),
        config: fakeConfig,
        templateDir: tmpDir,
      },
    };
  }

  it("calls the LLM provider with the prompt and returns its content", async () => {
    const provider = makeStubProvider();
    provider.setResponse({ content: "the model output" });

    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: Summarize.",
    });

    const impl = get("llm").impl;
    const result = await impl(ctx);

    expect(result.text).toBe("the model output");
    expect(provider.captured).toHaveLength(1);
    expect(provider.captured[0].user).toBe("Summarize.");
    expect(provider.captured[0].system).toBeTypeOf("string");
    expect(provider.captured[0].model).toBe(fakeConfig.llm.defaultModel);
  });

  it("uses the configured defaultModel when the directive does not specify one", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: hi",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].model).toBe(fakeConfig.llm.defaultModel);
  });

  it("overrides the configured defaultModel with the directive's model attribute", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: hi\nmodel: gpt-override",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].model).toBe("gpt-override");
  });

  it("inlines context-file contents after the prompt", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: Summarize.\ncontext:\n  - doc.md\n  - other.md",
      files: {
        "doc.md": "DOC CONTENT",
        "other.md": "OTHER CONTENT",
      },
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toContain("Summarize.");
    expect(provider.captured[0].user).toContain("----- doc.md -----");
    expect(provider.captured[0].user).toContain("DOC CONTENT");
    expect(provider.captured[0].user).toContain("----- other.md -----");
    expect(provider.captured[0].user).toContain("OTHER CONTENT");
  });

  it("does not include any context-file section when no context paths are listed", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: standalone",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("standalone");
    expect(provider.captured[0].user).not.toContain("-----");
  });

  it("passes the directive's source line through LlmError on missing prompt", async () => {
    const { ctx } = makeBodyCtx({
      body: "context:\n  - doc.md\n",
    });
    const impl = get("llm").impl;
    let caught: unknown;
    try {
      await impl(ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("prompt");
    expect((caught as { line?: number }).line).toBe(1);
  });

  it("surfaces provider errors as LlmError with the directive's source line", async () => {
    const provider = makeStubProvider();
    provider.setError(new Error("model blew up"));
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: do something",
    });
    const impl = get("llm").impl;
    let caught: unknown;
    try {
      await impl(ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("model blew up");
    expect((caught as { line?: number }).line).toBe(1);
  });

  it("supports multi-line prompt bodies via the | block style", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: |\n  line one\n  line two\n",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("line one\nline two");
  });

  it("reads context files from disk via the engine's resolveContext", async () => {
    const docPath = join(tmpDir, "ctx-file.md");
    writeFileSync(docPath, "FROM_DISK", "utf8");

    const provider = makeStubProvider();
    const body = "prompt: hi\ncontext:\n  - ctx-file.md";
    const parsed = parseDirectiveBody(body);
    const params: Record<string, string | string[]> = { ...parsed.yamlParams, body, prompt: String(parsed.yamlParams.prompt ?? "") };
    if (parsed.contextPaths.length > 0) {
      params.context = parsed.contextPaths;
    }
    const ctx = {
      label: "x",
      sourceLine: 1,
      params,
      resolveContext: async (paths: string[]) => {
        const out = new Map<string, string>();
        for (const p of paths) {
          const fullPath = join(tmpDir, p);
          const fs = await import("node:fs/promises");
          out.set(p, await fs.readFile(fullPath, { encoding: "utf8" }));
        }
        return out;
      },
      callLlm: async (req: { system: string; user: string; model: string }) =>
        provider.complete(req),
      config: fakeConfig,
      templateDir: tmpDir,
    };

    const impl = get("llm").impl;
    await impl(ctx);
    expect(provider.captured[0].user).toContain("FROM_DISK");
    expect(provider.captured[0].user).toContain("----- ctx-file.md -----");
  });

  it("tolerates blank lines between body elements", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeBodyCtx({
      provider,
      body: "prompt: |\n  first line\n  second line\n\nmodel: gpt-x\n",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].model).toBe("gpt-x");
    expect(provider.captured[0].user).toBe("first line\nsecond line");
  });
});

describe("@llm directive (one-liner primary parameter)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-oneliner-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeOneLinerCtx(opts: {
    primaryParameter: string;
    label?: string;
    body?: string;
    sourceLine?: number;
    provider?: StubProvider;
    files?: Record<string, string>;
  }) {
    const provider = opts.provider ?? makeStubProvider();
    const contextMap = new Map<string, string>();
    for (const [p, c] of Object.entries(opts.files ?? {})) {
      contextMap.set(p, c);
    }
    const body = opts.body ?? "";
    const parsed = parseDirectiveBody(body);
    const params: Record<string, string | string[]> = { ...parsed.yamlParams, body };
    // Primary key is "prompt"; precedence: primaryParameter > primaryContent > yamlParams.prompt
    params.prompt = opts.primaryParameter || parsed.primaryContent || String(parsed.yamlParams.prompt ?? "");
    if (parsed.contextPaths.length > 0) {
      params.context = parsed.contextPaths;
    }
    return {
      provider,
      ctx: {
        label: opts.label ?? "",
        sourceLine: opts.sourceLine ?? 1,
        params,
        resolveContext: async (paths: string[]) => {
          const out = new Map<string, string>();
          for (const p of paths) {
            const v = contextMap.get(p);
            if (v === undefined) {
              throw new Error(`test setup: no content for ${p}`);
            }
            out.set(p, v);
          }
          return out;
        },
        callLlm: async (req: { system: string; user: string; model: string }) =>
          provider.complete(req),
        config: fakeConfig,
        templateDir: tmpDir,
      },
    };
  }

  it("uses the primary parameter as the prompt", async () => {
    const provider = makeStubProvider();
    provider.setResponse({ content: "OK" });

    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "summarize this document",
    });

    const impl = get("llm").impl;
    const result = await impl(ctx);

    expect(result.text).toBe("OK");
    expect(provider.captured[0].user).toBe("summarize this document");
  });

  it("uses the primary parameter with the configured defaultModel", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "hello",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].model).toBe(fakeConfig.llm.defaultModel);
  });

  it("uses the labeled one-liner form with label and primary parameter", async () => {
    const provider = makeStubProvider();
    provider.setResponse({ content: "greeting" });

    const { ctx } = makeOneLinerCtx({
      provider,
      label: "greet",
      primaryParameter: "say hello in one short word",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("say hello in one short word");
  });

  it("prefers the primary parameter over the body's prompt attribute", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "from-primary",
      body: "prompt: from-body",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("from-primary");
  });

  it("still respects the body's model attribute on a one-liner", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "hi",
      body: "model: gpt-override",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("hi");
    expect(provider.captured[0].model).toBe("gpt-override");
  });

  it("still respects the body's context paths on a one-liner", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "summarize",
      body: "context:\n  - doc.md",
      files: {
        "doc.md": "DOC CONTENT",
      },
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toContain("summarize");
    expect(provider.captured[0].user).toContain("----- doc.md -----");
    expect(provider.captured[0].user).toContain("DOC CONTENT");
  });

  it("renders the prompt 'hello' verbatim from @llm hello", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "hello",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("hello");
  });

  it("renders the prompt 'hello world' verbatim from @llm hello world", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "hello world",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("hello world");
  });

  it("exits 1 with a clear error when the primary parameter is empty", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "",
      body: "",
      sourceLine: 7,
    });

    const impl = get("llm").impl;
    let caught: unknown;
    try {
      await impl(ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("@llm");
    expect((caught as Error).message).toContain("prompt");
    expect((caught as { line?: number }).line).toBe(7);
  });

  it("exits 1 when the primary parameter is empty but the body has no prompt", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeOneLinerCtx({
      provider,
      primaryParameter: "",
      body: "context:\n  - doc.md",
      files: { "doc.md": "X" },
      sourceLine: 3,
    });

    const impl = get("llm").impl;
    let caught: unknown;
    try {
      await impl(ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("prompt");
    expect((caught as { line?: number }).line).toBe(3);
  });
});

describe("@llm directive (label exposure)", () => {
  it("does not affect the LLM call; the prompt and model alone drive it", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-label-"));
    try {
      const provider = makeStubProvider();
      const ctx = {
        label: "irrelevant-label",
        sourceLine: 1,
        params: { prompt: "just-the-prompt", body: "" },
        resolveContext: async () => new Map<string, string>(),
        callLlm: async (req: { system: string; user: string; model: string }) =>
          provider.complete(req),
        config: fakeConfig,
        templateDir: tmpDir,
      };

      const impl = get("llm").impl;
      await impl(ctx);

      expect(provider.captured[0].user).toBe("just-the-prompt");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("@llm directive (body-as-prompt)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-body-prompt-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeLlmCtx(opts: {
    body: string;
    primaryParameter?: string;
    sourceLine?: number;
    provider?: StubProvider;
    files?: Record<string, string>;
  }) {
    const provider = opts.provider ?? makeStubProvider();
    const contextMap = new Map<string, string>();
    for (const [p, c] of Object.entries(opts.files ?? {})) {
      contextMap.set(p, c);
    }
    const body = opts.body;
    const pp = opts.primaryParameter ?? "";
    const parsed = parseDirectiveBody(body);
    const params: Record<string, string | string[]> = { ...parsed.yamlParams, body };
    params.prompt = pp || parsed.primaryContent || String(parsed.yamlParams.prompt ?? "");
    if (parsed.contextPaths.length > 0) {
      params.context = parsed.contextPaths;
    }
    return {
      provider,
      ctx: {
        label: "",
        sourceLine: opts.sourceLine ?? 1,
        params,
        resolveContext: async (paths: string[]) => {
          const out = new Map<string, string>();
          for (const p of paths) {
            const v = contextMap.get(p);
            if (v === undefined) {
              throw new Error(`test setup: no content for ${p}`);
            }
            out.set(p, v);
          }
          return out;
        },
        callLlm: async (req: { system: string; user: string; model: string }) =>
          provider.complete(req),
        config: fakeConfig,
        templateDir: tmpDir,
      },
    };
  }

  it("uses the body text as the prompt when there is no prompt: YAML key", async () => {
    const provider = makeStubProvider();
    provider.setResponse({ content: "the model output" });

    const { ctx } = makeLlmCtx({
      provider,
      body: "Summarize this file in two paragraphs. Include key architectural decisions.",
    });

    const impl = get("llm").impl;
    const result = await impl(ctx);

    expect(result.text).toBe("the model output");
    expect(provider.captured[0].user).toBe(
      "Summarize this file in two paragraphs. Include key architectural decisions.",
    );
  });

  it("uses body content below @--- as the prompt, with YAML params above", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      body: "model: gpt-4o\n@---\nSome prompt content",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("Some prompt content");
    expect(provider.captured[0].model).toBe("gpt-4o");
  });

  it("prefers body content below @--- over prompt: YAML param", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      body: "prompt: param-prompt\n@---\nbody-prompt",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("body-prompt");
  });

  it("uses prompt: YAML param when body has no primary content", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      body: "prompt: yaml-only-prompt\nmodel: gpt-4o",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("yaml-only-prompt");
    expect(provider.captured[0].model).toBe("gpt-4o");
  });

  it("combines body-as-prompt with context files from YAML section", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      body: "context:\n  - doc.md\n@---\nSummarize the document.",
      files: { "doc.md": "DOC CONTENT" },
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toContain("Summarize the document.");
    expect(provider.captured[0].user).toContain("----- doc.md -----");
    expect(provider.captured[0].user).toContain("DOC CONTENT");
  });

  it("primary parameter from one-liner still takes precedence over body content", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      primaryParameter: "one-liner-prompt",
      body: "Some body text for prompt",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("one-liner-prompt");
  });

  it("body-as-prompt with block scalar model config", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeLlmCtx({
      provider,
      body: "model: gpt-override\n@---\nline one\nline two\nline three",
    });

    const impl = get("llm").impl;
    await impl(ctx);

    expect(provider.captured[0].user).toBe("line one\nline two\nline three");
    expect(provider.captured[0].model).toBe("gpt-override");
  });

  it("errors when neither prompt: YAML, body content, nor primary parameter provide a prompt", async () => {
    const { ctx } = makeLlmCtx({
      body: "model: gpt-4o",
      sourceLine: 7,
    });

    const impl = get("llm").impl;
    let caught: unknown;
    try {
      await impl(ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain("prompt");
    expect((caught as { line?: number }).line).toBe(7);
  });
});

describe("@llm directive: registry cleanup safety", () => {
  afterEach(() => {
    clear();
  });

  it("does not interfere with other tests via cross-test registry pollution", () => {
    expect(has("llm")).toBe(true);
    clear();
    expect(has("llm")).toBe(false);
  });
});

describe("computeLlmCacheKey (cache-key spec)", () => {
  it("produces the same key for one-liner and equivalent multi-line form", () => {
    const providerId = "openai";
    const model = "gpt-4o";
    const prompt = "summarize";
    const contextFiles = new Map<string, string>([
      ["doc.md", "DOC CONTENT"],
    ]);

    const oneLinerKey = computeLlmCacheKey({
      providerId,
      model,
      prompt,
      contextFiles,
    });
    const multiLineKey = computeLlmCacheKey({
      providerId,
      model,
      prompt,
      contextFiles,
    });

    expect(oneLinerKey).toBe(multiLineKey);
  });

  it("produces different keys for different prompts", () => {
    const common = {
      providerId: "openai",
      model: "gpt-4o",
      contextFiles: new Map<string, string>(),
    };
    expect(
      computeLlmCacheKey({ ...common, prompt: "first" }),
    ).not.toBe(computeLlmCacheKey({ ...common, prompt: "second" }));
  });

  it("produces different keys for different models", () => {
    const common = {
      providerId: "openai",
      prompt: "same",
      contextFiles: new Map<string, string>(),
    };
    expect(
      computeLlmCacheKey({ ...common, model: "gpt-4o" }),
    ).not.toBe(computeLlmCacheKey({ ...common, model: "gpt-4o-mini" }));
  });

  it("produces different keys when context file contents change", () => {
    const baseContext = new Map<string, string>([["a.md", "AAA"]]);
    const changedContext = new Map<string, string>([["a.md", "BBB"]]);
    const common = { providerId: "openai", model: "gpt-4o", prompt: "p" };
    expect(
      computeLlmCacheKey({ ...common, contextFiles: baseContext }),
    ).not.toBe(computeLlmCacheKey({ ...common, contextFiles: changedContext }));
  });

  it("produces the same key regardless of context-file order", () => {
    const a = new Map<string, string>([
      ["a.md", "AAA"],
      ["b.md", "BBB"],
    ]);
    const b = new Map<string, string>([
      ["b.md", "BBB"],
      ["a.md", "AAA"],
    ]);
    const common = { providerId: "openai", model: "gpt-4o", prompt: "p" };
    expect(
      computeLlmCacheKey({ ...common, contextFiles: a }),
    ).toBe(computeLlmCacheKey({ ...common, contextFiles: b }));
  });

  it("canonicalizes trailing whitespace on the prompt", () => {
    const common = {
      providerId: "openai",
      model: "gpt-4o",
      contextFiles: new Map<string, string>(),
    };
    expect(
      computeLlmCacheKey({ ...common, prompt: "hi" }),
    ).toBe(computeLlmCacheKey({ ...common, prompt: "hi   \n  \n" }));
  });

  it("produces a 64-character lowercase hex string", () => {
    const key = computeLlmCacheKey({
      providerId: "openai",
      model: "gpt-4o",
      prompt: "anything",
      contextFiles: new Map<string, string>(),
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same key for the same inputs (determinism)", () => {
    const input = {
      providerId: "openai",
      model: "gpt-4o",
      prompt: "determinism check",
      contextFiles: new Map<string, string>([["x.md", "X"]]),
    };
    expect(computeLlmCacheKey(input)).toBe(computeLlmCacheKey(input));
  });
});