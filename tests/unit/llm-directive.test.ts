import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "../../src/directives/llm.js";
import "../../src/directives/include.js";
import "../../src/directives/static.js";
import { get, has, clear } from "../../src/directives/index.js";
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

describe("@llm directive (behavior)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-directive-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeCtx(opts: {
    body: string;
    sourceLine?: number;
    id?: string;
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
        block: {
          kind: "directive" as const,
          name: "llm",
          id: opts.id ?? "summary",
          attributes: {},
          body: opts.body,
          sourceLine: opts.sourceLine ?? 1,
        },
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

    const { ctx } = makeCtx({
      provider,
      body: "prompt: Summarize.",
    });

    const impl = get("llm");
    const result = await impl(ctx);

    expect(result.text).toBe("the model output");
    expect(provider.captured).toHaveLength(1);
    expect(provider.captured[0].user).toBe("Summarize.");
    expect(provider.captured[0].system).toBeTypeOf("string");
    expect(provider.captured[0].model).toBe(fakeConfig.llm.defaultModel);
  });

  it("uses the configured defaultModel when the directive does not specify one", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeCtx({
      provider,
      body: "prompt: hi",
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].model).toBe(fakeConfig.llm.defaultModel);
  });

  it("overrides the configured defaultModel with the directive's model attribute", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeCtx({
      provider,
      body: "prompt: hi\nmodel: gpt-override",
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].model).toBe("gpt-override");
  });

  it("inlines context-file contents after the prompt", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeCtx({
      provider,
      body: "prompt: Summarize.\ncontext:\n  - doc.md\n  - other.md",
      files: {
        "doc.md": "DOC CONTENT",
        "other.md": "OTHER CONTENT",
      },
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].user).toContain("Summarize.");
    expect(provider.captured[0].user).toContain("----- doc.md -----");
    expect(provider.captured[0].user).toContain("DOC CONTENT");
    expect(provider.captured[0].user).toContain("----- other.md -----");
    expect(provider.captured[0].user).toContain("OTHER CONTENT");
  });

  it("does not include any context-file section when no context paths are listed", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeCtx({
      provider,
      body: "prompt: standalone",
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].user).toBe("standalone");
    expect(provider.captured[0].user).not.toContain("-----");
  });

  it("passes the directive's source line through LlmError on missing prompt", async () => {
    const { ctx } = makeCtx({
      body: "context:\n  - doc.md\n",
    });
    const impl = get("llm");
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
    const { ctx } = makeCtx({
      provider,
      body: "prompt: do something",
    });
    const impl = get("llm");
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
    const { ctx } = makeCtx({
      provider,
      body: "prompt: |\n  line one\n  line two\n",
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].user).toBe("line one\nline two");
  });

  it("reads context files from disk via the engine's resolveContext", async () => {
    const docPath = join(tmpDir, "ctx-file.md");
    writeFileSync(docPath, "FROM_DISK", "utf8");

    const provider = makeStubProvider();
    const ctx = {
      block: {
        kind: "directive" as const,
        name: "llm",
        id: "x",
        attributes: {},
        body: "prompt: hi\ncontext:\n  - ctx-file.md",
        sourceLine: 1,
      },
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

    const impl = get("llm");
    await impl(ctx);
    expect(provider.captured[0].user).toContain("FROM_DISK");
    expect(provider.captured[0].user).toContain("----- ctx-file.md -----");
  });

  it("tolerates blank lines between body elements", async () => {
    const provider = makeStubProvider();
    const { ctx } = makeCtx({
      provider,
      body: "prompt: |\n  first line\n  second line\n\nmodel: gpt-x\n",
    });

    const impl = get("llm");
    await impl(ctx);

    expect(provider.captured[0].model).toBe("gpt-x");
    expect(provider.captured[0].user).toBe("first line\nsecond line");
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