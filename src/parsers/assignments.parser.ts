import * as cheerio from "cheerio";
import type { ParsedAssignment } from "../types/index.js";
import { cleanText, extractAssignmentId } from "./shared.js";

export function parseAssignmentsHtml(html: string): ParsedAssignment[] {
  const $ = cheerio.load(html);
  const results: ParsedAssignment[] = [];

  $('#mainContent a[href*="_assignment/show/"], a[href*="_assignment/show/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const title = cleanText($(el).text());
    if (!href || !title) return;

    const kind: ParsedAssignment["kind"] = href.includes("offline_assignment")
      ? "offline"
      : href.includes("quiz_assignment")
        ? "quiz"
        : "other";

    const container = $(el).closest("tr, li, .assignment, .item, div");
    const lessonLink = container
      .find('a[href*="/student_lesson/show/"]')
      .first();
    const relatedLessonTitle = cleanText(lessonLink.text()) || undefined;
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

  const uniqueByHref = new Map<string, ParsedAssignment>();
  for (const item of results) {
    if (!uniqueByHref.has(item.href)) {
      uniqueByHref.set(item.href, item);
    }
  }

  return Array.from(uniqueByHref.values());
}
