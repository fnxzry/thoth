# thoth

A CLI tool that generates documents from a mix of static text, verbatim file includes, and LLM-generated content. Write a template, run `thoth`, get a document that stays in sync with your repo.

## Install

Requires Node.js ≥ 22.

### Global install

```bash
npm install -g thoth
thoth template.md
```

### Project-local (as a dev dependency)

Add thoth to a specific project. Use `npx thoth` or wire it into `package.json` scripts:

```bash
npm install --save-dev thoth
npx thoth template.md
```

```json
{
  "scripts": {
    "docs": "thoth --config thoth.config.json AGENTS.md"
  }
}
```

### Source (clone and build)

```bash
git clone <repo-url> && cd thoth
npm install
npm run build
./dist/cli.js template.md
```

### Development (npm link)

Symlinks the binary for testing against a local checkout:

```bash
npm link  # from the thoth repo
thoth template.md
```

## Quick start

Create a template file (`template.md`):

```markdown
# My Project

@include README.md

## Architecture Summary

@llm:arch-summary
  context:
    - docs/architecture.md
  prompt: |
    Summarize the architecture in 2-3 paragraphs.
@end
```

Run it:

```bash
thoth template.md
```

The output inlines the contents of `README.md` and replaces the `@llm` block with the model's response. On the next run, the LLM response is served from cache — no API call, no network.

## Usage

```
thoth [options] [<input.md>|-]
```

If `<input.md>` is omitted or given as `-`, the template is read from stdin (unless stdin is a terminal, which is an error).

### Options

| Flag                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `--config <path>`    | Path to a config file                                                   |
| `--check`            | Drift detection: render to memory and compare against `--output`        |
| `--output <path>`    | Write output to `<path>` instead of stdout (required with `--check`)    |
| `--cache-dir <path>` | Override the cache directory                                            |
| `--no-cache`         | Bypass the cache (always call the LLM)                                  |
| `--help`             | Print usage summary and exit                                            |
| `--version`          | Print version and exit                                                  |

### Exit codes

| Code | Meaning                        |
| ---- | ------------------------------ |
| 0    | Success                        |
| 1    | Unexpected runtime error       |
| 2    | Usage error (bad arguments)    |
| 3    | Drift detected (`--check` only)|

### Examples

```bash
thoth template.md                     # render to stdout
thoth template.md --output out.md     # render to file
thoth --check --output out.md         # check if out.md is fresh
thoth --no-cache template.md          # force LLM re-generation
thoth --config prod.json template.md  # use a specific config file
```

## Template syntax

A template is a text file containing static text and directives. Directives are resolved at render time; everything else is passed through unchanged.

### Static text

Any text not inside a `@directive...@end` block is static. Write it as you would any markdown file.

### `@include` — inline a file

```
@include path/to/file.md
```

The referenced file's contents replace the directive. Paths are relative to the template file's directory (or the current working directory when reading from stdin).

### `@llm` — LLM-generated content

One-liner:

```
@llm Summarize the architecture in two paragraphs.
```

Multi-line with an optional label (used for cache identification):

```
@llm:architecture-summary
  context:
    - docs/architecture.md
    - docs/concept.md
  prompt: |
    Summarize the architecture in 2-3 paragraphs.
    Mention the core design values.
  model: gpt-4o
@end
```

| Parameter    | Required | Description                                   |
| ------------ | -------- | --------------------------------------------- |
| `prompt`     | Yes      | The prompt sent to the model                  |
| `context`    | No       | List of files whose contents are prepended    |
| `model`      | No       | Override the default model for this block     |
| Label        | No       | Short identifier (used in cache keys, errors) |

The label follows the directive name, separated by a colon: `@llm:my-label`.

### `@static` — explicit verbatim block

```
@static
  Any text here is passed through verbatim.
  Useful for disambiguating text that looks
  like a directive header line.
@end
```

`@static` is rarely needed — text outside directives is already static. Use it only when a line of text matches the `@directive` pattern and you want it treated as literal text.

## Configuration

thoth looks for a config file at `thoth.config.json` in the current directory. You can specify a different path with `--config`.

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
```

Values of the form `${ENV_VAR}` are resolved from the environment at load time — commit the config file without leaking secrets.

### Precedence (highest to lowest)

1. CLI flags (e.g. `--cache-dir`, `--no-cache`)
2. Environment variables: `THOTH_CONFIG`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
3. Config file values (with `${...}` interpolation)
4. Built-in defaults: `cacheDir = "./.doc-cache"`, `provider = "openai"`, `baseUrl = "https://api.openai.com/v1"`

## Caching

Every `@llm` block is cached by a content-addressed key derived from the provider, model, prompt, and context file hashes. Cache entries live in `./.doc-cache/` (configurable with `--cache-dir`).

- **Deterministic:** the same inputs always produce the same cache key.
- **Committing the cache:** regenerate without LLM credentials or network access.
- **Bypassing the cache:** use `--no-cache` to force fresh LLM calls.

## Real-world examples

### Maintaining an agent instructions file

A template that pulls in architecture and coding-style docs, then has the LLM write a one-paragraph summary:

```markdown
# Project Instructions

@include docs/coding-style.md

## Architecture

@include docs/architecture.md

## Summary

@llm:project-summary
  context:
    - docs/architecture.md
    - docs/concept.md
    - docs/coding-style.md
  prompt: |
    Write a one-paragraph summary of this project
    for a new contributor.
@end
```

### Generating a docs index

A template that lists project documents with LLM-generated summaries:

```markdown
# Documentation Index

@llm:summarize-architecture
  context:
    - docs/architecture.md
  prompt: |
    Write a two-sentence summary of this architecture
    document and a one-line note on when to read it.
@end

@llm:summarize-concept
  context:
    - docs/concept.md
  prompt: |
    Write a two-sentence summary of this concept document
    and a one-line note on when to read it.
@end
```

### Building a README from parts

```markdown
# My Library

@include docs/badges.md

@include docs/install.md

@llm:readme-overview
  context:
    - README.md
    - docs/architecture.md
  prompt: |
    Write a 3-sentence project overview based on these docs.
@end
```

## More information

- [Concept](docs/concept.md) — project mission, core values, non-goals
- [Architecture](docs/architecture.md) — module design, directive grammar, cache key spec