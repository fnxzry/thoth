import { describe, expect, it } from "vitest";

import { parse, ParseError } from "../../src/parser.js";

describe("parse: static text only", () => {
  it("returns a single static block for an empty template", () => {
    const blocks = parse("");
    expect(blocks).toEqual([
      { kind: "static", text: "", sourceLine: 1 },
    ]);
  });

  it("returns a single static block for plain text", () => {
    const blocks = parse("hello world");
    expect(blocks).toEqual([
      { kind: "static", text: "hello world", sourceLine: 1 },
    ]);
  });

  it("preserves newlines in static text", () => {
    const blocks = parse("line one\nline two\nline three");
    expect(blocks).toEqual([
      { kind: "static", text: "line one\nline two\nline three", sourceLine: 1 },
    ]);
  });

  it("treats a leading @ as part of static text if not followed by a directive name", () => {
    const blocks = parse("@1notadirective just text");
    expect(blocks).toEqual([
      { kind: "static", text: "@1notadirective just text", sourceLine: 1 },
    ]);
  });

  it("treats @end as static text outside any directive as an error", () => {
    expect(() => parse("hello\n@end\n")).toThrowError(ParseError);
  });

  it("does not treat @<name> in the middle of a line as a directive", () => {
    const blocks = parse("text @1include foo.md more text");
    expect(blocks).toEqual([
      { kind: "static", text: "text @1include foo.md more text", sourceLine: 1 },
    ]);
  });
});

describe("parse: single-line directives", () => {
  it("recognizes a single-line directive with an id", () => {
    const blocks = parse("@include foo.md");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "include",
        id: "foo.md",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
    ]);
  });

  it("recognizes a single-line directive with no id", () => {
    const blocks = parse("@static");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "static",
        id: "",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
    ]);
  });

  it("captures key=value attributes on the header line", () => {
    const blocks = parse("@llm summary model=gpt-4o");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: { model: "gpt-4o" },
        body: "",
        sourceLine: 1,
      },
    ]);
  });

  it("supports quoted attribute values", () => {
    const blocks = parse('@llm summary model="gpt-4o-mini"');
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: { model: "gpt-4o-mini" },
        body: "",
        sourceLine: 1,
      },
    ]);
  });

  it("tolerates a trailing colon on the header line", () => {
    const blocks = parse("@include foo.md:");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "include",
        id: "foo.md",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
    ]);
  });
});

describe("parse: multi-line directives", () => {
  it("captures a body when the next non-blank line looks like an attribute", () => {
    const blocks = parse("@llm summary\nprompt: hello\n@end");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: {},
        body: "prompt: hello",
        sourceLine: 1,
      },
    ]);
  });

  it("captures multi-line body content", () => {
    const blocks = parse(
      "@llm summary\nprompt: |\n  line one\n  line two\n@end",
    );
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: {},
        body: "prompt: |\n  line one\n  line two",
        sourceLine: 1,
      },
    ]);
  });

  it("captures empty body when @end immediately follows the header", () => {
    const blocks = parse("@llm summary\n@end");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
    ]);
  });

  it("captures body content that is not a body element when @end is found", () => {
    const blocks = parse("@static id\nverbatim body\n@end");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "static",
        id: "id",
        attributes: {},
        body: "verbatim body",
        sourceLine: 1,
      },
    ]);
  });

  it("captures body with multiple non-body-element lines when @end is found", () => {
    const blocks = parse("@static id\nline one\nline two\n@end");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "static",
        id: "id",
        attributes: {},
        body: "line one\nline two",
        sourceLine: 1,
      },
    ]);
  });

  it("treats a directive as single-line when another directive appears before any @end", () => {
    const blocks = parse("@include a.md\n@include b.md");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "include",
        id: "a.md",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
      {
        kind: "directive",
        name: "include",
        id: "b.md",
        attributes: {},
        body: "",
        sourceLine: 2,
      },
    ]);
  });

  it("supports trailing whitespace and comments on @end", () => {
    const blocks = parse("@llm summary\nprompt: hi\n@end   # closing");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "llm",
        id: "summary",
        attributes: {},
        body: "prompt: hi",
        sourceLine: 1,
      },
    ]);
  });
});

describe("parse: combined blocks", () => {
  it("alternates static and directive blocks", () => {
    const blocks = parse("before\n@include foo.md\nafter");
    expect(blocks).toEqual([
      { kind: "static", text: "before", sourceLine: 1 },
      {
        kind: "directive",
        name: "include",
        id: "foo.md",
        attributes: {},
        body: "",
        sourceLine: 2,
      },
      { kind: "static", text: "after", sourceLine: 3 },
    ]);
  });

  it("returns blocks in source order with multiple directives", () => {
    const blocks = parse(
      "intro\n@include a.md\nmiddle\n@include b.md\noutro",
    );
    expect(blocks).toEqual([
      { kind: "static", text: "intro", sourceLine: 1 },
      {
        kind: "directive",
        name: "include",
        id: "a.md",
        attributes: {},
        body: "",
        sourceLine: 2,
      },
      { kind: "static", text: "middle", sourceLine: 3 },
      {
        kind: "directive",
        name: "include",
        id: "b.md",
        attributes: {},
        body: "",
        sourceLine: 4,
      },
      { kind: "static", text: "outro", sourceLine: 5 },
    ]);
  });

  it("treats a directive header that is followed by static text as single-line", () => {
    const blocks = parse("alpha\n@include foo.md\nbeta");
    expect(blocks).toEqual([
      { kind: "static", text: "alpha", sourceLine: 1 },
      {
        kind: "directive",
        name: "include",
        id: "foo.md",
        attributes: {},
        body: "",
        sourceLine: 2,
      },
      { kind: "static", text: "beta", sourceLine: 3 },
    ]);
  });

  it("treats a directive header followed by another directive as single-line", () => {
    const blocks = parse("@include a.md\n@include b.md");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "include",
        id: "a.md",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
      {
        kind: "directive",
        name: "include",
        id: "b.md",
        attributes: {},
        body: "",
        sourceLine: 2,
      },
    ]);
  });

  it("reports the correct source line for nested-looking static text inside a body", () => {
    const blocks = parse(
      "@llm summary\nprompt: |\n  This body has @include foo.md inside.\n@end",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "directive",
      name: "llm",
      sourceLine: 1,
      body: "prompt: |\n  This body has @include foo.md inside.",
    });
  });
});

describe("parse: errors", () => {
  it("reports the source line for a missing @end", () => {
    expect(() => parse("@llm summary\nprompt: hello\n")).toThrowError(ParseError);
    try {
      parse("@llm summary\nprompt: hello\n");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(1);
      expect((err as ParseError).message).toContain("@llm");
      expect((err as ParseError).message).toContain("@end");
    }
  });

  it("does not error on missing @end when the next non-blank line is not a body element", () => {
    const blocks = parse("@include foo.md\nhello");
    expect(blocks).toEqual([
      {
        kind: "directive",
        name: "include",
        id: "foo.md",
        attributes: {},
        body: "",
        sourceLine: 1,
      },
      { kind: "static", text: "hello", sourceLine: 2 },
    ]);
  });

  it("reports the source line for an unexpected @end", () => {
    try {
      parse("line one\n@end\n");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(2);
    }
  });

  it("reports the source line for an @end at the start of the file", () => {
    try {
      parse("@end");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(1);
    }
  });
});

describe("parse: sourceLine correctness", () => {
  it("reports the correct sourceLine for static blocks after directives", () => {
    const blocks = parse("\n\n@include foo.md\n\nrest");
    expect(blocks[0]).toMatchObject({ kind: "static", sourceLine: 1 });
    expect(blocks[1]).toMatchObject({
      kind: "directive",
      sourceLine: 3,
    });
    expect(blocks[2]).toMatchObject({ kind: "static", sourceLine: 4 });
  });

  it("reports the correct sourceLine for multi-line directive bodies", () => {
    const blocks = parse(
      "@llm summary\nprompt: |\n  multi\n  line\n@end",
    );
    expect(blocks[0]).toMatchObject({
      kind: "directive",
      name: "llm",
      sourceLine: 1,
    });
  });
});