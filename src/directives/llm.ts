import { EngineError } from "../engine.js";
import { register } from "./index.js";
import { DirectiveImpl } from "../types.js";
import { computeLlmCacheKey } from "../cache.js";

export class LlmError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, opts: { line?: number } = {}) {
    super(message);
    this.name = "LlmError";
    this.line = opts.line;
  }
}

const llmDirective: DirectiveImpl = async (ctx) => {
  const prompt = String(ctx.params.prompt ?? "");
  if (!prompt) {
    throw new LlmError(
      `@llm at line ${ctx.sourceLine}: missing required attribute "prompt"`,
      { line: ctx.sourceLine },
    );
  }

  const contextPaths: string[] = Array.isArray(ctx.params.context) ? ctx.params.context : [];

  let contextFiles: Map<string, string>;
  try {
    contextFiles = await ctx.resolveContext(contextPaths);
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new LlmError(
      `@llm: failed to load context files: ${err instanceof Error ? err.message : String(err)}`,
      { line: ctx.sourceLine },
    );
  }

  let userPrompt = prompt;
  if (contextFiles.size > 0) {
    const sections: string[] = [];
    for (const [path, contents] of contextFiles) {
      sections.push(`----- ${path} -----\n${contents}`);
    }
    userPrompt = `${prompt}\n\n${sections.join("\n\n")}`;
  }

  const model = String(ctx.params.model ?? ctx.config.llm.defaultModel);

  if (model === "") {
    throw new LlmError(
      `@llm at line ${ctx.sourceLine}: empty "model" attribute`,
      { line: ctx.sourceLine },
    );
  }

  const request = {
    system: "You are a helpful assistant that produces concise, accurate output for documentation generation.",
    user: userPrompt,
    model,
  };

  if (ctx.cache && ctx.config.cache.enabled) {
    const key = computeLlmCacheKey({
      providerId: ctx.config.llm.provider,
      model,
      prompt,
      contextFiles,
    });
    const hit = await ctx.cache.get(key);
    if (hit !== null) {
      return { text: hit.content };
    }
  }

  let response;
  try {
    response = await ctx.callLlm(request);
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new LlmError(
      `@llm: provider call failed: ${err instanceof Error ? err.message : String(err)}`,
      { line: ctx.sourceLine },
    );
  }

  if (ctx.cache && ctx.config.cache.enabled) {
    const key = computeLlmCacheKey({
      providerId: ctx.config.llm.provider,
      model,
      prompt,
      contextFiles,
    });
    await ctx.cache.put(key, {
      content: response.content,
      ...(response.usage ? { usage: response.usage } : {}),
    });
  }

  return { text: response.content };
};

register("llm", "prompt", llmDirective);