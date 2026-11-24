import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  VaultError,
} from "../src/lib/crypto-vault.js";

const key = randomBytes(32);
const otherKey = randomBytes(32);

test("encryptSecret/decryptSecret roundtrips UTF-8 plaintext", () => {
  const secret = "lms_session_v1=abc123; csrf=xyz — cookies & توكنز";
  const payload = encryptSecret(secret, key);

  assert.ok(payload.startsWith("v1:"));
  assert.ok(!payload.includes(secret));
  assert.equal(decryptSecret(payload, key), secret);
});

test("encryptSecret produces unique IVs for identical plaintext", () => {
  const a = encryptSecret("same", key);
  const b = encryptSecret("same", key);
  assert.notEqual(a, b);
});

test("decryptSecret rejects wrong key", () => {
  const payload = encryptSecret("secret", key);
  assert.throws(() => decryptSecret(payload, otherKey), VaultError);
});

test("decryptSecret rejects tampered ciphertext and auth tag", () => {
  const payload = encryptSecret("secret", key);
  const parts = payload.split(":");
  const tamperedData = Buffer.from(parts[3] ?? "", "base64");
  tamperedData[0] = (tamperedData[0] ?? 0) ^ 0xff;
  parts[3] = tamperedData.toString("base64");
  assert.throws(() => decryptSecret(parts.join(":"), key), VaultError);

  const tamperedTag = Buffer.from(parts[2] ?? "", "base64");
  tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;
  const parts2 = payload.split(":");
  parts2[2] = tamperedTag.toString("base64");
  assert.throws(() => decryptSecret(parts2.join(":"), key), VaultError);
});

test("decryptSecret rejects malformed payloads", () => {
  assert.throws(() => decryptSecret("not-a-payload", key), VaultError);
  assert.throws(() => decryptSecret("v2:a:b:c", key), VaultError);
  assert.throws(() => decryptSecret("v1:a:b", key), VaultError);
});
