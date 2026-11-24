import type { ParsedQuestionScreen } from "./quiz.types.js";

export type LlmProviderName = "gemini" | "openai" | "anthropic" | "mock";

export type AnswerLanguage = "ar" | "en";

export type LanguagePreference = "auto" | AnswerLanguage;

export interface LlmProviderConfig {
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface QuestionImageInline {
  url: string;
  mimeType: string;
  base64: string;
}

export interface LlmQuestionInput {
  part: number;
  totalParts: number;
  screen: ParsedQuestionScreen;
  quizTitle?: string;
  subjectHint?: string;
  lessonTitle?: string;
  targetLanguage: AnswerLanguage;
  images?: QuestionImageInline[];
  validationFeedback?: string;
}

export interface GeneratedFilePayload {
  fileName: string;
  mimeType: string;
  content: string;
}

export interface BaseLlmAnswerMeta {
  language: AnswerLanguage;
  confidence: number;
  reasoning: string;
}

export interface SingleChoiceLlmAnswer extends BaseLlmAnswerMeta {
  kind: "single_choice";
  selectedValue: string;
}

export interface MultipleChoiceLlmAnswer extends BaseLlmAnswerMeta {
  kind: "multiple_choice";
  selectedValues: string[];
}

export interface StructuredInputLlmAnswer extends BaseLlmAnswerMeta {
  kind: "structured_input";
  fields: Record<string, string>;
}

export interface FreeTextLlmAnswer extends BaseLlmAnswerMeta {
  kind: "free_text";
  text: string;
}

export interface FileUploadLlmAnswer extends BaseLlmAnswerMeta {
  kind: "file_upload";
  accompanyingText: string;
  generatedFile?: GeneratedFilePayload;
}

export type LlmSolvedAnswer =
  | SingleChoiceLlmAnswer
  | MultipleChoiceLlmAnswer
  | StructuredInputLlmAnswer
  | FreeTextLlmAnswer
  | FileUploadLlmAnswer;

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer>;
}
