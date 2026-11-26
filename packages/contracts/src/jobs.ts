import { z } from 'zod'

export const solveJobStatusSchema = z.enum(['queued', 'running', 'paused', 'completed', 'failed'])
export const createSolveJobsBodySchema = z.strictObject({
  attemptIds: z.array(z.uuid()).min(1).max(10),
  language: z.enum(['auto', 'ar', 'en']).default('auto'),
  timedAssessmentAcknowledgement: z.boolean().default(false),
})
export const idempotencyKeyHeaderSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)

export const jobReceiptSchema = z.object({
  jobId: z.uuid(),
  attemptId: z.uuid(),
  status: solveJobStatusSchema,
  existing: z.boolean(),
  createdAt: z.iso.datetime(),
})
export const createSolveJobsResponseSchema = z.object({ jobs: z.array(jobReceiptSchema) })

export const jobDtoSchema = z.object({
  id: z.uuid(),
  attemptId: z.uuid(),
  status: solveJobStatusSchema,
  pauseReason: z.string().nullable(),
  message: z.string().nullable(),
  currentQuestionPosition: z.number().int().positive().nullable(),
  totalQuestions: z.number().int().nonnegative(),
  completedQuestions: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  pollAfterMs: z.number().int().positive().nullable(),
})
export const jobListResponseSchema = z.object({ items: z.array(jobDtoSchema), nextCursor: z.string().nullable() })
export const jobResponseSchema = z.object({ job: jobDtoSchema })
export const jobListQuerySchema = z.object({
  status: solveJobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
