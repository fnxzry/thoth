# `llmgen-handoff.md` — Bootstrap for a AI-native Doc-Generation Tool

This document is the bootstrap for a new, standalone repository: a CLI tool that generates text documents from a mix of static text, verbatim file includes, and LLM-generated content. It is intended to be consumed in a fresh, empty repository by the agent or developer who will implement the tool.

---

## How to use this document

This handoff produces a fully-scaffolded repository from a clean slate.

**Reading order:**

1. Read **Mission** to understand what is being built and why.
2. Read **Repo Skeleton** to see the target directory layout.
3. Execute **Bootstrap Files** — for each file in that section, create the named path with the contents shown.
4. Read **Tool Design Specification** end-to-end. This is the contract that implementation tickets must satisfy. Do not extract any of this section into files; it is reference material for the implementation work.
5. Execute **Ticket Backlog** — for each ticket, create the named file in `tickets/open/` with the contents shown, then begin implementation in numerical order.
6. Track progress against **v0.1 Acceptance Criteria**.

**File path markers.** Each bootstrap file is preceded by an HTML comment of the form `<!-- FILE: <path> -->`. Create exactly that path with the contents that follow.

**Tickets.** Each ticket in the **Ticket Backlog** is preceded by `<!-- TICKET: <path> -->` and uses the standard frontmatter format described in `docs/ticketing-system.md`.

---

## Mission

`thoth` is a CLI tool that generates text documents from sources. Authors write a text file (the "template") containing a mix of:

- **Static text** — text that is passed through unchanged.
- **Verbatim file includes** — directives that inline the contents of another file at the directive's location.
- **LLM-generated content** — directives that invoke an LLM with a prompt (and optional context files) and inline the response.

The tool renders the template into a final document, supporting deterministic regeneration via a content-addressed cache so that committed output remains stable when inputs are unchanged. It supports custom OpenAI-compatible endpoints (Azure OpenAI, OpenRouter, local proxies, etc.) out of the box.

**Out of scope for v0.1:** non-OpenAI providers, additional directives beyond `static`, `include`, and `llm`, parallel block rendering, streaming output, plugin loading, web UI, CI workflows.

---

## Repo Skeleton

The target layout after consuming the bootstrap:

```
.
├── .agents/
│   └── skills/
│       ├── brainstorm/SKILL.md
│       ├── complete-ticket/SKILL.md
│       ├── create-ticket/SKILL.md
│       ├── elaborate/SKILL.md
│       ├── review-ticket/SKILL.md
│       ├── select-ticket/SKILL.md
│       └── task-breakdown/SKILL.md
├── .gitignore
├── .env.example
├── AGENTS.md                              # static seed (no directives yet)
├── README.md
├── docs/
│   ├── README.md
│   ├── concept.md
│   ├── architecture.md
│   ├── testing.md
│   ├── ticketing-system.md
│   └── index.md
├── package.json
├── src/
│   ├── cli.ts                             # CLI entrypoint, arg parsing, exit codes
│   ├── engine.ts                          # parse → resolve → render pipeline
│   ├── parser.ts                          # text → Block[]
│   ├── directives/
│   │   ├── index.ts                       # directive registry
│   │   ├── static.ts                      # `static` (default, pass-through)
│   │   ├── include.ts                     # `include` directive
│   │   └── llm.ts                         # `llm` directive
│   ├── llm/
│   │   ├── provider.ts                    # LlmProvider interface
│   │   └── openai.ts                      # OpenAI implementation
│   ├── cache.ts                           # content-addressed filesystem cache
│   ├── config.ts                          # config file + env var precedence
│   └── types.ts                           # zod schemas + inferred types
├── tickets/
│   ├── open/                              # implementation backlog (created by ticket #1+)
│   ├── in-progress/
│   ├── in-validation/
│   └── complete/
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.js
```

`docs/code-structure.md` is deliberately deferred. It will be added once the implementation has settled and there is real structure to describe.

---

## Bootstrap Files

<!-- FILE: .gitignore -->

```gitignore
node_modules/
dist/
coverage/
test-results/
.doc-cache/
*.log
.DS_Store
.env
.env.local
```

<!-- FILE: .env.example -->

```bash
# Path to a config file (JSON). If unset, the tool searches ./thoth.config.json
# and ~/.config/thoth/config.json in that order.
DOCGEN_CONFIG=

# OpenAI (or OpenAI-compatible) provider credentials and endpoint.
# Required for any document containing @llm directives unless cache hits cover them.
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

Note: `DOCGEN_CONFIG` is the prefix matching `thoth`. If the binary is renamed, rename this env var accordingly.

<!-- FILE: package.json -->

```json
{
  "name": "thoth",
  "version": "0.1.0",
  "description": "Text generation tool with file includes and LLM-summarized blocks.",
  "type": "module",
  "bin": {
    "thoth": "./dist/cli.js"
  },
  "main": "./dist/cli.js",
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "build:docs": "thoth --config ./docs.config.json AGENTS.md",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:llm": "vitest run --config vitest.llm.config.ts",
    "lint": "eslint src tests",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "openai": "^4.52.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.2",
    "@typescript-eslint/parser": "^8.61.1",
    "eslint": "^9.39.4",
    "globals": "^15.15.0",
    "tsx": "^4.11.2",
    "typescript": "^5.4.5",
    "typescript-eslint": "^8.61.1",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=22"
  },
  "license": "MIT"
}
```

<!-- FILE: tsconfig.json -->

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

<!-- FILE: vitest.config.ts -->

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

<!-- FILE: vitest.llm.config.ts -->

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/llm/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

<!-- FILE: eslint.config.js -->

```javascript
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".doc-cache/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  }
);
```

<!-- FILE: README.md -->

````markdown
# thoth

A CLI tool that generates documents from a mix of static text, verbatim file includes, and LLM-generated content.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
<T> <input.md>                 # render to stdout
<T> <input.md> > output.md    # render to file
<T> --check <input.md>         # exit non-zero if rendered output differs from disk
<T> --config path/to/cfg.json <input.md>
```

`<T>` = `thoth`.

See `AGENTS.md` for agent-facing instructions and `docs/concept.md` for the design overview.

## License

MIT
````

<!-- FILE: AGENTS.md -->

````markdown
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
````

<!-- FILE: docs/README.md -->

````markdown
# Documentation

This directory holds the living design and reference documentation for `thoth`. Start with `docs/index.md`, which summarizes every document and when to read it.
````

<!-- FILE: docs/concept.md -->

````markdown
# Concept

## What this tool is

`thoth` is a CLI tool that generates documents from sources. Authors write a **template** — a text file containing a mix of static text, verbatim file includes, and LLM-generated blocks. The tool renders the template into a final document.

## Who it's for

Software projects that maintain a small set of human-facing text documents (e.g. `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, internal docs indexes) which need to stay in sync with other files in the repo. Examples of such documents:

- An agent-facing instructions file that summarizes the project's architecture and points to the canonical architecture doc.
- A docs index that lists each project document with a one-line summary and a "when to read" note.
- A README that pulls in the current version, license, and installation instructions from canonical sources.

Today, projects that want this either hand-maintain these documents (with the usual drift) or write ad-hoc scripts. `thoth` is the general-purpose, version-controllable version of the ad-hoc script.

## Core values

- **Static by default.** Anything in a template that is not a directive is passed through unchanged. Authors can read and edit a template directly.
- **Deterministic.** Given the same template, the same config, and a populated cache, the tool produces byte-identical output. This makes generated output safe to commit and safe to compare in code review.
- **Reproducible without network access.** A populated cache covers all `@llm` blocks. Regeneration against committed cache hits requires no LLM credentials.
- **Single source of truth.** When a referenced doc changes, regenerating the template that summarizes it produces updated text automatically. There is no manual sync step.
- **Honest about LLM limits.** LLM blocks are clearly delimited in the template and identifiable in the output. Anyone reading the rendered document can see what came from a model and what came from a human.

## Non-goals

- Not a static site generator. The tool renders one document at a time and does not manage navigation, theming, or HTML output.
- Not a documentation hosting platform. The output is a text document committed to the user's repo.
- Not a templating language in the general sense. The directive set is intentionally small (`static`, `include`, `llm`) and is not extensible via user-defined directives in v0.1.
- Not a multi-provider LLM platform in v0.1. OpenAI-compatible endpoints are supported; other providers are deferred.
````

<!-- FILE: docs/architecture.md -->

````markdown
# Architecture

## 1. High-level shape

`thoth` is a single-process Node CLI. The pipeline is:

```
input.md ──► parser ──► [Block] ──► engine ──► output.md
                                │
                                ├─► directives (static / include / llm)
                                ├─► LlmProvider (OpenAI)
                                └─► cache (filesystem, content-addressed)
```

CLI arg parsing and exit-code handling live in `src/cli.ts`. The engine orchestrates parse → resolve → render. Directives are pluggable via a registry in `src/directives/`.

## 2. Module boundaries

```
src/
├── cli.ts           # arg parsing, --config / --check / --output flags, exit codes
├── engine.ts        # parse → resolve → render pipeline; wires directives + LLM + cache
├── parser.ts        # text → Block[] (pure function, no I/O)
├── directives/
│   ├── index.ts     # directive registry: register(name, impl)
│   ├── static.ts    # default; pass-through
│   ├── include.ts   # reads a referenced file and inlines its contents
│   └── llm.ts       # calls LlmProvider, optionally consults cache
├── llm/
│   ├── provider.ts  # LlmProvider interface
│   └── openai.ts    # OpenAI implementation (supports custom baseUrl + apiKey)
├── cache.ts         # content-addressed filesystem cache
├── config.ts        # config file schema + env var precedence
└── types.ts         # zod schemas + inferred TS types
```

Each module owns one concern. `parser.ts` and `cache.ts` are the only modules with I/O besides the OpenAI client.

## 3. Core types (signatures)

```typescript
// A parsed chunk of the template. Either static text or a directive invocation.
type Block =
  | { kind: "static"; text: string }
  | { kind: "directive"; name: string; id: string;
      attributes: Record<string, unknown>; body: string };

// What a directive receives and returns. body is the raw text inside the
// directive's @<name>...@end block (excluding the @<name> and @end lines).
interface DirectiveContext {
  block: Block;                       // the directive block being rendered
  resolveContext(paths: string[]): Promise<Map<string, string>>;
  callLlm(req: LlmRequest): Promise<LlmResponse>;
  config: ResolvedConfig;
}

interface DirectiveResult {
  text: string;                       // text to inline at this block's position
}

// LLM provider contract.
interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

interface LlmRequest {
  system: string;
  user: string;
  model: string;
  jsonMode?: boolean;
}

interface LlmResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

// Resolved configuration (after CLI flag > env var > config file > default).
interface ResolvedConfig {
  configPath?: string;
  cacheDir: string;                   // default: "./.doc-cache"
  llm: {
    provider: "openai";               // v0.1: only "openai"
    apiKey: string;                   // resolved from env or config
    baseUrl: string;                  // resolved from env or config
    defaultModel: string;             // resolved from env or config
  };
  cache: {
    enabled: boolean;                 // default: true
  };
}
```

## 4. Directive grammar

A directive block has the form:

```
@<name>[ <id>] [<key>=<value>]*:
<key>=<value>          # optional, repeated
[prompt: |
<prompt text on one or more lines>]
[context:
  - <path relative to template dir>
  - <path>...]
@end
```

Concrete examples:

```
@include doc-summary

@llm architecture-summary
context:
  - docs/architecture.md
prompt: |
  Summarize this document in two paragraphs.
@end
```

The `static` directive is implicit: any text not inside a `@<name>...@end` block is treated as static.

Directive registry contract:

```typescript
type DirectiveImpl = (ctx: DirectiveContext) => Promise<DirectiveResult>;

declare module "./directives" {
  interface DirectiveRegistry {
    register(name: string, impl: DirectiveImpl): void;
    get(name: string): DirectiveImpl;
  }
}
```

## 5. Cache key spec

The cache key for an LLM block is:

```
sha256(
  provider-id             # "openai"
  || "\n" || model        # e.g. "gpt-4o"
  || "\n" || canonical(prompt)
  || "\n" || sorted(context-file-hashes).join("\n")
)
```

- `canonical(prompt)` is the prompt with trailing whitespace removed and a final newline appended.
- `context-file-hashes` is the list of `sha256(file-content)` for each context file referenced by the directive, sorted lexicographically.
- The cache entry value is the rendered LLM response (the text inlined into the output) plus its usage metadata.

Cache entries are stored at `./.doc-cache/<key-prefix>/<key>.json`. The directory is committed to the repo so regeneration without API access reproduces byte-identical output.

## 6. Config file schema

The config file (JSON) has this shape:

```json
{
  "cacheDir": "./.doc-cache",
  "cache": { "enabled": true },
  "llm": {
    "provider": "openai",
    "apiKey": "${OPENAI_API_KEY}",
    "baseUrl": "${OPENAI_BASE_URL}",
    "defaultModel": "${OPENAI_MODEL}"
  }
}
`

String values of the form `${ENV_VAR}` are resolved at load time from the process environment. This lets users commit a config file without leaking secrets.

## 7. Env var precedence

Resolution order (highest priority first):

1. CLI flags (`--cache-dir`, `--no-cache`, etc. — v0.1 may not implement all; the contract is "any CLI flag beats any env var beats any config file value").
2. Environment variables:
   - `<TOOL_BINARY_UPPER>_CONFIG` (path to config file)
   - `OPENAI_API_KEY`
   - `OPENAI_BASE_URL`
   - `OPENAI_MODEL`
3. Values in the config file (with `${ENV_VAR}` interpolations resolved).
4. Built-in defaults: `cacheDir = "./.doc-cache"`, `cache.enabled = true`, `llm.provider = "openai"`, `llm.baseUrl = "https://api.openai.com/v1"`.

Where `<TOOL_BINARY_UPPER>` is the binary name uppercased with non-alphanumerics replaced by `_` (e.g. binary `gen` → `GEN_CONFIG`; binary `doc-builder` → `DOC_BUILDER_CONFIG`).

## 8. CLI grammar

```
<T> [--config <path>] [--check] [--output <path>] [--cache-dir <path>] [--no-cache] <input.md>

<T> --help
<T> --version
```

- `<input.md>` is required (unless `--help` or `--version`).
- If `--output` is omitted, output goes to stdout.
- `--check` reads the file at `--output` (or fails if `--output` is omitted), renders to memory, and exits non-zero if the rendered bytes differ. Used for drift detection.
- `--no-cache` bypasses the cache (always calls the provider). Useful for forced refresh.
- Exit codes: `0` success, `1` rendering error, `2` usage error, `3` drift detected (only with `--check`).
````

<!-- FILE: docs/testing.md -->

````markdown
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
````

<!-- FILE: docs/ticketing-system.md -->

````markdown
# Ticketing System

This file describes the structure and organization of implementation tickets for the project.

## Ticket Format

Tickets in this project follow a specific markdown format:

```markdown
---
id: NN
type: task | issue
status: open | in-progress | in-validation | complete
description: <Brief description of what this is about>
---

## Overview

<Detailed explanation of what needs to be done>

## User-Facing Behavior

<What the user sees/does - if applicable>

## Technical Requirements

<Implementation details - if already known>

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

<Additional context, considerations, or references>

## Resolution

<Notes provided by implementer describing what they did>

## Testing

<Description of how to test the changes, provided by implementer>

## Review

**Decision:** Accept | Reject

<Review comments and rationale>
```

## Ticket Organization

Tasks and issues are tracked as markdown files organized by status in subdirectories:

```
tickets/
├── open/          # New tickets awaiting implementation
├── in-progress/   # Tickets currently being worked on
├── in-validation/ # Completed tickets awaiting review
└── complete/      # Reviewed and approved tickets
```

**Creating Tickets:**
- New tickets go in `tickets/open/` with initial status `open`.
- Use the `create-ticket` skill to create properly formatted tickets.

**Working on Tickets:**
- Use the `complete-ticket` skill to implement tickets.
- When starting: move ticket from `open/` to `in-progress/`.
- When done: move ticket from `in-progress/` to `in-validation/`.

**Reviewing Tickets:**
- Use the `review-ticket` skill to review completed work.
- If approved: move ticket from `in-validation/` to `complete/`.
````

<!-- FILE: docs/index.md -->

````markdown
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
````

<!-- FILE: .agents/skills/brainstorm/SKILL.md -->

````markdown
---
name: brainstorm
description: Derive architecture and user experience concepts for high-level feature descriptions
---

You are working with the user to flesh out a high-level feature idea into concepts and systems that fit in with or extend the existing project architecture and user experience design.
Your goal is to define new required concepts, update project documentation accordingly, and prepare handoff documentation for more detailed elaboration of the feature.

## Getting started

The user should have provided a description of the feature. If not, ask them for a description.

Refer to available project documentation and code to understand how the feature relates to:
- the architecture and user experience structure
- the current project state

## Concept refinement

Interview the user and propose ideas to establish a shared understanding of the feature and how users will experience it. Think outside the box! This process is about introducing new concepts, so it's natural that some ideas will be good and some will be discarded.

Once the feature concept is established, analyze whether the current project architecture needs to be extended to support it. If changes are needed to the architecture or user experience concepts, present the identified gaps to the user. Work through the gaps one by one using the same interview process.

When all conceptual gaps are filled, present a summary of:
1. The conceptual changes that were established.
2. The feature concept, as agreed upon, and how it's supported by the new architecture and UX concepts.

Iterate on this phase until all proposed changes are agreed upon.

## Task completion

Once all project and feature concepts are agreed:
- Update the project documentation with the agreed conceptual changes.
- Prepare a feature handoff document that describes the feature concept, how it relates to existing systems, and how it's supported by architecture and UX concepts. Write this to `docs/features/<feature-name>.md`.
````

<!-- FILE: .agents/skills/complete-ticket/SKILL.md -->

````markdown
---
name: complete-ticket
description: Software implementation agent to complete a single self-contained ticket
---

Paths are relative to the project root.

You are implementing a single ticket for the project.

## Task selection

Check the in-progress tickets.
- If there is one ticket in progress, select it.
- If there are no tickets in progress, inform the user and stop.
- If there are multiple tickets in progress, ask the user which one you should work on.

## Task execution

Your task is to implement the selected in-progress ticket.

When planning your work, ensure your plan conforms to the project plan and architecture. When coding, keep comment verbosity in mind; refer to the coding standards.

Check your work regularly to ensure it is correct and still conforms to the project plan and architecture. You must include tests at all applicable levels: unit and LLM-graded integration (where applicable to the change).

For tasks:
- New unit tests are mandatory.
- New LLM-graded integration tests are mandatory for changes or additions that interact with an external LLM provider.

For issues that are bugs:
- Ensure a test demonstrating the issue fails before the fix and passes after the fix.

Also check for failures in existing tests that may be related to your changes. Do not run test suites by default if they should not be impacted based on the architecture and test strategy (e.g. the LLM suite).

## Task completion and signoff

When you are sure you have successfully completed the work:
- Write a concise description of your changes to the "Resolution" section of the ticket. Include any significant choices you made along the way.
- Describe how to test your changes in the "Testing" section of the ticket. This must describe how a human user can verify the changes are correct.
- Do not change any other sections of the ticket.
- Move the ticket from `tickets/in-progress/` to `tickets/in-validation/` and set the ticket's status to "in-validation".

## Review process

A reviewer will either accept or reject the work. If the work is rejected, you will be asked to address the review comments. After addressing the comments, update the "Resolution" section so that it describes the totality of the work.

You may not mark the ticket complete or change the "Review" section. Those actions may only be done by a reviewer.
````

<!-- FILE: .agents/skills/create-ticket/SKILL.md -->

````markdown
---
name: create-ticket
description: Creates a new ticket (task or issue) in the tickets directory with proper formatting
---

You are a ticket creation assistant. Your job is to create well-formatted tickets (tasks or issues) in the `tickets` directory.

## How to Create a Ticket

1. **Determine the ticket ID:** Look at existing tickets in the status subdirectories within `tickets/` and use the next incremental number.

2. **Determine the type:**
   - Use `type: task` for:
     - User-facing features
     - Improvements to production code/infrastructure
   - Use `type: issue` for:
     - Bugs or other defects
     - Improvements to test code/infrastructure

3. **Gather information from the user:**
   - Title/description of the ticket
   - Whether it's a task or issue
   - Current status (usually `open` — new tickets go in `tickets/open/`)
   - Details about the problem or feature
   - Relevant architecture references
   - Acceptance criteria
   - Any notes or context
   - Ask questions.

4. **Create the file:** Write the ticket to `tickets/<status>/<id>-<slug>.md` where:
   - `<status>` is the ticket status subdirectory: `open`, `in-progress`, `in-validation`, or `complete`.
   - `<id>` is the next available number (padded to 2 digits).
   - `<slug>` is a short URL-friendly identifier (kebab-case).
   - Example: `tickets/open/14-e2e-test-failures-with-real-llm.md`.

5. **Confirm to the user:** Let them know the ticket was created and where.

## Guidelines

- Write clear, concise descriptions.
- Include architecture/spec references where relevant.
- Provide requirements, specifications, and acceptance criteria.
- You may provide examples to illustrate a point, but in general do not explicitly specify solution code, documentation content, or other implementation details. Stick to descriptions of requirements, and observable behaviors or outcomes.
- List specific acceptance criteria that can be verified independently.
- For issues, explain the problem clearly (with examples if relevant) and reference any failing tests.
- For tasks, describe the user-facing behavior and technical requirements.

Ask the user for any clarification you need to create a complete ticket.
````

<!-- FILE: .agents/skills/elaborate/SKILL.md -->

````markdown
---
name: elaborate
description: Clarify the requirements of a feature to be implemented
---

You are preparing to design a feature for the project.
Your task is to clarify the requirements for the feature, how it fits into the existing project, and document changes to the project architecture, user experience, or processes.

## Getting started

The user should have provided a description of the feature. If not, ask them for a description.

Refer to available project documentation and code to understand how the feature relates to:
- the architecture and user experience structure
- the current project state

## Requirements gathering

Interview the user to establish a shared understanding of how the feature should work and what the user experience should be.
Once you and the user agree how the feature should work, identify any deviations from the already-planned architecture and user experience.

If new architecture or user experience concepts are required:
- Interview the user to reach a shared understanding of what changes are needed. Consider extensibility (propose potential future extensions), maintenance, code complexity, costs, testability, and other relevant considerations. Be pragmatic.
- Once the conceptual changes are established (if needed), propose changes to the project documentation to record the changes. Apply the changes once the user agrees.

## Task completion

Ask the user whether they would like to:
- write the feature elaboration to a document (propose a path), or
- directly use the `task-breakdown` skill to break the feature into actionable tasks.
````

<!-- FILE: .agents/skills/review-ticket/SKILL.md -->

````markdown
---
name: review-ticket
description: Code-review and quality-control agent for reviewing ticket completion
---

Paths are relative to the project root.

You are a code-review and quality-control agent helping to develop the project.

## Task overview

Your job is only to review ticket completion and quality. You must not create or edit any code or spec files.

## Ticket selection

A development agent has just moved a ticket to `tickets/in-validation/`. The agent must have also filled in the "Resolution" and "Testing" sections of the ticket describing their work and how to test it. If they did not, reject the ticket. Use these sections to guide your review, but do not trust that they are correct, and do not restrict your validations to the listed tests.

## Review instructions

Review the agent's actual work to ensure:
- Correctness and completeness of the task.
- Conformance to the project architecture and scope.
- Test coverage is sufficient and tests pass.
- Linter raises no issues with the change.

Consider all test suites (unit, LLM-graded) which could potentially be affected by the changes.

In case of failing tests, if the problem is clear, indicate that in your review. Do not spend time investigating.

Write your accept/reject decision with concise comments to the "Review" section of the ticket. You may also indicate passed/failed entries under "Acceptance Criteria". Do not change any other sections of the ticket.

If you decide to accept the work, move the ticket from `tickets/in-validation/` to `tickets/complete/` and mark the ticket's status `complete`.
````

<!-- FILE: .agents/skills/select-ticket/SKILL.md -->

````markdown
---
name: select-ticket
description: Select the most important ticket to work on next
---

Paths are relative to the project root.

You are selecting the development task that is most important to work on next for the project.

## Task selection

Look in `tickets/open/` and `tickets/in-progress/` to find incomplete tickets.
- Prioritize in-progress tickets over open tickets.
- Prioritize issues over tasks.
- Ticket numbers reflect creation order and not priority.
- Select the MOST IMPORTANT ticket to work on next.
- If the ticket is open, move it from `tickets/open/` to `tickets/in-progress/` and set the ticket's status to `in-progress`.

## Output

Report the task you selected and why.
````

<!-- FILE: .agents/skills/task-breakdown/SKILL.md -->

````markdown
---
name: task-breakdown
description: Break down a feature or larger task into individual actionable tickets
---

You are designing a feature for the project.
Your task is to break a high-level feature or task description into individual actionable tickets that can be implemented and tested.

## Getting started

The user should have provided a description of the feature or task. If not, ask them for a description.

Refer to available project documentation and code to understand how the feature relates to the current project state and the architecture and user experience structure that it fits into.

Interview the user to establish a shared understanding of how the feature should work and how it should be implemented.

## Task breakdown

Once you and the user agree how the feature should work, break it into individual work items. There can be dependencies between items, but they do not need to form a strict dependency chain.

Important: each work item must be testable and demoable individually so that developers, testers, and users can observe the progress and correctness of each ticket.

Consider the effects of the changes on existing tests and whether steps can be structured or ordered to simplify test changes and reduce the risk of each step.

Present the planned work items (brief description of each) and any dependencies between them to the user.

## Ticket creation

Once the user agrees on the items and dependencies, refer to the `create-ticket` skill and create a new ticket for each work item. Avoid duplicating content from the project documentation into the tickets — add references to the documentation where needed.
````

---

## Tool Design Specification

This section restates the design contract that the implementation must satisfy. It is reference material; do not extract it into files.

### Pipeline

```
input.md ──► parser.ts ──► Block[] ──► engine.ts ──► output string
                                            │
                                            ├─► directives/{static,include,llm}.ts
                                            ├─► llm/{provider,openai}.ts
                                            ├─► cache.ts
                                            └─► config.ts (resolved once at startup)
```

### Directive grammar (formal)

A template is a sequence of **blocks**. A block is either:

- **Static text** — any text not enclosed in a directive block.
- **Directive block** — text delimited by `@<name>[ <id>] ... @end` on its own lines. The `@<name>` and `@end` lines are not part of the directive's body.

A directive block's header may carry an id (required for cacheable directives like `@llm`, optional for others). The body between the header and `@end` is parsed as a list of attribute lines of the form `<key>: <value>` or `<key>: |` (for multiline values, where the following lines until the next attribute or `@end` are the value's content).

Recognized attributes for `@llm`:

- `prompt` (required) — the prompt sent to the LLM.
- `context` (optional) — a YAML-like list of file paths (one per line, prefixed with `- `) to be loaded and included in the prompt.
- `model` (optional) — overrides the configured default model for this block.

Recognized attributes for `@include`:

- (none; the body is unused, and the file to include is taken from the id.)

### Cache key

For `@llm` directives:

```
key = sha256(
  provider        // "openai" in v0.1
  + "\n" + model
  + "\n" + canonical(prompt)   // trim trailing whitespace, append one newline
  + "\n" + concat(sorted(sha256(file-content) for file in context))
)
```

The cache stores JSON:

```json
{
  "content": "<rendered text>",
  "usage": { "promptTokens": 123, "completionTokens": 456 },
  "storedAt": "2026-06-19T12:00:00.000Z"
}
```

Storage path: `./.doc-cache/<key[0:2]>/<key[2:4]>/<key>.json`. Sharded prefix avoids huge directories.

### Config schema (zod)

```typescript
const ConfigSchema = z.object({
  cacheDir: z.string().default("./.doc-cache"),
  cache: z.object({ enabled: z.boolean().default(true) }).default({}),
  llm: z.object({
    provider: z.literal("openai").default("openai"),
    apiKey: z.string(),
    baseUrl: z.string().url().default("https://api.openai.com/v1"),
    defaultModel: z.string().default("gpt-4o"),
  }),
});
```

`apiKey` is required. If absent from the config file, the loader falls back to the `OPENAI_API_KEY` environment variable and errors if neither is set.

### Env var precedence

1. CLI flags.
2. Env: `<TOOL_BINARY_UPPER>_CONFIG`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.
3. Config file values (with `${ENV_VAR}` interpolation resolved at load).
4. Built-in defaults.

`${ENV_VAR}` interpolation: any string value in the config file matching `^\$\{[A-Z_][A-Z0-9_]*\}$` is replaced with the value of that env var. Missing env vars cause an error at load time.

### CLI grammar

```
<T> [--config <path>] [--check] [--output <path>] [--cache-dir <path>] [--no-cache] <input.md>
<T> --help
<T> --version
```

Exit codes:

- `0` — success.
- `1` — rendering error (e.g. LLM call failed, cache write failed, file not found).
- `2` — usage error (e.g. missing input, unknown flag).
- `3` — drift detected (only with `--check`).

### Error handling

- Errors during parsing or directive resolution print to stderr with a clear message and the source location (line number) of the offending block when available.
- LLM provider errors bubble up as exit code 1 with the provider's error message in the output.
- Cache write errors are non-fatal: a warning is printed and rendering continues without caching.

---

## Ticket Backlog

Each ticket below is in the standard format. Extract each to `tickets/open/<id>-<slug>.md`.

<!-- TICKET: tickets/open/01-write-initial-design-docs.md -->

```markdown
---
id: 01
type: task
status: open
description: Author the initial design docs (concept, architecture, testing, ticketing-system, index) so the implementation has a written contract to follow.
---

## Overview

Produce the project's first design documents before any code lands. The goal is that anyone reading the docs can answer: what is this tool, how is it structured, how is it tested, and how is work tracked? These docs become the contract that the implementation tickets must satisfy.

This ticket depends on the `package.json` and `tsconfig.json` not yet existing; the docs are written into the planned paths from the bootstrap. After this ticket, `docs/concept.md`, `docs/architecture.md`, `docs/testing.md`, `docs/ticketing-system.md`, and `docs/index.md` exist with real content adapted from `llmgen-handoff.md`.

## User-Facing Behavior

No runtime behavior. The repo gains a populated `docs/` directory that reviewers and contributors can read.

## Technical Requirements

- `docs/concept.md` describes the tool's mission, intended audience, core values, and non-goals (adapted from `llmgen-handoff.md` Mission section).
- `docs/architecture.md` describes module boundaries, type signatures, directive grammar, cache key spec, config schema, env var precedence, and CLI grammar (adapted from the Tool Design Specification).
- `docs/testing.md` describes the two-tier test strategy (unit + LLM-graded), how to run each, and authoring guidelines.
- `docs/ticketing-system.md` describes the ticket format and lifecycle.
- `docs/index.md` is a summary table of all docs with one-line summaries and "when to read" notes.
- A `docs/README.md` is also included as a short pointer to `docs/index.md`.

## Acceptance Criteria

- [ ] `docs/concept.md`, `docs/architecture.md`, `docs/testing.md`, `docs/ticketing-system.md`, `docs/index.md`, and `docs/README.md` exist.
- [ ] Each doc is internally consistent with the others (e.g. names of types and modules match across docs).
- [ ] `docs/index.md` accurately summarizes each doc in one or two sentences.
- [ ] No doc references project-specific details that would not apply to this tool (e.g. game-engine terminology).

## Notes

The handoff `llmgen-handoff.md` contains the source content for each doc; lift from there and adapt as needed. Do not duplicate content from the handoff into tickets.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
```

<!-- TICKET: tickets/open/02-initialize-repo-skeleton.md -->

```markdown
---
id: 02
type: task
status: open
description: Set up the project's repo skeleton: package.json, tsconfig, ESLint, Vitest, .gitignore, .env.example, README, static AGENTS.md.
---

## Overview

Create the scaffolding that turns an empty repo into a working Node + TypeScript project. After this ticket, `npm install && npm test && npm run build` all succeed (with zero tests).

## User-Facing Behavior

- `npm install` succeeds.
- `npm test` runs Vitest and exits 0 (with no tests yet).
- `npm run build` compiles TypeScript to `dist/` with no errors.
- `npm run lint` runs ESLint with no errors.
- `npm run dev` invokes the (not-yet-existent) CLI via `tsx` for live iteration.

## Technical Requirements

- `package.json` is ESM (`"type": "module"`), targets Node 22+, declares dependencies `openai` and `zod`, and devDependencies for `typescript`, `tsx`, `vitest`, `eslint`, `typescript-eslint`, `@types/node`, and `globals`. Includes `bin` entry pointing at `./dist/cli.js`. Includes scripts: `build`, `build:docs`, `test`, `test:watch`, `test:llm`, `lint`, `dev`.
- `tsconfig.json` uses `module: "NodeNext"`, `target: "ES2023"`, `strict: true`, `outDir: "./dist"`, `rootDir: "./src"`.
- `vitest.config.ts` and `vitest.llm.config.ts` exist with the standard config (unit tests by default; LLM tests via separate command with longer timeouts).
- `eslint.config.js` is flat-config ESLint 9 with `typescript-eslint` recommended rules.
- `.gitignore` excludes `node_modules/`, `dist/`, `coverage/`, `test-results/`, `.doc-cache/`, `*.log`, `.DS_Store`, `.env`, `.env.local`.
- `.env.example` documents `DOCGEN_CONFIG`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.
- `README.md` has install + usage sections.
- `AGENTS.md` is the static seed from the handoff (no directives yet).

## Acceptance Criteria

- [ ] All files listed in Technical Requirements exist with the specified contents.
- [ ] `npm install` exits 0.
- [ ] `npm test` exits 0 (no tests, but the runner is wired up).
- [ ] `npm run build` exits 0 and produces `dist/cli.js` (the file may be empty/stub at this point; full CLI comes in ticket #04).
- [ ] `npm run lint` exits 0.
- [ ] `dist/cli.js` does not yet implement meaningful behavior; that is ticket #04's responsibility.

## Notes

The handoff `llmgen-handoff.md` contains the file contents to lift. Replace placeholder names (`thoth`, `thoth`, etc.) with the chosen values.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
```

<!-- TICKET: tickets/open/03-initialize-skills-and-ticket-dirs.md -->

```markdown
---
id: 03
type: task
status: open
description: Create the .agents/skills/ tree and tickets/ status subdirectories, with adapted SKILL.md files mirrored from llmgen-handoff.md.
---

## Overview

Set up the project's agent-skill set and ticket directory structure so that the project workflow skills (create-ticket, complete-ticket, review-ticket, etc.) are available and tickets have a place to live.

## User-Facing Behavior

No runtime behavior. The project gains:
- `.agents/skills/{brainstorm,elaborate,task-breakdown,create-ticket,complete-ticket,select-ticket,review-ticket}/SKILL.md` with content adapted from the handoff (project-specific details removed).
- `tickets/{open,in-progress,in-validation,complete}/` directories.

## Technical Requirements

- Each `SKILL.md` exists with the frontmatter (`name`, `description`) and content adapted from the handoff. Project-specific terms (e.g. "adventure game", "the game") are replaced with neutral language ("the project").
- The seven skill names match exactly: `brainstorm`, `elaborate`, `task-breakdown`, `create-ticket`, `complete-ticket`, `select-ticket`, `review-ticket`.
- `tickets/{open,in-progress,in-validation,complete}/` exist as empty directories (add a `.gitkeep` if necessary for git to track them).
- A `tickets/README.md` does NOT exist (the directory layout is documented in `docs/ticketing-system.md` instead, matching the source project's convention).

## Acceptance Criteria

- [ ] All seven skill directories exist with their `SKILL.md` files.
- [ ] Each `SKILL.md` is internally consistent with the project (no game-engine terminology, no references to docs that do not exist in this repo).
- [ ] `tickets/{open,in-progress,in-validation,complete}/` exist and are tracked by git.
- [ ] Running the `create-ticket` skill produces a well-formed ticket in `tickets/open/`.

## Notes

The handoff `llmgen-handoff.md` contains the SKILL.md contents under the Bootstrap Files section. Lift verbatim.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
```

<!-- TICKET: tickets/open/04-cli-copy-tool.md -->

```markdown
---
id: 04
type: task
status: open
description: Implement a minimal CLI that reads a text file and writes it to stdout, proving the CLI shape end-to-end before any directive logic lands.
---

## Overview

Build the first runnable version of the CLI. It does not parse directives yet; it simply copies input to output. The point is to validate the CLI surface (arg parsing, `--help`, `--version`, exit codes, error messages) before any directive complexity lands. This is the foundation that tickets #05+ replace with the real engine.

## User-Facing Behavior

- `<T> <input.md>` reads `<input.md>` and writes its contents to stdout.
- `<T> --help` prints usage to stdout and exits 0.
- `<T> --version` prints the version from `package.json` and exits 0.
- `<T> <nonexistent.md>` prints an error to stderr and exits 2.
- `<T>` with no args and no flags prints usage to stderr and exits 2.

## Technical Requirements

- Implementation lives in `src/cli.ts`.
- Arg parsing is hand-rolled (no external CLI library). Recognized flags: `--help`, `--version`, `--config`, `--check`, `--output`, `--cache-dir`, `--no-cache`. Recognized positional: one input file. Other flags print an error to stderr and exit 2.
- The copy logic is a trivial read-and-write: read the input file as UTF-8 text, write to stdout (or to `--output` if specified).
- Errors from the filesystem layer (ENOENT, EACCES) produce a stderr message that includes the offending path and exit 2.
- Exit codes: 0 success, 1 unexpected runtime error, 2 usage error (CLI never returns 3 in this ticket; that is `--check`'s responsibility in ticket #07).

## Acceptance Criteria

- [ ] `<T> <input.md>` produces stdout identical to the file's contents.
- [ ] `<T> --help` exits 0 and lists all flags defined in the CLI grammar (the help text can mention flags not yet implemented but should not claim behavior that does not exist).
- [ ] `<T> --version` exits 0 and prints the version from `package.json`.
- [ ] `<T> <nonexistent.md>` exits 2 with a stderr message including the path.
- [ ] `<T>` with no args exits 2 with a usage message on stderr.
- [ ] Unit tests cover each of the above scenarios.
- [ ] The `--config`, `--check`, `--output`, `--cache-dir`, and `--no-cache` flags are accepted by the parser (they may be no-ops in this ticket) so that the surface does not need to change later.

## Notes

Ticket #05 will replace the copy logic with the parse-then-render pipeline. Keep the CLI shape stable so that ticket #05 is a clean swap of the internal pipeline.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
```

<!-- TICKET: tickets/open/05-templating-engine-without-llm.md -->

```markdown
---
id: 05
type: task
status: open
description: Implement the templating engine: core types, directive registry, `static` and `include` directives, and wire them into the CLI replacing the copy logic.
---

## Overview

Build the templating engine end-to-end for the directives that do not require an LLM. After this ticket, the CLI correctly handles static text (pass-through) and `@include` directives (verbatim file inclusion). The CLI's copy logic from ticket #04 is replaced by the parse → resolve → render pipeline.

## User-Facing Behavior

- A template containing only static text renders identically to its source.
- A template containing `@include <path>` directives renders with the referenced file's contents inlined at the directive's location.
- A template containing a malformed directive (e.g. unknown directive name, missing `@end`) prints a clear error to stderr identifying the source line and exits 1.

## Technical Requirements

- `src/types.ts` defines the `zod` schemas and inferred TS types for `Block`, `DirectiveContext`, `DirectiveResult`, `ResolvedConfig`, plus internal types for parser/directive use.
- `src/parser.ts` is a pure function that takes a template string and returns `Block[]`. It splits on directive headers (`@<name>[ <id>]` at the start of a line) and `@end` lines. Static text between directives is one block per region.
- `src/directives/index.ts` exposes a registry: `register(name: string, impl: DirectiveImpl)` and `get(name: string): DirectiveImpl`. Throws on duplicate registration or unknown name.
- `src/directives/static.ts` is a pass-through that returns the block's body unchanged. (Static text outside directive blocks is handled by the engine directly; this directive is registered so that `@static <id>: ... @end` is also recognized if used.)
- `src/directives/include.ts` reads the file at the path specified by the directive's id, relative to the template's directory, and returns its contents.
- `src/engine.ts` orchestrates parse → for each block, look up the directive and call it with a `DirectiveContext` → concatenate results → return the rendered string.
- `src/cli.ts`'s copy logic is replaced by a call to the engine. The CLI flags remain unchanged from ticket #04.
- Unit tests cover: parser (multiple blocks, nested-looking static text, malformed directives), directive registry, static directive, include directive (with both relative and absolute paths), engine pipeline end-to-end.
- File-system reads in unit tests use a temporary directory.

## Acceptance Criteria

- [ ] A template containing only static text renders byte-identically to the source.
- [ ] A template containing `@include foo.md` inlines `foo.md`'s contents at that position.
- [ ] A template with multiple `@include` directives resolves them all in order.
- [ ] A template containing an unknown directive (e.g. `@bogus`) exits 1 with a stderr message naming the directive and the line number.
- [ ] A template containing a directive without a matching `@end` exits 1 with a clear error.
- [ ] All unit tests pass; coverage of `src/parser.ts`, `src/directives/`, and `src/engine.ts` is high (>90%).
- [ ] `<T> --check` is still a no-op in this ticket; the full drift-detection behavior lands in ticket #07.

## Notes

The directive grammar is defined in `docs/architecture.md` §4. The block model from `docs/architecture.md` §3 is the contract for `Block`.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

<filled in by reviewer>
```

<!-- TICKET: tickets/open/06-llm-directive.md -->

```markdown
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
```

<!-- TICKET: tickets/open/07-caching-and-drift-detection.md -->

```markdown
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
```

---

## v0.1 Acceptance Criteria

`thoth` v0.1 is complete when:

- All seven tickets (#01–#07) are in `tickets/complete/`.
- `npm install && npm run build && npm test` succeeds.
- `<T> <input.md>` runs end-to-end against a sample template containing at least one `@include` and one `@llm` directive.
- `<T> --check <input.md> --output <reference.md>` exits 0 when `<input.md>` renders to `<reference.md>`, and 3 with a diff hint when it does not.
- Running `<T> <input.md>` a second time, with `OPENAI_API_KEY` unset, produces byte-identical output (cache hits).
- A test renders a template against an OpenAI-compatible endpoint with a custom `baseUrl` and `apiKey`, confirming the provider hits the configured endpoint and authenticates correctly.
- Static `AGENTS.md` exists at the repo root (adoption of this tool in the source repo `adventure-agent` is out of scope for v0.1).

## Out of Scope for v0.1

The following are explicitly deferred to v0.2+:

- `docs/code-structure.md`.
- Additional directives: `var` (template variables), `tree` (filesystem-tree-as-code-block), conditional `ifChanged`.
- Non-OpenAI providers (Anthropic, local models via Ollama, etc.).
- Parallel block rendering.
- Streaming output.
- Plugin loading from disk (allowing third-party directives).
- A web UI for previewing rendered documents.
- CI workflow files (e.g. GitHub Actions running `--check` on PRs).
- README.md / CONTRIBUTING.md template generation (the tool is general-purpose; bringing other repos' templates under it is a separate effort).
- Adoption of this tool in the source `adventure-agent` repository (will be done as a separate task).
````
