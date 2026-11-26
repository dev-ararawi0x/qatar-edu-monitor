import { z } from 'zod'

export const answerPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), selectedOptionIds: z.array(z.string().min(1).max(200)).min(1).max(50) }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('text'), value: z.string().min(1).max(5000) }),
])

export const draftDtoSchema = z.object({
  id: z.uuid(),
  answer: answerPayloadSchema,
  explanation: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  version: z.number().int().positive(),
  reviewedAt: z.iso.datetime().nullable(),
  remoteSaveStatus: z.enum(['not_enabled','not_started','pending','saved','ambiguous','failed']),
})

export const questionDtoSchema = z.object({
  id: z.uuid(),
  position: z.number().int().positive(),
  type: z.string().nullable(),
  status: z.string(),
  pauseReason: z.string().nullable(),
  prompt: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  draft: draftDtoSchema.nullable(),
})
export const jobQuestionsResponseSchema = z.object({ items: z.array(questionDtoSchema) })

export const updateDraftBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  answer: answerPayloadSchema,
})
export const reviewDraftBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
})
export const draftResponseSchema = z.object({ draft: draftDtoSchema })
