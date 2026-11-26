#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
compose_file="infra/docker/compose.yaml"

if [[ "$action" != "up" && "$action" != "down" ]]; then
  echo "Usage: scripts/db-compose.sh up|down" >&2
  exit 2
fi

if docker info >/dev/null 2>&1; then
  if [[ "$action" == "up" ]]; then
    docker compose -f "$compose_file" up -d postgres
  else
    docker compose -f "$compose_file" down
  fi
elif podman info >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user start podman.socket >/dev/null 2>&1 || true
  fi
  if [[ "$action" == "up" ]]; then
    podman compose -f "$compose_file" up -d postgres
  else
    podman compose -f "$compose_file" down
  fi
else
  echo "Neither Docker nor rootless Podman is available for the local PostgreSQL service." >&2
  exit 1
fi
