import "./directives/all.js";

import { isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { parse, ParseError } from "./parser.js";
import { DirectiveContext, ResolvedConfig } from "./types.js";
import { get as getRegistration, DirectiveRegistryError } from "./directives/index.js";
import { parseDirectiveBody } from "./directives/body-parser.js";
import type { LlmProvider } from "./llm/provider.js";
import { LlmCache } from "./cache.js";

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
  cache?: LlmCache;
  warn?: (msg: string) => void;
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

  const cache = createCache(ctx);

  const parts: string[] = [];

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];

    if (block.kind === "static") {
      parts.push(block.text);
    } else {
      let registration;
      try {
        registration = getRegistration(block.name);
      } catch (err) {
        if (err instanceof DirectiveRegistryError) {
          throw new EngineError(
            `unknown directive @${block.name} at line ${block.sourceLine}`,
            { line: block.sourceLine },
          );
        }
        throw err;
      }

      const { impl, primaryKey } = registration;
      const parsed = parseDirectiveBody(block.body, block.sourceLine);
      const params: Record<string, string | string[]> = {
        ...parsed.yamlParams,
        body: block.body,
      };

      if (primaryKey !== null) {
        params[primaryKey] =
          block.primaryParameter || parsed.primaryContent || String(parsed.yamlParams[primaryKey] ?? "");
      }

      if (parsed.contextPaths.length > 0) {
        params.context = parsed.contextPaths;
      }

      const directiveCtx: DirectiveContext = {
        label: block.label,
        sourceLine: block.sourceLine,
        primaryParameter: block.primaryParameter,
        params,
        asMapping: parsed.asMapping,
        resolveContext: async (paths) => {
          const out = new Map<string, string>();
          for (const p of paths) {
            out.set(p, await loadContextFile(ctx.templateDir, p));
          }
          return out;
        },
        callLlm: (req) => ctx.llmProvider.complete(req),
        renderTemplate: async (template: string) => {
          const rendered = await render(template, ctx);
          return { text: rendered };
        },
        config: ctx.config,
        templateDir: ctx.templateDir,
        ...(cache ? { cache } : {}),
      };

      const result = await impl(directiveCtx);
      parts.push(result.text);
    }

    if (idx < blocks.length - 1) {
      parts.push("\n");
    }
  }

  return parts.join("");
}

function createCache(ctx: RenderContext): LlmCache | undefined {
  if (!ctx.config.cache.enabled) return undefined;
  const cacheDir = isAbsolute(ctx.config.cacheDir)
    ? ctx.config.cacheDir
    : resolve(ctx.templateDir, ctx.config.cacheDir);
  return new LlmCache({
    cacheDir,
    ...(ctx.warn ? { warn: ctx.warn } : {}),
  });
}