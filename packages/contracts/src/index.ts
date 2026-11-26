import { z } from 'zod'

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
})

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>

export const isoDateTimeSchema = z.iso.datetime()
export const uuidSchema = z.uuid()

export * from './lms'
