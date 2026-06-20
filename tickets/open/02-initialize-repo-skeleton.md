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
