import { describe, expect, it } from "vitest";
import {
  editableFieldDetails,
  initialAnswerFields,
  questionImageUrl,
  type ReviewQuestion,
} from "./review.js";

function question(overrides: Partial<ReviewQuestion>): ReviewQuestion {
  return {
    id: "q1",
    part: 1,
    questionHeader: null,
    promptText: null,
    points: null,
    inputType: "free_text",
    choices: null,
    fieldDetails: null,
    imageUrls: [],
    userOverrideAnswer: null,
    ...overrides,
  };
}

describe("initialAnswerFields", () => {
  it("prefers user override answers", () => {
    const q = question({
      userOverrideAnswer: { answer: "user value" },
      fieldDetails: [{ name: "answer", type: "text", tagName: "input", value: "old" }],
    });
    expect(initialAnswerFields(q)).toEqual({ answer: "user value" });
  });

  it("uses checked choice for single_choice", () => {
    const q = question({
      inputType: "single_choice",
      choices: [
        { value: "1", label: "One", checked: false, fieldName: "answer" },
        { value: "2", label: "Two", checked: true, fieldName: "answer" },
      ],
    });
    expect(initialAnswerFields(q)).toEqual({ answer: "2" });
  });

  it("collects checked values for multiple_choice", () => {
    const q = question({
      inputType: "multiple_choice",
      choices: [
        { value: "1", label: "One", checked: true, fieldName: "answer" },
        { value: "2", label: "Two", checked: false, fieldName: "answer" },
        { value: "3", label: "Three", checked: true, fieldName: "answer" },
      ],
    });
    expect(initialAnswerFields(q)).toEqual({ answer: ["1", "3"] });
  });

  it("falls back to stored field values, skipping hidden inputs", () => {
    const q = question({
      fieldDetails: [
        { name: "authenticity_token", type: "hidden", tagName: "input", value: "tok" },
        { name: "answer", type: "text", tagName: "input", value: "42" },
        { name: "answer", type: "text", tagName: "input", value: "ignored" },
      ],
    });
    expect(initialAnswerFields(q)).toEqual({ answer: "42" });
  });
});

describe("editableFieldDetails", () => {
  it("removes hidden inputs", () => {
    const q = question({
      fieldDetails: [
        { name: "token", type: "hidden", tagName: "input" },
        { name: "answer", type: "text", tagName: "input" },
      ],
    });
    expect(editableFieldDetails(q).map((f) => f.name)).toEqual(["answer"]);
  });
});

describe("questionImageUrl", () => {
  it("builds the proxy URL", () => {
    const url = questionImageUrl("abc", 2, 0);
    expect(url).toContain("/api/quizzes/abc/questions/2/image/0");
  });
});
