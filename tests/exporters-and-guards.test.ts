import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionCookieJar } from "../src/core/cookie-jar.js";
import { isQuizFinishUrl, buildQuizDisplayUrl } from "../src/core/lms-urls.js";
import { LmsHttpClient } from "../src/core/http-client.js";
import { parseAssignmentsHtml } from "../src/parsers/assignments.parser.js";
import { parseLessonsHtml } from "../src/parsers/lessons.parser.js";
import { parseQuizScreen } from "../src/parsers/quiz.parser.js";
import { renderAssignmentsMarkdown } from "../src/exporters/assignments.exporter.js";
import { renderLessonsMarkdown } from "../src/exporters/lessons.exporter.js";
import {
  getQuestionTypeLabelAr,
  renderQuestionCardMarkdown,
  renderQuizInspectMarkdown,
} from "../src/exporters/quiz.exporter.js";
import { renderMonitorMarkdown } from "../src/exporters/monitor.exporter.js";
import { saveMarkdownReport } from "../src/exporters/markdown-writer.js";

test("SessionCookieJar parses, ingests set-cookie headers, and reports only names", () => {
  const jar = new SessionCookieJar("session_id=abc123; theme=dark");
  assert.equal(jar.hasRealCookies(), true);

  const cookieHeader = jar.toCookieHeader();
  assert.ok(cookieHeader.includes("session_id=abc123"));
  assert.ok(cookieHeader.includes("theme=dark"));

  const updated = jar.ingestSetCookieHeaders([
    "session_id=xyz789; Path=/; HttpOnly",
    "new_token=token_val; Path=/",
  ]);

  assert.deepEqual(updated.sort(), ["new_token", "session_id"]);
  assert.ok(jar.toCookieHeader().includes("session_id=xyz789"));
  assert.ok(jar.toCookieHeader().includes("new_token=token_val"));

  const emptyJar = new SessionCookieJar("VALUES");
  assert.equal(emptyJar.hasRealCookies(), false);
  assert.equal(emptyJar.toCookieHeader(), "VALUES");
});

test("isQuizFinishUrl and buildQuizDisplayUrl route detectors work accurately", () => {
  assert.equal(
    isQuizFinishUrl("/student_take_quiz_assignment/finish/15479350"),
    true,
  );
  assert.equal(
    isQuizFinishUrl("https://qeducation.edu.gov.qa/student_take_quiz_assignment/finish/15479350?x=1"),
    true,
  );
  assert.equal(
    isQuizFinishUrl("/student_take_quiz_assignment/display/15479350?part=1&results=999"),
    false,
  );
  assert.equal(
    isQuizFinishUrl("/student_take_quiz_assignment/pause/15479350?results=999"),
    false,
  );

  const displayUrl = buildQuizDisplayUrl(15479350, 2, 116574853, "https://qeducation.edu.gov.qa");
  assert.equal(
    displayUrl,
    "https://qeducation.edu.gov.qa/student_take_quiz_assignment/display/15479350?part=2&results=116574853",
  );
});

test("LmsHttpClient blocks /finish/ endpoint unconditionally at transport layer", async () => {
  const client = new LmsHttpClient("https://qeducation.edu.gov.qa", "VALUES", true);

  await assert.rejects(
    async () => {
      await client.request({
        method: "POST",
        pathOrUrl: "/student_take_quiz_assignment/finish/15479350",
        formFields: { answer: "done" },
      });
    },
    /Safety Guardrail.*Blocked request to quiz finish endpoint/i,
  );

  assert.equal(client.traces.length, 0, "Blocked request must not produce HTTP trace or network call");
});

test("saveMarkdownReport creates timestamped report and latest.md in command folder", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "qedu-reports-"));
  const content = "# تقرير تجريبي\n\nهذا محتوى عربي للتجربة.";

  const saved = await saveMarkdownReport({
    reportsDir: tempDir,
    commandFolder: "test-command",
    fileSlug: "test-slug",
    content,
  });

  assert.ok(saved.timestampedPath.endsWith(".md"));
  assert.ok(saved.timestampedPath.includes("test-slug_"));
  assert.ok(saved.latestPath?.endsWith(path.join("test-command", "latest.md")));

  const timestampedContent = await readFile(saved.timestampedPath, "utf8");
  assert.equal(timestampedContent, content);

  const latestContent = await readFile(saved.latestPath!, "utf8");
  assert.equal(latestContent, content);
});

test("renderAssignmentsMarkdown formats Arabic report with summary table and items", () => {
  const assignments = parseAssignmentsHtml(`
    <div id="mainContent">
      <a href="/student_quiz_assignment/show/111">اختبار قصير 1</a>
      <a href="/student_offline_assignment/show/222">واجب تسليم ورقي</a>
    </div>
  `);

  const md = renderAssignmentsMarkdown({
    mode: "due",
    targetUrl: "https://qeducation.edu.gov.qa/student_assignments/due/614062",
    classId: "614062",
    timestamp: new Date("2026-11-22T12:00:00Z"),
    assignments,
    hasSession: true,
  });

  assert.ok(md.includes("تقرير التقييمات المستحقة"));
  assert.ok(md.includes("اختبار إلكتروني (Quiz)"));
  assert.ok(md.includes("تقييم ورقي / غير إلكتروني (Offline)"));
  assert.ok(md.includes("اختبار قصير 1"));
  assert.ok(md.includes("واجب تسليم ورقي"));
});

test("renderLessonsMarkdown formats Arabic report with lesson and sections breakdown", () => {
  const lessons = parseLessonsHtml(`
    <div id="mainContent">
      <a href="/student_lesson/show/614062?lesson_id=10&section_id=20">القسم الأول: المقدمة</a>
      <a href="/student_lesson/show/614062?lesson_id=10&section_id=21">القسم الثاني: التطبيقات</a>
    </div>
  `, "614062");

  const md = renderLessonsMarkdown({
    targetUrl: "https://qeducation.edu.gov.qa/student_lessons/list/614062",
    classId: "614062",
    timestamp: new Date("2026-11-22T12:00:00Z"),
    lessons,
    hasSession: true,
  });

  assert.ok(md.includes("تقرير دروس ووحدات المنصة"));
  assert.ok(md.includes("الأقسام والوحدات الفرعية"));
  assert.ok(md.includes("القسم الأول: المقدمة"));
});

test("renderQuestionCardMarkdown groups prompt, points, Arabic type, capabilities, choices, and answers", () => {
  const questionHtml = `
    <form id="question_form" action="/student_take_quiz_assignment/next/15479350" method="post">
      <input type="hidden" name="authenticity_token" value="secret_token">
      <h2 class="quiz_question">السؤال 1: اختر ناتج 10 ÷ 2</h2>
      <div class="quiz_points">4 درجات</div>
      <div class="materialStyle"><p>اختر الإجابة الصحيحة من بين البدائل:</p></div>
      <input type="radio" id="c1" name="answer" value="4" checked>
      <label for="c1">4</label>
      <input type="radio" id="c2" name="answer" value="5">
      <label for="c2">5</label>
    </form>
  `;

  const screen = parseQuizScreen(questionHtml);
  assert.equal(screen.stage, "question");

  const cardLines = renderQuestionCardMarkdown({
    part: 1,
    totalParts: 3,
    screen,
  });
  const cardMd = cardLines.join("\n");

  assert.ok(cardMd.includes("السؤال 1: اختر ناتج 10 ÷ 2"));
  assert.ok(cardMd.includes("4 درجات"));
  assert.ok(cardMd.includes("اختيار من متعدد - إجابة واحدة"));
  assert.ok(cardMd.includes("الخيارات المتاحة والإجابة المحددة حالياً"));
  assert.ok(cardMd.includes("نعم (محدد)"));
  assert.ok(!cardMd.includes("secret_token"), "Raw CSRF token must never leak into report");
});

test("renderQuizInspectMarkdown produces clean Arabic report structure", () => {
  const questionHtml = `
    <form id="question_form" action="/student_take_quiz_assignment/next/15479350" method="post">
      <input type="hidden" name="authenticity_token" value="secret_token">
      <h2 class="quiz_question">اشرح خواص المادة الصلبة:</h2>
      <div class="quiz_points">10 درجات</div>
      <div class="materialStyle"><p>اكتب إجابة منة:</p></div>
      <textarea name="answer" class="ckeditor hasEditor">حجم ثابت</textarea>
      <input type="file" name="answer_file">
    </form>
  `;

  const screen = parseQuizScreen(questionHtml);

  const md = renderQuizInspectMarkdown({
    targetUrl: "15479350",
    quizId: "15479350",
    resultsId: "116574853",
    startNewUsed: false,
    timestamp: new Date("2026-11-22T12:00:00Z"),
    questions: [{ part: 1, totalParts: 1, screen }],
    hasSession: true,
    note: "قراءة فقط GET",
  });

  assert.ok(md.includes("تقرير فحص اختبار إلكتروني"));
  assert.ok(md.includes("قراءة فقط (GET فقط"));
  assert.ok(md.includes("اشرح خواص المادة الصلبة"));
  assert.ok(md.includes("دعم المحرر النصي المنسق (Rich Text)"));
  assert.ok(md.includes("نعم"));
  assert.ok(md.includes("answer_file"));
  assert.ok(!md.includes("secret_token"));
});

test("renderMonitorMarkdown formats HTTP traces and page inspections in Arabic", () => {
  const md = renderMonitorMarkdown({
    targets: ["https://qeducation.edu.gov.qa/student_assignments/list/614062"],
    timestamp: new Date("2026-11-22T12:00:00Z"),
    hasSession: true,
    traces: [
      {
        timestamp: "2026-11-22T12:00:00.000Z",
        method: "GET",
        url: "https://qeducation.edu.gov.qa/student_assignments/list/614062",
        status: 200,
        statusText: "OK",
        elapsedMs: 350,
        contentType: "text/html; charset=utf-8",
        kind: "HTML",
        updatedCookieNames: ["_qedu_session"],
        sizeBytes: 45200,
        hasCookies: true,
      },
    ],
    inspections: [
      {
        url: "https://qeducation.edu.gov.qa/student_assignments/list/614062",
        status: 200,
        statusText: "OK",
        contentType: "text/html; charset=utf-8",
        kind: "HTML",
        elapsedMs: 350,
        pageTitle: "الواجبات والتقييمات",
        mainHeading: "قائمة التقييمات",
        extractedElements: [{ tag: "a", text: "اختبار 1", href: "/student_quiz_assignment/show/1" }],
        assignments: [
          {
            title: "اختبار 1",
            href: "/student_quiz_assignment/show/1",
            assignmentId: "1",
            kind: "quiz",
          },
        ],
        lessons: [],
      },
    ],
  });

  assert.ok(md.includes("تقرير مراقبة نقاط نهاية المنصة"));
  assert.ok(md.includes("سجل طلبات HTTP وحركة الشبكة"));
  assert.ok(md.includes("_qedu_session"));
  assert.ok(md.includes("اختبار 1"));
});
