---
id: 05
type: task
status: open
description: Implement the templating engine: core types, directive registry, `static` and `include` directives, and wire them into the CLI replacing the copy logic.
---

## Overview

Build the templating engine end-to-end for the directives that do not require an LLM. After this ticket, the CLI correctly handles static text (pass-through) and `@include` directives (verbatim file inclusion). The CLI's copy logic from ticket #04 is replaced by the parse → resolve → render pipeline.

## User-Facing Behavior

- A template containing only static text renders identically to its source.
- A template containing `@include <path>` directives renders with the referenced file's contents inlined at the directive's location.
- A template containing a malformed directive (e.g. unknown directive name, missing `@end`) prints a clear error to stderr identifying the source line and exits 1.

## Technical Requirements

- `src/types.ts` defines the `zod` schemas and inferred TS types for `Block`, `DirectiveContext`, `DirectiveResult`, `ResolvedConfig`, plus internal types for parser/directive use.
- `src/parser.ts` is a pure function that takes a template string and returns `Block[]`. It splits on directive headers (`@<name>[ <id>]` at the start of a line) and `@end` lines. Static text between directives is one block per region.
- `src/directives/index.ts` exposes a registry: `register(name: string, impl: DirectiveImpl)` and `get(name: string): DirectiveImpl`. Throws on duplicate registration or unknown name.
- `src/directives/static.ts` is a pass-through that returns the block's body unchanged. (Static text outside directive blocks is handled by the engine directly; this directive is registered so that `@static <id>: ... @end` is also recognized if used.)
- `src/directives/include.ts` reads the file at the path specified by the directive's id, relative to the template's directory, and returns its contents.
- `src/engine.ts` orchestrates parse → for each block, look up the directive and call it with a `DirectiveContext` → concatenate results → return the rendered string.
- `src/cli.ts`'s copy logic is replaced by a call to the engine. The CLI flags remain unchanged from ticket #04.
- Unit tests cover: parser (multiple blocks, nested-looking static text, malformed directives), directive registry, static directive, include directive (with both relative and absolute paths), engine pipeline end-to-end.
- File-system reads in unit tests use a temporary directory.

## Acceptance Criteria

- [ ] A template containing only static text renders byte-identically to the source.
- [ ] A template containing `@include foo.md` inlines `foo.md`'s contents at that position.
- [ ] A template with multiple `@include` directives resolves them all in order.
- [ ] A template containing an unknown directive (e.g. `@bogus`) exits 1 with a stderr message naming the directive and the line number.
- [ ] A template containing a directive without a matching `@end` exits 1 with a clear error.
- [ ] All unit tests pass; coverage of `src/parser.ts`, `src/directives/`, and `src/engine.ts` is high (>90%).
- [ ] `<T> --check` is still a no-op in this ticket; the full drift-detection behavior lands in ticket #07.

## Notes

The directive grammar is defined in `docs/architecture.md` §4. The block model from `docs/architecture.md` §3 is the contract for `Block`.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
