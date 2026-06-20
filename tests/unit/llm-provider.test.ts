import { describe, expect, it, vi } from "vitest";

import { OpenAIProvider } from "../../src/llm/openai.js";
import type { LlmProvider } from "../../src/llm/provider.js";
import type { LlmRequest, LlmResponse } from "../../src/types.js";

describe("LlmProvider interface compliance", () => {
  it("treats OpenAIProvider as an LlmProvider", () => {
    const provider: LlmProvider = new OpenAIProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1",
    });
    expect(typeof provider.complete).toBe("function");
  });

  it("accepts an arbitrary LlmProvider implementation", () => {
    const stub: LlmProvider = {
      complete: async (_req: LlmRequest): Promise<LlmResponse> => ({
        content: "stub",
      }),
    };
    expect(stub.complete).toBeDefined();
  });
});

describe("OpenAIProvider.complete", () => {
  it("calls the chat.completions endpoint and returns the first message content", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: "hello from the model" } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }));

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1",
    });

    const response = await provider.complete({
      system: "you are a helpful assistant",
      user: "say hi",
      model: "gpt-test",
    });

    expect(response.content).toBe("hello from the model");
    expect(response.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
    expect(createMock).toHaveBeenCalledTimes(1);

    const callArg = createMock.mock.calls[0][0];
    expect(callArg.model).toBe("gpt-test");
    expect(callArg.messages).toEqual([
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "say hi" },
    ]);
    expect(callArg.response_format).toBeUndefined();
  });

  it("uses response_format json_object when jsonMode is true", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: '{"answer": 42}' } }],
    }));

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1",
    });

    await provider.complete({
      system: "json helper",
      user: "give me json",
      model: "gpt-test",
      jsonMode: true,
    });

    const callArg = createMock.mock.calls[0][0];
    expect(callArg.response_format).toEqual({ type: "json_object" });
  });

  it("does not include response_format when jsonMode is false or undefined", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1",
    });

    await provider.complete({
      system: "s",
      user: "u",
      model: "m",
      jsonMode: false,
    });
    expect(createMock.mock.calls[0][0].response_format).toBeUndefined();
  });

  it("honors the configured baseUrl (does not hit api.openai.com)", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));
    let capturedBaseURL: string | undefined;

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(
      createMock,
      (init) => {
        capturedBaseURL = init.baseURL;
      },
    );
    new ProviderWithMock({
      apiKey: "k",
      baseUrl: "https://custom.example.com/v1",
    });

    expect(capturedBaseURL).toBe("https://custom.example.com/v1");
  });

  it("passes the apiKey to the OpenAI client", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));
    let capturedApiKey: string | undefined;

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(
      createMock,
      (init) => {
        capturedApiKey = init.apiKey;
      },
    );
    new ProviderWithMock({
      apiKey: "sk-from-test",
      baseUrl: "https://custom.example.com/v1",
    });

    expect(capturedApiKey).toBe("sk-from-test");
  });

  it("wraps provider errors as EngineError", async () => {
    const createMock = vi.fn(async () => {
      throw new Error("rate limited");
    });

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "k",
      baseUrl: "https://custom.example.com/v1",
    });

    await expect(
      provider.complete({
        system: "s",
        user: "u",
        model: "m",
      }),
    ).rejects.toThrowError(/OpenAI request failed: rate limited/);
  });

  it("throws EngineError when the response has no message content", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: null } }],
    }));

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "k",
      baseUrl: "https://custom.example.com/v1",
    });

    await expect(
      provider.complete({
        system: "s",
        user: "u",
        model: "m",
      }),
    ).rejects.toThrowError(/no message content/);
  });

  it("omits usage when the response does not include usage info", async () => {
    const createMock = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));

    const ProviderWithMock = await importOpenAIProviderWithMockedClient(createMock);
    const provider = new ProviderWithMock({
      apiKey: "k",
      baseUrl: "https://custom.example.com/v1",
    });

    const response = await provider.complete({
      system: "s",
      user: "u",
      model: "m",
    });
    expect(response.usage).toBeUndefined();
  });
});

interface MockInit {
  apiKey?: string;
  baseURL?: string | null;
}

async function importOpenAIProviderWithMockedClient(
  createMock: ReturnType<typeof vi.fn>,
  onInit?: (init: MockInit) => void,
): Promise<new (opts: { apiKey: string; baseUrl: string }) => OpenAIProvider> {
  vi.resetModules();
  vi.doMock("openai", () => {
    return {
      default: class FakeOpenAI {
        constructor(init: MockInit) {
          if (onInit) onInit(init);
        }
        chat = {
          completions: {
            create: createMock,
          },
        };
      },
    };
  });
  const mod = await import("../../src/llm/openai.js");
  return mod.OpenAIProvider as unknown as new (opts: {
    apiKey: string;
    baseUrl: string;
  }) => OpenAIProvider;
}