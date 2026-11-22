import type { GenericPageInspection, SanitizedHttpTrace } from "../types/index.js";
import {
  buildMarkdownTable,
  buildMetadataTable,
  buildSectionHeading,
  formatIsoTimestamp,
} from "./markdown-helpers.js";

export interface MonitorReportInput {
  targets: string[];
  timestamp: Date;
  inspections: GenericPageInspection[];
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
}

export function renderMonitorMarkdown(input: MonitorReportInput): string {
  const { targets, timestamp, inspections, traces = [], hasSession } = input;

  const lines: string[] = [];
  lines.push(buildSectionHeading(1, "تقرير مراقبة نقاط نهاية المنصة (Monitor - قراءة فقط GET)"));
  lines.push("");

  lines.push(buildMetadataTable([
    { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
    { label: "الروابط المفحوصة", value: targets.join("\n") },
    { label: "حالة الجلسة", value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)" },
    { label: "عدد الصفحات المفحوصة", value: inspections.length },
    { label: "عدد طلبات HTTP", value: traces.length },
  ]));
  lines.push("");

  if (traces.length > 0) {
    lines.push(buildSectionHeading(2, "سجل طلبات HTTP وحركة الشبكة (مع إخفاء الأسرار VALUES)"));
    lines.push("");
    const traceRows = traces.map((t) => [
      t.method,
      t.url,
      `${t.status} ${t.statusText}`,
      `${t.elapsedMs}ms`,
      t.kind,
      t.sizeBytes,
      t.updatedCookieNames.length > 0 ? t.updatedCookieNames.join(", ") : "—",
    ]);
    lines.push(buildMarkdownTable(
      ["الطريقة", "الرابط", "الحالة", "الزمن", "النوع", "الحجم (Bytes)", "الكوكيز المحدثة (أسماء فقط)"],
      traceRows,
    ));
    lines.push("");
  }

  lines.push(buildSectionHeading(2, "تحليل الصفحات المستخرجة"));
  lines.push("");

  for (const [idx, insp] of inspections.entries()) {
    lines.push(buildSectionHeading(2, `فحص الصفحة ${idx + 1}: ${insp.url}`));
    lines.push("");

    lines.push(buildMetadataTable([
      { label: "الحالة", value: `${insp.status} ${insp.statusText}` },
      { label: "نوع المحتوى", value: insp.contentType },
      { label: "تصنيف الاستجابة", value: insp.kind },
      { label: "الموقع (Location)", value: insp.location ?? "—" },
      { label: "زمن الاستجابة", value: `${insp.elapsedMs}ms` },
      { label: "عنوان الصفحة (Page Title)", value: insp.pageTitle ?? "—" },
      { label: "العنوان الرئيسي (Main Heading)", value: insp.mainHeading ?? "—" },
      { label: "التقييمات المكتشفة", value: insp.assignments.length },
      { label: "الدروس المكتشفة", value: insp.lessons.length },
      ...(insp.quizShowInfo
        ? [{ label: "عنوان الاختبار المكتشف", value: insp.quizShowInfo.title || "—" }]
        : []),
    ]));
    lines.push("");

    if (insp.quizShowInfo) {
      lines.push(buildSectionHeading(3, "بيانات الاختبار المكتشف (Quiz Show Page)"));
      lines.push("");
      lines.push(buildMarkdownTable(
        ["البند", "القيمة"],
        [
          ["عنوان الاختبار", insp.quizShowInfo.title || "—"],
          ["نص زر الإجراء", insp.quizShowInfo.actionButtonText || "—"],
          ["رابط زر الإجراء", insp.quizShowInfo.actionButtonHref || "—"],
          ["محاولة مفتوحة مسبقاً (Resume)", insp.quizShowInfo.isResumeAttempt ? "نعم" : "لا"],
          ["رمز الحماية (csrf-token)", insp.quizShowInfo.csrfToken ? "VALUES" : "غير موجود"],
        ],
      ));
      lines.push("");
    }

    if (insp.quizScreen && insp.quizScreen.stage === "question") {
      lines.push(buildSectionHeading(3, "بيانات سؤال الاختبار الحالي (Quiz Question Screen)"));
      lines.push("");
      const qs = insp.quizScreen;
      lines.push(buildMarkdownTable(
        ["البند", "القيمة"],
        [
          ["عنوان السؤال", qs.questionHeader || "—"],
          ["الدرجة", qs.points || "—"],
          ["نوع السؤال", qs.inputType],
          ["نص السؤال", qs.promptText || "—"],
          ["يدعم نص عادي", qs.hasPlainTextInput ? "نعم" : "لا"],
          ["يدعم محرر منسق", qs.hasRichTextEditor ? "نعم" : "لا"],
          ["يدعم مرفقات", qs.hasFileUpload ? "نعم" : "لا"],
          ["عدد الخيارات", qs.choices.length],
        ],
      ));
      lines.push("");
    }

    if (insp.assignments.length > 0) {
      lines.push(buildSectionHeading(3, "التقييمات والواجبات المستخرجة"));
      lines.push("");
      const assignRows = insp.assignments.map((a) => [
        a.title,
        a.kind,
        a.assignmentId ?? "—",
        a.href,
      ]);
      lines.push(buildMarkdownTable(
        ["العنوان", "النوع", "المعرف", "الرابط"],
        assignRows,
      ));
      lines.push("");
    }

    if (insp.lessons.length > 0) {
      lines.push(buildSectionHeading(3, "الدروس والأقسام المستخرجة"));
      lines.push("");
      const lessonRows = insp.lessons.map((l) => [
        l.title,
        l.lessonId ?? "—",
        l.sections.length,
        l.href,
      ]);
      lines.push(buildMarkdownTable(
        ["عنوان الدرس", "معرف الدرس", "عدد الأقسام", "الرابط"],
        lessonRows,
      ));
      lines.push("");
    }

    if (insp.extractedElements.length > 0) {
      lines.push(buildSectionHeading(3, "عينة من العناصر المستخرجة من DOM"));
      lines.push("");
      const elementRows = insp.extractedElements.slice(0, 30).map((el) => [
        el.tag,
        el.text,
        el.href ?? "—",
      ]);
      lines.push(buildMarkdownTable(
        ["الوسم", "النص", "الرابط (إن وجد)"],
        elementRows,
      ));
      lines.push("");
    }
  }

  return lines.join("\n");
}
