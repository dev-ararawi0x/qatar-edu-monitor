import * as cheerio from "cheerio";
import type {
  InitQuizConfig,
  ParsedQuizScreen,
  ParsedSummaryScreen,
  QuestionChoice,
  QuestionFieldDetail,
  QuizInputType,
  QuizShowInfo,
  SelectOption,
} from "../types/index.js";
import { cleanText } from "./shared.js";

export function parseQuizShowPage(html: string): QuizShowInfo {
  const $ = cheerio.load(html);

  const title =
    cleanText($("#fixedSectionHeader h2, .section_header_wrap h2").first().text()) ||
    cleanText($("title").text());

  const csrfToken =
    $('meta[name="csrf-token"]').attr("content")?.trim() || null;

  const actionLink = $(
    '#mainContent a[href*="/student_take_quiz_assignment/"], a[href*="/student_take_quiz_assignment/"]',
  ).first();
  const actionButtonText = cleanText(actionLink.text()) || null;
  const actionButtonHref = actionLink.attr("href")?.trim() || null;

  const isResumeAttempt =
    (actionButtonHref ? actionButtonHref.includes("results=") : false) ||
    (actionButtonText
      ? actionButtonText.includes("استئناف") ||
        actionButtonText.toLowerCase().includes("resume")
      : false);

  const sidebarDetails: string[] = [];
  $("aside.rightColumn .block li, aside.rightColumn .block p").each((_, el) => {
    const txt = cleanText($(el).text());
    if (txt && !txt.includes("نشر")) {
      sidebarDetails.push(txt);
    }
  });

  return {
    title,
    csrfToken,
    actionButtonText,
    actionButtonHref,
    isResumeAttempt,
    sidebarDetails,
  };
}

export function parseInitQuizConfig(html: string): InitQuizConfig | null {
  const match = html.match(/init_quiz\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!match?.[1]) return null;

  const block = match[1];
  const readNum = (key: string): number | null => {
    const m = block.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
    return m?.[1] ? Number(m[1]) : null;
  };
  const readBool = (key: string): boolean => {
    const m = block.match(new RegExp(`${key}\\s*:\\s*(true|false)`));
    return m?.[1] === "true";
  };

  return {
    quizId: readNum("quiz_id"),
    resultsId: readNum("results_id"),
    part: readNum("part"),
    parts: readNum("parts"),
    timedQuiz: readBool("timed_quiz"),
    timeLeft: readNum("time_left"),
    resumeRefresh: readBool("resume_refresh"),
  };
}

export function isAnswerFieldName(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === "answer" ||
    lower.startsWith("answer[") ||
    lower === "answers" ||
    lower.startsWith("answers[") ||
    lower.startsWith("answer_file")
  );
}

function extractFieldContextLabel(
  $: cheerio.CheerioAPI,
  activeForm: ReturnType<cheerio.CheerioAPI>,
  fieldRef: ReturnType<cheerio.CheerioAPI>,
  name: string,
): string | undefined {
  const id = fieldRef.attr("id");
  if (id) {
    const explicitLabel = cleanText(activeForm.find(`label[for="${id}"]`).first().text());
    if (explicitLabel) return explicitLabel;
  }

  const wrappingLabel = cleanText(fieldRef.closest("label").text());
  if (wrappingLabel) return wrappingLabel;

  const prevLabel = cleanText(fieldRef.prev("label").text());
  if (prevLabel) return prevLabel;

  const container = fieldRef.closest("p, li, tr, .blank_row, .question_item").first();
  if (container.length > 0) {
    const clone = container.clone();
    clone.find("input, select, textarea").each((_, inputNode) => {
      if (inputNode.type !== "tag") return;
      const inputName = $(inputNode).attr("name") || "";
      if (inputName === name) {
        $(inputNode).replaceWith(` [BLANK: ${name}] `);
      } else {
        $(inputNode).replaceWith(" [...] ");
      }
    });
    const snippet = cleanText(clone.text()).slice(0, 180);
    if (snippet) return snippet;
  }

  return undefined;
}

export function parseQuizScreen(htmlOrFragment: string): ParsedQuizScreen {
  const $ = cheerio.load(htmlOrFragment);

  const finishForm = $(
    'form[action*="/student_take_quiz_assignment/finish/"], form[action*="finish"]',
  ).first();
  const headingText = cleanText($("h2.quiz_question").first().text());

  if (finishForm.length > 0 || headingText.includes("نهاية الاختبار")) {
    const finishAction = finishForm.attr("action") || "";
    const authenticityToken =
      finishForm.find('input[name="authenticity_token"]').attr("value") || null;

    const summaryItems: ParsedSummaryScreen["summaryItems"] = [];
    $(".materialStyle").each((_, el) => {
      const qTitle = cleanText($(el).find("h2").first().text());
      if (!qTitle) return;

      const paragraphs = $(el).find("p");
      const answerP = paragraphs
        .filter((_, p) => $(p).text().includes("الإجابة"))
        .first();
      const recordedAnswer = cleanText(answerP.text());

      const fullText = cleanText($(el).text());
      const promptPreview = fullText
        .replace(qTitle, "")
        .replace(recordedAnswer, "")
        .trim()
        .slice(0, 160);

      summaryItems.push({
        questionTitle: qTitle,
        promptPreview,
        recordedAnswer: recordedAnswer || "(غير محدد)",
      });
    });

    return {
      stage: "summary",
      finishAction,
      authenticityToken,
      summaryItems,
    };
  }

  const form = $("#question_form").first();
  const activeForm = form.length > 0 ? form : $("form").first();
  const action = activeForm.attr("action") || "";
  const enctype = activeForm.attr("enctype") || "application/x-www-form-urlencoded";

  const hiddenFields: Record<string, string> = {};
  activeForm.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    hiddenFields[name] = $(el).attr("value") ?? "";
  });

  const points = cleanText($(".quiz_points").first().text());
  const promptContainer = activeForm.find(".materialStyle").first();
  const promptText = cleanText(
    promptContainer.text() ||
      activeForm.find("h2, h3, .question_prompt, .materialStyle").first().text(),
  );

  const imageUrls: string[] = [];
  activeForm.find("img").each((_, img) => {
    const src = $(img).attr("src");
    if (src) imageUrls.push(src);
  });

  const fieldDetails: QuestionFieldDetail[] = [];
  const choices: QuestionChoice[] = [];
  const structuredAnswers: Record<string, string | string[]> = {};
  const formFieldNames: string[] = [];
  const fileInputNames: string[] = [];

  let hasPlainTextInput = false;
  let hasRichTextEditor = false;
  let hasFileUpload = false;

  activeForm.find("input[name], textarea[name], select[name]").each((_, el) => {
    if (el.type !== "tag") return;
    const name = $(el).attr("name");
    if (!name) return;
    if (!formFieldNames.includes(name)) {
      formFieldNames.push(name);
    }

    const tagName = el.tagName.toLowerCase() as QuestionFieldDetail["tagName"];
    const type = ($(el).attr("type") || "").toLowerCase();

    let value = "";
    if (tagName === "textarea") {
      value = $(el).text() || ($(el).val() as string) || "";
    } else if (tagName === "select") {
      const selectedOpt = $(el).find("option:selected").first();
      value =
        selectedOpt.attr("value") ??
        cleanText(selectedOpt.text()) ??
        ($(el).val() as string) ??
        "";
    } else {
      value = ($(el).attr("value") as string) ?? ($(el).val() as string) ?? "";
    }

    const checked = $(el).is(":checked");
    const classAttr = ($(el).attr("class") || "").toLowerCase();
    const hasEditor =
      classAttr.includes("ckeditor") ||
      classAttr.includes("haseditor") ||
      classAttr.includes("wysiwyg") ||
      classAttr.includes("editor") ||
      $(el).closest("[id*='editor'], [class*='editor']").length > 0;

    const isAnswer = isAnswerFieldName(name);

    if (isAnswer) {
      if (type === "file" || tagName === "file") {
        hasFileUpload = true;
        if (!fileInputNames.includes(name)) fileInputNames.push(name);
      }

      if (tagName === "textarea" || type === "text" || tagName === "select") {
        hasPlainTextInput = true;
        if (hasEditor) {
          hasRichTextEditor = true;
        }
        if (typeof value === "string" && value.trim()) {
          if (Array.isArray(structuredAnswers[name])) {
            (structuredAnswers[name] as string[]).push(value);
          } else if (structuredAnswers[name] !== undefined) {
            structuredAnswers[name] = [structuredAnswers[name] as string, value];
          } else {
            structuredAnswers[name] = value;
          }
        }
      }
    }

    let options: string[] | undefined;
    let selectOptions: SelectOption[] | undefined;
    if (tagName === "select") {
      const parsedOpts: SelectOption[] = [];
      $(el)
        .find("option")
        .each((_, opt) => {
          if (opt.type !== "tag") return;
          const optLabel = cleanText($(opt).text());
          const optValue = $(opt).attr("value") ?? optLabel;
          const isSelected = $(opt).is(":selected") || $(opt).attr("selected") !== undefined;
          if (optLabel || optValue) {
            parsedOpts.push({
              value: optValue,
              label: optLabel || optValue,
              selected: isSelected,
            });
          }
        });
      if (parsedOpts.length > 0) {
        selectOptions = parsedOpts;
        options = parsedOpts.map((o) => o.label || o.value).filter(Boolean);
      }
    }

    const contextLabel =
      isAnswer && type !== "hidden"
        ? extractFieldContextLabel($, activeForm, $(el), name)
        : undefined;

    fieldDetails.push({
      name,
      type: type || tagName,
      tagName,
      ...(typeof value === "string" && value ? { value } : {}),
      ...(checked ? { checked: true } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(selectOptions && selectOptions.length > 0 ? { selectOptions } : {}),
      ...(contextLabel ? { contextLabel } : {}),
    });
  });

  // Detect file upload containers or file inputs even if not directly in name list
  const fileContainers = activeForm.find(
    "#filecontainer, #filelist, input[type='file'], [id*='upload'], [class*='upload']",
  );
  if (fileContainers.length > 0) {
    hasFileUpload = true;
    fileContainers.each((_, el) => {
      if (el.type !== "tag") return;
      const fName = $(el).attr("name");
      if (fName && !fileInputNames.includes(fName)) {
        fileInputNames.push(fName);
      }
    });
  }

  // Also check rich text editors inside form
  if (
    activeForm.find(
      "textarea.hasEditor, textarea.cke_source, .cke_editable, [contenteditable='true']",
    ).length > 0
  ) {
    hasRichTextEditor = true;
    hasPlainTextInput = true;
  }

  // Choice inputs: radio or checkbox, matching answer / answer[...] / answers / answers[...]
  const radioInputs = activeForm.find(
    'input[type="radio"][name="answer"], input[type="radio"][name^="answer["], input[type="radio"][name="answers"], input[type="radio"][name^="answers["]',
  );
  const checkboxInputs = activeForm.find(
    'input[type="checkbox"][name="answer"], input[type="checkbox"][name^="answer["], input[type="checkbox"][name="answers"], input[type="checkbox"][name^="answers["]',
  );

  if (radioInputs.length > 0) {
    radioInputs.each((_, r) => {
      if (r.type !== "tag") return;
      const id = $(r).attr("id");
      const fieldName = $(r).attr("name") || "answer";
      const value = $(r).attr("value") || "";
      const checked = $(r).is(":checked");
      const label = id
        ? cleanText(activeForm.find(`label[for="${id}"]`).text())
        : cleanText($(r).closest("label").text());
      choices.push({ value, label: label || value, checked, fieldName });
    });
  } else if (checkboxInputs.length > 0) {
    checkboxInputs.each((_, cb) => {
      if (cb.type !== "tag") return;
      const id = $(cb).attr("id");
      const fieldName = $(cb).attr("name") || "answer[]";
      const value = $(cb).attr("value") || "";
      const checked = $(cb).is(":checked");
      const label = id
        ? cleanText(activeForm.find(`label[for="${id}"]`).text())
        : cleanText($(cb).closest("label").text());
      choices.push({ value, label: label || value, checked, fieldName });
    });
  }

  // Determine inputType accurately even when multi-blank inputs are currently empty
  const fillableAnswerFields = fieldDetails.filter(
    (f) =>
      isAnswerFieldName(f.name) &&
      (f.tagName === "textarea" ||
        f.tagName === "select" ||
        (f.tagName === "input" &&
          f.type !== "radio" &&
          f.type !== "checkbox" &&
          f.type !== "hidden" &&
          f.type !== "file")),
  );
  const distinctAnswerFieldNames = Array.from(
    new Set(fillableAnswerFields.map((f) => f.name)),
  );
  const hasBracketedFillable = distinctAnswerFieldNames.some((n) => n.includes("["));
  const hasSelect = fillableAnswerFields.some((f) => f.tagName === "select");

  let inputType: QuizInputType = "unknown";
  if (hasFileUpload && choices.length === 0) {
    inputType = "file_upload";
  } else if (choices.length > 0) {
    const isMultiple = checkboxInputs.length > 0 && radioInputs.length === 0;
    inputType = isMultiple ? "multiple_choice" : "single_choice";
  } else if (hasPlainTextInput) {
    if (
      distinctAnswerFieldNames.length > 1 ||
      hasSelect ||
      (hasBracketedFillable && !hasRichTextEditor)
    ) {
      inputType = "structured_input";
    } else {
      inputType = "free_text";
    }
  } else if (hasFileUpload) {
    inputType = "file_upload";
  }

  const primaryAnswerKey = Object.keys(structuredAnswers)[0];
  const rawCurrentAnswer = primaryAnswerKey
    ? structuredAnswers[primaryAnswerKey]
    : "";
  const currentTextAnswer = Array.isArray(rawCurrentAnswer)
    ? rawCurrentAnswer.join(" | ")
    : typeof rawCurrentAnswer === "string"
      ? rawCurrentAnswer
      : "";

  return {
    stage: "question",
    questionHeader: headingText,
    points,
    action,
    enctype,
    hiddenFields,
    promptText,
    imageUrls,
    inputType,
    hasRichTextEditor,
    hasPlainTextInput,
    hasFileUpload,
    fileInputNames,
    fieldDetails,
    choices,
    currentTextAnswer,
    structuredAnswers,
    formFieldNames,
  };
}
