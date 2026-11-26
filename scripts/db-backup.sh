#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p backups
output="${1:-backups/hallili-$(date -u +%Y%m%dT%H%M%SZ).dump}"
pg_dump --format=custom --no-owner --no-privileges --file="$output" "$DATABASE_URL"
printf 'backup_written=%s\n' "$output"
