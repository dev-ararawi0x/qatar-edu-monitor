import { z } from 'zod'

export const listQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const assessmentListQuerySchema = listQuerySchema.extend({
  dueOnly: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
})

export const subjectDtoSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  gradeLabel: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  lastSyncedAt: z.iso.datetime(),
})

export const subjectListResponseSchema = z.object({
  items: z.array(subjectDtoSchema),
  nextCursor: z.string().nullable(),
})

export const refreshSubjectsResponseSchema = z.object({
  refreshedAt: z.iso.datetime(),
  subjectCount: z.number().int().nonnegative(),
  items: z.array(subjectDtoSchema),
})

export const assessmentDtoSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  title: z.string(),
  type: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  sourceStatus: z.string().nullable(),
  displayStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DRAFT_READY', 'SUBMITTED']),
  timedQuizStatus: z.enum(['yes', 'no', 'unknown']),
  lastSyncedAt: z.iso.datetime(),
})

export const assessmentListResponseSchema = z.object({
  items: z.array(assessmentDtoSchema),
  nextCursor: z.string().nullable(),
})

export const refreshAssessmentsResponseSchema = z.object({
  refreshedAt: z.iso.datetime(),
  assessmentCount: z.number().int().nonnegative(),
  items: z.array(assessmentDtoSchema),
})
