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
│   ├── llm.ts       # calls LlmProvider, optionally consults cache
│   └── each.ts      # iterates over glob-matched files, renders body per file
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
  | { kind: "directive"; name: string; label: string;
      primaryParameter: string; body: string };

// What a directive receives and returns. body is the raw text inside the
// directive's body block (excluding the @<directive> header line and the
// @end line).
interface DirectiveContext {
  block: Block;                       // the directive block being rendered
  templateDir: string;                // directory of the template file (for resolving relative paths)
  resolveContext(paths: string[]): Promise<Map<string, string>>;
  callLlm(req: LlmRequest): Promise<LlmResponse>;
  renderTemplate(template: string): Promise<DirectiveResult>;
  config: ResolvedConfig;
  cache?: LlmCache;                   // content-addressed cache (when enabled)
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

Each directive has a **parameter schema**: the set of named and positional
parameters it accepts. One parameter, if the directive defines one, is the
**primary parameter**. It can be set inline on the one-liner form, or in
the body YAML on the multi-line form. Any other parameters are set in the
body YAML.

A directive MAY also carry an optional **label**: a short identifier for
the block (used in cache keys, error messages, and cross-references).
Labels are set on the directive line, after a colon.

Forms:

```
@<directive> <primary-parameter>            # one-liner: primary parameter only
@<directive>:<label> <primary-parameter>    # one-liner: label + primary parameter
@<directive>                                # multi-line: body sets all parameters
  <parameter>: <value>
  ...
@end
@<directive>:<label>                        # multi-line: label + body
  <parameter>: <value>
  ...
@end
```

A directive MAY define a primary parameter; it is not required to. If a
directive has no primary parameter, only the multi-line form is
available. Labels are always optional, on both forms.

Built-in directives:

- `@include <path>` — primary parameter is the file path to inline.
  `@include` requires a path, so a one-liner is the natural form.
- `@llm <prompt>` — primary parameter is the prompt. Body parameters:
  `context:` (list of file paths), `model:` (model override).
  The label identifies the block for caching.
- `@each <glob>` — primary parameter is a glob pattern. Body is a template
  repeated once per matched file. Body parameters: `as:` (variable renames),
  `join:` (iteration separator). Supports nested directives.
  See `docs/elaborations/each-directive.md`.
- `@static` — the body is the verbatim text to inline; no primary
  parameter, so only multi-line form.

Concrete examples:

```
@include docs/summary.md

@llm:summary-section Summarize the file foo.txt

@llm:architecture-summary
context:
  - docs/architecture.md
prompt: |
  Summarize this document in two paragraphs.
@end

@each docs/*.md
## {{name}}

@llm
context:
  - {{path}}
prompt: Summarize this document in one sentence.
@end

---
@end
```

The `static` directive is implicit: any text not inside a `@<directive>...@end` block is treated as static.

### Primary-content body convention

Directive bodies can serve dual purposes: YAML configuration and primary content.
The `@---` delimiter (a line containing only `@---`) separates the two:

- A body **without** `@---` is treated entirely as primary content.
- A body **with** `@---` has YAML parameters above and primary content below.

This allows `@llm` to accept its prompt as body text (`@llm\nSummarize...\n@end`),
and `@each` to accept its template as body text. The convention is available to
all directives.

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
<T> [--config <path>] [--check] [--output <path>] [--cache-dir <path>] [--no-cache] [<input.md>|-]

<T> --help
<T> --version
```

- `<input.md>` is optional. When omitted (or given as the explicit `-` marker), the template is read from stdin. If stdin is a terminal, the tool exits with code 2 (usage error) rather than blocking.
- When the template comes from stdin, relative paths inside `@include` and `@llm context:` resolve against `process.cwd()` (Unix convention). When it comes from a file, they resolve against the file's directory.
- If `--output` is omitted, output goes to stdout.
- `--check` reads the file at `--output` (or fails if `--output` is omitted), renders to memory, and exits non-zero if the rendered bytes differ. Used for drift detection.
- `--no-cache` bypasses the cache (always calls the provider). Useful for forced refresh.
- Exit codes: `0` success, `1` rendering error, `2` usage error, `3` drift detected (only with `--check`).
