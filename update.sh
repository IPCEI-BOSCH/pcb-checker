#!/usr/bin/env bash
# Pulls the latest version from GitHub, backs up, rebuilds the app.
set -euo pipefail
cd "$(dirname "$0")"
./backup.sh
git pull --ff-only
docker compose -f selfhost/docker-compose.app.yml --env-file .env.selfhost up -d --build
echo "Actualizare completă."
