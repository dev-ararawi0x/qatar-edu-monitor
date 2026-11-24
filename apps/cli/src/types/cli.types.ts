import type { LlmProviderConfig } from "@qatar-edu/core";

export interface GlobalCliOptions {
  help?: boolean;
  quiet?: boolean;
  report?: boolean;
  outDir?: string;
}

export interface CommandContext {
  baseUrl: string;
  defaultClassId: string;
  initialCookie: string;
  reportsDir: string;
  quiet: boolean;
  writeReport: boolean;
  outDir?: string;
  llm?: LlmProviderConfig;
}

export interface CommandResult {
  commandFolder: string;
  reportPath?: string;
  latestReportPath?: string;
  summaryMessage: string;
}
