export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractQueryParam(
  href: string,
  key: string,
  baseUrl = "https://qeducation.edu.gov.qa",
): string | null {
  try {
    const url = new URL(href, baseUrl);
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

export function extractAssignmentId(href: string): string | null {
  const match = href.match(
    /\/student_(?:quiz|offline)_assignment\/show\/(\d+)/,
  );
  return match?.[1] ?? null;
}

export function extractIdFromPath(
  href: string,
  pattern: RegExp,
): string | null {
  const match = href.match(pattern);
  return match?.[1] ?? null;
}
