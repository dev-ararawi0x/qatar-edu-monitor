// Set required env BEFORE importing app modules (static imports hoist, so we
// use dynamic imports inside the tests).
process.env.DATABASE_URL ??=
  "postgres://postgres:postgres@localhost:5432/qatar_edu_monitor_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-0123456789abcdef";
process.env.ENCRYPTION_KEY ??= "ab".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.WEB_ORIGIN ??= "http://localhost:5173";
process.env.LMS_BASE_URL ??= "https://qeducation.edu.gov.qa";

import test from "node:test";
import assert from "node:assert/strict";

test("GET /health returns ok", async () => {
  const { default: app } = await import("../src/app.js");
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; service: string };
  assert.equal(body.status, "ok");
  assert.equal(body.service, "@qatar-edu/api");
});

test("CORS allows configured WEB_ORIGIN with credentials", async () => {
  const { default: app } = await import("../src/app.js");
  const res = await app.request("/health", {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

test("requireAuth middleware rejects unauthenticated requests with 401", async () => {
  const { Hono } = await import("hono");
  const { requireAuth } = await import("../src/middleware/auth.middleware.js");
  const { appErrorHandler } = await import("../src/lib/errors.js");

  const app = new Hono();
  app.onError(appErrorHandler);
  app.get("/protected", requireAuth, (c) => c.json({ ok: true }));

  const res = await app.request("/protected");
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("better-auth handler responds on /api/auth/* without crashing", async () => {
  const { default: app } = await import("../src/app.js");
  // better-auth exposes a health/ok endpoint that does not need DB writes.
  const res = await app.request("/api/auth/ok");
  assert.ok(res.status === 200 || res.status === 404);
});
