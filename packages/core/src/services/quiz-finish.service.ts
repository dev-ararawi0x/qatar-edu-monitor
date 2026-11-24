import type {
  HttpFormFieldValue,
  ParsedSummaryScreen,
} from "../types/index.js";
import type { LmsHttpClient } from "../core/http-client.js";
import { ALLOW_EXPLICIT_HUMAN_FINISH } from "../core/finish-capability.js";
import {
  buildQuizDisplayUrl,
  buildQuizPauseUrl,
} from "../core/lms-urls.js";
import {
  parseQuizScreen,
} from "../parsers/quiz.parser.js";
import { fetchAllQuizPartsReadOnly } from "./quiz-inspector.service.js";
import { verifySummaryScreenCompleteness } from "./quiz-solver.service.js";

export interface OverrideQuizPartAnswerOptions {
  quizId: string | number;
  resultsId: string | number;
  part: number;
  /**
   * Answer field values to submit for this part, e.g. `{ answer: "3" }`,
   * `{ "answer[1]": "x", "answer[2]": "y" }`, or `{ "answer[]": ["2","5"] }`.
   * Keys must match real answer input names on the question screen.
   */
  fields: Record<string, HttpFormFieldValue>;
  referer?: string;
}

export interface OverrideQuizPartAnswerResult {
  part: number;
  status: number;
  statusText: string;
  nextScreenStage: "question" | "summary" | "unknown";
  elapsedMs: number;
}

/**
 * Re-saves a SINGLE question part on the LMS with user-edited answer values,
 * then re-fetches the summary screen state. The attempt stays paused /
 * resumable — this service NEVER touches /finish/.
 */
export async function overrideQuizPartAnswer(
  client: LmsHttpClient,
  options: OverrideQuizPartAnswerOptions,
): Promise<OverrideQuizPartAnswerResult> {
  const { quizId, resultsId, part, fields, referer } = options;

  const partUrl = buildQuizDisplayUrl(quizId, part, resultsId, client.baseUrl);
  const getRes = await client.request({
    method: "GET",
    pathOrUrl: partUrl,
    ...(referer ? { referer } : {}),
  });

  if (getRes.status !== 200 || getRes.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch quiz part ${part} for editing. Status: ${getRes.status} ${getRes.statusText}`,
    );
  }

  const screen = parseQuizScreen(getRes.body);
  if (screen.stage !== "question") {
    throw new Error(
      `[Error] Quiz part ${part} did not render a question screen (stage=${screen.stage}).`,
    );
  }

  const authenticityToken =
    screen.hiddenFields["authenticity_token"] ?? null;

  const formFields: Record<string, HttpFormFieldValue> = {
    ...screen.hiddenFields,
    destination: "next",
    ...fields,
  };

  const postRes = await client.request({
    method: "POST",
    pathOrUrl: screen.action,
    referer: partUrl,
    isAjax: true,
    ...(authenticityToken ? { csrfHeaderToken: authenticityToken } : {}),
    formFields,
    asMultipart: screen.enctype
      .toLowerCase()
      .includes("multipart/form-data"),
  });

  const nextScreen = parseQuizScreen(postRes.body);
  const nextScreenStage: OverrideQuizPartAnswerResult["nextScreenStage"] =
    nextScreen.stage === "summary"
      ? "summary"
      : nextScreen.stage === "question"
        ? "question"
        : "unknown";

  return {
    part,
    status: postRes.status,
    statusText: postRes.statusText,
    nextScreenStage,
    elapsedMs: postRes.elapsedMs,
  };
}

export interface SubmitQuizFinishOptions {
  quizId: string | number;
  resultsId: string | number;
  /** Expected number of question parts for summary completeness check. */
  expectedParts?: number;
  /**
   * When true, submits /finish/ even if summary verification reports
   * warnings. Defaults to false (strict).
   */
  allowUnverified?: boolean;
  referer?: string;
}

export interface SubmitQuizFinishResult {
  submitted: boolean;
  status: number;
  statusText: string;
  verified: boolean;
  warnings: string[];
  summaryItemCount: number;
}

/**
 * THE ONLY code path in the entire codebase allowed to POST to
 * /student_take_quiz_assignment/finish/. Callers (API routes) MUST require
 * explicit human confirmation before invoking this.
 *
 * Flow: re-reads all quiz parts read-only -> locates the summary screen's
 * finish form (action + authenticity_token) -> verifies summary completeness
 * -> POSTs the finish form once using the private capability symbol.
 */
export async function submitQuizFinishExplicitly(
  client: LmsHttpClient,
  options: SubmitQuizFinishOptions,
): Promise<SubmitQuizFinishResult> {
  const { quizId, resultsId, expectedParts, allowUnverified = false } =
    options;

  const readOnly = await fetchAllQuizPartsReadOnly(
    client,
    quizId,
    resultsId,
    options.referer ?? `${client.baseUrl}/user_dashboard`,
  );

  const totalParts =
    expectedParts ??
    readOnly.initConfig?.parts ??
    readOnly.questions.length;

  let summaryItems = readOnly.summaryItems;
  let finishAction = readOnly.finishAction;
  let authToken = readOnly.summaryAuthToken;

  // If the summary screen was not captured during part scanning, probe the
  // part index just past the last question (the LMS renders the summary
  // screen there once all answers are saved).
  if (!finishAction || summaryItems.length === 0) {
    const probed = await probeSummaryScreen(
      client,
      quizId,
      resultsId,
      totalParts,
      options.referer,
    );
    if (probed) {
      if (summaryItems.length === 0) summaryItems = probed.summaryItems;
      finishAction = finishAction ?? probed.finishAction;
      authToken = authToken ?? probed.authenticityToken ?? undefined;
    }
  }

  if (!finishAction) {
    throw new Error(
      "[Error] Could not locate the quiz summary/finish screen. The attempt may not be fully answered yet.",
    );
  }

  const verification = verifySummaryScreenCompleteness(
    summaryItems,
    totalParts,
  );

  if (!verification.verified && !allowUnverified) {
    throw new Error(
      `[Safety Check] Quiz summary is not fully verified: ${verification.warnings.join(" | ")}. Fix the flagged answers or pass allowUnverified explicitly.`,
    );
  }

  const res = await client.request({
    method: "POST",
    pathOrUrl: finishAction,
    referer:
      options.referer ??
      buildQuizDisplayUrl(quizId, 1, resultsId, client.baseUrl),
    isAjax: true,
    ...(authToken ? { csrfHeaderToken: authToken } : {}),
    formFields: {
      utf8: "✓",
      ...(authToken ? { authenticity_token: authToken } : {}),
    },
    [ALLOW_EXPLICIT_HUMAN_FINISH]: true,
  });

  return {
    submitted: res.status >= 200 && res.status < 400,
    status: res.status,
    statusText: res.statusText,
    verified: verification.verified,
    warnings: verification.warnings,
    summaryItemCount: summaryItems.length,
  };
}

async function probeSummaryScreen(
  client: LmsHttpClient,
  quizId: string | number,
  resultsId: string | number,
  totalParts: number,
  referer?: string,
): Promise<ParsedSummaryScreen | null> {
  // Try part indexes beyond/at the last question part; the LMS renders the
  // end-of-quiz summary screen for out-of-range or final parts.
  const candidates = Array.from(
    new Set([totalParts + 1, totalParts, totalParts + 2]),
  );

  for (const part of candidates) {
    try {
      const res = await client.request({
        method: "GET",
        pathOrUrl: buildQuizDisplayUrl(
          quizId,
          part,
          resultsId,
          client.baseUrl,
        ),
        ...(referer ? { referer } : {}),
      });
      if (res.status !== 200 || res.kind !== "HTML") continue;
      const screen = parseQuizScreen(res.body);
      if (screen.stage === "summary" && screen.finishAction) {
        return screen;
      }
    } catch {
      // ignore probe failures and try next candidate
    }
  }
  return null;
}

/**
 * Pauses an in-progress quiz attempt safely. Convenience wrapper used by API
 * services after manual edits or cancellations.
 */
export async function pauseQuizAttempt(
  client: LmsHttpClient,
  options: {
    quizId: string | number;
    resultsId: string | number;
    authenticityToken?: string | null;
    referer?: string;
  },
): Promise<void> {
  const pausePath = buildQuizPauseUrl(
    options.quizId,
    options.resultsId,
    client.baseUrl,
  );
  await client.request({
    method: "POST",
    pathOrUrl: pausePath,
    referer:
      options.referer ??
      `${client.baseUrl}/user_dashboard`,
    isAjax: true,
    ...(options.authenticityToken
      ? { csrfHeaderToken: options.authenticityToken }
      : {}),
    formFields: {
      utf8: "✓",
      ...(options.authenticityToken
        ? { authenticity_token: options.authenticityToken }
        : {}),
    },
  });
}
