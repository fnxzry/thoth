import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
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

d("@each directive with nested @llm (real network)", () => {
  it("renders @each with nested @llm per file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-llm-"));
    try {
      mkdirSync(join(tmpDir, "docs"), { recursive: true });
      writeFileSync(
        join(tmpDir, "docs", "alpha.md"),
        "Alpha provides fast in-memory key-value storage.",
        "utf8",
      );
      writeFileSync(
        join(tmpDir, "docs", "beta.md"),
        "Beta is a load-balancing reverse proxy service.",
        "utf8",
      );

      const template =
        "# Doc Index\n\n" +
        "@each docs/*.md\n" +
        "## {{name}}\n\n" +
        "@llm\n" +
        "context:\n" +
        "  - {{path}}\n" +
        "prompt: |\n" +
        "  Summarize the above document in exactly one sentence.\n" +
        "@end\n\n" +
        "@end\n";

      const provider = new OpenAIProvider({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
      });

      const rendered = await render(template, {
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

      expect(rendered).toContain("# Doc Index");
      expect(rendered).toContain("## alpha.md");
      expect(rendered).toContain("## beta.md");
      // Should contain generated LLM summaries, not raw directives
      expect(rendered).not.toMatch(/^@each\b/m);
      expect(rendered).not.toMatch(/^@llm\b/m);
      expect(rendered).not.toMatch(/^@end\b/m);
      // The LLM output should be meaningfully present
      expect(rendered.length).toBeGreaterThan("# Doc Index\n\n## alpha.md\n\n\n## beta.md\n\n\n".length);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 120_000);

  it("renders @each with indexed list and LLM summaries", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-each-llm-index-"));
    try {
      mkdirSync(join(tmpDir, "files"), { recursive: true });
      writeFileSync(
        join(tmpDir, "files", "x.txt"),
        "X marks the spot where treasure is buried.",
        "utf8",
      );
      writeFileSync(
        join(tmpDir, "files", "y.txt"),
        "Y is the second letter of the alphabet.",
        "utf8",
      );

      const template =
        "@each files/*.txt\n" +
        "{{index}}. **{{name}}**\n\n" +
        "@llm\n" +
        "context:\n" +
        "  - {{path}}\n" +
        "prompt: |\n" +
        "  Write an 8-word summary of this document.\n" +
        "@end\n\n" +
        "@end\n";

      const provider = new OpenAIProvider({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
      });

      const rendered = await render(template, {
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

      expect(rendered).toContain("0.");
      expect(rendered).toContain("**x.txt**");
      expect(rendered).toContain("1.");
      expect(rendered).toContain("**y.txt**");
      expect(rendered).not.toMatch(/^@each\b/m);
      expect(rendered).not.toMatch(/^@llm\b/m);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 120_000);
});