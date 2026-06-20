---
id: 04
type: task
status: in-progress
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
