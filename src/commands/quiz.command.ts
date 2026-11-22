import path from "node:path";
import { readFile } from "node:fs/promises";
import type {
  CommandContext,
  CommandResult,
  InitQuizConfig,
  ParsedAssignment,
  ParsedQuestionScreen,
  ParsedQuizScreen,
  QuizDraftAttemptResult,
  QuizShowInfo,
  SummaryItem,
} from "../types/index.js";
import { LmsHttpClient } from "../core/http-client.js";
import {
  buildAssignmentsDueUrl,
  buildQuizDisplayUrl,
  buildQuizPauseUrl,
  buildQuizShowUrl,
  extractQuizDisplayId,
  extractQuizIdFromShowUrl,
  extractQueryParam,
  isQuizDisplayUrl,
  isQuizShowUrl,
} from "../core/lms-urls.js";
import { parseAssignmentsHtml } from "../parsers/assignments.parser.js";
import {
  parseInitQuizConfig,
  parseQuizScreen,
  parseQuizShowPage,
} from "../parsers/quiz.parser.js";
import {
  renderQuizDraftMarkdown,
  renderQuizInspectMarkdown,
  renderQuizScanMarkdown,
  type QuizInspectReportInput,
} from "../exporters/quiz.exporter.js";
import { saveMarkdownReport } from "../exporters/markdown-writer.js";

export interface QuizScannedItem {
  assignmentTitle: string;
  assignmentHref: string;
  showInfo?: QuizShowInfo;
  initConfig?: QuizInspectReportInput["initConfig"];
  questions: Array<{
    part: number;
    totalParts: number;
    screen: ParsedQuestionScreen | ParsedQuizScreen;
  }>;
  summaryItems?: SummaryItem[];
  skippedReason?: string;
  traces?: import("../types/index.js").SanitizedHttpTrace[];
}

function sanitizeSlug(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

async function fetchAllQuizPartsReadOnly(
  client: LmsHttpClient,
  quizId: string | number,
  resultsId: string | number,
  referer?: string,
): Promise<{
  initConfig: InitQuizConfig | null;
  questions: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }>;
  summaryItems: SummaryItem[];
  finishAction?: string;
}> {
  const firstUrl = buildQuizDisplayUrl(quizId, 1, resultsId, client.baseUrl);
  const firstRes = await client.request({
    method: "GET",
    pathOrUrl: firstUrl,
    ...(referer ? { referer } : {}),
  });

  if (firstRes.status !== 200 || firstRes.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch initial quiz part. Status: ${firstRes.status} ${firstRes.statusText}`,
    );
  }

  const initConfig = parseInitQuizConfig(firstRes.body);
  const totalParts = initConfig?.parts ?? 1;
  const initialPart = initConfig?.part ?? 1;

  const screens: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }> = [
    {
      part: initialPart,
      totalParts,
      screen: parseQuizScreen(firstRes.body),
    },
  ];

  for (let p = 1; p <= totalParts; p++) {
    if (p === initialPart) continue;
    const partUrl = buildQuizDisplayUrl(quizId, p, resultsId, client.baseUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: partUrl,
      ...(referer ? { referer } : {}),
    });
    if (res.status === 200 && res.kind === "HTML") {
      screens.push({
        part: p,
        totalParts,
        screen: parseQuizScreen(res.body),
      });
    }
  }

  const summaryItems: SummaryItem[] = [];
  let finishAction: string | undefined;
  const questionParts: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }> = [];

  for (const item of screens) {
    if (item.screen.stage === "summary") {
      summaryItems.push(...item.screen.summaryItems);
      if (!finishAction && item.screen.finishAction) {
        finishAction = item.screen.finishAction;
      }
    } else {
      questionParts.push(item);
    }
  }

  return {
    initConfig,
    questions: questionParts,
    summaryItems,
    ...(finishAction ? { finishAction } : {}),
  };
}

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

  let showUrl: string | undefined;
  let displayUrl: string | undefined;
  let quizIdStr: string | undefined;
  let resultsIdStr: string | undefined = optResultsId;
  let showInfo: QuizShowInfo | undefined;
  let initConfig: InitQuizConfig | null = null;
  let questions: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }> = [];
  let summaryItems: SummaryItem[] = [];
  let note: string | undefined;

  if (isQuizDisplayUrl(targetOrUrl)) {
    const resolvedDisplayUrl = client.resolveUrl(targetOrUrl);
    displayUrl = resolvedDisplayUrl;
    quizIdStr = extractQuizDisplayId(resolvedDisplayUrl) ?? undefined;
    resultsIdStr = resultsIdStr || extractQueryParam(resolvedDisplayUrl, "results") || undefined;

    if (!quizIdStr || !resultsIdStr) {
      throw new Error("[Error] Could not extract quiz_id or results_id from display URL.");
    }

    const readOnlyResult = await fetchAllQuizPartsReadOnly(
      client,
      quizIdStr,
      resultsIdStr,
      `${ctx.baseUrl}/user_dashboard`,
    );
    initConfig = readOnlyResult.initConfig;
    questions = readOnlyResult.questions;
    summaryItems = readOnlyResult.summaryItems;
  } else if (isQuizShowUrl(targetOrUrl)) {
    quizIdStr = extractQuizIdFromShowUrl(targetOrUrl) || (/^\d+$/.test(targetOrUrl.trim()) ? targetOrUrl.trim() : undefined);
    if (!quizIdStr) {
      throw new Error("[Error] Invalid quiz show URL or quiz ID.");
    }

    showUrl = buildQuizShowUrl(ctx.baseUrl, quizIdStr);
    const showRes = await client.request({
      method: "GET",
      pathOrUrl: showUrl,
      referer: `${ctx.baseUrl}/user_dashboard`,
    });

    if (showRes.status !== 200 || showRes.kind !== "HTML") {
      throw new Error(
        `[Error] Failed to fetch quiz show page. Status: ${showRes.status} ${showRes.statusText}`,
      );
    }

    showInfo = parseQuizShowPage(showRes.body);

    const actionHref = showInfo.actionButtonHref
      ? client.resolveUrl(showInfo.actionButtonHref)
      : undefined;

    const isResume = showInfo.isResumeAttempt || (actionHref ? actionHref.includes("results=") : false);

    if (isResume && actionHref) {
      displayUrl = actionHref;
      const resQuizId = extractQueryParam(actionHref, "quiz_id") || quizIdStr;
      const resResultsId = extractQueryParam(actionHref, "results");

      if (resResultsId) {
        resultsIdStr = resResultsId;
        const readOnlyResult = await fetchAllQuizPartsReadOnly(
          client,
          resQuizId,
          resResultsId,
          showUrl,
        );
        initConfig = readOnlyResult.initConfig;
        questions = readOnlyResult.questions;
        summaryItems = readOnlyResult.summaryItems;
      }
    } else if (startNew && actionHref) {
      // User opted in to --start-new (still GET only navigation)
      const firstRes = await client.request({
        method: "GET",
        pathOrUrl: actionHref,
        referer: showUrl,
      });

      let finalRes = firstRes;
      if (firstRes.kind === "Redirect" && firstRes.location) {
        finalRes = await client.request({
          method: "GET",
          pathOrUrl: firstRes.location,
          referer: showUrl,
        });
      }

      if (finalRes.status === 200 && finalRes.kind === "HTML") {
        displayUrl = client.resolveUrl(actionHref);
        initConfig = parseInitQuizConfig(finalRes.body);
        const qId = initConfig?.quizId?.toString() || quizIdStr;
        const rId = initConfig?.resultsId?.toString();
        if (qId && rId) {
          resultsIdStr = rId;
          const readOnlyResult = await fetchAllQuizPartsReadOnly(
            client,
            qId,
            rId,
            showUrl,
          );
          initConfig = readOnlyResult.initConfig;
          questions = readOnlyResult.questions;
          summaryItems = readOnlyResult.summaryItems;
        } else {
          const screen = parseQuizScreen(finalRes.body);
          questions = [{ part: 1, totalParts: initConfig?.parts ?? 1, screen }];
        }
      }
    } else {
      note =
        "لم يتم فتح محاولة جديدة لأن الاختبار لم يبدأ بعد ولم يتم تمرير --start-new. هذه مع safe افتراضي (GET فقط).";
    }
  } else {
    // Generic GET URL inspection
    const fullUrl = client.resolveUrl(targetOrUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: targetOrUrl,
      referer: `${ctx.baseUrl}/user_dashboard`,
    });
    displayUrl = fullUrl;
    if (res.status === 200 && res.kind === "HTML") {
      if (res.body.includes("/student_take_quiz_assignment/display/")) {
        const dId = extractQueryParam(fullUrl, "quiz_id") || extractQuizDisplayId(fullUrl);
        const rId = extractQueryParam(fullUrl, "results");
        if (dId && rId) {
          const readOnlyResult = await fetchAllQuizPartsReadOnly(client, dId, rId, fullUrl);
          initConfig = readOnlyResult.initConfig;
          questions = readOnlyResult.questions;
          summaryItems = readOnlyResult.summaryItems;
        }
      } else if (res.body.includes("/student_quiz_assignment/show/")) {
        showInfo = parseQuizShowPage(res.body);
        quizIdStr = extractQuizIdFromShowUrl(fullUrl) ?? undefined;
      }
    }
  }

  if (!ctx.quiet) {
    console.log(`\n[Quiz Inspect] Parsed ${questions.length} question parts.`);
    if (showInfo) {
      console.log(`[Show Page] Title: ${showInfo.title} | Action: ${showInfo.actionButtonText}`);
    }
    if (initConfig) {
      console.log(
        `[init_quiz] quiz_id=${initConfig.quizId}, results_id=${initConfig.resultsId}, parts=${initConfig.parts}, timed=${initConfig.timedQuiz}`,
      );
    }
  }

  const commandFolder = "quiz-inspect";
  const writeReport = ctx.writeReport && !noReport;
  const fileSlug = `quiz-${quizIdStr || "inspect"}`;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderQuizInspectMarkdown({
      targetUrl: targetOrUrl,
      ...(showUrl ? { showUrl } : {}),
      ...(displayUrl ? { displayUrl } : {}),
      ...(quizIdStr ? { quizId: quizIdStr } : {}),
      ...(resultsIdStr ? { resultsId: resultsIdStr } : {}),
      startNewUsed: startNew,
      timestamp: new Date(),
      ...(showInfo ? { showInfo } : {}),
      initConfig,
      questions,
      summaryItems,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
      ...(note ? { note } : {}),
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

  const summaryMessage = `Inspected ${questions.length} quiz question parts read-only.`;

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

  const dueUrl =
    customUrl || buildAssignmentsDueUrl(ctx.baseUrl, effectiveClassId);

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
    console.log(`\n[Quiz Scan] Found ${quizAssignments.length} quiz assignments out of ${dueAssignments.length} due items.`);
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

      const isResume = showInfo.isResumeAttempt;

      if (!isResume && !startNew) {
        scannedItem.skippedReason = `لم يتم فتح محاولة جديدة لحماية رصيد المحاولات (استخدم --start-new للفتح).`;
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

  let answersByPart: Record<number, string> = {};
  if (answersInput) {
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
  }

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
    const existingAnswer =
      existingChoice || questionScreen.currentTextAnswer || "";

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

  // Safe pause if --apply was passed and --no-pause was not set
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
