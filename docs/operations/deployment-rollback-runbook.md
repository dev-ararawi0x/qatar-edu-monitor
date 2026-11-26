# Hallili v0.1 deployment and rollback runbook

## Release topology

- Deploy `apps/web` and `apps/worker` as separate processes with separate health checks.
- PostgreSQL is the system of record and queue. Run migrations before or with the web release, then start workers.
- Provide distinct least-privileged roles in production: a migration role for DDL and an application role without schema-owner rights.
- Configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, and optional provider settings through the deployment secret manager. Never place real values in the repository or logs.
- Keep Microsoft sign-in and real LMS/provider adapters disabled unless their explicit gates and environment variables are approved.

## Deploy

1. Capture a custom-format backup: `DATABASE_URL=... scripts/db-backup.sh`.
2. Confirm current migration revision and application commit.
3. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `node scripts/security-check.mjs`, and the web build.
4. Apply database migrations.
5. Deploy web, verify `GET /api/v1/health`, then deploy worker and verify `.worker-metrics.json`/process liveness.
6. Verify authenticated `/ops` metrics and one fake-fixture smoke job before opening traffic.

## Rollback

1. Stop workers first so no new jobs are claimed.
2. Roll back web/worker artifacts to the prior commit.
3. If the migration is backward-compatible, leave the schema in place and complete/drain queued jobs according to operator policy.
4. If data corruption or an incompatible migration requires database rollback, restore to a clean PostgreSQL instance using `scripts/db-restore.sh <target-url> <backup-file>`, verify row counts and application health, then repoint application secrets atomically.
5. Record incident time, backup file, migration revision, and operator approval. Never restore over production without a written approval and a fresh pre-restore backup.

## Backup/restore verification performed for v0.1

A custom-format backup was produced with `pg_dump`, restored into a clean temporary PostgreSQL database with `pg_restore`, and object counts were queried successfully. The temporary verification database was removed afterward. The exact commands are encoded in `scripts/db-backup.sh` and `scripts/db-restore.sh`.
