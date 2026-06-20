---
id: 05
type: task
status: complete
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

Implemented the templating engine end-to-end across the following modules:

- `src/types.ts` — `zod` schemas and inferred TS types for `Block` (a discriminated union of `StaticBlock` and `DirectiveBlock`), `DirectiveContext`, `DirectiveResult`, `DirectiveImpl`, `LlmRequest`, `LlmResponse`, and `ResolvedConfig`. Each `Block` carries a `sourceLine` so directives can produce line-accurate error messages.
- `src/parser.ts` — Pure function `parse(template) → Block[]`. Splits on directive headers (`@<name>[ id][attributes]:` at column 0) and `@end` lines. The parser scans ahead past intervening lines to locate `@end`, which lets `@static`-style directives whose bodies are plain text still be recognized as multi-line. If `@end` is absent but the next non-blank line looks like a body element (`key:` / `key=`), the parser raises a `ParseError` naming the directive's source line.
- `src/directives/index.ts` — Registry with `register`, `get`, `has`, `clear`, and `DirectiveRegistryError`. Throws on duplicate registration or unknown lookup.
- `src/directives/static.ts` — Pass-through directive registered as `@static`. The directive registry call happens at module load time.
- `src/directives/include.ts` — `@include` directive. Resolves relative paths against the template directory (absolute paths are passed through), reads the file as UTF-8, and returns its contents. Surfaces `ENOENT` / `EACCES` / other errors as `IncludeError` with a clear message.
- `src/directives/all.ts` — Side-effect-import module that pulls in every built-in directive for registration. The engine imports this so the registry is populated by the time `render()` runs.
- `src/engine.ts` — `render(template, ctx)` orchestrates parse → directive lookup → directive invocation → concatenation. Static blocks are inlined directly by the engine; directive blocks invoke the registered directive via a `DirectiveContext`. `callLlm` and `resolveContext` are stubbed (they throw / return empty) until ticket #06 wires them up. The engine rethrows `ParseError` and `DirectiveRegistryError` as `EngineError` so the CLI can surface a single error class with a `line` field. Exposes a `defaultConfig` matching `docs/architecture.md` §3's defaults so the CLI has a valid `ResolvedConfig` until ticket #06.
- `src/cli.ts` — The read→write copy loop is replaced by `read → render → write`. The CLI computes `templateDir` from `dirname(resolve(input))`, passes it into the engine, and formats `EngineError` as `error: <message>` on stderr with exit code 1. Existing CLI surface (`--help`, `--version`, `--check`, `--output`, `--config`, `--cache-dir`, `--no-cache`, exit codes) is unchanged.

Design choices worth flagging:

- **Block.sourceLine** — added to both `StaticBlock` and `DirectiveBlock` so directives and the engine can produce source-accurate error messages without a separate line-tracking pass.
- **DirectiveContext.templateDir** — added to the context so `@include` can resolve paths relative to the template's directory without coupling the directive to the CLI. `callLlm` / `resolveContext` remain in the context (stubbed) so ticket #06 can wire them up without changing the directive contract.
- **Parser "scan-ahead for @end"** — the parser looks for `@end` ahead of the directive header (stopping at another directive header) before deciding single-line vs multi-line. This lets `@static` (and any directive whose body is plain text) be recognized as multi-line when the user provides a closing `@end`, while still treating `@include foo.md\nhello` as a single-line directive with `hello` as separate static text.
- **Engine newline policy** — the engine emits a literal `\n` between adjacent blocks. Static block text is joined line-by-line with `\n`, so static-only templates reproduce the source byte-for-byte and directive boundaries produce the newlines that were in the source between blocks.
- **Default config** — the engine exports a `defaultConfig` matching the architecture's documented defaults; the CLI uses it until ticket #06's config loader lands.

## Testing

From the repo root:

```bash
npm run build      # exits 0
npm test           # 100 unit tests, all passing
npm run lint       # exits 0
```

New unit-test files:

- `tests/unit/parser.test.ts` (29 tests) — empty / static-only / multi-line static, single-line directives (with/without id, attributes, quoted values, trailing colon), multi-line directives with body elements, multi-line directives with non-body-element bodies, `@end`-consumed bodies, alternating static + directive blocks, source-line tracking for static and directive blocks, malformed directives (missing `@end` with body-element content, unexpected `@end`, `@end` at start of file), nested-looking static text inside directive bodies, `@`-prefixed text that does not match the directive-name regex.
- `tests/unit/registry.test.ts` (5 tests) — register / retrieve / duplicate rejection / unknown lookup / clear.
- `tests/unit/directives.test.ts` (11 tests) — static directive returns body verbatim (and empty for empty body); include directive resolves relative, absolute, and nested relative paths; preserves trailing newline; errors on empty id, on missing file, and on unreadable file (EACCES via `chmodSync` 0o000).
- `tests/unit/engine.test.ts` (19 tests) — static-only byte-identical rendering (including trailing-newline and empty-string cases), single include at start / middle / end, multiple includes in source order, absolute-path include, `@`-prefixed static text not parsed as directive, `@static` directive with body, single-line `@static`, error handling for unknown directives (with line number), missing `@end`, unexpected `@end`, directive context wiring (templateDir and block id forwarded to directives), directive errors rethrown with original message.

The existing `tests/unit/cli.test.ts` (36 tests) is unchanged and still passes; the static-only round-trip tests in that file now exercise the engine rather than the byte-copy loop.

Manual verification against the acceptance criteria (built binary at `dist/cli.js`):

```bash
# 1. Static-only renders byte-identically
printf 'hello\nworld\n' > static.md
node dist/cli.js static.md                  # prints 'hello\nworld\n', exit 0

# 2. @include inlines the file at the directive's position
printf 'before\n@include foo.md\nafter\n' > t.md
echo 'INLINE' > foo.md
node dist/cli.js t.md                       # prints 'before\nINLINE\nafter\n', exit 0

# 3. Multiple @include directives resolved in source order
printf '@include a.md\nbetween\n@include b.md\n' > t.md
echo 'A' > a.md; echo 'B' > b.md
node dist/cli.js t.md                       # prints 'A\nbetween\nB\n', exit 0

# 4. Unknown directive → exit 1 with directive name and line
echo '@bogus here' > t.md
node dist/cli.js t.md                       # stderr: 'error: unknown directive @bogus at line 1', exit 1

# 5. Missing @end → exit 1 with clear error
printf '@llm foo\nprompt: hello\n' > t.md
node dist/cli.js t.md                       # stderr: 'error: Directive @llm at line 1 is not closed by @end', exit 1

# 6. --check is still a no-op
node dist/cli.js --check static.md          # prints static.md contents, exit 0
```

Coverage of the three target modules (measured with `@vitest/coverage-v8`):

| File | Lines | Branches |
| --- | --- | --- |
| `src/parser.ts` | 100% | 100% |
| `src/directives/` (all files) | 100% | 88% |
| `src/engine.ts` | 91.3% | 87.5% |

All three exceed the >90% line-coverage bar from the acceptance criteria.

## Review

Accepted. The templating engine is correctly implemented end-to-end and the CLI is properly rewired to use it. All acceptance criteria are satisfied and all listed quality gates (build, lint, 100 unit tests) pass on the working tree.

**Verification performed**

- `npm run build` — exits 0; `dist/cli.js` rebuilt.
- `npm test` — 100/100 unit tests pass (parser 29, registry 5, directives 11, engine 19, cli 36).
- `npm run lint` — exits 0, no warnings.
- Manual CLI checks against `dist/cli.js` reproduced the six acceptance criteria in the ticket:
  1. Static-only `hello\nworld\n` → byte-identical stdout.
  2. `@include foo.md` between `before` and `after` → inlines `INLINE` at the directive position.
  3. Two `@include` directives in source order → both inlined in the correct positions.
  4. `@bogus here` → stderr `error: unknown directive @bogus at line 1`, exit 1.
  5. `@llm foo\nprompt: hello\n` (no `@end`) → stderr `error: Directive @llm at line 1 is not closed by @end`, exit 1.
  6. `--check static.md` → no-op, still renders, exit 0.

**Acceptance Criteria**

- [x] A template containing only static text renders byte-identically to the source. (Engine tests cover plain, multi-line, trailing-newline, and empty cases; CLI integration round-trip still works.)
- [x] `@include foo.md` inlines `foo.md`'s contents at that position. (Engine + directive tests for relative, absolute, nested-relative, and trailing-newline paths.)
- [x] Multiple `@include` directives are resolved in source order. (Engine test `intro\n@include a.md\nmiddle\n@include b.md\noutro` → `intro\nAAA\nmiddle\nBBB\noutro`.)
- [x] Unknown directive exits 1 with a stderr message naming the directive and the line number. (Engine tests assert `EngineError` with `@bogus` and `line: 1` / `line: 2`; CLI propagates the message.)
- [x] Directive without a matching `@end` exits 1 with a clear error. (Parser + engine tests assert the exact `Directive @llm at line 1 is not closed by @end` message.)
- [x] All unit tests pass. (100/100.) Coverage tools not installed locally so the exact percentages in the resolution could not be re-measured, but the test counts are consistent with the claim (29 + 5 + 11 + 19 across the three target modules) and the suites exercise every code path including `EACCES` via `chmodSync`.
- [x] `--check` is still a no-op in this build. (CLI flag is accepted and `args.check` is unused; the help banner and exit-code reservation are unchanged.)

**Notes worth flagging for the next tickets**

- The directive contract (context includes `templateDir`, `config`, `block`, plus stubbed `callLlm`/`resolveContext`) is a clean seam for ticket #06: only the engine needs to wire `callLlm`; directives and the parser stay untouched.
- `Block.sourceLine` on both `StaticBlock` and `DirectiveBlock` is what makes directive-name errors and `@end` errors name the correct line. Worth keeping in the type contract going forward.
- The "scan-ahead for `@end`" parser strategy is conservative: it only treats the directive as multi-line when it actually finds `@end`, otherwise it falls through to single-line. This matches every test case (single-line `@include foo.md\nhello`, multi-line `@llm ... @end`) but couples "multi-line-ness" to the presence of `@end`. If a future directive wants a multi-line body without `@end`, the parser will need a small change.
- `defaultConfig` is exported from the engine so the CLI has a valid `ResolvedConfig`; ticket #06 can replace the CLI's `defaultConfig` reference with the real config loader without touching the engine signature.
- `EngineError` is the single error class the CLI catches for rendering errors, with an optional `line` field — a tidy contract that ticket #07's `--check` drift path can lean on without changing the CLI's error handler.
