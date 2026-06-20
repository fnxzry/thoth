# Testing

This project uses a two-tier testing approach. Unit tests are fast and run by default. LLM-graded integration tests require credentials and are run on demand.

## Unit Tests (Vitest)

Located in `tests/unit/`. All external calls (filesystem, network) are mocked. Test individual functions and modules. Coverage must be very high — almost all code paths should be exercised.

Tests for code paths involving timeouts and/or retries must be configurable to set small timeouts for test purposes (e.g. a `timeoutMs` parameter on the function under test).

Run with:

```bash
npm test
```

## LLM Integration Tests (Vitest)

Located in `tests/llm/`. Make real calls to a configured OpenAI-compatible endpoint. Used to verify that:

- The `OpenAIProvider` correctly hits a custom `baseUrl` (validated against a non-`api.openai.com` endpoint).
- The `llm` directive produces coherent output for representative templates.
- The cache correctly serves cached responses on a cache hit.

These tests require `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL`, `OPENAI_MODEL`). They are excluded from the default `npm test` run.

Run with:

```bash
npm run test:llm
```

A separate `vitest.llm.config.ts` is provided with longer timeouts suitable for live LLM calls.

## Test authoring guidelines

- Unit tests check observable behavior, not implementation details.
- Each directive has a unit-test suite that exercises the directive in isolation with a stubbed `DirectiveContext`.
- The LlmProvider interface is unit-tested with a stub implementation; the OpenAI implementation is exercised by the LLM integration tier.
- The cache is unit-tested with a temporary directory for storage.
