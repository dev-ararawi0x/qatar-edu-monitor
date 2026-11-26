import { ApplicationError, type ActorContext, type ClockPort } from '../index'
import type { NotificationRepositoryPort, NotificationSnapshot } from './ports'

function dto(notification: NotificationSnapshot) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    targetType: notification.targetType,
    targetId: notification.targetId,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  }
}

export class ListNotifications {
  constructor(private readonly notifications: NotificationRepositoryPort) {}
  async execute(actor: ActorContext) {
    const items = await this.notifications.listForUser(actor.userId)
    return { items: items.map(dto), unreadCount: items.filter((item) => !item.readAt).length }
  }
}

export class MarkNotificationRead {
  constructor(private readonly notifications: NotificationRepositoryPort, private readonly clock: ClockPort) {}
  async execute(actor: ActorContext, notificationId: string) {
    const notification = await this.notifications.markRead(actor.userId, notificationId, this.clock.now())
    if (!notification) throw new ApplicationError('NOT_FOUND', 'The requested notification was not found.', 404)
    return { notification: dto(notification) }
  }
}

export class RecordJobNotification {
  constructor(private readonly notifications: NotificationRepositoryPort, private readonly clock: ClockPort) {}
  async execute(input: { userId: string; jobId: string; outcome: 'completed'|'paused'|'failed' }) {
    const type = input.outcome === 'completed' ? 'job_completed' : input.outcome === 'paused' ? 'job_paused' : 'job_failed'
    const title = input.outcome === 'completed' ? 'Drafts are ready for review' : input.outcome === 'paused' ? 'A solving job paused safely' : 'A solving job failed safely'
    const body = input.outcome === 'completed'
      ? 'AI-generated drafts are available locally for your review.'
      : input.outcome === 'paused'
        ? 'The job paused before any unsafe action. Open the job for the reason and resume instructions.'
        : 'The job stopped without changing review state. Open the job for details.'
    const notification = await this.notifications.createIfAbsent({
      userId: input.userId,
      type,
      title,
      body,
      targetType: 'solve_job',
      targetId: input.jobId,
      idempotencyKey: `job-notification:${input.jobId}:${input.outcome}`,
      now: this.clock.now(),
    })
    return { notification: dto(notification) }
  }
}
