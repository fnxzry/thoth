---
id: 07
type: task
status: complete
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

- [x] After running `<T> <template.md>` once with valid credentials, `./.doc-cache/` contains one entry per `@llm` block.
- [x] Running `<T> <template.md>` again with `OPENAI_API_KEY` unset still produces byte-identical output (cache hits).
- [x] Modifying a context file's contents invalidates the cache for any `@llm` directive that references it (next run regenerates the entry).
- [x] Modifying an `@llm` directive's prompt invalidates the cache for that block (next run regenerates).
- [x] `<T> --check <template.md> --output <existing.md>` exits 0 when the rendered output equals `<existing.md>` and 3 with a unified diff when it differs.
- [x] `<T> --no-cache <template.md>` always calls the provider, even on cache hits.
- [x] All unit and LLM-graded integration tests pass.

## Notes

The cache directory is intentionally committed to the repo. A `.doc-cache/` entry in `.gitignore` is NOT added — committing the cache is part of the design. See `docs/concept.md` (Core Values: Reproducible without network access).

## Resolution

Implemented content-addressed filesystem caching for `@llm` blocks and a `--check` drift-detection mode. The cache lives under `./.doc-cache/` (per `docs/architecture.md` §5) and is committed to the repo; regeneration against cached entries requires no API access.

### New modules

- `src/diff.ts` — Minimal LCS-based unified diff for `--check` drift output. Produces a standard `--- ` / `+++ ` / `@@ ... @@` header followed by line-prefixed (` `, `-`, `+`) ops. Changes within 2*contextLines (default 3) of each other are merged into a single hunk; changes farther apart form separate hunks.
- `src/cache.ts` (extended) — `LlmCache` class with sharded storage layout (`<cacheDir>/<key[0:2]>/<key[2:4]>/<key>.json`), atomic writes (write `<path>.tmp`, rename; clean up the tmp on rename failure), and non-fatal I/O errors (warns via the optional `warn` hook and continues). `isLlmCacheEntry` validates the on-disk shape on read. The pre-existing `computeLlmCacheKey` is unchanged.

### Modified modules

- `src/types.ts` — `DirectiveContext` gains an optional `cache?: LlmCache` field.
- `src/directives/llm.ts` — Computes the cache key from `(providerId, model, prompt, contextFiles)` per `docs/architecture.md` §5 before calling the provider. On cache hit, returns the cached content without invoking the provider. On cache miss, calls the provider and stores the response (content + optional usage) on success. Skips the cache when `ctx.cache` is absent or `ctx.config.cache.enabled` is `false` (i.e. when `--no-cache` is set or the config disables it).
- `src/engine.ts` — `RenderContext` gains optional `cache?` and `warn?` fields. A `createCache(ctx)` helper instantiates `LlmCache` from the resolved config when caching is enabled (relative `cacheDir` resolved against `templateDir`, consistent with `@include` path resolution). The cache is passed to every directive via the `DirectiveContext.cache` field.
- `src/cli.ts` — `--check` without `--output` is now a usage error (exit 2). `--check --output <path>` renders to memory, compares bytes against `<path>`, and exits 0 on match or 3 on mismatch (with a unified diff written to stderr). Reads of the reference file use the existing fs-error formatter (ENOENT/EACCES → exit 2). A `--no-cache` flag was already wired in ticket #04; this ticket wires it to behavior: `loadConfig({ cli: { noCache: true } })` produces `config.cache.enabled = false`, which the engine and directive honor. The CLI passes a `warn` hook to `render` so cache-write errors surface on stderr without aborting the render. The USAGE text is updated to reflect the new `--check` semantics.

### Test strategy

- **New unit tests** (`tests/unit/cache.test.ts`, 23 tests) — `LlmCache.pathFor` shard layout; `get`/`put` round-trip including JSON pretty-printing and shape round-trip without `usage`; persistence across fresh `LlmCache` instances; shard-directory creation on first `put`; ENOENT/malformed-JSON/unexpected-shape handling with warning capture; `mkdir` failure non-fatal with warning; atomic-write cleanup on rename failure (temp file removed); engine integration with `cache.enabled: true` covering first-run provider call + cache write, second-run cache hit, prompt change invalidating the cache, context-file content change invalidating the cache, and `cache.enabled: false` skipping the cache entirely; `isLlmCacheEntry` shape validation.
- **New unit tests** (`tests/unit/diff.test.ts`, 12 tests) — Empty diff for identical inputs; `--- ` / `+++ ` / `@@` headers on mismatch; `-`/`+`/` ` prefixes for removed/added/context lines; single hunk for a single change; multiple hunks when changes are far apart; merging of changes within 2*contextLines; trailing-newline diff handling.
- **Updated unit tests** (`tests/unit/cli.test.ts`) — Replaced the previous "accepts --check without using it" test with "rejects --check without --output as a usage error" (exit 2, stderr mentions both `--check` and `--output`). Added three new tests: `--check --output` exits 0 when the rendered output matches; `--check --output` exits 3 with a unified diff on stderr (containing `---`, `+++`, `@@`) on mismatch; `--check --output <missing>` exits 2 (ENOENT) when the reference file is missing.
- **Updated unit tests** (`tests/unit/engine.test.ts`) — The `engine: llm directive end-to-end` block now disables the cache on its test config so it exercises the directive's provider call in isolation. The cache tests cover the cache integration separately. This change was necessary because the engine now consults the cache by default, and shared state across tests would have caused later tests to short-circuit the provider.
- **New LLM-graded integration test** (`tests/llm/cache.test.ts`, 1 test, gated on `OPENAI_API_KEY`) — Renders a representative `@llm`-with-prompt template through `render()` against the configured endpoint; verifies a cache entry was created; re-renders the same template; asserts byte-identical output across the two runs.

### Design choices worth flagging

- **Cache lives next to the template.** The engine resolves a relative `config.cacheDir` against `templateDir` (same convention as `@include`). For stdin input, `templateDir` is `process.cwd()`, which matches Unix conventions for resolving paths referenced by stdin-supplied templates.
- **`LlmCache` writes atomically via `<path>.tmp` + `rename`.** On `mkdir` failure, write failure, or rename failure the cache warns and continues without writing; the renderer still completes against the provider. On a successful rename the temp file is gone. On a failed rename the temp file is removed as best-effort cleanup so no orphans accumulate.
- **`computeLlmCacheKey` is called twice per cache-miss block** (once for the lookup, once for the store). The cost is small (sha256 of a few KB at most) and keeps the lookup/store paths independent. This can be hoisted to a single call later if profiling warrants.
- **`--check` writes the diff to stderr, not stdout.** Matches `git diff` and other CLI tools that reserve stdout for the would-be output and stderr for diagnostics. The exit code distinguishes success (0) from drift (3) so callers can branch on `$?`.
- **`--check` does not write to `--output`.** A successful check leaves the reference file untouched; a drift-detected check exits 3 without modifying anything. To capture the rendered output, run without `--check`.
- **The cache is consulted before the provider and written after a successful provider response.** Provider failures don't pollute the cache; the next run retries the provider call.
- **`isLlmCacheEntry` validates the on-disk shape.** A cache file with unexpected content (e.g. partially written, manually edited) is treated as a miss with a warning; the renderer continues against the provider. This keeps a corrupted cache from silently breaking generation.
- **The `--check` ENOENT case for the reference file is exit 2, not exit 1.** The existing `formatFsError` helper maps ENOENT/EACCES to usage errors, which is consistent with how missing/unreadable input files are handled. Drift detection against a missing reference is treated as a user error (the reference is required to compare against).

## Testing

From the repo root:

```bash
npm install
npm run build      # exits 0
npm test           # 260 unit tests, all passing
npm run test:llm   # 8 LLM-graded tests, all passing (including the cache-hit reproduction test)
npm run lint       # exits 0
```

New test files:

- `tests/unit/cache.test.ts` (23 tests) — `LlmCache.pathFor` shard-layout verification; `get`/`put` round-trip; persistence across instances; sharded directory creation; ENOENT/malformed-JSON/unexpected-shape handling; non-fatal `mkdir` failure; atomic-write cleanup; engine-level integration covering cache miss → write, cache hit → short-circuit, prompt change invalidating, context-file content change invalidating, and `cache.enabled: false` bypassing the cache; `isLlmCacheEntry` shape validation.
- `tests/unit/diff.test.ts` (12 tests) — Empty diff for identical inputs; `--- ` / `+++ ` / `@@` headers; `-`/`+`/` ` prefixes; single-hunk and multi-hunk behavior; merge-within-contextLines; trailing-newline differences.
- `tests/llm/cache.test.ts` (1 test, gated on `OPENAI_API_KEY`) — Real network round-trip: first render populates the cache; second render hits the cache and produces byte-identical output.

Existing test files updated:

- `tests/unit/cli.test.ts` — The previous `--check` test (which treated `--check` as a no-op) is replaced with a test that `--check` without `--output` is a usage error. Three new tests cover `--check --output` with match, mismatch, and missing-reference cases.
- `tests/unit/engine.test.ts` — The `engine: llm directive end-to-end` block disables caching on its test config so each test exercises the directive's provider call in isolation; cache behavior is covered by the dedicated cache suite.

Manual verification against the acceptance criteria (built binary at `dist/cli.js`):

```bash
# 1. First run populates the cache; second run hits the cache.
# Set OPENAI_API_KEY (or have a config with apiKey).
mkdir -p /tmp/thoth-cache-demo && cd /tmp/thoth-cache-demo
cat > thoth.config.json <<EOF
{ "llm": { "apiKey": "sk-real" } }
EOF
cat > template.md <<EOF
@llm:summary
prompt: Reply with a single word.
@end
EOF

OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template.md
ls .doc-cache  # shows shard directories like 'ab/' 'cd/' etc.
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template.md  # identical output

# 2. Without OPENAI_API_KEY, second run still produces byte-identical output
#    (cache hits cover the @llm block).
unset OPENAI_API_KEY
node /mnt/d/src/thoth/dist/cli.js template.md   # exit 0, identical to the cached output

# 3. Modifying a context file invalidates the cache (next run regenerates).
cat > ctx.md <<EOF
initial content
EOF
cat > template2.md <<EOF
@llm:summary
context:
  - ctx.md
prompt: Say something.
@end
EOF
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template2.md  # populates cache
echo "changed content" > ctx.md
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template2.md  # regenerates, fresh response

# 4. Modifying a directive's prompt invalidates the cache.
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template2.md  # cache hit (prompt unchanged)
sed -i 's/Say something/Say something else/' template2.md
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template2.md  # regenerates

# 5. --check exits 0 on match, 3 on mismatch, 2 on missing --output.
cat > static.md <<EOF
# Hello
EOF
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js --check --output static.md static.md
echo "exit=$?"  # exit 0
echo "changed" > drifted.md
node /mnt/d/src/thoth/dist/cli.js --check --output drifted.md static.md
echo "exit=$?"  # exit 3, unified diff on stderr
node /mnt/d/src/thoth/dist/cli.js --check static.md 2>&1 | head -3
echo "exit=$?"  # exit 2 (usage error)

# 6. --no-cache always calls the provider, even on cache hits.
# First populate the cache.
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js template.md
# Then run with --no-cache: provider is called again, cache is bypassed.
OPENAI_API_KEY=sk-real node /mnt/d/src/thoth/dist/cli.js --no-cache template.md
```

## Review

**Decision: ACCEPT**

### Summary

All builds, tests, and lint pass:
- `npm run build` exits 0
- `npm test`: 260 unit tests pass (10 test files)
- `npm run test:llm`: 8 LLM-graded tests pass, including the new cache-hit reproduction test
- `npm run lint` exits 0

### Code quality

- **`src/cache.ts`**: Cache key computation matches `docs/architecture.md` §5 exactly. Sharded storage layout matches spec. Atomic writes with `.tmp` + rename and temp-file cleanup on failure. All I/O errors are non-fatal with warning. `isLlmCacheEntry` validates on-disk shape on read — corrupted/malformed entries are treated as misses.
- **`src/diff.ts`**: Clean LCS-based unified diff with standard `---`/`+++`/`@@` headers, `-`/`+`/` ` line prefixes, and configurable context-line hunk grouping. Returns empty string for identical inputs.
- **`src/directives/llm.ts`**: Cache consulted before provider call, written after successful provider response. Key computed from `(providerId, model, prompt, contextFiles)`, properly gated on `ctx.cache` and `ctx.config.cache.enabled`.
- **`src/engine.ts`**: `createCache` resolves relative `cacheDir` against `templateDir` (consistent with `@include` path resolution). Warn hook forwarded to `LlmCache`.
- **`src/cli.ts`**: `--check` without `--output` is a usage error (exit 2). `--check --output` renders to memory, compares bytes, exits 0 on match or 3 with unified diff on stderr. `--no-cache` wired to `cache.enabled: false`. Reference file ENOENT returns exit 2. USAGE text updated.
- **`src/types.ts`**: `DirectiveContext` gains optional `cache?: LlmCache`.

### Test coverage

Comprehensive across all code paths:
- Cache: key computation, get/put round-trip, persistence, shard layout, all error paths (ENOENT, malformed JSON, unexpected shape, mkdir failure, rename failure with temp cleanup), engine-level integration (first-run, second-run, prompt invalidation, context-file-change invalidation, no-cache bypass), `isLlmCacheEntry` shape validation.
- Diff: identical inputs, headers, prefixes, single/multi-hunk, merge-within-context, trailing newline.
- CLI: `--check` usage error, match (exit 0), mismatch (exit 3 with diff), missing reference (exit 2).
- LLM-graded: first run populates cache, second run reproduces byte-identical output.

### Architecture conformance

Consistent with `docs/architecture.md` §§ 5 (cache key spec) and 8 (CLI grammar). Module boundaries respected — no unintended coupling.

### Note

`.doc-cache/` is in `.gitignore` from the initial commit. The ticket's implementation correctly does **not** add or remove `.gitignore` entries. The design intent is to commit the cache, so the pre-existing `.gitignore` entry should be removed in a follow-up. Not a defect of this implementation.
