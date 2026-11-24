import { eq } from "drizzle-orm";
import {
  getDefaultFallbackModels,
  getDefaultModelForProvider,
  normalizeProviderName,
  type LanguagePreference,
  type LlmProviderName,
} from "@qatar-edu/core";
import type { Db } from "../../db/client.js";
import { userLlmSettings } from "../../db/schema/index.js";
import { encryptSecret, decryptSecret } from "../../lib/crypto-vault.js";
import { getEnv } from "../../env.js";
import type { UpdateLlmSettingsInput } from "./settings.schema.js";

export interface LlmSettingsDto {
  source: "server" | "user";
  useCustomConfig: boolean;
  provider: string;
  model: string;
  hasCustomApiKey: boolean;
  baseUrl: string | null;
  fallbackModels: string[];
  languagePreference: LanguagePreference;
}

export async function getLlmSettings(
  db: Db,
  userId: string,
): Promise<LlmSettingsDto> {
  const row = await db.query.userLlmSettings.findFirst({
    where: eq(userLlmSettings.userId, userId),
  });

  if (row?.useCustomConfig && row.provider) {
    return {
      source: "user",
      useCustomConfig: true,
      provider: row.provider,
      model: row.model ?? "",
      hasCustomApiKey: Boolean(row.encryptedApiKey),
      baseUrl: row.baseUrl ?? null,
      fallbackModels: row.fallbackModels ?? [],
      languagePreference:
        (row.languagePreference as LanguagePreference | undefined) ?? "auto",
    };
  }

  const env = getEnv();
  const provider = normalizeProviderName(env.LLM_PROVIDER);
  return {
    source: "server",
    useCustomConfig: false,
    provider,
    model: env.LLM_MODEL ?? "",
    hasCustomApiKey: Boolean(env.LLM_API_KEY && env.LLM_API_KEY !== "VALUES"),
    baseUrl: env.LLM_BASE_URL ?? null,
    fallbackModels: [],
    languagePreference: "auto",
  };
}

export async function updateLlmSettings(
  db: Db,
  userId: string,
  input: UpdateLlmSettingsInput,
): Promise<LlmSettingsDto> {
  const now = new Date();
  const existing = await db.query.userLlmSettings.findFirst({
    where: eq(userLlmSettings.userId, userId),
  });

  let encryptedApiKey: string | null | undefined = existing?.encryptedApiKey;
  if (input.apiKey && input.apiKey.trim() !== "") {
    encryptedApiKey = encryptSecret(input.apiKey.trim());
  } else if (input.apiKey === "") {
    encryptedApiKey = null;
  }

  const provider = input.provider
    ? normalizeProviderName(input.provider)
    : (existing?.provider as LlmProviderName | undefined);
  const model =
    input.model !== undefined
      ? input.model
      : (existing?.model ?? undefined);
  const fallbackModels =
    input.fallbackModels !== undefined
      ? input.fallbackModels.filter((m) => m.trim() !== "")
      : (existing?.fallbackModels ?? undefined);

  await db
    .insert(userLlmSettings)
    .values({
      userId,
      useCustomConfig: input.useCustomConfig,
      provider: provider ?? null,
      model: model ?? null,
      encryptedApiKey: encryptedApiKey ?? null,
      baseUrl: input.baseUrl ?? existing?.baseUrl ?? null,
      fallbackModels: fallbackModels ?? [],
      languagePreference: input.languagePreference,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userLlmSettings.userId,
      set: {
        useCustomConfig: input.useCustomConfig,
        provider: provider ?? null,
        model: model ?? null,
        ...(encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
        baseUrl: input.baseUrl ?? existing?.baseUrl ?? null,
        fallbackModels: fallbackModels ?? [],
        languagePreference: input.languagePreference,
        updatedAt: now,
      },
    });

  return getLlmSettings(db, userId);
}

/** Decrypts the stored key for internal use (job worker). Never exposed via API. */
export async function getDecryptedUserApiKey(
  db: Db,
  userId: string,
): Promise<string | null> {
  const row = await db.query.userLlmSettings.findFirst({
    where: eq(userLlmSettings.userId, userId),
  });
  if (!row?.encryptedApiKey) return null;
  try {
    return decryptSecret(row.encryptedApiKey);
  } catch {
    return null;
  }
}

export { getDefaultModelForProvider, getDefaultFallbackModels };
