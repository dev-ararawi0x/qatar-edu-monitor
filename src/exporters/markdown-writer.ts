import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatTimestamp } from "./markdown-helpers.js";

export interface SaveReportOptions {
  reportsDir: string;
  commandFolder: string;
  content: string;
  fileSlug?: string;
  writeLatest?: boolean;
}

export interface SavedReportPaths {
  timestampedPath: string;
  latestPath?: string;
}

export async function saveMarkdownReport(
  options: SaveReportOptions,
): Promise<SavedReportPaths> {
  const {
    reportsDir,
    commandFolder,
    content,
    fileSlug,
    writeLatest = true,
  } = options;

  const folderPath = path.join(reportsDir, commandFolder);
  await mkdir(folderPath, { recursive: true });

  const ts = formatTimestamp();
  const baseName = fileSlug ? `${fileSlug}_${ts}` : ts;
  const timestampedPath = path.join(folderPath, `${baseName}.md`);

  await writeFile(timestampedPath, content, "utf8");

  let latestPath: string | undefined;
  if (writeLatest) {
    latestPath = path.join(folderPath, "latest.md");
    await writeFile(latestPath, content, "utf8");
  }

  return {
    timestampedPath,
    ...(latestPath ? { latestPath } : {}),
  };
}
