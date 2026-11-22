import type { CommandContext, CommandResult, ParsedLesson } from "../types/index.js";
import { LmsHttpClient } from "../core/http-client.js";
import { buildLessonsListUrl } from "../core/lms-urls.js";
import { parseLessonsHtml } from "../parsers/lessons.parser.js";
import { renderLessonsMarkdown } from "../exporters/lessons.exporter.js";
import { saveMarkdownReport } from "../exporters/markdown-writer.js";
import { buildMarkdownTable } from "../exporters/markdown-helpers.js";

export interface LessonsCommandOptions {
  classId?: string;
  url?: string;
  noReport?: boolean;
}

export async function runLessonsCommand(
  ctx: CommandContext,
  options: LessonsCommandOptions,
): Promise<CommandResult> {
  const { classId, url: customUrl, noReport } = options;
  const effectiveClassId = classId || ctx.defaultClassId;

  if (!customUrl && !effectiveClassId) {
    throw new Error(
      "[Error] Missing class ID. Provide --class-id <id>, set LMS_CLASS_ID in .env, or pass --url <fullUrl>.",
    );
  }

  const targetUrl =
    customUrl || buildLessonsListUrl(ctx.baseUrl, effectiveClassId);

  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);

  const res = await client.request({
    method: "GET",
    pathOrUrl: targetUrl,
    referer: `${ctx.baseUrl}/user_dashboard`,
  });

  if (res.status !== 200 || res.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch lessons page. Status: ${res.status} ${res.statusText} (Kind: ${res.kind})`,
    );
  }

  const lessons: ParsedLesson[] = parseLessonsHtml(res.body, effectiveClassId);
  const timestamp = new Date();
  const hasSession = client.cookieJar.hasRealCookies();

  if (!ctx.quiet) {
    console.log(`\n[Lessons List] Found ${lessons.length} lessons:`);
    if (lessons.length > 0) {
      const tableRows = lessons.map((l) => [
        l.title,
        l.lessonId ?? "—",
        l.sections.length,
        l.href,
      ]);
      console.log(
        buildMarkdownTable(
          ["Title", "Lesson ID", "Sections", "Href"],
          tableRows,
        ),
      );

      for (const lesson of lessons) {
        if (lesson.sections.length > 0) {
          console.log(`\nSections of "${lesson.title}":`);
          const sectionRows = lesson.sections.map((s) => [
            s.title,
            s.sectionId ?? "—",
            s.href,
          ]);
          console.log(
            buildMarkdownTable(
              ["Section Title", "Section ID", "Href"],
              sectionRows,
            ),
          );
        }
      }
    }
  }

  const commandFolder = "lessons-list";
  const writeReport = ctx.writeReport && !noReport;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderLessonsMarkdown({
      targetUrl,
      classId: effectiveClassId,
      timestamp,
      lessons,
      traces: client.traces,
      hasSession,
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const summaryMessage = `Found ${lessons.length} lessons.`;

  if (!ctx.quiet) {
    if (reportPath) {
      console.log(`\n[Report Saved] ${reportPath}`);
      if (latestReportPath) {
        console.log(`[Latest Report] ${latestReportPath}`);
      }
    }
    console.log(`[Summary] ${summaryMessage}`);
  }

  return {
    commandFolder,
    ...(reportPath ? { reportPath } : {}),
    ...(latestReportPath ? { latestReportPath } : {}),
    summaryMessage,
  };
}
