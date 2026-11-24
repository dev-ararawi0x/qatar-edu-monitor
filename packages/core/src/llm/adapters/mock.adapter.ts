import type {
  LlmProvider,
  LlmQuestionInput,
  LlmSolvedAnswer,
} from "../../types/index.js";
import { getFillableAnswerFields } from "../prompt-builder.js";
import { validateAndNormalizeLlmAnswer } from "../answer-validator.js";

export type CustomMockSolver = (
  input: LlmQuestionInput,
) => Promise<unknown> | unknown;

export class MockLlmAdapter implements LlmProvider {
  public readonly name = "mock" as const;
  public readonly model: string;
  private readonly customSolver?: CustomMockSolver;

  constructor(model = "mock-deterministic-v1", customSolver?: CustomMockSolver) {
    this.model = model;
    if (customSolver) {
      this.customSolver = customSolver;
    }
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    if (this.customSolver) {
      const raw = await this.customSolver(input);
      return validateAndNormalizeLlmAnswer(raw, input.screen, input.targetLanguage);
    }

    const { screen, targetLanguage, part } = input;
    const isAr = targetLanguage === "ar";
    const reasoning = isAr
      ? "تمت الإجابة تلقائياً بواسطة المحول التجريبي (Mock Adapter) للتحقق."
      : "Generated deterministically by MockLlmAdapter for offline verification.";

    if (screen.inputType === "single_choice") {
      const checkedChoice = screen.choices.find((c) => c.checked);
      const selected = checkedChoice ?? screen.choices[0];
      return validateAndNormalizeLlmAnswer(
        {
          kind: "single_choice",
          selectedValue: selected?.value ?? "",
          language: targetLanguage,
          confidence: 0.99,
          reasoning,
        },
        screen,
        targetLanguage,
      );
    }

    if (screen.inputType === "multiple_choice") {
      const checkedChoices = screen.choices.filter((c) => c.checked);
      const picked =
        checkedChoices.length > 0
          ? checkedChoices.map((c) => c.value)
          : screen.choices.slice(0, Math.min(2, screen.choices.length)).map((c) => c.value);
      return validateAndNormalizeLlmAnswer(
        {
          kind: "multiple_choice",
          selectedValues: picked,
          language: targetLanguage,
          confidence: 0.95,
          reasoning,
        },
        screen,
        targetLanguage,
      );
    }

    if (screen.inputType === "structured_input") {
      const fillable = getFillableAnswerFields(screen.fieldDetails);
      const fields: Record<string, string> = {};
      fillable.forEach((f, idx) => {
        if (f.selectOptions && f.selectOptions.length > 0) {
          const nonEmpty = f.selectOptions.find((o) => o.value !== "");
          const chosen = f.selectOptions.find((o) => o.selected && o.value !== "") ?? nonEmpty ?? f.selectOptions[0];
          fields[f.name] = chosen?.value ?? "";
        } else {
          fields[f.name] =
            f.value && f.value.trim()
              ? f.value
              : isAr
                ? `إجابة الفراغ ${idx + 1}`
                : `Blank answer ${idx + 1}`;
        }
      });

      return validateAndNormalizeLlmAnswer(
        {
          kind: "structured_input",
          fields,
          language: targetLanguage,
          confidence: 0.94,
          reasoning,
        },
        screen,
        targetLanguage,
      );
    }

    if (screen.inputType === "file_upload") {
      const accompanyingText = isAr
        ? "تم إرفاق ملف الحل التفصيلي للسؤال."
        : "Attached the detailed solution document for this question.";
      const fileContent = isAr
        ? `# حل السؤال ${part}\n\nهذه إجابة نموذجية باللغة العربية تم إنشاؤها للاختبار.`
        : `# Solution for Part ${part}\n\nThis is a sample academic English response generated for testing.`;

      return validateAndNormalizeLlmAnswer(
        {
          kind: "file_upload",
          accompanyingText,
          generatedFile: {
            fileName: `solution-part-${part}.md`,
            mimeType: "text/markdown",
            content: fileContent,
          },
          language: targetLanguage,
          confidence: 0.92,
          reasoning,
        },
        screen,
        targetLanguage,
      );
    }

    const text = isAr
      ? "هذه إجابة نموذجية واضحة ومختصرة باللغة العربية الفصحى بناءً على متطلبات السؤال."
      : "This is a clear, concise academic English answer tailored to the question prompt.";

    return validateAndNormalizeLlmAnswer(
      {
        kind: "free_text",
        text,
        language: targetLanguage,
        confidence: 0.93,
        reasoning,
      },
      screen,
      targetLanguage,
    );
  }
}
