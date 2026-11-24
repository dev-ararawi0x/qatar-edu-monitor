// Set required env BEFORE importing app modules (static imports hoist).
process.env.DATABASE_URL ??=
  "postgres://postgres:postgres@localhost:5432/qatar_edu_monitor_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-0123456789abcdef";
process.env.ENCRYPTION_KEY ??= "ab".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.WEB_ORIGIN ??= "http://localhost:5173";
process.env.LMS_BASE_URL ??= "https://qeducation.edu.gov.qa";
process.env.LLM_PROVIDER ??= "mock";

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
import {
  user,
  lmsClasses,
  lmsQuizzes,
  solveBatches,
  solveJobs,
} from "../src/db/schema/index.js";
import { appErrorHandler, UnauthorizedError } from "../src/lib/errors.js";
import type { AuthVariables } from "../src/middleware/auth.middleware.js";
import { createJobsRoutes } from "../src/modules/jobs/jobs.routes.js";
import { SolveJobWorker } from "../src/lib/jobs/solve-job.worker.js";

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
  app.route("/api/jobs", createJobsRoutes(db));
  return app;
}

async function createTestDb(): Promise<Db> {
  const pglite = new PGlite();
  const pdb = drizzle(pglite, { schema });
  await migrate(pdb, { migrationsFolder: "./src/db/migrations" });
  return pdb as unknown as Db;
}

async function seedUser(db: Db, id: string) {
  await db.insert(user).values({ id, name: id, email: `${id}@test.dev` });
}

async function seedDueQuiz(db: Db, userId: string, suffix: string) {
  const [cls] = await db
    .insert(lmsClasses)
    .values({ userId, lmsClassId: `c-${suffix}`, title: "Math" })
    .returning();
  const [quiz] = await db
    .insert(lmsQuizzes)
    .values({
      userId,
      classId: cls!.id,
      lmsQuizId: `lms-${suffix}`,
      title: `Quiz ${suffix}`,
      status: "due_unsolved",
    })
    .returning();
  return quiz!;
}

test("batch creation queues jobs and marks quizzes queued; dupes rejected", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const q1 = await seedDueQuiz(db, "u1", "a");
  const q2 = await seedDueQuiz(db, "u1", "b");
  const app = buildApp(db);
  const h = { "x-test-user": "u1", "content-type": "application/json" };

  const res = await app.request("/api/jobs/batches", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ quizIds: [q1.id, q2.id], startNewAllowed: true }),
  });
  assert.equal(res.status, 201);
  const batch = (await res.json()) as {
    id: string;
    totalJobs: number;
    jobs: Array<{ status: string; quizId: string }>;
  };
  assert.equal(batch.totalJobs, 2);
  assert.equal(batch.jobs.length, 2);
  assert.ok(batch.jobs.every((j) => j.status === "pending"));

  const q1row = await db.query.lmsQuizzes.findFirst({
    where: eq(lmsQuizzes.id, q1.id),
  });
  assert.equal(q1row?.status, "queued");

  // Re-queue same quizzes -> 400 (no eligible statuses left)
  const res2 = await app.request("/api/jobs/batches", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ quizIds: [q1.id] }),
  });
  assert.equal(res2.status, 400);
});

test("allDue queues every due_unsolved quiz and skips ineligible ones", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  await seedDueQuiz(db, "u1", "d1");
  await seedDueQuiz(db, "u1", "d2");
  const finished = await seedDueQuiz(db, "u1", "d3");
  await db
    .update(lmsQuizzes)
    .set({ status: "finished" })
    .where(eq(lmsQuizzes.id, finished.id));

  const app = buildApp(db);
  const res = await app.request("/api/jobs/batches", {
    method: "POST",
    headers: { "x-test-user": "u1", "content-type": "application/json" },
    body: JSON.stringify({ allDue: true }),
  });
  assert.equal(res.status, 201);
  const batch = (await res.json()) as { totalJobs: number };
  assert.equal(batch.totalJobs, 2);
});

test("batches and jobs are isolated per user (IDOR)", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  const q = await seedDueQuiz(db, "u1", "x");
  const app = buildApp(db);
  const h1 = { "x-test-user": "u1", "content-type": "application/json" };

  const created = await app.request("/api/jobs/batches", {
    method: "POST",
    headers: h1,
    body: JSON.stringify({ quizIds: [q.id] }),
  });
  const batch = (await created.json()) as { id: string; jobs: Array<{ id: string }> };

  const h2 = { "x-test-user": "u2" };
  assert.equal(
    (await app.request(`/api/jobs/batches/${batch.id}`, { headers: h2 })).status,
    404,
  );
  assert.equal(
    (await app.request(`/api/jobs/jobs/${batch.jobs[0]!.id}/cancel`, {
      method: "POST",
      headers: { ...h2, "content-type": "application/json" },
      body: "{}",
    })).status,
    404,
  );
});

test("worker claims a job, fails fast on missing LMS cookie, quiz -> failed", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const q = await seedDueQuiz(db, "u1", "w1");

  // Create batch directly via service path (HTTP app not needed).
  const { createSolveBatch } = await import("../src/modules/jobs/jobs.service.js");
  const batch = await createSolveBatch(db, "u1", {
    quizIds: [q.id],
    allDue: false,
    startNewAllowed: true,
    allowTimed: false,
  });
  assert.equal(batch.jobs.length, 1);

  const worker = new SolveJobWorker(db, { workerId: "test-worker" });
  await worker.tick();

  const job = await db.query.solveJobs.findFirst({
    where: eq(solveJobs.batchId, batch.id),
  });
  assert.equal(job?.status, "failed");
  assert.equal(job?.errorCode, "lms_session_expired");

  const quiz = await db.query.lmsQuizzes.findFirst({
    where: eq(lmsQuizzes.id, q.id),
  });
  assert.equal(quiz?.status, "failed");

  const batchRow = await db.query.solveBatches.findFirst({
    where: eq(solveBatches.id, batch.id),
  });
  assert.equal(batchRow?.failedJobs, 1);
});

test("stale lease reaper requeues running jobs with fresh attempts", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const q = await seedDueQuiz(db, "u1", "s1");

  const [batch] = await db
    .insert(solveBatches)
    .values({ userId: "u1", status: "running", totalJobs: 1 })
    .returning();
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await db.insert(solveJobs).values({
    batchId: batch!.id,
    userId: "u1",
    quizId: q.id,
    status: "running",
    attempts: 1,
    lockedAt: old,
    lockedBy: "dead-worker",
    startedAt: old,
  });
  await db
    .update(lmsQuizzes)
    .set({ status: "solving" })
    .where(eq(lmsQuizzes.id, q.id));

  const worker = new SolveJobWorker(db, {
    workerId: "reaper",
    leaseMs: 60_000,
    pollIntervalMs: 60_000,
  });
  await worker.tick(); // reaps stale -> pending, then may claim & fail it

  // After tick the job was reaped then claimed and failed (no cookie) OR
  // remains pending if claim ordering differed — assert it left 'running'.
  const job = await db.query.solveJobs.findFirst({
    where: eq(solveJobs.batchId, batch!.id),
  });
  assert.notEqual(job?.status, "running");
  assert.notEqual(job?.lockedBy, "dead-worker");
});

test("cancel batch releases pending jobs and quizzes", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const q = await seedDueQuiz(db, "u1", "c1");

  const { createSolveBatch, cancelBatch } = await import(
    "../src/modules/jobs/jobs.service.js"
  );
  const batch = await createSolveBatch(db, "u1", {
    quizIds: [q.id],
    allDue: false,
    startNewAllowed: true,
    allowTimed: false,
  });

  const result = await cancelBatch(db, "u1", batch.id);
  assert.equal(result.cancelled, 1);

  const job = await db.query.solveJobs.findFirst({
    where: eq(solveJobs.batchId, batch.id),
  });
  assert.equal(job?.status, "cancelled");

  const quiz = await db.query.lmsQuizzes.findFirst({
    where: eq(lmsQuizzes.id, q.id),
  });
  assert.equal(quiz?.status, "due_unsolved");
});

test("retry requeues a failed job and resets the quiz", async () => {
  const db = await createTestDb();
  await seedUser(db, "u1");
  const q = await seedDueQuiz(db, "u1", "r1");

  const { createSolveBatch } = await import("../src/modules/jobs/jobs.service.js");
  const batch = await createSolveBatch(db, "u1", {
    quizIds: [q.id],
    allDue: false,
    startNewAllowed: true,
    allowTimed: false,
  });
  const worker = new SolveJobWorker(db, { workerId: "t" });
  await worker.tick();

  const job = await db.query.solveJobs.findFirst({
    where: eq(solveJobs.batchId, batch.id),
  });
  assert.equal(job?.status, "failed");

  const { retryJob } = await import("../src/modules/jobs/jobs.service.js");
  const res = await retryJob(db, "u1", job!.id);
  assert.equal(res.retried, true);

  const job2 = await db.query.solveJobs.findFirst({
    where: eq(solveJobs.id, job!.id),
  });
  assert.equal(job2?.status, "pending");
  assert.equal(job2?.attempts, 0);

  const quiz = await db.query.lmsQuizzes.findFirst({
    where: eq(lmsQuizzes.id, q.id),
  });
  assert.equal(quiz?.status, "queued");
});
