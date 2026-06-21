---
id: 13
type: task
status: open
description: @each directive for iterating over glob-matched files
---

## Overview

Implement the `@each` directive, a block-repeater that iterates over files matching a glob pattern. For each matched file, the directive renders its body template with per-file variable substitution (`{{path}}`, `{{name}}`, `{{content}}`, `{{index}}`) and joins the results into the final output. Nested directives (`@llm`, `@include`, nested `@each`) work inside the body template via a new `renderTemplate` callback on `DirectiveContext`.

See `docs/elaborations/each-directive.md` for the full design.

## User-Facing Behavior

**Simple form:**
```
@each docs/*.md
## {{name}}

@llm
context:
  - {{path}}
prompt: |
  Summarize the above document in exactly one sentence.
@end

---
@end
```
Matches all `.md` files in `docs/`, renders the body per file with `{{path}}` and `{{name}}` substituted. The nested `@llm` calls the LLM for each file. Results are joined with `\n` (default `join:` separator).

**With variable renaming and custom join:**
```
@each docs/*.md
as:
  path: p
  name: n
  index: i
join: "\n---\n"
@---
{{i}}. **{{n}}**
@end
```
Uses custom variable names `{{p}}`, `{{n}}`, `{{i}}` and inserts `\n---\n` between iterations.

**Empty glob:** When no files match, `@each` renders nothing (no error).

## Technical Requirements

### Engine: `renderTemplate` callback

- Add `renderTemplate(template: string): Promise<DirectiveResult>` to the `DirectiveContext` interface in `src/types.ts`.
- Wire it in `src/engine.ts`: the callback re-parses the given text via `parse()` and renders all blocks (static and directive) through the full pipeline, reusing the same config, LLM provider, cache, and template directory.

### Directive: `src/directives/each.ts`

- Use `parseDirectiveBody()` (from ticket #12) to parse YAML params (`as:`, `join:`) and the template body from the directive's raw body.
- The primary parameter (from the header line, e.g. `docs/*.md`) or the `pattern:` YAML param is the glob pattern.
- Use `glob` (npm package, or Node ≥22 `fs.glob`) to resolve matches relative to `ctx.templateDir`.
- Sort matches alphabetically by relative path (deterministic).
- Detect whether `{{content}}` (or its mapped name) is referenced in the template body. Only read file contents if so (lazy loading).
- For each matched file:
  - Substitute `{{path}}`, `{{name}}`, `{{content}}` (if needed), `{{index}}` (or their mapped names) into the template body.
  - Call `ctx.renderTemplate(substitutedBody)` to render nested directives.
  - Collect the rendered text.
- Join collected results with the `join:` separator (default `"\n"`).
- Empty glob: return `{ text: "" }`.

### Variable renaming (`as:`)

- YAML param `as:` maps canonical names to custom names. Example: `as: { path: p, name: n }`.
- Any subset of the four variables can be renamed. Unmapped variables keep their default names.
- The `as:` param is validated: mapped names must be valid identifier strings.

### Registration

- Register `@each` in `src/directives/each.ts` and import it in `src/directives/all.ts`.

## Acceptance Criteria

- [ ] `@each docs/*.md\n## {{name}}\n@end` renders a heading per matched file with the file's basename.
- [ ] `{{path}}` resolves to the relative path from the template directory to each file.
- [ ] `{{content}}` resolves to the full file contents. When not referenced in the template, file contents are never read from disk (verify via mock/stub).
- [ ] `{{index}}` is 0 for the first file, 1 for the second, etc.
- [ ] `join:` param controls the separator between iterations. Default is `"\n"`.
- [ ] `as:` param renames variables: `as: { name: n }` means `{{n}}` works, `{{name}}` does not.
- [ ] Glob supports `**` for recursive matching (e.g., `docs/**/*.md`).
- [ ] Empty glob matches render nothing (no error, no output).
- [ ] Nested `@llm` inside `@each` body works: the LLM is called with substituted context paths per file.
- [ ] Nested `@each` inside an outer `@each` body works (outer variables are substituted before inner `@each` is rendered).
- [ ] Error on invalid `as:` mapping (empty name, non-identifier name).
- [ ] Error when no pattern is provided (no primary parameter and no `pattern:` YAML param).

## Notes

- The `glob` npm package is the fallback if Node < 22. Check `engines` in `package.json` to determine the target.
- The template body may contain `@llm` directives that will call the LLM per file. Consider adding a note or warning if the glob matches many files (potential cost).
- `@---` appearing in the template body (below the delimiter section) is NOT treated as a delimiter — it's part of the rendered template text for each iteration. Only the first `@---` at the top level of the body separates YAML params from the template.
- Variable substitution is plain string replacement. There is no escaping mechanism for `{{` in the template body.