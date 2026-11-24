import type { ParsedAssignment } from "@qatar-edu/core";
import type { SanitizedHttpTrace } from "@qatar-edu/core";
import {
  buildMarkdownTable,
  buildMetadataTable,
  buildSectionHeading,
  formatIsoTimestamp,
} from "./markdown-helpers.js";

export interface AssignmentsReportInput {
  mode: "list" | "due";
  targetUrl: string;
  classId: string;
  timestamp: Date;
  assignments: ParsedAssignment[];
  traces?: SanitizedHttpTrace[];
  hasSession: boolean;
}

export function renderAssignmentsMarkdown(
  input: AssignmentsReportInput,
): string {
  const { mode, targetUrl, classId, timestamp, assignments, traces = [], hasSession } = input;
  const titleAr = mode === "due" ? "التقييمات المستحقة" : "قائمة التقييمات والواجبات";

  const lines: string[] = [];
  lines.push(buildSectionHeading(1, `تقرير ${titleAr}`));
  lines.push("");

  lines.push(buildMetadataTable([
    { label: "نوع التقرير", value: titleAr },
    { label: "التاريخ والوقت", value: formatIsoTimestamp(timestamp) },
    { label: "الرابط المستهدف", value: targetUrl },
    { label: "معرف الفصل / الصف", value: classId },
    { label: "حالة الجلسة", value: hasSession ? "نشطة (VALUES)" : "غير نشطة / placeholder (VALUES)" },
    { label: "عدد العناصر المكتشفة", value: assignments.length },
    { label: "عدد طلبات HTTP", value: traces.length },
  ]));
  lines.push("");

  lines.push(buildSectionHeading(2, "ملخص النتائج"));
  lines.push("");

  const quizCount = assignments.filter((a) => a.kind === "quiz").length;
  const offlineCount = assignments.filter((a) => a.kind === "offline").length;
  const otherCount = assignments.filter((a) => a.kind === "other").length;

  lines.push(buildMarkdownTable(
    ["الفئة", "العدد"],
    [
      ["إجمالي العناصر", assignments.length],
      ["اختبارات إلكترونية (Quiz)", quizCount],
      ["تقييمات ورقية / غير إلكترونية (Offline)", offlineCount],
      ["أخرى", otherCount],
    ],
  ));
  lines.push("");

  if (assignments.length === 0) {
    lines.push("> لم يتم العثور على أي تقييمات أو روابط مهام مطابقة في الصفحة الحالية.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(buildSectionHeading(2, "تفاصيل التقييمات والواجبات"));
  lines.push("");

  const tableRows = assignments.map((item, idx) => {
    const kindLabel =
      item.kind === "quiz"
        ? "اختبار إلكتروني (Quiz)"
        : item.kind === "offline"
          ? "تقييم ورقي / غير إلكتروني (Offline)"
          : "أخرى";

    return [
      `#${idx + 1}`,
      item.title,
      kindLabel,
      item.assignmentId ?? "—",
      item.relatedLessonTitle ?? "—",
      item.href,
    ];
  });

  lines.push(buildMarkdownTable(
    ["#", "عنوان التقييم / الواجب", "النوع", "معرف التقييم", "الدرس المرتبط", "الرابط"],
    tableRows,
  ));
  lines.push("");

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
