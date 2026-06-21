---
id: 12
type: task
status: open
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

- [ ] `@llm\nSome prompt text\n@end` renders by calling the LLM with "Some prompt text" as the prompt (no `prompt:` YAML key in the body).
- [ ] `@llm\nmodel: gpt-4o\n@---\nSome prompt\n@end` renders using model `gpt-4o` with the body content as prompt.
- [ ] Existing `@llm` forms (`prompt:` in YAML, one-liner) continue to work unchanged.
- [ ] The `@---` delimiter in `@llm` body is correctly handled: params above, primary content below.
- [ ] `parseDirectiveBody()` unit-tested for: body with `@---`, body without `@---`, body with only YAML params, body with only primary content, empty body, body where `@---` appears in the first line.

## Notes

- The YAML attribute parsing logic currently lives inline in `src/directives/llm.ts` (attribute keys, `|`/`>` block scalars, `context:` lists). Consider extracting the common parts into the utility without breaking the `@llm`-specific behavior (`context:` list parsing, model validation).
- The utility should handle `@---` only at the start of a line (column 0). `@---` appearing inside indented content (e.g., a block scalar value) is not a delimiter.