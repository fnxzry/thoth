---
id: 14
type: issue
status: complete
description: Refactor directive parameter parsing into a generic, reusable layer
---

## Overview

Directives currently obtain their parameters inconsistently:

- **`@include`** reads `block.primaryParameter` directly — simple and works because it only needs one parameter.
- **`@llm`** manually resolves the prompt from three sources (`primaryParameter`, `primaryContent`, `yamlParams.prompt`) and separately extracts `context` paths from the raw body with `extractContextPaths()`.
- **`@each`** (ticket #13) will need similar logic — resolve the glob pattern from `primaryParameter` or `yamlParams.pattern` and extract `as:` and `join:` from the body.

Each directive duplicating parameter-resolution logic is fragile and makes adding new directives harder than it should be. The parameter-parsing machinery should be generic, handled once, and directives should receive clean, pre-parsed parameters.

## Technical Requirements

### 1. Standardize primary-parameter resolution, injected under a directive-specific key

Create a shared utility that resolves the primary parameter from multiple sources and injects it into `params` under a key the directive declares. For `@llm` the prompt currently comes from:

1. `block.primaryParameter` (one-liner: `@llm Summarize this`)
2. `primaryContent` (body below `@---` delimiter)
3. `yamlParams.prompt` (YAML attribute in the directive body)

After the refactor, `@llm` simply reads `params.prompt` — it does not care which of the three sources the value came from. Similarly, `@include` reads `params.path`, and `@each` reads `params.pattern`. The directive declares its primary key at registration time, and the engine resolves the value using the standard precedence and merges it into `params`.

### 2. Integrate context-path extraction into the body parser

`@llm` currently calls `extractContextPaths(block.body)` separately to parse the `context:` YAML block from the raw body text. The body parser (`parseDirectiveBody`) knows about `context:` list syntax (it already validates and skips context items during parsing) but throws them away. After this change, `parseDirectiveBody` should return the resolved context paths as part of its output, so directives don't need to re-parse the body.

### 3. Define a clean "directive handler" contract

Refactor the directive handler signature so that each handler receives:

- The same `DirectiveContext` with engine-level services (LLM calls, file resolution, cache)
- A single `params: Record<string, string>` object containing:
  - All YAML attributes from the body (e.g., `model`, `as`, `join`)
  - The resolved primary parameter injected under the directive's declared primary key (e.g., `prompt` for `@llm`, `path` for `@include`, `pattern` for `@each`)
  - `contextPaths` resolved under the `context` key (empty array when not used)
- `label: string` from the directive header

The raw `DirectiveBlock` should no longer be directly exposed to directive handlers. The directive handler should not need to know about header parsing, body parsing, or parameter resolution at all.

Each directive declares its own primary-key name (the YAML key under which the resolved primary value should appear in `params`). The engine uses this to merge the primary into `params` following the standard precedence:

1. `block.primaryParameter` (one-liner on the header line)
2. `primaryContent` (body text below `@---`)
3. The YAML attribute matching the declared primary key (e.g., `prompt:` in the body)

This way a directive like `@llm` simply reads `params.prompt`, `@include` reads `params.path`, and `@each` reads `params.pattern` — no directive ever touches a generic "primary" concept.

The engine should be responsible for parsing parameters from the block and passing them to the directive.

### 4. Registration should declare the primary key

The directive registry (`register()`) should accept the primary-key name alongside the handler. Example:

```ts
register("llm", "prompt", llmDirective);
register("include", "path", includeDirective);
register("each", "pattern", eachDirective);
```

Directives with no primary parameter (e.g., `@static`) pass `null` or omit the argument.

### 5. Update existing directives

- **`@include`**: reads `params.path`. No other params.
- **`@llm`**: remove `parseDirectiveBody`, `extractContextPaths`, and manual prompt resolution. Reads `params.prompt`, `params.model`, `params.context`.
- **`@static`**: verify no changes needed (it has no parameters).

## Acceptance Criteria

- [x] Each directive handler receives a flat `params` object (plus `label`) — no directive calls `parseDirectiveBody` or reads `block.primaryParameter`.
- [x] The resolved primary value is always available in `params` under the directive's declared key: `params.prompt` for `@llm`, `params.path` for `@include`.
- [x] Primary resolution precedence is consistent: `block.primaryParameter` > `primaryContent` (body after `@---`) > YAML attribute matching the primary key.
- [x] `contextPaths` are returned by `parseDirectiveBody` and passed into `params.context` as a string array, eliminating the separate `extractContextPaths()` call.
- [x] All existing unit tests pass without modification to test expectations (behavior is preserved).
- [x] `@llm` one-liner form (`@llm Summarize this`) continues to work.
- [x] `@llm` body form with YAML params and `@---` delimiter continues to work.
- [x] `@llm` with `context:` paths continues to work.
- [x] `@include file.md` continues to work.
- [x] `@each` (ticket #13) can be implemented on top of the refactored directive API without duplicating parameter-resolution logic.

## Notes

- This is an internal refactor with no user-facing behavior change. The parser grammar, directive syntax, and rendering output should remain identical.
- The `DirectiveBlock` type (with `primaryParameter`, `body`, `label`) can remain in the parser output — the change is that directive handlers no longer receive `DirectiveBlock` directly; the engine transforms it into `DirectiveParams` before calling the handler.
- The `register()` function should accept the primary-key name so the engine knows which `params` key to inject the resolved primary into.
- The `parseDirectiveBody` function should be kept internal to the parameter-resolution layer; directives should not import or call it directly.
- `contextPaths` should be injected into `params` under the `context` key. The value is a string array (not a string) — since the `params` record currently only holds strings, this may require widening the value type or handling `context` specially.

## Resolution

The parameter-resolution layer was centralized in the engine:

- **`DirectiveContext`** (`src/types.ts`): Replaced `block: Block` with `label: string`, `sourceLine: number`, and `params: Record<string, string | string[]>`.
- **`parseDirectiveBody`** (`src/directives/body-parser.ts`): Now also collects `context:` list items as `contextPaths: string[]` in its output, rather than discarding them during validation.
- **Registry** (`src/directives/index.ts`): `register()` now takes a `primaryKey: string | null` argument alongside the handler. `get()` returns a `Registration` object with both `impl` and `primaryKey`.
- **Engine** (`src/engine.ts`): Calls `parseDirectiveBody` for every directive block, resolves the primary parameter using the standard precedence (`block.primaryParameter > primaryContent > yamlParams[primaryKey]`), and injects `contextPaths` into `params.context`. Constructs the new `DirectiveContext` with `label`, `sourceLine`, and `params`.
- **`@include`** (`src/directives/include.ts`): Reads `params.path` instead of `block.primaryParameter`.
- **`@llm`** (`src/directives/llm.ts`): Removed `parseDirectiveBody` and `extractContextPaths` imports; reads `params.prompt`, `params.model`, and `params.context` directly.
- **`@static`** (`src/directives/static.ts`): Reads `params.body` instead of `block.body`.

All directives now receive a clean `params` object without needing to know about header parsing, body parsing, or parameter resolution. The `DirectiveBlock` type remains in the parser output unchanged.

Review fix: Removed unused `Registration` import from `tests/unit/llm-directive.test.ts`.

## Testing

1. Run `npm test` — all 289 unit tests pass.
2. Run `npm run build && ./dist/cli.js AGENTS.md` — the template renders correctly with `@include` directives.
3. Run `npm run test:llm` — LLM integration tests pass (requires `OPENAI_API_KEY`).

## Review

**Decision:** ACCEPT

The lint error from the previous review has been fixed — the unused `Registration` import has been removed from `tests/unit/llm-directive.test.ts`. All checks now pass:

- ✅ Linter: clean (`npm run lint` — no errors)
- ✅ Unit tests: all 289 pass (`npm test`)
- ✅ Build: compiles cleanly (`npm run build`)
- ✅ CLI smoke test: `./dist/cli.js AGENTS.md` renders correctly

All ten acceptance criteria are met. The refactoring is well-scoped, directives receive clean `params` objects, the primary-key mechanism is consistent, and no directive leaks parsing concerns. Ready for `@each` (ticket #13).