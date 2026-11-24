import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const LMS_SESSION_STATUSES = [
  "active",
  "expired",
  "unverified",
] as const;
export type LmsSessionStatus = (typeof LMS_SESSION_STATUSES)[number];

/**
 * Per-user LMS credential vault. `encryptedCookie` is AES-256-GCM ciphertext
 * (never plaintext); `cookieNames` stores names only for display/debugging.
 */
export const userLmsCredentials = pgTable("user_lms_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lmsBaseUrl: text("lms_base_url").notNull(),
  encryptedCookie: text("encrypted_cookie").notNull(),
  cookieNames: jsonb("cookie_names").$type<string[]>().notNull().default([]),
  sessionStatus: text("session_status", { enum: LMS_SESSION_STATUSES })
    .notNull()
    .default("unverified"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const LANGUAGE_PREFERENCES = ["auto", "ar", "en"] as const;
export type LanguagePreferenceSetting =
  (typeof LANGUAGE_PREFERENCES)[number];

/**
 * Optional per-user LLM override. When `useCustomConfig` is false the server
 * `.env` LLM configuration is used instead. `encryptedApiKey` is AES-256-GCM
 * ciphertext when present.
 */
export const userLlmSettings = pgTable("user_llm_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  useCustomConfig: boolean("use_custom_config").notNull().default(false),
  provider: text("provider"),
  model: text("model"),
  baseUrl: text("base_url"),
  fallbackModels: jsonb("fallback_models")
    .$type<string[]>()
    .notNull()
    .default([]),
  encryptedApiKey: text("encrypted_api_key"),
  languagePreference: text("language_preference", {
    enum: LANGUAGE_PREFERENCES,
  })
    .notNull()
    .default("auto"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
