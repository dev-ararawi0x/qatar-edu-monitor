import type {
  AnswerLanguage,
  LlmProviderName,
  LlmSolvedAnswer,
} from "./llm.types.js";
import type { SanitizedFileAttachmentMeta } from "./http.types.js";

export interface QuizShowInfo {
  title: string;
  csrfToken: string | null;
  actionButtonText: string | null;
  actionButtonHref: string | null;
  isResumeAttempt: boolean;
  sidebarDetails: string[];
}

export interface InitQuizConfig {
  quizId: number | null;
  resultsId: number | null;
  part: number | null;
  parts: number | null;
  timedQuiz: boolean;
  timeLeft: number | null;
  resumeRefresh: boolean;
}

export interface QuestionChoice {
  value: string;
  label: string;
  checked: boolean;
  fieldName?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

export type QuizInputType =
  | "single_choice"
  | "multiple_choice"
  | "free_text"
  | "structured_input"
  | "file_upload"
  | "unknown";

export interface QuestionFieldDetail {
  name: string;
  type: string;
  tagName: "input" | "textarea" | "select" | "file";
  value?: string;
  checked?: boolean;
  options?: string[];
  selectOptions?: SelectOption[];
  contextLabel?: string;
}

export interface ParsedQuestionScreen {
  stage: "question";
  questionHeader: string;
  points: string;
  action: string;
  enctype: string;
  hiddenFields: Record<string, string>;
  promptText: string;
  imageUrls: string[];
  inputType: QuizInputType;
  hasRichTextEditor: boolean;
  hasPlainTextInput: boolean;
  hasFileUpload: boolean;
  fileInputNames: string[];
  fieldDetails: QuestionFieldDetail[];
  choices: QuestionChoice[];
  currentTextAnswer: string;
  structuredAnswers: Record<string, string | string[]>;
  formFieldNames: string[];
}

export interface SummaryItem {
  questionTitle: string;
  promptPreview: string;
  recordedAnswer: string;
}

export interface ParsedSummaryScreen {
  stage: "summary";
  finishAction: string;
  authenticityToken: string | null;
  summaryItems: SummaryItem[];
}

export type ParsedQuizScreen = ParsedQuestionScreen | ParsedSummaryScreen;

export interface QuizPartQuestion {
  part: number;
  totalParts: number;
  screen: ParsedQuestionScreen;
}

export interface QuizDraftAttemptResult {
  dryRun: boolean;
  quizId: number;
  resultsId: number;
  totalParts: number;
  pausedSafely: boolean;
  reachedSummary: boolean;
  steps: Array<{
    part: number;
    questionHeader: string;
    sentAnswer: string;
    action: string;
    status?: number;
  }>;
  questions: QuizPartQuestion[];
  summaryItems?: SummaryItem[];
  finishAction?: string;
}

export type QuizExecutionMode = "dry-run" | "draft" | "submit-ready";

export type QuizSolverProgressStage =
  | "llm_solved"
  | "answer_posted"
  | "summary_reached"
  | "paused"
  | "aborted";

export interface QuizSolverProgressEvent {
  stage: QuizSolverProgressStage;
  part: number;
  totalParts: number;
  questionHeader?: string;
  formattedSummary?: string;
  status?: number;
}

export interface QuizSolveStepResult {
  part: number;
  questionHeader: string;
  inputType: QuizInputType;
  language: AnswerLanguage;
  solvedAnswer: LlmSolvedAnswer;
  formattedSummary: string;
  action: string;
  formFieldsSent: Record<string, string>;
  attachedFiles?: SanitizedFileAttachmentMeta[];
  status?: number;
}

export interface QuizSolveAttemptResult {
  mode: QuizExecutionMode;
  dryRun: boolean;
  provider: LlmProviderName;
  model: string;
  quizId: number;
  resultsId: number;
  quizTitle?: string;
  totalParts: number;
  pausedSafely: boolean;
  reachedSummary: boolean;
  summaryVerified: boolean;
  finishBlockedByGuardrail: boolean;
  warnings: string[];
  steps: QuizSolveStepResult[];
  questions: QuizPartQuestion[];
  summaryItems?: SummaryItem[];
  finishAction?: string;
}
