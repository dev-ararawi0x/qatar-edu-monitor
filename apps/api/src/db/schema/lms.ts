import {
  boolean,
  doublePrecision,
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

export const QUIZ_STATUSES = [
  "due_unsolved",
  "queued",
  "solving",
  "ready_for_review",
  "submitting_finish",
  "finished",
  "failed",
] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export const lmsClasses = pgTable(
  "lms_classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lmsClassId: text("lms_class_id").notNull(),
    title: text("title").notNull(),
    teacherName: text("teacher_name"),
    href: text("href"),
    isManual: boolean("is_manual").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("lms_classes_user_class_uniq").on(t.userId, t.lmsClassId),
    index("lms_classes_user_idx").on(t.userId),
  ],
);

export const lmsQuizzes = pgTable(
  "lms_quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => lmsClasses.id, { onDelete: "cascade" }),
    lmsQuizId: text("lms_quiz_id").notNull(),
    lmsResultsId: text("lms_results_id"),
    title: text("title").notNull(),
    showUrl: text("show_url"),
    displayUrl: text("display_url"),
    relatedLessonTitle: text("related_lesson_title"),
    isTimed: boolean("is_timed").notNull().default(false),
    totalParts: integer("total_parts"),
    status: text("status", { enum: QUIZ_STATUSES })
      .notNull()
      .default("due_unsolved"),
    summaryVerified: boolean("summary_verified").notNull().default(false),
    pausedSafely: boolean("paused_safely").notNull().default(false),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    lastSolvedAt: timestamp("last_solved_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("lms_quizzes_user_quiz_uniq").on(t.userId, t.lmsQuizId),
    index("lms_quizzes_user_status_idx").on(t.userId, t.status),
    index("lms_quizzes_class_idx").on(t.classId),
  ],
);

export const QUIZ_INPUT_TYPES = [
  "single_choice",
  "multiple_choice",
  "free_text",
  "structured_input",
  "file_upload",
  "unknown",
] as const;
export type QuizInputTypeSetting = (typeof QUIZ_INPUT_TYPES)[number];

export const quizAttemptQuestions = pgTable(
  "quiz_attempt_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => lmsQuizzes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    part: integer("part").notNull(),
    questionHeader: text("question_header"),
    promptText: text("prompt_text"),
    points: text("points"),
    inputType: text("input_type", { enum: QUIZ_INPUT_TYPES }),
    choices: jsonb("choices").$type<unknown[]>(),
    fieldDetails: jsonb("field_details").$type<unknown[]>(),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    aiAnswer: jsonb("ai_answer").$type<unknown>(),
    userOverrideAnswer: jsonb("user_override_answer").$type<unknown>(),
    formattedSummary: text("formatted_summary"),
    lmsRecordedAnswer: text("lms_recorded_answer"),
    confidence: doublePrecision("confidence"),
    reasoning: text("reasoning"),
    isVerifiedOnLms: boolean("is_verified_on_lms")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quiz_attempt_questions_quiz_part_uniq").on(
      t.quizId,
      t.part,
    ),
    index("quiz_attempt_questions_user_idx").on(t.userId),
  ],
);
