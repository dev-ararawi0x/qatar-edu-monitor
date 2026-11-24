import { eq } from "drizzle-orm";
import {
  getDefaultFallbackModels,
  getDefaultModelForProvider,
  normalizeProviderName,
  parseFallbackModelsList,
  type LanguagePreference,
  type LlmProviderConfig,
} from "@qatar-edu/core";
import { db, type Db } from "../db/client.js";
import { userLlmSettings } from "../db/schema/index.js";
import { decryptSecret } from "./crypto-vault.js";
import { getEnv } from "../env.js";

export interface ResolvedLlmConfig extends LlmProviderConfig {
  languagePreference: LanguagePreference;
  source: "server" | "user";
}

/**
 * Resolves the effective LLM configuration for a user:
 * per-user encrypted override when enabled, otherwise server `.env` defaults.
 */
export async function resolveLlmConfig(
  database: Db,
  userId: string,
): Promise<ResolvedLlmConfig> {
  const row = await database.query.userLlmSettings.findFirst({
    where: eq(userLlmSettings.userId, userId),
  });

  const languagePreference: LanguagePreference =
    (row?.languagePreference as LanguagePreference | undefined) ?? "auto";

  if (row?.useCustomConfig && row.provider) {
    const provider = normalizeProviderName(row.provider);
    const model =
      row.model?.trim() || getDefaultModelForProvider(provider);
    const apiKey = row.encryptedApiKey
      ? decryptSecret(row.encryptedApiKey)
      : "";
    const fallbackModels =
      row.fallbackModels && row.fallbackModels.length > 0
        ? row.fallbackModels
        : getDefaultFallbackModels(provider, model);

    return {
      provider,
      model,
      apiKey,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
      quiet: true,
      languagePreference,
      source: "user",
    };
  }

  const env = getEnv();
  const provider = normalizeProviderName(env.LLM_PROVIDER);
  const model = env.LLM_MODEL?.trim() || getDefaultModelForProvider(provider);
  const fallbackModels =
    parseFallbackModelsList(env.LLM_FALLBACK_MODELS) ??
    getDefaultFallbackModels(provider, model);

  return {
    provider,
    model,
    apiKey: env.LLM_API_KEY ?? "",
    ...(env.LLM_BASE_URL ? { baseUrl: env.LLM_BASE_URL } : {}),
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    quiet: true,
    languagePreference,
    source: "server",
  };
}

export function resolveLlmConfigForUser(
  userId: string,
): Promise<ResolvedLlmConfig> {
  return resolveLlmConfig(db, userId);
}
