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

export class AnthropicLlmAdapter implements LlmProvider {
  public readonly name = "anthropic" as const;
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
    this.baseUrl = (config.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    let feedback: string | undefined = input.validationFeedback;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { systemInstruction, userPrompt } = buildQuestionPrompts({
        ...input,
        ...(feedback ? { validationFeedback: feedback } : {}),
      });

      const contentBlocks: Array<Record<string, unknown>> = [];
      if (input.images && input.images.length > 0) {
        for (const img of input.images) {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mimeType,
              data: img.base64,
            },
          });
        }
      }
      contentBlocks.push({ type: "text", text: userPrompt });

      const url = `${this.baseUrl}/v1/messages`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          temperature: 0.2,
          system: systemInstruction,
          messages: [
            {
              role: "user",
              content: contentBlocks,
            },
          ],
        }),
      });

      const rawBody = await res.text();
      if (!res.ok) {
        throw new Error(
          `[AnthropicAdapter Error] HTTP ${res.status}: ${sanitizeText(rawBody).slice(0, 300)}`,
        );
      }

      const parsedResp = JSON.parse(rawBody) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const modelText =
        parsedResp.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text || "")
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

    throw new Error("[AnthropicAdapter Error] Exhausted validation retries.");
  }
}
