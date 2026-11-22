#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadAppConfig, buildCommandContext } from "./core/config.js";
import { runAssignmentsCommand } from "./commands/assignments.command.js";
import { runLessonsCommand } from "./commands/lessons.command.js";
import {
  runQuizDraftCommand,
  runQuizInspectCommand,
  runQuizScanCommand,
} from "./commands/quiz.command.js";
import { runMonitorCommand } from "./commands/monitor.command.js";

const HELP_TEXT = `
Qatar Education LMS CLI Monitor (qatar-edu-monitor)

Usage:
  npx tsx src/cli.ts <command> [subcommand] [options]

Commands:
  assignments list --class-id <id> | --url <url> [options]
                                   List all assignments for a class (GET only)
  assignments due --class-id <id> | --url <url> [options]
                                   List due assignments / quizzes for a class (GET only)
  lessons list --class-id <id> | --url <url> [options]
                                   List lessons and sections for a class (GET only)
  quiz inspect <url-or-id> [opts]  Inspect quiz questions & details read-only (GET only)
  quiz scan --class-id <id> | --url <url> [options]
                                   Scan due quizzes and inspect open/resumed attempts (GET only)
  quiz draft <display-url> [opts]  Preview or save quiz drafts + pause (Dry-run by default, /finish BLOCKED)
  monitor [urls...] [options]      Inspect HTTP responses & auto-detect LMS entities (GET only)

Global Options:
  --help, -h                       Show help message
  --quiet                          Suppress verbose per-request HTTP logs
  --no-report                      Skip saving Markdown reports to disk
  --out-dir <path>                 Override default reports directory

Safety Guardrails:
  - Read-only GET by default across inspect, scan, and monitor commands.
  - New quiz attempts are skipped by default; pass --start-new to opt in.
  - quiz draft runs in dry-run mode by default; pass --apply to send draft POSTs + /pause/.
  - Requests to /student_take_quiz_assignment/finish/ are strictly blocked at transport level.
  - All cookies, CSRF tokens, and secrets are masked as "VALUES".
`;

function printSubcommandHelp(cmd: string) {
  switch (cmd) {
    case "assignments":
      console.log(`
Usage:
  npx tsx src/cli.ts assignments list --class-id <id> [options]
  npx tsx src/cli.ts assignments list --url <fullUrl> [options]
  npx tsx src/cli.ts assignments due --class-id <id> [options]
  npx tsx src/cli.ts assignments due --url <fullUrl> [options]

Options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full assignments URL (overrides --class-id)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`);
      break;
    case "lessons":
      console.log(`
Usage:
  npx tsx src/cli.ts lessons list --class-id <id> [options]
  npx tsx src/cli.ts lessons list --url <fullUrl> [options]

Options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full lessons URL (overrides --class-id)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`);
      break;
    case "quiz":
      console.log(`
Usage:
  npx tsx src/cli.ts quiz inspect <showUrl|displayUrl|quizId> [options]
  npx tsx src/cli.ts quiz scan --class-id <id> [options]
  npx tsx src/cli.ts quiz scan --url <fullUrl> [options]
  npx tsx src/cli.ts quiz draft <displayUrl> [options]

quiz inspect options:
  --results-id <id>  Attempt results ID (if inspecting display URL directly)
  --start-new        Opt-in to inspect newly started attempts (GET only)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners

quiz scan options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full due assignments URL (overrides --class-id)
  --start-new        Opt-in to inspect newly started attempts (GET only)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners

quiz draft options:
  --answers <json>   JSON string or @path/to/file.json mapping part numbers to answers (e.g. {"1":"..."})
  --apply            Actually send draft POSTs + /pause/ (default is safe dry-run)
  --no-pause         Do not call /pause/ after --apply
  --allow-timed      Allow running on timed quizzes (timed_quiz=true)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
`);
      break;
    case "monitor":
      console.log(`
Usage:
  npx tsx src/cli.ts monitor [url1 url2 ...] [options]

Options:
  --selector <css>   Custom CSS selector for DOM extraction (default: "#mainContent a, h1, h2, li")
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`);
      break;
    default:
      console.log(HELP_TEXT);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || (rawArgs.length === 1 && (rawArgs[0] === "--help" || rawArgs[0] === "-h"))) {
    console.log(HELP_TEXT);
    return;
  }

  const command = rawArgs[0];

  if (command === "assignments" || command === "lessons") {
    const subArgs = rawArgs.slice(1);
    const subcommand = subArgs[0];

    if (!subcommand || subcommand === "--help" || subcommand === "-h" || subArgs.includes("--help") || subArgs.includes("-h")) {
      printSubcommandHelp(command);
      return;
    }

    if (command === "assignments" && (subcommand === "list" || subcommand === "due")) {
      const { values } = parseArgs({
        args: subArgs.slice(1),
        options: {
          "class-id": { type: "string" },
          url: { type: "string" },
          "no-report": { type: "boolean", default: false },
          quiet: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
          "out-dir": { type: "string" },
        },
        allowPositionals: true,
      });

      if (values.help) {
        printSubcommandHelp("assignments");
        return;
      }

      const config = loadAppConfig();
      const ctx = buildCommandContext(config, {
        quiet: values.quiet ?? false,
        writeReport: !(values["no-report"] ?? false),
        ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
      });

      const result = await runAssignmentsCommand(ctx, {
        mode: subcommand as "list" | "due",
        ...(values["class-id"] ? { classId: values["class-id"] } : {}),
        ...(values.url ? { url: values.url } : {}),
        noReport: values["no-report"] ?? false,
      });

      if (!ctx.quiet) {
        console.log(`\n[Done] ${result.summaryMessage}`);
      }
      return;
    }

    if (command === "lessons" && subcommand === "list") {
      const { values } = parseArgs({
        args: subArgs.slice(1),
        options: {
          "class-id": { type: "string" },
          url: { type: "string" },
          "no-report": { type: "boolean", default: false },
          quiet: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
          "out-dir": { type: "string" },
        },
        allowPositionals: true,
      });

      if (values.help) {
        printSubcommandHelp("lessons");
        return;
      }

      const config = loadAppConfig();
      const ctx = buildCommandContext(config, {
        quiet: values.quiet ?? false,
        writeReport: !(values["no-report"] ?? false),
        ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
      });

      const result = await runLessonsCommand(ctx, {
        ...(values["class-id"] ? { classId: values["class-id"] } : {}),
        ...(values.url ? { url: values.url } : {}),
        noReport: values["no-report"] ?? false,
      });

      if (!ctx.quiet) {
        console.log(`\n[Done] ${result.summaryMessage}`);
      }
      return;
    }

    printSubcommandHelp(command);
    return;
  }

  if (command === "quiz") {
    const subcommand = rawArgs[1];

    if (!subcommand || subcommand === "--help" || subcommand === "-h" || rawArgs.includes("--help") || rawArgs.includes("-h")) {
      printSubcommandHelp("quiz");
      return;
    }

    if (subcommand === "inspect") {
      const { values, positionals } = parseArgs({
        args: rawArgs.slice(2),
        options: {
          "results-id": { type: "string" },
          "start-new": { type: "boolean", default: false },
          "no-report": { type: "boolean", default: false },
          quiet: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
          "out-dir": { type: "string" },
        },
        allowPositionals: true,
      });

      if (values.help) {
        printSubcommandHelp("quiz");
        return;
      }

      const targetOrUrl = positionals[0];
      if (!targetOrUrl) {
        console.error("[Error] Missing required argument: <showUrl|displayUrl|quizId>");
        printSubcommandHelp("quiz");
        process.exitCode = 1;
        return;
      }

      const config = loadAppConfig();
      const ctx = buildCommandContext(config, {
        quiet: values.quiet ?? false,
        writeReport: !(values["no-report"] ?? false),
        ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
      });

      const result = await runQuizInspectCommand(ctx, {
        targetOrUrl,
        ...(values["results-id"] ? { resultsId: values["results-id"] } : {}),
        startNew: values["start-new"] ?? false,
        noReport: values["no-report"] ?? false,
      });

      if (!ctx.quiet) {
        console.log(`\n[Done] ${result.summaryMessage}`);
      }
      return;
    }

    if (subcommand === "scan") {
      const { values } = parseArgs({
        args: rawArgs.slice(2),
        options: {
          "class-id": { type: "string" },
          url: { type: "string" },
          "start-new": { type: "boolean", default: false },
          "no-report": { type: "boolean", default: false },
          quiet: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
          "out-dir": { type: "string" },
        },
        allowPositionals: true,
      });

      if (values.help) {
        printSubcommandHelp("quiz");
        return;
      }

      const config = loadAppConfig();
      const ctx = buildCommandContext(config, {
        quiet: values.quiet ?? false,
        writeReport: !(values["no-report"] ?? false),
        ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
      });

      const result = await runQuizScanCommand(ctx, {
        ...(values["class-id"] ? { classId: values["class-id"] } : {}),
        ...(values.url ? { url: values.url } : {}),
        startNew: values["start-new"] ?? false,
        noReport: values["no-report"] ?? false,
      });

      if (!ctx.quiet) {
        console.log(`\n[Done] ${result.summaryMessage}`);
      }
      return;
    }

    if (subcommand === "draft") {
      const { values, positionals } = parseArgs({
        args: rawArgs.slice(2),
        options: {
          answers: { type: "string" },
          apply: { type: "boolean", default: false },
          "no-pause": { type: "boolean", default: false },
          "allow-timed": { type: "boolean", default: false },
          "no-report": { type: "boolean", default: false },
          quiet: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
          "out-dir": { type: "string" },
        },
        allowPositionals: true,
      });

      if (values.help) {
        printSubcommandHelp("quiz");
        return;
      }

      const displayUrl = positionals[0];
      if (!displayUrl) {
        console.error("[Error] Missing required argument: <displayUrl>");
        printSubcommandHelp("quiz");
        process.exitCode = 1;
        return;
      }

      const config = loadAppConfig();
      const ctx = buildCommandContext(config, {
        quiet: values.quiet ?? false,
        writeReport: !(values["no-report"] ?? false),
        ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
      });

      const result = await runQuizDraftCommand(ctx, {
        displayUrl,
        ...(values.answers ? { answers: values.answers } : {}),
        apply: values.apply ?? false,
        noPause: values["no-pause"] ?? false,
        allowTimed: values["allow-timed"] ?? false,
        noReport: values["no-report"] ?? false,
      });

      if (!ctx.quiet) {
        console.log(`\n[Done] ${result.summaryMessage}`);
      }
      return;
    }

    printSubcommandHelp("quiz");
    return;
  }

  if (command === "monitor") {
    const { values, positionals } = parseArgs({
      args: rawArgs.slice(1),
      options: {
        selector: { type: "string" },
        "no-report": { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        "out-dir": { type: "string" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      printSubcommandHelp("monitor");
      return;
    }

    const config = loadAppConfig();
    const ctx = buildCommandContext(config, {
      quiet: values.quiet ?? false,
      writeReport: !(values["no-report"] ?? false),
      ...(values["out-dir"] ? { outDir: values["out-dir"] } : {}),
    });

    const result = await runMonitorCommand(ctx, {
      urls: positionals,
      ...(values.selector ? { selector: values.selector } : {}),
      noReport: values["no-report"] ?? false,
    });

    if (!ctx.quiet) {
      console.log(`\n[Done] ${result.summaryMessage}`);
    }
    return;
  }

  console.error(`[Error] Unknown command: ${command}`);
  console.log(HELP_TEXT);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n[Fatal CLI Error]", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
