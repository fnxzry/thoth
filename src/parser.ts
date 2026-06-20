import { Block } from "./types.js";

export class ParseError extends Error {
  public readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = "ParseError";
    this.line = line;
  }
}

const NAME_PATTERN = "[a-zA-Z_][a-zA-Z0-9_-]*";
const HEADER_REGEX = new RegExp(`^@(${NAME_PATTERN})(?:[ \\t]+([^\\s]+))?(.*)?$`);
const END_REGEX = /^@end[ \t]*(?:#.*)?$/;
const DIRECTIVE_HEADER_REGEX = new RegExp(`^@(${NAME_PATTERN})(?:[ \\t]|$)`);
const BODY_ELEMENT_REGEX = new RegExp(`^\\s*(${NAME_PATTERN})[ \\t]*[:=]\\s*`);
const ATTR_REGEX = new RegExp(`(${NAME_PATTERN})=("(?:[^"\\\\]|\\\\.)*"|\\S+)`, "g");

function parseAttributes(rest: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  ATTR_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_REGEX.exec(rest)) !== null) {
    let value: string = m[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    attrs[m[1]] = value;
  }
  return attrs;
}

function isEnd(line: string): boolean {
  return END_REGEX.test(line);
}

function isDirectiveHeader(line: string): boolean {
  return DIRECTIVE_HEADER_REGEX.test(line);
}

function looksLikeBodyElement(line: string): boolean {
  return BODY_ELEMENT_REGEX.test(line);
}

export function parse(template: string): Block[] {
  const blocks: Block[] = [];
  const lines = template.split("\n");
  let i = 0;
  let staticBuffer: string[] = [];
  let staticStartLine = 1;

  const flushStatic = (): void => {
    if (staticBuffer.length > 0) {
      blocks.push({
        kind: "static",
        text: staticBuffer.join("\n"),
        sourceLine: staticStartLine,
      });
      staticBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const headerMatch = line.match(HEADER_REGEX);

    if (headerMatch && headerMatch[1] !== "end") {
      const name = headerMatch[1];
      const id = (headerMatch[2] ?? "").replace(/[:=]$/, "");
      const rest = (headerMatch[3] ?? "").trim();
      const attributes = parseAttributes(rest);
      const headerLine = i + 1;

      let scanEnd = -1;
      let j = i + 1;
      while (j < lines.length) {
        const scanLine = lines[j];
        if (isEnd(scanLine)) {
          scanEnd = j;
          break;
        }
        if (isDirectiveHeader(scanLine)) {
          break;
        }
        j++;
      }

      if (scanEnd !== -1) {
        const bodyLines: string[] = [];
        for (let m = i + 1; m < scanEnd; m++) {
          bodyLines.push(lines[m]);
        }

        flushStatic();
        blocks.push({
          kind: "directive",
          name,
          id,
          attributes,
          body: bodyLines.join("\n"),
          sourceLine: headerLine,
        });
        i = scanEnd + 1;
      } else {
        let k = i + 1;
        while (k < lines.length && lines[k].trim() === "") {
          k++;
        }
        const nextNonBlank = k < lines.length ? lines[k] : null;

        if (nextNonBlank !== null && looksLikeBodyElement(nextNonBlank)) {
          throw new ParseError(
            `Directive @${name} at line ${headerLine} is not closed by @end`,
            headerLine,
          );
        }

        flushStatic();
        blocks.push({
          kind: "directive",
          name,
          id,
          attributes,
          body: "",
          sourceLine: headerLine,
        });
        i++;
      }
    } else if (isEnd(line)) {
      throw new ParseError(`Unexpected @end at line ${i + 1}`, i + 1);
    } else {
      if (staticBuffer.length === 0) {
        staticStartLine = i + 1;
      }
      staticBuffer.push(line);
      i++;
    }
  }

  flushStatic();
  return blocks;
}