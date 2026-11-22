export function escapeMarkdownCell(text: string | undefined | null): string {
  if (!text) return "—";
  return text
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMarkdownTable(
  headers: string[],
  rows: Array<Array<string | number | boolean | undefined | null>>,
): string {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map(
    (row) => `| ${row.map((cell) => escapeMarkdownCell(String(cell ?? "—"))).join(" | ")} |`,
  );
  return [headerLine, separator, ...bodyLines].join("\n");
}

export function buildMetadataTable(
  entries: Array<{ label: string; value: string | number | boolean | undefined | null }>,
): string {
  return buildMarkdownTable(
    ["البند", "القيمة"],
    entries.map((e) => [e.label, e.value ?? "—"]),
  );
}

export function buildSectionHeading(level: number, title: string): string {
  const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
  return `${hashes} ${title}`;
}

export function buildBadge(text: string, variant: "success" | "warning" | "danger" | "info" = "info"): string {
  return `**[${text}]**`;
}

export function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function formatIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function sanitizeUrlForMarkdown(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}
