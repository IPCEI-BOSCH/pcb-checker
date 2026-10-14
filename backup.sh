#!/usr/bin/env bash
# Full backup (database + uploaded files) into ./backups/<date>.
set -euo pipefail
cd "$(dirname "$0")"
D="backups/$(date +%Y-%m-%d_%H%M)"; mkdir -p "$D"
(cd selfhost/supabase && docker compose exec -T db pg_dump -U postgres -d postgres) > "$D/database.sql"
tar -czf "$D/files.tgz" -C selfhost/supabase/volumes storage 2>/dev/null || true
echo "Backup salvat în $D"
