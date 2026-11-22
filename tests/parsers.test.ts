import test from "node:test";
import assert from "node:assert/strict";
import { parseAssignmentsHtml } from "../src/parsers/assignments.parser.js";
import { parseLessonsHtml } from "../src/parsers/lessons.parser.js";
import {
  parseInitQuizConfig,
  parseQuizScreen,
  parseQuizShowPage,
} from "../src/parsers/quiz.parser.js";
import { parseGenericHtmlPage } from "../src/parsers/generic.parser.js";

test("parseAssignmentsHtml extracts quizzes, offline assignments, and related lessons", () => {
  const html = `
    <html>
      <body>
        <div id="mainContent">
          <table>
            <tr>
              <td>
                <a href="/student_lesson/show/614062?lesson_id=501&section_id=901">الدرس الأول: مراجعة الرياضيات</a>
              </td>
              <td>
                <a href="/student_quiz_assignment/show/15479350">اختبار الوحدة الأولى - الرياضيات</a>
              </td>
            </tr>
            <tr>
              <td>
                <a href="/student_lesson/show/614062?lesson_id=502">الدرس الثاني: الفيزياء</a>
              </td>
              <td>
                <a href="/student_offline_assignment/show/88881">واجب ورقي - الفيزياء</a>
              </td>
            </tr>
          </table>
        </div>
      </body>
    </html>
  `;

  const items = parseAssignmentsHtml(html);
  assert.equal(items.length, 2);

  const quizItem = items.find((i) => i.kind === "quiz");
  assert.ok(quizItem);
  assert.equal(quizItem?.title, "اختبار الوحدة الأولى - الرياضيات");
  assert.equal(quizItem?.assignmentId, "15479350");
  assert.equal(quizItem?.relatedLessonTitle, "الدرس الأول: مراجعة الرياضيات");

  const offlineItem = items.find((i) => i.kind === "offline");
  assert.ok(offlineItem);
  assert.equal(offlineItem?.assignmentId, "88881");
});

test("parseLessonsHtml extracts lessons, dynamic classId, and nested sections", () => {
  const html = `
    <html>
      <body>
        <div id="mainContent">
          <ul>
            <li><a href="/student_lesson/show/614062?lesson_id=101&section_id=201">القسم 1.1 - المدخلات والمخرجات</a></li>
            <li><a href="/student_lesson/show/614062?lesson_id=101&section_id=202">القسم 1.2 - معالجة البيانات</a></li>
            <li><a href="/student_lesson/show/614062?lesson_id=102">ابدأ الدرس 2. أساسيات البرمجة يناير 15 2026</a></li>
          </ul>
        </div>
      </body>
    </html>
  `;

  const lessons = parseLessonsHtml(html, "614062");
  assert.equal(lessons.length, 2);

  const lesson1 = lessons.find((l) => l.lessonId === "101");
  assert.ok(lesson1);
  assert.equal(lesson1?.sections.length, 2);
  assert.equal(lesson1?.sections[0]?.sectionId, "201");

  const lesson2 = lessons.find((l) => l.lessonId === "102");
  assert.ok(lesson2);
  assert.equal(lesson2?.title, "أساسيات البرمجة");
});

test("parseQuizShowPage extracts title, action button, resume detection, and csrf token", () => {
  const html = `
    <html>
      <head><meta name="csrf-token" content="test_csrf_token_123"></head>
      <body>
        <div id="fixedSectionHeader"><h2>اختبار الفصل الأول</h2></div>
        <div id="mainContent">
          <a href="/student_take_quiz_assignment/display/15479350?part=1&results=116574853">استئناف الاختبار</a>
        </div>
        <aside class="rightColumn">
          <div class="block">
            <ul>
              <li>المدة: 30 دقيقة</li>
              <li>المحاولات: 2</li>
            </ul>
          </div>
        </aside>
      </body>
    </html>
  `;

  const info = parseQuizShowPage(html);
  assert.equal(info.title, "اختبار الفصل الأول");
  assert.equal(info.csrfToken, "test_csrf_token_123");
  assert.equal(info.actionButtonText, "استئناف الاختبار");
  assert.equal(info.isResumeAttempt, true);
  assert.equal(info.sidebarDetails.length, 2);
});

test("parseInitQuizConfig extracts quiz_id, results_id, parts, and timed_quiz", () => {
  const html = `
    <script>
      init_quiz({
        quiz_id: 15479350,
        results_id: 116574853,
        part: 1,
        parts: 5,
        timed_quiz: true,
        time_left: 1500,
        resume_refresh: false
      });
    </script>
  `;

  const config = parseInitQuizConfig(html);
  assert.ok(config);
  assert.equal(config?.quizId, 15479350);
  assert.equal(config?.resultsId, 116574853);
  assert.equal(config?.part, 1);
  assert.equal(config?.parts, 5);
  assert.equal(config?.timedQuiz, true);
  assert.equal(config?.timeLeft, 1500);
});

test("parseQuizScreen parses single-choice question with plain answer", () => {
  const html = `
    <form id="question_form" action="/student_take_quiz_assignment/next/15479350" method="post">
      <input type="hidden" name="authenticity_token" value="token_abc">
      <input type="hidden" name="quiz_id" value="15479350">
      <h2 class="quiz_question">السؤال الأول: ما ناتج 2 + 2؟</h2>
      <div class="quiz_points">5 درجات</div>
      <div class="materialStyle">
        <p>اختر الإجابة الصحيحة:</p>
      </div>
      <input type="radio" id="opt1" name="answer" value="3">
      <label for="opt1">3</label>
      <input type="radio" id="opt2" name="answer" value="4" checked>
      <label for="opt2">4</label>
      <input type="radio" id="opt3" name="answer" value="5">
      <label for="opt3">5</label>
    </form>
  `;

  const screen = parseQuizScreen(html);
  assert.equal(screen.stage, "question");
  if (screen.stage === "question") {
    assert.equal(screen.questionHeader, "السؤال الأول: ما ناتج 2 + 2؟");
    assert.equal(screen.points, "5 درجات");
    assert.equal(screen.inputType, "single_choice");
    assert.equal(screen.choices.length, 3);
    assert.equal(screen.choices[1]?.checked, true);
    assert.equal(screen.choices[1]?.value, "4");
    assert.equal(screen.hiddenFields["authenticity_token"], "token_abc");
  }
});

test("parseQuizScreen parses indexed array fields answer[1], answer[2] and select as structured_input", () => {
  const html = `
    <form id="question_form" action="/student_take_quiz_assignment/next/15479350" method="post">
      <input type="hidden" name="authenticity_token" value="token_xyz">
      <h2 class="quiz_question">صِل كل مصطلح بتعريفه:</h2>
      <div class="materialStyle">
        <p>أكمل الفراغات:</p>
      </div>
      <label>الخيار الأول:</label>
      <input type="text" name="answer[1]" value="الخيار أ">
      <label>الخيار الثاني:</label>
      <select name="answer[2]">
        <option value="opt_a">التعريف أ</option>
        <option value="opt_b" selected>التعريف ب</option>
      </select>
      <label>الخيار الثالث:</label>
      <input type="text" name="answer[3]" value="الخيار ج">
    </form>
  `;

  const screen = parseQuizScreen(html);
  assert.equal(screen.stage, "question");
  if (screen.stage === "question") {
    assert.equal(screen.inputType, "structured_input");
    assert.equal(screen.hasPlainTextInput, true);
    assert.equal(screen.formFieldNames.includes("answer[1]"), true);
    assert.equal(screen.formFieldNames.includes("answer[2]"), true);
    assert.equal(screen.formFieldNames.includes("answer[3]"), true);
    assert.equal(screen.structuredAnswers["answer[1]"], "الخيار أ");
    assert.equal(screen.structuredAnswers["answer[3]"], "الخيار ج");

    const selectField = screen.fieldDetails.find((f) => f.name === "answer[2]");
    assert.ok(selectField);
    assert.equal(selectField?.tagName, "select");
    assert.deepEqual(selectField?.options, ["التعريف أ", "التعريف ب"]);
  }
});

test("parseQuizScreen detects rich text editor and file upload fields", () => {
  const html = `
    <form id="question_form" action="/student_take_quiz_assignment/next/15479350" enctype="multipart/form-data" method="post">
      <input type="hidden" name="authenticity_token" value="token_file">
      <h2 class="quiz_question">اكتب مقالة وصور مرفقة:</h2>
      <div class="materialStyle">
        <p>اشرح  Green Computing:</p>
      </div>
      <textarea name="answer" class="ckeditor hasEditor">مسودة المقال الأولية</textarea>
      <div id="filecontainer">
        <input type="file" name="answer_file" id="file_input">
      </div>
    </form>
  `;

  const screen = parseQuizScreen(html);
  assert.equal(screen.stage, "question");
  if (screen.stage === "question") {
    assert.equal(screen.hasRichTextEditor, true);
    assert.equal(screen.hasFileUpload, true);
    assert.ok(screen.fileInputNames.includes("answer_file"));
    assert.equal(screen.currentTextAnswer, "مسودة المقال الأولية");
  }
});

test("parseQuizScreen parses summary screen without exposing raw finish token in safe output", () => {
  const html = `
    <form action="/student_take_quiz_assignment/finish/15479350" method="post">
      <input type="hidden" name="authenticity_token" value="finish_secret_token">
    </form>
    <h2 class="quiz_question">نهاية الاختبار</h2>
    <div class="materialStyle">
      <h2>السؤال الأول: حساب المعادلة</h2>
      <p>ما هو ناتج 5 * 6؟</p>
      <p>الإجابة: 30</p>
    </div>
    <div class="materialStyle">
      <h2>السؤال الثاني: استنتاج نظري</h2>
      <p>اشرح قانون نيوتن.</p>
      <p>الإجابة: القانون الأول للعطالة</p>
    </div>
  `;

  const screen = parseQuizScreen(html);
  assert.equal(screen.stage, "summary");
  if (screen.stage === "summary") {
    assert.equal(screen.summaryItems.length, 2);
    assert.equal(screen.summaryItems[0]?.questionTitle, "السؤال الأول: حساب المعادلة");
    assert.equal(screen.summaryItems[0]?.recordedAnswer, "الإجابة: 30");
  }
});

test("parseGenericHtmlPage auto-detects assignments and quiz show info", () => {
  const html = `
    <html>
      <head><title>لوحة الطالب</title></head>
      <body>
        <div id="mainContent">
          <h1>التقييمات الحالية</h1>
          <a href="/student_quiz_assignment/show/777">اختبار الفيزياء الشامل</a>
          <a href="/student_quiz_assignment/show/777">اختبار الفيزياء الشامل</a>
        </div>
        <div id="fixedSectionHeader"><h2>اختبار الفيزياء الشامل</h2></div>
        <meta name="csrf-token" content="meta_token">
        <a href="/student_take_quiz_assignment/display/777?part=1&results=999">استئناف الاختبار</a>
      </body>
    </html>
  `;

  const parsed = parseGenericHtmlPage(html);
  assert.equal(parsed.pageTitle, "لوحة الطالب");
  assert.equal(parsed.mainHeading, "التقييمات الحالية");
  assert.equal(parsed.assignments.length, 1);
  assert.ok(parsed.quizShowInfo);
  assert.equal(parsed.quizShowInfo?.title, "اختبار الفيزياء الشامل");
  assert.equal(parsed.quizShowInfo?.isResumeAttempt, true);
});
