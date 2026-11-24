/** Arabic UI labels for LMS quiz/job statuses (single source of truth). */

export type QuizStatusKey =
  | "due_unsolved"
  | "queued"
  | "solving"
  | "ready_for_review"
  | "submitting_finish"
  | "finished"
  | "failed";

export const QUIZ_STATUS_LABELS: Record<QuizStatusKey, string> = {
  due_unsolved: "مستحق الحل",
  queued: "في الطابور",
  solving: "قيد الحل",
  ready_for_review: "جاهز للمراجعة",
  submitting_finish: "جارٍ التسليم",
  finished: "مُسلَّم",
  failed: "فشل",
};

export const QUIZ_STATUS_COLORS: Record<QuizStatusKey, string> = {
  due_unsolved: "bg-amber-100 text-amber-800",
  queued: "bg-sky-100 text-sky-800",
  solving: "bg-blue-100 text-blue-800",
  ready_for_review: "bg-emerald-100 text-emerald-800",
  submitting_finish: "bg-violet-100 text-violet-800",
  finished: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
};

export type JobStatusKey = "pending" | "running" | "completed" | "failed" | "cancelled";

export const JOB_STATUS_LABELS: Record<JobStatusKey, string> = {
  pending: "بالانتظار",
  running: "قيد التنفيذ",
  completed: "مكتمل",
  failed: "فشل",
  cancelled: "ملغى",
};

export const JOB_STATUS_COLORS: Record<JobStatusKey, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-600",
};

export const BATCH_STATUS_LABELS: Record<string, string> = {
  pending: "بالانتظار",
  running: "قيد التنفيذ",
  completed: "مكتمل",
  partial_failure: "اكتمال جزئي",
  cancelled: "ملغى",
};

export function quizStatusLabel(status: string): string {
  return QUIZ_STATUS_LABELS[status as QuizStatusKey] ?? status;
}

export function quizStatusColor(status: string): string {
  return QUIZ_STATUS_COLORS[status as QuizStatusKey] ?? "bg-slate-100 text-slate-700";
}

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status as JobStatusKey] ?? status;
}

export function jobStatusColor(status: string): string {
  return JOB_STATUS_COLORS[status as JobStatusKey] ?? "bg-slate-100 text-slate-700";
}
