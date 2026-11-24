import { API_BASE_URL } from "./api.js";

export interface QuestionChoice {
  value: string;
  label: string;
  checked: boolean;
  fieldName?: string;
}

export interface QuestionFieldDetail {
  name: string;
  type: string;
  tagName: string;
  value?: string;
  checked?: boolean;
  options?: string[];
  selectOptions?: Array<{ value: string; label: string; selected: boolean }>;
  contextLabel?: string;
}

export interface ReviewQuestion {
  id: string;
  part: number;
  questionHeader: string | null;
  promptText: string | null;
  points: string | null;
  inputType: string | null;
  choices: QuestionChoice[] | null;
  fieldDetails: QuestionFieldDetail[] | null;
  imageUrls: string[];
  userOverrideAnswer: Record<string, string | string[]> | null;
}

export type AnswerFields = Record<string, string | string[]>;

export function questionImageUrl(
  quizId: string,
  part: number,
  index: number,
): string {
  return `${API_BASE_URL}/api/quizzes/${quizId}/questions/${part}/image/${index}`;
}

/**
 * Builds the initial editable answer-fields map for a question.
 * Priority: user override > checked choices > stored field values.
 */
export function initialAnswerFields(q: ReviewQuestion): AnswerFields {
  const fields: AnswerFields = {};
  if (q.userOverrideAnswer) return { ...q.userOverrideAnswer };

  if (q.inputType === "single_choice" && q.choices?.length) {
    const name = q.choices[0]?.fieldName ?? "answer";
    const checked = q.choices.find((c) => c.checked);
    if (checked) fields[name] = checked.value;
    return fields;
  }
  if (q.inputType === "multiple_choice" && q.choices?.length) {
    const name = q.choices[0]?.fieldName ?? "answer";
    fields[name] = q.choices.filter((c) => c.checked).map((c) => c.value);
    return fields;
  }
  for (const f of q.fieldDetails ?? []) {
    if (f.tagName === "input" && f.type === "hidden") continue;
    if (fields[f.name] === undefined) {
      fields[f.name] = f.value ?? "";
    }
  }
  return fields;
}

/** Field details minus hidden inputs (not user-editable). */
export function editableFieldDetails(q: ReviewQuestion): QuestionFieldDetail[] {
  return (q.fieldDetails ?? []).filter(
    (f) => !(f.tagName === "input" && f.type === "hidden"),
  );
}
