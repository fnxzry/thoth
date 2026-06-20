---
id: 08
type: task
status: complete
description: Allow `thoth` to read the template from stdin, and make stdin the default when no input file is given on the command line.
---

## Overview

The CLI currently requires a positional `<input.md>` argument (`docs/architecture.md` §8). This blocks the natural Unix-style invocation where a template is piped or redirected into the tool, e.g.:

```
cat template.md | thoth
thoth < generated.md > out.md
```

This ticket makes stdin reading a first-class input mode. When no positional input file is given, the tool reads the template from stdin instead of exiting with a usage error. Providing an explicit file path on the command line continues to work exactly as today.

## User-Facing Behavior

- `thoth template.md` reads from `template.md` (existing behavior, unchanged).
- `thoth` with no positional argument reads the template from stdin and writes rendered output to stdout.
- `thoth -` reads the template from stdin (explicit marker, equivalent to omitting the positional argument).
- `cat template.md | thoth` renders `template.md` and writes to stdout.
- `thoth < template.md > out.md` writes to `out.md`.
- `thoth --output out.md` with no input file reads from stdin and writes to `out.md`.
- Running `thoth` with no input file from an interactive terminal (stdin is a TTY) exits non-zero with a clear error message and the usage text — it does not block waiting for typed input.
- Running `thoth --help` and `thoth --version` continues to work without reading stdin.
- The usage text and `--help` output reflect that `<input.md>` is optional and that stdin is read when it is omitted.

## Technical Requirements

- `src/cli.ts` allows `args.input` to be undefined when stdin reading is intended, and treats `-` as equivalent to omitting the positional argument (the value `-` is normalized to undefined rather than passed to `readFile`).
- A new dependency on `CliDeps` (e.g. `readStdin: () => Promise<string>`) is introduced so the read path is mockable in tests. The default implementation reads from `process.stdin` to EOF as UTF-8 and rejects with a clear error if `process.stdin.isTTY` is true.
- When `args.input` is undefined, `run` reads the template via `deps.readStdin()`; otherwise it uses the existing `deps.readFile(args.input)`.
- When the template comes from stdin, `templateDir` passed to the engine defaults to `process.cwd()` so that relative paths in `@include` and `@llm context:` resolve against the current working directory, matching Unix conventions.
- The `--check` flag continues to require `--output` (existing behavior); it does not need to change for this ticket. When `--check` is used with stdin input, it reads the existing bytes from `--output` and compares against the rendered stdin — this falls out naturally if `--output` is provided.
- The `USAGE` string and `args.help` text are updated to describe the new behavior.
- The architecture doc's CLI grammar section (`docs/architecture.md` §8) is updated to reflect that `<input.md>` is optional and that stdin is used when omitted.

## Acceptance Criteria

- [ ] `thoth` with no arguments reads the template from stdin and writes rendered output to stdout.
- [ ] `thoth -` reads from stdin (explicit `-` marker) and produces the same output as the no-argument invocation on the same input.
- [ ] `thoth template.md` reads from `template.md` and produces the same output as before this ticket.
- [ ] `echo "hello" | thoth` produces a rendered document containing `hello` on stdout.
- [ ] `thoth` invoked from a terminal (stdin is a TTY) exits with code 2 and a clear stderr message; it does not block.
- [ ] `thoth --output out.md` with no input file reads from stdin and writes to `out.md`.
- [ ] `thoth --help` output reflects that the input file is optional.
- [ ] Relative paths in `@include` and `@llm context:` resolve against `process.cwd()` when input comes from stdin.
- [ ] All existing unit tests still pass.
- [ ] New unit tests cover: stdin read (mocked), TTY-rejection error path, default-args pipeline (read from stdin), explicit `-` marker equivalent to omitted positional, `templateDir` defaults to `process.cwd()` for stdin input, and the updated usage string.

## Notes

- `thoth -` and `thoth` (no positional) are equivalent; both read from stdin. This matches the common Unix convention for stdin markers while keeping the no-argument form ergonomic.
- The `CliDeps` interface already isolates filesystem I/O behind dependency-injected functions, so adding a `readStdin` slot fits the existing pattern.
- Reading all of stdin into memory before parsing is acceptable; the parser is pure and operates on a string. Streamed parsing is out of scope.
- `docs/architecture.md` §8 will need a one-line update once this ticket lands so the contract stays in sync with the implementation.

## Resolution

- `src/cli.ts` now reads the template from `process.stdin` when `args.input` is `undefined`. The explicit `-` positional marker is normalized to `undefined` inside `parseArgs`, so `thoth` and `thoth -` are equivalent.
- A new `readStdin: () => Promise<string>` slot was added to `CliDeps`. The default implementation (`defaultReadStdin`) buffers `process.stdin` as UTF-8 until EOF, and rejects with an `EISTTY`-coded error when `process.stdin.isTTY` is true. `run` catches that error and exits with code 2 plus the usage text, so the tool does not block waiting for typed input.
- When the template comes from stdin, `templateDir` is `process.cwd()`, so relative paths inside `@include` and `@llm context:` resolve against the current working directory (Unix convention). When the template comes from a file, `templateDir` is the file's directory, as before.
- The `USAGE` text and the architecture doc's CLI grammar section (§8) were updated to describe the optional `<input.md>` argument and the stdin/`-` marker semantics.
- `parseArgs` continues to reject more than one positional argument; providing both an explicit file path and `-` is treated as a second positional argument.

## Testing

- Unit tests in `tests/unit/cli.test.ts` were extended to cover the new behavior:
  - `usage` text now describes the optional input file and stdin behavior.
  - `parseArgs(["-"])` leaves `input` undefined; the other parseArgs cases still pass.
  - `run([], harness)` reads via `harness.readStdin` and writes to stdout when stdin resolves successfully.
  - `run(["-"], harness)` is byte-identical to `run([], harness)` on the same stdin template.
  - `run([], harness)` with `readStdin` rejecting an `EISTTY` error exits 2 and prints the usage to stderr.
  - `run([], harness)` with `readStdin` rejecting any other error exits 1.
  - `run(["--output", path], harness)` with stdin renders into `path` via `writeFile` and writes nothing to stdout.
  - `run([], harness)` with a stdin template that `@include`s a relative file resolves the include against a mocked `process.cwd()`; `run([filePath], harness)` with the same include template resolves against the file's directory.
- `npm test` passes (110 unit tests across 5 files). `npm run lint` and `npm run build` are clean.
- Manual verification with the built CLI:
  - `echo "hello from stdin" | ./dist/cli.js` prints `hello from stdin`.
  - `echo "via dash marker" | ./dist/cli.js -` prints `via dash marker`.
  - `echo "@include AGENTS.md" | ./dist/cli.js | head` shows that relative includes resolve against `process.cwd()` for stdin input.
  - `echo "test content" | ./dist/cli.js --output /tmp/x && cat /tmp/x` writes the rendered stdin output to a file.
  - `./dist/cli.js --help` shows the updated usage text with `[<input.md>|-]` and the stdin note.
  - `./dist/cli.js --version` prints `0.1.0` without touching stdin.
  - `./dist/cli.js --bogus` exits 2 with an unknown-flag error and the updated usage.

## Review

Accepted. The stdin input feature is implemented cleanly with the existing DI seam. All acceptance criteria are satisfied and all listed quality gates pass.

**Verification performed**

- `npm run build` — exits 0.
- `npm test` — 110/110 unit tests pass (CLI suite grew from 36 to 46 with the new stdin/TTY/`-`/cwd tests).
- `npm run lint` — exits 0, no warnings.
- Manual CLI checks against `dist/cli.js`:
  - `echo "hello from stdin" | node dist/cli.js` → stdout `hello from stdin`, exit 0.
  - `echo "via dash marker" | node dist/cli.js -` → stdout `via dash marker`, exit 0 (byte-identical to omitted-positional form).
  - `echo '@include AGENTS.md' | node dist/cli.js | head` → inlines `AGENTS.md` (proves `templateDir` defaults to `process.cwd()` for stdin input).
  - `echo "test content" | node dist/cli.js --output /tmp/x-out && cat /tmp/x-out` → writes rendered stdin output to file.
  - `node dist/cli.js --help` → first lines show `Usage: thoth [options] [<input.md>|-]` plus the stdin/terminal note.
  - `node dist/cli.js --version` → `0.1.0`, exit 0 (does not touch stdin).
  - `node dist/cli.js --bogus` → stderr `error: unknown flag: --bogus` + usage, exit 2.
- `docs/architecture.md` §8 was updated to reflect the optional positional and stdin/`-` semantics.

**Acceptance Criteria**

- [x] `thoth` with no arguments reads from stdin and writes to stdout. (Unit `stdin input > reads the template from stdin when no positional argument is given` + manual `echo | thoth`.)
- [x] `thoth -` reads from stdin and matches the no-argument form byte-for-byte. (Unit `produces byte-identical output from '-' and from the omitted-positional form`.)
- [x] `thoth template.md` reads from file and produces the same output as before this ticket. (Existing file-input tests still pass; the `templateDir` test explicitly contrasts file-dir vs `process.cwd()` to guard against regression.)
- [x] `echo "hello" | thoth` prints `hello` on stdout. (Manual.)
- [x] `thoth` from a TTY exits with code 2 and a clear stderr message; does not block. (Unit `exits 2 with a stdin-TTY error and usage text` mocks the `EISTTY` rejection; the real-disk integration test `rejects with EISTTY when the real process.stdin is a terminal` runs only when `process.stdin.isTTY` is true.)
- [x] `thoth --output out.md` with no input file reads stdin and writes to `out.md`. (Unit `writes stdin-rendered output to --output when given` + manual.)
- [x] `thoth --help` reflects that the input file is optional. (Unit `documents that the input file is optional and stdin is used when omitted` asserts `[<input.md>|-]`, `stdin`, and `terminal` are present; manual inspection matches.)
- [x] Relative `@include` paths resolve against `process.cwd()` for stdin input, and against the file's directory for file input. (Unit `uses process.cwd() as templateDir when input comes from stdin` + `uses the file's directory as templateDir when input is a file, not cwd`.)
- [x] All existing unit tests still pass. (110/110.)
- [x] New unit tests cover all six cases listed in the ticket.

**Notes worth flagging**

- The `CliDeps` extension (`readStdin`) slots into the existing DI surface without disturbing the other deps, so the test harness is purely additive — no existing test had to change to accommodate the new slot. The mock-only test suite covers every stdin code path, and the real-disk `EISTTY` test self-skips on non-TTY environments, so CI is deterministic.
- `parseArgs` normalizes `-` to `undefined` at parse time (rather than at the `run` layer), which keeps the `args.input === undefined` discriminant single-purpose and makes `parseArgs(["-"])` return the exact same shape as `parseArgs([])`. The test `treats '-' as the stdin marker, leaving input undefined` pins this contract.
- Providing both `-` and an explicit file path is still rejected as a second positional, which is the right behavior — there's no coherent interpretation of `thoth - template.md`.
- The output-error handler now falls back to `"stdin"` as the error target when neither `args.output` nor `args.input` is set, which is a small but useful improvement for the new `--output` path with stdin input.