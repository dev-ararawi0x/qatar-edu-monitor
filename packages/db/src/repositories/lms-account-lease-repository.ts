import type { LmsAccountLeasePort } from '@hallili/application'
import { sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'

export class PostgresLmsAccountLease implements LmsAccountLeasePort {
  constructor(private readonly db: HalliliDatabase) {}

  async acquire(input: { connectionId: string; workerId: string; ownerToken: string; now: Date; leaseMs: number }) {
    const expires = new Date(input.now.getTime() + input.leaseMs).toISOString()
    const rows = await this.db.execute(sql`
      insert into lms_account_leases (lms_connection_id, owner_token, worker_id, lease_expires_at, heartbeat_at, updated_at)
      values (${input.connectionId}, ${input.ownerToken}, ${input.workerId}, ${expires}, ${input.now.toISOString()}, ${input.now.toISOString()})
      on conflict (lms_connection_id) do update set
        owner_token = excluded.owner_token,
        worker_id = excluded.worker_id,
        lease_expires_at = excluded.lease_expires_at,
        heartbeat_at = excluded.heartbeat_at,
        updated_at = excluded.updated_at
      where lms_account_leases.lease_expires_at <= ${input.now.toISOString()}
      returning owner_token
    `)
    return (rows as unknown as Array<{ owner_token: string }>).length > 0
  }

  async heartbeat(input: { connectionId: string; ownerToken: string; now: Date; leaseMs: number }) {
    const rows = await this.db.execute(sql`
      update lms_account_leases set heartbeat_at = ${input.now.toISOString()}, lease_expires_at = ${new Date(input.now.getTime() + input.leaseMs).toISOString()}, updated_at = ${input.now.toISOString()}
      where lms_connection_id = ${input.connectionId} and owner_token = ${input.ownerToken}
      returning lms_connection_id
    `)
    return (rows as unknown as Array<unknown>).length > 0
  }

  async release(input: { connectionId: string; ownerToken: string }) {
    await this.db.execute(sql`delete from lms_account_leases where lms_connection_id = ${input.connectionId} and owner_token = ${input.ownerToken}`)
  }
}
