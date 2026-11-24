import type { CommandContext, CommandResult } from "../types/index.js";
import { LmsHttpClient } from "@qatar-edu/core";
import { createGenericPageInspection } from "@qatar-edu/core";
import { renderMonitorMarkdown } from "../exporters/monitor.exporter.js";
import { saveMarkdownReport } from "../exporters/markdown-writer.js";
import { buildMarkdownTable } from "../exporters/markdown-helpers.js";
import { sanitizeJsonValue, sanitizeText } from "@qatar-edu/core";

export interface MonitorCommandOptions {
  urls?: string[];
  selector?: string;
  noReport?: boolean;
}

export async function runMonitorCommand(
  ctx: CommandContext,
  options: MonitorCommandOptions,
): Promise<CommandResult> {
  const { urls = [], selector, noReport } = options;
  const defaultTarget = ctx.defaultClassId
    ? `${ctx.baseUrl}/student_assignments/list/${ctx.defaultClassId}`
    : `${ctx.baseUrl}/user_dashboard`;
  const targets = urls.length > 0 ? urls : [defaultTarget];

  const client = new LmsHttpClient(ctx.baseUrl, ctx.initialCookie, ctx.quiet);
  const inspections: ReturnType<typeof createGenericPageInspection>[] = [];

  const defaultSelector =
    selector || "#mainContent a, #mainContent h1, #mainContent h2, #mainContent li";

  if (!ctx.quiet) {
    console.log(`\n[Monitor] Inspecting ${targets.length} target(s)...`);
  }

  for (const targetUrl of targets) {
    const fullUrl = client.resolveUrl(targetUrl);
    const res = await client.request({
      method: "GET",
      pathOrUrl: fullUrl,
      referer: `${ctx.baseUrl}/user_dashboard`,
    });

    if (res.kind === "JSON") {
      if (!ctx.quiet) {
        try {
          const parsed = JSON.parse(res.body);
          console.log("[JSON Preview]:", sanitizeJsonValue(parsed));
        } catch {
          console.log("[JSON Preview]:", sanitizeText(res.body.slice(0, 500)));
        }
      }
    }

    const inspection = createGenericPageInspection(
      fullUrl,
      {
        status: res.status,
        statusText: res.statusText,
        contentType: res.contentType,
        kind: res.kind,
        elapsedMs: res.elapsedMs,
        location: res.location,
        body: res.body,
      },
      defaultSelector,
    );

    inspections.push(inspection);

    if (!ctx.quiet) {
      console.log(`\n--- Inspection: ${fullUrl} ---`);
      console.log(
        `[Status] ${inspection.status} ${inspection.statusText} | Kind: ${inspection.kind} | ${inspection.elapsedMs}ms`,
      );
      if (inspection.pageTitle) {
        console.log(`[Title] ${inspection.pageTitle}`);
      }
      if (inspection.mainHeading) {
        console.log(`[Heading] ${inspection.mainHeading}`);
      }
      console.log(
        `[Extracted] Elements: ${inspection.extractedElements.length}, Assignments: ${inspection.assignments.length}, Lessons: ${inspection.lessons.length}`,
      );

      if (inspection.assignments.length > 0) {
        console.log("[Assignments Found]:");
        const rows = inspection.assignments.map((a) => [
          a.kind,
          a.title,
          a.assignmentId ?? "—",
          a.href,
        ]);
        console.log(buildMarkdownTable(["Kind", "Title", "ID", "Href"], rows));
      }

      if (inspection.lessons.length > 0) {
        console.log("[Lessons Found]:");
        const rows = inspection.lessons.map((l) => [
          l.title,
          l.lessonId ?? "—",
          l.sections.length,
          l.href,
        ]);
        console.log(buildMarkdownTable(["Title", "ID", "Sections", "Href"], rows));
      }
    }
  }

  const commandFolder = "monitor";
  const writeReport = ctx.writeReport && !noReport;

  let reportPath: string | undefined;
  let latestReportPath: string | undefined;

  if (writeReport) {
    const markdown = renderMonitorMarkdown({
      targets,
      timestamp: new Date(),
      inspections,
      traces: client.traces,
      hasSession: client.cookieJar.hasRealCookies(),
    });

    const saved = await saveMarkdownReport({
      reportsDir: ctx.reportsDir,
      commandFolder,
      content: markdown,
    });
    reportPath = saved.timestampedPath;
    latestReportPath = saved.latestPath;
  }

  const summaryMessage = `Inspected ${inspections.length} endpoint(s).`;

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
