import test from "node:test";
import assert from "node:assert/strict";
import { LmsHttpClient } from "../src/core/http-client.js";
import {
  overrideQuizPartAnswer,
  submitQuizFinishExplicitly,
} from "../src/services/quiz-finish.service.js";

const BASE = "https://qeducation.edu.gov.qa";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const INIT_QUIZ = (part: number, parts: number) => `
  <script>
    init_quiz({
      quiz_id: 555,
      results_id: 777,
      part: ${part},
      parts: ${parts},
      timed_quiz: false,
      time_left: 0,
      resume_refresh: false
    });
  </script>`;

function questionHtml(part: number, totalParts: number): string {
  return `
    <html><body>
      ${INIT_QUIZ(part, totalParts)}
      <form id="question_form" action="/student_take_quiz_assignment/answer/555?escape=false&amp;part=${part}&amp;results=777" method="post">
        <input type="hidden" name="utf8" value="✓">
        <input type="hidden" name="authenticity_token" value="tok_${part}">
        <h2 class="quiz_question">السؤال ${part} من ${totalParts}</h2>
        <div class="quiz_points">1 النقطة</div>
        <div class="materialStyle"><p>اختر الإجابة الصحيحة:</p></div>
        <input type="radio" id="p${part}o1" name="answer" value="1">
        <label for="p${part}o1">الخيار الأول</label>
        <input type="radio" id="p${part}o2" name="answer" value="2">
        <label for="p${part}o2">الخيار الثاني</label>
      </form>
    </body></html>`;
}

function summaryHtml(): string {
  return `
    <html><body>
      <form action="/student_take_quiz_assignment/finish/555" method="post">
        <input type="hidden" name="utf8" value="✓">
        <input type="hidden" name="authenticity_token" value="finish_tok_123">
      </form>
      <h2 class="quiz_question">نهاية الاختبار</h2>
      <div class="materialStyle">
        <h2>السؤال الأول: ما ناتج 2+2؟</h2>
        <p>ما ناتج 2+2؟</p>
        <p>الإجابة: 4</p>
      </div>
    </body></html>`;
}

test("LmsHttpClient still hard-blocks /finish/ without the capability symbol", async () => {
  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true);
  await assert.rejects(
    () =>
      client.request({
        method: "POST",
        pathOrUrl: "/student_take_quiz_assignment/finish/555",
        formFields: { authenticity_token: "x" },
      }),
    /Safety Guardrail.*finish/i,
  );
});

test("overrideQuizPartAnswer GETs the part, POSTs merged fields, never finishes", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    requests.push({ url, method, body });

    if (method === "GET" && url.includes("/display/555")) {
      return htmlResponse(questionHtml(1, 2));
    }
    if (method === "POST" && url.includes("/answer/555")) {
      return htmlResponse(questionHtml(2, 2));
    }
    return htmlResponse("<html><body>not found</body></html>", 404);
  };

  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true, undefined, fetchImpl);

  const result = await overrideQuizPartAnswer(client, {
    quizId: 555,
    resultsId: 777,
    part: 1,
    fields: { answer: "2" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.nextScreenStage, "question");

  const post = requests.find((r) => r.method === "POST");
  assert.ok(post);
  assert.ok(post.url.includes("/student_take_quiz_assignment/answer/555"));
  assert.ok(post.body);
  assert.ok(post.body.includes("answer=2"));
  assert.ok(post.body.includes("authenticity_token=tok_1"));
  assert.ok(!requests.some((r) => r.url.includes("/finish/")));
});

test("submitQuizFinishExplicitly verifies summary and POSTs finish once", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    requests.push({ url, method, body });

    const partMatch = url.match(/\/display\/555\?part=(\d+)&results=777/);
    if (method === "GET" && partMatch) {
      const part = Number(partMatch[1]);
      if (part === 2) return htmlResponse(summaryHtml());
      return htmlResponse(questionHtml(part === 1 ? 1 : part, 1));
    }
    if (method === "POST" && url.includes("/finish/555")) {
      return htmlResponse("<html><body>finished</body></html>", 200);
    }
    return htmlResponse("<html><body>not found</body></html>", 404);
  };

  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true, undefined, fetchImpl);

  const result = await submitQuizFinishExplicitly(client, {
    quizId: 555,
    resultsId: 777,
    expectedParts: 1,
  });

  assert.equal(result.submitted, true);
  assert.equal(result.verified, true);
  assert.equal(result.summaryItemCount, 1);

  const finishPosts = requests.filter(
    (r) => r.method === "POST" && r.url.includes("/finish/"),
  );
  assert.equal(finishPosts.length, 1);
  assert.ok(finishPosts[0]?.body?.includes("authenticity_token=finish_tok_123"));
});

test("submitQuizFinishExplicitly refuses when summary is unverified", async () => {
  const emptySummary = `
    <html><body>
      <form action="/student_take_quiz_assignment/finish/555" method="post">
        <input type="hidden" name="authenticity_token" value="finish_tok_123">
      </form>
      <h2 class="quiz_question">نهاية الاختبار</h2>
      <div class="materialStyle">
        <h2>السؤال الأول</h2>
        <p>الإجابة: (غير محدد)</p>
      </div>
    </body></html>`;

  const requests: Array<{ url: string; method: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    const partMatch = url.match(/\/display\/555\?part=(\d+)&results=777/);
    if (method === "GET" && partMatch) {
      const part = Number(partMatch[1]);
      if (part === 2) return htmlResponse(emptySummary);
      return htmlResponse(questionHtml(1, 1));
    }
    if (method === "POST") {
      return htmlResponse("ok", 200);
    }
    return htmlResponse("nf", 404);
  };

  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true, undefined, fetchImpl);

  await assert.rejects(
    () =>
      submitQuizFinishExplicitly(client, {
        quizId: 555,
        resultsId: 777,
        expectedParts: 1,
      }),
    /not fully verified/i,
  );

  assert.ok(!requests.some((r) => r.url.includes("/finish/") && r.method === "POST"));
});
