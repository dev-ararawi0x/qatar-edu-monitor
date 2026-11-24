import type {
  lmsClasses,
  lmsQuizzes,
  quizAttemptQuestions,
} from "../db/schema/index.js";

type QuizRow = typeof lmsQuizzes.$inferSelect;
type ClassRow = typeof lmsClasses.$inferSelect;
type QuestionRow = typeof quizAttemptQuestions.$inferSelect;

export interface QuizDto {
  id: string;
  lmsQuizId: string;
  title: string;
  status: QuizRow["status"];
  isTimed: boolean;
  totalParts: number | null;
  summaryVerified: boolean;
  pausedSafely: boolean;
  warnings: string[];
  relatedLessonTitle: string | null;
  lastSolvedAt: string | null;
  finishedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface ClassDto {
  id: string;
  lmsClassId: string;
  title: string;
  teacherName: string | null;
  href: string | null;
  isManual: boolean;
  lastSyncedAt: string | null;
}

export interface ClassWithQuizzesDto extends ClassDto {
  quizzes: QuizDto[];
}

export interface QuestionDto {
  id: string;
  part: number;
  questionHeader: string | null;
  promptText: string | null;
  points: string | null;
  inputType: string | null;
  choices: unknown;
  fieldDetails: unknown;
  imageUrls: string[];
  aiAnswer: unknown;
  userOverrideAnswer: unknown;
  formattedSummary: string | null;
  lmsRecordedAnswer: string | null;
  confidence: number | null;
  reasoning: string | null;
  isVerifiedOnLms: boolean;
}

export function toQuizDto(row: QuizRow): QuizDto {
  return {
    id: row.id,
    lmsQuizId: row.lmsQuizId,
    title: row.title,
    status: row.status,
    isTimed: row.isTimed,
    totalParts: row.totalParts,
    summaryVerified: row.summaryVerified,
    pausedSafely: row.pausedSafely,
    warnings: row.warnings ?? [],
    relatedLessonTitle: row.relatedLessonTitle,
    lastSolvedAt: row.lastSolvedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toClassDto(row: ClassRow): ClassDto {
  return {
    id: row.id,
    lmsClassId: row.lmsClassId,
    title: row.title,
    teacherName: row.teacherName ?? null,
    href: row.href ?? null,
    isManual: row.isManual,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };
}

export function toQuestionDto(row: QuestionRow): QuestionDto {
  return {
    id: row.id,
    part: row.part,
    questionHeader: row.questionHeader,
    promptText: row.promptText,
    points: row.points,
    inputType: row.inputType,
    choices: row.choices ?? null,
    fieldDetails: row.fieldDetails ?? null,
    imageUrls: row.imageUrls ?? [],
    aiAnswer: row.aiAnswer ?? null,
    userOverrideAnswer: row.userOverrideAnswer ?? null,
    formattedSummary: row.formattedSummary,
    lmsRecordedAnswer: row.lmsRecordedAnswer,
    confidence: row.confidence,
    reasoning: row.reasoning,
    isVerifiedOnLms: row.isVerifiedOnLms,
  };
}
