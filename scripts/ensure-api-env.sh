#!/usr/bin/env bash
# Ensures the root .env contains the API variables required by apps/api.
# Only appends keys that are completely absent — existing values are never
# touched. Generated secrets are random dev values persisted in .env so
# sessions and encrypted data survive restarts. .env is gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
touch "$ENV_FILE"

# Ensure the file ends with a newline so appended keys never glue onto
# the last existing line.
if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then
  printf '\n' >> "$ENV_FILE"
fi

random_hex() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

added=0
ensure() {
  local key="$1" value="$2"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    printf '%s="%s"\n' "$key" "$value" >> "$ENV_FILE"
    echo "    + ${key}"
    added=$((added + 1))
  fi
}

echo "==> Ensuring API env vars in ${ENV_FILE}..."
ensure "DATABASE_URL" "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/qatar_edu_monitor}"
ensure "BETTER_AUTH_SECRET" "$(random_hex)"
ensure "BETTER_AUTH_URL" "http://localhost:3001"
ensure "WEB_ORIGIN" "http://localhost:5173"
ensure "ENCRYPTION_KEY" "$(random_hex)"

if [ "$added" -eq 0 ]; then
  echo "    all present"
else
  echo "    ${added} variable(s) added"
fi
