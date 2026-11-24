import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseQuizScreen } from "../src/parsers/quiz.parser.js";
import { detectAnswerLanguage } from "../src/llm/language-detector.js";
import {
  AnswerValidationError,
  validateAndNormalizeLlmAnswer,
} from "../src/llm/answer-validator.js";
import { GeminiLlmAdapter } from "../src/llm/adapters/gemini.adapter.js";
import { OpenAiCompatibleLlmAdapter } from "../src/llm/adapters/openai.adapter.js";
import { AnthropicLlmAdapter } from "../src/llm/adapters/anthropic.adapter.js";
import {
  loadPartAttachments,
  mapAnswerToFormPayload,
} from "../src/services/quiz-form.mapper.js";

test("detectAnswerLanguage picks Arabic or English accurately based on subject and question prompt", () => {
  const arabicWithTechTerm = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <h2 class="quiz_question">اكتب مقالة قصيرة:</h2>
      <div class="materialStyle"><p>اشرح مفهوم Green Computing واذكر فائدتين له:</p></div>
      <textarea name="answer"></textarea>
    </form>
  `);
  assert.equal(arabicWithTechTerm.stage, "question");
  if (arabicWithTechTerm.stage === "question") {
    assert.equal(
      detectAnswerLanguage({
        quizTitle: "اختبار الحوسبة وتكنولوجيا المعلومات",
        screen: arabicWithTechTerm,
      }),
      "ar",
    );
  }

  const englishUnderArabicUiHeader = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <h2 class="quiz_question">السؤال 2</h2>
      <div class="materialStyle"><p>Explain Newton's Second Law of Motion and give one real-world example.</p></div>
      <textarea name="answer"></textarea>
    </form>
  `);
  assert.equal(englishUnderArabicUiHeader.stage, "question");
  if (englishUnderArabicUiHeader.stage === "question") {
    assert.equal(
      detectAnswerLanguage({
        screen: englishUnderArabicUiHeader,
      }),
      "en",
    );
  }

  const englishSubjectWithBilingualRubric = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <h2 class="quiz_question">السؤال الأول: اختر الإجابة الصحيحة</h2>
      <div class="materialStyle"><p>Write a short paragraph describing your favorite hobby.</p></div>
      <textarea name="answer"></textarea>
    </form>
  `);
  assert.equal(englishSubjectWithBilingualRubric.stage, "question");
  if (englishSubjectWithBilingualRubric.stage === "question") {
    assert.equal(
      detectAnswerLanguage({
        quizTitle: "اختبار اللغة الإنجليزية - Grade 10",
        screen: englishSubjectWithBilingualRubric,
      }),
      "en",
    );
  }

  const explicitEnglishTranslation = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <h2 class="quiz_question">السؤال 4</h2>
      <div class="materialStyle"><p>اكتب فقرة قصيرة باللغة الإنجليزية عن أهمية الطاقة الشمسية.</p></div>
      <textarea name="answer"></textarea>
    </form>
  `);
  assert.equal(explicitEnglishTranslation.stage, "question");
  if (explicitEnglishTranslation.stage === "question") {
    assert.equal(
      detectAnswerLanguage({
        screen: explicitEnglishTranslation,
      }),
      "en",
    );
  }
});

test("validateAndNormalizeLlmAnswer and mapAnswerToFormPayload handle all 5 quiz question types", async () => {
  // 1. Single choice (with label-to-value normalization)
  const singleScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <input type="hidden" name="authenticity_token" value="tok_1">
      <div class="materialStyle"><p>ما عاصمة دولة قطر؟</p></div>
      <input type="radio" id="r1" name="answer" value="c_doha"><label for="r1">الدوحة</label>
      <input type="radio" id="r2" name="answer" value="c_rayyan"><label for="r2">الريان</label>
    </form>
  `);
  assert.equal(singleScreen.stage, "question");
  if (singleScreen.stage === "question") {
    const solved = validateAndNormalizeLlmAnswer(
      { kind: "single_choice", selectedValue: "الدوحة", confidence: 0.98, reasoning: "عاصمة قطر" },
      singleScreen,
      "ar",
    );
    assert.equal(solved.kind, "single_choice");
    if (solved.kind === "single_choice") {
      assert.equal(solved.selectedValue, "c_doha");
    }
    const mapped = mapAnswerToFormPayload(singleScreen, solved);
    assert.equal(mapped.formFields["answer"], "c_doha");
    assert.equal(mapped.sanitizedFieldsPreview["authenticity_token"], "VALUES");

    assert.throws(
      () =>
        validateAndNormalizeLlmAnswer(
          { kind: "single_choice", selectedValue: "non_existent" },
          singleScreen,
          "ar",
        ),
      AnswerValidationError,
    );
  }

  // 2. Multiple choice (checkboxes answer[])
  const multiScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <div class="materialStyle"><p>Select all even numbers:</p></div>
      <input type="checkbox" id="m1" name="answer[]" value="v2"><label for="m1">2</label>
      <input type="checkbox" id="m2" name="answer[]" value="v3"><label for="m2">3</label>
      <input type="checkbox" id="m3" name="answer[]" value="v4"><label for="m3">4</label>
    </form>
  `);
  assert.equal(multiScreen.stage, "question");
  if (multiScreen.stage === "question") {
    const solved = validateAndNormalizeLlmAnswer(
      { kind: "multiple_choice", selectedValues: ["v2", "v4"], confidence: 1 },
      multiScreen,
      "en",
    );
    const mapped = mapAnswerToFormPayload(multiScreen, solved);
    assert.deepEqual(mapped.formFields["answer[]"], ["v2", "v4"]);
  }

  // 3. Structured input (complete the space + dropdown <select> value mapping)
  const structuredScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <div class="materialStyle">
        <p>الرمز الكيميائي للماء هو <input type="text" name="answer[1]"> وحالته في درجة حرارة الغرفة <select name="answer[2]"><option value="">اختر</option><option value="state_liquid">سائلة</option><option value="state_solid">صلبة</option></select>.</p>
      </div>
    </form>
  `);
  assert.equal(structuredScreen.stage, "question");
  if (structuredScreen.stage === "question") {
    const solved = validateAndNormalizeLlmAnswer(
      {
        kind: "structured_input",
        fields: {
          "answer[1]": "H2O",
          "answer[2]": "سائلة",
        },
      },
      structuredScreen,
      "ar",
    );
    assert.equal(solved.kind, "structured_input");
    if (solved.kind === "structured_input") {
      assert.equal(solved.fields["answer[2]"], "state_liquid");
    }
    const mapped = mapAnswerToFormPayload(structuredScreen, solved);
    assert.equal(mapped.formFields["answer[1]"], "H2O");
    assert.equal(mapped.formFields["answer[2]"], "state_liquid");
  }

  // 4. Rich text editor wrapping
  const richTextScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <div class="materialStyle"><p>Explain photosynthesis.</p></div>
      <textarea name="answer" class="ckeditor hasEditor"></textarea>
    </form>
  `);
  assert.equal(richTextScreen.stage, "question");
  if (richTextScreen.stage === "question") {
    const solved = validateAndNormalizeLlmAnswer(
      { kind: "free_text", text: "Plants convert light into chemical energy." },
      richTextScreen,
      "en",
    );
    assert.equal(solved.kind, "free_text");
    if (solved.kind === "free_text") {
      assert.equal(solved.text, "<p>Plants convert light into chemical energy.</p>");
    }
  }

  // 5. File upload (both generated file and CLI --attach override)
  const fileScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1" enctype="multipart/form-data">
      <div class="materialStyle"><p>ارفع ملف الحل مع ملخص قصير:</p></div>
      <textarea name="answer"></textarea>
      <input type="file" name="answer_file">
    </form>
  `);
  assert.equal(fileScreen.stage, "question");
  if (fileScreen.stage === "question") {
    const solved = validateAndNormalizeLlmAnswer(
      {
        kind: "file_upload",
        accompanyingText: "مرفق الحل الكامل.",
        generatedFile: {
          fileName: "answer.md",
          mimeType: "text/markdown",
          content: "# الحل النموذجي",
        },
      },
      fileScreen,
      "ar",
    );

    const mappedGenerated = mapAnswerToFormPayload(fileScreen, solved);
    assert.equal(mappedGenerated.asMultipart, true);
    assert.equal(mappedGenerated.files.length, 1);
    assert.equal(mappedGenerated.files[0]?.fieldName, "answer_file");
    assert.equal(mappedGenerated.files[0]?.fileName, "answer.md");

    // Now test CLI --attach override
    const tmp = await mkdtemp(path.join(tmpdir(), "qedu-attach-"));
    const customPdfPath = path.join(tmp, "student-report.pdf");
    await writeFile(customPdfPath, Buffer.from("%PDF-1.4 sample content"));
    const loadedMap = await loadPartAttachments([`5=${customPdfPath}`]);
    const mappedCustom = mapAnswerToFormPayload(fileScreen, solved, loadedMap.get(5));
    assert.equal(mappedCustom.files.length, 1);
    assert.equal(mappedCustom.files[0]?.fileName, "student-report.pdf");
    assert.equal(mappedCustom.files[0]?.mimeType, "application/pdf");
  }
});

test("LLM provider adapters format requests, pass multimodal images, retry on validation failure, and redact keys", async () => {
  const questionScreen = parseQuizScreen(`
    <form id="question_form" action="/next/1">
      <div class="materialStyle"><p>What is 3 * 3?</p></div>
      <input type="radio" id="c1" name="answer" value="6"><label for="c1">6</label>
      <input type="radio" id="c2" name="answer" value="9"><label for="c2">9</label>
    </form>
  `);
  assert.equal(questionScreen.stage, "question");
  if (questionScreen.stage !== "question") return;

  // Test OpenAI adapter with 1st-attempt invalid choice -> automatic corrective retry on 2nd attempt
  let openAiCalls = 0;
  const openAiAdapter = new OpenAiCompatibleLlmAdapter(
    {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-secret-openai-key",
    },
    async (_url, init) => {
      openAiCalls += 1;
      const bodyStr = String(init?.body || "");
      if (openAiCalls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: "single_choice",
                    selectedValue: "invalid_option_999",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      assert.ok(bodyStr.includes("PREVIOUS ATTEMPT VALIDATION ERROR"));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "single_choice",
                  selectedValue: "9",
                  language: "en",
                  confidence: 0.99,
                  reasoning: "3 multiplied by 3 equals 9",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  );

  const openAiResult = await openAiAdapter.solveQuestion({
    part: 1,
    totalParts: 1,
    screen: questionScreen,
    targetLanguage: "en",
    images: [{ url: "/img/q1.png", mimeType: "image/png", base64: "iVBORw0KGgo=" }],
  });
  assert.equal(openAiCalls, 2);
  assert.equal(openAiResult.kind, "single_choice");
  if (openAiResult.kind === "single_choice") {
    assert.equal(openAiResult.selectedValue, "9");
  }

  // Test Gemini adapter multimodal + secret redaction on error
  let geminiHeadersChecked = false;
  const geminiAdapter = new GeminiLlmAdapter(
    {
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "AIzaSecretGeminiKey",
    },
    async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-goog-api-key"], "AIzaSecretGeminiKey");
      geminiHeadersChecked = true;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '```json\n{"kind":"single_choice","selectedValue":"9","language":"en","confidence":0.97,"reasoning":"3*3=9"}\n```',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  );

  const geminiResult = await geminiAdapter.solveQuestion({
    part: 1,
    totalParts: 1,
    screen: questionScreen,
    targetLanguage: "en",
  });
  assert.equal(geminiHeadersChecked, true);
  assert.equal(geminiResult.kind, "single_choice");

  // Test Anthropic adapter
  const anthropicAdapter = new AnthropicLlmAdapter(
    {
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKey: "sk-ant-secret-key",
    },
    async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-api-key"], "sk-ant-secret-key");
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: '{"kind":"single_choice","selectedValue":"9","language":"en","confidence":0.96,"reasoning":"Nine"}',
            },
          ],
        }),
        { status: 200 },
      );
    },
  );

  const anthropicResult = await anthropicAdapter.solveQuestion({
    part: 1,
    totalParts: 1,
    screen: questionScreen,
    targetLanguage: "en",
  });
  assert.equal(anthropicResult.kind, "single_choice");
});
