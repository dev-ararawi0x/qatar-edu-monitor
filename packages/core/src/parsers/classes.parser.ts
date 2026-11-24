import * as cheerio from "cheerio";
import type { ParsedClass } from "../types/index.js";
import { cleanText } from "./shared.js";

const CLASS_HREF_PATTERN =
  /\/student_(?:assignments|lessons|courses|classes|class)\/(?:list|show|due)\/(\d+)/;
const LESSON_SHOW_PATTERN = /\/student_lesson\/show\/(\d+)/;
const CLASS_ACTIVITY_PATTERN = /^class_activity_(\d+)$/;

function extractClassIdFromHref(href: string): string | null {
  const match =
    href.match(CLASS_HREF_PATTERN) ?? href.match(LESSON_SHOW_PATTERN);
  return match?.[1] ?? null;
}

function extractTeacherName(
  $: cheerio.CheerioAPI,
  anchor: ReturnType<cheerio.CheerioAPI>,
): string | undefined {
  const container = anchor.closest(
    "li, tr, .item, .course, .class, .subject, .card, div",
  );
  if (container.length === 0) return undefined;

  const teacherEl = container
    .find(
      ".teacher, .teacher-name, [class*='teacher'], small.teacher, .instructor",
    )
    .first();
  const teacherText = cleanText(teacherEl.text());
  if (teacherText) return teacherText;

  // Heuristic: text nodes labelled with المعلم / Teacher / المدرب
  const labelled = container
    .find("span, div, p, td")
    .filter((_, el) => {
      const txt = cleanText($(el).text());
      return /^(?:المعلم|المدرس|Teacher|Instructor)\s*[:：-]?\s*\S+/i.test(
        txt,
      );
    })
    .first();
  const labelledText = cleanText(labelled.text());
  if (labelledText) {
    return labelledText
      .replace(/^(?:المعلم|المدرس|Teacher|Instructor)\s*[:：-]?\s*/i, "")
      .trim();
  }

  return undefined;
}

/**
 * Parses one Excalibur class-list widget tile
 * (`div[data-activity="class_activity_<id>"]`) into a ParsedClass.
 * Tiles carry the authoritative class title (h3.class_name), course code,
 * due-assignment badge count, and lesson count.
 */
function parseClassWidgetTile(
  $: cheerio.CheerioAPI,
  tile: ReturnType<cheerio.CheerioAPI>,
): ParsedClass | null {
  const rawId =
    (tile.attr("id") || "").trim() ||
    (tile.attr("data-activity") || "").replace(CLASS_ACTIVITY_PATTERN, "$1");
  const classId = rawId.match(CLASS_ACTIVITY_PATTERN)?.[1] ?? rawId;
  if (!/^\d+$/.test(classId)) return null;

  const title = cleanText(
    tile.find("h3.class_name, .class_name").first().text(),
  );
  if (!title) return null;

  const href =
    tile.find('a[href*="/student_class/show/"]').first().attr("href")?.trim() ??
    "";

  // Course code: span titled 'رمز المقرر الدراسي' minus the screen-reader label.
  const codeClone = tile.find("span[title='رمز المقرر الدراسي']").first().clone();
  codeClone.find(".textOffScreen").remove();
  const courseCode = cleanText(codeClone.text()) || undefined;

  // Due-assignment badge: footer link to /student_assignments/{due|list}/<id>.
  const assignLink = tile.find('a[href*="/student_assignments/"]').first();
  let dueAssignmentsCount: number | undefined;
  if (assignLink.length > 0) {
    const badgeText = cleanText(
      assignLink.find(".pageBlank span").last().text(),
    );
    const anchorText = `${assignLink.attr("title") ?? ""} ${cleanText(assignLink.text())}`;
    if (/لا توجد|no\s+due|none/i.test(anchorText) || !/^\d+$/.test(badgeText)) {
      dueAssignmentsCount = 0;
    } else {
      dueAssignmentsCount = Number.parseInt(badgeText, 10);
    }
  }

  // Lesson count: footer .label like "14 الدروس".
  const labelText = cleanText(tile.find(".label").first().text());
  const lessonMatch = labelText.match(/(\d+)/);
  const lessonCount = lessonMatch
    ? Number.parseInt(lessonMatch[1] ?? "", 10)
    : undefined;

  return {
    classId,
    title,
    href,
    ...(courseCode ? { courseCode } : {}),
    ...(dueAssignmentsCount !== undefined ? { dueAssignmentsCount } : {}),
    ...(lessonCount !== undefined && Number.isFinite(lessonCount)
      ? { lessonCount }
      : {}),
  };
}

/**
 * Parses enrolled subjects/classes from LMS pages. Primary source is the
 * Excalibur class-list widget tiles (`data-activity="class_activity_*"`);
 * falls back to scanning class-related anchors anywhere in the HTML.
 */
export function parseClassesHtml(html: string): ParsedClass[] {
  const $ = cheerio.load(html);
  const results = new Map<string, ParsedClass>();
  const widgetClassIds = new Set<string>();

  // 1) Widget tiles — authoritative titles and metadata.
  $('[data-activity^="class_activity_"]').each((_, el) => {
    const parsed = parseClassWidgetTile($, $(el));
    if (!parsed) return;
    results.set(parsed.classId, parsed);
    widgetClassIds.add(parsed.classId);
  });

  // 2) Legacy anchor scan — fills gaps for non-widget layouts. Widget-derived
  //    entries keep their authoritative title/href; only missing fields merge.
  $(
    'a[href*="/student_assignments/"], a[href*="/student_lessons/"], a[href*="/student_courses/"], a[href*="/student_classes/"], a[href*="/student_class/"], a[href*="/student_lesson/show/"]',
  ).each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;

    const classId = extractClassIdFromHref(href);
    if (!classId) return;

    const title = cleanText($(el).text());
    if (!title) return;

    const existing = results.get(classId);
    const teacherName = extractTeacherName($, $(el));
    const isWidgetEntry = widgetClassIds.has(classId);

    if (!existing) {
      results.set(classId, {
        classId,
        title,
        ...(teacherName ? { teacherName } : {}),
        href,
      });
      return;
    }

    if (isWidgetEntry) {
      if (!existing.teacherName && teacherName) {
        existing.teacherName = teacherName;
      }
      return;
    }

    // Prefer richer titles and fill missing teacher names on duplicates
    if (existing.title.length < title.length && title.length <= 200) {
      existing.title = title;
      existing.href = href;
    }
    if (!existing.teacherName && teacherName) {
      existing.teacherName = teacherName;
    }
  });

  return Array.from(results.values());
}

/** True when the HTML looks like a class-lists widget response. */
export function hasClassWidgetContent(html: string): boolean {
  return (
    /class_activity_\d+/.test(html) ||
    /catalog_student/.test(html) ||
    /class_name/.test(html)
  );
}

/**
 * Extracts candidate `cell_id` values for POST /class_lists_widget/default_tab
 * from dashboard HTML (JS calls, data attributes, or cell element ids).
 */
export function extractClassWidgetCellIds(html: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /class_lists_widget[\s\S]{0,500}?cell_id["'\s]*[:=]["'\s]*([A-Za-z0-9_-]+)/gi,
    /cell_id["'\s]*[:=]["'\s]*["']?([A-Za-z0-9_-]+)["']?[\s\S]{0,500}?class_lists_widget/gi,
    /["']cell_id["']\s*:\s*["']([^"']+)["']/g,
    /data-cell-id=["']([^"']+)["']/gi,
    /id=["']cell[_-]([A-Za-z0-9_-]+)["']/gi,
  ];
  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      const value = match[1]?.trim();
      if (value) ids.add(value);
    }
  }
  return Array.from(ids);
}

/** Extracts the Rails-style CSRF token from a <meta name="csrf-token"> tag. */
export function extractMetaCsrfToken(html: string): string | null {
  const match = html.match(
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
  );
  return match?.[1]?.trim() || null;
}

/**
 * Heuristic detection of LMS login pages. Requires a password field or an
 * explicit sign-in marker so authenticated pages are never misclassified.
 */
export function isLoginPageHtml(html: string): boolean {
  const hasPasswordField =
    /<input[^>]+type=["']?password/i.test(html) ||
    /name=["']password["']/i.test(html);
  if (!hasPasswordField) return false;

  const loginMarkers = [
    /تسجيل الدخول/,
    /تسجيل دخول/,
    /log\s*in/i,
    /sign\s*in/i,
    /\/users\/sign_in/,
    /\/log_?in/,
  ];
  return loginMarkers.some((re) => re.test(html));
}
