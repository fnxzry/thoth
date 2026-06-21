# @each Directive — Feature Elaboration

## 1. Overview

`@each` is a block-repeater directive that iterates over files matching a glob pattern. For each matched file, the directive renders its body template — with per-file variable substitution — and joins the results into the final output.

**Primary use case:** generating an index that summarizes each document in a directory, keeping the index in sync with the file system without manual maintenance.

## 2. Syntax

The primary parameter is the glob pattern. The body is the template that repeats per matched file.

### Simple form (default variable names)

```
@each docs/*.md
## {{name}}

@llm
context:
  - {{path}}
prompt: |
  Summarize the above document in exactly one sentence.
  Output only the sentence, no preamble.
@end

---
@end
```

The body between `@each` and `@end` IS the template. No `@---` delimiter is needed when there are no YAML parameters.

### With variable renaming and custom join

```
@each docs/*.md
as:
  path: p
  name: n
  index: i
join: "\n---\n"
@---
{{i}}. **{{n}}**

@llm
context:
  - {{p}}
prompt: |
  Summarize the above document in one sentence.
@end
@end
```

The `@---` delimiter separates YAML parameters (above) from the template body (below).

### All config in YAML

```
@each
pattern: docs/**/*.md
as:
  path: file
  name: label
@---
- `{{label}}` — {{file}}
@end
```

When the primary parameter (pattern) is omitted from the header, it must appear in the YAML section before `@---`.

### One-liner (no body)

`@each docs/*.md` is valid but renders nothing — it has no template body to repeat. This form exists for symmetry with the directive grammar but has no practical use.

## 3. Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `pattern` (primary) | Yes | — | Glob pattern relative to the template directory. Supports `**` for recursive matching. |
| `as:` | No | `{path, name, content, index}` | Map of variable renames. Keys are the canonical variable names; values are the names to use in the template. Any subset of the four variables can be renamed. |
| `join:` | No | `"\n"` | Text inserted between the rendered output of each iteration. |

## 4. Template Variables

| Variable | Description | Lazy? |
|----------|-------------|-------|
| `{{path}}` | Relative path from template directory to the matched file | No |
| `{{name}}` | Basename of the matched file (e.g., `architecture.md`) | No |
| `{{content}}` | Full text contents of the matched file | **Yes** — only read from disk if the variable (or its mapped name) appears in the template body |
| `{{index}}` | Zero-based iteration counter (0 for the first match, 1 for the second, ...) | No |

Variables are substituted by string replacement in the template body before each iteration is rendered. Renaming via `as:` lets authors avoid collisions when nesting `@each` (though collisions are rare in practice since outer substitution happens before inner parsing).

### Lazy content detection

Before any iteration begins, the implementation checks whether the string `{{content}}` (or its mapped name) appears in the template body. If absent, file contents are never loaded — saving I/O when the author only needs path/name/index. If present, `readFile` is called for each matched file during its iteration.

## 5. Behavior

### File matching

- Glob patterns support standard syntax including `**` for recursive directory matching (e.g., `docs/**/*.md`).
- Matched results are sorted alphabetically by relative path. This is deterministic and matches the project's reproducibility value.
- Symlinks are followed (OS default behavior).
- Directories are not matched — `@each` iterates over files only.

### Empty match

When the glob matches zero files, `@each` renders nothing (no output, no error). This allows templates to reference directories that may be conditionally empty.

### Nested directives

The template body may contain `@llm`, `@include`, `@static`, and nested `@each` directives. These are fully functional:

- For each iteration, the `@each` implementation substitutes template variables into the body text.
- The substituted text is passed to `ctx.renderTemplate()`, which re-parses and renders it through the full engine pipeline.
- This means `@llm` inside the body sees the substituted file paths in its `context:` list, and the LLM generates a per-file response.
- The rendered output for each iteration is collected and joined with the `join:` separator.

### One-liner form

The one-liner `@each <pattern>` has no body and produces no repeated output. It is syntactically valid but has no practical use case.

## 6. Architecture Changes

### New directive: `src/directives/each.ts`

Implements the `@each` directive. Responsibilities:

1. Parses the directive body: splits on `@---` delimiter (if present), extracts YAML params from the top section, treats the bottom section as the template body.
2. Resolves the glob pattern using `fs.glob` (or the `glob` npm package).
3. Detects whether `{{content}}` (or mapped name) is referenced in the template.
4. For each matched file (sorted):
   - Substitutes template variables.
   - Calls `ctx.renderTemplate(substitutedBody)` to render nested directives.
   - Collects the result.
5. Joins collected results with the `join:` separator.
6. Returns `{ text: joinedOutput }`.

### New `DirectiveContext` method

```typescript
interface DirectiveContext {
  // ... existing members ...
  renderTemplate(template: string): Promise<DirectiveResult>;
}
```

`renderTemplate` allows a directive to recursively invoke the render pipeline. The engine wires this callback to re-parse the provided text and render all blocks (static and directive) through the full pipeline, using the same config, LLM provider, cache, and template directory.

### New grammar convention: `@---` delimiter

`@---` on its own line separates YAML parameters from primary content within a directive body. This convention applies to **any** directive, not just `@each`.

- A directive body **without** `@---` is treated entirely as primary content (the template, the prompt, the static text).
- A directive body **with** `@---` has its top section parsed as YAML parameters and its bottom section treated as primary content.

The parser does **not** change. Detection is done inside each directive's implementation. `@---` is not a valid directive name (no leading letter), so it never conflicts with real directives.

### Extended `@llm` syntax (natural fall-out)

The `@---` convention allows `@llm` to accept its prompt as body content:

```
@llm
Summarize this document in two paragraphs.
@end
```

This is equivalent to `@llm Summarize this document in two paragraphs.` but is ergonomically better for long prompts. The existing `prompt:` YAML parameter continues to work as before.

### Dependency

Node 22+ provides `fs.glob` natively. If the minimum supported Node version is below 22, the `glob` npm package is used instead.

## 7. Examples

### Docs index with summaries

```
# Documentation Index

@each docs/*.md
## `{{name}}`

@llm
context:
  - {{path}}
prompt: |
  Summarize the above document in exactly one sentence.
  Output only the sentence, no preamble.
@end

---
@end
```

### Numbered list with custom join

```
@each src/**/*.ts
as:
  path: file
  index: i
join: "\n"
@---
{{i}}. `{{file}}`
@end
```

### Nested @each for grouped output

```
@each categories/*.md
## {{name}}

@llm
context:
  - {{path}}
prompt: |
  Summarize this category in one sentence.
@end

@each {{path}}/docs/*.md
- `{{name}}`
@end

---
@end
```

## 8. Edge Cases and Limitations

- **Binary files:** If `{{content}}` is used on a binary file, the raw bytes are substituted into the template as text and may produce garbled output. Authors are responsible for using glob patterns that match only text files.
- **Empty files:** `{{content}}` resolves to an empty string. The template renders normally.
- **Large directories:** There is no iteration limit. If a glob matches thousands of files, the directive will process all of them, which may be slow. Consider using more specific patterns.
- **Symlink cycles:** Default OS behavior applies. If the glob follows symlinks and encounters a cycle, behavior depends on the glob implementation.
- **`@---` in template body:** `@---` is reserved as a delimiter and must not appear as template content within an `@each` body or any directive body. It can appear in static sections of the template outside directives.
- **Variable escaping:** There is no escaping mechanism for `{{` in the template body. If an author needs literal `{{`, they should avoid using it inside `@each` bodies or use a mapped variable name that differs from  `{{`.

## 9. Relationship to Existing Architecture

`@each` fits into the directive registry alongside `@static`, `@include`, and `@llm`. It reuses:

- The directive registry (`src/directives/index.ts`) for registration.
- The engine pipeline (`src/engine.ts`) for orchestration via `renderTemplate`.
- The cache system for any `@llm` calls nested within the body (transparent — `renderTemplate` passes the cache through).
- The config system for template directory resolution.

No changes are needed to the parser, CLI, or config modules. The `@---` delimiter and `renderTemplate` callback are the only new infrastructure.