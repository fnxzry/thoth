import { describe, expect, it } from "vitest";
import { parseDirectiveBody, BodyParserError } from "../../src/directives/body-parser.js";

describe("parseDirectiveBody", () => {
  it("parses body with @--- delimiter: YAML params above, primary content below", () => {
    const result = parseDirectiveBody("model: gpt-4o\n@---\nSome prompt text");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("Some prompt text");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body without @--- that starts with YAML attr: full body is YAML params, no primary content", () => {
    const result = parseDirectiveBody("prompt: hi\nmodel: gpt-4o");
    expect(result.yamlParams).toEqual({ prompt: "hi", model: "gpt-4o" });
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body without @--- that does not start with YAML attr: full body is primary content", () => {
    const result = parseDirectiveBody("Summarize this file in two paragraphs.");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("Summarize this file in two paragraphs.");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body with only YAML params (no @---)", () => {
    const result = parseDirectiveBody("model: gpt-4o");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body with only primary content (no @---)", () => {
    const result = parseDirectiveBody("Some text here.");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("Some text here.");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses empty body", () => {
    const result = parseDirectiveBody("");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body where @--- appears in the first line", () => {
    const result = parseDirectiveBody("@---\nsome content");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("some content");
    expect(result.contextPaths).toEqual([]);
  });

  it("parses body where @--- delimiter is the only content", () => {
    const result = parseDirectiveBody("@---");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("handles YAML block scalar (|) above @---", () => {
    const result = parseDirectiveBody("prompt: |\n  line one\n  line two\n@---\nSome text");
    expect(result.yamlParams).toEqual({ prompt: "line one\nline two" });
    expect(result.primaryContent).toBe("Some text");
    expect(result.contextPaths).toEqual([]);
  });

  it("consumes context: list without storing in yamlParams", () => {
    const result = parseDirectiveBody("context:\n  - doc.md\n  - other.md\nmodel: gpt-4o");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual(["doc.md", "other.md"]);
  });

  it("handles context: list before @--- delimiter", () => {
    const result = parseDirectiveBody("context:\n  - doc.md\nmodel: gpt-4o\n@---\nSome prompt");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("Some prompt");
    expect(result.contextPaths).toEqual(["doc.md"]);
  });

  it("skips blank lines in YAML section", () => {
    const result = parseDirectiveBody("\n\nmodel: gpt-4o\n\nprompt: hi\n\n");
    expect(result.yamlParams).toEqual({ model: "gpt-4o", prompt: "hi" });
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("does not recognize indented @--- as delimiter", () => {
    const result = parseDirectiveBody("  @---\nsome text");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("  @---\nsome text");
    expect(result.contextPaths).toEqual([]);
  });

  it("treats body with leading whitespace before YAML attr as primary content (YAML attrs must be at column 0)", () => {
    const result = parseDirectiveBody("  \n  model: gpt-4o");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("  \n  model: gpt-4o");
    expect(result.contextPaths).toEqual([]);
  });

  it("treats body with leading whitespace before plain text as primary content", () => {
    const result = parseDirectiveBody("  \n  Some plain text.");
    expect(result.yamlParams).toEqual({});
    expect(result.primaryContent).toBe("  \n  Some plain text.");
    expect(result.contextPaths).toEqual([]);
  });

  it("handles block scalar with empty lines", () => {
    const result = parseDirectiveBody("prompt: |\n  line one\n\n  line two\n@---\n");
    expect(result.yamlParams).toEqual({ prompt: "line one\n\nline two" });
    expect(result.primaryContent).toBe("");
    expect(result.contextPaths).toEqual([]);
  });

  it("throws on unexpected line in YAML section", () => {
    expect(() => parseDirectiveBody("model: gpt-4o\nnot a yaml line")).toThrow(BodyParserError);
  });

  it("handles multi-line primary content below @---", () => {
    const result = parseDirectiveBody("model: gpt-4o\n@---\nline one\nline two\nline three");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("line one\nline two\nline three");
    expect(result.contextPaths).toEqual([]);
  });

  it("handles blank lines between @--- and primary content", () => {
    const result = parseDirectiveBody("model: gpt-4o\n@---\n\n\nsome content");
    expect(result.yamlParams).toEqual({ model: "gpt-4o" });
    expect(result.primaryContent).toBe("\n\nsome content");
    expect(result.contextPaths).toEqual([]);
  });

  it("includes sourceLine in error message when provided", () => {
    let caught: unknown;
    try {
      parseDirectiveBody("model: x\nbad line here", 42);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BodyParserError);
    expect((caught as Error).message).toContain("42");
  });

  describe("double-quoted string values", () => {
    it("strips surrounding double quotes from a YAML param value", () => {
      const result = parseDirectiveBody('join: " | "');
      expect(result.yamlParams).toEqual({ join: " | " });
      expect(result.primaryContent).toBe("");
    });

    it("strips surrounding double quotes from a YAML param value (with label)", () => {
      const result = parseDirectiveBody('prompt: "hello world"');
      expect(result.yamlParams).toEqual({ prompt: "hello world" });
      expect(result.primaryContent).toBe("");
    });

    it("interprets escaped newline in double-quoted string", () => {
      const result = parseDirectiveBody('join: "\\n"');
      expect(result.yamlParams).toEqual({ join: "\n" });
    });

    it("interprets escaped tab in double-quoted string", () => {
      const result = parseDirectiveBody('join: "\\t"');
      expect(result.yamlParams).toEqual({ join: "\t" });
    });

    it("interprets escaped backslash in double-quoted string", () => {
      const result = parseDirectiveBody('join: "\\\\"');
      expect(result.yamlParams).toEqual({ join: "\\" });
    });

    it("interprets escaped double quote in double-quoted string", () => {
      const result = parseDirectiveBody('join: "say \\"hi\\""');
      expect(result.yamlParams).toEqual({ join: 'say "hi"' });
    });

    it("handles empty double-quoted string", () => {
      const result = parseDirectiveBody('join: ""');
      expect(result.yamlParams).toEqual({ join: "" });
    });

    it("preserves plain (unquoted) values", () => {
      const result = parseDirectiveBody("join: , ");
      expect(result.yamlParams).toEqual({ join: "," });
    });

    it("preserves trailing spaces in quoted values", () => {
      const result = parseDirectiveBody('join: ", "');
      expect(result.yamlParams).toEqual({ join: ", " });
    });

    it("unquotes double-quoted value with @--- delimiter", () => {
      const result = parseDirectiveBody('join: " | "\n@---\ntemplate content');
      expect(result.yamlParams).toEqual({ join: " | " });
      expect(result.primaryContent).toBe("template content");
    });

    it("throws on unterminated double-quoted string", () => {
      expect(() => parseDirectiveBody('join: "unterminated')).toThrow(BodyParserError);
    });

    it("throws on unterminated double-quoted string with sourceLine", () => {
      let caught: unknown;
      try {
        parseDirectiveBody('join: "missing end', 10);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BodyParserError);
      expect((caught as Error).message).toMatch(/quote/i);
      expect((caught as Error).message).toContain("10");
    });

    it("throws on mixed quotes (starts with double, ends with single)", () => {
      expect(() => parseDirectiveBody('join: "mixed\'')).toThrow(BodyParserError);
    });
  });

  describe("pipe and angle-bracket as literal values", () => {
    it("stores | as a plain value when on the same line as the key", () => {
      const result = parseDirectiveBody("join: |");
      expect(result.yamlParams).toEqual({ join: "|" });
    });

    it("stores > as a plain value when on the same line as the key", () => {
      const result = parseDirectiveBody("join: >");
      expect(result.yamlParams).toEqual({ join: ">" });
    });

    it("stores | as literal even when followed by blank lines (no indented content)", () => {
      const result = parseDirectiveBody("join: |\n\n\nother: x");
      expect(result.yamlParams).toEqual({ join: "|", other: "x" });
    });

    it("stores > as literal when followed by another key", () => {
      const result = parseDirectiveBody("join: >\nother: value");
      expect(result.yamlParams).toEqual({ join: ">", other: "value" });
    });

    it("still handles | block scalar when indented content follows", () => {
      const result = parseDirectiveBody("prompt: |\n  line one\n  line two");
      expect(result.yamlParams).toEqual({ prompt: "line one\nline two" });
    });

    it("still handles > block scalar when indented content follows", () => {
      const result = parseDirectiveBody("prompt: >\n  line one\n  line two");
      expect(result.yamlParams).toEqual({ prompt: "line one\nline two" });
    });

    it("| block scalar with @--- delimiter still works", () => {
      const result = parseDirectiveBody("prompt: |\n  line one\n  line two\n@---\nSome text");
      expect(result.yamlParams).toEqual({ prompt: "line one\nline two" });
      expect(result.primaryContent).toBe("Some text");
    });
  });

  describe("edge cases", () => {
    it("handles whitespace-only quoted value", () => {
      const result = parseDirectiveBody('join: "   "');
      expect(result.yamlParams).toEqual({ join: "   " });
    });

    it("handles value containing unescaped quotes in the middle (not at boundaries)", () => {
      const result = parseDirectiveBody('text: hello "world"');
      expect(result.yamlParams).toEqual({ text: 'hello "world"' });
    });

    it("handles multiple escaped sequences in one value", () => {
      const result = parseDirectiveBody('join: "a\\nb\\tc"');
      expect(result.yamlParams).toEqual({ join: "a\nb\tc" });
    });

    it("handles quote-only value", () => {
      const result = parseDirectiveBody('join: "\\""');
      expect(result.yamlParams).toEqual({ join: '"' });
    });
  });
});