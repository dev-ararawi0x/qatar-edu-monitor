/** Shared job/batch types + polling helpers for the web client. */

export interface JobDto {
  id: string;
  quizId: string;
  quizTitle: string;
  status: string;
  currentPart: number;
  totalParts: number | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface BatchDto {
  id: string;
  status: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  createdAt: string;
  jobs: JobDto[];
}

export const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);
export const ACTIVE_BATCH_STATUSES = new Set(["pending", "running"]);
export const SOLVABLE_QUIZ_STATUSES = new Set(["due_unsolved", "failed"]);

/** True while any batch or job is still active — drives smart polling. */
export function hasActiveWork(batches: BatchDto[]): boolean {
  return batches.some(
    (b) =>
      ACTIVE_BATCH_STATUSES.has(b.status) ||
      b.jobs.some((j) => ACTIVE_JOB_STATUSES.has(j.status)),
  );
}

/** TanStack Query refetchInterval callback: poll only while work is active. */
export function jobsRefetchInterval(query: {
  state: { data: { batches: BatchDto[] } | undefined };
}): number | false {
  const batches = query.state.data?.batches ?? [];
  return hasActiveWork(batches) ? 2_500 : false;
}
