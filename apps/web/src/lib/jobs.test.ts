import { describe, expect, it } from "vitest";
import {
  hasActiveWork,
  jobsRefetchInterval,
  SOLVABLE_QUIZ_STATUSES,
  type BatchDto,
} from "./jobs.js";

function batch(status: string, jobStatuses: string[] = []): BatchDto {
  return {
    id: "b1",
    status,
    totalJobs: jobStatuses.length,
    completedJobs: 0,
    failedJobs: 0,
    createdAt: new Date().toISOString(),
    jobs: jobStatuses.map((s, i) => ({
      id: `j${i}`,
      quizId: `q${i}`,
      quizTitle: "Quiz",
      status: s,
      currentPart: 0,
      totalParts: null,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
    })),
  };
}

describe("hasActiveWork", () => {
  it("returns false for empty list", () => {
    expect(hasActiveWork([])).toBe(false);
  });

  it("detects running batch", () => {
    expect(hasActiveWork([batch("running")])).toBe(true);
  });

  it("detects pending job inside completed batch", () => {
    expect(hasActiveWork([batch("completed", ["pending"])])).toBe(true);
  });

  it("returns false when everything finished", () => {
    expect(
      hasActiveWork([batch("completed", ["completed", "failed", "cancelled"])]),
    ).toBe(false);
  });
});

describe("jobsRefetchInterval (smart polling)", () => {
  it("polls every 2.5s while work is active", () => {
    const q = { state: { data: { batches: [batch("running")] } } };
    expect(jobsRefetchInterval(q)).toBe(2_500);
  });

  it("stops polling when idle", () => {
    const q = { state: { data: { batches: [batch("completed", ["completed"])] } } };
    expect(jobsRefetchInterval(q)).toBe(false);
  });

  it("stops polling with no data", () => {
    expect(jobsRefetchInterval({ state: { data: undefined } })).toBe(false);
  });
});

describe("SOLVABLE_QUIZ_STATUSES", () => {
  it("includes due_unsolved and failed only", () => {
    expect(SOLVABLE_QUIZ_STATUSES.has("due_unsolved")).toBe(true);
    expect(SOLVABLE_QUIZ_STATUSES.has("failed")).toBe(true);
    expect(SOLVABLE_QUIZ_STATUSES.has("finished")).toBe(false);
    expect(SOLVABLE_QUIZ_STATUSES.has("ready_for_review")).toBe(false);
  });
});
