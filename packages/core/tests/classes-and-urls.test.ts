import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameLmsOriginUrl,
  validateAllowedLmsBaseUrl,
} from "../src/core/lms-urls.js";
import { SessionCookieJar } from "../src/core/cookie-jar.js";
import {
  extractClassWidgetCellIds,
  isLoginPageHtml,
  parseClassesHtml,
} from "../src/parsers/classes.parser.js";

test("parseClassesHtml extracts enrolled subjects with classId, title, teacher", () => {
  const html = `
    <html><body>
      <div id="mainContent">
        <ul class="courses">
          <li class="course">
            <a href="/student_assignments/list/614062">الرياضيات - الصف الأول</a>
            <span class="teacher">أ. أحمد محمد</span>
          </li>
          <li class="course">
            <a href="/student_lessons/list/614063">الفيزياء - الصف الأول</a>
          </li>
          <li class="course">
            <a href="/student_lesson/show/614064?lesson_id=1">الكيمياء</a>
          </li>
        </ul>
      </div>
    </body></html>
  `;

  const classes = parseClassesHtml(html);
  assert.equal(classes.length, 3);

  const math = classes.find((c) => c.classId === "614062");
  assert.ok(math);
  assert.equal(math?.title, "الرياضيات - الصف الأول");
  assert.equal(math?.teacherName, "أ. أحمد محمد");

  const physics = classes.find((c) => c.classId === "614063");
  assert.ok(physics);

  const chem = classes.find((c) => c.classId === "614064");
  assert.ok(chem);
});

test("parseClassesHtml deduplicates classIds and ignores non-class links", () => {
  const html = `
    <html><body>
      <div id="mainContent">
        <a href="/student_assignments/list/100">مادة أولى بعنوان طويل جداً هنا</a>
        <a href="/student_assignments/list/100">مادة أولى</a>
        <a href="/student_quiz_assignment/show/999">اختبار ليس مادة</a>
        <a href="/user_dashboard">لوحة التحكم</a>
      </div>
    </body></html>
  `;

  const classes = parseClassesHtml(html);
  assert.equal(classes.length, 1);
  assert.equal(classes[0]?.classId, "100");
});

test("parseClassesHtml parses Excalibur class-list widget tiles with metadata", () => {
  const html = `
    <div class="swiper-wrapper catalog_boxes catalog_student">
      <div style='--tile-color-bar: #9E2A2B;' data-tile-color-bar='true' id="614062" data-activity="class_activity_614062">
        <div class="header">
          <a href="/student_class/show/614062">
            <h3 class="class_name">11/4 الحوسبة وتكنولوجيا المعلومات</h3>
            <div class="lightText"><span title='رمز المقرر الدراسي'><span class='textOffScreen'>رمز المقرر الدراسي</span> S1-02600701-11 </span></div>
          </a>
        </div>
        <div class="footer flex_footer">
          <a class="block" title="التقييمات المستحقة" href="/student_assignments/due/614062"><span class='textOffScreen'>التقييمات المستحقة </span><i class='pageBlank icnColor'><span>12</span></i></a>
          <div class="label">14 الدروس</div>
        </div>
      </div>
      <div style='--tile-color-bar: 1;' data-tile-color-bar='true' id="648265" data-activity="class_activity_648265">
        <div class="header">
          <a href="/student_class/show/648265">
            <h3 class="class_name">Fostering Academic Excellence in Reading and Writing  11/5</h3>
            <div class="lightText"><span title='رمز المقرر الدراسي'><span class='textOffScreen'>رمز المقرر الدراسي</span> S1-ENG-Fostering </span></div>
          </a>
        </div>
        <div class="footer flex_footer">
          <a class="block" title="لا توجد تقييمات مستحقة" href="/student_assignments/list/648265"><span class='textOffScreen'>لا توجد تقييمات مستحقة</span><i class='pageBlank'></i></a>
          <div class="label">6 الدروس</div>
        </div>
      </div>
    </div>`;

  const classes = parseClassesHtml(html);
  assert.equal(classes.length, 2);

  const computing = classes.find((c) => c.classId === "614062");
  assert.ok(computing);
  assert.equal(computing?.title, "11/4 الحوسبة وتكنولوجيا المعلومات");
  assert.equal(computing?.href, "/student_class/show/614062");
  assert.equal(computing?.courseCode, "S1-02600701-11");
  assert.equal(computing?.dueAssignmentsCount, 12);
  assert.equal(computing?.lessonCount, 14);

  const english = classes.find((c) => c.classId === "648265");
  assert.ok(english);
  assert.equal(english?.courseCode, "S1-ENG-Fostering");
  assert.equal(english?.dueAssignmentsCount, 0);
  assert.equal(english?.lessonCount, 6);
});

test("extractClassWidgetCellIds finds cell ids in dashboard markup", () => {
  const html = `
    <html><body>
      <meta name="csrf-token" content="tok123">
      <div class="cell" id="cell_77"><div id="ClassListsWidget"></div></div>
      <div data-cell-id="cell_99"></div>
      <script>load_widget({ "cell_id": "cell_88" });</script>
    </body></html>`;
  const ids = extractClassWidgetCellIds(html);
  assert.ok(ids.includes("77"));
  assert.ok(ids.includes("cell_88"));
  assert.ok(ids.includes("cell_99"));
});

test("isLoginPageHtml detects password login forms only", () => {
  const loginHtml = `
    <html><body>
      <form action="/users/sign_in" method="post">
        <input type="text" name="email">
        <input type="password" name="password">
        <button>تسجيل الدخول</button>
      </form>
    </body></html>
  `;
  assert.equal(isLoginPageHtml(loginHtml), true);

  const dashboardHtml = `
    <html><body>
      <div id="mainContent"><h1>لوحة الطالب</h1></div>
    </body></html>
  `;
  assert.equal(isLoginPageHtml(dashboardHtml), false);
});

test("validateAllowedLmsBaseUrl accepts edu.gov.qa hosts and rejects others", () => {
  assert.equal(
    validateAllowedLmsBaseUrl("https://qeducation.edu.gov.qa/"),
    "https://qeducation.edu.gov.qa",
  );
  assert.equal(
    validateAllowedLmsBaseUrl("https://lms-sub.edu.gov.qa"),
    "https://lms-sub.edu.gov.qa",
  );

  assert.throws(() => validateAllowedLmsBaseUrl("http://qeducation.edu.gov.qa"));
  assert.throws(() => validateAllowedLmsBaseUrl("https://evil.com"));
  assert.throws(() => validateAllowedLmsBaseUrl("https://169.254.169.254"));
  assert.throws(() => validateAllowedLmsBaseUrl("not-a-url"));
});

test("isSameLmsOriginUrl only matches the configured LMS origin", () => {
  const base = "https://qeducation.edu.gov.qa";
  assert.equal(
    isSameLmsOriginUrl("/path/img.png", base),
    true,
  );
  assert.equal(
    isSameLmsOriginUrl("https://qeducation.edu.gov.qa/uploads/a.png", base),
    true,
  );
  assert.equal(isSameLmsOriginUrl("https://evil.com/x.png", base), false);
  assert.equal(isSameLmsOriginUrl("https://sub.edu.gov.qa/x.png", base), false);
});

test("SessionCookieJar.getCookieNames exposes names only, never values", () => {
  const jar = new SessionCookieJar("lms_session_v1=supersecret; other=val");
  const names = jar.getCookieNames();
  assert.deepEqual(names.sort(), ["lms_session_v1", "other"]);
  assert.ok(!names.some((n) => n.includes("supersecret")));
  assert.ok(!names.some((n) => n.includes("=")));
});
