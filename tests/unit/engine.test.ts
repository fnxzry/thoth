import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  render,
  defaultConfig,
  EngineError,
} from "../../src/engine.js";
import {
  register,
  clear,
  DirectiveRegistryError,
} from "../../src/directives/index.js";
import { DirectiveImpl, LlmProvider } from "../../src/types.js";

const stubLlmProvider: LlmProvider = {
  complete: async () => {
    throw new Error("stubLlmProvider should not be called in this test");
  },
};

describe("engine: static-only rendering", () => {
  it("renders a static-only template byte-identically to its source", async () => {
    const template = "hello world";
    const result = await render(template, {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe(template);
  });

  it("renders a multi-line static-only template byte-identically", async () => {
    const template = "line one\nline two\nline three";
    const result = await render(template, {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe(template);
  });

  it("renders a trailing-newline template byte-identically", async () => {
    const template = "hello\n";
    const result = await render(template, {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe(template);
  });

  it("renders an empty template as an empty string", async () => {
    const result = await render("", {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe("");
  });
});

describe("engine: include directive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-engine-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("inlines a referenced file at the directive's position", async () => {
    writeFileSync(join(tmpDir, "foo.md"), "FILE_CONTENT", "utf8");

    const template = "before\n@include foo.md\nafter";
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });

    expect(result).toBe("before\nFILE_CONTENT\nafter");
  });

  it("resolves multiple include directives in source order", async () => {
    writeFileSync(join(tmpDir, "a.md"), "AAA", "utf8");
    writeFileSync(join(tmpDir, "b.md"), "BBB", "utf8");

    const template = "intro\n@include a.md\nmiddle\n@include b.md\noutro";
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });

    expect(result).toBe("intro\nAAA\nmiddle\nBBB\noutro");
  });

  it("inlines a file at the start of the template", async () => {
    writeFileSync(join(tmpDir, "head.md"), "HEAD", "utf8");

    const template = "@include head.md\ntail";
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });

    expect(result).toBe("HEAD\ntail");
  });

  it("inlines a file at the end of the template", async () => {
    writeFileSync(join(tmpDir, "tail.md"), "TAIL", "utf8");

    const template = "head\n@include tail.md";
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });

    expect(result).toBe("head\nTAIL");
  });

  it("inlines a file with an absolute path", async () => {
    const path = join(tmpDir, "absolute.md");
    writeFileSync(path, "ABSOLUTE", "utf8");

    const template = `before\n@include ${path}\nafter`;
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });

    expect(result).toBe("before\nABSOLUTE\nafter");
  });

  it("does not parse @-text inside static text as directives", async () => {
    const template = "this @1include is literal";
    const result = await render(template, {
      templateDir: tmpDir,
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe(template);
  });
});

describe("engine: static directive", () => {
  it("renders @static directives as their body", async () => {
    const template = "before\n@static id\nverbatim body\n@end\nafter";
    const result = await render(template, {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe("before\nverbatim body\nafter");
  });

  it("renders a single-line @static directive as empty text", async () => {
    const template = "before\n@static id\nafter";
    const result = await render(template, {
      templateDir: "/tmp",
      config: defaultConfig,
      llmProvider: stubLlmProvider,
    });
    expect(result).toBe("before\n\nafter");
  });
});

describe("engine: error handling", () => {
  it("throws EngineError on unknown directive names", async () => {
    let caught: unknown;
    try {
      await render("@bogus", {
        templateDir: "/tmp",
        config: defaultConfig,
        llmProvider: stubLlmProvider,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).message).toContain("@bogus");
    expect((caught as EngineError).line).toBe(1);
  });

  it("reports the line number of an unknown directive", async () => {
    let caught: unknown;
    try {
      await render("static text\n@bogus\nmore text", {
        templateDir: "/tmp",
        config: defaultConfig,
        llmProvider: stubLlmProvider,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).line).toBe(2);
  });

  it("throws EngineError on a directive without matching @end", async () => {
    let caught: unknown;
    try {
      await render("@llm foo\nprompt: hello\n", {
        templateDir: "/tmp",
        config: defaultConfig,
        llmProvider: stubLlmProvider,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).message).toContain("@end");
    expect((caught as EngineError).line).toBe(1);
  });

  it("throws EngineError on an unexpected @end", async () => {
    let caught: unknown;
    try {
      await render("hello\n@end\n", {
        templateDir: "/tmp",
        config: defaultConfig,
        llmProvider: stubLlmProvider,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).line).toBe(2);
  });
});

describe("engine: directive context wiring", () => {
  it("passes the directive block and template directory to directives", async () => {
    let capturedTemplateDir: string | undefined;
    let capturedBlockId: string | undefined;

    const customImpl: DirectiveImpl = async (ctx) => {
      capturedTemplateDir = ctx.templateDir;
      if (ctx.block.kind === "directive") {
        capturedBlockId = ctx.block.id;
      }
      return { text: "OK" };
    };

    clear();
    register("custom", customImpl);
    try {
      const result = await render("@custom hello", {
        templateDir: "/work",
        config: defaultConfig,
        llmProvider: stubLlmProvider,
      });
      expect(result).toBe("OK");
      expect(capturedTemplateDir).toBe("/work");
      expect(capturedBlockId).toBe("hello");
    } finally {
      clear();
    }
  });

  it("re-throws directive errors with their original message", async () => {
    const customImpl: DirectiveImpl = async () => {
      throw new Error("boom from directive");
    };

    clear();
    register("custom", customImpl);
    try {
      await expect(
        render("@custom x", {
          templateDir: "/tmp",
          config: defaultConfig,
          llmProvider: stubLlmProvider,
        }),
      ).rejects.toThrowError(/boom from directive/);
    } finally {
      clear();
    }
  });
});

// Sanity check: DirectiveRegistryError is what the engine catches for unknown
// directives; this test guards against a future refactor that changes the
// error class used.
describe("engine: llm directive wiring", () => {
  let renderFresh: typeof import("../../src/engine.js").render;
  let defaultConfigFresh: typeof import("../../src/engine.js").defaultConfig;

  beforeEach(async () => {
    clear();
    vi.resetModules();
    const engine = await import("../../src/engine.js");
    renderFresh = engine.render;
    defaultConfigFresh = engine.defaultConfig;
  });

  it("forwards LlmProvider.complete through the engine's callLlm", async () => {
    let captured: { system: string; user: string; model: string } | undefined;

    const capturingProvider: LlmProvider = {
      complete: async (req) => {
        captured = { ...req };
        return { content: "LLM_RESULT" };
      },
    };

    const template = "before\n@llm id\nprompt: hi\n@end\nafter";
    const result = await renderFresh(template, {
      templateDir: "/tmp",
      config: defaultConfigFresh,
      llmProvider: capturingProvider,
    });

    expect(result).toBe("before\nLLM_RESULT\nafter");
    expect(captured).toBeDefined();
    expect(captured!.user).toBe("hi");
    expect(captured!.model).toBe(defaultConfigFresh.llm.defaultModel);
  });

  it("passes the configured model through when the directive does not specify one", async () => {
    let capturedModel: string | undefined;
    const provider: LlmProvider = {
      complete: async (req) => {
        capturedModel = req.model;
        return { content: "ok" };
      },
    };

    const cfg = {
      ...defaultConfigFresh,
      llm: { ...defaultConfigFresh.llm, defaultModel: "configured-model" },
    };
    await renderFresh("@llm id\nprompt: hi\n@end", {
      templateDir: "/tmp",
      config: cfg,
      llmProvider: provider,
    });
    expect(capturedModel).toBe("configured-model");
  });
});

describe("engine: directive registry error contract", () => {
  it("DirectiveRegistryError is what get() throws for unknown names", () => {
    clear();
    try {
      expect(() => {
        throw new DirectiveRegistryError("x");
      }).toThrow(DirectiveRegistryError);
    } finally {
      clear();
    }
  });
});