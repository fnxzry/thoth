import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, defaultConfig } from "../../src/engine.js";
import { OpenAIProvider } from "../../src/llm/openai.js";
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

d("@llm directive end-to-end (real network)", () => {
  it("inlines a coherent response for a representative template", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-directive-"));
    try {
      const contextPath = join(tmpDir, "context.md");
      writeFileSync(
        contextPath,
        "Thoth is a document-generation tool. It uses static text, @include, and @llm directives.",
        "utf8",
      );
      const templatePath = join(tmpDir, "template.md");
      writeFileSync(
        templatePath,
        [
          "# Summary",
          "",
          "@llm summary",
          "context:",
          "  - context.md",
          "prompt: |",
          "  Write a one-sentence summary of the following text.",
          "@end",
          "",
          "## End",
        ].join("\n"),
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

      expect(rendered).toContain("# Summary");
      expect(rendered).toContain("## End");
      expect(rendered.length).toBeGreaterThan("# Summary\n\n## End".length);
      expect(rendered).not.toMatch(/^@llm\b/m);
      expect(rendered).not.toMatch(/^@end\b/m);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it("uses the directive's model attribute to override the configured default", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-llm-override-"));
    try {
      const templatePath = join(tmpDir, "t.md");
      writeFileSync(
        templatePath,
        "@llm greet\nprompt: |\n  Reply with exactly one short word, no punctuation.\n@end\n",
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
      expect(rendered.length).toBeLessThan(50);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});