import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCacheEntry {
  content: string;
  usage?: LlmUsage;
}

export interface LlmCacheKeyInput {
  providerId: string;
  model: string;
  prompt: string;
  contextFiles: ReadonlyMap<string, string>;
}

export interface LlmCacheOptions {
  cacheDir: string;
  warn?: (msg: string) => void;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalizePrompt(prompt: string): string {
  return `${prompt.replace(/\s+$/, "")}\n`;
}

// Implements the cache key spec in docs/architecture.md §5:
//
//   sha256(
//     provider-id
//     || "\n" || model
//     || "\n" || canonical(prompt)
//     || "\n" || sorted(context-file-hashes).join("\n")
//   )
//
// context-file-hashes are sha256 hashes of each context file's content,
// sorted lexicographically.
export function computeLlmCacheKey(input: LlmCacheKeyInput): string {
  const contextHashes = [...input.contextFiles.values()].map(sha256Hex).sort();
  const payload = [
    input.providerId,
    input.model,
    canonicalizePrompt(input.prompt),
    contextHashes.join("\n"),
  ].join("\n");
  return sha256Hex(payload);
}

export function isLlmCacheEntry(value: unknown): value is LlmCacheEntry {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.content !== "string") return false;
  if (obj.usage === undefined) return true;
  if (!obj.usage || typeof obj.usage !== "object") return false;
  const usage = obj.usage as Record<string, unknown>;
  return (
    typeof usage.promptTokens === "number" &&
    typeof usage.completionTokens === "number"
  );
}

// Content-addressed filesystem cache for LLM directive outputs.
//
// Layout (per docs/architecture.md §5):
//
//   <cacheDir>/<key[0:2]>/<key[2:4]>/<key>.json
//
// All I/O errors are non-fatal: callers continue rendering and (for writes)
// a warning is emitted via the optional `warn` hook.
export class LlmCache {
  private readonly cacheDir: string;
  private readonly warn?: (msg: string) => void;

  constructor(opts: LlmCacheOptions) {
    this.cacheDir = resolvePath(opts.cacheDir);
    this.warn = opts.warn;
  }

  // Resolves the on-disk path for a given cache key. The sharding layout
  // distributes entries across directories so no single directory holds
  // the entire cache.
  pathFor(key: string): string {
    return resolvePath(this.cacheDir, key.slice(0, 2), key.slice(2, 4), `${key}.json`);
  }

  // Returns the cached entry on hit, or null on miss. I/O or parse errors
  // are non-fatal: a warning is logged and null is returned so rendering
  // continues against the provider.
  async get(key: string): Promise<LlmCacheEntry | null> {
    const path = this.pathFor(key);
    let text: string;
    try {
      text = await readFile(path, { encoding: "utf8" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return null;
      if (this.warn) {
        this.warn(`cache: failed to read ${path}: ${(err as Error).message}`);
      }
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      if (this.warn) {
        this.warn(`cache: failed to parse ${path}: ${(err as Error).message}`);
      }
      return null;
    }
    if (!isLlmCacheEntry(parsed)) {
      if (this.warn) {
        this.warn(`cache: ${path} has unexpected shape; treating as miss`);
      }
      return null;
    }
    return parsed;
  }

  // Writes the entry atomically: serialize to <path>.tmp, then rename.
  // Any I/O failure is non-fatal; a warning is logged and the renderer
  // continues without caching the result.
  async put(key: string, entry: LlmCacheEntry): Promise<void> {
    const path = this.pathFor(key);
    const dir = dirname(path);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      if (this.warn) {
        this.warn(`cache: failed to create ${dir}: ${(err as Error).message}`);
      }
      return;
    }
    const tmp = `${path}.tmp`;
    let serialized: string;
    try {
      serialized = JSON.stringify(entry, null, 2);
    } catch (err) {
      if (this.warn) {
        this.warn(`cache: failed to serialize entry: ${(err as Error).message}`);
      }
      return;
    }
    try {
      await writeFile(tmp, serialized, { encoding: "utf8" });
      await rename(tmp, path);
    } catch (err) {
      if (this.warn) {
        this.warn(`cache: failed to write ${path}: ${(err as Error).message}`);
      }
      // Best-effort cleanup of the temp file so we don't leave orphans.
      try {
        await unlink(tmp);
      } catch {
        // ignore
      }
    }
  }
}