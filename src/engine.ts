import "./directives/all.js";

import { isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { parse, ParseError } from "./parser.js";
import { DirectiveContext, ResolvedConfig } from "./types.js";
import { get as getDirective, DirectiveRegistryError } from "./directives/index.js";
import type { LlmProvider } from "./llm/provider.js";

export class EngineError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, opts: { line?: number } = {}) {
    super(message);
    this.name = "EngineError";
    this.line = opts.line;
  }
}

export interface RenderContext {
  templateDir: string;
  config: ResolvedConfig;
  llmProvider: LlmProvider;
}

export const defaultConfig: ResolvedConfig = {
  cacheDir: ".doc-cache",
  llm: {
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  cache: {
    enabled: true,
  },
};

async function loadContextFile(templateDir: string, path: string): Promise<string> {
  const resolved = isAbsolute(path) ? path : resolve(templateDir, path);
  return await readFile(resolved, { encoding: "utf8" });
}

export async function render(
  template: string,
  ctx: RenderContext,
): Promise<string> {
  let blocks;
  try {
    blocks = parse(template);
  } catch (err) {
    if (err instanceof ParseError) {
      throw new EngineError(err.message, { line: err.line });
    }
    throw err;
  }

  const parts: string[] = [];

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];

    if (block.kind === "static") {
      parts.push(block.text);
    } else {
      let directive;
      try {
        directive = getDirective(block.name);
      } catch (err) {
        if (err instanceof DirectiveRegistryError) {
          throw new EngineError(
            `unknown directive @${block.name} at line ${block.sourceLine}`,
            { line: block.sourceLine },
          );
        }
        throw err;
      }

      const directiveCtx: DirectiveContext = {
        block,
        resolveContext: async (paths) => {
          const out = new Map<string, string>();
          for (const p of paths) {
            out.set(p, await loadContextFile(ctx.templateDir, p));
          }
          return out;
        },
        callLlm: (req) => ctx.llmProvider.complete(req),
        config: ctx.config,
        templateDir: ctx.templateDir,
      };

      const result = await directive(directiveCtx);
      parts.push(result.text);
    }

    if (idx < blocks.length - 1) {
      parts.push("\n");
    }
  }

  return parts.join("");
}