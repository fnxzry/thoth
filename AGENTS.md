# thoth

## Project Intent

`thoth` is a CLI tool that generates documents from a mix of static text, verbatim file includes (`@include`), and LLM-generated blocks (`@llm`).

> **Full details:** `docs/concept.md` (mission) and `docs/architecture.md` (design).

## Quick Start

```bash
npm install
npm run build
./dist/cli.js AGENTS.md                  # render AGENTS.md to stdout (sanity check)
```

## Architecture

Tool architecture: `docs/architecture.md`.

**Core concept:** A template is a text file. The tool parses it into blocks, resolves each block (static pass-through, file include, or LLM call with cached output), and writes the rendered result. LLM calls go through a `LlmProvider` abstraction; v0.1 ships an OpenAI implementation that supports custom `baseUrl` and `apiKey`.

**Design principles:** Static-by-default, deterministic rendering, content-addressed cache committed to the repo, config-file-with-env-override precedence, single-binary-style CLI surface.

> **Full details:** `docs/architecture.md` covers module boundaries, type definitions, directive grammar, cache key spec, and CLI grammar.

## Documentation

`docs/index.md` summarizes all project documentation. Read it first when orienting to the codebase.

## Running the Project

```bash
npm install
npm run build
npm test         # unit tests
npm run test:llm # LLM-graded integration tests (requires OPENAI_API_KEY)
npm run lint
```

## Ticketing System

This file describes the structure and organization of implementation tickets for the project.

### Ticket Format

Tickets follow the standard format described in `docs/ticketing-system.md`. Each ticket has YAML frontmatter (`id`, `type`, `status`, `description`) and sections for Overview, User-Facing Behavior (if applicable), Technical Requirements, Acceptance Criteria, Notes, Resolution, Testing, and Review.

### Ticket Organization

```
tickets/
├── open/          # New tickets awaiting implementation
├── in-progress/   # Tickets currently being worked on
├── in-validation/ # Completed tickets awaiting review
└── complete/      # Reviewed and approved tickets
```

## Testing Guide

This project uses a two-tier testing approach.

### Unit Tests (Vitest)

Unit tests are fast, isolated tests with all external calls mocked. They live in `tests/unit/`. Coverage must be very high — almost all code paths should be tested. Code paths involving timeouts and/or retries must be configurable to set small values for test purposes.

### LLM Integration Tests (Vitest)

LLM-graded tests validate real LLM provider behavior end-to-end against a configured OpenAI-compatible endpoint. They live in `tests/llm/` and require `OPENAI_API_KEY` (or equivalent). Run with `npm run test:llm`. They are excluded from the default `npm test` run.

## Coding Style

Comments should be relatively rare, especially inline comments for specific code lines or blocks.

Comments should:
- State code intent clearly and concisely. Comments should be brief.
- Point out non-obvious behavior.
- Indicate by-design or otherwise accepted workarounds, mitigations, or temporary measures.
- Treat the current architecture and set of decisions as the implied timeless design.

Comments should NOT:
- Reference specific ticket numbers, documents, or doc sections.
- Document code changes over time or decision sequences.

## Commit Message Format

```
<task | issue | chore | design>: <one-line description> (ticket #NN)

<point-form description of changes>
```

## Important Boundaries

- Do not read or write any files beginning with `HUMAN-*`.
- Avoid using tools to ask questions. Just ask through normal messages.

## Agent Usage

Use subagents (via the `subagents` tool) liberally. Do not delegate a complete ticket to an agent; you are responsible for organizing the work. Do use subagents to execute subtasks, create plans, gather context, do research, get a second opinion, review work, run tests, etc.

## Golden Rule

Ask the user if you need clarification, have trouble making a decision, or need any help. If you find yourself going in circles, ask what to do next.
