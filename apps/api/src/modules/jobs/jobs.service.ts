import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  lmsQuizzes,
  solveBatches,
  solveJobs,
  type SolveBatchStatus,
} from "../../db/schema/index.js";
import { encryptSecret } from "../../lib/crypto-vault.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../lib/errors.js";
import type { CreateBatchInput } from "./jobs.schema.js";

export interface SolveJobDto {
  id: string;
  quizId: string;
  quizTitle: string;
  status: string;
  currentPart: number;
  totalParts: number | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SolveBatchDto {
  id: string;
  status: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  startNewAllowed: boolean;
  allowTimed: boolean;
  hasCookieOverride: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  jobs: SolveJobDto[];
}

const ACTIVE_QUIZ_STATUSES = ["due_unsolved", "failed"] as const;

/** Creates a batch + pending solve jobs. Skips quizzes that already have an
 * active (pending/running) job thanks to the partial unique index. */
export async function createSolveBatch(
  db: Db,
  userId: string,
  input: CreateBatchInput,
): Promise<SolveBatchDto> {
  // Resolve target quizzes owned by this user.
  const conditions = [eq(lmsQuizzes.userId, userId)];
  if (input.allDue) {
    conditions.push(eq(lmsQuizzes.status, "due_unsolved"));
  } else if (input.quizIds && input.quizIds.length > 0) {
    conditions.push(inArray(lmsQuizzes.id, input.quizIds));
    conditions.push(inArray(lmsQuizzes.status, [...ACTIVE_QUIZ_STATUSES]));
  }

  const quizzes = await db.query.lmsQuizzes.findMany({
    where: and(...conditions),
  });

  if (quizzes.length === 0) {
    throw new ValidationError(
      "No eligible quizzes found. Only due_unsolved or failed quizzes can be queued.",
    );
  }

  const batch = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(solveBatches)
      .values({
        userId,
        status: "pending",
        totalJobs: 0,
        startNewAllowed: input.startNewAllowed,
        allowTimed: input.allowTimed,
        ...(input.cookieOverride
          ? { encryptedCookieOverride: encryptSecret(input.cookieOverride) }
          : {}),
      })
      .returning();
    if (!b) throw new Error("Failed to create batch");

    const now = new Date();
    let inserted = 0;
    for (const q of quizzes) {
      // Mark quiz as queued (only from eligible statuses).
      const claimed = await tx
        .update(lmsQuizzes)
        .set({ status: "queued", updatedAt: now })
        .where(
          and(
            eq(lmsQuizzes.id, q.id),
            inArray(lmsQuizzes.status, [...ACTIVE_QUIZ_STATUSES]),
          ),
        )
        .returning({ id: lmsQuizzes.id });
      if (claimed.length === 0) continue; // status changed concurrently

      const jobResult = await tx
        .insert(solveJobs)
        .values({
          batchId: b.id,
          userId,
          quizId: q.id,
          status: "pending",
          nextRunAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: solveJobs.id });
      if (jobResult.length > 0) inserted += 1;
    }

    if (inserted === 0) {
      throw new ValidationError(
        "All selected quizzes already have an active solve job.",
      );
    }

    await tx
      .update(solveBatches)
      .set({ totalJobs: inserted })
      .where(eq(solveBatches.id, b.id));

    return { ...b, totalJobs: inserted };
  });

  return getBatch(db, userId, batch.id);
}

export async function listBatches(
  db: Db,
  userId: string,
  limit = 20,
): Promise<SolveBatchDto[]> {
  const batches = await db.query.solveBatches.findMany({
    where: eq(solveBatches.userId, userId),
    orderBy: desc(solveBatches.createdAt),
    limit,
  });
  return Promise.all(batches.map((b) => getBatch(db, userId, b.id)));
}

export async function getBatch(
  db: Db,
  userId: string,
  batchId: string,
): Promise<SolveBatchDto> {
  const batch = await db.query.solveBatches.findFirst({
    where: and(eq(solveBatches.id, batchId), eq(solveBatches.userId, userId)),
  });
  if (!batch) throw new NotFoundError("Batch not found");

  const jobs = await db
    .select({
      job: solveJobs,
      quizTitle: lmsQuizzes.title,
    })
    .from(solveJobs)
    .innerJoin(lmsQuizzes, eq(solveJobs.quizId, lmsQuizzes.id))
    .where(eq(solveJobs.batchId, batch.id))
    .orderBy(solveJobs.createdAt);

  return {
    id: batch.id,
    status: batch.status,
    totalJobs: batch.totalJobs,
    completedJobs: batch.completedJobs,
    failedJobs: batch.failedJobs,
    startNewAllowed: batch.startNewAllowed,
    allowTimed: batch.allowTimed,
    hasCookieOverride: Boolean(batch.encryptedCookieOverride),
    createdAt: batch.createdAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    jobs: jobs.map(({ job, quizTitle }) => ({
      id: job.id,
      quizId: job.quizId,
      quizTitle,
      status: job.status,
      currentPart: job.currentPart,
      totalParts: job.totalParts,
      attempts: job.attempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
  };
}

/** Cancels pending jobs in a batch; running jobs are cancelled cooperatively
 * by the worker (it re-checks status between parts). */
export async function cancelBatch(
  db: Db,
  userId: string,
  batchId: string,
): Promise<{ cancelled: number }> {
  const batch = await db.query.solveBatches.findFirst({
    where: and(eq(solveBatches.id, batchId), eq(solveBatches.userId, userId)),
  });
  if (!batch) throw new NotFoundError("Batch not found");

  const now = new Date();
  const result = await db
    .update(solveJobs)
    .set({
      status: "cancelled",
      completedAt: now,
      errorCode: "user_cancelled",
      errorMessage: "Cancelled by user",
    })
    .where(
      and(
        eq(solveJobs.batchId, batch.id),
        inArray(solveJobs.status, ["pending", "running"]),
      ),
    );

  await db
    .update(solveBatches)
    .set({ status: "cancelled", completedAt: now })
    .where(eq(solveBatches.id, batch.id));

  // Release quizzes stuck in 'queued' back to due_unsolved where the job
  // never actually started.
  await db.execute(sql`
    UPDATE lms_quizzes q
    SET status = 'due_unsolved', updated_at = ${now}
    WHERE q.user_id = ${userId}
      AND q.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM solve_jobs j
        WHERE j.quiz_id = q.id AND j.status IN ('pending','running')
      )
  `);

  return { cancelled: result.rowCount ?? 0 };
}

export async function cancelJob(
  db: Db,
  userId: string,
  jobId: string,
): Promise<{ cancelled: boolean }> {
  const job = await db.query.solveJobs.findFirst({
    where: and(eq(solveJobs.id, jobId), eq(solveJobs.userId, userId)),
  });
  if (!job) throw new NotFoundError("Job not found");
  if (job.status !== "pending" && job.status !== "running") {
    throw new ConflictError(`Job is already ${job.status}`);
  }

  const now = new Date();
  await db
    .update(solveJobs)
    .set({
      status: "cancelled",
      completedAt: now,
      errorCode: "user_cancelled",
      errorMessage: "Cancelled by user",
    })
    .where(eq(solveJobs.id, job.id));

  // If the job never started running, release the quiz back to due_unsolved.
  if (job.status === "pending") {
    await db.execute(sql`
      UPDATE lms_quizzes
      SET status = 'due_unsolved', updated_at = ${now}
      WHERE id = ${job.quizId} AND status = 'queued'
    `);
  }
  await recomputeBatchStatus(db, job.batchId);
  return { cancelled: true };
}

/** Requeues a failed/cancelled job (resets to pending, keeps attempts count). */
export async function retryJob(
  db: Db,
  userId: string,
  jobId: string,
): Promise<{ retried: boolean }> {
  const job = await db.query.solveJobs.findFirst({
    where: and(eq(solveJobs.id, jobId), eq(solveJobs.userId, userId)),
  });
  if (!job) throw new NotFoundError("Job not found");
  if (job.status !== "failed" && job.status !== "cancelled") {
    throw new ConflictError(`Only failed or cancelled jobs can be retried`);
  }

  const now = new Date();
  await db
    .update(solveJobs)
    .set({
      status: "pending",
      attempts: 0,
      nextRunAt: now,
      lockedAt: null,
      lockedBy: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    })
    .where(eq(solveJobs.id, job.id));

  await db
    .update(lmsQuizzes)
    .set({ status: "queued", updatedAt: now })
    .where(eq(lmsQuizzes.id, job.quizId));

  await db
    .update(solveBatches)
    .set({ status: "pending" })
    .where(eq(solveBatches.id, job.batchId));

  return { retried: true };
}

/** Recomputes batch counters/status from its jobs. Called by the worker. */
export async function recomputeBatchStatus(
  db: Db,
  batchId: string,
): Promise<void> {
  const rows = await db
    .select({ status: solveJobs.status, count: sql<number>`count(*)::int` })
    .from(solveJobs)
    .where(eq(solveJobs.batchId, batchId))
    .groupBy(solveJobs.status);

  const counts = new Map(rows.map((r) => [r.status, r.count]));
  const pending = counts.get("pending") ?? 0;
  const running = counts.get("running") ?? 0;
  const completed = counts.get("completed") ?? 0;
  const failed = counts.get("failed") ?? 0;
  const cancelled = counts.get("cancelled") ?? 0;
  const total = pending + running + completed + failed + cancelled;

  let status: SolveBatchStatus;
  if (total === 0) status = "pending";
  else if (pending + running > 0) status = running > 0 ? "running" : "pending";
  else if (failed > 0 && completed + cancelled > 0) status = "partial_failure";
  else if (failed > 0) status = "partial_failure";
  else if (cancelled === total) status = "cancelled";
  else status = "completed";

  const now = new Date();
  const done = pending + running === 0;
  await db
    .update(solveBatches)
    .set({
      status,
      completedJobs: completed,
      failedJobs: failed,
      ...(done ? { completedAt: now } : {}),
      ...(running > 0 && status === "running"
        ? { startedAt: sql`coalesce(started_at, ${now})` }
        : {}),
    })
    .where(eq(solveBatches.id, batchId));
}
