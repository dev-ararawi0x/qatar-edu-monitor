import type {
  InitQuizConfig,
  ParsedQuizScreen,
  QuizShowInfo,
  SummaryItem,
} from "../types/index.js";
import type { LmsHttpClient } from "../core/http-client.js";
import {
  buildQuizDisplayUrl,
  buildQuizShowUrl,
  extractQueryParam,
  extractQuizDisplayId,
  extractQuizIdFromShowUrl,
  isQuizDisplayUrl,
  isQuizShowUrl,
} from "../core/lms-urls.js";
import {
  parseInitQuizConfig,
  parseQuizScreen,
  parseQuizShowPage,
} from "../parsers/quiz.parser.js";

export interface ReadOnlyQuizPartsResult {
  initConfig: InitQuizConfig | null;
  questions: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }>;
  summaryItems: SummaryItem[];
  finishAction?: string;
  summaryAuthToken?: string;
}

export async function fetchAllQuizPartsReadOnly(
  client: LmsHttpClient,
  quizId: string | number,
  resultsId: string | number,
  referer?: string,
): Promise<ReadOnlyQuizPartsResult> {
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

  screens.sort((a, b) => a.part - b.part);

  const summaryItems: SummaryItem[] = [];
  let finishAction: string | undefined;
  let summaryAuthToken: string | undefined;
  const questionParts: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }> = [];

  for (const item of screens) {
    if (item.screen.stage === "summary") {
      summaryItems.push(...item.screen.summaryItems);
      if (!finishAction && item.screen.finishAction) {
        finishAction = item.screen.finishAction;
      }
      if (!summaryAuthToken && item.screen.authenticityToken) {
        summaryAuthToken = item.screen.authenticityToken;
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
    ...(summaryAuthToken ? { summaryAuthToken } : {}),
  };
}

export interface InspectQuizTargetOptions {
  targetOrUrl: string;
  baseUrl: string;
  resultsId?: string;
  startNew?: boolean;
}

export interface InspectedQuizTargetResult {
  showUrl?: string;
  displayUrl?: string;
  quizIdStr?: string;
  resultsIdStr?: string;
  showInfo?: QuizShowInfo;
  initConfig: InitQuizConfig | null;
  questions: Array<{ part: number; totalParts: number; screen: ParsedQuizScreen }>;
  summaryItems: SummaryItem[];
  note?: string;
}

export async function inspectQuizTargetReadOnly(
  client: LmsHttpClient,
  options: InspectQuizTargetOptions,
): Promise<InspectedQuizTargetResult> {
  const { targetOrUrl, baseUrl, resultsId: optResultsId, startNew = false } = options;

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
      `${baseUrl}/user_dashboard`,
    );
    initConfig = readOnlyResult.initConfig;
    questions = readOnlyResult.questions;
    summaryItems = readOnlyResult.summaryItems;
  } else if (isQuizShowUrl(targetOrUrl)) {
    quizIdStr =
      extractQuizIdFromShowUrl(targetOrUrl) ||
      (/^\d+$/.test(targetOrUrl.trim()) ? targetOrUrl.trim() : undefined);
    if (!quizIdStr) {
      throw new Error("[Error] Invalid quiz show URL or quiz ID.");
    }

    showUrl = buildQuizShowUrl(baseUrl, quizIdStr);
    const showRes = await client.request({
      method: "GET",
      pathOrUrl: showUrl,
      referer: `${baseUrl}/user_dashboard`,
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

    const isResume =
      showInfo.isResumeAttempt || (actionHref ? actionHref.includes("results=") : false);

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
        displayUrl =
          firstRes.kind === "Redirect" && firstRes.location
            ? client.resolveUrl(firstRes.location)
            : client.resolveUrl(actionHref);
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
    const fullUrl = client.resolveUrl(targetOrUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: targetOrUrl,
      referer: `${baseUrl}/user_dashboard`,
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

  return {
    ...(showUrl ? { showUrl } : {}),
    ...(displayUrl ? { displayUrl } : {}),
    ...(quizIdStr ? { quizIdStr } : {}),
    ...(resultsIdStr ? { resultsIdStr } : {}),
    ...(showInfo ? { showInfo } : {}),
    initConfig,
    questions,
    summaryItems,
    ...(note ? { note } : {}),
  };
}

export interface ResolvedQuizEntry {
  displayUrl: string;
  showUrl?: string;
  showInfo?: QuizShowInfo;
  initialBody: string;
  initConfig: InitQuizConfig;
}

/**
 * Resolves a quiz ID, show URL, or display URL to an active quiz display HTML page,
 * enforcing `--start-new` before opening unstarted attempts.
 */
export async function resolveActiveQuizEntry(
  client: LmsHttpClient,
  options: {
    targetOrUrl: string;
    baseUrl: string;
    startNew?: boolean;
  },
): Promise<ResolvedQuizEntry> {
  const { targetOrUrl, baseUrl, startNew = false } = options;

  let displayUrl: string;
  let showUrl: string | undefined;
  let showInfo: QuizShowInfo | undefined;
  let initialBody: string;

  if (isQuizDisplayUrl(targetOrUrl)) {
    displayUrl = client.resolveUrl(targetOrUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: displayUrl,
      referer: `${baseUrl}/user_dashboard`,
    });
    if (res.status !== 200 || res.kind !== "HTML") {
      throw new Error(
        `[Error] Failed to fetch quiz display page. Status: ${res.status} ${res.statusText}`,
      );
    }
    initialBody = res.body;
  } else if (isQuizShowUrl(targetOrUrl)) {
    const quizIdStr =
      extractQuizIdFromShowUrl(targetOrUrl) ||
      (/^\d+$/.test(targetOrUrl.trim()) ? targetOrUrl.trim() : undefined);
    if (!quizIdStr) {
      throw new Error("[Error] Invalid quiz show URL or quiz ID.");
    }

    showUrl = buildQuizShowUrl(baseUrl, quizIdStr);
    const showRes = await client.request({
      method: "GET",
      pathOrUrl: showUrl,
      referer: `${baseUrl}/user_dashboard`,
    });
    if (showRes.status !== 200 || showRes.kind !== "HTML") {
      throw new Error(
        `[Error] Failed to fetch quiz show page. Status: ${showRes.status} ${showRes.statusText}`,
      );
    }

    showInfo = parseQuizShowPage(showRes.body);
    if (!showInfo.actionButtonHref) {
      throw new Error("[Error] Quiz show page has no start or resume button.");
    }

    const actionHref = client.resolveUrl(showInfo.actionButtonHref);
    const isResume = showInfo.isResumeAttempt || actionHref.includes("results=");

    if (!isResume && !startNew) {
      throw new Error(
        "[Safety Stop] Quiz attempt has not been started yet. Pass --start-new explicitly to open a new attempt.",
      );
    }

    let entryRes = await client.request({
      method: "GET",
      pathOrUrl: actionHref,
      referer: showUrl,
    });
    displayUrl = actionHref;

    if (entryRes.kind === "Redirect" && entryRes.location) {
      displayUrl = client.resolveUrl(entryRes.location);
      entryRes = await client.request({
        method: "GET",
        pathOrUrl: displayUrl,
        referer: showUrl,
      });
    }

    if (entryRes.status !== 200 || entryRes.kind !== "HTML") {
      throw new Error(
        `[Error] Failed to open quiz display screen. Status: ${entryRes.status} ${entryRes.statusText}`,
      );
    }
    initialBody = entryRes.body;
  } else {
    displayUrl = client.resolveUrl(targetOrUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: displayUrl,
      referer: `${baseUrl}/user_dashboard`,
    });
    if (res.status !== 200 || res.kind !== "HTML") {
      throw new Error(
        `[Error] Failed to fetch quiz page. Status: ${res.status} ${res.statusText}`,
      );
    }
    initialBody = res.body;
  }

  const initConfig = parseInitQuizConfig(initialBody);
  if (!initConfig?.quizId || !initConfig?.resultsId) {
    throw new Error("[Error] Could not parse quiz_id and results_id from init_quiz config.");
  }

  return {
    displayUrl,
    ...(showUrl ? { showUrl } : {}),
    ...(showInfo ? { showInfo } : {}),
    initialBody,
    initConfig,
  };
}
