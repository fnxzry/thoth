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
