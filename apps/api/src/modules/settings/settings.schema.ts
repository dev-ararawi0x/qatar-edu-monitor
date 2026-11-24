import { z } from "zod";

const languagePreferenceSchema = z.enum(["auto", "ar", "en"]);

export const updateLlmSettingsSchema = z.object({
  useCustomConfig: z.boolean().default(false),
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Send a new key to store; omit or send "" to keep the existing key. */
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  fallbackModels: z.array(z.string()).optional(),
  languagePreference: languagePreferenceSchema.default("auto"),
});

export type UpdateLlmSettingsInput = z.infer<typeof updateLlmSettingsSchema>;
