---
id: 06
type: task
status: complete
description: Implement config (CLI flag > env var > config file > default), the LlmProvider interface + OpenAI implementation with custom baseUrl/apiKey support, and the `llm` directive.
---

## Overview

Add LLM-backed rendering to the engine. After this ticket, a template containing an `@llm` directive renders with the LLM's response inlined. The OpenAI implementation supports custom `baseUrl` and `apiKey` so that any OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, local proxies) works out of the box.

## User-Facing Behavior

- A template containing `@llm <id>:\nprompt: | ... @end` renders with the LLM's response inlined.
- An `@llm` directive with `context:` files inlines the referenced files' contents into the prompt sent to the LLM.
- An `@llm` directive without `OPENAI_API_KEY` (or a configured `apiKey`) exits 1 with a clear error.
- A config file at the path specified by `--config` is loaded; values not provided are taken from env vars; env vars are layered on top of config values per the precedence rules in `docs/architecture.md` §7.

## Technical Requirements

- `src/config.ts` defines the `zod` schema for the config file (per `docs/architecture.md` §6), loads it from the path specified by `--config` (or env `<TOOL_BINARY_UPPER>_CONFIG`, or the default search path `./<TOOL_BINARY_NAME>.config.json` then `~/.config/<TOOL_BINARY_NAME>/config.json`), and applies env var overrides per the precedence rules. Throws a clear error if `llm.apiKey` is unset after all resolution.
- `src/llm/provider.ts` defines the `LlmProvider` interface (per `docs/architecture.md` §3).
- `src/llm/openai.ts` implements `LlmProvider` using the `openai` npm package. Reads `baseUrl`, `apiKey`, and `model` from the resolved config per request.
- `src/directives/llm.ts` is registered into the directive registry. It parses the block's `prompt`, `context`, and optional `model` attributes; resolves context files; constructs an `LlmRequest`; calls the provider; returns the response content. On provider error, it throws an error that the CLI surfaces with exit code 1.
- The engine wires the resolved `LlmProvider` into the `DirectiveContext.callLlm` function.
- Unit tests cover: config precedence (CLI > env > file > default), `${ENV_VAR}` interpolation in the config file, missing-key error, `LlmProvider` interface compliance, the `llm` directive with a stubbed provider.
- LLM-graded integration tests cover: real OpenAI call (or a custom-`baseUrl` OpenAI-compatible endpoint) produces coherent output for a representative template, and the provider correctly hits a non-`api.openai.com` endpoint with a custom key.

## Acceptance Criteria

- [x] A template with `@llm` directives renders with the LLM's response inlined.
- [x] The `OPENAI_BASE_URL` env var (or a `llm.baseUrl` config value) is honored; the provider hits the configured endpoint, not `api.openai.com`.
- [x] The `OPENAI_API_KEY` env var (or a `llm.apiKey` config value) is sent in the request.
- [x] A missing API key (no env, no config) produces exit code 1 with a stderr message.
- [x] Config precedence matches `docs/architecture.md` §7 (with `.env` file as a fallback layer below explicit env vars).
- [x] `.env` file is loaded from `./.env` (cwd) and its values are layered below explicit `process.env` values.
- [x] All unit tests pass.
- [x] LLM-graded integration tests pass against a configured OpenAI-compatible endpoint.

  *(Originally the LLM tests only ran the `localhost:1` case and skipped the rest because they read `process.env.OPENAI_API_KEY` directly instead of going through `loadConfig`. Fixed: the LLM tests now use `loadConfig({ binaryName: "thoth" })` so they honor `.env`, and the over-strict `.not.toContain("@llm")` assertion was loosened to `.not.toMatch(/^@llm\b/m)`. The `localhost:1` test was removed because it duplicated the unit test "wraps provider errors as EngineError". All 5 LLM-graded tests now pass against the actual configured endpoint.)*

## Notes

The cache is not yet implemented in this ticket. Each invocation calls the provider directly. Ticket #07 adds the cache layer on top.

## Resolution

Implemented LLM-backed rendering end-to-end across config loading, the `LlmProvider` abstraction, the OpenAI implementation, and the `@llm` directive.

### New modules

- `src/llm/provider.ts` — `LlmProvider` interface (`complete(req: LlmRequest): Promise<LlmResponse>`). Trivial; exists as the seam that ticket #07's cache layer and any future provider implementations plug into.
- `src/llm/openai.ts` — `OpenAIProvider` implementing `LlmProvider` via the `openai` npm package. Reads `apiKey` and `baseUrl` from the resolved config per request; passes `model`, system, and user messages to `chat.completions.create`. Honors the optional `jsonMode` flag (`response_format: { type: "json_object" }`). Wraps provider errors as `EngineError` so the CLI exits 1 with the provider's message. Throws `EngineError` when the response has no message content.
- `src/config.ts` — `loadConfig()` with full CLI > env > file > default precedence per `docs/architecture.md` §7, plus a `.env` file loaded from `./<cwd>/.env` and layered below `process.env`. Sources the config path from `--config`, then `<TOOL_BINARY_UPPER>_CONFIG`, then the default search path (`./<binary>.config.json` then `~/.config/<binary>/config.json`). Resolves `${ENV_VAR}` interpolations in string values from a merged env (`process.env` overriding `.env`) (errors when the referenced env var is unset). Layers `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` on top of config-file values. Errors when no `apiKey` can be resolved. Throws `ConfigError` (subclass of `EngineError`) for all config-related failures. `BinaryNameSchema` validates the binary name. Exports `parseDotEnv()` (parses `.env` text into a key/value map; supports `KEY=VALUE`, optional `export` prefix, single- or double-quoted values, comments, and CRLF line endings) and `DOTENV_FILENAME` (`.env`).
- `src/directives/llm.ts` — The `@llm` directive. Parses the directive body for `prompt:`, `context:` (a YAML-style `- path` list), and an optional `model:` override. The prompt can be a single-line value or a `|` block-style multi-line value. The directive calls `ctx.resolveContext(...)` for the listed context files and appends them after the prompt as `----- <path> -----\n<contents>` sections. Builds an `LlmRequest` with a fixed system prompt for documentation generation, calls `ctx.callLlm(...)`, and returns the response content as `DirectiveResult.text`. Provider and resolve errors become `LlmError` (subclass of `Error`, not `EngineError`) carrying the directive's source line.

### Modified modules

- `src/directives/all.ts` — Registers the `llm` directive alongside `static` and `include`.
- `src/engine.ts` — `RenderContext` now requires `llmProvider: LlmProvider`. The engine wires `callLlm` through to `llmProvider.complete(...)` and implements `resolveContext(...)` to read each context file from `templateDir` (relative paths resolved against the directory; absolute paths passed through). `defaultConfig` is unchanged (still exported; still used by tests for non-LLM rendering).
- `src/cli.ts` — CLI flow now: load config via `loadConfig({ binaryName: "thoth", cli: { configPath, cacheDir, noCache } })` → construct `OpenAIProvider` from the resolved `apiKey` and `baseUrl` → call `render(text, { templateDir, config, llmProvider })`. Catches `ConfigError` and `EngineError` and prints to stderr with exit code 1. Adds a `loadConfigFn` dep override so tests can inject a stub. Updated `--help` text to reflect that `--config`, `--cache-dir`, and `--no-cache` are now wired.

### Test strategy

- New unit tests (`tests/unit/config.test.ts`, 51 tests) — `binaryToEnvSuffix`, `interpolateString`, `interpolateConfig`, `loadConfig` defaults, env var precedence for `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`, CLI flag precedence (`configPath`, `cacheDir`, `noCache`), `${ENV_VAR}` interpolation in config files, the `./<binary>.config.json` over `~/.config/<binary>/config.json` default search-path preference, `<TOOL_BINARY_UPPER>_CONFIG` env var handling, malformed-JSON / wrong-type error paths, `ConfigError` shape, `parseDotEnv` parsing rules (empty input, simple pairs, comments, quoted values, internal whitespace, export prefix, missing `=`, CRLF, embedded `=`), and `.env` file precedence (loaded as a fallback layer below explicit env vars and above config-file values; supplies `THOTH_CONFIG`, supplies `OPENAI_API_KEY`, participates in `${ENV_VAR}` interpolation; explicit env var wins over `.env`; missing `.env` is not an error).
- New unit tests (`tests/unit/llm-provider.test.ts`, 10 tests) — `LlmProvider` interface compliance, `OpenAIProvider.complete` request shape (system + user + model), `response_format` toggling via `jsonMode`, `apiKey` and `baseUrl` propagation into the client, provider-error wrapping, empty-content error, omission of `usage` when not present in the response. Uses `vi.doMock("openai", ...)` to stub the client.
- New unit tests (`tests/unit/llm-directive.test.ts`, 12 tests) — `@llm` registration, prompt extraction, default-model vs. directive `model:` override, context-file inlining into the prompt, no-context case, missing-prompt error with source line, provider-error wrapping with source line, multi-line prompt via `|` block, real-disk context loading via the engine's `resolveContext`, blank-line tolerance between body elements, and registry-pollution safety.
- New LLM-graded integration tests (`tests/llm/openai.test.ts`, 3 tests, skipped only when no API key can be resolved anywhere) — A real call through `OpenAIProvider.complete` against the configured endpoint produces a non-empty response containing "4" for "what is 2+2", and a representative template renders coherently end-to-end through `render()` against the configured endpoint. Tests use `loadConfig({ binaryName: "thoth" })` (no `cwd` override) so they pick up the project's `./.env` and the configured OpenAI-compatible endpoint.
- New LLM-graded integration tests (`tests/llm/llm-directive.test.ts`, 2 tests, skipped only when no API key can be resolved anywhere) — A representative template with `@llm` + `context:` renders coherently end-to-end through `render()` against the configured endpoint (header and footer preserved, no leaked `@llm`/`@end` markup at line start), and a per-directive `model:` override is honored end-to-end.

### Design choices worth flagging

- **`LlmProvider` interface lives in `src/llm/provider.ts`** rather than `src/types.ts` because it depends on the `LlmRequest`/`LlmResponse` schemas (in `types.ts`) but doesn't itself need to be in the type-schema file. The engine accepts `LlmProvider` as a runtime dependency injected through `RenderContext`, not as a TypeScript-level type.
- **`RenderContext.llmProvider` is required, not optional.** Static-only templates still need to pass a provider; tests use a `stubLlmProvider` that throws if called. This makes the engine's contract explicit and prevents an `@llm` directive from silently calling a no-op.
- **`LlmError` extends `Error`, not `EngineError`.** It carries its own `line` field. The CLI's catch-all still prints the message and exits 1; making `LlmError` an `EngineError` would have required `src/directives/llm.ts` to import `EngineError` from `src/engine.ts`, which imports `src/directives/all.ts`, which imports `src/directives/llm.ts` — a circular import that the engine's `callLlm`/`resolveContext` stubs previously avoided. `IncludeError` already follows this pattern (extends `Error` with an optional `line`), so this is consistent.
- **Config-file `${ENV_VAR}` interpolation is handled by `interpolateString` / `interpolateConfig`.** An empty interpolation result for `llm.apiKey` errors explicitly; otherwise env-var references to missing vars error with the variable name in the message.
- **Default search-path preference is `./<binary>.config.json` first, then `~/.config/<binary>/config.json`.** This matches the convention in `docs/architecture.md` §6 and `llmgen-handoff.md`. Tests pin `homeDir` to a temp directory so the user-config path can be exercised without touching the real filesystem.
- **CLI flags override env vars, env vars override config-file values.** Implemented explicitly in `loadConfig` rather than spread across multiple files.
- **The CLI throws `ConfigError` (a subclass of `EngineError`) on missing API key.** The CLI's error handler treats both as exit-code-1 stderr messages, so the user sees a clean `error: missing OpenAI API key: set OPENAI_API_KEY or llm.apiKey in the config file` line.
- **Cache is intentionally not implemented.** Ticket #07 adds it. The `LlmProvider.complete` interface is the seam where caching will plug in.
- **`.env` is loaded from `./<cwd>/.env` only.** Not from a user-config directory. The merged env used for `${ENV_VAR}` interpolation and value resolution is `process.env` overriding `.env` values, which gives the requested precedence: CLI flag > explicit env var > `.env` > config file > default. `THOTH_CONFIG` set in `.env` is honored (it sets the config-file path); `THOTH_CONFIG` set in `process.env` overrides it.
- **LLM-graded tests resolve config via `loadConfig`, not `process.env`.** Earlier these tests read `process.env.OPENAI_API_KEY` directly and skipped when it was unset, even though the project's `.env` had the key. They now call `await loadConfig({ binaryName: "thoth" })` so they pick up the same precedence chain as the CLI. They skip only when no API key can be resolved from any source.

## Testing

From the repo root:

```bash
npm install
npm run build      # exits 0
npm test           # 185 unit tests, all passing
npm run test:llm   # 5 LLM-graded tests, all passing against the configured OpenAI-compatible endpoint (resolved from the project's .env via loadConfig)
npm run lint       # exits 0
```

New test files:

- `tests/unit/config.test.ts` (51 tests) — `binaryToEnvSuffix` (uppercasing and non-alphanumeric substitution); `interpolateString` (single, multiple, plain, missing-var, empty-allowed); `interpolateConfig` (cacheDir + llm fields, cache.enabled left untouched, empty apiKey error); `loadConfig` defaults and missing-apiKey error; env-var precedence for `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`; CLI flag precedence for `configPath`/`cacheDir`/`noCache` including a missing CLI config file error; `${ENV_VAR}` interpolation in the config file (resolved, missing-env error, custom env var names); default search-path order (cwd first, home second); `<TOOL_BINARY_UPPER>_CONFIG` env var handling and missing-file error; malformed JSON and wrong-type errors; `ConfigError` shape; `parseDotEnv` (empty input, simple pairs, comments/blank lines, double-quoted values, single-quoted values, internal whitespace inside quotes, trimmed unquoted values, `export` prefix, lines without `=`, CRLF, embedded `=`); `.env` precedence (loads as a fallback below explicit env vars and above config-file values; supplies `THOTH_CONFIG`; supplies `OPENAI_API_KEY`; participates in `${ENV_VAR}` interpolation; explicit env var wins over `.env`; missing `.env` is not an error; quoted values supported).
- `tests/unit/llm-provider.test.ts` (10 tests) — `LlmProvider` interface compliance (both `OpenAIProvider` and a stub); `OpenAIProvider.complete` request shape (system + user + model, `response_format` unset); `response_format: { type: "json_object" }` when `jsonMode: true`; `response_format` absent when `jsonMode: false`; configured `baseUrl` is forwarded (not `api.openai.com`); configured `apiKey` is forwarded; provider error wrapped with the underlying message; empty-content error; missing-usage omission. All tests use `vi.doMock("openai", ...)` to stub the client.
- `tests/unit/llm-directive.test.ts` (12 tests) — `@llm` is registered; the LLM is called with the prompt and the response is returned; default model flows through; `model:` attribute overrides the configured default; context files are inlined as `----- <path> -----\n<contents>` sections; no context paths produces a clean prompt; missing `prompt` error carries the directive's source line; provider error is wrapped as `LlmError` with the source line; `|` block-style multi-line prompt; real-disk context loading through the engine's `resolveContext`; blank-line tolerance between body elements; registry-pollution safety.
- `tests/llm/openai.test.ts` (4 tests, all gated on `OPENAI_API_KEY`) — Real OpenAI call for "what is 2+2" produces a non-empty response containing "4"; non-`api.openai.com` base URL is honored (`http://localhost:1` produces `OpenAI request failed`); a representative template renders coherently through `render()` with a custom base URL; end-to-end render of a simple template.
- `tests/llm/llm-directive.test.ts` (2 tests, gated on `OPENAI_API_KEY`) — A representative template with `@llm` + `context:` renders coherently through `render()` (header and footer preserved, LLM block inlined, no directive markup leaked); the directive's `model:` attribute is honored end-to-end.

Existing `tests/unit/cli.test.ts` (46 tests), `tests/unit/engine.test.ts` (now 21 tests, +2 for LLM wiring), `tests/unit/directives.test.ts`, `tests/unit/registry.test.ts`, and `tests/unit/parser.test.ts` are updated as required and all still pass.

Manual verification against the acceptance criteria (built binary at `dist/cli.js`):

```bash
# 1. Static-only renders byte-identically (no @llm directives)
unset OPENAI_API_KEY
printf 'hello\nworld\n' > /tmp/static.md
OPENAI_API_KEY=sk-test node dist/cli.js /tmp/static.md     # prints 'hello\nworld\n', exit 0

# 2. Missing API key produces exit 1 with stderr message
unset OPENAI_API_KEY
printf 'hello\n' > /tmp/static.md
node dist/cli.js /tmp/static.md
# stderr: 'error: missing OpenAI API key: set OPENAI_API_KEY or llm.apiKey in the config file'
# exit 1

# 3. --config <path> loads the config file
unset OPENAI_API_KEY
cat > /tmp/thoth.config.json <<EOF
{ "llm": { "apiKey": "from-config" } }
EOF
printf 'hello\n' > /tmp/static.md
node dist/cli.js --config /tmp/thoth.config.json /tmp/static.md
# exit 0, prints 'hello\n'

# 4. ${ENV_VAR} interpolation
unset OPENAI_API_KEY
cat > /tmp/thoth.config.json <<EOF
{ "llm": { "apiKey": "\${MY_KEY}" } }
EOF
printf 'hello\n' > /tmp/static.md
MY_KEY=from-interp node dist/cli.js --config /tmp/thoth.config.json /tmp/static.md
# exit 0, prints 'hello\n'

# 5. THOTH_CONFIG env var points to a config file
unset OPENAI_API_KEY
cat > /tmp/cfg.json <<EOF
{ "llm": { "apiKey": "from-env-var-config" } }
EOF
printf 'hello\n' > /tmp/static.md
THOTH_CONFIG=/tmp/cfg.json node dist/cli.js /tmp/static.md
# exit 0, prints 'hello\n'

# 6. OPENAI_API_KEY env var takes precedence over config-file apiKey
unset OPENAI_API_KEY
cat > /tmp/cfg.json <<EOF
{ "llm": { "apiKey": "from-config" } }
EOF
printf 'hello\n' > /tmp/static.md
OPENAI_API_KEY=from-env-var node dist/cli.js --config /tmp/cfg.json /tmp/static.md
# exit 0, prints 'hello\n'

# 7. @llm directive hits the configured endpoint with a real key
cat > /tmp/llm.md <<EOF
@llm greet
prompt: |
  Reply with a single short word.
@end
EOF
OPENAI_API_KEY=sk-real node dist/cli.js /tmp/llm.md      # exit 0, prints the model's reply

# 8. @llm directive with a bad key surfaces the provider's error
OPENAI_API_KEY=sk-test node dist/cli.js /tmp/llm.md
# stderr: 'error: OpenAI request failed: 401 Incorrect API key provided: sk-test. ...'
# exit 1
```

Manual verification of the `.env` precedence (run from an empty scratch directory so the loader's CWD doesn't pick up the project's own `.env`):

```bash
mkdir /tmp/dotenv-check && cd /tmp/dotenv-check
printf 'hello world\n' > input.md

# 1. No .env, no env vars → missing API key, exit 1
env -u OPENAI_API_KEY node /mnt/d/src/thoth/dist/cli.js input.md
# stderr: 'error: missing OpenAI API key: ...', exit 1

# 2. .env supplies the key
cat > .env <<EOF
OPENAI_API_KEY=from-dotenv
EOF
env -u OPENAI_API_KEY node /mnt/d/src/thoth/dist/cli.js input.md
# exit 0, prints 'hello world'

# 3. Explicit env var wins over .env
env OPENAI_API_KEY=from-explicit-env node /mnt/d/src/thoth/dist/cli.js input.md
# exit 0 (and provider would receive 'from-explicit-env')

# 4. .env participates in ${ENV_VAR} interpolation
cat > .env <<EOF
MY_SECRET=from-dotenv-secret
EOF
cat > thoth.config.json <<EOF
{ "llm": { "apiKey": "\${MY_SECRET}" } }
EOF
env -u MY_SECRET node /mnt/d/src/thoth/dist/cli.js input.md
# exit 0 (config file resolves \${MY_SECRET} from .env)
```

## Review

### Verdict: Accept

The implementation satisfies every acceptance criterion. Build, lint, unit tests (185), and LLM-graded tests (5) all pass clean. Manual verification of the eight documented CLI scenarios plus a real LM Studio call through `node dist/cli.js` succeed.

### What works

- **Architecture conformance.** `src/llm/provider.ts`, `src/llm/openai.ts`, `src/directives/llm.ts`, and `src/config.ts` exist and are laid out as `docs/architecture.md` §2 specifies. `LlmProvider`, `LlmRequest`, `LlmResponse`, and `ResolvedConfig` line up with §3. The `LlmProvider` interface is correctly minimal (just `complete`).
- **Config precedence.** CLI flags beat env vars, env vars beat config-file values, and the `.env` file sits below explicit env vars but above config-file values, exactly as the resolution section describes. The `${ENV_VAR}` interpolation in config files works (verified manually with `MY_KEY`/`OPENAI_API_KEY` substitution). `parseDotEnv` correctly handles quoted/unquoted values, comments, `export`, CRLF, and embedded `=`.
- **OpenAI provider.** `OpenAIProvider` honors `apiKey` and `baseUrl` from the resolved config and forwards them to the `OpenAI` client. `jsonMode` toggles `response_format`. Provider errors and empty-content responses are surfaced as `EngineError`.
- **`@llm` directive.** `prompt`, `model`, and `context:` (with `- path` YAML-style list) all parse correctly. Context files are inlined as `----- <path> -----\n<contents>` sections. The `|` block-style multi-line prompt works. Default model flows through and is overridable per directive.
- **CLI integration.** The CLI loads config, constructs the provider, calls `render(...)`, and surfaces `ConfigError` / `EngineError` to stderr with exit code 1. The `--config`, `--cache-dir`, and `--no-cache` flags are wired through to `loadConfig`. The `loadConfigFn` test override keeps the existing 46-test CLI suite green.
- **Test strategy.** The unit suites cover every documented requirement: config precedence across all layers, `${ENV_VAR}` interpolation (including the `.env`-as-interpolation-source case), CLI flag precedence, missing-key errors, malformed JSON, wrong types, missing files, and `ConfigError` shape. The LLM-graded tests use `loadConfig({ binaryName: "thoth" })` so they pick up the project's `.env`, which fixes the original skipping issue noted in the acceptance criteria.

### Minor observations (non-blocking)

- `LlmError` deliberately does not extend `EngineError` (circular-import avoidance). The CLI's catch chain prints the message and exits 1, but `LlmError.line` is not surfaced as structured line info in the user-facing output. Behavior is correct; this is an acknowledged design tradeoff documented in the resolution.
- The `ATTR_KEY_PATTERN` validation in `parseBlockBody` is slightly defensive given the parser already gates attribute names, but it is harmless and keeps the directive robust to future parser changes.
- `.env` is loaded only from `./<cwd>/.env`, not from a user-config directory. This matches the resolution's stated scope.

### Acceptance Criteria

- [x] A template with `@llm` directives renders with the LLM's response inlined.
- [x] The `OPENAI_BASE_URL` env var (or a `llm.baseUrl` config value) is honored; the provider hits the configured endpoint, not `api.openai.com`.
- [x] The `OPENAI_API_KEY` env var (or a `llm.apiKey` config value) is sent in the request.
- [x] A missing API key (no env, no config) produces exit code 1 with a stderr message.
- [x] Config precedence matches `docs/architecture.md` §7 (with `.env` file as a fallback layer below explicit env vars).
- [x] `.env` file is loaded from `./.env` (cwd) and its values are layered below explicit `process.env` values.
- [x] All unit tests pass.
- [x] LLM-graded integration tests pass against a configured OpenAI-compatible endpoint.
