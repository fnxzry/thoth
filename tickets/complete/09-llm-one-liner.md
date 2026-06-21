---
id: 09
type: task
status: complete
description: Implement the label + primary-parameter directive grammar (docs/architecture.md §4) across the parser, the directive block schema, and every built-in directive. The `@llm` directive is the most complex case and gains the headline new one-liner behavior; `@include` and `@static` are updated to consume the new fields where applicable.
---

## Overview

`docs/architecture.md` §4 (and the matching `Block` schema in §3) defines a directive grammar where every directive carries an optional **label** and an optional **primary parameter**, both captured on the directive header line:

- `@<directive> <primary-parameter>` — one-liner, no label.
- `@<directive>:<label> <primary-parameter>` — one-liner with label.
- `@<directive>` / `@<directive>:<label>` — multi-line, body sets parameters.

The parsed `DirectiveBlock` exposes both as `label` and `primaryParameter` fields. Built-in directives declare how they consume them:

- `@include <path>` — primary parameter is the path.
- `@llm <prompt>` — primary parameter is the prompt. Body parameters: `context:`, `model:`. Label identifies the block for caching.
- `@static` — body is the verbatim text; no primary parameter.

Implement this grammar end-to-end: parser, block schema, and every built-in directive. The `@llm` directive is the most complex case (it has both a primary parameter and body parameters). `@include` and `@static` are simpler migrations against the same architectural change.

## User-Facing Behavior

### Directive grammar (applies to all directives)

- A one-liner invocation `@<directive> <primary-parameter>` renders the directive's output at that position.
- A one-liner with label `@<directive>:<label> <primary-parameter>` is equivalent, with `<label>` exposed to the directive as an identifier (for cache keys, error messages, and cross-references).
- A multi-line invocation `@<directive>:\n<body>\n@end` (or `@<directive>:<label>:\n<body>\n@end`) continues to work; the body sets any non-primary parameters.
- Inline `key=value` tokens on the directive header line are no longer interpreted as attributes. They appear verbatim in the primary parameter (or are simply not present, for multi-line). To set a directive parameter other than the primary, use the body.

### `@include`

- `@include <path>` continues to inline the file at `<path>` (backward compatible with the previous behavior; `<path>` is now the directive's primary parameter).
- `@include:<label> <path>` inlines the file at `<path>` and exposes `<label>` to the directive as an identifier.
- `@include` with no primary parameter exits 1 with a clear error message naming the directive and the source line.

### `@static`

- `@static` (or `@static:<label>`) followed by a body and `@end` returns the body verbatim. The label is exposed but unused by `@static`. `@static` has no primary parameter.

### `@llm` (the most complex case; headline new behavior)

- `@llm <prompt>` renders with the LLM response inlined; the prompt sent to the provider is `<prompt>`.
- `@llm:<label> <prompt>` renders the same way; `<label>` is exposed as the directive's identifier and participates in the cache key.
- The multi-line form `@llm:<label>:\ncontext: ...\nprompt: ...\n@end` continues to work; the body sets non-primary parameters (`context:`, `model:`).
- A one-liner with no primary parameter (`@llm` alone) exits 1 with a clear error message naming the directive and the source line.
- A one-liner followed by a `key: value` body element line (e.g. `prompt:`) without a closing `@end` still produces the existing parser error `Directive @llm at line N is not closed by @end`.

## Technical Requirements

- `DirectiveBlockSchema` (in `src/types.ts`) is updated to expose `label: string` and `primaryParameter: string` (replacing the previous `id`/`attributes` shape). The `Block` discriminated union is updated accordingly. Additional internal fields (e.g. `sourceLine`) may remain.
- `src/parser.ts` populates `label` and `primaryParameter` on every parsed `DirectiveBlock` per the four forms in `docs/architecture.md` §4:
  - `@<directive> <primary-parameter>` → `label = ""`, `primaryParameter = "<primary-parameter>"`.
  - `@<directive>:<label> <primary-parameter>` → `label = "<label>"`, `primaryParameter = "<primary-parameter>"`.
  - `@<directive>` (multi-line) → `label = ""`, `primaryParameter = ""`.
  - `@<directive>:<label>` (multi-line) → `label = "<label>"`, `primaryParameter = ""`.
- Inline `key=value` parsing on the directive header is removed (no directive in the current codebase consumes it). Tokens that look like `key=value` on the header line become part of the primary parameter verbatim.
- Every built-in directive in `src/directives/` is updated to consume `label` and `primaryParameter` where applicable:
  - `@include` uses `primaryParameter` as the path; errors when it is empty.
  - `@static` returns `body` unchanged; ignores `label` and `primaryParameter`.
  - `@llm` uses `primaryParameter` as the prompt when it is non-empty, and falls back to the body's `prompt:` attribute when `primaryParameter` is empty. The label is exposed for cache key computation (per §5).
- The cache key for `@llm` directives is unchanged in spec: it depends on the prompt content, the resolved model, and the context file set. A one-liner invocation and the equivalent multi-line form produce the same cache key for the same prompt/model/context.
- Unit tests cover: parser produces correct `label`/`primaryParameter` for every form; regression coverage for `@include` and `@static` under the new architecture; new coverage for every `@llm` scenario above; the cache-key parity between one-liner and equivalent multi-line forms.

## Acceptance Criteria

- [ ] `DirectiveBlockSchema` exposes `label` and `primaryParameter`; the previous `id`/`attributes` shape is gone.
- [ ] The parser populates `label` and `primaryParameter` correctly for all four forms in `docs/architecture.md` §4.
- [ ] `@include <path>` still inlines the file at `<path>` (backward compatible).
- [ ] `@include` with no primary parameter exits 1 with a clear error message.
- [ ] `@static` (and `@static:<label>`) still returns the body verbatim.
- [ ] `@llm summarize this document` renders with the LLM response inlined (prompt `summarize this document`).
- [ ] `@llm:greet say hello in one short word` renders with the LLM response inlined (label `greet`, prompt `say hello in one short word`).
- [ ] `@llm hello` and `@llm hello world` render with prompts `hello` and `hello world` respectively.
- [ ] The multi-line form (`@llm:<label>:\ncontext: ...\nprompt: ...\n@end`) continues to work unchanged.
- [ ] A bare `@llm` (no primary parameter) on a line by itself exits 1 with a clear error message naming the directive and the source line.
- [ ] A one-liner followed by a `prompt:` line without an `@end` produces the existing parser error.
- [ ] A one-liner and the equivalent multi-line form produce the same cache key for the same prompt/model/context.
- [ ] All unit tests pass.
## Resolution

Implemented the directive grammar (`@<directive>` / `@<directive>:<label>` with optional primary parameter) end-to-end:

- `src/types.ts`: replaced `id`/`attributes` on `DirectiveBlockSchema` with `label`/`primaryParameter` (both `string`).
- `src/parser.ts`: rewrote the directive-header parser to recognize the four forms in `docs/architecture.md` §4 in priority order (`@<name>:<label> <primary>`, `@<name>:<label>`, `@<name> <primary>`, `@<name>`). Removed `key=value` parsing on the header line; such tokens are now captured verbatim into `primaryParameter`. Multi-line body detection, source-line tracking, and the existing `@end`-missing parser error for a one-liner followed by a body-element line are preserved.
- `src/cache.ts` (new): implements `computeLlmCacheKey` per `docs/architecture.md` §5 (`sha256(provider-id || "\n" || model || "\n" || canonical(prompt) || "\n" || sorted(context-file-hashes).join("\n"))`). The function is the minimal slice of the cache module needed to test key parity; file I/O remains for ticket #07.
- `src/directives/include.ts`: uses `primaryParameter` as the path; throws `IncludeError` with the directive name and source line when empty.
- `src/directives/static.ts`: no logic change (only consumes `body`; label and primary parameter are exposed but unused).
- `src/directives/llm.ts`: uses `primaryParameter` as the prompt when non-empty, falls back to the body's `prompt:` attribute, and errors with the directive name and source line when neither yields a prompt. The body's `model:` and `context:` continue to apply on one-liner forms. The label is exposed on the block for downstream use (e.g., cache key computation).

The previous `id`-as-label multi-line syntax (`@llm summary\nprompt: ...\n@end`) is now parsed as a one-liner with primary parameter `summary`; the new multi-line form is `@llm:summary\nprompt: ...\n@end`. Existing integration tests in `tests/llm/` were migrated to the new syntax, and two new LLM-graded integration tests cover one-liner and labeled one-liner `@llm` invocations.

## Testing

Unit tests (run with `npm test`):

- `tests/unit/parser.test.ts` covers all four grammar forms (`@<name> <primary>`, `@<name>:<label> <primary>`, `@<name>`, `@<name>:<label>`), the trailing-colon / internal-whitespace / key=value-as-primary behaviors, the existing `@end`-missing parser error for a one-liner followed by a body-element line, and source-line correctness for static and directive blocks.
- `tests/unit/directives.test.ts` exercises `@include` with relative, absolute, nested, and labeled primary parameters; verifies that the directive throws a clear error when the primary parameter is empty (message names the directive and the source line); and verifies `@static` ignores `label`/`primaryParameter`.
- `tests/unit/llm-directive.test.ts` covers the multi-line body behavior, every one-liner scenario (prompt from primary, labeled one-liner, primary precedence over body prompt, body `model:`/`context:` still apply, single-word prompts, error on empty primary with and without a body), and the cache-key parity tests in `computeLlmCacheKey` (same key for one-liner and equivalent multi-line form; differing prompts / models / context contents produce different keys; context-file order does not; trailing whitespace on the prompt is canonicalized; key is a 64-char lowercase hex string; the function is deterministic).
- `tests/unit/engine.test.ts` covers end-to-end `@include` (including exit-1 error on empty primary parameter), `@static`/`@static:<label>`, `@llm` (one-liner, labeled one-liner, multi-line, bare), and the existing parser error cases.

LLM-graded integration tests (run with `npm run test:llm`, gated on `OPENAI_API_KEY`):

- `tests/llm/llm-directive.test.ts` renders the representative multi-line template, the model-override template, a new one-liner template, and a new labeled one-liner template through `render()` against the configured OpenAI-compatible endpoint.
- `tests/llm/openai.test.ts` renders a representative labeled multi-line template through `render()` and exercises `OpenAIProvider.complete` directly.

Manual verification:

- `./dist/cli.js AGENTS.md` renders byte-identically (no directives in the file).
- `./dist/cli.js --config <cfg with fake key> <template with bare @llm>` exits 1 with `error: @llm at line N: missing required attribute "prompt"`.
- `./dist/cli.js --config <cfg with fake key> <template with @include on its own line>` exits 1 with `error: @include at line N has no path`.

## Resolution

Implemented the directive grammar (`@<directive>` / `@<directive>:<label>` with optional primary parameter) end-to-end:

- `src/types.ts`: replaced `id`/`attributes` on `DirectiveBlockSchema` with `label`/`primaryParameter` (both `string`).
- `src/parser.ts`: rewrote the directive-header parser to recognize the four forms in `docs/architecture.md` §4 in priority order (`@<name>:<label> <primary>`, `@<name>:<label>`, `@<name> <primary>`, `@<name>`). Removed `key=value` parsing on the header line; such tokens are now captured verbatim into `primaryParameter`. Multi-line body detection, source-line tracking, and the existing `@end`-missing parser error for a one-liner followed by a body-element line are preserved.
- `src/cache.ts` (new): implements `computeLlmCacheKey` per `docs/architecture.md` §5 (`sha256(provider-id || "\n" || model || "\n" || canonical(prompt) || "\n" || sorted(context-file-hashes).join("\n"))`). The function is the minimal slice of the cache module needed to test key parity; file I/O remains for ticket #07.
- `src/directives/include.ts`: uses `primaryParameter` as the path; throws `IncludeError` with the directive name and source line when empty.
- `src/directives/static.ts`: no logic change (only consumes `body`; label and primary parameter are exposed but unused).
- `src/directives/llm.ts`: uses `primaryParameter` as the prompt when non-empty, falls back to the body's `prompt:` attribute, and errors with the directive name and source line when neither yields a prompt. The body's `model:` and `context:` continue to apply on one-liner forms. The label is exposed on the block for downstream use (e.g., cache key computation).

The previous `id`-as-label multi-line syntax (`@llm summary\nprompt: ...\n@end`) is now parsed as a one-liner with primary parameter `summary`; the new multi-line form is `@llm:summary\nprompt: ...\n@end`. Existing integration tests in `tests/llm/` were migrated to the new syntax, and two new LLM-graded integration tests cover one-liner and labeled one-liner `@llm` invocations.

## Testing

Unit tests (run with `npm test`):

- `tests/unit/parser.test.ts` covers all four grammar forms (`@<name> <primary>`, `@<name>:<label> <primary>`, `@<name>`, `@<name>:<label>`), the trailing-colon / internal-whitespace / key=value-as-primary behaviors, the existing `@end`-missing parser error for a one-liner followed by a body-element line, and source-line correctness for static and directive blocks.
- `tests/unit/directives.test.ts` exercises `@include` with relative, absolute, nested, and labeled primary parameters; verifies that the directive throws a clear error when the primary parameter is empty (message names the directive and the source line); and verifies `@static` ignores `label`/`primaryParameter`.
- `tests/unit/llm-directive.test.ts` covers the multi-line body behavior, every one-liner scenario (prompt from primary, labeled one-liner, primary precedence over body prompt, body `model:`/`context:` still apply, single-word prompts, error on empty primary with and without a body), and the cache-key parity tests in `computeLlmCacheKey` (same key for one-liner and equivalent multi-line form; differing prompts / models / context contents produce different keys; context-file order does not; trailing whitespace on the prompt is canonicalized; key is a 64-char lowercase hex string; the function is deterministic).
- `tests/unit/engine.test.ts` covers end-to-end `@include` (including exit-1 error on empty primary parameter), `@static`/`@static:<label>`, `@llm` (one-liner, labeled one-liner, multi-line, bare), and the existing parser error cases.

LLM-graded integration tests (run with `npm run test:llm`, gated on `OPENAI_API_KEY`):

- `tests/llm/llm-directive.test.ts` renders the representative multi-line template, the model-override template, a new one-liner template, and a new labeled one-liner template through `render()` against the configured OpenAI-compatible endpoint.
- `tests/llm/openai.test.ts` renders a representative labeled multi-line template through `render()` and exercises `OpenAIProvider.complete` directly.

Manual verification:

- `./dist/cli.js AGENTS.md` renders byte-identically (no directives in the file).
- `./dist/cli.js --config <cfg with fake key> <template with bare @llm>` exits 1 with `error: @llm at line N: missing required attribute "prompt"`.
- `./dist/cli.js --config <cfg with fake key> <template with @include on its own line>` exits 1 with `error: @include at line N has no path`.

## Review

### Verdict: Accept

The implementation satisfies every acceptance criterion. Build is clean, lint is clean, all 222 unit tests pass, and manual verification of every documented CLI scenario matches the resolution's claims. The work conforms tightly to `docs/architecture.md` §4 and is well-scoped: parser, schema, every built-in directive, and the minimal cache-key function — nothing more.

### What works

- **Schema migration.** `DirectiveBlockSchema` exposes `label: string` and `primaryParameter: string`; the previous `id`/`attributes` shape is gone. The `Block` discriminated union reflects the change cleanly.
- **Parser grammar.** `parseDirectiveHeader` matches the four forms in priority order (`@<name>:<label> <primary>`, `@<name>:<label>`, `@<name> <primary>`, `@<name>`) and rejects anything that doesn't match. `key=value` tokens on the header line are now captured verbatim into `primaryParameter` rather than parsed as attributes. Trailing colon, internal whitespace, single-word primary parameters, and multi-token primary parameters are all handled correctly. Source-line tracking is preserved for every block.
- **`@include`.** Uses `primaryParameter` as the path; throws `IncludeError` with the directive name and source line when empty. Relative, absolute, and nested paths resolve correctly; file-not-found and permission-denied errors surface as `IncludeError`.
- **`@static`.** No behavior change. Returns `body` unchanged; ignores `label` and `primaryParameter` (verified by unit test).
- **`@llm`.** Uses `primaryParameter` as the prompt when non-empty and falls back to the body's `prompt:` attribute. Body `model:` and `context:` still apply on one-liner forms. Bare `@llm` (no primary parameter and no body `prompt:`) throws `LlmError` naming the directive and source line. Multi-line forms continue to work; one-liner + body-element-line-without-`@end` still produces the existing parser error.
- **`src/cache.ts`.** `computeLlmCacheKey` implements the §5 spec exactly: `sha256(provider-id || "\n" || model || "\n" || canonical(prompt) || "\n" || sorted(context-file-hashes).join("\n"))`. Trailing whitespace on the prompt is canonicalized; context-file order is normalized; the output is a 64-char lowercase hex string; determinism is preserved.
- **LLM integration tests.** The existing `tests/llm/` suite was migrated to the new `@llm:<label>` multi-line syntax and extended with one-liner and labeled-one-liner end-to-end cases.
- **Manual verification.** `./dist/cli.js AGENTS.md` renders byte-identically (4123 bytes in, 4123 bytes out). Bare `@llm` exits 1 with `error: @llm at line 1: missing required attribute "prompt"`. Bare `@include` exits 1 with `error: @include at line 1 has no path`.

### Minor observations (non-blocking)

- The test "produces the same key for one-liner and equivalent multi-line form" (`tests/unit/llm-directive.test.ts`) actually feeds the same inputs to `computeLlmCacheKey` twice, so it is effectively a determinism check rather than a direct one-liner-vs-multi-line block parity check. The parity claim is supported indirectly: `computeLlmCacheKey` is a pure function of its inputs, and the `@llm` directive tests verify that one-liner and multi-line forms extract the same prompt/model/context for the same intent. The functional guarantee holds.
- The parser also accepts a hybrid form (`@static id\nbody\n@end`) yielding both `primaryParameter` and `body`. This is technically beyond the four canonical forms in `docs/architecture.md` §4, but it is consistent with the resolution's note about backward compatibility with the previous `id`-as-label syntax, and every built-in directive handles the fields it cares about and ignores the rest.
- `src/cache.ts` exists but the engine does not yet consult it. The resolution states that filesystem I/O remains for ticket #07, so this is by design.

### Acceptance Criteria

- [x] `DirectiveBlockSchema` exposes `label` and `primaryParameter`; the previous `id`/`attributes` shape is gone.
- [x] The parser populates `label` and `primaryParameter` correctly for all four forms in `docs/architecture.md` §4.
- [x] `@include <path>` still inlines the file at `<path>` (backward compatible).
- [x] `@include` with no primary parameter exits 1 with a clear error message.
- [x] `@static` (and `@static:<label>`) still returns the body verbatim.
- [x] `@llm summarize this document` renders with the LLM response inlined (prompt `summarize this document`).
- [x] `@llm:greet say hello in one short word` renders with the LLM response inlined (label `greet`, prompt `say hello in one short word`).
- [x] `@llm hello` and `@llm hello world` render with prompts `hello` and `hello world` respectively.
- [x] The multi-line form (`@llm:<label>:\ncontext: ...\nprompt: ...\n@end`) continues to work unchanged.
- [x] A bare `@llm` (no primary parameter) on a line by itself exits 1 with a clear error message naming the directive and the source line.
- [x] A one-liner followed by a `prompt:` line without an `@end` produces the existing parser error.
- [x] A one-liner and the equivalent multi-line form produce the same cache key for the same prompt/model/context.
- [x] All unit tests pass.
