import { runAssignmentsCommand } from "../commands/assignments.command.js";
import { runLessonsCommand } from "../commands/lessons.command.js";
import {
  runQuizInspectCommand,
  runQuizScanCommand,
  runQuizDraftCommand,
  runQuizSolveCommand,
} from "../commands/quiz.command.js";
import type { LanguagePreference } from "../types/index.js";
import { runMonitorCommand } from "../commands/monitor.command.js";
import { printHelp } from "./help.js";
import {
  CLASS_SCOPED_FLAGS,
  MONITOR_FLAGS,
  QUIZ_DRAFT_FLAGS,
  QUIZ_INSPECT_FLAGS,
  QUIZ_SCAN_FLAGS,
  QUIZ_SOLVE_FLAGS,
  createContext,
  flag,
  parseFlags,
  printDone,
  str,
} from "./flags.js";

export async function handleAssignments(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp("assignments");
    return;
  }
  if (subcommand !== "list" && subcommand !== "due") {
    console.error(`Unknown assignments subcommand: ${subcommand}`);
    printHelp("assignments");
    process.exitCode = 1;
    return;
  }

  const { values } = parseFlags(rest, CLASS_SCOPED_FLAGS);
  if (flag(values.help)) {
    printHelp("assignments");
    return;
  }

  const ctx = createContext(values);
  const classId = str(values["class-id"]);
  const url = str(values.url);

  const result = await runAssignmentsCommand(ctx, {
    mode: subcommand,
    ...(classId ? { classId } : {}),
    ...(url ? { url } : {}),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

export async function handleLessons(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp("lessons");
    return;
  }
  if (subcommand !== "list") {
    console.error(`Unknown lessons subcommand: ${subcommand}`);
    printHelp("lessons");
    process.exitCode = 1;
    return;
  }

  const { values } = parseFlags(rest, CLASS_SCOPED_FLAGS);
  if (flag(values.help)) {
    printHelp("lessons");
    return;
  }

  const ctx = createContext(values);
  const classId = str(values["class-id"]);
  const url = str(values.url);

  const result = await runLessonsCommand(ctx, {
    ...(classId ? { classId } : {}),
    ...(url ? { url } : {}),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

export async function handleQuiz(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp("quiz");
    return;
  }
  switch (subcommand) {
    case "inspect":
      return handleQuizInspect(rest);
    case "scan":
      return handleQuizScan(rest);
    case "draft":
      return handleQuizDraft(rest);
    case "solve":
      return handleQuizSolve(rest);
    default:
      console.error(`Unknown quiz subcommand: ${subcommand}`);
      printHelp("quiz");
      process.exitCode = 1;
  }
}

async function handleQuizInspect(args: string[]): Promise<void> {
  const { values, positionals } = parseFlags(args, QUIZ_INSPECT_FLAGS);
  if (flag(values.help)) {
    printHelp("quiz");
    return;
  }

  const target = positionals[0];
  if (!target) {
    console.error("Error: quiz inspect requires <showUrl|displayUrl|quizId>");
    printHelp("quiz");
    process.exitCode = 1;
    return;
  }

  const ctx = createContext(values);
  const resultsId = str(values["results-id"]);

  const result = await runQuizInspectCommand(ctx, {
    targetOrUrl: target,
    ...(resultsId ? { resultsId } : {}),
    startNew: flag(values["start-new"]),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

async function handleQuizScan(args: string[]): Promise<void> {
  const { values } = parseFlags(args, QUIZ_SCAN_FLAGS);
  if (flag(values.help)) {
    printHelp("quiz");
    return;
  }

  const ctx = createContext(values);
  const classId = str(values["class-id"]);
  const url = str(values.url);

  const result = await runQuizScanCommand(ctx, {
    ...(classId ? { classId } : {}),
    ...(url ? { url } : {}),
    startNew: flag(values["start-new"]),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

async function handleQuizDraft(args: string[]): Promise<void> {
  const { values, positionals } = parseFlags(args, QUIZ_DRAFT_FLAGS);
  if (flag(values.help)) {
    printHelp("quiz");
    return;
  }

  const displayUrl = positionals[0];
  if (!displayUrl) {
    console.error("Error: quiz draft requires <displayUrl>");
    printHelp("quiz");
    process.exitCode = 1;
    return;
  }

  const answersRaw = str(values.answers);
  const ctx = createContext(values);
  const result = await runQuizDraftCommand(ctx, {
    displayUrl,
    ...(answersRaw ? { answers: answersRaw } : {}),
    apply: flag(values.apply),
    noPause: flag(values["no-pause"]),
    allowTimed: flag(values["allow-timed"]),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

async function handleQuizSolve(args: string[]): Promise<void> {
  const { values, positionals } = parseFlags(args, QUIZ_SOLVE_FLAGS);
  if (flag(values.help)) {
    printHelp("quiz");
    return;
  }

  const targetOrUrl = positionals[0];
  if (!targetOrUrl) {
    console.error("Error: quiz solve requires <showUrl|displayUrl|quizId>");
    printHelp("quiz");
    process.exitCode = 1;
    return;
  }

  const rawLang = (str(values.lang) ?? "auto").toLowerCase();
  if (rawLang !== "auto" && rawLang !== "ar" && rawLang !== "en") {
    console.error(`[Error] Invalid --lang "${values.lang}". Expected: auto | ar | en`);
    process.exitCode = 1;
    return;
  }

  const ctx = createContext(values);
  const provider = str(values.provider);
  const model = str(values.model);
  const fallbackModels = str(values["fallback-models"]);
  const subject = str(values.subject);
  const attachments = Array.isArray(values.attach)
    ? values.attach.filter((a): a is string => typeof a === "string")
    : [];
  const result = await runQuizSolveCommand(ctx, {
    targetOrUrl,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(fallbackModels ? { fallbackModels } : {}),
    lang: rawLang as LanguagePreference,
    ...(subject ? { subject } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    startNew: flag(values["start-new"]),
    allowTimed: flag(values["allow-timed"]),
    apply: flag(values.apply),
    submit: flag(values.submit),
    noPause: flag(values["no-pause"]),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}

export async function handleMonitor(args: string[]): Promise<void> {
  const { values, positionals } = parseFlags(args, MONITOR_FLAGS);
  if (flag(values.help)) {
    printHelp("monitor");
    return;
  }

  const ctx = createContext(values);
  const selector = str(values.selector);

  const result = await runMonitorCommand(ctx, {
    ...(positionals.length > 0 ? { urls: positionals } : {}),
    ...(selector ? { selector } : {}),
    noReport: flag(values["no-report"]),
  });

  printDone(ctx, result.summaryMessage, result.reportPath);
}
