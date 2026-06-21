import { EngineError } from "../engine.js";
import { register } from "./index.js";
import { DirectiveImpl, DirectiveBlock } from "../types.js";
import { computeLlmCacheKey } from "../cache.js";
import { parseDirectiveBody } from "./body-parser.js";

export class LlmError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, opts: { line?: number } = {}) {
    super(message);
    this.name = "LlmError";
    this.line = opts.line;
  }
}

const CONTEXT_ITEM_PATTERN = /^\s*-\s+(.+?)\s*$/;

function extractContextPaths(body: string): string[] {
  const lines = body.split("\n");
  const delimIdx = lines.findIndex((l) => l === "@---");
  const endIdx = delimIdx >= 0 ? delimIdx : lines.length;
  const paths: string[] = [];
  let inContext = false;

  for (let i = 0; i < endIdx; i++) {
    const line = lines[i];
    if (/^context\s*:/.test(line)) {
      inContext = true;
      continue;
    }
    if (inContext) {
      const match = line.match(CONTEXT_ITEM_PATTERN);
      if (match) {
        paths.push(match[1]);
        continue;
      }
      if (line.trim() === "") continue;
      inContext = false;
    }
  }

  return paths;
}

const llmDirective: DirectiveImpl = async (ctx) => {
  const block = ctx.block as DirectiveBlock;
  const { yamlParams, primaryContent } = parseDirectiveBody(block.body, block.sourceLine);
  const contextPaths = extractContextPaths(block.body);

  // Primary parameter takes precedence over primary content (body below
  // @--- or full body without YAML attrs), which takes precedence over
  // the `prompt:` YAML attribute.
  const prompt = block.primaryParameter || primaryContent || yamlParams.prompt;
  if (!prompt) {
    throw new LlmError(
      `@llm at line ${block.sourceLine}: missing required attribute "prompt"`,
      { line: block.sourceLine },
    );
  }

  let contextFiles: Map<string, string>;
  try {
    contextFiles = await ctx.resolveContext(contextPaths);
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new LlmError(
      `@llm: failed to load context files: ${err instanceof Error ? err.message : String(err)}`,
      { line: block.sourceLine },
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

  const model = yamlParams.model ?? ctx.config.llm.defaultModel;

  if (model === "") {
    throw new LlmError(
      `@llm at line ${block.sourceLine}: empty "model" attribute`,
      { line: block.sourceLine },
    );
  }

  const request = {
    system: "You are a helpful assistant that produces concise, accurate output for documentation generation.",
    user: userPrompt,
    model,
  };

  // Consult the cache (if enabled) before calling the provider. Cache key
  // is computed from the prompt attribute and context-file contents, so
  // changes to either invalidate the entry.
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
      { line: block.sourceLine },
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

register("llm", llmDirective);