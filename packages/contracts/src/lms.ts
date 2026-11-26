import { z } from 'zod'

export const lmsConnectionStatusSchema = z.enum(['unverified', 'valid', 'expired', 'blocked', 'revoked', 'unknown'])

export const putLmsConnectionBodySchema = z.strictObject({
  cookieValue: z.string().min(1).max(4096),
})

export const lmsConnectionResponseSchema = z.object({
  connection: z
    .object({
      status: lmsConnectionStatusSchema,
      lastValidatedAt: z.iso.datetime().nullable(),
      credentialExpiresAt: z.iso.datetime().nullable(),
      lastRotatedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
})

export const validateLmsConnectionResponseSchema = z.object({
  status: z.enum(['valid', 'expired', 'blocked', 'unknown']),
  checkedAt: z.iso.datetime(),
  message: z.string(),
})
