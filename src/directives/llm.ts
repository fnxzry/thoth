import { EngineError } from "../engine.js";
import { register } from "./index.js";
import { DirectiveImpl, DirectiveBlock } from "../types.js";

export class LlmError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, opts: { line?: number } = {}) {
    super(message);
    this.name = "LlmError";
    this.line = opts.line;
  }
}

interface LlmBodySpec {
  prompt?: string;
  model?: string;
  contextPaths: string[];
}

const ATTR_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const CONTEXT_ITEM_PATTERN = /^\s*-\s+(.+?)\s*$/;

function parseBlockBody(body: string, sourceLine: number): LlmBodySpec {
  const lines = body.split("\n");
  const attrs: Record<string, string> = {};
  const contextPaths: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      throw new LlmError(
        `@llm at line ${sourceLine}: unexpected line in body: ${JSON.stringify(line)}`,
        { line: sourceLine },
      );
    }
    const key = match[1];
    const rawValue = match[2];

    if (key === "context") {
      if (rawValue.trim() !== "") {
        throw new LlmError(
          `@llm at line ${sourceLine}: "context:" must be followed by a list of paths`,
          { line: sourceLine },
        );
      }
      i++;
      while (i < lines.length) {
        const ctxLine = lines[i];
        const ctxMatch = ctxLine.match(CONTEXT_ITEM_PATTERN);
        if (ctxMatch) {
          contextPaths.push(ctxMatch[1]);
          i++;
          continue;
        }
        if (ctxLine.trim() === "") {
          i++;
          continue;
        }
        break;
      }
      continue;
    }

    if (rawValue === "|" || rawValue === ">") {
      const block: string[] = [];
      i++;
      const baseIndentMatch = lines[i]?.match(/^(\s*)\S/);
      const baseIndent = baseIndentMatch ? baseIndentMatch[1].length : 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          block.push("");
          i++;
          continue;
        }
        const indentMatch = l.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;
        if (indent < baseIndent) break;
        block.push(l.slice(baseIndent));
        i++;
      }
      const value = block
        .join("\n")
        .replace(/\s+$/, "");
      attrs[key] = value;
      continue;
    }

    attrs[key] = rawValue.trim();
    i++;
  }

  for (const key of Object.keys(attrs)) {
    if (!ATTR_KEY_PATTERN.test(key)) {
      throw new LlmError(
        `@llm at line ${sourceLine}: invalid attribute name: ${key}`,
        { line: sourceLine },
      );
    }
  }

  const model = attrs.model;
  if (model !== undefined && model === "") {
    throw new LlmError(
      `@llm at line ${sourceLine}: empty "model" attribute`,
      { line: sourceLine },
    );
  }

  return {
    prompt: attrs.prompt,
    model,
    contextPaths,
  };
}

const llmDirective: DirectiveImpl = async (ctx) => {
  const block = ctx.block as DirectiveBlock;
  const bodySpec = parseBlockBody(block.body, block.sourceLine);

  // Primary parameter (one-liner form) takes precedence over the body's
  // `prompt:` attribute. If neither yields a prompt, error.
  const prompt = block.primaryParameter || bodySpec.prompt;
  if (!prompt) {
    throw new LlmError(
      `@llm at line ${block.sourceLine}: missing required attribute "prompt"`,
      { line: block.sourceLine },
    );
  }

  let contextFiles: Map<string, string>;
  try {
    contextFiles = await ctx.resolveContext(bodySpec.contextPaths);
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

  const request = {
    system: "You are a helpful assistant that produces concise, accurate output for documentation generation.",
    user: userPrompt,
    model: bodySpec.model ?? ctx.config.llm.defaultModel,
  };

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

  return { text: response.content };
};

register("llm", llmDirective);