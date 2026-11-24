import { z } from "zod";

export const createBatchSchema = z
  .object({
    /** Specific quiz row ids to solve. */
    quizIds: z.array(z.string().uuid()).max(100).optional(),
    /** Solve every quiz currently in `due_unsolved` status. */
    allDue: z.boolean().optional(),
    /** Allow starting brand-new attempts (not just resuming paused ones). */
    startNewAllowed: z.boolean().default(true),
    /** Allow timed quizzes (dangerous — consumes the attempt timer). */
    allowTimed: z.boolean().default(false),
    /** Optional ephemeral cookie override for this batch only. */
    cookieOverride: z
      .string()
      .min(10)
      .refine((v) => v.trim() !== "VALUES", {
        message: "cookieOverride must be a real session value",
      })
      .optional(),
  })
  .refine((v) => v.allDue === true || (v.quizIds?.length ?? 0) > 0, {
    message: "Provide quizIds or set allDue: true",
  });

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
