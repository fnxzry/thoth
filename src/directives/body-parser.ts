const ATTR_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const ATTR_LINE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;
const CONTEXT_ITEM_PATTERN = /^\s+-\s+(.+?)\s*$/;

export interface ParsedDirectiveBody {
  yamlParams: Record<string, string>;
  primaryContent: string;
}

export class BodyParserError extends Error {
  public readonly line: number | undefined;

  constructor(message: string, opts: { line?: number } = {}) {
    super(message);
    this.name = "BodyParserError";
    this.line = opts.line;
  }
}

function findDelimiter(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "@---") return i;
  }
  return -1;
}

function doesLineLookLikeYaml(key: string): boolean {
  return ATTR_KEY_PATTERN.test(key);
}

function bodyStartsWithYamlAttr(body: string): boolean {
  const firstNonBlank = body.split("\n").find((l) => l.trim() !== "");
  if (!firstNonBlank) return false;
  const match = firstNonBlank.match(ATTR_LINE_PATTERN);
  if (!match) return false;
  return doesLineLookLikeYaml(match[1]);
}

function parseYamlSection(
  raw: string,
  sourceLine?: number,
): Record<string, string> {
  if (raw === "") return {};

  const lines = raw.split("\n");
  const attrs: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const match = line.match(ATTR_LINE_PATTERN);
    if (!match) {
      throw new BodyParserError(
        sourceLine !== undefined
          ? `Unexpected line in directive body at source line ${sourceLine}: ${JSON.stringify(line)}`
          : `Unexpected line in directive body: ${JSON.stringify(line)}`,
        { line: sourceLine },
      );
    }

    const key = match[1];
    const rawValue = match[2];

    if (key === "context") {
      if (rawValue.trim() !== "") {
        throw new BodyParserError(
          sourceLine !== undefined
            ? `"context:" at source line ${sourceLine} must be followed by a list of paths`
            : `"context:" must be followed by a list of paths`,
          { line: sourceLine },
        );
      }
      i++;
      while (i < lines.length) {
        const ctxLine = lines[i];
        const ctxMatch = ctxLine.match(CONTEXT_ITEM_PATTERN);
        if (ctxMatch) {
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
      const value = block.join("\n").replace(/\s+$/, "");
      attrs[key] = value;
      continue;
    }

    attrs[key] = rawValue.trim();
    i++;
  }

  for (const key of Object.keys(attrs)) {
    if (!ATTR_KEY_PATTERN.test(key)) {
      throw new BodyParserError(
        sourceLine !== undefined
          ? `Invalid attribute name at source line ${sourceLine}: ${key}`
          : `Invalid attribute name: ${key}`,
        { line: sourceLine },
      );
    }
  }

  return attrs;
}

export function parseDirectiveBody(
  rawBody: string,
  sourceLine?: number,
): ParsedDirectiveBody {
  const lines = rawBody.split("\n");
  const delimIndex = findDelimiter(lines);

  if (delimIndex >= 0) {
    const yamlSectionLines = lines.slice(0, delimIndex);
    const contentLines = lines.slice(delimIndex + 1);

    const yamlSection = yamlSectionLines.join("\n");
    const primaryContent = contentLines.join("\n");

    const yamlParams = parseYamlSection(yamlSection, sourceLine);
    return { yamlParams, primaryContent };
  }

  if (bodyStartsWithYamlAttr(rawBody)) {
    const yamlParams = parseYamlSection(rawBody, sourceLine);
    return { yamlParams, primaryContent: "" };
  }

  return { yamlParams: {}, primaryContent: rawBody };
}