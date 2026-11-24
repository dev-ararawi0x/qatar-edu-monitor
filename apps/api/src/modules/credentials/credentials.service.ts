import { eq } from "drizzle-orm";
import {
  LmsHttpClient,
  SessionCookieJar,
  validateAllowedLmsBaseUrl,
  verifyLmsSession,
} from "@qatar-edu/core";
import type { Db } from "../../db/client.js";
import { userLmsCredentials } from "../../db/schema/index.js";
import { encryptSecret, decryptSecret } from "../../lib/crypto-vault.js";
import { getEnv } from "../../env.js";
import { ValidationError } from "../../lib/errors.js";
import type { SaveCookieInput } from "./credentials.schema.js";

export interface CredentialsStatusDto {
  hasStoredCookie: boolean;
  cookieNames: string[];
  sessionStatus: string;
  lmsBaseUrl: string | null;
  lastVerifiedAt: string | null;
}

function toDto(
  row: typeof userLmsCredentials.$inferSelect | undefined,
): CredentialsStatusDto {
  return {
    hasStoredCookie: Boolean(row?.encryptedCookie),
    cookieNames: row?.cookieNames ?? [],
    sessionStatus: row?.sessionStatus ?? "unverified",
    lmsBaseUrl: row?.lmsBaseUrl ?? null,
    lastVerifiedAt: row?.lastVerifiedAt?.toISOString() ?? null,
  };
}

export async function getCredentialsStatus(
  db: Db,
  userId: string,
): Promise<CredentialsStatusDto> {
  const row = await db.query.userLmsCredentials.findFirst({
    where: eq(userLmsCredentials.userId, userId),
  });
  return toDto(row);
}

/**
 * Saves (and verifies) the user's default LMS cookie. The cookie is validated
 * against the LMS dashboard before storage; rotated Set-Cookie values are
 * persisted so the stored session stays fresh.
 */
export async function saveLmsCookie(
  db: Db,
  userId: string,
  input: SaveCookieInput,
): Promise<CredentialsStatusDto & { verified: boolean }> {
  const env = getEnv();
  const baseUrl = validateAllowedLmsBaseUrl(
    input.lmsBaseUrl ?? env.LMS_BASE_URL ?? "https://qeducation.edu.gov.qa",
  );

  const client = new LmsHttpClient(baseUrl, input.cookie, true);
  const session = await verifyLmsSession(client);

  // Persist whatever cookies the jar holds after verification (covers
  // Set-Cookie rotation during the dashboard fetch).
  const finalCookieHeader = client.cookieJar.hasRealCookies()
    ? client.cookieJar.toCookieHeader()
    : input.cookie;
  const cookieNames =
    client.cookieJar.getCookieNames().length > 0
      ? client.cookieJar.getCookieNames()
      : new SessionCookieJar(input.cookie).getCookieNames();

  const now = new Date();
  await db
    .insert(userLmsCredentials)
    .values({
      userId,
      lmsBaseUrl: baseUrl,
      encryptedCookie: encryptSecret(finalCookieHeader),
      cookieNames,
      sessionStatus: session.valid ? "active" : "expired",
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userLmsCredentials.userId,
      set: {
        lmsBaseUrl: baseUrl,
        encryptedCookie: encryptSecret(finalCookieHeader),
        cookieNames,
        sessionStatus: session.valid ? "active" : "expired",
        lastVerifiedAt: now,
        updatedAt: now,
      },
    });

  return {
    ...toDto({
      userId,
      lmsBaseUrl: baseUrl,
      encryptedCookie: encryptSecret(finalCookieHeader),
      cookieNames,
      sessionStatus: session.valid ? "active" : "expired",
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
    verified: session.valid,
  };
}

/** Re-verifies the stored cookie against the LMS and updates its status. */
export async function verifyStoredCookie(
  db: Db,
  userId: string,
): Promise<CredentialsStatusDto & { verified: boolean }> {
  const row = await db.query.userLmsCredentials.findFirst({
    where: eq(userLmsCredentials.userId, userId),
  });
  if (!row) {
    throw new ValidationError("No LMS cookie stored. Save one first.");
  }

  const cookieHeader = decryptSecret(row.encryptedCookie);
  const client = new LmsHttpClient(row.lmsBaseUrl, cookieHeader, true);
  const session = await verifyLmsSession(client);

  const now = new Date();
  const newHeader = client.cookieJar.hasRealCookies()
    ? client.cookieJar.toCookieHeader()
    : cookieHeader;
  const cookieNames =
    client.cookieJar.getCookieNames().length > 0
      ? client.cookieJar.getCookieNames()
      : row.cookieNames;

  await db
    .update(userLmsCredentials)
    .set({
      encryptedCookie: encryptSecret(newHeader),
      cookieNames,
      sessionStatus: session.valid ? "active" : "expired",
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(userLmsCredentials.userId, userId));

  return {
    hasStoredCookie: true,
    cookieNames,
    sessionStatus: session.valid ? "active" : "expired",
    lmsBaseUrl: row.lmsBaseUrl,
    lastVerifiedAt: now.toISOString(),
    verified: session.valid,
  };
}

export async function deleteLmsCookie(
  db: Db,
  userId: string,
): Promise<{ deleted: boolean }> {
  const result = await db
    .delete(userLmsCredentials)
    .where(eq(userLmsCredentials.userId, userId));
  return { deleted: (result.rowCount ?? 0) > 0 };
}
