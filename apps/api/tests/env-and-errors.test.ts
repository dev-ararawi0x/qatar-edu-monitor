import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { parseEnv } from "../src/env.js";
import {
  appErrorHandler,
  AppError,
  LmsSessionExpiredError,
  NotFoundError,
  ValidationError,
} from "../src/lib/errors.js";

const VALID_ENV = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
};

test("parseEnv accepts minimal valid config and applies defaults", () => {
  const env = parseEnv(VALID_ENV);
  assert.equal(env.DATABASE_URL, VALID_ENV.DATABASE_URL);
  assert.equal(env.PORT, 3001);
  assert.equal(env.LLM_PROVIDER, "gemini");
  assert.equal(env.ENABLE_EMBEDDED_WORKER, "true");
});

test("parseEnv rejects missing DATABASE_URL and weak secret", () => {
  assert.throws(() => parseEnv({ BETTER_AUTH_SECRET: "a".repeat(32) }));
  assert.throws(() =>
    parseEnv({ DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "short" }),
  );
  assert.throws(() =>
    parseEnv({
      DATABASE_URL: "postgres://x",
      BETTER_AUTH_SECRET: "a".repeat(32),
      ENCRYPTION_KEY: "zz-not-hex",
    }),
  );
});

test("appErrorHandler returns typed errors with sanitized messages", async () => {
  const app = new Hono();
  app.onError(appErrorHandler);

  app.get("/v", () => {
    throw new ValidationError("bad authenticity_token=SESSION_SECRET_VALUE here");
  });
  app.get("/n", () => {
    throw new NotFoundError("missing authenticity_token=TOKEN123");
  });
  app.get("/l", () => {
    throw new LmsSessionExpiredError();
  });
  app.get("/x", () => {
    throw new AppError(418, "TEAPOT", "cookie: sessionid=ABCDEF");
  });
  app.get("/boom", () => {
    throw new Error("password=hunter2 api_key=sk-123");
  });

  const v = await app.request("/v");
  assert.equal(v.status, 400);
  const vBody = (await v.json()) as { error: { code: string; message: string } };
  assert.equal(vBody.error.code, "VALIDATION_ERROR");
  assert.ok(!vBody.error.message.includes("SESSION_SECRET_VALUE"));

  const n = await app.request("/n");
  assert.equal(n.status, 404);
  const nBody = (await n.json()) as { error: { message: string } };
  assert.ok(!nBody.error.message.includes("TOKEN123"));

  const l = await app.request("/l");
  assert.equal(l.status, 401);
  const lBody = (await l.json()) as { error: { code: string } };
  assert.equal(lBody.error.code, "LMS_SESSION_EXPIRED");

  const x = await app.request("/x");
  assert.equal(x.status, 418);
  const xBody = (await x.json()) as { error: { message: string } };
  assert.ok(xBody.error.message.includes("VALUES"));

  const boom = await app.request("/boom");
  assert.equal(boom.status, 500);
  const boomBody = (await boom.json()) as { error: { code: string; message: string } };
  assert.equal(boomBody.error.code, "INTERNAL_ERROR");
  assert.ok(!boomBody.error.message.includes("hunter2"));
});
