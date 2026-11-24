import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  createLlmProvider,
  QuizSolveAbortedError,
  runQuizSolverWorkflow,
  sanitizeJsonValue,
  sanitizeText,
  type QuizSolveStepResult,
} from "@qatar-edu/core";
import type { Db } from "../../db/client.js";
import {
  lmsClasses,
  lmsQuizzes,
  quizAttemptQuestions,
  solveBatches,
  solveJobs,
} from "../../db/schema/index.js";
import { decryptSecret } from "../crypto-vault.js";
import { resolveLlmConfig } from "../llm-resolver.js";
import { withLmsSession } from "../lms-session.factory.js";
import { recomputeBatchStatus } from "../../modules/jobs/jobs.service.js";

export interface WorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  /** Jobs locked longer than this are considered stale and reaped. */
  leaseMs?: number;
  /** Max consecutive claim attempts when the per-user lock blocks a job. */
  maxAttemptsDefault?: number;
}

const DEFAULT_POLL_MS = 2_500;
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const RETRY_BASE_DELAY_MS = 30_000;

interface ClaimedJob {
  id: string;
  batchId: string;
  userId: string;
  quizId: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Postgres-backed solve job worker. Claims pending jobs with
 * `FOR UPDATE SKIP LOCKED`, enforces one running job per user, persists
 * per-part progress live, and pauses (never finishes) quiz attempts.
 */
export class SolveJobWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly controllers = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private ticking = false;

  constructor(
    private readonly db: Db,
    options: WorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Abort in-flight solves so attempts pause cleanly.
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    // Give running jobs a moment to pause their attempts.
    await new Promise((r) => setTimeout(r, 1_500));
  }

  /** Processes at most one pending job per call (sequential per worker). */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.reapStaleJobs();
      const job = await this.claimNextJob();
      if (job) await this.processJob(job);
    } catch (err) {
      console.error(
        "[worker] tick error:",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.ticking = false;
    }
  }

  // ------------------------------------------------------------------
  // Claiming
  // ------------------------------------------------------------------

  private async claimNextJob(): Promise<ClaimedJob | null> {
    try {
      const rows = await this.db.execute(sql`
        UPDATE solve_jobs
        SET status = 'running',
            locked_at = now(),
            locked_by = ${this.workerId},
            started_at = coalesce(started_at, now()),
            attempts = attempts + 1
        WHERE id = (
          SELECT j.id FROM solve_jobs j
          WHERE j.status = 'pending'
            AND j.next_run_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM solve_jobs r
              WHERE r.user_id = j.user_id AND r.status = 'running'
            )
          ORDER BY j.next_run_at, j.created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, batch_id AS "batchId", user_id AS "userId",
                  quiz_id AS "quizId", attempts, max_attempts AS "maxAttempts"
      `);
      const row = rows.rows[0] as unknown as ClaimedJob | undefined;
      if (!row) return null;

      // Reflect running state on batch + quiz immediately.
      await this.db
        .update(solveBatches)
        .set({ status: "running", startedAt: sql`coalesce(started_at, now())` })
        .where(eq(solveBatches.id, row.batchId));
      await this.db
        .update(lmsQuizzes)
        .set({ status: "solving", updatedAt: new Date() })
        .where(eq(lmsQuizzes.id, row.quizId));

      return row;
    } catch (err) {
      // Unique violation on solve_jobs_one_running_per_user -> another
      // worker won the race for this user; simply try again next tick.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /** Resets jobs whose lock exceeded the lease (worker crash recovery). */
  private async reapStaleJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - this.leaseMs);
    const stale = await this.db
      .select({ id: solveJobs.id, attempts: solveJobs.attempts, maxAttempts: solveJobs.maxAttempts, quizId: solveJobs.quizId, batchId: solveJobs.batchId })
      .from(solveJobs)
      .where(and(eq(solveJobs.status, "running"), lt(solveJobs.lockedAt, cutoff)));

    for (const job of stale) {
      const exhausted = job.attempts >= job.maxAttempts;
      await this.db
        .update(solveJobs)
        .set(
          exhausted
            ? {
                status: "failed",
                errorCode: "stale_lease_exhausted",
                errorMessage: "Job lease expired repeatedly; marked failed.",
                completedAt: new Date(),
              }
            : {
                status: "pending",
                nextRunAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                errorCode: "stale_lease",
                errorMessage: "Worker lease expired; requeued.",
              },
        )
        .where(eq(solveJobs.id, job.id));

      await this.db
        .update(lmsQuizzes)
        .set({
          status: exhausted ? "failed" : "queued",
          updatedAt: new Date(),
        })
        .where(eq(lmsQuizzes.id, job.quizId));
      await recomputeBatchStatus(this.db, job.batchId);
    }
  }

  // ------------------------------------------------------------------
  // Job processing
  // ------------------------------------------------------------------

  private async processJob(job: ClaimedJob): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      // Cooperative cancel check + load context.
      const ctx = await this.loadJobContext(job);
      if (!ctx) {
        await this.markJobCancelledIfNeeded(job);
        return;
      }
      const { quiz, classRow, batch } = ctx;

      const llmConfig = await resolveLlmConfig(this.db, job.userId);
      const llmProvider = createLlmProvider({
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        ...(llmConfig.baseUrl ? { baseUrl: llmConfig.baseUrl } : {}),
        ...(llmConfig.fallbackModels?.length
          ? { fallbackModels: llmConfig.fallbackModels }
          : {}),
        quiet: true,
      });

      const cookieOverride = batch.encryptedCookieOverride
        ? decryptSecret(batch.encryptedCookieOverride)
        : undefined;

      const workflowResult = await withLmsSession(
        this.db,
        job.userId,
        (client) =>
          runQuizSolverWorkflow(client, {
            targetOrUrl: quiz.showUrl ?? quiz.lmsQuizId,
            baseUrl: client.baseUrl,
            llmProvider,
            languagePreference: llmConfig.languagePreference,
            ...(classRow?.title ? { subjectHint: classRow.title } : {}),
            ...(quiz.relatedLessonTitle
              ? { lessonTitle: quiz.relatedLessonTitle }
              : {}),
            startNew: batch.startNewAllowed,
            allowTimed: batch.allowTimed,
            apply: true,
            quiet: true,
            signal: controller.signal,
            onPartProgress: (event) =>
              this.onPartProgress(job, quiz.id, event),
          }),
        {
          ...(cookieOverride ? { cookieOverride, ephemeral: true } : {}),
        },
      );

      await this.persistSolveResult(
        job,
        quiz.id,
        workflowResult.result,
        workflowResult.displayUrl,
      );
      await this.completeJob(job, workflowResult.result.warnings);
    } catch (err) {
      await this.handleJobError(job, err);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async loadJobContext(job: ClaimedJob) {
    const jobRow = await this.db.query.solveJobs.findFirst({
      where: eq(solveJobs.id, job.id),
    });
    // User cancelled while we were claiming.
    if (!jobRow || jobRow.status !== "running") return null;

    const quiz = await this.db.query.lmsQuizzes.findFirst({
      where: eq(lmsQuizzes.id, job.quizId),
    });
    if (!quiz) return null;

    const [classRow, batch] = await Promise.all([
      this.db.query.lmsClasses.findFirst({
        where: eq(lmsClasses.id, quiz.classId),
      }),
      this.db.query.solveBatches.findFirst({
        where: eq(solveBatches.id, job.batchId),
      }),
    ]);
    if (!batch) return null;
    return { quiz, classRow, batch };
  }

  private async markJobCancelledIfNeeded(job: ClaimedJob): Promise<void> {
    const jobRow = await this.db.query.solveJobs.findFirst({
      where: eq(solveJobs.id, job.id),
    });
    if (jobRow?.status === "cancelled") {
      await this.db
        .update(lmsQuizzes)
        .set({ status: "due_unsolved", updatedAt: new Date() })
        .where(
          and(
            eq(lmsQuizzes.id, job.quizId),
            eq(lmsQuizzes.status, "solving"),
          ),
        );
      await recomputeBatchStatus(this.db, job.batchId);
    }
  }

  /** Live per-part progress: updates job counters and upserts the question
   * shell so the UI can render progress while the job keeps running. */
  private async onPartProgress(
    job: ClaimedJob,
    quizRowId: string,
    event: {
      stage: string;
      part: number;
      totalParts: number;
      questionHeader?: string;
      formattedSummary?: string;
    },
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(solveJobs)
      .set({
        currentPart: event.part,
        totalParts: event.totalParts,
        lockedAt: now, // heartbeat: keeps the lease fresh
      })
      .where(eq(solveJobs.id, job.id));

    // Cooperative cancellation: user cancelled -> abort the solve.
    const fresh = await this.db.query.solveJobs.findFirst({
      where: eq(solveJobs.id, job.id),
      columns: { status: true },
    });
    if (fresh?.status === "cancelled") {
      this.controllers.get(job.id)?.abort();
      return;
    }

    if (event.stage === "llm_solved" || event.stage === "answer_posted") {
      await this.db
        .insert(quizAttemptQuestions)
        .values({
          quizId: quizRowId,
          userId: job.userId,
          part: event.part,
          ...(event.questionHeader
            ? { questionHeader: sanitizeText(event.questionHeader) }
            : {}),
          ...(event.formattedSummary
            ? { formattedSummary: event.formattedSummary }
            : {}),
        })
        .onConflictDoUpdate({
          target: [quizAttemptQuestions.quizId, quizAttemptQuestions.part],
          set: {
            ...(event.questionHeader
              ? { questionHeader: sanitizeText(event.questionHeader) }
              : {}),
            ...(event.formattedSummary
              ? { formattedSummary: event.formattedSummary }
              : {}),
            updatedAt: now,
          },
        });
    }
  }

  /** Persists the full solve result: questions, AI answers, quiz status. */
  private async persistSolveResult(
    job: ClaimedJob,
    quizRowId: string,
    result: {
      quizId: number;
      resultsId: number;
      totalParts: number;
      pausedSafely: boolean;
      reachedSummary: boolean;
      summaryVerified: boolean;
      warnings: string[];
      displayUrl?: string;
      questions: Array<{
        part: number;
        totalParts: number;
        screen: {
          questionHeader: string;
          promptText: string;
          points: string;
          inputType: string;
          choices: unknown;
          fieldDetails: unknown;
          imageUrls: string[];
        };
      }>;
      steps: QuizSolveStepResult[];
      summaryItems?: Array<{ recordedAnswer: string }>;
    },
    displayUrl?: string,
  ): Promise<void> {
    const now = new Date();
    const stepByPart = new Map(result.steps.map((s) => [s.part, s]));

    for (const q of result.questions) {
      const step = stepByPart.get(q.part);
      const screen = q.screen;
      await this.db
        .insert(quizAttemptQuestions)
        .values({
          quizId: quizRowId,
          userId: job.userId,
          part: q.part,
          questionHeader: sanitizeText(screen.questionHeader),
          promptText: sanitizeText(screen.promptText),
          points: screen.points ?? null,
          inputType: screen.inputType as never,
          choices: sanitizeJsonValue(screen.choices) as never,
          fieldDetails: sanitizeJsonValue(screen.fieldDetails) as never,
          imageUrls: screen.imageUrls ?? [],
          ...(step
            ? {
                aiAnswer: sanitizeJsonValue(step.solvedAnswer) as never,
                formattedSummary: step.formattedSummary,
                confidence: step.solvedAnswer.confidence,
                reasoning: sanitizeText(step.solvedAnswer.reasoning),
              }
            : {}),
        })
        .onConflictDoUpdate({
          target: [quizAttemptQuestions.quizId, quizAttemptQuestions.part],
          set: {
            questionHeader: sanitizeText(screen.questionHeader),
            promptText: sanitizeText(screen.promptText),
            points: screen.points ?? null,
            inputType: screen.inputType as never,
            choices: sanitizeJsonValue(screen.choices) as never,
            fieldDetails: sanitizeJsonValue(screen.fieldDetails) as never,
            imageUrls: screen.imageUrls ?? [],
            ...(step
              ? {
                  aiAnswer: sanitizeJsonValue(step.solvedAnswer) as never,
                  formattedSummary: step.formattedSummary,
                  confidence: step.solvedAnswer.confidence,
                  reasoning: sanitizeText(step.solvedAnswer.reasoning),
                }
              : {}),
            updatedAt: now,
          },
        });
    }

    // Map summary recorded answers positionally onto questions.
    if (result.summaryItems?.length) {
      const questions = await this.db.query.quizAttemptQuestions.findMany({
        where: eq(quizAttemptQuestions.quizId, quizRowId),
        orderBy: (t, { asc }) => [asc(t.part)],
      });
      for (let i = 0; i < questions.length; i++) {
        const item = result.summaryItems[i];
        if (!item) continue;
        await this.db
          .update(quizAttemptQuestions)
          .set({
            lmsRecordedAnswer: item.recordedAnswer,
            isVerifiedOnLms: true,
            updatedAt: now,
          })
          .where(eq(quizAttemptQuestions.id, questions[i]!.id));
      }
    }

    await this.db
      .update(lmsQuizzes)
      .set({
        lmsResultsId: String(result.resultsId),
        totalParts: result.totalParts,
        status: "ready_for_review",
        summaryVerified: result.summaryVerified,
        pausedSafely: result.pausedSafely,
        warnings: result.warnings,
        lastSolvedAt: now,
        ...(displayUrl ? { displayUrl } : {}),
        updatedAt: now,
      })
      .where(eq(lmsQuizzes.id, quizRowId));
  }

  private async completeJob(
    job: ClaimedJob,
    warnings: string[],
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(solveJobs)
      .set({
        status: "completed",
        currentPart: sql`greatest(current_part, coalesce(total_parts, current_part))`,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        ...(warnings.length > 0
          ? { errorCode: "warnings", errorMessage: warnings.join(" | ") }
          : {}),
      })
      .where(eq(solveJobs.id, job.id));
    await recomputeBatchStatus(this.db, job.batchId);
  }

  private async handleJobError(job: ClaimedJob, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort =
      err instanceof QuizSolveAbortedError ||
      (err instanceof Error && err.name === "AbortError") ||
      (err instanceof Error && err.message.includes("aborted"));

    const fresh = await this.db.query.solveJobs.findFirst({
      where: eq(solveJobs.id, job.id),
    });

    // User-cancelled -> keep cancelled status, release quiz.
    if (fresh?.status === "cancelled" || isAbort) {
      await this.db
        .update(solveJobs)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          errorCode: "cancelled",
          errorMessage: "Solve aborted; attempt paused safely.",
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(solveJobs.id, job.id));
      await this.db
        .update(lmsQuizzes)
        .set({ status: "due_unsolved", updatedAt: new Date() })
        .where(eq(lmsQuizzes.id, job.quizId));
      await recomputeBatchStatus(this.db, job.batchId);
      return;
    }

    const sessionExpired = message.includes("[LMS Session Expired]");
    const timedBlocked = message.includes("[Safety Stop]");
    const retryable =
      !sessionExpired && !timedBlocked && job.attempts < job.maxAttempts;

    if (retryable) {
      const delayMs = RETRY_BASE_DELAY_MS * job.attempts;
      await this.db
        .update(solveJobs)
        .set({
          status: "pending",
          nextRunAt: new Date(Date.now() + delayMs),
          lockedAt: null,
          lockedBy: null,
          errorCode: "retryable_error",
          errorMessage: sanitizeText(message).slice(0, 500),
        })
        .where(eq(solveJobs.id, job.id));
      await this.db
        .update(lmsQuizzes)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(lmsQuizzes.id, job.quizId));
    } else {
      await this.db
        .update(solveJobs)
        .set({
          status: "failed",
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          errorCode: sessionExpired
            ? "lms_session_expired"
            : timedBlocked
              ? "timed_quiz_blocked"
              : "solve_failed",
          errorMessage: sanitizeText(message).slice(0, 500),
        })
        .where(eq(solveJobs.id, job.id));
      await this.db
        .update(lmsQuizzes)
        .set({
          status: "failed",
          warnings: [sanitizeText(message).slice(0, 300)],
          updatedAt: new Date(),
        })
        .where(eq(lmsQuizzes.id, job.quizId));
    }
    await recomputeBatchStatus(this.db, job.batchId);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

