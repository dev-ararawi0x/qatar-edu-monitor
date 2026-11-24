import test from "node:test";
import assert from "node:assert/strict";
import { LmsHttpClient } from "@qatar-edu/core";
import { MockLlmAdapter } from "@qatar-edu/core";
import { runQuizSolverWorkflow } from "@qatar-edu/core";
import { renderQuizSolveMarkdown } from "../src/exporters/quiz.exporter.js";

function buildSimulatedQuizFetch(options?: { timedQuiz?: boolean; resume?: boolean }) {
  const timed = options?.timedQuiz ?? false;
  const resume = options?.resume ?? true;
  const requestsLog: Array<{ method: string; url: string; bodyPreview: string; isFormData: boolean }> = [];

  const initScript = `
    <script>
      init_quiz({
        quiz_id: 55501,
        results_id: 88801,
        part: 1,
        parts: 5,
        timed_quiz: ${timed},
        time_left: ${timed ? 900 : 0},
        resume_refresh: false
      });
    </script>
  `;

  const partHtmlMap: Record<number, string> = {
    1: `
      ${initScript}
      <form id="question_form" action="/student_take_quiz_assignment/next/55501?part=1" method="post">
        <input type="hidden" name="authenticity_token" value="csrf_tok_part1">
        <h2 class="quiz_question">السؤال 1: ما عاصمة دولة قطر؟</h2>
        <div class="quiz_points">2 درجات</div>
        <div class="materialStyle"><p>اختر الإجابة الصحيحة:</p></div>
        <input type="radio" id="r1" name="answer" value="doha"><label for="r1">الدوحة</label>
        <input type="radio" id="r2" name="answer" value="khor"><label for="r2">الخور</label>
      </form>
    `,
    2: `
      <form id="question_form" action="/student_take_quiz_assignment/next/55501?part=2" method="post">
        <input type="hidden" name="authenticity_token" value="csrf_tok_part2">
        <h2 class="quiz_question">Question 2</h2>
        <div class="quiz_points">3 pts</div>
        <div class="materialStyle"><p>Select all programming languages:</p></div>
        <input type="checkbox" id="c1" name="answer[]" value="py"><label for="c1">Python</label>
        <input type="checkbox" id="c2" name="answer[]" value="ts"><label for="c2">TypeScript</label>
        <input type="checkbox" id="c3" name="answer[]" value="html_only"><label for="c3">PNG Image</label>
      </form>
    `,
    3: `
      <form id="question_form" action="/student_take_quiz_assignment/next/55501?part=3" method="post">
        <input type="hidden" name="authenticity_token" value="csrf_tok_part3">
        <h2 class="quiz_question">السؤال 3: أكمل الفراغات</h2>
        <div class="quiz_points">4 درجات</div>
        <div class="materialStyle">
          <p>تقع دولة قطر في قارة <input type="text" name="answer[1]" value=""> ونظام الحكم فيها <select name="answer[2]"><option value="">--</option><option value="hereditary_emirate">إمارة وراثية</option><option value="other">غير ذلك</option></select>.</p>
        </div>
      </form>
    `,
    4: `
      <form id="question_form" action="/student_take_quiz_assignment/next/55501?part=4" method="post">
        <input type="hidden" name="authenticity_token" value="csrf_tok_part4">
        <h2 class="quiz_question">Question 4</h2>
        <div class="quiz_points">5 pts</div>
        <div class="materialStyle">
          <p>Based on the attached circuit diagram, explain Ohm's Law in English.</p>
          <img src="/assets/ohm-diagram.png">
        </div>
        <textarea name="answer" class="ckeditor hasEditor"></textarea>
      </form>
    `,
    5: `
      <form id="question_form" action="/student_take_quiz_assignment/next/55501?part=5" enctype="multipart/form-data" method="post">
        <input type="hidden" name="authenticity_token" value="csrf_tok_part5">
        <h2 class="quiz_question">السؤال 5: مشروع مصغر</h2>
        <div class="quiz_points">6 درجات</div>
        <div class="materialStyle"><p>اشرح فوائد الطاقة المتجددة وأرفق ملف التقرير:</p></div>
        <textarea name="answer"></textarea>
        <input type="file" name="answer_file">
      </form>
    `,
  };

  const summaryHtml = `
    <form action="/student_take_quiz_assignment/finish/55501" method="post">
      <input type="hidden" name="authenticity_token" value="csrf_tok_finish_secret">
    </form>
    <h2 class="quiz_question">نهاية الاختبار</h2>
    <div class="materialStyle"><h2>السؤال 1</h2><p>ما عاصمة دولة قطر؟</p><p>الإجابة: الدوحة</p></div>
    <div class="materialStyle"><h2>Question 2</h2><p>Select all programming languages</p><p>الإجابة: Python, TypeScript</p></div>
    <div class="materialStyle"><h2>السؤال 3</h2><p>أكمل الفراغات</p><p>الإجابة: آسيا / إمارة وراثية</p></div>
    <div class="materialStyle"><h2>Question 4</h2><p>Ohm's Law</p><p>الإجابة: V = I * R</p></div>
    <div class="materialStyle"><h2>السؤال 5</h2><p>مشروع مصغر</p><p>الإجابة: solution-part-5.md</p></div>
  `;

  const fetchMock: typeof fetch = async (input, init) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const method = (init?.method || "GET").toUpperCase();
    const isFormData = init?.body instanceof FormData;
    let bodyPreview = "";
    if (typeof init?.body === "string") {
      bodyPreview = init.body;
    } else if (init?.body instanceof FormData) {
      const entries: string[] = [];
      for (const [k, v] of init.body.entries()) {
        if (v instanceof Blob) {
          entries.push(`${k}=Blob(${(v as File).name || "blob"},${v.size}B)`);
        } else {
          entries.push(`${k}=${String(v)}`);
        }
      }
      bodyPreview = entries.join("&");
    }

    requestsLog.push({ method, url: urlStr, bodyPreview, isFormData });

    if (urlStr.includes("/student_quiz_assignment/show/55501")) {
      const href = resume
        ? "/student_take_quiz_assignment/display/55501?part=1&results=88801"
        : "/student_take_quiz_assignment/start/55501";
      const btnText = resume ? "استئناف الاختبار" : "ابدأ الاختبار";
      return new Response(
        `<html><head><meta name="csrf-token" content="show_csrf"></head><body><div id="fixedSectionHeader"><h2>اختبار شامل متعدد الأنواع</h2></div><div id="mainContent"><a href="${href}">${btnText}</a></div></body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    if (urlStr.includes("/assets/ohm-diagram.png")) {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }

    if (urlStr.includes("/student_take_quiz_assignment/display/55501")) {
      const u = new URL(urlStr);
      const part = Number(u.searchParams.get("part") || "1");
      return new Response(partHtmlMap[part] || summaryHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (urlStr.includes("/student_take_quiz_assignment/next/55501")) {
      const u = new URL(urlStr);
      const currentPart = Number(u.searchParams.get("part") || "1");
      const nextPart = currentPart + 1;
      const html = nextPart <= 5 ? partHtmlMap[nextPart]! : summaryHtml;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (urlStr.includes("/student_take_quiz_assignment/pause/55501")) {
      return new Response(JSON.stringify({ paused: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  };

  return { fetchMock, requestsLog };
}

test("QuizSolverService dry-run solves all 5 multi-type bilingual parts via GET with 0 POST requests", async () => {
  const { fetchMock, requestsLog } = buildSimulatedQuizFetch();
  const client = new LmsHttpClient("https://qeducation.edu.gov.qa",
    "_qedu_session=real_secret_cookie", true, undefined, fetchMock);
  const llm = new MockLlmAdapter("mock-v1");

  const { displayUrl, result } = await runQuizSolverWorkflow(client, {
    targetOrUrl: "55501",
    baseUrl: "https://qeducation.edu.gov.qa",
    llmProvider: llm,
    quiet: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.steps.length, 5);

  // Verify bilingual detection per question!
  assert.equal(result.steps[0]?.language, "ar"); // Q1 Arabic single_choice
  assert.equal(result.steps[1]?.language, "en"); // Q2 English multiple_choice
  assert.equal(result.steps[2]?.language, "ar"); // Q3 Arabic complete-the-space + select
  assert.equal(result.steps[3]?.language, "en"); // Q4 English rich text + diagram image
  assert.equal(result.steps[4]?.language, "ar"); // Q5 Arabic file upload

  // Zero POST requests in dry-run!
  const postRequests = requestsLog.filter((r) => r.method === "POST");
  assert.equal(postRequests.length, 0);

  // Verify Arabic Markdown report masks secrets and renders all solved parts
  const reportMd = renderQuizSolveMarkdown({
    targetUrl: "55501",
    displayUrl,
    timestamp: new Date("2026-11-24T10:00:00Z"),
    result,
    traces: client.traces,
    hasSession: client.cookieJar.hasRealCookies(),
  });

  assert.ok(reportMd.includes("تقرير حل الاختبار بالذكاء الاصطناعي"));
  assert.ok(reportMd.includes("اختيار من متعدد - عدة إجابات"));
  assert.ok(reportMd.includes("حقول إدخال منظمة / فراغات / قوائم منسدلة"));
  assert.ok(reportMd.includes("رفع ملفات مرفقة"));
  assert.ok(reportMd.includes("solution-part-5.md"));
  assert.ok(!reportMd.includes("real_secret_cookie"));
  assert.ok(!reportMd.includes("csrf_tok_part1"));
});

test("QuizSolverService submit/apply mode saves all 5 question types (incl. checkboxes, blanks, multipart file), verifies summary, pauses safely, and never calls /finish/", async () => {
  const { fetchMock, requestsLog } = buildSimulatedQuizFetch();
  const client = new LmsHttpClient("https://qeducation.edu.gov.qa",
    "_qedu_session=real_secret_cookie", true, undefined, fetchMock);
  const llm = new MockLlmAdapter("mock-v1");

  const { result } = await runQuizSolverWorkflow(client, {
    targetOrUrl: "55501",
    baseUrl: "https://qeducation.edu.gov.qa",
    llmProvider: llm,
    submit: true,
    quiet: true,
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.mode, "submit-ready");
  assert.equal(result.steps.length, 5);
  assert.equal(result.reachedSummary, true);
  assert.equal(result.summaryVerified, true);
  assert.equal(result.pausedSafely, true);
  assert.equal(result.finishBlockedByGuardrail, true);

  // Check Part 2 sent multiple answer[] values
  const part2Post = requestsLog.find((r) => r.url.includes("next/55501?part=2"));
  assert.ok(part2Post);
  assert.ok(part2Post.bodyPreview.includes("answer%5B%5D=py"));
  assert.ok(part2Post.bodyPreview.includes("answer%5B%5D=ts"));

  // Check Part 3 sent structured answer[1] and dropdown option value hereditary_emirate
  const part3Post = requestsLog.find((r) => r.url.includes("next/55501?part=3"));
  assert.ok(part3Post);
  assert.ok(part3Post.bodyPreview.includes("answer%5B2%5D=hereditary_emirate"));

  // Check Part 5 sent multipart FormData with Blob file upload
  const part5Post = requestsLog.find((r) => r.url.includes("next/55501?part=5"));
  assert.ok(part5Post);
  assert.equal(part5Post.isFormData, true);
  assert.ok(part5Post.bodyPreview.includes("answer_file=Blob(solution-part-5.md"));

  // Check /pause/ was called and /finish/ was NEVER called
  assert.ok(requestsLog.some((r) => r.url.includes("/pause/55501")));
  assert.equal(
    requestsLog.some((r) => r.url.includes("/finish/")),
    false,
  );
});

test("QuizSolverService enforces --start-new and --allow-timed safety guardrails", async () => {
  // 1. Unstarted quiz without --start-new must abort
  const unstarted = buildSimulatedQuizFetch({ resume: false });
  const client1 = new LmsHttpClient(
    "https://qeducation.edu.gov.qa",
    "VALUES",
    true,
    undefined,
    unstarted.fetchMock,
  );
  await assert.rejects(
    async () => {
      await runQuizSolverWorkflow(client1, {
        targetOrUrl: "55501",
        baseUrl: "https://qeducation.edu.gov.qa",
        llmProvider: new MockLlmAdapter(),
        startNew: false,
        quiet: true,
      });
    },
    /--start-new/i,
  );

  // 2. Timed quiz without --allow-timed must abort
  const timed = buildSimulatedQuizFetch({ timedQuiz: true, resume: true });
  const client2 = new LmsHttpClient(
    "https://qeducation.edu.gov.qa",
    "VALUES",
    true,
    undefined,
    timed.fetchMock,
  );
  await assert.rejects(
    async () => {
      await runQuizSolverWorkflow(client2, {
        targetOrUrl: "55501",
        baseUrl: "https://qeducation.edu.gov.qa",
        llmProvider: new MockLlmAdapter(),
        allowTimed: false,
        quiet: true,
      });
    },
    /Timed quiz detected.*--allow-timed/i,
  );
});
