import { describe, expect, it } from "vitest";
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render } from "../../src/engine.js";
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

d("cache hit reproduces byte-identical output across two runs (real network)", () => {
  it("first run populates the cache; second run hits the cache and reproduces output", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "thoth-cache-llm-"));
    try {
      const cacheDir = ".doc-cache";
      const templatePath = join(tmpDir, "template.md");
      writeFileSync(
        templatePath,
        [
          "# Cache Test",
          "",
          "@llm:cached-block",
          "prompt: |",
          "  Reply with exactly the word 'cached' and nothing else.",
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

      const config: ResolvedConfig = {
        cacheDir,
        llm: {
          provider: "openai",
          apiKey: env.apiKey,
          baseUrl: env.baseUrl,
          defaultModel: env.model,
        },
        cache: { enabled: true },
      };

      const text = readFileSync(templatePath, "utf8");

      const first = await render(text, {
        templateDir: tmpDir,
        config,
        llmProvider: provider,
      });

      const cacheRoot = join(tmpDir, cacheDir);
      const entryDirs = readdirSync(cacheRoot);
      expect(entryDirs.length).toBeGreaterThan(0);

      const second = await render(text, {
        templateDir: tmpDir,
        config,
        llmProvider: provider,
      });

      expect(second).toBe(first);
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});