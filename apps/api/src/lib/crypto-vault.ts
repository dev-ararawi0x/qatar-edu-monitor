import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getEnv } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const KEY_LENGTH = 32; // 256-bit
const FORMAT_VERSION = "v1";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

function parseKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new VaultError(
      `Encryption key must decode to ${KEY_LENGTH} bytes (64 hex chars).`,
    );
  }
  return key;
}

/** Returns the configured vault key as a Buffer. */
export function getVaultKey(): Buffer {
  const hex = getEnv().ENCRYPTION_KEY;
  if (!hex) {
    throw new VaultError(
      "ENCRYPTION_KEY is not configured. Set a 64-hex-char (32-byte) key in the environment.",
    );
  }
  return parseKey(hex);
}

/**
 * Encrypts a UTF-8 plaintext string with AES-256-GCM.
 * Output format: `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 */
export function encryptSecret(
  plaintext: string,
  key: Buffer = getVaultKey(),
): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a payload produced by `encryptSecret`.
 * Throws VaultError on malformed payloads, wrong keys, or tampered data.
 */
export function decryptSecret(
  payload: string,
  key: Buffer = getVaultKey(),
): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new VaultError("Malformed encrypted payload.");
  }
  const [, ivB64, tagB64, dataB64] = parts as [
    string,
    string,
    string,
    string,
  ];

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  if (iv.length !== IV_LENGTH || tag.length !== 16) {
    throw new VaultError("Malformed encrypted payload segments.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new VaultError(
      "Decryption failed — payload is corrupted or the key is wrong.",
    );
  }
}
