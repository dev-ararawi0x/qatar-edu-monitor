import type {
  ParsedAssignment,
  ParsedQuestionScreen,
  ParsedQuizScreen,
  QuizPartQuestion,
  QuizShowInfo,
  QuizDraftAttemptResult,
  QuizSolveAttemptResult,
  SummaryItem,
  SanitizedHttpTrace,
} from "@qatar-edu/core";
import { maskIfSensitiveKey, sanitizeText } from "@qatar-edu/core";
import {
  buildMarkdownTable,
  buildMetadataTable,
  buildSectionHeading,
  escapeMarkdownCell,
  formatIsoTimestamp,
} from "./markdown-helpers.js";

export function getQuestionTypeLabelAr(screen: ParsedQuestionScreen): string {
  switch (screen.inputType) {
    case "single_choice":
      return "اختيار من متعدد - إجابة واحدة";
    case "multiple_choice":
      return "اختيار من متعدد - عدة إجابات";
    case "free_text":
      return "إجابة نصية حرة";
    case "structured_input":
      return "حقول إدخال منظمة / فراغات / قوائم منسدلة";
    case "file_upload":
      return "رفع ملفات مرفقة";
    default:
      return "نوع غير محدد";
  }
}

export function renderQuestionCardMarkdown(
  item: QuizPartQuestion | { part: number; totalParts?: number; screen: ParsedQuizScreen },
  titlePrefix?: string,
): string[] {
  const { part, totalParts, screen } = item;
  const lines: string[] = [];

  if (screen.stage === "summary") {
    lines.push(
      buildSectionHeading(
        3,
        `${titlePrefix ? `${titlePrefix} - ` : ""}شاشة الملخص النهائية (لم يتم التسليم) - الجزء ${part}`,
      ),
    );
    lines.push("");
    lines.push(
      buildMetadataTable([
        {
          label: "رابط نموذج التسليم (للعرض فقط - محظور إرسال /finish)",
          value: screen.finishAction || "—",
        },
        {
          label: "رمز الحماية (authenticity_token)",
          value: screen.authenticityToken ? "VALUES" : "غير موجود",
        },
        { label: "عدد ملخصات الإجابات", value: screen.summaryItems.length },
      ]),
    );
    lines.push("");

    if (screen.summaryItems.length > 0) {
      const rows = screen.summaryItems.map((s: SummaryItem) => [
        s.questionTitle,
        s.promptPreview,
        s.recordedAnswer,
      ]);
      lines.push(
        buildMarkdownTable(
          ["عنوان السؤال", "نظرة عامة على نص السؤال", "الإجابة المسجلة"],
          rows,
        ),
      );
      lines.push("");
    }
    return lines;
  }

  const totalLabel = totalParts ? ` من ${totalParts}` : "";
  const headerTitle = titlePrefix
    ? `${titlePrefix} - ${screen.questionHeader || `السؤال ${part}`}`
    : `${screen.questionHeader || `السؤال ${part}`} (الجزء ${part}${totalLabel})`;

  lines.push(buildSectionHeading(3, headerTitle));
  lines.push("");

  lines.push(
    buildMetadataTable([
      { label: "نص السؤال / المطالبة", value: screen.promptText || "—" },
      { label: "الدرجة / النقاط", value: screen.points || "غير محدد" },
      { label: "نوع السؤال", value: getQuestionTypeLabelAr(screen) },
      {
        label: "نمط التشفير (enctype)",
        value: screen.enctype.includes("multipart")
          ? "multipart/form-data"
          : "application/x-www-form-urlencoded",
      },
      { label: "دعم الإدخال النصي العادي", value: screen.hasPlainTextInput ? "نعم" : "لا" },
      {
        label: "دعم المحرر النصي المنسق (Rich Text)",
        value: screen.hasRichTextEditor ? "نعم" : "لا",
      },
      { label: "دعم إرفاق / رفع الملفات", value: screen.hasFileUpload ? "نعم" : "لا" },
      ...(screen.fileInputNames.length > 0
        ? [{ label: "أسماء حقول رفع الملفات", value: screen.fileInputNames.join(", ") }]
        : []),
      { label: "رابط الإجراء (Action URL)", value: screen.action || "—" },
      ...(screen.imageUrls.length > 0
        ? [{ label: "روابط الصور المرفقة بالسؤال", value: screen.imageUrls.join("\n") }]
        : []),
    ]),
  );
  lines.push("");

  if (screen.choices.length > 0) {
    lines.push(buildSectionHeading(4, "الخيارات المتاحة والإجابة المحددة حالياً"));
    lines.push("");
    const choiceRows = screen.choices.map((c, idx) => [
      `الخيار ${idx + 1}`,
      c.label || c.value,
      c.value,
      c.checked ? "نعم (محدد)" : "لا",
    ]);
    lines.push(
      buildMarkdownTable(
        ["الترتيب", "نص الخيار", "القيمة (Value)", "محدد حالياً؟"],
        choiceRows,
      ),
    );
    lines.push("");
  }

  if (screen.currentTextAnswer || Object.keys(screen.structuredAnswers).length > 0) {
    lines.push(buildSectionHeading(4, "الإجابة النصية / الحقول الحالية"));
    lines.push("");
    const answerEntries: Array<{
      label: string;
      value: string | number | boolean | undefined | null;
    }> = [];

    if (screen.currentTextAnswer) {
      answerEntries.push({
        label: "الإجابة النصية الحالية (answer)",
        value: screen.currentTextAnswer,
      });
    }

    for (const [key, val] of Object.entries(screen.structuredAnswers)) {
      const valStr = Array.isArray(val) ? val.join(" | ") : val;
      answerEntries.push({
        label: `الحقل (${key})`,
        value: valStr || "(فارغ)",
      });
    }

    lines.push(
      buildMarkdownTable(
        ["اسم الحقل / نوع الإجابة", "المحتوى الحالي"],
        answerEntries.map((e) => [e.label, e.value ?? "—"]),
      ),
    );
    lines.push("");
  }

  if (screen.fieldDetails.length > 0) {
    lines.push(buildSectionHeading(4, "تفاصيل حقول الإدخال في النموذج"));
    lines.push("");
    const fieldRows = screen.fieldDetails.map((f) => [
      f.name,
      f.tagName,
      f.type,
      f.checked ? "محدد" : "—",
      f.value
        ? escapeMarkdownCell(sanitizeText(maskIfSensitiveKey(f.name, f.value)))
        : "—",
      f.options && f.options.length > 0
        ? f.options.map((opt) => escapeMarkdownCell(sanitizeText(opt))).join("، ")
        : "—",
    ]);
    lines.push(
      buildMarkdownTable(
        [
          "اسم الحقل (name)",
          "الوسم",
          "النوع",
          "محدد؟",
          "القيمة الافتراضية",
          "الخيارات (للقوائم المنسدلة)",
        ],
        fieldRows,
      ),
    );
    lines.push("");
  }

  return lines;
}

export interface QuizInspectReportInput {
  targetUrl: string;
  showUrl?: string;
  displayUrl?: string;
  quizId?: string;
  resultsId?: string;
  startNewUsed: boolean;
  timestamp: Date;
  showInfo?: QuizShowInfo;
  initConfig?: {
    quizId: number | null;
    resultsId: number | null;
    part: number | null;
    parts: number | null;
    timedQuiz: boolean;
    timeLeft: number | null;
    resumeRefresh: boolean;
  } | null;
  questions: Array<{
    part: number;
    totalParts: number;
    screen: ParsedQuestionScreen | ParsedQuizScreen;
  }>;
  summaryItems?: SummaryItem[];
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
  note?: string;
}

export function renderQuizInspectMarkdown(input: QuizInspectReportInput): string {
  const {
    targetUrl,
    showUrl,
    displayUrl,
    quizId,
    resultsId,
    startNewUsed,
    timestamp,
    showInfo,
    initConfig,
    questions,
    summaryItems = [],
    traces = [],
    hasSession,
    note,
  } = input;

  const lines: string[] = [];
  lines.push(buildSectionHeading(1, "تقرير فحص اختبار إلكتروني (Quiz Inspect - للقراءة فقط GET)"));
  lines.push("");

  lines.push(
    buildMetadataTable([
      { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
      { label: "الرابط / المعرف المدخل", value: targetUrl },
      ...(showUrl ? [{ label: "رابط صفحة عرض الاختبار (Show)", value: showUrl }] : []),
      ...(displayUrl ? [{ label: "رابط صفحة الأسئلة (Display)", value: displayUrl }] : []),
      ...(quizId ? [{ label: "معرف الاختبار (quiz_id)", value: quizId }] : []),
      ...(resultsId ? [{ label: "معرف المحاولة (results_id)", value: resultsId }] : []),
      {
        label: "وضع الأمان",
        value:
          "قراءة فقط (GET فقط - لا يتم إرسال أي POST ولا بدء محاولة جديدة إلا بـ --start-new)",
      },
      { label: "استخدام --start-new", value: startNewUsed ? "نعم" : "لا (افتراضي آمن)" },
      {
        label: "حالة الجلسة",
        value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)",
      },
      { label: "عدد الأجزاء / الأسئلة المفحوصة", value: questions.length },
      ...(initConfig?.timedQuiz !== undefined
        ? [
            {
              label: "اختبار مؤقت (Timed Quiz)",
              value: initConfig.timedQuiz ? "نعم (محمي)" : "لا",
            },
          ]
        : []),
    ]),
  );
  lines.push("");

  if (note) {
    lines.push(`> **ملاحظة:** ${note}`);
    lines.push("");
  }

  if (showInfo) {
    lines.push(buildSectionHeading(2, "بيانات صفحة الاختبار (Show Page)"));
    lines.push("");
    lines.push(
      buildMetadataTable([
        { label: "عنوان الاختبار", value: showInfo.title || "—" },
        { label: "نص زر الإجراء", value: showInfo.actionButtonText || "—" },
        { label: "رابط زر الإجراء", value: showInfo.actionButtonHref || "—" },
        {
          label: "محاولة مفتوحة مسبقاً (Resume)",
          value: showInfo.isResumeAttempt ? "نعم" : "لا",
        },
        {
          label: "رمز الحماية (csrf-token)",
          value: showInfo.csrfToken ? "VALUES" : "غير موجود",
        },
        {
          label: "تفاصيل الشريط الجانبي",
          value:
            showInfo.sidebarDetails.length > 0
              ? showInfo.sidebarDetails.join(" | ")
              : "—",
        },
      ]),
    );
    lines.push("");
  }

  if (initConfig) {
    lines.push(buildSectionHeading(2, "إعدادات الاختبار (init_quiz)"));
    lines.push("");
    lines.push(
      buildMarkdownTable(
        ["المعرف", "القيمة"],
        [
          ["quiz_id", initConfig.quizId ?? "—"],
          ["results_id", initConfig.resultsId ?? "—"],
          ["الجزء الحالي (part)", initConfig.part ?? "—"],
          ["إجمالي الأجزاء (parts)", initConfig.parts ?? "—"],
          ["اختبار مؤقت (timed_quiz)", initConfig.timedQuiz ? "نعم" : "لا"],
          ["الوقت المتبقي (time_left)", initConfig.timeLeft ?? "—"],
          [
            "السماح بالاستئناف التلقائي (resume_refresh)",
            initConfig.resumeRefresh ? "نعم" : "لا",
          ],
        ],
      ),
    );
    lines.push("");
  }

  lines.push(buildSectionHeading(2, "الأسئلة والخيارات المفصلة"));
  lines.push("");

  for (const q of questions) {
    const cardLines = renderQuestionCardMarkdown(q);
    lines.push(...cardLines);
  }

  if (summaryItems.length > 0) {
    lines.push(buildSectionHeading(2, "ملخص الإجابات في نهاية الاختبار (Summary Screen)"));
    lines.push("");
    const rows = summaryItems.map((s) => [
      s.questionTitle,
      s.promptPreview,
      s.recordedAnswer,
    ]);
    lines.push(
      buildMarkdownTable(
        ["عنوان السؤال", "نظرة عامة على نص السؤال", "الإجابة المسجلة"],
        rows,
      ),
    );
    lines.push("");
  }

  if (traces.length > 0) {
    lines.push(buildSectionHeading(2, "سجل طلبات HTTP (مع إخفاء الأسرار VALUES)"));
    lines.push("");
    const traceRows = traces.map((t) => [
      t.method,
      t.url,
      `${t.status} ${t.statusText}`,
      `${t.elapsedMs}ms`,
      t.kind,
      t.updatedCookieNames.length > 0 ? t.updatedCookieNames.join(", ") : "—",
    ]);
    lines.push(
      buildMarkdownTable(
        [
          "الطريقة",
          "الرابط",
          "الحالة",
          "الزمن",
          "النوع",
          "الكوكيز المحدثة (أسماء فقط)",
        ],
        traceRows,
      ),
    );
    lines.push("");
  }

  return lines.join("\n");
}

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
  traces?: SanitizedHttpTrace[];
}

export interface QuizScanReportInput {
  targetUrl: string;
  startNewUsed: boolean;
  timestamp: Date;
  dueAssignments: ParsedAssignment[];
  scannedQuizzes: QuizScannedItem[];
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
}

export function renderQuizScanMarkdown(input: QuizScanReportInput): string {
  const {
    targetUrl,
    startNewUsed,
    timestamp,
    dueAssignments,
    scannedQuizzes,
    traces = [],
    hasSession,
  } = input;

  const lines: string[] = [];
  lines.push(buildSectionHeading(1, "تقرير فحص الاختبارات المستحقة (Quiz Scan - قراءة فقط GET)"));
  lines.push("");

  const totalQuizzes = dueAssignments.filter((a) => a.kind === "quiz").length;
  const inspectedCount = scannedQuizzes.filter(
    (q) => !q.skippedReason && q.questions.length > 0,
  ).length;
  const skippedCount = scannedQuizzes.filter((q) => !!q.skippedReason).length;

  lines.push(
    buildMetadataTable([
      { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
      { label: "رابط التقييمات المستحقة", value: targetUrl },
      { label: "وضع الأمان", value: "قراءة فقط (GET فقط)" },
      {
        label: "استخدام --start-new",
        value: startNewUsed ? "نعم" : "لا (تم تخطي المحاولات الجديدة للحماية)",
      },
      {
        label: "حالة الجلسة",
        value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)",
      },
      { label: "إجمالي التقييمات المستحقة", value: dueAssignments.length },
      { label: "إجمالي الاختبارات الإلكترونية", value: totalQuizzes },
      { label: "الاختبارات التي تم فحص أسئلتها", value: inspectedCount },
      { label: "الاختبارات المتخطاة / المحمية", value: skippedCount },
    ]),
  );
  lines.push("");

  if (dueAssignments.length > 0) {
    lines.push(buildSectionHeading(2, "قائمة التقييمات المستحقة المكتشفة"));
    lines.push("");
    const assignRows = dueAssignments.map((a) => [
      a.title,
      a.kind === "quiz"
        ? "اختبار إلكتروني (Quiz)"
        : a.kind === "offline"
          ? "تقييم ورقي / غير إلكتروني"
          : "أخرى",
      a.assignmentId ?? "—",
      a.href,
    ]);
    lines.push(
      buildMarkdownTable(["عنوان التقييم", "النوع", "المعرف", "الرابط"], assignRows),
    );
    lines.push("");
  }

  lines.push(buildSectionHeading(2, "تفاصيل فحص كل اختبار إلكتروني"));
  lines.push("");

  for (const [idx, quiz] of scannedQuizzes.entries()) {
    lines.push(buildSectionHeading(2, `الاختبار ${idx + 1}: ${quiz.assignmentTitle}`));
    lines.push("");

    if (quiz.showInfo) {
      lines.push(
        buildMetadataTable([
          { label: "عنوان صفحة الاختبار", value: quiz.showInfo.title || "—" },
          { label: "نص زر الإجراء", value: quiz.showInfo.actionButtonText || "—" },
          {
            label: "محاولة مفتوحة مسبقاً (Resume)",
            value: quiz.showInfo.isResumeAttempt ? "نعم" : "لا",
          },
        ]),
      );
      lines.push("");
    }

    if (quiz.initConfig) {
      lines.push(
        buildMetadataTable([
          { label: "quiz_id", value: quiz.initConfig.quizId ?? "—" },
          { label: "results_id", value: quiz.initConfig.resultsId ?? "—" },
          { label: "إجمالي الأجزاء (parts)", value: quiz.initConfig.parts ?? "—" },
          {
            label: "اختبار مؤقت (timed_quiz)",
            value: quiz.initConfig.timedQuiz ? "نعم (محمي)" : "لا",
          },
        ]),
      );
      lines.push("");
    }

    if (quiz.skippedReason) {
      lines.push(`> **تم التخطي لحماية المحاولة:** ${quiz.skippedReason}`);
      lines.push("");
      continue;
    }

    for (const q of quiz.questions) {
      const cardLines = renderQuestionCardMarkdown(q, `سؤال الجزء ${q.part}`);
      lines.push(...cardLines);
    }

    if (quiz.summaryItems && quiz.summaryItems.length > 0) {
      lines.push(buildSectionHeading(3, "ملخص الإجابات المسجلة (Summary Screen)"));
      lines.push("");
      const rows = quiz.summaryItems.map((s) => [
        s.questionTitle,
        s.promptPreview,
        s.recordedAnswer,
      ]);
      lines.push(
        buildMarkdownTable(
          ["عنوان السؤال", "نظرة عامة على نص السؤال", "الإجابة المسجلة"],
          rows,
        ),
      );
      lines.push("");
    }
  }

  if (traces.length > 0) {
    lines.push(buildSectionHeading(2, "سجل طلبات HTTP (مع إخفاء الأسرار VALUES)"));
    lines.push("");
    const traceRows = traces.map((t) => [
      t.method,
      t.url,
      `${t.status} ${t.statusText}`,
      `${t.elapsedMs}ms`,
      t.kind,
      t.updatedCookieNames.length > 0 ? t.updatedCookieNames.join(", ") : "—",
    ]);
    lines.push(
      buildMarkdownTable(
        [
          "الطريقة",
          "الرابط",
          "الحالة",
          "الزمن",
          "النوع",
          "الكوكيز المحدثة (أسماء فقط)",
        ],
        traceRows,
      ),
    );
    lines.push("");
  }

  return lines.join("\n");
}

export interface QuizDraftReportInput {
  displayUrl: string;
  dryRun: boolean;
  pausedSafely: boolean;
  timestamp: Date;
  result: QuizDraftAttemptResult;
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
  answersByPart?: Record<number, string>;
}

export function renderQuizDraftMarkdown(input: QuizDraftReportInput): string {
  const {
    displayUrl,
    dryRun,
    pausedSafely,
    timestamp,
    result,
    traces = [],
    hasSession,
    answersByPart = {},
  } = input;

  const lines: string[] = [];
  lines.push(
    buildSectionHeading(
      1,
      `تقرير ${dryRun ? "معاينة مسودة الاختبار (Dry-Run)" : "تنفيذ حفظ مسودة الاختبار مع الإيقاف المؤقت"}`,
    ),
  );
  lines.push("");

  lines.push(
    buildMetadataTable([
      { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
      { label: "رابط صفحة عرض الاختبار", value: displayUrl },
      { label: "معرف الاختبار (quiz_id)", value: result.quizId },
      { label: "معرف المحاولة (results_id)", value: result.resultsId },
      { label: "إجمالي الأجزاء", value: result.totalParts },
      {
        label: "وضع التشغيل",
        value: dryRun
          ? "معاينة فقط (Dry-Run - لم يتم إرسال أي POST)"
          : "تنفيذ فعلي للمسودة + إيقاف مؤقت (/pause)",
      },
      {
        label: "تم الوصول إلى شاشة الملخص النهائية",
        value: result.reachedSummary ? "نعم (تم التوقف قبل /finish)" : "لا",
      },
      { label: "تم الإيقاف المؤقت بأمان", value: pausedSafely ? "نعم" : "لا" },
      {
        label: "حالة الجلسة",
        value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)",
      },
    ]),
  );
  lines.push("");

  lines.push(buildSectionHeading(2, "خطوات ومعاينة الإجابات المرسلة"));
  lines.push("");

  const stepRows = result.steps.map((s) => [
    `الجزء ${s.part}`,
    s.questionHeader,
    s.sentAnswer || "(الإجابة الحالية / فارغ)",
    answersByPart[s.part] !== undefined ? "مخصصة (--answers)" : "افتراضية / حالية",
    s.status !== undefined ? `${s.status}` : dryRun ? "معاينة (Dry-Run)" : "تم",
    s.action,
  ]);

  lines.push(
    buildMarkdownTable(
      ["الجزء", "عنوان السؤال", "الإجابة المستخدمة", "مصدر الإجابة", "الحالة", "رابط الإجراء"],
      stepRows.length > 0 ? stepRows : [["—", "—", "—", "—", "—", "—"]],
    ),
  );
  lines.push("");

  lines.push(buildSectionHeading(2, "تفاصيل الأسئلة والخيارات"));
  lines.push("");

  for (const q of result.questions) {
    const cardLines = renderQuestionCardMarkdown(q, `سؤال الجزء ${q.part}`);
    lines.push(...cardLines);
  }

  if (result.summaryItems && result.summaryItems.length > 0) {
    lines.push(buildSectionHeading(2, "شاشة الملخص النهائية عند الوصول إليها (Summary Screen)"));
    lines.push("");
    lines.push(
      "> **تنبيه أمان:** تم التوقف عند شاشة الملخص دون استدعاء `/student_take_quiz_assignment/finish/` نهائياً.",
    );
    lines.push("");
    const rows = result.summaryItems.map((s) => [
      s.questionTitle,
      s.promptPreview,
      s.recordedAnswer,
    ]);
    lines.push(
      buildMarkdownTable(
        ["عنوان السؤال", "نظرة عامة على نص السؤال", "الإجابة المسجلة"],
        rows,
      ),
    );
    lines.push("");
  }

  if (traces.length > 0) {
    lines.push(buildSectionHeading(2, "سجل طلبات HTTP (مع إخفاء الأسرار VALUES)"));
    lines.push("");
    const traceRows = traces.map((t) => [
      t.method,
      t.url,
      `${t.status} ${t.statusText}`,
      `${t.elapsedMs}ms`,
      t.kind,
      t.updatedCookieNames.length > 0 ? t.updatedCookieNames.join(", ") : "—",
    ]);
    lines.push(
      buildMarkdownTable(
        [
          "الطريقة",
          "الرابط",
          "الحالة",
          "الزمن",
          "النوع",
          "الكوكيز المحدثة (أسماء فقط)",
        ],
        traceRows,
      ),
    );
    lines.push("");
  }

  return lines.join("\n");
}

export interface QuizSolveReportInput {
  targetUrl: string;
  displayUrl: string;
  showUrl?: string;
  timestamp: Date;
  result: QuizSolveAttemptResult;
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
}

export function renderQuizSolveMarkdown(input: QuizSolveReportInput): string {
  const {
    targetUrl,
    displayUrl,
    showUrl,
    timestamp,
    result,
    traces = [],
    hasSession,
  } = input;

  const modeLabelAr =
    result.mode === "dry-run"
      ? "معاينة ذكية فقط (Dry-Run - لم يتم إرسال أي POST)"
      : result.mode === "submit-ready"
        ? "تنفيذ وحفظ كامل مع التحقق من الملخص قبل التسليم (/finish محظور للأمان)"
        : "تنفيذ وحفظ مسودة الإجابات مع الإيقاف المؤقت (/pause)";

  const lines: string[] = [];
  lines.push(
    buildSectionHeading(
      1,
      `تقرير حل الاختبار بالذكاء الاصطناعي (${result.dryRun ? "معاينة Dry-Run" : "تنفيذ وحفظ"})`,
    ),
  );
  lines.push("");

  lines.push(
    buildMetadataTable([
      { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
      { label: "المدخل الأصلي", value: targetUrl },
      ...(showUrl ? [{ label: "رابط صفحة الاختبار (Show)", value: showUrl }] : []),
      { label: "رابط صفحة الأسئلة (Display)", value: displayUrl },
      ...(result.quizTitle ? [{ label: "عنوان الاختبار", value: result.quizTitle }] : []),
      { label: "معرف الاختبار (quiz_id)", value: result.quizId },
      { label: "معرف المحاولة (results_id)", value: result.resultsId },
      { label: "مزود الذكاء الاصطناعي (Provider)", value: result.provider },
      { label: "النموذج المستخدم (Model)", value: result.model },
      { label: "مفتاح المزود (LLM_API_KEY)", value: "VALUES" },
      { label: "وضع التشغيل", value: modeLabelAr },
      { label: "إجمالي أجزاء الاختبار", value: result.totalParts },
      { label: "عدد الأسئلة المحلولة", value: result.steps.length },
      {
        label: "الوصول إلى شاشة الملخص النهائية",
        value: result.reachedSummary ? "نعم" : "لا",
      },
      {
        label: "التحقق من اكتمال الملخص",
        value: result.reachedSummary
          ? result.summaryVerified
            ? "مكتمل ومتحقق منه"
            : "يوجد تنبيهات / أسئلة غير مسجلة"
          : "— (معاينة أو لم يصل للملخص)",
      },
      {
        label: "تم الإيقاف المؤقت بأمان (/pause)",
        value: result.pausedSafely ? "نعم" : "لا",
      },
      {
        label: "حالة الجلسة",
        value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)",
      },
    ]),
  );
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push(buildSectionHeading(2, "تنبيهات الأمان والتحقق"));
    lines.push("");
    for (const w of result.warnings) {
      lines.push(`> **تنبيه:** ${sanitizeText(w)}`);
      lines.push("");
    }
  }

  lines.push(buildSectionHeading(2, "ملخص الإجابات المقترحة / المرسلة لكل سؤال"));
  lines.push("");

  const stepRows = result.steps.map((s) => {
    const qScreen = result.questions.find((q) => q.part === s.part)?.screen;
    const typeAr = qScreen ? getQuestionTypeLabelAr(qScreen) : s.inputType;
    const langAr = s.language === "ar" ? "العربية (ar)" : "الإنجليزية (en)";
    const confidencePct = `${Math.round(s.solvedAnswer.confidence * 100)}%`;
    const filesNote =
      s.attachedFiles && s.attachedFiles.length > 0
        ? s.attachedFiles.map((f) => `${f.fileName} (${f.sizeBytes}B)`).join("، ")
        : "—";
    const statusLabel =
      s.status !== undefined
        ? `HTTP ${s.status}`
        : result.dryRun
          ? "معاينة (Dry-Run)"
          : "تم";

    return [
      `الجزء ${s.part}`,
      s.questionHeader || `السؤال ${s.part}`,
      typeAr,
      langAr,
      confidencePct,
      sanitizeText(s.formattedSummary || "—"),
      filesNote,
      statusLabel,
    ];
  });

  lines.push(
    buildMarkdownTable(
      [
        "الجزء",
        "عنوان السؤال",
        "نوع السؤال",
        "لغة الإجابة",
        "الثقة",
        "ملخص الإجابة",
        "الملفات المرفقة",
        "الحالة",
      ],
      stepRows.length > 0
        ? stepRows
        : [["—", "—", "—", "—", "—", "—", "—", "—"]],
    ),
  );
  lines.push("");

  lines.push(buildSectionHeading(2, "تفاصيل الأسئلة وتبرير الإجابات"));
  lines.push("");

  for (const q of result.questions) {
    const cardLines = renderQuestionCardMarkdown(q, `سؤال الجزء ${q.part}`);
    lines.push(...cardLines);

    const step = result.steps.find((s) => s.part === q.part);
    if (step) {
      lines.push(buildSectionHeading(4, `تفاصيل حل الذكاء الاصطناعي للجزء ${q.part}`));
      lines.push("");
      lines.push(
        buildMetadataTable([
          {
            label: "اللغة المختارة للإجابة",
            value: step.language === "ar" ? "العربية" : "الإنجليزية (English)",
          },
          {
            label: "ملخص الإجابة المعتمدة",
            value: sanitizeText(step.formattedSummary),
          },
          {
            label: "التعليل المختصر (Reasoning)",
            value: sanitizeText(step.solvedAnswer.reasoning || "—"),
          },
          {
            label: "درجة الثقة",
            value: `${Math.round(step.solvedAnswer.confidence * 100)}%`,
          },
          ...(step.attachedFiles && step.attachedFiles.length > 0
            ? [
                {
                  label: "المرفقات المجهزة للرفع",
                  value: step.attachedFiles
                    .map(
                      (f) =>
                        `${f.fieldName}: ${f.fileName} (${f.mimeType}, ${f.sizeBytes} bytes)`,
                    )
                    .join(" | "),
                },
              ]
            : []),
        ]),
      );
      lines.push("");
    }
  }

  if (result.summaryItems && result.summaryItems.length > 0) {
    lines.push(buildSectionHeading(2, "شاشة الملخص النهائية بعد الحفظ (Summary Screen)"));
    lines.push("");
    const summaryRows = result.summaryItems.map((s) => [
      s.questionTitle,
      s.promptPreview,
      s.recordedAnswer,
    ]);
    lines.push(
      buildMarkdownTable(
        ["عنوان السؤال", "نظرة عامة على نص السؤال", "الإجابة المسجلة على المنصة"],
        summaryRows,
      ),
    );
    lines.push("");
  }

  if (traces.length > 0) {
    lines.push(buildSectionHeading(2, "سجل طلبات HTTP (مع إخفاء الأسرار VALUES)"));
    lines.push("");
    const traceRows = traces.map((t) => [
      t.method,
      t.url,
      `${t.status} ${t.statusText}`,
      `${t.elapsedMs}ms`,
      t.kind,
      t.fileAttachments && t.fileAttachments.length > 0
        ? t.fileAttachments.map((f) => f.fileName).join(", ")
        : "—",
      t.updatedCookieNames.length > 0 ? t.updatedCookieNames.join(", ") : "—",
    ]);
    lines.push(
      buildMarkdownTable(
        [
          "الطريقة",
          "الرابط",
          "الحالة",
          "الزمن",
          "النوع",
          "الملفات المرسلة",
          "الكوكيز المحدثة (أسماء فقط)",
        ],
        traceRows,
      ),
    );
    lines.push("");
  }

  return lines.join("\n");
}
