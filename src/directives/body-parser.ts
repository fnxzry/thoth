const ATTR_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const ATTR_LINE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;
const CONTEXT_ITEM_PATTERN = /^\s+-\s+(.+?)\s*$/;

const ESCAPE_MAP: Record<string, string> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  t: "\t",
  r: "\r",
};

export interface ParsedDirectiveBody {
  yamlParams: Record<string, string>;
  primaryContent: string;
  contextPaths: string[];
  asMapping: Record<string, string>;
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

function processYamlValue(rawValue: string, sourceLine?: number): string {
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith('"')) return trimmed;

  const inner = trimmed.slice(1);
  const result: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"') {
      return result.join("");
    }
    if (ch === "\\") {
      i++;
      if (i >= inner.length) {
        throw new BodyParserError(
          sourceLine !== undefined
            ? `Unterminated escape sequence in quoted string at source line ${sourceLine}`
            : "Unterminated escape sequence in quoted string",
          { line: sourceLine },
        );
      }
      const escaped = inner[i];
      const mapped = ESCAPE_MAP[escaped];
      if (mapped !== undefined) {
        result.push(mapped);
      } else {
        result.push("\\", escaped);
      }
      i++;
      continue;
    }
    result.push(ch);
    i++;
  }

  throw new BodyParserError(
    sourceLine !== undefined
      ? `Unterminated quoted string at source line ${sourceLine}`
      : "Unterminated quoted string",
    { line: sourceLine },
  );
}

function parseYamlSection(
  raw: string,
  sourceLine?: number,
): { attrs: Record<string, string>; contextPaths: string[]; asMapping: Record<string, string> } {
  if (raw === "") return { attrs: {}, contextPaths: [], asMapping: {} };

  const lines = raw.split("\n");
  const attrs: Record<string, string> = {};
  const contextPaths: string[] = [];
  const asMapping: Record<string, string> = {};
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

    if (key === "as") {
      if (rawValue.trim() !== "") {
        throw new BodyParserError(
          sourceLine !== undefined
            ? `"as:" at source line ${sourceLine} must be followed by key: value pairs`
            : `"as:" must be followed by key: value pairs`,
          { line: sourceLine },
        );
      }
      i++;
      while (i < lines.length) {
        const asLine = lines[i];
        if (asLine.trim() === "") {
          i++;
          continue;
        }
        if (!/^\s/.test(asLine)) break;
        const trimmed = asLine.trim();
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) {
          throw new BodyParserError(
            sourceLine !== undefined
              ? `Invalid as: entry at source line ${sourceLine}: ${JSON.stringify(trimmed)}`
              : `Invalid as: entry: ${JSON.stringify(trimmed)}`,
            { line: sourceLine },
          );
        }
        const asKey = trimmed.slice(0, colonIdx).trim();
        const asValue = trimmed.slice(colonIdx + 1).trim();
        if (!asKey || !asValue) {
          throw new BodyParserError(
            sourceLine !== undefined
              ? `Invalid as: entry at source line ${sourceLine}: ${JSON.stringify(trimmed)}`
              : `Invalid as: entry: ${JSON.stringify(trimmed)}`,
            { line: sourceLine },
          );
        }
        asMapping[asKey] = asValue;
        i++;
      }
      continue;
    }

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

    if (rawValue === "") {
      i++;
      const nestedLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          nestedLines.push("");
          i++;
          continue;
        }
        if (!/^\s/.test(l)) break;
        nestedLines.push(l.trim());
        i++;
      }
      if (nestedLines.length > 0) {
        attrs[key] = nestedLines.join("\n");
      } else {
        attrs[key] = "";
      }
      continue;
    }

    if (rawValue === "|" || rawValue === ">") {
      let peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === "") peek++;
      const nextNonBlank = peek < lines.length ? lines[peek] : null;

      if (nextNonBlank === null || !/^\s+\S/.test(nextNonBlank)) {
        attrs[key] = rawValue;
        i++;
        continue;
      }

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

    attrs[key] = processYamlValue(rawValue, sourceLine);
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

  return { attrs, contextPaths, asMapping };
}

export function validateAsMapping(
  mapping: Record<string, string>,
  canonicalNames: Set<string>,
  sourceLine?: number,
): void {
  for (const [key, value] of Object.entries(mapping)) {
    if (!canonicalNames.has(key)) {
      throw new BodyParserError(
        sourceLine !== undefined
          ? `Unknown canonical variable "${key}" in as: at source line ${sourceLine}`
          : `Unknown canonical variable "${key}" in as:`,
        { line: sourceLine },
      );
    }
    if (!ATTR_KEY_PATTERN.test(value)) {
      throw new BodyParserError(
        sourceLine !== undefined
          ? `Invalid identifier "${value}" in as: at source line ${sourceLine}`
          : `Invalid identifier "${value}" in as:`,
        { line: sourceLine },
      );
    }
  }
}

export function resolveAsVar(
  mapping: Record<string, string> | undefined,
  canonical: string,
): string {
  if (mapping && mapping[canonical]) return mapping[canonical];
  return canonical;
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

    const { attrs: yamlParams, contextPaths, asMapping } = parseYamlSection(yamlSection, sourceLine);
    return { yamlParams, primaryContent, contextPaths, asMapping };
  }

  if (bodyStartsWithYamlAttr(rawBody)) {
    const { attrs: yamlParams, contextPaths, asMapping } = parseYamlSection(rawBody, sourceLine);
    return { yamlParams, primaryContent: "", contextPaths, asMapping };
  }

  return { yamlParams: {}, primaryContent: rawBody, contextPaths: [], asMapping: {} };
}