import { describe, expect, it } from "vitest";
import {
  jobStatusColor,
  jobStatusLabel,
  quizStatusColor,
  quizStatusLabel,
} from "./status.js";

describe("status labels", () => {
  it("returns Arabic labels for known quiz statuses", () => {
    expect(quizStatusLabel("ready_for_review")).toBe("جاهز للمراجعة");
    expect(quizStatusLabel("finished")).toBe("مُسلَّم");
  });

  it("returns Arabic labels for job statuses", () => {
    expect(jobStatusLabel("running")).toBe("قيد التنفيذ");
    expect(jobStatusLabel("completed")).toBe("مكتمل");
  });

  it("falls back to the raw status for unknown values", () => {
    expect(quizStatusLabel("weird_status")).toBe("weird_status");
    expect(jobStatusLabel("weird")).toBe("weird");
  });

  it("provides badge colors for every status", () => {
    for (const s of [
      "due_unsolved",
      "queued",
      "solving",
      "ready_for_review",
      "submitting_finish",
      "finished",
      "failed",
    ]) {
      expect(quizStatusColor(s)).toContain("bg-");
    }
    for (const s of ["pending", "running", "completed", "failed", "cancelled"]) {
      expect(jobStatusColor(s)).toContain("bg-");
    }
  });
});
