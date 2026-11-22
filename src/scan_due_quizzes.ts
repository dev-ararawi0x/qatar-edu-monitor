import * as cheerio from "cheerio";
import { LoggedLmsClient } from "./http_logger.js";
import { parseAssignmentsHtml } from "./parsers.js";
import {
  parseInitQuizConfig,
  parseQuizScreen,
  parseQuizShowPage,
} from "./quiz_inspector.js";

interface ExtendedFieldInfo {
  fieldNames: string[];
  hasFileUpload: boolean;
  fileInputNames: string[];
  hasRichTextEditor: boolean;
}

function inspectFormInputs(html: string): ExtendedFieldInfo {
  const $ = cheerio.load(html);
  const form = $("#question_form").first();

  const fieldNames: string[] = [];
  const fileInputNames: string[] = [];

  form.find("input[name], textarea[name], select[name]").each((_, el) => {
    const name = $(el).attr("name");
    const type = ($(el).attr("type") || "").toLowerCase();
    if (!name) return;

    if (!fieldNames.includes(name)) fieldNames.push(name);
    if (type === "file" && !fileInputNames.includes(name)) {
      fileInputNames.push(name);
    }
  });

  const hasFileUpload =
    fileInputNames.length > 0 ||
    form.find("#filecontainer, #filelist, input[type='file'], [id*='upload']")
      .length > 0;

  const hasRichTextEditor =
    form.find("textarea.hasEditor, textarea[name='answer']").length > 0;

  return {
    fieldNames,
    hasFileUpload,
    fileInputNames,
    hasRichTextEditor,
  };
}

async function scanDueQuizzes(options: {
  dueUrl: string;
  /** افتراضياً false: يدخل فقط على المحاولات المفتوحة مسبقاً (استئناف) ولا يبدأ محاولة جديدة تلقائياً */
  autoStartNewAttempts?: boolean;
}) {
  const { dueUrl, autoStartNewAttempts = false } = options;
  const client = new LoggedLmsClient();

  // 1. جلب صفحة التقييمات المستحقة
  const dueRes = await client.request({
    method: "GET",
    pathOrUrl: dueUrl,
  });

  if (dueRes.status !== 200 || dueRes.kind !== "HTML") {
    console.log("[Abort] تعذر قراءة صفحة التقييمات المستحقة.");
    return;
  }

  const dueAssignments = parseAssignmentsHtml(dueRes.body);
  console.log(`[Due Assignments Found]: ${dueAssignments.length}`);
  console.table(dueAssignments);

  for (const item of dueAssignments) {
    console.log(`\n==================================================`);
    console.log(`[Checking Assignment]: ${item.title} (${item.kind})`);
    console.log(`==================================================`);

    if (item.kind !== "quiz") {
      console.log(
        `[Skip] هذا التقييم من نوع "${item.kind}" وليس اختباراً إلكترونياً.`,
      );
      continue;
    }

    // 2. جلب صفحة show الخاصة بالتقييم
    const showRes = await client.request({
      method: "GET",
      pathOrUrl: item.href,
      referer: dueUrl,
    });

    if (showRes.status !== 200 || showRes.kind !== "HTML") {
      console.log(`[Skip] فشل فتح صفحة التقييم: ${item.href}`);
      continue;
    }

    const showInfo = parseQuizShowPage(showRes.body);
    console.log("[Quiz Show Summary]:", {
      title: showInfo.title,
      actionButtonText: showInfo.actionButtonText,
      actionButtonHref: showInfo.actionButtonHref,
      sidebarDetails: showInfo.sidebarDetails,
    });

    if (!showInfo.actionButtonHref) {
      console.log("[Skip] لا يوجد زر بدء أو استئناف متاح لهذا التقييم.");
      continue;
    }

    const isResume =
      showInfo.actionButtonHref.includes("results=") ||
      (showInfo.actionButtonText || "").includes("استئناف");

    if (!isResume && !autoStartNewAttempts) {
      console.log(
        `[Safe Guard] هذا الاختبار لم يبدأ بعد ("${showInfo.actionButtonText}"). تم تخطيه حتى لا تُستهلك محاولة جديدة. لتشغيله مرر --start-new.`,
      );
      continue;
    }

    // 3. فتح الاختبار (GET فقط - سواء استئناف أو start إذا سمح المستخدم)
    let displayRes = await client.request({
      method: "GET",
      pathOrUrl: showInfo.actionButtonHref,
      referer: client.resolveUrl(item.href),
    });

    // إذا أعاد start تحويلاً (302) إلى display نتبعه بـ GET
    if (displayRes.kind === "Redirect" && displayRes.location) {
      displayRes = await client.request({
        method: "GET",
        pathOrUrl: displayRes.location,
        referer: client.resolveUrl(item.href),
      });
    }

    if (displayRes.status !== 200 || displayRes.kind !== "HTML") {
      console.log(`[Skip] تعذر الوصول إلى صفحة عرض الأسئلة.`);
      continue;
    }

    const initConfig = parseInitQuizConfig(displayRes.body);
    console.log("[init_quiz]:", initConfig);

    if (!initConfig?.quizId || !initConfig?.resultsId || !initConfig?.parts) {
      console.log("[Warn] لم يتم العثور على بيانات init_quiz كاملة.");
      continue;
    }

    // 4. المرور على جميع الأجزاء من 1 إلى parts عبر GET فقط
    for (let part = 1; part <= initConfig.parts; part++) {
      const partUrl = `/student_take_quiz_assignment/display/${initConfig.quizId}?part=${part}&results=${initConfig.resultsId}`;
      const partRes =
        part === initConfig.part
          ? displayRes
          : await client.request({
              method: "GET",
              pathOrUrl: partUrl,
              referer: client.resolveUrl(item.href),
            });

      if (partRes.status !== 200 || partRes.kind !== "HTML") {
        console.log(`[Warn] تعذر قراءة الجزء ${part}`);
        continue;
      }

      const screen = parseQuizScreen(partRes.body);
      const extraFields = inspectFormInputs(partRes.body);

      if (screen.stage === "question") {
        console.log(`\n  [Q${part}/${initConfig.parts}] (${screen.points})`);
        console.log(`  - النوع: ${screen.inputType}`);
        console.log(
          `  - يدعم نص محرر: ${extraFields.hasRichTextEditor ? "نعم" : "لا"}`,
        );
        console.log(
          `  - يدعم مرفقات/ملف: ${extraFields.hasFileUpload ? "نعم" : "لا"}`,
        );
        console.log(`  - حقول الفورم: ${extraFields.fieldNames.join(", ")}`);
        console.log(`  - نص السؤال: ${screen.promptText}`);
        if (screen.imageUrls.length > 0) {
          console.log(`  - صور السؤال:`, screen.imageUrls);
        }
        if (screen.choices.length > 0) {
          console.log(`  - الخيارات:`);
          console.table(screen.choices);
        } else {
          console.log(
            `  - الإجابة النصية المحفوظة حالياً: ${screen.currentTextAnswer || "(فارغة)"}`,
          );
        }
      }
    }
  }
}

const dueUrl =
  process.argv[2] ||
  "https://qeducation.edu.gov.qa/student_assignments/due/614062";
const allowStart = process.argv.includes("--start-new");

scanDueQuizzes({
  dueUrl,
  autoStartNewAttempts: allowStart,
});
