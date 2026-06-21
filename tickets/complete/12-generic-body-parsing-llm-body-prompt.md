---
id: 12
type: task
status: complete
description: Generic directive body parsing utility and @llm body-as-prompt form
---

## Overview

Add a shared `parseDirectiveBody()` utility that directive implementations call to interpret their body text. The utility handles the `@---` delimiter convention: splitting the body into YAML parameters (above `@---`) and primary content (below `@---`). Refactor the `@llm` directive to use this utility, which naturally enables the body-as-prompt form where the entire body is the LLM prompt.

See `docs/elaborations/each-directive.md` §6 (grammar convention) and `docs/architecture.md` §4 (primary-content body convention).

## User-Facing Behavior

Users can write `@llm` blocks where the prompt is the body text instead of a required `prompt:` YAML parameter:

```
@llm
Summarize this file in two paragraphs. Include key architectural decisions.
@end
```

This is equivalent to `@llm Summarize this file...`. The existing `prompt:` YAML parameter form continues to work. When both are present (a `prompt:` param AND body content below `@---`), the body content takes precedence as the primary content.

The `@---` delimiter is also usable:

```
@llm
model: gpt-4o
context:
  - docs/arch.md
@---
Summarize the above document.
@end
```

## Technical Requirements

- Create `src/directives/body-parser.ts` exporting a `parseDirectiveBody(rawBody: string)` function.
  - Returns `{ yamlParams: Record<string, string>, primaryContent: string }`.
  - Splits the body on the first `@---` line (a line containing only `@---`).
  - Section above `@---` is parsed as YAML-style `key: value` pairs (reuse or extract the existing YAML attribute parsing logic from `src/directives/llm.ts`).
  - Section below `@---` is the primary content (unprocessed).
  - If no `@---` is present and the body does not start with a YAML attribute, the entire body is treated as primary content.
  - `@---` delimiter is only recognized at column 0 (no leading whitespace).
- Refactor `src/directives/llm.ts` to use `parseDirectiveBody()`.
  - The `prompt:` YAML param and the primary content from `parseDirectiveBody()` both contribute to the final prompt. Primary content, when present, is the prompt. When absent, the `prompt:` param (or primary parameter from one-liner) is the prompt.
  - The existing `context:` list and `model:` param parsing should be preserved in the `parseDirectiveBody()` utility (or remain in `@llm` if the utility only handles the split).
- Register the utility for use by other directives.

## Acceptance Criteria

- [x] `@llm\nSome prompt text\n@end` renders by calling the LLM with "Some prompt text" as the prompt (no `prompt:` YAML key in the body).
- [x] `@llm\nmodel: gpt-4o\n@---\nSome prompt\n@end` renders using model `gpt-4o` with the body content as prompt.
- [x] Existing `@llm` forms (`prompt:` in YAML, one-liner) continue to work unchanged.
- [x] The `@---` delimiter in `@llm` body is correctly handled: params above, primary content below.
- [x] `parseDirectiveBody()` unit-tested for: body with `@---`, body without `@---`, body with only YAML params, body with only primary content, empty body, body where `@---` appears in the first line.

## Notes

- The YAML attribute parsing logic currently lives inline in `src/directives/llm.ts` (attribute keys, `|`/`>` block scalars, `context:` lists). Consider extracting the common parts into the utility without breaking the `@llm`-specific behavior (`context:` list parsing, model validation).
- The utility should handle `@---` only at the start of a line (column 0). `@---` appearing inside indented content (e.g., a block scalar value) is not a delimiter.

## Resolution

Created `src/directives/body-parser.ts` with `parseDirectiveBody(rawBody, sourceLine?)` that splits directive bodies on the first `@---` line at column 0. The utility returns `{ yamlParams: Record<string, string>, primaryContent: string }` where yamlParams are parsed from the section above `@---` (or the entire body if no delimiter and it starts with a YAML attribute), and primaryContent is the text below `@---` (or the entire body if it doesn't start with a YAML attribute).

The utility handles block scalars (`|`, `>`), consumes but does not store `context:` list entries, validates attribute names, and throws `BodyParserError` with optional source line context.

Refactored `src/directives/llm.ts` to use `parseDirectiveBody()`. The `extractContextPaths()` helper scans the raw body for context list items. Prompt resolution order: primary parameter (one-liner) \> primary content (body below `@---` or plain body) \> `prompt:` YAML param. The `model:` YAML attribute flows through `yamlParams` to the LLM call. Empty model validation is preserved in `@llm`.

All existing `@llm` forms continue to work unchanged: one-liner, multi-line with `prompt:` YAML, `context:` lists, block scalars, model override. The new body-as-prompt form is now supported for both plain body text and `@---`-delimited body.

Context parsing remains in `@llm` (not the utility) since `context: list` is an `@llm`-specific concept. This keeps the utility generic for other directives like `@each`.

Added 20 unit tests for `parseDirectiveBody()` in `tests/unit/body-parser.test.ts` covering all acceptance criteria plus edge cases (block scalars, leading whitespace, empty lines, indented `@---` not matching). Added 8 unit tests for body-as-prompt behavior in `tests/unit/llm-directive.test.ts`.

All 288 unit tests pass. The build compiles cleanly. Smoke-tested via CLI: `@llm\nmodel: gpt-4o\n@---\nSay hello...\n@end` and `@llm\nSay hello...\n@end` both render correctly.

## Testing

1. Run unit tests: `npm test` — all 288 tests must pass.
2. Smoke test body-as-prompt form:
   ```
   printf '@llm\nSay hello in exactly one word.\n@end\n' | thoth --no-cache -
   ```
   Expected: LLM responds with a single-word greeting.
3. Smoke test `@---` delimiter form:
   ```
   printf '@llm\nmodel: gpt-4o\n@---\nSay hello in exactly one word.\n@end\n' | thoth --no-cache -
   ```
   Expected: LLM responds with a single-word greeting, using gpt-4o.
4. Verify existing `@llm` forms still work: one-liner (`@llm hello`), multi-line with `prompt:` YAML, `context:` lists.

## Review

**Decision:** ACCEPT

All acceptance criteria are met and verified:

- ✅ `src/directives/body-parser.ts` is cleanly factored: `parseDirectiveBody()` splits on `@---` at column 0, parses YAML attrs with block scalar support, handles `context:` list consumption without storing it, and returns `{ yamlParams, primaryContent }`.
- ✅ `src/directives/llm.ts` correctly delegates body parsing to the utility while keeping `context:` extraction local. Prompt resolution order (primary parameter > primary content > `prompt:` YAML) matches the spec.
- ✅ 20 unit tests for `parseDirectiveBody()` cover all specified cases plus edge cases (block scalars, blank lines, leading whitespace, indented `@---` not matching, error paths).
- ✅ 8 unit tests for body-as-prompt LLM behavior cover both plain body and `@---`-delimited forms, context interop, one-liner precedence, and error cases.
- ✅ All 288 unit tests pass. Build compiles cleanly. Linter is silent.
- ✅ Architectural conformance: matches `@---` convention from `docs/elaborations/each-directive.md` §6 and primary-content body convention from `docs/architecture.md` §4. Utility is positionally reusable by `@each` (and future directives).

No issues found.