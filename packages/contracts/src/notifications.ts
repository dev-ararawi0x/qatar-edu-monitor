import { z } from 'zod'

export const notificationTypeSchema = z.enum(['job_completed', 'job_paused', 'job_failed'])
export const notificationDtoSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.uuid().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export const notificationListResponseSchema = z.object({
  items: z.array(notificationDtoSchema),
  unreadCount: z.number().int().nonnegative(),
})
export const notificationResponseSchema = z.object({ notification: notificationDtoSchema })
