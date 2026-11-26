export interface NotificationSnapshot {
  id: string
  userId: string
  type: 'job_completed'|'job_paused'|'job_failed'
  title: string
  body: string
  targetType: string | null
  targetId: string | null
  idempotencyKey: string
  readAt: Date | null
  createdAt: Date
}

export interface NotificationRepositoryPort {
  createIfAbsent(input: {
    userId: string
    type: NotificationSnapshot['type']
    title: string
    body: string
    targetType: string | null
    targetId: string | null
    idempotencyKey: string
    now: Date
  }): Promise<NotificationSnapshot>
  listForUser(userId: string): Promise<NotificationSnapshot[]>
  markRead(userId: string, notificationId: string, now: Date): Promise<NotificationSnapshot | null>
}
