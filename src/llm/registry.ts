import type { LlmProvider, LlmProviderConfig } from "../types/index.js";
import { GeminiLlmAdapter } from "./adapters/gemini.adapter.js";
import { OpenAiCompatibleLlmAdapter } from "./adapters/openai.adapter.js";
import { AnthropicLlmAdapter } from "./adapters/anthropic.adapter.js";
import { MockLlmAdapter } from "./adapters/mock.adapter.js";

function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(baseUrl);
}

function assertRealApiKey(config: LlmProviderConfig): void {
  if (!config.apiKey || config.apiKey.trim() === "" || config.apiKey === "VALUES") {
    throw new Error(
      `[Error] Missing API key for LLM provider "${config.provider}". Set LLM_API_KEY in .env (or use --provider mock for offline testing).`,
    );
  }
}

export function createLlmProvider(
  config: LlmProviderConfig,
  fetchImpl?: typeof fetch,
): LlmProvider {
  switch (config.provider) {
    case "gemini":
      assertRealApiKey(config);
      return new GeminiLlmAdapter(config, fetchImpl);
    case "openai":
      if (!isLocalBaseUrl(config.baseUrl)) {
        assertRealApiKey(config);
      }
      return new OpenAiCompatibleLlmAdapter(config, fetchImpl);
    case "anthropic":
      assertRealApiKey(config);
      return new AnthropicLlmAdapter(config, fetchImpl);
    case "mock":
      return new MockLlmAdapter(config.model);
  }
}
