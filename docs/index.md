# Documentation Index

This file summarizes the project documentation. It includes a list of all important project documents, along with summaries and guidelines on when to read each document.

## Index

### `docs/concept.md`

**Summary:** The project's mission: what `thoth` is, who it's for, and what it is not. Establishes the core values (static-by-default, deterministic, reproducible).
**When to read:** When making design decisions or evaluating whether a new feature fits the project's scope.

### `docs/architecture.md`

**Summary:** The tool's technical architecture: module boundaries, type definitions, directive grammar, cache key spec, config schema, env var precedence, and CLI grammar.
**When to read:** When implementing, reviewing, or extending any part of the tool. This is the contract that code must satisfy.

### `docs/testing.md`

**Summary:** Overview of the project's two-tier test strategy (unit + LLM-graded) and how to run each.
**When to read:** When adding tests, running tests, or deciding where a test belongs.

### `docs/ticketing-system.md`

**Summary:** Ticket format, lifecycle, and organization. Mirror of the ticket format used in `AGENTS.md`.
**When to read:** When creating, working on, or reviewing tickets.

`docs/code-structure.md` is deferred until the implementation has settled and there is real structure to describe.
