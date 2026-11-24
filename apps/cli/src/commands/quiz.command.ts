import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CommandContext, CommandResult } from "../types/index.js";
import type {
  LanguagePreference,
  LlmProviderConfig,
  ParsedAssignment,
  QuizDraftAttemptResult,
} from "@qatar-edu/core";
import {
  getDefaultFallbackModels,
  getDefaultModelForProvider,
  normalizeProviderName,
  parseFallbackModelsList,
} from "../config.js";
import { LmsHttpClient } from "@qatar-edu/core";
import {
  buildAssignmentsDueUrl,
  buildQuizPauseUrl,
} from "@qatar-edu/core";
import { parseAssignmentsHtml } from "@qatar-edu/core";
import {
  parseInitQuizConfig,
  parseQuizScreen,
  parseQuizShowPage,
} from "@qatar-edu/core";
import {
  renderQuizDraftMarkdown,
  renderQuizInspectMarkdown,
  renderQuizScanMarkdown,
  renderQuizSolveMarkdown,
  type QuizScannedItem,
} from "../exporters/quiz.exporter.js";
import { saveMarkdownReport } from "../exporters/markdown-writer.js";
import { createLlmProvider } from "@qatar-edu/core";
import { loadPartAttachments } from "@qatar-edu/core";
import {
  fetchAllQuizPartsReadOnly,
  inspectQuizTargetReadOnly,
} from "@qatar-edu/core";
import { runQuizSolverWorkflow } from "@qatar-edu/core";

export type { QuizScannedItem };

export interface QuizInspectCommandOptions {
  targetOrUrl: string;
  resultsId?: string;
  startNew?: boolean;
  noReport?: boolean;
}

export async function runQuizInspectCommand(
  ctx: CommandContext,
  options: QuizInspectCommandOptions,
): Promise<CommandResult> {
  const { targetOrUrl, resultsId: optResultsId, startNew = false, noReport } = options;
  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);

  const inspected = await inspectQuizTargetReadOnly(client, {
    targetOrUrl,
    baseUrl: ctx.baseUrl,
    ...(optResultsId ? { resultsId: optResultsId } : {}),
    startNew,
  });

  if (!ctx.quiet) {
    console.log(`\n[Quiz Inspect] Parsed ${inspected.questions.length} question parts.`);
    if (inspected.showInfo) {
      console.log(
        `[Show Page] Title: ${inspected.showInfo.title} | Action: ${inspected.showInfo.actionButtonText}`,
      );
    }
    if (inspected.initConfig) {
      console.log(
        `[init_quiz] quiz_id=${inspected.initConfig.quizId}, results_id=${inspected.initConfig.resultsId}, parts=${inspected.initConfig.parts}, timed=${inspected.initConfig.timedQuiz}`,
      );
    }
  }

  const commandFolder = "quiz-inspect";
  const writeReport = ctx.writeReport && !noReport;
  const fileSlug = `quiz-${inspected.quizIdStr || "inspect"}`;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderQuizInspectMarkdown({
      targetUrl: targetOrUrl,
      ...(inspected.showUrl ? { showUrl: inspected.showUrl } : {}),
      ...(inspected.displayUrl ? { displayUrl: inspected.displayUrl } : {}),
      ...(inspected.quizIdStr ? { quizId: inspected.quizIdStr } : {}),
      ...(inspected.resultsIdStr ? { resultsId: inspected.resultsIdStr } : {}),
      startNewUsed: startNew,
      timestamp: new Date(),
      ...(inspected.showInfo ? { showInfo: inspected.showInfo } : {}),
      initConfig: inspected.initConfig,
      questions: inspected.questions,
      summaryItems: inspected.summaryItems,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
      ...(inspected.note ? { note: inspected.note } : {}),
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      fileSlug,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const summaryMessage = `Inspected ${inspected.questions.length} quiz question parts read-only.`;

  if (!ctx.quiet) {
    if (reportPath) {
      console.log(`\n[Report Saved] ${reportPath}`);
      if (latestReportPath) {
        console.log(`[Latest Report] ${latestReportPath}`);
      }
    }
    console.log(`[Summary] ${summaryMessage}`);
  }

  return {
    commandFolder,
    ...(reportPath ? { reportPath } : {}),
    ...(latestReportPath ? { latestReportPath } : {}),
    summaryMessage,
  };
}

export interface QuizScanCommandOptions {
  classId?: string;
  url?: string;
  startNew?: boolean;
  noReport?: boolean;
}

export async function runQuizScanCommand(
  ctx: CommandContext,
  options: QuizScanCommandOptions,
): Promise<CommandResult> {
  const { classId, url: customUrl, startNew = false, noReport } = options;
  const effectiveClassId = classId || ctx.defaultClassId;

  if (!customUrl && !effectiveClassId) {
    throw new Error(
      "[Error] Missing class ID. Provide --class-id <id>, set LMS_CLASS_ID in .env, or pass --url <fullUrl>.",
    );
  }

  const dueUrl = customUrl || buildAssignmentsDueUrl(ctx.baseUrl, effectiveClassId);
  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);

  const dueRes = await client.request({
    method: "GET",
    pathOrUrl: dueUrl,
    referer: `${ctx.baseUrl}/user_dashboard`,
  });

  if (dueRes.status !== 200 || dueRes.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch due assignments page. Status: ${dueRes.status} ${dueRes.statusText}`,
    );
  }

  const dueAssignments: ParsedAssignment[] = parseAssignmentsHtml(dueRes.body);
  const quizAssignments = dueAssignments.filter((a) => a.kind === "quiz");
  const scannedQuizzes: QuizScannedItem[] = [];

  if (!ctx.quiet) {
    console.log(
      `\n[Quiz Scan] Found ${quizAssignments.length} quiz assignments out of ${dueAssignments.length} due items.`,
    );
  }

  for (const item of quizAssignments) {
    const scannedItem: QuizScannedItem = {
      assignmentTitle: item.title,
      assignmentHref: item.href,
      questions: [],
      traces: [],
    };

    const traceCountBefore = client.traces.length;

    try {
      const showRes = await client.request({
        method: "GET",
        pathOrUrl: item.href,
        referer: dueUrl,
      });

      if (showRes.status !== 200 || showRes.kind !== "HTML") {
        scannedItem.skippedReason = `فشل فتح صفحة التقييم (Status: ${showRes.status})`;
        scannedQuizzes.push(scannedItem);
        continue;
      }

      const showInfo = parseQuizShowPage(showRes.body);
      scannedItem.showInfo = showInfo;

      if (!showInfo.actionButtonHref) {
        scannedItem.skippedReason = "لا يوجد زر بدء أو استئناف متاح لهذا التقييم.";
        scannedQuizzes.push(scannedItem);
        continue;
      }

      if (!showInfo.isResumeAttempt && !startNew) {
        scannedItem.skippedReason =
          "لم يتم فتح محاولة جديدة لحماية رصيد المحاولات (استخدم --start-new للفتح).";
        scannedQuizzes.push(scannedItem);
        continue;
      }

      const actionFullUrl = client.resolveUrl(showInfo.actionButtonHref);
      let displayRes = await client.request({
        method: "GET",
        pathOrUrl: actionFullUrl,
        referer: client.resolveUrl(item.href),
      });

      if (displayRes.kind === "Redirect" && displayRes.location) {
        displayRes = await client.request({
          method: "GET",
          pathOrUrl: displayRes.location,
          referer: client.resolveUrl(item.href),
        });
      }

      if (displayRes.status !== 200 || displayRes.kind !== "HTML") {
        scannedItem.skippedReason = "تعذر الوصول إلى صفحة عرض الأسئلة.";
        scannedQuizzes.push(scannedItem);
        continue;
      }

      const initConfig = parseInitQuizConfig(displayRes.body);
      scannedItem.initConfig = initConfig;

      const qId = initConfig?.quizId?.toString();
      const rId = initConfig?.resultsId?.toString();

      if (!qId || !rId || !initConfig?.parts) {
        scannedItem.skippedReason = "بيانات init_quiz غير مكتملة.";
        scannedQuizzes.push(scannedItem);
        continue;
      }

      const readOnlyResult = await fetchAllQuizPartsReadOnly(
        client,
        qId,
        rId,
        client.resolveUrl(item.href),
      );

      scannedItem.questions = readOnlyResult.questions;
      scannedItem.summaryItems = readOnlyResult.summaryItems;
      scannedItem.traces = client.traces.slice(traceCountBefore);

      if (!ctx.quiet) {
        console.log(
          `[Scanned Quiz] "${item.title}": ${readOnlyResult.questions.length} question parts parsed.`,
        );
      }
    } catch (err) {
      scannedItem.skippedReason = `خطأ أثناء الفحص: ${err instanceof Error ? err.message : String(err)}`;
    }

    scannedQuizzes.push(scannedItem);
  }

  const commandFolder = "quiz-scan";
  const writeReport = ctx.writeReport && !noReport;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderQuizScanMarkdown({
      targetUrl: dueUrl,
      startNewUsed: startNew,
      timestamp: new Date(),
      dueAssignments,
      scannedQuizzes,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const inspectedCount = scannedQuizzes.filter((q) => q.questions.length > 0).length;
  const summaryMessage = `Scanned ${quizAssignments.length} quizzes (${inspectedCount} inspected, ${scannedQuizzes.length - inspectedCount} skipped/protected).`;

  if (!ctx.quiet) {
    if (reportPath) {
      console.log(`\n[Report Saved] ${reportPath}`);
      if (latestReportPath) {
        console.log(`[Latest Report] ${latestReportPath}`);
      }
    }
    console.log(`[Summary] ${summaryMessage}`);
  }

  return {
    commandFolder,
    ...(reportPath ? { reportPath } : {}),
    ...(latestReportPath ? { latestReportPath } : {}),
    summaryMessage,
  };
}

async function parseDraftAnswersMap(answersInput?: string): Promise<Record<number, string>> {
  const answersByPart: Record<number, string> = {};
  if (!answersInput) return answersByPart;

  let rawJson = answersInput.trim();
  if (rawJson.startsWith("@")) {
    const filePath = path.resolve(rawJson.slice(1));
    rawJson = await readFile(filePath, "utf8");
  } else if (!rawJson.startsWith("{") && !rawJson.startsWith("[")) {
    const filePath = path.resolve(rawJson);
    try {
      rawJson = await readFile(filePath, "utf8");
    } catch {
      // treat as inline if not file
    }
  }

  const parsed = JSON.parse(rawJson) as Record<string, string>;
  for (const [k, v] of Object.entries(parsed)) {
    const partNum = Number(k);
    if (!Number.isNaN(partNum)) {
      answersByPart[partNum] = String(v);
    }
  }
  return answersByPart;
}

export interface QuizDraftCommandOptions {
  displayUrl: string;
  answers?: string;
  apply?: boolean;
  noPause?: boolean;
  allowTimed?: boolean;
  noReport?: boolean;
}

export async function runQuizDraftCommand(
  ctx: CommandContext,
  options: QuizDraftCommandOptions,
): Promise<CommandResult> {
  const {
    displayUrl: rawDisplayUrl,
    answers: answersInput,
    apply = false,
    noPause = false,
    allowTimed = false,
    noReport,
  } = options;

  const dryRun = !apply;
  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);
  const displayUrl = client.resolveUrl(rawDisplayUrl);
  const answersByPart = await parseDraftAnswersMap(answersInput);

  const initialRes = await client.request({
    method: "GET",
    pathOrUrl: displayUrl,
    referer: `${ctx.baseUrl}/user_dashboard`,
  });

  if (initialRes.status !== 200 || initialRes.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch quiz display page. Status: ${initialRes.status} ${initialRes.statusText}`,
    );
  }

  const initConfig = parseInitQuizConfig(initialRes.body);
  if (!initConfig?.quizId || !initConfig?.resultsId) {
    throw new Error("[Error] Could not parse quiz_id and results_id from init_quiz config.");
  }

  if (initConfig.timedQuiz && !allowTimed) {
    throw new Error(
      "[Safety Stop] Timed quiz detected (timed_quiz: true). Aborting to protect attempt timer. Pass --allow-timed to override.",
    );
  }

  const quizId = initConfig.quizId;
  const resultsId = initConfig.resultsId;
  const totalParts = initConfig.parts ?? 50;

  const result: QuizDraftAttemptResult = {
    dryRun,
    quizId,
    resultsId,
    totalParts,
    pausedSafely: false,
    reachedSummary: false,
    steps: [],
    questions: [],
  };

  let currentScreen = parseQuizScreen(initialRes.body);
  let currentPart = initConfig.part ?? 1;
  let latestToken: string | null = null;

  for (let guard = 0; guard <= totalParts + 1; guard++) {
    if (currentScreen.stage === "summary") {
      result.reachedSummary = true;
      result.summaryItems = currentScreen.summaryItems;
      if (!ctx.quiet) {
        console.log("\n[Reached End-of-Quiz Summary Screen - /finish BLOCKED]");
      }
      break;
    }

    const questionScreen = currentScreen;
    result.questions.push({
      part: currentPart,
      totalParts,
      screen: questionScreen,
    });

    latestToken = questionScreen.hiddenFields["authenticity_token"] || null;

    const existingChoice = questionScreen.choices.find((c) => c.checked)?.value ?? "";
    const existingAnswer = existingChoice || questionScreen.currentTextAnswer || "";
    const answerToSend = answersByPart[currentPart] ?? existingAnswer;

    const payload: Record<string, string> = {
      ...questionScreen.hiddenFields,
      destination: "next",
      answer: answerToSend,
    };

    const isMultipart = questionScreen.enctype
      .toLowerCase()
      .includes("multipart/form-data");

    if (dryRun) {
      result.steps.push({
        part: currentPart,
        questionHeader: questionScreen.questionHeader,
        sentAnswer: answerToSend,
        action: questionScreen.action,
      });

      if (!ctx.quiet) {
        console.log(
          `[DRY RUN Part ${currentPart}] Would POST to ${questionScreen.action} with answer: "${answerToSend || "(current)"}"`,
        );
      }
      break;
    }

    const postRes = await client.request({
      method: "POST",
      pathOrUrl: questionScreen.action,
      referer: displayUrl,
      isAjax: true,
      ...(latestToken ? { csrfHeaderToken: latestToken } : {}),
      formFields: payload,
      asMultipart: isMultipart,
    });

    result.steps.push({
      part: currentPart,
      questionHeader: questionScreen.questionHeader,
      sentAnswer: answerToSend,
      action: questionScreen.action,
      status: postRes.status,
    });

    if (postRes.status !== 200) {
      if (!ctx.quiet) {
        console.log(`[Stop] Unexpected status code: ${postRes.status}`);
      }
      break;
    }

    currentScreen = parseQuizScreen(postRes.body);
    currentPart += 1;
  }

  if (!dryRun && !noPause) {
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
    if (!ctx.quiet) {
      console.log("[Paused Safely] Quiz attempt paused via /pause/ without submitting /finish/.");
    }
  }

  const commandFolder = "quiz-draft";
  const writeReport = ctx.writeReport && !noReport;
  const fileSlug = `quiz-${quizId}-draft`;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderQuizDraftMarkdown({
      displayUrl,
      dryRun,
      pausedSafely: result.pausedSafely,
      timestamp: new Date(),
      result,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
      answersByPart,
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      fileSlug,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const summaryMessage = dryRun
    ? "Quiz draft dry-run preview completed (0 POST requests sent)."
    : `Quiz draft saved for ${result.steps.length} parts and paused safely.`;

  if (!ctx.quiet) {
    if (reportPath) {
      console.log(`\n[Report Saved] ${reportPath}`);
      if (latestReportPath) {
        console.log(`[Latest Report] ${latestReportPath}`);
      }
    }
    console.log(`[Summary] ${summaryMessage}`);
  }

  return {
    commandFolder,
    ...(reportPath ? { reportPath } : {}),
    ...(latestReportPath ? { latestReportPath } : {}),
    summaryMessage,
  };
}

export interface QuizSolveCommandOptions {
  targetOrUrl: string;
  provider?: string;
  model?: string;
  fallbackModels?: string;
  lang?: LanguagePreference;
  subject?: string;
  attachments?: string[];
  startNew?: boolean;
  allowTimed?: boolean;
  apply?: boolean;
  submit?: boolean;
  noPause?: boolean;
  noReport?: boolean;
}

export async function runQuizSolveCommand(
  ctx: CommandContext,
  options: QuizSolveCommandOptions,
): Promise<CommandResult> {
  const {
    targetOrUrl,
    provider: optProvider,
    model: optModel,
    fallbackModels: optFallbackModels,
    lang = "auto",
    subject,
    attachments = [],
    startNew = false,
    allowTimed = false,
    apply = false,
    submit = false,
    noPause = false,
    noReport = false,
  } = options;

  const baseLlm: LlmProviderConfig = ctx.llm ?? {
    provider: "gemini",
    model: getDefaultModelForProvider("gemini"),
    apiKey: "VALUES",
  };
  const resolvedProvider = optProvider
    ? normalizeProviderName(optProvider)
    : baseLlm.provider;
  const resolvedModel =
    optModel ||
    (resolvedProvider !== baseLlm.provider
      ? getDefaultModelForProvider(resolvedProvider)
      : baseLlm.model);

  const resolvedFallbacks =
    parseFallbackModelsList(optFallbackModels) ??
    (resolvedProvider !== baseLlm.provider || resolvedModel !== baseLlm.model
      ? getDefaultFallbackModels(resolvedProvider, resolvedModel)
      : baseLlm.fallbackModels);

  const llmConfig: LlmProviderConfig = {
    provider: resolvedProvider,
    model: resolvedModel,
    apiKey: baseLlm.apiKey,
    quiet: ctx.quiet,
    ...(baseLlm.baseUrl ? { baseUrl: baseLlm.baseUrl } : {}),
    ...(resolvedFallbacks && resolvedFallbacks.length > 0
      ? { fallbackModels: resolvedFallbacks }
      : {}),
  };

  const llmProvider = createLlmProvider(llmConfig);
  const attachmentsByPart =
    attachments.length > 0 ? await loadPartAttachments(attachments) : undefined;

  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);

  const { displayUrl, showUrl, result } = await runQuizSolverWorkflow(client, {
    targetOrUrl,
    baseUrl: ctx.baseUrl,
    llmProvider,
    languagePreference: lang,
    ...(subject ? { subjectHint: subject } : {}),
    ...(attachmentsByPart ? { attachmentsByPart } : {}),
    startNew,
    allowTimed,
    apply,
    submit,
    noPause,
    quiet: ctx.quiet,
  });

  const commandFolder = "quiz-solve";
  const writeReport = ctx.writeReport && !noReport;
  const fileSlug = `quiz-${result.quizId}-solve`;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderQuizSolveMarkdown({
      targetUrl: targetOrUrl,
      displayUrl,
      ...(showUrl ? { showUrl } : {}),
      timestamp: new Date(),
      result,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      fileSlug,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const summaryMessage = result.dryRun
    ? `LLM dry-run solved ${result.steps.length}/${result.totalParts} parts using ${result.provider}:${result.model} (0 POST requests sent).`
    : `LLM solved and saved ${result.steps.length}/${result.totalParts} parts using ${result.provider}:${result.model} (summaryVerified=${result.summaryVerified}, paused=${result.pausedSafely}).`;

  if (!ctx.quiet) {
    if (reportPath) {
      console.log(`\n[Report Saved] ${reportPath}`);
      if (latestReportPath) {
        console.log(`[Latest Report] ${latestReportPath}`);
      }
    }
    console.log(`[Summary] ${summaryMessage}`);
  }

  return {
    commandFolder,
    ...(reportPath ? { reportPath } : {}),
    ...(latestReportPath ? { latestReportPath } : {}),
    summaryMessage,
  };
}
