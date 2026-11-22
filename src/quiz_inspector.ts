import * as cheerio from "cheerio";
import { LoggedLmsClient } from "./http_logger.js";

export interface QuizShowInfo {
  title: string;
  csrfToken: string | null;
  actionButtonText: string | null;
  actionButtonHref: string | null;
  sidebarDetails: string[];
}

export interface InitQuizConfig {
  quizId: number | null;
  resultsId: number | null;
  part: number | null;
  parts: number | null;
  timedQuiz: boolean;
  timeLeft: number | null;
  resumeRefresh: boolean;
}

export interface QuestionChoice {
  value: string;
  label: string;
  checked: boolean;
}

export interface ParsedQuestionScreen {
  stage: "question";
  questionHeader: string;
  points: string;
  action: string;
  enctype: string;
  hiddenFields: Record<string, string>;
  promptText: string;
  imageUrls: string[];
  inputType: "single_choice" | "multiple_choice" | "free_text" | "unknown";
  choices: QuestionChoice[];
  currentTextAnswer: string;
  formFieldNames: string[];
}

export interface ParsedSummaryScreen {
  stage: "summary";
  finishAction: string;
  authenticityToken: string | null;
  summaryItems: Array<{
    questionTitle: string;
    promptPreview: string;
    recordedAnswer: string;
  }>;
}

export type ParsedQuizScreen = ParsedQuestionScreen | ParsedSummaryScreen;

export function parseQuizShowPage(html: string): QuizShowInfo {
  const $ = cheerio.load(html);

  const title =
    $("#fixedSectionHeader h2, .section_header_wrap h2")
      .first()
      .text()
      .trim() || $("title").text().trim();

  const csrfToken =
    $('meta[name="csrf-token"]').attr("content")?.trim() || null;

  const actionLink = $(
    '#mainContent a[href*="/student_take_quiz_assignment/"]',
  ).first();
  const actionButtonText =
    actionLink.text().replace(/\s+/g, " ").trim() || null;
  const actionButtonHref = actionLink.attr("href")?.trim() || null;

  const sidebarDetails: string[] = [];
  $("aside.rightColumn .block li, aside.rightColumn .block p").each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (txt && !txt.includes("نشر")) {
      sidebarDetails.push(txt);
    }
  });

  return {
    title,
    csrfToken,
    actionButtonText,
    actionButtonHref,
    sidebarDetails,
  };
}

export function parseInitQuizConfig(html: string): InitQuizConfig | null {
  const match = html.match(/init_quiz\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!match?.[1]) return null;

  const block = match[1];
  const readNum = (key: string): number | null => {
    const m = block.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
    return m?.[1] ? Number(m[1]) : null;
  };
  const readBool = (key: string): boolean => {
    const m = block.match(new RegExp(`${key}\\s*:\\s*(true|false)`));
    return m?.[1] === "true";
  };

  return {
    quizId: readNum("quiz_id"),
    resultsId: readNum("results_id"),
    part: readNum("part"),
    parts: readNum("parts"),
    timedQuiz: readBool("timed_quiz"),
    timeLeft: readNum("time_left"),
    resumeRefresh: readBool("resume_refresh"),
  };
}

export function parseQuizScreen(htmlOrFragment: string): ParsedQuizScreen {
  const $ = cheerio.load(htmlOrFragment);

  const finishForm = $(
    'form[action*="/student_take_quiz_assignment/finish/"]',
  ).first();
  const headingText = $("h2.quiz_question")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  if (finishForm.length > 0 || headingText.includes("نهاية الاختبار")) {
    const finishAction = finishForm.attr("action") || "";
    const authenticityToken =
      finishForm.find('input[name="authenticity_token"]').attr("value") || null;

    const summaryItems: ParsedSummaryScreen["summaryItems"] = [];
    $(".materialStyle").each((_, el) => {
      const qTitle = $(el)
        .find("h2")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      if (!qTitle) return;

      const paragraphs = $(el).find("p");
      const answerP = paragraphs
        .filter((_, p) => $(p).text().includes("الإجابة"))
        .first();
      const recordedAnswer = answerP.text().replace(/\s+/g, " ").trim();

      const fullText = $(el).text().replace(/\s+/g, " ").trim();
      const promptPreview = fullText
        .replace(qTitle, "")
        .replace(recordedAnswer, "")
        .trim()
        .slice(0, 120);

      summaryItems.push({
        questionTitle: qTitle,
        promptPreview,
        recordedAnswer: recordedAnswer || "(غير محدد)",
      });
    });
    

    return {
      stage: "summary",
      finishAction,
      authenticityToken,
      summaryItems,
    };
  }

  const form = $("#question_form").first();
  const action = form.attr("action") || "";
  const enctype = form.attr("enctype") || "application/x-www-form-urlencoded";

  const hiddenFields: Record<string, string> = {};
  form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    hiddenFields[name] = $(el).attr("value") ?? "";
  });

  const points = $(".quiz_points").first().text().replace(/\s+/g, " ").trim();
  const promptContainer = form.find(".materialStyle").first();
  const promptText = promptContainer.text().replace(/\s+/g, " ").trim();

  const imageUrls: string[] = [];
  promptContainer.find("img").each((_, img) => {
    const src = $(img).attr("src");
    if (src) imageUrls.push(src);
  });

  const radios = form.find('input[type="radio"][name="answer"]');
  const checkboxes = form.find('input[type="checkbox"]');
  const textArea = form.find('textarea[name="answer"]').first();
  const textInput = form.find('input[type="text"][name="answer"]').first();

  let inputType: ParsedQuestionScreen["inputType"] = "unknown";
  const choices: QuestionChoice[] = [];
  let currentTextAnswer = "";

  if (radios.length > 0) {
    inputType = "single_choice";
    radios.each((_, r) => {
      const id = $(r).attr("id");
      const value = $(r).attr("value") || "";
      const checked = $(r).is(":checked");
      const label = id
        ? form.find(`label[for="${id}"]`).text().replace(/\s+/g, " ").trim()
        : "";
      choices.push({ value, label, checked });
    });
  } else if (checkboxes.length > 0) {
    inputType = "multiple_choice";
    checkboxes.each((_, cb) => {
      const id = $(cb).attr("id");
      const value = $(cb).attr("value") || "";
      const checked = $(cb).is(":checked");
      const label = id
        ? form.find(`label[for="${id}"]`).text().replace(/\s+/g, " ").trim()
        : "";
      choices.push({ value, label, checked });
    });
  } else if (textArea.length > 0 || textInput.length > 0) {
    inputType = "free_text";
    currentTextAnswer =
      (textArea.val() as string) || textInput.attr("value") || "";
  }

  const formFieldNames: string[] = [];
  form.find("input[name], textarea[name], select[name]").each((_, el) => {
    const n = $(el).attr("name");
    if (n && !formFieldNames.includes(n)) formFieldNames.push(n);
  });

  return {
    stage: "question",
    questionHeader: headingText,
    points,
    action,
    enctype,
    hiddenFields,
    promptText,
    imageUrls,
    inputType,
    choices,
    currentTextAnswer,
    formFieldNames,
  };
}

export interface DraftFillOptions {
  client: LoggedLmsClient;
  displayUrl: string;
  /** خريطة الإجابات حسب رقم السؤال (part): مثلاً { 1: "1", 2: "2", 4: "نص الحل" } */
  answersByPart: Record<number, string>;
  /** افتراضياً true: يعاين الأسئلة ويطبع ما سيُرسل دون تنفيذ أي POST */
  dryRun?: boolean;
  /** إرسال طلب pause في النهاية ليبقى الاختبار قابلاً للاستئناف من المتصفح */
  pauseAfter?: boolean;
  /** حماية افتراضية تمنع التشغيل التلقائي إذا كان الاختبار محدداً بوقت */
  allowTimedQuiz?: boolean;
}

export async function inspectAndSaveDraftsWithoutFinish(
  options: DraftFillOptions,
) {
  const {
    client,
    displayUrl,
    answersByPart,
    dryRun = true,
    pauseAfter = true,
    allowTimedQuiz = false,
  } = options;

  const initialRes = await client.request({
    method: "GET",
    pathOrUrl: displayUrl,
  });

  if (initialRes.status !== 200 || initialRes.kind !== "HTML") {
    console.log(
      "[Abort] لم ترجع صفحة العرض HTML بحالة 200. تحقق من الجلسة أو الرابط.",
    );
    return;
  }

  const initConfig = parseInitQuizConfig(initialRes.body);
  console.log("[Parsed init_quiz]:", initConfig);

  if (initConfig?.timedQuiz && !allowTimedQuiz) {
    console.log(
      "[Safety Stop] هذا الاختبار محدد بوقت (timed_quiz: true). تم الإيقاف لحماية محاولتك.",
    );
    return;
  }

  let currentScreen = parseQuizScreen(initialRes.body);
  let currentPart = initConfig?.part ?? 1;
  const maxParts = initConfig?.parts ?? 50;
  let latestToken: string | null = null;

  for (let guard = 0; guard <= maxParts + 1; guard++) {
    if (currentScreen.stage === "summary") {
      latestToken = currentScreen.authenticityToken;
      console.log("\n[Reached End-of-Quiz Summary Screen]");
      console.log(
        `[Finish Form Action (NOT SUBMITTED)] ${currentScreen.finishAction}`,
      );
      console.table(currentScreen.summaryItems);
      break;
    }

    latestToken = currentScreen.hiddenFields["authenticity_token"] || null;

    console.log(
      `\n--- ${currentScreen.questionHeader} (${currentScreen.points}) ---`,
    );
    console.log(`[Type]   ${currentScreen.inputType}`);
    console.log(`[Prompt] ${currentScreen.promptText}`);
    console.log(`[Fields] ${currentScreen.formFieldNames.join(", ")}`);
    if (currentScreen.imageUrls.length > 0) {
      console.log(`[Images]`, currentScreen.imageUrls);
    }
    if (currentScreen.choices.length > 0) {
      console.table(currentScreen.choices);
    }

    const existingChoice =
      currentScreen.choices.find((c) => c.checked)?.value ?? "";
    const existingAnswer =
      existingChoice || currentScreen.currentTextAnswer || "";

    const answerToSend = answersByPart[currentPart] ?? existingAnswer;
      
    const payload: Record<string, string> = {
      ...currentScreen.hiddenFields,
      destination: "next",
      answer: answerToSend,
    };

    const isMultipart = currentScreen.enctype
      .toLowerCase()
      .includes("multipart/form-data");

    if (dryRun) {
      console.log(
        `[DRY RUN] لن يتم إرسال POST. البيانات التي ستُرسل لجزء ${currentPart}:`,
      );
      console.log({
        action: currentScreen.action,
        encoding: isMultipart ? "multipart/form-data" : "urlencoded",
        destination: payload.destination,
        answer: payload.answer,
        authenticity_token: "VALUES",
      });
      // في وضع dryRun نتوقف عند أول صفحة معروضة لأننا لم ننتقل فعلياً للسؤال التالي
      break;
    }

    const postRes = await client.request({
      method: "POST",
      pathOrUrl: currentScreen.action,
      referer: client.resolveUrl(displayUrl),
      isAjax: true,
      csrfHeaderToken: latestToken || undefined,
      formFields: payload,
      asMultipart: isMultipart,
    });

    if (postRes.status !== 200) {
      console.log(`[Stop] السيرفر أعاد حالة غير متوقعة: ${postRes.status}`);
      break;
    }

    currentScreen = parseQuizScreen(postRes.body);
    currentPart += 1;
  }

  // إيقاف مؤقت نظيف دون تسليم نهائي (finish)
  if (!dryRun && pauseAfter && initConfig?.quizId && initConfig?.resultsId) {
    const pausePath = `/student_take_quiz_assignment/pause/${initConfig.quizId}?results=${initConfig.resultsId}`;
    await client.request({
      method: "POST",
      pathOrUrl: pausePath,
      referer: client.resolveUrl(displayUrl),
      isAjax: true,
      csrfHeaderToken: latestToken || undefined,
      formFields: {
        utf8: "✓",
        ...(latestToken ? { authenticity_token: latestToken } : {}),
      },
    });
    console.log(
      "[Paused Safely] تم إيقاف الاختبار مؤقتاً دون تسليم (/finish لم يُستدعَ). يمكنك فتح المنصة والضغط على 'استئناف'.",
    );
  }
}

export async function fetchAllPartsReadOnly(
  client: LoggedLmsClient,
  quizId: number,
  resultsId: number,
) {
  const firstUrl = `/student_take_quiz_assignment/display/${quizId}?part=1&results=${resultsId}`;
  const firstRes = await client.request({ method: "GET", pathOrUrl: firstUrl });

  if (firstRes.status !== 200 || firstRes.kind !== "HTML") {
    console.log("[Abort] تعذر جلب السؤال الأول.");
    return;
  }

  const config = parseInitQuizConfig(firstRes.body);
  const totalParts = config?.parts ?? 1;
  console.log("[Parsed init_quiz]:", config);

  const screens = [parseQuizScreen(firstRes.body)];

  for (let p = 2; p <= totalParts; p++) {
    const partUrl = `/student_take_quiz_assignment/display/${quizId}?part=${p}&results=${resultsId}`;
    const res = await client.request({ method: "GET", pathOrUrl: partUrl });
    if (res.status === 200 && res.kind === "HTML") {
      screens.push(parseQuizScreen(res.body));
    }
  }

  for (const screen of screens) {
    if (screen.stage !== "question") continue;
    console.log(`\n=== ${screen.questionHeader} (${screen.points}) ===`);
    console.log(`[Action]   ${screen.action}`);
    console.log(`[Encoding] ${screen.enctype}`);
    console.log(`[Type]     ${screen.inputType}`);
    console.log(`[Prompt]   ${screen.promptText}`);
    if (screen.imageUrls.length > 0) {
      console.log(`[Images]  `, screen.imageUrls);
    }
    if (screen.choices.length > 0) {
      console.table(screen.choices);
    } else if (screen.currentTextAnswer) {
      console.log(`[Saved Text]:`, screen.currentTextAnswer);
    }
  }
}

async function main() {
  const client = new LoggedLmsClient();
  const targetUrl = process.argv[2];

  if (!targetUrl) {
    console.log("الاستخدام:");
    console.log(
      '  npx tsx src/quiz_inspector.ts "https://qeducation.edu.gov.qa/student_quiz_assignment/show/15479350"',
    );
    console.log(
      '  npx tsx src/quiz_inspector.ts "https://qeducation.edu.gov.qa/student_take_quiz_assignment/display/15479350?part=1&results=116574853"',
    );
    return;
  }

  if (targetUrl.includes("/student_quiz_assignment/show/")) {
    const res = await client.request({
      method: "GET",
      pathOrUrl: targetUrl,
    });
    if (res.status === 200 && res.kind === "HTML") {
      const info = parseQuizShowPage(res.body);
      console.log("[Parsed Quiz Show Page]:", {
        ...info,
        csrfToken: info.csrfToken ? "VALUES" : null,
      });
    }
    return;
  }

  if (targetUrl.includes("/student_take_quiz_assignment/display/")) {
    await inspectAndSaveDraftsWithoutFinish({
      client,
      displayUrl: targetUrl,
      answersByPart: {
        // ضع هنا رقم السؤال والإجابة عند الرغبة في التجربة الفعلية
      },
      dryRun: true, // اتركها true للمعاينة الآمنة، أو غيّرها إلى false لحفظ المسودات + pause فقط
      pauseAfter: true,
    });
    return;
  }

  // لأي رابط GET آخر
  await client.request({
    method: "GET",
    pathOrUrl: targetUrl,
  });
}

main();
