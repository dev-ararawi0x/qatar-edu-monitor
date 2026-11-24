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

export class OpenAiCompatibleLlmAdapter implements LlmProvider {
  public readonly name = "openai" as const;
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
    this.baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    let feedback: string | undefined = input.validationFeedback;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { systemInstruction, userPrompt } = buildQuestionPrompts({
        ...input,
        ...(feedback ? { validationFeedback: feedback } : {}),
      });

      const userContent:
        | string
        | Array<Record<string, unknown>> =
        input.images && input.images.length > 0
          ? [
              { type: "text", text: userPrompt },
              ...input.images.map((img) => ({
                type: "image_url",
                image_url: {
                  url: `data:${img.mimeType};base64,${img.base64}`,
                },
              })),
            ]
          : userPrompt;

      const url = `${this.baseUrl}/chat/completions`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey && this.apiKey !== "VALUES") {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userContent },
          ],
        }),
      });

      const rawBody = await res.text();
      if (!res.ok) {
        throw new Error(
          `[OpenAiAdapter Error] HTTP ${res.status}: ${sanitizeText(rawBody).slice(0, 300)}`,
        );
      }

      const parsedResp = JSON.parse(rawBody) as {
        choices?: Array<{
          message?: { content?: string };
        }>;
      };
      const modelText = parsedResp.choices?.[0]?.message?.content || "";

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

    throw new Error("[OpenAiAdapter Error] Exhausted validation retries.");
  }
}
