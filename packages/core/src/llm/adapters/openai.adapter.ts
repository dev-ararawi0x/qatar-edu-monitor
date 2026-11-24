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
import {
  fetchWithTransientRetry,
  isFallbackEligibleStatus,
} from "../http-retry.js";

export class OpenAiCompatibleLlmAdapter implements LlmProvider {
  public readonly name = "openai" as const;
  public readonly model: string;
  private activeModel: string;
  private readonly fallbackModels: string[];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxHttpRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly quiet: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: LlmProviderConfig,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.model = config.model;
    this.activeModel = config.model;
    this.fallbackModels = Array.from(
      new Set((config.fallbackModels ?? []).filter((m) => m && m !== config.model)),
    );
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.maxHttpRetries = config.maxHttpRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 1200;
    this.quiet = config.quiet ?? false;
    this.fetchImpl = fetchImpl;
  }

  private getOrderedModels(): string[] {
    return Array.from(new Set([this.activeModel, this.model, ...this.fallbackModels]));
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    let feedback: string | undefined = input.validationFeedback;

    for (let validationAttempt = 0; validationAttempt < 2; validationAttempt++) {
      const { systemInstruction, userPrompt } = buildQuestionPrompts({
        ...input,
        ...(feedback ? { validationFeedback: feedback } : {}),
      });

      const userContent: string | Array<Record<string, unknown>> =
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

      const candidateModels = this.getOrderedModels();
      let rawBody = "";
      let succeededModel: string | null = null;
      let lastStatus = 0;

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        const candidateModel = candidateModels[mIdx]!;
        const res = await fetchWithTransientRetry(
          this.fetchImpl,
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: candidateModel,
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: userContent },
              ],
            }),
          },
          {
            maxRetries: this.maxHttpRetries,
            baseDelayMs: this.retryBaseDelayMs,
            onRetry: ({ attempt, maxRetries, status, delayMs }) => {
              if (!this.quiet) {
                console.warn(
                  `[OpenAiAdapter] Transient ${status ? `HTTP ${status}` : "network error"} on "${candidateModel}" — retry ${attempt}/${maxRetries} in ${delayMs}ms...`,
                );
              }
            },
          },
        );

        rawBody = await res.text();
        lastStatus = res.status;

        if (res.ok) {
          succeededModel = candidateModel;
          this.activeModel = candidateModel;
          break;
        }

        const nextModel = candidateModels[mIdx + 1];
        if (nextModel && isFallbackEligibleStatus(res.status)) {
          if (!this.quiet) {
            console.warn(
              `[OpenAiAdapter] Model "${candidateModel}" unavailable (HTTP ${res.status}); falling back to "${nextModel}"...`,
            );
          }
          continue;
        }

        throw new Error(
          `[OpenAiAdapter Error] HTTP ${res.status} (${candidateModel}): ${sanitizeText(rawBody).slice(0, 300)}`,
        );
      }

      if (!succeededModel) {
        throw new Error(
          `[OpenAiAdapter Error] All candidate models [${candidateModels.join(", ")}] failed (last HTTP ${lastStatus}): ${sanitizeText(rawBody).slice(0, 300)}`,
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
        if (err instanceof AnswerValidationError && validationAttempt === 0) {
          feedback = err.message;
          continue;
        }
        throw err;
      }
    }

    throw new Error("[OpenAiAdapter Error] Exhausted validation retries.");
  }
}
