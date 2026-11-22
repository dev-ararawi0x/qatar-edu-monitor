import "dotenv/config";
import path from "node:path";
import type { CommandContext } from "../types/index.js";

export interface AppConfig {
  baseUrl: string;
  defaultClassId: string;
  initialCookie: string;
  reportsDir: string;
}

export function loadAppConfig(): AppConfig {
  const baseUrl = (process.env.LMS_BASE_URL || "https://qeducation.edu.gov.qa").replace(/\/$/, "");
  const defaultClassId = process.env.LMS_CLASS_ID || "";
  const initialCookie = process.env.LMS_COOKIE || "VALUES";
  const reportsDir = process.env.REPORTS_DIR
    ? path.resolve(process.env.REPORTS_DIR)
    : path.resolve(process.cwd(), "reports");

  return {
    baseUrl,
    defaultClassId,
    initialCookie,
    reportsDir,
  };
}

export function buildCommandContext(
  config: AppConfig,
  overrides?: Partial<{
    quiet: boolean;
    writeReport: boolean;
    outDir?: string;
  }>,
): CommandContext {
  const reportsDir = overrides?.outDir
    ? path.resolve(overrides.outDir)
    : config.reportsDir;

  return {
    baseUrl: config.baseUrl,
    defaultClassId: config.defaultClassId,
    initialCookie: config.initialCookie,
    reportsDir,
    quiet: overrides?.quiet ?? false,
    writeReport: overrides?.writeReport ?? true,
    ...(overrides?.outDir ? { outDir: path.resolve(overrides.outDir) } : {}),
  };
}
