import { relative, basename, resolve } from "node:path";
import { readFile, glob, stat } from "node:fs/promises";
import { register } from "./index.js";
import { DirectiveImpl } from "../types.js";
import { parseDirectiveBody, validateAsMapping, resolveAsVar } from "./body-parser.js";
import { BodyParserError } from "./body-parser.js";

export class EachError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "EachError";
    this.line = line;
  }
}

const EACH_CANONICAL_NAMES = new Set(["path", "name", "content", "index"]);

function ensureString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

const eachDirective: DirectiveImpl = async (ctx) => {
  const pattern = ctx.primaryParameter || ensureString(ctx.params.pattern, "");
  if (!pattern) {
    throw new EachError(
      `@each at line ${ctx.sourceLine}: missing pattern (glob)`,
      ctx.sourceLine,
    );
  }

  try {
    validateAsMapping(ctx.asMapping, EACH_CANONICAL_NAMES, ctx.sourceLine);
  } catch (err) {
    if (err instanceof BodyParserError) {
      throw new EachError(err.message, ctx.sourceLine);
    }
    throw err;
  }

  const joinSep = ensureString(ctx.params.join, "\n");

  const parsed = parseDirectiveBody(ensureString(ctx.params.body, ""), ctx.sourceLine);
  const templateBody = parsed.primaryContent;

  const fullPattern = resolve(ctx.templateDir, pattern);
  const entries: string[] = [];
  for await (const entry of glob(fullPattern)) {
    const s = await stat(entry);
    if (!s.isFile()) continue;
    entries.push(entry.toString());
  }
  entries.sort();

  if (entries.length === 0) {
    return { text: "" };
  }

  if (!templateBody.trim()) {
    const parts: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const result = await ctx.renderTemplate("");
      parts.push(result.text);
    }
    return { text: parts.join(joinSep) };
  }

  const pathVar = resolveAsVar(ctx.asMapping, "path");
  const nameVar = resolveAsVar(ctx.asMapping, "name");
  const contentVar = resolveAsVar(ctx.asMapping, "content");
  const indexVar = resolveAsVar(ctx.asMapping, "index");

  const needsContent = templateBody.includes(`{{${contentVar}}}`);

  const parts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const filePath = entries[i];
    const relPath = relative(ctx.templateDir, filePath);
    const fileName = basename(filePath);

    let substituted = templateBody
      .replaceAll(`{{${pathVar}}}`, relPath)
      .replaceAll(`{{${nameVar}}}`, fileName)
      .replaceAll(`{{${indexVar}}}`, String(i));

    if (needsContent) {
      const content = await readFile(filePath, "utf8");
      substituted = substituted.replaceAll(`{{${contentVar}}}`, content);
    }

    const result = await ctx.renderTemplate(substituted);
    parts.push(result.text);
  }

  return { text: parts.join(joinSep) };
};

register("each", null, eachDirective);