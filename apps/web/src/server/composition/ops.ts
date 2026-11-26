import { createDatabase, sql } from '@hallili/db'

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value || value === 'VALUES') throw new Error(`${name} must be configured.`)
  return value
}

const database = createDatabase(requiredEnv('DATABASE_URL'))

export async function getWebHealth() {
  await database.db.execute(sql`select 1`)
  return { status: 'ok', service: 'web', checkedAt: new Date().toISOString() }
}

export async function getOperationalMetrics() {
  const rows = await database.db.execute(sql`
    select
      (select count(*)::int from solve_jobs where status = 'queued') as queued_jobs,
      (select count(*)::int from solve_jobs where status = 'running') as running_jobs,
      (select count(*)::int from solve_jobs where status = 'paused') as paused_jobs,
      (select count(*)::int from solve_jobs where status = 'completed') as completed_jobs,
      (select count(*)::int from solve_jobs where pause_reason = 'PARSER_MISMATCH') as parser_mismatch_jobs,
      (select count(*)::int from solve_jobs where pause_reason in ('PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE')) as provider_blocked_jobs,
      (select count(*)::int from answer_drafts) as drafts,
      (select count(*)::int from draft_revisions) as draft_revisions
  `)
  const metrics = (rows as unknown as Array<Record<string, number>>)[0] ?? {}
  return { service: 'web', collectedAt: new Date().toISOString(), metrics }
}
