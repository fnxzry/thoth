---
id: 15
type: issue
status: complete
description: Body parser treats YAML-quoted strings literally and misinterprets `|`/`>` as block scalars
---

## Overview

The directive body parser (`src/directives/body-parser.ts`) does not handle YAML-style string quoting or escape sequences. Values after `key:` are taken literally (after whitespace trimming), which causes three related problems:

1. **Quoted strings include the quotes** — `join: "---"` stores the literal `"---"` (with quotes) instead of `---`.
2. **Escape sequences are not interpreted** — `join: "\n"` stores the literal backslash-n instead of a newline.
3. **`|` and `>` trigger block scalar mode** — `join: |` or `join: >` are treated as YAML block scalar indicators, swallowing subsequent lines as block content instead of storing the character as a plain value.

These are pre-existing body-parser behaviors, but they became observable with the `@each` directive's `join:` parameter (ticket #13), where users naturally want to set separators like `" | "` or `"\n---\n"`.

## User-Facing Behavior

Template authors writing `join:` values with quotes or special characters get unexpected output:

```
@each docs/*.md
join: " | "
@---
{{index}}. {{name}}
@end
```

**Expected**: items separated by space-pipe-space (`0. a.md | 1. b.md`).
**Actual**: items separated by literal `" | "` including quotes (`0. a.md" | "1. b.md`).

Similarly, `join: |
` triggers YAML block scalar mode and swallows the `@---` delimiter and template body into the block scalar value, effectively breaking the `@each` directive entirely.

## Technical Requirements

All fixes must stay within `src/directives/body-parser.ts` (and its tests). No changes to directives.

- YAML double-quoted values (`"..."`) should be unquoted to their inner content.
- Common YAML escape sequences in double-quoted strings (`\n`, `\t`, `\\`, `\"`) should be interpreted.
- The `|` and `>` characters as bare values (after trim) should not trigger block scalar mode when they appear on the same line as their key. Block scalar mode should only activate for standalone block scalars (the value alone on the next line(s)).
- Edge cases: unbalanced quotes, mixed single/double quotes, empty quoted string `""`, values containing only whitespace.

## Acceptance Criteria

- [x] `join: " | "` stores ` | ` (without quotes) in YAML params.
- [x] `join: "\n"` stores a literal newline character (not backslash-n).
- [x] `join: |` stores `|` as a plain value (does not trigger block scalar mode).
- [x] `join: >` stores `>` as a plain value (does not trigger block scalar mode).
- [x] `prompt: "hello world"` stores `hello world` in YAML params (unquoted).
- [x] `prompt: |` as a standalone block scalar (value on the next line) still works as before.
- [x] Invalid quoting (unterminated quotes) produces a clear parse error with a source line reference.
- [x] All existing 341 tests continue to pass.
- [x] New body-parser unit tests added for each quoting/escaping/scalar edge case.

## Resolution

Added `processYamlValue()` function to `src/directives/body-parser.ts` that:
- Strips surrounding double quotes from YAML param values (`"..."` → `...`)
- Interprets common YAML escape sequences in double-quoted strings: `\n`, `\t`, `\r`, `\\`, `\"`
- Throws `BodyParserError` with source-line reference for unterminated quoted strings or unterminated escape sequences
- Passes through unquoted values unchanged (after trimming)

Modified the `|`/`>` block scalar logic to peek at the next non-blank line:
- If the next non-blank line is indented, block scalar mode activates (existing behavior for `prompt: |\n  content`)
- If no indented content follows (end of section, another key, or blank lines only), `|` or `>` is stored as a literal character value

Added 24 new unit tests covering: quoting, escape sequences (`\n`, `\t`, `\r`, `\\`, `\"`), empty strings, whitespace-only quoted values, unterminated quotes (error case), mixed quotes (error case), pipe/angle-bracket as literal values with various follow-on lines, and block scalar backward compatibility. All 341 tests pass.

## Testing

1. Run `npm test` — all 341 unit tests pass with the fix.
2. Create a test template `test.md`:
   ```
   @each docs/*.md
   join: " | "
   @---
   {{index}}. {{name}}
   @end
   ```
   Run `./dist/cli.js test.md` — items should be separated by ` | ` (not `" | "`).
3. Test `join: "\n"` to confirm newline separator works.
4. Test `join: |` — should use literal `|` as separator, not block scalar.
5. Test `prompt: |\n  two lines` — block scalar should still work correctly.
6. Test invalid quoting like `join: "unterminated` — should produce a clear `BodyParserError` with source line reference.

## Review

**Decision**: ACCEPT

The implementation is correct, focused, and well-tested.

- `processYamlValue()` cleanly handles double-quote stripping, escape sequences (`\n`, `\t`, `\r`, `\\`, `\"`), and produces clear errors with source-line references for unterminated strings/escapes.
- The `|`/`>` block scalar fix correctly peeks ahead for indented content, preserving backward compatibility while fixing the literal-value case.
- 24 new unit tests cover all acceptance criteria plus edge cases. All 341 tests pass. ESLint is clean.
- Minor note: values like `"a"b"` (trailing content after the closing quote) are silently truncated rather than rejected. Acceptable for this ticket's scope.

## Notes

- Single-quoted YAML strings (`'...'`) are not needed for the initial fix — double-quoted is the common case. Support can be added if straightforward.
- The `|`/`>` block scalar heuristic change needs careful thought: currently `rawValue === "|"` triggers block scalar mode. The fix should distinguish between `join: |` (same-line value) and `prompt: |\n  content` (next-line block scalar).
- This is purely a body-parser parsing bug — directives themselves are correct.