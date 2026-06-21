---
id: 11
type: task
status: complete
description: Prepare package.json for npm publishing as @fnxzry/thoth with proper metadata and publish workflow
---

## Overview

The package is ready to publish but needs npm-specific metadata added to `package.json` and a `prepublishOnly` script to ensure a clean publish every time. The package will be published as the scoped `@fnxzry/thoth`.

## User-Facing Behavior

Users install via:

```bash
npm install --save-dev @fnxzry/thoth
```

And run the binary as before:

```bash
npx thoth template.md
```

## Technical Requirements

- Change `package.json` `name` from `"thoth"` to `"@fnxzry/thoth"`.
- Add a `repository` field pointing to `https://github.com/fnxzry/thoth.git`.
- Add `keywords` array (e.g., `["cli", "documentation", "template", "llm", "markdown"]`).
- Add a `prepublishOnly` script: `"npm run build && npm test"`.
- Improve the `description` to be more descriptive than the current placeholder.
- Add `"publishConfig": { "access": "public" }` so scoped access default is overridden automatically.
- Verify `npm pack --dry-run` still shows only runtime artifacts.
- Verify `npm run build && npm test` passes before publish.

## Acceptance Criteria

- [x] `package.json` `name` is `@fnxzry/thoth`.
- [x] `package.json` includes `repository`, `keywords`, `prepublishOnly`, and `publishConfig.access: public`.
- [x] `package.json` `description` is a clear one-liner about what thoth does.
- [x] `npm pack --dry-run` contains only expected files (`dist/`, `README.md`, `LICENSE`, `package.json`).
- [x] `npm run build && npm test` passes cleanly.
- [x] The `bin` entry is unchanged (`./dist/cli.js`).

## Review

**Decision:** Accept

All acceptance criteria pass:
- `name` is `@fnxzry/thoth`; `bin` entry unchanged at `./dist/cli.js`
- All required fields present (`repository`, `keywords`, `prepublishOnly`, `publishConfig.access: public`)
- Description is a clear one-liner summarizing the tool's purpose
- `npm pack --dry-run` shows only `dist/`, `README.md`, `LICENSE`, `package.json`
- `npm run build` compiles cleanly, `npm test` passes 260/260 tests across 10 files
- Linter passes with no issues

## Notes

- Publishing itself (`npm publish`) is manual and outside the scope of this ticket.
- The existing `scripts.build:docs` references a `docs.config.json` that doesn't exist — this is a separate issue and out of scope here.
- The binary name stays `thoth` — only the npm package name changes.

## Resolution

Updated `package.json` with all required npm publishing metadata:

- Changed `name` from `"thoth"` to `"@fnxzry/thoth"`
- Improved `description` to: "A CLI tool that generates documents from static text, file includes, and LLM-generated blocks."
- Added `repository` field pointing to `https://github.com/fnxzry/thoth.git`
- Added `keywords` array: `["cli", "documentation", "template", "llm", "markdown"]`
- Added `prepublishOnly` script: `"npm run build && npm test"`
- Added `publishConfig.access: "public"` to override scoped-package private default
- The `bin` entry (`thoth` → `./dist/cli.js`) was left unchanged

All existing tests (260 unit tests across 10 test files) continue to pass. `npm pack --dry-run` confirms only runtime artifacts (`dist/`, `README.md`, `LICENSE`, `package.json`) are included in the tarball.

## Testing

1. Run `npm pack --dry-run` and confirm:
   - Package name shows as `@fnxzry/thoth`
   - Tarball contains only `dist/`, `README.md`, `LICENSE`, and `package.json`
2. Run `npm run build && npm test` and confirm all 260 tests pass
3. Inspect `package.json` fields: `name`, `repository`, `keywords`, `description`, `publishConfig.access`, `scripts.prepublishOnly`, `bin`