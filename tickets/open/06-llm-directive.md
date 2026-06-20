---
id: 06
type: task
status: open
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

- [ ] A template with `@llm` directives renders with the LLM's response inlined.
- [ ] The `OPENAI_BASE_URL` env var (or a `llm.baseUrl` config value) is honored; the provider hits the configured endpoint, not `api.openai.com`.
- [ ] The `OPENAI_API_KEY` env var (or a `llm.apiKey` config value) is sent in the request.
- [ ] A missing API key (no env, no config) produces exit code 1 with a stderr message.
- [ ] Config precedence matches `docs/architecture.md` §7.
- [ ] All unit tests pass.
- [ ] LLM-graded integration tests pass against a configured OpenAI-compatible endpoint.

## Notes

The cache is not yet implemented in this ticket. Each invocation calls the provider directly. Ticket #07 adds the cache layer on top.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
