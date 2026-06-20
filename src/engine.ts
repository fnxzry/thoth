import "./directives/all.js";

import { parse, ParseError } from "./parser.js";
import { DirectiveContext, ResolvedConfig } from "./types.js";
import { get as getDirective, DirectiveRegistryError } from "./directives/index.js";

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
        resolveContext: async () => new Map<string, string>(),
        callLlm: async () => {
          throw new EngineError(
            "callLlm is not implemented in this build",
          );
        },
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