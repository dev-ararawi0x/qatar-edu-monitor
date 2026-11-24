import { parseArgs } from "node:util";
import type { CommandContext } from "../types/index.js";
import { loadAppConfig, buildCommandContext } from "../config.js";

export const COMMON_FLAGS = {
  help: { type: "boolean", short: "h", default: false },
  quiet: { type: "boolean", default: false },
  "no-report": { type: "boolean", default: false },
  "out-dir": { type: "string" },
} as const;

export const CLASS_SCOPED_FLAGS = {
  ...COMMON_FLAGS,
  "class-id": { type: "string" },
  url: { type: "string" },
} as const;

export const QUIZ_INSPECT_FLAGS = {
  ...COMMON_FLAGS,
  "results-id": { type: "string" },
  "start-new": { type: "boolean", default: false },
} as const;

export const QUIZ_SCAN_FLAGS = {
  ...CLASS_SCOPED_FLAGS,
  "start-new": { type: "boolean", default: false },
} as const;

export const QUIZ_DRAFT_FLAGS = {
  ...COMMON_FLAGS,
  answers: { type: "string" },
  apply: { type: "boolean", default: false },
  "no-pause": { type: "boolean", default: false },
  "allow-timed": { type: "boolean", default: false },
} as const;

export const QUIZ_SOLVE_FLAGS = {
  ...COMMON_FLAGS,
  provider: { type: "string" },
  model: { type: "string" },
  "fallback-models": { type: "string" },
  lang: { type: "string", default: "auto" },
  subject: { type: "string" },
  attach: { type: "string", multiple: true },
  "start-new": { type: "boolean", default: false },
  "allow-timed": { type: "boolean", default: false },
  apply: { type: "boolean", default: false },
  submit: { type: "boolean", default: false },
  "no-pause": { type: "boolean", default: false },
} as const;

export const MONITOR_FLAGS = {
  ...COMMON_FLAGS,
  selector: { type: "string" },
} as const;

type AnyFlags = Record<string, { type: "string" | "boolean"; short?: string; default?: string | boolean | string[] | boolean[]; multiple?: boolean }>;

export function parseFlags(args: string[], options: AnyFlags) {
  return parseArgs({ args, options, allowPositionals: true });
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function flag(value: unknown): boolean {
  return value === true;
}

export function createContext(values: {
  quiet?: unknown;
  "no-report"?: unknown;
  "out-dir"?: unknown;
}): CommandContext {
  const config = loadAppConfig();
  const outDir = str(values["out-dir"]);
  return buildCommandContext(config, {
    quiet: flag(values.quiet),
    writeReport: !flag(values["no-report"]),
    ...(outDir ? { outDir } : {}),
  });
}

export function printDone(
  ctx: CommandContext,
  summaryMessage: string,
  reportPath?: string,
): void {
  if (!ctx.quiet) {
    const reportLine = reportPath ? `Report: ${reportPath}` : "Report: disabled";
    console.log(`\n[Done] ${reportLine} — ${summaryMessage}`);
  }
}
