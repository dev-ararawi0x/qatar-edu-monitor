import test from "node:test";
import assert from "node:assert/strict";
import { LmsHttpClient } from "../src/core/http-client.js";
import { discoverEnrolledClasses } from "../src/services/class-discovery.service.js";

const BASE = "https://qeducation.edu.gov.qa";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const DASHBOARD_HTML = `
  <html><head><meta name="csrf-token" content="csrftok123"></head><body>
    <div class="dashboard-cell" id="cell_77"><div id="ClassListsWidget"></div></div>
  </body></html>`;

const WIDGET_HTML = `
  <div class="swiper-wrapper catalog_boxes catalog_student">
    <div id="614062" data-activity="class_activity_614062">
      <div class="header">
        <a href="/student_class/show/614062">
          <h3 class="class_name">11/4 الحوسبة وتكنولوجيا المعلومات</h3>
          <div class="lightText"><span title='رمز المقرر الدراسي'><span class='textOffScreen'>رمز المقرر الدراسي</span> S1-02600701-11 </span></div>
        </a>
      </div>
      <div class="footer flex_footer">
        <a class="block" title="التقييمات المستحقة" href="/student_assignments/due/614062"><i class='pageBlank icnColor'><span>12</span></i></a>
        <div class="label">14 الدروس</div>
      </div>
    </div>
    <div id="648265" data-activity="class_activity_648265">
      <div class="header">
        <a href="/student_class/show/648265">
          <h3 class="class_name">English 11/5</h3>
        </a>
      </div>
      <div class="footer flex_footer">
        <a class="block" title="لا توجد تقييمات مستحقة" href="/student_assignments/list/648265"><i class='pageBlank'></i></a>
        <div class="label">6 الدروس</div>
      </div>
    </div>
  </div>`;

function makeClient(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  return new LmsHttpClient(BASE, "lms_session_v1=x", true, undefined, fetchImpl);
}

test("discoverEnrolledClasses POSTs the class widget and parses tiles", async () => {
  const posts: { url: string; body: string; csrf: string | undefined }[] = [];
  const client = makeClient((url, init) => {
    if (init?.method === "POST" && url.includes("/class_lists_widget/default_tab")) {
      const headers = new Headers(init.headers);
      posts.push({
        url,
        body: String(init.body ?? ""),
        csrf: headers.get("X-CSRF-Token") ?? undefined,
      });
      return htmlResponse(WIDGET_HTML);
    }
    if (url.includes("/user_dashboard")) return htmlResponse(DASHBOARD_HTML);
    return htmlResponse("<html></html>");
  });

  const classes = await discoverEnrolledClasses(client);

  assert.ok(posts.length >= 1, "expected at least one widget POST");
  assert.ok(posts[0]?.body.includes("cell_id=77"), `body was: ${posts[0]?.body}`);
  assert.equal(posts[0]?.csrf, "csrftok123");

  assert.equal(classes.length, 2);
  const computing = classes.find((c) => c.classId === "614062");
  assert.ok(computing);
  assert.equal(computing?.title, "11/4 الحوسبة وتكنولوجيا المعلومات");
  assert.equal(computing?.courseCode, "S1-02600701-11");
  assert.equal(computing?.dueAssignmentsCount, 12);
  assert.equal(computing?.lessonCount, 14);

  const english = classes.find((c) => c.classId === "648265");
  assert.ok(english);
  assert.equal(english?.dueAssignmentsCount, 0);
});

test("discoverEnrolledClasses falls back to dashboard anchors when widget fails", async () => {
  const dashboardWithLinks = `
    <html><head><meta name="csrf-token" content="t"></head><body>
      <div id="cell_1"></div>
      <a href="/student_assignments/list/999">مادة تجريبية</a>
    </body></html>`;

  const client = makeClient((url, init) => {
    if (init?.method === "POST" && url.includes("/class_lists_widget/")) {
      return htmlResponse("<html>no widget</html>");
    }
    if (url.includes("/user_dashboard")) return htmlResponse(dashboardWithLinks);
    if (url.includes("/student_classes")) return htmlResponse("<html></html>");
    return htmlResponse("<html></html>");
  });

  const classes = await discoverEnrolledClasses(client);
  assert.equal(classes.length, 1);
  assert.equal(classes[0]?.classId, "999");
  assert.equal(classes[0]?.title, "مادة تجريبية");
});

test("discoverEnrolledClasses throws when the session is expired", async () => {
  const client = makeClient((url) => {
    if (url.includes("/user_dashboard")) {
      return new Response(null, {
        status: 302,
        headers: { location: "/users/sign_in" },
      });
    }
    return htmlResponse("<html></html>");
  });

  await assert.rejects(
    () => discoverEnrolledClasses(client),
    /LMS Session Expired/,
  );
});
