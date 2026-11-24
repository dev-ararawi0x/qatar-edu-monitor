import { z } from "zod";

const formFieldValue = z.union([z.string(), z.array(z.string())]);

export const overrideAnswerSchema = z.object({
  fields: z
    .record(z.string(), formFieldValue)
    .refine((f) => Object.keys(f).length > 0, {
      message: "At least one answer field is required",
    }),
});

export const finishQuizSchema = z.object({
  confirmFinish: z.literal(true, {
    message: "confirmFinish must be true to submit the quiz",
  }),
});

export type OverrideAnswerInput = z.infer<typeof overrideAnswerSchema>;
export type FinishQuizInput = z.infer<typeof finishQuizSchema>;
