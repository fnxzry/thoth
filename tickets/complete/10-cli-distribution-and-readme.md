---
id: 10
type: task
status: complete
description: Make thoth easily installable as a standalone CLI and update README.md with comprehensive installation and usage documentation
---

## Overview

The `package.json` already declares a `bin` entry (`"thoth": "./dist/cli.js"`) and the compiled output carries a node shebang. However, the project lacks a polished install/uninstall story and the README is a bare skeleton. This ticket covers the packaging-side work to ensure `thoth` works cleanly as a globally installed CLI, plus a full rewrite of `README.md` with proper installation, configuration, and usage documentation.

## User-Facing Behavior

Users should be able to install and run `thoth` in any of these ways:

- **Global install from npm:** `npm install -g thoth` → `thoth input.md` works.
- **Local dev install:** `npm install` in the repo root, then `npm link` or `npx thoth`.
- **Direct execution:** `./dist/cli.js input.md` after `npm run build`.
- **Clean uninstall:** `npm uninstall -g thoth` removes the binary.

Running `thoth --help` should print the usage summary from `docs/architecture.md` §8.

The README should be a self-contained user guide covering install, config, usage, caching, and examples — sufficient for someone to adopt `thoth` without reading the source or internal docs.

## Technical Requirements

- Verify that `tsc` preserves the `#!/usr/bin/env node` shebang in `dist/cli.js` across clean builds.
- Ensure `package.json`'s `"files"` array is correct and includes all runtime artifacts (`dist/`, `README.md`, `LICENSE`). Exclude `src/`, `tests/`, `docs/`, `tickets/`, and dev config files.
- The `bin` entry should remain `./dist/cli.js`.
- Add a `--help` / `--version` handler in `src/cli.ts` that prints usage to stdout and exits 0 (see architecture §8 for grammar). This is the only code change; everything else is docs and packaging verification.
- Rewrite `README.md` to include:
  - A one-line description and a short "what is thoth" paragraph.
  - **Installation:** global install, local dev (`npm install && npm run build`), `npm link` for development.
  - **Quick start:** a concrete, copy-pasteable one-command example.
  - **Usage:** all CLI flags (`--config`, `--check`, `--output`, `--cache-dir`, `--no-cache`), stdin mode, exit codes.
  - **Template syntax:** static text, `@include`, `@llm` (one-liner and multi-line), labels.
  - **Configuration:** config file shape, env var precedence, `${ENV_VAR}` interpolation.
  - **Caching:** what gets cached, where the cache lives, how to force-fresh regeneration.
  - **Examples:** 2-3 realistic snippets (e.g., generating an AGENTS.md, a docs index, a README).
- Keep the README focused on end-user consumption; agent/internal docs remain in `AGENTS.md` and `docs/`.

## Acceptance Criteria

- [x] `npm run build` followed by `./dist/cli.js --help` prints usage and exits 0.
- [x] `npm run build` followed by `./dist/cli.js --version` prints the version from `package.json` and exits 0.
- [x] `npm pack --dry-run` shows only `dist/`, `README.md`, `LICENSE`, and `package.json` in the tarball.
- [x] The shebang line is present in compiled `dist/cli.js`.
- [x] README contains all sections listed in Technical Requirements.
- [x] All examples in README are valid and can be copy-pasted (paths relative to a hypothetical user project).
- [x] Existing unit tests pass (`npm test`).

## Resolution

No code changes were needed — `--help` and `--version` were already fully implemented in `src/cli.ts` with the correct behavior (usage to stdout, exit 0). The shebang was already present and preserved by `tsc`. The `package.json` `bin` and `files` fields were already correct.

Changes made:
- Wrote `LICENSE` (MIT) to satisfy the `files` array in `package.json`.
- Rewrote `README.md` with comprehensive installation instructions, full CLI usage reference, template syntax guide, configuration documentation, caching explanation, and three realistic examples.

## Testing

Verified all acceptance criteria:
- `./dist/cli.js --help` prints usage, exits 0
- `./dist/cli.js --version` prints `0.1.0`, exits 0
- `npm pack --dry-run` contains only `dist/`, `README.md`, `LICENSE`, `package.json`
- `head -1 dist/cli.js` shows `#!/usr/bin/env node`
- All 260 unit tests pass (`npm test`)

## Review

✅ **ACCEPTED.** All acceptance criteria pass:
- `--help` prints usage to stdout, exits 0.
- `--version` prints `0.1.0` from `package.json`, exits 0.
- `npm pack --dry-run` contains only `dist/`, `README.md`, `LICENSE`, `package.json` — no `src/`, `tests/`, `docs/`, or `tickets/`.
- Shebang `#!/usr/bin/env node` is present and preserved by `tsc`.
- README covers install (global, local, source, `npm link`), quick start, full CLI usage reference with all flags and exit codes, template syntax (`@include`, `@llm` one-liner and multi-line with labels, `@static`), configuration (shape, env var interpolation, precedence), caching (mechanism, location, bypass), and three realistic examples.
- All 260 unit tests pass (`npm test`), linter passes (`npm run lint`).
- `LICENSE` (MIT) exists, satisfying the `package.json` `files` array.

No issues found. The resolution description is accurate.

## Notes

- The shebang is already present in `src/cli.ts` line 1. Just verify `tsc` preserves it (it should — `tsc` emits comments as-is and a shebang is just a comment to JS).
- `docs/architecture.md` §8 defines the CLI grammar including `--help` and `--version` — follow that spec.
- The README can reference `docs/concept.md` and `docs/architecture.md` for deeper detail but should stand alone for basic use.