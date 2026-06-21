---
id: 09
type: task
status: open
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