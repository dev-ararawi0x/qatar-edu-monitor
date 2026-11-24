import type { ParsedLesson } from "@qatar-edu/core";
import type { SanitizedHttpTrace } from "@qatar-edu/core";
import {
  buildMarkdownTable,
  buildMetadataTable,
  buildSectionHeading,
  formatIsoTimestamp,
} from "./markdown-helpers.js";

export interface LessonsReportInput {
  targetUrl: string;
  classId: string;
  timestamp: Date;
  lessons: ParsedLesson[];
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
}

export function renderLessonsMarkdown(input: LessonsReportInput): string {
  const { targetUrl, classId, timestamp, lessons, traces = [], hasSession } = input;

  const lines: string[] = [];
  lines.push(buildSectionHeading(1, "تقرير دروس ووحدات المنصة"));
  lines.push("");

  lines.push(buildMetadataTable([
    { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
    { label: "الرابط المستهدف", value: targetUrl },
    { label: "معرف الفصل / الصف", value: classId },
    { label: "حالة الجلسة", value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)" },
    { label: "إجمالي الدروس المكتشفة", value: lessons.length },
    { label: "إجمالي الأقسام الفرعية", value: lessons.reduce((acc, l) => acc + l.sections.length, 0) },
  ]));
  lines.push("");

  lines.push(buildSectionHeading(2, "ملخص الدروس"));
  lines.push("");

  lines.push(buildMarkdownTable(
    ["الفئة", "العدد"],
    [
      ["إجمالي الدروس", lessons.length],
      ["الدروس التي تحتوي على أقسام فرعية", lessons.filter((l) => l.sections.length > 0).length],
    ],
  ));
  lines.push("");

  if (lessons.length === 0) {
    lines.push("> لم يتم العثور على دروس أو روابط أقسام مطابقة في الصفحة الحالية.");
    lines.push("");
    return lines.join("\n");
  }

  for (const [idx, lesson] of lessons.entries()) {
    lines.push(buildSectionHeading(2, `الدرس ${idx + 1}: ${lesson.title}`));
    lines.push("");
    lines.push(buildMetadataTable([
      { label: "معرف الدرس (lesson_id)", value: lesson.lessonId ?? "—" },
      { label: "معرف الفصل (class_id)", value: lesson.classId ?? classId },
      { label: "عدد الأقسام / الوحدات الفرعية", value: lesson.sections.length },
      { label: "رابط الدرس", value: lesson.href },
    ]));
    lines.push("");

    if (lesson.sections.length > 0) {
      lines.push(buildSectionHeading(3, "الأقسام والوحدات الفرعية"));
      lines.push("");
      const sectionRows = lesson.sections.map((s, sIdx) => [
        `#${sIdx + 1}`,
        s.title,
        s.sectionId ?? "—",
        s.href,
      ]);
      lines.push(buildMarkdownTable(
        ["#", "عنوان القسم", "معرف القسم (section_id)", "الرابط"],
        sectionRows,
      ));
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
    lines.push(buildMarkdownTable(
      ["الطريقة", "الرابط", "الحالة", "الزمن", "النوع", "الكوكيز المحدثة (أسماء فقط)"],
      traceRows,
    ));
    lines.push("");
  }

  return lines.join("\n");
}
