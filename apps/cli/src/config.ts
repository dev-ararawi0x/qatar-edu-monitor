import "dotenv/config";
import path from "node:path";
import type { CommandContext } from "./types/index.js";
import type { LlmProviderConfig } from "@qatar-edu/core";
import {
  getDefaultFallbackModels,
  getDefaultModelForProvider,
  normalizeProviderName,
  parseFallbackModelsList,
} from "@qatar-edu/core";

export {
  getDefaultFallbackModels,
  getDefaultModelForProvider,
  normalizeProviderName,
  parseFallbackModelsList,
};

export interface AppConfig {
  baseUrl: string;
  defaultClassId: string;
  initialCookie: string;
  reportsDir: string;
  llm: LlmProviderConfig;
}

export function loadAppConfig(): AppConfig {
  const rawBaseUrl = process.env.LMS_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error(
      "[Error] LMS_BASE_URL is not configured. Set it in .env or pass a full --url.",
    );
  }
  const baseUrl = rawBaseUrl.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(baseUrl) || baseUrl.includes("<") || baseUrl.includes(">")) {
    throw new Error(
      "[Error] LMS_BASE_URL appears invalid or still contains a placeholder (<...>). Set a valid base URL in .env.",
    );
  }
  const defaultClassId = process.env.LMS_CLASS_ID || "";
  const initialCookie = process.env.LMS_COOKIE || "VALUES";
  const reportsDir = process.env.REPORTS_DIR
    ? path.resolve(process.env.REPORTS_DIR)
    : path.resolve(process.cwd(), "reports");

  const provider = normalizeProviderName(process.env.LLM_PROVIDER || "gemini");
  const model = (process.env.LLM_MODEL || "").trim() || getDefaultModelForProvider(provider);
  const apiKey =
    process.env.LLM_API_KEY ||
    (provider === "gemini"
      ? process.env.GEMINI_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : undefined) ||
    "VALUES";
  const llmBaseUrl = (process.env.LLM_BASE_URL || "").trim();
  const fallbackModels =
    parseFallbackModelsList(process.env.LLM_FALLBACK_MODELS) ??
    getDefaultFallbackModels(provider, model);

  return {
    baseUrl,
    defaultClassId,
    initialCookie,
    reportsDir,
    llm: {
      provider,
      model,
      apiKey,
      ...(llmBaseUrl ? { baseUrl: llmBaseUrl.replace(/\/$/, "") } : {}),
      ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    },
  };
}

export function buildCommandContext(
  config: AppConfig,
  overrides?: Partial<{
    quiet: boolean;
    writeReport: boolean;
    outDir?: string;
    llm?: Partial<LlmProviderConfig>;
  }>,
): CommandContext {
  const reportsDir = overrides?.outDir
    ? path.resolve(overrides.outDir)
    : config.reportsDir;

  const provider = overrides?.llm?.provider ?? config.llm.provider;
  const model =
    overrides?.llm?.model ??
    (overrides?.llm?.provider && overrides.llm.provider !== config.llm.provider
      ? getDefaultModelForProvider(overrides.llm.provider)
      : config.llm.model);
  const apiKey = overrides?.llm?.apiKey ?? config.llm.apiKey;
  const llmBaseUrl = overrides?.llm?.baseUrl ?? config.llm.baseUrl;
  const fallbackModels =
    overrides?.llm?.fallbackModels ??
    (provider !== config.llm.provider || model !== config.llm.model
      ? getDefaultFallbackModels(provider, model)
      : config.llm.fallbackModels);
  const quiet = overrides?.quiet ?? false;

  return {
    baseUrl: config.baseUrl,
    defaultClassId: config.defaultClassId,
    initialCookie: config.initialCookie,
    reportsDir,
    quiet,
    writeReport: overrides?.writeReport ?? true,
    ...(overrides?.outDir ? { outDir: path.resolve(overrides.outDir) } : {}),
    llm: {
      provider,
      model,
      apiKey,
      quiet,
      ...(llmBaseUrl ? { baseUrl: llmBaseUrl } : {}),
      ...(fallbackModels && fallbackModels.length > 0 ? { fallbackModels } : {}),
    },
  };
}
