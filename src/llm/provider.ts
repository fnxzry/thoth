import type { LlmRequest, LlmResponse } from "../types.js";

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
}