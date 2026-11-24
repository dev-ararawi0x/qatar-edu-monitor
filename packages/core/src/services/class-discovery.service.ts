import type { LmsHttpClient } from "../core/http-client.js";
import {
  buildClassListsWidgetUrl,
  buildDashboardUrl,
  buildStudentClassesUrl,
} from "../core/lms-urls.js";
import {
  extractClassWidgetCellIds,
  extractMetaCsrfToken,
  hasClassWidgetContent,
  isLoginPageHtml,
  parseClassesHtml,
} from "../parsers/classes.parser.js";
import type {
  LmsSessionCheckResult,
  ParsedClass,
} from "../types/index.js";

const LOGIN_PATH_PATTERN = /\/(?:log_?in|sign_?in|users\/sign_in)/i;

// Fallback cell_id candidates when the dashboard HTML does not expose one.
// "enrolled" mirrors widget_classes_initiate('enrolled', 'tile'); the widget
// type names cover LMS versions that key cells by widget name.
const FALLBACK_CELL_IDS = [
  "enrolled",
  "ClassListsWidget",
  "class_lists_widget",
];

/**
 * Verifies whether the LMS session carried by `client` is still valid by
 * fetching the user dashboard and checking for login redirects/pages.
 */
export async function verifyLmsSession(
  client: LmsHttpClient,
): Promise<LmsSessionCheckResult> {
  const dashboardUrl = buildDashboardUrl(client.baseUrl);
  const res = await client.request({
    method: "GET",
    pathOrUrl: dashboardUrl,
    referer: `${client.baseUrl}/`,
  });

  const redirectedToLogin = Boolean(
    res.location && LOGIN_PATH_PATTERN.test(res.location),
  );
  const isLoginPage =
    res.kind === "HTML" && isLoginPageHtml(res.body);
  const valid =
    res.status === 200 &&
    res.kind === "HTML" &&
    !redirectedToLogin &&
    !isLoginPage;

  return {
    valid,
    status: res.status,
    redirectedToLogin: redirectedToLogin || isLoginPage,
    finalUrl: client.resolveUrl(res.location ?? dashboardUrl),
  };
}

/**
 * POSTs to the class-lists widget endpoint until a response containing class
 * tiles is returned. Tries cell ids extracted from the dashboard first, then
 * known fallback identifiers. Returns null when nothing works.
 */
async function fetchClassListsWidgetHtml(
  client: LmsHttpClient,
  dashboardHtml: string,
  referer: string,
): Promise<string | null> {
  const cellIds = [
    ...new Set([
      ...extractClassWidgetCellIds(dashboardHtml),
      ...FALLBACK_CELL_IDS,
    ]),
  ];
  const csrfToken = extractMetaCsrfToken(dashboardHtml);

  for (const cellId of cellIds) {
    const res = await client.request({
      method: "POST",
      pathOrUrl: buildClassListsWidgetUrl(client.baseUrl),
      referer,
      isAjax: true,
      ...(csrfToken ? { csrfHeaderToken: csrfToken } : {}),
      formFields: {
        utf8: "✓",
        ...(csrfToken ? { authenticity_token: csrfToken } : {}),
        cell_id: cellId,
      },
    });
    if (
      res.status === 200 &&
      res.kind === "HTML" &&
      hasClassWidgetContent(res.body)
    ) {
      return res.body;
    }
  }
  return null;
}

function mergeClasses(
  primary: ParsedClass[],
  secondary: ParsedClass[],
): ParsedClass[] {
  const merged = new Map<string, ParsedClass>();
  for (const item of [...primary, ...secondary]) {
    const existing = merged.get(item.classId);
    if (!existing) {
      merged.set(item.classId, item);
      continue;
    }
    // First (primary) entry wins title/href; fill only missing fields.
    if (!existing.teacherName && item.teacherName) {
      existing.teacherName = item.teacherName;
    }
    if (existing.courseCode === undefined && item.courseCode !== undefined) {
      existing.courseCode = item.courseCode;
    }
    if (
      existing.dueAssignmentsCount === undefined &&
      item.dueAssignmentsCount !== undefined
    ) {
      existing.dueAssignmentsCount = item.dueAssignmentsCount;
    }
    if (existing.lessonCount === undefined && item.lessonCount !== undefined) {
      existing.lessonCount = item.lessonCount;
    }
  }
  return Array.from(merged.values());
}

/**
 * Discovers the student's enrolled subjects/classes. The dashboard loads the
 * class list via an AJAX widget (POST /class_lists_widget/default_tab), so we
 * fetch that widget first and fall back to parsing the dashboard HTML and the
 * dedicated classes page. Throws a descriptive error when the session is
 * expired so callers can prompt the user to refresh cookies.
 */
export async function discoverEnrolledClasses(
  client: LmsHttpClient,
): Promise<ParsedClass[]> {
  const session = await verifyLmsSession(client);
  if (!session.valid) {
    throw new Error(
      "[LMS Session Expired] The stored LMS cookies are invalid or expired. Please update your session cookie in Settings and try again.",
    );
  }

  const dashboardUrl = buildDashboardUrl(client.baseUrl);
  const dashboardRes = await client.request({
    method: "GET",
    pathOrUrl: dashboardUrl,
    referer: `${client.baseUrl}/`,
  });
  const dashboardHtml =
    dashboardRes.kind === "HTML" ? dashboardRes.body : "";

  // 1) Authoritative source: the class-lists widget endpoint.
  let classes: ParsedClass[] = [];
  if (dashboardHtml) {
    const widgetHtml = await fetchClassListsWidgetHtml(
      client,
      dashboardHtml,
      dashboardUrl,
    );
    if (widgetHtml) {
      classes = parseClassesHtml(widgetHtml);
    }
  }

  // 2) Secondary: whatever class links the dashboard HTML itself contains.
  if (dashboardHtml) {
    classes = mergeClasses(
      classes,
      parseClassesHtml(dashboardHtml),
    );
  }

  // 3) Fallback: dedicated classes listing page (some LMS versions expose it)
  if (classes.length === 0) {
    const classesRes = await client.request({
      method: "GET",
      pathOrUrl: buildStudentClassesUrl(client.baseUrl),
      referer: dashboardUrl,
    });
    if (classesRes.status === 200 && classesRes.kind === "HTML") {
      classes = parseClassesHtml(classesRes.body);
    }
  }

  return classes.sort((a, b) => a.title.localeCompare(b.title, "ar"));
}
