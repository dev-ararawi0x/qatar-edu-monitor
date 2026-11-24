import type { LlmQuestionInput, QuestionFieldDetail } from "../types/index.js";
import { isAnswerFieldName } from "../parsers/quiz.parser.js";

export interface BuiltLlmPrompt {
  systemInstruction: string;
  userPrompt: string;
}

export function getFillableAnswerFields(
  fieldDetails: QuestionFieldDetail[],
): QuestionFieldDetail[] {
  return fieldDetails.filter(
    (f) =>
      isAnswerFieldName(f.name) &&
      f.type !== "hidden" &&
      f.type !== "radio" &&
      f.type !== "checkbox" &&
      f.type !== "file" &&
      f.tagName !== "file",
  );
}

export function buildQuestionPrompts(input: LlmQuestionInput): BuiltLlmPrompt {
  const {
    part,
    totalParts,
    screen,
    quizTitle,
    subjectHint,
    lessonTitle,
    targetLanguage,
    validationFeedback,
  } = input;

  const langDirective =
    targetLanguage === "ar"
      ? "Write all textual answers, fill-in-the-blank words, and file contents in clear, accurate Modern Standard Arabic (العربية الفصحى), preserving mathematical numbers, formulas, code syntax, or standard scientific symbols only where required by the subject."
      : "Write all textual answers, fill-in-the-blank words, and file contents in clear, accurate academic English.";

  const systemInstruction = [
    "You are an expert academic tutor and assessment solver for the Qatar Education curriculum.",
    "Carefully analyze the quiz question, subject context, options/fields, and any attached images.",
    langDirective,
    "CRITICAL OUTPUT RULE: Respond ONLY with a single valid JSON object matching the requested schema. Do NOT wrap in markdown explanations or include extra keys outside the schema.",
  ].join("\n");

  const sections: string[] = [];
  sections.push(`Question Part: ${part} of ${totalParts}`);
  if (subjectHint) sections.push(`Subject Hint: ${subjectHint}`);
  if (quizTitle) sections.push(`Quiz Title: ${quizTitle}`);
  if (lessonTitle) sections.push(`Related Lesson: ${lessonTitle}`);
  if (screen.points) sections.push(`Points: ${screen.points}`);
  sections.push(`Required Answer Language: ${targetLanguage === "ar" ? "Arabic (ar)" : "English (en)"}`);
  sections.push(`Question Type: ${screen.inputType}`);
  sections.push("");
  if (screen.questionHeader) {
    sections.push(`Question Heading: ${screen.questionHeader}`);
  }
  sections.push(`Question Prompt:\n${screen.promptText || "(See heading / fields / attached images)"}`);
  sections.push("");

  if (screen.inputType === "single_choice") {
    sections.push("Available Choices (pick EXACTLY ONE by its exact `value` string):");
    screen.choices.forEach((c, idx) => {
      sections.push(`  ${idx + 1}. value=${JSON.stringify(c.value)} | label=${JSON.stringify(c.label)}`);
    });
    sections.push("");
    sections.push(
      `Return JSON matching:\n{"kind":"single_choice","selectedValue":"<exact value from choices>","language":"${targetLanguage}","confidence":0.95,"reasoning":"<concise explanation>"}`,
    );
  } else if (screen.inputType === "multiple_choice") {
    sections.push("Available Checkbox Choices (pick ALL correct items using their exact `value` strings):");
    screen.choices.forEach((c, idx) => {
      sections.push(`  ${idx + 1}. value=${JSON.stringify(c.value)} | label=${JSON.stringify(c.label)}`);
    });
    sections.push("");
    sections.push(
      `Return JSON matching:\n{"kind":"multiple_choice","selectedValues":["<exact value 1>"],"language":"${targetLanguage}","confidence":0.95,"reasoning":"<concise explanation>"}`,
    );
  } else if (screen.inputType === "structured_input") {
    const fillable = getFillableAnswerFields(screen.fieldDetails);
    sections.push("Fillable Blank / Matching / Dropdown Fields (provide an entry for EVERY field name):");
    for (const f of fillable) {
      const ctxInfo = f.contextLabel ? ` | context=${JSON.stringify(f.contextLabel)}` : "";
      if (f.selectOptions && f.selectOptions.length > 0) {
        const optsDesc = f.selectOptions
          .map((o) => `{value:${JSON.stringify(o.value)}, label:${JSON.stringify(o.label)}}`)
          .join(", ");
        sections.push(`  - field=${JSON.stringify(f.name)} (dropdown <select>)${ctxInfo}\n    Allowed options (MUST return exact option.value): [${optsDesc}]`);
      } else {
        sections.push(`  - field=${JSON.stringify(f.name)} (${f.tagName} ${f.type})${ctxInfo}`);
      }
    }
    sections.push("");
    sections.push(
      `Return JSON matching:\n{"kind":"structured_input","fields":{"<fieldName>":"<exact dropdown value or blank answer>"},"language":"${targetLanguage}","confidence":0.95,"reasoning":"<concise explanation>"}`,
    );
  } else if (screen.inputType === "file_upload") {
    sections.push(
      `This question includes file upload input(s): [${screen.fileInputNames.join(", ") || "answer_file"}] and plain/rich text support=${screen.hasPlainTextInput}.`,
    );
    sections.push(
      "Provide both a concise accompanying text answer AND a complete, well-formatted attachment file (`.md` or `.txt` or `.html`) answering the question thoroughly.",
    );
    sections.push("");
    sections.push(
      `Return JSON matching:\n{"kind":"file_upload","accompanyingText":"<text field summary>","generatedFile":{"fileName":"solution-part-${part}.md","mimeType":"text/markdown","content":"<full solution document>"},"language":"${targetLanguage}","confidence":0.9,"reasoning":"<concise explanation>"}`,
    );
  } else {
    // free_text or unknown fallback
    sections.push(
      `Editor Mode: ${screen.hasRichTextEditor ? "Rich Text (plain paragraphs will be formatted automatically)" : "Plain Text"}`,
    );
    sections.push("");
    sections.push(
      `Return JSON matching:\n{"kind":"free_text","text":"<complete answer in ${targetLanguage === "ar" ? "Arabic" : "English"}>","language":"${targetLanguage}","confidence":0.92,"reasoning":"<concise explanation>"}`,
    );
  }

  if (validationFeedback) {
    sections.push("");
    sections.push(
      `PREVIOUS ATTEMPT VALIDATION ERROR (you MUST fix this): ${validationFeedback}`,
    );
  }

  return {
    systemInstruction,
    userPrompt: sections.join("\n"),
  };
}
