import { describe, expect, it, beforeAll } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenAIProvider } from "../../src/llm/openai.js";
import { render, defaultConfig } from "../../src/engine.js";
import { loadConfig } from "../../src/config.js";
import type { ResolvedConfig } from "../../src/types.js";

interface LlmTestEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

async function resolveTestEnv(): Promise<LlmTestEnv | undefined> {
  let config: ResolvedConfig;
  try {
    config = await loadConfig({ binaryName: "thoth" });
  } catch {
    return undefined;
  }
  if (!config.llm.apiKey) return undefined;
  return {
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    model: config.llm.defaultModel,
  };
}

const env = await resolveTestEnv();
const d = env ? describe : describe.skip;

d("OpenAIProvider (real network)", () => {
  beforeAll(() => {
    if (!env) {
      throw new Error(
        "LLM config not resolvable; the test should have been skipped",
      );
    }
  });

  it("produces a non-empty response for a simple prompt", async () => {
    const provider = new OpenAIProvider({
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
    });
    const response = await provider.complete({
      system: "You are a concise assistant. Respond with a single word.",
      user: "What is 2+2? Respond with only the number.",
      model: env.model,
    });
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content).toMatch(/4/);
  }, 60_000);

  it("renders a representative template through the configured provider via render()", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-render-"));
    try {
      const templatePath = join(tmpDir, "template.md");
      writeFileSync(
        templatePath,
        "@llm:greeter\nprompt: |\n  Say hello in exactly one word.\n@end\n",
        "utf8",
      );
      const provider = new OpenAIProvider({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
      });
      const text = readFileSync(templatePath, "utf8");
      const rendered = await render(text, {
        templateDir: tmpDir,
        config: {
          ...defaultConfig,
          llm: {
            ...defaultConfig.llm,
            apiKey: env.apiKey,
            baseUrl: env.baseUrl,
            defaultModel: env.model,
          },
        },
        llmProvider: provider,
      });
      expect(rendered.trim().length).toBeGreaterThan(0);
      expect(rendered.toLowerCase()).toMatch(/hello|hi|hey|greetings/);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});

describe("LlmProvider interface (live, gated)", () => {
  it("can be exercised end-to-end through render() with a real provider", async () => {
    if (!env) return;
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-render2-"));
    try {
      const templatePath = join(tmpDir, "t.md");
      writeFileSync(
        templatePath,
        "@llm:greet\nprompt: |\n  Reply with the word 'ok'.\n@end\n",
        "utf8",
      );
      const provider = new OpenAIProvider({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
      });
      const text = readFileSync(templatePath, "utf8");
      const rendered = await render(text, {
        templateDir: tmpDir,
        config: {
          ...defaultConfig,
          llm: {
            ...defaultConfig.llm,
            apiKey: env.apiKey,
            baseUrl: env.baseUrl,
            defaultModel: env.model,
          },
        },
        llmProvider: provider,
      });
      expect(rendered.length).toBeGreaterThan(0);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});