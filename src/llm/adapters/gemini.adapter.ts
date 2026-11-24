import type {
  LlmProvider,
  LlmProviderConfig,
  LlmQuestionInput,
  LlmSolvedAnswer,
} from "../../types/index.js";
import { sanitizeText } from "../../core/sanitizer.js";
import { buildQuestionPrompts } from "../prompt-builder.js";
import {
  AnswerValidationError,
  parseRawLlmJson,
  validateAndNormalizeLlmAnswer,
} from "../answer-validator.js";

export class GeminiLlmAdapter implements LlmProvider {
  public readonly name = "gemini" as const;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: LlmProviderConfig,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    let feedback: string | undefined = input.validationFeedback;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { systemInstruction, userPrompt } = buildQuestionPrompts({
        ...input,
        ...(feedback ? { validationFeedback: feedback } : {}),
      });

      const parts: Array<Record<string, unknown>> = [{ text: userPrompt }];
      if (input.images && input.images.length > 0) {
        for (const img of input.images) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64,
            },
          });
        }
      }

      const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      });

      const rawBody = await res.text();
      if (!res.ok) {
        throw new Error(
          `[GeminiAdapter Error] HTTP ${res.status}: ${sanitizeText(rawBody).slice(0, 300)}`,
        );
      }

      const parsedResp = JSON.parse(rawBody) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const modelText =
        parsedResp.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("") || "";

      try {
        const jsonObj = parseRawLlmJson(modelText);
        return validateAndNormalizeLlmAnswer(jsonObj, input.screen, input.targetLanguage);
      } catch (err) {
        if (err instanceof AnswerValidationError && attempt === 0) {
          feedback = err.message;
          continue;
        }
        throw err;
      }
    }

    throw new Error("[GeminiAdapter Error] Exhausted validation retries.");
  }
}
