#!/usr/bin/env bash
# One-command dev: ensures Postgres is up + migrated, then runs
# the API (with embedded worker) and the Vite dev server together.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/ensure-api-env.sh
bash scripts/db-docker.sh up

exec concurrently -n api,web -c blue,green --kill-others-on-fail \
  "pnpm api:dev" \
  "pnpm web:dev"
