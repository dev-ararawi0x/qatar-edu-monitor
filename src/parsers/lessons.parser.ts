import * as cheerio from "cheerio";
import type { ParsedLesson } from "../types/index.js";
import { cleanText, extractQueryParam } from "./shared.js";

export function parseLessonsHtml(
  html: string,
  fallbackClassId = "614062",
): ParsedLesson[] {
  const $ = cheerio.load(html);
  const lessonsMap = new Map<string, ParsedLesson>();

  $('#mainContent a[href*="/student_lesson/show/"], a[href*="/student_lesson/show/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;

    const lessonId = extractQueryParam(href, "lesson_id");
    const sectionId = extractQueryParam(href, "section_id");
    const classId =
      extractQueryParam(href, "class_id") ||
      href.match(/\/student_lesson\/show\/(\d+)/)?.[1] ||
      fallbackClassId;

    const rawText = cleanText($(el).text());
    if (!lessonId || !rawText) return;

    const key = `${classId}:${lessonId}`;
    if (!lessonsMap.has(key)) {
      const lessonUrl = `/student_lesson/show/${classId}?lesson_id=${lessonId}`;
      lessonsMap.set(key, {
        title: rawText.slice(0, 140),
        href: lessonUrl,
        lessonId,
        classId,
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
