import "dotenv/config";
import path from "node:path";
import type {
  CommandContext,
  LlmProviderConfig,
  LlmProviderName,
} from "../types/index.js";

export interface AppConfig {
  baseUrl: string;
  defaultClassId: string;
  initialCookie: string;
  reportsDir: string;
  llm: LlmProviderConfig;
}

export function getDefaultModelForProvider(provider: LlmProviderName): string {
  switch (provider) {
    case "gemini":
      return "gemini-2.5-flash";
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "mock":
      return "mock-deterministic-v1";
  }
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

export function loadAppConfig(): AppConfig {
  const baseUrl = (process.env.LMS_BASE_URL || "https://qeducation.edu.gov.qa").replace(/\/$/, "");
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

  return {
    baseUrl: config.baseUrl,
    defaultClassId: config.defaultClassId,
    initialCookie: config.initialCookie,
    reportsDir,
    quiet: overrides?.quiet ?? false,
    writeReport: overrides?.writeReport ?? true,
    ...(overrides?.outDir ? { outDir: path.resolve(overrides.outDir) } : {}),
    llm: {
      provider,
      model,
      apiKey,
      ...(llmBaseUrl ? { baseUrl: llmBaseUrl } : {}),
    },
  };
}
