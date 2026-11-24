// Set required env BEFORE importing app modules (static imports hoist).
process.env.DATABASE_URL ??=
  "postgres://postgres:postgres@localhost:5432/qatar_edu_monitor_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-0123456789abcdef";
process.env.ENCRYPTION_KEY ??= "ab".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.WEB_ORIGIN ??= "http://localhost:5173";
process.env.LMS_BASE_URL ??= "https://qeducation.edu.gov.qa";

import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema/index.js";
import { user, lmsClasses, lmsQuizzes, quizAttemptQuestions } from "../src/db/schema/index.js";
import { appErrorHandler, UnauthorizedError } from "../src/lib/errors.js";
import type { AuthVariables } from "../src/middleware/auth.middleware.js";
import { createCredentialsRoutes } from "../src/modules/credentials/credentials.routes.js";
import { createSettingsRoutes } from "../src/modules/settings/settings.routes.js";
import { createClassesRoutes } from "../src/modules/classes/classes.routes.js";
import { createQuizzesRoutes } from "../src/modules/quizzes/quizzes.routes.js";

const fakeAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const uid = c.req.header("x-test-user");
    if (!uid) throw new UnauthorizedError("Authentication required.");
    c.set("user", { id: uid, email: `${uid}@test.dev`, name: uid });
    c.set("session", {
      id: "test-session",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await next();
  },
);

function buildApp(db: Db) {
  const app = new Hono();
  app.onError(appErrorHandler);
  app.use("/api/*", fakeAuth);
  app.route("/api/credentials", createCredentialsRoutes(db));
  app.route("/api/settings", createSettingsRoutes(db));
  app.route("/api/classes", createClassesRoutes(db));
  app.route("/api/quizzes", createQuizzesRoutes(db));
  return app;
}

async function createTestDb(): Promise<Db> {
  const pglite = new PGlite();
  const pdb = drizzle(pglite, { schema });
  await migrate(pdb, { migrationsFolder: "./src/db/migrations" });
  return pdb as unknown as Db;
}

async function seedUser(db: Db, id: string) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@test.dev`,
  });
}

let seedCounter = 0;
async function seedQuiz(
  db: Db,
  userId: string,
  opts: { status?: string; withQuestion?: boolean } = {},
) {
  seedCounter += 1;
  const [cls] = await db
    .insert(lmsClasses)
    .values({
      userId,
      lmsClassId: `c-${userId}-${seedCounter}`,
      title: "Math",
    })
    .returning();
  const [quiz] = await db
    .insert(lmsQuizzes)
    .values({
      userId,
      classId: cls!.id,
      lmsQuizId: `q-${userId}-${seedCounter}`,
      lmsResultsId: "12345",
      title: "Quiz 1",
      status: (opts.status ?? "ready_for_review") as never,
      totalParts: 2,
    })
    .returning();
  if (opts.withQuestion !== false) {
    await db.insert(quizAttemptQuestions).values([
      {
        quizId: quiz!.id,
        userId,
        part: 1,
        questionHeader: "Q1",
        promptText: "What is 2+2?",
        inputType: "single_choice",
        imageUrls: [],
      },
      {
        quizId: quiz!.id,
        userId,
        part: 2,
        questionHeader: "Q2",
        promptText: "Capital of Qatar?",
        inputType: "free_text",
        imageUrls: ["/uploads/pic1.png"],
      },
    ]);
  }
  return quiz!;
}

test("modules require authentication", async () => {
  const db = await createTestDb();
  const app = buildApp(db);
  for (const path of [
    "/api/classes",
    "/api/settings/llm",
    "/api/credentials/status",
    "/api/quizzes/00000000-0000-0000-0000-000000000000",
  ]) {
    const res = await app.request(path);
    assert.equal(res.status, 401, `${path} should require auth`);
  }
});

test("quiz detail is isolated per user (IDOR)", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  const quiz = await seedQuiz(db, "u1");
  const app = buildApp(db);

  const own = await app.request(`/api/quizzes/${quiz.id}`, {
    headers: { "x-test-user": "u1" },
  });
  assert.equal(own.status, 200);
  const ownBody = (await own.json()) as {
    title: string;
    questions: Array<{ part: number; promptText: string }>;
  };
  assert.equal(ownBody.title, "Quiz 1");
  assert.equal(ownBody.questions.length, 2);

  const foreign = await app.request(`/api/quizzes/${quiz.id}`, {
    headers: { "x-test-user": "u2" },
  });
  assert.equal(foreign.status, 404);
});

test("input validation rejects malformed payloads", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const quiz = await seedQuiz(db, "u1");
  const app = buildApp(db);
  const h = { "x-test-user": "u1", "content-type": "application/json" };

  // Cookie too short / placeholder
  let res = await app.request("/api/credentials/cookie", {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ cookie: "VALUES" }),
  });
  assert.equal(res.status, 400);

  // Empty override fields
  res = await app.request(`/api/quizzes/${quiz.id}/questions/1`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ fields: {} }),
  });
  assert.equal(res.status, 400);

  // Finish without explicit confirmation
  res = await app.request(`/api/quizzes/${quiz.id}/finish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ confirmFinish: false }),
  });
  assert.equal(res.status, 400);
});

test("settings never expose the API key and roundtrip custom config", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const app = buildApp(db);
  const h = { "x-test-user": "u1", "content-type": "application/json" };

  let res = await app.request("/api/settings/llm", { headers: h });
  let body = (await res.json()) as { source: string; hasCustomApiKey: boolean };
  assert.equal(body.source, "server");
  assert.equal(body.hasCustomApiKey, false);

  res = await app.request("/api/settings/llm", {
    method: "PUT",
    headers: h,
    body: JSON.stringify({
      useCustomConfig: true,
      provider: "openai",
      apiKey: "sk-super-secret-test-key",
      languagePreference: "ar",
    }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(!raw.includes("sk-super-secret-test-key"), "key leaked in response");

  res = await app.request("/api/settings/llm", { headers: h });
  body = (await res.json()) as {
    source: string;
    hasCustomApiKey: boolean;
    provider: string;
    languagePreference: string;
  };
  assert.equal(body.source, "user");
  assert.equal(body.hasCustomApiKey, true);
  assert.equal(body.provider, "openai");
  assert.equal(body.languagePreference, "ar");
});

test("finish is blocked for wrong status and reverts claim on LMS failure", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const app = buildApp(db);
  const h = { "x-test-user": "u1", "content-type": "application/json" };

  // due_unsolved -> 409
  let quiz = await seedQuiz(db, "u1", { status: "due_unsolved" });
  let res = await app.request(`/api/quizzes/${quiz.id}/finish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ confirmFinish: true }),
  });
  assert.equal(res.status, 409);

  // ready_for_review but no stored LMS cookie -> claim reverts to ready_for_review
  quiz = await seedQuiz(db, "u1", { status: "ready_for_review" });
  res = await app.request(`/api/quizzes/${quiz.id}/finish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ confirmFinish: true }),
  });
  assert.equal(res.status, 401); // LmsSessionExpiredError -> 401 LMS_SESSION_EXPIRED
  const row = await db.query.lmsQuizzes.findFirst({
    where: eq(lmsQuizzes.id, quiz.id),
  });
  assert.equal(row?.status, "ready_for_review");

  // finished -> 409 already finished
  await db
    .update(lmsQuizzes)
    .set({ status: "finished" })
    .where(eq(lmsQuizzes.id, quiz.id));
  res = await app.request(`/api/quizzes/${quiz.id}/finish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ confirmFinish: true }),
  });
  assert.equal(res.status, 409);
});

test("classes list is empty before sync and isolated per user", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  await seedQuiz(db, "u1");
  const app = buildApp(db);

  const res = await app.request("/api/classes", {
    headers: { "x-test-user": "u1" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    classes: Array<{ title: string; quizzes: unknown[] }>;
  };
  assert.equal(body.classes.length, 1);
  assert.equal(body.classes[0]!.quizzes.length, 1);

  const other = await app.request("/api/classes", {
    headers: { "x-test-user": "u2" },
  });
  const otherBody = (await other.json()) as { classes: unknown[] };
  assert.equal(otherBody.classes.length, 0);
});

test("RPC client type surface matches mounted routes", async () => {
  const { hc } = await import("hono/client");
  const { default: app } = await import("../src/app.js");
  void app;
  const client = hc<import("../src/rpc.js").AppType>("http://localhost:3001");
  // Compile-time surface checks (no network calls).
  void client.api.credentials.status.$get;
  void client.api.settings.llm.$get;
  void client.api.settings.llm.$put;
  void client.api.classes.$get;
  void client.api.quizzes[":quizId"].$get;
  void client.api.quizzes[":quizId"].finish.$post;
});
