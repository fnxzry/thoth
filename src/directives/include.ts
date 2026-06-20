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
  const id = block.id;
  if (!id) {
    throw new IncludeError(
      `@include at line ${block.sourceLine} has no path`,
      block.sourceLine,
    );
  }

  const path = isAbsolute(id) ? id : resolve(ctx.templateDir, id);

  let text: string;
  try {
    text = await readFile(path, { encoding: "utf8" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new IncludeError(
        `@include: file not found: ${path}`,
        block.sourceLine,
      );
    }
    if (code === "EACCES") {
      throw new IncludeError(
        `@include: permission denied: ${path}`,
        block.sourceLine,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new IncludeError(
      `@include: failed to read ${path}: ${detail}`,
      block.sourceLine,
    );
  }

  return { text };
};

register("include", includeDirective);