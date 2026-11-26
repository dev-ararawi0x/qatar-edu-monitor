#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo 'usage: scripts/db-restore.sh <target-database-url> <backup-file>' >&2
  exit 2
fi
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$1" "$2"
printf 'restore_completed target=%s backup=%s\n' "${1%%\?*}" "$2"
