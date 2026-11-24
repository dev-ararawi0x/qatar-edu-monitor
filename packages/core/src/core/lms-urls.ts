export function extractQueryParam(href: string, key: string, baseUrl = "https://example.com"): string | null {
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

export function extractQuizIdFromShowUrl(urlOrPath: string): string | null {
  const match = urlOrPath.match(/\/student_quiz_assignment\/show\/(\d+)/);
  return match?.[1] ?? null;
}

export function extractQuizDisplayId(urlOrPath: string): string | null {
  const match = urlOrPath.match(/\/student_take_quiz_assignment\/display\/(\d+)/);
  return match?.[1] ?? null;
}

export function isQuizFinishUrl(pathOrUrl: string): boolean {
  try {
    const normalized = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, "https://example.com");
    return normalized.pathname.includes("/student_take_quiz_assignment/finish/");
  } catch {
    return pathOrUrl.includes("/student_take_quiz_assignment/finish/");
  }
}

export function isQuizShowUrl(pathOrUrl: string): boolean {
  return pathOrUrl.includes("/student_quiz_assignment/show/") || /^\d+$/.test(pathOrUrl.trim());
}

export function isQuizDisplayUrl(pathOrUrl: string): boolean {
  return pathOrUrl.includes("/student_take_quiz_assignment/display/");
}

export function buildAssignmentsListUrl(baseUrl: string, classId: string): string {
  return `${baseUrl}/student_assignments/list/${classId}`;
}

export function buildDashboardUrl(baseUrl: string): string {
  return `${baseUrl}/user_dashboard`;
}

export function buildStudentClassesUrl(baseUrl: string): string {
  return `${baseUrl}/student_classes`;
}

export function buildClassListsWidgetUrl(baseUrl: string): string {
  return `${baseUrl}/class_lists_widget/default_tab`;
}

const ALLOWED_LMS_HOST_PATTERN =
  /^(?:[a-z0-9-]+\.)*edu\.gov\.qa$/i;

/**
 * Validates that a user-supplied LMS base URL is HTTPS and points at an
 * allowed Qatar Education host (*.edu.gov.qa). Returns the normalized URL
 * (no trailing slash) or throws.
 */
export function validateAllowedLmsBaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`[Error] Invalid LMS base URL: "${rawUrl}".`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      "[Error] LMS base URL must use HTTPS for security.",
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_LMS_HOST_PATTERN.test(host)) {
    throw new Error(
      `[Error] LMS base URL host "${host}" is not an allowed Qatar Education domain (*.edu.gov.qa).`,
    );
  }
  return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
}

/**
 * Returns true when `candidateUrl` resolves to the same origin as `baseUrl`.
 * Used to restrict LMS image/link proxying to the configured LMS host only.
 */
export function isSameLmsOriginUrl(
  candidateUrl: string,
  baseUrl: string,
): boolean {
  try {
    const candidate = new URL(candidateUrl, baseUrl);
    const base = new URL(baseUrl);
    return candidate.origin === base.origin;
  } catch {
    return false;
  }
}

export function buildAssignmentsDueUrl(baseUrl: string, classId: string): string {
  return `${baseUrl}/student_assignments/due/${classId}`;
}

export function buildLessonsListUrl(baseUrl: string, classId: string): string {
  return `${baseUrl}/student_lessons/list/${classId}`;
}

export function buildQuizShowUrl(baseUrl: string, quizId: string | number): string {
  return `${baseUrl}/student_quiz_assignment/show/${quizId}`;
}

export function buildQuizDisplayUrl(
  quizId: string | number,
  part: number,
  resultsId: string | number,
  baseUrl: string,
): string {
  return `${baseUrl}/student_take_quiz_assignment/display/${quizId}?part=${part}&results=${resultsId}`;
}

export function buildQuizPauseUrl(
  quizId: string | number,
  resultsId: string | number,
  baseUrl: string,
): string {
  return `${baseUrl}/student_take_quiz_assignment/pause/${quizId}?results=${resultsId}`;
}
