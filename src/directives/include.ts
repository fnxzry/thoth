import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { register } from "./index.js";
import { DirectiveImpl, DirectiveBlock } from "../types.js";

export class IncludeError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "IncludeError";
    this.line = line;
  }
}

const includeDirective: DirectiveImpl = async (ctx) => {
  const block = ctx.block as DirectiveBlock;
  const path = block.primaryParameter;
  if (!path) {
    throw new IncludeError(
      `@include at line ${block.sourceLine} has no path`,
      block.sourceLine,
    );
  }

  const resolvedPath = isAbsolute(path) ? path : resolve(ctx.templateDir, path);

  let text: string;
  try {
    text = await readFile(resolvedPath, { encoding: "utf8" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new IncludeError(
        `@include: file not found: ${resolvedPath}`,
        block.sourceLine,
      );
    }
    if (code === "EACCES") {
      throw new IncludeError(
        `@include: permission denied: ${resolvedPath}`,
        block.sourceLine,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new IncludeError(
      `@include: failed to read ${resolvedPath}: ${detail}`,
      block.sourceLine,
    );
  }

  return { text };
};

register("include", includeDirective);