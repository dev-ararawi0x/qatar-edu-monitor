import { and, asc, eq } from "drizzle-orm";
import {
  fetchAllQuizPartsReadOnly,
  isSameLmsOriginUrl,
  overrideQuizPartAnswer,
  submitQuizFinishExplicitly,
  verifySummaryScreenCompleteness,
  type HttpFormFieldValue,
} from "@qatar-edu/core";
import type { Db } from "../../db/client.js";
import {
  lmsClasses,
  lmsQuizzes,
  quizAttemptQuestions,
} from "../../db/schema/index.js";
import { withLmsSession } from "../../lib/lms-session.factory.js";
import {
  ConflictError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../../lib/errors.js";
import {
  toQuestionDto,
  toQuizDto,
  type QuestionDto,
  type QuizDto,
} from "../../lib/dto.js";
import type {
  FinishQuizInput,
  OverrideAnswerInput,
} from "./quizzes.schema.js";

export interface QuizDetailDto extends QuizDto {
  classTitle: string;
  questions: QuestionDto[];
}

const EDITABLE_STATUSES = new Set(["ready_for_review", "due_unsolved"]);

async function getOwnedQuiz(db: Db, userId: string, quizId: string) {
  const quiz = await db.query.lmsQuizzes.findFirst({
    where: and(eq(lmsQuizzes.id, quizId), eq(lmsQuizzes.userId, userId)),
  });
  if (!quiz) throw new NotFoundError("Quiz not found");
  return quiz;
}

function requireResultsId(quiz: { lmsResultsId: string | null }): string {
  if (!quiz.lmsResultsId) {
    throw new ValidationError(
      "This quiz has no active attempt (resultsId) yet. Solve it first.",
    );
  }
  return quiz.lmsResultsId;
}

export async function getQuizDetail(
  db: Db,
  userId: string,
  quizId: string,
): Promise<QuizDetailDto> {
  const quiz = await getOwnedQuiz(db, userId, quizId);
  const [questions, cls] = await Promise.all([
    db.query.quizAttemptQuestions.findMany({
      where: and(
        eq(quizAttemptQuestions.quizId, quiz.id),
        eq(quizAttemptQuestions.userId, userId),
      ),
      orderBy: asc(quizAttemptQuestions.part),
    }),
    db.query.lmsClasses.findFirst({
      where: eq(lmsClasses.id, quiz.classId),
    }),
  ]);

  return {
    ...toQuizDto(quiz),
    classTitle: cls?.title ?? "",
    questions: questions.map(toQuestionDto),
  };
}

/** Proxies a question image through the API (SSRF-safe, same-origin only). */
export async function getQuestionImage(
  db: Db,
  userId: string,
  quizId: string,
  part: number,
  imageIndex: number,
): Promise<{ data: Buffer; contentType: string }> {
  const quiz = await getOwnedQuiz(db, userId, quizId);
  const question = await db.query.quizAttemptQuestions.findFirst({
    where: and(
      eq(quizAttemptQuestions.quizId, quiz.id),
      eq(quizAttemptQuestions.userId, userId),
      eq(quizAttemptQuestions.part, part),
    ),
  });
  if (!question) throw new NotFoundError("Question not found");

  const imageUrl = question.imageUrls[imageIndex];
  if (!imageUrl) throw new NotFoundError("Image not found");

  const result = await withLmsSession(db, userId, async (client) => {
    if (!isSameLmsOriginUrl(imageUrl, client.baseUrl)) {
      throw new ValidationError("Image URL is outside the allowed LMS origin.");
    }
    const binary = await client.fetchBinary(imageUrl);
    if (!binary) {
      throw new UpstreamError("Failed to fetch image from LMS.");
    }
    return binary;
  });

  return {
    data: Buffer.from(result.base64, "base64"),
    contentType: result.contentType || "image/png",
  };
}

/**
 * Re-saves one question part on the LMS with user-edited answers, then
 * re-syncs recorded answers from the summary screen. Never finishes.
 */
export async function overridePartAnswer(
  db: Db,
  userId: string,
  quizId: string,
  part: number,
  input: OverrideAnswerInput,
): Promise<{ part: number; nextScreenStage: string }> {
  const quiz = await getOwnedQuiz(db, userId, quizId);
  if (!EDITABLE_STATUSES.has(quiz.status)) {
    throw new ConflictError(
      `Quiz is ${quiz.status}; answers can only be edited before finishing.`,
    );
  }
  const resultsId = requireResultsId(quiz);

  const question = await db.query.quizAttemptQuestions.findFirst({
    where: and(
      eq(quizAttemptQuestions.quizId, quiz.id),
      eq(quizAttemptQuestions.userId, userId),
      eq(quizAttemptQuestions.part, part),
    ),
  });
  if (!question) throw new NotFoundError("Question not found");

  const fields = input.fields as Record<string, HttpFormFieldValue>;

  const result = await withLmsSession(db, userId, async (client) => {
    const overrideResult = await overrideQuizPartAnswer(client, {
      quizId: quiz.lmsQuizId,
      resultsId,
      part,
      fields,
    });

    // Refresh summary state so recorded answers stay accurate.
    const readOnly = await fetchAllQuizPartsReadOnly(
      client,
      quiz.lmsQuizId,
      resultsId,
    );
    return { overrideResult, readOnly };
  });

  const now = new Date();
  await db
    .update(quizAttemptQuestions)
    .set({
      userOverrideAnswer: fields,
      updatedAt: now,
    })
    .where(eq(quizAttemptQuestions.id, question.id));

  await syncSummaryToQuestions(db, quiz.id, userId, result.readOnly);
  await db
    .update(lmsQuizzes)
    .set({ summaryVerified: true, pausedSafely: true, updatedAt: now })
    .where(eq(lmsQuizzes.id, quiz.id));

  return {
    part: result.overrideResult.part,
    nextScreenStage: result.overrideResult.nextScreenStage,
  };
}

/** Re-reads all parts + summary and refreshes recorded answers/verification. */
export async function reverifyQuiz(
  db: Db,
  userId: string,
  quizId: string,
): Promise<{ summaryVerified: boolean; warnings: string[]; itemCount: number }> {
  const quiz = await getOwnedQuiz(db, userId, quizId);
  const resultsId = requireResultsId(quiz);

  const readOnly = await withLmsSession(db, userId, (client) =>
    fetchAllQuizPartsReadOnly(client, quiz.lmsQuizId, resultsId),
  );

  const verification = verifySummaryScreenCompleteness(
    readOnly.summaryItems,
    quiz.totalParts ?? readOnly.questions.length,
  );

  await syncSummaryToQuestions(db, quiz.id, userId, readOnly);
  await db
    .update(lmsQuizzes)
    .set({
      summaryVerified: verification.verified,
      pausedSafely: true,
      warnings: verification.warnings,
      totalParts: quiz.totalParts ?? readOnly.questions.length,
      updatedAt: new Date(),
    })
    .where(eq(lmsQuizzes.id, quiz.id));

  return {
    summaryVerified: verification.verified,
    warnings: verification.warnings,
    itemCount: readOnly.summaryItems.length,
  };
}

/**
 * THE human-initiated finish path. Atomically claims the quiz
 * (ready_for_review -> submitting_finish) so double-clicks/retries cannot
 * submit twice, then delegates to the Symbol-gated core service.
 */
export async function finishQuiz(
  db: Db,
  userId: string,
  quizId: string,
  _input: FinishQuizInput,
): Promise<{ finished: boolean; status: number; warnings: string[] }> {
  const quiz = await getOwnedQuiz(db, userId, quizId);

  // Atomic claim: only one request can transition ready_for_review.
  const claimed = await db
    .update(lmsQuizzes)
    .set({ status: "submitting_finish", updatedAt: new Date() })
    .where(
      and(
        eq(lmsQuizzes.id, quiz.id),
        eq(lmsQuizzes.userId, userId),
        eq(lmsQuizzes.status, "ready_for_review"),
      ),
    )
    .returning({ id: lmsQuizzes.id });

  if (claimed.length === 0) {
    if (quiz.status === "finished") {
      throw new ConflictError("This quiz has already been finished.");
    }
    if (quiz.status === "submitting_finish") {
      throw new ConflictError("Finish already in progress for this quiz.");
    }
    throw new ConflictError(
      `Quiz must be ready_for_review to finish (current: ${quiz.status}).`,
    );
  }

  const resultsId = requireResultsId(quiz);

  try {
    const result = await withLmsSession(db, userId, (client) =>
      submitQuizFinishExplicitly(client, {
        quizId: quiz.lmsQuizId,
        resultsId,
        ...(quiz.totalParts != null ? { expectedParts: quiz.totalParts } : {}),
      }),
    );

    if (!result.submitted) {
      throw new UpstreamError(
        `LMS did not confirm quiz submission (HTTP ${result.status}).`,
      );
    }

    const now = new Date();
    await db
      .update(lmsQuizzes)
      .set({
        status: "finished",
        finishedAt: now,
        summaryVerified: result.verified,
        warnings: result.warnings,
        updatedAt: now,
      })
      .where(eq(lmsQuizzes.id, quiz.id));

    return { finished: true, status: result.status, warnings: result.warnings };
  } catch (err) {
    // Revert claim so the user can retry after fixing the issue.
    await db
      .update(lmsQuizzes)
      .set({ status: "ready_for_review", updatedAt: new Date() })
      .where(eq(lmsQuizzes.id, quiz.id));
    throw err;
  }
}

/** Maps summary items onto stored questions (positional matching). */
async function syncSummaryToQuestions(
  db: Db,
  quizRowId: string,
  userId: string,
  readOnly: {
    summaryItems: Array<{
      questionTitle: string;
      promptPreview: string;
      recordedAnswer: string;
    }>;
  },
): Promise<void> {
  const questions = await db.query.quizAttemptQuestions.findMany({
    where: and(
      eq(quizAttemptQuestions.quizId, quizRowId),
      eq(quizAttemptQuestions.userId, userId),
    ),
    orderBy: asc(quizAttemptQuestions.part),
  });

  const now = new Date();
  for (let i = 0; i < questions.length; i++) {
    const item = readOnly.summaryItems[i];
    if (!item) continue;
    await db
      .update(quizAttemptQuestions)
      .set({
        lmsRecordedAnswer: item.recordedAnswer,
        isVerifiedOnLms: true,
        updatedAt: now,
      })
      .where(eq(quizAttemptQuestions.id, questions[i]!.id));
  }
}

