#!/usr/bin/env bash
# Manages the local Postgres dev container and applies Drizzle migrations.
#
#   scripts/db-docker.sh up    # start container + generate + migrate (default)
#   scripts/db-docker.sh down  # stop container (data persists in the volume)
#
# Auto-detects Docker vs rootless Podman.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pick a working compose provider: docker if the daemon is reachable,
# else podman-compose (rootless podman, no socket required).
if docker info >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v podman-compose >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  COMPOSE="podman-compose"
elif podman info >/dev/null 2>&1; then
  COMPOSE="podman compose"
else
  echo "error: neither docker nor podman is usable" >&2
  exit 1
fi
echo "==> Using: $COMPOSE"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-qatar_edu_monitor}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}}"

ACTION="${1:-up}"

if [ "$ACTION" = "down" ]; then
  $COMPOSE down
  exit 0
fi

echo "==> Starting Postgres container (qatar-edu-db)..."
$COMPOSE up -d db

echo "==> Waiting for Postgres to accept connections..."
until $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  sleep 1
done

echo "==> Generating migrations from apps/api schema..."
DATABASE_URL="${DATABASE_URL}" pnpm --filter @qatar-edu/api db:generate

echo "==> Applying migrations..."
DATABASE_URL="${DATABASE_URL}" pnpm --filter @qatar-edu/api db:migrate

echo ""
echo "Done. Postgres is running and migrated."
echo "DATABASE_URL=${DATABASE_URL}"
echo ""
echo "Next steps:"
echo "  pnpm api:dev      # API + embedded worker"
echo "  pnpm web:dev      # web UI"
echo "  pnpm db:down      # stop the container (data persists in the volume)"
