import type {
  LlmProvider,
  LlmProviderConfig,
  LlmProviderName,
} from "../types/index.js";
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

export function getDefaultModelForProvider(
  provider: LlmProviderName,
): string {
  switch (provider) {
    case "gemini":
      return "gemini-3.8-flash";
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "mock":
      return "mock-deterministic-v1";
  }
}

export function getDefaultFallbackModels(
  provider: LlmProviderName,
  primaryModel: string,
): string[] {
  if (provider === "gemini") {
    const candidates = [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ];
    return candidates.filter((m) => m !== primaryModel);
  }
  return [];
}

export function parseFallbackModelsList(
  raw?: string,
): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function normalizeProviderName(raw?: string): LlmProviderName {
  const cleaned = (raw || "gemini").trim().toLowerCase();
  if (
    cleaned === "gemini" ||
    cleaned === "openai" ||
    cleaned === "anthropic" ||
    cleaned === "mock"
  ) {
    return cleaned;
  }
  throw new Error(
    `[Error] Unsupported LLM provider "${raw}". Supported providers: gemini, openai, anthropic, mock.`,
  );
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
