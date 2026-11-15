#!/usr/bin/env bash
# backup-db.sh — logical PostgreSQL backup with a timestamped archive.
#
# Usage:
#   DIRECT_URL=postgresql://... bash scripts/backup-db.sh
#
# Uses DIRECT_URL (the non-pooled connection); pg_dump cannot run through the
# transaction pooler. Falls back to DATABASE_URL.
#
# This is a second line of defence. In production the first line is Supabase
# point-in-time recovery, which must be enabled on the project.
#
# Restore into an empty database with:
#   pg_restore --no-owner --dbname "$TARGET_URL" backups/akunta-<timestamp>.dump

set -euo pipefail

DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_LAST="${KEEP_LAST:-30}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/akunta-${TIMESTAMP}.dump"

if [[ -z "$DB_URL" ]]; then
  echo "[backup-db] ERROR: set DIRECT_URL or DATABASE_URL" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

pg_dump "$DB_URL" --format=custom --no-owner --file "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[backup-db] Backup written: ${BACKUP_FILE} (${BACKUP_SIZE})"

BACKUP_COUNT=$(find "$BACKUP_DIR" -name "akunta-*.dump" | wc -l | tr -d ' ')
if [[ "$BACKUP_COUNT" -gt "$KEEP_LAST" ]]; then
  TO_DELETE=$(( BACKUP_COUNT - KEEP_LAST ))
  find "$BACKUP_DIR" -name "akunta-*.dump" | sort | head -n "$TO_DELETE" | xargs rm -f
  echo "[backup-db] Pruned ${TO_DELETE} old backup(s); keeping ${KEEP_LAST}."
fi
