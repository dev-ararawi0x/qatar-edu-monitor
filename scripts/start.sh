#!/usr/bin/env bash
# One-command production-ish run: ensures Postgres is up + migrated,
# builds the web app if needed, then serves the API (with embedded
# worker) and the built web bundle together.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/ensure-api-env.sh

if [ ! -f apps/web/dist/index.html ]; then
  echo "==> No web build found — building first..."
  pnpm --filter @qatar-edu/web build
fi

bash scripts/db-docker.sh up

exec concurrently -n api,web -c blue,green --kill-others-on-fail \
  "pnpm api:start" \
  "pnpm --filter @qatar-edu/web exec vite preview --port 5173 --strictPort"
