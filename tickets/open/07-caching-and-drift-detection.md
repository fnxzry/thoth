---
id: 07
type: task
status: open
description: Implement content-addressed filesystem cache for @llm blocks and `--check` mode for drift detection.
---

## Overview

Add two capabilities on top of the engine:
1. **Cache**: `@llm` directive outputs are stored in a content-addressed filesystem cache at `./.doc-cache/`. Cache hits short-circuit the LLM call. The cache directory is intended to be committed to the repo so regeneration without API access reproduces byte-identical output.
2. **`--check` drift detection**: the CLI renders to memory and compares bytes to a reference (the file at `--output`, if any). Exits 3 on mismatch with a unified-diff hint.

## User-Facing Behavior

- The first run of `<T> <template.md>` populates `./.doc-cache/` with one entry per `@llm` block.
- A second run with the same template and unchanged context files produces byte-identical output without making any LLM calls (cache hits).
- `<T> --check <template.md>` with `--output existing.md` exits 0 if the rendered output equals `existing.md` and exits 3 with a unified diff if it differs.
- `<T> --check <template.md>` without `--output` exits 2 with a usage error.
- `<T> --no-cache <template.md>` bypasses the cache and always calls the provider; `--no-cache` overrides any cache hit.

## Technical Requirements

- `src/cache.ts` implements the cache:
  - Key computation per `docs/architecture.md` §5.
  - Sharded storage at `./.doc-cache/<key[0:2]>/<key[2:4]>/<key>.json`.
  - `get(key)` returns `null` on miss, the cached entry on hit.
  - `put(key, entry)` writes atomically (write to `*.tmp`, then rename).
  - Cache write errors are non-fatal: a warning is logged to stderr and rendering continues.
- The `llm` directive consults the cache before calling the provider and stores the result on success.
- `--no-cache` flag disables the cache for one invocation (the flag is already accepted by the parser from ticket #04; this ticket wires it to behavior).
- `--check` renders to memory, computes a unified diff against the file at `--output` (using a small diff library or a hand-rolled LCS-based diff), and exits 3 with the diff on stderr.
- Unit tests cover: cache key computation (golden test for a fixed prompt + context), cache hit/miss/persistence, atomic write on simulated failure, `--check` exits 0/3 on match/mismatch, `--no-cache` skips the cache.
- LLM-graded integration tests cover: cache hit reproduces byte-identical output across two runs.

## Acceptance Criteria

- [ ] After running `<T> <template.md>` once with valid credentials, `./.doc-cache/` contains one entry per `@llm` block.
- [ ] Running `<T> <template.md>` again with `OPENAI_API_KEY` unset still produces byte-identical output (cache hits).
- [ ] Modifying a context file's contents invalidates the cache for any `@llm` directive that references it (next run regenerates the entry).
- [ ] Modifying an `@llm` directive's prompt invalidates the cache for that block (next run regenerates).
- [ ] `<T> --check <template.md> --output <existing.md>` exits 0 when the rendered output equals `<existing.md>` and 3 with a unified diff when it differs.
- [ ] `<T> --no-cache <template.md>` always calls the provider, even on cache hits.
- [ ] All unit and LLM-graded integration tests pass.

## Notes

The cache directory is intentionally committed to the repo. A `.doc-cache/` entry in `.gitignore` is NOT added — committing the cache is part of the design. See `docs/concept.md` (Core Values: Reproducible without network access).

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
