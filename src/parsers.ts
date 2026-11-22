import * as cheerio from "cheerio";

export interface ParsedAssignment {
  title: string;
  href: string;
  assignmentId: string | null;
  kind: "quiz" | "offline" | "other";
  relatedLessonTitle?: string;
  relatedLessonHref?: string;
}

export interface ParsedLessonSection {
  title: string;
  href: string;
  sectionId: string | null;
}

export interface ParsedLesson {
  title: string;
  href: string;
  lessonId: string | null;
  sections: ParsedLessonSection[];
}

function extractQueryParam(href: string, key: string): string | null {
  try {
    const url = new URL(href, "https://qeducation.edu.gov.qa");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

function extractAssignmentId(href: string): string | null {
  const match = href.match(
    /\/student_(?:quiz|offline)_assignment\/show\/(\d+)/,
  );
  return match?.[1] ?? null;
}

export function parseAssignmentsHtml(html: string): ParsedAssignment[] {
  const $ = cheerio.load(html);
  const results: ParsedAssignment[] = [];

  // نبحث عن روابط التقييمات داخل #mainContent
  $('#mainContent a[href*="_assignment/show/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const title = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;

    const kind: ParsedAssignment["kind"] = href.includes("offline_assignment")
      ? "offline"
      : href.includes("quiz_assignment")
        ? "quiz"
        : "other";

    // محاولة ربط التقييم بالدرس القريب منه إن وُجد في نفس الحاوية/الصف
    const container = $(el).closest("tr, li, .assignment, .item, div");
    const lessonLink = container
      .find('a[href*="/student_lesson/show/"]')
      .first();
    const relatedLessonTitle =
      lessonLink.text().replace(/\s+/g, " ").trim() || undefined;
    const relatedLessonHref = lessonLink.attr("href")?.trim() || undefined;

    results.push({
      title,
      href,
      assignmentId: extractAssignmentId(href),
      kind,
      ...(relatedLessonTitle ? { relatedLessonTitle } : {}),
      ...(relatedLessonHref ? { relatedLessonHref } : {}),
    });
  });

  // إزالة التكرار إن ظهر نفس الرابط أكثر من مرة
  const uniqueByHref = new Map<string, ParsedAssignment>();
  for (const item of results) {
    if (!uniqueByHref.has(item.href)) {
      uniqueByHref.set(item.href, item);
    }
  }

  return Array.from(uniqueByHref.values());
}

export function parseLessonsHtml(html: string): ParsedLesson[] {
  const $ = cheerio.load(html);
  const lessonsMap = new Map<string, ParsedLesson>();

  $('#mainContent a[href*="/student_lesson/show/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;

    const lessonId = extractQueryParam(href, "lesson_id");
    const sectionId = extractQueryParam(href, "section_id");
    const rawText = $(el).text().replace(/\s+/g, " ").trim();
    if (!lessonId || !rawText) return;

    const key = lessonId;
    if (!lessonsMap.has(key)) {
      lessonsMap.set(key, {
        title: rawText.slice(0, 140),
        href: `/student_lesson/show/${extractQueryParam(href, "class_id") || "614062"}?lesson_id=${lessonId}`,
        lessonId,
        sections: [],
      });
    }

    const lesson = lessonsMap.get(key)!;
    if (sectionId) {
      const exists = lesson.sections.some((s) => s.sectionId === sectionId);
      if (!exists) {
        lesson.sections.push({
          title: rawText,
          href,
          sectionId,
        });
      }
    } else if (rawText.includes("ابدأ الدرس")) {
      // استخراج عنوان الدرس بشكل أنظف إن كان يبدأ بـ "ابدأ الدرس X."
      const cleaned = rawText
        .replace(/^ابدأ الدرس\s*\d+\.\s*/, "")
        .split(
          /\s+(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+\d+/,
        )[0]
        ?.trim();
      if (cleaned) {
        lesson.title = cleaned;
      }
    }
  });

  return Array.from(lessonsMap.values());
}
