import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { lmsQuizzes } from "./lms.js";

export const SOLVE_BATCH_STATUSES = [
  "pending",
  "running",
  "completed",
  "partial_failure",
  "cancelled",
] as const;
export type SolveBatchStatus = (typeof SOLVE_BATCH_STATUSES)[number];

export const SOLVE_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SolveJobStatus = (typeof SOLVE_JOB_STATUSES)[number];

export const solveBatches = pgTable(
  "solve_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: SOLVE_BATCH_STATUSES })
      .notNull()
      .default("pending"),
    totalJobs: integer("total_jobs").notNull().default(0),
    completedJobs: integer("completed_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    startNewAllowed: boolean("start_new_allowed")
      .notNull()
      .default(false),
    allowTimed: boolean("allow_timed").notNull().default(false),
    /**
     * Optional ephemeral AES-256-GCM encrypted LMS cookie override used only
     * for this batch. Wiped (set to NULL) once the batch finishes.
     */
    encryptedCookieOverride: text("encrypted_cookie_override"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("solve_batches_user_idx").on(t.userId, t.createdAt)],
);

export const solveJobs = pgTable(
  "solve_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => solveBatches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => lmsQuizzes.id, { onDelete: "cascade" }),
    status: text("status", { enum: SOLVE_JOB_STATUSES })
      .notNull()
      .default("pending"),
    currentPart: integer("current_part").notNull().default(0),
    totalParts: integer("total_parts"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // At most one active (pending|running) job per quiz — prevents duplicate
    // queueing of the same quiz attempt.
    uniqueIndex("solve_jobs_active_quiz_uniq")
      .on(t.quizId)
      .where(sql`${t.status} IN ('pending','running')`),
    // Fast claim scan for pending, due jobs.
    index("solve_jobs_claim_idx")
      .on(t.nextRunAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    // At most ONE running job per user — serializes LMS session usage per
    // student while allowing full parallelism across different users.
    uniqueIndex("solve_jobs_one_running_per_user")
      .on(t.userId)
      .where(sql`${t.status} = 'running'`),
    index("solve_jobs_user_status_idx").on(t.userId, t.status),
    index("solve_jobs_batch_idx").on(t.batchId),
  ],
);
