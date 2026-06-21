---
id: 10
type: task
status: open
description: Implement the directive grammar update from docs/architecture.md §4: introduce `label` and `primaryParameter` on the Block type, remove `attributes`, support all four forms (one-liner with/without label, multi-line with/without label), and update every directive and test to match.
---

## Overview

The architecture doc was updated in commit (this ticket) to formalize the directive grammar around two orthogonal concepts:

- **Label**: a colon-suffixed identifier on the directive line (`@<directive>:<label>`). Used for cache keys, error messages, and cross-references. Independent of the directive's parameters.
- **Primary parameter**: the directive's primary input. Settable inline on the one-liner form or in the body YAML on the multi-line form. A directive MAY have one; if it doesn't, only the multi-line form is available.

The implementation today still uses the old grammar: the `Block` type has `id` (which conflates label and primary parameter) and `attributes` (header-line `key=value` tokens), and the parser produces `@llm <id>` where the `<id>` slot means different things for different directives. This ticket brings the code in line with the documented grammar.

## User-Facing Behavior

- A template may use any of the four forms documented in `docs/architecture.md` §4:
  - `@<directive> <primary-parameter>` (one-liner, no label)
  - `@<directive>:<label> <primary-parameter>` (one-liner with label)
  - `@<directive>` followed by a YAML body closed with `@end` (multi-line, no label)
  - `@<directive>:<label>` followed by a YAML body closed with `@end` (multi-line with label)
- The existing `@include docs/summary.md`, `@llm:summary-section Summarize the file foo.txt`, and `@llm:architecture-summary\nprompt: |\n  ...\n@end` examples from §4 all render correctly.
- Existing templates written against the old grammar (`@llm foo` with `foo` as the id, `@include foo.md` with `foo.md` as the id) are migrated consistently with §4's built-in directive descriptions:
  - `@include <path>` keeps the same form (`@include docs/summary.md`); the slot after the name is the primary parameter (file path).
  - `@llm` no longer treats the slot after the name as the id; it either becomes a label (with a colon, `@llm:foo`) or a primary parameter (the prompt, `@llm Summarize the file`). A bare `@llm foo` is no longer valid input — the parser interprets `foo` as a label (which would require a colon) and fails with a clear error pointing to the §4 grammar.
- Header-line `key=value` attributes (`@llm summary model=gpt-4o`) are no longer parsed; templates that use them must move the options to the body YAML (`model: gpt-4o` under `@end`).
- Errors surface the source line and the directive name, as today.

## Technical Requirements

- **`src/types.ts`** — `DirectiveBlockSchema` and the inferred `DirectiveBlock` type gain `label: string` and `primaryParameter: string`, drop `attributes`. `primaryParameter` and `body` are mutually exclusive: exactly one is non-empty for a valid directive block. (`StaticBlock` is unchanged.)
- **`src/parser.ts`** — the header line is parsed as either:
  - `@<name>` — name only (multi-line form, body must follow)
  - `@<name>:<label>` — name and label (multi-line form, body must follow)
  - `@<name> <rest-of-line>` — name and primary parameter (one-liner, no label, no body)
  - `@<name>:<label> <rest-of-line>` — name, label, and primary parameter (one-liner, no body)
  - `@<name>:` and `@<name>:<label>:` with trailing content beyond the label are invalid (the parser emits a `ParseError` pointing at the directive's source line).
  - The `@end` scanner and the "missing `@end`" detection (parser looks ahead past intervening lines) stay unchanged.
- **`src/directives/include.ts`** — reads `block.primaryParameter` (the file path), errors with the directive's source line if it's empty (the include directive requires a primary parameter).
- **`src/directives/llm.ts`** — when the body is empty (one-liner form), the prompt is `block.primaryParameter`. When the body is non-empty, the body YAML parser extracts `prompt`, `context`, `model` as today. The directive's id-as-cache-key semantics (ticket #07) now use `block.label` for the cache identifier.
- **`src/directives/static.ts`** — unchanged behavior (passes the body through). The directive no longer reads `block.id`.
- **`src/directives/index.ts`**, **`src/engine.ts`**, **`src/cli.ts`** — unchanged structurally; pass the new `Block` shape through.
- **Tests** — every test that constructs a `Block` or asserts on its fields updates to the new shape:
  - `tests/unit/parser.test.ts` — add cases for each of the four forms, label parsing, `key=value` rejection, one-liner with no body, primary-parameter vs label distinction.
  - `tests/unit/directives.test.ts`, `tests/unit/engine.test.ts`, `tests/unit/llm-directive.test.ts` — update `block.id` references to `block.primaryParameter` or `block.label` as appropriate; update engine test templates to use the new forms.
  - `tests/unit/cli.test.ts` — minimal updates; no direct `Block` access.
  - `tests/llm/*.test.ts` — update inline templates to use the new grammar.
- No public API change other than the `Block` shape; the directive registry, `RenderContext`, `DirectiveContext`, `LlmProvider`, and CLI surface stay the same.

## Acceptance Criteria

- [ ] A template using any of the four documented forms renders correctly: `@include docs/summary.md`, `@llm:summary-section Summarize the file foo.txt`, `@llm:architecture-summary\nprompt: |\n  Summarize this document in two paragraphs.\n@end`, and the no-label variants of the one-liner and multi-line forms.
- [ ] The parser rejects the old `@llm <id>` form (no colon, no body) with a clear error naming the directive and the source line.
- [ ] The parser rejects `@llm summary model=gpt-4o` style header-line attributes; the user is told to move them to the body.
- [ ] The `Block` type has `label` and `primaryParameter` fields and no `attributes` field. `DirectiveBlockSchema` reflects the same.
- [ ] All built-in directives (`@include`, `@llm`, `@static`) read the correct fields from the new `Block` shape and produce the same rendered output as before for equivalent inputs.
- [ ] All unit tests pass.
- [ ] All LLM-graded integration tests pass against the configured OpenAI-compatible endpoint.

## Notes

- Ticket #09 (`tickets/open/09-llm-one-liner.md`) is a narrower precursor that proposed adding the `@llm <prompt>` and `@llm:<id> <prompt>` one-liner forms. The architecture doc update supersedes it: this ticket implements the broader grammar (every directive MAY have a primary parameter, plus the optional label concept) that #09's narrower proposal was heading toward. After this ticket lands, #09 should be marked as superseded and closed.
- The directive grammar spec at `docs/architecture.md` §4 is already updated to the new form; this ticket implements the code that matches it.
- The cache key spec at `docs/architecture.md` §5 does not currently reference `block.id`. Ticket #07 (caching) will derive its cache key from the resolved prompt and context files, which is independent of this ticket's `label` vs `primaryParameter` split. No changes to §5 are needed.
- The `Block` shape change is observable to anyone who imports the type from `src/types.ts` or constructs `Block` values directly (only the test suite does this today). The engine, directives, and CLI are internal callers; updating them is part of this ticket.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
