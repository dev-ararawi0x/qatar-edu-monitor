import test from "node:test";
import assert from "node:assert/strict";
import { LmsHttpClient } from "../src/core/http-client.js";
import {
  QuizSolveAbortedError,
  runQuizSolverWorkflow,
} from "../src/services/quiz-solver.service.js";
import { MockLlmAdapter } from "../src/llm/adapters/mock.adapter.js";
import type { QuizSolverProgressEvent } from "../src/types/index.js";

const BASE = "https://qeducation.edu.gov.qa";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function questionHtml(part: number, totalParts: number): string {
  return `
    <html><body>
      <script>
        init_quiz({
          quiz_id: 555,
          results_id: 777,
          part: ${part},
          parts: ${totalParts},
          timed_quiz: false,
          time_left: 0,
          resume_refresh: false
        });
      </script>
      <form id="question_form" action="/student_take_quiz_assignment/answer/555?escape=false&amp;part=${part}&amp;results=777" method="post">
        <input type="hidden" name="utf8" value="✓">
        <input type="hidden" name="authenticity_token" value="tok_${part}">
        <h2 class="quiz_question">السؤال ${part} من ${totalParts}</h2>
        <div class="materialStyle"><p>اختر الإجابة:</p></div>
        <input type="radio" id="p${part}a" name="answer" value="1">
        <label for="p${part}a">خيار 1</label>
        <input type="radio" id="p${part}b" name="answer" value="2">
        <label for="p${part}b">خيار 2</label>
      </form>
    </body></html>`;
}

function makeFetch() {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const partMatch = url.match(/\/display\/555\?part=(\d+)&results=777/);
    if (partMatch) {
      const part = Number(partMatch[1]);
      return htmlResponse(questionHtml(part, 2));
    }
    return htmlResponse("<html><body>nf</body></html>");
  }) as typeof fetch;
}

test("dry-run solver emits llm_solved progress per part", async () => {
  const events: QuizSolverProgressEvent[] = [];
  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true, undefined, makeFetch());

  const { result } = await runQuizSolverWorkflow(client, {
    targetOrUrl: "/student_take_quiz_assignment/display/555?part=1&results=777",
    baseUrl: BASE,
    llmProvider: new MockLlmAdapter(),
    quiet: true,
    onPartProgress: (e) => {
      events.push(e);
    },
  });

  assert.equal(result.dryRun, true);
  const solved = events.filter((e) => e.stage === "llm_solved");
  assert.equal(solved.length, 2);
  assert.deepEqual(
    solved.map((e) => e.part).sort(),
    [1, 2],
  );
  assert.ok(solved.every((e) => e.totalParts === 2));
});

test("aborted signal throws QuizSolveAbortedError before solving parts", async () => {
  const client = new LmsHttpClient(BASE, "lms_session_v1=abc", true, undefined, makeFetch());

  await assert.rejects(
    () =>
      runQuizSolverWorkflow(client, {
        targetOrUrl: "/student_take_quiz_assignment/display/555?part=1&results=777",
        baseUrl: BASE,
        llmProvider: new MockLlmAdapter(),
        quiet: true,
        signal: AbortSignal.abort(),
      }),
    QuizSolveAbortedError,
  );
});
