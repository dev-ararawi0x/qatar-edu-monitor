import type {
  AnswerLanguage,
  LlmSolvedAnswer,
  ParsedQuestionScreen,
  QuestionChoice,
  SelectOption,
} from "../types/index.js";
import { getFillableAnswerFields } from "./prompt-builder.js";

export class AnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerValidationError";
  }
}

export function parseRawLlmJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new AnswerValidationError("LLM returned an empty response.");
  }

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Try extracting the outermost JSON object if extra prose leaked around it
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const slice = candidate.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // fall through
      }
    }
    throw new AnswerValidationError("LLM response was not valid JSON.");
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatRichTextIfNeeded(text: string, hasRichTextEditor: boolean): string {
  const trimmed = text.trim();
  if (!hasRichTextEditor) return trimmed;
  if (/^<(?:p|div|ul|ol|h[1-6]|table)\b/i.test(trimmed)) {
    return trimmed;
  }
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return paragraphs.join("\n") || `<p>${escapeHtml(trimmed)}</p>`;
}

function resolveChoiceValue(candidate: string, choices: QuestionChoice[]): string | null {
  const raw = candidate.trim();
  const exact = choices.find((c) => c.value === raw);
  if (exact) return exact.value;

  const lower = raw.toLowerCase();
  const caseInsensitiveVal = choices.find((c) => c.value.trim().toLowerCase() === lower);
  if (caseInsensitiveVal) return caseInsensitiveVal.value;

  const labelMatches = choices.filter((c) => c.label.trim().toLowerCase() === lower);
  if (labelMatches.length === 1 && labelMatches[0]) {
    return labelMatches[0].value;
  }
  return null;
}

function resolveSelectOptionValue(
  candidate: string,
  options: SelectOption[],
): string | null {
  const nonPlaceholder = options.filter((o) => o.value !== "" || options.length === 1);
  const pool = nonPlaceholder.length > 0 ? nonPlaceholder : options;
  const raw = candidate.trim();

  const exact = pool.find((o) => o.value === raw);
  if (exact) return exact.value;

  const lower = raw.toLowerCase();
  const ciVal = pool.find((o) => o.value.trim().toLowerCase() === lower);
  if (ciVal) return ciVal.value;

  const labelMatches = pool.filter((o) => o.label.trim().toLowerCase() === lower);
  if (labelMatches.length === 1 && labelMatches[0]) {
    return labelMatches[0].value;
  }
  return null;
}

function normalizeConfidence(val: unknown): number {
  const num = typeof val === "number" ? val : Number(val);
  if (Number.isNaN(num)) return 0.8;
  return Math.max(0, Math.min(1, num));
}

function sanitizeGeneratedFileName(rawName: string, partFallback = 1): string {
  const cleaned = rawName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return `solution-part-${partFallback}.md`;
  return cleaned.includes(".") ? cleaned : `${cleaned}.txt`;
}

export function validateAndNormalizeLlmAnswer(
  raw: unknown,
  screen: ParsedQuestionScreen,
  targetLanguage: AnswerLanguage,
): LlmSolvedAnswer {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnswerValidationError("LLM JSON root must be an object.");
  }

  const obj = raw as Record<string, unknown>;
  const language: AnswerLanguage =
    obj["language"] === "ar" || obj["language"] === "en"
      ? obj["language"]
      : targetLanguage;
  const confidence = normalizeConfidence(obj["confidence"]);
  const reasoning = typeof obj["reasoning"] === "string" ? obj["reasoning"].trim() : "";

  if (screen.inputType === "single_choice") {
    const rawCandidate =
      typeof obj["selectedValue"] === "string"
        ? obj["selectedValue"]
        : typeof obj["answer"] === "string"
          ? obj["answer"]
          : typeof obj["value"] === "string"
            ? obj["value"]
            : "";

    if (!rawCandidate.trim()) {
      throw new AnswerValidationError(
        `Missing "selectedValue" for single_choice question. Valid values: [${screen.choices.map((c) => c.value).join(", ")}]`,
      );
    }

    const resolved = resolveChoiceValue(rawCandidate, screen.choices);
    if (resolved === null) {
      throw new AnswerValidationError(
        `Invalid choice "${rawCandidate}". Must be one of exact choice values: [${screen.choices.map((c) => JSON.stringify(c.value)).join(", ")}]`,
      );
    }

    return {
      kind: "single_choice",
      selectedValue: resolved,
      language,
      confidence,
      reasoning,
    };
  }

  if (screen.inputType === "multiple_choice") {
    const rawList = Array.isArray(obj["selectedValues"])
      ? obj["selectedValues"]
      : typeof obj["selectedValues"] === "string"
        ? [obj["selectedValues"]]
        : Array.isArray(obj["answer"])
          ? obj["answer"]
          : [];

    const normalizedValues: string[] = [];
    for (const item of rawList) {
      if (typeof item !== "string" && typeof item !== "number") continue;
      const resolved = resolveChoiceValue(String(item), screen.choices);
      if (resolved === null) {
        throw new AnswerValidationError(
          `Invalid checkbox choice "${String(item)}". Valid values: [${screen.choices.map((c) => JSON.stringify(c.value)).join(", ")}]`,
        );
      }
      if (!normalizedValues.includes(resolved)) {
        normalizedValues.push(resolved);
      }
    }

    if (normalizedValues.length === 0) {
      throw new AnswerValidationError(
        `At least one valid choice must be selected in "selectedValues". Valid values: [${screen.choices.map((c) => JSON.stringify(c.value)).join(", ")}]`,
      );
    }

    return {
      kind: "multiple_choice",
      selectedValues: normalizedValues,
      language,
      confidence,
      reasoning,
    };
  }

  if (screen.inputType === "structured_input") {
    const rawFields =
      obj["fields"] && typeof obj["fields"] === "object" && !Array.isArray(obj["fields"])
        ? (obj["fields"] as Record<string, unknown>)
        : {};

    const fillable = getFillableAnswerFields(screen.fieldDetails);
    const normalizedFields: Record<string, string> = {};

    for (const field of fillable) {
      const candidateVal = rawFields[field.name];
      const strVal =
        typeof candidateVal === "string" || typeof candidateVal === "number"
          ? String(candidateVal).trim()
          : "";

      if (!strVal) {
        throw new AnswerValidationError(
          `Missing or empty answer for structured field "${field.name}". Required fields: [${fillable.map((f) => f.name).join(", ")}]`,
        );
      }

      if (field.selectOptions && field.selectOptions.length > 0) {
        const resolvedOpt = resolveSelectOptionValue(strVal, field.selectOptions);
        if (resolvedOpt === null) {
          throw new AnswerValidationError(
            `Invalid dropdown value "${strVal}" for field "${field.name}". Allowed option values: [${field.selectOptions.map((o) => JSON.stringify(o.value)).join(", ")}]`,
          );
        }
        normalizedFields[field.name] = resolvedOpt;
      } else {
        normalizedFields[field.name] = strVal;
      }
    }

    return {
      kind: "structured_input",
      fields: normalizedFields,
      language,
      confidence,
      reasoning,
    };
  }

  if (screen.inputType === "file_upload") {
    const accompanyingRaw =
      typeof obj["accompanyingText"] === "string"
        ? obj["accompanyingText"]
        : typeof obj["text"] === "string"
          ? obj["text"]
          : "";

    const rawFile =
      obj["generatedFile"] &&
      typeof obj["generatedFile"] === "object" &&
      !Array.isArray(obj["generatedFile"])
        ? (obj["generatedFile"] as Record<string, unknown>)
        : undefined;

    let generatedFile:
      | { fileName: string; mimeType: string; content: string }
      | undefined;

    if (rawFile && typeof rawFile["content"] === "string" && rawFile["content"].trim()) {
      const fileName = sanitizeGeneratedFileName(
        typeof rawFile["fileName"] === "string" ? rawFile["fileName"] : "solution.md",
      );
      const mimeType =
        typeof rawFile["mimeType"] === "string" && rawFile["mimeType"].trim()
          ? rawFile["mimeType"].trim()
          : fileName.endsWith(".html")
            ? "text/html; charset=utf-8"
            : fileName.endsWith(".md")
              ? "text/markdown; charset=utf-8"
              : "text/plain; charset=utf-8";

      generatedFile = {
        fileName,
        mimeType,
        content: rawFile["content"],
      };
    }

    if (!accompanyingRaw.trim() && !generatedFile) {
      throw new AnswerValidationError(
        "file_upload response must include non-empty generatedFile.content or accompanyingText.",
      );
    }

    return {
      kind: "file_upload",
      accompanyingText: accompanyingRaw.trim()
        ? formatRichTextIfNeeded(accompanyingRaw, screen.hasRichTextEditor)
        : "",
      ...(generatedFile ? { generatedFile } : {}),
      language,
      confidence,
      reasoning,
    };
  }

  // Default: free_text (or unknown with text fallback)
  const rawText =
    typeof obj["text"] === "string"
      ? obj["text"]
      : typeof obj["answer"] === "string"
        ? obj["answer"]
        : "";

  if (!rawText.trim()) {
    throw new AnswerValidationError('Missing non-empty "text" for free_text question.');
  }

  return {
    kind: "free_text",
    text: formatRichTextIfNeeded(rawText, screen.hasRichTextEditor),
    language,
    confidence,
    reasoning,
  };
}
