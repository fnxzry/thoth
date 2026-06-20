import OpenAI from "openai";

import type { LlmProvider } from "./provider.js";
import { EngineError } from "../engine.js";
import type { LlmRequest, LlmResponse } from "../types.js";

export class OpenAIProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(opts: { apiKey: string; baseUrl: string }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(req.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new EngineError(`OpenAI request failed: ${detail}`);
    }

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (content === null || content === undefined) {
      throw new EngineError("OpenAI response contained no message content");
    }

    const usage = response.usage;
    return {
      content,
      usage: usage
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
        : undefined,
    };
  }
}