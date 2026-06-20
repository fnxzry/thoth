---
id: 04
type: task
status: complete
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

The CLI is implemented in `src/cli.ts`. The user-facing behavior matches the ticket: `<input.md>` writes the file's contents to stdout, `--help` and `--version` write to stdout and exit 0, missing/non-existent input and any usage error prints to stderr and exits 2. `--output <path>` writes the rendered bytes to that file instead of stdout. Every other recognized flag (`--config`, `--check`, `--cache-dir`, `--no-cache`) is accepted by the parser but is a no-op in this build — the help text marks them as such rather than claiming behavior that does not yet exist. The CLI never returns 3.

Three exported units back the implementation:
- `parseArgs(argv)` — hand-rolled parser returning a `{ ok: true, args } | { ok: false, error }` discriminated union. Recognizes `--help`, `--version`, `--check`, `--no-cache`, and `--config <path>`, `--output <path>`, `--cache-dir <path>`. Rejects unknown `--flags`, value-requiring flags with no value, and more than one positional arg.
- `usage()` — returns the help text used by both `--help` (stdout) and the usage-error stderr path.
- `run(argv, deps)` — orchestrates parse → handle help/version → require input → read UTF-8 → write to stdout or `--output`. Filesystem errors carry the offending path on stderr; `ENOENT`/`EACCES` exit 2, any other `code` exits 1.

Design choices worth flagging:
- Dependency injection: `run` accepts a `Partial<CliDeps>` that can override `stdout`, `stderr`, `readFile`, `writeFile`, and `getPackageVersion`. Tests inject a `Writable`-based `StringWritable` and `vi.fn()` mocks for the file calls, so the test suite exercises every code path without touching the real filesystem except in three explicit integration tests (real `ENOENT`, round-trip via `--output`, real `EACCES`).
- The auto-run guard at the bottom of the file uses `realpathSync` on both `process.argv[1]` and `import.meta.url` so the check resolves symlinks correctly when the binary is invoked through npm's global bin link, while vitest's import of the module does not auto-execute.
- The version comes from `package.json` via `createRequire(import.meta.url)`, so it tracks the package version without a hard-coded constant.

## Testing

From the repo root:

```bash
npm run build      # exits 0
npm test           # 36 unit tests, all passing
npm run lint       # exits 0
```

Manual checks against the acceptance criteria:

```bash
node dist/cli.js --version                    # prints "0.1.0", exit 0
node dist/cli.js --help                       # usage on stdout, exit 0
node dist/cli.js AGENTS.md                    # stdout identical to AGENTS.md, exit 0
node dist/cli.js --output /tmp/out.md AGENTS.md   # writes AGENTS.md to /tmp/out.md, exit 0
node dist/cli.js                              # usage + error on stderr, exit 2
node dist/cli.js /tmp/does-not-exist.md       # "no such file or directory: /tmp/does-not-exist.md" on stderr, exit 2
node dist/cli.js --bogus                      # "unknown flag: --bogus" + usage on stderr, exit 2
node dist/cli.js --check AGENTS.md            # AGENTS.md to stdout, exit 0 (flag accepted, no-op)
node dist/cli.js --no-cache AGENTS.md         # AGENTS.md to stdout, exit 0 (flag accepted, no-op)
node dist/cli.js --config cfg.json AGENTS.md  # AGENTS.md to stdout, exit 0 (flag accepted, no-op)
```

The unit-test file at `tests/unit/cli.test.ts` covers `parseArgs` (empty argv, every flag, all-flags-together, unknown flag, missing value, multiple positionals), `usage` (all flags and exit codes present), and `run` (every code path through mocked I/O, plus the three real-disk integration tests for `ENOENT`, `--output` round-trip, and `EACCES`). The `--check`, `--config`, `--cache-dir`, and `--no-cache` flags are explicitly exercised as accepted-but-no-op.

## Review

Accepted. Implementation is correct, idiomatic, and aligned with the architecture spec. All acceptance criteria are satisfied and all listed quality gates (build, lint, unit tests) pass on the working tree.

**Verification performed**

- `npm run build` — exits 0; `dist/cli.js` produced.
- `npm test` — 36/36 unit tests pass (`tests/unit/cli.test.ts`).
- `npm run lint` — exits 0, no warnings.
- Manual CLI checks reproduced the ticket's command list against the freshly built `dist/cli.js`; output bytes, exit codes, and stderr-vs-stdout routing all match the spec. `--version` prints `0.1.0` (matches `package.json`). `--output /tmp/out.md AGENTS.md` writes byte-identical content. Nonexistent path and unknown flag both exit 2 with the offending identifier on stderr plus the usage banner.

**Acceptance Criteria**

- [x] `<input.md>` produces stdout identical to the file's contents.
- [x] `--help` exits 0 and lists all flags; flags whose behavior is not yet wired (`--config`, `--check`, `--cache-dir`, `--no-cache`) are explicitly marked `no-op in this build` rather than claimed.
- [x] `--version` exits 0 and prints the version from `package.json` (`0.1.0`).
- [x] Nonexistent input exits 2 with a stderr message naming the path (`no such file or directory: <path>`).
- [x] No-args invocation exits 2 with `error: missing input file` plus the usage banner on stderr.
- [x] Unit tests cover every scenario above (36 tests across `usage`, `parseArgs`, `run` mocked, and three real-disk integration tests for `ENOENT`, `--output` round-trip, and `EACCES`).
- [x] All five forward-compatibility flags (`--config`, `--check`, `--output`, `--cache-dir`, `--no-cache`) are accepted by the parser; each has at least one explicit "accepted as no-op" test.

**Notes worth flagging for the next ticket**

- The DI seam (`run(argv, deps)`) is a good substrate for ticket #05: swap the read→write body for parse→render while leaving `parseArgs`, `usage`, and the exit-code/error-formatting helpers untouched.
- `--check` is still purely a no-op here (per the ticket); the `Exit codes` banner reserving code 3 for it is correct documentation in advance.
- The `isMain()` guard uses `realpathSync` on both sides, which correctly resolves npm-bin symlinks and short-circuits during vitest's import — clean choice that future tickets can keep.
