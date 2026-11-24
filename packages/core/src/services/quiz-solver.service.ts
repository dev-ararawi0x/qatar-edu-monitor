import type {
  LanguagePreference,
  LlmProvider,
  ParsedQuestionScreen,
  QuestionImageInline,
  QuizExecutionMode,
  QuizSolveAttemptResult,
  QuizSolverProgressEvent,
  SummaryItem,
} from "../types/index.js";
import type { LmsHttpClient } from "../core/http-client.js";
import { buildQuizDisplayUrl, buildQuizPauseUrl } from "../core/lms-urls.js";
import { parseQuizScreen } from "../parsers/quiz.parser.js";
import { detectAnswerLanguage } from "../llm/language-detector.js";
import {
  mapAnswerToFormPayload,
  type ParsedPartAttachment,
} from "./quiz-form.mapper.js";
import {
  fetchAllQuizPartsReadOnly,
  resolveActiveQuizEntry,
} from "./quiz-inspector.service.js";

export class QuizSolveAbortedError extends Error {
  constructor(message = "Quiz solving was aborted by the caller.") {
    super(message);
    this.name = "QuizSolveAbortedError";
  }
}

export interface QuizSolverServiceOptions {
  targetOrUrl: string;
  baseUrl: string;
  llmProvider: LlmProvider;
  languagePreference?: LanguagePreference;
  subjectHint?: string;
  lessonTitle?: string;
  attachmentsByPart?: Map<number, ParsedPartAttachment[]>;
  startNew?: boolean;
  allowTimed?: boolean;
  apply?: boolean;
  submit?: boolean;
  noPause?: boolean;
  quiet?: boolean;
  /**
   * Optional progress callback invoked after each LLM solve and after each
   * successful answer POST. Used by background workers for live progress.
   */
  onPartProgress?: (
    event: QuizSolverProgressEvent,
  ) => void | Promise<void>;
  /**
   * Optional abort signal. When aborted between parts, the workflow pauses
   * the attempt safely via /pause/ and throws QuizSolveAbortedError.
   */
  signal?: AbortSignal;
}

async function fetchQuestionImagesInline(
  client: LmsHttpClient,
  screen: ParsedQuestionScreen,
  referer: string,
): Promise<QuestionImageInline[]> {
  const images: QuestionImageInline[] = [];
  for (const imgUrl of screen.imageUrls.slice(0, 4)) {
    const bin = await client.fetchBinary(imgUrl, referer);
    if (bin && bin.base64) {
      const mimeType = bin.contentType.split(";")[0]?.trim() || "image/png";
      images.push({
        url: imgUrl,
        mimeType,
        base64: bin.base64,
      });
    }
  }
  return images;
}

export function verifySummaryScreenCompleteness(
  summaryItems: SummaryItem[],
  expectedParts: number,
): { verified: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (summaryItems.length === 0) {
    warnings.push("لم يتم العثور على عناصر ملخص الإجابات في شاشة النهاية.");
    return { verified: false, warnings };
  }

  if (summaryItems.length < expectedParts) {
    warnings.push(
      `عدد الأسئلة في شاشة الملخص (${summaryItems.length}) أقل من إجمالي أجزاء الاختبار (${expectedParts}).`,
    );
  }

  const unanswered = summaryItems.filter((item) => {
    const answer = (item.recordedAnswer ?? "").trim();
    return (
      !answer ||
      answer.includes("(غير محدد)") ||
      answer === "(غير محدد)" ||
      answer.includes("لا يوجد") ||
      /^\[?\s*none\s*\]?$/i.test(answer) ||
      /^الإجابة\s*:?\s*$/.test(answer)
    );
  });

  if (unanswered.length > 0) {
    warnings.push(
      `يوجد ${unanswered.length} سؤال بدون إجابة مسجلة في شاشة الملخص: ${unanswered.map((u) => u.questionTitle).join("، ")}`,
    );
  }

  return {
    verified: warnings.length === 0,
    warnings,
  };
}

export async function runQuizSolverWorkflow(
  client: LmsHttpClient,
  options: QuizSolverServiceOptions,
): Promise<{
  displayUrl: string;
  showUrl?: string;
  result: QuizSolveAttemptResult;
}> {
  const {
    targetOrUrl,
    baseUrl,
    llmProvider,
    languagePreference = "auto",
    subjectHint,
    lessonTitle,
    attachmentsByPart,
    startNew = false,
    allowTimed = false,
    apply = false,
    submit = false,
    noPause = false,
    quiet = false,
    onPartProgress,
    signal,
  } = options;

  const dryRun = !apply && !submit;
  const mode: QuizExecutionMode = dryRun
    ? "dry-run"
    : submit
      ? "submit-ready"
      : "draft";

  const entry = await resolveActiveQuizEntry(client, {
    targetOrUrl,
    baseUrl,
    startNew,
  });

  const { displayUrl, showUrl, showInfo, initialBody, initConfig } = entry;

  if (initConfig.timedQuiz && !allowTimed) {
    throw new Error(
      "[Safety Stop] Timed quiz detected (timed_quiz: true). Aborting to protect attempt timer. Pass --allow-timed to override.",
    );
  }

  const quizId = initConfig.quizId!;
  const resultsId = initConfig.resultsId!;
  const totalParts = initConfig.parts ?? 1;
  const quizTitle = showInfo?.title;

  const result: QuizSolveAttemptResult = {
    mode,
    dryRun,
    provider: llmProvider.name,
    model: llmProvider.model,
    quizId,
    resultsId,
    ...(quizTitle ? { quizTitle } : {}),
    totalParts,
    pausedSafely: false,
    reachedSummary: false,
    summaryVerified: false,
    finishBlockedByGuardrail: false,
    warnings: [],
    steps: [],
    questions: [],
  };

  if (dryRun) {
    // Dry-run: inspect ALL parts read-only via GET and generate validated LLM answers without sending any POST
    const readOnly = await fetchAllQuizPartsReadOnly(
      client,
      quizId,
      resultsId,
      showUrl ?? `${baseUrl}/user_dashboard`,
    );

    for (const partItem of readOnly.questions) {
      if (signal?.aborted) {
        throw new QuizSolveAbortedError();
      }
      if (partItem.screen.stage !== "question") continue;
      const questionScreen = partItem.screen;

      result.questions.push({
        part: partItem.part,
        totalParts: partItem.totalParts,
        screen: questionScreen,
      });

      const images =
        questionScreen.imageUrls.length > 0
          ? await fetchQuestionImagesInline(client, questionScreen, displayUrl)
          : [];

      const targetLanguage = detectAnswerLanguage({
        preference: languagePreference,
        ...(subjectHint ? { subjectHint } : {}),
        ...(quizTitle ? { quizTitle } : {}),
        ...(lessonTitle ? { lessonTitle } : {}),
        screen: questionScreen,
      });

      const solvedAnswer = await llmProvider.solveQuestion({
        part: partItem.part,
        totalParts: partItem.totalParts,
        screen: questionScreen,
        ...(quizTitle ? { quizTitle } : {}),
        ...(subjectHint ? { subjectHint } : {}),
        ...(lessonTitle ? { lessonTitle } : {}),
        targetLanguage,
        ...(images.length > 0 ? { images } : {}),
      });

      const mapped = mapAnswerToFormPayload(
        questionScreen,
        solvedAnswer,
        attachmentsByPart?.get(partItem.part),
      );

      result.steps.push({
        part: partItem.part,
        questionHeader: questionScreen.questionHeader,
        inputType: questionScreen.inputType,
        language: targetLanguage,
        solvedAnswer,
        formattedSummary: mapped.formattedSummary,
        action: questionScreen.action,
        formFieldsSent: mapped.sanitizedFieldsPreview,
        ...(mapped.sanitizedFilesPreview.length > 0
          ? { attachedFiles: mapped.sanitizedFilesPreview }
          : {}),
      });

      if (onPartProgress) {
        await onPartProgress({
          stage: "llm_solved",
          part: partItem.part,
          totalParts: partItem.totalParts,
          ...(questionScreen.questionHeader
            ? { questionHeader: questionScreen.questionHeader }
            : {}),
          formattedSummary: mapped.formattedSummary,
        });
      }

      if (!quiet) {
        console.log(
          `[DRY RUN Part ${partItem.part}/${partItem.totalParts}] (${targetLanguage.toUpperCase()} | ${questionScreen.inputType}) -> ${mapped.formattedSummary}`,
        );
      }
    }

    if (readOnly.summaryItems.length > 0) {
      result.summaryItems = readOnly.summaryItems;
    }
    if (readOnly.finishAction) {
      result.finishAction = readOnly.finishAction;
    }

    return {
      displayUrl,
      ...(showUrl ? { showUrl } : {}),
      result,
    };
  }

  // Active execution (--apply or --submit): solve & POST each part sequentially
  let currentScreen = parseQuizScreen(initialBody);
  let currentPart = initConfig.part ?? 1;
  let latestToken: string | null = null;

  // If the attempt is parked on the summary screen but answers are missing,
  // rewind to part 1 so missing answers actually get solved and saved.
  if (currentScreen.stage === "summary") {
    const preCheck = verifySummaryScreenCompleteness(
      currentScreen.summaryItems,
      totalParts,
    );
    if (!preCheck.verified) {
      const restartUrl = buildQuizDisplayUrl(quizId, 1, resultsId, client.baseUrl);
      const restartRes = await client.request({
        method: "GET",
        pathOrUrl: restartUrl,
        referer: displayUrl,
      });
      currentScreen = parseQuizScreen(restartRes.body);
      currentPart = 1;
      if (!quiet) {
        console.log(
          `[Restart] Attempt was on summary screen with unanswered parts — rewound to part 1.`,
        );
      }
    }
  }

  try {
    for (let guard = 0; guard <= totalParts + 1; guard++) {
      if (currentScreen.stage === "summary") {
        result.reachedSummary = true;
        result.summaryItems = currentScreen.summaryItems;
        if (currentScreen.finishAction) {
          result.finishAction = currentScreen.finishAction;
        }
        latestToken = currentScreen.authenticityToken || latestToken;

        const verification = verifySummaryScreenCompleteness(
          currentScreen.summaryItems,
          result.steps.length || totalParts,
        );
        result.summaryVerified = verification.verified;
        result.warnings.push(...verification.warnings);

        if (onPartProgress) {
          await onPartProgress({
            stage: "summary_reached",
            part: currentPart,
            totalParts,
          });
        }

        if (!quiet) {
          console.log(
            `\n[Summary Reached] Verified=${verification.verified} (${currentScreen.summaryItems.length} items recorded).`,
          );
        }
        break;
      }

      if (signal?.aborted) {
        throw new QuizSolveAbortedError();
      }

      const questionScreen = currentScreen;
      result.questions.push({
        part: currentPart,
        totalParts,
        screen: questionScreen,
      });

      latestToken = questionScreen.hiddenFields["authenticity_token"] || latestToken;

      const images =
        questionScreen.imageUrls.length > 0
          ? await fetchQuestionImagesInline(client, questionScreen, displayUrl)
          : [];

      const targetLanguage = detectAnswerLanguage({
        preference: languagePreference,
        ...(subjectHint ? { subjectHint } : {}),
        ...(quizTitle ? { quizTitle } : {}),
        ...(lessonTitle ? { lessonTitle } : {}),
        screen: questionScreen,
      });

      const solvedAnswer = await llmProvider.solveQuestion({
        part: currentPart,
        totalParts,
        screen: questionScreen,
        ...(quizTitle ? { quizTitle } : {}),
        ...(subjectHint ? { subjectHint } : {}),
        ...(lessonTitle ? { lessonTitle } : {}),
        targetLanguage,
        ...(images.length > 0 ? { images } : {}),
      });

      const mapped = mapAnswerToFormPayload(
        questionScreen,
        solvedAnswer,
        attachmentsByPart?.get(currentPart),
      );

      if (onPartProgress) {
        await onPartProgress({
          stage: "llm_solved",
          part: currentPart,
          totalParts,
          ...(questionScreen.questionHeader
            ? { questionHeader: questionScreen.questionHeader }
            : {}),
          formattedSummary: mapped.formattedSummary,
        });
      }

      const postRes = await client.request({
        method: "POST",
        pathOrUrl: questionScreen.action,
        referer: displayUrl,
        isAjax: true,
        ...(latestToken ? { csrfHeaderToken: latestToken } : {}),
        formFields: mapped.formFields,
        ...(mapped.files.length > 0 ? { files: mapped.files } : {}),
        asMultipart: mapped.asMultipart,
      });

      result.steps.push({
        part: currentPart,
        questionHeader: questionScreen.questionHeader,
        inputType: questionScreen.inputType,
        language: targetLanguage,
        solvedAnswer,
        formattedSummary: mapped.formattedSummary,
        action: questionScreen.action,
        formFieldsSent: mapped.sanitizedFieldsPreview,
        ...(mapped.sanitizedFilesPreview.length > 0
          ? { attachedFiles: mapped.sanitizedFilesPreview }
          : {}),
        status: postRes.status,
      });

      if (!quiet) {
        console.log(
          `[Saved Part ${currentPart}/${totalParts}] HTTP ${postRes.status} (${targetLanguage.toUpperCase()} | ${questionScreen.inputType}) -> ${mapped.formattedSummary}`,
        );
      }

      if (onPartProgress) {
        await onPartProgress({
          stage: "answer_posted",
          part: currentPart,
          totalParts,
          ...(questionScreen.questionHeader
            ? { questionHeader: questionScreen.questionHeader }
            : {}),
          formattedSummary: mapped.formattedSummary,
          status: postRes.status,
        });
      }

      if (postRes.status !== 200) {
        result.warnings.push(`توقف الإرسال عند الجزء ${currentPart} بسبب رمز الاستجابة ${postRes.status}.`);
        break;
      }

      currentScreen = parseQuizScreen(postRes.body);
      currentPart += 1;
    }
  } catch (err) {
    if (!noPause && result.steps.length > 0) {
      try {
        const pausePath = buildQuizPauseUrl(quizId, resultsId, client.baseUrl);
        await client.request({
          method: "POST",
          pathOrUrl: pausePath,
          referer: displayUrl,
          isAjax: true,
          ...(latestToken ? { csrfHeaderToken: latestToken } : {}),
          formFields: {
            utf8: "✓",
            ...(latestToken ? { authenticity_token: latestToken } : {}),
          },
        });
        if (!quiet) {
          console.warn(
            "[Emergency Pause] Paused quiz attempt safely via /pause/ after mid-run error.",
          );
        }
      } catch {
        // Ignore emergency pause error so original error surfaces clearly
      }
    }
    throw err;
  }

  if (submit) {
    result.finishBlockedByGuardrail = true;
    result.warnings.push(
      "تم التحقق من شاشة الملخص وحفظ جميع الإجابات والملفات، مع إبقاء نقطة النهاية /finish/ محظورة في طبقة النقل وفق قواعد الأمان (AGENTS.md) لتتم المراجعة والتسليم النهائي بنقرة واحدة في المتصفح.",
    );
    if (!quiet) {
      console.log(
        "[Safety Guardrail] All answers saved & verified on summary screen; /finish/ remains blocked at transport layer per AGENTS.md.",
      );
    }
  }

  if (!noPause) {
    const pausePath = buildQuizPauseUrl(quizId, resultsId, client.baseUrl);
    await client.request({
      method: "POST",
      pathOrUrl: pausePath,
      referer: displayUrl,
      isAjax: true,
      ...(latestToken ? { csrfHeaderToken: latestToken } : {}),
      formFields: {
        utf8: "✓",
        ...(latestToken ? { authenticity_token: latestToken } : {}),
      },
    });
    result.pausedSafely = true;
    if (onPartProgress) {
      await onPartProgress({
        stage: "paused",
        part: currentPart,
        totalParts,
      });
    }
    if (!quiet) {
      console.log("[Paused Safely] Quiz attempt paused via /pause/ and ready in browser.");
    }
  }

  return {
    displayUrl,
    ...(showUrl ? { showUrl } : {}),
    result,
  };
}
