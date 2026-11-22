import type { CommandContext, CommandResult, ParsedAssignment } from "../types/index.js";
import { LmsHttpClient } from "../core/http-client.js";
import {
  buildAssignmentsDueUrl,
  buildAssignmentsListUrl,
} from "../core/lms-urls.js";
import { parseAssignmentsHtml } from "../parsers/assignments.parser.js";
import { renderAssignmentsMarkdown } from "../exporters/assignments.exporter.js";
import { saveMarkdownReport } from "../exporters/markdown-writer.js";
import { buildMarkdownTable } from "../exporters/markdown-helpers.js";

export interface AssignmentsCommandOptions {
  mode: "list" | "due";
  classId?: string;
  url?: string;
  noReport?: boolean;
}

export async function runAssignmentsCommand(
  ctx: CommandContext,
  options: AssignmentsCommandOptions,
): Promise<CommandResult> {
  const { mode, classId, url: customUrl, noReport } = options;
  const effectiveClassId = classId || ctx.defaultClassId;

  if (!customUrl && !effectiveClassId) {
    throw new Error(
      "[Error] Missing class ID. Provide --class-id <id>, set LMS_CLASS_ID in .env, or pass --url <fullUrl>.",
    );
  }

  const targetUrl =
    customUrl ||
    (mode === "due"
      ? buildAssignmentsDueUrl(ctx.baseUrl, effectiveClassId)
      : buildAssignmentsListUrl(ctx.baseUrl, effectiveClassId));

  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);

  const res = await client.request({
    method: "GET",
    pathOrUrl: targetUrl,
    referer: `${ctx.baseUrl}/user_dashboard`,
  });

  if (res.status !== 200 || res.kind !== "HTML") {
    throw new Error(
      `[Error] Failed to fetch assignments page (${mode}). Status: ${res.status} ${res.statusText} (Kind: ${res.kind})`,
    );
  }

  const assignments: ParsedAssignment[] = parseAssignmentsHtml(res.body);
  const timestamp = new Date();
  const hasSession = client.cookieJar.hasRealCookies();

  if (!ctx.quiet) {
    console.log(`\n[${mode === "due" ? "Due Assignments" : "Assignments List"}] Found ${assignments.length} items:`);
    if (assignments.length > 0) {
      const tableRows = assignments.map((a) => [
        a.kind,
        a.title,
        a.assignmentId ?? "—",
        a.relatedLessonTitle ?? "—",
        a.href,
      ]);
      console.log(
        buildMarkdownTable(
          ["Kind", "Title", "ID", "Lesson", "Href"],
          tableRows,
        ),
      );
    }
  }

  const commandFolder = mode === "due" ? "assignments-due" : "assignments-list";
  const writeReport = ctx.writeReport && !noReport;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderAssignmentsMarkdown({
      mode,
      targetUrl,
      classId: effectiveClassId,
      timestamp,
      assignments,
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

  const summaryMessage = `Found ${assignments.length} ${mode === "due" ? "due " : ""}assignments.`;

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
