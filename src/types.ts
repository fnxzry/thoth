import { z } from "zod";

export const StaticBlockSchema = z.object({
  kind: z.literal("static"),
  text: z.string(),
  sourceLine: z.number().int().positive(),
});

export const DirectiveBlockSchema = z.object({
  kind: z.literal("directive"),
  name: z.string(),
  label: z.string(),
  primaryParameter: z.string(),
  body: z.string(),
  sourceLine: z.number().int().positive(),
});

export const BlockSchema = z.discriminatedUnion("kind", [
  StaticBlockSchema,
  DirectiveBlockSchema,
]);

export type StaticBlock = z.infer<typeof StaticBlockSchema>;
export type DirectiveBlock = z.infer<typeof DirectiveBlockSchema>;
export type Block = z.infer<typeof BlockSchema>;

export const LlmUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});

export const LlmRequestSchema = z.object({
  system: z.string(),
  user: z.string(),
  model: z.string(),
  jsonMode: z.boolean().optional(),
});

export const LlmResponseSchema = z.object({
  content: z.string(),
  usage: LlmUsageSchema.optional(),
});

export type LlmUsage = z.infer<typeof LlmUsageSchema>;
export type LlmRequest = z.infer<typeof LlmRequestSchema>;
export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export const ResolvedConfigSchema = z.object({
  configPath: z.string().optional(),
  cacheDir: z.string(),
  llm: z.object({
    provider: z.literal("openai"),
    apiKey: z.string(),
    baseUrl: z.string(),
    defaultModel: z.string(),
  }),
  cache: z.object({
    enabled: z.boolean(),
  }),
});

export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

export const DirectiveResultSchema = z.object({
  text: z.string(),
});

export type DirectiveResult = z.infer<typeof DirectiveResultSchema>;

import type { LlmCache } from "./cache.js";

export interface DirectiveContext {
  block: Block;
  resolveContext(paths: string[]): Promise<Map<string, string>>;
  callLlm(req: LlmRequest): Promise<LlmResponse>;
  config: ResolvedConfig;
  templateDir: string;
  cache?: LlmCache;
}

export type DirectiveImpl = (ctx: DirectiveContext) => Promise<DirectiveResult>;