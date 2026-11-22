import test from "node:test";
import assert from "node:assert/strict";
import {
  MASK_VALUE,
  maskIfSensitiveKey,
  sanitizeFields,
  sanitizeRecordValues,
  sanitizeText,
  sanitizeHtmlPreview,
  sanitizeJsonValue,
  sanitizeQuizScreenForOutput,
} from "../src/core/sanitizer.js";

test("MASK_VALUE constant is 'VALUES'", () => {
  assert.equal(MASK_VALUE, "VALUES");
});

test("maskIfSensitiveKey masks cookies, tokens, csrf, auth, secrets, passwords", () => {
  assert.equal(maskIfSensitiveKey("Cookie", "session=abc123"), "VALUES");
  assert.equal(maskIfSensitiveKey("authenticity_token", "super_secret_token"), "VALUES");
  assert.equal(maskIfSensitiveKey("csrf-token", "csrf_secret"), "VALUES");
  assert.equal(maskIfSensitiveKey("X-CSRF-Token", "header_token"), "VALUES");
  assert.equal(maskIfSensitiveKey("Authorization", "Bearer token123"), "VALUES");
  assert.equal(maskIfSensitiveKey("session_id", "sess_987"), "VALUES");
  assert.equal(maskIfSensitiveKey("user_password", "hunter2"), "VALUES");
  assert.equal(maskIfSensitiveKey("answer", "42"), "42");
  assert.equal(maskIfSensitiveKey("title", "Physics Quiz"), "Physics Quiz");
});

test("sanitizeFields masks sensitive form fields while preserving regular fields", () => {
  const input = {
    authenticity_token: "secret_csrf_token_123",
    answer: "My Answer",
    destination: "next",
    utf8: "✓",
  };

  const output = sanitizeFields(input);
  assert.ok(output);
  assert.equal(output["authenticity_token"], "VALUES");
  assert.equal(output["answer"], "My Answer");
  assert.equal(output["destination"], "next");
  assert.equal(output["utf8"], "✓");
});

test("sanitizeRecordValues masks sensitive keys", () => {
  const input = {
    quiz_id: "15479350",
    authenticity_token: "token_xyz",
    part: "2",
  };
  const output = sanitizeRecordValues(input);
  assert.equal(output["quiz_id"], "15479350");
  assert.equal(output["authenticity_token"], "VALUES");
  assert.equal(output["part"], "2");
});

test("sanitizeText redacts meta csrf-token and input authenticity_token in HTML snippets", () => {
  const html = `
    <html>
      <head><meta name="csrf-token" content="real_meta_token_abc"></head>
      <body>
        <form>
          <input type="hidden" name="authenticity_token" value="real_form_token_def">
          <p>Normal content</p>
        </form>
      </body>
    </html>
  `;

  const sanitized = sanitizeText(html);
  assert.ok(!sanitized.includes("real_meta_token_abc"));
  assert.ok(!sanitized.includes("real_form_token_def"));
  assert.ok(sanitized.includes(`content="VALUES"`));
  assert.ok(sanitized.includes(`value="VALUES"`));
  assert.ok(sanitized.includes("Normal content"));
});

test("sanitizeText redacts Cookie and Authorization headers in plain text", () => {
  const logLine = "Cookie: _qedu_session=abcdef123456; Path=/\nAuthorization: Bearer secret_jwt_token";
  const sanitized = sanitizeText(logLine);
  assert.ok(!sanitized.includes("abcdef123456"));
  assert.ok(!sanitized.includes("secret_jwt_token"));
  assert.ok(sanitized.includes("Cookie: VALUES"));
  assert.ok(sanitized.includes("Authorization: VALUES"));
});

test("sanitizeHtmlPreview strips scripts/styles and truncates cleanly", () => {
  const dirtyHtml = `<html><head><style>body{color:red}</style></head><body><script>alert('hack')</script><div>Hello World</div></body></html>`;
  const preview = sanitizeHtmlPreview(dirtyHtml, 100);
  assert.ok(!preview.includes("alert"));
  assert.ok(!preview.includes("color:red"));
  assert.ok(preview.includes("Hello World"));
});

test("sanitizeJsonValue masks nested tokens and cookies", () => {
  const data = {
    user: "student_1",
    session: {
      cookie: "secret_cookie",
      token: "secret_token",
      active: true,
    },
    quiz: {
      id: 123,
      title: "Algebra Quiz 1",
    },
  };

  const clean = sanitizeJsonValue(data) as Record<string, unknown>;
  assert.equal(clean["user"], "student_1");
  const session = clean["session"] as Record<string, unknown>;
  assert.equal(session["cookie"], "VALUES");
  assert.equal(session["token"], "VALUES");
  assert.equal(session["active"], true);
  const quiz = clean["quiz"] as Record<string, unknown>;
  assert.equal(quiz["id"], 123);
  assert.equal(quiz["title"], "Algebra Quiz 1");
});

test("sanitizeQuizScreenForOutput masks authenticity_token in hiddenFields and summary", () => {
  const questionScreen = {
    stage: "question" as const,
    questionHeader: "Q1",
    points: "5",
    action: "/student_take_quiz_assignment/next/123",
    enctype: "application/x-www-form-urlencoded",
    hiddenFields: {
      authenticity_token: "raw_csrf_token",
      quiz_id: "999",
    },
    promptText: "What is 2+2?",
    imageUrls: [],
    inputType: "single_choice" as const,
    hasRichTextEditor: false,
    hasPlainTextInput: false,
    hasFileUpload: false,
    fileInputNames: [],
    fieldDetails: [],
    choices: [],
    currentTextAnswer: "",
    structuredAnswers: {},
    formFieldNames: ["authenticity_token", "answer"],
  };

  const safeQ = sanitizeQuizScreenForOutput(questionScreen);
  assert.equal(safeQ.stage, "question");
  if (safeQ.stage === "question") {
    assert.equal(safeQ.hiddenFields["authenticity_token"], "VALUES");
    assert.equal(safeQ.hiddenFields["quiz_id"], "999");
  }

  const summaryScreen = {
    stage: "summary" as const,
    finishAction: "/student_take_quiz_assignment/finish/999",
    authenticityToken: "raw_finish_token",
    summaryItems: [],
  };

  const safeS = sanitizeQuizScreenForOutput(summaryScreen);
  assert.equal(safeS.stage, "summary");
  if (safeS.stage === "summary") {
    assert.equal(safeS.authenticityToken, "VALUES");
  }
});
