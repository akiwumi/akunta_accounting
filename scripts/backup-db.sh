#!/usr/bin/env bash
# backup-db.sh — SQLite backup with timestamped archive
#
# Usage:
#   bash scripts/backup-db.sh
#
# Set DATABASE_PATH to override the default SQLite file location.
# Backups are written to ./backups/ with a datestamp suffix.
# Keep the last 30 backups; older ones are pruned automatically.

set -euo pipefail

DB_PATH="${DATABASE_PATH:-./dev.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_LAST="${KEEP_LAST:-30}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/akunta-${TIMESTAMP}.db"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup-db] ERROR: Database file not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Use SQLite's .backup command for a consistent hot-copy (works while the app is running)
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[backup-db] Backup written: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Prune old backups — keep the KEEP_LAST most recent files
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "akunta-*.db" | wc -l | tr -d ' ')
if [[ "$BACKUP_COUNT" -gt "$KEEP_LAST" ]]; then
  TO_DELETE=$(( BACKUP_COUNT - KEEP_LAST ))
  find "$BACKUP_DIR" -name "akunta-*.db" | sort | head -n "$TO_DELETE" | xargs rm -f
  echo "[backup-db] Pruned ${TO_DELETE} old backup(s); keeping ${KEEP_LAST}."
fi
