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

const DEFAULT_GEMINI_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

export class GeminiLlmAdapter implements LlmProvider {
  public readonly name = "gemini" as const;
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
    const rawFallbacks =
      config.fallbackModels ??
      DEFAULT_GEMINI_FALLBACKS.filter((m) => m !== config.model);
    this.fallbackModels = Array.from(
      new Set(rawFallbacks.filter((m) => m && m !== config.model)),
    );
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    this.maxHttpRetries = config.maxHttpRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 1200;
    this.quiet = config.quiet ?? false;
    this.fetchImpl = fetchImpl;
  }

  private getOrderedModels(): string[] {
    const all = [this.activeModel, this.model, ...this.fallbackModels];
    return Array.from(new Set(all));
  }

  async solveQuestion(input: LlmQuestionInput): Promise<LlmSolvedAnswer> {
    let feedback: string | undefined = input.validationFeedback;

    for (let validationAttempt = 0; validationAttempt < 2; validationAttempt++) {
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

      const candidateModels = this.getOrderedModels();
      let rawBody = "";
      let succeededModel: string | null = null;
      let lastStatus = 0;

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        const candidateModel = candidateModels[mIdx]!;
        const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;

        const res = await fetchWithTransientRetry(
          this.fetchImpl,
          url,
          {
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
          },
          {
            maxRetries: this.maxHttpRetries,
            baseDelayMs: this.retryBaseDelayMs,
            onRetry: ({ attempt, maxRetries, status, delayMs }) => {
              if (!this.quiet) {
                console.warn(
                  `[GeminiAdapter] Transient ${status ? `HTTP ${status}` : "network error"} on "${candidateModel}" — retry ${attempt}/${maxRetries} in ${delayMs}ms...`,
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
              `[GeminiAdapter] Model "${candidateModel}" unavailable (HTTP ${res.status}); falling back to "${nextModel}"...`,
            );
          }
          continue;
        }

        throw new Error(
          `[GeminiAdapter Error] HTTP ${res.status} (${candidateModel}): ${sanitizeText(rawBody).slice(0, 300)}`,
        );
      }

      if (!succeededModel) {
        throw new Error(
          `[GeminiAdapter Error] All candidate Gemini models [${candidateModels.join(", ")}] failed (last HTTP ${lastStatus}): ${sanitizeText(rawBody).slice(0, 300)}`,
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
        if (err instanceof AnswerValidationError && validationAttempt === 0) {
          feedback = err.message;
          continue;
        }
        throw err;
      }
    }

    throw new Error("[GeminiAdapter Error] Exhausted validation retries.");
  }
}
