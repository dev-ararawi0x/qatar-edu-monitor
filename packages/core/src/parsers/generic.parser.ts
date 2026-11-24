import * as cheerio from "cheerio";
import type {
  ExtractedDomElement,
  GenericPageInspection,
  ParsedAssignment,
  ParsedLesson,
} from "../types/index.js";
import { parseAssignmentsHtml } from "./assignments.parser.js";
import { parseLessonsHtml } from "./lessons.parser.js";
import { parseQuizScreen, parseQuizShowPage } from "./quiz.parser.js";

export interface GenericHtmlParseResult {
  pageTitle: string;
  mainHeading: string;
  extractedElements: ExtractedDomElement[];
  assignments: ParsedAssignment[];
  lessons: ParsedLesson[];
  quizShowInfo?: ReturnType<typeof parseQuizShowPage>;
  quizScreen?: ReturnType<typeof parseQuizScreen>;
}

export function parseGenericHtmlPage(
  html: string,
  itemSelector = "#mainContent a, #mainContent h1, #mainContent h2, #mainContent li",
): GenericHtmlParseResult {
  const $ = cheerio.load(html);
  const pageTitle = $("title").text().trim();
  const mainHeading = $("#mainContent h1, .section_header_wrap h1")
    .first()
    .text()
    .trim();

  const extractedElements: ExtractedDomElement[] = [];
  $(itemSelector).each((_, el) => {
    if (el.type !== "tag") return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;

    const href = $(el).attr("href");
    extractedElements.push({
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 120),
      ...(href ? { href } : {}),
    });
  });

  const assignments = parseAssignmentsHtml(html);
  const lessons = parseLessonsHtml(html);

  const hasQuizShow = html.includes("/student_take_quiz_assignment/") || html.includes("student_quiz_assignment");
  const hasQuizForm = html.includes("#question_form") || html.includes("quiz_question");

  let quizShowInfo: ReturnType<typeof parseQuizShowPage> | undefined;
  let quizScreen: ReturnType<typeof parseQuizScreen> | undefined;

  if (hasQuizShow) {
    quizShowInfo = parseQuizShowPage(html);
  }

  if (hasQuizForm) {
    quizScreen = parseQuizScreen(html);
  }

  return {
    pageTitle,
    mainHeading,
    extractedElements,
    assignments,
    lessons,
    ...(quizShowInfo ? { quizShowInfo } : {}),
    ...(quizScreen ? { quizScreen } : {}),
  };
}

export function createGenericPageInspection(
  url: string,
  response: {
    status: number;
    statusText: string;
    contentType: string;
    kind: "Redirect" | "JSON" | "HTML" | "Other";
    elapsedMs: number;
    location?: string | null;
    body: string;
  },
  itemSelector?: string,
): GenericPageInspection {
  const parsed: GenericHtmlParseResult =
    response.kind === "HTML"
      ? parseGenericHtmlPage(response.body, itemSelector)
      : {
          pageTitle: "",
          mainHeading: "",
          extractedElements: [],
          assignments: [],
          lessons: [],
        };

  return {
    url,
    status: response.status,
    statusText: response.statusText,
    contentType: response.contentType,
    kind: response.kind,
    elapsedMs: response.elapsedMs,
    ...(response.location ? { location: response.location } : {}),
    ...(parsed.pageTitle ? { pageTitle: parsed.pageTitle } : {}),
    ...(parsed.mainHeading ? { mainHeading: parsed.mainHeading } : {}),
    extractedElements: parsed.extractedElements,
    assignments: parsed.assignments,
    lessons: parsed.lessons,
    ...(parsed.quizShowInfo ? { quizShowInfo: parsed.quizShowInfo } : {}),
    ...(parsed.quizScreen ? { quizScreen: parsed.quizScreen } : {}),
  };
}
