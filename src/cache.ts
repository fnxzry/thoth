import { createHash } from "node:crypto";

export interface LlmCacheKeyInput {
  providerId: string;
  model: string;
  prompt: string;
  contextFiles: ReadonlyMap<string, string>;
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
